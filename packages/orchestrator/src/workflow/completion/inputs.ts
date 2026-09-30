import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { workspaceSnapshot } from "../../git.js";
import type {
  CompletionObservedInputs,
  CompletionReportObservation,
  PhaseArtifacts,
  RunState
} from "../../types.js";
import type { RunnerContext } from "../context.js";

/**
 * Report identities plus the non-report workspace digest, omitting exactly
 * the two report destinations so a runner-owned report write never counts
 * as source drift while every other change does.
 */
export async function observeCompletionInputs(
  context: RunnerContext,
  state: RunState,
  artifacts: Pick<PhaseArtifacts, "implementationReport" | "testReport">
): Promise<{
  observed: CompletionObservedInputs;
  bytes: { implementationReport: Buffer | null; testReport: Buffer | null };
  excludedPaths: string[];
}> {
  const implementation = await observeReport(
    context,
    artifacts.implementationReport
  );
  const test = await observeReport(context, artifacts.testReport);
  const excludedPaths = [
    artifacts.implementationReport,
    artifacts.testReport
  ].filter((item): item is string => item !== null);
  let workspaceDigest: string | null;
  try {
    workspaceDigest = (
      await workspaceSnapshot(context.repoRoot, {
        artifactBinding: state.artifactBinding,
        baseline: state.baseline,
        excludedPaths
      })
    ).digest;
  } catch {
    workspaceDigest = null;
  }
  return {
    observed: {
      implementationReport: implementation.observation,
      testReport: test.observation,
      workspaceDigest
    },
    bytes: {
      implementationReport: implementation.bytes,
      testReport: test.bytes
    },
    excludedPaths
  };
}

/** Observes one required report without following an unsafe path. */
export async function observeReport(
  context: RunnerContext,
  relativePath: string | null
): Promise<{
  observation: CompletionReportObservation;
  bytes: Buffer | null;
}> {
  if (relativePath === null)
    return { observation: { path: null, state: "absent" }, bytes: null };
  let absolute: string;
  try {
    absolute = path.resolve(context.repoRoot, relativePath);
    if (
      relativePath.length === 0 ||
      relativePath.includes("\\") ||
      path.posix.isAbsolute(relativePath) ||
      path.posix.normalize(relativePath) !== relativePath ||
      relativePath.startsWith("../") ||
      !absolute.startsWith(`${path.resolve(context.repoRoot)}${path.sep}`)
    )
      return {
        observation: { path: relativePath, state: "unsafe" },
        bytes: null
      };
    const metadata = await lstat(absolute);
    if (!metadata.isFile() || metadata.isSymbolicLink())
      return {
        observation: { path: relativePath, state: "unsafe" },
        bytes: null
      };
    const root = await realpath(context.repoRoot);
    if (!(await realpath(absolute)).startsWith(`${root}${path.sep}`))
      return {
        observation: { path: relativePath, state: "unsafe" },
        bytes: null
      };
  } catch (error) {
    return {
      observation: {
        path: relativePath,
        state:
          (error as NodeJS.ErrnoException).code === "ENOENT"
            ? "absent"
            : "unavailable"
      },
      bytes: null
    };
  }
  try {
    const bytes = await readFile(absolute);
    return {
      observation: {
        path: relativePath,
        state: "present",
        sha256: createHash("sha256").update(bytes).digest("hex"),
        bytes: bytes.length
      },
      bytes
    };
  } catch {
    return {
      observation: { path: relativePath, state: "unavailable" },
      bytes: null
    };
  }
}
