import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { AMBIENT_CLAUDE_SCOPE, createVendorAdapters } from "../src/adapters.js";
import { ProcessExitError } from "../src/errors.js";
import { createPromptEnvelope } from "../src/prompt-envelope.js";
import { resolveOutputContract } from "../src/output-contract.js";
import {
  planningReviewResult,
  planningReviewAnalysis
} from "./planning-review-fixtures.js";
import type {
  ClaudeInvocationScope,
  ProcessRunner,
  PlanningAdapterRequest,
  PlanningReviewResult,
  PlanningReviewAnalysis
} from "../src/types.js";

/** ADR-0059 §2: planning review is a review role and loses `Skill`. */
const REVIEW_TOOLS = "Read,Glob,Grep";
const REVIEW_DISALLOWED_TOOLS =
  "Skill,Bash,Edit,Write,MultiEdit,NotebookEdit,WebFetch,WebSearch";
/** Planning analysis is a planner-role invocation and keeps today's tools. */
const PLANNER_TOOLS = "Read,Glob,Grep,Skill";
const PLANNER_DISALLOWED_TOOLS =
  "Bash,Edit,Write,MultiEdit,NotebookEdit,WebFetch,WebSearch";
const MEMORY = "CLAUDE_CODE_DISABLE_AUTO_MEMORY";
const FALLBACK = "CLAUDE_CODE_DISABLE_REFUSAL_FALLBACK";

test("planning invocations preserve read-only argv, exact schema and environment for both vendors", async (t) => {
  for (const vendor of ["codex", "claude"] as const)
    for (const analysis of [false, true])
      for (const resumed of [false, true])
        await t.test(
          `${vendor} ${analysis ? "analysis" : "review"} ${resumed ? "resumed" : "fresh"}`,
          async () => {
            const directory = await mkdtemp(
              path.join(tmpdir(), "banzai-planning-adapter-")
            );
            try {
              await mkdir(path.join(directory, "attempts"));
              const result = analysis
                ? planningReviewAnalysis()
                : planningReviewResult();
              const identity = analysis
                ? "planning-review-analysis/v1"
                : "planning-review-result/v1";
              const announced: string[] = [];
              let processCompleted = false;
              const runner: ProcessRunner = async (spec) => {
                assert.equal(spec.env.BANZAI_RUN_ID, "run-planning");
                for (const key of [
                  "BANZAI_APPROVAL_DIGEST",
                  "BANZAI_WORKFLOW_DIGEST",
                  "BANZAI_REVIEW_ARTIFACT"
                ])
                  assert.ok(!spec.env[key]);
                assert.equal(spec.cwd, directory);
                if (vendor === "codex") {
                  assert.equal(spec.env[MEMORY], undefined);
                  assert.equal(spec.env[FALLBACK], undefined);
                }
                if (vendor === "claude") {
                  assert.deepEqual(spec.args, [
                    "-p",
                    "Read only",
                    "--output-format",
                    "stream-json",
                    "--verbose",
                    "--json-schema",
                    resolveOutputContract(vendor, identity).serialized,
                    "--model",
                    "model",
                    "--effort",
                    "high",
                    "--permission-mode",
                    "dontAsk",
                    "--tools",
                    analysis ? PLANNER_TOOLS : REVIEW_TOOLS,
                    "--disallowedTools",
                    analysis
                      ? PLANNER_DISALLOWED_TOOLS
                      : REVIEW_DISALLOWED_TOOLS,
                    ...(resumed ? ["--resume", "session"] : [])
                  ]);
                  assert.equal(
                    spec.args[spec.args.indexOf("--json-schema") + 1],
                    resolveOutputContract(vendor, identity).serialized
                  );
                } else {
                  const schemaPath = path.join(
                    directory,
                    "contracts",
                    `${identity.replace("/v1", "")}.schema.json`
                  );
                  const outputPath = path.join(
                    directory,
                    "attempts",
                    "planning-1-result.json"
                  );
                  const shared = [
                    "--json",
                    "--output-schema",
                    schemaPath,
                    "-o",
                    outputPath,
                    "-m",
                    "model",
                    "-c",
                    'model_reasoning_effort="high"'
                  ];
                  assert.deepEqual(
                    spec.args,
                    resumed
                      ? [
                          "exec",
                          "resume",
                          ...shared,
                          "-c",
                          'sandbox_mode="read-only"',
                          "session",
                          "Read only"
                        ]
                      : [
                          "exec",
                          ...shared,
                          "--sandbox",
                          "read-only",
                          "--cd",
                          directory,
                          "Read only"
                        ]
                  );
                  assert.ok(
                    spec.args.includes(
                      resumed ? 'sandbox_mode="read-only"' : "read-only"
                    )
                  );
                  const outputIndex = spec.args.indexOf("-o");
                  assert.ok(outputIndex >= 0);
                  const output = spec.args[outputIndex + 1];
                  assert.ok(output);
                  await writeFile(output, JSON.stringify(result));
                }
                const start = JSON.stringify(
                  vendor === "claude"
                    ? { type: "system", subtype: "init", session_id: "session" }
                    : { type: "thread.started", thread_id: "session" }
                );
                await spec.onStdoutLineDurable?.(start);
                const stdout =
                  vendor === "claude"
                    ? JSON.stringify({
                        type: "result",
                        structured_output: result,
                        session_id: "session",
                        usage: { input_tokens: 0, output_tokens: 0 }
                      })
                    : JSON.stringify({
                        type: "thread.started",
                        thread_id: "session"
                      });
                processCompleted = true;
                return {
                  command: spec.command,
                  args: spec.args,
                  exitCode: 0,
                  signal: null,
                  stdout: vendor === "claude" ? `${start}\n${stdout}` : stdout,
                  stderr: "",
                  startedAt: "2026-10-14T00:00:00.000Z",
                  completedAt: "2026-10-14T00:00:01.000Z",
                  durationMs: 1000
                };
              };
              const request: PlanningAdapterRequest<
                PlanningReviewResult | PlanningReviewAnalysis
              > = {
                repoRoot: directory,
                runId: "run-planning",
                runDirectory: directory,
                attemptId: "planning-1",
                prompt: "Read only",
                promptEnvelope: createPromptEnvelope([
                  { category: "phase_instructions", text: "Read only" }
                ]),
                outputContract: resolveOutputContract(vendor, identity),
                settings: {
                  executable: vendor,
                  model: "model",
                  effort: "high",
                  timeoutMs: 1000
                },
                resumeSessionId: resumed ? "session" : null,
                env: {
                  BANZAI_APPROVAL_DIGEST: "old",
                  BANZAI_WORKFLOW_DIGEST: "old",
                  BANZAI_REVIEW_ARTIFACT: "old"
                },
                onStart: async () => {},
                onProgress: () => {},
                ...(analysis
                  ? {
                      onSessionStarted: async (sessionId: string) => {
                        assert.equal(processCompleted, false);
                        announced.push(sessionId);
                      }
                    }
                  : {})
              };
              const adapters = createVendorAdapters(runner);
              assert.deepEqual(
                (analysis
                  ? await adapters.runPlanningAnalysis(request)
                  : await adapters.runPlanningReview(request)
                ).result,
                result
              );
              assert.deepEqual(announced, analysis ? ["session"] : []);
            } finally {
              await rm(directory, { recursive: true, force: true });
            }
          }
        );
});

function planningRequest(
  directory: string,
  analysis: boolean,
  extra: Partial<
    PlanningAdapterRequest<PlanningReviewResult | PlanningReviewAnalysis>
  > = {}
): PlanningAdapterRequest<PlanningReviewResult | PlanningReviewAnalysis> {
  const identity = analysis
    ? "planning-review-analysis/v1"
    : "planning-review-result/v1";
  return {
    repoRoot: directory,
    runId: "run-planning",
    runDirectory: directory,
    attemptId: "planning-1",
    prompt: "Read only",
    promptEnvelope: createPromptEnvelope([
      { category: "phase_instructions", text: "Read only" }
    ]),
    outputContract: resolveOutputContract("claude", identity),
    settings: {
      executable: "claude",
      model: "model",
      effort: "high",
      timeoutMs: 1000
    },
    resumeSessionId: null,
    env: { PATH: "/usr/bin", [MEMORY]: "0", [FALLBACK]: "0" },
    onStart: async () => {},
    onProgress: () => {},
    ...extra
  };
}

const scopes: readonly [string, ClaudeInvocationScope | undefined][] = [
  [
    "scoped",
    {
      strictMcpConfig: true,
      settingSources: "project",
      pluginDirectory: "/plugins/banzai"
    }
  ],
  [
    "degraded scoped",
    { strictMcpConfig: true, settingSources: null, pluginDirectory: null }
  ],
  ["ambient", AMBIENT_CLAUDE_SCOPE],
  ["no scope", undefined]
];

test("Claude planning review isolates the reviewer and planning analysis keeps the planner's environment", async () => {
  for (const analysis of [false, true])
    for (const [name, environment] of scopes) {
      const spawns: NodeJS.ProcessEnv[] = [];
      const runner: ProcessRunner = async (spec) => {
        spawns.push({ ...spec.env });
        return {
          exitCode: 1,
          signal: null,
          stdout: "",
          stderr: "stopped after spawn",
          startedAt: "2026-10-14T00:00:00.000Z",
          completedAt: "2026-10-14T00:00:01.000Z"
        };
      };
      const adapters = createVendorAdapters(runner);
      const request = planningRequest(
        "/repo",
        analysis,
        environment === undefined ? {} : { environment }
      );
      await assert.rejects(
        analysis
          ? adapters.runPlanningAnalysis(request)
          : adapters.runPlanningReview(request)
      );
      const env = spawns[0];
      assert.ok(env);
      const label = `${analysis ? "analysis" : "review"} ${name}`;
      if (!analysis) {
        assert.equal(env[MEMORY], "1", label);
        assert.equal(env[FALLBACK], "1", label);
      } else {
        assert.equal(
          env[MEMORY],
          environment?.strictMcpConfig === true ? "1" : "0",
          label
        );
        assert.equal(env[FALLBACK], "0", label);
      }
      assert.equal(env.BANZAI_RUN_ID, "run-planning", label);
    }
});

test("a refused Claude planning review is a typed, retry-eligible model failure", async () => {
  const line = JSON.stringify({
    type: "result",
    subtype: "error_during_execution",
    is_error: true,
    result: "The request was declined.",
    session_id: "session"
  });
  let checkpoints = 0;
  const runner: ProcessRunner = async (spec) => {
    await spec.onStdoutLineDurable?.(line);
    return {
      exitCode: 1,
      signal: null,
      stdout: line,
      stderr: "",
      startedAt: "2026-10-14T00:00:00.000Z",
      completedAt: "2026-10-14T00:00:01.000Z"
    };
  };
  await assert.rejects(
    createVendorAdapters(runner).runPlanningReview(
      planningRequest("/repo", false, {
        onTerminalSuccess: async () => {
          checkpoints += 1;
        }
      })
    ),
    (error: unknown) => {
      assert.ok(error instanceof ProcessExitError);
      assert.equal(error.code, "CLAUDE_PLANNING_FAILED");
      assert.equal(error.failureCause, "unclassified");
      return true;
    }
  );
  assert.equal(checkpoints, 0);
});
