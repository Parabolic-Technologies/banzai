import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  BanzaiError,
  errorMessage,
  InstructionResourceMismatchError,
  ProjectSetupRequiredError,
  TerminalRunStateError
} from "../../errors.js";
import {
  parseApprovedPlanTaskIds,
  PlanTaskCompletionError,
  type ValidatedPlanTaskCompletion,
  validatePlanRunnerControlTasks,
  validatePlanTaskCompletion
} from "../../plan-task-completion.js";
import type {
  AttemptReference,
  PersistedPhaseResult,
  ResultDigestComparison,
  RunState
} from "../../types.js";
import { ResultDigestRejectedError } from "../../validation.js";
import { parseTaskVerificationObligations } from "../../verification-evidence.js";
import type { RunnerContext } from "../context.js";
import {
  recordResultDigestEvidence,
  taskVerificationDigestDetail
} from "../digest-evidence/records.js";

export function completionPlanPath(state: RunState): string {
  const planPath = state.planArtifacts?.plan ?? null;
  if (planPath === null) {
    throw new PlanTaskCompletionError(
      "approved_plan_invalid",
      "Strict completion validation cannot identify the approved plan."
    );
  }
  return planPath;
}

export async function approvedTaskIds(
  context: RunnerContext,
  state: RunState
): Promise<string[]> {
  const plan = await readFile(
    path.join(context.repoRoot, completionPlanPath(state)),
    "utf8"
  );
  validateRunnerControlTasks(context, state, plan);
  return parseApprovedPlanTaskIds(plan);
}

export function validateRunnerControlTasks(
  context: RunnerContext,
  state: RunState,
  plan: string
): void {
  const roles = state.artifactBinding?.binding.artifacts;
  validatePlanRunnerControlTasks(
    plan,
    context.repoRoot,
    [roles?.implementationReport, roles?.testReport].filter(
      (value): value is string => typeof value === "string"
    )
  );
}

export async function validateImplementationCompletion(
  context: RunnerContext,
  state: RunState,
  attempt: AttemptReference,
  result: PersistedPhaseResult
): Promise<ValidatedPlanTaskCompletion> {
  if (state.planApproval === null) {
    throw new PlanTaskCompletionError(
      "approval_invalid",
      "Strict completion validation requires an approved plan bundle."
    );
  }
  return await validatePlanTaskCompletion({
    repoRoot: context.repoRoot,
    artifactBinding: state.artifactBinding,
    sourceAttemptId: attempt.id,
    result,
    planPath: completionPlanPath(state),
    approval: state.planApproval,
    baseline: state.baseline
  });
}

export async function validatePlanningResult(
  context: RunnerContext,
  state: RunState,
  attempt: AttemptReference,
  result: PersistedPhaseResult
): Promise<void> {
  if (result.gate !== "plan_approval" || result.artifacts.plan === null) return;
  try {
    const markdown = await readFile(
      path.join(context.repoRoot, result.artifacts.plan),
      "utf8"
    );
    parseApprovedPlanTaskIds(markdown);
    if (state.verificationMode === "task")
      await establishPlanRemainderDigest(
        context,
        state,
        attempt,
        result.artifacts.plan,
        markdown
      );
    validateRunnerControlTasks(context, state, markdown);
  } catch (error) {
    if (
      error instanceof TerminalRunStateError ||
      error instanceof ProjectSetupRequiredError ||
      error instanceof InstructionResourceMismatchError
    )
      throw error;
    // A rejected remainder digest is a defective planning result, not an
    // unreadable artifact: it keeps the approved_plan_invalid semantics that
    // rerun planning, and says exactly which digest disagreed.
    if (error instanceof ResultDigestRejectedError)
      throw new PlanTaskCompletionError("approved_plan_invalid", error.message);
    if (
      error instanceof PlanTaskCompletionError ||
      (error instanceof BanzaiError &&
        error.code === "PLAN_RUNNER_CONTROL_TASK")
    )
      throw error;
    throw new PlanTaskCompletionError(
      "approved_plan_invalid",
      `The planning artifact could not be read: ${errorMessage(error)}`
    );
  }
}

/**
 * The plan remainder digest is the one binding role ADR-0051 fixes, and the
 * detection that establishes it already lives in the shared inventory
 * parser. This only classifies that existing outcome: an accepted record
 * becomes the baseline a later reader may cite, and a rejected record is
 * what makes the attempt recognizable as a digest-rejected result. No strict
 * plan-task completion ledger is written for a planning attempt.
 */
export async function establishPlanRemainderDigest(
  context: RunnerContext,
  state: RunState,
  attempt: AttemptReference,
  planPath: string,
  markdown: string
): Promise<void> {
  let comparison: ResultDigestComparison;
  try {
    const obligations = parseTaskVerificationObligations(markdown);
    comparison = {
      role: "binding",
      field: "planRemainderSha256",
      checkId: null,
      path: planPath,
      declared: obligations.planRemainderSha256,
      observed: obligations.planRemainderSha256,
      size: null,
      limit: null,
      matched: true
    };
  } catch (error) {
    const detail = taskVerificationDigestDetail(error);
    if (detail === null) throw error;
    if (detail.role !== "binding") throw error;
    comparison = {
      role: "binding",
      field: detail.field,
      checkId: null,
      path: planPath,
      declared: detail.declared,
      observed: detail.observed,
      size: null,
      limit: null,
      matched: false
    };
  }
  await recordResultDigestEvidence(context, state, attempt, [comparison]);
}
