import assert from "node:assert/strict";
import test from "node:test";
import {
  nextPlanningReviewNumber,
  planningReviewScope,
  actionablePlanningTriage,
  planningReviewStaleness,
  planningGateActions,
  planningReviewDispatch,
  planningRestoreEligible
} from "../../../src/workflow/domain/planning-review.js";
import type { RunState } from "../../../src/types.js";
import {
  planningEpisode,
  planningRestoreState
} from "../../planning-review-fixtures.js";

test("planning dispatch follows the closed episode-step and attempt-kind table", () => {
  const cases = [
    ["reviewing", "planning", null, false, "review"],
    ["reviewing", "blocked", "planning_review", false, "review"],
    ["reviewing", "planning", null, true, "published"],
    ["reviewing", "planning", "plan", false, "inconsistent"],
    ["analyzing", "planning", null, true, "analysis"],
    ["analyzing", "blocked", "planning_analysis", true, "analysis"],
    ["analyzing", "planning", "planning_review", true, "inconsistent"],
    ["awaiting_triage", "needs_human_decision", null, true, "triage"],
    ["awaiting_triage", "planning", null, true, "inconsistent"],
    ["awaiting_triage", "needs_human_decision", "plan", true, "inconsistent"],
    ["applying", "planning", null, true, "apply"],
    ["applying", "blocked", "plan", true, "apply"],
    ["applying", "needs_human_decision", null, true, "apply"],
    ["applying", "planning", "planning_analysis", true, "inconsistent"],
    ["reviewing", "done", null, false, "inconsistent"]
  ] as const;
  for (const [step, status, kind, published, expected] of cases) {
    const state = planningRestoreState();
    state.status = status;
    state.blockedFrom = status === "blocked" ? "planning" : null;
    state.activeAttempt =
      kind === null ? null : { id: "attempt", kind, mutable: kind === "plan" };
    state.planningReview = {
      active: planningEpisode({
        step,
        artifact: published ? planningEpisode().artifact : null
      }),
      closed: []
    };
    assert.equal(
      planningReviewDispatch(state),
      expected,
      JSON.stringify([step, status, kind])
    );
  }
  const state = planningRestoreState();
  state.planningReview = { active: null, closed: [] };
  assert.equal(planningReviewDispatch(state), "none");
  state.status = "blocked";
  state.blockedFrom = "planning";
  state.planningReview.closed.push({
    ...planningEpisode(),
    outcome: "stale",
    closedAt: "2026-10-14T00:01:00.000Z"
  });
  assert.equal(planningReviewDispatch(state), "restart");
  state.blockedFrom = "implementing";
  assert.equal(planningReviewDispatch(state), "none");
});

test("gate restore requires unchanged scope and exactly the matching non-actionable triage", () => {
  const episode = (s: RunState) => {
    assert.ok(s.planningReview?.active);
    return s.planningReview.active;
  };
  const record = (s: RunState) => {
    const r = s.humanDecisions?.at(-1);
    if (r?.kind !== "planning_review_triage")
      throw new Error("Missing fixture triage");
    return r;
  };
  const pending = (s: RunState) => {
    const p = s.pendingHumanDecision;
    if (p?.kind !== "planning_review_triage")
      throw new Error("Missing fixture pending triage");
    return p;
  };
  assert.equal(
    planningRestoreEligible(planningRestoreState(), "needs_plan_approval"),
    true
  );
  const withoutPending = planningRestoreState();
  withoutPending.pendingHumanDecision = null;
  assert.equal(
    planningRestoreEligible(withoutPending, "needs_plan_approval"),
    true
  );
  episode(withoutPending).originGate = "adr_approval";
  assert.equal(
    planningRestoreEligible(withoutPending, "needs_adr_approval"),
    true
  );
  const mutations: [string, (s: RunState) => void][] = [
    [
      "historical state",
      (s) => {
        s.schemaVersion = 9;
      }
    ],
    [
      "wrong status",
      (s) => {
        s.status = "planning";
      }
    ],
    [
      "wrong step",
      (s) => {
        episode(s).step = "applying";
      }
    ],
    [
      "missing record",
      (s) => {
        s.humanDecisions = [];
      }
    ],
    [
      "foreign record",
      (s) => {
        record(s).episodeId = "foreign";
      }
    ],
    [
      "record run",
      (s) => {
        record(s).runId = "foreign";
      }
    ],
    [
      "record number",
      (s) => {
        record(s).reviewNumber++;
      }
    ],
    [
      "record digest",
      (s) => {
        record(s).analysisDigest = "f".repeat(64);
      }
    ],
    [
      "option action",
      (s) => {
        record(s).dispositions[0] = {
          findingId: "P1-F1",
          kind: "option",
          optionId: "add-case",
          instruction: null
        };
      }
    ],
    [
      "own action",
      (s) => {
        record(s).dispositions[0] = {
          findingId: "P1-F1",
          kind: "instruction",
          optionId: null,
          instruction: "Revise"
        };
      }
    ],
    [
      "additional action",
      (s) => {
        record(s).additionalInstruction = "Revise";
      }
    ],
    [
      "active attempt",
      (s) => {
        s.activeAttempt = {
          id: "review",
          kind: "planning_review",
          mutable: false
        };
      }
    ],
    [
      "active process",
      (s) => {
        s.activeProcess = {
          pid: 1,
          kind: "planning_review",
          startedAt: "2026-10-14T00:00:00.000Z"
        };
      }
    ],
    [
      "foreign pending",
      (s) => {
        pending(s).episodeId = "foreign";
      }
    ],
    [
      "pending run",
      (s) => {
        pending(s).runId = "foreign";
      }
    ],
    [
      "pending origin",
      (s) => {
        pending(s).originGate = "adr_approval";
      }
    ],
    [
      "pending number",
      (s) => {
        pending(s).reviewNumber++;
      }
    ],
    [
      "pending digest",
      (s) => {
        pending(s).analysisDigest = "f".repeat(64);
      }
    ],
    [
      "other pending kind",
      (s) => {
        s.pendingHumanDecision = {
          kind: "escalation",
          phase: "plan",
          gate: "escalation",
          summary: "Choose",
          questions: [],
          requestedAt: "2026-10-14T00:00:00.000Z"
        };
      }
    ]
  ];
  for (const [name, mutate] of mutations) {
    const state = planningRestoreState();
    mutate(state);
    assert.equal(
      planningRestoreEligible(state, "needs_plan_approval"),
      false,
      name
    );
  }
  assert.equal(
    planningRestoreEligible(planningRestoreState(), "needs_adr_approval"),
    false
  );
  assert.equal(
    planningRestoreEligible(planningRestoreState(), "needs_plan_approval", [
      "changed.md"
    ]),
    false
  );
});

test("planning gate availability keeps historical approval authority", () => {
  assert.deepEqual(planningGateActions("plan_approval", 9, true), ["approve"]);
  assert.deepEqual(planningGateActions("adr_approval", 10, false), [
    "accept",
    "reject",
    "rework"
  ]);
  assert.deepEqual(planningGateActions("plan_approval", 10, true), [
    "approve",
    "rework",
    "review"
  ]);
});
test("review numbering uses both inventories, gaps and bounded canonical names", () => {
  assert.equal(
    nextPlanningReviewNumber(
      [{ reviewNumber: 2 }],
      ["planning-review-7.md", "planning-review-07.md", "review-99.md"]
    ),
    8
  );
  for (const filename of [
    "planning-review-1000000.md",
    "planning-review-9007199254740992.md"
  ])
    assert.throws(() => nextPlanningReviewNumber([], [filename]));
  for (const reviewNumber of [0, -1, 1.5, 1_000_001, Number.MAX_SAFE_INTEGER])
    assert.throws(() => nextPlanningReviewNumber([{ reviewNumber }], []));
});
test("scope rejects aliases, duplicates, traversal and non-members without echoing input", () => {
  const paths = [
    "documentation/description.md",
    "documentation/decision.md",
    "documentation/plan.md"
  ];
  assert.deepEqual(
    planningReviewScope(paths, [paths[2] ?? "", paths[0] ?? ""]),
    [paths[0], paths[2]]
  );
  for (const selection of [
    [],
    ["/private/secret"],
    ["documentation/../plan.md"],
    ["./documentation/plan.md"],
    ["documentation\\plan.md"],
    ["documentation/plan.md", "documentation/plan.md"]
  ])
    assert.throws(
      () => planningReviewScope(paths, selection),
      (error) =>
        error instanceof Error && !error.message.includes("/private/secret")
    );
});
test("triage actionability and stale verdict use facts only", () => {
  assert.equal(
    actionablePlanningTriage({
      dispositions: [
        {
          findingId: "P1-F1",
          kind: "decline",
          optionId: null,
          instruction: null
        }
      ],
      additionalInstruction: null
    }),
    false
  );
  assert.equal(
    actionablePlanningTriage({
      dispositions: [],
      additionalInstruction: "Owner instruction"
    }),
    true
  );
  assert.deepEqual(
    planningReviewStaleness(
      [
        { path: "a", sha256: "a".repeat(64) },
        { path: "b", sha256: "b".repeat(64) }
      ],
      [
        { path: "a", sha256: "a".repeat(64) },
        { path: "b", sha256: null }
      ]
    ),
    ["b"]
  );
});
