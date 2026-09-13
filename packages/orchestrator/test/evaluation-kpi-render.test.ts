import assert from "node:assert/strict";
import test from "node:test";
import { deriveEvaluationKpiReport } from "../src/evaluation-kpi.js";
import {
  renderEvaluationKpiJson,
  renderEvaluationKpiMarkdown
} from "../src/evaluation-kpi-render.js";
import type { EvaluationExport, EvaluationKpiReport } from "../src/types.js";

function minimalExport(runs: unknown[]): EvaluationExport {
  return {
    schema: "banzai-evaluation-export/v2",
    schemaVersion: 2,
    cohort: {
      from: null,
      to: null,
      explicitRuns: false,
      selectedRunCount: 0,
      candidateRunCount: runs.length,
      includedRunCount: runs.length,
      excludedRunCount: 0,
      unresolvedRunCount: 0
    },
    runs,
    aggregates: {},
    issues: []
  } as unknown as EvaluationExport;
}

function doneRun(runKey: string, model: string): unknown {
  const ev = <T>(value: T | null) => ({
    value,
    evidence: value === null ? "unknown" : "observed"
  });
  const metric = (value: number | null) => ({
    value,
    observedSubtotal: value ?? 0,
    observedCount: value === null ? 0 : 1,
    unknownCount: value === null ? 1 : 0,
    invalidCount: 0,
    availability: value === null ? "unavailable" : "complete"
  });
  return {
    runKey,
    cohortMembership: "included",
    completeness: "complete",
    source: { stateSchemaVersion: 5, contractVersion: ev("1.0.0") },
    workflow: ev("strict"),
    status: ev("done"),
    createdAt: ev("2026-08-01T00:00:00Z"),
    updatedAt: ev("2026-08-01T00:00:00Z"),
    terminal: ev(true),
    attempts: [
      {
        attemptKey: "attempt",
        source: { schemaVersion: ev(2) },
        kind: ev("implementation"),
        mutable: ev(true),
        status: ev("completed"),
        startedAt: ev(null),
        completedAt: ev(null),
        durationMs: ev(null),
        sessionMode: ev(null),
        reviewMode: ev(null),
        rotationReason: ev(null),
        model: { vendor: ev("codex"), model: ev(model), effort: ev("xhigh") },
        usage: {
          inputTokens: ev(null),
          cachedInputTokens: ev(null),
          outputTokens: ev(null),
          costUsd: ev(null)
        }
      }
    ],
    verification: [],
    verificationEvidence: {
      coverage: "exact",
      physicalAttempts: [{ ordinal: 1, status: "completed", durationMs: 10 }],
      dispositions: [
        { round: 1, check: 1, kind: "executed", origin: 1 },
        { round: 2, check: 1, kind: "reused", origin: 1 }
      ]
    },
    reviews: [
      {
        ordinal: 1,
        verdict: ev("pass"),
        findings: { blocker: 0, should_fix: 0, nit: 0 }
      }
    ],
    metrics: {
      attempts: {
        total: metric(1),
        byKind: {
          selection: metric(0),
          plan: metric(0),
          implementation: metric(1),
          fix: metric(0),
          review: metric(0),
          verification: metric(0)
        },
        byOutcome: {
          started: metric(0),
          completed: metric(1),
          failed: metric(0)
        }
      },
      triage: {
        accepted: metric(1),
        rejected: metric(1),
        deferred: metric(0)
      },
      fixCycles: metric(1),
      usage: {
        inputTokens: metric(1000),
        cachedInputTokens: metric(400),
        outputTokens: metric(200),
        costUsd: metric(null)
      }
    }
  };
}

function report(): EvaluationKpiReport {
  return deriveEvaluationKpiReport([
    {
      label: "private-source",
      report: minimalExport([doneRun("a", "model-a")])
    },
    {
      label: "another-source",
      report: minimalExport([
        {
          ...(doneRun("b", "model-b") as Record<string, unknown>),
          verificationEvidence: {
            coverage: "incomplete",
            physicalAttempts: [],
            dispositions: []
          }
        }
      ])
    }
  ]);
}

test("JSON renders current KPI identity canonically without source labels", () => {
  const document = report();
  const first = renderEvaluationKpiJson(document);
  assert.equal(first, `${JSON.stringify(document, null, 2)}\n`);
  assert.equal(document.schema, "banzai-evaluation-kpi/v2");
  assert.equal(document.schemaVersion, 2);
  assert.equal(renderEvaluationKpiJson(document), first);
  assert.doesNotMatch(first, /private-source|another-source/);
});

test("Markdown reports physical attempts, exact reuse denominators and incomplete coverage", () => {
  const document = report();
  const first = renderEvaluationKpiMarkdown(document);
  assert.equal(renderEvaluationKpiMarkdown(document), first);
  assert.match(first, /Schema: `banzai-evaluation-kpi\/v2` \(version 2\)/);
  assert.match(
    first,
    /\| Source \| Physical attempts \| Executed checks \| Reused checks \| Reuse ratio \| Exact \/ incomplete runs \|/
  );
  assert.match(first, /\| 1 \| 1 \| 1 \| 1 \| 0.5 \(1\/2\) \| 1 \/ 0 \|/);
  assert.match(
    first,
    /\| 2 \| 0 \| 0 \| 0 \| unavailable \(0\/0\) \| 0 \/ 1 \|/
  );
  assert.doesNotMatch(first, /private-source|another-source/);
  assert.ok(first.endsWith("\n"));
});

test("empty current KPI report keeps headers without inventing counts", () => {
  const document = deriveEvaluationKpiReport([]);
  assert.deepEqual(document.sources, []);
  const markdown = renderEvaluationKpiMarkdown(document);
  assert.match(markdown, /Counts and ratios use exact runs only/);
  assert.doesNotMatch(markdown, /\| 1 \|/);
});
