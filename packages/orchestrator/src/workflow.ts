import { freezeReviewConfiguration } from "./configuration-review.js";
import { AsyncLocalStorage } from "node:async_hooks";
import {
  captureVerificationInputs,
  decideVerification,
  evidenceDigest,
  parseVerificationConfiguration,
  parseVerificationObligations,
  sameVerificationCapture,
  persistVerificationDecision,
  persistVerificationOriginStart,
  persistVerificationOriginFinish,
  readVerificationOrigins,
  verificationApplicability,
  persistVerificationApplicability
} from "./verification-evidence.js";
import type {
  VerificationCapture,
  VerificationStorage
} from "./verification-evidence.js";
import {
  hasRunnerWorkOwnership,
  withRunnerWorkOwnership,
  createWork,
  artifactRoles,
  inspectBoundWork,
  readBytes as readArtifactBytes,
  ownsArtifact,
  safePath
} from "./artifact-storage.js";
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  access,
  chmod,
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  unlink,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import {
  classifyModelFailure,
  resolveClaudeInvocationScope
} from "./adapters.js";
import {
  sealReviewSnapshot,
  reviewApprovedArtifacts
} from "./review-snapshot.js";
import {
  combineInstructionParity,
  inspectRoleInstructionParity,
  instructionParityDiagnostic,
  instructionPhasesForRole
} from "./phase-instructions.js";
import type { InstructionPhase, InstructionParity } from "./types.js";
import { assertContractParity } from "./contracts.js";
import {
  claudePermissionDemand,
  claudePermissionDemanded,
  claudePermissionRemediation,
  inspectClaudePermissions
} from "./claude-permissions.js";
import { loadConfig } from "./config.js";
import {
  CONFIGURATION_ACTIONS,
  CONFIGURATION_PREREQUISITE_SCHEMA,
  configurationDigest,
  configurationId,
  configurationText,
  hasConfigurationSetup,
  parseConfigurationPrerequisite,
  proposalAsProfile,
  reviseVerificationProfile,
  substantiveProposal,
  verificationProposal,
  type ConfigurationAction,
  type ConfigurationContinuation,
  type ConfigurationPrerequisiteRequest,
  type ConfigurationDecisionRecord,
  type ConfigurationResolution
} from "./configuration-prerequisite.js";
import type { VerificationProjectType } from "./types.js";
import {
  previewVerificationConfig,
  publishVerificationConfig,
  readVerificationConfig,
  readVerificationConfigTransactions,
  readVerificationConfigConfirmation,
  CONFIGURATION_OWNED_MESSAGE,
  reconcileVerificationConfig,
  verificationCommandIds,
  type VerificationConfigContext,
  type VerificationConfigTransaction
} from "./verification-config.js";
import {
  adoptionDiagnostic,
  inspectProjectAdoption
} from "./project-adoption.js";
import {
  available,
  emptyContextInventory,
  emptyContextVendorUsage,
  evaluateContextBudgets,
  measureRunnerPayload,
  unavailable
} from "./context-accounting.js";
import {
  BanzaiError,
  errorMessage,
  ProcessExitError,
  ProjectSetupRequiredError,
  InstructionResourceMismatchError,
  TerminalRunStateError
} from "./errors.js";
import {
  CANCELLATION_SCHEMA,
  cancellationId,
  cancellationResponse,
  captureCancellationContext,
  decodeCancellationAnchor,
  decodeCancellationObservation,
  emptyCancellationContext,
  initialCancellationResponse,
  isCancellationReason,
  resolveCancellation
} from "./cancellation.js";
import type {
  CancelRunInput,
  CancellationAnswer,
  CancellationContext,
  CancellationObservation,
  CancellationReceipt,
  CancellationResponseResult,
  CancellationResult,
  StopRequest
} from "./cancellation.js";
import {
  CANCELLATION_LIMITS,
  decodeCancellationEvents,
  enrichCancellationContext,
  readCancellationFile
} from "./cancellation-evidence.js";
import type { CancellationContextLinks } from "./cancellation-evidence.js";
import { reviewVerdictText } from "./vocabulary.js";
import {
  parseApprovedPlanTaskIds,
  validatePlanRunnerControlTasks,
  planHumanPrerequisites,
  validatePlanVerificationObligations,
  parsePlanTaskCompletionProjection,
  PlanTaskCompletionError,
  summariesMatch,
  validatePlanTaskCompletionLedgerShape,
  validatePlanTaskCompletion,
  validateCompletionClaims,
  composeCompletionCandidate,
  eligibleGapHeadings,
  scanCompletionRegion,
  parsePublishedCompletionRegion,
  ledgerDigest,
  planTaskDigest,
  type ValidatedCompletionClaims,
  type ValidatedPlanTaskCompletion
} from "./plan-task-completion.js";
import {
  currentCommit,
  repositoryBaseline,
  digestArtifactBundle,
  digestArtifactEntries,
  hashArtifactBytes,
  workspaceChanges,
  workspaceChangeCounts,
  workspaceDigest,
  workspaceSnapshot,
  type WorkspaceSnapshot
} from "./git.js";
import {
  fixPromptEnvelope,
  implementationPromptEnvelope,
  liteImplementationPromptEnvelope,
  planningPromptEnvelope,
  planningRetryPromptEnvelope,
  recoveryPromptEnvelope,
  reviewPromptEnvelope,
  serenaGuidance,
  workflowSelectionPromptEnvelope,
  workflowPhases
} from "./prompts.js";
import { insertPhaseInstructions } from "./prompt-envelope.js";
import { resolveOutputContract } from "./output-contract.js";
import {
  FALLBACK_VENDOR,
  MODEL_ROLES,
  vendorFor,
  vendorUsage,
  type ModelRole
} from "./models.js";
import {
  redactSensitiveText,
  runProcess,
  subscriptionOnlyEnvironment,
  terminateProcessGroup
} from "./process.js";
import {
  renderReviewArtifact,
  publishReviewArtifact,
  reviewArtifactPath,
  validateHistoricalReviewArtifact,
  validateReviewArtifact,
  type ValidatedReviewCandidate
} from "./review-artifact.js";
import { blockState, requireState, transitionState } from "./state-machine.js";
import { RunStore } from "./store.js";
import type {
  HumanTimeBoundary,
  HumanTimeEventType,
  HumanTimeObserver
} from "./human-time.js";
import {
  COMPLETION_CANDIDATE_SCHEMA,
  COMPLETION_CAPTURE_SCHEMA,
  COMPLETION_PROTOCOL,
  COMPLETION_PUBLICATION_SCHEMA,
  COMPLETION_RECORD_SCHEMA_VERSION,
  COMPLETION_SUMMARY_SCHEMA_VERSION,
  COMPLETION_TRANSITION_SCHEMA,
  CONTRACT_VERSION,
  MODEL_ATTEMPT_SCHEMA_VERSION,
  RECOVERY_AUTHORIZATION_SCHEMA,
  RECOVERY_AUTHORIZATION_SCHEMA_VERSION,
  STRICT_MODEL_ATTEMPT_SCHEMA_VERSION,
  TERMINAL_CHECKPOINT_SCHEMA,
  TERMINAL_CHECKPOINT_SCHEMA_V2,
  TERMINAL_CHECKPOINT_SCHEMA_VERSION,
  TERMINAL_CHECKPOINT_SCHEMA_VERSION_V2,
  sessionBindingMatches,
  type AdapterTerminalSuccess,
  type AdapterResult,
  type AdrDecision,
  type AttemptRecord,
  type AttemptReference,
  type ClaudeInvocationScope,
  type CompletionCandidate,
  type CompletionCapture,
  type CompletionDiagnostic,
  type CompletionObservedInputs,
  type CompletionPublication,
  type CompletionPublicationCursor,
  type CompletionPublicationRefusalCode,
  type CompletionPublicationStage,
  type CompletionReportObservation,
  type CompletionTransition,
  type PhaseArtifacts,
  type PhaseResultEnvelope,
  type PlanTaskCompletionLedger,
  type ReviewCompletionPublication,
  type TerminalAttemptCheckpointV2,
  type ValidPlanTaskCompletionSummary,
  type ContextAuthorityEntry,
  type ContextMetric,
  type DecisionConsultationAnswer,
  type FindingDisposition,
  type ModelFailureCause,
  type HumanDecisionRequest,
  type HumanDecisionRecord,
  type ModelProgressEvent,
  type ModelSessionBinding,
  type ModelSettings,
  type McpWhitelist,
  type ModelUsage,
  type OrchestratorConfig,
  type OutputContractEnvelope,
  type OutputContractIdentity,
  type PhaseDescriptor,
  type PhaseResult,
  type PersistedPhaseResult,
  type PlanTaskCompletionViolation,
  type ProcessRunner,
  type ProgressEvent,
  type ProgressReporter,
  type PromptEnvelope,
  type ReviewCandidateEvidence,
  type ReviewFinding,
  type ReviewArtifactMode,
  type ReviewArtifactContext,
  type ReviewMode,
  type ReviewRotationReason,
  type ReviewResult,
  type RecoveryAuthorization,
  type ReviewerSessionBinding,
  type RunState,
  type SessionInventory,
  type SessionContext,
  type SessionMode,
  type TerminalAttemptCheckpoint,
  type TerminalCheckpointResult,
  type TerminalResultContract,
  type TriageItem,
  type TriageRecord,
  type VendorAdapters,
  type VerificationAttemptFailureCategory,
  type VerificationAttemptRecord,
  type VerificationCommandDescriptor,
  type VerificationResult,
  type WorkflowRoute,
  type WorkflowSelectionRecord,
  type WorkflowSelectionResult
} from "./types.js";
import {
  completionRecordIntegrity,
  digestCanonicalJson,
  isPhaseResultEnvelope,
  envelopeResultFields,
  phaseResultFromEnvelope,
  parseDecisionConsultationAnswers,
  parsePersistedPhaseResult,
  parseReviewResult,
  parseCurrentReviewResult,
  phaseResultEnvelopeOf,
  validateReviewScope,
  terminalCheckpointIntegrity
} from "./validation.js";
import {
  describeVerificationCommands,
  flattenVerificationCommands,
  assessVerificationReadiness,
  inspectVerificationProject,
  inspectCommandPrerequisite,
  isRepositoryHygieneCommand,
  usesVerificationPolicy,
  type VerificationProjectInspection
} from "./verification.js";

const TERMINAL_STATUSES = new Set(["done", "cancelled"]);
const MAX_CONSECUTIVE_DELTA_REVIEWS = 2;
const PHASE_PHASES = {
  Selection: ["selection"],
  Planning: ["planning"],
  Implementation: ["implementation"],
  Fix: ["fix"],
  Review: ["review"]
} as const;

interface AttemptPolicy {
  sessionMode: SessionMode;
  resumeSessionId: string | null;
  sessionContext: SessionContext;
  reviewMode?: ReviewMode;
  rotationReason?: ReviewRotationReason | null;
  /** Present for strict implementation/fix attempts under the completion protocol. */
  completion?: { retryOf: string | null };
}

interface ReviewExecutionPolicy extends AttemptPolicy {
  sessionContext: SessionContext & { role: "reviewer" };
  reviewMode: ReviewMode;
  rotationReason: ReviewRotationReason | null;
}

function sessionContext(
  role: SessionContext["role"],
  settings: ModelSettings
): SessionContext {
  return {
    role,
    executable: settings.executable,
    model: settings.model,
    effort: settings.effort
  };
}

function sessionBinding(
  id: string | null,
  context: SessionContext
): ModelSessionBinding | null {
  return id === null ? null : { id, ...context };
}

/**
 * Identifies the ambient-environment inputs that decide a Claude session's tool
 * inventory. Comparing it before resuming rotates a stale reviewer without
 * spending the full-prefix re-cache that a mismatched resume would cost.
 */
export function invocationScopeDigest(scope: ClaudeInvocationScope): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        scope.strictMcpConfig,
        scope.settingSources,
        scope.pluginDirectory
      ])
    )
    .digest("hex");
}

/**
 * Causes that say nothing about review integrity. A transient vendor condition
 * must not discard a reviewer session and promote its retry to a full
 * from-scratch audit.
 */
const INTEGRITY_NEUTRAL_FAILURE_CAUSES = new Set<ModelFailureCause>([
  "capacity",
  "timeout",
  "process_start",
  "transport"
]);

/**
 * Completion violations whose defect lives in the approved plan bundle rather
 * than in the attempt's evidence. A fresh implementation attempt can never
 * repair these — the plan is immutable while approved — so their retry reruns
 * planning for a corrected bundle and a new approval instead of looping a
 * completion-evidence repair that must fail identically every time.
 */
const PLAN_BUNDLE_COMPLETION_VIOLATIONS = new Set<PlanTaskCompletionViolation>([
  "approved_plan_invalid",
  "approval_invalid"
]);

/**
 * Failures that can terminate an already-running mutable model after it has
 * changed the checkout but before a terminal result reaches Banzai. They need
 * the same explicit, snapshot-bound recovery path as a parent interruption.
 * Process-start failures are excluded because no mutable child ran, while an
 * unclassified failure remains fail-closed because its integrity is unknown.
 */
const RECOVERABLE_MUTABLE_FAILURE_CAUSES = new Set<ModelFailureCause>([
  "capacity",
  "timeout",
  "transport"
]);

const PLANNING_REPAIR_FAILURE_CODES = new Set([
  "INVALID_RESULT",
  "MODEL_RESULT_INVALID",
  "CODEX_RESULT_MISSING",
  "PHASE_RESULT_SCHEMA_MISMATCH",
  "PLAN_TASK_COMPLETION_INVALID"
]);

const TERMINAL_INTEGRITY_FAILURE_CODES = new Set([
  "TERMINAL_RESULT_CONFLICT",
  "SESSION_ID_CONFLICT"
]);

/** Exact identity equality for the report and workspace inputs of one capture. */
function sameObservedInputs(
  a: CompletionObservedInputs,
  b: CompletionObservedInputs
): boolean {
  return (
    digestCanonicalJson(a.implementationReport) ===
      digestCanonicalJson(b.implementationReport) &&
    digestCanonicalJson(a.testReport) === digestCanonicalJson(b.testReport) &&
    a.workspaceDigest === b.workspaceDigest
  );
}

/**
 * A publication refusal under the completion protocol (ADR-0047 section 4).
 * The closed code and stage are persisted; the remedy is operator guidance
 * and never carries model text or raw error output.
 */
class CompletionRefusal extends Error {
  constructor(
    readonly code: CompletionPublicationRefusalCode,
    readonly stage: CompletionPublicationStage,
    readonly proofDigest: string | null,
    readonly remedy: string
  ) {
    super(`${code} at ${stage}`);
    this.name = "CompletionRefusal";
  }
}

export function reviewExecutionPolicy(
  state: RunState,
  settings: ModelSettings,
  currentInvocationDigest: string | null = null
): ReviewExecutionPolicy {
  const context = {
    ...sessionContext("reviewer", settings),
    role: "reviewer" as const
  };
  const fresh = (
    rotationReason: ReviewRotationReason
  ): ReviewExecutionPolicy => ({
    sessionMode: "fresh",
    reviewMode: "full",
    rotationReason,
    resumeSessionId: null,
    sessionContext: context
  });
  if (state.pendingReviewRotationReason !== null) {
    return fresh(state.pendingReviewRotationReason);
  }
  if (state.latestReview === null) {
    return fresh("primary-review");
  }
  const reviewer = state.sessions.reviewer;
  if (reviewer === null) {
    return fresh("missing-session");
  }
  if (!sessionBindingMatches(reviewer, settings, "reviewer")) {
    return fresh("settings-changed");
  }
  // An absent recorded digest is a binding written before ADR 0021: unknown,
  // never treated as a mismatch.
  if (
    currentInvocationDigest !== null &&
    reviewer.invocationDigest !== undefined &&
    reviewer.invocationDigest !== currentInvocationDigest
  ) {
    return fresh("session-inventory-changed");
  }
  if (reviewer.approvalDigest !== (state.planApproval?.digest ?? "")) {
    return fresh("approval-changed");
  }
  if (
    reviewer.lastSnapshot.digest !== state.latestReview.workspaceDigest ||
    state.workspaceDigest !== state.latestReview.workspaceDigest ||
    reviewer.lastFullIteration > state.latestReview.iteration
  ) {
    return fresh("unreliable-review");
  }
  if (state.latestReview.verdict === "blocked") {
    return fresh("previous-review-blocked");
  }
  if (reviewer.consecutiveDeltaReviews >= MAX_CONSECUTIVE_DELTA_REVIEWS) {
    return fresh("delta-limit-reached");
  }
  if (
    reviewer.outputContract !== undefined &&
    !["review-result/v1", "review-result/v2"].includes(reviewer.outputContract)
  ) {
    throw new BanzaiError(
      "REVIEW_RESULT_SCHEMA_MISMATCH",
      "Reviewer session has an unsupported output-contract identity."
    );
  }
  if (reviewer.outputContract !== "review-result/v2")
    return fresh("output-contract-not-reusable");
  return {
    sessionMode: "resumed",
    reviewMode: "delta",
    rotationReason: null,
    resumeSessionId: reviewer.id,
    sessionContext: context
  };
}

/**
 * Accumulates the usage of two turns that belong to one attempt, so a repair
 * turn's cost is attributed rather than replacing the turn it repaired.
 */

function effectiveWorkflow(result: WorkflowSelectionResult): WorkflowRoute {
  if (
    result.recommendedWorkflow !== "strict" &&
    result.confidence === "high" &&
    result.escalationTriggers.length === 0
  ) {
    return result.recommendedWorkflow;
  }
  return "strict";
}

function isRetryableInterruptedAttempt(
  attempt: AttemptReference,
  record: AttemptRecord
): boolean {
  return (
    !attempt.mutable &&
    record.status === "started" &&
    (attempt.kind === "selection" || attempt.kind === "review")
  );
}

function verificationFailureCategory(
  error: unknown
): VerificationAttemptFailureCategory {
  if (error instanceof BanzaiError) {
    if (error.code === "PROCESS_START_FAILED") {
      return "process_start";
    }
    if (error.code === "PROCESS_TIMEOUT") {
      return "timeout";
    }
    if (error.code === "PROCESS_OUTPUT_LIMIT") {
      return "output_limit";
    }
  }
  return "runner_failure";
}

function verificationCommandMatches(
  record: VerificationAttemptRecord,
  descriptor: VerificationCommandDescriptor
): boolean {
  return (
    record.command.profileId === descriptor.profileId &&
    record.command.projectType === descriptor.projectType &&
    record.command.profileOrdinal === descriptor.profileOrdinal &&
    record.command.commandOrdinal === descriptor.commandOrdinal &&
    record.command.configurationDigest === descriptor.configurationDigest
  );
}

function terminalVerificationRecord(
  record: VerificationAttemptRecord,
  input: Pick<
    VerificationAttemptRecord,
    | "status"
    | "completedAt"
    | "exitCode"
    | "signal"
    | "failureCategory"
    | "stdout"
    | "stderr"
  >
): VerificationAttemptRecord {
  const candidateCompletedAt = input.completedAt ?? now();
  const completedAt =
    Date.parse(candidateCompletedAt) >= Date.parse(record.startedAt)
      ? candidateCompletedAt
      : now();
  return {
    ...record,
    ...input,
    completedAt,
    durationMs: Math.max(
      0,
      Date.parse(completedAt) - Date.parse(record.startedAt)
    )
  };
}

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

export interface StartRunInput {
  slug: string;
  request: string;
}

export interface TriageInput {
  accepted: string[];
  rejected: string[];
  deferred: string[];
  note: string | null;
  decidedBy: string;
}

export interface HumanDecisionInput {
  answers: string[];
  decidedBy: string;
}

export interface DecisionConsultationInput {
  runId: string;
  requestId: string;
  roundId: string;
  answers: DecisionConsultationAnswer[];
  decidedBy: string;
}

export interface ConfigurationDecisionInput {
  runId: string;
  decisionId: string;
  proposalId: string;
  action: ConfigurationAction;
  profile?: unknown;
  decidedBy: string;
}

export function humanDecisionQuestions(
  pending: HumanDecisionRequest,
  liteWorkflow: boolean
): string[] {
  if (pending.kind === "configuration_prerequisite") return [];
  if (pending.kind === "decision_consultation") {
    return pending.request.decisions.map((decision) => decision.question);
  }
  if (pending.questions.length > 0) {
    return [...pending.questions];
  }
  return [
    liteWorkflow
      ? "What decision should workflow reselection apply?"
      : "What decision or approval should planning apply?"
  ];
}

const UNSAFE_HUMAN_DECISION_CONTROL =
  /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u;

function decisionText(
  value: unknown,
  label: string,
  maximum: number,
  allowNewlines = false
): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximum ||
    value.trim().length === 0 ||
    UNSAFE_HUMAN_DECISION_CONTROL.test(value) ||
    (!allowNewlines && /[\r\n]/u.test(value))
  ) {
    throw new BanzaiError(
      "INVALID_DECISION",
      `${label} must be a bounded non-empty safe string.`
    );
  }
  return value;
}

function decisionIdentifier(
  value: unknown,
  label: string,
  maximum = 128
): string {
  const identifier = decisionText(value, label, maximum);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(identifier)) {
    throw new BanzaiError(
      "INVALID_DECISION",
      `${label} must be a canonical identifier.`
    );
  }
  return identifier;
}

export interface WorkflowStatus {
  state: RunState;
  planApprovalValid: boolean | null;
  reviewValid: boolean | null;
  latestReview: ReviewResult | null;
  retry: RetryEligibility;
  recovery: RecoveryEligibility;
  nextAction: string | null;
  taskCompletion: WorkflowTaskCompletionStatus;
  /** Runner-owned completion publication route for the newest strict attempt. */
  completionPublication: {
    attemptId: string;
    attemptKind: "implementation" | "fix";
    stage: CompletionPublicationStage;
    refusal: CompletionPublicationRefusalCode | null;
    pending: boolean;
    action: "resume" | "cancel" | null;
  } | null;
  configurationPrerequisite?: {
    repairCommands: string[];
    acceptUnavailable?: string;
  };
}

export interface WorkflowTaskCompletionStatus {
  state:
    | "complete"
    | "incomplete"
    | "inconsistent"
    | "legacy"
    | "unknown"
    | "not_applicable";
  source:
    "structured completion evidence" | "plan checkbox" | "legacy" | "unknown";
  completed: number | null;
  total: number | null;
  diagnostics: {
    code: string;
    taskId: string | null;
    message: string;
  }[];
}

export type ReviewCompletion =
  | {
      basis: "review_pass";
      iteration: number;
    }
  | {
      basis: "human_triage";
      iteration: number;
      accepted: number;
      rejected: number;
      deferred: number;
    }
  | null;

export function reviewCompletion(status: WorkflowStatus): ReviewCompletion {
  const { state, latestReview } = status;
  if (
    state.status !== "done" ||
    (state.workflowSelection?.workflow ?? "strict") !== "strict" ||
    state.latestReview === null ||
    latestReview === null
  ) {
    return null;
  }
  const iteration = state.latestReview.iteration;
  if (latestReview.verdict === "pass") {
    return { basis: "review_pass", iteration };
  }
  const triage = state.triage;
  if (
    latestReview.verdict !== "changes_requested" ||
    triage?.reviewIteration !== iteration
  ) {
    return null;
  }
  if (triage.items.length !== latestReview.findings.length) {
    return null;
  }
  const findingIds = new Set(
    latestReview.findings.map((finding) => finding.id)
  );
  if (
    triage.items.some((item) => !findingIds.has(item.findingId)) ||
    new Set(triage.items.map((item) => item.findingId)).size !== findingIds.size
  ) {
    return null;
  }
  const accepted = triage.items.filter(
    (item) => item.disposition === "accepted"
  ).length;
  if (accepted !== 0) {
    return null;
  }
  return {
    basis: "human_triage",
    iteration,
    accepted,
    rejected: triage.items.filter((item) => item.disposition === "rejected")
      .length,
    deferred: triage.items.filter((item) => item.disposition === "deferred")
      .length
  };
}

export function reviewStatusLines(status: WorkflowStatus): string[] {
  if (status.latestReview === null || status.state.latestReview === null) {
    return [];
  }
  const lines = [
    `Review: ${status.latestReview.verdict} (iteration ${status.state.latestReview.iteration})`
  ];
  const completion = reviewCompletion(status);
  if (completion?.basis === "human_triage") {
    lines.push(
      `Completion: human triage (accepted=${completion.accepted}, rejected=${completion.rejected}, deferred=${completion.deferred})`
    );
  }
  return lines;
}

/** A phase activity's display string plus its structured banner facts. */
interface ActivityDetail {
  detail: string;
  descriptor: PhaseDescriptor | undefined;
}

export interface RetryEligibility {
  eligible: boolean;
  reason: string;
  attemptId: string | null;
}

export interface RecoveryEligibility {
  eligible: boolean;
  terminalCheckpointPresent?: boolean;
  reason: string;
  warning: string;
  sourceKind: "interrupted" | "prerequisite_blocked_fix" | null;
  attemptId: string | null;
  phase: "implementation" | "fix" | null;
  resolvedFindingIds: string[];
  remainingFindingIds: string[];
  prerequisites: string[];
  authorization: "plan_approval" | "workflow_selection" | null;
  recoveryIdentity: string | null;
  workspace: {
    digest: string;
    added: number;
    modified: number;
    deleted: number;
    total: number;
  } | null;
  baseCommit: string | null;
  approvalDigest: string | null;
  workflowDigest: string | null;
  scopeDigest: string | null;
  configurationDigest: string | null;
}

interface PrerequisiteBlockedFixScope {
  attempt: AttemptReference & { kind: "fix"; mutable: true };
  record: AttemptRecord<PersistedPhaseResult>;
  result: PersistedPhaseResult;
  reviewDigest: string;
  acceptedFindingIds: string[];
  resolvedFindingIds: string[];
  remainingFindingIds: string[];
  prerequisites: string[];
  scopeDigest: string;
}

export interface RecoverInput {
  attemptId: string;
  recoveryIdentity: string;
  unknownSideEffectsAccepted: true;
  decidedBy: string;
}

const RECOVERY_WARNING =
  "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.";

function recoveryIneligible(
  reason: string,
  attemptId: string | null = null,
  phase: RecoveryEligibility["phase"] = null,
  terminalCheckpointPresent = false
): RecoveryEligibility {
  return {
    eligible: false,
    terminalCheckpointPresent,
    reason,
    warning: RECOVERY_WARNING,
    sourceKind: null,
    attemptId,
    phase,
    resolvedFindingIds: [],
    remainingFindingIds: [],
    prerequisites: [],
    authorization: null,
    recoveryIdentity: null,
    workspace: null,
    baseCommit: null,
    approvalDigest: null,
    workflowDigest: null,
    scopeDigest: null,
    configurationDigest: null
  };
}

function now(): string {
  return new Date().toISOString();
}

function runId(slug: string): string {
  const timestamp = now()
    .replace(/[-:.TZ]/g, "")
    .slice(0, 14);
  return `${timestamp}-${slug}-${randomUUID().slice(0, 8)}`;
}

function terminalResultContract(
  kind: AttemptReference["kind"]
): TerminalResultContract {
  return kind === "selection"
    ? "workflow-selection/v1"
    : kind === "review"
      ? "review-result/v2"
      : "phase-result/v3";
}

function commandDisplay(command: string, args: string[]): string {
  return [command, ...args]
    .map((part) => (/[\s"'\\]/.test(part) ? JSON.stringify(part) : part))
    .join(" ");
}

/** `a, b, and c` — an Oxford list, for prose the runner speaks aloud. */
function listPhrase(items: readonly string[]): string {
  if (items.length <= 1) {
    return items[0] ?? "";
  }
  if (items.length === 2) {
    return `${items[0]} and ${items[1]}`;
  }
  return `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;
}

function modelActivityDetail(
  settings: ModelSettings,
  attempt: AttemptReference,
  phases: readonly string[]
): string {
  const timeoutMinutes = Math.ceil(settings.timeoutMs / 60_000);
  return `${settings.executable} model=${settings.model} effort=${settings.effort} attempt=${attempt.id} timeout=${timeoutMinutes}m phases=${phases.join(" -> ")}`;
}

/**
 * The same facts a phase's detail string already carries, in the structured
 * form a presenter can render as a banner. The string stays authoritative for
 * unstyled output, so adding this changes no existing line.
 */
function phaseDescriptor(
  settings: ModelSettings,
  sessionMode: SessionMode,
  phases: readonly string[]
): PhaseDescriptor {
  return {
    executable: settings.executable,
    model: settings.model,
    effort: settings.effort,
    sessionMode,
    timeoutMs: settings.timeoutMs,
    phases
  };
}

function requireSlug(slug: string): void {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new BanzaiError(
      "INVALID_SLUG",
      "Feature slug must be lowercase kebab-case."
    );
  }
}

function checkFailureReason(error: unknown): string {
  return error instanceof BanzaiError
    ? `[${error.code}] ${error.message}`
    : errorMessage(error);
}

function artifactPaths(state: RunState): string[] {
  const artifacts = state.planArtifacts;
  if (
    artifacts?.description === null ||
    artifacts?.plan === null ||
    artifacts === null
  ) {
    throw new BanzaiError(
      "INCOMPLETE_PLAN",
      "Planning must produce description and plan artifact paths before approval."
    );
  }
  return [artifacts.description, ...artifacts.adrs, artifacts.plan];
}

function isDocumentationPath(relativePath: string): boolean {
  const normalized = relativePath.replaceAll("\\", "/");
  return (
    normalized === "documentation" || normalized.startsWith("documentation/")
  );
}

function executableCandidates(
  command: string,
  cwd: string,
  env: NodeJS.ProcessEnv
): string[] {
  if (command.includes(path.sep)) {
    return [path.resolve(cwd, command)];
  }
  return (env.PATH ?? "")
    .split(path.delimiter)
    .filter(Boolean)
    .map((entry) => path.join(entry, command));
}

async function assertExecutable(
  command: string,
  cwd: string,
  env: NodeJS.ProcessEnv
): Promise<void> {
  for (const candidate of executableCandidates(command, cwd, env)) {
    try {
      await access(candidate, constants.X_OK);
      return;
    } catch {
      // Continue through PATH candidates.
    }
  }
  throw new BanzaiError(
    "COMMAND_NOT_FOUND",
    `Configured executable is unavailable: ${command}`
  );
}

function validateNodeVersion(): void {
  const [major = 0, minor = 0] = process.versions.node.split(".").map(Number);
  if (major < 22 || (major === 22 && minor < 18)) {
    throw new BanzaiError(
      "NODE_TOO_OLD",
      `Node.js 22.18 or newer is required; found ${process.versions.node}.`
    );
  }
  if (process.platform !== "darwin" && process.platform !== "linux") {
    throw new BanzaiError(
      "UNSUPPORTED_PLATFORM",
      `Increment 1 supports macOS and Linux; found ${process.platform}.`
    );
  }
}

export class WorkflowRunner {
  private readonly cancellationReceipts = new WeakMap<
    CancellationReceipt,
    CancellationObservation
  >();
  readonly store: RunStore;
  private progressSequence = 0;
  private resolvedScope: {
    key: string;
    scope: ClaudeInvocationScope;
    degradedReason: string | null;
    mcp: McpWhitelist | null;
  } | null = null;
  private reportedScopeDegradation = false;
  private reportedMcpWhitelist = false;

  constructor(
    readonly repoRoot: string,
    readonly adapters: VendorAdapters,
    readonly processRunner: ProcessRunner = runProcess,
    readonly progressReporter: ProgressReporter = () => {},
    private readonly humanTimeObserver?: HumanTimeObserver
  ) {
    this.store = new RunStore(repoRoot);
  }

  private readonly configurationOwnership = new AsyncLocalStorage<boolean>();

  private async acquireWorkflowLock(options: { reclaimStale?: boolean } = {}) {
    if (this.configurationOwnership.getStore() === true) {
      await this.store.assertLockOwned();
      return {
        token: "inherited-configuration-owner",
        release: async () => {}
      };
    }
    return this.store.acquireLock(options);
  }

  /** Holds the existing repository owner while a human reviews configuration. */
  async withVerificationConfiguration<T>(
    action: (context: VerificationConfigContext | undefined) => Promise<T>
  ): Promise<T> {
    const lock = await this.store
      .acquireLock({ reclaimStale: false })
      .catch((error: unknown) => {
        if (error instanceof BanzaiError && error.code === "RUNNER_LOCKED")
          throw new BanzaiError("RUNNER_LOCKED", CONFIGURATION_OWNED_MESSAGE);
        throw error;
      });
    try {
      const runId = await this.store.readActiveRunId();
      const state = runId ? await this.store.readState(runId) : null;
      if (state && state.status !== "done" && state.status !== "cancelled") {
        const pending = state.pendingHumanDecision;
        if (
          !hasConfigurationSetup(state) ||
          state.status !== "needs_human_decision" ||
          pending?.kind !== "configuration_prerequisite" ||
          state.activeAttempt !== null ||
          state.activeProcess !== null
        )
          throw new BanzaiError(
            "CONFIGURATION_RUN_UNFINISHED",
            "This unfinished run has no eligible configuration checkpoint. Use banzai status and its existing recovery action."
          );
        return await withRunnerWorkOwnership(
          this.repoRoot,
          state.artifactBinding,
          async () => {
            await this.validateConfigurationContinuation(
              state,
              pending.continuation
            );
            const owner = this.configurationContext(state, pending);
            const context: VerificationConfigContext = {
              ...owner,
              origin: "verify_command",
              decisionId: null,
              proposalId: null
            };
            const result = await this.configurationOwnership.run(true, () =>
              action(context)
            );
            const latest = await this.store.readState(state.runId);
            if (
              latest.configurationSetup &&
              latest.status === "needs_human_decision" &&
              latest.pendingHumanDecision?.kind === "configuration_prerequisite"
            ) {
              const history = await readVerificationConfigTransactions(
                this.repoRoot,
                state.runId
              );
              const finalized = history
                .filter((item) => item.stage === "finalized")
                .map((item) => item.operationId);
              if (
                finalized.some(
                  (id) => !latest.configurationSetup?.transactions.includes(id)
                )
              ) {
                latest.configurationSetup.transactions = [
                  ...new Set([
                    ...latest.configurationSetup.transactions,
                    ...finalized
                  ])
                ];
                delete latest.verificationEvidence;
                await this.store.writeState(latest);
              }
            }
            return result;
          }
        );
      }
      return await this.configurationOwnership.run(true, () =>
        action(undefined)
      );
    } finally {
      await lock.release();
    }
  }

  async withConfigurationDecisionOwnership<T>(
    action: () => Promise<T>
  ): Promise<T> {
    return this.withVerificationConfiguration(() => action());
  }

  private async observeHumanTime(
    state: RunState,
    kind: HumanTimeBoundary["kind"],
    eventType: HumanTimeEventType | null = null,
    eventAt: string | null = null,
    attemptId: string | null = state.activeAttempt?.id ?? null
  ): Promise<void> {
    if (this.humanTimeObserver === undefined) return;
    const pending = state.pendingHumanDecision;
    try {
      await this.humanTimeObserver({
        kind,
        runId: state.runId,
        attemptId,
        reviewIteration:
          state.reviewIteration > 0 ? state.reviewIteration : null,
        requestId:
          pending?.kind === "decision_consultation"
            ? pending.request.requestId
            : null,
        roundId:
          pending?.kind === "decision_consultation"
            ? pending.request.roundId
            : null,
        eventType,
        eventAt
      });
    } catch {
      // Optional observation cannot change a durable decision or continuation.
    }
  }

  private report(event: ProgressEvent): void {
    try {
      this.progressReporter(event);
    } catch {
      // Terminal presentation must never change workflow behavior.
    }
  }

  /**
   * Resolves how much ambient Claude Code environment spawned processes may see.
   * Filesystem verification is refreshed for every resolution, and a degraded
   * resolution is reported once per run so the weaker isolation is never silent.
   */
  private async invocationScope(
    runId: string,
    config: OrchestratorConfig,
    report = true
  ): Promise<ClaudeInvocationScope> {
    const key = JSON.stringify(config.claudeEnvironment);
    const resolved = await resolveClaudeInvocationScope(
      config.claudeEnvironment
    );
    if (this.resolvedScope?.key !== key) {
      this.resolvedScope = {
        key,
        ...resolved,
        mcp: await this.resolveMcpWhitelist(config)
      };
      this.reportedScopeDegradation = false;
      this.reportedMcpWhitelist = false;
    }
    this.resolvedScope = { ...this.resolvedScope, ...resolved };
    const current = this.resolvedScope;
    if (
      report &&
      current.degradedReason !== null &&
      !this.reportedScopeDegradation
    ) {
      this.reportedScopeDegradation = true;
      this.info(
        `Claude environment isolation degraded: ${current.degradedReason}`
      );
      await this.store.appendEvent(runId, "claude_environment.degraded", {
        reason: current.degradedReason,
        strictMcpConfig: current.scope.strictMcpConfig
      });
    }
    if (report && current.mcp !== null && !this.reportedMcpWhitelist) {
      this.reportedMcpWhitelist = true;
      const vendors = [
        current.mcp.claude === null ? null : "claude",
        current.mcp.codex === null ? null : "codex"
      ].filter((vendor) => vendor !== null);
      const notes =
        current.mcp.notes.length > 0
          ? ` (${current.mcp.notes.join("; ")})`
          : "";
      this.info(
        vendors.length > 0
          ? `MCP whitelist: serena -> ${vendors.join(", ")}${notes}`
          : `MCP whitelist: none${notes}`
      );
      await this.store.appendEvent(runId, "mcp_whitelist.resolved", {
        claude: current.mcp.claude !== null,
        codex: current.mcp.codex !== null,
        notes: current.mcp.notes
      });
    }
    return current.mcp === null
      ? current.scope
      : { ...current.scope, mcp: current.mcp };
  }

  /**
   * The whitelist is availability-gated, never load-bearing: an absent
   * resolver (test doubles), a failed probe, or a missing Serena all resolve
   * to "no whitelist" and the run proceeds exactly as before.
   */
  /**
   * The Serena guidance line for one phase, gated on the phase vendor's
   * resolved whitelist entry so runs without Serena keep byte-identical
   * prompts.
   */
  private serenaGuidanceFor(
    environment: ClaudeInvocationScope,
    executable: string
  ): string {
    const server =
      vendorFor(executable) === "claude"
        ? (environment.mcp?.claude ?? null)
        : (environment.mcp?.codex ?? null);
    return serenaGuidance(server !== null);
  }

  private async resolveMcpWhitelist(
    config: OrchestratorConfig
  ): Promise<McpWhitelist | null> {
    const resolver = this.adapters.resolveMcpWhitelist?.bind(this.adapters);
    if (resolver === undefined) {
      return null;
    }
    const codexExecutable =
      vendorUsage(config).find((entry) => entry.vendor === "codex")
        ?.executable ?? null;
    try {
      return await resolver({ repoRoot: this.repoRoot, codexExecutable });
    } catch (error) {
      if (
        error instanceof TerminalRunStateError ||
        error instanceof ProjectSetupRequiredError ||
        error instanceof InstructionResourceMismatchError
      )
        throw error;
      this.info(`MCP whitelist unavailable: ${errorMessage(error)}`);
      return null;
    }
  }

  private info(message: string): void {
    this.report({ kind: "info", message });
  }

  /**
   * Forwards one action inside a model turn structurally. The presenter decides
   * how much of it to show, which it cannot do from a pre-formatted string.
   */
  private modelProgress(label: string, event: ModelProgressEvent): void {
    this.report({
      kind: "model_action",
      label,
      action: event.kind,
      status: event.status,
      detail: event.detail,
      actionId: event.id ?? null
    });
  }

  /**
   * Names the uncommitted changes a run starts on top of. They stay out of the
   * reviewed set, so the developer should know they were carried in rather than
   * silently attributed to the run.
   */
  private reportBaseline(state: RunState): void {
    const entries = state.baseline ?? [];
    if (entries.length === 0) {
      return;
    }
    const shown = entries.slice(0, 5).map((entry) => entry.path);
    const remainder = entries.length - shown.length;
    const suffix = remainder > 0 ? ` (+${remainder} more)` : "";
    this.info(
      `Starting on ${entries.length} carried-in change${entries.length === 1 ? "" : "s"}, excluded from review: ${shown.join(", ")}${suffix}`
    );
  }

  private async activity<T>(
    label: string,
    detail: string | ActivityDetail,
    operation: () => Promise<T>,
    succeeded: (result: T) => boolean = () => true
  ): Promise<T> {
    const id = `activity-${++this.progressSequence}`;
    const startedAt = Date.now();
    const resolved: ActivityDetail =
      typeof detail === "string" ? { detail, descriptor: undefined } : detail;
    this.report({
      kind: "activity_started",
      id,
      label,
      detail: resolved.detail,
      descriptor: resolved.descriptor
    });
    try {
      const result = await operation();
      this.report({
        kind: succeeded(result) ? "activity_completed" : "activity_failed",
        id,
        label,
        durationMs: Date.now() - startedAt
      });
      return result;
    } catch (error) {
      if (
        error instanceof TerminalRunStateError ||
        error instanceof ProjectSetupRequiredError ||
        error instanceof InstructionResourceMismatchError
      )
        throw error;
      this.report({
        kind: "activity_failed",
        id,
        label,
        durationMs: Date.now() - startedAt
      });
      throw error;
    }
  }

  private async assertProjectGuidance(layoutOnly = true): Promise<void> {
    const result = await inspectProjectAdoption(this.repoRoot, { layoutOnly });
    if (result.classification === "ready") return;
    const remedy = layoutOnly
      ? "Repair or migrate the instruction files with your own client or editor, then inspect banzai status and use the existing resume, retry or recovery action. Any saved decision remains saved; do not submit it again. Alternatively, cancel the unfinished run before using CLI setup."
      : "Run banzai setup in a terminal, or explicitly invoke banzai:project-manifest in your client, then submit the task again.";
    throw new ProjectSetupRequiredError(
      `${adoptionDiagnostic(result)}. ${remedy}`
    );
  }

  private async beforeModelAttempt(
    commitTransition?: () => Promise<void>,
    invocation?: {
      config: OrchestratorConfig;
      role: ModelRole;
      phase: InstructionPhase | "selection";
    }
  ): Promise<void> {
    await this.assertProjectGuidance();
    const state = await this.store.requireActiveState();
    if (state.artifactBinding !== undefined) {
      await inspectBoundWork(this.repoRoot, state.artifactBinding);
    }
    if (invocation !== undefined) {
      await this.assertInstructionParity(invocation.config, [
        {
          role: invocation.role,
          phases: invocation.phase === "selection" ? [] : [invocation.phase]
        }
      ]);
    }
    await commitTransition?.();
  }

  private async assertInstructionParity(
    config: OrchestratorConfig,
    demands: { role: ModelRole; phases: InstructionPhase[] }[]
  ): Promise<void> {
    // Structural refusal precedes content evidence, and is deliberately not cached.
    const resolved = await resolveClaudeInvocationScope(
      config.claudeEnvironment
    );
    const results: InstructionParity[] = [];
    for (const demand of demands) {
      const vendor =
        vendorFor(config.models[demand.role].executable) ??
        FALLBACK_VENDOR[demand.role];
      results.push(
        await inspectRoleInstructionParity(
          vendor,
          config.claudeEnvironment.mode === "ambient"
            ? null
            : resolved.scope.pluginDirectory,
          demand.phases
        )
      );
    }
    const parity = combineInstructionParity(results);
    const diagnostic = instructionParityDiagnostic(parity);
    if (parity.state !== "not_applicable") this.info(diagnostic);
    if (parity.state === "mismatch")
      throw new InstructionResourceMismatchError(diagnostic);
  }

  private async assertVerificationPreflight(
    config: OrchestratorConfig,
    report: boolean
  ): Promise<void> {
    if (config.schemaVersion === 1) return;
    const readiness = assessVerificationReadiness(
      config,
      await inspectVerificationProject(this.repoRoot)
    );
    if (readiness.uncoveredTypes.length > 0)
      throw new BanzaiError(
        "VERIFICATION_SETUP_REQUIRED",
        `Substantive verification coverage is missing. ${readiness.uncoveredTypes.map((type) => `Fix: banzai verify add ${type} — documentation/verification-examples.md`).join(" ")}`
      );
    if (report && readiness.bootstrapEffective)
      this.info(
        "Bootstrap mode: substantive verification coverage is deferred until project markers are created."
      );
  }

  async start(input: StartRunInput): Promise<RunState> {
    try {
      requireSlug(input.slug);
      if (input.request.trim().length === 0) {
        throw new BanzaiError(
          "EMPTY_REQUEST",
          "The feature request cannot be empty."
        );
      }
      // Validate before lock acquisition because the lock initializes the local
      // run directory. Reload under the lock below so a concurrent config edit
      // cannot swap policy after this mutation-free validation boundary.
      const initialConfig = await loadConfig(this.repoRoot);
      await this.assertVerificationPreflight(initialConfig, false);
      await currentCommit(this.repoRoot);
      await this.assertProjectGuidance(false);
      const lock = await this.acquireWorkflowLock();
      try {
        this.info(`Preparing run ${input.slug} in ${this.repoRoot}`);
        const config = await loadConfig(this.repoRoot);
        await this.assertVerificationPreflight(config, true);
        const baseCommit = await currentCommit(this.repoRoot);
        const createdAt = now();
        const state: RunState = {
          schemaVersion: config.schemaVersion === 1 ? 4 : 6,
          ...(config.schemaVersion === 1
            ? {}
            : {
                verificationMode:
                  config.schemaVersion === 3 && config.verification.policy
                    ? ("policy" as const)
                    : ("ordered" as const),
                configurationSetup: {
                  configSchemaVersion: config.schemaVersion,
                  configurationDigest: configurationDigest(config.verification),
                  coverage: "configured" as const,
                  projectTypes: [],
                  uncoveredTypes: [],
                  continuation: null,
                  resolutions: [],
                  skip: null,
                  transactions: []
                }
              }),
          contractVersion: CONTRACT_VERSION,
          runId: runId(input.slug),
          slug: input.slug,
          request: input.request,
          repoRoot: this.repoRoot,
          status: "created",
          createdAt,
          updatedAt: createdAt,
          baseCommit,
          baseline: [],
          workflowSelection: null,
          planArtifacts: null,
          planApproval: null,
          planTaskCompletion: null,
          adrDecisions: [],
          pendingHumanDecision: null,
          humanDecisions: [],
          sessions: { planner: null, implementer: null, reviewer: null },
          pendingReviewRotationReason: null,
          reviewIteration: 0,
          latestReview: null,
          triage: null,
          triageHistory: [],
          fixCycle: 0,
          workspaceDigest: null,
          verification: [],
          metrics: {
            completedAttemptIds: [],
            usageAccountedAttemptIds: [],
            attempts: {
              selection: 0,
              plan: 0,
              implementation: 0,
              fix: 0,
              review: 0,
              verification: 0
            },
            modelDurationMs: 0,
            usage: {
              inputTokens: 0,
              cachedInputTokens: 0,
              outputTokens: 0,
              costUsd: null
            },
            reviewFindingCount: 0,
            sessions: { fresh: 0, resumed: 0 },
            reviews: { full: 0, delta: 0, rotations: 0 },
            triage: { accepted: 0, rejected: 0, deferred: 0 }
          },
          activeAttempt: null,
          activeProcess: null,
          blockedFrom: null,
          blockReason: null
        };
        await this.assertProjectGuidance(false);
        const activeId = await this.store.readActiveRunId();
        if (activeId !== null) {
          const active = await this.store.readState(activeId);
          if (!TERMINAL_STATUSES.has(active.status)) {
            throw new BanzaiError(
              "ACTIVE_RUN_EXISTS",
              `Run ${activeId} is still ${active.status}.`
            );
          }
        }
        state.artifactBinding = await createWork({
          repoRoot: this.repoRoot,
          slug: state.slug,
          mode: "workflow",
          creationId: randomUUID(),
          schemaVersion: usesVerificationPolicy(state) ? 2 : 1
        });
        await this.store.createRun(state);
        await this.observeHumanTime(state, "run_created");
        await this.assertProjectGuidance();
        try {
          await this.activity(
            "Preflight",
            "Node, contracts, executables, verification commands, and subscription authentication",
            async () => {
              await this.preflight(config);
            }
          );
          state.baseCommit = await this.activity(
            "Repository check",
            "current commit and carried-in changes",
            async () => {
              state.baseline = await repositoryBaseline(this.repoRoot);
              return await currentCommit(this.repoRoot);
            }
          );
          this.reportBaseline(state);
        } catch (error) {
          if (
            error instanceof TerminalRunStateError ||
            error instanceof ProjectSetupRequiredError ||
            error instanceof InstructionResourceMismatchError
          )
            throw error;
          return await this.recordStartFailure(state, error);
        }
        transitionState(state, "selecting");
        await this.store.writeState(state);
        this.info(`Created run ${state.runId}; selecting workflow`);
        return await this.executeSelection(state, config);
      } finally {
        await lock.release();
      }
    } catch (error) {
      if (error instanceof TerminalRunStateError) return error.state;
      throw error;
    }
  }

  async resume(): Promise<RunState> {
    try {
      const lock = await this.acquireWorkflowLock();
      try {
        const state = await this.store.requireActiveState();
        this.info(`Resuming run ${state.runId} from ${state.status}`);
        if (TERMINAL_STATUSES.has(state.status)) {
          return state;
        }
        const config = await loadConfig(this.repoRoot);
        assertContractParity();

        if (state.recovery?.recoveryAttemptId === null) {
          const authorization = await this.store.readRecoveryAuthorization(
            state.runId,
            state.recovery.authorizationId
          );
          return await this.executeAuthorizedRecovery(
            state,
            config,
            authorization
          );
        }

        if (state.activeAttempt !== null) {
          const retry = await this.retryEligibility(state);
          if (
            retry.eligible &&
            retry.attemptId === state.activeAttempt.id &&
            state.planTaskCompletion?.status === "invalid" &&
            state.planTaskCompletion.sourceAttemptId === state.activeAttempt.id
          ) {
            this.info(
              `Attempt ${state.activeAttempt.id} has rejected completion evidence; use banzai retry to repair it.`
            );
            return state;
          }
          this.info(`Reconciling recorded attempt ${state.activeAttempt.id}`);
          return await this.reconcileAttempt(state, config);
        }

        if (
          [
            "created",
            "selecting",
            "planning",
            "plan_approved",
            "implementing",
            "verifying",
            "reviewing",
            "fixing"
          ].includes(state.status)
        ) {
          await this.assertProjectGuidance();
        }
        switch (state.status) {
          case "created":
            transitionState(state, "selecting");
            await this.store.writeState(state);
            return await this.executeSelection(state, config);
          case "selecting":
            return await this.executeSelection(state, config);
          case "planning":
            return await this.executePlan(state, config);
          case "plan_approved":
            return await this.executeImplementation(state, config);
          case "implementing":
            return await this.executeImplementation(state, config);
          case "verifying":
            return await this.executeVerification(state, config);
          case "reviewing":
            return await this.executeReview(state, config);
          case "fixing":
            return await this.executeFix(state, config);
          case "needs_adr_approval":
          case "needs_plan_approval":
          case "needs_triage":
          case "blocked":
            return state;
          case "needs_human_decision":
            return state.pendingHumanDecision?.kind ===
              "configuration_prerequisite"
              ? await this.resumeConfigurationPrerequisite(state, true)
              : state;
          default:
            return state;
        }
      } finally {
        await lock.release();
      }
    } catch (error) {
      if (error instanceof TerminalRunStateError) return error.state;
      throw error;
    }
  }

  async retry(): Promise<RunState> {
    try {
      let expectedAttemptId: string | null;
      let expectedRunId: string;
      let retryCheckpoint: RunState["blockedFrom"];
      let planningCheckpointRejection: string | null = null;
      const eligibilityLock = await this.acquireWorkflowLock();
      try {
        const state = await this.store.requireActiveState();
        expectedRunId = state.runId;
        const retry = await this.retryEligibility(state);
        if (!retry.eligible) {
          throw new BanzaiError("RETRY_NOT_ALLOWED", retry.reason);
        }
        await this.assertProjectGuidance();
        if (state.activeAttempt?.kind === "plan") {
          const source = await this.store.readRunAttempt(
            state.runId,
            state.activeAttempt
          );
          if (
            source.failureCode !== "PLAN_TASK_COMPLETION_INVALID" &&
            (await this.store.readTerminalCheckpointIfExists(
              state.runId,
              state.activeAttempt
            )) !== null
          ) {
            this.info(
              "Reconciling the saved planning terminal result before retry"
            );
            const reconciled = await this.reconcileAttempt(
              state,
              await loadConfig(this.repoRoot)
            );
            if (
              reconciled.status !== "blocked" ||
              !reconciled.blockReason?.startsWith(
                "[INVALID_TERMINAL_CHECKPOINT]"
              ) ||
              !(await this.retryEligibility(reconciled)).eligible
            ) {
              return reconciled;
            }
            // Rejected proof cannot become completion or reusable session state.
            // An explicitly retryable failed planner may still start new work.
            planningCheckpointRejection = reconciled.blockReason;
          }
        }
        expectedAttemptId = retry.attemptId;
        retryCheckpoint =
          state.activeAttempt === null ? state.blockedFrom : null;
        this.info(
          retryCheckpoint === "created"
            ? "Retry requested for startup checks"
            : retryCheckpoint === "reviewing"
              ? "Retry requested for review checks"
              : retryCheckpoint === "verifying"
                ? state.planTaskCompletion?.status === "invalid"
                  ? `Retry requested to repair completion evidence rejected for ${expectedAttemptId}`
                  : `Retry requested for verification attempt ${expectedAttemptId}`
                : `Retry requested for failed attempt ${expectedAttemptId}`
        );
      } finally {
        await eligibilityLock.release();
      }

      let config: OrchestratorConfig;
      try {
        config = await loadConfig(this.repoRoot);
        await this.activity(
          "Retry preflight",
          "rechecking tools, contracts, verification commands, and subscription authentication",
          async () => {
            await this.preflight(config);
          }
        );
      } catch (error) {
        if (
          error instanceof TerminalRunStateError ||
          error instanceof ProjectSetupRequiredError ||
          error instanceof InstructionResourceMismatchError
        )
          throw error;
        if (retryCheckpoint === null) {
          throw error;
        }
        const failureLock = await this.acquireWorkflowLock();
        try {
          const state = await this.store.readState(expectedRunId);
          if (
            (await this.store.readActiveRunId()) !== expectedRunId &&
            !TERMINAL_STATUSES.has(state.status)
          ) {
            throw new BanzaiError(
              "RETRY_STATE_CHANGED",
              "The active run changed during retry."
            );
          }
          if (state.status === "cancelled") {
            return state;
          }
          const retry = await this.retryEligibility(state);
          if (
            !retry.eligible ||
            retry.attemptId !== expectedAttemptId ||
            state.blockedFrom !== retryCheckpoint
          ) {
            throw new BanzaiError(
              "RETRY_STATE_CHANGED",
              "The retry checkpoint changed while preflight was running."
            );
          }
          if (retryCheckpoint === "created") {
            return await this.recordStartFailure(state, error);
          }
          if (retryCheckpoint === "reviewing") {
            return await this.recordReviewCheckFailure(state, error);
          }
          if (
            retryCheckpoint === "verifying" &&
            state.planTaskCompletion?.status === "invalid"
          ) {
            // A completion-repair retry has no verification attempt identity to
            // record a check failure against; the run stays blocked as it was.
            throw error;
          }
          if (retryCheckpoint === "verifying" && expectedAttemptId !== null) {
            return await this.recordVerificationRetryCheckFailure(
              state,
              expectedAttemptId,
              error
            );
          }
          throw error;
        } finally {
          await failureLock.release();
        }
      }

      const executionLock = await this.acquireWorkflowLock();
      try {
        const state = await this.store.readState(expectedRunId);
        if (
          (await this.store.readActiveRunId()) !== expectedRunId &&
          !TERMINAL_STATUSES.has(state.status)
        ) {
          throw new BanzaiError(
            "RETRY_STATE_CHANGED",
            "The active run changed during retry."
          );
        }
        if (state.status === "cancelled") {
          return state;
        }
        const retry = await this.retryEligibility(state);
        if (!retry.eligible || retry.attemptId !== expectedAttemptId) {
          throw new BanzaiError(
            "RETRY_STATE_CHANGED",
            retry.eligible
              ? "The failed attempt changed while retry preflight was running."
              : retry.reason
          );
        }
        await this.assertProjectGuidance();
        const pendingTransition: (() => Promise<unknown>)[] = [];
        const commitTransition = async () => {
          for (const publish of pendingTransition) await publish();
          pendingTransition.length = 0;
        };
        if (retryCheckpoint === "created") {
          try {
            state.baseCommit = await this.activity(
              "Repository check",
              "current commit and carried-in changes",
              async () => {
                state.baseline = await repositoryBaseline(this.repoRoot);
                return await currentCommit(this.repoRoot);
              }
            );
            this.reportBaseline(state);
          } catch (error) {
            if (
              error instanceof TerminalRunStateError ||
              error instanceof ProjectSetupRequiredError ||
              error instanceof InstructionResourceMismatchError
            )
              throw error;
            return await this.recordStartFailure(state, error);
          }
          transitionState(state, "created");
          pendingTransition.push(
            async () =>
              await this.store.appendEvent(
                state.runId,
                "run.start_retry_requested",
                {
                  baseCommit: state.baseCommit
                }
              )
          );
          transitionState(state, "selecting");
          pendingTransition.push(async () => {
            await this.store.writeState(state);
          });
          this.info(
            `Startup checks passed; selecting workflow for ${state.runId}`
          );
          return await this.executeSelection(state, config, commitTransition);
        }
        if (retryCheckpoint === "reviewing") {
          transitionState(state, "reviewing");
          pendingTransition.push(async () => {
            await this.store.writeState(state);
          });
          pendingTransition.push(
            async () =>
              await this.store.appendEvent(
                state.runId,
                "review.checks_retry_requested",
                {}
              )
          );
          this.info("Retrying review checks before starting a fresh review");
          return await this.executeReview(state, config, commitTransition);
        }
        const rejectedCompletion =
          state.planTaskCompletion?.status === "invalid"
            ? state.planTaskCompletion
            : null;
        if (
          rejectedCompletion !== null &&
          (retryCheckpoint === "verifying" ||
            retryCheckpoint === "implementing" ||
            retryCheckpoint === "plan_approved" ||
            state.activeAttempt?.kind === "implementation") &&
          PLAN_BUNDLE_COMPLETION_VIOLATIONS.has(rejectedCompletion.violation)
        ) {
          return await this.retryIntoPlanning(
            state,
            config,
            rejectedCompletion.sourceAttemptId
          );
        }
        if (retryCheckpoint === "verifying" && rejectedCompletion !== null) {
          await this.validateBaseCommit(state);
          await this.validateApproval(state);
          state.activeAttempt = null;
          state.activeProcess = null;
          transitionState(state, "implementing");
          pendingTransition.push(async () => {
            await this.store.writeState(state);
          });
          pendingTransition.push(
            async () =>
              await this.store.appendEvent(
                state.runId,
                "attempt.retry_requested",
                {
                  failedAttemptId: rejectedCompletion.sourceAttemptId,
                  kind: "implementation",
                  retryFrom: "implementing"
                }
              )
          );
          pendingTransition.push(
            async () =>
              await this.store.appendEvent(
                state.runId,
                "plan_task_completion.retry_requested",
                { failedAttemptId: rejectedCompletion.sourceAttemptId }
              )
          );
          this.info(
            "Repairing rejected completion evidence with a fresh implementation attempt"
          );
          return await this.executeImplementation(
            state,
            config,
            null,
            commitTransition
          );
        }
        if (retryCheckpoint === "verifying" && expectedAttemptId !== null) {
          await this.validateBaseCommit(state);
          transitionState(state, "verifying");
          state.activeProcess = null;
          pendingTransition.push(async () => {
            await this.store.writeState(state);
          });
          pendingTransition.push(
            async () =>
              await this.store.appendEvent(
                state.runId,
                "verification.retry_requested",
                { attemptId: expectedAttemptId }
              )
          );
          this.info(
            `Retrying verification attempt ${expectedAttemptId} with a new physical identity`
          );
          return await this.executeVerification(
            state,
            config,
            undefined,
            expectedAttemptId,
            commitTransition
          );
        }
        if (retryCheckpoint === "fixing") {
          transitionState(state, "fixing");
          pendingTransition.push(async () => {
            await this.store.writeState(state);
          });
          pendingTransition.push(
            async () =>
              await this.store.appendEvent(
                state.runId,
                "fix.checks_retry_requested",
                {}
              )
          );
          this.info("Retrying fix checks before starting a fresh fix attempt");
          return await this.executeFix(state, config, null, commitTransition);
        }
        if (
          retryCheckpoint === "implementing" ||
          retryCheckpoint === "plan_approved"
        ) {
          transitionState(state, retryCheckpoint);
          pendingTransition.push(async () => {
            await this.store.writeState(state);
          });
          pendingTransition.push(
            async () =>
              await this.store.appendEvent(
                state.runId,
                "implementation.checks_retry_requested",
                {}
              )
          );
          this.info(
            "Retrying implementation checks before starting a fresh attempt"
          );
          return await this.executeImplementation(
            state,
            config,
            null,
            commitTransition
          );
        }
        const failedAttempt = state.activeAttempt;
        const retryFrom = state.blockedFrom;
        if (failedAttempt === null || retryFrom === null) {
          throw new BanzaiError(
            "INVALID_RETRY_STATE",
            "Retry state changed while the command was being validated."
          );
        }

        await this.validateBaseCommit(state);

        if (failedAttempt.kind === "review") {
          state.reviewIteration = state.latestReview?.iteration ?? 0;
        }
        const planningSource =
          failedAttempt.kind === "plan"
            ? await this.store.readRunAttempt(state.runId, failedAttempt)
            : null;
        // Keep the failed planner reference until beginAttempt replaces it. A
        // crash in the transition gap must not silently lose retry context.
        if (planningSource === null) state.activeAttempt = null;
        state.activeProcess = null;
        transitionState(state, retryFrom);
        pendingTransition.push(async () => {
          await this.store.writeState(state);
        });
        pendingTransition.push(
          async () =>
            await this.store.appendEvent(
              state.runId,
              "attempt.retry_requested",
              {
                failedAttemptId: failedAttempt.id,
                kind: failedAttempt.kind,
                retryFrom
              }
            )
        );
        this.info(`Retrying ${failedAttempt.kind} with a new attempt`);

        if (retryFrom === "selecting") {
          return await this.executeSelection(state, config, commitTransition);
        }
        if (retryFrom === "planning") {
          return await this.executePlan(
            state,
            config,
            planningSource,
            planningCheckpointRejection,
            commitTransition
          );
        }
        if (retryFrom === "reviewing") {
          return await this.executeReview(state, config, commitTransition);
        }
        if (retryFrom === "implementing") {
          await this.validateApproval(state);
          pendingTransition.push(
            async () =>
              await this.store.appendEvent(
                state.runId,
                "plan_task_completion.retry_requested",
                { failedAttemptId: failedAttempt.id }
              )
          );
          return await this.executeImplementation(
            state,
            config,
            null,
            commitTransition
          );
        }
        if (retryFrom === "fixing") {
          // Reachable only through the completion-evidence repair eligibility: a
          // fix whose refreshed ledger was rejected reruns with the same triage
          // scope and the persisted rejection diagnostic.
          await this.validateApproval(state);
          pendingTransition.push(
            async () =>
              await this.store.appendEvent(
                state.runId,
                "plan_task_completion.retry_requested",
                { failedAttemptId: failedAttempt.id }
              )
          );
          return await this.executeFix(state, config, null, commitTransition);
        }
        throw new BanzaiError(
          "INVALID_RETRY_STATE",
          `Retry cannot continue from ${retryFrom}.`
        );
      } finally {
        await executionLock.release();
      }
    } catch (error) {
      if (error instanceof TerminalRunStateError) return error.state;
      throw error;
    }
  }

  /**
   * Whether the approved planning artifacts can be restored from the approval
   * snapshot: an approval exists, the snapshot verifies byte-for-byte against
   * its recorded digest, and the on-disk bundle currently diverges from it.
   */
  async restoreEligibility(): Promise<{ eligible: boolean; reason: string }> {
    const state = await this.store.requireActiveState();
    return await this.restoreEligibilityFor(state);
  }

  private async restoreEligibilityFor(
    state: RunState
  ): Promise<{ eligible: boolean; reason: string }> {
    const approval = state.planApproval;
    if (approval === null) {
      return {
        eligible: false,
        reason: "The run has no recorded plan approval."
      };
    }
    const snapshot = await this.store.readApprovalSnapshot(state.runId);
    if (snapshot === null) {
      return {
        eligible: false,
        reason:
          "This run predates approval snapshots; restore the approved bytes manually or cancel the run."
      };
    }
    const verified =
      snapshot.digest === approval.digest &&
      digestArtifactEntries(
        snapshot.entries.map((entry) => ({
          path: entry.path,
          sha256: entry.sha256
        }))
      ) === approval.digest &&
      snapshot.entries.every(
        (entry) => hashArtifactBytes(entry.contents) === entry.sha256
      ) &&
      JSON.stringify(snapshot.entries.map((entry) => entry.path).sort()) ===
        JSON.stringify([...approval.paths].sort());
    if (!verified) {
      return {
        eligible: false,
        reason:
          "The stored approval snapshot does not verify against the recorded approval digest."
      };
    }
    const current = await digestArtifactBundle(
      this.repoRoot,
      approval.paths
    ).catch(() => null);
    if (current !== null && current.digest === approval.digest) {
      return {
        eligible: false,
        reason:
          "The approved planning artifacts already match the recorded approval."
      };
    }
    return {
      eligible: true,
      reason:
        "The approved planning artifacts diverged from the recorded approval and can be restored from the snapshot."
    };
  }

  /**
   * Rewrites the approved artifact paths with the exact bytes the human
   * approved, verified against the recorded approval digest. An explicit
   * operator action for an externally mutated bundle — the runner never
   * chooses the content, it only reinstates what the human approved.
   */
  async restoreApproval(): Promise<string[]> {
    const lock = await this.acquireWorkflowLock();
    try {
      const state = await this.store.requireActiveState();
      const eligibility = await this.restoreEligibilityFor(state);
      if (!eligibility.eligible) {
        throw new BanzaiError("RESTORE_NOT_ALLOWED", eligibility.reason);
      }
      const snapshot = await this.store.readApprovalSnapshot(state.runId);
      if (snapshot === null) {
        throw new BanzaiError(
          "RESTORE_NOT_ALLOWED",
          "The approval snapshot disappeared while restoring."
        );
      }
      const restored: string[] = [];
      for (const entry of snapshot.entries) {
        const absolute = path.resolve(this.repoRoot, entry.path);
        await mkdir(path.dirname(absolute), { recursive: true });
        await writeFile(absolute, entry.contents);
        restored.push(entry.path);
      }
      await this.store.appendEvent(state.runId, "approval.restored", {
        digest: state.planApproval?.digest ?? null,
        paths: restored
      });
      this.info(
        `Restored ${restored.length} approved planning artifact${restored.length === 1 ? "" : "s"} from the approval snapshot`
      );
      return restored;
    } finally {
      await lock.release();
    }
  }

  /**
   * Reruns planning after a plan-bundle-level completion rejection: the
   * recorded approval is voided so the planner may correct the bundle, the
   * stale completion checkpoint is cleared so the next implementation starts
   * fresh instead of receiving a repair context for a plan that no longer
   * exists, and a new plan-approval gate follows. Evidence repair can never
   * fix a defect that lives in the immutable approved plan itself.
   */
  private async retryIntoPlanning(
    state: RunState,
    config: OrchestratorConfig,
    failedAttemptId: string
  ): Promise<RunState> {
    await this.validateBaseCommit(state);
    const violation =
      state.planTaskCompletion?.status === "invalid"
        ? state.planTaskCompletion.violation
        : null;
    state.activeAttempt = null;
    state.activeProcess = null;
    state.planApproval = null;
    state.planTaskCompletion = null;
    transitionState(state, "planning");
    const pendingTransition: (() => Promise<unknown>)[] = [];
    const commitTransition = async () => {
      for (const publish of pendingTransition) await publish();
      pendingTransition.length = 0;
    };
    pendingTransition.push(async () => {
      await this.store.writeState(state);
    });
    pendingTransition.push(
      async () =>
        await this.store.appendEvent(state.runId, "attempt.retry_requested", {
          failedAttemptId,
          kind: "implementation",
          retryFrom: "planning"
        })
    );
    pendingTransition.push(
      async () =>
        await this.store.appendEvent(state.runId, "plan_approval.voided", {
          violation
        })
    );
    this.info("Rerunning planning to correct the invalid approved plan bundle");
    return await this.executePlan(state, config, null, null, commitTransition);
  }

  async recover(input: RecoverInput, autoResume = true): Promise<RunState> {
    try {
      const lock = await this.acquireWorkflowLock();
      try {
        const state = await this.store.requireActiveState();
        const eligibility = await this.recoveryEligibility(state);
        if (!eligibility.eligible) {
          throw new BanzaiError("RECOVERY_NOT_ALLOWED", eligibility.reason);
        }
        if (
          input.attemptId !== eligibility.attemptId ||
          input.recoveryIdentity !== eligibility.recoveryIdentity ||
          (input as { unknownSideEffectsAccepted: unknown })
            .unknownSideEffectsAccepted !== true
        ) {
          throw new BanzaiError(
            "RECOVERY_STALE",
            "Recovery authorization does not match the exact current attempt and workspace identity."
          );
        }
        if (
          input.decidedBy.length === 0 ||
          input.decidedBy.length > 200 ||
          /[\0\r\n]/u.test(input.decidedBy)
        ) {
          throw new BanzaiError(
            "INVALID_RECOVERY_DECISION_MAKER",
            "Recovery decision maker must be a bounded single-line value."
          );
        }
        if (
          eligibility.phase === null ||
          eligibility.sourceKind === null ||
          eligibility.workspace === null ||
          eligibility.baseCommit === null ||
          eligibility.configurationDigest === null
        ) {
          throw new BanzaiError(
            "RECOVERY_STATE_CHANGED",
            "Recovery eligibility changed before authorization persistence."
          );
        }
        await this.assertProjectGuidance();
        const attempt: RecoveryAuthorization["attempt"] = {
          id: eligibility.attemptId,
          kind: eligibility.phase,
          mutable: true
        };
        let authorization: RecoveryAuthorization;
        if (
          state.recovery?.sourceAttemptId === attempt.id &&
          state.recovery.recoveryAttemptId === null
        ) {
          authorization = await this.store.readRecoveryAuthorization(
            state.runId,
            state.recovery.authorizationId
          );
        } else {
          const authorizationId = `recovery-${eligibility.recoveryIdentity.slice(0, 24)}`;
          const proposed: RecoveryAuthorization = {
            schema: RECOVERY_AUTHORIZATION_SCHEMA,
            schemaVersion: RECOVERY_AUTHORIZATION_SCHEMA_VERSION,
            authorizationId,
            runId: state.runId,
            attempt,
            phase: attempt.kind,
            recoveryIdentity: eligibility.recoveryIdentity,
            workspaceDigest: eligibility.workspace.digest,
            baseCommit: eligibility.baseCommit,
            approvalDigest: eligibility.approvalDigest,
            workflowDigest: eligibility.workflowDigest,
            scopeDigest: eligibility.scopeDigest,
            configurationDigest: eligibility.configurationDigest,
            decidedBy: input.decidedBy,
            decidedAt: now(),
            unknownSideEffectsAccepted: true
          };
          const existing = await this.store.readRecoveryAuthorizationIfExists(
            state.runId,
            authorizationId
          );
          authorization = existing ?? proposed;
          if (
            authorization.runId !== proposed.runId ||
            authorization.attempt.id !== proposed.attempt.id ||
            authorization.phase !== proposed.phase ||
            authorization.recoveryIdentity !== proposed.recoveryIdentity ||
            authorization.workspaceDigest !== proposed.workspaceDigest ||
            authorization.baseCommit !== proposed.baseCommit ||
            authorization.approvalDigest !== proposed.approvalDigest ||
            authorization.workflowDigest !== proposed.workflowDigest ||
            authorization.scopeDigest !== proposed.scopeDigest ||
            authorization.configurationDigest !== proposed.configurationDigest
          ) {
            throw new BanzaiError(
              "RECOVERY_AUTHORIZATION_CONFLICT",
              "Persisted recovery authorization conflicts with the current recovery identity."
            );
          }
          if (existing === null) {
            await this.store.writeRecoveryAuthorization(
              state.runId,
              authorization
            );
          }
          state.recovery = {
            authorizationId: authorization.authorizationId,
            sourceAttemptId: attempt.id,
            recoveryAttemptId: null,
            stage: "authorized"
          };
          await this.store.writeState(state);
          await this.store.appendEvent(state.runId, "recovery.authorized", {
            authorizationId: authorization.authorizationId,
            attemptId: attempt.id,
            phase: attempt.kind,
            sourceKind: eligibility.sourceKind,
            decidedBy: input.decidedBy
          });
        }
        if (!autoResume) {
          return state;
        }
        const config = await loadConfig(this.repoRoot);
        assertContractParity();
        return await this.executeAuthorizedRecovery(
          state,
          config,
          authorization
        );
      } finally {
        await lock.release();
      }
    } catch (error) {
      if (error instanceof TerminalRunStateError) return error.state;
      throw error;
    }
  }

  async approvePlan(approvedBy: string, autoResume = true): Promise<RunState> {
    try {
      const lock = await this.acquireWorkflowLock();
      try {
        const state = await this.store.requireActiveState();
        requireState(state, ["needs_plan_approval"], "Plan approval");
        // Approval binds whatever bytes exist right now, so the canonical task
        // grammar is checked against those exact bytes: an on-disk edit between
        // the gate and the approval cannot smuggle in a malformed heading.
        await this.approvedTaskIds(state);
        const approvalConfig = await loadConfig(this.repoRoot);
        if (approvalConfig.schemaVersion === 3)
          validatePlanVerificationObligations(
            await readFile(
              path.join(this.repoRoot, this.completionPlanPath(state)),
              "utf8"
            ),
            approvalConfig.verification
          );
        const bundle = await digestArtifactBundle(
          this.repoRoot,
          artifactPaths(state)
        );
        // Snapshot the exact approved bytes beside the run evidence: the bundle
        // paths are typically uncommitted, so without this an external mutation
        // would leave no recoverable approved form, only a digest.
        const snapshotEntries: {
          path: string;
          sha256: string;
          contents: Buffer;
        }[] = [];
        for (const entry of bundle.entries) {
          const contents = await readFile(
            path.resolve(this.repoRoot, entry.path)
          );
          if (hashArtifactBytes(contents) !== entry.sha256) {
            throw new BanzaiError(
              "APPROVAL_INVALIDATED",
              `Approved artifact ${entry.path} changed while the approval was being recorded; review and approve again.`
            );
          }
          snapshotEntries.push({
            path: entry.path,
            sha256: entry.sha256,
            contents
          });
        }
        state.planApproval = {
          kind: "plan",
          digest: bundle.digest,
          approvedAt: now(),
          approvedBy,
          paths: bundle.paths
        };
        await this.store.writeApprovalSnapshot(
          state.runId,
          bundle.digest,
          snapshotEntries
        );
        transitionState(state, "plan_approved");
        await this.store.writeState(state);
        const timingEvent = await this.store.appendEvent(
          state.runId,
          "approval.plan",
          {
            approvedBy,
            digest: bundle.digest,
            paths: bundle.paths
          }
        );
        await this.observeHumanTime(
          state,
          "decision_recorded",
          "approval.plan",
          timingEvent.at
        );
        if (!autoResume) {
          return state;
        }
        const config = await loadConfig(this.repoRoot);
        return await this.executeImplementation(state, config);
      } finally {
        await lock.release();
      }
    } catch (error) {
      if (error instanceof TerminalRunStateError) return error.state;
      throw error;
    }
  }

  async decideAdr(input: {
    id: string;
    decision: AdrDecision["decision"];
    note: string | null;
    decidedBy: string;
    autoResume: boolean;
  }): Promise<RunState> {
    try {
      const lock = await this.acquireWorkflowLock();
      try {
        const state = await this.store.requireActiveState();
        requireState(state, ["needs_adr_approval"], "ADR decision");
        if (input.id.trim().length === 0) {
          throw new BanzaiError("INVALID_ADR", "ADR id cannot be empty.");
        }
        state.adrDecisions = state.adrDecisions.filter(
          (decision) => decision.id !== input.id
        );
        state.adrDecisions.push({
          id: input.id,
          decision: input.decision,
          note: input.note,
          decidedAt: now(),
          decidedBy: input.decidedBy
        });
        transitionState(state, "planning");
        await this.store.writeState(state);
        const timingEvent = await this.store.appendEvent(
          state.runId,
          "approval.adr",
          {
            id: input.id,
            decision: input.decision,
            decidedBy: input.decidedBy
          }
        );
        await this.observeHumanTime(
          state,
          "decision_recorded",
          "approval.adr",
          timingEvent.at
        );
        if (!input.autoResume) {
          return state;
        }
        return await this.executePlan(state, await loadConfig(this.repoRoot));
      } finally {
        await lock.release();
      }
    } catch (error) {
      if (error instanceof TerminalRunStateError) return error.state;
      throw error;
    }
  }

  async answerHumanDecision(
    input: HumanDecisionInput,
    autoResume = true
  ): Promise<RunState> {
    try {
      const lock = await this.acquireWorkflowLock();
      try {
        const state = await this.store.requireActiveState();
        requireState(state, ["needs_human_decision"], "Human decision");
        const pending = state.pendingHumanDecision ?? null;
        if (pending === null) {
          throw new BanzaiError(
            "INVALID_STATE",
            "The run has no persisted human decision request."
          );
        }
        if (pending.kind !== "escalation") {
          throw new BanzaiError(
            "INVALID_DECISION",
            "Decision consultation requires a keyed consultation answer."
          );
        }
        if (
          input.answers.length !== Math.max(1, pending.questions.length) ||
          input.answers.some((answer) => answer.trim().length === 0)
        ) {
          throw new BanzaiError(
            "INVALID_DECISION",
            "Every human decision question requires a non-empty answer."
          );
        }
        const decision: HumanDecisionRecord = {
          ...pending,
          answers: [...input.answers],
          decidedAt: now(),
          decidedBy: input.decidedBy
        };
        state.humanDecisions = [...(state.humanDecisions ?? []), decision];
        state.pendingHumanDecision = null;
        state.planApproval = null;
        const reselectLiteWorkflow =
          pending.phase === "implementation" &&
          state.workflowSelection?.workflow !== undefined &&
          state.workflowSelection.workflow !== "strict";
        if (reselectLiteWorkflow) {
          state.workflowSelection = null;
          state.sessions.implementer = null;
          transitionState(state, "selecting");
        } else {
          transitionState(state, "planning");
        }
        await this.store.writeState(state);
        const timingEvent = await this.store.appendEvent(
          state.runId,
          "decision.human",
          {
            phase: decision.phase,
            gate: decision.gate,
            questions: decision.questions,
            decidedBy: decision.decidedBy
          }
        );
        await this.observeHumanTime(
          state,
          "decision_recorded",
          "decision.human",
          timingEvent.at
        );
        if (!autoResume) {
          return state;
        }
        const config = await loadConfig(this.repoRoot);
        return reselectLiteWorkflow
          ? await this.executeSelection(state, config)
          : await this.executePlan(state, config);
      } finally {
        await lock.release();
      }
    } catch (error) {
      if (error instanceof TerminalRunStateError) return error.state;
      throw error;
    }
  }

  private async validateConfigurationContinuation(
    state: RunState,
    continuation: ConfigurationContinuation
  ): Promise<void> {
    if (
      !hasConfigurationSetup(state) ||
      state.configurationSetup === undefined ||
      state.artifactBinding === undefined ||
      state.activeAttempt !== null ||
      state.activeProcess !== null ||
      state.baseCommit !== continuation.baseCommit ||
      state.artifactBinding.binding.workId !== continuation.workId ||
      state.artifactBinding.sha256 !== continuation.workBindingSha256 ||
      (state.planApproval?.digest ?? null) !== continuation.approvalDigest ||
      (state.workflowSelection?.digest ?? null) !==
        continuation.workflowSelectionDigest
    ) {
      throw new BanzaiError(
        "CONFIGURATION_CONTINUATION_INVALID",
        "The original completed configuration checkpoint is no longer eligible. Use the existing status/recovery action."
      );
    }
    await inspectBoundWork(this.repoRoot, state.artifactBinding);
    const attempt = await this.store.readRunAttemptIfExists(state.runId, {
      id: continuation.attemptId,
      kind: continuation.attemptKind,
      mutable: true
    });
    if (
      attempt?.status !== "completed" ||
      !state.metrics.completedAttemptIds.includes(continuation.attemptId)
    )
      throw new BanzaiError(
        "CONFIGURATION_CONTINUATION_INVALID",
        "Configuration cannot complete or replay an unfinished model attempt."
      );
    if ((state.workflowSelection?.workflow ?? "strict") === "strict") {
      await this.validateApproval(state);
      await this.revalidateTaskCompletion(
        state,
        continuation.attemptKind === "fix"
      );
    } else this.validateWorkflowSelection(state);
  }

  private configurationGaps(
    config: OrchestratorConfig,
    inspection: VerificationProjectInspection
  ) {
    const readiness = assessVerificationReadiness(config, inspection);
    const missingScripts = config.verification.profiles.flatMap((profile) =>
      profile.commands
        .filter(
          (command) =>
            inspectCommandPrerequisite(command, inspection).state ===
            "missing_script"
        )
        .map(() => ({ projectType: "node" as const, profileId: profile.id }))
    );
    const gaps = new Map<
      VerificationProjectType,
      "missing_profile" | "missing_script"
    >(
      readiness.uncoveredTypes.map((projectType) => [
        projectType,
        "missing_profile" as const
      ])
    );
    for (const item of missingScripts)
      if (!gaps.has(item.projectType))
        gaps.set(item.projectType, "missing_script");
    return {
      readiness,
      missingScripts,
      gaps: [...gaps].sort(([a], [b]) => a.localeCompare(b))
    };
  }

  private configurationSkipCurrent(
    state: RunState,
    config: OrchestratorConfig,
    inspection: VerificationProjectInspection
  ): boolean {
    const skip = state.configurationSetup?.skip;
    return (
      skip?.runId === state.runId &&
      skip.configurationDigest === configurationDigest(config.verification) &&
      JSON.stringify(skip.projectTypes) ===
        JSON.stringify(inspection.projectTypes)
    );
  }

  private async assertConfigurationSkipAuthority(
    state: RunState,
    config: OrchestratorConfig
  ): Promise<void> {
    const substantive = config.verification.profiles
      .flatMap((profile) => profile.commands)
      .filter((command) => !isRepositoryHygieneCommand(command));
    if (
      config.verification.policy &&
      substantive.some((command) => command.evidence !== "equivalent_evidence")
    ) {
      throw new BanzaiError(
        "CONFIGURATION_SKIP_OBLIGATION",
        "Skip cannot waive mandatory project verification. Restore the prerequisite or resolve the project policy through its existing approval route."
      );
    }
    if (
      (state.workflowSelection?.workflow ?? "strict") === "strict" &&
      state.planArtifacts?.plan
    ) {
      const plan = await readFile(
        path.join(this.repoRoot, state.planArtifacts.plan),
        "utf8"
      );
      if (plan.includes("banzai-verification-obligations/v1")) {
        const inventory =
          config.schemaVersion === 3
            ? parseVerificationObligations(
                plan,
                parseVerificationConfiguration(config.verification)
              )
            : null;
        if (
          !inventory ||
          inventory.checks.some((check) =>
            substantive.some((command) => command.id === check.id)
          )
        ) {
          throw new BanzaiError(
            "CONFIGURATION_SKIP_OBLIGATION",
            "Skip cannot discharge the approved plan's verification obligations. Repair prerequisites or use the existing plan reapproval/escalation route."
          );
        }
      }
    }
  }

  private async inspectConfigurationCheckpoint(
    state: RunState,
    config: OrchestratorConfig,
    source: AttemptReference & { kind: "implementation" | "fix" },
    records: VerificationAttemptRecord[]
  ): Promise<boolean> {
    if (!hasConfigurationSetup(state)) return false;
    const setup = state.configurationSetup;
    const bound = state.artifactBinding;
    if (
      !setup ||
      !bound ||
      config.schemaVersion !== setup.configSchemaVersion ||
      usesVerificationPolicy(state) !==
        Boolean(config.schemaVersion === 3 && config.verification.policy)
    )
      throw new BanzaiError(
        "CONFIGURATION_CONTINUATION_INVALID",
        "The run's original verification mode and config schema must remain unchanged."
      );
    const inspection = await inspectVerificationProject(this.repoRoot);
    const { readiness, gaps } = this.configurationGaps(config, inspection);
    const digest = configurationDigest(config.verification);
    if (
      setup.continuation?.attemptId !== source.id ||
      ((setup.configurationDigest !== digest ||
        JSON.stringify(setup.projectTypes) !==
          JSON.stringify(inspection.projectTypes)) &&
        records.some(
          (record) =>
            record.round.id === setup.continuation?.verificationRound.id
        ))
    ) {
      setup.continuation = {
        attemptId: source.id,
        attemptKind: source.kind,
        verificationRound: {
          id: `verification-round-${source.id}-${randomUUID()}`,
          ordinal: new Set(records.map((record) => record.round.id)).size + 1
        },
        baseCommit: state.baseCommit,
        workId: bound.binding.workId,
        workBindingSha256: bound.sha256,
        approvalDigest: state.planApproval?.digest ?? null,
        workflowSelectionDigest: state.workflowSelection?.digest ?? null
      };
    }
    await this.validateConfigurationContinuation(state, setup.continuation);
    setup.configurationDigest = digest;
    setup.projectTypes = inspection.projectTypes;
    setup.uncoveredTypes =
      readiness.uncoveredTypes as typeof setup.uncoveredTypes;
    if (this.configurationSkipCurrent(state, config, inspection)) {
      await this.assertConfigurationSkipAuthority(state, config);
      setup.coverage = "skipped";
      setup.uncoveredTypes = [...inspection.projectTypes];
      delete state.verificationEvidence;
      return false;
    }
    setup.skip = null;
    setup.coverage = readiness.bootstrapEffective
      ? "bootstrap_deferred"
      : "configured";
    if (gaps.length === 0) return false;
    const first = gaps[0];
    if (!first) return false;
    const [projectType, reason] = first;
    const current = await readVerificationConfig(this.repoRoot);
    const history = await readVerificationConfigTransactions(
      this.repoRoot,
      state.runId
    );
    const proposal = verificationProposal(
      config,
      inspection,
      projectType as Exclude<VerificationProjectType, "repository">,
      verificationCommandIds(config, history)
    );
    const previous =
      state.pendingHumanDecision?.kind === "configuration_prerequisite"
        ? state.pendingHumanDecision
        : null;
    state.pendingHumanDecision = parseConfigurationPrerequisite(
      {
        schema: CONFIGURATION_PREREQUISITE_SCHEMA,
        schemaVersion: 1,
        kind: "configuration_prerequisite",
        runId: state.runId,
        decisionId: previous?.decisionId ?? randomUUID(),
        proposalId: randomUUID(),
        requestedAt: now(),
        reason,
        proposal,
        options: CONFIGURATION_ACTIONS,
        configSha256: current.sha256,
        sourceSha256: inspection.sourceSha256,
        continuation: setup.continuation
      },
      setup.configSchemaVersion
    );
    if (state.status !== "needs_human_decision")
      transitionState(state, "needs_human_decision");
    await this.store.writeState(state);
    this.info(
      "Configuration decision pending. Accept, Edit, Skip or Cancel; alternatively fix prerequisites, then run banzai resume."
    );
    return true;
  }

  private configurationContext(
    state: RunState,
    pending: ConfigurationPrerequisiteRequest
  ): VerificationConfigContext {
    return {
      runId: state.runId,
      origin: "configuration_decision",
      decisionId: pending.decisionId,
      proposalId: pending.proposalId,
      continuation: pending.continuation,
      revalidate: async () => {
        const current = await this.store.readState(state.runId);
        if (
          current.pendingHumanDecision?.kind !== "configuration_prerequisite" ||
          current.pendingHumanDecision.proposalId !== pending.proposalId
        )
          throw new BanzaiError(
            "CONFIGURATION_PROPOSAL_STALE",
            "The pending proposal changed. Read and answer its current identity."
          );
        await this.validateConfigurationContinuation(
          current,
          pending.continuation
        );
      }
    };
  }

  private async resolveConfigurationPrerequisite(
    state: RunState,
    pending: ConfigurationPrerequisiteRequest,
    kind: ConfigurationResolution["kind"],
    operation: VerificationConfigTransaction | null,
    human?: {
      action: ConfigurationAction;
      decidedBy: string;
      decidedAt: string;
    }
  ): Promise<void> {
    const setup = state.configurationSetup;
    if (!setup)
      throw new BanzaiError(
        "CONFIGURATION_CONTINUATION_INVALID",
        "Configuration state is unavailable."
      );
    const current = await readVerificationConfig(this.repoRoot);
    const inspection = await inspectVerificationProject(this.repoRoot);
    if (human)
      state.humanDecisions = [
        ...(state.humanDecisions ?? []),
        { ...pending, ...human }
      ];
    setup.resolutions.push({
      id: randomUUID(),
      decisionId: pending.decisionId,
      proposalId: pending.proposalId,
      kind,
      at: now(),
      configSha256: current.sha256,
      sourceSha256: inspection.sourceSha256,
      operationId: operation?.operationId ?? null,
      continuation: pending.continuation
    });
    if (operation && !setup.transactions.includes(operation.operationId))
      setup.transactions.push(operation.operationId);
    setup.configurationDigest = configurationDigest(
      current.config.verification
    );
    setup.continuation = pending.continuation;
    transitionState(state, "verifying");
    state.pendingHumanDecision = null;
    await this.store.writeState(state);
    await this.store.appendEvent(state.runId, "config.verification.resolved", {
      decisionId: pending.decisionId,
      proposalId: pending.proposalId,
      resolution: kind,
      operationId: operation?.operationId ?? null
    });
  }

  private async resumeConfigurationPrerequisite(
    state: RunState,
    autoResume: boolean
  ): Promise<RunState> {
    if (!(await hasRunnerWorkOwnership(this.repoRoot, state.artifactBinding)))
      return withRunnerWorkOwnership(this.repoRoot, state.artifactBinding, () =>
        this.resumeConfigurationPrerequisite(state, autoResume)
      );
    const pending = state.pendingHumanDecision;
    if (pending?.kind !== "configuration_prerequisite") return state;
    await this.validateConfigurationContinuation(state, pending.continuation);
    const history = await readVerificationConfigTransactions(
      this.repoRoot,
      state.runId
    );
    const externalContext: VerificationConfigContext = {
      ...this.configurationContext(state, pending),
      origin: "verify_command",
      decisionId: null,
      proposalId: null
    };
    for (const external of history.filter(
      (item) =>
        item.origin === "verify_command" &&
        JSON.stringify(item.continuation) ===
          JSON.stringify(pending.continuation)
    )) {
      let retained = external;
      if (external.stage !== "finalized") {
        try {
          retained = await reconcileVerificationConfig(
            this.store,
            external,
            externalContext
          );
        } catch (error) {
          if (
            !(error instanceof BanzaiError) ||
            error.code !== "CONFIGURATION_PROPOSAL_STALE"
          )
            throw error;
          retained =
            (
              await readVerificationConfigTransactions(
                this.repoRoot,
                state.runId
              )
            ).find((item) => item.operationId === external.operationId) ??
            external;
        }
      }
      if (
        retained.stage !== "prepared" &&
        state.configurationSetup &&
        !state.configurationSetup.transactions.includes(retained.operationId)
      ) {
        state.configurationSetup.transactions.push(retained.operationId);
      }
    }
    const operation = history.find(
      (item) =>
        item.origin === "configuration_decision" &&
        item.proposalId === pending.proposalId
    );
    if (operation) {
      let result: VerificationConfigTransaction | null = null;
      try {
        result = await reconcileVerificationConfig(
          this.store,
          operation,
          this.configurationContext(state, pending)
        );
      } catch (error) {
        if (
          !(error instanceof BanzaiError) ||
          error.code !== "CONFIGURATION_PROPOSAL_STALE"
        )
          throw error;
        const retained = (
          await readVerificationConfigTransactions(this.repoRoot, state.runId)
        ).find((item) => item.operationId === operation.operationId);
        if (
          retained &&
          retained.stage !== "prepared" &&
          state.configurationSetup &&
          !state.configurationSetup.transactions.includes(retained.operationId)
        )
          state.configurationSetup.transactions.push(retained.operationId);
      }
      if (result && result.stage !== "prepared") {
        const confirmation = await readVerificationConfigConfirmation(
          this.repoRoot,
          result
        );
        await this.resolveConfigurationPrerequisite(
          state,
          pending,
          "accepted",
          result,
          {
            action: "accept",
            decidedBy: confirmation.confirmedBy,
            decidedAt: confirmation.confirmedAt
          }
        );
        return autoResume
          ? this.executeVerification(state, await loadConfig(this.repoRoot))
          : state;
      }
    }
    const current = await readVerificationConfig(this.repoRoot);
    const inspection = await inspectVerificationProject(this.repoRoot);
    if (this.configurationGaps(current.config, inspection).gaps.length === 0) {
      await this.resolveConfigurationPrerequisite(
        state,
        pending,
        "satisfied_by_configuration",
        null
      );
      return autoResume
        ? this.executeVerification(state, current.config)
        : state;
    }
    if (
      current.sha256 !== pending.configSha256 ||
      inspection.sourceSha256 !== pending.sourceSha256
    ) {
      await this.inspectConfigurationCheckpoint(
        state,
        current.config,
        {
          id: pending.continuation.attemptId,
          kind: pending.continuation.attemptKind,
          mutable: true
        },
        await this.store.readVerificationAttempts(state.runId)
      );
    }
    return state;
  }

  async getPlanHumanPrerequisites(): Promise<string | null> {
    const state = await this.store.requireActiveState();
    if (!state.planArtifacts?.plan) return null;
    return planHumanPrerequisites(
      await readFile(path.join(this.repoRoot, state.planArtifacts.plan), "utf8")
    );
  }

  async answerConfigurationPrerequisite(
    input: ConfigurationDecisionInput,
    autoResume = true
  ): Promise<RunState> {
    configurationText(input.decidedBy);
    const lock = await this.acquireWorkflowLock();
    try {
      const state = await this.store.requireActiveState();
      return await withRunnerWorkOwnership(
        this.repoRoot,
        state.artifactBinding,
        async () => {
          const pending = state.pendingHumanDecision;
          if (
            state.status !== "needs_human_decision" ||
            pending?.kind !== "configuration_prerequisite" ||
            state.runId !== input.runId ||
            pending.decisionId !== input.decisionId ||
            pending.proposalId !== input.proposalId ||
            !CONFIGURATION_ACTIONS.includes(input.action)
          )
            throw new BanzaiError(
              "CONFIGURATION_PROPOSAL_STALE",
              "Answer the exact current run, decision and proposal identities."
            );
          if ((input.action === "edit") !== (input.profile !== undefined))
            throw new BanzaiError(
              "CONFIGURATION_PROPOSAL_INVALID",
              "Only Edit requires a structured profile."
            );
          const human = {
            action: input.action,
            decidedBy: input.decidedBy,
            decidedAt: now()
          };
          if (input.action === "cancel") {
            const result = await this.cancel(
              { expectedRunId: state.runId },
              { ...pending, ...human }
            );
            return result.state ?? (await this.store.readState(state.runId));
          }
          await this.validateConfigurationContinuation(
            state,
            pending.continuation
          );
          const current = await readVerificationConfig(this.repoRoot);
          const inspection = await inspectVerificationProject(this.repoRoot);
          if (
            current.sha256 !== pending.configSha256 ||
            inspection.sourceSha256 !== pending.sourceSha256
          ) {
            if (
              this.configurationGaps(current.config, inspection).gaps.length > 0
            )
              await this.inspectConfigurationCheckpoint(
                state,
                current.config,
                {
                  id: pending.continuation.attemptId,
                  kind: pending.continuation.attemptKind,
                  mutable: true
                },
                await this.store.readVerificationAttempts(state.runId)
              );
            throw new BanzaiError(
              "CONFIGURATION_PROPOSAL_STALE",
              "Project evidence changed. Read the current status and confirm its fresh proposal, or resume a repaired checkpoint."
            );
          }
          const setup = state.configurationSetup;
          if (!setup)
            throw new BanzaiError(
              "CONFIGURATION_CONTINUATION_INVALID",
              "Configuration state is unavailable."
            );
          if (input.action === "edit") {
            const history = await readVerificationConfigTransactions(
              this.repoRoot,
              state.runId
            );
            const profile = reviseVerificationProfile(
              input.profile,
              pending.proposal.profile,
              setup.configSchemaVersion,
              verificationCommandIds(current.config, history)
            );
            state.humanDecisions = [
              ...(state.humanDecisions ?? []),
              { ...pending, ...human }
            ];
            state.pendingHumanDecision = parseConfigurationPrerequisite(
              {
                ...pending,
                proposalId: randomUUID(),
                requestedAt: now(),
                proposal: {
                  ...pending.proposal,
                  profile,
                  source: { kind: "human_edit", proposalId: pending.proposalId }
                }
              },
              setup.configSchemaVersion
            );
            await this.store.writeState(state);
            return state;
          }
          if (input.action === "skip") {
            await this.assertConfigurationSkipAuthority(state, current.config);
            setup.skip = {
              id: randomUUID(),
              runId: state.runId,
              decisionId: pending.decisionId,
              proposalId: pending.proposalId,
              projectTypes: inspection.projectTypes,
              configurationDigest: configurationDigest(
                current.config.verification
              )
            };
            setup.coverage = "skipped";
            setup.uncoveredTypes = [...inspection.projectTypes];
            delete state.verificationEvidence;
            await this.resolveConfigurationPrerequisite(
              state,
              pending,
              "skipped",
              null,
              human
            );
          } else {
            if (
              !substantiveProposal(pending.proposal) ||
              this.configurationGaps(current.config, inspection).missingScripts
                .length ||
              pending.proposal.profile.commands.some(
                (command) =>
                  inspectCommandPrerequisite(command, inspection).state ===
                  "missing_script"
              )
            )
              throw new BanzaiError(
                "CONFIGURATION_PREREQUISITE_UNMET",
                "Accept requires substantive commands and restored existing script prerequisites. Use Edit, banzai verify edit <id>, or Skip."
              );
            const preview = await previewVerificationConfig(
              this.repoRoot,
              {
                operation: "add",
                profile: proposalAsProfile(pending.proposal),
                clearBootstrap: true
              },
              pending.proposalId
            );
            const operation = await publishVerificationConfig(
              this.store,
              preview,
              input.decidedBy,
              this.configurationContext(state, pending)
            );
            if (!operation)
              throw new BanzaiError(
                "CONFIGURATION_TRANSACTION_INVALID",
                "The accepted profile did not produce its required transaction."
              );
            const confirmation = await readVerificationConfigConfirmation(
              this.repoRoot,
              operation
            );
            await this.resolveConfigurationPrerequisite(
              state,
              pending,
              "accepted",
              operation,
              {
                action: "accept",
                decidedBy: confirmation.confirmedBy,
                decidedAt: confirmation.confirmedAt
              }
            );
          }
          return autoResume
            ? this.executeVerification(state, await loadConfig(this.repoRoot))
            : state;
        }
      );
    } finally {
      await lock.release();
    }
  }

  async answerDecisionConsultation(
    input: DecisionConsultationInput,
    autoResume = true
  ): Promise<RunState> {
    try {
      if (Buffer.byteLength(JSON.stringify(input), "utf8") > 64 * 1024) {
        throw new BanzaiError(
          "INVALID_DECISION",
          "Consultation answer document is too large."
        );
      }
      decisionIdentifier(input.runId, "runId", 300);
      decisionIdentifier(input.requestId, "requestId");
      decisionIdentifier(input.roundId, "roundId");
      decisionText(input.decidedBy, "decidedBy", 200);
      const lock = await this.acquireWorkflowLock();
      try {
        const state = await this.store.requireActiveState();
        requireState(state, ["needs_human_decision"], "Decision consultation");
        if (state.runId !== input.runId) {
          throw new BanzaiError(
            "INVALID_DECISION",
            "Consultation answer does not match the active run."
          );
        }
        const pending = state.pendingHumanDecision ?? null;
        if (pending?.kind !== "decision_consultation") {
          throw new BanzaiError(
            "INVALID_DECISION",
            "The run has no pending decision consultation."
          );
        }
        if (
          pending.request.requestId !== input.requestId ||
          pending.request.roundId !== input.roundId
        ) {
          throw new BanzaiError(
            "INVALID_DECISION",
            "Consultation answer is stale for the active request or round."
          );
        }
        const priorDecisionIds = new Set(
          (state.humanDecisions ?? []).flatMap((decision) =>
            decision.kind === "decision_consultation"
              ? decision.request.decisions.map((card) => card.decisionId)
              : []
          )
        );
        const repeated = pending.request.decisions.find((decision) =>
          priorDecisionIds.has(decision.decisionId)
        );
        if (repeated !== undefined) {
          throw new BanzaiError(
            "INVALID_DECISION",
            `Decision ${repeated.decisionId} was already answered in this run.`
          );
        }
        const answers = parseDecisionConsultationAnswers(
          input.answers,
          pending.request
        );
        const decidedAt = now();
        const decision: HumanDecisionRecord = {
          ...pending,
          runId: state.runId,
          requestId: pending.request.requestId,
          roundId: pending.request.roundId,
          answers,
          decidedAt,
          decidedBy: input.decidedBy
        };
        state.humanDecisions = [...(state.humanDecisions ?? []), decision];
        state.pendingHumanDecision = null;
        state.planApproval = null;
        transitionState(state, "planning");
        await this.store.writeState(state);
        const optionAnswers = answers.filter(
          (answer) => answer.response.kind === "option"
        ).length;
        const timingEvent = await this.store.appendEvent(
          state.runId,
          "decision.consultation.answered",
          {
            cardCount: answers.length,
            answerModes: {
              option: optionAnswers,
              preference: answers.length - optionAnswers
            },
            completion: "answered"
          }
        );
        await this.observeHumanTime(
          state,
          "decision_recorded",
          "decision.consultation.answered",
          timingEvent.at
        );
        if (!autoResume) {
          return state;
        }
        return await this.executePlan(state, await loadConfig(this.repoRoot));
      } finally {
        await lock.release();
      }
    } catch (error) {
      if (error instanceof TerminalRunStateError) return error.state;
      throw error;
    }
  }

  async triage(input: TriageInput, autoResume = true): Promise<RunState> {
    try {
      const lock = await this.acquireWorkflowLock();
      try {
        const state = await this.store.requireActiveState();
        requireState(state, ["needs_triage"], "Review triage");
        const review = await this.readLatestReview(state);
        const items = this.validateTriage(review.findings, input);
        const triage: TriageRecord = {
          reviewIteration: state.reviewIteration,
          decidedAt: now(),
          decidedBy: input.decidedBy,
          items
        };
        state.triage = triage;
        state.triageHistory.push(triage);
        state.metrics.triage.accepted += items.filter(
          (item) => item.disposition === "accepted"
        ).length;
        state.metrics.triage.rejected += items.filter(
          (item) => item.disposition === "rejected"
        ).length;
        state.metrics.triage.deferred += items.filter(
          (item) => item.disposition === "deferred"
        ).length;
        const timingEvent = await this.store.appendEvent(
          state.runId,
          "review.triaged",
          {
            reviewIteration: state.reviewIteration,
            decidedBy: input.decidedBy,
            items
          }
        );
        await this.observeHumanTime(
          state,
          "decision_recorded",
          "review.triaged",
          timingEvent.at
        );
        const accepted = items.filter(
          (item) => item.disposition === "accepted"
        );
        if (
          review.findings.some(
            (finding) =>
              accepted.some((item) => item.findingId === finding.id) &&
              (finding.severity === "blocker" ||
                finding.category === "security")
          )
        ) {
          state.pendingReviewRotationReason = "accepted-high-risk-finding";
        }
        if (accepted.length === 0) {
          try {
            await this.revalidateTaskCompletion(state);
          } catch (error) {
            if (
              error instanceof TerminalRunStateError ||
              error instanceof ProjectSetupRequiredError ||
              error instanceof InstructionResourceMismatchError
            )
              throw error;
            return await this.blockForCompletionFailure(
              state,
              state.planTaskCompletion?.sourceAttemptId ?? "legacy",
              error
            );
          }
          if (!(await this.requireVerificationApplicability(state)))
            return state;
          state.pendingReviewRotationReason = null;
          transitionState(state, "done");
          await this.store.writeState(state);
          return state;
        }
        const config = await loadConfig(this.repoRoot);
        if (state.fixCycle >= config.maxFixCycles) {
          blockState(state, "Maximum fix-cycle count reached.");
          await this.store.writeState(state);
          return state;
        }
        transitionState(state, "fixing");
        await this.store.writeState(state);
        if (!autoResume) {
          return state;
        }
        return await this.executeFix(state, config);
      } finally {
        await lock.release();
      }
    } catch (error) {
      if (error instanceof TerminalRunStateError) return error.state;
      throw error;
    }
  }

  async cancel(
    input: CancelRunInput = {},
    configurationDecision?: ConfigurationDecisionRecord
  ): Promise<CancellationResult> {
    if (
      (input.reason !== undefined && !isCancellationReason(input.reason)) ||
      (input.channel !== undefined &&
        !["cli", "interactive"].includes(input.channel)) ||
      (input.channel === "interactive" && input.reason !== undefined) ||
      (input.expectedRunId !== undefined &&
        !cancellationId(input.expectedRunId))
    ) {
      throw new BanzaiError(
        "INVALID_CANCELLATION_INPUT",
        "Invalid cancellation input."
      );
    }
    const initial = await this.store.requireActiveState();
    const runId = input.expectedRunId ?? initial.runId;
    const result: CancellationResult = {
      outcome: "unconfirmed",
      runId,
      state: null,
      stopRequest: "no_active_process",
      observation: "not_applicable",
      receipt: null
    };
    if (initial.runId !== runId)
      return { ...result, outcome: "active_run_changed" };
    let context: CancellationContext = emptyCancellationContext();
    const contextLinks: CancellationContextLinks = {
      activeVerification: false,
      adr: null
    };
    const transitionIdentity: { id: string | null } = { id: null };
    let stopRequest: StopRequest = "no_active_process";
    try {
      const committed = await this.store.commitCancellation(
        runId,
        (state, raw) => {
          if (configurationDecision) {
            const pending = state.pendingHumanDecision;
            if (
              pending?.kind !== "configuration_prerequisite" ||
              pending.runId !== configurationDecision.runId ||
              pending.decisionId !== configurationDecision.decisionId ||
              pending.proposalId !== configurationDecision.proposalId ||
              configurationDecision.action !== "cancel"
            )
              throw new BanzaiError(
                "CONFIGURATION_PROPOSAL_STALE",
                "Cancellation must match the current configuration decision."
              );
            state.humanDecisions = [
              ...(state.humanDecisions ?? []),
              configurationDecision
            ];
          }
          const at = now();
          if (state.activeProcess != null)
            stopRequest = terminateProcessGroup(state.activeProcess.pid);
          try {
            context = captureCancellationContext(raw);
            contextLinks.activeVerification =
              state.activeProcess?.kind === "verification";
            const adr = Array.isArray(state.adrDecisions)
              ? state.adrDecisions.at(-1)
              : undefined;
            if (adr !== undefined)
              contextLinks.adr = {
                id: adr.id,
                decision: adr.decision,
                decidedAt: adr.decidedAt
              };
          } catch {
            context = emptyCancellationContext();
          }
          transitionIdentity.id = randomUUID();
          transitionState(state, "cancelled");
          state.activeProcess = null;
          state.pendingHumanDecision = null;
          state.cancellation = {
            schemaVersion: 1,
            id: transitionIdentity.id,
            at
          };
        }
      );
      result.outcome = committed.outcome;
      result.state = committed.state;
      result.stopRequest = stopRequest;
      if (committed.outcome !== "cancelled") return result;
    } catch {
      // A state replacement may have succeeded even when its cleanup failed.
      const current = await this.store.readState(runId).catch(() => null);
      if (
        current?.status === "cancelled" &&
        transitionIdentity.id !== null &&
        current.cancellation?.id === transitionIdentity.id
      ) {
        return {
          ...result,
          outcome: "cancelled",
          state: current,
          stopRequest,
          observation: "unsaved"
        };
      }
      if (
        current !== null &&
        !TERMINAL_STATUSES.has(current.status) &&
        (await this.store.readActiveRunId().catch(() => null)) === runId &&
        current.activeProcess?.pid === initial.activeProcess?.pid &&
        current.activeProcess != null
      ) {
        stopRequest = terminateProcessGroup(current.activeProcess.pid);
      }
      return { ...result, stopRequest };
    }
    const state = result.state;
    if (state.cancellation === undefined) return result;
    result.observation = "unsaved";
    try {
      const anchor = decodeCancellationAnchor(state.cancellation);
      const relative = `.banzai/runs/${runId}/events.jsonl`;
      const before = await readCancellationFile(
        this.repoRoot,
        relative,
        CANCELLATION_LIMITS.events
      );
      try {
        context = await enrichCancellationContext(
          this.repoRoot,
          runId,
          anchor.at,
          context,
          contextLinks,
          before
        );
      } catch {
        /* Retain independently captured state context. */
      }
      const observation = decodeCancellationObservation(
        {
          schema: CANCELLATION_SCHEMA,
          schemaVersion: 1,
          cancellationId: anchor.id,
          runId,
          cancelledAt: anchor.at,
          context,
          response: initialCancellationResponse(input, anchor.at)
        },
        runId,
        anchor
      );
      const decoded = decodeCancellationEvents(before);
      if (
        !["available", "missing"].includes(decoded.availability) ||
        decoded.events.length > 0
      )
        return result;
      let eventAt: string | null = null;
      try {
        const event = await this.store.appendEvent(
          runId,
          "run.cancelled",
          { ...observation },
          before.fingerprint
        );
        eventAt = event.at;
      } catch {
        /* Reconcile an ambiguous append by reading; never append again. */
      }
      const after = decodeCancellationEvents(
        await readCancellationFile(
          this.repoRoot,
          relative,
          CANCELLATION_LIMITS.events
        )
      );
      const resolved = resolveCancellation(
        state,
        runId,
        after.events,
        after.availability
      );
      if (
        resolved.observation === null ||
        JSON.stringify(resolved.observation) !== JSON.stringify(observation) ||
        !["available", "unanswered"].includes(resolved.availability)
      )
        return result;
      result.observation = "available";
      eventAt ??=
        after.events.find((e) => e.type === "run.cancelled")?.at ?? null;
      if (eventAt !== null)
        await this.observeHumanTime(
          state,
          "run_cancelled",
          "run.cancelled",
          eventAt
        );
      if (
        input.channel === "interactive" &&
        resolved.response?.state === "pending"
      ) {
        const receipt: CancellationReceipt = Object.freeze({
          kind: "cancellation-first-response"
        });
        this.cancellationReceipts.set(receipt, observation);
        result.receipt = receipt;
      }
    } catch {
      /* Optional observation capture never undoes the confirmed transition. */
    }
    return result;
  }

  async recordCancellationResponse(
    receipt: CancellationReceipt,
    answer: CancellationAnswer
  ): Promise<CancellationResponseResult> {
    const observation = this.cancellationReceipts.get(receipt);
    if (observation === undefined)
      return { outcome: "unavailable", response: null };
    let response;
    try {
      response = cancellationResponse(answer, now());
    } catch {
      return { outcome: "unavailable", response: null };
    }
    const { runId, cancellationId: id } = observation;
    const relative = `.banzai/runs/${runId}/events.jsonl`;
    const read = async () => {
      const state = await this.store.readState(runId);
      const file = await readCancellationFile(
        this.repoRoot,
        relative,
        CANCELLATION_LIMITS.events
      );
      const events = decodeCancellationEvents(file);
      return {
        file,
        resolved: resolveCancellation(
          state,
          runId,
          events.events,
          events.availability
        )
      };
    };
    const existing = (
      resolved: Awaited<ReturnType<typeof read>>["resolved"]
    ): CancellationResponseResult | null => {
      if (
        resolved.observation === null ||
        JSON.stringify(resolved.observation) !== JSON.stringify(observation)
      )
        return { outcome: "conflict", response: null };
      if (
        resolved.response !== null &&
        ["available", "interrupted"].includes(resolved.availability)
      ) {
        const stored = resolved.response;
        return {
          outcome:
            stored.state === response.state &&
            stored.reason === response.reason &&
            stored.provenance === response.provenance &&
            stored.channel === response.channel
              ? "saved"
              : "conflict",
          response: stored
        };
      }
      return resolved.availability === "unanswered"
        ? null
        : { outcome: "unavailable", response: null };
    };
    try {
      const before = await read();
      const previous = existing(before.resolved);
      if (previous !== null) return previous;
      try {
        await this.store.appendEvent(
          runId,
          "run.cancellation_response",
          {
            schema: CANCELLATION_SCHEMA,
            schemaVersion: 1,
            cancellationId: id,
            runId,
            response
          },
          before.file.fingerprint
        );
      } catch {
        /* First-write races and partial writes are resolved without retry. */
      }
      return (
        existing((await read()).resolved) ?? {
          outcome: "unavailable",
          response: null
        }
      );
    } catch {
      return { outcome: "unavailable", response: null };
    }
  }

  async status(): Promise<WorkflowStatus> {
    const state = await this.store.requireActiveState();
    let planApprovalValid: boolean | null = null;
    if (state.planApproval !== null) {
      try {
        const bundle = await digestArtifactBundle(
          this.repoRoot,
          state.planApproval.paths
        );
        planApprovalValid = bundle.digest === state.planApproval.digest;
      } catch {
        planApprovalValid = false;
      }
    }
    let reviewValid: boolean | null = null;
    if (state.latestReview !== null) {
      reviewValid =
        (await workspaceDigest(this.repoRoot, {
          artifactBinding: state.artifactBinding,
          excludedPaths:
            state.latestReview.artifactPath === undefined
              ? []
              : [state.latestReview.artifactPath],
          baseline: state.baseline
        })) === state.latestReview.workspaceDigest;
    }
    const latestReview =
      state.latestReview === null ? null : await this.readLatestReview(state);
    const retry = await this.retryEligibility(state);
    const recovery = await this.recoveryEligibility(state);
    const taskCompletion = await this.taskCompletionStatus(state);
    const completionPublication = await this.completionPublicationStatus(state);
    let configurationPrerequisite: WorkflowStatus["configurationPrerequisite"];
    if (state.pendingHumanDecision?.kind === "configuration_prerequisite") {
      const request = state.pendingHumanDecision;
      try {
        const config = await loadConfig(this.repoRoot);
        const inspection = await inspectVerificationProject(this.repoRoot);
        const profiles = [
          ...new Set(
            this.configurationGaps(config, inspection).missingScripts.map(
              (item) => item.profileId
            )
          )
        ];
        const displayedProfiles = profiles.slice(0, 20).map(configurationId);
        const draftUnavailable =
          !substantiveProposal(request.proposal) ||
          request.proposal.profile.commands.some(
            (command) =>
              inspectCommandPrerequisite(command, inspection).state ===
              "missing_script"
          );
        configurationPrerequisite = {
          repairCommands: [
            ...displayedProfiles.flatMap((id) => [
              `banzai verify edit ${id}`,
              `banzai verify remove ${id}`
            ]),
            ...(request.reason === "missing_profile"
              ? [`banzai verify add ${request.proposal.projectType}`]
              : []),
            "banzai verify list",
            "banzai resume"
          ],
          ...(profiles.length
            ? {
                acceptUnavailable: `Restore the missing scripts or explicitly edit/remove the existing profiles: ${displayedProfiles.join(", ")}.${profiles.length > displayedProfiles.length ? " Inspect additional profiles with banzai verify list." : ""} Accept cannot bypass these prerequisites; Skip remains available.`
              }
            : draftUnavailable
              ? {
                  acceptUnavailable:
                    "Edit the draft to include substantive commands with available prerequisites before Accept. Skip remains available."
                }
              : {})
        };
      } catch {
        configurationPrerequisite = {
          repairCommands: ["banzai verify list", "banzai resume"],
          acceptUnavailable:
            "Current prerequisites could not be inspected. Restore readable configuration and project markers, then refresh status."
        };
      }
    }
    return {
      state,
      planApprovalValid,
      reviewValid,
      latestReview,
      retry,
      recovery,
      nextAction: this.nextAction(
        state,
        retry,
        recovery,
        completionPublication
      ),
      taskCompletion,
      completionPublication,
      ...(configurationPrerequisite ? { configurationPrerequisite } : {})
    };
  }

  private async taskCompletionStatus(
    state: RunState
  ): Promise<WorkflowTaskCompletionStatus> {
    if ((state.workflowSelection?.workflow ?? "strict") !== "strict") {
      return {
        state: "not_applicable",
        source: "unknown",
        completed: null,
        total: null,
        diagnostics: []
      };
    }
    let total: number | null = null;
    try {
      total = (await this.approvedTaskIds(state)).length;
    } catch {
      // A bounded diagnostic below owns the observable invalid evidence.
    }
    const checkpoint = state.planTaskCompletion;
    if (checkpoint === undefined) {
      const implementationReport = path.posix.join(
        "documentation",
        "features",
        state.slug,
        "implementation-report.md"
      );
      let diagnostic =
        "Run predates the canonical task-completion ledger; exact completion is unknown.";
      try {
        const contents = await readFile(
          path.join(this.repoRoot, implementationReport),
          "utf8"
        );
        parsePlanTaskCompletionProjection(contents);
        diagnostic =
          "Run predates the canonical task-completion ledger; a report table cannot establish exact completion retroactively.";
      } catch (error) {
        if (
          error instanceof TerminalRunStateError ||
          error instanceof ProjectSetupRequiredError ||
          error instanceof InstructionResourceMismatchError
        )
          throw error;
        if (error instanceof PlanTaskCompletionError) {
          diagnostic = error.message;
        }
      }
      return {
        state: "legacy",
        source: "legacy",
        completed: null,
        total,
        diagnostics: [
          {
            code: "PLAN_TASK_COMPLETION_LEGACY",
            taskId: null,
            message: diagnostic
          }
        ]
      };
    }
    if (checkpoint === null) {
      return {
        state: "unknown",
        source: "unknown",
        completed: null,
        total,
        diagnostics: [
          {
            code: "PLAN_TASK_COMPLETION_MISSING",
            taskId: null,
            message: "Run has not persisted canonical task-completion evidence."
          }
        ]
      };
    }
    if (checkpoint.status === "invalid") {
      return {
        state: "inconsistent",
        source: "structured completion evidence",
        completed: null,
        total,
        diagnostics: [
          {
            code: checkpoint.errorCode,
            taskId: checkpoint.taskId,
            message: `Completion evidence failed: ${checkpoint.violation}.`
          }
        ]
      };
    }
    try {
      const allowBlockedFixReportRefresh =
        state.status === "blocked" &&
        state.blockedFrom === "fixing" &&
        state.activeAttempt === null;
      const validated = await this.revalidateTaskCompletion(
        state,
        allowBlockedFixReportRefresh,
        false
      );
      return {
        state:
          validated.summary.counts.completed === validated.summary.counts.total
            ? "complete"
            : "incomplete",
        source: "structured completion evidence",
        completed: validated.summary.counts.completed,
        total: validated.summary.counts.total,
        diagnostics: []
      };
    } catch (error) {
      if (
        error instanceof TerminalRunStateError ||
        error instanceof ProjectSetupRequiredError ||
        error instanceof InstructionResourceMismatchError
      )
        throw error;
      const completionError =
        error instanceof PlanTaskCompletionError ? error : null;
      return {
        state: "inconsistent",
        source: "structured completion evidence",
        completed: null,
        total,
        diagnostics: [
          {
            code: "PLAN_TASK_COMPLETION_INVALID",
            taskId: completionError?.taskId ?? null,
            message:
              completionError?.message ??
              "Canonical task-completion evidence cannot be revalidated."
          }
        ]
      };
    }
  }

  private async retryEligibility(state: RunState): Promise<RetryEligibility> {
    if (state.status !== "blocked") {
      return {
        eligible: false,
        reason: `Retry requires a blocked run, but the run is ${state.status}.`,
        attemptId: null
      };
    }
    if (state.activeProcess !== null) {
      return {
        eligible: false,
        reason: "Retry is unavailable while a model process is still active.",
        attemptId: state.activeAttempt?.id ?? null
      };
    }
    const attempt = state.activeAttempt;
    if (attempt === null) {
      if (state.blockedFrom === "created") {
        return {
          eligible: true,
          reason:
            "Startup checks can be retried after resolving the reported prerequisite.",
          attemptId: null
        };
      }
      if (state.blockedFrom === "reviewing") {
        return {
          eligible: true,
          reason:
            "Review checks can be retried after resolving the reported prerequisite.",
          attemptId: null
        };
      }
      if (
        state.blockedFrom === "verifying" &&
        state.planTaskCompletion?.status === "invalid"
      ) {
        // Completion revalidation rejected the evidence before verification
        // commands ran — for example a fix attempt edited the frozen Plan
        // Task Completion projection. The already-authorized completion
        // repair applies; there is no failed verification attempt to retry.
        return {
          eligible: true,
          reason: PLAN_BUNDLE_COMPLETION_VIOLATIONS.has(
            state.planTaskCompletion.violation
          )
            ? "The approved plan bundle is invalid; retry reruns planning for a corrected bundle and a new approval."
            : `Completion evidence rejected at revalidation can be repaired with a new implementation attempt.`,
          attemptId: state.planTaskCompletion.sourceAttemptId
        };
      }
      if (state.blockedFrom === "verifying") {
        try {
          if (!(await this.store.verificationLedgerSupported(state.runId))) {
            return {
              eligible: false,
              reason:
                "Legacy verification evidence has no retryable durable attempt identity. Inspect the checkout, then cancel the run.",
              attemptId: null
            };
          }
          const latest = (
            await this.store.readVerificationAttempts(state.runId)
          ).at(-1);
          if (latest?.status === "failed") {
            return {
              eligible: true,
              reason: `Failed verification attempt ${latest.id} can be retried explicitly.`,
              attemptId: latest.id
            };
          }
        } catch {
          return {
            eligible: false,
            reason:
              "Verification evidence is malformed or conflicting. Audit the run before continuing.",
            attemptId: null
          };
        }
      }
      // Pre-attempt checks block only through validateApproval, whose block
      // reason is the runner's own text; every other blocked-from-fixing state
      // without an attempt (a completed prerequisite-blocked fix) belongs to
      // the recovery path and must not gain a retry here.
      const approvalInvalidated =
        state.blockReason?.startsWith("Approved planning artifacts changed") ===
        true;
      if (approvalInvalidated && state.blockedFrom === "fixing") {
        return {
          eligible: true,
          reason:
            "Fix checks can be retried after resolving the reported prerequisite.",
          attemptId: null
        };
      }
      if (
        approvalInvalidated &&
        (state.blockedFrom === "implementing" ||
          state.blockedFrom === "plan_approved")
      ) {
        return {
          eligible: true,
          reason:
            "Implementation checks can be retried after resolving the reported prerequisite.",
          attemptId: null
        };
      }
      return {
        eligible: false,
        reason:
          "This blocked state is not tied to a failed attempt. Resolve it manually or cancel the run.",
        attemptId: null
      };
    }
    const record = await this.store.readRunAttempt(state.runId, attempt);
    if (
      record.status === "failed" &&
      record.failureCode === "CONTEXT_BUDGET_EXCEEDED"
    ) {
      const expectedStatus =
        attempt.kind === "selection"
          ? "selecting"
          : attempt.kind === "plan"
            ? "planning"
            : attempt.kind === "implementation"
              ? "implementing"
              : attempt.kind === "fix"
                ? "fixing"
                : "reviewing";
      if (state.blockedFrom === expectedStatus) {
        return {
          eligible: true,
          reason: `Context-budget-blocked ${attempt.kind} attempt ${attempt.id} can be retried explicitly after policy or authorized input changes because no vendor process started.`,
          attemptId: attempt.id
        };
      }
    }
    if (attempt.mutable) {
      const checkpoint = state.planTaskCompletion;
      if (record.status === "pending_application") {
        return {
          eligible: false,
          reason:
            "Completion publication for this attempt is pending; use banzai resume to reconcile it without another model call, or cancel the run.",
          attemptId: attempt.id
        };
      }
      if (
        ((attempt.kind === "implementation" &&
          state.blockedFrom === "implementing") ||
          (attempt.kind === "fix" && state.blockedFrom === "fixing")) &&
        record.status === "failed" &&
        // The runner itself classified this failure as completion evidence
        // when it wrote the invalid checkpoint: a result rejected by ledger
        // validation keeps its decoded evidence, and a result whose decode
        // failed on a completion field keeps only the diagnostic — the repair
        // replaces the whole result either way, so neither is a dead end.
        record.failureCode === "PLAN_TASK_COMPLETION_INVALID" &&
        checkpoint?.status === "invalid" &&
        checkpoint.sourceAttemptId === attempt.id
      ) {
        return {
          eligible: true,
          reason: PLAN_BUNDLE_COMPLETION_VIOLATIONS.has(checkpoint.violation)
            ? "The approved plan bundle is invalid; retry reruns planning for a corrected bundle and a new approval."
            : `Completion evidence for ${attempt.kind} attempt ${attempt.id} can be repaired with a new attempt.`,
          attemptId: attempt.id
        };
      }
      return {
        eligible: false,
        reason:
          "Failed mutable attempts cannot be retried because their repository side effects may be incomplete. Inspect the checkout, then cancel the run.",
        attemptId: attempt.id
      };
    }
    const isRetryableInterruption = isRetryableInterruptedAttempt(
      attempt,
      record
    );
    if (record.status !== "failed" && !isRetryableInterruption) {
      return {
        eligible: false,
        reason:
          record.status === "started"
            ? "Interrupted attempts cannot be retried automatically. Inspect the checkout, then cancel the run."
            : `Attempt ${attempt.id} is ${record.status}, not failed.`,
        attemptId: attempt.id
      };
    }
    const expectedStatus =
      attempt.kind === "selection"
        ? "selecting"
        : attempt.kind === "plan"
          ? "planning"
          : attempt.kind === "implementation"
            ? "implementing"
            : attempt.kind === "review"
              ? "reviewing"
              : null;
    if (expectedStatus === null || state.blockedFrom !== expectedStatus) {
      return {
        eligible: false,
        reason: `The failed ${attempt.kind} attempt is inconsistent with blockedFrom=${state.blockedFrom ?? "null"}.`,
        attemptId: attempt.id
      };
    }
    return {
      eligible: true,
      reason:
        record.status === "started"
          ? `Interrupted ${attempt.kind} attempt ${attempt.id} can be retried explicitly because it was read-only.`
          : `Failed ${attempt.kind} attempt ${attempt.id} can be retried explicitly.`,
      attemptId: attempt.id
    };
  }

  private async prerequisiteBlockedFixScope(
    state: RunState,
    record: AttemptRecord,
    requirePersistedBlock: boolean
  ): Promise<PrerequisiteBlockedFixScope> {
    const attempt = record.attempt;
    if (
      attempt.kind !== "fix" ||
      !attempt.mutable ||
      record.status !== "completed" ||
      record.result === null ||
      (record.recoveryOf ?? null) !== null ||
      (record.recoveryAuthorizationId ?? null) !== null
    ) {
      throw new BanzaiError(
        "RECOVERY_SOURCE_INVALID",
        "Prerequisite recovery requires an unrecovered completed fix attempt."
      );
    }
    const result = parsePersistedPhaseResult(record.result);
    if (
      result.phase !== "fix" ||
      result.outcome !== "blocked" ||
      result.gate !== null ||
      result.taskCompletion !== null ||
      (requirePersistedBlock && result.summary !== state.blockReason)
    ) {
      throw new BanzaiError(
        "RECOVERY_SOURCE_INVALID",
        "The completed fix result does not match the current prerequisite block."
      );
    }
    if (
      (state.workflowSelection?.workflow ?? "strict") !== "strict" ||
      state.latestReview === null ||
      state.triage === null ||
      state.reviewIteration !== state.latestReview.iteration ||
      state.triage.reviewIteration !== state.latestReview.iteration
    ) {
      throw new BanzaiError(
        "RECOVERY_SCOPE_INVALID",
        "Prerequisite recovery requires one current strict review and triage."
      );
    }
    const review = await this.readLatestReview(state);
    const reviewFindingIds = review.findings.map((finding) => finding.id);
    const reviewFindingIdSet = new Set(reviewFindingIds);
    const triagedIds = state.triage.items.map((item) => item.findingId);
    if (
      new Set(triagedIds).size !== triagedIds.length ||
      triagedIds.length !== reviewFindingIds.length ||
      triagedIds.some((id) => !reviewFindingIdSet.has(id))
    ) {
      throw new BanzaiError(
        "RECOVERY_SCOPE_INVALID",
        "Current triage does not exactly cover the current review."
      );
    }
    const acceptedFindingIds = state.triage.items
      .filter((item) => item.disposition === "accepted")
      .map((item) => item.findingId)
      .sort();
    const acceptedFindingIdSet = new Set(acceptedFindingIds);
    const resolvedFindingIds = [...result.resolvedFindingIds].sort();
    if (
      acceptedFindingIds.length === 0 ||
      resolvedFindingIds.length === 0 ||
      new Set(resolvedFindingIds).size !== resolvedFindingIds.length ||
      resolvedFindingIds.some((id) => !acceptedFindingIdSet.has(id))
    ) {
      throw new BanzaiError(
        "RECOVERY_SCOPE_INVALID",
        "The blocked fix result does not prove valid partial accepted-finding progress."
      );
    }
    const resolvedFindingIdSet = new Set(resolvedFindingIds);
    const remainingFindingIds = acceptedFindingIds.filter(
      (id) => !resolvedFindingIdSet.has(id)
    );
    const prerequisites = [...result.questions, ...result.requestedVerification]
      .map((item) => item.trim())
      .filter((item) => {
        const referencedFindingIds = review.findings
          .filter((finding) => {
            const escaped = finding.id.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
            return (
              new RegExp(
                `(^|[^A-Za-z0-9_:-])${escaped}($|[^A-Za-z0-9_:-])`,
                "u"
              ).test(item) ||
              finding.evidence.some((evidence) => item.includes(evidence.path))
            );
          })
          .map((finding) => finding.id);
        return (
          referencedFindingIds.length === 0 ||
          referencedFindingIds.every((findingId) =>
            remainingFindingIds.includes(findingId)
          )
        );
      });
    if (
      remainingFindingIds.length === 0 ||
      prerequisites.length === 0 ||
      prerequisites.some((item) => item.length === 0)
    ) {
      throw new BanzaiError(
        "RECOVERY_SCOPE_INVALID",
        "The blocked fix result has no remaining accepted scope or concrete prerequisite."
      );
    }
    const sourceAttempt = {
      id: attempt.id,
      kind: "fix" as const,
      mutable: true as const
    };
    const typedRecord = record as AttemptRecord<PhaseResult>;
    const reviewDigest = digestCanonicalJson(review);
    const scopeDigest = digestCanonicalJson({
      version: 2,
      sourceKind: "prerequisite_blocked_fix",
      reviewIteration: state.latestReview.iteration,
      reviewDigest,
      acceptedFindingIds,
      sourceAttempt,
      sourceResultDigest: digestCanonicalJson(result),
      resolvedFindingIds,
      remainingFindingIds
    });
    return {
      attempt: sourceAttempt,
      record: typedRecord,
      result,
      reviewDigest,
      acceptedFindingIds,
      resolvedFindingIds,
      remainingFindingIds,
      prerequisites,
      scopeDigest
    };
  }

  private async prerequisiteBlockedFixSource(
    state: RunState
  ): Promise<PrerequisiteBlockedFixScope> {
    const records = await this.store.readRunAttempts(state.runId);
    const candidates: PrerequisiteBlockedFixScope[] = [];
    for (const record of records) {
      if (
        record.attempt.kind !== "fix" ||
        record.status !== "completed" ||
        record.result === null
      ) {
        continue;
      }
      try {
        candidates.push(
          await this.prerequisiteBlockedFixScope(state, record, true)
        );
      } catch {
        // Only an exact current completed-blocked result is a candidate. A
        // malformed or historical record cannot be used to reconstruct scope.
      }
    }
    if (candidates.length !== 1) {
      throw new BanzaiError(
        "RECOVERY_SOURCE_AMBIGUOUS",
        candidates.length === 0
          ? "No exact completed prerequisite-blocked fix source is available."
          : "Multiple completed blocked fix attempts match the current review; recovery is ambiguous."
      );
    }
    const source = candidates[0];
    if (source === undefined) {
      throw new BanzaiError(
        "RECOVERY_SOURCE_AMBIGUOUS",
        "No exact completed prerequisite-blocked fix source is available."
      );
    }
    const descendants = records.filter(
      (record) => (record.recoveryOf ?? null) === source.attempt.id
    );
    const descendant = descendants[0];
    const preparedDescendant =
      descendants.length === 1 &&
      descendant !== undefined &&
      state.recovery?.sourceAttemptId === source.attempt.id &&
      state.recovery.recoveryAttemptId === null &&
      state.recovery.stage === "source_preserved" &&
      descendant.attempt.id ===
        `fix-recovery-${state.recovery.authorizationId.replace(/^recovery-/u, "")}` &&
      descendant.status === "started" &&
      descendant.result === null &&
      descendant.recoveryAuthorizationId === state.recovery.authorizationId;
    if (descendants.length > 0 && !preparedDescendant) {
      throw new BanzaiError(
        "RECOVERY_ALREADY_STARTED",
        "A recovery descendant already exists for the completed blocked fix source."
      );
    }
    if (
      state.recovery !== undefined &&
      state.recovery !== null &&
      (state.recovery.sourceAttemptId !== source.attempt.id ||
        state.recovery.recoveryAttemptId !== null)
    ) {
      throw new BanzaiError(
        "RECOVERY_STATE_CHANGED",
        "Persisted recovery state does not match the completed blocked fix source."
      );
    }
    const checkpoint = await this.store.readTerminalCheckpointIfExists(
      state.runId,
      source.attempt
    );
    if (
      checkpoint !== null &&
      (checkpoint.baseCommit !== state.baseCommit ||
        checkpoint.approvalDigest !== state.planApproval?.digest ||
        checkpoint.scopeDigest !==
          this.attemptScopeDigest(state, source.attempt) ||
        (checkpoint.schemaVersion === 1
          ? digestCanonicalJson(checkpoint.result)
          : digestCanonicalJson(
              JSON.parse(checkpoint.envelope.original) as unknown
            )) !== digestCanonicalJson(source.result))
    ) {
      throw new BanzaiError(
        "INVALID_TERMINAL_CHECKPOINT",
        "The completed blocked source conflicts with its terminal checkpoint."
      );
    }
    return source;
  }

  private async prerequisiteBlockedFixRecoveryEligibility(
    state: RunState
  ): Promise<RecoveryEligibility> {
    if (
      state.blockedFrom !== "fixing" ||
      state.activeAttempt !== null ||
      (state.activeProcess !== null &&
        this.store.processAlive(state.activeProcess.pid))
    ) {
      return recoveryIneligible(
        "Prerequisite recovery requires a completed blocked fix with no active attempt or process.",
        null,
        "fix"
      );
    }
    try {
      if ((await currentCommit(this.repoRoot)) !== state.baseCommit) {
        return recoveryIneligible(
          "Recovery is unavailable because checkout HEAD changed.",
          null,
          "fix"
        );
      }
      await this.validateApproval(state);
      await this.revalidateTaskCompletion(state, true, false);
      const source = await this.prerequisiteBlockedFixSource(state);
      const config = await loadConfig(this.repoRoot);
      assertContractParity();
      const settings = config.models.implementer;
      const vendor =
        vendorFor(settings.executable) ?? FALLBACK_VENDOR.implementer;
      const configurationDigest = digestCanonicalJson({
        version: 1,
        vendor,
        executableDigest: digestCanonicalJson(settings.executable),
        model: settings.model,
        effort: settings.effort
      });
      const snapshot = await workspaceSnapshot(this.repoRoot, {
        artifactBinding: state.artifactBinding,
        baseline: state.baseline
      });
      if (snapshot.baseCommit !== state.baseCommit) {
        return recoveryIneligible(
          "Recovery is unavailable because the workspace base commit changed.",
          source.attempt.id,
          "fix"
        );
      }
      const counts = await workspaceChangeCounts(this.repoRoot, snapshot);
      const recoveryIdentity = digestCanonicalJson({
        version: 2,
        sourceKind: "prerequisite_blocked_fix",
        runId: state.runId,
        attempt: source.attempt,
        phase: "fix",
        baseCommit: state.baseCommit,
        workspaceDigest: snapshot.digest,
        approvalDigest: state.planApproval?.digest ?? null,
        workflowDigest: null,
        scopeDigest: source.scopeDigest,
        configurationDigest
      });
      if (
        state.recovery?.sourceAttemptId === source.attempt.id &&
        state.recovery.recoveryAttemptId === null
      ) {
        const authorization = await this.store.readRecoveryAuthorization(
          state.runId,
          state.recovery.authorizationId
        );
        if (
          authorization.attempt.id !== source.attempt.id ||
          authorization.recoveryIdentity !== recoveryIdentity
        ) {
          return recoveryIneligible(
            "Persisted recovery authorization is stale or inconsistent.",
            source.attempt.id,
            "fix"
          );
        }
      }
      return {
        eligible: true,
        reason: `Completed blocked fix attempt ${source.attempt.id} may be recovered for remaining accepted findings ${source.remainingFindingIds.join(", ")} after ${source.prerequisites.length} operator prerequisite${source.prerequisites.length === 1 ? "" : "s"}.`,
        warning:
          "The source attempt remains completed and blocked. Recovery authorizes one new fix attempt for the exact remaining accepted scope after the displayed prerequisites are addressed.",
        sourceKind: "prerequisite_blocked_fix",
        attemptId: source.attempt.id,
        phase: "fix",
        resolvedFindingIds: source.resolvedFindingIds,
        remainingFindingIds: source.remainingFindingIds,
        prerequisites: source.prerequisites,
        authorization: "plan_approval",
        recoveryIdentity,
        workspace: { digest: snapshot.digest, ...counts },
        baseCommit: state.baseCommit,
        approvalDigest: state.planApproval?.digest ?? null,
        workflowDigest: null,
        scopeDigest: source.scopeDigest,
        configurationDigest
      };
    } catch (error) {
      if (
        error instanceof TerminalRunStateError ||
        error instanceof ProjectSetupRequiredError ||
        error instanceof InstructionResourceMismatchError
      )
        throw error;
      return recoveryIneligible(
        error instanceof BanzaiError
          ? error.message
          : "Prerequisite recovery preconditions could not be validated; inspect or cancel the run.",
        state.recovery?.sourceAttemptId ?? null,
        "fix"
      );
    }
  }

  private async recoveryEligibility(
    state: RunState
  ): Promise<RecoveryEligibility> {
    if (state.status !== "blocked") {
      return recoveryIneligible(
        `Recovery requires a blocked run, but the run is ${state.status}.`
      );
    }
    const attempt = state.activeAttempt;
    if (attempt === null && state.blockedFrom === "fixing") {
      return await this.prerequisiteBlockedFixRecoveryEligibility(state);
    }
    if (
      attempt === null ||
      !attempt.mutable ||
      (attempt.kind !== "implementation" && attempt.kind !== "fix")
    ) {
      return recoveryIneligible(
        "Recovery requires an interrupted mutable implementation or fix attempt.",
        attempt?.id ?? null
      );
    }
    const phase = attempt.kind;
    const expectedBlockedFrom =
      phase === "implementation" ? "implementing" : "fixing";
    if (state.blockedFrom !== expectedBlockedFrom) {
      return recoveryIneligible(
        `The interrupted ${phase} attempt is inconsistent with blockedFrom=${state.blockedFrom ?? "null"}.`,
        attempt.id,
        phase
      );
    }
    if (
      state.activeProcess !== null &&
      this.store.processAlive(state.activeProcess.pid)
    ) {
      return recoveryIneligible(
        "Recovery is unavailable while the model process is still active.",
        attempt.id,
        phase
      );
    }
    let record: AttemptRecord;
    try {
      record = await this.store.readRunAttempt(state.runId, attempt);
    } catch {
      return recoveryIneligible(
        "Recovery attempt evidence is unreadable or inconsistent.",
        attempt.id,
        phase
      );
    }
    try {
      const checkpoint = await this.store.readTerminalCheckpointIfExists(
        state.runId,
        attempt
      );
      if (checkpoint !== null) {
        const completionEvidenceRejected =
          record.status === "failed" &&
          record.result !== null &&
          record.failureCode === "PLAN_TASK_COMPLETION_INVALID" &&
          state.planTaskCompletion?.status === "invalid" &&
          state.planTaskCompletion.sourceAttemptId === attempt.id;
        return recoveryIneligible(
          completionEvidenceRejected
            ? "The terminal checkpoint result was rejected by completion validation; use banzai retry to repair its evidence."
            : "A terminal checkpoint exists; use banzai resume so Banzai can reconcile proven completion.",
          attempt.id,
          phase,
          true
        );
      }
    } catch {
      return recoveryIneligible(
        "Terminal checkpoint evidence is malformed or conflicting; inspect or cancel the run.",
        attempt.id,
        phase
      );
    }
    const recoverableFailedAttempt =
      record.status === "failed" &&
      record.failureCause !== null &&
      record.failureCause !== undefined &&
      RECOVERABLE_MUTABLE_FAILURE_CAUSES.has(record.failureCause);
    if (
      (record.status !== "started" &&
        record.status !== "interrupted" &&
        !recoverableFailedAttempt) ||
      record.result !== null
    ) {
      return recoveryIneligible(
        `Attempt ${attempt.id} is not an uncompleted interruption.`,
        attempt.id,
        phase
      );
    }
    if (
      state.recovery?.sourceAttemptId === attempt.id &&
      state.recovery.recoveryAttemptId !== null
    ) {
      return recoveryIneligible(
        "A later recovery attempt already supersedes this interruption.",
        attempt.id,
        phase
      );
    }
    try {
      if ((await currentCommit(this.repoRoot)) !== state.baseCommit) {
        return recoveryIneligible(
          "Recovery is unavailable because checkout HEAD changed.",
          attempt.id,
          phase
        );
      }
      const config = await loadConfig(this.repoRoot);
      assertContractParity();
      const settings = config.models.implementer;
      const vendor =
        vendorFor(settings.executable) ?? FALLBACK_VENDOR.implementer;
      const route = state.workflowSelection?.workflow ?? "strict";
      let approvalDigest: string | null = null;
      let workflowDigest: string | null = null;
      if (route === "strict" || phase === "fix") {
        await this.validateApproval(state);
        approvalDigest = state.planApproval?.digest ?? null;
      } else {
        workflowDigest = this.validateWorkflowSelection(state).digest;
      }
      if (phase === "fix") {
        await this.revalidateTaskCompletion(state);
        if (
          !state.triage?.items.some((item) => item.disposition === "accepted")
        ) {
          return recoveryIneligible(
            "Fix recovery requires a non-empty current accepted-finding scope.",
            attempt.id,
            phase
          );
        }
      }
      const scopeDigest = this.attemptScopeDigest(state, attempt);
      const configurationDigest = digestCanonicalJson({
        version: 1,
        vendor,
        executableDigest: digestCanonicalJson(settings.executable),
        model: settings.model,
        effort: settings.effort
      });
      const snapshot = await workspaceSnapshot(this.repoRoot, {
        artifactBinding: state.artifactBinding,
        baseline: state.baseline
      });
      if (snapshot.baseCommit !== state.baseCommit) {
        return recoveryIneligible(
          "Recovery is unavailable because the workspace base commit changed.",
          attempt.id,
          phase
        );
      }
      const counts = await workspaceChangeCounts(this.repoRoot, snapshot);
      const recoveryIdentity = digestCanonicalJson({
        version: 1,
        runId: state.runId,
        attempt,
        phase,
        baseCommit: state.baseCommit,
        workspaceDigest: snapshot.digest,
        approvalDigest,
        workflowDigest,
        scopeDigest,
        configurationDigest
      });
      if (
        state.recovery?.sourceAttemptId === attempt.id &&
        state.recovery.recoveryAttemptId === null
      ) {
        const authorization = await this.store.readRecoveryAuthorization(
          state.runId,
          state.recovery.authorizationId
        );
        if (
          authorization.attempt.id !== attempt.id ||
          authorization.recoveryIdentity !== recoveryIdentity
        ) {
          return recoveryIneligible(
            "Persisted recovery authorization is stale or inconsistent.",
            attempt.id,
            phase
          );
        }
      }
      return {
        eligible: true,
        reason: `Interrupted ${phase} attempt ${attempt.id} may be recovered only with current explicit authorization.`,
        warning: RECOVERY_WARNING,
        sourceKind: "interrupted",
        attemptId: attempt.id,
        phase,
        resolvedFindingIds: [],
        remainingFindingIds: [],
        prerequisites: [],
        authorization:
          approvalDigest === null ? "workflow_selection" : "plan_approval",
        recoveryIdentity,
        workspace: { digest: snapshot.digest, ...counts },
        baseCommit: state.baseCommit,
        approvalDigest,
        workflowDigest,
        scopeDigest,
        configurationDigest
      };
    } catch {
      return recoveryIneligible(
        "Recovery preconditions could not be validated; inspect or cancel the run.",
        attempt.id,
        phase
      );
    }
  }

  private async executeAuthorizedRecovery(
    state: RunState,
    config: OrchestratorConfig,
    authorization: RecoveryAuthorization
  ): Promise<RunState> {
    await this.assertProjectGuidance();
    await this.preflightVendor("implementer", config.models.implementer);
    const persistedSourceRecord = await this.store.readRunAttempt(
      state.runId,
      authorization.attempt
    );
    const prerequisiteSource =
      authorization.phase === "fix" &&
      persistedSourceRecord.status === "completed" &&
      persistedSourceRecord.result !== null
        ? await this.prerequisiteBlockedFixScope(
            state,
            persistedSourceRecord,
            false
          )
        : null;
    const sourceAlreadyInterrupted =
      state.recovery?.sourceAttemptId === authorization.attempt.id &&
      state.recovery.recoveryAttemptId === null &&
      state.recovery.stage === "source_interrupted";
    const sourceAlreadyPreserved =
      state.recovery?.sourceAttemptId === authorization.attempt.id &&
      state.recovery.recoveryAttemptId === null &&
      state.recovery.stage === "source_preserved";
    const eligibilityState = sourceAlreadyInterrupted
      ? {
          ...state,
          status: "blocked" as const,
          blockedFrom:
            authorization.phase === "implementation"
              ? ("implementing" as const)
              : ("fixing" as const),
          activeAttempt: authorization.attempt,
          activeProcess: null
        }
      : sourceAlreadyPreserved && prerequisiteSource !== null
        ? {
            ...state,
            status: "blocked" as const,
            blockedFrom: "fixing" as const,
            blockReason: prerequisiteSource.result.summary,
            activeAttempt: null,
            activeProcess: null
          }
        : state;
    const eligibility = await this.recoveryEligibility(eligibilityState);
    await this.assertProjectGuidance();
    const workspace = eligibility.workspace;
    const expectedSourceKind =
      prerequisiteSource === null
        ? ("interrupted" as const)
        : ("prerequisite_blocked_fix" as const);
    if (
      !eligibility.eligible ||
      workspace === null ||
      eligibility.sourceKind !== expectedSourceKind ||
      eligibility.attemptId !== authorization.attempt.id ||
      eligibility.phase !== authorization.phase ||
      eligibility.recoveryIdentity !== authorization.recoveryIdentity ||
      workspace.digest !== authorization.workspaceDigest ||
      eligibility.baseCommit !== authorization.baseCommit ||
      eligibility.approvalDigest !== authorization.approvalDigest ||
      eligibility.workflowDigest !== authorization.workflowDigest ||
      eligibility.scopeDigest !== authorization.scopeDigest ||
      eligibility.configurationDigest !== authorization.configurationDigest
    ) {
      state.recovery = null;
      state.activeAttempt =
        prerequisiteSource === null ? authorization.attempt : null;
      if (state.status !== "blocked") {
        blockState(
          state,
          "Recovery authorization no longer matches the exact current workspace."
        );
      }
      await this.store.writeState(state);
      await this.store.appendEvent(state.runId, "recovery.invalidated", {
        authorizationId: authorization.authorizationId,
        attemptId: authorization.attempt.id
      });
      throw new BanzaiError(
        "RECOVERY_STALE",
        eligibility.eligible
          ? "Recovery authorization no longer matches the exact current workspace."
          : eligibility.reason
      );
    }
    const sourceAttempt = authorization.attempt;
    if (
      (prerequisiteSource === null &&
        !sourceAlreadyInterrupted &&
        state.activeAttempt?.id !== authorization.attempt.id) ||
      (prerequisiteSource !== null &&
        !sourceAlreadyPreserved &&
        state.activeAttempt !== null)
    ) {
      throw new BanzaiError(
        "RECOVERY_STATE_CHANGED",
        "The recovery source changed before recovery execution."
      );
    }
    await this.assertProjectGuidance();
    const pendingTransition: (() => Promise<unknown>)[] = [];
    const commitTransition = async () => {
      for (const publish of pendingTransition) await publish();
      pendingTransition.length = 0;
    };
    if (!sourceAlreadyInterrupted && !sourceAlreadyPreserved) {
      if (prerequisiteSource === null) {
        // A schema-3 protocol source keeps its persisted protocol; only v1
        // records gain the v2 interruption fields.
        if (persistedSourceRecord.schemaVersion === 1)
          persistedSourceRecord.schemaVersion = MODEL_ATTEMPT_SCHEMA_VERSION;
        persistedSourceRecord.status = "interrupted";
        persistedSourceRecord.completedAt = null;
        persistedSourceRecord.interruptedAt ??= now();
        persistedSourceRecord.durationMs = null;
        persistedSourceRecord.recoveryOf ??= null;
        persistedSourceRecord.recoveryAuthorizationId ??= null;
        pendingTransition.push(async () => {
          await this.store.writeRunAttempt(state.runId, persistedSourceRecord);
        });
      }
      state.activeAttempt = null;
      state.activeProcess = null;
      transitionState(
        state,
        authorization.phase === "implementation" ? "implementing" : "fixing"
      );
      state.recovery = {
        authorizationId: authorization.authorizationId,
        sourceAttemptId: sourceAttempt.id,
        recoveryAttemptId: null,
        stage:
          prerequisiteSource === null
            ? "source_interrupted"
            : "source_preserved"
      };
      pendingTransition.push(async () => {
        await this.store.writeState(state);
      });
      pendingTransition.push(
        async () =>
          await this.store.appendEvent(
            state.runId,
            prerequisiteSource === null
              ? "attempt.interrupted"
              : "attempt.blocked_source_preserved",
            {
              attemptId: sourceAttempt.id,
              kind: sourceAttempt.kind,
              recoveryAuthorizationId: authorization.authorizationId
            }
          )
      );
    }
    this.info(
      prerequisiteSource === null
        ? `Recovering interrupted ${authorization.phase} attempt ${sourceAttempt.id} from the authorized workspace`
        : `Recovering remaining accepted findings from completed blocked fix attempt ${sourceAttempt.id}`
    );
    try {
      return authorization.phase === "implementation"
        ? await this.executeImplementation(
            state,
            config,
            authorization,
            commitTransition
          )
        : await this.executeFix(state, config, authorization, commitTransition);
    } catch (error) {
      if (
        error instanceof TerminalRunStateError ||
        error instanceof ProjectSetupRequiredError ||
        error instanceof InstructionResourceMismatchError
      )
        throw error;
      const current = await this.store.readState(state.runId);
      if (
        current.activeAttempt === null &&
        current.recovery?.stage !== "source_interrupted" &&
        current.recovery?.stage !== "source_preserved"
      ) {
        current.activeAttempt =
          prerequisiteSource === null ? sourceAttempt : null;
        current.recovery = null;
        blockState(current, `Recovery checks failed: ${errorMessage(error)}`);
        await this.store.writeState(current);
      }
      throw error;
    }
  }

  private async recordStartFailure(
    state: RunState,
    error: unknown
  ): Promise<RunState> {
    const reason = checkFailureReason(error);
    blockState(state, reason);
    state.activeAttempt = null;
    state.activeProcess = null;
    await this.store.writeState(state);
    await this.store.appendEvent(state.runId, "run.start_failed", {
      reason
    });
    return state;
  }

  private async recordReviewCheckFailure(
    state: RunState,
    error: unknown
  ): Promise<RunState> {
    const reason = checkFailureReason(error);
    state.pendingReviewRotationReason = "unreliable-review";
    blockState(state, reason);
    state.activeAttempt = null;
    state.activeProcess = null;
    await this.store.writeState(state);
    await this.store.appendEvent(state.runId, "review.checks_failed", {
      reason
    });
    return state;
  }

  private async recordVerificationRetryCheckFailure(
    state: RunState,
    attemptId: string,
    error: unknown
  ): Promise<RunState> {
    const reason = checkFailureReason(error);
    blockState(state, reason);
    state.activeAttempt = null;
    state.activeProcess = null;
    await this.store.writeState(state);
    await this.store.appendEvent(
      state.runId,
      "verification.retry_preflight_failed",
      { attemptId, reason }
    );
    return state;
  }

  private nextAction(
    state: RunState,
    retry: RetryEligibility,
    recovery: RecoveryEligibility,
    publication: WorkflowStatus["completionPublication"] = null
  ): string | null {
    if (state.status === "needs_adr_approval") {
      return "banzai approve adr";
    }
    if (state.status === "needs_plan_approval") {
      return "banzai approve plan";
    }
    if (state.status === "needs_human_decision") {
      return "banzai";
    }
    if (state.status === "needs_triage") {
      return "banzai triage";
    }
    if (state.status === "blocked") {
      if (publication?.pending === true && publication.action !== null)
        return `banzai ${publication.action}`;
      return retry.eligible
        ? "banzai retry"
        : recovery.terminalCheckpointPresent === true
          ? "banzai resume"
          : recovery.eligible
            ? "banzai recover"
            : "banzai cancel";
    }
    if (
      [
        "created",
        "selecting",
        "planning",
        "plan_approved",
        "implementing",
        "verifying",
        "reviewing",
        "fixing"
      ].includes(state.status)
    ) {
      return "banzai resume";
    }
    return null;
  }

  /**
   * Runs the subscription check that belongs to the configured executable. An
   * executable belonging to neither vendor falls back to the adapter that will
   * actually run the role, so a custom wrapper is still checked rather than
   * silently skipped.
   */
  private async preflightVendor(
    role: ModelRole,
    settings: ModelSettings
  ): Promise<void> {
    const vendor = vendorFor(settings.executable) ?? FALLBACK_VENDOR[role];
    if (vendor === "claude") {
      await this.adapters.preflightClaude(settings);
      return;
    }
    await this.adapters.preflightCodex(settings);
  }

  /**
   * Claude phases run with `--permission-mode dontAsk`, so a tool the loaded
   * settings never granted is refused with no way to approve it mid-run. The
   * refusal costs a whole phase, and the model reports it as its own failure,
   * so the run stops on the one condition that was decidable before it started.
   */
  private async assertClaudePermissions(
    config: OrchestratorConfig
  ): Promise<void> {
    const demand = claudePermissionDemand(config);
    if (!claudePermissionDemanded(demand)) {
      return;
    }
    let settingSources: string | null;
    try {
      const resolved = await resolveClaudeInvocationScope(
        config.claudeEnvironment
      );
      settingSources = resolved.scope.settingSources;
    } catch {
      // An unverifiable environment is the environment check's failure to
      // report, and it surfaces on the first phase either way.
      return;
    }
    const audit = await inspectClaudePermissions({
      repoRoot: this.repoRoot,
      demand,
      settingSources
    });
    for (const advisory of audit.advisories) {
      this.info(`Claude permissions: ${advisory}`);
    }
    if (audit.blocking.length === 0) {
      return;
    }
    throw new BanzaiError(
      "CLAUDE_PERMISSIONS_UNAVAILABLE",
      `${audit.blocking.join(" ")} Fix it before the run: ${claudePermissionRemediation(audit)}.`
    );
  }

  private async preflight(config: OrchestratorConfig): Promise<void> {
    validateNodeVersion();
    assertContractParity();
    const state = await this.store.requireActiveState();
    const route = state.workflowSelection?.workflow ?? null;
    await this.assertInstructionParity(
      config,
      MODEL_ROLES.flatMap((role) => {
        const phases = instructionPhasesForRole(role, route);
        return phases === null ? [] : [{ role, phases }];
      })
    );
    const environment = subscriptionOnlyEnvironment();
    await assertExecutable("git", this.repoRoot, environment);
    for (const usage of vendorUsage(config)) {
      await assertExecutable(usage.executable, this.repoRoot, environment);
    }
    for (const verification of flattenVerificationCommands(config)) {
      await assertExecutable(verification.command, this.repoRoot, environment);
    }
    // One check per vendor/executable pair, so roles sharing a vendor are not
    // checked twice while the implementer is no longer skipped entirely.
    const checked = new Set<string>();
    for (const role of MODEL_ROLES) {
      const settings = config.models[role];
      const vendor = vendorFor(settings.executable) ?? FALLBACK_VENDOR[role];
      const key = `${vendor}:${settings.executable}`;
      if (checked.has(key)) {
        continue;
      }
      checked.add(key);
      await this.preflightVendor(role, settings);
    }
    await this.assertClaudePermissions(config);
  }

  private async validateApproval(state: RunState): Promise<void> {
    if (state.planApproval === null) {
      throw new BanzaiError(
        "PLAN_NOT_APPROVED",
        "Implementation requires explicit plan approval."
      );
    }
    const bundle = await digestArtifactBundle(
      this.repoRoot,
      state.planApproval.paths
    );
    if (bundle.digest !== state.planApproval.digest) {
      blockState(
        state,
        "Approved planning artifacts changed. Restore the approved bundle (banzai restore) and retry, or cancel the run and approve a revised plan in a new run."
      );
      await this.store.writeState(state);
      await this.store.appendEvent(state.runId, "approval.invalidated", {
        previousDigest: state.planApproval.digest,
        currentDigest: bundle.digest
      });
      throw new BanzaiError(
        "APPROVAL_INVALIDATED",
        "Approved planning artifacts changed. Run `banzai restore` to write back the approved bytes and then `banzai retry`, or cancel the run and approve a revised plan in a new run."
      );
    }
  }

  private completionPlanPath(state: RunState): string {
    const planPath = state.planArtifacts?.plan ?? null;
    if (planPath === null) {
      throw new PlanTaskCompletionError(
        "approved_plan_invalid",
        "Strict completion validation cannot identify the approved plan."
      );
    }
    return planPath;
  }

  private async approvedTaskIds(state: RunState): Promise<string[]> {
    const plan = await readFile(
      path.join(this.repoRoot, this.completionPlanPath(state)),
      "utf8"
    );
    this.validateRunnerControlTasks(state, plan);
    return parseApprovedPlanTaskIds(plan);
  }

  /**
   * The persisted failure message of a rejected completion source attempt, so
   * a repair prompt names the exact offending field instead of only a
   * violation class. A missing or unreadable record degrades to null; the
   * repair stays available without it.
   */
  private async completionRepairDiagnostic(
    state: RunState,
    sourceAttemptId: string,
    sourceAttemptKind: "implementation" | "fix" = "implementation"
  ): Promise<string | null> {
    try {
      const record = await this.store.readRunAttempt(state.runId, {
        id: sourceAttemptId,
        kind: sourceAttemptKind,
        mutable: true
      });
      return record.error;
    } catch {
      return null;
    }
  }

  private async validateImplementationCompletion(
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
      repoRoot: this.repoRoot,
      artifactBinding: state.artifactBinding,
      sourceAttemptId: attempt.id,
      result,
      planPath: this.completionPlanPath(state),
      approval: state.planApproval,
      baseline: state.baseline
    });
  }

  private completionInvalidCheckpoint(
    sourceAttemptId: string,
    error: PlanTaskCompletionError,
    sourceAttemptKind: "implementation" | "fix" = "implementation"
  ): NonNullable<RunState["planTaskCompletion"]> {
    return {
      schemaVersion: 1,
      status: "invalid",
      sourceAttemptId,
      sourceAttemptKind,
      errorCode: "PLAN_TASK_COMPLETION_INVALID",
      violation: error.violation,
      taskId: error.taskId,
      recordedAt: now()
    };
  }

  private async recordCompletionFailure(
    state: RunState,
    record: AttemptRecord,
    adapterResult: AdapterResult<PhaseResult>,
    error: PlanTaskCompletionError,
    context: SessionContext
  ): Promise<RunState> {
    await this.writeAttemptOutput(
      state,
      record,
      adapterResult.stdout,
      adapterResult.stderr
    );
    record.status = "failed";
    record.completedAt = now();
    record.result = adapterResult.result;
    record.sessionId = adapterResult.sessionId;
    record.durationMs =
      Date.parse(record.completedAt) - Date.parse(record.startedAt);
    record.usage = adapterResult.usage;
    record.error = `[PLAN_TASK_COMPLETION_INVALID] ${error.message}`;
    record.failureCode = "PLAN_TASK_COMPLETION_INVALID";
    await this.store.writeRunAttempt(state.runId, record);
    const current = await this.store.readState(state.runId);
    if (current.status === "cancelled") {
      return current;
    }
    state.sessions.implementer = sessionBinding(
      adapterResult.sessionId ?? record.resumeSessionId ?? null,
      { ...context, role: "implementer" }
    );
    state.planTaskCompletion = this.completionInvalidCheckpoint(
      record.attempt.id,
      error,
      record.attempt.kind === "fix" ? "fix" : "implementation"
    );
    state.activeProcess = null;
    // The attempt ran a full model turn before its ledger was rejected, so the
    // same rule as every other failure applies: failed usage counts toward
    // consumption but never toward completion. Omitting it here made a blocked
    // run report the token total it had before the phase ever started.
    if (record.usage !== null) {
      state.metrics.usage.inputTokens += record.usage.inputTokens;
      state.metrics.usage.cachedInputTokens += record.usage.cachedInputTokens;
      state.metrics.usage.outputTokens += record.usage.outputTokens;
      if (record.usage.costUsd !== null) {
        state.metrics.usage.costUsd =
          (state.metrics.usage.costUsd ?? 0) + record.usage.costUsd;
      }
    }
    blockState(state, `[PLAN_TASK_COMPLETION_INVALID] ${error.message}`);
    await this.store.writeState(state);
    await this.store.appendEvent(state.runId, "attempt.failed", {
      attemptId: record.attempt.id,
      kind: record.attempt.kind,
      error: `[PLAN_TASK_COMPLETION_INVALID] ${error.message}`
    });
    await this.store.appendEvent(
      state.runId,
      "plan_task_completion.validation_failed",
      {
        attemptId: record.attempt.id,
        code: "PLAN_TASK_COMPLETION_INVALID",
        violation: error.violation,
        taskId: error.taskId
      }
    );
    return state;
  }

  private async revalidateTaskCompletion(
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
      return await this.revalidatePublishedCompletion(state, checkpoint);
    }
    const attempt = {
      id: checkpoint.sourceAttemptId,
      kind: checkpoint.sourceAttemptKind ?? ("implementation" as const),
      mutable: true
    };
    const record = await this.store
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
      repoRoot: this.repoRoot,
      artifactBinding: state.artifactBinding,
      sourceAttemptId: checkpoint.sourceAttemptId,
      result,
      planPath: this.completionPlanPath(state),
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
        await this.store.writeState(state);
      }
    }
    return validated;
  }

  private async blockForCompletionFailure(
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
    state.planTaskCompletion = this.completionInvalidCheckpoint(
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
    await this.store.writeState(state);
    await this.store.appendEvent(
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

  private validateWorkflowSelection(
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

  private async validateBaseCommit(state: RunState): Promise<void> {
    if (state.artifactBinding)
      await inspectBoundWork(this.repoRoot, state.artifactBinding);
    const current = await currentCommit(this.repoRoot);
    if (current !== state.baseCommit) {
      blockState(
        state,
        "The checkout HEAD changed during the run. Start a new run from the intended branch and commit."
      );
      await this.store.writeState(state);
      throw new BanzaiError(
        "BASE_COMMIT_CHANGED",
        "The checkout HEAD changed during the run."
      );
    }
  }

  private newAttempt(
    state: RunState,
    kind: AttemptReference["kind"],
    mutable: boolean
  ): AttemptReference {
    return {
      id: `${kind}-${state.reviewIteration + 1}-${randomUUID().slice(0, 8)}`,
      kind,
      mutable
    };
  }

  private async beginAttempt(
    state: RunState,
    attempt: AttemptReference,
    policy: AttemptPolicy
  ): Promise<AttemptRecord> {
    const record: AttemptRecord = {
      schemaVersion:
        policy.completion === undefined
          ? MODEL_ATTEMPT_SCHEMA_VERSION
          : STRICT_MODEL_ATTEMPT_SCHEMA_VERSION,
      attempt,
      status: "started",
      startedAt: now(),
      completedAt: null,
      interruptedAt: null,
      recoveryOf: null,
      recoveryAuthorizationId: null,
      result: null,
      sessionId: null,
      rawStdoutPath: null,
      rawStderrPath: null,
      durationMs: null,
      usage: null,
      error: null,
      failureCode: null,
      reviewCandidate: null,
      sessionMode: policy.sessionMode,
      reviewMode: policy.reviewMode ?? null,
      rotationReason: policy.rotationReason ?? null,
      resumeSessionId: policy.resumeSessionId,
      sessionContext: policy.sessionContext,
      ...(policy.completion === undefined
        ? {}
        : {
            completionProtocol: COMPLETION_PROTOCOL,
            retryOf: policy.completion.retryOf,
            envelope: null,
            completionDiagnostic: null
          })
    };
    if (policy.completion?.retryOf != null) {
      // Deterministic successor identity: an interrupted creation of the same
      // linked evidence-repair successor reuses its record instead of minting
      // a second one under the same predecessor and authority.
      const existing = await this.store.readRunAttemptIfExists(
        state.runId,
        attempt
      );
      if (existing !== null) {
        if (
          existing.status !== "started" ||
          existing.result !== null ||
          existing.retryOf !== policy.completion.retryOf ||
          existing.completionProtocol !== COMPLETION_PROTOCOL ||
          JSON.stringify(existing.sessionContext) !==
            JSON.stringify(policy.sessionContext)
        )
          throw new BanzaiError(
            "COMPLETION_RETRY_CONFLICT",
            "A linked evidence-repair successor already exists with different evidence."
          );
        state.activeAttempt = attempt;
        await this.store.writeState(state);
        return existing;
      }
    }
    if (attempt.kind === "selection") {
      state.metrics.attempts.selection =
        (state.metrics.attempts.selection ?? 0) + 1;
    } else {
      state.metrics.attempts[attempt.kind] += 1;
    }
    state.metrics.sessions[policy.sessionMode] += 1;
    if (policy.reviewMode !== undefined) {
      state.metrics.reviews[policy.reviewMode] += 1;
      if (
        policy.rotationReason !== null &&
        policy.rotationReason !== "primary-review"
      ) {
        state.metrics.reviews.rotations += 1;
      }
    }
    state.activeAttempt = attempt;
    await this.store.writeState(state);
    await this.store.writeRunAttempt(state.runId, record);
    const timingEvent = await this.store.appendEvent(
      state.runId,
      "attempt.started",
      {
        attemptId: attempt.id,
        kind: attempt.kind,
        mutable: attempt.mutable,
        sessionMode: policy.sessionMode,
        reviewMode: policy.reviewMode ?? null,
        rotationReason: policy.rotationReason ?? null
      }
    );
    await this.observeHumanTime(
      state,
      "checkpoint",
      "attempt.started",
      timingEvent.at,
      attempt.id
    );
    return record;
  }

  private recoveryAttempt(
    authorization: RecoveryAuthorization
  ): AttemptReference {
    return {
      id: `${authorization.phase}-recovery-${authorization.authorizationId.replace(/^recovery-/u, "")}`,
      kind: authorization.phase,
      mutable: true
    };
  }

  private async beginRecoveryAttempt(
    state: RunState,
    authorization: RecoveryAuthorization,
    policy: AttemptPolicy
  ): Promise<AttemptRecord> {
    const attempt = this.recoveryAttempt(authorization);
    let record = await this.store.readRunAttemptIfExists(state.runId, attempt);
    if (record === null) {
      record = {
        schemaVersion:
          policy.completion === undefined
            ? MODEL_ATTEMPT_SCHEMA_VERSION
            : STRICT_MODEL_ATTEMPT_SCHEMA_VERSION,
        attempt,
        status: "started",
        startedAt: now(),
        completedAt: null,
        interruptedAt: null,
        recoveryOf: authorization.attempt.id,
        recoveryAuthorizationId: authorization.authorizationId,
        result: null,
        sessionId: null,
        rawStdoutPath: null,
        rawStderrPath: null,
        durationMs: null,
        usage: null,
        error: null,
        failureCode: null,
        reviewCandidate: null,
        sessionMode: policy.sessionMode,
        reviewMode: policy.reviewMode ?? null,
        rotationReason: policy.rotationReason ?? null,
        resumeSessionId: policy.resumeSessionId,
        sessionContext: policy.sessionContext,
        ...(policy.completion === undefined
          ? {}
          : {
              completionProtocol: COMPLETION_PROTOCOL,
              retryOf: null,
              envelope: null,
              completionDiagnostic: null
            })
      };
      await this.store.writeRunAttempt(state.runId, record);
    } else if (
      record.status !== "started" ||
      record.result !== null ||
      (policy.completion !== undefined) !==
        this.completionProtocolAttempt(record) ||
      record.recoveryOf !== authorization.attempt.id ||
      record.recoveryAuthorizationId !== authorization.authorizationId ||
      record.attempt.kind !== authorization.phase ||
      record.sessionMode !== policy.sessionMode ||
      record.resumeSessionId !== policy.resumeSessionId ||
      JSON.stringify(record.sessionContext) !==
        JSON.stringify(policy.sessionContext)
    ) {
      throw new BanzaiError(
        "RECOVERY_ATTEMPT_CONFLICT",
        "Persisted recovery attempt conflicts with its authorization."
      );
    }
    if (
      state.recovery?.sourceAttemptId !== authorization.attempt.id ||
      state.recovery.authorizationId !== authorization.authorizationId ||
      state.recovery.recoveryAttemptId !== null ||
      (state.recovery.stage !== "source_interrupted" &&
        state.recovery.stage !== "source_preserved")
    ) {
      throw new BanzaiError(
        "RECOVERY_STATE_CHANGED",
        "Recovery state changed before the new attempt could be linked."
      );
    }
    state.metrics.attempts[attempt.kind] += 1;
    state.metrics.sessions[policy.sessionMode] += 1;
    state.activeAttempt = attempt;
    state.recovery = {
      authorizationId: authorization.authorizationId,
      sourceAttemptId: authorization.attempt.id,
      recoveryAttemptId: attempt.id,
      stage: "attempt_started"
    };
    await this.store.writeState(state);
    const timingEvent = await this.store.appendEvent(
      state.runId,
      "attempt.recovery_started",
      {
        sourceAttemptId: authorization.attempt.id,
        attemptId: attempt.id,
        kind: attempt.kind
      }
    );
    await this.observeHumanTime(
      state,
      "checkpoint",
      "attempt.recovery_started",
      timingEvent.at,
      attempt.id
    );
    return record;
  }

  private async processStarted(
    state: RunState,
    attempt: Pick<AttemptReference, "kind"> | { kind: "verification" },
    pid: number
  ): Promise<void> {
    state.activeProcess = { pid, kind: attempt.kind, startedAt: now() };
    try {
      await this.store.writeState(state);
    } catch (error) {
      if (error instanceof TerminalRunStateError) terminateProcessGroup(pid);
      throw error;
    }
  }

  private attemptScopeDigest(
    state: RunState,
    attempt: AttemptReference
  ): string | null {
    if (attempt.kind !== "fix" && !state.artifactBinding) {
      return null;
    }
    const acceptedFindingIds =
      state.triage?.items
        .filter((item) => item.disposition === "accepted")
        .map((item) => item.findingId)
        .sort() ?? [];
    return digestCanonicalJson(
      state.artifactBinding
        ? {
            version: 2,
            artifactBindingDigest: state.artifactBinding.sha256,
            phase: attempt.kind,
            acceptedFindingIds: attempt.kind === "fix" ? acceptedFindingIds : []
          }
        : { version: 1, acceptedFindingIds }
    );
  }

  private terminalCheckpointWriter<
    T extends TerminalCheckpointResult | PhaseResultEnvelope
  >(
    state: RunState,
    attempt: AttemptReference,
    settings: ModelSettings,
    policy: Pick<AttemptPolicy, "sessionMode" | "sessionContext">,
    completion = false
  ): (terminal: AdapterTerminalSuccess<T>) => Promise<void> {
    return async (terminal) => {
      const current = await this.store.readState(state.runId);
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
      await this.validateSavedArtifactScope(current, attempt);
      if (
        attempt.kind === "plan" ||
        attempt.kind === "implementation" ||
        attempt.kind === "fix"
      )
        this.validateArtifactRoleReferences(
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
        const envelope = this.completionEnvelopeOf(
          terminal.result as PhaseResult | PhaseResultEnvelope
        );
        const observed = await this.observeCompletionInputs(
          current,
          envelope.artifacts
        );
        const checkpoint: Omit<TerminalAttemptCheckpointV2, "integrityDigest"> =
          {
            schema: TERMINAL_CHECKPOINT_SCHEMA_V2,
            schemaVersion: TERMINAL_CHECKPOINT_SCHEMA_VERSION_V2,
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
            resultContract: "phase-result/v3",
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
            scopeDigest: this.attemptScopeDigest(current, attempt)
          };
        await this.store.writeTerminalCheckpoint(current.runId, {
          ...checkpoint,
          integrityDigest: terminalCheckpointIntegrity(checkpoint)
        });
        await this.store.appendEvent(
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
        schema: TERMINAL_CHECKPOINT_SCHEMA,
        schemaVersion: TERMINAL_CHECKPOINT_SCHEMA_VERSION,
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
        resultContract: terminalResultContract(attempt.kind),
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
        scopeDigest: this.attemptScopeDigest(current, attempt)
      };
      const persisted: TerminalAttemptCheckpoint = {
        ...checkpoint,
        integrityDigest: terminalCheckpointIntegrity(checkpoint)
      };
      await this.store.writeTerminalCheckpoint(current.runId, persisted);
      await this.store.appendEvent(
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

  private async completeAttempt<
    T extends WorkflowSelectionResult | PhaseResult | ReviewResult
  >(
    state: RunState,
    record: AttemptRecord,
    adapterResult: AdapterResult<T>
  ): Promise<boolean> {
    if (record.result === null) {
      await this.persistAdapterResult(state, record, adapterResult);
    }
    record.status = "completed";
    record.completedAt = now();
    record.durationMs =
      Date.parse(record.completedAt) - Date.parse(record.startedAt);
    await this.store.writeRunAttempt(state.runId, record);
    const current = await this.store.readState(state.runId);
    if (current.status === "cancelled") {
      return false;
    }
    this.accountCompletedAttempt(state, record);
    state.activeProcess = null;
    await this.store.writeState(state);
    return true;
  }

  private async persistAdapterResult<
    T extends WorkflowSelectionResult | PhaseResult | ReviewResult
  >(
    state: RunState,
    record: AttemptRecord,
    adapterResult: AdapterResult<T>
  ): Promise<void> {
    await this.writeAttemptOutput(
      state,
      record,
      adapterResult.stdout,
      adapterResult.stderr
    );
    record.usage = adapterResult.usage;
    if (
      record.planningContext !== undefined &&
      record.sessionId !== null &&
      adapterResult.sessionId !== null &&
      record.sessionId !== adapterResult.sessionId
    ) {
      throw new BanzaiError(
        "SESSION_ID_CONFLICT",
        "The planning result conflicts with its announced session identity."
      );
    }
    record.result = adapterResult.result;
    record.sessionId = adapterResult.sessionId ?? record.sessionId;
    record.durationMs = Date.now() - Date.parse(record.startedAt);
    await this.store.writeRunAttempt(state.runId, record);
  }

  private async writeAttemptOutput(
    state: RunState,
    record: AttemptRecord,
    stdout: string,
    stderr: string
  ): Promise<void> {
    const stdoutPath = path.relative(
      this.store.runDirectory(state.runId),
      await this.store.writeText(
        state.runId,
        `attempts/${record.attempt.id}.stdout.log`,
        redactSensitiveText(stdout)
      )
    );
    const stderrPath = path.relative(
      this.store.runDirectory(state.runId),
      await this.store.writeText(
        state.runId,
        `attempts/${record.attempt.id}.stderr.log`,
        redactSensitiveText(stderr)
      )
    );
    record.rawStdoutPath = stdoutPath;
    record.rawStderrPath = stderrPath;
  }

  private async failAttempt(
    state: RunState,
    record: AttemptRecord,
    error: unknown
  ): Promise<RunState> {
    if (error instanceof TerminalRunStateError) return error.state;
    const completionError =
      (record.attempt.kind === "implementation" ||
        record.attempt.kind === "fix") &&
      (state.workflowSelection?.workflow ?? "strict") === "strict" &&
      error instanceof BanzaiError &&
      ["PLAN_TASK_COMPLETION_INVALID", "PHASE_RESULT_SCHEMA_MISMATCH"].includes(
        error.code
      )
        ? error instanceof PlanTaskCompletionError
          ? error
          : new PlanTaskCompletionError("source_attempt_invalid", error.message)
        : null;
    record.status = "failed";
    record.completedAt = now();
    record.durationMs =
      Date.parse(record.completedAt) - Date.parse(record.startedAt);
    record.error =
      completionError === null
        ? errorMessage(error)
        : `[PLAN_TASK_COMPLETION_INVALID] ${completionError.message}`;
    record.failureCode =
      completionError === null
        ? error instanceof BanzaiError
          ? error.code
          : null
        : "PLAN_TASK_COMPLETION_INVALID";
    const failureCause = classifyModelFailure(error);
    record.failureCause = failureCause;
    if (
      error instanceof ProcessExitError &&
      record.rawStdoutPath === null &&
      record.rawStderrPath === null
    ) {
      await this.writeAttemptOutput(state, record, error.stdout, error.stderr);
    }
    // A process that failed still spent what its own stream reports. Dropping it
    // makes every later cost measurement a fiction.
    if (record.usage === null && error instanceof ProcessExitError) {
      record.usage = error.usage;
    }
    await this.store.writeRunAttempt(state.runId, record);
    const current = await this.store.readState(state.runId);
    if (current.status === "cancelled") {
      return current;
    }
    state.activeProcess = null;
    // Failed usage counts toward consumption but never toward completion:
    // `completedAttemptIds` stays untouched, so no verdict, review, or finding
    // metric can be derived from it.
    this.accountAttemptUsage(state, record);
    if (record.attempt.kind === "review") {
      if (
        error instanceof BanzaiError &&
        error.code === "ARTIFACT_PHASE_SCOPE_INVALID"
      ) {
        state.reviewIteration = state.latestReview?.iteration ?? 0;
        state.pendingReviewRotationReason = "unreliable-review";
      } else if (INTEGRITY_NEUTRAL_FAILURE_CAUSES.has(failureCause)) {
        // `executeReview` advanced the reviewed-workspace digest before starting
        // the process. Leaving it advanced would make the retry fail the
        // policy's `unreliable-review` check and rotate anyway, so preserving
        // continuity means putting it back to the last review that succeeded.
        if (state.latestReview !== null) {
          state.workspaceDigest = state.latestReview.workspaceDigest;
        }
      } else {
        state.pendingReviewRotationReason = "previous-review-failed";
      }
    }
    if (completionError !== null) {
      state.planTaskCompletion = this.completionInvalidCheckpoint(
        record.attempt.id,
        completionError,
        record.attempt.kind === "fix" ? "fix" : "implementation"
      );
    }
    blockState(
      state,
      completionError === null
        ? `${record.attempt.kind} failed: ${errorMessage(error)}`
        : `[PLAN_TASK_COMPLETION_INVALID] ${completionError.message}`
    );
    await this.store.writeState(state);
    await this.store.appendEvent(state.runId, "attempt.failed", {
      attemptId: record.attempt.id,
      kind: record.attempt.kind,
      cause: failureCause,
      error: errorMessage(error)
    });
    if (completionError !== null) {
      await this.store.appendEvent(
        state.runId,
        "plan_task_completion.validation_failed",
        {
          attemptId: record.attempt.id,
          code: "PLAN_TASK_COMPLETION_INVALID",
          violation: completionError.violation,
          taskId: completionError.taskId
        }
      );
    }
    return state;
  }

  private contextAuthority(
    state: RunState,
    config: OrchestratorConfig,
    phase: AttemptReference["kind"]
  ): ContextAuthorityEntry[] {
    const entries: ContextAuthorityEntry[] = [
      { class: "project_instructions", count: 1 },
      { class: "project_manifest", count: 1 }
    ];
    const approved = state.planApproval?.paths ?? [];
    const count = (pattern: RegExp): number =>
      approved.filter((item) => pattern.test(item)).length;
    const descriptionCount = count(/\/description\.md$/u);
    const adrCount = count(/\/decisions\/[^/]+\.md$/u);
    const planCount = count(/\/plan\.md$/u);
    if (descriptionCount > 0) {
      entries.push({ class: "feature_description", count: descriptionCount });
    }
    if (adrCount > 0) {
      entries.push({ class: "architecture_decision", count: adrCount });
    }
    if (planCount > 0) {
      entries.push({ class: "development_plan", count: planCount });
    }
    if (phase === "review") {
      entries.push({ class: "implementation_report", count: 1 });
      entries.push({ class: "test_report", count: 1 });
    }
    if (phase === "fix" && state.latestReview !== null) {
      entries.push({ class: "review_artifact", count: 1 });
    }
    const decisions = state.humanDecisions?.length ?? 0;
    if (decisions > 0) {
      entries.push({ class: "human_decision", count: decisions });
    }
    if (config.verification.profiles.length > 0) {
      entries.push({
        class: "verification_profile",
        count: config.verification.profiles.length
      });
    }
    return entries;
  }

  private artifactWritePaths(
    state: RunState,
    phase: AttemptReference["kind"]
  ): string[] {
    const roles = state.artifactBinding?.binding.artifacts;
    if (roles === undefined) return [];
    if (phase === "plan")
      return [roles.description, roles.plan].filter(
        (item): item is string => item !== undefined
      );
    if (phase !== "implementation" && phase !== "fix") return [];
    const workflow = state.workflowSelection?.workflow ?? "strict";
    return (
      workflow === "strict"
        ? [
            roles.implementationReport,
            roles.testReport,
            ...(phase === "fix" ? [roles.changeReport] : [])
          ]
        : workflow === "feature"
          ? [roles.work]
          : [roles.changeReport]
    ).filter((item): item is string => item !== undefined);
  }

  private artifactInstructions(
    state: RunState,
    phase: AttemptReference["kind"]
  ): string {
    const workflow = state.workflowSelection?.workflow ?? "strict";
    const bound = state.artifactBinding;
    const roles =
      bound === undefined
        ? artifactRoles(state.runId, state.slug, "workflow", "legacy")
        : bound.binding.artifacts;
    if (bound === undefined) {
      requireSlug(state.slug);
      for (const role of [
        "description",
        "plan",
        "implementationReport",
        "testReport"
      ] as const) {
        const recorded = state.planArtifacts?.[role];
        if (recorded) roles[role] = recorded;
      }
      if (state.planTaskCompletion?.status === "valid") {
        roles.implementationReport =
          state.planTaskCompletion.implementationReport.path;
        roles.testReport = state.planTaskCompletion.testReport.path;
      }
    }
    const legacyOutputs =
      phase === "plan"
        ? [roles.description, roles.plan]
        : phase === "implementation" || phase === "fix"
          ? workflow === "strict"
            ? [
                roles.implementationReport,
                roles.testReport,
                ...(phase === "fix" ? [roles.changeReport] : [])
              ]
            : workflow === "feature"
              ? [roles.work]
              : [roles.changeReport]
          : [];
    const writes =
      bound === undefined
        ? legacyOutputs.filter((item): item is string => item !== undefined)
        : this.artifactWritePaths(state, phase);
    return [
      bound === undefined
        ? "Legacy artifact surface (no persisted work binding):"
        : "Artifact storage authority (run state v4):",
      JSON.stringify(
        bound ?? { runId: state.runId, slug: state.slug, artifacts: roles },
        null,
        2
      ),
      "Use these exact artifact role paths. Public ADRs, product documentation and the project manifest keep their existing repository paths.",
      bound === undefined
        ? `Required work output paths in this legacy phase: ${JSON.stringify(writes)}. Existing legacy scope and approved-byte validation remain authoritative; these destinations create no new binding or permission.`
        : `Artifact writes allowed in this phase: ${JSON.stringify(writes)}.`,
      phase === "review" || phase === "selection"
        ? "Model artifact write set: []. Every role is read-only, including canonical reviews and attempt-owned candidates."
        : "Other artifact roles are read-only; their presence does not grant writes.",
      "Read ignored required evidence directly. Do not initialize, create or rebind work, invoke the standalone artifact helper, acquire standalone claims, or modify declarations, runner state, approvals or another work item.",
      workflow === "feature"
        ? "For lite feature work, artifacts.implementationReport may reference the work role; do not create a second report."
        : workflow === "quick-fix"
          ? "For quick-fix, artifacts.implementationReport may reference the changeReport only when the existing report trigger applies; otherwise keep it null."
          : ""
    ]
      .filter((part) => part.length > 0)
      .join("\n");
  }

  private async checkArtifactPhaseScope(
    state: RunState,
    phase: AttemptReference["kind"],
    before: Awaited<ReturnType<typeof workspaceSnapshot>>
  ): Promise<void> {
    const bound = state.artifactBinding;
    if (bound === undefined) return;
    const after = await workspaceSnapshot(this.repoRoot, {
      baseline: state.baseline,
      artifactBinding: bound,
      excludedPaths:
        phase === "review"
          ? [reviewArtifactPath(state.slug, state.reviewIteration, bound)]
          : []
    });
    const allowed = new Set(this.artifactWritePaths(state, phase));
    for (const change of workspaceChanges(before, after)) {
      const candidate = change.path;
      const privatePath =
        candidate === ".banzai" || candidate.startsWith(".banzai/");
      const legacyWork =
        /^documentation\/(?:features|development-plans|changes)\//.test(
          candidate
        );
      const prohibited =
        phase === "selection" ||
        phase === "review" ||
        (privatePath && !allowed.has(candidate)) ||
        (legacyWork && !allowed.has(candidate)) ||
        (phase === "plan" &&
          !allowed.has(candidate) &&
          !isDocumentationPath(candidate));
      if (prohibited)
        throw new BanzaiError(
          "ARTIFACT_PHASE_SCOPE_INVALID",
          `Phase ${phase} changed an unauthorized artifact or source path: ${candidate}`
        );
    }
  }

  private async validateSavedArtifactScope(
    state: RunState,
    attempt: AttemptReference
  ): Promise<void> {
    if (!state.artifactBinding) return;
    const bytes = await readArtifactBytes(
      this.repoRoot,
      `.banzai/runs/${state.runId}/attempts/${attempt.id}.artifact-workspace.json`,
      { limit: 2 * 1024 * 1024 }
    );
    const before = JSON.parse(
      bytes?.toString("utf8") ?? "null"
    ) as WorkspaceSnapshot | null;
    if (
      before?.schemaVersion !== 2 ||
      before.baseCommit !== state.baseCommit ||
      before.artifactBindingDigest !== state.artifactBinding.sha256 ||
      !Array.isArray(before.entries) ||
      before.digest !==
        createHash("sha256")
          .update(
            JSON.stringify({
              version: 2,
              baseCommit: before.baseCommit,
              artifactBindingDigest: before.artifactBindingDigest,
              entries: before.entries
            })
          )
          .digest("hex")
    )
      throw new BanzaiError(
        "ARTIFACT_RECOVERY_REQUIRED",
        "Original attempt artifact workspace evidence is missing or inconsistent."
      );
    await this.checkArtifactPhaseScope(state, attempt.kind, before);
  }

  private validateArtifactRoleReferences(
    state: RunState,
    result: Pick<PersistedPhaseResult, "artifacts">
  ): void {
    const roles = state.artifactBinding?.binding.artifacts;
    if (roles === undefined) return;
    for (const role of [
      "description",
      "plan",
      "implementationReport",
      "testReport"
    ] as const) {
      const reference = result.artifacts[role];
      if (reference === null) continue;
      const workflow = state.workflowSelection?.workflow ?? "strict";
      const expected =
        role === "implementationReport" && workflow !== "strict"
          ? workflow === "feature"
            ? roles.work
            : roles.changeReport
          : roles[role];
      if (reference !== expected)
        throw new BanzaiError(
          "ARTIFACT_PHASE_SCOPE_INVALID",
          `Result ${role} does not match the persisted work binding.`
        );
    }
    if (
      result.artifacts.adrs.some(
        (value) =>
          !/^documentation\/decisions\/[0-9]{4}-[a-z0-9-]+\.md$/.test(value)
      )
    ) {
      throw new BanzaiError(
        "ARTIFACT_PHASE_SCOPE_INVALID",
        "ADR references must retain their public decision paths."
      );
    }
  }

  private async invokeWithContext<T>(input: {
    state: RunState;
    attempt: AttemptReference;
    config: OrchestratorConfig;
    settings: ModelSettings;
    role: ModelRole;
    sessionMode: SessionMode;
    kind: "primary" | "review_artifact_repair";
    prompt: PromptEnvelope;
    outputIdentity: OutputContractIdentity;
    invoke: (
      outputContract: OutputContractEnvelope
    ) => Promise<AdapterResult<T>>;
  }): Promise<AdapterResult<T>> {
    const vendor =
      vendorFor(input.settings.executable) ?? FALLBACK_VENDOR[input.role];
    const outputContract = resolveOutputContract(vendor, input.outputIdentity);
    const runnerPayload = measureRunnerPayload(input.prompt, outputContract);
    const preCallValues: Partial<Record<ContextMetric, number>> = {
      runner_payload_bytes: runnerPayload.totalBytes
    };
    const preCallBudgets = evaluateContextBudgets(
      input.config.context,
      input.attempt.kind,
      input.role,
      preCallValues
    );
    const enforced = preCallBudgets.find(
      (evaluation) => evaluation.result === "enforced_exceeded"
    );
    const measuredAt = now();
    const started = await this.store.beginContextInvocation(
      input.state.runId,
      input.attempt,
      {
        kind: input.kind,
        workflow: input.state.workflowSelection?.workflow ?? "unselected",
        phase: input.attempt.kind,
        role: input.role,
        vendor,
        sessionMode: input.sessionMode,
        measuredAt,
        completedAt: enforced === undefined ? null : now(),
        outcome: enforced === undefined ? "pending" : "budget_exceeded",
        runnerPayload,
        authority: this.contextAuthority(
          input.state,
          input.config,
          input.attempt.kind
        ),
        sessionInventory: emptyContextInventory(),
        vendorUsage: emptyContextVendorUsage(),
        budgets: preCallBudgets
      }
    );
    if (enforced !== undefined) {
      throw new BanzaiError(
        "CONTEXT_BUDGET_EXCEEDED",
        `Context budget exceeded for phase ${input.attempt.kind}, role ${input.role}: measured ${runnerPayload.totalBytes} bytes, limit ${enforced.maximum}.`
      );
    }

    const finish = async (
      outcome: "completed" | "failed",
      evidence: {
        usage: ModelUsage | null;
        inventory?: SessionInventory | null;
        turnCount?: number | null;
      }
    ): Promise<void> => {
      const inventory = evidence.inventory ?? null;
      const values: Partial<Record<ContextMetric, number>> = {
        runner_payload_bytes: runnerPayload.totalBytes
      };
      if (evidence.usage !== null) {
        values.vendor_input_tokens = evidence.usage.inputTokens;
        values.vendor_cached_input_tokens = evidence.usage.cachedInputTokens;
        values.vendor_output_tokens = evidence.usage.outputTokens;
        if (evidence.usage.costUsd !== null) {
          values.vendor_cost_usd = evidence.usage.costUsd;
        }
      }
      if (evidence.turnCount !== null && evidence.turnCount !== undefined) {
        values.vendor_turns = evidence.turnCount;
      }
      if (inventory !== null) {
        values.session_tools = inventory.toolCount;
        if (inventory.mcpServerCount !== undefined) {
          values.session_mcp_servers = inventory.mcpServerCount;
        }
        if (inventory.skillCount !== undefined) {
          values.session_skills = inventory.skillCount;
        }
        if (inventory.commandCount !== undefined) {
          values.session_commands = inventory.commandCount;
        }
      }
      await this.store.finishContextInvocation(
        input.state.runId,
        input.attempt,
        started.ordinal,
        {
          completedAt: now(),
          outcome,
          sessionInventory:
            inventory === null
              ? emptyContextInventory()
              : {
                  toolCount: available(inventory.toolCount),
                  mcpServerCount:
                    inventory.mcpServerCount === undefined
                      ? unavailable()
                      : available(inventory.mcpServerCount),
                  skillCount:
                    inventory.skillCount === undefined
                      ? unavailable()
                      : available(inventory.skillCount),
                  commandCount:
                    inventory.commandCount === undefined
                      ? unavailable()
                      : available(inventory.commandCount),
                  digest: available(inventory.digest)
                },
          vendorUsage:
            evidence.usage === null
              ? {
                  ...emptyContextVendorUsage(),
                  turns:
                    evidence.turnCount === null ||
                    evidence.turnCount === undefined
                      ? unavailable()
                      : available(evidence.turnCount)
                }
              : {
                  inputTokens: available(evidence.usage.inputTokens),
                  cachedInputTokens: available(
                    evidence.usage.cachedInputTokens
                  ),
                  outputTokens: available(evidence.usage.outputTokens),
                  costUsd:
                    evidence.usage.costUsd === null
                      ? unavailable()
                      : available(evidence.usage.costUsd),
                  turns:
                    evidence.turnCount === null ||
                    evidence.turnCount === undefined
                      ? unavailable()
                      : available(evidence.turnCount)
                },
          budgets: evaluateContextBudgets(
            input.config.context,
            input.attempt.kind,
            input.role,
            values
          )
        }
      );
    };

    let result: AdapterResult<T> | undefined;
    try {
      const before =
        input.state.artifactBinding === undefined
          ? null
          : await workspaceSnapshot(this.repoRoot, {
              baseline: input.state.baseline,
              artifactBinding: input.state.artifactBinding,
              excludedPaths:
                input.attempt.kind === "review"
                  ? [
                      reviewArtifactPath(
                        input.state.slug,
                        input.state.reviewIteration,
                        input.state.artifactBinding
                      )
                    ]
                  : []
            });
      if (before !== null)
        await writeFile(
          path.join(
            this.store.runDirectory(input.state.runId),
            "attempts",
            `${input.attempt.id}.artifact-workspace.json`
          ),
          JSON.stringify(before) + "\n",
          { flag: "wx", mode: 0o600 }
        );
      result = await input.invoke(outputContract);
      if (before !== null)
        await this.checkArtifactPhaseScope(
          input.state,
          input.attempt.kind,
          before
        );
    } catch (error) {
      if (
        error instanceof TerminalRunStateError ||
        error instanceof ProjectSetupRequiredError ||
        error instanceof InstructionResourceMismatchError
      )
        throw error;
      await finish("failed", {
        usage:
          error instanceof ProcessExitError
            ? error.usage
            : (result?.usage ?? null),
        inventory:
          error instanceof ProcessExitError
            ? error.inventory
            : (result?.inventory ?? null),
        turnCount:
          error instanceof ProcessExitError
            ? error.turnCount
            : (result?.turnCount ?? null)
      });
      throw error;
    }
    await finish("completed", result);
    return result;
  }

  private async executeSelection(
    state: RunState,
    config: OrchestratorConfig,
    commitTransition?: () => Promise<void>
  ): Promise<RunState> {
    if (!(await hasRunnerWorkOwnership(this.repoRoot, state.artifactBinding)))
      return withRunnerWorkOwnership(this.repoRoot, state.artifactBinding, () =>
        this.executeSelection(state, config, commitTransition)
      );
    requireState(state, ["selecting"], "Workflow selection");
    await this.assertProjectGuidance();
    await this.beforeModelAttempt(commitTransition, {
      config,
      role: "planner",
      phase: "selection"
    });
    const attempt = this.newAttempt(state, "selection", false);
    const record = await this.beginAttempt(state, attempt, {
      sessionMode: "fresh",
      resumeSessionId: null,
      sessionContext: sessionContext("planner", config.models.planner)
    });
    try {
      await this.activity(
        "Workflow selection checks",
        `${config.models.planner.executable} subscription authentication`,
        async () => {
          await this.preflightVendor("planner", config.models.planner);
        }
      );
      // Resolved before the phase banner: the invocation scope carries the
      // run-level MCP whitelist, which reports on first resolution and would
      // otherwise print as if it were the phase's own first action.
      const environment = await this.invocationScope(state.runId, config);
      const prompt = insertPhaseInstructions(
        workflowSelectionPromptEnvelope(
          state.request,
          state.humanDecisions ?? []
        ),
        [this.artifactInstructions(state, "selection")]
      );
      const result = await this.activity(
        "Workflow selection",
        {
          detail: modelActivityDetail(
            config.models.planner,
            attempt,
            PHASE_PHASES.Selection
          ),
          descriptor: phaseDescriptor(
            config.models.planner,
            "fresh",
            PHASE_PHASES.Selection
          )
        },
        async () =>
          await this.invokeWithContext({
            state,
            attempt,
            config,
            settings: config.models.planner,
            role: "planner",
            sessionMode: "fresh",
            kind: "primary",
            prompt,
            outputIdentity: "workflow-selection/v1",
            invoke: async (outputContract) =>
              await this.adapters.runSelection({
                repoRoot: this.repoRoot,
                runDirectory: this.store.runDirectory(state.runId),
                attemptId: attempt.id,
                environment,
                prompt: prompt.rendered,
                promptEnvelope: prompt,
                outputContract,
                settings: config.models.planner,
                env: {
                  ...process.env,
                  // Runner mode plus no authorization digest makes the hook deny
                  // writes even if a vendor bypasses its read-only tool surface.
                  BANZAI_RUN_ID: state.runId
                },
                onStart: async (pid) => {
                  await this.processStarted(state, attempt, pid);
                },
                onProgress: (event) => {
                  this.modelProgress("Workflow selection", event);
                },
                onTerminalSuccess: this.terminalCheckpointWriter(
                  state,
                  attempt,
                  config.models.planner,
                  {
                    sessionMode: "fresh",
                    sessionContext: sessionContext(
                      "planner",
                      config.models.planner
                    )
                  }
                )
              })
          })
      );
      if (!(await this.completeAttempt(state, record, result))) {
        return await this.store.readState(state.runId);
      }
      try {
        return await this.applyWorkflowSelection(
          state,
          attempt,
          result.result,
          config
        );
      } catch (error) {
        if (
          error instanceof TerminalRunStateError ||
          error instanceof ProjectSetupRequiredError ||
          error instanceof InstructionResourceMismatchError
        )
          throw error;
        state.activeAttempt = null;
        blockState(state, errorMessage(error));
        await this.store.writeState(state);
        return state;
      }
    } catch (error) {
      if (
        error instanceof TerminalRunStateError ||
        error instanceof ProjectSetupRequiredError ||
        error instanceof InstructionResourceMismatchError
      )
        throw error;
      return await this.failAttempt(state, record, error);
    }
  }

  private async applyWorkflowSelection(
    state: RunState,
    attempt: AttemptReference,
    result: WorkflowSelectionResult,
    config: OrchestratorConfig
  ): Promise<RunState> {
    const workflow = effectiveWorkflow(result);
    const selectedAt = now();
    const fallbackReasons: string[] = [];
    if (result.recommendedWorkflow !== "strict" && workflow === "strict") {
      if (result.confidence !== "high") {
        fallbackReasons.push(`confidence=${result.confidence}`);
      }
      if (result.escalationTriggers.length > 0) {
        fallbackReasons.push(
          `triggers=${result.escalationTriggers.join(", ")}`
        );
      }
    }
    const reason =
      fallbackReasons.length > 0
        ? `${result.reason} Conservative strict fallback (${fallbackReasons.join("; ")}).`
        : result.reason;
    const selectionWithoutDigest = {
      ...result,
      workflow,
      reason,
      selectedAt,
      attemptId: attempt.id
    };
    const selection: WorkflowSelectionRecord = {
      ...selectionWithoutDigest,
      digest: workflowAuthorizationDigest({
        runId: state.runId,
        request: state.request,
        ...selectionWithoutDigest
      })
    };
    state.workflowSelection = selection;
    state.activeAttempt = null;
    transitionState(
      state,
      selection.workflow === "strict" ? "planning" : "implementing"
    );
    await this.store.writeState(state);
    await this.store.appendEvent(state.runId, "workflow.selected", {
      attemptId: attempt.id,
      recommendedWorkflow: selection.recommendedWorkflow,
      workflow: selection.workflow,
      confidence: selection.confidence,
      reason: selection.reason,
      escalationTriggers: selection.escalationTriggers,
      phases: workflowPhases(selection.workflow)
    });
    this.info(
      `ROUTE ${selection.workflow} - ${selection.reason} phases=${workflowPhases(selection.workflow).join(" -> ")}`
    );
    return selection.workflow === "strict"
      ? await this.executePlan(state, config)
      : await this.executeImplementation(state, config);
  }

  private async executePlan(
    state: RunState,
    config: OrchestratorConfig,
    retrySource: AttemptRecord | null = null,
    checkpointRejection: string | null = null,
    commitTransition?: () => Promise<void>
  ): Promise<RunState> {
    if (!(await hasRunnerWorkOwnership(this.repoRoot, state.artifactBinding)))
      return withRunnerWorkOwnership(this.repoRoot, state.artifactBinding, () =>
        this.executePlan(
          state,
          config,
          retrySource,
          checkpointRejection,
          commitTransition
        )
      );
    requireState(state, ["planning"], "Planning");
    await this.assertProjectGuidance();
    await this.activity(
      "Planning checks",
      `${config.models.planner.executable} subscription authentication`,
      async () => {
        await this.preflightVendor("planner", config.models.planner);
      }
    );
    const plannerBinding = sessionBindingMatches(
      state.sessions.planner,
      config.models.planner,
      "planner"
    )
      ? state.sessions.planner
      : null;
    const environment = await this.invocationScope(state.runId, config, false);
    let prompt = insertPhaseInstructions(
      planningPromptEnvelope(
        state.slug,
        state.request,
        state.adrDecisions,
        state.humanDecisions ?? []
      ),
      [
        this.artifactInstructions(state, "plan"),
        this.serenaGuidanceFor(environment, config.models.planner.executable)
      ]
    );
    const invocationDigest = digestCanonicalJson({
      environment,
      prompt: prompt.rendered,
      outputContract: resolveOutputContract(
        vendorFor(config.models.planner.executable) ?? "codex",
        "phase-result/v3"
      ).serialized
    });
    let resumeSessionId = plannerBinding?.id ?? null;
    if (retrySource !== null) {
      const context = retrySource.planningContext;
      const compatibleSession =
        retrySource.sessionContext !== undefined &&
        sessionBindingMatches(
          sessionBinding(retrySource.sessionId, retrySource.sessionContext),
          config.models.planner,
          "planner"
        );
      const supportedFailure =
        !TERMINAL_INTEGRITY_FAILURE_CODES.has(retrySource.failureCode ?? "") &&
        (RECOVERABLE_MUTABLE_FAILURE_CAUSES.has(
          retrySource.failureCause ?? "unclassified"
        ) ||
          PLANNING_REPAIR_FAILURE_CODES.has(retrySource.failureCode ?? ""));
      let reason =
        checkpointRejection !== null
          ? "saved terminal evidence was rejected"
          : !supportedFailure
            ? "the failure does not permit session reuse"
            : !compatibleSession
              ? "the saved session is missing or planner settings changed"
              : (context?.workspaceDigest ?? null) === null
                ? "saved planning context is unavailable"
                : context?.invocationDigest !== invocationDigest
                  ? "planning instructions or tool configuration changed"
                  : null;
      if (
        reason === null &&
        context !== undefined &&
        (await workspaceDigest(this.repoRoot, {
          artifactBinding: state.artifactBinding
        })) !== context.workspaceDigest
      ) {
        reason = "the workspace changed since the failed attempt";
      }
      resumeSessionId = reason === null ? retrySource.sessionId : null;
      prompt = planningRetryPromptEnvelope(
        prompt,
        retrySource,
        redactSensitiveText(
          [
            checkpointRejection,
            retrySource.error ?? "No failure diagnostic was recorded."
          ]
            .filter((message) => message !== null)
            .join("\n")
        ).slice(0, 2000),
        resumeSessionId === null ? "fresh" : "resumed"
      );
      this.info(
        resumeSessionId === null
          ? `Continuing planning from existing artifacts in a fresh session: ${reason}`
          : "Continuing planning in the saved planner session"
      );
    }
    await this.beforeModelAttempt(commitTransition, {
      config,
      role: "planner",
      phase: "planning"
    });
    await this.invocationScope(state.runId, config);
    const attempt = this.newAttempt(state, "plan", false);
    const record = await this.beginAttempt(state, attempt, {
      sessionMode: resumeSessionId === null ? "fresh" : "resumed",
      resumeSessionId,
      sessionContext: sessionContext("planner", config.models.planner)
    });
    record.planningContext = {
      invocationDigest,
      workspaceDigest: null,
      artifactPaths: [],
      retryOf: retrySource?.attempt.id ?? null
    };
    await this.store.writeRunAttempt(state.runId, record);
    try {
      const result = await this.activity(
        "Planning",
        {
          detail: modelActivityDetail(
            config.models.planner,
            attempt,
            PHASE_PHASES.Planning
          ),
          descriptor: phaseDescriptor(
            config.models.planner,
            resumeSessionId === null ? "fresh" : "resumed",
            PHASE_PHASES.Planning
          )
        },
        async () =>
          await this.invokeWithContext({
            state,
            attempt,
            config,
            settings: config.models.planner,
            role: "planner",
            sessionMode: resumeSessionId === null ? "fresh" : "resumed",
            kind: "primary",
            prompt,
            outputIdentity: "phase-result/v3",
            invoke: async (outputContract) =>
              await this.adapters.runPhase({
                repoRoot: this.repoRoot,
                runDirectory: this.store.runDirectory(state.runId),
                attemptId: attempt.id,
                environment,
                prompt: prompt.rendered,
                promptEnvelope: prompt,
                outputContract,
                settings: config.models.planner,
                resumeSessionId,
                env: state.artifactBinding
                  ? {
                      ...process.env,
                      BANZAI_RUN_ID: state.runId,
                      BANZAI_APPROVAL_DIGEST: "",
                      BANZAI_WORKFLOW_DIGEST: "",
                      BANZAI_REVIEW_ARTIFACT: ""
                    }
                  : process.env,
                onSessionStarted: async (sessionId) => {
                  const current = await this.store.readState(state.runId);
                  if (
                    current.status === "cancelled" ||
                    current.activeAttempt?.id !== attempt.id ||
                    (resumeSessionId !== null &&
                      resumeSessionId !== sessionId) ||
                    (record.sessionId !== null &&
                      record.sessionId !== sessionId)
                  ) {
                    throw new BanzaiError(
                      "SESSION_ID_CONFLICT",
                      "The planner session no longer matches the active attempt."
                    );
                  }
                  record.sessionId = sessionId;
                  await this.store.writeRunAttempt(state.runId, record);
                },
                onStart: async (pid) => {
                  await this.processStarted(state, attempt, pid);
                },
                onProgress: (event) => {
                  this.modelProgress("Planning", event);
                },
                onTerminalSuccess: this.terminalCheckpointWriter(
                  state,
                  attempt,
                  config.models.planner,
                  {
                    sessionMode: resumeSessionId === null ? "fresh" : "resumed",
                    sessionContext: sessionContext(
                      "planner",
                      config.models.planner
                    )
                  }
                )
              })
          })
      );
      const planResult = this.legacyPhaseResult(result.result);
      const applied = { ...result, result: planResult };
      await this.persistAdapterResult(state, record, applied);
      // A malformed Implementation Tasks heading fails the attempt here,
      // before it completes, so the failure stays retryable and the plan
      // stays the planner's to fix — never discovered post-approval on an
      // immutable bundle where only rerunning planning could correct it.
      await this.validatePlanningResult(state, planResult);
      if (!(await this.completeAttempt(state, record, applied))) {
        return await this.store.readState(state.runId);
      }
      try {
        return await this.applyPhaseResult(
          state,
          attempt,
          planResult,
          result.sessionId ?? resumeSessionId,
          sessionContext("planner", config.models.planner)
        );
      } catch (error) {
        if (
          error instanceof TerminalRunStateError ||
          error instanceof ProjectSetupRequiredError ||
          error instanceof InstructionResourceMismatchError
        )
          throw error;
        state.activeAttempt = null;
        blockState(state, errorMessage(error));
        await this.store.writeState(state);
        return state;
      }
    } catch (error) {
      if (
        error instanceof TerminalRunStateError ||
        error instanceof ProjectSetupRequiredError ||
        error instanceof InstructionResourceMismatchError
      )
        throw error;
      // Capture the stopped workspace, not the pre-planning tree: planning may
      // have written documentation. Missing evidence only disables cache reuse.
      try {
        const snapshot = await workspaceSnapshot(this.repoRoot, {
          artifactBinding: state.artifactBinding
        });
        record.planningContext.workspaceDigest =
          snapshot.baseCommit === state.baseCommit ? snapshot.digest : null;
        record.planningContext.artifactPaths = snapshot.entries
          .filter(
            (entry) =>
              entry.kind === "file" &&
              (entry.path.startsWith("documentation/") ||
                entry.path === "PROJECT_MANIFEST.md" ||
                this.artifactWritePaths(state, "plan").includes(entry.path)) &&
              entry.path.length <= 300
          )
          .map((entry) => entry.path)
          .slice(0, 128);
      } catch {
        record.planningContext.workspaceDigest = null;
      }
      return await this.failAttempt(state, record, error);
    }
  }

  private async executeImplementation(
    state: RunState,
    config: OrchestratorConfig,
    recovery: RecoveryAuthorization | null = null,
    commitTransition?: () => Promise<void>
  ): Promise<RunState> {
    if (!(await hasRunnerWorkOwnership(this.repoRoot, state.artifactBinding)))
      return withRunnerWorkOwnership(this.repoRoot, state.artifactBinding, () =>
        this.executeImplementation(state, config, recovery, commitTransition)
      );
    requireState(state, ["plan_approved", "implementing"], "Implementation");
    await this.assertProjectGuidance();
    const route = state.workflowSelection?.workflow ?? "strict";
    const lite = route !== "strict";
    if (recovery === null) {
      await this.activity(
        "Implementation checks",
        `base commit, ${lite ? "persisted workflow selection" : "approved plan bundle"}, and ${config.models.implementer.executable} subscription authentication`,
        async () => {
          await this.validateBaseCommit(state);
          if (lite) {
            this.validateWorkflowSelection(state);
          } else {
            await this.validateApproval(state);
          }
          await this.preflightVendor("implementer", config.models.implementer);
        }
      );
    }
    const implementerBinding = sessionBindingMatches(
      state.sessions.implementer,
      config.models.implementer,
      "implementer"
    )
      ? state.sessions.implementer
      : null;
    const plannerBinding =
      !lite &&
      sessionBindingMatches(
        state.sessions.planner,
        config.models.implementer,
        "planner"
      )
        ? state.sessions.planner
        : null;
    const resumeSessionId =
      implementerBinding?.id ?? plannerBinding?.id ?? null;
    await this.beforeModelAttempt(commitTransition, {
      config,
      role: "implementer",
      phase: lite ? route : "implementation"
    });
    if (state.status === "plan_approved") {
      transitionState(state, "implementing");
      await this.store.writeState(state);
    }
    // Every new strict implementation attempt, including evidence-repair and
    // recovery successors inside older runs, is created under the completion
    // protocol; lite routes keep their existing attempt protocol.
    const protocol = !lite;
    const retryOf =
      protocol && recovery === null
        ? await this.completionRetryPredecessor(state, "implementation")
        : null;
    const attempt =
      recovery === null
        ? retryOf === null
          ? this.newAttempt(state, "implementation", true)
          : this.repairAttempt(state, "implementation", retryOf)
        : this.recoveryAttempt(recovery);
    if (protocol)
      await this.transitionToCompletionState(state, {
        id: attempt.id,
        kind: "implementation",
        mutable: true
      });
    const policy: AttemptPolicy = {
      sessionMode: resumeSessionId === null ? "fresh" : "resumed",
      resumeSessionId,
      sessionContext: sessionContext("implementer", config.models.implementer),
      ...(protocol ? { completion: { retryOf } } : {})
    };
    const record =
      recovery === null
        ? await this.beginAttempt(state, attempt, policy)
        : await this.beginRecoveryAttempt(state, recovery, policy);
    try {
      const approval = state.planApproval;
      const selection = lite ? this.validateWorkflowSelection(state) : null;
      if (!lite && approval === null) {
        throw new BanzaiError("PLAN_NOT_APPROVED", "Plan approval is missing.");
      }
      const basePrompt =
        selection === null
          ? implementationPromptEnvelope(
              state.slug,
              approval?.digest ?? "",
              approval?.paths ?? [],
              config.verification.profiles,
              await this.approvedTaskIds(state),
              state.planTaskCompletion?.status === "invalid"
                ? {
                    sourceAttemptId: state.planTaskCompletion.sourceAttemptId,
                    violation: state.planTaskCompletion.violation,
                    taskId: state.planTaskCompletion.taskId,
                    diagnostic: await this.completionRepairDiagnostic(
                      state,
                      state.planTaskCompletion.sourceAttemptId,
                      state.planTaskCompletion.sourceAttemptKind ??
                        "implementation"
                    )
                  }
                : null,
              state.humanDecisions ?? []
            )
          : liteImplementationPromptEnvelope(
              state.slug,
              state.request,
              selection.workflow,
              selection.digest,
              config.verification.profiles,
              state.humanDecisions ?? []
            );
      const prompt =
        recovery === null
          ? basePrompt
          : recoveryPromptEnvelope(
              basePrompt,
              recovery.attempt.id,
              "implementation"
            );
      const authorizationEnvironment =
        selection === null
          ? { BANZAI_APPROVAL_DIGEST: approval?.digest ?? "" }
          : { BANZAI_WORKFLOW_DIGEST: selection.digest };
      // Resolved before the phase banner: the invocation scope carries the
      // run-level MCP whitelist, which reports on first resolution and would
      // otherwise print as if it were the phase's own first action.
      const environment = await this.invocationScope(state.runId, config);
      const invocationPrompt = insertPhaseInstructions(prompt, [
        this.artifactInstructions(state, attempt.kind),
        this.serenaGuidanceFor(
          environment,
          config.models.implementer.executable
        )
      ]);
      const result = await this.activity(
        "Implementation",
        {
          detail: modelActivityDetail(
            config.models.implementer,
            attempt,
            selection === null
              ? PHASE_PHASES.Implementation
              : workflowPhases(selection.workflow)
          ),
          descriptor: phaseDescriptor(
            config.models.implementer,
            resumeSessionId === null ? "fresh" : "resumed",
            selection === null
              ? PHASE_PHASES.Implementation
              : workflowPhases(selection.workflow)
          )
        },
        async () =>
          await this.invokeWithContext({
            state,
            attempt,
            config,
            settings: config.models.implementer,
            role: "implementer",
            sessionMode: resumeSessionId === null ? "fresh" : "resumed",
            kind: "primary",
            prompt: invocationPrompt,
            outputIdentity: "phase-result/v3",
            invoke: async (outputContract) =>
              await this.adapters.runPhase({
                repoRoot: this.repoRoot,
                runDirectory: this.store.runDirectory(state.runId),
                attemptId: attempt.id,
                environment,
                prompt: invocationPrompt.rendered,
                promptEnvelope: invocationPrompt,
                outputContract,
                settings: config.models.implementer,
                resumeSessionId,
                env: {
                  ...process.env,
                  BANZAI_RUN_ID: state.runId,
                  ...authorizationEnvironment
                },
                onStart: async (pid) => {
                  await this.processStarted(state, attempt, pid);
                },
                onProgress: (event) => {
                  this.modelProgress("Implementation", event);
                },
                onTerminalSuccess: this.terminalCheckpointWriter(
                  state,
                  attempt,
                  config.models.implementer,
                  {
                    sessionMode: resumeSessionId === null ? "fresh" : "resumed",
                    sessionContext: sessionContext(
                      "implementer",
                      config.models.implementer
                    )
                  },
                  protocol
                ),
                completionProtocol: protocol ? COMPLETION_PROTOCOL : undefined
              })
          })
      );
      if (result.result.phase !== "implementation") {
        throw new BanzaiError(
          "PHASE_RESULT_MISMATCH",
          `Attempt implementation returned phase ${result.result.phase}.`
        );
      }
      if (protocol) {
        return await this.applyCompletionResult(
          state,
          record,
          result,
          config,
          resumeSessionId,
          sessionContext("implementer", config.models.implementer)
        );
      }
      const liteResult = this.legacyPhaseResult(result.result);
      if (liteResult.taskCompletion !== null) {
        throw new BanzaiError(
          "PLAN_TASK_COMPLETION_INVALID",
          "Lite implementation must not return strict plan-task completion evidence."
        );
      }
      const applied = { ...result, result: liteResult };
      if (!(await this.completeAttempt(state, record, applied))) {
        return await this.store.readState(state.runId);
      }
      try {
        return await this.applyPhaseResult(
          state,
          attempt,
          liteResult,
          result.sessionId ?? resumeSessionId,
          sessionContext("implementer", config.models.implementer)
        );
      } catch (error) {
        if (
          error instanceof TerminalRunStateError ||
          error instanceof ProjectSetupRequiredError ||
          error instanceof InstructionResourceMismatchError
        )
          throw error;
        state.activeAttempt = null;
        blockState(state, errorMessage(error));
        await this.store.writeState(state);
        return state;
      }
    } catch (error) {
      if (
        error instanceof TerminalRunStateError ||
        error instanceof ProjectSetupRequiredError ||
        error instanceof InstructionResourceMismatchError
      )
        throw error;
      return await this.failAttempt(state, record, error);
    }
  }

  private async executeFix(
    state: RunState,
    config: OrchestratorConfig,
    recovery: RecoveryAuthorization | null = null,
    commitTransition?: () => Promise<void>
  ): Promise<RunState> {
    if (!(await hasRunnerWorkOwnership(this.repoRoot, state.artifactBinding)))
      return withRunnerWorkOwnership(this.repoRoot, state.artifactBinding, () =>
        this.executeFix(state, config, recovery, commitTransition)
      );
    requireState(state, ["fixing"], "Fix");
    await this.assertProjectGuidance();
    if (recovery === null) {
      await this.activity(
        "Fix checks",
        `base commit, approved plan bundle, and ${config.models.implementer.executable} subscription authentication`,
        async () => {
          await this.validateBaseCommit(state);
          await this.validateApproval(state);
          await this.preflightVendor("implementer", config.models.implementer);
        }
      );
    }
    const review = await this.readLatestReview(state);
    const acceptedIds = new Set(
      state.triage?.items
        .filter((item) => item.disposition === "accepted")
        .map((item) => item.findingId) ?? []
    );
    let findings = review.findings.filter((finding) =>
      acceptedIds.has(finding.id)
    );
    let prerequisiteRecovery: PrerequisiteBlockedFixScope | null = null;
    if (recovery !== null) {
      const sourceRecord = await this.store.readRunAttempt(
        state.runId,
        recovery.attempt
      );
      if (sourceRecord.status === "completed" && sourceRecord.result !== null) {
        prerequisiteRecovery = await this.prerequisiteBlockedFixScope(
          state,
          sourceRecord,
          false
        );
        if (prerequisiteRecovery.scopeDigest !== recovery.scopeDigest) {
          throw new BanzaiError(
            "RECOVERY_STALE",
            "The completed blocked source scope changed before fix execution."
          );
        }
        const remainingIds = new Set(prerequisiteRecovery.remainingFindingIds);
        findings = review.findings.filter((finding) =>
          remainingIds.has(finding.id)
        );
      }
    }
    if (findings.length === 0) {
      throw new BanzaiError(
        "EMPTY_FIX_SCOPE",
        "Fixing requires at least one accepted finding."
      );
    }
    const implementerBinding = sessionBindingMatches(
      state.sessions.implementer,
      config.models.implementer,
      "implementer"
    )
      ? state.sessions.implementer
      : null;
    const resumeSessionId = implementerBinding?.id ?? null;
    await this.beforeModelAttempt(commitTransition, {
      config,
      role: "implementer",
      phase: "fix"
    });
    // Every new accepted-finding fix attempt, including evidence-repair reruns
    // and recovery descendants, is created under the completion protocol.
    const retryOf =
      recovery === null
        ? await this.completionRetryPredecessor(state, "fix")
        : null;
    const attempt =
      recovery === null
        ? retryOf === null
          ? this.newAttempt(state, "fix", true)
          : this.repairAttempt(state, "fix", retryOf)
        : this.recoveryAttempt(recovery);
    await this.transitionToCompletionState(state, {
      id: attempt.id,
      kind: "fix",
      mutable: true
    });
    const policy: AttemptPolicy = {
      sessionMode: resumeSessionId === null ? "fresh" : "resumed",
      resumeSessionId,
      sessionContext: sessionContext("implementer", config.models.implementer),
      completion: { retryOf }
    };
    const record =
      recovery === null
        ? await this.beginAttempt(state, attempt, policy)
        : await this.beginRecoveryAttempt(state, recovery, policy);
    try {
      const approval = state.planApproval;
      if (approval === null) {
        throw new BanzaiError("PLAN_NOT_APPROVED", "Plan approval is missing.");
      }
      // Resolved before the phase banner: the invocation scope carries the
      // run-level MCP whitelist, which reports on first resolution and would
      // otherwise print as if it were the phase's own first action.
      const environment = await this.invocationScope(state.runId, config);
      const fixCompletionRepair =
        state.planTaskCompletion?.status === "invalid" &&
        state.planTaskCompletion.sourceAttemptKind === "fix"
          ? {
              sourceAttemptId: state.planTaskCompletion.sourceAttemptId,
              violation: state.planTaskCompletion.violation,
              taskId: state.planTaskCompletion.taskId,
              diagnostic: await this.completionRepairDiagnostic(
                state,
                state.planTaskCompletion.sourceAttemptId,
                "fix"
              )
            }
          : null;
      const basePrompt = fixPromptEnvelope(
        state.slug,
        approval.digest,
        findings,
        config.verification.profiles,
        state.latestReview?.artifactPath ?? null,
        state.humanDecisions ?? [],
        fixCompletionRepair
      );
      const recoveredPrompt =
        recovery === null
          ? basePrompt
          : recoveryPromptEnvelope(
              basePrompt,
              recovery.attempt.id,
              "fix",
              prerequisiteRecovery === null
                ? null
                : {
                    resolvedFindingIds: prerequisiteRecovery.resolvedFindingIds,
                    remainingFindingIds:
                      prerequisiteRecovery.remainingFindingIds,
                    prerequisites: prerequisiteRecovery.prerequisites
                  }
            );
      const invocationPrompt = insertPhaseInstructions(recoveredPrompt, [
        this.artifactInstructions(state, attempt.kind),
        this.serenaGuidanceFor(
          environment,
          config.models.implementer.executable
        )
      ]);
      const result = await this.activity(
        "Fix",
        {
          detail: `${modelActivityDetail(
            config.models.implementer,
            attempt,
            PHASE_PHASES.Fix
          )} findings=${findings.length}`,
          descriptor: phaseDescriptor(
            config.models.implementer,
            resumeSessionId === null ? "fresh" : "resumed",
            PHASE_PHASES.Fix
          )
        },
        async () =>
          await this.invokeWithContext({
            state,
            attempt,
            config,
            settings: config.models.implementer,
            role: "implementer",
            sessionMode: resumeSessionId === null ? "fresh" : "resumed",
            kind: "primary",
            prompt: invocationPrompt,
            outputIdentity: "phase-result/v3",
            invoke: async (outputContract) =>
              await this.adapters.runPhase({
                repoRoot: this.repoRoot,
                runDirectory: this.store.runDirectory(state.runId),
                attemptId: attempt.id,
                environment,
                prompt: invocationPrompt.rendered,
                promptEnvelope: invocationPrompt,
                outputContract,
                settings: config.models.implementer,
                resumeSessionId,
                env: {
                  ...process.env,
                  BANZAI_RUN_ID: state.runId,
                  BANZAI_APPROVAL_DIGEST: approval.digest
                },
                onStart: async (pid) => {
                  await this.processStarted(state, attempt, pid);
                },
                onProgress: (event) => {
                  this.modelProgress("Fix", event);
                },
                onTerminalSuccess: this.terminalCheckpointWriter(
                  state,
                  attempt,
                  config.models.implementer,
                  {
                    sessionMode: resumeSessionId === null ? "fresh" : "resumed",
                    sessionContext: sessionContext(
                      "implementer",
                      config.models.implementer
                    )
                  },
                  true
                ),
                completionProtocol: COMPLETION_PROTOCOL
              })
          })
      );
      if (result.result.phase !== "fix") {
        throw new BanzaiError(
          "PHASE_RESULT_MISMATCH",
          `Attempt fix returned phase ${result.result.phase}.`
        );
      }
      // ADR-0025 under ADR-0047: a non-null ledger is a complete replacement
      // validated against the same approved task set; a null ledger republishes
      // the retained canonical author's claims under a new publisher receipt;
      // stop results retain their partial accepted progress unpromoted.
      return await this.applyCompletionResult(
        state,
        record,
        result,
        config,
        resumeSessionId,
        sessionContext("implementer", config.models.implementer)
      );
    } catch (error) {
      if (
        error instanceof TerminalRunStateError ||
        error instanceof ProjectSetupRequiredError ||
        error instanceof InstructionResourceMismatchError
      )
        throw error;
      return await this.failAttempt(state, record, error);
    }
  }

  // ---------------------------------------------------------------------------
  // Runner-owned completion publication (ADR-0047 / ADR-0048)
  // ---------------------------------------------------------------------------

  private completionProtocolAttempt(record: AttemptRecord): boolean {
    return record.schemaVersion === STRICT_MODEL_ATTEMPT_SCHEMA_VERSION;
  }

  private completionEnvelopeOf(
    result: PhaseResult | PhaseResultEnvelope
  ): PhaseResultEnvelope {
    return isPhaseResultEnvelope(result)
      ? result
      : phaseResultEnvelopeOf(result);
  }

  /** Lite routes keep the validated result contract; an envelope there is a vendor defect. */
  private legacyPhaseResult(
    result: PhaseResult | PhaseResultEnvelope
  ): PhaseResult {
    if (!isPhaseResultEnvelope(result)) return result;
    const validated = phaseResultFromEnvelope(result);
    if (validated === null)
      throw new BanzaiError(
        "PLAN_TASK_COMPLETION_INVALID",
        result.taskCompletion.state === "unaccepted"
          ? result.taskCompletion.diagnostic
          : "Lite phase result carried an unaccepted completion payload."
      );
    return validated;
  }

  /**
   * The exact rejected predecessor an evidence-repair successor links to. Only
   * a failed attempt of the same kind whose input the runner rejected under
   * PLAN_TASK_COMPLETION_INVALID is a predecessor; a canonical source rejected
   * at revalidation has no failed predecessor and links to nothing.
   */
  private async completionRetryPredecessor(
    state: RunState,
    kind: "implementation" | "fix"
  ): Promise<string | null> {
    const checkpoint = state.planTaskCompletion;
    if (checkpoint?.status !== "invalid") return null;
    if ((checkpoint.sourceAttemptKind ?? "implementation") !== kind)
      return null;
    const predecessor = await this.store.readRunAttemptIfExists(state.runId, {
      id: checkpoint.sourceAttemptId,
      kind,
      mutable: true
    });
    if (
      predecessor?.status !== "failed" ||
      predecessor.failureCode !== "PLAN_TASK_COMPLETION_INVALID"
    )
      return null;
    return predecessor.attempt.id;
  }

  /**
   * A deterministic successor identity for one rejected predecessor under the
   * same approval and scope, so an interrupted successor creation deduplicates
   * on resume instead of minting a second linked attempt.
   */
  private repairAttempt(
    state: RunState,
    kind: "implementation" | "fix",
    predecessor: string
  ): AttemptReference {
    const identity = digestCanonicalJson({
      version: 1,
      runId: state.runId,
      predecessor,
      approvalDigest: state.planApproval?.digest ?? null,
      scopeDigest: this.attemptScopeDigest(state, {
        id: predecessor,
        kind,
        mutable: true
      })
    });
    return {
      id: `${kind}-repair-${identity.slice(0, 12)}`,
      kind,
      mutable: true
    };
  }

  /**
   * Moves a v4/v6 run to schema 7 exactly once, when its first strict attempt
   * under the completion protocol is created. The exact prior state bytes are
   * retained as attempt-owned transition evidence before the new state exists,
   * and the run keeps its binding, verification mode and configuration setup.
   */
  private async transitionToCompletionState(
    state: RunState,
    attempt: AttemptReference & { kind: "implementation" | "fix" }
  ): Promise<void> {
    if (state.schemaVersion === 7) return;
    if (
      state.schemaVersion !== 3 &&
      state.schemaVersion !== 4 &&
      state.schemaVersion !== 6
    )
      throw new BanzaiError(
        "COMPLETION_STATE_UNSUPPORTED",
        `Run state v${state.schemaVersion} cannot host a runner-owned completion attempt. Cancel this run and start a new one.`
      );
    const priorBytes = await this.store.readStateBytes(state.runId);
    const transition: Omit<CompletionTransition, "integrityDigest"> = {
      schema: COMPLETION_TRANSITION_SCHEMA,
      schemaVersion: COMPLETION_RECORD_SCHEMA_VERSION,
      runId: state.runId,
      attemptId: attempt.id,
      attemptKind: attempt.kind,
      completionProtocol: COMPLETION_PROTOCOL,
      priorState: {
        schemaVersion: state.schemaVersion,
        path: this.store.completionEvidenceRelativePath(
          state.runId,
          attempt,
          "completion-state-input.json"
        ),
        sha256: createHash("sha256").update(priorBytes).digest("hex")
      }
    };
    await this.store.writeCompletionTransition(
      state.runId,
      { ...transition, integrityDigest: completionRecordIntegrity(transition) },
      priorBytes
    );
    state.schemaVersion = 7;
    state.completionPublication = null;
  }

  private implementerConfigurationDigest(config: OrchestratorConfig): string {
    const settings = config.models.implementer;
    return digestCanonicalJson({
      version: 1,
      vendor: vendorFor(settings.executable) ?? FALLBACK_VENDOR.implementer,
      executableDigest: digestCanonicalJson(settings.executable),
      model: settings.model,
      effort: settings.effort
    });
  }

  private completionCheckpointConfigurationCurrent(
    record: AttemptRecord,
    checkpoint: TerminalAttemptCheckpointV2,
    config: OrchestratorConfig
  ): boolean {
    const settings = config.models.implementer;
    const expectedContext =
      record.sessionContext ?? sessionContext("implementer", settings);
    return (
      checkpoint.configuration.vendor ===
        (vendorFor(settings.executable) ?? FALLBACK_VENDOR.implementer) &&
      checkpoint.configuration.executableDigest ===
        digestCanonicalJson(settings.executable) &&
      checkpoint.configuration.model === settings.model &&
      checkpoint.configuration.effort === settings.effort &&
      checkpoint.configuration.sessionMode ===
        (record.sessionMode ?? "fresh") &&
      checkpoint.configuration.sessionContextDigest ===
        digestCanonicalJson(expectedContext)
    );
  }

  /** Observes one required report without following an unsafe path. */
  private async observeReport(relativePath: string | null): Promise<{
    observation: CompletionReportObservation;
    bytes: Buffer | null;
  }> {
    if (relativePath === null)
      return { observation: { path: null, state: "absent" }, bytes: null };
    let absolute: string;
    try {
      absolute = path.resolve(this.repoRoot, relativePath);
      if (
        relativePath.length === 0 ||
        relativePath.includes("\\") ||
        path.posix.isAbsolute(relativePath) ||
        path.posix.normalize(relativePath) !== relativePath ||
        relativePath.startsWith("../") ||
        !absolute.startsWith(`${path.resolve(this.repoRoot)}${path.sep}`)
      )
        return {
          observation: { path: relativePath, state: "unsafe" },
          bytes: null
        };
      const metadata = await lstat(absolute);
      if (!metadata.isFile() || metadata.isSymbolicLink())
        return {
          observation: { path: relativePath, state: "unsafe" },
          bytes: null
        };
      const root = await realpath(this.repoRoot);
      if (!(await realpath(absolute)).startsWith(`${root}${path.sep}`))
        return {
          observation: { path: relativePath, state: "unsafe" },
          bytes: null
        };
    } catch (error) {
      return {
        observation: {
          path: relativePath,
          state:
            (error as NodeJS.ErrnoException).code === "ENOENT"
              ? "absent"
              : "unavailable"
        },
        bytes: null
      };
    }
    try {
      const bytes = await readFile(absolute);
      return {
        observation: {
          path: relativePath,
          state: "present",
          sha256: createHash("sha256").update(bytes).digest("hex"),
          bytes: bytes.length
        },
        bytes
      };
    } catch {
      return {
        observation: { path: relativePath, state: "unavailable" },
        bytes: null
      };
    }
  }

  /**
   * Report identities plus the non-report workspace digest, omitting exactly
   * the two report destinations so a runner-owned report write never counts
   * as source drift while every other change does.
   */
  private async observeCompletionInputs(
    state: RunState,
    artifacts: Pick<PhaseArtifacts, "implementationReport" | "testReport">
  ): Promise<{
    observed: CompletionObservedInputs;
    bytes: { implementationReport: Buffer | null; testReport: Buffer | null };
    excludedPaths: string[];
  }> {
    const implementation = await this.observeReport(
      artifacts.implementationReport
    );
    const test = await this.observeReport(artifacts.testReport);
    const excludedPaths = [
      artifacts.implementationReport,
      artifacts.testReport
    ].filter((item): item is string => item !== null);
    let workspaceDigest: string | null;
    try {
      workspaceDigest = (
        await workspaceSnapshot(this.repoRoot, {
          artifactBinding: state.artifactBinding,
          baseline: state.baseline,
          excludedPaths
        })
      ).digest;
    } catch {
      workspaceDigest = null;
    }
    return {
      observed: {
        implementationReport: implementation.observation,
        testReport: test.observation,
        workspaceDigest
      },
      bytes: {
        implementationReport: implementation.bytes,
        testReport: test.bytes
      },
      excludedPaths
    };
  }

  private async storeCursor(
    state: RunState,
    cursor: CompletionPublicationCursor
  ): Promise<void> {
    state.completionPublication = cursor;
    try {
      await this.store.writeState(state);
    } catch (error) {
      if (error instanceof TerminalRunStateError) throw error;
      throw new CompletionRefusal(
        "COMPLETION_PUBLICATION_IO",
        cursor.stage,
        cursor.receiptDigest ??
          cursor.candidateDigest ??
          cursor.captureDigest ??
          null,
        "Retry with banzai resume once storage is available, or cancel."
      );
    }
  }

  /**
   * Capture: retain the original decoded result, terminal identity, authority
   * identities and byte-identical report originals before any validation. A
   * missing input identity is recorded as absent or unavailable, never inferred.
   */
  private async captureCompletionInput(
    state: RunState,
    record: AttemptRecord,
    envelope: PhaseResultEnvelope,
    config: OrchestratorConfig,
    outcome: "completed" | "stop"
  ): Promise<CompletionCapture> {
    const attempt = record.attempt as AttemptReference & {
      kind: "implementation" | "fix";
    };
    const approval = state.planApproval;
    if (approval === null)
      throw new BanzaiError("PLAN_NOT_APPROVED", "Plan approval is missing.");
    const checkpoint = await this.store.readTerminalCheckpointIfExists(
      state.runId,
      attempt
    );
    if (checkpoint?.schemaVersion !== 2)
      throw new CompletionRefusal(
        "COMPLETION_PUBLICATION_INTEGRITY",
        "capture",
        checkpoint?.integrityDigest ?? null,
        "The exact terminal input observation is unavailable; cancel the run unless intact proof can be reproduced by a corrected runner."
      );
    if (checkpoint.observed.workspaceDigest === null)
      throw new CompletionRefusal(
        "COMPLETION_PUBLICATION_INTEGRITY",
        "capture",
        checkpoint.integrityDigest,
        "The terminal checkpoint did not prove the non-report workspace identity; cancel the run unless intact proof can be reproduced by a corrected runner."
      );
    if (
      !this.completionCheckpointConfigurationCurrent(record, checkpoint, config)
    )
      throw new CompletionRefusal(
        "COMPLETION_PUBLICATION_DRIFT",
        "capture",
        checkpoint.integrityDigest,
        "The implementer configuration or session context changed after the model returned. Restore the exact recorded authority, then run banzai resume; otherwise cancel."
      );
    const transition = await this.store.readCompletionTransitionIfExists(
      state.runId,
      attempt
    );
    const inputs = await this.observeCompletionInputs(
      state,
      envelope.artifacts
    );
    // ADR-0047 section 4: the capture baseline is the input the runner observed
    // when the vendor returned, never a second read of files that may have
    // changed after it. A restart before the manifest or an original was
    // durable must prove those exact identities again; anything else is drift
    // with an explicit restore-then-resume route, never an adopted new input.
    const proven = checkpoint.observed;
    if (!sameObservedInputs(inputs.observed, proven))
      throw new CompletionRefusal(
        "COMPLETION_PUBLICATION_DRIFT",
        "capture",
        checkpoint.integrityDigest,
        "A required report or the non-report workspace changed after the model returned. Restore the exact recorded input and matching authority, then run banzai resume; otherwise cancel."
      );
    const observed = proven;
    const originals: CompletionCapture["originals"] = {
      implementationReport: null,
      testReport: null
    };
    if (inputs.bytes.implementationReport !== null)
      originals.implementationReport = await this.store.writeCompletionOriginal(
        state.runId,
        attempt,
        "implementationReport",
        inputs.bytes.implementationReport
      );
    if (inputs.bytes.testReport !== null)
      originals.testReport = await this.store.writeCompletionOriginal(
        state.runId,
        attempt,
        "testReport",
        inputs.bytes.testReport
      );
    const accepted =
      envelope.taskCompletion.state === "accepted"
        ? envelope.taskCompletion.ledger
        : null;
    const prior = state.planTaskCompletion;
    const ledgerSource: CompletionCapture["ledgerSource"] =
      accepted !== null
        ? {
            attemptId: attempt.id,
            attemptKind: attempt.kind,
            ledgerDigest: ledgerDigest(accepted)
          }
        : attempt.kind === "fix" &&
            envelope.taskCompletion.state === "accepted" &&
            prior?.status === "valid"
          ? {
              attemptId: prior.sourceAttemptId,
              attemptKind: prior.sourceAttemptKind ?? "implementation",
              ledgerDigest: prior.ledgerDigest
            }
          : null;
    const capture: Omit<CompletionCapture, "integrityDigest"> = {
      schema: COMPLETION_CAPTURE_SCHEMA,
      schemaVersion: COMPLETION_RECORD_SCHEMA_VERSION,
      runId: state.runId,
      attemptId: attempt.id,
      attemptKind: attempt.kind,
      completionProtocol: COMPLETION_PROTOCOL,
      outcome,
      resultDigest: envelope.originalDigest,
      terminalIntegrityDigest: checkpoint.integrityDigest,
      transitionDigest: transition?.integrityDigest ?? null,
      baseCommit: state.baseCommit,
      approvalDigest: approval.digest,
      planTaskDigest: planTaskDigest(await this.approvedTaskIds(state)),
      workBinding:
        state.artifactBinding === undefined
          ? null
          : {
              workId: state.artifactBinding.binding.workId,
              sha256: state.artifactBinding.sha256
            },
      configurationDigest: this.implementerConfigurationDigest(config),
      scopeDigest: this.attemptScopeDigest(state, attempt),
      ledgerSource,
      reports: {
        implementationReport: observed.implementationReport,
        testReport: observed.testReport
      },
      originals,
      workspace: {
        digest: observed.workspaceDigest ?? "0".repeat(64),
        excludedPaths: inputs.excludedPaths
      },
      // Identity-bearing time comes from durable terminal proof, not retry time.
      capturedAt: checkpoint.terminal.observedAt
    };
    const sealed: CompletionCapture = {
      ...capture,
      integrityDigest: completionRecordIntegrity(capture)
    };
    await this.store.writeCompletionCapture(state.runId, sealed);
    return sealed;
  }

  /**
   * A stop result (blocked or escalation) is applied as the model reported
   * it. Completion diagnostics are retained beside the attempt; they never
   * suppress, replace or downgrade the stop, and nothing is rendered.
   */
  private async applyCompletionStop(
    state: RunState,
    record: AttemptRecord,
    envelope: PhaseResultEnvelope,
    config: OrchestratorConfig,
    sessionId: string | null,
    context: SessionContext
  ): Promise<RunState> {
    const attempt = record.attempt;
    let diagnostic: CompletionDiagnostic | null = null;
    if (envelope.taskCompletion.state === "unaccepted") {
      diagnostic = {
        violation: "source_attempt_invalid",
        taskId: null,
        message: envelope.taskCompletion.diagnostic
      };
    } else if (state.planApproval !== null) {
      try {
        await validateCompletionClaims({
          repoRoot: this.repoRoot,
          artifactBinding: state.artifactBinding,
          ledger: envelope.taskCompletion.ledger,
          outcome: envelope.outcome,
          artifacts: envelope.artifacts,
          planPath: this.completionPlanPath(state),
          approval: state.planApproval,
          baseline: state.baseline
        });
      } catch (error) {
        if (
          error instanceof TerminalRunStateError ||
          error instanceof ProjectSetupRequiredError ||
          error instanceof InstructionResourceMismatchError
        )
          throw error;
        diagnostic = {
          violation:
            error instanceof PlanTaskCompletionError
              ? error.violation
              : "source_attempt_invalid",
          taskId:
            error instanceof PlanTaskCompletionError ? error.taskId : null,
          message: errorMessage(error).slice(0, 500)
        };
      }
    }
    record.completionDiagnostic = diagnostic;
    try {
      await this.captureCompletionInput(
        state,
        record,
        envelope,
        config,
        "stop"
      );
    } catch (error) {
      if (error instanceof TerminalRunStateError) throw error;
      // Optional stop-result capture never discards a safely established stop.
      this.info(`Stop-result capture unavailable: ${errorMessage(error)}`);
    }
    record.status = "completed";
    record.completedAt ??= now();
    record.durationMs ??=
      Date.parse(record.completedAt) - Date.parse(record.startedAt);
    await this.store.writeRunAttempt(state.runId, record);
    const current = await this.store.readState(state.runId);
    if (current.status === "cancelled") return current;
    this.accountCompletedAttempt(state, record);
    state.activeProcess = null;
    await this.store.writeState(state);
    const fields = envelopeResultFields(envelope);
    return await this.applyPhaseResult(
      state,
      attempt,
      {
        ...fields,
        taskCompletion:
          envelope.taskCompletion.state === "accepted"
            ? envelope.taskCompletion.ledger
            : null
      },
      sessionId,
      context
    );
  }

  private completionRejectionCheckpoint(
    record: AttemptRecord,
    error: PlanTaskCompletionError,
    capture: CompletionCapture | null
  ): NonNullable<RunState["planTaskCompletion"]> {
    return {
      schemaVersion: COMPLETION_SUMMARY_SCHEMA_VERSION,
      status: "invalid",
      sourceAttemptId: record.attempt.id,
      sourceAttemptKind:
        record.attempt.kind === "fix" ? "fix" : "implementation",
      errorCode: "PLAN_TASK_COMPLETION_INVALID",
      violation: error.violation,
      taskId: error.taskId,
      recordedAt: now(),
      completionProtocol: COMPLETION_PROTOCOL,
      diagnostic: error.message.slice(0, 500),
      rejectedResultDigest:
        capture?.resultDigest ?? record.envelope?.originalDigest ?? null
    };
  }

  /**
   * Final input rejection: the attempt fails, the rejected result, input and
   * prior canonical source stay intact, and retry creates one linked successor.
   */
  private async rejectCompletionInput(
    state: RunState,
    record: AttemptRecord,
    error: PlanTaskCompletionError,
    capture: CompletionCapture | null
  ): Promise<RunState> {
    record.status = "failed";
    record.completedAt ??= now();
    record.durationMs ??=
      Date.parse(record.completedAt) - Date.parse(record.startedAt);
    record.error = `[PLAN_TASK_COMPLETION_INVALID] ${error.message}`;
    record.failureCode = "PLAN_TASK_COMPLETION_INVALID";
    await this.store.writeRunAttempt(state.runId, record);
    const current = await this.store.readState(state.runId);
    if (current.status === "cancelled") return current;
    this.accountAttemptUsage(state, record);
    state.planTaskCompletion = this.completionRejectionCheckpoint(
      record,
      error,
      capture
    );
    state.completionPublication = {
      attemptId: record.attempt.id,
      attemptKind: record.attempt.kind === "fix" ? "fix" : "implementation",
      stage: "validate",
      captureDigest: capture?.integrityDigest ?? null,
      candidateDigest: null,
      receiptDigest: null,
      refusal: null
    };
    state.activeProcess = null;
    blockState(state, `[PLAN_TASK_COMPLETION_INVALID] ${error.message}`);
    await this.store.writeState(state);
    await this.store.appendEvent(state.runId, "attempt.failed", {
      attemptId: record.attempt.id,
      kind: record.attempt.kind,
      error: `[PLAN_TASK_COMPLETION_INVALID] ${error.message}`
    });
    await this.store.appendEvent(
      state.runId,
      "plan_task_completion.validation_failed",
      {
        attemptId: record.attempt.id,
        code: "PLAN_TASK_COMPLETION_INVALID",
        violation: error.violation,
        taskId: error.taskId
      }
    );
    await this.store.appendEventOnce(state.runId, "completion.input_rejected", {
      attemptId: record.attempt.id,
      attemptKind: record.attempt.kind,
      stage: "validate",
      proofDigest: capture?.integrityDigest ?? null,
      code: "PLAN_TASK_COMPLETION_INVALID",
      violation: error.violation,
      taskId: error.taskId
    });
    return state;
  }

  /**
   * Publication refusal: the attempt stays pending_application with a closed
   * code, stage and last durable proof digest. No model text or raw error
   * enters the block reason; resume reconciles or cancel exits.
   */
  private async appendCompletionPublicationRefusalEvent(
    state: RunState,
    record: AttemptRecord,
    refusal: NonNullable<CompletionPublicationCursor["refusal"]>
  ): Promise<boolean> {
    try {
      await this.store.appendEventOnce(
        state.runId,
        "completion.publication_refused",
        {
          attemptId: record.attempt.id,
          attemptKind: record.attempt.kind === "fix" ? "fix" : "implementation",
          stage: refusal.stage,
          proofDigest: refusal.proofDigest,
          code: refusal.code,
          violation: null,
          taskId: null
        }
      );
      return true;
    } catch (error) {
      if (error instanceof TerminalRunStateError) throw error;
      return false;
    }
  }

  private async refuseCompletionPublication(
    state: RunState,
    record: AttemptRecord,
    refusal: CompletionRefusal
  ): Promise<RunState> {
    const attemptKind =
      record.attempt.kind === "fix" ? "fix" : "implementation";
    const cursor = state.completionPublication;
    const persistedRefusal: NonNullable<
      CompletionPublicationCursor["refusal"]
    > = {
      code: refusal.code,
      stage: refusal.stage,
      proofDigest: refusal.proofDigest
    };
    const applyRefusalState = (): void => {
      state.completionPublication = {
        attemptId: record.attempt.id,
        attemptKind,
        stage: refusal.stage,
        captureDigest:
          cursor?.attemptId === record.attempt.id ? cursor.captureDigest : null,
        candidateDigest:
          cursor?.attemptId === record.attempt.id
            ? cursor.candidateDigest
            : null,
        receiptDigest:
          cursor?.attemptId === record.attempt.id ? cursor.receiptDigest : null,
        refusal: persistedRefusal
      };
      state.activeProcess = null;
      blockState(
        state,
        `[${refusal.code}] Completion publication for ${attemptKind} attempt ${record.attempt.id} stopped at stage ${refusal.stage}. ${refusal.remedy}`
      );
    };

    try {
      if (record.status !== "pending_application") {
        record.status = "pending_application";
        await this.store.writeRunAttempt(state.runId, record);
      }
      const current = await this.store.readState(state.runId);
      if (current.status === "cancelled") return current;
    } catch (error) {
      if (error instanceof TerminalRunStateError) throw error;
      applyRefusalState();
      return state;
    }

    applyRefusalState();
    try {
      await this.store.writeState(state);
    } catch (error) {
      if (error instanceof TerminalRunStateError) throw error;
      return state;
    }
    await this.appendCompletionPublicationRefusalEvent(
      state,
      record,
      persistedRefusal
    );
    return state;
  }

  /** Resolves the canonical ledger a capture names; null-ledger fixes reuse the prior author. */
  private async completionLedgerFor(
    state: RunState,
    record: AttemptRecord,
    envelope: PhaseResultEnvelope,
    capture: CompletionCapture
  ): Promise<PlanTaskCompletionLedger> {
    const source = capture.ledgerSource;
    if (source === null || envelope.taskCompletion.state !== "accepted")
      throw new PlanTaskCompletionError(
        envelope.taskCompletion.state === "unaccepted"
          ? "source_attempt_invalid"
          : "missing_ledger",
        envelope.taskCompletion.state === "unaccepted"
          ? envelope.taskCompletion.diagnostic
          : record.attempt.kind === "fix"
            ? "Completed fix has no canonical ledger source to republish."
            : "Strict implementation result is missing taskCompletion."
      );
    if (source.attemptId === record.attempt.id) {
      const ledger = envelope.taskCompletion.ledger;
      if (ledger === null || ledgerDigest(ledger) !== source.ledgerDigest)
        throw new CompletionRefusal(
          "COMPLETION_PUBLICATION_INTEGRITY",
          "validate",
          capture.integrityDigest,
          "The captured ledger does not match its recorded identity."
        );
      return ledger;
    }
    const author = await this.store.readRunAttemptIfExists(state.runId, {
      id: source.attemptId,
      kind: source.attemptKind,
      mutable: true
    });
    const ledger = author === null ? null : this.recordLedger(author);
    if (
      author?.status !== "completed" ||
      ledger === null ||
      ledgerDigest(ledger) !== source.ledgerDigest
    )
      throw new PlanTaskCompletionError(
        "source_attempt_invalid",
        "Canonical completion source attempt is missing, incomplete or changed."
      );
    return ledger;
  }

  /** The ledger a completed attempt record carries, under either protocol. */
  private recordLedger(record: AttemptRecord): PlanTaskCompletionLedger | null {
    if (this.completionProtocolAttempt(record)) {
      const envelope = record.envelope ?? null;
      return envelope?.taskCompletion.state === "accepted"
        ? envelope.taskCompletion.ledger
        : null;
    }
    if (record.result === null) return null;
    try {
      return parsePersistedPhaseResult(record.result).taskCompletion;
    } catch {
      return null;
    }
  }

  private async completionAuthorityCurrent(
    state: RunState,
    capture: CompletionCapture,
    config: OrchestratorConfig
  ): Promise<boolean> {
    if (state.planApproval === null) return false;
    try {
      if ((await currentCommit(this.repoRoot)) !== capture.baseCommit)
        return false;
      const bundle = await digestArtifactBundle(
        this.repoRoot,
        state.planApproval.paths
      );
      return (
        bundle.digest === state.planApproval.digest &&
        capture.approvalDigest === state.planApproval.digest &&
        capture.planTaskDigest ===
          planTaskDigest(await this.approvedTaskIds(state)) &&
        capture.scopeDigest ===
          this.attemptScopeDigest(state, {
            id: capture.attemptId,
            kind: capture.attemptKind,
            mutable: true
          }) &&
        (capture.workBinding?.sha256 ?? null) ===
          (state.artifactBinding?.sha256 ?? null) &&
        // The implementer configuration that produced this result is part of
        // the recorded authority: `.banzai/config.json` is excluded from the
        // non-report workspace digest, so nothing else would detect its drift.
        capture.configurationDigest ===
          this.implementerConfigurationDigest(config)
      );
    } catch {
      return false;
    }
  }

  /** Read-only authority check while a capture manifest is still incomplete. */
  private async completionCheckpointAuthorityCurrent(
    state: RunState,
    record: AttemptRecord,
    checkpoint: TerminalAttemptCheckpointV2,
    config: OrchestratorConfig
  ): Promise<boolean> {
    const approval = state.planApproval;
    if (approval === null || record.envelope == null) return false;
    try {
      if ((await currentCommit(this.repoRoot)) !== checkpoint.baseCommit)
        return false;
      const bundle = await digestArtifactBundle(this.repoRoot, approval.paths);
      return (
        checkpoint.runId === state.runId &&
        checkpoint.attempt.id === record.attempt.id &&
        checkpoint.attempt.kind === record.attempt.kind &&
        checkpoint.phase === record.attempt.kind &&
        checkpoint.resultDigest === record.envelope.originalDigest &&
        checkpoint.baseCommit === state.baseCommit &&
        checkpoint.approvalDigest === approval.digest &&
        bundle.digest === approval.digest &&
        checkpoint.workflowDigest === null &&
        checkpoint.scopeDigest ===
          this.attemptScopeDigest(state, record.attempt) &&
        this.completionCheckpointConfigurationCurrent(
          record,
          checkpoint,
          config
        )
      );
    } catch {
      return false;
    }
  }

  /**
   * Deterministic continuation from the last durable stage: validate, render,
   * persist the candidate, conditionally replace only the exact implementation
   * report, write the receipt and apply once. Every re-entry recognizes its
   * interruption boundary from retained proof and never invokes a model.
   */
  private async continueCompletionPublication(
    state: RunState,
    record: AttemptRecord,
    config: OrchestratorConfig
  ): Promise<
    | { kind: "applied"; result: PhaseResult }
    | { kind: "stopped"; state: RunState }
  > {
    const attempt = record.attempt as AttemptReference & {
      kind: "implementation" | "fix";
    };
    const envelope = record.envelope ?? null;
    if (envelope === null)
      return {
        kind: "stopped",
        state: await this.refuseCompletionPublication(
          state,
          record,
          new CompletionRefusal(
            "COMPLETION_PUBLICATION_INTEGRITY",
            "capture",
            null,
            "The captured envelope is missing; cancel the run."
          )
        )
      };
    let capture: CompletionCapture;
    try {
      const retainedCapture = await this.store.readCompletionCaptureIfExists(
        state.runId,
        attempt
      );
      if (retainedCapture === null) {
        const [retainedCandidate, retainedReceipt] = await Promise.all([
          this.store.readCompletionCandidateIfExists(state.runId, attempt),
          this.store.readCompletionPublicationIfExists(state.runId, attempt)
        ]);
        if (retainedCandidate !== null || retainedReceipt !== null)
          throw new CompletionRefusal(
            "COMPLETION_PUBLICATION_INTEGRITY",
            "capture",
            retainedReceipt?.captureDigest ??
              retainedCandidate?.candidate.captureDigest ??
              null,
            "Later publication evidence exists without its capture manifest; cancel the run unless intact proof can be reproduced by a corrected runner."
          );
      }
      capture =
        retainedCapture ??
        (await this.captureCompletionInput(
          state,
          record,
          envelope,
          config,
          "completed"
        ));
      if (
        state.completionPublication?.attemptId !== attempt.id ||
        state.completionPublication.captureDigest !== capture.integrityDigest
      )
        await this.storeCursor(state, {
          attemptId: attempt.id,
          attemptKind: attempt.kind,
          stage: "capture",
          captureDigest: capture.integrityDigest,
          candidateDigest: null,
          receiptDigest: null,
          refusal: null
        });
    } catch (error) {
      if (error instanceof TerminalRunStateError) throw error;
      // A capture-stage refusal already names its closed class, stage and
      // proof; it is never reclassified as transient storage failure.
      if (error instanceof CompletionRefusal)
        return {
          kind: "stopped",
          state: await this.refuseCompletionPublication(state, record, error)
        };
      const conflicting =
        error instanceof BanzaiError &&
        (error.code.startsWith("INVALID_COMPLETION") ||
          error.code === "COMPLETION_CAPTURE_CONFLICT");
      return {
        kind: "stopped",
        state: await this.refuseCompletionPublication(
          state,
          record,
          new CompletionRefusal(
            conflicting
              ? "COMPLETION_PUBLICATION_INTEGRITY"
              : "COMPLETION_PUBLICATION_IO",
            "capture",
            null,
            conflicting
              ? "Retained capture evidence is corrupt or conflicts with the recorded input; cancel the run."
              : "Retry with banzai resume once storage is available, or cancel."
          )
        )
      };
    }
    try {
      return await this.publishCapturedCompletion(
        state,
        record,
        envelope,
        capture,
        config
      );
    } catch (error) {
      if (
        error instanceof TerminalRunStateError ||
        error instanceof ProjectSetupRequiredError ||
        error instanceof InstructionResourceMismatchError
      )
        throw error;
      if (error instanceof PlanTaskCompletionError)
        return {
          kind: "stopped",
          state: await this.rejectCompletionInput(state, record, error, capture)
        };
      if (error instanceof CompletionRefusal)
        return {
          kind: "stopped",
          state: await this.refuseCompletionPublication(state, record, error)
        };
      throw error;
    }
  }

  private async publishCapturedCompletion(
    state: RunState,
    record: AttemptRecord,
    envelope: PhaseResultEnvelope,
    capture: CompletionCapture,
    config: OrchestratorConfig
  ): Promise<
    | { kind: "applied"; result: PhaseResult }
    | { kind: "stopped"; state: RunState }
  > {
    const attempt = record.attempt as AttemptReference & {
      kind: "implementation" | "fix";
    };
    const proof = capture.integrityDigest;
    const drift = (message: string, stage: CompletionPublicationStage) =>
      new CompletionRefusal(
        "COMPLETION_PUBLICATION_DRIFT",
        stage,
        proof,
        `${message} Restore the exact recorded input or proven output and matching authority, then run banzai resume; otherwise cancel.`
      );
    const integrity = (message: string, stage: CompletionPublicationStage) =>
      new CompletionRefusal(
        "COMPLETION_PUBLICATION_INTEGRITY",
        stage,
        proof,
        `${message} Cancel the run unless intact proof can be reproduced by a corrected runner.`
      );
    const receipt = await this.store.readCompletionPublicationIfExists(
      state.runId,
      attempt
    );
    const existingCandidate = await this.store.readCompletionCandidateIfExists(
      state.runId,
      attempt
    );
    if (
      existingCandidate !== null &&
      existingCandidate.candidate.captureDigest !== proof
    )
      throw integrity(
        "The retained candidate belongs to a different capture.",
        "candidate"
      );
    if (receipt !== null) {
      if (
        receipt.captureDigest !== proof ||
        receipt.candidateDigest !== existingCandidate?.candidate.integrityDigest
      )
        throw integrity(
          "The retained receipt does not bind this capture and candidate.",
          "receipt"
        );
    }
    // Drift before validation: every later step assumes the captured inputs.
    const inputs = await this.observeCompletionInputs(
      state,
      envelope.artifacts
    );
    const currentImplementation = inputs.observed.implementationReport;
    const currentTest = inputs.observed.testReport;
    const capturedImplementation = capture.reports.implementationReport;
    const capturedTest = capture.reports.testReport;
    const published =
      existingCandidate !== null &&
      currentImplementation.state === "present" &&
      currentImplementation.sha256 === existingCandidate.candidate.outputSha256;
    if (
      !published &&
      (capturedImplementation.state !== "present" ||
        currentImplementation.state !== "present" ||
        currentImplementation.sha256 !== capturedImplementation.sha256)
    ) {
      if (capturedImplementation.state === "present")
        throw drift(
          "The implementation report no longer equals its captured input.",
          "publication"
        );
      throw new PlanTaskCompletionError(
        "implementation_report_missing",
        "Required implementation report was absent, unsafe or unavailable when the model returned."
      );
    }
    if (
      capturedTest.state !== "present" ||
      currentTest.state !== "present" ||
      currentTest.sha256 !== capturedTest.sha256
    ) {
      if (capturedTest.state === "present")
        throw drift(
          "The test report no longer equals its captured input.",
          "publication"
        );
      throw new PlanTaskCompletionError(
        "test_report_missing",
        "Required test report was absent, unsafe or unavailable when the model returned."
      );
    }
    if (
      inputs.observed.workspaceDigest === null ||
      inputs.observed.workspaceDigest !== capture.workspace.digest
    )
      throw drift(
        "The non-report workspace changed since capture.",
        "publication"
      );
    if (!(await this.completionAuthorityCurrent(state, capture, config)))
      throw drift(
        "Base commit, approval, plan tasks, scope, work binding or implementer configuration changed since capture.",
        "publication"
      );
    const originalImplementation =
      await this.store.readCompletionOriginalIfExists(
        state.runId,
        attempt,
        "implementationReport"
      );
    const originalTest = await this.store.readCompletionOriginalIfExists(
      state.runId,
      attempt,
      "testReport"
    );
    if (
      originalImplementation === null ||
      originalTest === null ||
      capture.originals.implementationReport === null ||
      capture.originals.testReport === null ||
      createHash("sha256").update(originalImplementation).digest("hex") !==
        capture.originals.implementationReport.sha256 ||
      createHash("sha256").update(originalTest).digest("hex") !==
        capture.originals.testReport.sha256
    )
      throw integrity(
        "Captured report originals are missing or changed.",
        "capture"
      );
    const originals = {
      implementationReport: originalImplementation,
      testReport: originalTest
    };
    const inputSha256 =
      capturedImplementation.state === "present"
        ? capturedImplementation.sha256
        : (existingCandidate?.candidate.inputSha256 ?? null);
    if (inputSha256 === null)
      throw integrity(
        "The captured implementation report identity is missing.",
        "capture"
      );
    if (state.planApproval === null)
      throw new PlanTaskCompletionError(
        "approval_invalid",
        "Strict completion validation requires an approved plan bundle."
      );
    // Validate: claims, evidence, authority, report roles and preserved gaps.
    const ledger = await this.completionLedgerFor(
      state,
      record,
      envelope,
      capture
    );
    const claims = await validateCompletionClaims({
      repoRoot: this.repoRoot,
      artifactBinding: state.artifactBinding,
      ledger,
      outcome: "completed",
      artifacts: envelope.artifacts,
      planPath: this.completionPlanPath(state),
      approval: state.planApproval,
      baseline: state.baseline,
      captured: originals
    });
    if (claims.testReport.sha256 !== capturedTest.sha256)
      throw integrity(
        "Captured test report identity conflicts with validation.",
        "validate"
      );
    // Render: deterministic candidate from the admitted ledger and preserved narrative.
    const composition = composeCompletionCandidate(
      originals.implementationReport,
      ledger
    );
    const outputSha256 = createHash("sha256")
      .update(composition.bytes)
      .digest("hex");
    const eligible = eligibleGapHeadings(
      composition.bytes.toString("utf8"),
      scanCompletionRegion(composition.bytes.toString("utf8"))
    );
    for (const task of ledger.tasks) {
      if (
        task.gap !== null &&
        task.gap.reportPath === claims.implementationReport.path &&
        !eligible.has(task.gap.section)
      )
        throw new PlanTaskCompletionError(
          "invalid_gap_reference",
          `${task.taskId} gap section is not a unique preserved heading of the final candidate.`,
          task.taskId
        );
    }
    let candidate: CompletionCandidate;
    if (existingCandidate !== null) {
      if (
        existingCandidate.candidate.outputSha256 !== outputSha256 ||
        existingCandidate.candidate.ledgerDigest !== claims.ledgerDigest
      )
        throw integrity(
          "The retained candidate differs from the deterministic rendering.",
          "candidate"
        );
      candidate = existingCandidate.candidate;
    } else {
      const metadata: Omit<CompletionCandidate, "integrityDigest"> = {
        schema: COMPLETION_CANDIDATE_SCHEMA,
        schemaVersion: COMPLETION_RECORD_SCHEMA_VERSION,
        runId: state.runId,
        attemptId: attempt.id,
        attemptKind: attempt.kind,
        completionProtocol: COMPLETION_PROTOCOL,
        captureDigest: proof,
        ledgerDigest: claims.ledgerDigest,
        destination: claims.implementationReport.path,
        inputSha256,
        candidatePath: this.store.completionEvidenceRelativePath(
          state.runId,
          attempt,
          "completion-candidate.md"
        ),
        outputSha256,
        outputBytes: composition.bytes.length,
        testReportSha256: capturedTest.sha256,
        region: composition.region,
        preservation: "verified",
        roundtrip: "verified"
      };
      candidate = {
        ...metadata,
        integrityDigest: completionRecordIntegrity(metadata)
      };
      try {
        await this.store.writeCompletionCandidate(
          state.runId,
          candidate,
          composition.bytes
        );
      } catch (error) {
        if (error instanceof TerminalRunStateError) throw error;
        throw new CompletionRefusal(
          "COMPLETION_PUBLICATION_IO",
          "candidate",
          proof,
          "Retry with banzai resume once storage is available, or cancel."
        );
      }
    }
    await this.storeCursor(state, {
      attemptId: attempt.id,
      attemptKind: attempt.kind,
      stage: "candidate",
      captureDigest: proof,
      candidateDigest: candidate.integrityDigest,
      receiptDigest: receipt?.integrityDigest ?? null,
      refusal: null
    });
    // Publish: recheck cancellation and destination ownership, then replace
    // only the exact implementation report with a same-directory rename.
    const current = await this.store.readState(state.runId);
    if (current.status === "cancelled")
      return { kind: "stopped", state: current };
    const destination = path.join(this.repoRoot, candidate.destination);
    if (!published) {
      if (candidate.destination.startsWith(".banzai/"))
        await safePath(this.repoRoot, candidate.destination);
      const before = await this.observeReport(candidate.destination);
      if (
        before.observation.state !== "present" ||
        before.observation.sha256 !== candidate.inputSha256
      )
        throw drift(
          "The implementation report changed before publication.",
          "publication"
        );
      try {
        const mode = (await lstat(destination)).mode & 0o777;
        const temporary = `${destination}.${randomUUID()}.completion.tmp`;
        await writeFile(temporary, composition.bytes, { flag: "wx", mode });
        try {
          await rename(temporary, destination);
        } catch (error) {
          await unlink(temporary).catch(() => undefined);
          throw error;
        }
      } catch (error) {
        if (error instanceof TerminalRunStateError) throw error;
        throw new CompletionRefusal(
          "COMPLETION_PUBLICATION_IO",
          "publication",
          candidate.integrityDigest,
          "Retry with banzai resume once storage is available, or cancel."
        );
      }
    }
    const final = await this.observeReport(candidate.destination);
    if (
      final.observation.state !== "present" ||
      final.observation.sha256 !== candidate.outputSha256
    )
      throw integrity(
        "The published implementation report does not equal the candidate bytes.",
        "publication"
      );
    // Receipt: immutable, bound to capture, candidate and terminal proof.
    let sealedReceipt: CompletionPublication;
    if (receipt !== null) {
      sealedReceipt = receipt;
    } else {
      const ledgerAuthor = capture.ledgerSource ?? {
        attemptId: attempt.id,
        attemptKind: attempt.kind,
        ledgerDigest: claims.ledgerDigest
      };
      const body: Omit<CompletionPublication, "integrityDigest"> = {
        schema: COMPLETION_PUBLICATION_SCHEMA,
        schemaVersion: COMPLETION_RECORD_SCHEMA_VERSION,
        runId: state.runId,
        attemptId: attempt.id,
        attemptKind: attempt.kind,
        completionProtocol: COMPLETION_PROTOCOL,
        captureDigest: proof,
        candidateDigest: candidate.integrityDigest,
        terminalIntegrityDigest: capture.terminalIntegrityDigest,
        authority: {
          baseCommit: capture.baseCommit,
          approvalDigest: capture.approvalDigest,
          planTaskDigest: capture.planTaskDigest,
          scopeDigest: capture.scopeDigest,
          workBindingSha256: capture.workBinding?.sha256 ?? null,
          configurationDigest: capture.configurationDigest
        },
        ledgerAuthor,
        publisher: { attemptId: attempt.id, attemptKind: attempt.kind },
        implementationReport: {
          path: candidate.destination,
          sha256: candidate.outputSha256
        },
        testReport: {
          path: claims.testReport.path,
          sha256: capturedTest.sha256
        },
        // Receipt identity remains stable when publication resumes later.
        publishedAt: capture.capturedAt
      };
      sealedReceipt = {
        ...body,
        integrityDigest: completionRecordIntegrity(body)
      };
      try {
        await this.store.writeCompletionPublication(state.runId, sealedReceipt);
      } catch (error) {
        if (error instanceof TerminalRunStateError) throw error;
        throw new CompletionRefusal(
          "COMPLETION_PUBLICATION_IO",
          "receipt",
          candidate.integrityDigest,
          "Retry with banzai resume once storage is available, or cancel."
        );
      }
    }
    // Apply once: attempt completion, canonical summary, cursor and events.
    return {
      kind: "applied",
      result: await this.applyCompletionPublication(
        state,
        record,
        envelope,
        ledger,
        claims,
        sealedReceipt
      )
    };
  }

  private async applyCompletionPublication(
    state: RunState,
    record: AttemptRecord,
    envelope: PhaseResultEnvelope,
    ledger: PlanTaskCompletionLedger,
    claims: ValidatedCompletionClaims,
    receipt: CompletionPublication
  ): Promise<PhaseResult> {
    const attempt = record.attempt as AttemptReference & {
      kind: "implementation" | "fix";
    };
    const io = (stage: CompletionPublicationStage) =>
      new CompletionRefusal(
        "COMPLETION_PUBLICATION_IO",
        stage,
        receipt.integrityDigest,
        "Retry with banzai resume once storage is available, or cancel."
      );
    if (record.status !== "completed") {
      record.status = "completed";
      record.completedAt ??= now();
      record.durationMs ??=
        Date.parse(record.completedAt) - Date.parse(record.startedAt);
      record.error = null;
      record.failureCode = null;
      try {
        await this.store.writeRunAttempt(state.runId, record);
      } catch (error) {
        if (error instanceof TerminalRunStateError) throw error;
        throw io("attempt");
      }
    }
    const current = await this.store.readState(state.runId);
    if (current.status === "cancelled")
      throw new TerminalRunStateError(current);
    this.accountCompletedAttempt(state, record);
    const refreshedFix =
      attempt.kind === "fix" && receipt.ledgerAuthor.attemptId === attempt.id;
    const durable = state.planTaskCompletion;
    // Re-entry after an interrupted application completes the missing writes
    // without restamping a summary this exact receipt already established.
    const applied =
      durable?.status === "valid" &&
      durable.schemaVersion === COMPLETION_SUMMARY_SCHEMA_VERSION &&
      durable.publication?.sha256 === receipt.integrityDigest;
    if (!applied)
      state.planTaskCompletion = {
        schemaVersion: COMPLETION_SUMMARY_SCHEMA_VERSION,
        status: "valid",
        sourceAttemptId: receipt.ledgerAuthor.attemptId,
        sourceAttemptKind: receipt.ledgerAuthor.attemptKind,
        approvalDigest: claims.approvalDigest,
        planTaskDigest: claims.planTaskDigest,
        ledgerDigest: claims.ledgerDigest,
        implementationReport: receipt.implementationReport,
        testReport: receipt.testReport,
        counts: claims.counts,
        validatedAt: now(),
        completionProtocol: COMPLETION_PROTOCOL,
        publisherAttemptId: attempt.id,
        publication: {
          path: this.store.completionEvidenceRelativePath(
            state.runId,
            attempt,
            "completion-publication.json"
          ),
          sha256: receipt.integrityDigest
        }
      };
    state.completionPublication = {
      attemptId: attempt.id,
      attemptKind: attempt.kind,
      stage: "state",
      captureDigest: receipt.captureDigest,
      candidateDigest: receipt.candidateDigest,
      receiptDigest: receipt.integrityDigest,
      refusal: null
    };
    state.activeProcess = null;
    try {
      await this.store.writeState(state);
    } catch (error) {
      if (error instanceof TerminalRunStateError) throw error;
      throw io("state");
    }
    try {
      await this.store.appendEventOnce(
        state.runId,
        "completion.publication_applied",
        {
          attemptId: attempt.id,
          attemptKind: attempt.kind,
          stage: "event",
          proofDigest: receipt.integrityDigest,
          code: null,
          violation: null,
          taskId: null
        }
      );
      if (refreshedFix)
        await this.store.appendEventOnce(
          state.runId,
          "plan_task_completion.refreshed",
          {
            attemptId: attempt.id,
            ledgerDigest: claims.ledgerDigest
          }
        );
    } catch (error) {
      if (error instanceof TerminalRunStateError) throw error;
      throw io("event");
    }
    if (state.completionPublication.stage !== "event") {
      await this.storeCursor(state, {
        ...state.completionPublication,
        stage: "event"
      });
    }
    return { ...envelopeResultFields(envelope), taskCompletion: ledger };
  }

  /**
   * Live route for a strict attempt under the completion protocol after the
   * vendor returned: persist the original result and envelope, then either
   * apply a stop or capture and publish a completion claim.
   */
  private async applyCompletionResult(
    state: RunState,
    record: AttemptRecord,
    adapterResult: AdapterResult<PhaseResult | PhaseResultEnvelope>,
    config: OrchestratorConfig,
    resumeSessionId: string | null,
    context: SessionContext
  ): Promise<RunState> {
    const envelope = this.completionEnvelopeOf(adapterResult.result);
    await this.writeAttemptOutput(
      state,
      record,
      adapterResult.stdout,
      adapterResult.stderr
    );
    record.usage = adapterResult.usage;
    record.result = JSON.parse(envelope.original) as PersistedPhaseResult;
    record.envelope = envelope;
    record.sessionId = adapterResult.sessionId ?? record.sessionId;
    record.durationMs = Date.now() - Date.parse(record.startedAt);
    if (envelope.phase !== record.attempt.kind)
      throw new BanzaiError(
        "PHASE_RESULT_MISMATCH",
        `Attempt ${record.attempt.kind} returned phase ${envelope.phase}.`
      );
    const sessionId = adapterResult.sessionId ?? resumeSessionId;
    if (envelope.outcome !== "completed" || envelope.gate !== null) {
      await this.store.writeRunAttempt(state.runId, record);
      return await this.applyCompletionStop(
        state,
        record,
        envelope,
        config,
        sessionId,
        context
      );
    }
    record.status = "pending_application";
    record.completedAt = now();
    await this.store.writeRunAttempt(state.runId, record);
    const current = await this.store.readState(state.runId);
    if (current.status === "cancelled") return current;
    this.accountAttemptUsage(state, record);
    state.activeProcess = null;
    await this.store.writeState(state);
    const outcome = await this.continueCompletionPublication(
      state,
      record,
      config
    );
    if (outcome.kind === "stopped") return outcome.state;
    return await this.applyPhaseResult(
      state,
      record.attempt,
      outcome.result,
      sessionId,
      context
    );
  }

  /**
   * Resume/status reconciliation for a protocol attempt whose vendor returned:
   * proven terminal evidence becomes pending_application, then the same
   * deterministic publication continues without another model call.
   */
  private async reconcileCompletionAttempt(
    state: RunState,
    record: AttemptRecord,
    config: OrchestratorConfig
  ): Promise<RunState | null> {
    const attempt = record.attempt as AttemptReference & {
      kind: "implementation" | "fix";
    };
    const settings = config.models.implementer;
    const context =
      record.sessionContext ?? sessionContext("implementer", settings);
    // A parent crash after the vendor returned leaves a started or failed
    // record beside durable terminal proof. Conflicting proof and a final
    // input rejection are never replayed; every other case reconciles.
    const promotable =
      record.status === "started" ||
      (record.status === "failed" &&
        !TERMINAL_INTEGRITY_FAILURE_CODES.has(record.failureCode ?? "") &&
        record.failureCode !== "PLAN_TASK_COMPLETION_INVALID");
    if (promotable) {
      const checkpoint = await this.store.readTerminalCheckpointIfExists(
        state.runId,
        attempt
      );
      if (checkpoint === null) return null;
      if (checkpoint.schemaVersion !== 2) {
        throw new BanzaiError(
          "TERMINAL_CHECKPOINT_MISMATCH",
          "A protocol attempt cannot reconcile a legacy terminal checkpoint."
        );
      }
      const expectedContext = record.sessionContext ?? context;
      if (
        checkpoint.runId !== state.runId ||
        checkpoint.attempt.id !== attempt.id ||
        checkpoint.attempt.kind !== attempt.kind ||
        checkpoint.baseCommit !== state.baseCommit ||
        checkpoint.approvalDigest !== (state.planApproval?.digest ?? null) ||
        checkpoint.workflowDigest !== null ||
        checkpoint.scopeDigest !== this.attemptScopeDigest(state, attempt) ||
        checkpoint.configuration.vendor !==
          (vendorFor(settings.executable) ?? FALLBACK_VENDOR.implementer) ||
        checkpoint.configuration.executableDigest !==
          digestCanonicalJson(settings.executable) ||
        checkpoint.configuration.model !== settings.model ||
        checkpoint.configuration.effort !== settings.effort ||
        checkpoint.configuration.sessionMode !==
          (record.sessionMode ?? "fresh") ||
        checkpoint.configuration.sessionContextDigest !==
          digestCanonicalJson(expectedContext) ||
        state.recovery?.sourceAttemptId === attempt.id
      ) {
        throw new BanzaiError(
          "TERMINAL_CHECKPOINT_MISMATCH",
          "Terminal checkpoint does not match the active run, attempt, authorization, or model context."
        );
      }
      await this.validateBaseCommit(state);
      await this.validateApproval(state);
      await this.validateSavedArtifactScope(state, attempt);
      this.validateArtifactRoleReferences(state, checkpoint.envelope);
      const envelope = checkpoint.envelope;
      record.result = JSON.parse(envelope.original) as PersistedPhaseResult;
      record.envelope = envelope;
      record.sessionId = checkpoint.sessionId;
      record.usage = checkpoint.usage;
      record.completedAt = checkpoint.terminal.observedAt;
      record.error = null;
      record.failureCode = null;
      record.durationMs = Math.max(
        0,
        Date.parse(checkpoint.terminal.observedAt) -
          Date.parse(record.startedAt)
      );
      await this.store.appendEventOnce(
        state.runId,
        "attempt.terminal_reconciled",
        {
          attemptId: attempt.id,
          kind: attempt.kind
        }
      );
      if (envelope.outcome !== "completed" || envelope.gate !== null) {
        await this.store.writeRunAttempt(state.runId, record);
        state.activeProcess = null;
        return await this.applyCompletionStop(
          state,
          record,
          envelope,
          config,
          record.sessionId ?? record.resumeSessionId ?? null,
          context
        );
      }
      record.status = "pending_application";
      await this.store.writeRunAttempt(state.runId, record);
      this.accountAttemptUsage(state, record);
      state.activeProcess = null;
      await this.store.writeState(state);
    } else if (record.status === "completed") {
      // A process death between the attempt-completed write and the durable
      // summary, cursor and events leaves a completed protocol record that the
      // run state still names active. Its retained stop envelope or publication
      // receipt is the proof, so application continues idempotently here rather
      // than falling through to the legacy terminal-checkpoint promoter, which
      // would reject this attempt's v2 proof as a legacy mismatch.
      const decoded = record.envelope ?? null;
      if (decoded === null)
        return await this.refuseCompletionPublication(
          state,
          record,
          new CompletionRefusal(
            "COMPLETION_PUBLICATION_INTEGRITY",
            "attempt",
            state.completionPublication?.receiptDigest ?? null,
            "The completed protocol attempt has no retained envelope; cancel the run."
          )
        );
      state.activeProcess = null;
      if (decoded.outcome !== "completed" || decoded.gate !== null)
        return await this.applyCompletionStop(
          state,
          record,
          decoded,
          config,
          record.sessionId ?? record.resumeSessionId ?? null,
          context
        );
      let applied: CompletionPublication | null;
      try {
        applied = await this.store.readCompletionPublicationIfExists(
          state.runId,
          attempt
        );
      } catch {
        applied = null;
      }
      if (applied === null)
        return await this.refuseCompletionPublication(
          state,
          record,
          new CompletionRefusal(
            "COMPLETION_PUBLICATION_INTEGRITY",
            "receipt",
            state.completionPublication?.candidateDigest ?? null,
            "The completed protocol attempt has no intact publication receipt; cancel the run."
          )
        );
    } else if (record.status !== "pending_application") {
      return null;
    }
    const durableRefusal =
      state.completionPublication?.attemptId === attempt.id
        ? state.completionPublication.refusal
        : null;
    if (
      durableRefusal !== null &&
      !(await this.appendCompletionPublicationRefusalEvent(
        state,
        record,
        durableRefusal
      ))
    )
      return state;
    if (state.status === "blocked") {
      const from =
        attempt.kind === "implementation" ? "implementing" : "fixing";
      if (state.blockedFrom !== from)
        throw new BanzaiError(
          "TERMINAL_CHECKPOINT_MISMATCH",
          "Pending completion publication does not match the blocked phase."
        );
      transitionState(state, from);
    }
    const outcome = await this.continueCompletionPublication(
      state,
      record,
      config
    );
    if (outcome.kind === "stopped") return outcome.state;
    return await this.applyPhaseResult(
      state,
      attempt,
      outcome.result,
      record.sessionId ?? record.resumeSessionId ?? null,
      context
    );
  }

  /**
   * Read-only revalidation of a runner-published completion: canonical source,
   * receipt, final report hashes, task set, evidence paths and authority. No
   * report write, receipt creation or digest refresh happens here.
   */
  /** Receipt, capture and candidate identities frozen into a v5 review snapshot. */
  private async frozenCompletionPublication(
    state: RunState,
    summary: ValidPlanTaskCompletionSummary
  ): Promise<ReviewCompletionPublication | null> {
    if (
      summary.schemaVersion !== COMPLETION_SUMMARY_SCHEMA_VERSION ||
      summary.publisherAttemptId === undefined ||
      summary.publication === undefined
    )
      return null;
    const receipt = await this.store.readCompletionPublicationIfExists(
      state.runId,
      { id: summary.publisherAttemptId }
    );
    if (receipt?.integrityDigest !== summary.publication.sha256)
      throw new BanzaiError(
        "INVALID_REVIEW_SNAPSHOT",
        "The published completion receipt is missing or conflicts with the canonical summary."
      );
    return {
      completionProtocol: COMPLETION_PROTOCOL,
      publisherAttemptId: summary.publisherAttemptId,
      receiptPath: summary.publication.path,
      receiptDigest: receipt.integrityDigest,
      captureDigest: receipt.captureDigest,
      candidateDigest: receipt.candidateDigest
    };
  }

  private async revalidatePublishedCompletion(
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
    const receipt = await this.store
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
    const author = await this.store
      .readRunAttemptIfExists(state.runId, {
        id: receipt.ledgerAuthor.attemptId,
        kind: receipt.ledgerAuthor.attemptKind,
        mutable: true
      })
      .catch(() => null);
    const ledger = author === null ? null : this.recordLedger(author);
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
      repoRoot: this.repoRoot,
      artifactBinding: state.artifactBinding,
      ledger,
      outcome: "completed",
      artifacts: {
        implementationReport: receipt.implementationReport.path,
        testReport: receipt.testReport.path
      },
      planPath: this.completionPlanPath(state),
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

  /**
   * Read-only publication route for status: pending I/O resumes; drift resumes
   * only once the recorded input or proven output and authority are restored;
   * corrupt or conflicting proof exposes cancel.
   */
  private async completionPublicationStatus(
    state: RunState
  ): Promise<WorkflowStatus["completionPublication"]> {
    const cursor = state.completionPublication ?? null;
    if (cursor === null) return null;
    const attempt = {
      id: cursor.attemptId,
      kind: cursor.attemptKind,
      mutable: true
    };
    const record = await this.store
      .readRunAttemptIfExists(state.runId, attempt)
      .catch(() => null);
    const pending = record?.status === "pending_application";
    let action: "resume" | "cancel" | null = null;
    if (pending && state.status === "blocked") {
      const code = cursor.refusal?.code ?? "COMPLETION_PUBLICATION_IO";
      if (code === "COMPLETION_PUBLICATION_INTEGRITY") action = "cancel";
      else {
        action = "cancel";
        try {
          const capture = await this.store.readCompletionCaptureIfExists(
            state.runId,
            attempt
          );
          const candidate = await this.store.readCompletionCandidateIfExists(
            state.runId,
            attempt
          );
          if (record.envelope) {
            const inputs = await this.observeCompletionInputs(
              state,
              record.envelope.artifacts
            );
            const config = await loadConfig(this.repoRoot);
            let restored = false;
            if (capture === null && candidate === null) {
              const checkpoint =
                await this.store.readTerminalCheckpointIfExists(
                  state.runId,
                  attempt
                );
              restored =
                checkpoint?.schemaVersion === 2 &&
                checkpoint.observed.workspaceDigest !== null &&
                sameObservedInputs(inputs.observed, checkpoint.observed) &&
                (await this.completionCheckpointAuthorityCurrent(
                  state,
                  record,
                  checkpoint,
                  config
                ));
            } else if (capture !== null) {
              const implementation = inputs.observed.implementationReport;
              const test = inputs.observed.testReport;
              restored =
                implementation.state === "present" &&
                test.state === "present" &&
                capture.reports.testReport.state === "present" &&
                test.sha256 === capture.reports.testReport.sha256 &&
                ((capture.reports.implementationReport.state === "present" &&
                  implementation.sha256 ===
                    capture.reports.implementationReport.sha256) ||
                  (candidate !== null &&
                    implementation.sha256 ===
                      candidate.candidate.outputSha256)) &&
                inputs.observed.workspaceDigest === capture.workspace.digest &&
                (await this.completionAuthorityCurrent(state, capture, config));
            }
            if (restored) action = "resume";
          }
        } catch {
          action = "cancel";
        }
      }
    }
    return {
      attemptId: cursor.attemptId,
      attemptKind: cursor.attemptKind,
      stage: cursor.stage,
      refusal: cursor.refusal?.code ?? null,
      pending,
      action
    };
  }

  /**
   * Names what a phase produced, once. The artifacts and the task ledger are
   * known only when the result parses, so this is a completion summary rather
   * than live progress: neither vendor streams either of them.
   */
  private reportPhaseOutcome(
    kind: AttemptReference["kind"],
    result: PersistedPhaseResult
  ): void {
    // Verb-leading clauses, so the sentence reads whichever parts are present:
    // a noun-phrase list produces "Produced 27 files changed".
    const clauses: string[] = [];
    if (kind === "plan") {
      const written: string[] = [];
      if (result.artifacts.description !== null) {
        written.push("a description");
      }
      const adrs = result.artifacts.adrs.length;
      if (adrs > 0) {
        written.push(adrs === 1 ? "an ADR" : `${adrs} ADRs`);
      }
      if (result.artifacts.plan !== null) {
        written.push("a plan");
      }
      if (written.length > 0) {
        clauses.push(`wrote ${listPhrase(written)}`);
      }
    } else {
      const tasks = result.taskCompletion?.tasks ?? [];
      if (tasks.length > 0) {
        const completed = tasks.filter(
          (task) => task.status === "completed"
        ).length;
        clauses.push(`completed ${completed}/${tasks.length} plan tasks`);
      }
      const reports: string[] = [];
      if (result.artifacts.implementationReport !== null) {
        reports.push("an implementation report");
      }
      if (result.artifacts.testReport !== null) {
        reports.push("a test report");
      }
      if (reports.length > 0) {
        clauses.push(`wrote ${listPhrase(reports)}`);
      }
      const touched = result.touchedPaths.length;
      if (touched > 0) {
        clauses.push(`changed ${touched} file${touched === 1 ? "" : "s"}`);
      }
    }
    const sentence = clauses.join(", ");
    if (sentence.length > 0) {
      this.info(`${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}`);
    }
  }

  private async applyPhaseResult(
    state: RunState,
    attempt: AttemptReference,
    result: PersistedPhaseResult,
    sessionId: string | null,
    context: SessionContext
  ): Promise<RunState> {
    this.validateArtifactRoleReferences(state, result);
    if (result.phase !== attempt.kind) {
      throw new BanzaiError(
        "PHASE_RESULT_MISMATCH",
        `Attempt ${attempt.kind} returned phase ${result.phase}.`
      );
    }
    this.reportPhaseOutcome(attempt.kind, result);
    if (attempt.kind === "plan") {
      state.sessions.planner = sessionBinding(sessionId, {
        ...context,
        role: "planner"
      });
      state.planArtifacts = result.artifacts;
      if (result.outcome === "blocked") {
        blockState(state, result.summary);
      } else if (result.gate === "adr_approval") {
        transitionState(state, "needs_adr_approval");
      } else if (result.gate === "decision_consultation") {
        const request =
          "decisionConsultation" in result ? result.decisionConsultation : null;
        if (request === null) {
          throw new BanzaiError(
            "INVALID_RESULT",
            "Decision consultation gate is missing its typed request."
          );
        }
        const priorRequestIds = new Set<string>();
        const priorRoundIds = new Set<string>();
        const priorDecisionIds = new Set<string>();
        for (const decision of state.humanDecisions ?? []) {
          if (decision.kind !== "decision_consultation") continue;
          priorRequestIds.add(decision.requestId);
          priorRoundIds.add(decision.roundId);
          for (const card of decision.request.decisions) {
            priorDecisionIds.add(card.decisionId);
          }
        }
        if (
          priorRequestIds.has(request.requestId) ||
          priorRoundIds.has(request.roundId) ||
          request.decisions.some((card) =>
            priorDecisionIds.has(card.decisionId)
          )
        ) {
          throw new BanzaiError(
            "INVALID_RESULT",
            "Decision consultation reused an answered request, round, or decision identity."
          );
        }
        state.pendingHumanDecision = {
          kind: "decision_consultation",
          phase: "plan",
          gate: "decision_consultation",
          summary: result.summary,
          request,
          requestedAt: now()
        };
        transitionState(state, "needs_human_decision");
      } else if (result.gate === "escalation") {
        state.pendingHumanDecision = {
          kind: "escalation",
          phase: "plan",
          gate: result.gate,
          summary: result.summary,
          questions: result.questions,
          requestedAt: now()
        };
        transitionState(state, "needs_human_decision");
      } else {
        artifactPaths(state);
        transitionState(state, "needs_plan_approval");
      }
    } else {
      state.sessions.implementer = sessionBinding(sessionId, {
        ...context,
        role: "implementer"
      });
      if (result.outcome === "needs_human_decision" && result.gate !== null) {
        if (result.gate !== "escalation") {
          throw new BanzaiError(
            "INVALID_RESULT",
            "Only escalation is valid outside the planning consultation gate."
          );
        }
        if (
          attempt.kind === "implementation" &&
          state.workflowSelection?.workflow !== undefined &&
          state.workflowSelection.workflow !== "strict"
        ) {
          const snapshot = await workspaceSnapshot(this.repoRoot, {
            artifactBinding: state.artifactBinding,
            baseline: state.baseline
          });
          const sourceChanges = snapshot.entries
            .map((entry) => entry.path)
            .filter(
              (entryPath) =>
                !isDocumentationPath(entryPath) &&
                !(
                  state.artifactBinding &&
                  ownsArtifact(state.artifactBinding.binding, entryPath)
                )
            );
          if (sourceChanges.length > 0) {
            blockState(
              state,
              `Lite workflow requested escalation after source changes: ${sourceChanges.join(", ")}. Inspect the checkout and cancel the run.`
            );
            state.activeAttempt = null;
            await this.store.writeState(state);
            return state;
          }
        }
        state.pendingHumanDecision = {
          kind: "escalation",
          phase: attempt.kind,
          gate: result.gate,
          summary: result.summary,
          questions: result.questions,
          requestedAt: now()
        };
        transitionState(state, "needs_human_decision");
      } else if (result.outcome !== "completed" || result.gate !== null) {
        blockState(state, result.summary);
      } else {
        if (attempt.kind === "fix") {
          state.fixCycle += 1;
        }
        transitionState(state, "verifying");
        state.verification = [];
      }
    }
    state.activeAttempt = null;
    await this.store.writeState(state);
    const timingEvent = await this.store.appendEvent(
      state.runId,
      "attempt.applied",
      {
        attemptId: attempt.id,
        kind: attempt.kind,
        outcome: result.outcome,
        gate: result.gate,
        status: state.status
      }
    );
    await this.observeHumanTime(
      state,
      "gate_pending",
      "attempt.applied",
      timingEvent.at,
      attempt.id
    );
    if (
      state.pendingHumanDecision?.kind === "decision_consultation" &&
      state.pendingHumanDecision.request.requestId ===
        ("decisionConsultation" in result
          ? result.decisionConsultation?.requestId
          : undefined)
    ) {
      await this.store.appendEvent(
        state.runId,
        "decision.consultation.requested",
        {
          cardCount: state.pendingHumanDecision.request.decisions.length,
          completion: "pending"
        }
      );
    }
    if (state.status === "verifying") {
      return await this.executeVerification(
        state,
        await loadConfig(this.repoRoot),
        attempt.kind === "implementation" || attempt.kind === "fix"
          ? attempt
          : undefined
      );
    }
    return state;
  }

  private async verificationSourceAttempt(
    state: RunState,
    records: readonly VerificationAttemptRecord[],
    sourceAttempt?: AttemptReference
  ): Promise<AttemptReference & { kind: "implementation" | "fix" }> {
    if (
      sourceAttempt !== undefined &&
      (sourceAttempt.kind === "implementation" || sourceAttempt.kind === "fix")
    ) {
      return {
        id: sourceAttempt.id,
        kind: sourceAttempt.kind,
        mutable: sourceAttempt.mutable
      };
    }
    if (
      hasConfigurationSetup(state) &&
      state.configurationSetup?.continuation
    ) {
      const continuation = state.configurationSetup.continuation;
      await this.validateConfigurationContinuation(state, continuation);
      return {
        id: continuation.attemptId,
        kind: continuation.attemptKind,
        mutable: true
      };
    }
    const latest = records.at(-1);
    if (latest !== undefined) {
      return {
        id: latest.round.sourceAttemptId,
        kind: latest.round.sourceAttemptKind,
        mutable: true
      };
    }
    for (const attemptId of [...state.metrics.completedAttemptIds].reverse()) {
      for (const kind of ["fix", "implementation"] as const) {
        const attempt = { id: attemptId, kind, mutable: true };
        const record = await this.store.readRunAttemptIfExists(
          state.runId,
          attempt
        );
        if (record?.status === "completed") {
          return attempt;
        }
      }
    }
    throw new BanzaiError(
      "VERIFICATION_ROUND_SOURCE_MISSING",
      "Verification cannot identify its completed implementation or fix attempt."
    );
  }

  private verificationRound(
    records: readonly VerificationAttemptRecord[],
    sourceAttempt: AttemptReference & { kind: "implementation" | "fix" }
  ): VerificationAttemptRecord["round"] {
    const existing = records.find(
      (record) => record.round.sourceAttemptId === sourceAttempt.id
    );
    if (existing !== undefined) {
      if (existing.round.sourceAttemptKind !== sourceAttempt.kind) {
        throw new BanzaiError(
          "VERIFICATION_ATTEMPT_CONFLICT",
          "Verification round source identity has conflicting kinds."
        );
      }
      return existing.round;
    }
    const roundIds = new Set(records.map((record) => record.round.id));
    return {
      id: `verification-round-${sourceAttempt.id}`,
      ordinal: roundIds.size + 1,
      sourcePhase: sourceAttempt.kind,
      sourceAttemptId: sourceAttempt.id,
      sourceAttemptKind: sourceAttempt.kind
    };
  }

  private reconcileVerificationState(
    state: RunState,
    records: readonly VerificationAttemptRecord[],
    round: VerificationAttemptRecord["round"],
    descriptors: readonly VerificationCommandDescriptor[]
  ): void {
    const byIdentity = new Map(
      descriptors.map((descriptor) => [
        `${descriptor.profileOrdinal}:${descriptor.commandOrdinal}`,
        descriptor
      ])
    );
    const roundRecords = records.filter((item) => item.round.id === round.id);
    for (const record of roundRecords) {
      const descriptor = byIdentity.get(
        `${record.command.profileOrdinal}:${record.command.commandOrdinal}`
      );
      if (
        descriptor === undefined ||
        !verificationCommandMatches(record, descriptor)
      ) {
        throw new BanzaiError(
          "VERIFICATION_CONFIGURATION_CHANGED",
          "Configured verification commands changed during an open verification round."
        );
      }
    }
    const retained: VerificationResult[] = [];
    for (const descriptor of descriptors) {
      const record = roundRecords
        .filter(
          (item) =>
            item.command.profileOrdinal === descriptor.profileOrdinal &&
            item.command.commandOrdinal === descriptor.commandOrdinal &&
            (item.status === "completed" || item.status === "failed") &&
            item.exitCode !== null &&
            item.completedAt !== null &&
            item.stdout !== null &&
            item.stderr !== null
        )
        .at(-1);
      if (record === undefined) {
        continue;
      }
      if (
        record.exitCode === null ||
        record.completedAt === null ||
        record.stdout === null ||
        record.stderr === null
      ) {
        continue;
      }
      retained.push({
        name: descriptor.command.name,
        command: descriptor.command.command,
        args: descriptor.command.args,
        exitCode: record.exitCode,
        signal: record.signal,
        stdoutPath: record.stdout.relativePath,
        stderrPath: record.stderr.relativePath,
        startedAt: record.startedAt,
        completedAt: record.completedAt
      });
    }
    state.metrics.attempts.verification = records.length;
    state.verification = retained;
  }

  private verificationStorage(state: RunState): VerificationStorage {
    if (!usesVerificationPolicy(state) || !state.artifactBinding)
      throw new BanzaiError(
        "VERIFICATION_EVIDENCE_INVALID",
        "Verification applicability requires its original work binding."
      );
    return {
      repoRoot: this.repoRoot,
      workId: state.artifactBinding.binding.workId,
      directory: `.banzai/runs/${state.runId}/verification`
    };
  }

  private verificationAuthority(state: RunState): string {
    return evidenceDigest({
      binding: state.artifactBinding?.sha256,
      approval: state.planApproval?.digest ?? null,
      workflow: state.workflowSelection
    });
  }

  private async captureVerification(
    state: RunState,
    config: OrchestratorConfig
  ): Promise<VerificationCapture> {
    if (config.schemaVersion !== 3 || !config.verification.policy)
      throw new BanzaiError(
        "VERIFICATION_CONFIGURATION_CHANGED",
        "Verification-enabled runs require their explicit project policy."
      );
    const configuration = parseVerificationConfiguration(config.verification);
    const input = {
      repoRoot: this.repoRoot,
      configuration,
      workId: this.verificationStorage(state).workId,
      evidenceDirectories: [
        `.banzai/runs/${state.runId}`,
        ".banzai/runner.lock"
      ]
    };
    const before = await captureVerificationInputs(input);
    const after = await captureVerificationInputs(input);
    return sameVerificationCapture(before, after) ||
      (!before.complete && !after.complete)
      ? after
      : {
          complete: false,
          reason: "inputs_unavailable",
          candidateDigest: null,
          checks: []
        };
  }

  private async prepareVerificationDecision(
    state: RunState,
    config: OrchestratorConfig,
    round: VerificationAttemptRecord["round"],
    records: VerificationAttemptRecord[]
  ): Promise<VerificationCapture> {
    const storage = this.verificationStorage(state);
    const configuration = parseVerificationConfiguration(config.verification);
    const strict = (state.workflowSelection?.workflow ?? "strict") === "strict";
    const plan = strict
      ? await readFile(
          path.join(this.repoRoot, this.completionPlanPath(state)),
          "utf8"
        )
      : null;
    const current = await this.captureVerification(state, config);
    const origins = await readVerificationOrigins(storage, records);
    const decision = decideVerification({
      workId: storage.workId,
      roundId: round.id,
      configuration,
      authorityDigest: this.verificationAuthority(state),
      strict,
      obligations: parseVerificationObligations(plan, configuration),
      capture: current,
      origins
    });
    await persistVerificationDecision(storage, decision);
    state.verificationEvidence = { decision, applicability: null };
    return current;
  }

  private async requireVerificationApplicability(
    state: RunState,
    config?: OrchestratorConfig
  ): Promise<boolean> {
    if (
      hasConfigurationSetup(state) &&
      state.configurationSetup?.coverage === "skipped"
    ) {
      const current = await loadConfig(this.repoRoot);
      const inspection = await inspectVerificationProject(this.repoRoot);
      if (!this.configurationSkipCurrent(state, current, inspection)) {
        const records = await this.store.readVerificationAttempts(state.runId);
        const source = await this.verificationSourceAttempt(state, records);
        if (
          !(await this.inspectConfigurationCheckpoint(
            state,
            current,
            source,
            records
          ))
        ) {
          // Coverage was repaired externally; establish a fresh verification round
          // from the retained completed attempt before considering review complete.
          if (state.status !== "verifying") transitionState(state, "verifying");
          await this.store.writeState(state);
          await this.executeVerification(state, current, source);
        }
        return false;
      }
      await this.assertConfigurationSkipAuthority(state, current);
      const continuation = state.configurationSetup.continuation;
      if (!continuation)
        throw new BanzaiError(
          "VERIFICATION_EVIDENCE_INVALID",
          "Skipped coverage has no completed verification checkpoint."
        );
      const records = await this.store.readVerificationAttempts(state.runId);
      const descriptors = describeVerificationCommands(current).filter((item) =>
        isRepositoryHygieneCommand(item.command)
      );
      this.reconcileVerificationState(
        state,
        records,
        {
          ...continuation.verificationRound,
          sourcePhase: continuation.attemptKind,
          sourceAttemptId: continuation.attemptId,
          sourceAttemptKind: continuation.attemptKind
        },
        descriptors
      );
      for (const descriptor of descriptors) {
        const record = records
          .filter(
            (item) =>
              item.round.id === continuation.verificationRound.id &&
              verificationCommandMatches(item, descriptor)
          )
          .at(-1);
        if (
          record?.status !== "completed" ||
          record.exitCode !== 0 ||
          record.signal !== null ||
          !record.stdout ||
          !record.stderr
        )
          throw new BanzaiError(
            "VERIFICATION_EVIDENCE_INVALID",
            "Hygiene verification is incomplete; Skip does not create execution evidence."
          );
        for (const log of [record.stdout, record.stderr]) {
          const file = await readCancellationFile(
            this.repoRoot,
            `.banzai/runs/${state.runId}/${log.relativePath}`,
            32 * 1024 * 1024
          );
          if (
            file.availability !== "available" ||
            file.fingerprint?.digest !== log.sha256
          )
            throw new BanzaiError(
              "VERIFICATION_EVIDENCE_INVALID",
              "Hygiene verification logs are missing or changed; re-establish verification evidence."
            );
        }
      }
      return true;
    }
    if (!usesVerificationPolicy(state)) return true;
    if (!(await hasRunnerWorkOwnership(this.repoRoot, state.artifactBinding)))
      return withRunnerWorkOwnership(this.repoRoot, state.artifactBinding, () =>
        this.requireVerificationApplicability(state, config)
      );
    try {
      const currentConfig = await loadConfig(this.repoRoot);
      if (
        config &&
        JSON.stringify(currentConfig.verification) !==
          JSON.stringify(config.verification)
      )
        throw new BanzaiError(
          "VERIFICATION_CONFIGURATION_CHANGED",
          "Project verification policy changed during execution."
        );
      const evidence = state.verificationEvidence;
      const configuration = parseVerificationConfiguration(
        currentConfig.verification
      );
      if (
        evidence?.decision.authorityDigest !==
          this.verificationAuthority(state) ||
        evidence.decision.configurationDigest !==
          evidenceDigest({ schema: 3, verification: configuration })
      )
        throw new BanzaiError(
          "VERIFICATION_EVIDENCE_INVALID",
          "Verification authority changed or evidence is missing."
        );
      const storage = this.verificationStorage(state);
      const origins = await readVerificationOrigins(
        storage,
        await this.store.readVerificationAttempts(state.runId)
      );
      const current = await this.captureVerification(state, currentConfig);
      const applicability = verificationApplicability(
        evidence.decision,
        origins,
        current
      );
      await persistVerificationApplicability(storage, applicability);
      evidence.applicability = applicability;
      if (!applicability.complete)
        throw new BanzaiError(
          "VERIFICATION_EVIDENCE_INVALID",
          "Current verification evidence is incomplete or its inputs changed. Required verification must be re-established."
        );
      return true;
    } catch (error) {
      blockState(state, errorMessage(error));
      await this.store.writeState(state);
      return false;
    }
  }

  private async executeVerification(
    state: RunState,
    config: OrchestratorConfig,
    sourceAttempt?: AttemptReference,
    retryOf?: string,
    commitTransition?: () => Promise<void>
  ): Promise<RunState> {
    if (!(await hasRunnerWorkOwnership(this.repoRoot, state.artifactBinding)))
      return withRunnerWorkOwnership(this.repoRoot, state.artifactBinding, () =>
        this.executeVerification(
          state,
          config,
          sourceAttempt,
          retryOf,
          commitTransition
        )
      );
    requireState(state, ["verifying"], "Verification");
    await this.beforeModelAttempt(commitTransition);
    if ((state.workflowSelection?.workflow ?? "strict") === "strict") {
      try {
        await this.revalidateTaskCompletion(
          state,
          sourceAttempt?.kind === "fix"
        );
      } catch (error) {
        if (
          error instanceof TerminalRunStateError ||
          error instanceof ProjectSetupRequiredError ||
          error instanceof InstructionResourceMismatchError
        )
          throw error;
        return await this.blockForCompletionFailure(
          state,
          state.planTaskCompletion?.sourceAttemptId ??
            sourceAttempt?.id ??
            "legacy",
          error
        );
      }
    }
    if (!(await this.store.verificationLedgerSupported(state.runId))) {
      return await this.executeLegacyVerification(state, config);
    }
    let records = await this.store.readVerificationAttempts(state.runId);
    const source = await this.verificationSourceAttempt(
      state,
      records,
      sourceAttempt
    );
    if (
      await this.inspectConfigurationCheckpoint(state, config, source, records)
    )
      return state;
    const continuation = hasConfigurationSetup(state)
      ? state.configurationSetup?.continuation
      : null;
    const round = continuation
      ? {
          ...continuation.verificationRound,
          sourcePhase: continuation.attemptKind,
          sourceAttemptId: continuation.attemptId,
          sourceAttemptKind: continuation.attemptKind
        }
      : this.verificationRound(records, source);
    const skipped =
      hasConfigurationSetup(state) &&
      state.configurationSetup?.coverage === "skipped";
    const descriptors = describeVerificationCommands(config).filter(
      (descriptor) => !skipped || isRepositoryHygieneCommand(descriptor.command)
    );
    let evidenceBefore: VerificationCapture | null = null;
    if (usesVerificationPolicy(state) && !skipped) {
      try {
        evidenceBefore = await this.prepareVerificationDecision(
          state,
          config,
          round,
          records
        );
      } catch (error) {
        blockState(state, errorMessage(error));
        await this.store.writeState(state);
        return state;
      }
    }
    if (
      retryOf !== undefined &&
      !records.some(
        (record) =>
          record.id === retryOf &&
          record.round.id === round.id &&
          record.status === "failed"
      )
    ) {
      blockState(
        state,
        "The requested verification retry does not match a failed attempt in the open round."
      );
      await this.store.writeState(state);
      return state;
    }
    try {
      this.reconcileVerificationState(state, records, round, descriptors);
    } catch (error) {
      if (
        error instanceof TerminalRunStateError ||
        error instanceof ProjectSetupRequiredError ||
        error instanceof InstructionResourceMismatchError
      )
        throw error;
      state.activeProcess = null;
      blockState(state, errorMessage(error));
      await this.store.writeState(state);
      return state;
    }
    await this.store.writeState(state);

    for (let index = 0; index < descriptors.length; index += 1) {
      const descriptor = descriptors[index];
      if (descriptor === undefined) {
        continue;
      }
      const command = descriptor.command;
      if (
        state.verificationEvidence?.decision.actions[index]?.action === "reuse"
      )
        continue;
      const commandRecords = records.filter(
        (record) =>
          record.round.id === round.id &&
          record.command.profileOrdinal === descriptor.profileOrdinal &&
          record.command.commandOrdinal === descriptor.commandOrdinal
      );
      if (
        commandRecords.some(
          (record) => record.status === "completed" && record.exitCode === 0
        )
      ) {
        continue;
      }
      const failed = [...commandRecords]
        .reverse()
        .find((record) => record.status === "failed");
      const retryingFailed = failed !== undefined && failed.id === retryOf;
      if (failed !== undefined && !retryingFailed) {
        blockState(
          state,
          failed.exitCode === null
            ? `Verification "${command.name}" could not run.`
            : `Verification "${command.name}" failed with exit code ${failed.exitCode}.`
        );
        state.activeProcess = null;
        await this.store.writeState(state);
        return state;
      }
      const started = commandRecords.find(
        (record) => record.status === "started"
      );
      let restartOf: string | null = null;
      if (started !== undefined) {
        if (
          state.activeProcess?.kind === "verification" &&
          this.store.processAlive(state.activeProcess.pid)
        ) {
          blockState(
            state,
            "A recorded verification process is still live; recovery will not start a duplicate command."
          );
          await this.store.writeState(state);
          return state;
        }
        const interrupted = terminalVerificationRecord(started, {
          status: "interrupted",
          completedAt: now(),
          exitCode: null,
          signal: null,
          failureCategory: "runner_failure",
          stdout: null,
          stderr: null
        });
        await this.store.finishVerificationAttempt(state.runId, interrupted);
        await this.store.appendEvent(state.runId, "verification.interrupted", {
          attemptId: interrupted.id,
          sequence: interrupted.sequence,
          roundId: round.id
        });
        restartOf = interrupted.id;
        state.activeProcess = null;
        records = await this.store.readVerificationAttempts(state.runId);
        this.reconcileVerificationState(state, records, round, descriptors);
        await this.store.writeState(state);
      }

      if (usesVerificationPolicy(state) && !skipped) {
        const latestCapture = await this.captureVerification(state, config);
        if (latestCapture.candidateDigest !== evidenceBefore?.candidateDigest) {
          blockState(state, "Verification inputs changed before invocation.");
          await this.store.writeState(state);
          return state;
        }
      }
      const record = await this.store.beginVerificationAttempt(state.runId, {
        round,
        descriptor,
        startedAt: now(),
        retryOf: retryingFailed ? failed.id : null,
        restartOf
      });
      if (evidenceBefore && state.verificationEvidence)
        await persistVerificationOriginStart(
          this.verificationStorage(state),
          record,
          state.verificationEvidence.decision,
          evidenceBefore
        );
      records = [...records, record].sort(
        (left, right) => left.sequence - right.sequence
      );
      state.metrics.attempts.verification = records.length;
      await this.store.writeState(state);
      await this.store.appendEvent(state.runId, "verification.started", {
        attemptId: record.id,
        sequence: record.sequence,
        roundId: round.id,
        profileId: descriptor.profileId,
        profileOrdinal: descriptor.profileOrdinal,
        commandOrdinal: descriptor.commandOrdinal,
        restartOf
      });
      let result;
      try {
        result = await this.activity(
          `Verification ${index + 1}/${descriptors.length}`,
          `${command.name}: ${commandDisplay(command.command, command.args)}`,
          async () =>
            await this.processRunner({
              command: command.command,
              args: command.args,
              cwd: this.repoRoot,
              env: usesVerificationPolicy(state)
                ? (parseVerificationConfiguration(config.verification).policy
                    ?.dependencies.environment ?? {})
                : subscriptionOnlyEnvironment(),
              timeoutMs: command.timeoutMs,
              onStart: async (pid) => {
                await this.processStarted(state, { kind: "verification" }, pid);
              }
            }),
          (processResult) => processResult.exitCode === 0
        );
      } catch (error) {
        const current = await this.store.readState(state.runId);
        const interrupted = current.status === "cancelled";
        const terminal = terminalVerificationRecord(record, {
          status: interrupted ? "interrupted" : "failed",
          completedAt: now(),
          exitCode: null,
          signal: null,
          failureCategory: verificationFailureCategory(error),
          stdout: null,
          stderr: null
        });
        await this.store.finishVerificationAttempt(state.runId, terminal);
        if (evidenceBefore)
          await persistVerificationOriginFinish(
            this.verificationStorage(state),
            terminal,
            await this.captureVerification(state, config)
          );
        if (current.status === "cancelled") {
          return current;
        }
        records = await this.store.readVerificationAttempts(state.runId);
        this.reconcileVerificationState(state, records, round, descriptors);
        state.activeProcess = null;
        blockState(
          state,
          `Verification "${command.name}" could not run: ${errorMessage(error)}`
        );
        await this.store.writeState(state);
        return state;
      }
      const logStem = `${String(record.sequence).padStart(6, "0")}-${command.name.replace(/[^a-z0-9]+/gi, "-")}`;
      const stdoutEvidence = await this.store.writeVerificationLog(
        state.runId,
        `verification/${logStem}.stdout.log`,
        redactSensitiveText(result.stdout)
      );
      const stderrEvidence = await this.store.writeVerificationLog(
        state.runId,
        `verification/${logStem}.stderr.log`,
        redactSensitiveText(result.stderr)
      );
      const terminal = terminalVerificationRecord(record, {
        status: result.exitCode === 0 ? "completed" : "failed",
        completedAt: result.completedAt,
        exitCode: result.exitCode,
        signal: result.signal,
        failureCategory: result.exitCode === 0 ? null : "command_exit",
        stdout: stdoutEvidence,
        stderr: stderrEvidence
      });
      await this.store.finishVerificationAttempt(state.runId, terminal);
      if (evidenceBefore)
        await persistVerificationOriginFinish(
          this.verificationStorage(state),
          terminal,
          await this.captureVerification(state, config)
        );
      const current = await this.store.readState(state.runId);
      if (current.status === "cancelled") {
        return current;
      }
      records = await this.store.readVerificationAttempts(state.runId);
      this.reconcileVerificationState(state, records, round, descriptors);
      state.activeProcess = null;
      await this.store.writeState(state);
      await this.store.appendEvent(state.runId, "verification.completed", {
        attemptId: terminal.id,
        sequence: terminal.sequence,
        roundId: round.id,
        status: terminal.status,
        exitCode: result.exitCode,
        signal: result.signal
      });
      if (result.exitCode !== 0) {
        blockState(
          state,
          `Verification "${command.name}" failed with exit code ${result.exitCode}.`
        );
        await this.store.writeState(state);
        return state;
      }
    }
    if (!(await this.requireVerificationApplicability(state, config)))
      return state;
    const workflow = state.workflowSelection?.workflow ?? "strict";
    if (workflow !== "strict") {
      transitionState(state, "done");
      await this.store.writeState(state);
      await this.store.appendEvent(state.runId, "run.completed", {
        workflow,
        verificationCount: state.verification.length
      });
      return state;
    }
    transitionState(state, "reviewing");
    await this.store.writeState(state);
    return await this.executeReview(state, config);
  }

  private async executeLegacyVerification(
    state: RunState,
    config: OrchestratorConfig
  ): Promise<RunState> {
    state.verification = [];
    const commands = flattenVerificationCommands(config);
    for (let index = 0; index < commands.length; index += 1) {
      const command = commands[index];
      if (command === undefined) {
        continue;
      }
      const startedAt = now();
      state.metrics.attempts.verification += 1;
      let result;
      try {
        result = await this.activity(
          `Verification ${index + 1}/${commands.length}`,
          `${command.name}: ${commandDisplay(command.command, command.args)}`,
          async () =>
            await this.processRunner({
              command: command.command,
              args: command.args,
              cwd: this.repoRoot,
              env: subscriptionOnlyEnvironment(),
              timeoutMs: command.timeoutMs,
              onStart: async (pid) => {
                await this.processStarted(state, { kind: "verification" }, pid);
              }
            }),
          (processResult) => processResult.exitCode === 0
        );
      } catch (error) {
        const current = await this.store.readState(state.runId);
        if (current.status === "cancelled") {
          return current;
        }
        state.activeProcess = null;
        blockState(
          state,
          `Verification "${command.name}" could not run: ${errorMessage(error)}`
        );
        await this.store.writeState(state);
        return state;
      }
      const current = await this.store.readState(state.runId);
      if (current.status === "cancelled") {
        return current;
      }
      const logStem = `${index + 1}-${command.name.replace(/[^a-z0-9]+/gi, "-")}`;
      const stdoutRelative = `verification/${logStem}.stdout.log`;
      const stderrRelative = `verification/${logStem}.stderr.log`;
      await this.store.writeText(
        state.runId,
        stdoutRelative,
        redactSensitiveText(result.stdout)
      );
      await this.store.writeText(
        state.runId,
        stderrRelative,
        redactSensitiveText(result.stderr)
      );
      state.verification.push({
        name: command.name,
        command: command.command,
        args: command.args,
        exitCode: result.exitCode,
        signal: result.signal,
        stdoutPath: stdoutRelative,
        stderrPath: stderrRelative,
        startedAt,
        completedAt: result.completedAt
      });
      state.activeProcess = null;
      await this.store.writeState(state);
      await this.store.appendEvent(state.runId, "verification.completed", {
        name: command.name,
        exitCode: result.exitCode,
        signal: result.signal
      });
      if (result.exitCode !== 0) {
        blockState(
          state,
          `Verification "${command.name}" failed with exit code ${result.exitCode}.`
        );
        await this.store.writeState(state);
        return state;
      }
    }
    const workflow = state.workflowSelection?.workflow ?? "strict";
    if (workflow !== "strict") {
      transitionState(state, "done");
      await this.store.writeState(state);
      await this.store.appendEvent(state.runId, "run.completed", {
        workflow,
        verificationCount: state.verification.length
      });
      return state;
    }
    transitionState(state, "reviewing");
    await this.store.writeState(state);
    return await this.executeReview(state, config);
  }

  private async executeReview(
    state: RunState,
    config: OrchestratorConfig,
    commitTransition?: () => Promise<void>
  ): Promise<RunState> {
    if (!(await hasRunnerWorkOwnership(this.repoRoot, state.artifactBinding)))
      return withRunnerWorkOwnership(this.repoRoot, state.artifactBinding, () =>
        this.executeReview(state, config, commitTransition)
      );
    requireState(state, ["reviewing"], "Review");
    if (!(await this.requireVerificationApplicability(state, config)))
      return state;
    await this.assertProjectGuidance();
    let validatedCompletion: ValidatedPlanTaskCompletion;
    try {
      validatedCompletion = await this.revalidateTaskCompletion(state);
    } catch (error) {
      if (
        error instanceof TerminalRunStateError ||
        error instanceof ProjectSetupRequiredError ||
        error instanceof InstructionResourceMismatchError
      )
        throw error;
      return await this.blockForCompletionFailure(
        state,
        state.planTaskCompletion?.sourceAttemptId ?? "legacy",
        error
      );
    }
    const iteration = state.reviewIteration + 1;
    const artifactPath = reviewArtifactPath(
      state.slug,
      iteration,
      state.artifactBinding
    );
    let snapshot: Awaited<ReturnType<typeof workspaceSnapshot>>;
    try {
      snapshot = await this.activity(
        "Review checks",
        `base commit, approved plan bundle, workspace snapshot, and ${config.models.reviewer.executable} subscription authentication`,
        async () => {
          await this.validateBaseCommit(state);
          await this.validateApproval(state);
          await this.preflightVendor("reviewer", config.models.reviewer);
          return await workspaceSnapshot(this.repoRoot, {
            artifactBinding: state.artifactBinding,
            excludedPaths: [artifactPath],
            baseline: state.baseline
          });
        }
      );
    } catch (error) {
      if (
        error instanceof TerminalRunStateError ||
        error instanceof ProjectSetupRequiredError ||
        error instanceof InstructionResourceMismatchError
      )
        throw error;
      const current = await this.store.readState(state.runId);
      if (current.status === "cancelled") {
        return current;
      }
      return await this.recordReviewCheckFailure(state, error);
    }
    const beforeDigest = snapshot.digest;
    const reviewerVendor = vendorFor(config.models.reviewer.executable);
    const environment = await this.invocationScope(state.runId, config, false);
    const currentInvocationDigest =
      reviewerVendor === "claude" ? invocationScopeDigest(environment) : null;
    const policy = reviewExecutionPolicy(
      state,
      config.models.reviewer,
      currentInvocationDigest
    );
    const changes =
      policy.reviewMode === "delta" && state.sessions.reviewer !== null
        ? workspaceChanges(
            state.sessions.reviewer.lastSnapshot,
            snapshot
          ).filter((change) => change.path !== state.latestReview?.artifactPath)
        : [];
    await this.beforeModelAttempt(commitTransition, {
      config,
      role: "reviewer",
      phase: "review"
    });
    await this.invocationScope(state.runId, config);
    state.workspaceDigest = beforeDigest;
    state.reviewIteration = iteration;
    const attempt = this.newAttempt(state, "review", false);
    const candidateAbsolutePath = this.store.reviewCandidatePath(
      state.runId,
      attempt
    );
    const candidatePath = path
      .relative(this.repoRoot, candidateAbsolutePath)
      .split(path.sep)
      .join(path.posix.sep);
    const candidateEvidencePath = path
      .relative(this.store.runDirectory(state.runId), candidateAbsolutePath)
      .split(path.sep)
      .join(path.posix.sep);
    const artifactMode: ReviewArtifactMode = "runner-rendered";
    const artifact: ReviewArtifactContext = {
      path: artifactPath,
      candidatePath,
      slug: state.slug,
      iteration,
      approvedArtifactPaths: state.planApproval?.paths ?? [],
      workspaceDigest: beforeDigest,
      verification: state.verification,
      taskCompletion: {
        approvalDigest: validatedCompletion.summary.approvalDigest,
        ledgerDigest: validatedCompletion.summary.ledgerDigest,
        planTaskDigest: validatedCompletion.summary.planTaskDigest,
        completed: validatedCompletion.summary.counts.completed,
        total: validatedCompletion.summary.counts.total,
        implementationReport:
          validatedCompletion.summary.implementationReport.path,
        testReport: validatedCompletion.summary.testReport.path,
        tasks: validatedCompletion.tasks
      }
    };
    if (
      usesVerificationPolicy(state) &&
      state.configurationSetup?.coverage !== "skipped" &&
      state.verificationEvidence?.applicability
    ) {
      const attempts = await this.store.readVerificationAttempts(state.runId);
      const origins = await readVerificationOrigins(
        this.verificationStorage(state),
        attempts
      );
      artifact.verificationEvidence = {
        ...state.verificationEvidence,
        applicability: state.verificationEvidence.applicability,
        origins,
        attempts: origins.map((origin) => {
          const attempt = attempts.find((item) => item.id === origin.attemptId);
          if (!attempt)
            throw new BanzaiError(
              "VERIFICATION_EVIDENCE_INVALID",
              "Physical origin is missing."
            );
          return attempt;
        })
      };
    }
    const record = await this.beginAttempt(state, attempt, policy);
    const candidateEvidence: ReviewCandidateEvidence = {
      source: artifactMode,
      evidencePath: candidateEvidencePath,
      intendedArtifactPath: artifactPath,
      sha256: null,
      validation: "pending",
      validationCode: null,
      validationError: null,
      canonical: false
    };
    record.reviewCandidate = candidateEvidence;
    await this.store.writeRunAttempt(state.runId, record);
    try {
      if (state.planApproval === null)
        throw new BanzaiError(
          "INVALID_REVIEW_SCOPE",
          "Review requires an exact approved scope."
        );
      const frozen = sealReviewSnapshot({
        schema:
          state.schemaVersion === 7
            ? "banzai-review-snapshot/v5"
            : state.schemaVersion === 6
              ? "banzai-review-snapshot/v4"
              : state.schemaVersion === 5
                ? "banzai-review-snapshot/v3"
                : state.artifactBinding
                  ? "banzai-review-snapshot/v2"
                  : "banzai-review-snapshot/v1",
        schemaVersion:
          state.schemaVersion === 7
            ? 5
            : state.schemaVersion === 6
              ? 4
              : state.schemaVersion === 5
                ? 3
                : state.artifactBinding
                  ? 2
                  : 1,
        ...(hasConfigurationSetup(state)
          ? {
              verificationMode: state.verificationMode ?? "ordered",
              configurationSetup: await freezeReviewConfiguration(
                this.repoRoot,
                state
              )
            }
          : {}),
        ...(state.schemaVersion === 7
          ? {
              completionPublication: await this.frozenCompletionPublication(
                state,
                validatedCompletion.summary
              )
            }
          : {}),
        ...(state.artifactBinding
          ? { artifactBinding: state.artifactBinding }
          : {}),
        runId: state.runId,
        attemptId: attempt.id,
        outputContract: "review-result/v2",
        baseCommit: state.baseCommit,
        approval: state.planApproval,
        approvedArtifacts: await reviewApprovedArtifacts(
          this.repoRoot,
          state.planApproval.paths
        ),
        workspace: snapshot,
        reviewMode: policy.reviewMode,
        changes,
        anchor: state.latestReview,
        fullReviewAnchor:
          state.sessions.reviewer?.outputContract === "review-result/v2"
            ? {
                iteration: state.sessions.reviewer.lastFullIteration,
                sessionId: state.sessions.reviewer.id,
                approvalDigest: state.sessions.reviewer.approvalDigest,
                outputContract: "review-result/v2"
              }
            : null,
        triage: state.triageHistory,
        requiredFindingIds:
          state.triage?.items
            .filter((item) => item.disposition === "accepted")
            .map((item) => item.findingId) ?? [],
        completionSource: {
          ...validatedCompletion.summary,
          sourceAttemptKind:
            state.planTaskCompletion?.sourceAttemptKind ?? "implementation"
        },
        artifact
      });
      record.reviewContext = {
        outputContract: "review-result/v2",
        snapshotDigest: frozen.digest
      };
      await this.store.writeRunAttempt(state.runId, record);
      await this.store.writeReviewSnapshot(state.runId, attempt, frozen);
      artifact.snapshot = frozen;
    } catch (error) {
      return await this.failAttempt(state, record, error);
    }
    let result: AdapterResult<ReviewResult>;
    let validatedCandidate: ValidatedReviewCandidate;
    let inventoryChanged: boolean;
    const invokeReviewer = async (
      label: string,
      detail: string | ActivityDetail,
      prompt: PromptEnvelope,
      resumeSessionId: string | null,
      kind: "primary"
    ): Promise<AdapterResult<ReviewResult>> =>
      await this.activity(
        label,
        detail,
        async () =>
          await this.invokeWithContext({
            state,
            attempt,
            config,
            settings: config.models.reviewer,
            role: "reviewer",
            sessionMode: resumeSessionId === null ? "fresh" : "resumed",
            kind,
            prompt,
            outputIdentity: "review-result/v2",
            invoke: async (outputContract) =>
              await this.adapters.runReview({
                repoRoot: this.repoRoot,
                runId: state.runId,
                runDirectory: this.store.runDirectory(state.runId),
                attemptId: attempt.id,
                approvalDigest: state.planApproval?.digest ?? "",
                artifact,
                prompt: prompt.rendered,
                promptEnvelope: prompt,
                outputContract,
                settings: config.models.reviewer,
                resumeSessionId,
                environment,
                env: process.env,
                onStart: async (pid) => {
                  await this.processStarted(state, attempt, pid);
                },
                onProgress: (event) => {
                  this.modelProgress(label, event);
                },
                onTerminalSuccess: this.terminalCheckpointWriter(
                  state,
                  attempt,
                  config.models.reviewer,
                  policy
                )
              })
          })
      );
    const recordCandidateDigest = async (): Promise<void> => {
      const contents = await readFile(candidateAbsolutePath, "utf8").catch(
        () => null
      );
      if (contents === null) {
        return;
      }
      await chmod(candidateAbsolutePath, 0o600);
      candidateEvidence.sha256 = createHash("sha256")
        .update(contents)
        .digest("hex");
      await this.store.writeRunAttempt(state.runId, record);
    };
    try {
      result = await invokeReviewer(
        `Review ${iteration}`,
        {
          detail: `${modelActivityDetail(
            config.models.reviewer,
            attempt,
            PHASE_PHASES.Review
          )} session=${policy.sessionMode} review=${policy.reviewMode} rotation=${policy.rotationReason ?? "none"}`,
          descriptor: phaseDescriptor(
            config.models.reviewer,
            policy.sessionMode,
            PHASE_PHASES.Review
          )
        },
        insertPhaseInstructions(
          reviewPromptEnvelope({
            slug: state.slug,
            iteration,
            artifactMode,
            reviewSnapshot: artifact.snapshot,
            reviewArtifactPath: artifactPath,
            reviewCandidatePath: candidatePath,
            artifactPaths: state.planApproval.paths,
            workspaceDigest: beforeDigest,
            workspaceEntries: snapshot.entries,
            evidenceRoot: this.store.runDirectory(state.runId),
            verification: state.verification,
            reviewMode: policy.reviewMode,
            rotationReason: policy.rotationReason,
            workspaceChanges: changes,
            triageHistory: state.triageHistory,
            taskCompletion: artifact.taskCompletion
          }),
          [
            this.artifactInstructions(state, "review"),
            this.serenaGuidanceFor(
              environment,
              config.models.reviewer.executable
            )
          ]
        ),
        policy.resumeSessionId,
        "primary"
      );
      inventoryChanged = await this.recordInventoryDrift(state, policy, result);
      await this.persistAdapterResult(state, record, result);
      result.result = parseCurrentReviewResult(result.result);
      const frozen = artifact.snapshot;
      validateReviewScope(parseCurrentReviewResult(result.result), {
        snapshotDigest: frozen.digest,
        approvedArtifactPaths: frozen.approval.paths,
        requiredFindingIds: frozen.requiredFindingIds
      });
      this.validateReviewResultForApplication(state, result.result);
      await this.store.writeText(
        state.runId,
        candidateEvidencePath,
        renderReviewArtifact(result.result, artifact)
      );
      await recordCandidateDigest();
      validatedCandidate = await validateReviewArtifact(
        this.repoRoot,
        result.result,
        artifact
      );
      this.validateReviewResultForApplication(state, result.result);
      candidateEvidence.sha256 = validatedCandidate.sha256;
      candidateEvidence.validation = "passed";
      await this.store.writeRunAttempt(state.runId, record);
    } catch (error) {
      if (
        error instanceof TerminalRunStateError ||
        error instanceof ProjectSetupRequiredError ||
        error instanceof InstructionResourceMismatchError
      )
        throw error;
      (record.reviewDiagnostics ??= []).push({
        stage: "render_validation",
        code:
          error instanceof BanzaiError ? error.code : "REVIEW_RENDER_FAILED",
        message: errorMessage(error)
      });
      if (record.result !== null) {
        candidateEvidence.validation = "failed";
        candidateEvidence.validationCode =
          error instanceof BanzaiError ? error.code : null;
        candidateEvidence.validationError = errorMessage(error);
      }
      return await this.failAttempt(state, record, error);
    }
    try {
      const afterDigest = await workspaceDigest(this.repoRoot, {
        artifactBinding: state.artifactBinding,
        excludedPaths: [artifactPath],
        baseline: state.baseline
      });
      if (beforeDigest !== afterDigest) {
        if (!(await this.completeAttempt(state, record, result))) {
          return await this.store.readState(state.runId);
        }
        state.activeAttempt = null;
        state.reviewIteration = state.latestReview?.iteration ?? 0;
        state.pendingReviewRotationReason = "unreliable-review";
        blockState(
          state,
          "Repository changed during source-read-only review outside the designated review artifact; result is stale."
        );
        await this.store.writeState(state);
        return state;
      }
      if (!(await this.completeAttempt(state, record, result))) {
        return await this.store.readState(state.runId);
      }
      await this.validateBaseCommit(state);
      await this.validateApproval(state);
      const completionNow = await this.revalidateTaskCompletion(state);
      if (
        artifact.snapshot.completionSource === null ||
        !summariesMatch(
          artifact.snapshot.completionSource,
          completionNow.summary
        ) ||
        artifact.snapshot.completionSource.sourceAttemptKind !==
          (state.planTaskCompletion?.sourceAttemptKind ?? "implementation")
      )
        throw new BanzaiError(
          "INVALID_REVIEW_SNAPSHOT",
          "Completion evidence changed after review snapshot."
        );
      await publishReviewArtifact(this.repoRoot, artifact, validatedCandidate);
      return await this.applyReviewResult(
        state,
        attempt,
        result.result,
        snapshot,
        policy,
        result.sessionId ?? policy.resumeSessionId,
        {
          invocationDigest: currentInvocationDigest,
          inventoryDigest: result.inventory?.digest ?? null,
          inventoryChanged
        }
      );
    } catch (error) {
      if (
        error instanceof TerminalRunStateError ||
        error instanceof ProjectSetupRequiredError ||
        error instanceof InstructionResourceMismatchError
      )
        throw error;
      (record.reviewDiagnostics ??= []).push({
        stage: "publication_application",
        code:
          error instanceof BanzaiError
            ? error.code
            : "REVIEW_PUBLICATION_FAILED",
        message: errorMessage(error)
      });
      await this.store.writeRunAttempt(state.runId, record);
      if (error instanceof PlanTaskCompletionError) {
        return await this.blockForCompletionFailure(
          await this.store.readState(state.runId),
          state.planTaskCompletion?.sourceAttemptId ?? attempt.id,
          error
        );
      }
      record.error = errorMessage(error);
      record.failureCode =
        error instanceof BanzaiError ? error.code : "REVIEW_PUBLICATION_FAILED";
      await this.store.writeRunAttempt(state.runId, record);
      const current = await this.store.readState(state.runId);
      if (current.status === "done" || current.status === "cancelled")
        return current;
      await this.store.appendEvent(state.runId, "review.publication_failed", {
        attemptId: attempt.id,
        code: record.failureCode
      });
      current.pendingReviewRotationReason = "unreliable-review";
      blockState(current, errorMessage(error));
      await this.store.writeState(current);
      return current;
    }
  }

  private validateReviewResultForApplication(
    state: RunState,
    result: ReviewResult
  ): void {
    const expectedPrefix = `R${state.reviewIteration}-F`;
    if (
      result.findings.some((finding) => !finding.id.startsWith(expectedPrefix))
    ) {
      throw new BanzaiError(
        "FINDING_ITERATION_MISMATCH",
        `Review ${state.reviewIteration} returned an invalid finding id.`
      );
    }
    const acceptedPrevious =
      state.triage?.items
        .filter((item) => item.disposition === "accepted")
        .map((item) => item.findingId) ?? [];
    if (
      state.triage !== null &&
      !(result.schemaVersion === 2 && result.verdict === "blocked") &&
      acceptedPrevious.some((id) => !result.reviewedFindingIds.includes(id))
    ) {
      throw new BanzaiError(
        "INCOMPLETE_REREVIEW",
        "Re-review did not report every previously accepted finding id."
      );
    }
  }

  /**
   * Compares the inventory a resumed session reported against the inventory
   * recorded when it was created. A mismatch already cost a full re-cache, so it
   * is recorded and rotated deliberately instead of being absorbed silently.
   */
  private async recordInventoryDrift(
    state: RunState,
    policy: ReviewExecutionPolicy,
    result: AdapterResult<ReviewResult>
  ): Promise<boolean> {
    const recorded = state.sessions.reviewer?.inventoryDigest;
    const observed = result.inventory ?? null;
    if (
      policy.sessionMode !== "resumed" ||
      observed === null ||
      recorded === undefined ||
      recorded === observed.digest
    ) {
      return false;
    }
    await this.store.appendEvent(state.runId, "review.inventory_changed", {
      iteration: state.reviewIteration,
      recordedDigest: recorded,
      observedDigest: observed.digest,
      observedToolCount: observed.toolCount
    });
    this.info(
      `Resumed reviewer session reported ${observed.toolCount} tools, not the inventory it was created with; the next review rotates.`
    );
    return true;
  }

  private async applyReviewResult(
    state: RunState,
    attempt: AttemptReference,
    result: ReviewResult,
    snapshot: WorkspaceSnapshot,
    policy: ReviewExecutionPolicy,
    sessionId: string | null,
    session: {
      invocationDigest: string | null;
      inventoryDigest: string | null;
      inventoryChanged: boolean;
    } = {
      invocationDigest: null,
      inventoryDigest: null,
      inventoryChanged: false
    }
  ): Promise<RunState> {
    this.validateReviewResultForApplication(state, result);
    const resultRelative = `reviews/review-${state.reviewIteration}.json`;
    const canonicalJson = `${JSON.stringify(result, null, 2)}\n`;
    if (result.schemaVersion === 2)
      await this.store.writeReviewResult(
        state.runId,
        state.reviewIteration,
        result
      );
    else await this.store.writeText(state.runId, resultRelative, canonicalJson);

    const previousReviewer = state.sessions.reviewer;
    const reviewer: ReviewerSessionBinding | null =
      sessionId === null
        ? null
        : {
            id: sessionId,
            ...policy.sessionContext,
            role: "reviewer",
            outputContract:
              result.schemaVersion === 2
                ? "review-result/v2"
                : "review-result/v1",
            approvalDigest: state.planApproval?.digest ?? "",
            lastSnapshot: snapshot,
            lastFullIteration:
              policy.reviewMode === "full"
                ? state.reviewIteration
                : (previousReviewer?.lastFullIteration ??
                  state.reviewIteration),
            consecutiveDeltaReviews:
              policy.reviewMode === "full"
                ? 0
                : (previousReviewer?.consecutiveDeltaReviews ?? 0) + 1,
            ...(session.invocationDigest === null
              ? {}
              : { invocationDigest: session.invocationDigest }),
            ...(session.inventoryDigest === null
              ? {}
              : { inventoryDigest: session.inventoryDigest })
          };
    state.sessions.reviewer = reviewer;
    state.latestReview = {
      outputContract:
        result.schemaVersion === 2 ? "review-result/v2" : "review-result/v1",
      iteration: state.reviewIteration,
      resultPath: resultRelative,
      artifactPath: reviewArtifactPath(
        state.slug,
        state.reviewIteration,
        state.artifactBinding
      ),
      workspaceDigest: snapshot.digest,
      verdict: result.verdict,
      sessionMode: policy.sessionMode,
      mode: policy.reviewMode,
      rotationReason: policy.rotationReason
    };
    state.metrics.reviewFindingCount += result.findings.length;
    this.info(
      `Review ${state.reviewIteration}: ${reviewVerdictText(result.verdict)}, ${result.findings.length} finding${result.findings.length === 1 ? "" : "s"}`
    );
    state.workspaceDigest = snapshot.digest;
    state.activeAttempt = null;
    state.pendingReviewRotationReason =
      result.verdict === "blocked"
        ? "previous-review-blocked"
        : result.verdict === "replan_required"
          ? "unreliable-review"
          : result.verdict === "changes_requested" && reviewer === null
            ? "missing-session"
            : session.inventoryChanged
              ? "session-inventory-changed"
              : null;
    if (result.verdict === "pass") {
      if (!(await this.requireVerificationApplicability(state))) return state;
      try {
        await this.revalidateTaskCompletion(state);
      } catch (error) {
        if (
          error instanceof TerminalRunStateError ||
          error instanceof ProjectSetupRequiredError ||
          error instanceof InstructionResourceMismatchError
        )
          throw error;
        return await this.blockForCompletionFailure(
          state,
          state.planTaskCompletion?.sourceAttemptId ?? "legacy",
          error
        );
      }
      transitionState(state, "done");
    } else if (result.verdict === "changes_requested") {
      transitionState(state, "needs_triage");
    } else {
      blockState(state, `Review verdict ${result.verdict}: ${result.summary}`);
    }
    if (result.schemaVersion !== 2) await this.store.writeState(state);
    const timingEvent = await this.store.appendEvent(
      state.runId,
      "review.completed",
      {
        attemptId: attempt.id,
        iteration: state.reviewIteration,
        verdict: result.verdict,
        artifactPath: state.latestReview.artifactPath,
        findingIds: result.findings.map((finding) => finding.id),
        workspaceDigest: snapshot.digest,
        sessionMode: policy.sessionMode,
        reviewMode: policy.reviewMode,
        rotationReason: policy.rotationReason
      },
      undefined,
      result.schemaVersion === 2
    );
    if (result.schemaVersion === 2) await this.store.writeState(state);
    await this.observeHumanTime(
      state,
      "gate_pending",
      "review.completed",
      timingEvent.at,
      attempt.id
    );
    return state;
  }

  private async readLatestReview(state: RunState): Promise<ReviewResult> {
    if (state.latestReview === null) {
      throw new BanzaiError("REVIEW_NOT_FOUND", "No review is available.");
    }
    const raw = await readFile(
      path.join(
        this.store.runDirectory(state.runId),
        state.latestReview.resultPath
      ),
      "utf8"
    );
    const value = JSON.parse(raw) as unknown;
    const identity: unknown = state.latestReview.outputContract;
    if (
      identity !== undefined &&
      identity !== "review-result/v1" &&
      identity !== "review-result/v2"
    )
      throw new BanzaiError(
        "REVIEW_RESULT_SCHEMA_MISMATCH",
        "Canonical review output identity is unsupported."
      );
    return identity === "review-result/v2"
      ? parseCurrentReviewResult(value)
      : parseReviewResult(value);
  }

  private validateTriage(
    findings: ReviewFinding[],
    input: TriageInput
  ): TriageItem[] {
    const findingIds = new Set(findings.map((finding) => finding.id));
    const assignments: [FindingDisposition, string[]][] = [
      ["accepted", input.accepted],
      ["rejected", input.rejected],
      ["deferred", input.deferred]
    ];
    const seen = new Set<string>();
    const items: TriageItem[] = [];
    for (const [disposition, ids] of assignments) {
      for (const findingId of ids) {
        if (!findingIds.has(findingId)) {
          throw new BanzaiError(
            "UNKNOWN_FINDING",
            `Review does not contain finding ${findingId}.`
          );
        }
        if (seen.has(findingId)) {
          throw new BanzaiError(
            "DUPLICATE_TRIAGE",
            `Finding ${findingId} has multiple dispositions.`
          );
        }
        seen.add(findingId);
        items.push({ findingId, disposition, note: input.note });
      }
    }
    if (seen.size !== findingIds.size) {
      const missing = [...findingIds].filter((id) => !seen.has(id));
      throw new BanzaiError(
        "INCOMPLETE_TRIAGE",
        `Every finding needs a disposition. Missing: ${missing.join(", ")}`
      );
    }
    return items;
  }

  private checkpointSettings(
    attempt: AttemptReference,
    config: OrchestratorConfig
  ): { settings: ModelSettings; role: SessionContext["role"] } {
    if (attempt.kind === "selection" || attempt.kind === "plan") {
      return { settings: config.models.planner, role: "planner" };
    }
    if (attempt.kind === "review") {
      return { settings: config.models.reviewer, role: "reviewer" };
    }
    return { settings: config.models.implementer, role: "implementer" };
  }

  private accountCompletedAttempt(
    state: RunState,
    record: AttemptRecord
  ): void {
    if (state.metrics.completedAttemptIds.includes(record.attempt.id)) {
      return;
    }
    this.accountAttemptUsage(state, record);
    state.metrics.completedAttemptIds.push(record.attempt.id);
    state.metrics.modelDurationMs += record.durationMs ?? 0;
  }

  private accountAttemptUsage(state: RunState, record: AttemptRecord): void {
    const accounted = (state.metrics.usageAccountedAttemptIds ??= [
      ...state.metrics.completedAttemptIds
    ]);
    if (accounted.includes(record.attempt.id)) return;
    if (record.usage !== null) {
      state.metrics.usage.inputTokens += record.usage.inputTokens;
      state.metrics.usage.cachedInputTokens += record.usage.cachedInputTokens;
      state.metrics.usage.outputTokens += record.usage.outputTokens;
      if (record.usage.costUsd !== null) {
        state.metrics.usage.costUsd =
          (state.metrics.usage.costUsd ?? 0) + record.usage.costUsd;
      }
      accounted.push(record.attempt.id);
    }
  }

  private validateRunnerControlTasks(state: RunState, plan: string): void {
    const roles = state.artifactBinding?.binding.artifacts;
    validatePlanRunnerControlTasks(
      plan,
      this.repoRoot,
      [roles?.implementationReport, roles?.testReport].filter(
        (value): value is string => typeof value === "string"
      )
    );
  }

  private async validatePlanningResult(
    state: RunState,
    result: PersistedPhaseResult
  ): Promise<void> {
    if (result.gate !== "plan_approval" || result.artifacts.plan === null)
      return;
    try {
      const markdown = await readFile(
        path.join(this.repoRoot, result.artifacts.plan),
        "utf8"
      );
      parseApprovedPlanTaskIds(markdown);
      this.validateRunnerControlTasks(state, markdown);
    } catch (error) {
      if (
        error instanceof TerminalRunStateError ||
        error instanceof ProjectSetupRequiredError ||
        error instanceof InstructionResourceMismatchError
      )
        throw error;
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

  private async validateTerminalCheckpointResult(
    state: RunState,
    attempt: AttemptReference,
    result: TerminalCheckpointResult
  ): Promise<void> {
    await this.validateSavedArtifactScope(state, attempt);
    if (attempt.kind === "selection") {
      return;
    }
    if (attempt.kind === "review") {
      this.validateReviewResultForApplication(state, result as ReviewResult);
      const record = await this.store.readRunAttempt(state.runId, attempt);
      if (
        record.reviewContext !== undefined ||
        (result as ReviewResult).schemaVersion === 2
      ) {
        const frozen = await this.store.readReviewSnapshot(
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
    this.validateArtifactRoleReferences(state, phaseResult);
    if (phaseResult.phase !== attempt.kind) {
      throw new BanzaiError(
        "PHASE_RESULT_MISMATCH",
        `Attempt ${attempt.kind} returned phase ${phaseResult.phase}.`
      );
    }
    if (attempt.kind === "plan") {
      await this.validatePlanningResult(state, phaseResult);
      return;
    }
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
              repoRoot: this.repoRoot,
              artifactBinding: state.artifactBinding,
              sourceAttemptId: attempt.id,
              result: phaseResult,
              planPath: this.completionPlanPath(state),
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
        await this.validateImplementationCompletion(state, attempt, phaseResult)
      ).summary;
      return;
    }
    validatePlanTaskCompletionLedgerShape(
      await this.approvedTaskIds(state),
      phaseResult.taskCompletion,
      phaseResult.outcome
    );
  }

  private async promoteTerminalCheckpoint(
    state: RunState,
    attempt: AttemptReference,
    record: AttemptRecord,
    config: OrchestratorConfig
  ): Promise<string | null> {
    const checkpoint = await this.store.readTerminalCheckpointIfExists(
      state.runId,
      attempt
    );
    if (checkpoint === null) {
      return null;
    }
    if (checkpoint.schemaVersion !== 1) {
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
    const { settings, role } = this.checkpointSettings(attempt, config);
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
        : terminalResultContract(attempt.kind);
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
      checkpoint.scopeDigest !== this.attemptScopeDigest(state, attempt) ||
      checkpoint.configuration.vendor !==
        (vendorFor(settings.executable) ?? FALLBACK_VENDOR[role]) ||
      checkpoint.configuration.executableDigest !==
        digestCanonicalJson(settings.executable) ||
      checkpoint.configuration.model !== settings.model ||
      checkpoint.configuration.effort !== settings.effort ||
      checkpoint.configuration.sessionMode !==
        (record.sessionMode ?? "fresh") ||
      checkpoint.configuration.sessionContextDigest !==
        digestCanonicalJson(expectedContext) ||
      state.recovery?.sourceAttemptId === attempt.id
    ) {
      throw new BanzaiError(
        "TERMINAL_CHECKPOINT_MISMATCH",
        "Terminal checkpoint does not match the active run, attempt, authorization, or model context."
      );
    }
    await this.validateBaseCommit(state);
    if (expectedApprovalDigest !== null) {
      await this.validateApproval(state);
    } else if (expectedWorkflowDigest !== null) {
      if (attempt.kind === "plan") {
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
        this.validateWorkflowSelection(state);
      }
    }
    await this.validateTerminalCheckpointResult(
      state,
      attempt,
      checkpoint.result
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

  private async finalizeTerminalCheckpoint(
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
    await this.store.writeRunAttempt(state.runId, record);
    state.activeProcess = null;
    await this.store.writeState(state);
    await this.store.appendEvent(state.runId, "attempt.terminal_reconciled", {
      attemptId: record.attempt.id,
      kind: record.attempt.kind
    });
  }

  private async reconcileAttempt(
    state: RunState,
    config: OrchestratorConfig
  ): Promise<RunState> {
    const attempt = state.activeAttempt;
    if (attempt === null) {
      return state;
    }
    const record = await this.store.readRunAttempt(state.runId, attempt);
    if (this.completionProtocolAttempt(record)) {
      try {
        const reconciled = await this.reconcileCompletionAttempt(
          state,
          record,
          config
        );
        if (reconciled !== null) return reconciled;
      } catch (error) {
        if (
          error instanceof TerminalRunStateError ||
          error instanceof ProjectSetupRequiredError ||
          error instanceof InstructionResourceMismatchError
        )
          throw error;
        state.activeProcess = null;
        blockState(
          state,
          `[INVALID_TERMINAL_CHECKPOINT] ${errorMessage(error)}`
        );
        await this.store.writeState(state);
        await this.store.appendEvent(
          state.runId,
          "attempt.terminal_checkpoint_rejected",
          { attemptId: attempt.id, kind: attempt.kind }
        );
        return state;
      }
    }
    let terminalObservedAt: string | null;
    try {
      terminalObservedAt = await this.promoteTerminalCheckpoint(
        state,
        attempt,
        record,
        config
      );
    } catch (error) {
      if (
        error instanceof TerminalRunStateError ||
        error instanceof ProjectSetupRequiredError ||
        error instanceof InstructionResourceMismatchError
      )
        throw error;
      if (attempt.kind === "plan" && error instanceof PlanTaskCompletionError) {
        record.status = "failed";
        record.error = error.message;
        record.failureCode = error.code;
        await this.store.writeRunAttempt(state.runId, record);
      }
      state.activeProcess = null;
      blockState(state, `[INVALID_TERMINAL_CHECKPOINT] ${errorMessage(error)}`);
      await this.store.writeState(state);
      await this.store.appendEvent(
        state.runId,
        "attempt.terminal_checkpoint_rejected",
        { attemptId: attempt.id, kind: attempt.kind }
      );
      return state;
    }
    const recoveringStartedReview =
      attempt.kind === "review" &&
      record.status === "started" &&
      record.result !== null &&
      record.reviewCandidate?.validation === "passed";
    if (
      (record.status === "completed" ||
        recoveringStartedReview ||
        terminalObservedAt !== null) &&
      record.result !== null
    ) {
      if (attempt.kind === "plan" && state.status === "blocked") {
        if (state.blockedFrom !== "planning") {
          throw new BanzaiError(
            "TERMINAL_CHECKPOINT_MISMATCH",
            "Planning completion does not match the blocked phase."
          );
        }
        transitionState(state, "planning");
      }
      state.activeProcess = null;
      await this.store.appendEvent(state.runId, "attempt.reconciled", {
        attemptId: attempt.id,
        kind: attempt.kind
      });
      if (attempt.kind === "selection") {
        await this.finalizeTerminalCheckpoint(
          state,
          record,
          terminalObservedAt
        );
        this.accountCompletedAttempt(state, record);
        return await this.applyWorkflowSelection(
          state,
          attempt,
          record.result as WorkflowSelectionResult,
          config
        );
      }
      if (attempt.kind === "review") {
        if (
          record.reviewContext !== undefined &&
          state.status === "blocked" &&
          state.blockedFrom === "reviewing"
        )
          transitionState(state, "reviewing");
        let validatedCompletion: ValidatedPlanTaskCompletion;
        try {
          validatedCompletion = await this.revalidateTaskCompletion(state);
        } catch (error) {
          if (
            error instanceof TerminalRunStateError ||
            error instanceof ProjectSetupRequiredError ||
            error instanceof InstructionResourceMismatchError
          )
            throw error;
          return await this.blockForCompletionFailure(
            state,
            state.planTaskCompletion?.sourceAttemptId ?? "legacy",
            error
          );
        }
        const artifactPath = reviewArtifactPath(
          state.slug,
          state.reviewIteration,
          state.artifactBinding
        );
        const snapshot = await workspaceSnapshot(this.repoRoot, {
          artifactBinding: state.artifactBinding,
          excludedPaths: [artifactPath],
          baseline: state.baseline
        });
        if (
          state.workspaceDigest === null ||
          snapshot.digest !== state.workspaceDigest
        ) {
          state.activeAttempt = null;
          state.reviewIteration = state.latestReview?.iteration ?? 0;
          state.pendingReviewRotationReason = "unreliable-review";
          blockState(
            state,
            "Repository changed before the completed review could be reconciled."
          );
          await this.store.writeState(state);
          return state;
        }
        const result = record.result as ReviewResult;
        let candidateValidated = false;
        try {
          const candidateEvidence = record.reviewCandidate;
          const expectedCandidateEvidencePath = path
            .relative(
              this.store.runDirectory(state.runId),
              this.store.reviewCandidatePath(state.runId, attempt)
            )
            .split(path.sep)
            .join(path.posix.sep);
          if (
            candidateEvidence !== null &&
            candidateEvidence !== undefined &&
            (candidateEvidence.evidencePath !== expectedCandidateEvidencePath ||
              !new Set<string>(["reviewer-write", "runner-rendered"]).has(
                candidateEvidence.source
              ) ||
              (candidateEvidence as { canonical: unknown }).canonical !== false)
          ) {
            throw new BanzaiError(
              "INVALID_REVIEW_CANDIDATE_EVIDENCE",
              "Review attempt has malformed candidate evidence identity."
            );
          }
          const candidatePath =
            candidateEvidence === null || candidateEvidence === undefined
              ? artifactPath
              : path
                  .relative(
                    this.repoRoot,
                    path.join(
                      this.store.runDirectory(state.runId),
                      candidateEvidence.evidencePath
                    )
                  )
                  .split(path.sep)
                  .join(path.posix.sep);
          let artifact: ReviewArtifactContext = {
            path: artifactPath,
            candidatePath,
            slug: state.slug,
            iteration: state.reviewIteration,
            approvedArtifactPaths: state.planApproval?.paths ?? [],
            workspaceDigest: snapshot.digest,
            verification: state.verification,
            taskCompletion: {
              approvalDigest: validatedCompletion.summary.approvalDigest,
              ledgerDigest: validatedCompletion.summary.ledgerDigest,
              planTaskDigest: validatedCompletion.summary.planTaskDigest,
              completed: validatedCompletion.summary.counts.completed,
              total: validatedCompletion.summary.counts.total,
              implementationReport:
                validatedCompletion.summary.implementationReport.path,
              testReport: validatedCompletion.summary.testReport.path,
              tasks: validatedCompletion.tasks
            }
          };
          if (
            record.reviewContext !== undefined ||
            result.schemaVersion === 2
          ) {
            if (
              record.reviewContext?.outputContract !== "review-result/v2" ||
              candidateEvidence?.source !== "runner-rendered"
            )
              throw new BanzaiError(
                "INVALID_REVIEW_SNAPSHOT",
                "New review is missing its recorded contract or runner-owned candidate."
              );
            const frozen = await this.store.readReviewSnapshot(
              state.runId,
              attempt
            );
            if (
              frozen.digest !== record.reviewContext.snapshotDigest ||
              frozen.baseCommit !== state.baseCommit ||
              frozen.workspace.digest !== snapshot.digest ||
              frozen.artifact.path !== artifactPath ||
              frozen.artifact.candidatePath !== candidatePath ||
              frozen.artifact.iteration !== state.reviewIteration ||
              frozen.approval.digest !== state.planApproval?.digest ||
              frozen.completionSource === null ||
              !summariesMatch(
                frozen.completionSource,
                validatedCompletion.summary
              ) ||
              frozen.completionSource.sourceAttemptKind !==
                (state.planTaskCompletion?.sourceAttemptKind ??
                  "implementation")
            )
              throw new BanzaiError(
                "INVALID_REVIEW_SNAPSHOT",
                "Original review snapshot conflicts with current authority or completion evidence."
              );
            await this.validateBaseCommit(state);
            await this.validateApproval(state);
            validateReviewScope(parseCurrentReviewResult(result), {
              snapshotDigest: frozen.digest,
              approvedArtifactPaths: frozen.approval.paths,
              requiredFindingIds: frozen.requiredFindingIds
            });
            artifact = { ...frozen.artifact, snapshot: frozen };
            try {
              await readFile(
                this.store.reviewCandidatePath(state.runId, attempt)
              );
            } catch (error) {
              if (
                (error as NodeJS.ErrnoException).code !== "ENOENT" ||
                candidateEvidence.validation === "failed" ||
                (await this.store.readTerminalCheckpointIfExists(
                  state.runId,
                  attempt
                )) === null
              )
                throw error;
              await this.store.writeText(
                state.runId,
                candidateEvidence.evidencePath,
                renderReviewArtifact(result, artifact)
              );
            }
          }
          const candidate =
            candidateEvidence === null || candidateEvidence === undefined
              ? await validateHistoricalReviewArtifact(
                  this.repoRoot,
                  result,
                  artifact
                )
              : await validateReviewArtifact(this.repoRoot, result, artifact);
          if (candidateEvidence !== null && candidateEvidence !== undefined) {
            if (
              candidateEvidence.intendedArtifactPath !== artifactPath ||
              candidateEvidence.validation === "failed" ||
              (candidateEvidence.sha256 !== null &&
                candidateEvidence.sha256 !== candidate.sha256)
            ) {
              throw new BanzaiError(
                "INVALID_REVIEW_CANDIDATE_EVIDENCE",
                "Completed review attempt has inconsistent candidate validation evidence."
              );
            }
            if (candidateEvidence.validation === "pending") {
              candidateEvidence.sha256 = candidate.sha256;
              candidateEvidence.validation = "passed";
              await this.store.writeRunAttempt(state.runId, record);
            }
            this.validateReviewResultForApplication(state, result);
            if (recoveringStartedReview) {
              if (
                !(await this.completeAttempt(state, record, {
                  result,
                  sessionId: record.sessionId,
                  stdout: "",
                  stderr: "",
                  usage: record.usage
                }))
              ) {
                return await this.store.readState(state.runId);
              }
            }
            candidateValidated = true;
            await publishReviewArtifact(this.repoRoot, artifact, candidate);
          }
        } catch (error) {
          if (
            error instanceof TerminalRunStateError ||
            error instanceof ProjectSetupRequiredError ||
            error instanceof InstructionResourceMismatchError
          )
            throw error;
          if (record.reviewContext !== undefined) {
            (record.reviewDiagnostics ??= []).push({
              stage: "recovery",
              code:
                error instanceof BanzaiError
                  ? error.code
                  : "REVIEW_RECOVERY_FAILED",
              message: errorMessage(error)
            });
            record.error = errorMessage(error);
            record.failureCode =
              error instanceof BanzaiError
                ? error.code
                : "REVIEW_PUBLICATION_FAILED";
            if (!candidateValidated) {
              record.status = "failed";
              if (record.reviewCandidate) {
                record.reviewCandidate.validation = "failed";
                record.reviewCandidate.validationCode = record.failureCode;
                record.reviewCandidate.validationError = record.error;
              }
            }
            await this.store.writeRunAttempt(state.runId, record);
            state.pendingReviewRotationReason = candidateValidated
              ? "unreliable-review"
              : "previous-review-failed";
            blockState(state, record.error);
            await this.store.writeState(state);
            return state;
          }
          state.activeAttempt = null;
          state.reviewIteration = state.latestReview?.iteration ?? 0;
          state.pendingReviewRotationReason = "unreliable-review";
          blockState(state, errorMessage(error));
          await this.store.writeState(state);
          return state;
        }
        await this.finalizeTerminalCheckpoint(
          state,
          record,
          terminalObservedAt
        );
        if (!recoveringStartedReview) {
          this.accountCompletedAttempt(state, record);
        }
        const storedContext = record.sessionContext;
        const policy: ReviewExecutionPolicy = {
          sessionMode: record.sessionMode ?? "fresh",
          reviewMode: record.reviewMode ?? "full",
          rotationReason:
            record.rotationReason === undefined
              ? "legacy-state"
              : record.rotationReason,
          resumeSessionId: record.resumeSessionId ?? null,
          sessionContext: {
            role: "reviewer",
            executable:
              storedContext?.executable ?? config.models.reviewer.executable,
            model: storedContext?.model ?? config.models.reviewer.model,
            effort: storedContext?.effort ?? config.models.reviewer.effort
          }
        };
        return await this.applyReviewResult(
          state,
          attempt,
          result,
          snapshot,
          policy,
          record.sessionId ?? policy.resumeSessionId
        );
      }
      if (
        attempt.kind === "implementation" &&
        (state.workflowSelection?.workflow ?? "strict") === "strict"
      ) {
        try {
          state.planTaskCompletion = (
            await this.validateImplementationCompletion(
              state,
              attempt,
              parsePersistedPhaseResult(record.result)
            )
          ).summary;
        } catch (error) {
          if (
            error instanceof TerminalRunStateError ||
            error instanceof ProjectSetupRequiredError ||
            error instanceof InstructionResourceMismatchError
          )
            throw error;
          return await this.blockForCompletionFailure(state, attempt.id, error);
        }
      }
      await this.finalizeTerminalCheckpoint(state, record, terminalObservedAt);
      this.accountCompletedAttempt(state, record);
      return await this.applyPhaseResult(
        state,
        attempt,
        record.result as PhaseResult,
        record.sessionId ?? record.resumeSessionId ?? null,
        record.sessionContext ??
          sessionContext(
            attempt.kind === "plan" ? "planner" : "implementer",
            attempt.kind === "plan"
              ? config.models.planner
              : config.models.implementer
          )
      );
    }
    const isRetryableInterruption = isRetryableInterruptedAttempt(
      attempt,
      record
    );
    if (isRetryableInterruption && attempt.kind === "review") {
      state.reviewIteration = state.latestReview?.iteration ?? 0;
      state.pendingReviewRotationReason = "previous-review-interrupted";
    }
    blockState(
      state,
      record.status === "started" || record.status === "interrupted"
        ? isRetryableInterruption
          ? `Attempt ${attempt.id} was interrupted. Use banzai retry to start a fresh read-only ${attempt.kind} attempt.`
          : `Attempt ${attempt.id} was interrupted. It will not be repeated automatically.`
        : (record.error ?? `Attempt ${attempt.id} failed.`)
    );
    state.activeProcess = null;
    await this.store.writeState(state);
    return state;
  }
}

export function defaultDecisionMaker(): string {
  return os.userInfo().username;
}
