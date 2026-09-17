import { parseVerificationDecision, evidenceDigest } from "./verification-evidence.mjs";
import { parseVerificationApplicability, parseVerificationOriginStart, parseVerificationOriginFinish } from "./verification-store.mjs";
import { parseReviewSnapshot } from "./review-snapshot.mjs";
import {
  parseVerificationConfigTransaction,
  parseVerificationConfigConfirmation,
  parseTerminalAttemptCheckpoint,
  parseRecoveryAuthorization,
  parseModelAttemptRecord,
  parseVerificationAttemptRecord,
  parseEvaluationStateSource,
  parsePersistedPhaseResult,
  parseReviewResult,
  parseCurrentReviewResult,
  parseCompletionTransition,
  parseCompletionCapture,
  parseCompletionCandidate,
  parseCompletionPublication,
} from "./artifact-readers.mjs";
import {
  lstat,
  mkdir,
  readdir,
  rename,
  chmod,
  open,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  exactObject,
  relativePath,
  safePath,
  readBytes,
  readInvocationBytes,
  readJson,
  makeDirectories,
  publishNew,
  digestBytes,
  projectRoot,
  parseBinding,
  git,
  fail,
} from "./artifact-storage.mjs";

export const ARCHIVE_SCHEMA = "banzai-artifact-archive/v1";
const LIMIT = 25000;
const SHA = /^[0-9a-f]{64}$/u;
const secretPath =
  /(?:^|\/)(?:\.ssh|\.aws|\.gnupg|\.codex|\.claude|node_modules|auth\.json|credentials(?:\.json)?|\.env(?:\.[^/]+)?)(?:\/|$)|\.(?:pem|key|p12|pfx)$/iu;
const control =
  /(?:^|\/)(?:active-run\.json|runner\.lock|\.writer-claim\.json|\.artifact-init\.lock)$/u;
function bounded(value, name) {
  if (
    typeof value !== "string" ||
    !value.length ||
    value.length > 200 ||
    /[\x00-\x1f\x7f]/u.test(value)
  )
    fail(
      "ARTIFACT_INPUT_INVALID",
      `${name} must be a bounded explicit identity.`,
    );
  return value;
}
function archivePath(value) {
  relativePath(value);
  if (secretPath.test(value) || value === ".banzai/archive-manifest.json")
    fail(
      "ARTIFACT_UNSAFE_PATH",
      "Authentication, credential and key locations cannot enter an artifact archive.",
    );
  return value;
}
async function directory(input) {
  if (typeof input !== "string" || !path.isAbsolute(input))
    fail(
      "ARTIFACT_INPUT_INVALID",
      "Archive directories must be absolute local paths.",
    );
  // Validate the supplied ancestors before any realpath normalization.
  const root = path.parse(input).root;
  await safePath(root, path.relative(root, input), { directory: true });
  return input;
}
async function missingDestination(input) {
  if (typeof input !== "string" || !path.isAbsolute(input))
    fail(
      "ARTIFACT_INPUT_INVALID",
      "Destination must be an absolute local directory.",
    );
  if (input !== path.resolve(input))
    fail("ARTIFACT_UNSAFE_PATH", "Destination must be canonical, without dot segments or path aliases.");
  await directory(path.dirname(input));
  await safePath(path.dirname(input), path.basename(input), {
    missing: true,
    directory: true,
  });
  return input;
}
function sourcePath(parent, reference, sourceRoot = null) {
  if (
    typeof reference !== "string" ||
    !reference.length ||
    /^(?:https?:|mailto:|#|app:)/u.test(reference)
  )
    return null;
  let clean = reference.split("#")[0];
  if (path.posix.isAbsolute(clean)) {
    if (sourceRoot && clean.startsWith(`${sourceRoot}/`))
      clean = clean.slice(sourceRoot.length + 1);
    else return `external/${digestBytes(clean)}`;
  }
  const run = parent.match(/^(\.banzai\/runs\/[^/]+)\//u)?.[1];
  const work = parent.match(/^(\.banzai\/work\/[^/]+)\/verification\//u)?.[1];
  if (work && clean.startsWith("verification/")) clean = `${work}/${clean}`;
  if (
    run &&
    /^(?:attempts|reviews|verification|approval|recovery)\//u.test(clean)
  )
    clean = `${run}/${clean}`;
  const candidate =
    clean.startsWith("./") || clean.startsWith("../")
      ? path.posix.normalize(path.posix.join(path.posix.dirname(parent), clean))
      : clean;
  if (
    candidate.startsWith("../") ||
    path.posix.isAbsolute(candidate) ||
    /[\x00-\x20<>`{}]/u.test(candidate)
  )
    return null;
  if (!candidate.includes("/") && !/\.(?:md|json|jsonl|log)$/u.test(candidate))
    return null;
  return candidate.replace(/\/$/u, "");
}
function markdownProse(text) {
  let fence = null;
  return text.split("\n").map(line => {
    const marker = /^ {0,3}(`{3,}|~{3,})/u.exec(line)?.[1];
    if (fence !== null) {
      if (marker && marker[0] === fence[0] && marker.length >= fence.length) fence = null;
      return "";
    }
    if (marker) { fence = marker; return ""; }
    return line.replace(/(`+).*?\1/gu, "");
  }).join("\n");
}

function dependenciesFor(relative, bytes, sourceRoot = null) {
  const refs = new Map();
  let supported = true;
  const text = bytes.toString("utf8");
  if (relative.endsWith(".json")) {
    let value;
    try {
      value = JSON.parse(text);
    } catch {
      return { refs, supported: false };
    }
    try {
      if (value.schema === "banzai-verification-config-transaction/v1") parseVerificationConfigTransaction(value);
      else if (value.schema === "banzai-verification-decision/v1") parseVerificationDecision(value);
      else if (value.schema === "banzai-verification-applicability/v1") parseVerificationApplicability(value);
      else if (value.schema === "banzai-verification-origin-start/v1") parseVerificationOriginStart(value);
      else if (value.schema === "banzai-verification-origin-finish/v1") parseVerificationOriginFinish(value);
      else if (
        value.schema === "banzai-terminal-attempt-checkpoint/v1" ||
        value.schema === "banzai-terminal-attempt-checkpoint/v2"
      )
        parseTerminalAttemptCheckpoint(value);
      else if (value.schema === "banzai-completion-transition/v1")
        parseCompletionTransition(value);
      else if (value.schema === "banzai-completion-capture/v1")
        parseCompletionCapture(value);
      else if (value.schema === "banzai-completion-candidate/v1")
        parseCompletionCandidate(value);
      else if (value.schema === "banzai-completion-publication/v1")
        parseCompletionPublication(value);
      else if (value.schema === "banzai-recovery-authorization/v1")
        parseRecoveryAuthorization(value);
      else if (/^\.banzai\/runs\/[^/]+\/state\.json$/u.test(relative))
        parseEvaluationStateSource(value);
      else if (
        /^\.banzai\/runs\/[^/]+\/attempts\/[^/]+\.json$/u.test(relative) &&
        value.attempt &&
        "startedAt" in value
      )
        parseModelAttemptRecord(value);
      else if (
        /^\.banzai\/(?:runs\/[^/]+\/verification-attempts|work\/[^/]+\/verification\/attempts)\//u.test(relative) &&
        "command" in value
      )
        parseVerificationAttemptRecord(value);
      else if ("phase" in value && "outcome" in value)
        parsePersistedPhaseResult(value);
      else if ("verdict" in value && "findings" in value)
        (value.schemaVersion === 2
          ? parseCurrentReviewResult
          : parseReviewResult)(value);
    } catch {
      return { refs, supported: false };
    }
    if (relative.endsWith("/work.json")) {
      parseBinding(value);
      return { refs, supported };
    }
    if (
      /\.banzai\/runs\/[^/]+\/state\.json$/u.test(relative) &&
      ![1, 2, 3, 4, 5, 6, 7].includes(value.schemaVersion)
    )
      supported = false;
    if (
      typeof value.schema === "string" &&
      !new Set([
        "banzai-terminal-attempt-checkpoint/v1",
        "banzai-terminal-attempt-checkpoint/v2",
        "banzai-completion-transition/v1",
        "banzai-completion-capture/v1",
        "banzai-completion-candidate/v1",
        "banzai-completion-publication/v1",
        "banzai-recovery-authorization/v1",
        "banzai-review-snapshot/v1",
        "banzai-review-snapshot/v2",
        "banzai-review-snapshot/v3",
        "banzai-review-snapshot/v4",
        "banzai-review-snapshot/v5",
        "banzai-verification-config-transaction/v1",
        "banzai-work-binding/v2",
        "banzai-verification-decision/v1",
        "banzai-verification-applicability/v1",
        "banzai-verification-origin-start/v1",
        "banzai-verification-origin-finish/v1",
        "banzai-work-binding/v1",
        "banzai-context-attempt/v1",
        "banzai-context-report/v1",
      ]).has(value.schema)
    )
      supported = false;
    if (
      typeof value.schema === "string" &&
      value.schema.startsWith("banzai-review-snapshot/")
    ) {
      try {
        parseReviewSnapshot(value);
      } catch {
        return { refs, supported: false };
      }
    }
    if (
      /\.banzai\/runs\/[^/]+\/state\.json$/u.test(relative) &&
      (value.schemaVersion === 4 ||
        value.schemaVersion === 5 ||
        value.schemaVersion === 6 ||
        (value.schemaVersion === 7 && value.artifactBinding !== undefined))
    ) {
      try {
        exactObject(value.artifactBinding, ["binding", "sha256"]);
        parseBinding(value.artifactBinding.binding);
        if (!SHA.test(value.artifactBinding.sha256)) supported = false;
      } catch {
        supported = false;
      }
    }
    const workflowEvidence =
      relative.startsWith(".banzai/runs/") || relative.includes("/verification/") ||
      (typeof value.schema === "string" &&
        /^banzai-(?:review-snapshot|work-binding)\/v/u.test(value.schema));
    if (!workflowEvidence) return { refs, supported };
    const run = relative.match(/^(\.banzai\/runs\/[^/]+)\//u)?.[1];
    if (run && relative !== `${run}/state.json`) refs.set(`${run}/state.json`, true);
    if (run && value.schema === "banzai-verification-config-transaction/v1") {
      if (relative !== `${run}/configuration/${value.operationId}.transaction.json` || value.runId !== run.split("/").at(-1)) supported = false;
      refs.set(`${run}/configuration/${value.operationId}.confirmation.json`, true);
    }
    if (run && /^.*\/configuration\/[^/]+\.confirmation\.json$/u.test(relative)) refs.set(relative.replace(/\.confirmation\.json$/u, ".transaction.json"), true);
    if (run && (value.schemaVersion === 6 || (value.schemaVersion === 7 && value.configurationSetup)) && relative === `${run}/state.json`) for (const id of value.configurationSetup.transactions) refs.set(`${run}/configuration/${id}.transaction.json`, true);
    if ((value.schema === "banzai-review-snapshot/v4" || (value.schema === "banzai-review-snapshot/v5" && value.configurationSetup)) && value.configurationSetup) for (const change of value.configurationSetup.runnerChanges) refs.set(`.banzai/runs/${value.runId}/configuration/${change.transaction.operationId}.transaction.json`, true);
    // Runner-owned completion publication (ADR-0047): retained terminal,
    // transition, capture, original, candidate and receipt bytes are required
    // authority closure for the attempt that published or is pending.
    const completionLeaf = (attemptId, leaf) => `${run}/attempts/${attemptId}.${leaf}`;
    if (run && value.schemaVersion === 7 && relative === `${run}/state.json` && value.completionPublication) {
      const cursor = value.completionPublication;
      if (cursor.captureDigest) refs.set(completionLeaf(cursor.attemptId, "completion-input.json"), true);
      if (cursor.candidateDigest) {
        refs.set(completionLeaf(cursor.attemptId, "completion-candidate.json"), true);
        refs.set(completionLeaf(cursor.attemptId, "completion-candidate.md"), true);
      }
      if (cursor.receiptDigest) refs.set(completionLeaf(cursor.attemptId, "completion-publication.json"), true);
    }
    if (run && value.schemaVersion === 7 && relative === `${run}/state.json` && value.planTaskCompletion?.schemaVersion === 2 && value.planTaskCompletion.status === "valid")
      refs.set(`${run}/${value.planTaskCompletion.publication.path}`, true);
    if (run && value.schema === "banzai-review-snapshot/v5" && value.completionPublication)
      refs.set(`.banzai/runs/${value.runId}/${value.completionPublication.receiptPath}`, true);
    if (run && value.schema === "banzai-completion-capture/v1") {
      if (value.terminalIntegrityDigest) refs.set(completionLeaf(value.attemptId, "terminal-checkpoint.json"), true);
      if (value.transitionDigest) {
        refs.set(completionLeaf(value.attemptId, "completion-transition.json"), true);
        refs.set(completionLeaf(value.attemptId, "completion-state-input.json"), true);
      }
      for (const original of Object.values(value.originals)) if (original) refs.set(`${run}/${original.path}`, true);
      refs.set(`${run}/attempts/${value.attemptId}-${value.attemptKind}.json`, true);
    }
    if (run && value.schema === "banzai-completion-transition/v1") refs.set(`${run}/${value.priorState.path}`, true);
    if (run && value.schema === "banzai-completion-candidate/v1") {
      refs.set(completionLeaf(value.attemptId, "completion-input.json"), true);
      refs.set(`${run}/${value.candidatePath}`, true);
    }
    if (run && value.schema === "banzai-completion-publication/v1") {
      refs.set(completionLeaf(value.attemptId, "completion-input.json"), true);
      refs.set(completionLeaf(value.attemptId, "completion-candidate.json"), true);
      refs.set(completionLeaf(value.attemptId, "completion-candidate.md"), true);
      if (value.terminalIntegrityDigest) refs.set(completionLeaf(value.attemptId, "terminal-checkpoint.json"), true);
      refs.set(`${run}/attempts/${value.ledgerAuthor.attemptId}-${value.ledgerAuthor.attemptKind}.json`, true);
    }
    if (run && value.schema === "banzai-terminal-attempt-checkpoint/v2") refs.set(`${run}/attempts/${value.attempt.id}-${value.attempt.kind}.json`, true);
    const evidenceRoot = relative.match(/^(\.banzai\/(?:runs\/[^/]+|work\/[^/]+)\/verification)(?:\/|$)/u)?.[1] ?? (run ? `${run}/verification` : null);
    if (evidenceRoot && value.workId) refs.set(`.banzai/work/${value.workId}/work.json`, true);
    if (value.schema === "banzai-verification-origin-finish/v1") refs.set(`${evidenceRoot}/origins/${value.attemptId}.start.json`, true);
    if (value.schema === "banzai-verification-applicability/v1") refs.set(`${evidenceRoot}/decisions/${value.decisionSha256}.json`, true);
    const visit = (item, key = "") => {
      if (Array.isArray(item)) {
        for (const child of item) visit(child, key);
      } else if (item && typeof item === "object") {
        if (evidenceRoot && item.schema === "banzai-verification-decision/v1") refs.set(`${evidenceRoot}/decisions/${item.sha256}.json`, true);
        if (evidenceRoot && item.schema === "banzai-verification-applicability/v1") refs.set(`${evidenceRoot}/applications/${item.sha256}.json`, true);
        if (key === "origin" && evidenceRoot && /^verification-[a-f0-9-]{36}$/u.test(item.attemptId)) {
          refs.set(`${evidenceRoot}/origins/${item.attemptId}.start.json`, true);
          refs.set(`${evidenceRoot}/origins/${item.attemptId}.finish.json`, true);
        }
        if (key === "artifactBinding") {
          parseBinding(item.binding);
          refs.set(`.banzai/work/${item.binding.workId}/work.json`, true);
          return;
        }
        for (const [name, child] of Object.entries(item)) if (name !== "configPath") visit(child, name);
      } else if (
        typeof item === "string" &&
        /(?:path|paths|description|plan|implementationReport|testReport|work|changeReport)$/iu.test(
          key,
        )
      ) {
        const ref = sourcePath(relative, item, sourceRoot);
        if (ref && !control.test(ref)) refs.set(ref, true);
      }
    };
    visit(value);
  } else if (relative.endsWith(".md")) {
    for (const match of markdownProse(text).matchAll(/\[([^\]\n]*)\]\(([^)\s]+)\)/gu)) {
      const raw = match[2].split("#")[0];
      if (/^(?:https?:|mailto:|#)/u.test(match[2])) continue;
      const ref = sourcePath(relative, raw.startsWith(".") ? raw : `./${raw}`);
      if (ref) {
        const authority = /(?:^|\/)(?:description|plan|work)\.md$/u.test(ref) || /^documentation\/decisions\/(?!README\.md$)[^/]+\.md$/u.test(ref) || /(?:Accepted ADR|Required (?:ADR|description|plan))/iu.test(match[1]);
        const optional = /^Historical \(optional\): /u.test(match[1]);
        refs.set(ref, (refs.get(ref) ?? false) || (authority && !optional));
      }
    }
  }
  return { refs, supported };
}

function localProjectIdentity(root) {
  return `local-sha256:${digestBytes(root)}`;
}

function retainedPaths(manifest, objects) {
  const protectedPaths = new Set();
  for (const pin of manifest.retention.pins) {
    const bindingPath = `.banzai/work/${pin.workId}/work.json`;
    const bindingEntry = manifest.entries.find(entry => entry.path === bindingPath);
    if (!bindingEntry) fail("ARTIFACT_EVIDENCE_INCOMPLETE", "Pinned work has no archived binding provenance.");
    protectedPaths.add(bindingPath);
    for (const entry of manifest.entries) {
      const run = entry.path.match(/^(\.banzai\/runs\/[^/]+)\/state\.json$/u)?.[1];
      if (!run) continue;
      let state;
      try { state = JSON.parse(objects.get(entry.path).toString("utf8")); } catch { continue; }
      if (state?.artifactBinding?.binding?.workId === pin.workId)
        for (const item of manifest.entries) if (item.path.startsWith(`${run}/`)) protectedPaths.add(item.path);
    }
    // All files belonging to the selected work and their required dependencies
    // remain pinned even when an owner policy gives logs a shorter eligibility.
    for (const entry of manifest.entries)
      if (entry.path.startsWith(`.banzai/work/${pin.workId}/`)) protectedPaths.add(entry.path);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of manifest.dependencies) {
      if (protectedPaths.has(edge.from) && edge.required && edge.status === "included" && !protectedPaths.has(edge.to)) {
        protectedPaths.add(edge.to); changed = true;
      }
    }
  }
  return [...protectedPaths].sort();
}

export async function inventoryArtifacts(input) {
  const root = await projectRoot(input.repoRoot);
  const workPaths = input.workPaths ?? [];
  const selectedRunIds = input.runIds ?? [];
  if (!Array.isArray(workPaths) || !Array.isArray(selectedRunIds) ||
      workPaths.length + selectedRunIds.length < 1 || workPaths.length + selectedRunIds.length > LIMIT ||
      selectedRunIds.some(id => typeof id !== "string" || !/^[a-zA-Z0-9_-]+$/u.test(id)))
    fail("ARTIFACT_INPUT_INVALID", "Select a bounded nonempty list of workPaths and/or selectedRunIds.");
  const selectedPaths = [...workPaths.map(relativePath), ...selectedRunIds.map(id => `.banzai/runs/${id}`)];
  const files = new Map();
  const excluded = [];
  const walk = async (relative) => {
    archivePath(relative);
    const target = path.join(root, relative);
    const stat = await lstat(target).catch(() =>
      fail(
        "ARTIFACT_EVIDENCE_INCOMPLETE",
        "Selected archive evidence is unavailable.",
      ),
    );
    await safePath(root, relative, { directory: stat.isDirectory() });
    if (control.test(relative)) {
      excluded.push(relative);
      return;
    }
    if (stat.isDirectory()) {
      for (const name of (await readdir(target)).sort())
        await walk(`${relative}/${name}`);
    } else {
      const bytes = await readBytes(root, relative);
      files.set(relative, { bytes, mode: stat.mode & 0o777 });
      if (files.size > LIMIT)
        fail(
          "ARTIFACT_DISCOVERY_LIMIT",
          "Archive selection exceeds the bounded inventory.",
        );
    }
  };
  for (const relative of selectedPaths) await walk(relative);
  const dependencies = [];
  const uninterpreted = [];
  // Follow recognized references into the same project; never dereference a home,
  // remote, credential directory or external checkout.
  for (const [relative, value] of files) {
    if (/^\.banzai\/work\/[^/]+\/work\.json$/u.test(relative)) {
      const binding = parseBinding(JSON.parse(value.bytes.toString("utf8")));
      for (const target of Object.values(binding.artifacts)) {
        try { await walk(target); } catch (error) { if (error.code !== "ARTIFACT_EVIDENCE_INCOMPLETE") throw error; }
      }
    }
    const run = relative.match(/^(\.banzai\/runs\/[^/]+)\//u)?.[1];
    if (run && !files.has(`${run}/state.json`)) {
      try {
        await walk(`${run}/state.json`);
      } catch {
        /* Missing provenance remains a required edge. */
      }
    }
    let sourceRoot = null;
    try {
      sourceRoot =
        JSON.parse(
          files.get(`${run}/state.json`)?.bytes.toString("utf8") ?? "null",
        )?.repoRoot ?? null;
    } catch {
      /* Unsupported state is reported below. */
    }
    const decoded = dependenciesFor(relative, value.bytes, sourceRoot);
    if (!decoded.supported) uninterpreted.push(relative);
    for (const [reference, required] of decoded.refs) {
      let status = "included";
      if (reference.startsWith("external/")) status = "external";
      else if (!files.has(reference)) {
        try {
          await walk(reference);
        } catch (error) {
          if (
            !["ARTIFACT_EVIDENCE_INCOMPLETE", "ARTIFACT_UNSAFE_PATH"].includes(
              error.code,
            )
          )
            throw error;
          status = "missing";
        }
      }
      if (status === "included" && !files.has(reference)) status = "external";
      dependencies.push({
        sourceId: "project",
        from: relative,
        to: reference,
        required,
        status,
      });
    }
  }
  for (const [relative, value] of files) {
    if (!/^\.banzai\/work\/[^/]+\/work\.json$/u.test(relative)) continue;
    const binding = parseBinding(JSON.parse(value.bytes.toString("utf8")));
    for (const [role, target] of Object.entries(binding.artifacts)) {
      for (const filename of files.keys()) {
        if (filename === target || (role === "reviewDirectory" && filename.startsWith(`${target}/`)))
          dependencies.push({ sourceId: "project", from: relative, to: filename, required: true, status: "included" });
      }
    }
  }
  let sourceCommit = null;
  try {
    sourceCommit = (
      await git(root, ["rev-parse", "--verify", "HEAD^{commit}"])
    ).stdout.trim();
  } catch {
    /* Historical source identity may be absent. */
  }
  const workIds = [],
    runIds = [];
  for (const relative of files.keys()) {
    const work = relative.match(/^\.banzai\/work\/([^/]+)\/work\.json$/u);
    if (work) workIds.push(work[1]);
    const run = relative.match(/^\.banzai\/runs\/([^/]+)\/state\.json$/u);
    if (run) runIds.push(run[1]);
  }
  const entries = [...files]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([relative, value]) => {
      const sha256 = digestBytes(value.bytes);
      return {
        sourceId: "project",
        path: relative,
        size: value.bytes.length,
        mode: value.mode,
        sha256,
        object: `objects/${sha256}`,
      };
    });
  const retention = { policy: "unspecified", rules: {}, ownerPolicy: null, pins: [], deletionAuthorized: false };
  const inventory = {
    schema: ARCHIVE_SCHEMA,
    schemaVersion: 1,
    bundleId: randomUUID(),
    createdAt: new Date().toISOString(),
    sources: [
      {
        id: "project",
        projectIdentity: localProjectIdentity(root),
        sourceCommit,
        workIds,
        runIds,
      },
    ],
    entries,
    dependencies,
    retention,
  };
  return {
    inventory,
    complete:
      dependencies.every(
        (edge) => !edge.required || edge.status === "included",
      ) && uninterpreted.length === 0,
    uninterpreted,
    excluded,
  };
}

export function parseArchive(value) {
  exactObject(value, [
    "schema",
    "schemaVersion",
    "bundleId",
    "createdAt",
    "sources",
    "entries",
    "dependencies",
    "retention",
  ]);
  if (value.schema !== ARCHIVE_SCHEMA || value.schemaVersion !== 1)
    fail(
      "ARTIFACT_VERSION_UNSUPPORTED",
      "Unsupported artifact archive version.",
    );
  bounded(value.bundleId, "bundleId");
  if (
    !Number.isFinite(Date.parse(value.createdAt)) ||
    !Array.isArray(value.sources) ||
    value.sources.length !== 1 ||
    !Array.isArray(value.entries) ||
    value.entries.length > LIMIT ||
    !Array.isArray(value.dependencies) ||
    value.dependencies.length > LIMIT * 10
  )
    fail(
      "ARTIFACT_INPUT_INVALID",
      "Archive inventory is malformed or exceeds its bound.",
    );
  const source = exactObject(value.sources[0], [
    "id",
    "projectIdentity",
    "sourceCommit",
    "workIds",
    "runIds",
  ]);
  if (source.id !== "project")
    fail("ARTIFACT_INPUT_INVALID", "Archive source identity is unsupported.");
  bounded(source.projectIdentity, "projectIdentity");
  if (
    !(
      source.sourceCommit === null ||
      /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(source.sourceCommit)
    ) ||
    !Array.isArray(source.workIds) ||
    !Array.isArray(source.runIds) ||
    [...source.workIds, ...source.runIds].some(
      (id) => typeof id !== "string" || !/^[a-zA-Z0-9_-]+$/u.test(id),
    )
  )
    fail("ARTIFACT_INPUT_INVALID", "Archive provenance is malformed.");
  const paths = new Set();
  for (const entry of value.entries) {
    exactObject(entry, [
      "sourceId",
      "path",
      "size",
      "mode",
      "sha256",
      "object",
    ]);
    archivePath(entry.path);
    if (
      control.test(entry.path) ||
      paths.has(entry.path) ||
      entry.sourceId !== source.id ||
      !Number.isSafeInteger(entry.size) ||
      entry.size < 0 ||
      !Number.isInteger(entry.mode) ||
      entry.mode < 0 ||
      entry.mode > 0o777 ||
      !SHA.test(entry.sha256) ||
      entry.object !== `objects/${entry.sha256}`
    )
      fail(
        "ARTIFACT_INPUT_INVALID",
        "Archive entry identity is malformed or duplicated.",
      );
    paths.add(entry.path);
  }
  for (const edge of value.dependencies) {
    exactObject(edge, ["sourceId", "from", "to", "required", "status"]);
    archivePath(edge.from);
    relativePath(edge.to);
    if (
      edge.sourceId !== source.id ||
      !paths.has(edge.from) ||
      typeof edge.required !== "boolean" ||
      !["included", "missing", "external"].includes(edge.status) ||
      (edge.status === "included" && !paths.has(edge.to))
    )
      fail(
        "ARTIFACT_EVIDENCE_INCOMPLETE",
        "Archive dependency identity is unresolved.",
      );
  }
  const retention = exactObject(value.retention, [
    "policy",
    "rules",
    "deletionAuthorized",
    "ownerPolicy",
    "pins",
  ]);
  if (
    !["banzai", "owner", "unspecified"].includes(retention.policy) ||
    retention.deletionAuthorized !== false
  )
    fail(
      "ARTIFACT_INPUT_INVALID",
      "Archive retention policy cannot authorize deletion.",
    );
  if (retention.policy === "owner") {
    exactObject(retention.ownerPolicy, ["ownerId", "recordedAt", "terms"]);
    bounded(retention.ownerPolicy.ownerId, "retention ownerId");
    if (!Number.isFinite(Date.parse(retention.ownerPolicy.recordedAt)) || typeof retention.ownerPolicy.terms !== "string" || !retention.ownerPolicy.terms.trim() || retention.ownerPolicy.terms.length > 10000)
      fail("ARTIFACT_INPUT_INVALID", "Explicit owner retention terms and provenance are required.");
  } else if (retention.ownerPolicy !== null)
    fail("ARTIFACT_INPUT_INVALID", "Owner policy must be null unless explicitly selected.");
  if (!Array.isArray(retention.pins) || retention.pins.length > LIMIT)
    fail("ARTIFACT_INPUT_INVALID", "Retention pins exceed the inventory bound.");
  const pinned = new Set();
  for (const pin of retention.pins) {
    exactObject(pin, ["sourceId", "workId", "reason", "recordedAt"]);
    bounded(pin.reason, "pin reason");
    if (pin.sourceId !== source.id || !source.workIds.includes(pin.workId) || !paths.has(`.banzai/work/${pin.workId}/work.json`) || !Number.isFinite(Date.parse(pin.recordedAt)) || pinned.has(pin.workId))
      fail("ARTIFACT_INPUT_INVALID", "Pin must identify unique archived work and its source provenance.");
    pinned.add(pin.workId);
  }
  const keys =
    retention.policy === "banzai"
      ? [
          "activeOrPinned",
          "supportedAuthority",
          "closedWork",
          "releaseAndMigration",
          "unreferencedLogs",
          "invalidCandidates",
          "dependencies",
        ]
      : [];
  exactObject(retention.rules, keys);
  const expected = [
    "no-expiry",
    "support-plus-24-months",
    "at-least-24-months",
    "project-lifetime",
    "30-days-after-closure",
    "90-days-after-closure",
    "override-expiry",
  ];
  if (keys.some((key, index) => retention.rules[key] !== expected[index]))
    fail(
      "ARTIFACT_INPUT_INVALID",
      "Archive retention rules differ from their declared policy.",
    );
  return value;
}

export async function verifyArchive(input) {
  const root = await directory(input.bundlePath);
  const manifestBytes = await readBytes(root, "manifest.json", {
    limit: 32 * 1024 * 1024,
  });
  let manifest;
  try {
    manifest = parseArchive(JSON.parse(manifestBytes.toString("utf8")));
  } catch (error) {
    if (error.code) throw error;
    fail("ARTIFACT_INPUT_INVALID", "Archive manifest is not valid JSON.");
  }
  const uninterpreted = [];
  const recordedEdges = new Map(
    manifest.dependencies.map((edge) => [`${edge.from}\0${edge.to}`, edge]),
  );
  const objects = new Map();
  for (const entry of manifest.entries) {
    const bytes = await readBytes(root, entry.object);
    if (bytes.length !== entry.size || digestBytes(bytes) !== entry.sha256)
      fail(
        "ARTIFACT_EVIDENCE_INCOMPLETE",
        "Archive object size or SHA-256 verification failed.",
      );
    objects.set(entry.path, bytes);
  }
  for (const entry of manifest.entries) {
    const bytes = objects.get(entry.path);
    const run = entry.path.match(/^(\.banzai\/runs\/[^/]+)\//u)?.[1];
    let sourceRoot = null;
    try {
      sourceRoot =
        JSON.parse(objects.get(`${run}/state.json`)?.toString("utf8") ?? "null")
          ?.repoRoot ?? null;
    } catch {
      /* Unsupported state is reported below. */
    }
    const decoded = dependenciesFor(entry.path, bytes, sourceRoot);
    if (/^\.banzai\/work\/[^/]+\/work\.json$/u.test(entry.path)) {
      const binding = parseBinding(JSON.parse(bytes.toString("utf8")));
      if (!manifest.sources[0].workIds.includes(binding.workId)) fail("ARTIFACT_EVIDENCE_INCOMPLETE", "Archived work is absent from source provenance.");
      for (const [role, relative] of Object.entries(binding.artifacts)) {
        for (const item of manifest.entries) {
          if (item.path === relative || (role === "reviewDirectory" && item.path.startsWith(`${relative}/`))) decoded.refs.set(item.path, true);
        }
      }
    }
    if (entry.path.endsWith(".json")) {
      let value;
      try {
        value = JSON.parse(bytes.toString("utf8"));
      } catch {
        /* Reported by the versioned reader. */
      }
      if (typeof value?.schema === "string" && /^banzai-verification-(?:decision|applicability|origin-start|origin-finish)\/v1$/u.test(value.schema)) {
        const workOwner = /^\.banzai\/work\/([^/]+)\/verification\//u.exec(entry.path)?.[1];
        const runOwner = /^(\.banzai\/runs\/[^/]+)\/verification\//u.exec(entry.path)?.[1];
        const stateBytes = runOwner ? objects.get(`${runOwner}/state.json`) : null;
        const ownerId = workOwner ?? (stateBytes ? JSON.parse(stateBytes).artifactBinding?.binding?.workId : null);
        if (!ownerId || ownerId !== value.workId)
          fail("ARTIFACT_EVIDENCE_INCOMPLETE", "Archived verification evidence conflicts with its bound owner.");
        if (value.sha256 && !entry.path.endsWith(`/${value.sha256}.json`))
          fail("ARTIFACT_EVIDENCE_INCOMPLETE", "Archived verification decision identity changed.");
      }
      if (value?.schema === "banzai-verification-origin-finish/v1") {
        const startPath = entry.path.replace(/\.finish\.json$/u, ".start.json");
        const startBytes = objects.get(startPath);
        const start = startBytes ? parseVerificationOriginStart(JSON.parse(startBytes)) : null;
        const physicalBytes = start ? objects.get(start.physicalPath) : null;
        if (!start || !physicalBytes || digestBytes(startBytes) !== value.startSha256 ||
            evidenceDigest(parseVerificationAttemptRecord(JSON.parse(physicalBytes))) !== value.physicalSha256 || start.workId !== value.workId || start.attemptId !== value.attemptId)
          fail("ARTIFACT_EVIDENCE_INCOMPLETE", "Archived verification origin closure is missing or changed.");
        const physical = parseVerificationAttemptRecord(JSON.parse(physicalBytes));
        for (const log of [physical.stdout, physical.stderr]) {
          if (log === null) continue;
          const logPath = sourcePath(start.physicalPath, log.relativePath);
          const logBytes = objects.get(logPath);
          if (!logBytes || digestBytes(logBytes) !== log.sha256)
            fail("ARTIFACT_EVIDENCE_INCOMPLETE", "Archived verification origin log changed or is missing.");
        }
      }
      if (value?.schema === "banzai-verification-config-transaction/v1") {
        const transaction = parseVerificationConfigTransaction(value);
        const confirmationPath = entry.path.replace(/\.transaction\.json$/u, ".confirmation.json");
        const confirmationBytes = objects.get(confirmationPath);
        if (!confirmationBytes) fail("ARTIFACT_EVIDENCE_INCOMPLETE", "Configuration transaction confirmation is missing.");
        parseVerificationConfigConfirmation(JSON.parse(confirmationBytes), transaction);
        const stateBytes = objects.get(`${run}/state.json`);
        const state = stateBytes ? JSON.parse(stateBytes) : null;
        if (!state || !(state.schemaVersion === 6 || (state.schemaVersion === 7 && state.configurationSetup)) || state.runId !== transaction.runId || (transaction.continuation && (transaction.continuation.workId !== state.artifactBinding.binding.workId || transaction.continuation.workBindingSha256 !== state.artifactBinding.sha256 || transaction.continuation.baseCommit !== state.baseCommit))) fail("ARTIFACT_EVIDENCE_INCOMPLETE", "Configuration transaction owner conflicts with its retained run.");
      }
      if (value?.schema === "banzai-review-snapshot/v4") {
        for (const change of value.configurationSetup.runnerChanges) {
          const transactionPath = `.banzai/runs/${value.runId}/configuration/${change.transaction.operationId}.transaction.json`;
          const transactionBytes = objects.get(transactionPath);
          const confirmationBytes = objects.get(transactionPath.replace(/\.transaction\.json$/u, ".confirmation.json"));
          if (!transactionBytes || !confirmationBytes) fail("ARTIFACT_EVIDENCE_INCOMPLETE", "Review configuration closure is missing.");
          const transaction = parseVerificationConfigTransaction(JSON.parse(transactionBytes));
          const confirmation = parseVerificationConfigConfirmation(JSON.parse(confirmationBytes), transaction);
          if (JSON.stringify(transaction) !== JSON.stringify(change.transaction) || JSON.stringify(confirmation.preview.delta) !== JSON.stringify(change.delta)) fail("ARTIFACT_EVIDENCE_INCOMPLETE", "Review configuration closure changed.");
        }
      }
      if (value?.schema === "banzai-completion-publication/v1") {
        const attemptLeaf = (leaf) => `${run}/attempts/${value.attemptId}.${leaf}`;
        const captureBytes = objects.get(attemptLeaf("completion-input.json"));
        const candidateBytes = objects.get(attemptLeaf("completion-candidate.json"));
        const candidateText = objects.get(attemptLeaf("completion-candidate.md"));
        if (!captureBytes || !candidateBytes || !candidateText) fail("ARTIFACT_EVIDENCE_INCOMPLETE", "Completion publication closure is missing.");
        const capture = parseCompletionCapture(JSON.parse(captureBytes));
        const candidate = parseCompletionCandidate(JSON.parse(candidateBytes));
        if (capture.integrityDigest !== value.captureDigest || candidate.integrityDigest !== value.candidateDigest || candidate.captureDigest !== capture.integrityDigest || digestBytes(candidateText) !== candidate.outputSha256)
          fail("ARTIFACT_EVIDENCE_INCOMPLETE", "Completion publication closure changed.");
        for (const original of Object.values(capture.originals)) {
          if (!original) continue;
          const bytes = objects.get(`${run}/${original.path}`);
          if (!bytes || digestBytes(bytes) !== original.sha256) fail("ARTIFACT_EVIDENCE_INCOMPLETE", "Completion capture original changed or is missing.");
        }
        if (value.terminalIntegrityDigest) {
          const checkpointBytes = objects.get(attemptLeaf("terminal-checkpoint.json"));
          if (!checkpointBytes || parseTerminalAttemptCheckpoint(JSON.parse(checkpointBytes)).integrityDigest !== value.terminalIntegrityDigest)
            fail("ARTIFACT_EVIDENCE_INCOMPLETE", "Completion terminal proof changed or is missing.");
        }
      }
      if (value?.schema === "banzai-completion-transition/v1") {
        const priorBytes = objects.get(`${run}/${value.priorState.path}`);
        if (!priorBytes || digestBytes(priorBytes) !== value.priorState.sha256)
          fail("ARTIFACT_EVIDENCE_INCOMPLETE", "Completion transition prior state changed or is missing.");
      }
      if (/\.banzai\/runs\/[^/]+\/state\.json$/u.test(entry.path) && value?.schemaVersion === 7 && value.planTaskCompletion?.schemaVersion === 2 && value.planTaskCompletion.status === "valid") {
        const receiptBytes = objects.get(`${run}/${value.planTaskCompletion.publication.path}`);
        if (!receiptBytes || parseCompletionPublication(JSON.parse(receiptBytes)).integrityDigest !== value.planTaskCompletion.publication.sha256)
          fail("ARTIFACT_EVIDENCE_INCOMPLETE", "Published completion receipt changed or is missing.");
      }
      if (value?.artifactBinding?.binding?.workId) {
        const bindingPath = `.banzai/work/${value.artifactBinding.binding.workId}/work.json`;
        const archivedBinding = manifest.entries.find(
          (item) => item.path === bindingPath,
        );
        if (
          archivedBinding &&
          archivedBinding.sha256 !== value.artifactBinding.sha256
        )
          fail(
            "ARTIFACT_EVIDENCE_INCOMPLETE",
            "Archived run or snapshot binding bytes conflict with their recorded identity.",
          );
      }
    }
    if (!decoded.supported) uninterpreted.push(entry.path);
    for (const [ref, required] of decoded.refs)
      if (
        !recordedEdges.has(`${entry.path}\0${ref}`) ||
        (required && recordedEdges.get(`${entry.path}\0${ref}`).required !== true)
      )
        fail(
          "ARTIFACT_EVIDENCE_INCOMPLETE",
          "Archive manifest omits a recognized dependency.",
        );
  }
  return {
    manifest,
    manifestSha256: digestBytes(manifestBytes),
    retainedPaths: retainedPaths(manifest, objects),
    complete:
      !uninterpreted.length &&
      manifest.dependencies.every(
        (edge) => !edge.required || edge.status === "included",
      ),
    uninterpreted,
  };
}

export async function exportArtifacts(input) {
  const destination = await missingDestination(input.destination);
  try {
    await lstat(destination);
    fail(
      "ARTIFACT_DESTINATION_CONFLICT",
      "Archive destination already exists; verify it explicitly.",
    );
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const inventoryBytes = await readInvocationBytes(input.inventoryFile, "inventoryFile", { limit: 32 * 1024 * 1024 });
  let inventory;
  try { inventory = parseArchive(JSON.parse(inventoryBytes.toString("utf8"))); }
  catch (error) { if (error.code) throw error; fail("ARTIFACT_INPUT_INVALID", "Reviewed inventory is not valid JSON."); }
  const result = { inventory, excluded: [] };
  const root = await projectRoot(input.repoRoot);
  if (inventory.sources[0].projectIdentity !== localProjectIdentity(root))
    fail("ARTIFACT_OWNERSHIP_CONFLICT", "Reviewed inventory belongs to another source checkout.");
  for (const entry of inventory.entries) {
    const bytes = await readBytes(root, entry.path);
    const mode = (await lstat(path.join(root, entry.path))).mode & 0o777;
    if (bytes.length !== entry.size || digestBytes(bytes) !== entry.sha256 || mode !== entry.mode)
      fail("ARTIFACT_OWNERSHIP_CONFLICT", "Source bytes or modes no longer match the reviewed inventory. Inspect and inventory again.");
  }
  const temporary = path.join(
    path.dirname(destination),
    `.banzai-archive-${result.inventory.bundleId}`,
  );
  await mkdir(temporary, { mode: 0o700 });
  await makeDirectories(temporary, "objects");
  const written = new Set();
  for (const entry of result.inventory.entries) {
    const bytes = await readBytes(root, entry.path);
    if (digestBytes(bytes) !== entry.sha256)
      fail(
        "ARTIFACT_OWNERSHIP_CONFLICT",
        "Source changed while archiving; incomplete staging evidence was retained.",
      );
    if (!written.has(entry.sha256)) {
      await publishNew(temporary, entry.object, bytes);
      written.add(entry.sha256);
    }
  }
  await publishNew(
    temporary,
    "manifest.json",
    inventoryBytes,
  );
  const verified = await verifyArchive({ bundlePath: temporary });
  const guard = `${destination}.banzai-archive.lock`;
  let handle;
  try {
    handle = await open(guard, "wx", 0o600);
  } catch {
    fail(
      "ARTIFACT_OWNERSHIP_CONFLICT",
      "Archive destination is owned by another operation.",
    );
  }
  const owned = await handle.stat();
  try {
    try {
      await lstat(destination);
      fail(
        "ARTIFACT_DESTINATION_CONFLICT",
        "Archive destination appeared during verification.",
      );
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await rename(temporary, destination);
  } finally {
    await handle.close();
    const current = await lstat(guard);
    if (current.dev === owned.dev && current.ino === owned.ino)
      await unlink(guard);
  }
  return {
    archiveDirectory: destination,
    bundleId: result.inventory.bundleId,
    manifestSha256: verified.manifestSha256,
    complete: verified.complete,
    uninterpreted: verified.uninterpreted,
    excluded: result.excluded,
  };
}

async function withRestoreOwnership(root, action) {
  await makeDirectories(root, ".banzai");
  const relative = ".banzai/runner.lock";
  await safePath(root, relative, { missing: true });
  const token = randomUUID();
  let handle;
  try {
    handle = await open(path.join(root, relative), "wx", 0o600);
  } catch {
    fail(
      "ARTIFACT_OWNERSHIP_CONFLICT",
      "Existing runner ownership prevents archive verification; no lock was reclaimed.",
    );
  }
  const owned = await handle.stat();
  try {
    // The existing RunStore lock protocol: a live pid and token, exclusive
    // acquisition, no stale reclamation, and only the owned inode is released.
    await handle.writeFile(
      JSON.stringify({
        schemaVersion: 1,
        pid: process.pid,
        token,
        createdAt: new Date().toISOString(),
      }) + "\n",
    );
    await handle.sync();
    return await action();
  } finally {
    await handle.close();
    const current = await lstat(path.join(root, relative));
    if (current.dev === owned.dev && current.ino === owned.ino)
      await unlink(path.join(root, relative));
  }
}

export async function restoreArtifacts(input) {
  const verified = await verifyArchive(input);
  if (!verified.complete)
    fail(
      "ARTIFACT_EVIDENCE_INCOMPLETE",
      "Restore requires complete dependency interpretation and closure.",
    );
  const destination = await missingDestination(input.destination);
  const source = verified.manifest.sources[0];
  const receiptPath = ".banzai/archive-manifest.json";
  const receiptBytes = await readBytes(input.bundlePath, "manifest.json", { limit: 32 * 1024 * 1024 });
  if (/(?:^|\/)\.banzai\/(?:work|runs|control)(?:\/|$)/u.test(destination))
    fail("ARTIFACT_UNSAFE_PATH", "Restore requires a separate inactive inspection directory outside managed work, run and control ancestry.");
  const historicalOnly = source.projectIdentity !== localProjectIdentity(destination);
  let exists = false;
  try {
    await lstat(destination);
    exists = true;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (exists)
    return withRestoreOwnership(destination, async () => {
      // An existing target is only a whole verified no-op. Publication of mixed
      // old/new evidence is deliberately refused; use a new restoration directory.
      const active = await readJson(
        destination,
        ".banzai/active-run.json",
        true,
      );
      if (active !== null)
        fail(
          "ARTIFACT_OWNERSHIP_CONFLICT",
          "Restore destination has runner authority; use an inactive fresh directory.",
        );
      for (const entry of verified.manifest.entries) {
        const bytes = await readBytes(destination, entry.path, {
          optional: true,
        });
        if (
          bytes === null ||
          digestBytes(bytes) !== entry.sha256 ||
          ((await lstat(path.join(destination, entry.path))).mode & 0o777) !==
            entry.mode
        )
          fail(
            "ARTIFACT_DESTINATION_CONFLICT",
            "Restore destination has missing or conflicting evidence. Use a fresh directory.",
          );
      }
      const receipt = await readBytes(destination, receiptPath, { optional: true, limit: 32 * 1024 * 1024 });
      if (receipt === null || !receipt.equals(receiptBytes))
        fail("ARTIFACT_DESTINATION_CONFLICT", "Restore provenance or retention receipt is missing or conflicts.");
      return {
        destination,
        bundleId: verified.manifest.bundleId,
        historicalOnly,
        activeRunChanged: false,
        restored: false,
        retentionReceipt: receiptPath,
    retention: verified.manifest.retention,
        retainedPaths: verified.retainedPaths,
      };
    });
  const temporary = path.join(
    path.dirname(destination),
    `.banzai-restore-${randomUUID()}`,
  );
  await mkdir(temporary, { mode: 0o700 });
  // Nothing under a work/run ID becomes visible at the requested destination
  // before all original bytes and modes verify. No active pointer is restored.
  for (const entry of verified.manifest.entries) {
    if (path.posix.dirname(entry.path) !== ".")
      await makeDirectories(temporary, path.posix.dirname(entry.path));
    await publishNew(
      temporary,
      entry.path,
      await readBytes(input.bundlePath, entry.object),
    );
    await chmod(path.join(temporary, entry.path), entry.mode);
    if (digestBytes(await readBytes(temporary, entry.path)) !== entry.sha256)
      fail(
        "ARTIFACT_EVIDENCE_INCOMPLETE",
        "Restored bytes failed verification; staging evidence was retained.",
      );
  }
  await makeDirectories(temporary, ".banzai");
  await publishNew(temporary, receiptPath, receiptBytes);
  // Exclusive sibling lock prevents two cooperating restores from racing the
  // final directory publication. Existing runner evidence is never overwritten.
  const guard = `${destination}.banzai-restore.lock`;
  let handle;
  try {
    handle = await open(guard, "wx", 0o600);
  } catch {
    fail(
      "ARTIFACT_OWNERSHIP_CONFLICT",
      "Restore destination is owned by another operation.",
    );
  }
  try {
    try {
      await lstat(destination);
      fail(
        "ARTIFACT_DESTINATION_CONFLICT",
        "Restore destination appeared during verification.",
      );
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await rename(temporary, destination);
  } finally {
    await handle.close();
    await unlink(guard);
  }
  return {
    destination,
    bundleId: verified.manifest.bundleId,
    historicalOnly,
    activeRunChanged: false,
    restored: true,
    retentionReceipt: receiptPath,
    retention: verified.manifest.retention,
    retainedPaths: verified.retainedPaths,
  };
}
