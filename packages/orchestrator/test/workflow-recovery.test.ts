import assert from "node:assert/strict";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { BanzaiError, ProcessExitError } from "../src/errors.js";
import { parsePublishedCompletionRegion } from "../src/plan-task-completion.js";
import { transitionState } from "../src/state-machine.js";
import { phaseResultEnvelopeOf } from "../src/validation.js";
import {
  CONTRACT_VERSION,
  type AdapterResult,
  type AttemptRecord,
  type ModelUsage,
  type OrchestratorConfig,
  type PhaseAdapterRequest,
  type PhaseResult
} from "../src/types.js";
import { WorkflowRunner } from "../src/workflow.js";
import { createTestRepository } from "./helpers.js";
import {
  FakeAdapters,
  authorizedImplementationRecoveryFixture,
  boundFixturePath,
  completionLedger,
  finding,
  passingReview,
  phaseResult,
  planPath,
  prerequisiteBlockedFixFixture
} from "./workflow-fixtures.js";

/**
 * Rewrites a protocol attempt's result together with its retained envelope so
 * the record stays internally consistent; the reader rejects either alone.
 */
function withProtocolResult(
  record: AttemptRecord,
  result: PhaseResult
): AttemptRecord {
  const envelope = phaseResultEnvelopeOf(result);
  record.result = JSON.parse(envelope.original) as PhaseResult;
  record.envelope = envelope;
  return record;
}

for (const artifactLayout of ["legacy", "private"] as const)
  test(`resume promotes a durable terminal checkpoint after parent interruption without another model call (${artifactLayout})`, async () => {
    const repository = await createTestRepository({ artifactLayout });
    try {
      const adapters = new FakeAdapters();
      adapters.emitImplementationTerminalCheckpoint = true;
      adapters.failImplementationAfterTerminalCheckpoint = true;
      adapters.reviewResults.push(passingReview());
      const runner = new WorkflowRunner(repository.root, adapters);
      await runner.start({ slug: "example", request: "Implement it." });

      const blocked = await runner.approvePlan("human");
      assert.equal(blocked.status, "blocked");
      const attempt = blocked.activeAttempt;
      assert.ok(attempt);
      assert.equal(attempt.kind, "implementation");
      const failed = await runner.store.readRunAttempt(blocked.runId, attempt);
      assert.equal(failed.status, "failed");
      assert.ok(
        await runner.store.readTerminalCheckpointIfExists(
          blocked.runId,
          attempt
        ),
        failed.error ?? blocked.blockReason ?? "checkpoint missing"
      );
      const promptsBeforeResume = adapters.phasePrompts.length;

      const status = await runner.status();
      assert.equal(status.recovery.terminalCheckpointPresent, true);
      assert.equal(status.recovery.eligible, false);
      assert.equal(status.nextAction, "banzai resume");

      const done = await runner.resume();
      assert.equal(done.status, "done", done.blockReason ?? "");
      assert.equal(adapters.phasePrompts.length, promptsBeforeResume);
      assert.equal(
        done.metrics.completedAttemptIds.filter((id) => id === attempt.id)
          .length,
        1
      );
      const promoted = await runner.store.readRunAttempt(done.runId, attempt);
      assert.equal(promoted.status, "completed");
      assert.equal(promoted.error, null);
      assert.equal(promoted.failureCode, null);

      const repeated = await runner.resume();
      assert.equal(repeated.status, "done");
      assert.equal(adapters.phasePrompts.length, promptsBeforeResume);
      assert.equal(
        repeated.metrics.completedAttemptIds.filter((id) => id === attempt.id)
          .length,
        1
      );
    } finally {
      await repository.dispose();
    }
  });

test("resume rejects a terminal implementation checkpoint with an invalid task ledger before completion accounting", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new FakeAdapters();
    adapters.implementationResults.push(
      phaseResult("implementation", { taskCompletion: null })
    );
    adapters.emitImplementationTerminalCheckpoint = true;
    adapters.failImplementationAfterTerminalCheckpoint = true;
    adapters.implementationTerminalUsage = {
      inputTokens: 101,
      cachedInputTokens: 11,
      outputTokens: 13,
      costUsd: 1.25
    };
    const runner = new WorkflowRunner(repository.root, adapters);
    await runner.start({ slug: "example", request: "Implement it." });
    const blocked = await runner.approvePlan("human");
    const attempt = blocked.activeAttempt;
    assert.ok(attempt);
    const metricsBefore = structuredClone(blocked.metrics);
    const promptsBefore = adapters.phasePrompts.length;
    const resumed = await runner.resume();

    // The proven terminal result is reconciled and its usage accounted, but
    // the missing ledger is a final input rejection: no completion, no
    // verification, no review and no replay.
    assert.equal(resumed.status, "blocked");
    assert.match(resumed.blockReason ?? "", /PLAN_TASK_COMPLETION_INVALID/);
    assert.match(resumed.blockReason ?? "", /missing taskCompletion/);
    assert.equal(adapters.phasePrompts.length, promptsBefore);
    assert.deepEqual(
      resumed.metrics.completedAttemptIds,
      metricsBefore.completedAttemptIds
    );
    assert.equal(resumed.metrics.usage.inputTokens, 101);
    assert.equal(resumed.metrics.usage.costUsd, 1.25);
    assert.equal(resumed.verification.length, 0);
    assert.equal(adapters.reviewPrompts.length, 0);
    assert.equal(resumed.planTaskCompletion?.status, "invalid");
    assert.equal(resumed.planTaskCompletion.violation, "missing_ledger");
    const record = await runner.store.readRunAttempt(resumed.runId, attempt);
    assert.equal(record.status, "failed");
    assert.equal(record.failureCode, "PLAN_TASK_COMPLETION_INVALID");
    const status = await runner.status();
    assert.equal(status.retry.eligible, true);
    assert.equal(status.nextAction, "banzai retry");
  } finally {
    await repository.dispose();
  }
});

test("resume rejects a terminal checkpoint whose phase does not match its attempt", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new FakeAdapters();
    adapters.implementationResults.push(phaseResult("plan"));
    adapters.emitImplementationTerminalCheckpoint = true;
    adapters.failImplementationAfterTerminalCheckpoint = true;
    const runner = new WorkflowRunner(repository.root, adapters);
    await runner.start({ slug: "example", request: "Implement it." });
    const blocked = await runner.approvePlan("human");
    const attempt = blocked.activeAttempt;
    assert.ok(attempt);
    const completedBefore = [...blocked.metrics.completedAttemptIds];

    // Under the completion protocol the mismatch is refused when the terminal
    // proof is written, so no checkpoint exists to replay on resume.
    const resumed = await runner.resume();
    assert.equal(resumed.status, "blocked");
    assert.match(
      resumed.blockReason ?? "",
      /envelope phase must match attempt kind/
    );
    assert.deepEqual(resumed.metrics.completedAttemptIds, completedBefore);
    assert.equal(
      (await runner.store.readRunAttempt(resumed.runId, attempt)).status,
      "failed"
    );
  } finally {
    await repository.dispose();
  }
});

test("resume republishes a proven fix checkpoint's refreshed ledger without another model call", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new FakeAdapters();
    adapters.reviewResults.push({
      contractVersion: CONTRACT_VERSION,
      verdict: "changes_requested",
      summary: "One finding.",
      findings: [finding("R1-F1", "Defect.")],
      reviewedFindingIds: [],
      deferredCoverage: []
    });
    const refreshed = completionLedger(["T001"]);
    adapters.fixResults.push(
      phaseResult("fix", {
        taskCompletion: refreshed,
        resolvedFindingIds: ["R1-F1"]
      })
    );
    adapters.emitFixTerminalCheckpoint = true;
    adapters.failFixAfterTerminalCheckpoint = true;
    adapters.fixTerminalUsage = {
      inputTokens: 71,
      cachedInputTokens: 7,
      outputTokens: 9,
      costUsd: null
    };
    const runner = new WorkflowRunner(repository.root, adapters);
    await runner.start({ slug: "example", request: "Implement it." });
    const triage = await runner.approvePlan("human");
    assert.equal(triage.status, "needs_triage");
    const blocked = await runner.triage({
      accepted: ["R1-F1"],
      rejected: [],
      deferred: [],
      note: null,
      decidedBy: "human"
    });
    assert.equal(blocked.status, "blocked");
    assert.equal(blocked.blockedFrom, "fixing");
    const attempt = blocked.activeAttempt;
    assert.ok(attempt?.kind === "fix");
    const implementationCompletion = blocked.planTaskCompletion;
    assert.ok(implementationCompletion?.status === "valid");
    const usageBefore = blocked.metrics.usage.inputTokens;
    const promptsBefore = adapters.phasePrompts.length;

    // The proven terminal result is the model's whole contribution: the
    // runner renders the refreshed ledger and continues to review itself.
    adapters.reviewResults.push(passingReview(["R1-F1"]));
    const done = await runner.resume();
    assert.equal(done.status, "done", done.blockReason ?? "");
    assert.equal(adapters.phasePrompts.length, promptsBefore);
    assert.equal(done.metrics.usage.inputTokens, usageBefore + 71);
    const record = await runner.store.readRunAttempt(done.runId, attempt);
    assert.equal(record.status, "completed");
    assert.equal(record.schemaVersion, 4);
    const completion = done.planTaskCompletion;
    assert.ok(completion?.status === "valid");
    assert.equal(completion.schemaVersion, 2);
    assert.equal(completion.sourceAttemptKind, "fix");
    assert.equal(completion.sourceAttemptId, attempt.id);
    assert.equal(completion.publisherAttemptId, attempt.id);
    assert.notEqual(
      completion.ledgerDigest,
      implementationCompletion.ledgerDigest
    );
    const report = await readFile(
      await boundFixturePath(
        repository.root,
        "documentation/work/example/implementation-report.md"
      )
    );
    assert.deepEqual(parsePublishedCompletionRegion(report), refreshed);
  } finally {
    await repository.dispose();
  }
});

test("resume does not complete a review checkpoint before candidate validation", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new FakeAdapters();
    adapters.reviewResults.push(passingReview());
    adapters.emitReviewTerminalCheckpoint = true;
    adapters.failReviewAfterTerminalCheckpoint = true;
    const runner = new WorkflowRunner(repository.root, adapters);
    await runner.start({ slug: "example", request: "Implement it." });
    const blocked = await runner.approvePlan("human");
    assert.equal(blocked.status, "blocked");
    const attempt = blocked.activeAttempt;
    assert.ok(attempt);
    assert.equal(attempt.kind, "review");
    const metricsBefore = structuredClone(blocked.metrics);

    await writeFile(
      runner.store.reviewCandidatePath(blocked.runId, attempt),
      "Corrupt candidate.\n",
      "utf8"
    );
    const resumed = await runner.resume();
    assert.equal(resumed.status, "blocked");
    assert.match(
      resumed.blockReason ?? "",
      /deterministic snapshot projection/i
    );
    assert.deepEqual(resumed.metrics, metricsBefore);
    const record = await runner.store.readRunAttempt(resumed.runId, attempt);
    assert.equal(record.status, "failed");
  } finally {
    await repository.dispose();
  }
});

class PlanningContinuityAdapters extends FakeAdapters {
  announceSession = true;
  checkpoint = false;
  failureCode = "PROCESS_TIMEOUT";
  failed = false;
  readonly planningUsage: ModelUsage = {
    inputTokens: 100,
    cachedInputTokens: 60,
    outputTokens: 5,
    costUsd: null
  };

  async runPhase(
    request: PhaseAdapterRequest
  ): Promise<AdapterResult<PhaseResult>> {
    if (!request.prompt.includes("Phase: plan"))
      return await super.runPhase(request);
    if (this.announceSession) {
      await request.onSessionStarted?.("planner-session");
      const record = JSON.parse(
        await readFile(
          path.join(
            request.runDirectory,
            "attempts",
            `${request.attemptId}-plan.json`
          ),
          "utf8"
        )
      ) as AttemptRecord;
      assert.equal(record.status, "started");
      assert.equal(record.sessionId, "planner-session");
      assert.equal(record.result, null);
    }
    const result = await super.runPhase(request);
    if (this.failed) return result;
    this.failed = true;
    if (this.checkpoint)
      await request.onTerminalSuccess?.({
        classification: "codex_turn_completed",
        observedAt: new Date().toISOString(),
        result: result.result,
        sessionId: "planner-session",
        usage: this.planningUsage
      });
    throw new ProcessExitError(
      this.failureCode,
      "Planning stopped after writing its artifacts.",
      {
        exitCode: 1,
        signal: null,
        stdout:
          '{"type":"thread.started","thread_id":"planner-session","password":"private-fixture"}\n',
        stderr: "Captured diagnostic.",
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString()
      },
      {
        failureCause:
          this.failureCode === "PROCESS_TIMEOUT" ? "timeout" : "unclassified",
        usage: this.planningUsage
      }
    );
  }
}

test("planning retry resumes the early saved session and preserves failed evidence", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new PlanningContinuityAdapters();
    const runner = new WorkflowRunner(repository.root, adapters);
    const blocked = await runner.start({
      slug: "example",
      request: "Plan the fixture."
    });
    assert.equal(blocked.status, "blocked");
    assert.equal(blocked.sessions.planner, null);
    assert.ok(blocked.activeAttempt);
    const source = await runner.store.readRunAttempt(
      blocked.runId,
      blocked.activeAttempt
    );
    assert.equal(source.sessionId, "planner-session");
    assert.ok(source.planningContext?.workspaceDigest);
    assert.ok(
      source.planningContext.artifactPaths.includes(
        blocked.planArtifacts?.plan ??
          path.relative(
            repository.root,
            await boundFixturePath(repository.root, planPath)
          )
      )
    );
    assert.deepEqual(blocked.metrics.usage, adapters.planningUsage);
    assert.ok(!blocked.metrics.completedAttemptIds.includes(source.attempt.id));
    assert.ok(source.rawStdoutPath);
    assert.doesNotMatch(
      await readFile(
        path.join(
          runner.store.runDirectory(blocked.runId),
          source.rawStdoutPath
        ),
        "utf8"
      ),
      /private-fixture/
    );

    // A new runner proves reuse comes from durable evidence, not process memory.
    const resumedRunner = new WorkflowRunner(repository.root, adapters);
    const planned = await resumedRunner.retry();
    assert.equal(planned.status, "needs_plan_approval");
    assert.equal(planned.planApproval, null);
    assert.deepEqual(adapters.phaseResumeSessionIds, [null, "planner-session"]);
    assert.match(
      adapters.phasePrompts[1] ?? "",
      /Do not restart repository discovery/
    );
    assert.match(
      adapters.phasePrompts[1] ?? "",
      /Planning stopped after writing its artifacts/
    );
    assert.deepEqual(
      await runner.store.readRunAttempt(blocked.runId, source.attempt),
      source
    );
    const descendant = (await runner.store.readRunAttempts(blocked.runId)).find(
      (record) => record.planningContext?.retryOf === source.attempt.id
    );
    assert.ok(descendant);
    assert.notEqual(descendant.attempt.id, source.attempt.id);
    assert.equal(descendant.sessionMode, "resumed");
    assert.equal(descendant.recoveryOf, null);
    assert.deepEqual(planned.metrics.usage, adapters.planningUsage);
  } finally {
    await repository.dispose();
  }
});

for (const change of [
  "workspace",
  "model",
  "scope",
  "legacy",
  "missing-session",
  "conflict"
] as const) {
  test(`planning retry uses artifacts in a fresh session after ${change}`, async () => {
    const repository = await createTestRepository();
    try {
      const adapters = new PlanningContinuityAdapters();
      if (change === "missing-session") adapters.announceSession = false;
      if (change === "conflict")
        adapters.failureCode = "TERMINAL_RESULT_CONFLICT";
      const runner = new WorkflowRunner(repository.root, adapters);
      const blocked = await runner.start({
        slug: "example",
        request: "Plan the fixture."
      });
      assert.ok(blocked.activeAttempt);
      if (change === "workspace")
        await writeFile(
          path.join(repository.root, "user-change.txt"),
          "New user input.\n"
        );
      if (change === "model" || change === "scope") {
        const configPath = path.join(repository.root, ".banzai/config.json");
        const config = JSON.parse(
          await readFile(configPath, "utf8")
        ) as OrchestratorConfig;
        if (change === "model")
          config.models.planner.model = "different-planner-model";
        else
          config.claudeEnvironment = { mode: "ambient", pluginDirectory: null };
        await writeFile(configPath, JSON.stringify(config));
      }
      if (change === "legacy") {
        const record = await runner.store.readRunAttempt(
          blocked.runId,
          blocked.activeAttempt
        );
        delete record.planningContext;
        await runner.store.writeRunAttempt(blocked.runId, record);
      }
      const planned = await runner.retry();
      assert.equal(planned.status, "needs_plan_approval");
      assert.deepEqual(adapters.phaseResumeSessionIds, [null, null]);
      assert.match(
        adapters.phasePrompts[1] ?? "",
        /Restore context from existing planning artifacts first/
      );
    } finally {
      await repository.dispose();
    }
  });
}

test("planning retry reconciles terminal proof without another model call or double-counted usage", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new PlanningContinuityAdapters();
    adapters.checkpoint = true;
    const runner = new WorkflowRunner(repository.root, adapters);
    const blocked = await runner.start({
      slug: "example",
      request: "Plan the fixture."
    });
    const planned = await runner.retry();
    assert.equal(
      planned.status,
      "needs_plan_approval",
      planned.blockReason ?? undefined
    );
    assert.equal(adapters.phasePrompts.length, 1);
    assert.equal(planned.metrics.attempts.plan, 1);
    assert.deepEqual(planned.metrics.usage, adapters.planningUsage);
    assert.deepEqual((await runner.resume()).metrics, planned.metrics);
    assert.ok(blocked.activeAttempt);
    assert.equal(
      (await runner.store.readRunAttempt(blocked.runId, blocked.activeAttempt))
        .status,
      "completed"
    );
  } finally {
    await repository.dispose();
  }
});

test("planning terminal conflict blocks reconciliation but permits an explicit fresh retry", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new PlanningContinuityAdapters();
    adapters.checkpoint = true;
    adapters.failureCode = "TERMINAL_RESULT_CONFLICT";
    const runner = new WorkflowRunner(repository.root, adapters);
    const sourceState = await runner.start({
      slug: "example",
      request: "Plan the fixture."
    });
    assert.ok(sourceState.activeAttempt);
    const source = await runner.store.readRunAttempt(
      sourceState.runId,
      sourceState.activeAttempt
    );
    const blocked = await runner.resume();
    assert.equal(blocked.status, "blocked");
    assert.match(blocked.blockReason ?? "", /Conflicting terminal/);
    assert.equal(adapters.phasePrompts.length, 1);
    assert.equal((await runner.resume()).status, "blocked");
    const planned = await runner.retry();
    assert.equal(planned.status, "needs_plan_approval");
    assert.deepEqual(adapters.phaseResumeSessionIds, [null, null]);
    assert.deepEqual(
      await runner.store.readRunAttempt(sourceState.runId, source.attempt),
      source
    );
  } finally {
    await repository.dispose();
  }
});

test("planning retry uses a new session when its terminal checkpoint no longer matches the model", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new PlanningContinuityAdapters();
    adapters.checkpoint = true;
    const runner = new WorkflowRunner(repository.root, adapters);
    await runner.start({ slug: "example", request: "Plan the fixture." });
    const configPath = path.join(repository.root, ".banzai/config.json");
    const config = JSON.parse(
      await readFile(configPath, "utf8")
    ) as OrchestratorConfig;
    config.models.planner.model = "different-planner-model";
    await writeFile(configPath, JSON.stringify(config));
    const planned = await runner.retry();
    assert.equal(planned.status, "needs_plan_approval");
    assert.deepEqual(adapters.phaseResumeSessionIds, [null, null]);
    assert.match(
      adapters.phasePrompts[1] ?? "",
      /Terminal checkpoint does not match/
    );
    assert.deepEqual(planned.metrics.usage, adapters.planningUsage);
  } finally {
    await repository.dispose();
  }
});

test("retry starts a distinct planning attempt and retains failed output", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new FakeAdapters();
    adapters.planErrors.push(
      new ProcessExitError(
        "CODEX_PHASE_FAILED",
        "Codex exited 1: Shortcut MCP authorization is required.",
        {
          exitCode: 1,
          signal: null,
          stdout:
            '{"type":"error","message":"Shortcut MCP authorization is required.","api_key":"secret-value"}\n',
          stderr: "Reading additional input from stdin...\n",
          startedAt: "2026-01-01T00:00:00.000Z",
          completedAt: "2026-01-01T00:00:01.000Z"
        }
      )
    );
    const runner = new WorkflowRunner(repository.root, adapters);

    const blocked = await runner.start({
      slug: "example",
      request: "Plan after authentication is restored."
    });
    assert.equal(blocked.status, "blocked");
    assert.equal(blocked.metrics.attempts.plan, 1);
    const failedAttempt = blocked.activeAttempt;
    assert.ok(failedAttempt);

    const failedRecord = await runner.store.readRunAttempt(
      blocked.runId,
      failedAttempt
    );
    assert.equal(failedRecord.status, "failed");
    assert.ok(failedRecord.rawStdoutPath);
    assert.ok(failedRecord.rawStderrPath);
    const retainedStdout = await readFile(
      path.join(
        runner.store.runDirectory(blocked.runId),
        failedRecord.rawStdoutPath
      ),
      "utf8"
    );
    assert.equal(retainedStdout.includes("secret-value"), false);
    assert.match(retainedStdout, /Shortcut MCP authorization is required/);

    const status = await runner.status();
    assert.equal(status.retry.eligible, true);
    assert.equal(status.nextAction, "banzai retry");

    const codexPreflightsBeforeRetry = adapters.codexPreflights;
    const claudePreflightsBeforeRetry = adapters.claudePreflights;
    const planned = await runner.retry();
    assert.equal(planned.status, "needs_plan_approval");
    assert.equal(planned.metrics.attempts.plan, 2);
    assert.ok(adapters.codexPreflights >= codexPreflightsBeforeRetry + 2);
    assert.ok(adapters.claudePreflights >= claudePreflightsBeforeRetry + 1);
    const planAttemptFiles = (
      await readdir(
        path.join(runner.store.runDirectory(blocked.runId), "attempts")
      )
    ).filter((entry) => entry.endsWith("-plan.json"));
    assert.equal(planAttemptFiles.length, 2);

    const preserved = await runner.store.readRunAttempt(
      blocked.runId,
      failedAttempt
    );
    assert.equal(preserved.status, "failed");
  } finally {
    await repository.dispose();
  }
});

test("resume makes an interrupted read-only review explicitly retryable", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new FakeAdapters();
    adapters.reviewErrors.push(new Error("review interrupted"));
    adapters.reviewResults.push(passingReview());
    const runner = new WorkflowRunner(repository.root, adapters);
    await runner.start({ slug: "example", request: "Implement it." });

    const blocked = await runner.approvePlan("human");
    const attempt = blocked.activeAttempt;
    assert.equal(attempt?.kind, "review");
    assert.ok(attempt);
    const record = await runner.store.readRunAttempt(blocked.runId, attempt);
    record.status = "started";
    record.completedAt = null;
    record.error = null;
    await runner.store.writeRunAttempt(blocked.runId, record);
    transitionState(blocked, "reviewing");
    await runner.store.writeState(blocked);

    const reconciled = await runner.resume();
    assert.equal(reconciled.status, "blocked");
    assert.equal(reconciled.blockedFrom, "reviewing");
    assert.equal(reconciled.reviewIteration, 0);
    assert.equal(
      reconciled.pendingReviewRotationReason,
      "previous-review-interrupted"
    );
    assert.match(reconciled.blockReason ?? "", /banzai retry/);
    const status = await runner.status();
    assert.equal(status.retry.eligible, true);
    assert.match(status.retry.reason, /read-only/);
    assert.equal(status.nextAction, "banzai retry");

    const done = await runner.retry();
    assert.equal(done.status, "done", done.blockReason ?? "");
    assert.equal(done.reviewIteration, 1);
    assert.equal(done.latestReview?.iteration, 1);
    assert.equal(done.metrics.attempts.review, 2);
    assert.equal(adapters.reviewPrompts.length, 2);
    assert.deepEqual(adapters.reviewResumeSessionIds, [null, null]);
    assert.equal(
      done.latestReview.rotationReason,
      "previous-review-interrupted"
    );

    const preserved = await runner.store.readRunAttempt(blocked.runId, attempt);
    assert.equal(preserved.status, "started");
  } finally {
    await repository.dispose();
  }
});

test("retry resumes review checks after Claude authentication recovers", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new FakeAdapters();
    adapters.reviewResults.push(passingReview());
    const runner = new WorkflowRunner(repository.root, adapters);
    await runner.start({ slug: "example", request: "Implement it." });
    adapters.claudePreflightErrors.push(
      new Error("Claude subscription authentication is unavailable.")
    );

    const blocked = await runner.approvePlan("human");
    assert.equal(blocked.status, "blocked");
    assert.equal(blocked.blockedFrom, "reviewing");
    assert.equal(blocked.activeAttempt, null);
    assert.equal(blocked.pendingReviewRotationReason, "unreliable-review");
    assert.match(
      blocked.blockReason ?? "",
      /Claude subscription authentication/
    );
    assert.match(
      adapters.phasePrompts[1] ?? "",
      /Approved planning artifacts are immutable/
    );

    const status = await runner.status();
    assert.equal(status.retry.eligible, true);
    assert.equal(status.retry.attemptId, null);
    assert.equal(status.nextAction, "banzai retry");

    const done = await runner.retry();
    assert.equal(done.status, "done", done.blockReason ?? "");
    assert.equal(done.metrics.attempts.review, 1);
    assert.equal(adapters.reviewPrompts.length, 1);
    assert.equal(done.latestReview?.rotationReason, "unreliable-review");
  } finally {
    await repository.dispose();
  }
});

test("retry rejects failed mutable attempts without another model call", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new FakeAdapters();
    adapters.implementationErrors.push(new Error("implementation failed"));
    const runner = new WorkflowRunner(repository.root, adapters);
    await runner.start({ slug: "example", request: "Implement it." });

    const blocked = await runner.approvePlan("human");
    assert.equal(blocked.status, "blocked");
    assert.equal(blocked.activeAttempt?.mutable, true);
    const callsBeforeRetry = adapters.phasePrompts.length;

    const status = await runner.status();
    assert.equal(status.retry.eligible, false);
    assert.equal(status.nextAction, "banzai cancel");
    await assert.rejects(runner.retry(), /mutable attempts cannot be retried/);
    assert.equal(adapters.phasePrompts.length, callsBeforeRetry);
  } finally {
    await repository.dispose();
  }
});

test("transport-failed mutable implementation offers explicit recovery without weakening retry", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new FakeAdapters();
    adapters.implementationErrors.push(
      new ProcessExitError(
        "CLAUDE_PHASE_FAILED",
        "Claude exited 1: API Error: Server error mid-response.",
        {
          exitCode: 1,
          signal: null,
          stdout: "partial model output\n",
          stderr: "API Error: Server error mid-response.\n",
          startedAt: "2026-01-01T00:00:00.000Z",
          completedAt: "2026-01-01T00:01:00.000Z"
        },
        { failureCause: "transport" }
      )
    );
    adapters.reviewResults.push(passingReview());
    const runner = new WorkflowRunner(repository.root, adapters);
    await runner.start({ slug: "example", request: "Implement it." });

    const blocked = await runner.approvePlan("human");
    assert.equal(blocked.status, "blocked");
    const sourceAttempt = blocked.activeAttempt;
    assert.ok(sourceAttempt);
    assert.equal(sourceAttempt.kind, "implementation");
    const failed = await runner.store.readRunAttempt(
      blocked.runId,
      sourceAttempt
    );
    assert.equal(failed.status, "failed");
    assert.equal(failed.result, null);
    assert.equal(failed.failureCause, "transport");
    const failedLedger = await runner.store.readContextLedgerIfPresent(
      blocked.runId,
      sourceAttempt
    );
    const failedInvocation = failedLedger?.invocations[0];
    assert.ok(failedInvocation);
    assert.equal(failedInvocation.outcome, "failed");
    assert.ok(failedInvocation.runnerPayload.totalBytes > 0);
    assert.equal(
      failedInvocation.vendorUsage.inputTokens.availability,
      "unavailable"
    );

    const status = await runner.status();
    assert.equal(status.retry.eligible, false);
    assert.equal(status.recovery.eligible, true, status.recovery.reason);
    assert.equal(status.nextAction, "banzai recover");
    assert.ok(status.recovery.recoveryIdentity);

    const authorized = await runner.recover(
      {
        attemptId: sourceAttempt.id,
        recoveryIdentity: status.recovery.recoveryIdentity,
        unknownSideEffectsAccepted: true,
        decidedBy: "current-human"
      },
      false
    );
    assert.equal(authorized.recovery?.stage, "authorized");

    const done = await runner.resume();
    assert.equal(done.status, "done", done.blockReason ?? "");
    const interrupted = await runner.store.readRunAttempt(
      done.runId,
      sourceAttempt
    );
    assert.equal(interrupted.status, "interrupted");
    assert.equal(interrupted.failureCause, "transport");
    assert.match(interrupted.error ?? "", /Server error mid-response/);
    const preservedLedger = await runner.store.readContextLedgerIfPresent(
      done.runId,
      sourceAttempt
    );
    assert.deepEqual(preservedLedger, failedLedger);
    const recoveryRecord = (
      await runner.store.readRunAttempts(done.runId)
    ).find((record) => record.recoveryOf === sourceAttempt.id);
    assert.ok(recoveryRecord);
    const recoveryLedger = await runner.store.readContextLedgerIfPresent(
      done.runId,
      recoveryRecord.attempt
    );
    const recoveryInvocation = recoveryLedger?.invocations[0];
    assert.ok(recoveryInvocation);
    assert.equal(recoveryInvocation.sessionMode, "resumed");
    assert.equal(recoveryInvocation.outcome, "completed");
    assert.ok(recoveryInvocation.runnerPayload.totalBytes > 0);
  } finally {
    await repository.dispose();
  }
});

test("explicit recovery preserves the interrupted attempt and creates one linked implementation", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new FakeAdapters();
    adapters.implementationErrors.push(new Error("implementation interrupted"));
    adapters.reviewResults.push(passingReview());
    const runner = new WorkflowRunner(repository.root, adapters);
    await runner.start({ slug: "example", request: "Implement it." });
    const blocked = await runner.approvePlan("human");
    const sourceAttempt = blocked.activeAttempt;
    assert.ok(sourceAttempt);
    assert.equal(sourceAttempt.kind, "implementation");
    const sourceRecord = await runner.store.readRunAttempt(
      blocked.runId,
      sourceAttempt
    );
    sourceRecord.status = "started";
    sourceRecord.schemaVersion = 1;
    sourceRecord.completedAt = null;
    sourceRecord.durationMs = null;
    sourceRecord.error = null;
    sourceRecord.failureCode = null;
    delete sourceRecord.interruptedAt;
    delete sourceRecord.recoveryOf;
    delete sourceRecord.recoveryAuthorizationId;
    // A schema-1 record predates the completion protocol fields.
    delete sourceRecord.completionProtocol;
    delete sourceRecord.retryOf;
    delete sourceRecord.envelope;
    delete sourceRecord.completionDiagnostic;
    await runner.store.writeRunAttempt(blocked.runId, sourceRecord);

    const status = await runner.status();
    assert.equal(status.retry.eligible, false);
    assert.equal(status.recovery.eligible, true, status.recovery.reason);
    assert.equal(status.nextAction, "banzai recover");
    assert.ok(status.recovery.recoveryIdentity);
    const callsBeforeAuthorization = adapters.phasePrompts.length;

    const authorized = await runner.recover(
      {
        attemptId: sourceAttempt.id,
        recoveryIdentity: status.recovery.recoveryIdentity,
        unknownSideEffectsAccepted: true,
        decidedBy: "current-human"
      },
      false
    );
    assert.equal(authorized.status, "blocked");
    assert.equal(adapters.phasePrompts.length, callsBeforeAuthorization);
    assert.equal(authorized.recovery?.sourceAttemptId, sourceAttempt.id);
    assert.equal(authorized.recovery.recoveryAttemptId, null);
    assert.equal(authorized.recovery.stage, "authorized");

    const done = await runner.resume();
    assert.equal(done.status, "done", done.blockReason ?? "");
    const recoveryAttemptId = done.recovery?.recoveryAttemptId;
    assert.ok(recoveryAttemptId);
    assert.equal(done.recovery?.stage, "attempt_started");
    assert.notEqual(recoveryAttemptId, sourceAttempt.id);
    const interrupted = await runner.store.readRunAttempt(
      done.runId,
      sourceAttempt
    );
    assert.equal(interrupted.status, "interrupted");
    assert.ok(interrupted.interruptedAt);
    const recoveryAttempt = await runner.store.readRunAttempt(done.runId, {
      id: recoveryAttemptId,
      kind: "implementation",
      mutable: true
    });
    assert.equal(recoveryAttempt.status, "completed");
    assert.equal(recoveryAttempt.recoveryOf, sourceAttempt.id);
    assert.equal(
      recoveryAttempt.recoveryAuthorizationId,
      done.recovery.authorizationId
    );
    assert.match(
      adapters.phasePrompts.at(-1) ?? "",
      /inspect the current checkout/i
    );
    assert.match(
      adapters.phasePrompts.at(-1) ?? "",
      new RegExp(sourceAttempt.id)
    );
    assert.equal(
      done.metrics.completedAttemptIds.filter((id) => id === recoveryAttemptId)
        .length,
      1
    );
  } finally {
    await repository.dispose();
  }
});

test("recovery resumes from a persisted interrupted-source stage and reuses one deterministic attempt leaf", async () => {
  const fixture = await authorizedImplementationRecoveryFixture();
  try {
    const { runner, adapters, sourceAttempt, authorized } = fixture;
    const originalWriteState = runner.store.writeState.bind(runner.store);
    let injected = false;
    runner.store.writeState = async (state) => {
      if (!injected && state.recovery?.stage === "attempt_started") {
        injected = true;
        throw new Error("injected before recovery attempt state link");
      }
      await originalWriteState(state);
    };
    const promptsBefore = adapters.phasePrompts.length;
    await assert.rejects(runner.resume(), /injected before recovery attempt/);
    runner.store.writeState = originalWriteState;

    const interruptedStage = await runner.store.readState(authorized.runId);
    assert.equal(interruptedStage.activeAttempt, null);
    assert.equal(interruptedStage.recovery?.stage, "source_interrupted");
    assert.equal(adapters.phasePrompts.length, promptsBefore);
    const recoveryAttemptId = `implementation-recovery-${authorized.recovery?.authorizationId.replace(/^recovery-/u, "")}`;
    const leaf = await runner.store.readRunAttempt(interruptedStage.runId, {
      id: recoveryAttemptId,
      kind: "implementation",
      mutable: true
    });
    assert.equal(leaf.status, "started");
    assert.equal(leaf.recoveryOf, sourceAttempt.id);

    const done = await runner.resume();
    assert.equal(done.status, "done", done.blockReason ?? "");
    assert.equal(done.recovery?.recoveryAttemptId, recoveryAttemptId);
    assert.equal(adapters.phasePrompts.length, promptsBefore + 1);
    assert.equal(
      done.metrics.attempts.implementation,
      authorized.metrics.attempts.implementation + 1
    );
    assert.equal(
      done.metrics.completedAttemptIds.filter((id) => id === recoveryAttemptId)
        .length,
      1
    );
    assert.equal(
      (
        await readdir(
          path.join(
            runner.store.runDirectory(done.runId),
            "recovery-authorizations"
          )
        )
      ).length,
      1
    );
  } finally {
    await fixture.repository.dispose();
  }
});

test("recovery reuses one authorization leaf after a crash before its state link", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new FakeAdapters();
    adapters.implementationErrors.push(new Error("implementation interrupted"));
    const runner = new WorkflowRunner(repository.root, adapters);
    await runner.start({ slug: "example", request: "Implement it." });
    const blocked = await runner.approvePlan("human");
    const sourceAttempt = blocked.activeAttempt;
    assert.ok(sourceAttempt);
    const record = await runner.store.readRunAttempt(
      blocked.runId,
      sourceAttempt
    );
    record.status = "started";
    record.completedAt = null;
    record.durationMs = null;
    record.error = null;
    record.failureCode = null;
    await runner.store.writeRunAttempt(blocked.runId, record);
    const status = await runner.status();
    assert.ok(status.recovery.recoveryIdentity);
    const input = {
      attemptId: sourceAttempt.id,
      recoveryIdentity: status.recovery.recoveryIdentity,
      unknownSideEffectsAccepted: true as const,
      decidedBy: "first-human"
    };
    const originalWriteState = runner.store.writeState.bind(runner.store);
    runner.store.writeState = async (state) => {
      if (state.recovery?.stage === "authorized") {
        throw new Error("injected before authorization state link");
      }
      await originalWriteState(state);
    };
    await assert.rejects(
      runner.recover(input, false),
      /injected before authorization state link/
    );
    runner.store.writeState = originalWriteState;

    const authorizationDirectory = path.join(
      runner.store.runDirectory(blocked.runId),
      "recovery-authorizations"
    );
    assert.equal((await readdir(authorizationDirectory)).length, 1);
    const authorized = await runner.recover(
      { ...input, decidedBy: "second-human" },
      false
    );
    assert.ok(authorized.recovery);
    assert.equal(authorized.recovery.stage, "authorized");
    assert.equal((await readdir(authorizationDirectory)).length, 1);
    const persisted = await runner.store.readRecoveryAuthorization(
      authorized.runId,
      authorized.recovery.authorizationId
    );
    assert.equal(persisted.decidedBy, "first-human");
  } finally {
    await repository.dispose();
  }
});

test("recovery crash after the attempt state link never starts another model call", async () => {
  const fixture = await authorizedImplementationRecoveryFixture();
  try {
    const { runner, adapters, authorized } = fixture;
    const originalWriteState = runner.store.writeState.bind(runner.store);
    let injected = false;
    runner.store.writeState = async (state) => {
      await originalWriteState(state);
      if (!injected && state.recovery?.stage === "attempt_started") {
        injected = true;
        throw new Error("injected after recovery attempt state link");
      }
    };
    const promptsBefore = adapters.phasePrompts.length;
    await assert.rejects(runner.resume(), /injected after recovery attempt/);
    runner.store.writeState = originalWriteState;

    const linked = await runner.store.readState(authorized.runId);
    assert.equal(linked.recovery?.stage, "attempt_started");
    assert.ok(linked.activeAttempt);
    assert.equal(adapters.phasePrompts.length, promptsBefore);
    assert.equal(
      linked.metrics.attempts.implementation,
      authorized.metrics.attempts.implementation + 1
    );

    const blocked = await runner.resume();
    assert.equal(blocked.status, "blocked");
    assert.match(blocked.blockReason ?? "", /interrupted/i);
    assert.equal(adapters.phasePrompts.length, promptsBefore);
    assert.equal(
      blocked.metrics.attempts.implementation,
      linked.metrics.attempts.implementation
    );
    assert.equal(
      (
        await readdir(
          path.join(
            runner.store.runDirectory(blocked.runId),
            "recovery-authorizations"
          )
        )
      ).length,
      1
    );
  } finally {
    await fixture.repository.dispose();
  }
});

test("workspace drift invalidates recovery authorization before any model call", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new FakeAdapters();
    adapters.implementationErrors.push(new Error("implementation interrupted"));
    const runner = new WorkflowRunner(repository.root, adapters);
    await runner.start({ slug: "example", request: "Implement it." });
    const blocked = await runner.approvePlan("human");
    const sourceAttempt = blocked.activeAttempt;
    assert.ok(sourceAttempt);
    const sourceRecord = await runner.store.readRunAttempt(
      blocked.runId,
      sourceAttempt
    );
    sourceRecord.status = "started";
    sourceRecord.completedAt = null;
    sourceRecord.durationMs = null;
    sourceRecord.error = null;
    sourceRecord.failureCode = null;
    await runner.store.writeRunAttempt(blocked.runId, sourceRecord);
    const status = await runner.status();
    assert.ok(status.recovery.recoveryIdentity);
    await runner.recover(
      {
        attemptId: sourceAttempt.id,
        recoveryIdentity: status.recovery.recoveryIdentity,
        unknownSideEffectsAccepted: true,
        decidedBy: "current-human"
      },
      false
    );
    const callsBeforeDrift = adapters.phasePrompts.length;
    await writeFile(
      path.join(repository.root, "src/after-authorization.txt"),
      "drift\n",
      "utf8"
    );

    await assert.rejects(
      runner.resume(),
      (error: unknown) =>
        error instanceof BanzaiError && error.code === "RECOVERY_STALE"
    );
    assert.equal(adapters.phasePrompts.length, callsBeforeDrift);
    const current = await runner.store.readState(blocked.runId);
    assert.equal(current.recovery, null);
    assert.equal(current.activeAttempt?.id, sourceAttempt.id);
    const refreshed = await runner.status();
    assert.equal(refreshed.recovery.eligible, true);
    assert.notEqual(
      refreshed.recovery.recoveryIdentity,
      status.recovery.recoveryIdentity
    );
  } finally {
    await repository.dispose();
  }
});

test("recovery revalidates workspace after vendor preflight before creating an attempt", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new FakeAdapters();
    adapters.implementationErrors.push(new Error("implementation interrupted"));
    const runner = new WorkflowRunner(repository.root, adapters);
    await runner.start({ slug: "example", request: "Implement it." });
    const blocked = await runner.approvePlan("human");
    const sourceAttempt = blocked.activeAttempt;
    assert.ok(sourceAttempt);
    const sourceRecord = await runner.store.readRunAttempt(
      blocked.runId,
      sourceAttempt
    );
    sourceRecord.status = "started";
    sourceRecord.completedAt = null;
    sourceRecord.durationMs = null;
    sourceRecord.error = null;
    sourceRecord.failureCode = null;
    await runner.store.writeRunAttempt(blocked.runId, sourceRecord);
    const status = await runner.status();
    assert.ok(status.recovery.recoveryIdentity);
    await runner.recover(
      {
        attemptId: sourceAttempt.id,
        recoveryIdentity: status.recovery.recoveryIdentity,
        unknownSideEffectsAccepted: true,
        decidedBy: "current-human"
      },
      false
    );
    const promptsBeforeResume = adapters.phasePrompts.length;
    adapters.onCodexPreflight = async () => {
      adapters.onCodexPreflight = null;
      await writeFile(
        path.join(repository.root, "src/preflight-drift.txt"),
        "changed during preflight\n",
        "utf8"
      );
    };

    await assert.rejects(
      runner.resume(),
      (error: unknown) =>
        error instanceof BanzaiError && error.code === "RECOVERY_STALE"
    );
    assert.equal(adapters.phasePrompts.length, promptsBeforeResume);
    const current = await runner.store.readState(blocked.runId);
    assert.equal(current.activeAttempt?.id, sourceAttempt.id);
    assert.equal(current.recovery, null);
    assert.equal(
      await runner.store.readRunAttemptIfExists(blocked.runId, {
        id: `implementation-recovery-${status.recovery.recoveryIdentity.slice(0, 24)}`,
        kind: "implementation",
        mutable: true
      }),
      null
    );
  } finally {
    await repository.dispose();
  }
});

test("malformed terminal checkpoint blocks resume and recovery without another model call", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new FakeAdapters();
    adapters.implementationErrors.push(new Error("implementation interrupted"));
    const runner = new WorkflowRunner(repository.root, adapters);
    await runner.start({ slug: "example", request: "Implement it." });
    const blocked = await runner.approvePlan("human");
    const attempt = blocked.activeAttempt;
    assert.ok(attempt);
    const record = await runner.store.readRunAttempt(blocked.runId, attempt);
    record.status = "started";
    record.completedAt = null;
    record.durationMs = null;
    record.error = null;
    record.failureCode = null;
    await runner.store.writeRunAttempt(blocked.runId, record);
    await writeFile(
      runner.store.terminalCheckpointPath(blocked.runId, attempt),
      '{"schema":"banzai-terminal-attempt-checkpoint/v1","secret":"FORBIDDEN"}\n',
      "utf8"
    );
    const callsBeforeResume = adapters.phasePrompts.length;

    const status = await runner.status();
    assert.equal(status.recovery.eligible, false);
    assert.match(status.recovery.reason, /malformed or conflicting/);
    assert.equal(status.nextAction, "banzai cancel");
    const stillBlocked = await runner.resume();
    assert.equal(stillBlocked.status, "blocked");
    assert.match(stillBlocked.blockReason ?? "", /INVALID_TERMINAL_CHECKPOINT/);
    assert.doesNotMatch(stillBlocked.blockReason ?? "", /FORBIDDEN/);
    assert.equal(adapters.phasePrompts.length, callsBeforeResume);
  } finally {
    await repository.dispose();
  }
});

test("completed prerequisite-blocked fix recovers only remaining accepted findings and preserves its source", async () => {
  const fixture = await prerequisiteBlockedFixFixture();
  try {
    const { runner, adapters, blocked, sourceRecord } = fixture;
    const sourceBefore = JSON.stringify(sourceRecord);
    const completionBefore = JSON.stringify(blocked.planTaskCompletion);
    const status = await runner.status();
    assert.equal(status.retry.eligible, false);
    assert.equal(status.recovery.eligible, true, status.recovery.reason);
    assert.equal(status.taskCompletion.state, "complete");
    assert.equal(
      JSON.stringify(
        (await runner.store.readState(blocked.runId)).planTaskCompletion
      ),
      completionBefore
    );
    assert.equal(status.recovery.sourceKind, "prerequisite_blocked_fix");
    assert.equal(status.recovery.terminalCheckpointPresent, undefined);
    assert.deepEqual(status.recovery.resolvedFindingIds, [
      "R1-F2",
      "R1-F5",
      "R1-F6"
    ]);
    assert.deepEqual(status.recovery.remainingFindingIds, ["R1-F3"]);
    assert.deepEqual(status.recovery.prerequisites, [
      "Run the migration round trip.",
      "Verify the generated schema catalog."
    ]);
    assert.equal(status.nextAction, "banzai recover");
    assert.ok(status.recovery.recoveryIdentity);

    const authorized = await runner.recover(
      {
        attemptId: sourceRecord.attempt.id,
        recoveryIdentity: status.recovery.recoveryIdentity,
        unknownSideEffectsAccepted: true,
        decidedBy: "current-human"
      },
      false
    );
    assert.equal(authorized.recovery?.stage, "authorized");
    assert.equal(
      JSON.stringify(
        await runner.store.readRunAttempt(blocked.runId, sourceRecord.attempt)
      ),
      sourceBefore
    );

    const done = await runner.resume();
    assert.equal(done.status, "done", done.blockReason ?? "");
    assert.equal(done.fixCycle, 1);
    assert.equal(done.metrics.attempts.fix, 2);
    assert.equal(
      JSON.stringify(
        await runner.store.readRunAttempt(done.runId, sourceRecord.attempt)
      ),
      sourceBefore
    );
    const recoveryAttemptId = done.recovery?.recoveryAttemptId;
    assert.ok(recoveryAttemptId);
    const recoveryAttempt = await runner.store.readRunAttempt(done.runId, {
      id: recoveryAttemptId,
      kind: "fix",
      mutable: true
    });
    assert.equal(recoveryAttempt.recoveryOf, sourceRecord.attempt.id);
    assert.equal(recoveryAttempt.status, "completed");
    const prompt = adapters.phasePrompts.at(-1) ?? "";
    assert.match(prompt, /prerequisite-blocked fix recovery/i);
    assert.match(prompt, /Remaining accepted finding IDs/);
    assert.match(prompt, /R1-F3/);
    assert.match(prompt, /Resolved accepted finding IDs \(out of scope\)/);
    const acceptedSection = prompt
      .split("Accepted findings:\n")[1]
      ?.split("\n\n## Operator-authorized")[0];
    assert.ok(acceptedSection);
    assert.equal(acceptedSection.match(/"id":/g)?.length, 1);
    assert.match(acceptedSection, /R1-F3/);
    assert.doesNotMatch(acceptedSection, /R1-F2|R1-F5|R1-F6/);
    assert.doesNotMatch(prompt, /R1-F1|R1-F4/);
  } finally {
    await fixture.repository.dispose();
  }
});

test("prerequisite-blocked recovery resumes one prepared descendant after a crash", async () => {
  const fixture = await prerequisiteBlockedFixFixture();
  try {
    const { runner, adapters, sourceRecord } = fixture;
    const status = await runner.status();
    assert.ok(status.recovery.recoveryIdentity);
    const authorized = await runner.recover(
      {
        attemptId: sourceRecord.attempt.id,
        recoveryIdentity: status.recovery.recoveryIdentity,
        unknownSideEffectsAccepted: true,
        decidedBy: "current-human"
      },
      false
    );
    const originalWriteState = runner.store.writeState.bind(runner.store);
    let injected = false;
    runner.store.writeState = async (state) => {
      if (!injected && state.recovery?.stage === "attempt_started") {
        injected = true;
        throw new Error("injected before blocked-source attempt state link");
      }
      await originalWriteState(state);
    };
    const promptsBefore = adapters.phasePrompts.length;
    await assert.rejects(
      runner.resume(),
      /injected before blocked-source attempt state link/
    );
    runner.store.writeState = originalWriteState;

    const preserved = await runner.store.readState(authorized.runId);
    assert.equal(preserved.activeAttempt, null);
    assert.equal(preserved.recovery?.stage, "source_preserved");
    assert.equal(adapters.phasePrompts.length, promptsBefore);
    const recoveryAttemptId = `fix-recovery-${authorized.recovery?.authorizationId.replace(/^recovery-/u, "")}`;
    const prepared = await runner.store.readRunAttempt(preserved.runId, {
      id: recoveryAttemptId,
      kind: "fix",
      mutable: true
    });
    assert.equal(prepared.status, "started");
    assert.equal(prepared.recoveryOf, sourceRecord.attempt.id);

    const done = await runner.resume();
    assert.equal(done.status, "done", done.blockReason ?? "");
    assert.equal(done.recovery?.recoveryAttemptId, recoveryAttemptId);
    assert.equal(adapters.phasePrompts.length, promptsBefore + 1);
  } finally {
    await fixture.repository.dispose();
  }
});

test("a blocked recovery descendant cannot start another prerequisite chain", async () => {
  const fixture = await prerequisiteBlockedFixFixture(
    phaseResult("fix", {
      outcome: "blocked",
      gate: null,
      summary: "Another operator prerequisite remains.",
      resolvedFindingIds: ["R1-F3"],
      questions: ["Perform the remaining external check."]
    })
  );
  try {
    const { runner, adapters, sourceRecord } = fixture;
    const status = await runner.status();
    assert.ok(status.recovery.recoveryIdentity);
    const callsBefore = adapters.phasePrompts.length;
    const blockedAgain = await runner.recover({
      attemptId: sourceRecord.attempt.id,
      recoveryIdentity: status.recovery.recoveryIdentity,
      unknownSideEffectsAccepted: true,
      decidedBy: "current-human"
    });
    assert.equal(blockedAgain.status, "blocked");
    assert.equal(blockedAgain.activeAttempt, null);
    assert.equal(adapters.phasePrompts.length, callsBefore + 1);
    const finalStatus = await runner.status();
    assert.equal(finalStatus.recovery.eligible, false);
    assert.equal(finalStatus.nextAction, "banzai cancel");
    await assert.rejects(
      runner.recover({
        attemptId: sourceRecord.attempt.id,
        recoveryIdentity: status.recovery.recoveryIdentity,
        unknownSideEffectsAccepted: true,
        decidedBy: "current-human"
      }),
      (error: unknown) =>
        error instanceof BanzaiError && error.code === "RECOVERY_NOT_ALLOWED"
    );
    assert.equal(adapters.phasePrompts.length, callsBefore + 1);
  } finally {
    await fixture.repository.dispose();
  }
});

test("invalid prerequisite-blocked scopes fail closed without an authorization identity", async () => {
  const cases: {
    name: string;
    mutate(result: PhaseResult): void;
  }[] = [
    {
      name: "duplicate resolved finding",
      mutate: (result) => {
        result.resolvedFindingIds = ["R1-F2", "R1-F2"];
      }
    },
    {
      name: "resolved finding outside accepted scope",
      mutate: (result) => {
        result.resolvedFindingIds = ["R1-F2", "R1-F9"];
      }
    },
    {
      name: "empty remaining scope",
      mutate: (result) => {
        result.resolvedFindingIds = ["R1-F2", "R1-F3", "R1-F5", "R1-F6"];
      }
    },
    {
      name: "missing operator prerequisite",
      mutate: (result) => {
        result.questions = [];
        result.requestedVerification = [];
      }
    }
  ];

  for (const item of cases) {
    const fixture = await prerequisiteBlockedFixFixture();
    try {
      const result = structuredClone(
        fixture.sourceRecord.result as PhaseResult
      );
      item.mutate(result);
      await fixture.runner.store.writeRunAttempt(
        fixture.blocked.runId,
        withProtocolResult(fixture.sourceRecord, result)
      );

      const status = await fixture.runner.status();
      assert.equal(status.recovery.eligible, false, item.name);
      assert.equal(status.recovery.recoveryIdentity, null, item.name);
      assert.equal(status.nextAction, "banzai cancel", item.name);
    } finally {
      await fixture.repository.dispose();
    }
  }
});

test("review-triage mismatch and recovery-chain sources fail closed", async () => {
  const triageFixture = await prerequisiteBlockedFixFixture();
  try {
    const state = await triageFixture.runner.store.readState(
      triageFixture.blocked.runId
    );
    assert.ok(state.triage);
    state.triage.items = state.triage.items.slice(1);
    await triageFixture.runner.store.writeState(state);
    const status = await triageFixture.runner.status();
    assert.equal(status.recovery.eligible, false);
    assert.equal(status.recovery.recoveryIdentity, null);
  } finally {
    await triageFixture.repository.dispose();
  }

  const chainFixture = await prerequisiteBlockedFixFixture();
  try {
    chainFixture.sourceRecord.recoveryOf = "fix-1-prior";
    chainFixture.sourceRecord.recoveryAuthorizationId = "recovery-prior";
    await chainFixture.runner.store.writeRunAttempt(
      chainFixture.blocked.runId,
      chainFixture.sourceRecord
    );
    const status = await chainFixture.runner.status();
    assert.equal(status.recovery.eligible, false);
    assert.equal(status.recovery.recoveryIdentity, null);
  } finally {
    await chainFixture.repository.dispose();
  }
});

test("a live process keeps prerequisite recovery unavailable", async () => {
  const fixture = await prerequisiteBlockedFixFixture();
  try {
    const state = await fixture.runner.store.readState(fixture.blocked.runId);
    state.activeProcess = {
      pid: process.pid,
      kind: "fix",
      startedAt: new Date().toISOString()
    };
    await fixture.runner.store.writeState(state);

    const status = await fixture.runner.status();
    assert.equal(status.recovery.eligible, false);
    assert.match(status.recovery.reason, /no active attempt or process/);
    assert.equal(status.recovery.recoveryIdentity, null);
  } finally {
    await fixture.repository.dispose();
  }
});

test("an existing descendant permanently closes prerequisite recovery", async () => {
  const fixture = await prerequisiteBlockedFixFixture();
  try {
    const descendant: AttemptRecord = {
      ...fixture.sourceRecord,
      attempt: {
        id: "fix-recovery-existing",
        kind: "fix",
        mutable: true
      },
      status: "started",
      completedAt: null,
      interruptedAt: null,
      recoveryOf: fixture.sourceRecord.attempt.id,
      recoveryAuthorizationId: "recovery-existing",
      result: null,
      durationMs: null,
      error: null,
      failureCode: null,
      failureCause: null
    };
    await fixture.runner.store.writeRunAttempt(
      fixture.blocked.runId,
      descendant
    );

    const status = await fixture.runner.status();
    assert.equal(status.recovery.eligible, false);
    assert.match(status.recovery.reason, /descendant already exists/i);
    assert.equal(status.recovery.recoveryIdentity, null);
  } finally {
    await fixture.repository.dispose();
  }
});

test("workspace drift invalidates prerequisite recovery before a model call", async () => {
  const fixture = await prerequisiteBlockedFixFixture();
  try {
    const { runner, adapters, sourceRecord } = fixture;
    const sourceBefore = JSON.stringify(sourceRecord);
    const status = await runner.status();
    assert.ok(status.recovery.recoveryIdentity);
    await runner.recover(
      {
        attemptId: sourceRecord.attempt.id,
        recoveryIdentity: status.recovery.recoveryIdentity,
        unknownSideEffectsAccepted: true,
        decidedBy: "current-human"
      },
      false
    );
    await writeFile(
      path.join(fixture.repository.root, "operator-evidence.txt"),
      "new evidence after authorization\n",
      "utf8"
    );
    const promptsBefore = adapters.phasePrompts.length;

    await assert.rejects(
      runner.resume(),
      (error: unknown) =>
        error instanceof BanzaiError && error.code === "RECOVERY_STALE"
    );
    assert.equal(adapters.phasePrompts.length, promptsBefore);
    const invalidated = await runner.store.readState(fixture.blocked.runId);
    assert.equal(invalidated.activeAttempt, null);
    assert.equal(invalidated.recovery, null);
    assert.equal(
      JSON.stringify(
        await runner.store.readRunAttempt(
          fixture.blocked.runId,
          sourceRecord.attempt
        )
      ),
      sourceBefore
    );
    const refreshed = await runner.status();
    assert.equal(refreshed.recovery.eligible, true, refreshed.recovery.reason);
    assert.notEqual(
      refreshed.recovery.recoveryIdentity,
      status.recovery.recoveryIdentity
    );
  } finally {
    await fixture.repository.dispose();
  }
});

test("source-result drift invalidates prerequisite recovery before a model call", async () => {
  const fixture = await prerequisiteBlockedFixFixture();
  try {
    const { runner, adapters, sourceRecord } = fixture;
    const status = await runner.status();
    assert.ok(status.recovery.recoveryIdentity);
    await runner.recover(
      {
        attemptId: sourceRecord.attempt.id,
        recoveryIdentity: status.recovery.recoveryIdentity,
        unknownSideEffectsAccepted: true,
        decidedBy: "current-human"
      },
      false
    );
    const drifted = await runner.store.readRunAttempt(
      fixture.blocked.runId,
      sourceRecord.attempt
    );
    const result = structuredClone(drifted.result as PhaseResult);
    result.questions = [...result.questions, "A new prerequisite appeared."];
    await runner.store.writeRunAttempt(
      fixture.blocked.runId,
      withProtocolResult(drifted, result)
    );
    const promptsBefore = adapters.phasePrompts.length;

    await assert.rejects(
      runner.resume(),
      (error: unknown) =>
        error instanceof BanzaiError && error.code === "RECOVERY_STALE"
    );
    assert.equal(adapters.phasePrompts.length, promptsBefore);
    const invalidated = await runner.store.readState(fixture.blocked.runId);
    assert.equal(invalidated.activeAttempt, null);
    assert.equal(invalidated.recovery, null);
  } finally {
    await fixture.repository.dispose();
  }
});

test("multiple completed blocked sources fail closed without a recovery identity", async () => {
  const fixture = await prerequisiteBlockedFixFixture();
  try {
    const { runner, blocked, sourceRecord } = fixture;
    await runner.store.writeRunAttempt(blocked.runId, {
      ...sourceRecord,
      attempt: { ...sourceRecord.attempt, id: "fix-2-ambiguous" }
    });
    const status = await runner.status();
    assert.equal(status.recovery.eligible, false);
    assert.match(status.recovery.reason, /Multiple completed blocked/);
    assert.equal(status.recovery.recoveryIdentity, null);
    assert.equal(status.nextAction, "banzai cancel");
  } finally {
    await fixture.repository.dispose();
  }
});

test("fix recovery retains accepted-finding scope and never creates a second task ledger", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new FakeAdapters();
    adapters.fixErrors.push(new Error("fix interrupted"));
    adapters.reviewResults.push(
      {
        contractVersion: CONTRACT_VERSION,
        verdict: "changes_requested",
        summary: "One accepted fix is required.",
        findings: [finding("R1-F1", "Fix the fixture.")],
        reviewedFindingIds: [],
        deferredCoverage: []
      },
      passingReview(["R1-F1"])
    );
    const runner = new WorkflowRunner(repository.root, adapters);
    await runner.start({ slug: "example", request: "Implement it." });
    const triageState = await runner.approvePlan("human");
    assert.equal(triageState.status, "needs_triage");
    const blocked = await runner.triage({
      accepted: ["R1-F1"],
      rejected: [],
      deferred: [],
      note: null,
      decidedBy: "human"
    });
    assert.equal(blocked.status, "blocked");
    const sourceAttempt = blocked.activeAttempt;
    assert.ok(sourceAttempt);
    assert.equal(sourceAttempt.kind, "fix");
    const sourceRecord = await runner.store.readRunAttempt(
      blocked.runId,
      sourceAttempt
    );
    sourceRecord.status = "started";
    sourceRecord.completedAt = null;
    sourceRecord.durationMs = null;
    sourceRecord.error = null;
    sourceRecord.failureCode = null;
    await runner.store.writeRunAttempt(blocked.runId, sourceRecord);

    const status = await runner.status();
    assert.equal(status.recovery.eligible, true, status.recovery.reason);
    assert.equal(status.recovery.phase, "fix");
    assert.equal(status.recovery.authorization, "plan_approval");
    assert.ok(status.recovery.recoveryIdentity);
    const done = await runner.recover({
      attemptId: sourceAttempt.id,
      recoveryIdentity: status.recovery.recoveryIdentity,
      unknownSideEffectsAccepted: true,
      decidedBy: "current-human"
    });

    assert.equal(done.status, "done", done.blockReason ?? "");
    const recoveryAttemptId = done.recovery?.recoveryAttemptId;
    assert.ok(recoveryAttemptId);
    const interrupted = await runner.store.readRunAttempt(
      done.runId,
      sourceAttempt
    );
    assert.equal(interrupted.status, "interrupted");
    const recovered = await runner.store.readRunAttempt(done.runId, {
      id: recoveryAttemptId,
      kind: "fix",
      mutable: true
    });
    assert.equal(recovered.recoveryOf, sourceAttempt.id);
    assert.equal((recovered.result as PhaseResult).taskCompletion, null);
    assert.deepEqual((recovered.result as PhaseResult).resolvedFindingIds, [
      "R1-F1"
    ]);
    assert.match(adapters.phasePrompts.at(-1) ?? "", /accepted finding IDs/);
    assert.match(adapters.phasePrompts.at(-1) ?? "", /R1-F1/);
  } finally {
    await repository.dispose();
  }
});

test("retry rejects interrupted planning attempts", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new FakeAdapters();
    adapters.planErrors.push(new Error("planner interrupted"));
    const runner = new WorkflowRunner(repository.root, adapters);
    const blocked = await runner.start({
      slug: "example",
      request: "Plan it."
    });
    const attempt = blocked.activeAttempt;
    assert.ok(attempt);
    assert.equal(attempt.kind, "plan");
    const record = await runner.store.readRunAttempt(blocked.runId, attempt);
    record.status = "started";
    record.completedAt = null;
    record.error = null;
    await runner.store.writeRunAttempt(blocked.runId, record);

    const status = await runner.status();
    assert.equal(status.retry.eligible, false);
    assert.equal(status.nextAction, "banzai cancel");
    await assert.rejects(
      runner.retry(),
      /Interrupted attempts cannot be retried/
    );
  } finally {
    await repository.dispose();
  }
});

test("cancellation during retry preflight is never overwritten", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new FakeAdapters();
    adapters.planErrors.push(new Error("planner unavailable"));
    const runner = new WorkflowRunner(repository.root, adapters);
    const blocked = await runner.start({
      slug: "example",
      request: "Plan it."
    });
    assert.equal(blocked.status, "blocked");

    adapters.onCodexPreflight = async () => {
      adapters.onCodexPreflight = null;
      await runner.cancel();
    };
    const cancelled = await runner.retry();
    assert.equal(cancelled.status, "cancelled");
    assert.equal((await runner.status()).state.status, "cancelled");
    assert.equal(adapters.phasePrompts.length, 1);
  } finally {
    await repository.dispose();
  }
});
