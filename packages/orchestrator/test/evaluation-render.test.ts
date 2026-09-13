import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { collectEvaluationExport } from "../src/evaluation.js";
import {
  renderEvaluationJson,
  renderEvaluationMarkdown
} from "../src/evaluation-render.js";

test("JSON serialization is canonical, deterministic, and newline terminated", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "banzai-render-test-"));
  try {
    const report = await collectEvaluationExport(root, {
      format: "json",
      from: null,
      to: null,
      runIds: []
    });
    const before = structuredClone(report);
    const first = renderEvaluationJson(report);
    const second = renderEvaluationJson(report);
    assert.equal(first, `${JSON.stringify(report, null, 2)}\n`);
    assert.equal(second, first);
    assert.match(
      first,
      /^\{\n {2}"schema": "banzai-evaluation-export\/v2",\n {2}"schemaVersion": 2,/
    );
    assert.ok(first.endsWith("}\n"));
    assert.doesNotMatch(first, /\n\n$/);
    assert.deepEqual(report, before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Markdown is a stable compact projection with ordered sections and explicit unavailable claims", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "banzai-render-test-"));
  try {
    const report = await collectEvaluationExport(root, {
      format: "markdown",
      from: null,
      to: null,
      runIds: []
    });
    const first = renderEvaluationMarkdown(report);
    const second = renderEvaluationMarkdown(report);
    assert.equal(second, first);
    const sections = [
      "# Banzai Evaluation Export",
      "## Cohort",
      "## Overall",
      "## Failure Categories",
      "## Reviewer Rotation Reasons",
      "## Workflow Breakdown",
      "## Status Breakdown",
      "## Workflow and Status",
      "## Runs",
      "## Data Quality and Privacy"
    ];
    let previous = -1;
    for (const section of sections) {
      const current = first.indexOf(section);
      assert.ok(
        current > previous,
        `${section} must follow the previous section`
      );
      previous = current;
    }
    assert.match(first, /Schema: `banzai-evaluation-export\/v2` \(version 2\)/);
    assert.match(first, /\| Runs \| 0 \|/);
    assert.match(first, /\| Reported cost \(USD\) \| unavailable \|/);
    assert.match(first, /\| Human minutes \| unavailable \|/);
    assert.match(first, /\| False-positive rate \| unavailable \|/);
    assert.match(first, /\| Rejected triage \| 0 \|/);
    assert.doesNotMatch(first, /Rejected (findings|triage).*false positive/i);
    assert.match(first, /No runs are included in this cohort\./);
    assert.ok(first.endsWith("\n"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
