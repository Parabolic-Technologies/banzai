import { validateConfigurationStateEnvelope } from "./configuration-prerequisite.js";
import { constants } from "node:fs";
import { access, lstat, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  resolveClaudeInvocationScope,
  vendorFor,
  FALLBACK_VENDOR,
  MODEL_ROLES,
  type ResolvedClaudeInvocationScope
} from "./adapters.js";
import {
  claudePermissionRemediation,
  inspectClaudePermissions,
  inspectConfiguredClaudePermissions,
  type ClaudePermissionAudit,
  type ClaudePermissionInput
} from "./claude-permissions.js";
import { CONFIG_FILE } from "./config.js";
import {
  adoptionDiagnostic,
  inspectProjectAdoption
} from "./project-adoption.js";
import { assertContractParity } from "./contracts.js";
import {
  combineInstructionParity,
  inspectRoleInstructionParity,
  instructionParityFixes,
  instructionParityDiagnostic,
  instructionPhasesForRole
} from "./phase-instructions.js";
import { CONTRACT_VERSION } from "./types.js";
import type {
  ClaudeEnvironmentSettings,
  OrchestratorConfig,
  RunStatus,
  VerificationProjectType
} from "./types.js";
import { inspectBoundWork } from "./work-documents.js";
import type { ArtifactBoundWork } from "./work-documents.js";
import { parseConfig } from "./validation.js";
import { inspectVerificationProject } from "./verification.js";

export type DoctorCheckCategory =
  | "repository"
  | "runtime"
  | "config"
  | "verification"
  | "executables"
  | "run-state";

export type DoctorCheckStatus = "pass" | "warning" | "fail" | "skipped";

export interface DoctorCheck {
  id: string;
  category: DoctorCheckCategory;
  status: DoctorCheckStatus;
  message: string;
  fixes: DoctorFix[];
  roles: DoctorInstructionRole[];
}

export interface DoctorFix {
  action: string;
  documentation: string;
}

export interface DoctorInstructionRole {
  role: "planner" | "implementer" | "reviewer";
  vendor: "codex" | "claude";
  state:
    | "not_applicable"
    | "verified"
    | "mismatch"
    | "bounded_failure"
    | "unverifiable";
  resourceIds: string[];
  mismatched: string[];
  unavailable: string[];
  fixes: DoctorFix[];
}

export interface DoctorSummary {
  passed: number;
  warnings: number;
  failed: number;
  skipped: number;
}

export interface DoctorReport {
  schema: "banzai-doctor/v5";
  schemaVersion: 5;
  ready: boolean;
  projectTypes: VerificationProjectType[];
  summary: DoctorSummary;
  checks: DoctorCheck[];
}

export interface DoctorDependencies {
  executableAvailable(
    command: string,
    cwd: string,
    env: NodeJS.ProcessEnv
  ): Promise<boolean>;
  processAlive(pid: number): "live" | "stale";
  resolveClaudeInvocationScope?(
    settings: ClaudeEnvironmentSettings
  ): Promise<ResolvedClaudeInvocationScope>;
  inspectClaudePermissions?(
    input: ClaudePermissionInput
  ): Promise<ClaudePermissionAudit>;
}

const RUN_STATUSES = new Set<RunStatus>([
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
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function executableCandidates(
  command: string,
  cwd: string,
  env: NodeJS.ProcessEnv
): string[] {
  if (command.includes(path.sep)) {
    return [path.resolve(cwd, command)];
  }
  if (env.PATH === undefined) {
    return [];
  }
  return env.PATH.split(path.delimiter).map((entry) =>
    path.join(
      entry.length === 0 || !path.isAbsolute(entry)
        ? path.resolve(cwd, entry)
        : entry,
      command
    )
  );
}

async function executableAvailable(
  command: string,
  cwd: string,
  env: NodeJS.ProcessEnv
): Promise<boolean> {
  for (const candidate of executableCandidates(command, cwd, env)) {
    try {
      await access(candidate, constants.X_OK);
      if ((await stat(candidate)).isFile()) {
        return true;
      }
    } catch {
      // Continue through PATH candidates.
    }
  }
  return false;
}

function processAlive(pid: number): "live" | "stale" {
  try {
    process.kill(pid, 0);
    return "live";
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM" ? "live" : "stale";
  }
}

const DEFAULT_DEPENDENCIES: DoctorDependencies = {
  executableAvailable,
  processAlive
};

function check(
  id: string,
  category: DoctorCheckCategory,
  status: DoctorCheckStatus,
  message: string,
  fixes: DoctorFix[] = [],
  roles: DoctorInstructionRole[] = []
): DoctorCheck {
  return { id, category, status, message, fixes, roles };
}

function summary(checks: readonly DoctorCheck[]): DoctorSummary {
  return {
    passed: checks.filter((item) => item.status === "pass").length,
    warnings: checks.filter((item) => item.status === "warning").length,
    failed: checks.filter((item) => item.status === "fail").length,
    skipped: checks.filter((item) => item.status === "skipped").length
  };
}

function isMissingFile(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

async function readBoundedFile(
  filePath: string,
  boundaryPath: string,
  repoRoot: string
): Promise<string> {
  let resolvedRoot: string;
  try {
    resolvedRoot = await realpath(repoRoot);
  } catch {
    throw new Error("repository root cannot be resolved");
  }

  const lexicalRoot = path.resolve(repoRoot);
  const lexicalBoundary = path.resolve(boundaryPath);
  const relativeBoundary = path.relative(lexicalRoot, lexicalBoundary);
  if (
    relativeBoundary.length === 0 ||
    relativeBoundary === ".." ||
    relativeBoundary.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeBoundary)
  ) {
    throw new Error("control boundary is outside the repository");
  }

  // Resolve the boundary before the optional file so a present but escaped or
  // dangling control root never collapses into the healthy "absent" case.
  await lstat(boundaryPath);
  let resolvedBoundary: string;
  try {
    resolvedBoundary = await realpath(boundaryPath);
    const boundaryStat = await stat(resolvedBoundary);
    if (
      resolvedBoundary !== path.resolve(resolvedRoot, relativeBoundary) ||
      !boundaryStat.isDirectory()
    ) {
      throw new Error("control boundary escapes the repository");
    }
  } catch {
    throw new Error("control boundary cannot be resolved safely");
  }

  // Preserve the difference between no control entry and an existing dangling
  // or otherwise unreadable final symlink. Callers treat only the former as
  // absent.
  await lstat(filePath);
  let resolvedFile: string;
  try {
    resolvedFile = await realpath(filePath);
  } catch {
    throw new Error("control file cannot be resolved");
  }
  if (
    resolvedFile !== resolvedBoundary &&
    !resolvedFile.startsWith(`${resolvedBoundary}${path.sep}`)
  ) {
    throw new Error("control file escapes its boundary");
  }
  return await readFile(resolvedFile, "utf8");
}

function configVersionCheck(document: unknown): DoctorCheck {
  if (!isRecord(document)) {
    return check(
      "config.version",
      "config",
      "skipped",
      "Configuration version cannot be checked until JSON is readable."
    );
  }
  if (document.contractVersion !== CONTRACT_VERSION) {
    return check(
      "config.version",
      "config",
      "fail",
      "Configuration uses an unsupported contract version."
    );
  }
  if (document.schemaVersion === 1) {
    return check(
      "config.version",
      "config",
      "fail",
      "Configuration schema version 1 is legacy and requires manual migration."
    );
  }
  if (
    document.schemaVersion !== 2 &&
    document.schemaVersion !== 3 &&
    document.schemaVersion !== 4
  ) {
    return check(
      "config.version",
      "config",
      "fail",
      "Configuration uses an unsupported schema version."
    );
  }
  return check(
    "config.version",
    "config",
    "pass",
    `Configuration uses schema version ${document.schemaVersion} and the supported contract version.`
  );
}

async function claudeEnvironmentCheck(
  config: OrchestratorConfig | null,
  dependencies: DoctorDependencies
): Promise<DoctorCheck> {
  if (config === null) {
    return check(
      "claude.environment",
      "config",
      "skipped",
      "Claude environment inspection requires a valid configuration."
    );
  }
  if (config.claudeEnvironment.mode === "ambient") {
    return check(
      "claude.environment",
      "config",
      "warning",
      "Claude environment mode is explicitly ambient; spawned sessions may load operator MCP servers, settings, plugins, skills, and commands."
    );
  }
  try {
    const resolved = await (
      dependencies.resolveClaudeInvocationScope ?? resolveClaudeInvocationScope
    )(config.claudeEnvironment);
    return resolved.degradedReason === null
      ? check(
          "claude.environment",
          "config",
          "pass",
          "Claude environment is scoped and the required Banzai plugin surface is verified."
        )
      : check(
          "claude.environment",
          "config",
          "warning",
          "Claude environment is limited to MCP-only isolation because the packaged Banzai plugin could not be verified; setting-source discovery remains ambient."
        );
  } catch {
    return check(
      "claude.environment",
      "config",
      "fail",
      "The explicitly configured Banzai plugin directory cannot be verified; model invocation will fail closed."
    );
  }
}

async function claudeInstructionsCheck(
  config: OrchestratorConfig | null,
  dependencies: DoctorDependencies
): Promise<DoctorCheck> {
  if (config === null)
    return check(
      "claude.instructions",
      "config",
      "skipped",
      "Instruction comparison is skipped without a valid configuration."
    );
  let directory: string | null;
  try {
    const resolved = await (
      dependencies.resolveClaudeInvocationScope ?? resolveClaudeInvocationScope
    )(config.claudeEnvironment);
    directory =
      config.claudeEnvironment.mode === "ambient"
        ? null
        : resolved.scope.pluginDirectory;
  } catch {
    // The independent structural check remains failed; absent evidence cannot mask it.
    return check(
      "claude.instructions",
      "config",
      "skipped",
      "Instruction comparison is skipped because structural Claude scope validation failed."
    );
  }
  const roles = await Promise.all(
    MODEL_ROLES.map(async (role): Promise<DoctorInstructionRole> => {
      const vendor =
        vendorFor(config.models[role].executable) ?? FALLBACK_VENDOR[role];
      const parity = await inspectRoleInstructionParity(
        vendor,
        directory,
        instructionPhasesForRole(role, null) ?? []
      );
      return {
        role,
        vendor,
        ...parity,
        fixes: instructionParityFixes(
          parity,
          config.claudeEnvironment.mode === "ambient"
        )
      };
    })
  );
  const parity = combineInstructionParity(roles);
  const fixes = [
    ...new Map(
      roles.flatMap((role) => role.fixes).map((fix) => [fix.action, fix])
    ).values()
  ];
  return check(
    "claude.instructions",
    "config",
    parity.state === "verified" || parity.state === "not_applicable"
      ? "pass"
      : parity.state === "mismatch"
        ? "fail"
        : "warning",
    instructionParityDiagnostic(parity),
    fixes,
    roles
  );
}

/**
 * Whether the permission rules a spawned Claude session loads still grant the
 * tools its phases call. The hook authorizes the approved bundle and nothing
 * else, so a planning write and every phase command depend on these rules.
 */
async function claudePermissionsCheck(
  repoRoot: string,
  config: OrchestratorConfig | null,
  dependencies: DoctorDependencies
): Promise<DoctorCheck> {
  if (config === null) {
    return check(
      "claude.permissions",
      "config",
      "skipped",
      "Claude permission inspection requires a valid configuration."
    );
  }
  const permissions = await inspectConfiguredClaudePermissions(
    repoRoot,
    config,
    {
      resolveScope: async (settings) =>
        await (
          dependencies.resolveClaudeInvocationScope ??
          resolveClaudeInvocationScope
        )(settings),
      inspect: async (input) =>
        await (
          dependencies.inspectClaudePermissions ?? inspectClaudePermissions
        )(input)
    }
  );
  if (permissions.state === "not_demanded") {
    return check(
      "claude.permissions",
      "config",
      "skipped",
      "No configured role runs a Claude phase that depends on repository permission rules."
    );
  }
  if (permissions.state === "unresolved") {
    return check(
      "claude.permissions",
      "config",
      "skipped",
      "Claude permission inspection requires a verifiable invocation environment."
    );
  }
  const audit = permissions.audit;
  const remediation = claudePermissionRemediation(audit);
  const fixes: DoctorFix[] =
    remediation.length === 0
      ? []
      : [
          {
            action: `${remediation.charAt(0).toUpperCase()}${remediation.slice(1)}.`,
            documentation:
              "documentation/orchestrator.md#claude-tool-permissions"
          }
        ];
  if (audit.blocking.length > 0) {
    return check(
      "claude.permissions",
      "config",
      "fail",
      audit.blocking.join(" "),
      fixes
    );
  }
  if (audit.advisories.length > 0) {
    return check(
      "claude.permissions",
      "config",
      "warning",
      audit.advisories.join(" "),
      fixes
    );
  }
  return check(
    "claude.permissions",
    "config",
    "pass",
    "Loaded Claude permission rules grant the tools its phases call."
  );
}

async function configuredExecutableCheck(
  id: "executables.models" | "executables.verification",
  commands: readonly string[] | null,
  repoRoot: string,
  dependencies: DoctorDependencies
): Promise<DoctorCheck> {
  if (commands === null) {
    return check(
      id,
      "executables",
      "skipped",
      "Executable availability requires a valid configuration."
    );
  }
  const uniqueCommands = [...new Set(commands)];
  let missing = 0;
  for (const command of uniqueCommands) {
    if (
      !(await dependencies.executableAvailable(command, repoRoot, {
        PATH: process.env.PATH
      }))
    ) {
      missing += 1;
    }
  }
  const subject = id === "executables.models" ? "model" : "verification";
  if (missing > 0) {
    return check(
      id,
      "executables",
      "fail",
      `${missing} of ${uniqueCommands.length} configured ${subject} executables are unavailable.`,
      id === "executables.verification"
        ? [
            {
              action:
                "Run banzai verify list to identify the configured executables; restore their installation or PATH, or use banzai verify edit <id> to select an available executable.",
              documentation: "documentation/verification-examples.md"
            }
          ]
        : []
    );
  }
  return check(
    id,
    "executables",
    "pass",
    `All ${uniqueCommands.length} configured ${subject} executables are available.`
  );
}

async function activeRunCheck(repoRoot: string): Promise<DoctorCheck> {
  const banzaiRoot = path.join(repoRoot, ".banzai");
  const pointerPath = path.join(banzaiRoot, "active-run.json");
  let pointerRaw: string;
  try {
    pointerRaw = await readBoundedFile(pointerPath, banzaiRoot, repoRoot);
  } catch (error) {
    return isMissingFile(error)
      ? check(
          "run.active",
          "run-state",
          "pass",
          "No active-run pointer is present."
        )
      : check(
          "run.active",
          "run-state",
          "fail",
          "The active-run pointer is unreadable or escapes local control state."
        );
  }

  let pointer: unknown;
  try {
    pointer = JSON.parse(pointerRaw) as unknown;
  } catch {
    return check(
      "run.active",
      "run-state",
      "fail",
      "The active-run pointer is malformed."
    );
  }
  if (
    !isRecord(pointer) ||
    pointer.schemaVersion !== 1 ||
    typeof pointer.runId !== "string"
  ) {
    return check(
      "run.active",
      "run-state",
      "fail",
      "The active-run pointer uses an unsupported structure."
    );
  }
  if (!/^[A-Za-z0-9_-]+$/.test(pointer.runId)) {
    return check(
      "run.active",
      "run-state",
      "fail",
      "The active-run pointer contains an unsafe run identifier."
    );
  }

  const runsRoot = path.join(banzaiRoot, "runs");
  const statePath = path.join(runsRoot, pointer.runId, "state.json");
  let stateRaw: string;
  try {
    stateRaw = await readBoundedFile(statePath, runsRoot, repoRoot);
  } catch (error) {
    return check(
      "run.active",
      "run-state",
      "fail",
      isMissingFile(error)
        ? "The active-run pointer references missing state."
        : "The referenced run state is unreadable or escapes local run state."
    );
  }

  let state: unknown;
  try {
    state = JSON.parse(stateRaw) as unknown;
  } catch {
    return check(
      "run.active",
      "run-state",
      "fail",
      "The referenced run state is malformed."
    );
  }
  if (
    !isRecord(state) ||
    ![1, 2, 3, 4, 5, 6, 7, 8, 9, 10].includes(state.schemaVersion as number) ||
    typeof state.runId !== "string" ||
    typeof state.repoRoot !== "string" ||
    typeof state.status !== "string" ||
    !RUN_STATUSES.has(state.status as RunStatus)
  ) {
    return check(
      "run.active",
      "run-state",
      "fail",
      "The referenced run state uses an unsupported structure."
    );
  }
  if (
    state.schemaVersion === 4 ||
    state.schemaVersion === 5 ||
    state.schemaVersion === 6 ||
    state.schemaVersion === 7 ||
    state.schemaVersion === 8 ||
    state.schemaVersion === 9 ||
    state.schemaVersion === 10
  ) {
    try {
      validateConfigurationStateEnvelope(state);
      await inspectBoundWork(
        repoRoot,
        state.artifactBinding as ArtifactBoundWork
      );
    } catch {
      return check(
        "run.active",
        "run-state",
        "fail",
        "The referenced run has missing, malformed or conflicting artifact binding evidence."
      );
    }
  }
  const [stateRepoRoot, checkoutRoot] = await Promise.all([
    path.isAbsolute(state.repoRoot)
      ? realpath(state.repoRoot).catch(() => null)
      : Promise.resolve(null),
    realpath(repoRoot).catch(() => null)
  ]);
  if (
    state.runId !== pointer.runId ||
    stateRepoRoot === null ||
    checkoutRoot === null ||
    stateRepoRoot !== checkoutRoot
  ) {
    return check(
      "run.active",
      "run-state",
      "fail",
      "The active-run pointer and referenced state do not match this checkout."
    );
  }
  if (state.status === "done" || state.status === "cancelled") {
    return check(
      "run.active",
      "run-state",
      "pass",
      `The latest-run pointer references terminal status ${state.status}.`
    );
  }
  return check(
    "run.active",
    "run-state",
    "warning",
    `A consistent non-terminal run is currently ${state.status}.`
  );
}

function isRfc3339Instant(value: string): boolean {
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}

async function runnerLockCheck(
  repoRoot: string,
  dependencies: DoctorDependencies
): Promise<DoctorCheck> {
  const banzaiRoot = path.join(repoRoot, ".banzai");
  const lockPath = path.join(banzaiRoot, "runner.lock");
  let raw: string;
  try {
    raw = await readBoundedFile(lockPath, banzaiRoot, repoRoot);
  } catch (error) {
    return isMissingFile(error)
      ? check("run.lock", "run-state", "pass", "No runner lock is present.")
      : check(
          "run.lock",
          "run-state",
          "fail",
          "The runner lock is unreadable or escapes local control state."
        );
  }

  let lock: unknown;
  try {
    lock = JSON.parse(raw) as unknown;
  } catch {
    return check(
      "run.lock",
      "run-state",
      "fail",
      "The runner lock is malformed."
    );
  }
  if (
    !isRecord(lock) ||
    lock.schemaVersion !== 1 ||
    !Number.isInteger(lock.pid) ||
    (lock.pid as number) <= 0 ||
    typeof lock.token !== "string" ||
    lock.token.length === 0 ||
    typeof lock.createdAt !== "string" ||
    !isRfc3339Instant(lock.createdAt)
  ) {
    return check(
      "run.lock",
      "run-state",
      "fail",
      "The runner lock uses an unsupported or invalid structure."
    );
  }
  const liveness = dependencies.processAlive(lock.pid as number);
  return check(
    "run.lock",
    "run-state",
    "warning",
    liveness === "live"
      ? "A valid live runner lock is present."
      : "A valid stale runner lock is present; doctor left it unchanged."
  );
}

export async function inspectDoctor(
  repoRoot: string,
  dependencies: DoctorDependencies = DEFAULT_DEPENDENCIES
): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];
  const environment = { PATH: process.env.PATH };
  checks.push(
    (await dependencies.executableAvailable("git", repoRoot, environment))
      ? check(
          "repository.git",
          "repository",
          "pass",
          "The checkout is reachable through Git and git is executable."
        )
      : check(
          "repository.git",
          "repository",
          "fail",
          "Git is unavailable for the current checkout."
        )
  );

  const guidance = await inspectProjectAdoption(repoRoot);
  checks.push(
    check(
      "project.guidance",
      "repository",
      guidance.classification === "ready" ? "pass" : "fail",
      adoptionDiagnostic(guidance)
    )
  );

  const [major = 0, minor = 0] = process.versions.node.split(".").map(Number);
  checks.push(
    major > 22 || (major === 22 && minor >= 18)
      ? check(
          "runtime.node",
          "runtime",
          "pass",
          "Node.js satisfies the minimum supported version."
        )
      : check(
          "runtime.node",
          "runtime",
          "fail",
          "Node.js 22.18 or newer is required."
        )
  );
  checks.push(
    process.platform === "darwin" || process.platform === "linux"
      ? check(
          "runtime.platform",
          "runtime",
          "pass",
          "The current platform is supported."
        )
      : check(
          "runtime.platform",
          "runtime",
          "fail",
          "Only macOS and Linux are supported."
        )
  );
  try {
    assertContractParity();
    checks.push(
      check(
        "contract.parity",
        "runtime",
        "pass",
        "Bundled model handoff contracts are in parity."
      )
    );
  } catch {
    checks.push(
      check(
        "contract.parity",
        "runtime",
        "fail",
        "Bundled model handoff contracts are not in parity."
      )
    );
  }

  let configDocument: unknown = null;
  let config: OrchestratorConfig | null = null;
  try {
    const banzaiRoot = path.join(repoRoot, ".banzai");
    const raw = await readBoundedFile(
      path.join(repoRoot, CONFIG_FILE),
      banzaiRoot,
      repoRoot
    );
    checks.push(
      check(
        "config.present",
        "config",
        "pass",
        "The tracked Banzai configuration is readable."
      )
    );
    try {
      configDocument = JSON.parse(raw) as unknown;
      config = parseConfig(configDocument);
      checks.push(
        check(
          "config.valid",
          "config",
          "pass",
          "The Banzai configuration is structurally valid."
        )
      );
    } catch {
      checks.push(
        check(
          "config.valid",
          "config",
          "fail",
          "The Banzai configuration is malformed or structurally invalid."
        )
      );
    }
  } catch (error) {
    checks.push(
      check(
        "config.present",
        "config",
        "fail",
        isMissingFile(error)
          ? "The tracked Banzai configuration is missing."
          : "The tracked Banzai configuration is unreadable."
      )
    );
    checks.push(
      check(
        "config.valid",
        "config",
        "skipped",
        "Configuration validation requires a readable config file."
      )
    );
  }
  checks.push(configVersionCheck(configDocument));
  checks.push(await claudeEnvironmentCheck(config, dependencies));
  checks.push(await claudeInstructionsCheck(config, dependencies));
  checks.push(await claudePermissionsCheck(repoRoot, config, dependencies));

  let projectTypes: VerificationProjectType[] = [];
  try {
    const inspection = await inspectVerificationProject(repoRoot);
    projectTypes = inspection.projectTypes;
    checks.push(
      check(
        "project.types",
        "verification",
        "pass",
        `Detected root project types: ${projectTypes.join(", ")}.`
      )
    );
  } catch {
    checks.push(
      check(
        "project.types",
        "verification",
        "fail",
        "Project marker evidence is unreadable or invalid.",
        [
          {
            action:
              "Restore readable, valid root project metadata, then run banzai doctor.",
            documentation: "documentation/verification-examples.md"
          }
        ]
      )
    );
  }

  checks.push(
    check(
      "verification.task",
      "verification",
      config === null ? "skipped" : "pass",
      config === null
        ? "Task verification policy requires valid configuration."
        : "Checks are selected per task; profiles and project-type coverage are not prerequisites."
    )
  );

  checks.push(
    await configuredExecutableCheck(
      "executables.models",
      config === null
        ? null
        : [
            config.models.planner.executable,
            config.models.implementer.executable,
            config.models.reviewer.executable
          ],
      repoRoot,
      dependencies
    ),
    await configuredExecutableCheck(
      "executables.verification",
      config === null
        ? null
        : (config.verification.taskPolicy?.required ?? []).map(
            (command) => command.command
          ),
      repoRoot,
      dependencies
    ),
    check(
      "authentication.models",
      "executables",
      "warning",
      "Model authentication readiness and vendor CLI versions were not checked. Doctor is offline and executable availability is not authentication proof; startup preflight remains authoritative. Run Banzai from a regular terminal, restore vendor login, or use the vendor-supported setup-token flow when unattended authentication is required."
    ),
    await activeRunCheck(repoRoot),
    await runnerLockCheck(repoRoot, dependencies)
  );

  const reportSummary = summary(checks);
  return {
    schema: "banzai-doctor/v5",
    schemaVersion: 5,
    ready: reportSummary.failed === 0,
    projectTypes,
    summary: reportSummary,
    checks
  };
}
