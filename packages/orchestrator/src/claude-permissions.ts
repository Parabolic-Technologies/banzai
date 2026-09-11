import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { FALLBACK_VENDOR, MODEL_ROLES, vendorFor } from "./models.js";
import type { OrchestratorConfig } from "./types.js";

/**
 * Claude subprocess permission readiness.
 *
 * Every Banzai Claude invocation runs with `--permission-mode dontAsk`, which
 * answers a permission prompt with a denial instead of a human. Only three
 * surfaces can still grant a call: the spec-gate hook, which allows exactly the
 * approved bundle while a phase carries runner identity; an `--allowedTools`
 * entry, which the run spends on the Serena whitelist alone; and the permission
 * rules of the settings files the session loads.
 *
 * Planning phases deliberately carry no runner identity — that is what keeps a
 * planner from writing code — so the hook defers their documentation writes to
 * the ordinary permission flow, and under `dontAsk` that flow is the third
 * surface or nothing. A checkout that never granted `Write` therefore denies
 * every artifact the phase exists to produce, after the model has already been
 * paid for. Shell commands are never hook-granted in any phase, so a Claude
 * planner or implementer keeps only the commands a scoped rule already names.
 *
 * Both preconditions are readable offline: which settings sources the resolved
 * invocation scope loads, and Claude Code's workspace trust record, which makes
 * it ignore every repository-scoped allow rule of an untrusted checkout.
 */

export type ClaudeSettingSource = "user" | "project" | "local";
export type ClaudePermissionTool = "Write" | "Edit" | "Bash";
export type ClaudeToolGrant = "granted" | "scoped" | "missing" | "denied";
export type ClaudeTrustState = "trusted" | "untrusted" | "unknown";

export interface ClaudeToolPermission {
  tool: ClaudePermissionTool;
  grant: ClaudeToolGrant;
}

/** Which ambient grants the configured roles actually depend on. */
export interface ClaudePermissionDemand {
  /** A Claude planner writes artifacts no runner authorization covers. */
  planningWrites: boolean;
  /** A Claude planner or implementer runs shell commands. */
  shellCommands: boolean;
}

export interface ClaudePermissionAudit {
  demand: ClaudePermissionDemand;
  /** Settings sources the spawned session loads, in the order it loads them. */
  sources: ClaudeSettingSource[];
  trust: ClaudeTrustState;
  tools: ClaudeToolPermission[];
  /** Fixed reasons a writing phase cannot produce its artifacts. */
  blocking: string[];
  /** Fixed reasons a phase runs degraded rather than blocked. */
  advisories: string[];
}

export interface ClaudePermissionInput {
  repoRoot: string;
  demand: ClaudePermissionDemand;
  /**
   * The `--setting-sources` value the invocation passes, or `null` when the
   * scope leaves discovery ambient and Claude loads all three sources.
   */
  settingSources: string | null;
  env?: NodeJS.ProcessEnv;
  /**
   * Overrides the administrator policy file this platform reads. Tests pin it
   * so a machine that has one cannot change what the audit reports.
   */
  managedSettingsFile?: string | null;
}

const ALL_SOURCES: readonly ClaudeSettingSource[] = [
  "user",
  "project",
  "local"
];

/**
 * Policy settings are administrator-owned and apply to every session whatever
 * `--setting-sources` names, so a grant that lives there is real and must not
 * be reported missing.
 */
const MANAGED_SETTINGS_FILES: Readonly<Record<string, string>> = {
  darwin: "/Library/Application Support/ClaudeCode/managed-settings.json",
  linux: "/etc/claude-code/managed-settings.json"
};

interface RuleSet {
  allow: string[];
  deny: string[];
  ask: string[];
}

interface SourceRules {
  rules: RuleSet;
  /** False when a file exists but its JSON could not be parsed. */
  intact: boolean;
}

const EMPTY_RULES: RuleSet = { allow: [], deny: [], ask: [] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

/** The tool a permission rule names, with any path or command scope removed. */
function ruleTool(rule: string): string {
  const open = rule.indexOf("(");
  return (open === -1 ? rule : rule.slice(0, open)).trim();
}

function namesTool(rule: string, tool: ClaudePermissionTool): boolean {
  return ruleTool(rule) === tool;
}

function isUnscoped(rule: string): boolean {
  return !rule.includes("(");
}

function homeDirectory(env: NodeJS.ProcessEnv): string {
  const configured = env.HOME;
  return configured === undefined || configured.length === 0
    ? homedir()
    : configured;
}

function configDirectory(env: NodeJS.ProcessEnv): string | null {
  const configured = env.CLAUDE_CONFIG_DIR;
  return configured === undefined || configured.length === 0
    ? null
    : configured;
}

/**
 * The workspace trust record sits beside the default config directory and
 * inside an explicitly configured one.
 */
function trustFile(env: NodeJS.ProcessEnv): string {
  const configured = configDirectory(env);
  return configured === null
    ? path.join(homeDirectory(env), ".claude.json")
    : path.join(configured, ".claude.json");
}

function settingsFile(
  source: ClaudeSettingSource,
  repoRoot: string,
  env: NodeJS.ProcessEnv
): string {
  if (source === "user") {
    return path.join(
      configDirectory(env) ?? path.join(homeDirectory(env), ".claude"),
      "settings.json"
    );
  }
  return path.join(
    repoRoot,
    ".claude",
    source === "project" ? "settings.json" : "settings.local.json"
  );
}

async function readRules(filePath: string): Promise<SourceRules> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch {
    // Absent and unreadable are the same absence of a grant, and neither is
    // worth reporting on its own.
    return { rules: EMPTY_RULES, intact: true };
  }
  try {
    const document = JSON.parse(raw) as unknown;
    const permissions = isRecord(document) ? document.permissions : undefined;
    if (!isRecord(permissions)) {
      return { rules: EMPTY_RULES, intact: true };
    }
    return {
      rules: {
        allow: stringArray(permissions.allow),
        deny: stringArray(permissions.deny),
        ask: stringArray(permissions.ask)
      },
      intact: true
    };
  } catch {
    return { rules: EMPTY_RULES, intact: false };
  }
}

async function readManagedRules(
  override: string | null | undefined
): Promise<SourceRules> {
  const file =
    override === undefined
      ? MANAGED_SETTINGS_FILES[process.platform]
      : override;
  return file === undefined || file === null
    ? { rules: EMPTY_RULES, intact: true }
    : await readRules(file);
}

/**
 * Claude Code ignores every repository-scoped allow rule until the checkout is
 * trusted, and says so on stderr rather than failing, so an untrusted run looks
 * exactly like a run whose rules were never written.
 */
async function inspectTrust(
  repoRoot: string,
  env: NodeJS.ProcessEnv
): Promise<ClaudeTrustState> {
  let raw: string;
  try {
    raw = await readFile(trustFile(env), "utf8");
  } catch {
    return "unknown";
  }
  try {
    const document = JSON.parse(raw) as unknown;
    const projects = isRecord(document) ? document.projects : undefined;
    if (!isRecord(projects)) {
      return "untrusted";
    }
    const entry = projects[repoRoot];
    return isRecord(entry) && entry.hasTrustDialogAccepted === true
      ? "trusted"
      : "untrusted";
  } catch {
    return "unknown";
  }
}

function resolveGrant(
  tool: ClaudePermissionTool,
  sets: readonly RuleSet[]
): ClaudeToolGrant {
  for (const set of sets) {
    // `dontAsk` turns an ask rule into a denial: nothing can answer it.
    const refused = [...set.deny, ...set.ask];
    if (refused.some((rule) => namesTool(rule, tool) && isUnscoped(rule))) {
      return "denied";
    }
  }
  let scoped = false;
  for (const set of sets) {
    for (const rule of set.allow) {
      if (!namesTool(rule, tool)) {
        continue;
      }
      if (isUnscoped(rule)) {
        return "granted";
      }
      scoped = true;
    }
  }
  return scoped ? "scoped" : "missing";
}

function parseSources(settingSources: string | null): ClaudeSettingSource[] {
  if (settingSources === null) {
    return [...ALL_SOURCES];
  }
  const named = new Set(
    settingSources
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
  );
  return ALL_SOURCES.filter((source) => named.has(source));
}

/**
 * Reads the configuration for the roles whose Claude phases depend on ambient
 * permission rules. A Claude reviewer needs none: its one write is the review
 * candidate the hook authorizes, and its shell access is already denied.
 */
export function claudePermissionDemand(
  config: OrchestratorConfig
): ClaudePermissionDemand {
  // The same resolution the runner's vendor preflight uses, so an unrecognized
  // executable is attributed to the vendor that will actually run the role.
  const claudeRoles = new Set(
    MODEL_ROLES.filter(
      (role) =>
        (vendorFor(config.models[role].executable) ?? FALLBACK_VENDOR[role]) ===
        "claude"
    )
  );
  return {
    planningWrites: claudeRoles.has("planner"),
    shellCommands: claudeRoles.has("planner") || claudeRoles.has("implementer")
  };
}

export function claudePermissionDemanded(
  demand: ClaudePermissionDemand
): boolean {
  return demand.planningWrites || demand.shellCommands;
}

export async function inspectClaudePermissions(
  input: ClaudePermissionInput
): Promise<ClaudePermissionAudit> {
  const env = input.env ?? process.env;
  const repoRoot = path.resolve(input.repoRoot);
  const demand = input.demand;
  const sources = parseSources(input.settingSources);
  const [managed, trust, loaded, unloadedLocal] = await Promise.all([
    readManagedRules(input.managedSettingsFile),
    inspectTrust(repoRoot, env),
    Promise.all(
      sources.map(async (source) => ({
        source,
        ...(await readRules(settingsFile(source, repoRoot, env)))
      }))
    ),
    sources.includes("local")
      ? Promise.resolve(null)
      : readRules(settingsFile("local", repoRoot, env))
  ]);

  // An untrusted checkout keeps its rules on disk and out of the session, so
  // grants must be resolved from what the session will actually honor.
  const honored = loaded.filter(
    (entry) => entry.source === "user" || trust !== "untrusted"
  );
  const sets = [managed.rules, ...honored.map((entry) => entry.rules)];
  const audited: ClaudePermissionTool[] = [
    ...(demand.planningWrites ? (["Write", "Edit"] as const) : []),
    ...(demand.shellCommands ? (["Bash"] as const) : [])
  ];
  const tools = audited.map((tool) => ({
    tool,
    grant: resolveGrant(tool, sets)
  }));
  const grantOf = (tool: ClaudePermissionTool): ClaudeToolGrant | null =>
    tools.find((entry) => entry.tool === tool)?.grant ?? null;

  const blocking: string[] = [];
  const advisories: string[] = [];
  const write = grantOf("Write");
  if (write === "denied") {
    blocking.push(
      "A deny or ask rule refuses Write, and `--permission-mode dontAsk` cannot escalate either one to a human."
    );
  }
  if (write === "missing") {
    blocking.push(
      "No loaded permission rule grants Write, so a Claude planning phase is denied the description, plan, and decision artifacts it exists to produce."
    );
  }
  if (
    (write === "missing" || write === "denied") &&
    trust === "untrusted" &&
    sources.some((source) => source !== "user")
  ) {
    blocking.push(
      "Claude Code has not been trusted in this checkout, so it ignores the repository's own permission rules."
    );
  }
  if (
    (write === "missing" || write === "denied") &&
    unloadedLocal !== null &&
    unloadedLocal.rules.allow.length > 0
  ) {
    advisories.push(
      "Local settings hold allow rules the scoped invocation does not load; repository grants belong in the tracked project settings."
    );
  }
  if (write === "scoped") {
    advisories.push(
      "Every rule granting Write is path-scoped, so a planning artifact outside those paths is still denied."
    );
  }
  const edit = grantOf("Edit");
  if (edit === "missing" || edit === "denied") {
    advisories.push(
      "No loaded permission rule grants Edit, so a planning phase can create artifacts but not revise them."
    );
  }
  const bash = grantOf("Bash");
  if (bash === "missing" || bash === "denied") {
    advisories.push(
      "No loaded permission rule grants Bash, so every command a phase runs is denied."
    );
  } else if (bash === "scoped") {
    advisories.push(
      "Bash is granted only for the commands its scoped rules name; anything else a phase runs is denied."
    );
  }
  if (trust === "unknown") {
    advisories.push(
      "Claude Code's workspace trust record could not be read, so repository rules were treated as honored."
    );
  }
  if (!managed.intact || loaded.some((entry) => !entry.intact)) {
    advisories.push(
      "A settings file could not be parsed, so its permission rules were treated as absent."
    );
  }
  return { demand, sources, trust, tools, blocking, advisories };
}

/**
 * The fix, in the order an operator applies it. It lives beside the audit so
 * every caller repeats one remediation instead of drifting from it.
 */
export function claudePermissionRemediation(
  audit: ClaudePermissionAudit
): string {
  const steps: string[] = [];
  if (audit.trust === "untrusted" && audit.sources.includes("project")) {
    steps.push(
      "run `claude` once in this checkout and accept the trust prompt"
    );
  }
  const unresolved = audit.tools.filter(
    (entry) =>
      entry.tool !== "Bash" &&
      (entry.grant === "missing" || entry.grant === "denied")
  );
  if (unresolved.length > 0) {
    steps.push(
      `add ${unresolved
        .map((entry) => `"${entry.tool}"`)
        .join(" and ")} to \`permissions.allow\` in \`.claude/settings.json\``
    );
    if (!audit.sources.includes("local")) {
      steps.push(
        "keep the grants there rather than in local settings, the one repository source a scoped invocation never loads"
      );
    }
  }
  return steps.join("; ");
}
