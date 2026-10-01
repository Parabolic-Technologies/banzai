import { TerminalRunStateError } from "../../errors.js";
import { PlanTaskCompletionError } from "../../plan-task-completion.js";
import { blockState } from "../../state-machine.js";
import {
  type AttemptRecord,
  COMPLETION_PROTOCOL,
  COMPLETION_SUMMARY_SCHEMA_VERSION,
  type CompletionCapture,
  type CompletionPublicationCursor,
  type CompletionPublicationRefusalCode,
  type CompletionPublicationStage,
  type RunState
} from "../../types.js";
import { accountAttemptUsage } from "../attempts/lifecycle.js";
import { type RunnerContext, timestamp } from "../context.js";

/**
 * A publication refusal under the completion protocol (ADR-0047 section 4).
 * The closed code and stage are persisted; the remedy is operator guidance
 * and never carries model text or raw error output.
 */
export class CompletionRefusal extends Error {
  constructor(
    readonly code: CompletionPublicationRefusalCode,
    readonly stage: CompletionPublicationStage,
    readonly proofDigest: string | null,
    readonly remedy: string
  ) {
    super(`${code} at ${stage}`);
    this.name = "CompletionRefusal";
  }
}

export function completionRejectionCheckpoint(
  context: RunnerContext,
  record: AttemptRecord,
  error: PlanTaskCompletionError,
  capture: CompletionCapture | null
): NonNullable<RunState["planTaskCompletion"]> {
  return {
    schemaVersion: COMPLETION_SUMMARY_SCHEMA_VERSION,
    status: "invalid",
    sourceAttemptId: record.attempt.id,
    sourceAttemptKind: record.attempt.kind === "fix" ? "fix" : "implementation",
    errorCode: "PLAN_TASK_COMPLETION_INVALID",
    violation: error.violation,
    taskId: error.taskId,
    recordedAt: timestamp(context),
    completionProtocol: COMPLETION_PROTOCOL,
    diagnostic: error.message.slice(0, 500),
    rejectedResultDigest:
      capture?.resultDigest ?? record.envelope?.originalDigest ?? null
  };
}

/**
 * Final input rejection: the attempt fails, the rejected result, input and
 * prior canonical source stay intact, and retry creates one linked successor.
 */
export async function rejectCompletionInput(
  context: RunnerContext,
  state: RunState,
  record: AttemptRecord,
  error: PlanTaskCompletionError,
  capture: CompletionCapture | null
): Promise<RunState> {
  record.status = "failed";
  record.completedAt ??= timestamp(context);
  record.durationMs ??=
    Date.parse(record.completedAt) - Date.parse(record.startedAt);
  record.error = `[PLAN_TASK_COMPLETION_INVALID] ${error.message}`;
  record.failureCode = "PLAN_TASK_COMPLETION_INVALID";
  await context.store.writeRunAttempt(state.runId, record);
  const current = await context.store.readState(state.runId);
  if (current.status === "cancelled") return current;
  accountAttemptUsage(state, record);
  state.planTaskCompletion = completionRejectionCheckpoint(
    context,
    record,
    error,
    capture
  );
  state.completionPublication = {
    attemptId: record.attempt.id,
    attemptKind: record.attempt.kind === "fix" ? "fix" : "implementation",
    stage: "validate",
    captureDigest: capture?.integrityDigest ?? null,
    candidateDigest: null,
    receiptDigest: null,
    refusal: null
  };
  state.activeProcess = null;
  blockState(state, `[PLAN_TASK_COMPLETION_INVALID] ${error.message}`);
  await context.store.writeState(state);
  await context.store.appendEvent(state.runId, "attempt.failed", {
    attemptId: record.attempt.id,
    kind: record.attempt.kind,
    error: `[PLAN_TASK_COMPLETION_INVALID] ${error.message}`
  });
  await context.store.appendEvent(
    state.runId,
    "plan_task_completion.validation_failed",
    {
      attemptId: record.attempt.id,
      code: "PLAN_TASK_COMPLETION_INVALID",
      violation: error.violation,
      taskId: error.taskId
    }
  );
  await context.store.appendEventOnce(
    state.runId,
    "completion.input_rejected",
    {
      attemptId: record.attempt.id,
      attemptKind: record.attempt.kind,
      stage: "validate",
      proofDigest: capture?.integrityDigest ?? null,
      code: "PLAN_TASK_COMPLETION_INVALID",
      violation: error.violation,
      taskId: error.taskId
    }
  );
  return state;
}

/**
 * Publication refusal: the attempt stays pending_application with a closed
 * code, stage and last durable proof digest. No model text or raw error
 * enters the block reason; resume reconciles or cancel exits.
 */
export async function appendCompletionPublicationRefusalEvent(
  context: RunnerContext,
  state: RunState,
  record: AttemptRecord,
  refusal: NonNullable<CompletionPublicationCursor["refusal"]>
): Promise<boolean> {
  try {
    await context.store.appendEventOnce(
      state.runId,
      "completion.publication_refused",
      {
        attemptId: record.attempt.id,
        attemptKind: record.attempt.kind === "fix" ? "fix" : "implementation",
        stage: refusal.stage,
        proofDigest: refusal.proofDigest,
        code: refusal.code,
        violation: null,
        taskId: null
      }
    );
    return true;
  } catch (error) {
    if (error instanceof TerminalRunStateError) throw error;
    return false;
  }
}

export async function refuseCompletionPublication(
  context: RunnerContext,
  state: RunState,
  record: AttemptRecord,
  refusal: CompletionRefusal
): Promise<RunState> {
  const attemptKind = record.attempt.kind === "fix" ? "fix" : "implementation";
  const cursor = state.completionPublication;
  const persistedRefusal: NonNullable<CompletionPublicationCursor["refusal"]> =
    {
      code: refusal.code,
      stage: refusal.stage,
      proofDigest: refusal.proofDigest
    };
  const applyRefusalState = (): void => {
    state.completionPublication = {
      attemptId: record.attempt.id,
      attemptKind,
      stage: refusal.stage,
      captureDigest:
        cursor?.attemptId === record.attempt.id ? cursor.captureDigest : null,
      candidateDigest:
        cursor?.attemptId === record.attempt.id ? cursor.candidateDigest : null,
      receiptDigest:
        cursor?.attemptId === record.attempt.id ? cursor.receiptDigest : null,
      refusal: persistedRefusal
    };
    state.activeProcess = null;
    blockState(
      state,
      `[${refusal.code}] Completion publication for ${attemptKind} attempt ${record.attempt.id} stopped at stage ${refusal.stage}. ${refusal.remedy}`
    );
  };

  try {
    if (record.status !== "pending_application") {
      record.status = "pending_application";
      await context.store.writeRunAttempt(state.runId, record);
    }
    const current = await context.store.readState(state.runId);
    if (current.status === "cancelled") return current;
  } catch (error) {
    if (error instanceof TerminalRunStateError) throw error;
    applyRefusalState();
    return state;
  }

  applyRefusalState();
  try {
    await context.store.writeState(state);
  } catch (error) {
    if (error instanceof TerminalRunStateError) throw error;
    return state;
  }
  await appendCompletionPublicationRefusalEvent(
    context,
    state,
    record,
    persistedRefusal
  );
  return state;
}
