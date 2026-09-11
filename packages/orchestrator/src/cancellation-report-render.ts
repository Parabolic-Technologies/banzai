import { CANCELLATION_RESOURCE_FIELDS } from "./cancellation.js";
import type {
  CancellationRatio,
  CancellationReport,
  CancellationWork,
  CancellationWorkSummary
} from "./cancellation.js";

export function renderCancellationJson(document: CancellationReport): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}
const cell = (value: string | number | null) =>
  value === null
    ? "unavailable"
    : String(value).replaceAll("|", "&#124;").replaceAll("\n", " ");
const fraction = (ratio: CancellationRatio) =>
  `${ratio.numerator}/${ratio.denominator} (${ratio.value === null ? "unavailable" : `${(ratio.value * 100).toFixed(1)}%`})`;
function resources(work: CancellationWork | CancellationWorkSummary): string[] {
  const aggregate = "runCoverage" in work.modelAttempts;
  const lines = [
    "| Resource | Exact value | Observed subtotal | Observed / unknown / invalid contributors | Availability | Run coverage: exact / partial / unavailable |",
    "| --- | ---: | ---: | --- | --- | --- |"
  ];
  for (const field of CANCELLATION_RESOURCE_FIELDS) {
    const m = work[field];
    const covered = aggregate
      ? (work as CancellationWorkSummary)[field].runCoverage
      : null;
    lines.push(
      `| ${field} | ${cell(m.value)} | ${m.observedSubtotal} | ${m.observedCount} / ${m.unknownCount} / ${m.invalidCount} | ${m.availability} | ${covered === null ? "single run" : `${covered.exact} / ${covered.partial} / ${covered.unavailable}`} |`
    );
  }
  return lines;
}
export function renderCancellationMarkdown(
  document: CancellationReport
): string {
  const { cohort, summary } = document;
  const lines = [
    "# Cancellation observations",
    "",
    `Contract: ${document.schema}, schemaVersion ${document.schemaVersion}.`,
    "",
    "Operator reports describe stated motivation, not a verified cause. Lower cancellation frequency is not itself better performance.",
    "",
    "The candidate inventory is frozen for this read. SOURCE_CHANGED means the snapshot is incomplete; reading never repairs or retries it.",
    "",
    `Cohort: run creation time, from ${cohort.from ?? "unbounded"} inclusive to ${cohort.to ?? "unbounded"} exclusive. Explicit run selectors: ${cohort.explicitRuns ? "yes" : "no"} (${cohort.selectedRunCount}).`,
    `Candidates: ${cohort.candidateRunCount}; included: ${cohort.includedRunCount}; excluded: ${cohort.excludedRunCount}; unresolved: ${cohort.unresolvedRunCount}.`,
    `Confirmed cancelled: ${summary.cancelledRunCount}; known non-cancelled: ${summary.nonCancelledRunCount}; unknown lifecycle: ${summary.unknownLifecycleRunCount}.`,
    "",
    `Meaningful reported-reason coverage: ${fraction(summary.reasonCoverage)}.`,
    `Response coverage (including unspecified, Skip and CLI omission): ${fraction(summary.responseCoverage)}.`,
    "",
    "## Reasons among all confirmed cancelled runs",
    "",
    "| Reason | Count | Fraction |",
    "| --- | ---: | --- |",
    ...summary.reasons.map(
      (r) => `| ${r.reason} | ${r.count} | ${fraction(r.ratio)} |`
    ),
    "",
    "## Observation availability",
    "",
    "| Availability | Count | Fraction |",
    "| --- | ---: | --- |",
    ...summary.observationAvailability.map(
      (r) => `| ${r.availability} | ${r.count} | ${fraction(r.ratio)} |`
    ),
    "",
    "Legacy absence, missing evidence, an unanswered prompt and an explicit unspecified response have different meanings.",
    "",
    "## Workflow and cancellation phase",
    "",
    "| Selected workflow | Count | Fraction |",
    "| --- | ---: | --- |",
    ...summary.workflow.map(
      (r) => `| ${r.workflow} | ${r.count} | ${fraction(r.ratio)} |`
    ),
    "",
    "| Pre-status | Blocked from | Gate | Count | Fraction |",
    "| --- | --- | --- | ---: | --- |",
    ...summary.phaseGate.map(
      (r) =>
        `| ${cell(r.status)} | ${cell(r.blockedFrom)} | ${cell(r.gate)} | ${r.count} | ${fraction(r.ratio)} |`
    ),
    "",
    "## Available work before cancellation",
    "",
    "Durations use milliseconds. Tokens and vendor-reported USD are covered subtotals, not full cost. Open or straddling attempts have unknown pre-cancellation usage. Inventory gaps prevent exact totals.",
    "",
    ...resources(summary.work),
    "",
    `Elapsed coverage (exact / partial / unavailable): ${summary.work.runElapsedMs.exact} / ${summary.work.runElapsedMs.partial} / ${summary.work.runElapsedMs.unavailable}.`,
    `Estimate coverage (exact / partial / unavailable): ${summary.work.activeTimeEstimate.exact} / ${summary.work.activeTimeEstimate.partial} / ${summary.work.activeTimeEstimate.unavailable}.`,
    "",
    "Elapsed is UTC wall time with unverified continuity. Active time is an existing single-engineer estimate with unknown contributor/later-work coverage. Run spans and estimates are not summed into person-time or task totals.",
    "",
    "## Runs",
    ""
  ];
  for (const run of document.runs) {
    lines.push(
      `### ${run.runKey}`,
      "",
      `Membership: ${run.membership}; lifecycle: ${cell(run.lifecycle.value)} (${run.lifecycle.availability}).`,
      `Created: ${cell(run.createdAt.value)} (${run.createdAt.availability}); cancelled: ${cell(run.cancelledAt.value)} (${run.cancelledAt.availability}).`,
      `Observation: ${run.observation.availability}; reason: ${cell(run.observation.reason)}; provenance: ${cell(run.observation.provenance)}; channel: ${cell(run.observation.channel)}; response: ${cell(run.observation.responseState)}; recorded: ${cell(run.observation.recordedAt)}.`,
      "",
      "| Context | Value | Availability | Source |",
      "| --- | --- | --- | --- |",
      ...(
        [
          "status",
          "blockedFrom",
          "gate",
          "workflow",
          "attempt",
          "decision"
        ] as const
      ).map((field) => {
        const entry = run.context[field];
        const value = Array.isArray(entry.value)
          ? entry.value
              .map((key) => `[${key}](#${run.runKey}-${key})`)
              .join(", ")
          : cell(entry.value);
        return `| ${field} | ${value} | ${entry.availability} | ${entry.source} |`;
      }),
      "",
      ...resources(run.work),
      "",
      `Inventory: model ${run.work.inventory.model}; verification ${run.work.inventory.verification}.`,
      `Run elapsed: ${cell(run.work.runElapsedMs.value)} ms (${run.work.runElapsedMs.availability}; ${run.work.runElapsedMs.basis}; ${run.work.runElapsedMs.continuity}).`,
      `Active-time estimate: ${cell(run.work.activeTimeEstimate.minutes)} minutes (${run.work.activeTimeEstimate.availability}; ${run.work.activeTimeEstimate.basis}; ${run.work.activeTimeEstimate.scope}); as of ${cell(run.work.activeTimeEstimate.asOf)}.`,
      `Continuation intent: ${run.continuation.intent}; confirmation: ${run.continuation.confirmation}; source: ${run.continuation.source}.`,
      "",
      "Technical context is preceding or referenced evidence, never proof of motivation.",
      ""
    );
    for (const technical of run.technical) {
      lines.push(
        `#### ${run.runKey}-${technical.evidenceKey}`,
        "",
        `Kind: ${technical.kind}; relationship: ${technical.relationship}; availability: ${technical.availability}.`,
        `Attempt: ${cell(technical.attemptKind)}; status: ${cell(technical.attemptStatus)}; failure cause: ${cell(technical.failureCause)}; failure code: ${cell(technical.failureCode)}; verification exit: ${cell(technical.verificationExitCode)}; signal present: ${technical.signalPresent === null ? "unavailable" : technical.signalPresent ? "yes" : "no"}.`,
        ""
      );
    }
    lines.push(
      `Issues: ${run.issueCodes.length === 0 ? "none" : run.issueCodes.join(", ")}.`,
      ""
    );
  }
  lines.push(
    "## Evidence issues",
    "",
    "| Run | Source | Field | Code |",
    "| --- | --- | --- | --- |",
    ...document.issues.map(
      (i) =>
        `| ${i.runKey ?? "cohort"} | ${i.source} | ${i.field} | ${i.code} |`
    ),
    "",
    "Report-local keys are references within this document, not durable task links. Superseded means reported intent; confirmed continuation is unavailable without a supported exact task/run source.",
    ""
  );
  return lines.join("\n");
}
