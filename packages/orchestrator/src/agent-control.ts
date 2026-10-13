import path from "node:path";
import packageManifest from "../package.json" with { type: "json" };
import { BanzaiError } from "./errors.js";
import type {
  AgentControlAnswerV1,
  AgentControlAnswerV2,
  AgentControlAnswerV3,
  AgentControlCapabilitiesV5,
  AgentControlCompletionPublicationV1,
  AgentControlNextAction,
  AgentControlPendingGateV3,
  AgentControlRecoveryV1,
  AgentControlRequestV1,
  AgentControlStatusV4,
  DecisionConsultationAnswer,
  DecisionConsultationCard,
  DecisionConsultationRequest,
  RunState
} from "./types.js";
import {
  CONFIGURATION_ANSWER_SCHEMA,
  CONFIGURATION_ANSWER_SCHEMA_VERSION,
  AGENT_ANSWER_SCHEMA,
  AGENT_ANSWER_SCHEMA_VERSION,
  AGENT_CAPABILITIES_SCHEMA,
  AGENT_CAPABILITIES_SCHEMA_VERSION,
  AGENT_CONTROL_CONTRACT_VERSION,
  AGENT_RECOVERY_SCHEMA,
  AGENT_RECOVERY_SCHEMA_VERSION,
  AGENT_REQUEST_SCHEMA,
  AGENT_REQUEST_SCHEMA_VERSION,
  AGENT_STATUS_SCHEMA,
  AGENT_STATUS_SCHEMA_VERSION,
  COMPLETION_PROTOCOL,
  COMPLETION_PUBLICATION_REFUSAL_CODES,
  COMPLETION_PUBLICATION_STAGES,
  CONTRACT_VERSION,
  DECISION_CONSULTATION_SCHEMA,
  DECISION_CONSULTATION_SCHEMA_VERSION,
  LEGACY_AGENT_ANSWER_SCHEMA,
  LEGACY_AGENT_CONTROL_SCHEMA_VERSION
} from "./types.js";
import {
  CONFIGURATION_ACTIONS,
  configurationObject,
  configurationText,
  configurationUuid,
  configurationId,
  parseConfigurationCommandInput,
  parseConfigurationPrerequisite
} from "./configuration-prerequisite.js";
import { parseDecisionConsultationAnswers } from "./validation.js";
import {
  humanDecisionQuestions,
  reviewCompletion,
  type WorkflowStatus
} from "./workflow.js";

export const MAX_AGENT_CONTROL_INPUT_BYTES = 64 * 1024;

const MAX_IDENTIFIER_LENGTH = 256;
const MAX_PATH_LENGTH = 1_024;
const MAX_REASON_LENGTH = 4_096;
const MAX_QUESTION_LENGTH = 16_384;
const MAX_COLLECTION_LENGTH = 128;
const MAX_ANSWER_COUNT = 64;

function controlInputError(message: string): BanzaiError {
  return new BanzaiError("INVALID_CONTROL_INPUT", message);
}

function statusError(message: string): BanzaiError {
  return new BanzaiError("CONTROL_STATUS_INVALID", message);
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw controlInputError("Agent control input must be a JSON object.");
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[]
): void {
  const actual = Object.keys(value).sort((left, right) =>
    left.localeCompare(right)
  );
  const wanted = [...expected].sort((left, right) => left.localeCompare(right));
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    throw controlInputError(
      `Agent control input requires exactly: ${wanted.join(", ")}.`
    );
  }
}

function parseDocument(input: Uint8Array): Record<string, unknown> {
  if (input.byteLength === 0) {
    throw controlInputError("Agent control input cannot be empty.");
  }
  if (input.byteLength > MAX_AGENT_CONTROL_INPUT_BYTES) {
    throw new BanzaiError(
      "CONTROL_INPUT_TOO_LARGE",
      `Agent control input exceeds ${MAX_AGENT_CONTROL_INPUT_BYTES} bytes.`
    );
  }
  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(input);
  } catch {
    throw controlInputError("Agent control input must be valid UTF-8.");
  }
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    throw controlInputError("Agent control input must be valid JSON.");
  }
  if (record(value).schema === CONFIGURATION_ANSWER_SCHEMA) {
    const frames: { object: boolean; key: boolean; seen: Set<string> }[] = [];
    const tokens =
      source.match(/"(?:\\.|[^"\\])*"|[{}[\]:,]|[^\s{}[\]:,]+/gu) ?? [];
    for (const token of tokens) {
      const frame = frames.at(-1);
      if (token === "{" || token === "[")
        frames.push({
          object: token === "{",
          key: token === "{",
          seen: new Set()
        });
      else if (token === "}" || token === "]") frames.pop();
      else if (token === "," && frame?.object) frame.key = true;
      else if (token.startsWith('"') && frame?.object && frame.key) {
        const key = JSON.parse(token) as string;
        if (frame.seen.has(key))
          throw controlInputError(
            "Configuration answers cannot repeat JSON fields."
          );
        frame.seen.add(key);
        frame.key = false;
      }
    }
  }
  return record(value);
}

function requireSchema(
  value: Record<string, unknown>,
  schema:
    | typeof AGENT_REQUEST_SCHEMA
    | typeof AGENT_ANSWER_SCHEMA
    | typeof AGENT_RECOVERY_SCHEMA
    | typeof LEGACY_AGENT_ANSWER_SCHEMA,
  version: number
): void {
  if (value.schema !== schema || value.schemaVersion !== version) {
    throw new BanzaiError(
      "CONTROL_SCHEMA_UNSUPPORTED",
      `Agent control input must use ${schema} schema version ${version}.`
    );
  }
}

export function decodeAgentControlRequest(
  input: Uint8Array
): AgentControlRequestV1 {
  const value = parseDocument(input);
  exactKeys(value, ["schema", "schemaVersion", "request"]);
  requireSchema(value, AGENT_REQUEST_SCHEMA, AGENT_REQUEST_SCHEMA_VERSION);
  if (typeof value.request !== "string" || value.request.trim().length === 0) {
    throw controlInputError(
      "Agent control request must be a non-empty string."
    );
  }
  return {
    schema: AGENT_REQUEST_SCHEMA,
    schemaVersion: AGENT_REQUEST_SCHEMA_VERSION,
    request: value.request
  };
}

export function decodeAgentControlAnswer(
  input: Uint8Array
): AgentControlAnswerV1 | AgentControlAnswerV2 | AgentControlAnswerV3 {
  const value = parseDocument(input);
  if (value.schema === CONFIGURATION_ANSWER_SCHEMA) {
    const item = configurationObject(value, [
      "schema",
      "schemaVersion",
      "kind",
      "runId",
      "decisionId",
      "proposalId",
      "action",
      ...(value.action === "edit" ? ["profile"] : [])
    ]);
    if (
      item.schemaVersion !== CONFIGURATION_ANSWER_SCHEMA_VERSION ||
      item.kind !== "configuration_prerequisite" ||
      !CONFIGURATION_ACTIONS.some((action) => action === item.action)
    )
      throw controlInputError("Unsupported configuration answer.");
    let profile: AgentControlAnswerV3["profile"];
    if (item.action === "edit") {
      const draft = configurationObject(item.profile, ["id", "commands"]);
      if (!Array.isArray(draft.commands) || draft.commands.length > 200)
        throw controlInputError(
          "An edited profile requires at most 200 commands."
        );
      profile = {
        id: configurationId(draft.id),
        commands: draft.commands.map(parseConfigurationCommandInput)
      };
    }
    return {
      schema: CONFIGURATION_ANSWER_SCHEMA,
      schemaVersion: CONFIGURATION_ANSWER_SCHEMA_VERSION,
      kind: "configuration_prerequisite",
      runId: configurationText(item.runId),
      decisionId: configurationUuid(item.decisionId),
      proposalId: configurationUuid(item.proposalId),
      action: item.action as AgentControlAnswerV3["action"],
      ...(profile ? { profile } : {})
    };
  }
  if (
    value.schema === LEGACY_AGENT_ANSWER_SCHEMA &&
    value.schemaVersion === LEGACY_AGENT_CONTROL_SCHEMA_VERSION
  ) {
    exactKeys(value, ["schema", "schemaVersion", "answers"]);
    if (
      !Array.isArray(value.answers) ||
      value.answers.length === 0 ||
      value.answers.length > MAX_ANSWER_COUNT ||
      value.answers.some(
        (answer) => typeof answer !== "string" || answer.trim().length === 0
      )
    ) {
      throw controlInputError(
        `Agent control answers must contain 1-${MAX_ANSWER_COUNT} non-empty strings.`
      );
    }
    return {
      schema: LEGACY_AGENT_ANSWER_SCHEMA,
      schemaVersion: LEGACY_AGENT_CONTROL_SCHEMA_VERSION,
      answers: value.answers as string[]
    };
  }
  exactKeys(value, [
    "schema",
    "schemaVersion",
    "runId",
    "requestId",
    "roundId",
    "answers"
  ]);
  requireSchema(value, AGENT_ANSWER_SCHEMA, AGENT_ANSWER_SCHEMA_VERSION);
  const identifier = (candidate: unknown, label: string): string => {
    if (
      typeof candidate !== "string" ||
      candidate.length === 0 ||
      candidate.length > MAX_IDENTIFIER_LENGTH ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(candidate)
    ) {
      throw controlInputError(
        `${label} must be a bounded canonical identifier.`
      );
    }
    return candidate;
  };
  const inertText = (
    candidate: unknown,
    label: string,
    maximum: number
  ): string => {
    if (
      typeof candidate !== "string" ||
      candidate.length === 0 ||
      candidate.trim().length === 0 ||
      candidate.length > maximum ||
      /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(
        candidate
      )
    ) {
      throw controlInputError(`${label} must be bounded non-empty inert text.`);
    }
    return candidate;
  };
  if (
    !Array.isArray(value.answers) ||
    value.answers.length === 0 ||
    value.answers.length > 3
  ) {
    throw controlInputError(
      "Agent consultation answers must contain 1-3 records."
    );
  }
  const seen = new Set<string>();
  const answers = value.answers.map((item, index) => {
    const answer = record(item);
    exactKeys(answer, ["decisionId", "response", "note"]);
    const decisionId = identifier(
      answer.decisionId,
      `answers[${index}].decisionId`
    );
    if (seen.has(decisionId)) {
      throw controlInputError(
        "Agent consultation decision IDs must be unique."
      );
    }
    seen.add(decisionId);
    const response = record(answer.response);
    exactKeys(response, ["kind", "optionId", "text"]);
    if (response.kind !== "option" && response.kind !== "preference") {
      throw controlInputError(
        `answers[${index}].response.kind is unsupported.`
      );
    }
    const kind: "option" | "preference" = response.kind;
    const optionId =
      kind === "option"
        ? identifier(response.optionId, `answers[${index}].response.optionId`)
        : null;
    const text =
      kind === "preference"
        ? inertText(response.text, `answers[${index}].response.text`, 8_000)
        : null;
    if (
      (kind === "option" && response.text !== null) ||
      (kind === "preference" && response.optionId !== null)
    ) {
      throw controlInputError(
        `answers[${index}].response fields do not match its kind.`
      );
    }
    return {
      decisionId,
      response: { kind, optionId, text },
      note:
        answer.note === null
          ? null
          : inertText(answer.note, `answers[${index}].note`, 2_000)
    };
  });
  return {
    schema: AGENT_ANSWER_SCHEMA,
    schemaVersion: AGENT_ANSWER_SCHEMA_VERSION,
    runId: identifier(value.runId, "runId"),
    requestId: identifier(value.requestId, "requestId"),
    roundId: identifier(value.roundId, "roundId"),
    answers
  };
}

export function validateAgentControlConsultationAnswers(
  value: unknown,
  request: DecisionConsultationRequest
): DecisionConsultationAnswer[] {
  return parseDecisionConsultationAnswers(value, request);
}

export function decodeAgentControlRecovery(
  input: Uint8Array
): AgentControlRecoveryV1 {
  const value = parseDocument(input);
  exactKeys(value, [
    "schema",
    "schemaVersion",
    "attemptId",
    "recoveryIdentity",
    "unknownSideEffectsAccepted"
  ]);
  requireSchema(value, AGENT_RECOVERY_SCHEMA, AGENT_RECOVERY_SCHEMA_VERSION);
  if (
    typeof value.attemptId !== "string" ||
    value.attemptId.trim().length === 0 ||
    value.attemptId.length > MAX_IDENTIFIER_LENGTH ||
    typeof value.recoveryIdentity !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.recoveryIdentity) ||
    value.unknownSideEffectsAccepted !== true
  ) {
    throw controlInputError(
      "Agent recovery requires a bounded attemptId, a SHA-256 recoveryIdentity, and unknownSideEffectsAccepted=true."
    );
  }
  return {
    schema: AGENT_RECOVERY_SCHEMA,
    schemaVersion: AGENT_RECOVERY_SCHEMA_VERSION,
    attemptId: value.attemptId,
    recoveryIdentity: value.recoveryIdentity,
    unknownSideEffectsAccepted: true
  };
}

export function agentControlCapabilities(): AgentControlCapabilitiesV5 {
  return {
    schema: AGENT_CAPABILITIES_SCHEMA,
    schemaVersion: AGENT_CAPABILITIES_SCHEMA_VERSION,
    controlContractVersion: AGENT_CONTROL_CONTRACT_VERSION,
    orchestratorVersion: packageManifest.version,
    umbrellaContractVersion: CONTRACT_VERSION,
    workDocuments: {
      directoryPattern: "documentation/work/<slug>/",
      bindingSchemas: ["banzai-work-binding/v3"],
      workspaceSnapshotVersion: 3,
      verificationRequestSchemas: ["banzai-verification-request/v3"]
    },
    configurationPrerequisite: {
      kind: "configuration_prerequisite",
      actions: CONFIGURATION_ACTIONS,
      statusSchema: AGENT_STATUS_SCHEMA,
      answerSchema: CONFIGURATION_ANSWER_SCHEMA
    },
    completionPublication: {
      protocol: COMPLETION_PROTOCOL,
      stages: COMPLETION_PUBLICATION_STAGES,
      refusalCodes: COMPLETION_PUBLICATION_REFUSAL_CODES,
      statusSchema: AGENT_STATUS_SCHEMA
    },
    operations: {
      status: { supported: true, ttyRequired: false, inputSchemas: [] },
      start: {
        supported: true,
        ttyRequired: false,
        inputSchemas: [AGENT_REQUEST_SCHEMA]
      },
      answer: {
        supported: true,
        ttyRequired: false,
        inputSchemas: [
          CONFIGURATION_ANSWER_SCHEMA,
          AGENT_ANSWER_SCHEMA,
          LEGACY_AGENT_ANSWER_SCHEMA
        ]
      },
      approveAdr: { supported: true, ttyRequired: false, inputSchemas: [] },
      approveVerification: {
        supported: true,
        ttyRequired: false,
        inputSchemas: [CONFIGURATION_ANSWER_SCHEMA]
      },
      approvePlan: { supported: true, ttyRequired: false, inputSchemas: [] },
      triage: { supported: true, ttyRequired: false, inputSchemas: [] },
      resume: { supported: true, ttyRequired: false, inputSchemas: [] },
      retry: { supported: true, ttyRequired: false, inputSchemas: [] },
      recover: {
        supported: true,
        ttyRequired: false,
        inputSchemas: [AGENT_RECOVERY_SCHEMA]
      },
      cancel: { supported: true, ttyRequired: false, inputSchemas: [] }
    }
  };
}

function boundedString(
  value: string,
  label: string,
  maximum = MAX_REASON_LENGTH
): string {
  if (value.length === 0 || value.length > maximum || value.includes("\0")) {
    throw statusError(`${label} is empty or exceeds the public status bound.`);
  }
  return value;
}

function boundedNullableString(
  value: string | null,
  label: string,
  maximum = MAX_REASON_LENGTH
): string | null {
  return value === null ? null : boundedString(value, label, maximum);
}

function boundedPath(value: string, label: string): string {
  boundedString(value, label, MAX_PATH_LENGTH);
  if (
    path.posix.isAbsolute(value) ||
    /^[A-Za-z]:[\\/]/.test(value) ||
    value.includes("\\") ||
    path.posix.normalize(value) !== value ||
    value.split("/").some((segment) => segment === "." || segment === "..")
  ) {
    throw statusError(
      `${label} must be a normalized repository-relative path.`
    );
  }
  return value;
}

function boundedArray<T>(value: readonly T[], label: string): readonly T[] {
  if (value.length > MAX_COLLECTION_LENGTH) {
    throw statusError(`${label} exceeds the public status item bound.`);
  }
  return value;
}

function boundedCount(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 1_000_000) {
    throw statusError(`${label} is outside the public status count bound.`);
  }
  return value;
}

function consultationStatusString(
  value: string,
  label: string,
  maximum: number
): string {
  if (
    value.length === 0 ||
    value.length > maximum ||
    /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(value)
  ) {
    throw statusError(`${label} is outside the consultation status bound.`);
  }
  return value;
}

function consultationStatusIdentifier(value: string, label: string): string {
  const identifier = consultationStatusString(value, label, 128);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(identifier)) {
    throw statusError(`${label} is not a canonical identifier.`);
  }
  return identifier;
}

function projectConsultationCard(
  card: DecisionConsultationCard,
  index: number
): DecisionConsultationCard {
  const label = `consultation decision ${index + 1}`;
  if (
    card.evidence.length === 0 ||
    card.evidence.length > 16 ||
    card.affectedRequirements.length === 0 ||
    card.affectedRequirements.length > 32 ||
    card.options.length > 6 ||
    (card.responseMode === "single_choice" && card.options.length < 2) ||
    (card.responseMode === "free_text" && card.options.length !== 0) ||
    card.options.some(
      (option) =>
        option.benefits.length > 8 ||
        option.costs.length > 8 ||
        option.risks.length > 8 ||
        option.consequences.length > 8
    )
  ) {
    throw statusError(`${label} has an unsupported shape.`);
  }
  const options = card.options.map((option, optionIndex) => ({
    optionId: consultationStatusIdentifier(
      option.optionId,
      `${label} option ${optionIndex + 1} id`
    ),
    title: consultationStatusString(
      option.title,
      `${label} option ${optionIndex + 1} title`,
      160
    ),
    benefits: option.benefits.map((value, valueIndex) =>
      consultationStatusString(
        value,
        `${label} option ${optionIndex + 1} benefit ${valueIndex + 1}`,
        500
      )
    ),
    costs: option.costs.map((value, valueIndex) =>
      consultationStatusString(
        value,
        `${label} option ${optionIndex + 1} cost ${valueIndex + 1}`,
        500
      )
    ),
    risks: option.risks.map((value, valueIndex) =>
      consultationStatusString(
        value,
        `${label} option ${optionIndex + 1} risk ${valueIndex + 1}`,
        500
      )
    ),
    consequences: option.consequences.map((value, valueIndex) =>
      consultationStatusString(
        value,
        `${label} option ${optionIndex + 1} consequence ${valueIndex + 1}`,
        500
      )
    )
  }));
  if (
    new Set(options.map((option) => option.optionId)).size !== options.length
  ) {
    throw statusError(`${label} repeats an option identity.`);
  }
  if (
    new Set(card.affectedRequirements).size !== card.affectedRequirements.length
  ) {
    throw statusError(`${label} repeats an affected requirement.`);
  }
  const recommendation =
    card.recommendation === null
      ? null
      : {
          optionId: consultationStatusIdentifier(
            card.recommendation.optionId,
            `${label} recommendation option id`
          ),
          rationale: consultationStatusString(
            card.recommendation.rationale,
            `${label} recommendation rationale`,
            1_000
          )
        };
  if (
    recommendation !== null &&
    !options.some((option) => option.optionId === recommendation.optionId)
  ) {
    throw statusError(`${label} recommends an unknown option.`);
  }
  return {
    decisionId: consultationStatusIdentifier(card.decisionId, `${label} id`),
    title: consultationStatusString(card.title, `${label} title`, 160),
    question: consultationStatusString(
      card.question,
      `${label} question`,
      1_000
    ),
    why: consultationStatusString(card.why, `${label} why`, 1_200),
    affectedRequirements: card.affectedRequirements.map((value, valueIndex) =>
      consultationStatusString(
        value,
        `${label} affected requirement ${valueIndex + 1}`,
        128
      )
    ),
    evidence: card.evidence.map((evidence, evidenceIndex) => {
      if (
        evidence.line !== null &&
        (!Number.isSafeInteger(evidence.line) || evidence.line < 1)
      ) {
        throw statusError(`${label} evidence line is invalid.`);
      }
      return {
        path: boundedPath(
          evidence.path,
          `${label} evidence ${evidenceIndex + 1} path`
        ),
        line: evidence.line,
        detail: consultationStatusString(
          evidence.detail,
          `${label} evidence ${evidenceIndex + 1} detail`,
          1_000
        )
      };
    }),
    decisionOwner: "human",
    responseMode: card.responseMode,
    options,
    recommendation
  };
}

function projectConsultationRequest(
  request: DecisionConsultationRequest
): DecisionConsultationRequest {
  if (request.decisions.length === 0 || request.decisions.length > 3) {
    throw statusError("The consultation request has an unsupported contract.");
  }
  const decisions = request.decisions.map(projectConsultationCard);
  if (
    new Set(decisions.map((decision) => decision.decisionId)).size !==
    decisions.length
  ) {
    throw statusError("The consultation request repeats a decision identity.");
  }
  const projected: DecisionConsultationRequest = {
    schema: DECISION_CONSULTATION_SCHEMA,
    schemaVersion: DECISION_CONSULTATION_SCHEMA_VERSION,
    requestId: consultationStatusIdentifier(request.requestId, "request id"),
    roundId: consultationStatusIdentifier(request.roundId, "round id"),
    decisions
  };
  if (Buffer.byteLength(JSON.stringify(projected), "utf8") > 32 * 1024) {
    throw statusError(
      "The consultation request exceeds the status size bound."
    );
  }
  return projected;
}

function semanticNextAction(status: WorkflowStatus): AgentControlNextAction {
  switch (status.state.status) {
    case "needs_adr_approval":
      return "approve_adr";
    case "needs_plan_approval":
      return "approve_plan";
    case "needs_human_decision": {
      const pending = status.state.pendingHumanDecision;
      if (pending === undefined || pending === null) {
        throw statusError("Human-decision state has no persisted request.");
      }
      if (pending.kind === "configuration_prerequisite")
        return "answer_configuration_prerequisite";
      return pending.kind === "decision_consultation"
        ? "answer_consultation"
        : "answer_escalation";
    }
    case "needs_triage":
      return "triage";
    case "blocked": {
      // A pending runner-owned publication carries its own closed route:
      // I/O resumes, drift cancels until restored, integrity cancels.
      const publication = status.completionPublication;
      if (publication?.pending === true && publication.action !== null)
        return publication.action;
      // A digest-rejected result is repaired through its authorized recovery;
      // resuming its terminal evidence only reproduces the same rejection.
      if (
        status.recovery.eligible &&
        status.recovery.sourceKind === "digest_rejected"
      )
        return "recover";
      return status.retry.eligible
        ? "retry"
        : status.recovery.eligible
          ? "recover"
          : status.recovery.terminalCheckpointPresent === true
            ? "resume"
            : "cancel";
    }
    case "created":
    case "selecting":
    case "planning":
    case "plan_approved":
    case "implementing":
    case "verifying":
    case "reviewing":
    case "fixing":
      return "resume";
    case "done":
    case "cancelled":
      return null;
  }
}

function approvalArtifacts(state: RunState): string[] {
  const artifacts = state.planArtifacts;
  if (
    artifacts?.description === undefined ||
    artifacts.description === null ||
    artifacts.plan === null
  ) {
    throw statusError(
      "Plan approval requires persisted description and plan artifacts."
    );
  }
  return [artifacts.description, ...artifacts.adrs, artifacts.plan].map(
    (value, index) => boundedPath(value, `approval artifact ${index + 1}`)
  );
}

function pendingGate(status: WorkflowStatus): AgentControlPendingGateV3 | null {
  const { state } = status;
  if (state.status === "needs_adr_approval") {
    const artifacts = state.planArtifacts?.adrs ?? [];
    if (artifacts.length === 0) {
      throw statusError(
        "ADR approval requires at least one persisted ADR path."
      );
    }
    const artifactPaths = boundedArray(artifacts, "ADR artifacts").map(
      (value, index) => boundedPath(value, `ADR artifact ${index + 1}`)
    );
    return {
      kind: "adr_approval",
      artifactPaths,
      adrIds: artifactPaths.map((value) => {
        const match = /^(\d{4})-/.exec(path.posix.basename(value));
        if (match?.[1] === undefined) {
          throw statusError("An ADR artifact path has no stable numeric ID.");
        }
        return `ADR-${match[1]}`;
      })
    };
  }
  if (state.status === "needs_plan_approval") {
    return { kind: "plan_approval", artifactPaths: approvalArtifacts(state) };
  }
  if (state.status === "needs_human_decision") {
    const decision = state.pendingHumanDecision;
    if (decision === undefined || decision === null) {
      throw statusError("Human-decision state has no persisted request.");
    }
    if (decision.kind === "configuration_prerequisite") {
      const request = parseConfigurationPrerequisite(
        decision,
        state.configurationSetup?.configSchemaVersion ?? 2
      );
      return {
        kind: request.kind,
        runId: request.runId,
        decisionId: request.decisionId,
        proposalId: request.proposalId,
        requestedAt: request.requestedAt,
        reason: request.reason,
        proposal: request.proposal,
        options: request.options,
        checkpoint: {
          attemptKind: request.continuation.attemptKind,
          verificationRound: request.continuation.verificationRound.ordinal,
          eligible: state.activeAttempt === null && state.activeProcess === null
        },
        repairCommands: status.configurationPrerequisite?.repairCommands ?? [
          ...(request.reason === "missing_profile"
            ? [`banzai verify add ${request.proposal.projectType}`]
            : []),
          "banzai verify list",
          "banzai resume"
        ]
      };
    }
    if (decision.kind === "decision_consultation") {
      return {
        kind: "decision_consultation",
        phase: "plan",
        summary: boundedString(decision.summary, "decision summary"),
        runId: boundedString(state.runId, "run id", MAX_IDENTIFIER_LENGTH),
        request: projectConsultationRequest(decision.request)
      };
    }
    return {
      kind: "escalation",
      phase: decision.phase,
      summary: boundedString(decision.summary, "decision summary"),
      questions: boundedArray(
        humanDecisionQuestions(
          decision,
          decision.phase === "implementation" &&
            state.workflowSelection?.workflow !== undefined &&
            state.workflowSelection.workflow !== "strict"
        ),
        "decision questions"
      ).map((question, index) =>
        boundedString(
          question,
          `decision question ${index + 1}`,
          MAX_QUESTION_LENGTH
        )
      )
    };
  }
  if (state.status === "needs_triage") {
    if (state.latestReview === null || status.latestReview === null) {
      throw statusError("Review triage state has no latest review evidence.");
    }
    return {
      kind: "review_triage",
      iteration: state.latestReview.iteration,
      artifactPath:
        state.latestReview.artifactPath === undefined
          ? null
          : boundedPath(state.latestReview.artifactPath, "review artifact"),
      findings: boundedArray(
        status.latestReview.findings,
        "review findings"
      ).map((finding, index) => ({
        id: boundedString(
          finding.id,
          `review finding ${index + 1} id`,
          MAX_IDENTIFIER_LENGTH
        ),
        severity: finding.severity,
        category: finding.category,
        summary: boundedString(
          finding.summary,
          `review finding ${finding.id} summary`
        ),
        evidencePath:
          finding.evidence[0]?.path === undefined
            ? null
            : boundedPath(
                finding.evidence[0].path,
                `review finding ${finding.id} evidence path`
              )
      }))
    };
  }
  return null;
}

/**
 * Bounded projection of the schema-7 publication cursor. Only the newest
 * strict attempt's durable stage, closed refusal code and the validated
 * publisher identity leave the runner; digests, paths and prose do not.
 */
function completionPublication(
  state: RunState
): AgentControlCompletionPublicationV1 | null {
  const cursor = state.completionPublication ?? null;
  if (cursor === null) return null;
  const summary = state.planTaskCompletion;
  return {
    attemptId: boundedString(
      cursor.attemptId,
      "completion publication attempt id",
      MAX_IDENTIFIER_LENGTH
    ),
    attemptKind: cursor.attemptKind,
    stage: cursor.stage,
    refusalCode: cursor.refusal?.code ?? null,
    publisherAttemptId:
      summary?.status === "valid" && summary.schemaVersion === 2
        ? boundedString(
            summary.publisherAttemptId ?? "",
            "completion publisher attempt id",
            MAX_IDENTIFIER_LENGTH
          )
        : null
  };
}

export function projectAgentControlStatus(
  status: WorkflowStatus
): AgentControlStatusV4 {
  const { state } = status;
  const recoveryWorkspace = status.recovery.workspace;
  if (
    status.recovery.eligible &&
    (status.recovery.attemptId === null ||
      status.recovery.phase === null ||
      status.recovery.authorization === null ||
      status.recovery.recoveryIdentity === null ||
      recoveryWorkspace === null)
  ) {
    throw statusError("Eligible recovery is missing required public evidence.");
  }
  if (
    recoveryWorkspace !== null &&
    recoveryWorkspace.total !==
      recoveryWorkspace.added +
        recoveryWorkspace.modified +
        recoveryWorkspace.deleted
  ) {
    throw statusError("Recovery workspace counts are inconsistent.");
  }
  const verificationResults = boundedArray(
    state.verification,
    "verification results"
  ).map((result, index) => ({
    ordinal: index + 1,
    outcome:
      result.exitCode === 0 && result.signal === null
        ? ("pass" as const)
        : ("fail" as const),
    exitCode: result.exitCode,
    signal: boundedNullableString(
      result.signal,
      `verification result ${index + 1} signal`,
      MAX_IDENTIFIER_LENGTH
    )
  }));
  const passed = verificationResults.filter(
    (result) => result.outcome === "pass"
  ).length;
  const completion = reviewCompletion(status);
  const diagnostics = boundedArray(
    status.taskCompletion.diagnostics,
    "task completion diagnostics"
  ).map((diagnostic, index) => ({
    code: boundedString(
      diagnostic.code,
      `task diagnostic ${index + 1} code`,
      MAX_IDENTIFIER_LENGTH
    ),
    taskId: boundedNullableString(
      diagnostic.taskId,
      `task diagnostic ${index + 1} task id`,
      MAX_IDENTIFIER_LENGTH
    ),
    message: boundedString(
      diagnostic.message,
      `task diagnostic ${index + 1} message`
    )
  }));
  return {
    schema: AGENT_STATUS_SCHEMA,
    schemaVersion: AGENT_STATUS_SCHEMA_VERSION,
    activeRun: {
      runId: boundedString(state.runId, "run id", MAX_IDENTIFIER_LENGTH),
      slug: boundedString(state.slug, "run slug", MAX_IDENTIFIER_LENGTH),
      state: state.status,
      route:
        state.workflowSelection === undefined ||
        state.workflowSelection === null
          ? null
          : {
              workflow: state.workflowSelection.workflow,
              reason: boundedString(
                state.workflowSelection.reason,
                "workflow route reason"
              )
            },
      nextAction: semanticNextAction(status),
      blocked:
        state.status !== "blocked"
          ? null
          : {
              from: state.blockedFrom,
              reason: boundedString(
                state.blockReason ?? "Blocked without a persisted reason.",
                "block reason"
              )
            },
      retry: {
        eligible: status.retry.eligible,
        reason: boundedString(status.retry.reason, "retry reason"),
        attemptId: boundedNullableString(
          status.retry.attemptId,
          "retry attempt id",
          MAX_IDENTIFIER_LENGTH
        )
      },
      recovery: {
        eligible: status.recovery.eligible,
        reason: boundedString(status.recovery.reason, "recovery reason"),
        warning: boundedString(status.recovery.warning, "recovery warning"),
        attemptId: boundedNullableString(
          status.recovery.attemptId,
          "recovery attempt id",
          MAX_IDENTIFIER_LENGTH
        ),
        phase: status.recovery.phase,
        authorization: status.recovery.authorization,
        recoveryIdentity: boundedNullableString(
          status.recovery.recoveryIdentity,
          "recovery identity",
          64
        ),
        workspace:
          recoveryWorkspace === null
            ? null
            : {
                added: boundedCount(recoveryWorkspace.added, "recovery added"),
                modified: boundedCount(
                  recoveryWorkspace.modified,
                  "recovery modified"
                ),
                deleted: boundedCount(
                  recoveryWorkspace.deleted,
                  "recovery deleted"
                ),
                total: boundedCount(recoveryWorkspace.total, "recovery total")
              }
      },
      pendingGate: pendingGate(status),
      approval: {
        planValid: status.planApprovalValid,
        reviewSnapshotValid: status.reviewValid
      },
      taskCompletion: {
        state: status.taskCompletion.state,
        source: status.taskCompletion.source,
        completed: status.taskCompletion.completed,
        total: status.taskCompletion.total,
        diagnostics
      },
      completionPublication: completionPublication(state),
      ...(state.verificationMode === "task"
        ? {
            taskVerification: {
              outcome:
                state.taskVerification?.applicability.outcome ??
                ("not_run" as const),
              complete: state.taskVerification?.applicability.complete ?? false,
              absenceReason:
                state.taskVerification?.applicability.absenceReason ?? null,
              checks:
                state.taskVerification?.applicability.dispositions.map(
                  ({ checkId, required, kind, attemptId }) => ({
                    checkId,
                    required,
                    kind,
                    attemptId
                  })
                ) ?? []
            }
          }
        : {}),
      verification: {
        total: verificationResults.length,
        passed,
        failed: verificationResults.length - passed,
        results: verificationResults
      },
      review:
        state.latestReview === null || status.latestReview === null
          ? null
          : {
              iteration: state.latestReview.iteration,
              verdict: status.latestReview.verdict,
              artifactPath:
                state.latestReview.artifactPath === undefined
                  ? null
                  : boundedPath(
                      state.latestReview.artifactPath,
                      "review artifact"
                    ),
              completion
            }
    }
  };
}

export function emptyAgentControlStatus(): AgentControlStatusV4 {
  return {
    schema: AGENT_STATUS_SCHEMA,
    schemaVersion: AGENT_STATUS_SCHEMA_VERSION,
    activeRun: null
  };
}

export function renderAgentControlJson(
  value: AgentControlCapabilitiesV5 | AgentControlStatusV4
): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}
