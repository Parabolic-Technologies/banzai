import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { BanzaiError } from "./errors.js";
import { runProcess } from "./process.js";
import {
  privateArtifactInventory,
  type ArtifactBoundWork
} from "./artifact-storage.js";

const GIT_TIMEOUT_MS = 2 * 60 * 1000;

async function runGit(repoRoot: string, args: string[]) {
  return await runProcess({
    command: "git",
    args,
    cwd: repoRoot,
    env: { ...process.env, LC_ALL: "C" },
    timeoutMs: GIT_TIMEOUT_MS
  });
}

async function git(
  repoRoot: string,
  args: string[]
): Promise<{ stdout: string; stderr: string }> {
  const result = await runGit(repoRoot, args);
  if (result.exitCode !== 0) {
    // Match only failed discovery, not corrupt gitdir pointers or access errors.
    if (result.stderr.startsWith("fatal: not a git repository (or any")) {
      throw new BanzaiError(
        "GIT_REPOSITORY_REQUIRED",
        "Banzai requires a Git repository. Run `git init` in your project directory and create an initial commit, then start Banzai again."
      );
    }
    throw new BanzaiError(
      "GIT_FAILED",
      `git ${args.join(" ")} failed: ${result.stderr.trim() || "unknown error"}`
    );
  }
  return result;
}

export async function discoverRepositoryRoot(cwd: string): Promise<string> {
  const result = await git(cwd, ["rev-parse", "--show-toplevel"]);
  return result.stdout.trim();
}

export async function currentCommit(repoRoot: string): Promise<string> {
  try {
    const result = await git(repoRoot, [
      "rev-parse",
      "--verify",
      "HEAD^{commit}"
    ]);
    return result.stdout.trim();
  } catch (error) {
    if (!(error instanceof BanzaiError) || error.code !== "GIT_FAILED") {
      throw error;
    }
    const symbolicHead = await runGit(repoRoot, [
      "symbolic-ref",
      "--quiet",
      "HEAD"
    ]);
    const reference = symbolicHead.stdout.trim();
    if (symbolicHead.exitCode === 0 && reference.startsWith("refs/heads/")) {
      const existing = await runGit(repoRoot, [
        "show-ref",
        "--verify",
        "--quiet",
        reference
      ]);
      // An absent branch ref identifies an unborn HEAD; invalid objects and
      // other Git failures must retain their original diagnostic.
      if (existing.exitCode === 1) {
        throw new BanzaiError(
          "GIT_INITIAL_COMMIT_REQUIRED",
          'Banzai requires at least one commit on the current branch. Create an initial commit, then start Banzai again. For an empty baseline that leaves staged files uncommitted, run: git commit --allow-empty --only -m "Initial commit"'
        );
      }
    }
    throw error;
  }
}

/**
 * The checked-out branch, or null on a detached HEAD. Display only: no caller
 * makes a decision from it, so a repository without one is not an error.
 */
export async function currentBranch(repoRoot: string): Promise<string | null> {
  const result = await git(repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const branch = result.stdout.trim();
  return branch.length === 0 || branch === "HEAD" ? null : branch;
}

function resolveRepositoryPath(repoRoot: string, relativePath: string): string {
  if (relativePath.length === 0 || path.isAbsolute(relativePath)) {
    throw new BanzaiError(
      "INVALID_ARTIFACT_PATH",
      `Artifact path must be repository-relative: ${relativePath}`
    );
  }
  const normalizedRoot = path.resolve(repoRoot);
  const candidate = path.resolve(normalizedRoot, relativePath);
  if (!candidate.startsWith(`${normalizedRoot}${path.sep}`)) {
    throw new BanzaiError(
      "INVALID_ARTIFACT_PATH",
      `Artifact path escapes the repository: ${relativePath}`
    );
  }
  return candidate;
}

async function hashFile(
  repoRoot: string,
  relativePath: string
): Promise<string> {
  const absolutePath = resolveRepositoryPath(repoRoot, relativePath);
  const metadata = await lstat(absolutePath).catch(() => null);
  if (metadata === null || (!metadata.isFile() && !metadata.isSymbolicLink())) {
    throw new BanzaiError(
      "ARTIFACT_NOT_FOUND",
      `Required artifact does not exist as a file: ${relativePath}`
    );
  }
  const contents = await readFile(absolutePath);
  if (metadata.isSymbolicLink()) {
    return createHash("sha256")
      .update("symlink")
      .update("\0")
      .update(contents)
      .digest("hex");
  }
  return hashArtifactBytes(contents);
}

/** The exact per-file hash `digestArtifactBundle` records for a regular file. */
export function hashArtifactBytes(contents: Buffer | string): string {
  return createHash("sha256")
    .update("file")
    .update("\0")
    .update(contents)
    .digest("hex");
}

/**
 * The exact bundle digest `digestArtifactBundle` computes, exposed so a stored
 * approval snapshot can be verified against a recorded approval without the
 * files existing on disk.
 */
export function digestArtifactEntries(
  entries: { path: string; sha256: string }[]
): string {
  return createHash("sha256")
    .update(JSON.stringify({ version: 1, entries }))
    .digest("hex");
}

export interface DigestBundle {
  digest: string;
  paths: string[];
  entries: { path: string; sha256: string }[];
}

export async function digestArtifactBundle(
  repoRoot: string,
  artifactPaths: string[]
): Promise<DigestBundle> {
  const paths = [...new Set(artifactPaths)].sort();
  if (paths.length === 0) {
    throw new BanzaiError(
      "EMPTY_APPROVAL_BUNDLE",
      "The approval bundle must contain at least one artifact."
    );
  }
  const entries = [];
  for (const artifactPath of paths) {
    entries.push({
      path: artifactPath,
      sha256: await hashFile(repoRoot, artifactPath)
    });
  }
  return { digest: digestArtifactEntries(entries), paths, entries };
}

export async function changedRepositoryPaths(
  repoRoot: string
): Promise<string[]> {
  const [worktree, index, untracked] = await Promise.all([
    git(repoRoot, ["diff", "--name-only", "--no-renames", "-z"]),
    git(repoRoot, ["diff", "--cached", "--name-only", "--no-renames", "-z"]),
    git(repoRoot, ["ls-files", "--others", "--exclude-standard", "-z"])
  ]);
  return [
    ...new Set(
      [worktree, index, untracked].flatMap((result) =>
        result.stdout.split("\0").filter(Boolean)
      )
    )
  ].sort();
}

export interface WorkspaceEntry {
  path: string;
  kind: string;
  sha256: string | null;
}

export interface WorkspaceSnapshot {
  schemaVersion: 2;
  artifactBindingDigest?: string;
  baseCommit: string;
  digest: string;
  entries: WorkspaceEntry[];
}

export interface WorkspaceChange {
  path: string;
  change: "added" | "modified" | "deleted";
  before: WorkspaceEntry | null;
  after: WorkspaceEntry | null;
}

export interface WorkspaceChangeCounts {
  added: number;
  modified: number;
  deleted: number;
  total: number;
}

export async function workspaceChangeCounts(
  repoRoot: string,
  snapshot: WorkspaceSnapshot
): Promise<WorkspaceChangeCounts> {
  const trackedResult = await git(repoRoot, [
    "ls-tree",
    "-r",
    "--name-only",
    "-z",
    snapshot.baseCommit
  ]);
  const tracked = new Set(
    trackedResult.stdout.split("\0").filter((entry) => entry.length > 0)
  );
  let added = 0;
  let modified = 0;
  let deleted = 0;
  for (const entry of snapshot.entries) {
    if (entry.kind === "deleted") {
      deleted += 1;
    } else if (tracked.has(entry.path)) {
      modified += 1;
    } else {
      added += 1;
    }
  }
  return { added, modified, deleted, total: snapshot.entries.length };
}

export function workspaceChanges(
  previous: WorkspaceSnapshot,
  current: WorkspaceSnapshot
): WorkspaceChange[] {
  const before = new Map(previous.entries.map((entry) => [entry.path, entry]));
  const after = new Map(current.entries.map((entry) => [entry.path, entry]));
  const paths = [...new Set([...before.keys(), ...after.keys()])].sort();
  const changes: WorkspaceChange[] = [];
  for (const relativePath of paths) {
    const previousEntry = before.get(relativePath) ?? null;
    const currentEntry = after.get(relativePath) ?? null;
    if (
      previousEntry?.kind === currentEntry?.kind &&
      previousEntry?.sha256 === currentEntry?.sha256
    ) {
      continue;
    }
    changes.push({
      path: relativePath,
      change:
        previousEntry === null
          ? "added"
          : currentEntry === null
            ? "deleted"
            : "modified",
      before: previousEntry,
      after: currentEntry
    });
  }
  return changes;
}

async function describePath(
  repoRoot: string,
  relativePath: string
): Promise<WorkspaceEntry> {
  const absolutePath = resolveRepositoryPath(repoRoot, relativePath);
  const metadata = await lstat(absolutePath).catch(() => null);
  if (metadata === null) {
    return { path: relativePath, kind: "deleted", sha256: null };
  }
  if (!metadata.isFile() && !metadata.isSymbolicLink()) {
    return { path: relativePath, kind: "other", sha256: null };
  }
  return {
    path: relativePath,
    kind: metadata.isSymbolicLink() ? "symlink" : "file",
    sha256: await hashFile(repoRoot, relativePath)
  };
}

/**
 * The uncommitted changes already present before a run starts. Recording them
 * lets a run begin on a working tree that carries unrelated edits: any entry
 * still byte-identical at review time is the developer's, not the run's, and is
 * left out of the reviewed set.
 */
export async function repositoryBaseline(
  repoRoot: string
): Promise<WorkspaceEntry[]> {
  const entries: WorkspaceEntry[] = [];
  for (const relativePath of await changedRepositoryPaths(repoRoot)) {
    entries.push(await describePath(repoRoot, relativePath));
  }
  return entries;
}

export interface SnapshotOptions {
  artifactBinding?: ArtifactBoundWork | undefined;
  excludedPaths?: string[] | undefined;
  baseline?: readonly WorkspaceEntry[] | undefined;
}

export async function workspaceSnapshot(
  repoRoot: string,
  options: SnapshotOptions = {}
): Promise<WorkspaceSnapshot> {
  const baseCommit = await currentCommit(repoRoot);
  const excluded = new Set(options.excludedPaths ?? []);
  // A carried-in change counts as the developer's only while it is untouched.
  // Once the run edits it, its hash differs and it re-enters the reviewed set.
  const carriedIn = new Map(
    (options.baseline ?? []).map((entry) => [entry.path, entry.sha256])
  );
  const privateEntries =
    options.artifactBinding === undefined
      ? []
      : await privateArtifactInventory(repoRoot, options.artifactBinding);
  const privateByPath = new Map(
    privateEntries.map((entry) => [entry.path, entry])
  );
  const paths = [
    ...new Set([
      ...(await changedRepositoryPaths(repoRoot)),
      ...privateByPath.keys()
    ])
  ]
    .sort()
    .filter((relativePath) => !excluded.has(relativePath));
  const entries: WorkspaceEntry[] = [];
  for (const relativePath of paths) {
    const entry =
      privateByPath.get(relativePath) ??
      (await describePath(repoRoot, relativePath));
    if (
      carriedIn.has(relativePath) &&
      carriedIn.get(relativePath) === entry.sha256
    ) {
      continue;
    }
    entries.push(entry);
  }
  const identity = {
    version: 2,
    baseCommit,
    artifactBindingDigest: options.artifactBinding?.sha256 ?? null,
    entries
  };
  const digest = createHash("sha256")
    .update(JSON.stringify(identity))
    .digest("hex");
  return {
    schemaVersion: 2,
    baseCommit,
    ...(options.artifactBinding
      ? { artifactBindingDigest: options.artifactBinding.sha256 }
      : {}),
    digest,
    entries
  };
}

export async function workspaceDigest(
  repoRoot: string,
  options: SnapshotOptions = {}
): Promise<string> {
  return (await workspaceSnapshot(repoRoot, options)).digest;
}
