// Generated from orchestrator persisted readers by npm run build. Do not edit.

// src/validation.ts
import { createHash } from "node:crypto";

// src/errors.ts
var BanzaiError = class extends Error {
  code;
  exitCode;
  constructor(code, message, exitCode = 1) {
    super(message);
    this.name = "BanzaiError";
    this.code = code;
    this.exitCode = exitCode;
  }
};

// src/models.ts
function superseded(replacement) {
  return { replacement, standing: "superseded", date: null };
}
function deprecated(replacement, date) {
  return { replacement, standing: "deprecated", date };
}
function retired(replacement, date) {
  return { replacement, standing: "retired", date };
}
var OPUS = "claude-opus-5";
var SONNET = "claude-sonnet-5";
var HAIKU = "claude-haiku-4-5";
var CLAUDE_CATALOG = {
  supported: /* @__PURE__ */ new Set([
    "claude-fable-5-1",
    "claude-fable-5",
    "claude-mythos-5",
    OPUS,
    SONNET,
    "claude-opus-4-8",
    "claude-sonnet-4-6",
    HAIKU,
    "claude-haiku-4-5-20251001",
    // Claude Code aliases always resolve to the current model of their tier.
    "opus",
    "sonnet",
    "haiku",
    "default"
  ]),
  replacements: /* @__PURE__ */ new Map([
    ["claude-opus-4-7", superseded(OPUS)],
    ["claude-opus-4-6", superseded(OPUS)],
    ["claude-opus-4-5", superseded(OPUS)],
    ["claude-opus-4-5-20251101", superseded(OPUS)],
    ["claude-opus-4-1", deprecated(OPUS, "2026-08-05")],
    ["claude-opus-4-1-20250805", deprecated(OPUS, "2026-08-05")],
    ["claude-opus-4-0", deprecated(OPUS, "2026-06-15")],
    ["claude-opus-4-20250514", deprecated(OPUS, "2026-06-15")],
    ["claude-3-opus-20240229", retired(OPUS, "2026-01-05")],
    ["claude-mythos-preview", superseded("claude-fable-5")],
    ["claude-sonnet-4-5", superseded(SONNET)],
    ["claude-sonnet-4-5-20250929", superseded(SONNET)],
    ["claude-sonnet-4-0", deprecated(SONNET, "2026-06-15")],
    ["claude-sonnet-4-20250514", deprecated(SONNET, "2026-06-15")],
    ["claude-3-7-sonnet-20250219", retired(SONNET, "2026-02-19")],
    ["claude-3-5-sonnet-20241022", retired(SONNET, "2025-10-28")],
    ["claude-3-5-sonnet-20240620", retired(SONNET, "2025-10-28")],
    ["claude-3-sonnet-20240229", retired(SONNET, "2025-07-21")],
    ["claude-3-5-haiku-20241022", retired(HAIKU, "2026-02-19")],
    ["claude-3-haiku-20240307", deprecated(HAIKU, "2026-04-19")]
  ])
};
var CODEX_CATALOG = {
  supported: /* @__PURE__ */ new Set([
    "gpt-6-astra",
    "gpt-5.6-sol",
    "gpt-5.6-terra",
    "gpt-5.6-luna",
    "gpt-5.5"
  ]),
  replacements: /* @__PURE__ */ new Map([["gpt-5", superseded("gpt-5.5")]])
};
var FULL_EFFORTS = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max"
];
var CODEX_EFFORTS = [...FULL_EFFORTS, "ultra"];

// src/types.ts
var CONTRACT_VERSION = "1.0.0";
var PHASE_RESULT_SCHEMA_VERSION = 3;
var DECISION_CONSULTATION_SCHEMA = "banzai-decision-consultation/v1";
var DECISION_CONSULTATION_SCHEMA_VERSION = 1;
var PLAN_TASK_COMPLETION_SCHEMA_VERSION = 1;
var VERIFICATION_LEDGER_SCHEMA_VERSION = 1;
var MODEL_ATTEMPT_SCHEMA_VERSION = 2;
var TERMINAL_CHECKPOINT_SCHEMA = "banzai-terminal-attempt-checkpoint/v1";
var TERMINAL_CHECKPOINT_SCHEMA_VERSION = 1;
var RECOVERY_AUTHORIZATION_SCHEMA = "banzai-recovery-authorization/v1";
var RECOVERY_AUTHORIZATION_SCHEMA_VERSION = 1;

// src/validation.ts
var VERIFICATION_ATTEMPT_STATUSES = [
  "started",
  "completed",
  "failed",
  "interrupted"
];
var VERIFICATION_FAILURE_CATEGORIES = [
  "command_exit",
  "process_start",
  "timeout",
  "output_limit",
  "runner_failure"
];
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function requireRecord(value, label) {
  if (!isRecord(value)) {
    throw new BanzaiError("INVALID_RESULT", `${label} must be an object.`);
  }
  return value;
}
function requireString(value, label, allowEmpty = false) {
  if (typeof value !== "string" || !allowEmpty && value.length === 0) {
    throw new BanzaiError(
      "INVALID_RESULT",
      `${label} must be a non-empty string.`
    );
  }
  return value;
}
function requireNullableString(value, label) {
  if (value === null) {
    return null;
  }
  return requireString(value, label, true);
}
function requireStringArray(value, label) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new BanzaiError(
      "INVALID_RESULT",
      `${label} must be an array of strings.`
    );
  }
  return [...new Set(value)];
}
function requireEnum(value, label, allowed) {
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new BanzaiError(
      "INVALID_RESULT",
      `${label} must be one of: ${allowed.join(", ")}.`
    );
  }
  return value;
}
function requirePositiveInteger(value, label) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new BanzaiError(
      "INVALID_CONFIG",
      `${label} must be a positive integer.`
    );
  }
  return value;
}
function parseArtifacts(value) {
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
var CONSULTATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
var UNSAFE_CONSULTATION_CONTROL = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u;
function consultationError(message) {
  throw new BanzaiError("INVALID_RESULT", message);
}
function consultationRecord(value, label, keys) {
  const record = requireRecord(value, label);
  exactKeys(record, keys, "INVALID_RESULT", label);
  return record;
}
function consultationString(value, label, maximum) {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum || UNSAFE_CONSULTATION_CONTROL.test(value)) {
    return consultationError(
      `${label} must be a bounded safe single-line string.`
    );
  }
  return value;
}
function consultationIdentifier(value, label) {
  const identifier = consultationString(value, label, 128);
  if (identifier === "." || identifier === ".." || !CONSULTATION_ID_PATTERN.test(identifier)) {
    return consultationError(`${label} must be a canonical identifier.`);
  }
  return identifier;
}
function consultationStrings(value, label, maximumItems, maximumLength) {
  if (!Array.isArray(value) || value.length > maximumItems) {
    return consultationError(`${label} must be a bounded string array.`);
  }
  const strings = value.map(
    (item, index) => consultationString(item, `${label}[${index}]`, maximumLength)
  );
  if (new Set(strings).size !== strings.length) {
    return consultationError(`${label} must not contain duplicates.`);
  }
  return strings;
}
function consultationPath(value, label) {
  const candidate = consultationString(value, label, 300);
  const segments = candidate.split("/");
  if (candidate.startsWith("/") || candidate.includes("\\") || /^[A-Za-z]:\//u.test(candidate) || segments.some(
    (segment) => segment === "" || segment === "." || segment === ".."
  )) {
    return consultationError(
      `${label} must be a repository-relative canonical path.`
    );
  }
  return candidate;
}
function parseConsultationOption(value, label) {
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
    title: consultationString(record.title, `${label}.title`, 160),
    benefits: consultationStrings(record.benefits, `${label}.benefits`, 8, 500),
    costs: consultationStrings(record.costs, `${label}.costs`, 8, 500),
    risks: consultationStrings(record.risks, `${label}.risks`, 8, 500),
    consequences: consultationStrings(
      record.consequences,
      `${label}.consequences`,
      8,
      500
    )
  };
}
function parseConsultationCard(value, index) {
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
    ["single_choice", "free_text"]
  );
  if (!Array.isArray(record.evidence) || record.evidence.length < 1 || record.evidence.length > 12) {
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
    const line = evidenceRecord.line === null ? null : Number.isSafeInteger(evidenceRecord.line) && evidenceRecord.line > 0 ? evidenceRecord.line : consultationError(
      `${evidenceLabel}.line must be a positive integer or null.`
    );
    return {
      path: consultationPath(evidenceRecord.path, `${evidenceLabel}.path`),
      line,
      detail: consultationString(
        evidenceRecord.detail,
        `${evidenceLabel}.detail`,
        500
      )
    };
  });
  if (!Array.isArray(record.options) || record.options.length > 6) {
    return consultationError(`${label}.options must be a bounded array.`);
  }
  const options = record.options.map(
    (option, optionIndex) => parseConsultationOption(option, `${label}.options[${optionIndex}]`)
  );
  if (new Set(options.map((option) => option.optionId)).size !== options.length) {
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
  let recommendation = null;
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
      rationale: consultationString(
        recommendationRecord.rationale,
        `${label}.recommendation.rationale`,
        1e3
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
    120
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
    title: consultationString(record.title, `${label}.title`, 160),
    question: consultationString(record.question, `${label}.question`, 1e3),
    why: consultationString(record.why, `${label}.why`, 1200),
    affectedRequirements,
    evidence,
    decisionOwner: "human",
    responseMode,
    options,
    recommendation
  };
}
function parseDecisionConsultation(value) {
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
  if (record.schema !== DECISION_CONSULTATION_SCHEMA || record.schemaVersion !== DECISION_CONSULTATION_SCHEMA_VERSION) {
    return consultationError(
      `decisionConsultation must use ${DECISION_CONSULTATION_SCHEMA}.`
    );
  }
  if (!Array.isArray(record.decisions) || record.decisions.length < 1 || record.decisions.length > 3) {
    return consultationError(
      "decisionConsultation.decisions must contain one to three cards."
    );
  }
  const decisions = record.decisions.map(parseConsultationCard);
  if (new Set(decisions.map((decision) => decision.decisionId)).size !== decisions.length) {
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
function completionError(message) {
  throw new BanzaiError("PLAN_TASK_COMPLETION_INVALID", message);
}
function completionString(value, label) {
  if (typeof value !== "string" || value.length === 0 || value.length > 500 || /[\0\r\n]/u.test(value)) {
    return completionError(`${label} must be a bounded single-line string.`);
  }
  return value;
}
function parseTaskCompletion(value) {
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
  const tasks = value.tasks.map((item, index) => {
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
    if (typeof item.status !== "string" || !["completed", "incomplete", "blocked"].includes(item.status)) {
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
    let gap = null;
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
      status: item.status,
      evidence,
      gap
    };
  });
  return { schemaVersion: PLAN_TASK_COMPLETION_SCHEMA_VERSION, tasks };
}
function parseWorkflowSelectionResult(value) {
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
      ["quick-fix", "feature", "strict"]
    ),
    confidence: requireEnum(record.confidence, "confidence", [
      "high",
      "medium",
      "low"
    ]),
    reason: requireString(record.reason, "reason"),
    escalationTriggers: requireStringArray(
      record.escalationTriggers,
      "escalationTriggers"
    )
  };
}
function parsePhaseResult(value) {
  const record = requireRecord(value, "phase result");
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
      "requestedVerification"
    ],
    "INVALID_RESULT",
    "Phase result"
  );
  if (record.schemaVersion !== PHASE_RESULT_SCHEMA_VERSION) {
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
  const gate = record.gate === null ? null : requireEnum(record.gate, "gate", [
    "adr_approval",
    "plan_approval",
    "escalation",
    "decision_consultation"
  ]);
  const outcome = requireEnum(record.outcome, "outcome", [
    "completed",
    "needs_human_decision",
    "blocked"
  ]);
  if (outcome === "needs_human_decision" && gate === null || outcome !== "needs_human_decision" && gate !== null) {
    throw new BanzaiError(
      "INVALID_RESULT",
      "A non-null gate and needs_human_decision outcome must appear together."
    );
  }
  const phase = requireEnum(record.phase, "phase", [
    "plan",
    "implementation",
    "fix"
  ]);
  const questions = requireStringArray(record.questions, "questions");
  const decisionConsultation = parseDecisionConsultation(
    record.decisionConsultation
  );
  const summary = gate === "decision_consultation" ? consultationString(record.summary, "summary", 1e3) : requireString(record.summary, "summary");
  if (gate === "decision_consultation" ? phase !== "plan" || outcome !== "needs_human_decision" || decisionConsultation === null || questions.length !== 0 : decisionConsultation !== null) {
    throw new BanzaiError(
      "INVALID_RESULT",
      "decisionConsultation is allowed only for the planning decision_consultation gate with no escalation questions."
    );
  }
  return {
    schemaVersion: PHASE_RESULT_SCHEMA_VERSION,
    contractVersion: CONTRACT_VERSION,
    phase,
    outcome,
    gate,
    summary,
    artifacts: parseArtifacts(record.artifacts),
    taskCompletion: parseTaskCompletion(record.taskCompletion),
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
function parsePersistedPhaseResult(value) {
  const record = requireRecord(value, "persisted phase result");
  if (record.schemaVersion === PHASE_RESULT_SCHEMA_VERSION) {
    return parsePhaseResult(record);
  }
  const schemaVersion = record.schemaVersion === 2 ? 2 : record.schemaVersion === void 0 || record.schemaVersion === 1 ? 1 : null;
  if (schemaVersion === null) {
    throw new BanzaiError(
      "PHASE_RESULT_SCHEMA_MISMATCH",
      "Persisted phase result schema is unsupported."
    );
  }
  exactKeys(
    record,
    schemaVersion === 1 ? [
      ...Object.hasOwn(record, "schemaVersion") ? ["schemaVersion"] : [],
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
    ] : [
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
  ]);
  const gate = record.gate === null ? null : requireEnum(record.gate, "gate", [
    "adr_approval",
    "plan_approval",
    "escalation"
  ]);
  const reportedOutcome = requireEnum(record.outcome, "outcome", [
    "completed",
    "needs_human_decision",
    "blocked"
  ]);
  const outcome = reportedOutcome === "completed" && gate !== null ? "needs_human_decision" : reportedOutcome;
  if (outcome === "needs_human_decision" && gate === null) {
    throw new BanzaiError(
      "INVALID_RESULT",
      "needs_human_decision requires a non-null gate."
    );
  }
  let artifacts;
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
    taskCompletion: schemaVersion === 1 ? null : parseTaskCompletion(record.taskCompletion),
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
function parseEvidence(value, findingId) {
  const record = requireRecord(value, `${findingId}.evidence`);
  const line = record.line === null ? null : requirePositiveInteger(record.line, `${findingId}.evidence.line`);
  return {
    path: requireString(record.path, `${findingId}.evidence.path`),
    line,
    detail: requireString(record.detail, `${findingId}.evidence.detail`)
  };
}
function parseFinding(value) {
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
    ]),
    category: requireEnum(record.category, `${id}.category`, [
      "spec",
      "plan",
      "adr",
      "correctness",
      "test",
      "security",
      "maintainability",
      "documentation"
    ]),
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
    ])
  };
}
function parseReviewFields(value) {
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
  ]);
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
function parseReviewResult(value) {
  const record = requireRecord(value, "review result");
  if (record.schemaVersion !== void 0 || record.scopeAcknowledgment !== void 0 || record.reviewNotes !== void 0) {
    return parseCurrentReviewResult(value);
  }
  return parseReviewFields(value);
}
function reviewScopePath(value) {
  const name = requireString(value, "scope path");
  if (/^[A-Za-z]:/u.test(name) || /[\\\0\r\n]/u.test(name) || name.startsWith("/") || name.split("/").some((part) => part === "" || part === "." || part === "..")) {
    throw new BanzaiError(
      "INVALID_REVIEW_SCOPE",
      "Scope paths must be exact normalized repository-relative paths."
    );
  }
  return name;
}
function parseCurrentReviewResult(value) {
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
  const strings = (value2, label) => {
    requireStringArray(value2, label);
    return [...value2];
  };
  result.reviewedFindingIds = strings(
    record.reviewedFindingIds,
    "reviewedFindingIds"
  );
  result.deferredCoverage = strings(
    record.deferredCoverage,
    "deferredCoverage"
  );
  for (const [index, item] of record.findings.entries()) {
    const finding = requireRecord(item, "finding");
    const parsedFinding = result.findings[index];
    if (parsedFinding === void 0)
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
    for (const evidence of finding.evidence)
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
  if (acknowledgment.schemaVersion !== 1 || !Array.isArray(acknowledgment.artifacts))
    throw new BanzaiError(
      "INVALID_REVIEW_SCOPE",
      "Scope acknowledgment requires version 1 and explicit artifacts."
    );
  const snapshotDigest = evidenceDigest(
    acknowledgment.snapshotDigest,
    "INVALID_REVIEW_SCOPE",
    "snapshotDigest"
  );
  const artifacts = acknowledgment.artifacts.map((value2) => {
    const entry = requireRecord(value2, "scope entry");
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
    ]);
    if (status === "reviewed" ? entry.reason !== null : typeof entry.reason !== "string" || entry.reason.trim().length === 0)
      throw new BanzaiError(
        "INVALID_REVIEW_SCOPE",
        "Reviewed scope requires a null reason; unreviewed scope requires a nonblank reason."
      );
    return { path, status, reason: entry.reason };
  });
  if (new Set(artifacts.map((entry) => entry.path)).size !== artifacts.length || new Set(result.reviewedFindingIds).size !== result.reviewedFindingIds.length)
    throw new BanzaiError(
      "INVALID_REVIEW_SCOPE",
      "Scope and reviewed finding IDs must be unique."
    );
  if (result.verdict !== "blocked" && artifacts.some((entry) => entry.status === "not_reviewed"))
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
function recoveryEvidenceError(code, message) {
  throw new BanzaiError(code, message);
}
function exactKeys(record, allowed, code, label) {
  const allowedKeys = new Set(allowed);
  const unknown = Object.keys(record).filter((key) => !allowedKeys.has(key));
  if (unknown.length > 0) {
    recoveryEvidenceError(
      code,
      `${label} contains unknown fields: ${unknown.sort().join(", ")}.`
    );
  }
}
function evidenceString(value, code, label, maximum = 500) {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum || /[\0\r\n]/u.test(value)) {
    return recoveryEvidenceError(
      code,
      `${label} must be a bounded single-line string.`
    );
  }
  return value;
}
function evidenceNullableString(value, code, label, maximum = 500) {
  return value === null ? null : evidenceString(value, code, label, maximum);
}
function evidenceIdentifier(value, code, label, maximum = 200) {
  const identifier = evidenceString(value, code, label, maximum);
  if (identifier === "." || identifier === ".." || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(identifier)) {
    return recoveryEvidenceError(
      code,
      `${label} must be a canonical safe identifier.`
    );
  }
  return identifier;
}
function evidenceDigest(value, code, label) {
  const digest = evidenceString(value, code, label, 64);
  if (!/^[a-f0-9]{64}$/u.test(digest)) {
    return recoveryEvidenceError(code, `${label} must be a SHA-256 digest.`);
  }
  return digest;
}
function evidenceTimestamp(value, code, label) {
  const timestamp = evidenceString(value, code, label, 64);
  const normalized = normalizeRfc3339Instant(timestamp);
  if (normalized === void 0) {
    return recoveryEvidenceError(code, `${label} must be an RFC 3339 time.`);
  }
  return normalized;
}
function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
function digestCanonicalJson(value) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}
function parseEvidenceAttempt(value, code, label) {
  if (!isRecord(value)) {
    return recoveryEvidenceError(code, `${label} must be an object.`);
  }
  exactKeys(value, ["id", "kind", "mutable"], code, label);
  const id = evidenceIdentifier(value.id, code, `${label}.id`, 200);
  const kind = value.kind;
  if (typeof kind !== "string" || !["selection", "plan", "implementation", "fix", "review"].includes(kind)) {
    return recoveryEvidenceError(code, `${label}.kind is unsupported.`);
  }
  if (typeof value.mutable !== "boolean") {
    return recoveryEvidenceError(code, `${label}.mutable must be boolean.`);
  }
  return {
    id,
    kind,
    mutable: value.mutable
  };
}
function parseEvidenceUsage(value, code, label) {
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
  const numeric = (item, field, nullable = false) => {
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
  const requiredNumeric = (item, field) => {
    const parsed = numeric(item, field);
    return parsed ?? recoveryEvidenceError(code, `${label}.${field} cannot be null.`);
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
function parseCheckpointResult(kind, value, resultContract) {
  if (kind === "selection") {
    return parseWorkflowSelectionResult(value);
  }
  if (kind === "review") {
    if (resultContract === "review-result/v2")
      return parseCurrentReviewResult(value);
    const legacy = requireRecord(value, "legacy review");
    if (legacy.schemaVersion !== void 0 || legacy.scopeAcknowledgment !== void 0 || legacy.reviewNotes !== void 0)
      return recoveryEvidenceError(
        "INVALID_TERMINAL_CHECKPOINT",
        "Legacy checkpoint cannot carry a new review result."
      );
    return parseReviewFields(value);
  }
  if (resultContract === "phase-result/v3") {
    return parsePhaseResult(value);
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
function terminalCheckpointIntegrity(checkpoint) {
  return digestCanonicalJson(checkpoint);
}
function parseTerminalAttemptCheckpoint(value) {
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
  if (value.schema !== TERMINAL_CHECKPOINT_SCHEMA || value.schemaVersion !== TERMINAL_CHECKPOINT_SCHEMA_VERSION) {
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
  if (typeof effort !== "string" || !["low", "medium", "high", "xhigh", "max", "ultra"].includes(effort)) {
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
  const expectedContract = attempt.kind === "selection" ? "workflow-selection/v1" : attempt.kind === "review" ? resultContract === "review-result/v2" ? "review-result/v2" : "review-result/v1" : resultContract === "phase-result/v2" ? "phase-result/v2" : "phase-result/v3";
  if (resultContract !== expectedContract || attempt.kind !== "selection" && attempt.kind !== "review" && resultContract !== "phase-result/v2" && resultContract !== "phase-result/v3") {
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
  if (classification !== "claude_result" && classification !== "codex_turn_completed") {
    return recoveryEvidenceError(
      code,
      "terminal.classification is unsupported."
    );
  }
  if (vendor === "claude" && classification !== "claude_result" || vendor === "codex" && classification !== "codex_turn_completed") {
    return recoveryEvidenceError(
      code,
      "Terminal classification does not match the configured vendor."
    );
  }
  const checkpointWithoutIntegrity = {
    schema: TERMINAL_CHECKPOINT_SCHEMA,
    schemaVersion: TERMINAL_CHECKPOINT_SCHEMA_VERSION,
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
      effort,
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
  ]) {
    if (digest !== null && !/^[a-f0-9]{64}$/u.test(digest)) {
      return recoveryEvidenceError(code, `${label} must be a SHA-256 digest.`);
    }
  }
  const integrityDigest = evidenceDigest(
    value.integrityDigest,
    code,
    "integrityDigest"
  );
  if (integrityDigest !== terminalCheckpointIntegrity(checkpointWithoutIntegrity)) {
    return recoveryEvidenceError(
      code,
      "Terminal checkpoint integrity mismatch."
    );
  }
  return { ...checkpointWithoutIntegrity, integrityDigest };
}
function parseRecoveryAuthorization(value) {
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
  if (value.schema !== RECOVERY_AUTHORIZATION_SCHEMA || value.schemaVersion !== RECOVERY_AUTHORIZATION_SCHEMA_VERSION) {
    return recoveryEvidenceError(
      code,
      `Recovery authorization must use ${RECOVERY_AUTHORIZATION_SCHEMA}.`
    );
  }
  const attempt = parseEvidenceAttempt(value.attempt, code, "attempt");
  if (attempt.kind !== "implementation" && attempt.kind !== "fix" || !attempt.mutable) {
    return recoveryEvidenceError(
      code,
      "Recovery authorization requires a mutable implementation or fix attempt."
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
  const nullableDigest = (item, label) => {
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
    attempt,
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
function parseModelAttemptRecord(value) {
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
      "reviewDiagnostics"
    ],
    code,
    "Attempt record"
  );
  if (value.schemaVersion !== 1 && value.schemaVersion !== MODEL_ATTEMPT_SCHEMA_VERSION) {
    return recoveryEvidenceError(
      code,
      "Attempt schema version is unsupported."
    );
  }
  const attempt = parseEvidenceAttempt(value.attempt, code, "attempt");
  if (value.rotationReason != null && (typeof value.rotationReason !== "string" || ![
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
  ].includes(value.rotationReason)))
    return recoveryEvidenceError(
      code,
      "Unsupported runtime review rotation reason."
    );
  if (value.reviewDiagnostics !== void 0) {
    if (attempt.kind !== "review" || !Array.isArray(value.reviewDiagnostics))
      return recoveryEvidenceError(
        code,
        "Review diagnostics must belong to a review attempt."
      );
    for (const item of value.reviewDiagnostics) {
      if (!isRecord(item) || typeof item.stage !== "string" || !["render_validation", "publication_application", "recovery"].includes(
        item.stage
      ) || typeof item.code !== "string" || item.code.length === 0 || typeof item.message !== "string")
        return recoveryEvidenceError(code, "Review diagnostic is malformed.");
      exactKeys(item, ["stage", "code", "message"], code, "Review diagnostic");
    }
  }
  if (value.reviewContext !== void 0) {
    const context = value.reviewContext;
    if (attempt.kind !== "review" || attempt.mutable || !isRecord(context) || context.outputContract !== "review-result/v2")
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
  if (value.planningContext !== void 0) {
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
    if (!Array.isArray(context.artifactPaths) || context.artifactPaths.length > 128) {
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
      if (candidate !== "PROJECT_MANIFEST.md" && !candidate.startsWith("documentation/") && !/^\.banzai\/work\/[0-9a-f-]{36}\/(?:description|plan)\.md$/.test(
        candidate
      ) || candidate.includes("\\") || candidate.split("/").some((part) => part === "" || part === "." || part === "..")) {
        return recoveryEvidenceError(
          code,
          "Planning artifact paths must stay within the planning scope."
        );
      }
    }
  }
  const status = value.status;
  if (typeof status !== "string" || !["started", "completed", "failed", "interrupted"].includes(status) || value.schemaVersion === 1 && status === "interrupted") {
    return recoveryEvidenceError(code, "Attempt status is unsupported.");
  }
  evidenceTimestamp(value.startedAt, code, "startedAt");
  if (value.schemaVersion === MODEL_ATTEMPT_SCHEMA_VERSION) {
    if (!Object.hasOwn(value, "interruptedAt") || !Object.hasOwn(value, "recoveryOf") || !Object.hasOwn(value, "recoveryAuthorizationId")) {
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
    if (value.recoveryOf === null !== (value.recoveryAuthorizationId === null)) {
      return recoveryEvidenceError(
        code,
        "Recovery linkage fields must both be present or both be null."
      );
    }
  }
  return value;
}
var VERIFICATION_PROJECT_TYPES = [
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
];
function verificationEvidenceError(code, field) {
  return new BanzaiError(
    code,
    `Invalid verification evidence field: ${field}.`
  );
}
function verificationRecord(value, code, field) {
  if (!isRecord(value)) {
    throw verificationEvidenceError(code, field);
  }
  return value;
}
function verificationKeys(value, allowed, code, field) {
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    throw verificationEvidenceError(code, field);
  }
}
function verificationString(value, code, field, pattern) {
  if (typeof value !== "string" || value.length === 0 || pattern !== void 0 && !pattern.test(value)) {
    throw verificationEvidenceError(code, field);
  }
  return value;
}
function verificationNullableString(value, code, field) {
  if (value === null) {
    return null;
  }
  return verificationString(value, code, field);
}
function verificationPositiveInteger(value, code, field) {
  if (!Number.isInteger(value) || value <= 0) {
    throw verificationEvidenceError(code, field);
  }
  return value;
}
function verificationNullableNonNegativeInteger(value, code, field) {
  if (value === null) {
    return null;
  }
  if (!Number.isInteger(value) || value < 0) {
    throw verificationEvidenceError(code, field);
  }
  return value;
}
function verificationInstant(value, code, field) {
  if (normalizeRfc3339Instant(value) === void 0) {
    throw verificationEvidenceError(code, field);
  }
  return value;
}
function parseVerificationLogEvidence(value, code, field) {
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
  if (!relativePath.startsWith("verification/") || relativePath.includes("\\") || relativePath.split("/").some((part) => part === "" || part === "." || part === "..")) {
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
function parseVerificationAttemptRecord(value) {
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
    ["implementation", "fix"]
  );
  const sourcePhase = requireEnum(
    roundRecord.sourcePhase,
    "round.sourcePhase",
    ["implementation", "fix"]
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
  const completedAt = record.completedAt === null ? null : verificationInstant(record.completedAt, code, "completedAt");
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
  const failureCategory = record.failureCategory === null ? null : requireEnum(
    record.failureCategory,
    "failureCategory",
    VERIFICATION_FAILURE_CATEGORIES
  );
  const retryOf = record.retryOf === null ? null : verificationString(record.retryOf, code, "retryOf", idPattern);
  const restartOf = record.restartOf === null ? null : verificationString(record.restartOf, code, "restartOf", idPattern);
  if (retryOf !== null && restartOf !== null) {
    throw verificationEvidenceError(code, "retryOf");
  }
  const stdout = parseVerificationLogEvidence(record.stdout, code, "stdout");
  const stderr = parseVerificationLogEvidence(record.stderr, code, "stderr");
  const durationFromInstants = completedAt === null ? null : Date.parse(completedAt) - Date.parse(startedAt);
  if (completedAt !== null && durationFromInstants !== durationMs || completedAt === null && durationMs !== null) {
    throw verificationEvidenceError(code, "durationMs");
  }
  if (status === "started" && (completedAt !== null || exitCode !== null || signal !== null || failureCategory !== null || stdout !== null || stderr !== null)) {
    throw verificationEvidenceError(code, "status");
  }
  if (status === "completed" && (completedAt === null || exitCode !== 0 || failureCategory !== null)) {
    throw verificationEvidenceError(code, "status");
  }
  if (status === "failed" && (completedAt === null || failureCategory === null || failureCategory === "command_exit" && (exitCode === null || exitCode === 0))) {
    throw verificationEvidenceError(code, "status");
  }
  if (status === "interrupted" && (completedAt === null || exitCode !== null || signal !== null || stdout !== null || stderr !== null)) {
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
var RUN_STATUSES = [
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
];
var ATTEMPT_KINDS = [
  "selection",
  "plan",
  "implementation",
  "fix",
  "review"
];
var WORKFLOW_ROUTES = [
  "quick-fix",
  "feature",
  "strict"
];
function evaluationError(message) {
  return new BanzaiError("INVALID_EVALUATION_SOURCE", message);
}
function observed(value) {
  return { value, evidence: "observed" };
}
function absent(legacy = false) {
  return { value: null, evidence: legacy ? "legacy_absent" : "unknown" };
}
function invalid() {
  return { value: null, evidence: "invalid" };
}
function notApplicable() {
  return { value: null, evidence: "not_applicable" };
}
function issue(issues, code, field) {
  issues.push({ code, field });
}
function sourceValue(record, key, field, issues, parse, options = {}) {
  if (!Object.hasOwn(record, key)) {
    if (options.required ?? true) {
      issue(
        issues,
        options.legacyAbsent === true ? "LEGACY_FIELD_ABSENT" : "STATE_FIELD_MISSING",
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
  if (parsed === void 0) {
    issue(issues, "STATE_FIELD_INVALID", field);
    return invalid();
  }
  return observed(parsed);
}
function stringValue(value) {
  return typeof value === "string" && value.length > 0 ? value : void 0;
}
function contractVersionValue(value) {
  return typeof value === "string" && value.length <= 64 && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(value) ? value : void 0;
}
function nonNegativeNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : void 0;
}
function nonNegativeInteger(value) {
  const parsed = nonNegativeNumber(value);
  return parsed !== void 0 && Number.isInteger(parsed) ? parsed : void 0;
}
function enumValue(value, values) {
  return typeof value === "string" && values.includes(value) ? value : void 0;
}
var RFC3339_INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|([+-])(\d{2}):(\d{2}))$/;
function daysInMonth(year, month) {
  if (month === 2) {
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    return leap ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}
function normalizeRfc3339Instant(value) {
  if (typeof value !== "string") {
    return void 0;
  }
  const match = RFC3339_INSTANT.exec(value);
  if (match === null) {
    return void 0;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = Number(match[9] ?? 0);
  const offsetMinute = Number(match[10] ?? 0);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month) || hour > 23 || minute > 59 || second > 59 || offsetHour > 23 || offsetMinute > 59) {
    return void 0;
  }
  const instant = new Date(value);
  return Number.isFinite(instant.getTime()) ? instant.toISOString() : void 0;
}
function rfc3339Value(value) {
  return normalizeRfc3339Instant(value) === void 0 ? void 0 : value;
}
function metricValue(record, key, field, issues, legacyAbsent = false, nullable = false) {
  if (record === null) {
    return absent(legacyAbsent);
  }
  return sourceValue(record, key, field, issues, nonNegativeNumber, {
    legacyAbsent,
    nullable
  });
}
function childRecord(value, field, issues, legacyAbsent = false) {
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
function emptyStateMetrics(legacy, issues) {
  const missing = () => absent(legacy);
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
function parseStateMetrics(value, schemaVersion, issues) {
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
function parseVerificationSource(value, index, issues) {
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
  let signalPresent;
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
function triageCounts(records, issues, field) {
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
      ]);
      if (disposition === void 0) {
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
function parseEvaluationStateSource(value) {
  if (!isRecord(value)) {
    throw evaluationError("Persisted state is not a supported object.");
  }
  if (value.schemaVersion !== 1 && value.schemaVersion !== 2 && value.schemaVersion !== 3 && value.schemaVersion !== 4) {
    throw new BanzaiError(
      "EVALUATION_STATE_SCHEMA_UNSUPPORTED",
      "Persisted state uses an unsupported schema."
    );
  }
  const schemaVersion = value.schemaVersion;
  const issues = [];
  let workflow;
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
  const verification = [];
  let verificationList;
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
  let triage;
  let triageIsCumulative;
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
    triage = value.triage === null || value.triage === void 0 ? { accepted: 0, rejected: 0, deferred: 0 } : triageCounts([value.triage], issues, "triage");
    triageIsCumulative = false;
  }
  let activeAttemptIdentity;
  let activeAttemptKind;
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
  let activeVerification;
  if (value.activeProcess === null) {
    activeVerification = observed(false);
  } else if (isRecord(value.activeProcess)) {
    const kind = enumValue(value.activeProcess.kind, [
      ...ATTEMPT_KINDS,
      "verification"
    ]);
    if (kind === void 0) {
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
  let appliedReviewIteration;
  if (value.latestReview === null) {
    appliedReviewIteration = observed(0);
  } else if (isRecord(value.latestReview)) {
    const iteration = nonNegativeInteger(value.latestReview.iteration);
    const resultPath = stringValue(value.latestReview.resultPath);
    if (iteration === void 0 || iteration < 1 || resultPath !== `reviews/review-${iteration}.json`) {
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
      contractVersion: sourceValue(
        value,
        "contractVersion",
        "contractVersion",
        issues,
        contractVersionValue
      ),
      status: sourceValue(
        value,
        "status",
        "status",
        issues,
        (item) => enumValue(item, RUN_STATUSES)
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
export {
  parseCurrentReviewResult,
  parseEvaluationStateSource,
  parseModelAttemptRecord,
  parsePersistedPhaseResult,
  parseRecoveryAuthorization,
  parseReviewResult,
  parseTerminalAttemptCheckpoint,
  parseVerificationAttemptRecord
};
