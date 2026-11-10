/**
 * The Gate 1 probe's stream classification and verdict (ADR-0063 §6). Pure, so
 * recorded stream lines can test it without a vendor client.
 */

export interface ProbeObservation {
  /** `result` events seen in the invocation's stream. */
  results: number;
  /** Entries in every `result` event's `permission_denials`. */
  permissionDenials: number;
  /** Any sign that a command ran in, or moved to, the background. */
  backgroundEvents: number;
  /** Whether the sentinel existed when the first `result` line arrived. */
  sentinelAtFirstResult: boolean | null;
}

export interface ProbeInvocation {
  observation: ProbeObservation;
  /** The child's exit status; null when the runner rejected without one. */
  exitCode: number | null;
  /** The adapter's error code, or null when it resolved. */
  errorCode: string | null;
}

export type ProbeVerdict = "pass" | "fail" | "inconclusive";

export function emptyProbeObservation(): ProbeObservation {
  return {
    results: 0,
    permissionDenials: 0,
    backgroundEvents: 0,
    sentinelAtFirstResult: null
  };
}

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function contentBlocks(event: JsonRecord): JsonRecord[] {
  const content = record(event.message)?.content;
  return Array.isArray(content)
    ? content.map(record).filter((block) => block !== null)
    : [];
}

function toolResultText(block: JsonRecord): string {
  if (typeof block.content === "string") {
    return block.content;
  }
  return Array.isArray(block.content)
    ? block.content
        .map((part) => record(part)?.text)
        .filter((text) => typeof text === "string")
        .join("\n")
    : "";
}

const BACKGROUND_TOOL_RESULT =
  /\b(?:running|runs|run|moved|continues?) (?:in|to) (?:the )?background\b|\bbackground (?:task|shell|command)\b/i;
const BACKGROUND_SYSTEM_SUBTYPE = /task|background/i;

/**
 * Counts one stdout line. A background-task event is any of:
 * - a `tool_use` block whose input sets `run_in_background`;
 * - a `tool_result` block whose text says a command runs in the background;
 * - a `system` event whose `subtype` names a task or the background.
 */
export function observeProbeLine(
  observation: ProbeObservation,
  line: string,
  sentinelExists: () => boolean
): void {
  let event: JsonRecord | null;
  try {
    event = record(JSON.parse(line));
  } catch {
    return;
  }
  if (event === null) {
    return;
  }
  if (event.type === "result") {
    observation.results += 1;
    observation.sentinelAtFirstResult ??= sentinelExists();
    if (Array.isArray(event.permission_denials)) {
      observation.permissionDenials += event.permission_denials.length;
    }
    return;
  }
  if (
    event.type === "system" &&
    typeof event.subtype === "string" &&
    BACKGROUND_SYSTEM_SUBTYPE.test(event.subtype)
  ) {
    observation.backgroundEvents += 1;
    return;
  }
  for (const block of contentBlocks(event)) {
    if (
      block.type === "tool_use" &&
      record(block.input)?.run_in_background === true
    ) {
      observation.backgroundEvents += 1;
    }
    if (
      block.type === "tool_result" &&
      BACKGROUND_TOOL_RESULT.test(toolResultText(block))
    ) {
      observation.backgroundEvents += 1;
    }
  }
}

function clean(invocation: ProbeInvocation): boolean {
  const { observation } = invocation;
  return (
    observation.results === 1 &&
    observation.permissionDenials === 0 &&
    observation.backgroundEvents === 0 &&
    invocation.exitCode === 0 &&
    invocation.errorCode !== "TERMINAL_RESULT_CONFLICT"
  );
}

/**
 * Passes when both invocations emit exactly one `result`, report no denial and
 * no background event, exit 0 and resolve, and the sentinel preceded the first
 * result. Clean counts with another adapter error, such as a structured-output
 * failure, say nothing about background tasks and are inconclusive.
 */
export function probeVerdict(
  first: ProbeInvocation,
  resumed: ProbeInvocation
): ProbeVerdict {
  if (
    !clean(first) ||
    !clean(resumed) ||
    first.observation.sentinelAtFirstResult !== true
  ) {
    return "fail";
  }
  return first.errorCode === null && resumed.errorCode === null
    ? "pass"
    : "inconclusive";
}
