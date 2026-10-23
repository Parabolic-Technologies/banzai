import { AsyncLocalStorage } from "node:async_hooks";
import { constants } from "node:fs";
import { lstat, open, unlink } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { canonicalJson, digestBytes, fail, ignored, makeDirectories, METADATA_LIMIT, publishNew, readBytes, readJson, relativePath, safePath, verifyExecutionIgnore } from "./project-files.mjs";
import { inspectBoundWork } from "./work-documents.mjs";
export { verifyExecutionIgnore } from "./project-files.mjs";

const ownership = new AsyncLocalStorage();
const NAMESPACES = [".banzai/runs", ".banzai/verification", ".banzai/execution-locks"];
const PRIVATE_FILES = [".banzai/runner.lock", ".banzai/active-run.json"];
export const executionKey = (directory) => digestBytes(relativePath(directory));

export async function ensureExecutionIgnores(root) {
  const missing = [];
  for (const namespace of NAMESPACES) if (!(await ignored(root, `${namespace}/probe`))) missing.push(`${namespace}/`);
  for (const relative of PRIVATE_FILES) if (!(await ignored(root, relative))) missing.push(relative);
  if (missing.length) {
    await safePath(root, ".gitignore", { missing: true });
    const before = await readBytes(root, ".gitignore", { optional: true, limit: 1024 * 1024 });
    const handle = await open(path.join(root, ".gitignore"), constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW, 0o644);
    try { await handle.writeFile(`${before?.length && before.at(-1) !== 10 ? "\n" : ""}${missing.join("\n")}\n`); await handle.sync(); }
    finally { await handle.close(); }
  }
  for (const namespace of NAMESPACES) await verifyExecutionIgnore(root, `${namespace}/probe`);
  for (const relative of PRIVATE_FILES) await verifyExecutionIgnore(root, relative);
  return missing.length > 0;
}

function claimPath(directory) { return `.banzai/execution-locks/${executionKey(directory)}/claim.json`; }

function requireAbsentOwner(pid) {
  try { process.kill(pid, 0); }
  catch (error) {
    if (error.code === "ESRCH") return;
    fail("ARTIFACT_OWNERSHIP_CONFLICT", "Execution owner liveness could not be confirmed. Retain the claim for owner inspection.");
  }
  fail("ARTIFACT_OWNERSHIP_CONFLICT", `Execution owner is still active (pid ${pid}). Retain its claim.`);
}

async function recoverExecutionClaim(root, directory, identity) {
  // Only the repository owner may reclaim: ordinary executors never remove a
  // conflicting claim, and the runner lock serializes authorized recoveries.
  const runner = await readJson(root, ".banzai/runner.lock");
  if (runner?.schemaVersion !== 1 || runner.pid !== process.pid || typeof runner.token !== "string" || !runner.token)
    fail("ARTIFACT_OWNERSHIP_CONFLICT", "Execution recovery requires the current process to own the repository runner lock.");
  const relative = claimPath(directory);
  const bytes = await readBytes(root, relative, { optional: true, limit: METADATA_LIMIT });
  if (bytes === null) return;
  await verifyExecutionIgnore(root, relative);
  const named = await lstat(await safePath(root, relative));
  let claim;
  try { claim = JSON.parse(bytes.toString("utf8")); }
  catch { fail("ARTIFACT_OWNERSHIP_CONFLICT", "Execution claim is malformed. Retain it for owner inspection."); }
  if (claim === null || typeof claim !== "object" || Array.isArray(claim) ||
      Object.keys(claim).sort().join(",") !== "directory,identity,pid,token" ||
      claim.directory !== directory || claim.identity !== identity ||
      typeof claim.token !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(claim.token) ||
      !Number.isSafeInteger(claim.pid) || claim.pid <= 0 || claim.pid > 2147483647)
    fail("ARTIFACT_OWNERSHIP_CONFLICT", "Execution claim does not identify this bound work and a valid owner. Retain it for owner inspection.");
  requireAbsentOwner(claim.pid);
  const retained = `${path.posix.dirname(relative)}/recovered-${claim.token}.json`;
  try { await publishNew(root, retained, bytes); }
  catch (error) {
    if (error.code !== "EEXIST") throw error;
    // Recovery may itself have crashed after preserving the old claim.
    if (!(await readBytes(root, retained, { limit: METADATA_LIMIT })).equals(bytes))
      fail("ARTIFACT_OWNERSHIP_CONFLICT", "Retained execution claim conflicts with recovery. Preserve both records for owner inspection.");
  }
  requireAbsentOwner(claim.pid);
  const currentBytes = await readBytes(root, relative, { limit: METADATA_LIMIT });
  const current = await lstat(await safePath(root, relative));
  if (current.dev !== named.dev || current.ino !== named.ino || !currentBytes.equals(bytes))
    fail("ARTIFACT_OWNERSHIP_CONFLICT", "Execution claim changed during recovery. Retain the current owner's claim.");
  await unlink(path.join(root, relative));
}

export async function withExecutionOwnership(root, directory, action, identity = null) {
  relativePath(directory);
  const relative = claimPath(directory);
  const current = ownership.getStore();
  if (current?.root === root && current.directory === directory && current.identity === identity) {
    const claim = await readJson(root, relative);
    if (claim.token !== current.token || claim.identity !== identity) fail("ARTIFACT_OWNERSHIP_CONFLICT", "Execution ownership changed.");
    return action();
  }
  await ensureExecutionIgnores(root);
  await verifyExecutionIgnore(root, relative);
  await makeDirectories(root, path.posix.dirname(relative));
  const claim = { token: randomUUID(), directory, identity, pid: process.pid };
  try { await publishNew(root, relative, JSON.stringify(claim) + "\n"); }
  catch (error) {
    if (error.code === "EEXIST") fail("ARTIFACT_OWNERSHIP_CONFLICT", "Another executor owns this work. Inspect the original process and obtain owner recovery before removing a stale claim.");
    throw error;
  }
  return ownership.run({ ...claim, root }, async () => {
    try { return await action(); }
    finally {
      const retained = await readJson(root, relative);
      if (canonicalJson(retained) !== canonicalJson(claim)) fail("ARTIFACT_OWNERSHIP_CONFLICT", "Execution claim changed; retain it for owner recovery.");
      await safePath(root, relative);
      await unlink(path.join(root, relative));
    }
  });
}

export async function hasRunnerWorkOwnership(root, bound) {
  if (bound === undefined) return false;
  const current = ownership.getStore();
  if (current?.root !== root || current.directory !== bound.binding.artifacts.reviewDirectory || current.identity !== bound.sha256) return false;
  const claim = await readJson(root, claimPath(current.directory), true);
  return claim?.token === current.token && claim.identity === current.identity;
}

export async function withRunnerWorkOwnership(root, bound, action, options = {}) {
  if (bound === undefined) fail("ARTIFACT_VERSION_UNSUPPORTED", "Historical runs without a current work binding cannot resume execution. Start new work without migrating their documents.");
  await inspectBoundWork(root, bound);
  if (options.recoverStale === true && !(await hasRunnerWorkOwnership(root, bound)))
    await recoverExecutionClaim(root, bound.binding.artifacts.reviewDirectory, bound.sha256);
  return withExecutionOwnership(root, bound.binding.artifacts.reviewDirectory, action, bound.sha256);
}
