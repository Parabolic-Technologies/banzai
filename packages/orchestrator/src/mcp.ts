import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { McpStdioServer, McpWhitelist, ProcessRunner } from "./types.js";

/**
 * Serena MCP whitelist resolution.
 *
 * ADR-0020 scopes every Claude subprocess with `--strict-mcp-config`, which by
 * itself loads zero MCP servers; ambient loading had cost ~36K tokens per
 * round-trip in unusable tool schemas. Serena is the one server worth that
 * budget here — the run evidence shows every phase navigating by `sed`/`grep`
 * where symbol navigation was the point — so it is re-admitted explicitly
 * through the same flag's sanctioned extension: `--mcp-config` names exactly
 * the whitelist, and `-c mcp_servers=...` does the equivalent for Codex.
 *
 * Nothing here invents configuration. Each vendor's definition is read from
 * that vendor's own registration (project `.mcp.json` or user `.claude.json`
 * for Claude; `codex mcp get serena --json` for Codex), and every gate that
 * fails downgrades to "no whitelist" with a reason — a missing Serena must
 * never block a run.
 */

const SERENA = "serena";
const CODEX_PROBE_TIMEOUT_MS = 10_000;

/**
 * Serena's non-mutating tools, enumerated rather than wildcarded.
 *
 * Two separate reasons keep the writers out, and either alone is decisive.
 * The hook that enforces the approved bundle matches
 * `Edit|Write|MultiEdit|NotebookEdit|apply_patch` and sees no MCP tool, so
 * `replace_symbol_body` or `replace_in_files` would edit the tree with the
 * spec gate blind to it. And a reviewer denied `Edit`, `Write`, and `Bash`
 * would regain an edit path the denial exists to close. A writing phase loses
 * nothing: it already holds `Edit` and `Write`, and what it lacked was
 * navigation, not another way to write.
 *
 * Enumeration is what makes this hold across upgrades: a tool Serena adds
 * later is unreachable until it is listed here, so a new mutating tool cannot
 * widen the grant on its own.
 */
const SERENA_READ_ONLY_TOOLS = [
  "find_declaration",
  "find_implementations",
  "find_referencing_symbols",
  "find_symbol",
  "get_diagnostics_for_file",
  "get_symbols_overview",
  "initial_instructions",
  "list_memories",
  "read_memory"
];

/**
 * The `--allowedTools` value that makes the whitelisted server callable.
 *
 * A whitelisted server is not a usable server: `--permission-mode dontAsk`
 * implicitly allows only the built-in tools named by `--tools` and denies every
 * MCP tool no `--allowedTools` entry names. Without this the session lists
 * Serena's schemas, pays for them, and is refused on first call.
 */
export function serenaAllowedTools(): string {
  return SERENA_READ_ONLY_TOOLS.map((tool) => `mcp__${SERENA}__${tool}`).join(
    ","
  );
}

export interface SerenaWhitelistInput {
  repoRoot: string;
  /** The configured codex executable, or null when no role runs codex. */
  codexExecutable: string | null;
  env: NodeJS.ProcessEnv;
  runner: ProcessRunner;
}

async function readable(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolves a command the way the child's spawn will: an explicit path is
 * checked directly, a bare name is searched on the sanitized environment's
 * PATH. Only existence is decided here; the vendor still spawns the command
 * itself.
 */
async function commandResolves(
  command: string,
  env: NodeJS.ProcessEnv
): Promise<boolean> {
  if (command.length === 0) {
    return false;
  }
  if (command.includes(path.sep)) {
    return await readable(command);
  }
  const searchPath = env.PATH ?? "";
  for (const directory of searchPath.split(path.delimiter)) {
    if (directory.length === 0) {
      continue;
    }
    try {
      await access(path.join(directory, command), constants.X_OK);
      return true;
    } catch {
      // Keep searching.
    }
  }
  return false;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function stringRecord(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  const record: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string") {
      record[key] = entry;
    }
  }
  return record;
}

function parseClaudeServer(value: unknown): McpStdioServer | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  // Claude's stdio entries either say so or omit the type entirely.
  const type = record.type ?? "stdio";
  if (type !== "stdio" || typeof record.command !== "string") {
    return null;
  }
  return {
    command: record.command,
    args: stringArray(record.args),
    env: stringRecord(record.env),
    startupTimeoutSec: null
  };
}

/** `$CLAUDE_CONFIG_DIR/.claude.json`, else `~/.claude.json`. */
function claudeUserConfigPath(env: NodeJS.ProcessEnv): string {
  const configDir = env.CLAUDE_CONFIG_DIR;
  if (configDir !== undefined && configDir.length > 0) {
    return path.join(configDir, ".claude.json");
  }
  return path.join(env.HOME ?? homedir(), ".claude.json");
}

async function serversFrom(
  filePath: string
): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(filePath, "utf8"));
    const servers = (parsed as Record<string, unknown>).mcpServers;
    return typeof servers === "object" && servers !== null
      ? (servers as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * The project's shared `.mcp.json` wins over the user-scope registration, the
 * same precedence Claude itself applies to ambient configuration.
 */
async function claudeSerena(
  repoRoot: string,
  env: NodeJS.ProcessEnv,
  notes: string[]
): Promise<McpStdioServer | null> {
  const sources = [path.join(repoRoot, ".mcp.json"), claudeUserConfigPath(env)];
  for (const source of sources) {
    const servers = await serversFrom(source);
    const server = parseClaudeServer(servers?.[SERENA]);
    if (server === null) {
      continue;
    }
    if (!(await commandResolves(server.command, env))) {
      notes.push(
        `claude: serena command \`${server.command}\` is not executable on PATH`
      );
      return null;
    }
    return server;
  }
  notes.push(
    "claude: serena is not registered (checked .mcp.json and the user-scope .claude.json)"
  );
  return null;
}

/**
 * Codex is the authority on its own registration, and `codex mcp get --json`
 * is its stable read surface — no TOML parsing, no path guessing.
 */
async function codexSerena(
  input: SerenaWhitelistInput,
  notes: string[]
): Promise<McpStdioServer | null> {
  if (input.codexExecutable === null) {
    return null;
  }
  let stdout: string;
  try {
    const result = await input.runner({
      command: input.codexExecutable,
      args: ["mcp", "get", SERENA, "--json"],
      cwd: input.repoRoot,
      env: input.env,
      timeoutMs: CODEX_PROBE_TIMEOUT_MS
    });
    if (result.exitCode !== 0) {
      notes.push("codex: serena is not registered in the codex configuration");
      return null;
    }
    stdout = result.stdout;
  } catch (error) {
    notes.push(
      `codex: could not read the MCP registration (${error instanceof Error ? error.message : String(error)})`
    );
    return null;
  }
  try {
    const record = JSON.parse(stdout) as Record<string, unknown>;
    if (record.enabled !== true) {
      notes.push("codex: serena is registered but disabled");
      return null;
    }
    const transport = record.transport as Record<string, unknown> | undefined;
    if (transport?.type !== "stdio" || typeof transport.command !== "string") {
      notes.push("codex: serena is not a stdio server");
      return null;
    }
    const server: McpStdioServer = {
      command: transport.command,
      args: stringArray(transport.args),
      env: stringRecord(transport.env),
      startupTimeoutSec:
        typeof record.startup_timeout_sec === "number" &&
        Number.isFinite(record.startup_timeout_sec)
          ? record.startup_timeout_sec
          : null
    };
    if (!(await commandResolves(server.command, input.env))) {
      notes.push(
        `codex: serena command \`${server.command}\` is not executable on PATH`
      );
      return null;
    }
    return server;
  } catch {
    notes.push("codex: the MCP registration was not readable JSON");
    return null;
  }
}

/**
 * Resolves the availability-gated Serena whitelist for both vendors. Never
 * throws: every gate that fails produces a note and an absent entry, so the
 * caller can report why the whitelist is smaller than expected and continue.
 */
export async function resolveSerenaWhitelist(
  input: SerenaWhitelistInput
): Promise<McpWhitelist> {
  const notes: string[] = [];
  const projectMarker = path.join(input.repoRoot, ".serena", "project.yml");
  if (!(await readable(projectMarker))) {
    return {
      claude: null,
      codex: null,
      notes: [
        "serena: .serena/project.yml is missing, so there is no project to serve"
      ]
    };
  }
  const [claude, codex] = await Promise.all([
    claudeSerena(input.repoRoot, input.env, notes),
    codexSerena(input, notes)
  ]);
  return { claude, codex, notes };
}
