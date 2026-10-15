import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  decodeHumanTime,
  deriveHumanTime,
  emptyHumanTime,
  emptyHumanTimeEvidence,
  humanTimeObservation,
  HUMAN_TIME_LIMITS
} from "../src/human-time.js";
import type { HumanTimeAnchor, HumanTimeEffort } from "../src/human-time.js";

const runId = "run-example";
const anchor: HumanTimeAnchor = {
  type: "triage",
  attemptId: "review-1",
  reviewIteration: 1
};
const opened = humanTimeObservation(
  runId,
  anchor,
  "opened",
  "2026-09-06T10:00:00.000Z",
  { kind: "event", type: "review.completed", ordinal: 1 }
);
const answered = humanTimeObservation(
  runId,
  anchor,
  "answered",
  "2026-09-06T10:12:00.000Z",
  { kind: "event", type: "review.triaged", ordinal: 2 }
);
function effort(
  minutes: number,
  replaces: string | null = null
): HumanTimeEffort {
  return {
    id: randomUUID(),
    replaces,
    minutes,
    recordedAt: answered.at,
    asOf: answered.at,
    basis: "estimated",
    scope: "single_engineer_unverified"
  };
}
function fixture() {
  const ledger = emptyHumanTime(runId);
  ledger.observations = [opened, answered];
  const evidence = emptyHumanTimeEvidence();
  evidence.observations = [opened, answered];
  return { ledger, evidence };
}

test("human time: one triage remains twelve minutes after later model work, rereads and duplicate canonical observations", () => {
  const { ledger, evidence } = fixture();
  evidence.observations.push(answered, opened);
  const summary = deriveHumanTime(
    decodeHumanTime(ledger, runId),
    evidence,
    "2026-09-06T10:50:00.000Z"
  );
  assert.equal(summary.answeredMs, 12 * 60000);
  assert.equal(summary.answeredCount, 1);
  assert.equal(summary.effort, null);
  assert.equal(summary.inventory, "partial");
});

test("human time: corrections replace instead of add; zero is explicit and branches/dangling links are unavailable", () => {
  const { ledger, evidence } = fixture();
  const first = effort(12);
  const second = effort(15, first.id);
  ledger.effortRevisions = [first, second];
  assert.equal(
    deriveHumanTime(decodeHumanTime(ledger, runId), evidence, answered.at)
      .effort?.minutes,
    15
  );
  const third = effort(0, second.id);
  ledger.effortRevisions.push(third);
  assert.equal(
    deriveHumanTime(decodeHumanTime(ledger, runId), evidence, answered.at)
      .effort?.minutes,
    0
  );
  for (const revisions of [
    [first, second, effort(3, first.id)],
    [effort(3, randomUUID())]
  ]) {
    ledger.effortRevisions = revisions;
    const summary = deriveHumanTime(
      decodeHumanTime(ledger, runId),
      evidence,
      answered.at
    );
    assert.equal(summary.effort, null);
    assert.ok(summary.issues.some((i) => i.code === "CONFLICTING_EFFORT"));
    assert.equal(summary.answeredMs, 12 * 60000);
  }
});

test("human time: pending, cancelled and superseded work stay outside the answered subtotal", () => {
  for (const endpoint of [null, "cancelled", "superseded"] as const) {
    const { ledger, evidence } = fixture();
    ledger.observations = [opened];
    evidence.observations = [opened];
    if (endpoint === null) evidence.pendingKeys = [opened.episodeKey];
    else {
      const close = humanTimeObservation(
        runId,
        anchor,
        endpoint,
        "2026-09-07T10:00:00.000Z",
        {
          kind: "event",
          type: endpoint === "cancelled" ? "run.cancelled" : "review.completed",
          ordinal: 2
        }
      );
      ledger.observations.push(close);
      evidence.observations.push(close);
    }
    const summary = deriveHumanTime(
      decodeHumanTime(ledger, runId),
      evidence,
      "2026-09-07T10:00:00.000Z"
    );
    assert.equal(summary.answeredMs, null);
    assert.equal(summary.episodes[0]?.durationMs, 24 * 3600000);
    assert.equal(summary.episodes[0].outcome, endpoint ?? "open");
    assert.equal(summary.episodes[0].provisional, endpoint === null);
  }
});

test("human time: missing authority, conflicting closures, negative clocks and known clock jumps never give exact totals", () => {
  for (const scenario of ["missing", "conflict", "negative", "jump"]) {
    const { ledger, evidence } = fixture();
    if (scenario === "missing") evidence.observations = [opened];
    if (scenario === "conflict")
      evidence.observations.push(
        humanTimeObservation(
          runId,
          anchor,
          "answered",
          "2026-09-06T10:13:00.000Z",
          { kind: "event", type: "review.triaged", ordinal: 3 }
        )
      );
    if (scenario === "negative") {
      const early = humanTimeObservation(
        runId,
        anchor,
        "answered",
        "2026-09-06T09:00:00.000Z",
        answered.source
      );
      ledger.observations = [opened, early];
      evidence.observations = [opened, early];
    }
    if (scenario === "jump")
      ledger.observations = [
        opened,
        {
          ...answered,
          clock: { basis: "utc_wall", continuity: "discontinuity" }
        }
      ];
    assert.equal(
      deriveHumanTime(decodeHumanTime(ledger, runId), evidence, answered.at)
        .answeredMs,
      null,
      scenario
    );
  }
});

test("human time: closed ingress rejects extra content, wrong run, forged identities, unsupported versions, invalid values and limits", () => {
  const { ledger } = fixture();
  assert.equal(decodeHumanTime(ledger, runId).status, "valid");
  const canary = "PRIVATE_DO_NOT_CAPTURE";
  for (const value of [
    { ...ledger, note: canary },
    { ...ledger, observations: [{ ...opened, id: "0".repeat(64) }] },
    { ...ledger, observations: [opened, opened] },
    {
      ...ledger,
      captures: [
        {
          id: randomUUID(),
          kind: "detach",
          at: opened.at,
          startId: randomUUID(),
          sourcePosition: 0
        }
      ]
    },
    { ...ledger, effortRevisions: [effort(-1)] },
    { ...ledger, effortRevisions: [effort(Infinity)] },
    { ...ledger, effortRevisions: [{ ...effort(1), decidedBy: canary }] },
    { ...ledger, observations: [{ ...opened, at: "yesterday" }] },
    {
      ...ledger,
      observations: Array(HUMAN_TIME_LIMITS.observations + 1).fill(opened)
    }
  ]) {
    const result = decodeHumanTime(value, runId);
    assert.equal(result.status, "invalid");
    assert.ok(!JSON.stringify(result).includes(canary));
  }
  assert.equal(decodeHumanTime(ledger, "different-run").status, "invalid");
  assert.equal(
    decodeHumanTime({ ...ledger, schemaVersion: 2 }, runId).status,
    "unsupported"
  );
});

test("human time: planning triage anchors retain closed episode identities and reject forged digests or fields", () => {
  const triage: HumanTimeAnchor = {
    type: "planning_review_triage",
    attemptId: "planning-analysis-1-abcdef12",
    episodeId: "planning-episode-abcdef12",
    reviewNumber: 3
  };
  const observation = humanTimeObservation(runId, triage, "opened", opened.at, {
    kind: "event",
    type: "planning_review.triage_pending",
    ordinal: 1
  });
  const ledger = emptyHumanTime(runId);
  ledger.observations = [observation];
  assert.equal(decodeHumanTime(ledger, runId).status, "valid");
  for (const anchor of [
    { ...triage, reviewNumber: 0 },
    { ...triage, reviewNumber: Number.MAX_SAFE_INTEGER + 1 },
    { ...triage, episodeId: "../foreign" },
    { ...triage, attemptId: "" },
    { ...triage, feedback: "PRIVATE-PLANNING-ANCHOR-CANARY" },
    { ...triage, episodeId: "planning-episode-ffffffff" }
  ]) {
    const decoded = decodeHumanTime(
      { ...ledger, observations: [{ ...observation, anchor }] },
      runId
    );
    assert.equal(decoded.status, "invalid");
    assert.doesNotMatch(
      JSON.stringify(decoded),
      /PRIVATE-PLANNING-ANCHOR-CANARY/
    );
  }
});

test("human time: parallel gate waits never establish active person time or a task total", () => {
  const { ledger, evidence } = fixture();
  const other: HumanTimeAnchor = {
    type: "plan_approval",
    attemptId: "plan-1",
    bundleDigest: null
  };
  const observations = [
    humanTimeObservation(runId, other, "opened", opened.at, {
      kind: "event",
      type: "attempt.applied",
      ordinal: 3
    }),
    humanTimeObservation(runId, other, "answered", answered.at, {
      kind: "event",
      type: "approval.plan",
      ordinal: 4
    })
  ];
  ledger.observations.push(...observations);
  evidence.observations.push(...observations);
  const summary = deriveHumanTime(
    decodeHumanTime(ledger, runId),
    evidence,
    answered.at
  );
  assert.equal(summary.answeredMs, 24 * 60000);
  assert.equal(summary.effort, null);
  assert.equal(summary.answeredCount, 2);
  assert.equal(summary.inventory, "partial");
});
