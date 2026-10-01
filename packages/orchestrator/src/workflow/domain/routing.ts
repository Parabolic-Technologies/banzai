import type {
  AttemptReference,
  TerminalResultContract,
  WorkflowRoute,
  WorkflowSelectionResult
} from "../../types.js";

export function effectiveWorkflow(
  result: WorkflowSelectionResult
): WorkflowRoute {
  if (
    result.recommendedWorkflow !== "strict" &&
    result.confidence === "high" &&
    result.escalationTriggers.length === 0
  ) {
    return result.recommendedWorkflow;
  }
  return "strict";
}

export function terminalResultContract(
  kind: AttemptReference["kind"],
  taskMode = false
): TerminalResultContract {
  return kind === "selection"
    ? "workflow-selection/v1"
    : kind === "review"
      ? "review-result/v2"
      : taskMode
        ? "phase-result/v4"
        : "phase-result/v3";
}
