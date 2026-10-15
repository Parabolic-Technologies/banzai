import { constants } from "node:fs";
import { lstat, realpath, open, mkdir, link, unlink } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash, randomUUID } from "node:crypto";

const execute = promisify(execFile);
export const METADATA_LIMIT = 64 * 1024;

export class ProjectFileError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ProjectFileError";
    this.code = code;
  }
}

export function fail(code, message) {
  throw new ProjectFileError(code, message);
}

export function digestBytes(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function exactObject(value, required, optional = []) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    required.some((key) => !Object.hasOwn(value, key)) ||
    Object.keys(value).some(
      (key) => !required.includes(key) && !optional.includes(key),
    )
  ) {
    fail(
      "ARTIFACT_INPUT_INVALID",
      "Artifact metadata has an invalid object shape.",
    );
  }
  return value;
}

export function relativePath(value) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 500 ||
    /[\\\x00-\x1f\x7f]/u.test(value) ||
    path.posix.isAbsolute(value) ||
    value
      .split("/")
      .some(
        (segment) =>
          segment === "" ||
          segment === "." ||
          segment === ".." ||
          segment === ".git",
      )
  ) {
    fail(
      "ARTIFACT_UNSAFE_PATH",
      "A bounded, contained project-relative artifact path is required.",
    );
  }
  return value;
}

export async function safePath(
  root,
  relative,
  { missing = false, directory = false } = {},
) {
  relativePath(relative);
  let current = root;
  const parts = relative.split("/");
  for (const [index, part] of parts.entries()) {
    current = path.join(current, part);
    let stat;
    try {
      stat = await lstat(current);
    } catch (error) {
      if (error.code === "ENOENT" && missing) return path.join(root, relative);
      if (error.code === "ENOENT")
        fail(
          "ARTIFACT_EVIDENCE_INCOMPLETE",
          "Required artifact evidence is missing.",
        );
      fail(
        "ARTIFACT_IO_ERROR",
        "Artifact storage could not be inspected. Check local permissions.",
      );
    }
    const needsDirectory = index < parts.length - 1 || directory;
    if (
      stat.isSymbolicLink() ||
      (needsDirectory ? !stat.isDirectory() : !stat.isFile())
    ) {
      fail(
        "ARTIFACT_UNSAFE_PATH",
        "Artifact storage requires owned directories and regular files without symlinks.",
      );
    }
  }
  return current;
}

export async function readBytes(
  root,
  relative,
  { optional = false, limit = Infinity } = {},
) {
  const target = await safePath(root, relative, { missing: optional });
  let handle;
  try {
    handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await handle.stat();
    if (!stat.isFile())
      fail("ARTIFACT_UNSAFE_PATH", "Artifact input must be a regular file.");
    if (stat.size > limit)
      fail(
        "ARTIFACT_INPUT_INVALID",
        "Artifact metadata exceeds its size bound.",
      );
    const bytes = await handle.readFile();
    if (bytes.length > limit)
      fail(
        "ARTIFACT_INPUT_INVALID",
        "Artifact metadata exceeds its size bound.",
      );
    await safePath(root, relative);
    return bytes;
  } catch (error) {
    if (error instanceof ProjectFileError) throw error;
    if (error.code === "ENOENT" && optional) return null;
    fail(
      "ARTIFACT_IO_ERROR",
      "Artifact input could not be read. Check its path and local permissions.",
    );
  } finally {
    await handle?.close();
  }
}

export async function readJson(root, relative, optional = false) {
  const bytes = await readBytes(root, relative, {
    optional,
    limit: METADATA_LIMIT,
  });
  if (bytes === null) return null;
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    fail("ARTIFACT_INPUT_INVALID", "Artifact metadata is not valid JSON.");
  }
}

export async function readInvocationBytes(input, label, options = {}) {
  if (typeof input !== "string" || !path.isAbsolute(input))
    fail("ARTIFACT_INPUT_INVALID", `${label} must name an absolute local regular file.`);
  try {
    // Caller-owned inputs may live under OS aliases such as /tmp or /var.
    // Resolve only the parent: the leaf still passes lstat and O_NOFOLLOW.
    const parent = await realpath(path.dirname(input));
    return await readBytes(parent, path.basename(input), options);
  } catch (error) {
    fail(
      error instanceof ProjectFileError ? error.code : "ARTIFACT_IO_ERROR",
      `${label} (${input}): ${error instanceof ProjectFileError ? error.message : "Input parent could not be resolved. Check its path and local permissions."}`,
    );
  }
}

export async function makeDirectories(root, relative) {
  relativePath(relative);
  let current = "";
  for (const part of relative.split("/")) {
    current = current ? `${current}/${part}` : part;
    await safePath(root, current, { missing: true, directory: true });
    try {
      await mkdir(path.join(root, current), { mode: 0o700 });
    } catch (error) {
      if (error.code !== "EEXIST")
        fail(
          "ARTIFACT_IO_ERROR",
          "Private artifact directory could not be created.",
        );
    }
    await safePath(root, current, { directory: true });
  }
}

export async function publishNew(root, relative, bytes) {
  await safePath(root, relative, { missing: true });
  const parent = path.posix.dirname(relative);
  const temporary = `${parent}/.artifact-tmp-${randomUUID()}`;
  await verifyExecutionIgnore(root, relative);
  await verifyExecutionIgnore(root, temporary);
  const handle = await open(path.join(root, temporary), "wx", 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
    await safePath(root, relative, { missing: true });
    await verifyExecutionIgnore(root, relative);
    await link(path.join(root, temporary), path.join(root, relative));
  } finally {
    await handle.close();
    await unlink(path.join(root, temporary)).catch(() => {});
  }
}

export async function ignored(root, relative, includeTracked = true) {
  try { await git(root, ["check-ignore", ...(includeTracked ? ["--no-index"] : []), "-q", "--", relative]); return true; }
  catch (error) {
    if (error.code === 1) return false;
    fail("ARTIFACT_IO_ERROR", "Git ignore inspection failed.");
  }
}

export async function verifyExecutionIgnore(root, relative) {
  relativePath(relative);
  if (!(await ignored(root, relative, false)))
    fail("ARTIFACT_IGNORE_CONFLICT", `Private execution evidence ${relative} must be effectively Git-ignored before writing or reuse. Narrow the conflicting ignore exception; do not force-add or broadly unignore private evidence.`);
}

export async function git(root, args) {
  return execute("git", ["-C", root, ...args], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
}

export async function projectRoot(input) {
  if (
    typeof input !== "string" ||
    !path.isAbsolute(input) ||
    /[\x00-\x1f]/u.test(input)
  ) {
    fail(
      "ARTIFACT_INPUT_INVALID",
      "repoRoot must be an absolute local directory.",
    );
  }
  let resolved;
  try {
    resolved = await realpath(input);
  } catch {
    fail("ARTIFACT_UNSAFE_PATH", "The project directory is unavailable.");
  }
  if (!(await lstat(resolved)).isDirectory())
    fail("ARTIFACT_UNSAFE_PATH", "The project root must be a directory.");
  try {
    const result = await git(resolved, ["rev-parse", "--show-toplevel"]);
    return await realpath(result.stdout.trim());
  } catch (error) {
    if (!error.stderr?.startsWith("fatal: not a git repository (or any"))
      fail(
        "ARTIFACT_IO_ERROR",
        "Git project discovery failed. Inspect repository ownership or Git metadata.",
      );
    let candidate = resolved;
    while (true) {
      if (
        (await readBytes(candidate, "PROJECT_MANIFEST.md", {
          optional: true,
          limit: 256 * 1024,
        })) !== null
      )
        return candidate;
      const parent = path.dirname(candidate);
      if (candidate === parent) break;
      candidate = parent;
    }
    fail(
      "ARTIFACT_INPUT_INVALID",
      "No Git project or project manifest root was found.",
    );
  }
}

