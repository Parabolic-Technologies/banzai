import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { BanzaiError } from "./errors.js";
import type { ModelRole } from "./models.js";
import {
  CONTRACT_VERSION,
  type ModelSettings,
  type OrchestratorConfig,
  type VerificationProfile
} from "./types.js";
import { parseConfig } from "./validation.js";

export const CONFIG_DIRECTORY = ".banzai";
export const CONFIG_FILE = path.join(CONFIG_DIRECTORY, "config.json");

export const DEFAULT_CONFIG: OrchestratorConfig = {
  schemaVersion: 2,
  contractVersion: CONTRACT_VERSION,
  models: {
    planner: {
      executable: "codex",
      model: "gpt-5.6-sol",
      effort: "xhigh",
      timeoutMs: 30 * 60 * 1000
    },
    implementer: {
      executable: "codex",
      model: "gpt-5.6-sol",
      effort: "xhigh",
      timeoutMs: 60 * 60 * 1000
    },
    reviewer: {
      executable: "claude",
      model: "claude-opus-5",
      effort: "xhigh",
      timeoutMs: 30 * 60 * 1000
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
            timeoutMs: 2 * 60 * 1000
          }
        ]
      }
    ]
  },
  maxFixCycles: 3
};

/** New-project wire configuration. Legacy defaults above support old profile operations. */
export const DEFAULT_TASK_CONFIG = {
  schemaVersion: 4 as const,
  contractVersion: CONTRACT_VERSION,
  models: structuredClone(DEFAULT_CONFIG.models),
  claudeEnvironment: structuredClone(DEFAULT_CONFIG.claudeEnvironment),
  context: structuredClone(DEFAULT_CONFIG.context),
  maxFixCycles: DEFAULT_CONFIG.maxFixCycles
};

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function loadConfig(
  repoRoot: string
): Promise<OrchestratorConfig> {
  const configPath = path.join(repoRoot, CONFIG_FILE);
  let raw: string;
  try {
    raw = await readFile(configPath, "utf8");
  } catch {
    throw new BanzaiError(
      "CONFIG_NOT_FOUND",
      `Missing ${CONFIG_FILE}. Run "banzai init" first.`
    );
  }

  try {
    return parseConfig(JSON.parse(raw) as unknown);
  } catch (error) {
    if (error instanceof BanzaiError) {
      throw error;
    }
    throw new BanzaiError(
      "INVALID_CONFIG",
      `${CONFIG_FILE} is not valid JSON: ${(error as Error).message}`
    );
  }
}

export interface ModelUpdate {
  role: ModelRole;
  model: string;
  executable?: string;
  effort?: ModelSettings["effort"];
}

interface JsonValueReplacement {
  start: number;
  end: number;
  value: string;
}

interface JsonValueLocation {
  start: number;
  end: number;
  propertyStart?: number;
}

function jsonPathKey(pathParts: readonly string[]): string {
  return JSON.stringify(pathParts);
}

function replaceJsonValues(
  raw: string,
  replacements: ReadonlyMap<string, string>,
  locations?: Map<string, JsonValueLocation>
): string {
  let index = 0;
  const located = new Map<string, JsonValueReplacement>();

  function invalidSource(): never {
    throw new BanzaiError(
      "INVALID_CONFIG",
      `${CONFIG_FILE} cannot be updated without changing unrelated content.`
    );
  }

  function skipWhitespace(): void {
    while (/\s/.test(raw[index] ?? "")) {
      index += 1;
    }
  }

  function parseStringToken(): string {
    if (raw[index] !== '"') {
      invalidSource();
    }
    const start = index;
    index += 1;
    while (index < raw.length) {
      const character = raw[index];
      if (character === "\\") {
        index += 2;
        continue;
      }
      index += 1;
      if (character === '"') {
        return JSON.parse(raw.slice(start, index)) as string;
      }
    }
    return invalidSource();
  }

  function parseObject(pathParts: readonly string[]): void {
    index += 1;
    skipWhitespace();
    if (raw[index] === "}") {
      index += 1;
      return;
    }
    while (index < raw.length) {
      skipWhitespace();
      const propertyStart = index;
      const key = parseStringToken();
      skipWhitespace();
      if (raw[index] !== ":") {
        invalidSource();
      }
      index += 1;
      parseValue([...pathParts, key]);
      const location = locations?.get(jsonPathKey([...pathParts, key]));
      if (location) location.propertyStart = propertyStart;
      skipWhitespace();
      if (raw[index] === "}") {
        index += 1;
        return;
      }
      if (raw[index] !== ",") {
        invalidSource();
      }
      index += 1;
    }
    invalidSource();
  }

  function parseArray(pathParts: readonly string[]): void {
    index += 1;
    skipWhitespace();
    if (raw[index] === "]") {
      index += 1;
      return;
    }
    let itemIndex = 0;
    while (index < raw.length) {
      parseValue([...pathParts, String(itemIndex)]);
      itemIndex += 1;
      skipWhitespace();
      if (raw[index] === "]") {
        index += 1;
        return;
      }
      if (raw[index] !== ",") {
        invalidSource();
      }
      index += 1;
    }
    invalidSource();
  }

  function parseValue(pathParts: readonly string[]): void {
    skipWhitespace();
    const start = index;
    if (raw[index] === "{") {
      parseObject(pathParts);
    } else if (raw[index] === "[") {
      parseArray(pathParts);
    } else if (raw[index] === '"') {
      parseStringToken();
    } else {
      while (index < raw.length && !/[\s,\]}]/.test(raw[index] ?? "")) {
        index += 1;
      }
      if (index === start) {
        invalidSource();
      }
    }

    const key = jsonPathKey(pathParts);
    if (locations) {
      if (locations.has(key)) invalidSource();
      locations.set(key, { start, end: index });
    }
    const replacement = replacements.get(key);
    if (replacement !== undefined) {
      located.set(key, { start, end: index, value: replacement });
    }
  }

  parseValue([]);
  skipWhitespace();
  if (index !== raw.length || located.size !== replacements.size) {
    invalidSource();
  }

  let updated = raw;
  const ordered = [...located.values()].sort(
    (left, right) => right.start - left.start
  );
  for (const replacement of ordered) {
    updated =
      updated.slice(0, replacement.start) +
      replacement.value +
      updated.slice(replacement.end);
  }
  return updated;
}

function jsonLocations(raw: string): Map<string, JsonValueLocation> {
  const locations = new Map<string, JsonValueLocation>();
  replaceJsonValues(raw, new Map(), locations);
  return locations;
}

function requiredConfigValue<T>(value: T | undefined): T {
  if (value === undefined)
    throw new BanzaiError(
      "INVALID_CONFIG",
      "Configuration token evidence is incomplete."
    );
  return value;
}

function editJsonProperty(
  raw: string,
  parent: string[],
  key: string,
  value: string | undefined
): string {
  const locations = jsonLocations(raw);
  const object = locations.get(jsonPathKey(parent));
  if (!object || raw[object.start] !== "{")
    throw new BanzaiError(
      "INVALID_CONFIG",
      "The selected configuration object is unavailable."
    );
  const target = locations.get(jsonPathKey([...parent, key]));
  const children = [...locations.entries()]
    .filter(([encoded]) => {
      const parts = JSON.parse(encoded) as string[];
      return (
        parts.length === parent.length + 1 &&
        parent.every((part, index) => parts[index] === part)
      );
    })
    .map(([, location]) => location)
    .sort((a, b) => a.start - b.start);
  if (target && value !== undefined)
    return raw.slice(0, target.start) + value + raw.slice(target.end);
  if (target) {
    const position = children.indexOf(target);
    const previous = children[position - 1];
    const next = children[position + 1];
    const start = previous?.end ?? requiredConfigValue(target.propertyStart);
    const end = previous ? target.end : (next?.propertyStart ?? target.end);
    return raw.slice(0, start) + raw.slice(end);
  }
  if (value === undefined) return raw;
  const at = children.at(-1)?.end ?? object.start + 1;
  return (
    raw.slice(0, at) +
    (children.length ? "," : "") +
    JSON.stringify(key) +
    ":" +
    value +
    raw.slice(at)
  );
}

function editJsonArray(
  raw: string,
  parent: string[],
  values: string[]
): string {
  const locations = jsonLocations(raw);
  const array = locations.get(jsonPathKey(parent));
  if (!array || raw[array.start] !== "[")
    throw new BanzaiError(
      "INVALID_CONFIG",
      "The selected configuration list is unavailable."
    );
  const existing: JsonValueLocation[] = [];
  for (let i = 0; locations.has(jsonPathKey([...parent, String(i)])); i++)
    existing.push(
      requiredConfigValue(locations.get(jsonPathKey([...parent, String(i)])))
    );
  if (existing.length === values.length) {
    const edits = new Map<string, string>();
    values.forEach((value, i) => {
      const original = requiredConfigValue(existing[i]);
      if (value !== raw.slice(original.start, original.end))
        edits.set(jsonPathKey([...parent, String(i)]), value);
    });
    return replaceJsonValues(raw, edits);
  }
  const originals = existing.map(({ start, end }) => raw.slice(start, end));
  let prefix = 0;
  while (
    prefix < Math.min(originals.length, values.length) &&
    originals[prefix] === values[prefix]
  )
    prefix++;
  let suffix = 0;
  while (
    suffix < Math.min(originals.length, values.length) - prefix &&
    originals[originals.length - 1 - suffix] ===
      values[values.length - 1 - suffix]
  )
    suffix++;
  const left = existing[prefix - 1];
  const right = existing[existing.length - suffix];
  const changed = values.slice(prefix, values.length - suffix);
  const leading = raw.slice(
    array.start + 1,
    existing[0]?.start ?? array.end - 1
  );
  const separator =
    existing.length > 1
      ? raw.slice(
          requiredConfigValue(existing[0]).end,
          requiredConfigValue(existing[1]).start
        )
      : "," + leading;
  // Keep every retained element and its unaffected separators verbatim. Only
  // the contiguous structural edit and its necessary adjacent separator move.
  if (changed.length === 0) {
    const start = right
      ? (existing[prefix]?.start ?? right.start)
      : (left?.end ?? array.start + 1);
    const end = right ? right.start : (existing.at(-1)?.end ?? array.end - 1);
    return raw.slice(0, start) + raw.slice(end);
  }
  const start = existing[prefix]?.start ?? left?.end ?? array.start + 1;
  const end = suffix
    ? (existing[existing.length - suffix - 1]?.end ?? start)
    : (existing.at(-1)?.end ?? start);
  // An insertion has no old elements; leave their separator on its original side.
  const insertion = prefix + suffix === existing.length;
  const at = insertion && right ? right.start : start;
  const until = insertion ? at : end;
  return (
    raw.slice(0, at) +
    (insertion && left && !right ? separator : "") +
    (!existing.length ? leading : "") +
    changed.join(separator) +
    (insertion && right ? separator : "") +
    raw.slice(until)
  );
}

export type VerificationConfigEdit =
  | {
      operation: "add" | "edit";
      profile: VerificationProfile;
      clearBootstrap: boolean;
      commandOrigins?: (number | null)[];
    }
  | { operation: "remove"; profileId: string; clearBootstrap: false }
  | { operation: "bootstrap"; value: boolean | undefined };

/** Produces reviewable bytes only; the exclusive transaction owner publishes them. */
export function editVerificationConfigBytes(
  raw: string,
  edit: VerificationConfigEdit
): string {
  const config = parseConfig(JSON.parse(raw) as unknown);
  if (config.schemaVersion === 1)
    throw new BanzaiError(
      "VERIFICATION_LEGACY_CONFIG",
      "Guided changes require schema 2 or 3. Follow documentation/orchestrator.md#project-verification-readiness for the legacy migration."
    );
  let updated = raw;
  if (edit.operation === "bootstrap") {
    updated = editJsonProperty(
      updated,
      ["verification"],
      "bootstrap",
      edit.value === undefined ? undefined : JSON.stringify(edit.value)
    );
  } else {
    const locations = jsonLocations(raw);
    const profiles = config.verification.profiles;
    const selectedId =
      edit.operation === "remove" ? edit.profileId : edit.profile.id;
    const selected = profiles.findIndex((profile) => profile.id === selectedId);
    const texts = profiles.map((_, index) => {
      const location = requiredConfigValue(
        locations.get(jsonPathKey(["verification", "profiles", String(index)]))
      );
      return raw.slice(location.start, location.end);
    });
    if (edit.operation === "add") {
      if (selected >= 0)
        throw new BanzaiError(
          "VERIFICATION_PROFILE_CONFLICT",
          "Profile ID is already configured. Request a fresh preview."
        );
      texts.push(JSON.stringify(edit.profile));
    } else {
      if (selected < 0)
        throw new BanzaiError(
          "VERIFICATION_PROFILE_MISSING",
          "The selected profile no longer exists. Run banzai verify list."
        );
      if (edit.operation === "remove") {
        if (profiles.length === 1)
          throw new BanzaiError(
            "VERIFICATION_PROFILE_REQUIRED",
            "The final verification profile cannot be removed. Add or edit a profile first."
          );
        texts.splice(selected, 1);
      } else {
        const original = requiredConfigValue(profiles[selected]);
        if (original.projectType !== edit.profile.projectType)
          throw new BanzaiError(
            "VERIFICATION_PROFILE_CONFLICT",
            "Profile editing must preserve the project type."
          );
        const text = requiredConfigValue(texts[selected]);
        const commandLocations = jsonLocations(text);
        const used = new Set<number>();
        if (
          edit.commandOrigins &&
          (edit.commandOrigins.length !== edit.profile.commands.length ||
            edit.commandOrigins.some(
              (value) =>
                value !== null &&
                (!Number.isSafeInteger(value) ||
                  value < 0 ||
                  value >= original.commands.length)
            ) ||
            new Set(edit.commandOrigins.filter((value) => value !== null))
              .size !==
              edit.commandOrigins.filter((value) => value !== null).length)
        )
          throw new BanzaiError(
            "VERIFICATION_PROFILE_CONFLICT",
            "Command origins must identify distinct original entries."
          );
        const commandTexts = edit.profile.commands.map((command, index) => {
          let priorIndex = edit.commandOrigins
            ? (edit.commandOrigins[index] ?? -1)
            : original.commands.findIndex(
                (candidate, i) =>
                  !used.has(i) &&
                  (command.id !== undefined
                    ? candidate.id === command.id
                    : JSON.stringify(candidate) === JSON.stringify(command))
              );
          // Callers editing and moving entries supply explicit original ordinals.
          // Never attach another command's unknown fields to a newly assigned ID.
          if (
            !edit.commandOrigins &&
            config.schemaVersion === 2 &&
            priorIndex < 0 &&
            index < original.commands.length &&
            !used.has(index)
          )
            priorIndex = index;
          if (priorIndex < 0) return JSON.stringify(command);
          used.add(priorIndex);
          const location = requiredConfigValue(
            commandLocations.get(jsonPathKey(["commands", String(priorIndex)]))
          );
          let commandText = text.slice(location.start, location.end);
          const document = JSON.parse(commandText) as Record<string, unknown>;
          for (const [field, value] of Object.entries(command)) {
            // Defaults do not justify rewriting an unselected representation.
            if (
              document[field] === undefined &&
              ((field === "evidence" && value === "fresh") ||
                (field === "ignoreExplanatory" && value === false))
            )
              continue;
            if (JSON.stringify(document[field]) !== JSON.stringify(value))
              commandText = editJsonProperty(
                commandText,
                [],
                field,
                JSON.stringify(value)
              );
          }
          return commandText;
        });
        texts[selected] = editJsonArray(text, ["commands"], commandTexts);
      }
    }
    updated = editJsonArray(updated, ["verification", "profiles"], texts);
    if (edit.clearBootstrap)
      updated = editJsonProperty(
        updated,
        ["verification"],
        "bootstrap",
        undefined
      );
  }
  parseConfig(JSON.parse(updated) as unknown);
  return updated;
}

/**
 * Rewrites only the model fields named by each update, leaving every other field
 * — including fields this version does not know about — exactly as written.
 * Timeouts in particular are never touched.
 */
export async function applyModelUpdates(
  repoRoot: string,
  updates: readonly ModelUpdate[]
): Promise<void> {
  if (updates.length === 0) {
    return;
  }
  const configPath = path.join(repoRoot, CONFIG_FILE);
  let raw: string;
  try {
    raw = await readFile(configPath, "utf8");
  } catch {
    throw new BanzaiError(
      "CONFIG_NOT_FOUND",
      `Missing ${CONFIG_FILE}. Run "banzai init" first.`
    );
  }

  let document: unknown;
  try {
    document = JSON.parse(raw) as unknown;
  } catch (error) {
    throw new BanzaiError(
      "INVALID_CONFIG",
      `${CONFIG_FILE} is not valid JSON: ${(error as Error).message}`
    );
  }

  // The cast is an assumption about parsed JSON, not a guarantee: `null` is a
  // value the file can actually contain, so the guard below must still reject
  // it.
  const models = (document as { models?: Record<string, unknown> | null })
    .models;
  if (typeof models !== "object" || models === null) {
    throw new BanzaiError(
      "INVALID_CONFIG",
      `${CONFIG_FILE} has no models section.`
    );
  }
  const updateTargets = updates.map((update) => {
    const settings = models[update.role];
    if (typeof settings !== "object" || settings === null) {
      throw new BanzaiError(
        "INVALID_CONFIG",
        `${CONFIG_FILE} has no models.${update.role} section.`
      );
    }
    return { update, fields: settings as Record<string, unknown> };
  });

  // Updates are lossless edits to an already valid tracked contract, not a
  // repair path for malformed configuration.
  parseConfig(document);

  const replacements = new Map<string, string>();
  for (const { update, fields } of updateTargets) {
    fields.model = update.model;
    replacements.set(
      jsonPathKey(["models", update.role, "model"]),
      JSON.stringify(update.model)
    );
    if (update.executable !== undefined) {
      fields.executable = update.executable;
      replacements.set(
        jsonPathKey(["models", update.role, "executable"]),
        JSON.stringify(update.executable)
      );
    }
    if (update.effort !== undefined) {
      fields.effort = update.effort;
      replacements.set(
        jsonPathKey(["models", update.role, "effort"]),
        JSON.stringify(update.effort)
      );
    }
  }

  // Never leave a config on disk that the runner would refuse to load.
  parseConfig(document);
  const updatedRaw = replaceJsonValues(raw, replacements);
  parseConfig(JSON.parse(updatedRaw) as unknown);
  await writeFile(configPath, updatedRaw, "utf8");
}

export async function initializeConfig(
  repoRoot: string
): Promise<{ configCreated: boolean; gitignoreUpdated: boolean }> {
  const banzaiDirectory = path.join(repoRoot, CONFIG_DIRECTORY);
  const configPath = path.join(repoRoot, CONFIG_FILE);
  await mkdir(banzaiDirectory, { recursive: true });

  let configCreated = false;
  if (!(await pathExists(configPath))) {
    await writeFile(
      configPath,
      `${JSON.stringify(DEFAULT_TASK_CONFIG, null, 2)}\n`,
      {
        encoding: "utf8",
        flag: "wx"
      }
    );
    configCreated = true;
  }

  const ignorePath = path.join(repoRoot, ".gitignore");
  const requiredEntries = [
    ".banzai/runs/",
    ".banzai/active-run.json",
    ".banzai/runner.lock"
  ];
  let current = "";
  if (await pathExists(ignorePath)) {
    current = await readFile(ignorePath, "utf8");
  }
  const existingLines = new Set(current.split(/\r?\n/));
  const missing = requiredEntries.filter((entry) => !existingLines.has(entry));
  if (missing.length === 0) {
    return { configCreated, gitignoreUpdated: false };
  }

  const separator = current.length === 0 || current.endsWith("\n") ? "" : "\n";
  const prefix = current.length === 0 ? "" : "# Banzai local workflow state\n";
  await writeFile(
    ignorePath,
    `${current}${separator}${prefix}${missing.join("\n")}\n`,
    "utf8"
  );
  return { configCreated, gitignoreUpdated: true };
}
