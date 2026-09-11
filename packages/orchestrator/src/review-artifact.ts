import {
  inspectBoundWork,
  verifyIgnores,
  type ArtifactBoundWork
} from "./artifact-storage.js";
import { createHash, randomUUID } from "node:crypto";
import { link, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { BanzaiError } from "./errors.js";
import {
  assertReviewPathOwned,
  parseReviewSnapshot
} from "./review-snapshot.js";
import { parseCurrentReviewResult, validateReviewScope } from "./validation.js";
import type {
  ReviewArtifactContext,
  ReviewFinding,
  ReviewResult,
  VerificationResult
} from "./types.js";

const REQUIRED_SECTIONS = [
  "## Review Scope",
  "## Summary",
  "## Findings",
  "## Previously Accepted Findings",
  "## Deferred Coverage",
  "## Handoff"
] as const;

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
  bound?: ArtifactBoundWork
): string {
  if (bound !== undefined)
    return `${bound.binding.artifacts.reviewDirectory}/review-${iteration}.md`;
  return path.posix.join(
    "documentation",
    "features",
    slug,
    `review-${iteration}.md`
  );
}

function evidenceLocation(finding: ReviewFinding): string[] {
  return finding.evidence.map((evidence) =>
    evidence.line === null ? evidence.path : `${evidence.path}:${evidence.line}`
  );
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
  if (result.schemaVersion === 2)
    return renderCurrentReviewArtifact(result, context);
  const approvedArtifacts = context.approvedArtifactPaths
    .map((artifactPath) => `- \`${artifactPath}\``)
    .join("\n");
  const verification = renderVerificationEvidence(context.verification);
  const taskCompletion = renderPlanTaskReviewEvidence(context.taskCompletion);
  const findings =
    result.findings.length === 0
      ? "No findings."
      : result.findings
          .map((finding) => {
            const evidence = finding.evidence
              .map((item) => {
                const location =
                  item.line === null ? item.path : `${item.path}:${item.line}`;
                return `  - \`${location}\` — ${item.detail}`;
              })
              .join("\n");
            const violates =
              finding.violates.length === 0
                ? "None recorded."
                : finding.violates.map((item) => `\`${item}\``).join(", ");
            return `### ${finding.id} — ${finding.summary}

- Severity: \`${finding.severity}\`
- Category: \`${finding.category}\`
- Confidence: \`${finding.confidence}\`
- Evidence:
${evidence}
- Violates: ${violates}
- Reproduction: ${finding.reproduction ?? "Not provided."}
- Fix acceptance: ${finding.fixAcceptance}`;
          })
          .join("\n\n");
  const reviewed =
    result.reviewedFindingIds.length === 0
      ? "None."
      : result.reviewedFindingIds.map((id) => `\`${id}\``).join(", ");
  const deferred =
    result.deferredCoverage.length === 0
      ? "None."
      : result.deferredCoverage.map((item) => `- ${item}`).join("\n");
  const handoff =
    result.verdict === "pass"
      ? "The review passed. No finding triage is required."
      : "Human triage is required. Only explicitly accepted finding IDs may enter the fix phase.";

  return `# Implementation Review: ${context.slug}

- Format: \`banzai-feature-review/v1\`
- Feature slug: \`${context.slug}\`
- Review iteration: \`${context.iteration}\`
- Verdict: \`${result.verdict}\`
- Workspace digest: \`${context.workspaceDigest}\`
- Review artifact: \`${context.path}\`

## Review Scope

Approved artifacts:
${approvedArtifacts}

Deterministic verification:
${verification}

Validated plan task completion:
${taskCompletion}

## Summary

${result.summary}

## Findings

${findings}

## Previously Accepted Findings

Previously accepted findings: ${reviewed}

## Deferred Coverage

${deferred}

## Handoff

${handoff}
`;
}

// JSON in fenced code is inert Markdown and preserves every string, including
// trailing newlines and control/markup characters, without a second prose owner.
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
    snapshot.schemaVersion === 2
      ? "- Format: `banzai-feature-review/v3`"
      : "- Format: `banzai-feature-review/v2`",
    reviewValue({
      slug: context.slug,
      iteration: context.iteration,
      verdict: result.verdict,
      artifactPath: context.path,
      workspaceDigest: context.workspaceDigest,
      snapshotDigest: snapshot.digest,
      ...(snapshot.schemaVersion === 2
        ? {
            workId: snapshot.artifactBinding?.binding.workId,
            snapshotSchema: snapshot.schema
          }
        : {}),
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
    reviewValue(snapshot.artifact.verification),
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

function requireContent(
  contents: string,
  marker: string,
  label: string,
  diagnostics: string[]
): void {
  if (!contents.includes(marker)) {
    diagnostics.push(`Review artifact is missing ${label}: ${marker}`);
  }
}

function requireSectionBody(
  contents: string,
  heading: string,
  label: string,
  diagnostics: string[]
): string {
  const start = contents.indexOf(heading);
  if (start === -1) {
    diagnostics.push(`Review artifact has empty ${label}.`);
    return "";
  }
  const bodyStart = start + heading.length;
  const nextSection = contents.indexOf("\n## ", bodyStart);
  const body = contents
    .slice(bodyStart, nextSection === -1 ? undefined : nextSection)
    .trim();
  if (body.length === 0) {
    diagnostics.push(`Review artifact has empty ${label}.`);
  }
  return body;
}

/**
 * Collects the paths a reviewer listed inside its own Review Scope section.
 *
 * Each entry must be a whole line that is nothing but the path, optionally
 * bulleted and optionally in a code span. Requiring a literal introductory line
 * such as "Approved artifacts:" made the attestation depend on a heading wording
 * no prompt ever states, so a reviewer that listed every approved path under
 * "Approved artifacts reviewed:" produced an empty set and failed. ADR 0019
 * scopes the check to the section, not to an anchor. Prose that merely mentions
 * a path still fails, because the whole line must be the path.
 */
function approvedArtifactScope(
  contents: string,
  diagnostics: string[]
): Set<string> {
  const scope = requireSectionBody(
    contents,
    "## Review Scope",
    "review scope",
    diagnostics
  );
  const paths = new Set<string>();
  for (const line of scope.split(/\r?\n/u)) {
    let candidate = line
      .trim()
      .replace(/^[-*+]\s+/u, "")
      .trim();
    if (
      candidate.length >= 2 &&
      candidate.startsWith("`") &&
      candidate.endsWith("`")
    ) {
      candidate = candidate.slice(1, -1).trim();
    }
    if (candidate.length > 0 && !/\s/u.test(candidate)) {
      paths.add(candidate);
    }
  }
  return paths;
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
  sourcePath: string,
  requireAttemptOwnedCandidate: boolean
): Promise<ValidatedReviewCandidate> {
  if (context.snapshot?.artifactBinding)
    await inspectBoundWork(repoRoot, context.snapshot.artifactBinding);
  const expectedPath = reviewArtifactPath(
    context.slug,
    context.iteration,
    context.snapshot?.artifactBinding
  );
  if (context.path !== expectedPath) {
    throw new BanzaiError(
      "INVALID_REVIEW_ARTIFACT_PATH",
      `Review artifact must be written to ${expectedPath}.`
    );
  }
  const absolutePath = repositoryPath(repoRoot, context.path);
  const absoluteCandidatePath = repositoryPath(repoRoot, sourcePath);
  if (result.schemaVersion === 2) {
    await assertReviewPathOwned(repoRoot, sourcePath);
    await assertReviewPathOwned(repoRoot, context.path, true);
  }
  if (requireAttemptOwnedCandidate && absoluteCandidatePath === absolutePath) {
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

  if (result.schemaVersion === 2) {
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

  const diagnostics: string[] = [];
  requireContent(
    contents,
    `# Implementation Review: ${context.slug}`,
    "title",
    diagnostics
  );
  requireContent(
    contents,
    "- Format: `banzai-feature-review/v1`",
    "format marker",
    diagnostics
  );
  requireContent(
    contents,
    `- Feature slug: \`${context.slug}\``,
    "feature slug",
    diagnostics
  );
  requireContent(
    contents,
    `- Review iteration: \`${context.iteration}\``,
    "review iteration",
    diagnostics
  );
  requireContent(
    contents,
    `- Verdict: \`${result.verdict}\``,
    "verdict",
    diagnostics
  );
  requireContent(
    contents,
    `- Workspace digest: \`${context.workspaceDigest}\``,
    "workspace digest",
    diagnostics
  );
  requireContent(
    contents,
    `- Review artifact: \`${context.path}\``,
    "review artifact path",
    diagnostics
  );
  for (const section of REQUIRED_SECTIONS) {
    requireContent(contents, section, "required section", diagnostics);
  }
  requireSectionBody(contents, "## Summary", "review summary", diagnostics);
  const deferredCoverageBody = requireSectionBody(
    contents,
    "## Deferred Coverage",
    "deferred coverage",
    diagnostics
  );
  const recordsNoDeferredCoverage = /^-?\s*none\.?$/i.test(
    deferredCoverageBody
  );
  const hasDeferredCoverage = result.deferredCoverage.length > 0;
  if (recordsNoDeferredCoverage === hasDeferredCoverage) {
    diagnostics.push(
      "Review artifact deferred coverage presence disagrees with the structured result."
    );
  }
  const approvedScope = approvedArtifactScope(contents, diagnostics);
  for (const approvedArtifactPath of context.approvedArtifactPaths) {
    if (!approvedScope.has(approvedArtifactPath)) {
      diagnostics.push(
        `Review artifact does not list required approved-scope path: \`${approvedArtifactPath}\`.`
      );
    }
  }
  for (const verification of context.verification) {
    requireContent(
      contents,
      `\`${verification.name}\`: exit=${verification.exitCode}`,
      "deterministic verification evidence",
      diagnostics
    );
  }
  for (const line of renderPlanTaskReviewEvidence(context.taskCompletion).split(
    "\n"
  )) {
    requireContent(
      contents,
      line,
      "validated plan task completion evidence",
      diagnostics
    );
  }
  if (result.findings.length === 0) {
    requireContent(
      contents,
      "No findings.",
      "clean-review finding statement",
      diagnostics
    );
  }
  for (const finding of result.findings) {
    requireContent(
      contents,
      `### ${finding.id} `,
      `finding ${finding.id}`,
      diagnostics
    );
    requireContent(
      contents,
      finding.summary,
      `finding ${finding.id} summary`,
      diagnostics
    );
    requireContent(
      contents,
      `- Severity: \`${finding.severity}\``,
      `finding ${finding.id} severity`,
      diagnostics
    );
    requireContent(
      contents,
      `- Category: \`${finding.category}\``,
      `finding ${finding.id} category`,
      diagnostics
    );
    requireContent(
      contents,
      `- Confidence: \`${finding.confidence}\``,
      `finding ${finding.id} confidence`,
      diagnostics
    );
    const violates =
      finding.violates.length === 0
        ? "None recorded."
        : finding.violates.map((item) => `\`${item}\``).join(", ");
    requireContent(
      contents,
      `- Violates: ${violates}`,
      `finding ${finding.id} violated artifacts`,
      diagnostics
    );
    requireContent(
      contents,
      `- Reproduction: ${finding.reproduction ?? "Not provided."}`,
      `finding ${finding.id} reproduction`,
      diagnostics
    );
    requireContent(
      contents,
      `- Fix acceptance: ${finding.fixAcceptance}`,
      `finding ${finding.id} fix acceptance`,
      diagnostics
    );
    for (const location of evidenceLocation(finding)) {
      requireContent(
        contents,
        `\`${location}\``,
        `finding ${finding.id} evidence`,
        diagnostics
      );
    }
  }
  for (const findingId of result.reviewedFindingIds) {
    requireContent(
      contents,
      `\`${findingId}\``,
      `previously accepted finding ${findingId}`,
      diagnostics
    );
  }
  if (diagnostics.length > 0) {
    throw new ReviewArtifactValidationError(diagnostics);
  }
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
    context.candidatePath,
    true
  );
}

export async function validateHistoricalReviewArtifact(
  repoRoot: string,
  result: ReviewResult,
  context: ReviewArtifactContext
): Promise<ValidatedReviewCandidate> {
  return await validateReviewArtifactSource(
    repoRoot,
    result,
    context,
    context.path,
    false
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
  if (context.snapshot?.artifactBinding)
    await inspectBoundWork(repoRoot, context.snapshot.artifactBinding);
  const expectedPath = reviewArtifactPath(
    context.slug,
    context.iteration,
    context.snapshot?.artifactBinding
  );
  if (context.path !== expectedPath) {
    throw new BanzaiError(
      "INVALID_REVIEW_ARTIFACT_PATH",
      `Review artifact must be written to ${expectedPath}.`
    );
  }
  const absolutePath = repositoryPath(repoRoot, context.path);
  if (context.snapshot !== undefined) {
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
  const binding = context.snapshot?.artifactBinding?.binding;
  const privateWork = binding?.layout === "private";
  const verifyDestinations = async () => {
    if (privateWork)
      await verifyIgnores(repoRoot, binding, [
        context.path,
        path.relative(repoRoot, temporaryPath)
      ]);
  };
  await verifyDestinations();
  await mkdir(path.dirname(absolutePath), {
    recursive: true,
    mode: privateWork ? 0o700 : 0o755
  });
  const handle = await open(temporaryPath, "wx", privateWork ? 0o600 : 0o644);
  try {
    try {
      await handle.writeFile(candidate.contents, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await verifyDestinations();
    if (context.snapshot === undefined)
      await rename(temporaryPath, absolutePath);
    else {
      // Exclusive atomic publication cannot replace a concurrently created artifact.
      await link(temporaryPath, absolutePath);
      await unlink(temporaryPath);
    }
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}
