import assert from "node:assert/strict";
import test from "node:test";
import type {
  AttemptRecord,
  AttemptReference,
  RunState
} from "../../../src/types.js";
import {
  decideRetry,
  type RetryEligibility,
  type RetryEvidence,
  type RetryFacts
} from "../../../src/workflow/domain/retry-eligibility.js";

const APPROVAL_CHANGED =
  "Approved planning artifacts changed. Restore the approved bundle (banzai restore) and retry, or cancel the run and approve a revised plan in a new run.";

function blockedState(overrides: Partial<RunState> = {}): RunState {
  return {
    status: "blocked",
    verificationMode: "task",
    activeProcess: null,
    activeAttempt: null,
    blockedFrom: null,
    blockReason: "Fixture block.",
    planTaskCompletion: null,
    ...overrides
  } as RunState;
}

/** A run from before verification modes existed carries no mode at all. */
function withoutVerificationMode(state: RunState): RunState {
  const legacy: Partial<RunState> = { ...state };
  delete legacy.verificationMode;
  return legacy as RunState;
}

function attempt(
  kind: AttemptReference["kind"],
  mutable = kind === "implementation" || kind === "fix"
): AttemptReference {
  return { id: `${kind}-1-abcdef12`, kind, mutable };
}

function record(overrides: Partial<AttemptRecord> = {}): AttemptRecord {
  return { status: "failed", failureCode: null, ...overrides } as AttemptRecord;
}

function invalidCompletion(
  sourceAttemptId: string,
  violation: "missing_task" | "approved_plan_invalid" | "approval_invalid"
): NonNullable<RunState["planTaskCompletion"]> {
  return {
    status: "invalid",
    sourceAttemptId,
    errorCode: "PLAN_TASK_COMPLETION_INVALID",
    violation,
    taskId: null,
    recordedAt: "2026-07-01T00:00:00.000Z"
  } as NonNullable<RunState["planTaskCompletion"]>;
}

const retry = (
  eligible: boolean,
  reason: string,
  attemptId: string | null
): RetryEligibility => ({ eligible, reason, attemptId });

const decided = (eligibility: RetryEligibility) => ({
  kind: "decided" as const,
  eligibility
});

const MALFORMED = retry(
  false,
  "Verification evidence is malformed or conflicting. Audit the run before continuing.",
  null
);
const NOT_TIED = retry(
  false,
  "This blocked state is not tied to a failed attempt. Resolve it manually or cancel the run.",
  null
);
const FAILED_MUTABLE = (id: string) =>
  retry(
    false,
    "Failed mutable attempts cannot be retried because their repository side effects may be incomplete. Inspect the checkout, then cancel the run.",
    id
  );

test("retry decisions reproduce every baseline outcome from explicit facts", () => {
  const implementation = attempt("implementation");
  const fix = attempt("fix");
  const selection = attempt("selection");
  const review = attempt("review");
  const plan = attempt("plan");
  const rows: [string, RetryFacts, ReturnType<typeof decideRetry>][] = [
    [
      "a run that is not blocked",
      { state: blockedState({ status: "done" }) },
      decided(
        retry(false, "Retry requires a blocked run, but the run is done.", null)
      )
    ],
    [
      "an active process with an attempt",
      {
        state: blockedState({
          activeAttempt: implementation,
          activeProcess: {
            pid: 1,
            kind: "implementation",
            startedAt: "2026-07-01T00:00:00.000Z"
          }
        })
      },
      decided(
        retry(
          false,
          "Retry is unavailable while a model process is still active.",
          implementation.id
        )
      )
    ],
    [
      "an active process without an attempt",
      {
        state: blockedState({
          activeProcess: {
            pid: 1,
            kind: "verification",
            startedAt: "2026-07-01T00:00:00.000Z"
          }
        })
      },
      decided(
        retry(
          false,
          "Retry is unavailable while a model process is still active.",
          null
        )
      )
    ],
    [
      "startup checks",
      { state: blockedState({ blockedFrom: "created" }) },
      decided(
        retry(
          true,
          "Startup checks can be retried after resolving the reported prerequisite.",
          null
        )
      )
    ],
    [
      "review checks",
      { state: blockedState({ blockedFrom: "reviewing" }) },
      decided(
        retry(
          true,
          "Review checks can be retried after resolving the reported prerequisite.",
          null
        )
      )
    ],
    [
      "completion evidence rejected at revalidation",
      {
        state: blockedState({
          blockedFrom: "verifying",
          planTaskCompletion: invalidCompletion(
            "fix-2-abcdef12",
            "missing_task"
          )
        })
      },
      decided(
        retry(
          true,
          "Completion evidence rejected at revalidation can be repaired with a new implementation attempt.",
          "fix-2-abcdef12"
        )
      )
    ],
    ...(["approved_plan_invalid", "approval_invalid"] as const).map(
      (violation): [string, RetryFacts, ReturnType<typeof decideRetry>] => [
        `a plan bundle invalid at revalidation (${violation})`,
        {
          state: blockedState({
            blockedFrom: "verifying",
            planTaskCompletion: invalidCompletion(
              "implementation-1-x",
              violation
            )
          })
        },
        decided(
          retry(
            true,
            "The approved plan bundle is invalid; retry reruns planning for a corrected bundle and a new approval.",
            "implementation-1-x"
          )
        )
      ]
    ),
    [
      "an unresolved digest at verification",
      {
        state: blockedState({
          blockedFrom: "verifying",
          blockReason: "[RESULT_DIGEST_UNRESOLVED] Unrestorable bytes."
        })
      },
      decided(
        retry(
          false,
          "A digest this run's result authored does not match the bytes it names, and no recorded baseline shows those bytes changed after acceptance. Retrying reads the same bytes and fails identically. Inspect the checkout, then cancel the run.",
          null
        )
      )
    ],
    [
      "task verification before its evidence is read",
      { state: blockedState({ blockedFrom: "verifying" }) },
      { kind: "needs", evidence: "task_verification_attempts" }
    ],
    [
      "unreadable task verification evidence",
      {
        state: blockedState({ blockedFrom: "verifying" }),
        taskVerification: { readable: false }
      },
      decided(MALFORMED)
    ],
    [
      "an unresolved physical task check",
      {
        state: blockedState({ blockedFrom: "verifying" }),
        taskVerification: {
          readable: true,
          latest: { id: "check-1", status: "started" }
        }
      },
      decided(
        retry(
          true,
          "Retry reconciles the unresolved physical attempt before running eligible checks.",
          null
        )
      )
    ],
    ...(["failed", "interrupted"] as const).map(
      (status): [string, RetryFacts, ReturnType<typeof decideRetry>] => [
        `an unsuccessful task check (${status})`,
        {
          state: blockedState({ blockedFrom: "verifying" }),
          taskVerification: {
            readable: true,
            latest: { id: "check-1", status }
          }
        },
        decided(
          retry(
            true,
            "The unsuccessful task check can be retried explicitly.",
            "check-1"
          )
        )
      ]
    ),
    ...(
      [
        ["completed", { id: "check-1", status: "completed" }],
        ["absent", null]
      ] as const
    ).map(
      ([label, latest]): [
        string,
        RetryFacts,
        ReturnType<typeof decideRetry>
      ] => [
        `task verification prerequisites (${label} latest check)`,
        {
          state: blockedState({ blockedFrom: "verifying" }),
          taskVerification: { readable: true, latest }
        },
        decided(
          retry(
            true,
            "Verification prerequisites can be retried without replaying implementation.",
            null
          )
        )
      ]
    ),
    [
      "legacy verification before its ledger is read",
      {
        state: withoutVerificationMode(
          blockedState({ blockedFrom: "verifying" })
        )
      },
      { kind: "needs", evidence: "legacy_ledger_support" }
    ],
    [
      "an unreadable legacy ledger",
      {
        state: blockedState({
          blockedFrom: "verifying",
          verificationMode: "ordered"
        }),
        legacyLedger: { readable: false }
      },
      decided(MALFORMED)
    ],
    [
      "an unsupported legacy ledger",
      {
        state: blockedState({
          blockedFrom: "verifying",
          verificationMode: "ordered"
        }),
        legacyLedger: { readable: true, supported: false }
      },
      decided(
        retry(
          false,
          "Legacy verification evidence has no retryable durable attempt identity. Inspect the checkout, then cancel the run.",
          null
        )
      )
    ],
    [
      "legacy attempts before they are read",
      {
        state: blockedState({
          blockedFrom: "verifying",
          verificationMode: "ordered"
        }),
        legacyLedger: { readable: true, supported: true }
      },
      { kind: "needs", evidence: "legacy_verification_attempts" }
    ],
    [
      "unreadable legacy attempts",
      {
        state: blockedState({
          blockedFrom: "verifying",
          verificationMode: "ordered"
        }),
        legacyLedger: { readable: true, supported: true },
        legacyVerification: { readable: false }
      },
      decided(MALFORMED)
    ],
    [
      "a failed legacy attempt",
      {
        state: blockedState({
          blockedFrom: "verifying",
          verificationMode: "ordered"
        }),
        legacyLedger: { readable: true, supported: true },
        legacyVerification: {
          readable: true,
          latest: { id: "verification-attempt-3", status: "failed" }
        }
      },
      decided(
        retry(
          true,
          "Failed verification attempt verification-attempt-3 can be retried explicitly.",
          "verification-attempt-3"
        )
      )
    ],
    [
      "a completed legacy attempt falls through",
      {
        state: blockedState({
          blockedFrom: "verifying",
          verificationMode: "ordered"
        }),
        legacyLedger: { readable: true, supported: true },
        legacyVerification: {
          readable: true,
          latest: { id: "verification-attempt-3", status: "completed" }
        }
      },
      decided(NOT_TIED)
    ],
    [
      "fix checks after approval changed",
      {
        state: blockedState({
          blockedFrom: "fixing",
          blockReason: APPROVAL_CHANGED
        })
      },
      decided(
        retry(
          true,
          "Fix checks can be retried after resolving the reported prerequisite.",
          null
        )
      )
    ],
    ...(["implementing", "plan_approved"] as const).map(
      (blockedFrom): [string, RetryFacts, ReturnType<typeof decideRetry>] => [
        `implementation checks after approval changed (${blockedFrom})`,
        {
          state: blockedState({ blockedFrom, blockReason: APPROVAL_CHANGED })
        },
        decided(
          retry(
            true,
            "Implementation checks can be retried after resolving the reported prerequisite.",
            null
          )
        )
      ]
    ),
    [
      "an approval change while planning is not tied to an attempt",
      {
        state: blockedState({
          blockedFrom: "planning",
          blockReason: APPROVAL_CHANGED
        })
      },
      decided(NOT_TIED)
    ],
    [
      "a fixing block without approval change belongs to recovery",
      { state: blockedState({ blockedFrom: "fixing" }) },
      decided(NOT_TIED)
    ],
    [
      "an attempt before its record is read",
      {
        state: blockedState({
          blockedFrom: "implementing",
          activeAttempt: implementation
        })
      },
      { kind: "needs", evidence: "attempt_record", attempt: implementation }
    ],
    ...(
      [
        [selection, "selecting"],
        [plan, "planning"],
        [implementation, "implementing"],
        [fix, "fixing"],
        [review, "reviewing"]
      ] as const
    ).map(
      ([candidate, blockedFrom]): [
        string,
        RetryFacts,
        ReturnType<typeof decideRetry>
      ] => [
        `a context-budget-blocked ${candidate.kind} attempt`,
        {
          state: blockedState({ blockedFrom, activeAttempt: candidate }),
          attemptRecord: record({ failureCode: "CONTEXT_BUDGET_EXCEEDED" })
        },
        decided(
          retry(
            true,
            `Context-budget-blocked ${candidate.kind} attempt ${candidate.id} can be retried explicitly after policy or authorized input changes because no vendor process started.`,
            candidate.id
          )
        )
      ]
    ),
    [
      "a context-budget failure blocked elsewhere is an ordinary mutable failure",
      {
        state: blockedState({
          blockedFrom: "verifying",
          activeAttempt: implementation
        }),
        attemptRecord: record({ failureCode: "CONTEXT_BUDGET_EXCEEDED" })
      },
      decided(FAILED_MUTABLE(implementation.id))
    ],
    [
      "a mutable attempt pending completion application",
      {
        state: blockedState({
          blockedFrom: "implementing",
          activeAttempt: implementation
        }),
        attemptRecord: record({ status: "pending_application" })
      },
      decided(
        retry(
          false,
          "Completion publication for this attempt is pending; use banzai resume to reconcile it without another model call, or cancel the run.",
          implementation.id
        )
      )
    ],
    ...(
      [
        [implementation, "implementing"],
        [fix, "fixing"]
      ] as const
    ).map(
      ([candidate, blockedFrom]): [
        string,
        RetryFacts,
        ReturnType<typeof decideRetry>
      ] => [
        `completion evidence of a ${candidate.kind} attempt`,
        {
          state: blockedState({
            blockedFrom,
            activeAttempt: candidate,
            planTaskCompletion: invalidCompletion(candidate.id, "missing_task")
          }),
          attemptRecord: record({ failureCode: "PLAN_TASK_COMPLETION_INVALID" })
        },
        decided(
          retry(
            true,
            `Completion evidence for ${candidate.kind} attempt ${candidate.id} can be repaired with a new attempt.`,
            candidate.id
          )
        )
      ]
    ),
    [
      "a plan bundle invalid for an implementation attempt",
      {
        state: blockedState({
          blockedFrom: "implementing",
          activeAttempt: implementation,
          planTaskCompletion: invalidCompletion(
            implementation.id,
            "approved_plan_invalid"
          )
        }),
        attemptRecord: record({ failureCode: "PLAN_TASK_COMPLETION_INVALID" })
      },
      decided(
        retry(
          true,
          "The approved plan bundle is invalid; retry reruns planning for a corrected bundle and a new approval.",
          implementation.id
        )
      )
    ],
    [
      "completion evidence attributed to another attempt",
      {
        state: blockedState({
          blockedFrom: "implementing",
          activeAttempt: implementation,
          planTaskCompletion: invalidCompletion("fix-9-other", "missing_task")
        }),
        attemptRecord: record({ failureCode: "PLAN_TASK_COMPLETION_INVALID" })
      },
      decided(FAILED_MUTABLE(implementation.id))
    ],
    [
      "an interrupted mutable attempt",
      {
        state: blockedState({
          blockedFrom: "implementing",
          activeAttempt: implementation
        }),
        attemptRecord: record({ status: "started" })
      },
      decided(FAILED_MUTABLE(implementation.id))
    ],
    [
      "an interrupted planning attempt",
      {
        state: blockedState({ blockedFrom: "planning", activeAttempt: plan }),
        attemptRecord: record({ status: "started" })
      },
      decided(
        retry(
          false,
          "Interrupted attempts cannot be retried automatically. Inspect the checkout, then cancel the run.",
          plan.id
        )
      )
    ],
    [
      "a completed read-only attempt",
      {
        state: blockedState({
          blockedFrom: "selecting",
          activeAttempt: selection
        }),
        attemptRecord: record({ status: "completed" })
      },
      decided(
        retry(
          false,
          `Attempt ${selection.id} is completed, not failed.`,
          selection.id
        )
      )
    ],
    [
      "a failed read-only attempt blocked elsewhere",
      {
        state: blockedState({
          blockedFrom: "planning",
          activeAttempt: selection
        }),
        attemptRecord: record()
      },
      decided(
        retry(
          false,
          "The failed selection attempt is inconsistent with blockedFrom=planning.",
          selection.id
        )
      )
    ],
    [
      "a failed read-only fix attempt has no expected block",
      {
        state: blockedState({
          blockedFrom: "fixing",
          activeAttempt: attempt("fix", false)
        }),
        attemptRecord: record()
      },
      decided(
        retry(
          false,
          "The failed fix attempt is inconsistent with blockedFrom=fixing.",
          fix.id
        )
      )
    ],
    [
      "a failed read-only attempt without blockedFrom",
      {
        state: blockedState({ activeAttempt: review }),
        attemptRecord: record()
      },
      decided(
        retry(
          false,
          "The failed review attempt is inconsistent with blockedFrom=null.",
          review.id
        )
      )
    ],
    ...(
      [
        [selection, "selecting"],
        [plan, "planning"],
        [{ ...implementation, mutable: false }, "implementing"],
        [review, "reviewing"]
      ] as const
    ).map(
      ([candidate, blockedFrom]): [
        string,
        RetryFacts,
        ReturnType<typeof decideRetry>
      ] => [
        `a failed read-only ${candidate.kind} attempt`,
        {
          state: blockedState({ blockedFrom, activeAttempt: candidate }),
          attemptRecord: record()
        },
        decided(
          retry(
            true,
            `Failed ${candidate.kind} attempt ${candidate.id} can be retried explicitly.`,
            candidate.id
          )
        )
      ]
    ),
    ...(
      [
        [selection, "selecting"],
        [review, "reviewing"]
      ] as const
    ).map(
      ([candidate, blockedFrom]): [
        string,
        RetryFacts,
        ReturnType<typeof decideRetry>
      ] => [
        `an interrupted read-only ${candidate.kind} attempt`,
        {
          state: blockedState({ blockedFrom, activeAttempt: candidate }),
          attemptRecord: record({ status: "started" })
        },
        decided(
          retry(
            true,
            `Interrupted ${candidate.kind} attempt ${candidate.id} can be retried explicitly because it was read-only.`,
            candidate.id
          )
        )
      ]
    )
  ];
  for (const [name, facts, expected] of rows)
    assert.deepEqual(decideRetry(facts), expected, name);
});

function provided<T>(value: T | undefined, evidence: RetryEvidence): T {
  if (value === undefined) throw new Error(`Unexpected read of ${evidence}.`);
  return value;
}

/** Runs the staged rule the way the runner shell does, recording each read. */
function drive(
  state: RunState,
  evidence: Partial<Omit<RetryFacts, "state">>
): RetryEvidence[] {
  const facts: RetryFacts = { state };
  const requested: RetryEvidence[] = [];
  for (;;) {
    const step = decideRetry(facts);
    if (step.kind === "decided") return requested;
    requested.push(step.evidence);
    switch (step.evidence) {
      case "task_verification_attempts":
        facts.taskVerification = provided(
          evidence.taskVerification,
          step.evidence
        );
        break;
      case "legacy_ledger_support":
        facts.legacyLedger = provided(evidence.legacyLedger, step.evidence);
        break;
      case "legacy_verification_attempts":
        facts.legacyVerification = provided(
          evidence.legacyVerification,
          step.evidence
        );
        break;
      case "attempt_record":
        facts.attemptRecord = provided(evidence.attemptRecord, step.evidence);
        break;
    }
  }
}

test("retry reads evidence only on the paths that need it, in baseline order", () => {
  const legacy = blockedState({
    blockedFrom: "verifying",
    verificationMode: "ordered"
  });
  assert.deepEqual(
    drive(legacy, {
      legacyLedger: { readable: true, supported: true },
      legacyVerification: { readable: true, latest: null }
    }),
    ["legacy_ledger_support", "legacy_verification_attempts"]
  );
  assert.deepEqual(
    drive(legacy, { legacyLedger: { readable: true, supported: false } }),
    ["legacy_ledger_support"]
  );
  assert.deepEqual(drive(legacy, { legacyLedger: { readable: false } }), [
    "legacy_ledger_support"
  ]);
  assert.deepEqual(
    drive(blockedState({ blockedFrom: "verifying" }), {
      taskVerification: { readable: false }
    }),
    ["task_verification_attempts"]
  );
  assert.deepEqual(
    drive(
      blockedState({
        blockedFrom: "verifying",
        blockReason: "[RESULT_DIGEST_UNRESOLVED] Unrestorable bytes."
      }),
      {}
    ),
    []
  );
  assert.deepEqual(
    drive(
      blockedState({
        activeAttempt: attempt("implementation"),
        activeProcess: {
          pid: 1,
          kind: "implementation",
          startedAt: "2026-07-01T00:00:00.000Z"
        }
      }),
      {}
    ),
    []
  );
  assert.deepEqual(
    drive(
      blockedState({
        blockedFrom: "implementing",
        activeAttempt: attempt("implementation")
      }),
      { attemptRecord: record() }
    ),
    ["attempt_record"]
  );
});

test("retry allocates a separate malformed-evidence decision for every call", () => {
  const legacy = blockedState({
    blockedFrom: "verifying",
    verificationMode: "ordered"
  });
  const paths: [string, RetryFacts][] = [
    [
      "task verification",
      {
        state: blockedState({ blockedFrom: "verifying" }),
        taskVerification: { readable: false }
      }
    ],
    ["legacy ledger", { state: legacy, legacyLedger: { readable: false } }],
    [
      "legacy attempts",
      {
        state: legacy,
        legacyLedger: { readable: true, supported: true },
        legacyVerification: { readable: false }
      }
    ]
  ];
  for (const [name, facts] of paths) {
    const first = decideRetry(facts);
    assert.equal(first.kind, "decided", name);
    // The decision reaches callers as `status().retry`, which they own.
    first.eligibility.eligible = true;
    first.eligibility.reason = "Caller changed its own status snapshot.";
    assert.deepEqual(decideRetry(facts), decided(MALFORMED), name);
  }
});
