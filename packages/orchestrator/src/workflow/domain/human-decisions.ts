import { BanzaiError } from "../../errors.js";
import type { HumanDecisionRequest } from "../../types.js";

export function humanDecisionQuestions(
  pending: HumanDecisionRequest,
  liteWorkflow: boolean
): string[] {
  if (pending.kind === "configuration_prerequisite") return [];
  if (pending.kind === "decision_consultation") {
    return pending.request.decisions.map((decision) => decision.question);
  }
  if (pending.questions.length > 0) {
    return [...pending.questions];
  }
  return [
    liteWorkflow
      ? "What decision should workflow reselection apply?"
      : "What decision or approval should planning apply?"
  ];
}

const UNSAFE_HUMAN_DECISION_CONTROL =
  /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u;

export function decisionText(
  value: unknown,
  label: string,
  maximum: number,
  allowNewlines = false
): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximum ||
    value.trim().length === 0 ||
    UNSAFE_HUMAN_DECISION_CONTROL.test(value) ||
    (!allowNewlines && /[\r\n]/u.test(value))
  ) {
    throw new BanzaiError(
      "INVALID_DECISION",
      `${label} must be a bounded non-empty safe string.`
    );
  }
  return value;
}

export function decisionIdentifier(
  value: unknown,
  label: string,
  maximum = 128
): string {
  const identifier = decisionText(value, label, maximum);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(identifier)) {
    throw new BanzaiError(
      "INVALID_DECISION",
      `${label} must be a canonical identifier.`
    );
  }
  return identifier;
}
