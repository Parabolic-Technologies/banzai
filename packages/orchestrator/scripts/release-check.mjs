import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { lstat, readFile, readdir, readlink, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { promisify } from "node:util";
import { spawn } from "node:child_process";

const execFileAsync = promisify(execFile);
const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const defaultRepositoryRoot = path.resolve(packageRoot, "../..");

class ReleaseCheckError extends Error {
  constructor(code, detail) {
    super(`${code}: ${detail}`);
    this.name = "ReleaseCheckError";
  }
}

function fail(code, detail) {
  throw new ReleaseCheckError(code, detail);
}

function defaultComponents() {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  return [
    { name: "verify", command: npm, args: ["run", "verify"] },
    { name: "format", command: npm, args: ["run", "format:check"] },
    {
      name: "release-validation",
      command: npm,
      args: ["run", "release:validate"]
    },
    { name: "publication", command: npm, args: ["run", "publication:check"] },
    { name: "committed-smoke", command: npm, args: ["run", "smoke:committed"] }
  ];
}

async function parseArguments(args) {
  let root = defaultRepositoryRoot;
  let fixtureComponents = null;
  for (let index = 0; index < args.length; index += 2) {
    const option = args[index];
    const value = args[index + 1];
    if (value === undefined) {
      fail("INVALID_RELEASE_CHECK_OPTION", "option requires a value");
    }
    if (option === "--root") {
      root = path.resolve(value);
    } else if (option === "--fixture-components") {
      fixtureComponents = path.resolve(value);
    } else {
      fail("INVALID_RELEASE_CHECK_OPTION", "unknown option");
    }
  }
  if (fixtureComponents === null) {
    return { root, components: defaultComponents() };
  }
  let parsed;
  try {
    parsed = JSON.parse(await readFile(fixtureComponents, "utf8"));
  } catch {
    fail("INVALID_RELEASE_CHECK_FIXTURE", "fixture components are unreadable");
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    fail(
      "INVALID_RELEASE_CHECK_FIXTURE",
      "fixture components must be non-empty"
    );
  }
  const components = parsed.map((value) => {
    if (
      typeof value !== "object" ||
      value === null ||
      Array.isArray(value) ||
      typeof value.name !== "string" ||
      typeof value.command !== "string" ||
      !Array.isArray(value.args) ||
      !value.args.every((item) => typeof item === "string")
    ) {
      fail(
        "INVALID_RELEASE_CHECK_FIXTURE",
        "fixture component shape is invalid"
      );
    }
    return { name: value.name, command: value.command, args: value.args };
  });
  return { root, components };
}

function sanitizedEnvironment() {
  const blocked = new Set([
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "AWS_BEARER_TOKEN_BEDROCK",
    "CLAUDE_CODE_USE_BEDROCK",
    "CLAUDE_CODE_USE_FOUNDRY",
    "CLAUDE_CODE_USE_VERTEX",
    "CODEX_API_KEY",
    "OPENAI_API_KEY"
  ]);
  const environment = {};
  for (const [key, value] of Object.entries(process.env)) {
    const upper = key.toUpperCase();
    if (
      blocked.has(upper) ||
      upper.startsWith("BANZAI_LIVE_") ||
      /(?:OPENAI|ANTHROPIC|CODEX).*(?:API_?KEY|AUTH_?TOKEN)/.test(upper)
    ) {
      continue;
    }
    environment[key] = value;
  }
  return environment;
}

async function trackedSnapshot(root) {
  let stdout;
  try {
    ({ stdout } = await execFileAsync("git", ["ls-files", "-z"], {
      cwd: root,
      encoding: "buffer",
      maxBuffer: 16 * 1024 * 1024,
      timeout: 30_000
    }));
  } catch (error) {
    // Git's first stderr line names the actual cause (for example dubious
    // ownership in a container job); the bare code was undiagnosable in CI.
    const stderr = String(error?.stderr ?? "");
    const cause = (
      stderr.trim().length > 0 ? stderr : String(error?.message ?? "")
    )
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0);
    fail(
      "RELEASE_CHECK_GIT_FAILED",
      cause === undefined
        ? "tracked-file inventory failed"
        : `tracked-file inventory failed: ${cause}`
    );
  }
  const paths = stdout
    .toString("utf8")
    .split("\0")
    .filter((value) => value.length > 0)
    .sort((left, right) => left.localeCompare(right));
  const entries = [];
  for (const relativePath of paths) {
    const absolutePath = path.resolve(root, relativePath);
    if (!absolutePath.startsWith(`${root}${path.sep}`)) {
      fail("RELEASE_CHECK_GIT_FAILED", "tracked path escaped repository");
    }
    let stats;
    try {
      stats = await lstat(absolutePath);
    } catch {
      entries.push([relativePath, "missing", 0, ""]);
      continue;
    }
    const mode = stats.mode & 0o777;
    if (stats.isSymbolicLink()) {
      entries.push([
        relativePath,
        "symlink",
        mode,
        await readlink(absolutePath)
      ]);
    } else if (stats.isFile()) {
      const digest = createHash("sha256")
        .update(await readFile(absolutePath))
        .digest("hex");
      entries.push([relativePath, "file", mode, digest]);
    } else {
      entries.push([relativePath, "other", mode, ""]);
    }
  }
  return JSON.stringify(entries);
}

async function cleanupTransient(root) {
  const workspaceRoot = path.join(root, "packages", "orchestrator");
  await rm(path.join(workspaceRoot, ".test-dist"), {
    recursive: true,
    force: true
  });
  const entries = await readdir(workspaceRoot).catch(() => null);
  if (entries === null) {
    return;
  }
  for (const entry of entries) {
    if (entry.startsWith(".dist-check-")) {
      await rm(path.join(workspaceRoot, entry), {
        recursive: true,
        force: true
      });
    }
  }
}

async function runComponent(component, root) {
  process.stdout.write(`release check: ${component.name}\n`);
  const exitCode = await new Promise((resolve, reject) => {
    const child = spawn(component.command, component.args, {
      cwd: root,
      env: sanitizedEnvironment(),
      shell: false,
      stdio: ["ignore", "inherit", "inherit"]
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal !== null) {
        reject(
          new ReleaseCheckError(
            "RELEASE_COMPONENT_SIGNAL",
            `${component.name} was interrupted`
          )
        );
        return;
      }
      resolve(code ?? 1);
    });
  }).catch(() => {
    fail("RELEASE_COMPONENT_FAILED", `${component.name} could not complete`);
  });
  if (exitCode !== 0) {
    fail("RELEASE_COMPONENT_FAILED", `${component.name} exited non-zero`);
  }
}

async function executeReleaseCheck(options) {
  await cleanupTransient(options.root);
  const before = await trackedSnapshot(options.root);
  let primaryError = null;
  try {
    for (const component of options.components) {
      await runComponent(component, options.root);
    }
  } catch (error) {
    primaryError = error;
  } finally {
    try {
      await cleanupTransient(options.root);
      const after = await trackedSnapshot(options.root);
      if (after !== before) {
        primaryError = new ReleaseCheckError(
          "RELEASE_TRACKED_MUTATION",
          "a release component changed tracked bytes or modes"
        );
      }
    } catch {
      primaryError = new ReleaseCheckError(
        "RELEASE_CLEANUP_FAILED",
        "transient cleanup or final snapshot failed"
      );
    }
  }
  if (primaryError !== null) {
    throw primaryError;
  }
}

try {
  await executeReleaseCheck(await parseArguments(process.argv.slice(2)));
  process.stdout.write("release check passed\n");
} catch (error) {
  const message =
    error instanceof ReleaseCheckError
      ? error.message
      : "RELEASE_CHECK_FAILED: unexpected release-check failure";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
