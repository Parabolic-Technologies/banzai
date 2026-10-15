import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createVendorAdapters } from "../src/adapters.js";
import { createPromptEnvelope } from "../src/prompt-envelope.js";
import { resolveOutputContract } from "../src/output-contract.js";
import {
  planningReviewResult,
  planningReviewAnalysis
} from "./planning-review-fixtures.js";
import type {
  ProcessRunner,
  PlanningAdapterRequest,
  PlanningReviewResult,
  PlanningReviewAnalysis
} from "../src/types.js";

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
                    "Read,Glob,Grep,Skill",
                    "--disallowedTools",
                    "Bash,Edit,Write,MultiEdit,NotebookEdit,WebFetch,WebSearch",
                    ...(resumed ? ["--resume", "session"] : [])
                  ]);
                  assert.equal(
                    spec.args[spec.args.indexOf("--tools") + 1],
                    "Read,Glob,Grep,Skill"
                  );
                  assert.equal(
                    spec.args[spec.args.indexOf("--disallowedTools") + 1],
                    "Bash,Edit,Write,MultiEdit,NotebookEdit,WebFetch,WebSearch"
                  );
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
