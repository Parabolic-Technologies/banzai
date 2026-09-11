import assert from "node:assert/strict";
import test from "node:test";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  symlink,
  chmod
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  renderReviewArtifact,
  validateReviewArtifact,
  publishReviewArtifact
} from "../src/review-artifact.js";
import { RunStore } from "../src/store.js";
import {
  parseReviewSnapshot,
  reviewApprovedArtifacts
} from "../src/review-snapshot.js";
import {
  reviewSnapshotFixture,
  currentReviewFixture
} from "./review-fixtures.js";
import {
  parseCurrentReviewResult,
  parseReviewResult,
  validateReviewScope
} from "../src/validation.js";

const without = (value: object, keys: string[]) =>
  Object.fromEntries(
    Object.entries(value).filter(([key]) => !keys.includes(key))
  ) as Record<string, unknown>;

const digest = "a".repeat(64);
const scope = {
  snapshotDigest: digest,
  approvedArtifactPaths: ["docs/description.md", "docs/plan.md"],
  requiredFindingIds: ["R1-F1"]
};
const response = () => ({
  contractVersion: "1.0.0",
  schemaVersion: 2,
  verdict: "pass",
  summary: "Reviewed.\nAll required scope.",
  findings: [],
  reviewedFindingIds: ["R1-F1"],
  deferredCoverage: ["EQ-SHADOW: opaque\n`text`"],
  reviewNotes: ["Additional rationale."],
  scopeAcknowledgment: {
    schemaVersion: 1,
    snapshotDigest: digest,
    artifacts: scope.approvedArtifactPaths.map((path) => ({
      path,
      status: "reviewed",
      reason: null
    }))
  }
});

test("review v2 preserves prose and requires explicit exact scope and assessed finding IDs", () => {
  const value = response();
  const result = parseCurrentReviewResult(value);
  assert.deepEqual(result, value);
  validateReviewScope(result, scope);
  const ack = value.scopeAcknowledgment;
  const first = ack.artifacts[0];
  assert.ok(first);
  const missingAck = without(value, ["scopeAcknowledgment"]);
  const missingVersion = without(value, ["schemaVersion"]);
  const invalids: unknown[] = [
    missingAck,
    missingVersion,
    ...[
      { ...ack, artifacts: ack.artifacts.slice(1) },
      { ...ack, artifacts: [...ack.artifacts, first] },
      {
        ...ack,
        artifacts: [
          { ...first, path: "docs/other.md" },
          ...ack.artifacts.slice(1)
        ]
      },
      {
        ...ack,
        artifacts: [
          { ...first, reason: "contradiction" },
          ...ack.artifacts.slice(1)
        ]
      },
      { ...ack, snapshotDigest: "b".repeat(64) }
    ].map((scopeAcknowledgment) => ({ ...value, scopeAcknowledgment })),
    ...[[], ["R1-F1", "R1-F1"], ["R9-F1"]].map((reviewedFindingIds) => ({
      ...value,
      reviewedFindingIds
    })),
    { ...value, extra: true }
  ];
  for (const invalid of invalids)
    assert.throws(() => {
      validateReviewScope(parseCurrentReviewResult(invalid), scope);
    });
});

test("review v2 permits truthful blocked coverage without findings or invented assessment", () => {
  const base = response();
  const value = {
    ...base,
    verdict: "blocked",
    reviewedFindingIds: [],
    scopeAcknowledgment: {
      ...base.scopeAcknowledgment,
      artifacts: scope.approvedArtifactPaths.map((path) => ({
        path,
        status: "not_reviewed",
        reason: "legacy Banzai layout: run project-manifest to migrate"
      }))
    }
  };
  const result = parseCurrentReviewResult(value);
  validateReviewScope(result, scope);
  assert.equal(result.findings.length, 0);
  assert.throws(() => parseCurrentReviewResult({ ...value, verdict: "pass" }));
  assert.throws(() =>
    parseCurrentReviewResult({
      ...value,
      scopeAcknowledgment: {
        ...value.scopeAcknowledgment,
        artifacts: value.scopeAcknowledgment.artifacts.map((entry) => ({
          ...entry,
          reason: "  "
        }))
      }
    })
  );
});

test("review v2 rejects unsafe path identities and never falls back to legacy", () => {
  for (const path of [
    "/docs/plan.md",
    "../docs/plan.md",
    "docs/../plan.md",
    "docs//plan.md",
    "docs\\plan.md",
    "docs/./plan.md",
    "docs/plan.md\0",
    "C:/docs/plan.md"
  ]) {
    const value = response();
    const first = value.scopeAcknowledgment.artifacts[0];
    assert.ok(first);
    first.path = path;
    assert.throws(() => parseCurrentReviewResult(value), path);
  }
  const legacy = without(response(), [
    "schemaVersion",
    "reviewNotes",
    "scopeAcknowledgment"
  ]);
  assert.deepEqual(parseReviewResult(legacy), legacy);
  assert.throws(() => parseCurrentReviewResult(legacy));
  assert.throws(() =>
    parseReviewResult({
      ...legacy,
      scopeAcknowledgment: response().scopeAcknowledgment
    })
  );
  assert.throws(() => parseReviewResult({ ...response(), schemaVersion: 99 }));
});

test("review v2 losslessly renders semantics and frozen runner evidence and rejects tampering", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "banzai-review-v2-"));
  try {
    const snapshot = reviewSnapshotFixture();
    const text =
      "first\n## Handoff\n````\n<script>alert(1)</script>\n| [link](url) \\ 😀\n";
    const result = currentReviewFixture(snapshot, {
      verdict: "changes_requested",
      summary: text,
      reviewNotes: [text, text],
      deferredCoverage: ["EQ-SHADOW: " + text, "EQ-SHADOW: " + text],
      findings: [
        {
          id: "R1-F2",
          severity: "should_fix",
          category: "correctness",
          confidence: "high",
          summary: text,
          evidence: [{ path: "source.js", line: 7, detail: text }],
          violates: [text, text],
          reproduction: text,
          fixAcceptance: text
        }
      ]
    });
    const context = { ...snapshot.artifact, snapshot };
    const parsed = parseCurrentReviewResult(result);
    assert.deepEqual(parsed, result);
    const rendered = renderReviewArtifact(result, context);
    assert.equal(
      renderReviewArtifact(structuredClone(result), structuredClone(context)),
      rendered
    );
    const values = [
      ...rendered.matchAll(/^(`{3,})json\n([\s\S]*?)\n\1$/gm)
    ].map((match) => {
      assert.ok(match[2]);
      return JSON.parse(match[2]) as unknown;
    });
    assert.ok(values.some((value) => value === text));
    assert.deepEqual(
      values.find(
        (value) =>
          typeof value === "object" &&
          value !== null &&
          "id" in value &&
          value.id === "R1-F2"
      ),
      result.findings[0]
    );
    assert.ok(
      values.some(
        (value) => JSON.stringify(value) === JSON.stringify(result.reviewNotes)
      )
    );
    assert.ok(
      values.some(
        (value) =>
          JSON.stringify(value) === JSON.stringify(result.deferredCoverage)
      )
    );
    assert.deepEqual(
      values.find(
        (value) =>
          Array.isArray(value) &&
          value.some(
            (entry: unknown) =>
              typeof entry === "object" && entry !== null && "command" in entry
          )
      ),
      snapshot.artifact.verification
    );
    await mkdir(path.dirname(path.join(root, context.candidatePath)), {
      recursive: true
    });
    await writeFile(path.join(root, context.candidatePath), rendered);
    const proof = await validateReviewArtifact(root, result, context);
    await publishReviewArtifact(root, context, proof);
    await publishReviewArtifact(root, context, proof);
    await writeFile(
      path.join(root, context.candidatePath),
      rendered + "\nwrong bytes"
    );
    await assert.rejects(
      validateReviewArtifact(root, result, context),
      /deterministic snapshot/
    );
    await assert.rejects(
      publishReviewArtifact(root, context, { ...proof, contents: "changed" }),
      /proof/
    );
    assert.equal(
      await readFile(path.join(root, context.path), "utf8"),
      rendered
    );
    const later = structuredClone(context);
    assert.ok(later.verification[0]);
    later.verification[0].exitCode = 0;
    assert.throws(() => renderReviewArtifact(result, later), /differs|digest/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("review v2 snapshot storage is immutable, private, identity-bound and excludes sidecars", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "banzai-snapshot-"));
  try {
    const store = new RunStore(root);
    const snapshot = reviewSnapshotFixture();
    const attempt = {
      id: snapshot.attemptId,
      kind: "review" as const,
      mutable: false
    };
    await store.writeReviewSnapshot(snapshot.runId, attempt, snapshot);
    await store.writeReviewSnapshot(snapshot.runId, attempt, snapshot);
    assert.deepEqual(
      await store.readReviewSnapshot(snapshot.runId, attempt),
      snapshot
    );
    assert.deepEqual(await store.readRunAttempts(snapshot.runId), []);
    const original = await readFile(
      store.reviewSnapshotPath(snapshot.runId, attempt)
    );
    await assert.rejects(
      store.writeReviewSnapshot(
        snapshot.runId,
        attempt,
        reviewSnapshotFixture({ reviewMode: "full", requiredFindingIds: [] })
      ),
      /already exists/
    );
    assert.deepEqual(
      await readFile(store.reviewSnapshotPath(snapshot.runId, attempt)),
      original
    );
    assert.throws(
      () => parseReviewSnapshot({ ...snapshot, baseCommit: "tampered" }),
      /digest/
    );
    await chmod(store.reviewSnapshotPath(snapshot.runId, attempt), 0o644);
    await assert.rejects(
      store.readReviewSnapshot(snapshot.runId, attempt),
      /private/
    );
    await mkdir(path.join(root, "docs"));
    await writeFile(path.join(root, "real.md"), "authority");
    await symlink(
      path.join(root, "real.md"),
      path.join(root, "docs", "plan.md")
    );
    await assert.rejects(
      reviewApprovedArtifacts(root, ["docs/plan.md"]),
      /physically owned/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("review v2 leaves frozen evaluation review semantics identical for equivalent evidence", async () => {
  const { parseEvaluationReviewSource } = await import("../src/validation.js");
  const current = currentReviewFixture(reviewSnapshotFixture());
  const legacy = without(current, [
    "schemaVersion",
    "scopeAcknowledgment",
    "reviewNotes"
  ]);
  assert.deepEqual(
    parseEvaluationReviewSource(current),
    parseEvaluationReviewSource(legacy)
  );
});

test("review snapshot rejects file hashes inconsistent with the approved bundle digest", () => {
  const original = reviewSnapshotFixture();
  assert.throws(
    () =>
      reviewSnapshotFixture({
        approvedArtifacts: original.approvedArtifacts.map((entry) => ({
          ...entry,
          sha256: "f".repeat(64)
        }))
      }),
    /approved bundle/i
  );
});
