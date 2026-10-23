import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, lstat, readFile, readdir, realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { promisify } from "node:util";
import {
  instructionConsumerText,
  validateGuidanceExtraction
} from "./phase-resources-build.mjs";

const execFileAsync = promisify(execFile);
const scriptPackageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const defaultRepositoryRoot = path.resolve(scriptPackageRoot, "../..");
const expectedVersionMirrors = [
  {
    path: "plugins/banzai/.claude-plugin/plugin.json",
    pointer: "/version"
  },
  {
    path: "plugins/banzai/.codex-plugin/plugin.json",
    pointer: "/version"
  },
  { path: "marketplace.json", pointer: "/plugins/0/version" },
  {
    path: ".agents/plugins/marketplace.json",
    pointer: "/plugins/0/version"
  }
];
const expectedProjectPolicy = {
  versionAuthority: { path: "package.json", pointer: "/version" },
  lockfileMirrors: [
    { path: "package-lock.json", pointer: "/version" },
    { path: "package-lock.json", pointer: "/packages//version" }
  ]
};
const expectedOrchestratorPolicy = {
  packageVersionMirror: "packages/orchestrator/package.json",
  lockfileMirror: "package-lock.json",
  lockfileVersionPointer: "/packages/packages~1orchestrator/version"
};
const expectedRecoveryDirectory = ".banzai-version-set";
const expectedRecoveryGuard = `${expectedRecoveryDirectory}.guard`;
const expectedRecoveryGuardTemporary = `${expectedRecoveryGuard}.tmp`;

class ReleaseValidationError extends Error {
  constructor(code, relativePath, detail) {
    super(`${code} ${relativePath}: ${detail}`);
    this.name = "ReleaseValidationError";
  }
}

function fail(code, relativePath, detail) {
  throw new ReleaseValidationError(code, relativePath, detail);
}

function parseArguments(args) {
  if (args.length === 0) {
    return defaultRepositoryRoot;
  }
  if (args.length === 2 && args[0] === "--root") {
    return path.resolve(args[1]);
  }
  fail(
    "INVALID_RELEASE_VALIDATION_OPTION",
    "check-release.mjs",
    "expected no options or --root <fixture>"
  );
}

function repositoryPath(root, relativePath) {
  if (
    typeof relativePath !== "string" ||
    relativePath.length === 0 ||
    path.isAbsolute(relativePath)
  ) {
    fail("INVALID_RELEASE_POLICY", "release-policy.json", "unsafe path");
  }
  const resolved = path.resolve(root, relativePath);
  if (!resolved.startsWith(`${root}${path.sep}`)) {
    fail("INVALID_RELEASE_POLICY", "release-policy.json", "path escapes root");
  }
  return resolved;
}

async function readText(root, relativePath, code = "MISSING_RELEASE_FILE") {
  try {
    return await readFile(repositoryPath(root, relativePath), "utf8");
  } catch {
    fail(code, relativePath, "required file is missing or unreadable");
  }
}

async function readJson(root, relativePath) {
  const raw = await readText(root, relativePath, "MALFORMED_RELEASE_JSON");
  try {
    return JSON.parse(raw);
  } catch {
    fail("MALFORMED_RELEASE_JSON", relativePath, "document is not valid JSON");
  }
}

async function validateDistributionParity(root) {
  const packageRoot = await realpath(
    repositoryPath(root, "packages/orchestrator")
  );
  const parityScript = path.join(
    scriptPackageRoot,
    "scripts",
    "check-dist.mjs"
  );
  try {
    await execFileAsync(
      process.execPath,
      [parityScript, "--package-root", packageRoot, "--parity-only"],
      {
        cwd: packageRoot,
        encoding: "utf8",
        maxBuffer: 1024 * 1024,
        timeout: 120_000
      }
    );
  } catch {
    fail(
      "STALE_DISTRIBUTION",
      "packages/orchestrator/dist",
      "built bundle or source map differs from a fresh source build"
    );
  }
}

function record(value, relativePath, label) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail("INVALID_RELEASE_FIELD", relativePath, `${label} must be an object`);
  }
  return value;
}

function nonEmptyString(value, relativePath, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    fail(
      "INVALID_RELEASE_FIELD",
      relativePath,
      `${label} must be a non-empty string`
    );
  }
  return value;
}

function array(value, relativePath, label) {
  if (!Array.isArray(value) || value.length === 0) {
    fail("INVALID_RELEASE_FIELD", relativePath, `${label} must be non-empty`);
  }
  return value;
}

function pointerValue(source, pointer, relativePath) {
  if (typeof pointer !== "string" || !pointer.startsWith("/")) {
    fail(
      "INVALID_RELEASE_POLICY",
      "release-policy.json",
      "invalid JSON pointer"
    );
  }
  let current = source;
  for (const encoded of pointer.slice(1).split("/")) {
    const key = encoded.replaceAll("~1", "/").replaceAll("~0", "~");
    if (
      typeof current !== "object" ||
      current === null ||
      !Object.hasOwn(current, key)
    ) {
      fail(
        "MISSING_RELEASE_FIELD",
        relativePath,
        `missing field at ${pointer}`
      );
    }
    current = current[key];
  }
  return current;
}

function requireExact(value, expected, code, relativePath, label) {
  if (value !== expected) {
    fail(code, relativePath, `${label} does not match release policy`);
  }
}

function requireJsonExact(value, expected, code, relativePath, label) {
  if (JSON.stringify(value) !== JSON.stringify(expected)) {
    fail(code, relativePath, `${label} does not match release policy`);
  }
}

function requireObjectKeys(value, expected, code, relativePath, label) {
  const actual = Object.keys(record(value, relativePath, label)).sort();
  const accepted = [...expected].sort();
  if (
    actual.length !== accepted.length ||
    actual.some((key, index) => key !== accepted[index])
  ) {
    fail(code, relativePath, `${label} has an unsupported shape`);
  }
}

function flatText(value) {
  return value.replace(/\s+/g, " ");
}

function semanticVersion(value, relativePath, label) {
  const version = nonEmptyString(value, relativePath, label);
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
    fail(
      "INVALID_RELEASE_FIELD",
      relativePath,
      `${label} is not semantic version`
    );
  }
  return version;
}

function validatePolicyShape(policy) {
  const policyPath = "release-policy.json";
  const root = record(policy, policyPath, "policy");
  requireExact(
    root.schemaVersion,
    1,
    "INVALID_RELEASE_POLICY",
    policyPath,
    "schemaVersion"
  );
  const node = record(root.node, policyPath, "node");
  requireExact(
    node.engines,
    ">=22.20.0 <23 || >=24.11.1 <25",
    "NODE_POLICY_DRIFT",
    policyPath,
    "engines"
  );
  requireExact(
    node.buildTarget,
    "node22",
    "NODE_POLICY_DRIFT",
    policyPath,
    "build target"
  );
  const supported = array(node.supported, policyPath, "node.supported");
  if (supported.length !== 2) {
    fail(
      "NODE_POLICY_DRIFT",
      policyPath,
      "exactly two supported lanes are required"
    );
  }
  const expectedSupported = [
    [22, "22.20.0", "node:22.20.0-bookworm", "release_check_node_22"],
    [24, "24.11.1", "node:24.11.1-bookworm", "release_check_node_24"]
  ];
  for (const [index, expected] of expectedSupported.entries()) {
    const lane = record(
      supported[index],
      policyPath,
      `supported lane ${index}`
    );
    const actual = [lane.major, lane.version, lane.image, lane.job];
    if (
      JSON.stringify(actual) !== JSON.stringify(expected) ||
      lane.required !== true
    ) {
      fail(
        "NODE_POLICY_DRIFT",
        policyPath,
        `supported lane ${index} is not accepted`
      );
    }
  }
  const forward = record(node.forward, policyPath, "node.forward");
  const expectedForward = [
    26,
    "26.7.0",
    "node:26.7.0-bookworm",
    "forward_compatibility_node_26"
  ];
  if (
    JSON.stringify([
      forward.major,
      forward.version,
      forward.image,
      forward.job
    ]) !== JSON.stringify(expectedForward) ||
    forward.required !== false
  ) {
    fail("NODE_POLICY_DRIFT", policyPath, "forward lane is not accepted");
  }
  for (const lane of [...supported, forward]) {
    if (!/^node:\d+\.\d+\.\d+-bookworm$/.test(lane.image)) {
      fail(
        "NODE_POLICY_DRIFT",
        policyPath,
        "Node image must use an exact Git-capable Bookworm patch pin"
      );
    }
  }
  requireJsonExact(
    root.project,
    expectedProjectPolicy,
    "INVALID_RELEASE_POLICY",
    policyPath,
    "root version authority and lockfile mirrors"
  );
  const plugin = record(root.plugin, policyPath, "plugin");
  requireObjectKeys(
    plugin,
    ["versionMirrors", "jsonDocuments", "requiredPaths"],
    "INVALID_RELEASE_POLICY",
    policyPath,
    "plugin mirrors"
  );
  requireJsonExact(
    plugin.versionMirrors,
    expectedVersionMirrors,
    "INVALID_RELEASE_POLICY",
    policyPath,
    "ordered plugin version mirrors"
  );
  const orchestrator = record(root.orchestrator, policyPath, "orchestrator");
  requireObjectKeys(
    orchestrator,
    Object.keys(expectedOrchestratorPolicy),
    "INVALID_RELEASE_POLICY",
    policyPath,
    "orchestrator version mirrors"
  );
  requireJsonExact(
    orchestrator,
    expectedOrchestratorPolicy,
    "INVALID_RELEASE_POLICY",
    policyPath,
    "orchestrator version mirrors"
  );
  const transaction = record(
    root.versionTransaction,
    policyPath,
    "versionTransaction"
  );
  requireObjectKeys(
    transaction,
    ["recoveryDirectory"],
    "INVALID_RELEASE_POLICY",
    policyPath,
    "version transaction"
  );
  requireExact(
    transaction.recoveryDirectory,
    expectedRecoveryDirectory,
    "INVALID_RELEASE_POLICY",
    policyPath,
    "version transaction recovery directory"
  );
  const contracts = record(root.contracts, policyPath, "contracts");
  const phaseResult = record(
    contracts.phaseResult,
    policyPath,
    "contracts.phaseResult"
  );
  requireExact(
    phaseResult.currentPath,
    "plugins/banzai/contracts/v4/phase-result.schema.json",
    "CONTRACT_POLICY_DRIFT",
    policyPath,
    "current phase-result path"
  );
  requireExact(
    phaseResult.currentSchemaVersion,
    4,
    "CONTRACT_POLICY_DRIFT",
    policyPath,
    "current phase-result schema version"
  );
  const legacyPhaseResults = array(
    phaseResult.legacy,
    policyPath,
    "contracts.phaseResult.legacy"
  );
  requireJsonExact(
    legacyPhaseResults.map((entry) => {
      const legacy = record(entry, policyPath, "legacy phase-result");
      return [legacy.path, legacy.schemaVersion, legacy.sha256];
    }),
    [
      [
        "plugins/banzai/contracts/v1/phase-result.schema.json",
        1,
        "62b390d3ac0e4bb5f552fa902be0e23644b3928a482fc258f5892404bb205f77"
      ],
      [
        "plugins/banzai/contracts/v2/phase-result.schema.json",
        2,
        "7ede6c88fca7d95b6a7693017f45e9c01339461aa5991e03efabe9598f3ea7fd"
      ],
      [
        "plugins/banzai/contracts/v3/phase-result.schema.json",
        3,
        "4e57274234ee3482c0f700359df78c6c038282450c8a759d47a790ef4f2ff728"
      ]
    ],
    "CONTRACT_POLICY_DRIFT",
    policyPath,
    "legacy phase-result identities"
  );
  requireJsonExact(
    contracts.reviewResult,
    {
      currentPath: "plugins/banzai/contracts/v2/review-result.schema.json",
      currentSchemaVersion: 2,
      legacy: [
        {
          path: "plugins/banzai/contracts/v1/review-result.schema.json",
          sha256:
            "bc8e5b8f9da3160799a6fa4d5efa1c607eda86400e94f6cdd57b666697f15d78"
        }
      ]
    },
    "CONTRACT_POLICY_DRIFT",
    policyPath,
    "review-result identities"
  );
  requireJsonExact(
    contracts.planningReview,
    {
      resultPath:
        "plugins/banzai/contracts/v1/planning-review-result.schema.json",
      resultSchema: "banzai-planning-review-result/v1",
      resultSchemaVersion: 1,
      analysisPath:
        "plugins/banzai/contracts/v1/planning-review-analysis.schema.json",
      analysisSchema: "banzai-planning-review-analysis/v1",
      analysisSchemaVersion: 1,
      artifactFormat: "banzai-planning-review/v1"
    },
    "CONTRACT_POLICY_DRIFT",
    policyPath,
    "planning-review identities"
  );
  const state = record(contracts.state, policyPath, "contracts.state");
  requireExact(
    state.currentSchemaVersion,
    10,
    "CONTRACT_POLICY_DRIFT",
    policyPath,
    "current state schema version"
  );
  requireJsonExact(
    state.legacySchemaVersions,
    [1, 2, 3, 4, 5, 6, 7, 8, 9],
    "CONTRACT_POLICY_DRIFT",
    policyPath,
    "legacy state schema versions"
  );
  const control = record(
    contracts.agentControl,
    policyPath,
    "contracts.agentControl"
  );
  const expectedControl = {
    contractVersion: "8.0.0",
    capabilities: "banzai-agent-capabilities/v8",
    status: "banzai-agent-status/v6",
    request: "banzai-agent-request/v1",
    answer: "banzai-agent-answer/v2",
    configurationAnswer: "banzai-agent-answer/v3",
    legacyAnswer: "banzai-agent-answer/v1",
    recovery: "banzai-agent-recovery/v1",
    gateDecision: "banzai-agent-gate-decision/v1",
    planningTriageAnswer: "banzai-agent-answer/v4"
  };
  for (const [key, expected] of Object.entries(expectedControl)) {
    requireExact(
      control[key],
      expected,
      "CONTRACT_POLICY_DRIFT",
      policyPath,
      `agent-control ${key}`
    );
  }
  const evaluation = record(
    contracts.evaluation,
    policyPath,
    "contracts.evaluation"
  );
  requireExact(
    evaluation.export,
    "banzai-evaluation-export/v1",
    "CONTRACT_POLICY_DRIFT",
    policyPath,
    "evaluation export identity"
  );
  requireExact(
    evaluation.kpi,
    "banzai-evaluation-kpi/v1",
    "CONTRACT_POLICY_DRIFT",
    policyPath,
    "evaluation KPI identity"
  );
  return root;
}

function validatePluginManifest(value, relativePath, host) {
  const manifest = record(value, relativePath, "plugin manifest");
  requireExact(
    manifest.name,
    "banzai",
    "INVALID_PLUGIN_MANIFEST",
    relativePath,
    "name"
  );
  semanticVersion(manifest.version, relativePath, "version");
  nonEmptyString(manifest.description, relativePath, "description");
  nonEmptyString(
    record(manifest.author, relativePath, "author").name,
    relativePath,
    "author.name"
  );
  nonEmptyString(manifest.repository, relativePath, "repository");
  requireExact(
    manifest.skills,
    "./skills/",
    "INVALID_PLUGIN_MANIFEST",
    relativePath,
    "skills"
  );
  if (host === "codex") {
    requireExact(
      manifest.hooks,
      "./hooks/hooks.json",
      "INVALID_PLUGIN_MANIFEST",
      relativePath,
      "hooks"
    );
    record(manifest.interface, relativePath, "interface");
  } else {
    nonEmptyString(manifest.displayName, relativePath, "displayName");
  }
}

function validateCodexMarketplace(value, relativePath) {
  const marketplace = record(value, relativePath, "marketplace");
  nonEmptyString(marketplace.name, relativePath, "name");
  const plugins = array(marketplace.plugins, relativePath, "plugins");
  const plugin = record(plugins[0], relativePath, "plugins[0]");
  requireExact(
    plugin.name,
    "banzai",
    "INVALID_MARKETPLACE",
    relativePath,
    "plugin name"
  );
  semanticVersion(plugin.version, relativePath, "plugin version");
  const source = record(plugin.source, relativePath, "plugin source");
  requireExact(
    source.source,
    "local",
    "INVALID_MARKETPLACE",
    relativePath,
    "source type"
  );
  requireExact(
    source.path,
    "./plugins/banzai",
    "INVALID_MARKETPLACE",
    relativePath,
    "source path"
  );
}

function validateClaudeMarketplace(value, relativePath) {
  const marketplace = record(value, relativePath, "marketplace");
  nonEmptyString(marketplace.name, relativePath, "name");
  nonEmptyString(
    record(marketplace.owner, relativePath, "owner").name,
    relativePath,
    "owner.name"
  );
  const plugin = record(
    array(marketplace.plugins, relativePath, "plugins")[0],
    relativePath,
    "plugins[0]"
  );
  requireExact(
    plugin.name,
    "banzai",
    "INVALID_MARKETPLACE",
    relativePath,
    "plugin name"
  );
  requireExact(
    plugin.source,
    "./plugins/banzai",
    "INVALID_MARKETPLACE",
    relativePath,
    "source path"
  );
  if (Object.hasOwn(plugin, "version")) {
    fail(
      "INVALID_MARKETPLACE",
      relativePath,
      "Claude marketplace must not carry plugin version"
    );
  }
}

async function validateRequiredPaths(root, policy) {
  const required = array(
    policy.plugin?.requiredPaths,
    "release-policy.json",
    "plugin.requiredPaths"
  );
  const distributionPaths = new Set([
    policy.distribution?.bundle,
    policy.distribution?.sourceMap
  ]);
  for (const relativePath of required) {
    nonEmptyString(relativePath, "release-policy.json", "required path");
    try {
      await access(repositoryPath(root, relativePath));
    } catch {
      fail(
        distributionPaths.has(relativePath)
          ? "STALE_DISTRIBUTION"
          : "MISSING_RELEASE_FILE",
        relativePath,
        "required path does not exist"
      );
    }
  }
}

async function validateNoVersionTransaction(root, policy) {
  const recoveryDirectory = nonEmptyString(
    policy.versionTransaction?.recoveryDirectory,
    "release-policy.json",
    "versionTransaction.recoveryDirectory"
  );
  for (const relativePath of [
    recoveryDirectory,
    expectedRecoveryGuard,
    expectedRecoveryGuardTemporary
  ]) {
    try {
      await lstat(repositoryPath(root, relativePath));
      fail(
        "UNRESOLVED_VERSION_TRANSACTION",
        relativePath,
        "retained version transaction must be recovered before validation"
      );
    } catch (error) {
      if (error instanceof ReleaseValidationError) {
        throw error;
      }
      if (
        typeof error !== "object" ||
        error === null ||
        !("code" in error) ||
        error.code !== "ENOENT"
      ) {
        fail(
          "UNRESOLVED_VERSION_TRANSACTION",
          relativePath,
          "transaction state cannot be proven absent"
        );
      }
    }
  }
}

async function validatePlanningReviewContracts(
  root,
  schemas,
  manifestPath,
  planningPolicy
) {
  for (const family of ["result", "analysis"]) {
    const relativePath = planningPolicy[family + "Path"];
    const key =
      family === "result" ? "planningReviewResult" : "planningReviewAnalysis";
    requireExact(
      schemas[key],
      "./" + relativePath.slice("plugins/banzai/contracts/".length),
      "INVALID_CONTRACT_REFERENCE",
      manifestPath,
      key
    );
    const schema = await readJson(root, relativePath);
    requireExact(
      schema.$id,
      "https://banzai.local/contracts/v1/planning-review-" +
        family +
        ".schema.json",
      "CONTRACT_POLICY_DRIFT",
      relativePath,
      "$id"
    );
    requireExact(
      schema.properties?.schema?.const,
      planningPolicy[family + "Schema"],
      "CONTRACT_POLICY_DRIFT",
      relativePath,
      "schema"
    );
    requireExact(
      schema.properties?.schemaVersion?.const,
      planningPolicy[family + "SchemaVersion"],
      "CONTRACT_POLICY_DRIFT",
      relativePath,
      "schemaVersion"
    );
  }
}

async function validateContracts(root, policy) {
  const manifestPath = "plugins/banzai/contracts/contract.json";
  const manifest = record(
    await readJson(root, manifestPath),
    manifestPath,
    "contract manifest"
  );
  const contractVersion = semanticVersion(
    manifest.contractVersion,
    manifestPath,
    "contractVersion"
  );
  const schemas = record(manifest.schemas, manifestPath, "schemas");
  const phasePolicy = record(
    policy.contracts?.phaseResult,
    "release-policy.json",
    "contracts.phaseResult"
  );
  requireExact(
    schemas.phaseResult,
    "./v4/phase-result.schema.json",
    "INVALID_CONTRACT_REFERENCE",
    manifestPath,
    "phaseResult must reference the current v4 schema"
  );
  requireExact(
    schemas.reviewResult,
    "./v2/review-result.schema.json",
    "INVALID_CONTRACT_REFERENCE",
    manifestPath,
    "reviewResult must reference the current v2 schema"
  );
  const reviewSchema = await readJson(
    root,
    policy.contracts.reviewResult.currentPath
  );
  requireExact(
    reviewSchema.properties?.schemaVersion?.const,
    2,
    "CONTRACT_POLICY_DRIFT",
    policy.contracts.reviewResult.currentPath,
    "review-result schema version"
  );
  requireExact(
    reviewSchema.$id,
    "https://banzai.local/contracts/v2/review-result.schema.json",
    "CONTRACT_POLICY_DRIFT",
    policy.contracts.reviewResult.currentPath,
    "review-result identity"
  );
  for (const legacy of policy.contracts.reviewResult.legacy) {
    requireExact(
      createHash("sha256")
        .update(await readText(root, legacy.path))
        .digest("hex"),
      legacy.sha256,
      "LEGACY_CONTRACT_DRIFT",
      legacy.path,
      "byte-preserved legacy review-result"
    );
  }
  await validatePlanningReviewContracts(
    root,
    schemas,
    manifestPath,
    policy.contracts.planningReview
  );
  for (const key of [
    "workflowSelection",
    "phaseResult",
    "reviewResult",
    "planningReviewResult",
    "planningReviewAnalysis"
  ]) {
    const reference = nonEmptyString(
      schemas[key],
      manifestPath,
      `schemas.${key}`
    );
    if (!reference.startsWith("./")) {
      fail(
        "INVALID_CONTRACT_REFERENCE",
        manifestPath,
        `${key} must be repository-relative`
      );
    }
    const relativePath = path.posix.join("plugins/banzai/contracts", reference);
    const schema = record(
      await readJson(root, relativePath),
      relativePath,
      "schema"
    );
    requireExact(
      record(schema.properties, relativePath, "properties").contractVersion
        ?.const,
      contractVersion,
      "CONTRACT_VERSION_MISMATCH",
      relativePath,
      "contractVersion const"
    );
    nonEmptyString(schema.$id, relativePath, "$id");
  }

  const currentPath = nonEmptyString(
    phasePolicy.currentPath,
    "release-policy.json",
    "contracts.phaseResult.currentPath"
  );
  const current = record(
    await readJson(root, currentPath),
    currentPath,
    "current phase-result schema"
  );
  const currentProperties = record(
    current.properties,
    currentPath,
    "properties"
  );
  requireExact(
    record(currentProperties.schemaVersion, currentPath, "schemaVersion").const,
    phasePolicy.currentSchemaVersion,
    "CONTRACT_VERSION_MISMATCH",
    currentPath,
    "current phase-result schema version"
  );
  requireJsonExact(
    record(currentProperties.gate, currentPath, "gate").enum,
    [
      "adr_approval",
      "plan_approval",
      "escalation",
      "decision_consultation",
      null
    ],
    "CONTRACT_VERSION_MISMATCH",
    currentPath,
    "current phase-result gates"
  );
  record(
    currentProperties.decisionConsultation,
    currentPath,
    "decisionConsultation"
  );
  if (
    !array(current.required, currentPath, "required").includes(
      "decisionConsultation"
    )
  ) {
    fail(
      "CONTRACT_VERSION_MISMATCH",
      currentPath,
      "current phase-result must require decisionConsultation"
    );
  }

  for (const entry of array(
    phasePolicy.legacy,
    "release-policy.json",
    "contracts.phaseResult.legacy"
  )) {
    const legacy = record(entry, "release-policy.json", "legacy phase-result");
    const relativePath = nonEmptyString(
      legacy.path,
      "release-policy.json",
      "legacy phase-result path"
    );
    const raw = await readText(root, relativePath);
    const digest = createHash("sha256").update(raw).digest("hex");
    requireExact(
      digest,
      legacy.sha256,
      "LEGACY_CONTRACT_DRIFT",
      relativePath,
      "byte-preserved legacy phase-result"
    );
    const schema = record(
      await readJson(root, relativePath),
      relativePath,
      "legacy phase-result schema"
    );
    requireExact(
      schema.$id,
      `https://banzai.local/contracts/v${legacy.schemaVersion}/phase-result.schema.json`,
      "LEGACY_CONTRACT_DRIFT",
      relativePath,
      "legacy phase-result identity"
    );
    const properties = record(schema.properties, relativePath, "properties");
    requireJsonExact(
      record(properties.gate, relativePath, "gate").enum,
      legacy.schemaVersion === 3
        ? [
            "adr_approval",
            "plan_approval",
            "escalation",
            "decision_consultation",
            null
          ]
        : ["adr_approval", "plan_approval", "escalation", null],
      "LEGACY_CONTRACT_DRIFT",
      relativePath,
      "legacy phase-result gates"
    );
    if (
      legacy.schemaVersion < 3 &&
      Object.hasOwn(properties, "decisionConsultation")
    ) {
      fail(
        "LEGACY_CONTRACT_DRIFT",
        relativePath,
        "legacy phase-result cannot be overwritten with consultation fields"
      );
    }
  }

  const typesPath = "packages/orchestrator/src/types.ts";
  const typesSource = await readText(root, typesPath);
  const match = typesSource.match(/CONTRACT_VERSION\s*=\s*["']([^"']+)["']/);
  if (match?.[1] !== contractVersion) {
    fail(
      "CONTRACT_VERSION_MISMATCH",
      typesPath,
      "runner and plugin contract identities differ"
    );
  }
  const phaseResultSchemaVersion = typesSource.match(
    /PHASE_RESULT_SCHEMA_VERSION\s*=\s*(\d+)/
  );
  if (
    phaseResultSchemaVersion?.[1] !== String(phasePolicy.currentSchemaVersion)
  ) {
    fail(
      "CONTRACT_VERSION_MISMATCH",
      typesPath,
      "runner phase-result schema version must be 4"
    );
  }
  if (
    !/export interface RunState\s*{[^}]*?schemaVersion:\s*3\s*\|\s*4\s*\|\s*5\s*\|\s*6\s*\|\s*7\s*\|\s*8\s*\|\s*9\s*\|\s*10;/.test(
      typesSource
    )
  ) {
    fail(
      "STATE_CONTRACT_DRIFT",
      typesPath,
      "current run state must retain historical readers and support tracked-document state v10"
    );
  }
  if (!/schemaVersion:\s*1\s*\|\s*2;/.test(typesSource)) {
    fail(
      "STATE_CONTRACT_DRIFT",
      typesPath,
      "legacy phase-result/state readers must preserve v1/v2"
    );
  }

  const contractConstants = new Map([
    [
      "PLANNING_REVIEW_RESULT_SCHEMA",
      policy.contracts.planningReview.resultSchema
    ],
    [
      "PLANNING_REVIEW_ANALYSIS_SCHEMA",
      policy.contracts.planningReview.analysisSchema
    ],
    [
      "PLANNING_REVIEW_ARTIFACT_FORMAT",
      policy.contracts.planningReview.artifactFormat
    ],
    [
      "AGENT_CONTROL_CONTRACT_VERSION",
      policy.contracts.agentControl.contractVersion
    ],
    ["AGENT_CAPABILITIES_SCHEMA", policy.contracts.agentControl.capabilities],
    ["AGENT_STATUS_SCHEMA", policy.contracts.agentControl.status],
    ["AGENT_REQUEST_SCHEMA", policy.contracts.agentControl.request],
    ["AGENT_ANSWER_SCHEMA", policy.contracts.agentControl.answer],
    [
      "CONFIGURATION_ANSWER_SCHEMA",
      policy.contracts.agentControl.configurationAnswer
    ],
    ["LEGACY_AGENT_ANSWER_SCHEMA", policy.contracts.agentControl.legacyAnswer],
    ["AGENT_RECOVERY_SCHEMA", policy.contracts.agentControl.recovery],
    ["PLANNING_GATE_DOCUMENT", policy.contracts.agentControl.gateDecision],
    [
      "PLANNING_TRIAGE_DOCUMENT",
      policy.contracts.agentControl.planningTriageAnswer
    ],
    ["EVALUATION_EXPORT_SCHEMA", policy.contracts.evaluation.export],
    ["EVALUATION_KPI_SCHEMA", policy.contracts.evaluation.kpi]
  ]);
  for (const [name, expected] of contractConstants) {
    const constant = typesSource.match(
      new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`)
    );
    if (constant?.[1] !== expected) {
      fail(
        "CONTRACT_VERSION_MISMATCH",
        typesPath,
        `${name} does not match release policy`
      );
    }
  }
  for (const [name, expected] of [
    ["PLANNING_REVIEW_RESULT_SCHEMA_VERSION", 1],
    ["PLANNING_REVIEW_ANALYSIS_SCHEMA_VERSION", 1],
    ["AGENT_CAPABILITIES_SCHEMA_VERSION", 8],
    ["AGENT_STATUS_SCHEMA_VERSION", 6],
    ["AGENT_ANSWER_SCHEMA_VERSION", 2],
    ["CONFIGURATION_ANSWER_SCHEMA_VERSION", 3],
    ["AGENT_REQUEST_SCHEMA_VERSION", 1],
    ["PLANNING_GATE_DOCUMENT_VERSION", 1],
    ["PLANNING_TRIAGE_DOCUMENT_VERSION", 4],
    ["AGENT_RECOVERY_SCHEMA_VERSION", 1]
  ]) {
    const constant = typesSource.match(new RegExp(`${name}\\s*=\\s*(\\d+)`));
    if (constant?.[1] !== String(expected)) {
      fail(
        "CONTRACT_VERSION_MISMATCH",
        typesPath,
        `${name} does not match release policy`
      );
    }
  }

  const storePath = "packages/orchestrator/src/store.ts";
  const store = flatText(await readText(root, storePath));
  for (const fragment of [
    "if (state.schemaVersion === 2)",
    "schemaVersion: 3",
    "humanDecisions"
  ]) {
    if (!store.includes(fragment)) {
      fail(
        "STATE_CONTRACT_DRIFT",
        storePath,
        `missing current/legacy state fragment: ${fragment}`
      );
    }
  }
  if (
    !/state\.schemaVersion === 3\s*\|\|\s*state\.schemaVersion === 4\s*\|\|\s*state\.schemaVersion === 5\s*\|\|\s*state\.schemaVersion === 6\s*\|\|\s*state\.schemaVersion === 7/u.test(
      store
    )
  )
    fail(
      "STATE_CONTRACT_DRIFT",
      storePath,
      "current state reads must retain v3-v6 and support v7"
    );
  const validationPath = "packages/orchestrator/src/validation.ts";
  const validation = flatText(await readText(root, validationPath));
  for (const fragment of [
    "value.schemaVersion !== 1",
    "value.schemaVersion !== 2",
    "value.schemaVersion !== 3",
    "value.schemaVersion !== 4",
    "value.schemaVersion !== 5",
    "value.schemaVersion !== 6",
    "value.schemaVersion !== 7",
    "schemaVersion >= 2"
  ]) {
    if (!validation.includes(fragment)) {
      fail(
        "STATE_CONTRACT_DRIFT",
        validationPath,
        `missing evaluation state compatibility fragment: ${fragment}`
      );
    }
  }
}

async function validateHook(root) {
  const hooksPath = "plugins/banzai/hooks/hooks.json";
  const hooks = record(
    await readJson(root, hooksPath),
    hooksPath,
    "hooks manifest"
  );
  const hooksByEvent = record(hooks.hooks, hooksPath, "hooks");
  for (const event of ["PreToolUse", "PostToolUse"]) {
    const entries = array(hooksByEvent[event], hooksPath, event);
    const serialized = JSON.stringify(entries);
    if (!serialized.includes("hooks/spec-gate.cjs")) {
      fail(
        "INVALID_HOOK_REFERENCE",
        hooksPath,
        `${event} does not reference spec-gate.cjs`
      );
    }
  }
  const hookPath = repositoryPath(root, "plugins/banzai/hooks/spec-gate.cjs");
  try {
    await execFileAsync(process.execPath, ["--check", hookPath], {
      cwd: root,
      encoding: "utf8",
      timeout: 30_000
    });
  } catch {
    fail(
      "INVALID_HOOK_SYNTAX",
      "plugins/banzai/hooks/spec-gate.cjs",
      "Node syntax check failed"
    );
  }
}

// Codex and Claude Code refresh an installed plugin cache only when the plugin
// version changes, while a linked runner always executes current source. The
// hook and the modules it imports enforce the runner's state contract, so
// changing them under an already-set version leaves installed hooks stale.
const HOOK_RUNTIME_PATHS = [
  "plugins/banzai/hooks/hooks.json",
  "plugins/banzai/hooks/spec-gate.cjs",
  "plugins/banzai/lib"
];

async function git(root, args) {
  const { stdout } = await execFileAsync("git", ["-C", root, ...args], {
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 16 * 1024 * 1024
  });
  return stdout.trim();
}

async function committedReleaseVersion(root, revision) {
  try {
    return JSON.parse(await git(root, ["show", `${revision}:package.json`]))
      .version;
  } catch {
    return null;
  }
}

async function validateHookRuntimeVersion(root, releaseVersion) {
  // Release fixtures and packed sources carry no history, and a shallow CI
  // clone cannot show where the version was set.
  try {
    if (
      (await git(root, ["rev-parse", "--show-toplevel"])) !==
        (await realpath(root)) ||
      (await git(root, ["rev-parse", "--is-shallow-repository"])) !== "false"
    ) {
      return;
    }
  } catch {
    return;
  }
  // A working-tree bump covers every uncommitted hook change.
  if ((await committedReleaseVersion(root, "HEAD")) !== releaseVersion) {
    return;
  }
  let introducedAt = null;
  const commits = await git(root, [
    "log",
    "--first-parent",
    "--format=%H",
    "--",
    "package.json"
  ]);
  for (const commit of commits.split("\n").filter(Boolean)) {
    if ((await committedReleaseVersion(root, commit)) !== releaseVersion) {
      break;
    }
    introducedAt = commit;
  }
  if (introducedAt === null) {
    return;
  }
  try {
    await git(root, [
      "diff",
      "--quiet",
      "--no-ext-diff",
      "--no-textconv",
      introducedAt,
      "--",
      ...HOOK_RUNTIME_PATHS
    ]);
  } catch (error) {
    if (error?.code !== 1) {
      throw error;
    }
    fail(
      "HOOK_CHANGED_WITHOUT_VERSION_BUMP",
      HOOK_RUNTIME_PATHS.join(", "),
      `changed since release-train version ${releaseVersion} was set in ${introducedAt.slice(0, 12)}; installed plugin caches refresh only on a version change, so run \`npm run version:set -- <next version>\``
    );
  }
}

const ciWorkflow = ".github/workflows/ci.yml";
const ciSchedule = "17 5 * * 1";

function jobBlock(source, job) {
  const escaped = job.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(
    new RegExp(
      `^  ${escaped}:\\n([\\s\\S]*?)(?=^  [A-Za-z_][A-Za-z0-9_-]*:\\n|(?![\\s\\S]))`,
      "m"
    )
  );
  if (match === null) {
    fail("CI_POLICY_DRIFT", ciWorkflow, `missing job ${job}`);
  }
  return match[1];
}

function requireJobText(block, expected, job, label) {
  if (!`\n${block}\n`.includes(`\n${expected}\n`)) {
    fail("CI_POLICY_DRIFT", ciWorkflow, `${job} missing ${label}`);
  }
}

// ADR-0053: each deterministic lane must be exactly its approved job. Any
// added line, in any YAML spelling of a key (a quoted or escaped `if`, for
// example), could change when the lane runs or skip its gate, so the lane is
// compared as whole text instead of matching keys by pattern.
function ciLaneDefinition(lane) {
  return [
    lane.required === true
      ? "    if: github.event_name != 'schedule'"
      : "    if: github.event_name != 'pull_request'",
    "    runs-on: ubuntu-24.04",
    `    container: ${lane.image}`,
    ...(lane.required === true ? [] : ["    continue-on-error: true"]),
    "    steps:",
    "      - uses: actions/checkout@v6",
    "        with:",
    "          persist-credentials: false",
    "      - run: git --version",
    "      - run: python3 --version",
    '      - run: git config --global --add safe.directory "$GITHUB_WORKSPACE"',
    "      - run: npm ci",
    "      - run: npm run release:check",
    ...(lane.required === true
      ? [
          "      - id: release_evidence",
          "        run: node packages/orchestrator/scripts/release-evidence.mjs record",
          "      - uses: actions/upload-artifact@v7",
          "        with:",
          "          name: ${{ steps.release_evidence.outputs.name }}",
          "          path: ${{ steps.release_evidence.outputs.path }}",
          "          if-no-files-found: error",
          "          retention-days: 30"
        ]
      : [])
  ].join("\n");
}

async function validateCi(root, policy) {
  if (policy.ci.workflow !== ciWorkflow) {
    fail("CI_POLICY_DRIFT", "release-policy.json", "unexpected CI workflow");
  }
  const source = await readText(root, ciWorkflow);
  const triggerBlock = [
    "on:",
    "  pull_request:",
    "  workflow_dispatch:",
    "    inputs:",
    `      ${policy.ci.liveInput}:`,
    "        description: Run live vendor compatibility on the dedicated protected runner",
    "        type: boolean",
    "        default: false",
    "  schedule:",
    `    - cron: "${ciSchedule}"`
  ].join("\n");
  if (
    source
      .slice(source.indexOf("on:\n"), source.indexOf("\npermissions:\n"))
      .trim() !== triggerBlock
  ) {
    fail(
      "CI_POLICY_DRIFT",
      ciWorkflow,
      "expected pull_request, opt-in manual and weekly schedule triggers"
    );
  }
  // ADR-0053: a newer push cancels only the older run of the same pull
  // request; every other run gets a group of its own.
  requireJobText(
    source,
    [
      "permissions:",
      "  contents: read",
      "",
      "concurrency:",
      "  group: ci-${{ github.event_name == 'pull_request' && format('pr-{0}', github.event.pull_request.number) || format('run-{0}', github.run_id) }}",
      "  cancel-in-progress: ${{ github.event_name == 'pull_request' }}",
      "",
      "jobs:"
    ].join("\n"),
    "workflow",
    "read-only permissions and pull-request-only cancellation"
  );

  const lanes = [...policy.node.supported, policy.node.forward];
  const liveJob = nonEmptyString(
    policy.ci.liveJob,
    "release-policy.json",
    "ci.liveJob"
  );
  const jobsSource = source.slice(source.indexOf("\njobs:\n") + 7);
  const jobNames = [
    ...jobsSource.matchAll(/^ {2}([A-Za-z_][A-Za-z0-9_-]*):\n/gm)
  ].map((match) => match[1]);
  const expectedJobs = [...lanes.map((lane) => lane.job), liveJob];
  if (
    jobNames.length !== expectedJobs.length ||
    expectedJobs.some(
      (job) => jobNames.filter((name) => name === job).length !== 1
    )
  ) {
    fail(
      "CI_POLICY_DRIFT",
      ciWorkflow,
      "expected exactly the supported, forward and live jobs"
    );
  }
  for (const lane of lanes) {
    const block = jobBlock(jobsSource, lane.job);
    requireJobText(
      block,
      "    runs-on: ubuntu-24.04",
      lane.job,
      "hosted runner"
    );
    requireJobText(
      block,
      `    container: ${lane.image}`,
      lane.job,
      "exact image"
    );
    requireJobText(
      block,
      "      - uses: actions/checkout@v6\n        with:\n          persist-credentials: false",
      lane.job,
      "checkout without persisted credentials"
    );
    requireJobText(
      block,
      "      - run: git --version",
      lane.job,
      "Git preflight"
    );
    requireJobText(
      block,
      '      - run: git config --global --add safe.directory "$GITHUB_WORKSPACE"',
      lane.job,
      "container workspace safe.directory"
    );
    requireJobText(block, "      - run: npm ci", lane.job, "npm ci");
    requireJobText(
      block,
      "      - run: npm run release:check",
      lane.job,
      "release gate"
    );
    if (/^\s+needs:/m.test(block)) {
      fail("CI_POLICY_DRIFT", ciWorkflow, `${lane.job} must run independently`);
    }
    if (lane.required === true && /continue-on-error:/.test(block)) {
      fail("CI_POLICY_DRIFT", ciWorkflow, `${lane.job} must be required`);
    }
    if (lane.required === false) {
      requireJobText(
        block,
        "    continue-on-error: true",
        lane.job,
        "advisory flag"
      );
    }
    if (/\b(?:codex|claude|auth|compatibility:live|banzai)\b/i.test(block)) {
      fail(
        "CI_VENDOR_BOUNDARY",
        ciWorkflow,
        `${lane.job} enters vendor or global CLI path`
      );
    }
    if (/^\s*(?:- )?cache\s*:|actions\/cache@/m.test(block)) {
      fail(
        "CI_CACHE_BOUNDARY",
        ciWorkflow,
        `${lane.job} must not cache outputs`
      );
    }
    // Checked last so the boundary checks above keep their specific codes.
    if (block.trimEnd() !== ciLaneDefinition(lane)) {
      fail(
        "CI_POLICY_DRIFT",
        ciWorkflow,
        `${lane.job} differs from its approved job definition`
      );
    }
  }

  const live = jobBlock(jobsSource, liveJob);
  const guard = live.match(/^ {4}if: >-\n((?: {6}.+\n)+)/m)?.[1]?.trim();
  const expectedGuard = [
    "github.event_name == 'workflow_dispatch' &&",
    `inputs.${policy.ci.liveInput} == true &&`,
    "github.ref_protected == true &&",
    `vars.${policy.ci.liveEnableVariable} == '${policy.ci.liveEnableValue}'`
  ].join("\n      ");
  if (guard !== expectedGuard) {
    fail(
      "CI_POLICY_DRIFT",
      ciWorkflow,
      "live job requires manual opt-in, protected ref and enable variable"
    );
  }
  for (const [text, label] of [
    ["    continue-on-error: true", "advisory flag"],
    [
      `    runs-on: [self-hosted, linux, ${policy.ci.liveRunnerTag}]`,
      "dedicated runner labels"
    ],
    [
      "      - uses: actions/checkout@v6\n        with:\n          persist-credentials: false",
      "checkout without persisted credentials"
    ],
    ["      - uses: actions/setup-node@v6", "Node setup"],
    [
      `          node-version: ${policy.node.supported.at(-1).version}`,
      "supported live runtime"
    ],
    ["          package-manager-cache: false", "disabled automatic cache"],
    ["      - run: git --version", "Git preflight"],
    [
      "      - run: npm ci\n      - run: npm run build:dist\n      - run: npm run compatibility:live -- --confirm-live",
      "install and build before live execution"
    ],
    [
      "      - run: npm run compatibility:live -- --confirm-live",
      "live command"
    ]
  ]) {
    requireJobText(live, text, liveJob, label);
  }
  if (
    /^\s*(?:- )?(?:cache|artifacts)\s*:|actions\/(?:cache|upload-artifact)@/m.test(
      live
    )
  ) {
    fail(
      "CI_LIVE_RETENTION",
      ciWorkflow,
      "live job must not cache or retain artifacts"
    );
  }

  try {
    await lstat(repositoryPath(root, ".gitlab-ci.yml"));
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  fail(
    "UNEXPECTED_GITLAB_CI",
    ".gitlab-ci.yml",
    "GitHub Actions replaces GitLab CI"
  );
}

const publishWorkflow = ".github/workflows/publish.yml";
const evidenceJob = "release_evidence";
const publishJob = "publish_npm";
const releaseGuard =
  "github.event.release.draft == false && github.event.release.prerelease == false";

// ADR-0053: publication either reuses bound pull-request evidence or runs the
// complete gate on both supported lanes, and only the publishing job can mint
// an OIDC token. Any added line, in any YAML spelling of a key (a quoted or
// escaped `if`, for example), could weaken that, so the validator owns the
// whole file as exact text instead of matching keys by pattern.
function publishDefinition(policy) {
  const lanes = policy.node.supported;
  const node = `          node-version: ${lanes.at(-1).version}`;
  const evidence = [
    "name: Publish",
    "",
    "on:",
    "  release:",
    "    types: [published]",
    "",
    "permissions:",
    "  contents: read",
    "",
    "jobs:",
    "  release_evidence:",
    `    if: ${releaseGuard}`,
    "    runs-on: ubuntu-24.04",
    "    timeout-minutes: 10",
    "    permissions:",
    "      contents: read",
    "      actions: read",
    "    outputs:",
    "      bound: ${{ steps.evidence.outputs.bound }}",
    "    steps:",
    "      - uses: actions/checkout@v6",
    "        with:",
    "          ref: ${{ github.event.release.tag_name }}",
    "          fetch-depth: 2",
    "          persist-credentials: false",
    "      - uses: actions/setup-node@v6",
    "        with:",
    node,
    "          package-manager-cache: false",
    "      - id: evidence",
    "        env:",
    "          GITHUB_TOKEN: ${{ github.token }}",
    "        run: node packages/orchestrator/scripts/release-evidence.mjs verify"
  ];
  const fallback = (lane) => [
    `  ${lane.job}:`,
    `    needs: ${evidenceJob}`,
    "    if: >-",
    "      !cancelled() &&",
    `      ${releaseGuard} &&`,
    `      needs.${evidenceJob}.outputs.bound != 'true'`,
    "    runs-on: ubuntu-24.04",
    `    container: ${lane.image}`,
    "    timeout-minutes: 60",
    "    permissions:",
    "      contents: read",
    "    steps:",
    "      - uses: actions/checkout@v6",
    "        with:",
    "          ref: ${{ github.event.release.tag_name }}",
    "          persist-credentials: false",
    "      - run: git --version",
    '      - run: git config --global --add safe.directory "$GITHUB_WORKSPACE"',
    "      - run: npm ci",
    "      - run: npm run release:check",
    ""
  ];
  const lanesPassed = lanes
    .map((lane) => `needs.${lane.job}.result == 'success'`)
    .join(" && ");
  const publish = [
    `  ${publishJob}:`,
    `    needs: [${[evidenceJob, ...lanes.map((lane) => lane.job)].join(", ")}]`,
    "    if: >-",
    "      !cancelled() &&",
    `      ${releaseGuard} &&`,
    `      ((needs.${evidenceJob}.result == 'success' && needs.${evidenceJob}.outputs.bound == 'true') ||`,
    `      (${lanesPassed}))`,
    "    runs-on: ubuntu-24.04",
    "    environment: npm",
    "    timeout-minutes: 30",
    "    permissions:",
    "      contents: read",
    "      id-token: write",
    "    env:",
    '      PACKAGE: "@parabolic-technologies/banzai"',
    "      RELEASE_TAG: ${{ github.event.release.tag_name }}",
    "    steps:",
    "      - uses: actions/checkout@v6",
    "        with:",
    "          ref: ${{ github.event.release.tag_name }}",
    "          persist-credentials: false",
    "      - uses: actions/setup-node@v6",
    "        with:",
    node,
    "          registry-url: https://registry.npmjs.org",
    "          package-manager-cache: false",
    "      - name: Confirm the release tag matches the source version and npm supports trusted publishing",
    "        run: |",
    '          version="$(node -p "require(\'./package.json\').version")"',
    '          if [ "$RELEASE_TAG" != "v$version" ]; then',
    '            echo "release tag $RELEASE_TAG does not match package version $version" >&2',
    "            exit 1",
    "          fi",
    "          node - \"$(npm --version)\" <<'CHECK'",
    '          const [major, minor, patch] = process.argv[2].split(".").map(Number);',
    "          const supported = major > 11 || (major === 11 && (minor > 5 || (minor === 5 && patch >= 1)));",
    "          if (!supported) {",
    "            console.error(`npm ${process.argv[2]} is older than 11.5.1, which trusted publishing requires`);",
    "            process.exit(1);",
    "          }",
    "          CHECK",
    "      - run: git --version",
    "      - run: npm ci",
    "      - run: npm run build:dist",
    "      - run: npm run release:validate",
    "      - run: npm run publication:check",
    "      - name: Skip versions that already exist on the registry",
    "        id: registry",
    "        run: |",
    '          version="$(node -p "require(\'./package.json\').version")"',
    '          if npm view "$PACKAGE@$version" version --registry https://registry.npmjs.org/ >/dev/null 2>&1; then',
    '            echo "published=true" >> "$GITHUB_OUTPUT"',
    '            echo "$PACKAGE@$version already exists on the registry; the publish step is skipped"',
    "          else",
    '            echo "published=false" >> "$GITHUB_OUTPUT"',
    "          fi",
    "      - name: Publish the CLI workspace through npm trusted publishing",
    "        if: steps.registry.outputs.published == 'false'",
    '        run: npm publish --ignore-scripts --workspace "$PACKAGE" --access public --registry https://registry.npmjs.org/',
    "      - name: Record npm publication outcome",
    "        env:",
    "          ALREADY_PUBLISHED: ${{ steps.registry.outputs.published }}",
    "        run: |",
    '          version="$(node -p "require(\'./package.json\').version")"',
    "          {",
    '            echo "## $PACKAGE@$version"',
    '            if [ "$ALREADY_PUBLISHED" = "true" ]; then',
    '              echo "Version already exists on npm; publication was skipped."',
    "            else",
    '              echo "Package accepted by npm. Availability may be delayed by registry processing."',
    "            fi",
    '          } >> "$GITHUB_STEP_SUMMARY"',
    ""
  ];
  return [...evidence, "", ...lanes.flatMap(fallback), ...publish].join("\n");
}

async function validatePublish(root, policy) {
  const source = await readText(root, publishWorkflow);
  const expected = publishDefinition(policy);
  if (source !== expected) {
    const actual = source.split("\n");
    const lines = expected.split("\n");
    const index = lines.findIndex(
      (line, position) => actual[position] !== line
    );
    fail(
      "PUBLISH_POLICY_DRIFT",
      publishWorkflow,
      `differs from the approved publication workflow at line ${(index === -1 ? lines.length : index) + 1}`
    );
  }
}

function renderPolicyBlock(policy) {
  const rows = [
    ["Evidence", "Node", "Image", "GitHub Actions job", "Policy"],
    ...policy.node.supported.map((lane) => [
      "Supported (blocking)",
      lane.version,
      `\`${lane.image}\``,
      `\`${lane.job}\``,
      "required"
    ]),
    [
      "Forward compatibility",
      policy.node.forward.version,
      `\`${policy.node.forward.image}\``,
      `\`${policy.node.forward.job}\``,
      "advisory"
    ]
  ];
  const widths = rows[0].map((_, index) =>
    Math.max(...rows.map((row) => row[index].length))
  );
  const row = (cells) =>
    `| ${cells.map((cell, index) => cell.padEnd(widths[index])).join(" | ")} |`;
  const separator = `| ${widths.map((width) => "-".repeat(width)).join(" | ")} |`;
  return (
    `${policy.documentation.policyBlockStart}\n\n` +
    `Engines: \`${policy.node.engines}\`\n\n` +
    `Version authority: \`package.json#/version\`; 9 fields in 7 files.\n\n` +
    `${row(rows[0])}\n` +
    `${separator}\n` +
    `${rows.slice(1).map(row).join("\n")}\n\n` +
    `${policy.documentation.policyBlockEnd}`
  );
}

async function validateDocumentation(root, policy) {
  const expected = renderPolicyBlock(policy);
  for (const relativePath of array(
    policy.documentation?.paths,
    "release-policy.json",
    "documentation.paths"
  )) {
    const contents = await readText(root, relativePath);
    if (!contents.includes(expected)) {
      fail(
        "DOCUMENTATION_POLICY_DRIFT",
        relativePath,
        "canonical Node policy block differs"
      );
    }
  }
  const releaseTrainGuidance = new Map([
    [
      "CONTRIBUTING.md",
      [
        "one root-owned release-train version across nine persisted fields",
        "npm run version:set -- <version>",
        "npm run version:recover",
        ".banzai-version-set.guard",
        "delivery/install/publication states separately",
        "explicit capability and contract negotiation"
      ]
    ],
    [
      "documentation/release-checklist.md",
      [
        "complete included-change scope",
        "highest impact across the complete included plugin and orchestrator change set",
        "npm run version:set -- <version>",
        "not applicable",
        "release-train version is not a machine-contract compatibility signal",
        "npm run version:recover",
        ".banzai-version-set.guard"
      ]
    ],
    [
      "documentation/orchestrator.md",
      [
        "shared source metadata does not imply shared installation or publication",
        "npm run version:set -- <version>",
        "canonical nine-way release-train parity",
        ".banzai-version-set.guard",
        "`version:set` or `version:recover`",
        "Compatibility still follows these explicit contract and operation identities"
      ]
    ]
  ]);
  for (const [relativePath, fragments] of releaseTrainGuidance) {
    const contents = flatText(await readText(root, relativePath));
    for (const fragment of fragments) {
      if (!contents.includes(fragment)) {
        fail(
          "DOCUMENTATION_POLICY_DRIFT",
          relativePath,
          `missing release-train guidance: ${fragment}`
        );
      }
    }
  }
}

const POLICY_READ_MATRIX = {
  "decision-consultation": {
    heading: "Decision Consultation",
    read: [],
    conditional: [
      "feature-description",
      "architecture-decision",
      "development-plan"
    ]
  },
  "test-assurance": {
    heading: "Test Assurance",
    read: [
      "development-plan",
      "code-writing",
      "test-writing",
      "feature-review",
      "feature",
      "quick-fix"
    ],
    conditional: ["project-manifest"]
  },
  "security-assurance": {
    heading: "Security Assurance",
    read: [
      "feature-description",
      "development-plan",
      "feature-review",
      "feature",
      "quick-fix"
    ],
    conditional: [
      "architecture-decision",
      "code-writing",
      "test-writing",
      "project-manifest"
    ]
  },
  "engineering-quality": {
    heading: "Engineering Quality",
    read: [
      "feature-description",
      "architecture-decision",
      "development-plan",
      "code-writing",
      "feature-review",
      "feature",
      "quick-fix",
      "project-manifest"
    ],
    conditional: []
  },
  "plan-task-completion": {
    heading: "Plan Task Completion Evidence",
    read: ["development-plan", "code-writing"],
    conditional: [
      "test-writing",
      "feature-review",
      "feature-status",
      "quick-fix"
    ]
  },
  "artifact-storage": {
    heading: "Artifact Storage",
    read: [
      "feature-description",
      "architecture-decision",
      "development-plan",
      "code-writing",
      "test-writing",
      "feature-review",
      "feature-status",
      "feature",
      "quick-fix",
      "project-manifest"
    ],
    conditional: []
  }
};
const STALE_CLAUDE_REFERENCE_PATTERNS = [
  /(?:policy|policies|gates?|fields|role|rules) (?:defined )?(?:under [^`]+ )?(?:in|from) `CLAUDE\.md`/i,
  /from (?:the )?(?:installed )?CLAUDE\.md/i,
  /Read `CLAUDE\.md`/,
  /@\.\/CLAUDE\.md/
];
const INSTRUCTION_LAYOUT_ALLOWED_CONTEXTS = [
  "## Engineering Quality",
  "legacy Banzai layout",
  "@AGENTS.md",
  "Free paths",
  "free path",
  "scaffold",
  "copy these",
  "Never overwrite",
  "isFreePath",
  "migration",
  "shim",
  "host-specific",
  "layout"
];

async function validateInstructionLayout(root) {
  const code = "INSTRUCTION_LAYOUT_DRIFT";
  const plugin = "plugins/banzai";
  const processPath = `${plugin}/AGENTS.md`;
  const migrationPath = `${plugin}/skills/project-manifest/references/layout-migration.md`;
  const shim = await readText(root, `${plugin}/CLAUDE.md`, code);
  requireExact(
    shim,
    "# CLAUDE.md\n\n@AGENTS.md\n",
    code,
    `${plugin}/CLAUDE.md`,
    "include shim"
  );
  const processText = await readText(root, processPath, code);
  const headings = [...processText.matchAll(/^## (.+)$/gm)].map(
    (match) => match[1]
  );
  const expected = [
    "Authority",
    "Execution Modes",
    "Roles",
    "Routing",
    "Hard Rules",
    "Escalation Triggers",
    "Policies",
    "ADR Eligibility",
    "Verification",
    "Decision Gates",
    "Progress Reports",
    "Hook Gate",
    "Git",
    "Dependencies"
  ];
  if (
    !processText.startsWith("# AGENTS.md\n") ||
    /^@/m.test(processText) ||
    JSON.stringify(headings) !== JSON.stringify(expected)
  ) {
    fail(
      code,
      processPath,
      "process heading, include boundary or ordered sections differ"
    );
  }
  const index =
    processText.match(/^## Policies\n([\s\S]*?)(?=^## |$(?![\s\S]))/m)?.[1] ??
    "";
  const skills = [
    "feature-description",
    "architecture-decision",
    "development-plan",
    "code-writing",
    "test-writing",
    "feature-review",
    "feature-status",
    "feature",
    "quick-fix",
    "project-manifest",
    "orchestrate"
  ];
  const policyNames = Object.keys(POLICY_READ_MATRIX);
  const requiredPaths = (await readJson(root, "release-policy.json")).plugin
    .requiredPaths;
  const layoutPaths = [
    processPath,
    `${plugin}/CLAUDE.md`,
    migrationPath,
    ...policyNames.map((name) => `${plugin}/policies/${name}.md`)
  ];
  for (const relativePath of layoutPaths) {
    if (!requiredPaths.includes(relativePath))
      fail(code, "release-policy.json", `requiredPaths omits ${relativePath}`);
  }
  const policyFiles = (
    await readdir(repositoryPath(root, `${plugin}/policies`))
  ).sort();
  if (
    JSON.stringify(policyFiles) !==
    JSON.stringify(policyNames.map((name) => `${name}.md`).sort())
  ) {
    fail(code, `${plugin}/policies`, "expected exactly the six policy files");
  }
  for (const [name, entry] of Object.entries(POLICY_READ_MATRIX)) {
    const relativePath = `${plugin}/policies/${name}.md`;
    const contents = await readText(root, relativePath, code);
    const count = contents
      .split("\n")
      .filter((line) => line === `## ${entry.heading}`).length;
    if (count !== 1) {
      // Preserve the established policy-specific diagnostics for existing pins.
      const headingCode =
        {
          "test-assurance": "TEST_ASSURANCE_POLICY_DRIFT",
          "security-assurance": "SECURITY_ASSURANCE_POLICY_DRIFT",
          "engineering-quality": "ENGINEERING_QUALITY_POLICY_DRIFT",
          "decision-consultation": "DECISION_CONSULTATION_POLICY_DRIFT"
        }[name] ?? code;
      fail(
        headingCode,
        relativePath,
        `expected exactly one policy body heading, found ${count}`
      );
    }
    // Delivery structure only; this does not adjudicate plan obligations.
    if (
      name === "plan-task-completion" &&
      (contents.split("\n").filter((line) => line === "## Plan Authority")
        .length !== 1 ||
        !contents.includes(
          "- Owner decision: ADR-0038 (Plan Authority); ADR-0017/0025/0047 (Plan Task Completion Evidence)"
        ))
    ) {
      fail(
        code,
        relativePath,
        "plan authority section or section ownership differs"
      );
    }
    const row = index
      .split("\n")
      .find((line) => line.includes(`\`policies/${name}.md\``));
    const cells = row
      ?.split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());
    const consumers = flatText(contents).match(
      /- Consumers: (.*?); conditional: (.*?)(?= - Process source:)/
    );
    const namesIn = (text) =>
      [...text.matchAll(/`([a-z-]+)`/g)].map((match) => match[1]).sort();
    for (const [position, key] of [
      [2, "read"],
      [3, "conditional"]
    ]) {
      const expectedNames = [...entry[key]].sort();
      if (
        !cells ||
        cells.length !== 4 ||
        JSON.stringify(namesIn(cells[position])) !==
          JSON.stringify(expectedNames)
      ) {
        fail(code, processPath, `${name} index ${key} consumers differ`);
      }
      if (
        !consumers ||
        JSON.stringify(namesIn(consumers[position - 1])) !==
          JSON.stringify(expectedNames)
      ) {
        fail(code, relativePath, `${key} consumer header differs`);
      }
    }
    if (
      !/^# .+\n/m.test(contents) ||
      !contents.includes("- Owner decision:") ||
      !flatText(contents).includes(
        "the project `AGENTS.md` (authority order, escalation triggers, decision gates)"
      )
    ) {
      fail(
        code,
        relativePath,
        "policy header omits its owner or process source"
      );
    }
  }
  const diagnostic = "legacy Banzai layout: run `project-manifest` to migrate";
  const bootstrapPaths = new Set([
    `${plugin}/skills/project-manifest/SKILL.md`,
    `${plugin}/skills/feature-status/SKILL.md`,
    migrationPath
  ]);
  for (const skill of skills) {
    const relativePath = `${plugin}/skills/${skill}/SKILL.md`;
    const contents = await readText(root, relativePath, code);
    if (skill !== "orchestrate") {
      const sources =
        contents.match(/^## Sources\n([\s\S]*?)(?=^## |$(?![\s\S]))/m)?.[1] ??
        "";
      const actual = [
        ...sources.matchAll(/^\s+- `([a-z-]+)\.md` (before|when) /gm)
      ].map((match) => [match[1], match[2]]);
      const expectedReads = Object.entries(POLICY_READ_MATRIX).flatMap(
        ([name, entry]) =>
          entry.read.includes(skill)
            ? [[name, "before"]]
            : entry.conditional.includes(skill)
              ? [[name, "when"]]
              : []
      );
      if (JSON.stringify(actual) !== JSON.stringify(expectedReads))
        fail(code, relativePath, "Sources reads differ from the policy matrix");
      const mentioned = [
        ...new Set(
          [...sources.matchAll(/`([a-z-]+)\.md`/g)].map((match) => match[1])
        )
      ];
      if (
        JSON.stringify(mentioned.sort()) !==
        JSON.stringify(expectedReads.map(([name]) => name).sort())
      )
        fail(code, relativePath, "Sources names an extra or missing policy");
      if (!flatText(contents).includes(diagnostic))
        fail(code, relativePath, "missing legacy diagnostic");
      if (
        !sources.includes("../../policies/<name>.md") ||
        !sources.includes("the project root `AGENTS.md`") ||
        !sources.includes("unreadable")
      )
        fail(
          code,
          relativePath,
          "missing source-resolution or availability boundary"
        );
    }
    if (
      ["test-writing", "feature-status", "orchestrate"].includes(skill) &&
      contents.includes("engineering-quality.md")
    )
      fail(code, relativePath, "unexpected Engineering Quality read");
    if (bootstrapPaths.has(relativePath)) {
      const flat = flatText(contents);
      if (
        !flat.includes("bootstrap source rule") ||
        !flat.includes("installed plugin's packaged `AGENTS.md`")
      )
        fail(code, relativePath, "missing bootstrap source rule");
    }
  }
  const scanPaths = [
    processPath,
    `${plugin}/PROJECT_MANIFEST.md`,
    `${plugin}/documentation/README.md`,
    `${plugin}/hooks/README.md`,
    `${plugin}/hooks/spec-gate.cjs`,
    "packages/orchestrator/src/prompts.ts"
  ];
  const scanSkills = async (directory) => {
    for (const entry of await readdir(repositoryPath(root, directory), {
      withFileTypes: true
    })) {
      const relativePath = `${directory}/${entry.name}`;
      if (entry.isDirectory()) await scanSkills(relativePath);
      else if (entry.name.endsWith(".md")) scanPaths.push(relativePath);
    }
  };
  await scanSkills(`${plugin}/skills`);
  for (const relativePath of scanPaths) {
    const contents = await readText(root, relativePath, code);
    const flat = flatText(contents);
    if (
      !bootstrapPaths.has(relativePath) &&
      (/bootstrap source rule/i.test(flat) ||
        flat.includes("installed plugin's packaged `AGENTS.md`"))
    )
      fail(
        code,
        relativePath,
        "bootstrap exemption outside its two skills and migration reference"
      );
    if (STALE_CLAUDE_REFERENCE_PATTERNS.some((pattern) => pattern.test(flat)))
      fail(code, relativePath, "obsolete CLAUDE process or policy reference");
    if (
      relativePath.endsWith("orchestrate/references/control-protocol.md") &&
      contents.includes("engineering-quality.md")
    )
      fail(code, relativePath, "supervisor must not read Engineering Quality");
    for (const line of contents.split("\n")) {
      if (!line.includes("CLAUDE.md")) continue;
      // These two unchanged hook lines are the existing free-path contract.
      const hookFreePath =
        relativePath === `${plugin}/hooks/spec-gate.cjs` &&
        [
          " *     PROJECT_MANIFEST.md, CLAUDE.md, AGENTS.md) flow freely.",
          "  return base === 'PROJECT_MANIFEST.md' || base === 'CLAUDE.md' || base === 'AGENTS.md';"
        ].includes(line);
      if (
        !hookFreePath &&
        !INSTRUCTION_LAYOUT_ALLOWED_CONTEXTS.some((context) =>
          line.toLowerCase().includes(context.toLowerCase())
        )
      )
        fail(
          code,
          relativePath,
          `unscoped CLAUDE filename mention: ${line.trim()}`
        );
    }
  }
  const migration = await readText(root, migrationPath, code);
  for (const fragment of [
    "bootstrap source rule",
    "installed plugin's packaged `AGENTS.md`",
    "Apply only after approval",
    "byte-identical",
    "## Project Rules",
    "host-specific",
    "unclassified"
  ]) {
    if (!flatText(migration).includes(fragment))
      fail(code, migrationPath, `missing migration boundary: ${fragment}`);
  }
  const literals = migration
    .split("\n")
    .filter((line) => line.startsWith("- Last legacy-compatible release:"));
  const match =
    literals.length === 1
      ? literals[0].match(
          /^- Last legacy-compatible release: `(\d+\.\d+\.\d+)`$/
        )
      : null;
  if (!match)
    fail(code, migrationPath, "expected one literal legacy release version");
  let legacy;
  try {
    legacy = semanticVersion(match[1], migrationPath, "legacy release");
  } catch {
    fail(code, migrationPath, "legacy release is not SemVer");
  }
  const current = semanticVersion(
    (await readJson(root, "package.json")).version,
    "package.json",
    "version"
  );
  const legacyParts = legacy.split(".").map(BigInt);
  const currentParts = current.split(".").map(BigInt);
  const different = legacyParts.findIndex(
    (part, index) => part !== currentParts[index]
  );
  // An unreleased tree keeps the existing version. Shipping requires the
  // release checklist's strictly-lower comparison after version selection.
  if (different >= 0 && legacyParts[different] > currentParts[different])
    fail(
      code,
      migrationPath,
      "legacy release is greater than the current source version"
    );
}

async function validateTestAssurancePolicy(root) {
  const requiredFragments = new Map([
    [
      "plugins/banzai/policies/test-assurance.md",
      ["## Test Assurance", "coverage percentage", "Boundary fakes"]
    ],
    [
      "plugins/banzai/skills/test-writing/SKILL.md",
      ["**Risk and Contract Assurance Map**", "no-new-test"]
    ],
    [
      "plugins/banzai/skills/feature-review/SKILL.md",
      [
        "the plausible regression mechanism;",
        "why current evidence cannot detect it;",
        "proportionate evidence level"
      ]
    ]
  ]);
  for (const [relativePath, fragments] of requiredFragments) {
    const contents = flatText(
      await instructionConsumerText(root, relativePath)
    );
    for (const fragment of fragments) {
      if (!contents.includes(fragment)) {
        fail(
          "TEST_ASSURANCE_POLICY_DRIFT",
          relativePath,
          `missing required policy fragment: ${fragment}`
        );
      }
    }
  }
}

/**
 * The Security Assurance policy (ADR-0027) lives in one place and every
 * consuming skill references it instead of restating the exposure classes.
 * This check is what keeps that wiring from drifting silently: a skill that
 * loses its reference stops applying the policy with nothing else to notice.
 */
async function validateSecurityAssurancePolicy(root) {
  // Skill Markdown is hard-wrapped, so a required phrase may legitimately span
  // a line break. Match against whitespace-normalized text: a rewrap must not
  // fail the build, but a removal still must.
  const flat = (value) => value.replace(/\s+/g, " ");
  const policyPath = "plugins/banzai/policies/security-assurance.md";
  const policyRaw = await readText(root, policyPath);
  const policy = flat(policyRaw);
  const headingCount = policyRaw
    .split("\n")
    .filter((line) => line === "## Security Assurance").length;
  if (headingCount !== 1) {
    fail(
      "SECURITY_ASSURANCE_POLICY_DRIFT",
      policyPath,
      `expected exactly one "## Security Assurance" heading, found ${headingCount}`
    );
  }
  for (const fragment of [
    "creates or widens",
    "Untrusted input reaches an interpreter or resource path",
    "An identity or access decision",
    "Secret material",
    "Personal or regulated data",
    "Cross-principal reachability",
    "An outbound request or redirect whose destination an input can influence",
    "A destructive or irreversible effect",
    "no class applies",
    "Introducing or widening a security control is an escalation trigger"
  ]) {
    if (!policy.includes(fragment)) {
      fail(
        "SECURITY_ASSURANCE_POLICY_DRIFT",
        policyPath,
        `missing required policy fragment: ${fragment}`
      );
    }
  }
  const reference =
    "Security Assurance policy in the installed `policies/security-assurance.md`";
  for (const relativePath of [
    "plugins/banzai/skills/feature-description/SKILL.md",
    "plugins/banzai/skills/development-plan/SKILL.md",
    "plugins/banzai/skills/architecture-decision/SKILL.md",
    "plugins/banzai/skills/feature/SKILL.md",
    "plugins/banzai/skills/quick-fix/SKILL.md",
    "plugins/banzai/skills/test-writing/SKILL.md"
  ]) {
    const contents = flat(await instructionConsumerText(root, relativePath));
    if (
      !contents.includes(reference) &&
      !contents.includes(
        "Security Assurance policy (`security-assurance.md`) supplied by the active execution context"
      )
    ) {
      fail(
        "SECURITY_ASSURANCE_POLICY_DRIFT",
        relativePath,
        `missing required reference: ${reference}`
      );
    }
  }
  // A quick fix may finish without a change report, so the unconditional final
  // report has to be a named landing place for the exposure result. Without
  // this the lite path silently records nothing.
  const quickFixPath = "plugins/banzai/skills/quick-fix/SKILL.md";
  const quickFix = flat(await instructionConsumerText(root, quickFixPath));
  for (const fragment of [
    "record the class in the change report when one is required, and in the final report otherwise",
    "the security exposure result"
  ]) {
    if (!quickFix.includes(fragment)) {
      fail(
        "SECURITY_ASSURANCE_POLICY_DRIFT",
        quickFixPath,
        `missing required no-report recording rule: ${fragment}`
      );
    }
  }
  const reviewPath = "plugins/banzai/skills/feature-review/SKILL.md";
  const review = flat(await instructionConsumerText(root, reviewPath));
  for (const fragment of [
    "Security Assurance",
    "the mechanism reachable in this codebase",
    "is not a finding"
  ]) {
    if (!review.includes(fragment)) {
      fail(
        "SECURITY_ASSURANCE_POLICY_DRIFT",
        reviewPath,
        `missing required policy fragment: ${fragment}`
      );
    }
  }
}

/**
 * Engineering Quality (ADR-0030) is one vendor-neutral policy projected through
 * existing skills and the review prompt. This release-time check protects that
 * wiring and the non-authoritative shadow boundary. It deliberately performs no
 * semantic analysis of target-project source or architecture.
 */
async function validateEngineeringQualityPolicy(root) {
  const flat = (value) => value.replace(/\s+/g, " ");
  const policyPath = "plugins/banzai/policies/engineering-quality.md";
  const policyRaw = await readText(root, policyPath);
  const headingCount = policyRaw
    .split("\n")
    .filter((line) => line === "## Engineering Quality").length;
  if (headingCount !== 1) {
    fail(
      "ENGINEERING_QUALITY_POLICY_DRIFT",
      policyPath,
      `expected exactly one "## Engineering Quality" heading, found ${headingCount}`
    );
  }
  const policyHeading = "## Engineering Quality";
  const policyStart = policyRaw.indexOf(`${policyHeading}\n`);
  const nextHeading = policyRaw.indexOf(
    "\n## ",
    policyStart + policyHeading.length
  );
  const policySectionRaw = policyRaw.slice(
    policyStart,
    nextHeading < 0 ? policyRaw.length : nextHeading
  );
  const policySection = flat(policySectionRaw);

  const expectedRuleIds = Array.from(
    { length: 10 },
    (_, index) => `EQ-${String(index + 1).padStart(2, "0")}`
  );
  const ruleHeadingIds = [
    ...policySectionRaw.matchAll(/^### (EQ-\d{2}) — /gm)
  ].map((match) => match[1]);
  if (
    ruleHeadingIds.length !== expectedRuleIds.length ||
    ruleHeadingIds.some((ruleId, index) => ruleId !== expectedRuleIds[index])
  ) {
    fail(
      "ENGINEERING_QUALITY_POLICY_DRIFT",
      policyPath,
      `expected ordered rule headings ${expectedRuleIds.join(", ")}; found ${ruleHeadingIds.join(", ") || "none"}`
    );
  }

  const requiredPolicyFragments = [
    "This policy is vendor-neutral. The installed `policies/engineering-quality.md` is only its current storage and delivery surface",
    "Future Codex or other-vendor delivery must preserve these semantics",
    "Do not introduce dependency edges that violate the repository's intended dependency direction or unnecessarily couple stable logic to volatile implementation details",
    "It assumes no domain-centric architecture",
    "Material claims introduced by a change must have an identifiable, proportionate evidence owner",
    "Engineering Quality detects missing assurance ownership; it does not select tests",
    "complete the ordinary review first and freeze its findings, severities, and verdict",
    "only as an `EQ-SHADOW:` string in existing free-form `deferredCoverage`",
    "not a finding, receives no mandatory human triage, cannot be accepted, never enters fixer scope",
    "copy every structured `EQ-SHADOW:` record byte-for-byte into the canonical Markdown Deferred Coverage section",
    "Resolution review is closure-oriented, not discovery-oriented",
    "Rejected or deferred findings must not reopen against unchanged evidence and authority",
    "The initial release adds no EQ-native runtime blocker",
    "`EQ-02`, `EQ-06`, and `EQ-10` never create blockers by themselves",
    "Any later blocker-eligibility proposal must require high confidence",
    "Meeting this threshold does not authorize hard enforcement; a separate approved decision is still required"
  ];
  for (const fragment of requiredPolicyFragments) {
    if (!policySection.includes(fragment)) {
      fail(
        "ENGINEERING_QUALITY_POLICY_DRIFT",
        policyPath,
        `missing required policy fragment: ${fragment}`
      );
    }
  }

  const authorityFragments = [
    "explicit approved user or specification decision",
    "accepted ADR",
    "executable or public contracts and established repository invariants",
    "`PROJECT_MANIFEST.md` facts and dominant local conventions",
    "generic Engineering Quality preference"
  ];
  const authorityRaw = await readText(root, "plugins/banzai/AGENTS.md");
  const authoritySectionMatch = authorityRaw.match(
    /## Authority\n([\s\S]*?)\n## Execution Modes/
  );
  const authoritySection = flat(authoritySectionMatch?.[1] ?? "");
  const authorityStart = authoritySection.indexOf(
    "Resolve implementation and review conflicts in this order:"
  );
  let priorIndex = authorityStart;
  for (const fragment of authorityFragments) {
    const index = authoritySection.indexOf(fragment, priorIndex + 1);
    if (authorityStart < 0 || index < 0 || index <= priorIndex) {
      fail(
        "ENGINEERING_QUALITY_POLICY_DRIFT",
        policyPath,
        `authority precedence is missing or out of order at: ${fragment}`
      );
    }
    priorIndex = index;
  }
  const legacyTestBoundary =
    "A legacy test does not automatically override an approved change that intentionally changes behavior";
  if (!authoritySection.includes(legacyTestBoundary)) {
    fail(
      "ENGINEERING_QUALITY_POLICY_DRIFT",
      policyPath,
      `missing required authority fragment: ${legacyTestBoundary}`
    );
  }

  const reference =
    "canonical Engineering Quality policy in the installed `policies/engineering-quality.md`";
  const consumingSkills = [
    "plugins/banzai/skills/project-manifest/SKILL.md",
    "plugins/banzai/skills/feature-description/SKILL.md",
    "plugins/banzai/skills/architecture-decision/SKILL.md",
    "plugins/banzai/skills/development-plan/SKILL.md",
    "plugins/banzai/skills/code-writing/SKILL.md",
    "plugins/banzai/skills/feature/SKILL.md",
    "plugins/banzai/skills/quick-fix/SKILL.md",
    "plugins/banzai/skills/feature-review/SKILL.md"
  ];
  for (const relativePath of consumingSkills) {
    const contents = flat(await instructionConsumerText(root, relativePath));
    if (!contents.includes(reference)) {
      fail(
        "ENGINEERING_QUALITY_POLICY_DRIFT",
        relativePath,
        `missing required reference: ${reference}`
      );
    }
    const copiedRuleIds = new Set(
      contents
        .match(/\bEQ-\d{2}\b/g)
        ?.filter((item) => expectedRuleIds.includes(item)) ?? []
    );
    if (expectedRuleIds.every((ruleId) => copiedRuleIds.has(ruleId))) {
      fail(
        "ENGINEERING_QUALITY_POLICY_DRIFT",
        relativePath,
        "consuming skill copies the complete EQ-01 through EQ-10 rule set"
      );
    }
  }

  const reviewPath = "plugins/banzai/skills/feature-review/SKILL.md";
  const review = flat(await instructionConsumerText(root, reviewPath));
  for (const fragment of [
    "Freeze the ordinary findings, severities, and verdict",
    "only as one `EQ-SHADOW:` string in existing free-form `deferredCoverage`",
    "cannot affect ordinary findings, severity, verdict, mandatory human triage, accepted scope, fixing, completion, or a gate",
    "Preserve every `EQ-SHADOW:` entry as",
    "Do not reopen rejected or deferred concerns against unchanged evidence and authority",
    "No EQ-specific field is mandatory in the review-result contract"
  ]) {
    if (!review.includes(fragment)) {
      fail(
        "ENGINEERING_QUALITY_POLICY_DRIFT",
        reviewPath,
        `missing required shadow or resolution fragment: ${fragment}`
      );
    }
  }

  const promptPath = "packages/orchestrator/src/prompts.ts";
  const prompt = flat(await readText(root, promptPath));
  for (const fragment of [
    "canonical vendor-neutral Engineering Quality policy from the supplied Engineering Quality policy",
    "freeze ordinary findings, their severities, and the verdict",
    "only as an EQ-SHADOW: string in existing free-form deferredCoverage",
    "additional review prose in reviewNotes",
    "It must not enter findings",
    "Resolution review is closure-oriented, not discovery-oriented",
    "Do not reopen rejected or deferred concerns against unchanged evidence and authority"
  ]) {
    if (!prompt.includes(fragment)) {
      fail(
        "ENGINEERING_QUALITY_POLICY_DRIFT",
        promptPath,
        `missing required prompt fragment: ${fragment}`
      );
    }
  }
}

/**
 * ADR-0031 adds one conditional planning gate without weakening any later
 * human authority. Protect the shared policy, prompt, public docs/help, privacy
 * canaries, and version declarations as one release-time consistency surface.
 */
const CODE_DESIGN_METHOD = "plugins/banzai/guidance/code-design.md";
const CODE_DESIGN_SECTIONS = [
  "Ownership Discovery",
  "Assessment Contract",
  "Planning Assessment",
  "Implementation Assessment"
];
// ADR-0050 section 2: the method is shared by its consumers and withheld from
// the audit, so both its shape and its reach are release-enforced.
const CODE_DESIGN_CONSUMERS = [
  [
    "plugins/banzai/skills/development-plan/SKILL.md",
    ["ownership-discovery", "assessment-contract", "planning-assessment"]
  ],
  [
    "plugins/banzai/skills/code-writing/SKILL.md",
    ["ownership-discovery", "assessment-contract", "implementation-assessment"]
  ],
  [
    "plugins/banzai/skills/feature/SKILL.md",
    [
      "ownership-discovery",
      "assessment-contract",
      "planning-assessment",
      "implementation-assessment"
    ]
  ],
  [
    "plugins/banzai/skills/quick-fix/SKILL.md",
    [
      "ownership-discovery",
      "assessment-contract",
      "planning-assessment",
      "implementation-assessment"
    ]
  ],
  ["plugins/banzai/skills/project-manifest/SKILL.md", ["ownership-discovery"]]
];
const CODE_DESIGN_EXCLUDED = [
  "plugins/banzai/guidance/review.md",
  "plugins/banzai/skills/feature-review/SKILL.md",
  "plugins/banzai/skills/test-writing/SKILL.md"
];

async function validateCodeDesignAssessment(root) {
  const policyPath = "plugins/banzai/policies/engineering-quality.md";
  const policyRaw = await readText(root, policyPath);
  const triggerCount = policyRaw
    .split("\n")
    .filter((line) => line === "### Structural Assessment Triggers").length;
  if (triggerCount !== 1) {
    fail(
      "CODE_DESIGN_POLICY_DRIFT",
      policyPath,
      `expected exactly one "### Structural Assessment Triggers" heading, found ${triggerCount}`
    );
  }

  const method = await readText(
    root,
    CODE_DESIGN_METHOD,
    "MISSING_CODE_DESIGN_METHOD"
  );
  const bytes = Buffer.byteLength(method, "utf8");
  if (bytes > 2400) {
    fail(
      "CODE_DESIGN_METHOD_DRIFT",
      CODE_DESIGN_METHOD,
      `method budget is 2400 UTF-8 bytes; found ${bytes}`
    );
  }
  const sections = [...method.matchAll(/^## (.+)$/gm)].map((match) =>
    match[1].trim()
  );
  if (
    sections.length !== CODE_DESIGN_SECTIONS.length ||
    sections.some((title, index) => title !== CODE_DESIGN_SECTIONS[index])
  ) {
    fail(
      "CODE_DESIGN_METHOD_DRIFT",
      CODE_DESIGN_METHOD,
      `expected ordered sections ${CODE_DESIGN_SECTIONS.join(", ")}; found ${sections.join(", ") || "none"}`
    );
  }

  for (const [consumerPath, anchors] of CODE_DESIGN_CONSUMERS) {
    const consumer = flatText(await readText(root, consumerPath));
    for (const required of anchors) {
      if (!consumer.includes(`../../guidance/code-design.md#${required}`)) {
        fail(
          "CODE_DESIGN_CONSUMER_DRIFT",
          consumerPath,
          `missing code-design.md#${required} reference`
        );
      }
    }
  }
  for (const excludedPath of CODE_DESIGN_EXCLUDED) {
    if ((await readText(root, excludedPath)).includes("code-design.md")) {
      fail(
        "CODE_DESIGN_CONSUMER_DRIFT",
        excludedPath,
        "audit and assurance instructions must not reference code-design.md"
      );
    }
  }
}

async function validateDecisionConsultationPolicy(root) {
  const requiredFragments = new Map([
    [
      "plugins/banzai/policies/decision-consultation.md",
      [
        "## Decision Consultation",
        "gate=decision_consultation",
        "Do not write a Proposed ADR or plan that selects an option while its prerequisite consultation is unanswered.",
        "Consultation is not approval or permission."
      ]
    ],
    [
      "plugins/banzai/AGENTS.md",
      ["There are five existing gates:", "The hook is a backstop"]
    ],
    [
      "plugins/banzai/skills/feature-description/SKILL.md",
      [
        "relevant source, tests, and documentation",
        "repository-relative evidence",
        "Never select or infer the human answer.",
        "decision provenance, not approval or broader authority",
        "Do not create a Proposed ADR or plan that selects an option"
      ]
    ],
    [
      "plugins/banzai/skills/architecture-decision/SKILL.md",
      [
        "return the planning-only `decision_consultation` gate",
        "Do not write a Proposed ADR that selects an option",
        "separate non-authorizing prerequisite"
      ]
    ],
    [
      "plugins/banzai/skills/development-plan/SKILL.md",
      [
        "contracts/v4/phase-result.schema.json",
        "before drafting a plan or Proposed ADR",
        "Consultation is conditional and planning-only",
        "one of the five existing decision gates",
        "only gate that authorizes the exact bundle for code work"
      ]
    ],
    [
      "plugins/banzai/skills/code-writing/SKILL.md",
      ["contracts/v4/phase-result.schema.json", "decisionConsultation: null"]
    ],
    [
      "plugins/banzai/skills/test-writing/SKILL.md",
      ["contracts/v4/phase-result.schema.json", "decisionConsultation: null"]
    ],
    [
      "plugins/banzai/skills/feature/SKILL.md",
      [
        "contracts/v4/phase-result.schema.json",
        "decisionConsultation: null",
        "cannot use the planning-only consultation gate"
      ]
    ],
    [
      "plugins/banzai/skills/quick-fix/SKILL.md",
      ["contracts/v4/phase-result.schema.json", "decisionConsultation: null"]
    ],
    [
      "packages/orchestrator/src/prompts.ts",
      [
        "Inspect the current repository and existing project evidence before deciding that human input is needed.",
        "stop before authoring a Proposed ADR or plan that selects an option",
        "gate=decision_consultation",
        "Do not repeat an answered decisionId or ask the same unchanged question",
        "never reinterpret them as approval, permission, or broader authority",
        "decision consultation never accepts an ADR"
      ]
    ],
    [
      "README.md",
      [
        "There are five existing decision gates",
        "Consultation is conditional, planning-only, and concise",
        "it does not accept an ADR, approve a plan",
        "control contract `8.0.0`"
      ]
    ],
    [
      "documentation/orchestrator.md",
      [
        "workflow's five existing decision gates",
        "banzai-agent-capabilities/v8",
        "banzai-agent-status/v6",
        "banzai-agent-answer/v2",
        "A v1 answer cannot answer a consultation.",
        "New runs start at schema version 10",
        "State 10 carries the completion publication cursor from creation.",
        "The model hand-off uses phase-result v4.",
        "phase-result v1 and v2 remain read-only legacy inputs",
        "Evaluation export and KPI stay on their independent privacy-minimized v1 contracts."
      ]
    ],
    [
      "packages/orchestrator/src/cli.ts",
      [
        "Consultation records preferences; it does not approve a plan or ADR.",
        "banzai-agent-answer/v2",
        "banzai-agent-answer/v1"
      ]
    ],
    [
      "PROJECT_MANIFEST.md",
      [
        "the five existing decision gates",
        "five existing workflow gates",
        "phase-result schema v4 and state schema v10 with explicit historical readers",
        "control contract version `8.0.0`",
        "phase-result v4 is current",
        "phase-result v1/v2/v3 remain byte-preserved legacy reader surfaces"
      ]
    ],
    [
      "plugins/banzai/contracts/README.md",
      [
        "v2/phase-result.schema.json` is the preserved legacy",
        "v4/phase-result.schema.json` is the current hand-off",
        "planning-only `decision_consultation` gate"
      ]
    ],
    [
      "plugins/banzai/documentation/README.md",
      [
        "v2/phase-result.schema.json # legacy task-completion attempts",
        "v4/phase-result.schema.json # current task-verification phase hand-off",
        "v4 implementation results carry the canonical per-task completion ledger",
        "required nullable planning-only consultation field"
      ]
    ],
    [
      "plugins/banzai/hooks/README.md",
      [
        "adds no",
        "configuration_prerequisite",
        "Historical format recognition does not authorize old-run continuation."
      ]
    ],
    [
      "documentation/release-checklist.md",
      ["Confirm all five existing Banzai human decision gates"]
    ],
    [
      "documentation/decisions/README.md",
      [
        "0031-interactive-decision-consultation.md",
        "Interactive decision consultation",
        "Accepted"
      ]
    ],
    [
      "packages/orchestrator/test/workflow-skills.test.ts",
      [
        "shipped workflow preserves five gates and scopes retained configuration formats as legacy",
        "assertSupervisorSafety",
        "May choose and rewrite"
      ]
    ],
    [
      "packages/orchestrator/test/workflow.test.ts",
      [
        "decision.consultation.requested",
        "decision.consultation.answered",
        "answerModes: { option: 0, preference: 1 }",
        "packages/orchestrator/src/store.ts"
      ]
    ],
    [
      "packages/orchestrator/test/agent-control.test.ts",
      [
        "status projection excludes completed consultation history",
        "HISTORICAL QUESTION CANARY",
        "HISTORICAL ANSWER CANARY",
        "HISTORICAL DECIDER CANARY"
      ]
    ],
    [
      "packages/orchestrator/test/evaluation.test.ts",
      [
        "FORBIDDEN-CONSULTATION-QUESTION",
        "FORBIDDEN-CONSULTATION-OPTION",
        "FORBIDDEN-CONSULTATION-RECOMMENDATION",
        "FORBIDDEN-CONSULTATION-ANSWER",
        "FORBIDDEN-CONSULTATION-DECIDER",
        "FORBIDDEN-EVENT-CONSULTATION-ANSWER",
        "banzai-evaluation-export/v1",
        "banzai-evaluation-kpi/v1"
      ]
    ],
    [
      "packages/orchestrator/scripts/smoke-committed.mjs",
      [
        "setupConsultationRun",
        "banzai-agent-capabilities/v8",
        "banzai-agent-status/v6",
        "answer_consultation",
        "banzai-agent-answer/v2",
        "consultation lifecycle events are not count-only",
        "evaluation leaked consultation history"
      ]
    ],
    [
      "packages/orchestrator/test/committed-smoke.test.ts",
      [
        "banzai-agent-capabilities/v8",
        "banzai-agent-status/v6",
        "control answer --by Smoke User --no-resume",
        "decision.consultation.answered"
      ]
    ]
  ]);
  for (const [relativePath, fragments] of requiredFragments) {
    const contents = flatText(
      await instructionConsumerText(root, relativePath)
    );
    for (const fragment of fragments) {
      if (!contents.includes(fragment)) {
        fail(
          "DECISION_CONSULTATION_POLICY_DRIFT",
          relativePath,
          `missing required consultation fragment: ${fragment}`
        );
      }
    }
  }

  for (const relativePath of [
    "README.md",
    "packages/orchestrator/README.md",
    "documentation/orchestrator.md",
    "PROJECT_MANIFEST.md",
    "plugins/banzai/documentation/README.md",
    "plugins/banzai/hooks/README.md",
    "documentation/release-checklist.md"
  ]) {
    const contents = flatText(
      await instructionConsumerText(root, relativePath)
    );
    if (/four (?:human )?(?:decision )?gates/i.test(contents)) {
      fail(
        "DECISION_CONSULTATION_POLICY_DRIFT",
        relativePath,
        "current product documentation still claims four human gates"
      );
    }
  }
}

async function validateOrchestrateSkill(root) {
  const requiredFragments = new Map([
    [
      "plugins/banzai/skills/orchestrate/SKILL.md",
      [
        "name: orchestrate",
        "user-invocable: true",
        "disable-model-invocation: true",
        "never select it from prompt wording alone",
        "only when the user invokes it explicitly by name",
        "BANZAI_RUN_ID",
        "BANZAI_APPROVAL_DIGEST",
        "BANZAI_WORKFLOW_DIGEST",
        "banzai control capabilities",
        "banzai control status",
        "exact supported v8 declaration",
        "banzai-agent-request/v1",
        "banzai-agent-answer/v2",
        "banzai-agent-answer/v1",
        "banzai-agent-recovery/v1",
        "answer_escalation",
        "answer_consultation",
        "Never select, infer, rewrite, summarize into an answer, or fill a missing card.",
        "A consultation answer records preference provenance only.",
        "with writable stdin, write the complete document",
        "A terminal `done` or `cancelled` projection does not block a new run.",
        "Never run `banzai cancel` without an explicit current user decision.",
        "CLAUDE_AUTH_UNAVAILABLE_IN_SANDBOX",
        "Do not call `done` alone complete.",
        "Never convert a `null` completion count to zero"
      ]
    ],
    [
      "plugins/banzai/skills/orchestrate/agents/openai.yaml",
      [
        'display_name: "Banzai Orchestrate"',
        'default_prompt: "Use $banzai:orchestrate',
        "allow_implicit_invocation: false"
      ]
    ],
    [
      "plugins/banzai/skills/orchestrate/references/control-protocol.md",
      [
        "banzai-agent-capabilities/v8",
        "banzai-agent-status/v6",
        "banzai-agent-gate-decision/v1",
        "banzai-agent-answer/v4",
        "answer_planning_review_triage",
        "raw UTF-8 JSON",
        "CONTROL_INPUT_TOO_LARGE",
        'controlContractVersion: "8.0.0"',
        "banzai-agent-request/v1",
        "banzai-agent-answer/v2",
        "banzai-agent-answer/v1",
        "banzai-agent-recovery/v1",
        "input limit is 64 KiB",
        "live-session/write-stdin mechanism",
        "Only a non-terminal `activeRun` blocks `control start`.",
        "| `approve_adr` |",
        "| `approve_plan` |",
        "| `answer_escalation` |",
        "| `answer_consultation` |",
        "| `triage` |",
        "| `retry` |",
        "| `recover` |",
        "| `cancel` |"
      ]
    ]
  ]);
  for (const [relativePath, fragments] of requiredFragments) {
    const contents = flatText(await readText(root, relativePath));
    for (const fragment of fragments) {
      if (!contents.includes(fragment)) {
        fail(
          "ORCHESTRATE_SKILL_POLICY_DRIFT",
          relativePath,
          `missing required policy fragment: ${fragment}`
        );
      }
    }
  }
}

async function validateRepository(root) {
  const policy = validatePolicyShape(
    await readJson(root, "release-policy.json")
  );
  await validateNoVersionTransaction(root, policy);
  await validateRequiredPaths(root, policy);

  for (const relativePath of array(
    policy.plugin.jsonDocuments,
    "release-policy.json",
    "plugin.jsonDocuments"
  )) {
    await readJson(root, relativePath);
  }

  const claudePluginPath = "plugins/banzai/.claude-plugin/plugin.json";
  const codexPluginPath = "plugins/banzai/.codex-plugin/plugin.json";
  validatePluginManifest(
    await readJson(root, claudePluginPath),
    claudePluginPath,
    "claude"
  );
  validatePluginManifest(
    await readJson(root, codexPluginPath),
    codexPluginPath,
    "codex"
  );
  validateCodexMarketplace(
    await readJson(root, "marketplace.json"),
    "marketplace.json"
  );
  validateCodexMarketplace(
    await readJson(root, ".agents/plugins/marketplace.json"),
    ".agents/plugins/marketplace.json"
  );
  validateClaudeMarketplace(
    await readJson(root, ".claude-plugin/marketplace.json"),
    ".claude-plugin/marketplace.json"
  );

  const rootPackage = record(
    await readJson(root, "package.json"),
    "package.json",
    "package"
  );
  const expectedReleaseVersion = semanticVersion(
    rootPackage.version,
    "package.json",
    "project version"
  );
  // Runs before the resource and distribution parity checks, which would
  // otherwise report a hook edit without naming the missing version bump.
  await validateHookRuntimeVersion(root, expectedReleaseVersion);
  const versions = [];
  for (const source of array(
    policy.plugin.versionMirrors,
    "release-policy.json",
    "plugin.versionMirrors"
  )) {
    const entry = record(source, "release-policy.json", "version source");
    const relativePath = nonEmptyString(
      entry.path,
      "release-policy.json",
      "version source path"
    );
    const value = pointerValue(
      await readJson(root, relativePath),
      nonEmptyString(
        entry.pointer,
        "release-policy.json",
        "version source pointer"
      ),
      relativePath
    );
    versions.push([
      relativePath,
      entry.pointer,
      semanticVersion(value, relativePath, "plugin version mirror")
    ]);
  }
  await validateHook(root);
  await validateContracts(root, policy);
  await validateTestAssurancePolicy(root);
  await validateInstructionLayout(root);
  await validateSecurityAssurancePolicy(root);
  await validateEngineeringQualityPolicy(root);
  await validateDecisionConsultationPolicy(root);
  await validateOrchestrateSkill(root);
  try {
    await validateGuidanceExtraction(root);
  } catch {
    fail(
      "INSTRUCTION_RESOURCE_DRIFT",
      "plugins/banzai",
      "Canonical instruction resources, extraction evidence or consumer boundaries differ."
    );
  }

  const rootScripts = record(rootPackage.scripts, "package.json", "scripts");
  requireExact(
    rootScripts["version:set"],
    "node packages/orchestrator/scripts/version-set.mjs",
    "INVALID_RELEASE_POLICY",
    "package.json",
    "version:set script"
  );
  requireExact(
    rootScripts["version:recover"],
    "node packages/orchestrator/scripts/version-recover.mjs",
    "INVALID_RELEASE_POLICY",
    "package.json",
    "version:recover script"
  );
  const packageEngines = record(rootPackage.engines, "package.json", "engines");
  requireExact(
    packageEngines.node,
    policy.node.engines,
    "NODE_POLICY_DRIFT",
    "package.json",
    "engines.node"
  );
  const orchestratorPath = policy.orchestrator.packageVersionMirror;
  const orchestrator = record(
    await readJson(root, orchestratorPath),
    orchestratorPath,
    "package"
  );
  requireExact(
    record(orchestrator.engines, orchestratorPath, "engines").node,
    policy.node.engines,
    "NODE_POLICY_DRIFT",
    orchestratorPath,
    "engines.node"
  );
  requireExact(
    record(orchestrator.bin, orchestratorPath, "bin").banzai,
    "dist/banzai.mjs",
    "INVALID_ORCHESTRATOR_ENTRY",
    orchestratorPath,
    "bin.banzai"
  );
  const packageFiles = array(orchestrator.files, orchestratorPath, "files");
  if (!packageFiles.includes("dist/")) {
    fail(
      "INVALID_ORCHESTRATOR_ENTRY",
      orchestratorPath,
      "files must include dist/"
    );
  }
  const orchestratorVersion = semanticVersion(
    orchestrator.version,
    orchestratorPath,
    "version"
  );
  versions.push([orchestratorPath, "/version", orchestratorVersion]);
  const lockfile = await readJson(root, policy.orchestrator.lockfileMirror);
  const lockfileVersion = semanticVersion(
    pointerValue(
      lockfile,
      policy.orchestrator.lockfileVersionPointer,
      policy.orchestrator.lockfileMirror
    ),
    policy.orchestrator.lockfileMirror,
    "workspace version"
  );
  versions.push([
    policy.orchestrator.lockfileMirror,
    policy.orchestrator.lockfileVersionPointer,
    lockfileVersion
  ]);
  for (const mirror of policy.project.lockfileMirrors) {
    versions.push([
      mirror.path,
      mirror.pointer,
      semanticVersion(
        pointerValue(lockfile, mirror.pointer, mirror.path),
        mirror.path,
        mirror.pointer
      )
    ]);
  }
  for (const [relativePath, pointer, version] of versions) {
    if (version !== expectedReleaseVersion) {
      fail(
        "RELEASE_TRAIN_VERSION_MISMATCH",
        relativePath,
        `version at ${pointer} differs from root package.json /version (${expectedReleaseVersion})`
      );
    }
  }
  requireExact(
    pointerValue(lockfile, "/packages//engines/node", "package-lock.json"),
    policy.node.engines,
    "NODE_POLICY_DRIFT",
    "package-lock.json",
    "root lockfile engines"
  );
  requireExact(
    pointerValue(
      lockfile,
      "/packages/packages~1orchestrator/engines/node",
      "package-lock.json"
    ),
    policy.node.engines,
    "NODE_POLICY_DRIFT",
    "package-lock.json",
    "workspace lockfile engines"
  );

  const bundlePath = nonEmptyString(
    policy.distribution.bundle,
    "release-policy.json",
    "distribution.bundle"
  );
  const sourceMapPath = nonEmptyString(
    policy.distribution.sourceMap,
    "release-policy.json",
    "distribution.sourceMap"
  );
  await access(repositoryPath(root, bundlePath)).catch(() =>
    fail(
      "STALE_DISTRIBUTION",
      bundlePath,
      "built bundle is missing; run npm run build:dist"
    )
  );
  await access(repositoryPath(root, sourceMapPath)).catch(() =>
    fail(
      "STALE_DISTRIBUTION",
      sourceMapPath,
      "built source map is missing; run npm run build:dist"
    )
  );
  const bundleStat = await lstat(repositoryPath(root, bundlePath));
  const actualMode = bundleStat.mode & 0o777;
  const expectedMode = Number.parseInt(policy.distribution.mode, 8);
  if (!bundleStat.isFile() || actualMode !== expectedMode) {
    fail(
      "NON_EXECUTABLE_DISTRIBUTION",
      bundlePath,
      "built bundle mode must be 0755"
    );
  }

  for (const scriptPath of [
    "packages/orchestrator/scripts/build.mjs",
    "packages/orchestrator/scripts/check-dist.mjs"
  ]) {
    const contents = await readText(root, scriptPath);
    if (!contents.includes(`target: "${policy.node.buildTarget}"`)) {
      fail("NODE_POLICY_DRIFT", scriptPath, "build target differs from policy");
    }
  }

  await validateCodeDesignAssessment(root);
  await validateDistributionParity(root);
  await validateCi(root, policy);
  await validatePublish(root, policy);
  await validateDocumentation(root, policy);
}

try {
  await validateRepository(parseArguments(process.argv.slice(2)));
  process.stdout.write("release validation passed\n");
} catch (error) {
  const message =
    error instanceof ReleaseValidationError
      ? error.message
      : "RELEASE_VALIDATION_FAILED check-release.mjs: unexpected validation failure";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
