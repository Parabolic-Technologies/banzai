import type {
  CancellationAnchor,
  RunState,
  RunStatus,
  AttemptReference,
  NumericMetric,
  ModelFailureCause
} from "./types.js";

export const CANCELLATION_REASONS = [
  "intent_changed",
  "adr_rejected",
  "plan_unsuitable",
  "workflow_unsuitable",
  "execution_blocked",
  "superseded",
  "other",
  "unspecified"
] as const;
export type CancellationReason = (typeof CANCELLATION_REASONS)[number];
export const CANCELLATION_SCHEMA = "banzai-cancellation-observation/v1";
export const CANCELLATION_REPORT_SCHEMA = "banzai-cancellation-report/v1";
export const CANCELLATION_AVAILABILITIES = [
  "available",
  "legacy_absent",
  "missing",
  "malformed",
  "unsupported",
  "conflicting",
  "unanswered",
  "interrupted",
  "unavailable"
] as const;
export type ObservationAvailability =
  (typeof CANCELLATION_AVAILABILITIES)[number];
export type ContextAvailability =
  | "available"
  | "not_applicable"
  | "missing"
  | "legacy_absent"
  | "malformed"
  | "conflicting"
  | "unsupported"
  | "unavailable";
export const CANCELLATION_STATUSES: readonly RunStatus[] = [
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
  "cancelled"
];
const SOURCES = [
  "state.status",
  "state.blockedFrom",
  "state.workflowSelection",
  "state.activeAttempt",
  "state.pendingHumanDecision",
  "state.latestReview",
  "state.gate",
  "verification.attempt",
  "event.approval.adr",
  "none"
] as const;
export interface CancellationValue<T> {
  value: T | null;
  availability: ContextAvailability;
  source: (typeof SOURCES)[number];
}
export type CancellationGate =
  | "adr_approval"
  | "plan_approval"
  | "decision_consultation"
  | "escalation"
  | "triage"
  | "recovery_wait";
export type CancellationAttempt =
  | { kind: "model"; id: string; attemptKind: AttemptReference["kind"] }
  | { kind: "verification"; id: string; sequence: number };
export type CancellationDecision =
  | {
      kind: "consultation";
      requestId: string;
      roundId: string;
      relationship: "pending_at_cancel";
    }
  | {
      kind: "review";
      iteration: number;
      relationship: "pending_at_cancel" | "prior_decision";
    }
  | {
      kind: "adr";
      eventOrdinal: number;
      eventAt: string;
      relationship: "prior_decision";
    };
export interface CancellationContext {
  status: CancellationValue<RunStatus>;
  blockedFrom: CancellationValue<RunStatus>;
  gate: CancellationValue<CancellationGate>;
  workflow: CancellationValue<
    "strict" | "feature" | "quick-fix" | "unselected"
  >;
  attempt: CancellationValue<CancellationAttempt[]>;
  decision: CancellationValue<CancellationDecision>;
}
export interface CancellationResponse {
  state: "pending" | "reported" | "skipped" | "omitted" | "interrupted";
  reason: CancellationReason | null;
  provenance:
    | "operator_reported"
    | "operator_skipped"
    | "cli_omitted"
    | "prompt_interrupted"
    | null;
  channel: "cli" | "interactive";
  recordedAt: string | null;
}
export interface CancellationObservation {
  schema: typeof CANCELLATION_SCHEMA;
  schemaVersion: 1;
  cancellationId: string;
  runId: string;
  cancelledAt: string;
  context: CancellationContext;
  response: CancellationResponse;
}
export interface CancellationResponseEvent {
  schema: typeof CANCELLATION_SCHEMA;
  schemaVersion: 1;
  cancellationId: string;
  runId: string;
  response: CancellationResponse;
}
export type CancellationAnswer =
  | { state: "reported"; reason: CancellationReason }
  | { state: "skipped" | "interrupted" };
export interface CancellationReceipt {
  readonly kind: "cancellation-first-response";
}
export interface CancelRunInput {
  expectedRunId?: string;
  channel?: "cli" | "interactive";
  reason?: CancellationReason;
}
export type StopRequest = "sent" | "no_active_process" | "not_found" | "failed";
export interface CancellationResult {
  outcome:
    | "cancelled"
    | "already_cancelled"
    | "already_done"
    | "active_run_changed"
    | "unconfirmed";
  runId: string;
  state: RunState | null;
  stopRequest: StopRequest;
  observation: "available" | "unsaved" | "not_applicable";
  receipt: CancellationReceipt | null;
}
export interface CancellationResponseResult {
  outcome: "saved" | "conflict" | "unavailable";
  response: CancellationResponse | null;
}
export interface CancellationEventInput {
  at: string;
  type: string;
  runId: string;
  details: Record<string, unknown>;
}
export interface CancellationResolution {
  availability: ObservationAvailability;
  observation: CancellationObservation | null;
  response: CancellationResponse | null;
  cancelledAt: string | null;
  issues: string[];
}

export interface CancellationRatio {
  numerator: number;
  denominator: number;
  value: number | null;
}
export interface CancellationReportValue<T> {
  value: T | null;
  availability: ContextAvailability;
}
export interface CancellationTechnical {
  evidenceKey: string;
  kind: "model" | "verification" | "decision";
  relationship: "referenced_at_cancel" | "completed_before_cancel";
  availability: ContextAvailability;
  attemptKind: AttemptReference["kind"] | "verification" | null;
  attemptStatus: "started" | "completed" | "failed" | "interrupted" | null;
  failureCause: ModelFailureCause | null;
  failureCode: string | null;
  verificationExitCode: number | null;
  signalPresent: boolean | null;
}
export const CANCELLATION_RESOURCE_FIELDS = [
  "modelAttempts",
  "verificationAttempts",
  "modelDurationMs",
  "verificationDurationMs",
  "inputTokens",
  "cachedInputTokens",
  "outputTokens",
  "reportedCostUsd"
] as const;
export type CancellationResource =
  (typeof CANCELLATION_RESOURCE_FIELDS)[number];
export type CancellationInventory = "complete" | "incomplete" | "unavailable";
export type CancellationWork = Record<CancellationResource, NumericMetric> & {
  runElapsedMs: CancellationReportValue<number> & {
    basis: "utc_wall";
    continuity: "unverified";
  };
  activeTimeEstimate: {
    minutes: number | null;
    basis: "estimated";
    scope: "single_engineer_unverified";
    asOf: string | null;
    availability: ContextAvailability;
  };
  inventory: {
    model: CancellationInventory;
    verification: CancellationInventory;
  };
};
export type CancellationPublicContext = Omit<
  CancellationContext,
  "attempt" | "decision"
> & {
  attempt: CancellationValue<string[]>;
  decision: CancellationValue<string[]>;
};
export interface CancellationReportRun {
  runKey: string;
  membership: "included" | "excluded" | "unresolved";
  lifecycle: CancellationReportValue<RunStatus>;
  createdAt: CancellationReportValue<string>;
  cancelledAt: CancellationReportValue<string>;
  observation: {
    availability: ObservationAvailability;
    reason: CancellationReason | null;
    provenance: CancellationResponse["provenance"];
    channel: CancellationResponse["channel"] | null;
    responseState: CancellationResponse["state"] | null;
    recordedAt: string | null;
  };
  context: CancellationPublicContext;
  technical: CancellationTechnical[];
  work: CancellationWork;
  continuation: {
    intent: "reported_superseded" | "not_reported";
    confirmation: "unavailable";
    runKeys: string[];
    source: "no_supported_task_link_source";
  };
  issueCodes: string[];
}
export interface CancellationRunCoverage {
  exact: number;
  partial: number;
  unavailable: number;
}
export type CancellationWorkSummary = Record<
  CancellationResource,
  NumericMetric & { runCoverage: CancellationRunCoverage }
> & {
  runElapsedMs: CancellationRunCoverage;
  activeTimeEstimate: CancellationRunCoverage;
};
export interface CancellationReport {
  schema: typeof CANCELLATION_REPORT_SCHEMA;
  schemaVersion: 1;
  cohort: {
    from: string | null;
    to: string | null;
    dateBasis: "run_created_at";
    explicitRuns: boolean;
    selectedRunCount: number;
    candidateRunCount: number;
    includedRunCount: number;
    excludedRunCount: number;
    unresolvedRunCount: number;
  };
  runs: CancellationReportRun[];
  summary: {
    cancelledRunCount: number;
    nonCancelledRunCount: number;
    unknownLifecycleRunCount: number;
    reasons: {
      reason: CancellationReason;
      count: number;
      ratio: CancellationRatio;
    }[];
    reasonCoverage: CancellationRatio;
    responseCoverage: CancellationRatio;
    observationAvailability: {
      availability: ObservationAvailability;
      count: number;
      ratio: CancellationRatio;
    }[];
    workflow: {
      workflow: "strict" | "feature" | "quick-fix" | "unselected" | "unknown";
      count: number;
      ratio: CancellationRatio;
    }[];
    phaseGate: {
      status: RunStatus | null;
      blockedFrom: RunStatus | null;
      gate: CancellationGate | null;
      count: number;
      ratio: CancellationRatio;
    }[];
    work: CancellationWorkSummary;
  };
  issues: {
    runKey: string | null;
    source:
      | "state"
      | "events"
      | "model"
      | "verification"
      | "human_time"
      | "inventory";
    field: string;
    code: string;
  }[];
}

export function cancellationRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function closed(
  value: unknown,
  keys: readonly string[]
): Record<string, unknown> {
  const record = cancellationRecord(value);
  if (
    Object.keys(record).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(record, key))
  ) {
    throw new Error("Invalid cancellation evidence.");
  }
  return record;
}
function member<T extends string>(
  value: unknown,
  choices: readonly T[]
): value is T {
  return typeof value === "string" && choices.includes(value as T);
}
export function isCancellationReason(
  value: unknown
): value is CancellationReason {
  return member(value, CANCELLATION_REASONS);
}
export function cancellationId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 300 &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(value) &&
    value !== "." &&
    value !== ".."
  );
}
export function cancellationInstant(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}
export function decodeCancellationAnchor(value: unknown): CancellationAnchor {
  const r = closed(value, ["schemaVersion", "id", "at"]);
  if (
    r.schemaVersion !== 1 ||
    typeof r.id !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
      r.id
    ) ||
    !cancellationInstant(r.at)
  )
    throw new Error("Invalid cancellation anchor.");
  return { schemaVersion: 1, id: r.id, at: r.at };
}
export function cancellationValue<T>(
  value: T | null,
  source: CancellationValue<T>["source"] = "none",
  availability: ContextAvailability = value === null
    ? "unavailable"
    : "available"
): CancellationValue<Exclude<T, null>> {
  return { value: value as Exclude<T, null> | null, availability, source };
}
export function emptyCancellationContext(
  availability: ContextAvailability = "unavailable"
): CancellationContext {
  return {
    status: cancellationValue(null, "none", availability),
    blockedFrom: cancellationValue(null, "none", availability),
    gate: cancellationValue(null, "none", availability),
    workflow: cancellationValue(null, "none", availability),
    attempt: cancellationValue(null, "none", availability),
    decision: cancellationValue(null, "none", availability)
  };
}
export function captureCancellationContext(raw: unknown): CancellationContext {
  const r = cancellationRecord(raw);
  const context = emptyCancellationContext();
  if (
    member(r.status, CANCELLATION_STATUSES) &&
    !["done", "cancelled"].includes(r.status)
  ) {
    context.status = cancellationValue(r.status, "state.status");
  }
  context.blockedFrom =
    r.status !== "blocked" || r.blockedFrom === null
      ? cancellationValue(null, "state.blockedFrom", "not_applicable")
      : member(r.blockedFrom, CANCELLATION_STATUSES) &&
          !["blocked", "done", "cancelled"].includes(r.blockedFrom)
        ? cancellationValue(r.blockedFrom, "state.blockedFrom")
        : cancellationValue(
            null,
            "state.blockedFrom",
            r.blockedFrom === undefined ? "missing" : "malformed"
          );
  const selection = cancellationRecord(r.workflowSelection);
  context.workflow = !Object.hasOwn(r, "workflowSelection")
    ? cancellationValue(null, "state.workflowSelection", "legacy_absent")
    : r.workflowSelection === null
      ? cancellationValue("unselected", "state.workflowSelection")
      : member(selection.workflow, ["strict", "feature", "quick-fix"] as const)
        ? cancellationValue(selection.workflow, "state.workflowSelection")
        : cancellationValue(null, "state.workflowSelection", "malformed");
  const pending = cancellationRecord(r.pendingHumanDecision);
  const recovery = cancellationRecord(r.recovery);
  const recoveryPresent =
    cancellationId(recovery.authorizationId) &&
    cancellationId(recovery.sourceAttemptId);
  const gate: CancellationGate | null =
    r.status === "needs_adr_approval"
      ? "adr_approval"
      : r.status === "needs_plan_approval"
        ? "plan_approval"
        : r.status === "needs_triage"
          ? "triage"
          : r.status === "needs_human_decision"
            ? pending.kind === "decision_consultation"
              ? "decision_consultation"
              : pending.kind === "escalation"
                ? "escalation"
                : null
            : r.status === "blocked" && recoveryPresent
              ? "recovery_wait"
              : null;
  context.gate = cancellationValue(
    gate,
    "state.gate",
    gate !== null
      ? "available"
      : r.status === "needs_human_decision"
        ? r.pendingHumanDecision == null
          ? "missing"
          : "malformed"
        : r.status === "blocked" && r.recovery != null
          ? "malformed"
          : "not_applicable"
  );
  const attempt = cancellationRecord(r.activeAttempt);
  if (
    cancellationId(attempt.id) &&
    member(attempt.kind, [
      "selection",
      "plan",
      "implementation",
      "fix",
      "review"
    ] as const)
  ) {
    context.attempt = cancellationValue(
      [{ kind: "model", id: attempt.id, attemptKind: attempt.kind }],
      "state.activeAttempt"
    );
  } else
    context.attempt = cancellationValue(
      null,
      "state.activeAttempt",
      r.activeAttempt === null ? "not_applicable" : "missing"
    );
  const request = cancellationRecord(pending.request);
  if (
    r.status === "needs_human_decision" &&
    pending.kind === "decision_consultation" &&
    cancellationId(request.requestId) &&
    cancellationId(request.roundId)
  ) {
    context.decision = cancellationValue(
      {
        kind: "consultation",
        requestId: request.requestId,
        roundId: request.roundId,
        relationship: "pending_at_cancel"
      },
      "state.pendingHumanDecision"
    );
  } else if (
    r.status === "needs_triage" &&
    Number.isSafeInteger(r.reviewIteration) &&
    (r.reviewIteration as number) > 0 &&
    r.latestReview != null
  ) {
    context.decision = cancellationValue(
      {
        kind: "review",
        iteration: r.reviewIteration as number,
        relationship: "pending_at_cancel"
      },
      "state.latestReview"
    );
  } else
    context.decision = cancellationValue(
      null,
      "none",
      gate === null ? "not_applicable" : "missing"
    );
  return context;
}
export function decodeCancellationResponse(
  value: unknown
): CancellationResponse {
  const r = closed(value, [
    "state",
    "reason",
    "provenance",
    "channel",
    "recordedAt"
  ]);
  if (!member(r.channel, ["cli", "interactive"] as const))
    throw new Error("Invalid response channel.");
  const valid =
    r.state === "pending"
      ? r.reason === null &&
        r.provenance === null &&
        r.channel === "interactive" &&
        r.recordedAt === null
      : cancellationInstant(r.recordedAt) &&
        ((r.state === "reported" &&
          isCancellationReason(r.reason) &&
          r.provenance === "operator_reported") ||
          (r.state === "skipped" &&
            r.reason === "unspecified" &&
            r.provenance === "operator_skipped" &&
            r.channel === "interactive") ||
          (r.state === "omitted" &&
            r.reason === "unspecified" &&
            r.provenance === "cli_omitted" &&
            r.channel === "cli") ||
          (r.state === "interrupted" &&
            r.reason === null &&
            r.provenance === "prompt_interrupted" &&
            r.channel === "interactive"));
  if (!valid) throw new Error("Invalid cancellation response.");
  return {
    state: r.state as CancellationResponse["state"],
    reason: r.reason as CancellationReason | null,
    provenance: r.provenance as CancellationResponse["provenance"],
    channel: r.channel,
    recordedAt: r.recordedAt as string | null
  };
}
export function cancellationResponse(
  answer: CancellationAnswer,
  at: string
): CancellationResponse {
  return decodeCancellationResponse({
    state: answer.state,
    reason:
      answer.state === "reported"
        ? answer.reason
        : answer.state === "skipped"
          ? "unspecified"
          : null,
    provenance:
      answer.state === "reported"
        ? "operator_reported"
        : answer.state === "skipped"
          ? "operator_skipped"
          : "prompt_interrupted",
    channel: "interactive",
    recordedAt: at
  });
}
export function initialCancellationResponse(
  input: CancelRunInput,
  at: string
): CancellationResponse {
  return decodeCancellationResponse(
    input.channel === "interactive"
      ? {
          state: "pending",
          reason: null,
          provenance: null,
          channel: "interactive",
          recordedAt: null
        }
      : {
          state: input.reason === undefined ? "omitted" : "reported",
          reason: input.reason ?? "unspecified",
          provenance:
            input.reason === undefined ? "cli_omitted" : "operator_reported",
          channel: "cli",
          recordedAt: at
        }
  );
}
function decodeContext(value: unknown): CancellationContext {
  const r = closed(value, [
    "status",
    "blockedFrom",
    "gate",
    "workflow",
    "attempt",
    "decision"
  ]);
  for (const key of Object.keys(r)) {
    const v = closed(r[key], ["value", "availability", "source"]);
    if (
      !member(v.source, SOURCES) ||
      !member(v.availability, [
        "available",
        "not_applicable",
        "missing",
        "legacy_absent",
        "malformed",
        "conflicting",
        "unsupported",
        "unavailable"
      ])
    )
      throw new Error("Invalid context provenance.");
    if (v.availability !== "available") {
      if (v.value !== null)
        throw new Error("Unavailable context must be null.");
      continue;
    }
    if (
      (key === "status" || key === "blockedFrom") &&
      (!member(v.value, CANCELLATION_STATUSES) ||
        ["done", "cancelled"].includes(v.value))
    )
      throw new Error("Invalid pre-cancellation state.");
    if (
      key === "workflow" &&
      !member(v.value, ["strict", "feature", "quick-fix", "unselected"])
    )
      throw new Error("Invalid workflow.");
    if (
      key === "gate" &&
      !member(v.value, [
        "adr_approval",
        "plan_approval",
        "decision_consultation",
        "escalation",
        "triage",
        "recovery_wait"
      ])
    )
      throw new Error("Invalid gate.");
    if (key === "attempt") {
      if (!Array.isArray(v.value) || v.value.length < 1 || v.value.length > 2)
        throw new Error("Invalid attempts.");
      const kinds = new Set();
      for (const item of v.value) {
        const a = cancellationRecord(item);
        if (a.kind === "model") {
          closed(a, ["kind", "id", "attemptKind"]);
          if (
            !member(a.attemptKind, [
              "selection",
              "plan",
              "implementation",
              "fix",
              "review"
            ])
          )
            throw new Error("Invalid attempt kind.");
        } else {
          closed(a, ["kind", "id", "sequence"]);
          if (
            a.kind !== "verification" ||
            !Number.isSafeInteger(a.sequence) ||
            (a.sequence as number) < 1
          )
            throw new Error("Invalid verification reference.");
        }
        if (!cancellationId(a.id) || kinds.has(a.kind))
          throw new Error("Invalid attempt reference.");
        kinds.add(a.kind);
      }
    }
    if (key === "decision") {
      const d = cancellationRecord(v.value);
      if (d.kind === "consultation") {
        closed(d, ["kind", "requestId", "roundId", "relationship"]);
        if (
          !cancellationId(d.requestId) ||
          !cancellationId(d.roundId) ||
          d.relationship !== "pending_at_cancel"
        )
          throw new Error("Invalid consultation reference.");
      } else if (d.kind === "adr") {
        closed(d, ["kind", "eventOrdinal", "eventAt", "relationship"]);
        if (
          !Number.isSafeInteger(d.eventOrdinal) ||
          (d.eventOrdinal as number) < 1 ||
          !cancellationInstant(d.eventAt) ||
          d.relationship !== "prior_decision"
        )
          throw new Error("Invalid ADR reference.");
      } else {
        closed(d, ["kind", "iteration", "relationship"]);
        if (
          d.kind !== "review" ||
          !Number.isSafeInteger(d.iteration) ||
          (d.iteration as number) < 1 ||
          !member(d.relationship, ["pending_at_cancel", "prior_decision"])
        )
          throw new Error("Invalid review reference.");
      }
    }
  }
  return structuredClone(r) as unknown as CancellationContext;
}
export function decodeCancellationObservation(
  value: unknown,
  runId: string,
  anchor: CancellationAnchor
): CancellationObservation {
  const r = closed(value, [
    "schema",
    "schemaVersion",
    "cancellationId",
    "runId",
    "cancelledAt",
    "context",
    "response"
  ]);
  if (
    JSON.stringify(value).length > 16384 ||
    r.schema !== CANCELLATION_SCHEMA ||
    r.schemaVersion !== 1 ||
    r.runId !== runId ||
    r.cancellationId !== anchor.id ||
    r.cancelledAt !== anchor.at
  )
    throw new Error("Invalid cancellation binding.");
  const response = decodeCancellationResponse(r.response);
  if (response.recordedAt !== null && response.recordedAt < anchor.at)
    throw new Error("Invalid response timestamp.");
  return {
    schema: CANCELLATION_SCHEMA,
    schemaVersion: 1,
    cancellationId: anchor.id,
    runId,
    cancelledAt: anchor.at,
    context: decodeContext(r.context),
    response
  };
}
export function decodeCancellationResponseEvent(
  value: unknown,
  runId: string,
  anchor: CancellationAnchor
): CancellationResponseEvent {
  const r = closed(value, [
    "schema",
    "schemaVersion",
    "cancellationId",
    "runId",
    "response"
  ]);
  if (
    JSON.stringify(value).length > 16384 ||
    r.schema !== CANCELLATION_SCHEMA ||
    r.schemaVersion !== 1 ||
    r.runId !== runId ||
    r.cancellationId !== anchor.id
  )
    throw new Error("Invalid response binding.");
  const response = decodeCancellationResponse(r.response);
  if (
    response.channel !== "interactive" ||
    !["reported", "skipped", "interrupted"].includes(response.state) ||
    response.recordedAt === null ||
    response.recordedAt < anchor.at
  )
    throw new Error("Invalid first response.");
  return {
    schema: CANCELLATION_SCHEMA,
    schemaVersion: 1,
    cancellationId: anchor.id,
    runId,
    response
  };
}
export function resolveCancellation(
  rawState: unknown,
  runId: string,
  events: readonly CancellationEventInput[],
  evidenceAvailability:
    "available" | "missing" | "malformed" | "unavailable" = "available"
): CancellationResolution {
  const state = cancellationRecord(rawState);
  const result: CancellationResolution = {
    availability: "missing",
    observation: null,
    response: null,
    cancelledAt: null,
    issues: []
  };
  const cancelled = events.filter((e) => e.type === "run.cancelled");
  const responses = events.filter(
    (e) => e.type === "run.cancellation_response"
  );
  let anchor: CancellationAnchor;
  try {
    anchor = decodeCancellationAnchor(state.cancellation);
    result.cancelledAt = anchor.at;
  } catch {
    if (state.cancellation !== undefined) {
      result.availability =
        cancellationRecord(state.cancellation).schemaVersion !== 1
          ? "unsupported"
          : "malformed";
      return result;
    }
    const legacy = cancelled.filter(
      (e) =>
        e.runId === runId &&
        cancellationInstant(e.at) &&
        Object.keys(e.details).length === 0
    );
    if (
      evidenceAvailability === "available" &&
      cancelled.length === 1 &&
      legacy.length === 1 &&
      responses.length === 0
    ) {
      result.availability = "legacy_absent";
      result.cancelledAt = legacy[0]?.at ?? null;
    } else
      result.availability =
        evidenceAvailability === "available"
          ? cancelled.length || responses.length
            ? "conflicting"
            : "missing"
          : evidenceAvailability;
    return result;
  }
  if (state.status !== "cancelled") {
    result.availability = "conflicting";
    return result;
  }
  let observations: CancellationObservation[];
  let answers: CancellationResponse[] = [];
  try {
    observations = cancelled.map((e) => {
      if (e.runId !== runId || !cancellationInstant(e.at) || e.at < anchor.at)
        throw new Error("Invalid event.");
      return decodeCancellationObservation(e.details, runId, anchor);
    });
    answers = responses.map((e) => {
      if (e.runId !== runId || !cancellationInstant(e.at))
        throw new Error("Invalid event.");
      const response = decodeCancellationResponseEvent(
        e.details,
        runId,
        anchor
      ).response;
      if (response.recordedAt === null || e.at < response.recordedAt)
        throw new Error("Invalid response event timestamp.");
      return response;
    });
  } catch {
    result.availability = [...cancelled, ...responses].some(
      (e) =>
        e.details.schemaVersion !== 1 ||
        e.details.schema !== CANCELLATION_SCHEMA
    )
      ? "unsupported"
      : "malformed";
    return result;
  }
  result.observation = observations[0] ?? null;
  if (evidenceAvailability !== "available") {
    result.availability = evidenceAvailability;
    return result;
  }
  if (!result.observation) {
    result.availability = answers.length ? "conflicting" : "missing";
    return result;
  }
  if (
    observations.some(
      (o) => JSON.stringify(o) !== JSON.stringify(result.observation)
    ) ||
    answers.some((a) => JSON.stringify(a) !== JSON.stringify(answers[0])) ||
    (result.observation.response.state !== "pending" && answers.length > 0)
  ) {
    result.availability = "conflicting";
    return result;
  }
  if (observations.length > 1 || answers.length > 1)
    result.issues.push("DUPLICATE_OBSERVATION");
  result.response = answers[0] ?? result.observation.response;
  result.availability =
    result.response.state === "pending"
      ? "unanswered"
      : result.response.state === "interrupted"
        ? "interrupted"
        : "available";
  return result;
}
