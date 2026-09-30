import assert from "node:assert/strict";
import test from "node:test";
import type {
  AttemptRecord,
  AttemptReference,
  PersistedPhaseResult,
  ReviewResult,
  RunState
} from "../../../src/types.js";
import {
  decidePrerequisiteBlockedFix,
  decidePrerequisiteScope,
  decidePrerequisiteSource,
  type PrerequisiteBlockedFixEvidence,
  type PrerequisiteBlockedFixFacts,
  type PrerequisiteBlockedFixStep,
  type PrerequisiteCheckpoint,
  type PrerequisiteScope,
  type PrerequisiteScopeFacts,
  type PrerequisiteScopeStep,
  type PrerequisiteSourceFacts,
  type PrerequisiteSourceStep
} from "../../../src/workflow/domain/prerequisite-blocked-fix.js";
import {
  type RecoveryEligibility,
  recoveryIneligible
} from "../../../src/workflow/domain/recovery-eligibility.js";

const BASE_COMMIT = "b".repeat(40);
const FIX = { id: "fix-2-abcdef12", kind: "fix", mutable: true } as const;
const BLOCK = "Operator must restore the fixture.";

function state(overrides: Partial<RunState> = {}): RunState {
  return {
    runId: "run-1",
    status: "blocked",
    blockedFrom: "fixing",
    blockReason: BLOCK,
    activeAttempt: null,
    activeProcess: null,
    baseCommit: BASE_COMMIT,
    workflowSelection: null,
    planApproval: { digest: "a".repeat(64), paths: ["plan.md"] },
    reviewIteration: 1,
    latestReview: { iteration: 1 },
    triage: {
      reviewIteration: 1,
      items: [
        { findingId: "R1-F1", disposition: "accepted" },
        { findingId: "R1-F2", disposition: "accepted" },
        { findingId: "R1-F3", disposition: "rejected" }
      ]
    },
    recovery: null,
    ...overrides
  } as RunState;
}

function record(
  overrides: Partial<AttemptRecord> = {},
  attempt: AttemptReference = FIX
): AttemptRecord {
  return {
    attempt,
    status: "completed",
    result: {} as AttemptRecord["result"],
    recoveryOf: null,
    recoveryAuthorizationId: null,
    ...overrides
  } as AttemptRecord;
}

function result(
  overrides: Partial<Record<string, unknown>> = {}
): PersistedPhaseResult {
  return {
    phase: "fix",
    outcome: "blocked",
    gate: null,
    taskCompletion: null,
    summary: BLOCK,
    resolvedFindingIds: ["R1-F1"],
    questions: ["Restore the fixture before R1-F2 can proceed."],
    requestedVerification: [],
    ...overrides
  } as unknown as PersistedPhaseResult;
}

const REVIEW = {
  findings: [
    { id: "R1-F1", evidence: [{ path: "src/one.ts" }] },
    { id: "R1-F2", evidence: [{ path: "src/two.ts" }] },
    { id: "R1-F3", evidence: [{ path: "src/three.ts" }] }
  ]
} as unknown as ReviewResult;

const SCOPE: PrerequisiteScope = {
  attempt: FIX,
  reviewIteration: 1,
  acceptedFindingIds: ["R1-F1", "R1-F2"],
  resolvedFindingIds: ["R1-F1"],
  remainingFindingIds: ["R1-F2"],
  prerequisites: ["Restore the fixture before R1-F2 can proceed."]
};

function scoped(
  facts: Partial<PrerequisiteScopeFacts> = {}
): PrerequisiteScopeFacts {
  return {
    state: state(),
    record: record(),
    requirePersistedBlock: true,
    result: result(),
    review: REVIEW,
    ...facts
  };
}

const invalid = (
  code: "RECOVERY_SOURCE_INVALID" | "RECOVERY_SCOPE_INVALID",
  message: string
) => ({ kind: "invalid", code, message }) as const;

const SOURCE_INVALID = invalid(
  "RECOVERY_SOURCE_INVALID",
  "Prerequisite recovery requires an unrecovered completed fix attempt."
);
const RESULT_INVALID = invalid(
  "RECOVERY_SOURCE_INVALID",
  "The completed fix result does not match the current prerequisite block."
);
const REVIEW_INVALID = invalid(
  "RECOVERY_SCOPE_INVALID",
  "Prerequisite recovery requires one current strict review and triage."
);
const TRIAGE_INVALID = invalid(
  "RECOVERY_SCOPE_INVALID",
  "Current triage does not exactly cover the current review."
);
const PROGRESS_INVALID = invalid(
  "RECOVERY_SCOPE_INVALID",
  "The blocked fix result does not prove valid partial accepted-finding progress."
);
const REMAINDER_INVALID = invalid(
  "RECOVERY_SCOPE_INVALID",
  "The blocked fix result has no remaining accepted scope or concrete prerequisite."
);

function triage(
  items: [string, "accepted" | "rejected"][]
): NonNullable<RunState["triage"]> {
  return {
    reviewIteration: 1,
    items: items.map(([findingId, disposition]) => ({
      findingId,
      disposition
    }))
  } as NonNullable<RunState["triage"]>;
}

test("prerequisite scope decisions reproduce every baseline outcome from explicit facts", () => {
  const rows: [string, PrerequisiteScopeFacts, PrerequisiteScopeStep][] = [
    ...(
      [
        ["an immutable attempt", record({}, { ...FIX, mutable: false })],
        [
          "an implementation attempt",
          record(
            {},
            { id: "implementation-1-x", kind: "implementation", mutable: true }
          )
        ],
        ["a started attempt", record({ status: "started" })],
        ["a completed attempt without a result", record({ result: null })],
        ["a recovery attempt", record({ recoveryOf: "fix-1-x" })],
        [
          "an attempt run under an authorization",
          record({ recoveryAuthorizationId: "recovery-x" })
        ]
      ] as const
    ).map(
      ([label, value]): [
        string,
        PrerequisiteScopeFacts,
        PrerequisiteScopeStep
      ] => [label, scoped({ record: value }), SOURCE_INVALID]
    ),
    [
      "a source before its result is parsed",
      {
        state: state(),
        record: record({
          result: { raw: true } as unknown as AttemptRecord["result"]
        }),
        requirePersistedBlock: true
      },
      { kind: "needs", evidence: "phase_result", raw: { raw: true } }
    ],
    ...(
      [
        ["another phase", { phase: "implementation" }],
        ["a completed outcome", { outcome: "completed" }],
        ["a gated result", { gate: "escalation" }],
        ["a completion ledger", { taskCompletion: [] }],
        ["a summary that is not the block reason", { summary: "Other." }]
      ] as const
    ).map(
      ([label, overrides]): [
        string,
        PrerequisiteScopeFacts,
        PrerequisiteScopeStep
      ] => [
        `a result with ${label}`,
        scoped({ result: result(overrides) }),
        RESULT_INVALID
      ]
    ),
    ...(
      [
        [
          "a lite run",
          state({
            workflowSelection: { workflow: "feature" } as NonNullable<
              RunState["workflowSelection"]
            >
          })
        ],
        ["no review", state({ latestReview: null })],
        ["no triage", state({ triage: null })],
        ["a newer review iteration", state({ reviewIteration: 2 })],
        [
          "triage of an older review",
          state({ triage: { ...triage([]), reviewIteration: 0 } })
        ]
      ] as const
    ).map(
      ([label, value]): [
        string,
        PrerequisiteScopeFacts,
        PrerequisiteScopeStep
      ] => [label, scoped({ state: value }), REVIEW_INVALID]
    ),
    [
      "a current review before it is read",
      {
        state: state(),
        record: record(),
        requirePersistedBlock: true,
        result: result()
      },
      { kind: "needs", evidence: "latest_review" }
    ],
    ...(
      [
        [
          "a duplicated triage item",
          triage([
            ["R1-F1", "accepted"],
            ["R1-F1", "accepted"],
            ["R1-F2", "accepted"]
          ])
        ],
        [
          "a missing triage item",
          triage([
            ["R1-F1", "accepted"],
            ["R1-F2", "accepted"]
          ])
        ],
        [
          "an unknown triage item",
          triage([
            ["R1-F1", "accepted"],
            ["R1-F2", "accepted"],
            ["R1-F9", "rejected"]
          ])
        ]
      ] as const
    ).map(
      ([label, value]): [
        string,
        PrerequisiteScopeFacts,
        PrerequisiteScopeStep
      ] => [label, scoped({ state: state({ triage: value }) }), TRIAGE_INVALID]
    ),
    [
      "no accepted findings",
      scoped({
        state: state({
          triage: triage([
            ["R1-F1", "rejected"],
            ["R1-F2", "rejected"],
            ["R1-F3", "rejected"]
          ])
        })
      }),
      PROGRESS_INVALID
    ],
    ...(
      [
        ["no resolved findings", []],
        ["a duplicated resolved finding", ["R1-F1", "R1-F1"]],
        ["a resolved finding that was not accepted", ["R1-F3"]]
      ] as const
    ).map(
      ([label, resolved]): [
        string,
        PrerequisiteScopeFacts,
        PrerequisiteScopeStep
      ] => [
        label,
        scoped({ result: result({ resolvedFindingIds: resolved }) }),
        PROGRESS_INVALID
      ]
    ),
    [
      "every accepted finding resolved",
      scoped({ result: result({ resolvedFindingIds: ["R1-F1", "R1-F2"] }) }),
      REMAINDER_INVALID
    ],
    [
      "prerequisites that only concern resolved findings",
      scoped({
        result: result({
          questions: ["Confirm R1-F1 again."],
          requestedVerification: ["Rerun src/one.ts checks."]
        })
      }),
      REMAINDER_INVALID
    ],
    [
      "a blank prerequisite",
      scoped({ result: result({ questions: ["  "] }) }),
      REMAINDER_INVALID
    ],
    [
      "an exact remaining scope",
      scoped(),
      { kind: "scoped", scope: SCOPE, result: result(), review: REVIEW }
    ],
    [
      "a result that need not restate the block",
      scoped({
        requirePersistedBlock: false,
        result: result({ summary: "Other." })
      }),
      {
        kind: "scoped",
        scope: SCOPE,
        result: result({ summary: "Other." }),
        review: REVIEW
      }
    ],
    [
      "prerequisites matched by identifier and by evidence path",
      scoped({
        result: result({
          resolvedFindingIds: ["R1-F2", "R1-F1"],
          questions: [" Unrelated operator step. ", "Confirm R1-F1 again."],
          requestedVerification: ["Check src/two.ts", "R1-F10 is separate"]
        }),
        state: state({
          triage: triage([
            ["R1-F1", "accepted"],
            ["R1-F2", "accepted"],
            ["R1-F3", "accepted"]
          ])
        })
      }),
      {
        kind: "scoped",
        scope: {
          ...SCOPE,
          acceptedFindingIds: ["R1-F1", "R1-F2", "R1-F3"],
          resolvedFindingIds: ["R1-F1", "R1-F2"],
          remainingFindingIds: ["R1-F3"],
          prerequisites: ["Unrelated operator step.", "R1-F10 is separate"]
        },
        result: result({
          resolvedFindingIds: ["R1-F2", "R1-F1"],
          questions: [" Unrelated operator step. ", "Confirm R1-F1 again."],
          requestedVerification: ["Check src/two.ts", "R1-F10 is separate"]
        }),
        review: REVIEW
      }
    ]
  ];
  for (const [name, facts, expected] of rows)
    assert.deepEqual(decidePrerequisiteScope(facts), expected, name);
});

type Candidate = PrerequisiteScope & { label: string };

const CANDIDATE: Candidate = { ...SCOPE, label: "candidate" };
const CHECKPOINT: PrerequisiteCheckpoint = {
  baseCommit: BASE_COMMIT,
  approvalDigest: "a".repeat(64),
  scopeDigest: "e".repeat(64),
  resultDigest: "7".repeat(64),
  expectedScopeDigest: "e".repeat(64),
  sourceResultDigest: "7".repeat(64)
};

function descendant(overrides: Partial<AttemptRecord> = {}): AttemptRecord {
  return record(
    {
      status: "started",
      result: null,
      recoveryOf: FIX.id,
      recoveryAuthorizationId: "recovery-1",
      ...overrides
    },
    { id: "fix-recovery-1", kind: "fix", mutable: true }
  );
}

const PRESERVED = {
  authorizationId: "recovery-1",
  sourceAttemptId: FIX.id,
  recoveryAttemptId: null,
  stage: "source_preserved"
} as NonNullable<RunState["recovery"]>;

function selected(
  facts: Partial<PrerequisiteSourceFacts<Candidate>> = {}
): PrerequisiteSourceFacts<Candidate> {
  return {
    state: state(),
    records: [record()],
    candidates: [CANDIDATE],
    checkpoint: null,
    ...facts
  };
}

test("prerequisite source decisions reproduce every baseline outcome from explicit facts", () => {
  const ambiguous = (message: string) =>
    ({ kind: "invalid", code: "RECOVERY_SOURCE_AMBIGUOUS", message }) as const;
  const started = {
    kind: "invalid",
    code: "RECOVERY_ALREADY_STARTED",
    message:
      "A recovery descendant already exists for the completed blocked fix source."
  } as const;
  const changed = {
    kind: "invalid",
    code: "RECOVERY_STATE_CHANGED",
    message:
      "Persisted recovery state does not match the completed blocked fix source."
  } as const;
  const conflicting = {
    kind: "invalid",
    code: "INVALID_TERMINAL_CHECKPOINT",
    message:
      "The completed blocked source conflicts with its terminal checkpoint."
  } as const;
  const chosen = { kind: "decided", source: CANDIDATE } as const;
  const rows: [
    string,
    PrerequisiteSourceFacts<Candidate>,
    PrerequisiteSourceStep<Candidate>
  ][] = [
    [
      "a source before the attempts are read",
      { state: state() },
      { kind: "needs", evidence: "attempt_records" }
    ],
    [
      "attempts before their scopes are derived",
      {
        state: state(),
        records: [
          record(),
          record({ status: "started" }),
          record({ result: null }),
          record(
            {},
            { id: "implementation-1-x", kind: "implementation", mutable: true }
          )
        ]
      },
      { kind: "needs", evidence: "candidate_scopes", records: [record()] }
    ],
    [
      "no exact candidate",
      selected({ candidates: [] }),
      ambiguous(
        "No exact completed prerequisite-blocked fix source is available."
      )
    ],
    [
      "two exact candidates",
      selected({ candidates: [CANDIDATE, CANDIDATE] }),
      ambiguous(
        "Multiple completed blocked fix attempts match the current review; recovery is ambiguous."
      )
    ],
    [
      "an unprepared recovery descendant",
      selected({ records: [record(), descendant()] }),
      started
    ],
    ...(
      [
        ["a completed descendant", descendant({ status: "completed" })],
        [
          "a descendant with another identity",
          record(
            {
              recoveryOf: FIX.id,
              status: "started",
              result: null,
              recoveryAuthorizationId: "recovery-1"
            },
            { id: "fix-recovery-9", kind: "fix", mutable: true }
          )
        ],
        [
          "a descendant of another authorization",
          descendant({ recoveryAuthorizationId: "recovery-9" })
        ]
      ] as const
    ).map(
      ([label, value]): [
        string,
        PrerequisiteSourceFacts<Candidate>,
        PrerequisiteSourceStep<Candidate>
      ] => [
        `${label} of a preserved source`,
        selected({
          state: state({ recovery: PRESERVED }),
          records: [record(), value]
        }),
        started
      ]
    ),
    [
      "two descendants of a preserved source",
      selected({
        state: state({ recovery: PRESERVED }),
        records: [record(), descendant(), descendant()]
      }),
      started
    ],
    [
      "a prepared descendant of a preserved source",
      selected({
        state: state({ recovery: PRESERVED }),
        records: [record(), descendant()]
      }),
      chosen
    ],
    [
      "a prepared descendant before the source is preserved",
      selected({
        state: state({
          recovery: { ...PRESERVED, stage: "source_interrupted" }
        }),
        records: [record(), descendant()]
      }),
      started
    ],
    [
      "recovery state for another source",
      selected({
        state: state({ recovery: { ...PRESERVED, sourceAttemptId: "fix-9-x" } })
      }),
      changed
    ],
    [
      "recovery state with a started recovery attempt",
      selected({
        state: state({
          recovery: { ...PRESERVED, recoveryAttemptId: "fix-recovery-1" }
        })
      }),
      changed
    ],
    [
      "a source before its checkpoint is read",
      { state: state(), records: [record()], candidates: [CANDIDATE] },
      { kind: "needs", evidence: "terminal_checkpoint", source: CANDIDATE }
    ],
    ["a source without a terminal checkpoint", selected(), chosen],
    [
      "a source with a consistent terminal checkpoint",
      selected({ checkpoint: CHECKPOINT }),
      chosen
    ],
    ...(
      [
        ["base commit", { baseCommit: "c".repeat(40) }],
        ["approval digest", { approvalDigest: "0".repeat(64) }],
        ["scope digest", { scopeDigest: "0".repeat(64) }],
        ["result digest", { resultDigest: "0".repeat(64) }]
      ] as const
    ).map(
      ([label, overrides]): [
        string,
        PrerequisiteSourceFacts<Candidate>,
        PrerequisiteSourceStep<Candidate>
      ] => [
        `a terminal checkpoint with another ${label}`,
        selected({ checkpoint: { ...CHECKPOINT, ...overrides } }),
        conflicting
      ]
    ),
    [
      "a checkpoint without approval beside an unapproved run",
      selected({
        state: state({ planApproval: null }),
        checkpoint: { ...CHECKPOINT, approvalDigest: null }
      }),
      conflicting
    ]
  ];
  for (const [name, facts, expected] of rows)
    assert.deepEqual(decidePrerequisiteSource(facts), expected, name);
});

const SOURCE = { ...SCOPE, scopeDigest: "e".repeat(64) };
const PRECONDITION_REASON =
  "Prerequisite recovery requires a completed blocked fix with no active attempt or process.";

function prepared(
  value: RunState = state(),
  extra: Partial<PrerequisiteBlockedFixFacts> = {}
): PrerequisiteBlockedFixFacts {
  return {
    state: value,
    headCommit: BASE_COMMIT,
    approvalChecked: true,
    completionRevalidated: true,
    source: SOURCE,
    configurationDigest: "c".repeat(64),
    workspace: { baseCommit: BASE_COMMIT, digest: "d".repeat(64) },
    counts: {
      added: 1,
      modified: 2,
      deleted: 0,
      total: 3,
      recoveryIdentity: "f".repeat(64)
    },
    ...extra
  };
}

const fixDecision = (eligibility: RecoveryEligibility) =>
  ({ kind: "decided", eligibility }) as const;

function eligibleFix(
  overrides: Partial<RecoveryEligibility> = {}
): PrerequisiteBlockedFixStep {
  return fixDecision({
    eligible: true,
    reason: `Completed blocked fix attempt ${FIX.id} may be recovered for remaining accepted findings R1-F2 after 1 operator prerequisite.`,
    warning:
      "The source attempt remains completed and blocked. Recovery authorizes one new fix attempt for the exact remaining accepted scope after the displayed prerequisites are addressed.",
    sourceKind: "prerequisite_blocked_fix",
    attemptId: FIX.id,
    phase: "fix",
    resolvedFindingIds: ["R1-F1"],
    remainingFindingIds: ["R1-F2"],
    prerequisites: ["Restore the fixture before R1-F2 can proceed."],
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

test("prerequisite-blocked fix eligibility reproduces every baseline outcome from explicit facts", () => {
  const process = {
    pid: 1,
    kind: "fix",
    startedAt: "2026-07-01T00:00:00.000Z"
  } as const;
  const pending = state({ recovery: PRESERVED });
  const rows: [
    string,
    PrerequisiteBlockedFixFacts,
    PrerequisiteBlockedFixStep
  ][] = [
    [
      "a block from another status",
      { state: state({ blockedFrom: "implementing" }) },
      fixDecision(recoveryIneligible(PRECONDITION_REASON, null, "fix"))
    ],
    [
      "an active attempt",
      { state: state({ activeAttempt: FIX }) },
      fixDecision(recoveryIneligible(PRECONDITION_REASON, null, "fix"))
    ],
    [
      "a recorded process before its liveness is read",
      { state: state({ activeProcess: process }) },
      { kind: "needs", evidence: "process_liveness", pid: 1 }
    ],
    [
      "a live process",
      { state: state({ activeProcess: process }), processAlive: true },
      fixDecision(recoveryIneligible(PRECONDITION_REASON, null, "fix"))
    ],
    [
      "an exited process before HEAD is read",
      { state: state({ activeProcess: process }), processAlive: false },
      { kind: "needs", evidence: "head_commit" }
    ],
    [
      "a failed precondition that names its reason",
      { state: state(), preconditionFailure: { message: "Scope moved." } },
      fixDecision(recoveryIneligible("Scope moved.", null, "fix"))
    ],
    [
      "a failed precondition without a reason",
      { state: pending, preconditionFailure: { message: null } },
      fixDecision(
        recoveryIneligible(
          "Prerequisite recovery preconditions could not be validated; inspect or cancel the run.",
          FIX.id,
          "fix"
        )
      )
    ],
    [
      "a moved HEAD",
      { state: state(), headCommit: "c".repeat(40) },
      fixDecision(
        recoveryIneligible(
          "Recovery is unavailable because checkout HEAD changed.",
          null,
          "fix"
        )
      )
    ],
    [
      "a current HEAD before the approval check",
      { state: state(), headCommit: BASE_COMMIT },
      { kind: "needs", evidence: "approval_check" }
    ],
    [
      "an approved run before completion revalidation",
      { state: state(), headCommit: BASE_COMMIT, approvalChecked: true },
      {
        kind: "needs",
        evidence: "completion_revalidation",
        allowReportRefresh: true,
        persistReportRefresh: false
      }
    ],
    [
      "a revalidated run before the source is selected",
      {
        state: state(),
        headCommit: BASE_COMMIT,
        approvalChecked: true,
        completionRevalidated: true
      },
      { kind: "needs", evidence: "prerequisite_source" }
    ],
    [
      "a selected source before the configuration",
      {
        state: state(),
        headCommit: BASE_COMMIT,
        approvalChecked: true,
        completionRevalidated: true,
        source: SOURCE
      },
      { kind: "needs", evidence: "configuration", role: "implementer" }
    ],
    [
      "a configured source before the workspace is read",
      {
        state: state(),
        headCommit: BASE_COMMIT,
        approvalChecked: true,
        completionRevalidated: true,
        source: SOURCE,
        configurationDigest: "c".repeat(64)
      },
      { kind: "needs", evidence: "workspace_snapshot" }
    ],
    [
      "a workspace on another base commit",
      prepared(state(), {
        workspace: { baseCommit: "c".repeat(40), digest: "d".repeat(64) }
      }),
      fixDecision(
        recoveryIneligible(
          "Recovery is unavailable because the workspace base commit changed.",
          FIX.id,
          "fix"
        )
      )
    ],
    [
      "a snapshot before its counts and identity",
      {
        state: state(),
        headCommit: BASE_COMMIT,
        approvalChecked: true,
        completionRevalidated: true,
        source: SOURCE,
        configurationDigest: "c".repeat(64),
        workspace: { baseCommit: BASE_COMMIT, digest: "d".repeat(64) }
      },
      {
        kind: "needs",
        evidence: "workspace_counts",
        identity: {
          version: 2,
          sourceKind: "prerequisite_blocked_fix",
          runId: "run-1",
          attempt: FIX,
          phase: "fix",
          baseCommit: BASE_COMMIT,
          workspaceDigest: "d".repeat(64),
          approvalDigest: "a".repeat(64),
          workflowDigest: null,
          scopeDigest: "e".repeat(64),
          configurationDigest: "c".repeat(64)
        }
      }
    ],
    ["an eligible source", prepared(), eligibleFix()],
    [
      "an eligible source without a recorded approval",
      prepared(state({ planApproval: null })),
      eligibleFix({ approvalDigest: null })
    ],
    [
      "an eligible source with several prerequisites",
      prepared(state(), {
        source: {
          ...SOURCE,
          remainingFindingIds: ["R1-F2", "R1-F3"],
          prerequisites: ["One.", "Two."]
        }
      }),
      eligibleFix({
        reason: `Completed blocked fix attempt ${FIX.id} may be recovered for remaining accepted findings R1-F2, R1-F3 after 2 operator prerequisites.`,
        remainingFindingIds: ["R1-F2", "R1-F3"],
        prerequisites: ["One.", "Two."]
      })
    ],
    [
      "a pending authorization before it is read",
      prepared(pending),
      {
        kind: "needs",
        evidence: "recovery_authorization",
        authorizationId: "recovery-1"
      }
    ],
    [
      "a stale authorization identity",
      prepared(pending, {
        authorization: { attemptId: FIX.id, recoveryIdentity: "0".repeat(64) }
      }),
      fixDecision(
        recoveryIneligible(
          "Persisted recovery authorization is stale or inconsistent.",
          FIX.id,
          "fix"
        )
      )
    ],
    [
      "a current authorization",
      prepared(pending, {
        authorization: { attemptId: FIX.id, recoveryIdentity: "f".repeat(64) }
      }),
      eligibleFix()
    ]
  ];
  for (const [name, facts, expected] of rows)
    assert.deepEqual(decidePrerequisiteBlockedFix(facts), expected, name);
});

test("prerequisite recovery reads evidence in baseline order and only where its path needs it", () => {
  const drive = (
    value: RunState,
    evidence: Partial<Omit<PrerequisiteBlockedFixFacts, "state">>
  ): PrerequisiteBlockedFixEvidence[] => {
    const facts: PrerequisiteBlockedFixFacts = { state: value };
    const requested: PrerequisiteBlockedFixEvidence[] = [];
    for (;;) {
      const step = decidePrerequisiteBlockedFix(facts);
      if (step.kind === "decided") return requested;
      requested.push(step.evidence);
      const key = {
        process_liveness: "processAlive",
        head_commit: "headCommit",
        approval_check: "approvalChecked",
        completion_revalidation: "completionRevalidated",
        prerequisite_source: "source",
        configuration: "configurationDigest",
        workflow_selection_check: "workflowDigest",
        attempt_scope_digest: "scopeDigest",
        workspace_snapshot: "workspace",
        workspace_counts: "counts",
        recovery_authorization: "authorization"
      } as const satisfies Record<
        PrerequisiteBlockedFixEvidence,
        Exclude<keyof PrerequisiteBlockedFixFacts, "state">
      >;
      const name = key[step.evidence];
      if (!(name in evidence)) throw new Error(`Unexpected read of ${name}.`);
      Object.assign(facts, { [name]: evidence[name] });
    }
  };
  const full = prepared(state(), {
    processAlive: false,
    authorization: { attemptId: FIX.id, recoveryIdentity: "f".repeat(64) }
  });
  const order = [
    "head_commit",
    "approval_check",
    "completion_revalidation",
    "prerequisite_source",
    "configuration",
    "workspace_snapshot",
    "workspace_counts"
  ];
  assert.deepEqual(drive(state(), full), order);
  assert.deepEqual(
    drive(
      state({
        recovery: PRESERVED,
        activeProcess: {
          pid: 1,
          kind: "fix",
          startedAt: "2026-07-01T00:00:00.000Z"
        }
      }),
      full
    ),
    ["process_liveness", ...order, "recovery_authorization"]
  );
  assert.deepEqual(drive(state(), { ...full, headCommit: "c".repeat(40) }), [
    "head_commit"
  ]);
  assert.deepEqual(drive(state({ activeAttempt: FIX }), full), []);
});
