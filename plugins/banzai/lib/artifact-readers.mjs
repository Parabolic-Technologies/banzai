// Generated from orchestrator persisted readers by npm run build. Do not edit.
var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

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
  const id = configurationText(value, 80);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) configurationInvalid();
  return id;
}
function configurationUuid(value) {
  const id = configurationText(value, 36);
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(
    id
  ))
    configurationInvalid();
  return id;
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
  if (state.schemaVersion !== 6) {
    if (Array.isArray(state.humanDecisions) && state.humanDecisions.some(
      (record) => record?.kind === "configuration_prerequisite"
    ) || "configurationSetup" in state || "verificationMode" in state || state.pendingHumanDecision?.kind === "configuration_prerequisite")
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
import { createHash } from "node:crypto";
var HASH = /^[a-f0-9]{64}$/u;
var ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
var MAX_BYTES = 512 * 1024 * 1024;
var VERIFICATION_REASONS = ["policy_disabled", "mandatory_fresh", "obligations_unavailable", "inputs_unavailable", "no_origin", "origin_invalid", "later_attempt", "identity_changed", "inputs_changed", "existing_execution", "equivalent_evidence"];
var VerificationEvidenceError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "VerificationEvidenceError";
    this.code = "VERIFICATION_EVIDENCE_INVALID";
  }
};
var invalid = (message) => {
  throw new VerificationEvidenceError(message);
};
function evidenceDigest(value) {
  return createHash("sha256").update(typeof value === "string" || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest("hex");
}
function object(value, required, optional = []) {
  if (!value || typeof value !== "object" || Array.isArray(value) || required.some((key) => !(key in value)) || Object.keys(value).some((key) => !required.includes(key) && !optional.includes(key))) invalid("Invalid verification object fields.");
  return value;
}
function text(value, limit = 200) {
  if (typeof value !== "string" || value.length === 0 || value.length > limit || /[\x00-\x1f]/u.test(value)) invalid("Invalid verification text.");
  return value;
}
function identifier(value) {
  if (!ID.test(text(value, 80))) invalid("Invalid verification identifier.");
  return value;
}
function digest(value) {
  if (typeof value !== "string" || !HASH.test(value)) invalid("Invalid verification digest.");
  return value;
}
function list(value, max = 200) {
  if (!Array.isArray(value) || value.length > max) invalid("Invalid verification inventory.");
  return value;
}
function unique(values) {
  if (new Set(values).size !== values.length) invalid("Duplicate verification identity.");
  return values;
}
function sameVerificationCapture(left, right) {
  return left.complete && right.complete && JSON.stringify(left) === JSON.stringify(right);
}
function parseVerificationDecision(value) {
  const record = object(value, ["schema", "schemaVersion", "workId", "roundId", "candidateDigest", "authorityDigest", "configurationDigest", "actions", "sha256"]);
  if (record.schema !== "banzai-verification-decision/v1" || record.schemaVersion !== 1) invalid("Unsupported verification decision.");
  text(record.workId);
  text(record.roundId);
  digest(record.authorityDigest);
  digest(record.configurationDigest);
  if (record.candidateDigest !== null) digest(record.candidateDigest);
  const checks = [];
  for (const action of list(record.actions)) {
    object(action, ["checkId", "action", "reason", "identity", "inputDigest", "environmentDigest", "origin"]);
    checks.push(identifier(action.checkId));
    object(action.identity, ["checkId", "profileOrdinal", "commandOrdinal", "configurationDigest", "policyDigest", "authorityDigest", "commandDigest"]);
    if (action.identity.checkId !== action.checkId || action.identity.configurationDigest !== record.configurationDigest || action.identity.authorityDigest !== record.authorityDigest || ![action.identity.profileOrdinal, action.identity.commandOrdinal].every((n) => Number.isSafeInteger(n) && n > 0)) invalid("Inconsistent verification decision identity.");
    digest(action.identity.commandDigest);
    for (const hash of [action.identity.policyDigest, action.inputDigest, action.environmentDigest]) if (hash !== null) digest(hash);
    if (!["execute", "reuse"].includes(action.action) || !VERIFICATION_REASONS.includes(action.reason)) invalid("Invalid verification disposition.");
    if (action.action === "reuse") {
      object(action.origin, ["attemptId", "recordDigest", "roundId"]);
      text(action.origin.attemptId);
      text(action.origin.roundId);
      digest(action.origin.recordDigest);
      if (action.reason !== "equivalent_evidence" || !record.candidateDigest || !action.inputDigest || !action.environmentDigest || !action.identity.policyDigest) invalid("Incomplete reuse decision.");
    } else if (action.origin !== null || action.reason === "equivalent_evidence") invalid("Execution cannot carry reuse evidence.");
  }
  unique(checks);
  const { sha256, ...body } = record;
  if (digest(sha256) !== evidenceDigest(body)) invalid("Verification decision digest mismatch.");
  return record;
}

// ../../plugins/banzai/lib/verification-store.mjs
import path4 from "node:path";

// ../../plugins/banzai/lib/artifact-storage.mjs
var artifact_storage_exports = {};
__export(artifact_storage_exports, {
  ADOPTION_LABELS: () => ADOPTION_LABELS,
  ArtifactStorageError: () => ArtifactStorageError,
  BINDING_SCHEMA: () => BINDING_SCHEMA,
  DECLARATION_PATH: () => DECLARATION_PATH,
  DECLARATION_SCHEMA: () => DECLARATION_SCHEMA,
  DISCOVERY_LIMIT: () => DISCOVERY_LIMIT,
  GUIDANCE_MAX_BYTES: () => GUIDANCE_MAX_BYTES,
  METADATA_LIMIT: () => METADATA_LIMIT,
  REQUEST_SCHEMA: () => REQUEST_SCHEMA,
  RESULT_SCHEMA: () => RESULT_SCHEMA,
  SCAFFOLD_MARKER: () => SCAFFOLD_MARKER,
  WORK_ROOT: () => WORK_ROOT,
  acquireWork: () => acquireWork,
  adoptionDiagnostic: () => adoptionDiagnostic,
  artifactCommand: () => artifactCommand,
  artifactRoles: () => artifactRoles,
  canonicalJson: () => canonicalJson,
  createWork: () => createWork,
  digestBytes: () => digestBytes,
  exactObject: () => exactObject,
  fail: () => fail,
  git: () => git,
  hasRunnerWorkOwnership: () => hasRunnerWorkOwnership,
  initializeArtifacts: () => initializeArtifacts,
  inspectArtifacts: () => inspectArtifacts,
  inspectBoundWork: () => inspectBoundWork,
  inspectProjectAdoption: () => inspectProjectAdoption,
  makeDirectories: () => makeDirectories,
  ownsArtifact: () => ownsArtifact,
  parseBinding: () => parseBinding,
  parseDeclaration: () => parseDeclaration,
  privateArtifactInventory: () => privateArtifactInventory,
  projectRoot: () => projectRoot,
  publishNew: () => publishNew,
  readAdoptionFile: () => readAdoptionFile,
  readBinding: () => readBinding,
  readBytes: () => readBytes,
  readInvocationBytes: () => readInvocationBytes,
  readJson: () => readJson,
  readSharedReviewSnapshot: () => parseReviewSnapshot,
  relativePath: () => relativePath,
  releaseWork: () => releaseWork,
  runArtifactOperation: () => runArtifactOperation,
  safePath: () => safePath,
  sealSharedReviewSnapshot: () => sealReviewSnapshot,
  verifyIgnores: () => verifyIgnores,
  withRunnerWorkOwnership: () => withRunnerWorkOwnership,
  writeArtifact: () => writeArtifact
});

// ../../plugins/banzai/lib/review-snapshot.mjs
import { createHash as createHash2 } from "node:crypto";
var digestCanonicalJson = (value) => createHash2("sha256").update(canonicalJson(value)).digest("hex");
var digestArtifactEntries = (entries) => createHash2("sha256").update(JSON.stringify({ version: 1, entries })).digest("hex");
function reviewScopePath(name) {
  if (typeof name !== "string" || name.trim().length === 0 || /^[A-Za-z]:/u.test(name) || /[\\\0\r\n]/u.test(name) || name.startsWith("/") || name.split("/").some((part) => part === "" || part === "." || part === ".."))
    throw new ArtifactStorageError(
      "INVALID_REVIEW_SCOPE",
      "Scope paths must be exact normalized repository-relative paths."
    );
  return name;
}
function invalid2(message) {
  throw new ArtifactStorageError("INVALID_REVIEW_SNAPSHOT", message);
}
function sealReviewSnapshot(value) {
  const snapshot = JSON.parse(JSON.stringify(value));
  return parseReviewSnapshot({
    ...snapshot,
    digest: digestCanonicalJson(snapshot)
  });
}
function parseReviewSnapshot(value) {
  try {
    return parseSnapshot(value);
  } catch (error) {
    if (error instanceof ArtifactStorageError && error.code === "INVALID_REVIEW_SNAPSHOT")
      throw error;
    invalid2("Review snapshot contains invalid nested evidence.");
  }
}
function object2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function equal(value, expected) {
  return value === expected;
}
function validateConfigurationSnapshot(snapshot) {
  const setup = snapshot.configurationSetup;
  const hash = (value) => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
  const uuid = (value) => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(value);
  const keys = (value, fields) => object2(value) && Object.keys(value).sort().join(",") === [...fields].sort().join(",");
  const ids = (value) => Array.isArray(value) && value.length <= 1e3 && value.every(uuid) && new Set(value).size === value.length;
  const types = (value) => Array.isArray(value) && value.length <= 9 && value.every((type) => ["custom", "node", "php", "python", "ruby", "rust", "go", "jvm", "dotnet"].includes(type)) && new Set(value).size === value.length && JSON.stringify(value) === JSON.stringify([...value].sort());
  if (!keys(setup, ["coverage", "projectTypes", "uncoveredTypes", "resolutionIds", "skip", "configPath", "configSha256", "carriedInConfigSha256", "runnerChanges"]) || !["ordered", "policy"].includes(snapshot.verificationMode) || snapshot.artifactBinding.binding.schemaVersion !== (snapshot.verificationMode === "policy" ? 2 : 1) || !["configured", "bootstrap_deferred", "skipped"].includes(setup.coverage) || !types(setup.projectTypes) || !types(setup.uncoveredTypes) || !ids(setup.resolutionIds) || setup.configPath !== ".banzai/config.json" || !hash(setup.configSha256) || setup.carriedInConfigSha256 !== null && !hash(setup.carriedInConfigSha256) || !Array.isArray(setup.runnerChanges) || setup.runnerChanges.length > 1e3) invalid2("Invalid guided configuration review evidence.");
  if (setup.skip !== null) {
    const skip = setup.skip;
    if (!keys(skip, ["id", "runId", "decisionId", "proposalId", "projectTypes", "configurationDigest"]) || !uuid(skip.id) || !uuid(skip.decisionId) || !uuid(skip.proposalId) || skip.runId !== snapshot.runId || !types(skip.projectTypes) || !hash(skip.configurationDigest) || JSON.stringify(skip.projectTypes) !== JSON.stringify(setup.projectTypes)) invalid2("Invalid configuration skip scope.");
  }
  if (setup.coverage === "skipped" !== (setup.skip !== null)) invalid2("Skipped review coverage requires its exact skip reference.");
  const operations = /* @__PURE__ */ new Set();
  for (const change of setup.runnerChanges) {
    if (!keys(change, ["transaction", "delta", "relation"]) || !["matches_after", "historical_delta"].includes(change.relation) || !Array.isArray(change.delta) || change.delta.length > 2) invalid2("Invalid runner configuration delta.");
    const transaction = parseVerificationConfigTransaction(change.transaction);
    if (transaction.stage === "prepared" || transaction.runId !== snapshot.runId || operations.has(transaction.operationId) || change.relation === "matches_after" !== (transaction.configAfterSha256 === setup.configSha256)) invalid2("Configuration delta identity is inconsistent.");
    operations.add(transaction.operationId);
    if (transaction.continuation && (transaction.continuation.workId !== snapshot.artifactBinding.binding.workId || transaction.continuation.workBindingSha256 !== snapshot.artifactBinding.sha256 || transaction.continuation.baseCommit !== snapshot.baseCommit || transaction.continuation.approvalDigest !== snapshot.approval.digest)) invalid2("Cross-authority configuration delta.");
    for (const delta of change.delta) if (!keys(delta, ["start", "before", "after"]) || !Number.isSafeInteger(delta.start) || delta.start < 0 || typeof delta.before !== "string" || typeof delta.after !== "string" || Buffer.byteLength(delta.before) + Buffer.byteLength(delta.after) > 2 * 1024 * 1024) invalid2("Unbounded or malformed runner configuration delta.");
  }
}
function parseSnapshot(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    invalid2("Review snapshot must be an object.");
  const snapshot = value;
  const { digest: digest2, ...body } = snapshot;
  const keys = [
    "schema",
    "schemaVersion",
    "runId",
    "attemptId",
    "outputContract",
    "baseCommit",
    "approval",
    "approvedArtifacts",
    "workspace",
    "reviewMode",
    "changes",
    "anchor",
    "fullReviewAnchor",
    "triage",
    "requiredFindingIds",
    "completionSource",
    "artifact",
    "digest"
  ];
  if (snapshot.schemaVersion >= 2) keys.push("artifactBinding");
  if (snapshot.schemaVersion === 4) keys.push("verificationMode", "configurationSetup");
  if (Object.keys(snapshot).length !== keys.length || Object.keys(snapshot).some((key) => !keys.includes(key)) || !(snapshot.schemaVersion === 1 && snapshot.schema === "banzai-review-snapshot/v1" || snapshot.schemaVersion === 2 && snapshot.schema === "banzai-review-snapshot/v2" || snapshot.schemaVersion === 3 && snapshot.schema === "banzai-review-snapshot/v3" || snapshot.schemaVersion === 4 && snapshot.schema === "banzai-review-snapshot/v4") || !equal(snapshot.outputContract, "review-result/v2") || !/^[a-f0-9]{64}$/u.test(digest2) || digest2 !== digestCanonicalJson(body))
    invalid2("Review snapshot version, shape or digest is invalid.");
  for (const id of [snapshot.runId, snapshot.attemptId])
    if (typeof id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(id))
      invalid2("Review snapshot identity is invalid.");
  if (snapshot.schemaVersion >= 2) {
    const bound = snapshot.artifactBinding;
    if (!bound || Object.keys(bound).sort().join(",") !== "binding,sha256" || !/^[a-f0-9]{64}$/u.test(bound.sha256))
      invalid2("Review snapshot binding is missing or malformed.");
    parseBinding(bound.binding);
    if (snapshot.schemaVersion === 2 && bound.binding.schemaVersion !== 1) invalid2("Snapshot v2 retains binding v1 semantics.");
    const workspace = snapshot.workspace;
    if (workspace.schemaVersion !== 2 || workspace.artifactBindingDigest !== bound.sha256 || Object.keys(workspace).sort().join(",") !== "artifactBindingDigest,baseCommit,digest,entries,schemaVersion")
      invalid2("Review snapshot workspace does not match its binding.");
    const expectedDigest = createHash2("sha256").update(
      JSON.stringify({
        version: 2,
        baseCommit: workspace.baseCommit,
        artifactBindingDigest: bound.sha256,
        entries: workspace.entries
      })
    ).digest("hex");
    if (workspace.digest !== expectedDigest || new Set(workspace.entries.map((entry) => entry.path)).size !== workspace.entries.length || canonicalJson(workspace.entries) !== canonicalJson(
      [...workspace.entries].sort(
        (a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0
      )
    ))
      invalid2("Review snapshot workspace entries or digest are invalid.");
    const roles = bound.binding.artifacts;
    if (snapshot.artifact.path !== `${roles.reviewDirectory}/review-${snapshot.artifact.iteration}.md` || snapshot.approval.paths.some(
      (p) => p !== roles.description && p !== roles.plan && !/^documentation\/decisions\/[0-9]{4}-[a-z0-9-]+\.md$/u.test(p)
    ) || snapshot.completionSource !== null && (snapshot.completionSource.implementationReport.path !== roles.implementationReport || snapshot.completionSource.testReport.path !== roles.testReport))
      invalid2("Review snapshot evidence is outside its exact bound roles.");
  } else if (snapshot.workspace.schemaVersion !== void 0 || snapshot.artifactBinding !== void 0) {
    invalid2("Legacy review snapshots cannot carry private storage authority.");
  }
  const artifact = snapshot.artifact;
  if (snapshot.schemaVersion === 4) validateConfigurationSnapshot(snapshot);
  if (snapshot.schemaVersion === 3 || snapshot.schemaVersion === 4 && snapshot.verificationMode === "policy" && snapshot.configurationSetup.coverage !== "skipped") {
    if (snapshot.artifactBinding.binding.schemaVersion !== 2) invalid2("Verification snapshot requires binding v2.");
    const evidence = parseReviewVerificationEvidence(artifact.verificationEvidence);
    if (evidence.decision.workId !== snapshot.artifactBinding.binding.workId) invalid2("Cross-work review verification evidence.");
  } else if (artifact?.verificationEvidence !== void 0) invalid2("Legacy snapshots cannot carry new verification evidence.");
  if (!object2(artifact) || !object2(snapshot.approval) || !object2(snapshot.workspace) || !Array.isArray(snapshot.approval.paths) || !Array.isArray(snapshot.approvedArtifacts) || !Array.isArray(snapshot.workspace.entries) || !Array.isArray(snapshot.changes) || !Array.isArray(snapshot.triage) || !Array.isArray(snapshot.requiredFindingIds) || !Array.isArray(artifact.verification) || !["full", "delta"].includes(snapshot.reviewMode) || !Number.isInteger(artifact.iteration) || artifact.iteration < 1)
    invalid2("Review snapshot evidence is malformed.");
  if ("snapshot" in artifact || JSON.stringify(artifact.approvedArtifactPaths) !== JSON.stringify(snapshot.approval.paths) || artifact.workspaceDigest !== snapshot.workspace.digest || snapshot.baseCommit !== snapshot.workspace.baseCommit || new Set(snapshot.approval.paths).size !== snapshot.approval.paths.length || snapshot.approvedArtifacts.length !== snapshot.approval.paths.length)
    invalid2("Review snapshot scope and workspace identities disagree.");
  if (snapshot.approvedArtifacts.some(
    (entry, index) => entry.path !== snapshot.approval.paths[index] || !/^[a-f0-9]{64}$/u.test(entry.sha256)
  ))
    invalid2("Approved artifact identities disagree with snapshot scope.");
  if (digestArtifactEntries(snapshot.approvedArtifacts) !== snapshot.approval.digest)
    invalid2(
      "Review snapshot file identities do not match the approved bundle digest."
    );
  snapshot.approval.paths.forEach(reviewScopePath);
  reviewScopePath(artifact.path);
  reviewScopePath(artifact.candidatePath);
  if (new Set(snapshot.requiredFindingIds).size !== snapshot.requiredFindingIds.length || snapshot.requiredFindingIds.some(
    (id) => typeof id !== "string" || !/^R[1-9][0-9]*-F[1-9][0-9]*$/u.test(id)
  ))
    invalid2("Snapshot accepted finding IDs are invalid.");
  const hash = (value2) => typeof value2 === "string" && /^[a-f0-9]{64}$/u.test(value2);
  const string = (value2) => typeof value2 === "string" && value2.length > 0;
  if (!string(snapshot.baseCommit) || !equal(snapshot.approval.kind, "plan") || !hash(snapshot.approval.digest) || !string(snapshot.approval.approvedBy) || !string(snapshot.approval.approvedAt) || !hash(snapshot.workspace.digest) || !string(artifact.slug))
    invalid2("Snapshot authority identity is malformed.");
  const anchor = snapshot.fullReviewAnchor;
  if (anchor !== null && (!Number.isInteger(anchor.iteration) || anchor.iteration < 1 || !string(anchor.sessionId) || !hash(anchor.approvalDigest) || !equal(anchor.outputContract, "review-result/v2")))
    invalid2("Full review anchor is malformed.");
  if (snapshot.reviewMode === "delta" && (snapshot.anchor === null || anchor?.approvalDigest !== snapshot.approval.digest || anchor.iteration > snapshot.anchor.iteration || snapshot.anchor.iteration >= artifact.iteration || !["full", "delta"].includes(snapshot.anchor.mode)))
    invalid2(
      "Delta snapshot needs a compatible full review and canonical anchor."
    );
  for (const entry of snapshot.workspace.entries) {
    reviewScopePath(entry.path);
    if (!string(entry.kind) || entry.sha256 !== null && !hash(entry.sha256))
      invalid2("Snapshot workspace entry is malformed.");
  }
  for (const change of snapshot.changes) {
    reviewScopePath(change.path);
    if (!["added", "modified", "deleted"].includes(change.change))
      invalid2("Snapshot change is malformed.");
  }
  for (const verification of artifact.verification) {
    if (!string(verification.name) || !string(verification.command) || !Array.isArray(verification.args) || verification.args.some((arg) => typeof arg !== "string") || !Number.isInteger(verification.exitCode) || verification.signal !== null && !string(verification.signal) || !string(verification.startedAt) || !string(verification.completedAt))
      invalid2("Snapshot verification is malformed.");
    reviewScopePath(verification.stdoutPath);
    reviewScopePath(verification.stderrPath);
  }
  if (snapshot.completionSource !== null) {
    const source = snapshot.completionSource;
    const projection = artifact.taskCompletion;
    if (!equal(source.schemaVersion, 1) || !equal(source.status, "valid") || !string(source.sourceAttemptId) || !["implementation", "fix"].includes(source.sourceAttemptKind ?? "") || source.approvalDigest !== snapshot.approval.digest || !hash(source.ledgerDigest) || !hash(source.planTaskDigest) || source.ledgerDigest !== projection?.ledgerDigest || source.planTaskDigest !== projection.planTaskDigest || source.approvalDigest !== projection.approvalDigest || source.counts.total !== projection.total || source.counts.completed !== projection.completed || source.implementationReport.path !== projection.implementationReport || source.testReport.path !== projection.testReport)
      invalid2("Snapshot completion identities disagree.");
    for (const report of [source.implementationReport, source.testReport]) {
      reviewScopePath(report.path);
      if (!hash(report.sha256))
        invalid2("Snapshot report identity is malformed.");
    }
  } else if (artifact.taskCompletion != null)
    invalid2("Snapshot completion projection lacks original source evidence.");
  return snapshot;
}

// ../../plugins/banzai/lib/project-adoption.mjs
import { constants } from "node:fs";
import { lstat, open, realpath, stat } from "node:fs/promises";
import path from "node:path";
var ADOPTION_LABELS = {
  ready: "Project guidance ready",
  setup_required: "Project setup required",
  migration_required: "Project migration required",
  needs_attention: "Project guidance needs attention"
};
var SCAFFOLD_MARKER = "<!-- banzai-scaffold: unfilled -->";
var GUIDANCE_MAX_BYTES = 256 * 1024;
var METADATA_MAX_BYTES = 64 * 1024;
var MANIFEST_SECTIONS = [
  "Project Overview",
  "Platform & Tooling",
  "Architecture",
  "Project Structure",
  "Key Modules & Components",
  "State & Data Flow",
  "Dependencies",
  "Testing",
  "Conventions",
  "Technical Constraints & Decision Index"
];
var POLICY_HEADINGS = [
  "Decision Consultation",
  "Test Assurance",
  "Security Assurance",
  "Engineering Quality",
  "Plan Task Completion Evidence"
];
var SOURCE_FILES = [
  ".claude-plugin/plugin.json",
  ".codex-plugin/plugin.json",
  "package.json",
  ".claude-plugin/marketplace.json",
  "plugins/banzai/.claude-plugin/plugin.json",
  "plugins/banzai/.codex-plugin/plugin.json"
];
function contained(root, target) {
  const relative = path.relative(root, target);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
async function readAdoptionFile(root, file, limit) {
  const missing = { text: null, problem: null };
  const unsafe = { text: null, problem: "unsafe or unreadable file" };
  try {
    let candidate = root;
    for (const part of file.split("/")) {
      candidate = path.join(candidate, part);
      try {
        await lstat(candidate);
      } catch (error) {
        if (error.code === "ENOENT") return missing;
        return unsafe;
      }
      if (!contained(root, await realpath(candidate))) return unsafe;
    }
    const resolved = await realpath(candidate);
    const before = await stat(resolved);
    if (!before.isFile() || (before.mode & 292) === 0) return unsafe;
    if (before.size > limit)
      return { text: null, problem: "file exceeds size limit" };
    const handle = await open(
      resolved,
      constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW
    );
    try {
      const opened = await handle.stat();
      if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino)
        return unsafe;
      const buffer = Buffer.alloc(limit + 1);
      let length = 0;
      while (length < buffer.length) {
        const { bytesRead } = await handle.read(
          buffer,
          length,
          buffer.length - length,
          length
        );
        if (bytesRead === 0) break;
        length += bytesRead;
      }
      if (length > limit)
        return { text: null, problem: "file exceeds size limit" };
      const after = await handle.stat();
      const current = await stat(candidate);
      if ([opened, after, current].some(
        (value) => value.dev !== before.dev || value.ino !== before.ino || value.size !== before.size || value.mtimeMs !== before.mtimeMs || value.ctimeMs !== before.ctimeMs
      ) || await realpath(candidate) !== resolved || length !== after.size) {
        return { text: null, problem: "file changed during inspection" };
      }
      return {
        text: new TextDecoder("utf-8", { fatal: true }).decode(
          buffer.subarray(0, length)
        ),
        problem: null
      };
    } finally {
      await handle.close();
    }
  } catch {
    return unsafe;
  }
}
function visibleMarkdown(text2) {
  let comment = false;
  let fence = null;
  const lines = [];
  for (const raw of text2.split(/\r?\n/)) {
    if (fence !== null) {
      const close = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(raw);
      if (close?.[1]?.[0] === fence.marker && close[1].length >= fence.length)
        fence = null;
      continue;
    }
    let line = "";
    let offset = 0;
    while (offset < raw.length) {
      const index = raw.indexOf(comment ? "-->" : "<!--", offset);
      if (index < 0) {
        if (!comment) line += raw.slice(offset);
        break;
      }
      if (!comment) line += raw.slice(offset, index);
      offset = index + (comment ? 3 : 4);
      comment = !comment;
    }
    const start = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (start?.[1]) {
      fence = { marker: start[1].charAt(0), length: start[1].length };
      continue;
    }
    lines.push(line);
  }
  return lines;
}
function headings(text2) {
  return new Set(
    visibleMarkdown(text2).flatMap((line) => {
      const match = /^ {0,3}##[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/.exec(line);
      return match?.[1] ? [match[1]] : [];
    })
  );
}
function object3(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
async function sourceIdentity(root, issues) {
  const metadata = await Promise.all(
    SOURCE_FILES.map(
      (file) => readAdoptionFile(root, file, METADATA_MAX_BYTES)
    )
  );
  const values = metadata.map((entry, index) => {
    let problem = entry.problem;
    if (entry.text !== null) {
      try {
        const value = JSON.parse(entry.text);
        if (object3(value)) return value;
      } catch {
      }
      problem = "invalid identity metadata";
    }
    if (problem)
      issues.push({
        file: SOURCE_FILES[index] ?? "plugin metadata",
        reason: problem,
        classification: "needs_attention"
      });
    return null;
  });
  const [claude, codex, pkg, marketplace, nestedClaude, nestedCodex] = values;
  const roots = [claude, codex].filter((value) => value !== null);
  const rootCandidate = roots.some((value) => value?.name === "banzai");
  const pluginRoot = rootCandidate && roots.every((value) => value?.name === "banzai") && metadata.slice(0, 2).every((entry, index) => entry.text === null || values[index] !== null);
  if (rootCandidate && !pluginRoot) {
    issues.push({
      file: ".claude-plugin/plugin.json / .codex-plugin/plugin.json",
      reason: "conflicting source identity",
      classification: "needs_attention"
    });
  }
  const entries = Array.isArray(marketplace?.plugins) ? marketplace.plugins.filter(
    (value) => object3(value) && value.name === "banzai"
  ) : [];
  const sourceWorkspace = pkg?.name === "banzai-spec-driven-dev" && pkg.private === true && Array.isArray(pkg.workspaces) && pkg.workspaces.includes("packages/*") && entries.length === 1 && object3(entries[0]) && entries[0].source === "./plugins/banzai" && nestedClaude?.name === "banzai" && nestedCodex?.name === "banzai";
  if (pkg?.name === "banzai-spec-driven-dev" && (entries.length > 1 || [nestedClaude, nestedCodex].some(
    (value) => value && value.name !== "banzai"
  ))) {
    issues.push({
      file: "package.json / plugin metadata",
      reason: "conflicting source identity",
      classification: "needs_attention"
    });
  }
  return !issues.some((issue2) => issue2.classification === "needs_attention") && (pluginRoot || sourceWorkspace);
}
function inspectManifest(text2, issues) {
  for (const line of text2.split(/\r?\n/)) {
    if (/^ {0,3}#{1,6}(?:[ \t]|$)/.test(line)) break;
    if (line === SCAFFOLD_MARKER) {
      issues.push({
        file: "PROJECT_MANIFEST.md",
        reason: "scaffold marker present",
        classification: "setup_required"
      });
      return;
    }
  }
  const sections = [];
  for (const line of visibleMarkdown(text2)) {
    const match = /^ {0,3}##[ \t]+(?:\d+\.[ \t]+)?(.+?)(?:[ \t]+#+)?[ \t]*$/.exec(line);
    if (match?.[1]) sections.push({ name: match[1], content: false });
    else if (line.trim() && !/^ {0,3}#{1,6}(?:[ \t]|$)/.test(line) && sections.length > 0) {
      const section = sections.at(-1);
      if (section) section.content = true;
    }
  }
  if (sections.length !== MANIFEST_SECTIONS.length || sections.some(
    (section, index) => section.name !== MANIFEST_SECTIONS[index] || !section.content
  )) {
    issues.push({
      file: "PROJECT_MANIFEST.md",
      reason: "required sections missing, empty or out of order",
      classification: "setup_required"
    });
  }
}
async function inspectProjectAdoption(repoRoot, options = {}) {
  const issues = [];
  let root;
  try {
    root = await realpath(repoRoot);
  } catch {
    return {
      classification: "needs_attention",
      label: ADOPTION_LABELS.needs_attention,
      sourceRepository: false,
      files: [],
      issues: [
        {
          file: "AGENTS.md",
          reason: "repository unreadable",
          classification: "needs_attention"
        }
      ]
    };
  }
  const sourceRepository = await sourceIdentity(root, issues);
  const files = options.layoutOnly ? ["AGENTS.md", "CLAUDE.md"] : ["AGENTS.md", "CLAUDE.md", "PROJECT_MANIFEST.md"];
  const entries = await Promise.all(
    files.map((file) => readAdoptionFile(root, file, GUIDANCE_MAX_BYTES))
  );
  entries.forEach((entry, index) => {
    if (entry.problem)
      issues.push({
        file: files[index] ?? "guidance",
        reason: entry.problem,
        classification: "needs_attention"
      });
  });
  const agents = entries[0]?.text ?? null;
  const claude = entries[1]?.text ?? null;
  const agentHeadings = headings(agents ?? "");
  const claudeHeadings = headings(claude ?? "");
  const hasPolicy = (set) => POLICY_HEADINGS.some((heading) => set.has(heading));
  if (!entries[0]?.problem && !entries[1]?.problem) {
    if (sourceRepository) {
      if (agents === null)
        issues.push({
          file: "AGENTS.md",
          reason: "missing",
          classification: "setup_required"
        });
    } else if (agents !== null && agentHeadings.has("Authority") && agentHeadings.has("Policies") && !/^@/m.test(agents) && !hasPolicy(claudeHeadings)) {
    } else if (claudeHeadings.has("Engineering Quality") && !agentHeadings.has("Authority")) {
      issues.push({
        file: "AGENTS.md / CLAUDE.md",
        reason: "legacy Banzai layout: run `project-manifest` to migrate",
        classification: "migration_required"
      });
    } else if (![agentHeadings, claudeHeadings].some(
      (set) => set.has("Authority") || hasPolicy(set)
    )) {
      issues.push({
        file: "AGENTS.md",
        reason: agents === null ? "missing" : "Banzai instruction layout absent",
        classification: "setup_required"
      });
    } else {
      issues.push({
        file: "AGENTS.md / CLAUDE.md",
        reason: "partial or conflicting instruction layout",
        classification: "needs_attention"
      });
    }
  }
  if (!options.layoutOnly) {
    const manifest = entries[2];
    if (manifest && !manifest.problem) {
      if (manifest.text === null)
        issues.push({
          file: "PROJECT_MANIFEST.md",
          reason: "missing",
          classification: "setup_required"
        });
      else inspectManifest(manifest.text, issues);
    }
  }
  const classification = ["needs_attention", "migration_required", "setup_required"].find(
    (value) => issues.some((issue2) => issue2.classification === value)
  ) ?? "ready";
  return {
    classification,
    label: ADOPTION_LABELS[classification],
    sourceRepository,
    files: entries.map((entry, index) => ({
      file: files[index] ?? "guidance",
      status: entry.problem ? "unreadable" : entry.text === null ? "missing" : "present"
    })),
    issues
  };
}
function adoptionDiagnostic(result) {
  return [
    result.label,
    ...result.issues.map((issue2) => `${issue2.file}: ${issue2.reason}`)
  ].join(". ");
}

// ../../plugins/banzai/lib/artifact-archive.mjs
import {
  lstat as lstat2,
  mkdir,
  readdir,
  rename,
  chmod,
  open as open2,
  unlink
} from "node:fs/promises";
import path2 from "node:path";
import { randomUUID } from "node:crypto";
var ARCHIVE_SCHEMA = "banzai-artifact-archive/v1";
var LIMIT = 25e3;
var SHA = /^[0-9a-f]{64}$/u;
var secretPath = /(?:^|\/)(?:\.ssh|\.aws|\.gnupg|\.codex|\.claude|node_modules|auth\.json|credentials(?:\.json)?|\.env(?:\.[^/]+)?)(?:\/|$)|\.(?:pem|key|p12|pfx)$/iu;
var control = /(?:^|\/)(?:active-run\.json|runner\.lock|\.writer-claim\.json|\.artifact-init\.lock)$/u;
function bounded(value, name) {
  if (typeof value !== "string" || !value.length || value.length > 200 || /[\x00-\x1f\x7f]/u.test(value))
    fail(
      "ARTIFACT_INPUT_INVALID",
      `${name} must be a bounded explicit identity.`
    );
  return value;
}
function archivePath(value) {
  relativePath(value);
  if (secretPath.test(value) || value === ".banzai/archive-manifest.json")
    fail(
      "ARTIFACT_UNSAFE_PATH",
      "Authentication, credential and key locations cannot enter an artifact archive."
    );
  return value;
}
async function directory(input) {
  if (typeof input !== "string" || !path2.isAbsolute(input))
    fail(
      "ARTIFACT_INPUT_INVALID",
      "Archive directories must be absolute local paths."
    );
  const root = path2.parse(input).root;
  await safePath(root, path2.relative(root, input), { directory: true });
  return input;
}
async function missingDestination(input) {
  if (typeof input !== "string" || !path2.isAbsolute(input))
    fail(
      "ARTIFACT_INPUT_INVALID",
      "Destination must be an absolute local directory."
    );
  if (input !== path2.resolve(input))
    fail("ARTIFACT_UNSAFE_PATH", "Destination must be canonical, without dot segments or path aliases.");
  await directory(path2.dirname(input));
  await safePath(path2.dirname(input), path2.basename(input), {
    missing: true,
    directory: true
  });
  return input;
}
function sourcePath(parent, reference, sourceRoot = null) {
  if (typeof reference !== "string" || !reference.length || /^(?:https?:|mailto:|#|app:)/u.test(reference))
    return null;
  let clean = reference.split("#")[0];
  if (path2.posix.isAbsolute(clean)) {
    if (sourceRoot && clean.startsWith(`${sourceRoot}/`))
      clean = clean.slice(sourceRoot.length + 1);
    else return `external/${digestBytes(clean)}`;
  }
  const run = parent.match(/^(\.banzai\/runs\/[^/]+)\//u)?.[1];
  const work = parent.match(/^(\.banzai\/work\/[^/]+)\/verification\//u)?.[1];
  if (work && clean.startsWith("verification/")) clean = `${work}/${clean}`;
  if (run && /^(?:attempts|reviews|verification|approval|recovery)\//u.test(clean))
    clean = `${run}/${clean}`;
  const candidate = clean.startsWith("./") || clean.startsWith("../") ? path2.posix.normalize(path2.posix.join(path2.posix.dirname(parent), clean)) : clean;
  if (candidate.startsWith("../") || path2.posix.isAbsolute(candidate) || /[\x00-\x20<>`{}]/u.test(candidate))
    return null;
  if (!candidate.includes("/") && !/\.(?:md|json|jsonl|log)$/u.test(candidate))
    return null;
  return candidate.replace(/\/$/u, "");
}
function markdownProse(text2) {
  let fence = null;
  return text2.split("\n").map((line) => {
    const marker = /^ {0,3}(`{3,}|~{3,})/u.exec(line)?.[1];
    if (fence !== null) {
      if (marker && marker[0] === fence[0] && marker.length >= fence.length) fence = null;
      return "";
    }
    if (marker) {
      fence = marker;
      return "";
    }
    return line.replace(/(`+).*?\1/gu, "");
  }).join("\n");
}
function dependenciesFor(relative, bytes, sourceRoot = null) {
  const refs = /* @__PURE__ */ new Map();
  let supported = true;
  const text2 = bytes.toString("utf8");
  if (relative.endsWith(".json")) {
    let value;
    try {
      value = JSON.parse(text2);
    } catch {
      return { refs, supported: false };
    }
    try {
      if (value.schema === "banzai-verification-config-transaction/v1") parseVerificationConfigTransaction(value);
      else if (value.schema === "banzai-verification-decision/v1") parseVerificationDecision(value);
      else if (value.schema === "banzai-verification-applicability/v1") parseVerificationApplicability(value);
      else if (value.schema === "banzai-verification-origin-start/v1") parseVerificationOriginStart(value);
      else if (value.schema === "banzai-verification-origin-finish/v1") parseVerificationOriginFinish(value);
      else if (value.schema === "banzai-terminal-attempt-checkpoint/v1")
        parseTerminalAttemptCheckpoint(value);
      else if (value.schema === "banzai-recovery-authorization/v1")
        parseRecoveryAuthorization(value);
      else if (/^\.banzai\/runs\/[^/]+\/state\.json$/u.test(relative))
        parseEvaluationStateSource(value);
      else if (/^\.banzai\/runs\/[^/]+\/attempts\/[^/]+\.json$/u.test(relative) && value.attempt && "startedAt" in value)
        parseModelAttemptRecord(value);
      else if (/^\.banzai\/(?:runs\/[^/]+\/verification-attempts|work\/[^/]+\/verification\/attempts)\//u.test(relative) && "command" in value)
        parseVerificationAttemptRecord(value);
      else if ("phase" in value && "outcome" in value)
        parsePersistedPhaseResult(value);
      else if ("verdict" in value && "findings" in value)
        (value.schemaVersion === 2 ? parseCurrentReviewResult : parseReviewResult)(value);
    } catch {
      return { refs, supported: false };
    }
    if (relative.endsWith("/work.json")) {
      parseBinding(value);
      return { refs, supported };
    }
    if (/\.banzai\/runs\/[^/]+\/state\.json$/u.test(relative) && ![1, 2, 3, 4, 5, 6].includes(value.schemaVersion))
      supported = false;
    if (typeof value.schema === "string" && !(/* @__PURE__ */ new Set([
      "banzai-terminal-attempt-checkpoint/v1",
      "banzai-recovery-authorization/v1",
      "banzai-review-snapshot/v1",
      "banzai-review-snapshot/v2",
      "banzai-review-snapshot/v3",
      "banzai-review-snapshot/v4",
      "banzai-verification-config-transaction/v1",
      "banzai-work-binding/v2",
      "banzai-verification-decision/v1",
      "banzai-verification-applicability/v1",
      "banzai-verification-origin-start/v1",
      "banzai-verification-origin-finish/v1",
      "banzai-work-binding/v1",
      "banzai-context-attempt/v1",
      "banzai-context-report/v1"
    ])).has(value.schema))
      supported = false;
    if (typeof value.schema === "string" && value.schema.startsWith("banzai-review-snapshot/")) {
      try {
        parseReviewSnapshot(value);
      } catch {
        return { refs, supported: false };
      }
    }
    if (/\.banzai\/runs\/[^/]+\/state\.json$/u.test(relative) && value.schemaVersion >= 4) {
      try {
        exactObject(value.artifactBinding, ["binding", "sha256"]);
        parseBinding(value.artifactBinding.binding);
        if (!SHA.test(value.artifactBinding.sha256)) supported = false;
      } catch {
        supported = false;
      }
    }
    const workflowEvidence = relative.startsWith(".banzai/runs/") || relative.includes("/verification/") || typeof value.schema === "string" && /^banzai-(?:review-snapshot|work-binding)\/v/u.test(value.schema);
    if (!workflowEvidence) return { refs, supported };
    const run = relative.match(/^(\.banzai\/runs\/[^/]+)\//u)?.[1];
    if (run && relative !== `${run}/state.json`) refs.set(`${run}/state.json`, true);
    if (run && value.schema === "banzai-verification-config-transaction/v1") {
      if (relative !== `${run}/configuration/${value.operationId}.transaction.json` || value.runId !== run.split("/").at(-1)) supported = false;
      refs.set(`${run}/configuration/${value.operationId}.confirmation.json`, true);
    }
    if (run && /^.*\/configuration\/[^/]+\.confirmation\.json$/u.test(relative)) refs.set(relative.replace(/\.confirmation\.json$/u, ".transaction.json"), true);
    if (run && value.schemaVersion === 6 && relative === `${run}/state.json`) for (const id of value.configurationSetup.transactions) refs.set(`${run}/configuration/${id}.transaction.json`, true);
    if (value.schema === "banzai-review-snapshot/v4") for (const change of value.configurationSetup.runnerChanges) refs.set(`.banzai/runs/${value.runId}/configuration/${change.transaction.operationId}.transaction.json`, true);
    const evidenceRoot = relative.match(/^(\.banzai\/(?:runs\/[^/]+|work\/[^/]+)\/verification)(?:\/|$)/u)?.[1] ?? (run ? `${run}/verification` : null);
    if (evidenceRoot && value.workId) refs.set(`.banzai/work/${value.workId}/work.json`, true);
    if (value.schema === "banzai-verification-origin-finish/v1") refs.set(`${evidenceRoot}/origins/${value.attemptId}.start.json`, true);
    if (value.schema === "banzai-verification-applicability/v1") refs.set(`${evidenceRoot}/decisions/${value.decisionSha256}.json`, true);
    const visit = (item, key = "") => {
      if (Array.isArray(item)) {
        for (const child of item) visit(child, key);
      } else if (item && typeof item === "object") {
        if (evidenceRoot && item.schema === "banzai-verification-decision/v1") refs.set(`${evidenceRoot}/decisions/${item.sha256}.json`, true);
        if (evidenceRoot && item.schema === "banzai-verification-applicability/v1") refs.set(`${evidenceRoot}/applications/${item.sha256}.json`, true);
        if (key === "origin" && evidenceRoot && /^verification-[a-f0-9-]{36}$/u.test(item.attemptId)) {
          refs.set(`${evidenceRoot}/origins/${item.attemptId}.start.json`, true);
          refs.set(`${evidenceRoot}/origins/${item.attemptId}.finish.json`, true);
        }
        if (key === "artifactBinding") {
          parseBinding(item.binding);
          refs.set(`.banzai/work/${item.binding.workId}/work.json`, true);
          return;
        }
        for (const [name, child] of Object.entries(item)) if (name !== "configPath") visit(child, name);
      } else if (typeof item === "string" && /(?:path|paths|description|plan|implementationReport|testReport|work|changeReport)$/iu.test(
        key
      )) {
        const ref = sourcePath(relative, item, sourceRoot);
        if (ref && !control.test(ref)) refs.set(ref, true);
      }
    };
    visit(value);
  } else if (relative.endsWith(".md")) {
    for (const match of markdownProse(text2).matchAll(/\[([^\]\n]*)\]\(([^)\s]+)\)/gu)) {
      const raw = match[2].split("#")[0];
      if (/^(?:https?:|mailto:|#)/u.test(match[2])) continue;
      const ref = sourcePath(relative, raw.startsWith(".") ? raw : `./${raw}`);
      if (ref) {
        const authority = /(?:^|\/)(?:description|plan|work)\.md$/u.test(ref) || /^documentation\/decisions\/(?!README\.md$)[^/]+\.md$/u.test(ref) || /(?:Accepted ADR|Required (?:ADR|description|plan))/iu.test(match[1]);
        const optional = /^Historical \(optional\): /u.test(match[1]);
        refs.set(ref, (refs.get(ref) ?? false) || authority && !optional);
      }
    }
  }
  return { refs, supported };
}
function localProjectIdentity(root) {
  return `local-sha256:${digestBytes(root)}`;
}
function retainedPaths(manifest, objects) {
  const protectedPaths = /* @__PURE__ */ new Set();
  for (const pin of manifest.retention.pins) {
    const bindingPath = `.banzai/work/${pin.workId}/work.json`;
    const bindingEntry = manifest.entries.find((entry) => entry.path === bindingPath);
    if (!bindingEntry) fail("ARTIFACT_EVIDENCE_INCOMPLETE", "Pinned work has no archived binding provenance.");
    protectedPaths.add(bindingPath);
    for (const entry of manifest.entries) {
      const run = entry.path.match(/^(\.banzai\/runs\/[^/]+)\/state\.json$/u)?.[1];
      if (!run) continue;
      let state;
      try {
        state = JSON.parse(objects.get(entry.path).toString("utf8"));
      } catch {
        continue;
      }
      if (state?.artifactBinding?.binding?.workId === pin.workId) {
        for (const item of manifest.entries) if (item.path.startsWith(`${run}/`)) protectedPaths.add(item.path);
      }
    }
    for (const entry of manifest.entries)
      if (entry.path.startsWith(`.banzai/work/${pin.workId}/`)) protectedPaths.add(entry.path);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of manifest.dependencies) {
      if (protectedPaths.has(edge.from) && edge.required && edge.status === "included" && !protectedPaths.has(edge.to)) {
        protectedPaths.add(edge.to);
        changed = true;
      }
    }
  }
  return [...protectedPaths].sort();
}
async function inventoryArtifacts(input) {
  const root = await projectRoot(input.repoRoot);
  const workPaths = input.workPaths ?? [];
  const selectedRunIds = input.runIds ?? [];
  if (!Array.isArray(workPaths) || !Array.isArray(selectedRunIds) || workPaths.length + selectedRunIds.length < 1 || workPaths.length + selectedRunIds.length > LIMIT || selectedRunIds.some((id) => typeof id !== "string" || !/^[a-zA-Z0-9_-]+$/u.test(id)))
    fail("ARTIFACT_INPUT_INVALID", "Select a bounded nonempty list of workPaths and/or selectedRunIds.");
  const selectedPaths = [...workPaths.map(relativePath), ...selectedRunIds.map((id) => `.banzai/runs/${id}`)];
  const files = /* @__PURE__ */ new Map();
  const excluded = [];
  const walk = async (relative) => {
    archivePath(relative);
    const target = path2.join(root, relative);
    const stat2 = await lstat2(target).catch(
      () => fail(
        "ARTIFACT_EVIDENCE_INCOMPLETE",
        "Selected archive evidence is unavailable."
      )
    );
    await safePath(root, relative, { directory: stat2.isDirectory() });
    if (control.test(relative)) {
      excluded.push(relative);
      return;
    }
    if (stat2.isDirectory()) {
      for (const name of (await readdir(target)).sort())
        await walk(`${relative}/${name}`);
    } else {
      const bytes = await readBytes(root, relative);
      files.set(relative, { bytes, mode: stat2.mode & 511 });
      if (files.size > LIMIT)
        fail(
          "ARTIFACT_DISCOVERY_LIMIT",
          "Archive selection exceeds the bounded inventory."
        );
    }
  };
  for (const relative of selectedPaths) await walk(relative);
  const dependencies = [];
  const uninterpreted = [];
  for (const [relative, value] of files) {
    if (/^\.banzai\/work\/[^/]+\/work\.json$/u.test(relative)) {
      const binding = parseBinding(JSON.parse(value.bytes.toString("utf8")));
      for (const target of Object.values(binding.artifacts)) {
        try {
          await walk(target);
        } catch (error) {
          if (error.code !== "ARTIFACT_EVIDENCE_INCOMPLETE") throw error;
        }
      }
    }
    const run = relative.match(/^(\.banzai\/runs\/[^/]+)\//u)?.[1];
    if (run && !files.has(`${run}/state.json`)) {
      try {
        await walk(`${run}/state.json`);
      } catch {
      }
    }
    let sourceRoot = null;
    try {
      sourceRoot = JSON.parse(
        files.get(`${run}/state.json`)?.bytes.toString("utf8") ?? "null"
      )?.repoRoot ?? null;
    } catch {
    }
    const decoded = dependenciesFor(relative, value.bytes, sourceRoot);
    if (!decoded.supported) uninterpreted.push(relative);
    for (const [reference, required] of decoded.refs) {
      let status = "included";
      if (reference.startsWith("external/")) status = "external";
      else if (!files.has(reference)) {
        try {
          await walk(reference);
        } catch (error) {
          if (!["ARTIFACT_EVIDENCE_INCOMPLETE", "ARTIFACT_UNSAFE_PATH"].includes(
            error.code
          ))
            throw error;
          status = "missing";
        }
      }
      if (status === "included" && !files.has(reference)) status = "external";
      dependencies.push({
        sourceId: "project",
        from: relative,
        to: reference,
        required,
        status
      });
    }
  }
  for (const [relative, value] of files) {
    if (!/^\.banzai\/work\/[^/]+\/work\.json$/u.test(relative)) continue;
    const binding = parseBinding(JSON.parse(value.bytes.toString("utf8")));
    for (const [role, target] of Object.entries(binding.artifacts)) {
      for (const filename of files.keys()) {
        if (filename === target || role === "reviewDirectory" && filename.startsWith(`${target}/`))
          dependencies.push({ sourceId: "project", from: relative, to: filename, required: true, status: "included" });
      }
    }
  }
  let sourceCommit = null;
  try {
    sourceCommit = (await git(root, ["rev-parse", "--verify", "HEAD^{commit}"])).stdout.trim();
  } catch {
  }
  const workIds = [], runIds = [];
  for (const relative of files.keys()) {
    const work = relative.match(/^\.banzai\/work\/([^/]+)\/work\.json$/u);
    if (work) workIds.push(work[1]);
    const run = relative.match(/^\.banzai\/runs\/([^/]+)\/state\.json$/u);
    if (run) runIds.push(run[1]);
  }
  const entries = [...files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([relative, value]) => {
    const sha256 = digestBytes(value.bytes);
    return {
      sourceId: "project",
      path: relative,
      size: value.bytes.length,
      mode: value.mode,
      sha256,
      object: `objects/${sha256}`
    };
  });
  const retention = { policy: "unspecified", rules: {}, ownerPolicy: null, pins: [], deletionAuthorized: false };
  const inventory = {
    schema: ARCHIVE_SCHEMA,
    schemaVersion: 1,
    bundleId: randomUUID(),
    createdAt: (/* @__PURE__ */ new Date()).toISOString(),
    sources: [
      {
        id: "project",
        projectIdentity: localProjectIdentity(root),
        sourceCommit,
        workIds,
        runIds
      }
    ],
    entries,
    dependencies,
    retention
  };
  return {
    inventory,
    complete: dependencies.every(
      (edge) => !edge.required || edge.status === "included"
    ) && uninterpreted.length === 0,
    uninterpreted,
    excluded
  };
}
function parseArchive(value) {
  exactObject(value, [
    "schema",
    "schemaVersion",
    "bundleId",
    "createdAt",
    "sources",
    "entries",
    "dependencies",
    "retention"
  ]);
  if (value.schema !== ARCHIVE_SCHEMA || value.schemaVersion !== 1)
    fail(
      "ARTIFACT_VERSION_UNSUPPORTED",
      "Unsupported artifact archive version."
    );
  bounded(value.bundleId, "bundleId");
  if (!Number.isFinite(Date.parse(value.createdAt)) || !Array.isArray(value.sources) || value.sources.length !== 1 || !Array.isArray(value.entries) || value.entries.length > LIMIT || !Array.isArray(value.dependencies) || value.dependencies.length > LIMIT * 10)
    fail(
      "ARTIFACT_INPUT_INVALID",
      "Archive inventory is malformed or exceeds its bound."
    );
  const source = exactObject(value.sources[0], [
    "id",
    "projectIdentity",
    "sourceCommit",
    "workIds",
    "runIds"
  ]);
  if (source.id !== "project")
    fail("ARTIFACT_INPUT_INVALID", "Archive source identity is unsupported.");
  bounded(source.projectIdentity, "projectIdentity");
  if (!(source.sourceCommit === null || /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(source.sourceCommit)) || !Array.isArray(source.workIds) || !Array.isArray(source.runIds) || [...source.workIds, ...source.runIds].some(
    (id) => typeof id !== "string" || !/^[a-zA-Z0-9_-]+$/u.test(id)
  ))
    fail("ARTIFACT_INPUT_INVALID", "Archive provenance is malformed.");
  const paths = /* @__PURE__ */ new Set();
  for (const entry of value.entries) {
    exactObject(entry, [
      "sourceId",
      "path",
      "size",
      "mode",
      "sha256",
      "object"
    ]);
    archivePath(entry.path);
    if (control.test(entry.path) || paths.has(entry.path) || entry.sourceId !== source.id || !Number.isSafeInteger(entry.size) || entry.size < 0 || !Number.isInteger(entry.mode) || entry.mode < 0 || entry.mode > 511 || !SHA.test(entry.sha256) || entry.object !== `objects/${entry.sha256}`)
      fail(
        "ARTIFACT_INPUT_INVALID",
        "Archive entry identity is malformed or duplicated."
      );
    paths.add(entry.path);
  }
  for (const edge of value.dependencies) {
    exactObject(edge, ["sourceId", "from", "to", "required", "status"]);
    archivePath(edge.from);
    relativePath(edge.to);
    if (edge.sourceId !== source.id || !paths.has(edge.from) || typeof edge.required !== "boolean" || !["included", "missing", "external"].includes(edge.status) || edge.status === "included" && !paths.has(edge.to))
      fail(
        "ARTIFACT_EVIDENCE_INCOMPLETE",
        "Archive dependency identity is unresolved."
      );
  }
  const retention = exactObject(value.retention, [
    "policy",
    "rules",
    "deletionAuthorized",
    "ownerPolicy",
    "pins"
  ]);
  if (!["banzai", "owner", "unspecified"].includes(retention.policy) || retention.deletionAuthorized !== false)
    fail(
      "ARTIFACT_INPUT_INVALID",
      "Archive retention policy cannot authorize deletion."
    );
  if (retention.policy === "owner") {
    exactObject(retention.ownerPolicy, ["ownerId", "recordedAt", "terms"]);
    bounded(retention.ownerPolicy.ownerId, "retention ownerId");
    if (!Number.isFinite(Date.parse(retention.ownerPolicy.recordedAt)) || typeof retention.ownerPolicy.terms !== "string" || !retention.ownerPolicy.terms.trim() || retention.ownerPolicy.terms.length > 1e4)
      fail("ARTIFACT_INPUT_INVALID", "Explicit owner retention terms and provenance are required.");
  } else if (retention.ownerPolicy !== null)
    fail("ARTIFACT_INPUT_INVALID", "Owner policy must be null unless explicitly selected.");
  if (!Array.isArray(retention.pins) || retention.pins.length > LIMIT)
    fail("ARTIFACT_INPUT_INVALID", "Retention pins exceed the inventory bound.");
  const pinned = /* @__PURE__ */ new Set();
  for (const pin of retention.pins) {
    exactObject(pin, ["sourceId", "workId", "reason", "recordedAt"]);
    bounded(pin.reason, "pin reason");
    if (pin.sourceId !== source.id || !source.workIds.includes(pin.workId) || !paths.has(`.banzai/work/${pin.workId}/work.json`) || !Number.isFinite(Date.parse(pin.recordedAt)) || pinned.has(pin.workId))
      fail("ARTIFACT_INPUT_INVALID", "Pin must identify unique archived work and its source provenance.");
    pinned.add(pin.workId);
  }
  const keys = retention.policy === "banzai" ? [
    "activeOrPinned",
    "supportedAuthority",
    "closedWork",
    "releaseAndMigration",
    "unreferencedLogs",
    "invalidCandidates",
    "dependencies"
  ] : [];
  exactObject(retention.rules, keys);
  const expected = [
    "no-expiry",
    "support-plus-24-months",
    "at-least-24-months",
    "project-lifetime",
    "30-days-after-closure",
    "90-days-after-closure",
    "override-expiry"
  ];
  if (keys.some((key, index) => retention.rules[key] !== expected[index]))
    fail(
      "ARTIFACT_INPUT_INVALID",
      "Archive retention rules differ from their declared policy."
    );
  return value;
}
async function verifyArchive(input) {
  const root = await directory(input.bundlePath);
  const manifestBytes = await readBytes(root, "manifest.json", {
    limit: 32 * 1024 * 1024
  });
  let manifest;
  try {
    manifest = parseArchive(JSON.parse(manifestBytes.toString("utf8")));
  } catch (error) {
    if (error.code) throw error;
    fail("ARTIFACT_INPUT_INVALID", "Archive manifest is not valid JSON.");
  }
  const uninterpreted = [];
  const recordedEdges = new Map(
    manifest.dependencies.map((edge) => [`${edge.from}\0${edge.to}`, edge])
  );
  const objects = /* @__PURE__ */ new Map();
  for (const entry of manifest.entries) {
    const bytes = await readBytes(root, entry.object);
    if (bytes.length !== entry.size || digestBytes(bytes) !== entry.sha256)
      fail(
        "ARTIFACT_EVIDENCE_INCOMPLETE",
        "Archive object size or SHA-256 verification failed."
      );
    objects.set(entry.path, bytes);
  }
  for (const entry of manifest.entries) {
    const bytes = objects.get(entry.path);
    const run = entry.path.match(/^(\.banzai\/runs\/[^/]+)\//u)?.[1];
    let sourceRoot = null;
    try {
      sourceRoot = JSON.parse(objects.get(`${run}/state.json`)?.toString("utf8") ?? "null")?.repoRoot ?? null;
    } catch {
    }
    const decoded = dependenciesFor(entry.path, bytes, sourceRoot);
    if (/^\.banzai\/work\/[^/]+\/work\.json$/u.test(entry.path)) {
      const binding = parseBinding(JSON.parse(bytes.toString("utf8")));
      if (!manifest.sources[0].workIds.includes(binding.workId)) fail("ARTIFACT_EVIDENCE_INCOMPLETE", "Archived work is absent from source provenance.");
      for (const [role, relative] of Object.entries(binding.artifacts)) {
        for (const item of manifest.entries) {
          if (item.path === relative || role === "reviewDirectory" && item.path.startsWith(`${relative}/`)) decoded.refs.set(item.path, true);
        }
      }
    }
    if (entry.path.endsWith(".json")) {
      let value;
      try {
        value = JSON.parse(bytes.toString("utf8"));
      } catch {
      }
      if (typeof value?.schema === "string" && /^banzai-verification-(?:decision|applicability|origin-start|origin-finish)\/v1$/u.test(value.schema)) {
        const workOwner = /^\.banzai\/work\/([^/]+)\/verification\//u.exec(entry.path)?.[1];
        const runOwner = /^(\.banzai\/runs\/[^/]+)\/verification\//u.exec(entry.path)?.[1];
        const stateBytes = runOwner ? objects.get(`${runOwner}/state.json`) : null;
        const ownerId = workOwner ?? (stateBytes ? JSON.parse(stateBytes).artifactBinding?.binding?.workId : null);
        if (!ownerId || ownerId !== value.workId)
          fail("ARTIFACT_EVIDENCE_INCOMPLETE", "Archived verification evidence conflicts with its bound owner.");
        if (value.sha256 && !entry.path.endsWith(`/${value.sha256}.json`))
          fail("ARTIFACT_EVIDENCE_INCOMPLETE", "Archived verification decision identity changed.");
      }
      if (value?.schema === "banzai-verification-origin-finish/v1") {
        const startPath = entry.path.replace(/\.finish\.json$/u, ".start.json");
        const startBytes = objects.get(startPath);
        const start = startBytes ? parseVerificationOriginStart(JSON.parse(startBytes)) : null;
        const physicalBytes = start ? objects.get(start.physicalPath) : null;
        if (!start || !physicalBytes || digestBytes(startBytes) !== value.startSha256 || evidenceDigest(parseVerificationAttemptRecord(JSON.parse(physicalBytes))) !== value.physicalSha256 || start.workId !== value.workId || start.attemptId !== value.attemptId)
          fail("ARTIFACT_EVIDENCE_INCOMPLETE", "Archived verification origin closure is missing or changed.");
        const physical = parseVerificationAttemptRecord(JSON.parse(physicalBytes));
        for (const log of [physical.stdout, physical.stderr]) {
          if (log === null) continue;
          const logPath = sourcePath(start.physicalPath, log.relativePath);
          const logBytes = objects.get(logPath);
          if (!logBytes || digestBytes(logBytes) !== log.sha256)
            fail("ARTIFACT_EVIDENCE_INCOMPLETE", "Archived verification origin log changed or is missing.");
        }
      }
      if (value?.schema === "banzai-verification-config-transaction/v1") {
        const transaction = parseVerificationConfigTransaction(value);
        const confirmationPath = entry.path.replace(/\.transaction\.json$/u, ".confirmation.json");
        const confirmationBytes = objects.get(confirmationPath);
        if (!confirmationBytes) fail("ARTIFACT_EVIDENCE_INCOMPLETE", "Configuration transaction confirmation is missing.");
        parseVerificationConfigConfirmation(JSON.parse(confirmationBytes), transaction);
        const stateBytes = objects.get(`${run}/state.json`);
        const state = stateBytes ? JSON.parse(stateBytes) : null;
        if (!state || state.schemaVersion !== 6 || state.runId !== transaction.runId || transaction.continuation && (transaction.continuation.workId !== state.artifactBinding.binding.workId || transaction.continuation.workBindingSha256 !== state.artifactBinding.sha256 || transaction.continuation.baseCommit !== state.baseCommit)) fail("ARTIFACT_EVIDENCE_INCOMPLETE", "Configuration transaction owner conflicts with its retained run.");
      }
      if (value?.schema === "banzai-review-snapshot/v4") {
        for (const change of value.configurationSetup.runnerChanges) {
          const transactionPath = `.banzai/runs/${value.runId}/configuration/${change.transaction.operationId}.transaction.json`;
          const transactionBytes = objects.get(transactionPath);
          const confirmationBytes = objects.get(transactionPath.replace(/\.transaction\.json$/u, ".confirmation.json"));
          if (!transactionBytes || !confirmationBytes) fail("ARTIFACT_EVIDENCE_INCOMPLETE", "Review configuration closure is missing.");
          const transaction = parseVerificationConfigTransaction(JSON.parse(transactionBytes));
          const confirmation = parseVerificationConfigConfirmation(JSON.parse(confirmationBytes), transaction);
          if (JSON.stringify(transaction) !== JSON.stringify(change.transaction) || JSON.stringify(confirmation.preview.delta) !== JSON.stringify(change.delta)) fail("ARTIFACT_EVIDENCE_INCOMPLETE", "Review configuration closure changed.");
        }
      }
      if (value?.artifactBinding?.binding?.workId) {
        const bindingPath = `.banzai/work/${value.artifactBinding.binding.workId}/work.json`;
        const archivedBinding = manifest.entries.find(
          (item) => item.path === bindingPath
        );
        if (archivedBinding && archivedBinding.sha256 !== value.artifactBinding.sha256)
          fail(
            "ARTIFACT_EVIDENCE_INCOMPLETE",
            "Archived run or snapshot binding bytes conflict with their recorded identity."
          );
      }
    }
    if (!decoded.supported) uninterpreted.push(entry.path);
    for (const [ref, required] of decoded.refs)
      if (!recordedEdges.has(`${entry.path}\0${ref}`) || required && recordedEdges.get(`${entry.path}\0${ref}`).required !== true)
        fail(
          "ARTIFACT_EVIDENCE_INCOMPLETE",
          "Archive manifest omits a recognized dependency."
        );
  }
  return {
    manifest,
    manifestSha256: digestBytes(manifestBytes),
    retainedPaths: retainedPaths(manifest, objects),
    complete: !uninterpreted.length && manifest.dependencies.every(
      (edge) => !edge.required || edge.status === "included"
    ),
    uninterpreted
  };
}
async function exportArtifacts(input) {
  const destination = await missingDestination(input.destination);
  try {
    await lstat2(destination);
    fail(
      "ARTIFACT_DESTINATION_CONFLICT",
      "Archive destination already exists; verify it explicitly."
    );
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const inventoryBytes = await readInvocationBytes(input.inventoryFile, "inventoryFile", { limit: 32 * 1024 * 1024 });
  let inventory;
  try {
    inventory = parseArchive(JSON.parse(inventoryBytes.toString("utf8")));
  } catch (error) {
    if (error.code) throw error;
    fail("ARTIFACT_INPUT_INVALID", "Reviewed inventory is not valid JSON.");
  }
  const result = { inventory, excluded: [] };
  const root = await projectRoot(input.repoRoot);
  if (inventory.sources[0].projectIdentity !== localProjectIdentity(root))
    fail("ARTIFACT_OWNERSHIP_CONFLICT", "Reviewed inventory belongs to another source checkout.");
  for (const entry of inventory.entries) {
    const bytes = await readBytes(root, entry.path);
    const mode = (await lstat2(path2.join(root, entry.path))).mode & 511;
    if (bytes.length !== entry.size || digestBytes(bytes) !== entry.sha256 || mode !== entry.mode)
      fail("ARTIFACT_OWNERSHIP_CONFLICT", "Source bytes or modes no longer match the reviewed inventory. Inspect and inventory again.");
  }
  const temporary = path2.join(
    path2.dirname(destination),
    `.banzai-archive-${result.inventory.bundleId}`
  );
  await mkdir(temporary, { mode: 448 });
  await makeDirectories(temporary, "objects");
  const written = /* @__PURE__ */ new Set();
  for (const entry of result.inventory.entries) {
    const bytes = await readBytes(root, entry.path);
    if (digestBytes(bytes) !== entry.sha256)
      fail(
        "ARTIFACT_OWNERSHIP_CONFLICT",
        "Source changed while archiving; incomplete staging evidence was retained."
      );
    if (!written.has(entry.sha256)) {
      await publishNew(temporary, entry.object, bytes);
      written.add(entry.sha256);
    }
  }
  await publishNew(
    temporary,
    "manifest.json",
    inventoryBytes
  );
  const verified = await verifyArchive({ bundlePath: temporary });
  const guard = `${destination}.banzai-archive.lock`;
  let handle;
  try {
    handle = await open2(guard, "wx", 384);
  } catch {
    fail(
      "ARTIFACT_OWNERSHIP_CONFLICT",
      "Archive destination is owned by another operation."
    );
  }
  const owned = await handle.stat();
  try {
    try {
      await lstat2(destination);
      fail(
        "ARTIFACT_DESTINATION_CONFLICT",
        "Archive destination appeared during verification."
      );
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await rename(temporary, destination);
  } finally {
    await handle.close();
    const current = await lstat2(guard);
    if (current.dev === owned.dev && current.ino === owned.ino)
      await unlink(guard);
  }
  return {
    archiveDirectory: destination,
    bundleId: result.inventory.bundleId,
    manifestSha256: verified.manifestSha256,
    complete: verified.complete,
    uninterpreted: verified.uninterpreted,
    excluded: result.excluded
  };
}
async function withRestoreOwnership(root, action) {
  await makeDirectories(root, ".banzai");
  const relative = ".banzai/runner.lock";
  await safePath(root, relative, { missing: true });
  const token = randomUUID();
  let handle;
  try {
    handle = await open2(path2.join(root, relative), "wx", 384);
  } catch {
    fail(
      "ARTIFACT_OWNERSHIP_CONFLICT",
      "Existing runner ownership prevents archive verification; no lock was reclaimed."
    );
  }
  const owned = await handle.stat();
  try {
    await handle.writeFile(
      JSON.stringify({
        schemaVersion: 1,
        pid: process.pid,
        token,
        createdAt: (/* @__PURE__ */ new Date()).toISOString()
      }) + "\n"
    );
    await handle.sync();
    return await action();
  } finally {
    await handle.close();
    const current = await lstat2(path2.join(root, relative));
    if (current.dev === owned.dev && current.ino === owned.ino)
      await unlink(path2.join(root, relative));
  }
}
async function restoreArtifacts(input) {
  const verified = await verifyArchive(input);
  if (!verified.complete)
    fail(
      "ARTIFACT_EVIDENCE_INCOMPLETE",
      "Restore requires complete dependency interpretation and closure."
    );
  const destination = await missingDestination(input.destination);
  const source = verified.manifest.sources[0];
  const receiptPath = ".banzai/archive-manifest.json";
  const receiptBytes = await readBytes(input.bundlePath, "manifest.json", { limit: 32 * 1024 * 1024 });
  if (/(?:^|\/)\.banzai\/(?:work|runs|control)(?:\/|$)/u.test(destination))
    fail("ARTIFACT_UNSAFE_PATH", "Restore requires a separate inactive inspection directory outside managed work, run and control ancestry.");
  const historicalOnly = source.projectIdentity !== localProjectIdentity(destination);
  let exists = false;
  try {
    await lstat2(destination);
    exists = true;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (exists)
    return withRestoreOwnership(destination, async () => {
      const active = await readJson(
        destination,
        ".banzai/active-run.json",
        true
      );
      if (active !== null)
        fail(
          "ARTIFACT_OWNERSHIP_CONFLICT",
          "Restore destination has runner authority; use an inactive fresh directory."
        );
      for (const entry of verified.manifest.entries) {
        const bytes = await readBytes(destination, entry.path, {
          optional: true
        });
        if (bytes === null || digestBytes(bytes) !== entry.sha256 || ((await lstat2(path2.join(destination, entry.path))).mode & 511) !== entry.mode)
          fail(
            "ARTIFACT_DESTINATION_CONFLICT",
            "Restore destination has missing or conflicting evidence. Use a fresh directory."
          );
      }
      const receipt = await readBytes(destination, receiptPath, { optional: true, limit: 32 * 1024 * 1024 });
      if (receipt === null || !receipt.equals(receiptBytes))
        fail("ARTIFACT_DESTINATION_CONFLICT", "Restore provenance or retention receipt is missing or conflicts.");
      return {
        destination,
        bundleId: verified.manifest.bundleId,
        historicalOnly,
        activeRunChanged: false,
        restored: false,
        retentionReceipt: receiptPath,
        retention: verified.manifest.retention,
        retainedPaths: verified.retainedPaths
      };
    });
  const temporary = path2.join(
    path2.dirname(destination),
    `.banzai-restore-${randomUUID()}`
  );
  await mkdir(temporary, { mode: 448 });
  for (const entry of verified.manifest.entries) {
    if (path2.posix.dirname(entry.path) !== ".")
      await makeDirectories(temporary, path2.posix.dirname(entry.path));
    await publishNew(
      temporary,
      entry.path,
      await readBytes(input.bundlePath, entry.object)
    );
    await chmod(path2.join(temporary, entry.path), entry.mode);
    if (digestBytes(await readBytes(temporary, entry.path)) !== entry.sha256)
      fail(
        "ARTIFACT_EVIDENCE_INCOMPLETE",
        "Restored bytes failed verification; staging evidence was retained."
      );
  }
  await makeDirectories(temporary, ".banzai");
  await publishNew(temporary, receiptPath, receiptBytes);
  const guard = `${destination}.banzai-restore.lock`;
  let handle;
  try {
    handle = await open2(guard, "wx", 384);
  } catch {
    fail(
      "ARTIFACT_OWNERSHIP_CONFLICT",
      "Restore destination is owned by another operation."
    );
  }
  try {
    try {
      await lstat2(destination);
      fail(
        "ARTIFACT_DESTINATION_CONFLICT",
        "Restore destination appeared during verification."
      );
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await rename(temporary, destination);
  } finally {
    await handle.close();
    await unlink(guard);
  }
  return {
    destination,
    bundleId: verified.manifest.bundleId,
    historicalOnly,
    activeRunChanged: false,
    restored: true,
    retentionReceipt: receiptPath,
    retention: verified.manifest.retention,
    retainedPaths: verified.retainedPaths
  };
}

// ../../plugins/banzai/lib/artifact-storage.mjs
import { constants as constants2 } from "node:fs";
import { AsyncLocalStorage } from "node:async_hooks";
import {
  lstat as lstat3,
  realpath as realpath2,
  open as open3,
  readdir as readdir2,
  mkdir as mkdir2,
  link,
  unlink as unlink2,
  rename as rename2
} from "node:fs/promises";
import path3 from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash as createHash3, randomUUID as randomUUID2 } from "node:crypto";
var execute = promisify(execFile);
var DECLARATION_SCHEMA = "banzai-artifact-layout/v1";
var BINDING_SCHEMA = "banzai-work-binding/v1";
var REQUEST_SCHEMA = "banzai-artifact-request/v1";
var RESULT_SCHEMA = "banzai-artifact-result/v1";
var METADATA_LIMIT = 64 * 1024;
var DISCOVERY_LIMIT = 1e3;
var DECLARATION_PATH = ".banzai/artifacts.json";
var WORK_ROOT = ".banzai/work";
var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
var SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
var SHA256 = /^[0-9a-f]{64}$/u;
var MODES = ["strict", "lite", "fix", "workflow"];
var LAYOUTS = ["private", "legacy"];
var CLAIM = ".writer-claim.json";
var INIT_LOCK = ".banzai/.artifact-init.lock";
var runnerOwnership = new AsyncLocalStorage();
var ArtifactStorageError = class extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ArtifactStorageError";
    this.code = code;
  }
};
function fail(code, message) {
  throw new ArtifactStorageError(code, message);
}
function digestBytes(value) {
  return createHash3("sha256").update(value).digest("hex");
}
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
function exactObject(value, required, optional = []) {
  if (value === null || typeof value !== "object" || Array.isArray(value) || required.some((key) => !Object.hasOwn(value, key)) || Object.keys(value).some(
    (key) => !required.includes(key) && !optional.includes(key)
  )) {
    fail(
      "ARTIFACT_INPUT_INVALID",
      "Artifact metadata has an invalid object shape."
    );
  }
  return value;
}
function relativePath(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 500 || /[\\\x00-\x1f\x7f]/u.test(value) || path3.posix.isAbsolute(value) || value.split("/").some(
    (segment) => segment === "" || segment === "." || segment === ".." || segment === ".git"
  )) {
    fail(
      "ARTIFACT_UNSAFE_PATH",
      "A bounded, contained project-relative artifact path is required."
    );
  }
  return value;
}
async function safePath(root, relative, { missing = false, directory: directory2 = false } = {}) {
  relativePath(relative);
  let current = root;
  const parts = relative.split("/");
  for (const [index, part] of parts.entries()) {
    current = path3.join(current, part);
    let stat2;
    try {
      stat2 = await lstat3(current);
    } catch (error) {
      if (error.code === "ENOENT" && missing) return path3.join(root, relative);
      if (error.code === "ENOENT")
        fail(
          "ARTIFACT_EVIDENCE_INCOMPLETE",
          "Required artifact evidence is missing."
        );
      fail(
        "ARTIFACT_IO_ERROR",
        "Artifact storage could not be inspected. Check local permissions."
      );
    }
    const needsDirectory = index < parts.length - 1 || directory2;
    if (stat2.isSymbolicLink() || (needsDirectory ? !stat2.isDirectory() : !stat2.isFile())) {
      fail(
        "ARTIFACT_UNSAFE_PATH",
        "Artifact storage requires owned directories and regular files without symlinks."
      );
    }
  }
  return current;
}
async function readBytes(root, relative, { optional = false, limit = Infinity } = {}) {
  const target = await safePath(root, relative, { missing: optional });
  let handle;
  try {
    handle = await open3(target, constants2.O_RDONLY | constants2.O_NOFOLLOW);
    const stat2 = await handle.stat();
    if (!stat2.isFile())
      fail("ARTIFACT_UNSAFE_PATH", "Artifact input must be a regular file.");
    if (stat2.size > limit)
      fail(
        "ARTIFACT_INPUT_INVALID",
        "Artifact metadata exceeds its size bound."
      );
    const bytes = await handle.readFile();
    if (bytes.length > limit)
      fail(
        "ARTIFACT_INPUT_INVALID",
        "Artifact metadata exceeds its size bound."
      );
    await safePath(root, relative);
    return bytes;
  } catch (error) {
    if (error instanceof ArtifactStorageError) throw error;
    if (error.code === "ENOENT" && optional) return null;
    fail(
      "ARTIFACT_IO_ERROR",
      "Artifact input could not be read. Check its path and local permissions."
    );
  } finally {
    await handle?.close();
  }
}
async function readJson(root, relative, optional = false) {
  const bytes = await readBytes(root, relative, {
    optional,
    limit: METADATA_LIMIT
  });
  if (bytes === null) return null;
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    fail("ARTIFACT_INPUT_INVALID", "Artifact metadata is not valid JSON.");
  }
}
async function readInvocationBytes(input, label, options = {}) {
  if (typeof input !== "string" || !path3.isAbsolute(input))
    fail("ARTIFACT_INPUT_INVALID", `${label} must name an absolute local regular file.`);
  try {
    const parent = await realpath2(path3.dirname(input));
    return await readBytes(parent, path3.basename(input), options);
  } catch (error) {
    fail(
      error instanceof ArtifactStorageError ? error.code : "ARTIFACT_IO_ERROR",
      `${label} (${input}): ${error instanceof ArtifactStorageError ? error.message : "Input parent could not be resolved. Check its path and local permissions."}`
    );
  }
}
async function makeDirectories(root, relative) {
  relativePath(relative);
  let current = "";
  for (const part of relative.split("/")) {
    current = current ? `${current}/${part}` : part;
    await safePath(root, current, { missing: true, directory: true });
    try {
      await mkdir2(path3.join(root, current), { mode: 448 });
    } catch (error) {
      if (error.code !== "EEXIST")
        fail(
          "ARTIFACT_IO_ERROR",
          "Private artifact directory could not be created."
        );
    }
    await safePath(root, current, { directory: true });
  }
}
async function publishNew(root, relative, bytes) {
  await safePath(root, relative, { missing: true });
  const parent = path3.posix.dirname(relative);
  const temporary = `${parent}/.artifact-tmp-${randomUUID2()}`;
  const handle = await open3(path3.join(root, temporary), "wx", 384);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
    await safePath(root, relative, { missing: true });
    await link(path3.join(root, temporary), path3.join(root, relative));
  } finally {
    await handle.close();
    await unlink2(path3.join(root, temporary)).catch(() => {
    });
  }
}
async function git(root, args) {
  return execute("git", ["-C", root, ...args], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024
  });
}
async function projectRoot(input) {
  if (typeof input !== "string" || !path3.isAbsolute(input) || /[\x00-\x1f]/u.test(input)) {
    fail(
      "ARTIFACT_INPUT_INVALID",
      "repoRoot must be an absolute local directory."
    );
  }
  let resolved;
  try {
    resolved = await realpath2(input);
  } catch {
    fail("ARTIFACT_UNSAFE_PATH", "The project directory is unavailable.");
  }
  if (!(await lstat3(resolved)).isDirectory())
    fail("ARTIFACT_UNSAFE_PATH", "The project root must be a directory.");
  try {
    const result = await git(resolved, ["rev-parse", "--show-toplevel"]);
    return await realpath2(result.stdout.trim());
  } catch (error) {
    if (!error.stderr?.startsWith("fatal: not a git repository (or any"))
      fail(
        "ARTIFACT_IO_ERROR",
        "Git project discovery failed. Inspect repository ownership or Git metadata."
      );
    let candidate = resolved;
    while (true) {
      if (await readBytes(candidate, "PROJECT_MANIFEST.md", {
        optional: true,
        limit: 256 * 1024
      }) !== null)
        return candidate;
      const parent = path3.dirname(candidate);
      if (candidate === parent) break;
      candidate = parent;
    }
    fail(
      "ARTIFACT_INPUT_INVALID",
      "No Git project or project manifest root was found."
    );
  }
}
function parseDeclaration(value) {
  exactObject(value, ["schema", "schemaVersion", "layout"]);
  if (value.schema !== DECLARATION_SCHEMA || value.schemaVersion !== 1)
    fail(
      "ARTIFACT_VERSION_UNSUPPORTED",
      "Unsupported artifact declaration version."
    );
  if (!LAYOUTS.includes(value.layout))
    fail(
      "ARTIFACT_INPUT_INVALID",
      "Artifact layout must be private or legacy."
    );
  return value;
}
function artifactRoles(workId, slug, mode, layout) {
  const directory2 = layout === "private" ? `${WORK_ROOT}/${workId}` : `documentation/features/${slug}`;
  const roles = { reviewDirectory: directory2 };
  if (mode === "strict" || mode === "workflow")
    Object.assign(roles, {
      description: `${directory2}/description.md`,
      plan: layout === "private" ? `${directory2}/plan.md` : `documentation/development-plans/${slug}/plan.md`,
      implementationReport: `${directory2}/implementation-report.md`,
      testReport: `${directory2}/test-report.md`
    });
  if (mode === "lite" || mode === "workflow")
    roles.work = `${directory2}/work.md`;
  if (mode === "fix" || mode === "workflow")
    roles.changeReport = layout === "private" ? `${directory2}/change-report.md` : `documentation/changes/${slug}.md`;
  return roles;
}
function parseBinding(value) {
  exactObject(value, [
    "schema",
    "schemaVersion",
    "workId",
    "slug",
    "mode",
    "layout",
    "createdAt",
    "sourceCommit",
    "artifacts"
  ]);
  if (!(value.schema === BINDING_SCHEMA && value.schemaVersion === 1 || value.schema === "banzai-work-binding/v2" && value.schemaVersion === 2 && value.layout === "private"))
    fail(
      "ARTIFACT_VERSION_UNSUPPORTED",
      "Unsupported artifact work binding version."
    );
  if (!UUID.test(value.workId) || typeof value.slug !== "string" || value.slug.length > 100 || !SLUG.test(value.slug) || !MODES.includes(value.mode) || !LAYOUTS.includes(value.layout) || typeof value.createdAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(
    value.createdAt
  ) || !Number.isFinite(Date.parse(value.createdAt)) || !(value.sourceCommit === null || typeof value.sourceCommit === "string" && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(value.sourceCommit))) {
    fail("ARTIFACT_INPUT_INVALID", "Artifact work identity is malformed.");
  }
  const expected = artifactRoles(
    value.workId,
    value.slug,
    value.mode,
    value.layout
  );
  if (value.schemaVersion === 2) expected.verificationDirectory = `${WORK_ROOT}/${value.workId}/verification`;
  exactObject(value.artifacts, Object.keys(expected));
  for (const key of Object.keys(expected)) {
    relativePath(value.artifacts[key]);
    if (value.artifacts[key] !== expected[key])
      fail(
        "ARTIFACT_UNSAFE_PATH",
        "Artifact role is outside its work binding."
      );
  }
  return value;
}
async function directories(root, relative, optional = true) {
  const target = await safePath(root, relative, {
    missing: optional,
    directory: true
  });
  try {
    const entries = await readdir2(target, { withFileTypes: true });
    if (entries.length > DISCOVERY_LIMIT)
      fail(
        "ARTIFACT_DISCOVERY_LIMIT",
        "Artifact discovery exceeded its bound. Select explicit work or recover the inventory."
      );
    return entries.sort((a, b) => a.name.localeCompare(b.name));
  } catch (error) {
    if (error.code === "ENOENT" && optional) return [];
    if (error instanceof ArtifactStorageError) throw error;
    fail("ARTIFACT_IO_ERROR", "Artifact directories could not be inspected.");
  }
}
async function readHeader(root, relative) {
  const target = await safePath(root, relative, { missing: true });
  let handle;
  try {
    handle = await open3(target, constants2.O_RDONLY | constants2.O_NOFOLLOW);
    const buffer = Buffer.alloc(METADATA_LIMIT);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead).toString("utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    fail(
      "ARTIFACT_IO_ERROR",
      "Legacy artifact evidence could not be inspected."
    );
  } finally {
    await handle?.close();
  }
}
async function legacyEvidence(root, declared = false) {
  const evidence = [];
  let count = 0;
  for (const folder of [
    "documentation/features",
    "documentation/development-plans"
  ]) {
    for (const entry of await directories(root, folder)) {
      if (++count > DISCOVERY_LIMIT)
        fail(
          "ARTIFACT_DISCOVERY_LIMIT",
          "Legacy artifact discovery exceeded its bound."
        );
      if (entry.isSymbolicLink())
        fail(
          "ARTIFACT_UNSAFE_PATH",
          "Legacy artifact discovery encountered a symlink."
        );
      if (!entry.isDirectory()) continue;
      const files = folder.endsWith("features") ? ["description.md", "work.md"] : ["plan.md"];
      for (const name of files) {
        const relative = `${folder}/${entry.name}/${name}`;
        const header = await readHeader(root, relative);
        if (header === null) continue;
        if (/^# Feature: /mu.test(header) && header.includes(`Slug: \`${entry.name}\``) || /^# Development Plan: /mu.test(header) && header.includes(`/features/${entry.name}/description.md`))
          evidence.push(relative);
      }
    }
  }
  for (const entry of await directories(root, "documentation/changes")) {
    if (++count > DISCOVERY_LIMIT) fail("ARTIFACT_DISCOVERY_LIMIT", "Legacy change discovery exceeded its bound.");
    if (!entry.isFile() || !/^[a-z0-9]+(?:-[a-z0-9]+)*\.md$/u.test(entry.name)) continue;
    const relative = `documentation/changes/${entry.name}`;
    if (/^# Change Report:/mu.test(await readHeader(root, relative) ?? "")) evidence.push(relative);
  }
  const manifest = await readHeader(root, "PROJECT_MANIFEST.md");
  const refs = manifest?.match(
    /documentation\/(?:features|changes|development-plans)\/[a-z0-9/.-]+\.md/gu
  ) ?? [];
  for (const relative of [...new Set(refs)]) {
    if (++count > DISCOVERY_LIMIT)
      fail(
        "ARTIFACT_DISCOVERY_LIMIT",
        "Legacy reference discovery exceeded its bound."
      );
    if (await readHeader(root, relative) !== null) evidence.push(relative);
  }
  for (const entry of await directories(root, ".banzai/runs")) {
    if (++count > DISCOVERY_LIMIT)
      fail("ARTIFACT_DISCOVERY_LIMIT", "Run discovery exceeded its bound.");
    if (!entry.isDirectory())
      fail(
        "ARTIFACT_RECOVERY_REQUIRED",
        "Runner evidence requires explicit inspection."
      );
    const state = await readJson(
      root,
      `.banzai/runs/${entry.name}/state.json`,
      true
    );
    if (state === null || ![1, 2, 3, 4, 5, 6].includes(state.schemaVersion) || state.runId !== entry.name)
      fail(
        "ARTIFACT_RECOVERY_REQUIRED",
        "Unrecognized runner evidence requires recovery."
      );
    if (state.schemaVersion >= 4 && !declared)
      fail(
        "ARTIFACT_RECOVERY_REQUIRED",
        "A bound run without its artifact declaration requires recovery."
      );
    if (state.schemaVersion < 4) evidence.push(`.banzai/runs/${entry.name}/state.json`);
  }
  return [...new Set(evidence)].sort();
}
async function legacyCandidates(root, evidence, boundWorks) {
  const groups = /* @__PURE__ */ new Map();
  for (const relative of evidence) {
    const match = /^documentation\/(features|development-plans|changes)\/([a-z0-9-]+)(?:\.md|\/)/u.exec(relative);
    if (!match || boundWorks.some((work) => work.binding.layout === "legacy" && work.binding.slug === match[2])) continue;
    const slug = match[2];
    const mode = match[1] === "changes" ? "fix" : relative.endsWith("/work.md") ? "lite" : "strict";
    groups.set(`${slug}:${mode}`, { slug, mode });
  }
  const candidates = [];
  for (const { slug, mode } of groups.values()) {
    const artifacts = artifactRoles("00000000-0000-4000-8000-000000000000", slug, mode, "legacy");
    const originals = [];
    for (const [role, relative] of Object.entries(artifacts)) {
      if (role === "reviewDirectory") {
        for (const entry of await directories(root, relative)) {
          if (!/^review-[1-9][0-9]*\.md$/u.test(entry.name)) continue;
          const bytes = await readBytes(root, `${relative}/${entry.name}`);
          originals.push({ path: `${relative}/${entry.name}`, sha256: digestBytes(bytes) });
        }
      } else {
        const bytes = await readBytes(root, relative, { optional: true });
        if (bytes !== null) originals.push({ path: relative, sha256: digestBytes(bytes) });
      }
    }
    let sourceCommit = null;
    try {
      sourceCommit = (await git(root, ["log", "-1", "--format=%H", "--", ...originals.map((item) => item.path)])).stdout.trim() || null;
    } catch {
    }
    const identity = digestBytes(canonicalJson({ slug, mode, originals, sourceCommit }));
    const creationId = `${identity.slice(0, 8)}-${identity.slice(8, 12)}-4${identity.slice(13, 16)}-8${identity.slice(17, 20)}-${identity.slice(20, 32)}`;
    candidates.push({ slug, mode, creationId, workPath: mode === "fix" ? artifacts.changeReport : artifacts.reviewDirectory, artifacts, originals, sourceCommit });
  }
  return candidates;
}
async function readBinding(root, workPath) {
  relativePath(workPath);
  const match = /^\.banzai\/work\/([^/]+)(?:\/work\.json)?$/u.exec(workPath);
  if (match === null || !UUID.test(match[1]))
    fail(
      "ARTIFACT_UNSAFE_PATH",
      "Select a work ID or its project-relative work.json path."
    );
  const relative = `${WORK_ROOT}/${match[1]}/work.json`;
  const bytes = await readBytes(root, relative, { limit: METADATA_LIMIT });
  let parsed;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch {
    fail("ARTIFACT_INPUT_INVALID", "Work binding is not valid JSON.");
  }
  const binding = parseBinding(parsed);
  if (binding.workId !== match[1])
    fail(
      "ARTIFACT_RECOVERY_REQUIRED",
      "Work directory and binding identities disagree."
    );
  return { binding, sha256: digestBytes(bytes) };
}
async function inspectArtifacts(input) {
  const root = await projectRoot(input.repoRoot);
  if (input.workId !== void 0 && input.workPath !== void 0)
    fail("ARTIFACT_INPUT_INVALID", "Select either workId or workPath.");
  if (input.workId !== void 0 && !UUID.test(input.workId))
    fail("ARTIFACT_INPUT_INVALID", "Invalid work ID.");
  const declarationValue = await readJson(root, DECLARATION_PATH, true);
  const declaration = declarationValue === null ? null : parseDeclaration(declarationValue);
  const selector = input.workPath ?? (input.workId === void 0 ? null : `${WORK_ROOT}/${input.workId}`);
  if (selector !== null && !selector.startsWith(`${WORK_ROOT}/`)) {
    relativePath(selector);
    const current = await inspectArtifacts({ repoRoot: root });
    const matches = current.legacyCandidates.filter((item) => item.workPath === selector || Object.values(item.artifacts).includes(selector));
    const bound = [];
    for (const candidate of current.candidates) {
      const selected = await readBinding(root, candidate.workPath);
      if (selected.binding.layout === "legacy" && Object.values(selected.binding.artifacts).includes(selector)) bound.push(candidate);
    }
    if (matches.length === 0 && bound.length === 1) return inspectArtifacts({ repoRoot: root, workId: bound[0].workId });
    if (matches.length !== 1 || bound.length)
      fail("ARTIFACT_WORK_AMBIGUOUS", "Select one recognized original legacy bundle or its registered work ID.");
    return { ...current, legacyCandidates: matches, legacySelection: matches[0] };
  }
  if (selector !== null) {
    const selected = await readBinding(root, selector);
    if (declaration === null)
      fail(
        "ARTIFACT_RECOVERY_REQUIRED",
        "Selected work has no declaration. Recover its verified layout before continuation."
      );
    return {
      projectRoot: root,
      classification: "declared",
      layout: selected.binding.layout,
      declaration,
      work: selected,
      candidates: [
        {
          workId: selected.binding.workId,
          slug: selected.binding.slug,
          mode: selected.binding.mode,
          workPath: `${WORK_ROOT}/${selected.binding.workId}/work.json`
        }
      ],
      legacyEvidence: [],
      legacyCandidates: [],
      legacySelection: null
    };
  }
  const entries = await directories(root, WORK_ROOT);
  const works = [];
  for (const entry of entries) {
    if (/^\.create-[0-9a-f-]{36}$/u.test(entry.name) && entry.isDirectory())
      continue;
    if (!entry.isDirectory() || !UUID.test(entry.name))
      fail(
        "ARTIFACT_RECOVERY_REQUIRED",
        "Private work inventory contains unrecognized evidence."
      );
    works.push(await readBinding(root, `${WORK_ROOT}/${entry.name}`));
  }
  if (declaration === null && entries.length > 0)
    fail(
      "ARTIFACT_RECOVERY_REQUIRED",
      "Private work exists without its declaration. Recover the declaration from verified bindings."
    );
  const legacy = await legacyEvidence(root, declaration !== null);
  const continuations = await legacyCandidates(root, legacy, works);
  return {
    projectRoot: root,
    classification: declaration !== null ? "declared" : legacy.length > 0 ? "legacy" : "fresh",
    layout: declaration?.layout ?? (legacy.length > 0 ? "legacy" : "private"),
    declaration,
    work: null,
    candidates: works.map((item) => ({
      workId: item.binding.workId,
      slug: item.binding.slug,
      mode: item.binding.mode,
      workPath: `${WORK_ROOT}/${item.binding.workId}/work.json`
    })),
    legacyEvidence: legacy,
    legacyCandidates: continuations,
    legacySelection: null
  };
}
async function ignored(root, relative) {
  try {
    await git(root, ["check-ignore", "--no-index", "--quiet", "--", relative]);
    return true;
  } catch (error) {
    if (error.code === 1) return false;
    fail(
      "ARTIFACT_IGNORE_CONFLICT",
      "Private evidence requires verifiable Git exclusions. Initialize Git explicitly first."
    );
  }
}
async function verifyIgnores(root, binding = null, destinations = []) {
  if (await ignored(root, DECLARATION_PATH))
    fail(
      "ARTIFACT_IGNORE_CONFLICT",
      "The artifact declaration is ignored. Narrow the rule hiding .banzai/artifacts.json explicitly."
    );
  const selected = binding === null ? [] : [
    `${WORK_ROOT}/${binding.workId}/work.json`,
    `${WORK_ROOT}/${binding.workId}/${CLAIM}`,
    ...binding.layout === "private" ? Object.entries(binding.artifacts).map(
      ([role, value]) => role === "reviewDirectory" ? `${value}/review-1.md` : value
    ) : []
  ];
  for (const relative of [
    `${WORK_ROOT}/00000000-0000-4000-8000-000000000000/probe.md`,
    ...selected,
    ...destinations
  ]) {
    relativePath(relative);
    if (!await ignored(root, relative))
      fail(
        "ARTIFACT_IGNORE_CONFLICT",
        "Selected private evidence is not effectively ignored. Repair its Git exclusions before writing."
      );
  }
}
async function withInitializationLock(root, action) {
  await makeDirectories(root, ".banzai");
  let handle;
  for (let attempt = 0; attempt < 100; attempt++) {
    await safePath(root, INIT_LOCK, { missing: true });
    try {
      handle = await open3(path3.join(root, INIT_LOCK), "wx", 384);
      break;
    } catch (error) {
      if (error.code !== "EEXIST")
        fail(
          "ARTIFACT_IO_ERROR",
          "Artifact initialization ownership could not be acquired."
        );
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  if (handle === void 0)
    fail(
      "ARTIFACT_OWNERSHIP_CONFLICT",
      "Artifact initialization is already owned. Retry or inspect an abandoned initialization lock."
    );
  const ownership = await handle.stat();
  try {
    return await action();
  } finally {
    await handle.close();
    const current = await lstat3(path3.join(root, INIT_LOCK));
    if (current.dev !== ownership.dev || current.ino !== ownership.ino)
      fail(
        "ARTIFACT_OWNERSHIP_CONFLICT",
        "Initialization lock ownership changed; evidence was retained."
      );
    await unlink2(path3.join(root, INIT_LOCK));
  }
}
async function initializeArtifacts(input) {
  const before = await inspectArtifacts({ repoRoot: input.repoRoot });
  if (input.layout !== void 0 && !LAYOUTS.includes(input.layout))
    fail(
      "ARTIFACT_INPUT_INVALID",
      "Artifact layout must be private or legacy."
    );
  if (input.layout !== void 0 && input.layout !== before.layout && (before.declaration !== null || before.classification === "legacy"))
    fail(
      "ARTIFACT_RECOVERY_REQUIRED",
      "Changing an existing layout requires an explicit storage migration."
    );
  const root = before.projectRoot;
  const adoption = await inspectProjectAdoption(root);
  if (adoption.classification !== "ready")
    fail(
      "ARTIFACT_SETUP_REQUIRED",
      "Complete normal project guidance setup or migration before initializing artifact storage."
    );
  await git(root, ["rev-parse", "--show-toplevel"]).catch(
    () => fail(
      "ARTIFACT_IGNORE_CONFLICT",
      "Initialize Git explicitly before creating private evidence."
    )
  );
  if (await ignored(root, DECLARATION_PATH))
    fail(
      "ARTIFACT_IGNORE_CONFLICT",
      "Narrow the existing ignore rule hiding the artifact declaration before setup."
    );
  return withInitializationLock(root, async () => {
    const current = await inspectArtifacts({ repoRoot: root });
    const original = await readBytes(root, ".gitignore", {
      optional: true,
      limit: METADATA_LIMIT
    });
    if (!await ignored(root, `${WORK_ROOT}/probe.md`)) {
      const suffix = "\n# Banzai private artifact storage\n/.banzai/work/\n/.banzai/.artifact-init.lock\n";
      const contents = Buffer.from((original?.toString("utf8") ?? "") + suffix);
      if (original === null) await publishNew(root, ".gitignore", contents);
      else {
        const handle = await open3(
          path3.join(root, ".gitignore"),
          constants2.O_WRONLY | constants2.O_APPEND | constants2.O_NOFOLLOW
        );
        try {
          const latest = await readBytes(root, ".gitignore", {
            limit: METADATA_LIMIT
          });
          if (!latest.equals(original))
            fail(
              "ARTIFACT_OWNERSHIP_CONFLICT",
              "Ignore rules changed during initialization; retry after inspection."
            );
          await handle.writeFile(suffix);
          await handle.sync();
        } finally {
          await handle.close();
        }
      }
    }
    await verifyIgnores(root);
    if (current.declaration === null) {
      const declaration = {
        schema: DECLARATION_SCHEMA,
        schemaVersion: 1,
        layout: input.layout ?? current.layout
      };
      await publishNew(
        root,
        DECLARATION_PATH,
        JSON.stringify(declaration, null, 2) + "\n"
      );
    }
    return inspectArtifacts({ repoRoot: root });
  });
}
async function createWork(input) {
  if (input.schemaVersion !== void 0 && ![1, 2].includes(input.schemaVersion))
    fail("ARTIFACT_VERSION_UNSUPPORTED", "Unsupported new work binding version.");
  if (!UUID.test(input.creationId) || typeof input.slug !== "string" || input.slug.length > 100 || !SLUG.test(input.slug) || !MODES.includes(input.mode))
    fail(
      "ARTIFACT_INPUT_INVALID",
      "Create requires a UUID creationId, bounded slug and supported mode."
    );
  const state = await initializeArtifacts({ repoRoot: input.repoRoot });
  const root = state.projectRoot;
  const directory2 = `${WORK_ROOT}/${input.creationId}`;
  return withInitializationLock(root, async () => {
    const state2 = await inspectArtifacts({ repoRoot: root });
    const existing = await readJson(root, `${directory2}/work.json`, true);
    if (existing !== null) {
      const bound = parseBinding(existing);
      if (bound.workId !== input.creationId || bound.slug !== input.slug || bound.mode !== input.mode || bound.schemaVersion !== (input.schemaVersion === 2 ? 2 : 1))
        fail(
          "ARTIFACT_OWNERSHIP_CONFLICT",
          "creationId already identifies different work."
        );
      await verifyIgnores(root, bound);
      return readBinding(root, directory2);
    }
    await verifyIgnores(root);
    const continuation = state2.legacyCandidates.find((item) => item.slug === input.slug && item.mode === input.mode && item.creationId === input.creationId);
    if (!continuation) {
      const legacyRoles = artifactRoles(input.creationId, input.slug, "workflow", "legacy");
      for (const [role, relative] of Object.entries(legacyRoles))
        if (role !== "reviewDirectory" && await readBytes(root, relative, { optional: true }) !== null)
          fail("ARTIFACT_WORK_AMBIGUOUS", "Original legacy evidence occupies this slug. Inspect its current continuation identity; stale selections cannot create replacement private work.");
    }
    const layout = continuation ? "legacy" : state2.layout;
    const roles = artifactRoles(
      input.creationId,
      input.slug,
      input.mode,
      layout
    );
    if (input.schemaVersion === 2) {
      if (layout !== "private") fail("ARTIFACT_INPUT_INVALID", "Verification-enabled work requires a new private binding.");
      roles.verificationDirectory = `${directory2}/verification`;
    }
    if (layout === "legacy") {
      for (const [role, relative] of Object.entries(roles)) {
        if (!continuation && role !== "reviewDirectory" && await readBytes(root, relative, { optional: true }) !== null)
          fail(
            "ARTIFACT_WORK_AMBIGUOUS",
            "Legacy artifacts already occupy this slug. Inspect their original workPath and register using its exact continuation creationId, slug and mode."
          );
      }
      if (state2.candidates.some((work) => work.slug === input.slug))
        fail(
          "ARTIFACT_WORK_AMBIGUOUS",
          "Legacy work with this slug is already bound. Select its work ID."
        );
    }
    const staging = `${WORK_ROOT}/.create-${input.creationId}`;
    await verifyIgnores(root, { workId: input.creationId, layout, artifacts: roles }, [`${staging}/work.json`]);
    await makeDirectories(root, staging);
    let sourceCommit = null;
    try {
      sourceCommit = (await git(root, ["rev-parse", "--verify", "HEAD"])).stdout.trim();
    } catch {
    }
    if (continuation) sourceCommit = continuation.sourceCommit;
    const staged = await readJson(root, `${staging}/work.json`, true);
    const binding = staged === null ? parseBinding({
      schema: input.schemaVersion === 2 ? "banzai-work-binding/v2" : BINDING_SCHEMA,
      schemaVersion: input.schemaVersion === 2 ? 2 : 1,
      workId: input.creationId,
      slug: input.slug,
      mode: input.mode,
      layout,
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      sourceCommit,
      artifacts: roles
    }) : parseBinding(staged);
    if (binding.workId !== input.creationId || binding.slug !== input.slug || binding.mode !== input.mode)
      fail(
        "ARTIFACT_RECOVERY_REQUIRED",
        "Interrupted work creation has conflicting identity evidence."
      );
    if (staged === null)
      await publishNew(
        root,
        `${staging}/work.json`,
        JSON.stringify(binding, null, 2) + "\n"
      );
    await safePath(root, directory2, { missing: true, directory: true });
    try {
      await lstat3(path3.join(root, directory2));
      fail(
        "ARTIFACT_RECOVERY_REQUIRED",
        "The work destination already exists without a valid binding."
      );
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await verifyIgnores(root, binding, [`${staging}/work.json`]);
    await rename2(path3.join(root, staging), path3.join(root, directory2));
    return readBinding(root, directory2);
  });
}
function ownsArtifact(binding, relative) {
  relativePath(relative);
  return Object.entries(binding.artifacts).some(
    ([role, value]) => role !== "reviewDirectory" && role !== "verificationDirectory" && value === relative
  ) || relative.startsWith(`${binding.artifacts.reviewDirectory}/`) && /^review-[1-9][0-9]*\.md$/u.test(
    relative.slice(binding.artifacts.reviewDirectory.length + 1)
  );
}
async function inspectBoundWork(root, bound) {
  exactObject(bound, ["binding", "sha256"]);
  const binding = parseBinding(bound.binding);
  if (!SHA256.test(bound.sha256))
    fail("ARTIFACT_INPUT_INVALID", "Invalid persisted work binding digest.");
  const current = await inspectArtifacts({
    repoRoot: root,
    workId: binding.workId
  });
  if (current.work.sha256 !== bound.sha256 || canonicalJson(current.work.binding) !== canonicalJson(binding))
    fail(
      "ARTIFACT_RECOVERY_REQUIRED",
      "The persisted work binding no longer matches its original bytes."
    );
  await verifyIgnores(current.projectRoot, binding);
  return current.work;
}
async function privateArtifactInventory(root, bound) {
  await inspectBoundWork(root, bound);
  const directory2 = `${WORK_ROOT}/${bound.binding.workId}`;
  const entries = [];
  const walk = async (relative) => {
    for (const item of await directories(root, relative, false)) {
      const filename = `${relative}/${item.name}`;
      if (filename === `${directory2}/work.json`) continue;
      if (filename === `${directory2}/${CLAIM}`) {
        if (await hasRunnerWorkOwnership(root, bound)) continue;
        fail(
          "ARTIFACT_OWNERSHIP_CONFLICT",
          "A standalone writer owns this work. Release its claim before runner continuation."
        );
      }
      if (item.isDirectory()) {
        await walk(filename);
        continue;
      }
      const bytes = await readBytes(root, filename);
      entries.push({
        path: filename,
        kind: "file",
        sha256: digestBytes(Buffer.concat([Buffer.from("file\0"), bytes]))
      });
      if (entries.length > DISCOVERY_LIMIT)
        fail(
          "ARTIFACT_DISCOVERY_LIMIT",
          "Selected work inventory exceeds its bound."
        );
    }
  };
  await walk(directory2);
  return entries.sort(
    (a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0
  );
}
async function selectedWork(input) {
  const state = await inspectArtifacts({
    repoRoot: input.repoRoot,
    workPath: input.workPath
  });
  if (state.work === null)
    fail(
      "ARTIFACT_WORK_AMBIGUOUS",
      "Select an explicit work identity before writing."
    );
  await verifyIgnores(state.projectRoot, state.work.binding);
  return {
    root: state.projectRoot,
    ...state.work,
    directory: `${WORK_ROOT}/${state.work.binding.workId}`
  };
}
async function acquireWork(input) {
  if (typeof input.ownerId !== "string" || input.ownerId.length === 0 || input.ownerId.length > 100 || /[\x00-\x1f]/u.test(input.ownerId))
    fail("ARTIFACT_INPUT_INVALID", "A bounded local ownerId is required.");
  const work = await selectedWork(input);
  const token = randomUUID2();
  try {
    await publishNew(
      work.root,
      `${work.directory}/${CLAIM}`,
      JSON.stringify({
        token,
        ownerId: input.ownerId,
        bindingDigest: work.sha256,
        createdAt: (/* @__PURE__ */ new Date()).toISOString()
      }) + "\n"
    );
  } catch (error) {
    if (error.code === "EEXIST")
      fail(
        "ARTIFACT_OWNERSHIP_CONFLICT",
        "This work already has a writer. Use another work item or resolve the existing owner."
      );
    throw error;
  }
  return { token, workId: work.binding.workId };
}
async function hasRunnerWorkOwnership(root, bound) {
  if (bound === void 0) return true;
  const owner = runnerOwnership.getStore();
  if (!owner || owner.root !== root || owner.workId !== bound.binding.workId || owner.bindingDigest !== bound.sha256) return false;
  const claim = await readJson(root, `${WORK_ROOT}/${owner.workId}/${CLAIM}`, true);
  if (claim?.token !== owner.token || claim?.bindingDigest !== bound.sha256)
    fail("ARTIFACT_OWNERSHIP_CONFLICT", "Runner work ownership changed; inspect the retained evidence.");
  return true;
}
async function withRunnerWorkOwnership(root, bound, action) {
  if (bound === void 0 || await hasRunnerWorkOwnership(root, bound)) return action();
  await inspectBoundWork(root, bound);
  const workPath = `${WORK_ROOT}/${bound.binding.workId}/work.json`;
  const claim = await acquireWork({ repoRoot: root, workPath, ownerId: "runner" });
  const owner = { root, workId: claim.workId, token: claim.token, bindingDigest: bound.sha256 };
  return runnerOwnership.run(owner, async () => {
    try {
      return await action();
    } finally {
      const relative = `${WORK_ROOT}/${owner.workId}/${CLAIM}`;
      const current = await readJson(root, relative, true);
      if (current?.token !== owner.token || current?.bindingDigest !== owner.bindingDigest)
        fail("ARTIFACT_OWNERSHIP_CONFLICT", "Runner claim changed; evidence was retained for owner recovery.");
      await safePath(root, relative);
      await unlink2(path3.join(root, relative));
    }
  });
}
async function requireClaim(input) {
  const work = await selectedWork(input);
  const claim = await readJson(work.root, `${work.directory}/${CLAIM}`, true);
  if (claim === null || claim.token !== input.token || claim.bindingDigest !== work.sha256 || !UUID.test(input.token))
    fail(
      "ARTIFACT_OWNERSHIP_CONFLICT",
      "The caller does not own the current work binding."
    );
  return work;
}
async function writeArtifact(input) {
  const root = await projectRoot(input.repoRoot);
  return withInitializationLock(root, () => writeClaimedArtifact(input));
}
async function writeClaimedArtifact(input) {
  const work = await requireClaim(input);
  if (!ownsArtifact(work.binding, input.artifactPath))
    fail(
      "ARTIFACT_UNSAFE_PATH",
      "Write is outside the selected work's artifact roles."
    );
  if (!(input.expectedSha256 === null || typeof input.expectedSha256 === "string" && SHA256.test(input.expectedSha256)))
    fail(
      "ARTIFACT_INPUT_INVALID",
      "expectedSha256 must be a SHA-256 identity or null for creation."
    );
  const bytes = await readInvocationBytes(input.inputFile, "inputFile");
  const existing = await readBytes(work.root, input.artifactPath, {
    optional: true
  });
  if ((existing === null ? null : digestBytes(existing)) !== input.expectedSha256)
    fail(
      "ARTIFACT_OWNERSHIP_CONFLICT",
      "Artifact bytes changed. Inspect the current evidence before writing."
    );
  await makeDirectories(work.root, path3.posix.dirname(input.artifactPath));
  if (work.binding.layout === "private") await verifyIgnores(work.root, work.binding, [input.artifactPath]);
  if (existing === null) {
    try {
      await publishNew(work.root, input.artifactPath, bytes);
    } catch (error) {
      if (error.code === "EEXIST")
        fail(
          "ARTIFACT_OWNERSHIP_CONFLICT",
          "Artifact was created by another writer."
        );
      throw error;
    }
  } else {
    const temporary = `${path3.posix.dirname(input.artifactPath)}/.artifact-tmp-${randomUUID2()}`;
    try {
      if (work.binding.layout === "private") await verifyIgnores(work.root, work.binding, [temporary, input.artifactPath]);
      await publishNew(work.root, temporary, bytes);
      await requireClaim(input);
      const latest = await readBytes(work.root, input.artifactPath);
      if (digestBytes(latest) !== input.expectedSha256)
        fail(
          "ARTIFACT_OWNERSHIP_CONFLICT",
          "Artifact bytes changed during writing."
        );
      if (work.binding.layout === "private") await verifyIgnores(work.root, work.binding, [input.artifactPath]);
      await safePath(work.root, input.artifactPath);
      await rename2(
        path3.join(work.root, temporary),
        path3.join(work.root, input.artifactPath)
      );
    } finally {
      await unlink2(path3.join(work.root, temporary)).catch(() => {
      });
    }
  }
  return { path: input.artifactPath, sha256: digestBytes(bytes) };
}
async function releaseWork(input) {
  const root = await projectRoot(input.repoRoot);
  return withInitializationLock(root, async () => {
    const work = await requireClaim(input);
    await unlink2(path3.join(work.root, work.directory, CLAIM));
    return { workId: work.binding.workId, released: true };
  });
}
var operationFields = {
  inventory: [[], ["workPaths", "runIds"]],
  export: [["inventoryFile", "destination"], []],
  verify: [["bundlePath"], []],
  restore: [["bundlePath", "destination"], []],
  inspect: [[], ["workId", "workPath"]],
  initialize: [[], ["layout"]],
  create: [["slug", "mode", "creationId"], []],
  acquire: [["workPath", "ownerId"], []],
  write: [
    ["workPath", "token", "artifactPath", "inputFile", "expectedSha256"],
    []
  ],
  release: [["workPath", "token"], []]
};
async function runArtifactOperation(operation, input) {
  const fields = operationFields[operation];
  if (fields === void 0)
    fail("ARTIFACT_INPUT_INVALID", "Unsupported artifact operation.");
  exactObject(
    input,
    ["schema", "schemaVersion", "repoRoot", ...fields[0]],
    fields[1]
  );
  if (!(input.schema === REQUEST_SCHEMA && input.schemaVersion === 1 || operation === "create" && input.schema === "banzai-artifact-request/v2" && input.schemaVersion === 2))
    fail(
      "ARTIFACT_VERSION_UNSUPPORTED",
      "Unsupported artifact request version."
    );
  const operations = {
    inventory: inventoryArtifacts,
    export: exportArtifacts,
    verify: verifyArchive,
    restore: restoreArtifacts,
    inspect: inspectArtifacts,
    initialize: initializeArtifacts,
    create: createWork,
    acquire: acquireWork,
    write: writeArtifact,
    release: releaseWork
  };
  return operations[operation](input);
}
async function artifactCommand(args) {
  const operation = args[0] ?? "";
  try {
    if (args.length !== 3 || args[1] !== "--json" || !Object.hasOwn(operationFields, operation))
      fail(
        "ARTIFACT_INPUT_INVALID",
        "Usage: artifacts <operation> --json <request-file>"
      );
    const filename = path3.resolve(args[2]);
    const bytes = await readInvocationBytes(filename, "requestFile", { limit: METADATA_LIMIT });
    let input;
    try {
      input = JSON.parse(bytes.toString("utf8"));
    } catch {
      fail("ARTIFACT_INPUT_INVALID", `requestFile (${filename}) must contain valid JSON.`);
    }
    const result = await runArtifactOperation(operation, input);
    return {
      schema: RESULT_SCHEMA,
      schemaVersion: 1,
      operation,
      ok: true,
      result,
      error: null
    };
  } catch (error) {
    return {
      schema: RESULT_SCHEMA,
      schemaVersion: 1,
      operation: Object.hasOwn(operationFields, operation) ? operation : "",
      ok: false,
      result: null,
      error: error instanceof ArtifactStorageError ? { code: error.code, message: error.message } : {
        code: "ARTIFACT_IO_ERROR",
        message: "The artifact operation failed. Inspect local storage and permissions; no fallback destination was selected."
      }
    };
  }
}

// ../../plugins/banzai/lib/verification-store.mjs
var invalid3 = (message) => {
  throw new VerificationEvidenceError(message);
};
var HASH2 = /^[a-f0-9]{64}$/u;
function closed(value, fields) {
  if (!value || typeof value !== "object" || Array.isArray(value) || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...fields].sort())) invalid3("Invalid persisted verification fields.");
}
function capture(value) {
  closed(value, ["complete", "reason", "candidateDigest", "checks"]);
  if (typeof value.complete !== "boolean" || !Array.isArray(value.checks) || value.checks.length > 1e4 || (value.complete ? !HASH2.test(value.candidateDigest) || value.reason !== null : value.candidateDigest !== null || value.checks.length !== 0 || !["inputs_unavailable", "policy_disabled"].includes(value.reason))) invalid3("Invalid persisted verification capture.");
  const seen = /* @__PURE__ */ new Set();
  for (const check of value.checks) {
    closed(check, ["checkId", "executable", "environmentDigest", "inputDigest"]);
    if (typeof check.checkId !== "string" || seen.has(check.checkId) || typeof check.executable !== "string" || !path4.isAbsolute(check.executable) || !HASH2.test(check.environmentDigest) || !HASH2.test(check.inputDigest)) invalid3("Invalid captured check.");
    seen.add(check.checkId);
  }
  return value;
}
function parseVerificationOriginStart(value) {
  closed(value, ["schema", "schemaVersion", "workId", "attemptId", "checkId", "decision", "before", "physicalPath"]);
  if (value.schema !== "banzai-verification-origin-start/v1" || value.schemaVersion !== 1 || !/^verification-[a-f0-9-]{36}$/u.test(value.attemptId)) invalid3("Invalid verification origin start.");
  if (typeof value.physicalPath !== "string" || !/^\.banzai\/(?:runs\/[a-z0-9][a-z0-9.-]{0,199}\/verification-attempts|work\/[a-f0-9-]{36}\/verification\/attempts)\/verification-\d{6}-verification-[a-f0-9-]{36}\.json$/u.test(value.physicalPath)) invalid3("Invalid physical origin path.");
  const decision = parseVerificationDecision(value.decision);
  if (decision.workId !== value.workId || !decision.actions.some((action) => action.checkId === value.checkId && action.action === "execute")) invalid3("Origin must reference an executed decision.");
  capture(value.before);
  if (value.before.candidateDigest !== decision.candidateDigest) invalid3("Origin capture differs from its decision.");
  return value;
}
function parseVerificationOriginFinish(value) {
  closed(value, ["schema", "schemaVersion", "workId", "attemptId", "startSha256", "physicalSha256", "after"]);
  if (value.schema !== "banzai-verification-origin-finish/v1" || value.schemaVersion !== 1 || !/^verification-[a-f0-9-]{36}$/u.test(value.attemptId) || !HASH2.test(value.startSha256) || !HASH2.test(value.physicalSha256)) invalid3("Invalid verification origin finish.");
  capture(value.after);
  return value;
}
function parseVerificationApplicability(value) {
  closed(value, ["schema", "schemaVersion", "workId", "roundId", "decisionSha256", "candidateDigest", "complete", "dispositions", "sha256"]);
  if (value.schema !== "banzai-verification-applicability/v1" || value.schemaVersion !== 1 || !HASH2.test(value.decisionSha256) || !Array.isArray(value.dispositions) || value.dispositions.length > 1e4 || value.candidateDigest !== null && !HASH2.test(value.candidateDigest)) invalid3("Invalid verification applicability.");
  const seen = /* @__PURE__ */ new Set();
  for (const item of value.dispositions) {
    closed(item, ["checkId", "kind", "origin"]);
    if (typeof item.checkId !== "string" || seen.has(item.checkId) || !["executed", "reused", "pending"].includes(item.kind)) invalid3("Invalid verification applicability disposition.");
    seen.add(item.checkId);
    if (item.kind === "pending") {
      if (item.origin !== null) invalid3("Pending checks cannot claim origin evidence.");
    } else {
      closed(item.origin, ["attemptId", "recordDigest", "roundId"]);
      if (!/^verification-[a-f0-9-]{36}$/u.test(item.origin.attemptId) || !HASH2.test(item.origin.recordDigest) || typeof item.origin.roundId !== "string") invalid3("Invalid applicability origin.");
    }
  }
  if (value.complete !== (value.dispositions.length > 0 && value.dispositions.every((item) => item.kind !== "pending"))) invalid3("Invalid applicability completion.");
  const { sha256, ...body } = value;
  if (sha256 !== evidenceDigest(body)) invalid3("Verification applicability digest mismatch.");
  return value;
}
function parseReviewVerificationEvidence(value) {
  closed(value, ["decision", "applicability", "origins", "attempts"]);
  const decision = parseVerificationDecision(value.decision);
  const applicability = parseVerificationApplicability(value.applicability);
  if (applicability.decisionSha256 !== decision.sha256 || applicability.workId !== decision.workId || applicability.roundId !== decision.roundId || !Array.isArray(value.origins) || !Array.isArray(value.attempts) || value.origins.length > 1e4 || value.attempts.length !== value.origins.length) invalid3("Invalid frozen verification closure.");
  const ids = /* @__PURE__ */ new Set();
  for (const [index, origin] of value.origins.entries()) {
    closed(origin, ["workId", "checkId", "attemptId", "roundId", "recordDigest", "status", "exitCode", "signal", "failureCategory", "complete", "logsIntact", "identity", "before", "after"]);
    const attempt = parseVerificationAttemptRecord(value.attempts[index]);
    capture(origin.before);
    capture(origin.after);
    if (ids.has(origin.attemptId) || origin.workId !== decision.workId || origin.attemptId !== attempt.id || origin.roundId !== attempt.round.id || origin.recordDigest !== evidenceDigest(attempt) || origin.status !== attempt.status || origin.exitCode !== attempt.exitCode || origin.signal !== attempt.signal || origin.failureCategory !== attempt.failureCategory || typeof origin.complete !== "boolean" || typeof origin.logsIntact !== "boolean" || origin.complete && (origin.before.complete || origin.after.complete) && !sameVerificationCapture(origin.before, origin.after)) invalid3("Frozen physical verification origin mismatch.");
    ids.add(origin.attemptId);
  }
  for (const [index, disposition] of applicability.dispositions.entries()) {
    const action = decision.actions[index];
    if (!action || disposition.checkId !== action.checkId) invalid3("Frozen check order mismatch.");
    if (disposition.kind === "pending") continue;
    const origin = value.origins.find((item) => item.attemptId === disposition.origin.attemptId);
    if (!origin || origin.recordDigest !== disposition.origin.recordDigest || origin.checkId !== disposition.checkId || origin.status !== "completed" || origin.exitCode !== 0 || origin.signal !== null || origin.failureCategory !== null || !origin.logsIntact || JSON.stringify(origin.identity) !== JSON.stringify(action.identity) || disposition.kind === "reused" && (action.action !== "reuse" || !origin.complete || JSON.stringify(disposition.origin) !== JSON.stringify(action.origin)) || disposition.kind === "executed" && (action.action !== "execute" || origin.roundId !== decision.roundId)) invalid3("Frozen applicability lacks its direct successful origin.");
  }
  if (applicability.dispositions.length !== decision.actions.length) invalid3("Incomplete frozen check inventory.");
  return value;
}

// src/validation.ts
import { createHash as createHash4 } from "node:crypto";

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
  const identifier2 = consultationString(value, label, 128);
  if (identifier2 === "." || identifier2 === ".." || !CONSULTATION_ID_PATTERN.test(identifier2)) {
    return consultationError(`${label} must be a canonical identifier.`);
  }
  return identifier2;
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
function reviewScopePath2(value) {
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
    const path6 = reviewScopePath2(entry.path);
    const status = requireEnum(entry.status, "scope status", [
      "reviewed",
      "not_reviewed"
    ]);
    if (status === "reviewed" ? entry.reason !== null : typeof entry.reason !== "string" || entry.reason.trim().length === 0)
      throw new BanzaiError(
        "INVALID_REVIEW_SCOPE",
        "Reviewed scope requires a null reason; unreviewed scope requires a nonblank reason."
      );
    return { path: path6, status, reason: entry.reason };
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
  const identifier2 = evidenceString(value, code, label, maximum);
  if (identifier2 === "." || identifier2 === ".." || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(identifier2)) {
    return recoveryEvidenceError(
      code,
      `${label} must be a canonical safe identifier.`
    );
  }
  return identifier2;
}
function evidenceDigest2(value, code, label) {
  const digest2 = evidenceString(value, code, label, 64);
  if (!/^[a-f0-9]{64}$/u.test(digest2)) {
    return recoveryEvidenceError(code, `${label} must be a SHA-256 digest.`);
  }
  return digest2;
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
function digestCanonicalJson2(value) {
  return createHash4("sha256").update(stableJson(value)).digest("hex");
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
  return digestCanonicalJson2(checkpoint);
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
  for (const [label, digest2] of [
    ["approvalDigest", checkpointWithoutIntegrity.approvalDigest],
    ["workflowDigest", checkpointWithoutIntegrity.workflowDigest],
    ["scopeDigest", checkpointWithoutIntegrity.scopeDigest]
  ]) {
    if (digest2 !== null && !/^[a-f0-9]{64}$/u.test(digest2)) {
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
function invalid4() {
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
    return invalid4();
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
      exitCode: invalid4(),
      signalPresent: invalid4(),
      startedAt: invalid4(),
      completedAt: invalid4()
    };
  }
  let signalPresent;
  if (value.signal === null) {
    signalPresent = observed(false);
  } else if (typeof value.signal === "string") {
    signalPresent = observed(true);
  } else {
    issue(issues, "STATE_FIELD_INVALID", `verification[${index}].signal`);
    signalPresent = invalid4();
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
  if (value.schemaVersion !== 1 && value.schemaVersion !== 2 && value.schemaVersion !== 3 && value.schemaVersion !== 4 && value.schemaVersion !== 5 && value.schemaVersion !== 6) {
    throw new BanzaiError(
      "EVALUATION_STATE_SCHEMA_UNSUPPORTED",
      "Persisted state uses an unsupported schema."
    );
  }
  if (value.schemaVersion === 6) validateConfigurationStateEnvelope(value);
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
    workflow = invalid4();
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
    verificationList = invalid4();
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
    activeAttemptIdentity = invalid4();
    activeAttemptKind = invalid4();
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
      activeVerification = invalid4();
    } else {
      activeVerification = observed(kind === "verification");
    }
  } else if (!Object.hasOwn(value, "activeProcess")) {
    issue(issues, "STATE_FIELD_MISSING", "activeProcess");
    activeVerification = absent();
  } else {
    issue(issues, "STATE_FIELD_INVALID", "activeProcess");
    activeVerification = invalid4();
  }
  let appliedReviewIteration;
  if (value.latestReview === null) {
    appliedReviewIteration = observed(0);
  } else if (isRecord(value.latestReview)) {
    const iteration = nonNegativeInteger(value.latestReview.iteration);
    const resultPath = stringValue(value.latestReview.resultPath);
    if (iteration === void 0 || iteration < 1 || resultPath !== `reviews/review-${iteration}.json`) {
      issue(issues, "STATE_FIELD_INVALID", "latestReview");
      appliedReviewIteration = invalid4();
    } else {
      appliedReviewIteration = observed(iteration);
    }
  } else if (!Object.hasOwn(value, "latestReview")) {
    issue(issues, "STATE_FIELD_MISSING", "latestReview");
    appliedReviewIteration = absent();
  } else {
    issue(issues, "STATE_FIELD_INVALID", "latestReview");
    appliedReviewIteration = invalid4();
  }
  return {
    value: {
      schemaVersion,
      ...schemaVersion === 6 ? { verificationMode: value.verificationMode } : {},
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

// src/artifact-storage.ts
var {
  inspectProjectAdoption: inspectProjectAdoption2,
  readAdoptionFile: readAdoptionFile2,
  ADOPTION_LABELS: ADOPTION_LABELS2,
  SCAFFOLD_MARKER: SCAFFOLD_MARKER2,
  GUIDANCE_MAX_BYTES: GUIDANCE_MAX_BYTES2,
  adoptionDiagnostic: adoptionDiagnostic2,
  readSharedReviewSnapshot,
  sealSharedReviewSnapshot,
  artifactCommand: artifactCommand2,
  artifactRoles: artifactRoles2,
  inspectArtifacts: inspectArtifacts2,
  initializeArtifacts: initializeArtifacts2,
  createWork: createWork2,
  readBinding: readBinding2,
  parseBinding: parseBinding2,
  inspectBoundWork: inspectBoundWork2,
  privateArtifactInventory: privateArtifactInventory2,
  ownsArtifact: ownsArtifact2,
  verifyIgnores: verifyIgnores2,
  safePath: safePath2,
  readBytes: readBytes2,
  digestBytes: digestBytes2,
  canonicalJson: canonicalJson2,
  hasRunnerWorkOwnership: hasRunnerWorkOwnership2,
  withRunnerWorkOwnership: withRunnerWorkOwnership2,
  acquireWork: acquireWork2,
  writeArtifact: writeArtifact2,
  releaseWork: releaseWork2,
  ArtifactStorageError: ArtifactStorageError2
} = artifact_storage_exports;

// src/config.ts
import path5 from "node:path";
var CONFIG_DIRECTORY = ".banzai";
var CONFIG_FILE = path5.join(CONFIG_DIRECTORY, "config.json");
var DEFAULT_CONFIG = {
  schemaVersion: 2,
  contractVersion: CONTRACT_VERSION,
  models: {
    planner: {
      executable: "codex",
      model: "gpt-5.6-sol",
      effort: "xhigh",
      timeoutMs: 30 * 60 * 1e3
    },
    implementer: {
      executable: "codex",
      model: "gpt-5.6-sol",
      effort: "xhigh",
      timeoutMs: 60 * 60 * 1e3
    },
    reviewer: {
      executable: "claude",
      model: "claude-opus-5",
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
  parseConfigurationPrerequisite,
  parseCurrentReviewResult,
  parseEvaluationStateSource,
  parseModelAttemptRecord,
  parsePersistedPhaseResult,
  parseRecoveryAuthorization,
  parseReviewResult,
  parseTerminalAttemptCheckpoint,
  parseVerificationAttemptRecord,
  parseVerificationConfigConfirmation,
  parseVerificationConfigTransaction,
  validateConfigurationStateEnvelope
};
