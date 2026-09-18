// Task-bound verification contracts. Discovery and proposals confer no permission.
// Builtin-only shared owner for plugin and orchestrator (ADR-0049).
import path from "node:path";
import { lstat, readFile, realpath } from "node:fs/promises";
import { evidenceDigest, parseVerificationPolicy, VerificationEvidenceError } from "./verification-evidence.mjs";

const fail = (message) => { throw new VerificationEvidenceError(message); };
const HASH = /^[a-f0-9]{64}$/u;
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
function object(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      keys.some((key) => !Object.hasOwn(value, key)) || Object.keys(value).some((key) => !keys.includes(key))) fail("Invalid task verification fields.");
  return value;
}
function text(value, limit = 500, empty = false) {
  if (typeof value !== "string" || (!empty && !value.length) || value.length > limit || /[\x00-\x1f\x7f]/u.test(value)) fail("Invalid task verification text.");
  return value;
}
function list(value, maximum = 200) {
  if (!Array.isArray(value) || value.length > maximum) fail("Task verification inventory exceeds its bound.");
  return value;
}
function unique(values) { if (new Set(values).size !== values.length) fail("Duplicate task verification identity."); return values; }
function hash(value) { if (typeof value !== "string" || !HASH.test(value)) fail("Invalid task verification digest."); return value; }
function id(value) { if (!ID.test(text(value, 80))) fail("Invalid task verification identifier."); return value; }
function relative(value, root = false) {
  text(value);
  if (root && value === ".") return value;
  if (path.posix.isAbsolute(value) || value.includes("\\") || value.split("/").some((part) => !part || part === "." || part === "..") || /^(?:\.git|\.banzai)(?:\/|$)/u.test(value)) fail("Invalid task verification project path.");
  return value;
}
function boundedTime(value) { if (!Number.isSafeInteger(value) || value < 1 || value > 86400000) fail("Invalid task verification timeout."); return value; }

export function parseTaskVerificationDescriptor(value) {
  const v = object(value, ["id", "name", "requirementRefs", "command", "args", "cwd", "timeoutMs", "evidence", "sources", "materialization"]);
  const requirementRefs = unique(list(v.requirementRefs, 32).map((ref) => text(ref, 200)));
  if (!requirementRefs.length) fail("Verification must identify its task requirement or project rule.");
  const command = text(v.command);
  if (command.startsWith("-") || /\s/u.test(command) || command.includes("\\") || (command.includes("/") && command.split("/").includes(".."))) fail("Expected an executable, not shell text or a traversal path.");
  if (!["fresh", "equivalent_evidence"].includes(v.evidence)) fail("Unsupported task evidence mode.");
  const sources = list(v.sources, 32).map((source) => {
    object(source, ["path", "sha256"]);
    return { path: relative(source.path), sha256: hash(source.sha256) };
  });
  unique(sources.map((source) => source.path));
  const materialization = v.materialization === null ? null : (() => {
    const m = object(v.materialization, ["taskRef", "paths"]);
    const paths = unique(list(m.paths, 32).map((item) => relative(item)));
    if (!paths.length) fail("Future tooling requires materialization paths.");
    return { taskRef: text(m.taskRef, 200), paths };
  })();
  const args = list(v.args, 200).map((arg) => text(arg, 4096, true));
  if (args.some(arg => /(?:\b(?:sk|sk-ant|sess)-[A-Za-z0-9_-]{12,}\b|\bBearer\s+[^ ]+|^--?(?:password|api[-_]?key|access[-_]?token|auth[-_]?token|secret)(?:=|$)|["'](?:password|api[_-]?key|access[_-]?token|auth[_-]?token)["']\s*:)/iu.test(arg))) fail("Credentials must not be embedded in verification descriptors.");
  return { id: id(v.id), name: text(v.name, 200), requirementRefs, command,
    args, cwd: relative(v.cwd, true),
    timeoutMs: boundedTime(v.timeoutMs), evidence: v.evidence, sources, materialization };
}

export function parseTaskVerificationCandidates(value) {
  if (value === null) return null;
  const v = object(value, ["checks", "absenceReason"]);
  const checks = list(v.checks).map(parseTaskVerificationDescriptor);
  unique(checks.map((check) => check.id));
  if (checks.length ? v.absenceReason !== null : typeof v.absenceReason !== "string") fail("Empty selection requires an absence rationale; selected checks do not.");
  return { checks, absenceReason: v.absenceReason === null ? null : text(v.absenceReason, 2000) };
}

/** Unlike v1 this inventory is self-contained, never derived from profiles. */
export function parseTaskVerificationObligations(plan) {
  if (typeof plan !== "string" || Buffer.byteLength(plan) > 16 * 1024 * 1024) fail("Task verification requires bounded plan bytes.");
  const blocks = [...plan.matchAll(/^```banzai-verification-obligations\/v2\r?\n([\s\S]*?)^```[ \t]*$/gm)];
  if (blocks.length !== 1 || [...plan.matchAll(/^```banzai-verification-obligations\//gm)].length !== 1) fail("The plan requires exactly one v2 verification inventory.");
  let parsed;
  try { parsed = JSON.parse(blocks[0][1]); } catch { fail("Malformed task verification inventory."); }
  const v = object(parsed, ["schema", "schemaVersion", "complete", "planRemainderSha256", "checks", "absenceReason"]);
  if (v.schema !== "banzai-verification-obligations/v2" || v.schemaVersion !== 2 || v.complete !== true) fail("Unsupported task verification inventory.");
  const remainder = plan.slice(0, blocks[0].index) + plan.slice(blocks[0].index + blocks[0][0].length);
  if (hash(v.planRemainderSha256) !== evidenceDigest(remainder)) fail("Verification inventory no longer binds the surrounding plan.");
  const selection = parseTaskVerificationCandidates({ checks: v.checks, absenceReason: v.absenceReason });
  if (/\b(?:fresh|rerun|re-run)\b|\brelease:check\b/iu.test(remainder) && selection.checks.some((check) => check.evidence !== "fresh")) fail("Equivalent evidence cannot override fresh plan commitments.");
  return { schema: v.schema, schemaVersion: 2, complete: true, planRemainderSha256: v.planRemainderSha256, ...selection };
}

export function parseTaskVerificationPolicy(value) {
  const v = object(value, ["schema", "schemaVersion", "required", "denied", "limits", "reuse"]);
  if (v.schema !== "banzai-task-verification-policy/v1" || v.schemaVersion !== 1) fail("Unsupported task verification policy.");
  const required = list(v.required).map(parseTaskVerificationDescriptor);
  unique(required.map((check) => check.id));
  const denied = list(v.denied).map((item) => {
    object(item, ["command", "args", "cwd"]);
    return { command: text(item.command), args: item.args === null ? null : list(item.args).map((arg) => text(arg, 4096, true)), cwd: item.cwd === null ? null : relative(item.cwd, true) };
  });
  const limits = object(v.limits, ["timeoutMs", "workingDirectories", "requiredContext"]);
  const workingDirectories = unique(list(limits.workingDirectories, 100).map((item) => relative(item, true)));
  if (!workingDirectories.length) fail("Policy must identify allowed working directories.");
  return { schema: v.schema, schemaVersion: 1, required, denied,
    limits: { timeoutMs: boundedTime(limits.timeoutMs), workingDirectories, requiredContext: text(limits.requiredContext, 200) },
    reuse: v.reuse === null ? null : parseVerificationPolicy(v.reuse) };
}

/** Exact duplicate supplements never replace or weaken a required descriptor. */
export function selectTaskVerification({ required, candidates, policy = null }) {
  const mandatory = [...required.map(parseTaskVerificationDescriptor), ...(policy?.required ?? [])];
  const selected = new Map();
  for (const check of mandatory) {
    const previous = selected.get(check.id);
    if (previous && evidenceDigest(previous.descriptor) !== evidenceDigest(check)) fail("Conflicting mandatory verification identity.");
    selected.set(check.id, { descriptor: check, required: true });
  }
  const proposal = parseTaskVerificationCandidates(candidates);
  for (const check of proposal?.checks ?? []) {
    const previous = selected.get(check.id);
    if (previous && evidenceDigest(previous.descriptor) !== evidenceDigest(check)) fail("A proposal cannot change an existing verification obligation.");
    if (!previous) selected.set(check.id, { descriptor: check, required: false });
  }
  return { checks: [...selected.values()], absenceReason: selected.size ? null : proposal?.absenceReason ?? null };
}

/** Safe ancestry for all concrete executor inputs. No symlink escape or alias. */
export async function taskVerificationPath(repoRoot, relativePath, directory = false) {
  relative(relativePath, directory);
  const root = await realpath(repoRoot);
  let current = root;
  for (const segment of relativePath === "." ? [] : relativePath.split("/")) {
    current = path.join(current, segment);
    const entry = await lstat(current);
    if (entry.isSymbolicLink()) fail("Verification input ancestry contains a symlink.");
  }
  const entry = await lstat(current);
  if (directory ? !entry.isDirectory() : !entry.isFile()) fail("Verification input has an unsupported file type.");
  return current;
}

/** Called by the owner immediately before launch, not by proposal validation. */
export async function authorizeTaskVerification({ repoRoot, descriptor, authority, context, policy = null }) {
  const check = parseTaskVerificationDescriptor(descriptor);
  object(authority, ["workId", "sourceAttemptId", "workflow", "taskDigest", "selectionDigest", "approvalDigest", "contextDigest"]);
  text(authority.workId, 128); text(authority.sourceAttemptId, 128); hash(authority.taskDigest); hash(authority.selectionDigest); hash(authority.contextDigest);
  if (!["strict", "feature", "quick-fix"].includes(authority.workflow) || (authority.workflow === "strict" ? !HASH.test(authority.approvalDigest) : authority.approvalDigest !== null)) fail("Missing task or approval authority.");
  object(context, ["kind", "invocationDigest", "restrictions"]);
  if (context.kind !== "inherited-local" || evidenceDigest(context) !== authority.contextDigest) fail("The actual executor does not match the authorized context.");
  hash(context.invocationDigest); unique(list(context.restrictions, 32).map((item) => text(item, 200)));
  const activePolicy = policy === null ? null : parseTaskVerificationPolicy(policy);
  if (activePolicy) {
    const { limits, denied } = activePolicy;
    if (limits.requiredContext !== context.kind) fail("Required execution context is unavailable; no process was launched.");
    if (check.timeoutMs > limits.timeoutMs || !limits.workingDirectories.some((dir) => dir === "." || check.cwd === dir || check.cwd.startsWith(dir + "/"))) fail("Verification exceeds project execution limits.");
    if (denied.some((rule) => rule.command === check.command && (rule.args === null || JSON.stringify(rule.args) === JSON.stringify(check.args)) && (rule.cwd === null || rule.cwd === check.cwd))) fail("Verification is prohibited by project policy.");
  }
  const cwd = await taskVerificationPath(repoRoot, check.cwd, true);
  if (check.command.includes("/") && !path.isAbsolute(check.command)) await taskVerificationPath(repoRoot, path.posix.normalize(path.posix.join(check.cwd, check.command)));
  for (const source of check.sources) {
    const file = await taskVerificationPath(repoRoot, source.path);
    if ((await lstat(file)).size > 1024 * 1024 || evidenceDigest(await readFile(file)) !== source.sha256) fail("Verification selection source changed before launch.");
  }
  for (const file of check.materialization?.paths ?? []) await taskVerificationPath(repoRoot, file);
  return { descriptor: check, cwd, authorityDigest: evidenceDigest(authority), contextDigest: evidenceDigest(context), policyDigest: activePolicy ? evidenceDigest(activePolicy) : null };
}

/** Bounded static discovery. Unknown build languages remain source evidence. */
export async function discoverTaskVerification(repoRoot, directories = ["."], additionalSources = []) {
  const dirs = unique(list(directories, 32).map((item) => relative(item, true)));
  const extras = unique(list(additionalSources, 32).map((item) => relative(item)));
  const files = unique([...dirs.flatMap((dir) => ["package.json", "composer.json", "Makefile", "justfile", "Taskfile.yml", "Cargo.toml", "go.mod", "build.gradle", "build.gradle.kts", "AGENTS.md", "CLAUDE.md"].map((name) => dir === "." ? name : `${dir}/${name}`)), ...extras]);
  const sources = []; const suggestions = [];
  for (const file of files) {
    let bytes;
    try {
      const target = await taskVerificationPath(repoRoot, file);
      if ((await lstat(target)).size > 1024 * 1024) fail("Discovery source exceeds one MiB.");
      bytes = await readFile(target);
    } catch (error) {
      sources.push({ path: file, status: error.code === "ENOENT" ? "absent" : "unavailable", sha256: null, reason: error.code === "ENOENT" ? null : "Source could not be inspected safely." });
      continue;
    }
    const sha256 = evidenceDigest(bytes);
    const source = { path: file, status: "inspected", sha256, reason: null };
    sources.push(source);
    const name = path.posix.basename(file); const cwd = path.posix.dirname(file);
    if (name === "package.json" || name === "composer.json") {
      let metadata;
      try { metadata = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
      catch { source.status = "unavailable"; source.reason = "Malformed declarative metadata."; continue; }
      if (!metadata || typeof metadata !== "object" || Array.isArray(metadata) || (metadata.scripts !== undefined && (!metadata.scripts || typeof metadata.scripts !== "object" || Array.isArray(metadata.scripts)))) {
        source.status = "unavailable"; source.reason = "Invalid script inventory."; continue;
      }
      const scripts = Object.entries(metadata.scripts ?? {});
      if (scripts.length > 200) { source.status = "unavailable"; source.reason = "Script inventory exceeds its bound."; continue; }
      for (const [script, body] of scripts) {
        if (!/^[A-Za-z0-9][A-Za-z0-9:._-]{0,99}$/u.test(script)) continue;
        if (typeof body !== "string" || body.length > 4096 || /[\x00-\x1f\x7f]/u.test(body)) continue;
        const placeholder = name === "package.json" && /^\s*echo\s+["']Error: no test specified["']\s*&&\s*exit\s+1\s*$/u.test(body);
        let command = "composer"; let args = ["run-script", script];
        if (name === "package.json") {
          const manager = typeof metadata.packageManager === "string" ? metadata.packageManager.split("@")[0] : "npm";
          command = ["npm", "pnpm", "yarn", "bun"].includes(manager) ? manager : "npm";
          args = ["run", script];
        }
        suggestions.push({ command, args, cwd, source: { path: file, sha256 }, script, placeholder });
      }
    }
  }
  return { sources, suggestions };
}
