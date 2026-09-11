import assert from "node:assert/strict";
import { mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  executeContextReport,
  parseContextReportArgs
} from "../src/context-report-cli.js";
import {
  available,
  emptyContextInventory,
  emptyContextVendorUsage,
  measureRunnerPayload
} from "../src/context-accounting.js";
import { BanzaiError } from "../src/errors.js";
import { resolveOutputContract } from "../src/output-contract.js";
import { createPromptEnvelope } from "../src/prompt-envelope.js";
import {
  CONTEXT_ATTEMPT_SCHEMA,
  CONTEXT_ATTEMPT_SCHEMA_VERSION,
  type ContextAttemptLedger
} from "../src/types.js";
import { createEvaluationRoot, snapshotTree } from "./helpers.js";

test("context CLI reuses export parsing and writes deterministic read-only output", async () => {
  assert.deepEqual(
    parseContextReportArgs([
      "--json",
      "--from",
      "2026-08-23T03:00:00+03:00",
      "--run",
      "z-run",
      "--run",
      "a-run"
    ]),
    {
      format: "json",
      from: "2026-08-23T00:00:00.000Z",
      to: null,
      runIds: ["a-run", "z-run"]
    }
  );
  const root = await createEvaluationRoot();
  try {
    const runs = path.join(root, ".banzai", "runs");
    const before = await snapshotTree(runs);
    for (const args of [[], ["--json"]] as string[][]) {
      const stdout: string[] = [];
      const stderr: string[] = [];
      await executeContextReport(root, args, {
        stdout: (value) => stdout.push(value),
        stderr: (value) => stderr.push(value)
      });
      assert.equal(stdout.length, 1);
      assert.deepEqual(stderr, []);
      if (args.includes("--json")) {
        assert.equal(
          (JSON.parse(stdout[0] ?? "") as { schema: string }).schema,
          "banzai-context-report/v1"
        );
      } else {
        assert.match(stdout[0] ?? "", /^# Banzai Context Report/);
      }
    }
    assert.deepEqual(await snapshotTree(runs), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("context CLI renders interrupted exact and incomplete coverage deterministically", async () => {
  const root = await createEvaluationRoot();
  try {
    const runs = path.join(root, ".banzai", "runs");
    for (const [runId, exact] of [
      ["interrupted-cli-exact", true],
      ["interrupted-cli-gap", false]
    ] as const) {
      const attemptId = `${runId}-plan-1`;
      const run = path.join(runs, runId);
      const attempts = path.join(run, "attempts");
      await mkdir(attempts, { recursive: true });
      await writeFile(
        path.join(run, "state.json"),
        JSON.stringify({
          runId,
          createdAt: "2026-08-23T00:00:00.000Z",
          workflowSelection: { workflow: "strict" }
        }),
        "utf8"
      );
      await writeFile(
        path.join(attempts, `${attemptId}-plan.json`),
        JSON.stringify({
          attempt: { id: attemptId, kind: "plan", mutable: false },
          status: "interrupted",
          usage: null
        }),
        "utf8"
      );
      if (exact) {
        const runnerPayload = measureRunnerPayload(
          createPromptEnvelope([
            { category: "phase_instructions", text: "план café" }
          ]),
          resolveOutputContract("codex", "phase-result/v3")
        );
        const ledger: ContextAttemptLedger = {
          schema: CONTEXT_ATTEMPT_SCHEMA,
          schemaVersion: CONTEXT_ATTEMPT_SCHEMA_VERSION,
          runId,
          attempt: { id: attemptId, kind: "plan", mutable: false },
          invocations: [
            {
              ordinal: 1,
              kind: "primary",
              workflow: "strict",
              phase: "plan",
              role: "planner",
              vendor: "codex",
              sessionMode: "fresh",
              measuredAt: "2026-08-23T00:00:00.000Z",
              completedAt: null,
              outcome: "pending",
              runnerPayload,
              authority: [{ class: "development_plan", count: 1 }],
              sessionInventory: emptyContextInventory(),
              vendorUsage: emptyContextVendorUsage(),
              budgets: [
                {
                  metric: "runner_payload_bytes",
                  selector: { phase: "plan", role: "planner" },
                  maximum: runnerPayload.totalBytes + 1,
                  observed: available(runnerPayload.totalBytes),
                  result: "within_limit"
                }
              ]
            }
          ]
        };
        await writeFile(
          path.join(attempts, `${attemptId}.context.json`),
          JSON.stringify(ledger),
          "utf8"
        );
      }
    }

    for (const args of [[], ["--json"]] as string[][]) {
      const outputs: string[] = [];
      for (let pass = 0; pass < 2; pass += 1) {
        const stdout: string[] = [];
        await executeContextReport(root, args, {
          stdout: (value) => stdout.push(value),
          stderr: () => undefined
        });
        assert.equal(stdout.length, 1);
        outputs.push(stdout[0] ?? "");
      }
      assert.equal(outputs[1], outputs[0]);
      if (args.includes("--json")) {
        const report = JSON.parse(outputs[0] ?? "") as {
          coverage: { exact: number; incomplete: number };
          groups: {
            vendorUsage: { inputTokens: { unavailable: number } };
          }[];
        };
        assert.deepEqual(report.coverage, { exact: 1, incomplete: 1 });
        assert.equal(report.groups[0]?.vendorUsage.inputTokens.unavailable, 1);
      } else {
        assert.match(outputs[0] ?? "", /- Exact: 1\n- Incomplete: 1/);
        assert.match(outputs[0] ?? "", /Input tokens.*unavailable/s);
      }
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("context CLI failures write no report output", async () => {
  const root = await createEvaluationRoot();
  try {
    const stdout: string[] = [];
    const stderr: string[] = [];
    await assert.rejects(
      executeContextReport(root, ["--run", "missing-run"], {
        stdout: (value) => stdout.push(value),
        stderr: (value) => stderr.push(value)
      }),
      (error: unknown) =>
        error instanceof BanzaiError && error.code === "EVAL_RUN_NOT_FOUND"
    );
    await assert.rejects(
      executeContextReport(root, ["--unknown"], {
        stdout: (value) => stdout.push(value),
        stderr: (value) => stderr.push(value)
      }),
      (error: unknown) =>
        error instanceof BanzaiError && error.code === "INVALID_EVAL_OPTION"
    );
    assert.deepEqual(stdout, []);
    assert.deepEqual(stderr, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("malformed ledger aborts context CLI with an empty stdout", async () => {
  const root = await createEvaluationRoot();
  try {
    const runId = "malformed-run";
    const attemptId = "malformed-plan-1";
    const attempts = path.join(root, ".banzai", "runs", runId, "attempts");
    await mkdir(attempts, { recursive: true });
    await writeFile(
      path.join(root, ".banzai", "runs", runId, "state.json"),
      JSON.stringify({
        runId,
        createdAt: "2026-08-23T00:00:00.000Z",
        workflowSelection: { workflow: "strict" }
      }),
      "utf8"
    );
    await writeFile(
      path.join(attempts, `${attemptId}-plan.json`),
      JSON.stringify({
        attempt: { id: attemptId, kind: "plan", mutable: false },
        status: "completed",
        usage: null
      }),
      "utf8"
    );
    await writeFile(
      path.join(attempts, `${attemptId}.context.json`),
      "{malformed secret@example.com",
      "utf8"
    );
    const stdout: string[] = [];
    const stderr: string[] = [];

    await assert.rejects(
      executeContextReport(root, ["--json"], {
        stdout: (value) => stdout.push(value),
        stderr: (value) => stderr.push(value)
      }),
      (error: unknown) => {
        assert.ok(error instanceof BanzaiError);
        assert.equal(error.code, "INVALID_CONTEXT_EVIDENCE");
        assert.doesNotMatch(error.message, /example\.com/);
        return true;
      }
    );
    assert.deepEqual(stdout, []);
    assert.deepEqual(stderr, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("hostile discovered run names never reach context CLI output or diagnostics", async () => {
  const root = await createEvaluationRoot();
  try {
    const canary = "private@example.com";
    await mkdir(path.join(root, ".banzai", "runs", canary));
    const stdout: string[] = [];
    const stderr: string[] = [];
    await assert.rejects(
      executeContextReport(root, ["--json"], {
        stdout: (value) => stdout.push(value),
        stderr: (value) => stderr.push(value)
      }),
      (error: unknown) => {
        assert.ok(error instanceof BanzaiError);
        assert.equal(error.code, "EVAL_READ_FAILED");
        assert.doesNotMatch(error.message, /private@example\.com/);
        return true;
      }
    );
    assert.deepEqual(stdout, []);
    assert.deepEqual(stderr, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("context CLI rejects a symlinked attempts directory with empty output and no mutation", async () => {
  const root = await createEvaluationRoot();
  try {
    const runId = "cli-symlinked-attempts";
    const attemptId = `${runId}-plan-1`;
    const runsDirectory = path.join(root, ".banzai", "runs");
    const runDirectory = path.join(runsDirectory, runId);
    const canary = "private@example.com";
    const externalDirectory = path.join(root, `external-attempts-${canary}`);
    await mkdir(runDirectory, { recursive: true });
    await mkdir(externalDirectory);
    await writeFile(
      path.join(runDirectory, "state.json"),
      JSON.stringify({
        runId,
        createdAt: "2026-08-23T00:00:00.000Z",
        workflowSelection: { workflow: "strict" }
      }),
      "utf8"
    );
    const canonicalFile = path.join(
      externalDirectory,
      `${attemptId}-plan.json`
    );
    await writeFile(
      canonicalFile,
      JSON.stringify({
        attempt: { id: attemptId, kind: "plan", mutable: false },
        status: "completed",
        usage: null,
        externalCanary: canary
      }),
      "utf8"
    );
    await symlink(externalDirectory, path.join(runDirectory, "attempts"));
    const beforeTree = await snapshotTree(runsDirectory);
    const beforeCanonical = await readFile(canonicalFile, "utf8");

    for (const args of [[], ["--json"]] as string[][]) {
      const stdout: string[] = [];
      const stderr: string[] = [];
      await assert.rejects(
        executeContextReport(root, args, {
          stdout: (value) => stdout.push(value),
          stderr: (value) => stderr.push(value)
        }),
        (error: unknown) => {
          assert.ok(error instanceof BanzaiError);
          assert.equal(error.code, "EVAL_READ_FAILED");
          assert.doesNotMatch(error.message, /private@example\.com/);
          return true;
        }
      );
      assert.deepEqual(stdout, []);
      assert.deepEqual(stderr, []);
    }
    assert.deepEqual(await snapshotTree(runsDirectory), beforeTree);
    assert.equal(await readFile(canonicalFile, "utf8"), beforeCanonical);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
