// Generated from orchestrator persisted readers by npm run build. Do not edit.

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

// src/verification.ts
var DETECTABLE_PROJECT_TYPES = [
  "dotnet",
  "go",
  "jvm",
  "node",
  "php",
  "python",
  "ruby",
  "rust"
];
var MAX_MARKER_BYTES = 1024 * 1024;
var VERIFICATION_EXAMPLES = {
  python: {
    section: "python-with-pytest",
    commands: [
      {
        name: "pytest",
        command: ".venv/bin/python",
        args: ["-m", "pytest"],
        timeoutMs: 6e5
      }
    ]
  },
  go: {
    section: "go",
    commands: [
      {
        name: "go tests",
        command: "go",
        args: ["test", "./..."],
        timeoutMs: 6e5
      }
    ]
  }
};

// src/configuration-prerequisite.ts
var CONFIGURATION_PREREQUISITE_SCHEMA = "banzai-configuration-prerequisite/v1";
var CONFIGURATION_ACTIONS = [
  "accept",
  "edit",
  "skip",
  "cancel"
];
function parseConfigurationSetupState(value) {
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
  if (record.configSchemaVersion !== 2 && record.configSchemaVersion !== 3 || !["configured", "bootstrap_deferred", "skipped"].includes(
    record.coverage
  ))
    configurationInvalid();
  function types(value2) {
    const result = boundedArray(value2, 9).map(applicationType);
    if (new Set(result).size !== result.length || JSON.stringify([...result].sort()) !== JSON.stringify(result))
      configurationInvalid();
    return result;
  }
  const resolutions = boundedArray(record.resolutions, 1e3).map(
    (value2) => {
      const resolution = configurationObject(value2, [
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
      if (!["accepted", "skipped", "satisfied_by_configuration"].includes(
        resolution.kind
      ))
        configurationInvalid();
      return {
        id: configurationUuid(resolution.id),
        decisionId: configurationUuid(resolution.decisionId),
        proposalId: configurationUuid(resolution.proposalId),
        kind: resolution.kind,
        at: configurationText(resolution.at, 24),
        configSha256: configurationHash(resolution.configSha256),
        sourceSha256: configurationHash(resolution.sourceSha256),
        operationId: resolution.operationId === null ? null : configurationUuid(resolution.operationId),
        continuation: parseConfigurationContinuation(resolution.continuation)
      };
    }
  );
  let skip = null;
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
  const transactions = boundedArray(record.transactions, 1e3).map(
    configurationUuid
  );
  if (new Set(transactions).size !== transactions.length || new Set(resolutions.map((item) => item.id)).size !== resolutions.length || new Set(resolutions.map((item) => item.proposalId)).size !== resolutions.length)
    configurationInvalid();
  return {
    configSchemaVersion: record.configSchemaVersion,
    configurationDigest: configurationHash(record.configurationDigest),
    coverage: record.coverage,
    projectTypes: types(record.projectTypes),
    uncoveredTypes: types(record.uncoveredTypes),
    continuation: record.continuation === null ? null : parseConfigurationContinuation(record.continuation),
    resolutions,
    skip,
    transactions
  };
}
function configurationInvalid(message = "Invalid configuration proposal. Reopen the current proposal and use its structured editor.") {
  throw new BanzaiError("CONFIGURATION_PROPOSAL_INVALID", message);
}
function configurationObject(value, required, optional = []) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    configurationInvalid();
  const record = value;
  if (required.some((key) => !Object.hasOwn(record, key)) || Object.keys(record).some(
    (key) => !required.includes(key) && !optional.includes(key)
  ))
    configurationInvalid();
  return record;
}
function configurationText(value, maximum = 200, empty = false) {
  if (typeof value !== "string" || !empty && value.length === 0 || value.length > maximum || /[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/u.test(value))
    configurationInvalid(
      "Proposal text contains unsafe controls or exceeds its bound. Edit it before approval."
    );
  return value;
}
function configurationId(value) {
  const id2 = configurationText(value, 80);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id2)) configurationInvalid();
  return id2;
}
function configurationUuid(value) {
  const id2 = configurationText(value, 36);
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(
    id2
  ))
    configurationInvalid();
  return id2;
}
function configurationHash(value) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value))
    configurationInvalid();
  return value;
}
function validateConfigurationStateEnvelope(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    configurationInvalid();
  const state = value;
  if ((state.schemaVersion === 8 || state.schemaVersion === 9) && state.verificationMode !== "task")
    configurationInvalid();
  if (state.schemaVersion !== 6 && !(state.schemaVersion === 7 && "configurationSetup" in state)) {
    if (Array.isArray(state.humanDecisions) && state.humanDecisions.some(
      (record) => record?.kind === "configuration_prerequisite"
    ) || "configurationSetup" in state || "verificationMode" in state && !((state.schemaVersion === 8 || state.schemaVersion === 9) && state.verificationMode === "task") || state.pendingHumanDecision?.kind === "configuration_prerequisite")
      configurationInvalid();
    return;
  }
  const setup = parseConfigurationSetupState(state.configurationSetup);
  const binding = state.artifactBinding?.binding;
  if (state.verificationMode !== "ordered" && state.verificationMode !== "policy" || binding?.schemaVersion !== (state.verificationMode === "policy" ? 2 : 1) || state.verificationMode === "policy" && setup.configSchemaVersion !== 3)
    configurationInvalid();
  const rawRecords = state.humanDecisions ?? [];
  if (!Array.isArray(rawRecords)) configurationInvalid();
  const records = rawRecords.filter(
    (record) => record?.kind === "configuration_prerequisite"
  ).map((record) => {
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
    if (typeof decidedAt !== "string" || !Number.isFinite(Date.parse(decidedAt)) || new Date(decidedAt).toISOString() !== decidedAt)
      configurationInvalid();
    const parsed = parseConfigurationPrerequisite(
      request,
      setup.configSchemaVersion
    );
    if (parsed.runId !== state.runId) configurationInvalid();
    return { ...parsed, action };
  });
  if (new Set(records.map((record) => record.proposalId)).size !== records.length)
    configurationInvalid();
  const pending = state.pendingHumanDecision;
  if (pending?.kind === "configuration_prerequisite") {
    const request = parseConfigurationPrerequisite(
      pending,
      setup.configSchemaVersion
    );
    if (state.status !== "needs_human_decision" || request.runId !== state.runId || records.some((record) => record.proposalId === request.proposalId) || JSON.stringify(request.continuation) !== JSON.stringify(setup.continuation) || state.activeAttempt !== null || state.activeProcess !== null)
      configurationInvalid();
  }
  for (const resolution of setup.resolutions) {
    if (!Number.isFinite(Date.parse(resolution.at)) || new Date(resolution.at).toISOString() !== resolution.at)
      configurationInvalid();
    const record = records.find(
      (item) => item.proposalId === resolution.proposalId && item.decisionId === resolution.decisionId
    );
    if (resolution.kind === "satisfied_by_configuration" ? record !== void 0 || resolution.operationId !== null : record?.action !== (resolution.kind === "accepted" ? "accept" : "skip"))
      configurationInvalid();
    if (resolution.kind === "accepted" ? resolution.operationId === null || !setup.transactions.includes(resolution.operationId) : resolution.operationId !== null)
      configurationInvalid();
    if (record && JSON.stringify(record.continuation) !== JSON.stringify(resolution.continuation))
      configurationInvalid();
  }
  if (setup.skip && (setup.skip.runId !== state.runId || !setup.resolutions.some(
    (resolution) => resolution.kind === "skipped" && resolution.proposalId === setup.skip?.proposalId && resolution.decisionId === setup.skip.decisionId
  )))
    configurationInvalid();
  if (setup.coverage === "skipped" && !setup.skip) configurationInvalid();
}
function applicationType(value) {
  if (value !== "custom" && !DETECTABLE_PROJECT_TYPES.some((type) => type === value))
    configurationInvalid();
  return value;
}
function boundedArray(value, maximum = 200) {
  if (!Array.isArray(value) || value.length > maximum) configurationInvalid();
  return value;
}
function parseConfigurationContinuation(value) {
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
  if (!Number.isSafeInteger(round.ordinal) || round.ordinal < 1)
    configurationInvalid();
  if (typeof record.baseCommit !== "string" || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(record.baseCommit))
    configurationInvalid();
  const approvalDigest = record.approvalDigest === null ? null : configurationHash(record.approvalDigest);
  const workflowSelectionDigest = record.workflowSelectionDigest === null ? null : configurationHash(record.workflowSelectionDigest);
  if (approvalDigest === null && workflowSelectionDigest === null)
    configurationInvalid();
  return {
    attemptId: configurationText(record.attemptId),
    attemptKind: record.attemptKind,
    verificationRound: {
      id: configurationText(round.id),
      ordinal: round.ordinal
    },
    baseCommit: record.baseCommit,
    workId: configurationUuid(record.workId),
    workBindingSha256: configurationHash(record.workBindingSha256),
    approvalDigest,
    workflowSelectionDigest
  };
}
function parseConfigurationSource(value) {
  const kind = value?.kind;
  if (kind === "project_scripts") {
    const source = configurationObject(value, [
      "kind",
      "path",
      "packageManager",
      "scriptNames"
    ]);
    if (source.path !== "package.json" || source.packageManager !== null && !["npm", "pnpm", "yarn", "bun"].includes(
      source.packageManager
    ))
      configurationInvalid();
    const scriptNames = boundedArray(source.scriptNames, 4).map(
      (name) => configurationText(name)
    );
    if (new Set(scriptNames).size !== scriptNames.length || scriptNames.some(
      (name) => !["test", "lint", "build", "typecheck"].includes(name)
    ))
      configurationInvalid();
    return {
      kind,
      path: "package.json",
      packageManager: source.packageManager,
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
    if (section !== (VERIFICATION_EXAMPLES[projectType]?.section ?? "mixed-and-nested-projects"))
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
function parseCommand(value, schemaVersion, input) {
  const command = configurationObject(
    value,
    [
      "name",
      "command",
      "args",
      "timeoutMs",
      ...!input && schemaVersion === 3 ? ["id"] : []
    ],
    [
      ...input && schemaVersion === 3 ? ["id"] : [],
      ...!input && schemaVersion === 3 ? ["evidence", "ignoreExplanatory"] : []
    ]
  );
  const args = boundedArray(command.args).map(
    (arg) => configurationText(arg, 4096, true)
  );
  if (!Number.isSafeInteger(command.timeoutMs) || command.timeoutMs <= 0 || command.timeoutMs > 864e5)
    configurationInvalid();
  if (command.evidence !== void 0 && !["fresh", "equivalent_evidence"].includes(command.evidence))
    configurationInvalid();
  if (command.ignoreExplanatory !== void 0 && typeof command.ignoreExplanatory !== "boolean")
    configurationInvalid();
  return {
    ...command.id === void 0 ? {} : { id: configurationId(command.id) },
    name: configurationText(command.name),
    command: configurationText(command.command, 500),
    args,
    timeoutMs: command.timeoutMs,
    ...!input && schemaVersion === 3 ? {
      evidence: command.evidence ?? "fresh",
      ignoreExplanatory: command.ignoreExplanatory === true
    } : {}
  };
}
function parseConfigurationProposal(value, schemaVersion) {
  const proposal = configurationObject(value, [
    "projectType",
    "profile",
    "source"
  ]);
  const profile = configurationObject(proposal.profile, ["id", "commands"]);
  const commands = boundedArray(profile.commands).map(
    (command) => parseCommand(command, schemaVersion, false)
  );
  if (schemaVersion === 3 && new Set(commands.map((command) => command.id)).size !== commands.length)
    configurationInvalid();
  const source = parseConfigurationSource(proposal.source);
  const projectType = applicationType(proposal.projectType);
  if (source.kind === "project_scripts" && (projectType !== "node" || source.packageManager === null && commands.length > 0) || source.kind === "documented_example" && source.projectType !== projectType)
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
function parseConfigurationPrerequisite(value, schemaVersion) {
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
  if (record.schema !== CONFIGURATION_PREREQUISITE_SCHEMA || record.schemaVersion !== 1 || record.kind !== "configuration_prerequisite" || !["missing_profile", "missing_script"].includes(record.reason) || JSON.stringify(record.options) !== JSON.stringify(CONFIGURATION_ACTIONS))
    configurationInvalid();
  const requestedAt = configurationText(record.requestedAt, 24);
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(requestedAt) || !Number.isFinite(Date.parse(requestedAt)) || new Date(requestedAt).toISOString() !== requestedAt)
    configurationInvalid();
  const result = {
    schema: CONFIGURATION_PREREQUISITE_SCHEMA,
    schemaVersion: 1,
    kind: "configuration_prerequisite",
    runId: configurationText(record.runId),
    decisionId: configurationUuid(record.decisionId),
    proposalId: configurationUuid(record.proposalId),
    requestedAt,
    reason: record.reason,
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

// ../../plugins/banzai/lib/verification-evidence.mjs
var MAX_BYTES = 512 * 1024 * 1024;
var VerificationEvidenceError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "VerificationEvidenceError";
    this.code = "VERIFICATION_EVIDENCE_INVALID";
  }
};

// ../../plugins/banzai/lib/project-files.mjs
import { execFile } from "node:child_process";
import { promisify } from "node:util";
var execute = promisify(execFile);
var METADATA_LIMIT = 64 * 1024;

// ../../plugins/banzai/lib/task-verification.mjs
import path from "node:path";
var fail = (message) => {
  throw new VerificationEvidenceError(message);
};
var TASK_VERIFICATION_SOURCE_MAX_BYTES = 1024 * 1024;
var HASH = /^[a-f0-9]{64}$/u;
var ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
function object(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value) || keys.some((key) => !Object.hasOwn(value, key)) || Object.keys(value).some((key) => !keys.includes(key))) fail("Invalid task verification fields.");
  return value;
}
function text(value, limit = 500, empty = false) {
  if (typeof value !== "string" || !empty && !value.length || value.length > limit || /[\x00-\x1f\x7f]/u.test(value)) fail("Invalid task verification text.");
  return value;
}
function list(value, maximum = 200) {
  if (!Array.isArray(value) || value.length > maximum) fail("Task verification inventory exceeds its bound.");
  return value;
}
function unique(values) {
  if (new Set(values).size !== values.length) fail("Duplicate task verification identity.");
  return values;
}
function hash(value) {
  if (typeof value !== "string" || !HASH.test(value)) fail("Invalid task verification digest.");
  return value;
}
function id(value) {
  if (!ID.test(text(value, 80))) fail("Invalid task verification identifier.");
  return value;
}
function relative(value, root = false) {
  text(value);
  if (root && value === ".") return value;
  if (path.posix.isAbsolute(value) || value.includes("\\") || value.split("/").some((part) => !part || part === "." || part === "..") || /^(?:\.git|\.banzai)(?:\/|$)/u.test(value)) fail("Invalid task verification project path.");
  return value;
}
function boundedTime(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 864e5) fail("Invalid task verification timeout.");
  return value;
}
function parseTaskVerificationDescriptor(value) {
  const v = object(value, ["id", "name", "requirementRefs", "command", "args", "cwd", "timeoutMs", "evidence", "sources", "materialization"]);
  const requirementRefs = unique(list(v.requirementRefs, 32).map((ref) => text(ref, 200)));
  if (!requirementRefs.length) fail("Verification must identify its task requirement or project rule.");
  const command = text(v.command);
  if (command.startsWith("-") || /\s/u.test(command) || command.includes("\\") || command.includes("/") && command.split("/").includes("..")) fail("Expected an executable, not shell text or a traversal path.");
  if (!["fresh", "equivalent_evidence"].includes(v.evidence)) fail("Unsupported task evidence mode.");
  const sources = list(v.sources, 32).map((source) => {
    object(source, ["path", "sha256"]);
    return { path: relative(source.path), sha256: hash(source.sha256) };
  });
  unique(sources.map((source) => source.path));
  const materialization = v.materialization === null ? null : (() => {
    const m = object(v.materialization, ["taskRef", "paths"]);
    const paths = unique(list(m.paths, 32).map((item) => relative(item)));
    if (!paths.length) fail("Future tooling requires materialization paths.");
    return { taskRef: text(m.taskRef, 200), paths };
  })();
  const args = list(v.args, 200).map((arg) => text(arg, 4096, true));
  if (args.some((arg) => /(?:\b(?:sk|sk-ant|sess)-[A-Za-z0-9_-]{12,}\b|\bBearer\s+[^ ]+|^--?(?:password|api[-_]?key|access[-_]?token|auth[-_]?token|secret)(?:=|$)|["'](?:password|api[_-]?key|access[_-]?token|auth[_-]?token)["']\s*:)/iu.test(arg))) fail("Credentials must not be embedded in verification descriptors.");
  return {
    id: id(v.id),
    name: text(v.name, 200),
    requirementRefs,
    command,
    args,
    cwd: relative(v.cwd, true),
    timeoutMs: boundedTime(v.timeoutMs),
    evidence: v.evidence,
    sources,
    materialization
  };
}
function parseTaskVerificationCandidates(value) {
  if (value === null) return null;
  const v = object(value, ["checks", "absenceReason"]);
  const checks = list(v.checks).map(parseTaskVerificationDescriptor);
  unique(checks.map((check) => check.id));
  if (checks.length ? v.absenceReason !== null : typeof v.absenceReason !== "string") fail("Empty selection requires an absence rationale; selected checks do not.");
  return { checks, absenceReason: v.absenceReason === null ? null : text(v.absenceReason, 2e3) };
}

// src/validation.ts
import { createHash } from "node:crypto";

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
var OPUS = "claude-opus-5-5";
var SONNET = "claude-sonnet-5-5";
var HAIKU = "claude-haiku-4-5";
var CLAUDE_CATALOG = {
  supported: /* @__PURE__ */ new Set([
    "claude-fable-5-1",
    "claude-fable-5",
    OPUS,
    SONNET,
    "claude-opus-5",
    "claude-sonnet-5",
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
    ["claude-opus-4-1", retired(OPUS, "2026-08-05")],
    ["claude-opus-4-1-20250805", retired(OPUS, "2026-08-05")],
    ["claude-opus-4-0", retired(OPUS, "2026-06-15")],
    ["claude-opus-4-20250514", retired(OPUS, "2026-06-15")],
    ["claude-3-opus-20240229", retired(OPUS, "2026-01-05")],
    ["claude-mythos-preview", superseded("claude-fable-5-1")],
    ["claude-sonnet-4-5", deprecated(SONNET, "2026-11-30")],
    ["claude-sonnet-4-5-20250929", deprecated(SONNET, "2026-11-30")],
    ["claude-sonnet-4-0", retired(SONNET, "2026-06-15")],
    ["claude-sonnet-4-20250514", retired(SONNET, "2026-06-15")],
    ["claude-3-7-sonnet-20250219", retired(SONNET, "2026-02-19")],
    ["claude-3-5-sonnet-20241022", retired(SONNET, "2025-10-28")],
    ["claude-3-5-sonnet-20240620", retired(SONNET, "2025-10-28")],
    ["claude-3-sonnet-20240229", retired(SONNET, "2025-07-21")],
    ["claude-3-5-haiku-20241022", retired(HAIKU, "2026-02-19")],
    ["claude-3-haiku-20240307", retired(HAIKU, "2026-04-20")]
  ]),
  // From Claude Code's model configuration documentation. An older client
  // refuses these models itself, before any request; tier aliases need no
  // entry because they resolve to a model the installed client serves.
  cliMinimums: /* @__PURE__ */ new Map([
    [OPUS, "2.1.280"],
    [SONNET, "2.1.284"],
    ["claude-fable-5-1", "2.1.257"]
  ])
};
var CODEX_SOL = "gpt-6.1-sol";
var CODEX_CATALOG = {
  supported: /* @__PURE__ */ new Set([
    CODEX_SOL,
    "gpt-6-astra",
    "gpt-6-sol",
    "gpt-6-luna",
    "gpt-5.6-sol",
    "gpt-5.6-terra",
    "gpt-5.6-luna"
  ]),
  replacements: /* @__PURE__ */ new Map([
    ["gpt-5.5", deprecated(CODEX_SOL, "2026-10-14")],
    ["gpt-5.4", retired(CODEX_SOL, "2026-08-31")],
    ["gpt-5.4-mini", retired("gpt-6-luna", "2026-08-31")],
    ["gpt-5", superseded(CODEX_SOL)]
  ]),
  // The first stable Codex CLI release whose bundled model catalog carries the
  // model, from the Codex CLI release notes.
  cliMinimums: /* @__PURE__ */ new Map([
    [CODEX_SOL, "0.159.1"],
    ["gpt-6-sol", "0.156.1"],
    ["gpt-6-luna", "0.156.1"],
    ["gpt-6-astra", "0.153.1"]
  ])
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
var PHASE_RESULT_SCHEMA_VERSION = 4;
var DECISION_CONSULTATION_SCHEMA = "banzai-decision-consultation/v1";
var DECISION_CONSULTATION_SCHEMA_VERSION = 1;
var PLAN_TASK_COMPLETION_SCHEMA_VERSION = 1;
var VERIFICATION_LEDGER_SCHEMA_VERSION = 1;
var MODEL_ATTEMPT_SCHEMA_VERSION = 2;
var STRICT_MODEL_ATTEMPT_SCHEMA_VERSION = 3;
var TERMINAL_CHECKPOINT_SCHEMA = "banzai-terminal-attempt-checkpoint/v1";
var TERMINAL_CHECKPOINT_SCHEMA_VERSION = 1;
var TERMINAL_CHECKPOINT_SCHEMA_V2 = "banzai-terminal-attempt-checkpoint/v2";
var TERMINAL_CHECKPOINT_SCHEMA_VERSION_V2 = 2;
var COMPLETION_PROTOCOL = "banzai-completion-protocol/v1";
var COMPLETION_CAPTURE_SCHEMA = "banzai-completion-capture/v1";
var COMPLETION_TRANSITION_SCHEMA = "banzai-completion-transition/v1";
var COMPLETION_CANDIDATE_SCHEMA = "banzai-completion-candidate/v1";
var COMPLETION_PUBLICATION_SCHEMA = "banzai-completion-publication/v1";
var COMPLETION_RECORD_SCHEMA_VERSION = 1;
var COMPLETION_PUBLICATION_STAGES = [
  "capture",
  "validate",
  "render",
  "candidate",
  "publication",
  "receipt",
  "attempt",
  "state",
  "event"
];
var COMPLETION_PUBLICATION_REFUSAL_CODES = [
  "COMPLETION_PUBLICATION_IO",
  "COMPLETION_PUBLICATION_DRIFT",
  "COMPLETION_PUBLICATION_INTEGRITY"
];
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
function consultationProse(value, label, maximum) {
  return consultationString(
    typeof value === "string" ? value.replace(/[ \t\n\r]*[\t\n\r][ \t\n\r]*/gu, " ").replace(/^ +| +$/gu, "") : value,
    label,
    maximum
  );
}
function consultationIdentifier(value, label) {
  const identifier = consultationString(value, label, 128);
  if (identifier === "." || identifier === ".." || !CONSULTATION_ID_PATTERN.test(identifier)) {
    return consultationError(`${label} must be a canonical identifier.`);
  }
  return identifier;
}
function consultationStrings(value, label, maximumItems, maximumLength, decodeItem) {
  if (!Array.isArray(value) || value.length > maximumItems) {
    return consultationError(`${label} must be a bounded string array.`);
  }
  const strings = value.map(
    (item, index) => decodeItem(item, `${label}[${index}]`, maximumLength)
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
      rationale: consultationProse(
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
    question: consultationProse(record.question, `${label}.question`, 1e3),
    why: consultationProse(record.why, `${label}.why`, 1200),
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
  return {
    ...parsePhaseResultFields(record),
    taskCompletion: parseTaskCompletion(record.taskCompletion)
  };
}
var MAX_ORIGINAL_RESULT_BYTES = 4 * 1024 * 1024;
var MAX_UNACCEPTED_LEDGER_PREVIEW = 4e3;
function parsePhaseResultFields(record) {
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
      ...record.schemaVersion === 4 ? ["verificationCandidates"] : []
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
  const summary = gate === "decision_consultation" ? consultationProse(record.summary, "summary", 1e3) : requireString(record.summary, "summary");
  if (gate === "decision_consultation" ? phase !== "plan" || outcome !== "needs_human_decision" || decisionConsultation === null || questions.length !== 0 : decisionConsultation !== null) {
    throw new BanzaiError(
      "INVALID_RESULT",
      "decisionConsultation is allowed only for the planning decision_consultation gate with no escalation questions."
    );
  }
  return {
    schemaVersion: record.schemaVersion,
    ...record.schemaVersion === 4 ? {
      verificationCandidates: parseTaskVerificationCandidates(
        record.verificationCandidates
      )
    } : {},
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
function parsePhaseResultEnvelope(value) {
  const record = requireRecord(value, "phase result");
  const fields = parsePhaseResultFields(record);
  const original = stableJson(record);
  if (Buffer.byteLength(original, "utf8") > MAX_ORIGINAL_RESULT_BYTES) {
    throw new BanzaiError(
      "INVALID_RESULT",
      "Phase result exceeds the retained original result bound."
    );
  }
  let taskCompletion;
  try {
    taskCompletion = {
      state: "accepted",
      ledger: parseTaskCompletion(record.taskCompletion)
    };
  } catch (error) {
    if (!(error instanceof BanzaiError) || error.code !== "PLAN_TASK_COMPLETION_INVALID") {
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
function parseStoredPhaseResultEnvelope(value, code = "ATTEMPT_MALFORMED") {
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
  let original;
  try {
    original = JSON.parse(value.original);
  } catch {
    return recoveryEvidenceError(
      code,
      "Persisted envelope original is not JSON."
    );
  }
  let decoded;
  try {
    decoded = parsePhaseResultEnvelope(original);
  } catch (error) {
    return recoveryEvidenceError(
      code,
      `Persisted envelope original does not decode: ${error.message}`
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
function parsePersistedPhaseResult(value) {
  const record = requireRecord(value, "persisted phase result");
  if (record.schemaVersion === 3 || record.schemaVersion === 4) {
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
  const id2 = requireString(record.id, "finding.id");
  if (!/^R[1-9][0-9]*-F[1-9][0-9]*$/.test(id2)) {
    throw new BanzaiError(
      "INVALID_RESULT",
      `Finding id ${id2} must match R<iteration>-F<number>.`
    );
  }
  if (!Array.isArray(record.evidence) || record.evidence.length === 0) {
    throw new BanzaiError(
      "INVALID_RESULT",
      `${id2}.evidence must contain at least one item.`
    );
  }
  return {
    id: id2,
    severity: requireEnum(record.severity, `${id2}.severity`, [
      "blocker",
      "should_fix",
      "nit"
    ]),
    category: requireEnum(record.category, `${id2}.category`, [
      "spec",
      "plan",
      "adr",
      "correctness",
      "test",
      "security",
      "maintainability",
      "documentation"
    ]),
    summary: requireString(record.summary, `${id2}.summary`),
    evidence: record.evidence.map((item) => parseEvidence(item, id2)),
    violates: requireStringArray(record.violates, `${id2}.violates`),
    reproduction: requireNullableString(
      record.reproduction,
      `${id2}.reproduction`
    ),
    fixAcceptance: requireString(record.fixAcceptance, `${id2}.fixAcceptance`),
    confidence: requireEnum(record.confidence, `${id2}.confidence`, [
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
  const snapshotDigest = evidenceDigest2(
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
    const path3 = reviewScopePath(entry.path);
    const status = requireEnum(entry.status, "scope status", [
      "reviewed",
      "not_reviewed"
    ]);
    if (status === "reviewed" ? entry.reason !== null : typeof entry.reason !== "string" || entry.reason.trim().length === 0)
      throw new BanzaiError(
        "INVALID_REVIEW_SCOPE",
        "Reviewed scope requires a null reason; unreviewed scope requires a nonblank reason."
      );
    return { path: path3, status, reason: entry.reason };
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
function evidenceDigest2(value, code, label) {
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
  const id2 = evidenceIdentifier(value.id, code, `${label}.id`, 200);
  const kind = value.kind;
  if (typeof kind !== "string" || !["selection", "plan", "implementation", "fix", "review"].includes(kind)) {
    return recoveryEvidenceError(code, `${label}.kind is unsupported.`);
  }
  if (typeof value.mutable !== "boolean") {
    return recoveryEvidenceError(code, `${label}.mutable must be boolean.`);
  }
  return {
    id: id2,
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
  if (resultContract === "phase-result/v3" || resultContract === "phase-result/v4") {
    const result2 = parsePhaseResult(value);
    if (result2.schemaVersion !== (resultContract === "phase-result/v4" ? 4 : 3))
      throw new BanzaiError(
        "PHASE_RESULT_SCHEMA_MISMATCH",
        "Phase result does not match the attempted contract."
      );
    return result2;
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
function completionRecordIntegrity(record) {
  return digestCanonicalJson(record);
}
function parseCompletionIdentity(value, code) {
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
function requireIntegrity(value, record, code, label) {
  const integrityDigest = evidenceDigest2(
    value.integrityDigest,
    code,
    "integrityDigest"
  );
  if (integrityDigest !== completionRecordIntegrity(record)) {
    return recoveryEvidenceError(code, `${label} integrity mismatch.`);
  }
  return { ...record, integrityDigest };
}
function reportIdentity(value, code, label) {
  if (!isRecord(value)) {
    return recoveryEvidenceError(code, `${label} must be an object.`);
  }
  exactKeys(value, ["path", "sha256"], code, label);
  return {
    path: evidenceString(value.path, code, `${label}.path`),
    sha256: evidenceDigest2(value.sha256, code, `${label}.sha256`)
  };
}
function nullableReportIdentity(value, code, label) {
  return value === null ? null : reportIdentity(value, code, label);
}
function ledgerSourceIdentity(value, code, label) {
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
    ledgerDigest: evidenceDigest2(
      value.ledgerDigest,
      code,
      `${label}.ledgerDigest`
    )
  };
}
function parseCompletionTransition(value) {
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
  if (value.schema !== COMPLETION_TRANSITION_SCHEMA || value.schemaVersion !== COMPLETION_RECORD_SCHEMA_VERSION) {
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
  if (value.priorState.schemaVersion !== 3 && value.priorState.schemaVersion !== 4 && value.priorState.schemaVersion !== 6) {
    return recoveryEvidenceError(
      code,
      "priorState.schemaVersion must be a legacy 3 or bootstrap 4/6 state."
    );
  }
  const record = {
    schema: COMPLETION_TRANSITION_SCHEMA,
    schemaVersion: COMPLETION_RECORD_SCHEMA_VERSION,
    ...parseCompletionIdentity(value, code),
    priorState: {
      schemaVersion: value.priorState.schemaVersion,
      path: evidenceString(value.priorState.path, code, "priorState.path"),
      sha256: evidenceDigest2(value.priorState.sha256, code, "priorState.sha256")
    }
  };
  return requireIntegrity(
    value,
    record,
    code,
    "Completion transition"
  );
}
function parseCompletionCapture(value) {
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
  if (value.schema !== COMPLETION_CAPTURE_SCHEMA || value.schemaVersion !== COMPLETION_RECORD_SCHEMA_VERSION) {
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
  if (!Array.isArray(value.workspace.excludedPaths) || value.workspace.excludedPaths.length > 8) {
    return recoveryEvidenceError(
      code,
      "workspace.excludedPaths must be a bounded array."
    );
  }
  let workBinding = null;
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
      sha256: evidenceDigest2(
        value.workBinding.sha256,
        code,
        "workBinding.sha256"
      )
    };
  }
  const record = {
    schema: COMPLETION_CAPTURE_SCHEMA,
    schemaVersion: COMPLETION_RECORD_SCHEMA_VERSION,
    ...parseCompletionIdentity(value, code),
    outcome: value.outcome,
    resultDigest: evidenceDigest2(value.resultDigest, code, "resultDigest"),
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
    approvalDigest: evidenceDigest2(
      value.approvalDigest,
      code,
      "approvalDigest"
    ),
    planTaskDigest: evidenceDigest2(
      value.planTaskDigest,
      code,
      "planTaskDigest"
    ),
    workBinding,
    configurationDigest: evidenceDigest2(
      value.configurationDigest,
      code,
      "configurationDigest"
    ),
    scopeDigest: nullableEvidenceDigest(value.scopeDigest, code, "scopeDigest"),
    ledgerSource: value.ledgerSource === null ? null : ledgerSourceIdentity(value.ledgerSource, code, "ledgerSource"),
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
      digest: evidenceDigest2(value.workspace.digest, code, "workspace.digest"),
      excludedPaths: value.workspace.excludedPaths.map(
        (item, index) => evidenceString(item, code, `workspace.excludedPaths[${index}]`)
      )
    },
    capturedAt: evidenceTimestamp(value.capturedAt, code, "capturedAt")
  };
  return requireIntegrity(
    value,
    record,
    code,
    "Completion capture"
  );
}
function parseCompletionCandidate(value) {
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
  if (value.schema !== COMPLETION_CANDIDATE_SCHEMA || value.schemaVersion !== COMPLETION_RECORD_SCHEMA_VERSION) {
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
  if (action !== "appended" && action !== "replaced" || typeof start !== "number" || typeof end !== "number" || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start) {
    return recoveryEvidenceError(code, "region is malformed.");
  }
  if (typeof value.outputBytes !== "number" || !Number.isSafeInteger(value.outputBytes) || value.outputBytes < 0 || value.preservation !== "verified" || value.roundtrip !== "verified") {
    return recoveryEvidenceError(code, "Candidate proof fields are malformed.");
  }
  const record = {
    schema: COMPLETION_CANDIDATE_SCHEMA,
    schemaVersion: COMPLETION_RECORD_SCHEMA_VERSION,
    ...parseCompletionIdentity(value, code),
    captureDigest: evidenceDigest2(value.captureDigest, code, "captureDigest"),
    ledgerDigest: evidenceDigest2(value.ledgerDigest, code, "ledgerDigest"),
    destination: evidenceString(value.destination, code, "destination"),
    inputSha256: evidenceDigest2(value.inputSha256, code, "inputSha256"),
    candidatePath: evidenceString(value.candidatePath, code, "candidatePath"),
    outputSha256: evidenceDigest2(value.outputSha256, code, "outputSha256"),
    outputBytes: value.outputBytes,
    testReportSha256: evidenceDigest2(
      value.testReportSha256,
      code,
      "testReportSha256"
    ),
    region: { action, start, end },
    preservation: "verified",
    roundtrip: "verified"
  };
  return requireIntegrity(
    value,
    record,
    code,
    "Completion candidate"
  );
}
function parseCompletionPublication(value) {
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
  if (value.schema !== COMPLETION_PUBLICATION_SCHEMA || value.schemaVersion !== COMPLETION_RECORD_SCHEMA_VERSION) {
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
  const publisher = {
    attemptId: evidenceIdentifier(
      value.publisher.attemptId,
      code,
      "publisher.attemptId"
    ),
    attemptKind: publisherKind
  };
  if (publisher.attemptId !== identity.attemptId || publisher.attemptKind !== identity.attemptKind) {
    return recoveryEvidenceError(
      code,
      "A receipt is owned by the attempt that published it."
    );
  }
  const record = {
    schema: COMPLETION_PUBLICATION_SCHEMA,
    schemaVersion: COMPLETION_RECORD_SCHEMA_VERSION,
    ...identity,
    captureDigest: evidenceDigest2(value.captureDigest, code, "captureDigest"),
    candidateDigest: evidenceDigest2(
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
      approvalDigest: evidenceDigest2(
        value.authority.approvalDigest,
        code,
        "authority.approvalDigest"
      ),
      planTaskDigest: evidenceDigest2(
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
      configurationDigest: evidenceDigest2(
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
  return requireIntegrity(
    value,
    record,
    code,
    "Completion publication"
  );
}
function parseCompletionPublicationCursor(value) {
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
  if (typeof stage !== "string" || !COMPLETION_PUBLICATION_STAGES.includes(
    stage
  )) {
    return recoveryEvidenceError(code, "stage is unsupported.");
  }
  let refusal = null;
  if (value.refusal !== null) {
    if (!isRecord(value.refusal)) {
      return recoveryEvidenceError(code, "refusal must be an object or null.");
    }
    exactKeys(value.refusal, ["code", "stage", "proofDigest"], code, "refusal");
    const refusalCode = value.refusal.code;
    const refusalStage = value.refusal.stage;
    if (typeof refusalCode !== "string" || !COMPLETION_PUBLICATION_REFUSAL_CODES.includes(
      refusalCode
    ) || typeof refusalStage !== "string" || !COMPLETION_PUBLICATION_STAGES.includes(
      refusalStage
    )) {
      return recoveryEvidenceError(code, "refusal is malformed.");
    }
    refusal = {
      code: refusalCode,
      stage: refusalStage,
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
    stage,
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
function parsePlanTaskCompletionCheckpoint(value) {
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
  const kind = value.sourceAttemptKind === void 0 ? void 0 : value.sourceAttemptKind === "implementation" || value.sourceAttemptKind === "fix" ? value.sourceAttemptKind : recoveryEvidenceError(code, "sourceAttemptKind is unsupported.");
  if (published && kind === void 0) {
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
        ...published ? ["completionProtocol", "diagnostic", "rejectedResultDigest"] : []
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
      ...kind === void 0 ? {} : { sourceAttemptKind: kind },
      errorCode: "PLAN_TASK_COMPLETION_INVALID",
      violation: diagnostic.violation,
      taskId: diagnostic.taskId,
      recordedAt: evidenceTimestamp(value.recordedAt, code, "recordedAt"),
      ...published ? {
        completionProtocol: COMPLETION_PROTOCOL,
        diagnostic: diagnostic.message,
        rejectedResultDigest: nullableEvidenceDigest(
          value.rejectedResultDigest,
          code,
          "rejectedResultDigest"
        )
      } : {}
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
      ...published ? ["completionProtocol", "publisherAttemptId", "publication"] : []
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
  const count = (item, label) => {
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
    ...kind === void 0 ? {} : { sourceAttemptKind: kind },
    approvalDigest: evidenceDigest2(
      value.approvalDigest,
      code,
      "approvalDigest"
    ),
    planTaskDigest: evidenceDigest2(
      value.planTaskDigest,
      code,
      "planTaskDigest"
    ),
    ledgerDigest: evidenceDigest2(value.ledgerDigest, code, "ledgerDigest"),
    implementationReport: reportIdentity(
      value.implementationReport,
      code,
      "implementationReport"
    ),
    testReport: reportIdentity(value.testReport, code, "testReport"),
    counts,
    validatedAt: evidenceTimestamp(value.validatedAt, code, "validatedAt"),
    ...published ? {
      completionProtocol: COMPLETION_PROTOCOL,
      publisherAttemptId: evidenceIdentifier(
        value.publisherAttemptId,
        code,
        "publisherAttemptId"
      ),
      publication: reportIdentity(value.publication, code, "publication")
    } : {}
  };
}
var COMPLETION_VIOLATIONS = [
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
function parseCompletionDiagnostic(value, code = "ATTEMPT_MALFORMED") {
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
  if (typeof violation !== "string" || !COMPLETION_VIOLATIONS.includes(violation)) {
    return recoveryEvidenceError(
      code,
      "Completion diagnostic violation is unsupported."
    );
  }
  return {
    violation,
    taskId: value.taskId === null ? null : evidenceString(value.taskId, code, "taskId", 4),
    message: evidenceString(value.message, code, "message")
  };
}
var REPORT_OBSERVATION_STATES = [
  "present",
  "absent",
  "unsafe",
  "unavailable"
];
function parseReportObservation(value, code, label) {
  if (!isRecord(value)) {
    return recoveryEvidenceError(code, `${label} must be an object.`);
  }
  const state = value.state;
  if (typeof state !== "string" || !REPORT_OBSERVATION_STATES.includes(
    state
  )) {
    return recoveryEvidenceError(code, `${label}.state is unsupported.`);
  }
  if (state === "present") {
    exactKeys(value, ["path", "state", "sha256", "bytes"], code, label);
    if (typeof value.bytes !== "number" || !Number.isSafeInteger(value.bytes) || value.bytes < 0) {
      return recoveryEvidenceError(
        code,
        `${label}.bytes must be a non-negative integer.`
      );
    }
    return {
      path: evidenceString(value.path, code, `${label}.path`),
      state: "present",
      sha256: evidenceDigest2(value.sha256, code, `${label}.sha256`),
      bytes: value.bytes
    };
  }
  exactKeys(value, ["path", "state"], code, label);
  return {
    path: evidenceNullableString(value.path, code, `${label}.path`),
    state
  };
}
function parseObservedInputs(value, code, label) {
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
    workspaceDigest: value.workspaceDigest === null ? null : evidenceDigest2(
      value.workspaceDigest,
      code,
      `${label}.workspaceDigest`
    )
  };
}
function parseCheckpointConfiguration(value, code) {
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
  if (typeof effort !== "string" || !["low", "medium", "high", "xhigh", "max", "ultra"].includes(effort)) {
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
    executableDigest: evidenceDigest2(
      value.executableDigest,
      code,
      "configuration.executableDigest"
    ),
    model: evidenceString(value.model, code, "configuration.model"),
    effort,
    sessionMode,
    sessionContextDigest: evidenceDigest2(
      value.sessionContextDigest,
      code,
      "configuration.sessionContextDigest"
    )
  };
}
function parseCheckpointTerminal(value, vendor, code) {
  if (!isRecord(value)) {
    return recoveryEvidenceError(code, "terminal must be an object.");
  }
  exactKeys(value, ["classification", "observedAt"], code, "terminal");
  const classification = value.classification;
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
  return {
    classification,
    observedAt: evidenceTimestamp(value.observedAt, code, "terminal.observedAt")
  };
}
function nullableEvidenceDigest(value, code, label) {
  return value === null ? null : evidenceDigest2(value, code, label);
}
function parseTerminalAttemptCheckpointV2(value) {
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
  if (!(value.schema === TERMINAL_CHECKPOINT_SCHEMA_V2 && value.schemaVersion === 2 || value.schema === "banzai-terminal-attempt-checkpoint/v3" && value.schemaVersion === 3) || value.completionProtocol !== COMPLETION_PROTOCOL) {
    return recoveryEvidenceError(
      code,
      `Terminal checkpoint must use ${TERMINAL_CHECKPOINT_SCHEMA_V2} under ${COMPLETION_PROTOCOL}.`
    );
  }
  const attempt = parseEvidenceAttempt(value.attempt, code, "attempt");
  if (attempt.kind !== "implementation" && attempt.kind !== "fix" || !attempt.mutable || value.phase !== attempt.kind) {
    return recoveryEvidenceError(
      code,
      "Protocol checkpoint requires a mutable implementation or fix attempt."
    );
  }
  if (value.resultContract !== (value.schemaVersion === 3 ? "phase-result/v4" : "phase-result/v3")) {
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
  const resultDigest = evidenceDigest2(value.resultDigest, code, "resultDigest");
  if (resultDigest !== envelope.originalDigest) {
    return recoveryEvidenceError(
      code,
      "Checkpoint result digest conflicts with its envelope original."
    );
  }
  const checkpointWithoutIntegrity = {
    schema: value.schemaVersion === 3 ? "banzai-terminal-attempt-checkpoint/v3" : TERMINAL_CHECKPOINT_SCHEMA_V2,
    schemaVersion: value.schemaVersion === 3 ? 3 : TERMINAL_CHECKPOINT_SCHEMA_VERSION_V2,
    completionProtocol: COMPLETION_PROTOCOL,
    runId: evidenceString(value.runId, code, "runId", 300),
    attempt: {
      id: attempt.id,
      kind: attempt.kind,
      mutable: true
    },
    phase: attempt.kind,
    configuration,
    resultContract: value.schemaVersion === 3 ? "phase-result/v4" : "phase-result/v3",
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
  const integrityDigest = evidenceDigest2(
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
function parseTerminalAttemptCheckpoint(value) {
  const code = "INVALID_TERMINAL_CHECKPOINT";
  if (!isRecord(value)) {
    return recoveryEvidenceError(
      code,
      "Terminal checkpoint must be an object."
    );
  }
  if (value.schema === TERMINAL_CHECKPOINT_SCHEMA_V2 || value.schema === "banzai-terminal-attempt-checkpoint/v3" && "completionProtocol" in value) {
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
  if (!(value.schema === TERMINAL_CHECKPOINT_SCHEMA && value.schemaVersion === 1 || value.schema === "banzai-terminal-attempt-checkpoint/v3" && value.schemaVersion === 3)) {
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
  const expectedContract = attempt.kind === "selection" ? "workflow-selection/v1" : attempt.kind === "review" ? resultContract === "review-result/v2" ? "review-result/v2" : "review-result/v1" : value.schemaVersion === 3 ? "phase-result/v4" : resultContract === "phase-result/v2" ? "phase-result/v2" : "phase-result/v3";
  if (resultContract !== expectedContract || attempt.kind !== "selection" && attempt.kind !== "review" && resultContract !== "phase-result/v2" && resultContract !== "phase-result/v3" && resultContract !== "phase-result/v4") {
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
    schema: value.schemaVersion === 3 ? "banzai-terminal-attempt-checkpoint/v3" : TERMINAL_CHECKPOINT_SCHEMA,
    schemaVersion: value.schemaVersion === 3 ? 3 : TERMINAL_CHECKPOINT_SCHEMA_VERSION,
    runId: evidenceString(value.runId, code, "runId", 300),
    attempt,
    phase: attempt.kind,
    configuration: {
      vendor,
      executableDigest: evidenceDigest2(
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
      sessionContextDigest: evidenceDigest2(
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
  const integrityDigest = evidenceDigest2(
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
  if (attempt.kind !== "implementation" && attempt.kind !== "fix" && attempt.kind !== "plan" || attempt.mutable !== (attempt.kind !== "plan")) {
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
  const nullableDigest = (item, label) => {
    if (item === null) {
      return null;
    }
    return evidenceDigest2(item, code, label);
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
    recoveryIdentity: evidenceDigest2(
      value.recoveryIdentity,
      code,
      "recoveryIdentity"
    ),
    workspaceDigest: evidenceDigest2(
      value.workspaceDigest,
      code,
      "workspaceDigest"
    ),
    baseCommit: evidenceString(value.baseCommit, code, "baseCommit", 100),
    approvalDigest: nullableDigest(value.approvalDigest, "approvalDigest"),
    workflowDigest: nullableDigest(value.workflowDigest, "workflowDigest"),
    scopeDigest: nullableDigest(value.scopeDigest, "scopeDigest"),
    configurationDigest: evidenceDigest2(
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
      "reviewDiagnostics",
      "completionProtocol",
      "retryOf",
      "envelope",
      "completionDiagnostic"
    ],
    code,
    "Attempt record"
  );
  if (value.schemaVersion !== 1 && value.schemaVersion !== MODEL_ATTEMPT_SCHEMA_VERSION && value.schemaVersion !== STRICT_MODEL_ATTEMPT_SCHEMA_VERSION && value.schemaVersion !== 4) {
    return recoveryEvidenceError(
      code,
      "Attempt schema version is unsupported."
    );
  }
  const attempt = parseEvidenceAttempt(value.attempt, code, "attempt");
  const strict = value.schemaVersion === STRICT_MODEL_ATTEMPT_SCHEMA_VERSION || value.schemaVersion === 4 && value.completionProtocol !== void 0;
  if (strict) {
    if (attempt.kind !== "implementation" && attempt.kind !== "fix" || !attempt.mutable || value.completionProtocol !== COMPLETION_PROTOCOL || !Object.hasOwn(value, "retryOf") || !Object.hasOwn(value, "envelope") || !Object.hasOwn(value, "completionDiagnostic")) {
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
      if (value.result !== null && stableJson(value.result) !== stableJson(JSON.parse(envelope.original)))
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
  } else if ("completionProtocol" in value || "retryOf" in value || "envelope" in value || "completionDiagnostic" in value) {
    return recoveryEvidenceError(
      code,
      "Legacy attempt records cannot carry completion protocol fields."
    );
  }
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
    evidenceDigest2(
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
    evidenceDigest2(
      context.invocationDigest,
      code,
      "planningContext.invocationDigest"
    );
    if (context.workspaceDigest !== null)
      evidenceDigest2(
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
  if (typeof status !== "string" || ![
    "started",
    "completed",
    "failed",
    "interrupted",
    "pending_application"
  ].includes(status) || value.schemaVersion === 1 && status === "interrupted" || !strict && status === "pending_application") {
    return recoveryEvidenceError(code, "Attempt status is unsupported.");
  }
  if (status === "pending_application" && (value.result === null || value.envelope === null)) {
    return recoveryEvidenceError(
      code,
      "A pending_application attempt must retain its captured result and envelope."
    );
  }
  evidenceTimestamp(value.startedAt, code, "startedAt");
  if (value.schemaVersion === MODEL_ATTEMPT_SCHEMA_VERSION || value.schemaVersion === STRICT_MODEL_ATTEMPT_SCHEMA_VERSION || value.schemaVersion === 4) {
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
  const relativePath2 = verificationString(
    record.relativePath,
    code,
    `${field}.relativePath`
  );
  if (!relativePath2.startsWith("verification/") || relativePath2.includes("\\") || relativePath2.split("/").some((part) => part === "" || part === "." || part === "..")) {
    throw verificationEvidenceError(code, `${field}.relativePath`);
  }
  return {
    relativePath: relativePath2,
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
  const id2 = verificationString(record.id, code, "id", idPattern);
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
    id: id2,
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
  if (value.schemaVersion !== 1 && value.schemaVersion !== 2 && value.schemaVersion !== 3 && value.schemaVersion !== 4 && value.schemaVersion !== 5 && value.schemaVersion !== 6 && value.schemaVersion !== 7) {
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
      ...schemaVersion === 6 || schemaVersion === 7 && typeof value.verificationMode === "string" ? { verificationMode: value.verificationMode } : {},
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

// ../../plugins/banzai/lib/execution-ownership.mjs
import { AsyncLocalStorage } from "node:async_hooks";
var ownership = new AsyncLocalStorage();

// src/config.ts
import path2 from "node:path";
var CONFIG_DIRECTORY = ".banzai";
var CONFIG_FILE = path2.join(CONFIG_DIRECTORY, "config.json");
var DEFAULT_CONFIG = {
  schemaVersion: 2,
  contractVersion: CONTRACT_VERSION,
  models: {
    planner: {
      executable: "claude",
      model: "claude-opus-5-5",
      effort: "xhigh",
      timeoutMs: 30 * 60 * 1e3
    },
    implementer: {
      executable: "claude",
      model: "claude-opus-5-5",
      effort: "xhigh",
      timeoutMs: 60 * 60 * 1e3
    },
    reviewer: {
      executable: "codex",
      model: "gpt-6.1-sol",
      effort: "xhigh",
      timeoutMs: 30 * 60 * 1e3
    }
  },
  claudeEnvironment: {
    mode: "scoped",
    pluginDirectory: null
  },
  context: {
    mode: "observe",
    limits: []
  },
  verification: {
    profiles: [
      {
        id: "repository",
        projectType: "repository",
        commands: [
          {
            name: "git diff check",
            command: "git",
            args: ["diff", "--check"],
            timeoutMs: 2 * 60 * 1e3
          }
        ]
      }
    ]
  },
  maxFixCycles: 3
};
var DEFAULT_TASK_CONFIG = {
  schemaVersion: 4,
  contractVersion: CONTRACT_VERSION,
  models: structuredClone(DEFAULT_CONFIG.models),
  claudeEnvironment: structuredClone(DEFAULT_CONFIG.claudeEnvironment),
  context: structuredClone(DEFAULT_CONFIG.context),
  maxFixCycles: DEFAULT_CONFIG.maxFixCycles
};

// src/cancellation-evidence.ts
var CANCELLATION_LIMITS = {
  state: 2 * 1024 * 1024,
  humanTime: 2 * 1024 * 1024,
  events: 8 * 1024 * 1024,
  lines: 1e4,
  line: 256 * 1024,
  observation: 16 * 1024,
  leaves: 4096,
  leafBytes: 16 * 1024 * 1024
};

// src/verification-config.ts
function transactionInvalid() {
  throw new BanzaiError(
    "CONFIGURATION_TRANSACTION_INVALID",
    "Configuration transaction evidence is incomplete or conflicting. Inspect the pending decision and preserve its recovery checkpoint."
  );
}
function runSegment(value) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,199}$/.test(value))
    return transactionInvalid();
  return value;
}
function parseVerificationConfigTransaction(value) {
  const item = configurationObject(value, [
    "schema",
    "schemaVersion",
    "operationId",
    "runId",
    "operation",
    "origin",
    "decisionId",
    "proposalId",
    "previewId",
    "configBeforeSha256",
    "configAfterSha256",
    "profileId",
    "previousCommandIds",
    "currentCommandIds",
    "sourceSha256",
    "continuation",
    "bootstrapCleared",
    "stage"
  ]);
  if (item.schema !== "banzai-verification-config-transaction/v1" || item.schemaVersion !== 1 || !["add", "edit", "remove"].includes(item.operation) || !["configuration_decision", "verify_command"].includes(
    item.origin
  ) || !["prepared", "applied", "finalized"].includes(item.stage) || typeof item.bootstrapCleared !== "boolean")
    transactionInvalid();
  function ids(value2) {
    if (!Array.isArray(value2) || value2.length > 200) transactionInvalid();
    const result = value2.map(configurationId);
    if (new Set(result).size !== result.length) transactionInvalid();
    return result;
  }
  const decisionId = item.decisionId === null ? null : configurationUuid(item.decisionId);
  const proposalId = item.proposalId === null ? null : configurationUuid(item.proposalId);
  if (item.origin === "configuration_decision" && (decisionId === null || proposalId === null || item.operation !== "add" || item.continuation === null) || item.origin === "verify_command" && (decisionId !== null || proposalId !== null))
    transactionInvalid();
  return {
    schema: "banzai-verification-config-transaction/v1",
    schemaVersion: 1,
    operationId: configurationUuid(item.operationId),
    runId: runSegment(configurationText(item.runId)),
    operation: item.operation,
    origin: item.origin,
    decisionId,
    proposalId,
    previewId: configurationUuid(item.previewId),
    configBeforeSha256: configurationHash(item.configBeforeSha256),
    configAfterSha256: configurationHash(item.configAfterSha256),
    profileId: configurationId(item.profileId),
    previousCommandIds: ids(item.previousCommandIds),
    currentCommandIds: ids(item.currentCommandIds),
    sourceSha256: configurationHash(item.sourceSha256),
    continuation: item.continuation === null ? null : parseConfigurationContinuation(item.continuation),
    bootstrapCleared: item.bootstrapCleared,
    stage: item.stage
  };
}
function parseVerificationConfigConfirmation(value, record) {
  const confirmation = configurationObject(value, [
    "preview",
    "confirmedBy",
    "confirmedAt"
  ]);
  const preview = configurationObject(confirmation.preview, [
    "previewId",
    "edit",
    "configBeforeSha256",
    "configAfterSha256",
    "sourceSha256",
    "delta"
  ]);
  if (preview.previewId !== record.previewId || preview.configBeforeSha256 !== record.configBeforeSha256 || preview.configAfterSha256 !== record.configAfterSha256 || preview.sourceSha256 !== record.sourceSha256)
    transactionInvalid();
  if (!Array.isArray(preview.delta) || preview.delta.length > 2)
    transactionInvalid();
  const delta = preview.delta.map((value2) => {
    const item = configurationObject(value2, ["start", "before", "after"]);
    if (!Number.isSafeInteger(item.start) || item.start < 0 || typeof item.before !== "string" || typeof item.after !== "string")
      transactionInvalid();
    return {
      start: item.start,
      before: item.before,
      after: item.after
    };
  });
  const editKeys = record.operation === "remove" ? ["operation", "profileId", "clearBootstrap"] : ["operation", "profile", "clearBootstrap"];
  if (record.operation === "edit" && preview.edit && typeof preview.edit === "object" && Object.hasOwn(preview.edit, "commandOrigins"))
    editKeys.push("commandOrigins");
  const edit = configurationObject(preview.edit, editKeys);
  if (edit.commandOrigins !== void 0 && (!Array.isArray(edit.commandOrigins) || edit.commandOrigins.length > 200 || edit.commandOrigins.some(
    (value2) => value2 !== null && (!Number.isSafeInteger(value2) || value2 < 0 || value2 >= 200)
  )))
    transactionInvalid();
  if (edit.operation !== record.operation || typeof edit.clearBootstrap !== "boolean")
    transactionInvalid();
  if (edit.operation === "remove" ? edit.profileId !== record.profileId || edit.clearBootstrap : edit.profile?.id !== record.profileId)
    transactionInvalid();
  const confirmedAt = configurationText(confirmation.confirmedAt, 24);
  if (!Number.isFinite(Date.parse(confirmedAt))) transactionInvalid();
  return {
    preview: {
      previewId: record.previewId,
      edit,
      configBeforeSha256: record.configBeforeSha256,
      configAfterSha256: record.configAfterSha256,
      sourceSha256: record.sourceSha256,
      delta
    },
    confirmedBy: configurationText(confirmation.confirmedBy),
    confirmedAt
  };
}
export {
  parseCompletionCandidate,
  parseCompletionCapture,
  parseCompletionPublication,
  parseCompletionPublicationCursor,
  parseCompletionTransition,
  parseConfigurationPrerequisite,
  parseCurrentReviewResult,
  parseEvaluationStateSource,
  parseModelAttemptRecord,
  parsePersistedPhaseResult,
  parsePhaseResultEnvelope,
  parsePlanTaskCompletionCheckpoint,
  parseRecoveryAuthorization,
  parseReviewResult,
  parseStoredPhaseResultEnvelope,
  parseTerminalAttemptCheckpoint,
  parseTerminalAttemptCheckpointV2,
  parseVerificationAttemptRecord,
  parseVerificationConfigConfirmation,
  parseVerificationConfigTransaction,
  validateConfigurationStateEnvelope
};
