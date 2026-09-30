import assert from "node:assert/strict";
import test from "node:test";
import {
  CONTRACT_VERSION,
  type RunState,
  type WorkflowSelectionRecord
} from "../../../src/types.js";
import {
  validateBaseCommit,
  validateWorkflowSelection,
  workflowAuthorizationDigest
} from "../../../src/workflow/preflight/approval.js";
import { createTestRepository } from "../../helpers.js";
import { recordingContext } from "../context-fixture.js";

const SELECTION: Omit<WorkflowSelectionRecord, "digest"> = {
  workflow: "feature",
  recommendedWorkflow: "feature",
  confidence: "high",
  reason: "Ordinary work.",
  escalationTriggers: [],
  selectedAt: "2026-07-01T00:00:00.000Z",
  attemptId: "selection-1-abcdef12",
  contractVersion: CONTRACT_VERSION
};

function selectionState(
  selection: Partial<WorkflowSelectionRecord> | null
): RunState {
  return {
    runId: "run-1",
    request: "Do the work.",
    workflowSelection: selection
  } as unknown as RunState;
}

test("lite work requires a persisted selection that still carries its own digest", () => {
  const digest = workflowAuthorizationDigest({
    runId: "run-1",
    request: "Do the work.",
    ...SELECTION
  });
  assert.equal(
    validateWorkflowSelection(selectionState({ ...SELECTION, digest })).digest,
    digest
  );
  for (const selection of [null, { ...SELECTION, workflow: "strict", digest }])
    assert.throws(
      () =>
        validateWorkflowSelection(
          selectionState(selection as Partial<WorkflowSelectionRecord> | null)
        ),
      {
        code: "WORKFLOW_NOT_AUTHORIZED",
        message:
          "Lite implementation requires a persisted feature or quick-fix selection."
      }
    );
  assert.throws(
    () =>
      validateWorkflowSelection(
        selectionState({ ...SELECTION, digest: "0".repeat(64) })
      ),
    {
      code: "WORKFLOW_AUTHORIZATION_INVALID",
      message:
        "Persisted workflow selection does not match its authorization digest."
    }
  );
});

test("a moved checkout head blocks the run and persists the block", async () => {
  const repository = await createTestRepository();
  try {
    const written: RunState[] = [];
    const { context, calls } = recordingContext(
      {
        writeState: (state: RunState) => {
          written.push(structuredClone(state));
          return Promise.resolve();
        }
      },
      repository.root
    );
    const state = {
      runId: "run-1",
      status: "implementing",
      blockedFrom: null,
      blockReason: null,
      baseCommit: "0".repeat(40)
    } as unknown as RunState;
    await assert.rejects(validateBaseCommit(context, state), {
      code: "BASE_COMMIT_CHANGED",
      message: "The checkout HEAD changed during the run."
    });
    assert.deepEqual(calls, ["writeState"]);
    assert.deepEqual(
      written.map(({ status, blockedFrom, blockReason }) => ({
        status,
        blockedFrom,
        blockReason
      })),
      [
        {
          status: "blocked",
          blockedFrom: "implementing",
          blockReason:
            "The checkout HEAD changed during the run. Start a new run from the intended branch and commit."
        }
      ]
    );
  } finally {
    await repository.dispose();
  }
});
