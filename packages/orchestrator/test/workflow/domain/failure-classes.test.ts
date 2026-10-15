import assert from "node:assert/strict";
import test from "node:test";
import { BanzaiError } from "../../../src/errors.js";
import {
  checkFailureReason,
  isRetryableInterruptedAttempt
} from "../../../src/workflow/domain/failure-classes.js";
import type { AttemptRecord } from "../../../src/types.js";

test("both read-only planning kinds can retry an interruption without mutable recovery", () => {
  for (const kind of ["planning_review", "planning_analysis"] as const) {
    const attempt = { id: `${kind}-1`, kind, mutable: false };
    assert.equal(
      isRetryableInterruptedAttempt(attempt, {
        status: "started"
      } as AttemptRecord),
      true
    );
    assert.equal(
      isRetryableInterruptedAttempt({ ...attempt, mutable: true }, {
        status: "started"
      } as AttemptRecord),
      false
    );
    assert.equal(
      isRetryableInterruptedAttempt(attempt, {
        status: "completed"
      } as AttemptRecord),
      false
    );
  }
});

test("check failure reasons keep a Banzai code and otherwise the error text", () => {
  assert.equal(
    checkFailureReason(new BanzaiError("NODE_TOO_OLD", "Node is too old.")),
    "[NODE_TOO_OLD] Node is too old."
  );
  assert.equal(checkFailureReason(new Error("Disk full.")), "Disk full.");
});
