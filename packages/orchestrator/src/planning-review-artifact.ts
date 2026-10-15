import { randomUUID, createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { BanzaiError } from "./errors.js";
import { readBytes, safePath, verifyExecutionIgnore } from "./project-files.js";
import {
  inspectBoundWork,
  verifyDocumentVisibility,
  type ArtifactBoundWork
} from "./work-documents.js";
import {
  publishArtifactBytes,
  reviewValue,
  type ValidatedReviewCandidate
} from "./review-artifact.js";
import {
  digestCanonicalJson,
  validatePlanningReviewResult
} from "./validation.js";
import type { PlanningReviewEpisode, PlanningReviewResult } from "./types.js";

export function planningReviewArtifactPath(
  bound: ArtifactBoundWork,
  reviewNumber: number
): string {
  if (
    !Number.isSafeInteger(reviewNumber) ||
    reviewNumber < 1 ||
    reviewNumber > 1_000_000
  )
    throw new BanzaiError(
      "INVALID_DECISION",
      "Invalid planning review number."
    );
  return `${bound.binding.artifacts.reviewDirectory}/planning-review-${reviewNumber}.md`;
}
export function renderPlanningReviewArtifact(
  episode: PlanningReviewEpisode,
  result: PlanningReviewResult
): string {
  validatePlanningReviewResult(result, episode);
  if (episode.reviewer === null)
    throw new BanzaiError(
      "INVALID_PLANNING_REVIEW_ARTIFACT",
      "The publishing reviewer identity is missing."
    );
  return [
    "# Independent Planning Review",
    "",
    "Format: banzai-planning-review/v1",
    "",
    "## Review Context",
    "",
    reviewValue({
      reviewNumber: episode.reviewNumber,
      originGate: episode.originGate,
      requestedAt: episode.requestedAt,
      reviewer: episode.reviewer
    }),
    "",
    "## Reviewed Scope",
    "",
    reviewValue(result.scope),
    "",
    "## Result Identity",
    "",
    reviewValue({
      resultDigest: digestCanonicalJson(result),
      findingCount: result.findings.length
    }),
    "",
    "## Findings",
    "",
    ...(result.findings.length === 0
      ? ["Independent review found no issues."]
      : result.findings.map((f) => reviewValue(f))),
    ""
  ].join("\n");
}
export function validatePlanningReviewCandidate(
  contents: string,
  episode: PlanningReviewEpisode,
  result: PlanningReviewResult
): ValidatedReviewCandidate {
  if (contents !== renderPlanningReviewArtifact(episode, result))
    throw new BanzaiError(
      "INVALID_PLANNING_REVIEW_ARTIFACT",
      "Planning review candidate differs from its validated evidence."
    );
  return {
    contents,
    sha256: createHash("sha256").update(contents).digest("hex")
  };
}
export async function publishPlanningReviewArtifact(
  repoRoot: string,
  bound: ArtifactBoundWork,
  episode: PlanningReviewEpisode,
  result: PlanningReviewResult,
  candidatePath: string
): Promise<{ path: string; sha256: string }> {
  await inspectBoundWork(repoRoot, bound);
  const relative = planningReviewArtifactPath(bound, episode.reviewNumber);
  const candidate = validatePlanningReviewCandidate(
    renderPlanningReviewArtifact(episode, result),
    episode,
    result
  );
  const verify = async (): Promise<void> => {
    await safePath(repoRoot, relative, { missing: true });
    await verifyDocumentVisibility(repoRoot, bound.binding.artifacts, [
      relative
    ]);
    await verifyExecutionIgnore(repoRoot, candidatePath);
  };
  const conflict = (): never => {
    throw new BanzaiError(
      "PLANNING_REVIEW_PUBLICATION_CONFLICT",
      `Planning review publication conflict: ${relative} exists with different content.`
    );
  };
  await verify();
  const contentBytes = Buffer.from(candidate.contents, "utf8");
  const existing = await readBytes(repoRoot, relative, { optional: true });
  if (existing !== null) {
    if (!existing.equals(contentBytes)) conflict();
    return { path: relative, sha256: candidate.sha256 };
  }
  const temporary = `${candidatePath}.${randomUUID()}.publication.tmp`;
  await safePath(repoRoot, temporary, { missing: true });
  await verifyExecutionIgnore(repoRoot, temporary);
  await mkdir(path.dirname(path.join(repoRoot, temporary)), {
    recursive: true,
    mode: 0o700
  });
  try {
    await publishArtifactBytes(
      path.join(repoRoot, temporary),
      path.join(repoRoot, relative),
      candidate.contents,
      verify,
      true
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const bytes = await readBytes(repoRoot, relative);
    if (!bytes?.equals(contentBytes)) conflict();
  }
  await verify();
  return { path: relative, sha256: candidate.sha256 };
}
