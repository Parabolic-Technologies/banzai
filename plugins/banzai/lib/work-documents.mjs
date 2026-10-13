import path from "node:path";
import { mkdir, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import {
  canonicalJson, digestBytes, exactObject, fail, git, ignored, makeDirectories,
  projectRoot, readBytes, relativePath, safePath,
} from "./project-files.mjs";
import { parseHistoricalBinding } from "./work-binding-history.mjs";
export { ignored } from "./project-files.mjs";

export const WORK_DIRECTORY = "documentation/work";
export const BINDING_SCHEMA = "banzai-work-binding/v3";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const MODES = ["strict", "lite", "fix", "workflow"];

export function workDirectory(slug) {
  if (typeof slug !== "string" || slug.length > 100 || !SLUG.test(slug))
    fail("ARTIFACT_INPUT_INVALID", "A bounded lowercase kebab-case work slug is required.");
  return `${WORK_DIRECTORY}/${slug}`;
}

export function documentRoles(slug, mode) {
  if (!MODES.includes(mode)) fail("ARTIFACT_INPUT_INVALID", "Unsupported work mode.");
  const directory = workDirectory(slug);
  const roles = { reviewDirectory: directory };
  if (mode === "strict" || mode === "workflow") Object.assign(roles, {
    description: `${directory}/description.md`, plan: `${directory}/plan.md`,
    implementationReport: `${directory}/implementation-report.md`, testReport: `${directory}/test-report.md`,
  });
  if (mode === "lite" || mode === "workflow") roles.work = `${directory}/work.md`;
  if (mode === "fix" || mode === "workflow") roles.changeReport = `${directory}/change-report.md`;
  return roles;
}

export function parseBinding(value) {
  if (value?.schemaVersion === 1 || value?.schemaVersion === 2) return parseHistoricalBinding(value);
  exactObject(value, ["schema", "schemaVersion", "workId", "slug", "mode", "createdAt", "sourceCommit", "artifacts"]);
  if (value.schema !== BINDING_SCHEMA || value.schemaVersion !== 3)
    fail("ARTIFACT_VERSION_UNSUPPORTED", "Unsupported work binding. Historical bindings are read-only.");
  if (!UUID.test(value.workId) || typeof value.createdAt !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value.createdAt) ||
      !Number.isFinite(Date.parse(value.createdAt)) ||
      !(value.sourceCommit === null || typeof value.sourceCommit === "string" && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(value.sourceCommit)))
    fail("ARTIFACT_INPUT_INVALID", "Work execution identity is malformed.");
  const expected = documentRoles(value.slug, value.mode);
  exactObject(value.artifacts, [...Object.keys(expected), "verificationDirectory"]);
  for (const [role, relative] of Object.entries(expected))
    if (value.artifacts[role] !== relative) fail("ARTIFACT_UNSAFE_PATH", "Document role is outside its fixed work directory.");
  relativePath(value.artifacts.verificationDirectory);
  if (!/^\.banzai\/runs\/[A-Za-z0-9][A-Za-z0-9._-]{0,199}\/verification$/u.test(value.artifacts.verificationDirectory))
    fail("ARTIFACT_UNSAFE_PATH", "Runner verification must remain within its ignored run directory.");
  return value;
}

export async function verifyDocumentVisibility(root, roles, extraPaths = []) {
  for (const [role, relative] of [...Object.entries(roles), ...extraPaths.map(relative => ["document", relative])]) {
    if (role === "verificationDirectory") continue;
    const selected = role === "reviewDirectory" ? `${relative}/review-1.md` : relative;
    await safePath(root, selected, { missing: true });
    if (await ignored(root, selected))
      fail("ARTIFACT_IGNORE_CONFLICT", `New work document ${selected} is ignored. Narrow the rule hiding documentation/work/; do not force-add or unignore historical evidence.`);
  }
}

/** Allocate authority only as part of starting an actual runner execution. */
export async function createExecutionBinding({ repoRoot, slug, mode, runId, creationId = randomUUID(), createdAt = new Date().toISOString(), sourceCommit = null }) {
  const root = await projectRoot(repoRoot);
  const binding = parseBinding({ schema: BINDING_SCHEMA, schemaVersion: 3, workId: creationId, slug, mode, createdAt, sourceCommit,
    artifacts: { ...documentRoles(slug, mode), verificationDirectory: `.banzai/runs/${runId}/verification` } });
  await verifyDocumentVisibility(root, binding.artifacts);
  const directory = workDirectory(slug);
  await makeDirectories(root, WORK_DIRECTORY);
  await safePath(root, directory, { missing: true, directory: true });
  try { await mkdir(path.join(root, directory)); }
  catch (error) {
    if (error.code === "EEXIST") fail("ARTIFACT_WORK_CONFLICT", "This work directory already exists. Select existing standalone work explicitly or use a distinct slug for a new run.");
    throw error;
  }
  return { binding, sha256: digestBytes(canonicalJson(binding)) };
}

export function ownsArtifact(binding, relative) {
  if (Object.entries(binding.artifacts).some(([role, target]) => role !== "verificationDirectory" && role !== "reviewDirectory" && relative === target)) return true;
  const prefix = `${binding.artifacts.reviewDirectory}/`;
  return relative.startsWith(prefix) && /^review-[1-9]\d*\.md$/u.test(relative.slice(prefix.length));
}

export async function inspectBoundWork(root, bound) {
  exactObject(bound, ["binding", "sha256"]);
  const binding = parseBinding(bound.binding);
  if (binding.schemaVersion !== 3) fail("ARTIFACT_VERSION_UNSUPPORTED", "Historical work can be inspected but cannot resume execution. Start new work without migrating its documents.");
  if (bound.sha256 !== digestBytes(canonicalJson(binding))) fail("ARTIFACT_RECOVERY_REQUIRED", "Persisted work binding digest is invalid.");
  await safePath(root, binding.artifacts.reviewDirectory, { directory: true });
  await verifyDocumentVisibility(root, binding.artifacts);
  return bound;
}

/** Exact selected documents, including unchanged or missing roles; no machine-state crawl. */
export async function workDocumentInventory(root, bound) {
  await inspectBoundWork(root, bound);
  const roles = bound.binding.artifacts;
  const selected = new Set(Object.entries(roles).filter(([role]) => !["reviewDirectory", "verificationDirectory"].includes(role)).map(([, relative]) => relative));
  const entries = await readdir(await safePath(root, roles.reviewDirectory, { directory: true }));
  if (entries.length > 1000) fail("ARTIFACT_DISCOVERY_LIMIT", "Selected work inventory exceeds its bound.");
  for (const entry of entries) if (/^review-[1-9]\d*\.md$/u.test(entry)) selected.add(`${roles.reviewDirectory}/${entry}`);
  const inventory = [];
  for (const relative of [...selected].sort()) {
    const bytes = await readBytes(root, relative, { optional: true });
    inventory.push({ path: relative, kind: bytes === null ? "deleted" : "file", sha256: bytes === null ? null : digestBytes(Buffer.concat([Buffer.from("file\0"), bytes])) });
  }
  return inventory;
}
