import assert from "node:assert/strict";
import test from "node:test";
import { BanzaiError } from "../src/errors.js";
import {
  parsePlanningReviewResult,
  validatePlanningReviewResult,
  parsePlanningReviewAnalysis,
  validatePlanningReviewAnalysis,
  parsePlanningReviewTriageAnswer,
  validateHumanFreeText
} from "../src/validation.js";
import { requiredFixture } from "./helpers.js";
import {
  planningReviewResult,
  planningReviewAnalysis,
  planningReviewAnswer
} from "./planning-review-fixtures.js";

test("invalid planning evidence lines are reviewer-result failures, not configuration failures", () => {
  const result = planningReviewResult();
  const finding = requiredFixture(result.findings[0]);
  const evidence = requiredFixture(finding.evidence[0]);
  for (const line of [0, -1, 0.5, "1", Number.NaN])
    assert.throws(
      () =>
        parsePlanningReviewResult({
          ...result,
          findings: [{ ...finding, evidence: [{ ...evidence, line }] }]
        }),
      (error: unknown) =>
        error instanceof BanzaiError && error.code === "INVALID_RESULT"
    );
});

test("planning review enforces closed identities, limits and exact scope binding", () => {
  for (const count of [0, 20]) {
    const result = planningReviewResult(count);
    assert.deepEqual(validatePlanningReviewResult(result, result), result);
  }
  const valid = planningReviewResult();
  const finding = requiredFixture(valid.findings[0]);
  const evidence = requiredFixture(finding.evidence[0]);
  const scope = requiredFixture(valid.scope[0]);
  const brokenFindings = [
    { ...finding, id: "P2-F1" },
    { ...finding, id: "P1-F01" },
    { ...finding, evidence: [] },
    { ...finding, evidence: Array.from({ length: 9 }, () => evidence) },
    { ...finding, evidence: [{ ...evidence, line: 0 }] },
    { ...finding, summary: "x".repeat(1001) },
    { ...finding, summary: " " },
    { ...finding, summary: "unsafe\u200e" },
    { ...finding, summary: "unsafe\u001b[2J" },
    { ...finding, evidence: [{ ...evidence, path: "x".repeat(301) }] },
    { ...finding, evidence: [{ ...evidence, detail: "x".repeat(501) }] },
    { ...finding, suggestedResolution: "x".repeat(1201) },
    { ...finding, category: "correctness" },
    { ...finding, confidence: "certain" },
    { ...finding, severity: "critical" }
  ];
  for (const invalid of [
    { ...valid, findings: planningReviewResult(21).findings },
    { ...valid, verdict: "pass" },
    { ...valid, schemaVersion: 2 },
    { ...valid, contractVersion: "2.0.0" },
    { ...valid, schema: "banzai-review-result/v1" },
    { ...valid, reviewNumber: 0 },
    { ...valid, reviewNumber: 1_000_001 },
    { ...valid, findings: [finding, finding] },
    { ...valid, scope: [{ ...scope, path: "../plan.md" }] },
    { ...valid, scope: [{ ...scope, path: "/plan.md" }] },
    { ...valid, scope: [{ ...scope, path: "documentation/./plan.md" }] },
    { ...valid, scope: [{ ...scope, sha256: "A".repeat(64) }] },
    { ...valid, scope: [scope, scope] },
    { ...valid, scope: [] },
    {
      ...valid,
      scope: Array.from({ length: 129 }, (_, index) => ({
        ...scope,
        path: `docs/${index}.md`
      }))
    },
    ...brokenFindings.map((item) => ({ ...valid, findings: [item] }))
  ])
    assert.throws(() => parsePlanningReviewResult(invalid), BanzaiError);
  const missing: Record<string, unknown> = { ...valid };
  delete missing.scope;
  assert.throws(() => parsePlanningReviewResult(missing), BanzaiError);
  assert.throws(() =>
    validatePlanningReviewResult(valid, { ...valid, reviewNumber: 2 })
  );
  assert.throws(() =>
    validatePlanningReviewResult(valid, {
      ...valid,
      scope: [{ ...scope, sha256: "b".repeat(64) }]
    })
  );
  const pair = {
    ...valid,
    scope: [scope, { ...scope, path: "docs/another.md" }]
  };
  assert.throws(() =>
    validatePlanningReviewResult(pair, {
      ...pair,
      scope: [...pair.scope].reverse()
    })
  );
  const prose = {
    ...valid,
    findings: [{ ...finding, summary: "  First\n\tsecond\r third  " }]
  };
  assert.equal(
    requiredFixture(parsePlanningReviewResult(prose).findings[0]).summary,
    "First second third"
  );
});

test("planning analysis binds every finding in order and only recommends a listed unique option", () => {
  const review = planningReviewResult(2);
  const valid = planningReviewAnalysis(review);
  const entry = requiredFixture(valid.entries[0]);
  const option = requiredFixture(entry.options[0]);
  assert.deepEqual(
    validatePlanningReviewAnalysis(valid, {
      ...review,
      resultDigest: valid.resultDigest
    }),
    valid
  );
  const noRecommendation = {
    ...valid,
    entries: [{ ...entry, recommendation: null }, ...valid.entries.slice(1)]
  };
  assert.equal(
    requiredFixture(parsePlanningReviewAnalysis(noRecommendation).entries[0])
      .recommendation,
    null
  );
  for (const invalid of [
    { ...valid, entries: [...valid.entries].reverse() },
    { ...valid, entries: valid.entries.slice(1) },
    { ...valid, resultDigest: "c".repeat(64) },
    { ...valid, reviewNumber: 2 },
    { ...valid, gate: "plan_approval" },
    ...[
      {
        ...entry,
        recommendation: { optionId: "unknown", rationale: "Not listed." }
      },
      { ...entry, options: [option, option] },
      { ...entry, options: [option, { ...option, optionId: "different" }] },
      { ...entry, options: [] },
      {
        ...entry,
        options: Array.from({ length: 4 }, (_, index) => ({
          ...option,
          optionId: `option-${index}`,
          label: `Option ${index}`
        }))
      },
      { ...entry, options: [{ ...option, consequences: [] }] },
      {
        ...entry,
        options: [
          {
            ...option,
            consequences: Array.from({ length: 9 }, () => "Consequence")
          }
        ]
      },
      { ...entry, options: [{ ...option, label: "x".repeat(161) }] },
      { ...entry, options: [{ ...option, consequences: ["x".repeat(501)] }] },
      { ...entry, rationale: "x".repeat(1201) },
      {
        ...entry,
        recommendation: {
          optionId: option.optionId,
          rationale: "x".repeat(1001)
        }
      },
      { ...entry, rationale: "\u061cunsafe" }
    ].map((item) => ({ ...valid, entries: [item, ...valid.entries.slice(1)] }))
  ])
    assert.throws(
      () =>
        validatePlanningReviewAnalysis(invalid, {
          ...review,
          resultDigest: valid.resultDigest
        }),
      BanzaiError
    );
});

test("planning triage accepts all dispositions atomically and records them in review order", () => {
  const analysis = planningReviewAnalysis(planningReviewResult(3));
  const valid = {
    ...planningReviewAnswer(analysis),
    dispositions: [
      {
        findingId: "P1-F3",
        kind: "decline",
        optionId: null,
        instruction: null
      },
      {
        findingId: "P1-F2",
        kind: "instruction",
        optionId: null,
        instruction: "  Keep the boundary.\nAdd its case.  "
      },
      {
        findingId: "P1-F1",
        kind: "option",
        optionId: "add-case",
        instruction: null
      }
    ],
    additionalInstruction: "  Retain existing acceptance.  "
  };
  const pending = { ...valid, entries: analysis.entries };
  const parsed = parsePlanningReviewTriageAnswer(valid, pending);
  assert.deepEqual(
    parsed.dispositions.map((item) => item.findingId),
    ["P1-F1", "P1-F2", "P1-F3"]
  );
  assert.equal(
    requiredFixture(parsed.dispositions[1]).instruction,
    "Keep the boundary.\nAdd its case."
  );
  assert.equal(parsed.additionalInstruction, "Retain existing acceptance.");
  const decline = requiredFixture(valid.dispositions[0]);
  const instruction = requiredFixture(valid.dispositions[1]);
  const selected = requiredFixture(valid.dispositions[2]);
  for (const invalid of [
    { ...valid, runId: "other" },
    { ...valid, episodeId: "other" },
    { ...valid, reviewNumber: 2 },
    { ...valid, analysisDigest: "b".repeat(64) },
    { ...valid, dispositions: valid.dispositions.slice(1) },
    { ...valid, dispositions: [instruction, instruction, selected] },
    {
      ...valid,
      dispositions: [{ ...decline, findingId: "P1-F99" }, instruction, selected]
    },
    {
      ...valid,
      dispositions: [decline, instruction, { ...selected, optionId: "unknown" }]
    },
    {
      ...valid,
      dispositions: [
        { ...decline, instruction: "decline cannot carry text" },
        instruction,
        selected
      ]
    },
    {
      ...valid,
      dispositions: [
        decline,
        { ...instruction, optionId: "add-case" },
        selected
      ]
    },
    {
      ...valid,
      dispositions: [
        decline,
        instruction,
        { ...selected, instruction: "option cannot carry text" }
      ]
    },
    {
      ...valid,
      dispositions: [decline, { ...instruction, instruction: " " }, selected]
    },
    {
      ...valid,
      dispositions: [decline, { ...instruction, kind: "defer" }, selected]
    },
    { ...valid, additionalInstruction: "\ud800" },
    { ...valid, additionalInstruction: " " },
    { ...valid, extra: true }
  ]) {
    const before = JSON.stringify(pending);
    assert.throws(
      () => parsePlanningReviewTriageAnswer(invalid, pending),
      BanzaiError
    );
    assert.equal(JSON.stringify(pending), before);
  }
});

test("human feedback is trimmed UTF-8 text with byte limits and surface-specific errors", () => {
  assert.equal(
    validateHumanFreeText("  Україна\t🙂\ntext  ", "Feedback", 8000),
    "Україна\t🙂\ntext"
  );
  assert.equal(
    validateHumanFreeText("я".repeat(4000), "Feedback", 8000).length,
    4000
  );
  for (const invalid of [
    "",
    " \t\n ",
    "bad\r",
    "\u0000",
    "\u000b",
    "\u007f",
    "\u009f",
    "\u061c",
    "\u200e",
    "\u200f",
    "\u202a",
    "\u2066",
    "\ud800",
    "\udfff",
    "я".repeat(4001),
    "x" + " ".repeat(8000)
  ]) {
    for (const code of [
      "INVALID_DECISION",
      "INVALID_CONTROL_INPUT",
      "STATE_READ_FAILED"
    ]) {
      assert.throws(
        () => validateHumanFreeText(invalid, "Feedback", 8000, code),
        (error: unknown) => error instanceof BanzaiError && error.code === code
      );
    }
  }
  assert.throws(() =>
    validateHumanFreeText("я".repeat(1001), "Own instruction", 2000)
  );
});
