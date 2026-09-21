import type { ReviewConfigurationSetup } from "./configuration-review.js";
import type {
  TaskVerificationPublication,
  TaskVerificationCandidates,
  TaskVerificationPolicy,
  VerificationPolicy,
  ReviewVerificationEvidence,
  VerificationPhysicalAttempt,
  VerificationDecision,
  VerificationApplicability
} from "./verification-evidence.js";
import type { ArtifactBoundWork } from "./artifact-storage.js";
import type {
  ConfigurationAction,
  ConfigurationPrerequisiteRequest,
  ConfigurationDecisionRecord,
  ConfigurationSetupState
} from "./configuration-prerequisite.js";
import type {
  WorkspaceEntry,
  WorkspaceSnapshot,
  WorkspaceChange
} from "./git.js";

export const CONTRACT_VERSION = "1.0.0" as const;
export const PHASE_RESULT_SCHEMA_VERSION = 4 as const;
export const TASK_PHASE_RESULT_SCHEMA_VERSION = 4 as const;
export const DECISION_CONSULTATION_SCHEMA =
  "banzai-decision-consultation/v1" as const;
export const DECISION_CONSULTATION_SCHEMA_VERSION = 1 as const;
export const PLAN_TASK_COMPLETION_SCHEMA_VERSION = 1 as const;
export const EVALUATION_EXPORT_SCHEMA = "banzai-evaluation-export/v1" as const;
export const EVALUATION_EXPORT_SCHEMA_VERSION = 1 as const;
export const EVALUATION_KPI_SCHEMA = "banzai-evaluation-kpi/v1" as const;
export const EVALUATION_KPI_SCHEMA_VERSION = 1 as const;
export const CONTEXT_ATTEMPT_SCHEMA = "banzai-context-attempt/v1" as const;
export const CONTEXT_ATTEMPT_SCHEMA_VERSION = 1 as const;
export const CONTEXT_REPORT_SCHEMA = "banzai-context-report/v1" as const;
export const CONTEXT_REPORT_SCHEMA_VERSION = 1 as const;
export const PROMPT_COMPONENT_CATEGORY_ORDER = [
  "common_instructions",
  "phase_instructions",
  "user_request_scope",
  "human_decisions",
  "approved_requirements_architecture",
  "verification_evidence",
  "workspace_evidence",
  "completion_evidence",
  "review_triage_evidence",
  "recovery_instructions",
  "output_contract"
] as const;
export const VERIFICATION_LEDGER_SCHEMA_VERSION = 1 as const;
export const MODEL_ATTEMPT_SCHEMA_VERSION = 2 as const;
/** Strict implementation/fix attempts created under runner-owned completion (ADR-0047). */
export const STRICT_MODEL_ATTEMPT_SCHEMA_VERSION = 3 as const;
export const TERMINAL_CHECKPOINT_SCHEMA =
  "banzai-terminal-attempt-checkpoint/v1" as const;
export const TERMINAL_CHECKPOINT_SCHEMA_VERSION = 1 as const;
export const TERMINAL_CHECKPOINT_SCHEMA_V2 =
  "banzai-terminal-attempt-checkpoint/v2" as const;
export const TERMINAL_CHECKPOINT_SCHEMA_VERSION_V2 = 2 as const;
/**
 * Lifecycle/ownership protocol persisted on every new strict implementation or
 * accepted-finding fix attempt before invocation. Distinct from the receipt
 * record schema below: the protocol selects semantics, the schema a shape.
 */
export const COMPLETION_PROTOCOL = "banzai-completion-protocol/v1" as const;
export const COMPLETION_CAPTURE_SCHEMA =
  "banzai-completion-capture/v1" as const;
export const COMPLETION_TRANSITION_SCHEMA =
  "banzai-completion-transition/v1" as const;
export const COMPLETION_CANDIDATE_SCHEMA =
  "banzai-completion-candidate/v1" as const;
export const COMPLETION_PUBLICATION_SCHEMA =
  "banzai-completion-publication/v1" as const;
export const COMPLETION_RECORD_SCHEMA_VERSION = 1 as const;
export const COMPLETION_SUMMARY_SCHEMA_VERSION = 2 as const;
export const RUN_STATE_SCHEMA_VERSION = 8 as const;
export const COMPLETION_PUBLICATION_STAGES = [
  "capture",
  "validate",
  "render",
  "candidate",
  "publication",
  "receipt",
  "attempt",
  "state",
  "event"
] as const;
export const COMPLETION_PUBLICATION_REFUSAL_CODES = [
  "COMPLETION_PUBLICATION_IO",
  "COMPLETION_PUBLICATION_DRIFT",
  "COMPLETION_PUBLICATION_INTEGRITY"
] as const;
export type CompletionPublicationStage =
  (typeof COMPLETION_PUBLICATION_STAGES)[number];
export type CompletionPublicationRefusalCode =
  (typeof COMPLETION_PUBLICATION_REFUSAL_CODES)[number];
export const RECOVERY_AUTHORIZATION_SCHEMA =
  "banzai-recovery-authorization/v1" as const;
export const RECOVERY_AUTHORIZATION_SCHEMA_VERSION = 1 as const;
export const RESULT_DIGEST_EVIDENCE_SCHEMA =
  "banzai-result-digest-evidence/v1" as const;
export const RESULT_DIGEST_EVIDENCE_SCHEMA_VERSION = 1 as const;
export const AGENT_CONTROL_CONTRACT_VERSION = "6.0.0" as const;
export const AGENT_CAPABILITIES_SCHEMA_VERSION = 6 as const;
export const AGENT_STATUS_SCHEMA_VERSION = 5 as const;
export const AGENT_ANSWER_SCHEMA_VERSION = 2 as const;
export const AGENT_REQUEST_SCHEMA_VERSION = 1 as const;
export const AGENT_RECOVERY_SCHEMA_VERSION = 1 as const;
export const LEGACY_AGENT_CONTROL_SCHEMA_VERSION = 1 as const;
export const AGENT_CAPABILITIES_SCHEMA =
  "banzai-agent-capabilities/v6" as const;
export const AGENT_STATUS_SCHEMA = "banzai-agent-status/v5" as const;
export const AGENT_REQUEST_SCHEMA = "banzai-agent-request/v1" as const;
export const AGENT_ANSWER_SCHEMA = "banzai-agent-answer/v2" as const;
export const CONFIGURATION_ANSWER_SCHEMA = "banzai-agent-answer/v3" as const;
export const CONFIGURATION_ANSWER_SCHEMA_VERSION = 3 as const;
export const AGENT_RECOVERY_SCHEMA = "banzai-agent-recovery/v1" as const;
export const LEGACY_AGENT_CAPABILITIES_SCHEMA =
  "banzai-agent-capabilities/v1" as const;
export const LEGACY_AGENT_STATUS_SCHEMA = "banzai-agent-status/v1" as const;
export const LEGACY_AGENT_ANSWER_SCHEMA = "banzai-agent-answer/v1" as const;

export type AgentControlOperationName =
  | "status"
  | "start"
  | "answer"
  | "approveAdr"
  | "approvePlan"
  | "approveVerification"
  | "triage"
  | "resume"
  | "retry"
  | "recover"
  | "cancel";

export interface AgentControlOperationV2 {
  supported: true;
  ttyRequired: false;
  inputSchemas: (
    | typeof AGENT_REQUEST_SCHEMA
    | typeof AGENT_ANSWER_SCHEMA
    | typeof CONFIGURATION_ANSWER_SCHEMA
    | typeof LEGACY_AGENT_ANSWER_SCHEMA
    | typeof AGENT_RECOVERY_SCHEMA
  )[];
}

export interface AgentControlCapabilitiesV5 {
  schema: typeof AGENT_CAPABILITIES_SCHEMA;
  schemaVersion: typeof AGENT_CAPABILITIES_SCHEMA_VERSION;
  controlContractVersion: typeof AGENT_CONTROL_CONTRACT_VERSION;
  orchestratorVersion: string;
  umbrellaContractVersion: typeof CONTRACT_VERSION;
  artifactStorage: {
    declarationSchemas: ["banzai-artifact-layout/v1"];
    bindingSchemas: ["banzai-work-binding/v1", "banzai-work-binding/v2"];
    privateWorkspaceSnapshotVersion: 2;
    layouts: readonly ["legacy", "private"];
  };
  configurationPrerequisite: {
    kind: "configuration_prerequisite";
    actions: readonly ["accept", "edit", "skip", "cancel"];
    statusSchema: typeof AGENT_STATUS_SCHEMA;
    answerSchema: typeof CONFIGURATION_ANSWER_SCHEMA;
  };
  /** Runner-owned completion publication declared by the status projection. */
  completionPublication: {
    protocol: typeof COMPLETION_PROTOCOL;
    stages: typeof COMPLETION_PUBLICATION_STAGES;
    refusalCodes: typeof COMPLETION_PUBLICATION_REFUSAL_CODES;
    statusSchema: typeof AGENT_STATUS_SCHEMA;
  };
  operations: Record<AgentControlOperationName, AgentControlOperationV2>;
}

export interface AgentControlRequestV1 {
  schema: typeof AGENT_REQUEST_SCHEMA;
  schemaVersion: typeof AGENT_REQUEST_SCHEMA_VERSION;
  request: string;
}

export interface AgentControlAnswerV1 {
  schema: typeof LEGACY_AGENT_ANSWER_SCHEMA;
  schemaVersion: typeof LEGACY_AGENT_CONTROL_SCHEMA_VERSION;
  answers: string[];
}

export interface AgentControlAnswerV2 {
  schema: typeof AGENT_ANSWER_SCHEMA;
  schemaVersion: typeof AGENT_ANSWER_SCHEMA_VERSION;
  runId: string;
  requestId: string;
  roundId: string;
  answers: DecisionConsultationAnswer[];
}

export interface AgentControlAnswerV3 {
  schema: typeof CONFIGURATION_ANSWER_SCHEMA;
  schemaVersion: typeof CONFIGURATION_ANSWER_SCHEMA_VERSION;
  kind: "configuration_prerequisite";
  runId: string;
  decisionId: string;
  proposalId: string;
  action: ConfigurationAction;
  profile?: { id: string; commands: VerificationCommand[] };
}

export interface AgentControlRecoveryV1 {
  schema: typeof AGENT_RECOVERY_SCHEMA;
  schemaVersion: typeof AGENT_RECOVERY_SCHEMA_VERSION;
  attemptId: string;
  recoveryIdentity: string;
  unknownSideEffectsAccepted: true;
}

export type AgentControlNextActionV1 =
  | "approve_adr"
  | "approve_plan"
  | "answer"
  | "triage"
  | "resume"
  | "retry"
  | "recover"
  | "cancel"
  | null;

export type AgentControlNextAction =
  | Exclude<AgentControlNextActionV1, "answer">
  | "answer_escalation"
  | "answer_consultation"
  | "answer_configuration_prerequisite";

export type AgentControlPendingGateV1 =
  | {
      kind: "adr_approval";
      artifactPaths: string[];
      adrIds: string[];
    }
  | {
      kind: "plan_approval";
      artifactPaths: string[];
    }
  | {
      kind: "escalation";
      phase: Phase;
      summary: string;
      questions: string[];
    }
  | {
      kind: "review_triage";
      iteration: number;
      artifactPath: string | null;
      findings: {
        id: string;
        severity: ReviewFinding["severity"];
        category: ReviewFinding["category"];
        summary: string;
        evidencePath: string | null;
      }[];
    };

export type AgentControlPendingGateV2 =
  | AgentControlPendingGateV1
  | {
      kind: "decision_consultation";
      phase: "plan";
      summary: string;
      runId: string;
      request: DecisionConsultationRequest;
    };

export interface AgentControlRunV1 {
  runId: string;
  slug: string;
  state: RunStatus;
  route: {
    workflow: WorkflowRoute;
    reason: string;
  } | null;
  nextAction: AgentControlNextActionV1;
  blocked: {
    from: Exclude<RunStatus, "blocked"> | null;
    reason: string;
  } | null;
  retry: {
    eligible: boolean;
    reason: string;
    attemptId: string | null;
  };
  recovery: {
    eligible: boolean;
    reason: string;
    warning: string;
    attemptId: string | null;
    phase: Phase | null;
    authorization: "plan_approval" | "workflow_selection" | null;
    recoveryIdentity: string | null;
    workspace: {
      added: number;
      modified: number;
      deleted: number;
      total: number;
    } | null;
  };
  pendingGate: AgentControlPendingGateV1 | null;
  approval: {
    planValid: boolean | null;
    reviewSnapshotValid: boolean | null;
  };
  taskCompletion: {
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
  };
  verification: {
    total: number;
    passed: number;
    failed: number;
    results: {
      ordinal: number;
      outcome: "pass" | "fail";
      exitCode: number;
      signal: string | null;
    }[];
  };
  review: {
    iteration: number;
    verdict: ReviewVerdict;
    artifactPath: string | null;
    completion:
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
  } | null;
}

export type AgentControlPendingGateV3 =
  | AgentControlPendingGateV2
  | {
      kind: "configuration_prerequisite";
      runId: string;
      decisionId: string;
      proposalId: string;
      requestedAt: string;
      reason: ConfigurationPrerequisiteRequest["reason"];
      proposal: ConfigurationPrerequisiteRequest["proposal"];
      options: ConfigurationPrerequisiteRequest["options"];
      checkpoint: {
        attemptKind: "implementation" | "fix";
        verificationRound: number;
        eligible: boolean;
      };
      repairCommands: string[];
    };

export interface AgentControlRunV3 extends Omit<
  AgentControlRunV1,
  "nextAction" | "pendingGate"
> {
  nextAction: AgentControlNextAction;
  pendingGate: AgentControlPendingGateV3 | null;
}

/**
 * Bounded runner-owned completion publication state. `stage` names the last
 * durable stage; a refusal names the closed code and the last proof digest.
 * `publisherAttemptId` is the attempt that published the current canonical
 * completion section, which may differ from the ledger author.
 */
export interface AgentControlCompletionPublicationV1 {
  attemptId: string;
  attemptKind: "implementation" | "fix";
  stage: CompletionPublicationStage;
  refusalCode: CompletionPublicationRefusalCode | null;
  publisherAttemptId: string | null;
}

export interface AgentControlRunV4 extends AgentControlRunV3 {
  completionPublication: AgentControlCompletionPublicationV1 | null;
  taskVerification?: {
    outcome: "checked" | "absent" | "not_run";
    complete: boolean;
    absenceReason: string | null;
    checks: {
      checkId: string;
      required: boolean;
      kind: string;
      attemptId: string | null;
    }[];
  };
}

export interface AgentControlStatusV1 {
  schema: typeof LEGACY_AGENT_STATUS_SCHEMA;
  schemaVersion: typeof LEGACY_AGENT_CONTROL_SCHEMA_VERSION;
  activeRun: AgentControlRunV1 | null;
}

export interface AgentControlStatusV4 {
  schema: typeof AGENT_STATUS_SCHEMA;
  schemaVersion: typeof AGENT_STATUS_SCHEMA_VERSION;
  activeRun: AgentControlRunV4 | null;
}

export type Phase = "plan" | "implementation" | "fix";
export type Gate =
  | "adr_approval"
  | "plan_approval"
  | "escalation"
  | "decision_consultation"
  | null;
export type PhaseOutcome = "completed" | "needs_human_decision" | "blocked";
export type WorkflowRoute = "quick-fix" | "feature" | "strict";
export type WorkflowConfidence = "high" | "medium" | "low";
export type ReviewVerdict =
  "pass" | "changes_requested" | "replan_required" | "blocked";
export type FindingDisposition = "accepted" | "rejected" | "deferred";
export type SessionMode = "fresh" | "resumed";
export type ReviewMode = "full" | "delta";
export type EvaluationRotationReason =
  | "primary-review"
  | "missing-session"
  | "legacy-state"
  | "settings-changed"
  | "approval-changed"
  | "previous-review-failed"
  | "previous-review-interrupted"
  | "previous-review-blocked"
  | "accepted-high-risk-finding"
  | "delta-limit-reached"
  | "session-inventory-changed"
  | "unreliable-review";

export type ReviewRotationReason =
  EvaluationRotationReason | "output-contract-not-reusable";

export interface WorkflowSelectionResult {
  contractVersion: typeof CONTRACT_VERSION;
  recommendedWorkflow: WorkflowRoute;
  confidence: WorkflowConfidence;
  reason: string;
  escalationTriggers: string[];
}

export interface WorkflowSelectionRecord extends WorkflowSelectionResult {
  workflow: WorkflowRoute;
  selectedAt: string;
  attemptId: string;
  digest: string;
}

export interface PhaseArtifacts {
  description: string | null;
  plan: string | null;
  adrs: string[];
  implementationReport: string | null;
  testReport: string | null;
}

export type DecisionResponseMode = "single_choice" | "free_text";

export interface DecisionConsultationEvidence {
  path: string;
  line: number | null;
  detail: string;
}

export interface DecisionConsultationOption {
  optionId: string;
  title: string;
  benefits: string[];
  costs: string[];
  risks: string[];
  consequences: string[];
}

export interface DecisionConsultationCard {
  decisionId: string;
  title: string;
  question: string;
  why: string;
  affectedRequirements: string[];
  evidence: DecisionConsultationEvidence[];
  decisionOwner: "human";
  responseMode: DecisionResponseMode;
  options: DecisionConsultationOption[];
  recommendation: {
    optionId: string;
    rationale: string;
  } | null;
}

export interface DecisionConsultationRequest {
  schema: typeof DECISION_CONSULTATION_SCHEMA;
  schemaVersion: typeof DECISION_CONSULTATION_SCHEMA_VERSION;
  requestId: string;
  roundId: string;
  decisions: DecisionConsultationCard[];
}

export interface DecisionConsultationAnswer {
  decisionId: string;
  response: {
    kind: "option" | "preference";
    optionId: string | null;
    text: string | null;
  };
  note: string | null;
}

export type PlanTaskCompletionStatus = "completed" | "incomplete" | "blocked";

export interface CompletionEvidenceReference {
  path: string;
  detail: string;
}

export interface CompletionGapReference {
  reportPath: string;
  section: string;
  detail: string;
}

export interface PlanTaskCompletionRecord {
  taskId: string;
  status: PlanTaskCompletionStatus;
  evidence: CompletionEvidenceReference[];
  gap: CompletionGapReference | null;
}

export interface PlanTaskCompletionLedger {
  schemaVersion: typeof PLAN_TASK_COMPLETION_SCHEMA_VERSION;
  tasks: PlanTaskCompletionRecord[];
}

export interface PhaseResult {
  schemaVersion: typeof PHASE_RESULT_SCHEMA_VERSION | 3;
  /** Required (nullable) in v4, absent in v3. */
  verificationCandidates?: TaskVerificationCandidates | null;
  contractVersion: typeof CONTRACT_VERSION;
  phase: Phase;
  outcome: PhaseOutcome;
  gate: Gate;
  summary: string;
  artifacts: PhaseArtifacts;
  taskCompletion: PlanTaskCompletionLedger | null;
  touchedPaths: string[];
  questions: string[];
  decisionConsultation: DecisionConsultationRequest | null;
  resolvedFindingIds: string[];
  requestedVerification: string[];
}

export interface LegacyPhaseResult extends Omit<
  PhaseResult,
  "schemaVersion" | "decisionConsultation"
> {
  schemaVersion: 1 | 2;
}

export type PersistedPhaseResult = PhaseResult | LegacyPhaseResult;

/**
 * The taskCompletion field of a safely decoded phase-result envelope. Under the
 * runner-owned completion protocol a malformed ledger never discards a valid
 * stop envelope; it stays an unaccepted bounded diagnostic beside the original.
 */
export type EnvelopeTaskCompletion =
  | { state: "accepted"; ledger: PlanTaskCompletionLedger | null }
  | {
      state: "unaccepted";
      diagnostic: string;
      /** Bounded canonical JSON prefix of the rejected value. */
      raw: string;
      rawDigest: string;
    };

/**
 * A phase result whose envelope (keys, versions, phase, outcome/gate pairing,
 * artifacts, questions, paths and finding identities) validated independently
 * of its completion ledger. `original` is the canonical JSON of the exact
 * structured output the vendor returned; `originalDigest` identifies it.
 */
export interface PhaseResultEnvelope extends Omit<
  PhaseResult,
  "taskCompletion"
> {
  taskCompletion: EnvelopeTaskCompletion;
  original: string;
  originalDigest: string;
}

export interface ReviewEvidence {
  path: string;
  line: number | null;
  detail: string;
}

export interface ReviewFinding {
  id: string;
  severity: "blocker" | "should_fix" | "nit";
  category:
    | "spec"
    | "plan"
    | "adr"
    | "correctness"
    | "test"
    | "security"
    | "maintainability"
    | "documentation";
  summary: string;
  evidence: ReviewEvidence[];
  violates: string[];
  reproduction: string | null;
  fixAcceptance: string;
  confidence: "high" | "medium" | "low";
}

export interface ReviewResult {
  /** Absent on historical v1 evidence only. Current ingress requires v2. */
  schemaVersion?: 2;
  contractVersion: typeof CONTRACT_VERSION;
  verdict: ReviewVerdict;
  summary: string;
  findings: ReviewFinding[];
  reviewedFindingIds: string[];
  deferredCoverage: string[];
  reviewNotes?: string[];
  scopeAcknowledgment?: ReviewScopeAcknowledgment;
}

export interface ReviewScopeAcknowledgment {
  schemaVersion: 1;
  snapshotDigest: string;
  artifacts: {
    path: string;
    status: "reviewed" | "not_reviewed";
    reason: string | null;
  }[];
}

export interface CurrentReviewResult extends ReviewResult {
  schemaVersion: 2;
  reviewNotes: string[];
  scopeAcknowledgment: ReviewScopeAcknowledgment;
}

export type ReviewArtifactMode = "reviewer-write" | "runner-rendered";

export type ReviewCandidateValidation = "pending" | "passed" | "failed";

export interface ReviewCandidateEvidence {
  source: ReviewArtifactMode;
  evidencePath: string;
  intendedArtifactPath: string;
  sha256: string | null;
  validation: ReviewCandidateValidation;
  validationCode: string | null;
  validationError: string | null;
  canonical: false;
}

export interface ReviewArtifactContext {
  snapshot?: ReviewSnapshot;
  verificationEvidence?: ReviewVerificationEvidence;
  path: string;
  candidatePath: string;
  slug: string;
  iteration: number;
  approvedArtifactPaths: string[];
  workspaceDigest: string;
  verification: VerificationResult[];
  taskCompletion?: {
    approvalDigest: string;
    ledgerDigest: string;
    planTaskDigest: string;
    completed: number;
    total: number;
    implementationReport: string;
    testReport: string;
    tasks: PlanTaskCompletionRecord[];
  } | null;
}

/** Frozen identities of the runner-published completion proof reviewed by a v5 snapshot. */
export interface ReviewCompletionPublication {
  completionProtocol: typeof COMPLETION_PROTOCOL;
  publisherAttemptId: string;
  receiptPath: string;
  receiptDigest: string;
  captureDigest: string;
  candidateDigest: string;
}

export interface ReviewSnapshot {
  schema:
    | "banzai-review-snapshot/v1"
    | "banzai-review-snapshot/v2"
    | "banzai-review-snapshot/v3"
    | "banzai-review-snapshot/v4"
    | "banzai-review-snapshot/v5"
    | "banzai-review-snapshot/v6";
  schemaVersion: 1 | 2 | 3 | 4 | 5 | 6;
  verificationMode?: "ordered" | "policy" | "task";
  taskVerification?: TaskVerificationPublication;
  configurationSetup?: ReviewConfigurationSetup;
  /** Required and nullable on snapshot v5 only. */
  completionPublication?: ReviewCompletionPublication | null;
  artifactBinding?: ArtifactBoundWork;
  runId: string;
  attemptId: string;
  outputContract: "review-result/v2";
  baseCommit: string;
  approval: ApprovalRecord;
  approvedArtifacts: { path: string; sha256: string }[];
  workspace: WorkspaceSnapshot;
  reviewMode: ReviewMode;
  changes: WorkspaceChange[];
  anchor: ReviewReference | null;
  fullReviewAnchor: {
    iteration: number;
    sessionId: string;
    approvalDigest: string;
    outputContract: "review-result/v2";
  } | null;
  triage: TriageRecord[];
  requiredFindingIds: string[];
  completionSource: ValidPlanTaskCompletionSummary | null;
  artifact: Omit<ReviewArtifactContext, "snapshot">;
  digest: string;
}

export interface ModelSettings {
  executable: string;
  model: string;
  // "ultra" is a Codex-only reasoning level; Claude models reject it.
  effort: "low" | "medium" | "high" | "xhigh" | "max" | "ultra";
  timeoutMs: number;
}

/**
 * How much of the operator's ambient Claude Code installation a Banzai-spawned
 * process may discover. "scoped" isolates MCP and setting sources while
 * re-supplying the packaged Banzai plugin; "ambient" reproduces the invocation
 * Banzai used before ADR 0020.
 */
export type ClaudeEnvironmentMode = "scoped" | "ambient";

export interface ClaudeEnvironmentSettings {
  mode: ClaudeEnvironmentMode;
  // An explicit directory fails closed when it cannot be verified; null means
  // resolve the plugin shipped beside the running orchestrator.
  pluginDirectory: string | null;
}

/**
 * The resolved per-process shape. `settingSources` is never non-null without a
 * `pluginDirectory`: scoping discovery without re-supplying the Banzai plugin
 * would disable its skills and its enforcement hook.
 */
/** One stdio MCP server, in vendor-neutral form. */
export interface McpStdioServer {
  command: string;
  args: string[];
  env: Record<string, string>;
  startupTimeoutSec: number | null;
}

/**
 * The availability-gated MCP whitelist for one run. A null entry means that
 * vendor runs with no MCP servers, exactly as before; `notes` say why, once,
 * at resolution time.
 */
export interface McpWhitelist {
  claude: McpStdioServer | null;
  codex: McpStdioServer | null;
  notes: string[];
}

export interface ClaudeInvocationScope {
  strictMcpConfig: boolean;
  settingSources: string | null;
  pluginDirectory: string | null;
  /**
   * Present only when the workflow resolved a whitelist. Under a strict scope
   * the Claude builder re-admits exactly these servers via `--mcp-config`, and
   * the Codex builder pins them via `-c mcp_servers=...`; absent, both vendors
   * keep their prior argument vectors byte-for-byte.
   */
  mcp?: McpWhitelist | undefined;
}

/**
 * Tool inventory a vendor session reported for itself. Tool definitions lead the
 * cached prefix, so a changed inventory invalidates the whole cache on resume.
 */
export interface SessionInventory {
  toolCount: number;
  digest: string;
  mcpServerCount?: number;
  skillCount?: number;
  commandCount?: number;
}

/**
 * Why a model process failed, derived from structured vendor evidence rather
 * than message text. Only "unclassified" and integrity failures justify
 * discarding reviewer continuity.
 */
export type ModelFailureCause =
  "capacity" | "timeout" | "process_start" | "transport" | "unclassified";

export type SessionRole = "planner" | "implementer" | "reviewer";

export type ContextWorkflow = WorkflowRoute | "unselected";
export type ContextInvocationKind = "primary" | "review_artifact_repair";
export type PromptComponentCategory =
  | "common_instructions"
  | "phase_instructions"
  | "user_request_scope"
  | "human_decisions"
  | "approved_requirements_architecture"
  | "verification_evidence"
  | "workspace_evidence"
  | "completion_evidence"
  | "review_triage_evidence"
  | "recovery_instructions"
  | "output_contract";

export interface PromptComponent {
  category: Exclude<PromptComponentCategory, "output_contract">;
  text: string;
}

export interface PromptEnvelope {
  rendered: string;
  components: PromptComponent[];
}

export type OutputContractIdentity =
  | "workflow-selection/v1"
  | "phase-result/v3"
  | "phase-result/v4"
  | "review-result/v1"
  | "review-result/v2";

export interface OutputContractEnvelope {
  vendor: "codex" | "claude";
  identity: OutputContractIdentity;
  serialized: string;
}

export type ContextAuthorityClass =
  | "project_instructions"
  | "project_manifest"
  | "feature_description"
  | "architecture_decision"
  | "development_plan"
  | "implementation_report"
  | "test_report"
  | "review_artifact"
  | "human_decision"
  | "verification_profile";

export interface ContextAuthorityEntry {
  class: ContextAuthorityClass;
  count: number;
}

export type ContextMetric =
  | "runner_payload_bytes"
  | "vendor_input_tokens"
  | "vendor_cached_input_tokens"
  | "vendor_output_tokens"
  | "vendor_cost_usd"
  | "vendor_turns"
  | "session_tools"
  | "session_mcp_servers"
  | "session_skills"
  | "session_commands";

export interface ContextLimit {
  metric: ContextMetric;
  phase: AttemptReference["kind"] | null;
  role: SessionRole | null;
  maximum: number;
}

export interface ContextPolicy {
  mode: "observe" | "enforce";
  limits: ContextLimit[];
}

export type ContextObserved<T> =
  | { availability: "available"; value: T }
  | { availability: "unavailable"; value: null };

export interface ContextPayloadComponent {
  category: PromptComponentCategory;
  bytes: number;
}

export interface ContextRunnerPayload {
  promptBytes: number;
  outputSchemaBytes: number;
  totalBytes: number;
  components: ContextPayloadComponent[];
}

export interface ContextInventoryEvidence {
  toolCount: ContextObserved<number>;
  mcpServerCount: ContextObserved<number>;
  skillCount: ContextObserved<number>;
  commandCount: ContextObserved<number>;
  digest: ContextObserved<string>;
}

export interface ContextVendorEvidence {
  inputTokens: ContextObserved<number>;
  cachedInputTokens: ContextObserved<number>;
  outputTokens: ContextObserved<number>;
  costUsd: ContextObserved<number>;
  turns: ContextObserved<number>;
}

export interface ContextBudgetEvaluation {
  metric: ContextMetric;
  selector: {
    phase: AttemptReference["kind"] | null;
    role: SessionRole | null;
  };
  maximum: number;
  observed: ContextObserved<number>;
  result:
    "within_limit" | "observed_exceeded" | "enforced_exceeded" | "unavailable";
}

export interface ContextInvocationEvidence {
  ordinal: number;
  kind: ContextInvocationKind;
  workflow: ContextWorkflow;
  phase: AttemptReference["kind"];
  role: SessionRole;
  vendor: "codex" | "claude";
  sessionMode: SessionMode;
  measuredAt: string;
  completedAt: string | null;
  outcome: "pending" | "completed" | "failed" | "budget_exceeded";
  runnerPayload: ContextRunnerPayload;
  authority: ContextAuthorityEntry[];
  sessionInventory: ContextInventoryEvidence;
  vendorUsage: ContextVendorEvidence;
  budgets: ContextBudgetEvaluation[];
}

export interface ContextAttemptLedger {
  schema: typeof CONTEXT_ATTEMPT_SCHEMA;
  schemaVersion: typeof CONTEXT_ATTEMPT_SCHEMA_VERSION;
  runId: string;
  attempt: AttemptReference;
  invocations: ContextInvocationEvidence[];
}

export interface ContextCoverage {
  exact: number;
  incomplete: number;
}

export interface ContextNumericAggregate {
  total: number | null;
  mean: number | null;
  maximum: number | null;
  observed: number;
  unavailable: number;
}

export interface ContextCategoryAggregate {
  category: PromptComponentCategory;
  bytes: number;
}

export interface ContextBudgetAggregate {
  metric: ContextMetric;
  maximum: number;
  withinLimit: number;
  observedExceeded: number;
  enforcedExceeded: number;
  unavailable: number;
}

export interface ContextReportGroup {
  workflow: ContextWorkflow;
  phase: AttemptReference["kind"];
  role: SessionRole;
  attemptCoverage: ContextCoverage;
  invocationCount: number;
  runnerPayload: ContextNumericAggregate;
  categories: ContextCategoryAggregate[];
  budgets: ContextBudgetAggregate[];
  vendorUsage: {
    inputTokens: ContextNumericAggregate;
    cachedInputTokens: ContextNumericAggregate;
    outputTokens: ContextNumericAggregate;
    costUsd: ContextNumericAggregate;
    turns: ContextNumericAggregate;
  };
  sessionInventory: {
    tools: ContextNumericAggregate;
    mcpServers: ContextNumericAggregate;
    skills: ContextNumericAggregate;
    commands: ContextNumericAggregate;
  };
}

export interface ContextReportCohort {
  from: string | null;
  to: string | null;
  requestedRunIds: string[];
  discoveredRunCount: number;
  includedRunCount: number;
  unresolvedRunIds: string[];
}

export interface ContextReport {
  schema: typeof CONTEXT_REPORT_SCHEMA;
  schemaVersion: typeof CONTEXT_REPORT_SCHEMA_VERSION;
  cohort: ContextReportCohort;
  coverage: ContextCoverage;
  groups: ContextReportGroup[];
}

export interface ModelSessionBinding {
  id: string;
  role: SessionRole;
  executable: string;
  model: string;
  effort: ModelSettings["effort"];
  // Absent on bindings written before ADR 0021; unknown, never mismatched.
  invocationDigest?: string;
  inventoryDigest?: string;
}

export type SessionContext = Omit<ModelSessionBinding, "id">;

export interface ReviewerSessionBinding extends ModelSessionBinding {
  outputContract?: "review-result/v1" | "review-result/v2";
  role: "reviewer";
  approvalDigest: string;
  lastSnapshot: WorkspaceSnapshot;
  lastFullIteration: number;
  consecutiveDeltaReviews: number;
}

export function sessionBindingMatches(
  binding: ModelSessionBinding | null,
  settings: ModelSettings,
  role: SessionRole
): binding is ModelSessionBinding {
  return (
    binding !== null &&
    binding.role === role &&
    binding.executable === settings.executable &&
    binding.model === settings.model &&
    binding.effort === settings.effort
  );
}

export interface VerificationCommand {
  id?: string;
  evidence?: "fresh" | "equivalent_evidence";
  ignoreExplanatory?: boolean;
  name: string;
  command: string;
  args: string[];
  timeoutMs: number;
}

export type VerificationProjectType =
  | "repository"
  | "node"
  | "php"
  | "python"
  | "go"
  | "rust"
  | "ruby"
  | "jvm"
  | "dotnet"
  | "custom";

export interface VerificationProfile {
  id: string;
  projectType: VerificationProjectType;
  commands: VerificationCommand[];
}

export interface OrchestratorConfig {
  schemaVersion: 1 | 2 | 3 | 4;
  contractVersion: typeof CONTRACT_VERSION;
  models: {
    planner: ModelSettings;
    implementer: ModelSettings;
    reviewer: ModelSettings;
  };
  verification: {
    profiles: VerificationProfile[];
    policy?: VerificationPolicy;
    taskPolicy?: TaskVerificationPolicy;
    bootstrap?: boolean;
  };
  claudeEnvironment: ClaudeEnvironmentSettings;
  context: ContextPolicy;
  maxFixCycles: number;
}

export type RunStatus =
  | "created"
  | "selecting"
  | "planning"
  | "needs_adr_approval"
  | "needs_plan_approval"
  | "needs_human_decision"
  | "plan_approved"
  | "implementing"
  | "verifying"
  | "reviewing"
  | "needs_triage"
  | "fixing"
  | "done"
  | "blocked"
  | "cancelled";

export interface ApprovalRecord {
  kind: "plan";
  digest: string;
  approvedAt: string;
  approvedBy: string;
  paths: string[];
}

export interface AdrDecision {
  id: string;
  decision: "accept" | "reject" | "rework";
  note: string | null;
  decidedAt: string;
  decidedBy: string;
}

export interface EscalationDecisionRequest {
  kind: "escalation";
  phase: Phase;
  gate: "escalation";
  summary: string;
  questions: string[];
  requestedAt: string;
}

export interface EscalationDecisionRecord extends EscalationDecisionRequest {
  answers: string[];
  decidedAt: string;
  decidedBy: string;
}

export interface ConsultationDecisionRequest {
  kind: "decision_consultation";
  phase: "plan";
  gate: "decision_consultation";
  summary: string;
  request: DecisionConsultationRequest;
  requestedAt: string;
}

export interface ConsultationDecisionRecord extends ConsultationDecisionRequest {
  runId: string;
  requestId: string;
  roundId: string;
  answers: DecisionConsultationAnswer[];
  decidedAt: string;
  decidedBy: string;
}

export type HumanDecisionRequest =
  | EscalationDecisionRequest
  | ConsultationDecisionRequest
  | ConfigurationPrerequisiteRequest;

export type HumanDecisionRecord =
  | EscalationDecisionRecord
  | ConsultationDecisionRecord
  | ConfigurationDecisionRecord;

export interface AttemptReference {
  id: string;
  kind: "selection" | "plan" | "implementation" | "fix" | "review";
  mutable: boolean;
}

export interface ActiveProcess {
  pid: number;
  kind: AttemptReference["kind"] | "verification";
  startedAt: string;
}

export interface ReviewReference {
  outputContract?: "review-result/v1" | "review-result/v2";
  iteration: number;
  resultPath: string;
  artifactPath?: string;
  workspaceDigest: string;
  verdict: ReviewVerdict;
  sessionMode: SessionMode;
  mode: ReviewMode;
  rotationReason: ReviewRotationReason | null;
}

export interface TriageItem {
  findingId: string;
  disposition: FindingDisposition;
  note: string | null;
}

export interface TriageRecord {
  reviewIteration: number;
  decidedAt: string;
  decidedBy: string;
  items: TriageItem[];
}

export interface VerificationResult {
  name: string;
  command: string;
  args: string[];
  exitCode: number;
  signal: string | null;
  stdoutPath: string;
  stderrPath: string;
  startedAt: string;
  completedAt: string;
}

export interface VerificationCommandDescriptor {
  profileId: string;
  projectType: VerificationProjectType;
  profileOrdinal: number;
  commandOrdinal: number;
  configurationDigest: string;
  command: VerificationCommand;
}

export interface VerificationLedger {
  schemaVersion: 1 | 2;
}

export type VerificationAttemptStatus =
  "started" | "completed" | "failed" | "interrupted";

export type VerificationAttemptFailureCategory =
  | "command_exit"
  | "process_start"
  | "timeout"
  | "output_limit"
  | "runner_failure";

export interface VerificationAttemptLogEvidence {
  relativePath: string;
  sha256: string;
}

export type VerificationAttemptRecord = VerificationPhysicalAttempt;

export interface ModelUsage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  costUsd: number | null;
}

export interface ModelProgressEvent {
  kind: "model" | "skill" | "action" | "usage";
  status: "started" | "completed" | "failed" | "info";
  detail: string;
  /**
   * The vendor's own identifier for this action, when it has one. It pairs a
   * completion with its start, which is what lets a presenter report duration
   * and name what is still running.
   */
  id?: string | undefined;
}

export interface RunMetrics {
  completedAttemptIds: string[];
  /** Consumption is counted once even if a failed attempt later reconciles. */
  usageAccountedAttemptIds?: string[];
  attempts: {
    selection?: number;
    plan: number;
    implementation: number;
    fix: number;
    review: number;
    verification: number;
  };
  modelDurationMs: number;
  usage: ModelUsage;
  reviewFindingCount: number;
  sessions: {
    fresh: number;
    resumed: number;
  };
  reviews: {
    full: number;
    delta: number;
    rotations: number;
  };
  triage: {
    accepted: number;
    rejected: number;
    deferred: number;
  };
}

export type PlanTaskCompletionViolation =
  | "approved_plan_invalid"
  | "missing_ledger"
  | "missing_task"
  | "duplicate_task"
  | "unknown_task"
  | "task_order_mismatch"
  | "invalid_task_status"
  | "task_status_conflict"
  | "invalid_evidence_path"
  | "missing_evidence_path"
  | "evidence_scope_violation"
  | "invalid_gap_reference"
  | "implementation_report_missing"
  | "test_report_missing"
  | "report_projection_missing"
  | "report_projection_invalid"
  | "report_projection_mismatch"
  | "report_region_invalid"
  | "approval_invalid"
  | "source_attempt_invalid"
  | "summary_mismatch";

export interface ValidPlanTaskCompletionSummary {
  /**
   * 1: model-authored v1 projection (ADR-0017/0025). 2: runner-published v2
   * completion region under the completion protocol (ADR-0047); the ledger
   * itself stays schema 1.
   */
  schemaVersion:
    | typeof PLAN_TASK_COMPLETION_SCHEMA_VERSION
    | typeof COMPLETION_SUMMARY_SCHEMA_VERSION;
  status: "valid";
  sourceAttemptId: string;
  /**
   * Which mutable phase authored the canonical ledger. Absent means
   * "implementation" (every checkpoint recorded before ADR 0025); "fix" marks
   * an accepted-finding fix that refreshed the evidence under the same
   * fail-closed validation.
   */
  sourceAttemptKind?: "implementation" | "fix";
  approvalDigest: string;
  planTaskDigest: string;
  ledgerDigest: string;
  implementationReport: { path: string; sha256: string };
  testReport: { path: string; sha256: string };
  counts: {
    total: number;
    completed: number;
    incomplete: number;
    blocked: number;
  };
  validatedAt: string;
  /** Required on schema 2: the protocol that published the completion region. */
  completionProtocol?: typeof COMPLETION_PROTOCOL;
  /**
   * Required on schema 2: the attempt whose publication receipt wrote the
   * current completion region. A completed null-ledger fix is a new publisher
   * of the unchanged ledger author's claims.
   */
  publisherAttemptId?: string;
  /** Required on schema 2: run-relative receipt path and its integrity digest. */
  publication?: { path: string; sha256: string };
}

export interface InvalidPlanTaskCompletionCheckpoint {
  schemaVersion:
    | typeof PLAN_TASK_COMPLETION_SCHEMA_VERSION
    | typeof COMPLETION_SUMMARY_SCHEMA_VERSION;
  status: "invalid";
  sourceAttemptId: string;
  /** Absent means "implementation" (pre-ADR-0025 checkpoints). */
  sourceAttemptKind?: "implementation" | "fix";
  errorCode: "PLAN_TASK_COMPLETION_INVALID";
  violation: PlanTaskCompletionViolation;
  taskId: string | null;
  recordedAt: string;
  /** Required on schema 2: the protocol under which the input was rejected. */
  completionProtocol?: typeof COMPLETION_PROTOCOL;
  /** Required on schema 2: bounded diagnostic and the rejected result identity. */
  diagnostic?: string;
  rejectedResultDigest?: string | null;
}

/**
 * Cache of immutable publication proof for the newest strict attempt on a
 * schema-7 run. It never reconstructs proof: every digest names a retained
 * attempt-owned record, and a null digest means that stage is not durable.
 */
export interface CompletionPublicationCursor {
  attemptId: string;
  attemptKind: "implementation" | "fix";
  stage: CompletionPublicationStage;
  captureDigest: string | null;
  candidateDigest: string | null;
  receiptDigest: string | null;
  refusal: {
    code: CompletionPublicationRefusalCode;
    stage: CompletionPublicationStage;
    proofDigest: string | null;
  } | null;
}

export type PlanTaskCompletionCheckpoint =
  ValidPlanTaskCompletionSummary | InvalidPlanTaskCompletionCheckpoint;

export interface CancellationAnchor {
  schemaVersion: 1;
  id: string;
  at: string;
}

export interface RunState {
  /**
   * 7 is reached only when the first strict implementation or fix attempt under
   * the completion protocol is created; new runs still bootstrap at 4 or 6 and
   * keep their configuration/binding combination unchanged across the move.
   */
  schemaVersion: 3 | 4 | 5 | 6 | 7 | 8;
  verificationMode?: "ordered" | "policy" | "task";
  taskVerification?: TaskVerificationPublication;
  configurationSetup?: ConfigurationSetupState;
  artifactBinding?: ArtifactBoundWork;
  /** Required and nullable on schema 7; absent on every earlier version. */
  completionPublication?: CompletionPublicationCursor | null;
  contractVersion: typeof CONTRACT_VERSION;
  runId: string;
  slug: string;
  request: string;
  repoRoot: string;
  status: RunStatus;
  createdAt: string;
  updatedAt: string;
  baseCommit: string;
  /**
   * Uncommitted changes already present when the run started. They are the
   * developer's work, not the run's, and stay out of the reviewed set while
   * they remain byte-identical.
   */
  baseline?: WorkspaceEntry[];
  /**
   * Missing only on states written before automatic workflow selection.
   * Already-started legacy runs are treated as strict.
   */
  workflowSelection?: WorkflowSelectionRecord | null;
  planArtifacts: PhaseArtifacts | null;
  planApproval: ApprovalRecord | null;
  /** Missing on states persisted before the v2 plan-task contract. */
  planTaskCompletion?: PlanTaskCompletionCheckpoint | null;
  adrDecisions: AdrDecision[];
  pendingHumanDecision?: HumanDecisionRequest | null;
  humanDecisions?: HumanDecisionRecord[];
  sessions: {
    planner: ModelSessionBinding | null;
    implementer: ModelSessionBinding | null;
    reviewer: ReviewerSessionBinding | null;
  };
  pendingReviewRotationReason: ReviewRotationReason | null;
  reviewIteration: number;
  latestReview: ReviewReference | null;
  triage: TriageRecord | null;
  triageHistory: TriageRecord[];
  fixCycle: number;
  workspaceDigest: string | null;
  verification: VerificationResult[];
  verificationEvidence?: {
    decision: VerificationDecision;
    applicability: VerificationApplicability | null;
  };
  metrics: RunMetrics;
  activeAttempt: AttemptReference | null;
  activeProcess: ActiveProcess | null;
  /** Missing on states written before operator-authorized recovery existed. */
  recovery?: {
    authorizationId: string;
    sourceAttemptId: string;
    recoveryAttemptId: string | null;
    /** Missing only on recovery state written before staged reconciliation. */
    stage?:
      | "authorized"
      | "source_interrupted"
      | "source_preserved"
      | "attempt_started";
  } | null;
  blockedFrom: Exclude<RunStatus, "blocked"> | null;
  blockReason: string | null;
  /** Present only for a winning cancellation under observation contract v1. */
  cancellation?: CancellationAnchor;
}

/**
 * A bounded diagnostic retained beside a stop result whose completion payload
 * failed ledger checks. It never suppresses or replaces the model's stop.
 */
export interface CompletionDiagnostic {
  violation: PlanTaskCompletionViolation;
  taskId: string | null;
  message: string;
}

export interface AttemptRecord<
  T = WorkflowSelectionResult | PersistedPhaseResult | ReviewResult
> {
  schemaVersion:
    | 1
    | typeof MODEL_ATTEMPT_SCHEMA_VERSION
    | typeof STRICT_MODEL_ATTEMPT_SCHEMA_VERSION
    | 4;
  attempt: AttemptReference;
  /**
   * `pending_application` exists only on schema v3: the vendor returned and
   * the runner has captured terminal proof but has not accepted or applied the
   * result. It contributes no completed attempt, task, verification or review.
   */
  status:
    "started" | "completed" | "failed" | "interrupted" | "pending_application";
  startedAt: string;
  completedAt: string | null;
  /** Required and nullable on schema v2/v3; absent on schema v1. */
  interruptedAt?: string | null;
  /** Required and nullable on schema v2/v3; absent on schema v1. */
  recoveryOf?: string | null;
  /** Required and nullable on schema v2/v3; absent on schema v1. */
  recoveryAuthorizationId?: string | null;
  /** Required on schema v3 strict implementation/fix attempts (ADR-0047). */
  completionProtocol?: typeof COMPLETION_PROTOCOL;
  /** Required and nullable on schema v3: the exact rejected predecessor of an evidence-repair retry. */
  retryOf?: string | null;
  /** Required and nullable on schema v3: the safe envelope decoded from `result`. */
  envelope?: PhaseResultEnvelope | null;
  /** Required and nullable on schema v3: retained stop-result completion diagnostic. */
  completionDiagnostic?: CompletionDiagnostic | null;
  /** The raw structured output on schema v3; a validated result before it. */
  result: T | null;
  sessionId: string | null;
  rawStdoutPath: string | null;
  rawStderrPath: string | null;
  durationMs: number | null;
  usage: ModelUsage | null;
  error: string | null;
  failureCode?: string | null;
  failureCause?: ModelFailureCause | null;
  reviewCandidate?: ReviewCandidateEvidence | null;
  sessionMode?: SessionMode | undefined;
  reviewMode?: ReviewMode | null | undefined;
  rotationReason?: ReviewRotationReason | null | undefined;
  resumeSessionId?: string | null | undefined;
  sessionContext?: SessionContext | undefined;
  /** Optional cache evidence for explicit planning retries; never completion proof. */
  planningContext?: {
    invocationDigest: string;
    workspaceDigest: string | null;
    artifactPaths: string[];
    retryOf: string | null;
  };
  reviewDiagnostics?: {
    stage: "render_validation" | "publication_application" | "recovery";
    code: string;
    message: string;
  }[];
  reviewContext?: {
    outputContract: "review-result/v2";
    snapshotDigest: string;
  };
}

export type TerminalCheckpointResult =
  WorkflowSelectionResult | PersistedPhaseResult | ReviewResult;

export type TerminalSuccessClassification =
  "claude_result" | "codex_turn_completed";

export type TerminalResultContract =
  | "workflow-selection/v1"
  | "phase-result/v2"
  | "phase-result/v3"
  | "phase-result/v4"
  | "review-result/v1"
  | "review-result/v2";

export interface TerminalAttemptCheckpoint<
  T extends TerminalCheckpointResult = TerminalCheckpointResult
> {
  schema:
    typeof TERMINAL_CHECKPOINT_SCHEMA | "banzai-terminal-attempt-checkpoint/v3";
  schemaVersion: typeof TERMINAL_CHECKPOINT_SCHEMA_VERSION | 3;
  runId: string;
  attempt: AttemptReference;
  phase: AttemptReference["kind"];
  configuration: {
    vendor: "codex" | "claude";
    executableDigest: string;
    model: string;
    effort: ModelSettings["effort"];
    sessionMode: SessionMode;
    sessionContextDigest: string;
  };
  resultContract: TerminalResultContract;
  terminal: {
    classification: TerminalSuccessClassification;
    observedAt: string;
  };
  result: T;
  sessionId: string | null;
  usage: ModelUsage | null;
  baseCommit: string;
  approvalDigest: string | null;
  workflowDigest: string | null;
  scopeDigest: string | null;
  integrityDigest: string;
}

/** What the runner observed about one required report at capture time. */
export type CompletionReportObservation =
  | { path: string; state: "present"; sha256: string; bytes: number }
  | { path: string | null; state: "absent" | "unsafe" | "unavailable" };

export interface CompletionObservedInputs {
  implementationReport: CompletionReportObservation;
  testReport: CompletionReportObservation;
  /** Non-report workspace snapshot digest with both report destinations omitted. */
  workspaceDigest: string | null;
}

/**
 * Terminal proof for a strict attempt under the completion protocol. It binds
 * the exact original structured output, the independently decoded envelope and
 * the report/workspace identities observed when the vendor returned.
 */
export interface TerminalAttemptCheckpointV2 {
  schema:
    | typeof TERMINAL_CHECKPOINT_SCHEMA_V2
    | "banzai-terminal-attempt-checkpoint/v3";
  schemaVersion: typeof TERMINAL_CHECKPOINT_SCHEMA_VERSION_V2 | 3;
  completionProtocol: typeof COMPLETION_PROTOCOL;
  runId: string;
  attempt: AttemptReference & { kind: "implementation" | "fix"; mutable: true };
  phase: "implementation" | "fix";
  configuration: TerminalAttemptCheckpoint["configuration"];
  resultContract: "phase-result/v3" | "phase-result/v4";
  terminal: TerminalAttemptCheckpoint["terminal"];
  envelope: PhaseResultEnvelope;
  resultDigest: string;
  observed: CompletionObservedInputs;
  sessionId: string | null;
  usage: ModelUsage | null;
  baseCommit: string;
  approvalDigest: string | null;
  workflowDigest: string | null;
  scopeDigest: string | null;
  integrityDigest: string;
}

export type PersistedTerminalCheckpoint =
  TerminalAttemptCheckpoint | TerminalAttemptCheckpointV2;

interface CompletionRecordIdentity {
  runId: string;
  attemptId: string;
  attemptKind: "implementation" | "fix";
  completionProtocol: typeof COMPLETION_PROTOCOL;
}

/** Attempt-owned evidence of the exact pre-transition run state bytes. */
export interface CompletionTransition extends CompletionRecordIdentity {
  schema: typeof COMPLETION_TRANSITION_SCHEMA;
  schemaVersion: typeof COMPLETION_RECORD_SCHEMA_VERSION;
  priorState: { schemaVersion: 3 | 4 | 6; path: string; sha256: string };
  integrityDigest: string;
}

/** Immutable capture manifest written before validation, rendering or publication. */
export interface CompletionCapture extends CompletionRecordIdentity {
  schema: typeof COMPLETION_CAPTURE_SCHEMA;
  schemaVersion: typeof COMPLETION_RECORD_SCHEMA_VERSION;
  outcome: "completed" | "stop";
  resultDigest: string;
  terminalIntegrityDigest: string | null;
  transitionDigest: string | null;
  baseCommit: string;
  approvalDigest: string;
  planTaskDigest: string;
  workBinding: { workId: string; sha256: string } | null;
  configurationDigest: string;
  scopeDigest: string | null;
  ledgerSource: {
    attemptId: string;
    attemptKind: "implementation" | "fix";
    ledgerDigest: string;
  } | null;
  reports: {
    implementationReport: CompletionReportObservation;
    testReport: CompletionReportObservation;
  };
  originals: {
    implementationReport: { path: string; sha256: string } | null;
    testReport: { path: string; sha256: string } | null;
  };
  workspace: { digest: string; excludedPaths: string[] };
  capturedAt: string;
  integrityDigest: string;
}

/** Immutable candidate metadata for the deterministic completion candidate bytes. */
export interface CompletionCandidate extends CompletionRecordIdentity {
  schema: typeof COMPLETION_CANDIDATE_SCHEMA;
  schemaVersion: typeof COMPLETION_RECORD_SCHEMA_VERSION;
  captureDigest: string;
  ledgerDigest: string;
  destination: string;
  inputSha256: string;
  candidatePath: string;
  outputSha256: string;
  outputBytes: number;
  testReportSha256: string;
  region: { action: "appended" | "replaced"; start: number; end: number };
  preservation: "verified";
  roundtrip: "verified";
  integrityDigest: string;
}

/** Immutable publication receipt written after the exact destination replacement. */
export interface CompletionPublication extends CompletionRecordIdentity {
  schema: typeof COMPLETION_PUBLICATION_SCHEMA;
  schemaVersion: typeof COMPLETION_RECORD_SCHEMA_VERSION;
  captureDigest: string;
  candidateDigest: string;
  terminalIntegrityDigest: string | null;
  authority: {
    baseCommit: string;
    approvalDigest: string;
    planTaskDigest: string;
    scopeDigest: string | null;
    workBindingSha256: string | null;
    configurationDigest: string;
  };
  ledgerAuthor: {
    attemptId: string;
    attemptKind: "implementation" | "fix";
    ledgerDigest: string;
  };
  publisher: { attemptId: string; attemptKind: "implementation" | "fix" };
  implementationReport: { path: string; sha256: string };
  testReport: { path: string; sha256: string };
  publishedAt: string;
  integrityDigest: string;
}

export interface RecoveryAuthorization {
  schema: typeof RECOVERY_AUTHORIZATION_SCHEMA;
  schemaVersion: typeof RECOVERY_AUTHORIZATION_SCHEMA_VERSION;
  authorizationId: string;
  runId: string;
  /**
   * ADR-0051 adds the digest-rejected source, so a planning attempt is now
   * representable. The schema identity stays `v1`: the value set grew, and
   * every authorization an earlier version wrote holds `implementation` or
   * `fix`, which this parser still accepts byte-for-byte. The reverse
   * direction is refused fail-closed by the older enum check.
   */
  attempt: AttemptReference & { kind: "implementation" | "fix" | "plan" };
  phase: "implementation" | "fix" | "plan";
  recoveryIdentity: string;
  workspaceDigest: string;
  baseCommit: string;
  approvalDigest: string | null;
  workflowDigest: string | null;
  scopeDigest: string | null;
  configurationDigest: string;
  decidedBy: string;
  decidedAt: string;
  unknownSideEffectsAccepted: true;
}

/**
 * One acceptance-time comparison of a model-authored digest against the bytes
 * it names (ADR-0051). `role` comes from the shared task-verification rule.
 */
export interface ResultDigestComparison {
  role: "binding" | "precondition";
  field: string;
  checkId: string | null;
  path: string | null;
  declared: string;
  observed: string | null;
  size: number | null;
  /** The bound a size rejection exceeded; null for every other outcome. */
  limit: number | null;
  matched: boolean;
}

/**
 * Runner-owned durable evidence of what a model-authored digest was compared
 * against when its result was accepted. Written once per attempt, before the
 * attempt is accepted or failed, and never rewritten: absence means no
 * baseline exists and none may be reconstructed from current bytes.
 */
export interface ResultDigestEvidence {
  schema: typeof RESULT_DIGEST_EVIDENCE_SCHEMA;
  schemaVersion: typeof RESULT_DIGEST_EVIDENCE_SCHEMA_VERSION;
  runId: string;
  attempt: { id: string; kind: AttemptReference["kind"] };
  outcome: "accepted" | "rejected";
  comparisons: ResultDigestComparison[];
}

export interface AdapterTerminalSuccess<
  T extends TerminalCheckpointResult | PhaseResultEnvelope =
    TerminalCheckpointResult | PhaseResultEnvelope
> {
  classification: TerminalSuccessClassification;
  observedAt: string;
  result: T;
  sessionId: string | null;
  usage: ModelUsage | null;
}

export type EvidenceState =
  | "observed"
  | "derived"
  | "inferred_legacy"
  | "unknown"
  | "legacy_absent"
  | "invalid"
  | "not_applicable";

export interface EvidenceValue<T> {
  value: T | null;
  evidence: EvidenceState;
}

export type NumericAvailability =
  "complete" | "partial" | "unavailable" | "not_applicable";

export interface NumericMetric {
  value: number | null;
  observedSubtotal: number;
  observedCount: number;
  unknownCount: number;
  invalidCount: number;
  availability: NumericAvailability;
}

export type EvaluationCompleteness = "complete" | "partial" | "unreadable";
export type EvaluationCohortMembership = "included" | "unresolved";
export type EvaluationVendor = "codex" | "claude" | "unknown";
export type EvaluationAttemptKind = AttemptReference["kind"] | "verification";
/**
 * Frozen export v1 enum, pinned explicitly: a later persisted attempt status
 * (`interrupted`, `pending_application`) must never widen this contract.
 */
export type EvaluationAttemptOutcome = "started" | "completed" | "failed";
export type EvaluationFailureCategory =
  | "startup_check"
  | "model_attempt"
  | "verification_command"
  | "review_check"
  | "review_verdict_blocked"
  | "interrupted_attempt"
  | "malformed_persisted_evidence"
  | "blocked_other";
export type EvaluationRetryKind = "attempt" | "start_checks" | "review_checks";
export type EvaluationIssueSource =
  "run" | "state" | "attempt" | "event" | "review" | "verification";
export type EvaluationIssueSeverity = "warning" | "error";
export type EvaluationIssueCode =
  | "STATE_MISSING"
  | "STATE_MALFORMED"
  | "STATE_SCHEMA_UNSUPPORTED"
  | "STATE_FIELD_MISSING"
  | "STATE_FIELD_INVALID"
  | "LEGACY_FIELD_ABSENT"
  | "ATTEMPT_DIRECTORY_MISSING"
  | "ATTEMPT_MALFORMED"
  | "ATTEMPT_DUPLICATE"
  | "ATTEMPT_CONFLICT"
  | "EVENTS_MISSING"
  | "EVENT_LINE_MALFORMED"
  | "REVIEW_MISSING"
  | "REVIEW_MALFORMED"
  | "REVIEW_DUPLICATE"
  | "REVIEW_UNAPPLIED"
  | "METRIC_MISMATCH"
  | "VERIFICATION_LEDGER_MALFORMED"
  | "VERIFICATION_ATTEMPT_MALFORMED"
  | "VERIFICATION_ATTEMPT_DUPLICATE"
  | "VERIFICATION_ATTEMPT_CONFLICT"
  | "VERIFICATION_SEQUENCE_CONFLICT"
  | "VERIFICATION_SEQUENCE_MISSING"
  | "VERIFICATION_HISTORY_INCOMPLETE"
  | "PLAN_TASK_COMPLETION_INVALID"
  | "ACTIVE_ATTEMPT_INCOMPLETE";

export interface EvaluationSourceIssue {
  code: EvaluationIssueCode;
  field: string | null;
}

export interface EvaluationDecoded<T> {
  value: T;
  issues: EvaluationSourceIssue[];
}

export interface EvaluationVerificationSource {
  validStructure: boolean;
  exitCode: EvidenceValue<number>;
  signalPresent: EvidenceValue<boolean>;
  startedAt: EvidenceValue<string>;
  completedAt: EvidenceValue<string>;
}

export interface EvaluationStateMetricSource {
  attempts: Record<EvaluationAttemptKind, EvidenceValue<number>>;
  usage: {
    inputTokens: EvidenceValue<number>;
    cachedInputTokens: EvidenceValue<number>;
    outputTokens: EvidenceValue<number>;
    costUsd: EvidenceValue<number>;
  };
  reviewFindingCount: EvidenceValue<number>;
  sessions: {
    fresh: EvidenceValue<number>;
    resumed: EvidenceValue<number>;
  };
  reviews: {
    full: EvidenceValue<number>;
    delta: EvidenceValue<number>;
    rotations: EvidenceValue<number>;
  };
  triage: Record<FindingDisposition, EvidenceValue<number>>;
}

export interface EvaluationStateSource {
  verificationMode?: "ordered" | "policy" | "task";
  taskVerification?: TaskVerificationPublication;
  schemaVersion: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  contractVersion: EvidenceValue<string>;
  status: EvidenceValue<RunStatus>;
  createdAt: EvidenceValue<string>;
  updatedAt: EvidenceValue<string>;
  workflow: EvidenceValue<WorkflowRoute>;
  reviewIteration: EvidenceValue<number>;
  appliedReviewIteration: EvidenceValue<number>;
  fixCycle: EvidenceValue<number>;
  blockedFrom: EvidenceValue<RunStatus>;
  activeAttemptIdentity: EvidenceValue<string>;
  activeAttemptKind: EvidenceValue<AttemptReference["kind"]>;
  activeVerification: EvidenceValue<boolean>;
  triage: Record<FindingDisposition, number>;
  triageIsCumulative: boolean;
  verificationList: EvidenceValue<boolean>;
  verification: EvaluationVerificationSource[];
  metrics: EvaluationStateMetricSource;
}

export interface EvaluationModelProfileSource {
  vendor: EvidenceValue<EvaluationVendor>;
  model: EvidenceValue<string>;
  effort: EvidenceValue<ModelSettings["effort"]>;
}

export interface EvaluationAttemptSource {
  identity: string;
  schemaVersion: EvidenceValue<number>;
  kind: EvidenceValue<AttemptReference["kind"]>;
  mutable: EvidenceValue<boolean>;
  status: EvidenceValue<AttemptRecord["status"]>;
  startedAt: EvidenceValue<string>;
  completedAt: EvidenceValue<string>;
  durationMs: EvidenceValue<number>;
  sessionMode: EvidenceValue<SessionMode>;
  reviewMode: EvidenceValue<ReviewMode>;
  rotationReason: EvidenceValue<EvaluationRotationReason>;
  model: EvaluationModelProfileSource;
  usage: {
    inputTokens: EvidenceValue<number>;
    cachedInputTokens: EvidenceValue<number>;
    outputTokens: EvidenceValue<number>;
    costUsd: EvidenceValue<number>;
  };
}

export interface EvaluationReviewSource {
  verdict: EvidenceValue<ReviewVerdict>;
  findings: Record<ReviewFinding["severity"], number>;
}

export interface EvaluationEventSource {
  type:
    | "attempt.retry_requested"
    | "verification.retry_requested"
    | "run.start_retry_requested"
    | "review.checks_retry_requested"
    | "run.start_failed"
    | "review.checks_failed"
    | "plan_task_completion.validation_failed"
    | "other";
}

export interface EvaluationExportOptions {
  schemaVersion?: 1 | 2;
  format: "markdown" | "json";
  from: string | null;
  to: string | null;
  runIds: string[];
}

export interface EvaluationIssue {
  runKey: string | null;
  attemptKey: string | null;
  source: EvaluationIssueSource;
  field: string | null;
  code: EvaluationIssueCode;
  severity: EvaluationIssueSeverity;
}

export interface EvaluationAttempt {
  attemptKey: string;
  source: {
    schemaVersion: EvidenceValue<number>;
  };
  kind: EvidenceValue<AttemptReference["kind"]>;
  mutable: EvidenceValue<boolean>;
  status: EvidenceValue<AttemptRecord["status"]>;
  startedAt: EvidenceValue<string>;
  completedAt: EvidenceValue<string>;
  durationMs: EvidenceValue<number>;
  sessionMode: EvidenceValue<SessionMode>;
  reviewMode: EvidenceValue<ReviewMode>;
  rotationReason: EvidenceValue<EvaluationRotationReason>;
  model: EvaluationModelProfileSource;
  usage: {
    inputTokens: EvidenceValue<number>;
    cachedInputTokens: EvidenceValue<number>;
    outputTokens: EvidenceValue<number>;
    costUsd: EvidenceValue<number>;
  };
}

export interface EvaluationVerification {
  ordinal: number;
  status: VerificationAttemptStatus;
  exitCode: EvidenceValue<number>;
  signalPresent: EvidenceValue<boolean>;
  durationMs: EvidenceValue<number>;
}

export interface EvaluationReview {
  ordinal: number;
  verdict: EvidenceValue<ReviewVerdict>;
  findings: Record<ReviewFinding["severity"], number>;
}

export interface EvaluationMetricSet {
  attempts: {
    total: NumericMetric;
    byKind: Record<EvaluationAttemptKind, NumericMetric>;
    byOutcome: Record<EvaluationAttemptOutcome, NumericMetric>;
  };
  durationsMs: Record<
    | "selection"
    | "planning"
    | "implementation"
    | "verification"
    | "review"
    | "fixing",
    NumericMetric
  >;
  sessions: Record<SessionMode | "unknown", NumericMetric>;
  reviews: {
    attempts: Record<ReviewMode | "unknown", NumericMetric>;
    rotations: {
      total: NumericMetric;
      byReason: Record<EvaluationRotationReason, NumericMetric>;
    };
    verdicts: Record<ReviewVerdict, NumericMetric>;
    findings: Record<ReviewFinding["severity"], NumericMetric>;
  };
  triage: Record<FindingDisposition, NumericMetric>;
  retries: {
    total: NumericMetric;
    byKind: Record<EvaluationRetryKind, NumericMetric>;
  };
  failures: Record<EvaluationFailureCategory, NumericMetric>;
  verification: {
    retained: NumericMetric;
    completed: NumericMetric;
    failed: NumericMetric;
  };
  usage: {
    inputTokens: NumericMetric;
    cachedInputTokens: NumericMetric;
    outputTokens: NumericMetric;
    costUsd: NumericMetric;
  };
  fixCycles: NumericMetric;
  humanMinutes: NumericMetric;
  falsePositiveRate: NumericMetric;
}

export interface EvaluationRun {
  runKey: string;
  cohortMembership: EvaluationCohortMembership;
  completeness: EvaluationCompleteness;
  source: {
    stateSchemaVersion: number | null;
    contractVersion: EvidenceValue<string>;
  };
  workflow: EvidenceValue<WorkflowRoute>;
  status: EvidenceValue<RunStatus>;
  createdAt: EvidenceValue<string>;
  updatedAt: EvidenceValue<string>;
  terminal: EvidenceValue<boolean>;
  attempts: EvaluationAttempt[];
  verification: EvaluationVerification[];
  reviews: EvaluationReview[];
  metrics: EvaluationMetricSet;
  issueCodes: EvaluationIssueCode[];
}

export interface EvaluationBreakdown {
  runCount: number;
  metrics: EvaluationMetricSet;
}

export interface EvaluationAggregates {
  overall: EvaluationBreakdown;
  byWorkflow: Record<WorkflowRoute | "unknown", EvaluationBreakdown>;
  byStatus: Record<RunStatus | "unknown", EvaluationBreakdown>;
  byWorkflowAndStatus: {
    workflow: WorkflowRoute | "unknown";
    status: RunStatus | "unknown";
    summary: EvaluationBreakdown;
  }[];
}

export interface EvaluationCohort {
  from: string | null;
  to: string | null;
  explicitRuns: boolean;
  selectedRunCount: number;
  candidateRunCount: number;
  includedRunCount: number;
  excludedRunCount: number;
  unresolvedRunCount: number;
}

export interface EvaluationExport {
  schema: typeof EVALUATION_EXPORT_SCHEMA;
  schemaVersion: typeof EVALUATION_EXPORT_SCHEMA_VERSION;
  cohort: EvaluationCohort;
  runs: EvaluationRun[];
  aggregates: EvaluationAggregates;
  issues: EvaluationIssue[];
}

export interface KpiCoverage {
  exact: number;
  incomplete: number;
}

/**
 * One derived KPI measurement. `value` is null exactly when `denominator` is
 * zero; only exact-evidence runs contribute to numerator and denominator, and
 * `coverage` reports how many in-scope runs were exact versus not.
 */
export interface KpiValue {
  numerator: number;
  denominator: number;
  value: number | null;
  coverage: KpiCoverage;
}

export interface KpiGroupValue {
  group: string;
  value: KpiValue;
}

export type KpiUnit = "ratio" | "mean" | "max" | "count";

export interface EvaluationKpiEntry {
  kpi: string;
  measure: string;
  unit: KpiUnit;
  overall: KpiValue;
  byWorkflow: KpiGroupValue[] | null;
  bySignature: KpiGroupValue[];
}

export interface EvaluationKpiSignature {
  planner: string;
  implementer: string;
  reviewer: string;
  key: string;
  runCount: number;
}

export interface EvaluationKpiSource {
  ordinal: number;
  label: string;
  includedRunCount: number;
  issueCount: number;
  signatures: EvaluationKpiSignature[];
  kpis: EvaluationKpiEntry[];
}

export interface EvaluationKpiReport {
  schema: typeof EVALUATION_KPI_SCHEMA;
  schemaVersion: typeof EVALUATION_KPI_SCHEMA_VERSION;
  sources: EvaluationKpiSource[];
}

export interface EvaluationKpiOptions {
  schemaVersion?: 1 | 2;
  format: "markdown" | "json";
  from: string | null;
  to: string | null;
  runIds: string[];
  inputs: string[];
}

/**
 * The structured form of a model phase's `detail` string. Present only on model
 * invocations, so a presenter can render a phase banner while every other
 * activity keeps the plain `START <label> - <detail>` shape.
 */
export interface PhaseDescriptor {
  executable: string;
  model: string;
  effort: string;
  sessionMode: SessionMode;
  timeoutMs: number;
  /**
   * The phase chain the runner supplies. It is what distinguishes a lite route's
   * single phase from a strict one, so a reader can tell which workflow is
   * actually executing rather than inferring it from the phase name.
   */
  phases: readonly string[];
}

export type ProgressEvent =
  | {
      kind: "info";
      message: string;
    }
  | {
      kind: "activity_started";
      id: string;
      label: string;
      detail: string;
      descriptor?: PhaseDescriptor | undefined;
    }
  | {
      kind: "activity_completed" | "activity_failed";
      id: string;
      label: string;
      durationMs: number;
    }
  | {
      /**
       * One action inside a model turn. Reported structurally rather than as a
       * formatted string so the presenter can filter by verbosity and pair a
       * completion with its start.
       */
      kind: "model_action";
      label: string;
      action: ModelProgressEvent["kind"];
      status: ModelProgressEvent["status"];
      detail: string;
      actionId: string | null;
    };

export type ProgressReporter = (event: ProgressEvent) => void;

export interface ProcessSpec {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  maxOutputBytes?: number;
  onStart?: (pid: number) => Promise<void> | void;
  onStdoutLine?: (line: string) => void;
  /** Ordered durable observer; rejection fails the process boundary. */
  onStdoutLineDurable?: ((line: string) => Promise<void>) | undefined;
}

export interface ProcessResult {
  exitCode: number;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  startedAt: string;
  completedAt: string;
}

export type ProcessRunner = (spec: ProcessSpec) => Promise<ProcessResult>;

export interface AdapterResult<T> {
  result: T;
  sessionId: string | null;
  stdout: string;
  stderr: string;
  usage: ModelUsage | null;
  inventory?: SessionInventory | null;
  turnCount?: number | null;
}

export interface PhaseAdapterRequest {
  repoRoot: string;
  runDirectory: string;
  attemptId: string;
  prompt: string;
  promptEnvelope: PromptEnvelope;
  outputContract: OutputContractEnvelope;
  settings: ModelSettings;
  resumeSessionId: string | null;
  env: NodeJS.ProcessEnv;
  onStart: (pid: number) => Promise<void>;
  onProgress: (event: ModelProgressEvent) => void;
  /** Persist the vendor identity before any terminal result is available. */
  onSessionStarted?: (sessionId: string) => Promise<void>;
  onTerminalSuccess?: (
    terminal: AdapterTerminalSuccess<PhaseResult | PhaseResultEnvelope>
  ) => Promise<void>;
  environment?: ClaudeInvocationScope;
  /**
   * Selected from the persisted attempt protocol before invocation. When set,
   * both vendors decode the safe envelope: a valid stop with a malformed
   * completion payload is still returned, never discarded or repaired.
   */
  completionProtocol?: typeof COMPLETION_PROTOCOL | undefined;
}

export interface WorkflowSelectionAdapterRequest {
  repoRoot: string;
  runDirectory: string;
  attemptId: string;
  prompt: string;
  promptEnvelope: PromptEnvelope;
  outputContract: OutputContractEnvelope;
  settings: ModelSettings;
  env: NodeJS.ProcessEnv;
  onStart: (pid: number) => Promise<void>;
  onProgress: (event: ModelProgressEvent) => void;
  onTerminalSuccess?: (
    terminal: AdapterTerminalSuccess<WorkflowSelectionResult>
  ) => Promise<void>;
  environment?: ClaudeInvocationScope;
}

export interface ReviewAdapterRequest {
  repoRoot: string;
  runId: string;
  runDirectory: string;
  attemptId: string;
  approvalDigest: string;
  artifact: ReviewArtifactContext;
  prompt: string;
  promptEnvelope: PromptEnvelope;
  outputContract: OutputContractEnvelope;
  settings: ModelSettings;
  resumeSessionId: string | null;
  env: NodeJS.ProcessEnv;
  onStart: (pid: number) => Promise<void>;
  onProgress: (event: ModelProgressEvent) => void;
  onTerminalSuccess?: (
    terminal: AdapterTerminalSuccess<ReviewResult>
  ) => Promise<void>;
  environment?: ClaudeInvocationScope;
  liveCompatibility?: {
    pluginDirectory: string;
    includeHookEvents: boolean;
  };
}

export interface VendorAdapters {
  preflightCodex(
    settings: ModelSettings,
    env?: NodeJS.ProcessEnv
  ): Promise<void>;
  preflightClaude(
    settings: ModelSettings,
    env?: NodeJS.ProcessEnv
  ): Promise<void>;
  runSelection(
    request: WorkflowSelectionAdapterRequest
  ): Promise<AdapterResult<WorkflowSelectionResult>>;
  /**
   * Returns a validated `PhaseResult` for legacy requests and a safe
   * `PhaseResultEnvelope` when the request carries the completion protocol.
   */
  runPhase(
    request: PhaseAdapterRequest
  ): Promise<AdapterResult<PhaseResult | PhaseResultEnvelope>>;
  /**
   * Resolves the availability-gated MCP whitelist for this checkout. Optional
   * so test doubles that never touch MCP stay valid; the workflow treats an
   * absent resolver as "no whitelist".
   */
  resolveMcpWhitelist?(input: {
    repoRoot: string;
    codexExecutable: string | null;
  }): Promise<McpWhitelist>;
  runReview(
    request: ReviewAdapterRequest
  ): Promise<AdapterResult<ReviewResult>>;
}

export type InstructionPhase =
  "planning" | "implementation" | "review" | "fix" | "feature" | "quick-fix";

/** Ephemeral comparison evidence; never added to persisted or exported contracts. */
export interface InstructionParity {
  state:
    | "verified"
    | "mismatch"
    | "unverifiable"
    | "bounded_failure"
    | "not_applicable";
  resourceIds: string[];
  mismatched: string[];
  unavailable: string[];
}

export interface EvaluationVerificationV2 {
  coverage: "exact" | "incomplete";
  physicalAttempts: {
    ordinal: number;
    status: VerificationAttemptStatus;
    durationMs: number | null;
  }[];
  dispositions: {
    round: number;
    check: number;
    kind: "executed" | "reused" | "pending";
    origin: number | null;
  }[];
}
export interface EvaluationExportV2 extends Omit<
  EvaluationExport,
  "schema" | "schemaVersion" | "runs"
> {
  schema: "banzai-evaluation-export/v2";
  schemaVersion: 2;
  runs: (EvaluationRun & { verificationEvidence: EvaluationVerificationV2 })[];
}
export interface EvaluationKpiV2 {
  schema: "banzai-evaluation-kpi/v2";
  schemaVersion: 2;
  sources: {
    ordinal: number;
    runs: number;
    coverage: KpiCoverage;
    physicalAttempts: number;
    executedChecks: number;
    reusedChecks: number;
    reuseRatio: {
      numerator: number;
      denominator: number;
      value: number | null;
      coverage: KpiCoverage;
    };
  }[];
}
