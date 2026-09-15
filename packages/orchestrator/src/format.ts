/**
 * Terminal presentation helpers shared by the interactive session and the
 * non-interactive command output. Nothing here reads process state, so both
 * surfaces stay testable against an explicit width.
 */

const MIN_WIDTH = 40;
const MAX_WIDTH = 96;
const DEFAULT_WIDTH = 80;

/**
 * Clamps a reported terminal width into the range worth wrapping to. A very
 * wide pane still wraps at `MAX_WIDTH` because prose stops being readable long
 * before the pane ends, and a very narrow one wraps at `MIN_WIDTH` and lets the
 * terminal soft-wrap the remainder.
 */
export function resolveWidth(columns: number | undefined): number {
  if (columns === undefined || !Number.isFinite(columns)) {
    return DEFAULT_WIDTH;
  }
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.floor(columns)));
}

/**
 * Wraps on word boundaries only. A token longer than the available width — a
 * run id, a file path — is emitted alone and unbroken so it stays selectable
 * and copy-pasteable instead of being split mid-path.
 */
export function wrapText(text: string, width: number, indent = ""): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return [];
  }
  const limit = Math.max(1, width - indent.length);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (current.length === 0) {
      current = word;
      continue;
    }
    if (current.length + 1 + word.length <= limit) {
      current = `${current} ${word}`;
      continue;
    }
    lines.push(`${indent}${current}`);
    current = word;
  }
  lines.push(`${indent}${current}`);
  return lines;
}

/**
 * Renders `Label: body` when it fits, and otherwise a bare label line followed
 * by the indented, wrapped body. Short fields keep their existing single-line
 * shape; only prose long enough to overflow changes.
 */
export function labeledLines(
  label: string,
  body: string,
  width: number,
  indent = "  "
): string[] {
  const value = body.trim();
  if (value.length === 0) {
    return [`${label}:`];
  }
  const single = `${label}: ${value}`;
  if (single.length <= width) {
    return [single];
  }
  return [`${label}:`, ...wrapText(value, width, indent)];
}

/**
 * Wraps `body` so the first line carries `prefix` and every continuation aligns
 * under it. Used for numbered questions and finding summaries.
 */
/**
 * The narrowest body a hanging indent may be squeezed to. Below this the prose
 * degenerates to one word per line, which is unreadable and can run to dozens
 * of lines — a long evidence path is enough to trigger it.
 */
const MIN_HANGING_BODY = 24;

/**
 * The narrowest body column a hanging indent may leave behind.
 *
 * Aligning continuations under the prefix only pays for itself while the body
 * keeps a readable share of the line. A long path prefix — the common case for
 * review evidence — leaves a column so narrow that prose breaks every three or
 * four words, turning one sentence into seven ragged lines; the prefix is
 * better off on its own line with the body wrapped at nearly the full width.
 * Half the width is the dividing line, floored so a narrow pane still hangs
 * short labels rather than breaking every one of them.
 */
function hangingBodyFloor(width: number): number {
  return Math.max(MIN_HANGING_BODY, Math.floor(width / 2));
}

export function hangingLines(
  prefix: string,
  body: string,
  width: number
): string[] {
  const value = body.trim();
  if (value.length === 0) {
    return [prefix.trimEnd()];
  }
  if (width - prefix.length < hangingBodyFloor(width)) {
    // Too little room to hang under: give the prefix its own line and indent
    // the body relative to wherever the prefix itself started.
    const lead = /^\s*/.exec(prefix)?.[0] ?? "";
    return [prefix.trimEnd(), ...wrapText(value, width, `${lead}  `)];
  }
  const indent = " ".repeat(prefix.length);
  const wrapped = wrapText(value, width, indent);
  const first = wrapped[0];
  if (first === undefined) {
    return [prefix.trimEnd()];
  }
  return [`${prefix}${first.slice(indent.length)}`, ...wrapped.slice(1)];
}

function trimmedDecimal(value: number): string {
  return value.toFixed(1).replace(/\.0$/, "");
}

/** Renders a token count at terminal scale: `120`, `21.6K`, `8.3M`. */
export function formatTokenCount(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return "0";
  }
  const count = Math.round(value);
  if (count < 1_000) {
    return String(count);
  }
  if (count < 1_000_000) {
    return `${trimmedDecimal(count / 1_000)}K`;
  }
  return `${trimmedDecimal(count / 1_000_000)}M`;
}

/**
 * Renders one turn or one run of token consumption. The input total sums every
 * stateless request, and each request re-counts the whole conversation, so the
 * numbers that explain an otherwise alarming total are shown beside it: how
 * many turns produced the sum, and how little of it was fresh rather than
 * served from cache. The percentage floors instead of rounds so `100% cached`
 * appears only when every input token was served from cache; a run with any
 * fresh input caps at 99%.
 */
export function formatUsage(
  inputTokens: number,
  cachedInputTokens: number,
  outputTokens: number,
  turns?: number
): string {
  const parts: string[] = [];
  if (turns !== undefined && Number.isFinite(turns) && turns >= 1) {
    const count = Math.round(turns);
    parts.push(`${count} turn${count === 1 ? "" : "s"}`);
  }
  if (inputTokens > 0 && cachedInputTokens > 0) {
    const cached = Math.min(cachedInputTokens, inputTokens);
    const fresh = inputTokens - cached;
    parts.push(
      `${formatTokenCount(inputTokens)} in (${formatTokenCount(fresh)} fresh · ${Math.floor((cached / inputTokens) * 100)}% cached)`
    );
  } else {
    parts.push(`${formatTokenCount(inputTokens)} in`);
  }
  parts.push(`${formatTokenCount(outputTokens)} out`);
  return parts.join(" · ");
}

export function escapeTerminalText(text: string): string {
  return text.replace(
    /[\x00-\x08\x0b-\x1f\x7f-\x9f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu,
    (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`
  );
}
