import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type {
  AttemptReference,
  PersistedPhaseResult,
  RunState
} from "../../../src/types.js";
import {
  completionPlanPath,
  validateImplementationCompletion,
  validatePlanningResult
} from "../../../src/workflow/completion/plan-tasks.js";
import { recordingContext } from "../context-fixture.js";

const PLAN_ATTEMPT: AttemptReference = {
  id: "plan-1-abcdef12",
  kind: "plan",
  mutable: true
};

test("completion validation needs an identifiable approved plan", () => {
  assert.throws(
    () => completionPlanPath({ planArtifacts: null } as unknown as RunState),
    {
      code: "PLAN_TASK_COMPLETION_INVALID",
      violation: "approved_plan_invalid",
      message: "Strict completion validation cannot identify the approved plan."
    }
  );
});

test("implementation completion needs an approved plan bundle", async () => {
  const { context, calls } = recordingContext({});
  await assert.rejects(
    validateImplementationCompletion(
      context,
      { planApproval: null } as unknown as RunState,
      { id: "implementation-1-x", kind: "implementation", mutable: true },
      {} as PersistedPhaseResult
    ),
    {
      code: "PLAN_TASK_COMPLETION_INVALID",
      violation: "approval_invalid",
      message: "Strict completion validation requires an approved plan bundle."
    }
  );
  assert.deepEqual(calls, []);
});

test("an unreadable planning artifact is an invalid approved plan", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "banzai-plan-tasks-"));
  try {
    const { context, calls } = recordingContext({}, root);
    const error = await validatePlanningResult(
      context,
      { verificationMode: "task" } as unknown as RunState,
      PLAN_ATTEMPT,
      {
        gate: "plan_approval",
        artifacts: { plan: "missing/plan.md" }
      } as unknown as PersistedPhaseResult
    ).then(
      () => null,
      (reason: unknown) => reason
    );
    assert.ok(error instanceof Error);
    assert.equal(
      (error as { code?: unknown }).code,
      "PLAN_TASK_COMPLETION_INVALID"
    );
    assert.equal(
      (error as { violation?: unknown }).violation,
      "approved_plan_invalid"
    );
    assert.match(error.message, /^The planning artifact could not be read: /);
    assert.deepEqual(calls, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
