import { errorMessage } from "../../errors.js";
import {
  type AttemptReference,
  RESULT_DIGEST_EVIDENCE_SCHEMA,
  RESULT_DIGEST_EVIDENCE_SCHEMA_VERSION,
  type ResultDigestComparison,
  type ResultDigestEvidence,
  type RunState
} from "../../types.js";
import {
  resultDigestDiagnostic,
  ResultDigestRejectedError
} from "../../validation.js";
import type { TaskVerificationDigestDetail } from "../../verification-evidence.js";
import type { RunnerContext } from "../context.js";
import { DIGEST_UNRESOLVED_BLOCK_PREFIX } from "../domain/failure-classes.js";

/** The structured facts a shared-library digest failure carries, if any. */
export function taskVerificationDigestDetail(
  error: unknown
): TaskVerificationDigestDetail | null {
  const candidate = error as {
    code?: unknown;
    detail?: TaskVerificationDigestDetail;
  };
  return (candidate.code === "TASK_VERIFICATION_DIGEST_MISMATCH" ||
    candidate.code === "TASK_VERIFICATION_SOURCE_TOO_LARGE") &&
    candidate.detail !== undefined
    ? candidate.detail
    : null;
}

/**
 * Establishes the acceptance baseline for one attempt and rejects the result
 * when any comparison failed. The record is written before the outcome is
 * decided, so a rejection is durable evidence rather than a lost diagnosis,
 * and an existing baseline is never restated: the current comparisons decide
 * acceptance, the recorded ones describe what acceptance observed.
 */
export async function recordResultDigestEvidence(
  context: RunnerContext,
  state: RunState,
  attempt: AttemptReference,
  comparisons: ResultDigestComparison[]
): Promise<ResultDigestEvidence> {
  const rejected = comparisons.filter((comparison) => !comparison.matched);
  const evidence = await context.store.establishResultDigestEvidence(
    state.runId,
    {
      schema: RESULT_DIGEST_EVIDENCE_SCHEMA,
      schemaVersion: RESULT_DIGEST_EVIDENCE_SCHEMA_VERSION,
      runId: state.runId,
      attempt: { id: attempt.id, kind: attempt.kind },
      outcome: rejected.length > 0 ? "rejected" : "accepted",
      comparisons
    }
  );
  if (rejected.length > 0) {
    throw new ResultDigestRejectedError(
      `The ${attempt.kind} result declared ${rejected.length} digest${rejected.length === 1 ? "" : "s"} that did not match the bytes it named when the result was accepted. ${rejected
        .map(resultDigestDiagnostic)
        .join(" ")}`,
      rejected
    );
  }
  return evidence;
}

/** The acceptance baseline recorded for one attempt, by identity, or null. */
export async function resultDigestBaseline(
  context: RunnerContext,
  state: RunState,
  sourceAttemptId: string | null
): Promise<ResultDigestEvidence | null> {
  if (sourceAttemptId === null) return null;
  const record = (await context.store.readRunAttempts(state.runId)).find(
    (item) => item.attempt.id === sourceAttemptId
  );
  return record === undefined
    ? null
    : await context.store.readResultDigestEvidenceIfExists(
        state.runId,
        record.attempt
      );
}

/**
 * ADR-0051: a consumption-time rejection keeps its own authority to refuse
 * execution and gains only a causal history, stated from the recorded
 * acceptance baseline. With no record the history is unknown and is never
 * reconstructed from the bytes that happen to be on disk now. A size
 * rejection stays a separate cause and asserts no history at all.
 */
export async function digestRejectionReason(
  context: RunnerContext,
  state: RunState,
  sourceAttemptId: string | null,
  error: unknown
): Promise<string> {
  const base = errorMessage(error);
  const detail = taskVerificationDigestDetail(error);
  if (detail === null) return base;
  // A size rejection is a separate cause and asserts no causal history.
  if (detail.observed === null) return base;
  let baseline: ResultDigestEvidence | null;
  try {
    baseline = await resultDigestBaseline(context, state, sourceAttemptId);
  } catch (readError) {
    return `${base} Its acceptance baseline could not be read, so the causal history is unavailable: ${errorMessage(readError)}`;
  }
  // Only a comparison of this exact identity establishes a cause. A baseline
  // that never covered it — the selection classified it differently then —
  // leaves the history unknown exactly as an absent record does.
  const recorded =
    baseline?.comparisons.find(
      (comparison) =>
        comparison.checkId === detail.checkId &&
        comparison.path === detail.path &&
        comparison.declared === detail.declared
    ) ?? null;
  if (recorded === null) {
    return `${DIGEST_UNRESOLVED_BLOCK_PREFIX} ${base} This run recorded no acceptance baseline for that digest, so whether it ever matched is unknown.`;
  }
  // Only a recorded match makes the bytes restorable to a known target, so
  // only that case leaves an action an operator can actually take.
  return recorded.matched
    ? `${base} It matched when the result was accepted, so the source changed after acceptance.`
    : `${DIGEST_UNRESOLVED_BLOCK_PREFIX} ${base} It did not match when the result was accepted, so it never matched.`;
}
