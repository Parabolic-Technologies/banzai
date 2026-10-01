import assert from "node:assert/strict";
import test from "node:test";
import { BanzaiError } from "../../../src/errors.js";
import { checkFailureReason } from "../../../src/workflow/domain/failure-classes.js";

test("check failure reasons keep a Banzai code and otherwise the error text", () => {
  assert.equal(
    checkFailureReason(new BanzaiError("NODE_TOO_OLD", "Node is too old.")),
    "[NODE_TOO_OLD] Node is too old."
  );
  assert.equal(checkFailureReason(new Error("Disk full.")), "Disk full.");
});
