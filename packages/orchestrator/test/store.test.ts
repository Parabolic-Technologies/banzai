import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  chmod,
  lstat,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  symlink,
  unlink,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { BanzaiError, LocalConfigError } from "../src/errors.js";
import { LOCAL_CONFIG_LIMIT } from "../src/local-config.js";
import {
  MODEL_OVERRIDE_RECORD_SCHEMA,
  releaseHeldRunnerLocksSync,
  RunStore
} from "../src/store.js";
import {
  CONTRACT_VERSION,
  MODEL_ATTEMPT_SCHEMA_VERSION,
  RECOVERY_AUTHORIZATION_SCHEMA,
  RECOVERY_AUTHORIZATION_SCHEMA_VERSION,
  TERMINAL_CHECKPOINT_SCHEMA,
  TERMINAL_CHECKPOINT_SCHEMA_VERSION,
  sessionBindingMatches,
  type AttemptRecord,
  type ContextInvocationEvidence,
  type LocalModelLayer,
  type ModelOverrideRecordDefect,
  type ModelOverrideRecordStatus,
  type RecoveryAuthorization,
  type RunState,
  type TerminalAttemptCheckpoint,
  type VerificationAttemptRecord,
  type VerificationCommandDescriptor
} from "../src/types.js";
import { terminalCheckpointIntegrity } from "../src/validation.js";
import {
  emptyContextInventory,
  emptyContextVendorUsage,
  measureRunnerPayload
} from "../src/context-accounting.js";
import { createPromptEnvelope } from "../src/prompt-envelope.js";
import { resolveOutputContract } from "../src/output-contract.js";
import { createTestRepository, evaluationStateFixture } from "./helpers.js";
import { createPlanningReviewFixture } from "./workflow-fixtures.js";

const execFileAsync = promisify(execFile);

test("state v10 preserves planning episodes and refuses closed/active slot confusion before consumption", async () => {
  const f = await createPlanningReviewFixture();
  try {
    const initial = await f.runner.store.requireActiveState();
    assert.equal(initial.schemaVersion, 10);
    assert.deepEqual(initial.planningReview, f.requested.planningReview);
    const e = initial.planningReview?.active;
    assert.ok(e);
    const { step: _step, ...base } = e;
    void _step;
    const invalid = structuredClone(initial);
    Object.assign(invalid, {
      planningReview: {
        active: { ...base, outcome: "stale", closedAt: initial.updatedAt },
        closed: []
      }
    });
    await writeFile(
      f.runner.store.statePath(initial.runId),
      JSON.stringify(invalid)
    );
    await assert.rejects(
      f.runner.store.readState(initial.runId),
      (error: unknown) =>
        error instanceof BanzaiError && error.code === "STATE_READ_FAILED"
    );
    await writeFile(
      f.runner.store.statePath(initial.runId),
      JSON.stringify(initial)
    );
    const closedSlot = structuredClone(initial);
    Object.assign(closedSlot, {
      planningReview: { active: null, closed: [e] }
    });
    await writeFile(
      f.runner.store.statePath(initial.runId),
      JSON.stringify(closedSlot)
    );
    await assert.rejects(
      f.runner.store.readState(initial.runId),
      (error: unknown) =>
        error instanceof BanzaiError && error.code === "STATE_READ_FAILED"
    );
    await writeFile(
      f.runner.store.statePath(initial.runId),
      JSON.stringify(initial)
    );
    for (const version of [1, 7, 9]) {
      const historical = { ...initial, schemaVersion: version };
      await writeFile(
        f.runner.store.statePath(initial.runId),
        JSON.stringify(historical)
      );
      await assert.rejects(f.runner.store.readState(initial.runId));
    }
    await writeFile(
      f.runner.store.statePath(initial.runId),
      JSON.stringify(initial)
    );
    assert.deepEqual(
      (await f.runner.store.requireActiveState()).planningReview,
      initial.planningReview
    );
  } finally {
    await f.repository.dispose();
  }
});

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

test("context ledgers append atomically and preserve pre-call evidence", async () => {
  const repository = await createTestRepository();
  try {
    const store = new RunStore(repository.root);
    const runId = "context-ledger";
    const attempt = { id: "review-1", kind: "review" as const, mutable: false };
    const preCall: Omit<ContextInvocationEvidence, "ordinal"> = {
      kind: "primary",
      workflow: "strict",
      phase: "review",
      role: "reviewer",
      vendor: "claude",
      sessionMode: "fresh",
      measuredAt: "2026-08-23T10:00:00.000Z",
      completedAt: null,
      outcome: "pending",
      runnerPayload: measureRunnerPayload(
        createPromptEnvelope([
          { category: "review_triage_evidence", text: "review" }
        ]),
        resolveOutputContract("claude", "review-result/v1")
      ),
      authority: [{ class: "review_artifact", count: 1 }],
      sessionInventory: emptyContextInventory(),
      vendorUsage: emptyContextVendorUsage(),
      budgets: []
    };
    const started = await store.beginContextInvocation(runId, attempt, preCall);
    assert.equal(started.ordinal, 1);
    const ledgerPath = store.contextLedgerPath(runId, attempt);
    assert.equal((await stat(ledgerPath)).mode & 0o777, 0o600);

    const completed = await store.finishContextInvocation(runId, attempt, 1, {
      completedAt: "2026-08-23T10:01:00.000Z",
      outcome: "completed",
      sessionInventory: emptyContextInventory(),
      vendorUsage: emptyContextVendorUsage(),
      budgets: []
    });
    assert.deepEqual(completed.runnerPayload, started.runnerPayload);

    const repair = await store.beginContextInvocation(runId, attempt, {
      ...preCall,
      kind: "review_artifact_repair",
      sessionMode: "resumed"
    });
    assert.equal(repair.ordinal, 2);
    assert.equal(
      (await store.readContextLedgerIfPresent(runId, attempt))?.invocations
        .length,
      2
    );
    await assert.rejects(
      store.finishContextInvocation(runId, attempt, 1, {
        completedAt: "2026-08-23T10:02:00.000Z",
        outcome: "failed",
        sessionInventory: emptyContextInventory(),
        vendorUsage: emptyContextVendorUsage(),
        budgets: []
      }),
      /already terminal/
    );
    assert.equal((await store.readRunAttempts(runId)).length, 0);
  } finally {
    await repository.dispose();
  }
});

test("context ledger reads reject a final symlink without consuming its target", async () => {
  const repository = await createTestRepository();
  try {
    const store = new RunStore(repository.root);
    const runId = "context-symlink";
    const attempt = { id: "review-1", kind: "review" as const, mutable: false };
    await store.beginContextInvocation(runId, attempt, {
      kind: "primary",
      workflow: "strict",
      phase: "review",
      role: "reviewer",
      vendor: "claude",
      sessionMode: "fresh",
      measuredAt: "2026-08-23T10:00:00.000Z",
      completedAt: null,
      outcome: "pending",
      runnerPayload: measureRunnerPayload(
        createPromptEnvelope([
          { category: "review_triage_evidence", text: "review" }
        ]),
        resolveOutputContract("claude", "review-result/v1")
      ),
      authority: [{ class: "review_artifact", count: 1 }],
      sessionInventory: emptyContextInventory(),
      vendorUsage: emptyContextVendorUsage(),
      budgets: []
    });
    const ledgerPath = store.contextLedgerPath(runId, attempt);
    const externalPath = path.join(repository.root, "external-context.json");
    await writeFile(externalPath, await readFile(ledgerPath, "utf8"), "utf8");
    await unlink(ledgerPath);
    await symlink(externalPath, ledgerPath);

    await assert.rejects(
      store.readContextLedgerIfPresent(runId, attempt),
      (error: unknown) => {
        assert.ok(error instanceof BanzaiError);
        assert.equal(error.code, "INVALID_CONTEXT_EVIDENCE");
        assert.doesNotMatch(error.message, /external-context/);
        return true;
      }
    );
    assert.match(
      await readFile(externalPath, "utf8"),
      /banzai-context-attempt/
    );
  } finally {
    await repository.dispose();
  }
});

test("context ledger reads reject a symlinked attempts directory without consuming its target", async () => {
  const repository = await createTestRepository();
  try {
    const store = new RunStore(repository.root);
    const runId = "context-parent-symlink";
    const attempt = { id: "review-1", kind: "review" as const, mutable: false };
    await store.beginContextInvocation(runId, attempt, {
      kind: "primary",
      workflow: "strict",
      phase: "review",
      role: "reviewer",
      vendor: "claude",
      sessionMode: "fresh",
      measuredAt: "2026-08-23T10:00:00.000Z",
      completedAt: null,
      outcome: "pending",
      runnerPayload: measureRunnerPayload(
        createPromptEnvelope([
          { category: "review_triage_evidence", text: "review" }
        ]),
        resolveOutputContract("claude", "review-result/v1")
      ),
      authority: [{ class: "review_artifact", count: 1 }],
      sessionInventory: emptyContextInventory(),
      vendorUsage: emptyContextVendorUsage(),
      budgets: []
    });
    const ledgerPath = store.contextLedgerPath(runId, attempt);
    const attemptsDirectory = path.dirname(ledgerPath);
    const canary = "private@example.com";
    const externalDirectory = path.join(
      repository.root,
      `external-attempts-${canary}`
    );
    await rename(attemptsDirectory, externalDirectory);
    await symlink(externalDirectory, attemptsDirectory);
    const externalLedger = path.join(
      externalDirectory,
      path.basename(ledgerPath)
    );
    const before = await readFile(externalLedger, "utf8");

    await assert.rejects(
      store.readContextLedgerIfPresent(runId, attempt),
      (error: unknown) => {
        assert.ok(error instanceof BanzaiError);
        assert.equal(error.code, "INVALID_CONTEXT_EVIDENCE");
        assert.doesNotMatch(error.message, /private@example\.com/);
        return true;
      }
    );
    assert.equal(await readFile(externalLedger, "utf8"), before);
  } finally {
    await repository.dispose();
  }
});

test("review candidate path is deterministic and owned by one physical attempt", async () => {
  const repository = await createTestRepository();
  try {
    const store = new RunStore(repository.root);
    assert.equal(
      store.reviewCandidatePath("run-one", {
        id: "review-2-abcd1234",
        kind: "review",
        mutable: false
      }),
      path.join(
        repository.root,
        ".banzai",
        "runs",
        "run-one",
        "attempts",
        "review-2-abcd1234.review-candidate.md"
      )
    );
  } finally {
    await repository.dispose();
  }
});

test("attempt enumeration reads only canonical records and rejects identity mismatch", async () => {
  const repository = await createTestRepository();
  try {
    const store = new RunStore(repository.root);
    const runId = "attempt-enumeration";
    const record: AttemptRecord = {
      schemaVersion: MODEL_ATTEMPT_SCHEMA_VERSION,
      attempt: {
        id: "fix-2-source",
        kind: "fix",
        mutable: true
      },
      status: "completed",
      startedAt: "2026-08-19T12:00:00.000Z",
      completedAt: "2026-08-19T12:01:00.000Z",
      interruptedAt: null,
      recoveryOf: null,
      recoveryAuthorizationId: null,
      result: {
        schemaVersion: 2,
        contractVersion: CONTRACT_VERSION,
        phase: "fix",
        outcome: "blocked",
        gate: null,
        summary: "Operator prerequisite remains.",
        artifacts: {
          description: null,
          plan: null,
          adrs: [],
          implementationReport: null,
          testReport: null
        },
        taskCompletion: null,
        touchedPaths: [],
        questions: ["Run the prerequisite."],
        resolvedFindingIds: ["R1-F1"],
        requestedVerification: []
      },
      sessionId: "session",
      rawStdoutPath: null,
      rawStderrPath: null,
      durationMs: 60_000,
      usage: null,
      error: null,
      failureCode: null,
      failureCause: null,
      reviewCandidate: null,
      sessionMode: "resumed",
      reviewMode: null,
      rotationReason: null,
      resumeSessionId: "session",
      sessionContext: {
        role: "implementer",
        executable: "codex",
        model: "gpt-test",
        effort: "high"
      }
    };
    await store.writeRunAttempt(runId, record);
    const attemptsDirectory = path.join(store.runDirectory(runId), "attempts");
    await writeFile(
      path.join(attemptsDirectory, "fix-2-source.result.json"),
      '{"ignored":true}\n',
      "utf8"
    );
    await writeFile(
      path.join(attemptsDirectory, "fix-2-source.terminal-checkpoint.json"),
      '{"ignored":true}\n',
      "utf8"
    );
    assert.deepEqual(await store.readRunAttempts(runId), [record]);

    await writeFile(
      path.join(attemptsDirectory, "fix-2-conflict-fix.json"),
      `${JSON.stringify(record)}\n`,
      "utf8"
    );
    await assert.rejects(
      store.readRunAttempts(runId),
      (error: unknown) =>
        error instanceof BanzaiError && error.code === "ATTEMPT_PATH_MISMATCH"
    );
  } finally {
    await repository.dispose();
  }
});

test("persisted evidence paths reject unsafe identity segments", async () => {
  const repository = await createTestRepository();
  try {
    const store = new RunStore(repository.root);
    const safeAttempt = {
      id: "implementation-1-abcd1234",
      kind: "implementation" as const,
      mutable: true
    };
    for (const unsafe of [
      "../escape",
      "/absolute",
      "two/parts",
      "two\\parts",
      "..",
      "é",
      "a／b",
      "a".repeat(301)
    ]) {
      assert.throws(
        () => store.runDirectory(unsafe),
        (error: unknown) =>
          error instanceof BanzaiError && error.code === "UNSAFE_EVIDENCE_PATH"
      );
    }
    for (const unsafe of ["../escape", "/absolute", "two/parts", "..", "é"])
      assert.throws(() =>
        store.terminalCheckpointPath("run-one", {
          ...safeAttempt,
          id: unsafe
        })
      );
    assert.throws(() =>
      store.recoveryAuthorizationPath("run-one", "../authorization")
    );
  } finally {
    await repository.dispose();
  }
});

test("terminal checkpoints and recovery authorizations are private immutable evidence", async () => {
  const repository = await createTestRepository();
  const store = new RunStore(repository.root);
  const runId = "durable-recovery-evidence";
  const attempt = {
    id: "implementation-1-abcd1234",
    kind: "implementation" as const,
    mutable: true
  };
  const checkpointWithoutIntegrity: Omit<
    TerminalAttemptCheckpoint,
    "integrityDigest"
  > = {
    schema: TERMINAL_CHECKPOINT_SCHEMA,
    schemaVersion: TERMINAL_CHECKPOINT_SCHEMA_VERSION,
    runId,
    attempt,
    phase: "implementation",
    configuration: {
      vendor: "codex",
      executableDigest: "a".repeat(64),
      model: "gpt-test",
      effort: "high",
      sessionMode: "fresh",
      sessionContextDigest: "b".repeat(64)
    },
    resultContract: "phase-result/v2",
    terminal: {
      classification: "codex_turn_completed",
      observedAt: "2026-08-18T13:23:43.000Z"
    },
    result: {
      contractVersion: CONTRACT_VERSION,
      schemaVersion: 2,
      phase: "implementation",
      outcome: "completed",
      summary: "Implementation completed.",
      gate: null,
      questions: [],
      artifacts: {
        description: null,
        plan: null,
        adrs: [],
        implementationReport: null,
        testReport: null
      },
      taskCompletion: null,
      touchedPaths: [],
      resolvedFindingIds: [],
      requestedVerification: []
    },
    sessionId: "thread-one",
    usage: null,
    baseCommit: "c".repeat(40),
    approvalDigest: "d".repeat(64),
    workflowDigest: "e".repeat(64),
    scopeDigest: null
  };
  const checkpoint: TerminalAttemptCheckpoint = {
    ...checkpointWithoutIntegrity,
    integrityDigest: terminalCheckpointIntegrity(checkpointWithoutIntegrity)
  };
  const authorization: RecoveryAuthorization = {
    schema: RECOVERY_AUTHORIZATION_SCHEMA,
    schemaVersion: RECOVERY_AUTHORIZATION_SCHEMA_VERSION,
    authorizationId: "recovery-abcd1234",
    runId,
    attempt,
    phase: "implementation",
    recoveryIdentity: "f".repeat(64),
    workspaceDigest: "1".repeat(64),
    baseCommit: "c".repeat(40),
    approvalDigest: "d".repeat(64),
    workflowDigest: "e".repeat(64),
    scopeDigest: null,
    configurationDigest: "2".repeat(64),
    decidedBy: "operator",
    decidedAt: "2026-08-18T13:24:00.000Z",
    unknownSideEffectsAccepted: true
  };
  try {
    await store.writeTerminalCheckpoint(runId, checkpoint);
    await store.writeTerminalCheckpoint(runId, checkpoint);
    assert.deepEqual(
      await store.readTerminalCheckpointIfExists(runId, attempt),
      checkpoint
    );
    assert.equal(
      (await stat(store.terminalCheckpointPath(runId, attempt))).mode & 0o777,
      0o600
    );
    const conflictingCheckpoint = {
      ...checkpointWithoutIntegrity,
      sessionId: "different-thread"
    };
    await assert.rejects(
      store.writeTerminalCheckpoint(runId, {
        ...conflictingCheckpoint,
        integrityDigest: terminalCheckpointIntegrity(conflictingCheckpoint)
      }),
      (error: unknown) =>
        error instanceof BanzaiError &&
        error.code === "TERMINAL_CHECKPOINT_CONFLICT"
    );

    await store.writeRecoveryAuthorization(runId, authorization);
    await store.writeRecoveryAuthorization(runId, authorization);
    assert.deepEqual(
      await store.readRecoveryAuthorization(
        runId,
        authorization.authorizationId
      ),
      authorization
    );
    assert.equal(
      (
        await stat(
          store.recoveryAuthorizationPath(runId, authorization.authorizationId)
        )
      ).mode & 0o777,
      0o600
    );
    await assert.rejects(
      store.writeRecoveryAuthorization(runId, {
        ...authorization,
        decidedBy: "different-operator"
      }),
      (error: unknown) =>
        error instanceof BanzaiError &&
        error.code === "RECOVERY_AUTHORIZATION_CONFLICT"
    );
  } finally {
    await repository.dispose();
  }
});

test("runner lock excludes another coordinator and releases by token", async () => {
  const repository = await createTestRepository();
  try {
    const firstStore = new RunStore(repository.root);
    const secondStore = new RunStore(repository.root);
    const firstLock = await firstStore.acquireLock();
    await assert.rejects(
      secondStore.acquireLock(),
      (error: unknown) =>
        error instanceof BanzaiError && error.code === "RUNNER_LOCKED"
    );
    await firstLock.release();
    const secondLock = await secondStore.acquireLock();
    await secondLock.release();
  } finally {
    await repository.dispose();
  }
});

test("schema version one state drops unbound sessions and preserves durable evidence", async () => {
  const repository = await createTestRepository();
  const store = new RunStore(repository.root);
  const runId = "legacy-run";
  const timestamp = "2026-07-31T00:00:00.000Z";
  const legacy = {
    schemaVersion: 1,
    contractVersion: CONTRACT_VERSION,
    runId,
    slug: "legacy",
    request: "Legacy request",
    repoRoot: repository.root,
    status: "needs_triage",
    createdAt: timestamp,
    updatedAt: timestamp,
    baseCommit: "a".repeat(40),
    planArtifacts: null,
    planApproval: null,
    adrDecisions: [],
    sessions: { planner: "planner-old", implementer: "implementer-old" },
    reviewIteration: 1,
    latestReview: {
      iteration: 1,
      resultPath: "reviews/review-1.json",
      workspaceDigest: "digest",
      verdict: "changes_requested"
    },
    triage: {
      reviewIteration: 1,
      decidedAt: timestamp,
      decidedBy: "developer",
      items: [{ findingId: "R1-F1", disposition: "accepted", note: null }]
    },
    fixCycle: 0,
    workspaceDigest: "digest",
    verification: [],
    metrics: {
      completedAttemptIds: [],
      attempts: {
        plan: 1,
        implementation: 1,
        fix: 0,
        review: 1,
        verification: 1
      },
      modelDurationMs: 1,
      usage: {
        inputTokens: 1,
        cachedInputTokens: 0,
        outputTokens: 1,
        costUsd: null
      },
      reviewFindingCount: 1,
      triage: { accepted: 1, rejected: 0, deferred: 0 }
    },
    activeAttempt: null,
    activeProcess: null,
    blockedFrom: null,
    blockReason: null
  };
  try {
    await mkdir(store.runDirectory(runId), { recursive: true });
    await writeFile(store.statePath(runId), JSON.stringify(legacy), "utf8");

    const state = await store.readState(runId);

    assert.equal(state.schemaVersion, 3);
    assert.deepEqual(state.sessions, {
      planner: null,
      implementer: null,
      reviewer: null
    });
    assert.equal(state.pendingReviewRotationReason, "legacy-state");
    assert.equal(state.latestReview?.mode, "full");
    assert.equal(state.triageHistory.length, 1);
    assert.equal(state.triageHistory[0]?.items[0]?.findingId, "R1-F1");
    assert.deepEqual(state.metrics.sessions, { fresh: 0, resumed: 0 });

    await store.writeState(state);
    const persisted = JSON.parse(
      await readFile(path.join(store.runDirectory(runId), "state.json"), "utf8")
    ) as { schemaVersion: number };
    assert.equal(persisted.schemaVersion, 3);

    const versionTwoRunId = "legacy-v2-run";
    await mkdir(store.runDirectory(versionTwoRunId), { recursive: true });
    await writeFile(
      store.statePath(versionTwoRunId),
      JSON.stringify({
        ...state,
        schemaVersion: 2,
        runId: versionTwoRunId,
        status: "needs_human_decision",
        pendingHumanDecision: {
          phase: "plan",
          gate: "escalation",
          summary: "Legacy escalation",
          questions: ["Choose the existing behavior."],
          requestedAt: timestamp
        },
        humanDecisions: []
      }),
      "utf8"
    );
    const versionTwo = await store.readState(versionTwoRunId);
    assert.equal(versionTwo.schemaVersion, 3);
    assert.equal(versionTwo.pendingHumanDecision?.kind, "escalation");
    assert.equal(
      versionTwo.pendingHumanDecision.questions[0],
      "Choose the existing behavior."
    );

    const malformedRunId = "malformed-v3-run";
    await mkdir(store.runDirectory(malformedRunId), { recursive: true });
    await writeFile(
      store.statePath(malformedRunId),
      JSON.stringify({
        ...state,
        runId: malformedRunId,
        status: "needs_human_decision",
        pendingHumanDecision: {
          kind: "unknown_decision",
          phase: "plan",
          gate: "decision_consultation",
          summary: "Malformed",
          request: null,
          requestedAt: timestamp
        },
        humanDecisions: []
      }),
      "utf8"
    );
    await assert.rejects(
      store.readState(malformedRunId),
      (error: unknown) =>
        error instanceof BanzaiError && error.code === "STATE_READ_FAILED"
    );

    const terminalRunId = "legacy-terminal-run";
    await mkdir(store.runDirectory(terminalRunId), { recursive: true });
    await writeFile(
      store.statePath(terminalRunId),
      JSON.stringify({
        ...legacy,
        runId: terminalRunId,
        status: "done",
        latestReview: { ...legacy.latestReview, verdict: "pass" }
      }),
      "utf8"
    );
    const terminal = await store.readState(terminalRunId);
    assert.equal(terminal.pendingReviewRotationReason, null);
  } finally {
    await repository.dispose();
  }
});

test("verification ledger leaves allocate in order and terminal evidence is immutable and conflict checked", async () => {
  const repository = await createTestRepository();
  const store = new RunStore(repository.root);
  const runId = "verification-store";
  const descriptor: VerificationCommandDescriptor = {
    profileId: "node-primary",
    projectType: "node",
    profileOrdinal: 1,
    commandOrdinal: 1,
    configurationDigest: "a".repeat(64),
    command: {
      name: "npm test",
      command: "npm",
      args: ["test"],
      timeoutMs: 1_000
    }
  };
  const round: VerificationAttemptRecord["round"] = {
    id: "verification-round-implementation-fixture",
    ordinal: 1,
    sourcePhase: "implementation",
    sourceAttemptId: "implementation-fixture",
    sourceAttemptKind: "implementation"
  };
  try {
    await mkdir(store.verificationAttemptsDirectory(runId), {
      recursive: true
    });
    await writeFile(
      store.verificationLedgerPath(runId),
      JSON.stringify({ schemaVersion: 1 }),
      "utf8"
    );
    assert.equal(await store.verificationLedgerSupported(runId), true);

    const first = await store.beginVerificationAttempt(runId, {
      round,
      descriptor,
      startedAt: "2026-08-13T00:00:00.000Z"
    });
    const second = await store.beginVerificationAttempt(runId, {
      round,
      descriptor: { ...descriptor, commandOrdinal: 2 },
      startedAt: "2026-08-13T00:00:01.000Z"
    });
    assert.deepEqual(
      (await store.readVerificationAttempts(runId)).map(
        (record) => record.sequence
      ),
      [1, 2]
    );

    const terminal: VerificationAttemptRecord = {
      ...first,
      status: "completed",
      completedAt: "2026-08-13T00:00:02.000Z",
      durationMs: 2_000,
      exitCode: 0,
      stdout: {
        relativePath: "verification/000001.stdout.log",
        sha256: "b".repeat(64)
      },
      stderr: {
        relativePath: "verification/000001.stderr.log",
        sha256: "c".repeat(64)
      }
    };
    await store.finishVerificationAttempt(runId, terminal);
    await store.finishVerificationAttempt(runId, terminal);
    await assert.rejects(
      store.finishVerificationAttempt(runId, {
        ...terminal,
        completedAt: "2026-08-13T00:00:03.000Z",
        durationMs: 3_000
      }),
      (error: unknown) =>
        error instanceof BanzaiError &&
        error.code === "VERIFICATION_ATTEMPT_CONFLICT"
    );

    await writeFile(
      path.join(
        store.verificationAttemptsDirectory(runId),
        "verification-conflict.json"
      ),
      JSON.stringify({ ...second, id: first.id }),
      "utf8"
    );
    await assert.rejects(
      store.readVerificationAttempts(runId),
      (error: unknown) =>
        error instanceof BanzaiError &&
        error.code === "VERIFICATION_ATTEMPT_CONFLICT"
    );

    await writeFile(store.verificationLedgerPath(runId), "{", "utf8");
    await assert.rejects(
      store.verificationLedgerSupported(runId),
      (error: unknown) =>
        error instanceof BanzaiError &&
        error.code === "VERIFICATION_LEDGER_MALFORMED" &&
        error.message === "Verification ledger marker is malformed."
    );
  } finally {
    await repository.dispose();
  }
});

test("session binding compatibility includes role model and effort but not timeout", () => {
  const binding = {
    id: "session",
    role: "planner" as const,
    executable: "codex",
    model: "model",
    effort: "xhigh" as const
  };
  const settings = {
    executable: "codex",
    model: "model",
    effort: "xhigh" as const,
    timeoutMs: 1_000
  };

  assert.equal(sessionBindingMatches(binding, settings, "planner"), true);
  assert.equal(sessionBindingMatches(binding, settings, "implementer"), false);
  assert.equal(
    sessionBindingMatches(
      binding,
      { ...settings, timeoutMs: 2_000 },
      "planner"
    ),
    true
  );
  assert.equal(
    sessionBindingMatches(binding, { ...settings, model: "other" }, "planner"),
    false
  );
  assert.equal(
    sessionBindingMatches(binding, { ...settings, effort: "low" }, "planner"),
    false
  );
});

test("an interrupt releases the runner lock this process holds", async () => {
  const repository = await createTestRepository();
  try {
    const store = new RunStore(repository.root);
    await store.acquireLock();
    assert.equal(await pathExists(store.lockPath), true);

    releaseHeldRunnerLocksSync();

    assert.equal(await pathExists(store.lockPath), false);
  } finally {
    await repository.dispose();
  }
});

test("an interrupt leaves a lock owned by another runner untouched", async () => {
  const repository = await createTestRepository();
  try {
    const store = new RunStore(repository.root);
    const lock = await store.acquireLock();
    await writeFile(
      store.lockPath,
      `${JSON.stringify({
        schemaVersion: 1,
        pid: process.pid,
        token: "a-different-runner",
        createdAt: new Date().toISOString()
      })}\n`,
      "utf8"
    );

    releaseHeldRunnerLocksSync();

    assert.equal(await pathExists(store.lockPath), true);
    await lock.release();
    assert.equal(await pathExists(store.lockPath), true);
  } finally {
    await repository.dispose();
  }
});

test("releasing a lock normally leaves nothing for an interrupt to drop", async () => {
  const repository = await createTestRepository();
  try {
    const store = new RunStore(repository.root);
    const lock = await store.acquireLock();
    await lock.release();
    assert.equal(await pathExists(store.lockPath), false);

    const second = await store.acquireLock();
    assert.equal(await pathExists(store.lockPath), true);
    await second.release();

    releaseHeldRunnerLocksSync();
    assert.equal(await pathExists(store.lockPath), false);
  } finally {
    await repository.dispose();
  }
});

// ADR-0060 §5: the run's local model record, `model-override.json`. The
// resume of a run that crashed before its first model attempt, which records
// a fresh layer, needs the run guard and is proven with it.

const RECORDED_LAYER: LocalModelLayer = {
  planner: { executable: "codex", model: "gpt-5.5", effort: "high" },
  reviewer: { executable: "claude", model: "claude-opus-5-5", effort: "xhigh" }
};

// The same roles in another key order, as a caller might build them.
const SHUFFLED_LAYER = {
  reviewer: { effort: "xhigh", model: "claude-opus-5-5", executable: "claude" },
  planner: { model: "gpt-5.5", effort: "high", executable: "codex" }
} as LocalModelLayer;

// The canonical record bytes, written out by hand in the fixed order.
const RECORDED_TEXT = `{
  "schema": "banzai-run-model-override/v1",
  "models": {
    "planner": {
      "executable": "codex",
      "model": "gpt-5.5",
      "effort": "high"
    },
    "reviewer": {
      "executable": "claude",
      "model": "claude-opus-5-5",
      "effort": "xhigh"
    }
  }
}
`;
const EMPTY_RECORD_TEXT = `{
  "schema": "banzai-run-model-override/v1",
  "models": {}
}
`;

function runStateFixture(
  root: string,
  runId: string,
  status: RunState["status"] = "planning"
): RunState {
  return evaluationStateFixture({
    schemaVersion: 3,
    status,
    extra: {
      contractVersion: CONTRACT_VERSION,
      runId,
      repoRoot: root,
      pendingHumanDecision: null,
      humanDecisions: [],
      adrDecisions: [],
      planApproval: null,
      planArtifacts: null,
      sessions: { planner: null, implementer: null, reviewer: null },
      baseCommit: "a".repeat(40),
      blockReason: null
    }
  }) as unknown as RunState;
}

function defectOf(
  status: ModelOverrideRecordStatus
): ModelOverrideRecordDefect {
  assert.equal(status.state, "defective");
  assert.equal(status.defect.code, "LOCAL_MODEL_OVERRIDE_RECORD_INVALID");
  return status.defect;
}

async function assertNoRunState(store: RunStore, runId: string): Promise<void> {
  const directory = store.runDirectory(runId);
  assert.equal(await pathExists(path.join(directory, "state.json")), false);
  assert.equal(await pathExists(path.join(directory, "events.jsonl")), false);
  assert.equal(await pathExists(store.activeRunPath), false);
}

test("createRun records the run's local models as a private normalized record", async () => {
  const repository = await createTestRepository();
  try {
    const store = new RunStore(repository.root);
    assert.equal(MODEL_OVERRIDE_RECORD_SCHEMA, "banzai-run-model-override/v1");
    const first = runStateFixture(repository.root, "run-a");
    await store.createRun(first);
    const empty = store.modelOverrideRecordPath("run-a");
    assert.equal(
      empty,
      path.join(store.runDirectory("run-a"), "model-override.json")
    );
    assert.equal(await readFile(empty, "utf8"), EMPTY_RECORD_TEXT);
    assert.equal((await stat(empty)).mode & 0o777, 0o600);
    assert.deepEqual(await store.readModelOverrideRecord("run-a"), {
      state: "recorded",
      models: {}
    });
    await store.writeState({ ...first, status: "done" });

    await store.createRun(
      runStateFixture(repository.root, "run-b"),
      SHUFFLED_LAYER
    );
    const recorded = store.modelOverrideRecordPath("run-b");
    assert.equal(await readFile(recorded, "utf8"), RECORDED_TEXT);
    assert.equal((await stat(recorded)).mode & 0o777, 0o600);
    assert.deepEqual(await store.readModelOverrideRecord("run-b"), {
      state: "recorded",
      models: RECORDED_LAYER
    });
    assert.equal(await store.readActiveRunId(), "run-b");
    assert.deepEqual(
      (await readdir(store.runDirectory("run-b"))).filter((name) =>
        name.endsWith(".tmp")
      ),
      []
    );
  } finally {
    await repository.dispose();
  }
});

test("createRun publishes the model record before state.json and the active-run pointer", async (t) => {
  const repository = await createTestRepository();
  try {
    const store = new RunStore(repository.root);
    t.mock.method(store, "statePath", () => {
      throw new BanzaiError("INJECTED_STATE_FAILURE", "Injected.");
    });
    await assert.rejects(
      store.createRun(
        runStateFixture(repository.root, "run-a"),
        RECORDED_LAYER
      ),
      { code: "INJECTED_STATE_FAILURE" }
    );
    assert.equal(
      await readFile(store.modelOverrideRecordPath("run-a"), "utf8"),
      RECORDED_TEXT
    );
    await assertNoRunState(store, "run-a");
  } finally {
    await repository.dispose();
  }
});

test("a model record that cannot be written leaves no run state or pointer", async (t) => {
  const repository = await createTestRepository();
  try {
    const store = new RunStore(repository.root);
    // A layer the local file would refuse fails before anything is written,
    // and its message carries no value.
    for (const [layer, code] of [
      [
        {
          reviewer: {
            executable: "/FORBIDDEN-CANARY/claude",
            model: "claude-opus-5-5",
            effort: "high"
          }
        },
        "LOCAL_CONFIG_INVALID"
      ],
      [
        {
          reviewer: {
            executable: "claude",
            model: "claude-opus-5-5",
            effort: "high",
            timeoutMs: 1
          }
        },
        "LOCAL_CONFIG_KEY_REFUSED"
      ]
    ] as const) {
      await assert.rejects(
        store.createRun(
          runStateFixture(repository.root, "run-a"),
          layer as unknown as LocalModelLayer
        ),
        (error: unknown) =>
          error instanceof LocalConfigError &&
          error.code === code &&
          !/FORBIDDEN|CANARY/u.test(error.message)
      );
      assert.equal(await pathExists(store.runDirectory("run-a")), false);
      await assertNoRunState(store, "run-a");
    }

    t.mock.method(store, "modelOverrideRecordPath", () => {
      throw new BanzaiError("INJECTED_RECORD_FAILURE", "Injected.");
    });
    await assert.rejects(
      store.createRun(
        runStateFixture(repository.root, "run-b"),
        RECORDED_LAYER
      ),
      { code: "INJECTED_RECORD_FAILURE" }
    );
    await assertNoRunState(store, "run-b");
    assert.equal(
      await pathExists(path.join(store.runDirectory("run-b"), "attempts")),
      false
    );
  } finally {
    await repository.dispose();
  }
});

test("the model record is create-only and never written through a link", async (t) => {
  const repository = await createTestRepository();
  try {
    const store = new RunStore(repository.root);
    const decoys = path.join(store.runsDirectory, "decoy");
    await mkdir(decoys, { recursive: true });
    const existing = path.join(decoys, "existing.json");
    await writeFile(existing, "EXISTING-RECORD\n");
    const outside = path.join(repository.root, "outside-target.json");
    await writeFile(outside, "OUTSIDE-TARGET\n");
    const linked = path.join(decoys, "linked.json");
    await symlink(outside, linked);
    for (const [runId, target, code] of [
      ["run-a", existing, "MODEL_OVERRIDE_RECORD_CONFLICT"],
      ["run-b", linked, "STATE_READ_FAILED"]
    ] as const) {
      const redirected = t.mock.method(
        store,
        "modelOverrideRecordPath",
        () => target
      );
      await assert.rejects(
        store.createRun(
          runStateFixture(repository.root, runId),
          RECORDED_LAYER
        ),
        { code }
      );
      redirected.mock.restore();
      await assertNoRunState(store, runId);
    }
    assert.equal(await readFile(existing, "utf8"), "EXISTING-RECORD\n");
    assert.equal(await readFile(outside, "utf8"), "OUTSIDE-TARGET\n");
    assert.equal((await lstat(linked)).isSymbolicLink(), true);
    assert.deepEqual((await readdir(decoys)).sort(), [
      "existing.json",
      "linked.json"
    ]);
  } finally {
    await repository.dispose();
  }
});

test("only a missing record in an existing run directory reads as a legacy run", async () => {
  const repository = await createTestRepository();
  try {
    const store = new RunStore(repository.root);
    await store.createRun(runStateFixture(repository.root, "run-a"));
    await unlink(store.modelOverrideRecordPath("run-a"));
    assert.deepEqual(await store.readModelOverrideRecord("run-a"), {
      state: "absent"
    });

    const missing = defectOf(
      await store.readModelOverrideRecord("run-missing")
    );
    assert.equal(missing.cause, "unreadable");
    assert.equal(missing.path, ".banzai/runs/run-missing/model-override.json");

    // A linked run directory is refused whether or not it holds a record.
    const elsewhere = path.join(repository.root, ".banzai", "elsewhere");
    await mkdir(elsewhere);
    await writeFile(path.join(elsewhere, "model-override.json"), RECORDED_TEXT);
    await symlink(elsewhere, store.runDirectory("run-linked"));
    assert.equal(
      defectOf(await store.readModelOverrideRecord("run-linked")).cause,
      "unsafe"
    );
    await unlink(path.join(elsewhere, "model-override.json"));
    assert.equal(
      defectOf(await store.readModelOverrideRecord("run-linked")).cause,
      "unsafe"
    );

    await assert.rejects(store.readModelOverrideRecord("../escape"), {
      code: "UNSAFE_EVIDENCE_PATH"
    });
  } finally {
    await repository.dispose();
  }
});

test("a defective model record is reported, never read as absent and never echoed", async () => {
  const repository = await createTestRepository();
  try {
    const store = new RunStore(repository.root);
    await store.createRun(runStateFixture(repository.root, "run-a"));
    const target = store.modelOverrideRecordPath("run-a");
    const record = (value: Record<string, unknown>) =>
      `${JSON.stringify(value, null, 2)}\n`;
    const triple = {
      executable: "claude",
      model: "claude-opus-5-5",
      effort: "high"
    };
    const contents: [string, string | Buffer][] = [
      ["corrupt JSON", '{"schema": "FORBIDDEN-CANARY'],
      ["invalid UTF-8", Buffer.from([0x7b, 0xff, 0x7d])],
      ["not an object", "[]\n"],
      [
        "another identity",
        record({ schema: "FORBIDDEN-CANARY/v1", models: {} })
      ],
      [
        "a later identity",
        record({ schema: "banzai-run-model-override/v2", models: {} })
      ],
      ["no models", record({ schema: MODEL_OVERRIDE_RECORD_SCHEMA })],
      [
        "an extra key",
        record({
          schema: MODEL_OVERRIDE_RECORD_SCHEMA,
          models: {},
          FORBIDDEN_CANARY: true
        })
      ],
      [
        "models not an object",
        record({ schema: MODEL_OVERRIDE_RECORD_SCHEMA, models: [] })
      ],
      [
        "an unknown role",
        record({
          schema: MODEL_OVERRIDE_RECORD_SCHEMA,
          models: { FORBIDDEN_CANARY: triple }
        })
      ],
      [
        "an executable path",
        record({
          schema: MODEL_OVERRIDE_RECORD_SCHEMA,
          models: {
            reviewer: { ...triple, executable: "/FORBIDDEN-CANARY/claude" }
          }
        })
      ],
      [
        "an out-of-pattern model",
        record({
          schema: MODEL_OVERRIDE_RECORD_SCHEMA,
          models: {
            reviewer: { ...triple, model: "FORBIDDEN CANARY\u001b[31m" }
          }
        })
      ],
      [
        "an unknown effort",
        record({
          schema: MODEL_OVERRIDE_RECORD_SCHEMA,
          models: { reviewer: { ...triple, effort: "FORBIDDEN-CANARY" } }
        })
      ],
      [
        "timeoutMs in a role",
        record({
          schema: MODEL_OVERRIDE_RECORD_SCHEMA,
          models: { reviewer: { ...triple, timeoutMs: 1 } }
        })
      ],
      [
        "an oversized record",
        RECORDED_TEXT.trimEnd() +
          " ".repeat(LOCAL_CONFIG_LIMIT - RECORDED_TEXT.length + 1) +
          "\n"
      ]
    ];
    const assertDefect = (
      label: string,
      status: ModelOverrideRecordStatus,
      cause: ModelOverrideRecordDefect["cause"]
    ) => {
      const defect = defectOf(status);
      assert.equal(defect.cause, cause, label);
      assert.equal(defect.path, ".banzai/runs/run-a/model-override.json");
      assert.ok(defect.message.includes(defect.path), label);
      assert.match(defect.message, /banzai cancel/u, label);
      assert.doesNotMatch(defect.message, /FORBIDDEN|CANARY|\u001b/u, label);
    };
    for (const [label, bytes] of contents) {
      await writeFile(target, bytes);
      assertDefect(
        label,
        await store.readModelOverrideRecord("run-a"),
        "invalid"
      );
    }

    // Exactly the size bound is still read.
    await writeFile(
      target,
      RECORDED_TEXT.trimEnd() +
        " ".repeat(LOCAL_CONFIG_LIMIT - RECORDED_TEXT.length) +
        "\n"
    );
    assert.deepEqual(await store.readModelOverrideRecord("run-a"), {
      state: "recorded",
      models: RECORDED_LAYER
    });

    const valid = path.join(repository.root, "valid-record.json");
    await writeFile(valid, RECORDED_TEXT);
    await rm(target);
    await symlink(valid, target);
    assertDefect(
      "a link",
      await store.readModelOverrideRecord("run-a"),
      "unsafe"
    );
    await rm(target);
    await symlink(path.join(repository.root, "missing.json"), target);
    assertDefect(
      "a dangling link",
      await store.readModelOverrideRecord("run-a"),
      "unsafe"
    );
    await rm(target);
    await mkdir(target);
    assertDefect(
      "a directory",
      await store.readModelOverrideRecord("run-a"),
      "unsafe"
    );
    await rm(target, { recursive: true });
    if (process.platform !== "win32") {
      await execFileAsync("mkfifo", [target]);
      assertDefect(
        "a FIFO",
        await store.readModelOverrideRecord("run-a"),
        "unsafe"
      );
      await rm(target);
    }
    if (process.getuid?.() !== 0) {
      await writeFile(target, RECORDED_TEXT, { mode: 0o600 });
      await chmod(target, 0o000);
      try {
        assertDefect(
          "an unreadable record",
          await store.readModelOverrideRecord("run-a"),
          "unreadable"
        );
      } finally {
        await chmod(target, 0o600);
      }
    }
  } finally {
    await repository.dispose();
  }
});

test("replacing a model record renames a private record over it, or creates one for a legacy run", async () => {
  const repository = await createTestRepository();
  try {
    const store = new RunStore(repository.root);
    await store.createRun(runStateFixture(repository.root, "run-a"));
    const target = store.modelOverrideRecordPath("run-a");
    const before = await stat(target);

    await store.replaceModelOverrideRecord("run-a", SHUFFLED_LAYER);
    const after = await stat(target);
    assert.notEqual(after.ino, before.ino);
    assert.equal(after.mode & 0o777, 0o600);
    assert.equal(await readFile(target, "utf8"), RECORDED_TEXT);
    assert.deepEqual(await store.readModelOverrideRecord("run-a"), {
      state: "recorded",
      models: RECORDED_LAYER
    });

    await store.replaceModelOverrideRecord("run-a", {});
    assert.equal(await readFile(target, "utf8"), EMPTY_RECORD_TEXT);

    // A run created before ADR-0060 gains its first record.
    await unlink(target);
    await store.replaceModelOverrideRecord("run-a", RECORDED_LAYER);
    assert.equal(await readFile(target, "utf8"), RECORDED_TEXT);
    assert.equal((await stat(target)).mode & 0o777, 0o600);

    await assert.rejects(
      store.replaceModelOverrideRecord("run-a", {
        reviewer: {
          executable: "/FORBIDDEN-CANARY/claude",
          model: "claude-opus-5-5",
          effort: "high"
        }
      } as unknown as LocalModelLayer),
      (error: unknown) =>
        error instanceof LocalConfigError &&
        error.code === "LOCAL_CONFIG_INVALID" &&
        !/FORBIDDEN|CANARY/u.test(error.message)
    );
    assert.equal(await readFile(target, "utf8"), RECORDED_TEXT);
    assert.deepEqual(
      (await readdir(store.runDirectory("run-a"))).filter((name) =>
        name.endsWith(".tmp")
      ),
      []
    );
  } finally {
    await repository.dispose();
  }
});

test("replacing a model record never writes through a link", async () => {
  const repository = await createTestRepository();
  try {
    const store = new RunStore(repository.root);
    await store.createRun(runStateFixture(repository.root, "run-a"));
    const target = store.modelOverrideRecordPath("run-a");
    const outside = path.join(repository.root, "outside-target.json");
    await writeFile(outside, "OUTSIDE-TARGET\n");
    const refused = {
      code: "LOCAL_MODEL_OVERRIDE_RECORD_INVALID",
      message: /banzai cancel/u
    };

    await unlink(target);
    await symlink(outside, target);
    await assert.rejects(
      store.replaceModelOverrideRecord("run-a", RECORDED_LAYER),
      refused
    );
    assert.equal((await lstat(target)).isSymbolicLink(), true);
    assert.equal(await readFile(outside, "utf8"), "OUTSIDE-TARGET\n");

    await unlink(target);
    await mkdir(target);
    await assert.rejects(
      store.replaceModelOverrideRecord("run-a", RECORDED_LAYER),
      refused
    );
    assert.equal((await stat(target)).isDirectory(), true);

    const elsewhere = path.join(repository.root, ".banzai", "elsewhere");
    await mkdir(elsewhere);
    await writeFile(path.join(elsewhere, "model-override.json"), "ELSEWHERE\n");
    await symlink(elsewhere, store.runDirectory("run-linked"));
    await assert.rejects(
      store.replaceModelOverrideRecord("run-linked", RECORDED_LAYER),
      refused
    );
    assert.equal(
      await readFile(path.join(elsewhere, "model-override.json"), "utf8"),
      "ELSEWHERE\n"
    );

    await assert.rejects(
      store.replaceModelOverrideRecord("run-missing", RECORDED_LAYER),
      refused
    );
    assert.equal(await pathExists(store.runDirectory("run-missing")), false);
  } finally {
    await repository.dispose();
  }
});
