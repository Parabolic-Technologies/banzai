import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  BanzaiError,
  errorMessage,
  passesThroughRunCatches
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
  RunState
} from "../../types.js";
import { rewritePlanRemainderDigest } from "../../verification-evidence.js";
import type { RunnerContext } from "../context.js";
import { recordResultDigestEvidence } from "../digest-evidence/records.js";
import {
  exactUtf8,
  readRecheckBundle,
  replacePlanBytes
} from "../plan-gate/recheck.js";

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
    if (state.verificationMode === "task") {
      await recordPlanRemainderDigest(
        context,
        state,
        attempt,
        result.artifacts.plan
      );
      return;
    }
    const markdown = await readFile(
      path.join(context.repoRoot, result.artifacts.plan),
      "utf8"
    );
    parseApprovedPlanTaskIds(markdown);
    validateRunnerControlTasks(context, state, markdown);
  } catch (error) {
    if (passesThroughRunCatches(error)) throw error;
    if (
      error instanceof PlanTaskCompletionError ||
      (error instanceof BanzaiError &&
        error.code === "PLAN_RUNNER_CONTROL_TASK")
    )
      throw error;
    throw planningArtifactRefused(errorMessage(error));
  }
}

function planningArtifactRefused(message: string): PlanTaskCompletionError {
  return new PlanTaskCompletionError(
    "approved_plan_invalid",
    `The planning artifact could not be read: ${message}`
  );
}

/**
 * ADR-0064: a model cannot hash without a command, so the runner establishes
 * the remainder digest of a plan that requests approval. A plan the shared
 * inventory rules refuse is never written. The evidence is durable before the
 * write, which keeps the planner's value auditable, and reconciling the same
 * attempt reaches the same bytes because the store keeps its first record.
 */
async function recordPlanRemainderDigest(
  context: RunnerContext,
  state: RunState,
  attempt: AttemptReference,
  planPath: string
): Promise<void> {
  const planBytes = (
    await readRecheckBundle(
      context.repoRoot,
      [planPath],
      planningArtifactRefused
    )
  ).get(planPath);
  if (planBytes === undefined)
    throw planningArtifactRefused(`${planPath} was not read.`);
  const markdown = exactUtf8(planBytes, planPath, planningArtifactRefused);
  parseApprovedPlanTaskIds(markdown);
  const digest = rewritePlanRemainderDigest(markdown);
  validateRunnerControlTasks(context, state, markdown);
  await recordResultDigestEvidence(context, state, attempt, [
    {
      role: "binding",
      field: "planRemainderSha256",
      checkId: null,
      path: planPath,
      declared: digest.declared,
      observed: digest.observed,
      size: null,
      limit: null,
      matched: !digest.rewritten,
      recorded: digest.rewritten
    }
  ]);
  if (digest.rewritten)
    await replacePlanBytes(
      context.repoRoot,
      planPath,
      planBytes,
      Buffer.from(digest.plan, "utf8"),
      (relative) =>
        new PlanTaskCompletionError(
          "approved_plan_invalid",
          `${relative} changed while Banzai was recording its remainder digest. Nothing was written; retry planning.`
        )
    );
}
