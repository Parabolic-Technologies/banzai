import {
  inspectBoundWork,
  verifyIgnores,
  type ArtifactBoundWork
} from "./artifact-storage.js";
import { createHash, randomUUID } from "node:crypto";
import { link, mkdir, open, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { BanzaiError, ResourceVersionUnsupportedError } from "./errors.js";
import {
  assertReviewPathOwned,
  parseReviewSnapshot
} from "./review-snapshot.js";
import { parseCurrentReviewResult, validateReviewScope } from "./validation.js";
import type {
  ReviewArtifactContext,
  ReviewResult,
  VerificationResult
} from "./types.js";

export interface ValidatedReviewCandidate {
  contents: string;
  sha256: string;
}

export class ReviewArtifactValidationError extends BanzaiError {
  readonly diagnostics: readonly string[];

  constructor(diagnostics: readonly string[]) {
    // Keep the persisted first-error diagnostic stable while repair receives
    // every mismatch from the same candidate snapshot.
    super(
      "INVALID_REVIEW_ARTIFACT",
      diagnostics[0] ?? "Review artifact failed content validation."
    );
    this.name = "ReviewArtifactValidationError";
    this.diagnostics = [...diagnostics];
  }
}

export function reviewArtifactPath(
  slug: string,
  iteration: number,
  bound: ArtifactBoundWork
): string {
  return `${bound.binding.artifacts.reviewDirectory}/review-${iteration}.md`;
}

export function renderVerificationEvidence(
  verification: readonly VerificationResult[]
): string {
  return verification.length === 0
    ? "- None recorded."
    : verification
        .map(
          (item) =>
            `- \`${item.name}\`: exit=${item.exitCode}, command=\`${[
              item.command,
              ...item.args
            ].join(" ")}\``
        )
        .join("\n");
}

export function renderPlanTaskReviewEvidence(
  completion: ReviewArtifactContext["taskCompletion"]
): string {
  if (completion === undefined || completion === null) {
    return "- Unavailable.";
  }
  return [
    `- Approval digest: \`${completion.approvalDigest}\``,
    `- Plan task digest: \`${completion.planTaskDigest}\``,
    `- Ledger digest: \`${completion.ledgerDigest}\``,
    `- Completion: \`${completion.completed}/${completion.total}\``,
    `- Implementation report: \`${completion.implementationReport}\``,
    `- Test report: \`${completion.testReport}\``,
    ...completion.tasks.map(
      (task) =>
        `- \`${task.taskId}\`: \`${task.status}\`; evidence=${JSON.stringify(task.evidence)}; gap=${JSON.stringify(task.gap)}`
    )
  ].join("\n");
}

export function renderReviewArtifact(
  result: ReviewResult,
  context: ReviewArtifactContext
): string {
  return renderCurrentReviewArtifact(result, context);
}

function reviewValue(value: unknown): string {
  const ordered = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(ordered);
    if (value !== null && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, item]) => [key, ordered(item)])
      );
    return value;
  };
  const text = JSON.stringify(ordered(value), null, 2);
  const fence = "`".repeat(
    Math.max(
      3,
      ...[...text.matchAll(/`+/gu)].map((match) => match[0].length + 1)
    )
  );
  return `${fence}json\n${text}\n${fence}`;
}

function renderCurrentReviewArtifact(
  value: ReviewResult,
  context: ReviewArtifactContext
): string {
  const result = parseCurrentReviewResult(value);
  const snapshot = parseReviewSnapshot(context.snapshot);
  validateReviewScope(result, {
    snapshotDigest: snapshot.digest,
    approvedArtifactPaths: snapshot.approval.paths,
    requiredFindingIds: snapshot.requiredFindingIds
  });
  if (
    JSON.stringify({ ...context, snapshot: undefined }) !==
    JSON.stringify({ ...snapshot.artifact, snapshot: undefined })
  ) {
    // Compare values canonically below; property insertion order is not evidence.
    if (
      reviewValue({ ...context, snapshot: undefined }) !==
      reviewValue(snapshot.artifact)
    )
      throw new BanzaiError(
        "INVALID_REVIEW_SNAPSHOT",
        "Rendering context differs from the recorded review snapshot."
      );
  }
  const coverage = snapshot.approval.paths.map((path) =>
    result.scopeAcknowledgment.artifacts.find((entry) => entry.path === path)
  );
  const handoff = {
    pass: "The review passed. No finding triage is required.",
    changes_requested:
      "Human triage is required. Only explicitly accepted finding IDs may enter the fix phase.",
    blocked:
      "Review is blocked. Required coverage remains incomplete where recorded. Resolve the blocker before an explicit review retry.",
    replan_required:
      "Review requires replanning through the existing human approval lifecycle."
  }[result.verdict];
  return [
    "# Implementation Review",
    "- Format: `banzai-feature-review/v4`",
    reviewValue({
      slug: context.slug,
      iteration: context.iteration,
      verdict: result.verdict,
      artifactPath: context.path,
      workspaceDigest: context.workspaceDigest,
      snapshotDigest: snapshot.digest,
      workId: snapshot.artifactBinding.binding.workId,
      snapshotSchema: snapshot.schema,
      resultContract: snapshot.outputContract
    }),
    "## Review Scope",
    "### Runner-required approved scope",
    reviewValue(snapshot.approval.paths),
    "### Reviewer-acknowledged coverage",
    "An acknowledgment is a reviewer assertion, not independent proof of reading or substantive assessment.",
    reviewValue({
      schemaVersion: result.scopeAcknowledgment.schemaVersion,
      snapshotDigest: result.scopeAcknowledgment.snapshotDigest,
      reviewMode: snapshot.reviewMode,
      artifacts: coverage
    }),
    "### Recorded verification (runner evidence)",
    reviewValue(snapshot.artifact.verificationEvidence),
    "### Validated plan task completion (runner evidence)",
    reviewValue({
      source: snapshot.completionSource,
      projection: snapshot.artifact.taskCompletion ?? null
    }),
    "## Summary",
    reviewValue(result.summary),
    "## Findings",
    result.findings.length === 0
      ? "No findings."
      : result.findings
          .map((finding) => `### ${finding.id}\n\n${reviewValue(finding)}`)
          .join("\n\n"),
    "## Previously Accepted Findings",
    reviewValue({
      reviewedFindingIds: result.reviewedFindingIds,
      unreviewedFindingIds: snapshot.requiredFindingIds.filter(
        (id) => !result.reviewedFindingIds.includes(id)
      )
    }),
    "## Review Notes",
    reviewValue(result.reviewNotes),
    "## Deferred Coverage",
    reviewValue(result.deferredCoverage),
    "## Handoff",
    handoff,
    ""
  ]
    .join("\n\n")
    .replace(/\n+$/u, "\n");
}

function repositoryPath(repoRoot: string, relativePath: string): string {
  const repositoryRoot = path.resolve(repoRoot);
  const absolutePath = path.resolve(repositoryRoot, relativePath);
  if (!absolutePath.startsWith(`${repositoryRoot}${path.sep}`)) {
    throw new BanzaiError(
      "INVALID_REVIEW_ARTIFACT_PATH",
      "Review artifact path escapes the repository."
    );
  }
  return absolutePath;
}

async function validateReviewArtifactSource(
  repoRoot: string,
  result: ReviewResult,
  context: ReviewArtifactContext,
  sourcePath: string
): Promise<ValidatedReviewCandidate> {
  const snapshot = parseReviewSnapshot(context.snapshot);
  await inspectBoundWork(repoRoot, snapshot.artifactBinding);
  const expectedPath = reviewArtifactPath(
    context.slug,
    context.iteration,
    snapshot.artifactBinding
  );
  if (context.path !== expectedPath) {
    throw new BanzaiError(
      "INVALID_REVIEW_ARTIFACT_PATH",
      `Review artifact must be written to ${expectedPath}.`
    );
  }
  const absolutePath = repositoryPath(repoRoot, context.path);
  const absoluteCandidatePath = repositoryPath(repoRoot, sourcePath);
  await assertReviewPathOwned(repoRoot, sourcePath, true);
  await assertReviewPathOwned(repoRoot, context.path, true);
  if (absoluteCandidatePath === absolutePath) {
    throw new BanzaiError(
      "INVALID_REVIEW_ARTIFACT_PATH",
      "Review candidate path must differ from the canonical artifact path."
    );
  }
  const contents = await readFile(absoluteCandidatePath, "utf8").catch(() => {
    throw new BanzaiError(
      "REVIEW_ARTIFACT_MISSING",
      `Reviewer did not write candidate ${sourcePath}.`
    );
  });

  const format = /^- Format: `([^`]+)`$/mu.exec(contents)?.[1];
  if (format !== undefined && format !== "banzai-feature-review/v4")
    throw new ResourceVersionUnsupportedError(
      "runner review artifact",
      format,
      "banzai-feature-review/v4"
    );
  const expected = renderReviewArtifact(result, context);
  if (contents !== expected)
    throw new ReviewArtifactValidationError([
      "Review candidate bytes differ from the deterministic snapshot projection."
    ]);
  return {
    contents,
    sha256: createHash("sha256").update(contents).digest("hex")
  };
}

export async function validateReviewArtifact(
  repoRoot: string,
  result: ReviewResult,
  context: ReviewArtifactContext
): Promise<ValidatedReviewCandidate> {
  return await validateReviewArtifactSource(
    repoRoot,
    result,
    context,
    context.candidatePath
  );
}

export async function publishReviewArtifact(
  repoRoot: string,
  context: ReviewArtifactContext,
  candidate: ValidatedReviewCandidate
): Promise<void> {
  if (
    createHash("sha256").update(candidate.contents).digest("hex") !==
    candidate.sha256
  ) {
    throw new BanzaiError(
      "INVALID_REVIEW_CANDIDATE_EVIDENCE",
      "Review candidate publication proof does not match its contents."
    );
  }
  const snapshot = parseReviewSnapshot(context.snapshot);
  await inspectBoundWork(repoRoot, snapshot.artifactBinding);
  const expectedPath = reviewArtifactPath(
    context.slug,
    context.iteration,
    snapshot.artifactBinding
  );
  if (context.path !== expectedPath) {
    throw new BanzaiError(
      "INVALID_REVIEW_ARTIFACT_PATH",
      `Review artifact must be written to ${expectedPath}.`
    );
  }
  const absolutePath = repositoryPath(repoRoot, context.path);
  {
    await assertReviewPathOwned(repoRoot, context.path, true);
    const previous = await readFile(absolutePath, "utf8").catch(
      (error: unknown) => {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
    );
    if (previous !== null) {
      if (previous !== candidate.contents)
        throw new BanzaiError(
          "INVALID_REVIEW_CANDIDATE_EVIDENCE",
          "Canonical review already contains different evidence."
        );
      return;
    }
  }
  const temporaryPath = `${absolutePath}.${randomUUID()}.tmp`;
  const binding = snapshot.artifactBinding.binding;
  const verifyDestinations = async () => {
    await verifyIgnores(repoRoot, binding, [
      context.path,
      path.relative(repoRoot, temporaryPath)
    ]);
  };
  await verifyDestinations();
  await mkdir(path.dirname(absolutePath), {
    recursive: true,
    mode: 0o700
  });
  const handle = await open(temporaryPath, "wx", 0o600);
  try {
    try {
      await handle.writeFile(candidate.contents, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await verifyDestinations();
    // Exclusive atomic publication cannot replace a concurrently created artifact.
    await link(temporaryPath, absolutePath);
    await unlink(temporaryPath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}
