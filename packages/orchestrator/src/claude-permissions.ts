import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { FALLBACK_VENDOR, MODEL_ROLES, vendorFor } from "./models.js";
import type {
  ClaudeEnvironmentSettings,
  ClaudeInvocationScope,
  OrchestratorConfig,
  PermissionDenial
} from "./types.js";

/**
 * Claude subprocess permission readiness.
 *
 * Every Banzai Claude invocation runs with `--permission-mode dontAsk`, which
 * answers a permission prompt with a denial instead of a human. Only three
 * surfaces can still grant a call: the spec-gate hook, which allows exactly the
 * writes the bound run authorizes for the current phase (ADR-0041); an
 * `--allowedTools` entry, which the run spends on the Serena whitelist alone;
 * and the permission rules of the settings files the session loads.
 *
 * File writes therefore need no ambient grant: planning and implementation
 * phases carry runner identity, and the hook's allow skips the prompt that
 * `dontAsk` would deny. No hook decision overrides a deny or ask rule, though,
 * so a rule refusing `Write` or `Edit` still denies every write the hook
 * authorized. Shell commands are never hook-granted in any phase, so a Claude
 * planner or implementer keeps only the commands a loaded allow rule names.
 *
 * Both preconditions are readable offline: which settings sources the resolved
 * invocation scope loads, and Claude Code's workspace trust record, which makes
 * it ignore every repository-scoped allow rule of an untrusted checkout. Deny
 * and ask rules only restrict, so trust never suspends them.
 */

export type ClaudeSettingSource = "user" | "project" | "local";
export type ClaudePermissionTool = "Write" | "Edit" | "Bash";
export type ClaudeToolGrant = "granted" | "scoped" | "missing" | "denied";
export type ClaudeTrustState = "trusted" | "untrusted" | "unknown";

export interface ClaudeToolPermission {
  tool: ClaudePermissionTool;
  grant: ClaudeToolGrant;
}

/** Which permission rules the configured roles actually depend on. */
export interface ClaudePermissionDemand {
  /**
   * A Claude planner or implementer writes files. The hook grants each write,
   * so only a rule refusing one matters. A run created before work bindings
   * plans without runner identity and would still need an ambient grant.
   */
  fileWrites: boolean;
  /** A Claude planner or implementer runs shell commands. */
  shellCommands: boolean;
}

export interface ClaudePermissionAudit {
  demand: ClaudePermissionDemand;
  /** Settings sources the spawned session loads, in the order it loads them. */
  sources: ClaudeSettingSource[];
  trust: ClaudeTrustState;
  tools: ClaudeToolPermission[];
  /** An untrusted checkout holds repository allow rules Claude Code ignores. */
  repositoryRulesIgnored: boolean;
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
  refusing: readonly RuleSet[],
  granting: readonly RuleSet[]
): ClaudeToolGrant {
  for (const set of refusing) {
    // `dontAsk` turns an ask rule into a denial: nothing can answer it.
    const refused = [...set.deny, ...set.ask];
    if (refused.some((rule) => namesTool(rule, tool) && isUnscoped(rule))) {
      return "denied";
    }
  }
  let scoped = false;
  for (const set of granting) {
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
 * Reads the configuration for the roles whose Claude phases depend on
 * permission rules. A Claude reviewer depends on none: it receives neither
 * write nor shell tools.
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
  const builds = claudeRoles.has("planner") || claudeRoles.has("implementer");
  return { fileWrites: builds, shellCommands: builds };
}

export function claudePermissionDemanded(
  demand: ClaudePermissionDemand
): boolean {
  return demand.fileWrites || demand.shellCommands;
}

export type ConfiguredClaudePermissions =
  | { state: "not_demanded" }
  | { state: "unresolved" }
  | { state: "audited"; audit: ClaudePermissionAudit };

export interface ConfiguredClaudePermissionDependencies {
  /**
   * Resolves the configured invocation scope. Injected so this module stays
   * free of the adapters that own scope resolution.
   */
  resolveScope(
    settings: ClaudeEnvironmentSettings
  ): Promise<{ scope: Pick<ClaudeInvocationScope, "settingSources"> }>;
  inspect?(input: ClaudePermissionInput): Promise<ClaudePermissionAudit>;
}

/**
 * Audits the configured roles against the setting sources their resolved scope
 * loads. A scope that cannot be resolved is the environment's failure to
 * report, so it yields `unresolved` rather than a permission finding.
 */
export async function inspectConfiguredClaudePermissions(
  repoRoot: string,
  config: OrchestratorConfig,
  dependencies: ConfiguredClaudePermissionDependencies
): Promise<ConfiguredClaudePermissions> {
  const demand = claudePermissionDemand(config);
  if (!claudePermissionDemanded(demand)) {
    return { state: "not_demanded" };
  }
  let settingSources: string | null;
  try {
    settingSources = (await dependencies.resolveScope(config.claudeEnvironment))
      .scope.settingSources;
  } catch {
    return { state: "unresolved" };
  }
  const audit = await (dependencies.inspect ?? inspectClaudePermissions)({
    repoRoot,
    demand,
    settingSources
  });
  return { state: "audited", audit };
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
  const granting = [managed.rules, ...honored.map((entry) => entry.rules)];
  // Claude Code applies a repository's deny and ask rules before the checkout
  // is trusted, because they only restrict.
  const refusing = [managed.rules, ...loaded.map((entry) => entry.rules)];
  const audited: ClaudePermissionTool[] = [
    ...(demand.fileWrites ? (["Write", "Edit"] as const) : []),
    ...(demand.shellCommands ? (["Bash"] as const) : [])
  ];
  const tools = audited.map((tool) => ({
    tool,
    grant: resolveGrant(tool, refusing, granting)
  }));
  const grantOf = (tool: ClaudePermissionTool): ClaudeToolGrant | null =>
    tools.find((entry) => entry.tool === tool)?.grant ?? null;
  const repositoryRulesIgnored =
    trust === "untrusted" &&
    loaded.some(
      (entry) => entry.source !== "user" && entry.rules.allow.length > 0
    );

  const blocking: string[] = [];
  const advisories: string[] = [];
  const refused = tools
    .filter((entry) => entry.tool !== "Bash" && entry.grant === "denied")
    .map((entry) => entry.tool);
  if (refused.length > 0) {
    blocking.push(
      `A deny or ask rule refuses ${refused.join(" and ")}. No hook decision overrides it and \`--permission-mode dontAsk\` cannot escalate it to a human, so Claude planning and implementation writes are denied.`
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
  if (repositoryRulesIgnored) {
    advisories.push(
      "Claude Code has not been trusted in this checkout, so it ignores the repository's own allow rules."
    );
  }
  if (
    bash !== null &&
    bash !== "granted" &&
    unloadedLocal !== null &&
    unloadedLocal.rules.allow.length > 0
  ) {
    advisories.push(
      "Local settings hold allow rules the scoped invocation does not load; repository grants belong in the tracked project settings."
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
  return {
    demand,
    sources,
    trust,
    tools,
    repositoryRulesIgnored,
    blocking,
    advisories
  };
}

/**
 * The fix, in the order an operator applies it. It lives beside the audit so
 * every caller repeats one remediation instead of drifting from it.
 */
export function claudePermissionRemediation(
  audit: ClaudePermissionAudit
): string {
  const steps: string[] = [];
  const refused = audit.tools.filter(
    (entry) => entry.tool !== "Bash" && entry.grant === "denied"
  );
  if (refused.length > 0) {
    steps.push(
      `remove the deny or ask rules naming ${refused
        .map((entry) => `"${entry.tool}"`)
        .join(
          " and "
        )} from the settings Claude loads; a rule in administrator policy settings needs your administrator`
    );
  }
  if (audit.repositoryRulesIgnored) {
    steps.push(
      "run `claude` once in this checkout and accept the trust prompt so its repository allow rules apply"
    );
  }
  return steps.join("; ");
}

/**
 * Whether Claude's user settings enable the Banzai plugin. User scope loads its
 * skill descriptions into every session in every repository, while local and
 * project scope keep them to this checkout. Doctor reports the first as
 * advisory, so only the user file is read; Claude's plugin cache and CLI are
 * never consulted.
 */
export type ClaudeUserPluginScope =
  | { state: "enabled"; path: string; keys: string[] }
  | { state: "not_enabled"; path: string }
  | { state: "unreadable"; path: string };

/** The plugin a key names, before its last `@marketplace` part. */
function pluginName(key: string): string {
  const separator = key.lastIndexOf("@");
  return separator === -1 ? key : key.slice(0, separator);
}

export async function inspectClaudeUserPluginScope(
  env: NodeJS.ProcessEnv
): Promise<ClaudeUserPluginScope> {
  // The user file ignores the repository root.
  const file = settingsFile("user", "", env);
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT"
      ? { state: "not_enabled", path: file }
      : { state: "unreadable", path: file };
  }
  let document: unknown;
  try {
    document = JSON.parse(raw) as unknown;
  } catch {
    return { state: "unreadable", path: file };
  }
  if (!isRecord(document)) {
    return { state: "unreadable", path: file };
  }
  const enabled = document.enabledPlugins;
  const keys = isRecord(enabled)
    ? Object.keys(enabled)
        .filter((key) => pluginName(key) === "banzai" && enabled[key] === true)
        .sort()
    : [];
  return keys.length === 0
    ? { state: "not_enabled", path: file }
    : { state: "enabled", path: file, keys };
}

/**
 * Denied tool calls as a remediation list.
 *
 * Claude Code reports every call it denied without a prompt. The functions
 * below turn that list into the block a human reads and the record a later
 * `banzai status` repeats. They propose rules and write none: what Claude may
 * do in a settings file stays the operator's decision.
 */

/** What the `attempt.permission_denials` run event carries. */
export interface PermissionDenialRecord {
  attemptId: string;
  kind: string;
  /** Every denied call of the attempt, including those not stored. */
  count: number;
  denials: PermissionDenial[];
}

export const MAX_RECORDED_PERMISSION_DENIALS = 50;
const MAX_REPORTED_PERMISSION_DENIALS = 20;
const MAX_RULE_COMMAND_LENGTH = 200;
const MAX_DENIAL_DETAIL_LENGTH = 240;
/**
 * A proposed rule names one plain command and nothing wider. An operator, a
 * redirection, a substitution or a subshell makes a command more than one
 * call, and `*` would turn the exact rule into a pattern.
 */
const RULE_UNSAFE_CHARACTERS = /[;&|<>`()*\n\r]|\$\(/;
const UNSAFE_DISPLAY_CHARACTERS =
  /[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/;
const RECORDED_TOOL_NAME = /^[A-Za-z0-9_.:-]{1,100}$/;
const RECORDED_REASON_TYPE = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
const RECORDED_IDENTIFIER = /^[A-Za-z0-9_.-]{1,200}$/;

/**
 * The exact-match allow rule for one denied Bash command, or null when the
 * command is not one plain call. The rule grants what was denied and no more.
 */
export function proposedAllowRule(command: string): string | null {
  const exact = command.trim();
  if (
    exact.length === 0 ||
    exact.length > MAX_RULE_COMMAND_LENGTH ||
    exact !== command ||
    RULE_UNSAFE_CHARACTERS.test(exact) ||
    UNSAFE_DISPLAY_CHARACTERS.test(exact)
  ) {
    return null;
  }
  return `Bash(${exact})`;
}

function refusedByRule(denial: PermissionDenial): boolean {
  return denial.reasonType === "rule";
}

interface DeniedCallGroup {
  tool: string;
  detail: string;
  times: number;
  subagent: boolean;
  refused: boolean;
  rule: string | null;
}

function groupDeniedCalls(
  denials: readonly PermissionDenial[]
): DeniedCallGroup[] {
  const groups = new Map<string, DeniedCallGroup>();
  for (const denial of denials) {
    const key = `${denial.tool}\u0000${denial.command ?? denial.detail}`;
    const group = groups.get(key);
    const refused = refusedByRule(denial);
    // No allow rule overrides a deny or ask rule, so none is proposed.
    const rule =
      denial.tool === "Bash" && !refused && denial.command !== null
        ? proposedAllowRule(denial.command)
        : null;
    if (group === undefined) {
      groups.set(key, {
        tool: denial.tool,
        detail: denial.detail,
        times: 1,
        subagent: denial.subagent,
        refused,
        rule
      });
      continue;
    }
    group.times += 1;
    group.subagent ||= denial.subagent;
    group.refused ||= refused;
    if (group.refused) {
      group.rule = null;
    }
  }
  return [...groups.values()];
}

function deniedCallLine(group: DeniedCallGroup): string {
  const marks = [
    ...(group.times > 1 ? [`${group.times} times`] : []),
    ...(group.subagent ? ["subagent"] : []),
    ...(group.refused ? ["refused by a deny or ask rule"] : []),
    ...(group.tool === "Bash" && !group.refused && group.rule === null
      ? ["needs a hand-written rule"]
      : [])
  ];
  return `  - ${group.tool}${group.detail.length > 0 ? `: ${group.detail}` : ""}${
    marks.length > 0 ? ` (${marks.join("; ")})` : ""
  }`;
}

/** The settings file the session loads last, which is where a rule belongs. */
function ruleTarget(audit: ClaudePermissionAudit | null): {
  name: string;
  repository: boolean;
} {
  if (audit === null) {
    return { name: "the settings Claude loads", repository: false };
  }
  if (audit.sources.includes("local")) {
    return { name: ".claude/settings.local.json", repository: true };
  }
  if (audit.sources.includes("project")) {
    return {
      name: ".claude/settings.json (tracked and shared)",
      repository: true
    };
  }
  return { name: "your Claude user settings", repository: false };
}

/**
 * The block a human reads after an attempt with denied calls: each distinct
 * call once, then the exact rules that would allow the plain Bash commands and
 * the file the session actually loads. An empty list renders nothing.
 */
export function claudePermissionDenialReport(input: {
  denials: readonly PermissionDenial[];
  /** Every denied call of the attempt; the list may hold fewer. */
  count: number;
  phase: string;
  audit: ClaudePermissionAudit | null;
}): string[] {
  const groups = groupDeniedCalls(input.denials);
  if (groups.length === 0) {
    return [];
  }
  const count = Math.max(input.count, input.denials.length);
  const lines = [
    `Claude denied ${count} tool ${count === 1 ? "call" : "calls"} during ${input.phase.replace(/_/g, " ")}:`,
    ...groups.slice(0, MAX_REPORTED_PERMISSION_DENIALS).map(deniedCallLine)
  ];
  if (groups.length > MAX_REPORTED_PERMISSION_DENIALS) {
    lines.push(`  and ${groups.length - MAX_REPORTED_PERMISSION_DENIALS} more`);
  }
  const rules = [
    ...new Set(groups.flatMap((group) => (group.rule ? [group.rule] : [])))
  ];
  if (rules.length > 0) {
    const target = ruleTarget(input.audit);
    if (target.repository && input.audit?.trust === "untrusted") {
      lines.push(
        "First run `claude` once in this checkout and accept the trust prompt; until then Claude Code ignores the repository's allow rules."
      );
    }
    lines.push(
      `To allow the exact commands in later phases, add these rules to ${target.name}:`,
      ...JSON.stringify({ permissions: { allow: rules } }, null, 2)
        .split("\n")
        .map((line) => `  ${line}`)
    );
  }
  lines.push("Banzai never writes permission rules.");
  return lines;
}

/** The bounded record of one attempt's denied calls. */
export function permissionDenialRecord(
  attempt: { id: string; kind: string },
  denials: readonly PermissionDenial[]
): PermissionDenialRecord {
  return {
    attemptId: attempt.id,
    kind: attempt.kind,
    count: denials.length,
    denials: denials
      .slice(0, MAX_RECORDED_PERMISSION_DENIALS)
      .map((denial) => ({
        tool: denial.tool,
        detail: denial.detail,
        command: denial.command,
        reasonType: denial.reasonType,
        subagent: denial.subagent
      }))
  };
}

function displayText(value: unknown, maximum: number): string | null {
  return typeof value === "string" &&
    value.length <= maximum &&
    !UNSAFE_DISPLAY_CHARACTERS.test(value)
    ? value
    : null;
}

function parseRecordedDenial(value: unknown): PermissionDenial | null {
  if (!isRecord(value)) {
    return null;
  }
  const detail = displayText(value.detail, MAX_DENIAL_DETAIL_LENGTH);
  const command =
    value.command === null
      ? null
      : displayText(value.command, MAX_RULE_COMMAND_LENGTH);
  if (
    typeof value.tool !== "string" ||
    !RECORDED_TOOL_NAME.test(value.tool) ||
    detail === null ||
    (value.command !== null && command === null) ||
    typeof value.subagent !== "boolean" ||
    (value.reasonType !== null &&
      (typeof value.reasonType !== "string" ||
        !RECORDED_REASON_TYPE.test(value.reasonType)))
  ) {
    return null;
  }
  return {
    tool: value.tool,
    detail,
    command,
    reasonType: value.reasonType,
    subagent: value.subagent
  };
}

/**
 * Reads a recorded event back for display. The events file is local evidence
 * and still untrusted display input: a damaged record yields null, and an entry
 * that could not have been written by `permissionDenialRecord` is dropped.
 */
export function parsePermissionDenialRecord(
  details: unknown
): PermissionDenialRecord | null {
  if (
    !isRecord(details) ||
    typeof details.attemptId !== "string" ||
    !RECORDED_IDENTIFIER.test(details.attemptId) ||
    typeof details.kind !== "string" ||
    !RECORDED_IDENTIFIER.test(details.kind) ||
    typeof details.count !== "number" ||
    !Number.isSafeInteger(details.count) ||
    details.count < 0 ||
    !Array.isArray(details.denials)
  ) {
    return null;
  }
  return {
    attemptId: details.attemptId,
    kind: details.kind,
    count: details.count,
    denials: details.denials
      .slice(0, MAX_RECORDED_PERMISSION_DENIALS)
      .flatMap((entry) => {
        const denial = parseRecordedDenial(entry);
        return denial === null ? [] : [denial];
      })
  };
}
