import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { runInteractive, type InteractiveIO } from "../src/interactive.js";
import { taskVerificationStatusLines } from "../src/verification-ui.js";
import { RunStore } from "../src/store.js";
import { WorkflowRunner } from "../src/workflow.js";
import type { PhaseResult, RunState, VendorAdapters } from "../src/types.js";
import { createTestRepository } from "./helpers.js";

const exec = promisify(execFile);
type Scenario =
  | "timeout"
  | "interrupted"
  | "prelaunch"
  | "missing"
  | "failed"
  | "passed"
  | "absent";
async function fixture(mode: Scenario) {
  const repository = await createTestRepository({ artifactLayout: "private" });
  let phases = 0;
  const wrap = <T>(result: T) => ({
    result,
    sessionId: null,
    stdout: "",
    stderr: "",
    usage: null
  });
  const adapters: VendorAdapters = {
    runPlanningReview: async () => {
      throw new Error("Unexpected planning review");
    },
    runPlanningAnalysis: async () => {
      throw new Error("Unexpected planning analysis");
    },
    preflightCodex: async () => {},
    preflightClaude: async () => {},
    runSelection: async () =>
      wrap({
        contractVersion: "1.0.0",
        recommendedWorkflow: "feature",
        confidence: "high",
        reason: "Verify local behavior.",
        escalationTriggers: []
      }),
    runReview: async () => {
      throw new Error("Unexpected lite review.");
    },
    runPhase: async (request) => {
      phases++;
      const state = JSON.parse(
        await readFile(path.join(request.runDirectory, "state.json"), "utf8")
      ) as RunState;
      const work = state.artifactBinding?.binding.artifacts.work;
      assert.ok(work);
      await writeFile(
        path.join(repository.root, work),
        "# Work\nVerify the requested local behavior.\n"
      );
      await writeFile(
        path.join(repository.root, "check.cjs"),
        `const fs = require('node:fs');\nif (!fs.existsSync('.banzai/check-started')) { fs.writeFileSync('.banzai/check-started', '1'); ${mode === "timeout" ? "setInterval(() => {}, 1000);" : mode === "interrupted" ? "process.kill(process.pid, 'SIGTERM');" : mode === "failed" ? "process.exit(7);" : ""} }\n`
      );
      const result: PhaseResult = {
        schemaVersion: 4,
        contractVersion: "1.0.0",
        phase: "implementation",
        outcome: "completed",
        gate: null,
        summary: "Implemented.",
        artifacts: {
          description: null,
          plan: null,
          adrs: [],
          implementationReport: work,
          testReport: null
        },
        taskCompletion: null,
        touchedPaths: ["check.cjs"],
        questions: [],
        decisionConsultation: null,
        resolvedFindingIds: [],
        requestedVerification: [],
        verificationCandidates: {
          checks:
            mode === "absent"
              ? []
              : [
                  {
                    id: "check",
                    name: "Check local behavior",
                    requirementRefs: ["request"],
                    command:
                      mode === "missing"
                        ? "banzai-nonexistent-executable-123"
                        : process.execPath,
                    args:
                      mode === "prelaunch"
                        ? ["-e", "process.exit(0)"]
                        : mode === "missing"
                          ? []
                          : ["check.cjs"],
                    cwd: mode === "prelaunch" ? "checks" : ".",
                    timeoutMs: mode === "timeout" ? 200 : 3000,
                    evidence: "fresh",
                    sources: [],
                    materialization: null
                  }
                ],
          absenceReason:
            mode === "absent"
              ? "The requested inspection needs no automated check."
              : null
        }
      };
      await request.onTerminalSuccess?.({
        classification: "codex_turn_completed",
        observedAt: new Date().toISOString(),
        result,
        sessionId: null,
        usage: null
      });
      return wrap(result);
    }
  };
  const runner = new WorkflowRunner(repository.root, adapters);
  return { repository, runner, phases: () => phases };
}
for (const mode of ["timeout", "interrupted", "prelaunch"] as const) {
  test(`task verification retries ${mode} without replaying implementation`, async () => {
    const f = await fixture(mode);
    try {
      const blocked = await f.runner.start({
        slug: "recovery",
        request: "Verify local behavior."
      });
      assert.equal(blocked.status, "blocked");
      if (mode !== "prelaunch")
        assert.equal(
          blocked.taskVerification?.applicability.dispositions[0]?.kind,
          mode === "timeout" ? "timed_out" : "interrupted"
        );
      const status = await f.runner.status();
      assert.equal(status.retry.eligible, true, status.retry.reason);
      assert.equal(status.nextAction, "banzai retry");
      if (mode === "prelaunch")
        await mkdir(path.join(f.repository.root, "checks"));
      const done = await f.runner.retry();
      assert.equal(done.status, "done", done.blockReason ?? undefined);
      assert.equal(f.phases(), 1);
      const attempts = done.taskVerification?.attempts;
      assert.ok(attempts);
      assert.equal(attempts.length, mode === "prelaunch" ? 1 : 2);
      if (mode !== "prelaunch") {
        assert.equal(attempts[1]?.retryOf, attempts[0]?.id);
        assert.notEqual(attempts[0]?.status, "completed");
      }
    } finally {
      await f.repository.dispose();
    }
  });
}
for (const mode of [
  "timeout",
  "interrupted",
  "missing",
  "failed",
  "passed",
  "absent"
] as const) {
  test(`task status exposes ${mode} after execution`, async () => {
    const f = await fixture(mode);
    try {
      const state = await f.runner.start({
        slug: "status",
        request: "Verify local behavior."
      });
      const expected =
        mode === "timeout"
          ? "timed out"
          : mode === "missing"
            ? "unavailable"
            : mode;
      if (mode === "missing")
        assert.equal(
          state.taskVerification?.applicability.dispositions[0]?.kind,
          "unavailable"
        );
      const status = await exec(
        process.execPath,
        [path.resolve("dist/banzai.mjs"), "status"],
        { cwd: f.repository.root }
      );
      assert.ok(
        status.stdout.includes(`Verification: ${expected}`),
        status.stdout
      );
      const control = await exec(
        process.execPath,
        [path.resolve("dist/banzai.mjs"), "control", "status"],
        { cwd: f.repository.root }
      );
      const projected = JSON.parse(control.stdout) as {
        activeRun: {
          taskVerification: { outcome: string; checks: { kind: string }[] };
        };
      };
      if (mode === "absent")
        assert.equal(projected.activeRun.taskVerification.outcome, "absent");
      else
        assert.equal(
          projected.activeRun.taskVerification.checks[0]?.kind,
          expected.replaceAll(" ", "_")
        );
      const lines: string[] = [];
      const io: InteractiveIO = {
        multiSelect: async () => {
          throw new Error("Unexpected multi-select");
        },
        input: async () => {
          throw new Error("Unexpected input");
        },
        confirm: async () => false,
        select: async <T>(
          _message: string,
          choices: readonly { value: T }[]
        ) => {
          const choice = choices.find((item) => item.value === "exit");
          assert.ok(choice);
          return choice.value;
        },
        writeLine: (line = "") => {
          lines.push(line);
        }
      };
      await runInteractive(f.runner, io, { decidedBy: "human" });
      assert.ok(lines.includes(`Verification: ${expected}`), lines.join("\n"));
      const unverified = { ...state, status: "implementing" as const };
      delete unverified.taskVerification;
      assert.deepEqual(taskVerificationStatusLines(unverified), [
        "Verification: not run"
      ]);
    } finally {
      await f.repository.dispose();
    }
  });
}

test("task verification retry preserves live-process and policy refusal boundaries", async () => {
  const f = await fixture("prelaunch");
  try {
    const state = await f.runner.start({
      slug: "restricted-retry",
      request: "Verify local behavior."
    });
    const store = new RunStore(f.repository.root);
    state.activeProcess = {
      kind: "verification",
      pid: process.pid,
      startedAt: new Date().toISOString()
    };
    await store.writeState(state);
    assert.equal((await f.runner.status()).retry.eligible, false);
    await assert.rejects(f.runner.retry(), /still active/);
    state.activeProcess = null;
    await store.writeState(state);
    await mkdir(path.join(f.repository.root, "checks"));
    const configPath = path.join(f.repository.root, ".banzai/config.json");
    const original = await readFile(configPath, "utf8");
    const config = JSON.parse(original) as Record<string, unknown>;
    await writeFile(
      configPath,
      JSON.stringify({
        ...config,
        schemaVersion: 4,
        verification: {
          policy: {
            schema: "banzai-task-verification-policy/v1",
            schemaVersion: 1,
            required: [],
            denied: [{ command: process.execPath, args: null, cwd: null }],
            limits: {
              timeoutMs: 86400000,
              workingDirectories: ["."],
              requiredContext: "inherited-local"
            },
            reuse: null
          }
        }
      })
    );
    const denied = await f.runner.retry();
    assert.equal(denied.status, "blocked");
    assert.match(denied.blockReason ?? "", /prohibited/);
    assert.equal(denied.metrics.attempts.verification, 0);
    assert.equal(f.phases(), 1);
    await writeFile(configPath, original);
    assert.equal((await f.runner.retry()).status, "done");
    assert.equal(f.phases(), 1);
  } finally {
    await f.repository.dispose();
  }
});

test("explicit verification retry reconciles an uncertain physical start without replay", async () => {
  const f = await fixture("interrupted");
  try {
    const state = await f.runner.start({
      slug: "uncertain",
      request: "Verify local behavior."
    });
    const attempt = state.taskVerification?.attempts[0];
    const directory =
      state.artifactBinding?.binding.artifacts.verificationDirectory;
    assert.ok(attempt && directory);
    const stem = `${String(attempt.sequence).padStart(6, "0")}-${attempt.id}`;
    // Simulate a lost terminal publication, retaining the real physical start.
    await rm(
      path.join(f.repository.root, directory, "attempts", `${stem}.finish.json`)
    );
    await rm(
      path.join(
        f.repository.root,
        directory,
        "origins",
        `${attempt.id}.finish.json`
      )
    );
    delete state.taskVerification;
    await new RunStore(f.repository.root).writeState(state);
    assert.equal((await f.runner.status()).retry.eligible, true);
    const done = await f.runner.retry();
    assert.equal(done.status, "done", done.blockReason ?? undefined);
    assert.equal(f.phases(), 1);
    assert.equal(done.taskVerification?.attempts.length, 2);
    const recovered = done.taskVerification.attempts[0];
    assert.equal(recovered?.status, "interrupted");
    assert.equal(recovered.exitCode, null);
    assert.equal(recovered.durationMs, null);
    assert.equal(done.taskVerification.attempts[1]?.retryOf, attempt.id);
  } finally {
    await f.repository.dispose();
  }
});
