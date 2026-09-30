import { createHash } from "node:crypto";
import { inspectBoundWork } from "../../artifact-storage.js";
import { BanzaiError } from "../../errors.js";
import { currentCommit, digestArtifactBundle } from "../../git.js";
import { blockState } from "../../state-machine.js";
import type {
  RunState,
  WorkflowRoute,
  WorkflowSelectionRecord,
  WorkflowSelectionResult
} from "../../types.js";
import type { RunnerContext } from "../context.js";

export function workflowAuthorizationDigest(input: {
  runId: string;
  request: string;
  recommendedWorkflow: WorkflowRoute;
  workflow: WorkflowRoute;
  confidence: WorkflowSelectionResult["confidence"];
  reason: string;
  escalationTriggers: string[];
  selectedAt: string;
  attemptId: string;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        version: 1,
        runId: input.runId,
        request: input.request,
        recommendedWorkflow: input.recommendedWorkflow,
        workflow: input.workflow,
        confidence: input.confidence,
        reason: input.reason,
        escalationTriggers: input.escalationTriggers,
        selectedAt: input.selectedAt,
        attemptId: input.attemptId
      })
    )
    .digest("hex");
}

export async function validateApproval(
  context: RunnerContext,
  state: RunState
): Promise<void> {
  if (state.planApproval === null) {
    throw new BanzaiError(
      "PLAN_NOT_APPROVED",
      "Implementation requires explicit plan approval."
    );
  }
  const bundle = await digestArtifactBundle(
    context.repoRoot,
    state.planApproval.paths
  );
  if (bundle.digest !== state.planApproval.digest) {
    blockState(
      state,
      "Approved planning artifacts changed. Restore the approved bundle (banzai restore) and retry, or cancel the run and approve a revised plan in a new run."
    );
    await context.store.writeState(state);
    await context.store.appendEvent(state.runId, "approval.invalidated", {
      previousDigest: state.planApproval.digest,
      currentDigest: bundle.digest
    });
    throw new BanzaiError(
      "APPROVAL_INVALIDATED",
      "Approved planning artifacts changed. Run `banzai restore` to write back the approved bytes and then `banzai retry`, or cancel the run and approve a revised plan in a new run."
    );
  }
}

export async function validateBaseCommit(
  context: RunnerContext,
  state: RunState
): Promise<void> {
  if (state.artifactBinding)
    await inspectBoundWork(context.repoRoot, state.artifactBinding);
  const current = await currentCommit(context.repoRoot);
  if (current !== state.baseCommit) {
    blockState(
      state,
      "The checkout HEAD changed during the run. Start a new run from the intended branch and commit."
    );
    await context.store.writeState(state);
    throw new BanzaiError(
      "BASE_COMMIT_CHANGED",
      "The checkout HEAD changed during the run."
    );
  }
}

export function validateWorkflowSelection(
  state: RunState
): WorkflowSelectionRecord & {
  workflow: Exclude<WorkflowRoute, "strict">;
} {
  const selection = state.workflowSelection ?? null;
  if (selection === null || selection.workflow === "strict") {
    throw new BanzaiError(
      "WORKFLOW_NOT_AUTHORIZED",
      "Lite implementation requires a persisted feature or quick-fix selection."
    );
  }
  const currentDigest = workflowAuthorizationDigest({
    runId: state.runId,
    request: state.request,
    ...selection
  });
  if (currentDigest !== selection.digest) {
    throw new BanzaiError(
      "WORKFLOW_AUTHORIZATION_INVALID",
      "Persisted workflow selection does not match its authorization digest."
    );
  }
  return selection as WorkflowSelectionRecord & {
    workflow: Exclude<WorkflowRoute, "strict">;
  };
}
