import { BanzaiError } from "../../errors.js";
import type { PlanningGate, RunState } from "../../types.js";

export function gateArtifactPaths(
  state: RunState,
  gate: PlanningGate
): string[] {
  if (gate === "plan_approval") return artifactPaths(state);
  const artifacts = state.planArtifacts;
  return artifacts === null
    ? []
    : [
        ...(artifacts.description === null ? [] : [artifacts.description]),
        ...artifacts.adrs
      ];
}

export function artifactPaths(state: RunState): string[] {
  const artifacts = state.planArtifacts;
  if (
    artifacts?.description === null ||
    artifacts?.plan === null ||
    artifacts === null
  ) {
    throw new BanzaiError(
      "INCOMPLETE_PLAN",
      "Planning must produce description and plan artifact paths before approval."
    );
  }
  return [artifacts.description, ...artifacts.adrs, artifacts.plan];
}

export function isDocumentationPath(relativePath: string): boolean {
  const normalized = relativePath.replaceAll("\\", "/");
  return (
    normalized === "documentation" || normalized.startsWith("documentation/")
  );
}
