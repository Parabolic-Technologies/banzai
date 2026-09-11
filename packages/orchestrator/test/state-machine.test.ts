import assert from "node:assert/strict";
import test from "node:test";
import { BanzaiError } from "../src/errors.js";
import { transitionState } from "../src/state-machine.js";
import type { RunState } from "../src/types.js";

function triageState(): RunState {
  return {
    runId: "run-example",
    status: "needs_triage",
    blockedFrom: null,
    blockReason: null
  } as RunState;
}

test("human triage may finish directly but cannot request unchanged-source review", () => {
  const completed = triageState();
  transitionState(completed, "done");
  assert.equal(completed.status, "done");

  assert.throws(
    () => {
      transitionState(triageState(), "reviewing");
    },
    (error: unknown) =>
      error instanceof BanzaiError && error.code === "INVALID_TRANSITION"
  );
});
