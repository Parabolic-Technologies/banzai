import type { AttemptRecord, AttemptReference, RunState } from "../../types.js";
import {
  DIGEST_UNRESOLVED_BLOCK_PREFIX,
  isRetryableInterruptedAttempt,
  PLAN_BUNDLE_COMPLETION_VIOLATIONS
} from "./failure-classes.js";

export interface RetryEligibility {
  eligible: boolean;
  reason: string;
  attemptId: string | null;
}

/** The latest physical verification attempt, as far as a decision reads it. */
export interface LatestVerificationAttempt {
  id: string;
  status: string;
}

/** A verification read that failed is a decision input, not an error. */
export type VerificationEvidence<T> =
  ({ readable: true } & T) | { readable: false };

/** Evidence the shell gathers only when the retry rule names it. */
export type RetryEvidence =
  | "task_verification_attempts"
  | "legacy_ledger_support"
  | "legacy_verification_attempts"
  | "attempt_record";

export interface RetryFacts {
  state: RunState;
  taskVerification?: VerificationEvidence<{
    latest: LatestVerificationAttempt | null;
  }>;
  legacyLedger?: VerificationEvidence<{ supported: boolean }>;
  legacyVerification?: VerificationEvidence<{
    latest: LatestVerificationAttempt | null;
  }>;
  attemptRecord?: AttemptRecord;
}

export type RetryStep =
  | { kind: "decided"; eligibility: RetryEligibility }
  | { kind: "needs"; evidence: Exclude<RetryEvidence, "attempt_record"> }
  | { kind: "needs"; evidence: "attempt_record"; attempt: AttemptReference };

const decided = (
  eligible: boolean,
  reason: string,
  attemptId: string | null
): RetryStep => ({
  kind: "decided",
  eligibility: { eligible, reason, attemptId }
});

const needs = (
  evidence: Exclude<RetryEvidence, "attempt_record">
): RetryStep => ({ kind: "needs", evidence });

// A decision is returned to callers through the public status snapshot, so
// every call allocates its own: a caller editing one must not change another.
const malformedVerification = (): RetryStep =>
  decided(
    false,
    "Verification evidence is malformed or conflicting. Audit the run before continuing.",
    null
  );

/**
 * Whether a blocked run can be retried explicitly. The rule reads evidence
 * only through the facts it names in a `needs` step, in the order the runner
 * has always read it, so unread evidence can never change the decision.
 */
export function decideRetry(facts: RetryFacts): RetryStep {
  const { state } = facts;
  if (state.status !== "blocked") {
    return decided(
      false,
      `Retry requires a blocked run, but the run is ${state.status}.`,
      null
    );
  }
  if (state.activeProcess !== null) {
    return decided(
      false,
      "Retry is unavailable while a model process is still active.",
      state.activeAttempt?.id ?? null
    );
  }
  const attempt = state.activeAttempt;
  if (attempt === null) return decideWithoutAttempt(facts);
  if (facts.attemptRecord === undefined)
    return { kind: "needs", evidence: "attempt_record", attempt };
  return decideWithAttempt(state, attempt, facts.attemptRecord);
}

function decideWithoutAttempt(facts: RetryFacts): RetryStep {
  const { state } = facts;
  if (state.blockedFrom === "created") {
    return decided(
      true,
      "Startup checks can be retried after resolving the reported prerequisite.",
      null
    );
  }
  if (state.blockedFrom === "reviewing") {
    return decided(
      true,
      "Review checks can be retried after resolving the reported prerequisite.",
      null
    );
  }
  if (
    state.blockedFrom === "verifying" &&
    state.planTaskCompletion?.status === "invalid"
  ) {
    // Completion revalidation rejected the evidence before verification
    // commands ran — for example a fix attempt edited the frozen Plan
    // Task Completion projection. The already-authorized completion
    // repair applies; there is no failed verification attempt to retry.
    return decided(
      true,
      PLAN_BUNDLE_COMPLETION_VIOLATIONS.has(state.planTaskCompletion.violation)
        ? "The approved plan bundle is invalid; retry reruns planning for a corrected bundle and a new approval."
        : `Completion evidence rejected at revalidation can be repaired with a new implementation attempt.`,
      state.planTaskCompletion.sourceAttemptId
    );
  }
  if (state.blockedFrom === "verifying") {
    if (state.blockReason?.startsWith(DIGEST_UNRESOLVED_BLOCK_PREFIX)) {
      return decided(
        false,
        "A digest this run's result authored does not match the bytes it names, and no recorded baseline shows those bytes changed after acceptance. Retrying reads the same bytes and fails identically. Inspect the checkout, then cancel the run.",
        null
      );
    }
    if (state.verificationMode === "task") {
      const evidence = facts.taskVerification;
      if (evidence === undefined) return needs("task_verification_attempts");
      if (!evidence.readable) return malformedVerification();
      const latest = evidence.latest;
      const unresolved = latest?.status === "started";
      const unsuccessful =
        latest?.status === "failed" || latest?.status === "interrupted";
      return decided(
        true,
        unresolved
          ? "Retry reconciles the unresolved physical attempt before running eligible checks."
          : unsuccessful
            ? "The unsuccessful task check can be retried explicitly."
            : "Verification prerequisites can be retried without replaying implementation.",
        unsuccessful ? latest.id : null
      );
    }
    const ledger = facts.legacyLedger;
    if (ledger === undefined) return needs("legacy_ledger_support");
    if (!ledger.readable) return malformedVerification();
    if (!ledger.supported) {
      return decided(
        false,
        "Legacy verification evidence has no retryable durable attempt identity. Inspect the checkout, then cancel the run.",
        null
      );
    }
    const legacy = facts.legacyVerification;
    if (legacy === undefined) return needs("legacy_verification_attempts");
    if (!legacy.readable) return malformedVerification();
    if (legacy.latest?.status === "failed") {
      return decided(
        true,
        `Failed verification attempt ${legacy.latest.id} can be retried explicitly.`,
        legacy.latest.id
      );
    }
  }
  // Pre-attempt checks block only through validateApproval, whose block
  // reason is the runner's own text; every other blocked-from-fixing state
  // without an attempt (a completed prerequisite-blocked fix) belongs to
  // the recovery path and must not gain a retry here.
  const approvalInvalidated =
    state.blockReason?.startsWith("Approved planning artifacts changed") ===
    true;
  if (approvalInvalidated && state.blockedFrom === "fixing") {
    return decided(
      true,
      "Fix checks can be retried after resolving the reported prerequisite.",
      null
    );
  }
  if (
    approvalInvalidated &&
    (state.blockedFrom === "implementing" ||
      state.blockedFrom === "plan_approved")
  ) {
    return decided(
      true,
      "Implementation checks can be retried after resolving the reported prerequisite.",
      null
    );
  }
  return decided(
    false,
    "This blocked state is not tied to a failed attempt. Resolve it manually or cancel the run.",
    null
  );
}

function decideWithAttempt(
  state: RunState,
  attempt: AttemptReference,
  record: AttemptRecord
): RetryStep {
  if (
    record.status === "failed" &&
    record.failureCode === "CONTEXT_BUDGET_EXCEEDED"
  ) {
    const expectedStatus =
      attempt.kind === "selection"
        ? "selecting"
        : attempt.kind === "plan"
          ? "planning"
          : attempt.kind === "implementation"
            ? "implementing"
            : attempt.kind === "fix"
              ? "fixing"
              : "reviewing";
    if (state.blockedFrom === expectedStatus) {
      return decided(
        true,
        `Context-budget-blocked ${attempt.kind} attempt ${attempt.id} can be retried explicitly after policy or authorized input changes because no vendor process started.`,
        attempt.id
      );
    }
  }
  if (attempt.mutable) {
    const checkpoint = state.planTaskCompletion;
    if (record.status === "pending_application") {
      return decided(
        false,
        "Completion publication for this attempt is pending; use banzai resume to reconcile it without another model call, or cancel the run.",
        attempt.id
      );
    }
    if (
      ((attempt.kind === "implementation" &&
        state.blockedFrom === "implementing") ||
        (attempt.kind === "fix" && state.blockedFrom === "fixing")) &&
      record.status === "failed" &&
      // The runner itself classified this failure as completion evidence
      // when it wrote the invalid checkpoint: a result rejected by ledger
      // validation keeps its decoded evidence, and a result whose decode
      // failed on a completion field keeps only the diagnostic — the repair
      // replaces the whole result either way, so neither is a dead end.
      record.failureCode === "PLAN_TASK_COMPLETION_INVALID" &&
      checkpoint?.status === "invalid" &&
      checkpoint.sourceAttemptId === attempt.id
    ) {
      return decided(
        true,
        PLAN_BUNDLE_COMPLETION_VIOLATIONS.has(checkpoint.violation)
          ? "The approved plan bundle is invalid; retry reruns planning for a corrected bundle and a new approval."
          : `Completion evidence for ${attempt.kind} attempt ${attempt.id} can be repaired with a new attempt.`,
        attempt.id
      );
    }
    return decided(
      false,
      "Failed mutable attempts cannot be retried because their repository side effects may be incomplete. Inspect the checkout, then cancel the run.",
      attempt.id
    );
  }
  const isRetryableInterruption = isRetryableInterruptedAttempt(
    attempt,
    record
  );
  if (record.status !== "failed" && !isRetryableInterruption) {
    return decided(
      false,
      record.status === "started"
        ? "Interrupted attempts cannot be retried automatically. Inspect the checkout, then cancel the run."
        : `Attempt ${attempt.id} is ${record.status}, not failed.`,
      attempt.id
    );
  }
  const expectedStatus =
    attempt.kind === "selection"
      ? "selecting"
      : attempt.kind === "plan"
        ? "planning"
        : attempt.kind === "implementation"
          ? "implementing"
          : attempt.kind === "review"
            ? "reviewing"
            : null;
  if (expectedStatus === null || state.blockedFrom !== expectedStatus) {
    return decided(
      false,
      `The failed ${attempt.kind} attempt is inconsistent with blockedFrom=${state.blockedFrom ?? "null"}.`,
      attempt.id
    );
  }
  return decided(
    true,
    record.status === "started"
      ? `Interrupted ${attempt.kind} attempt ${attempt.id} can be retried explicitly because it was read-only.`
      : `Failed ${attempt.kind} attempt ${attempt.id} can be retried explicitly.`,
    attempt.id
  );
}
