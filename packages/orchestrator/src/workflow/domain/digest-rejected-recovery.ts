import type {
  AttemptRecord,
  AttemptReference,
  ResultDigestEvidence,
  RunState
} from "../../types.js";
import { DIGEST_REJECTED_FAILURE_CODES } from "./failure-classes.js";
import {
  decideRecoveryWorkspace,
  type ProcessLivenessStep,
  type RecoveryEligibility,
  recoveryIneligible,
  type RecoveryPreconditionFacts,
  type RecoveryPreconditionStep
} from "./recovery-eligibility.js";

export interface DigestRejectedFacts extends RecoveryPreconditionFacts {
  state: RunState;
  attempt: AttemptReference;
  /**
   * The attempt record and its acceptance evidence, read together. An
   * unreadable pair carries the message of an evidence-invalid error, and
   * null for any other failure.
   */
  source?:
    | {
        readable: true;
        record: AttemptRecord;
        evidence: ResultDigestEvidence | null;
      }
    | { readable: false; invalidEvidenceMessage: string | null };
  processAlive?: boolean;
  /**
   * Set when anything after the liveness check failed. The source then
   * reports one unvalidated precondition.
   */
  preconditionsFailed?: boolean;
  terminalCheckpointPresent?: boolean;
  attempts?: AttemptRecord[];
  /** Whether the persisted workflow selection still carries its own digest. */
  workflowSelectionAuthorized?: boolean;
  evidenceDigest?: string;
}

export type DigestRejectedStep =
  | { kind: "decided"; eligibility: RecoveryEligibility | null }
  | { kind: "needs"; evidence: "digest_source" }
  | { kind: "needs"; evidence: "terminal_checkpoint" }
  | { kind: "needs"; evidence: "attempt_history" }
  | {
      kind: "needs";
      evidence: "workflow_authorization";
      selection: NonNullable<RunState["workflowSelection"]>;
    }
  | {
      kind: "needs";
      evidence: "evidence_digest";
      digestEvidence: ResultDigestEvidence;
    }
  | ProcessLivenessStep
  | RecoveryPreconditionStep;

export type DigestRejectedEvidence = Exclude<
  DigestRejectedStep,
  { kind: "decided" }
>["evidence"];

const decided = (
  eligibility: RecoveryEligibility | null
): DigestRejectedStep => ({ kind: "decided", eligibility });

/**
 * ADR-0051's digest-rejected source, recognized from durable evidence only:
 * a failed attempt whose sole recorded failure is a digest rejection at
 * acceptance, whose terminal checkpoint proves its repository changes are
 * complete rather than partial, and which no successor has replaced.
 * Decides null when the source does not apply, leaving every existing
 * disposition — including the refusal of a failed mutable attempt with
 * unknown side effects — exactly as it is.
 */
export function decideDigestRejected(
  facts: DigestRejectedFacts
): DigestRejectedStep {
  const { state, attempt } = facts;
  if (
    attempt.kind !== "plan" &&
    attempt.kind !== "implementation" &&
    attempt.kind !== "fix"
  )
    return decided(null);
  const phase = attempt.kind;
  const expectedBlockedFrom =
    phase === "plan"
      ? "planning"
      : phase === "implementation"
        ? "implementing"
        : "fixing";
  if (state.blockedFrom !== expectedBlockedFrom) return decided(null);
  const ineligible = (reason: string, terminalCheckpointPresent = false) =>
    decided(
      recoveryIneligible(reason, attempt.id, phase, terminalCheckpointPresent)
    );
  const source = facts.source;
  if (source === undefined) return { kind: "needs", evidence: "digest_source" };
  if (!source.readable)
    return ineligible(
      source.invalidEvidenceMessage === null
        ? "Digest acceptance evidence is unreadable or inconsistent."
        : `${source.invalidEvidenceMessage} Audit the run before continuing.`
    );
  const { record, evidence } = source;
  // Absent evidence is never reconstructed from current bytes: a run blocked
  // before acceptance-time comparison existed has no baseline at all.
  if (
    evidence?.outcome !== "rejected" ||
    record.status !== "failed" ||
    !DIGEST_REJECTED_FAILURE_CODES.has(record.failureCode ?? "")
  )
    return decided(null);
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
  if (facts.preconditionsFailed === true)
    return ineligible(
      "Digest-rejected recovery preconditions could not be validated; inspect or cancel the run."
    );
  // A terminal checkpoint is what proves the attempt finished its work, so
  // its repository changes are known rather than partial.
  if (facts.terminalCheckpointPresent === undefined)
    return { kind: "needs", evidence: "terminal_checkpoint" };
  if (!facts.terminalCheckpointPresent)
    return ineligible(
      `The rejected ${phase} result has no terminal checkpoint, so its repository side effects are unknown. Inspect the checkout, then cancel the run.`
    );
  const attempts = facts.attempts;
  if (attempts === undefined)
    return { kind: "needs", evidence: "attempt_history" };
  if (
    attempts.some(
      (other) =>
        other.attempt.kind === attempt.kind &&
        other.attempt.id !== attempt.id &&
        Date.parse(other.startedAt) > Date.parse(record.startedAt)
    ) ||
    (state.recovery?.sourceAttemptId === attempt.id &&
      state.recovery.recoveryAttemptId !== null)
  )
    return ineligible(
      `A later ${phase} attempt already supersedes this rejected result.`,
      true
    );
  if (facts.headCommit === undefined)
    return { kind: "needs", evidence: "head_commit" };
  if (facts.headCommit !== state.baseCommit)
    return ineligible("Recovery is unavailable because checkout HEAD changed.");
  if (facts.configurationDigest === undefined)
    return {
      kind: "needs",
      evidence: "configuration",
      role: phase === "plan" ? "planner" : "implementer"
    };
  let approvalDigest: string | null = null;
  let workflowDigest: string | null = null;
  if (phase === "plan") {
    const selection = state.workflowSelection ?? null;
    workflowDigest = selection?.digest ?? null;
    if (selection !== null && facts.workflowSelectionAuthorized === undefined)
      return { kind: "needs", evidence: "workflow_authorization", selection };
    if (selection === null || facts.workflowSelectionAuthorized !== true)
      return ineligible(
        "Planning recovery requires the unchanged persisted workflow selection."
      );
  } else if (
    (state.workflowSelection?.workflow ?? "strict") === "strict" ||
    phase === "fix"
  ) {
    if (facts.approvalChecked !== true)
      return { kind: "needs", evidence: "approval_check" };
    approvalDigest = state.planApproval?.digest ?? null;
  } else {
    if (facts.workflowDigest === undefined)
      return { kind: "needs", evidence: "workflow_selection_check" };
    workflowDigest = facts.workflowDigest;
  }
  const scopeDigest = facts.scopeDigest;
  if (scopeDigest === undefined)
    return { kind: "needs", evidence: "attempt_scope_digest", attempt };
  const evidenceDigest = facts.evidenceDigest;
  if (evidenceDigest === undefined)
    return {
      kind: "needs",
      evidence: "evidence_digest",
      digestEvidence: evidence
    };
  const tail = decideRecoveryWorkspace(facts, state, {
    version: 1,
    sourceKind: "digest_rejected",
    runId: state.runId,
    attempt,
    phase,
    baseCommit: state.baseCommit,
    approvalDigest,
    workflowDigest,
    scopeDigest,
    configurationDigest: facts.configurationDigest,
    digestEvidence: evidenceDigest
  });
  if (tail.kind === "needs") return tail;
  if (tail.kind === "ineligible") return ineligible(tail.reason);
  return decided({
    eligible: true,
    terminalCheckpointPresent: true,
    reason: `The ${phase} result was refused because ${evidence.comparisons.filter((comparison) => !comparison.matched).length} digest it authored never matched the bytes it named. Recovery authorizes one linked ${phase} attempt to supply a corrected result; the rejected attempt and its result are retained.`,
    warning:
      "The rejected attempt keeps its failed status and its result. Recovery authorizes one new attempt for the same phase and no additional scope; a replacement strict plan still passes the existing approval gate.",
    sourceKind: "digest_rejected",
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
