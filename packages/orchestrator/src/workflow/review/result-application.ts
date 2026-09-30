import { BanzaiError } from "../../errors.js";
import type { ReviewResult, RunState } from "../../types.js";

export function validateReviewResultForApplication(
  state: RunState,
  result: ReviewResult
): void {
  const expectedPrefix = `R${state.reviewIteration}-F`;
  if (
    result.findings.some((finding) => !finding.id.startsWith(expectedPrefix))
  ) {
    throw new BanzaiError(
      "FINDING_ITERATION_MISMATCH",
      `Review ${state.reviewIteration} returned an invalid finding id.`
    );
  }
  const acceptedPrevious =
    state.triage?.items
      .filter((item) => item.disposition === "accepted")
      .map((item) => item.findingId) ?? [];
  if (
    state.triage !== null &&
    !(result.schemaVersion === 2 && result.verdict === "blocked") &&
    acceptedPrevious.some((id) => !result.reviewedFindingIds.includes(id))
  ) {
    throw new BanzaiError(
      "INCOMPLETE_REREVIEW",
      "Re-review did not report every previously accepted finding id."
    );
  }
}
