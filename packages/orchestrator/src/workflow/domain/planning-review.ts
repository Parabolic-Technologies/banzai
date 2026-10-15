import { BanzaiError } from "../../errors.js";
import type {
  ClosedPlanningReviewEpisode,
  PlanningGate,
  PlanningReviewEpisode,
  PlanningReviewScope,
  PlanningReviewTriageAnswer,
  RunState,
  RunStatus
} from "../../types.js";

export const MAX_PLANNING_REVIEW_NUMBER = 1_000_000;

export function planningGateActions(
  gate: PlanningGate,
  version: number,
  available: boolean
): string[] {
  const actions =
    gate === "adr_approval" ? ["accept", "reject", "rework"] : ["approve"];
  if (version < 10) return actions;
  if (gate === "plan_approval") actions.push("rework");
  if (available) actions.push("review");
  return actions;
}

export function planningReviewScope(
  paths: readonly string[],
  selected: readonly string[] | null
): string[] {
  const selection = selected ?? paths;
  if (
    selection.length === 0 ||
    selection.length > 128 ||
    new Set(selection).size !== selection.length ||
    selection.some(
      (p) =>
        !paths.includes(p) ||
        !/^[^\\/]+(?:\/[^\\/]+)*$/u.test(p) ||
        p.split("/").some((part) => part === "." || part === "..") ||
        /^[A-Za-z]:/u.test(p)
    )
  )
    throw new BanzaiError(
      "INVALID_DECISION",
      "Review scope must be a non-empty, unique subset of the gate artifacts using exact canonical paths."
    );
  return paths.filter((p) => selection.includes(p));
}

export function nextPlanningReviewNumber(
  episodes: readonly { reviewNumber: number }[],
  filenames: readonly string[]
): number {
  let maximum = 0;
  for (const episode of episodes) {
    if (
      !Number.isSafeInteger(episode.reviewNumber) ||
      episode.reviewNumber < 1 ||
      episode.reviewNumber > MAX_PLANNING_REVIEW_NUMBER
    )
      throw new BanzaiError(
        "INVALID_DECISION",
        "Planning review number is outside its safe range."
      );
    maximum = Math.max(maximum, episode.reviewNumber);
  }
  for (const filename of filenames) {
    const match = /^planning-review-([1-9][0-9]*)\.md$/u.exec(filename);
    if (match === null) continue;
    const number = Number(match[1]);
    if (!Number.isSafeInteger(number) || number > MAX_PLANNING_REVIEW_NUMBER)
      throw new BanzaiError(
        "INVALID_DECISION",
        "Planning review number is outside its safe range."
      );
    maximum = Math.max(maximum, number);
  }
  if (maximum >= MAX_PLANNING_REVIEW_NUMBER)
    throw new BanzaiError(
      "INVALID_DECISION",
      "Planning review number limit reached."
    );
  return maximum + 1;
}

export function actionablePlanningTriage(
  answer: Pick<
    PlanningReviewTriageAnswer,
    "dispositions" | "additionalInstruction"
  >
): boolean {
  return (
    answer.dispositions.some((item) => item.kind !== "decline") ||
    (answer.additionalInstruction?.trim().length ?? 0) > 0
  );
}

export function planningReviewStaleness(
  recorded: readonly PlanningReviewScope[],
  gathered: readonly { path: string; sha256: string | null }[]
): string[] {
  return recorded
    .filter(
      (entry) =>
        gathered.find((item) => item.path === entry.path)?.sha256 !==
        entry.sha256
    )
    .map((entry) => entry.path);
}

export function planningReviewDispatch(
  state: RunState
):
  | "review"
  | "published"
  | "analysis"
  | "triage"
  | "apply"
  | "restart"
  | "none"
  | "inconsistent" {
  const episode = state.planningReview?.active;
  if (episode == null)
    return state.status === "blocked" &&
      state.blockedFrom === "planning" &&
      state.planningReview?.closed.at(-1)?.outcome === "stale"
      ? "restart"
      : "none";
  if (episode.step === "awaiting_triage")
    return state.status === "needs_human_decision" &&
      state.activeAttempt === null
      ? "triage"
      : "inconsistent";
  if (episode.step === "applying" && state.status === "needs_human_decision")
    return "apply";
  if (state.status !== "planning" && state.status !== "blocked")
    return "inconsistent";
  const kind = state.activeAttempt?.kind;
  if (episode.step === "reviewing")
    return kind !== undefined && kind !== "planning_review"
      ? "inconsistent"
      : episode.artifact === null
        ? "review"
        : "published";
  if (episode.step === "analyzing")
    return kind !== undefined && kind !== "planning_analysis"
      ? "inconsistent"
      : "analysis";
  return kind !== undefined && kind !== "plan" ? "inconsistent" : "apply";
}

export function closePlanningReview(
  episode: PlanningReviewEpisode,
  outcome: ClosedPlanningReviewEpisode["outcome"],
  closedAt: string
): ClosedPlanningReviewEpisode {
  const { step, ...base } = episode;
  void step;
  return { ...base, outcome, closedAt };
}

export function planningRestoreEligible(
  state: RunState,
  target: RunStatus,
  changedPaths: readonly string[] = []
): boolean {
  const episode = state.planningReview?.active;
  const record = state.humanDecisions?.at(-1);
  const pending = state.pendingHumanDecision;
  return (
    state.schemaVersion === 10 &&
    state.status === "needs_human_decision" &&
    episode?.step === "awaiting_triage" &&
    record?.kind === "planning_review_triage" &&
    record.runId === state.runId &&
    record.episodeId === episode.episodeId &&
    record.reviewNumber === episode.reviewNumber &&
    record.analysisDigest === episode.analysisDigest &&
    !actionablePlanningTriage(record) &&
    changedPaths.length === 0 &&
    target === `needs_${episode.originGate}` &&
    state.activeAttempt === null &&
    state.activeProcess === null &&
    (pending == null ||
      (pending.kind === "planning_review_triage" &&
        pending.runId === state.runId &&
        pending.episodeId === episode.episodeId &&
        pending.originGate === episode.originGate &&
        pending.reviewNumber === episode.reviewNumber &&
        pending.analysisDigest === episode.analysisDigest))
  );
}
