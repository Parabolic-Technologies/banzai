import { BanzaiError } from "./errors.js";
import type {
  EvaluationExport,
  EvaluationExportV2,
  EvaluationKpiV2,
  EvaluationKpiEntry,
  EvaluationKpiReport,
  EvaluationKpiSignature,
  EvaluationKpiSource,
  EvaluationRun,
  KpiGroupValue,
  KpiUnit,
  KpiValue
} from "./types.js";
import {
  EVALUATION_EXPORT_SCHEMA,
  EVALUATION_KPI_SCHEMA,
  EVALUATION_KPI_SCHEMA_VERSION
} from "./types.js";

/**
 * Derived KPIs are a pure projection of complete evaluation-export objects
 * (ADR-0026). This module may import only `types` and `errors`, so every KPI
 * is computable from a hand-built export in a test: no store, config, locks,
 * adapters, or workflow state.
 */

const KPI_WORKFLOW_ORDER = [
  "quick-fix",
  "feature",
  "strict",
  "unknown"
] as const;

const RETRY_KINDS = ["plan", "implementation", "fix", "review"] as const;
const MODEL_ATTEMPT_KINDS = ["selection", ...RETRY_KINDS] as const;

/**
 * How one run contributes to one KPI. Out-of-scope runs are invisible to the
 * KPI; in-scope runs are either exact (and add their numerator/denominator)
 * or incomplete (and add only coverage evidence). Partial evidence never
 * fabricates a contribution.
 */
type RunContribution =
  | { inScope: false }
  | { inScope: true; exact: false }
  | { inScope: true; exact: true; numerator: number; denominator: number };

function outOfScope(): RunContribution {
  return { inScope: false };
}

function incomplete(): RunContribution {
  return { inScope: true, exact: false };
}

function exact(numerator: number, denominator: number): RunContribution {
  return { inScope: true, exact: true, numerator, denominator };
}

function foldKpiValue(
  runs: readonly EvaluationRun[],
  unit: KpiUnit,
  contribute: (run: EvaluationRun) => RunContribution
): KpiValue {
  let numerator = 0;
  let denominator = 0;
  let maximum = 0;
  let exactRuns = 0;
  let incompleteRuns = 0;
  for (const run of runs) {
    const contribution = contribute(run);
    if (!contribution.inScope) {
      continue;
    }
    if (!contribution.exact) {
      incompleteRuns += 1;
      continue;
    }
    exactRuns += 1;
    numerator += contribution.numerator;
    denominator += contribution.denominator;
    if (contribution.numerator > maximum) {
      maximum = contribution.numerator;
    }
  }
  if (unit === "max") {
    numerator = denominator === 0 ? 0 : maximum;
  }
  const value =
    denominator === 0
      ? null
      : unit === "ratio" || unit === "mean"
        ? numerator / denominator
        : numerator;
  return {
    numerator,
    denominator,
    value,
    coverage: { exact: exactRuns, incomplete: incompleteRuns }
  };
}

function completionContribution(run: EvaluationRun): RunContribution {
  const terminal = run.terminal.value;
  if (terminal === null) {
    return incomplete();
  }
  if (!terminal) {
    return exact(0, 0);
  }
  const status = run.status.value;
  if (status === null) {
    return incomplete();
  }
  return exact(status === "done" ? 1 : 0, 1);
}

function firstReview(
  run: EvaluationRun
): EvaluationRun["reviews"][number] | null {
  let first: EvaluationRun["reviews"][number] | null = null;
  for (const review of run.reviews) {
    if (first === null || review.ordinal < first.ordinal) {
      first = review;
    }
  }
  return first;
}

function firstReviewPassContribution(run: EvaluationRun): RunContribution {
  const review = firstReview(run);
  if (review === null) {
    return outOfScope();
  }
  const verdict = review.verdict.value;
  if (verdict === null) {
    return incomplete();
  }
  return exact(verdict === "pass" ? 1 : 0, 1);
}

function firstReviewFindingsContribution(run: EvaluationRun): RunContribution {
  const review = firstReview(run);
  if (review === null) {
    return outOfScope();
  }
  if (review.verdict.value === null) {
    return incomplete();
  }
  const findings =
    review.findings.blocker + review.findings.should_fix + review.findings.nit;
  return exact(findings, 1);
}

function triageIsExact(run: EvaluationRun): boolean {
  const triage = run.metrics.triage;
  return (
    triage.accepted.availability === "complete" &&
    triage.rejected.availability === "complete" &&
    triage.deferred.availability === "complete" &&
    triage.accepted.value !== null &&
    triage.rejected.value !== null &&
    triage.deferred.value !== null
  );
}

function triagedTotal(run: EvaluationRun): number {
  return (
    (run.metrics.triage.accepted.value ?? 0) +
    (run.metrics.triage.rejected.value ?? 0) +
    (run.metrics.triage.deferred.value ?? 0)
  );
}

function raisedFindings(review: EvaluationRun["reviews"][number]): number {
  return (
    review.findings.blocker + review.findings.should_fix + review.findings.nit
  );
}

function precisionContribution(run: EvaluationRun): RunContribution {
  if (!triageIsExact(run)) {
    return incomplete();
  }
  const accepted = run.metrics.triage.accepted.value ?? 0;
  const rejected = run.metrics.triage.rejected.value ?? 0;
  return exact(accepted, accepted + rejected);
}

/**
 * Share of everything the first review raised that a human accepted. Unlike
 * reviewer precision it keeps deferred findings in the denominator, so a
 * reviewer whose findings are mostly parked still reads as low signal.
 *
 * Exported triage is cumulative per run, so a run with more than one applied
 * review cannot be decomposed back to its first iteration and is reported as
 * incomplete rather than approximated. A triaged total that disagrees with the
 * findings that review raised means the two are not in one-to-one
 * correspondence, which makes the same decomposition unsafe.
 */
function firstReviewAcceptanceContribution(
  run: EvaluationRun
): RunContribution {
  const review = firstReview(run);
  if (review === null) {
    return outOfScope();
  }
  if (!triageIsExact(run) || run.reviews.length !== 1) {
    return incomplete();
  }
  const total = triagedTotal(run);
  if (total !== raisedFindings(review)) {
    return incomplete();
  }
  if (total === 0) {
    return exact(0, 0);
  }
  return exact(run.metrics.triage.accepted.value ?? 0, total);
}

/**
 * Share of reviewed runs where human triage accepted nothing at all. A run
 * whose reviews raised no finding is not evidence either way and contributes
 * no denominator.
 */
function zeroAcceptedReviewContribution(run: EvaluationRun): RunContribution {
  if (run.reviews.length === 0) {
    return outOfScope();
  }
  if (!triageIsExact(run)) {
    return incomplete();
  }
  if (triagedTotal(run) === 0) {
    return exact(0, 0);
  }
  return exact((run.metrics.triage.accepted.value ?? 0) === 0 ? 1 : 0, 1);
}

function deferredContribution(run: EvaluationRun): RunContribution {
  if (!triageIsExact(run)) {
    return incomplete();
  }
  return exact(run.metrics.triage.deferred.value ?? 0, 1);
}

function completedRun(run: EvaluationRun): boolean {
  return run.status.value === "done";
}

function fixCyclesContribution(run: EvaluationRun): RunContribution {
  if (!completedRun(run)) {
    return outOfScope();
  }
  const fixCycles = run.metrics.fixCycles;
  if (fixCycles.availability !== "complete" || fixCycles.value === null) {
    return incomplete();
  }
  return exact(fixCycles.value, 1);
}

function modelAttemptSetIsExact(run: EvaluationRun): boolean {
  // Total and outcome metrics include verification; by-kind model counts
  // retain collection/schema/identity/active-attempt gaps independently of it.
  // Check parity too: the array alone can be empty after evidence was excluded.
  return MODEL_ATTEMPT_KINDS.every((kind) => {
    const count = run.metrics.attempts.byKind[kind];
    return (
      count.availability === "complete" &&
      count.unknownCount === 0 &&
      count.invalidCount === 0 &&
      count.value ===
        run.attempts.filter((attempt) => attempt.kind.value === kind).length
    );
  });
}

function retryContribution(
  run: EvaluationRun,
  kind: (typeof RETRY_KINDS)[number]
): RunContribution {
  if (!modelAttemptSetIsExact(run)) {
    return incomplete();
  }
  let numerator = 0;
  let denominator = 0;
  for (const attempt of run.attempts) {
    const attemptKind = attempt.kind.value;
    const status = attempt.status.value;
    if (attemptKind === null || status === null) {
      return incomplete();
    }
    if (attemptKind !== kind) {
      continue;
    }
    denominator += 1;
    if (status === "failed" || status === "interrupted") {
      numerator += 1;
    }
  }
  return exact(numerator, denominator);
}

function tokenUsageIsExact(run: EvaluationRun): boolean {
  const usage = run.metrics.usage;
  return (
    usage.inputTokens.availability === "complete" &&
    usage.cachedInputTokens.availability === "complete" &&
    usage.outputTokens.availability === "complete" &&
    usage.inputTokens.value !== null &&
    usage.cachedInputTokens.value !== null &&
    usage.outputTokens.value !== null
  );
}

function tokenContribution(
  run: EvaluationRun,
  measure: "inputTokens" | "cachedInputTokens" | "outputTokens"
): RunContribution {
  if (!completedRun(run)) {
    return outOfScope();
  }
  if (!tokenUsageIsExact(run)) {
    return incomplete();
  }
  return exact(run.metrics.usage[measure].value ?? 0, 1);
}

function cacheRatioContribution(run: EvaluationRun): RunContribution {
  if (!completedRun(run)) {
    return outOfScope();
  }
  if (!tokenUsageIsExact(run)) {
    return incomplete();
  }
  return exact(
    run.metrics.usage.cachedInputTokens.value ?? 0,
    run.metrics.usage.inputTokens.value ?? 0
  );
}

function costContribution(run: EvaluationRun): RunContribution {
  if (!completedRun(run)) {
    return outOfScope();
  }
  const cost = run.metrics.usage.costUsd;
  if (cost.availability !== "complete" || cost.value === null) {
    return incomplete();
  }
  return exact(cost.value, 1);
}

const UNKNOWN_ROLE = "unknown";
const MIXED_ROLE = "mixed";

function roleComponent(
  attempts: readonly EvaluationRun["attempts"][number][]
): string {
  if (attempts.length === 0) {
    return UNKNOWN_ROLE;
  }
  const triples = new Set<string>();
  for (const attempt of attempts) {
    const vendor = attempt.model.vendor.value;
    const model = attempt.model.model.value;
    const effort = attempt.model.effort.value;
    if (vendor === null || model === null || effort === null) {
      return UNKNOWN_ROLE;
    }
    triples.add(`${vendor}/${model}/${effort}`);
  }
  if (triples.size > 1) {
    return MIXED_ROLE;
  }
  return [...triples][0] ?? UNKNOWN_ROLE;
}

export function deriveRunSignature(run: EvaluationRun): {
  planner: string;
  implementer: string;
  reviewer: string;
  key: string;
} {
  const planner: EvaluationRun["attempts"][number][] = [];
  const implementer: EvaluationRun["attempts"][number][] = [];
  const reviewer: EvaluationRun["attempts"][number][] = [];
  let attributable = modelAttemptSetIsExact(run);
  for (const attempt of run.attempts) {
    const kind = attempt.kind.value;
    if (kind === null) {
      // An unattributable attempt could belong to any role, so no role's
      // signature can be trusted for this run.
      attributable = false;
      break;
    }
    if (kind === "selection" || kind === "plan") {
      planner.push(attempt);
    } else if (kind === "implementation" || kind === "fix") {
      implementer.push(attempt);
    } else {
      reviewer.push(attempt);
    }
  }
  const components = attributable
    ? {
        planner: roleComponent(planner),
        implementer: roleComponent(implementer),
        reviewer: roleComponent(reviewer)
      }
    : {
        planner: UNKNOWN_ROLE,
        implementer: UNKNOWN_ROLE,
        reviewer: UNKNOWN_ROLE
      };
  return {
    ...components,
    key: `planner=${components.planner} implementer=${components.implementer} reviewer=${components.reviewer}`
  };
}

function compareKeys(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

interface KpiDefinition {
  kpi: string;
  measure: string;
  unit: KpiUnit;
  withWorkflow: boolean;
  contribute: (run: EvaluationRun) => RunContribution;
}

const KPI_DEFINITIONS: readonly KpiDefinition[] = [
  {
    kpi: "completion_rate",
    measure: "rate",
    unit: "ratio",
    withWorkflow: true,
    contribute: completionContribution
  },
  {
    kpi: "first_review_pass_rate",
    measure: "rate",
    unit: "ratio",
    withWorkflow: false,
    contribute: firstReviewPassContribution
  },
  {
    kpi: "first_review_mean_findings",
    measure: "mean",
    unit: "mean",
    withWorkflow: false,
    contribute: firstReviewFindingsContribution
  },
  {
    kpi: "first_review_acceptance_rate",
    measure: "rate",
    unit: "ratio",
    withWorkflow: false,
    contribute: firstReviewAcceptanceContribution
  },
  {
    kpi: "reviewer_precision",
    measure: "rate",
    unit: "ratio",
    withWorkflow: false,
    contribute: precisionContribution
  },
  {
    kpi: "zero_accepted_review_rate",
    measure: "rate",
    unit: "ratio",
    withWorkflow: false,
    contribute: zeroAcceptedReviewContribution
  },
  {
    kpi: "triage_deferred",
    measure: "count",
    unit: "count",
    withWorkflow: false,
    contribute: deferredContribution
  },
  {
    kpi: "fix_cycles_per_completed_run",
    measure: "mean",
    unit: "mean",
    withWorkflow: false,
    contribute: fixCyclesContribution
  },
  {
    kpi: "fix_cycles_per_completed_run",
    measure: "max",
    unit: "max",
    withWorkflow: false,
    contribute: fixCyclesContribution
  },
  ...RETRY_KINDS.map((kind): KpiDefinition => ({
    kpi: "attempt_retry_ratio",
    measure: kind,
    unit: "ratio",
    withWorkflow: false,
    contribute: (run) => retryContribution(run, kind)
  })),
  {
    kpi: "usage_per_completed_run",
    measure: "mean_input_tokens",
    unit: "mean",
    withWorkflow: false,
    contribute: (run) => tokenContribution(run, "inputTokens")
  },
  {
    kpi: "usage_per_completed_run",
    measure: "mean_cached_input_tokens",
    unit: "mean",
    withWorkflow: false,
    contribute: (run) => tokenContribution(run, "cachedInputTokens")
  },
  {
    kpi: "usage_per_completed_run",
    measure: "mean_output_tokens",
    unit: "mean",
    withWorkflow: false,
    contribute: (run) => tokenContribution(run, "outputTokens")
  },
  {
    kpi: "usage_per_completed_run",
    measure: "cache_ratio",
    unit: "ratio",
    withWorkflow: false,
    contribute: cacheRatioContribution
  },
  {
    kpi: "usage_per_completed_run",
    measure: "mean_cost_usd",
    unit: "mean",
    withWorkflow: false,
    contribute: costContribution
  }
];

export function deriveEvaluationKpiSource(
  ordinal: number,
  label: string,
  report: EvaluationExport
): EvaluationKpiSource {
  const runs = report.runs.filter((run) => run.cohortMembership === "included");

  const signatureRuns = new Map<
    string,
    { signature: ReturnType<typeof deriveRunSignature>; runs: EvaluationRun[] }
  >();
  for (const run of runs) {
    const signature = deriveRunSignature(run);
    const existing = signatureRuns.get(signature.key);
    if (existing === undefined) {
      signatureRuns.set(signature.key, { signature, runs: [run] });
    } else {
      existing.runs.push(run);
    }
  }
  const signatureKeys = [...signatureRuns.keys()].sort(compareKeys);
  const signatures: EvaluationKpiSignature[] = signatureKeys.map((key) => {
    const entry = signatureRuns.get(key);
    return {
      planner: entry?.signature.planner ?? UNKNOWN_ROLE,
      implementer: entry?.signature.implementer ?? UNKNOWN_ROLE,
      reviewer: entry?.signature.reviewer ?? UNKNOWN_ROLE,
      key,
      runCount: entry?.runs.length ?? 0
    };
  });

  const kpis: EvaluationKpiEntry[] = KPI_DEFINITIONS.map((definition) => {
    const byWorkflow: KpiGroupValue[] | null = definition.withWorkflow
      ? KPI_WORKFLOW_ORDER.map((workflow) => ({
          group: workflow,
          value: foldKpiValue(
            runs.filter(
              (run) => (run.workflow.value ?? "unknown") === workflow
            ),
            definition.unit,
            definition.contribute
          )
        }))
      : null;
    const bySignature: KpiGroupValue[] = signatureKeys.map((key) => ({
      group: key,
      value: foldKpiValue(
        signatureRuns.get(key)?.runs ?? [],
        definition.unit,
        definition.contribute
      )
    }));
    return {
      kpi: definition.kpi,
      measure: definition.measure,
      unit: definition.unit,
      overall: foldKpiValue(runs, definition.unit, definition.contribute),
      byWorkflow,
      bySignature
    };
  });

  return {
    ordinal,
    label,
    includedRunCount: report.cohort.includedRunCount,
    issueCount: report.issues.length,
    signatures,
    kpis
  };
}

export function deriveEvaluationKpiReport(
  sources: readonly { label: string; report: EvaluationExport }[]
): EvaluationKpiReport {
  return {
    schema: EVALUATION_KPI_SCHEMA,
    schemaVersion: EVALUATION_KPI_SCHEMA_VERSION,
    sources: sources.map((source, index) =>
      deriveEvaluationKpiSource(index + 1, source.label, source.report)
    )
  };
}

function inputError(sourceName: string, detail: string): BanzaiError {
  return new BanzaiError(
    "INVALID_EVAL_INPUT",
    `Evaluation KPI input ${sourceName} is not a usable banzai-evaluation-export/v1 document: ${detail}`
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isEvidenceValue(value: unknown): boolean {
  return (
    isRecord(value) && "value" in value && typeof value.evidence === "string"
  );
}

function isNumericMetric(value: unknown): boolean {
  return (
    isRecord(value) &&
    (value.value === null || typeof value.value === "number") &&
    typeof value.availability === "string"
  );
}

function validateAttempt(
  sourceName: string,
  attempt: unknown,
  runIndex: number
): void {
  if (!isRecord(attempt)) {
    throw inputError(sourceName, `runs[${runIndex}] has a malformed attempt`);
  }
  if (!isEvidenceValue(attempt.kind) || !isEvidenceValue(attempt.status)) {
    throw inputError(
      sourceName,
      `runs[${runIndex}] attempt is missing kind or status evidence`
    );
  }
  const model = attempt.model;
  if (
    !isRecord(model) ||
    !isEvidenceValue(model.vendor) ||
    !isEvidenceValue(model.model) ||
    !isEvidenceValue(model.effort)
  ) {
    throw inputError(
      sourceName,
      `runs[${runIndex}] attempt is missing model identity evidence`
    );
  }
}

function validateReview(
  sourceName: string,
  review: unknown,
  runIndex: number
): void {
  if (!isRecord(review) || typeof review.ordinal !== "number") {
    throw inputError(sourceName, `runs[${runIndex}] has a malformed review`);
  }
  if (!isEvidenceValue(review.verdict)) {
    throw inputError(
      sourceName,
      `runs[${runIndex}] review is missing verdict evidence`
    );
  }
  const findings = review.findings;
  if (
    !isRecord(findings) ||
    typeof findings.blocker !== "number" ||
    typeof findings.should_fix !== "number" ||
    typeof findings.nit !== "number"
  ) {
    throw inputError(
      sourceName,
      `runs[${runIndex}] review is missing finding counts`
    );
  }
}

function validateRun(sourceName: string, run: unknown, index: number): void {
  if (!isRecord(run)) {
    throw inputError(sourceName, `runs[${index}] is not an object`);
  }
  if (typeof run.cohortMembership !== "string") {
    throw inputError(sourceName, `runs[${index}] is missing cohortMembership`);
  }
  if (
    !isEvidenceValue(run.status) ||
    !isEvidenceValue(run.terminal) ||
    !isEvidenceValue(run.workflow)
  ) {
    throw inputError(
      sourceName,
      `runs[${index}] is missing status, terminal, or workflow evidence`
    );
  }
  if (!Array.isArray(run.attempts) || !Array.isArray(run.reviews)) {
    throw inputError(
      sourceName,
      `runs[${index}] is missing attempts or reviews`
    );
  }
  for (const attempt of run.attempts) {
    validateAttempt(sourceName, attempt, index);
  }
  for (const review of run.reviews) {
    validateReview(sourceName, review, index);
  }
  const metrics = run.metrics;
  if (!isRecord(metrics)) {
    throw inputError(sourceName, `runs[${index}] is missing metrics`);
  }
  const triage = metrics.triage;
  if (
    !isRecord(triage) ||
    !isNumericMetric(triage.accepted) ||
    !isNumericMetric(triage.rejected) ||
    !isNumericMetric(triage.deferred)
  ) {
    throw inputError(sourceName, `runs[${index}] is missing triage metrics`);
  }
  if (!isNumericMetric(metrics.fixCycles)) {
    throw inputError(sourceName, `runs[${index}] is missing fixCycles`);
  }
  const usage = metrics.usage;
  if (
    !isRecord(usage) ||
    !isNumericMetric(usage.inputTokens) ||
    !isNumericMetric(usage.cachedInputTokens) ||
    !isNumericMetric(usage.outputTokens) ||
    !isNumericMetric(usage.costUsd)
  ) {
    throw inputError(sourceName, `runs[${index}] is missing usage metrics`);
  }
}

export function decodeEvaluationExportInput(
  text: string,
  sourceName: string
): EvaluationExport {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw inputError(sourceName, "the file is not valid JSON");
  }
  if (!isRecord(parsed)) {
    throw inputError(sourceName, "the document is not a JSON object");
  }
  if (parsed.schema !== EVALUATION_EXPORT_SCHEMA) {
    throw inputError(
      sourceName,
      "the document does not carry the evaluation export schema identity"
    );
  }
  if (parsed.schemaVersion !== 1) {
    throw inputError(
      sourceName,
      "the document carries an unsupported evaluation export schema version"
    );
  }
  const cohort = parsed.cohort;
  if (!isRecord(cohort) || typeof cohort.includedRunCount !== "number") {
    throw inputError(sourceName, "the document is missing cohort evidence");
  }
  if (!Array.isArray(parsed.issues)) {
    throw inputError(sourceName, "the document is missing structured issues");
  }
  if (!Array.isArray(parsed.runs)) {
    throw inputError(sourceName, "the document is missing runs");
  }
  parsed.runs.forEach((run, index) => {
    validateRun(sourceName, run, index);
  });
  return parsed as unknown as EvaluationExport;
}

/** v2 is opt-in; never accepts or converts an export-v1 input. */
export function decodeEvaluationExportV2Input(
  text: string,
  sourceName: string
): EvaluationExportV2 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw inputError(sourceName, "invalid JSON");
  }
  if (
    !isRecord(parsed) ||
    parsed.schema !== "banzai-evaluation-export/v2" ||
    parsed.schemaVersion !== 2 ||
    !Array.isArray(parsed.runs) ||
    Object.keys(parsed).sort().join(",") !==
      "aggregates,cohort,issues,runs,schema,schemaVersion"
  )
    throw inputError(sourceName, "export v2 is required");
  // Existing field validation is reused, while all new evidence is validated
  // below. This is validation only, not a conversion of legacy evidence.
  decodeEvaluationExportInput(
    JSON.stringify({
      ...parsed,
      schema: EVALUATION_EXPORT_SCHEMA,
      schemaVersion: 1
    }),
    sourceName
  );
  for (const run of parsed.runs as Record<string, unknown>[]) {
    const evidence = run.verificationEvidence;
    if (
      !isRecord(evidence) ||
      Object.keys(evidence).sort().join(",") !==
        "coverage,dispositions,physicalAttempts" ||
      !["exact", "incomplete"].includes(evidence.coverage as string) ||
      !Array.isArray(evidence.physicalAttempts) ||
      !Array.isArray(evidence.dispositions)
    )
      throw inputError(sourceName, "invalid verification v2 evidence");
    const successes = new Set<number>();
    for (const [index, attempt] of evidence.physicalAttempts.entries()) {
      if (
        !isRecord(attempt) ||
        Object.keys(attempt).sort().join(",") !== "durationMs,ordinal,status" ||
        attempt.ordinal !== index + 1 ||
        !["started", "completed", "failed", "interrupted"].includes(
          attempt.status as string
        ) ||
        !(
          attempt.durationMs === null ||
          (typeof attempt.durationMs === "number" &&
            Number.isFinite(attempt.durationMs) &&
            attempt.durationMs >= 0)
        )
      )
        throw inputError(sourceName, "invalid physical ordinal evidence");
      if (attempt.status === "completed") successes.add(attempt.ordinal);
    }
    const keys = new Set<string>();
    for (const item of evidence.dispositions) {
      if (
        !isRecord(item) ||
        Object.keys(item).sort().join(",") !== "check,kind,origin,round" ||
        ![item.round, item.check].every(
          (n) => typeof n === "number" && Number.isSafeInteger(n) && n > 0
        ) ||
        !["executed", "reused", "pending"].includes(item.kind as string)
      )
        throw inputError(sourceName, "invalid disposition");
      const key = JSON.stringify([item.round, item.check]);
      if (
        keys.has(key) ||
        (item.kind === "pending"
          ? item.origin !== null || evidence.coverage === "exact"
          : !successes.has(item.origin as number))
      )
        throw inputError(sourceName, "inconsistent terminal disposition");
      keys.add(key);
    }
    if (evidence.coverage === "exact" && evidence.dispositions.length === 0)
      throw inputError(
        sourceName,
        "exact coverage requires terminal check evidence"
      );
  }
  return parsed as unknown as EvaluationExportV2;
}

export function deriveEvaluationKpiV2(
  sources: readonly EvaluationExportV2[]
): EvaluationKpiV2 {
  return {
    schema: "banzai-evaluation-kpi/v2",
    schemaVersion: 2,
    sources: sources.map((source, index) => {
      const report = decodeEvaluationExportV2Input(
        JSON.stringify({
          schema: source.schema,
          schemaVersion: source.schemaVersion,
          cohort: source.cohort,
          runs: source.runs,
          issues: source.issues,
          aggregates: {}
        }),
        `source ${index + 1}`
      );
      const included = report.runs.filter(
        (run) => run.cohortMembership === "included"
      );
      const exact = included.filter(
        (run) => run.verificationEvidence.coverage === "exact"
      );
      const dispositions = exact.flatMap(
        (run) => run.verificationEvidence.dispositions
      );
      const reusedChecks = dispositions.filter(
        (item) => item.kind === "reused"
      ).length;
      const executedChecks = dispositions.filter(
        (item) => item.kind === "executed"
      ).length;
      const denominator = reusedChecks + executedChecks;
      const coverage = {
        exact: exact.length,
        incomplete: included.length - exact.length
      };
      return {
        ordinal: index + 1,
        runs: included.length,
        coverage,
        physicalAttempts: exact.reduce(
          (sum, run) => sum + run.verificationEvidence.physicalAttempts.length,
          0
        ),
        executedChecks,
        reusedChecks,
        reuseRatio: {
          numerator: reusedChecks,
          denominator,
          value: denominator === 0 ? null : reusedChecks / denominator,
          coverage
        }
      };
    })
  };
}
