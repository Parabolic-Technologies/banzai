import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BanzaiError, errorMessage, ProcessExitError } from "./errors.js";
import { formatUsage } from "./format.js";
import { modelCliMinimum, vendorFor, type Vendor } from "./models.js";
import {
  redactSensitiveText,
  runProcess,
  subscriptionOnlyEnvironment
} from "./process.js";
import {
  claudeJsonSchema as sanitizeClaudeJsonSchema,
  resolveOutputContract
} from "./output-contract.js";
import type {
  AdapterResult,
  PlanningAdapterRequest,
  PlanningReviewResult,
  PlanningReviewAnalysis,
  ClaudeEnvironmentSettings,
  ClaudeInvocationScope,
  ModelFailureCause,
  ModelProgressEvent,
  McpStdioServer,
  McpWhitelist,
  ModelSettings,
  ModelUsage,
  OutputContractEnvelope,
  OutputContractIdentity,
  PhaseAdapterRequest,
  PhaseResult,
  PhaseResultEnvelope,
  ProcessResult,
  ProcessRunner,
  PromptEnvelope,
  ReviewAdapterRequest,
  ReviewResult,
  SessionInventory,
  VendorAdapters,
  VendorPreflightTarget,
  WorkflowSelectionAdapterRequest
} from "./types.js";
import { resolveSerenaWhitelist, serenaAllowedTools } from "./mcp.js";
import {
  parsePlanningReviewResult,
  parsePlanningReviewAnalysis,
  parsePhaseResult,
  parsePhaseResultEnvelope,
  parseCurrentReviewResult,
  parseWorkflowSelectionResult
} from "./validation.js";

export const MINIMUM_CODEX_VERSION = "0.145.0";
export const MINIMUM_CLAUDE_VERSION = "2.1.218";
const MAX_FAILURE_SUMMARY_LENGTH = 1_000;
const MAX_PROGRESS_DETAIL_LENGTH = 240;

type JsonRecord = Record<string, unknown>;

function jsonRecord(value: unknown): JsonRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function progressDetail(value: unknown): string {
  const detail = redactSensitiveText(typeof value === "string" ? value : "")
    .replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return detail.length <= MAX_PROGRESS_DETAIL_LENGTH
    ? detail
    : `${detail.slice(0, MAX_PROGRESS_DETAIL_LENGTH - 1)}…`;
}

const SHELL_EXECUTABLES = new Set([
  "ash",
  "bash",
  "dash",
  "fish",
  "ksh",
  "sh",
  "zsh"
]);
/** `-c`, `-lc`, `-lic`, `-ic`: the login/interactive variants of `sh -c`. */
const SHELL_COMMAND_FLAG = /^-[lie]*c[lie]*$/;
/**
 * Bidi and invisible formatting controls: the display-spoofing carriers that
 * `progressDetail`'s C0/C1 strip does not cover. Everything else — accented
 * paths, non-Latin scripts — renders, because a summary that erases any
 * non-ASCII token is unusable outside an English-only checkout.
 */
const SPOOFING_CHARACTERS =
  /[\u061c\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/;
/**
 * Long-form credential flags only. Short flags are ambiguous and overwhelmingly
 * benign — `mkdir -p`, `sort -u`, `find -H`, `cp -p` — so matching them elides
 * the one token that carried the information.
 */
const CREDENTIAL_FLAG =
  /^--(?:pw|pass|passwd|password|token|secret|api-?key|key|auth|authorization|bearer|credential|creds|header)$/i;
/** Credential-shaped values, which carry a secret whatever flag precedes them. */
const SECRET_VALUE = /^(?:proxy-)?authorization\s*:|^(?:bearer|basic)\s+\S/i;
/**
 * `key=value` forms that can carry a secret: a key naming a credential, or an
 * environment-assignment shape. Ordinary long options are neither — eliding
 * every `=` erases `--porcelain=v1`, `--max-count=10`, and `--grep=pattern`,
 * which is the whole content of the line.
 */
const CREDENTIAL_ASSIGNMENT =
  /^-{0,2}[A-Za-z0-9_-]*(?:passwd|password|pass|pwd|token|secret|api-?key|key|auth|credential|bearer)[A-Za-z0-9_-]*=/i;
const ENVIRONMENT_ASSIGNMENT = /^[A-Z][A-Z0-9_]*=/;
const ELIDED_TOKEN = "…";
const MAX_COMMAND_SUMMARY_LENGTH = 56;

function tokenizeCommand(command: string): string[] {
  const tokens: string[] = [];
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match: RegExpExecArray | null = pattern.exec(command);
  while (match !== null) {
    // A bare token can still carry a quote that lost its partner: the detail is
    // capped at 240 characters before tokenizing, so a long command arrives
    // with its closing quote already cut off.
    const token = (match[1] ?? match[2] ?? match[3] ?? "").replace(
      /^["']|["']$/g,
      ""
    );
    if (token.length > 0) {
      tokens.push(token);
    }
    match = pattern.exec(command);
  }
  return tokens;
}

/**
 * Unwraps `zsh -lc "npm test"` to the command the shell was asked to run. Codex
 * reports every shell action in this shape, so reporting the executable alone
 * renders all of them identically.
 */
function shellPayloadTokens(tokens: readonly string[]): string[] {
  const [executable, flag, ...payload] = tokens;
  if (executable === undefined) {
    return [];
  }
  if (
    SHELL_EXECUTABLES.has(path.basename(executable)) &&
    flag !== undefined &&
    SHELL_COMMAND_FLAG.test(flag)
  ) {
    return payload.length === 0 ? [] : tokenizeCommand(payload.join(" "));
  }
  return [...tokens];
}

/**
 * Command text is untrusted display data. `progressDetail` has already redacted
 * the known key shapes; this drops the remaining inline-secret carriers. A
 * dropped token becomes an ellipsis rather than disappearing, so the summary
 * never implies a shorter command than the one that ran.
 */
function displayableTokens(tokens: readonly string[]): string[] {
  const display: string[] = [];
  let leading = true;
  let credentialFlag = false;
  for (const token of tokens) {
    // `VAR=value cmd` prefixes carry secrets and describe nothing about which
    // command ran, so they are dropped outright rather than elided.
    if (leading && token.includes("=")) {
      continue;
    }
    leading = false;
    const elide =
      credentialFlag ||
      CREDENTIAL_ASSIGNMENT.test(token) ||
      ENVIRONMENT_ASSIGNMENT.test(token) ||
      SECRET_VALUE.test(token) ||
      SPOOFING_CHARACTERS.test(token);
    credentialFlag = CREDENTIAL_FLAG.test(token);
    if (!elide) {
      display.push(token);
      continue;
    }
    if (display.at(-1) !== ELIDED_TOKEN) {
      display.push(ELIDED_TOKEN);
    }
  }
  return display;
}

const HOME_DIRECTORY = homedir();

/**
 * Shortens a path for display: the checkout prefix says nothing when every line
 * repeats it, and `~` is the universally read form for the rest. Both matter
 * because the summary is capped at 56 columns, and a prefix that survives eats
 * the part that identifies the file.
 */
function displayPath(filePath: string, repoRoot: string): string {
  if (repoRoot.length > 0) {
    // `git -C <repoRoot>` names the root itself, with no trailing separator.
    if (filePath === repoRoot) {
      return ".";
    }
    if (filePath.startsWith(`${repoRoot}/`)) {
      return filePath.slice(repoRoot.length + 1) || filePath;
    }
  }
  if (HOME_DIRECTORY.length > 0 && filePath.startsWith(`${HOME_DIRECTORY}/`)) {
    return `~${filePath.slice(HOME_DIRECTORY.length)}`;
  }
  return filePath;
}

const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/**
 * Shortens sanitized display text to one terminal line. Cutting by grapheme
 * cluster rather than by UTF-16 unit keeps an emoji or a combining sequence
 * whole instead of ending the line in half a character.
 */
function truncateDetail(detail: string): string {
  const clusters = Array.from(
    GRAPHEMES.segment(detail),
    (entry) => entry.segment
  );
  if (clusters.length <= MAX_COMMAND_SUMMARY_LENGTH) {
    return detail;
  }
  return `${clusters
    .slice(0, MAX_COMMAND_SUMMARY_LENGTH - 1)
    .join("")
    .trimEnd()}${ELIDED_TOKEN}`;
}

/**
 * Renders the command a vendor actually ran, for progress display only.
 * Returns an empty string when nothing survives redaction, which callers
 * replace with a generic label.
 */
export function summarizeCommand(value: unknown, repoRoot = ""): string {
  return truncateDetail(
    displayableTokens(
      shellPayloadTokens(tokenizeCommand(progressDetail(value)))
    )
      .map((token) => displayPath(token, repoRoot))
      .join(" ")
  );
}

function emitProgress(
  sink: (event: ModelProgressEvent) => void,
  event: ModelProgressEvent
): void {
  if (event.detail.length === 0) {
    return;
  }
  try {
    sink(event);
  } catch {
    // Presentation must never affect the vendor process or workflow.
  }
}

function jsonLine(line: string): JsonRecord | null {
  try {
    return jsonRecord(JSON.parse(line) as unknown);
  } catch {
    return null;
  }
}

/**
 * The two vendors report cache incompatibly and the field names say which.
 * Codex's `cached_input_tokens` is already a subset of `input_tokens`; Claude's
 * `cache_read_input_tokens` and `cache_creation_input_tokens` are disjoint from
 * it, so its `input_tokens` counts only what touched no cache. Both reduce to
 * one meaning here — `inputTokens` is the total, of which `cachedInputTokens`
 * is the part served from cache — because every reader of these counts must
 * agree: a live turn line and the run total that sums it cannot disagree about
 * what they mean. Cache-creation tokens are fresh input written to the cache
 * at a premium, not cache hits, so they count toward the total only; treating
 * them as cached once rendered an entire strict run as `100% cached` because
 * only 510 of 71.9M input tokens fell outside the two cache figures.
 */
function usageCounts(usage: Record<string, unknown>): {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
} {
  const cacheRead = nonNegativeNumber(usage.cache_read_input_tokens);
  const cacheCreation = nonNegativeNumber(usage.cache_creation_input_tokens);
  return {
    inputTokens:
      nonNegativeNumber(usage.input_tokens ?? usage.inputTokens) +
      cacheRead +
      cacheCreation,
    cachedInputTokens:
      nonNegativeNumber(usage.cached_input_tokens ?? usage.cachedInputTokens) +
      cacheRead,
    outputTokens: nonNegativeNumber(usage.output_tokens ?? usage.outputTokens)
  };
}

/**
 * The `tokens:` label separates a reading from the work lines around it, and
 * the turn count — Claude reports one on its cumulative `result` event — is
 * the denominator that keeps a run total honest: every stateless request
 * re-counts the whole conversation, so without it a resumed session's `33M in`
 * reads as one impossible prompt rather than 49 requests over ~670K of
 * context.
 */
function usageDetail(value: unknown, turns?: unknown): string {
  const usage = jsonRecord(value);
  if (usage === null) {
    return "";
  }
  const counts = usageCounts(usage);
  const turnCount =
    typeof turns === "number" && Number.isFinite(turns) && turns >= 1
      ? turns
      : undefined;
  return `tokens: ${formatUsage(
    counts.inputTokens,
    counts.cachedInputTokens,
    counts.outputTokens,
    turnCount
  )}`;
}

function fileChangeDetail(item: JsonRecord, repoRoot: string): string {
  const changes = Array.isArray(item.changes) ? item.changes : [];
  const paths = changes
    .map((change) => progressDetail(jsonRecord(change)?.path))
    .filter(Boolean);
  const directPath = progressDetail(item.path);
  if (directPath.length > 0) {
    paths.push(directPath);
  }
  const named = [...new Set(paths)].map((entry) =>
    displayPath(entry, repoRoot)
  );
  if (named.length === 0) {
    return "file changes";
  }
  // One phase can rewrite many files at once; naming the first two and counting
  // the rest keeps the line to one row, and the same 56-column cap commands get
  // keeps two long paths from running past it.
  const shown = truncateDetail(named.slice(0, 2).join(", "));
  const remainder = named.length - Math.min(2, named.length);
  return `file changes: ${shown}${remainder > 0 ? ` (+${remainder} more)` : ""}`;
}

function codexItemProgress(
  eventType: string,
  item: JsonRecord,
  repoRoot: string
): ModelProgressEvent | null {
  const id = progressDetail(item.id);
  const status =
    eventType === "item.started"
      ? "started"
      : String(item.status ?? "").toLowerCase() === "failed"
        ? "failed"
        : "completed";
  const itemType = String(item.type ?? "").toLowerCase();
  if (itemType === "command_execution") {
    return {
      kind: "action",
      status,
      id,
      detail: `command: ${summarizeCommand(item.command, repoRoot) || "shell"}`
    };
  }
  if (itemType === "file_change") {
    return {
      kind: "action",
      status,
      id,
      detail: fileChangeDetail(item, repoRoot)
    };
  }
  if (itemType === "mcp_tool_call") {
    const server = progressDetail(item.server ?? item.server_name);
    const tool = progressDetail(item.tool ?? item.tool_name ?? item.name);
    return {
      kind: "action",
      status,
      id,
      detail: `MCP tool: ${[server, tool].filter(Boolean).join("/") || "call"}`
    };
  }
  if (itemType === "web_search") {
    return {
      kind: "action",
      status,
      id,
      detail: "web search"
    };
  }
  if (["plan", "plan_update", "todo_list"].includes(itemType)) {
    const entries = Array.isArray(item.items) ? item.items : [];
    const completed = entries.filter(
      (entry) => jsonRecord(entry)?.completed === true
    ).length;
    return {
      kind: "action",
      status,
      id,
      detail:
        entries.length > 0
          ? `plan updated: ${completed}/${entries.length} completed`
          : "plan updated"
    };
  }
  if (["skill", "skill_invocation"].includes(itemType)) {
    const name = progressDetail(item.name ?? item.skill);
    return {
      kind: "skill",
      status,
      id,
      detail: name || "skill invocation"
    };
  }
  return null;
}

function createCodexProgressObserver(
  sink: (event: ModelProgressEvent) => void,
  repoRoot: string
): (line: string) => void {
  return (line) => {
    const event = jsonLine(line);
    if (event === null) {
      return;
    }
    const type = String(event.type ?? "");
    if (type === "turn.started") {
      emitProgress(sink, {
        kind: "model",
        status: "started",
        detail: "turn"
      });
      return;
    }
    if (type === "turn.completed") {
      emitProgress(sink, {
        kind: "usage",
        status: "info",
        detail: usageDetail(event.usage)
      });
      return;
    }
    if (type === "turn.failed" || type === "error") {
      emitProgress(sink, {
        kind: "model",
        status: "failed",
        detail: progressDetail(event.message ?? event.error) || "turn"
      });
      return;
    }
    if (type !== "item.started" && type !== "item.completed") {
      return;
    }
    const item = jsonRecord(event.item);
    if (item === null) {
      return;
    }
    const progress = codexItemProgress(type, item, repoRoot);
    if (progress !== null) {
      emitProgress(sink, progress);
    }
  };
}

function createClaudeTerminalObserver<T>(
  parse: (value: unknown) => T,
  sink:
    | ((terminal: {
        classification: "claude_result";
        observedAt: string;
        result: T;
        sessionId: string | null;
        usage: ModelUsage | null;
      }) => Promise<void>)
    | undefined
): {
  observe: ((line: string) => Promise<void>) | undefined;
  result: () => T | null;
} {
  let terminalResult: T | null = null;
  let terminalSeen = false;
  if (sink === undefined) {
    return { observe: undefined, result: () => null };
  }
  return {
    observe: async (line) => {
      const event = jsonLine(line);
      if (event?.type !== "result") {
        return;
      }
      if (terminalSeen) {
        throw new BanzaiError(
          "TERMINAL_RESULT_CONFLICT",
          "Claude emitted more than one terminal result event."
        );
      }
      terminalSeen = true;
      if (event.subtype !== "success" || event.is_error !== false) {
        return;
      }
      const parsed = claudeStructuredResult(event, parse);
      terminalResult = parsed.result;
      await sink({
        classification: "claude_result",
        observedAt: new Date().toISOString(),
        result: parsed.result,
        sessionId: parsed.sessionId,
        usage: parsed.usage
      });
    },
    result: () => terminalResult
  };
}

function observeSessionStart(
  vendor: Vendor,
  sink: PhaseAdapterRequest["onSessionStarted"],
  terminal: ((line: string) => Promise<void>) | undefined
): ((line: string) => Promise<void>) | undefined {
  if (sink === undefined) return terminal;
  let observedId: string | null = null;
  return async (line) => {
    const event = jsonLine(line);
    const id =
      vendor === "codex"
        ? event?.type === "thread.started"
          ? event.thread_id
          : null
        : event?.type === "system" && event.subtype === "init"
          ? event.session_id
          : null;
    if (
      vendor === "claude" &&
      event?.type === "result" &&
      observedId !== null &&
      typeof event.session_id === "string" &&
      event.session_id !== observedId
    ) {
      throw new BanzaiError(
        "SESSION_ID_CONFLICT",
        "Claude's terminal result changed the announced session identity."
      );
    }
    if (typeof id === "string") {
      if (
        !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,299}$/u.test(id) ||
        (observedId !== null && observedId !== id)
      ) {
        throw new BanzaiError(
          "SESSION_ID_CONFLICT",
          "The vendor announced an invalid or conflicting session identity."
        );
      }
      if (observedId === null) {
        await sink(id);
        observedId = id;
      }
    }
    await terminal?.(line);
  };
}

function codexAgentMessage(item: JsonRecord): unknown {
  const text =
    typeof item.text === "string"
      ? item.text
      : typeof item.content === "string"
        ? item.content
        : null;
  if (text === null) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function createCodexTerminalObserver<T>(
  parse: (value: unknown) => T,
  sink:
    | ((terminal: {
        classification: "codex_turn_completed";
        observedAt: string;
        result: T;
        sessionId: string | null;
        usage: ModelUsage | null;
      }) => Promise<void>)
    | undefined
): {
  observe: ((line: string) => Promise<void>) | undefined;
  result: () => T | null;
} {
  let sessionId: string | null = null;
  let candidate: T | null = null;
  let explicitFinalSeen = false;
  let terminalSeen = false;
  if (sink === undefined) {
    return { observe: undefined, result: () => null };
  }
  return {
    observe: async (line) => {
      const event = jsonLine(line);
      if (event === null) {
        return;
      }
      if (
        event.type === "thread.started" &&
        typeof event.thread_id === "string"
      ) {
        if (sessionId !== null && sessionId !== event.thread_id) {
          throw new BanzaiError(
            "SESSION_ID_CONFLICT",
            "Codex changed its session identity within an attempt."
          );
        }
        sessionId = event.thread_id;
        return;
      }
      if (event.type === "item.started" || event.type === "item.completed") {
        if (terminalSeen || explicitFinalSeen) {
          throw new BanzaiError(
            "TERMINAL_RESULT_CONFLICT",
            "Codex emitted an item after its terminal or explicitly final message."
          );
        }
        // Older exec streams omit the message channel. A schema-valid progress
        // message is provisional until the turn ends, and subsequent work
        // invalidates it. Only the final message may become terminal evidence.
        candidate = null;
      }
      if (event.type === "item.completed") {
        const item = jsonRecord(event.item);
        const itemType =
          item !== null && typeof item.type === "string"
            ? item.type.toLowerCase()
            : "";
        if (item === null || itemType !== "agent_message") {
          return;
        }
        const channel = item.phase ?? item.channel;
        if (channel === "commentary") return;
        explicitFinalSeen = channel === "final_answer" || channel === "final";
        const raw = codexAgentMessage(item);
        if (raw === null) {
          return;
        }
        let parsed: T;
        try {
          parsed = parse(raw);
        } catch {
          return;
        }
        candidate = parsed;
        return;
      }
      if (event.type !== "turn.completed") {
        return;
      }
      if (terminalSeen) {
        throw new BanzaiError(
          "TERMINAL_RESULT_CONFLICT",
          "Codex emitted more than one turn.completed event."
        );
      }
      terminalSeen = true;
      if (candidate === null) {
        return;
      }
      await sink({
        classification: "codex_turn_completed",
        observedAt: new Date().toISOString(),
        result: candidate,
        sessionId,
        usage: normalizedUsage(event.usage)
      });
    },
    result: () => candidate
  };
}

function requireCheckpointResultParity<T>(
  checkpointed: T | null,
  returned: T
): void {
  if (
    checkpointed !== null &&
    JSON.stringify(checkpointed) !== JSON.stringify(returned)
  ) {
    throw new BanzaiError(
      "TERMINAL_RESULT_CONFLICT",
      "The post-close structured result conflicts with the terminal checkpoint."
    );
  }
}

function claudeToolDetail(
  name: string,
  input: JsonRecord,
  repoRoot: string
): string {
  if (name === "Bash") {
    return `command: ${summarizeCommand(input.command, repoRoot) || "shell"}`;
  }
  if (name === "Read" || name === "Edit" || name === "Write") {
    const filePath = displayPath(
      progressDetail(input.file_path ?? input.path),
      repoRoot
    );
    return `${name}${filePath ? `: ${filePath}` : ""}`;
  }
  if (name === "Glob" || name === "Grep") {
    // The pattern is what distinguishes one search from the next hundred. It is
    // an argument, not a command, so it keeps `=` and only gets shortened.
    const pattern = truncateDetail(progressDetail(input.pattern));
    return `${name}${pattern ? `: ${pattern}` : ""}`;
  }
  return progressDetail(name) || "tool";
}

function createClaudeProgressObserver(
  sink: (event: ModelProgressEvent) => void,
  repoRoot: string
): (line: string) => void {
  const activeTools = new Map<
    string,
    { kind: "skill" | "action"; detail: string }
  >();
  const seenTools = new Set<string>();

  return (line) => {
    const event = jsonLine(line);
    if (event === null) {
      return;
    }
    const type = String(event.type ?? "");
    if (type === "system" && event.subtype === "init") {
      emitProgress(sink, {
        kind: "model",
        status: "started",
        detail: "session"
      });
      return;
    }
    if (type === "result") {
      emitProgress(sink, {
        kind: "usage",
        status: "info",
        detail: usageDetail(event.usage, event.num_turns)
      });
      return;
    }

    const message = jsonRecord(event.message);
    const content = Array.isArray(message?.content) ? message.content : [];
    if (type === "assistant") {
      for (const block of content) {
        const tool = jsonRecord(block);
        if (tool?.type !== "tool_use") {
          continue;
        }
        const id = progressDetail(tool.id);
        if (id.length === 0 || seenTools.has(id)) {
          continue;
        }
        seenTools.add(id);
        const name = progressDetail(tool.name);
        const input = jsonRecord(tool.input) ?? {};
        const isSkill = name === "Skill";
        const detail = isSkill
          ? progressDetail(input.skill ?? input.name) || "skill invocation"
          : claudeToolDetail(name, input, repoRoot);
        const progress = {
          kind: isSkill ? ("skill" as const) : ("action" as const),
          detail,
          id
        };
        activeTools.set(id, progress);
        emitProgress(sink, { ...progress, status: "started" });
      }
      return;
    }
    if (type !== "user") {
      return;
    }
    for (const block of content) {
      const result = jsonRecord(block);
      if (result?.type !== "tool_result") {
        continue;
      }
      const id = progressDetail(result.tool_use_id);
      const progress = activeTools.get(id);
      if (progress === undefined) {
        continue;
      }
      activeTools.delete(id);
      emitProgress(sink, {
        ...progress,
        status: result.is_error === true ? "failed" : "completed"
      });
    }
  };
}

function structuredError(value: unknown, depth = 0): string | null {
  if (depth > 4 || typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const isError =
    String(record.type ?? "").toLowerCase() === "error" ||
    record.is_error === true;
  if (isError) {
    for (const key of ["message", "error", "result"]) {
      const candidate = record[key];
      if (typeof candidate === "string" && candidate.trim().length > 0) {
        return candidate;
      }
      const nested = structuredError(candidate, depth + 1);
      if (nested !== null) {
        return nested;
      }
    }
  }
  for (const key of ["error", "item", "event"]) {
    const nested = structuredError(record[key], depth + 1);
    if (nested !== null) {
      return nested;
    }
  }
  return null;
}

function lastNonEmptyLine(value: string): string | null {
  const lines = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.at(-1) ?? null;
}

function processFailureSummary(result: ProcessResult): string {
  const stdoutLines = result.stdout.split(/\r?\n/).filter(Boolean);
  for (const line of [...stdoutLines].reverse()) {
    try {
      const message = structuredError(JSON.parse(line) as unknown);
      if (message !== null) {
        return redactSensitiveText(message)
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, MAX_FAILURE_SUMMARY_LENGTH);
      }
    } catch {
      // Non-JSON output is considered by the fallback below.
    }
  }
  const fallback =
    lastNonEmptyLine(result.stderr) ??
    lastNonEmptyLine(result.stdout) ??
    "No diagnostic output was produced.";
  return redactSensitiveText(fallback)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_FAILURE_SUMMARY_LENGTH);
}

function streamRecords(stdout: string): JsonRecord[] {
  const records: JsonRecord[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (line.trim().length === 0) {
      continue;
    }
    const record = jsonLine(line);
    if (record !== null) {
      records.push(record);
    }
  }
  return records;
}

function finalClaudeResult(stdout: string): JsonRecord | null {
  return (
    [...streamRecords(stdout)].reverse().find((event) => {
      return event.type === "result";
    }) ?? null
  );
}

/**
 * Claude reports its own tool inventory once, in the `system/init` event. Tool
 * definitions lead the cached prefix, so this digest is what decides whether a
 * resumed session can reuse that cache.
 */
export function claudeSessionInventory(
  stdout: string
): SessionInventory | null {
  for (const event of streamRecords(stdout)) {
    if (event.type !== "system" || event.subtype !== "init") {
      continue;
    }
    if (!Array.isArray(event.tools)) {
      return null;
    }
    const tools = event.tools
      .map((tool) => (typeof tool === "string" ? tool : ""))
      .filter((tool) => tool.length > 0)
      .sort();
    return {
      toolCount: tools.length,
      digest: createHash("sha256").update(tools.join("\n")).digest("hex")
    };
  }
  return null;
}

/**
 * Usage the process already spent before it failed. Without this a non-zero
 * exit throws past the numbers its own stream carries, and run metrics
 * understate real consumption by every failed attempt.
 */
export function claudeUsage(stdout: string): ModelUsage | null {
  const result = finalClaudeResult(stdout);
  return result === null
    ? null
    : normalizedUsage(result.usage, result.total_cost_usd);
}

export function claudeTurnCount(stdout: string): number | null {
  const result = finalClaudeResult(stdout);
  return result !== null &&
    typeof result.num_turns === "number" &&
    Number.isInteger(result.num_turns) &&
    result.num_turns >= 0
    ? result.num_turns
    : null;
}

/**
 * Classifies from structured stream fields only. Vendor prose is not a contract:
 * it is localised, redacted, and reworded without notice, so no branch here may
 * depend on it.
 */
export function classifyClaudeFailure(stdout: string): ModelFailureCause {
  const records = streamRecords(stdout);
  const result = [...records]
    .reverse()
    .find((event) => event.type === "result");
  const status = result?.api_error_status;
  if (status === 429) {
    return "capacity";
  }
  if (
    records.some(
      (event) =>
        event.type === "assistant" &&
        event.is_api_error_message === true &&
        event.error === "rate_limit"
    )
  ) {
    return "capacity";
  }
  if (typeof status === "number" || result?.terminal_reason === "api_error") {
    return "transport";
  }
  return "unclassified";
}

/**
 * Maps any thrown failure to the closed cause set. Timeouts and spawn failures
 * retain their typed cause even when captured process output accompanies them.
 */
export function classifyModelFailure(error: unknown): ModelFailureCause {
  if (error instanceof ProcessExitError) {
    if (error.failureCause !== null) return error.failureCause;
  }
  if (error instanceof BanzaiError) {
    if (error.code === "PROCESS_TIMEOUT") {
      return "timeout";
    }
    if (error.code === "PROCESS_START_FAILED") {
      return "process_start";
    }
  }
  return "unclassified";
}

/**
 * Codex announces `thread.started` before its first turn and emits protocol JSON
 * for everything afterwards. A non-zero exit that produced no event at all never
 * began work: the CLI failed during startup, which says nothing about the model,
 * the review, or the repository. Observed shape is an immediate exit whose only
 * output is a stderr diagnostic, for example a `~/.codex` state database the CLI
 * could not open. Any stream that did carry events stays unclassified, so it
 * keeps the conservative rotating path.
 */
export function classifyCodexFailure(stdout: string): ModelFailureCause {
  return streamRecords(stdout).length === 0 ? "process_start" : "unclassified";
}

function processExitError(
  code: string,
  vendor: string,
  result: ProcessResult
): ProcessExitError {
  const claude = vendor === "Claude";
  return new ProcessExitError(
    code,
    `${vendor} exited ${result.exitCode}: ${processFailureSummary(result)}`,
    result,
    {
      failureCause: claude
        ? classifyClaudeFailure(result.stdout)
        : classifyCodexFailure(result.stdout),
      usage: claude ? claudeUsage(result.stdout) : codexUsage(result.stdout),
      inventory: claude ? claudeSessionInventory(result.stdout) : null,
      turnCount: claude ? claudeTurnCount(result.stdout) : null
    }
  );
}

/** Keep process evidence when a durable observer or post-close decoder throws. */
async function withModelFailureEvidence<T>(
  runner: ProcessRunner,
  vendor: Vendor,
  operation: (run: ProcessRunner) => Promise<T>
): Promise<T> {
  const captured: { result: ProcessResult | null } = { result: null };
  try {
    return await operation(async (spec) => {
      captured.result = await runner(spec);
      return captured.result;
    });
  } catch (error) {
    const result =
      error instanceof ProcessExitError ? error.result : captured.result;
    if (result === null) throw error;
    const claude = vendor === "claude";
    throw new ProcessExitError(
      error instanceof BanzaiError ? error.code : "MODEL_RESULT_INVALID",
      errorMessage(error),
      result,
      {
        failureCause: classifyModelFailure(error),
        usage: claude ? claudeUsage(result.stdout) : codexUsage(result.stdout),
        inventory: claude ? claudeSessionInventory(result.stdout) : null,
        turnCount: claude ? claudeTurnCount(result.stdout) : null
      }
    );
  }
}

function parseVersion(output: string, executable: string): string {
  const match = /\b(\d+\.\d+\.\d+)\b/.exec(output);
  if (match?.[1] === undefined) {
    throw new BanzaiError(
      "VERSION_UNKNOWN",
      `Could not parse ${executable} version from: ${output.trim()}`
    );
  }
  return match[1];
}

function versionAtLeast(actual: string, minimum: string): boolean {
  const left = actual.split(".").map(Number);
  const right = minimum.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    const delta = (left[index] ?? 0) - (right[index] ?? 0);
    if (delta !== 0) {
      return delta > 0;
    }
  }
  return true;
}

function isCodexSandboxEnvironment(environment: NodeJS.ProcessEnv): boolean {
  const value = environment.CODEX_SANDBOX?.trim().toLowerCase();
  return (
    value !== undefined && !["", "0", "false", "off", "none"].includes(value)
  );
}

async function requireCodexStateWriteAccess(
  sourceEnvironment: NodeJS.ProcessEnv
): Promise<void> {
  const configuredHome = sourceEnvironment.CODEX_HOME?.trim();
  const codexHome =
    configuredHome === undefined || configuredHome.length === 0
      ? path.join(homedir(), ".codex")
      : path.resolve(configuredHome);
  try {
    await access(codexHome, constants.W_OK);
  } catch {
    if (isCodexSandboxEnvironment(sourceEnvironment)) {
      throw new BanzaiError(
        "CODEX_STATE_UNAVAILABLE_IN_SANDBOX",
        "Codex state directory is not writable from Banzai's enclosing Codex sandbox. Run `banzai` in a regular terminal, or approve the supervising agent's Banzai command to run outside the restricted sandbox. Changing the Codex sandbox mode, executable path, shell, or TTY cannot bypass the parent sandbox."
      );
    }
    throw new BanzaiError(
      "CODEX_STATE_NOT_WRITABLE",
      "Codex state directory is not writable. Ensure `CODEX_HOME` exists and is writable from the current host environment, then retry Banzai."
    );
  }
}

async function requireVersion(
  runner: ProcessRunner,
  vendor: Vendor,
  target: VendorPreflightTarget,
  sourceEnvironment: NodeJS.ProcessEnv = process.env
): Promise<void> {
  const result = await runner({
    command: target.executable,
    args: ["--version"],
    cwd: process.cwd(),
    env: subscriptionOnlyEnvironment(sourceEnvironment),
    timeoutMs: 30_000
  });
  if (result.exitCode !== 0) {
    throw new BanzaiError(
      "CLI_UNAVAILABLE",
      `${target.executable} --version failed: ${result.stderr.trim()}`
    );
  }
  const actual = parseVersion(
    result.stdout || result.stderr,
    target.executable
  );
  const minimum =
    vendor === "claude" ? MINIMUM_CLAUDE_VERSION : MINIMUM_CODEX_VERSION;
  if (!versionAtLeast(actual, minimum)) {
    throw new BanzaiError(
      "CLI_TOO_OLD",
      `${target.executable} ${actual} is older than required ${minimum}.`
    );
  }
  const modelMinimum =
    target.model === null ? null : modelCliMinimum(vendor, target.model);
  if (modelMinimum !== null && !versionAtLeast(actual, modelMinimum)) {
    throw new BanzaiError(
      "CLI_TOO_OLD",
      `${target.executable} ${actual} cannot run ${target.model}, which requires ${modelMinimum} or newer. Update ${target.executable}, or choose another model with \`banzai model\`.`
    );
  }
}

export type CodexSandbox = "workspace-write" | "read-only";

export interface CodexInvocation {
  prompt: string;
  promptEnvelope?: PromptEnvelope;
  repoRoot: string;
  settings: ModelSettings;
  resumeSessionId: string | null;
  environment?: ClaudeInvocationScope | undefined;
}

function invocationPrompt(request: {
  prompt: string;
  promptEnvelope?: PromptEnvelope;
}): string {
  if (request.promptEnvelope === undefined) return request.prompt;
  if (request.promptEnvelope.rendered !== request.prompt) {
    throw new BanzaiError(
      "PROMPT_ENVELOPE_MISMATCH",
      "The supplied prompt envelope does not match the rendered adapter prompt."
    );
  }
  return request.promptEnvelope.rendered;
}

/** TOML basic strings share JSON's escape grammar, so this is also valid TOML. */
const tomlString = (value: string): string => JSON.stringify(value);

/** TOML floats require a decimal point; `15` would deserialize as an integer. */
function tomlFloat(value: number): string {
  return Number.isInteger(value) ? `${value}.0` : String(value);
}

/**
 * The whole `mcp_servers` table as one `-c` override. Replacing the table —
 * rather than merging one key into it — is what makes this a whitelist: user
 * config servers outside it do not load into orchestrated runs.
 */
export function codexMcpServersOverride(server: McpStdioServer): string {
  const fields = [
    `command=${tomlString(server.command)}`,
    `args=[${server.args.map(tomlString).join(",")}]`
  ];
  const env = Object.entries(server.env);
  if (env.length > 0) {
    fields.push(
      `env={${env.map(([key, value]) => `${key}=${tomlString(value)}`).join(",")}}`
    );
  }
  if (server.startupTimeoutSec !== null) {
    fields.push(`startup_timeout_sec=${tomlFloat(server.startupTimeoutSec)}`);
  }
  return `mcp_servers={serena={${fields.join(",")}}}`;
}

/** The `--mcp-config` payload: exactly one server, inline JSON. */
export function claudeMcpConfig(server: McpStdioServer): string {
  return JSON.stringify({
    mcpServers: {
      serena: {
        type: "stdio",
        command: server.command,
        args: server.args,
        env: server.env
      }
    }
  });
}

export function buildCodexArguments(
  request: CodexInvocation,
  schemaPath: string,
  outputPath: string,
  sandbox: CodexSandbox = "workspace-write"
): string[] {
  const shared = [
    "--json",
    "--output-schema",
    schemaPath,
    "-o",
    outputPath,
    "-m",
    request.settings.model,
    "-c",
    `model_reasoning_effort=${JSON.stringify(request.settings.effort)}`
  ];
  const serena = request.environment?.mcp?.codex ?? null;
  if (serena !== null) {
    shared.push("-c", codexMcpServersOverride(serena));
  }
  if (request.resumeSessionId !== null) {
    return [
      "exec",
      "resume",
      ...shared,
      "-c",
      `sandbox_mode=${JSON.stringify(sandbox)}`,
      request.resumeSessionId,
      invocationPrompt(request)
    ];
  }
  return [
    "exec",
    ...shared,
    "--sandbox",
    sandbox,
    "--cd",
    request.repoRoot,
    invocationPrompt(request)
  ];
}

/**
 * Claude Code compiles `--json-schema` with a validator that cannot resolve the
 * 2020-12 meta-schema URI, and rejects the whole schema when it is declared.
 * The published contract keeps `$schema` for every other consumer; only the
 * copy handed to the CLI drops it. `$id` and local `$ref`s compile as written.
 */
export const claudeJsonSchema = sanitizeClaudeJsonSchema;

function requestOutputContract(
  request: { outputContract?: OutputContractEnvelope },
  vendor: "codex" | "claude",
  identity: OutputContractIdentity
): string {
  const supplied = request.outputContract;
  if (supplied !== undefined) {
    if (supplied.vendor !== vendor || supplied.identity !== identity) {
      throw new BanzaiError(
        "OUTPUT_CONTRACT_MISMATCH",
        `The supplied output contract does not match ${vendor} ${identity}.`
      );
    }
    return supplied.serialized;
  }
  return resolveOutputContract(vendor, identity).serialized;
}

/**
 * Reproduces the invocation Banzai used before ADR 0020: the operator's whole
 * ambient Claude Code installation. Only an explicit `mode: "ambient"` selects
 * it, and omitting `environment` from an adapter request keeps a caller's prior
 * argument vector unchanged.
 */
export const AMBIENT_CLAUDE_SCOPE: ClaudeInvocationScope = {
  strictMcpConfig: false,
  settingSources: null,
  pluginDirectory: null
};

/**
 * `project` rather than an empty value: an empty value also drops the target
 * project's own CLAUDE.md and AGENTS.md, which the Banzai plugin installs and
 * which describe the authority order the reviewer judges against.
 */
const SCOPED_SETTING_SOURCES = "project";
const PLUGIN_MANIFEST = path.join(".claude-plugin", "plugin.json");
const PACKAGED_PLUGIN_RELATIVE_PATH = path.join("plugins", "banzai");
const REQUIRED_BANZAI_SKILLS = [
  "architecture-decision",
  "code-writing",
  "development-plan",
  "feature",
  "feature-description",
  "feature-review",
  "feature-status",
  "orchestrate",
  "project-manifest",
  "quick-fix",
  "test-writing"
] as const;
const REQUIRED_BANZAI_HOOK_TOOLS = [
  "Edit",
  "Write",
  "MultiEdit",
  "NotebookEdit",
  "apply_patch"
] as const;
const BANZAI_SPEC_GATE_REFERENCE = "${CLAUDE_PLUGIN_ROOT}/hooks/spec-gate.cjs";
// The module resolves from `src`, `dist`, and `.test-dist`, all three
// directories below `packages/orchestrator`. Searching upward covers every one
// without hardcoding a depth that only holds for the bundle.
const PLUGIN_SEARCH_DEPTH = 6;

export interface ResolvedClaudeInvocationScope {
  scope: ClaudeInvocationScope;
  // Set when scoping was requested but no plugin could be re-supplied. The
  // caller reports it; isolation degrades to MCP-only rather than disabling
  // skill loading and hook enforcement.
  degradedReason: string | null;
}

function invokesBanzaiSpecGate(value: unknown): boolean {
  if (!Array.isArray(value)) {
    return false;
  }
  return value.some((entry) => {
    const hookGroup = jsonRecord(entry);
    const matcher =
      typeof hookGroup?.matcher === "string" ? hookGroup.matcher : "";
    const matchedTools = new Set(matcher.split("|"));
    const hooks = hookGroup?.hooks;
    return (
      REQUIRED_BANZAI_HOOK_TOOLS.every((tool) => matchedTools.has(tool)) &&
      Array.isArray(hooks) &&
      hooks.some((hook) => {
        const command = jsonRecord(hook);
        return (
          command?.type === "command" &&
          typeof command.command === "string" &&
          command.command.includes(BANZAI_SPEC_GATE_REFERENCE)
        );
      })
    );
  });
}

export async function verifiedPluginDirectory(
  directory: string
): Promise<string | null> {
  const resolved = path.resolve(directory);
  try {
    const manifest = jsonRecord(
      JSON.parse(
        await readFile(path.join(resolved, PLUGIN_MANIFEST), "utf8")
      ) as unknown
    );
    if (manifest?.name !== "banzai" || manifest.skills !== "./skills/") {
      return null;
    }
    const [hookConfig, hookScript, ...skills] = await Promise.all([
      readFile(path.join(resolved, "hooks", "hooks.json"), "utf8"),
      readFile(path.join(resolved, "hooks", "spec-gate.cjs"), "utf8"),
      ...REQUIRED_BANZAI_SKILLS.map(
        async (skill) =>
          await readFile(
            path.join(resolved, "skills", skill, "SKILL.md"),
            "utf8"
          )
      )
    ]);
    const hooks = jsonRecord(
      jsonRecord(JSON.parse(hookConfig) as unknown)?.hooks
    );
    if (
      !invokesBanzaiSpecGate(hooks?.PreToolUse) ||
      !invokesBanzaiSpecGate(hooks?.PostToolUse) ||
      hookScript.trim().length === 0 ||
      skills.some((contents) => contents.trim().length === 0)
    ) {
      return null;
    }
    return resolved;
  } catch {
    return null;
  }
}

async function packagedPluginDirectory(): Promise<string | null> {
  let directory = path.dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth <= PLUGIN_SEARCH_DEPTH; depth += 1) {
    const candidate = await verifiedPluginDirectory(
      path.join(directory, PACKAGED_PLUGIN_RELATIVE_PATH)
    );
    if (candidate !== null) {
      return candidate;
    }
    const parent = path.dirname(directory);
    if (parent === directory) {
      return null;
    }
    directory = parent;
  }
  return null;
}

/**
 * Decides how much ambient Claude Code environment a spawned process may see.
 * MCP isolation is unconditional in scoped mode because it cannot affect skills,
 * plugins, hooks, or project instructions. Setting-source scoping is applied
 * only together with a verified plugin directory.
 */
export async function resolveClaudeInvocationScope(
  settings: ClaudeEnvironmentSettings
): Promise<ResolvedClaudeInvocationScope> {
  if (settings.mode === "ambient") {
    return { scope: AMBIENT_CLAUDE_SCOPE, degradedReason: null };
  }
  if (settings.pluginDirectory !== null) {
    const explicit = await verifiedPluginDirectory(settings.pluginDirectory);
    if (explicit === null) {
      throw new BanzaiError(
        "BANZAI_PLUGIN_DIRECTORY_INVALID",
        `Configured claudeEnvironment.pluginDirectory ${settings.pluginDirectory} has no readable ${PLUGIN_MANIFEST}. Correct the path or set claudeEnvironment.mode to "ambient".`
      );
    }
    return {
      scope: {
        strictMcpConfig: true,
        settingSources: SCOPED_SETTING_SOURCES,
        pluginDirectory: explicit
      },
      degradedReason: null
    };
  }
  const packaged = await packagedPluginDirectory();
  if (packaged === null) {
    return {
      scope: {
        strictMcpConfig: true,
        settingSources: null,
        pluginDirectory: null
      },
      degradedReason: `No packaged ${PACKAGED_PLUGIN_RELATIVE_PATH} plugin was found beside the orchestrator, so setting sources stay ambient to keep Banzai skills and hook enforcement loaded.`
    };
  }
  return {
    scope: {
      strictMcpConfig: true,
      settingSources: SCOPED_SETTING_SOURCES,
      pluginDirectory: packaged
    },
    degradedReason: null
  };
}

function claudeEnvironmentArguments(
  scope: ClaudeInvocationScope | undefined,
  pluginDirectoryOverride: string | null = null
): string[] {
  const args: string[] = [];
  if (scope === undefined) {
    return pluginDirectoryOverride === null
      ? args
      : ["--plugin-dir", pluginDirectoryOverride];
  }
  if (scope.strictMcpConfig) {
    args.push("--strict-mcp-config");
    // Alone, strict mode loads zero MCP servers (ADR-0020). With --mcp-config
    // beside it, the session loads exactly the whitelist and nothing ambient.
    const serena = scope.mcp?.claude ?? null;
    if (serena !== null) {
      // Loading the server only lists its tools. `dontAsk` denies every one of
      // them until an --allowedTools entry names it, so the grant travels with
      // the config or the whitelist is inert.
      args.push(
        "--mcp-config",
        claudeMcpConfig(serena),
        "--allowedTools",
        serenaAllowedTools()
      );
    }
  }
  const pluginDirectory = pluginDirectoryOverride ?? scope.pluginDirectory;
  if (scope.settingSources !== null && pluginDirectory !== null) {
    args.push("--setting-sources", scope.settingSources);
  }
  if (pluginDirectory !== null) {
    args.push("--plugin-dir", pluginDirectory);
  }
  return args;
}

export function buildClaudeArguments(
  request:
    | ReviewAdapterRequest
    | Omit<
        PlanningAdapterRequest<PlanningReviewResult | PlanningReviewAnalysis>,
        "onTerminalSuccess"
      >,
  identity: OutputContractIdentity = "review-result/v2"
): string[] {
  const args = [
    "-p",
    invocationPrompt(request),
    "--output-format",
    "stream-json",
    "--verbose",
    "--json-schema",
    requestOutputContract(request, "claude", identity),
    "--model",
    request.settings.model,
    "--effort",
    request.settings.effort,
    "--permission-mode",
    "dontAsk",
    "--tools",
    "Read,Glob,Grep,Skill",
    "--disallowedTools",
    "Bash,Edit,Write,MultiEdit,NotebookEdit,WebFetch,WebSearch"
  ];
  if (request.resumeSessionId !== null) {
    args.push("--resume", request.resumeSessionId);
  }
  // The live seam supplies the candidate clone's own plugin copy, so it wins and
  // exactly one --plugin-dir is ever emitted.
  args.push(
    ...claudeEnvironmentArguments(
      request.environment,
      ("liveCompatibility" in request
        ? request.liveCompatibility.pluginDirectory
        : null) ?? null
    )
  );
  if (
    "liveCompatibility" in request &&
    request.liveCompatibility.includeHookEvents
  ) {
    args.push("--include-hook-events");
  }
  return args;
}

export function buildClaudeSelectionArguments(
  request: WorkflowSelectionAdapterRequest
): string[] {
  return [
    "-p",
    invocationPrompt(request),
    "--output-format",
    "stream-json",
    "--verbose",
    "--json-schema",
    requestOutputContract(request, "claude", "workflow-selection/v1"),
    "--model",
    request.settings.model,
    "--effort",
    request.settings.effort,
    "--permission-mode",
    "dontAsk",
    "--add-dir",
    request.repoRoot,
    "--tools",
    "Read,Glob,Grep",
    "--disallowedTools",
    "Skill,Bash,Edit,Write,NotebookEdit,WebFetch,WebSearch",
    ...claudeEnvironmentArguments(request.environment)
  ];
}

/**
 * Claude running a writing phase: planning, implementation, or a fix. The tool
 * set is the mirror of the review invocation — edits and shell are available,
 * and the Banzai hook still enforces the approved bundle through
 * BANZAI_RUN_ID. Sessions resume by id so a replan continues its own thread.
 */
export function buildClaudePhaseArguments(
  request: PhaseAdapterRequest
): string[] {
  const args = [
    "-p",
    invocationPrompt(request),
    "--output-format",
    "stream-json",
    "--verbose",
    "--json-schema",
    requestOutputContract(
      request,
      "claude",
      request.outputContract.identity === "phase-result/v4"
        ? "phase-result/v4"
        : "phase-result/v3"
    ),
    "--model",
    request.settings.model,
    "--effort",
    request.settings.effort,
    "--permission-mode",
    "dontAsk",
    "--add-dir",
    request.repoRoot,
    "--tools",
    "Read,Glob,Grep,Skill,Edit,Write,NotebookEdit,Bash",
    "--disallowedTools",
    "WebFetch,WebSearch"
  ];
  if (request.resumeSessionId !== null) {
    args.push("--resume", request.resumeSessionId);
  }
  args.push(...claudeEnvironmentArguments(request.environment));
  return args;
}

function codexSessionId(stdout: string): string | null {
  for (const line of stdout.split(/\r?\n/)) {
    if (line.trim().length === 0) {
      continue;
    }
    try {
      const event = JSON.parse(line) as Record<string, unknown>;
      if (
        event.type === "thread.started" &&
        typeof event.thread_id === "string"
      ) {
        return event.thread_id;
      }
    } catch {
      // Non-JSON diagnostic output is retained but does not identify a session.
    }
  }
  return null;
}

function nonNegativeNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : 0;
}

function normalizedUsage(
  value: unknown,
  costUsd: unknown = null
): ModelUsage | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const { inputTokens, cachedInputTokens, outputTokens } = usageCounts(
    value as Record<string, unknown>
  );
  const normalizedCost =
    typeof costUsd === "number" && Number.isFinite(costUsd) && costUsd >= 0
      ? costUsd
      : null;
  if (
    inputTokens === 0 &&
    cachedInputTokens === 0 &&
    outputTokens === 0 &&
    normalizedCost === null
  ) {
    return null;
  }
  return {
    inputTokens,
    cachedInputTokens,
    outputTokens,
    costUsd: normalizedCost
  };
}

function codexUsage(stdout: string): ModelUsage | null {
  let latest: ModelUsage | null = null;
  for (const line of stdout.split(/\r?\n/)) {
    try {
      const event = JSON.parse(line) as Record<string, unknown>;
      const parsed = normalizedUsage(event.usage);
      if (parsed !== null) {
        latest = parsed;
      }
    } catch {
      // Ignore non-JSON diagnostics.
    }
  }
  return latest;
}

/**
 * Every phase kind now runs on either vendor, so the argument shape is chosen by
 * the configured executable. An executable belonging to neither vendor has no
 * known invocation and is rejected before a process is started.
 */
function requireVendor(executable: string): Vendor {
  const vendor = vendorFor(executable);
  if (vendor === null) {
    throw new BanzaiError(
      "UNSUPPORTED_VENDOR",
      `${executable} is neither a codex nor a claude executable, so Banzai cannot build its arguments.`
    );
  }
  return vendor;
}

async function writeCodexContract(
  runDirectory: string,
  attemptId: string,
  schemaName: string,
  serialized: string
): Promise<{ schemaPath: string; outputPath: string }> {
  const contractDirectory = path.join(runDirectory, "contracts");
  await mkdir(contractDirectory, { recursive: true });
  const schemaPath = path.join(contractDirectory, schemaName);
  await writeFile(schemaPath, serialized, "utf8");
  return {
    schemaPath,
    outputPath: path.join(runDirectory, "attempts", `${attemptId}-result.json`)
  };
}

async function readCodexResult(outputPath: string): Promise<unknown> {
  const raw = await readFile(outputPath, "utf8").catch((error: unknown) => {
    throw new BanzaiError(
      "CODEX_RESULT_MISSING",
      `Codex did not write its structured result: ${(error as Error).message}`
    );
  });
  return JSON.parse(raw) as unknown;
}

function decodeClaudeStdout(stdout: string): unknown {
  try {
    return JSON.parse(stdout) as unknown;
  } catch {
    const events: unknown[] = [];
    try {
      for (const line of stdout.split(/\r?\n/).filter(Boolean)) {
        events.push(JSON.parse(line) as unknown);
      }
    } catch (error) {
      throw new BanzaiError(
        "INVALID_RESULT",
        `Claude output was not valid JSON Lines: ${(error as Error).message}`
      );
    }
    const records = events
      .map((event) => jsonRecord(event))
      .filter((event): event is JsonRecord => event !== null);
    const result = [...records]
      .reverse()
      .find((event) => event.type === "result");
    if (result !== undefined) {
      return result;
    }
    throw new BanzaiError(
      "INVALID_RESULT",
      "Claude stream did not contain a final result event."
    );
  }
}

function claudeStructuredResult<T>(
  value: unknown,
  parse: (value: unknown) => T
): {
  result: T;
  sessionId: string | null;
  usage: ModelUsage | null;
} {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new BanzaiError(
      "INVALID_RESULT",
      "Claude output must be a JSON object."
    );
  }
  const record = value as Record<string, unknown>;
  const structured =
    typeof record.structured_output === "string"
      ? (JSON.parse(record.structured_output) as unknown)
      : record.structured_output;
  return {
    result: parse(structured),
    sessionId: typeof record.session_id === "string" ? record.session_id : null,
    usage: normalizedUsage(record.usage, record.total_cost_usd)
  };
}

async function runPlanningAdapter<
  T extends PlanningReviewResult | PlanningReviewAnalysis
>(
  runner: ProcessRunner,
  request: PlanningAdapterRequest<T>,
  identity: OutputContractIdentity,
  parse: (value: unknown) => T
): Promise<AdapterResult<T>> {
  const vendor = requireVendor(request.settings.executable);
  return withModelFailureEvidence(runner, vendor, async (run) => {
    const env = subscriptionOnlyEnvironment({
      ...request.env,
      BANZAI_RUN_ID: request.runId,
      BANZAI_APPROVAL_DIGEST: "",
      BANZAI_WORKFLOW_DIGEST: "",
      BANZAI_REVIEW_ARTIFACT: ""
    });
    if (vendor === "claude") {
      const terminal = createClaudeTerminalObserver(
        parse,
        request.onTerminalSuccess
      );
      const processResult = await run({
        command: request.settings.executable,
        args: buildClaudeArguments(request, identity),
        cwd: request.repoRoot,
        env,
        timeoutMs: request.settings.timeoutMs,
        onStart: request.onStart,
        onStdoutLine: createClaudeProgressObserver(
          request.onProgress,
          request.repoRoot
        ),
        onStdoutLineDurable: observeSessionStart(
          vendor,
          request.onSessionStarted,
          terminal.observe
        )
      });
      if (processResult.exitCode !== 0)
        throw processExitError(
          "CLAUDE_PLANNING_FAILED",
          "Claude",
          processResult
        );
      const parsed = claudeStructuredResult(
        decodeClaudeStdout(processResult.stdout),
        parse
      );
      requireCheckpointResultParity(terminal.result(), parsed.result);
      return {
        ...parsed,
        stdout: processResult.stdout,
        stderr: processResult.stderr,
        inventory: claudeSessionInventory(processResult.stdout),
        turnCount: claudeTurnCount(processResult.stdout)
      };
    }
    const { schemaPath, outputPath } = await writeCodexContract(
      request.runDirectory,
      request.attemptId,
      `${identity.replace("/v1", "")}.schema.json`,
      requestOutputContract(request, "codex", identity)
    );
    const terminal = createCodexTerminalObserver(
      parse,
      request.onTerminalSuccess
    );
    const processResult = await run({
      command: request.settings.executable,
      args: buildCodexArguments(request, schemaPath, outputPath, "read-only"),
      cwd: request.repoRoot,
      env,
      timeoutMs: request.settings.timeoutMs,
      onStart: request.onStart,
      onStdoutLine: createCodexProgressObserver(
        request.onProgress,
        request.repoRoot
      ),
      onStdoutLineDurable: observeSessionStart(
        vendor,
        request.onSessionStarted,
        terminal.observe
      )
    });
    if (processResult.exitCode !== 0)
      throw processExitError("CODEX_PLANNING_FAILED", "Codex", processResult);
    const result = parse(await readCodexResult(outputPath));
    requireCheckpointResultParity(terminal.result(), result);
    return {
      result,
      sessionId: codexSessionId(processResult.stdout),
      stdout: processResult.stdout,
      stderr: processResult.stderr,
      usage: codexUsage(processResult.stdout)
    };
  });
}

export function createVendorAdapters(
  runner: ProcessRunner = runProcess
): VendorAdapters {
  return {
    async resolveMcpWhitelist(input): Promise<McpWhitelist> {
      return await resolveSerenaWhitelist({
        ...input,
        // The same sanitized environment every vendor child receives, so the
        // availability probe sees the PATH the spawn will see.
        env: subscriptionOnlyEnvironment(),
        runner
      });
    },
    async preflightCodex(
      target,
      sourceEnvironment = process.env
    ): Promise<void> {
      await requireCodexStateWriteAccess(sourceEnvironment);
      await requireVersion(runner, "codex", target, sourceEnvironment);
      const result = await runner({
        command: target.executable,
        args: ["login", "status"],
        cwd: process.cwd(),
        env: subscriptionOnlyEnvironment(sourceEnvironment),
        timeoutMs: 30_000
      });
      if (
        result.exitCode !== 0 ||
        !/\bChatGPT\b/i.test(result.stdout + result.stderr)
      ) {
        throw new BanzaiError(
          "CODEX_SUBSCRIPTION_REQUIRED",
          "Codex subscription authentication is unavailable. Run `codex login` and select ChatGPT authentication."
        );
      }
    },

    async preflightClaude(
      target,
      sourceEnvironment = process.env
    ): Promise<void> {
      await requireVersion(runner, "claude", target, sourceEnvironment);
      const result = await runner({
        command: target.executable,
        args: ["auth", "status", "--json"],
        cwd: process.cwd(),
        env: subscriptionOnlyEnvironment(sourceEnvironment),
        timeoutMs: 30_000
      });
      let status: Record<string, unknown>;
      try {
        status = JSON.parse(result.stdout) as Record<string, unknown>;
      } catch {
        throw new BanzaiError(
          result.exitCode === 0
            ? "CLAUDE_AUTH_STATUS_INVALID"
            : "CLAUDE_AUTH_STATUS_FAILED",
          result.exitCode === 0
            ? "Claude authentication status returned an invalid structured response. Run `claude auth status` in a regular terminal, restore login if needed, or use the supported `claude setup-token` flow for unattended execution."
            : `Claude authentication status invocation failed with exit code ${result.exitCode}. Run it in a regular terminal, restore login if needed, or use the supported \`claude setup-token\` flow for unattended execution.`
        );
      }
      const authMethod = String(status.authMethod ?? "").toLowerCase();
      const provider = String(status.apiProvider ?? "").toLowerCase();
      if (
        status.loggedIn === false &&
        isCodexSandboxEnvironment(sourceEnvironment)
      ) {
        throw new BanzaiError(
          "CLAUDE_AUTH_UNAVAILABLE_IN_SANDBOX",
          "Claude reported no subscription login while Banzai is running inside a Codex sandbox. Authentication visibility is unproven: the sandbox can prevent Claude Code from reading a credential store such as macOS Keychain, but this result does not prove that a credential exists. Run `banzai` in a regular terminal to check or restore login, or use `claude setup-token` outside the sandbox and provide its subscription token through `CLAUDE_CODE_OAUTH_TOKEN`."
        );
      }
      if (result.exitCode !== 0 && status.loggedIn === true) {
        throw new BanzaiError(
          "CLAUDE_AUTH_STATUS_FAILED",
          `Claude authentication status invocation failed with exit code ${result.exitCode}. Run \`claude auth status\` in a regular terminal before retrying Banzai.`
        );
      }
      if (
        status.loggedIn !== true ||
        authMethod.includes("api") ||
        (provider.length > 0 && provider !== "firstparty")
      ) {
        throw new BanzaiError(
          "CLAUDE_SUBSCRIPTION_REQUIRED",
          "Claude subscription authentication is unavailable. Run `claude auth login`; API-key and third-party provider authentication are not accepted."
        );
      }
    },

    async runSelection(
      request: WorkflowSelectionAdapterRequest
    ): Promise<AdapterResult<ReturnType<typeof parseWorkflowSelectionResult>>> {
      const vendor = requireVendor(request.settings.executable);
      return await withModelFailureEvidence(runner, vendor, async (run) => {
        const env = subscriptionOnlyEnvironment(request.env);
        if (vendor === "claude") {
          const observeProgress = createClaudeProgressObserver(
            request.onProgress,
            request.repoRoot
          );
          const terminal = createClaudeTerminalObserver(
            parseWorkflowSelectionResult,
            request.onTerminalSuccess
          );
          const processResult = await run({
            command: request.settings.executable,
            args: buildClaudeSelectionArguments(request),
            cwd: request.repoRoot,
            env,
            timeoutMs: request.settings.timeoutMs,
            onStart: request.onStart,
            onStdoutLine: observeProgress,
            onStdoutLineDurable: terminal.observe
          });
          if (processResult.exitCode !== 0) {
            throw processExitError(
              "CLAUDE_SELECTION_FAILED",
              "Claude",
              processResult
            );
          }
          const parsed = claudeStructuredResult(
            decodeClaudeStdout(processResult.stdout),
            parseWorkflowSelectionResult
          );
          requireCheckpointResultParity(terminal.result(), parsed.result);
          return {
            result: parsed.result,
            sessionId: parsed.sessionId,
            stdout: processResult.stdout,
            stderr: processResult.stderr,
            usage: parsed.usage,
            inventory: claudeSessionInventory(processResult.stdout),
            turnCount: claudeTurnCount(processResult.stdout)
          };
        }

        const { schemaPath, outputPath } = await writeCodexContract(
          request.runDirectory,
          request.attemptId,
          "workflow-selection.schema.json",
          requestOutputContract(request, "codex", "workflow-selection/v1")
        );
        const observeProgress = createCodexProgressObserver(
          request.onProgress,
          request.repoRoot
        );
        const terminal = createCodexTerminalObserver(
          parseWorkflowSelectionResult,
          request.onTerminalSuccess
        );
        const processResult = await run({
          command: request.settings.executable,
          args: buildCodexArguments(
            { ...request, resumeSessionId: null },
            schemaPath,
            outputPath,
            "read-only"
          ),
          cwd: request.repoRoot,
          env,
          timeoutMs: request.settings.timeoutMs,
          onStart: request.onStart,
          onStdoutLine: observeProgress,
          onStdoutLineDurable: terminal.observe
        });
        if (processResult.exitCode !== 0) {
          throw processExitError(
            "CODEX_SELECTION_FAILED",
            "Codex",
            processResult
          );
        }
        const result = parseWorkflowSelectionResult(
          await readCodexResult(outputPath)
        );
        requireCheckpointResultParity(terminal.result(), result);
        return {
          result,
          sessionId: codexSessionId(processResult.stdout),
          stdout: processResult.stdout,
          stderr: processResult.stderr,
          usage: codexUsage(processResult.stdout)
        };
      });
    },

    async runPhase(
      request: PhaseAdapterRequest
    ): Promise<AdapterResult<PhaseResult | PhaseResultEnvelope>> {
      const vendor = requireVendor(request.settings.executable);
      // Selected from the persisted attempt protocol, never from the result
      // shape: under the completion protocol a valid stop with a malformed
      // ledger is returned as a safe envelope instead of being discarded.
      const parse: (value: unknown) => PhaseResult | PhaseResultEnvelope =
        request.completionProtocol === undefined
          ? parsePhaseResult
          : parsePhaseResultEnvelope;
      return await withModelFailureEvidence(runner, vendor, async (run) => {
        const env = subscriptionOnlyEnvironment(request.env);
        if (vendor === "claude") {
          const observeProgress = createClaudeProgressObserver(
            request.onProgress,
            request.repoRoot
          );
          const terminal = createClaudeTerminalObserver(
            parse,
            request.onTerminalSuccess
          );
          const processResult = await run({
            command: request.settings.executable,
            args: buildClaudePhaseArguments(request),
            cwd: request.repoRoot,
            env,
            timeoutMs: request.settings.timeoutMs,
            onStart: request.onStart,
            onStdoutLine: observeProgress,
            onStdoutLineDurable: observeSessionStart(
              vendor,
              request.onSessionStarted,
              terminal.observe
            )
          });
          if (processResult.exitCode !== 0) {
            throw processExitError(
              "CLAUDE_PHASE_FAILED",
              "Claude",
              processResult
            );
          }
          const parsed = claudeStructuredResult(
            decodeClaudeStdout(processResult.stdout),
            parse
          );
          requireCheckpointResultParity(terminal.result(), parsed.result);
          return {
            result: parsed.result,
            sessionId: parsed.sessionId,
            stdout: processResult.stdout,
            stderr: processResult.stderr,
            usage: parsed.usage,
            inventory: claudeSessionInventory(processResult.stdout),
            turnCount: claudeTurnCount(processResult.stdout)
          };
        }

        const { schemaPath, outputPath } = await writeCodexContract(
          request.runDirectory,
          request.attemptId,
          "phase-result.schema.json",
          requestOutputContract(
            request,
            "codex",
            request.outputContract.identity === "phase-result/v4"
              ? "phase-result/v4"
              : "phase-result/v3"
          )
        );
        const observeProgress = createCodexProgressObserver(
          request.onProgress,
          request.repoRoot
        );
        const terminal = createCodexTerminalObserver(
          parse,
          request.onTerminalSuccess
        );
        const processResult = await run({
          command: request.settings.executable,
          args: buildCodexArguments(request, schemaPath, outputPath),
          cwd: request.repoRoot,
          env,
          timeoutMs: request.settings.timeoutMs,
          onStart: request.onStart,
          onStdoutLine: observeProgress,
          onStdoutLineDurable: observeSessionStart(
            vendor,
            request.onSessionStarted,
            terminal.observe
          )
        });
        if (processResult.exitCode !== 0) {
          throw processExitError("CODEX_PHASE_FAILED", "Codex", processResult);
        }
        const result = parse(await readCodexResult(outputPath));
        requireCheckpointResultParity(terminal.result(), result);
        return {
          result,
          sessionId: codexSessionId(processResult.stdout),
          stdout: processResult.stdout,
          stderr: processResult.stderr,
          usage: codexUsage(processResult.stdout)
        };
      });
    },

    async runPlanningReview(request) {
      return runPlanningAdapter(
        runner,
        request,
        "planning-review-result/v1",
        parsePlanningReviewResult
      );
    },
    async runPlanningAnalysis(request) {
      return runPlanningAdapter(
        runner,
        request,
        "planning-review-analysis/v1",
        parsePlanningReviewAnalysis
      );
    },

    async runReview(
      request: ReviewAdapterRequest
    ): Promise<AdapterResult<ReviewResult>> {
      const vendor = requireVendor(request.settings.executable);
      return await withModelFailureEvidence(runner, vendor, async (run) => {
        const reviewEnvironment: NodeJS.ProcessEnv = {
          ...request.env,
          BANZAI_RUN_ID: request.runId,
          BANZAI_APPROVAL_DIGEST: request.approvalDigest
        };
        delete reviewEnvironment.BANZAI_REVIEW_ARTIFACT;
        delete reviewEnvironment.BANZAI_WORKFLOW_DIGEST;
        const env = subscriptionOnlyEnvironment(reviewEnvironment);
        if (vendor === "codex") {
          const { schemaPath, outputPath } = await writeCodexContract(
            request.runDirectory,
            request.attemptId,
            "review-result.schema.json",
            requestOutputContract(request, "codex", "review-result/v2")
          );
          const observeProgress = createCodexProgressObserver(
            request.onProgress,
            request.repoRoot
          );
          const terminal = createCodexTerminalObserver(
            parseCurrentReviewResult,
            request.onTerminalSuccess
          );
          const processResult = await run({
            command: request.settings.executable,
            args: buildCodexArguments(
              request,
              schemaPath,
              outputPath,
              // Review must not mutate the tree; the runner re-checks the
              // workspace digest afterwards regardless.
              "read-only"
            ),
            cwd: request.repoRoot,
            env,
            timeoutMs: request.settings.timeoutMs,
            onStart: request.onStart,
            onStdoutLine: observeProgress,
            onStdoutLineDurable: terminal.observe
          });
          if (processResult.exitCode !== 0) {
            throw processExitError(
              "CODEX_REVIEW_FAILED",
              "Codex",
              processResult
            );
          }
          const result = parseCurrentReviewResult(
            await readCodexResult(outputPath)
          );
          requireCheckpointResultParity(terminal.result(), result);
          return {
            result,
            sessionId: codexSessionId(processResult.stdout),
            stdout: processResult.stdout,
            stderr: processResult.stderr,
            usage: codexUsage(processResult.stdout)
          };
        }

        const observeProgress = createClaudeProgressObserver(
          request.onProgress,
          request.repoRoot
        );
        const terminal = createClaudeTerminalObserver(
          parseCurrentReviewResult,
          request.onTerminalSuccess
        );
        const processResult = await run({
          command: request.settings.executable,
          args: buildClaudeArguments(request),
          cwd: request.repoRoot,
          env,
          timeoutMs: request.settings.timeoutMs,
          onStart: request.onStart,
          onStdoutLine: observeProgress,
          onStdoutLineDurable: terminal.observe
        });
        if (processResult.exitCode !== 0) {
          throw processExitError(
            "CLAUDE_REVIEW_FAILED",
            "Claude",
            processResult
          );
        }
        const parsed = claudeStructuredResult(
          decodeClaudeStdout(processResult.stdout),
          parseCurrentReviewResult
        );
        requireCheckpointResultParity(terminal.result(), parsed.result);
        return {
          result: parsed.result,
          sessionId: parsed.sessionId,
          stdout: processResult.stdout,
          stderr: processResult.stderr,
          usage: parsed.usage,
          inventory: claudeSessionInventory(processResult.stdout),
          turnCount: claudeTurnCount(processResult.stdout)
        };
      });
    }
  };
}

// Share the existing adapter dispatch identity with offline invocation diagnostics.
export { vendorFor, FALLBACK_VENDOR, MODEL_ROLES } from "./models.js";
