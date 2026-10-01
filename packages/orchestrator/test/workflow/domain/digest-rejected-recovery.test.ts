import assert from "node:assert/strict";
import test from "node:test";
import type {
  AttemptRecord,
  AttemptReference,
  ResultDigestEvidence,
  RunState,
  WorkflowSelectionRecord
} from "../../../src/types.js";
import {
  decideDigestRejected,
  type DigestRejectedEvidence,
  type DigestRejectedFacts,
  type DigestRejectedStep
} from "../../../src/workflow/domain/digest-rejected-recovery.js";
import {
  type RecoveryEligibility,
  recoveryIneligible
} from "../../../src/workflow/domain/recovery-eligibility.js";

const BASE_COMMIT = "b".repeat(40);
const IMPLEMENTATION: AttemptReference = {
  id: "implementation-1-abcdef12",
  kind: "implementation",
  mutable: true
};
const PLAN: AttemptReference = {
  id: "plan-1-abcdef12",
  kind: "plan",
  mutable: true
};
const FIX: AttemptReference = {
  id: "fix-2-abcdef12",
  kind: "fix",
  mutable: true
};
const SELECTION = {
  workflow: "feature",
  digest: "9".repeat(64)
} as WorkflowSelectionRecord;
const PROCESS = {
  pid: 1,
  kind: "implementation",
  startedAt: "2026-07-01T00:00:00.000Z"
} as const;

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
    ...overrides
  } as RunState;
}

function record(
  attempt: AttemptReference,
  overrides: Partial<AttemptRecord> = {}
): AttemptRecord {
  return {
    attempt,
    status: "failed",
    startedAt: "2026-07-01T00:00:00.000Z",
    result: {} as AttemptRecord["result"],
    failureCode: "RESULT_DIGEST_REJECTED",
    ...overrides
  } as AttemptRecord;
}

function rejection(matched: boolean[] = [false, true]): ResultDigestEvidence {
  return {
    outcome: "rejected",
    comparisons: matched.map((value) => ({ matched: value }))
  } as ResultDigestEvidence;
}

/** Facts for an applicable source that has passed the liveness check. */
function applicable(
  state: RunState,
  attempt: AttemptReference,
  extra: Partial<DigestRejectedFacts> = {}
): DigestRejectedFacts {
  return {
    state,
    attempt,
    source: {
      readable: true,
      record: record(attempt),
      evidence: rejection()
    },
    ...extra
  };
}

/** Facts that reach the recovery identity for an implementation attempt. */
function prepared(
  state: RunState,
  attempt: AttemptReference = IMPLEMENTATION,
  extra: Partial<DigestRejectedFacts> = {}
): DigestRejectedFacts {
  return applicable(state, attempt, {
    terminalCheckpointPresent: true,
    attempts: [record(attempt)],
    headCommit: BASE_COMMIT,
    configurationDigest: "c".repeat(64),
    approvalChecked: true,
    scopeDigest: "e".repeat(64),
    evidenceDigest: "8".repeat(64),
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

const decided = (
  eligibility: RecoveryEligibility | null
): DigestRejectedStep => ({ kind: "decided", eligibility });

const ineligible = (
  reason: string,
  terminalCheckpointPresent = false,
  attempt: AttemptReference = IMPLEMENTATION
) =>
  decided(
    recoveryIneligible(
      reason,
      attempt.id,
      attempt.kind as RecoveryEligibility["phase"],
      terminalCheckpointPresent
    )
  );

function eligible(
  overrides: Partial<RecoveryEligibility> = {}
): DigestRejectedStep {
  return decided({
    eligible: true,
    terminalCheckpointPresent: true,
    reason:
      "The implementation result was refused because 1 digest it authored never matched the bytes it named. Recovery authorizes one linked implementation attempt to supply a corrected result; the rejected attempt and its result are retained.",
    warning:
      "The rejected attempt keeps its failed status and its result. Recovery authorizes one new attempt for the same phase and no additional scope; a replacement strict plan still passes the existing approval gate.",
    sourceKind: "digest_rejected",
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

const SUPERSEDED =
  "A later implementation attempt already supersedes this rejected result.";

test("digest-rejected decisions reproduce every baseline outcome from explicit facts", () => {
  const lite = blocked({ workflowSelection: SELECTION });
  const planning = blocked({
    blockedFrom: "planning",
    activeAttempt: PLAN,
    workflowSelection: SELECTION
  });
  const fixing = blocked({ blockedFrom: "fixing", activeAttempt: FIX });
  const rows: [string, DigestRejectedFacts, DigestRejectedStep][] = [
    ...(
      [
        { id: "review-1-x", kind: "review", mutable: false },
        { id: "selection-1-x", kind: "selection", mutable: false }
      ] as const
    ).map((attempt): [string, DigestRejectedFacts, DigestRejectedStep] => [
      `a ${attempt.kind} attempt`,
      { state: blocked(), attempt },
      decided(null)
    ]),
    [
      "an attempt blocked from another status",
      { state: blocked({ blockedFrom: "verifying" }), attempt: IMPLEMENTATION },
      decided(null)
    ],
    [
      "an attempt before its record and evidence are read",
      { state: blocked(), attempt: IMPLEMENTATION },
      { kind: "needs", evidence: "digest_source" }
    ],
    [
      "invalid digest evidence",
      {
        state: blocked(),
        attempt: IMPLEMENTATION,
        source: { readable: false, invalidEvidenceMessage: "Evidence is bad." }
      },
      ineligible("Evidence is bad. Audit the run before continuing.")
    ],
    [
      "an unreadable record or evidence",
      {
        state: blocked(),
        attempt: IMPLEMENTATION,
        source: { readable: false, invalidEvidenceMessage: null }
      },
      ineligible("Digest acceptance evidence is unreadable or inconsistent.")
    ],
    ...(
      [
        ["absent evidence", record(IMPLEMENTATION), null],
        [
          "accepted evidence",
          record(IMPLEMENTATION),
          { ...rejection(), outcome: "accepted" }
        ],
        [
          "a record that did not fail",
          record(IMPLEMENTATION, { status: "completed" }),
          rejection()
        ],
        [
          "another failure code",
          record(IMPLEMENTATION, { failureCode: "MODEL_FAILED" }),
          rejection()
        ],
        [
          "no failure code",
          record(IMPLEMENTATION, { failureCode: null }),
          rejection()
        ]
      ] as const
    ).map(
      ([label, value, evidence]): [
        string,
        DigestRejectedFacts,
        DigestRejectedStep
      ] => [
        `a source that does not apply (${label})`,
        {
          state: blocked(),
          attempt: IMPLEMENTATION,
          source: { readable: true, record: value, evidence }
        },
        decided(null)
      ]
    ),
    [
      "a completion-invalid failure before its checkpoint is read",
      applicable(blocked(), IMPLEMENTATION, {
        source: {
          readable: true,
          record: record(IMPLEMENTATION, {
            failureCode: "PLAN_TASK_COMPLETION_INVALID"
          }),
          evidence: rejection()
        }
      }),
      { kind: "needs", evidence: "terminal_checkpoint" }
    ],
    [
      "a recorded process before its liveness is read",
      applicable(blocked({ activeProcess: PROCESS }), IMPLEMENTATION),
      { kind: "needs", evidence: "process_liveness", pid: 1 }
    ],
    [
      "a live process",
      applicable(blocked({ activeProcess: PROCESS }), IMPLEMENTATION, {
        processAlive: true
      }),
      ineligible(
        "Recovery is unavailable while the model process is still active."
      )
    ],
    [
      "an exited process before the checkpoint is read",
      applicable(blocked({ activeProcess: PROCESS }), IMPLEMENTATION, {
        processAlive: false
      }),
      { kind: "needs", evidence: "terminal_checkpoint" }
    ],
    [
      "failed preconditions",
      applicable(blocked(), IMPLEMENTATION, { preconditionsFailed: true }),
      ineligible(
        "Digest-rejected recovery preconditions could not be validated; inspect or cancel the run."
      )
    ],
    [
      "a rejected result without a terminal checkpoint",
      applicable(blocked(), IMPLEMENTATION, {
        terminalCheckpointPresent: false
      }),
      ineligible(
        "The rejected implementation result has no terminal checkpoint, so its repository side effects are unknown. Inspect the checkout, then cancel the run."
      )
    ],
    [
      "a checkpoint before the attempt history is read",
      applicable(blocked(), IMPLEMENTATION, {
        terminalCheckpointPresent: true
      }),
      { kind: "needs", evidence: "attempt_history" }
    ],
    [
      "a later attempt of the same kind",
      prepared(blocked(), IMPLEMENTATION, {
        attempts: [
          record(IMPLEMENTATION),
          record(
            { ...IMPLEMENTATION, id: "implementation-2-abcdef12" },
            { startedAt: "2026-07-02T00:00:00.000Z" }
          )
        ]
      }),
      ineligible(SUPERSEDED, true)
    ],
    ...(
      [
        [
          "an earlier attempt of the same kind",
          record(
            { ...IMPLEMENTATION, id: "implementation-0-abcdef12" },
            { startedAt: "2026-06-30T00:00:00.000Z" }
          )
        ],
        [
          "a later attempt of another kind",
          record(FIX, { startedAt: "2026-07-02T00:00:00.000Z" })
        ]
      ] as const
    ).map(
      ([label, other]): [string, DigestRejectedFacts, DigestRejectedStep] => [
        `history that does not supersede (${label})`,
        prepared(blocked(), IMPLEMENTATION, {
          attempts: [record(IMPLEMENTATION), other]
        }),
        eligible()
      ]
    ),
    [
      "a source superseded by its recovery attempt",
      prepared(
        blocked({
          recovery: {
            sourceAttemptId: IMPLEMENTATION.id,
            recoveryAttemptId: "implementation-recovery-x",
            authorizationId: "recovery-x"
          }
        })
      ),
      ineligible(SUPERSEDED, true)
    ],
    [
      "a current history before HEAD is read",
      applicable(blocked(), IMPLEMENTATION, {
        terminalCheckpointPresent: true,
        attempts: []
      }),
      { kind: "needs", evidence: "head_commit" }
    ],
    [
      "a moved HEAD",
      prepared(blocked(), IMPLEMENTATION, { headCommit: "c".repeat(40) }),
      ineligible("Recovery is unavailable because checkout HEAD changed.")
    ],
    ...(
      [
        [IMPLEMENTATION, blocked(), "implementer"],
        [FIX, fixing, "implementer"],
        [PLAN, planning, "planner"]
      ] as const
    ).map(
      ([attempt, state, role]): [
        string,
        DigestRejectedFacts,
        DigestRejectedStep
      ] => [
        `a ${attempt.kind} source before its ${role} configuration`,
        applicable(state, attempt, {
          terminalCheckpointPresent: true,
          attempts: [],
          headCommit: BASE_COMMIT
        }),
        { kind: "needs", evidence: "configuration", role }
      ]
    ),
    [
      "a planning source without a workflow selection",
      prepared(
        blocked({ blockedFrom: "planning", activeAttempt: PLAN }),
        PLAN,
        { attempts: [] }
      ),
      ineligible(
        "Planning recovery requires the unchanged persisted workflow selection.",
        false,
        PLAN
      )
    ],
    [
      "a planning source before its selection is authorized",
      prepared(planning, PLAN, { attempts: [] }),
      {
        kind: "needs",
        evidence: "workflow_authorization",
        selection: SELECTION
      }
    ],
    [
      "a planning source whose selection changed",
      prepared(planning, PLAN, {
        attempts: [],
        workflowSelectionAuthorized: false
      }),
      ineligible(
        "Planning recovery requires the unchanged persisted workflow selection.",
        false,
        PLAN
      )
    ],
    [
      "a strict implementation before the approval check",
      prepared(blocked(), IMPLEMENTATION, { approvalChecked: false }),
      { kind: "needs", evidence: "approval_check" }
    ],
    [
      "a lite implementation before the selection check",
      prepared(lite, IMPLEMENTATION, { approvalChecked: false }),
      { kind: "needs", evidence: "workflow_selection_check" }
    ],
    [
      "a lite fix still needs the approval check",
      prepared(
        blocked({
          blockedFrom: "fixing",
          activeAttempt: FIX,
          workflowSelection: SELECTION
        }),
        FIX,
        { approvalChecked: false }
      ),
      { kind: "needs", evidence: "approval_check" }
    ],
    [
      "a checked source before its scope digest",
      applicable(blocked(), IMPLEMENTATION, {
        terminalCheckpointPresent: true,
        attempts: [],
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
      "a scoped source before its evidence digest",
      applicable(blocked(), IMPLEMENTATION, {
        terminalCheckpointPresent: true,
        attempts: [],
        headCommit: BASE_COMMIT,
        configurationDigest: "c".repeat(64),
        approvalChecked: true,
        scopeDigest: "e".repeat(64)
      }),
      {
        kind: "needs",
        evidence: "evidence_digest",
        digestEvidence: rejection()
      }
    ],
    [
      "a digested source before the workspace is read",
      applicable(blocked(), IMPLEMENTATION, {
        terminalCheckpointPresent: true,
        attempts: [],
        headCommit: BASE_COMMIT,
        configurationDigest: "c".repeat(64),
        approvalChecked: true,
        scopeDigest: "e".repeat(64),
        evidenceDigest: "8".repeat(64)
      }),
      { kind: "needs", evidence: "workspace_snapshot" }
    ],
    [
      "a workspace on another base commit",
      prepared(blocked(), IMPLEMENTATION, {
        workspace: { baseCommit: "c".repeat(40), digest: "d".repeat(64) }
      }),
      ineligible(
        "Recovery is unavailable because the workspace base commit changed."
      )
    ],
    [
      "a snapshot before its counts and identity",
      applicable(blocked(), IMPLEMENTATION, {
        terminalCheckpointPresent: true,
        attempts: [],
        headCommit: BASE_COMMIT,
        configurationDigest: "c".repeat(64),
        approvalChecked: true,
        scopeDigest: "e".repeat(64),
        evidenceDigest: "8".repeat(64),
        workspace: { baseCommit: BASE_COMMIT, digest: "d".repeat(64) }
      }),
      {
        kind: "needs",
        evidence: "workspace_counts",
        identity: {
          version: 1,
          sourceKind: "digest_rejected",
          runId: "run-1",
          attempt: IMPLEMENTATION,
          phase: "implementation",
          baseCommit: BASE_COMMIT,
          workspaceDigest: "d".repeat(64),
          approvalDigest: "a".repeat(64),
          workflowDigest: null,
          scopeDigest: "e".repeat(64),
          configurationDigest: "c".repeat(64),
          digestEvidence: "8".repeat(64)
        }
      }
    ],
    ["an eligible strict implementation", prepared(blocked()), eligible()],
    [
      "an eligible strict implementation without a recorded approval",
      prepared(blocked({ planApproval: null })),
      eligible({ authorization: "workflow_selection", approvalDigest: null })
    ],
    [
      "an eligible source that names every unmatched digest",
      prepared(blocked(), IMPLEMENTATION, {
        source: {
          readable: true,
          record: record(IMPLEMENTATION),
          evidence: rejection([false, false, true])
        }
      }),
      eligible({
        reason:
          "The implementation result was refused because 2 digest it authored never matched the bytes it named. Recovery authorizes one linked implementation attempt to supply a corrected result; the rejected attempt and its result are retained."
      })
    ],
    [
      "an eligible lite implementation",
      prepared(lite, IMPLEMENTATION, {
        approvalChecked: false,
        workflowDigest: "9".repeat(64)
      }),
      eligible({
        authorization: "workflow_selection",
        approvalDigest: null,
        workflowDigest: "9".repeat(64)
      })
    ],
    [
      "an eligible planning source",
      prepared(planning, PLAN, {
        attempts: [],
        workflowSelectionAuthorized: true
      }),
      eligible({
        reason:
          "The plan result was refused because 1 digest it authored never matched the bytes it named. Recovery authorizes one linked plan attempt to supply a corrected result; the rejected attempt and its result are retained.",
        attemptId: PLAN.id,
        phase: "plan",
        authorization: "workflow_selection",
        approvalDigest: null,
        workflowDigest: "9".repeat(64)
      })
    ],
    [
      "an eligible fix",
      prepared(fixing, FIX),
      eligible({
        reason:
          "The fix result was refused because 1 digest it authored never matched the bytes it named. Recovery authorizes one linked fix attempt to supply a corrected result; the rejected attempt and its result are retained.",
        attemptId: FIX.id,
        phase: "fix"
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
        DigestRejectedFacts,
        DigestRejectedStep
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
            : prepared(state, IMPLEMENTATION, { authorization }),
          expected
        ];
      }
    )
  ];
  for (const [name, facts, expected] of rows)
    assert.deepEqual(decideDigestRejected(facts), expected, name);
});

/** Supplies each named fact the way the runner shell gathers it. */
function drive(
  state: RunState,
  attempt: AttemptReference,
  evidence: Partial<Omit<DigestRejectedFacts, "state" | "attempt">>
): DigestRejectedEvidence[] {
  const facts: DigestRejectedFacts = { state, attempt };
  const requested: DigestRejectedEvidence[] = [];
  for (;;) {
    const step = decideDigestRejected(facts);
    if (step.kind === "decided") return requested;
    requested.push(step.evidence);
    const key = {
      digest_source: "source",
      process_liveness: "processAlive",
      terminal_checkpoint: "terminalCheckpointPresent",
      attempt_history: "attempts",
      head_commit: "headCommit",
      configuration: "configurationDigest",
      workflow_authorization: "workflowSelectionAuthorized",
      approval_check: "approvalChecked",
      workflow_selection_check: "workflowDigest",
      completion_revalidation: "completionRevalidated",
      attempt_scope_digest: "scopeDigest",
      evidence_digest: "evidenceDigest",
      workspace_snapshot: "workspace",
      workspace_counts: "counts",
      recovery_authorization: "authorization"
    } as const satisfies Record<
      DigestRejectedEvidence,
      Exclude<keyof DigestRejectedFacts, "state" | "attempt">
    >;
    const name = key[step.evidence];
    if (!(name in evidence)) throw new Error(`Unexpected read of ${name}.`);
    Object.assign(facts, { [name]: evidence[name] });
  }
}

test("digest-rejected recovery reads evidence in baseline order and only where its path needs it", () => {
  const full = {
    source: {
      readable: true as const,
      record: record(IMPLEMENTATION),
      evidence: rejection()
    },
    processAlive: false,
    terminalCheckpointPresent: true,
    attempts: [],
    headCommit: BASE_COMMIT,
    configurationDigest: "c".repeat(64),
    workflowSelectionAuthorized: true,
    approvalChecked: true,
    workflowDigest: "9".repeat(64),
    scopeDigest: "e".repeat(64),
    evidenceDigest: "8".repeat(64),
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
  } satisfies Partial<DigestRejectedFacts>;
  const tail = [
    "attempt_scope_digest",
    "evidence_digest",
    "workspace_snapshot",
    "workspace_counts"
  ];
  assert.deepEqual(drive(blocked(), IMPLEMENTATION, full), [
    "digest_source",
    "terminal_checkpoint",
    "attempt_history",
    "head_commit",
    "configuration",
    "approval_check",
    ...tail
  ]);
  assert.deepEqual(
    drive(
      blocked({
        activeProcess: PROCESS,
        recovery: {
          sourceAttemptId: IMPLEMENTATION.id,
          recoveryAttemptId: null,
          authorizationId: "recovery-1"
        }
      }),
      IMPLEMENTATION,
      full
    ),
    [
      "digest_source",
      "process_liveness",
      "terminal_checkpoint",
      "attempt_history",
      "head_commit",
      "configuration",
      "approval_check",
      ...tail,
      "recovery_authorization"
    ]
  );
  assert.deepEqual(
    drive(
      blocked({
        blockedFrom: "planning",
        activeAttempt: PLAN,
        workflowSelection: SELECTION
      }),
      PLAN,
      { ...full, source: { ...full.source, record: record(PLAN) } }
    ),
    [
      "digest_source",
      "terminal_checkpoint",
      "attempt_history",
      "head_commit",
      "configuration",
      "workflow_authorization",
      ...tail
    ]
  );
  assert.deepEqual(
    drive(blocked({ workflowSelection: SELECTION }), IMPLEMENTATION, full),
    [
      "digest_source",
      "terminal_checkpoint",
      "attempt_history",
      "head_commit",
      "configuration",
      "workflow_selection_check",
      ...tail
    ]
  );
  assert.deepEqual(
    drive(blocked(), IMPLEMENTATION, {
      ...full,
      source: { ...full.source, evidence: null }
    }),
    ["digest_source"]
  );
  assert.deepEqual(
    drive(blocked(), IMPLEMENTATION, { ...full, headCommit: "c".repeat(40) }),
    ["digest_source", "terminal_checkpoint", "attempt_history", "head_commit"]
  );
});
