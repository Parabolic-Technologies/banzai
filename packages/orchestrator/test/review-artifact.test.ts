import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { createWork, digestBytes } from "../src/artifact-storage.js";
import {
  publishReviewArtifact,
  renderReviewArtifact,
  validateReviewArtifact
} from "../src/review-artifact.js";
import {
  currentReviewFixture,
  reviewSnapshotFixture
} from "./review-fixtures.js";
import { createTestRepository, snapshotTree } from "./helpers.js";

async function fixture() {
  const repository = await createTestRepository();
  try {
    const work = await createWork({
      repoRoot: repository.root,
      slug: "example",
      mode: "strict",
      creationId: randomUUID()
    });
    const snapshot = reviewSnapshotFixture({ artifactBinding: work });
    const context = { ...snapshot.artifact, snapshot };
    const result = currentReviewFixture(snapshot, {
      summary: "The approved scope is complete.",
      deferredCoverage: ["Browser behavior was not exercised."]
    });
    const contents = renderReviewArtifact(result, context);
    const candidatePath = path.join(repository.root, context.candidatePath);
    const save = async (text: string) => {
      await mkdir(path.dirname(candidatePath), { recursive: true });
      await writeFile(candidatePath, text);
    };
    return { ...repository, work, snapshot, context, result, contents, save };
  } catch (error) {
    await repository.dispose();
    throw error;
  }
}

test("current review publishes its exact snapshot projection privately and idempotently", async () => {
  const f = await fixture();
  try {
    assert.match(f.contents, /- Format: `banzai-feature-review\/v4`/u);
    assert.match(f.contents, /Reviewer-acknowledged coverage/u);
    assert.match(f.contents, /Browser behavior was not exercised\./u);
    assert.ok(f.contents.includes(f.snapshot.approval.paths[0] ?? "missing"));
    assert.ok(f.contents.includes(f.snapshot.digest));
    await f.save(f.contents);
    const candidate = await validateReviewArtifact(f.root, f.result, f.context);
    await publishReviewArtifact(f.root, f.context, candidate);
    const before = await snapshotTree(f.root);
    await publishReviewArtifact(f.root, f.context, candidate);
    assert.deepEqual(await snapshotTree(f.root), before);
    assert.equal(
      await readFile(path.join(f.root, f.context.path), "utf8"),
      f.contents
    );
    assert.equal(
      (await stat(path.join(f.root, f.context.path))).mode & 0o777,
      0o600
    );
    const changed = `${f.contents}\nChanged evidence.\n`;
    await assert.rejects(
      publishReviewArtifact(f.root, f.context, {
        contents: changed,
        sha256: digestBytes(changed)
      }),
      { code: "INVALID_REVIEW_CANDIDATE_EVIDENCE" }
    );
    assert.deepEqual(await snapshotTree(f.root), before);
  } finally {
    await f.dispose();
  }
});

test("review validation refuses missing candidates, semantic edits and altered scope without publication", async () => {
  const f = await fixture();
  try {
    await assert.rejects(validateReviewArtifact(f.root, f.result, f.context), {
      code: "REVIEW_ARTIFACT_MISSING"
    });
    for (const altered of [
      f.contents.replace(f.result.summary, "Different independent prose."),
      f.contents.replace("Browser behavior was not exercised.", "None."),
      f.contents.replace(
        f.snapshot.approval.paths[0] ?? "missing",
        "wrong/path.md"
      ),
      f.contents.replace('"pass"', '"blocked"')
    ]) {
      assert.notEqual(altered, f.contents);
      await f.save(altered);
      const before = await snapshotTree(f.root);
      await assert.rejects(
        validateReviewArtifact(f.root, f.result, f.context),
        { code: "INVALID_REVIEW_ARTIFACT" }
      );
      assert.deepEqual(await snapshotTree(f.root), before);
    }
    await assert.rejects(readFile(path.join(f.root, f.context.path)), {
      code: "ENOENT"
    });
  } finally {
    await f.dispose();
  }
});

test("removed review formats fail closed with the common version diagnostic", async () => {
  const f = await fixture();
  try {
    for (const version of [1, 2, 3, 5]) {
      await f.save(
        f.contents.replace(
          "banzai-feature-review/v4",
          `banzai-feature-review/v${version}`
        )
      );
      const before = await snapshotTree(f.root);
      await assert.rejects(
        validateReviewArtifact(f.root, f.result, f.context),
        (error: unknown) => {
          assert.ok(error instanceof Error && "code" in error);
          assert.equal(error.code, "RESOURCE_VERSION_UNSUPPORTED");
          assert.ok(
            error.message.includes(`banzai-feature-review/v${version}`)
          );
          assert.match(
            error.message,
            /supports banzai-feature-review\/v4; last read by release-train major/u
          );
          return true;
        }
      );
      assert.deepEqual(await snapshotTree(f.root), before);
    }
  } finally {
    await f.dispose();
  }
});

test("publication refuses mismatched proof and a destination outside the selected role", async () => {
  const f = await fixture();
  try {
    const before = await snapshotTree(f.root);
    await assert.rejects(
      publishReviewArtifact(f.root, f.context, {
        contents: f.contents,
        sha256: "0".repeat(64)
      }),
      { code: "INVALID_REVIEW_CANDIDATE_EVIDENCE" }
    );
    await assert.rejects(
      publishReviewArtifact(
        f.root,
        { ...f.context, path: "other/review-1.md" },
        { contents: f.contents, sha256: digestBytes(f.contents) }
      ),
      { code: "INVALID_REVIEW_ARTIFACT_PATH" }
    );
    assert.deepEqual(await snapshotTree(f.root), before);
  } finally {
    await f.dispose();
  }
});

test("accepted F1 validates the actual review iteration destination before private publication", async () => {
  const f = await fixture();
  try {
    const relative = `${f.work.binding.artifacts.reviewDirectory}/review-2.md`;
    const snapshot = reviewSnapshotFixture({
      artifactBinding: f.work,
      artifact: { ...f.snapshot.artifact, iteration: 2, path: relative }
    });
    const context = { ...snapshot.artifact, snapshot };
    const contents = renderReviewArtifact(
      currentReviewFixture(snapshot),
      context
    );
    const candidate = { contents, sha256: digestBytes(contents) };
    await writeFile(
      path.join(f.root, ".gitignore"),
      `.banzai/runs/\n.banzai/work/**\n!.banzai/work/\n!.banzai/work/*/\n!${relative}\n`
    );
    await assert.rejects(publishReviewArtifact(f.root, context, candidate), {
      code: "ARTIFACT_IGNORE_CONFLICT"
    });
    await assert.rejects(readFile(path.join(f.root, relative)), {
      code: "ENOENT"
    });
    await writeFile(
      path.join(f.root, ".gitignore"),
      ".banzai/work/\n.banzai/runs/\n"
    );
    await publishReviewArtifact(f.root, context, candidate);
    assert.equal(await readFile(path.join(f.root, relative), "utf8"), contents);
    assert.equal((await stat(path.join(f.root, relative))).mode & 0o777, 0o600);
  } finally {
    await f.dispose();
  }
});
