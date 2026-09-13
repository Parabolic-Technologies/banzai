import assert from "node:assert/strict";
import test from "node:test";
import type {
  ReviewRotationReason,
  ReviewVerdict,
  RunStatus
} from "../src/types.js";
import {
  pendingRotationText,
  reviewExecutionText,
  reviewVerdictText,
  runStatusText
} from "../src/vocabulary.js";

const ROTATION_REASONS: ReviewRotationReason[] = [
  "primary-review",
  "missing-session",
  "settings-changed",
  "approval-changed",
  "previous-review-failed",
  "previous-review-interrupted",
  "previous-review-blocked",
  "accepted-high-risk-finding",
  "delta-limit-reached",
  "session-inventory-changed",
  "unreliable-review"
];

const RUN_STATUSES: RunStatus[] = [
  "created",
  "selecting",
  "planning",
  "needs_adr_approval",
  "needs_plan_approval",
  "needs_human_decision",
  "plan_approved",
  "implementing",
  "verifying",
  "reviewing",
  "needs_triage",
  "fixing",
  "done",
  "blocked",
  "cancelled"
];

const VERDICTS: ReviewVerdict[] = [
  "pass",
  "changes_requested",
  "replan_required",
  "blocked"
];

test("every internal token has a plain rendering", () => {
  // A missing entry would surface as `undefined` in the summary, so cover the
  // whole vocabulary rather than the cases that happen to be exercised.
  for (const status of RUN_STATUSES) {
    assert.match(runStatusText(status), /^[A-Z]/);
  }
  for (const verdict of VERDICTS) {
    assert.ok(reviewVerdictText(verdict).length > 0);
  }
  for (const reason of ROTATION_REASONS) {
    const sentence = pendingRotationText(reason);
    assert.ok(sentence.startsWith("The next review starts over"));
    assert.ok(sentence.endsWith("."));
    assert.equal(sentence.includes("undefined"), false);
    // The internal token itself never reaches the sentence.
    assert.equal(sentence.includes(reason), false);
  }
});

test("review execution names scope, session, and cause as one sentence", () => {
  assert.equal(
    reviewExecutionText("full", "fresh", "previous-review-failed"),
    "Reviewed the whole change from a clean session, because the previous review attempt failed."
  );
  assert.equal(
    reviewExecutionText("delta", "resumed", null),
    "Reviewed only what changed since the last review continuing the reviewer's session."
  );
  // Every combination stays a complete sentence.
  for (const mode of ["full", "delta"] as const) {
    for (const session of ["fresh", "resumed"] as const) {
      for (const reason of [null, ...ROTATION_REASONS]) {
        const sentence = reviewExecutionText(mode, session, reason);
        assert.ok(sentence.endsWith("."));
        assert.equal(sentence.includes("undefined"), false);
      }
    }
  }
});
