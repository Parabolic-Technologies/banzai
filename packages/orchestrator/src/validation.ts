import { validateConfigurationStateEnvelope } from "./configuration-prerequisite.js";
import {
  comparableTaskVerificationSources,
  parseTaskVerificationCandidates,
  parseTaskVerificationPolicy,
  parseVerificationConfiguration
} from "./verification-evidence.js";
import type { TaskVerificationCandidates } from "./verification-evidence.js";
import { createHash } from "node:crypto";
import { BanzaiError } from "./errors.js";
import { vendorFor } from "./models.js";
import {
  COMPLETION_CANDIDATE_SCHEMA,
  COMPLETION_CAPTURE_SCHEMA,
  COMPLETION_PROTOCOL,
  COMPLETION_PUBLICATION_REFUSAL_CODES,
  COMPLETION_PUBLICATION_SCHEMA,
  COMPLETION_PUBLICATION_STAGES,
  COMPLETION_RECORD_SCHEMA_VERSION,
  COMPLETION_TRANSITION_SCHEMA,
  CONTRACT_VERSION,
  DECISION_CONSULTATION_SCHEMA,
  DECISION_CONSULTATION_SCHEMA_VERSION,
  MODEL_ATTEMPT_SCHEMA_VERSION,
  PHASE_RESULT_SCHEMA_VERSION,
  PLAN_TASK_COMPLETION_SCHEMA_VERSION,
  RECOVERY_AUTHORIZATION_SCHEMA,
  RECOVERY_AUTHORIZATION_SCHEMA_VERSION,
  RESULT_DIGEST_EVIDENCE_SCHEMA,
  RESULT_DIGEST_EVIDENCE_SCHEMA_VERSION,
  STRICT_MODEL_ATTEMPT_SCHEMA_VERSION,
  TERMINAL_CHECKPOINT_SCHEMA,
  TERMINAL_CHECKPOINT_SCHEMA_V2,
  TERMINAL_CHECKPOINT_SCHEMA_VERSION,
  TERMINAL_CHECKPOINT_SCHEMA_VERSION_V2,
  VERIFICATION_LEDGER_SCHEMA_VERSION,
  type AttemptRecord,
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
  type EnvelopeTaskCompletion,
  type PersistedTerminalCheckpoint,
  type PhaseResultEnvelope,
  type PlanTaskCompletionCheckpoint,
  type PlanTaskCompletionViolation,
  type TerminalAttemptCheckpointV2,
  type AttemptReference,
  type ClaudeEnvironmentMode,
  type ClaudeEnvironmentSettings,
  type ContextLimit,
  type ContextMetric,
  type ContextPolicy,
  type DecisionConsultationAnswer,
  type DecisionConsultationCard,
  type DecisionConsultationOption,
  type DecisionConsultationRequest,
  type EvaluationAttemptSource,
  type EvaluationDecoded,
  type EvaluationEventSource,
  type EvaluationIssueCode,
  type EvaluationReviewSource,
  type EvaluationSourceIssue,
  type EvaluationStateMetricSource,
  type EvaluationStateSource,
  type EvaluationVerificationSource,
  type EvidenceValue,
  type FindingDisposition,
  type ModelSettings,
  type OrchestratorConfig,
  type PersistedPhaseResult,
  type PhaseArtifacts,
  type PhaseResult,
  type PlanTaskCompletionLedger,
  type PlanTaskCompletionRecord,
  type RecoveryAuthorization,
  type ResultDigestComparison,
  type ResultDigestEvidence,
  type ReviewEvidence,
  type ReviewFinding,
  type ReviewResult,
  type CurrentReviewResult,
  type EvaluationRotationReason,
  type ReviewVerdict,
  type RunStatus,
  type SessionMode,
  type TerminalAttemptCheckpoint,
  type TerminalCheckpointResult,
  type TerminalResultContract,
  type VerificationCommand,
  type VerificationAttemptFailureCategory,
  type VerificationAttemptLogEvidence,
  type VerificationAttemptRecord,
  type VerificationAttemptStatus,
  type VerificationLedger,
  type VerificationProfile,
  type VerificationProjectType,
  type WorkflowRoute,
  type WorkflowSelectionResult
} from "./types.js";

const VERIFICATION_ATTEMPT_STATUSES = [
  "started",
  "completed",
  "failed",
  "interrupted"
] as const satisfies readonly VerificationAttemptStatus[];

const VERIFICATION_FAILURE_CATEGORIES = [
  "command_exit",
  "process_start",
  "timeout",
  "output_limit",
  "runner_failure"
] as const satisfies readonly VerificationAttemptFailureCategory[];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new BanzaiError("INVALID_RESULT", `${label} must be an object.`);
  }
  return value;
}

function requireString(
  value: unknown,
  label: string,
  allowEmpty = false
): string {
  if (typeof value !== "string" || (!allowEmpty && value.length === 0)) {
    throw new BanzaiError(
      "INVALID_RESULT",
      `${label} must be a non-empty string.`
    );
  }
  return value;
}

function requireNullableString(value: unknown, label: string): string | null {
  if (value === null) {
    return null;
  }
  return requireString(value, label, true);
}

function requireStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new BanzaiError(
      "INVALID_RESULT",
      `${label} must be an array of strings.`
    );
  }
  // The guard established that every element is a string; `Array.isArray`
  // narrows only to `any[]`.
  return [...new Set(value as string[])];
}

function requireEnum<T extends string>(
  value: unknown,
  label: string,
  allowed: readonly T[]
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new BanzaiError(
      "INVALID_RESULT",
      `${label} must be one of: ${allowed.join(", ")}.`
    );
  }
  return value as T;
}

function requirePositiveInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || (value as number) <= 0) {
    throw new BanzaiError(
      "INVALID_CONFIG",
      `${label} must be a positive integer.`
    );
  }
  return value as number;
}

function parseArtifacts(value: unknown): PhaseArtifacts {
  const record = requireRecord(value, "artifacts");
  return {
    description: requireNullableString(
      record.description,
      "artifacts.description"
    ),
    plan: requireNullableString(record.plan, "artifacts.plan"),
    adrs: requireStringArray(record.adrs, "artifacts.adrs"),
    implementationReport: requireNullableString(
      record.implementationReport,
      "artifacts.implementationReport"
    ),
    testReport: requireNullableString(record.testReport, "artifacts.testReport")
  };
}

const CONSULTATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const UNSAFE_CONSULTATION_CONTROL =
  /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u;

function consultationError(message: string): never {
  throw new BanzaiError("INVALID_RESULT", message);
}

function consultationRecord(
  value: unknown,
  label: string,
  keys: readonly string[]
): Record<string, unknown> {
  const record = requireRecord(value, label);
  exactKeys(record, keys, "INVALID_RESULT", label);
  return record;
}

function consultationString(
  value: unknown,
  label: string,
  maximum: number
): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximum ||
    UNSAFE_CONSULTATION_CONTROL.test(value)
  ) {
    return consultationError(
      `${label} must be a bounded safe single-line string.`
    );
  }
  return value;
}

// Consultation prose renders as terminal lines, yet planners wrap it in
// paragraphs and lists. Layout whitespace collapses before the shared check,
// so every other control character still fails closed and the length bound
// applies to the collapsed text. Identifiers, paths and requirement references
// never pass through here: rewriting them would silently change what they name.
function consultationProse(
  value: unknown,
  label: string,
  maximum: number
): string {
  return consultationString(
    typeof value === "string"
      ? value
          .replace(/[ \t\n\r]*[\t\n\r][ \t\n\r]*/gu, " ")
          .replace(/^ +| +$/gu, "")
      : value,
    label,
    maximum
  );
}

function consultationIdentifier(value: unknown, label: string): string {
  const identifier = consultationString(value, label, 128);
  if (
    identifier === "." ||
    identifier === ".." ||
    !CONSULTATION_ID_PATTERN.test(identifier)
  ) {
    return consultationError(`${label} must be a canonical identifier.`);
  }
  return identifier;
}

function consultationStrings(
  value: unknown,
  label: string,
  maximumItems: number,
  maximumLength: number,
  decodeItem: (value: unknown, label: string, maximum: number) => string
): string[] {
  if (!Array.isArray(value) || value.length > maximumItems) {
    return consultationError(`${label} must be a bounded string array.`);
  }
  const strings = value.map((item, index) =>
    decodeItem(item, `${label}[${index}]`, maximumLength)
  );
  if (new Set(strings).size !== strings.length) {
    return consultationError(`${label} must not contain duplicates.`);
  }
  return strings;
}

function consultationPath(value: unknown, label: string): string {
  const candidate = consultationString(value, label, 300);
  const segments = candidate.split("/");
  if (
    candidate.startsWith("/") ||
    candidate.includes("\\") ||
    /^[A-Za-z]:\//u.test(candidate) ||
    segments.some(
      (segment) => segment === "" || segment === "." || segment === ".."
    )
  ) {
    return consultationError(
      `${label} must be a repository-relative canonical path.`
    );
  }
  return candidate;
}

function parseConsultationOption(
  value: unknown,
  label: string
): DecisionConsultationOption {
  const record = consultationRecord(value, label, [
    "optionId",
    "title",
    "benefits",
    "costs",
    "risks",
    "consequences"
  ]);
  return {
    optionId: consultationIdentifier(record.optionId, `${label}.optionId`),
    title: consultationProse(record.title, `${label}.title`, 160),
    benefits: consultationStrings(
      record.benefits,
      `${label}.benefits`,
      8,
      500,
      consultationProse
    ),
    costs: consultationStrings(
      record.costs,
      `${label}.costs`,
      8,
      500,
      consultationProse
    ),
    risks: consultationStrings(
      record.risks,
      `${label}.risks`,
      8,
      500,
      consultationProse
    ),
    consequences: consultationStrings(
      record.consequences,
      `${label}.consequences`,
      8,
      500,
      consultationProse
    )
  };
}

function parseConsultationCard(
  value: unknown,
  index: number
): DecisionConsultationCard {
  const label = `decisionConsultation.decisions[${index}]`;
  const record = consultationRecord(value, label, [
    "decisionId",
    "title",
    "question",
    "why",
    "affectedRequirements",
    "evidence",
    "decisionOwner",
    "responseMode",
    "options",
    "recommendation"
  ]);
  if (record.decisionOwner !== "human") {
    return consultationError(`${label}.decisionOwner must be human.`);
  }
  const responseMode = requireEnum(
    record.responseMode,
    `${label}.responseMode`,
    ["single_choice", "free_text"] as const
  );
  if (
    !Array.isArray(record.evidence) ||
    record.evidence.length < 1 ||
    record.evidence.length > 12
  ) {
    return consultationError(
      `${label}.evidence must contain one to twelve entries.`
    );
  }
  const evidence = record.evidence.map((item, evidenceIndex) => {
    const evidenceLabel = `${label}.evidence[${evidenceIndex}]`;
    const evidenceRecord = consultationRecord(item, evidenceLabel, [
      "path",
      "line",
      "detail"
    ]);
    const line =
      evidenceRecord.line === null
        ? null
        : Number.isSafeInteger(evidenceRecord.line) &&
            (evidenceRecord.line as number) > 0
          ? (evidenceRecord.line as number)
          : consultationError(
              `${evidenceLabel}.line must be a positive integer or null.`
            );
    return {
      path: consultationPath(evidenceRecord.path, `${evidenceLabel}.path`),
      line,
      detail: consultationProse(
        evidenceRecord.detail,
        `${evidenceLabel}.detail`,
        500
      )
    };
  });
  if (!Array.isArray(record.options) || record.options.length > 6) {
    return consultationError(`${label}.options must be a bounded array.`);
  }
  const options = record.options.map((option, optionIndex) =>
    parseConsultationOption(option, `${label}.options[${optionIndex}]`)
  );
  if (
    new Set(options.map((option) => option.optionId)).size !== options.length
  ) {
    return consultationError(`${label}.option ids must be unique.`);
  }
  if (responseMode === "single_choice" && options.length < 2) {
    return consultationError(
      `${label}.single_choice requires at least two material options.`
    );
  }
  if (responseMode === "free_text" && options.length !== 0) {
    return consultationError(
      `${label}.free_text cannot list selectable options.`
    );
  }
  let recommendation: DecisionConsultationCard["recommendation"] = null;
  if (record.recommendation !== null) {
    const recommendationRecord = consultationRecord(
      record.recommendation,
      `${label}.recommendation`,
      ["optionId", "rationale"]
    );
    const optionId = consultationIdentifier(
      recommendationRecord.optionId,
      `${label}.recommendation.optionId`
    );
    if (!options.some((option) => option.optionId === optionId)) {
      return consultationError(
        `${label}.recommendation must reference a listed option.`
      );
    }
    recommendation = {
      optionId,
      rationale: consultationProse(
        recommendationRecord.rationale,
        `${label}.recommendation.rationale`,
        1000
      )
    };
  }
  if (responseMode === "free_text" && recommendation !== null) {
    return consultationError(
      `${label}.free_text cannot include a recommendation.`
    );
  }
  const affectedRequirements = consultationStrings(
    record.affectedRequirements,
    `${label}.affectedRequirements`,
    16,
    120,
    consultationString
  );
  if (affectedRequirements.length === 0) {
    return consultationError(
      `${label}.affectedRequirements must identify at least one material concern.`
    );
  }
  return {
    decisionId: consultationIdentifier(
      record.decisionId,
      `${label}.decisionId`
    ),
    title: consultationProse(record.title, `${label}.title`, 160),
    question: consultationProse(record.question, `${label}.question`, 1000),
    why: consultationProse(record.why, `${label}.why`, 1200),
    affectedRequirements,
    evidence,
    decisionOwner: "human",
    responseMode,
    options,
    recommendation
  };
}

function parseDecisionConsultation(
  value: unknown
): DecisionConsultationRequest | null {
  if (value === null) {
    return null;
  }
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > 32 * 1024) {
    return consultationError(
      "decisionConsultation must not exceed 32 KiB when serialized."
    );
  }
  const record = consultationRecord(value, "decisionConsultation", [
    "schema",
    "schemaVersion",
    "requestId",
    "roundId",
    "decisions"
  ]);
  if (
    record.schema !== DECISION_CONSULTATION_SCHEMA ||
    record.schemaVersion !== DECISION_CONSULTATION_SCHEMA_VERSION
  ) {
    return consultationError(
      `decisionConsultation must use ${DECISION_CONSULTATION_SCHEMA}.`
    );
  }
  if (
    !Array.isArray(record.decisions) ||
    record.decisions.length < 1 ||
    record.decisions.length > 3
  ) {
    return consultationError(
      "decisionConsultation.decisions must contain one to three cards."
    );
  }
  const decisions = record.decisions.map(parseConsultationCard);
  if (
    new Set(decisions.map((decision) => decision.decisionId)).size !==
    decisions.length
  ) {
    return consultationError(
      "decisionConsultation decision ids must be unique."
    );
  }
  return {
    schema: DECISION_CONSULTATION_SCHEMA,
    schemaVersion: DECISION_CONSULTATION_SCHEMA_VERSION,
    requestId: consultationIdentifier(
      record.requestId,
      "decisionConsultation.requestId"
    ),
    roundId: consultationIdentifier(
      record.roundId,
      "decisionConsultation.roundId"
    ),
    decisions
  };
}

export function parseDecisionConsultationRequest(
  value: unknown
): DecisionConsultationRequest {
  const request = parseDecisionConsultation(value);
  if (request === null) {
    return consultationError("Decision consultation request cannot be null.");
  }
  return request;
}

function consultationAnswerString(
  value: unknown,
  label: string,
  maximum: number
): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximum ||
    value.trim().length === 0 ||
    /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(
      value
    )
  ) {
    return consultationError(`${label} must be bounded non-empty inert text.`);
  }
  return value;
}

export function parseDecisionConsultationAnswers(
  value: unknown,
  request: DecisionConsultationRequest
): DecisionConsultationAnswer[] {
  if (
    !Array.isArray(value) ||
    value.length !== request.decisions.length ||
    Buffer.byteLength(JSON.stringify(value), "utf8") > 64 * 1024
  ) {
    return consultationError(
      "Every consultation card requires exactly one bounded answer."
    );
  }
  const cards = new Map(
    request.decisions.map((decision) => [decision.decisionId, decision])
  );
  const seen = new Set<string>();
  return value.map((item, index) => {
    const label = `answers[${index}]`;
    const answer = consultationRecord(item, label, [
      "decisionId",
      "response",
      "note"
    ]);
    const decisionId = consultationIdentifier(
      answer.decisionId,
      `${label}.decisionId`
    );
    const card = cards.get(decisionId);
    if (card === undefined || seen.has(decisionId)) {
      return consultationError(`${label}.decisionId is unknown or duplicated.`);
    }
    seen.add(decisionId);
    const response = consultationRecord(answer.response, `${label}.response`, [
      "kind",
      "optionId",
      "text"
    ]);
    const kind = requireEnum(response.kind, `${label}.response.kind`, [
      "option",
      "preference"
    ] as const);
    let optionId: string | null = null;
    let text: string | null = null;
    if (kind === "option") {
      if (card.responseMode !== "single_choice" || response.text !== null) {
        return consultationError(
          `${label}.response cannot select an option for this card.`
        );
      }
      optionId = consultationIdentifier(
        response.optionId,
        `${label}.response.optionId`
      );
      if (!card.options.some((option) => option.optionId === optionId)) {
        return consultationError(
          `${label}.response.optionId is not a listed option.`
        );
      }
    } else {
      if (response.optionId !== null) {
        return consultationError(
          `${label}.preference cannot include an option id.`
        );
      }
      text = consultationAnswerString(
        response.text,
        `${label}.response.text`,
        8000
      );
    }
    return {
      decisionId,
      response: { kind, optionId, text },
      note:
        answer.note === null
          ? null
          : consultationAnswerString(answer.note, `${label}.note`, 2000)
    };
  });
}

function completionError(message: string): never {
  throw new BanzaiError("PLAN_TASK_COMPLETION_INVALID", message);
}

function completionString(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 500 ||
    /[\0\r\n]/u.test(value)
  ) {
    return completionError(`${label} must be a bounded single-line string.`);
  }
  return value;
}

function parseTaskCompletion(value: unknown): PlanTaskCompletionLedger | null {
  if (value === null) {
    return null;
  }
  if (!isRecord(value)) {
    return completionError("taskCompletion must be an object or null.");
  }
  if (value.schemaVersion !== PLAN_TASK_COMPLETION_SCHEMA_VERSION) {
    return completionError(
      `taskCompletion must use schema ${PLAN_TASK_COMPLETION_SCHEMA_VERSION}.`
    );
  }
  if (!Array.isArray(value.tasks) || value.tasks.length > 999) {
    return completionError("taskCompletion.tasks must be a bounded array.");
  }
  const tasks: PlanTaskCompletionRecord[] = value.tasks.map((item, index) => {
    if (!isRecord(item)) {
      return completionError(
        `taskCompletion.tasks[${index}] must be an object.`
      );
    }
    const taskId = completionString(
      item.taskId,
      `taskCompletion.tasks[${index}].taskId`
    );
    if (!/^T[0-9]{3}$/u.test(taskId)) {
      return completionError(`${taskId} is not a canonical TNNN task id.`);
    }
    if (
      typeof item.status !== "string" ||
      !["completed", "incomplete", "blocked"].includes(item.status)
    ) {
      return completionError(`${taskId} has an invalid completion status.`);
    }
    if (!Array.isArray(item.evidence) || item.evidence.length > 16) {
      return completionError(`${taskId} evidence must be a bounded array.`);
    }
    const evidence = item.evidence.map((entry, evidenceIndex) => {
      if (!isRecord(entry)) {
        return completionError(
          `${taskId} evidence[${evidenceIndex}] must be an object.`
        );
      }
      return {
        path: completionString(
          entry.path,
          `${taskId} evidence[${evidenceIndex}].path`
        ),
        detail: completionString(
          entry.detail,
          `${taskId} evidence[${evidenceIndex}].detail`
        )
      };
    });
    let gap: PlanTaskCompletionRecord["gap"] = null;
    if (item.gap !== null) {
      if (!isRecord(item.gap)) {
        return completionError(`${taskId} gap must be an object or null.`);
      }
      gap = {
        reportPath: completionString(item.gap.reportPath, `${taskId} gap path`),
        section: completionString(item.gap.section, `${taskId} gap section`),
        detail: completionString(item.gap.detail, `${taskId} gap detail`)
      };
    }
    return {
      taskId,
      status: item.status as PlanTaskCompletionRecord["status"],
      evidence,
      gap
    };
  });
  return { schemaVersion: PLAN_TASK_COMPLETION_SCHEMA_VERSION, tasks };
}

export function parseWorkflowSelectionResult(
  value: unknown
): WorkflowSelectionResult {
  const record = requireRecord(value, "workflow selection");
  if (record.contractVersion !== CONTRACT_VERSION) {
    throw new BanzaiError(
      "CONTRACT_VERSION_MISMATCH",
      `Workflow selection must use contract ${CONTRACT_VERSION}.`
    );
  }
  return {
    contractVersion: CONTRACT_VERSION,
    recommendedWorkflow: requireEnum(
      record.recommendedWorkflow,
      "recommendedWorkflow",
      ["quick-fix", "feature", "strict"] as const
    ),
    confidence: requireEnum(record.confidence, "confidence", [
      "high",
      "medium",
      "low"
    ] as const),
    reason: requireString(record.reason, "reason"),
    escalationTriggers: requireStringArray(
      record.escalationTriggers,
      "escalationTriggers"
    )
  };
}

export function parsePhaseResult(value: unknown): PhaseResult {
  const record = requireRecord(value, "phase result");
  return {
    ...parsePhaseResultFields(record),
    taskCompletion: parseTaskCompletion(record.taskCompletion)
  };
}

const MAX_ORIGINAL_RESULT_BYTES = 4 * 1024 * 1024;
const MAX_UNACCEPTED_LEDGER_PREVIEW = 4_000;

/**
 * Decodes every phase-result field except the completion ledger. Under the
 * completion protocol the envelope must stand on its own, so a malformed
 * ledger cannot discard a safely established stop.
 */
function parsePhaseResultFields(
  record: Record<string, unknown>
): Omit<PhaseResult, "taskCompletion"> {
  exactKeys(
    record,
    [
      "schemaVersion",
      "contractVersion",
      "phase",
      "outcome",
      "gate",
      "summary",
      "artifacts",
      "taskCompletion",
      "touchedPaths",
      "questions",
      "decisionConsultation",
      "resolvedFindingIds",
      "requestedVerification",
      ...(record.schemaVersion === 4 ? ["verificationCandidates"] : [])
    ],
    "INVALID_RESULT",
    "Phase result"
  );
  if (record.schemaVersion !== 3 && record.schemaVersion !== 4) {
    throw new BanzaiError(
      "PHASE_RESULT_SCHEMA_MISMATCH",
      `Phase result must use schema ${PHASE_RESULT_SCHEMA_VERSION}.`
    );
  }
  if (record.contractVersion !== CONTRACT_VERSION) {
    throw new BanzaiError(
      "CONTRACT_VERSION_MISMATCH",
      `Phase result must use contract ${CONTRACT_VERSION}.`
    );
  }

  const gate =
    record.gate === null
      ? null
      : requireEnum(record.gate, "gate", [
          "adr_approval",
          "plan_approval",
          "escalation",
          "decision_consultation"
        ] as const);

  const outcome = requireEnum(record.outcome, "outcome", [
    "completed",
    "needs_human_decision",
    "blocked"
  ] as const);
  if (
    (outcome === "needs_human_decision" && gate === null) ||
    (outcome !== "needs_human_decision" && gate !== null)
  ) {
    throw new BanzaiError(
      "INVALID_RESULT",
      "A non-null gate and needs_human_decision outcome must appear together."
    );
  }
  const phase = requireEnum(record.phase, "phase", [
    "plan",
    "implementation",
    "fix"
  ] as const);
  const questions = requireStringArray(record.questions, "questions");
  const decisionConsultation = parseDecisionConsultation(
    record.decisionConsultation
  );
  const summary =
    gate === "decision_consultation"
      ? consultationProse(record.summary, "summary", 1_000)
      : requireString(record.summary, "summary");
  if (
    gate === "decision_consultation"
      ? phase !== "plan" ||
        outcome !== "needs_human_decision" ||
        decisionConsultation === null ||
        questions.length !== 0
      : decisionConsultation !== null
  ) {
    throw new BanzaiError(
      "INVALID_RESULT",
      "decisionConsultation is allowed only for the planning decision_consultation gate with no escalation questions."
    );
  }

  return {
    schemaVersion: record.schemaVersion,
    ...(record.schemaVersion === 4
      ? {
          verificationCandidates: parseTaskVerificationCandidates(
            record.verificationCandidates
          )
        }
      : {}),
    contractVersion: CONTRACT_VERSION,
    phase,
    outcome,
    gate,
    summary,
    artifacts: parseArtifacts(record.artifacts),
    touchedPaths: requireStringArray(record.touchedPaths, "touchedPaths"),
    questions,
    decisionConsultation,
    resolvedFindingIds: requireStringArray(
      record.resolvedFindingIds,
      "resolvedFindingIds"
    ),
    requestedVerification: requireStringArray(
      record.requestedVerification,
      "requestedVerification"
    )
  };
}

/** A model-authored digest in an accepted result disagreed with its bytes. */
export class ResultDigestRejectedError extends BanzaiError {
  constructor(
    message: string,
    readonly comparisons: ResultDigestComparison[]
  ) {
    super("RESULT_DIGEST_REJECTED", message);
    this.name = "ResultDigestRejectedError";
  }
}

/**
 * The model-authored source identities in a phase result that act as execution
 * preconditions, each named by its exact contract field. Classification comes
 * from the shared task-verification rule, so acceptance and launch cover the
 * same digests. A candidate restating an approved obligation contributes none:
 * the approved descriptor stays in force and the restatement's sources never
 * take effect (ADR-0049 section 2, ADR-0051).
 */
export function effectiveResultSourceIdentities(
  candidates: TaskVerificationCandidates | null,
  requiredCheckIds: Iterable<string>
): { field: string; checkId: string; path: string; declared: string }[] {
  const required = new Set(requiredCheckIds);
  return (candidates?.checks ?? []).flatMap((check) =>
    comparableTaskVerificationSources(check, required.has(check.id)).map(
      (source) => ({
        field: `verificationCandidates.checks[${check.id}].sources[${source.path}].sha256`,
        checkId: check.id,
        path: source.path,
        declared: source.sha256
      })
    )
  );
}

/**
 * One operator-readable line per comparison. Paths, digests and sizes only:
 * no diagnostic this module builds carries the bytes it read.
 */
export function resultDigestDiagnostic(
  comparison: ResultDigestComparison
): string {
  const where = comparison.path === null ? "" : ` at ${comparison.path}`;
  if (comparison.observed === null && comparison.size !== null) {
    const bound =
      comparison.limit === null ? "permitted" : `${comparison.limit}-byte`;
    return `${comparison.field}${where} names a source of ${comparison.size} bytes, above the ${bound} limit.`;
  }
  return `${comparison.field}${where} declared ${comparison.declared} but the bytes hash to ${comparison.observed ?? "an unreadable source"}.`;
}

/**
 * A recorded comparison names its check id and source path inside the contract
 * field template, so this bound must admit the longest field that template can
 * produce: 48 fixed characters, an 80-character check id and a 500-character
 * source path. A tighter bound would reject the runner's own evidence for a
 * result whose digests all match.
 */
const RESULT_DIGEST_FIELD_MAX_LENGTH = 700;

export function parseResultDigestEvidence(
  value: unknown,
  code = "RESULT_DIGEST_EVIDENCE_INVALID"
): ResultDigestEvidence {
  if (!isRecord(value)) {
    return recoveryEvidenceError(
      code,
      "Result digest evidence must be an object."
    );
  }
  exactKeys(
    value,
    ["schema", "schemaVersion", "runId", "attempt", "outcome", "comparisons"],
    code,
    "Result digest evidence"
  );
  if (
    value.schema !== RESULT_DIGEST_EVIDENCE_SCHEMA ||
    value.schemaVersion !== RESULT_DIGEST_EVIDENCE_SCHEMA_VERSION
  ) {
    return recoveryEvidenceError(
      code,
      `Result digest evidence must use ${RESULT_DIGEST_EVIDENCE_SCHEMA}.`
    );
  }
  if (value.outcome !== "accepted" && value.outcome !== "rejected") {
    return recoveryEvidenceError(code, "Result digest outcome is unsupported.");
  }
  if (!isRecord(value.attempt)) {
    return recoveryEvidenceError(code, "attempt must be an object.");
  }
  exactKeys(value.attempt, ["id", "kind"], code, "attempt");
  const kind = value.attempt.kind;
  if (
    typeof kind !== "string" ||
    !["selection", "plan", "implementation", "fix", "review"].includes(kind)
  ) {
    return recoveryEvidenceError(code, "attempt.kind is unsupported.");
  }
  if (!Array.isArray(value.comparisons) || value.comparisons.length > 512) {
    return recoveryEvidenceError(
      code,
      "Result digest comparisons exceed their bound."
    );
  }
  const comparisons = value.comparisons.map(
    (item, index): ResultDigestComparison => {
      const label = `comparisons[${index}]`;
      if (!isRecord(item)) {
        return recoveryEvidenceError(code, `${label} must be an object.`);
      }
      exactKeys(
        item,
        [
          "role",
          "field",
          "checkId",
          "path",
          "declared",
          "observed",
          "size",
          "limit",
          "matched"
        ],
        code,
        label
      );
      if (item.role !== "binding" && item.role !== "precondition") {
        return recoveryEvidenceError(code, `${label}.role is unsupported.`);
      }
      if (typeof item.matched !== "boolean") {
        return recoveryEvidenceError(code, `${label}.matched must be boolean.`);
      }
      return {
        role: item.role,
        field: evidenceString(
          item.field,
          code,
          `${label}.field`,
          RESULT_DIGEST_FIELD_MAX_LENGTH
        ),
        checkId:
          item.checkId === null
            ? null
            : evidenceIdentifier(item.checkId, code, `${label}.checkId`, 80),
        path:
          item.path === null
            ? null
            : evidenceString(item.path, code, `${label}.path`, 500),
        declared: evidenceDigest(item.declared, code, `${label}.declared`),
        observed:
          item.observed === null
            ? null
            : evidenceDigest(item.observed, code, `${label}.observed`),
        size: evidenceByteCount(item.size, code, `${label}.size`),
        limit: evidenceByteCount(item.limit, code, `${label}.limit`),
        matched: item.matched
      };
    }
  );
  if (
    comparisons.some((comparison) => !comparison.matched) !==
    (value.outcome === "rejected")
  ) {
    return recoveryEvidenceError(
      code,
      "Result digest outcome conflicts with its recorded comparisons."
    );
  }
  return {
    schema: RESULT_DIGEST_EVIDENCE_SCHEMA,
    schemaVersion: RESULT_DIGEST_EVIDENCE_SCHEMA_VERSION,
    runId: evidenceIdentifier(value.runId, code, "runId", 300),
    attempt: {
      id: evidenceIdentifier(value.attempt.id, code, "attempt.id", 200),
      kind: kind as AttemptReference["kind"]
    },
    outcome: value.outcome,
    comparisons
  };
}

/**
 * Safe envelope decoding for the completion protocol: exact keys, versions,
 * phase, outcome/gate pairing, questions, artifacts, paths and finding
 * identities validate normally, while the completion ledger is held as a
 * bounded unaccepted diagnostic when the separate ledger parser rejects it.
 */
export function parsePhaseResultEnvelope(value: unknown): PhaseResultEnvelope {
  const record = requireRecord(value, "phase result");
  const fields = parsePhaseResultFields(record);
  const original = stableJson(record);
  if (Buffer.byteLength(original, "utf8") > MAX_ORIGINAL_RESULT_BYTES) {
    throw new BanzaiError(
      "INVALID_RESULT",
      "Phase result exceeds the retained original result bound."
    );
  }
  let taskCompletion: EnvelopeTaskCompletion;
  try {
    taskCompletion = {
      state: "accepted",
      ledger: parseTaskCompletion(record.taskCompletion)
    };
  } catch (error) {
    if (
      !(error instanceof BanzaiError) ||
      error.code !== "PLAN_TASK_COMPLETION_INVALID"
    ) {
      throw error;
    }
    const raw = stableJson(record.taskCompletion);
    taskCompletion = {
      state: "unaccepted",
      diagnostic: error.message.slice(0, 500),
      raw: raw.slice(0, MAX_UNACCEPTED_LEDGER_PREVIEW),
      rawDigest: createHash("sha256").update(raw).digest("hex")
    };
  }
  return {
    ...fields,
    taskCompletion,
    original,
    originalDigest: createHash("sha256").update(original).digest("hex")
  };
}

const ENVELOPE_ONLY_FIELDS = new Set([
  "taskCompletion",
  "original",
  "originalDigest"
]);

/** The plain phase-result fields an envelope carries beside its ledger verdict and retained original. */
export function envelopeResultFields(
  envelope: PhaseResultEnvelope
): Omit<PhaseResult, "taskCompletion"> {
  return Object.fromEntries(
    Object.entries(envelope).filter(([key]) => !ENVELOPE_ONLY_FIELDS.has(key))
  ) as Omit<PhaseResult, "taskCompletion">;
}

/** The validated result an accepted envelope carries; null while the ledger is unaccepted. */
export function phaseResultFromEnvelope(
  envelope: PhaseResultEnvelope
): PhaseResult | null {
  if (envelope.taskCompletion.state !== "accepted") return null;
  return {
    ...envelopeResultFields(envelope),
    taskCompletion: envelope.taskCompletion.ledger
  };
}

/** Re-expresses an already validated result as its accepted envelope. */
export function phaseResultEnvelopeOf(
  result: PhaseResult
): PhaseResultEnvelope {
  return parsePhaseResultEnvelope(JSON.parse(JSON.stringify(result)));
}

export function isPhaseResultEnvelope(
  value: PhaseResult | PhaseResultEnvelope
): value is PhaseResultEnvelope {
  return (
    "original" in value &&
    typeof value.original === "string" &&
    isRecord(value.taskCompletion) &&
    "state" in value.taskCompletion
  );
}

/**
 * Closed reader for a persisted envelope: the stored fields must equal the
 * envelope re-decoded from its own retained original, so neither the ledger
 * verdict nor the diagnostic can be edited apart from the original bytes.
 */
export function parseStoredPhaseResultEnvelope(
  value: unknown,
  code = "ATTEMPT_MALFORMED"
): PhaseResultEnvelope {
  if (!isRecord(value) || typeof value.original !== "string") {
    return recoveryEvidenceError(
      code,
      "Persisted envelope must retain its original result."
    );
  }
  if (Buffer.byteLength(value.original, "utf8") > MAX_ORIGINAL_RESULT_BYTES) {
    return recoveryEvidenceError(
      code,
      "Persisted envelope original exceeds its bound."
    );
  }
  let original: unknown;
  try {
    original = JSON.parse(value.original);
  } catch {
    return recoveryEvidenceError(
      code,
      "Persisted envelope original is not JSON."
    );
  }
  let decoded: PhaseResultEnvelope;
  try {
    decoded = parsePhaseResultEnvelope(original);
  } catch (error) {
    return recoveryEvidenceError(
      code,
      `Persisted envelope original does not decode: ${(error as Error).message}`
    );
  }
  if (stableJson(decoded) !== stableJson(value)) {
    return recoveryEvidenceError(
      code,
      "Persisted envelope conflicts with its retained original result."
    );
  }
  return decoded;
}

export function parsePersistedPhaseResult(
  value: unknown
): PersistedPhaseResult {
  const record = requireRecord(value, "persisted phase result");
  if (record.schemaVersion === 3 || record.schemaVersion === 4) {
    return parsePhaseResult(record);
  }
  const schemaVersion =
    record.schemaVersion === 2
      ? 2
      : record.schemaVersion === undefined || record.schemaVersion === 1
        ? 1
        : null;
  if (schemaVersion === null) {
    throw new BanzaiError(
      "PHASE_RESULT_SCHEMA_MISMATCH",
      "Persisted phase result schema is unsupported."
    );
  }
  exactKeys(
    record,
    schemaVersion === 1
      ? [
          ...(Object.hasOwn(record, "schemaVersion") ? ["schemaVersion"] : []),
          "contractVersion",
          "phase",
          "outcome",
          "gate",
          "summary",
          "artifacts",
          "touchedPaths",
          "questions",
          "resolvedFindingIds",
          "requestedVerification"
        ]
      : [
          "schemaVersion",
          "contractVersion",
          "phase",
          "outcome",
          "gate",
          "summary",
          "artifacts",
          "taskCompletion",
          "touchedPaths",
          "questions",
          "resolvedFindingIds",
          "requestedVerification"
        ],
    "INVALID_RESULT",
    "Persisted phase result"
  );
  if (record.contractVersion !== CONTRACT_VERSION) {
    throw new BanzaiError(
      "CONTRACT_VERSION_MISMATCH",
      `Phase result must use contract ${CONTRACT_VERSION}.`
    );
  }
  const phase = requireEnum(record.phase, "phase", [
    "plan",
    "implementation",
    "fix"
  ] as const);
  const gate =
    record.gate === null
      ? null
      : requireEnum(record.gate, "gate", [
          "adr_approval",
          "plan_approval",
          "escalation"
        ] as const);
  const reportedOutcome = requireEnum(record.outcome, "outcome", [
    "completed",
    "needs_human_decision",
    "blocked"
  ] as const);
  const outcome =
    reportedOutcome === "completed" && gate !== null
      ? "needs_human_decision"
      : reportedOutcome;
  if (outcome === "needs_human_decision" && gate === null) {
    throw new BanzaiError(
      "INVALID_RESULT",
      "needs_human_decision requires a non-null gate."
    );
  }
  let artifacts: PhaseArtifacts;
  if (schemaVersion === 1) {
    const legacyArtifacts = consultationRecord(record.artifacts, "artifacts", [
      "description",
      "plan",
      "adrs",
      "implementationReport"
    ]);
    artifacts = {
      description: requireNullableString(
        legacyArtifacts.description,
        "artifacts.description"
      ),
      plan: requireNullableString(legacyArtifacts.plan, "artifacts.plan"),
      adrs: requireStringArray(legacyArtifacts.adrs, "artifacts.adrs"),
      implementationReport: requireNullableString(
        legacyArtifacts.implementationReport,
        "artifacts.implementationReport"
      ),
      testReport: null
    };
  } else {
    artifacts = parseArtifacts(record.artifacts);
  }
  return {
    schemaVersion,
    contractVersion: CONTRACT_VERSION,
    phase,
    outcome,
    gate,
    summary: requireString(record.summary, "summary"),
    artifacts,
    taskCompletion:
      schemaVersion === 1 ? null : parseTaskCompletion(record.taskCompletion),
    touchedPaths: requireStringArray(record.touchedPaths, "touchedPaths"),
    questions: requireStringArray(record.questions, "questions"),
    resolvedFindingIds: requireStringArray(
      record.resolvedFindingIds,
      "resolvedFindingIds"
    ),
    requestedVerification: requireStringArray(
      record.requestedVerification,
      "requestedVerification"
    )
  };
}

function parseEvidence(value: unknown, findingId: string): ReviewEvidence {
  const record = requireRecord(value, `${findingId}.evidence`);
  const line =
    record.line === null
      ? null
      : requirePositiveInteger(record.line, `${findingId}.evidence.line`);
  return {
    path: requireString(record.path, `${findingId}.evidence.path`),
    line,
    detail: requireString(record.detail, `${findingId}.evidence.detail`)
  };
}

function parseFinding(value: unknown): ReviewFinding {
  const record = requireRecord(value, "finding");
  const id = requireString(record.id, "finding.id");
  if (!/^R[1-9][0-9]*-F[1-9][0-9]*$/.test(id)) {
    throw new BanzaiError(
      "INVALID_RESULT",
      `Finding id ${id} must match R<iteration>-F<number>.`
    );
  }
  if (!Array.isArray(record.evidence) || record.evidence.length === 0) {
    throw new BanzaiError(
      "INVALID_RESULT",
      `${id}.evidence must contain at least one item.`
    );
  }

  return {
    id,
    severity: requireEnum(record.severity, `${id}.severity`, [
      "blocker",
      "should_fix",
      "nit"
    ] as const),
    category: requireEnum(record.category, `${id}.category`, [
      "spec",
      "plan",
      "adr",
      "correctness",
      "test",
      "security",
      "maintainability",
      "documentation"
    ] as const),
    summary: requireString(record.summary, `${id}.summary`),
    evidence: record.evidence.map((item) => parseEvidence(item, id)),
    violates: requireStringArray(record.violates, `${id}.violates`),
    reproduction: requireNullableString(
      record.reproduction,
      `${id}.reproduction`
    ),
    fixAcceptance: requireString(record.fixAcceptance, `${id}.fixAcceptance`),
    confidence: requireEnum(record.confidence, `${id}.confidence`, [
      "high",
      "medium",
      "low"
    ] as const)
  };
}

function parseReviewFields(value: unknown): ReviewResult {
  const record = requireRecord(value, "review result");
  if (record.contractVersion !== CONTRACT_VERSION) {
    throw new BanzaiError(
      "CONTRACT_VERSION_MISMATCH",
      `Review result must use contract ${CONTRACT_VERSION}.`
    );
  }
  if (!Array.isArray(record.findings)) {
    throw new BanzaiError("INVALID_RESULT", "findings must be an array.");
  }
  const findings = record.findings.map(parseFinding);
  const ids = new Set(findings.map((finding) => finding.id));
  if (ids.size !== findings.length) {
    throw new BanzaiError("INVALID_RESULT", "Finding ids must be unique.");
  }

  const verdict = requireEnum(record.verdict, "verdict", [
    "pass",
    "changes_requested",
    "replan_required",
    "blocked"
  ] as const);
  if (verdict === "pass" && findings.length > 0) {
    throw new BanzaiError(
      "INVALID_RESULT",
      "A passing review cannot contain findings."
    );
  }
  if (verdict === "changes_requested" && findings.length === 0) {
    throw new BanzaiError(
      "INVALID_RESULT",
      "changes_requested must contain at least one finding."
    );
  }

  return {
    contractVersion: CONTRACT_VERSION,
    verdict,
    summary: requireString(record.summary, "summary"),
    findings,
    reviewedFindingIds: requireStringArray(
      record.reviewedFindingIds,
      "reviewedFindingIds"
    ),
    deferredCoverage: requireStringArray(
      record.deferredCoverage,
      "deferredCoverage"
    )
  };
}

/** Historical reads dispatch explicitly; new invocations use the strict v2 decoder. */
export function parseReviewResult(value: unknown): ReviewResult {
  const record = requireRecord(value, "review result");
  if (
    record.schemaVersion !== undefined ||
    record.scopeAcknowledgment !== undefined ||
    record.reviewNotes !== undefined
  ) {
    return parseCurrentReviewResult(value);
  }
  return parseReviewFields(value);
}

export function reviewScopePath(value: unknown): string {
  const name = requireString(value, "scope path");
  if (
    /^[A-Za-z]:/u.test(name) ||
    /[\\\0\r\n]/u.test(name) ||
    name.startsWith("/") ||
    name.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new BanzaiError(
      "INVALID_REVIEW_SCOPE",
      "Scope paths must be exact normalized repository-relative paths."
    );
  }
  return name;
}

export function parseCurrentReviewResult(value: unknown): CurrentReviewResult {
  const record = requireRecord(value, "review result");
  if (record.schemaVersion !== 2)
    throw new BanzaiError(
      "REVIEW_RESULT_SCHEMA_MISMATCH",
      "New reviews require review-result/v2."
    );
  exactKeys(
    record,
    [
      "contractVersion",
      "schemaVersion",
      "verdict",
      "summary",
      "findings",
      "reviewedFindingIds",
      "deferredCoverage",
      "reviewNotes",
      "scopeAcknowledgment"
    ],
    "INVALID_RESULT",
    "Review result"
  );
  const result = parseReviewFields(value);
  const strings = (value: unknown, label: string): string[] => {
    requireStringArray(value, label);
    return [...(value as string[])];
  };
  result.reviewedFindingIds = strings(
    record.reviewedFindingIds,
    "reviewedFindingIds"
  );
  result.deferredCoverage = strings(
    record.deferredCoverage,
    "deferredCoverage"
  );
  // V1 field decoding preserves prose; v2 also rejects unexpected nested data.
  for (const [index, item] of (record.findings as unknown[]).entries()) {
    const finding = requireRecord(item, "finding");
    const parsedFinding = result.findings[index];
    if (parsedFinding === undefined)
      throw new BanzaiError("INVALID_RESULT", "Finding is missing.");
    parsedFinding.violates = strings(finding.violates, "violates");
    exactKeys(
      finding,
      [
        "id",
        "severity",
        "category",
        "confidence",
        "summary",
        "evidence",
        "violates",
        "reproduction",
        "fixAcceptance"
      ],
      "INVALID_RESULT",
      "Finding"
    );
    for (const evidence of finding.evidence as unknown[])
      exactKeys(
        requireRecord(evidence, "evidence"),
        ["path", "line", "detail"],
        "INVALID_RESULT",
        "Finding evidence"
      );
  }
  const acknowledgment = requireRecord(
    record.scopeAcknowledgment,
    "scopeAcknowledgment"
  );
  exactKeys(
    acknowledgment,
    ["schemaVersion", "snapshotDigest", "artifacts"],
    "INVALID_REVIEW_SCOPE",
    "Scope acknowledgment"
  );
  if (
    acknowledgment.schemaVersion !== 1 ||
    !Array.isArray(acknowledgment.artifacts)
  )
    throw new BanzaiError(
      "INVALID_REVIEW_SCOPE",
      "Scope acknowledgment requires version 1 and explicit artifacts."
    );
  const snapshotDigest = evidenceDigest(
    acknowledgment.snapshotDigest,
    "INVALID_REVIEW_SCOPE",
    "snapshotDigest"
  );
  const artifacts = acknowledgment.artifacts.map((value) => {
    const entry = requireRecord(value, "scope entry");
    exactKeys(
      entry,
      ["path", "status", "reason"],
      "INVALID_REVIEW_SCOPE",
      "Scope entry"
    );
    const path = reviewScopePath(entry.path);
    const status = requireEnum(entry.status, "scope status", [
      "reviewed",
      "not_reviewed"
    ] as const);
    if (
      status === "reviewed"
        ? entry.reason !== null
        : typeof entry.reason !== "string" || entry.reason.trim().length === 0
    )
      throw new BanzaiError(
        "INVALID_REVIEW_SCOPE",
        "Reviewed scope requires a null reason; unreviewed scope requires a nonblank reason."
      );
    return { path, status, reason: entry.reason as string | null };
  });
  if (
    new Set(artifacts.map((entry) => entry.path)).size !== artifacts.length ||
    new Set(result.reviewedFindingIds).size !== result.reviewedFindingIds.length
  )
    throw new BanzaiError(
      "INVALID_REVIEW_SCOPE",
      "Scope and reviewed finding IDs must be unique."
    );
  if (
    result.verdict !== "blocked" &&
    artifacts.some((entry) => entry.status === "not_reviewed")
  )
    throw new BanzaiError(
      "INVALID_REVIEW_SCOPE",
      "Incomplete required review scope must have a blocked verdict."
    );
  return {
    ...result,
    schemaVersion: 2,
    reviewNotes: strings(record.reviewNotes, "reviewNotes"),
    scopeAcknowledgment: { schemaVersion: 1, snapshotDigest, artifacts }
  };
}

export function validateReviewScope(
  result: CurrentReviewResult,
  scope: {
    snapshotDigest: string;
    approvedArtifactPaths: readonly string[];
    requiredFindingIds: readonly string[];
  }
): void {
  const actual = result.scopeAcknowledgment;
  const paths = new Set(scope.approvedArtifactPaths);
  if (
    paths.size !== scope.approvedArtifactPaths.length ||
    actual.snapshotDigest !== scope.snapshotDigest ||
    actual.artifacts.length !== paths.size ||
    actual.artifacts.some((entry) => !paths.has(entry.path))
  )
    throw new BanzaiError(
      "INVALID_REVIEW_SCOPE",
      "Review acknowledgment does not match the exact approved snapshot scope."
    );
  if (
    result.reviewedFindingIds.some(
      (id) => !scope.requiredFindingIds.includes(id)
    ) ||
    (result.verdict !== "blocked" &&
      scope.requiredFindingIds.some(
        (id) => !result.reviewedFindingIds.includes(id)
      ))
  )
    throw new BanzaiError(
      "INVALID_REVIEW_SCOPE",
      "Reviewed finding IDs do not truthfully account for the required accepted findings."
    );
}

function recoveryEvidenceError(code: string, message: string): never {
  throw new BanzaiError(code, message);
}

function exactKeys(
  record: Record<string, unknown>,
  allowed: readonly string[],
  code: string,
  label: string
): void {
  const allowedKeys = new Set(allowed);
  const unknown = Object.keys(record).filter((key) => !allowedKeys.has(key));
  if (unknown.length > 0) {
    recoveryEvidenceError(
      code,
      `${label} contains unknown fields: ${unknown.sort().join(", ")}.`
    );
  }
}

function evidenceString(
  value: unknown,
  code: string,
  label: string,
  maximum = 500
): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximum ||
    /[\0\r\n]/u.test(value)
  ) {
    return recoveryEvidenceError(
      code,
      `${label} must be a bounded single-line string.`
    );
  }
  return value;
}

function evidenceNullableString(
  value: unknown,
  code: string,
  label: string,
  maximum = 500
): string | null {
  return value === null ? null : evidenceString(value, code, label, maximum);
}

function evidenceByteCount(
  value: unknown,
  code: string,
  label: string
): number | null {
  if (
    value !== null &&
    (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
  ) {
    return recoveryEvidenceError(code, `${label} must be a byte count.`);
  }
  return value;
}

function evidenceIdentifier(
  value: unknown,
  code: string,
  label: string,
  maximum = 200
): string {
  const identifier = evidenceString(value, code, label, maximum);
  if (
    identifier === "." ||
    identifier === ".." ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(identifier)
  ) {
    return recoveryEvidenceError(
      code,
      `${label} must be a canonical safe identifier.`
    );
  }
  return identifier;
}

function evidenceDigest(value: unknown, code: string, label: string): string {
  const digest = evidenceString(value, code, label, 64);
  if (!/^[a-f0-9]{64}$/u.test(digest)) {
    return recoveryEvidenceError(code, `${label} must be a SHA-256 digest.`);
  }
  return digest;
}

function evidenceTimestamp(
  value: unknown,
  code: string,
  label: string
): string {
  const timestamp = evidenceString(value, code, label, 64);
  const normalized = normalizeRfc3339Instant(timestamp);
  if (normalized === undefined) {
    return recoveryEvidenceError(code, `${label} must be an RFC 3339 time.`);
  }
  return normalized;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function digestCanonicalJson(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function parseEvidenceAttempt(
  value: unknown,
  code: string,
  label: string
): AttemptReference {
  if (!isRecord(value)) {
    return recoveryEvidenceError(code, `${label} must be an object.`);
  }
  exactKeys(value, ["id", "kind", "mutable"], code, label);
  const id = evidenceIdentifier(value.id, code, `${label}.id`, 200);
  const kind = value.kind;
  if (
    typeof kind !== "string" ||
    !["selection", "plan", "implementation", "fix", "review"].includes(kind)
  ) {
    return recoveryEvidenceError(code, `${label}.kind is unsupported.`);
  }
  if (typeof value.mutable !== "boolean") {
    return recoveryEvidenceError(code, `${label}.mutable must be boolean.`);
  }
  return {
    id,
    kind: kind as AttemptReference["kind"],
    mutable: value.mutable
  };
}

function parseEvidenceUsage(
  value: unknown,
  code: string,
  label: string
): TerminalAttemptCheckpoint["usage"] {
  if (value === null) {
    return null;
  }
  if (!isRecord(value)) {
    return recoveryEvidenceError(code, `${label} must be an object or null.`);
  }
  exactKeys(
    value,
    ["inputTokens", "cachedInputTokens", "outputTokens", "costUsd"],
    code,
    label
  );
  const numeric = (item: unknown, field: string, nullable = false) => {
    if (nullable && item === null) {
      return null;
    }
    if (typeof item !== "number" || !Number.isFinite(item) || item < 0) {
      return recoveryEvidenceError(
        code,
        `${label}.${field} must be a non-negative number${nullable ? " or null" : ""}.`
      );
    }
    return item;
  };
  const requiredNumeric = (item: unknown, field: string): number => {
    const parsed = numeric(item, field);
    return (
      parsed ?? recoveryEvidenceError(code, `${label}.${field} cannot be null.`)
    );
  };
  return {
    inputTokens: requiredNumeric(value.inputTokens, "inputTokens"),
    cachedInputTokens: requiredNumeric(
      value.cachedInputTokens,
      "cachedInputTokens"
    ),
    outputTokens: requiredNumeric(value.outputTokens, "outputTokens"),
    costUsd: numeric(value.costUsd, "costUsd", true)
  };
}

function parseCheckpointResult(
  kind: AttemptReference["kind"],
  value: unknown,
  resultContract: TerminalResultContract
): TerminalCheckpointResult {
  if (kind === "selection") {
    return parseWorkflowSelectionResult(value);
  }
  if (kind === "review") {
    if (resultContract === "review-result/v2")
      return parseCurrentReviewResult(value);
    const legacy = requireRecord(value, "legacy review");
    if (
      legacy.schemaVersion !== undefined ||
      legacy.scopeAcknowledgment !== undefined ||
      legacy.reviewNotes !== undefined
    )
      return recoveryEvidenceError(
        "INVALID_TERMINAL_CHECKPOINT",
        "Legacy checkpoint cannot carry a new review result."
      );
    return parseReviewFields(value);
  }
  if (
    resultContract === "phase-result/v3" ||
    resultContract === "phase-result/v4"
  ) {
    const result = parsePhaseResult(value);
    if (result.schemaVersion !== (resultContract === "phase-result/v4" ? 4 : 3))
      throw new BanzaiError(
        "PHASE_RESULT_SCHEMA_MISMATCH",
        "Phase result does not match the attempted contract."
      );
    return result;
  }
  const result = parsePersistedPhaseResult(value);
  if (result.schemaVersion !== 2) {
    return recoveryEvidenceError(
      "INVALID_TERMINAL_CHECKPOINT",
      "Legacy phase-result/v2 checkpoint must contain a v2 result."
    );
  }
  return result;
}

export function terminalCheckpointIntegrity(
  checkpoint:
    | Omit<TerminalAttemptCheckpoint, "integrityDigest">
    | Omit<TerminalAttemptCheckpointV2, "integrityDigest">
): string {
  return digestCanonicalJson(checkpoint);
}

/** Same canonical hashing for every completion protocol record. */
export function completionRecordIntegrity(record: unknown): string {
  return digestCanonicalJson(record);
}

function parseCompletionIdentity(
  value: Record<string, unknown>,
  code: string
): {
  runId: string;
  attemptId: string;
  attemptKind: "implementation" | "fix";
  completionProtocol: typeof COMPLETION_PROTOCOL;
} {
  if (value.completionProtocol !== COMPLETION_PROTOCOL) {
    return recoveryEvidenceError(
      code,
      `Completion record must carry ${COMPLETION_PROTOCOL}.`
    );
  }
  const attemptKind = value.attemptKind;
  if (attemptKind !== "implementation" && attemptKind !== "fix") {
    return recoveryEvidenceError(code, "attemptKind is unsupported.");
  }
  return {
    runId: evidenceIdentifier(value.runId, code, "runId", 300),
    attemptId: evidenceIdentifier(value.attemptId, code, "attemptId", 200),
    attemptKind,
    completionProtocol: COMPLETION_PROTOCOL
  };
}

function requireIntegrity<T extends { integrityDigest: string }>(
  value: Record<string, unknown>,
  record: Omit<T, "integrityDigest">,
  code: string,
  label: string
): T {
  const integrityDigest = evidenceDigest(
    value.integrityDigest,
    code,
    "integrityDigest"
  );
  if (integrityDigest !== completionRecordIntegrity(record)) {
    return recoveryEvidenceError(code, `${label} integrity mismatch.`);
  }
  return { ...record, integrityDigest } as T;
}

function reportIdentity(
  value: unknown,
  code: string,
  label: string
): { path: string; sha256: string } {
  if (!isRecord(value)) {
    return recoveryEvidenceError(code, `${label} must be an object.`);
  }
  exactKeys(value, ["path", "sha256"], code, label);
  return {
    path: evidenceString(value.path, code, `${label}.path`),
    sha256: evidenceDigest(value.sha256, code, `${label}.sha256`)
  };
}

function nullableReportIdentity(
  value: unknown,
  code: string,
  label: string
): { path: string; sha256: string } | null {
  return value === null ? null : reportIdentity(value, code, label);
}

function ledgerSourceIdentity(
  value: unknown,
  code: string,
  label: string
): {
  attemptId: string;
  attemptKind: "implementation" | "fix";
  ledgerDigest: string;
} {
  if (!isRecord(value)) {
    return recoveryEvidenceError(code, `${label} must be an object.`);
  }
  exactKeys(value, ["attemptId", "attemptKind", "ledgerDigest"], code, label);
  const attemptKind = value.attemptKind;
  if (attemptKind !== "implementation" && attemptKind !== "fix") {
    return recoveryEvidenceError(code, `${label}.attemptKind is unsupported.`);
  }
  return {
    attemptId: evidenceIdentifier(value.attemptId, code, `${label}.attemptId`),
    attemptKind,
    ledgerDigest: evidenceDigest(
      value.ledgerDigest,
      code,
      `${label}.ledgerDigest`
    )
  };
}

export function parseCompletionTransition(
  value: unknown
): CompletionTransition {
  const code = "INVALID_COMPLETION_TRANSITION";
  if (!isRecord(value)) {
    return recoveryEvidenceError(
      code,
      "Completion transition must be an object."
    );
  }
  exactKeys(
    value,
    [
      "schema",
      "schemaVersion",
      "runId",
      "attemptId",
      "attemptKind",
      "completionProtocol",
      "priorState",
      "integrityDigest"
    ],
    code,
    "Completion transition"
  );
  if (
    value.schema !== COMPLETION_TRANSITION_SCHEMA ||
    value.schemaVersion !== COMPLETION_RECORD_SCHEMA_VERSION
  ) {
    return recoveryEvidenceError(
      code,
      `Completion transition must use ${COMPLETION_TRANSITION_SCHEMA}.`
    );
  }
  if (!isRecord(value.priorState)) {
    return recoveryEvidenceError(code, "priorState must be an object.");
  }
  exactKeys(
    value.priorState,
    ["schemaVersion", "path", "sha256"],
    code,
    "priorState"
  );
  if (
    value.priorState.schemaVersion !== 3 &&
    value.priorState.schemaVersion !== 4 &&
    value.priorState.schemaVersion !== 6
  ) {
    return recoveryEvidenceError(
      code,
      "priorState.schemaVersion must be a legacy 3 or bootstrap 4/6 state."
    );
  }
  const record: Omit<CompletionTransition, "integrityDigest"> = {
    schema: COMPLETION_TRANSITION_SCHEMA,
    schemaVersion: COMPLETION_RECORD_SCHEMA_VERSION,
    ...parseCompletionIdentity(value, code),
    priorState: {
      schemaVersion: value.priorState.schemaVersion,
      path: evidenceString(value.priorState.path, code, "priorState.path"),
      sha256: evidenceDigest(value.priorState.sha256, code, "priorState.sha256")
    }
  };
  return requireIntegrity<CompletionTransition>(
    value,
    record,
    code,
    "Completion transition"
  );
}

export function parseCompletionCapture(value: unknown): CompletionCapture {
  const code = "INVALID_COMPLETION_CAPTURE";
  if (!isRecord(value)) {
    return recoveryEvidenceError(code, "Completion capture must be an object.");
  }
  exactKeys(
    value,
    [
      "schema",
      "schemaVersion",
      "runId",
      "attemptId",
      "attemptKind",
      "completionProtocol",
      "outcome",
      "resultDigest",
      "terminalIntegrityDigest",
      "transitionDigest",
      "baseCommit",
      "approvalDigest",
      "planTaskDigest",
      "workBinding",
      "configurationDigest",
      "scopeDigest",
      "ledgerSource",
      "reports",
      "originals",
      "workspace",
      "capturedAt",
      "integrityDigest"
    ],
    code,
    "Completion capture"
  );
  if (
    value.schema !== COMPLETION_CAPTURE_SCHEMA ||
    value.schemaVersion !== COMPLETION_RECORD_SCHEMA_VERSION
  ) {
    return recoveryEvidenceError(
      code,
      `Completion capture must use ${COMPLETION_CAPTURE_SCHEMA}.`
    );
  }
  if (value.outcome !== "completed" && value.outcome !== "stop") {
    return recoveryEvidenceError(code, "outcome is unsupported.");
  }
  if (!isRecord(value.reports)) {
    return recoveryEvidenceError(code, "reports must be an object.");
  }
  exactKeys(
    value.reports,
    ["implementationReport", "testReport"],
    code,
    "reports"
  );
  if (!isRecord(value.originals)) {
    return recoveryEvidenceError(code, "originals must be an object.");
  }
  exactKeys(
    value.originals,
    ["implementationReport", "testReport"],
    code,
    "originals"
  );
  if (!isRecord(value.workspace)) {
    return recoveryEvidenceError(code, "workspace must be an object.");
  }
  exactKeys(value.workspace, ["digest", "excludedPaths"], code, "workspace");
  if (
    !Array.isArray(value.workspace.excludedPaths) ||
    value.workspace.excludedPaths.length > 8
  ) {
    return recoveryEvidenceError(
      code,
      "workspace.excludedPaths must be a bounded array."
    );
  }
  let workBinding: CompletionCapture["workBinding"] = null;
  if (value.workBinding !== null) {
    if (!isRecord(value.workBinding)) {
      return recoveryEvidenceError(
        code,
        "workBinding must be an object or null."
      );
    }
    exactKeys(value.workBinding, ["workId", "sha256"], code, "workBinding");
    workBinding = {
      workId: evidenceIdentifier(
        value.workBinding.workId,
        code,
        "workBinding.workId"
      ),
      sha256: evidenceDigest(
        value.workBinding.sha256,
        code,
        "workBinding.sha256"
      )
    };
  }
  const record: Omit<CompletionCapture, "integrityDigest"> = {
    schema: COMPLETION_CAPTURE_SCHEMA,
    schemaVersion: COMPLETION_RECORD_SCHEMA_VERSION,
    ...parseCompletionIdentity(value, code),
    outcome: value.outcome,
    resultDigest: evidenceDigest(value.resultDigest, code, "resultDigest"),
    terminalIntegrityDigest: nullableEvidenceDigest(
      value.terminalIntegrityDigest,
      code,
      "terminalIntegrityDigest"
    ),
    transitionDigest: nullableEvidenceDigest(
      value.transitionDigest,
      code,
      "transitionDigest"
    ),
    baseCommit: evidenceString(value.baseCommit, code, "baseCommit", 100),
    approvalDigest: evidenceDigest(
      value.approvalDigest,
      code,
      "approvalDigest"
    ),
    planTaskDigest: evidenceDigest(
      value.planTaskDigest,
      code,
      "planTaskDigest"
    ),
    workBinding,
    configurationDigest: evidenceDigest(
      value.configurationDigest,
      code,
      "configurationDigest"
    ),
    scopeDigest: nullableEvidenceDigest(value.scopeDigest, code, "scopeDigest"),
    ledgerSource:
      value.ledgerSource === null
        ? null
        : ledgerSourceIdentity(value.ledgerSource, code, "ledgerSource"),
    reports: {
      implementationReport: parseReportObservation(
        value.reports.implementationReport,
        code,
        "reports.implementationReport"
      ),
      testReport: parseReportObservation(
        value.reports.testReport,
        code,
        "reports.testReport"
      )
    },
    originals: {
      implementationReport: nullableReportIdentity(
        value.originals.implementationReport,
        code,
        "originals.implementationReport"
      ),
      testReport: nullableReportIdentity(
        value.originals.testReport,
        code,
        "originals.testReport"
      )
    },
    workspace: {
      digest: evidenceDigest(value.workspace.digest, code, "workspace.digest"),
      excludedPaths: value.workspace.excludedPaths.map((item, index) =>
        evidenceString(item, code, `workspace.excludedPaths[${index}]`)
      )
    },
    capturedAt: evidenceTimestamp(value.capturedAt, code, "capturedAt")
  };
  return requireIntegrity<CompletionCapture>(
    value,
    record,
    code,
    "Completion capture"
  );
}

export function parseCompletionCandidate(value: unknown): CompletionCandidate {
  const code = "INVALID_COMPLETION_CANDIDATE";
  if (!isRecord(value)) {
    return recoveryEvidenceError(
      code,
      "Completion candidate must be an object."
    );
  }
  exactKeys(
    value,
    [
      "schema",
      "schemaVersion",
      "runId",
      "attemptId",
      "attemptKind",
      "completionProtocol",
      "captureDigest",
      "ledgerDigest",
      "destination",
      "inputSha256",
      "candidatePath",
      "outputSha256",
      "outputBytes",
      "testReportSha256",
      "region",
      "preservation",
      "roundtrip",
      "integrityDigest"
    ],
    code,
    "Completion candidate"
  );
  if (
    value.schema !== COMPLETION_CANDIDATE_SCHEMA ||
    value.schemaVersion !== COMPLETION_RECORD_SCHEMA_VERSION
  ) {
    return recoveryEvidenceError(
      code,
      `Completion candidate must use ${COMPLETION_CANDIDATE_SCHEMA}.`
    );
  }
  if (!isRecord(value.region)) {
    return recoveryEvidenceError(code, "region must be an object.");
  }
  exactKeys(value.region, ["action", "start", "end"], code, "region");
  const action = value.region.action;
  const { start, end } = value.region;
  if (
    (action !== "appended" && action !== "replaced") ||
    typeof start !== "number" ||
    typeof end !== "number" ||
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end < start
  ) {
    return recoveryEvidenceError(code, "region is malformed.");
  }
  if (
    typeof value.outputBytes !== "number" ||
    !Number.isSafeInteger(value.outputBytes) ||
    value.outputBytes < 0 ||
    value.preservation !== "verified" ||
    value.roundtrip !== "verified"
  ) {
    return recoveryEvidenceError(code, "Candidate proof fields are malformed.");
  }
  const record: Omit<CompletionCandidate, "integrityDigest"> = {
    schema: COMPLETION_CANDIDATE_SCHEMA,
    schemaVersion: COMPLETION_RECORD_SCHEMA_VERSION,
    ...parseCompletionIdentity(value, code),
    captureDigest: evidenceDigest(value.captureDigest, code, "captureDigest"),
    ledgerDigest: evidenceDigest(value.ledgerDigest, code, "ledgerDigest"),
    destination: evidenceString(value.destination, code, "destination"),
    inputSha256: evidenceDigest(value.inputSha256, code, "inputSha256"),
    candidatePath: evidenceString(value.candidatePath, code, "candidatePath"),
    outputSha256: evidenceDigest(value.outputSha256, code, "outputSha256"),
    outputBytes: value.outputBytes,
    testReportSha256: evidenceDigest(
      value.testReportSha256,
      code,
      "testReportSha256"
    ),
    region: { action, start, end },
    preservation: "verified",
    roundtrip: "verified"
  };
  return requireIntegrity<CompletionCandidate>(
    value,
    record,
    code,
    "Completion candidate"
  );
}

export function parseCompletionPublication(
  value: unknown
): CompletionPublication {
  const code = "INVALID_COMPLETION_PUBLICATION";
  if (!isRecord(value)) {
    return recoveryEvidenceError(
      code,
      "Completion publication must be an object."
    );
  }
  exactKeys(
    value,
    [
      "schema",
      "schemaVersion",
      "runId",
      "attemptId",
      "attemptKind",
      "completionProtocol",
      "captureDigest",
      "candidateDigest",
      "terminalIntegrityDigest",
      "authority",
      "ledgerAuthor",
      "publisher",
      "implementationReport",
      "testReport",
      "publishedAt",
      "integrityDigest"
    ],
    code,
    "Completion publication"
  );
  if (
    value.schema !== COMPLETION_PUBLICATION_SCHEMA ||
    value.schemaVersion !== COMPLETION_RECORD_SCHEMA_VERSION
  ) {
    return recoveryEvidenceError(
      code,
      `Completion publication must use ${COMPLETION_PUBLICATION_SCHEMA}.`
    );
  }
  if (!isRecord(value.authority)) {
    return recoveryEvidenceError(code, "authority must be an object.");
  }
  exactKeys(
    value.authority,
    [
      "baseCommit",
      "approvalDigest",
      "planTaskDigest",
      "scopeDigest",
      "workBindingSha256",
      "configurationDigest"
    ],
    code,
    "authority"
  );
  if (!isRecord(value.publisher)) {
    return recoveryEvidenceError(code, "publisher must be an object.");
  }
  exactKeys(value.publisher, ["attemptId", "attemptKind"], code, "publisher");
  const publisherKind = value.publisher.attemptKind;
  if (publisherKind !== "implementation" && publisherKind !== "fix") {
    return recoveryEvidenceError(code, "publisher.attemptKind is unsupported.");
  }
  const identity = parseCompletionIdentity(value, code);
  const publisher: CompletionPublication["publisher"] = {
    attemptId: evidenceIdentifier(
      value.publisher.attemptId,
      code,
      "publisher.attemptId"
    ),
    attemptKind: publisherKind
  };
  if (
    publisher.attemptId !== identity.attemptId ||
    publisher.attemptKind !== identity.attemptKind
  ) {
    return recoveryEvidenceError(
      code,
      "A receipt is owned by the attempt that published it."
    );
  }
  const record: Omit<CompletionPublication, "integrityDigest"> = {
    schema: COMPLETION_PUBLICATION_SCHEMA,
    schemaVersion: COMPLETION_RECORD_SCHEMA_VERSION,
    ...identity,
    captureDigest: evidenceDigest(value.captureDigest, code, "captureDigest"),
    candidateDigest: evidenceDigest(
      value.candidateDigest,
      code,
      "candidateDigest"
    ),
    terminalIntegrityDigest: nullableEvidenceDigest(
      value.terminalIntegrityDigest,
      code,
      "terminalIntegrityDigest"
    ),
    authority: {
      baseCommit: evidenceString(
        value.authority.baseCommit,
        code,
        "authority.baseCommit",
        100
      ),
      approvalDigest: evidenceDigest(
        value.authority.approvalDigest,
        code,
        "authority.approvalDigest"
      ),
      planTaskDigest: evidenceDigest(
        value.authority.planTaskDigest,
        code,
        "authority.planTaskDigest"
      ),
      scopeDigest: nullableEvidenceDigest(
        value.authority.scopeDigest,
        code,
        "authority.scopeDigest"
      ),
      workBindingSha256: nullableEvidenceDigest(
        value.authority.workBindingSha256,
        code,
        "authority.workBindingSha256"
      ),
      configurationDigest: evidenceDigest(
        value.authority.configurationDigest,
        code,
        "authority.configurationDigest"
      )
    },
    ledgerAuthor: ledgerSourceIdentity(
      value.ledgerAuthor,
      code,
      "ledgerAuthor"
    ),
    publisher,
    implementationReport: reportIdentity(
      value.implementationReport,
      code,
      "implementationReport"
    ),
    testReport: reportIdentity(value.testReport, code, "testReport"),
    publishedAt: evidenceTimestamp(value.publishedAt, code, "publishedAt")
  };
  return requireIntegrity<CompletionPublication>(
    value,
    record,
    code,
    "Completion publication"
  );
}

/** Closed decoder for the schema-7 run-state publication cursor. */
export function parseCompletionPublicationCursor(
  value: unknown
): CompletionPublicationCursor {
  const code = "INVALID_COMPLETION_CURSOR";
  if (!isRecord(value)) {
    return recoveryEvidenceError(code, "Completion cursor must be an object.");
  }
  exactKeys(
    value,
    [
      "attemptId",
      "attemptKind",
      "stage",
      "captureDigest",
      "candidateDigest",
      "receiptDigest",
      "refusal"
    ],
    code,
    "Completion cursor"
  );
  const attemptKind = value.attemptKind;
  if (attemptKind !== "implementation" && attemptKind !== "fix") {
    return recoveryEvidenceError(code, "attemptKind is unsupported.");
  }
  const stage = value.stage;
  if (
    typeof stage !== "string" ||
    !COMPLETION_PUBLICATION_STAGES.includes(
      stage as (typeof COMPLETION_PUBLICATION_STAGES)[number]
    )
  ) {
    return recoveryEvidenceError(code, "stage is unsupported.");
  }
  let refusal: CompletionPublicationCursor["refusal"] = null;
  if (value.refusal !== null) {
    if (!isRecord(value.refusal)) {
      return recoveryEvidenceError(code, "refusal must be an object or null.");
    }
    exactKeys(value.refusal, ["code", "stage", "proofDigest"], code, "refusal");
    const refusalCode = value.refusal.code;
    const refusalStage = value.refusal.stage;
    if (
      typeof refusalCode !== "string" ||
      !COMPLETION_PUBLICATION_REFUSAL_CODES.includes(
        refusalCode as (typeof COMPLETION_PUBLICATION_REFUSAL_CODES)[number]
      ) ||
      typeof refusalStage !== "string" ||
      !COMPLETION_PUBLICATION_STAGES.includes(
        refusalStage as (typeof COMPLETION_PUBLICATION_STAGES)[number]
      )
    ) {
      return recoveryEvidenceError(code, "refusal is malformed.");
    }
    refusal = {
      code: refusalCode as CompletionPublicationRefusalCode,
      stage: refusalStage as CompletionPublicationStage,
      proofDigest: nullableEvidenceDigest(
        value.refusal.proofDigest,
        code,
        "refusal.proofDigest"
      )
    };
  }
  return {
    attemptId: evidenceIdentifier(value.attemptId, code, "attemptId"),
    attemptKind,
    stage: stage as CompletionPublicationStage,
    captureDigest: nullableEvidenceDigest(
      value.captureDigest,
      code,
      "captureDigest"
    ),
    candidateDigest: nullableEvidenceDigest(
      value.candidateDigest,
      code,
      "candidateDigest"
    ),
    receiptDigest: nullableEvidenceDigest(
      value.receiptDigest,
      code,
      "receiptDigest"
    ),
    refusal
  };
}

/**
 * Closed decoder for the persisted plan-task completion checkpoint. Schema 1
 * keeps its model-projection meaning; schema 2 must carry the protocol and
 * the publisher/receipt identities that runner publication recorded.
 */
export function parsePlanTaskCompletionCheckpoint(
  value: unknown
): PlanTaskCompletionCheckpoint {
  const code = "INVALID_COMPLETION_CHECKPOINT";
  if (!isRecord(value)) {
    return recoveryEvidenceError(
      code,
      "Completion checkpoint must be an object."
    );
  }
  if (value.schemaVersion !== 1 && value.schemaVersion !== 2) {
    return recoveryEvidenceError(
      code,
      "Completion checkpoint schema version is unsupported."
    );
  }
  const published = value.schemaVersion === 2;
  const kind =
    value.sourceAttemptKind === undefined
      ? undefined
      : value.sourceAttemptKind === "implementation" ||
          value.sourceAttemptKind === "fix"
        ? value.sourceAttemptKind
        : recoveryEvidenceError(code, "sourceAttemptKind is unsupported.");
  if (published && kind === undefined) {
    return recoveryEvidenceError(
      code,
      "A published completion checkpoint must name its ledger author kind."
    );
  }
  const sourceAttemptId = evidenceIdentifier(
    value.sourceAttemptId,
    code,
    "sourceAttemptId"
  );
  if (value.status === "invalid") {
    exactKeys(
      value,
      [
        "schemaVersion",
        "status",
        "sourceAttemptId",
        "sourceAttemptKind",
        "errorCode",
        "violation",
        "taskId",
        "recordedAt",
        ...(published
          ? ["completionProtocol", "diagnostic", "rejectedResultDigest"]
          : [])
      ],
      code,
      "Invalid completion checkpoint"
    );
    if (value.errorCode !== "PLAN_TASK_COMPLETION_INVALID") {
      return recoveryEvidenceError(code, "errorCode is unsupported.");
    }
    const diagnostic = parseCompletionDiagnostic(
      {
        violation: value.violation,
        taskId: value.taskId,
        message: published ? value.diagnostic : "retained"
      },
      code
    );
    if (published && value.completionProtocol !== COMPLETION_PROTOCOL) {
      return recoveryEvidenceError(
        code,
        `Published completion checkpoint must carry ${COMPLETION_PROTOCOL}.`
      );
    }
    return {
      schemaVersion: value.schemaVersion,
      status: "invalid",
      sourceAttemptId,
      ...(kind === undefined ? {} : { sourceAttemptKind: kind }),
      errorCode: "PLAN_TASK_COMPLETION_INVALID",
      violation: diagnostic.violation,
      taskId: diagnostic.taskId,
      recordedAt: evidenceTimestamp(value.recordedAt, code, "recordedAt"),
      ...(published
        ? {
            completionProtocol: COMPLETION_PROTOCOL,
            diagnostic: diagnostic.message,
            rejectedResultDigest: nullableEvidenceDigest(
              value.rejectedResultDigest,
              code,
              "rejectedResultDigest"
            )
          }
        : {})
    };
  }
  if (value.status !== "valid") {
    return recoveryEvidenceError(
      code,
      "Completion checkpoint status is unsupported."
    );
  }
  exactKeys(
    value,
    [
      "schemaVersion",
      "status",
      "sourceAttemptId",
      "sourceAttemptKind",
      "approvalDigest",
      "planTaskDigest",
      "ledgerDigest",
      "implementationReport",
      "testReport",
      "counts",
      "validatedAt",
      ...(published
        ? ["completionProtocol", "publisherAttemptId", "publication"]
        : [])
    ],
    code,
    "Valid completion checkpoint"
  );
  if (!isRecord(value.counts)) {
    return recoveryEvidenceError(code, "counts must be an object.");
  }
  exactKeys(
    value.counts,
    ["total", "completed", "incomplete", "blocked"],
    code,
    "counts"
  );
  const count = (item: unknown, label: string): number => {
    if (typeof item !== "number" || !Number.isSafeInteger(item) || item < 0) {
      return recoveryEvidenceError(code, `counts.${label} must be a count.`);
    }
    return item;
  };
  const counts = {
    total: count(value.counts.total, "total"),
    completed: count(value.counts.completed, "completed"),
    incomplete: count(value.counts.incomplete, "incomplete"),
    blocked: count(value.counts.blocked, "blocked")
  };
  if (counts.completed + counts.incomplete + counts.blocked !== counts.total) {
    return recoveryEvidenceError(code, "counts do not sum to total.");
  }
  if (published && value.completionProtocol !== COMPLETION_PROTOCOL) {
    return recoveryEvidenceError(
      code,
      `Published completion checkpoint must carry ${COMPLETION_PROTOCOL}.`
    );
  }
  return {
    schemaVersion: value.schemaVersion,
    status: "valid",
    sourceAttemptId,
    ...(kind === undefined ? {} : { sourceAttemptKind: kind }),
    approvalDigest: evidenceDigest(
      value.approvalDigest,
      code,
      "approvalDigest"
    ),
    planTaskDigest: evidenceDigest(
      value.planTaskDigest,
      code,
      "planTaskDigest"
    ),
    ledgerDigest: evidenceDigest(value.ledgerDigest, code, "ledgerDigest"),
    implementationReport: reportIdentity(
      value.implementationReport,
      code,
      "implementationReport"
    ),
    testReport: reportIdentity(value.testReport, code, "testReport"),
    counts,
    validatedAt: evidenceTimestamp(value.validatedAt, code, "validatedAt"),
    ...(published
      ? {
          completionProtocol: COMPLETION_PROTOCOL,
          publisherAttemptId: evidenceIdentifier(
            value.publisherAttemptId,
            code,
            "publisherAttemptId"
          ),
          publication: reportIdentity(value.publication, code, "publication")
        }
      : {})
  };
}

const COMPLETION_VIOLATIONS: readonly PlanTaskCompletionViolation[] = [
  "approved_plan_invalid",
  "missing_ledger",
  "missing_task",
  "duplicate_task",
  "unknown_task",
  "task_order_mismatch",
  "invalid_task_status",
  "task_status_conflict",
  "invalid_evidence_path",
  "missing_evidence_path",
  "evidence_scope_violation",
  "invalid_gap_reference",
  "implementation_report_missing",
  "test_report_missing",
  "report_projection_missing",
  "report_projection_invalid",
  "report_projection_mismatch",
  "report_region_invalid",
  "approval_invalid",
  "source_attempt_invalid",
  "summary_mismatch"
];

export function parseCompletionDiagnostic(
  value: unknown,
  code = "ATTEMPT_MALFORMED"
): CompletionDiagnostic {
  if (!isRecord(value)) {
    return recoveryEvidenceError(
      code,
      "Completion diagnostic must be an object."
    );
  }
  exactKeys(
    value,
    ["violation", "taskId", "message"],
    code,
    "Completion diagnostic"
  );
  const violation = value.violation;
  if (
    typeof violation !== "string" ||
    !COMPLETION_VIOLATIONS.includes(violation as PlanTaskCompletionViolation)
  ) {
    return recoveryEvidenceError(
      code,
      "Completion diagnostic violation is unsupported."
    );
  }
  return {
    violation: violation as PlanTaskCompletionViolation,
    taskId:
      value.taskId === null
        ? null
        : evidenceString(value.taskId, code, "taskId", 4),
    message: evidenceString(value.message, code, "message")
  };
}

const REPORT_OBSERVATION_STATES = [
  "present",
  "absent",
  "unsafe",
  "unavailable"
] as const;

function parseReportObservation(
  value: unknown,
  code: string,
  label: string
): CompletionReportObservation {
  if (!isRecord(value)) {
    return recoveryEvidenceError(code, `${label} must be an object.`);
  }
  const state = value.state;
  if (
    typeof state !== "string" ||
    !REPORT_OBSERVATION_STATES.includes(
      state as (typeof REPORT_OBSERVATION_STATES)[number]
    )
  ) {
    return recoveryEvidenceError(code, `${label}.state is unsupported.`);
  }
  if (state === "present") {
    exactKeys(value, ["path", "state", "sha256", "bytes"], code, label);
    if (
      typeof value.bytes !== "number" ||
      !Number.isSafeInteger(value.bytes) ||
      value.bytes < 0
    ) {
      return recoveryEvidenceError(
        code,
        `${label}.bytes must be a non-negative integer.`
      );
    }
    return {
      path: evidenceString(value.path, code, `${label}.path`),
      state: "present",
      sha256: evidenceDigest(value.sha256, code, `${label}.sha256`),
      bytes: value.bytes
    };
  }
  exactKeys(value, ["path", "state"], code, label);
  return {
    path: evidenceNullableString(value.path, code, `${label}.path`),
    state: state as "absent" | "unsafe" | "unavailable"
  };
}

function parseObservedInputs(
  value: unknown,
  code: string,
  label: string
): CompletionObservedInputs {
  if (!isRecord(value)) {
    return recoveryEvidenceError(code, `${label} must be an object.`);
  }
  exactKeys(
    value,
    ["implementationReport", "testReport", "workspaceDigest"],
    code,
    label
  );
  return {
    implementationReport: parseReportObservation(
      value.implementationReport,
      code,
      `${label}.implementationReport`
    ),
    testReport: parseReportObservation(
      value.testReport,
      code,
      `${label}.testReport`
    ),
    workspaceDigest:
      value.workspaceDigest === null
        ? null
        : evidenceDigest(
            value.workspaceDigest,
            code,
            `${label}.workspaceDigest`
          )
  };
}

function parseCheckpointConfiguration(
  value: unknown,
  code: string
): TerminalAttemptCheckpoint["configuration"] {
  if (!isRecord(value)) {
    return recoveryEvidenceError(code, "configuration must be an object.");
  }
  exactKeys(
    value,
    [
      "vendor",
      "executableDigest",
      "model",
      "effort",
      "sessionMode",
      "sessionContextDigest"
    ],
    code,
    "configuration"
  );
  const vendor = value.vendor;
  if (vendor !== "codex" && vendor !== "claude") {
    return recoveryEvidenceError(code, "configuration.vendor is unsupported.");
  }
  const effort = value.effort;
  if (
    typeof effort !== "string" ||
    !["low", "medium", "high", "xhigh", "max", "ultra"].includes(effort)
  ) {
    return recoveryEvidenceError(code, "configuration.effort is unsupported.");
  }
  const sessionMode = value.sessionMode;
  if (sessionMode !== "fresh" && sessionMode !== "resumed") {
    return recoveryEvidenceError(
      code,
      "configuration.sessionMode is unsupported."
    );
  }
  return {
    vendor,
    executableDigest: evidenceDigest(
      value.executableDigest,
      code,
      "configuration.executableDigest"
    ),
    model: evidenceString(value.model, code, "configuration.model"),
    effort: effort as ModelSettings["effort"],
    sessionMode,
    sessionContextDigest: evidenceDigest(
      value.sessionContextDigest,
      code,
      "configuration.sessionContextDigest"
    )
  };
}

function parseCheckpointTerminal(
  value: unknown,
  vendor: "codex" | "claude",
  code: string
): TerminalAttemptCheckpoint["terminal"] {
  if (!isRecord(value)) {
    return recoveryEvidenceError(code, "terminal must be an object.");
  }
  exactKeys(value, ["classification", "observedAt"], code, "terminal");
  const classification = value.classification;
  if (
    classification !== "claude_result" &&
    classification !== "codex_turn_completed"
  ) {
    return recoveryEvidenceError(
      code,
      "terminal.classification is unsupported."
    );
  }
  if (
    (vendor === "claude" && classification !== "claude_result") ||
    (vendor === "codex" && classification !== "codex_turn_completed")
  ) {
    return recoveryEvidenceError(
      code,
      "Terminal classification does not match the configured vendor."
    );
  }
  return {
    classification,
    observedAt: evidenceTimestamp(value.observedAt, code, "terminal.observedAt")
  };
}

function nullableEvidenceDigest(
  value: unknown,
  code: string,
  label: string
): string | null {
  return value === null ? null : evidenceDigest(value, code, label);
}

/** Terminal proof under the completion protocol (ADR-0047): v2 checkpoint. */
export function parseTerminalAttemptCheckpointV2(
  value: unknown
): TerminalAttemptCheckpointV2 {
  const code = "INVALID_TERMINAL_CHECKPOINT";
  if (!isRecord(value)) {
    return recoveryEvidenceError(
      code,
      "Terminal checkpoint must be an object."
    );
  }
  exactKeys(
    value,
    [
      "schema",
      "schemaVersion",
      "completionProtocol",
      "runId",
      "attempt",
      "phase",
      "configuration",
      "resultContract",
      "terminal",
      "envelope",
      "resultDigest",
      "observed",
      "sessionId",
      "usage",
      "baseCommit",
      "approvalDigest",
      "workflowDigest",
      "scopeDigest",
      "integrityDigest"
    ],
    code,
    "Terminal checkpoint"
  );
  if (
    !(
      (value.schema === TERMINAL_CHECKPOINT_SCHEMA_V2 &&
        value.schemaVersion === 2) ||
      (value.schema === "banzai-terminal-attempt-checkpoint/v3" &&
        value.schemaVersion === 3)
    ) ||
    value.completionProtocol !== COMPLETION_PROTOCOL
  ) {
    return recoveryEvidenceError(
      code,
      `Terminal checkpoint must use ${TERMINAL_CHECKPOINT_SCHEMA_V2} under ${COMPLETION_PROTOCOL}.`
    );
  }
  const attempt = parseEvidenceAttempt(value.attempt, code, "attempt");
  if (
    (attempt.kind !== "implementation" && attempt.kind !== "fix") ||
    !attempt.mutable ||
    value.phase !== attempt.kind
  ) {
    return recoveryEvidenceError(
      code,
      "Protocol checkpoint requires a mutable implementation or fix attempt."
    );
  }
  if (
    value.resultContract !==
    (value.schemaVersion === 3 ? "phase-result/v4" : "phase-result/v3")
  ) {
    return recoveryEvidenceError(
      code,
      "Checkpoint result contract must be phase-result/v3."
    );
  }
  const configuration = parseCheckpointConfiguration(value.configuration, code);
  const envelope = parseStoredPhaseResultEnvelope(value.envelope, code);
  if (envelope.phase !== attempt.kind) {
    return recoveryEvidenceError(
      code,
      "Checkpoint envelope phase must match attempt kind."
    );
  }
  const resultDigest = evidenceDigest(value.resultDigest, code, "resultDigest");
  if (resultDigest !== envelope.originalDigest) {
    return recoveryEvidenceError(
      code,
      "Checkpoint result digest conflicts with its envelope original."
    );
  }
  const checkpointWithoutIntegrity: Omit<
    TerminalAttemptCheckpointV2,
    "integrityDigest"
  > = {
    schema:
      value.schemaVersion === 3
        ? "banzai-terminal-attempt-checkpoint/v3"
        : TERMINAL_CHECKPOINT_SCHEMA_V2,
    schemaVersion:
      value.schemaVersion === 3 ? 3 : TERMINAL_CHECKPOINT_SCHEMA_VERSION_V2,
    completionProtocol: COMPLETION_PROTOCOL,
    runId: evidenceString(value.runId, code, "runId", 300),
    attempt: {
      id: attempt.id,
      kind: attempt.kind,
      mutable: true
    },
    phase: attempt.kind,
    configuration,
    resultContract:
      value.schemaVersion === 3 ? "phase-result/v4" : "phase-result/v3",
    terminal: parseCheckpointTerminal(
      value.terminal,
      configuration.vendor,
      code
    ),
    envelope,
    resultDigest,
    observed: parseObservedInputs(value.observed, code, "observed"),
    sessionId: evidenceNullableString(value.sessionId, code, "sessionId", 300),
    usage: parseEvidenceUsage(value.usage, code, "usage"),
    baseCommit: evidenceString(value.baseCommit, code, "baseCommit", 100),
    approvalDigest: nullableEvidenceDigest(
      value.approvalDigest,
      code,
      "approvalDigest"
    ),
    workflowDigest: nullableEvidenceDigest(
      value.workflowDigest,
      code,
      "workflowDigest"
    ),
    scopeDigest: nullableEvidenceDigest(value.scopeDigest, code, "scopeDigest")
  };
  const integrityDigest = evidenceDigest(
    value.integrityDigest,
    code,
    "integrityDigest"
  );
  if (
    integrityDigest !== terminalCheckpointIntegrity(checkpointWithoutIntegrity)
  ) {
    return recoveryEvidenceError(
      code,
      "Terminal checkpoint integrity mismatch."
    );
  }
  return { ...checkpointWithoutIntegrity, integrityDigest };
}

export function parseTerminalAttemptCheckpoint(
  value: unknown
): PersistedTerminalCheckpoint {
  const code = "INVALID_TERMINAL_CHECKPOINT";
  if (!isRecord(value)) {
    return recoveryEvidenceError(
      code,
      "Terminal checkpoint must be an object."
    );
  }
  // Route by persisted identity, never by report appearance or CLI version.
  if (
    value.schema === TERMINAL_CHECKPOINT_SCHEMA_V2 ||
    (value.schema === "banzai-terminal-attempt-checkpoint/v3" &&
      "completionProtocol" in value)
  ) {
    return parseTerminalAttemptCheckpointV2(value);
  }
  exactKeys(
    value,
    [
      "schema",
      "schemaVersion",
      "runId",
      "attempt",
      "phase",
      "configuration",
      "resultContract",
      "terminal",
      "result",
      "sessionId",
      "usage",
      "baseCommit",
      "approvalDigest",
      "workflowDigest",
      "scopeDigest",
      "integrityDigest"
    ],
    code,
    "Terminal checkpoint"
  );
  if (!(
    (value.schema === TERMINAL_CHECKPOINT_SCHEMA &&
      value.schemaVersion === 1) ||
    (value.schema === "banzai-terminal-attempt-checkpoint/v3" &&
      value.schemaVersion === 3)
  )) {
    return recoveryEvidenceError(
      code,
      `Terminal checkpoint must use ${TERMINAL_CHECKPOINT_SCHEMA}.`
    );
  }
  const attempt = parseEvidenceAttempt(value.attempt, code, "attempt");
  if (value.phase !== attempt.kind) {
    return recoveryEvidenceError(
      code,
      "Checkpoint phase must match attempt kind."
    );
  }
  if (!isRecord(value.configuration)) {
    return recoveryEvidenceError(code, "configuration must be an object.");
  }
  exactKeys(
    value.configuration,
    [
      "vendor",
      "executableDigest",
      "model",
      "effort",
      "sessionMode",
      "sessionContextDigest"
    ],
    code,
    "configuration"
  );
  const vendor = value.configuration.vendor;
  if (vendor !== "codex" && vendor !== "claude") {
    return recoveryEvidenceError(code, "configuration.vendor is unsupported.");
  }
  const effort = value.configuration.effort;
  if (
    typeof effort !== "string" ||
    !["low", "medium", "high", "xhigh", "max", "ultra"].includes(effort)
  ) {
    return recoveryEvidenceError(code, "configuration.effort is unsupported.");
  }
  const sessionMode = value.configuration.sessionMode;
  if (sessionMode !== "fresh" && sessionMode !== "resumed") {
    return recoveryEvidenceError(
      code,
      "configuration.sessionMode is unsupported."
    );
  }
  const resultContract = value.resultContract;
  const expectedContract: TerminalResultContract =
    attempt.kind === "selection"
      ? "workflow-selection/v1"
      : attempt.kind === "review"
        ? resultContract === "review-result/v2"
          ? "review-result/v2"
          : "review-result/v1"
        : value.schemaVersion === 3
          ? "phase-result/v4"
          : resultContract === "phase-result/v2"
            ? "phase-result/v2"
            : "phase-result/v3";
  if (
    resultContract !== expectedContract ||
    (attempt.kind !== "selection" &&
      attempt.kind !== "review" &&
      resultContract !== "phase-result/v2" &&
      resultContract !== "phase-result/v3" &&
      resultContract !== "phase-result/v4")
  ) {
    return recoveryEvidenceError(
      code,
      `Checkpoint result contract must be ${expectedContract}.`
    );
  }
  if (!isRecord(value.terminal)) {
    return recoveryEvidenceError(code, "terminal must be an object.");
  }
  exactKeys(value.terminal, ["classification", "observedAt"], code, "terminal");
  const classification = value.terminal.classification;
  if (
    classification !== "claude_result" &&
    classification !== "codex_turn_completed"
  ) {
    return recoveryEvidenceError(
      code,
      "terminal.classification is unsupported."
    );
  }
  if (
    (vendor === "claude" && classification !== "claude_result") ||
    (vendor === "codex" && classification !== "codex_turn_completed")
  ) {
    return recoveryEvidenceError(
      code,
      "Terminal classification does not match the configured vendor."
    );
  }
  const checkpointWithoutIntegrity: Omit<
    TerminalAttemptCheckpoint,
    "integrityDigest"
  > = {
    schema:
      value.schemaVersion === 3
        ? "banzai-terminal-attempt-checkpoint/v3"
        : TERMINAL_CHECKPOINT_SCHEMA,
    schemaVersion:
      value.schemaVersion === 3 ? 3 : TERMINAL_CHECKPOINT_SCHEMA_VERSION,
    runId: evidenceString(value.runId, code, "runId", 300),
    attempt,
    phase: attempt.kind,
    configuration: {
      vendor,
      executableDigest: evidenceDigest(
        value.configuration.executableDigest,
        code,
        "configuration.executableDigest"
      ),
      model: evidenceString(
        value.configuration.model,
        code,
        "configuration.model"
      ),
      effort: effort as ModelSettings["effort"],
      sessionMode,
      sessionContextDigest: evidenceDigest(
        value.configuration.sessionContextDigest,
        code,
        "configuration.sessionContextDigest"
      )
    },
    resultContract: expectedContract,
    terminal: {
      classification,
      observedAt: evidenceTimestamp(
        value.terminal.observedAt,
        code,
        "terminal.observedAt"
      )
    },
    result: parseCheckpointResult(attempt.kind, value.result, expectedContract),
    sessionId: evidenceNullableString(value.sessionId, code, "sessionId", 300),
    usage: parseEvidenceUsage(value.usage, code, "usage"),
    baseCommit: evidenceString(value.baseCommit, code, "baseCommit", 100),
    approvalDigest: evidenceNullableString(
      value.approvalDigest,
      code,
      "approvalDigest",
      64
    ),
    workflowDigest: evidenceNullableString(
      value.workflowDigest,
      code,
      "workflowDigest",
      64
    ),
    scopeDigest: evidenceNullableString(
      value.scopeDigest,
      code,
      "scopeDigest",
      64
    )
  };
  for (const [label, digest] of [
    ["approvalDigest", checkpointWithoutIntegrity.approvalDigest],
    ["workflowDigest", checkpointWithoutIntegrity.workflowDigest],
    ["scopeDigest", checkpointWithoutIntegrity.scopeDigest]
  ] as const) {
    if (digest !== null && !/^[a-f0-9]{64}$/u.test(digest)) {
      return recoveryEvidenceError(code, `${label} must be a SHA-256 digest.`);
    }
  }
  const integrityDigest = evidenceDigest(
    value.integrityDigest,
    code,
    "integrityDigest"
  );
  if (
    integrityDigest !== terminalCheckpointIntegrity(checkpointWithoutIntegrity)
  ) {
    return recoveryEvidenceError(
      code,
      "Terminal checkpoint integrity mismatch."
    );
  }
  return { ...checkpointWithoutIntegrity, integrityDigest };
}

export function parseRecoveryAuthorization(
  value: unknown
): RecoveryAuthorization {
  const code = "INVALID_RECOVERY_AUTHORIZATION";
  if (!isRecord(value)) {
    return recoveryEvidenceError(
      code,
      "Recovery authorization must be an object."
    );
  }
  exactKeys(
    value,
    [
      "schema",
      "schemaVersion",
      "authorizationId",
      "runId",
      "attempt",
      "phase",
      "recoveryIdentity",
      "workspaceDigest",
      "baseCommit",
      "approvalDigest",
      "workflowDigest",
      "scopeDigest",
      "configurationDigest",
      "decidedBy",
      "decidedAt",
      "unknownSideEffectsAccepted"
    ],
    code,
    "Recovery authorization"
  );
  if (
    value.schema !== RECOVERY_AUTHORIZATION_SCHEMA ||
    value.schemaVersion !== RECOVERY_AUTHORIZATION_SCHEMA_VERSION
  ) {
    return recoveryEvidenceError(
      code,
      `Recovery authorization must use ${RECOVERY_AUTHORIZATION_SCHEMA}.`
    );
  }
  const attempt = parseEvidenceAttempt(value.attempt, code, "attempt");
  // ADR-0051 adds the digest-rejected planning source. The accepted value set
  // grew; an authorization written before it still holds implementation or fix
  // and parses unchanged.
  if (
    (attempt.kind !== "implementation" &&
      attempt.kind !== "fix" &&
      attempt.kind !== "plan") ||
    attempt.mutable !== (attempt.kind !== "plan")
  ) {
    return recoveryEvidenceError(
      code,
      "Recovery authorization requires a read-only plan attempt or a mutable implementation or fix attempt."
    );
  }
  const phase = value.phase;
  if (phase !== attempt.kind) {
    return recoveryEvidenceError(
      code,
      "Recovery phase must match attempt kind."
    );
  }
  if (value.unknownSideEffectsAccepted !== true) {
    return recoveryEvidenceError(
      code,
      "Recovery requires unknownSideEffectsAccepted=true."
    );
  }
  const nullableDigest = (item: unknown, label: string): string | null => {
    if (item === null) {
      return null;
    }
    return evidenceDigest(item, code, label);
  };
  return {
    schema: RECOVERY_AUTHORIZATION_SCHEMA,
    schemaVersion: RECOVERY_AUTHORIZATION_SCHEMA_VERSION,
    authorizationId: evidenceIdentifier(
      value.authorizationId,
      code,
      "authorizationId",
      200
    ),
    runId: evidenceIdentifier(value.runId, code, "runId", 300),
    attempt: attempt as RecoveryAuthorization["attempt"],
    phase: attempt.kind,
    recoveryIdentity: evidenceDigest(
      value.recoveryIdentity,
      code,
      "recoveryIdentity"
    ),
    workspaceDigest: evidenceDigest(
      value.workspaceDigest,
      code,
      "workspaceDigest"
    ),
    baseCommit: evidenceString(value.baseCommit, code, "baseCommit", 100),
    approvalDigest: nullableDigest(value.approvalDigest, "approvalDigest"),
    workflowDigest: nullableDigest(value.workflowDigest, "workflowDigest"),
    scopeDigest: nullableDigest(value.scopeDigest, "scopeDigest"),
    configurationDigest: evidenceDigest(
      value.configurationDigest,
      code,
      "configurationDigest"
    ),
    decidedBy: evidenceString(value.decidedBy, code, "decidedBy", 200),
    decidedAt: evidenceTimestamp(value.decidedAt, code, "decidedAt"),
    unknownSideEffectsAccepted: true
  };
}

export function parseModelAttemptRecord<T>(value: unknown): AttemptRecord<T> {
  const code = "ATTEMPT_MALFORMED";
  if (!isRecord(value)) {
    return recoveryEvidenceError(code, "Attempt record must be an object.");
  }
  exactKeys(
    value,
    [
      "schemaVersion",
      "attempt",
      "status",
      "startedAt",
      "completedAt",
      "interruptedAt",
      "recoveryOf",
      "recoveryAuthorizationId",
      "result",
      "sessionId",
      "rawStdoutPath",
      "rawStderrPath",
      "durationMs",
      "usage",
      "error",
      "failureCode",
      "failureCause",
      "reviewCandidate",
      "sessionMode",
      "reviewMode",
      "rotationReason",
      "resumeSessionId",
      "sessionContext",
      "planningContext",
      "reviewContext",
      "reviewDiagnostics",
      "completionProtocol",
      "retryOf",
      "envelope",
      "completionDiagnostic"
    ],
    code,
    "Attempt record"
  );
  if (
    value.schemaVersion !== 1 &&
    value.schemaVersion !== MODEL_ATTEMPT_SCHEMA_VERSION &&
    value.schemaVersion !== STRICT_MODEL_ATTEMPT_SCHEMA_VERSION &&
    value.schemaVersion !== 4
  ) {
    return recoveryEvidenceError(
      code,
      "Attempt schema version is unsupported."
    );
  }
  const attempt = parseEvidenceAttempt(value.attempt, code, "attempt");
  const strict =
    value.schemaVersion === STRICT_MODEL_ATTEMPT_SCHEMA_VERSION ||
    (value.schemaVersion === 4 && value.completionProtocol !== undefined);
  if (strict) {
    // The protocol is persisted before invocation and selects every later
    // reader. A missing marker on a v3 record is malformed evidence, never a
    // legacy fallback; an absent marker on v1/v2 keeps its legacy meaning.
    if (
      (attempt.kind !== "implementation" && attempt.kind !== "fix") ||
      !attempt.mutable ||
      value.completionProtocol !== COMPLETION_PROTOCOL ||
      !Object.hasOwn(value, "retryOf") ||
      !Object.hasOwn(value, "envelope") ||
      !Object.hasOwn(value, "completionDiagnostic")
    ) {
      return recoveryEvidenceError(
        code,
        `Attempt schema v3 requires a mutable implementation or fix attempt under ${COMPLETION_PROTOCOL} with retryOf, envelope and completionDiagnostic fields.`
      );
    }
    if (value.retryOf !== null) {
      evidenceIdentifier(value.retryOf, code, "retryOf", 200);
      if (value.retryOf === attempt.id)
        return recoveryEvidenceError(
          code,
          "An evidence-repair retry cannot reference itself."
        );
    }
    if (value.envelope !== null) {
      const envelope = parseStoredPhaseResultEnvelope(value.envelope, code);
      if (envelope.phase !== attempt.kind)
        return recoveryEvidenceError(
          code,
          "Attempt envelope phase must match attempt kind."
        );
      // The raw result and its envelope are one identity: neither can be
      // edited apart from the other without failing this reader.
      if (
        value.result !== null &&
        stableJson(value.result) !==
          stableJson(JSON.parse(envelope.original) as unknown)
      )
        return recoveryEvidenceError(
          code,
          "Attempt result conflicts with its retained envelope original."
        );
    } else if (value.result !== null) {
      return recoveryEvidenceError(
        code,
        "A protocol attempt result requires its decoded envelope."
      );
    }
    if (value.completionDiagnostic !== null)
      parseCompletionDiagnostic(value.completionDiagnostic, code);
  } else if (
    "completionProtocol" in value ||
    "retryOf" in value ||
    "envelope" in value ||
    "completionDiagnostic" in value
  ) {
    return recoveryEvidenceError(
      code,
      "Legacy attempt records cannot carry completion protocol fields."
    );
  }
  if (
    value.rotationReason != null &&
    (typeof value.rotationReason !== "string" ||
      ![
        "primary-review",
        "missing-session",
        "legacy-state",
        "settings-changed",
        "approval-changed",
        "previous-review-failed",
        "previous-review-interrupted",
        "previous-review-blocked",
        "accepted-high-risk-finding",
        "delta-limit-reached",
        "session-inventory-changed",
        "unreliable-review",
        "output-contract-not-reusable"
      ].includes(value.rotationReason))
  )
    return recoveryEvidenceError(
      code,
      "Unsupported runtime review rotation reason."
    );
  if (value.reviewDiagnostics !== undefined) {
    if (attempt.kind !== "review" || !Array.isArray(value.reviewDiagnostics))
      return recoveryEvidenceError(
        code,
        "Review diagnostics must belong to a review attempt."
      );
    for (const item of value.reviewDiagnostics) {
      if (
        !isRecord(item) ||
        typeof item.stage !== "string" ||
        !["render_validation", "publication_application", "recovery"].includes(
          item.stage
        ) ||
        typeof item.code !== "string" ||
        item.code.length === 0 ||
        typeof item.message !== "string"
      )
        return recoveryEvidenceError(code, "Review diagnostic is malformed.");
      exactKeys(item, ["stage", "code", "message"], code, "Review diagnostic");
    }
  }
  if (value.reviewContext !== undefined) {
    const context = value.reviewContext;
    if (
      attempt.kind !== "review" ||
      attempt.mutable ||
      !isRecord(context) ||
      context.outputContract !== "review-result/v2"
    )
      return recoveryEvidenceError(
        code,
        "Review context requires a current immutable review attempt."
      );
    exactKeys(
      context,
      ["outputContract", "snapshotDigest"],
      code,
      "Review context"
    );
    evidenceDigest(
      context.snapshotDigest,
      code,
      "reviewContext.snapshotDigest"
    );
  }
  if (value.planningContext !== undefined) {
    const context = value.planningContext;
    if (attempt.kind !== "plan" || attempt.mutable || !isRecord(context)) {
      return recoveryEvidenceError(
        code,
        "Planning context requires a non-mutable plan attempt."
      );
    }
    exactKeys(
      context,
      ["invocationDigest", "workspaceDigest", "artifactPaths", "retryOf"],
      code,
      "Planning context"
    );
    evidenceDigest(
      context.invocationDigest,
      code,
      "planningContext.invocationDigest"
    );
    if (context.workspaceDigest !== null)
      evidenceDigest(
        context.workspaceDigest,
        code,
        "planningContext.workspaceDigest"
      );
    if (context.retryOf !== null) {
      evidenceIdentifier(context.retryOf, code, "planningContext.retryOf");
      if (context.retryOf === attempt.id)
        return recoveryEvidenceError(
          code,
          "A planning retry cannot reference itself."
        );
    }
    if (value.sessionId !== null)
      evidenceIdentifier(value.sessionId, code, "sessionId", 300);
    if (
      !Array.isArray(context.artifactPaths) ||
      context.artifactPaths.length > 128
    ) {
      return recoveryEvidenceError(
        code,
        "Planning artifact paths must be a bounded array."
      );
    }
    for (const item of context.artifactPaths) {
      const candidate = evidenceString(
        item,
        code,
        "planning artifact path",
        300
      );
      if (
        (candidate !== "PROJECT_MANIFEST.md" &&
          !candidate.startsWith("documentation/") &&
          !/^\.banzai\/work\/[0-9a-f-]{36}\/(?:description|plan)\.md$/.test(
            candidate
          )) ||
        candidate.includes("\\") ||
        candidate
          .split("/")
          .some((part) => part === "" || part === "." || part === "..")
      ) {
        return recoveryEvidenceError(
          code,
          "Planning artifact paths must stay within the planning scope."
        );
      }
    }
  }
  const status = value.status;
  if (
    typeof status !== "string" ||
    ![
      "started",
      "completed",
      "failed",
      "interrupted",
      "pending_application"
    ].includes(status) ||
    (value.schemaVersion === 1 && status === "interrupted") ||
    (!strict && status === "pending_application")
  ) {
    return recoveryEvidenceError(code, "Attempt status is unsupported.");
  }
  if (
    status === "pending_application" &&
    (value.result === null || value.envelope === null)
  ) {
    return recoveryEvidenceError(
      code,
      "A pending_application attempt must retain its captured result and envelope."
    );
  }
  evidenceTimestamp(value.startedAt, code, "startedAt");
  if (
    value.schemaVersion === MODEL_ATTEMPT_SCHEMA_VERSION ||
    value.schemaVersion === STRICT_MODEL_ATTEMPT_SCHEMA_VERSION ||
    value.schemaVersion === 4
  ) {
    if (
      !Object.hasOwn(value, "interruptedAt") ||
      !Object.hasOwn(value, "recoveryOf") ||
      !Object.hasOwn(value, "recoveryAuthorizationId")
    ) {
      return recoveryEvidenceError(
        code,
        "Attempt schema v2 requires interruption and recovery linkage fields."
      );
    }
    if (status === "interrupted") {
      evidenceTimestamp(value.interruptedAt, code, "interruptedAt");
      if (value.completedAt !== null || value.durationMs !== null) {
        return recoveryEvidenceError(
          code,
          "Interrupted attempts cannot claim completion time or duration."
        );
      }
    } else if (value.interruptedAt !== null) {
      return recoveryEvidenceError(
        code,
        "Only interrupted attempts may have interruptedAt."
      );
    }
    if (value.recoveryOf !== null) {
      evidenceIdentifier(value.recoveryOf, code, "recoveryOf", 200);
    }
    if (value.recoveryAuthorizationId !== null) {
      evidenceIdentifier(
        value.recoveryAuthorizationId,
        code,
        "recoveryAuthorizationId",
        200
      );
    }
    if (
      (value.recoveryOf === null) !==
      (value.recoveryAuthorizationId === null)
    ) {
      return recoveryEvidenceError(
        code,
        "Recovery linkage fields must both be present or both be null."
      );
    }
  }
  return value as unknown as AttemptRecord<T>;
}

function parseModelSettings(value: unknown, label: string): ModelSettings {
  const record = requireRecord(value, label);
  return {
    executable: requireString(record.executable, `${label}.executable`),
    model: requireString(record.model, `${label}.model`),
    effort: requireEnum(record.effort, `${label}.effort`, [
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
      "ultra"
    ] as const),
    timeoutMs: requirePositiveInteger(record.timeoutMs, `${label}.timeoutMs`)
  };
}

function parseVerificationCommand(
  value: unknown,
  label: string
): VerificationCommand {
  const record = requireRecord(value, label);
  if (
    !Array.isArray(record.args) ||
    record.args.some((item) => typeof item !== "string")
  ) {
    throw new BanzaiError(
      "INVALID_CONFIG",
      `${label}.args must be an array of strings.`
    );
  }
  return {
    name: requireString(record.name, `${label}.name`),
    command: requireString(record.command, `${label}.command`),
    args: [...(record.args as string[])],
    timeoutMs: requirePositiveInteger(record.timeoutMs, `${label}.timeoutMs`)
  };
}

const VERIFICATION_PROJECT_TYPES = [
  "repository",
  "node",
  "php",
  "python",
  "go",
  "rust",
  "ruby",
  "jvm",
  "dotnet",
  "custom"
] as const satisfies readonly VerificationProjectType[];

function parseVerificationProfile(
  value: unknown,
  index: number
): VerificationProfile {
  const label = `verification.profiles[${index}]`;
  const record = requireRecord(value, label);
  const id = requireString(record.id, `${label}.id`);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
    throw new BanzaiError(
      "INVALID_CONFIG",
      `${label}.id must be a kebab-case identifier.`
    );
  }
  if (!Array.isArray(record.commands) || record.commands.length === 0) {
    throw new BanzaiError(
      "INVALID_CONFIG",
      `${label}.commands must contain at least one deterministic verification command.`
    );
  }
  return {
    id,
    projectType: requireEnum(
      record.projectType,
      `${label}.projectType`,
      VERIFICATION_PROJECT_TYPES
    ),
    commands: record.commands.map((command, commandIndex) =>
      parseVerificationCommand(command, `${label}.commands[${commandIndex}]`)
    )
  };
}

export function parseConfig(value: unknown): OrchestratorConfig {
  const record = requireRecord(value, "config");
  if (record.contractVersion !== CONTRACT_VERSION) {
    throw new BanzaiError(
      "INVALID_CONFIG",
      `Config must use contractVersion ${CONTRACT_VERSION}.`
    );
  }
  const models = requireRecord(record.models, "models");
  let verification: OrchestratorConfig["verification"];
  if (record.schemaVersion === 1) {
    if (
      !Array.isArray(record.verification) ||
      record.verification.length === 0
    ) {
      throw new BanzaiError(
        "INVALID_CONFIG",
        "Config must declare at least one deterministic verification command."
      );
    }
    verification = {
      profiles: [
        {
          id: "legacy",
          projectType: "custom",
          commands: record.verification.map((command, index) =>
            parseVerificationCommand(command, `verification[${index}]`)
          )
        }
      ]
    };
  } else if (record.schemaVersion === 4) {
    const task =
      record.verification === undefined
        ? {}
        : requireRecord(record.verification, "verification");
    if (Object.keys(task).some((key) => key !== "policy"))
      throw new BanzaiError(
        "INVALID_CONFIG",
        "Schema 4 verification accepts only optional project policy."
      );
    verification = {
      profiles: [],
      ...(task.policy === undefined
        ? {}
        : { taskPolicy: parseTaskVerificationPolicy(task.policy) })
    };
  } else if (record.schemaVersion === 3) {
    try {
      verification = parseVerificationConfiguration(record.verification);
    } catch {
      throw new BanzaiError(
        "INVALID_CONFIG",
        "Invalid schema 3 verification configuration."
      );
    }
  } else if (record.schemaVersion === 2) {
    const verificationRecord = requireRecord(
      record.verification,
      "verification"
    );
    if (
      !Array.isArray(verificationRecord.profiles) ||
      verificationRecord.profiles.length === 0
    ) {
      throw new BanzaiError(
        "INVALID_CONFIG",
        "verification.profiles must contain at least one profile."
      );
    }
    const profiles = verificationRecord.profiles.map(parseVerificationProfile);
    if (
      new Set(profiles.map((profile) => profile.id)).size !== profiles.length
    ) {
      throw new BanzaiError(
        "INVALID_CONFIG",
        "Verification profile ids must be unique."
      );
    }
    if (
      verificationRecord.bootstrap !== undefined &&
      typeof verificationRecord.bootstrap !== "boolean"
    ) {
      throw new BanzaiError(
        "INVALID_CONFIG",
        "verification.bootstrap must be a boolean."
      );
    }
    verification = {
      profiles,
      ...(verificationRecord.bootstrap === undefined
        ? {}
        : { bootstrap: verificationRecord.bootstrap })
    };
  } else {
    throw new BanzaiError(
      "INVALID_CONFIG",
      "Config must use schemaVersion 1, 2, 3 or 4."
    );
  }

  return {
    schemaVersion: record.schemaVersion,
    contractVersion: CONTRACT_VERSION,
    models: {
      planner: parseModelSettings(models.planner, "models.planner"),
      implementer: parseModelSettings(models.implementer, "models.implementer"),
      reviewer: parseModelSettings(models.reviewer, "models.reviewer")
    },
    verification,
    claudeEnvironment: parseClaudeEnvironment(record.claudeEnvironment),
    context: parseContextPolicy(record.context),
    maxFixCycles: requirePositiveInteger(record.maxFixCycles, "maxFixCycles")
  };
}

const CONTEXT_METRICS = [
  "runner_payload_bytes",
  "vendor_input_tokens",
  "vendor_cached_input_tokens",
  "vendor_output_tokens",
  "vendor_cost_usd",
  "vendor_turns",
  "session_tools",
  "session_mcp_servers",
  "session_skills",
  "session_commands"
] as const satisfies readonly ContextMetric[];

function parseContextPolicy(value: unknown): ContextPolicy {
  if (value === undefined || value === null) {
    return { mode: "observe", limits: [] };
  }
  if (!isRecord(value)) {
    throw new BanzaiError("INVALID_CONFIG", "context must be an object.");
  }
  if (Object.keys(value).some((key) => !["mode", "limits"].includes(key))) {
    throw new BanzaiError(
      "INVALID_CONFIG",
      "context contains unsupported fields."
    );
  }
  const mode = value.mode;
  if (mode !== "observe" && mode !== "enforce") {
    throw new BanzaiError(
      "INVALID_CONFIG",
      'context.mode must be "observe" or "enforce".'
    );
  }
  const sourceLimits = value.limits ?? [];
  if (!Array.isArray(sourceLimits)) {
    throw new BanzaiError("INVALID_CONFIG", "context.limits must be an array.");
  }
  const seen = new Set<string>();
  const limits: ContextLimit[] = sourceLimits.map((item, index) => {
    const label = `context.limits[${index}]`;
    if (!isRecord(item)) {
      throw new BanzaiError("INVALID_CONFIG", `${label} must be an object.`);
    }
    if (
      Object.keys(item).some(
        (key) => !["metric", "phase", "role", "maximum"].includes(key)
      )
    ) {
      throw new BanzaiError(
        "INVALID_CONFIG",
        `${label} contains unsupported fields.`
      );
    }
    const metric = item.metric;
    if (
      typeof metric !== "string" ||
      !CONTEXT_METRICS.includes(metric as ContextMetric)
    ) {
      throw new BanzaiError(
        "INVALID_CONFIG",
        `${label}.metric is unsupported.`
      );
    }
    const phase = item.phase ?? null;
    if (
      phase !== null &&
      (typeof phase !== "string" ||
        !["selection", "plan", "implementation", "fix", "review"].includes(
          phase
        ))
    ) {
      throw new BanzaiError("INVALID_CONFIG", `${label}.phase is unsupported.`);
    }
    const role = item.role ?? null;
    if (
      role !== null &&
      (typeof role !== "string" ||
        !["planner", "implementer", "reviewer"].includes(role))
    ) {
      throw new BanzaiError("INVALID_CONFIG", `${label}.role is unsupported.`);
    }
    const maximum = item.maximum;
    const integerMetric = metric !== "vendor_cost_usd";
    if (
      typeof maximum !== "number" ||
      !Number.isFinite(maximum) ||
      maximum <= 0 ||
      (integerMetric && !Number.isInteger(maximum))
    ) {
      throw new BanzaiError(
        "INVALID_CONFIG",
        `${label}.maximum must be a positive${integerMetric ? " integer" : " finite number"}.`
      );
    }
    const duplicateKey = `${metric}\u0000${phase ?? ""}\u0000${role ?? ""}`;
    if (seen.has(duplicateKey)) {
      throw new BanzaiError(
        "INVALID_CONFIG",
        `${label} duplicates an existing context selector.`
      );
    }
    seen.add(duplicateKey);
    return {
      metric: metric as ContextMetric,
      phase: phase as ContextLimit["phase"],
      role: role as ContextLimit["role"],
      maximum
    };
  });
  return { mode, limits };
}

const CLAUDE_ENVIRONMENT_MODES = new Set<ClaudeEnvironmentMode>([
  "scoped",
  "ambient"
]);

/**
 * Absent configuration selects the isolating default, so files written before
 * ADR 0020 need no migration.
 */
function parseClaudeEnvironment(value: unknown): ClaudeEnvironmentSettings {
  if (value === undefined || value === null) {
    return { mode: "scoped", pluginDirectory: null };
  }
  const record = requireRecord(value, "claudeEnvironment");
  const mode = record.mode;
  if (
    typeof mode !== "string" ||
    !CLAUDE_ENVIRONMENT_MODES.has(mode as ClaudeEnvironmentMode)
  ) {
    throw new BanzaiError(
      "INVALID_CONFIG",
      'claudeEnvironment.mode must be "scoped" or "ambient".'
    );
  }
  const pluginDirectory = record.pluginDirectory;
  if (pluginDirectory === undefined || pluginDirectory === null) {
    return { mode: mode as ClaudeEnvironmentMode, pluginDirectory: null };
  }
  if (
    typeof pluginDirectory !== "string" ||
    pluginDirectory.trim().length === 0
  ) {
    throw new BanzaiError(
      "INVALID_CONFIG",
      "claudeEnvironment.pluginDirectory must be a non-empty string or null."
    );
  }
  return {
    mode: mode as ClaudeEnvironmentMode,
    pluginDirectory: pluginDirectory.trim()
  };
}

function verificationEvidenceError(code: string, field: string): BanzaiError {
  return new BanzaiError(
    code,
    `Invalid verification evidence field: ${field}.`
  );
}

function verificationRecord(
  value: unknown,
  code: string,
  field: string
): Record<string, unknown> {
  if (!isRecord(value)) {
    throw verificationEvidenceError(code, field);
  }
  return value;
}

function verificationKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  code: string,
  field: string
): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    throw verificationEvidenceError(code, field);
  }
}

function verificationString(
  value: unknown,
  code: string,
  field: string,
  pattern?: RegExp
): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    (pattern !== undefined && !pattern.test(value))
  ) {
    throw verificationEvidenceError(code, field);
  }
  return value;
}

function verificationNullableString(
  value: unknown,
  code: string,
  field: string
): string | null {
  if (value === null) {
    return null;
  }
  return verificationString(value, code, field);
}

function verificationPositiveInteger(
  value: unknown,
  code: string,
  field: string
): number {
  if (!Number.isInteger(value) || (value as number) <= 0) {
    throw verificationEvidenceError(code, field);
  }
  return value as number;
}

function verificationNullableNonNegativeInteger(
  value: unknown,
  code: string,
  field: string
): number | null {
  if (value === null) {
    return null;
  }
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw verificationEvidenceError(code, field);
  }
  return value as number;
}

function verificationInstant(
  value: unknown,
  code: string,
  field: string
): string {
  if (normalizeRfc3339Instant(value) === undefined) {
    throw verificationEvidenceError(code, field);
  }
  return value as string;
}

function parseVerificationLogEvidence(
  value: unknown,
  code: string,
  field: string
): VerificationAttemptLogEvidence | null {
  if (value === null) {
    return null;
  }
  const record = verificationRecord(value, code, field);
  verificationKeys(record, ["relativePath", "sha256"], code, field);
  const relativePath = verificationString(
    record.relativePath,
    code,
    `${field}.relativePath`
  );
  if (
    !relativePath.startsWith("verification/") ||
    relativePath.includes("\\") ||
    relativePath
      .split("/")
      .some((part) => part === "" || part === "." || part === "..")
  ) {
    throw verificationEvidenceError(code, `${field}.relativePath`);
  }
  return {
    relativePath,
    sha256: verificationString(
      record.sha256,
      code,
      `${field}.sha256`,
      /^[a-f0-9]{64}$/
    )
  };
}

export function parseVerificationLedger(value: unknown): VerificationLedger {
  const code = "VERIFICATION_LEDGER_MALFORMED";
  const record = verificationRecord(value, code, "ledger");
  verificationKeys(record, ["schemaVersion"], code, "ledger");
  if (record.schemaVersion !== 1 && record.schemaVersion !== 2) {
    throw verificationEvidenceError(code, "schemaVersion");
  }
  return { schemaVersion: record.schemaVersion };
}

export function parseVerificationAttemptRecord(
  value: unknown
): VerificationAttemptRecord {
  const code = "VERIFICATION_ATTEMPT_MALFORMED";
  const record = verificationRecord(value, code, "attempt");
  verificationKeys(
    record,
    [
      "schemaVersion",
      "id",
      "sequence",
      "round",
      "command",
      "status",
      "startedAt",
      "completedAt",
      "durationMs",
      "exitCode",
      "signal",
      "failureCategory",
      "retryOf",
      "restartOf",
      "stdout",
      "stderr"
    ],
    code,
    "attempt"
  );
  if (record.schemaVersion !== VERIFICATION_LEDGER_SCHEMA_VERSION) {
    throw verificationEvidenceError(code, "schemaVersion");
  }
  const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
  const id = verificationString(record.id, code, "id", idPattern);
  const sequence = verificationPositiveInteger(
    record.sequence,
    code,
    "sequence"
  );
  const roundRecord = verificationRecord(record.round, code, "round");
  verificationKeys(
    roundRecord,
    ["id", "ordinal", "sourcePhase", "sourceAttemptId", "sourceAttemptKind"],
    code,
    "round"
  );
  const sourceAttemptKind = requireEnum(
    roundRecord.sourceAttemptKind,
    "round.sourceAttemptKind",
    ["implementation", "fix"] as const
  );
  const sourcePhase = requireEnum(
    roundRecord.sourcePhase,
    "round.sourcePhase",
    ["implementation", "fix"] as const
  );
  if (sourcePhase !== sourceAttemptKind) {
    throw verificationEvidenceError(code, "round.sourcePhase");
  }
  const round = {
    id: verificationString(roundRecord.id, code, "round.id", idPattern),
    ordinal: verificationPositiveInteger(
      roundRecord.ordinal,
      code,
      "round.ordinal"
    ),
    sourcePhase,
    sourceAttemptId: verificationString(
      roundRecord.sourceAttemptId,
      code,
      "round.sourceAttemptId",
      idPattern
    ),
    sourceAttemptKind
  };
  const commandRecord = verificationRecord(record.command, code, "command");
  verificationKeys(
    commandRecord,
    [
      "profileId",
      "projectType",
      "profileOrdinal",
      "commandOrdinal",
      "configurationDigest"
    ],
    code,
    "command"
  );
  const command = {
    profileId: verificationString(
      commandRecord.profileId,
      code,
      "command.profileId"
    ),
    projectType: requireEnum(
      commandRecord.projectType,
      "command.projectType",
      VERIFICATION_PROJECT_TYPES
    ),
    profileOrdinal: verificationPositiveInteger(
      commandRecord.profileOrdinal,
      code,
      "command.profileOrdinal"
    ),
    commandOrdinal: verificationPositiveInteger(
      commandRecord.commandOrdinal,
      code,
      "command.commandOrdinal"
    ),
    configurationDigest: verificationString(
      commandRecord.configurationDigest,
      code,
      "command.configurationDigest",
      /^[a-f0-9]{64}$/
    )
  };
  const status = requireEnum(
    record.status,
    "status",
    VERIFICATION_ATTEMPT_STATUSES
  );
  const startedAt = verificationInstant(record.startedAt, code, "startedAt");
  const completedAt =
    record.completedAt === null
      ? null
      : verificationInstant(record.completedAt, code, "completedAt");
  const durationMs = verificationNullableNonNegativeInteger(
    record.durationMs,
    code,
    "durationMs"
  );
  const exitCode = verificationNullableNonNegativeInteger(
    record.exitCode,
    code,
    "exitCode"
  );
  const signal = verificationNullableString(record.signal, code, "signal");
  const failureCategory =
    record.failureCategory === null
      ? null
      : requireEnum(
          record.failureCategory,
          "failureCategory",
          VERIFICATION_FAILURE_CATEGORIES
        );
  const retryOf =
    record.retryOf === null
      ? null
      : verificationString(record.retryOf, code, "retryOf", idPattern);
  const restartOf =
    record.restartOf === null
      ? null
      : verificationString(record.restartOf, code, "restartOf", idPattern);
  if (retryOf !== null && restartOf !== null) {
    throw verificationEvidenceError(code, "retryOf");
  }
  const stdout = parseVerificationLogEvidence(record.stdout, code, "stdout");
  const stderr = parseVerificationLogEvidence(record.stderr, code, "stderr");
  const durationFromInstants =
    completedAt === null
      ? null
      : Date.parse(completedAt) - Date.parse(startedAt);
  if (
    (completedAt !== null && durationFromInstants !== durationMs) ||
    (completedAt === null && durationMs !== null)
  ) {
    throw verificationEvidenceError(code, "durationMs");
  }
  if (
    status === "started" &&
    (completedAt !== null ||
      exitCode !== null ||
      signal !== null ||
      failureCategory !== null ||
      stdout !== null ||
      stderr !== null)
  ) {
    throw verificationEvidenceError(code, "status");
  }
  if (
    status === "completed" &&
    (completedAt === null || exitCode !== 0 || failureCategory !== null)
  ) {
    throw verificationEvidenceError(code, "status");
  }
  if (
    status === "failed" &&
    (completedAt === null ||
      failureCategory === null ||
      (failureCategory === "command_exit" &&
        (exitCode === null || exitCode === 0)))
  ) {
    throw verificationEvidenceError(code, "status");
  }
  if (
    status === "interrupted" &&
    (completedAt === null ||
      exitCode !== null ||
      signal !== null ||
      stdout !== null ||
      stderr !== null)
  ) {
    throw verificationEvidenceError(code, "status");
  }
  return {
    schemaVersion: VERIFICATION_LEDGER_SCHEMA_VERSION,
    id,
    sequence,
    round,
    command,
    status,
    startedAt,
    completedAt,
    durationMs,
    exitCode,
    signal,
    failureCategory,
    retryOf,
    restartOf,
    stdout,
    stderr
  };
}

const RUN_STATUSES = [
  "created",
  "selecting",
  "planning",
  "needs_adr_approval",
  "needs_plan_approval",
  "needs_human_decision",
  "plan_approved",
  "implementing",
  "verifying",
  "reviewing",
  "needs_triage",
  "fixing",
  "done",
  "blocked",
  "cancelled"
] as const satisfies readonly RunStatus[];

const ATTEMPT_KINDS = [
  "selection",
  "plan",
  "implementation",
  "fix",
  "review"
] as const satisfies readonly AttemptReference["kind"][];

const WORKFLOW_ROUTES = [
  "quick-fix",
  "feature",
  "strict"
] as const satisfies readonly WorkflowRoute[];

const REVIEW_VERDICTS = [
  "pass",
  "changes_requested",
  "replan_required",
  "blocked"
] as const satisfies readonly ReviewVerdict[];

const ROTATION_REASONS = [
  "primary-review",
  "missing-session",
  "legacy-state",
  "settings-changed",
  "approval-changed",
  "previous-review-failed",
  "session-inventory-changed",
  "previous-review-interrupted",
  "previous-review-blocked",
  "accepted-high-risk-finding",
  "delta-limit-reached",
  "unreliable-review"
] as const satisfies readonly EvaluationRotationReason[];

function evaluationError(message: string): BanzaiError {
  return new BanzaiError("INVALID_EVALUATION_SOURCE", message);
}

function observed<T>(value: T): EvidenceValue<T> {
  return { value, evidence: "observed" };
}

function absent<T>(legacy = false): EvidenceValue<T> {
  return { value: null, evidence: legacy ? "legacy_absent" : "unknown" };
}

function invalid<T>(): EvidenceValue<T> {
  return { value: null, evidence: "invalid" };
}

function notApplicable<T>(): EvidenceValue<T> {
  return { value: null, evidence: "not_applicable" };
}

function issue(
  issues: EvaluationSourceIssue[],
  code: EvaluationIssueCode,
  field: string | null
): void {
  issues.push({ code, field });
}

function sourceValue<T>(
  record: Record<string, unknown>,
  key: string,
  field: string,
  issues: EvaluationSourceIssue[],
  parse: (value: unknown) => T | undefined,
  options: {
    legacyAbsent?: boolean;
    nullable?: boolean;
    required?: boolean;
  } = {}
): EvidenceValue<T> {
  if (!Object.hasOwn(record, key)) {
    if (options.required ?? true) {
      issue(
        issues,
        options.legacyAbsent === true
          ? "LEGACY_FIELD_ABSENT"
          : "STATE_FIELD_MISSING",
        field
      );
    }
    return absent(options.legacyAbsent);
  }
  const value = record[key];
  if (value === null && options.nullable === true) {
    return notApplicable();
  }
  if (value === null) {
    return absent(options.legacyAbsent);
  }
  const parsed = parse(value);
  if (parsed === undefined) {
    issue(issues, "STATE_FIELD_INVALID", field);
    return invalid();
  }
  return observed(parsed);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function contractVersionValue(value: unknown): string | undefined {
  return typeof value === "string" &&
    value.length <= 64 &&
    /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(value)
    ? value
    : undefined;
}

function modelIdValue(value: unknown): string | undefined {
  return typeof value === "string" &&
    value.length <= 128 &&
    /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(value)
    ? value
    : undefined;
}

function nonNegativeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function nonNegativeInteger(value: unknown): number | undefined {
  const parsed = nonNegativeNumber(value);
  return parsed !== undefined && Number.isInteger(parsed) ? parsed : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function enumValue<T extends string>(
  value: unknown,
  values: readonly T[]
): T | undefined {
  return typeof value === "string" && values.includes(value as T)
    ? (value as T)
    : undefined;
}

const RFC3339_INSTANT =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|([+-])(\d{2}):(\d{2}))$/;

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    return leap ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

export function normalizeRfc3339Instant(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const match = RFC3339_INSTANT.exec(value);
  if (match === null) {
    return undefined;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = Number(match[9] ?? 0);
  const offsetMinute = Number(match[10] ?? 0);
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth(year, month) ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    offsetHour > 23 ||
    offsetMinute > 59
  ) {
    return undefined;
  }
  const instant = new Date(value);
  return Number.isFinite(instant.getTime()) ? instant.toISOString() : undefined;
}

function rfc3339Value(value: unknown): string | undefined {
  return normalizeRfc3339Instant(value) === undefined
    ? undefined
    : (value as string);
}

function metricValue(
  record: Record<string, unknown> | null,
  key: string,
  field: string,
  issues: EvaluationSourceIssue[],
  legacyAbsent = false,
  nullable = false
): EvidenceValue<number> {
  if (record === null) {
    return absent(legacyAbsent);
  }
  return sourceValue(record, key, field, issues, nonNegativeNumber, {
    legacyAbsent,
    nullable
  });
}

function childRecord(
  value: unknown,
  field: string,
  issues: EvaluationSourceIssue[],
  legacyAbsent = false
): Record<string, unknown> | null {
  if (isRecord(value)) {
    return value;
  }
  issue(
    issues,
    legacyAbsent ? "LEGACY_FIELD_ABSENT" : "STATE_FIELD_INVALID",
    field
  );
  return null;
}

function emptyStateMetrics(
  legacy: boolean,
  issues: EvaluationSourceIssue[]
): EvaluationStateMetricSource {
  const missing = (): EvidenceValue<number> => absent(legacy);
  issue(
    issues,
    legacy ? "LEGACY_FIELD_ABSENT" : "STATE_FIELD_MISSING",
    "metrics"
  );
  return {
    attempts: {
      selection: missing(),
      plan: missing(),
      implementation: missing(),
      fix: missing(),
      review: missing(),
      verification: missing()
    },
    usage: {
      inputTokens: missing(),
      cachedInputTokens: missing(),
      outputTokens: missing(),
      costUsd: missing()
    },
    reviewFindingCount: missing(),
    sessions: { fresh: missing(), resumed: missing() },
    reviews: { full: missing(), delta: missing(), rotations: missing() },
    triage: { accepted: missing(), rejected: missing(), deferred: missing() }
  };
}

function parseStateMetrics(
  value: unknown,
  schemaVersion: 1 | 2 | 3 | 4 | 5 | 6 | 7,
  issues: EvaluationSourceIssue[]
): EvaluationStateMetricSource {
  if (!isRecord(value)) {
    return emptyStateMetrics(schemaVersion === 1, issues);
  }
  const attempts = childRecord(value.attempts, "metrics.attempts", issues);
  const usage = childRecord(value.usage, "metrics.usage", issues);
  const sessions = childRecord(
    value.sessions,
    "metrics.sessions",
    issues,
    schemaVersion === 1
  );
  const reviews = childRecord(
    value.reviews,
    "metrics.reviews",
    issues,
    schemaVersion === 1
  );
  const triage = childRecord(value.triage, "metrics.triage", issues);
  return {
    attempts: {
      selection: metricValue(
        attempts,
        "selection",
        "metrics.attempts.selection",
        issues,
        schemaVersion === 1
      ),
      plan: metricValue(attempts, "plan", "metrics.attempts.plan", issues),
      implementation: metricValue(
        attempts,
        "implementation",
        "metrics.attempts.implementation",
        issues
      ),
      fix: metricValue(attempts, "fix", "metrics.attempts.fix", issues),
      review: metricValue(
        attempts,
        "review",
        "metrics.attempts.review",
        issues
      ),
      verification: metricValue(
        attempts,
        "verification",
        "metrics.attempts.verification",
        issues
      )
    },
    usage: {
      inputTokens: metricValue(
        usage,
        "inputTokens",
        "metrics.usage.inputTokens",
        issues
      ),
      cachedInputTokens: metricValue(
        usage,
        "cachedInputTokens",
        "metrics.usage.cachedInputTokens",
        issues
      ),
      outputTokens: metricValue(
        usage,
        "outputTokens",
        "metrics.usage.outputTokens",
        issues
      ),
      costUsd: metricValue(
        usage,
        "costUsd",
        "metrics.usage.costUsd",
        issues,
        false,
        true
      )
    },
    reviewFindingCount: metricValue(
      value,
      "reviewFindingCount",
      "metrics.reviewFindingCount",
      issues
    ),
    sessions: {
      fresh: metricValue(
        sessions,
        "fresh",
        "metrics.sessions.fresh",
        issues,
        schemaVersion === 1
      ),
      resumed: metricValue(
        sessions,
        "resumed",
        "metrics.sessions.resumed",
        issues,
        schemaVersion === 1
      )
    },
    reviews: {
      full: metricValue(
        reviews,
        "full",
        "metrics.reviews.full",
        issues,
        schemaVersion === 1
      ),
      delta: metricValue(
        reviews,
        "delta",
        "metrics.reviews.delta",
        issues,
        schemaVersion === 1
      ),
      rotations: metricValue(
        reviews,
        "rotations",
        "metrics.reviews.rotations",
        issues,
        schemaVersion === 1
      )
    },
    triage: {
      accepted: metricValue(
        triage,
        "accepted",
        "metrics.triage.accepted",
        issues
      ),
      rejected: metricValue(
        triage,
        "rejected",
        "metrics.triage.rejected",
        issues
      ),
      deferred: metricValue(
        triage,
        "deferred",
        "metrics.triage.deferred",
        issues
      )
    }
  };
}

function parseVerificationSource(
  value: unknown,
  index: number,
  issues: EvaluationSourceIssue[]
): EvaluationVerificationSource {
  if (!isRecord(value)) {
    issue(issues, "STATE_FIELD_INVALID", `verification[${index}]`);
    return {
      validStructure: false,
      exitCode: invalid(),
      signalPresent: invalid(),
      startedAt: invalid(),
      completedAt: invalid()
    };
  }
  let signalPresent: EvidenceValue<boolean>;
  if (value.signal === null) {
    signalPresent = observed(false);
  } else if (typeof value.signal === "string") {
    signalPresent = observed(true);
  } else {
    issue(issues, "STATE_FIELD_INVALID", `verification[${index}].signal`);
    signalPresent = invalid();
  }
  return {
    validStructure: true,
    exitCode: sourceValue(
      value,
      "exitCode",
      `verification[${index}].exitCode`,
      issues,
      nonNegativeInteger
    ),
    signalPresent,
    startedAt: sourceValue(
      value,
      "startedAt",
      `verification[${index}].startedAt`,
      issues,
      rfc3339Value
    ),
    completedAt: sourceValue(
      value,
      "completedAt",
      `verification[${index}].completedAt`,
      issues,
      rfc3339Value
    )
  };
}

function triageCounts(
  records: unknown[],
  issues: EvaluationSourceIssue[],
  field: string
): Record<FindingDisposition, number> {
  const counts = { accepted: 0, rejected: 0, deferred: 0 };
  for (const [recordIndex, value] of records.entries()) {
    if (!isRecord(value) || !Array.isArray(value.items)) {
      issue(issues, "STATE_FIELD_INVALID", `${field}[${recordIndex}]`);
      continue;
    }
    for (const [itemIndex, item] of value.items.entries()) {
      if (!isRecord(item)) {
        issue(
          issues,
          "STATE_FIELD_INVALID",
          `${field}[${recordIndex}].items[${itemIndex}]`
        );
        continue;
      }
      const disposition = enumValue(item.disposition, [
        "accepted",
        "rejected",
        "deferred"
      ] as const);
      if (disposition === undefined) {
        issue(
          issues,
          "STATE_FIELD_INVALID",
          `${field}[${recordIndex}].items[${itemIndex}].disposition`
        );
        continue;
      }
      counts[disposition] += 1;
    }
  }
  return counts;
}

export function parseEvaluationStateSource(
  value: unknown
): EvaluationDecoded<EvaluationStateSource> {
  if (!isRecord(value)) {
    throw evaluationError("Persisted state is not a supported object.");
  }
  if (
    value.schemaVersion !== 1 &&
    value.schemaVersion !== 2 &&
    value.schemaVersion !== 3 &&
    value.schemaVersion !== 4 &&
    value.schemaVersion !== 5 &&
    value.schemaVersion !== 6 &&
    value.schemaVersion !== 7
  ) {
    throw new BanzaiError(
      "EVALUATION_STATE_SCHEMA_UNSUPPORTED",
      "Persisted state uses an unsupported schema."
    );
  }
  if (value.schemaVersion === 6 || value.schemaVersion === 7)
    validateConfigurationStateEnvelope(value);
  if (value.schemaVersion === 7) {
    if (!Object.hasOwn(value, "completionPublication"))
      throw new BanzaiError(
        "EVALUATION_STATE_SCHEMA_UNSUPPORTED",
        "Schema-7 state must carry its completion publication cursor."
      );
    if (value.completionPublication !== null)
      parseCompletionPublicationCursor(value.completionPublication);
  }
  const schemaVersion = value.schemaVersion;
  const issues: EvaluationSourceIssue[] = [];
  let workflow: EvidenceValue<WorkflowRoute>;
  if (isRecord(value.workflowSelection)) {
    workflow = sourceValue(
      value.workflowSelection,
      "workflow",
      "workflowSelection.workflow",
      issues,
      (item) => enumValue(item, WORKFLOW_ROUTES)
    );
  } else if (!Object.hasOwn(value, "workflowSelection")) {
    workflow = absent(schemaVersion === 1);
    issue(
      issues,
      schemaVersion === 1 ? "LEGACY_FIELD_ABSENT" : "STATE_FIELD_MISSING",
      "workflowSelection"
    );
  } else if (value.workflowSelection === null) {
    workflow = absent();
  } else {
    issue(issues, "STATE_FIELD_INVALID", "workflowSelection");
    workflow = invalid();
  }

  const verification: EvaluationVerificationSource[] = [];
  let verificationList: EvidenceValue<boolean>;
  if (Array.isArray(value.verification)) {
    verificationList = observed(true);
    for (const [index, item] of value.verification.entries()) {
      const parsed = parseVerificationSource(item, index, issues);
      verification.push(parsed);
    }
  } else if (!Object.hasOwn(value, "verification")) {
    issue(issues, "STATE_FIELD_MISSING", "verification");
    verificationList = absent();
  } else {
    issue(issues, "STATE_FIELD_INVALID", "verification");
    verificationList = invalid();
  }

  let triage: Record<FindingDisposition, number>;
  let triageIsCumulative: boolean;
  if (schemaVersion >= 2) {
    if (Array.isArray(value.triageHistory)) {
      triage = triageCounts(value.triageHistory, issues, "triageHistory");
      triageIsCumulative = true;
    } else {
      issue(issues, "STATE_FIELD_INVALID", "triageHistory");
      triage = { accepted: 0, rejected: 0, deferred: 0 };
      triageIsCumulative = false;
    }
  } else {
    issue(issues, "LEGACY_FIELD_ABSENT", "triageHistory");
    triage =
      value.triage === null || value.triage === undefined
        ? { accepted: 0, rejected: 0, deferred: 0 }
        : triageCounts([value.triage], issues, "triage");
    triageIsCumulative = false;
  }

  let activeAttemptIdentity: EvidenceValue<string>;
  let activeAttemptKind: EvidenceValue<AttemptReference["kind"]>;
  if (value.activeAttempt === null) {
    activeAttemptIdentity = notApplicable();
    activeAttemptKind = notApplicable();
  } else if (isRecord(value.activeAttempt)) {
    activeAttemptIdentity = sourceValue(
      value.activeAttempt,
      "id",
      "activeAttempt.id",
      issues,
      stringValue
    );
    activeAttemptKind = sourceValue(
      value.activeAttempt,
      "kind",
      "activeAttempt.kind",
      issues,
      (item) => enumValue(item, ATTEMPT_KINDS)
    );
  } else if (!Object.hasOwn(value, "activeAttempt")) {
    issue(issues, "STATE_FIELD_MISSING", "activeAttempt");
    activeAttemptIdentity = absent();
    activeAttemptKind = absent();
  } else {
    issue(issues, "STATE_FIELD_INVALID", "activeAttempt");
    activeAttemptIdentity = invalid();
    activeAttemptKind = invalid();
  }

  let activeVerification: EvidenceValue<boolean>;
  if (value.activeProcess === null) {
    activeVerification = observed(false);
  } else if (isRecord(value.activeProcess)) {
    const kind = enumValue(value.activeProcess.kind, [
      ...ATTEMPT_KINDS,
      "verification"
    ] as const);
    if (kind === undefined) {
      issue(issues, "STATE_FIELD_INVALID", "activeProcess.kind");
      activeVerification = invalid();
    } else {
      activeVerification = observed(kind === "verification");
    }
  } else if (!Object.hasOwn(value, "activeProcess")) {
    issue(issues, "STATE_FIELD_MISSING", "activeProcess");
    activeVerification = absent();
  } else {
    issue(issues, "STATE_FIELD_INVALID", "activeProcess");
    activeVerification = invalid();
  }

  let appliedReviewIteration: EvidenceValue<number>;
  if (value.latestReview === null) {
    appliedReviewIteration = observed(0);
  } else if (isRecord(value.latestReview)) {
    const iteration = nonNegativeInteger(value.latestReview.iteration);
    const resultPath = stringValue(value.latestReview.resultPath);
    if (
      iteration === undefined ||
      iteration < 1 ||
      resultPath !== `reviews/review-${iteration}.json`
    ) {
      issue(issues, "STATE_FIELD_INVALID", "latestReview");
      appliedReviewIteration = invalid();
    } else {
      appliedReviewIteration = observed(iteration);
    }
  } else if (!Object.hasOwn(value, "latestReview")) {
    issue(issues, "STATE_FIELD_MISSING", "latestReview");
    appliedReviewIteration = absent();
  } else {
    issue(issues, "STATE_FIELD_INVALID", "latestReview");
    appliedReviewIteration = invalid();
  }

  return {
    value: {
      schemaVersion,
      ...(schemaVersion === 6 ||
      (schemaVersion === 7 && typeof value.verificationMode === "string")
        ? { verificationMode: value.verificationMode as "ordered" | "policy" }
        : {}),
      contractVersion: sourceValue(
        value,
        "contractVersion",
        "contractVersion",
        issues,
        contractVersionValue
      ),
      status: sourceValue(value, "status", "status", issues, (item) =>
        enumValue(item, RUN_STATUSES)
      ),
      createdAt: sourceValue(
        value,
        "createdAt",
        "createdAt",
        issues,
        rfc3339Value
      ),
      updatedAt: sourceValue(
        value,
        "updatedAt",
        "updatedAt",
        issues,
        rfc3339Value
      ),
      workflow,
      reviewIteration: sourceValue(
        value,
        "reviewIteration",
        "reviewIteration",
        issues,
        nonNegativeInteger
      ),
      appliedReviewIteration,
      fixCycle: sourceValue(
        value,
        "fixCycle",
        "fixCycle",
        issues,
        nonNegativeInteger
      ),
      blockedFrom: sourceValue(
        value,
        "blockedFrom",
        "blockedFrom",
        issues,
        (item) => enumValue(item, RUN_STATUSES),
        { nullable: true }
      ),
      activeAttemptIdentity,
      activeAttemptKind,
      activeVerification,
      triage,
      triageIsCumulative,
      verificationList,
      verification,
      metrics: parseStateMetrics(value.metrics, schemaVersion, issues)
    },
    issues
  };
}

function attemptEvidence<T>(
  record: Record<string, unknown>,
  key: string,
  field: string,
  issues: EvaluationSourceIssue[],
  parse: (value: unknown) => T | undefined,
  nullable = false,
  legacyAbsent = false
): EvidenceValue<T> {
  if (!Object.hasOwn(record, key)) {
    issue(
      issues,
      legacyAbsent ? "LEGACY_FIELD_ABSENT" : "STATE_FIELD_MISSING",
      field
    );
    return absent(legacyAbsent);
  }
  const value = record[key];
  if (value === null) {
    return nullable ? notApplicable() : absent(legacyAbsent);
  }
  const parsed = parse(value);
  if (parsed === undefined) {
    issue(issues, "STATE_FIELD_INVALID", field);
    return invalid();
  }
  return observed(parsed);
}

function unknownUsage(): EvaluationAttemptSource["usage"] {
  return {
    inputTokens: absent(),
    cachedInputTokens: absent(),
    outputTokens: absent(),
    costUsd: absent()
  };
}

export function parseEvaluationAttemptSource(
  value: unknown
): EvaluationDecoded<EvaluationAttemptSource> {
  if (!isRecord(value) || !isRecord(value.attempt)) {
    throw evaluationError("Persisted attempt is not a supported object.");
  }
  const issues: EvaluationSourceIssue[] = [];
  const identity = stringValue(value.attempt.id);
  if (identity === undefined) {
    throw evaluationError("Persisted attempt has no usable identity.");
  }
  const kind = attemptEvidence(
    value.attempt,
    "kind",
    "attempt.kind",
    issues,
    (item) => enumValue(item, ATTEMPT_KINDS)
  );
  // Frozen export v1 cannot describe a runner-owned publication that is still
  // pending: it stays an incomplete active attempt, never a guessed outcome.
  const pendingApplication = value.status === "pending_application";
  const persistedStatus = pendingApplication
    ? (() => {
        issue(issues, "ACTIVE_ATTEMPT_INCOMPLETE", "status");
        return { value: null, evidence: "unknown" } as EvidenceValue<
          "started" | "completed" | "failed" | "interrupted"
        >;
      })()
    : attemptEvidence(value, "status", "status", issues, (item) =>
        enumValue(item, [
          "started",
          "completed",
          "failed",
          "interrupted"
        ] as const)
      );
  const status: EvaluationAttemptSource["status"] =
    persistedStatus.value === "interrupted"
      ? { value: "started", evidence: "derived" }
      : persistedStatus;

  let sessionMode: EvidenceValue<SessionMode>;
  if (!Object.hasOwn(value, "sessionMode")) {
    issue(issues, "LEGACY_FIELD_ABSENT", "sessionMode");
    sessionMode = absent(true);
  } else {
    sessionMode = attemptEvidence(
      value,
      "sessionMode",
      "sessionMode",
      issues,
      (item) => enumValue(item, ["fresh", "resumed"] as const)
    );
  }

  let reviewMode: EvidenceValue<"full" | "delta">;
  let rotationReason: EvidenceValue<EvaluationRotationReason>;
  if (kind.value !== "review") {
    reviewMode = notApplicable();
    rotationReason = notApplicable();
  } else {
    reviewMode = attemptEvidence(
      value,
      "reviewMode",
      "reviewMode",
      issues,
      (item) => enumValue(item, ["full", "delta"] as const),
      false,
      !Object.hasOwn(value, "reviewMode")
    );
    rotationReason = attemptEvidence(
      value,
      "rotationReason",
      "rotationReason",
      issues,
      (item) => enumValue(item, ROTATION_REASONS),
      true,
      !Object.hasOwn(value, "rotationReason")
    );
  }

  let model: EvaluationAttemptSource["model"];
  if (isRecord(value.sessionContext)) {
    const executable = stringValue(value.sessionContext.executable);
    const normalizedVendor =
      executable === undefined ? null : vendorFor(executable);
    model = {
      vendor:
        executable === undefined
          ? invalid()
          : observed(normalizedVendor ?? "unknown"),
      model: attemptEvidence(
        value.sessionContext,
        "model",
        "sessionContext.model",
        issues,
        modelIdValue
      ),
      effort: attemptEvidence(
        value.sessionContext,
        "effort",
        "sessionContext.effort",
        issues,
        (item) =>
          enumValue(item, [
            "low",
            "medium",
            "high",
            "xhigh",
            "max",
            "ultra"
          ] as const)
      )
    };
    if (executable === undefined) {
      issue(issues, "STATE_FIELD_INVALID", "sessionContext.executable");
    }
  } else {
    issue(issues, "LEGACY_FIELD_ABSENT", "sessionContext");
    model = {
      vendor: absent(true),
      model: absent(true),
      effort: absent(true)
    };
  }

  let usage: EvaluationAttemptSource["usage"];
  if (value.usage === null || value.usage === undefined) {
    usage = unknownUsage();
  } else if (isRecord(value.usage)) {
    usage = {
      inputTokens: attemptEvidence(
        value.usage,
        "inputTokens",
        "usage.inputTokens",
        issues,
        nonNegativeNumber
      ),
      cachedInputTokens: attemptEvidence(
        value.usage,
        "cachedInputTokens",
        "usage.cachedInputTokens",
        issues,
        nonNegativeNumber
      ),
      outputTokens: attemptEvidence(
        value.usage,
        "outputTokens",
        "usage.outputTokens",
        issues,
        nonNegativeNumber
      ),
      costUsd: attemptEvidence(
        value.usage,
        "costUsd",
        "usage.costUsd",
        issues,
        nonNegativeNumber,
        true
      )
    };
  } else {
    issue(issues, "STATE_FIELD_INVALID", "usage");
    usage = {
      inputTokens: invalid(),
      cachedInputTokens: invalid(),
      outputTokens: invalid(),
      costUsd: invalid()
    };
  }

  return {
    value: {
      identity,
      schemaVersion: attemptEvidence(
        value,
        "schemaVersion",
        "schemaVersion",
        issues,
        (item) => (item === 1 || item === 2 || item === 3 ? item : undefined),
        false,
        !Object.hasOwn(value, "schemaVersion")
      ),
      kind,
      mutable: attemptEvidence(
        value.attempt,
        "mutable",
        "attempt.mutable",
        issues,
        booleanValue
      ),
      status,
      startedAt: attemptEvidence(
        value,
        "startedAt",
        "startedAt",
        issues,
        rfc3339Value
      ),
      completedAt: attemptEvidence(
        value,
        "completedAt",
        "completedAt",
        issues,
        rfc3339Value,
        status.value === "started" || pendingApplication
      ),
      durationMs: attemptEvidence(
        value,
        "durationMs",
        "durationMs",
        issues,
        nonNegativeNumber,
        status.value === "started" || pendingApplication
      ),
      sessionMode,
      reviewMode,
      rotationReason,
      model,
      usage
    },
    issues
  };
}

export function parseEvaluationReviewSource(
  value: unknown
): EvaluationDecoded<EvaluationReviewSource> {
  if (!isRecord(value) || !Array.isArray(value.findings)) {
    throw evaluationError("Persisted review is not a supported object.");
  }
  const issues: EvaluationSourceIssue[] = [];
  const verdict = sourceValue(value, "verdict", "verdict", issues, (item) =>
    enumValue(item, REVIEW_VERDICTS)
  );
  const findings = { blocker: 0, should_fix: 0, nit: 0 };
  for (const [index, finding] of value.findings.entries()) {
    if (!isRecord(finding)) {
      throw evaluationError("Persisted review contains an invalid finding.");
    }
    const severity = enumValue(finding.severity, [
      "blocker",
      "should_fix",
      "nit"
    ] as const);
    if (severity === undefined) {
      throw evaluationError("Persisted review contains an invalid severity.");
    }
    findings[severity] += 1;
    if (!Object.hasOwn(finding, "severity")) {
      issue(issues, "STATE_FIELD_MISSING", `findings[${index}].severity`);
    }
  }
  return { value: { verdict, findings }, issues };
}

export function parseEvaluationEventSource(
  value: unknown
): EvaluationEventSource {
  if (!isRecord(value) || typeof value.type !== "string") {
    throw evaluationError("Persisted event is not a supported object.");
  }
  const recognized = [
    "attempt.retry_requested",
    "verification.retry_requested",
    "run.start_retry_requested",
    "review.checks_retry_requested",
    "run.start_failed",
    "review.checks_failed",
    "plan_task_completion.validation_failed"
  ] as const;
  return {
    type: recognized.includes(value.type as (typeof recognized)[number])
      ? (value.type as (typeof recognized)[number])
      : "other"
  };
}

export { parseVerificationDecision } from "./verification-evidence.js";
export {
  parseVerificationApplicability,
  parseVerificationOriginStart,
  parseVerificationOriginFinish
} from "./verification-evidence.js";
