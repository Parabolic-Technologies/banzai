import { createHash, randomUUID } from "node:crypto";
import { BanzaiError } from "./errors.js";
import type {
  OrchestratorConfig,
  RunState,
  VerificationCommand,
  VerificationProfile
} from "./types.js";
import {
  DETECTABLE_PROJECT_TYPES,
  VERIFICATION_EXAMPLES,
  isRepositoryHygieneCommand,
  nodeVerificationSuggestions,
  type ApplicationProjectType,
  type VerificationPackageManager,
  type VerificationProjectInspection
} from "./verification.js";

export const CONFIGURATION_PREREQUISITE_SCHEMA =
  "banzai-configuration-prerequisite/v1" as const;
export const CONFIGURATION_ACTIONS = [
  "accept",
  "edit",
  "skip",
  "cancel"
] as const;
export type ConfigurationAction = (typeof CONFIGURATION_ACTIONS)[number];
export type ConfigurationSource =
  | {
      kind: "project_scripts";
      path: "package.json";
      packageManager: VerificationPackageManager | null;
      scriptNames: string[];
    }
  | {
      kind: "documented_example";
      document: "documentation/verification-examples.md";
      section: string;
      projectType: ApplicationProjectType;
    }
  | { kind: "human_edit"; proposalId: string };

export interface ConfigurationContinuation {
  attemptId: string;
  attemptKind: "implementation" | "fix";
  verificationRound: { id: string; ordinal: number };
  baseCommit: string;
  workId: string;
  workBindingSha256: string;
  approvalDigest: string | null;
  workflowSelectionDigest: string | null;
}

export interface ConfigurationProposal {
  projectType: ApplicationProjectType;
  profile: { id: string; commands: VerificationCommand[] };
  source: ConfigurationSource;
}

export interface ConfigurationPrerequisiteRequest {
  schema: typeof CONFIGURATION_PREREQUISITE_SCHEMA;
  schemaVersion: 1;
  kind: "configuration_prerequisite";
  runId: string;
  decisionId: string;
  proposalId: string;
  requestedAt: string;
  reason: "missing_profile" | "missing_script";
  proposal: ConfigurationProposal;
  options: typeof CONFIGURATION_ACTIONS;
  configSha256: string;
  sourceSha256: string;
  continuation: ConfigurationContinuation;
}

export interface ConfigurationDecisionRecord extends ConfigurationPrerequisiteRequest {
  action: ConfigurationAction;
  decidedAt: string;
  decidedBy: string;
}

export interface ConfigurationResolution {
  id: string;
  decisionId: string;
  proposalId: string;
  kind: "accepted" | "skipped" | "satisfied_by_configuration";
  at: string;
  configSha256: string;
  sourceSha256: string;
  operationId: string | null;
  continuation: ConfigurationContinuation;
}

export interface ConfigurationSkip {
  id: string;
  runId: string;
  decisionId: string;
  proposalId: string;
  projectTypes: ApplicationProjectType[];
  configurationDigest: string;
}

export interface ConfigurationSetupState {
  configSchemaVersion: 2 | 3;
  configurationDigest: string;
  coverage: "configured" | "bootstrap_deferred" | "skipped";
  projectTypes: ApplicationProjectType[];
  uncoveredTypes: ApplicationProjectType[];
  continuation: ConfigurationContinuation | null;
  resolutions: ConfigurationResolution[];
  skip: ConfigurationSkip | null;
  transactions: string[];
}

export function parseConfigurationSetupState(
  value: unknown
): ConfigurationSetupState {
  const record = configurationObject(value, [
    "configSchemaVersion",
    "configurationDigest",
    "coverage",
    "projectTypes",
    "uncoveredTypes",
    "continuation",
    "resolutions",
    "skip",
    "transactions"
  ]);
  if (
    (record.configSchemaVersion !== 2 && record.configSchemaVersion !== 3) ||
    !["configured", "bootstrap_deferred", "skipped"].includes(
      record.coverage as string
    )
  )
    configurationInvalid();
  function types(value: unknown): ApplicationProjectType[] {
    const result = boundedArray(value, 9).map(applicationType);
    if (
      new Set(result).size !== result.length ||
      JSON.stringify([...result].sort()) !== JSON.stringify(result)
    )
      configurationInvalid();
    return result;
  }
  const resolutions = boundedArray(record.resolutions, 1000).map(
    (value): ConfigurationResolution => {
      const resolution = configurationObject(value, [
        "id",
        "decisionId",
        "proposalId",
        "kind",
        "at",
        "configSha256",
        "sourceSha256",
        "operationId",
        "continuation"
      ]);
      if (
        !["accepted", "skipped", "satisfied_by_configuration"].includes(
          resolution.kind as string
        )
      )
        configurationInvalid();
      return {
        id: configurationUuid(resolution.id),
        decisionId: configurationUuid(resolution.decisionId),
        proposalId: configurationUuid(resolution.proposalId),
        kind: resolution.kind as ConfigurationResolution["kind"],
        at: configurationText(resolution.at, 24),
        configSha256: configurationHash(resolution.configSha256),
        sourceSha256: configurationHash(resolution.sourceSha256),
        operationId:
          resolution.operationId === null
            ? null
            : configurationUuid(resolution.operationId),
        continuation: parseConfigurationContinuation(resolution.continuation)
      };
    }
  );
  let skip: ConfigurationSkip | null = null;
  if (record.skip !== null) {
    const item = configurationObject(record.skip, [
      "id",
      "runId",
      "decisionId",
      "proposalId",
      "projectTypes",
      "configurationDigest"
    ]);
    skip = {
      id: configurationUuid(item.id),
      runId: configurationText(item.runId),
      decisionId: configurationUuid(item.decisionId),
      proposalId: configurationUuid(item.proposalId),
      projectTypes: types(item.projectTypes),
      configurationDigest: configurationHash(item.configurationDigest)
    };
  }
  const transactions = boundedArray(record.transactions, 1000).map(
    configurationUuid
  );
  if (
    new Set(transactions).size !== transactions.length ||
    new Set(resolutions.map((item) => item.id)).size !== resolutions.length ||
    new Set(resolutions.map((item) => item.proposalId)).size !==
      resolutions.length
  )
    configurationInvalid();
  return {
    configSchemaVersion: record.configSchemaVersion,
    configurationDigest: configurationHash(record.configurationDigest),
    coverage: record.coverage as ConfigurationSetupState["coverage"],
    projectTypes: types(record.projectTypes),
    uncoveredTypes: types(record.uncoveredTypes),
    continuation:
      record.continuation === null
        ? null
        : parseConfigurationContinuation(record.continuation),
    resolutions,
    skip,
    transactions
  };
}

export function configurationInvalid(
  message = "Invalid configuration proposal. Reopen the current proposal and use its structured editor."
): never {
  throw new BanzaiError("CONFIGURATION_PROPOSAL_INVALID", message);
}

export function configurationObject(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = []
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    configurationInvalid();
  const record = value as Record<string, unknown>;
  if (
    required.some((key) => !Object.hasOwn(record, key)) ||
    Object.keys(record).some(
      (key) => !required.includes(key) && !optional.includes(key)
    )
  )
    configurationInvalid();
  return record;
}

export function configurationText(
  value: unknown,
  maximum = 200,
  empty = false
): string {
  if (
    typeof value !== "string" ||
    (!empty && value.length === 0) ||
    value.length > maximum ||
    /[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/u.test(value)
  )
    configurationInvalid(
      "Proposal text contains unsafe controls or exceeds its bound. Edit it before approval."
    );
  return value;
}

export function configurationId(value: unknown): string {
  const id = configurationText(value, 80);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) configurationInvalid();
  return id;
}

export function configurationUuid(value: unknown): string {
  const id = configurationText(value, 36);
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(
      id
    )
  )
    configurationInvalid();
  return id;
}

export function configurationHash(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value))
    configurationInvalid();
  return value;
}

/** Shared private-state reader; grants no continuation or config-write authority. */
/**
 * Whether a persisted run carries guided configuration state. Schema 6 always
 * does; schema 7 does exactly when its config-2/3 bootstrap carried it over,
 * so a config-1 run gains no configuration semantics from the transition.
 */
export function hasConfigurationSetup(
  state: Pick<RunState, "schemaVersion"> & {
    configurationSetup?: unknown;
  }
): boolean {
  return (
    state.schemaVersion === 6 ||
    (state.schemaVersion === 7 && state.configurationSetup !== undefined)
  );
}

export function validateConfigurationStateEnvelope(value: unknown): void {
  if (!value || typeof value !== "object" || Array.isArray(value))
    configurationInvalid();
  const state = value as Record<string, unknown>;
  if (
    (state.schemaVersion === 8 ||
      state.schemaVersion === 9 ||
      state.schemaVersion === 10) &&
    state.verificationMode !== "task"
  )
    configurationInvalid();
  if (
    state.schemaVersion !== 6 &&
    !(state.schemaVersion === 7 && "configurationSetup" in state)
  ) {
    if (
      (Array.isArray(state.humanDecisions) &&
        state.humanDecisions.some(
          (record: unknown) =>
            (record as { kind?: unknown } | null)?.kind ===
            "configuration_prerequisite"
        )) ||
      "configurationSetup" in state ||
      ("verificationMode" in state &&
        !(
          (state.schemaVersion === 8 ||
            state.schemaVersion === 9 ||
            state.schemaVersion === 10) &&
          state.verificationMode === "task"
        )) ||
      (state.pendingHumanDecision as { kind?: unknown } | null)?.kind ===
        "configuration_prerequisite"
    )
      configurationInvalid();
    return;
  }
  const setup = parseConfigurationSetupState(state.configurationSetup);
  const binding = (
    state.artifactBinding as { binding?: { schemaVersion?: unknown } } | null
  )?.binding;
  if (
    (state.verificationMode !== "ordered" &&
      state.verificationMode !== "policy") ||
    binding?.schemaVersion !== (state.verificationMode === "policy" ? 2 : 1) ||
    (state.verificationMode === "policy" && setup.configSchemaVersion !== 3)
  )
    configurationInvalid();
  const rawRecords = state.humanDecisions ?? [];
  if (!Array.isArray(rawRecords)) configurationInvalid();
  const records = rawRecords
    .filter(
      (record: unknown) =>
        (record as { kind?: unknown } | null)?.kind ===
        "configuration_prerequisite"
    )
    .map((record: unknown) => {
      const item = configurationObject(record, [
        "schema",
        "schemaVersion",
        "kind",
        "runId",
        "decisionId",
        "proposalId",
        "requestedAt",
        "reason",
        "proposal",
        "options",
        "configSha256",
        "sourceSha256",
        "continuation",
        "action",
        "decidedBy",
        "decidedAt"
      ]);
      const { action, decidedBy, decidedAt, ...request } = item;
      if (!CONFIGURATION_ACTIONS.some((candidate) => candidate === action))
        configurationInvalid();
      configurationText(decidedBy);
      if (
        typeof decidedAt !== "string" ||
        !Number.isFinite(Date.parse(decidedAt)) ||
        new Date(decidedAt).toISOString() !== decidedAt
      )
        configurationInvalid();
      const parsed = parseConfigurationPrerequisite(
        request,
        setup.configSchemaVersion
      );
      if (parsed.runId !== state.runId) configurationInvalid();
      return { ...parsed, action };
    });
  if (
    new Set(records.map((record) => record.proposalId)).size !== records.length
  )
    configurationInvalid();
  const pending = state.pendingHumanDecision as { kind?: unknown } | null;
  if (pending?.kind === "configuration_prerequisite") {
    const request = parseConfigurationPrerequisite(
      pending,
      setup.configSchemaVersion
    );
    if (
      state.status !== "needs_human_decision" ||
      request.runId !== state.runId ||
      records.some((record) => record.proposalId === request.proposalId) ||
      JSON.stringify(request.continuation) !==
        JSON.stringify(setup.continuation) ||
      state.activeAttempt !== null ||
      state.activeProcess !== null
    )
      configurationInvalid();
  }
  for (const resolution of setup.resolutions) {
    if (
      !Number.isFinite(Date.parse(resolution.at)) ||
      new Date(resolution.at).toISOString() !== resolution.at
    )
      configurationInvalid();
    const record = records.find(
      (item) =>
        item.proposalId === resolution.proposalId &&
        item.decisionId === resolution.decisionId
    );
    if (
      resolution.kind === "satisfied_by_configuration"
        ? record !== undefined || resolution.operationId !== null
        : record?.action !==
          (resolution.kind === "accepted" ? "accept" : "skip")
    )
      configurationInvalid();
    if (
      resolution.kind === "accepted"
        ? resolution.operationId === null ||
          !setup.transactions.includes(resolution.operationId)
        : resolution.operationId !== null
    )
      configurationInvalid();
    if (
      record &&
      JSON.stringify(record.continuation) !==
        JSON.stringify(resolution.continuation)
    )
      configurationInvalid();
  }
  if (
    setup.skip &&
    (setup.skip.runId !== state.runId ||
      !setup.resolutions.some(
        (resolution) =>
          resolution.kind === "skipped" &&
          resolution.proposalId === setup.skip?.proposalId &&
          resolution.decisionId === setup.skip.decisionId
      ))
  )
    configurationInvalid();
  if (setup.coverage === "skipped" && !setup.skip) configurationInvalid();
}

export function configurationDigest(value: unknown): string {
  return createHash("sha256")
    .update(
      typeof value === "string" || Buffer.isBuffer(value)
        ? value
        : JSON.stringify(value)
    )
    .digest("hex");
}

function applicationType(value: unknown): ApplicationProjectType {
  if (
    value !== "custom" &&
    !DETECTABLE_PROJECT_TYPES.some((type) => type === value)
  )
    configurationInvalid();
  return value as ApplicationProjectType;
}

function boundedArray(value: unknown, maximum = 200): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) configurationInvalid();
  return value;
}

export function parseConfigurationContinuation(
  value: unknown
): ConfigurationContinuation {
  const record = configurationObject(value, [
    "attemptId",
    "attemptKind",
    "verificationRound",
    "baseCommit",
    "workId",
    "workBindingSha256",
    "approvalDigest",
    "workflowSelectionDigest"
  ]);
  const round = configurationObject(record.verificationRound, [
    "id",
    "ordinal"
  ]);
  if (record.attemptKind !== "implementation" && record.attemptKind !== "fix")
    configurationInvalid();
  if (!Number.isSafeInteger(round.ordinal) || (round.ordinal as number) < 1)
    configurationInvalid();
  if (
    typeof record.baseCommit !== "string" ||
    !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(record.baseCommit)
  )
    configurationInvalid();
  const approvalDigest =
    record.approvalDigest === null
      ? null
      : configurationHash(record.approvalDigest);
  const workflowSelectionDigest =
    record.workflowSelectionDigest === null
      ? null
      : configurationHash(record.workflowSelectionDigest);
  if (approvalDigest === null && workflowSelectionDigest === null)
    configurationInvalid();
  return {
    attemptId: configurationText(record.attemptId),
    attemptKind: record.attemptKind,
    verificationRound: {
      id: configurationText(round.id),
      ordinal: round.ordinal as number
    },
    baseCommit: record.baseCommit,
    workId: configurationUuid(record.workId),
    workBindingSha256: configurationHash(record.workBindingSha256),
    approvalDigest,
    workflowSelectionDigest
  };
}

export function parseConfigurationSource(value: unknown): ConfigurationSource {
  const kind = (value as { kind?: unknown } | null)?.kind;
  if (kind === "project_scripts") {
    const source = configurationObject(value, [
      "kind",
      "path",
      "packageManager",
      "scriptNames"
    ]);
    if (
      source.path !== "package.json" ||
      (source.packageManager !== null &&
        !["npm", "pnpm", "yarn", "bun"].includes(
          source.packageManager as string
        ))
    )
      configurationInvalid();
    const scriptNames = boundedArray(source.scriptNames, 4).map((name) =>
      configurationText(name)
    );
    if (
      new Set(scriptNames).size !== scriptNames.length ||
      scriptNames.some(
        (name) => !["test", "lint", "build", "typecheck"].includes(name)
      )
    )
      configurationInvalid();
    return {
      kind,
      path: "package.json",
      packageManager:
        source.packageManager as VerificationPackageManager | null,
      scriptNames
    };
  }
  if (kind === "documented_example") {
    const source = configurationObject(value, [
      "kind",
      "document",
      "section",
      "projectType"
    ]);
    if (source.document !== "documentation/verification-examples.md")
      configurationInvalid();
    const projectType = applicationType(source.projectType);
    const section = configurationId(source.section);
    if (
      section !==
      (VERIFICATION_EXAMPLES[projectType]?.section ??
        "mixed-and-nested-projects")
    )
      configurationInvalid();
    return {
      kind,
      document: "documentation/verification-examples.md",
      section,
      projectType
    };
  }
  if (kind === "human_edit") {
    const source = configurationObject(value, ["kind", "proposalId"]);
    return { kind, proposalId: configurationUuid(source.proposalId) };
  }
  return configurationInvalid();
}

export function parseConfigurationCommandInput(
  value: unknown
): VerificationCommand {
  return parseCommand(value, 3, true);
}

function parseCommand(
  value: unknown,
  schemaVersion: 2 | 3,
  input: boolean
): VerificationCommand {
  const command = configurationObject(
    value,
    [
      "name",
      "command",
      "args",
      "timeoutMs",
      ...(!input && schemaVersion === 3 ? ["id"] : [])
    ],
    [
      ...(input && schemaVersion === 3 ? ["id"] : []),
      ...(!input && schemaVersion === 3
        ? ["evidence", "ignoreExplanatory"]
        : [])
    ]
  );
  const args = boundedArray(command.args).map((arg) =>
    configurationText(arg, 4096, true)
  );
  if (
    !Number.isSafeInteger(command.timeoutMs) ||
    (command.timeoutMs as number) <= 0 ||
    (command.timeoutMs as number) > 86_400_000
  )
    configurationInvalid();
  if (
    command.evidence !== undefined &&
    !["fresh", "equivalent_evidence"].includes(command.evidence as string)
  )
    configurationInvalid();
  if (
    command.ignoreExplanatory !== undefined &&
    typeof command.ignoreExplanatory !== "boolean"
  )
    configurationInvalid();
  return {
    ...(command.id === undefined ? {} : { id: configurationId(command.id) }),
    name: configurationText(command.name),
    command: configurationText(command.command, 500),
    args,
    timeoutMs: command.timeoutMs as number,
    ...(!input && schemaVersion === 3
      ? {
          evidence:
            (command.evidence as VerificationCommand["evidence"]) ?? "fresh",
          ignoreExplanatory: command.ignoreExplanatory === true
        }
      : {})
  };
}

export function parseConfigurationProposal(
  value: unknown,
  schemaVersion: 2 | 3
): ConfigurationProposal {
  const proposal = configurationObject(value, [
    "projectType",
    "profile",
    "source"
  ]);
  const profile = configurationObject(proposal.profile, ["id", "commands"]);
  const commands = boundedArray(profile.commands).map((command) =>
    parseCommand(command, schemaVersion, false)
  );
  if (
    schemaVersion === 3 &&
    new Set(commands.map((command) => command.id)).size !== commands.length
  )
    configurationInvalid();
  const source = parseConfigurationSource(proposal.source);
  const projectType = applicationType(proposal.projectType);
  if (
    (source.kind === "project_scripts" &&
      (projectType !== "node" ||
        (source.packageManager === null && commands.length > 0))) ||
    (source.kind === "documented_example" && source.projectType !== projectType)
  )
    configurationInvalid();
  const result = {
    projectType,
    profile: { id: configurationId(profile.id), commands },
    source
  };
  if (Buffer.byteLength(JSON.stringify(result)) > 64 * 1024)
    configurationInvalid(
      "The proposal exceeds 64 KiB. Reduce it in the structured editor before approval."
    );
  return result;
}

export function parseConfigurationPrerequisite(
  value: unknown,
  schemaVersion: 2 | 3
): ConfigurationPrerequisiteRequest {
  const record = configurationObject(value, [
    "schema",
    "schemaVersion",
    "kind",
    "runId",
    "decisionId",
    "proposalId",
    "requestedAt",
    "reason",
    "proposal",
    "options",
    "configSha256",
    "sourceSha256",
    "continuation"
  ]);
  if (
    record.schema !== CONFIGURATION_PREREQUISITE_SCHEMA ||
    record.schemaVersion !== 1 ||
    record.kind !== "configuration_prerequisite" ||
    !["missing_profile", "missing_script"].includes(record.reason as string) ||
    JSON.stringify(record.options) !== JSON.stringify(CONFIGURATION_ACTIONS)
  )
    configurationInvalid();
  const requestedAt = configurationText(record.requestedAt, 24);
  if (
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(requestedAt) ||
    !Number.isFinite(Date.parse(requestedAt)) ||
    new Date(requestedAt).toISOString() !== requestedAt
  )
    configurationInvalid();
  const result: ConfigurationPrerequisiteRequest = {
    schema: CONFIGURATION_PREREQUISITE_SCHEMA,
    schemaVersion: 1,
    kind: "configuration_prerequisite",
    runId: configurationText(record.runId),
    decisionId: configurationUuid(record.decisionId),
    proposalId: configurationUuid(record.proposalId),
    requestedAt,
    reason: record.reason as ConfigurationPrerequisiteRequest["reason"],
    proposal: parseConfigurationProposal(record.proposal, schemaVersion),
    options: CONFIGURATION_ACTIONS,
    configSha256: configurationHash(record.configSha256),
    sourceSha256: configurationHash(record.sourceSha256),
    continuation: parseConfigurationContinuation(record.continuation)
  };
  if (Buffer.byteLength(JSON.stringify(result)) > 64 * 1024)
    configurationInvalid();
  return result;
}

export function normalizedVerificationCommand(
  command: VerificationCommand
): string {
  return JSON.stringify({
    name: command.name,
    command: command.command,
    args: command.args,
    timeoutMs: command.timeoutMs,
    evidence: command.evidence ?? "fresh",
    ignoreExplanatory: command.ignoreExplanatory ?? false
  });
}

export function allocateVerificationCommandId(
  knownIds: Set<string>,
  uuid: () => string = randomUUID
): string {
  for (let attempt = 0; attempt < 100; attempt++) {
    const id = `check-${configurationUuid(uuid())}`;
    if (!knownIds.has(id)) {
      knownIds.add(id);
      return id;
    }
  }
  return configurationInvalid(
    "Unable to allocate a unique command identity. Retry to obtain a fresh preview."
  );
}

export function reviseVerificationProfile(
  input: unknown,
  original: ConfigurationProposal["profile"],
  schemaVersion: 2 | 3,
  knownIds: ReadonlySet<string>,
  uuid: () => string = randomUUID
): ConfigurationProposal["profile"] {
  const profile = configurationObject(input, ["id", "commands"]);
  if (profile.id !== original.id)
    configurationInvalid("Editing a proposal must preserve its profile ID.");
  const occupied = new Set([
    ...knownIds,
    ...original.commands.flatMap((command) => (command.id ? [command.id] : []))
  ]);
  const seen = new Set<string>();
  const commands = boundedArray(profile.commands).map((value) => {
    const command = parseCommand(value, schemaVersion, true);
    if (schemaVersion === 2) return command;
    const prior =
      command.id === undefined
        ? undefined
        : original.commands.find((candidate) => candidate.id === command.id);
    if (command.id !== undefined && (!prior || seen.has(command.id)))
      configurationInvalid(
        "Command IDs may only refer once to an existing command in this preview."
      );
    if (command.id) seen.add(command.id);
    const definition = {
      ...command,
      evidence: prior?.evidence ?? "fresh",
      ignoreExplanatory: prior?.ignoreExplanatory ?? false
    };
    return {
      ...definition,
      id:
        prior?.id !== undefined &&
        normalizedVerificationCommand(prior) ===
          normalizedVerificationCommand(definition)
          ? prior.id
          : allocateVerificationCommandId(occupied, uuid)
    };
  });
  return { id: original.id, commands };
}

export function verificationProposal(
  config: OrchestratorConfig,
  inspection: VerificationProjectInspection,
  projectType: ApplicationProjectType,
  knownIds: ReadonlySet<string>,
  manager: VerificationPackageManager | null = inspection.node
    ?.packageManager ?? null
): ConfigurationProposal {
  if (config.schemaVersion !== 2 && config.schemaVersion !== 3)
    configurationInvalid(
      "Guided profiles require schema 2 or 3. Follow the documented legacy migration first."
    );
  if (config.verification.profiles.length >= 50)
    configurationInvalid(
      "The configuration already has 50 profiles. Use banzai verify edit or remove before adding another."
    );
  const profileIds = new Set(
    config.verification.profiles.map((profile) => profile.id)
  );
  let id: string = projectType;
  for (let n = 2; profileIds.has(id); n++) id = `${projectType}-${n}`;
  const example = VERIFICATION_EXAMPLES[projectType];
  const source: ConfigurationSource =
    projectType === "node"
      ? {
          kind: "project_scripts",
          path: "package.json",
          packageManager: manager,
          scriptNames: inspection.node?.suggestedScriptNames ?? []
        }
      : {
          kind: "documented_example",
          document: "documentation/verification-examples.md",
          section: example?.section ?? "mixed-and-nested-projects",
          projectType
        };
  const suggestions =
    projectType === "node"
      ? manager
        ? nodeVerificationSuggestions(inspection, manager)
        : []
      : structuredClone(example?.commands ?? []);
  const occupied = new Set([
    ...knownIds,
    ...config.verification.profiles.flatMap((profile) =>
      profile.commands.flatMap((command) => (command.id ? [command.id] : []))
    )
  ]);
  const profile = reviseVerificationProfile(
    { id, commands: suggestions },
    { id, commands: [] },
    config.schemaVersion,
    occupied
  );
  return parseConfigurationProposal(
    { projectType, profile, source },
    config.schemaVersion
  );
}

export function substantiveProposal(proposal: ConfigurationProposal): boolean {
  return proposal.profile.commands.some(
    (command) => !isRepositoryHygieneCommand(command)
  );
}

export function proposalAsProfile(
  proposal: ConfigurationProposal
): VerificationProfile {
  return {
    id: proposal.profile.id,
    projectType: proposal.projectType,
    commands: proposal.profile.commands
  };
}
