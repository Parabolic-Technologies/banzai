import { parseReviewVerificationEvidence } from "./verification-store.mjs";
import { createHash } from "node:crypto";
import {
  parseBinding,
  unsupportedResourceVersion,
  canonicalJson,
  ArtifactStorageError as BanzaiError,
} from "./artifact-storage.mjs";
const digestCanonicalJson = (value) =>
  createHash("sha256").update(canonicalJson(value)).digest("hex");
const digestArtifactEntries = (entries) =>
  createHash("sha256")
    .update(JSON.stringify({ version: 1, entries }))
    .digest("hex");
function reviewScopePath(name) {
  if (
    typeof name !== "string" ||
    name.trim().length === 0 ||
    /^[A-Za-z]:/u.test(name) ||
    /[\\\0\r\n]/u.test(name) ||
    name.startsWith("/") ||
    name.split("/").some((part) => part === "" || part === "." || part === "..")
  )
    throw new BanzaiError(
      "INVALID_REVIEW_SCOPE",
      "Scope paths must be exact normalized repository-relative paths.",
    );
  return name;
}
function invalid(message) {
  throw new BanzaiError("INVALID_REVIEW_SNAPSHOT", message);
}
function sealReviewSnapshot(value) {
  const snapshot = JSON.parse(JSON.stringify(value));
  return parseReviewSnapshot({
    ...snapshot,
    digest: digestCanonicalJson(snapshot),
  });
}
function parseReviewSnapshot(value) {
  try {
    return parseSnapshot(value);
  } catch (error) {
    if (
      error instanceof BanzaiError &&
      ["INVALID_REVIEW_SNAPSHOT", "RESOURCE_VERSION_UNSUPPORTED"].includes(error.code)
    )
      throw error;
    invalid("Review snapshot contains invalid nested evidence.");
  }
}
function object(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function equal(value, expected) {
  return value === expected;
}
function parseSnapshot(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    invalid("Review snapshot must be an object.");
  if (value.schema !== "banzai-review-snapshot/v3" || value.schemaVersion !== 3)
    unsupportedResourceVersion("review snapshot", `${value.schema} (${value.schemaVersion})`, "banzai-review-snapshot/v3 (3)");
  const snapshot = value;
  const { digest, ...body } = snapshot;
  const keys = [
    "schema",
    "schemaVersion",
    "runId",
    "attemptId",
    "outputContract",
    "baseCommit",
    "approval",
    "approvedArtifacts",
    "workspace",
    "reviewMode",
    "changes",
    "anchor",
    "fullReviewAnchor",
    "triage",
    "requiredFindingIds",
    "completionSource",
    "artifact",
    "digest",
  ];
  keys.push("artifactBinding");
  if (
    Object.keys(snapshot).length !== keys.length ||
    Object.keys(snapshot).some((key) => !keys.includes(key)) ||
    !equal(snapshot.outputContract, "review-result/v2") ||
    !/^[a-f0-9]{64}$/u.test(digest) ||
    digest !== digestCanonicalJson(body)
  )
    invalid("Review snapshot version, shape or digest is invalid.");
  for (const id of [snapshot.runId, snapshot.attemptId])
    if (typeof id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(id))
      invalid("Review snapshot identity is invalid.");
  {
    const bound = snapshot.artifactBinding;
    if (
      !bound ||
      Object.keys(bound).sort().join(",") !== "binding,sha256" ||
      !/^[a-f0-9]{64}$/u.test(bound.sha256)
    )
      invalid("Review snapshot binding is missing or malformed.");
    parseBinding(bound.binding);
    const workspace = snapshot.workspace;
    if (
      workspace.schemaVersion !== 2 ||
      workspace.artifactBindingDigest !== bound.sha256 ||
      Object.keys(workspace).sort().join(",") !==
        "artifactBindingDigest,baseCommit,digest,entries,schemaVersion"
    )
      invalid("Review snapshot workspace does not match its binding.");
    const expectedDigest = createHash("sha256")
      .update(
        JSON.stringify({
          version: 2,
          baseCommit: workspace.baseCommit,
          artifactBindingDigest: bound.sha256,
          entries: workspace.entries,
        }),
      )
      .digest("hex");
    if (
      workspace.digest !== expectedDigest ||
      new Set(workspace.entries.map((entry) => entry.path)).size !==
        workspace.entries.length ||
      canonicalJson(workspace.entries) !==
        canonicalJson(
          [...workspace.entries].sort((a, b) =>
            a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
          ),
        )
    )
      invalid("Review snapshot workspace entries or digest are invalid.");
    const roles = bound.binding.artifacts;
    if (
      snapshot.artifact.path !==
        `${roles.reviewDirectory}/review-${snapshot.artifact.iteration}.md` ||
      snapshot.approval.paths.some(
        (p) =>
          p !== roles.description &&
          p !== roles.plan &&
          !/^documentation\/decisions\/[0-9]{4}-[a-z0-9-]+\.md$/u.test(p),
      ) ||
      (snapshot.completionSource !== null &&
        (snapshot.completionSource.implementationReport.path !==
          roles.implementationReport ||
          snapshot.completionSource.testReport.path !== roles.testReport))
    )
      invalid("Review snapshot evidence is outside its exact bound roles.");
  }
  const artifact = snapshot.artifact;
  const evidence = parseReviewVerificationEvidence(artifact.verificationEvidence);
  if (evidence.decision.workId !== snapshot.artifactBinding.binding.workId) invalid("Cross-work review verification evidence.");
  if (
    !object(artifact) ||
    !object(snapshot.approval) ||
    !object(snapshot.workspace) ||
    !Array.isArray(snapshot.approval.paths) ||
    !Array.isArray(snapshot.approvedArtifacts) ||
    !Array.isArray(snapshot.workspace.entries) ||
    !Array.isArray(snapshot.changes) ||
    !Array.isArray(snapshot.triage) ||
    !Array.isArray(snapshot.requiredFindingIds) ||
    !Array.isArray(artifact.verification) ||
    !["full", "delta"].includes(snapshot.reviewMode) ||
    !Number.isInteger(artifact.iteration) ||
    artifact.iteration < 1
  )
    invalid("Review snapshot evidence is malformed.");
  if (
    "snapshot" in artifact ||
    JSON.stringify(artifact.approvedArtifactPaths) !==
      JSON.stringify(snapshot.approval.paths) ||
    artifact.workspaceDigest !== snapshot.workspace.digest ||
    snapshot.baseCommit !== snapshot.workspace.baseCommit ||
    new Set(snapshot.approval.paths).size !== snapshot.approval.paths.length ||
    snapshot.approvedArtifacts.length !== snapshot.approval.paths.length
  )
    invalid("Review snapshot scope and workspace identities disagree.");
  if (
    snapshot.approvedArtifacts.some(
      (entry, index) =>
        entry.path !== snapshot.approval.paths[index] ||
        !/^[a-f0-9]{64}$/u.test(entry.sha256),
    )
  )
    invalid("Approved artifact identities disagree with snapshot scope.");
  if (
    digestArtifactEntries(snapshot.approvedArtifacts) !==
    snapshot.approval.digest
  )
    invalid(
      "Review snapshot file identities do not match the approved bundle digest.",
    );
  snapshot.approval.paths.forEach(reviewScopePath);
  reviewScopePath(artifact.path);
  reviewScopePath(artifact.candidatePath);
  if (
    new Set(snapshot.requiredFindingIds).size !==
      snapshot.requiredFindingIds.length ||
    snapshot.requiredFindingIds.some(
      (id) =>
        typeof id !== "string" || !/^R[1-9][0-9]*-F[1-9][0-9]*$/u.test(id),
    )
  )
    invalid("Snapshot accepted finding IDs are invalid.");
  const hash = (value2) =>
    typeof value2 === "string" && /^[a-f0-9]{64}$/u.test(value2);
  const string = (value2) => typeof value2 === "string" && value2.length > 0;
  if (
    !string(snapshot.baseCommit) ||
    !equal(snapshot.approval.kind, "plan") ||
    !hash(snapshot.approval.digest) ||
    !string(snapshot.approval.approvedBy) ||
    !string(snapshot.approval.approvedAt) ||
    !hash(snapshot.workspace.digest) ||
    !string(artifact.slug)
  )
    invalid("Snapshot authority identity is malformed.");
  const anchor = snapshot.fullReviewAnchor;
  if (
    anchor !== null &&
    (!Number.isInteger(anchor.iteration) ||
      anchor.iteration < 1 ||
      !string(anchor.sessionId) ||
      !hash(anchor.approvalDigest) ||
      !equal(anchor.outputContract, "review-result/v2"))
  )
    invalid("Full review anchor is malformed.");
  if (
    snapshot.reviewMode === "delta" &&
    (snapshot.anchor === null ||
      anchor?.approvalDigest !== snapshot.approval.digest ||
      anchor.iteration > snapshot.anchor.iteration ||
      snapshot.anchor.iteration >= artifact.iteration ||
      !["full", "delta"].includes(snapshot.anchor.mode))
  )
    invalid(
      "Delta snapshot needs a compatible full review and canonical anchor.",
    );
  for (const entry of snapshot.workspace.entries) {
    reviewScopePath(entry.path);
    if (!string(entry.kind) || (entry.sha256 !== null && !hash(entry.sha256)))
      invalid("Snapshot workspace entry is malformed.");
  }
  for (const change of snapshot.changes) {
    reviewScopePath(change.path);
    if (!["added", "modified", "deleted"].includes(change.change))
      invalid("Snapshot change is malformed.");
  }
  for (const verification of artifact.verification) {
    if (
      !string(verification.name) ||
      !string(verification.command) ||
      !Array.isArray(verification.args) ||
      verification.args.some((arg) => typeof arg !== "string") ||
      !Number.isInteger(verification.exitCode) ||
      (verification.signal !== null && !string(verification.signal)) ||
      !string(verification.startedAt) ||
      !string(verification.completedAt)
    )
      invalid("Snapshot verification is malformed.");
    reviewScopePath(verification.stdoutPath);
    reviewScopePath(verification.stderrPath);
  }
  if (snapshot.completionSource !== null) {
    const source = snapshot.completionSource;
    const projection = artifact.taskCompletion;
    if (
      !equal(source.schemaVersion, 1) ||
      !equal(source.status, "valid") ||
      !string(source.sourceAttemptId) ||
      !["implementation", "fix"].includes(source.sourceAttemptKind ?? "") ||
      source.approvalDigest !== snapshot.approval.digest ||
      !hash(source.ledgerDigest) ||
      !hash(source.planTaskDigest) ||
      source.ledgerDigest !== projection?.ledgerDigest ||
      source.planTaskDigest !== projection.planTaskDigest ||
      source.approvalDigest !== projection.approvalDigest ||
      source.counts.total !== projection.total ||
      source.counts.completed !== projection.completed ||
      source.implementationReport.path !== projection.implementationReport ||
      source.testReport.path !== projection.testReport
    )
      invalid("Snapshot completion identities disagree.");
    for (const report of [source.implementationReport, source.testReport]) {
      reviewScopePath(report.path);
      if (!hash(report.sha256))
        invalid("Snapshot report identity is malformed.");
    }
  } else if (artifact.taskCompletion != null)
    invalid("Snapshot completion projection lacks original source evidence.");
  return snapshot;
}
export { parseReviewSnapshot, sealReviewSnapshot };
