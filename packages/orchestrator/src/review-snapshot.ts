import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { BanzaiError } from "./errors.js";
import { hashArtifactBytes } from "./git.js";
import { reviewScopePath } from "./validation.js";
import type { ReviewSnapshot } from "./types.js";
import {
  parseReviewSnapshot as readSharedReviewSnapshot,
  sealReviewSnapshot as sealSharedReviewSnapshot
} from "../../../plugins/banzai/lib/review-snapshot.mjs";
import { ProjectFileError as ArtifactStorageError } from "./project-files.js";
function invalid(message: string): never {
  throw new BanzaiError("INVALID_REVIEW_SNAPSHOT", message);
}
export function parseReviewSnapshot(value: unknown): ReviewSnapshot {
  try {
    return readSharedReviewSnapshot(value) as ReviewSnapshot;
  } catch (error) {
    if (error instanceof ArtifactStorageError) invalid(error.message);
    throw error;
  }
}
export function sealReviewSnapshot(
  value: Omit<ReviewSnapshot, "digest">
): ReviewSnapshot {
  try {
    return sealSharedReviewSnapshot(value) as ReviewSnapshot;
  } catch (error) {
    if (error instanceof ArtifactStorageError) invalid(error.message);
    throw error;
  }
}

/** Reject symlinks in every resource-path component, not merely at the leaf. */
export async function assertReviewPathOwned(
  repoRoot: string,
  relativePath: string,
  allowMissing = false
): Promise<void> {
  reviewScopePath(relativePath);
  let current = path.resolve(repoRoot);
  const segments = relativePath.split("/");
  for (const [index, part] of segments.entries()) {
    current = path.join(current, part);
    let stat;
    try {
      stat = await lstat(current);
    } catch (error) {
      if (allowMissing && (error as NodeJS.ErrnoException).code === "ENOENT")
        return;
      throw error;
    }
    if (
      stat.isSymbolicLink() ||
      (index < segments.length - 1 ? !stat.isDirectory() : !stat.isFile())
    )
      invalid("Review evidence path is not a physically owned regular file.");
  }
}

export async function reviewApprovedArtifacts(
  repoRoot: string,
  paths: readonly string[]
): Promise<ReviewSnapshot["approvedArtifacts"]> {
  return await Promise.all(
    paths.map(async (relative) => {
      await assertReviewPathOwned(repoRoot, relative);
      return {
        path: relative,
        sha256: hashArtifactBytes(await readFile(path.join(repoRoot, relative)))
      };
    })
  );
}
