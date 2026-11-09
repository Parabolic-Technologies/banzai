import { randomUUID } from "node:crypto";
import { lstat, open, readFile, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { BanzaiError, errorMessage } from "../../errors.js";
import { hashArtifactBytes } from "../../git.js";
import { readBytes } from "../../project-files.js";

/** A refused re-check changed nothing, and the run still waits (ADR-0058 §2). */
export function recheckRefused(message: string): BanzaiError {
  return new BanzaiError(
    "PLAN_RECHECK_REFUSED",
    `Re-check refused: ${message} Nothing was written; the run is still waiting at the plan gate.`
  );
}

/** The failure a caller raises when it refuses a plan-bundle file. */
export type PlanFileRefusal = (message: string) => Error;

/** Reads every bundle file as a regular, non-symlinked file inside the repository. */
export async function readRecheckBundle(
  repoRoot: string,
  paths: readonly string[],
  refuse: PlanFileRefusal = recheckRefused
): Promise<Map<string, Buffer>> {
  const bytes = new Map<string, Buffer>();
  for (const relative of paths) {
    let info: Awaited<ReturnType<typeof lstat>>;
    try {
      info = await lstat(path.join(repoRoot, relative));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        throw refuse(`${relative} is missing.`);
      throw refuse(`${relative}: ${errorMessage(error)}`);
    }
    if (info.isSymbolicLink())
      throw refuse(
        `${relative} is a symbolic link; replace it with a regular file.`
      );
    if (!info.isFile()) throw refuse(`${relative} is not a regular file.`);
    let read: Buffer | null;
    try {
      read = await readBytes(repoRoot, relative);
    } catch (error) {
      throw refuse(`${relative}: ${errorMessage(error)}`);
    }
    if (read === null) throw refuse(`${relative} is missing.`);
    bytes.set(relative, read);
  }
  return bytes;
}

/**
 * Decodes plan bytes so that encoding them again reproduces them exactly; the
 * digest rewrite must leave every other byte unchanged.
 */
export function exactUtf8(
  bytes: Buffer,
  label: string,
  refuse: PlanFileRefusal = recheckRefused
): string {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      bytes
    );
  } catch {
    throw refuse(`${label} is not valid UTF-8.`);
  }
  if (!Buffer.from(text, "utf8").equals(bytes))
    throw refuse(`${label} does not round-trip as UTF-8.`);
  return text;
}

function recheckChanged(relative: string): BanzaiError {
  return new BanzaiError(
    "PLAN_RECHECK_CHANGED",
    `${relative} changed while the re-check was running. Nothing was written; save your edits and choose Re-check my edits again.`
  );
}

/**
 * Replaces the plan only while it still holds the bytes the caller read, so an
 * edit saved in the meantime is never overwritten.
 */
export async function replacePlanBytes(
  repoRoot: string,
  relative: string,
  expected: Buffer,
  next: Buffer,
  changed: (relative: string) => Error = recheckChanged
): Promise<void> {
  const target = path.join(repoRoot, relative);
  const mode = (await lstat(target)).mode & 0o777;
  const temporary = path.join(
    path.dirname(target),
    `.${path.basename(target)}.${randomUUID()}.recheck.tmp`
  );
  const handle = await open(temporary, "wx", 0o600);
  try {
    try {
      await handle.writeFile(next);
      await handle.chmod(mode);
      await handle.sync();
    } finally {
      await handle.close();
    }
    if ((await readBytes(repoRoot, relative))?.equals(expected) !== true)
      throw changed(relative);
    await rename(temporary, target);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

/**
 * The bundle bytes retained at gate entry, read the way the approval snapshot
 * reads them and verified against the digests just computed.
 */
export async function gateEntryEntries(
  repoRoot: string,
  entries: readonly { path: string; sha256: string }[]
): Promise<{ path: string; sha256: string; contents: Buffer }[]> {
  const result: { path: string; sha256: string; contents: Buffer }[] = [];
  for (const entry of entries) {
    const contents = await readFile(path.resolve(repoRoot, entry.path));
    if (hashArtifactBytes(contents) !== entry.sha256)
      throw new BanzaiError(
        "PLAN_GATE_SNAPSHOT_INVALID",
        `Planning artifact ${entry.path} changed while the plan gate was being entered; the planner's version could not be retained.`
      );
    result.push({ ...entry, contents });
  }
  return result;
}
