import { createHash } from "node:crypto";
import { constants, type Stats } from "node:fs";
import { lstat, mkdir, open, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { BanzaiError } from "./errors.js";
import { runProcess } from "./process.js";
import {
  workDocumentInventory,
  type ArtifactBoundWork
} from "./work-documents.js";

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

function gitFailure(args: string[], stderr: string): BanzaiError {
  // Match only failed discovery, not corrupt gitdir pointers or access errors.
  if (stderr.startsWith("fatal: not a git repository (or any")) {
    return new BanzaiError(
      "GIT_REPOSITORY_REQUIRED",
      "Banzai requires a Git repository. Run `git init` in your project directory and create an initial commit, then start Banzai again."
    );
  }
  return new BanzaiError(
    "GIT_FAILED",
    `git ${args.join(" ")} failed: ${stderr.trim() || "unknown error"}`
  );
}

async function git(
  repoRoot: string,
  args: string[]
): Promise<{ stdout: string; stderr: string }> {
  const result = await runGit(repoRoot, args);
  if (result.exitCode !== 0) {
    throw gitFailure(args, result.stderr);
  }
  return result;
}

/**
 * A Git query that answers by exit status: 0 is yes and 1 is no. Any other
 * status, or a process ended by a signal, is a Git failure and never "no".
 */
async function gitPredicate(
  repoRoot: string,
  args: string[]
): Promise<boolean> {
  const result = await runGit(repoRoot, args);
  if (result.signal === null && result.exitCode === 0) {
    return true;
  }
  if (result.signal === null && result.exitCode === 1) {
    return false;
  }
  throw gitFailure(args, result.stderr);
}

/**
 * Whether the repository-relative `relativePath` is in the Git index
 * (`git ls-files --error-unmatch`). A staged file counts; a file removed with
 * `git rm --cached` does not.
 */
export async function isPathInIndex(
  repoRoot: string,
  relativePath: string
): Promise<boolean> {
  return await gitPredicate(repoRoot, [
    "ls-files",
    "--error-unmatch",
    "--",
    relativePath
  ]);
}

/**
 * Whether Git ignores the repository-relative `relativePath`
 * (`git check-ignore -q`), counting `.gitignore` files, the clone's exclude
 * file and the global excludes. Git never reports a path in the index as
 * ignored, so callers check the index first.
 */
export async function isPathIgnored(
  repoRoot: string,
  relativePath: string
): Promise<boolean> {
  return await gitPredicate(repoRoot, [
    "check-ignore",
    "-q",
    "--",
    relativePath
  ]);
}

/**
 * The clone's own exclude file (ADR-0060 §4): the path
 * `git rev-parse --git-path info/exclude` prints, resolved against the
 * repository root. It is relative in the main worktree and names the common
 * directory's file in a linked worktree, so every worktree of a clone shares
 * it. Git honours the file and never tracks it.
 */
export async function cloneExcludePath(repoRoot: string): Promise<string> {
  const args = ["rev-parse", "--git-path", "info/exclude"];
  const printed = (await git(repoRoot, args)).stdout.replace(/\r?\n$/u, "");
  if (printed.length === 0 || printed.includes("\n")) {
    throw new BanzaiError(
      "GIT_FAILED",
      `git ${args.join(" ")} printed no single path.`
    );
  }
  return path.resolve(repoRoot, printed);
}

export type CloneExcludeAppend = "present" | "appended";

const EXCLUDE_UNSAFE_MESSAGE =
  "This clone's Git exclude file (info/exclude in the Git directory) or its info/ directory is a symbolic link or not a regular file, so Banzai does not write to it.";

function excludeUnsafe(line: string): BanzaiError {
  return new BanzaiError(
    "GIT_EXCLUDE_UNSAFE",
    `${EXCLUDE_UNSAFE_MESSAGE} Repair it, or add the line ${line} to .gitignore and commit it.`
  );
}

async function lstatOrNull(target: string) {
  try {
    return await lstat(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/** Opens never follow a link at the final path component. */
const NO_FOLLOW = constants.O_NOFOLLOW;

/**
 * Refuses unless `info/` is still the real directory first checked (same
 * device and inode, not a link). `O_NOFOLLOW` guards only the file itself, so
 * this runs immediately before and after each open.
 */
async function requireSameExcludeDirectory(
  directory: string,
  expected: Stats,
  line: string
): Promise<void> {
  const current = await lstatOrNull(directory);
  if (
    current === null ||
    current.isSymbolicLink() ||
    !current.isDirectory() ||
    current.dev !== expected.dev ||
    current.ino !== expected.ino
  ) {
    throw excludeUnsafe(line);
  }
}

export interface CloneExcludeAppendOptions {
  /** Test seam: runs after `info/` is checked and before the file is opened. */
  beforeOpen?: () => Promise<void>;
}

/**
 * Appends `line` to this clone's exclude file unless the file already holds
 * exactly that line (ADR-0060 §4). It creates `info/` when it is missing,
 * refuses a symbolic link or a non-directory at `info/` and a symbolic link or
 * non-regular exclude file with `GIT_EXCLUDE_UNSAFE`, and opens the file
 * without following links. `info/` is checked again immediately before and
 * after the open, so a directory swapped for a link never receives the line.
 * A file without a final newline gets one first.
 */
export async function appendCloneExcludeLine(
  repoRoot: string,
  line: string,
  options: CloneExcludeAppendOptions = {}
): Promise<CloneExcludeAppend> {
  if (line.length === 0 || /[\r\n]/u.test(line)) {
    throw new BanzaiError(
      "INVALID_EXCLUDE_LINE",
      "An exclude entry must be one non-empty line."
    );
  }
  const file = await cloneExcludePath(repoRoot);
  const directory = path.dirname(file);
  if ((await lstatOrNull(directory)) === null) {
    try {
      await mkdir(directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  const directoryStat = await lstatOrNull(directory);
  if (
    directoryStat === null ||
    directoryStat.isSymbolicLink() ||
    !directoryStat.isDirectory()
  ) {
    throw excludeUnsafe(line);
  }
  await options.beforeOpen?.();
  await requireSameExcludeDirectory(directory, directoryStat, line);
  const existing = await lstatOrNull(file);
  if (existing === null) {
    const created = await open(
      file,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NO_FOLLOW,
      0o644
    );
    try {
      const opened = await created.stat();
      try {
        await requireSameExcludeDirectory(directory, directoryStat, line);
      } catch (error) {
        // Created through a swapped directory: remove only that new file.
        const current = await lstatOrNull(file).catch(() => null);
        if (current?.ino === opened.ino && current.dev === opened.dev)
          await unlink(file).catch(() => undefined);
        throw error;
      }
      await created.writeFile(`${line}\n`, "utf8");
    } finally {
      await created.close();
    }
    return "appended";
  }
  if (existing.isSymbolicLink() || !existing.isFile()) {
    throw excludeUnsafe(line);
  }
  let handle;
  try {
    handle = await open(
      file,
      constants.O_RDWR | constants.O_APPEND | NO_FOLLOW
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ELOOP") {
      throw excludeUnsafe(line);
    }
    throw error;
  }
  try {
    const opened = await handle.stat();
    if (
      !opened.isFile() ||
      opened.ino !== existing.ino ||
      opened.dev !== existing.dev
    ) {
      throw excludeUnsafe(line);
    }
    await requireSameExcludeDirectory(directory, directoryStat, line);
    const text = await handle.readFile("utf8");
    if (text.split(/\r?\n/u).includes(line)) return "present";
    const separator = text.length === 0 || text.endsWith("\n") ? "" : "\n";
    await handle.writeFile(`${separator}${line}\n`, "utf8");
    return "appended";
  } finally {
    await handle.close();
  }
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
  schemaVersion?: 2 | 3;
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
  const documentEntries =
    options.artifactBinding === undefined
      ? []
      : await workDocumentInventory(repoRoot, options.artifactBinding);
  const documentByPath = new Map(
    documentEntries.map((entry) => [entry.path, entry])
  );
  const paths = [
    ...new Set([
      ...(await changedRepositoryPaths(repoRoot)),
      ...documentByPath.keys()
    ])
  ]
    .sort()
    .filter((relativePath) => !excluded.has(relativePath));
  const entries: WorkspaceEntry[] = [];
  for (const relativePath of paths) {
    const entry =
      documentByPath.get(relativePath) ??
      (await describePath(repoRoot, relativePath));
    if (
      !documentByPath.has(relativePath) &&
      carriedIn.has(relativePath) &&
      carriedIn.get(relativePath) === entry.sha256
    ) {
      continue;
    }
    entries.push(entry);
  }
  if (options.artifactBinding !== undefined) {
    const identity = {
      version: options.artifactBinding.binding.schemaVersion === 3 ? 3 : 2,
      baseCommit,
      artifactBindingDigest: options.artifactBinding.sha256,
      entries
    };
    const digest = createHash("sha256")
      .update(JSON.stringify(identity))
      .digest("hex");
    return {
      schemaVersion: identity.version as 2 | 3,
      baseCommit,
      artifactBindingDigest: identity.artifactBindingDigest,
      digest,
      entries
    };
  }
  const digest = createHash("sha256")
    .update(JSON.stringify({ version: 1, baseCommit, entries }))
    .digest("hex");
  return { baseCommit, digest, entries };
}

export async function workspaceDigest(
  repoRoot: string,
  options: SnapshotOptions = {}
): Promise<string> {
  return (await workspaceSnapshot(repoRoot, options)).digest;
}
