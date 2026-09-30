import assert from "node:assert/strict";
import test from "node:test";
import type {
  AttemptRecord,
  AttemptReference,
  PhaseResult,
  PhaseResultEnvelope,
  RecoveryAuthorization,
  RunState,
  SessionContext
} from "../../../src/types.js";
import {
  type AttemptPolicy,
  beginAttempt,
  beginRecoveryAttempt,
  legacyPhaseResult,
  persistAdapterResult
} from "../../../src/workflow/attempts/lifecycle.js";
import { recordingContext } from "../context-fixture.js";

const SESSION: SessionContext = {
  role: "implementer",
  executable: "codex",
  model: "model",
  effort: "high"
};
const POLICY: AttemptPolicy = {
  sessionMode: "fresh",
  resumeSessionId: null,
  sessionContext: SESSION
};
const ATTEMPT: AttemptReference = {
  id: "implementation-2-abcdef12",
  kind: "implementation",
  mutable: true
};

function runState(overrides: Partial<RunState> = {}): RunState {
  return {
    runId: "run-1",
    verificationMode: "task",
    activeAttempt: null,
    recovery: null,
    ...overrides
  } as unknown as RunState;
}

test("a linked evidence-repair successor never reuses a record with other evidence", async () => {
  const { context, calls } = recordingContext({
    readRunAttemptIfExists: () =>
      Promise.resolve({
        status: "completed",
        result: null
      } as unknown as AttemptRecord)
  });
  const state = runState();
  await assert.rejects(
    beginAttempt(context, state, ATTEMPT, {
      ...POLICY,
      completion: { retryOf: "implementation-1-abcdef12" }
    }),
    {
      code: "COMPLETION_RETRY_CONFLICT",
      message:
        "A linked evidence-repair successor already exists with different evidence."
    }
  );
  assert.deepEqual(calls, ["readRunAttemptIfExists"]);
  assert.equal(state.activeAttempt, null);
});

const AUTHORIZATION = {
  authorizationId: "recovery-abc",
  phase: "implementation",
  attempt: {
    id: "implementation-1-abcdef12",
    kind: "implementation",
    mutable: true
  }
} as unknown as RecoveryAuthorization;

test("a persisted recovery attempt must match its authorization", async () => {
  const { context, calls } = recordingContext({
    readRunAttemptIfExists: () =>
      Promise.resolve({
        status: "completed",
        result: null
      } as unknown as AttemptRecord)
  });
  await assert.rejects(
    beginRecoveryAttempt(context, runState(), AUTHORIZATION, POLICY),
    {
      code: "RECOVERY_ATTEMPT_CONFLICT",
      message: "Persisted recovery attempt conflicts with its authorization."
    }
  );
  assert.deepEqual(calls, ["readRunAttemptIfExists"]);
});

test("a recovery attempt is recorded before changed recovery state stops its linking", async () => {
  const written: AttemptRecord[] = [];
  const { context, calls } = recordingContext({
    readRunAttemptIfExists: () => Promise.resolve(null),
    writeRunAttempt: (_runId: string, record: AttemptRecord) => {
      written.push(record);
      return Promise.resolve();
    }
  });
  await assert.rejects(
    beginRecoveryAttempt(context, runState(), AUTHORIZATION, POLICY),
    {
      code: "RECOVERY_STATE_CHANGED",
      message: "Recovery state changed before the new attempt could be linked."
    }
  );
  assert.deepEqual(calls, ["readRunAttemptIfExists", "writeRunAttempt"]);
  assert.deepEqual(
    written.map((record) => [
      record.attempt.id,
      record.status,
      record.recoveryOf
    ]),
    [["implementation-recovery-abc", "started", "implementation-1-abcdef12"]]
  );
});

test("a planning result cannot replace its announced session identity", async () => {
  const { context, calls } = recordingContext({
    runDirectory: () => "/runs/run-1",
    writeText: (_runId: string, relativePath: string) =>
      Promise.resolve(`/runs/run-1/${relativePath}`)
  });
  const record = {
    attempt: { id: "plan-1-abcdef12", kind: "plan", mutable: true },
    startedAt: "2026-07-01T00:00:00.000Z",
    planningContext: {},
    sessionId: "announced",
    result: null
  } as unknown as AttemptRecord;
  await assert.rejects(
    persistAdapterResult(context, runState(), record, {
      stdout: "out",
      stderr: "err",
      usage: null,
      sessionId: "different",
      result: {} as PhaseResult
    }),
    {
      code: "SESSION_ID_CONFLICT",
      message:
        "The planning result conflicts with its announced session identity."
    }
  );
  assert.deepEqual(calls, [
    "runDirectory",
    "writeText",
    "runDirectory",
    "writeText"
  ]);
  assert.equal(record.result, null);
  assert.equal(record.rawStdoutPath, "attempts/plan-1-abcdef12.stdout.log");
});

test("a lite result with unaccepted completion evidence reports its diagnostic", () => {
  assert.throws(
    () =>
      legacyPhaseResult({
        original: "{}",
        taskCompletion: {
          state: "unaccepted",
          diagnostic: "Ledger task T001 is missing.",
          raw: "{}",
          rawDigest: "0".repeat(64)
        }
      } as unknown as PhaseResultEnvelope),
    {
      code: "PLAN_TASK_COMPLETION_INVALID",
      message: "Ledger task T001 is missing."
    }
  );
});
