export {
  parseReviewSnapshot as readSharedReviewSnapshot,
  sealReviewSnapshot as sealSharedReviewSnapshot,
} from "./review-snapshot.mjs";
import { inspectProjectAdoption } from "./project-adoption.mjs";
export {
  inspectProjectAdoption,
  readAdoptionFile,
  ADOPTION_LABELS,
  SCAFFOLD_MARKER,
  GUIDANCE_MAX_BYTES,
  adoptionDiagnostic,
} from "./project-adoption.mjs";
import {
  inventoryArtifacts,
  exportArtifacts,
  verifyArchive,
  restoreArtifacts,
} from "./artifact-archive.mjs";
import pluginMetadata from "../.claude-plugin/plugin.json" with { type: "json" };
import { constants } from "node:fs";
import { AsyncLocalStorage } from "node:async_hooks";
import {
  lstat,
  realpath,
  open,
  readdir,
  mkdir,
  link,
  unlink,
  rename,
} from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash, randomUUID } from "node:crypto";

const execute = promisify(execFile);
export const DECLARATION_SCHEMA = "banzai-artifact-layout/v1";
export const BINDING_SCHEMA = "banzai-work-binding/v2";
export const REQUEST_SCHEMA = "banzai-artifact-request/v2";
export const RESULT_SCHEMA = "banzai-artifact-result/v1";
export const METADATA_LIMIT = 64 * 1024;
export const DISCOVERY_LIMIT = 1000;
export const DECLARATION_PATH = ".banzai/artifacts.json";
export const WORK_ROOT = ".banzai/work";
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const MODES = ["strict", "lite", "fix", "workflow"];
const LAYOUTS = ["private"];
const CLAIM = ".writer-claim.json";
const INIT_LOCK = ".banzai/.artifact-init.lock";
const runnerOwnership = new AsyncLocalStorage();

export class ArtifactStorageError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ArtifactStorageError";
    this.code = code;
  }
}

export function fail(code, message) {
  throw new ArtifactStorageError(code, message);
}

export function unsupportedResourceVersion(resource, found, supported) {
  const major = Number(pluginMetadata.version.split(".")[0]);
  fail(
    "RESOURCE_VERSION_UNSUPPORTED",
    `${resource} version ${found} is not supported; ${major}.x supports ${supported}; last read by release-train major ${major - 1}`,
  );
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
    if (error instanceof ArtifactStorageError) throw error;
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
      error instanceof ArtifactStorageError ? error.code : "ARTIFACT_IO_ERROR",
      `${label} (${input}): ${error instanceof ArtifactStorageError ? error.message : "Input parent could not be resolved. Check its path and local permissions."}`,
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
  const handle = await open(path.join(root, temporary), "wx", 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
    await safePath(root, relative, { missing: true });
    await link(path.join(root, temporary), path.join(root, relative));
  } finally {
    await handle.close();
    await unlink(path.join(root, temporary)).catch(() => {});
  }
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

export function parseDeclaration(value) {
  if (value !== null && typeof value === "object") {
    if (value.schema !== DECLARATION_SCHEMA || value.schemaVersion !== 1)
      unsupportedResourceVersion("artifact declaration", `${value.schema} (schemaVersion ${value.schemaVersion})`, DECLARATION_SCHEMA);
    if (value.layout !== "private")
      unsupportedResourceVersion("artifact layout", value.layout, "private");
  }
  exactObject(value, ["schema", "schemaVersion", "layout"]);
  return value;
}

export function artifactRoles(workId, _slug, mode, layout) {
  if (layout !== "private") unsupportedResourceVersion("artifact layout", layout, "private");
  const directory = `${WORK_ROOT}/${workId}`;
  const roles = { reviewDirectory: directory, verificationDirectory: `${directory}/verification` };
  if (mode === "strict" || mode === "workflow") Object.assign(roles, {
    description: `${directory}/description.md`, plan: `${directory}/plan.md`,
    implementationReport: `${directory}/implementation-report.md`, testReport: `${directory}/test-report.md`,
  });
  if (mode === "lite" || mode === "workflow") roles.work = `${directory}/work.md`;
  if (mode === "fix" || mode === "workflow") roles.changeReport = `${directory}/change-report.md`;
  return roles;
}

export function parseBinding(value) {
  if (value !== null && typeof value === "object" && (value.schema !== BINDING_SCHEMA || value.schemaVersion !== 2))
    unsupportedResourceVersion("work binding", `${value.schema} (schemaVersion ${value.schemaVersion})`, BINDING_SCHEMA);
  exactObject(value, [
    "schema",
    "schemaVersion",
    "workId",
    "slug",
    "mode",
    "layout",
    "createdAt",
    "sourceCommit",
    "artifacts",
  ]);

  if (
    !UUID.test(value.workId) ||
    typeof value.slug !== "string" ||
    value.slug.length > 100 ||
    !SLUG.test(value.slug) ||
    !MODES.includes(value.mode) ||
    !LAYOUTS.includes(value.layout) ||
    typeof value.createdAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(
      value.createdAt,
    ) ||
    !Number.isFinite(Date.parse(value.createdAt)) ||
    !(
      value.sourceCommit === null ||
      (typeof value.sourceCommit === "string" &&
        /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(value.sourceCommit))
    )
  ) {
    fail("ARTIFACT_INPUT_INVALID", "Artifact work identity is malformed.");
  }
  const expected = artifactRoles(
    value.workId,
    value.slug,
    value.mode,
    value.layout,
  );
  exactObject(value.artifacts, Object.keys(expected));
  for (const key of Object.keys(expected)) {
    relativePath(value.artifacts[key]);
    if (value.artifacts[key] !== expected[key])
      fail(
        "ARTIFACT_UNSAFE_PATH",
        "Artifact role is outside its work binding.",
      );
  }
  return value;
}

async function directories(root, relative, optional = true) {
  const target = await safePath(root, relative, {
    missing: optional,
    directory: true,
  });
  try {
    const entries = await readdir(target, { withFileTypes: true });
    if (entries.length > DISCOVERY_LIMIT)
      fail(
        "ARTIFACT_DISCOVERY_LIMIT",
        "Artifact discovery exceeded its bound. Select explicit work or recover the inventory.",
      );
    return entries.sort((a, b) => a.name.localeCompare(b.name));
  } catch (error) {
    if (error.code === "ENOENT" && optional) return [];
    if (error instanceof ArtifactStorageError) throw error;
    fail("ARTIFACT_IO_ERROR", "Artifact directories could not be inspected.");
  }
}

export async function readBinding(root, workPath) {
  relativePath(workPath);
  const match = /^\.banzai\/work\/([^/]+)(?:\/work\.json)?$/u.exec(workPath);
  if (match === null || !UUID.test(match[1]))
    fail(
      "ARTIFACT_UNSAFE_PATH",
      "Select a work ID or its project-relative work.json path.",
    );
  const relative = `${WORK_ROOT}/${match[1]}/work.json`;
  const bytes = await readBytes(root, relative, { limit: METADATA_LIMIT });
  let parsed;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch {
    fail("ARTIFACT_INPUT_INVALID", "Work binding is not valid JSON.");
  }
  const binding = parseBinding(parsed);
  if (binding.workId !== match[1])
    fail(
      "ARTIFACT_RECOVERY_REQUIRED",
      "Work directory and binding identities disagree.",
    );
  return { binding, sha256: digestBytes(bytes) };
}

export async function inspectArtifacts(input) {
  const root = await projectRoot(input.repoRoot);
  if (input.workId !== undefined && input.workPath !== undefined)
    fail("ARTIFACT_INPUT_INVALID", "Select either workId or workPath.");
  if (input.workId !== undefined && !UUID.test(input.workId))
    fail("ARTIFACT_INPUT_INVALID", "Invalid work ID.");
  const declarationValue = await readJson(root, DECLARATION_PATH, true);
  const declaration =
    declarationValue === null ? null : parseDeclaration(declarationValue);
  const selector =
    input.workPath ??
    (input.workId === undefined ? null : `${WORK_ROOT}/${input.workId}`);
  if (selector !== null && !selector.startsWith(`${WORK_ROOT}/`))
    fail("ARTIFACT_INPUT_INVALID", "Select an exact private work path or work ID.");
  if (selector !== null) {
    const selected = await readBinding(root, selector);
    if (declaration === null)
      fail(
        "ARTIFACT_RECOVERY_REQUIRED",
        "Selected work has no declaration. Recover its verified layout before continuation.",
      );
    return {
      projectRoot: root,
      classification: "declared",
      layout: selected.binding.layout,
      declaration,
      work: selected,
      candidates: [
        {
          workId: selected.binding.workId,
          slug: selected.binding.slug,
          mode: selected.binding.mode,
          workPath: `${WORK_ROOT}/${selected.binding.workId}/work.json`,
        },
      ],



    };
  }
  const entries = await directories(root, WORK_ROOT);
  const works = [];
  for (const entry of entries) {
    if (/^\.create-[0-9a-f-]{36}$/u.test(entry.name) && entry.isDirectory())
      continue;
    if (!entry.isDirectory() || !UUID.test(entry.name))
      fail(
        "ARTIFACT_RECOVERY_REQUIRED",
        "Private work inventory contains unrecognized evidence.",
      );
    works.push(await readBinding(root, `${WORK_ROOT}/${entry.name}`));
  }
  if (declaration === null && entries.length > 0)
    fail(
      "ARTIFACT_RECOVERY_REQUIRED",
      "Private work exists without its declaration. Recover the declaration from verified bindings.",
    );
  return {
    projectRoot: root,
    classification: declaration === null ? "fresh" : "declared",
    layout: "private",
    declaration,
    work: null,
    candidates: works.map((item) => ({
      workId: item.binding.workId,
      slug: item.binding.slug,
      mode: item.binding.mode,
      workPath: `${WORK_ROOT}/${item.binding.workId}/work.json`,
    })),



  };
}

async function ignored(root, relative) {
  try {
    await git(root, ["check-ignore", "--no-index", "--quiet", "--", relative]);
    return true;
  } catch (error) {
    if (error.code === 1) return false;
    fail(
      "ARTIFACT_IGNORE_CONFLICT",
      "Private evidence requires verifiable Git exclusions. Initialize Git explicitly first.",
    );
  }
}

export async function verifyIgnores(root, binding = null, destinations = []) {
  if (await ignored(root, DECLARATION_PATH))
    fail(
      "ARTIFACT_IGNORE_CONFLICT",
      "The artifact declaration is ignored. Narrow the rule hiding .banzai/artifacts.json explicitly.",
    );
  const selected = binding === null ? [] : [
    `${WORK_ROOT}/${binding.workId}/work.json`,
    `${WORK_ROOT}/${binding.workId}/${CLAIM}`,
    ...(binding.layout === "private" ? Object.entries(binding.artifacts).map(
      ([role, value]) => role === "reviewDirectory" ? `${value}/review-1.md` : value,
    ) : []),
  ];
  for (const relative of [
    `${WORK_ROOT}/00000000-0000-4000-8000-000000000000/probe.md`,
    ...selected, ...destinations,
  ]) {
    relativePath(relative);
    if (!(await ignored(root, relative)))
      fail("ARTIFACT_IGNORE_CONFLICT",
        "Selected private evidence is not effectively ignored. Repair its Git exclusions before writing.");
  }
}

async function withInitializationLock(root, action) {
  await makeDirectories(root, ".banzai");
  let handle;
  for (let attempt = 0; attempt < 100; attempt++) {
    await safePath(root, INIT_LOCK, { missing: true });
    try {
      handle = await open(path.join(root, INIT_LOCK), "wx", 0o600);
      break;
    } catch (error) {
      if (error.code !== "EEXIST")
        fail(
          "ARTIFACT_IO_ERROR",
          "Artifact initialization ownership could not be acquired.",
        );
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  if (handle === undefined)
    fail(
      "ARTIFACT_OWNERSHIP_CONFLICT",
      "Artifact initialization is already owned. Retry or inspect an abandoned initialization lock.",
    );
  const ownership = await handle.stat();
  try {
    return await action();
  } finally {
    await handle.close();
    const current = await lstat(path.join(root, INIT_LOCK));
    if (current.dev !== ownership.dev || current.ino !== ownership.ino)
      fail(
        "ARTIFACT_OWNERSHIP_CONFLICT",
        "Initialization lock ownership changed; evidence was retained.",
      );
    await unlink(path.join(root, INIT_LOCK));
  }
}

export async function initializeArtifacts(input) {
  const before = await inspectArtifacts({ repoRoot: input.repoRoot });
  if (input.layout !== undefined && !LAYOUTS.includes(input.layout))
    fail(
      "ARTIFACT_INPUT_INVALID",
      "Artifact layout must be private.",
    );
  const root = before.projectRoot;
  const adoption = await inspectProjectAdoption(root);
  if (adoption.classification !== "ready")
    fail(
      "ARTIFACT_SETUP_REQUIRED",
      "Complete normal project guidance setup before initializing artifact storage.",
    );
  await git(root, ["rev-parse", "--show-toplevel"]).catch(() =>
    fail(
      "ARTIFACT_IGNORE_CONFLICT",
      "Initialize Git explicitly before creating private evidence.",
    ),
  );
  if (await ignored(root, DECLARATION_PATH))
    fail(
      "ARTIFACT_IGNORE_CONFLICT",
      "Narrow the existing ignore rule hiding the artifact declaration before setup.",
    );
  return withInitializationLock(root, async () => {
    const current = await inspectArtifacts({ repoRoot: root });
    const original = await readBytes(root, ".gitignore", {
      optional: true,
      limit: METADATA_LIMIT,
    });
    if (!(await ignored(root, `${WORK_ROOT}/probe.md`))) {
      const suffix =
        "\n# Banzai private artifact storage\n/.banzai/work/\n/.banzai/.artifact-init.lock\n";
      const contents = Buffer.from((original?.toString("utf8") ?? "") + suffix);
      if (original === null) await publishNew(root, ".gitignore", contents);
      else {
        const handle = await open(
          path.join(root, ".gitignore"),
          constants.O_WRONLY | constants.O_APPEND | constants.O_NOFOLLOW,
        );
        try {
          const latest = await readBytes(root, ".gitignore", {
            limit: METADATA_LIMIT,
          });
          if (!latest.equals(original))
            fail(
              "ARTIFACT_OWNERSHIP_CONFLICT",
              "Ignore rules changed during initialization; retry after inspection.",
            );
          await handle.writeFile(suffix);
          await handle.sync();
        } finally {
          await handle.close();
        }
      }
    }
    await verifyIgnores(root);
    if (current.declaration === null) {
      const declaration = {
        schema: DECLARATION_SCHEMA,
        schemaVersion: 1,
        layout: input.layout ?? current.layout,
      };
      await publishNew(
        root,
        DECLARATION_PATH,
        JSON.stringify(declaration, null, 2) + "\n",
      );
    }
    return inspectArtifacts({ repoRoot: root });
  });
}

export async function createWork(input) {
  if (input.schemaVersion !== undefined && input.schemaVersion !== 2)
    unsupportedResourceVersion("work binding", input.schemaVersion, 2);
  if (
    !UUID.test(input.creationId) ||
    typeof input.slug !== "string" ||
    input.slug.length > 100 ||
    !SLUG.test(input.slug) ||
    !MODES.includes(input.mode)
  )
    fail(
      "ARTIFACT_INPUT_INVALID",
      "Create requires a UUID creationId, bounded slug and supported mode.",
    );
  const state = await initializeArtifacts({ repoRoot: input.repoRoot });
  const root = state.projectRoot;
  const directory = `${WORK_ROOT}/${input.creationId}`;
  return withInitializationLock(root, async () => {
    await inspectArtifacts({ repoRoot: root });
    const existing = await readJson(root, `${directory}/work.json`, true);
    if (existing !== null) {
      const bound = parseBinding(existing);
      if (
        bound.workId !== input.creationId ||
        bound.slug !== input.slug ||
        bound.mode !== input.mode ||
        bound.schemaVersion !== 2
      )
        fail(
          "ARTIFACT_OWNERSHIP_CONFLICT",
          "creationId already identifies different work.",
        );
      await verifyIgnores(root, bound);
      return readBinding(root, directory);
    }
    await verifyIgnores(root);
    const layout = "private";
    const roles = artifactRoles(input.creationId, input.slug, input.mode, layout);
    const staging = `${WORK_ROOT}/.create-${input.creationId}`;
    await verifyIgnores(root, { workId: input.creationId, layout, artifacts: roles }, [`${staging}/work.json`]);
    await makeDirectories(root, staging);
    let sourceCommit = null;
    try {
      sourceCommit = (
        await git(root, ["rev-parse", "--verify", "HEAD"])
      ).stdout.trim();
    } catch {
      /* Standalone work may precede the first commit. */
    }
    const staged = await readJson(root, `${staging}/work.json`, true);
    const binding =
      staged === null
        ? parseBinding({
            schema: BINDING_SCHEMA,
            schemaVersion: 2,
            workId: input.creationId,
            slug: input.slug,
            mode: input.mode,
            layout,
            createdAt: new Date().toISOString(),
            sourceCommit,
            artifacts: roles,
          })
        : parseBinding(staged);
    if (
      binding.workId !== input.creationId ||
      binding.slug !== input.slug ||
      binding.mode !== input.mode
    )
      fail(
        "ARTIFACT_RECOVERY_REQUIRED",
        "Interrupted work creation has conflicting identity evidence.",
      );
    if (staged === null)
      await publishNew(
        root,
        `${staging}/work.json`,
        JSON.stringify(binding, null, 2) + "\n",
      );
    await safePath(root, directory, { missing: true, directory: true });
    try {
      await lstat(path.join(root, directory));
      fail(
        "ARTIFACT_RECOVERY_REQUIRED",
        "The work destination already exists without a valid binding.",
      );
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await verifyIgnores(root, binding, [`${staging}/work.json`]);
    await rename(path.join(root, staging), path.join(root, directory));
    return readBinding(root, directory);
  });
}

export function ownsArtifact(binding, relative) {
  relativePath(relative);
  return (
    Object.entries(binding.artifacts).some(
      ([role, value]) => role !== "reviewDirectory" && role !== "verificationDirectory" && value === relative,
    ) ||
    (relative.startsWith(`${binding.artifacts.reviewDirectory}/`) &&
      /^review-[1-9][0-9]*\.md$/u.test(
        relative.slice(binding.artifacts.reviewDirectory.length + 1),
      ))
  );
}

export async function inspectBoundWork(root, bound) {
  exactObject(bound, ["binding", "sha256"]);
  const binding = parseBinding(bound.binding);
  if (!SHA256.test(bound.sha256))
    fail("ARTIFACT_INPUT_INVALID", "Invalid persisted work binding digest.");
  const current = await inspectArtifacts({
    repoRoot: root,
    workId: binding.workId,
  });
  if (
    current.work.sha256 !== bound.sha256 ||
    canonicalJson(current.work.binding) !== canonicalJson(binding)
  )
    fail(
      "ARTIFACT_RECOVERY_REQUIRED",
      "The persisted work binding no longer matches its original bytes.",
    );
  await verifyIgnores(current.projectRoot, binding);
  return current.work;
}

export async function privateArtifactInventory(root, bound) {
  await inspectBoundWork(root, bound);
  const directory = `${WORK_ROOT}/${bound.binding.workId}`;
  const entries = [];
  const walk = async (relative) => {
    for (const item of await directories(root, relative, false)) {
      const filename = `${relative}/${item.name}`;
      if (filename === `${directory}/work.json`) continue;
      if (filename === `${directory}/${CLAIM}`) {
        if (await hasRunnerWorkOwnership(root, bound)) continue;
        fail(
          "ARTIFACT_OWNERSHIP_CONFLICT",
          "A standalone writer owns this work. Release its claim before runner continuation.",
        );
      }
      if (item.isDirectory()) {
        await walk(filename);
        continue;
      }
      const bytes = await readBytes(root, filename);
      entries.push({
        path: filename,
        kind: "file",
        sha256: digestBytes(Buffer.concat([Buffer.from("file\0"), bytes])),
      });
      if (entries.length > DISCOVERY_LIMIT)
        fail(
          "ARTIFACT_DISCOVERY_LIMIT",
          "Selected work inventory exceeds its bound.",
        );
    }
  };
  await walk(directory);
  return entries.sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  );
}

async function selectedWork(input) {
  const state = await inspectArtifacts({
    repoRoot: input.repoRoot,
    workPath: input.workPath,
  });
  if (state.work === null)
    fail(
      "ARTIFACT_WORK_AMBIGUOUS",
      "Select an explicit work identity before writing.",
    );
  await verifyIgnores(state.projectRoot, state.work.binding);
  return {
    root: state.projectRoot,
    ...state.work,
    directory: `${WORK_ROOT}/${state.work.binding.workId}`,
  };
}

export async function acquireWork(input) {
  if (
    typeof input.ownerId !== "string" ||
    input.ownerId.length === 0 ||
    input.ownerId.length > 100 ||
    /[\x00-\x1f]/u.test(input.ownerId)
  )
    fail("ARTIFACT_INPUT_INVALID", "A bounded local ownerId is required.");
  const work = await selectedWork(input);
  const token = randomUUID();
  try {
    await publishNew(
      work.root,
      `${work.directory}/${CLAIM}`,
      JSON.stringify({
        token,
        ownerId: input.ownerId,
        bindingDigest: work.sha256,
        createdAt: new Date().toISOString(),
      }) + "\n",
    );
  } catch (error) {
    if (error.code === "EEXIST")
      fail(
        "ARTIFACT_OWNERSHIP_CONFLICT",
        "This work already has a writer. Use another work item or resolve the existing owner.",
      );
    throw error;
  }
  return { token, workId: work.binding.workId };
}

export async function hasRunnerWorkOwnership(root, bound) {
  if (bound === undefined) return true;
  const owner = runnerOwnership.getStore();
  if (!owner || owner.root !== root || owner.workId !== bound.binding.workId || owner.bindingDigest !== bound.sha256) return false;
  const claim = await readJson(root, `${WORK_ROOT}/${owner.workId}/${CLAIM}`, true);
  if (claim?.token !== owner.token || claim?.bindingDigest !== bound.sha256)
    fail("ARTIFACT_OWNERSHIP_CONFLICT", "Runner work ownership changed; inspect the retained evidence.");
  return true;
}

export async function withRunnerWorkOwnership(root, bound, action) {
  if (bound === undefined || await hasRunnerWorkOwnership(root, bound)) return action();
  await inspectBoundWork(root, bound);
  const workPath = `${WORK_ROOT}/${bound.binding.workId}/work.json`;
  const claim = await acquireWork({ repoRoot: root, workPath, ownerId: "runner" });
  const owner = { root, workId: claim.workId, token: claim.token, bindingDigest: bound.sha256 };
  return runnerOwnership.run(owner, async () => {
    try { return await action(); }
    finally {
      // Cleanup authenticates the original token even if a phase damaged ignores
      // or metadata. It never reclaims another owner's claim or time-expired lock.
      const relative = `${WORK_ROOT}/${owner.workId}/${CLAIM}`;
      const current = await readJson(root, relative, true);
      if (current?.token !== owner.token || current?.bindingDigest !== owner.bindingDigest)
        fail("ARTIFACT_OWNERSHIP_CONFLICT", "Runner claim changed; evidence was retained for owner recovery.");
      await safePath(root, relative);
      await unlink(path.join(root, relative));
    }
  });
}

async function requireClaim(input) {
  const work = await selectedWork(input);
  const claim = await readJson(work.root, `${work.directory}/${CLAIM}`, true);
  if (
    claim === null ||
    claim.token !== input.token ||
    claim.bindingDigest !== work.sha256 ||
    !UUID.test(input.token)
  )
    fail(
      "ARTIFACT_OWNERSHIP_CONFLICT",
      "The caller does not own the current work binding.",
    );
  return work;
}

export async function writeArtifact(input) {
  await requireClaim(input);
  const root = await projectRoot(input.repoRoot);
  return withInitializationLock(root, () => writeClaimedArtifact(input));
}

async function writeClaimedArtifact(input) {
  const work = await requireClaim(input);
  if (!ownsArtifact(work.binding, input.artifactPath))
    fail(
      "ARTIFACT_UNSAFE_PATH",
      "Write is outside the selected work's artifact roles.",
    );
  if (!(
    input.expectedSha256 === null ||
    (typeof input.expectedSha256 === "string" &&
      SHA256.test(input.expectedSha256))
  ))
    fail(
      "ARTIFACT_INPUT_INVALID",
      "expectedSha256 must be a SHA-256 identity or null for creation.",
    );
  const bytes = await readInvocationBytes(input.inputFile, "inputFile");
  const existing = await readBytes(work.root, input.artifactPath, {
    optional: true,
  });
  if (
    (existing === null ? null : digestBytes(existing)) !== input.expectedSha256
  )
    fail(
      "ARTIFACT_OWNERSHIP_CONFLICT",
      "Artifact bytes changed. Inspect the current evidence before writing.",
    );
  await makeDirectories(work.root, path.posix.dirname(input.artifactPath));
  if (work.binding.layout === "private") await verifyIgnores(work.root, work.binding, [input.artifactPath]);
  if (existing === null) {
    try {
      await publishNew(work.root, input.artifactPath, bytes);
    } catch (error) {
      if (error.code === "EEXIST")
        fail(
          "ARTIFACT_OWNERSHIP_CONFLICT",
          "Artifact was created by another writer.",
        );
      throw error;
    }
  } else {
    const temporary = `${path.posix.dirname(input.artifactPath)}/.artifact-tmp-${randomUUID()}`;
    try {
      if (work.binding.layout === "private") await verifyIgnores(work.root, work.binding, [temporary, input.artifactPath]);
      await publishNew(work.root, temporary, bytes);
      await requireClaim(input);
      const latest = await readBytes(work.root, input.artifactPath);
      if (digestBytes(latest) !== input.expectedSha256)
        fail(
          "ARTIFACT_OWNERSHIP_CONFLICT",
          "Artifact bytes changed during writing.",
        );
      if (work.binding.layout === "private") await verifyIgnores(work.root, work.binding, [input.artifactPath]);
      await safePath(work.root, input.artifactPath);
      await rename(
        path.join(work.root, temporary),
        path.join(work.root, input.artifactPath),
      );
    } finally {
      await unlink(path.join(work.root, temporary)).catch(() => {});
    }
  }
  return { path: input.artifactPath, sha256: digestBytes(bytes) };
}

export async function releaseWork(input) {
  await requireClaim(input);
  const root = await projectRoot(input.repoRoot);
  return withInitializationLock(root, async () => {
    const work = await requireClaim(input);
    await unlink(path.join(work.root, work.directory, CLAIM));
    return { workId: work.binding.workId, released: true };
  });
}

const operationFields = {
  inventory: [[], ["workPaths", "runIds"]],
  export: [["inventoryFile", "destination"], []],
  verify: [["bundlePath"], []],
  restore: [["bundlePath", "destination"], []],
  inspect: [[], ["workId", "workPath"]],
  initialize: [[], ["layout"]],
  create: [["slug", "mode", "creationId"], []],
  acquire: [["workPath", "ownerId"], []],
  write: [
    ["workPath", "token", "artifactPath", "inputFile", "expectedSha256"],
    [],
  ],
  release: [["workPath", "token"], []],
};

export async function runArtifactOperation(operation, input) {
  const fields = operationFields[operation];
  if (fields === undefined)
    fail("ARTIFACT_INPUT_INVALID", "Unsupported artifact operation.");
  if (input?.schema !== REQUEST_SCHEMA || input?.schemaVersion !== 2)
    unsupportedResourceVersion("artifact request", `${input?.schema} (schemaVersion ${input?.schemaVersion})`, REQUEST_SCHEMA);
  exactObject(input, ["schema", "schemaVersion", "repoRoot", ...fields[0]], fields[1]);
  const operations = {
    inventory: inventoryArtifacts,
    export: exportArtifacts,
    verify: verifyArchive,
    restore: restoreArtifacts,
    inspect: inspectArtifacts,
    initialize: initializeArtifacts,
    create: createWork,
    acquire: acquireWork,
    write: writeArtifact,
    release: releaseWork,
  };
  return operations[operation](input);
}

export async function artifactCommand(args) {
  const operation = args[0] ?? "";
  try {
    if (
      args.length !== 3 ||
      args[1] !== "--json" ||
      !Object.hasOwn(operationFields, operation)
    )
      fail(
        "ARTIFACT_INPUT_INVALID",
        "Usage: artifacts <operation> --json <request-file>",
      );
    const filename = path.resolve(args[2]);
    const bytes = await readInvocationBytes(filename, "requestFile", { limit: METADATA_LIMIT });
    let input;
    try { input = JSON.parse(bytes.toString("utf8")); }
    catch { fail("ARTIFACT_INPUT_INVALID", `requestFile (${filename}) must contain valid JSON.`); }
    const result = await runArtifactOperation(operation, input);
    return {
      schema: RESULT_SCHEMA,
      schemaVersion: 1,
      operation,
      ok: true,
      result,
      error: null,
    };
  } catch (error) {
    return {
      schema: RESULT_SCHEMA,
      schemaVersion: 1,
      operation: Object.hasOwn(operationFields, operation)
        ? operation
        : "",
      ok: false,
      result: null,
      error:
        error instanceof ArtifactStorageError
          ? { code: error.code, message: error.message }
          : {
              code: "ARTIFACT_IO_ERROR",
              message:
                "The artifact operation failed. Inspect local storage and permissions; no fallback destination was selected.",
            },
    };
  }
}
