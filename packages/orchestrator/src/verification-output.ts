/**
 * Bounded, read-only tails of retained verification logs for human status.
 * Logs are already redacted at persistence; they are still untrusted display
 * input, so every line is redacted, stripped and escaped again (ADR-0049 §8).
 */
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { safePath } from "./project-files.js";
import { redactSensitiveText } from "./process.js";
import { escapeTerminalText } from "./format.js";
import { hasCommandOutput } from "./verification-outcome.js";
import type { RunState } from "./types.js";
import type { TaskVerificationAttempt } from "./verification-evidence.js";

export const OUTPUT_TAIL_LINES = 20;
const TAIL_BYTES = 64 * 1024;
const LINE_CHARACTERS = 300;
// CSI, OSC (BEL or ST terminated) and two-byte escape sequences.
const ANSI_SEQUENCE =
  /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[@-Z\\-_]/gu;

export interface VerificationOutputTail {
  stream: "stderr" | "stdout";
  lines: string[];
  /** Earlier output exists beyond the displayed lines. */
  truncated: boolean;
}

/** Keyed by physical attempt ID; `null` marks a log that could not be read. */
export type VerificationOutputTails = ReadonlyMap<
  string,
  VerificationOutputTail | null
>;

/** Loads tails only for checks whose latest attempt did not succeed. */
export async function readVerificationOutputTails(
  repoRoot: string,
  state: RunState
): Promise<VerificationOutputTails> {
  const tails = new Map<string, VerificationOutputTail | null>();
  const publication = state.taskVerification;
  if (publication === undefined) return tails;
  for (const item of publication.applicability.dispositions) {
    if (item.kind === "passed" || item.kind === "reused") continue;
    const attempt = publication.attempts.find(
      (entry) => entry.id === item.attemptId
    );
    if (attempt === undefined || !hasCommandOutput(attempt)) continue;
    tails.set(attempt.id, await attemptTail(repoRoot, attempt));
  }
  return tails;
}

async function attemptTail(
  repoRoot: string,
  attempt: TaskVerificationAttempt
): Promise<VerificationOutputTail | null> {
  try {
    const stderr =
      attempt.stderr === null
        ? null
        : await readTail(repoRoot, attempt.stderr.relativePath);
    if (stderr !== null && stderr.lines.length > 0)
      return { stream: "stderr", ...stderr };
    const stdout =
      attempt.stdout === null
        ? null
        : await readTail(repoRoot, attempt.stdout.relativePath);
    return {
      stream: stdout === null ? "stderr" : "stdout",
      ...(stdout ?? { lines: [], truncated: false })
    };
  } catch {
    return null;
  }
}

async function readTail(
  repoRoot: string,
  relativePath: string
): Promise<{ lines: string[]; truncated: boolean }> {
  const handle = await open(
    await safePath(repoRoot, relativePath),
    constants.O_RDONLY | constants.O_NOFOLLOW
  );
  try {
    const { size } = await handle.stat();
    const start = Math.max(0, size - TAIL_BYTES);
    const buffer = Buffer.alloc(size - start);
    await handle.read(buffer, 0, buffer.length, start);
    const lines = buffer
      .toString("utf8")
      .replace(/\r?\n$/u, "")
      .split(/\r?\n/u);
    // A tail that starts mid-file starts mid-line, possibly mid-character.
    if (start > 0) lines.shift();
    while (lines.length > 0 && lines.at(-1)?.trim() === "") lines.pop();
    return {
      lines: lines.slice(-OUTPUT_TAIL_LINES).map(displayLine),
      truncated: start > 0 || lines.length > OUTPUT_TAIL_LINES
    };
  } finally {
    await handle.close();
  }
}

function displayLine(line: string): string {
  // A carriage return redraws the terminal line; keep what remained visible.
  const visible = redactSensitiveText(line)
    .replace(ANSI_SEQUENCE, "")
    .split("\r")
    .reduceRight((last, part) => (last === "" ? part : last), "")
    .trimEnd();
  const bounded =
    visible.length > LINE_CHARACTERS
      ? `${visible.slice(0, LINE_CHARACTERS)}…`
      : visible;
  return escapeTerminalText(bounded);
}
