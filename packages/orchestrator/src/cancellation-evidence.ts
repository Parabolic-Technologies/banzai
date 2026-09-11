import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import {
  cancellationInstant,
  cancellationRecord,
  cancellationValue
} from "./cancellation.js";
import type {
  CancellationContext,
  CancellationEventInput
} from "./cancellation.js";
import { parseVerificationAttemptRecord } from "./validation.js";

export interface CancellationContextLinks {
  activeVerification: boolean;
  adr: { id: string; decision: string; decidedAt: string } | null;
}

/** Resolve only structurally bound references after stopping; never copy prose. */
export async function enrichCancellationContext(
  root: string,
  runId: string,
  at: string,
  context: CancellationContext,
  links: CancellationContextLinks,
  eventFile: CancellationFile
): Promise<CancellationContext> {
  const result = structuredClone(context);
  if (
    links.adr !== null &&
    result.decision.value === null &&
    decodeCancellationEvents(eventFile).availability === "available"
  ) {
    const matching: { eventOrdinal: number; eventAt: string }[] = [];
    for (const [index, line] of (eventFile.text ?? "").split("\n").entries()) {
      if (!line) continue;
      const event = cancellationRecord(JSON.parse(line));
      const details = cancellationRecord(event.details);
      if (
        event.runId === runId &&
        event.type === "approval.adr" &&
        details.id === links.adr.id &&
        details.decision === links.adr.decision &&
        cancellationInstant(event.at) &&
        event.at >= links.adr.decidedAt &&
        event.at <= at
      )
        matching.push({ eventOrdinal: index + 1, eventAt: event.at });
    }
    const reference = matching.length === 1 ? matching[0] : undefined;
    if (reference !== undefined)
      result.decision = cancellationValue(
        { kind: "adr", ...reference, relationship: "prior_decision" },
        "event.approval.adr"
      );
  }
  if (links.activeVerification) {
    const directory = await readCancellationDirectory(
      root,
      `.banzai/runs/${runId}/verification-attempts`
    );
    const candidates = directory.entries.filter(
      (e) => e.name !== "ledger.json" && e.name.endsWith(".json")
    );
    if (
      directory.availability !== "available" ||
      candidates.length > CANCELLATION_LIMITS.leaves
    )
      return result;
    let bytes = 0;
    const matches: { kind: "verification"; id: string; sequence: number }[] =
      [];
    for (const entry of candidates) {
      if (bytes >= CANCELLATION_LIMITS.leafBytes) return result;
      const file = await readCancellationFile(
        root,
        `.banzai/runs/${runId}/verification-attempts/${entry.name}`,
        CANCELLATION_LIMITS.leafBytes - bytes
      );
      if (file.text === null || file.availability !== "available")
        return result;
      bytes += file.fingerprint?.size ?? 0;
      const record = parseVerificationAttemptRecord(JSON.parse(file.text));
      if (
        entry.name !==
        `verification-${String(record.sequence).padStart(6, "0")}-${record.id}.json`
      )
        return result;
      if (
        record.startedAt <= at &&
        (record.completedAt === null || record.completedAt >= at)
      )
        matches.push({
          kind: "verification",
          id: record.id,
          sequence: record.sequence
        });
    }
    const match = matches.length === 1 ? matches[0] : undefined;
    if (match !== undefined)
      result.attempt = cancellationValue(
        [...(result.attempt.value ?? []), match],
        "verification.attempt"
      );
  }
  return result;
}

export const CANCELLATION_LIMITS = {
  state: 2 * 1024 * 1024,
  humanTime: 2 * 1024 * 1024,
  events: 8 * 1024 * 1024,
  lines: 10000,
  line: 256 * 1024,
  observation: 16 * 1024,
  leaves: 4096,
  leafBytes: 16 * 1024 * 1024
} as const;
export interface CancellationFingerprint {
  dev: number;
  ino: number;
  size: number;
  mtimeMs: number;
  ctimeMs: number;
  digest: string;
}
export interface CancellationFile {
  availability: "available" | "missing" | "malformed" | "unavailable";
  text: string | null;
  fingerprint: CancellationFingerprint | null;
  issue:
    | "EVIDENCE_MISSING"
    | "EVIDENCE_UNAVAILABLE"
    | "UNSAFE_EVIDENCE"
    | "EVIDENCE_LIMIT"
    | "SOURCE_CHANGED"
    | "MALFORMED_EVIDENCE"
    | null;
}
export interface CancellationDirectory {
  availability: "available" | "missing" | "unavailable";
  entries: { name: string; kind: "file" | "directory" | "unsafe" }[];
  issue: CancellationFile["issue"];
}
function failure(error: unknown): CancellationFile {
  const code = cancellationRecord(error).code;
  return {
    availability: code === "ENOENT" ? "missing" : "unavailable",
    text: null,
    fingerprint: null,
    issue:
      code === "ENOENT"
        ? "EVIDENCE_MISSING"
        : code === "UNSAFE_EVIDENCE" || code === "ELOOP"
          ? "UNSAFE_EVIDENCE"
          : "EVIDENCE_UNAVAILABLE"
  };
}
export async function cancellationEvidencePath(
  root: string,
  relative: string,
  directory = false
): Promise<string> {
  const parts = relative.split("/");
  if (
    parts.length === 0 ||
    parts.some(
      (p) =>
        !p || p === "." || p === ".." || p.includes("\\") || p.includes("\0")
    ) ||
    path.isAbsolute(relative)
  ) {
    throw Object.assign(new Error("Unsafe evidence."), {
      code: "UNSAFE_EVIDENCE"
    });
  }
  let current = await realpath(root);
  for (let i = 0; i < parts.length; i++) {
    const segment = parts[i];
    if (segment === undefined) throw new Error("Invalid evidence path.");
    current = path.join(current, segment);
    const stat = await lstat(current);
    if (
      stat.isSymbolicLink() ||
      (i < parts.length - 1 || directory ? !stat.isDirectory() : !stat.isFile())
    ) {
      throw Object.assign(new Error("Unsafe evidence."), {
        code: "UNSAFE_EVIDENCE"
      });
    }
  }
  return current;
}
export async function readCancellationFile(
  root: string,
  relative: string,
  maximum: number
): Promise<CancellationFile> {
  try {
    const file = await cancellationEvidencePath(root, relative);
    const handle = await open(
      file,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
    );
    try {
      const before = await handle.stat();
      if (!before.isFile())
        return {
          availability: "unavailable",
          text: null,
          fingerprint: null,
          issue: "UNSAFE_EVIDENCE"
        };
      if (before.size > maximum)
        return {
          availability: "unavailable",
          text: null,
          fingerprint: null,
          issue: "EVIDENCE_LIMIT"
        };
      const bytes = Buffer.alloc(Math.min(maximum + 1, before.size + 1));
      let length = 0;
      while (length < bytes.length) {
        const read = await handle.read(
          bytes,
          length,
          bytes.length - length,
          length
        );
        if (read.bytesRead === 0) break;
        length += read.bytesRead;
      }
      const after = await handle.stat();
      const named = await lstat(file);
      if (
        length !== before.size ||
        before.size !== after.size ||
        before.mtimeMs !== after.mtimeMs ||
        before.ctimeMs !== after.ctimeMs ||
        named.isSymbolicLink() ||
        named.ino !== after.ino ||
        named.dev !== after.dev
      ) {
        return {
          availability: "unavailable",
          text: null,
          fingerprint: null,
          issue: "SOURCE_CHANGED"
        };
      }
      const content = bytes.subarray(0, length);
      let text: string;
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(content);
      } catch {
        return {
          availability: "malformed",
          text: null,
          fingerprint: null,
          issue: "MALFORMED_EVIDENCE"
        };
      }
      return {
        availability: "available",
        text,
        fingerprint: {
          dev: after.dev,
          ino: after.ino,
          size: after.size,
          mtimeMs: after.mtimeMs,
          ctimeMs: after.ctimeMs,
          digest: createHash("sha256").update(content).digest("hex")
        },
        issue: null
      };
    } finally {
      await handle.close();
    }
  } catch (error) {
    return failure(error);
  }
}
export async function cancellationFileIdentityMatches(
  root: string,
  relative: string,
  fingerprint: CancellationFingerprint | null
): Promise<boolean> {
  try {
    const file = await cancellationEvidencePath(root, relative);
    const stat = await lstat(file);
    return (
      fingerprint !== null &&
      stat.dev === fingerprint.dev &&
      stat.ino === fingerprint.ino &&
      stat.size === fingerprint.size &&
      stat.mtimeMs === fingerprint.mtimeMs &&
      stat.ctimeMs === fingerprint.ctimeMs
    );
  } catch (error) {
    return fingerprint === null && cancellationRecord(error).code === "ENOENT";
  }
}
export async function readCancellationDirectory(
  root: string,
  relative: string
): Promise<CancellationDirectory> {
  try {
    const directory = await cancellationEvidencePath(root, relative, true);
    const before = await lstat(directory);
    const entries = (await readdir(directory, { withFileTypes: true }))
      .map((e) => ({
        name: e.name,
        kind: e.isSymbolicLink()
          ? ("unsafe" as const)
          : e.isDirectory()
            ? ("directory" as const)
            : e.isFile()
              ? ("file" as const)
              : ("unsafe" as const)
      }))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    const after = await lstat(directory);
    if (
      before.ino !== after.ino ||
      before.dev !== after.dev ||
      before.mtimeMs !== after.mtimeMs ||
      after.isSymbolicLink()
    ) {
      return { availability: "unavailable", entries, issue: "SOURCE_CHANGED" };
    }
    return { availability: "available", entries, issue: null };
  } catch (error) {
    const result = failure(error);
    return {
      availability:
        result.availability === "missing" ? "missing" : "unavailable",
      entries: [],
      issue: result.issue
    };
  }
}
export function decodeCancellationEvents(file: CancellationFile): {
  events: CancellationEventInput[];
  availability: CancellationFile["availability"];
} {
  if (file.text === null)
    return { events: [], availability: file.availability };
  const lines = file.text.split("\n");
  if (lines.length > CANCELLATION_LIMITS.lines + 1)
    return { events: [], availability: "unavailable" };
  let malformed = file.text.length > 0 && !file.text.endsWith("\n");
  const events: CancellationEventInput[] = [];
  for (const line of lines) {
    if (!line) continue;
    if (Buffer.byteLength(line) > CANCELLATION_LIMITS.line)
      return { events, availability: "unavailable" };
    try {
      const r = cancellationRecord(JSON.parse(line));
      if (
        typeof r.type !== "string" ||
        typeof r.runId !== "string" ||
        !cancellationInstant(r.at) ||
        r.details === null ||
        typeof r.details !== "object" ||
        Array.isArray(r.details)
      )
        throw new Error("Invalid event.");
      if (
        r.type === "run.cancelled" ||
        r.type === "run.cancellation_response"
      ) {
        events.push({
          type: r.type,
          at: r.at,
          runId: r.runId,
          details: cancellationRecord(r.details)
        });
      }
    } catch {
      malformed = true;
    }
  }
  return { events, availability: malformed ? "malformed" : file.availability };
}
