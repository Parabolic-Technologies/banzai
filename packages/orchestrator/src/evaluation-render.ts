import {
  EVALUATION_FAILURE_ORDER,
  EVALUATION_ISSUE_CODE_ORDER,
  EVALUATION_ROTATION_REASON_ORDER,
  EVALUATION_STATUS_ORDER,
  EVALUATION_WORKFLOW_ORDER
} from "./evaluation.js";
import type {
  EvaluationBreakdown,
  EvaluationExport,
  EvaluationIssueCode,
  EvaluationMetricSet,
  EvidenceValue,
  NumericMetric
} from "./types.js";

function metric(metricValue: NumericMetric): string {
  if (metricValue.availability === "unavailable") {
    return "unavailable";
  }
  if (metricValue.availability === "not_applicable") {
    return "not applicable";
  }
  if (metricValue.value !== null) {
    return String(metricValue.value);
  }
  return `${metricValue.observedSubtotal} observed (${metricValue.observedCount} known, ${metricValue.unknownCount} unknown, ${metricValue.invalidCount} invalid)`;
}

function evidence<T>(item: EvidenceValue<T>): string {
  return item.value === null ? item.evidence : String(item.value);
}

function table(
  headers: readonly string[],
  rows: readonly (readonly string[])[]
): string[] {
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.join(" | ")} |`)
  ];
}

function metricRows(metrics: EvaluationMetricSet): [string, string][] {
  return [
    ["Attempts", metric(metrics.attempts.total)],
    ["Selection duration (ms)", metric(metrics.durationsMs.selection)],
    ["Planning duration (ms)", metric(metrics.durationsMs.planning)],
    [
      "Implementation duration (ms)",
      metric(metrics.durationsMs.implementation)
    ],
    ["Verification duration (ms)", metric(metrics.durationsMs.verification)],
    ["Review duration (ms)", metric(metrics.durationsMs.review)],
    ["Fixing duration (ms)", metric(metrics.durationsMs.fixing)],
    ["Fresh sessions", metric(metrics.sessions.fresh)],
    ["Resumed sessions", metric(metrics.sessions.resumed)],
    ["Full reviews", metric(metrics.reviews.attempts.full)],
    ["Delta reviews", metric(metrics.reviews.attempts.delta)],
    ["Reviewer rotations", metric(metrics.reviews.rotations.total)],
    ["Retries", metric(metrics.retries.total)],
    ["Verification commands retained", metric(metrics.verification.retained)],
    ["Verification commands passed", metric(metrics.verification.completed)],
    ["Verification commands failed", metric(metrics.verification.failed)],
    ["Input tokens", metric(metrics.usage.inputTokens)],
    ["Cached input tokens", metric(metrics.usage.cachedInputTokens)],
    ["Output tokens", metric(metrics.usage.outputTokens)],
    ["Reported cost (USD)", metric(metrics.usage.costUsd)],
    ["Blocker findings", metric(metrics.reviews.findings.blocker)],
    ["Should-fix findings", metric(metrics.reviews.findings.should_fix)],
    ["Nit findings", metric(metrics.reviews.findings.nit)],
    ["Accepted triage", metric(metrics.triage.accepted)],
    ["Rejected triage", metric(metrics.triage.rejected)],
    ["Deferred triage", metric(metrics.triage.deferred)],
    ["Fix cycles", metric(metrics.fixCycles)],
    ["Human minutes", metric(metrics.humanMinutes)],
    ["False-positive rate", metric(metrics.falsePositiveRate)]
  ];
}

function breakdownRow(label: string, summary: EvaluationBreakdown): string[] {
  return [
    label,
    String(summary.runCount),
    metric(summary.metrics.attempts.total),
    metric(summary.metrics.usage.inputTokens),
    metric(summary.metrics.usage.outputTokens),
    metric(summary.metrics.usage.costUsd),
    metric(summary.metrics.fixCycles)
  ];
}

function issueCounts(
  report: EvaluationExport
): [EvaluationIssueCode, number][] {
  const counts = new Map<EvaluationIssueCode, number>();
  for (const issue of report.issues) {
    counts.set(issue.code, (counts.get(issue.code) ?? 0) + 1);
  }
  return EVALUATION_ISSUE_CODE_ORDER.flatMap((code) => {
    const count = counts.get(code);
    return count === undefined
      ? []
      : [[code, count] as [EvaluationIssueCode, number]];
  });
}

export function renderEvaluationJson(report: EvaluationExport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

export function renderEvaluationMarkdown(report: EvaluationExport): string {
  const lines: string[] = [
    "# Banzai Evaluation Export",
    "",
    `Schema: \`${report.schema}\` (version ${report.schemaVersion})`,
    "",
    "## Cohort",
    "",
    `- From (inclusive): ${report.cohort.from ?? "all"}`,
    `- To (exclusive): ${report.cohort.to ?? "all"}`,
    `- Explicit run selection: ${report.cohort.explicitRuns ? "yes" : "no"}`,
    `- Candidate runs: ${report.cohort.candidateRunCount}`,
    `- Included runs: ${report.cohort.includedRunCount}`,
    `- Excluded runs: ${report.cohort.excludedRunCount}`,
    `- Unresolved runs: ${report.cohort.unresolvedRunCount}`,
    "",
    "Partial metrics show an observed subtotal and coverage. Unavailable measurements were not persisted; zero is reported only when supported by evidence.",
    "",
    "## Overall",
    "",
    ...table(
      ["Metric", "Value"],
      [
        ["Runs", String(report.aggregates.overall.runCount)],
        ...metricRows(report.aggregates.overall.metrics)
      ]
    ),
    "",
    "## Failure Categories",
    "",
    ...table(
      ["Category", "Count"],
      EVALUATION_FAILURE_ORDER.map((category) => [
        category,
        metric(report.aggregates.overall.metrics.failures[category])
      ])
    ),
    "",
    "## Reviewer Rotation Reasons",
    "",
    ...table(
      ["Reason", "Count"],
      EVALUATION_ROTATION_REASON_ORDER.map((reason) => [
        reason,
        metric(
          report.aggregates.overall.metrics.reviews.rotations.byReason[reason]
        )
      ])
    ),
    "",
    "## Workflow Breakdown",
    "",
    ...table(
      [
        "Workflow",
        "Runs",
        "Attempts",
        "Input tokens",
        "Output tokens",
        "Cost USD",
        "Fix cycles"
      ],
      EVALUATION_WORKFLOW_ORDER.map((workflow) =>
        breakdownRow(workflow, report.aggregates.byWorkflow[workflow])
      )
    ),
    "",
    "## Status Breakdown",
    "",
    ...table(
      [
        "Status",
        "Runs",
        "Attempts",
        "Input tokens",
        "Output tokens",
        "Cost USD",
        "Fix cycles"
      ],
      EVALUATION_STATUS_ORDER.map((status) =>
        breakdownRow(status, report.aggregates.byStatus[status])
      )
    ),
    "",
    "## Workflow and Status",
    "",
    ...table(
      [
        "Workflow / status",
        "Runs",
        "Attempts",
        "Input tokens",
        "Output tokens",
        "Cost USD",
        "Fix cycles"
      ],
      report.aggregates.byWorkflowAndStatus.map((item) =>
        breakdownRow(`${item.workflow} / ${item.status}`, item.summary)
      )
    ),
    "",
    "## Runs",
    ""
  ];

  if (report.runs.length === 0) {
    lines.push("No runs are included in this cohort.");
  } else {
    lines.push(
      ...table(
        [
          "Run",
          "Membership",
          "Completeness",
          "Workflow",
          "Status",
          "Created",
          "Attempts",
          "Fix cycles",
          "Issues"
        ],
        report.runs.map((run) => [
          run.runKey,
          run.cohortMembership,
          run.completeness,
          evidence(run.workflow),
          evidence(run.status),
          evidence(run.createdAt),
          metric(run.metrics.attempts.total),
          metric(run.metrics.fixCycles),
          String(run.issueCodes.length)
        ])
      )
    );
  }

  const counts = issueCounts(report);
  lines.push(
    "",
    "## Data Quality and Privacy",
    "",
    `Structured issues: ${report.issues.length}`,
    ""
  );
  if (counts.length === 0) {
    lines.push("No data-quality issues were detected.");
  } else {
    lines.push(
      ...table(
        ["Issue code", "Count"],
        counts.map(([code, count]) => [code, String(count)])
      )
    );
  }
  lines.push(
    "",
    "Run and attempt keys are export-local opaque ordinals, not anonymized stable identities. Exact model IDs and timestamps may remain linkable. Prompts, reasoning, transcripts, raw output, commands, source content, repository paths, credentials, environment values, slugs, and exact persisted identifiers are excluded.",
    ""
  );
  return lines.join("\n");
}
