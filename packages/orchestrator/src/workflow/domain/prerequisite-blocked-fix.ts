import type {
  AttemptRecord,
  AttemptReference,
  PersistedPhaseResult,
  ReviewResult,
  RunState
} from "../../types.js";
import {
  decideRecoveryWorkspace,
  type ProcessLivenessStep,
  type RecoveryEligibility,
  recoveryIneligible,
  type RecoveryPreconditionFacts,
  type RecoveryPreconditionStep
} from "./recovery-eligibility.js";

/** The exact remaining accepted scope a completed blocked fix proves. */
export interface PrerequisiteScope {
  attempt: AttemptReference & { kind: "fix"; mutable: true };
  reviewIteration: number;
  acceptedFindingIds: string[];
  resolvedFindingIds: string[];
  remainingFindingIds: string[];
  prerequisites: string[];
}

export interface PrerequisiteScopeFacts {
  state: RunState;
  record: AttemptRecord;
  /** Whether the result must restate the persisted block reason. */
  requirePersistedBlock: boolean;
  result?: PersistedPhaseResult;
  review?: ReviewResult;
}

export type PrerequisiteScopeStep =
  | {
      kind: "scoped";
      scope: PrerequisiteScope;
      result: PersistedPhaseResult;
      review: ReviewResult;
    }
  | {
      kind: "invalid";
      code: "RECOVERY_SOURCE_INVALID" | "RECOVERY_SCOPE_INVALID";
      message: string;
    }
  | { kind: "needs"; evidence: "phase_result"; raw: unknown }
  | { kind: "needs"; evidence: "latest_review" };

/**
 * The remaining accepted scope of one completed blocked fix. Every caller
 * uses this rule: source selection, recovery execution and the fix phase.
 */
export function decidePrerequisiteScope(
  facts: PrerequisiteScopeFacts
): PrerequisiteScopeStep {
  const { state, record } = facts;
  const attempt = record.attempt;
  if (
    attempt.kind !== "fix" ||
    !attempt.mutable ||
    record.status !== "completed" ||
    record.result === null ||
    (record.recoveryOf ?? null) !== null ||
    (record.recoveryAuthorizationId ?? null) !== null
  ) {
    return {
      kind: "invalid",
      code: "RECOVERY_SOURCE_INVALID",
      message:
        "Prerequisite recovery requires an unrecovered completed fix attempt."
    };
  }
  const result = facts.result;
  if (result === undefined)
    return { kind: "needs", evidence: "phase_result", raw: record.result };
  if (
    result.phase !== "fix" ||
    result.outcome !== "blocked" ||
    result.gate !== null ||
    result.taskCompletion !== null ||
    (facts.requirePersistedBlock && result.summary !== state.blockReason)
  ) {
    return {
      kind: "invalid",
      code: "RECOVERY_SOURCE_INVALID",
      message:
        "The completed fix result does not match the current prerequisite block."
    };
  }
  if (
    (state.workflowSelection?.workflow ?? "strict") !== "strict" ||
    state.latestReview === null ||
    state.triage === null ||
    state.reviewIteration !== state.latestReview.iteration ||
    state.triage.reviewIteration !== state.latestReview.iteration
  ) {
    return {
      kind: "invalid",
      code: "RECOVERY_SCOPE_INVALID",
      message:
        "Prerequisite recovery requires one current strict review and triage."
    };
  }
  const review = facts.review;
  if (review === undefined) return { kind: "needs", evidence: "latest_review" };
  const reviewFindingIds = review.findings.map((finding) => finding.id);
  const reviewFindingIdSet = new Set(reviewFindingIds);
  const triagedIds = state.triage.items.map((item) => item.findingId);
  if (
    new Set(triagedIds).size !== triagedIds.length ||
    triagedIds.length !== reviewFindingIds.length ||
    triagedIds.some((id) => !reviewFindingIdSet.has(id))
  ) {
    return {
      kind: "invalid",
      code: "RECOVERY_SCOPE_INVALID",
      message: "Current triage does not exactly cover the current review."
    };
  }
  const acceptedFindingIds = state.triage.items
    .filter((item) => item.disposition === "accepted")
    .map((item) => item.findingId)
    .sort();
  const acceptedFindingIdSet = new Set(acceptedFindingIds);
  const resolvedFindingIds = [...result.resolvedFindingIds].sort();
  if (
    acceptedFindingIds.length === 0 ||
    resolvedFindingIds.length === 0 ||
    new Set(resolvedFindingIds).size !== resolvedFindingIds.length ||
    resolvedFindingIds.some((id) => !acceptedFindingIdSet.has(id))
  ) {
    return {
      kind: "invalid",
      code: "RECOVERY_SCOPE_INVALID",
      message:
        "The blocked fix result does not prove valid partial accepted-finding progress."
    };
  }
  const resolvedFindingIdSet = new Set(resolvedFindingIds);
  const remainingFindingIds = acceptedFindingIds.filter(
    (id) => !resolvedFindingIdSet.has(id)
  );
  const prerequisites = [...result.questions, ...result.requestedVerification]
    .map((item) => item.trim())
    .filter((item) => {
      const referencedFindingIds = review.findings
        .filter((finding) => {
          const escaped = finding.id.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
          return (
            new RegExp(
              `(^|[^A-Za-z0-9_:-])${escaped}($|[^A-Za-z0-9_:-])`,
              "u"
            ).test(item) ||
            finding.evidence.some((evidence) => item.includes(evidence.path))
          );
        })
        .map((finding) => finding.id);
      return (
        referencedFindingIds.length === 0 ||
        referencedFindingIds.every((findingId) =>
          remainingFindingIds.includes(findingId)
        )
      );
    });
  if (
    remainingFindingIds.length === 0 ||
    prerequisites.length === 0 ||
    prerequisites.some((item) => item.length === 0)
  ) {
    return {
      kind: "invalid",
      code: "RECOVERY_SCOPE_INVALID",
      message:
        "The blocked fix result has no remaining accepted scope or concrete prerequisite."
    };
  }
  return {
    kind: "scoped",
    scope: {
      attempt: { id: attempt.id, kind: "fix", mutable: true },
      reviewIteration: state.latestReview.iteration,
      acceptedFindingIds,
      resolvedFindingIds,
      remainingFindingIds,
      prerequisites
    },
    result,
    review
  };
}

/**
 * A terminal checkpoint's recorded values beside the ones the candidate
 * source implies. The runner computes both digests of each pair.
 */
export interface PrerequisiteCheckpoint {
  baseCommit: string;
  approvalDigest: string | null;
  scopeDigest: string | null;
  resultDigest: string;
  expectedScopeDigest: string | null;
  sourceResultDigest: string;
}

export interface PrerequisiteSourceFacts<
  T extends Pick<PrerequisiteScope, "attempt">
> {
  state: RunState;
  records?: AttemptRecord[];
  /** Scopes of the named records; a record whose scope failed is absent. */
  candidates?: T[];
  checkpoint?: PrerequisiteCheckpoint | null;
}

export type PrerequisiteSourceStep<T> =
  | { kind: "decided"; source: T }
  | {
      kind: "invalid";
      code:
        | "RECOVERY_SOURCE_AMBIGUOUS"
        | "RECOVERY_ALREADY_STARTED"
        | "RECOVERY_STATE_CHANGED"
        | "INVALID_TERMINAL_CHECKPOINT";
      message: string;
    }
  | { kind: "needs"; evidence: "attempt_records" }
  | { kind: "needs"; evidence: "candidate_scopes"; records: AttemptRecord[] }
  | { kind: "needs"; evidence: "terminal_checkpoint"; source: T };

/**
 * The one completed blocked fix that exactly matches the current block.
 * Only an exact current completed-blocked result is a candidate; a malformed
 * or historical record cannot be used to reconstruct scope.
 */
export function decidePrerequisiteSource<
  T extends Pick<PrerequisiteScope, "attempt">
>(facts: PrerequisiteSourceFacts<T>): PrerequisiteSourceStep<T> {
  const { state, records } = facts;
  if (records === undefined)
    return { kind: "needs", evidence: "attempt_records" };
  const candidates = facts.candidates;
  if (candidates === undefined)
    return {
      kind: "needs",
      evidence: "candidate_scopes",
      records: records.filter(
        (record) =>
          record.attempt.kind === "fix" &&
          record.status === "completed" &&
          record.result !== null
      )
    };
  const source = candidates.length === 1 ? candidates[0] : undefined;
  if (source === undefined)
    return {
      kind: "invalid",
      code: "RECOVERY_SOURCE_AMBIGUOUS",
      message:
        candidates.length === 0
          ? "No exact completed prerequisite-blocked fix source is available."
          : "Multiple completed blocked fix attempts match the current review; recovery is ambiguous."
    };
  const descendants = records.filter(
    (record) => (record.recoveryOf ?? null) === source.attempt.id
  );
  const descendant = descendants[0];
  const preparedDescendant =
    descendants.length === 1 &&
    descendant !== undefined &&
    state.recovery?.sourceAttemptId === source.attempt.id &&
    state.recovery.recoveryAttemptId === null &&
    state.recovery.stage === "source_preserved" &&
    descendant.attempt.id ===
      `fix-recovery-${state.recovery.authorizationId.replace(/^recovery-/u, "")}` &&
    descendant.status === "started" &&
    descendant.result === null &&
    descendant.recoveryAuthorizationId === state.recovery.authorizationId;
  if (descendants.length > 0 && !preparedDescendant)
    return {
      kind: "invalid",
      code: "RECOVERY_ALREADY_STARTED",
      message:
        "A recovery descendant already exists for the completed blocked fix source."
    };
  if (
    state.recovery !== undefined &&
    state.recovery !== null &&
    (state.recovery.sourceAttemptId !== source.attempt.id ||
      state.recovery.recoveryAttemptId !== null)
  )
    return {
      kind: "invalid",
      code: "RECOVERY_STATE_CHANGED",
      message:
        "Persisted recovery state does not match the completed blocked fix source."
    };
  const checkpoint = facts.checkpoint;
  if (checkpoint === undefined)
    return { kind: "needs", evidence: "terminal_checkpoint", source };
  if (
    checkpoint !== null &&
    (checkpoint.baseCommit !== state.baseCommit ||
      checkpoint.approvalDigest !== state.planApproval?.digest ||
      checkpoint.scopeDigest !== checkpoint.expectedScopeDigest ||
      checkpoint.resultDigest !== checkpoint.sourceResultDigest)
  )
    return {
      kind: "invalid",
      code: "INVALID_TERMINAL_CHECKPOINT",
      message:
        "The completed blocked source conflicts with its terminal checkpoint."
    };
  return { kind: "decided", source };
}

export interface PrerequisiteBlockedFixFacts extends RecoveryPreconditionFacts {
  state: RunState;
  processAlive?: boolean;
  /**
   * A failed precondition: the message of a Banzai error, and null for any
   * other failure.
   */
  preconditionFailure?: { message: string | null };
  source?: PrerequisiteScope & { scopeDigest: string };
}

export type PrerequisiteBlockedFixStep =
  | { kind: "decided"; eligibility: RecoveryEligibility }
  | { kind: "needs"; evidence: "prerequisite_source" }
  | ProcessLivenessStep
  | RecoveryPreconditionStep;

export type PrerequisiteBlockedFixEvidence = Exclude<
  PrerequisiteBlockedFixStep,
  { kind: "decided" }
>["evidence"];

const PRECONDITION_REASON =
  "Prerequisite recovery requires a completed blocked fix with no active attempt or process.";

/** Whether a completed blocked fix may be recovered for its remaining scope. */
export function decidePrerequisiteBlockedFix(
  facts: PrerequisiteBlockedFixFacts
): PrerequisiteBlockedFixStep {
  const { state } = facts;
  const decided = (
    eligibility: RecoveryEligibility
  ): PrerequisiteBlockedFixStep => ({ kind: "decided", eligibility });
  if (state.blockedFrom !== "fixing" || state.activeAttempt !== null)
    return decided(recoveryIneligible(PRECONDITION_REASON, null, "fix"));
  if (state.activeProcess !== null) {
    if (facts.processAlive === undefined)
      return {
        kind: "needs",
        evidence: "process_liveness",
        pid: state.activeProcess.pid
      };
    if (facts.processAlive)
      return decided(recoveryIneligible(PRECONDITION_REASON, null, "fix"));
  }
  if (facts.preconditionFailure !== undefined)
    return decided(
      recoveryIneligible(
        facts.preconditionFailure.message ??
          "Prerequisite recovery preconditions could not be validated; inspect or cancel the run.",
        state.recovery?.sourceAttemptId ?? null,
        "fix"
      )
    );
  if (facts.headCommit === undefined)
    return { kind: "needs", evidence: "head_commit" };
  if (facts.headCommit !== state.baseCommit)
    return decided(
      recoveryIneligible(
        "Recovery is unavailable because checkout HEAD changed.",
        null,
        "fix"
      )
    );
  if (facts.approvalChecked !== true)
    return { kind: "needs", evidence: "approval_check" };
  if (facts.completionRevalidated !== true)
    return {
      kind: "needs",
      evidence: "completion_revalidation",
      allowReportRefresh: true,
      persistReportRefresh: false
    };
  const source = facts.source;
  if (source === undefined)
    return { kind: "needs", evidence: "prerequisite_source" };
  if (facts.configurationDigest === undefined)
    return { kind: "needs", evidence: "configuration", role: "implementer" };
  const approvalDigest = state.planApproval?.digest ?? null;
  const tail = decideRecoveryWorkspace(facts, state, {
    version: 2,
    sourceKind: "prerequisite_blocked_fix",
    runId: state.runId,
    attempt: source.attempt,
    phase: "fix",
    baseCommit: state.baseCommit,
    approvalDigest,
    workflowDigest: null,
    scopeDigest: source.scopeDigest,
    configurationDigest: facts.configurationDigest
  });
  if (tail.kind === "needs") return tail;
  if (tail.kind === "ineligible")
    return decided(recoveryIneligible(tail.reason, source.attempt.id, "fix"));
  return decided({
    eligible: true,
    reason: `Completed blocked fix attempt ${source.attempt.id} may be recovered for remaining accepted findings ${source.remainingFindingIds.join(", ")} after ${source.prerequisites.length} operator prerequisite${source.prerequisites.length === 1 ? "" : "s"}.`,
    warning:
      "The source attempt remains completed and blocked. Recovery authorizes one new fix attempt for the exact remaining accepted scope after the displayed prerequisites are addressed.",
    sourceKind: "prerequisite_blocked_fix",
    attemptId: source.attempt.id,
    phase: "fix",
    resolvedFindingIds: source.resolvedFindingIds,
    remainingFindingIds: source.remainingFindingIds,
    prerequisites: source.prerequisites,
    authorization: "plan_approval",
    recoveryIdentity: tail.recoveryIdentity,
    workspace: tail.workspace,
    baseCommit: state.baseCommit,
    approvalDigest,
    workflowDigest: null,
    scopeDigest: source.scopeDigest,
    configurationDigest: facts.configurationDigest
  });
}
