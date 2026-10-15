import { BanzaiError } from "./errors.js";
import type {
  PlanningReviewEpisodeBase,
  PlanningReviewTriageRecord,
  RunState
} from "./types.js";
import {
  digestCanonicalJson,
  parsePlanningReviewResult,
  validatePlanningReviewAnalysis,
  parsePlanningReviewTriageAnswer,
  validateHumanFreeText
} from "./validation.js";

const CODE = "STATE_READ_FAILED";
const BASE = [
  "episodeId",
  "reviewNumber",
  "originGate",
  "scope",
  "requestedAt",
  "decidedBy",
  "reviewer",
  "reviewAttemptId",
  "reviewSessionId",
  "analysisAttemptId",
  "applyingAttemptId",
  "resultDigest",
  "findingCount",
  "artifact",
  "analysisDigest"
];
function fail(): never {
  throw new BanzaiError(
    CODE,
    "Persisted planning-review state is inconsistent."
  );
}
function exact(value: unknown, keys: string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return fail();
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join(",") !== [...keys].sort().join(","))
    return fail();
  return record;
}
function text(value: unknown, limit = 500): string {
  if (
    typeof value !== "string" ||
    value.length > limit ||
    value.trim() !== value ||
    value.length === 0 ||
    /[\r\n]/u.test(value)
  )
    return fail();
  validateHumanFreeText(value, "Persisted identity", limit * 4, CODE);
  return value;
}
function digest(value: unknown): void {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/u.test(value)) fail();
}
function timestamp(value: unknown): void {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(value) ||
    !Number.isFinite(Date.parse(value))
  )
    fail();
}
function pathValue(value: unknown): void {
  const p = text(value, 300);
  if (
    p.startsWith("/") ||
    p.includes("\\") ||
    /^[A-Za-z]:/u.test(p) ||
    p.split("/").some((part) => part === "" || part === "." || part === "..")
  )
    fail();
}
function episodeEvidence(e: PlanningReviewEpisodeBase): void {
  if (
    !/^planning-episode-[0-9a-f]{8}$/u.test(e.episodeId) ||
    !Number.isSafeInteger(e.reviewNumber) ||
    e.reviewNumber < 1 ||
    e.reviewNumber > 1_000_000
  )
    fail();
  if (!["adr_approval", "plan_approval"].includes(e.originGate)) fail();
  timestamp(e.requestedAt);
  text(e.decidedBy);
  if (
    !Array.isArray(e.scope) ||
    e.scope.length < 1 ||
    e.scope.length > 128 ||
    new Set(e.scope.map((item) => item.path)).size !== e.scope.length
  )
    fail();
  for (const item of e.scope) {
    exact(item, ["path", "sha256"]);
    pathValue(item.path);
    digest(item.sha256);
  }
  if (e.reviewer !== null) {
    exact(e.reviewer, ["executable", "model", "effort"]);
    const executable = text(e.reviewer.executable);
    if (/[\\/]/u.test(executable) || executable === "." || executable === "..")
      fail();
    text(e.reviewer.model);
    if (
      !["low", "medium", "high", "xhigh", "max", "ultra"].includes(
        e.reviewer.effort
      )
    )
      fail();
  }
  for (const value of [
    e.reviewAttemptId,
    e.reviewSessionId,
    e.analysisAttemptId,
    e.applyingAttemptId
  ])
    if (value !== null) text(value);
  if (
    e.reviewAttemptId !== null &&
    !new RegExp(`^planning-review-${e.reviewNumber}-[0-9a-f]{8}$`, "u").test(
      e.reviewAttemptId
    )
  )
    fail();
  if (
    e.analysisAttemptId !== null &&
    !new RegExp(`^planning-analysis-${e.reviewNumber}-[0-9a-f]{8}$`, "u").test(
      e.analysisAttemptId
    )
  )
    fail();
  for (const value of [e.resultDigest, e.analysisDigest])
    if (value !== null) digest(value);
  if (
    e.findingCount !== null &&
    (!Number.isSafeInteger(e.findingCount) ||
      e.findingCount < 0 ||
      e.findingCount > 20)
  )
    fail();
  if (e.artifact !== null) {
    exact(e.artifact, ["path", "sha256"]);
    pathValue(e.artifact.path);
    digest(e.artifact.sha256);
    if (
      e.reviewer === null ||
      e.resultDigest === null ||
      e.findingCount === null ||
      !e.artifact.path.endsWith(`/planning-review-${e.reviewNumber}.md`)
    )
      fail();
  }
}
function episodeState(state: RunState): void {
  const pr = state.planningReview;
  exact(pr, ["active", "closed"]);
  if (pr === undefined || !Array.isArray(pr.closed)) fail();
  const ids = new Set<string>();
  const numbers = new Set<number>();
  const slots = [
    ...pr.closed.map((e) => ({ e, closed: true as const })),
    ...(pr.active === null ? [] : [{ e: pr.active, closed: false as const }])
  ];
  for (const { e, closed } of slots) {
    exact(e, [...BASE, ...(closed ? ["outcome", "closedAt"] : ["step"])]);
    episodeEvidence(e);
    if (
      e.artifact !== null &&
      e.artifact.path !==
        `${state.artifactBinding?.binding.artifacts.reviewDirectory}/planning-review-${e.reviewNumber}.md`
    )
      fail();
    if (
      ids.has(e.episodeId) ||
      numbers.has(e.reviewNumber) ||
      [e.reviewAttemptId, e.analysisAttemptId, e.applyingAttemptId].includes(
        e.episodeId
      )
    )
      fail();
    ids.add(e.episodeId);
    numbers.add(e.reviewNumber);
    if (closed && "outcome" in e) {
      if (
        ![
          "restored_no_findings",
          "restored_no_action",
          "applied",
          "stale",
          "cancelled"
        ].includes(e.outcome)
      )
        fail();
      timestamp(e.closedAt);
      if (
        e.applyingAttemptId !== null &&
        e.outcome !== "applied" &&
        e.outcome !== "cancelled"
      )
        fail();
    } else if (!closed && "step" in e) {
      if (
        !["reviewing", "analyzing", "awaiting_triage", "applying"].includes(
          e.step
        )
      )
        fail();
      if (e.applyingAttemptId !== null && e.step !== "applying") fail();
    } else fail();
  }
  const e = pr.active;
  if (e === null) {
    if (
      [state.activeAttempt?.kind, state.activeProcess?.kind].some(
        (kind) => kind === "planning_review" || kind === "planning_analysis"
      ) &&
      state.status !== "cancelled"
    )
      fail();
    return;
  }
  const expectedKind =
    e.step === "reviewing"
      ? "planning_review"
      : e.step === "analyzing"
        ? "planning_analysis"
        : e.step === "applying"
          ? "plan"
          : null;
  if (
    state.activeAttempt !== null &&
    (state.activeAttempt.kind !== expectedKind || state.activeAttempt.mutable)
  )
    fail();
  if (
    state.activeProcess !== null &&
    state.activeProcess.kind !== state.activeAttempt?.kind
  )
    fail();
  if (
    e.step === "awaiting_triage" &&
    (state.activeAttempt !== null || state.activeProcess !== null)
  )
    fail();
  if (e.step === "awaiting_triage") {
    if (state.status !== "needs_human_decision") fail();
  } else if (
    !["planning", "blocked"].includes(state.status) &&
    !(
      e.step === "applying" &&
      state.status === "needs_human_decision" &&
      state.pendingHumanDecision?.kind === "escalation"
    )
  )
    fail();
  if (
    e.step !== "reviewing" &&
    (e.artifact === null || e.resultDigest === null || e.findingCount === null)
  )
    fail();
  if (
    (e.step === "awaiting_triage" || e.step === "applying") &&
    (e.analysisDigest === null || e.analysisAttemptId === null)
  )
    fail();
}
function pendingState(state: RunState): void {
  const e = state.planningReview?.active;
  const p = state.pendingHumanDecision;
  if (p?.kind !== "planning_review_triage") {
    if (e?.step === "awaiting_triage") fail();
    return;
  }
  exact(p, [
    "kind",
    "runId",
    "episodeId",
    "reviewNumber",
    "originGate",
    "artifactPath",
    "artifactSha256",
    "resultDigest",
    "analysisDigest",
    "findings",
    "analysis",
    "requestedAt"
  ]);
  if (
    state.status !== "needs_human_decision" ||
    e?.step !== "awaiting_triage" ||
    p.runId !== state.runId ||
    p.episodeId !== e.episodeId ||
    p.reviewNumber !== e.reviewNumber ||
    p.originGate !== e.originGate ||
    p.artifactPath !== (e.artifact === null ? null : e.artifact.path) ||
    p.artifactSha256 !== (e.artifact === null ? null : e.artifact.sha256) ||
    p.resultDigest !== e.resultDigest ||
    p.analysisDigest !== e.analysisDigest ||
    p.findings.length !== e.findingCount
  )
    fail();
  const result = parsePlanningReviewResult({
    contractVersion: "1.0.0",
    schema: "banzai-planning-review-result/v1",
    schemaVersion: 1,
    reviewNumber: e.reviewNumber,
    scope: e.scope,
    findings: p.findings
  });
  if (digestCanonicalJson(result) !== e.resultDigest) fail();
  const analysis = validatePlanningReviewAnalysis(
    {
      contractVersion: "1.0.0",
      schema: "banzai-planning-review-analysis/v1",
      schemaVersion: 1,
      reviewNumber: e.reviewNumber,
      resultDigest: e.resultDigest,
      entries: p.analysis
    },
    {
      reviewNumber: e.reviewNumber,
      resultDigest: p.resultDigest,
      findings: result.findings
    }
  );
  if (digestCanonicalJson(analysis) !== p.analysisDigest) fail();
  timestamp(p.requestedAt);
}
function triageRecord(
  state: RunState,
  record: PlanningReviewTriageRecord,
  seen: Set<string>
): void {
  exact(record, [
    "kind",
    "runId",
    "episodeId",
    "reviewNumber",
    "analysisDigest",
    "dispositions",
    "additionalInstruction",
    "decidedBy",
    "decidedAt"
  ]);
  const episode = [
    state.planningReview?.active,
    ...(state.planningReview?.closed ?? [])
  ].find((e) => e?.episodeId === record.episodeId);
  if (
    episode == null ||
    record.runId !== state.runId ||
    record.reviewNumber !== episode.reviewNumber ||
    record.analysisDigest !== episode.analysisDigest ||
    seen.has(record.episodeId) ||
    record.dispositions.length !== episode.findingCount
  )
    fail();
  const entries = record.dispositions.map((item) => ({
    findingId: item.findingId,
    assessment: "agree" as const,
    rationale: "Persisted disposition",
    options:
      item.optionId === null
        ? []
        : [
            {
              optionId: item.optionId,
              label: "Persisted option",
              consequences: ["Retained"]
            }
          ],
    recommendation: null
  }));
  for (const item of record.dispositions)
    if (
      !new RegExp(`^P${episode.reviewNumber}-F[1-9][0-9]*$`, "u").test(
        item.findingId
      )
    )
      fail();
  const answer = {
    runId: record.runId,
    episodeId: record.episodeId,
    reviewNumber: record.reviewNumber,
    analysisDigest: record.analysisDigest,
    dispositions: record.dispositions,
    additionalInstruction: record.additionalInstruction
  };
  parsePlanningReviewTriageAnswer(answer, { ...record, entries }, CODE);
  seen.add(record.episodeId);
}
export function validatePlanningReviewState(state: RunState): void {
  const records = state.humanDecisions ?? [];
  const newRecord = (kind: string): boolean =>
    ["plan_rework", "adr_rework", "planning_review_triage"].includes(kind);
  if (state.schemaVersion !== 10) {
    if (
      "planningReview" in state ||
      state.pendingHumanDecision?.kind === "planning_review_triage" ||
      records.some((r) => newRecord(r.kind)) ||
      [state.activeAttempt?.kind, state.activeProcess?.kind].some(
        (k) => k === "planning_review" || k === "planning_analysis"
      )
    )
      fail();
    return;
  }
  try {
    const pendingKinds = [
      "escalation",
      "decision_consultation",
      "configuration_prerequisite",
      "planning_review_triage"
    ];
    const recordKinds = [...pendingKinds, "plan_rework", "adr_rework"];
    if (
      (state.pendingHumanDecision != null &&
        !pendingKinds.includes(state.pendingHumanDecision.kind)) ||
      records.some((record) => !recordKinds.includes(record.kind))
    )
      fail();
    episodeState(state);
    pendingState(state);
    const seen = new Set<string>();
    for (const record of records) {
      if (!newRecord(record.kind)) continue;
      timestamp(record.decidedAt);
      text(record.decidedBy);
      if (record.kind === "planning_review_triage")
        triageRecord(state, record, seen);
      else if (record.kind === "plan_rework" || record.kind === "adr_rework") {
        exact(record, [
          "kind",
          "feedback",
          "decidedBy",
          "decidedAt",
          record.kind === "plan_rework" ? "bundleDigest" : "adrId"
        ]);
        if (
          validateHumanFreeText(
            record.feedback,
            "Rework feedback",
            8000,
            CODE
          ) !== record.feedback
        )
          fail();
        if (record.kind === "plan_rework") digest(record.bundleDigest);
        else text(record.adrId);
      }
    }
    if (
      state.pendingHumanDecision?.kind === "planning_review_triage" &&
      seen.has(state.pendingHumanDecision.episodeId)
    )
      fail();
  } catch {
    fail();
  }
}
