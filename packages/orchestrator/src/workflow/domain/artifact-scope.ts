import { BanzaiError } from "../../errors.js";
import type { RunState } from "../../types.js";

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
