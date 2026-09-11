import { BanzaiError } from "./errors.js";
import type { RunState, RunStatus } from "./types.js";

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
  needs_plan_approval: ["plan_approved", "cancelled", "blocked"],
  needs_human_decision: ["selecting", "planning", "cancelled", "blocked"],
  plan_approved: ["implementing", "cancelled", "blocked"],
  implementing: ["needs_human_decision", "verifying", "cancelled", "blocked"],
  verifying: ["reviewing", "done", "cancelled", "blocked"],
  reviewing: ["needs_triage", "done", "cancelled", "blocked"],
  needs_triage: ["fixing", "done", "cancelled", "blocked"],
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
  if (!ALLOWED_TRANSITIONS[state.status].includes(next)) {
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
