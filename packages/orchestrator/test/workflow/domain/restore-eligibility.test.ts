import assert from "node:assert/strict";
import test from "node:test";
import type { RunState } from "../../../src/types.js";
import {
  decideRestore,
  type ApprovalSnapshotFacts,
  type RestoreFacts,
  type RestoreStep
} from "../../../src/workflow/domain/restore-eligibility.js";

const APPROVAL = {
  digest: "a".repeat(64),
  paths: ["plan.md", "description.md"]
};

function approved(): Pick<RunState, "planApproval"> {
  return {
    planApproval: APPROVAL as RunState["planApproval"]
  };
}

function snapshot(
  overrides: Partial<Extract<ApprovalSnapshotFacts, { present: true }>> = {}
): ApprovalSnapshotFacts {
  return {
    present: true,
    digest: APPROVAL.digest,
    entriesDigest: APPROVAL.digest,
    contentsMatchEntries: true,
    paths: ["description.md", "plan.md"],
    ...overrides
  };
}

const decided = (eligible: boolean, reason: string): RestoreStep => ({
  kind: "decided",
  eligibility: { eligible, reason }
});

const UNVERIFIED = decided(
  false,
  "The stored approval snapshot does not verify against the recorded approval digest."
);

test("restore decisions reproduce every baseline outcome from explicit facts", () => {
  const rows: [string, RestoreFacts, RestoreStep][] = [
    [
      "no recorded approval",
      { state: { planApproval: null } },
      decided(false, "The run has no recorded plan approval.")
    ],
    [
      "an approval before its snapshot is read",
      { state: approved() },
      { kind: "needs", evidence: "approval_snapshot" }
    ],
    [
      "a run that predates approval snapshots",
      { state: approved(), snapshot: { present: false } },
      decided(
        false,
        "This run predates approval snapshots; restore the approved bytes manually or cancel the run."
      )
    ],
    [
      "a snapshot digest that differs",
      { state: approved(), snapshot: snapshot({ digest: "b".repeat(64) }) },
      UNVERIFIED
    ],
    [
      "snapshot entries that digest differently",
      {
        state: approved(),
        snapshot: snapshot({ entriesDigest: "b".repeat(64) })
      },
      UNVERIFIED
    ],
    [
      "snapshot contents that do not match their entries",
      {
        state: approved(),
        snapshot: snapshot({ contentsMatchEntries: false })
      },
      UNVERIFIED
    ],
    [
      "snapshot paths that differ from the approval",
      { state: approved(), snapshot: snapshot({ paths: ["plan.md"] }) },
      UNVERIFIED
    ],
    [
      "a verified snapshot before the current bundle is read",
      { state: approved(), snapshot: snapshot() },
      { kind: "needs", evidence: "current_bundle", paths: APPROVAL.paths }
    ],
    [
      "current artifacts that already match",
      {
        state: approved(),
        snapshot: snapshot(),
        currentBundleDigest: APPROVAL.digest
      },
      decided(
        false,
        "The approved planning artifacts already match the recorded approval."
      )
    ],
    ...(
      [
        ["diverged", "c".repeat(64)],
        ["unreadable", null]
      ] as const
    ).map(
      ([label, currentBundleDigest]): [string, RestoreFacts, RestoreStep] => [
        `${label} current artifacts`,
        { state: approved(), snapshot: snapshot(), currentBundleDigest },
        decided(
          true,
          "The approved planning artifacts diverged from the recorded approval and can be restored from the snapshot."
        )
      ]
    )
  ];
  for (const [name, facts, expected] of rows)
    assert.deepEqual(decideRestore(facts), expected, name);
});
