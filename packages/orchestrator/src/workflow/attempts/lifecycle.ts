import path from "node:path";
import { classifyModelFailure } from "../../adapters.js";
import {
  BanzaiError,
  errorMessage,
  ProcessExitError,
  TerminalRunStateError
} from "../../errors.js";
import { PlanTaskCompletionError } from "../../plan-task-completion.js";
import { redactSensitiveText, terminateProcessGroup } from "../../process.js";
import { blockState } from "../../state-machine.js";
import {
  type AdapterResult,
  type AttemptRecord,
  type AttemptReference,
  COMPLETION_PROTOCOL,
  MODEL_ATTEMPT_SCHEMA_VERSION,
  type PhaseResult,
  type PhaseResultEnvelope,
  type RecoveryAuthorization,
  type ReviewMode,
  type TerminalCheckpointResult,
  type ReviewRotationReason,
  type RunState,
  type SessionContext,
  type SessionMode,
  STRICT_MODEL_ATTEMPT_SCHEMA_VERSION
} from "../../types.js";
import {
  digestCanonicalJson,
  isPhaseResultEnvelope,
  phaseResultEnvelopeOf,
  phaseResultFromEnvelope
} from "../../validation.js";
import { observeHumanTime, type RunnerContext, timestamp } from "../context.js";
import { completionInvalidCheckpoint } from "../domain/completion-checkpoint.js";
import { INTEGRITY_NEUTRAL_FAILURE_CAUSES } from "../domain/failure-classes.js";

export interface AttemptPolicy {
  sessionMode: SessionMode;
  resumeSessionId: string | null;
  sessionContext: SessionContext;
  reviewMode?: ReviewMode;
  rotationReason?: ReviewRotationReason | null;
  /** Present for strict implementation/fix attempts under the completion protocol. */
  completion?: { retryOf: string | null };
}

export function newAttempt(
  context: RunnerContext,
  state: RunState,
  kind: AttemptReference["kind"],
  mutable: boolean
): AttemptReference {
  return {
    id: `${kind.replaceAll("_", "-")}-${kind === "planning_review" || kind === "planning_analysis" ? state.planningReview?.active?.reviewNumber : state.reviewIteration + 1}-${context.ids().slice(0, 8)}`,
    kind,
    mutable
  };
}

export function recoveryAttempt(
  authorization: RecoveryAuthorization
): AttemptReference {
  return {
    id: `${authorization.phase}-recovery-${authorization.authorizationId.replace(/^recovery-/u, "")}`,
    kind: authorization.phase,
    mutable: true
  };
}

/**
 * A deterministic successor identity for one rejected predecessor under the
 * same approval and scope, so an interrupted successor creation deduplicates
 * on resume instead of minting a second linked attempt.
 */
export function repairAttempt(
  state: RunState,
  kind: "implementation" | "fix",
  predecessor: string
): AttemptReference {
  const identity = digestCanonicalJson({
    version: 1,
    runId: state.runId,
    predecessor,
    approvalDigest: state.planApproval?.digest ?? null,
    scopeDigest: attemptScopeDigest(state, {
      id: predecessor,
      kind,
      mutable: true
    })
  });
  return {
    id: `${kind}-repair-${identity.slice(0, 12)}`,
    kind,
    mutable: true
  };
}

export function attemptScopeDigest(
  state: RunState,
  attempt: AttemptReference
): string | null {
  if (attempt.kind !== "fix" && !state.artifactBinding) {
    return null;
  }
  const acceptedFindingIds =
    state.triage?.items
      .filter((item) => item.disposition === "accepted")
      .map((item) => item.findingId)
      .sort() ?? [];
  return digestCanonicalJson(
    state.artifactBinding
      ? {
          version: 2,
          artifactBindingDigest: state.artifactBinding.sha256,
          phase: attempt.kind,
          acceptedFindingIds: attempt.kind === "fix" ? acceptedFindingIds : []
        }
      : { version: 1, acceptedFindingIds }
  );
}

export async function beginAttempt(
  context: RunnerContext,
  state: RunState,
  attempt: AttemptReference,
  policy: AttemptPolicy
): Promise<AttemptRecord> {
  const record: AttemptRecord = {
    schemaVersion:
      state.verificationMode === "task"
        ? 4
        : policy.completion === undefined
          ? MODEL_ATTEMPT_SCHEMA_VERSION
          : STRICT_MODEL_ATTEMPT_SCHEMA_VERSION,
    attempt,
    status: "started",
    startedAt: timestamp(context),
    completedAt: null,
    interruptedAt: null,
    recoveryOf: null,
    recoveryAuthorizationId: null,
    result: null,
    sessionId: null,
    rawStdoutPath: null,
    rawStderrPath: null,
    durationMs: null,
    usage: null,
    error: null,
    failureCode: null,
    reviewCandidate: null,
    sessionMode: policy.sessionMode,
    reviewMode: policy.reviewMode ?? null,
    rotationReason: policy.rotationReason ?? null,
    resumeSessionId: policy.resumeSessionId,
    sessionContext: policy.sessionContext,
    ...(policy.completion === undefined
      ? {}
      : {
          completionProtocol: COMPLETION_PROTOCOL,
          retryOf: policy.completion.retryOf,
          envelope: null,
          completionDiagnostic: null
        })
  };
  if (policy.completion?.retryOf != null) {
    // Deterministic successor identity: an interrupted creation of the same
    // linked evidence-repair successor reuses its record instead of minting
    // a second one under the same predecessor and authority.
    const existing = await context.store.readRunAttemptIfExists(
      state.runId,
      attempt
    );
    if (existing !== null) {
      if (
        existing.status !== "started" ||
        existing.result !== null ||
        existing.retryOf !== policy.completion.retryOf ||
        existing.completionProtocol !== COMPLETION_PROTOCOL ||
        JSON.stringify(existing.sessionContext) !==
          JSON.stringify(policy.sessionContext)
      )
        throw new BanzaiError(
          "COMPLETION_RETRY_CONFLICT",
          "A linked evidence-repair successor already exists with different evidence."
        );
      state.activeAttempt = attempt;
      await context.store.writeState(state);
      return existing;
    }
  }
  if (attempt.kind === "selection") {
    state.metrics.attempts.selection =
      (state.metrics.attempts.selection ?? 0) + 1;
  } else {
    state.metrics.attempts[attempt.kind] =
      (state.metrics.attempts[attempt.kind] ?? 0) + 1;
  }
  state.metrics.sessions[policy.sessionMode] += 1;
  if (policy.reviewMode !== undefined) {
    state.metrics.reviews[policy.reviewMode] += 1;
    if (
      policy.rotationReason !== null &&
      policy.rotationReason !== "primary-review"
    ) {
      state.metrics.reviews.rotations += 1;
    }
  }
  state.activeAttempt = attempt;
  const episode = state.planningReview?.active;
  if (episode !== undefined && episode !== null) {
    if (attempt.kind === "planning_review") {
      episode.reviewAttemptId = attempt.id;
      episode.reviewer = {
        executable: path.basename(policy.sessionContext.executable),
        model: policy.sessionContext.model,
        effort: policy.sessionContext.effort
      };
    }
    if (attempt.kind === "planning_analysis")
      episode.analysisAttemptId = attempt.id;
    if (
      attempt.kind === "plan" &&
      episode.step === "applying" &&
      episode.applyingAttemptId === null
    )
      episode.applyingAttemptId = attempt.id;
  }
  await context.store.writeState(state);
  await context.store.writeRunAttempt(state.runId, record);
  const timingEvent = await context.store.appendEvent(
    state.runId,
    "attempt.started",
    {
      attemptId: attempt.id,
      kind: attempt.kind,
      mutable: attempt.mutable,
      sessionMode: policy.sessionMode,
      reviewMode: policy.reviewMode ?? null,
      rotationReason: policy.rotationReason ?? null
    }
  );
  await observeHumanTime(
    context,
    state,
    "checkpoint",
    "attempt.started",
    timingEvent.at,
    attempt.id
  );
  return record;
}

export async function beginRecoveryAttempt(
  context: RunnerContext,
  state: RunState,
  authorization: RecoveryAuthorization,
  policy: AttemptPolicy
): Promise<AttemptRecord> {
  const attempt = recoveryAttempt(authorization);
  let record = await context.store.readRunAttemptIfExists(state.runId, attempt);
  if (record === null) {
    record = {
      schemaVersion:
        state.verificationMode === "task"
          ? 4
          : policy.completion === undefined
            ? MODEL_ATTEMPT_SCHEMA_VERSION
            : STRICT_MODEL_ATTEMPT_SCHEMA_VERSION,
      attempt,
      status: "started",
      startedAt: timestamp(context),
      completedAt: null,
      interruptedAt: null,
      recoveryOf: authorization.attempt.id,
      recoveryAuthorizationId: authorization.authorizationId,
      result: null,
      sessionId: null,
      rawStdoutPath: null,
      rawStderrPath: null,
      durationMs: null,
      usage: null,
      error: null,
      failureCode: null,
      reviewCandidate: null,
      sessionMode: policy.sessionMode,
      reviewMode: policy.reviewMode ?? null,
      rotationReason: policy.rotationReason ?? null,
      resumeSessionId: policy.resumeSessionId,
      sessionContext: policy.sessionContext,
      ...(policy.completion === undefined
        ? {}
        : {
            completionProtocol: COMPLETION_PROTOCOL,
            retryOf: null,
            envelope: null,
            completionDiagnostic: null
          })
    };
    await context.store.writeRunAttempt(state.runId, record);
  } else if (
    record.status !== "started" ||
    record.result !== null ||
    (policy.completion !== undefined) !== completionProtocolAttempt(record) ||
    record.recoveryOf !== authorization.attempt.id ||
    record.recoveryAuthorizationId !== authorization.authorizationId ||
    record.attempt.kind !== authorization.phase ||
    record.sessionMode !== policy.sessionMode ||
    record.resumeSessionId !== policy.resumeSessionId ||
    JSON.stringify(record.sessionContext) !==
      JSON.stringify(policy.sessionContext)
  ) {
    throw new BanzaiError(
      "RECOVERY_ATTEMPT_CONFLICT",
      "Persisted recovery attempt conflicts with its authorization."
    );
  }
  if (
    state.recovery?.sourceAttemptId !== authorization.attempt.id ||
    state.recovery.authorizationId !== authorization.authorizationId ||
    state.recovery.recoveryAttemptId !== null ||
    (state.recovery.stage !== "source_interrupted" &&
      state.recovery.stage !== "source_preserved")
  ) {
    throw new BanzaiError(
      "RECOVERY_STATE_CHANGED",
      "Recovery state changed before the new attempt could be linked."
    );
  }
  state.metrics.attempts[attempt.kind] =
    (state.metrics.attempts[attempt.kind] ?? 0) + 1;
  state.metrics.sessions[policy.sessionMode] += 1;
  state.activeAttempt = attempt;
  state.recovery = {
    authorizationId: authorization.authorizationId,
    sourceAttemptId: authorization.attempt.id,
    recoveryAttemptId: attempt.id,
    stage: "attempt_started"
  };
  await context.store.writeState(state);
  const timingEvent = await context.store.appendEvent(
    state.runId,
    "attempt.recovery_started",
    {
      sourceAttemptId: authorization.attempt.id,
      attemptId: attempt.id,
      kind: attempt.kind
    }
  );
  await observeHumanTime(
    context,
    state,
    "checkpoint",
    "attempt.recovery_started",
    timingEvent.at,
    attempt.id
  );
  return record;
}

export async function completeAttempt<T extends TerminalCheckpointResult>(
  context: RunnerContext,
  state: RunState,
  record: AttemptRecord,
  adapterResult: AdapterResult<T>
): Promise<boolean> {
  if (record.result === null) {
    await persistAdapterResult(context, state, record, adapterResult);
  }
  record.status = "completed";
  record.completedAt = timestamp(context);
  record.durationMs =
    Date.parse(record.completedAt) - Date.parse(record.startedAt);
  await context.store.writeRunAttempt(state.runId, record);
  const current = await context.store.readState(state.runId);
  if (current.status === "cancelled") {
    return false;
  }
  accountCompletedAttempt(state, record);
  state.activeProcess = null;
  await context.store.writeState(state);
  return true;
}

export async function failAttempt(
  context: RunnerContext,
  state: RunState,
  record: AttemptRecord,
  error: unknown
): Promise<RunState> {
  if (error instanceof TerminalRunStateError) return error.state;
  const completionError =
    (record.attempt.kind === "implementation" ||
      record.attempt.kind === "fix") &&
    (state.workflowSelection?.workflow ?? "strict") === "strict" &&
    error instanceof BanzaiError &&
    ["PLAN_TASK_COMPLETION_INVALID", "PHASE_RESULT_SCHEMA_MISMATCH"].includes(
      error.code
    )
      ? error instanceof PlanTaskCompletionError
        ? error
        : new PlanTaskCompletionError("source_attempt_invalid", error.message)
      : null;
  record.status = "failed";
  record.completedAt = timestamp(context);
  record.durationMs =
    Date.parse(record.completedAt) - Date.parse(record.startedAt);
  record.error =
    completionError === null
      ? errorMessage(error)
      : `[PLAN_TASK_COMPLETION_INVALID] ${completionError.message}`;
  record.failureCode =
    completionError === null
      ? error instanceof BanzaiError
        ? error.code
        : null
      : "PLAN_TASK_COMPLETION_INVALID";
  const failureCause = classifyModelFailure(error);
  record.failureCause = failureCause;
  if (
    error instanceof ProcessExitError &&
    record.rawStdoutPath === null &&
    record.rawStderrPath === null
  ) {
    await writeAttemptOutput(
      context,
      state,
      record,
      error.stdout,
      error.stderr
    );
  }
  // A process that failed still spent what its own stream reports. Dropping it
  // makes every later cost measurement a fiction.
  if (record.usage === null && error instanceof ProcessExitError) {
    record.usage = error.usage;
  }
  await context.store.writeRunAttempt(state.runId, record);
  const current = await context.store.readState(state.runId);
  if (current.status === "cancelled") {
    return current;
  }
  state.activeProcess = null;
  // Failed usage counts toward consumption but never toward completion:
  // `completedAttemptIds` stays untouched, so no verdict, review, or finding
  // metric can be derived from it.
  accountAttemptUsage(state, record);
  if (record.attempt.kind === "review") {
    if (
      error instanceof BanzaiError &&
      error.code === "ARTIFACT_PHASE_SCOPE_INVALID"
    ) {
      state.reviewIteration = state.latestReview?.iteration ?? 0;
      state.pendingReviewRotationReason = "unreliable-review";
    } else if (INTEGRITY_NEUTRAL_FAILURE_CAUSES.has(failureCause)) {
      // `executeReview` advanced the reviewed-workspace digest before starting
      // the process. Leaving it advanced would make the retry fail the
      // policy's `unreliable-review` check and rotate anyway, so preserving
      // continuity means putting it back to the last review that succeeded.
      if (state.latestReview !== null) {
        state.workspaceDigest = state.latestReview.workspaceDigest;
      }
    } else {
      state.pendingReviewRotationReason = "previous-review-failed";
    }
  }
  if (completionError !== null) {
    state.planTaskCompletion = completionInvalidCheckpoint({
      sourceAttemptId: record.attempt.id,
      sourceAttemptKind:
        record.attempt.kind === "fix" ? "fix" : "implementation",
      violation: completionError.violation,
      taskId: completionError.taskId,
      recordedAt: timestamp(context)
    });
  }
  blockState(
    state,
    completionError === null
      ? `${record.attempt.kind} failed: ${errorMessage(error)}`
      : `[PLAN_TASK_COMPLETION_INVALID] ${completionError.message}`
  );
  await context.store.writeState(state);
  await context.store.appendEvent(state.runId, "attempt.failed", {
    attemptId: record.attempt.id,
    kind: record.attempt.kind,
    cause: failureCause,
    error: errorMessage(error)
  });
  if (completionError !== null) {
    await context.store.appendEvent(
      state.runId,
      "plan_task_completion.validation_failed",
      {
        attemptId: record.attempt.id,
        code: "PLAN_TASK_COMPLETION_INVALID",
        violation: completionError.violation,
        taskId: completionError.taskId
      }
    );
  }
  return state;
}

export async function processStarted(
  context: RunnerContext,
  state: RunState,
  attempt: Pick<AttemptReference, "kind"> | { kind: "verification" },
  pid: number
): Promise<void> {
  state.activeProcess = {
    pid,
    kind: attempt.kind,
    startedAt: timestamp(context)
  };
  try {
    await context.store.writeState(state);
  } catch (error) {
    if (error instanceof TerminalRunStateError) terminateProcessGroup(pid);
    throw error;
  }
}

export async function persistAdapterResult<T extends TerminalCheckpointResult>(
  context: RunnerContext,
  state: RunState,
  record: AttemptRecord,
  adapterResult: AdapterResult<T>
): Promise<void> {
  await writeAttemptOutput(
    context,
    state,
    record,
    adapterResult.stdout,
    adapterResult.stderr
  );
  record.usage = adapterResult.usage;
  if (
    record.planningContext !== undefined &&
    record.sessionId !== null &&
    adapterResult.sessionId !== null &&
    record.sessionId !== adapterResult.sessionId
  ) {
    throw new BanzaiError(
      "SESSION_ID_CONFLICT",
      "The planning result conflicts with its announced session identity."
    );
  }
  record.result = adapterResult.result;
  record.sessionId = adapterResult.sessionId ?? record.sessionId;
  record.durationMs = context.clock().getTime() - Date.parse(record.startedAt);
  await context.store.writeRunAttempt(state.runId, record);
}

export async function writeAttemptOutput(
  context: RunnerContext,
  state: RunState,
  record: AttemptRecord,
  stdout: string,
  stderr: string
): Promise<void> {
  const stdoutPath = path.relative(
    context.store.runDirectory(state.runId),
    await context.store.writeText(
      state.runId,
      `attempts/${record.attempt.id}.stdout.log`,
      redactSensitiveText(stdout)
    )
  );
  const stderrPath = path.relative(
    context.store.runDirectory(state.runId),
    await context.store.writeText(
      state.runId,
      `attempts/${record.attempt.id}.stderr.log`,
      redactSensitiveText(stderr)
    )
  );
  record.rawStdoutPath = stdoutPath;
  record.rawStderrPath = stderrPath;
}

export function accountAttemptUsage(
  state: RunState,
  record: AttemptRecord
): void {
  const accounted = (state.metrics.usageAccountedAttemptIds ??= [
    ...state.metrics.completedAttemptIds
  ]);
  if (accounted.includes(record.attempt.id)) return;
  if (record.usage !== null) {
    state.metrics.usage.inputTokens += record.usage.inputTokens;
    state.metrics.usage.cachedInputTokens += record.usage.cachedInputTokens;
    state.metrics.usage.outputTokens += record.usage.outputTokens;
    if (record.usage.costUsd !== null) {
      state.metrics.usage.costUsd =
        (state.metrics.usage.costUsd ?? 0) + record.usage.costUsd;
    }
    accounted.push(record.attempt.id);
  }
}

export function accountCompletedAttempt(
  state: RunState,
  record: AttemptRecord
): void {
  if (state.metrics.completedAttemptIds.includes(record.attempt.id)) {
    return;
  }
  accountAttemptUsage(state, record);
  state.metrics.completedAttemptIds.push(record.attempt.id);
  state.metrics.modelDurationMs += record.durationMs ?? 0;
}

export function completionProtocolAttempt(record: AttemptRecord): boolean {
  return (
    record.schemaVersion === STRICT_MODEL_ATTEMPT_SCHEMA_VERSION ||
    (record.schemaVersion === 4 &&
      record.completionProtocol === COMPLETION_PROTOCOL)
  );
}

export function completionEnvelopeOf(
  result: PhaseResult | PhaseResultEnvelope
): PhaseResultEnvelope {
  return isPhaseResultEnvelope(result) ? result : phaseResultEnvelopeOf(result);
}

/** Lite routes keep the validated result contract; an envelope there is a vendor defect. */
export function legacyPhaseResult(
  result: PhaseResult | PhaseResultEnvelope
): PhaseResult {
  if (!isPhaseResultEnvelope(result)) return result;
  const validated = phaseResultFromEnvelope(result);
  if (validated === null)
    throw new BanzaiError(
      "PLAN_TASK_COMPLETION_INVALID",
      result.taskCompletion.state === "unaccepted"
        ? result.taskCompletion.diagnostic
        : "Lite phase result carried an unaccepted completion payload."
    );
  return validated;
}
