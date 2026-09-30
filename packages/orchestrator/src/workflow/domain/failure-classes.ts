import { BanzaiError, errorMessage } from "../../errors.js";
import type {
  AttemptRecord,
  AttemptReference,
  ModelFailureCause,
  PlanTaskCompletionViolation
} from "../../types.js";

/*
 * Failure and block classifications that retry, recovery and reconciliation
 * decisions read (ADR-0052 workflow domain).
 */

/**
 * Causes that say nothing about review integrity. A transient vendor condition
 * must not discard a reviewer session and promote its retry to a full
 * from-scratch audit.
 */
export const INTEGRITY_NEUTRAL_FAILURE_CAUSES = new Set<ModelFailureCause>([
  "capacity",
  "timeout",
  "process_start",
  "transport"
]);

/**
 * Completion violations whose defect lives in the approved plan bundle rather
 * than in the attempt's evidence. A fresh implementation attempt can never
 * repair these — the plan is immutable while approved — so their retry reruns
 * planning for a corrected bundle and a new approval instead of looping a
 * completion-evidence repair that must fail identically every time.
 */
export const PLAN_BUNDLE_COMPLETION_VIOLATIONS =
  new Set<PlanTaskCompletionViolation>([
    "approved_plan_invalid",
    "approval_invalid"
  ]);

/**
 * Failures that can terminate an already-running mutable model after it has
 * changed the checkout but before a terminal result reaches Banzai. They need
 * the same explicit, snapshot-bound recovery path as a parent interruption.
 * Process-start failures are excluded because no mutable child ran, while an
 * unclassified failure remains fail-closed because its integrity is unknown.
 */
export const RECOVERABLE_MUTABLE_FAILURE_CAUSES = new Set<ModelFailureCause>([
  "capacity",
  "timeout",
  "transport"
]);

export const PLANNING_REPAIR_FAILURE_CODES = new Set([
  "INVALID_RESULT",
  "MODEL_RESULT_INVALID",
  "CODEX_RESULT_MISSING",
  "PHASE_RESULT_SCHEMA_MISMATCH",
  "PLAN_TASK_COMPLETION_INVALID"
]);

export const TERMINAL_INTEGRITY_FAILURE_CODES = new Set([
  "TERMINAL_RESULT_CONFLICT",
  "SESSION_ID_CONFLICT"
]);

/**
 * Failure codes an attempt may carry when a digest it authored disagreed with
 * the bytes it named. `PLAN_TASK_COMPLETION_INVALID` is a long-standing
 * completion-validation code produced elsewhere too, so membership here is
 * never sufficient: `digestRejectedRecoveryEligibility` admits an attempt only
 * together with a rejected digest record attributed to that exact attempt.
 * Dropping that conjunct would widen recovery authority.
 */
export const DIGEST_REJECTED_FAILURE_CODES = new Set([
  "RESULT_DIGEST_REJECTED",
  "PLAN_TASK_COMPLETION_INVALID"
]);

/**
 * Marks a consumption-time digest rejection that no command can clear: the
 * bytes disagree and no recorded baseline establishes a target to restore
 * them to. Read back by retry eligibility exactly as the approval-invalidation
 * reason is, so the run never advertises an action that must fail identically.
 */
export const DIGEST_UNRESOLVED_BLOCK_PREFIX = "[RESULT_DIGEST_UNRESOLVED]";

export function isRetryableInterruptedAttempt(
  attempt: AttemptReference,
  record: AttemptRecord
): boolean {
  return (
    !attempt.mutable &&
    record.status === "started" &&
    (attempt.kind === "selection" || attempt.kind === "review")
  );
}

/** The block reason a failed start, review or retry check records. */
export function checkFailureReason(error: unknown): string {
  return error instanceof BanzaiError
    ? `[${error.code}] ${error.message}`
    : errorMessage(error);
}
