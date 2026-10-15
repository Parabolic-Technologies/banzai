import assert from "node:assert/strict";
import test from "node:test";
import { BanzaiError } from "../src/errors.js";
import { transitionState } from "../src/state-machine.js";
import type { RunState } from "../src/types.js";
import { planningRestoreState } from "./planning-review-fixtures.js";

test("plan rework and non-actionable planning triage are the only new approval-gate transitions", () => {
  const plan = {
    ...planningRestoreState(),
    status: "needs_plan_approval" as const
  };
  transitionState(plan, "planning");
  assert.equal(plan.status, "planning");
  for (const gate of ["plan_approval", "adr_approval"] as const) {
    const state = planningRestoreState();
    assert.ok(state.planningReview?.active);
    state.planningReview.active.originGate = gate;
    state.pendingHumanDecision = null;
    transitionState(
      state,
      gate === "plan_approval" ? "needs_plan_approval" : "needs_adr_approval"
    );
    assert.equal(state.status, `needs_${gate}`);
  }
  for (const mutate of [
    (s: RunState) => {
      const r = s.humanDecisions?.at(-1);
      if (r?.kind === "planning_review_triage")
        r.additionalInstruction = "Apply this";
    },
    (s: RunState) => {
      const r = s.humanDecisions?.at(-1);
      if (r?.kind === "planning_review_triage") r.episodeId = "foreign";
    },
    (s: RunState) => {
      s.planningReview = { active: null, closed: [] };
    }
  ]) {
    const state = planningRestoreState();
    mutate(state);
    const before = structuredClone(state);
    assert.throws(
      () => {
        transitionState(state, "needs_plan_approval");
      },
      (error: unknown) =>
        error instanceof BanzaiError && error.code === "INVALID_TRANSITION"
    );
    assert.deepEqual(state, before);
  }
});

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
