import { validateConfigurationStateEnvelope } from "./configuration-prerequisite.js";
import { constants } from "node:fs";
import { access, lstat, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  REVIEW_ISOLATION_MINIMUM_CLAUDE_VERSION,
  meetsReviewIsolationMinimum,
  resolveClaudeInvocationScope,
  vendorFor,
  FALLBACK_VENDOR,
  MODEL_ROLES,
  type ResolvedClaudeInvocationScope
} from "./adapters.js";
import {
  claudePermissionRemediation,
  inspectClaudePermissions,
  inspectClaudeUserPluginScope,
  inspectConfiguredClaudePermissions,
  type ClaudePermissionAudit,
  type ClaudePermissionInput
} from "./claude-permissions.js";
import { CONFIG_FILE } from "./config.js";
import {
  LOCAL_CONFIG_FILE,
  MODEL_IDENTIFIER_PATTERN,
  createLocalConfigVisibility,
  mergeModelLayer,
  readLocalModelLayer,
  type LocalConfigGitProbe
} from "./local-config.js";
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
  LocalConfigDefect,
  LocalModelLayer,
  LocalModelLayerStatus,
  ModelSettings,
  ModelSource,
  ModelSources,
  OrchestratorConfig,
  RunStatus,
  VerificationProjectType
} from "./types.js";
import { inspectBoundWork, isHistoricalWork } from "./work-documents.js";
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

/**
 * One role of the effective configuration (ADR-0060 §6, §8). Only the vendor,
 * an identifier-shaped model, the effort and the source are disclosed; the
 * executable path, timeouts and every other value stay undisclosed.
 */
export interface DoctorModel {
  role: "planner" | "implementer" | "reviewer";
  /** `null` for an executable that is neither `claude` nor `codex`. */
  vendor: "claude" | "codex" | null;
  /** `null` unless the identifier matches `MODEL_IDENTIFIER_PATTERN`. */
  model: string | null;
  effort: ModelSettings["effort"];
  source: ModelSource;
}

export interface DoctorReport {
  schema: "banzai-doctor/v6";
  schemaVersion: 6;
  ready: boolean;
  projectTypes: VerificationProjectType[];
  /** Empty while the effective configuration is unavailable. */
  models: DoctorModel[];
  summary: DoctorSummary;
  checks: DoctorCheck[];
}

/**
 * The two read-only Git queries doctor may run for the local model file
 * (ADR-0060 §8): `git ls-files --error-unmatch --` and
 * `git check-ignore -q --`, at the repository root with `LC_ALL=C`.
 */
export type DoctorLocalConfigGitProbe = LocalConfigGitProbe;

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
  /**
   * Where Claude's user settings are found (`HOME`, `CLAUDE_CONFIG_DIR`).
   * Defaults to this process's environment; tests point it at a temporary home.
   */
  claudeSettingsEnvironment?: NodeJS.ProcessEnv;
  /**
   * Injected by the composition root, because doctor itself never imports the
   * Git module. Asked only when `.banzai/config.local.json` exists. Without
   * it, an existing local file fails `config.local` as if Git could not run.
   */
  localConfigGitState?: DoctorLocalConfigGitProbe;
  /**
   * The installed Claude Code version, read from the file system only
   * (ADR-0008, ADR-0059 §2), or `null` when no known layout yields one.
   * Defaults to `readInstalledClaudeVersion`.
   */
  installedClaudeVersion?(
    command: string,
    cwd: string,
    env: NodeJS.ProcessEnv
  ): Promise<string | null>;
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

const VERSION_SHAPE = /^\d+\.\d+\.\d+$/u;
/** The npm wrapper package, or the platform package that carries the binary. */
const CLAUDE_PACKAGE_NAME =
  /^@anthropic-ai\/claude-code(?:-[a-z0-9]+(?:-[a-z0-9]+)*)?$/u;
const PACKAGE_MANIFEST_LIMIT = 1024 * 1024;

/**
 * The native installer names each installed file by its version, as in
 * `~/.local/share/claude/versions/2.1.319`.
 */
function nativeInstallerVersion(resolved: string): string | null {
  const name = path.basename(resolved);
  return path.basename(path.dirname(resolved)) === "versions" &&
    VERSION_SHAPE.test(name)
    ? name
    : null;
}

/**
 * npm installs the binary inside its package (the wrapper's `bin/claude.exe`,
 * or the platform package). The walk stops at the first `package.json` above
 * the file, whatever it names, so an unrelated manifest is never skipped past.
 */
async function npmPackageVersion(resolved: string): Promise<string | null> {
  let directory = path.dirname(resolved);
  for (;;) {
    const manifest = path.join(directory, "package.json");
    let found = false;
    try {
      const metadata = await stat(manifest);
      found = true;
      if (!metadata.isFile() || metadata.size > PACKAGE_MANIFEST_LIMIT) {
        return null;
      }
      const parsed = JSON.parse(await readFile(manifest, "utf8")) as unknown;
      return isRecord(parsed) &&
        typeof parsed.name === "string" &&
        CLAUDE_PACKAGE_NAME.test(parsed.name) &&
        typeof parsed.version === "string" &&
        VERSION_SHAPE.test(parsed.version)
        ? parsed.version
        : null;
    } catch {
      if (found) return null;
    }
    const parent = path.dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
}

/**
 * Reads the installed Claude Code version without running it (ADR-0008): the
 * first executable `PATH` candidate, as `executableAvailable` finds it, is
 * resolved through its links and matched against the native and npm layouts.
 * Returns `null` when neither yields a version-shaped value.
 */
export async function readInstalledClaudeVersion(
  command: string,
  cwd: string,
  env: NodeJS.ProcessEnv
): Promise<string | null> {
  for (const candidate of executableCandidates(command, cwd, env)) {
    let resolved: string;
    try {
      await access(candidate, constants.X_OK);
      if (!(await stat(candidate)).isFile()) continue;
      resolved = await realpath(candidate);
    } catch {
      continue;
    }
    return (
      nativeInstallerVersion(resolved) ?? (await npmPackageVersion(resolved))
    );
  }
  return null;
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

/** The default doctor dependencies with `overrides` in their place. */
export function doctorDependencies(
  overrides: Partial<DoctorDependencies> = {}
): DoctorDependencies {
  return { ...DEFAULT_DEPENDENCIES, ...overrides };
}

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

const LOCAL_CONFIG_DOCUMENTATION =
  "documentation/orchestrator.md#model-configuration";
const LOCAL_CONFIG_CORRECTION: DoctorFix = {
  action: `Correct ${LOCAL_CONFIG_FILE}, or delete it to use the shared models in ${CONFIG_FILE}.`,
  documentation: LOCAL_CONFIG_DOCUMENTATION
};

/**
 * The field paths of the local file's own schema. Doctor names a defect's
 * field path only from this fixed set, so no key chosen by the file's author
 * reaches the report (ADR-0060 §6, §8).
 */
const SCHEMA_FIELD_PATHS: ReadonlySet<string> = new Set([
  "schemaVersion",
  "models",
  ...MODEL_ROLES.flatMap((role) => [
    `models.${role}`,
    `models.${role}.executable`,
    `models.${role}.model`,
    `models.${role}.effort`
  ])
]);

/** Where a refused key sits, named only through the schema's own paths. */
function refusedKeyLocation(fieldPath: string): string {
  const unsupported = "an unsupported key in ";
  let parent: string;
  if (fieldPath.startsWith(unsupported)) {
    parent = fieldPath.slice(unsupported.length);
  } else if (fieldPath.includes(".")) {
    parent = fieldPath.slice(0, fieldPath.lastIndexOf("."));
  } else {
    return "at the top level";
  }
  return SCHEMA_FIELD_PATHS.has(parent) ? `in ${parent}` : "in the file";
}

function localConfigFailure(message: string, fix: DoctorFix): DoctorCheck {
  return check("config.local", "config", "fail", message, [fix]);
}

/** The fixed `config.local` text for each cause of a refused local file. */
function localConfigDefectCheck(defect: LocalConfigDefect): DoctorCheck {
  switch (defect.cause) {
    case "tracked":
      return localConfigFailure(
        `${LOCAL_CONFIG_FILE} is in the Git index, so it is shared through Git and may hold someone else's model choice.`,
        {
          action: `Run \`git rm --cached ${LOCAL_CONFIG_FILE}\`, review the local copy, and commit the removal.`,
          documentation: LOCAL_CONFIG_DOCUMENTATION
        }
      );
    case "not_ignored":
      return localConfigFailure(
        `${LOCAL_CONFIG_FILE} is not ignored by Git, so it could be committed and shared.`,
        {
          action: `Run \`banzai model --local\`, which ignores the file for this clone, or add the line ${LOCAL_CONFIG_FILE} to .gitignore and commit it.`,
          documentation: LOCAL_CONFIG_DOCUMENTATION
        }
      );
    case "unsafe":
      return localConfigFailure(
        `${LOCAL_CONFIG_FILE} is unsafe to read: it or .banzai/ is a symbolic link, or it is not a regular file.`,
        {
          action: `Make .banzai/ a directory and ${LOCAL_CONFIG_FILE} a regular file, or delete the local file to use the shared models in ${CONFIG_FILE}.`,
          documentation: LOCAL_CONFIG_DOCUMENTATION
        }
      );
    case "unreadable":
      return localConfigFailure(
        `${LOCAL_CONFIG_FILE} cannot be read.`,
        LOCAL_CONFIG_CORRECTION
      );
    case "refused_key":
      return localConfigFailure(
        `${LOCAL_CONFIG_FILE} sets a key that is not allowed ${refusedKeyLocation(defect.fieldPath)}; it may set only schemaVersion and models, with executable, model and effort for planner, implementer and reviewer.`,
        LOCAL_CONFIG_CORRECTION
      );
    case "invalid":
      return localConfigFailure(
        invalidLocalConfigMessage(defect.fieldPath),
        LOCAL_CONFIG_CORRECTION
      );
  }
}

function invalidLocalConfigMessage(fieldPath: string): string {
  if (fieldPath === LOCAL_CONFIG_FILE) {
    return `${LOCAL_CONFIG_FILE} is not a local model file: it is larger than 64 KiB, not UTF-8 text, not JSON or not a JSON object.`;
  }
  return SCHEMA_FIELD_PATHS.has(fieldPath)
    ? `${LOCAL_CONFIG_FILE} has a missing or invalid value at ${fieldPath}.`
    : `${LOCAL_CONFIG_FILE} has a missing or invalid value.`;
}

/** A failure of one of the two Git queries, never a statement about the file. */
class LocalConfigGitUnavailable extends Error {
  constructor() {
    super("Git could not answer for the local model file.");
    this.name = "LocalConfigGitUnavailable";
  }
}

/**
 * Wraps the injected probe so any Git failure, or a missing probe, surfaces as
 * one marker that `config.local` reports with fixed text.
 */
function doctorGitProbe(
  probe: DoctorLocalConfigGitProbe | undefined
): LocalConfigGitProbe {
  const ask = async (
    query: (target: DoctorLocalConfigGitProbe) => Promise<boolean>
  ): Promise<boolean> => {
    if (probe === undefined) throw new LocalConfigGitUnavailable();
    try {
      return await query(probe);
    } catch {
      throw new LocalConfigGitUnavailable();
    }
  };
  return {
    isPathInIndex: async (repoRoot, relativePath) =>
      await ask(async (target) => target.isPathInIndex(repoRoot, relativePath)),
    isPathIgnored: async (repoRoot, relativePath) =>
      await ask(async (target) => target.isPathIgnored(repoRoot, relativePath))
  };
}

interface LocalConfigInspection {
  check: DoctorCheck;
  /** The usable local layer (`{}` when absent); null while `config.local` fails. */
  layer: LocalModelLayer | null;
}

/**
 * The `config.local` check (ADR-0060 §6). The layered reader decides presence
 * by `lstat`, so Git is asked only about an existing file, and in the order
 * index, then ignore state, then the contained read and validation.
 */
async function localConfigCheck(
  repoRoot: string,
  dependencies: DoctorDependencies
): Promise<LocalConfigInspection> {
  let status: LocalModelLayerStatus;
  try {
    status = await readLocalModelLayer(repoRoot, {
      visibility: createLocalConfigVisibility(
        doctorGitProbe(dependencies.localConfigGitState)
      )
    });
  } catch (error) {
    return {
      check:
        error instanceof LocalConfigGitUnavailable
          ? localConfigFailure(
              `Git could not report whether ${LOCAL_CONFIG_FILE} is in the Git index or ignored, so the local model file was not used.`,
              {
                action:
                  "Make sure git runs in this checkout, then run banzai doctor again.",
                documentation: LOCAL_CONFIG_DOCUMENTATION
              }
            )
          : localConfigFailure(
              `${LOCAL_CONFIG_FILE} cannot be read.`,
              LOCAL_CONFIG_CORRECTION
            ),
      layer: null
    };
  }
  if (status.state === "defective") {
    return { check: localConfigDefectCheck(status.defect), layer: null };
  }
  if (status.state === "absent") {
    return {
      check: check(
        "config.local",
        "config",
        "pass",
        `No local model file is present; every role uses the shared models in ${CONFIG_FILE}.`
      ),
      layer: {}
    };
  }
  return {
    check: check(
      "config.local",
      "config",
      "pass",
      `${LOCAL_CONFIG_FILE} is valid, ignored by Git and not in the Git index; the roles it sets replace the shared ones.`
    ),
    layer: status.models
  };
}

/**
 * The disclosed per-role models of the effective configuration (ADR-0060 §8),
 * in planner, implementer, reviewer order.
 */
function doctorModels(
  config: OrchestratorConfig,
  sources: ModelSources
): DoctorModel[] {
  return MODEL_ROLES.map((role) => {
    const settings = config.models[role];
    return {
      role,
      vendor: vendorFor(settings.executable),
      model: MODEL_IDENTIFIER_PATTERN.test(settings.model)
        ? settings.model
        : null,
      effort: settings.effort,
      source: sources[role]
    };
  });
}

/** Why a role check that reads the effective configuration did not run. */
const LOCAL_CONFIG_SKIP = "while the local model file fails config.local";

/** What the role checks and the `models` field read (ADR-0060 §2, §6). */
interface RoleConfiguration {
  /** The effective configuration; null without a valid committed one. */
  config: OrchestratorConfig | null;
  /** `config.local` failed, so the role checks are skipped. */
  localFailed: boolean;
  models: DoctorModel[];
  executables: string[] | null;
  executablesSkipped: string | undefined;
}

function roleConfiguration(
  committed: OrchestratorConfig | null,
  layer: LocalModelLayer | null
): RoleConfiguration {
  if (committed === null || layer === null) {
    return {
      config: committed,
      localFailed: layer === null,
      models: [],
      executables: null,
      executablesSkipped:
        committed === null
          ? undefined
          : `Model executable availability is skipped ${LOCAL_CONFIG_SKIP}.`
    };
  }
  const effective = mergeModelLayer(committed, layer);
  return {
    config: effective.config,
    localFailed: false,
    models: doctorModels(effective.config, effective.sources),
    executables: MODEL_ROLES.map(
      (role) => effective.config.models[role].executable
    ),
    executablesSkipped: undefined
  };
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
  localFailed: boolean,
  dependencies: DoctorDependencies
): Promise<DoctorCheck> {
  if (config === null)
    return check(
      "claude.instructions",
      "config",
      "skipped",
      "Instruction comparison is skipped without a valid configuration."
    );
  if (localFailed)
    return check(
      "claude.instructions",
      "config",
      "skipped",
      `Instruction comparison is skipped ${LOCAL_CONFIG_SKIP}.`
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
  localFailed: boolean,
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
  if (localFailed) {
    return check(
      "claude.permissions",
      "config",
      "skipped",
      `Claude permission inspection is skipped ${LOCAL_CONFIG_SKIP}.`
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

/**
 * Advisory only: a user-scope install loads Banzai's skill descriptions into
 * every Claude session in every repository. Readiness never depends on it.
 */
async function claudePluginScopeCheck(
  dependencies: DoctorDependencies
): Promise<DoctorCheck> {
  const scope = await inspectClaudeUserPluginScope(
    dependencies.claudeSettingsEnvironment ?? process.env
  );
  if (scope.state === "unreadable") {
    return check(
      "claude.plugin-scope",
      "config",
      "skipped",
      `Claude user settings at ${scope.path} are unreadable or not a JSON object, so the plugin scope was not inspected.`
    );
  }
  if (scope.state === "not_enabled") {
    return check(
      "claude.plugin-scope",
      "config",
      "pass",
      "Banzai is not enabled in Claude user settings."
    );
  }
  return check(
    "claude.plugin-scope",
    "config",
    "warning",
    `Claude user settings at ${scope.path} enable ${scope.keys.join(", ")}, so Banzai skill descriptions load in every repository.`,
    [
      {
        action:
          "Install Banzai for this repository instead: run `claude plugin uninstall banzai@banzai-plugins --scope user`, then `claude plugin install banzai@banzai-plugins --scope local`, or `--scope project` to share it with your team.",
        documentation: "documentation/getting-started.md#claude-code-plugin"
      }
    ]
  );
}

async function configuredExecutableCheck(
  id: "executables.models" | "executables.verification",
  commands: readonly string[] | null,
  repoRoot: string,
  dependencies: DoctorDependencies,
  skipped = "Executable availability requires a valid configuration."
): Promise<DoctorCheck> {
  if (commands === null) {
    return check(id, "executables", "skipped", skipped);
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

const CLAUDE_VERSION_FIXES: DoctorFix[] = [
  {
    action: `Update Claude Code to ${REVIEW_ISOLATION_MINIMUM_CLAUDE_VERSION} or newer, or choose another reviewer with \`banzai model\`.`,
    documentation:
      "documentation/getting-started.md#install-and-sign-in-to-model-clients"
  }
];

/**
 * The review isolation minimum for a Claude reviewer (ADR-0059 §2), read
 * offline. Only the effective reviewer whose executable is `claude` qualifies;
 * the run start still refuses an older client whatever this reports.
 */
async function claudeVersionCheck(
  roles: RoleConfiguration,
  repoRoot: string,
  dependencies: DoctorDependencies
): Promise<DoctorCheck> {
  const id = "claude.version";
  if (roles.config === null) {
    return check(
      id,
      "executables",
      "skipped",
      "The Claude reviewer version check requires a valid configuration."
    );
  }
  if (roles.localFailed) {
    return check(
      id,
      "executables",
      "skipped",
      `The Claude reviewer version check is skipped ${LOCAL_CONFIG_SKIP}.`
    );
  }
  const executable = roles.config.models.reviewer.executable;
  if (vendorFor(executable) !== "claude") {
    return check(
      id,
      "executables",
      "skipped",
      "The reviewer does not run on Claude Code, so the review isolation minimum does not apply."
    );
  }
  const environment = { PATH: process.env.PATH };
  if (
    !(await dependencies.executableAvailable(executable, repoRoot, environment))
  ) {
    return check(
      id,
      "executables",
      "skipped",
      "The Claude reviewer executable is unavailable, so its version was not read."
    );
  }
  const version = await (
    dependencies.installedClaudeVersion ?? readInstalledClaudeVersion
  )(executable, repoRoot, environment);
  if (version === null) {
    return check(
      id,
      "executables",
      "warning",
      `The installed Claude Code version could not be read offline. Run start refuses a reviewer older than ${REVIEW_ISOLATION_MINIMUM_CLAUDE_VERSION}.`,
      CLAUDE_VERSION_FIXES
    );
  }
  return meetsReviewIsolationMinimum(version)
    ? check(
        id,
        "executables",
        "pass",
        `Claude Code ${version} meets the reviewer isolation minimum ${REVIEW_ISOLATION_MINIMUM_CLAUDE_VERSION}.`
      )
    : check(
        id,
        "executables",
        "fail",
        `Claude Code ${version} cannot isolate the reviewer, which requires ${REVIEW_ISOLATION_MINIMUM_CLAUDE_VERSION} or newer.`,
        CLAUDE_VERSION_FIXES
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
    ![1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].includes(
      state.schemaVersion as number
    ) ||
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
  let historical = false;
  if (
    state.schemaVersion === 4 ||
    state.schemaVersion === 5 ||
    state.schemaVersion === 6 ||
    state.schemaVersion === 7 ||
    state.schemaVersion === 8 ||
    state.schemaVersion === 9 ||
    state.schemaVersion === 10 ||
    state.schemaVersion === 11
  ) {
    try {
      validateConfigurationStateEnvelope(state);
      const bound = state.artifactBinding as ArtifactBoundWork;
      // Binding v3 starts at state 9; earlier bindings remain read-only history.
      historical = state.schemaVersion <= 8 && isHistoricalWork(bound);
      if (!historical) await inspectBoundWork(repoRoot, bound);
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
      historical
        ? `The latest-run pointer references terminal status ${state.status} from an earlier Banzai version; that run is read-only history.`
        : `The latest-run pointer references terminal status ${state.status}.`
    );
  }
  if (historical) {
    return check(
      "run.active",
      "run-state",
      "warning",
      `A run created by an earlier Banzai version is ${state.status} and cannot resume.`,
      [
        {
          action:
            "Run banzai cancel, then start new work. The earlier run's documents stay where they are.",
          documentation: "documentation/getting-started.md"
        }
      ]
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
  const local = await localConfigCheck(repoRoot, dependencies);
  checks.push(local.check);
  // ADR-0060 §2, §6: role checks read the effective configuration; the
  // environment and verification checks keep the committed values, which the
  // local file cannot change.
  const roles = roleConfiguration(config, local.layer);
  checks.push(await claudeEnvironmentCheck(config, dependencies));
  checks.push(
    await claudeInstructionsCheck(roles.config, roles.localFailed, dependencies)
  );
  checks.push(
    await claudePermissionsCheck(
      repoRoot,
      roles.config,
      roles.localFailed,
      dependencies
    )
  );
  checks.push(await claudePluginScopeCheck(dependencies));

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
      roles.executables,
      repoRoot,
      dependencies,
      roles.executablesSkipped
    ),
    await claudeVersionCheck(roles, repoRoot, dependencies),
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
      "Model authentication readiness was not checked, and doctor checks no vendor CLI version except the Claude reviewer's, which it reads offline. Doctor is offline and executable availability is not authentication proof; startup preflight remains authoritative. Run Banzai from a regular terminal, restore vendor login, or use the vendor-supported setup-token flow when unattended authentication is required."
    ),
    await activeRunCheck(repoRoot),
    await runnerLockCheck(repoRoot, dependencies)
  );

  const reportSummary = summary(checks);
  return {
    schema: "banzai-doctor/v6",
    schemaVersion: 6,
    ready: reportSummary.failed === 0,
    projectTypes,
    models: roles.models,
    summary: reportSummary,
    checks
  };
}
