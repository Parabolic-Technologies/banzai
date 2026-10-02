import type {
  InvalidPlanTaskCompletionCheckpoint,
  PlanTaskCompletionViolation
} from "../../types.js";

export interface CompletionInvalidFacts {
  sourceAttemptId: string;
  sourceAttemptKind: "implementation" | "fix";
  violation: PlanTaskCompletionViolation;
  taskId: string | null;
  recordedAt: string;
}

// The field order is persisted in `state.json`; keep it stable.
export function completionInvalidCheckpoint(
  facts: CompletionInvalidFacts
): InvalidPlanTaskCompletionCheckpoint {
  return {
    schemaVersion: 1,
    status: "invalid",
    sourceAttemptId: facts.sourceAttemptId,
    sourceAttemptKind: facts.sourceAttemptKind,
    errorCode: "PLAN_TASK_COMPLETION_INVALID",
    violation: facts.violation,
    taskId: facts.taskId,
    recordedAt: facts.recordedAt
  };
}
