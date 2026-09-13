import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { rename, readdir } from "node:fs/promises";
import path from "node:path";
import { acquireWork, releaseWork, inspectArtifacts, readJson, readBytes, safePath, makeDirectories, publishNew, exactObject } from "./artifact-storage.mjs";
import { parseVerificationAttemptRecord } from "./artifact-readers.mjs";
import { captureVerificationInputs, decideVerification, evidenceDigest, parseVerificationConfiguration, parseVerificationObligations, sameVerificationCapture, VerificationEvidenceError } from "./verification-evidence.mjs";
import { persistVerificationDecision, persistVerificationOriginStart, persistVerificationOriginFinish, readVerificationOrigins, verificationApplicability, persistVerificationApplicability } from "./verification-store.mjs";

const fail = (message) => { throw new VerificationEvidenceError(message); };
const redact = (value) => value.replace(/("(?:api[_-]?key|access[_-]?token|auth[_-]?token|password)"\s*:\s*")[^"]+(")/giu, "$1[REDACTED]$2")
  .replace(/\b(?:sk|sk-ant|sess)-[A-Za-z0-9_-]{12,}\b/gu, "[REDACTED]");

async function readAttempts(root, directory) {
  const relative = `${directory}/attempts`;
  const target = await safePath(root, relative, { directory: true, missing: true });
  let entries;
  try { entries = await readdir(target); } catch (error) { if (error.code === "ENOENT") return []; throw error; }
  if (entries.length > 10000) fail("Verification attempt inventory exceeds its bound.");
  const records = [];
  for (const entry of entries.sort()) {
    if (!/^verification-\d{6}-verification-[a-f0-9-]{36}\.json$/u.test(entry)) fail("Unknown physical verification evidence.");
    const record = parseVerificationAttemptRecord(await readJson(root, `${relative}/${entry}`));
    if (entry !== `verification-${String(record.sequence).padStart(6, "0")}-${record.id}.json`) fail("Physical verification filename mismatch.");
    records.push(record);
  }
  return records;
}

async function replaceStarted(root, relative, before, terminal) {
  parseVerificationAttemptRecord(terminal);
  const existing = await readJson(root, relative);
  if (JSON.stringify(existing) !== JSON.stringify(before) || existing.status !== "started") fail("Verification attempt changed before completion.");
  const temporary = `${relative}.${randomUUID()}.tmp`;
  await publishNew(root, temporary, JSON.stringify(terminal, null, 2) + "\n");
  await safePath(root, relative);
  await rename(path.join(root, temporary), path.join(root, relative));
}

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

/** A closed request selects configured identities, never arbitrary commands. */
export async function verificationOperation(operation, request) {
  if (!["inspect", "decide", "execute"].includes(operation)) fail("Unsupported verification operation.");
  exactObject(request, ["schema", "schemaVersion", "repoRoot", "workPath", "roundId"], operation === "execute" ? ["checkId", "retryOf"] : []);
  if (request.schema !== "banzai-verification-request/v1" || request.schemaVersion !== 1 || !/^[a-f0-9-]{36}$/u.test(request.roundId)) fail("Unsupported verification request identity.");
  if (operation === "execute" && typeof request.checkId !== "string") fail("Execution requires one configured check ID.");
  const inspection = await inspectArtifacts({ repoRoot: request.repoRoot, workPath: request.workPath });
  const binding = inspection.work?.binding;
  const root = inspection.projectRoot;
  const rawConfig = await readJson(root, ".banzai/config.json", true);
  if (!binding || binding.schemaVersion !== 2 || rawConfig?.schemaVersion !== 3 || !rawConfig.verification?.policy)
    return { supported: false, reason: "Use the existing fresh verification workflow; explicit binding v2 and config 3 policy are required." };
  const configuration = parseVerificationConfiguration(rawConfig.verification);
  const storage = { repoRoot: root, directory: binding.artifacts.verificationDirectory, workId: binding.workId };
  const planBytes = binding.artifacts.plan ? await readBytes(root, binding.artifacts.plan, { optional: true, limit: 16 * 1024 * 1024 }) : null;
  const authorityArtifacts = [];
  for (const role of ["description", "plan", "work", "changeReport"]) {
    const relative = binding.artifacts[role];
    if (relative) {
      const bytes = await readBytes(root, relative, { optional: true, limit: 16 * 1024 * 1024 });
      authorityArtifacts.push({ role, sha256: bytes === null ? null : evidenceDigest(bytes) });
    }
  }
  const authorityDigest = evidenceDigest({ binding: inspection.work.sha256, configuration, artifacts: authorityArtifacts });
  const assertAuthority = async () => {
    const selected = await inspectArtifacts({ repoRoot: root, workPath: request.workPath });
    const currentConfig = await readJson(root, ".banzai/config.json");
    if (selected.work?.sha256 !== inspection.work.sha256 || JSON.stringify(currentConfig) !== JSON.stringify(rawConfig)) fail("Verification authority changed during execution.");
    for (const item of authorityArtifacts) {
      const bytes = await readBytes(root, binding.artifacts[item.role], { optional: true, limit: 16 * 1024 * 1024 });
      if ((bytes === null ? null : evidenceDigest(bytes)) !== item.sha256) fail("Bound verification authority changed during execution.");
    }
  };
  const strict = binding.mode === "strict" || binding.mode === "workflow";
  const obligations = parseVerificationObligations(planBytes?.toString("utf8") ?? null, configuration);
  const capture = () => captureVerificationInputs({ repoRoot: root, configuration, workId: binding.workId, evidenceDirectories: [storage.directory] });
  const snapshot = async () => {
    const first = await capture(); const second = await capture();
    return sameVerificationCapture(first, second) || !first.complete && !second.complete ? second : { complete: false, reason: "inputs_unavailable", candidateDigest: null, checks: [] };
  };
  const inspect = async () => {
    const attempts = await readAttempts(root, storage.directory);
    const origins = await readVerificationOrigins(storage, attempts);
    const current = await snapshot();
    const decision = decideVerification({ workId: binding.workId, roundId: request.roundId, configuration, authorityDigest, strict, obligations, capture: current, origins });
    return { attempts, origins, current, decision };
  };
  if (operation !== "execute") {
    const data = await inspect();
    return { supported: true, decision: data.decision, applicability: verificationApplicability(data.decision, data.origins, data.current), physicalAttempts: data.attempts.length };
  }
  const claim = await acquireWork({ repoRoot: root, workPath: request.workPath, ownerId: "verification-helper" });
  try {
    await assertAuthority();
    await makeDirectories(root, `${storage.directory}/attempts`);
    const marker = `${storage.directory}/ledger.json`;
    const ledger = await readJson(root, marker, true);
    if (ledger === null) await publishNew(root, marker, '{"schemaVersion":2}\n');
    else if (JSON.stringify(ledger) !== '{"schemaVersion":2}') fail("Unsupported verification ledger.");
    let { attempts, origins, current, decision } = await inspect();
    const action = decision.actions.find((item) => item.checkId === request.checkId);
    if (!action) fail("Unknown configured verification check.");
    await persistVerificationDecision(storage, decision);
    const previous = attempts.filter((attempt) => attempt.round.id === request.roundId && attempt.command.profileOrdinal === action.identity.profileOrdinal && attempt.command.commandOrdinal === action.identity.commandOrdinal).at(-1);
    const already = verificationApplicability(decision, origins, current).dispositions.find((item) => item.checkId === action.checkId)?.kind === "executed";
    if (action.action === "execute" && !already) {
      if (previous && !(previous.status === "failed" && previous.id === request.retryOf)) fail("This round retains an attempt requiring explicit failure retry or owner recovery.");
      if (request.retryOf !== undefined && previous?.id !== request.retryOf) fail("Verification retry does not match this check and round.");
      const latest = await snapshot();
      await assertAuthority();
      if (latest.candidateDigest !== current.candidateDigest) fail("Verification source changed before invocation.");
      const command = configuration.profiles[action.identity.profileOrdinal - 1].commands[action.identity.commandOrdinal - 1];
      const record = { schemaVersion: 1, id: `verification-${randomUUID()}`, sequence: (attempts.at(-1)?.sequence ?? 0) + 1,
        round: { id: request.roundId, ordinal: new Set(attempts.map((item) => item.round.id).concat(request.roundId)).size,
          sourcePhase: "implementation", sourceAttemptId: request.roundId, sourceAttemptKind: "implementation" },
        command: { profileId: configuration.profiles[action.identity.profileOrdinal - 1].id,
          projectType: configuration.profiles[action.identity.profileOrdinal - 1].projectType,
          profileOrdinal: action.identity.profileOrdinal, commandOrdinal: action.identity.commandOrdinal, configurationDigest: action.identity.configurationDigest },
        status: "started", startedAt: new Date().toISOString(), completedAt: null, durationMs: null, exitCode: null, signal: null,
        failureCategory: null, retryOf: request.retryOf ?? null, restartOf: null, stdout: null, stderr: null };
      parseVerificationAttemptRecord(record);
      const relative = `${storage.directory}/attempts/verification-${String(record.sequence).padStart(6, "0")}-${record.id}.json`;
      await publishNew(root, relative, JSON.stringify(record, null, 2) + "\n");
      await persistVerificationOriginStart(storage, record, decision, current);
      const result = await invoke(command, root, configuration.policy.dependencies.environment);
      const logs = {};
      for (const stream of ["stdout", "stderr"]) {
        const log = `verification/${record.id}.${stream}.log`;
        await publishNew(root, `${path.posix.dirname(storage.directory)}/${log}`, result[stream]);
        logs[stream] = { relativePath: log, sha256: evidenceDigest(result[stream]) };
      }
      const terminal = { ...record, status: result.status, completedAt: result.completedAt,
        durationMs: Math.max(0, Date.parse(result.completedAt) - Date.parse(record.startedAt)), exitCode: result.exitCode,
        signal: result.signal, failureCategory: result.failureCategory, ...logs };
      await replaceStarted(root, relative, record, terminal);
      await persistVerificationOriginFinish(storage, terminal, await snapshot());
      attempts = await readAttempts(root, storage.directory);
      origins = await readVerificationOrigins(storage, attempts);
      current = await snapshot();
    }
    await assertAuthority();
    const applicability = verificationApplicability(decision, origins, current);
    await persistVerificationApplicability(storage, applicability);
    return { supported: true, decision, applicability, physicalAttempts: attempts.length };
  } finally {
    await releaseWork({ repoRoot: root, workPath: request.workPath, token: claim.token });
  }
}
