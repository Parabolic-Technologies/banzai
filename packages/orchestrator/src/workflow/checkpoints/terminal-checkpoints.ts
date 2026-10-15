import {
  validatePlanningReviewResult,
  validatePlanningReviewAnalysis,
  parsePlanningReviewResult
} from "../../validation.js";
import { lstat, readFile } from "node:fs/promises";
import { BanzaiError } from "../../errors.js";
import { FALLBACK_VENDOR, vendorFor } from "../../models.js";
import {
  PlanTaskCompletionError,
  validatePlanTaskCompletion,
  validatePlanTaskCompletionLedgerShape
} from "../../plan-task-completion.js";
import {
  type AdapterTerminalSuccess,
  type AttemptRecord,
  type AttemptReference,
  COMPLETION_PROTOCOL,
  MODEL_ATTEMPT_SCHEMA_VERSION,
  type ModelSettings,
  type OrchestratorConfig,
  type PersistedPhaseResult,
  type PhaseResult,
  type PhaseResultEnvelope,
  type ResultDigestComparison,
  type ReviewResult,
  type RunState,
  type SessionContext,
  TERMINAL_CHECKPOINT_SCHEMA,
  TERMINAL_CHECKPOINT_SCHEMA_V2,
  TERMINAL_CHECKPOINT_SCHEMA_VERSION,
  TERMINAL_CHECKPOINT_SCHEMA_VERSION_V2,
  type TerminalAttemptCheckpoint,
  type TerminalAttemptCheckpointV2,
  type TerminalCheckpointResult
} from "../../types.js";
import {
  digestCanonicalJson,
  effectiveResultSourceIdentities,
  parseCurrentReviewResult,
  parsePersistedPhaseResult,
  terminalCheckpointIntegrity,
  validateReviewScope
} from "../../validation.js";
import {
  evidenceDigest,
  TASK_VERIFICATION_SOURCE_MAX_BYTES,
  taskVerificationPath
} from "../../verification-evidence.js";
import {
  type AttemptPolicy,
  attemptScopeDigest,
  completionEnvelopeOf
} from "../attempts/lifecycle.js";
import {
  validateArtifactRoleReferences,
  validateSavedArtifactScope
} from "../attempts/result-scope.js";
import { observeCompletionInputs } from "../completion/inputs.js";
import {
  approvedTaskIds,
  completionPlanPath,
  validateImplementationCompletion,
  validatePlanningResult
} from "../completion/plan-tasks.js";
import type { RunnerContext } from "../context.js";
import { recordResultDigestEvidence } from "../digest-evidence/records.js";
import { TERMINAL_INTEGRITY_FAILURE_CODES } from "../domain/failure-classes.js";
import { terminalResultContract } from "../domain/routing.js";
import { sessionContext } from "../domain/sessions.js";
import {
  validateApproval,
  validateBaseCommit,
  validateWorkflowSelection,
  workflowAuthorizationDigest
} from "../preflight/approval.js";
import { validateReviewResultForApplication } from "../review/result-application.js";
import { requiredCheckIds } from "../verification/required-checks.js";

export function terminalCheckpointWriter<
  T extends TerminalCheckpointResult | PhaseResultEnvelope
>(
  context: RunnerContext,
  state: RunState,
  attempt: AttemptReference,
  settings: ModelSettings,
  policy: Pick<AttemptPolicy, "sessionMode" | "sessionContext">,
  completion = false
): (terminal: AdapterTerminalSuccess<T>) => Promise<void> {
  return async (terminal) => {
    const current = await context.store.readState(state.runId);
    if (
      current.activeAttempt?.id !== attempt.id ||
      current.activeAttempt.kind !== attempt.kind ||
      current.activeAttempt.mutable !== attempt.mutable
    ) {
      throw new BanzaiError(
        "TERMINAL_CHECKPOINT_STATE_CHANGED",
        "The active attempt changed before terminal success could be persisted."
      );
    }
    await validateSavedArtifactScope(context, current, attempt);
    if (
      attempt.kind === "plan" ||
      attempt.kind === "implementation" ||
      attempt.kind === "fix"
    )
      validateArtifactRoleReferences(
        current,
        terminal.result as PersistedPhaseResult
      );
    const vendor =
      vendorFor(settings.executable) ??
      FALLBACK_VENDOR[policy.sessionContext.role];
    if (completion) {
      // ADR-0047 terminal proof: the exact original result, its safe
      // envelope and the report/workspace identities observed right now.
      if (attempt.kind !== "implementation" && attempt.kind !== "fix")
        throw new BanzaiError(
          "TERMINAL_CHECKPOINT_STATE_CHANGED",
          "Only strict implementation or fix attempts use the completion protocol."
        );
      const envelope = completionEnvelopeOf(
        terminal.result as PhaseResult | PhaseResultEnvelope
      );
      const observed = await observeCompletionInputs(
        context,
        current,
        envelope.artifacts
      );
      const checkpoint: Omit<TerminalAttemptCheckpointV2, "integrityDigest"> = {
        schema:
          state.verificationMode === "task"
            ? "banzai-terminal-attempt-checkpoint/v3"
            : TERMINAL_CHECKPOINT_SCHEMA_V2,
        schemaVersion:
          state.verificationMode === "task"
            ? 3
            : TERMINAL_CHECKPOINT_SCHEMA_VERSION_V2,
        completionProtocol: COMPLETION_PROTOCOL,
        runId: current.runId,
        attempt: { id: attempt.id, kind: attempt.kind, mutable: true },
        phase: attempt.kind,
        configuration: {
          vendor,
          executableDigest: digestCanonicalJson(settings.executable),
          model: settings.model,
          effort: settings.effort,
          sessionMode: policy.sessionMode,
          sessionContextDigest: digestCanonicalJson(policy.sessionContext)
        },
        resultContract:
          state.verificationMode === "task"
            ? "phase-result/v4"
            : "phase-result/v3",
        terminal: {
          classification: terminal.classification,
          observedAt: terminal.observedAt
        },
        envelope,
        resultDigest: envelope.originalDigest,
        observed: observed.observed,
        sessionId: terminal.sessionId,
        usage: terminal.usage,
        baseCommit: current.baseCommit,
        approvalDigest: current.planApproval?.digest ?? null,
        workflowDigest: null,
        scopeDigest: attemptScopeDigest(current, attempt)
      };
      await context.store.writeTerminalCheckpoint(current.runId, {
        ...checkpoint,
        integrityDigest: terminalCheckpointIntegrity(checkpoint)
      });
      await context.store.appendEvent(
        current.runId,
        "attempt.terminal_checkpoint",
        {
          attemptId: attempt.id,
          kind: attempt.kind,
          classification: terminal.classification
        }
      );
      return;
    }
    const checkpoint: Omit<TerminalAttemptCheckpoint, "integrityDigest"> = {
      schema:
        state.verificationMode === "task"
          ? "banzai-terminal-attempt-checkpoint/v3"
          : TERMINAL_CHECKPOINT_SCHEMA,
      schemaVersion:
        state.verificationMode === "task"
          ? 3
          : TERMINAL_CHECKPOINT_SCHEMA_VERSION,
      runId: current.runId,
      attempt,
      phase: attempt.kind,
      configuration: {
        vendor,
        executableDigest: digestCanonicalJson(settings.executable),
        model: settings.model,
        effort: settings.effort,
        sessionMode: policy.sessionMode,
        sessionContextDigest: digestCanonicalJson(policy.sessionContext)
      },
      resultContract: terminalResultContract(
        attempt.kind,
        state.verificationMode === "task"
      ),
      terminal: {
        classification: terminal.classification,
        observedAt: terminal.observedAt
      },
      result: terminal.result as TerminalCheckpointResult,
      sessionId: terminal.sessionId,
      usage: terminal.usage,
      baseCommit: current.baseCommit,
      approvalDigest: current.planApproval?.digest ?? null,
      workflowDigest:
        current.planApproval === null
          ? (current.workflowSelection?.digest ?? null)
          : null,
      scopeDigest: attemptScopeDigest(current, attempt)
    };
    const persisted: TerminalAttemptCheckpoint = {
      ...checkpoint,
      integrityDigest: terminalCheckpointIntegrity(checkpoint)
    };
    await context.store.writeTerminalCheckpoint(current.runId, persisted);
    await context.store.appendEvent(
      current.runId,
      "attempt.terminal_checkpoint",
      {
        attemptId: attempt.id,
        kind: attempt.kind,
        classification: terminal.classification
      }
    );
  };
}

export async function finalizeTerminalCheckpoint(
  context: RunnerContext,
  state: RunState,
  record: AttemptRecord,
  terminalObservedAt: string | null
): Promise<void> {
  if (terminalObservedAt === null) {
    return;
  }
  if (record.schemaVersion === 1)
    record.schemaVersion = MODEL_ATTEMPT_SCHEMA_VERSION;
  record.status = "completed";
  record.completedAt = terminalObservedAt;
  record.interruptedAt = null;
  record.recoveryOf ??= null;
  record.recoveryAuthorizationId ??= null;
  record.durationMs = Math.max(
    0,
    Date.parse(terminalObservedAt) - Date.parse(record.startedAt)
  );
  record.error = null;
  record.failureCode = null;
  await context.store.writeRunAttempt(state.runId, record);
  state.activeProcess = null;
  await context.store.writeState(state);
  await context.store.appendEvent(state.runId, "attempt.terminal_reconciled", {
    attemptId: record.attempt.id,
    kind: record.attempt.kind
  });
}

export async function promoteTerminalCheckpoint(
  context: RunnerContext,
  state: RunState,
  attempt: AttemptReference,
  record: AttemptRecord,
  config: OrchestratorConfig
): Promise<string | null> {
  const checkpoint = await context.store.readTerminalCheckpointIfExists(
    state.runId,
    attempt
  );
  if (checkpoint === null) {
    return null;
  }
  if ("envelope" in checkpoint) {
    throw new BanzaiError(
      "TERMINAL_CHECKPOINT_MISMATCH",
      "A legacy attempt cannot reconcile a completion-protocol checkpoint."
    );
  }
  if (TERMINAL_INTEGRITY_FAILURE_CODES.has(record.failureCode ?? "")) {
    throw new BanzaiError(
      "TERMINAL_CHECKPOINT_CONFLICT",
      "Conflicting terminal or session evidence cannot be reconciled as success."
    );
  }
  const { settings, role } = checkpointSettings(attempt, config);
  const expectedContext =
    record.sessionContext ?? sessionContext(role, settings);
  const expectedApprovalDigest = state.planApproval?.digest ?? null;
  const expectedWorkflowDigest =
    state.planApproval === null
      ? (state.workflowSelection?.digest ?? null)
      : null;
  const expectedResultContract =
    attempt.kind === "review" && record.reviewContext === undefined
      ? "review-result/v1"
      : terminalResultContract(attempt.kind, state.verificationMode === "task");
  const resultContractMatches =
    checkpoint.resultContract === expectedResultContract ||
    (expectedResultContract === "phase-result/v3" &&
      checkpoint.resultContract === "phase-result/v2");
  if (
    checkpoint.runId !== state.runId ||
    checkpoint.attempt.id !== attempt.id ||
    checkpoint.attempt.kind !== attempt.kind ||
    checkpoint.attempt.mutable !== attempt.mutable ||
    checkpoint.phase !== attempt.kind ||
    !resultContractMatches ||
    checkpoint.baseCommit !== state.baseCommit ||
    checkpoint.approvalDigest !== expectedApprovalDigest ||
    checkpoint.workflowDigest !== expectedWorkflowDigest ||
    checkpoint.scopeDigest !== attemptScopeDigest(state, attempt) ||
    checkpoint.configuration.vendor !==
      (vendorFor(settings.executable) ?? FALLBACK_VENDOR[role]) ||
    checkpoint.configuration.executableDigest !==
      digestCanonicalJson(settings.executable) ||
    checkpoint.configuration.model !== settings.model ||
    checkpoint.configuration.effort !== settings.effort ||
    checkpoint.configuration.sessionMode !== (record.sessionMode ?? "fresh") ||
    checkpoint.configuration.sessionContextDigest !==
      digestCanonicalJson(expectedContext) ||
    state.recovery?.sourceAttemptId === attempt.id
  ) {
    throw new BanzaiError(
      "TERMINAL_CHECKPOINT_MISMATCH",
      "Terminal checkpoint does not match the active run, attempt, authorization, or model context."
    );
  }
  await validateBaseCommit(context, state);
  if (expectedApprovalDigest !== null) {
    await validateApproval(context, state);
  } else if (expectedWorkflowDigest !== null) {
    if (
      attempt.kind === "plan" ||
      attempt.kind === "planning_review" ||
      attempt.kind === "planning_analysis"
    ) {
      const selection = state.workflowSelection ?? null;
      if (
        selection?.workflow !== "strict" ||
        workflowAuthorizationDigest({
          runId: state.runId,
          request: state.request,
          ...selection
        }) !== selection.digest
      ) {
        throw new BanzaiError(
          "WORKFLOW_AUTHORIZATION_INVALID",
          "Planning checkpoint requires the unchanged strict workflow selection."
        );
      }
    } else {
      validateWorkflowSelection(state);
    }
  }
  await validateTerminalCheckpointResult(
    context,
    state,
    attempt,
    checkpoint.result,
    config
  );
  if (record.status === "completed") {
    if (
      record.result === null ||
      JSON.stringify(record.result) !== JSON.stringify(checkpoint.result)
    ) {
      throw new BanzaiError(
        "TERMINAL_CHECKPOINT_CONFLICT",
        "Completed attempt result conflicts with its terminal checkpoint."
      );
    }
    return null;
  }
  if (
    (record.status !== "started" && record.status !== "failed") ||
    (record.result !== null &&
      JSON.stringify(record.result) !== JSON.stringify(checkpoint.result))
  ) {
    throw new BanzaiError(
      "TERMINAL_CHECKPOINT_CONFLICT",
      `Terminal checkpoint cannot promote an attempt in ${record.status} state.`
    );
  }
  if (
    state.metrics.usageAccountedAttemptIds === undefined &&
    record.status === "failed" &&
    record.usage !== null
  ) {
    state.metrics.usageAccountedAttemptIds = [
      ...state.metrics.completedAttemptIds,
      record.attempt.id
    ];
  }
  if (record.schemaVersion === 1)
    record.schemaVersion = MODEL_ATTEMPT_SCHEMA_VERSION;
  record.result = checkpoint.result;
  record.sessionId = checkpoint.sessionId;
  record.usage = checkpoint.usage;
  return checkpoint.terminal.observedAt;
}

export async function validateTerminalCheckpointResult(
  context: RunnerContext,
  state: RunState,
  attempt: AttemptReference,
  result: TerminalCheckpointResult,
  config: OrchestratorConfig,
  reconcilingPlanningPublication = false
): Promise<void> {
  await validateSavedArtifactScope(
    context,
    state,
    attempt,
    reconcilingPlanningPublication
  );
  if (
    attempt.kind === "planning_review" ||
    attempt.kind === "planning_analysis"
  ) {
    const episode = state.planningReview?.active;
    if (episode == null)
      throw new BanzaiError(
        "INVALID_TERMINAL_CHECKPOINT",
        "Planning episode is missing."
      );
    if (attempt.kind === "planning_review")
      validatePlanningReviewResult(result, episode);
    else {
      if (episode.reviewAttemptId === null || episode.resultDigest === null)
        throw new BanzaiError(
          "INVALID_TERMINAL_CHECKPOINT",
          "Planning review evidence is missing."
        );
      const review = await context.store.readRunAttempt(state.runId, {
        id: episode.reviewAttemptId,
        kind: "planning_review",
        mutable: false
      });
      validatePlanningReviewAnalysis(result, {
        ...episode,
        resultDigest: episode.resultDigest,
        findings: parsePlanningReviewResult(review.result).findings
      });
    }
    return;
  }
  if (attempt.kind === "selection") {
    return;
  }
  if (attempt.kind === "review") {
    validateReviewResultForApplication(state, result as ReviewResult);
    const record = await context.store.readRunAttempt(state.runId, attempt);
    if (
      record.reviewContext !== undefined ||
      (result as ReviewResult).schemaVersion === 2
    ) {
      const frozen = await context.store.readReviewSnapshot(
        state.runId,
        attempt
      );
      if (record.reviewContext?.snapshotDigest !== frozen.digest)
        throw new BanzaiError(
          "INVALID_REVIEW_SNAPSHOT",
          "Checkpoint snapshot binding is missing or conflicting."
        );
      validateReviewScope(parseCurrentReviewResult(result), {
        snapshotDigest: frozen.digest,
        approvedArtifactPaths: frozen.approval.paths,
        requiredFindingIds: frozen.requiredFindingIds
      });
    }
    return;
  }
  const phaseResult = parsePersistedPhaseResult(result);
  validateArtifactRoleReferences(state, phaseResult);
  if (phaseResult.phase !== attempt.kind) {
    throw new BanzaiError(
      "PHASE_RESULT_MISMATCH",
      `Attempt ${attempt.kind} returned phase ${phaseResult.phase}.`
    );
  }
  if (attempt.kind === "plan") {
    await validatePlanningResult(context, state, attempt, phaseResult);
    return;
  }
  await establishResultSourceIdentities(
    context,
    state,
    attempt,
    phaseResult,
    config
  );
  if (attempt.kind === "fix") {
    if (phaseResult.taskCompletion !== null) {
      // ADR 0025: a fix may refresh the canonical ledger. The reconciled
      // result is validated exactly like the live path validates it, and the
      // checkpoint records the fix attempt as the canonical source.
      if (state.planApproval === null) {
        throw new PlanTaskCompletionError(
          "approval_invalid",
          "Strict completion validation requires an approved plan bundle."
        );
      }
      state.planTaskCompletion = {
        ...(
          await validatePlanTaskCompletion({
            repoRoot: context.repoRoot,
            artifactBinding: state.artifactBinding,
            sourceAttemptId: attempt.id,
            result: phaseResult,
            planPath: completionPlanPath(state),
            approval: state.planApproval,
            baseline: state.baseline
          })
        ).summary,
        sourceAttemptKind: "fix"
      };
    }
    return;
  }
  if ((state.workflowSelection?.workflow ?? "strict") !== "strict") {
    if (phaseResult.taskCompletion !== null) {
      throw new BanzaiError(
        "PLAN_TASK_COMPLETION_INVALID",
        "Lite implementation must not return strict plan-task completion evidence."
      );
    }
    return;
  }
  if (phaseResult.outcome === "completed" && phaseResult.gate === null) {
    state.planTaskCompletion = (
      await validateImplementationCompletion(
        context,
        state,
        attempt,
        phaseResult
      )
    ).summary;
    return;
  }
  validatePlanTaskCompletionLedgerShape(
    await approvedTaskIds(context, state),
    phaseResult.taskCompletion,
    phaseResult.outcome
  );
}

export function checkpointSettings(
  attempt: AttemptReference,
  config: OrchestratorConfig
): { settings: ModelSettings; role: SessionContext["role"] } {
  if (
    attempt.kind === "selection" ||
    attempt.kind === "plan" ||
    attempt.kind === "planning_analysis"
  ) {
    return { settings: config.models.planner, role: "planner" };
  }
  if (attempt.kind === "review" || attempt.kind === "planning_review") {
    return { settings: config.models.reviewer, role: "reviewer" };
  }
  return { settings: config.models.implementer, role: "implementer" };
}

/**
 * ADR-0051: every model-authored source identity that acts as an execution
 * precondition is established against the bytes it names at the boundary
 * where the result is accepted, before any later phase depends on it.
 */
export async function establishResultSourceIdentities(
  context: RunnerContext,
  state: RunState,
  attempt: AttemptReference,
  result: PhaseResult | PersistedPhaseResult,
  config: OrchestratorConfig
): Promise<void> {
  if (state.verificationMode !== "task") return;
  const candidates =
    result.schemaVersion === 4 ? (result.verificationCandidates ?? null) : null;
  const observe = async (
    relativePath: string
  ): Promise<{
    observed: string | null;
    size: number | null;
    limit: number | null;
  }> => {
    try {
      const file = await taskVerificationPath(context.repoRoot, relativePath);
      const size = (await lstat(file)).size;
      // A source above the bound is a distinct outcome, never a mismatch:
      // its bytes are not read at all, so no digest can be observed. The
      // bound travels with that outcome so the rejection can name it.
      return size > TASK_VERIFICATION_SOURCE_MAX_BYTES
        ? { observed: null, size, limit: TASK_VERIFICATION_SOURCE_MAX_BYTES }
        : {
            observed: evidenceDigest(await readFile(file)),
            size,
            limit: null
          };
    } catch {
      // An unresolvable or unsafe source asserts neither cause.
      return { observed: null, size: null, limit: null };
    }
  };
  const comparisons: ResultDigestComparison[] = [];
  for (const identity of effectiveResultSourceIdentities(
    candidates,
    await requiredCheckIds(context, state, config)
  )) {
    const { observed, size, limit } = await observe(identity.path);
    comparisons.push({
      role: "precondition",
      field: identity.field,
      checkId: identity.checkId,
      path: identity.path,
      declared: identity.declared,
      observed,
      size,
      limit,
      matched: observed === identity.declared
    });
  }
  await recordResultDigestEvidence(context, state, attempt, comparisons);
}
