import assert from "node:assert/strict";
import {
  mkdir,
  readFile,
  rename,
  stat,
  symlink,
  unlink,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { BanzaiError } from "../src/errors.js";
import { releaseHeldRunnerLocksSync, RunStore } from "../src/store.js";
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
  type RecoveryAuthorization,
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
import {
  createTestRepository,
  snapshotTree,
  boundWorkFixture
} from "./helpers.js";

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
        resolveOutputContract("claude", "review-result/v2")
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
        resolveOutputContract("claude", "review-result/v2")
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
        resolveOutputContract("claude", "review-result/v2")
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
        schemaVersion: 3,
        decisionConsultation: null,
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
    resultContract: "phase-result/v3",
    terminal: {
      classification: "codex_turn_completed",
      observedAt: "2026-08-18T13:23:43.000Z"
    },
    result: {
      contractVersion: CONTRACT_VERSION,
      schemaVersion: 3,
      decisionConsultation: null,
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

test("removed run states reject reads and mutation before locks or events", async () => {
  const repository = await createTestRepository();
  try {
    const store = new RunStore(repository.root);
    const runId = "unsupported-run";
    await mkdir(store.runDirectory(runId), { recursive: true });
    await writeFile(
      store.activeRunPath,
      JSON.stringify({ schemaVersion: 1, runId })
    );
    for (const schemaVersion of [1, 2, 3, 4, 6]) {
      const state = { schemaVersion, runId, status: "created" };
      await writeFile(store.statePath(runId), JSON.stringify(state));
      const before = await snapshotTree(path.join(repository.root, ".banzai"));
      for (const action of [
        () => store.readState(runId),
        () => store.acquireLock(),
        () => store.appendEvent(runId, "fixture", {}),
        () =>
          store.commitCancellation(runId, () => {
            throw new Error("must not execute");
          })
      ]) {
        await assert.rejects(action, {
          code: "RESOURCE_VERSION_UNSUPPORTED",
          message:
            /^.+ version .+ is not supported; 3\.x supports .+; last read by release-train major 2$/u
        });
        assert.deepEqual(
          await snapshotTree(path.join(repository.root, ".banzai")),
          before
        );
      }
    }
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
      JSON.stringify({ schemaVersion: 2 }),
      "utf8"
    );
    assert.deepEqual(await store.readVerificationAttempts(runId), []);

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
      store.readVerificationAttempts(runId),
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

test("state 5 requires binding v2 and an explicit recovery stage without repair", async () => {
  const repository = await createTestRepository();
  try {
    const store = new RunStore(repository.root);
    const runId = "state-window";
    const artifactBinding = boundWorkFixture();
    const state = {
      schemaVersion: 5,
      artifactBinding,
      status: "created",
      pendingHumanDecision: null,
      humanDecisions: []
    };
    await mkdir(store.runDirectory(runId), { recursive: true });
    for (const [value, code] of [
      [
        {
          ...state,
          artifactBinding: {
            ...artifactBinding,
            binding: {
              ...artifactBinding.binding,
              schemaVersion: 1,
              schema: "banzai-work-binding/v1"
            }
          }
        },
        "RESOURCE_VERSION_UNSUPPORTED"
      ],
      [
        {
          ...state,
          recovery: {
            sourceAttemptId: "implementation-1",
            recoveryAttemptId: null
          }
        },
        "STATE_READ_FAILED"
      ],
      [{ ...state, artifactBinding: null }, "ARTIFACT_RECOVERY_REQUIRED"]
    ] as const) {
      await writeFile(store.statePath(runId), JSON.stringify(value));
      const before = await snapshotTree(path.join(repository.root, ".banzai"));
      await assert.rejects(store.readState(runId), { code });
      assert.deepEqual(
        await snapshotTree(path.join(repository.root, ".banzai")),
        before
      );
    }
  } finally {
    await repository.dispose();
  }
});
