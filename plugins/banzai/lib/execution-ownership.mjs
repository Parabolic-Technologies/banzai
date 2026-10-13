import { AsyncLocalStorage } from "node:async_hooks";
import { constants } from "node:fs";
import { open, unlink } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { canonicalJson, digestBytes, fail, ignored, makeDirectories, publishNew, readBytes, readJson, relativePath, safePath, verifyExecutionIgnore } from "./project-files.mjs";
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

export async function withRunnerWorkOwnership(root, bound, action) {
  if (bound === undefined) fail("ARTIFACT_VERSION_UNSUPPORTED", "Historical runs without a current work binding cannot resume execution. Start new work without migrating their documents.");
  await inspectBoundWork(root, bound);
  return withExecutionOwnership(root, bound.binding.artifacts.reviewDirectory, action, bound.sha256);
}
