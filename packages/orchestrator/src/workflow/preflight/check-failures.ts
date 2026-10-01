import { blockState } from "../../state-machine.js";
import type { RunState } from "../../types.js";
import type { RunnerContext } from "../context.js";
import { checkFailureReason } from "../domain/failure-classes.js";

export async function recordStartFailure(
  context: RunnerContext,
  state: RunState,
  error: unknown
): Promise<RunState> {
  const reason = checkFailureReason(error);
  blockState(state, reason);
  state.activeAttempt = null;
  state.activeProcess = null;
  await context.store.writeState(state);
  await context.store.appendEvent(state.runId, "run.start_failed", {
    reason
  });
  return state;
}

export async function recordReviewCheckFailure(
  context: RunnerContext,
  state: RunState,
  error: unknown
): Promise<RunState> {
  const reason = checkFailureReason(error);
  state.pendingReviewRotationReason = "unreliable-review";
  blockState(state, reason);
  state.activeAttempt = null;
  state.activeProcess = null;
  await context.store.writeState(state);
  await context.store.appendEvent(state.runId, "review.checks_failed", {
    reason
  });
  return state;
}

export async function recordVerificationRetryCheckFailure(
  context: RunnerContext,
  state: RunState,
  attemptId: string | null,
  error: unknown
): Promise<RunState> {
  const reason = checkFailureReason(error);
  blockState(state, reason);
  state.activeAttempt = null;
  state.activeProcess = null;
  await context.store.writeState(state);
  await context.store.appendEvent(
    state.runId,
    "verification.retry_preflight_failed",
    { attemptId, reason }
  );
  return state;
}
