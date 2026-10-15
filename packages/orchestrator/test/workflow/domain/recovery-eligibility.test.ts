import assert from "node:assert/strict";
import test from "node:test";
import type {
  AttemptRecord,
  AttemptReference,
  RunState
} from "../../../src/types.js";
import {
  decideRecovery,
  RECOVERY_WARNING,
  recoveryIneligible,
  type RecoveryEligibility,
  type RecoveryEvidence,
  type RecoveryFacts,
  type RecoveryStep
} from "../../../src/workflow/domain/recovery-eligibility.js";

const BASE_COMMIT = "b".repeat(40);

test("neither read-only planning kind can acquire mutable recovery authority", () => {
  for (const kind of ["planning_review", "planning_analysis"] as const) {
    const attempt = { id: `${kind}-1`, kind, mutable: false };
    const state = blocked({ blockedFrom: "planning", activeAttempt: attempt });
    const outcome = decideRecovery({ state, digestRejected: null });
    assert.equal(outcome.kind, "decided");
    assert.equal(outcome.eligibility.eligible, false);
    assert.equal(outcome.eligibility.phase, null);
  }
});
const IMPLEMENTATION: AttemptReference = {
  id: "implementation-1-abcdef12",
  kind: "implementation",
  mutable: true
};
const FIX: AttemptReference = {
  id: "fix-2-abcdef12",
  kind: "fix",
  mutable: true
};

function blocked(overrides: Partial<RunState> = {}): RunState {
  return {
    runId: "run-1",
    status: "blocked",
    blockedFrom: "implementing",
    blockReason: "Fixture block.",
    activeAttempt: IMPLEMENTATION,
    activeProcess: null,
    baseCommit: BASE_COMMIT,
    workflowSelection: null,
    planApproval: { digest: "a".repeat(64), paths: ["plan.md"] },
    planTaskCompletion: null,
    triage: null,
    ...overrides
  } as RunState;
}

function record(overrides: Partial<AttemptRecord> = {}): AttemptRecord {
  return {
    status: "started",
    result: null,
    failureCode: null,
    failureCause: null,
    ...overrides
  } as AttemptRecord;
}

/** Facts for an interrupted attempt that has passed every check before HEAD. */
function interrupted(state: RunState, extra: Partial<RecoveryFacts> = {}) {
  return {
    state,
    digestRejected: null,
    attemptRecord: { readable: true as const, record: record() },
    terminalCheckpoint: { readable: true as const, present: false },
    ...extra
  } satisfies RecoveryFacts;
}

function prepared(state: RunState, extra: Partial<RecoveryFacts> = {}) {
  return interrupted(state, {
    headCommit: BASE_COMMIT,
    configurationDigest: "c".repeat(64),
    approvalChecked: true,
    scopeDigest: "e".repeat(64),
    workspace: { baseCommit: BASE_COMMIT, digest: "d".repeat(64) },
    counts: {
      added: 1,
      modified: 2,
      deleted: 0,
      total: 3,
      recoveryIdentity: "f".repeat(64)
    },
    ...extra
  });
}

const decided = (eligibility: RecoveryEligibility): RecoveryStep => ({
  kind: "decided",
  eligibility
});

const ineligible = (
  reason: string,
  attemptId: string | null = IMPLEMENTATION.id,
  phase: RecoveryEligibility["phase"] = "implementation",
  terminalCheckpointPresent = false
) =>
  decided(
    recoveryIneligible(reason, attemptId, phase, terminalCheckpointPresent)
  );

function eligible(overrides: Partial<RecoveryEligibility> = {}): RecoveryStep {
  return decided({
    eligible: true,
    reason: `Interrupted implementation attempt ${IMPLEMENTATION.id} may be recovered only with current explicit authorization.`,
    warning: RECOVERY_WARNING,
    sourceKind: "interrupted",
    attemptId: IMPLEMENTATION.id,
    phase: "implementation",
    resolvedFindingIds: [],
    remainingFindingIds: [],
    prerequisites: [],
    authorization: "plan_approval",
    recoveryIdentity: "f".repeat(64),
    workspace: {
      digest: "d".repeat(64),
      added: 1,
      modified: 2,
      deleted: 0,
      total: 3
    },
    baseCommit: BASE_COMMIT,
    approvalDigest: "a".repeat(64),
    workflowDigest: null,
    scopeDigest: "e".repeat(64),
    configurationDigest: "c".repeat(64),
    ...overrides
  });
}

test("recovery decisions reproduce every baseline outcome from explicit facts", () => {
  const sourceDecision = recoveryIneligible("Source decision.", "x", "fix");
  const rows: [string, RecoveryFacts, RecoveryStep][] = [
    [
      "a run that is not blocked",
      { state: blocked({ status: "needs_triage" }) },
      decided(
        recoveryIneligible(
          "Recovery requires a blocked run, but the run is needs_triage."
        )
      )
    ],
    [
      "an attempt before the digest-rejected source is consulted",
      { state: blocked() },
      {
        kind: "needs",
        evidence: "digest_rejected_source",
        attempt: IMPLEMENTATION
      }
    ],
    [
      "an applicable digest-rejected source",
      { state: blocked(), digestRejected: sourceDecision },
      decided(sourceDecision)
    ],
    [
      "a fixing block without an attempt before its source is consulted",
      { state: blocked({ activeAttempt: null, blockedFrom: "fixing" }) },
      { kind: "needs", evidence: "prerequisite_blocked_fix_source" }
    ],
    [
      "the prerequisite-blocked fix source decision",
      {
        state: blocked({ activeAttempt: null, blockedFrom: "fixing" }),
        prerequisiteBlockedFix: sourceDecision
      },
      decided(sourceDecision)
    ],
    [
      "no attempt outside fixing",
      { state: blocked({ activeAttempt: null }) },
      decided(
        recoveryIneligible(
          "Recovery requires an interrupted mutable implementation or fix attempt.",
          null
        )
      )
    ],
    ...(
      [
        { id: "review-1-x", kind: "review", mutable: false },
        { id: "plan-1-x", kind: "plan", mutable: true }
      ] as const
    ).map((attempt): [string, RecoveryFacts, RecoveryStep] => [
      `a ${attempt.kind} attempt`,
      {
        state: blocked({ activeAttempt: attempt }),
        digestRejected: null
      },
      decided(
        recoveryIneligible(
          "Recovery requires an interrupted mutable implementation or fix attempt.",
          attempt.id
        )
      )
    ]),
    [
      "an attempt blocked from another status",
      { state: blocked({ blockedFrom: "verifying" }), digestRejected: null },
      ineligible(
        "The interrupted implementation attempt is inconsistent with blockedFrom=verifying."
      )
    ],
    [
      "an attempt without blockedFrom",
      { state: blocked({ blockedFrom: null }), digestRejected: null },
      ineligible(
        "The interrupted implementation attempt is inconsistent with blockedFrom=null."
      )
    ],
    [
      "a recorded process before its liveness is read",
      {
        state: blocked({
          activeProcess: {
            pid: 1,
            kind: "implementation",
            startedAt: "2026-07-01T00:00:00.000Z"
          }
        }),
        digestRejected: null
      },
      { kind: "needs", evidence: "process_liveness", pid: 1 }
    ],
    [
      "a live process",
      {
        state: blocked({
          activeProcess: {
            pid: 1,
            kind: "implementation",
            startedAt: "2026-07-01T00:00:00.000Z"
          }
        }),
        digestRejected: null,
        processAlive: true
      },
      ineligible(
        "Recovery is unavailable while the model process is still active."
      )
    ],
    [
      "an exited process before the attempt record is read",
      {
        state: blocked({
          activeProcess: {
            pid: 1,
            kind: "implementation",
            startedAt: "2026-07-01T00:00:00.000Z"
          }
        }),
        digestRejected: null,
        processAlive: false
      },
      { kind: "needs", evidence: "attempt_record", attempt: IMPLEMENTATION }
    ],
    [
      "an unreadable attempt record",
      {
        state: blocked(),
        digestRejected: null,
        attemptRecord: { readable: false }
      },
      ineligible("Recovery attempt evidence is unreadable or inconsistent.")
    ],
    [
      "a readable record before its checkpoint is read",
      {
        state: blocked(),
        digestRejected: null,
        attemptRecord: { readable: true, record: record() }
      },
      {
        kind: "needs",
        evidence: "terminal_checkpoint",
        attempt: IMPLEMENTATION
      }
    ],
    [
      "a malformed terminal checkpoint",
      interrupted(blocked(), { terminalCheckpoint: { readable: false } }),
      ineligible(
        "Terminal checkpoint evidence is malformed or conflicting; inspect or cancel the run."
      )
    ],
    [
      "a proven terminal checkpoint",
      interrupted(blocked(), {
        terminalCheckpoint: { readable: true, present: true }
      }),
      ineligible(
        "A terminal checkpoint exists; use banzai resume so Banzai can reconcile proven completion.",
        IMPLEMENTATION.id,
        "implementation",
        true
      )
    ],
    [
      "a terminal checkpoint whose result completion validation rejected",
      interrupted(
        blocked({
          planTaskCompletion: {
            status: "invalid",
            sourceAttemptId: IMPLEMENTATION.id
          } as NonNullable<RunState["planTaskCompletion"]>
        }),
        {
          attemptRecord: {
            readable: true,
            record: record({
              status: "failed",
              result: {} as AttemptRecord["result"],
              failureCode: "PLAN_TASK_COMPLETION_INVALID"
            })
          },
          terminalCheckpoint: { readable: true, present: true }
        }
      ),
      ineligible(
        "The terminal checkpoint result was rejected by completion validation; use banzai retry to repair its evidence.",
        IMPLEMENTATION.id,
        "implementation",
        true
      )
    ],
    ...(
      [
        ["completed", record({ status: "completed" })],
        ["failed without a recoverable cause", record({ status: "failed" })],
        [
          "failed for an unknown cause",
          record({ status: "failed", failureCause: "unclassified" })
        ],
        [
          "started with a result",
          record({ result: {} as AttemptRecord["result"] })
        ]
      ] as const
    ).map(([label, value]): [string, RecoveryFacts, RecoveryStep] => [
      `a record that is not an uncompleted interruption (${label})`,
      interrupted(blocked(), {
        attemptRecord: { readable: true, record: value }
      }),
      ineligible(
        `Attempt ${IMPLEMENTATION.id} is not an uncompleted interruption.`
      )
    ]),
    [
      "an interruption superseded by a recovery attempt",
      interrupted(
        blocked({
          recovery: {
            sourceAttemptId: IMPLEMENTATION.id,
            recoveryAttemptId: "implementation-recovery-x",
            authorizationId: "recovery-x"
          }
        })
      ),
      ineligible(
        "A later recovery attempt already supersedes this interruption."
      )
    ],
    [
      "failed preconditions",
      interrupted(blocked(), { preconditionsFailed: true }),
      ineligible(
        "Recovery preconditions could not be validated; inspect or cancel the run."
      )
    ],
    [
      "an interruption before HEAD is read",
      interrupted(blocked()),
      { kind: "needs", evidence: "head_commit" }
    ],
    [
      "a failed mutable attempt with a recoverable cause before HEAD is read",
      interrupted(blocked(), {
        attemptRecord: {
          readable: true,
          record: record({ status: "failed", failureCause: "capacity" })
        }
      }),
      { kind: "needs", evidence: "head_commit" }
    ],
    [
      "a moved HEAD",
      interrupted(blocked(), { headCommit: "c".repeat(40) }),
      ineligible("Recovery is unavailable because checkout HEAD changed.")
    ],
    [
      "a current HEAD before the configuration is read",
      interrupted(blocked(), { headCommit: BASE_COMMIT }),
      { kind: "needs", evidence: "configuration", role: "implementer" }
    ],
    [
      "a strict interruption before the approval check",
      interrupted(blocked(), {
        headCommit: BASE_COMMIT,
        configurationDigest: "c".repeat(64)
      }),
      { kind: "needs", evidence: "approval_check" }
    ],
    [
      "a lite interruption before the selection check",
      interrupted(
        blocked({
          workflowSelection: {
            workflow: "feature"
          } as NonNullable<RunState["workflowSelection"]>
        }),
        { headCommit: BASE_COMMIT, configurationDigest: "c".repeat(64) }
      ),
      { kind: "needs", evidence: "workflow_selection_check" }
    ],
    [
      "a lite fix still needs the approval check",
      interrupted(
        blocked({
          activeAttempt: FIX,
          blockedFrom: "fixing",
          workflowSelection: {
            workflow: "feature"
          } as NonNullable<RunState["workflowSelection"]>
        }),
        { headCommit: BASE_COMMIT, configurationDigest: "c".repeat(64) }
      ),
      { kind: "needs", evidence: "approval_check" }
    ],
    [
      "a fix before completion revalidation",
      interrupted(blocked({ activeAttempt: FIX, blockedFrom: "fixing" }), {
        headCommit: BASE_COMMIT,
        configurationDigest: "c".repeat(64),
        approvalChecked: true
      }),
      {
        kind: "needs",
        evidence: "completion_revalidation",
        allowReportRefresh: false,
        persistReportRefresh: true
      }
    ],
    [
      "a fix without accepted findings",
      interrupted(
        blocked({
          activeAttempt: FIX,
          blockedFrom: "fixing",
          triage: {
            items: [{ findingId: "R1-F1", disposition: "rejected" }]
          } as NonNullable<RunState["triage"]>
        }),
        {
          headCommit: BASE_COMMIT,
          configurationDigest: "c".repeat(64),
          approvalChecked: true,
          completionRevalidated: true
        }
      ),
      decided(
        recoveryIneligible(
          "Fix recovery requires a non-empty current accepted-finding scope.",
          FIX.id,
          "fix"
        )
      )
    ],
    [
      "a checked interruption before its scope digest",
      interrupted(blocked(), {
        headCommit: BASE_COMMIT,
        configurationDigest: "c".repeat(64),
        approvalChecked: true
      }),
      {
        kind: "needs",
        evidence: "attempt_scope_digest",
        attempt: IMPLEMENTATION
      }
    ],
    [
      "a scoped interruption before the workspace is read",
      interrupted(blocked(), {
        headCommit: BASE_COMMIT,
        configurationDigest: "c".repeat(64),
        approvalChecked: true,
        scopeDigest: null
      }),
      { kind: "needs", evidence: "workspace_snapshot" }
    ],
    [
      "a workspace on another base commit",
      interrupted(blocked(), {
        headCommit: BASE_COMMIT,
        configurationDigest: "c".repeat(64),
        approvalChecked: true,
        scopeDigest: null,
        workspace: { baseCommit: "c".repeat(40), digest: "d".repeat(64) }
      }),
      ineligible(
        "Recovery is unavailable because the workspace base commit changed."
      )
    ],
    [
      "a snapshot before its counts and identity",
      interrupted(blocked(), {
        headCommit: BASE_COMMIT,
        configurationDigest: "c".repeat(64),
        approvalChecked: true,
        scopeDigest: "e".repeat(64),
        workspace: { baseCommit: BASE_COMMIT, digest: "d".repeat(64) }
      }),
      {
        kind: "needs",
        evidence: "workspace_counts",
        identity: {
          version: 1,
          runId: "run-1",
          attempt: IMPLEMENTATION,
          phase: "implementation",
          baseCommit: BASE_COMMIT,
          workspaceDigest: "d".repeat(64),
          approvalDigest: "a".repeat(64),
          workflowDigest: null,
          scopeDigest: "e".repeat(64),
          configurationDigest: "c".repeat(64)
        }
      }
    ],
    ["an eligible strict interruption", prepared(blocked()), eligible()],
    [
      "an eligible strict interruption without a recorded approval",
      prepared(blocked({ planApproval: null })),
      eligible({ authorization: "workflow_selection", approvalDigest: null })
    ],
    [
      "an eligible lite interruption",
      interrupted(
        blocked({
          workflowSelection: {
            workflow: "feature"
          } as NonNullable<RunState["workflowSelection"]>
        }),
        {
          headCommit: BASE_COMMIT,
          configurationDigest: "c".repeat(64),
          workflowDigest: "9".repeat(64),
          scopeDigest: "e".repeat(64),
          workspace: { baseCommit: BASE_COMMIT, digest: "d".repeat(64) },
          counts: {
            added: 1,
            modified: 2,
            deleted: 0,
            total: 3,
            recoveryIdentity: "f".repeat(64)
          }
        }
      ),
      eligible({
        authorization: "workflow_selection",
        approvalDigest: null,
        workflowDigest: "9".repeat(64)
      })
    ],
    ...(
      [
        [
          "a pending authorization before it is read",
          undefined,
          {
            kind: "needs",
            evidence: "recovery_authorization",
            authorizationId: "recovery-1"
          }
        ],
        [
          "a stale authorization identity",
          { attemptId: IMPLEMENTATION.id, recoveryIdentity: "0".repeat(64) },
          ineligible(
            "Persisted recovery authorization is stale or inconsistent."
          )
        ],
        [
          "an authorization for another attempt",
          {
            attemptId: "implementation-9-other",
            recoveryIdentity: "f".repeat(64)
          },
          ineligible(
            "Persisted recovery authorization is stale or inconsistent."
          )
        ],
        [
          "a current authorization",
          { attemptId: IMPLEMENTATION.id, recoveryIdentity: "f".repeat(64) },
          eligible()
        ]
      ] as const
    ).map(
      ([label, authorization, expected]): [
        string,
        RecoveryFacts,
        RecoveryStep
      ] => {
        const state = blocked({
          recovery: {
            sourceAttemptId: IMPLEMENTATION.id,
            recoveryAttemptId: null,
            authorizationId: "recovery-1"
          }
        });
        return [
          label,
          authorization === undefined
            ? prepared(state)
            : prepared(state, { authorization }),
          expected
        ];
      }
    )
  ];
  for (const [name, facts, expected] of rows)
    assert.deepEqual(decideRecovery(facts), expected, name);
});

/** Supplies each named fact the way the runner shell gathers it. */
function drive(
  state: RunState,
  evidence: Partial<Omit<RecoveryFacts, "state">>
): RecoveryEvidence[] {
  const facts: RecoveryFacts = { state };
  const requested: RecoveryEvidence[] = [];
  const provide = (key: Exclude<keyof RecoveryFacts, "state">) => {
    if (!(key in evidence)) throw new Error(`Unexpected read of ${key}.`);
    Object.assign(facts, { [key]: evidence[key] });
  };
  for (;;) {
    const step = decideRecovery(facts);
    if (step.kind === "decided") return requested;
    requested.push(step.evidence);
    const key = {
      digest_rejected_source: "digestRejected",
      prerequisite_blocked_fix_source: "prerequisiteBlockedFix",
      process_liveness: "processAlive",
      attempt_record: "attemptRecord",
      terminal_checkpoint: "terminalCheckpoint",
      head_commit: "headCommit",
      configuration: "configurationDigest",
      approval_check: "approvalChecked",
      workflow_selection_check: "workflowDigest",
      completion_revalidation: "completionRevalidated",
      attempt_scope_digest: "scopeDigest",
      workspace_snapshot: "workspace",
      workspace_counts: "counts",
      recovery_authorization: "authorization"
    } as const satisfies Record<RecoveryEvidence, keyof RecoveryFacts>;
    provide(key[step.evidence]);
  }
}

test("recovery reads evidence in baseline order and only where its path needs it", () => {
  const full = {
    digestRejected: null,
    processAlive: false,
    attemptRecord: { readable: true, record: record() },
    terminalCheckpoint: { readable: true, present: false },
    headCommit: BASE_COMMIT,
    configurationDigest: "c".repeat(64),
    approvalChecked: true,
    workflowDigest: "9".repeat(64),
    completionRevalidated: true,
    scopeDigest: null,
    workspace: { baseCommit: BASE_COMMIT, digest: "d".repeat(64) },
    counts: {
      added: 0,
      modified: 0,
      deleted: 0,
      total: 0,
      recoveryIdentity: "f".repeat(64)
    },
    authorization: {
      attemptId: IMPLEMENTATION.id,
      recoveryIdentity: "f".repeat(64)
    }
  } satisfies Partial<RecoveryFacts>;
  assert.deepEqual(drive(blocked(), full), [
    "digest_rejected_source",
    "attempt_record",
    "terminal_checkpoint",
    "head_commit",
    "configuration",
    "approval_check",
    "attempt_scope_digest",
    "workspace_snapshot",
    "workspace_counts"
  ]);
  assert.deepEqual(
    drive(
      blocked({
        activeAttempt: FIX,
        blockedFrom: "fixing",
        triage: {
          items: [{ findingId: "R1-F1", disposition: "accepted" }]
        } as NonNullable<RunState["triage"]>,
        activeProcess: {
          pid: 1,
          kind: "fix",
          startedAt: "2026-07-01T00:00:00.000Z"
        },
        recovery: {
          sourceAttemptId: FIX.id,
          recoveryAttemptId: null,
          authorizationId: "recovery-1"
        }
      }),
      {
        ...full,
        authorization: { attemptId: FIX.id, recoveryIdentity: "f".repeat(64) }
      }
    ),
    [
      "digest_rejected_source",
      "process_liveness",
      "attempt_record",
      "terminal_checkpoint",
      "head_commit",
      "configuration",
      "approval_check",
      "completion_revalidation",
      "attempt_scope_digest",
      "workspace_snapshot",
      "workspace_counts",
      "recovery_authorization"
    ]
  );
  assert.deepEqual(
    drive(
      blocked({
        workflowSelection: {
          workflow: "feature"
        } as NonNullable<RunState["workflowSelection"]>
      }),
      full
    ),
    [
      "digest_rejected_source",
      "attempt_record",
      "terminal_checkpoint",
      "head_commit",
      "configuration",
      "workflow_selection_check",
      "attempt_scope_digest",
      "workspace_snapshot",
      "workspace_counts"
    ]
  );
  assert.deepEqual(drive(blocked(), { ...full, headCommit: "c".repeat(40) }), [
    "digest_rejected_source",
    "attempt_record",
    "terminal_checkpoint",
    "head_commit"
  ]);
  assert.deepEqual(
    drive(blocked(), { ...full, terminalCheckpoint: { readable: false } }),
    ["digest_rejected_source", "attempt_record", "terminal_checkpoint"]
  );
});
