import assert from "node:assert/strict";
import test from "node:test";
import { currentCommit } from "../../../src/git.js";
import { FALLBACK_VENDOR, vendorFor } from "../../../src/models.js";
import {
  type AttemptRecord,
  type AttemptReference,
  CONTRACT_VERSION,
  type ModelSettings,
  type OrchestratorConfig,
  PHASE_RESULT_SCHEMA_VERSION,
  PLAN_TASK_COMPLETION_SCHEMA_VERSION,
  type PhaseResult,
  type RunState,
  type SessionContext,
  type TerminalCheckpointResult
} from "../../../src/types.js";
import { digestCanonicalJson } from "../../../src/validation.js";
import {
  promoteTerminalCheckpoint,
  terminalCheckpointWriter,
  validateTerminalCheckpointResult
} from "../../../src/workflow/checkpoints/terminal-checkpoints.js";
import { sessionContext } from "../../../src/workflow/domain/sessions.js";
import { createTestRepository } from "../../helpers.js";
import { recordingContext } from "../context-fixture.js";

const SETTINGS: ModelSettings = {
  executable: "codex",
  model: "model",
  effort: "high",
  timeoutMs: 1000
};
const CONFIG = {
  models: { planner: SETTINGS, implementer: SETTINGS, reviewer: SETTINGS }
} as unknown as OrchestratorConfig;
const REVIEWER: SessionContext = sessionContext("reviewer", SETTINGS);

function attempt(kind: AttemptReference["kind"]): AttemptReference {
  return { id: `${kind}-1-abcdef12`, kind, mutable: kind !== "review" };
}

function phaseResult(
  phase: PhaseResult["phase"],
  overrides: Partial<PhaseResult> = {}
): PhaseResult {
  return {
    schemaVersion: PHASE_RESULT_SCHEMA_VERSION,
    verificationCandidates: null,
    contractVersion: CONTRACT_VERSION,
    phase,
    outcome: phase === "plan" ? "needs_human_decision" : "completed",
    gate: phase === "plan" ? "plan_approval" : null,
    summary: `${phase} complete`,
    artifacts: {
      description: "documentation/features/example/description.md",
      plan: "documentation/development-plans/example/plan.md",
      adrs: [],
      implementationReport:
        phase === "plan"
          ? null
          : "documentation/features/example/implementation-report.md",
      testReport:
        phase === "plan"
          ? null
          : "documentation/features/example/test-report.md"
    },
    taskCompletion:
      phase === "plan"
        ? null
        : {
            schemaVersion: PLAN_TASK_COMPLETION_SCHEMA_VERSION,
            tasks: [
              {
                taskId: "T001",
                status: "completed",
                evidence: [{ path: "src/example.txt", detail: "Fixture." }],
                gap: null
              }
            ]
          },
    touchedPaths: [],
    questions: [],
    decisionConsultation: null,
    resolvedFindingIds: [],
    requestedVerification: [],
    ...overrides
  };
}

function runState(overrides: Partial<RunState> = {}): RunState {
  return {
    runId: "run-1",
    request: "Do the work.",
    status: "implementing",
    verificationMode: "ordered",
    baseCommit: "b".repeat(40),
    planApproval: null,
    workflowSelection: null,
    reviewIteration: 1,
    triage: null,
    recovery: null,
    activeAttempt: null,
    ...overrides
  } as unknown as RunState;
}

test("terminal success is refused once another attempt became active", async () => {
  const { context, calls } = recordingContext({
    readState: () =>
      Promise.resolve(runState({ activeAttempt: attempt("fix") }))
  });
  const write = terminalCheckpointWriter(
    context,
    runState(),
    attempt("implementation"),
    SETTINGS,
    { sessionMode: "fresh", sessionContext: REVIEWER }
  );
  await assert.rejects(write({} as never), {
    code: "TERMINAL_CHECKPOINT_STATE_CHANGED",
    message:
      "The active attempt changed before terminal success could be persisted."
  });
  assert.deepEqual(calls, ["readState"]);
});

test("only strict implementation or fix attempts write completion-protocol proof", async () => {
  const review = attempt("review");
  const { context, calls } = recordingContext({
    readState: () => Promise.resolve(runState({ activeAttempt: review }))
  });
  const write = terminalCheckpointWriter(
    context,
    runState(),
    review,
    SETTINGS,
    { sessionMode: "fresh", sessionContext: REVIEWER },
    true
  );
  await assert.rejects(write({ result: {} } as never), {
    code: "TERMINAL_CHECKPOINT_STATE_CHANGED",
    message:
      "Only strict implementation or fix attempts use the completion protocol."
  });
  assert.deepEqual(calls, ["readState"]);
});

function promoteWith(
  checkpoint: unknown,
  repoRoot?: string
): ReturnType<typeof recordingContext> {
  return recordingContext(
    { readTerminalCheckpointIfExists: () => Promise.resolve(checkpoint) },
    repoRoot
  );
}

test("a checkpoint that cannot belong to the attempt is never promoted", async () => {
  const selection = attempt("selection");
  const record = { status: "failed", failureCode: null } as AttemptRecord;
  for (const [checkpoint, failureCode, expected] of [
    [
      { envelope: {} },
      null,
      {
        code: "TERMINAL_CHECKPOINT_MISMATCH",
        message:
          "A legacy attempt cannot reconcile a completion-protocol checkpoint."
      }
    ],
    [
      {},
      "TERMINAL_RESULT_CONFLICT",
      {
        code: "TERMINAL_CHECKPOINT_CONFLICT",
        message:
          "Conflicting terminal or session evidence cannot be reconciled as success."
      }
    ],
    [
      { runId: "run-other", attempt: selection },
      null,
      {
        code: "TERMINAL_CHECKPOINT_MISMATCH",
        message:
          "Terminal checkpoint does not match the active run, attempt, authorization, or model context."
      }
    ]
  ] as const) {
    const { context, calls } = promoteWith(checkpoint);
    await assert.rejects(
      promoteTerminalCheckpoint(
        context,
        runState(),
        selection,
        { ...record, failureCode },
        CONFIG
      ),
      expected
    );
    assert.deepEqual(calls, ["readTerminalCheckpointIfExists"]);
  }
});

/** A checkpoint that matches its attempt, run and model context exactly. */
function matchingCheckpoint(
  state: RunState,
  target: AttemptReference,
  resultContract: string,
  result: unknown
): unknown {
  const context = sessionContext("planner", SETTINGS);
  return {
    runId: state.runId,
    attempt: target,
    phase: target.kind,
    resultContract,
    baseCommit: state.baseCommit,
    approvalDigest: state.planApproval?.digest ?? null,
    workflowDigest:
      state.planApproval === null
        ? (state.workflowSelection?.digest ?? null)
        : null,
    scopeDigest: null,
    configuration: {
      vendor: vendorFor(SETTINGS.executable) ?? FALLBACK_VENDOR.planner,
      executableDigest: digestCanonicalJson(SETTINGS.executable),
      model: SETTINGS.model,
      effort: SETTINGS.effort,
      sessionMode: "fresh",
      sessionContextDigest: digestCanonicalJson(context)
    },
    result,
    sessionId: null,
    usage: null,
    terminal: { observedAt: "2026-07-01T00:00:00.000Z" }
  };
}

test("a matching checkpoint cannot contradict or promote a settled attempt", async () => {
  const repository = await createTestRepository();
  try {
    const state = runState({
      baseCommit: await currentCommit(repository.root)
    });
    const selection = attempt("selection");
    const checkpoint = matchingCheckpoint(
      state,
      selection,
      "workflow-selection/v1",
      { selected: "strict" }
    );
    for (const [record, message] of [
      [
        { status: "completed", result: { selected: "feature" } },
        "Completed attempt result conflicts with its terminal checkpoint."
      ],
      [
        { status: "interrupted", result: null },
        "Terminal checkpoint cannot promote an attempt in interrupted state."
      ]
    ] as const) {
      const { context, calls } = promoteWith(checkpoint, repository.root);
      await assert.rejects(
        promoteTerminalCheckpoint(
          context,
          state,
          selection,
          { ...record, failureCode: null } as unknown as AttemptRecord,
          CONFIG
        ),
        { code: "TERMINAL_CHECKPOINT_CONFLICT", message }
      );
      assert.deepEqual(calls, ["readTerminalCheckpointIfExists"]);
    }
  } finally {
    await repository.dispose();
  }
});

test("a planning checkpoint needs the unchanged strict workflow selection", async () => {
  const repository = await createTestRepository();
  try {
    const state = runState({
      baseCommit: await currentCommit(repository.root),
      workflowSelection: {
        workflow: "feature",
        digest: "d".repeat(64)
      } as NonNullable<RunState["workflowSelection"]>
    });
    const plan = attempt("plan");
    const { context, calls } = promoteWith(
      matchingCheckpoint(state, plan, "phase-result/v3", phaseResult("plan")),
      repository.root
    );
    await assert.rejects(
      promoteTerminalCheckpoint(
        context,
        state,
        plan,
        {
          status: "failed",
          result: null,
          failureCode: null
        } as unknown as AttemptRecord,
        CONFIG
      ),
      {
        code: "WORKFLOW_AUTHORIZATION_INVALID",
        message:
          "Planning checkpoint requires the unchanged strict workflow selection."
      }
    );
    assert.deepEqual(calls, ["readTerminalCheckpointIfExists"]);
  } finally {
    await repository.dispose();
  }
});

test("a checkpoint result must fit its attempt before it is reconciled", async () => {
  const { context } = recordingContext({});
  await assert.rejects(
    validateTerminalCheckpointResult(
      context,
      runState(),
      attempt("implementation"),
      phaseResult("plan"),
      CONFIG
    ),
    {
      code: "PHASE_RESULT_MISMATCH",
      message: "Attempt implementation returned phase plan."
    }
  );
  await assert.rejects(
    validateTerminalCheckpointResult(
      context,
      runState({
        workflowSelection: {
          workflow: "feature"
        } as NonNullable<RunState["workflowSelection"]>
      }),
      attempt("implementation"),
      phaseResult("implementation"),
      CONFIG
    ),
    {
      code: "PLAN_TASK_COMPLETION_INVALID",
      message:
        "Lite implementation must not return strict plan-task completion evidence."
    }
  );
  await assert.rejects(
    validateTerminalCheckpointResult(
      context,
      runState(),
      attempt("fix"),
      phaseResult("fix", {
        resolvedFindingIds: ["R1-F1"]
      }),
      CONFIG
    ),
    {
      code: "PLAN_TASK_COMPLETION_INVALID",
      violation: "approval_invalid",
      message: "Strict completion validation requires an approved plan bundle."
    }
  );
});

test("a review checkpoint must stay bound to its frozen snapshot", async () => {
  const review = attempt("review");
  const { context, calls } = recordingContext({
    readRunAttempt: () =>
      Promise.resolve({
        reviewContext: { snapshotDigest: "a".repeat(64) }
      } as unknown as AttemptRecord),
    readReviewSnapshot: () => Promise.resolve({ digest: "b".repeat(64) })
  });
  await assert.rejects(
    validateTerminalCheckpointResult(
      context,
      runState(),
      review,
      {
        schemaVersion: 2,
        contractVersion: CONTRACT_VERSION,
        verdict: "pass",
        summary: "Fine.",
        findings: [],
        reviewedFindingIds: [],
        deferredCoverage: []
      } as unknown as TerminalCheckpointResult,
      CONFIG
    ),
    {
      code: "INVALID_REVIEW_SNAPSHOT",
      message: "Checkpoint snapshot binding is missing or conflicting."
    }
  );
  assert.deepEqual(calls, ["readRunAttempt", "readReviewSnapshot"]);
});
