// Bound evidence storage shared by the runner and plugin-only helper.
import path from "node:path";
import { readdir } from "node:fs/promises";
import { safePath, readBytes, readJson, makeDirectories, publishNew, verifyExecutionIgnore } from "./project-files.mjs";
import { parseVerificationAttemptRecord } from "./artifact-readers.mjs";
import { evidenceDigest, parseVerificationDecision, sameVerificationCapture, VerificationEvidenceError } from "./verification-evidence.mjs";

const invalid = (message) => { throw new VerificationEvidenceError(message); };
const HASH = /^[a-f0-9]{64}$/u;
function directory(input) {
  if (!/^\.banzai\/(?:work\/[a-f0-9-]{36}|runs\/[a-z0-9][a-z0-9.-]{0,199})\/verification$/u.test(input.directory) ||
      !/^[a-f0-9-]{36}$/u.test(input.workId)) invalid("Invalid verification storage identity.");
  return input.directory;
}
function closed(value, fields) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...fields].sort())) invalid("Invalid persisted verification fields.");
}
function capture(value) {
  closed(value, ["complete", "reason", "candidateDigest", "checks"]);
  if (typeof value.complete !== "boolean" || !Array.isArray(value.checks) || value.checks.length > 10000 ||
      (value.complete ? !HASH.test(value.candidateDigest) || value.reason !== null : value.candidateDigest !== null || value.checks.length !== 0 ||
      !["inputs_unavailable", "policy_disabled"].includes(value.reason))) invalid("Invalid persisted verification capture.");
  const seen = new Set();
  for (const check of value.checks) {
    closed(check, ["checkId", "executable", "environmentDigest", "inputDigest"]);
    if (typeof check.checkId !== "string" || seen.has(check.checkId) || typeof check.executable !== "string" ||
        !path.isAbsolute(check.executable) || !HASH.test(check.environmentDigest) || !HASH.test(check.inputDigest)) invalid("Invalid captured check.");
    seen.add(check.checkId);
  }
  return value;
}
export function parseVerificationOriginStart(value) {
  closed(value, ["schema", "schemaVersion", "workId", "attemptId", "checkId", "decision", "before", "physicalPath"]);
  if (value.schema !== "banzai-verification-origin-start/v1" || value.schemaVersion !== 1 ||
      !/^verification-[a-f0-9-]{36}$/u.test(value.attemptId)) invalid("Invalid verification origin start.");
  if (typeof value.physicalPath !== "string" || !/^\.banzai\/(?:runs\/[a-z0-9][a-z0-9.-]{0,199}\/verification-attempts|work\/[a-f0-9-]{36}\/verification\/attempts)\/verification-\d{6}-verification-[a-f0-9-]{36}\.json$/u.test(value.physicalPath)) invalid("Invalid physical origin path.");
  const decision = parseVerificationDecision(value.decision);
  if (decision.workId !== value.workId || !decision.actions.some((action) => action.checkId === value.checkId && action.action === "execute")) invalid("Origin must reference an executed decision.");
  capture(value.before);
  if (value.before.candidateDigest !== decision.candidateDigest) invalid("Origin capture differs from its decision.");
  return value;
}
export function parseVerificationOriginFinish(value) {
  closed(value, ["schema", "schemaVersion", "workId", "attemptId", "startSha256", "physicalSha256", "after"]);
  if (value.schema !== "banzai-verification-origin-finish/v1" || value.schemaVersion !== 1 ||
      !/^verification-[a-f0-9-]{36}$/u.test(value.attemptId) || !HASH.test(value.startSha256) || !HASH.test(value.physicalSha256)) invalid("Invalid verification origin finish.");
  capture(value.after);
  return value;
}

export async function publishVerificationEvidence(input, relative, value) {
  const base = directory(input);
  if (!/^(?:decisions\/[a-f0-9]{64}|origins\/verification-[a-f0-9-]{36}\.(?:start|finish)|applications\/[a-f0-9]{64})\.json$/u.test(relative)) invalid("Invalid verification evidence path.");
  const bytes = JSON.stringify(value, null, 2) + "\n";
  const target = `${base}/${relative}`;
  await verifyExecutionIgnore(input.repoRoot, target);
  await makeDirectories(input.repoRoot, path.posix.dirname(target));
  const existing = await readBytes(input.repoRoot, target, { optional: true, limit: 16 * 1024 * 1024 });
  if (existing !== null) {
    if (existing.toString("utf8") !== bytes) invalid("Immutable verification evidence conflicts.");
    return { relativePath: target, sha256: evidenceDigest(bytes) };
  }
  await publishNew(input.repoRoot, target, bytes);
  return { relativePath: target, sha256: evidenceDigest(bytes) };
}

export async function persistVerificationDecision(input, decision) {
  const value = parseVerificationDecision(decision);
  if (value.workId !== input.workId) invalid("Cross-work verification decision.");
  return publishVerificationEvidence(input, `decisions/${value.sha256}.json`, value);
}

export async function persistVerificationOriginStart(input, attempt, decision, before) {
  parseVerificationAttemptRecord(attempt);
  if (attempt.status !== "started") invalid("Origin capture must precede invocation.");
  const action = decision.actions.find((item) => item.identity.profileOrdinal === attempt.command.profileOrdinal && item.identity.commandOrdinal === attempt.command.commandOrdinal);
  if (!action || action.action !== "execute" || attempt.round.id !== decision.roundId) invalid("Physical start is outside its decision.");
  const value = parseVerificationOriginStart({ schema: "banzai-verification-origin-start/v1", schemaVersion: 1,
    workId: input.workId, attemptId: attempt.id, checkId: action.checkId, decision, before,
    physicalPath: `${input.directory.startsWith(".banzai/runs/") ? path.posix.dirname(input.directory) + "/verification-attempts" : input.directory + "/attempts"}/verification-${String(attempt.sequence).padStart(6, "0")}-${attempt.id}.json` });
  return publishVerificationEvidence(input, `origins/${attempt.id}.start.json`, value);
}

export async function persistVerificationOriginFinish(input, attempt, after) {
  parseVerificationAttemptRecord(attempt);
  if (attempt.status === "started") invalid("Physical origin is not terminal.");
  const bytes = await readBytes(input.repoRoot, `${directory(input)}/origins/${attempt.id}.start.json`, { limit: 16 * 1024 * 1024 });
  const start = parseVerificationOriginStart(JSON.parse(bytes));
  if (start.workId !== input.workId) invalid("Cross-work origin finish.");
  const value = parseVerificationOriginFinish({ schema: "banzai-verification-origin-finish/v1", schemaVersion: 1,
    workId: input.workId, attemptId: attempt.id, startSha256: evidenceDigest(bytes), physicalSha256: evidenceDigest(attempt), after });
  return publishVerificationEvidence(input, `origins/${attempt.id}.finish.json`, value);
}

/** Reads the physical leaves and logs themselves; provenance is never imported. */
export async function readVerificationOrigins(input, attempts) {
  directory(input);
  const origins = [];
  let sequence = 0; const ids = new Set();
  for (const attempt of attempts) {
    parseVerificationAttemptRecord(attempt);
    if (attempt.sequence <= sequence || ids.has(attempt.id)) invalid("Physical verification sequence conflict.");
    sequence = attempt.sequence; ids.add(attempt.id);
    const startBytes = await readBytes(input.repoRoot, `${input.directory}/origins/${attempt.id}.start.json`, { optional: true, limit: 16 * 1024 * 1024 });
    if (startBytes === null) {
      // An unproven later physical start must still suppress a prior success.
      for (const previous of origins.filter((origin) => origin.identity.profileOrdinal === attempt.command.profileOrdinal && origin.identity.commandOrdinal === attempt.command.commandOrdinal))
        previous.complete = false;
      continue;
    }
    const start = parseVerificationOriginStart(JSON.parse(startBytes));
    const expectedPhysical = `${input.directory.startsWith(".banzai/runs/") ? path.posix.dirname(input.directory) + "/verification-attempts" : input.directory + "/attempts"}/verification-${String(attempt.sequence).padStart(6, "0")}-${attempt.id}.json`;
    if (start.physicalPath !== expectedPhysical) invalid("Physical origin escaped its evidence owner.");
    if (start.workId !== input.workId || start.attemptId !== attempt.id || start.decision.roundId !== attempt.round.id) invalid("Cross-work verification origin.");
    const identity = start.decision.actions.find((action) => action.checkId === start.checkId).identity;
    if (identity.profileOrdinal !== attempt.command.profileOrdinal || identity.commandOrdinal !== attempt.command.commandOrdinal) invalid("Origin command identity mismatch.");
    const finishBytes = await readBytes(input.repoRoot, `${input.directory}/origins/${attempt.id}.finish.json`, { optional: true, limit: 16 * 1024 * 1024 });
    const finish = finishBytes === null ? null : parseVerificationOriginFinish(JSON.parse(finishBytes));
    if (finish && (finish.workId !== input.workId || finish.attemptId !== attempt.id || finish.startSha256 !== evidenceDigest(startBytes) || finish.physicalSha256 !== evidenceDigest(attempt))) invalid("Changed physical verification origin.");
    let logsIntact = true;
    for (const log of [attempt.stdout, attempt.stderr]) {
      if (log === null) { logsIntact = false; continue; }
      const bytes = await readBytes(input.repoRoot, `${path.posix.dirname(input.directory)}/${log.relativePath}`, { optional: true, limit: 16 * 1024 * 1024 });
      if (bytes === null || evidenceDigest(bytes) !== log.sha256) logsIntact = false;
    }
    const after = finish?.after ?? { complete: false, reason: "inputs_unavailable", candidateDigest: null, checks: [] };
    origins.push({ workId: input.workId, checkId: start.checkId, attemptId: attempt.id, roundId: attempt.round.id,
      recordDigest: evidenceDigest(attempt), status: attempt.status, exitCode: attempt.exitCode, signal: attempt.signal,
      failureCategory: attempt.failureCategory, complete: finish !== null && (sameVerificationCapture(start.before, after) || !start.before.complete && !after.complete),
      logsIntact, identity, before: start.before, after });
  }
  return origins;
}

export async function readVerificationDecisions(input) {
  const relative = `${directory(input)}/decisions`;
  const target = await safePath(input.repoRoot, relative, { directory: true, missing: true });
  let entries;
  try { entries = await readdir(target); } catch (error) { if (error.code === "ENOENT") return []; throw error; }
  if (entries.length > 10000) invalid("Verification decision inventory exceeded its bound.");
  const decisions = [];
  for (const entry of entries.sort()) {
    if (!/^[a-f0-9]{64}\.json$/u.test(entry)) invalid("Unknown verification decision evidence.");
    const decision = parseVerificationDecision(await readJson(input.repoRoot, `${relative}/${entry}`));
    if (decision.workId !== input.workId || entry !== `${decision.sha256}.json`) invalid("Verification decision identity mismatch.");
    decisions.push(decision);
  }
  return decisions;
}

export function verificationApplicability(decision, origins, current) {
  parseVerificationDecision(decision); capture(current);
  // Missing captures preserve physical history, but cannot establish current
  // applicability: equal null digests are not evidence of unchanged inputs.
  const drift = !current.complete || decision.candidateDigest !== current.candidateDigest;
  const dispositions = decision.actions.map((action) => {
    const origin = action.action === "reuse"
      ? origins.find((item) => item.attemptId === action.origin.attemptId && item.recordDigest === action.origin.recordDigest)
      : origins.filter((item) => item.roundId === decision.roundId && item.checkId === action.checkId).at(-1);
    const latest = origins.filter((item) => item.checkId === action.checkId).at(-1);
    let valid = !drift && origin && origin.complete && origin === latest && origin.workId === decision.workId &&
      origin.status === "completed" && origin.exitCode === 0 && origin.signal === null && origin.failureCategory === null && origin.logsIntact &&
      JSON.stringify(origin.identity) === JSON.stringify(action.identity);
    if (action.action === "reuse") {
      const input = current.checks.find((item) => item.checkId === action.checkId);
      const prior = origin?.before.checks.find((item) => item.checkId === action.checkId);
      valid = valid && origin.complete && current.complete && prior && input && prior.inputDigest === input.inputDigest && prior.environmentDigest === input.environmentDigest;
    } else if (origin?.before.complete || origin?.after.complete) {
      valid = valid && origin.complete && origin.before.candidateDigest === current.candidateDigest;
    }
    return { checkId: action.checkId, kind: valid ? (action.action === "reuse" ? "reused" : "executed") : "pending",
      origin: valid ? { attemptId: origin.attemptId, recordDigest: origin.recordDigest, roundId: origin.roundId } : null };
  });
  const body = { schema: "banzai-verification-applicability/v1", schemaVersion: 1, workId: decision.workId,
    roundId: decision.roundId, decisionSha256: decision.sha256, candidateDigest: current.candidateDigest,
    complete: dispositions.length > 0 && dispositions.every((item) => item.kind !== "pending"), dispositions };
  return { ...body, sha256: evidenceDigest(body) };
}

export function parseVerificationApplicability(value) {
  closed(value, ["schema", "schemaVersion", "workId", "roundId", "decisionSha256", "candidateDigest", "complete", "dispositions", "sha256"]);
  if (value.schema !== "banzai-verification-applicability/v1" || value.schemaVersion !== 1 || !HASH.test(value.decisionSha256) ||
      !Array.isArray(value.dispositions) || value.dispositions.length > 10000 || (value.candidateDigest !== null && !HASH.test(value.candidateDigest))) invalid("Invalid verification applicability.");
  const seen = new Set();
  for (const item of value.dispositions) {
    closed(item, ["checkId", "kind", "origin"]);
    if (typeof item.checkId !== "string" || seen.has(item.checkId) || !["executed", "reused", "pending"].includes(item.kind)) invalid("Invalid verification applicability disposition.");
    seen.add(item.checkId);
    if (item.kind === "pending") { if (item.origin !== null) invalid("Pending checks cannot claim origin evidence."); }
    else {
      closed(item.origin, ["attemptId", "recordDigest", "roundId"]);
      if (!/^verification-[a-f0-9-]{36}$/u.test(item.origin.attemptId) || !HASH.test(item.origin.recordDigest) || typeof item.origin.roundId !== "string") invalid("Invalid applicability origin.");
    }
  }
  if (value.complete !== (value.dispositions.length > 0 && value.dispositions.every((item) => item.kind !== "pending"))) invalid("Invalid applicability completion.");
  const { sha256, ...body } = value;
  if (sha256 !== evidenceDigest(body)) invalid("Verification applicability digest mismatch.");
  return value;
}

export async function persistVerificationApplicability(input, applicability) {
  const value = parseVerificationApplicability(applicability);
  if (value.workId !== input.workId) invalid("Cross-work verification applicability.");
  return publishVerificationEvidence(input, `applications/${value.sha256}.json`, value);
}

export function parseReviewVerificationEvidence(value) {
  closed(value, ["decision", "applicability", "origins", "attempts"]);
  const decision = parseVerificationDecision(value.decision);
  const applicability = parseVerificationApplicability(value.applicability);
  if (applicability.decisionSha256 !== decision.sha256 || applicability.workId !== decision.workId || applicability.roundId !== decision.roundId ||
      !Array.isArray(value.origins) || !Array.isArray(value.attempts) || value.origins.length > 10000 || value.attempts.length !== value.origins.length) invalid("Invalid frozen verification closure.");
  const ids = new Set();
  for (const [index, origin] of value.origins.entries()) {
    closed(origin, ["workId", "checkId", "attemptId", "roundId", "recordDigest", "status", "exitCode", "signal", "failureCategory", "complete", "logsIntact", "identity", "before", "after"]);
    const attempt = parseVerificationAttemptRecord(value.attempts[index]);
    capture(origin.before); capture(origin.after);
    if (ids.has(origin.attemptId) || origin.workId !== decision.workId || origin.attemptId !== attempt.id || origin.roundId !== attempt.round.id ||
        origin.recordDigest !== evidenceDigest(attempt) || origin.status !== attempt.status || origin.exitCode !== attempt.exitCode || origin.signal !== attempt.signal ||
        origin.failureCategory !== attempt.failureCategory || typeof origin.complete !== "boolean" || typeof origin.logsIntact !== "boolean" ||
        origin.complete && (origin.before.complete || origin.after.complete) && !sameVerificationCapture(origin.before, origin.after)) invalid("Frozen physical verification origin mismatch.");
    ids.add(origin.attemptId);
  }
  for (const [index, disposition] of applicability.dispositions.entries()) {
    const action = decision.actions[index];
    if (!action || disposition.checkId !== action.checkId) invalid("Frozen check order mismatch.");
    if (disposition.kind === "pending") continue;
    const origin = value.origins.find((item) => item.attemptId === disposition.origin.attemptId);
    if (!origin || origin.recordDigest !== disposition.origin.recordDigest || origin.checkId !== disposition.checkId ||
        origin.status !== "completed" || origin.exitCode !== 0 || origin.signal !== null || origin.failureCategory !== null || !origin.logsIntact ||
        JSON.stringify(origin.identity) !== JSON.stringify(action.identity) ||
        (disposition.kind === "reused" && (action.action !== "reuse" || !origin.complete || JSON.stringify(disposition.origin) !== JSON.stringify(action.origin))) ||
        (disposition.kind === "executed" && (action.action !== "execute" || origin.roundId !== decision.roundId))) invalid("Frozen applicability lacks its direct successful origin.");
  }
  if (applicability.dispositions.length !== decision.actions.length) invalid("Incomplete frozen check inventory.");
  return value;
}
