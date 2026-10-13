import { parseTaskVerificationObligations, parseTaskVerificationPolicy, selectTaskVerification } from "./task-verification.mjs";
import { executeTaskVerification, captureTaskVerificationInputs, readTaskVerificationAttempts, taskVerificationApplicability, parseTaskVerificationDecision } from "./task-verification-store.mjs";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import path from "node:path";
import { realpath } from "node:fs/promises";
import { projectRoot, relativePath, readJson, readBytes, safePath, makeDirectories, publishNew, exactObject } from "./project-files.mjs";
import { executionKey, withExecutionOwnership, verifyExecutionIgnore } from "./execution-ownership.mjs";
import { evidenceDigest, VerificationEvidenceError } from "./verification-evidence.mjs";
const fail = (message) => { throw new VerificationEvidenceError(message); };
const redact = (value) => value.replace(/("(?:api[_-]?key|access[_-]?token|auth[_-]?token|password)"\s*:\s*")[^"]+(")/giu, "$1[REDACTED]$2")
  .replace(/\b(?:sk|sk-ant|sess)-[A-Za-z0-9_-]{12,}\b/gu, "[REDACTED]");

async function invoke(command, root, environment) {
  return new Promise((resolve) => {
    const child = spawn(command.command, command.args, { cwd: root, env: environment, shell: false, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
    let stdout = ""; let stderr = ""; let size = 0; let category = null; let interrupted = false; let killTimer;
    const kill = (signal) => { if (child.pid) { try { process.kill(process.platform === "win32" ? child.pid : -child.pid, signal); } catch { /* already drained */ } } };
    const stop = () => { kill("SIGTERM"); killTimer ??= setTimeout(() => kill("SIGKILL"), 1000); };
    const interrupt = () => { interrupted = true; category = "runner_failure"; stop(); };
    process.on("SIGINT", interrupt); process.on("SIGTERM", interrupt);
    const timeout = setTimeout(() => { category = "timeout"; stop(); }, command.timeoutMs);
    child.stdout.on("data", (bytes) => { size += bytes.length; if (size > 16 * 1024 * 1024) { category = "output_limit"; stop(); } else stdout += bytes.toString("utf8"); });
    child.stderr.on("data", (bytes) => { size += bytes.length; if (size > 16 * 1024 * 1024) { category = "output_limit"; stop(); } else stderr += bytes.toString("utf8"); });
    child.once("error", () => { category = "process_start"; });
    child.once("close", (exitCode, signal) => {
      clearTimeout(timeout); clearTimeout(killTimer); process.off("SIGINT", interrupt); process.off("SIGTERM", interrupt);
      resolve({ stdout: redact(stdout), stderr: redact(stderr), exitCode, signal, completedAt: new Date().toISOString(),
        status: interrupted ? "interrupted" : exitCode === 0 && signal === null && category === null ? "completed" : "failed",
        failureCategory: category ?? (exitCode === 0 && signal === null ? null : "command_exit") });
    });
  });
}

/** Direct document selection carries skill authority; it never creates runner approval. */
export async function verificationOperation(operation, request) {
  if (request?.schema !== "banzai-verification-request/v3" || request.schemaVersion !== 3) {
    const error = new VerificationEvidenceError("Legacy executable requests are unsupported. Use verification request v3 with documentPath and workflow; leave historical documents unchanged.");
    error.code = "VERIFICATION_REQUEST_UNSUPPORTED";
    throw error;
  }
  if (!["inspect", "decide", "execute"].includes(operation)) fail("Unsupported task verification operation.");
  exactObject(request, ["schema", "schemaVersion", "repoRoot", "documentPath", "workflow", "roundId"], operation === "execute" ? ["retryOf"] : []);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(request.roundId) || !["strict", "feature", "quick-fix"].includes(request.workflow)) fail("Unsupported task verification identity or workflow.");
  const root = await projectRoot(request.repoRoot);
  const document = relativePath(request.documentPath);
  const name = path.posix.basename(document);
  if (!(document.startsWith("documentation/") || /^\.banzai\/work\/[0-9a-f-]{36}\//u.test(document)) ||
      (request.workflow === "strict" ? name !== "plan.md" : request.workflow === "feature" ? name !== "work.md" : !name.endsWith(".md")))
    fail("Select the exact task plan, work or change document for this workflow.");
  const directory = path.relative(root, await realpath(await safePath(root, path.posix.dirname(document), { directory: true }))).split(path.sep).join("/");
  const evidenceDirectory = `.banzai/verification/${executionKey(directory)}`;
  const marker = `${evidenceDirectory}/identity.json`;
  const bytes = await readBytes(root, document, { limit: 16 * 1024 * 1024 });
  if (!/^```banzai-verification-obligations\/v2\r?$/mu.test(bytes.toString("utf8")))
    return { supported: false, reason: "The selected document has no supported task inventory. Keep applicable checks fresh under the calling skill; do not rewrite historical authority." };
  const obligations = parseTaskVerificationObligations(bytes.toString("utf8"));
  const strict = request.workflow === "strict";
  const inspectIdentity = async () => {
    const identity = await readJson(root, marker, true);
    if (identity !== null) {
      exactObject(identity, ["schema", "schemaVersion", "workId", "directory"]);
      if (identity.schema !== "banzai-standalone-verification/v1" || identity.schemaVersion !== 1 || identity.directory !== directory || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(identity.workId)) fail("Invalid standalone verification identity.");
    }
    return identity;
  };
  const rawConfig = await readJson(root, ".banzai/config.json", true);
  let policy = null;
  try {
    if (rawConfig?.schemaVersion === 4 && rawConfig.verification !== undefined)
      exactObject(rawConfig.verification, [], ["policy"]);
    if (rawConfig?.schemaVersion === 4 && Object.hasOwn(rawConfig.verification ?? {}, "policy"))
      policy = parseTaskVerificationPolicy(rawConfig.verification.policy);
  } catch {
    const error = new VerificationEvidenceError("The declared task verification policy is invalid.");
    error.code = "VERIFICATION_POLICY_INVALID";
    throw error;
  }
  const selection = selectTaskVerification({ required: strict ? obligations.checks : [], candidates: strict ? { checks: [], absenceReason: obligations.absenceReason ?? "Required plan checks." } : {checks: obligations.checks, absenceReason: obligations.absenceReason}, policy });
  const run = async () => {
    if (operation === "execute") await verifyExecutionIgnore(root, marker);
    let identity = await inspectIdentity();
    if (identity === null) {
      if (operation !== "execute") return { supported: true, authorityKind: "standalone-skill", evidence: "unavailable", decision: null, applicability: null, physicalAttempts: 0 };
      await verifyExecutionIgnore(root, marker);
      await makeDirectories(root, evidenceDirectory);
      identity = { schema: "banzai-standalone-verification/v1", schemaVersion: 1, workId: randomUUID(), directory };
      await publishNew(root, marker, JSON.stringify(identity) + "\n");
    }
    const selectionDigest = evidenceDigest({ document, workflow: request.workflow, identity });
  const storage = { repoRoot: root, directory: evidenceDirectory, workId: identity.workId };
  const environment = policy?.reuse?.dependencies.environment ?? Object.fromEntries(Object.entries(process.env).filter(([key, value]) => value !== undefined && !/(?:API_KEY|ACCESS_TOKEN|AUTH_TOKEN|PASSWORD|SECRET)/iu.test(key)));
  const context = { kind: "inherited-local", invocationDigest: evidenceDigest({ owner: "standalone-skill", binding: selectionDigest, authority: evidenceDigest(bytes), environment: evidenceDigest(environment) }), restrictions: [] };
  const authority = { workId: identity.workId, sourceAttemptId: request.roundId, workflow: request.workflow, taskDigest: evidenceDigest(bytes), selectionDigest: selectionDigest, approvalDigest: strict ? evidenceDigest(bytes) : null, contextDigest: evidenceDigest(context) };
  const revalidate = async () => {
    if (operation === "execute") await verifyExecutionIgnore(root, marker);
    if (JSON.stringify(await inspectIdentity()) !== JSON.stringify(identity)) fail("Standalone execution identity changed.");
    if (evidenceDigest(await readBytes(root, document, { limit: 16 * 1024 * 1024 })) !== authority.taskDigest || JSON.stringify(await readJson(root, ".banzai/config.json", true)) !== JSON.stringify(rawConfig)) fail("Standalone task authority changed.");
  };
  if (operation !== "execute") {
    await revalidate();
    const before = await captureTaskVerificationInputs(storage, selection.checks.map(item => item.descriptor), policy);
    const body = { schema: "banzai-verification-decision/v2", schemaVersion: 2, workId: identity.workId, roundId: request.roundId, sourceAttemptId: authority.sourceAttemptId, authority, context, policyDigest: policy ? evidenceDigest(policy) : null, ...selection, before };
    const decision = parseTaskVerificationDecision({ ...body, sha256: evidenceDigest(body) });
    const attempts = await readTaskVerificationAttempts(storage);
    return { supported: true, authorityKind: "standalone-skill", decision, applicability: await taskVerificationApplicability(storage, decision, attempts, before), physicalAttempts: attempts.length };
  }
    const publication = await executeTaskVerification({ ...storage, selection, authority, context, policy, roundId: request.roundId, retryOf: request.retryOf, revalidate, invoke: (descriptor, cwd) => invoke(descriptor, cwd, environment) });
    return { supported: true, authorityKind: "standalone-skill", ...publication, physicalAttempts: publication.attempts.length };
  };
  return operation === "execute" ? withExecutionOwnership(root, directory, run) : run();
}
