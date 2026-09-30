import type { RunState } from "../../types.js";

export interface RestoreEligibility {
  eligible: boolean;
  reason: string;
}

/**
 * The stored approval snapshot as the restore decision reads it. Digests are
 * computed by the runner; comparing them with the approval is the decision.
 */
export type ApprovalSnapshotFacts =
  | { present: false }
  | {
      present: true;
      digest: string;
      entriesDigest: string;
      contentsMatchEntries: boolean;
      paths: string[];
    };

export type RestoreEvidence = "approval_snapshot" | "current_bundle";

export interface RestoreFacts {
  state: Pick<RunState, "planApproval">;
  snapshot?: ApprovalSnapshotFacts;
  /** Digest of the current approved artifacts; null when they are unreadable. */
  currentBundleDigest?: string | null;
}

export type RestoreStep =
  | { kind: "decided"; eligibility: RestoreEligibility }
  | { kind: "needs"; evidence: "approval_snapshot" }
  | { kind: "needs"; evidence: "current_bundle"; paths: string[] };

const decided = (eligible: boolean, reason: string): RestoreStep => ({
  kind: "decided",
  eligibility: { eligible, reason }
});

/** Whether the approved planning artifacts can be restored from the snapshot. */
export function decideRestore(facts: RestoreFacts): RestoreStep {
  const approval = facts.state.planApproval;
  if (approval === null) {
    return decided(false, "The run has no recorded plan approval.");
  }
  const snapshot = facts.snapshot;
  if (snapshot === undefined)
    return { kind: "needs", evidence: "approval_snapshot" };
  if (!snapshot.present) {
    return decided(
      false,
      "This run predates approval snapshots; restore the approved bytes manually or cancel the run."
    );
  }
  const verified =
    snapshot.digest === approval.digest &&
    snapshot.entriesDigest === approval.digest &&
    snapshot.contentsMatchEntries &&
    JSON.stringify([...snapshot.paths].sort()) ===
      JSON.stringify([...approval.paths].sort());
  if (!verified) {
    return decided(
      false,
      "The stored approval snapshot does not verify against the recorded approval digest."
    );
  }
  if (facts.currentBundleDigest === undefined)
    return { kind: "needs", evidence: "current_bundle", paths: approval.paths };
  if (facts.currentBundleDigest === approval.digest) {
    return decided(
      false,
      "The approved planning artifacts already match the recorded approval."
    );
  }
  return decided(
    true,
    "The approved planning artifacts diverged from the recorded approval and can be restored from the snapshot."
  );
}
