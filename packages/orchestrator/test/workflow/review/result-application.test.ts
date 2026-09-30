import assert from "node:assert/strict";
import test from "node:test";
import type { ReviewResult, RunState } from "../../../src/types.js";
import { validateReviewResultForApplication } from "../../../src/workflow/review/result-application.js";

function review(overrides: Partial<ReviewResult> = {}): ReviewResult {
  return {
    verdict: "changes_requested",
    findings: [],
    reviewedFindingIds: [],
    ...overrides
  } as ReviewResult;
}

function state(triage: RunState["triage"]): RunState {
  return { reviewIteration: 2, triage } as unknown as RunState;
}

const ACCEPTED = {
  items: [
    { findingId: "R1-F1", disposition: "accepted" },
    { findingId: "R1-F2", disposition: "rejected" }
  ]
} as unknown as RunState["triage"];

test("a review result must use its own iteration's finding identifiers", () => {
  assert.throws(
    () => {
      validateReviewResultForApplication(
        state(null),
        review({
          findings: [{ id: "R1-F9" }] as unknown as ReviewResult["findings"]
        })
      );
    },
    {
      code: "FINDING_ITERATION_MISMATCH",
      message: "Review 2 returned an invalid finding id."
    }
  );
});

test("a re-review must report every previously accepted finding unless it is blocked", () => {
  assert.throws(
    () => {
      validateReviewResultForApplication(state(ACCEPTED), review());
    },
    {
      code: "INCOMPLETE_REREVIEW",
      message: "Re-review did not report every previously accepted finding id."
    }
  );
  assert.doesNotThrow(() => {
    validateReviewResultForApplication(
      state(ACCEPTED),
      review({ reviewedFindingIds: ["R1-F1"] })
    );
  });
  assert.doesNotThrow(() => {
    validateReviewResultForApplication(
      state(ACCEPTED),
      review({ schemaVersion: 2, verdict: "blocked" })
    );
  });
});
