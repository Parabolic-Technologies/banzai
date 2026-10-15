import { randomUUID } from "node:crypto";
import { createTestWork as createWork } from "./helpers.js";
import { digestBytes } from "../src/project-files.js";
import { reviewSnapshotFixture } from "./review-fixtures.js";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { BanzaiError } from "../src/errors.js";
import {
  publishReviewArtifact,
  renderReviewArtifact,
  reviewArtifactPath,
  validateReviewArtifact
} from "../src/review-artifact.js";
import {
  CONTRACT_VERSION,
  type ReviewArtifactContext,
  type ReviewResult
} from "../src/types.js";
import { createTestRepository } from "./helpers.js";

const result: ReviewResult = {
  contractVersion: CONTRACT_VERSION,
  verdict: "changes_requested",
  summary: "One correctness issue requires attention.",
  findings: [
    {
      id: "R1-F1",
      severity: "blocker",
      category: "correctness",
      summary: "The value is not validated.",
      evidence: [
        {
          path: "src/example.ts",
          line: 12,
          detail: "The invalid value reaches the persistence boundary."
        }
      ],
      violates: ["FR3"],
      reproduction: "Submit an empty value.",
      fixAcceptance: "Reject the empty value before persistence.",
      confidence: "high"
    }
  ],
  reviewedFindingIds: [],
  deferredCoverage: ["Browser-only behavior was not exercised."]
};

function context(): ReviewArtifactContext {
  return {
    path: reviewArtifactPath("example", 1),
    candidatePath: ".banzai/runs/example/attempts/review-1.review-candidate.md",
    slug: "example",
    iteration: 1,
    approvedArtifactPaths: [
      "documentation/features/example/description.md",
      "documentation/development-plans/example/plan.md"
    ],
    workspaceDigest: "workspace-digest",
    verification: [
      {
        name: "git diff check",
        command: "git",
        args: ["diff", "--check"],
        exitCode: 0,
        signal: null,
        stdoutPath: "verification/1-git-diff-check.stdout.log",
        stderrPath: "verification/1-git-diff-check.stderr.log",
        startedAt: "2026-07-31T13:10:34.172Z",
        completedAt: "2026-07-31T13:10:34.187Z"
      }
    ]
  };
}

test("review artifact is readable by humans and consistent with structured review", async () => {
  const repository = await createTestRepository();
  try {
    const artifact = context();
    const contents = renderReviewArtifact(result, artifact);
    await mkdir(
      path.join(repository.root, path.dirname(artifact.candidatePath)),
      {
        recursive: true
      }
    );
    await writeFile(
      path.join(repository.root, artifact.candidatePath),
      contents,
      "utf8"
    );

    const candidate = await validateReviewArtifact(
      repository.root,
      result,
      artifact
    );
    await publishReviewArtifact(repository.root, artifact, candidate);
    assert.equal(
      await readFile(path.join(repository.root, artifact.path), "utf8"),
      contents
    );
    assert.match(contents, /^# Implementation Review: example/m);
    assert.match(contents, /^### R1-F1 — The value is not validated\.$/m);
    assert.match(contents, /`src\/example\.ts:12`/);
    assert.match(contents, /Browser-only behavior was not exercised\./);
    assert.match(
      contents,
      /- `git diff check`: exit=0, command=`git diff --check`/
    );
  } finally {
    await repository.dispose();
  }
});

test("canonical publication rejects proof/content disagreement", async () => {
  const repository = await createTestRepository();
  try {
    const artifact = context();
    await assert.rejects(
      publishReviewArtifact(repository.root, artifact, {
        contents: "unvalidated candidate",
        sha256: "0".repeat(64)
      }),
      (error: unknown) =>
        error instanceof BanzaiError &&
        error.code === "INVALID_REVIEW_CANDIDATE_EVIDENCE"
    );
    await assert.rejects(
      readFile(path.join(repository.root, artifact.path), "utf8"),
      /ENOENT/u
    );
  } finally {
    await repository.dispose();
  }
});

test("review succeeds only when the reviewer writes the designated artifact", async () => {
  const repository = await createTestRepository();
  try {
    await assert.rejects(
      validateReviewArtifact(repository.root, result, context()),
      /did not write/
    );
  } finally {
    await repository.dispose();
  }
});

test("review artifact cannot disagree with the structured result", async () => {
  const repository = await createTestRepository();
  try {
    const artifact = context();
    const inconsistent = renderReviewArtifact(
      { ...result, verdict: "pass" },
      artifact
    );
    await mkdir(
      path.join(repository.root, path.dirname(artifact.candidatePath)),
      {
        recursive: true
      }
    );
    await writeFile(
      path.join(repository.root, artifact.candidatePath),
      inconsistent,
      "utf8"
    );

    await assert.rejects(
      validateReviewArtifact(repository.root, result, artifact),
      /missing verdict/
    );
  } finally {
    await repository.dispose();
  }
});

test("review artifact accepts independently worded summary prose", async () => {
  const repository = await createTestRepository();
  try {
    const artifact = context();
    const cleanResult: ReviewResult = {
      ...result,
      verdict: "pass",
      summary: "The approved implementation is complete. No findings.",
      findings: [],
      deferredCoverage: []
    };
    const contents = renderReviewArtifact(cleanResult, artifact).replace(
      cleanResult.summary,
      "The implementation matches the approved artifacts, and the review found no defects."
    );
    await mkdir(
      path.join(repository.root, path.dirname(artifact.candidatePath)),
      {
        recursive: true
      }
    );
    await writeFile(
      path.join(repository.root, artifact.candidatePath),
      contents,
      "utf8"
    );

    await validateReviewArtifact(repository.root, cleanResult, artifact);
  } finally {
    await repository.dispose();
  }
});

test("review artifact still requires a non-empty Markdown summary", async () => {
  const repository = await createTestRepository();
  try {
    const artifact = context();
    const contents = renderReviewArtifact(result, artifact).replace(
      `## Summary\n\n${result.summary}`,
      "## Summary\n"
    );
    await mkdir(
      path.join(repository.root, path.dirname(artifact.candidatePath)),
      {
        recursive: true
      }
    );
    await writeFile(
      path.join(repository.root, artifact.candidatePath),
      contents,
      "utf8"
    );

    await assert.rejects(
      validateReviewArtifact(repository.root, result, artifact),
      /empty review summary/
    );
  } finally {
    await repository.dispose();
  }
});

test("review artifact accepts independently worded deferred coverage prose", async () => {
  const repository = await createTestRepository();
  try {
    const artifact = context();
    const contents = renderReviewArtifact(result, artifact).replace(
      "- Browser-only behavior was not exercised.",
      "- Browser behavior remains outside this review's executed coverage."
    );
    await mkdir(
      path.join(repository.root, path.dirname(artifact.candidatePath)),
      {
        recursive: true
      }
    );
    await writeFile(
      path.join(repository.root, artifact.candidatePath),
      contents,
      "utf8"
    );

    await validateReviewArtifact(repository.root, result, artifact);
  } finally {
    await repository.dispose();
  }
});

test("review artifact deferred coverage presence must match the structured result", async () => {
  const repository = await createTestRepository();
  try {
    const artifact = context();
    const contents = renderReviewArtifact(result, artifact).replace(
      "- Browser-only behavior was not exercised.",
      "None."
    );
    await mkdir(
      path.join(repository.root, path.dirname(artifact.candidatePath)),
      {
        recursive: true
      }
    );
    await writeFile(
      path.join(repository.root, artifact.candidatePath),
      contents,
      "utf8"
    );

    await assert.rejects(
      validateReviewArtifact(repository.root, result, artifact),
      /deferred coverage presence disagrees/
    );
  } finally {
    await repository.dispose();
  }
});

test("review artifact preserves machine-relevant finding fields", async () => {
  const repository = await createTestRepository();
  try {
    const artifact = context();
    const inconsistent = renderReviewArtifact(result, artifact).replace(
      "- Category: `correctness`",
      "- Category: `maintainability`"
    );
    await mkdir(
      path.join(repository.root, path.dirname(artifact.candidatePath)),
      {
        recursive: true
      }
    );
    await writeFile(
      path.join(repository.root, artifact.candidatePath),
      inconsistent,
      "utf8"
    );

    await assert.rejects(
      validateReviewArtifact(repository.root, result, artifact),
      /finding R1-F1 category/
    );
  } finally {
    await repository.dispose();
  }
});

test("missing approved scope is rejected with an unambiguous artifact diagnostic", async () => {
  const repository = await createTestRepository();
  try {
    const artifact = context();
    const requiredPath = artifact.approvedArtifactPaths[0] ?? "";
    const contents = renderReviewArtifact(result, artifact).replace(
      `- \`${requiredPath}\``,
      ""
    );
    await mkdir(
      path.join(repository.root, path.dirname(artifact.candidatePath)),
      { recursive: true }
    );
    await writeFile(
      path.join(repository.root, artifact.candidatePath),
      contents,
      "utf8"
    );

    await assert.rejects(
      validateReviewArtifact(repository.root, result, artifact),
      (error: unknown) =>
        error instanceof BanzaiError &&
        error.code === "INVALID_REVIEW_ARTIFACT" &&
        error.message ===
          `Review artifact does not list required approved-scope path: \`${requiredPath}\`.`
    );
  } finally {
    await repository.dispose();
  }
});

test("approved scope does not depend on the reviewer guessing an introductory line", async () => {
  const repository = await createTestRepository();
  try {
    const artifact = context();
    const [description, plan] = artifact.approvedArtifactPaths;
    assert.ok(description);
    assert.ok(plan);
    await mkdir(
      path.join(repository.root, path.dirname(artifact.candidatePath)),
      { recursive: true }
    );

    // Observed live: a reviewer listed every approved path but headed the list
    // "Approved artifacts reviewed:", and the whole scope set came back empty.
    const rewordedHeading = renderReviewArtifact(result, artifact).replace(
      "Approved artifacts:",
      "Approved artifact paths reviewed in this review:"
    );
    await writeFile(
      path.join(repository.root, artifact.candidatePath),
      rewordedHeading,
      "utf8"
    );
    await validateReviewArtifact(repository.root, result, artifact);

    // Listing a path only inside a sentence is still not an attestation.
    const proseInsideScope = renderReviewArtifact(result, artifact).replace(
      `- \`${plan}\``,
      `The plan at \`${plan}\` was also considered.`
    );
    await writeFile(
      path.join(repository.root, artifact.candidatePath),
      proseInsideScope,
      "utf8"
    );
    await assert.rejects(
      validateReviewArtifact(repository.root, result, artifact),
      (error: unknown) =>
        error instanceof BanzaiError &&
        error.message ===
          `Review artifact does not list required approved-scope path: \`${plan}\`.`
    );

    // A basename or a prefix is not the approved path.
    for (const wrong of [path.posix.basename(plan), plan.slice(0, -3)]) {
      await writeFile(
        path.join(repository.root, artifact.candidatePath),
        renderReviewArtifact(result, artifact).replace(
          `- \`${plan}\``,
          `- \`${wrong}\``
        ),
        "utf8"
      );
      await assert.rejects(
        validateReviewArtifact(repository.root, result, artifact),
        (error: unknown) =>
          error instanceof BanzaiError &&
          error.code === "INVALID_REVIEW_ARTIFACT"
      );
    }
  } finally {
    await repository.dispose();
  }
});

test("approved scope accepts list-marker whitespace and optional backticks only inside Review Scope", async () => {
  const repository = await createTestRepository();
  try {
    const artifact = context();
    const [description, plan] = artifact.approvedArtifactPaths;
    assert.ok(description);
    assert.ok(plan);
    const contents = renderReviewArtifact(result, artifact)
      .replace(`- \`${description}\``, `*    \`${description}\``)
      .replace(`- \`${plan}\``, `+   ${plan}`);
    await mkdir(
      path.join(repository.root, path.dirname(artifact.candidatePath)),
      { recursive: true }
    );
    await writeFile(
      path.join(repository.root, artifact.candidatePath),
      contents,
      "utf8"
    );

    await validateReviewArtifact(repository.root, result, artifact);

    const proseOnly = contents
      .replace(`*    \`${description}\``, "")
      .replace("## Summary", `## Summary\n\n${description}`);
    await writeFile(
      path.join(repository.root, artifact.candidatePath),
      proseOnly,
      "utf8"
    );
    await assert.rejects(
      validateReviewArtifact(repository.root, result, artifact),
      new RegExp(description.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"))
    );
  } finally {
    await repository.dispose();
  }
});

test("accepted F1 validates the actual review iteration destination before private publication", async () => {
  const repository = await createTestRepository({ artifactLayout: "private" });
  try {
    const root = repository.root;
    const work = await createWork({
      repoRoot: root,
      slug: "example",
      mode: "strict",
      creationId: randomUUID()
    });
    const workPath = work.binding.artifacts.reviewDirectory;
    const relative = `${workPath}/review-2.md`;
    await writeFile(
      path.join(root, ".gitignore"),
      `documentation/work/\n.banzai/runs/\n`
    );
    const artifact: ReviewArtifactContext = {
      ...context(),
      iteration: 2,
      path: relative,
      snapshot: {
        ...reviewSnapshotFixture(),
        schema: "banzai-review-snapshot/v7",
        schemaVersion: 7,
        artifactBinding: work
      }
    };
    const contents = "Synthetic validated review candidate\n";
    const candidate = { contents, sha256: digestBytes(contents) };
    await assert.rejects(publishReviewArtifact(root, artifact, candidate), {
      code: "ARTIFACT_IGNORE_CONFLICT"
    });
    await assert.rejects(readFile(path.join(root, relative)), {
      code: "ENOENT"
    });
    await writeFile(
      path.join(root, ".gitignore"),
      ".banzai/runs/\n!.banzai/runs/\n.banzai/runs/*\n!.banzai/runs/example/\n.banzai/runs/example/*\n!.banzai/runs/example/attempts/\n.banzai/runs/example/attempts/*\n!*.publication.tmp\n"
    );
    await assert.rejects(publishReviewArtifact(root, artifact, candidate), {
      code: "ARTIFACT_IGNORE_CONFLICT"
    });
    await assert.rejects(readFile(path.join(root, relative)), {
      code: "ENOENT"
    });
    await writeFile(
      path.join(root, ".gitignore"),
      ".banzai/work/\n.banzai/runs/\n"
    );
    await publishReviewArtifact(root, artifact, candidate);
    assert.equal(await readFile(path.join(root, relative), "utf8"), contents);
    assert.equal((await stat(path.join(root, relative))).mode & 0o777, 0o644);
  } finally {
    await repository.dispose();
  }
});
