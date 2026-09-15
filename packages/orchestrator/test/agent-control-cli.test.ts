import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import {
  executeAgentControlCapabilities,
  executeAgentControlCommand,
  parseAgentControlArgs,
  type AgentControlRunner
} from "../src/agent-control-cli.js";
import { MAX_AGENT_CONTROL_INPUT_BYTES } from "../src/agent-control.js";
import { BanzaiError } from "../src/errors.js";
import type { RunState } from "../src/types.js";
import {
  AGENT_ANSWER_SCHEMA,
  AGENT_RECOVERY_SCHEMA,
  AGENT_REQUEST_SCHEMA,
  CONTRACT_VERSION,
  LEGACY_AGENT_ANSWER_SCHEMA
} from "../src/types.js";
import type { WorkflowStatus } from "../src/workflow.js";

function currentState(): RunState {
  return {
    schemaVersion: 3,
    contractVersion: CONTRACT_VERSION,
    runId: "20260817120000-agent-task-12345678",
    slug: "agent-task",
    request: "private request",
    repoRoot: "/private/repository",
    status: "selecting",
    createdAt: "2026-08-17T12:00:00.000Z",
    updatedAt: "2026-08-17T12:00:00.000Z",
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
    blockReason: null
  };
}

function status(state = currentState()): WorkflowStatus {
  return {
    state,
    planApprovalValid: null,
    reviewValid: null,
    latestReview: null,
    retry: {
      eligible: false,
      reason: `Retry requires a blocked run, but the run is ${state.status}.`,
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
    nextAction: "banzai resume",
    taskCompletion: {
      state: "unknown",
      source: "unknown",
      completed: null,
      total: null,
      diagnostics: []
    }
  };
}

function consultationState(): RunState {
  return {
    ...currentState(),
    status: "needs_human_decision",
    pendingHumanDecision: {
      kind: "decision_consultation",
      phase: "plan",
      gate: "decision_consultation",
      summary: "Choose the durable state boundary.",
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
            why: "Fresh sessions need durable human evidence.",
            affectedRequirements: ["FR15"],
            evidence: [
              {
                path: "packages/orchestrator/src/store.ts",
                line: 42,
                detail: "The store owns atomic state."
              }
            ],
            decisionOwner: "human",
            responseMode: "single_choice",
            options: [
              {
                optionId: "run-state",
                title: "Persist in run state",
                benefits: ["Durable"],
                costs: ["State revision"],
                risks: ["Legacy compatibility"],
                consequences: ["Fresh sessions retain the answer"]
              },
              {
                optionId: "session",
                title: "Keep in session",
                benefits: ["No state field"],
                costs: ["Session dependency"],
                risks: ["Answer loss"],
                consequences: ["Fresh fallback cannot continue"]
              }
            ],
            recommendation: {
              optionId: "run-state",
              rationale: "Durability is required."
            }
          }
        ]
      },
      requestedAt: "2026-08-31T09:00:00.000Z"
    }
  };
}

function escalationState(): RunState {
  return {
    ...currentState(),
    status: "needs_human_decision",
    pendingHumanDecision: {
      kind: "escalation",
      phase: "implementation",
      gate: "escalation",
      summary: "Choose the compatibility behavior.",
      questions: ["Preserve compatibility?"],
      requestedAt: "2026-08-31T09:00:00.000Z"
    }
  };
}

class FakeRunner implements AgentControlRunner {
  async answerConfigurationPrerequisite(): Promise<RunState> {
    throw new Error("Unexpected configuration prerequisite answer");
  }

  readonly starts: { slug: string; request: string }[] = [];
  readonly answers: {
    input: { answers: string[]; decidedBy: string };
    autoResume: boolean | undefined;
  }[] = [];
  readonly consultationAnswers: {
    input: {
      runId: string;
      requestId: string;
      roundId: string;
      answers: {
        decisionId: string;
        response: {
          kind: "option" | "preference";
          optionId: string | null;
          text: string | null;
        };
        note: string | null;
      }[];
      decidedBy: string;
    };
    autoResume: boolean | undefined;
  }[] = [];
  readonly recoveries: {
    input: {
      attemptId: string;
      recoveryIdentity: string;
      unknownSideEffectsAccepted: true;
      decidedBy: string;
    };
    autoResume: boolean | undefined;
  }[] = [];
  statusError: Error | null = null;
  currentStatus = status();

  async status(): Promise<WorkflowStatus> {
    if (this.statusError !== null) {
      throw this.statusError;
    }
    return this.currentStatus;
  }

  async start(input: { slug: string; request: string }): Promise<RunState> {
    this.starts.push(input);
    return this.currentStatus.state;
  }

  async answerHumanDecision(
    input: { answers: string[]; decidedBy: string },
    autoResume?: boolean
  ): Promise<RunState> {
    this.answers.push({ input, autoResume });
    return this.currentStatus.state;
  }

  async answerDecisionConsultation(
    input: (typeof this.consultationAnswers)[number]["input"],
    autoResume?: boolean
  ): Promise<RunState> {
    this.consultationAnswers.push({ input, autoResume });
    this.currentStatus = status({
      ...this.currentStatus.state,
      status: "planning",
      pendingHumanDecision: null
    });
    return this.currentStatus.state;
  }

  async recover(
    input: {
      attemptId: string;
      recoveryIdentity: string;
      unknownSideEffectsAccepted: true;
      decidedBy: string;
    },
    autoResume?: boolean
  ): Promise<RunState> {
    this.recoveries.push({ input, autoResume });
    return this.currentStatus.state;
  }
}

function stream(value = ""): Readable {
  return Readable.from([Buffer.from(value)]);
}

function document(value: unknown): string {
  return JSON.stringify(value);
}

function code(expected: string): (error: unknown) => boolean {
  return (error) => error instanceof BanzaiError && error.code === expected;
}

test("control arguments accept only the closed command grammar", () => {
  assert.deepEqual(parseAgentControlArgs(["capabilities"]), {
    command: "capabilities"
  });
  assert.deepEqual(parseAgentControlArgs(["status"]), { command: "status" });
  assert.deepEqual(parseAgentControlArgs(["start", "--slug", "safe-slug"]), {
    command: "start",
    slug: "safe-slug"
  });
  assert.deepEqual(
    parseAgentControlArgs(["answer", "--no-resume", "--by", "Current User"]),
    { command: "answer", decidedBy: "Current User", autoResume: false }
  );
  assert.deepEqual(parseAgentControlArgs(["answer"]), {
    command: "answer",
    decidedBy: null,
    autoResume: true
  });
  assert.deepEqual(
    parseAgentControlArgs(["recover", "--by", "Current User", "--no-resume"]),
    { command: "recover", decidedBy: "Current User", autoResume: false }
  );
  for (const args of [
    [],
    ["--help"],
    ["capabilities", "--json"],
    ["status", "--json"],
    ["start"],
    ["start", "safe-slug"],
    ["start", "--slug", ""],
    ["answer", "--by"],
    ["answer", "--by", "a", "--by", "b"],
    ["answer", "--no-resume", "--no-resume"],
    ["answer", "--unknown"],
    ["recover", "--by"],
    ["recover", "--unknown"]
  ]) {
    assert.throws(
      () => parseAgentControlArgs(args),
      code("INVALID_CONTROL_COMMAND")
    );
  }
});

test("capabilities and no-active-run status emit one canonical JSON document", async () => {
  const capabilityOutput: string[] = [];
  executeAgentControlCapabilities({
    stdin: stream(),
    stdout: (value) => capabilityOutput.push(value)
  });
  assert.equal(capabilityOutput.length, 1);
  assert.equal(
    (JSON.parse(capabilityOutput[0] ?? "") as { schema: string }).schema,
    "banzai-agent-capabilities/v4"
  );

  const runner = new FakeRunner();
  runner.statusError = new BanzaiError("NO_ACTIVE_RUN", "No active run.");
  const statusOutput: string[] = [];
  await executeAgentControlCommand(
    { command: "status" },
    () => runner,
    {
      stdin: stream("this input is not consumed"),
      stdout: (value) => statusOutput.push(value)
    },
    "default-user"
  );
  assert.deepEqual(JSON.parse(statusOutput[0] ?? ""), {
    schema: "banzai-agent-status/v3",
    schemaVersion: 3,
    activeRun: null
  });
});

test("control start passes metacharacter request data unchanged and refreshes status", async () => {
  const runner = new FakeRunner();
  const request = "  first\n'\"; | > $(touch /tmp/owned) `false` $VALUE  ";
  const output: string[] = [];
  await executeAgentControlCommand(
    { command: "start", slug: "agent-task" },
    () => runner,
    {
      stdin: stream(
        document({
          schema: AGENT_REQUEST_SCHEMA,
          schemaVersion: 1,
          request
        })
      ),
      stdout: (value) => output.push(value)
    },
    "default-user"
  );
  assert.deepEqual(runner.starts, [{ slug: "agent-task", request }]);
  assert.equal(output.length, 1);
  assert.equal(
    (JSON.parse(output[0] ?? "") as { activeRun: { state: string } }).activeRun
      .state,
    "selecting"
  );
});

test("control answer preserves ordered text provenance and resume choice", async () => {
  const runner = new FakeRunner();
  runner.currentStatus = status(escalationState());
  const answers = ["  accept; $(false)  ", "second\nanswer | `false`"];
  const output: string[] = [];
  await executeAgentControlCommand(
    {
      command: "answer",
      decidedBy: "Explicit User",
      autoResume: false
    },
    () => runner,
    {
      stdin: stream(
        document({
          schema: LEGACY_AGENT_ANSWER_SCHEMA,
          schemaVersion: 1,
          answers
        })
      ),
      stdout: (value) => output.push(value)
    },
    "default-user"
  );
  assert.deepEqual(runner.answers, [
    {
      input: { answers, decidedBy: "Explicit User" },
      autoResume: false
    }
  ]);
  assert.equal(output.length, 1);

  const defaultRunner = new FakeRunner();
  defaultRunner.currentStatus = status(escalationState());
  await executeAgentControlCommand(
    { command: "answer", decidedBy: null, autoResume: true },
    () => defaultRunner,
    {
      stdin: stream(
        document({
          schema: LEGACY_AGENT_ANSWER_SCHEMA,
          schemaVersion: 1,
          answers: ["yes"]
        })
      ),
      stdout: () => undefined
    },
    "default-user"
  );
  assert.deepEqual(defaultRunner.answers, [
    {
      input: { answers: ["yes"], decidedBy: "default-user" },
      autoResume: true
    }
  ]);
});

test("control v2 consultation answer validates exact identities and emits post-mutation status", async () => {
  const runner = new FakeRunner();
  runner.currentStatus = status(consultationState());
  const output: string[] = [];
  await executeAgentControlCommand(
    { command: "answer", decidedBy: "Explicit User", autoResume: false },
    () => runner,
    {
      stdin: stream(
        document({
          schema: AGENT_ANSWER_SCHEMA,
          schemaVersion: 2,
          runId: "20260817120000-agent-task-12345678",
          requestId: "request-1",
          roundId: "round-1",
          answers: [
            {
              decisionId: "decision-store",
              response: {
                kind: "option",
                optionId: "run-state",
                text: null
              },
              note: "Keep `$(false)` as inert data."
            }
          ]
        })
      ),
      stdout: (value) => output.push(value)
    },
    "default-user"
  );

  assert.deepEqual(runner.consultationAnswers, [
    {
      input: {
        runId: "20260817120000-agent-task-12345678",
        requestId: "request-1",
        roundId: "round-1",
        answers: [
          {
            decisionId: "decision-store",
            response: {
              kind: "option",
              optionId: "run-state",
              text: null
            },
            note: "Keep `$(false)` as inert data."
          }
        ],
        decidedBy: "Explicit User"
      },
      autoResume: false
    }
  ]);
  assert.equal(
    (JSON.parse(output[0] ?? "") as { activeRun: { state: string } }).activeRun
      .state,
    "planning"
  );
});

test("control rejects v1, stale, and invalid-option consultation answers before mutation", async () => {
  const inputs = [
    {
      schema: LEGACY_AGENT_ANSWER_SCHEMA,
      schemaVersion: 1,
      answers: ["Use run state."]
    },
    {
      schema: AGENT_ANSWER_SCHEMA,
      schemaVersion: 2,
      runId: "wrong-run",
      requestId: "request-1",
      roundId: "round-1",
      answers: [
        {
          decisionId: "decision-store",
          response: { kind: "option", optionId: "run-state", text: null },
          note: null
        }
      ]
    },
    {
      schema: AGENT_ANSWER_SCHEMA,
      schemaVersion: 2,
      runId: "20260817120000-agent-task-12345678",
      requestId: "request-1",
      roundId: "round-1",
      answers: [
        {
          decisionId: "decision-store",
          response: { kind: "option", optionId: "unknown", text: null },
          note: null
        }
      ]
    }
  ];

  for (const input of inputs) {
    const runner = new FakeRunner();
    runner.currentStatus = status(consultationState());
    const output: string[] = [];
    await assert.rejects(
      executeAgentControlCommand(
        { command: "answer", decidedBy: null, autoResume: true },
        () => runner,
        {
          stdin: stream(document(input)),
          stdout: (value) => output.push(value)
        },
        "default-user"
      ),
      (error: unknown) => error instanceof BanzaiError
    );
    assert.deepEqual(runner.answers, []);
    assert.deepEqual(runner.consultationAnswers, []);
    assert.deepEqual(output, []);
    assert.equal(runner.currentStatus.state.status, "needs_human_decision");
  }
});

test("control recovery requires exact structured authorization and preserves provenance", async () => {
  const runner = new FakeRunner();
  const recoveryIdentity = "a".repeat(64);
  const output: string[] = [];
  await executeAgentControlCommand(
    { command: "recover", decidedBy: "Explicit User", autoResume: false },
    () => runner,
    {
      stdin: stream(
        document({
          schema: AGENT_RECOVERY_SCHEMA,
          schemaVersion: 1,
          attemptId: "fix-4-9884535f",
          recoveryIdentity,
          unknownSideEffectsAccepted: true
        })
      ),
      stdout: (value) => output.push(value)
    },
    "default-user"
  );
  assert.deepEqual(runner.recoveries, [
    {
      input: {
        attemptId: "fix-4-9884535f",
        recoveryIdentity,
        unknownSideEffectsAccepted: true,
        decidedBy: "Explicit User"
      },
      autoResume: false
    }
  ]);
  assert.equal(output.length, 1);

  for (const invalid of [
    {
      schema: AGENT_RECOVERY_SCHEMA,
      schemaVersion: 1,
      attemptId: "fix-4-9884535f",
      recoveryIdentity,
      unknownSideEffectsAccepted: false
    },
    {
      schema: AGENT_RECOVERY_SCHEMA,
      schemaVersion: 1,
      attemptId: "fix-4-9884535f",
      recoveryIdentity,
      unknownSideEffectsAccepted: true,
      note: "infer intent"
    }
  ]) {
    const rejected = new FakeRunner();
    await assert.rejects(
      executeAgentControlCommand(
        { command: "recover", decidedBy: null, autoResume: true },
        () => rejected,
        { stdin: stream(document(invalid)), stdout: () => undefined },
        "default-user"
      ),
      code("INVALID_CONTROL_INPUT")
    );
    assert.deepEqual(rejected.recoveries, []);
  }
});

test("invalid or oversized stdin performs no mutation and writes no JSON", async () => {
  for (const value of [
    "{bad",
    document({
      schema: "banzai-agent-request/v2",
      schemaVersion: 2,
      request: "valid"
    }),
    "x".repeat(MAX_AGENT_CONTROL_INPUT_BYTES + 1)
  ]) {
    const runner = new FakeRunner();
    let constructions = 0;
    const output: string[] = [];
    await assert.rejects(
      executeAgentControlCommand(
        { command: "start", slug: "agent-task" },
        () => {
          constructions += 1;
          return runner;
        },
        { stdin: stream(value), stdout: (item) => output.push(item) },
        "default-user"
      ),
      (error: unknown) => error instanceof BanzaiError
    );
    assert.deepEqual(runner.starts, []);
    assert.deepEqual(runner.answers, []);
    assert.deepEqual(output, []);
    assert.equal(constructions, 0);
  }
});
