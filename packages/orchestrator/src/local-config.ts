import { randomUUID } from "node:crypto";
import type { Stats } from "node:fs";
import { lstat, open, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { loadCommittedConfig } from "./config.js";
import { BanzaiError, LocalConfigError } from "./errors.js";
import { escapeTerminalField } from "./format.js";
import {
  appendCloneExcludeLine,
  isPathIgnored,
  isPathInIndex,
  type CloneExcludeAppend
} from "./git.js";
import { MODEL_ROLES, roleLabel } from "./models.js";
import { ProjectFileError, readBytes } from "./project-files.js";
import type {
  EffectiveModelConfiguration,
  LayeredConfiguration,
  LocalConfigDefect,
  LocalConfigDefectCause,
  LocalModelLayer,
  LocalModelLayerStatus,
  LocalModelTriple,
  ModelSettings,
  ModelSources,
  OrchestratorConfig
} from "./types.js";

// ADR-0060: `.banzai/config.local.json` replaces whole role triples of the
// committed configuration for this checkout only. A string literal, never a
// computed path, so the persisted-reader bundle stays unchanged.
export const LOCAL_CONFIG_FILE = ".banzai/config.local.json";
const LOCAL_CONFIG_DIRECTORY = ".banzai";
export const LOCAL_CONFIG_LIMIT = 64 * 1024;

/**
 * The model identifiers the local file accepts (ADR-0060 §1) and the ones
 * doctor may disclose from either file (§8).
 */
export const MODEL_IDENTIFIER_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9._:/@[\]-]{0,127}$/;

// A key from the file is named in a message only when it is a plain identifier.
const NAMEABLE_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

const TOP_LEVEL_KEYS: ReadonlySet<string> = new Set([
  "schemaVersion",
  "models"
]);
const ROLE_KEYS: ReadonlySet<string> = new Set(MODEL_ROLES);
const TRIPLE_KEYS: ReadonlySet<string> = new Set([
  "executable",
  "model",
  "effort"
]);

// Keyed by the committed effort type, so a new effort fails to compile here.
const EFFORTS: Record<ModelSettings["effort"], true> = {
  low: true,
  medium: true,
  high: true,
  xhigh: true,
  max: true,
  ultra: true
};

const CORRECTION = `Correct ${LOCAL_CONFIG_FILE}, or delete it to use the shared models in .banzai/config.json.`;
const UNSAFE_PROBLEM =
  "must be a regular file, and neither it nor .banzai/ may be a symbolic link.";

export type LocalConfigNotIgnoredReason = "tracked" | "not_ignored" | "negated";

const NOT_IGNORED_MESSAGES: Record<LocalConfigNotIgnoredReason, string> = {
  tracked: `${LOCAL_CONFIG_FILE} is in the Git index, so it is shared through Git and may hold someone else's model choice. Run \`git rm --cached ${LOCAL_CONFIG_FILE}\`, review the local copy, and commit the removal.`,
  not_ignored: `${LOCAL_CONFIG_FILE} is not ignored by Git, so it could be committed and shared. Run \`banzai model --local\`, which ignores the file for this clone, or add the line ${LOCAL_CONFIG_FILE} to .gitignore and commit it.`,
  negated: `${LOCAL_CONFIG_FILE} is still not ignored by Git after it was added to this clone's exclude file, because a negation rule (a line starting with !) in a .gitignore file includes it again. Remove that rule and commit the change, then run \`banzai model --local\` again.`
};

/**
 * The `LOCAL_CONFIG_NOT_IGNORED` refusal for each cause (ADR-0060 §4). The
 * negated cause is the exclude step's outcome when a `.gitignore` negation
 * keeps the file visible after the clone's exclude entry was added.
 */
export function localConfigNotIgnoredDefect(
  reason: LocalConfigNotIgnoredReason
): LocalConfigDefect {
  return {
    code: "LOCAL_CONFIG_NOT_IGNORED",
    cause: reason === "tracked" ? "tracked" : "not_ignored",
    fieldPath: LOCAL_CONFIG_FILE,
    message: NOT_IGNORED_MESSAGES[reason]
  };
}

export type LocalModelLayerParse =
  | { ok: true; models: LocalModelLayer }
  | { ok: false; defect: LocalConfigDefect };

class LayerRefusal extends Error {
  constructor(readonly defect: LocalConfigDefect) {
    super(defect.message);
    this.name = "LayerRefusal";
  }
}

function fileDefect(
  cause: LocalConfigDefectCause,
  problem: string
): LocalConfigDefect {
  return {
    code: "LOCAL_CONFIG_INVALID",
    cause,
    fieldPath: LOCAL_CONFIG_FILE,
    message: `${LOCAL_CONFIG_FILE} ${problem} ${CORRECTION}`
  };
}

function invalid(fieldPath: string, problem: string): LayerRefusal {
  return new LayerRefusal({
    code: "LOCAL_CONFIG_INVALID",
    cause: "invalid",
    fieldPath,
    message: `In ${LOCAL_CONFIG_FILE}, ${fieldPath} ${problem} ${CORRECTION}`
  });
}

function refused(fieldPath: string, guidance: string): LayerRefusal {
  return new LayerRefusal({
    code: "LOCAL_CONFIG_KEY_REFUSED",
    cause: "refused_key",
    fieldPath,
    message: `In ${LOCAL_CONFIG_FILE}, ${fieldPath} is not allowed. ${guidance} ${CORRECTION}`
  });
}

/** The field path of `key` below `parent`, naming the key only when it is safe. */
function keyPath(parent: string | null, key: string): string {
  if (!NAMEABLE_KEY_PATTERN.test(key)) {
    return parent === null
      ? "an unsupported key"
      : `an unsupported key in ${parent}`;
  }
  return parent === null ? key : `${parent}.${key}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function refuseUnknownKeys(
  value: Record<string, unknown>,
  parent: string | null,
  allowed: ReadonlySet<string>,
  guidance: string
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw refused(keyPath(parent, key), guidance);
    }
  }
}

function requireField(
  value: Record<string, unknown>,
  parent: string,
  key: string
): unknown {
  if (!Object.hasOwn(value, key)) {
    throw invalid(`${parent}.${key}`, "is missing.");
  }
  return value[key];
}

function isEffort(value: unknown): value is ModelSettings["effort"] {
  return typeof value === "string" && Object.hasOwn(EFFORTS, value);
}

function parseTriple(value: unknown, fieldPath: string): LocalModelTriple {
  if (!isRecord(value)) {
    throw invalid(
      fieldPath,
      "must be an object with executable, model and effort."
    );
  }
  for (const key of Object.keys(value)) {
    if (TRIPLE_KEYS.has(key)) continue;
    throw refused(
      keyPath(fieldPath, key),
      key === "timeoutMs"
        ? "Timeouts stay shared in .banzai/config.json; a role may set only executable, model and effort."
        : "A role may set only executable, model and effort."
    );
  }
  const executable = requireField(value, fieldPath, "executable");
  if (executable !== "claude" && executable !== "codex") {
    throw invalid(
      `${fieldPath}.executable`,
      "must be claude or codex, without a path."
    );
  }
  const model = requireField(value, fieldPath, "model");
  if (typeof model !== "string" || !MODEL_IDENTIFIER_PATTERN.test(model)) {
    throw invalid(
      `${fieldPath}.model`,
      "must be a model identifier of 1 to 128 letters, digits or . _ : / @ [ ] - characters that starts with a letter or digit."
    );
  }
  const effort = requireField(value, fieldPath, "effort");
  if (!isEffort(effort)) {
    throw invalid(
      `${fieldPath}.effort`,
      "must be low, medium, high, xhigh, max or ultra."
    );
  }
  return { executable, model, effort };
}

function parseModels(value: unknown): LocalModelLayer {
  if (!isRecord(value)) {
    throw invalid("models", "must be an object of role settings.");
  }
  refuseUnknownKeys(
    value,
    "models",
    ROLE_KEYS,
    "models may set only planner, implementer and reviewer."
  );
  const layer: LocalModelLayer = {};
  for (const role of MODEL_ROLES) {
    if (Object.hasOwn(value, role)) {
      layer[role] = parseTriple(value[role], `models.${role}`);
    }
  }
  return layer;
}

function parseRoot(value: unknown): LocalModelLayer {
  if (!isRecord(value)) {
    throw new LayerRefusal(fileDefect("invalid", "must hold a JSON object."));
  }
  refuseUnknownKeys(
    value,
    null,
    TOP_LEVEL_KEYS,
    "The file may set only schemaVersion and models."
  );
  if (!Object.hasOwn(value, "schemaVersion")) {
    throw invalid("schemaVersion", "is missing; it must be 1.");
  }
  if (value.schemaVersion !== 1) {
    throw invalid("schemaVersion", "must be 1.");
  }
  if (!Object.hasOwn(value, "models")) {
    throw invalid(
      "models",
      "is missing; it must be an object of role settings."
    );
  }
  return parseModels(value.models);
}

function parsed(parse: () => LocalModelLayer): LocalModelLayerParse {
  try {
    return { ok: true, models: parse() };
  } catch (error) {
    if (error instanceof LayerRefusal) {
      return { ok: false, defect: error.defect };
    }
    throw error;
  }
}

/**
 * Validates a parsed local file (ADR-0060 §1). Extra keys, an unknown role,
 * `timeoutMs` or another field in a role are `LOCAL_CONFIG_KEY_REFUSED`; every
 * other defect is `LOCAL_CONFIG_INVALID`. Pure: it never reads or throws.
 */
export function parseLocalModelLayer(value: unknown): LocalModelLayerParse {
  return parsed(() => parseRoot(value));
}

/**
 * Validates only a `models` role map under the rules of the local file, for
 * records that carry the same map in another envelope.
 */
export function parseLocalModelMap(value: unknown): LocalModelLayerParse {
  return parsed(() => parseModels(value));
}

/** Decodes and validates the bytes of a local file without echoing any of them. */
export function parseLocalModelFile(bytes: Uint8Array): LocalModelLayerParse {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return {
      ok: false,
      defect: fileDefect("invalid", "is not valid UTF-8 text.")
    };
  }
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    return { ok: false, defect: fileDefect("invalid", "is not valid JSON.") };
  }
  return parseLocalModelLayer(value);
}

export interface LocalConfigGitProbe {
  isPathInIndex(repoRoot: string, relativePath: string): Promise<boolean>;
  isPathIgnored(repoRoot: string, relativePath: string): Promise<boolean>;
}

/** What Git says about an existing local file, asked index first. */
export type LocalConfigGitState = "ignored" | "tracked" | "not_ignored";

/**
 * The once-per-command Git check of ADR-0060 §4. Create one at each command
 * entry, interactive launch, picker run and run start, and never keep it
 * beyond that command: a later command must ask Git again.
 */
export interface LocalConfigVisibility {
  gitState(repoRoot: string): Promise<LocalConfigGitState>;
}

const GIT_PROBE: LocalConfigGitProbe = { isPathInIndex, isPathIgnored };

async function queryGitState(
  probe: LocalConfigGitProbe,
  repoRoot: string
): Promise<LocalConfigGitState> {
  if (await probe.isPathInIndex(repoRoot, LOCAL_CONFIG_FILE)) {
    return "tracked";
  }
  return (await probe.isPathIgnored(repoRoot, LOCAL_CONFIG_FILE))
    ? "ignored"
    : "not_ignored";
}

export function createLocalConfigVisibility(
  probe: LocalConfigGitProbe = GIT_PROBE
): LocalConfigVisibility {
  const answers = new Map<string, Promise<LocalConfigGitState>>();
  return {
    gitState(repoRoot: string): Promise<LocalConfigGitState> {
      const key = path.resolve(repoRoot);
      let answer = answers.get(key);
      if (answer === undefined) {
        answer = queryGitState(probe, key);
        answers.set(key, answer);
      }
      return answer;
    }
  };
}

type Presence = "absent" | "present" | LocalConfigDefect;

async function lstatPresence(
  target: string
): Promise<"absent" | Stats | "unreadable"> {
  try {
    return await lstat(target);
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT"
      ? "absent"
      : "unreadable";
  }
}

const UNREADABLE_PROBLEM = "could not be read. Check its local permissions.";

/**
 * Whether a local file exists, decided by `lstat` alone so Git is asked only
 * about an existing path. A symbolic link or non-directory at `.banzai/` is
 * refused even without a file, as the contained reader refuses it.
 */
async function localFilePresence(repoRoot: string): Promise<Presence> {
  const directory = await lstatPresence(
    path.join(repoRoot, LOCAL_CONFIG_DIRECTORY)
  );
  if (directory === "absent") return "absent";
  if (directory === "unreadable") {
    return fileDefect("unreadable", UNREADABLE_PROBLEM);
  }
  if (directory.isSymbolicLink() || !directory.isDirectory()) {
    return fileDefect("unsafe", UNSAFE_PROBLEM);
  }
  const file = await lstatPresence(path.join(repoRoot, LOCAL_CONFIG_FILE));
  if (file === "absent") return "absent";
  if (file === "unreadable") {
    return fileDefect("unreadable", UNREADABLE_PROBLEM);
  }
  return "present";
}

function projectFileDefect(error: ProjectFileError): LocalConfigDefect {
  if (error.code === "ARTIFACT_UNSAFE_PATH") {
    return fileDefect("unsafe", UNSAFE_PROBLEM);
  }
  if (error.code === "ARTIFACT_INPUT_INVALID") {
    return fileDefect("invalid", "is larger than 64 KiB.");
  }
  return fileDefect("unreadable", UNREADABLE_PROBLEM);
}

async function readLocalBytes(
  repoRoot: string
): Promise<Uint8Array | null | LocalConfigDefect> {
  try {
    return await readBytes(repoRoot, LOCAL_CONFIG_FILE, {
      optional: true,
      limit: LOCAL_CONFIG_LIMIT
    });
  } catch (error) {
    if (error instanceof ProjectFileError) return projectFileDefect(error);
    throw error;
  }
}

export interface LocalConfigReadOptions {
  visibility: LocalConfigVisibility;
}

/**
 * The layered reader's local part (ADR-0060 §1, §2, §4). It checks, in order,
 * the Git index, the ignore state, then the contained read and validation, and
 * returns a defect instead of throwing for every problem with the file. A Git
 * failure is not a file defect and propagates.
 */
export async function readLocalModelLayer(
  repoRoot: string,
  options: LocalConfigReadOptions
): Promise<LocalModelLayerStatus> {
  const presence = await localFilePresence(repoRoot);
  if (presence === "absent") return { state: "absent" };
  if (presence !== "present") return { state: "defective", defect: presence };
  const gitState = await options.visibility.gitState(repoRoot);
  if (gitState !== "ignored") {
    return {
      state: "defective",
      defect: localConfigNotIgnoredDefect(gitState)
    };
  }
  const bytes = await readLocalBytes(repoRoot);
  if (bytes === null) return { state: "absent" };
  if (!(bytes instanceof Uint8Array)) {
    return { state: "defective", defect: bytes };
  }
  const result = parseLocalModelFile(bytes);
  return result.ok
    ? { state: "valid", models: result.models }
    : { state: "defective", defect: result.defect };
}

/** The role map of a usable local status (`{}` when absent); null when defective. */
export function localModelsOf(
  status: LocalModelLayerStatus
): LocalModelLayer | null {
  if (status.state === "defective") return null;
  return status.state === "valid" ? status.models : {};
}

/**
 * The effective configuration: the committed configuration with each local
 * triple in place of the committed one. `timeoutMs` and every other key stay
 * committed, and the committed object is never changed.
 */
export function mergeModelLayer(
  committed: OrchestratorConfig,
  layer: LocalModelLayer
): EffectiveModelConfiguration {
  const config = structuredClone(committed);
  const models: LocalModelLayer = {};
  const sources: ModelSources = {
    planner: "committed",
    implementer: "committed",
    reviewer: "committed"
  };
  for (const role of MODEL_ROLES) {
    const triple = layer[role];
    if (triple === undefined) continue;
    config.models[role] = {
      ...config.models[role],
      executable: triple.executable,
      model: triple.model,
      effort: triple.effort
    };
    models[role] = {
      executable: triple.executable,
      model: triple.model,
      effort: triple.effort
    };
    sources[role] = "local";
  }
  return { config, models, sources };
}

/**
 * ADR-0060 §5 comparison value: the same roles with the same executable, model
 * and effort, whatever the key order or formatting. An absent file is `{}`;
 * null stands for a defective layer and never equals anything.
 */
export function sameModelLayer(
  left: LocalModelLayer | null,
  right: LocalModelLayer | null
): boolean {
  if (left === null || right === null) return false;
  return MODEL_ROLES.every((role) => sameTriple(left[role], right[role]));
}

/**
 * The layered reader (ADR-0060 §2): the committed configuration, the local
 * layer or its defect, and the effective configuration with its sources. It
 * never throws for a defective local file; a missing or invalid committed file
 * still fails as `loadCommittedConfig` in `config.ts` does.
 */
export async function readLayeredConfig(
  repoRoot: string,
  options: LocalConfigReadOptions
): Promise<LayeredConfiguration> {
  const committed = await loadCommittedConfig(repoRoot);
  const local = await readLocalModelLayer(repoRoot, options);
  if (local.state === "defective") {
    return { committed, local, effective: null };
  }
  return {
    committed,
    local,
    effective: mergeModelLayer(
      committed,
      local.state === "valid" ? local.models : {}
    )
  };
}

/** The effective configuration, or the local file's refusal as a `LocalConfigError`. */
export function requireEffectiveConfig(
  layered: LayeredConfiguration
): EffectiveModelConfiguration {
  if (layered.effective === null) {
    throw new LocalConfigError(layered.local.defect);
  }
  return layered.effective;
}

/**
 * The effective configuration with the local layer it merged and the source of
 * each role, from one read. Refuses a defective, tracked or unignored local
 * file with `LocalConfigError`.
 */
export async function loadEffectiveConfig(
  repoRoot: string,
  options: LocalConfigReadOptions
): Promise<EffectiveModelConfiguration> {
  return requireEffectiveConfig(await readLayeredConfig(repoRoot, options));
}

/**
 * Outside a run, the configuration every phase would use (ADR-0060 §2). Never
 * call it inside a non-terminal run: the runner merges the run's recorded
 * layer instead of the current local file (§5).
 */
export async function loadConfig(
  repoRoot: string,
  options: LocalConfigReadOptions
): Promise<OrchestratorConfig> {
  return (await loadEffectiveConfig(repoRoot, options)).config;
}

/** The first drift line (ADR-0060 §7). */
export const LOCAL_MODEL_DRIFT_HEADING =
  "Local models changed since this run recorded them";

/**
 * The closing drift line, which `LOCAL_MODEL_OVERRIDE_CHANGED` repeats
 * (ADR-0060 §5, §7).
 */
export const LOCAL_MODEL_DRIFT_ADVICE = `Restore ${LOCAL_CONFIG_FILE}, run banzai retry in a terminal when banzai status recommends it, or run banzai cancel. A change you did not make may come from a model phase or a project script.`;

function sameTriple(
  left: LocalModelTriple | undefined,
  right: LocalModelTriple | undefined
): boolean {
  if (left === undefined || right === undefined) return left === right;
  return (
    left.executable === right.executable &&
    left.model === right.model &&
    left.effort === right.effort
  );
}

/** A role's triple as printed in a drift line; `shared` when the layer has none. */
function driftTriple(triple: LocalModelTriple | undefined): string {
  return triple === undefined
    ? "shared"
    : [triple.executable, triple.model, triple.effort]
        .map(escapeTerminalField)
        .join(" ");
}

/** The single drift line for a current local file that cannot be used. */
function driftDefectLine(defect: LocalConfigDefect): string {
  if (defect.cause === "tracked") return `${LOCAL_CONFIG_FILE}: tracked`;
  if (defect.cause === "not_ignored")
    return `${LOCAL_CONFIG_FILE}: not ignored`;
  return `${LOCAL_CONFIG_FILE}: invalid (${escapeTerminalField(defect.fieldPath)})`;
}

/**
 * The drift lines of ADR-0060 §7 between a run's record and the current local
 * file: one `<Role>: recorded <triple|shared>, now <triple|shared>` line per
 * differing role, or one line naming the file when it cannot be used. Every
 * model value is escaped as a terminal field. Empty when nothing differs.
 */
export function localModelDriftLines(
  recorded: LocalModelLayer,
  current: LocalModelLayerStatus
): string[] {
  if (current.state === "defective") return [driftDefectLine(current.defect)];
  const models = current.state === "valid" ? current.models : {};
  return MODEL_ROLES.filter(
    (role) => !sameTriple(recorded[role], models[role])
  ).map(
    (role) =>
      `${roleLabel(role)}: recorded ${driftTriple(recorded[role])}, now ${driftTriple(models[role])}`
  );
}

/**
 * The canonical text of `.banzai/config.local.json` (ADR-0060 §1): two-space
 * JSON with a final newline, `schemaVersion` before `models`, roles in
 * planner, implementer, reviewer order and each triple as executable, model,
 * effort. The byte preservation of ADR-0043 never applies to this file.
 */
export function renderLocalModelFile(models: LocalModelLayer): string {
  const roles: LocalModelLayer = {};
  for (const role of MODEL_ROLES) {
    const triple = models[role];
    if (triple === undefined) continue;
    roles[role] = {
      executable: triple.executable,
      model: triple.model,
      effort: triple.effort
    };
  }
  return `${JSON.stringify({ schemaVersion: 1, models: roles }, null, 2)}\n`;
}

/** The Git queries and the exclude-file append the exclude step uses. */
export interface LocalConfigExcludeGit extends LocalConfigGitProbe {
  appendCloneExcludeLine(
    repoRoot: string,
    line: string
  ): Promise<CloneExcludeAppend>;
}

/** The real Git queries and exclude-file append of the local writers. */
export const LOCAL_CONFIG_GIT: LocalConfigExcludeGit = {
  isPathInIndex,
  isPathIgnored,
  appendCloneExcludeLine
};

/** `ignored`: Git already ignored the path; `excluded`: the step added it. */
export type LocalConfigExcludeOutcome = "ignored" | "excluded";

/**
 * `.banzai/` as the local writers need it: absent, or a real directory, whose
 * identity is returned. A symbolic link or another file type there is refused
 * as section 1 refuses it, before Git is asked about a path beyond it.
 */
async function localDirectoryState(
  repoRoot: string
): Promise<"absent" | Stats> {
  const directory = await lstatPresence(
    path.join(repoRoot, LOCAL_CONFIG_DIRECTORY)
  );
  if (directory === "absent") return "absent";
  if (directory === "unreadable") {
    throw new LocalConfigError(fileDefect("unreadable", UNREADABLE_PROBLEM));
  }
  if (directory.isSymbolicLink() || !directory.isDirectory()) {
    throw new LocalConfigError(fileDefect("unsafe", UNSAFE_PROBLEM));
  }
  return directory;
}

/**
 * Refuses as unsafe unless `.banzai/` is still the real directory the writer
 * first checked (same device and inode, not a link). Run immediately before
 * each path operation inside it, so a directory swapped for a link while Git
 * was asked never receives a file.
 */
async function requireSameDirectory(
  directory: string,
  expected: Stats
): Promise<void> {
  const current = await lstatPresence(directory);
  if (
    current === "absent" ||
    current === "unreadable" ||
    current.isSymbolicLink() ||
    !current.isDirectory() ||
    current.dev !== expected.dev ||
    current.ino !== expected.ino
  ) {
    throw new LocalConfigError(fileDefect("unsafe", UNSAFE_PROBLEM));
  }
}

/**
 * Removes the writer's temporary file only while its path still names the
 * file the writer created (same device and inode), so a cleanup after a
 * directory swap never deletes a file through a link.
 */
async function removeOwnTemporary(
  temporary: string,
  created: Stats
): Promise<void> {
  const current = await lstatPresence(temporary);
  if (
    current === "absent" ||
    current === "unreadable" ||
    !current.isFile() ||
    current.dev !== created.dev ||
    current.ino !== created.ino
  ) {
    return;
  }
  await unlink(temporary).catch(() => undefined);
}

/**
 * The model writers' precondition (ADR-0060 §3): `.banzai/` is absent or a
 * real directory (a link or another file type is refused as unsafe), and
 * `.banzai/config.json` is readable and valid, so a project without
 * `banzai init` gets `CONFIG_NOT_FOUND`. Run it before the exclude step and
 * the runner lock: it writes nothing.
 */
export async function requireModelWriterProject(
  repoRoot: string
): Promise<void> {
  await localDirectoryState(repoRoot);
  await loadCommittedConfig(repoRoot);
}

/**
 * The picker's exclude step (ADR-0060 §4, reading 4). It depends only on Git
 * state and asks the index first: a path in the index appends nothing and
 * refuses with the tracked message, even when no local file exists. An
 * ignored path needs nothing. Otherwise it appends the exact line to the
 * clone's exclude file (never `.gitignore`) and asks Git again; a `.gitignore`
 * negation that keeps the path visible refuses with the negated message. The
 * exclude file is the only file it may write.
 */
export async function ensureLocalConfigExcluded(
  repoRoot: string,
  git: LocalConfigExcludeGit = LOCAL_CONFIG_GIT
): Promise<LocalConfigExcludeOutcome> {
  await localDirectoryState(repoRoot);
  if (await git.isPathInIndex(repoRoot, LOCAL_CONFIG_FILE)) {
    throw new LocalConfigError(localConfigNotIgnoredDefect("tracked"));
  }
  if (await git.isPathIgnored(repoRoot, LOCAL_CONFIG_FILE)) return "ignored";
  await git.appendCloneExcludeLine(repoRoot, LOCAL_CONFIG_FILE);
  if (!(await git.isPathIgnored(repoRoot, LOCAL_CONFIG_FILE))) {
    throw new LocalConfigError(localConfigNotIgnoredDefect("negated"));
  }
  return "excluded";
}

/** What the local writer did: replaced the file, deleted it, or found nothing to delete. */
export type LocalModelWrite = "written" | "deleted" | "unchanged";

export interface LocalModelWriteOptions {
  /** The Git index and ignore queries; the real ones by default. */
  probe?: LocalConfigGitProbe;
  /**
   * Test seam: runs after the temporary file is written and before
   * `.banzai/` is checked again for the rename.
   */
  beforeRename?: () => Promise<void>;
}

/** The target as `lstat` sees it: absent, or a regular file that is not a link. */
async function requireWritableTarget(
  target: string
): Promise<"absent" | "file"> {
  const existing = await lstatPresence(target);
  if (existing === "absent") return "absent";
  if (existing === "unreadable") {
    throw new LocalConfigError(fileDefect("unreadable", UNREADABLE_PROBLEM));
  }
  if (existing.isSymbolicLink() || !existing.isFile()) {
    throw new LocalConfigError(fileDefect("unsafe", UNSAFE_PROBLEM));
  }
  return "file";
}

/**
 * The local writer (ADR-0060 §1, §3, §4). Call it under the runner lock.
 *
 * - The layer is validated under section 1 first and written in the
 *   canonical format of `renderLocalModelFile`, mode 0600.
 * - Before touching the file it confirms that the path is not in the Git index
 *   (the tracked message, even when no local file exists) and that Git
 *   ignores it (the unignored message). It never edits `.gitignore`.
 * - `.banzai/` must be a real directory and the target absent or a regular
 *   file; a symbolic link at either is refused, so nothing is written through
 *   a link and a link's target never changes.
 * - It publishes through an exclusive temporary file in `.banzai/` renamed
 *   over the target. An empty layer deletes the file instead, after the same
 *   checks.
 */
export async function writeLocalModelLayer(
  repoRoot: string,
  models: LocalModelLayer,
  options: LocalModelWriteOptions = {}
): Promise<LocalModelWrite> {
  const text = renderLocalModelFile(models);
  const parsedLayer = parseLocalModelFile(new TextEncoder().encode(text));
  if (!parsedLayer.ok) throw new LocalConfigError(parsedLayer.defect);
  // A link at `.banzai/` is refused before Git is asked about a path beyond it.
  const identity = await localDirectoryState(repoRoot);
  if (identity === "absent") {
    throw new BanzaiError(
      "CONFIG_NOT_FOUND",
      'Missing .banzai/config.json. Run "banzai init" first.'
    );
  }
  const probe = options.probe ?? GIT_PROBE;
  if (await probe.isPathInIndex(repoRoot, LOCAL_CONFIG_FILE)) {
    throw new LocalConfigError(localConfigNotIgnoredDefect("tracked"));
  }
  if (!(await probe.isPathIgnored(repoRoot, LOCAL_CONFIG_FILE))) {
    throw new LocalConfigError(localConfigNotIgnoredDefect("not_ignored"));
  }
  const directory = path.join(repoRoot, LOCAL_CONFIG_DIRECTORY);
  const target = path.join(repoRoot, LOCAL_CONFIG_FILE);
  const existing = await requireWritableTarget(target);
  if (Object.keys(parsedLayer.models).length === 0) {
    if (existing === "absent") return "unchanged";
    await requireSameDirectory(directory, identity);
    await unlink(target);
    return "deleted";
  }
  const temporary = path.join(
    directory,
    `${path.basename(target)}.${process.pid}.${randomUUID()}.tmp`
  );
  // `.banzai/` may have been swapped for a link while Git was asked.
  await requireSameDirectory(directory, identity);
  const handle = await open(temporary, "wx", 0o600);
  let created: Stats | null = null;
  try {
    try {
      created = await handle.stat();
      await handle.writeFile(text, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await options.beforeRename?.();
    // Checked again just before the rename, which replaces a link at the
    // target instead of following it.
    await requireSameDirectory(directory, identity);
    await requireWritableTarget(target);
    await rename(temporary, target);
  } finally {
    if (created !== null) await removeOwnTemporary(temporary, created);
  }
  return "written";
}
