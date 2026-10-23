import { execFile } from "node:child_process";
import { promisify } from "node:util";
// Immutable task verification publication, shared by actual executor owners.
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import path from "node:path";
import { readdir, lstat, open } from "node:fs/promises";
import { safePath, readBytes, readJson, makeDirectories, publishNew, verifyExecutionIgnore } from "./project-files.mjs";
import { captureVerificationInputs, evidenceDigest, VerificationEvidenceError } from "./verification-evidence.mjs";
import { authorizeTaskVerification, parseTaskVerificationDescriptor } from "./task-verification.mjs";
const fail = (message) => { throw new VerificationEvidenceError(message); };
const HASH = /^[a-f0-9]{64}$/u;
const UUID = /^[a-f0-9-]{36}$/u;
function closed(v, keys) {
  if (!v || typeof v !== "object" || Array.isArray(v) || keys.some((key) => !Object.hasOwn(v, key)) || Object.keys(v).some((key) => !keys.includes(key))) fail("Invalid task verification record.");
}

function captureRecord(value) {
  closed(value, ["observedDigest", "complete", "reusable"]);
  if ((value.observedDigest !== null && !HASH.test(value.observedDigest)) || typeof value.complete !== "boolean") fail("Invalid observed task inputs.");
  if (value.reusable !== null) {
    closed(value.reusable, ["complete", "reason", "candidateDigest", "checks"]);
    if (typeof value.reusable.complete !== "boolean" || !Array.isArray(value.reusable.checks) || value.reusable.checks.length > 200) fail("Invalid reusable input capture.");
    if (value.reusable.complete ? !HASH.test(value.reusable.candidateDigest) || value.reusable.reason !== null : value.reusable.candidateDigest !== null) fail("Incomplete reusable input identity.");
    for (const check of value.reusable.checks) {
      closed(check, ["checkId", "executable", "environmentDigest", "inputDigest"]);
      if (typeof check.checkId !== "string" || !path.isAbsolute(check.executable) || !HASH.test(check.environmentDigest) || !HASH.test(check.inputDigest)) fail("Invalid reusable check inputs.");
    }
  }
  if (value.complete !== (value.reusable?.complete === true)) fail("Task capture completeness conflicts with its evidence.");
}
function reference(value) {
  closed(value, ["relativePath", "sha256"]);
  if (typeof value.relativePath !== "string" || !/^\.banzai\/(?:(?:work\/[a-f0-9-]{36}|runs\/[a-z0-9][a-z0-9.-]{0,199})\/verification|verification\/[a-f0-9]{64})\/(?:decisions|applications|attempts|origins|logs)\/[a-z0-9.-]+$/u.test(value.relativePath) || !HASH.test(value.sha256)) fail("Invalid task evidence reference.");
}

function storage(input) {
  if (!UUID.test(input.workId) || !/^\.banzai\/(?:(?:work\/[a-f0-9-]{36}|runs\/[a-z0-9][a-z0-9.-]{0,199})\/verification|verification\/[a-f0-9]{64})$/u.test(input.directory)) fail("Invalid task verification storage.");
  return input.directory;
}
async function publish(input, suffix, value) {
  const relativePath = `${storage(input)}/${suffix}`;
  const bytes = typeof value === "string" ? value : JSON.stringify(value, null, 2) + "\n";
  await verifyExecutionIgnore(input.repoRoot, relativePath);
  await makeDirectories(input.repoRoot, path.posix.dirname(relativePath));
  const existing = await readBytes(input.repoRoot, relativePath, { optional: true, limit: 20 * 1024 * 1024 });
  if (existing !== null) { if (!existing.equals(Buffer.from(bytes))) fail("Immutable task verification evidence differs."); }
  else await publishNew(input.repoRoot, relativePath, bytes);
  return { relativePath, sha256: evidenceDigest(bytes) };
}
const redact = (value) => value.replace(/("(?:api[_-]?key|access[_-]?token|auth[_-]?token|password)"\s*:\s*")[^"]+(")/giu, "$1[REDACTED]$2").replace(/\b(?:sk|sk-ant|sess)-[A-Za-z0-9_-]{12,}\b/gu, "[REDACTED]");

/** Complete reuse capture is opt-in; ordinary fresh runs still record observed inputs. */
// Observed entries stay in process memory so a diagnostic can name changed paths
// without widening the persisted observation record.
const observedEntries = new WeakMap();

function observedChanges(before, after) {
  const earlier = observedEntries.get(before); const later = observedEntries.get(after);
  if (!earlier || !later) return null;
  const identity = (entry) => `${entry.sha256}:${entry.mode}`;
  const previous = new Map(earlier.map((entry) => [entry.path, identity(entry)]));
  const current = new Map(later.map((entry) => [entry.path, identity(entry)]));
  const changes = [
    ...[...current].filter(([file, value]) => previous.get(file) !== value).map(([file]) => [file, previous.has(file) ? "modified" : "added"]),
    ...[...previous.keys()].filter((file) => !current.has(file)).map((file) => [file, "removed"])
  ].sort(([a], [b]) => a.localeCompare(b, "en")).map(([file, kind]) => `${JSON.stringify(file.slice(0, 200))} (${kind})`);
  if (!changes.length) return null;
  return changes.length > 10 ? `${changes.slice(0, 10).join(", ")} and ${changes.length - 10} more` : changes.join(", ");
}

export async function captureTaskVerificationInputs(input, descriptors, policy) {
  const entries = []; const budget = { bytes: 0 }; let unavailable = false; let opaque = false;
  const root = input.repoRoot;
  const excludedSourcePaths = new Set(input.excludedSourcePaths ?? []);
  if ([...excludedSourcePaths].some(file => !/^documentation\/work\/[a-z0-9]+(?:-[a-z0-9]+)*\/review-[1-9]\d*\.md$/u.test(file))) fail("Invalid runner-published review exclusion.");
  let relevant = null;
  const relevantDirectories = new Set();
  try {
    const { stdout } = await promisify(execFile)("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: root, maxBuffer: 16 * 1024 * 1024 });
    relevant = new Set(stdout.split("\0").filter(Boolean));
    for (const name of relevant) {
      let parent = path.posix.dirname(name);
      while (parent !== ".") { relevantDirectories.add(parent); parent = path.posix.dirname(parent); }
    }
  } catch { /* Non-Git standalone work uses conservative filesystem observation. */ }
  async function walk(directory, prefix = "") {
    const before = await readdir(directory, { withFileTypes: true });
    for (const item of before.sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = prefix + item.name;
      if (relative === ".git" || relative === ".banzai" || item.name === "node_modules" || excludedSourcePaths.has(relative)) continue;
      if (relevant && !relevant.has(relative) && !relevantDirectories.has(relative)) continue;
      if (entries.length >= 50000) fail("Task input observation exceeds its bound.");
      const absolute = path.join(directory, item.name); const stat = await lstat(absolute);
      if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) { unavailable = true; continue; }
      if (stat.isDirectory()) { await walk(absolute, relative + "/"); continue; }
      // Do not read secrets merely to establish verification provenance.
      if (/(?:^|\/)(?:\.env(?:\.[^/]*)?|credentials(?:\.[^/]*)?|secrets?(?:\.[^/]*)?|id_(?:rsa|ed25519)|[^/]*\.(?:pem|p12|pfx))$/iu.test(relative)) {
        opaque = true;
        // Filesystem identity is a drift guard for this round, never proof of
        // secret values or complete dependencies for cross-round reuse.
        entries.push({ path: relative, sha256: evidenceDigest(["opaque-metadata", fileIdentity(stat)]), mode: stat.mode & 0o777 });
        continue;
      }
      entries.push({ path: relative, sha256: await observeFile(absolute, stat, budget), mode: stat.mode & 0o777 });
    }
    if (JSON.stringify(before.map((item) => item.name).sort()) !== JSON.stringify((await readdir(directory)).sort())) fail("Task input inventory changed during observation.");
  }
  let observedDigest = null;
  try { await walk(root); if (!unavailable) observedDigest = evidenceDigest(entries); } catch { /* unknown is never equal input evidence */ }
  let reusable = null;
  if (policy?.reuse && descriptors.length) {
    const commands = descriptors.map((check) => ({ id: check.id, name: check.name, command: path.isAbsolute(check.command) ? check.command : check.command.includes("/") ? path.posix.join(check.cwd, check.command) : check.command, args: check.args, timeoutMs: check.timeoutMs, evidence: check.evidence, ignoreExplanatory: check.evidence === "equivalent_evidence" }));
    reusable = opaque ? { complete: false, reason: "inputs_unavailable", candidateDigest: null, checks: [] } : await captureVerificationInputs({ repoRoot: root, workId: input.workId, evidenceDirectories: [input.directory], sourceExclusions: [...excludedSourcePaths], configuration: { profiles: [{ id: "task-capture", projectType: "custom", commands }], policy: policy.reuse } });
  }
  const observation = { observedDigest, complete: reusable?.complete === true, reusable };
  if (observedDigest !== null) observedEntries.set(observation, entries);
  return observation;
}

const fileIdentity = (stat) => [stat.dev, stat.ino, stat.mode, stat.size, stat.mtimeMs, stat.ctimeMs].join(":");

async function observeFile(absolute, before, budget) {
  const limit = 128 * 1024 * 1024;
  if (budget.bytes + before.size > limit) fail("Task input observation exceeds its bound.");
  const handle = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const hash = createHash("sha256"); const buffer = Buffer.alloc(512 * 1024); let size = 0;
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      size += bytesRead; budget.bytes += bytesRead;
      if (budget.bytes > limit) fail("Task input observation exceeds its bound.");
      hash.update(buffer.subarray(0, bytesRead));
    }
    if (size !== before.size || fileIdentity(before) !== fileIdentity(await handle.stat()) || fileIdentity(before) !== fileIdentity(await lstat(absolute))) fail("Task input changed during observation.");
    return hash.digest("hex");
  } finally { await handle.close(); }
}

export function parseTaskVerificationDecision(value) {
  closed(value, ["schema", "schemaVersion", "workId", "roundId", "sourceAttemptId", "authority", "context", "policyDigest", "checks", "absenceReason", "before", "sha256"]);
  if (value.schema !== "banzai-verification-decision/v2" || value.schemaVersion !== 2 || !UUID.test(value.workId) || !UUID.test(value.roundId) || !Array.isArray(value.checks) || value.checks.length > 200) fail("Unsupported task verification decision.");
  for (const item of value.checks) {
    closed(item, ["descriptor", "required"]); parseTaskVerificationDescriptor(item.descriptor);
    if (typeof item.required !== "boolean") fail("Invalid required check marker.");
  }
  if (new Set(value.checks.map((item) => item.descriptor.id)).size !== value.checks.length) fail("Duplicate task check.");
  closed(value.authority, ["workId", "sourceAttemptId", "workflow", "taskDigest", "selectionDigest", "approvalDigest", "contextDigest"]);
  closed(value.context, ["kind", "invocationDigest", "restrictions"]);
  if (value.authority.workId !== value.workId || value.authority.sourceAttemptId !== value.sourceAttemptId || !["strict", "feature", "quick-fix"].includes(value.authority.workflow) || !HASH.test(value.authority.taskDigest) || !HASH.test(value.authority.selectionDigest) || evidenceDigest(value.context) !== value.authority.contextDigest || value.context.kind !== "inherited-local" || !HASH.test(value.context.invocationDigest) || !Array.isArray(value.context.restrictions) || value.context.restrictions.some((item) => typeof item !== "string" || item.length > 200)) fail("Invalid persisted task execution authority.");
  if (value.authority.workflow === "strict" ? !HASH.test(value.authority.approvalDigest) : value.authority.approvalDigest !== null) fail("Invalid persisted approval identity.");
  if (value.checks.length ? value.absenceReason !== null : typeof value.absenceReason !== "string" || !value.absenceReason.length || value.absenceReason.length > 2000) fail("Invalid task absence rationale.");
  captureRecord(value.before);
  const { sha256, ...body } = value;
  if (!HASH.test(sha256) || evidenceDigest(body) !== sha256 || (value.policyDigest !== null && !HASH.test(value.policyDigest))) fail("Task verification decision digest mismatch.");
  return value;
}

export function parseTaskVerificationAttempt(value) {
  closed(value, ["schemaVersion", "id", "sequence", "workId", "roundId", "sourceAttemptId", "checkId", "descriptor", "cwd", "authorityDigest", "contextDigest", "status", "startedAt", "completedAt", "durationMs", "exitCode", "signal", "failureCategory", "retryOf", "before", "after", "stdout", "stderr"]);
  if (value.schemaVersion !== 2 || !/^verification-[a-f0-9-]{36}$/u.test(value.id) || !UUID.test(value.workId) || !UUID.test(value.roundId) || !Number.isSafeInteger(value.sequence) || value.sequence < 1) fail("Unsupported task physical attempt.");
  if (!["started", "completed", "failed", "interrupted"].includes(value.status) || !HASH.test(value.authorityDigest) || !HASH.test(value.contextDigest) || typeof value.cwd !== "string" || !path.isAbsolute(value.cwd)) fail("Invalid task physical facts.");
  closed(value.descriptor, ["relativePath", "sha256", "checkId"]);
  if (!HASH.test(value.descriptor.sha256) || value.descriptor.checkId !== value.checkId) fail("Invalid physical descriptor reference.");
  reference({ relativePath: value.descriptor.relativePath, sha256: value.descriptor.sha256 });
  if (typeof value.sourceAttemptId !== "string" || value.sourceAttemptId.length > 200 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value.checkId) || !Number.isFinite(Date.parse(value.startedAt)) || /[\x00-\x1f\x7f]/u.test(value.cwd) || value.cwd.length > 4096) fail("Invalid bounded physical metadata.");
  if (![null, "command_exit", "process_start", "timeout", "output_limit", "runner_failure"].includes(value.failureCategory) || (value.exitCode !== null && (!Number.isSafeInteger(value.exitCode) || value.exitCode < 0 || value.exitCode > 255)) || (value.signal !== null && !/^SIG[A-Z0-9]{1,20}$/u.test(value.signal))) fail("Invalid physical outcome.");
  if (value.durationMs !== null && (!Number.isSafeInteger(value.durationMs) || value.durationMs < 0)) fail("Invalid physical duration.");
  captureRecord(value.before); if (value.after !== null) captureRecord(value.after);
  for (const ref of [value.stdout, value.stderr]) {
    if (ref !== null) reference(ref);
  }
  if (value.status === "started" ? value.completedAt !== null || value.exitCode !== null || value.after !== null : !Number.isFinite(Date.parse(value.completedAt))) fail("Invalid physical terminal state.");
  if (value.status === "completed" && (value.exitCode !== 0 || value.signal !== null || value.failureCategory !== null)) fail("Successful physical result requires a clean zero exit.");
  return value;
}

export async function readTaskVerificationAttempts(input, repairOrigins = false) {
  const base = `${storage(input)}/attempts`;
  const target = await safePath(input.repoRoot, base, { directory: true, missing: true });
  let entries;
  try { entries = await readdir(target); } catch (error) { if (error.code === "ENOENT") return []; throw error; }
  if (entries.length > 20000) fail("Task evidence inventory exceeds its bound.");
  const records = new Map(); const starts = new Map(); const finishes = new Map();
  for (const name of entries.sort()) {
    if (!/^\d{6}-verification-[a-f0-9-]{36}\.(?:start|finish)\.json$/u.test(name)) fail("Unknown task physical evidence.");
    const item = parseTaskVerificationAttempt(await readJson(input.repoRoot, `${base}/${name}`));
    if (name !== `${String(item.sequence).padStart(6, "0")}-${item.id}.${item.status === "started" ? "start" : "finish"}.json` || item.workId !== input.workId) fail("Task physical filename or work mismatch.");
    (item.status === "started" ? starts : finishes).set(item.id, item);
    const prior = records.get(item.id);
    if (!prior || item.status !== "started") records.set(item.id, item);
  }
  for (const [id, start] of starts) {
    let origin = await readJson(input.repoRoot, `${storage(input)}/origins/${id}.start.json`, true);
    if (origin === null && repairOrigins && await intact(input, start.descriptor)) {
      const physical = await publish(input, `attempts/${String(start.sequence).padStart(6, "0")}-${id}.start.json`, start);
      origin = { schema: "banzai-verification-origin-start/v2", schemaVersion: 2, workId: input.workId, attemptId: id, decision: { relativePath: start.descriptor.relativePath, sha256: start.descriptor.sha256 }, physical, before: start.before };
      await publish(input, `origins/${id}.start.json`, origin);
    }
    if (origin === null && !finishes.has(id) && await intact(input, start.descriptor)) continue;
    closed(origin, ["schema", "schemaVersion", "workId", "attemptId", "decision", "physical", "before"]);
    const expected = `${base}/${String(start.sequence).padStart(6, "0")}-${id}.start.json`;
    if (origin.schema !== "banzai-verification-origin-start/v2" || origin.schemaVersion !== 2 || origin.workId !== input.workId || origin.attemptId !== id || origin.physical.relativePath !== expected || origin.decision.relativePath !== start.descriptor.relativePath || origin.decision.sha256 !== start.descriptor.sha256 || !await intact(input, origin.physical) || !await intact(input, origin.decision) || JSON.stringify(origin.before) !== JSON.stringify(start.before)) fail("Task physical start origin is incomplete.");
  }
  for (const [id, finish] of finishes) {
    const start = starts.get(id);
    if (!start) fail("Terminal task attempt has no physical start.");
    const identity = ({ status, completedAt, durationMs, exitCode, signal, failureCategory, after, stdout, stderr, ...rest }) => rest;
    if (JSON.stringify(identity(start)) !== JSON.stringify(identity(finish))) fail("Physical task identity changed after start.");
    let origin = await readJson(input.repoRoot, `${storage(input)}/origins/${id}.finish.json`, true);
    if (origin === null && repairOrigins) {
      const stem = `${String(start.sequence).padStart(6, "0")}-${id}`;
      const startRef = await publish(input, `attempts/${stem}.start.json`, start);
      const physical = await publish(input, `attempts/${stem}.finish.json`, finish);
      origin = { schema: "banzai-verification-origin-finish/v2", schemaVersion: 2, workId: input.workId, attemptId: id, start: startRef, physical, after: finish.after };
      await publish(input, `origins/${id}.finish.json`, origin);
    }
    closed(origin, ["schema", "schemaVersion", "workId", "attemptId", "start", "physical", "after"]);
    if (origin.schema !== "banzai-verification-origin-finish/v2" || origin.schemaVersion !== 2 || origin.workId !== input.workId || origin.attemptId !== id || origin.start.relativePath !== `${base}/${String(start.sequence).padStart(6, "0")}-${id}.start.json` || origin.physical.relativePath !== `${base}/${String(finish.sequence).padStart(6, "0")}-${id}.finish.json` || !await intact(input, origin.start) || !await intact(input, origin.physical) || JSON.stringify(origin.after) !== JSON.stringify(finish.after)) fail("Task physical origin chain is incomplete.");
  }
  const result = [...records.values()].sort((a, b) => a.sequence - b.sequence);
  if (new Set(result.map((item) => item.sequence)).size !== result.length) fail("Duplicate physical task sequence.");
  return result;
}

async function intact(input, reference) {
  if (!reference || !reference.relativePath.startsWith(storage(input) + "/")) return false;
  const bytes = await readBytes(input.repoRoot, reference.relativePath, { optional: true, limit: 20 * 1024 * 1024 });
  return bytes !== null && evidenceDigest(bytes) === reference.sha256;
}

export async function taskVerificationApplicability(input, decision, attempts, current) {
  parseTaskVerificationDecision(decision);
  const dispositions = [];
  for (const item of decision.checks) {
    const latest = attempts.filter((attempt) => attempt.checkId === item.descriptor.id).at(-1);
    let kind = "not_run"; let reason = "No physical attempt.";
    if (latest) {
      kind = latest.failureCategory === "timeout" ? "timed_out" : latest.failureCategory === "process_start" ? "unavailable" : latest.status === "started" ? "unavailable" : latest.status === "interrupted" ? "interrupted" : latest.status === "failed" ? "failed" : "unavailable";
      reason = latest.failureCategory === "process_start" ? "The executable could not be started." : latest.failureCategory === "timeout" ? "The check exceeded its execution time limit." : latest.status === "started" ? "A retained attempt has no terminal result." : "Latest physical attempt does not establish applicable success.";
      if (latest.status === "completed" && (current.observedDigest === null || latest.before.observedDigest === null || latest.after?.observedDigest === null)) reason = "The command succeeded, but its input snapshot is unavailable. Resolve unreadable, unsupported or over-budget inputs, then retry verification without replaying implementation.";
      if (latest.status === "completed" && latest.contextDigest === evidenceDigest(decision.context) && await intact(input, latest.descriptor) && await intact(input, latest.stdout) && await intact(input, latest.stderr)) {
        const original = parseTaskVerificationDecision(await readJson(input.repoRoot, latest.descriptor.relativePath));
        const originalCheck = original.checks.find((entry) => entry.descriptor.id === item.descriptor.id);
        const authorityScope = ({sourceAttemptId, ...scope}) => scope;
        const sameAuthority = latest.authorityDigest === evidenceDigest(original.authority) && evidenceDigest(authorityScope(original.authority)) === evidenceDigest(authorityScope(decision.authority));
        const sameDescriptor = evidenceDigest(originalCheck?.descriptor) === evidenceDigest(item.descriptor);
        const observationsMatch = current.observedDigest !== null && current.observedDigest === latest.before.observedDigest && current.observedDigest === latest.after?.observedDigest;
        const reusable = item.descriptor.evidence === "equivalent_evidence" && ![item.descriptor.command, ...item.descriptor.args].some((arg) => arg.includes("release:check")) && current.complete && latest.before.complete && latest.after?.complete && JSON.stringify(current.reusable.checks) === JSON.stringify(latest.before.reusable.checks) && JSON.stringify(current.reusable.checks) === JSON.stringify(latest.after.reusable.checks);
        if (sameAuthority && sameDescriptor && original.policyDigest === decision.policyDigest && ((latest.roundId === decision.roundId && observationsMatch) || (latest.roundId !== decision.roundId && reusable))) { kind = latest.roundId === decision.roundId ? "passed" : "reused"; reason = "Direct successful physical origin with matching observed inputs."; }
      }
    }
    dispositions.push({ checkId: item.descriptor.id, required: item.required, kind, reason, attemptId: latest?.id ?? null });
  }
  const body = { schema: "banzai-verification-applicability/v2", schemaVersion: 2, workId: input.workId, roundId: decision.roundId, decisionSha256: decision.sha256, observedDigest: current.observedDigest,
    complete: dispositions.every((item) => ["passed", "reused"].includes(item.kind)), outcome: dispositions.length ? "checked" : "absent", absenceReason: decision.absenceReason, dispositions };
  return { ...body, sha256: evidenceDigest(body) };
}

/** Owner supplies authority, context, storage, launch and live revalidation callbacks. */
export async function executeTaskVerification(input) {
  const { selection, authority, context, policy, roundId, revalidate, invoke } = input;
  storage(input);
  await revalidate();
  await publish(input, "ledger.json", { schemaVersion: 3 });
  let attempts = await readTaskVerificationAttempts(input, input.recoverInterrupted === true);
  // Reused identities do not establish that their existing evidence is still private.
  for (const attempt of attempts) {
    const stem = `${String(attempt.sequence).padStart(6, "0")}-${attempt.id}`;
    const suffixes = [`attempts/${stem}.start.json`, `origins/${attempt.id}.start.json`];
    if (attempt.status !== "started") suffixes.push(`attempts/${stem}.finish.json`, `origins/${attempt.id}.finish.json`);
    const paths = [...suffixes.map(suffix => `${storage(input)}/${suffix}`),
      ...[attempt.descriptor, attempt.stdout, attempt.stderr].filter(Boolean).map(reference => reference.relativePath)];
    for (const relative of paths) await verifyExecutionIgnore(input.repoRoot, relative);
  }
  if (!input.recoverInterrupted && attempts.some(item => item.status === "started")) fail("Task verification retains an unresolved attempt; owner recovery is required before another round.");
  if (input.retryOf !== undefined && !attempts.some(item => item.id === input.retryOf && item.roundId === roundId && ["failed", "interrupted"].includes(item.status) && selection.checks.some(check => check.descriptor.id === item.checkId))) fail("Retry must identify an unsuccessful check in this exact task round.");
  const descriptors = selection.checks.map((item) => item.descriptor);
  const capture = () => captureTaskVerificationInputs(input, descriptors, policy);
  if (input.recoverInterrupted) {
    for (const start of attempts.filter(item => item.roundId === roundId && item.status === "started")) {
      await revalidate();
      const stem = `${String(start.sequence).padStart(6, "0")}-${start.id}`;
      const startRef = await publish(input, `attempts/${stem}.start.json`, start);
      const decisionRef = { relativePath: start.descriptor.relativePath, sha256: start.descriptor.sha256 };
      await publish(input, `origins/${start.id}.start.json`, { schema: "banzai-verification-origin-start/v2", schemaVersion: 2, workId: input.workId, attemptId: start.id, decision: decisionRef, physical: startRef, before: start.before });
      const after = await capture();
      const terminal = parseTaskVerificationAttempt({ ...start, status: "interrupted", completedAt: new Date().toISOString(), durationMs: null, failureCategory: "runner_failure", after });
      const physical = await publish(input, `attempts/${stem}.finish.json`, terminal);
      await publish(input, `origins/${start.id}.finish.json`, { schema: "banzai-verification-origin-finish/v2", schemaVersion: 2, workId: input.workId, attemptId: start.id, start: startRef, physical, after });
    }
    attempts = await readTaskVerificationAttempts(input);
  }
  const before = await capture();
  const body = { schema: "banzai-verification-decision/v2", schemaVersion: 2, workId: input.workId, roundId, sourceAttemptId: authority.sourceAttemptId, authority, context, policyDigest: policy ? evidenceDigest(policy) : null, ...selection, before };
  const decision = parseTaskVerificationDecision({ ...body, sha256: evidenceDigest(body) });
  const decisionRef = await publish(input, `decisions/${decision.sha256}.json`, decision);
  for (const item of selection.checks) {
    const previous = attempts.filter((attempt) => attempt.checkId === item.descriptor.id).at(-1);
    const applicability = await taskVerificationApplicability(input, decision, attempts, await capture());
    if (["passed", "reused"].includes(applicability.dispositions.find((entry) => entry.checkId === item.descriptor.id)?.kind)) continue;
    if (previous?.roundId === roundId && (previous.status === "started" || (previous.status === "interrupted" ? !input.recoverInterrupted && previous.id !== input.retryOf : previous.status === "failed" && previous.id !== input.retryOf))) fail("Task verification retains an unresolved attempt; use its explicit retry or recovery action.");
    await revalidate();
    const authorized = await authorizeTaskVerification({ repoRoot: input.repoRoot, descriptor: item.descriptor, authority, context, policy, required: item.required });
    const current = await capture();
    if (before.observedDigest !== null && current.observedDigest !== before.observedDigest) {
      const changes = observedChanges(before, current);
      fail(`Task inputs changed between selection and launch${changes ? `: ${changes}` : ""}.`);
    }
    const attempt = parseTaskVerificationAttempt({ schemaVersion: 2, id: `verification-${randomUUID()}`, sequence: (attempts.at(-1)?.sequence ?? 0) + 1, workId: input.workId, roundId, sourceAttemptId: authority.sourceAttemptId, checkId: item.descriptor.id,
      descriptor: { ...decisionRef, checkId: item.descriptor.id }, cwd: authorized.cwd, authorityDigest: authorized.authorityDigest, contextDigest: authorized.contextDigest,
      status: "started", startedAt: new Date().toISOString(), completedAt: null, durationMs: null, exitCode: null, signal: null, failureCategory: null, retryOf: previous?.id ?? null, before: current, after: null, stdout: null, stderr: null });
    const stem = `${String(attempt.sequence).padStart(6, "0")}-${attempt.id}`;
    await verifyExecutionIgnore(input.repoRoot, `${storage(input)}/logs/${attempt.id}.stdout.log`);
    await verifyExecutionIgnore(input.repoRoot, `${storage(input)}/logs/${attempt.id}.stderr.log`);
    const start = await publish(input, `attempts/${stem}.start.json`, attempt);
    await publish(input, `origins/${attempt.id}.start.json`, { schema: "banzai-verification-origin-start/v2", schemaVersion: 2, workId: input.workId, attemptId: attempt.id, decision: decisionRef, physical: start, before: current });
    // A failed start is an observation too. The owner maps its process exceptions.
    const result = await invoke(authorized.descriptor, authorized.cwd);
    const after = await capture();
    const stdout = await publish(input, `logs/${attempt.id}.stdout.log`, redact(result.stdout));
    const stderr = await publish(input, `logs/${attempt.id}.stderr.log`, redact(result.stderr));
    const terminal = parseTaskVerificationAttempt({ ...attempt, status: result.status, completedAt: result.completedAt, durationMs: Math.max(0, Date.parse(result.completedAt) - Date.parse(attempt.startedAt)), exitCode: result.exitCode, signal: result.signal, failureCategory: result.failureCategory, after, stdout, stderr });
    const physical = await publish(input, `attempts/${stem}.finish.json`, terminal);
    await publish(input, `origins/${attempt.id}.finish.json`, { schema: "banzai-verification-origin-finish/v2", schemaVersion: 2, workId: input.workId, attemptId: attempt.id, start, physical, after });
    attempts = await readTaskVerificationAttempts(input);
    // Evidence requires unchanged observed inputs, so a check that writes project
    // files can never pass; name the paths and the remedy at the source.
    if (terminal.status === "completed" && current.observedDigest !== null && after.observedDigest !== null && after.observedDigest !== current.observedDigest)
      fail(`Check ${JSON.stringify(item.descriptor.id)} changed observed project files: ${observedChanges(current, after) ?? "paths unavailable"}. Keep generated output Git-ignored (.gitignore) or make the check leave project files unchanged, then retry verification.`);
    if (terminal.status !== "completed") break;
  }
  await revalidate();
  for (const item of selection.checks) await authorizeTaskVerification({ repoRoot: input.repoRoot, descriptor: item.descriptor, authority, context, policy, required: item.required });
  const applicability = await taskVerificationApplicability(input, decision, attempts, await capture());
  const application = await publish(input, `applications/${applicability.sha256}.json`, applicability);
  return { decision, applicability, attempts, references: { decision: decisionRef, applicability: application } };
}

/** Closed frozen/state projection; physical bytes are revalidated before execution/review. */
export function parseTaskVerificationPublication(value) {
  closed(value, ["decision", "applicability", "attempts", "references"]);
  const decision = parseTaskVerificationDecision(value.decision);
  const application = value.applicability;
  closed(application, ["schema", "schemaVersion", "workId", "roundId", "decisionSha256", "observedDigest", "complete", "outcome", "absenceReason", "dispositions", "sha256"]);
  const { sha256, ...body } = application;
  if (application.schema !== "banzai-verification-applicability/v2" || application.schemaVersion !== 2 || sha256 !== evidenceDigest(body) || application.workId !== decision.workId || application.roundId !== decision.roundId || application.decisionSha256 !== decision.sha256 || (application.observedDigest !== null && !HASH.test(application.observedDigest)) || application.absenceReason !== decision.absenceReason || application.outcome !== (decision.checks.length ? "checked" : "absent") || !Array.isArray(application.dispositions) || application.dispositions.length !== decision.checks.length) fail("Invalid task applicability projection.");
  if (!Array.isArray(value.attempts) || value.attempts.length > 10000) fail("Unbounded task attempts.");
  const attempts = value.attempts.map(parseTaskVerificationAttempt);
  if (new Set(attempts.map(item => item.id)).size !== attempts.length || attempts.some(item => item.workId !== decision.workId)) fail("Conflicting task attempts.");
  for (const [index, disposition] of application.dispositions.entries()) {
    closed(disposition, ["checkId", "required", "kind", "reason", "attemptId"]);
    const check = decision.checks[index];
    if (disposition.checkId !== check.descriptor.id || disposition.required !== check.required || !["not_run", "unavailable", "interrupted", "timed_out", "failed", "passed", "reused"].includes(disposition.kind) || typeof disposition.reason !== "string" || disposition.reason.length > 2000) fail("Invalid task disposition.");
    const physical = attempts.find(item => item.id === disposition.attemptId);
    if (disposition.attemptId !== null && (!physical || physical.checkId !== disposition.checkId)) fail("Missing direct task attempt.");
    if (["passed", "reused"].includes(disposition.kind) && physical?.status !== "completed") fail("Task success has no physical success.");
  }
  if (application.complete !== application.dispositions.every(item => ["passed", "reused"].includes(item.kind))) fail("Task completeness contradicts dispositions.");
  closed(value.references, ["decision", "applicability"]);
  for (const [name, ref] of Object.entries(value.references)) {
    reference(ref);
    const record = name === "decision" ? decision : application;
    if (ref.sha256 !== evidenceDigest(JSON.stringify(record, null, 2) + "\n")) fail("Task publication reference mismatch.");
  }
  return value;
}
