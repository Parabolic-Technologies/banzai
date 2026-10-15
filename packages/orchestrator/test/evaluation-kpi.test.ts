import { requiredFixture } from "./helpers.js";
import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeEvaluationExportInput,
  decodeEvaluationExportV2Input,
  deriveEvaluationKpiV2,
  deriveEvaluationKpiReport,
  deriveEvaluationKpiSource,
  deriveRunSignature
} from "../src/evaluation-kpi.js";
import { BanzaiError } from "../src/errors.js";
import type {
  AttemptReference,
  EvaluationAggregates,
  EvaluationAttempt,
  EvaluationExport,
  EvaluationExportV2,
  EvaluationKpiEntry,
  EvaluationMetricSet,
  EvaluationReview,
  EvaluationRun,
  EvidenceValue,
  ModelSettings,
  NumericMetric,
  ReviewMode,
  EvaluationRotationReason,
  ReviewVerdict,
  RunStatus,
  SessionMode,
  WorkflowRoute
} from "../src/types.js";

function ev<T>(value: T | null): EvidenceValue<T> {
  return { value, evidence: value === null ? "unknown" : "observed" };
}

function unavailable(): NumericMetric {
  return {
    value: null,
    observedSubtotal: 0,
    observedCount: 0,
    unknownCount: 1,
    invalidCount: 0,
    availability: "unavailable"
  };
}

function complete(value: number): NumericMetric {
  return {
    value,
    observedSubtotal: value,
    observedCount: 1,
    unknownCount: 0,
    invalidCount: 0,
    availability: "complete"
  };
}

interface MetricOverrides {
  triage?: {
    accepted: NumericMetric;
    rejected: NumericMetric;
    deferred: NumericMetric;
  };
  fixCycles?: NumericMetric;
  usage?: {
    inputTokens: NumericMetric;
    cachedInputTokens: NumericMetric;
    outputTokens: NumericMetric;
    costUsd: NumericMetric;
  };
}

function metricSet(overrides: MetricOverrides = {}): EvaluationMetricSet {
  const record = <K extends string>(keys: readonly K[]) =>
    Object.fromEntries(keys.map((key) => [key, unavailable()])) as Record<
      K,
      NumericMetric
    >;
  return {
    attempts: {
      total: unavailable(),
      byKind: record([
        "selection",
        "plan",
        "implementation",
        "fix",
        "review",
        "verification"
      ]),
      byOutcome: record(["started", "completed", "failed"])
    },
    durationsMs: record([
      "selection",
      "planning",
      "implementation",
      "verification",
      "review",
      "fixing"
    ]),
    sessions: record(["fresh", "resumed", "unknown"]),
    reviews: {
      attempts: record(["full", "delta", "unknown"]),
      rotations: {
        total: unavailable(),
        byReason: record([
          "primary-review",
          "missing-session",
          "legacy-state",
          "settings-changed",
          "approval-changed",
          "previous-review-failed",
          "previous-review-interrupted",
          "previous-review-blocked",
          "accepted-high-risk-finding",
          "delta-limit-reached",
          "session-inventory-changed",
          "unreliable-review"
        ])
      },
      verdicts: record([
        "pass",
        "changes_requested",
        "replan_required",
        "blocked"
      ]),
      findings: record(["blocker", "should_fix", "nit"])
    },
    triage: overrides.triage ?? {
      accepted: unavailable(),
      rejected: unavailable(),
      deferred: unavailable()
    },
    retries: {
      total: unavailable(),
      byKind: record(["attempt", "start_checks", "review_checks"])
    },
    failures: record([
      "startup_check",
      "model_attempt",
      "verification_command",
      "review_check",
      "review_verdict_blocked",
      "interrupted_attempt",
      "malformed_persisted_evidence",
      "blocked_other"
    ]),
    verification: {
      retained: unavailable(),
      completed: unavailable(),
      failed: unavailable()
    },
    usage: overrides.usage ?? {
      inputTokens: unavailable(),
      cachedInputTokens: unavailable(),
      outputTokens: unavailable(),
      costUsd: unavailable()
    },
    fixCycles: overrides.fixCycles ?? unavailable(),
    humanMinutes: unavailable(),
    falsePositiveRate: unavailable()
  };
}

interface AttemptOverrides {
  kind?: EvaluationAttempt["kind"];
  status?: EvaluationAttempt["status"];
  vendor?: EvidenceValue<"codex" | "claude" | "unknown">;
  model?: EvidenceValue<string>;
  effort?: EvaluationAttempt["model"]["effort"];
}

function attempt(overrides: AttemptOverrides = {}): EvaluationAttempt {
  return {
    attemptKey: "attempt",
    source: { schemaVersion: ev(2) },
    kind: overrides.kind ?? ev("implementation"),
    mutable: ev(true),
    status: overrides.status ?? ev("completed"),
    startedAt: ev<string>(null),
    completedAt: ev<string>(null),
    durationMs: ev<number>(null),
    sessionMode: ev<SessionMode>(null),
    reviewMode: ev<ReviewMode>(null),
    rotationReason: ev<EvaluationRotationReason>(null),
    model: {
      vendor: overrides.vendor ?? ev("codex"),
      model: overrides.model ?? ev("gpt-5.6-sol"),
      effort: overrides.effort ?? ev("xhigh")
    },
    usage: {
      inputTokens: ev<number>(null),
      cachedInputTokens: ev<number>(null),
      outputTokens: ev<number>(null),
      costUsd: ev<number>(null)
    }
  };
}

function review(
  ordinal: number,
  verdict: EvaluationReview["verdict"],
  findings: { blocker: number; should_fix: number; nit: number } = {
    blocker: 0,
    should_fix: 0,
    nit: 0
  }
): EvaluationReview {
  return { ordinal, verdict, findings };
}

interface RunOverrides {
  runKey?: string;
  cohortMembership?: EvaluationRun["cohortMembership"];
  workflow?: EvaluationRun["workflow"];
  status?: EvaluationRun["status"];
  terminal?: EvaluationRun["terminal"];
  attempts?: EvaluationAttempt[];
  reviews?: EvaluationReview[];
  metrics?: EvaluationMetricSet;
}

function run(overrides: RunOverrides = {}): EvaluationRun {
  const attempts = overrides.attempts ?? [];
  const metrics = overrides.metrics ?? metricSet();
  // Hand-built exports must carry the model-set coverage their arrays claim.
  for (const kind of [
    "selection",
    "plan",
    "implementation",
    "fix",
    "review"
  ] as const) {
    metrics.attempts.byKind[kind] = complete(
      attempts.filter((item) => item.kind.value === kind).length
    );
  }
  return {
    runKey: overrides.runKey ?? "run-1",
    cohortMembership: overrides.cohortMembership ?? "included",
    completeness: "complete",
    source: { stateSchemaVersion: 2, contractVersion: ev("1.0.0") },
    workflow: overrides.workflow ?? ev("strict"),
    status: overrides.status ?? ev("done"),
    createdAt: ev("2026-08-01T00:00:00Z"),
    updatedAt: ev("2026-08-01T00:00:00Z"),
    terminal: overrides.terminal ?? ev(true),
    attempts,
    verification: [],
    reviews: overrides.reviews ?? [],
    metrics,
    issueCodes: []
  };
}

function exportFixture(runs: EvaluationRun[]): EvaluationExport {
  const included = runs.filter(
    (item) => item.cohortMembership === "included"
  ).length;
  return {
    schema: "banzai-evaluation-export/v1",
    schemaVersion: 1,
    cohort: {
      from: null,
      to: null,
      explicitRuns: false,
      selectedRunCount: 0,
      candidateRunCount: runs.length,
      includedRunCount: included,
      excludedRunCount: 0,
      unresolvedRunCount: runs.length - included
    },
    runs,
    // KPI derivation must never read aggregates (FR4 / ADR-0026): any access
    // through this proxy fails the test that used the fixture.
    aggregates: new Proxy(
      {},
      {
        get() {
          throw new Error("kpi derivation must not read export aggregates");
        }
      }
    ) as EvaluationAggregates,
    issues: []
  };
}

function entry(
  source: ReturnType<typeof deriveEvaluationKpiSource>,
  kpi: string,
  measure: string
): EvaluationKpiEntry {
  const found = source.kpis.find(
    (item) => item.kpi === kpi && item.measure === measure
  );
  assert.ok(found, `${kpi} (${measure}) must exist`);
  return found;
}

test("kpi report embeds the versioned identity and one source per input in order", () => {
  const report = deriveEvaluationKpiReport([
    { label: "1: a.json", report: exportFixture([run()]) },
    { label: "2: b.json", report: exportFixture([]) }
  ]);
  assert.equal(report.schema, "banzai-evaluation-kpi/v1");
  assert.equal(report.schemaVersion, 1);
  assert.deepEqual(
    report.sources.map((source) => [source.ordinal, source.label]),
    [
      [1, "1: a.json"],
      [2, "2: b.json"]
    ]
  );
  const [firstSource] = report.sources;
  assert.ok(firstSource);
  assert.equal(firstSource.includedRunCount, 1);
  assert.deepEqual(
    firstSource.kpis.map((item) => `${item.kpi}/${item.measure}`),
    [
      "completion_rate/rate",
      "first_review_pass_rate/rate",
      "first_review_mean_findings/mean",
      "first_review_acceptance_rate/rate",
      "reviewer_precision/rate",
      "zero_accepted_review_rate/rate",
      "triage_deferred/count",
      "fix_cycles_per_completed_run/mean",
      "fix_cycles_per_completed_run/max",
      "attempt_retry_ratio/plan",
      "attempt_retry_ratio/implementation",
      "attempt_retry_ratio/fix",
      "attempt_retry_ratio/review",
      "usage_per_completed_run/mean_input_tokens",
      "usage_per_completed_run/mean_cached_input_tokens",
      "usage_per_completed_run/mean_output_tokens",
      "usage_per_completed_run/cache_ratio",
      "usage_per_completed_run/mean_cost_usd"
    ]
  );
});

test("completion rate counts done over terminal runs with coverage for unknown evidence", () => {
  const source = deriveEvaluationKpiSource(
    1,
    "current",
    exportFixture([
      run({ runKey: "a", status: ev("done"), terminal: ev(true) }),
      run({ runKey: "b", status: ev("blocked"), terminal: ev(true) }),
      run({
        runKey: "c",
        workflow: ev("feature"),
        status: ev("reviewing"),
        terminal: ev(false)
      }),
      run({
        runKey: "d",
        workflow: ev<WorkflowRoute>(null),
        status: ev<RunStatus>(null),
        terminal: ev<boolean>(null)
      })
    ])
  );
  const completion = entry(source, "completion_rate", "rate");
  assert.deepEqual(completion.overall, {
    numerator: 1,
    denominator: 2,
    value: 0.5,
    coverage: { exact: 3, incomplete: 1 }
  });
  assert.ok(completion.byWorkflow);
  assert.deepEqual(
    completion.byWorkflow.map((group) => group.group),
    ["quick-fix", "feature", "strict", "unknown"]
  );
  const strict = completion.byWorkflow.find(
    (group) => group.group === "strict"
  );
  assert.deepEqual(strict?.value, {
    numerator: 1,
    denominator: 2,
    value: 0.5,
    coverage: { exact: 2, incomplete: 0 }
  });
  const unknown = completion.byWorkflow.find(
    (group) => group.group === "unknown"
  );
  assert.deepEqual(unknown?.value.coverage, { exact: 0, incomplete: 1 });
});

test("zero denominators yield null values rather than invented numbers", () => {
  const source = deriveEvaluationKpiSource(1, "current", exportFixture([]));
  for (const item of source.kpis) {
    assert.equal(item.overall.denominator, 0);
    assert.equal(item.overall.value, null);
    assert.deepEqual(item.overall.coverage, { exact: 0, incomplete: 0 });
  }
  assert.deepEqual(source.signatures, []);
});

test("first review pass rate uses the lowest ordinal verdict and reports mean findings", () => {
  const source = deriveEvaluationKpiSource(
    1,
    "current",
    exportFixture([
      run({
        runKey: "a",
        reviews: [
          review(2, ev("changes_requested"), {
            blocker: 1,
            should_fix: 2,
            nit: 3
          }),
          review(1, ev("pass"), { blocker: 2, should_fix: 0, nit: 1 })
        ]
      }),
      run({
        runKey: "b",
        reviews: [
          review(1, ev("changes_requested"), {
            blocker: 0,
            should_fix: 1,
            nit: 0
          })
        ]
      }),
      run({ runKey: "c", reviews: [] }),
      run({ runKey: "d", reviews: [review(1, ev<ReviewVerdict>(null))] })
    ])
  );
  const passRate = entry(source, "first_review_pass_rate", "rate");
  assert.deepEqual(passRate.overall, {
    numerator: 1,
    denominator: 2,
    value: 0.5,
    coverage: { exact: 2, incomplete: 1 }
  });
  const meanFindings = entry(source, "first_review_mean_findings", "mean");
  assert.deepEqual(meanFindings.overall, {
    numerator: 4,
    denominator: 2,
    value: 2,
    coverage: { exact: 2, incomplete: 1 }
  });
});

test("reviewer precision separates deferred and fails closed on incomplete triage", () => {
  const source = deriveEvaluationKpiSource(
    1,
    "current",
    exportFixture([
      run({
        runKey: "a",
        metrics: metricSet({
          triage: {
            accepted: complete(2),
            rejected: complete(1),
            deferred: complete(1)
          }
        })
      }),
      run({ runKey: "b" })
    ])
  );
  const precision = entry(source, "reviewer_precision", "rate");
  assert.deepEqual(precision.overall, {
    numerator: 2,
    denominator: 3,
    value: 2 / 3,
    coverage: { exact: 1, incomplete: 1 }
  });
  const deferred = entry(source, "triage_deferred", "count");
  assert.deepEqual(deferred.overall, {
    numerator: 1,
    denominator: 1,
    value: 1,
    coverage: { exact: 1, incomplete: 1 }
  });
});

test("first review acceptance rate keeps deferred in the denominator and refuses to decompose cumulative triage", () => {
  const triage = (accepted: number, rejected: number, deferred: number) =>
    metricSet({
      triage: {
        accepted: complete(accepted),
        rejected: complete(rejected),
        deferred: complete(deferred)
      }
    });
  const source = deriveEvaluationKpiSource(
    1,
    "current",
    exportFixture([
      // One review, four findings raised, one accepted: deferred stays in the
      // denominator, so this is 1/4 rather than the 1/2 precision would show.
      run({
        runKey: "a",
        reviews: [
          review(1, ev("changes_requested"), {
            blocker: 1,
            should_fix: 2,
            nit: 1
          })
        ],
        metrics: triage(1, 1, 2)
      }),
      // Two applied reviews: cumulative triage cannot be attributed to the
      // first one, so the run is coverage-incomplete.
      run({
        runKey: "b",
        reviews: [
          review(1, ev("changes_requested"), {
            blocker: 1,
            should_fix: 0,
            nit: 0
          }),
          review(2, ev("pass"), { blocker: 0, should_fix: 0, nit: 0 })
        ],
        metrics: triage(1, 0, 0)
      }),
      // Triaged total disagrees with the findings that review raised.
      run({
        runKey: "c",
        reviews: [
          review(1, ev("changes_requested"), {
            blocker: 0,
            should_fix: 3,
            nit: 0
          })
        ],
        metrics: triage(1, 0, 0)
      }),
      // A clean first review raised nothing to accept.
      run({
        runKey: "d",
        reviews: [review(1, ev("pass"))],
        metrics: triage(0, 0, 0)
      }),
      run({ runKey: "e", reviews: [] })
    ])
  );
  const acceptance = entry(source, "first_review_acceptance_rate", "rate");
  assert.deepEqual(acceptance.overall, {
    numerator: 1,
    denominator: 4,
    value: 0.25,
    coverage: { exact: 2, incomplete: 2 }
  });
  const precision = entry(source, "reviewer_precision", "rate");
  assert.equal(precision.overall.value, 3 / 4);
});

test("zero accepted review rate counts reviewed runs whose triage accepted nothing", () => {
  const triage = (accepted: number, rejected: number, deferred: number) =>
    metricSet({
      triage: {
        accepted: complete(accepted),
        rejected: complete(rejected),
        deferred: complete(deferred)
      }
    });
  const source = deriveEvaluationKpiSource(
    1,
    "current",
    exportFixture([
      // Every finding rejected or deferred: the witch-hunt signal.
      run({
        runKey: "a",
        reviews: [
          review(1, ev("changes_requested"), {
            blocker: 1,
            should_fix: 1,
            nit: 0
          })
        ],
        metrics: triage(0, 1, 1)
      }),
      run({
        runKey: "b",
        reviews: [
          review(1, ev("changes_requested"), {
            blocker: 0,
            should_fix: 1,
            nit: 0
          })
        ],
        metrics: triage(1, 0, 0)
      }),
      // Reviewed but raised nothing: not evidence either way.
      run({
        runKey: "c",
        reviews: [review(1, ev("pass"))],
        metrics: triage(0, 0, 0)
      }),
      // Reviewed with unusable triage evidence.
      run({
        runKey: "d",
        reviews: [
          review(1, ev("changes_requested"), {
            blocker: 1,
            should_fix: 0,
            nit: 0
          })
        ]
      }),
      run({ runKey: "e", reviews: [] })
    ])
  );
  const zeroAccepted = entry(source, "zero_accepted_review_rate", "rate");
  assert.deepEqual(zeroAccepted.overall, {
    numerator: 1,
    denominator: 2,
    value: 0.5,
    coverage: { exact: 3, incomplete: 1 }
  });
});

test("fix cycles per completed run report mean and max over done runs only", () => {
  const source = deriveEvaluationKpiSource(
    1,
    "current",
    exportFixture([
      run({ runKey: "a", metrics: metricSet({ fixCycles: complete(1) }) }),
      run({ runKey: "b", metrics: metricSet({ fixCycles: complete(3) }) }),
      run({
        runKey: "c",
        status: ev("blocked"),
        metrics: metricSet({ fixCycles: complete(5) })
      }),
      run({ runKey: "d" })
    ])
  );
  const mean = entry(source, "fix_cycles_per_completed_run", "mean");
  assert.deepEqual(mean.overall, {
    numerator: 4,
    denominator: 2,
    value: 2,
    coverage: { exact: 2, incomplete: 1 }
  });
  const max = entry(source, "fix_cycles_per_completed_run", "max");
  assert.deepEqual(max.overall, {
    numerator: 3,
    denominator: 2,
    value: 3,
    coverage: { exact: 2, incomplete: 1 }
  });
});

test("attempt retry ratio counts failed and interrupted attempts by kind and fails closed on unattributable attempts", () => {
  const source = deriveEvaluationKpiSource(
    1,
    "current",
    exportFixture([
      run({
        runKey: "a",
        attempts: [
          attempt({ kind: ev("plan"), status: ev("completed") }),
          attempt({ kind: ev("plan"), status: ev("failed") }),
          attempt({ kind: ev("implementation"), status: ev("completed") }),
          attempt({ kind: ev("review"), status: ev("interrupted") })
        ]
      }),
      run({
        runKey: "b",
        attempts: [
          attempt({
            kind: ev<
              Exclude<
                AttemptReference["kind"],
                "planning_review" | "planning_analysis"
              >
            >(null),
            status: ev("completed")
          })
        ]
      })
    ])
  );
  const plan = entry(source, "attempt_retry_ratio", "plan");
  assert.deepEqual(plan.overall, {
    numerator: 1,
    denominator: 2,
    value: 0.5,
    coverage: { exact: 1, incomplete: 1 }
  });
  const reviewRatio = entry(source, "attempt_retry_ratio", "review");
  assert.deepEqual(reviewRatio.overall, {
    numerator: 1,
    denominator: 1,
    value: 1,
    coverage: { exact: 1, incomplete: 1 }
  });
  const fix = entry(source, "attempt_retry_ratio", "fix");
  assert.deepEqual(fix.overall, {
    numerator: 0,
    denominator: 0,
    value: null,
    coverage: { exact: 1, incomplete: 1 }
  });
});

test("usage per completed run separates token and cost coverage", () => {
  const tokens = (
    input: number,
    cached: number,
    output: number,
    cost: NumericMetric
  ) => ({
    inputTokens: complete(input),
    cachedInputTokens: complete(cached),
    outputTokens: complete(output),
    costUsd: cost
  });
  const source = deriveEvaluationKpiSource(
    1,
    "current",
    exportFixture([
      run({
        runKey: "a",
        metrics: metricSet({ usage: tokens(1000, 400, 200, complete(1.25)) })
      }),
      run({
        runKey: "b",
        metrics: metricSet({ usage: tokens(2000, 600, 300, unavailable()) })
      }),
      run({ runKey: "c", status: ev("blocked") })
    ])
  );
  const meanInput = entry(
    source,
    "usage_per_completed_run",
    "mean_input_tokens"
  );
  assert.deepEqual(meanInput.overall, {
    numerator: 3000,
    denominator: 2,
    value: 1500,
    coverage: { exact: 2, incomplete: 0 }
  });
  const cacheRatio = entry(source, "usage_per_completed_run", "cache_ratio");
  assert.deepEqual(cacheRatio.overall, {
    numerator: 1000,
    denominator: 3000,
    value: 1000 / 3000,
    coverage: { exact: 2, incomplete: 0 }
  });
  const cost = entry(source, "usage_per_completed_run", "mean_cost_usd");
  assert.deepEqual(cost.overall, {
    numerator: 1.25,
    denominator: 1,
    value: 1.25,
    coverage: { exact: 1, incomplete: 1 }
  });
});

test("configuration signatures derive mixed and unknown fail-closed", () => {
  const mixedRun = run({
    runKey: "a",
    attempts: [
      attempt({ kind: ev("selection") }),
      attempt({ kind: ev("plan") }),
      attempt({ kind: ev("implementation") }),
      attempt({
        kind: ev("fix"),
        vendor: ev("claude"),
        model: ev("claude-opus-5")
      })
    ]
  });
  assert.deepEqual(deriveRunSignature(mixedRun), {
    planner: "codex/gpt-5.6-sol/xhigh",
    implementer: "mixed",
    reviewer: "unknown",
    key: "planner=codex/gpt-5.6-sol/xhigh implementer=mixed reviewer=unknown"
  });

  const nullIdentity = run({
    runKey: "b",
    attempts: [
      attempt({ kind: ev("review"), effort: ev<ModelSettings["effort"]>(null) })
    ]
  });
  assert.equal(deriveRunSignature(nullIdentity).reviewer, "unknown");

  const unattributable = run({
    runKey: "c",
    attempts: [
      attempt({ kind: ev("plan") }),
      attempt({
        kind: ev<
          Exclude<
            AttemptReference["kind"],
            "planning_review" | "planning_analysis"
          >
        >(null)
      })
    ]
  });
  assert.deepEqual(deriveRunSignature(unattributable), {
    planner: "unknown",
    implementer: "unknown",
    reviewer: "unknown",
    key: "planner=unknown implementer=unknown reviewer=unknown"
  });

  const source = deriveEvaluationKpiSource(
    1,
    "current",
    exportFixture([mixedRun, nullIdentity, unattributable])
  );
  const keys = source.signatures.map((signature) => signature.key);
  assert.deepEqual(keys, [...keys].sort());
  assert.equal(
    source.signatures.reduce(
      (total, signature) => total + signature.runCount,
      0
    ),
    3
  );
  const completion = entry(source, "completion_rate", "rate");
  assert.deepEqual(
    completion.bySignature.map((group) => group.group),
    source.signatures.map((signature) => signature.key)
  );
});

test("unresolved runs are outside kpi scope", () => {
  const source = deriveEvaluationKpiSource(
    1,
    "current",
    exportFixture([run({ runKey: "a", cohortMembership: "unresolved" })])
  );
  const completion = entry(source, "completion_rate", "rate");
  assert.deepEqual(completion.overall.coverage, { exact: 0, incomplete: 0 });
  assert.equal(source.includedRunCount, 0);
  assert.deepEqual(source.signatures, []);
});

test("kpi derivation is deterministic over identical inputs", () => {
  const build = () =>
    deriveEvaluationKpiReport([
      {
        label: "current",
        report: exportFixture([
          run({
            runKey: "a",
            reviews: [review(1, ev("pass"))],
            attempts: [attempt({ kind: ev("plan"), status: ev("failed") })],
            metrics: metricSet({ fixCycles: complete(2) })
          })
        ])
      }
    ]);
  assert.equal(JSON.stringify(build()), JSON.stringify(build()));
});

function validInputDocument(): Record<string, unknown> {
  const running = run();
  return {
    schema: "banzai-evaluation-export/v1",
    schemaVersion: 1,
    cohort: { includedRunCount: 1 },
    runs: [JSON.parse(JSON.stringify(running))],
    aggregates: {},
    issues: []
  };
}

test("input decoding accepts a structurally valid export document", () => {
  const decoded = decodeEvaluationExportInput(
    JSON.stringify(validInputDocument()),
    "a.json"
  );
  const source = deriveEvaluationKpiSource(1, "1: a.json", decoded);
  assert.equal(source.includedRunCount, 1);
});

test("input decoding fails closed with INVALID_EVAL_INPUT on malformed or foreign documents", () => {
  const reject = (text: string, fragment: RegExp) => {
    assert.throws(
      () => decodeEvaluationExportInput(text, "bad.json"),
      (error: unknown) => {
        assert.ok(error instanceof BanzaiError);
        assert.equal(error.code, "INVALID_EVAL_INPUT");
        assert.match(error.message, /bad\.json/);
        assert.match(error.message, fragment);
        return true;
      }
    );
  };
  reject("not json", /not valid JSON/);
  reject("[]", /not a JSON object/);
  reject(JSON.stringify({ schemaVersion: 1 }), /schema identity/);
  reject(
    JSON.stringify({ ...validInputDocument(), schema: "banzai-doctor/v1" }),
    /schema identity/
  );
  reject(
    JSON.stringify({ ...validInputDocument(), schemaVersion: 2 }),
    /unsupported evaluation export schema version/
  );
  reject(
    JSON.stringify({ ...validInputDocument(), runs: undefined }),
    /missing runs/
  );
  reject(
    JSON.stringify({ ...validInputDocument(), issues: undefined }),
    /structured issues/
  );
  const missingTriage = validInputDocument();
  const [firstRun] = missingTriage.runs as {
    metrics: Record<string, unknown>;
  }[];
  assert.ok(firstRun);
  delete firstRun.metrics.triage;
  reject(JSON.stringify(missingTriage), /triage/);
  const badAttempt = validInputDocument();
  (
    (badAttempt.runs as Record<string, unknown>[])[0] as { attempts: unknown[] }
  ).attempts = [{ kind: { value: "plan", evidence: "observed" } }];
  reject(JSON.stringify(badAttempt), /kind or status/);
});

test("verification KPI v2 counts terminal dispositions once and keeps retries and incomplete coverage separate", () => {
  const make = (): EvaluationExportV2 => ({
    ...exportFixture([run()]),
    schema: "banzai-evaluation-export/v2",
    schemaVersion: 2,
    runs: [
      {
        ...run(),
        verificationEvidence: {
          coverage: "exact",
          physicalAttempts: [
            { ordinal: 1, status: "failed", durationMs: 5 },
            { ordinal: 2, status: "completed", durationMs: 10 }
          ],
          dispositions: [
            { round: 1, check: 1, kind: "executed", origin: 2 },
            { round: 2, check: 1, kind: "reused", origin: 2 }
          ]
        }
      }
    ]
  });
  const source = requiredFixture(deriveEvaluationKpiV2([make()]).sources[0]);
  assert.equal(source.physicalAttempts, 2);
  assert.equal(source.executedChecks, 1);
  assert.equal(source.reusedChecks, 1);
  assert.deepEqual(source.reuseRatio, {
    numerator: 1,
    denominator: 2,
    value: 0.5,
    coverage: { exact: 1, incomplete: 0 }
  });
  const incomplete = make();
  requiredFixture(incomplete.runs[0]).verificationEvidence.coverage =
    "incomplete";
  requiredFixture(incomplete.runs[0]).verificationEvidence.dispositions[1] = {
    round: 2,
    check: 1,
    kind: "pending",
    origin: null
  };
  assert.deepEqual(
    requiredFixture(deriveEvaluationKpiV2([incomplete]).sources[0]).reuseRatio,
    {
      numerator: 0,
      denominator: 0,
      value: null,
      coverage: { exact: 0, incomplete: 1 }
    }
  );
  assert.throws(() =>
    decodeEvaluationExportV2Input(
      JSON.stringify(exportFixture([run()])),
      "legacy"
    )
  );
  assert.throws(() =>
    decodeEvaluationExportInput(JSON.stringify(make()), "new")
  );
  for (const mutate of [
    (value: EvaluationExportV2) => {
      requiredFixture(value.runs[0]).verificationEvidence.dispositions.push({
        round: 2,
        check: 1,
        kind: "reused",
        origin: 2
      });
    },
    (value: EvaluationExportV2) => {
      requiredFixture(
        requiredFixture(value.runs[0]).verificationEvidence.dispositions[1]
      ).origin = 1;
    },
    (value: EvaluationExportV2) => {
      Object.assign(requiredFixture(value.runs[0]).verificationEvidence, {
        command: "PRIVATE_COMMAND_CANARY"
      });
    }
  ]) {
    const value = make();
    mutate(value);
    assert.throws(() => deriveEvaluationKpiV2([value]));
  }
  assert.doesNotMatch(
    JSON.stringify(deriveEvaluationKpiV2([make()])),
    /command|path|digest|environment|attemptId|roundId|checkId/
  );
});
