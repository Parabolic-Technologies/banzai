import type {
  ReviewFinding,
  ReviewMode,
  ReviewRotationReason,
  ReviewVerdict,
  RunStatus,
  SessionMode
} from "./types.js";

/**
 * Plain-English renderings of the run's internal vocabulary, for human output
 * only. `--json`, the agent-control surface, and every persisted artifact keep
 * the exact tokens; nothing here is ever parsed back.
 *
 * The tokens are precise and correct. They are also the sentences a newcomer
 * most reliably misreads: `rotation=previous-review-failed` and
 * `Sessions: fresh=6, resumed=5` read as errors when they are not.
 */

const REVIEW_SEVERITY_TEXT: Record<ReviewFinding["severity"], string> = {
  blocker: "blocker",
  should_fix: "should fix",
  nit: "nit"
};

/** The severity as a reader says it aloud; `should_fix` is the only one that
 * needs saying differently. */
export function reviewSeverityText(
  severity: ReviewFinding["severity"]
): string {
  return REVIEW_SEVERITY_TEXT[severity];
}

const RUN_STATUS_TEXT: Record<RunStatus, string> = {
  created: "Starting",
  selecting: "Choosing a workflow",
  planning: "Planning",
  needs_adr_approval: "Waiting for an architecture decision",
  needs_plan_approval: "Waiting for plan approval",
  needs_human_decision: "Waiting for an answer",
  plan_approved: "Plan approved",
  implementing: "Implementing",
  verifying: "Running verification",
  reviewing: "Reviewing",
  needs_triage: "Waiting for finding triage",
  fixing: "Fixing accepted findings",
  done: "Done",
  blocked: "Blocked",
  cancelled: "Cancelled"
};

const REVIEW_VERDICT_TEXT: Record<ReviewVerdict, string> = {
  pass: "passed",
  changes_requested: "changes requested",
  replan_required: "replan required",
  blocked: "blocked"
};

const ROTATION_TEXT: Record<ReviewRotationReason, string> = {
  "output-contract-not-reusable":
    "the reviewer output contract cannot be safely reused",
  "primary-review": "this is the first review of the change",
  "missing-session": "the previous reviewer session was no longer available",
  "settings-changed": "the reviewer model or effort changed",
  "approval-changed": "the approved plan bundle changed",
  "previous-review-failed": "the previous review attempt failed",
  "previous-review-interrupted": "the previous review attempt was interrupted",
  "previous-review-blocked": "the previous review attempt was blocked",
  "accepted-high-risk-finding": "a high-risk finding was accepted for fixing",
  "delta-limit-reached": "the run reached its limit of incremental reviews",
  "session-inventory-changed": "the reviewer's session inventory changed",
  "unreliable-review": "the previous review could not be trusted"
};

export function runStatusText(status: RunStatus): string {
  return RUN_STATUS_TEXT[status];
}

/**
 * The plain rendering, but only when it says more than the token already does.
 * Seven of the fifteen statuses differ from their token by capitalization
 * alone, and `Status: done (Done)` reads as a bug rather than as a gloss.
 */
export function runStatusGloss(status: RunStatus): string | null {
  const text = RUN_STATUS_TEXT[status];
  return text.toLowerCase() === status.replaceAll("_", " ") ? null : text;
}

export function reviewVerdictText(verdict: ReviewVerdict): string {
  return REVIEW_VERDICT_TEXT[verdict];
}

/**
 * How a review ran, as a sentence. `full/fresh (rotation=previous-review-failed)`
 * names three orthogonal facts in a form that assumes the reader already knows
 * what all three mean.
 */
export function reviewExecutionText(
  mode: ReviewMode,
  sessionMode: SessionMode,
  rotationReason: ReviewRotationReason | null
): string {
  const scope =
    mode === "full"
      ? "Reviewed the whole change"
      : "Reviewed only what changed since the last review";
  const session =
    sessionMode === "fresh"
      ? "from a clean session"
      : "continuing the reviewer's session";
  const because =
    rotationReason === null ? "" : `, because ${ROTATION_TEXT[rotationReason]}`;
  return `${scope} ${session}${because}.`;
}

/** Why the next review will start over instead of continuing. */
export function pendingRotationText(reason: ReviewRotationReason): string {
  return `The next review starts over from a clean session, because ${ROTATION_TEXT[reason]}.`;
}
