import { spawn } from "node:child_process";
import { lstat, mkdir, readdir, realpath, symlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CheckoutCopyError, withCheckoutCopy } from "./checkout-copy.mjs";

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

const COPY_FAILURES = {
  empty: "EMPTY_RELEASE_CANDIDATE",
  "invalid-path": "INVALID_RELEASE_CANDIDATE_PATH",
  "missing-file": "MISSING_RELEASE_CANDIDATE_FILE",
  "invalid-file": "INVALID_RELEASE_CANDIDATE_FILE"
};

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

/**
 * The candidate is the disposable checkout copy of `checkout-copy.mjs` with
 * the installed dependencies linked in, so its own history-free index matches
 * its working tree as ADR-0044 section 3 requires.
 */
async function executeReleaseCandidateCheck({ root, fixtureComponents }) {
  try {
    return await withCheckoutCopy(
      root,
      {
        prefix: "banzai-release-candidate-",
        prepare: (candidate) => provideDependencies(root, candidate)
      },
      (candidate) => runReleaseCheck(candidate, fixtureComponents)
    );
  } catch (error) {
    if (error instanceof CheckoutCopyError) {
      fail(COPY_FAILURES[error.reason], error.detail);
    }
    throw error;
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
