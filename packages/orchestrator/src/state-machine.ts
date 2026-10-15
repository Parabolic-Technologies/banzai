import { BanzaiError } from "./errors.js";
import type { RunState, RunStatus } from "./types.js";
import { planningRestoreEligible } from "./workflow/domain/planning-review.js";

const ALLOWED_TRANSITIONS: Record<RunStatus, readonly RunStatus[]> = {
  created: ["selecting", "cancelled", "blocked"],
  selecting: ["planning", "implementing", "cancelled", "blocked"],
  planning: [
    "needs_adr_approval",
    "needs_plan_approval",
    "needs_human_decision",
    "blocked",
    "cancelled"
  ],
  needs_adr_approval: ["planning", "cancelled", "blocked"],
  needs_plan_approval: ["planning", "plan_approved", "cancelled", "blocked"],
  needs_human_decision: [
    "selecting",
    "planning",
    "verifying",
    "cancelled",
    "blocked"
  ],
  plan_approved: ["implementing", "cancelled", "blocked"],
  implementing: ["needs_human_decision", "verifying", "cancelled", "blocked"],
  verifying: [
    "needs_human_decision",
    "reviewing",
    "done",
    "cancelled",
    "blocked"
  ],
  reviewing: [
    "needs_human_decision",
    "verifying",
    "needs_triage",
    "done",
    "cancelled",
    "blocked"
  ],
  needs_triage: [
    "needs_human_decision",
    "verifying",
    "fixing",
    "done",
    "cancelled",
    "blocked"
  ],
  fixing: ["needs_human_decision", "verifying", "cancelled", "blocked"],
  done: [],
  blocked: [
    "created",
    "selecting",
    "planning",
    "plan_approved",
    "implementing",
    "verifying",
    "reviewing",
    "fixing",
    "cancelled"
  ],
  cancelled: []
};

export function transitionState(state: RunState, next: RunStatus): void {
  const pending = state.pendingHumanDecision;
  const laterConfigurationBoundary =
    (state.status === "reviewing" || state.status === "needs_triage") &&
    (next === "needs_human_decision" || next === "verifying");
  const configurationTransition =
    laterConfigurationBoundary ||
    (state.status === "needs_human_decision" && next === "verifying") ||
    (state.status === "verifying" && next === "needs_human_decision");
  const guided =
    state.schemaVersion === 6 ||
    (state.schemaVersion === 7 && state.configurationSetup !== undefined);
  if (
    configurationTransition &&
    (!guided ||
      (laterConfigurationBoundary && next === "verifying"
        ? state.pendingHumanDecision != null ||
          !["configured", "bootstrap_deferred"].includes(
            state.configurationSetup?.coverage ?? ""
          )
        : state.pendingHumanDecision?.kind !== "configuration_prerequisite") ||
      state.configurationSetup?.continuation === null ||
      state.configurationSetup?.continuation === undefined ||
      state.activeAttempt !== null ||
      state.activeProcess !== null ||
      (next === "verifying" &&
        !laterConfigurationBoundary &&
        !state.configurationSetup.resolutions.some(
          (resolution) =>
            pending?.kind === "configuration_prerequisite" &&
            resolution.proposalId === pending.proposalId
        )))
  ) {
    throw new BanzaiError(
      "INVALID_TRANSITION",
      "Only a validated configuration prerequisite checkpoint can use this continuation."
    );
  }
  if (
    !ALLOWED_TRANSITIONS[state.status].includes(next) &&
    !(
      state.status === "needs_human_decision" &&
      planningRestoreEligible(state, next)
    )
  ) {
    throw new BanzaiError(
      "INVALID_TRANSITION",
      `Cannot transition run ${state.runId} from ${state.status} to ${next}.`
    );
  }
  state.status = next;
  if (next !== "blocked") {
    state.blockedFrom = null;
    state.blockReason = null;
  }
}

export function blockState(state: RunState, reason: string): void {
  if (state.status === "done" || state.status === "cancelled") {
    throw new BanzaiError(
      "INVALID_TRANSITION",
      `Cannot block a ${state.status} run.`
    );
  }
  if (state.status !== "blocked") {
    state.blockedFrom = state.status;
    transitionState(state, "blocked");
  }
  state.blockReason = reason;
}

export function requireState(
  state: RunState,
  allowed: readonly RunStatus[],
  operation: string
): void {
  if (!allowed.includes(state.status)) {
    throw new BanzaiError(
      "INVALID_STATE",
      `${operation} requires ${allowed.join(" or ")}, but the run is ${state.status}.`
    );
  }
}
