import { createHash } from "node:crypto";

export const HUMAN_TIME_LIMITS = {
  bytes: 2 * 1024 * 1024,
  captures: 256,
  observations: 4096,
  effortRevisions: 1024,
  issues: 256,
  eventBytes: 8 * 1024 * 1024,
  eventLines: 10000,
  eventLineBytes: 256 * 1024,
  clockToleranceMs: 1000
} as const;

export const HUMAN_TIME_ISSUES = [
  "MISSING_EVIDENCE",
  "INVALID_EVIDENCE",
  "UNSUPPORTED_VERSION",
  "AMBIGUOUS_ANCHOR",
  "CONFLICTING_ENDPOINTS",
  "CONFLICTING_EFFORT",
  "CAPTURE_GAP",
  "CLOCK_DISCONTINUITY",
  "LIMIT_EXCEEDED",
  "UNSAFE_PATH",
  "STALE_REVISION",
  "WRITE_CONTENDED",
  "WRITE_FAILED"
] as const;
export type HumanTimeIssueCode = (typeof HUMAN_TIME_ISSUES)[number];
export interface HumanTimeIssue {
  code: HumanTimeIssueCode;
  episodeKey: string | null;
}
export type HumanTimeAnchor =
  | { type: "plan_approval"; attemptId: string; bundleDigest: string | null }
  | { type: "adr_approval" | "escalation"; attemptId: string }
  | {
      type: "decision_consultation";
      attemptId: string;
      requestId: string;
      roundId: string;
    }
  | { type: "triage"; attemptId: string; reviewIteration: number }
  | { type: "recovery_wait"; attemptId: string | null; ordinal: number };
export type HumanTimeKind = HumanTimeAnchor["type"];
export const HUMAN_TIME_EVENT_TYPES = [
  "attempt.applied",
  "approval.plan",
  "approval.adr",
  "decision.human",
  "decision.consultation.answered",
  "review.completed",
  "review.triaged",
  "run.cancelled",
  "attempt.started",
  "attempt.recovery_started"
] as const;
export type HumanTimeEventType = (typeof HUMAN_TIME_EVENT_TYPES)[number];
const STATE_FIELDS = [
  "planApproval.approvedAt",
  "adrDecisions.decidedAt",
  "humanDecisions.decidedAt",
  "pendingHumanDecision.requestedAt"
] as const;
export type HumanTimeSource =
  | { kind: "event"; type: HumanTimeEventType; ordinal: number }
  | {
      kind: "state";
      field: (typeof STATE_FIELDS)[number];
      bundleDigest: string | null;
    };
export type HumanTimeEndpoint =
  "opened" | "answered" | "cancelled" | "superseded" | "recovery_ended";
export type HumanTimeContinuity =
  "process_correlated" | "unverified" | "discontinuity";
export interface HumanTimeObservation {
  id: string;
  episodeKey: string;
  kind: HumanTimeKind;
  anchor: HumanTimeAnchor;
  endpoint: HumanTimeEndpoint;
  at: string;
  source: HumanTimeSource;
  capturedAt: string;
  channel: "interactive" | "unattributed";
  clock: { basis: "utc_wall"; continuity: HumanTimeContinuity };
}
export interface HumanTimeCapture {
  id: string;
  kind: "attach" | "detach";
  at: string;
  startId: string | null;
  sourcePosition: number | null;
}
export interface HumanTimeEffort {
  id: string;
  replaces: string | null;
  recordedAt: string;
  asOf: string;
  minutes: number;
  basis: "estimated";
  scope: "single_engineer_unverified";
}
export interface HumanTimeLedger {
  schema: "banzai-human-time/v1";
  schemaVersion: 1;
  runId: string;
  revision: number;
  captures: HumanTimeCapture[];
  observations: HumanTimeObservation[];
  effortRevisions: HumanTimeEffort[];
  issues: HumanTimeIssue[];
}
export type HumanTimeReadResult =
  | { status: "valid"; ledger: HumanTimeLedger; issues: HumanTimeIssue[] }
  | { status: "absent" | "invalid" | "unsupported"; issue: HumanTimeIssueCode };
export interface HumanTimeEvidence {
  observations: HumanTimeObservation[];
  pendingKeys: string[];
  issues: HumanTimeIssue[];
  eventCount: number;
  runCreatedAt: string | null;
  blocked: boolean;
}
export interface HumanTimeEpisode {
  key: string;
  kind: HumanTimeKind;
  outcome: "open" | "incomplete" | Exclude<HumanTimeEndpoint, "opened">;
  durationMs: number | null;
  continuity: HumanTimeContinuity;
  provisional: boolean;
}
export interface HumanTimeSummary {
  revision: number | null;
  effort: HumanTimeEffort | null;
  episodes: HumanTimeEpisode[];
  answeredMs: number | null;
  answeredCount: number;
  openCount: number;
  otherCount: number;
  unavailableCount: number;
  inventory: "partial" | "unavailable";
  recoveryUnknown: boolean;
  issues: HumanTimeIssue[];
}
export interface HumanTimeChange {
  captures: HumanTimeCapture[];
  observations: HumanTimeObservation[];
  effort: HumanTimeEffort | null;
  issues: HumanTimeIssue[];
}
export type HumanTimeWriteResult =
  | { status: "saved" | "unchanged"; revision: number }
  | {
      status: "stale" | "contended" | "unavailable";
      issue: HumanTimeIssueCode;
    };
export interface HumanTimeBoundary {
  kind:
    | "run_created"
    | "gate_pending"
    | "decision_recorded"
    | "run_cancelled"
    | "checkpoint";
  runId: string;
  attemptId: string | null;
  reviewIteration: number | null;
  requestId: string | null;
  roundId: string | null;
  eventType: HumanTimeEventType | null;
  eventAt: string | null;
}
export type HumanTimeObserver = (boundary: HumanTimeBoundary) => Promise<void>;
export interface HumanTimeGateway {
  attach(runId: string): Promise<void>;
  readSummary(runId: string): Promise<HumanTimeSummary>;
  setEstimate(
    runId: string,
    expectedRevision: number,
    minutes: number
  ): Promise<HumanTimeWriteResult>;
  detach(): Promise<void>;
}

export class HumanTimeFailure extends Error {
  constructor(readonly code: HumanTimeIssueCode) {
    super(code);
  }
}
export function humanTimeRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new HumanTimeFailure("INVALID_EVIDENCE");
  }
  return value as Record<string, unknown>;
}
function keys(value: unknown, expected: string[]): Record<string, unknown> {
  const record = humanTimeRecord(value);
  if (
    Object.keys(record).length !== expected.length ||
    expected.some((key) => !Object.hasOwn(record, key))
  ) {
    throw new HumanTimeFailure("INVALID_EVIDENCE");
  }
  return record;
}
function oneOf<T extends string>(value: unknown, choices: readonly T[]): T {
  if (typeof value !== "string" || !choices.includes(value as T))
    throw new HumanTimeFailure("INVALID_EVIDENCE");
  return value as T;
}
export function humanTimeId(value: unknown): string {
  if (
    typeof value !== "string" ||
    Buffer.byteLength(value) > 300 ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)
  ) {
    throw new HumanTimeFailure("INVALID_EVIDENCE");
  }
  return value;
}
function uuid(value: unknown): string {
  const id = humanTimeId(value);
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id))
    throw new HumanTimeFailure("INVALID_EVIDENCE");
  return id;
}
function digest(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value))
    throw new HumanTimeFailure("INVALID_EVIDENCE");
  return value;
}
export function humanTimeUtc(value: unknown): string {
  if (
    typeof value !== "string" ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    throw new HumanTimeFailure("INVALID_EVIDENCE");
  }
  return value;
}
export function humanTimeInteger(value: unknown, minimum = 0): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum
  )
    throw new HumanTimeFailure("INVALID_EVIDENCE");
  return value;
}
export function validHumanMinutes(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    Number.isFinite(value * 60000)
  );
}
function array<T>(
  value: unknown,
  bound: number,
  decode: (item: unknown) => T
): T[] {
  if (!Array.isArray(value)) throw new HumanTimeFailure("INVALID_EVIDENCE");
  if (value.length > bound) throw new HumanTimeFailure("LIMIT_EXCEEDED");
  return value.map(decode);
}
function uniqueIds(values: { id: string }[]): void {
  if (new Set(values.map((value) => value.id)).size !== values.length)
    throw new HumanTimeFailure("INVALID_EVIDENCE");
}
export function decodeHumanTimeAnchor(value: unknown): HumanTimeAnchor {
  const record = humanTimeRecord(value);
  switch (record.type) {
    case "plan_approval":
      keys(record, ["type", "attemptId", "bundleDigest"]);
      return {
        type: record.type,
        attemptId: humanTimeId(record.attemptId),
        bundleDigest:
          record.bundleDigest === null ? null : digest(record.bundleDigest)
      };
    case "adr_approval":
    case "escalation":
      keys(record, ["type", "attemptId"]);
      return { type: record.type, attemptId: humanTimeId(record.attemptId) };
    case "decision_consultation":
      keys(record, ["type", "attemptId", "requestId", "roundId"]);
      return {
        type: record.type,
        attemptId: humanTimeId(record.attemptId),
        requestId: humanTimeId(record.requestId),
        roundId: humanTimeId(record.roundId)
      };
    case "triage":
      keys(record, ["type", "attemptId", "reviewIteration"]);
      return {
        type: record.type,
        attemptId: humanTimeId(record.attemptId),
        reviewIteration: humanTimeInteger(record.reviewIteration, 1)
      };
    case "recovery_wait":
      keys(record, ["type", "attemptId", "ordinal"]);
      return {
        type: record.type,
        attemptId:
          record.attemptId === null ? null : humanTimeId(record.attemptId),
        ordinal: humanTimeInteger(record.ordinal)
      };
    default:
      throw new HumanTimeFailure("INVALID_EVIDENCE");
  }
}
function decodeSource(value: unknown): HumanTimeSource {
  const record = humanTimeRecord(value);
  if (record.kind === "event") {
    keys(record, ["kind", "type", "ordinal"]);
    return {
      kind: "event",
      type: oneOf(record.type, HUMAN_TIME_EVENT_TYPES),
      ordinal: humanTimeInteger(record.ordinal)
    };
  }
  keys(record, ["kind", "field", "bundleDigest"]);
  if (record.kind !== "state") throw new HumanTimeFailure("INVALID_EVIDENCE");
  const field = oneOf(record.field, STATE_FIELDS);
  const bundleDigest =
    record.bundleDigest === null ? null : digest(record.bundleDigest);
  if (bundleDigest !== null && field !== "planApproval.approvedAt")
    throw new HumanTimeFailure("INVALID_EVIDENCE");
  return { kind: "state", field, bundleDigest };
}
function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
export function humanTimeEpisodeKey(
  runId: string,
  anchor: HumanTimeAnchor
): string {
  return hash([humanTimeId(runId), anchor.type, decodeHumanTimeAnchor(anchor)]);
}
export function humanTimeObservation(
  runId: string,
  anchor: HumanTimeAnchor,
  endpoint: HumanTimeEndpoint,
  at: string,
  source: HumanTimeSource
): HumanTimeObservation {
  const episodeKey = humanTimeEpisodeKey(runId, anchor);
  const normalizedSource = decodeSource(source);
  return {
    id: hash([episodeKey, endpoint, humanTimeUtc(at), normalizedSource]),
    episodeKey,
    kind: anchor.type,
    anchor: decodeHumanTimeAnchor(anchor),
    endpoint,
    at,
    source: normalizedSource,
    capturedAt: at,
    channel: "unattributed",
    clock: { basis: "utc_wall", continuity: "unverified" }
  };
}
function decodeObservation(
  value: unknown,
  runId: string
): HumanTimeObservation {
  const record = keys(value, [
    "id",
    "episodeKey",
    "kind",
    "anchor",
    "endpoint",
    "at",
    "source",
    "capturedAt",
    "channel",
    "clock"
  ]);
  const anchor = decodeHumanTimeAnchor(record.anchor);
  const endpoint = oneOf(record.endpoint, [
    "opened",
    "answered",
    "cancelled",
    "superseded",
    "recovery_ended"
  ]);
  if (
    anchor.type === "recovery_wait"
      ? !["opened", "recovery_ended"].includes(endpoint)
      : endpoint === "recovery_ended"
  )
    throw new HumanTimeFailure("INVALID_EVIDENCE");
  const observation = humanTimeObservation(
    runId,
    anchor,
    endpoint,
    humanTimeUtc(record.at),
    decodeSource(record.source)
  );
  const clock = keys(record.clock, ["basis", "continuity"]);
  if (
    record.id !== observation.id ||
    record.episodeKey !== observation.episodeKey ||
    record.kind !== anchor.type ||
    clock.basis !== "utc_wall"
  )
    throw new HumanTimeFailure("INVALID_EVIDENCE");
  return {
    ...observation,
    capturedAt: humanTimeUtc(record.capturedAt),
    channel: oneOf(record.channel, ["interactive", "unattributed"]),
    clock: {
      basis: "utc_wall",
      continuity: oneOf(clock.continuity, [
        "process_correlated",
        "unverified",
        "discontinuity"
      ])
    }
  };
}
function decodeCapture(value: unknown): HumanTimeCapture {
  const r = keys(value, ["id", "kind", "at", "startId", "sourcePosition"]);
  const kind = oneOf(r.kind, ["attach", "detach"]);
  const startId = r.startId === null ? null : uuid(r.startId);
  if ((kind === "attach") !== (startId === null))
    throw new HumanTimeFailure("INVALID_EVIDENCE");
  return {
    id: uuid(r.id),
    kind,
    at: humanTimeUtc(r.at),
    startId,
    sourcePosition:
      r.sourcePosition === null ? null : humanTimeInteger(r.sourcePosition)
  };
}
function decodeEffort(value: unknown): HumanTimeEffort {
  const r = keys(value, [
    "id",
    "replaces",
    "recordedAt",
    "asOf",
    "minutes",
    "basis",
    "scope"
  ]);
  if (
    !validHumanMinutes(r.minutes) ||
    r.basis !== "estimated" ||
    r.scope !== "single_engineer_unverified"
  )
    throw new HumanTimeFailure("INVALID_EVIDENCE");
  return {
    id: uuid(r.id),
    replaces: r.replaces === null ? null : uuid(r.replaces),
    recordedAt: humanTimeUtc(r.recordedAt),
    asOf: humanTimeUtc(r.asOf),
    minutes: r.minutes,
    basis: "estimated",
    scope: "single_engineer_unverified"
  };
}
function decodeIssue(value: unknown): HumanTimeIssue {
  const r = keys(value, ["code", "episodeKey"]);
  return {
    code: oneOf(r.code, HUMAN_TIME_ISSUES),
    episodeKey: r.episodeKey === null ? null : digest(r.episodeKey)
  };
}
export function humanTimeIssue(
  code: HumanTimeIssueCode,
  episodeKey: string | null = null
): HumanTimeIssue {
  return { code, episodeKey };
}
export function uniqueHumanTimeIssues(
  issues: HumanTimeIssue[]
): HumanTimeIssue[] {
  return [
    ...new Map(issues.map((issue) => [JSON.stringify(issue), issue])).values()
  ];
}
export function currentHumanTimeEffort(
  revisions: HumanTimeEffort[]
): HumanTimeEffort | null {
  let previous: HumanTimeEffort | null = null;
  // Persisted array order is revision order, not timestamps or last-writer wins.
  for (const revision of revisions) {
    if (
      revision.replaces !== (previous?.id ?? null) ||
      Date.parse(revision.asOf) > Date.parse(revision.recordedAt)
    )
      return null;
    previous = revision;
  }
  return previous;
}
export function decodeHumanTime(
  value: unknown,
  expectedRunId: string
): HumanTimeReadResult {
  try {
    const object = humanTimeRecord(value);
    if (object.schema !== "banzai-human-time/v1" || object.schemaVersion !== 1)
      return { status: "unsupported", issue: "UNSUPPORTED_VERSION" };
    if (Buffer.byteLength(JSON.stringify(value)) > HUMAN_TIME_LIMITS.bytes)
      throw new HumanTimeFailure("LIMIT_EXCEEDED");
    const r = keys(object, [
      "schema",
      "schemaVersion",
      "runId",
      "revision",
      "captures",
      "observations",
      "effortRevisions",
      "issues"
    ]);
    if (humanTimeId(r.runId) !== expectedRunId)
      throw new HumanTimeFailure("INVALID_EVIDENCE");
    const ledger: HumanTimeLedger = {
      schema: "banzai-human-time/v1",
      schemaVersion: 1,
      runId: expectedRunId,
      revision: humanTimeInteger(r.revision),
      captures: array(r.captures, HUMAN_TIME_LIMITS.captures, decodeCapture),
      observations: array(
        r.observations,
        HUMAN_TIME_LIMITS.observations,
        (item) => decodeObservation(item, expectedRunId)
      ),
      effortRevisions: array(
        r.effortRevisions,
        HUMAN_TIME_LIMITS.effortRevisions,
        decodeEffort
      ),
      issues: array(r.issues, HUMAN_TIME_LIMITS.issues, decodeIssue)
    };
    uniqueIds(ledger.captures);
    uniqueIds(ledger.observations);
    uniqueIds(ledger.effortRevisions);
    const attached = new Set<string>();
    const detached = new Set<string>();
    for (const capture of ledger.captures) {
      if (capture.kind === "attach") attached.add(capture.id);
      else if (
        capture.startId === null ||
        !attached.has(capture.startId) ||
        detached.has(capture.startId)
      )
        throw new HumanTimeFailure("INVALID_EVIDENCE");
      else detached.add(capture.startId);
    }
    return {
      status: "valid",
      ledger,
      issues:
        ledger.effortRevisions.length > 0 &&
        currentHumanTimeEffort(ledger.effortRevisions) === null
          ? [humanTimeIssue("CONFLICTING_EFFORT")]
          : []
    };
  } catch (error) {
    return {
      status: "invalid",
      issue: error instanceof HumanTimeFailure ? error.code : "INVALID_EVIDENCE"
    };
  }
}
export function emptyHumanTime(runId: string): HumanTimeLedger {
  return {
    schema: "banzai-human-time/v1",
    schemaVersion: 1,
    runId: humanTimeId(runId),
    revision: 0,
    captures: [],
    observations: [],
    effortRevisions: [],
    issues: []
  };
}
export function emptyHumanTimeEvidence(
  issue?: HumanTimeIssueCode
): HumanTimeEvidence {
  return {
    observations: [],
    pendingKeys: [],
    issues: issue === undefined ? [] : [humanTimeIssue(issue)],
    eventCount: 0,
    runCreatedAt: null,
    blocked: false
  };
}
export function deriveHumanTime(
  read: HumanTimeReadResult,
  evidence: HumanTimeEvidence,
  displayAt: string
): HumanTimeSummary {
  const issues = [...evidence.issues];
  const summary: HumanTimeSummary = {
    revision:
      read.status === "valid"
        ? read.ledger.revision
        : read.status === "absent"
          ? 0
          : null,
    effort: null,
    episodes: [],
    answeredMs: null,
    answeredCount: 0,
    openCount: 0,
    otherCount: 0,
    unavailableCount: 0,
    inventory: read.status === "valid" ? "partial" : "unavailable",
    recoveryUnknown: evidence.blocked,
    issues
  };
  if (read.status !== "valid") {
    issues.push(humanTimeIssue(read.issue));
    return summary;
  }
  const { ledger } = read;
  issues.push(...ledger.issues, ...read.issues);
  summary.effort = currentHumanTimeEffort(ledger.effortRevisions);
  if (ledger.effortRevisions.length > 0 && summary.effort === null)
    issues.push(humanTimeIssue("CONFLICTING_EFFORT"));
  const canonical = new Map(evidence.observations.map((o) => [o.id, o]));
  const groups = new Map<string, HumanTimeObservation[]>();
  for (const observation of ledger.observations) {
    const group = groups.get(observation.episodeKey) ?? [];
    group.push(observation);
    groups.set(observation.episodeKey, group);
  }
  for (const [key, stored] of groups) {
    // Reconcile closure for an already observed episode, never an unobserved historical task.
    const observations = [
      ...new Map(
        [
          ...evidence.observations.filter((o) => o.episodeKey === key),
          ...stored
        ].map((o) => [o.id, o])
      ).values()
    ];
    const opened = observations.filter((o) => o.endpoint === "opened");
    const closed = observations.filter((o) => o.endpoint !== "opened");
    const first = stored[0];
    if (first === undefined) continue;
    const kind = first.kind;
    const conflicting =
      new Set(opened.map((o) => o.at)).size > 1 ||
      new Set(closed.map((o) => `${o.endpoint}:${o.at}`)).size > 1;
    const corroborated = stored.every((o) => canonical.has(o.id));
    const discontinuous =
      observations.some((o) => o.clock.continuity === "discontinuity") ||
      issues.some(
        (i) => i.episodeKey === key && i.code === "CLOCK_DISCONTINUITY"
      );
    const open = opened[0];
    const close = closed[0];
    const pending = evidence.pendingKeys.includes(key);
    const available =
      !conflicting &&
      corroborated &&
      !discontinuous &&
      open !== undefined &&
      (close !== undefined || pending);
    const end = close?.at ?? displayAt;
    let durationMs = available ? Date.parse(end) - Date.parse(open.at) : null;
    if (
      durationMs !== null &&
      (!Number.isSafeInteger(durationMs) || durationMs < 0)
    ) {
      durationMs = null;
      issues.push(humanTimeIssue("CLOCK_DISCONTINUITY", key));
    }
    if (conflicting) issues.push(humanTimeIssue("CONFLICTING_ENDPOINTS", key));
    if (!corroborated || (close === undefined && !pending))
      issues.push(humanTimeIssue("MISSING_EVIDENCE", key));
    const outcome =
      close !== undefined && close.endpoint !== "opened"
        ? close.endpoint
        : "open";
    const episode: HumanTimeEpisode = {
      key,
      kind,
      outcome:
        conflicting || !corroborated || (close === undefined && !pending)
          ? "incomplete"
          : outcome,
      durationMs,
      continuity: discontinuous
        ? "discontinuity"
        : (close?.clock.continuity ?? "unverified"),
      provisional: close === undefined
    };
    summary.episodes.push(episode);
    if (kind === "recovery_wait") {
      if (pending && durationMs !== null) summary.recoveryUnknown = false;
      continue;
    }
    if (episode.outcome === "answered") {
      summary.answeredCount++;
      if (durationMs !== null)
        summary.answeredMs = (summary.answeredMs ?? 0) + durationMs;
    } else if (episode.outcome === "open") summary.openCount++;
    else summary.otherCount++;
    if (durationMs === null) summary.unavailableCount++;
  }
  if (
    summary.answeredMs !== null &&
    !Number.isSafeInteger(summary.answeredMs)
  ) {
    summary.answeredMs = null;
    issues.push(humanTimeIssue("LIMIT_EXCEEDED"));
  }
  summary.issues = uniqueHumanTimeIssues(issues);
  return summary;
}
