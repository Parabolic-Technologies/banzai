import { decodePlanningGateDecision } from "../src/agent-control.js";
import assert from "node:assert/strict";
import test from "node:test";
import packageManifest from "../package.json" with { type: "json" };
import {
  agentControlCapabilities,
  decodeAgentControlAnswer,
  decodeAgentControlRecovery,
  decodeAgentControlRequest,
  emptyAgentControlStatus,
  MAX_AGENT_CONTROL_INPUT_BYTES,
  projectAgentControlStatus,
  renderAgentControlJson
} from "../src/agent-control.js";
import { BanzaiError } from "../src/errors.js";
import {
  planningEpisode,
  planningTriageRequest
} from "./planning-review-fixtures.js";

test("status v6 projects current planning gates, null ADR descriptions and complete triage without private history", () => {
  for (const gate of ["plan_approval", "adr_approval"] as const) {
    const current = state({
      schemaVersion: 10,
      status:
        gate === "plan_approval" ? "needs_plan_approval" : "needs_adr_approval",
      planningReview: { active: null, closed: [] },
      planArtifacts: {
        description:
          gate === "adr_approval"
            ? null
            : "documentation/work/task/description.md",
        plan:
          gate === "plan_approval" ? "documentation/work/task/plan.md" : null,
        adrs: ["documentation/decisions/0001-task.md"],
        implementationReport: null,
        testReport: null
      },
      humanDecisions: [
        {
          kind: "plan_rework",
          feedback: "FORBIDDEN HISTORY FEEDBACK",
          bundleDigest: "a".repeat(64),
          decidedBy: "FORBIDDEN OWNER",
          decidedAt: TIMESTAMP
        }
      ]
    });
    const projected = projectAgentControlStatus(workflowStatus(current));
    assert.equal(projected.schema, "banzai-agent-status/v6");
    assert.equal(projected.schemaVersion, 6);
    const activeRun = projected.activeRun;
    assert.ok(activeRun);
    const pending = activeRun.pendingGate;
    assert.ok(
      pending &&
        (pending.kind === "plan_approval" || pending.kind === "adr_approval")
    );
    assert.deepEqual(
      pending.decisions,
      gate === "plan_approval"
        ? ["approve", "rework", "review"]
        : ["accept", "reject", "rework", "review"]
    );
    assert.deepEqual(
      pending.reviewPaths,
      gate === "plan_approval"
        ? [
            "documentation/work/task/description.md",
            "documentation/decisions/0001-task.md",
            "documentation/work/task/plan.md"
          ]
        : ["documentation/decisions/0001-task.md"]
    );
    assert.doesNotMatch(
      renderAgentControlJson(projected),
      /FORBIDDEN|decidedBy|humanDecisions/
    );
  }
  const pending = planningTriageRequest();
  const episode = planningEpisode({ decidedBy: "FORBIDDEN EPISODE OWNER" });
  const current = state({
    schemaVersion: 10,
    status: "needs_human_decision",
    planningReview: { active: episode, closed: [] },
    pendingHumanDecision: pending
  });
  pending.runId = current.runId;
  const projected = projectAgentControlStatus(workflowStatus(current));
  const activeRun = projected.activeRun;
  assert.ok(activeRun);
  assert.equal(activeRun.pendingGate?.kind, "planning_review_triage");
  assert.deepEqual(activeRun.pendingGate.findings, pending.findings);
  assert.deepEqual(activeRun.pendingGate.analysis, pending.analysis);
  assert.equal(activeRun.pendingGate.episodeId, episode.episodeId);
  assert.equal(activeRun.pendingGate.analysisDigest, episode.analysisDigest);
  assert.equal(activeRun.nextAction, "answer_planning_review_triage");
  assert.doesNotMatch(
    renderAgentControlJson(projected),
    /FORBIDDEN|decidedBy|humanDecisions/
  );
});
import type {
  ReviewResult,
  RunState,
  RunStatus,
  VerificationResult
} from "../src/types.js";
import {
  AGENT_ANSWER_SCHEMA,
  AGENT_RECOVERY_SCHEMA,
  AGENT_REQUEST_SCHEMA,
  CONTRACT_VERSION,
  LEGACY_AGENT_ANSWER_SCHEMA
} from "../src/types.js";
import type { WorkflowStatus } from "../src/workflow.js";

const TIMESTAMP = "2026-08-17T12:00:00.000Z";

function state(overrides: Partial<RunState> = {}): RunState {
  return {
    schemaVersion: 3,
    contractVersion: CONTRACT_VERSION,
    runId: "20260817120000-agent-task-12345678",
    slug: "agent-task",
    request: "FORBIDDEN REQUEST `$(touch /tmp/owned)`",
    repoRoot: "/FORBIDDEN/ABSOLUTE/REPOSITORY",
    status: "created",
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
    baseCommit: "f".repeat(40),
    baseline: [],
    workflowSelection: null,
    planArtifacts: null,
    planApproval: null,
    planTaskCompletion: null,
    adrDecisions: [],
    pendingHumanDecision: null,
    humanDecisions: [],
    sessions: { planner: null, implementer: null, reviewer: null },
    pendingReviewRotationReason: null,
    reviewIteration: 0,
    latestReview: null,
    triage: null,
    triageHistory: [],
    fixCycle: 0,
    workspaceDigest: null,
    verification: [],
    metrics: {
      completedAttemptIds: [],
      attempts: {
        selection: 0,
        plan: 0,
        implementation: 0,
        fix: 0,
        review: 0,
        verification: 0
      },
      modelDurationMs: 0,
      usage: {
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        costUsd: null
      },
      reviewFindingCount: 0,
      sessions: { fresh: 0, resumed: 0 },
      reviews: { full: 0, delta: 0, rotations: 0 },
      triage: { accepted: 0, rejected: 0, deferred: 0 }
    },
    activeAttempt: null,
    activeProcess: null,
    blockedFrom: null,
    blockReason: null,
    ...overrides
  };
}

function workflowStatus(
  current: RunState,
  overrides: Partial<WorkflowStatus> = {}
): WorkflowStatus {
  return {
    state: current,
    planApprovalValid: null,
    reviewValid: null,
    latestReview: null,
    retry: {
      eligible: false,
      reason: `Retry requires a blocked run, but the run is ${current.status}.`,
      attemptId: null
    },
    recovery: {
      eligible: false,
      reason: "Recovery is unavailable.",
      warning: "Partial side effects may exist.",
      sourceKind: null,
      attemptId: null,
      phase: null,
      resolvedFindingIds: [],
      remainingFindingIds: [],
      prerequisites: [],
      authorization: null,
      recoveryIdentity: null,
      workspace: null,
      baseCommit: null,
      approvalDigest: null,
      workflowDigest: null,
      scopeDigest: null,
      configurationDigest: null
    },
    nextAction: "FORBIDDEN HUMAN COMMAND",
    taskCompletion: {
      state: "unknown",
      source: "unknown",
      completed: null,
      total: null,
      diagnostics: []
    },
    completionPublication: null,
    ...overrides
  };
}

function review(): ReviewResult {
  return {
    contractVersion: CONTRACT_VERSION,
    verdict: "changes_requested",
    summary: "One current finding requires human triage.",
    findings: [
      {
        id: "R1-F1",
        severity: "should_fix",
        category: "correctness",
        summary: "The public projection omits a required state.",
        evidence: [
          {
            path: "src/example.ts",
            line: 12,
            detail: "FORBIDDEN RAW REVIEW EVIDENCE"
          }
        ],
        violates: ["FR7"],
        reproduction: "FORBIDDEN REPRODUCTION",
        fixAcceptance: "Expose the state.",
        confidence: "high"
      }
    ],
    reviewedFindingIds: [],
    deferredCoverage: []
  };
}

function encoded(value: unknown): Uint8Array {
  return Buffer.from(JSON.stringify(value));
}

function consultationPending(): Extract<
  NonNullable<RunState["pendingHumanDecision"]>,
  { kind: "decision_consultation" }
> {
  return {
    kind: "decision_consultation",
    phase: "plan",
    gate: "decision_consultation",
    summary: "Choose the durable answer boundary.",
    request: {
      schema: "banzai-decision-consultation/v1",
      schemaVersion: 1,
      requestId: "request-1",
      roundId: "round-1",
      decisions: [
        {
          decisionId: "decision-store",
          title: "Answer persistence",
          question: "Where should the answer persist?",
          why: "A fresh planner must receive the same human preference.",
          affectedRequirements: ["FR15", "FR27"],
          evidence: [
            {
              path: "packages/orchestrator/src/store.ts",
              line: 42,
              detail: "The store owns atomic run-state writes."
            }
          ],
          decisionOwner: "human",
          responseMode: "single_choice",
          options: [
            {
              optionId: "run-state",
              title: "Persist in run state",
              benefits: ["Survives process restart"],
              costs: ["Requires state v3"],
              risks: ["Legacy readers must remain truthful"],
              consequences: ["Fresh sessions retain provenance"]
            },
            {
              optionId: "session",
              title: "Keep in the model session",
              benefits: ["No new state field"],
              costs: ["Cannot survive session loss"],
              risks: ["Provenance can disappear"],
              consequences: ["Fresh fallback cannot continue"]
            }
          ],
          recommendation: {
            optionId: "run-state",
            rationale: "Durable continuation is required."
          }
        }
      ]
    },
    requestedAt: TIMESTAMP
  };
}

function hasCode(code: string): (error: unknown) => boolean {
  return (error) => error instanceof BanzaiError && error.code === code;
}

test("agent control capabilities declare the exact offline v5 operation set", () => {
  const capabilities = agentControlCapabilities();
  assert.equal(capabilities.schema, "banzai-agent-capabilities/v8");
  assert.equal(capabilities.schemaVersion, 8);
  assert.deepEqual(capabilities.workDocuments, {
    directoryPattern: "documentation/work/<slug>/",
    bindingSchemas: ["banzai-work-binding/v3"],
    workspaceSnapshotVersion: 3,
    verificationRequestSchemas: ["banzai-verification-request/v3"]
  });
  assert.equal(Object.hasOwn(capabilities, "artifactStorage"), false);
  assert.equal(capabilities.controlContractVersion, "8.0.0");
  assert.deepEqual(capabilities.completionPublication, {
    protocol: "banzai-completion-protocol/v1",
    stages: [
      "capture",
      "validate",
      "render",
      "candidate",
      "publication",
      "receipt",
      "attempt",
      "state",
      "event"
    ],
    refusalCodes: [
      "COMPLETION_PUBLICATION_IO",
      "COMPLETION_PUBLICATION_DRIFT",
      "COMPLETION_PUBLICATION_INTEGRITY"
    ],
    statusSchema: "banzai-agent-status/v6"
  });
  assert.equal(capabilities.orchestratorVersion, packageManifest.version);
  assert.equal(capabilities.umbrellaContractVersion, CONTRACT_VERSION);
  assert.deepEqual(Object.keys(capabilities.operations), [
    "status",
    "start",
    "answer",
    "approveAdr",
    "approveVerification",
    "approvePlan",
    "decideGate",
    "triage",
    "resume",
    "retry",
    "recover",
    "cancel"
  ]);
  assert.deepEqual(capabilities.operations.start.inputSchemas, [
    AGENT_REQUEST_SCHEMA
  ]);
  assert.deepEqual(capabilities.operations.answer.inputSchemas, [
    "banzai-agent-answer/v4",
    "banzai-agent-answer/v3",
    AGENT_ANSWER_SCHEMA,
    LEGACY_AGENT_ANSWER_SCHEMA
  ]);
  assert.deepEqual(capabilities.operations.recover.inputSchemas, [
    AGENT_RECOVERY_SCHEMA
  ]);
  assert.deepEqual(capabilities.operations.status.inputSchemas, []);
  assert.deepEqual(
    Object.values(capabilities.operations).map((operation) => ({
      supported: operation.supported,
      ttyRequired: operation.ttyRequired
    })),
    Array.from({ length: 12 }, () => ({
      supported: true,
      ttyRequired: false
    }))
  );
  assert.equal(
    renderAgentControlJson(capabilities),
    `${JSON.stringify(capabilities, null, 2)}\n`
  );
});

test("request and legacy escalation decoders preserve arbitrary text as data", () => {
  const request =
    "  line one\n'\" `touch /tmp/owned` $(touch /tmp/owned); | > $VALUE  ";
  assert.deepEqual(
    decodeAgentControlRequest(
      encoded({
        schema: AGENT_REQUEST_SCHEMA,
        schemaVersion: 1,
        request
      })
    ),
    { schema: AGENT_REQUEST_SCHEMA, schemaVersion: 1, request }
  );
  const answers = ["  first; $(false)  ", "second\nanswer | `false`"];
  assert.deepEqual(
    decodeAgentControlAnswer(
      encoded({
        schema: LEGACY_AGENT_ANSWER_SCHEMA,
        schemaVersion: 1,
        answers
      })
    ),
    { schema: LEGACY_AGENT_ANSWER_SCHEMA, schemaVersion: 1, answers }
  );
});

test("v2 consultation answer decoder preserves keyed preference text as data", () => {
  const text = "  prefer an adapter\n`$(false)` | café  ";
  const answer = {
    schema: AGENT_ANSWER_SCHEMA,
    schemaVersion: 2,
    runId: "20260817120000-agent-task-12345678",
    requestId: "request-1",
    roundId: "round-1",
    answers: [
      {
        decisionId: "decision-store",
        response: { kind: "preference", optionId: null, text },
        note: null
      }
    ]
  } as const;

  assert.deepEqual(decodeAgentControlAnswer(encoded(answer)), answer);
});

test("recovery decoder accepts only exact explicit authorization", () => {
  const recoveryIdentity = "a".repeat(64);
  const valid = {
    schema: AGENT_RECOVERY_SCHEMA,
    schemaVersion: 1,
    attemptId: "implementation-1-abcd1234",
    recoveryIdentity,
    unknownSideEffectsAccepted: true
  } as const;
  assert.deepEqual(decodeAgentControlRecovery(encoded(valid)), valid);
  for (const invalid of [
    { ...valid, unknownSideEffectsAccepted: false },
    { ...valid, recoveryIdentity: "not-a-digest" },
    { ...valid, note: "looks intentional" }
  ]) {
    assert.throws(
      () => decodeAgentControlRecovery(encoded(invalid)),
      hasCode("INVALID_CONTROL_INPUT")
    );
  }
});

test("agent control decoders reject malformed unsupported and oversized documents", () => {
  for (const input of [
    Buffer.from(""),
    Buffer.from("{bad"),
    encoded([]),
    encoded({
      schema: AGENT_REQUEST_SCHEMA,
      schemaVersion: 1,
      request: "valid",
      extra: true
    }),
    encoded({ schema: AGENT_REQUEST_SCHEMA, schemaVersion: 1, request: " " })
  ]) {
    assert.throws(
      () => decodeAgentControlRequest(input),
      hasCode("INVALID_CONTROL_INPUT")
    );
  }
  assert.throws(
    () =>
      decodeAgentControlRequest(
        encoded({
          schema: "banzai-agent-request/v2",
          schemaVersion: 2,
          request: "valid"
        })
      ),
    hasCode("CONTROL_SCHEMA_UNSUPPORTED")
  );
  assert.throws(
    () =>
      decodeAgentControlRequest(
        Buffer.alloc(MAX_AGENT_CONTROL_INPUT_BYTES + 1, 0x61)
      ),
    hasCode("CONTROL_INPUT_TOO_LARGE")
  );
  for (const answers of [[], [""], Array.from({ length: 65 }, () => "x")]) {
    assert.throws(
      () =>
        decodeAgentControlAnswer(
          encoded({
            schema: LEGACY_AGENT_ANSWER_SCHEMA,
            schemaVersion: 1,
            answers
          })
        ),
      hasCode("INVALID_CONTROL_INPUT")
    );
  }
  for (const invalid of [
    {
      schema: AGENT_ANSWER_SCHEMA,
      schemaVersion: 2,
      runId: "run-1",
      requestId: "request-1",
      roundId: "round-1",
      answers: []
    },
    {
      schema: AGENT_ANSWER_SCHEMA,
      schemaVersion: 2,
      runId: "run-1",
      requestId: "request-1",
      roundId: "round-1",
      answers: [
        {
          decisionId: "decision-1",
          response: { kind: "option", optionId: "option-1", text: "mixed" },
          note: null
        }
      ]
    }
  ]) {
    assert.throws(
      () => decodeAgentControlAnswer(encoded(invalid)),
      hasCode("INVALID_CONTROL_INPUT")
    );
  }
});

test("status projection exposes bounded triage and evidence without internal data", () => {
  const verification: VerificationResult = {
    name: "FORBIDDEN VERIFICATION NAME",
    command: "FORBIDDEN COMMAND",
    args: ["FORBIDDEN ARGUMENT", "secret-token"],
    exitCode: 0,
    signal: null,
    stdoutPath: "/FORBIDDEN/STDOUT",
    stderrPath: "/FORBIDDEN/STDERR",
    startedAt: TIMESTAMP,
    completedAt: TIMESTAMP
  };
  const current = state({
    status: "needs_triage",
    workflowSelection: {
      contractVersion: CONTRACT_VERSION,
      recommendedWorkflow: "strict",
      workflow: "strict",
      confidence: "high",
      reason: "The request changes a public protocol.",
      escalationTriggers: ["public protocol"],
      selectedAt: TIMESTAMP,
      attemptId: "selection-1",
      digest: "FORBIDDEN APPROVAL DIGEST"
    },
    latestReview: {
      iteration: 1,
      resultPath: "reviews/review-1.json",
      artifactPath: "documentation/features/agent-task/review-1.md",
      workspaceDigest: "FORBIDDEN WORKSPACE DIGEST",
      verdict: "changes_requested",
      sessionMode: "fresh",
      mode: "full",
      rotationReason: "primary-review"
    },
    reviewIteration: 1,
    verification: [verification]
  });
  const projection = projectAgentControlStatus(
    workflowStatus(current, {
      latestReview: review(),
      reviewValid: true,
      taskCompletion: {
        state: "inconsistent",
        source: "structured completion evidence",
        completed: null,
        total: 9,
        diagnostics: [
          {
            code: "PLAN_TASK_COMPLETION_INVALID",
            taskId: "T004",
            message: "Canonical task evidence cannot be revalidated."
          }
        ]
      }
    })
  );
  const activeRun = projection.activeRun;
  assert.ok(activeRun);
  assert.equal(activeRun.nextAction, "triage");
  assert.deepEqual(activeRun.pendingGate, {
    kind: "review_triage",
    iteration: 1,
    artifactPath: "documentation/features/agent-task/review-1.md",
    findings: [
      {
        id: "R1-F1",
        severity: "should_fix",
        category: "correctness",
        summary: "The public projection omits a required state.",
        evidencePath: "src/example.ts"
      }
    ]
  });
  assert.deepEqual(activeRun.verification, {
    total: 1,
    passed: 1,
    failed: 0,
    results: [{ ordinal: 1, outcome: "pass", exitCode: 0, signal: null }]
  });
  const output = renderAgentControlJson(projection);
  for (const forbidden of [
    "FORBIDDEN REQUEST",
    "/FORBIDDEN/ABSOLUTE/REPOSITORY",
    "FORBIDDEN HUMAN COMMAND",
    "FORBIDDEN COMMAND",
    "FORBIDDEN ARGUMENT",
    "FORBIDDEN APPROVAL DIGEST",
    "FORBIDDEN WORKSPACE DIGEST",
    "FORBIDDEN CONFIGURATION DIGEST",
    "FORBIDDEN RAW REVIEW EVIDENCE",
    "FORBIDDEN REPRODUCTION"
  ]) {
    assert.doesNotMatch(output, new RegExp(forbidden));
  }
});

test("status projection derives every semantic action from runner state", () => {
  const cases: {
    status: RunStatus;
    expected: string | null;
    retry?: boolean;
    state?: Partial<RunState>;
    workflow?: Partial<WorkflowStatus>;
  }[] = [
    {
      status: "needs_adr_approval",
      expected: "approve_adr",
      state: {
        planArtifacts: {
          description: "documentation/features/x/description.md",
          plan: null,
          adrs: ["documentation/decisions/0018-agent-control.md"],
          implementationReport: null,
          testReport: null
        }
      }
    },
    {
      status: "needs_plan_approval",
      expected: "approve_plan",
      state: {
        planArtifacts: {
          description: "documentation/features/x/description.md",
          plan: "documentation/development-plans/x/plan.md",
          adrs: ["documentation/decisions/0018-agent-control.md"],
          implementationReport: null,
          testReport: null
        }
      }
    },
    {
      status: "needs_human_decision",
      expected: "answer_escalation",
      state: {
        pendingHumanDecision: {
          kind: "escalation",
          phase: "implementation",
          gate: "escalation",
          summary: "A public decision is required.",
          questions: [],
          requestedAt: TIMESTAMP
        }
      }
    },
    {
      status: "needs_human_decision",
      expected: "answer_consultation",
      state: { pendingHumanDecision: consultationPending() }
    },
    { status: "selecting", expected: "resume" },
    { status: "blocked", expected: "retry", retry: true },
    {
      status: "blocked",
      expected: "retry",
      retry: true,
      workflow: {
        recovery: {
          ...workflowStatus(state()).recovery,
          reason:
            "The terminal checkpoint result was rejected by completion validation.",
          attemptId: "implementation-1-rejected-checkpoint",
          phase: "implementation",
          terminalCheckpointPresent: true
        }
      }
    },
    {
      status: "blocked",
      expected: "resume",
      retry: false,
      workflow: {
        recovery: {
          ...workflowStatus(state()).recovery,
          reason: "A terminal checkpoint can be reconciled.",
          attemptId: "implementation-1-checkpoint",
          phase: "implementation",
          terminalCheckpointPresent: true
        }
      }
    },
    {
      status: "blocked",
      expected: "recover",
      retry: false,
      workflow: {
        recovery: {
          eligible: true,
          reason: "Exact partial workspace recovery is available.",
          warning: "Side effects may be partial or duplicated.",
          sourceKind: "interrupted",
          attemptId: "implementation-1-abcd1234",
          phase: "implementation",
          resolvedFindingIds: [],
          remainingFindingIds: [],
          prerequisites: [],
          authorization: "plan_approval",
          recoveryIdentity: "a".repeat(64),
          workspace: {
            digest: "FORBIDDEN WORKSPACE DIGEST",
            added: 1,
            modified: 2,
            deleted: 3,
            total: 6
          },
          baseCommit: "b".repeat(40),
          approvalDigest: "c".repeat(64),
          workflowDigest: "d".repeat(64),
          scopeDigest: "e".repeat(64),
          configurationDigest: "FORBIDDEN CONFIGURATION DIGEST"
        }
      }
    },
    {
      status: "blocked",
      expected: "recover",
      retry: false,
      workflow: {
        recovery: {
          eligible: true,
          reason:
            "Completed blocked fix may recover R1-F3 after 1 operator prerequisite.",
          warning: "The completed source remains historical.",
          sourceKind: "prerequisite_blocked_fix",
          attemptId: "fix-2-fff81cb4",
          phase: "fix",
          resolvedFindingIds: ["R1-F2", "R1-F5", "R1-F6"],
          remainingFindingIds: ["R1-F3"],
          prerequisites: ["FORBIDDEN RAW COMMAND docker exec private/database"],
          authorization: "plan_approval",
          recoveryIdentity: "a".repeat(64),
          workspace: {
            digest: "FORBIDDEN WORKSPACE DIGEST",
            added: 1,
            modified: 2,
            deleted: 3,
            total: 6
          },
          baseCommit: "b".repeat(40),
          approvalDigest: "c".repeat(64),
          workflowDigest: null,
          scopeDigest: "e".repeat(64),
          configurationDigest: "FORBIDDEN CONFIGURATION DIGEST"
        }
      }
    },
    { status: "blocked", expected: "cancel", retry: false },
    { status: "done", expected: null },
    { status: "cancelled", expected: null }
  ];
  for (const item of cases) {
    const current = state({
      status: item.status,
      blockedFrom: item.status === "blocked" ? "planning" : null,
      blockReason:
        item.status === "blocked" ? "External process failed." : null,
      ...item.state
    });
    const projection = projectAgentControlStatus(
      workflowStatus(current, {
        retry: {
          eligible: item.retry ?? false,
          reason: item.retry
            ? "The read-only attempt can be retried."
            : "Retry is not eligible.",
          attemptId: item.retry ? "plan-1" : null
        },
        ...item.workflow
      })
    );
    const activeRun = projection.activeRun;
    assert.ok(activeRun);
    assert.equal(activeRun.nextAction, item.expected, item.status);
    if (item.expected === "recover") {
      assert.deepEqual(activeRun.recovery.workspace, {
        added: 1,
        modified: 2,
        deleted: 3,
        total: 6
      });
      assert.equal(activeRun.recovery.authorization, "plan_approval");
      assert.doesNotMatch(
        JSON.stringify(activeRun.recovery),
        /FORBIDDEN WORKSPACE DIGEST|FORBIDDEN CONFIGURATION DIGEST|FORBIDDEN RAW COMMAND/
      );
    }
    if (item.status === "needs_plan_approval") {
      assert.deepEqual(activeRun.pendingGate, {
        kind: "plan_approval",
        artifactPaths: [
          "documentation/features/x/description.md",
          "documentation/decisions/0018-agent-control.md",
          "documentation/development-plans/x/plan.md"
        ],
        decisions: ["approve"],
        reviewPaths: [
          "documentation/features/x/description.md",
          "documentation/decisions/0018-agent-control.md",
          "documentation/development-plans/x/plan.md"
        ]
      });
    }
    if (item.status === "needs_human_decision") {
      if (item.expected === "answer_escalation") {
        assert.deepEqual(activeRun.pendingGate, {
          kind: "escalation",
          phase: "implementation",
          summary: "A public decision is required.",
          questions: ["What decision or approval should planning apply?"]
        });
      } else {
        assert.deepEqual(activeRun.pendingGate, {
          kind: "decision_consultation",
          phase: "plan",
          summary: "Choose the durable answer boundary.",
          runId: "20260817120000-agent-task-12345678",
          request: consultationPending().request
        });
      }
    }
  }
  assert.deepEqual(emptyAgentControlStatus(), {
    schema: "banzai-agent-status/v6",
    schemaVersion: 6,
    activeRun: null
  });
});

test("status projection fails closed for unsafe public paths and unbounded fields", () => {
  assert.throws(
    () =>
      projectAgentControlStatus(
        workflowStatus(
          state({
            status: "needs_plan_approval",
            planArtifacts: {
              description: "/private/description.md",
              plan: "documentation/development-plans/x/plan.md",
              adrs: [],
              implementationReport: null,
              testReport: null
            }
          })
        )
      ),
    hasCode("CONTROL_STATUS_INVALID")
  );
  assert.throws(
    () =>
      projectAgentControlStatus(
        workflowStatus(state(), {
          retry: {
            eligible: false,
            reason: "x".repeat(4_097),
            attemptId: null
          }
        })
      ),
    hasCode("CONTROL_STATUS_INVALID")
  );
  assert.throws(
    () =>
      projectAgentControlStatus(
        workflowStatus(state(), {
          recovery: {
            ...workflowStatus(state()).recovery,
            workspace: {
              digest: "private",
              added: 1,
              modified: 1,
              deleted: 1,
              total: 99
            }
          }
        })
      ),
    hasCode("CONTROL_STATUS_INVALID")
  );
});

test("status projection excludes completed consultation history while retaining current action only", () => {
  const request = consultationPending();
  const firstDecision = request.request.decisions[0];
  assert.ok(firstDecision);
  const projection = projectAgentControlStatus(
    workflowStatus(
      state({
        status: "planning",
        humanDecisions: [
          {
            ...request,
            summary: "HISTORICAL SUMMARY CANARY",
            request: {
              ...request.request,
              decisions: [
                {
                  ...firstDecision,
                  question: "HISTORICAL QUESTION CANARY"
                }
              ]
            },
            runId: "HISTORICAL RUN CANARY",
            requestId: "HISTORICAL REQUEST CANARY",
            roundId: "HISTORICAL ROUND CANARY",
            answers: [
              {
                decisionId: "decision-store",
                response: {
                  kind: "preference",
                  optionId: null,
                  text: "HISTORICAL ANSWER CANARY"
                },
                note: "HISTORICAL NOTE CANARY"
              }
            ],
            decidedAt: TIMESTAMP,
            decidedBy: "HISTORICAL DECIDER CANARY"
          }
        ]
      })
    )
  );
  const output = renderAgentControlJson(projection);
  for (const forbidden of [
    "HISTORICAL SUMMARY CANARY",
    "HISTORICAL QUESTION CANARY",
    "HISTORICAL RUN CANARY",
    "HISTORICAL REQUEST CANARY",
    "HISTORICAL ROUND CANARY",
    "HISTORICAL ANSWER CANARY",
    "HISTORICAL NOTE CANARY",
    "HISTORICAL DECIDER CANARY"
  ]) {
    assert.doesNotMatch(output, new RegExp(forbidden));
  }
});

test("consultation status accepts every runtime-valid bounded card", () => {
  const pending = consultationPending();
  const card = pending.request.decisions[0];
  assert.ok(card);
  card.why = "w".repeat(1_200);
  const projection = projectAgentControlStatus(
    workflowStatus(
      state({
        status: "needs_human_decision",
        pendingHumanDecision: pending
      })
    )
  );
  assert.equal(
    projection.activeRun?.pendingGate?.kind,
    "decision_consultation"
  );
});

test("configuration v3 answers are closed, bounded and preserve literal argv without changing legacy answers", () => {
  const answer = {
    schema: "banzai-agent-answer/v3",
    schemaVersion: 3,
    kind: "configuration_prerequisite",
    runId: "current-run",
    decisionId: "11111111-1111-4111-8111-111111111111",
    proposalId: "22222222-2222-4222-8222-222222222222",
    action: "accept"
  };
  const decode = (value: unknown) =>
    decodeAgentControlAnswer(Buffer.from(JSON.stringify(value)));
  assert.deepEqual(decode(answer), answer);
  for (const invalid of [
    { ...answer, schemaVersion: 2 },
    { ...answer, kind: "escalation" },
    { ...answer, action: "yes" },
    { ...answer, proposalId: "stale" },
    { ...answer, profile: { id: "node", commands: [] } },
    { ...answer, action: "edit" },
    { ...answer, extra: true },
    { ...answer, runId: "bad\u202erun" }
  ])
    assert.throws(() => decode(invalid));
  assert.throws(() =>
    decodeAgentControlAnswer(
      Buffer.from(
        JSON.stringify(answer).replace(
          '"action":"accept"',
          '"action":"skip","action":"accept"'
        )
      )
    )
  );
  assert.throws(() => decodeAgentControlAnswer(Buffer.from([0xff, 0xfe])));
  const command = {
    name: "tests",
    command: "npm",
    args: ["run", "test", "$(literal)", "one argument"],
    timeoutMs: 1000
  };
  const edited = {
    ...answer,
    action: "edit",
    profile: { id: "node", commands: [command] }
  };
  assert.deepEqual(decode(edited), edited);
  for (const malformed of [
    { ...command, evidence: "fresh" },
    { ...command, ignoreExplanatory: false },
    { ...command, timeoutMs: 86400001 },
    { ...command, name: "x".repeat(201) },
    { ...command, args: ["bad\narg"] }
  ])
    assert.throws(() =>
      decode({ ...edited, profile: { id: "node", commands: [malformed] } })
    );
  assert.throws(() =>
    decode({
      ...edited,
      profile: {
        id: "node",
        commands: Array.from({ length: 201 }, () => command)
      }
    })
  );
});

test("planning control documents use closed identities and raw UTF-8 bounds", () => {
  const gate = {
    schema: "banzai-agent-gate-decision/v1",
    schemaVersion: 1,
    runId: "run-planning",
    gate: "plan_approval",
    decision: "rework",
    adrId: null,
    feedback: "Owner feedback",
    paths: null
  };
  assert.equal(
    decodePlanningGateDecision(Buffer.from(JSON.stringify(gate))).feedback,
    "Owner feedback"
  );
  for (const invalid of [
    { ...gate, feedback: null },
    { ...gate, paths: ["plan.md"] },
    { ...gate, adrId: "ADR-0001" },
    { ...gate, decision: "review" },
    { ...gate, extra: true },
    { ...gate, feedback: "\ud800" }
  ])
    assert.throws(() =>
      decodePlanningGateDecision(Buffer.from(JSON.stringify(invalid)))
    );
  assert.throws(() =>
    decodePlanningGateDecision(
      Buffer.from(
        JSON.stringify(gate).replace(
          '"runId":"run-planning"',
          '"runId":"run-planning","runId":"run-other"'
        )
      )
    )
  );
  const answer = {
    schema: "banzai-agent-answer/v4",
    schemaVersion: 4,
    runId: "run-planning",
    episodeId: "planning-episode-12345678",
    reviewNumber: 1,
    analysisDigest: "a".repeat(64),
    dispositions: Array.from({ length: 20 }, (_, index) => ({
      findingId: `P1-F${index + 1}`,
      kind: "instruction",
      optionId: null,
      instruction: "ї".repeat(1000)
    })),
    additionalInstruction: "ї".repeat(4000)
  };
  const raw = JSON.stringify(answer);
  assert.ok(Buffer.byteLength(raw) < 64 * 1024);
  assert.equal(
    decodeAgentControlAnswer(Buffer.from(raw)).schema,
    "banzai-agent-answer/v4"
  );
  const escaped = raw.replace(
    /[^\x00-\x7f]/gu,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`
  );
  assert.throws(
    () => decodeAgentControlAnswer(Buffer.from(escaped)),
    (error) =>
      error instanceof BanzaiError && error.code === "CONTROL_INPUT_TOO_LARGE"
  );
});
