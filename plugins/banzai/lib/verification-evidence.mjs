// Canonical deterministic evidence decisions for standalone and runner owners.
// No model, store, workflow or CLI dependency is permitted here.
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";

const HASH = /^[a-f0-9]{64}$/u;
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const MAX_FILES = 50000;
const SECRET_PATH = /(?:^|\/)(?:\.env(?:\.[^/]*)?|credentials(?:\.[^/]*)?|secrets?(?:\.[^/]*)?|id_(?:rsa|ed25519)|[^/]*\.(?:pem|p12|pfx))$/iu;
const MAX_BYTES = 512 * 1024 * 1024;
const PROJECT_TYPES = ["repository", "node", "php", "python", "go", "rust", "ruby", "jvm", "dotnet", "custom"];
export const VERIFICATION_REASONS = ["policy_disabled", "mandatory_fresh", "obligations_unavailable", "inputs_unavailable", "no_origin", "origin_invalid", "later_attempt", "identity_changed", "inputs_changed", "existing_execution", "equivalent_evidence"];
export class VerificationEvidenceError extends Error {
  constructor(message) { super(message); this.name = "VerificationEvidenceError"; this.code = "VERIFICATION_EVIDENCE_INVALID"; }
}
const invalid = (message) => { throw new VerificationEvidenceError(message); };
export function evidenceDigest(value) {
  return createHash("sha256").update(typeof value === "string" || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest("hex");
}
function object(value, required, optional = []) {
  if (!value || typeof value !== "object" || Array.isArray(value) || required.some((key) => !(key in value)) ||
      Object.keys(value).some((key) => !required.includes(key) && !optional.includes(key))) invalid("Invalid verification object fields.");
  return value;
}
function text(value, limit = 200) {
  if (typeof value !== "string" || value.length === 0 || value.length > limit || /[\x00-\x1f]/u.test(value)) invalid("Invalid verification text.");
  return value;
}
function identifier(value) { if (!ID.test(text(value, 80))) invalid("Invalid verification identifier."); return value; }
function digest(value) { if (typeof value !== "string" || !HASH.test(value)) invalid("Invalid verification digest."); return value; }
function list(value, max = 200) { if (!Array.isArray(value) || value.length > max) invalid("Invalid verification inventory."); return value; }
function relative(value) {
  text(value, 500);
  if (path.posix.isAbsolute(value) || value.includes("\\") || value.split("/").some((part) => !part || part === "." || part === "..")) invalid("Invalid verification relative path.");
  return value;
}
function unique(values) { if (new Set(values).size !== values.length) invalid("Duplicate verification identity."); return values; }
function mode(value) { if (!["fresh", "equivalent_evidence"].includes(value)) invalid("Invalid verification evidence mode."); return value; }

export function parseVerificationPolicy(value) {
  const p = object(value, ["schema", "schemaVersion", "explanatory", "dependencies"]);
  if (p.schema !== "banzai-verification-policy/v1" || p.schemaVersion !== 1) invalid("Unsupported verification policy.");
  const explanatory = list(p.explanatory).map((item) => {
    object(item, ["path", "regions"]);
    relative(item.path);
    // This is an explicit explanatory declaration, never an extension-based waiver.
    if (!item.path.endsWith(".md") || /(?:^|\/)(?:AGENTS|CLAUDE|SKILL)\.md$/u.test(item.path) ||
        /(?:^|\/)(?:policies|phases|guidance|contracts|decisions|test|tests|\.banzai|\.github)\//u.test(item.path)) invalid("Authoritative or executable paths cannot be explanatory.");
    const regions = list(item.regions, 30).map((region) => {
      object(region, ["start", "end"]); text(region.start); text(region.end);
      if (region.start === region.end || !/^<!-- .+ -->$/u.test(region.start) || !/^<!-- .+ -->$/u.test(region.end)) invalid("Explanatory regions require distinct whole-line comment boundaries.");
      return { start: region.start, end: region.end };
    });
    if (/(?:^|\/)(?:PROJECT_MANIFEST|MODULES)\.md$/u.test(item.path) && regions.length === 0) invalid("Mixed project guidance requires explicit explanatory regions.");
    unique(regions.flatMap((region) => [region.start, region.end]));
    return { path: item.path, regions };
  });
  unique(explanatory.map((item) => item.path));
  const d = object(p.dependencies, ["complete", "exclude", "toolchain", "environment", "volatile"]);
  if (typeof d.complete !== "boolean") invalid("Dependency completeness must be explicit.");
  const exclude = unique(list(d.exclude).map(relative));
  if (exclude.some((item) => /(?:^|\/)\.git(?:\/|$)|^\.banzai(?:$|\/(?:config\.json|artifacts\.json)$)|(?:^|\/)(?:tests?|contracts|policies|guidance|phases)(?:\/|$)|(?:\.test\.[^/]+|lock[^/]*)$/u.test(item) || explanatory.some((rule) => rule.path === item))) invalid("Invalid dependency exclusion.");
  const toolchain = unique(list(d.toolchain, 100).map((item) => {
    text(item, 500); if (!path.isAbsolute(item)) invalid("Toolchain paths must be absolute."); return item;
  }));
  object(d.environment, [], ["PATH", "LANG", "LC_ALL", "TZ"]);
  const environment = Object.fromEntries(Object.keys(d.environment).sort().map((key) => [key, text(d.environment[key], 4096)]));
  if (environment.PATH !== undefined && environment.PATH.split(path.delimiter).some((entry) => !path.isAbsolute(entry))) invalid("Verification PATH must contain absolute entries only.");
  const volatile = unique(list(d.volatile, 10).map((item) => {
    if (!["network", "clock", "service", "secret", "external"].includes(item)) invalid("Invalid volatile dependency category."); return item;
  }));
  return { schema: p.schema, schemaVersion: 1, explanatory, dependencies: { complete: d.complete, exclude, toolchain, environment, volatile } };
}

/** Config 3 verification ingress shared by the plugin helper and orchestrator. */
export function parseVerificationConfiguration(value) {
  const v = object(value, ["profiles"], ["policy", "bootstrap"]);
  if (v.bootstrap !== undefined && typeof v.bootstrap !== "boolean") invalid("Verification bootstrap must be a boolean.");
  const ids = [];
  const profiles = list(v.profiles, 50).map((profile) => {
    object(profile, ["id", "projectType", "commands"]); identifier(profile.id);
    if (!PROJECT_TYPES.includes(profile.projectType)) invalid("Invalid verification project type.");
    const commands = list(profile.commands).map((command) => {
      object(command, ["id", "name", "command", "args", "timeoutMs"], ["evidence", "ignoreExplanatory"]);
      ids.push(identifier(command.id)); text(command.name); text(command.command, 500);
      const args = list(command.args).map((arg) => { if (typeof arg !== "string" || arg.length > 4096 || arg.includes("\0")) invalid("Invalid verification argument."); return arg; });
      if (!Number.isSafeInteger(command.timeoutMs) || command.timeoutMs <= 0 || command.timeoutMs > 86400000 ||
          (command.ignoreExplanatory !== undefined && typeof command.ignoreExplanatory !== "boolean")) invalid("Invalid verification command options.");
      return { id: command.id, name: command.name, command: command.command, args, timeoutMs: command.timeoutMs,
        evidence: mode(command.evidence ?? "fresh"), ignoreExplanatory: command.ignoreExplanatory ?? false };
    });
    if (commands.length === 0) invalid("Verification profile must contain checks.");
    return { id: profile.id, projectType: profile.projectType, commands };
  });
  if (profiles.length === 0) invalid("Verification requires profiles.");
  unique(ids); unique(profiles.map((profile) => profile.id));
  return { profiles, ...(v.policy === undefined ? {} : { policy: parseVerificationPolicy(v.policy) }),
    ...(v.bootstrap === undefined ? {} : { bootstrap: v.bootstrap }) };
}

/** Exactly one inventory in immutable approved plan bytes; prose cannot grant reuse. */
export function parseVerificationObligations(plan, configuration) {
  if (typeof plan !== "string") return null;
  const blocks = [...plan.matchAll(/^```banzai-verification-obligations\/v1\r?\n([\s\S]*?)^```\s*$/gm)];
  if (blocks.length !== 1) return null;
  try {
    const value = object(JSON.parse(blocks[0][1]), ["schema", "schemaVersion", "complete", "planRemainderSha256", "checks"]);
    if (value.schema !== "banzai-verification-obligations/v1" || value.schemaVersion !== 1 || value.complete !== true) return null;
    // The owner-approved assertion covers exactly the surrounding prose. Editing
    // commitments without rebuilding/reapproving the inventory cannot waive them.
    const remainder = plan.slice(0, blocks[0].index) + plan.slice(blocks[0].index + blocks[0][0].length);
    if (digest(value.planRemainderSha256) !== evidenceDigest(remainder)) return null;
    const checks = list(value.checks).map((item) => { object(item, ["id", "evidence"]); return { id: identifier(item.id), evidence: mode(item.evidence) }; });
    unique(checks.map((item) => item.id));
    if (/\b(?:fresh|rerun|re-run)\b|\brelease:check\b/iu.test(remainder) && checks.some((check) => check.evidence === "equivalent_evidence")) return null;
    const expected = configuration.profiles.flatMap((profile) => profile.commands.map((command) => command.id));
    if (JSON.stringify(checks.map((item) => item.id)) !== JSON.stringify(expected)) return null;
    return { schema: value.schema, schemaVersion: 1, complete: true, planRemainderSha256: value.planRemainderSha256, checks };
  } catch { return null; }
}

export function verificationIdentities(configuration, authority) {
  const config = parseVerificationConfiguration(configuration);
  digest(authority);
  return config.profiles.flatMap((profile, profileIndex) => profile.commands.map((command, commandIndex) => ({
    checkId: command.id, profileOrdinal: profileIndex + 1, commandOrdinal: commandIndex + 1,
    configurationDigest: evidenceDigest({ schema: 3, verification: config }),
    policyDigest: config.policy ? evidenceDigest(config.policy) : null,
    authorityDigest: authority, commandDigest: evidenceDigest(command)
  })));
}

function commandIsFresh(command) {
  return command.evidence !== "equivalent_evidence" ||
    /(?:^|[\s/\\])release:check(?:$|[\s])/u.test([command.command, ...command.args].join(" "));
}

function projectBytes(bytes, rule) {
  if (!rule) return bytes;
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  // Code fences, executable embeds and frontmatter invalidate the declaration.
  // Authoritative prose remains the project owner's reviewed classification.
  const executable = (body) => /(^\s*(?:```|~~~)|^---\s*$|<(?:script|iframe|object)\b|^\s*\$\s)/imu.test(body);
  if (rule.regions.length === 0) {
    if (executable(text)) invalid("Executable explanatory content.");
    return Buffer.from("<declared explanatory file>\n");
  }
  const spans = rule.regions.map((region) => {
    const lines = text.match(/[^\n]*\n|[^\n]+$/gu) ?? [];
    let position = 0; const starts = []; const ends = [];
    for (const line of lines) {
      if (line.replace(/\r?\n$/u, "") === region.start) starts.push([position, position + line.length]);
      if (line.replace(/\r?\n$/u, "") === region.end) ends.push(position);
      position += line.length;
    }
    if (starts.length !== 1 || ends.length !== 1 || starts[0][1] > ends[0]) invalid("Invalid explanatory boundary.");
    if (executable(text.slice(starts[0][1], ends[0]))) invalid("Executable explanatory region.");
    return { start: starts[0][1], end: ends[0] };
  }).sort((a, b) => a.start - b.start);
  if (spans.some((span, index) => index > 0 && spans[index - 1].end >= span.start)) invalid("Overlapping explanatory regions.");
  let projected = text;
  for (const span of spans.reverse()) projected = projected.slice(0, span.start) + "<declared explanatory region>\n" + projected.slice(span.end);
  return Buffer.from(projected);
}

async function readRegular(file, budget) {
  const before = await lstat(file);
  if (!before.isFile() || before.isSymbolicLink() || before.size > MAX_BYTES || (budget.bytes += before.size) > MAX_BYTES || ++budget.files > MAX_FILES) invalid("Unsafe or incomplete verification input.");
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const bytes = await handle.readFile();
    const after = await handle.stat();
    const latest = await lstat(file);
    if (before.ino !== after.ino || before.dev !== after.dev || before.size !== after.size || before.mtimeMs !== after.mtimeMs ||
        latest.ino !== before.ino || latest.mtimeMs !== before.mtimeMs || latest.mode !== before.mode || bytes.length !== before.size) invalid("Verification input changed during capture.");
    return { bytes, mode: before.mode & 0o777 };
  } finally { await handle.close(); }
}

function git(root, args) {
  return new Promise((resolve, reject) => execFile("git", ["-C", root, ...args], { encoding: "buffer", maxBuffer: MAX_BYTES, timeout: 30000,
    env: { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_OPTIONAL_LOCKS: "0" } },
  (error, stdout) => error ? reject(new VerificationEvidenceError("Git input inventory unavailable.")) : resolve(stdout)));
}

/** Captures actual bytes, including ignored installed inputs. Every refusal is fresh. */
export async function captureVerificationInputs({ repoRoot, configuration, workId, evidenceDirectories = [] }) {
  const config = parseVerificationConfiguration(configuration);
  const policy = config.policy;
  const unavailable = (reason) => ({ complete: false, reason, candidateDigest: null, checks: [] });
  if (!policy) return unavailable("policy_disabled");
  if (!policy.dependencies.complete || policy.dependencies.volatile.length || !policy.dependencies.toolchain.length) return unavailable("inputs_unavailable");
  if (!/^[a-f0-9-]{36}$/u.test(workId)) invalid("Invalid verification work identity.");
  // Owners supply only their exact machine directories. Reports remain inputs
  // unless an explicit reviewed dependency exclusion says otherwise.
  if (evidenceDirectories.some((directory) => directory !== ".banzai/runner.lock" && !/^\.banzai\/(?:work\/[a-f0-9-]{36}|runs\/[a-z0-9][a-z0-9.-]{0,199})(?:\/verification)?$/u.test(directory))) invalid("Invalid verification evidence boundary.");
  try {
    const root = await realpath(repoRoot);
    const repository = await lstat(root);
    const repositoryIdentity = { root, device: repository.dev, inode: repository.ino };
    const excludes = [...policy.dependencies.exclude, ...evidenceDirectories];
    const excluded = (file) => excludes.some((exclude) => file === exclude || file.startsWith(exclude + "/"));
    const budget = { files: 0, bytes: 0 };
    const entries = [];
    async function walk(directory, prefix = "") {
      const before = await readdir(directory, { withFileTypes: true });
      for (const entry of before.sort((a, b) => a.name < b.name ? -1 : 1)) {
        const relativePath = prefix + entry.name;
        if (relativePath === ".git" || excluded(relativePath)) continue;
        // Claims are transient helper ownership, never command inputs.
        if (/^\.banzai\/work\/[a-f0-9-]{36}\/\.writer-claim\.json$/u.test(relativePath)) continue;
        relative(relativePath);
        if (SECRET_PATH.test(relativePath)) invalid("Secret-dependent input cannot establish reusable evidence.");
        if (entry.isSymbolicLink()) invalid("Unproven verification symlink.");
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          const info = await lstat(absolute);
          if (!info.isDirectory() || info.isSymbolicLink()) invalid("Unstable verification directory.");
          entries.push({ path: relativePath, kind: "directory", mode: info.mode & 0o777, digest: null, bytes: null, layer: "working" });
          await walk(absolute, relativePath + "/");
        } else {
          const input = await readRegular(absolute, budget);
          entries.push({ path: relativePath, kind: "file", mode: input.mode, digest: evidenceDigest(input.bytes), bytes: input.bytes, layer: "working" });
        }
      }
      const after = await readdir(directory);
      if (JSON.stringify(before.map((entry) => entry.name).sort()) !== JSON.stringify(after.sort())) invalid("Verification path inventory changed.");
    }
    const beforeIndex = await git(root, ["ls-files", "--stage", "-z"]);
    await walk(root);
    for (const record of beforeIndex.toString("utf8").split("\0").filter(Boolean)) {
      const match = /^(\d+) ([a-f0-9]+) (\d)\t(.+)$/u.exec(record);
      if (!match || match[3] !== "0" || !["100644", "100755"].includes(match[1])) invalid("Unsafe or unresolved Git input.");
      const relativePath = relative(match[4]);
      if (SECRET_PATH.test(relativePath) && !excluded(relativePath)) invalid("Secret-dependent Git input cannot establish reusable evidence.");
      if (excluded(relativePath)) continue;
      const bytes = await git(root, ["cat-file", "blob", match[2]]);
      if ((budget.bytes += bytes.length) > MAX_BYTES || ++budget.files > MAX_FILES) invalid("Incomplete Git input capture.");
      entries.push({ path: relativePath, kind: "file", mode: match[1] === "100755" ? 0o755 : 0o644, digest: evidenceDigest(bytes), bytes, layer: "index" });
    }
    if (!beforeIndex.equals(await git(root, ["ls-files", "--stage", "-z"]))) invalid("Git inventory changed during capture.");
    const tools = [];
    for (const tool of [...policy.dependencies.toolchain].sort()) {
      if (await realpath(tool) !== tool) invalid("Toolchain symlinks require a proven closure.");
      const input = await readRegular(tool, budget);
      tools.push({ path: tool, mode: input.mode, sha256: evidenceDigest(input.bytes) });
    }
    const commands = config.profiles.flatMap((profile) => profile.commands);
    const executables = [];
    for (const command of commands) {
      const candidates = path.isAbsolute(command.command) ? [command.command] : command.command.includes("/") ? [path.resolve(root, command.command)] :
        (policy.dependencies.environment.PATH ?? "").split(path.delimiter).filter(Boolean).map((entry) => path.join(entry, command.command));
      let executable = null;
      for (const candidate of candidates) {
        try { const info = await lstat(candidate); if (info.isFile() && (info.mode & 0o111)) { executable = candidate; break; } }
        catch (error) { if (error.code !== "ENOENT") throw error; }
      }
      if (!executable || !tools.some((tool) => tool.path === executable)) invalid("Unproven verification executable.");
      executables.push(executable);
    }
    const raw = entries.map(({ bytes: _bytes, ...entry }) => entry);
    const environmentDigest = evidenceDigest({ repository: repositoryIdentity, tools, environment: policy.dependencies.environment, platform: process.platform, arch: process.arch });
    const checks = commands.map((command, index) => ({ checkId: command.id, executable: executables[index], environmentDigest,
      inputDigest: evidenceDigest(entries.map(({ bytes, ...entry }) => ({ ...entry,
        digest: bytes === null ? null : evidenceDigest(projectBytes(bytes, command.ignoreExplanatory ? policy.explanatory.find((rule) => rule.path === entry.path) : null)) }))) }));
    return { complete: true, reason: null, candidateDigest: evidenceDigest(raw), checks };
  } catch { return unavailable("inputs_unavailable"); }
}

/** The caller must capture twice and compare before acting and at application. */
export function sameVerificationCapture(left, right) {
  return left.complete && right.complete && JSON.stringify(left) === JSON.stringify(right);
}

export function decideVerification({ workId, roundId, configuration, authorityDigest, strict, obligations, capture, origins }) {
  const config = parseVerificationConfiguration(configuration);
  const identities = verificationIdentities(config, authorityDigest);
  text(workId); text(roundId);
  const commands = config.profiles.flatMap((profile) => profile.commands);
  const actions = identities.map((identity, index) => {
    const input = capture.checks.find((check) => check.checkId === identity.checkId);
    const action = { checkId: identity.checkId, action: "execute", reason: "no_origin", identity,
      inputDigest: input?.inputDigest ?? null, environmentDigest: input?.environmentDigest ?? null, origin: null };
    if (!config.policy) action.reason = "policy_disabled";
    else if (commandIsFresh(commands[index]) || obligations?.checks.find((check) => check.id === identity.checkId)?.evidence === "fresh") action.reason = "mandatory_fresh";
    else if (strict && !obligations) action.reason = "obligations_unavailable";
    else if (!capture.complete || !input) action.reason = "inputs_unavailable";
    else {
      // Last physical evidence wins, including failed and interrupted starts.
      const matching = origins.filter((origin) => origin.workId === workId && origin.checkId === identity.checkId);
      const origin = matching.at(-1);
      if (origin) {
        if (origin.status !== "completed" || origin.exitCode !== 0 || origin.signal !== null || origin.failureCategory !== null) action.reason = "later_attempt";
        else if (!origin.complete || !origin.logsIntact || !origin.attemptId || !origin.recordDigest || !origin.before || !sameVerificationCapture(origin.before, origin.after)) action.reason = "origin_invalid";
        else if (JSON.stringify(origin.identity) !== JSON.stringify(identity)) action.reason = "identity_changed";
        else {
          const prior = origin.before.checks.find((check) => check.checkId === identity.checkId);
          if (!prior || prior.inputDigest !== input.inputDigest || prior.environmentDigest !== input.environmentDigest) action.reason = "inputs_changed";
          else if (origin.roundId === roundId) action.reason = "existing_execution";
          else { action.action = "reuse"; action.reason = "equivalent_evidence"; action.origin = { attemptId: origin.attemptId, recordDigest: origin.recordDigest, roundId: origin.roundId }; }
        }
      }
    }
    return action;
  });
  const decision = { schema: "banzai-verification-decision/v1", schemaVersion: 1, workId, roundId,
    candidateDigest: capture.candidateDigest, authorityDigest, configurationDigest: evidenceDigest({ schema: 3, verification: config }), actions };
  return { ...decision, sha256: evidenceDigest(decision) };
}

export function parseVerificationDecision(value) {
  const record = object(value, ["schema", "schemaVersion", "workId", "roundId", "candidateDigest", "authorityDigest", "configurationDigest", "actions", "sha256"]);
  if (record.schema !== "banzai-verification-decision/v1" || record.schemaVersion !== 1) invalid("Unsupported verification decision.");
  text(record.workId); text(record.roundId); digest(record.authorityDigest); digest(record.configurationDigest);
  if (record.candidateDigest !== null) digest(record.candidateDigest);
  const checks = [];
  for (const action of list(record.actions)) {
    object(action, ["checkId", "action", "reason", "identity", "inputDigest", "environmentDigest", "origin"]);
    checks.push(identifier(action.checkId));
    object(action.identity, ["checkId", "profileOrdinal", "commandOrdinal", "configurationDigest", "policyDigest", "authorityDigest", "commandDigest"]);
    if (action.identity.checkId !== action.checkId || action.identity.configurationDigest !== record.configurationDigest || action.identity.authorityDigest !== record.authorityDigest ||
        ![action.identity.profileOrdinal, action.identity.commandOrdinal].every((n) => Number.isSafeInteger(n) && n > 0)) invalid("Inconsistent verification decision identity.");
    digest(action.identity.commandDigest);
    for (const hash of [action.identity.policyDigest, action.inputDigest, action.environmentDigest]) if (hash !== null) digest(hash);
    if (!["execute", "reuse"].includes(action.action) || !VERIFICATION_REASONS.includes(action.reason)) invalid("Invalid verification disposition.");
    if (action.action === "reuse") {
      object(action.origin, ["attemptId", "recordDigest", "roundId"]); text(action.origin.attemptId); text(action.origin.roundId); digest(action.origin.recordDigest);
      if (action.reason !== "equivalent_evidence" || !record.candidateDigest || !action.inputDigest || !action.environmentDigest || !action.identity.policyDigest) invalid("Incomplete reuse decision.");
    } else if (action.origin !== null || action.reason === "equivalent_evidence") invalid("Execution cannot carry reuse evidence.");
  }
  unique(checks);
  const { sha256, ...body } = record;
  if (digest(sha256) !== evidenceDigest(body)) invalid("Verification decision digest mismatch.");
  return record;
}
