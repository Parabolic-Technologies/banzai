import assert from "node:assert/strict";
import test from "node:test";
import type { RunStatus } from "../../../src/types.js";
import {
  nextAction,
  type NextActionPublication,
  type NextActionRecovery
} from "../../../src/workflow/domain/next-action.js";

const NO_RECOVERY: NextActionRecovery = {
  eligible: false,
  sourceKind: null,
  terminalCheckpointPresent: false
};

test("next-action selection reproduces every baseline outcome", () => {
  const rows: [
    string,
    RunStatus,
    boolean,
    NextActionRecovery,
    NextActionPublication | null,
    string | null
  ][] = [
    [
      "adr approval",
      "needs_adr_approval",
      false,
      NO_RECOVERY,
      null,
      "banzai approve adr"
    ],
    [
      "plan approval",
      "needs_plan_approval",
      false,
      NO_RECOVERY,
      null,
      "banzai approve plan"
    ],
    [
      "human decision",
      "needs_human_decision",
      false,
      NO_RECOVERY,
      null,
      "banzai"
    ],
    ["triage", "needs_triage", false, NO_RECOVERY, null, "banzai triage"],
    [
      "pending publication resume",
      "blocked",
      true,
      { eligible: true, sourceKind: "digest_rejected" },
      { pending: true, action: "resume" },
      "banzai resume"
    ],
    [
      "pending publication cancel",
      "blocked",
      false,
      NO_RECOVERY,
      { pending: true, action: "cancel" },
      "banzai cancel"
    ],
    [
      "pending publication without an action",
      "blocked",
      true,
      NO_RECOVERY,
      { pending: true, action: null },
      "banzai retry"
    ],
    [
      "settled publication",
      "blocked",
      true,
      NO_RECOVERY,
      { pending: false, action: "resume" },
      "banzai retry"
    ],
    [
      "digest-rejected recovery outranks retry",
      "blocked",
      true,
      { eligible: true, sourceKind: "digest_rejected" },
      null,
      "banzai recover"
    ],
    [
      "retry",
      "blocked",
      true,
      { eligible: true, sourceKind: "interrupted" },
      null,
      "banzai retry"
    ],
    [
      "recovery",
      "blocked",
      false,
      { eligible: true, sourceKind: "interrupted" },
      null,
      "banzai recover"
    ],
    [
      "terminal checkpoint",
      "blocked",
      false,
      { eligible: false, sourceKind: null, terminalCheckpointPresent: true },
      null,
      "banzai resume"
    ],
    [
      "no terminal checkpoint recorded",
      "blocked",
      false,
      { eligible: false, sourceKind: null },
      null,
      "banzai cancel"
    ],
    ["cancel", "blocked", false, NO_RECOVERY, null, "banzai cancel"],
    ...(
      [
        "created",
        "selecting",
        "planning",
        "plan_approved",
        "implementing",
        "verifying",
        "reviewing",
        "fixing"
      ] as const
    ).map(
      (
        status
      ): [
        string,
        RunStatus,
        boolean,
        NextActionRecovery,
        NextActionPublication | null,
        string | null
      ] => [
        `in progress (${status})`,
        status,
        false,
        NO_RECOVERY,
        null,
        "banzai resume"
      ]
    ),
    ["done", "done", false, NO_RECOVERY, null, null],
    ["cancelled", "cancelled", false, NO_RECOVERY, null, null]
  ];
  for (const [
    name,
    status,
    retryEligible,
    recovery,
    publication,
    expected
  ] of rows)
    assert.equal(
      nextAction(
        { status },
        { eligible: retryEligible },
        recovery,
        publication
      ),
      expected,
      name
    );
});
