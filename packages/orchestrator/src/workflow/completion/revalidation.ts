import { errorMessage } from "../../errors.js";
import {
  ledgerDigest,
  parsePublishedCompletionRegion,
  PlanTaskCompletionError,
  summariesMatch,
  validateCompletionClaims,
  type ValidatedPlanTaskCompletion,
  validatePlanTaskCompletion
} from "../../plan-task-completion.js";
import { blockState } from "../../state-machine.js";
import {
  COMPLETION_SUMMARY_SCHEMA_VERSION,
  type PersistedPhaseResult,
  type RunState,
  type ValidPlanTaskCompletionSummary
} from "../../types.js";
import { parsePersistedPhaseResult } from "../../validation.js";
import type { RunnerContext } from "../context.js";
import {
  completionInvalidCheckpoint,
  completionPlanPath
} from "./plan-tasks.js";
import { recordLedger } from "./publication.js";

export async function revalidateTaskCompletion(
  context: RunnerContext,
  state: RunState,
  allowReportRefresh = false,
  persistReportRefresh = true
): Promise<ValidatedPlanTaskCompletion> {
  const checkpoint = state.planTaskCompletion;
  if (checkpoint === undefined || checkpoint === null) {
    throw new PlanTaskCompletionError(
      "missing_ledger",
      "Run has no canonical plan-task completion checkpoint."
    );
  }
  if (checkpoint.status !== "valid") {
    throw new PlanTaskCompletionError(
      checkpoint.violation,
      "Run has an invalid plan-task completion checkpoint.",
      checkpoint.taskId
    );
  }
  if (checkpoint.schemaVersion === COMPLETION_SUMMARY_SCHEMA_VERSION) {
    // Runner-published completion is revalidated strictly read-only at every
    // downstream boundary; legacy refresh semantics never apply to it.
    return await revalidatePublishedCompletion(context, state, checkpoint);
  }
  const attempt = {
    id: checkpoint.sourceAttemptId,
    kind: checkpoint.sourceAttemptKind ?? ("implementation" as const),
    mutable: true
  };
  const record = await context.store
    .readRunAttempt(state.runId, attempt)
    .catch(() => null);
  if (record?.status !== "completed" || record.result === null) {
    throw new PlanTaskCompletionError(
      "source_attempt_invalid",
      "Canonical completion source attempt is missing or not completed."
    );
  }
  let result: PersistedPhaseResult;
  try {
    result = parsePersistedPhaseResult(record.result);
  } catch {
    throw new PlanTaskCompletionError(
      "source_attempt_invalid",
      "Canonical completion source attempt result is malformed."
    );
  }
  if (state.planApproval === null) {
    throw new PlanTaskCompletionError(
      "approval_invalid",
      "Canonical completion source has no plan approval."
    );
  }
  const validated = await validatePlanTaskCompletion({
    repoRoot: context.repoRoot,
    artifactBinding: state.artifactBinding,
    sourceAttemptId: checkpoint.sourceAttemptId,
    result,
    planPath: completionPlanPath(state),
    approval: state.planApproval,
    baseline: state.baseline
  });
  if (!summariesMatch(checkpoint, validated.summary)) {
    const sameCanonicalSource =
      checkpoint.sourceAttemptId === validated.summary.sourceAttemptId &&
      checkpoint.approvalDigest === validated.summary.approvalDigest &&
      checkpoint.planTaskDigest === validated.summary.planTaskDigest &&
      checkpoint.ledgerDigest === validated.summary.ledgerDigest;
    if (!allowReportRefresh || !sameCanonicalSource) {
      throw new PlanTaskCompletionError(
        "summary_mismatch",
        "Persisted plan-task completion summary is stale or contradictory."
      );
    }
    if (persistReportRefresh) {
      // The refreshed summary keeps the checkpoint's provenance: the fresh
      // validation cannot know which phase authored the ledger.
      state.planTaskCompletion =
        checkpoint.sourceAttemptKind === undefined
          ? validated.summary
          : {
              ...validated.summary,
              sourceAttemptKind: checkpoint.sourceAttemptKind
            };
      await context.store.writeState(state);
    }
  }
  return validated;
}

export async function revalidatePublishedCompletion(
  context: RunnerContext,
  state: RunState,
  checkpoint: ValidPlanTaskCompletionSummary
): Promise<ValidatedPlanTaskCompletion> {
  if (
    checkpoint.publisherAttemptId === undefined ||
    checkpoint.publication === undefined
  )
    throw new PlanTaskCompletionError(
      "summary_mismatch",
      "Published completion summary is missing its publisher identities."
    );
  const receipt = await context.store
    .readCompletionPublicationIfExists(state.runId, {
      id: checkpoint.publisherAttemptId
    })
    .catch(() => null);
  if (
    receipt?.integrityDigest !== checkpoint.publication.sha256 ||
    receipt.ledgerAuthor.attemptId !== checkpoint.sourceAttemptId ||
    receipt.ledgerAuthor.attemptKind !==
      (checkpoint.sourceAttemptKind ?? "implementation") ||
    receipt.ledgerAuthor.ledgerDigest !== checkpoint.ledgerDigest ||
    receipt.authority.approvalDigest !== checkpoint.approvalDigest ||
    receipt.authority.planTaskDigest !== checkpoint.planTaskDigest ||
    receipt.implementationReport.sha256 !==
      checkpoint.implementationReport.sha256 ||
    receipt.testReport.sha256 !== checkpoint.testReport.sha256
  )
    throw new PlanTaskCompletionError(
      "summary_mismatch",
      "Publication receipt is missing or conflicts with the canonical completion summary."
    );
  // Edited or unreadable author evidence is an invalid canonical source,
  // never a reason to trust the summary or to fail with a raw reader error.
  const author = await context.store
    .readRunAttemptIfExists(state.runId, {
      id: receipt.ledgerAuthor.attemptId,
      kind: receipt.ledgerAuthor.attemptKind,
      mutable: true
    })
    .catch(() => null);
  const ledger = author === null ? null : recordLedger(author);
  if (author?.status !== "completed" || ledger === null)
    throw new PlanTaskCompletionError(
      "source_attempt_invalid",
      "Canonical completion source attempt is missing, malformed or not completed."
    );
  if (ledgerDigest(ledger) !== receipt.ledgerAuthor.ledgerDigest)
    throw new PlanTaskCompletionError(
      "summary_mismatch",
      "Canonical ledger no longer matches its published identity."
    );
  if (state.planApproval === null)
    throw new PlanTaskCompletionError(
      "approval_invalid",
      "Canonical completion source has no plan approval."
    );
  if (state.planApproval.digest !== receipt.authority.approvalDigest)
    throw new PlanTaskCompletionError(
      "approval_invalid",
      "Published completion was authorized under a different approval."
    );
  const claims = await validateCompletionClaims({
    repoRoot: context.repoRoot,
    artifactBinding: state.artifactBinding,
    ledger,
    outcome: "completed",
    artifacts: {
      implementationReport: receipt.implementationReport.path,
      testReport: receipt.testReport.path
    },
    planPath: completionPlanPath(state),
    approval: state.planApproval,
    baseline: state.baseline
  });
  if (
    claims.implementationReport.sha256 !==
      receipt.implementationReport.sha256 ||
    claims.testReport.sha256 !== receipt.testReport.sha256
  )
    throw new PlanTaskCompletionError(
      "summary_mismatch",
      "A published report changed after publication; restore the exact published bytes or start a new attempt."
    );
  const published = parsePublishedCompletionRegion(
    claims.implementationReport.bytes
  );
  if (JSON.stringify(published) !== JSON.stringify(ledger))
    throw new PlanTaskCompletionError(
      "report_projection_mismatch",
      "Published completion region contradicts the canonical ledger."
    );
  if (
    claims.planTaskDigest !== checkpoint.planTaskDigest ||
    claims.ledgerDigest !== checkpoint.ledgerDigest ||
    JSON.stringify(claims.counts) !== JSON.stringify(checkpoint.counts)
  )
    throw new PlanTaskCompletionError(
      "summary_mismatch",
      "Persisted plan-task completion summary is stale or contradictory."
    );
  return { summary: checkpoint, tasks: ledger.tasks };
}

export async function blockForCompletionFailure(
  context: RunnerContext,
  state: RunState,
  sourceAttemptId: string,
  error: unknown
): Promise<RunState> {
  const completionError =
    error instanceof PlanTaskCompletionError
      ? error
      : new PlanTaskCompletionError(
          "source_attempt_invalid",
          errorMessage(error)
        );
  state.planTaskCompletion = completionInvalidCheckpoint(
    context,
    sourceAttemptId,
    completionError,
    state.planTaskCompletion?.sourceAttemptId === sourceAttemptId
      ? (state.planTaskCompletion.sourceAttemptKind ?? "implementation")
      : "implementation"
  );
  state.activeProcess = null;
  blockState(
    state,
    `[PLAN_TASK_COMPLETION_INVALID] ${completionError.message}`
  );
  await context.store.writeState(state);
  await context.store.appendEvent(
    state.runId,
    "plan_task_completion.validation_failed",
    {
      attemptId: sourceAttemptId,
      code: "PLAN_TASK_COMPLETION_INVALID",
      violation: completionError.violation,
      taskId: completionError.taskId
    }
  );
  return state;
}
