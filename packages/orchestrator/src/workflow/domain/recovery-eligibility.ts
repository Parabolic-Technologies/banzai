import type { AttemptRecord, AttemptReference, RunState } from "../../types.js";
import { RECOVERABLE_MUTABLE_FAILURE_CAUSES } from "./failure-classes.js";

export interface RecoveryEligibility {
  eligible: boolean;
  terminalCheckpointPresent?: boolean;
  reason: string;
  warning: string;
  sourceKind:
    "interrupted" | "prerequisite_blocked_fix" | "digest_rejected" | null;
  attemptId: string | null;
  phase: "plan" | "implementation" | "fix" | null;
  resolvedFindingIds: string[];
  remainingFindingIds: string[];
  prerequisites: string[];
  authorization: "plan_approval" | "workflow_selection" | null;
  recoveryIdentity: string | null;
  workspace: {
    digest: string;
    added: number;
    modified: number;
    deleted: number;
    total: number;
  } | null;
  baseCommit: string | null;
  approvalDigest: string | null;
  workflowDigest: string | null;
  scopeDigest: string | null;
  configurationDigest: string | null;
}

export const RECOVERY_WARNING =
  "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.";

export function recoveryIneligible(
  reason: string,
  attemptId: string | null = null,
  phase: RecoveryEligibility["phase"] = null,
  terminalCheckpointPresent = false
): RecoveryEligibility {
  return {
    eligible: false,
    terminalCheckpointPresent,
    reason,
    warning: RECOVERY_WARNING,
    sourceKind: null,
    attemptId,
    phase,
    resolvedFindingIds: [],
    remainingFindingIds: [],
    prerequisites: [],
    authorization: null,
    recoveryIdentity: null,
    workspace: null,
    baseCommit: null,
    approvalDigest: null,
    workflowDigest: null,
    scopeDigest: null,
    configurationDigest: null
  };
}

/** Change counts of the current workspace and the identity digested with them. */
export interface RecoveryCounts {
  added: number;
  modified: number;
  deleted: number;
  total: number;
  recoveryIdentity: string;
}

/**
 * Preconditions every recovery source reads the same way. The runner gathers
 * each value; digests come from the runner because their modules are not
 * domain modules.
 */
export interface RecoveryPreconditionFacts {
  headCommit?: string;
  configurationDigest?: string;
  approvalChecked?: boolean;
  workflowDigest?: string;
  completionRevalidated?: boolean;
  /** The attempt scope digest; null for an unbound attempt other than a fix. */
  scopeDigest?: string | null;
  workspace?: { baseCommit: string; digest: string };
  counts?: RecoveryCounts;
  authorization?: { attemptId: string; recoveryIdentity: string };
}

/** The exact value the runner digests into a recovery identity. */
export interface RecoveryIdentity {
  version: 1 | 2;
  sourceKind?: "digest_rejected" | "prerequisite_blocked_fix";
  runId: string;
  attempt: AttemptReference;
  phase: "plan" | "implementation" | "fix";
  baseCommit: string;
  workspaceDigest: string;
  approvalDigest: string | null;
  workflowDigest: string | null;
  scopeDigest: string | null;
  configurationDigest: string;
  /** The digest of a digest-rejected source's acceptance evidence. */
  digestEvidence?: string;
}

/** A precondition the runner gathers inside the source's error scope. */
export type RecoveryPreconditionStep =
  | {
      kind: "needs";
      evidence:
        | "head_commit"
        | "approval_check"
        | "workflow_selection_check"
        | "workspace_snapshot";
    }
  | {
      kind: "needs";
      evidence: "configuration";
      role: "planner" | "implementer";
    }
  | {
      kind: "needs";
      evidence: "completion_revalidation";
      allowReportRefresh: boolean;
      persistReportRefresh: boolean;
    }
  | {
      kind: "needs";
      evidence: "attempt_scope_digest";
      attempt: AttemptReference;
    }
  | { kind: "needs"; evidence: "workspace_counts"; identity: RecoveryIdentity }
  | {
      kind: "needs";
      evidence: "recovery_authorization";
      authorizationId: string;
    };

/** Whether a recorded model process is still running. */
export interface ProcessLivenessStep {
  kind: "needs";
  evidence: "process_liveness";
  pid: number;
}

/** The result of the tail every source shares. */
export type RecoveryWorkspaceStep =
  | RecoveryPreconditionStep
  | { kind: "ineligible"; reason: string }
  | {
      kind: "ready";
      workspace: NonNullable<RecoveryEligibility["workspace"]>;
      recoveryIdentity: string;
    };

/**
 * The tail every recovery source shares, in baseline order: the workspace
 * snapshot and its base commit, the change counts with the identity digested
 * from them, then any persisted authorization for the same attempt.
 */
export function decideRecoveryWorkspace(
  facts: RecoveryPreconditionFacts,
  state: RunState,
  identity: Omit<RecoveryIdentity, "workspaceDigest">
): RecoveryWorkspaceStep {
  const workspace = facts.workspace;
  if (workspace === undefined)
    return { kind: "needs", evidence: "workspace_snapshot" };
  if (workspace.baseCommit !== state.baseCommit)
    return {
      kind: "ineligible",
      reason:
        "Recovery is unavailable because the workspace base commit changed."
    };
  const counts = facts.counts;
  if (counts === undefined)
    return {
      kind: "needs",
      evidence: "workspace_counts",
      identity: { ...identity, workspaceDigest: workspace.digest }
    };
  if (
    state.recovery?.sourceAttemptId === identity.attempt.id &&
    state.recovery.recoveryAttemptId === null
  ) {
    const authorization = facts.authorization;
    if (authorization === undefined)
      return {
        kind: "needs",
        evidence: "recovery_authorization",
        authorizationId: state.recovery.authorizationId
      };
    if (
      authorization.attemptId !== identity.attempt.id ||
      authorization.recoveryIdentity !== counts.recoveryIdentity
    )
      return {
        kind: "ineligible",
        reason: "Persisted recovery authorization is stale or inconsistent."
      };
  }
  return {
    kind: "ready",
    workspace: {
      digest: workspace.digest,
      added: counts.added,
      modified: counts.modified,
      deleted: counts.deleted,
      total: counts.total
    },
    recoveryIdentity: counts.recoveryIdentity
  };
}

export interface RecoveryFacts extends RecoveryPreconditionFacts {
  state: RunState;
  /** The digest-rejected source's own decision; null when it does not apply. */
  digestRejected?: RecoveryEligibility | null;
  /** The prerequisite-blocked fix source's own decision. */
  prerequisiteBlockedFix?: RecoveryEligibility;
  processAlive?: boolean;
  attemptRecord?:
    { readable: true; record: AttemptRecord } | { readable: false };
  terminalCheckpoint?:
    { readable: true; present: boolean } | { readable: false };
  /**
   * Set when anything in the precondition region failed: reading HEAD, the
   * configuration, the approval or selection checks, completion revalidation,
   * the workspace or the authorization. The runner treats any such failure as
   * one unvalidated precondition.
   */
  preconditionsFailed?: boolean;
}

export type RecoveryStep =
  | { kind: "decided"; eligibility: RecoveryEligibility }
  | { kind: "needs"; evidence: "prerequisite_blocked_fix_source" }
  | {
      kind: "needs";
      evidence:
        "digest_rejected_source" | "attempt_record" | "terminal_checkpoint";
      attempt: AttemptReference;
    }
  | ProcessLivenessStep
  | RecoveryPreconditionStep;

/** Evidence the shell gathers, in baseline order, only when the rule names it. */
export type RecoveryEvidence = Exclude<
  RecoveryStep,
  { kind: "decided" }
>["evidence"];

const decided = (eligibility: RecoveryEligibility): RecoveryStep => ({
  kind: "decided",
  eligibility
});

/**
 * Which recovery source applies to a blocked run and whether it may be
 * authorized. Sources are consulted in baseline order: a digest-rejected
 * result, a completed prerequisite-blocked fix, then an interrupted mutable
 * attempt.
 */
export function decideRecovery(facts: RecoveryFacts): RecoveryStep {
  const { state } = facts;
  if (state.status !== "blocked") {
    return decided(
      recoveryIneligible(
        `Recovery requires a blocked run, but the run is ${state.status}.`
      )
    );
  }
  const attempt = state.activeAttempt;
  if (attempt !== null) {
    if (facts.digestRejected === undefined)
      return { kind: "needs", evidence: "digest_rejected_source", attempt };
    if (facts.digestRejected !== null) return decided(facts.digestRejected);
  }
  if (attempt === null && state.blockedFrom === "fixing") {
    if (facts.prerequisiteBlockedFix === undefined)
      return { kind: "needs", evidence: "prerequisite_blocked_fix_source" };
    return decided(facts.prerequisiteBlockedFix);
  }
  if (
    attempt === null ||
    !attempt.mutable ||
    (attempt.kind !== "implementation" && attempt.kind !== "fix")
  ) {
    return decided(
      recoveryIneligible(
        "Recovery requires an interrupted mutable implementation or fix attempt.",
        attempt?.id ?? null
      )
    );
  }
  return decideInterrupted(facts, attempt, attempt.kind);
}

function decideInterrupted(
  facts: RecoveryFacts,
  attempt: AttemptReference,
  phase: "implementation" | "fix"
): RecoveryStep {
  const { state } = facts;
  const ineligible = (reason: string, terminalCheckpointPresent = false) =>
    decided(
      recoveryIneligible(reason, attempt.id, phase, terminalCheckpointPresent)
    );
  const expectedBlockedFrom =
    phase === "implementation" ? "implementing" : "fixing";
  if (state.blockedFrom !== expectedBlockedFrom) {
    return ineligible(
      `The interrupted ${phase} attempt is inconsistent with blockedFrom=${state.blockedFrom ?? "null"}.`
    );
  }
  if (state.activeProcess !== null) {
    if (facts.processAlive === undefined)
      return {
        kind: "needs",
        evidence: "process_liveness",
        pid: state.activeProcess.pid
      };
    if (facts.processAlive)
      return ineligible(
        "Recovery is unavailable while the model process is still active."
      );
  }
  const read = facts.attemptRecord;
  if (read === undefined)
    return { kind: "needs", evidence: "attempt_record", attempt };
  if (!read.readable)
    return ineligible(
      "Recovery attempt evidence is unreadable or inconsistent."
    );
  const record = read.record;
  const checkpoint = facts.terminalCheckpoint;
  if (checkpoint === undefined)
    return { kind: "needs", evidence: "terminal_checkpoint", attempt };
  if (!checkpoint.readable)
    return ineligible(
      "Terminal checkpoint evidence is malformed or conflicting; inspect or cancel the run."
    );
  if (checkpoint.present) {
    const completionEvidenceRejected =
      record.status === "failed" &&
      record.result !== null &&
      record.failureCode === "PLAN_TASK_COMPLETION_INVALID" &&
      state.planTaskCompletion?.status === "invalid" &&
      state.planTaskCompletion.sourceAttemptId === attempt.id;
    return ineligible(
      completionEvidenceRejected
        ? "The terminal checkpoint result was rejected by completion validation; use banzai retry to repair its evidence."
        : "A terminal checkpoint exists; use banzai resume so Banzai can reconcile proven completion.",
      true
    );
  }
  const recoverableFailedAttempt =
    record.status === "failed" &&
    record.failureCause !== null &&
    record.failureCause !== undefined &&
    RECOVERABLE_MUTABLE_FAILURE_CAUSES.has(record.failureCause);
  if (
    (record.status !== "started" &&
      record.status !== "interrupted" &&
      !recoverableFailedAttempt) ||
    record.result !== null
  ) {
    return ineligible(
      `Attempt ${attempt.id} is not an uncompleted interruption.`
    );
  }
  if (
    state.recovery?.sourceAttemptId === attempt.id &&
    state.recovery.recoveryAttemptId !== null
  ) {
    return ineligible(
      "A later recovery attempt already supersedes this interruption."
    );
  }
  return decideInterruptedPreconditions(facts, attempt, phase);
}

function decideInterruptedPreconditions(
  facts: RecoveryFacts,
  attempt: AttemptReference,
  phase: "implementation" | "fix"
): RecoveryStep {
  const { state } = facts;
  const ineligible = (reason: string) =>
    decided(recoveryIneligible(reason, attempt.id, phase));
  if (facts.preconditionsFailed === true)
    return ineligible(
      "Recovery preconditions could not be validated; inspect or cancel the run."
    );
  if (facts.headCommit === undefined)
    return { kind: "needs", evidence: "head_commit" };
  if (facts.headCommit !== state.baseCommit)
    return ineligible("Recovery is unavailable because checkout HEAD changed.");
  if (facts.configurationDigest === undefined)
    return { kind: "needs", evidence: "configuration", role: "implementer" };
  const route = state.workflowSelection?.workflow ?? "strict";
  const approvalRoute = route === "strict" || phase === "fix";
  if (approvalRoute && facts.approvalChecked !== true)
    return { kind: "needs", evidence: "approval_check" };
  if (!approvalRoute && facts.workflowDigest === undefined)
    return { kind: "needs", evidence: "workflow_selection_check" };
  const approvalDigest = approvalRoute
    ? (state.planApproval?.digest ?? null)
    : null;
  const workflowDigest = approvalRoute ? null : (facts.workflowDigest ?? null);
  if (phase === "fix") {
    if (facts.completionRevalidated !== true)
      return {
        kind: "needs",
        evidence: "completion_revalidation",
        allowReportRefresh: false,
        persistReportRefresh: true
      };
    if (!state.triage?.items.some((item) => item.disposition === "accepted"))
      return ineligible(
        "Fix recovery requires a non-empty current accepted-finding scope."
      );
  }
  const scopeDigest = facts.scopeDigest;
  if (scopeDigest === undefined)
    return { kind: "needs", evidence: "attempt_scope_digest", attempt };
  const tail = decideRecoveryWorkspace(facts, state, {
    version: 1,
    runId: state.runId,
    attempt,
    phase,
    baseCommit: state.baseCommit,
    approvalDigest,
    workflowDigest,
    scopeDigest,
    configurationDigest: facts.configurationDigest
  });
  if (tail.kind === "needs") return tail;
  if (tail.kind === "ineligible") return ineligible(tail.reason);
  return decided({
    eligible: true,
    reason: `Interrupted ${phase} attempt ${attempt.id} may be recovered only with current explicit authorization.`,
    warning: RECOVERY_WARNING,
    sourceKind: "interrupted",
    attemptId: attempt.id,
    phase,
    resolvedFindingIds: [],
    remainingFindingIds: [],
    prerequisites: [],
    authorization:
      approvalDigest === null ? "workflow_selection" : "plan_approval",
    recoveryIdentity: tail.recoveryIdentity,
    workspace: tail.workspace,
    baseCommit: state.baseCommit,
    approvalDigest,
    workflowDigest,
    scopeDigest,
    configurationDigest: facts.configurationDigest
  });
}
