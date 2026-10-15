import type {
  PlanningReviewResult,
  PlanningReviewAnalysis,
  PlanningReviewTriageAnswer,
  PlanningReviewEpisode,
  PlanningReviewTriageRequest,
  RunState
} from "../src/types.js";
import { digestCanonicalJson } from "../src/validation.js";

export function planningReviewResult(
  count = 1,
  reviewNumber = 1
): PlanningReviewResult {
  return {
    contractVersion: "1.0.0",
    schema: "banzai-planning-review-result/v1",
    schemaVersion: 1,
    reviewNumber,
    scope: [
      { path: "documentation/work/task/plan.md", sha256: "a".repeat(64) }
    ],
    findings: Array.from({ length: count }, (_, index) => ({
      id: `P${reviewNumber}-F${index + 1}`,
      severity: "should_fix",
      category: "plan",
      summary: "The plan omits an acceptance condition.",
      evidence: [
        {
          path: "documentation/work/task/plan.md",
          line: 1,
          detail: "No failure case is specified."
        }
      ],
      suggestedResolution: "Specify the observable failure behavior.",
      confidence: "high"
    }))
  };
}

export function planningReviewAnalysis(
  result = planningReviewResult()
): PlanningReviewAnalysis {
  return {
    contractVersion: "1.0.0",
    schema: "banzai-planning-review-analysis/v1",
    schemaVersion: 1,
    reviewNumber: result.reviewNumber,
    resultDigest: digestCanonicalJson(result),
    entries: result.findings.map((finding) => ({
      findingId: finding.id,
      assessment: "agree",
      rationale: "The requirement is not covered.",
      options: [
        {
          optionId: "add-case",
          label: "Add the failure case",
          consequences: ["The acceptance test becomes explicit."]
        }
      ],
      recommendation: {
        optionId: "add-case",
        rationale: "This closes the documented gap."
      }
    }))
  };
}

export function planningReviewAnswer(
  analysis = planningReviewAnalysis()
): PlanningReviewTriageAnswer {
  return {
    runId: "run",
    episodeId: "planning-episode-12345678",
    reviewNumber: analysis.reviewNumber,
    analysisDigest: digestCanonicalJson(analysis),
    dispositions: analysis.entries.map((entry) => ({
      findingId: entry.findingId,
      kind: "decline",
      optionId: null,
      instruction: null
    })),
    additionalInstruction: null
  };
}

export function planningEpisode(
  overrides: Partial<PlanningReviewEpisode> = {}
): PlanningReviewEpisode {
  const result = planningReviewResult();
  return {
    episodeId: "planning-episode-12345678",
    reviewNumber: 1,
    originGate: "plan_approval",
    scope: result.scope,
    requestedAt: "2026-10-14T00:00:00.000Z",
    decidedBy: "owner",
    reviewer: { executable: "claude", model: "model", effort: "high" },
    step: "awaiting_triage",
    reviewAttemptId: "planning-review-1-abcdef12",
    reviewSessionId: "review-session",
    analysisAttemptId: "planning-analysis-1-abcdef12",
    applyingAttemptId: null,
    artifact: {
      path: "documentation/work/task/planning-review-1.md",
      sha256: "b".repeat(64)
    },
    resultDigest: digestCanonicalJson(result),
    analysisDigest: digestCanonicalJson(planningReviewAnalysis(result)),
    findingCount: 1,
    ...overrides
  };
}

export function planningTriageRequest(): PlanningReviewTriageRequest {
  const episode = planningEpisode();
  const result = planningReviewResult();
  const analysis = planningReviewAnalysis(result);
  return {
    kind: "planning_review_triage",
    runId: "run",
    episodeId: episode.episodeId,
    reviewNumber: episode.reviewNumber,
    originGate: episode.originGate,
    artifactPath: episode.artifact?.path ?? "",
    artifactSha256: episode.artifact?.sha256 ?? "",
    resultDigest: episode.resultDigest ?? "",
    analysisDigest: episode.analysisDigest ?? "",
    findings: result.findings,
    analysis: analysis.entries,
    requestedAt: episode.requestedAt
  };
}

export function planningTriageAnswer(
  state: RunState
): PlanningReviewTriageAnswer {
  const pending = state.pendingHumanDecision;
  if (pending?.kind !== "planning_review_triage")
    throw new Error("Missing planning triage fixture");
  return {
    runId: state.runId,
    episodeId: pending.episodeId,
    reviewNumber: pending.reviewNumber,
    analysisDigest: pending.analysisDigest,
    dispositions: pending.findings.map((f) => ({
      findingId: f.id,
      kind: "decline",
      optionId: null,
      instruction: null
    })),
    additionalInstruction: null
  };
}

export function planningRestoreState(): RunState {
  const episode = planningEpisode();
  const state: Partial<RunState> = {
    schemaVersion: 10,
    runId: "run",
    status: "needs_human_decision",
    blockedFrom: null,
    blockReason: null,
    activeAttempt: null,
    activeProcess: null,
    planningReview: { active: episode, closed: [] },
    humanDecisions: [
      {
        kind: "planning_review_triage",
        runId: "run",
        episodeId: episode.episodeId,
        reviewNumber: episode.reviewNumber,
        analysisDigest: episode.analysisDigest ?? "",
        dispositions: planningReviewAnswer().dispositions,
        additionalInstruction: null,
        decidedBy: "owner",
        decidedAt: episode.requestedAt
      }
    ],
    pendingHumanDecision: planningTriageRequest()
  };
  return state as RunState;
}
