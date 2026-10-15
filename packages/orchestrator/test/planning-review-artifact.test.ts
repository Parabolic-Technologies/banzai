import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import {
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile,
  unlink,
  symlink
} from "node:fs/promises";
import path from "node:path";
import { createTestRepository } from "./helpers.js";
import {
  createExecutionBinding,
  verifyDocumentVisibility
} from "../src/work-documents.js";
import {
  renderPlanningReviewArtifact,
  validatePlanningReviewCandidate,
  publishPlanningReviewArtifact
} from "../src/planning-review-artifact.js";
import { planningReviewResult } from "./planning-review-fixtures.js";
import type { PlanningReviewEpisode } from "../src/types.js";
import { BanzaiError } from "../src/errors.js";

function episode(): PlanningReviewEpisode {
  const result = planningReviewResult();
  return {
    episodeId: "planning-episode-12345678",
    reviewNumber: 1,
    originGate: "plan_approval",
    scope: result.scope,
    requestedAt: "2026-10-14T00:00:00.000Z",
    decidedBy: "PRIVATE-OWNER-CANARY",
    reviewer: {
      executable: "claude",
      model: "configured-model",
      effort: "high"
    },
    step: "reviewing",
    reviewAttemptId: "planning-review-1-12345678",
    reviewSessionId: "PRIVATE-SESSION-CANARY",
    analysisAttemptId: null,
    applyingAttemptId: null,
    resultDigest: null,
    findingCount: null,
    artifact: null,
    analysisDigest: null
  };
}
test("planning renderer is lossless, deterministic and excludes private episode fields", () => {
  const result = planningReviewResult();
  const first = result.findings[0];
  if (first === undefined) throw new Error("Fixture finding missing");
  first.summary = "# Heading ``` fence <tag> **value**";
  const text = renderPlanningReviewArtifact(episode(), result);
  assert.equal(
    text,
    renderPlanningReviewArtifact(
      { ...episode(), decidedBy: "Another owner" },
      result
    )
  );
  assert.match(text, /configured-model/);
  assert.match(text, /sha256/);
  assert.match(text, /resultDigest/);
  assert.doesNotMatch(
    text,
    /PRIVATE|planning-episode|planning-review-1-12345678/
  );
  assert.ok(text.includes(JSON.stringify(first.summary)));
  assert.throws(() =>
    validatePlanningReviewCandidate(text + "edited", episode(), result)
  );
});
test("planning publication is create-only, idempotent and symlink refusing", async () => {
  const repository = await createTestRepository();
  try {
    const bound = await createExecutionBinding({
      repoRoot: repository.root,
      slug: "planning-artifact",
      mode: "workflow",
      runId: "run-planning",
      creationId: randomUUID(),
      sourceCommit: null
    });
    const e = episode();
    const result = planningReviewResult();
    const candidate =
      ".banzai/runs/run-planning/attempts/review.planning-review-candidate.md";
    const artifact = await publishPlanningReviewArtifact(
      repository.root,
      bound,
      e,
      result,
      candidate
    );
    assert.deepEqual(
      await publishPlanningReviewArtifact(
        repository.root,
        bound,
        e,
        result,
        candidate
      ),
      artifact
    );
    assert.equal(
      await readFile(path.join(repository.root, artifact.path), "utf8"),
      renderPlanningReviewArtifact(e, result)
    );
    await writeFile(
      path.join(repository.root, artifact.path),
      "Different content\n"
    );
    await assert.rejects(
      publishPlanningReviewArtifact(
        repository.root,
        bound,
        e,
        result,
        candidate
      ),
      (error) =>
        error instanceof Error &&
        error.message.includes("exists with different content")
    );
    assert.equal(
      await readFile(path.join(repository.root, artifact.path), "utf8"),
      "Different content\n"
    );
    await unlink(path.join(repository.root, artifact.path));
    await symlink(
      "/private/tmp/absent-review",
      path.join(repository.root, artifact.path)
    );
    await assert.rejects(
      publishPlanningReviewArtifact(
        repository.root,
        bound,
        e,
        result,
        candidate
      )
    );
  } finally {
    await rm(repository.root, { recursive: true, force: true });
  }
});

test("publication rejects different bytes even when lossy UTF-8 decoding gives identical text", async () => {
  const repository = await createTestRepository();
  try {
    const bound = await createExecutionBinding({
      repoRoot: repository.root,
      slug: "byte-idempotence",
      mode: "workflow",
      runId: "run-planning",
      creationId: randomUUID(),
      sourceCommit: null
    });
    const result = planningReviewResult();
    const finding = result.findings[0];
    assert.ok(finding);
    finding.summary = "Replacement character \ufffd is legitimate text.";
    const e = episode();
    const candidate =
      ".banzai/runs/run-planning/attempts/review.planning-review-candidate.md";
    const artifact = await publishPlanningReviewArtifact(
      repository.root,
      bound,
      e,
      result,
      candidate
    );
    const valid = Buffer.from(renderPlanningReviewArtifact(e, result), "utf8");
    const position = valid.indexOf(Buffer.from("\ufffd"));
    assert.ok(position >= 0);
    const invalid = Buffer.concat([
      valid.subarray(0, position),
      Buffer.from([0xff]),
      valid.subarray(position + 3)
    ]);
    assert.equal(invalid.toString("utf8"), valid.toString("utf8"));
    await writeFile(path.join(repository.root, artifact.path), invalid);
    await assert.rejects(
      publishPlanningReviewArtifact(
        repository.root,
        bound,
        e,
        result,
        candidate
      ),
      (error: unknown) =>
        error instanceof BanzaiError &&
        error.code === "PLANNING_REVIEW_PUBLICATION_CONFLICT"
    );
    assert.deepEqual(
      await readFile(path.join(repository.root, artifact.path)),
      invalid
    );
  } finally {
    await repository.dispose();
  }
});

test("planning publication refuses its actual hidden destination and exposed private evidence", async () => {
  const repository = await createTestRepository();
  try {
    const root = repository.root;
    const bound = await createExecutionBinding({
      repoRoot: root,
      slug: "planning-visibility",
      mode: "workflow",
      runId: "run-planning",
      creationId: randomUUID(),
      sourceCommit: null
    });
    const e = episode();
    const result = planningReviewResult();
    const attempts = ".banzai/runs/run-planning/attempts";
    const candidate = `${attempts}/review.planning-review-candidate.md`;
    const destination = `${bound.binding.artifacts.reviewDirectory}/planning-review-1.md`;
    const literal = (value: string) =>
      value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    // Mirror the runner: the validated candidate already exists when
    // publication starts.
    await mkdir(path.join(root, attempts), { recursive: true, mode: 0o700 });
    await writeFile(
      path.join(root, candidate),
      renderPlanningReviewArtifact(e, result)
    );
    const baseIgnore = await readFile(path.join(root, ".gitignore"), "utf8");
    const privateException = (exception: string) =>
      `${baseIgnore}!.banzai/runs/\n.banzai/runs/*\n!.banzai/runs/run-planning/\n.banzai/runs/run-planning/*\n!${attempts}/\n${attempts}/*\n!${exception}\n`;
    const temporaries = async () =>
      (await readdir(path.join(root, attempts))).filter((name) =>
        name.endsWith(".publication.tmp")
      );
    const refused = async (ignore: string, message: RegExp) => {
      await writeFile(path.join(root, ".gitignore"), ignore);
      await assert.rejects(
        publishPlanningReviewArtifact(root, bound, e, result, candidate),
        (error: unknown) =>
          error instanceof Error &&
          (error as { code?: unknown }).code === "ARTIFACT_IGNORE_CONFLICT" &&
          message.test(error.message)
      );
      await assert.rejects(readFile(path.join(root, destination)), {
        code: "ENOENT"
      });
      assert.deepEqual(await temporaries(), []);
    };

    // The binding probe sees only fixed roles, so this exact rule is caught
    // only by the publisher's check of the actual numbered destination.
    const hidden = `${baseIgnore}${destination}\n`;
    await writeFile(path.join(root, ".gitignore"), hidden);
    await verifyDocumentVisibility(root, bound.binding.artifacts);
    await refused(
      hidden,
      new RegExp(`^New work document ${literal(destination)} is ignored\\.`)
    );
    await refused(
      privateException("*.planning-review-candidate.md"),
      new RegExp(
        `^Private execution evidence ${literal(candidate)} must be effectively Git-ignored`
      )
    );
    await refused(
      privateException("*.publication.tmp"),
      new RegExp(
        `^Private execution evidence ${literal(candidate)}\\.[0-9a-f-]{36}\\.publication\\.tmp must be effectively Git-ignored`
      )
    );

    // The same fixture publishes once no ignore rule conflicts.
    await writeFile(path.join(root, ".gitignore"), baseIgnore);
    const artifact = await publishPlanningReviewArtifact(
      root,
      bound,
      e,
      result,
      candidate
    );
    assert.equal(artifact.path, destination);
    assert.equal(
      await readFile(path.join(root, destination), "utf8"),
      renderPlanningReviewArtifact(e, result)
    );
    assert.deepEqual(await temporaries(), []);
  } finally {
    await repository.dispose();
  }
});
