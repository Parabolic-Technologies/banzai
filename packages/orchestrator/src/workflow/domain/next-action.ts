import type { RunState } from "../../types.js";

/** The retry facts next-action selection reads. */
export interface NextActionRetry {
  eligible: boolean;
}

/** The recovery facts next-action selection reads. */
export interface NextActionRecovery {
  eligible: boolean;
  sourceKind: string | null;
  terminalCheckpointPresent?: boolean;
}

/** The completion-publication route facts next-action selection reads. */
export interface NextActionPublication {
  pending: boolean;
  action: "resume" | "cancel" | null;
}

/** The single CLI command the status projection recommends, if any. */
export function nextAction(
  state: Pick<RunState, "status">,
  retry: NextActionRetry,
  recovery: NextActionRecovery,
  publication: NextActionPublication | null = null
): string | null {
  if (state.status === "needs_adr_approval") {
    return "banzai approve adr";
  }
  if (state.status === "needs_plan_approval") {
    return "banzai approve plan";
  }
  if (state.status === "needs_human_decision") {
    return "banzai";
  }
  if (state.status === "needs_triage") {
    return "banzai triage";
  }
  if (state.status === "blocked") {
    if (publication?.pending === true && publication.action !== null)
      return `banzai ${publication.action}`;
    // A digest-rejected result is repaired through its authorized recovery.
    // Replaying its terminal evidence reproduces the same rejection, so
    // eligibility outranks the mere presence of a terminal checkpoint.
    if (recovery.eligible && recovery.sourceKind === "digest_rejected")
      return "banzai recover";
    return retry.eligible
      ? "banzai retry"
      : recovery.eligible
        ? "banzai recover"
        : recovery.terminalCheckpointPresent === true
          ? "banzai resume"
          : "banzai cancel";
  }
  if (
    [
      "created",
      "selecting",
      "planning",
      "plan_approved",
      "implementing",
      "verifying",
      "reviewing",
      "fixing"
    ].includes(state.status)
  ) {
    return "banzai resume";
  }
  return null;
}
