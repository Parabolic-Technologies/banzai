import { execFile, spawn } from "node:child_process";
import { constants } from "node:fs";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readlink,
  realpath,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const defaultRepositoryRoot = path.resolve(packageRoot, "../..");

class ReleaseCandidateError extends Error {
  constructor(code, detail) {
    super(`${code}: ${detail}`);
    this.name = "ReleaseCandidateError";
  }
}

function fail(code, detail) {
  throw new ReleaseCandidateError(code, detail);
}

function parseArguments(args) {
  let root = defaultRepositoryRoot;
  let fixtureComponents = null;
  for (let index = 0; index < args.length; index += 2) {
    const option = args[index];
    const value = args[index + 1];
    if (value === undefined) {
      fail("INVALID_RELEASE_CANDIDATE_OPTION", "option requires a value");
    }
    if (option === "--root") {
      root = path.resolve(value);
    } else if (option === "--fixture-components") {
      fixtureComponents = path.resolve(value);
    } else {
      fail("INVALID_RELEASE_CANDIDATE_OPTION", "unknown option");
    }
  }
  return { root, fixtureComponents };
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
 * Read-only enumeration of the real checkout. `--others --exclude-standard`
 * keeps untracked work in the candidate while leaving ignored evidence,
 * credentials and installed dependencies behind.
 */
async function candidateFiles(root) {
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
    fail("EMPTY_RELEASE_CANDIDATE", "the checkout enumerates no files");
  }
  for (const name of names) {
    if (path.isAbsolute(name) || name.split("/").includes("..")) {
      fail("INVALID_RELEASE_CANDIDATE_PATH", name);
    }
  }
  return names;
}

async function copyCandidate(root, candidate, names) {
  for (const name of names) {
    const source = path.join(root, name);
    const target = path.join(candidate, name);
    const info = await lstat(source).catch(() => null);
    // A race or a dangling index entry must not silently shrink the candidate.
    if (info === null) fail("MISSING_RELEASE_CANDIDATE_FILE", name);
    await mkdir(path.dirname(target), { recursive: true });
    if (info.isSymbolicLink()) {
      await symlink(await readlink(source), target);
      continue;
    }
    if (!info.isFile()) fail("INVALID_RELEASE_CANDIDATE_FILE", name);
    await copyFile(source, target, constants.COPYFILE_FICLONE);
    // Release validation requires the committed CLI to stay executable.
    await chmod(target, info.mode & 0o777);
  }
}

const contains = (directory, target) =>
  target === directory || target.startsWith(directory + path.sep);

/**
 * A dependency link is rebased by where it physically resolves, not by the text
 * of its target. Anything resolving into the checkout outside `node_modules` is
 * workspace source the candidate must own, so it is remapped to the candidate's
 * copy; the link text stays relative so the candidate remains relocatable.
 * Everything resolving inside the installation is third-party and is linked
 * read-only. Copying target text verbatim would leave an absolute workspace
 * link pointing at the real checkout.
 */
async function linkDependency({ root, installed, candidate }, source, target) {
  const resolved = await realpath(source).catch(() => null);
  if (resolved === null) {
    fail("UNRESOLVED_DEPENDENCY_LINK", path.relative(root, source));
  }
  if (!contains(root, resolved) || contains(installed, resolved)) {
    await symlink(resolved, target);
    return;
  }
  const mirrored = path.join(candidate, path.relative(root, resolved));
  if (!(await lstat(mirrored).catch(() => null))) {
    // The candidate carries only enumerated files, so an unmapped workspace
    // target would silently fall back to the real checkout.
    fail("UNSUPPORTED_WORKSPACE_LINK", path.relative(root, resolved));
  }
  await symlink(path.relative(path.dirname(target), mirrored), target);
}

async function linkDependencies(context, sourceDirectory, targetDirectory) {
  await mkdir(targetDirectory, { recursive: true });
  for (const entry of await readdir(sourceDirectory, { withFileTypes: true })) {
    const source = path.join(sourceDirectory, entry.name);
    const target = path.join(targetDirectory, entry.name);
    if (entry.isSymbolicLink()) {
      await linkDependency(context, source, target);
    } else if (
      entry.isDirectory() &&
      (entry.name === ".bin" || entry.name.startsWith("@"))
    ) {
      await linkDependencies(context, source, target);
    } else if (entry.isDirectory()) {
      await linkDependency(context, source, target);
    }
  }
}

async function provideDependencies(root, candidate) {
  const installed = path.join(root, "node_modules");
  if (!(await lstat(installed).catch(() => null))) return;
  await linkDependencies(
    {
      root: await realpath(root),
      installed: await realpath(installed),
      candidate
    },
    installed,
    path.join(candidate, "node_modules")
  );
}

/**
 * The candidate gets its own history-free repository whose index matches its
 * working tree, as ADR-0044 section 3 requires. Nothing is ever staged or
 * committed in the real checkout, and this repository is never committed.
 */
async function indexCandidate(candidate, names, pathspec) {
  await execFileAsync("git", ["init", "--initial-branch=main", candidate], {
    timeout: 120_000
  });
  await writeFile(pathspec, names.join("\0"), "utf8");
  try {
    await git(candidate, [
      "add",
      "--pathspec-from-file",
      pathspec,
      "--pathspec-file-nul"
    ]);
  } finally {
    await rm(pathspec, { force: true });
  }
}

async function runReleaseCheck(candidate, fixtureComponents) {
  const script = path.join(
    candidate,
    "packages/orchestrator/scripts/release-check.mjs"
  );
  const args = [script, "--root", candidate];
  if (fixtureComponents !== null) {
    args.push("--fixture-components", fixtureComponents);
  }
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: candidate,
      stdio: ["ignore", "inherit", "inherit"]
    });
    child.on("error", reject);
    child.on("close", (code, signal) =>
      resolve(signal === null ? (code ?? 1) : 1)
    );
  });
}

async function executeReleaseCandidateCheck({ root, fixtureComponents }) {
  const names = await candidateFiles(root);
  const candidate = await realpath(
    await mkdtemp(
      path.join(await realpath(tmpdir()), "banzai-release-candidate-")
    )
  );
  try {
    await copyCandidate(root, candidate, names);
    await provideDependencies(root, candidate);
    // The pathspec file stays outside the candidate so its working tree and
    // index agree at every point release validation can observe them.
    await indexCandidate(candidate, names, `${candidate}.pathspec`);
    return await runReleaseCheck(candidate, fixtureComponents);
  } finally {
    await rm(`${candidate}.pathspec`, { force: true });
    await rm(candidate, { recursive: true, force: true });
  }
}

try {
  process.exitCode = await executeReleaseCandidateCheck(
    parseArguments(process.argv.slice(2))
  );
  if (process.exitCode === 0) {
    process.stdout.write("release candidate check passed\n");
  }
} catch (error) {
  process.stderr.write(
    `${
      error instanceof ReleaseCandidateError
        ? error.message
        : "RELEASE_CANDIDATE_FAILED: unexpected release candidate failure"
    }\n`
  );
  process.exitCode = 1;
}
