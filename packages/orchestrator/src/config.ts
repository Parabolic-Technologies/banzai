import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { BanzaiError } from "./errors.js";
import type { ModelRole } from "./models.js";
import {
  CONTRACT_VERSION,
  type ModelSettings,
  type OrchestratorConfig
} from "./types.js";
import { parseConfig } from "./validation.js";

export const CONFIG_DIRECTORY = ".banzai";
export const CONFIG_FILE = path.join(CONFIG_DIRECTORY, "config.json");

export const DEFAULT_CONFIG: OrchestratorConfig = {
  schemaVersion: 3,
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
            id: "git-diff-check",
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

function jsonPathKey(pathParts: readonly string[]): string {
  return JSON.stringify(pathParts);
}

function replaceJsonValues(
  raw: string,
  replacements: ReadonlyMap<string, string>
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
      const key = parseStringToken();
      skipWhitespace();
      if (raw[index] !== ":") {
        invalidSource();
      }
      index += 1;
      parseValue([...pathParts, key]);
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
      `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`,
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
