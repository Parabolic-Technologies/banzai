import { createHash } from "node:crypto";
import { readBytes as readArtifactBytes } from "../../artifact-storage.js";
import { BanzaiError } from "../../errors.js";
import {
  workspaceChanges,
  workspaceSnapshot,
  type WorkspaceSnapshot
} from "../../git.js";
import { reviewArtifactPath } from "../../review-artifact.js";
import type {
  AttemptReference,
  PersistedPhaseResult,
  RunState
} from "../../types.js";
import type { RunnerContext } from "../context.js";
import { isDocumentationPath } from "../domain/artifact-scope.js";

export function validateArtifactRoleReferences(
  state: RunState,
  result: Pick<PersistedPhaseResult, "artifacts">
): void {
  const roles = state.artifactBinding?.binding.artifacts;
  if (roles === undefined) return;
  for (const role of [
    "description",
    "plan",
    "implementationReport",
    "testReport"
  ] as const) {
    const reference = result.artifacts[role];
    if (reference === null) continue;
    const workflow = state.workflowSelection?.workflow ?? "strict";
    const expected =
      role === "implementationReport" && workflow !== "strict"
        ? workflow === "feature"
          ? roles.work
          : roles.changeReport
        : roles[role];
    if (reference !== expected)
      throw new BanzaiError(
        "ARTIFACT_PHASE_SCOPE_INVALID",
        `Result ${role} does not match the persisted work binding.`
      );
  }
  if (
    result.artifacts.adrs.some(
      (value) =>
        !/^documentation\/decisions\/[0-9]{4}-[a-z0-9-]+\.md$/.test(value)
    )
  ) {
    throw new BanzaiError(
      "ARTIFACT_PHASE_SCOPE_INVALID",
      "ADR references must retain their public decision paths."
    );
  }
}

export async function validateSavedArtifactScope(
  context: RunnerContext,
  state: RunState,
  attempt: AttemptReference
): Promise<void> {
  if (!state.artifactBinding) return;
  const bytes = await readArtifactBytes(
    context.repoRoot,
    `.banzai/runs/${state.runId}/attempts/${attempt.id}.artifact-workspace.json`,
    { limit: 2 * 1024 * 1024 }
  );
  const before = JSON.parse(
    bytes?.toString("utf8") ?? "null"
  ) as WorkspaceSnapshot | null;
  if (
    before?.schemaVersion !== 2 ||
    before.baseCommit !== state.baseCommit ||
    before.artifactBindingDigest !== state.artifactBinding.sha256 ||
    !Array.isArray(before.entries) ||
    before.digest !==
      createHash("sha256")
        .update(
          JSON.stringify({
            version: 2,
            baseCommit: before.baseCommit,
            artifactBindingDigest: before.artifactBindingDigest,
            entries: before.entries
          })
        )
        .digest("hex")
  )
    throw new BanzaiError(
      "ARTIFACT_RECOVERY_REQUIRED",
      "Original attempt artifact workspace evidence is missing or inconsistent."
    );
  await checkArtifactPhaseScope(context, state, attempt.kind, before);
}

export async function checkArtifactPhaseScope(
  context: Pick<RunnerContext, "repoRoot">,
  state: RunState,
  phase: AttemptReference["kind"],
  before: Awaited<ReturnType<typeof workspaceSnapshot>>
): Promise<void> {
  const bound = state.artifactBinding;
  if (bound === undefined) return;
  const after = await workspaceSnapshot(context.repoRoot, {
    baseline: state.baseline,
    artifactBinding: bound,
    excludedPaths:
      phase === "review"
        ? [reviewArtifactPath(state.slug, state.reviewIteration, bound)]
        : []
  });
  const allowed = new Set(artifactWritePaths(state, phase));
  for (const change of workspaceChanges(before, after)) {
    const candidate = change.path;
    const privatePath =
      candidate === ".banzai" || candidate.startsWith(".banzai/");
    const legacyWork =
      /^documentation\/(?:features|development-plans|changes)\//.test(
        candidate
      );
    const prohibited =
      phase === "selection" ||
      phase === "review" ||
      (privatePath && !allowed.has(candidate)) ||
      (legacyWork && !allowed.has(candidate)) ||
      // Accepting an ADR during planning adds its row to the manifest's
      // active ADR index, as the delivered architecture guidance requires.
      (phase === "plan" &&
        !allowed.has(candidate) &&
        !isDocumentationPath(candidate) &&
        candidate !== "PROJECT_MANIFEST.md");
    if (prohibited)
      throw new BanzaiError(
        "ARTIFACT_PHASE_SCOPE_INVALID",
        `Phase ${phase} changed an unauthorized artifact or source path: ${candidate}`
      );
  }
}

export function artifactWritePaths(
  state: RunState,
  phase: AttemptReference["kind"]
): string[] {
  const roles = state.artifactBinding?.binding.artifacts;
  if (roles === undefined) return [];
  if (phase === "plan")
    return [roles.description, roles.plan].filter(
      (item): item is string => item !== undefined
    );
  if (phase !== "implementation" && phase !== "fix") return [];
  const workflow = state.workflowSelection?.workflow ?? "strict";
  return (
    workflow === "strict"
      ? [
          roles.implementationReport,
          roles.testReport,
          ...(phase === "fix" ? [roles.changeReport] : [])
        ]
      : workflow === "feature"
        ? [roles.work]
        : [roles.changeReport]
  ).filter((item): item is string => item !== undefined);
}
