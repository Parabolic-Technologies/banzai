// The disposable copy of a checkout, shared by `release-candidate-check.mjs`
// and `scoped-check.mjs` (ADR-0044 section 3, ADR-0071 section 3). The copy
// holds the checkout's tracked and untracked non-ignored files and a Git
// repository of its own whose index lists exactly those files. Nothing is
// ever staged or committed in the source checkout, and the copy's repository
// is never committed.
import { execFile } from "node:child_process";
import { constants } from "node:fs";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readlink,
  realpath,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * A copy that cannot be made faithfully. `reason` is `empty`, `invalid-path`,
 * `missing-file` or `invalid-file`; each caller words its own diagnostic.
 */
export class CheckoutCopyError extends Error {
  constructor(reason, detail) {
    super(`${reason}: ${detail}`);
    this.name = "CheckoutCopyError";
    this.reason = reason;
    this.detail = detail;
  }
}

async function git(root, args) {
  const { stdout } = await execFileAsync("git", ["-C", root, ...args], {
    encoding: "buffer",
    timeout: 120_000,
    maxBuffer: 128 * 1024 * 1024
  });
  return stdout;
}

/**
 * Read-only enumeration of the source checkout. `--others --exclude-standard`
 * keeps untracked work in the copy while leaving ignored evidence, credentials
 * and installed dependencies behind.
 */
async function checkoutFiles(root) {
  const stdout = await git(root, [
    "ls-files",
    "-z",
    "--cached",
    "--others",
    "--exclude-standard"
  ]);
  const names = stdout
    .toString("utf8")
    .split("\0")
    .filter((name) => name.length > 0);
  if (names.length === 0) {
    throw new CheckoutCopyError("empty", "the checkout enumerates no files");
  }
  for (const name of names) {
    if (path.isAbsolute(name) || name.split("/").includes("..")) {
      throw new CheckoutCopyError("invalid-path", name);
    }
  }
  return names;
}

async function copyFiles(root, copy, names) {
  for (const name of names) {
    const source = path.join(root, name);
    const target = path.join(copy, name);
    const info = await lstat(source).catch(() => null);
    // A race or a dangling index entry must not silently shrink the copy.
    if (info === null) throw new CheckoutCopyError("missing-file", name);
    await mkdir(path.dirname(target), { recursive: true });
    if (info.isSymbolicLink()) {
      await symlink(await readlink(source), target);
      continue;
    }
    if (!info.isFile()) throw new CheckoutCopyError("invalid-file", name);
    await copyFile(source, target, constants.COPYFILE_FICLONE);
    // Release validation requires the committed CLI to stay executable.
    await chmod(target, info.mode & 0o777);
  }
}

/** The copy's own history-free repository, its index matching its files. */
async function indexCopy(copy, names, pathspec) {
  await execFileAsync("git", ["init", "--initial-branch=main", copy], {
    timeout: 120_000
  });
  await writeFile(pathspec, names.join("\0"), "utf8");
  try {
    await git(copy, [
      "add",
      "--pathspec-from-file",
      pathspec,
      "--pathspec-file-nul"
    ]);
  } finally {
    await rm(pathspec, { force: true });
  }
}

/**
 * Copies the checkout at `root` into a new temporary directory named with
 * `prefix`, runs `prepare(copy)` before the copy is indexed, then returns
 * `use(copy)`. The copy and its pathspec file are removed after success and
 * failure alike.
 */
export async function withCheckoutCopy(root, { prefix, prepare }, use) {
  const names = await checkoutFiles(root);
  const copy = await realpath(
    await mkdtemp(path.join(await realpath(tmpdir()), prefix))
  );
  // The pathspec file stays outside the copy so its working tree and index
  // agree at every point a check can observe them.
  const pathspec = `${copy}.pathspec`;
  try {
    await copyFiles(root, copy, names);
    if (prepare !== undefined) {
      await prepare(copy);
    }
    await indexCopy(copy, names, pathspec);
    return await use(copy);
  } finally {
    await rm(pathspec, { force: true });
    await rm(copy, { recursive: true, force: true });
  }
}
