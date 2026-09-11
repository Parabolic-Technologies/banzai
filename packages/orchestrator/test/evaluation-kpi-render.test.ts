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
    schema: "banzai-evaluation-export/v1",
    schemaVersion: 1,
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
    source: { stateSchemaVersion: 2, contractVersion: ev("1.0.0") },
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
      label: "1: a.json",
      report: minimalExport([doneRun("a", "gpt-5.6-sol")])
    },
    { label: "2: b.json", report: minimalExport([doneRun("b", "gpt-5.6")]) }
  ]);
}

test("json rendering is canonical two-space serialization with a trailing newline", () => {
  const document = report();
  const first = renderEvaluationKpiJson(document);
  assert.equal(first, `${JSON.stringify(document, null, 2)}\n`);
  assert.match(
    first,
    /^\{\n {2}"schema": "banzai-evaluation-kpi\/v1",\n {2}"schemaVersion": 1,/
  );
  assert.ok(first.endsWith("}\n"));
  assert.equal(renderEvaluationKpiJson(document), first);
});

test("markdown renders sources and one comparison table per kpi with labeled columns", () => {
  const first = renderEvaluationKpiMarkdown(report());
  assert.equal(renderEvaluationKpiMarkdown(report()), first);
  assert.match(first, /# Banzai Evaluation KPIs/);
  assert.match(first, /Schema: `banzai-evaluation-kpi\/v1` \(version 1\)/);
  assert.match(first, /## Sources/);
  assert.match(first, /\| 1 \| 1: a\.json \| 1 \| 0 \|/);
  const sections = [
    "## completion_rate (rate)",
    "## first_review_pass_rate (rate)",
    "## first_review_mean_findings (mean)",
    "## first_review_acceptance_rate (rate)",
    "## reviewer_precision (rate)",
    "## zero_accepted_review_rate (rate)",
    "## triage_deferred (count)",
    "## fix_cycles_per_completed_run (mean)",
    "## fix_cycles_per_completed_run (max)",
    "## attempt_retry_ratio (plan)",
    "## attempt_retry_ratio (implementation)",
    "## attempt_retry_ratio (fix)",
    "## attempt_retry_ratio (review)",
    "## usage_per_completed_run (mean_input_tokens)",
    "## usage_per_completed_run (mean_cached_input_tokens)",
    "## usage_per_completed_run (mean_output_tokens)",
    "## usage_per_completed_run (cache_ratio)",
    "## usage_per_completed_run (mean_cost_usd)"
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
  assert.match(first, /\| Row \| 1: a\.json \| 2: b\.json \|/);
  assert.match(
    first,
    /\| overall \| 100\.0% \(1\/1; exact 1, incomplete 0\) \| 100\.0% \(1\/1; exact 1, incomplete 0\) \|/
  );
  assert.match(
    first,
    /\| quick-fix \| unavailable \(0\/0; exact 0, incomplete 0\)/
  );
  assert.match(first, /unavailable \(0\/0; exact 0, incomplete 1\)/);
  assert.ok(first.endsWith("\n"));
});

test("markdown renders a dash for a signature group absent from a source", () => {
  const first = renderEvaluationKpiMarkdown(report());
  const line = first
    .split("\n")
    .find((item) =>
      item.startsWith(
        "| planner=unknown implementer=codex/gpt-5.6-sol/xhigh reviewer=unknown |"
      )
    );
  assert.ok(line, "signature row for the first source must exist");
  const cells = line.split("|").map((item) => item.trim());
  assert.equal(cells[3], "-");
});

test("markdown renders ratio percentages and mean decimals per the cell grammar", () => {
  const first = renderEvaluationKpiMarkdown(report());
  assert.match(
    first,
    /## usage_per_completed_run \(cache_ratio\)[\s\S]*?\| overall \| 40\.0% \(400\/1000; exact 1, incomplete 0\)/
  );
  assert.match(
    first,
    /## usage_per_completed_run \(mean_input_tokens\)[\s\S]*?\| overall \| 1000\.00 \(1000\/1; exact 1, incomplete 0\)/
  );
  assert.match(
    first,
    /## usage_per_completed_run \(mean_cost_usd\)[\s\S]*?\| overall \| unavailable \(0\/0; exact 0, incomplete 1\)/
  );
});
