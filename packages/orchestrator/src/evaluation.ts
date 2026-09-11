import type { Dirent } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { BanzaiError } from "./errors.js";
import {
  EVALUATION_EXPORT_SCHEMA,
  EVALUATION_EXPORT_SCHEMA_VERSION,
  type EvaluationAggregates,
  type EvaluationAttempt,
  type EvaluationAttemptKind,
  type EvaluationAttemptOutcome,
  type EvaluationAttemptSource,
  type EvaluationBreakdown,
  type EvaluationCompleteness,
  type EvaluationEventSource,
  type EvaluationExport,
  type EvaluationExportOptions,
  type EvaluationFailureCategory,
  type EvaluationIssue,
  type EvaluationIssueCode,
  type EvaluationIssueSeverity,
  type EvaluationIssueSource,
  type EvaluationMetricSet,
  type EvaluationRetryKind,
  type EvaluationReview,
  type EvaluationReviewSource,
  type EvaluationRun,
  type EvaluationSourceIssue,
  type EvaluationStateSource,
  type EvaluationVerification,
  type EvidenceValue,
  type FindingDisposition,
  type NumericMetric,
  type ReviewFinding,
  type ReviewMode,
  type EvaluationRotationReason,
  type ReviewVerdict,
  type RunStatus,
  type SessionMode,
  type VerificationAttemptRecord,
  type VerificationAttemptStatus,
  type WorkflowRoute
} from "./types.js";
import {
  parseEvaluationAttemptSource,
  parseEvaluationEventSource,
  parseEvaluationReviewSource,
  parseEvaluationStateSource,
  parseVerificationAttemptRecord,
  parseVerificationLedger
} from "./validation.js";

export const EVALUATION_WORKFLOW_ORDER = [
  "quick-fix",
  "feature",
  "strict",
  "unknown"
] as const satisfies readonly (WorkflowRoute | "unknown")[];

export const EVALUATION_STATUS_ORDER = [
  "created",
  "selecting",
  "planning",
  "needs_adr_approval",
  "needs_plan_approval",
  "needs_human_decision",
  "plan_approved",
  "implementing",
  "verifying",
  "reviewing",
  "needs_triage",
  "fixing",
  "done",
  "blocked",
  "cancelled",
  "unknown"
] as const satisfies readonly (RunStatus | "unknown")[];

export const EVALUATION_ATTEMPT_KIND_ORDER = [
  "selection",
  "plan",
  "implementation",
  "verification",
  "review",
  "fix"
] as const satisfies readonly EvaluationAttemptKind[];

export const EVALUATION_ATTEMPT_OUTCOME_ORDER = [
  "completed",
  "failed",
  "started"
] as const satisfies readonly EvaluationAttemptOutcome[];

export const EVALUATION_ROTATION_REASON_ORDER = [
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
] as const satisfies readonly EvaluationRotationReason[];

export const EVALUATION_FAILURE_ORDER = [
  "startup_check",
  "model_attempt",
  "verification_command",
  "review_check",
  "review_verdict_blocked",
  "interrupted_attempt",
  "malformed_persisted_evidence",
  "blocked_other"
] as const satisfies readonly EvaluationFailureCategory[];

const SESSION_ORDER = [
  "fresh",
  "resumed",
  "unknown"
] as const satisfies readonly (SessionMode | "unknown")[];
const REVIEW_MODE_ORDER = [
  "full",
  "delta",
  "unknown"
] as const satisfies readonly (ReviewMode | "unknown")[];
const REVIEW_VERDICT_ORDER = [
  "pass",
  "changes_requested",
  "replan_required",
  "blocked"
] as const satisfies readonly ReviewVerdict[];
const FINDING_SEVERITY_ORDER = [
  "blocker",
  "should_fix",
  "nit"
] as const satisfies readonly ReviewFinding["severity"][];
const TRIAGE_ORDER = [
  "accepted",
  "rejected",
  "deferred"
] as const satisfies readonly FindingDisposition[];
const RETRY_ORDER = [
  "attempt",
  "start_checks",
  "review_checks"
] as const satisfies readonly EvaluationRetryKind[];
const DURATION_ORDER = [
  "selection",
  "planning",
  "implementation",
  "verification",
  "review",
  "fixing"
] as const;

export const EVALUATION_ISSUE_CODE_ORDER = [
  "STATE_MISSING",
  "STATE_MALFORMED",
  "STATE_SCHEMA_UNSUPPORTED",
  "STATE_FIELD_MISSING",
  "STATE_FIELD_INVALID",
  "LEGACY_FIELD_ABSENT",
  "ATTEMPT_DIRECTORY_MISSING",
  "ATTEMPT_MALFORMED",
  "ATTEMPT_DUPLICATE",
  "ATTEMPT_CONFLICT",
  "EVENTS_MISSING",
  "EVENT_LINE_MALFORMED",
  "REVIEW_MISSING",
  "REVIEW_MALFORMED",
  "REVIEW_DUPLICATE",
  "REVIEW_UNAPPLIED",
  "METRIC_MISMATCH",
  "VERIFICATION_LEDGER_MALFORMED",
  "VERIFICATION_ATTEMPT_MALFORMED",
  "VERIFICATION_ATTEMPT_DUPLICATE",
  "VERIFICATION_ATTEMPT_CONFLICT",
  "VERIFICATION_SEQUENCE_CONFLICT",
  "VERIFICATION_SEQUENCE_MISSING",
  "VERIFICATION_HISTORY_INCOMPLETE",
  "PLAN_TASK_COMPLETION_INVALID",
  "ACTIVE_ATTEMPT_INCOMPLETE"
] as const satisfies readonly EvaluationIssueCode[];

const ISSUE_ORDER = new Map(
  EVALUATION_ISSUE_CODE_ORDER.map((code, index) => [code, index] as const)
);

interface ParsedAttempt {
  source: EvaluationAttemptSource;
  issues: EvaluationSourceIssue[];
}

interface AttemptCollection {
  attempts: EvaluationAttempt[];
  sources: EvaluationAttemptSource[];
  issues: EvaluationIssue[];
  unknownCount: number;
  invalidCount: number;
  directoryUnavailable: boolean;
  conflictedIdentities: Set<string>;
}

interface VerificationCollection {
  entries: EvaluationVerification[];
  sources: VerificationEvidenceSource[];
  retainedSources: EvaluationStateSource["verification"];
  metricSources: VerificationEvidenceSource[];
  activeCount: number;
  metricActiveCount: number;
  activeUnknownCount: number;
  activeInvalidCount: number;
  listUnknownCount: number;
  listInvalidCount: number;
  historicalUnknownCount: number;
  historicalInvalidCount: number;
  retainedCountInvalidCount: number;
  activeCountInvalidCount: number;
  countInvalidCount: number;
}

interface VerificationEvidenceSource {
  validStructure: boolean;
  status: EvidenceValue<VerificationAttemptStatus>;
  exitCode: EvidenceValue<number>;
  signalPresent: EvidenceValue<boolean>;
  durationMs: EvidenceValue<number>;
}

interface ReviewCollection {
  reviews: EvaluationReview[];
  issues: EvaluationIssue[];
  unknownCount: number;
  invalidCount: number;
}

interface EventCollection {
  events: EvaluationEventSource[];
  issues: EvaluationIssue[];
  unknownCount: number;
  invalidCount: number;
}

interface AttemptCoverage {
  sources: EvaluationAttemptSource[];
  genericUnknownCount: number;
  genericInvalidCount: number;
  activeKind: EvaluationAttemptSource["kind"]["value"];
  activeUnknownCount: number;
  activeInvalidCount: number;
}

interface CandidateResult {
  run: EvaluationRun | null;
  issues: EvaluationIssue[];
  excluded: boolean;
}

function recordOf<K extends string, V>(
  keys: readonly K[],
  create: (key: K) => V
): Record<K, V> {
  return Object.fromEntries(keys.map((key) => [key, create(key)])) as Record<
    K,
    V
  >;
}

export function exactMetric(
  value: number,
  observedCount = value
): NumericMetric {
  return {
    value,
    observedSubtotal: value,
    observedCount,
    unknownCount: 0,
    invalidCount: 0,
    availability: "complete"
  };
}

export function partialMetric(
  observedSubtotal: number,
  observedCount: number,
  unknownCount: number,
  invalidCount: number
): NumericMetric {
  return {
    value: null,
    observedSubtotal,
    observedCount,
    unknownCount,
    invalidCount,
    availability: "partial"
  };
}

export function unavailableMetric(): NumericMetric {
  return {
    value: null,
    observedSubtotal: 0,
    observedCount: 0,
    unknownCount: 0,
    invalidCount: 0,
    availability: "unavailable"
  };
}

function notApplicableMetric(): NumericMetric {
  return {
    value: null,
    observedSubtotal: 0,
    observedCount: 0,
    unknownCount: 0,
    invalidCount: 0,
    availability: "not_applicable"
  };
}

function countedMetric(
  value: number,
  invalidCount = 0,
  unknownCount = 0
): NumericMetric {
  return invalidCount === 0 && unknownCount === 0
    ? exactMetric(value, value)
    : partialMetric(value, value, unknownCount, invalidCount);
}

function metricFromEvidence(
  values: readonly EvidenceValue<number>[],
  options: {
    emptyUnavailable?: boolean;
    invalidCount?: number;
    unknownCount?: number;
  } = {}
): NumericMetric {
  let observedSubtotal = 0;
  let observedCount = 0;
  let unknownCount = options.unknownCount ?? 0;
  let invalidCount = options.invalidCount ?? 0;
  for (const item of values) {
    if (
      item.value !== null &&
      (item.evidence === "observed" || item.evidence === "derived")
    ) {
      observedSubtotal += item.value;
      observedCount += 1;
    } else if (item.evidence === "invalid") {
      invalidCount += 1;
    } else {
      unknownCount += 1;
    }
  }
  if (
    values.length === 0 &&
    observedCount === 0 &&
    unknownCount === 0 &&
    invalidCount === 0 &&
    options.emptyUnavailable === true
  ) {
    return unavailableMetric();
  }
  return unknownCount === 0 && invalidCount === 0
    ? exactMetric(observedSubtotal, observedCount)
    : partialMetric(
        observedSubtotal,
        observedCount,
        unknownCount,
        invalidCount
      );
}

export function combineMetrics(
  metrics: readonly NumericMetric[]
): NumericMetric {
  let observedSubtotal = 0;
  let observedCount = 0;
  let unknownCount = 0;
  let invalidCount = 0;
  let hasApplicable = false;
  let hasUnavailable = false;
  for (const metric of metrics) {
    observedSubtotal += metric.observedSubtotal;
    observedCount += metric.observedCount;
    unknownCount += metric.unknownCount;
    invalidCount += metric.invalidCount;
    hasApplicable ||=
      metric.availability === "complete" || metric.availability === "partial";
    hasUnavailable ||= metric.availability === "unavailable";
  }
  if (
    !hasApplicable &&
    observedCount === 0 &&
    unknownCount === 0 &&
    invalidCount === 0
  ) {
    return hasUnavailable ? unavailableMetric() : notApplicableMetric();
  }
  return unknownCount === 0 && invalidCount === 0
    ? exactMetric(observedSubtotal, observedCount)
    : partialMetric(
        observedSubtotal,
        observedCount,
        unknownCount,
        invalidCount
      );
}

function emptyMetricSet(unreadable = false): EvaluationMetricSet {
  const empty = (): NumericMetric =>
    unreadable ? partialMetric(0, 0, 1, 0) : exactMetric(0, 0);
  return {
    attempts: {
      total: empty(),
      byKind: recordOf(EVALUATION_ATTEMPT_KIND_ORDER, empty),
      byOutcome: recordOf(EVALUATION_ATTEMPT_OUTCOME_ORDER, empty)
    },
    durationsMs: recordOf(DURATION_ORDER, empty),
    sessions: recordOf(SESSION_ORDER, empty),
    reviews: {
      attempts: recordOf(REVIEW_MODE_ORDER, empty),
      rotations: {
        total: empty(),
        byReason: recordOf(EVALUATION_ROTATION_REASON_ORDER, empty)
      },
      verdicts: recordOf(REVIEW_VERDICT_ORDER, empty),
      findings: recordOf(FINDING_SEVERITY_ORDER, empty)
    },
    triage: recordOf(TRIAGE_ORDER, empty),
    retries: {
      total: empty(),
      byKind: recordOf(RETRY_ORDER, empty)
    },
    failures: recordOf(EVALUATION_FAILURE_ORDER, empty),
    verification: {
      retained: empty(),
      completed: empty(),
      failed: empty()
    },
    usage: {
      inputTokens: empty(),
      cachedInputTokens: empty(),
      outputTokens: empty(),
      costUsd: unreadable ? partialMetric(0, 0, 1, 0) : unavailableMetric()
    },
    fixCycles: empty(),
    humanMinutes: unavailableMetric(),
    falsePositiveRate: unavailableMetric()
  };
}

function metricIssueSeverity(
  code: EvaluationIssueCode
): EvaluationIssueSeverity {
  return code.includes("MALFORMED") ||
    code.includes("CONFLICT") ||
    code === "STATE_FIELD_INVALID" ||
    code === "PLAN_TASK_COMPLETION_INVALID" ||
    code === "STATE_SCHEMA_UNSUPPORTED"
    ? "error"
    : "warning";
}

function evaluationIssue(
  runKey: string | null,
  attemptKey: string | null,
  source: EvaluationIssueSource,
  issueValue: EvaluationSourceIssue
): EvaluationIssue {
  return {
    runKey,
    attemptKey,
    source,
    field: issueValue.field,
    code: issueValue.code,
    severity: metricIssueSeverity(issueValue.code)
  };
}

function directIssue(
  runKey: string | null,
  source: EvaluationIssueSource,
  code: EvaluationIssueCode,
  field: string | null = null,
  attemptKey: string | null = null
): EvaluationIssue {
  return evaluationIssue(runKey, attemptKey, source, { code, field });
}

function sortIssues(issues: EvaluationIssue[]): EvaluationIssue[] {
  return [...issues].sort((left, right) => {
    const fields: [string, string][] = [
      [left.runKey ?? "", right.runKey ?? ""],
      [left.source, right.source],
      [left.attemptKey ?? "", right.attemptKey ?? ""],
      [left.field ?? "", right.field ?? ""]
    ];
    for (const [leftValue, rightValue] of fields) {
      const compared = leftValue.localeCompare(rightValue);
      if (compared !== 0) {
        return compared;
      }
    }
    return (
      (ISSUE_ORDER.get(left.code) ?? 999) - (ISSUE_ORDER.get(right.code) ?? 999)
    );
  });
}

function issueCodes(issues: readonly EvaluationIssue[]): EvaluationIssueCode[] {
  const codes = new Set(issues.map((item) => item.code));
  return EVALUATION_ISSUE_CODE_ORDER.filter((code) => codes.has(code));
}

function isMissingFile(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

async function readJsonUnknown(
  filePath: string
): Promise<
  | { kind: "ok"; value: unknown }
  | { kind: "missing" }
  | { kind: "malformed" }
  | { kind: "unreadable" }
> {
  try {
    return { kind: "ok", value: JSON.parse(await readFile(filePath, "utf8")) };
  } catch (error) {
    if (isMissingFile(error)) {
      return { kind: "missing" };
    }
    if (error instanceof SyntaxError) {
      return { kind: "malformed" };
    }
    return { kind: "unreadable" };
  }
}

async function childDirectoryEntries(
  directory: string
): Promise<Dirent[] | null | undefined> {
  try {
    return await readdir(directory, { withFileTypes: true });
  } catch (error) {
    return isMissingFile(error) ? null : undefined;
  }
}

async function directoryEntries(directory: string): Promise<Dirent[] | null> {
  try {
    return await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (isMissingFile(error)) {
      return null;
    }
    throw new BanzaiError(
      "EVAL_READ_FAILED",
      "Evaluation evidence could not be read safely."
    );
  }
}

function opaqueKey(prefix: "run" | "attempt", index: number): string {
  return `${prefix}-${String(index + 1).padStart(prefix === "run" ? 6 : 3, "0")}`;
}

function attemptSort(
  left: EvaluationAttemptSource,
  right: EvaluationAttemptSource
): number {
  const leftTime =
    left.startedAt.value === null
      ? Number.POSITIVE_INFINITY
      : Date.parse(left.startedAt.value);
  const rightTime =
    right.startedAt.value === null
      ? Number.POSITIVE_INFINITY
      : Date.parse(right.startedAt.value);
  if (leftTime !== rightTime) {
    return leftTime - rightTime;
  }
  const leftKind = left.kind.value;
  const rightKind = right.kind.value;
  const kindDifference =
    (leftKind === null
      ? EVALUATION_ATTEMPT_KIND_ORDER.length
      : EVALUATION_ATTEMPT_KIND_ORDER.indexOf(leftKind)) -
    (rightKind === null
      ? EVALUATION_ATTEMPT_KIND_ORDER.length
      : EVALUATION_ATTEMPT_KIND_ORDER.indexOf(rightKind));
  return kindDifference !== 0
    ? kindDifference
    : left.identity.localeCompare(right.identity);
}

function attemptDuration(
  source: EvaluationAttemptSource
): EvidenceValue<number> {
  if (source.durationMs.value !== null) {
    return source.durationMs;
  }
  if (source.status.value === "started") {
    return { value: null, evidence: "unknown" };
  }
  if (source.durationMs.evidence === "invalid") {
    return source.durationMs;
  }
  if (
    source.startedAt.evidence === "invalid" ||
    source.completedAt.evidence === "invalid"
  ) {
    return { value: null, evidence: "invalid" };
  }
  if (source.startedAt.value !== null && source.completedAt.value !== null) {
    const duration =
      Date.parse(source.completedAt.value) - Date.parse(source.startedAt.value);
    return duration >= 0
      ? { value: duration, evidence: "derived" }
      : { value: null, evidence: "invalid" };
  }
  return { value: null, evidence: source.durationMs.evidence };
}

function publicAttempt(
  source: EvaluationAttemptSource,
  attemptKey: string
): EvaluationAttempt {
  return {
    attemptKey,
    source: { schemaVersion: source.schemaVersion },
    kind: source.kind,
    mutable: source.mutable,
    status: source.status,
    startedAt: source.startedAt,
    completedAt: source.completedAt,
    durationMs: attemptDuration(source),
    sessionMode: source.sessionMode,
    reviewMode: source.reviewMode,
    rotationReason: source.rotationReason,
    model: source.model,
    usage: source.usage
  };
}

async function collectAttempts(
  runDirectory: string,
  runKey: string
): Promise<AttemptCollection> {
  const attemptsDirectory = path.join(runDirectory, "attempts");
  const entries = await childDirectoryEntries(attemptsDirectory);
  if (entries === null) {
    return {
      attempts: [],
      sources: [],
      issues: [directIssue(runKey, "attempt", "ATTEMPT_DIRECTORY_MISSING")],
      unknownCount: 1,
      invalidCount: 0,
      directoryUnavailable: true,
      conflictedIdentities: new Set()
    };
  }
  if (entries === undefined) {
    return {
      attempts: [],
      sources: [],
      issues: [directIssue(runKey, "attempt", "ATTEMPT_MALFORMED")],
      unknownCount: 0,
      invalidCount: 1,
      directoryUnavailable: true,
      conflictedIdentities: new Set()
    };
  }
  // These writer-owned sidecars have separate contracts and are outside this
  // reader's allow-list. Keep every other JSON candidate, including historical
  // filenames, so unknown or damaged canonical evidence cannot disappear.
  const files = entries
    .filter(
      (entry) =>
        entry.name.endsWith(".json") &&
        !entry.name.endsWith("-result.json") &&
        !entry.name.endsWith(".terminal-checkpoint.json") &&
        !entry.name.endsWith(".review-snapshot.json") &&
        !entry.name.endsWith(".context.json") &&
        !entry.name.endsWith(".artifact-workspace.json")
    )
    .sort((left, right) => left.name.localeCompare(right.name));
  const parsed: ParsedAttempt[] = [];
  const issues: EvaluationIssue[] = [];
  let invalidCount = 0;
  const conflictedIdentities = new Set<string>();
  for (const file of files) {
    // Do not follow non-regular candidates into unowned content or silently
    // interpret an unreadable leaf as a confirmed absence of attempts.
    if (!file.isFile()) {
      issues.push(directIssue(runKey, "attempt", "ATTEMPT_MALFORMED"));
      invalidCount += 1;
      continue;
    }
    const result = await readJsonUnknown(
      path.join(attemptsDirectory, file.name)
    );
    if (result.kind !== "ok") {
      issues.push(directIssue(runKey, "attempt", "ATTEMPT_MALFORMED"));
      invalidCount += 1;
      continue;
    }
    try {
      const decoded = parseEvaluationAttemptSource(result.value);
      parsed.push({ source: decoded.value, issues: decoded.issues });
    } catch {
      issues.push(directIssue(runKey, "attempt", "ATTEMPT_MALFORMED"));
      invalidCount += 1;
    }
  }

  const groups = new Map<string, ParsedAttempt[]>();
  for (const attempt of parsed) {
    const group = groups.get(attempt.source.identity) ?? [];
    group.push(attempt);
    groups.set(attempt.source.identity, group);
  }
  const unique: ParsedAttempt[] = [];
  for (const group of groups.values()) {
    const first = group[0];
    if (first === undefined) {
      continue;
    }
    if (group.length === 1) {
      unique.push(first);
      continue;
    }
    const canonical = JSON.stringify(first.source);
    if (group.every((item) => JSON.stringify(item.source) === canonical)) {
      unique.push(first);
      issues.push(directIssue(runKey, "attempt", "ATTEMPT_DUPLICATE"));
    } else {
      issues.push(directIssue(runKey, "attempt", "ATTEMPT_CONFLICT"));
      invalidCount += 1;
      conflictedIdentities.add(first.source.identity);
    }
  }

  unique.sort((left, right) => attemptSort(left.source, right.source));
  const attempts: EvaluationAttempt[] = [];
  const sources: EvaluationAttemptSource[] = [];
  for (const [index, item] of unique.entries()) {
    const attemptKey = opaqueKey("attempt", index);
    attempts.push(publicAttempt(item.source, attemptKey));
    sources.push(item.source);
    issues.push(
      ...item.issues.map((sourceIssue) =>
        evaluationIssue(runKey, attemptKey, "attempt", sourceIssue)
      )
    );
  }
  return {
    attempts,
    sources,
    issues,
    unknownCount: 0,
    invalidCount,
    directoryUnavailable: false,
    conflictedIdentities
  };
}

function verificationDuration(
  source: EvaluationStateSource["verification"][number]
): EvidenceValue<number> {
  if (source.startedAt.value === null || source.completedAt.value === null) {
    return {
      value: null,
      evidence:
        source.startedAt.evidence === "invalid" ||
        source.completedAt.evidence === "invalid"
          ? "invalid"
          : "unknown"
    };
  }
  const duration =
    Date.parse(source.completedAt.value) - Date.parse(source.startedAt.value);
  return duration >= 0
    ? { value: duration, evidence: "derived" }
    : { value: null, evidence: "invalid" };
}

function legacyVerificationSource(
  source: EvaluationStateSource["verification"][number]
): VerificationEvidenceSource {
  return {
    validStructure: source.validStructure,
    status: { value: "completed", evidence: "observed" },
    exitCode: source.exitCode,
    signalPresent: source.signalPresent,
    durationMs: verificationDuration(source)
  };
}

function collectLegacyVerification(
  state: EvaluationStateSource
): VerificationCollection {
  const sources = state.verification.map(legacyVerificationSource);
  const entries = state.verification.map((item, index) => ({
    ordinal: index + 1,
    status: "completed" as const,
    exitCode: item.exitCode,
    signalPresent: item.signalPresent,
    durationMs: verificationDuration(item)
  }));
  const cumulative = state.metrics.attempts.verification.value;
  const activeCount = state.activeVerification.value === true ? 1 : 0;
  const activeUnknownCount =
    state.activeVerification.value === null &&
    state.activeVerification.evidence !== "invalid"
      ? 1
      : 0;
  const activeInvalidCount =
    state.activeVerification.evidence === "invalid" ? 1 : 0;
  const metricRetainedCount =
    cumulative === null ? entries.length : Math.min(entries.length, cumulative);
  const metricActiveCount =
    cumulative === null
      ? activeCount
      : Math.min(activeCount, Math.max(0, cumulative - metricRetainedCount));
  const metricObservedCount = metricRetainedCount + metricActiveCount;
  const retainedCountInvalidCount = entries.length - metricRetainedCount;
  const activeCountInvalidCount = activeCount - metricActiveCount;
  const countInvalidCount = retainedCountInvalidCount + activeCountInvalidCount;
  const historicalUnknownCount =
    cumulative === null &&
    state.metrics.attempts.verification.evidence !== "invalid"
      ? 1
      : cumulative === null
        ? 0
        : Math.max(0, cumulative - metricObservedCount);
  const historicalInvalidCount =
    cumulative === null &&
    state.metrics.attempts.verification.evidence === "invalid"
      ? 1
      : 0;
  return {
    entries,
    sources,
    retainedSources: state.verification,
    metricSources: sources.slice(0, metricRetainedCount),
    activeCount,
    metricActiveCount,
    activeUnknownCount,
    activeInvalidCount,
    listUnknownCount:
      state.verificationList.value === null &&
      state.verificationList.evidence !== "invalid"
        ? 1
        : 0,
    listInvalidCount: state.verificationList.evidence === "invalid" ? 1 : 0,
    historicalUnknownCount,
    historicalInvalidCount,
    retainedCountInvalidCount,
    activeCountInvalidCount,
    countInvalidCount
  };
}

function ledgerVerificationSource(
  record: VerificationAttemptRecord
): VerificationEvidenceSource {
  return {
    validStructure: true,
    status: { value: record.status, evidence: "observed" },
    exitCode:
      record.exitCode === null
        ? { value: null, evidence: "not_applicable" }
        : { value: record.exitCode, evidence: "observed" },
    signalPresent: {
      value: record.signal !== null,
      evidence: "observed"
    },
    durationMs:
      record.durationMs === null
        ? { value: null, evidence: "unknown" }
        : { value: record.durationMs, evidence: "observed" }
  };
}

async function collectVerification(
  runDirectory: string,
  runKey: string,
  state: EvaluationStateSource
): Promise<{ collection: VerificationCollection; issues: EvaluationIssue[] }> {
  const directory = path.join(runDirectory, "verification-attempts");
  const entries = await childDirectoryEntries(directory);
  if (entries === null) {
    return { collection: collectLegacyVerification(state), issues: [] };
  }
  const issues: EvaluationIssue[] = [];
  if (entries === undefined) {
    issues.push(
      directIssue(
        runKey,
        "verification",
        "VERIFICATION_LEDGER_MALFORMED",
        "verification-attempts"
      )
    );
    return {
      collection: {
        entries: [],
        sources: [],
        retainedSources: state.verification,
        metricSources: [],
        activeCount: 0,
        metricActiveCount: 0,
        activeUnknownCount: 0,
        activeInvalidCount: 0,
        listUnknownCount: state.verificationList.value === null ? 1 : 0,
        listInvalidCount: state.verificationList.evidence === "invalid" ? 1 : 0,
        historicalUnknownCount: state.metrics.attempts.verification.value ?? 1,
        historicalInvalidCount: 1,
        retainedCountInvalidCount: 0,
        activeCountInvalidCount: 0,
        countInvalidCount: 1
      },
      issues
    };
  }
  const marker = await readJsonUnknown(path.join(directory, "ledger.json"));
  if (marker.kind !== "ok") {
    issues.push(
      directIssue(
        runKey,
        "verification",
        "VERIFICATION_LEDGER_MALFORMED",
        "ledger"
      )
    );
  } else {
    try {
      parseVerificationLedger(marker.value);
    } catch {
      issues.push(
        directIssue(
          runKey,
          "verification",
          "VERIFICATION_LEDGER_MALFORMED",
          "ledger"
        )
      );
    }
  }
  const files = entries
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name !== "ledger.json" &&
        entry.name.endsWith(".json")
    )
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
  const parsed: { file: string; record: VerificationAttemptRecord }[] = [];
  let invalidCount = marker.kind === "ok" && issues.length === 0 ? 0 : 1;
  for (const file of files) {
    const result = await readJsonUnknown(path.join(directory, file));
    if (result.kind !== "ok") {
      invalidCount += 1;
      issues.push(
        directIssue(
          runKey,
          "verification",
          "VERIFICATION_ATTEMPT_MALFORMED",
          "attempt"
        )
      );
      continue;
    }
    try {
      parsed.push({
        file,
        record: parseVerificationAttemptRecord(result.value)
      });
    } catch {
      invalidCount += 1;
      issues.push(
        directIssue(
          runKey,
          "verification",
          "VERIFICATION_ATTEMPT_MALFORMED",
          "attempt"
        )
      );
    }
  }
  const identities = new Map<string, typeof parsed>();
  for (const item of parsed) {
    const group = identities.get(item.record.id) ?? [];
    group.push(item);
    identities.set(item.record.id, group);
  }
  const identityUnique: typeof parsed = [];
  for (const group of identities.values()) {
    const first = group[0];
    if (first === undefined) {
      continue;
    }
    if (group.length === 1) {
      identityUnique.push(first);
      continue;
    }
    const canonical = JSON.stringify(first.record);
    if (group.every((item) => JSON.stringify(item.record) === canonical)) {
      identityUnique.push(first);
      issues.push(
        directIssue(
          runKey,
          "verification",
          "VERIFICATION_ATTEMPT_DUPLICATE",
          "id"
        )
      );
    } else {
      invalidCount += 1;
      issues.push(
        directIssue(
          runKey,
          "verification",
          "VERIFICATION_ATTEMPT_CONFLICT",
          "id"
        )
      );
    }
  }
  const sequences = new Map<number, typeof identityUnique>();
  for (const item of identityUnique) {
    const group = sequences.get(item.record.sequence) ?? [];
    group.push(item);
    sequences.set(item.record.sequence, group);
  }
  const unique: typeof identityUnique = [];
  for (const group of sequences.values()) {
    if (group.length === 1 && group[0] !== undefined) {
      unique.push(group[0]);
    } else {
      invalidCount += 1;
      issues.push(
        directIssue(
          runKey,
          "verification",
          "VERIFICATION_SEQUENCE_CONFLICT",
          "sequence"
        )
      );
    }
  }
  unique.sort(
    (left, right) =>
      left.record.sequence - right.record.sequence ||
      left.file.localeCompare(right.file)
  );
  const missingSequence = unique.some(
    (item, index) => item.record.sequence !== index + 1
  );
  if (missingSequence) {
    invalidCount += 1;
    issues.push(
      directIssue(
        runKey,
        "verification",
        "VERIFICATION_SEQUENCE_MISSING",
        "sequence"
      )
    );
  }
  const records = unique.map((item) => item.record);
  const sources = records.map(ledgerVerificationSource);
  const cumulative = state.metrics.attempts.verification.value;
  const countMismatch = cumulative !== null && cumulative !== records.length;
  if (countMismatch) {
    invalidCount += 1;
  }
  const publicEntries = records.map((record) => {
    const source = ledgerVerificationSource(record);
    return {
      ordinal: record.sequence,
      status: record.status,
      exitCode: source.exitCode,
      signalPresent: source.signalPresent,
      durationMs: source.durationMs
    };
  });
  const startedCount = records.filter(
    (record) => record.status === "started"
  ).length;
  const historicalUnknownCount =
    cumulative === null
      ? invalidCount > 0
        ? 1
        : 0
      : Math.max(0, cumulative - records.length);
  return {
    collection: {
      entries: publicEntries,
      sources,
      retainedSources: state.verification,
      metricSources: sources,
      activeCount: startedCount,
      metricActiveCount: 0,
      activeUnknownCount: 0,
      activeInvalidCount: 0,
      listUnknownCount:
        state.verificationList.value === null &&
        state.verificationList.evidence !== "invalid"
          ? 1
          : 0,
      listInvalidCount: state.verificationList.evidence === "invalid" ? 1 : 0,
      historicalUnknownCount,
      historicalInvalidCount: invalidCount,
      retainedCountInvalidCount: 0,
      activeCountInvalidCount: 0,
      countInvalidCount: invalidCount
    },
    issues
  };
}

async function collectReviews(
  runDirectory: string,
  runKey: string,
  expectedReviews: EvidenceValue<number>
): Promise<ReviewCollection> {
  const reviewsDirectory = path.join(runDirectory, "reviews");
  const entries = await childDirectoryEntries(reviewsDirectory);
  const issues: EvaluationIssue[] = [];
  if (entries === null) {
    const expected = expectedReviews.value ?? 0;
    if (expected > 0) {
      issues.push(directIssue(runKey, "review", "REVIEW_MISSING"));
    }
    return {
      reviews: [],
      issues,
      unknownCount: expectedReviews.value === null ? 1 : expected,
      invalidCount: 0
    };
  }
  if (entries === undefined) {
    issues.push(directIssue(runKey, "review", "REVIEW_MALFORMED"));
    return {
      reviews: [],
      issues,
      unknownCount: 0,
      invalidCount: Math.max(1, expectedReviews.value ?? 1)
    };
  }
  const reviewFiles = entries
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const match = /^review-(\d+)\.json$/.exec(entry.name);
      return match === null
        ? null
        : { name: entry.name, ordinal: Number.parseInt(match[1] ?? "0", 10) };
    })
    .filter(
      (entry): entry is { name: string; ordinal: number } => entry !== null
    )
    .sort(
      (left, right) =>
        left.ordinal - right.ordinal || left.name.localeCompare(right.name)
    );

  const groups = new Map<number, EvaluationReviewSource[]>();
  let invalidCount = 0;
  for (const file of reviewFiles) {
    if (
      file.ordinal < 1 ||
      expectedReviews.value === null ||
      file.ordinal > expectedReviews.value
    ) {
      issues.push(directIssue(runKey, "review", "REVIEW_UNAPPLIED"));
      invalidCount += 1;
      continue;
    }
    const result = await readJsonUnknown(
      path.join(reviewsDirectory, file.name)
    );
    if (result.kind !== "ok") {
      issues.push(directIssue(runKey, "review", "REVIEW_MALFORMED"));
      invalidCount += 1;
      continue;
    }
    try {
      const parsed = parseEvaluationReviewSource(result.value);
      const group = groups.get(file.ordinal) ?? [];
      group.push(parsed.value);
      groups.set(file.ordinal, group);
      issues.push(
        ...parsed.issues.map((item) =>
          evaluationIssue(runKey, null, "review", item)
        )
      );
    } catch {
      issues.push(directIssue(runKey, "review", "REVIEW_MALFORMED"));
      invalidCount += 1;
    }
  }

  const reviews: EvaluationReview[] = [];
  for (const [ordinal, group] of [...groups.entries()].sort(
    ([left], [right]) => left - right
  )) {
    const first = group[0];
    if (first === undefined) {
      continue;
    }
    if (group.length > 1) {
      const canonical = JSON.stringify(first);
      if (!group.every((item) => JSON.stringify(item) === canonical)) {
        issues.push(directIssue(runKey, "review", "REVIEW_MALFORMED"));
        invalidCount += 1;
        continue;
      }
      issues.push(directIssue(runKey, "review", "REVIEW_DUPLICATE"));
    }
    reviews.push({ ordinal, verdict: first.verdict, findings: first.findings });
  }

  const expected = expectedReviews.value;
  const unknownCount =
    expected === null
      ? 1
      : Math.max(0, expected - reviews.length - invalidCount);
  if (unknownCount > 0 && expected !== null) {
    issues.push(directIssue(runKey, "review", "REVIEW_MISSING"));
  }
  return { reviews, issues, unknownCount, invalidCount };
}

async function collectEvents(
  runDirectory: string,
  runKey: string
): Promise<EventCollection> {
  let contents: string;
  try {
    contents = await readFile(path.join(runDirectory, "events.jsonl"), "utf8");
  } catch (error) {
    if (isMissingFile(error)) {
      return {
        events: [],
        issues: [directIssue(runKey, "event", "EVENTS_MISSING")],
        unknownCount: 1,
        invalidCount: 0
      };
    }
    return {
      events: [],
      issues: [directIssue(runKey, "event", "EVENT_LINE_MALFORMED")],
      unknownCount: 0,
      invalidCount: 1
    };
  }
  const events: EvaluationEventSource[] = [];
  const issues: EvaluationIssue[] = [];
  let invalidCount = 0;
  for (const line of contents.split(/\r?\n/u)) {
    if (line.trim().length === 0) {
      continue;
    }
    try {
      events.push(parseEvaluationEventSource(JSON.parse(line)));
    } catch {
      issues.push(directIssue(runKey, "event", "EVENT_LINE_MALFORMED"));
      invalidCount += 1;
    }
  }
  return { events, issues, unknownCount: 0, invalidCount };
}

function phaseForAttempt(
  kind: EvaluationAttemptSource["kind"]["value"]
): keyof EvaluationMetricSet["durationsMs"] | null {
  switch (kind) {
    case "selection":
      return "selection";
    case "plan":
      return "planning";
    case "implementation":
      return "implementation";
    case "review":
      return "review";
    case "fix":
      return "fixing";
    default:
      return null;
  }
}

function countValues<T extends string>(
  values: readonly T[],
  keys: readonly T[]
): Record<T, number> {
  const counts = recordOf(keys, () => 0);
  for (const value of values) {
    counts[value] += 1;
  }
  return counts;
}

function addFailure(
  counts: Record<EvaluationFailureCategory, number>,
  category: EvaluationFailureCategory,
  amount = 1
): void {
  counts[category] += amount;
}

function resolveAttemptCoverage(
  state: EvaluationStateSource,
  attempts: AttemptCollection,
  addIssue: (issueValue: EvaluationIssue) => void
): AttemptCoverage {
  const excluded = new Set<string>();
  let genericUnknownCount = attempts.unknownCount;
  let genericInvalidCount = attempts.invalidCount;
  for (const source of attempts.sources) {
    if (source.schemaVersion.value === 1 || source.schemaVersion.value === 2) {
      continue;
    }
    excluded.add(source.identity);
    if (source.schemaVersion.evidence === "invalid") {
      genericInvalidCount += 1;
    } else {
      genericUnknownCount += 1;
    }
  }

  const noActiveAttempt =
    state.activeAttemptIdentity.evidence === "not_applicable" &&
    state.activeAttemptKind.evidence === "not_applicable";
  if (noActiveAttempt) {
    return {
      sources: attempts.sources.filter((item) => !excluded.has(item.identity)),
      genericUnknownCount,
      genericInvalidCount,
      activeKind: null,
      activeUnknownCount: 0,
      activeInvalidCount: 0
    };
  }

  const identity = state.activeAttemptIdentity.value;
  const expectedKind = state.activeAttemptKind.value;
  const source =
    identity === null
      ? undefined
      : attempts.sources.find((item) => item.identity === identity);
  const exact =
    (source?.schemaVersion.value === 1 || source?.schemaVersion.value === 2) &&
    expectedKind !== null &&
    source.kind.value === expectedKind &&
    source.status.value !== null;
  if (exact) {
    return {
      sources: attempts.sources.filter((item) => !excluded.has(item.identity)),
      genericUnknownCount,
      genericInvalidCount,
      activeKind: null,
      activeUnknownCount: 0,
      activeInvalidCount: 0
    };
  }

  addIssue(
    directIssue(null, "attempt", "ACTIVE_ATTEMPT_INCOMPLETE", "activeAttempt")
  );
  if (source !== undefined) {
    excluded.add(source.identity);
  }
  const alreadyRepresented =
    (identity !== null && attempts.conflictedIdentities.has(identity)) ||
    (source !== undefined &&
      source.schemaVersion.value !== 1 &&
      source.schemaVersion.value !== 2) ||
    (source === undefined && attempts.directoryUnavailable);
  const sourceContradictsActive =
    source !== undefined &&
    (source.status.evidence === "invalid" ||
      source.kind.evidence === "invalid" ||
      (expectedKind !== null &&
        source.kind.value !== null &&
        source.kind.value !== expectedKind));
  const invalidActive =
    state.activeAttemptIdentity.evidence === "invalid" ||
    state.activeAttemptKind.evidence === "invalid" ||
    sourceContradictsActive;
  return {
    sources: attempts.sources.filter((item) => !excluded.has(item.identity)),
    genericUnknownCount,
    genericInvalidCount,
    activeKind: expectedKind ?? source?.kind.value ?? null,
    activeUnknownCount: alreadyRepresented || invalidActive ? 0 : 1,
    activeInvalidCount: alreadyRepresented || !invalidActive ? 0 : 1
  };
}

function buildMetricSet(
  state: EvaluationStateSource,
  attempts: AttemptCollection,
  verification: VerificationCollection,
  reviews: ReviewCollection,
  events: EventCollection,
  allIssues: EvaluationIssue[],
  addIssue: (issueValue: EvaluationIssue) => void
): EvaluationMetricSet {
  const metrics = emptyMetricSet();
  const attemptCoverage = resolveAttemptCoverage(state, attempts, addIssue);
  const modelSources = attemptCoverage.sources;
  const validKinds = modelSources
    .map((item) => item.kind.value)
    .filter((item): item is NonNullable<typeof item> => item !== null);
  const modelKinds = [
    "selection",
    "plan",
    "implementation",
    "fix",
    "review"
  ] as const;
  const modelKindCounts = countValues(validKinds, modelKinds);
  const counterGapsByKind = recordOf(modelKinds, () => 0);
  // A higher persisted counter contradicts an otherwise complete leaf set.
  // It cannot supply identities, statuses, or usage for the missing evidence.
  // Keep its known kind for scoped metrics; only whole-set metrics take the sum.
  // Do not count it again when collection or active reconciliation found a gap.
  if (
    attemptCoverage.genericUnknownCount === 0 &&
    attemptCoverage.genericInvalidCount === 0 &&
    attemptCoverage.activeUnknownCount === 0 &&
    attemptCoverage.activeInvalidCount === 0 &&
    validKinds.length === modelSources.length
  ) {
    for (const kind of modelKinds) {
      const stateCount = state.metrics.attempts[kind].value;
      if (stateCount !== null && stateCount > modelKindCounts[kind]) {
        counterGapsByKind[kind] = stateCount - modelKindCounts[kind];
        addIssue(
          directIssue(
            null,
            "state",
            "METRIC_MISMATCH",
            `metrics.attempts.${kind}`
          )
        );
      }
    }
  }
  const counterGapCount = modelKinds.reduce(
    (total, kind) => total + counterGapsByKind[kind],
    0
  );
  const invalidKindCount = modelSources.filter(
    (item) => item.kind.value === null && item.kind.evidence === "invalid"
  ).length;
  const unknownKindCount = modelSources.filter(
    (item) => item.kind.value === null && item.kind.evidence !== "invalid"
  ).length;
  for (const kind of modelKinds) {
    metrics.attempts.byKind[kind] = countedMetric(
      modelKindCounts[kind],
      attemptCoverage.genericInvalidCount +
        invalidKindCount +
        (attemptCoverage.activeKind === kind ||
        attemptCoverage.activeKind === null
          ? attemptCoverage.activeInvalidCount
          : 0),
      attemptCoverage.genericUnknownCount +
        counterGapsByKind[kind] +
        unknownKindCount +
        (attemptCoverage.activeKind === kind ||
        attemptCoverage.activeKind === null
          ? attemptCoverage.activeUnknownCount
          : 0)
    );
    const stateCount = state.metrics.attempts[kind].value;
    if (
      stateCount !== null &&
      metrics.attempts.byKind[kind].value !== null &&
      stateCount !== metrics.attempts.byKind[kind].value
    ) {
      addIssue(
        directIssue(
          null,
          "state",
          "METRIC_MISMATCH",
          `metrics.attempts.${kind}`
        )
      );
    }
  }
  const cumulativeVerification = state.metrics.attempts.verification.value;
  const retainedAndActiveVerification =
    verification.metricSources.length + verification.metricActiveCount;
  if (verification.countInvalidCount > 0) {
    addIssue(
      directIssue(
        null,
        "state",
        "METRIC_MISMATCH",
        "metrics.attempts.verification"
      )
    );
  }
  metrics.attempts.byKind.verification =
    cumulativeVerification === null
      ? partialMetric(
          retainedAndActiveVerification,
          retainedAndActiveVerification,
          verification.historicalUnknownCount + verification.activeUnknownCount,
          verification.historicalInvalidCount +
            verification.countInvalidCount +
            verification.activeInvalidCount
        )
      : verification.countInvalidCount > 0 ||
          verification.activeUnknownCount > 0 ||
          verification.activeInvalidCount > 0
        ? partialMetric(
            retainedAndActiveVerification,
            retainedAndActiveVerification,
            verification.activeUnknownCount,
            verification.countInvalidCount + verification.activeInvalidCount
          )
        : exactMetric(cumulativeVerification, cumulativeVerification);
  metrics.attempts.total = combineMetrics([
    countedMetric(
      modelSources.length,
      attemptCoverage.genericInvalidCount + attemptCoverage.activeInvalidCount,
      attemptCoverage.genericUnknownCount +
        counterGapCount +
        attemptCoverage.activeUnknownCount
    ),
    metrics.attempts.byKind.verification
  ]);

  const modelOutcomes = modelSources
    .map((item) => item.status.value)
    .filter((item): item is EvaluationAttemptOutcome => item !== null);
  const outcomeCounts = countValues(
    modelOutcomes,
    EVALUATION_ATTEMPT_OUTCOME_ORDER
  );
  const invalidStatusCount = modelSources.filter(
    (item) => item.status.value === null && item.status.evidence === "invalid"
  ).length;
  const unknownStatusCount = modelSources.filter(
    (item) => item.status.value === null && item.status.evidence !== "invalid"
  ).length;
  const successfulVerification = verification.metricSources.filter(
    (item) => item.status.value === "completed" && item.exitCode.value === 0
  ).length;
  const failedVerification = verification.metricSources.filter(
    (item) =>
      item.status.value === "failed" ||
      item.status.value === "interrupted" ||
      (item.status.value === "completed" &&
        item.exitCode.value !== null &&
        item.exitCode.value !== 0)
  ).length;
  const unknownVerificationExitCount = verification.metricSources.filter(
    (item) =>
      item.status.value === "completed" &&
      item.exitCode.value === null &&
      item.exitCode.evidence !== "invalid"
  ).length;
  const invalidVerificationExitCount = verification.metricSources.filter(
    (item) =>
      item.status.value === "completed" && item.exitCode.evidence === "invalid"
  ).length;
  const startedVerification = verification.metricSources.filter(
    (item) => item.status.value === "started"
  ).length;
  const unknownUnresolvedVerificationOutcomes =
    verification.historicalUnknownCount;
  const invalidUnresolvedVerificationOutcomes =
    verification.historicalInvalidCount;
  const unknownTerminalVerificationOutcomes =
    unknownUnresolvedVerificationOutcomes + unknownVerificationExitCount;
  const invalidTerminalVerificationOutcomes =
    invalidUnresolvedVerificationOutcomes +
    verification.retainedCountInvalidCount +
    invalidVerificationExitCount;
  const unknownActiveVerificationOutcomes =
    verification.activeUnknownCount + unknownUnresolvedVerificationOutcomes;
  const invalidActiveVerificationOutcomes =
    verification.activeInvalidCount +
    verification.activeCountInvalidCount +
    invalidUnresolvedVerificationOutcomes;
  const invalidModelOutcomes =
    attemptCoverage.genericInvalidCount +
    attemptCoverage.activeInvalidCount +
    invalidStatusCount;
  const unknownModelOutcomes =
    attemptCoverage.genericUnknownCount +
    counterGapCount +
    attemptCoverage.activeUnknownCount +
    unknownStatusCount;
  metrics.attempts.byOutcome.completed = countedMetric(
    outcomeCounts.completed + successfulVerification,
    invalidModelOutcomes + invalidTerminalVerificationOutcomes,
    unknownModelOutcomes + unknownTerminalVerificationOutcomes
  );
  metrics.attempts.byOutcome.failed = countedMetric(
    outcomeCounts.failed + failedVerification,
    invalidModelOutcomes + invalidTerminalVerificationOutcomes,
    unknownModelOutcomes + unknownTerminalVerificationOutcomes
  );
  metrics.attempts.byOutcome.started = countedMetric(
    outcomeCounts.started +
      startedVerification +
      verification.metricActiveCount,
    invalidModelOutcomes + invalidActiveVerificationOutcomes,
    unknownModelOutcomes + unknownActiveVerificationOutcomes
  );

  const durations = recordOf(
    DURATION_ORDER,
    () => [] as EvidenceValue<number>[]
  );
  for (const attempt of modelSources) {
    const phase = phaseForAttempt(attempt.kind.value);
    if (phase !== null) {
      durations[phase].push(attemptDuration(attempt));
    }
  }
  for (const phase of DURATION_ORDER) {
    const kind = modelKinds.find((item) => phaseForAttempt(item) === phase);
    const activeApplies =
      attemptCoverage.activeKind === null ||
      phaseForAttempt(attemptCoverage.activeKind) === phase;
    metrics.durationsMs[phase] = metricFromEvidence(durations[phase], {
      invalidCount:
        attemptCoverage.genericInvalidCount +
        invalidKindCount +
        (activeApplies ? attemptCoverage.activeInvalidCount : 0),
      unknownCount:
        attemptCoverage.genericUnknownCount +
        (kind === undefined ? 0 : counterGapsByKind[kind]) +
        unknownKindCount +
        (activeApplies ? attemptCoverage.activeUnknownCount : 0)
    });
  }
  metrics.durationsMs.verification = metricFromEvidence(
    verification.metricSources.map((item) => item.durationMs),
    {
      unknownCount:
        verification.historicalUnknownCount +
        verification.metricActiveCount +
        verification.activeUnknownCount,
      invalidCount:
        verification.historicalInvalidCount +
        verification.countInvalidCount +
        verification.activeInvalidCount
    }
  );

  const sessionValues = modelSources
    .map((item) => item.sessionMode.value)
    .filter((item): item is SessionMode => item !== null);
  const sessionCounts = countValues(sessionValues, SESSION_ORDER);
  const invalidSessionCount = modelSources.filter(
    (item) => item.sessionMode.evidence === "invalid"
  ).length;
  const unknownSessionCount = modelSources.filter(
    (item) =>
      item.sessionMode.value === null && item.sessionMode.evidence !== "invalid"
  ).length;
  for (const mode of SESSION_ORDER) {
    metrics.sessions[mode] = countedMetric(
      sessionCounts[mode],
      attemptCoverage.genericInvalidCount +
        attemptCoverage.activeInvalidCount +
        invalidSessionCount,
      attemptCoverage.genericUnknownCount +
        counterGapCount +
        attemptCoverage.activeUnknownCount +
        unknownSessionCount
    );
  }

  const reviewAttempts = modelSources.filter(
    (item) => item.kind.value === "review"
  );
  const reviewModeValues = reviewAttempts
    .map((item) => item.reviewMode.value)
    .filter((item): item is ReviewMode => item !== null);
  const reviewModeCounts = countValues(reviewModeValues, REVIEW_MODE_ORDER);
  const invalidReviewModeCount = reviewAttempts.filter(
    (item) => item.reviewMode.evidence === "invalid"
  ).length;
  const unknownReviewModeCount = reviewAttempts.filter(
    (item) =>
      item.reviewMode.value === null &&
      item.reviewMode.evidence !== "invalid" &&
      item.reviewMode.evidence !== "not_applicable"
  ).length;
  const activeMayBeReview =
    attemptCoverage.activeKind === "review" ||
    attemptCoverage.activeKind === null;
  for (const mode of REVIEW_MODE_ORDER) {
    metrics.reviews.attempts[mode] = countedMetric(
      reviewModeCounts[mode],
      attemptCoverage.genericInvalidCount +
        invalidKindCount +
        invalidReviewModeCount +
        (activeMayBeReview ? attemptCoverage.activeInvalidCount : 0),
      attemptCoverage.genericUnknownCount +
        counterGapsByKind.review +
        unknownKindCount +
        unknownReviewModeCount +
        (activeMayBeReview ? attemptCoverage.activeUnknownCount : 0)
    );
  }
  const rotationValues = reviewAttempts
    .map((item) => item.rotationReason.value)
    .filter((item): item is EvaluationRotationReason => item !== null);
  const rotationCounts = countValues(
    rotationValues,
    EVALUATION_ROTATION_REASON_ORDER
  );
  const invalidRotationCount = reviewAttempts.filter(
    (item) =>
      item.rotationReason.value === null &&
      item.rotationReason.evidence === "invalid"
  ).length;
  const unknownRotationCount = reviewAttempts.filter(
    (item) =>
      item.rotationReason.value === null &&
      item.rotationReason.evidence !== "invalid" &&
      item.rotationReason.evidence !== "not_applicable"
  ).length;
  const rotationInvalidCount =
    attemptCoverage.genericInvalidCount +
    invalidKindCount +
    invalidRotationCount +
    (activeMayBeReview ? attemptCoverage.activeInvalidCount : 0);
  const rotationUnknownCount =
    attemptCoverage.genericUnknownCount +
    counterGapsByKind.review +
    unknownKindCount +
    unknownRotationCount +
    (activeMayBeReview ? attemptCoverage.activeUnknownCount : 0);
  for (const reason of EVALUATION_ROTATION_REASON_ORDER) {
    metrics.reviews.rotations.byReason[reason] = countedMetric(
      reason === "primary-review" ? 0 : rotationCounts[reason],
      rotationInvalidCount,
      rotationUnknownCount
    );
  }
  metrics.reviews.rotations.total = countedMetric(
    rotationValues.filter((reason) => reason !== "primary-review").length,
    rotationInvalidCount,
    rotationUnknownCount
  );

  const verdictValues = reviews.reviews
    .map((item) => item.verdict.value)
    .filter((item): item is ReviewVerdict => item !== null);
  const verdictCounts = countValues(verdictValues, REVIEW_VERDICT_ORDER);
  const invalidVerdictCount = reviews.reviews.filter(
    (item) => item.verdict.evidence === "invalid"
  ).length;
  const unknownVerdictCount = reviews.reviews.filter(
    (item) => item.verdict.value === null && item.verdict.evidence !== "invalid"
  ).length;
  for (const verdict of REVIEW_VERDICT_ORDER) {
    metrics.reviews.verdicts[verdict] = countedMetric(
      verdictCounts[verdict],
      reviews.invalidCount + invalidVerdictCount,
      reviews.unknownCount + unknownVerdictCount
    );
  }
  for (const severity of FINDING_SEVERITY_ORDER) {
    metrics.reviews.findings[severity] = countedMetric(
      reviews.reviews.reduce(
        (total, item) => total + item.findings[severity],
        0
      ),
      reviews.invalidCount,
      reviews.unknownCount
    );
  }

  const invalidTriageCount = allIssues.filter(
    (item) =>
      item.code === "STATE_FIELD_INVALID" &&
      item.field?.startsWith("triageHistory") === true
  ).length;
  for (const disposition of TRIAGE_ORDER) {
    metrics.triage[disposition] = state.triageIsCumulative
      ? invalidTriageCount === 0
        ? exactMetric(state.triage[disposition], state.triage[disposition])
        : partialMetric(
            state.triage[disposition],
            state.triage[disposition],
            0,
            invalidTriageCount
          )
      : partialMetric(
          state.triage[disposition],
          state.triage[disposition],
          1,
          0
        );
  }

  const retryValues = events.events
    .map((event): EvaluationRetryKind | null => {
      switch (event.type) {
        case "attempt.retry_requested":
        case "verification.retry_requested":
          return "attempt";
        case "run.start_retry_requested":
          return "start_checks";
        case "review.checks_retry_requested":
          return "review_checks";
        default:
          return null;
      }
    })
    .filter((item): item is EvaluationRetryKind => item !== null);
  const retryCounts = countValues(retryValues, RETRY_ORDER);
  for (const kind of RETRY_ORDER) {
    metrics.retries.byKind[kind] = countedMetric(
      retryCounts[kind],
      events.invalidCount,
      events.unknownCount
    );
  }
  metrics.retries.total = countedMetric(
    retryValues.length,
    events.invalidCount,
    events.unknownCount
  );

  const failureCounts = recordOf(EVALUATION_FAILURE_ORDER, () => 0);
  addFailure(
    failureCounts,
    "model_attempt",
    modelSources.filter((item) => item.status.value === "failed").length
  );
  addFailure(
    failureCounts,
    "interrupted_attempt",
    modelSources.filter((item) => item.status.value === "started").length +
      verification.metricSources.filter(
        (item) => item.status.value === "interrupted"
      ).length
  );
  addFailure(
    failureCounts,
    "verification_command",
    verification.metricSources.filter(
      (item) =>
        item.status.value === "failed" ||
        (item.status.value === "completed" &&
          item.exitCode.value !== null &&
          item.exitCode.value !== 0)
    ).length
  );
  addFailure(failureCounts, "review_verdict_blocked", verdictCounts.blocked);
  addFailure(
    failureCounts,
    "startup_check",
    events.events.filter((item) => item.type === "run.start_failed").length
  );
  addFailure(
    failureCounts,
    "review_check",
    events.events.filter((item) => item.type === "review.checks_failed").length
  );
  addFailure(
    failureCounts,
    "malformed_persisted_evidence",
    allIssues.filter((item) => item.severity === "error").length
  );
  const hasKnownBlockedFailure = Object.entries(failureCounts).some(
    ([category, count]) => category !== "blocked_other" && count > 0
  );
  if (state.status.value === "blocked" && !hasKnownBlockedFailure) {
    addFailure(failureCounts, "blocked_other");
  }
  for (const category of EVALUATION_FAILURE_ORDER) {
    const attemptOutcomeCoverage =
      category === "model_attempt" || category === "interrupted_attempt";
    const verificationOutcomeCoverage = category === "verification_command";
    const verdictCoverage = category === "review_verdict_blocked";
    const eventCoverage =
      category === "startup_check" || category === "review_check";
    metrics.failures[category] = countedMetric(
      failureCounts[category],
      (attemptOutcomeCoverage
        ? attemptCoverage.genericInvalidCount +
          attemptCoverage.activeInvalidCount +
          invalidStatusCount
        : 0) +
        (verificationOutcomeCoverage
          ? invalidTerminalVerificationOutcomes
          : 0) +
        (verdictCoverage ? reviews.invalidCount + invalidVerdictCount : 0) +
        (eventCoverage ? events.invalidCount : 0),
      (attemptOutcomeCoverage
        ? attemptCoverage.genericUnknownCount +
          counterGapCount +
          attemptCoverage.activeUnknownCount +
          unknownStatusCount
        : 0) +
        (verificationOutcomeCoverage
          ? unknownTerminalVerificationOutcomes
          : 0) +
        (verdictCoverage ? reviews.unknownCount + unknownVerdictCount : 0) +
        (eventCoverage ? events.unknownCount : 0)
    );
  }

  const retainedSuccessfulVerification = verification.sources.filter(
    (item) => item.exitCode.value === 0
  ).length;
  const retainedFailedVerification = verification.sources.filter(
    (item) =>
      item.status.value === "failed" ||
      item.status.value === "interrupted" ||
      (item.exitCode.value !== null && item.exitCode.value !== 0)
  ).length;
  const retainedUnknownExitCount = verification.sources.filter(
    (item) =>
      item.status.value === "completed" &&
      item.exitCode.value === null &&
      item.exitCode.evidence !== "invalid"
  ).length;
  const retainedInvalidExitCount = verification.sources.filter(
    (item) =>
      item.status.value === "completed" && item.exitCode.evidence === "invalid"
  ).length;
  const structurallyInvalidVerificationCount =
    verification.retainedSources.filter((item) => !item.validStructure).length;
  metrics.verification.retained = countedMetric(
    verification.retainedSources.length - structurallyInvalidVerificationCount,
    structurallyInvalidVerificationCount + verification.listInvalidCount,
    verification.listUnknownCount
  );
  metrics.verification.completed = countedMetric(
    retainedSuccessfulVerification,
    retainedInvalidExitCount + verification.historicalInvalidCount,
    retainedUnknownExitCount + verification.historicalUnknownCount
  );
  metrics.verification.failed = countedMetric(
    retainedFailedVerification,
    retainedInvalidExitCount + verification.historicalInvalidCount,
    retainedUnknownExitCount + verification.historicalUnknownCount
  );

  metrics.usage.inputTokens = metricFromEvidence(
    modelSources.map((item) => item.usage.inputTokens),
    {
      invalidCount:
        attemptCoverage.genericInvalidCount +
        attemptCoverage.activeInvalidCount,
      unknownCount:
        attemptCoverage.genericUnknownCount +
        counterGapCount +
        attemptCoverage.activeUnknownCount
    }
  );
  metrics.usage.cachedInputTokens = metricFromEvidence(
    modelSources.map((item) => item.usage.cachedInputTokens),
    {
      invalidCount:
        attemptCoverage.genericInvalidCount +
        attemptCoverage.activeInvalidCount,
      unknownCount:
        attemptCoverage.genericUnknownCount +
        counterGapCount +
        attemptCoverage.activeUnknownCount
    }
  );
  metrics.usage.outputTokens = metricFromEvidence(
    modelSources.map((item) => item.usage.outputTokens),
    {
      invalidCount:
        attemptCoverage.genericInvalidCount +
        attemptCoverage.activeInvalidCount,
      unknownCount:
        attemptCoverage.genericUnknownCount +
        counterGapCount +
        attemptCoverage.activeUnknownCount
    }
  );
  metrics.usage.costUsd = metricFromEvidence(
    modelSources.map((item) => item.usage.costUsd),
    {
      emptyUnavailable: true,
      invalidCount:
        attemptCoverage.genericInvalidCount +
        attemptCoverage.activeInvalidCount,
      unknownCount:
        attemptCoverage.genericUnknownCount +
        counterGapCount +
        attemptCoverage.activeUnknownCount
    }
  );

  metrics.fixCycles =
    state.fixCycle.value === null
      ? partialMetric(
          0,
          0,
          state.fixCycle.evidence === "invalid" ? 0 : 1,
          state.fixCycle.evidence === "invalid" ? 1 : 0
        )
      : exactMetric(state.fixCycle.value, 1);

  const checks: [EvidenceValue<number>, NumericMetric, string][] = [
    [
      state.metrics.usage.inputTokens,
      metrics.usage.inputTokens,
      "metrics.usage.inputTokens"
    ],
    [
      state.metrics.usage.cachedInputTokens,
      metrics.usage.cachedInputTokens,
      "metrics.usage.cachedInputTokens"
    ],
    [
      state.metrics.usage.outputTokens,
      metrics.usage.outputTokens,
      "metrics.usage.outputTokens"
    ],
    [
      state.metrics.usage.costUsd,
      metrics.usage.costUsd,
      "metrics.usage.costUsd"
    ],
    [
      state.metrics.sessions.fresh,
      metrics.sessions.fresh,
      "metrics.sessions.fresh"
    ],
    [
      state.metrics.sessions.resumed,
      metrics.sessions.resumed,
      "metrics.sessions.resumed"
    ],
    [
      state.metrics.reviews.full,
      metrics.reviews.attempts.full,
      "metrics.reviews.full"
    ],
    [
      state.metrics.reviews.delta,
      metrics.reviews.attempts.delta,
      "metrics.reviews.delta"
    ],
    [
      state.metrics.reviews.rotations,
      metrics.reviews.rotations.total,
      "metrics.reviews.rotations"
    ],
    [
      state.metrics.reviewFindingCount,
      combineMetrics(
        FINDING_SEVERITY_ORDER.map(
          (severity) => metrics.reviews.findings[severity]
        )
      ),
      "metrics.reviewFindingCount"
    ],
    [
      state.metrics.triage.accepted,
      metrics.triage.accepted,
      "metrics.triage.accepted"
    ],
    [
      state.metrics.triage.rejected,
      metrics.triage.rejected,
      "metrics.triage.rejected"
    ],
    [
      state.metrics.triage.deferred,
      metrics.triage.deferred,
      "metrics.triage.deferred"
    ]
  ];
  for (const [stateMetric, leafMetric, field] of checks) {
    if (
      stateMetric.value !== null &&
      leafMetric.value !== null &&
      stateMetric.value !== leafMetric.value
    ) {
      addIssue(directIssue(null, "state", "METRIC_MISMATCH", field));
    }
  }
  return metrics;
}

function combineMetricSets(
  metricSets: readonly EvaluationMetricSet[]
): EvaluationMetricSet {
  if (metricSets.length === 0) {
    return emptyMetricSet();
  }
  const combined = emptyMetricSet();
  combined.attempts.total = combineMetrics(
    metricSets.map((item) => item.attempts.total)
  );
  for (const kind of EVALUATION_ATTEMPT_KIND_ORDER) {
    combined.attempts.byKind[kind] = combineMetrics(
      metricSets.map((item) => item.attempts.byKind[kind])
    );
  }
  for (const outcome of EVALUATION_ATTEMPT_OUTCOME_ORDER) {
    combined.attempts.byOutcome[outcome] = combineMetrics(
      metricSets.map((item) => item.attempts.byOutcome[outcome])
    );
  }
  for (const phase of DURATION_ORDER) {
    combined.durationsMs[phase] = combineMetrics(
      metricSets.map((item) => item.durationsMs[phase])
    );
  }
  for (const mode of SESSION_ORDER) {
    combined.sessions[mode] = combineMetrics(
      metricSets.map((item) => item.sessions[mode])
    );
  }
  for (const mode of REVIEW_MODE_ORDER) {
    combined.reviews.attempts[mode] = combineMetrics(
      metricSets.map((item) => item.reviews.attempts[mode])
    );
  }
  combined.reviews.rotations.total = combineMetrics(
    metricSets.map((item) => item.reviews.rotations.total)
  );
  for (const reason of EVALUATION_ROTATION_REASON_ORDER) {
    combined.reviews.rotations.byReason[reason] = combineMetrics(
      metricSets.map((item) => item.reviews.rotations.byReason[reason])
    );
  }
  for (const verdict of REVIEW_VERDICT_ORDER) {
    combined.reviews.verdicts[verdict] = combineMetrics(
      metricSets.map((item) => item.reviews.verdicts[verdict])
    );
  }
  for (const severity of FINDING_SEVERITY_ORDER) {
    combined.reviews.findings[severity] = combineMetrics(
      metricSets.map((item) => item.reviews.findings[severity])
    );
  }
  for (const disposition of TRIAGE_ORDER) {
    combined.triage[disposition] = combineMetrics(
      metricSets.map((item) => item.triage[disposition])
    );
  }
  combined.retries.total = combineMetrics(
    metricSets.map((item) => item.retries.total)
  );
  for (const kind of RETRY_ORDER) {
    combined.retries.byKind[kind] = combineMetrics(
      metricSets.map((item) => item.retries.byKind[kind])
    );
  }
  for (const category of EVALUATION_FAILURE_ORDER) {
    combined.failures[category] = combineMetrics(
      metricSets.map((item) => item.failures[category])
    );
  }
  for (const field of ["retained", "completed", "failed"] as const) {
    combined.verification[field] = combineMetrics(
      metricSets.map((item) => item.verification[field])
    );
  }
  for (const field of [
    "inputTokens",
    "cachedInputTokens",
    "outputTokens",
    "costUsd"
  ] as const) {
    combined.usage[field] = combineMetrics(
      metricSets.map((item) => item.usage[field])
    );
  }
  combined.fixCycles = combineMetrics(metricSets.map((item) => item.fixCycles));
  combined.humanMinutes = unavailableMetric();
  combined.falsePositiveRate = unavailableMetric();
  return combined;
}

function breakdown(runs: readonly EvaluationRun[]): EvaluationBreakdown {
  return {
    runCount: runs.length,
    metrics: combineMetricSets(runs.map((run) => run.metrics))
  };
}

export function aggregateEvaluationRuns(
  runs: readonly EvaluationRun[]
): EvaluationAggregates {
  const byWorkflow = recordOf(EVALUATION_WORKFLOW_ORDER, (workflow) =>
    breakdown(
      runs.filter((run) => (run.workflow.value ?? "unknown") === workflow)
    )
  );
  const byStatus = recordOf(EVALUATION_STATUS_ORDER, (status) =>
    breakdown(runs.filter((run) => (run.status.value ?? "unknown") === status))
  );
  const combinations: EvaluationAggregates["byWorkflowAndStatus"] = [];
  for (const workflow of EVALUATION_WORKFLOW_ORDER) {
    for (const status of EVALUATION_STATUS_ORDER) {
      const matching = runs.filter(
        (run) =>
          (run.workflow.value ?? "unknown") === workflow &&
          (run.status.value ?? "unknown") === status
      );
      if (matching.length > 0) {
        combinations.push({ workflow, status, summary: breakdown(matching) });
      }
    }
  }
  return {
    overall: breakdown(runs),
    byWorkflow,
    byStatus,
    byWorkflowAndStatus: combinations
  };
}

function runTerminal(status: EvidenceValue<RunStatus>): EvidenceValue<boolean> {
  return status.value === null
    ? { value: null, evidence: status.evidence }
    : {
        value: status.value === "done" || status.value === "cancelled",
        evidence: "derived"
      };
}

function unreadableRun(
  runKey: string,
  issues: EvaluationIssue[],
  options: EvaluationExportOptions
): EvaluationRun {
  return {
    runKey,
    cohortMembership:
      options.from === null && options.to === null ? "included" : "unresolved",
    completeness: "unreadable",
    source: {
      stateSchemaVersion: null,
      contractVersion: { value: null, evidence: "invalid" }
    },
    workflow: { value: null, evidence: "invalid" },
    status: { value: null, evidence: "invalid" },
    createdAt: { value: null, evidence: "invalid" },
    updatedAt: { value: null, evidence: "invalid" },
    terminal: { value: null, evidence: "invalid" },
    attempts: [],
    verification: [],
    reviews: [],
    metrics: emptyMetricSet(true),
    issueCodes: issueCodes(issues)
  };
}

function dateMembership(
  createdAt: EvidenceValue<string>,
  options: EvaluationExportOptions
): "included" | "excluded" | "unresolved" {
  if (options.from === null && options.to === null) {
    return "included";
  }
  if (createdAt.value === null) {
    return "unresolved";
  }
  const value = Date.parse(createdAt.value);
  if (options.from !== null && value < Date.parse(options.from)) {
    return "excluded";
  }
  if (options.to !== null && value >= Date.parse(options.to)) {
    return "excluded";
  }
  return "included";
}

async function collectCandidate(
  runDirectory: string,
  runKey: string,
  options: EvaluationExportOptions
): Promise<CandidateResult> {
  const stateRead = await readJsonUnknown(
    path.join(runDirectory, "state.json")
  );
  if (stateRead.kind !== "ok") {
    const code =
      stateRead.kind === "missing" ? "STATE_MISSING" : "STATE_MALFORMED";
    const issues = [directIssue(runKey, "state", code)];
    return {
      run: unreadableRun(runKey, issues, options),
      issues,
      excluded: false
    };
  }

  let state: EvaluationStateSource;
  let stateIssues: EvaluationIssue[];
  try {
    const parsed = parseEvaluationStateSource(stateRead.value);
    state = parsed.value;
    stateIssues = parsed.issues.map((item) =>
      evaluationIssue(runKey, null, "state", item)
    );
  } catch (error) {
    const code =
      error instanceof BanzaiError &&
      error.code === "EVALUATION_STATE_SCHEMA_UNSUPPORTED"
        ? "STATE_SCHEMA_UNSUPPORTED"
        : "STATE_MALFORMED";
    const issues = [directIssue(runKey, "state", code)];
    return {
      run: unreadableRun(runKey, issues, options),
      issues,
      excluded: false
    };
  }

  const membership = dateMembership(state.createdAt, options);
  if (membership === "excluded") {
    return { run: null, issues: [], excluded: true };
  }

  const attempts = await collectAttempts(runDirectory, runKey);
  const reviews = await collectReviews(
    runDirectory,
    runKey,
    state.appliedReviewIteration
  );
  const events = await collectEvents(runDirectory, runKey);
  const verificationEvidence = await collectVerification(
    runDirectory,
    runKey,
    state
  );
  const issues = [
    ...stateIssues,
    ...attempts.issues,
    ...reviews.issues,
    ...events.issues,
    ...verificationEvidence.issues
  ];
  if (
    events.events.some(
      (event) => event.type === "plan_task_completion.validation_failed"
    )
  ) {
    issues.push(directIssue(runKey, "event", "PLAN_TASK_COMPLETION_INVALID"));
  }
  const verification = verificationEvidence.collection;
  if (
    verification.historicalUnknownCount > 0 ||
    verification.countInvalidCount > 0
  ) {
    issues.push(
      directIssue(
        runKey,
        "verification",
        "VERIFICATION_HISTORY_INCOMPLETE",
        "metrics.attempts.verification"
      )
    );
  }
  const workflow: EvidenceValue<WorkflowRoute> =
    state.workflow.evidence === "legacy_absent" && state.schemaVersion === 1
      ? { value: "strict", evidence: "inferred_legacy" }
      : state.workflow;
  const addIssue = (item: EvaluationIssue): void => {
    issues.push({ ...item, runKey });
  };
  const metrics = buildMetricSet(
    state,
    attempts,
    verification,
    reviews,
    events,
    issues,
    addIssue
  );
  const sortedIssues = sortIssues(issues);
  const completeness: EvaluationCompleteness =
    sortedIssues.length === 0 ? "complete" : "partial";
  const run: EvaluationRun = {
    runKey,
    cohortMembership: membership === "unresolved" ? "unresolved" : "included",
    completeness,
    source: {
      stateSchemaVersion: state.schemaVersion,
      contractVersion: state.contractVersion
    },
    workflow,
    status: state.status,
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
    terminal: runTerminal(state.status),
    attempts: attempts.attempts,
    verification: verification.entries,
    reviews: reviews.reviews,
    metrics,
    issueCodes: issueCodes(sortedIssues)
  };
  return { run, issues: sortedIssues, excluded: false };
}

async function candidateDirectories(runsDirectory: string): Promise<string[]> {
  const entries = await directoryEntries(runsDirectory);
  if (entries === null) {
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

export async function collectEvaluationExport(
  repoRoot: string,
  options: EvaluationExportOptions
): Promise<EvaluationExport> {
  const runsDirectory = path.join(repoRoot, ".banzai", "runs");
  const candidates = await candidateDirectories(runsDirectory);
  const candidateSet = new Set(candidates);
  for (const runId of options.runIds) {
    if (!candidateSet.has(runId)) {
      throw new BanzaiError(
        "EVAL_RUN_NOT_FOUND",
        "An explicitly selected evaluation run does not exist."
      );
    }
  }
  const selected =
    options.runIds.length === 0
      ? candidates
      : candidates.filter((candidate) => options.runIds.includes(candidate));
  const runKeys = new Map(
    candidates.map(
      (candidate, index) => [candidate, opaqueKey("run", index)] as const
    )
  );
  const runs: EvaluationRun[] = [];
  const issues: EvaluationIssue[] = [];
  let excludedRunCount = candidates.length - selected.length;
  for (const candidate of selected) {
    const runKey = runKeys.get(candidate);
    if (runKey === undefined) {
      continue;
    }
    const result = await collectCandidate(
      path.join(runsDirectory, candidate),
      runKey,
      options
    );
    if (result.excluded) {
      excludedRunCount += 1;
      continue;
    }
    if (result.run !== null) {
      runs.push(result.run);
    }
    issues.push(...result.issues);
  }
  runs.sort((left, right) => left.runKey.localeCompare(right.runKey));
  const sortedIssues = sortIssues(issues);
  return {
    schema: EVALUATION_EXPORT_SCHEMA,
    schemaVersion: EVALUATION_EXPORT_SCHEMA_VERSION,
    cohort: {
      from: options.from,
      to: options.to,
      explicitRuns: options.runIds.length > 0,
      selectedRunCount: options.runIds.length,
      candidateRunCount: candidates.length,
      includedRunCount: runs.filter(
        (run) => run.cohortMembership === "included"
      ).length,
      excludedRunCount,
      unresolvedRunCount: runs.filter(
        (run) => run.cohortMembership === "unresolved"
      ).length
    },
    runs,
    aggregates: aggregateEvaluationRuns(
      runs.filter((run) => run.cohortMembership === "included")
    ),
    issues: sortedIssues
  };
}
