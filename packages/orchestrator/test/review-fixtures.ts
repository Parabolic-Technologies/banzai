import { boundWorkFixture } from "./helpers.js";
import {
  evidenceDigest,
  verificationApplicability
} from "../src/verification-evidence.js";
import { createHash } from "node:crypto";
import type {
  CurrentReviewResult,
  ReviewArtifactContext,
  ReviewResult,
  ReviewSnapshot
} from "../src/types.js";
import { digestArtifactEntries } from "../src/git.js";
import { sealReviewSnapshot } from "../src/review-snapshot.js";

export function reviewSnapshotFixture(
  overrides: Partial<Omit<ReviewSnapshot, "digest">> = {}
): ReviewSnapshot {
  const bound = overrides.artifactBinding ?? boundWorkFixture();
  const { description, plan } = bound.binding.artifacts;
  if (!description || !plan) throw new Error("Fixture requires strict roles.");
  const decisionBody = {
    schema: "banzai-verification-decision/v1" as const,
    schemaVersion: 1 as const,
    workId: bound.binding.workId,
    roundId: "fixture-round",
    candidateDigest: null,
    authorityDigest: "a".repeat(64),
    configurationDigest: "b".repeat(64),
    actions: []
  };
  const decision = { ...decisionBody, sha256: evidenceDigest(decisionBody) };
  const applicability = verificationApplicability(decision, [], {
    complete: false,
    reason: "policy_disabled",
    candidateDigest: null,
    checks: []
  });
  const workspaceDigest = createHash("sha256")
    .update(
      JSON.stringify({
        version: 2,
        baseCommit: "c".repeat(40),
        artifactBindingDigest: bound.sha256,
        entries: []
      })
    )
    .digest("hex");
  const artifact: ReviewArtifactContext = {
    path: `${bound.binding.artifacts.reviewDirectory}/review-1.md`,
    candidatePath:
      ".banzai/runs/review-fixture/attempts/review-1.review-candidate.md",
    slug: "example",
    iteration: 1,
    approvedArtifactPaths: [description, plan],
    workspaceDigest,
    verificationEvidence: {
      decision,
      applicability,
      origins: [],
      attempts: []
    },
    verification: [
      {
        name: "unit ` tests",
        command: "node",
        args: ["test.js", "--name=a|b"],
        exitCode: 1,
        signal: "SIGTERM",
        stdoutPath: "logs/out",
        stderrPath: "logs/err",
        startedAt: "2026-09-08T01:00:00.000Z",
        completedAt: "2026-09-08T01:01:00.000Z"
      }
    ]
  };
  const approvedArtifacts = artifact.approvedArtifactPaths.map((path) => ({
    path,
    sha256: "e".repeat(64)
  }));
  const body = {
    schema: "banzai-review-snapshot/v3" as const,
    schemaVersion: 3 as const,
    artifactBinding: bound,
    runId: "review-fixture",
    attemptId: "review-1",
    outputContract: "review-result/v2" as const,
    baseCommit: "c".repeat(40),
    approval: {
      kind: "plan" as const,
      digest: digestArtifactEntries(approvedArtifacts),
      paths: artifact.approvedArtifactPaths,
      approvedBy: "human",
      approvedAt: "2026-09-08T00:00:00.000Z"
    },
    approvedArtifacts,
    workspace: {
      schemaVersion: 2 as const,
      artifactBindingDigest: bound.sha256,
      baseCommit: "c".repeat(40),
      digest: artifact.workspaceDigest,
      entries: []
    },
    reviewMode: "full" as const,
    changes: [],
    anchor: null,
    fullReviewAnchor: null,
    triage: [],
    requiredFindingIds: ["R1-F1"],
    completionSource: null,
    artifact,
    ...overrides
  };
  return sealReviewSnapshot(body);
}

/** Synthetic reviewer assertion, never a production fallback. */
export function currentReviewFixture(
  snapshot: ReviewSnapshot,
  overrides: Partial<ReviewResult> = {}
): CurrentReviewResult {
  return {
    contractVersion: "1.0.0",
    schemaVersion: 2,
    verdict: "pass",
    summary: "Reviewed the approved scope.",
    findings: [],
    reviewedFindingIds: snapshot.requiredFindingIds,
    deferredCoverage: [],
    reviewNotes: [],
    ...overrides,
    scopeAcknowledgment: overrides.scopeAcknowledgment ?? {
      schemaVersion: 1,
      snapshotDigest: snapshot.digest,
      artifacts: snapshot.approval.paths.map((path) => ({
        path,
        status: "reviewed",
        reason: null
      }))
    }
  };
}
