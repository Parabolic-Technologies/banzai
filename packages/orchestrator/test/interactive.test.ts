import {
  deriveHumanTime,
  emptyHumanTime,
  emptyHumanTimeEvidence,
  humanTimeObservation
} from "../src/human-time.js";
import type {
  HumanTimeGateway,
  HumanTimeSummary,
  HumanTimeWriteResult
} from "../src/human-time.js";
import assert from "node:assert/strict";
import { Writable } from "node:stream";
import test from "node:test";
import packageManifest from "../package.json" with { type: "json" };
import {
  planningTriageRequest,
  planningReviewResult,
  planningReviewAnalysis
} from "./planning-review-fixtures.js";
import { DEFAULT_CONFIG, type ModelUpdate } from "../src/config.js";
import { BanzaiError } from "../src/errors.js";
import { TerminalAttention } from "../src/terminal-attention.js";
import {
  generateFeatureSlug,
  runInteractive,
  type InteractiveChoice,
  type InteractiveInput,
  type InteractiveIO,
  type AuthenticationGateway,
  type InteractiveRunner,
  type ModelConfigurationGateway
} from "../src/interactive.js";
import {
  CONTRACT_VERSION,
  type ModelSettings,
  type OrchestratorConfig,
  type ReviewResult,
  type RunState
} from "../src/types.js";
import type { WorkflowStatus } from "../src/workflow.js";
import { cancellationResponse } from "../src/cancellation.js";
import type {
  CancelRunInput,
  CancellationAnswer,
  CancellationReceipt,
  CancellationResponseResult,
  CancellationResult
} from "../src/cancellation.js";
import {
  historicalBindingFixture,
  reviewerOnlyClaudeConfig
} from "./helpers.js";

function runState(
  status: RunState["status"],
  overrides: Partial<RunState> = {}
): RunState {
  const timestamp = "2026-07-27T12:00:00.000Z";
  return {
    schemaVersion: 3,
    contractVersion: CONTRACT_VERSION,
    runId: "run-example",
    slug: "example",
    request: "Implement the example.",
    repoRoot: "/repo/example",
    status,
    createdAt: timestamp,
    updatedAt: timestamp,
    baseCommit: "a".repeat(40),
    planArtifacts: null,
    planApproval: null,
    adrDecisions: [],
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
  state: RunState,
  overrides: Partial<WorkflowStatus> = {}
): WorkflowStatus {
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
    nextAction: null,
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

function consultationPending(): Extract<
  NonNullable<RunState["pendingHumanDecision"]>,
  { kind: "decision_consultation" }
> {
  return {
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
          question: "Where should consultation answers be stored?",
          why: "Planning continuation must survive a fresh session.",
          affectedRequirements: ["FR15", "FR27"],
          evidence: [
            {
              path: "packages/orchestrator/src/store.ts",
              line: 42,
              detail: "The atomic store owns durable run state."
            }
          ],
          decisionOwner: "human",
          responseMode: "single_choice",
          options: [
            {
              optionId: "run-state",
              title: "Persist in run state",
              benefits: ["Survives process restart"],
              costs: ["Requires a state schema revision"],
              risks: ["Legacy decoding must remain truthful"],
              consequences: ["Fresh planners receive the same answer"]
            },
            {
              optionId: "session-only",
              title: "Keep in model session",
              benefits: ["No state field"],
              costs: ["Cannot survive missing sessions"],
              risks: ["Answer provenance can be lost"],
              consequences: ["Fresh fallback cannot continue reliably"]
            }
          ],
          recommendation: {
            optionId: "run-state",
            rationale: "Durable continuation is a stated requirement."
          }
        }
      ]
    },
    requestedAt: "2026-08-31T09:00:00.000Z"
  };
}

class FakeIO implements InteractiveIO {
  width?: number;
  readonly lines: string[] = [];
  readonly choiceSets: unknown[][] = [];
  readonly choiceNames: string[][] = [];
  readonly inputMessages: string[] = [];
  readonly inputOptions: InteractiveInput[] = [];
  readonly confirmationMessages: string[] = [];
  readonly confirmationDefaults: boolean[] = [];

  constructor(
    readonly selections: unknown[],
    readonly inputs: string[] = [],
    readonly confirmations: boolean[] = []
  ) {}

  async input(options: InteractiveInput): Promise<string> {
    this.inputOptions.push(options);
    this.inputMessages.push(options.message);
    const value = this.inputs.shift();
    assert.notEqual(value, undefined, "Unexpected input prompt");
    return value ?? "";
  }

  async select<T>(
    _message: string,
    choices: readonly InteractiveChoice<T>[]
  ): Promise<T> {
    this.choiceSets.push(choices.map((choice) => choice.value));
    this.choiceNames.push(choices.map((choice) => choice.name));
    const value = this.selections.shift();
    assert.notEqual(value, undefined, "Unexpected select prompt");
    return value as T;
  }

  async multiSelect<T>(): Promise<T[]> {
    return this.selections.shift() as T[];
  }

  async confirm(message: string, defaultValue = false): Promise<boolean> {
    this.confirmationMessages.push(message);
    this.confirmationDefaults.push(defaultValue);
    const value = this.confirmations.shift();
    assert.notEqual(value, undefined, "Unexpected confirmation prompt");
    return value ?? false;
  }

  writeLine(message = ""): void {
    this.lines.push(message);
  }
}

class FakeRunner implements InteractiveRunner {
  async reworkPlan(value: unknown): Promise<RunState> {
    this.calls.push({ operation: "reworkPlan", value });
    return runState("needs_plan_approval");
  }
  async requestPlanningReview(value: unknown): Promise<RunState> {
    this.calls.push({ operation: "requestPlanningReview", value });
    return runState("needs_plan_approval");
  }
  async answerPlanningReview(value: unknown): Promise<RunState> {
    this.calls.push({ operation: "answerPlanningReview", value });
    return runState("needs_plan_approval");
  }

  async withConfigurationDecisionOwnership<T>(
    action: () => Promise<T>
  ): Promise<T> {
    return action();
  }
  async answerConfigurationPrerequisite(): Promise<RunState> {
    throw new Error("Unexpected configuration prerequisite answer");
  }

  readonly repoRoot = "/repo/example";
  readonly calls: { operation: string; value: unknown }[] = [];
  restoreEligible: { eligible: boolean; reason: string } = {
    eligible: false,
    reason: "The run has no recorded plan approval."
  };

  constructor(readonly statuses: (WorkflowStatus | null)[]) {}

  async restoreEligibility(): Promise<{ eligible: boolean; reason: string }> {
    return this.restoreEligible;
  }

  async restoreApproval(): Promise<string[]> {
    this.calls.push({ operation: "restore", value: null });
    return ["documentation/development-plans/example/plan.md"];
  }

  async status(): Promise<WorkflowStatus> {
    const status = this.statuses.shift();
    if (status === undefined) {
      throw new Error("Unexpected status request");
    }
    if (status === null) {
      throw new BanzaiError("NO_ACTIVE_RUN", "No repository-local run exists.");
    }
    return status;
  }

  async start(value: { slug: string; request: string }): Promise<RunState> {
    this.calls.push({ operation: "start", value });
    return runState("needs_plan_approval");
  }

  async resume(): Promise<RunState> {
    this.calls.push({ operation: "resume", value: null });
    return runState("needs_plan_approval");
  }

  async retry(): Promise<RunState> {
    this.calls.push({ operation: "retry", value: null });
    return runState("needs_plan_approval");
  }

  async recover(
    value: {
      attemptId: string;
      recoveryIdentity: string;
      unknownSideEffectsAccepted: true;
      decidedBy: string;
    },
    autoResume?: boolean
  ): Promise<RunState> {
    this.calls.push({ operation: "recover", value: { ...value, autoResume } });
    return runState("needs_plan_approval");
  }

  async approvePlan(approvedBy: string): Promise<RunState> {
    this.calls.push({ operation: "approvePlan", value: approvedBy });
    return runState("done");
  }

  async decideAdr(value: {
    id: string;
    decision: "accept" | "reject" | "rework";
    note: string | null;
    decidedBy: string;
    autoResume: boolean;
  }): Promise<RunState> {
    this.calls.push({ operation: "decideAdr", value });
    return runState("needs_plan_approval");
  }

  async answerHumanDecision(value: {
    answers: string[];
    decidedBy: string;
  }): Promise<RunState> {
    this.calls.push({ operation: "answerHumanDecision", value });
    return runState("needs_plan_approval");
  }

  async answerDecisionConsultation(value: {
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
  }): Promise<RunState> {
    this.calls.push({ operation: "answerDecisionConsultation", value });
    return runState("needs_plan_approval");
  }

  async triage(value: {
    accepted: string[];
    rejected: string[];
    deferred: string[];
    note: string | null;
    decidedBy: string;
  }): Promise<RunState> {
    this.calls.push({ operation: "triage", value });
    return runState("done");
  }

  async cancel(input?: CancelRunInput): Promise<CancellationResult> {
    void input;
    this.calls.push({ operation: "cancel", value: null });
    const state = runState("cancelled");
    return {
      outcome: "cancelled",
      runId: state.runId,
      state,
      stopRequest: "no_active_process",
      observation: "available",
      receipt: null
    };
  }

  async recordCancellationResponse(
    _receipt: CancellationReceipt,
    answer: CancellationAnswer
  ): Promise<CancellationResponseResult> {
    this.calls.push({ operation: "cancellation_response", value: answer });
    return {
      outcome: "saved",
      response: cancellationResponse(answer, "2026-09-06T12:00:00.000Z")
    };
  }
}

function planningTriageStatus(count = 1): WorkflowStatus {
  const pending = planningTriageRequest();
  const result = planningReviewResult(count);
  pending.findings = result.findings;
  pending.analysis = planningReviewAnalysis(result).entries;
  const state = runState("needs_human_decision", {
    schemaVersion: 10,
    pendingHumanDecision: pending
  });
  pending.runId = state.runId;
  return workflowStatus(state);
}

test("planning triage interleaves each complete finding card with its disposition in review order", async () => {
  const status = planningTriageStatus(2);
  const runner = new FakeRunner([status]);
  const io = new FakeIO(["decline", "exit"]);
  const order: string[] = [];
  const write = io.writeLine.bind(io);
  const select = io.select.bind(io);
  io.writeLine = (message) => {
    order.push(`line:${message}`);
    write(message);
  };
  io.select = async (message, choices) => {
    order.push(`menu:${message}`);
    return select(message, choices);
  };
  await runInteractive(runner, io, { decidedBy: "owner" });
  const firstCard = order.findIndex((line) => line.startsWith("line:P1-F1:"));
  const firstMenu = order.indexOf("menu:Disposition for P1-F1");
  const secondCard = order.findIndex((line) => line.startsWith("line:P1-F2:"));
  const secondMenu = order.indexOf("menu:Disposition for P1-F2");
  assert.ok(
    firstCard >= 0 &&
      firstCard < firstMenu &&
      firstMenu < secondCard &&
      secondCard < secondMenu
  );
  const first = order.slice(firstCard, firstMenu).join("\n");
  assert.match(first, /No failure case is specified/);
  assert.match(first, /Suggested resolution: Specify/);
  assert.match(first, /Assessment: agree/);
  assert.match(first, /The acceptance test becomes explicit/);
  assert.match(first, /Advisory recommendation: add-case/);
  assert.deepEqual(runner.calls, []);
});

test("planning triage escapes hostile card and choice text and keeps model Exit labels before timing controls", async () => {
  const status = planningTriageStatus();
  const pending = status.state.pendingHumanDecision;
  if (pending?.kind !== "planning_review_triage")
    throw new Error("Missing triage");
  const unsafe = "\u001b[2J\u0085\u202e";
  pending.artifactPath += unsafe;
  const finding = pending.findings[0];
  const entry = pending.analysis[0];
  assert.ok(finding && entry);
  finding.summary += unsafe;
  finding.suggestedResolution += unsafe;
  for (const evidence of finding.evidence) {
    evidence.path += unsafe;
    evidence.detail += unsafe;
  }
  entry.rationale += unsafe;
  const option = entry.options[0];
  assert.ok(option);
  option.label = "Exit with the recommended fix" + unsafe;
  option.consequences = ["Consequence" + unsafe];
  if (entry.recommendation !== null) entry.recommendation.rationale += unsafe;
  const runner = new FakeRunner([status]);
  const io = new FakeIO(["exit"]);
  await runInteractive(runner, io, {
    decidedBy: "owner" + unsafe,
    humanTime: new FakeHumanTime()
  });
  const visible = [
    ...io.lines,
    ...io.choiceNames.flat(),
    ...io.confirmationMessages
  ].join("\n");
  assert.doesNotMatch(visible, /[\u001b\u0085\u202e]/u);
  assert.match(visible, /\\u001b/);
  assert.equal(io.choiceSets[0]?.[0], "option:add-case");
  const recommended = io.choiceNames[0]?.[0];
  assert.ok(recommended);
  assert.ok(recommended.endsWith(" (recommended)"));
  assert.equal(io.choiceSets[0].at(-1), "exit");
  assert.ok(
    io.choiceSets[0]
      .slice(1, -1)
      .some((value) => String(value).includes("human_time"))
  );
  assert.deepEqual(runner.calls, []);
});

test("planning-triage declined confirmation records nothing and reappears unchanged", async () => {
  const status = planningTriageStatus();
  const before = structuredClone(status);
  const runner = new FakeRunner([status, status]);
  const io = new FakeIO(["decline", "exit"], [""], [false]);
  await runInteractive(runner, io, { decidedBy: "owner" });
  assert.equal(io.confirmationDefaults[0], false);
  assert.deepEqual(runner.calls, []);
  assert.equal(io.choiceNames.length, 2);
  assert.deepEqual(status, before);
});

test("planning gate menus preserve action order when human-time controls are present", async () => {
  for (const gate of ["plan", "adr"] as const) {
    const status = workflowStatus(
      runState(gate === "plan" ? "needs_plan_approval" : "needs_adr_approval", {
        schemaVersion: 10,
        planArtifacts: {
          description: null,
          plan: null,
          adrs: ["documentation/decisions/0001-example.md"],
          implementationReport: null,
          testReport: null
        }
      })
    );
    status.planningReview = {
      decisions:
        gate === "plan"
          ? ["approve", "rework", "review"]
          : ["accept", "reject", "rework", "review"],
      reviewPaths: ["documentation/decisions/0001-example.md"],
      active: null,
      latest: null
    };
    const io = new FakeIO(["exit"]);
    const runner = new FakeRunner([status]);
    await runInteractive(runner, io, {
      decidedBy: "owner",
      humanTime: new FakeHumanTime()
    });
    assert.deepEqual(
      io.choiceSets[0]?.slice(0, 4),
      gate === "plan"
        ? ["approve_plan", "rework_plan", "planning_review", "cancel"]
        : ["accept", "reject", "rework", "planning_review"]
    );
    assert.deepEqual(io.choiceSets[0].slice(-3), [
      "human_time_update",
      "human_time_details",
      "exit"
    ]);
    assert.deepEqual(runner.calls, []);
  }
});

test("Ctrl+C and EOF at every new planning prompt leave the pending decision unrecorded", async (t) => {
  interface PromptCase {
    name: string;
    gate: "plan" | "adr" | "triage";
    method: "select" | "input" | "multiSelect" | "confirm";
    message?: string;
    selections: unknown[];
    inputs?: string[];
  }
  const cases: PromptCase[] = [
    {
      name: "plan menu",
      gate: "plan",
      method: "select",
      message: "Plan decision",
      selections: []
    },
    {
      name: "ADR menu",
      gate: "adr",
      method: "select",
      message: "Decision for ADR-0001",
      selections: []
    },
    {
      name: "plan feedback",
      gate: "plan",
      method: "input",
      message: "Rework feedback for the planner",
      selections: ["rework_plan"]
    },
    {
      name: "ADR feedback",
      gate: "adr",
      method: "input",
      message: "Rework feedback for the planner",
      selections: ["rework"]
    },
    {
      name: "plan rework confirmation",
      gate: "plan",
      method: "confirm",
      selections: ["rework_plan"],
      inputs: ["Feedback"]
    },
    {
      name: "ADR rework confirmation",
      gate: "adr",
      method: "confirm",
      selections: ["rework"],
      inputs: ["Feedback"]
    },
    {
      name: "review scope",
      gate: "plan",
      method: "select",
      message: "Review scope",
      selections: ["planning_review"]
    },
    {
      name: "artifact selection",
      gate: "plan",
      method: "multiSelect",
      selections: ["planning_review", "choose"]
    },
    {
      name: "review confirmation",
      gate: "plan",
      method: "confirm",
      selections: ["planning_review", "whole"]
    },
    {
      name: "disposition",
      gate: "triage",
      method: "select",
      message: "Disposition for P1-F1",
      selections: []
    },
    {
      name: "own instruction",
      gate: "triage",
      method: "input",
      message: "Your instruction for P1-F1",
      selections: ["instruction"]
    },
    {
      name: "additional instruction",
      gate: "triage",
      method: "input",
      message: "Additional instruction for the planner (optional)",
      selections: ["decline"]
    },
    {
      name: "triage confirmation",
      gate: "triage",
      method: "confirm",
      selections: ["decline"],
      inputs: [""]
    }
  ];
  for (const errorName of ["ExitPromptError", "AbortPromptError"])
    for (const c of cases)
      await t.test(`${errorName}: ${c.name}`, async () => {
        const status =
          c.gate === "triage"
            ? planningTriageStatus()
            : workflowStatus(
                runState(
                  c.gate === "plan"
                    ? "needs_plan_approval"
                    : "needs_adr_approval",
                  {
                    schemaVersion: 10,
                    planArtifacts: {
                      description: "documentation/work/task/description.md",
                      plan: "documentation/work/task/plan.md",
                      adrs: ["documentation/decisions/0001-example.md"],
                      implementationReport: null,
                      testReport: null
                    }
                  }
                )
              );
        status.planningReview = {
          decisions:
            c.gate === "adr"
              ? ["accept", "reject", "rework", "review"]
              : ["approve", "rework", "review"],
          reviewPaths: ["documentation/work/task/plan.md"],
          active: null,
          latest: null
        };
        const before = structuredClone(status);
        const runner = new FakeRunner([status]);
        const io = new FakeIO([...c.selections], [...(c.inputs ?? [])]);
        let interrupted = false;
        const stop = () => {
          interrupted = true;
          const error = new Error("Synthetic prompt interruption");
          error.name = errorName;
          throw error;
        };
        const select = io.select.bind(io);
        const input = io.input.bind(io);
        io.select = async (message, choices) =>
          c.method === "select" && message === c.message
            ? stop()
            : select(message, choices);
        io.input = async (options) =>
          c.method === "input" && options.message === c.message
            ? stop()
            : input(options);
        if (c.method === "confirm") io.confirm = async () => stop();
        if (c.method === "multiSelect") io.multiSelect = async () => stop();
        await runInteractive(runner, io, { decidedBy: "owner" });
        assert.ok(interrupted, c.name);
        assert.deepEqual(runner.calls, []);
        assert.deepEqual(status, before);
      });
});

class FakeModelConfiguration implements ModelConfigurationGateway {
  readonly applied: ModelUpdate[][] = [];

  constructor(
    readonly config: OrchestratorConfig | null,
    readonly loadFailure: Error | null = null,
    readonly writeFailure: Error | null = null
  ) {}

  async load(): Promise<OrchestratorConfig | null> {
    if (this.loadFailure !== null) {
      throw this.loadFailure;
    }
    return this.config;
  }

  async applyModelUpdates(updates: readonly ModelUpdate[]): Promise<void> {
    if (this.writeFailure !== null) {
      throw this.writeFailure;
    }
    this.applied.push([...updates]);
  }
}

function configWithReviewer(model: string): OrchestratorConfig {
  const config = reviewerOnlyClaudeConfig();
  config.models.reviewer.model = model;
  return config;
}

class FakeAuthentication implements AuthenticationGateway {
  readonly checked: string[] = [];

  constructor(readonly failures: Record<string, string> = {}) {}

  async check(settings: ModelSettings): Promise<string | null> {
    this.checked.push(settings.executable);
    return this.failures[settings.executable] ?? null;
  }
}

test("startup checks every configured vendor once and reports it ready", async () => {
  const auth = new FakeAuthentication();
  const runner = new FakeRunner([null]);
  const io = new FakeIO(["exit"]);

  await runInteractive(runner, io, {
    decidedBy: "human",
    models: new FakeModelConfiguration(DEFAULT_CONFIG),
    auth
  });

  // claude runs planning and implementation; it is checked once, not twice.
  assert.deepEqual(auth.checked, ["claude", "codex"]);
  // Every phase row carries its own readiness marker, so a shared vendor is
  // reported against each role that runs it.
  assert.deepEqual(
    io.lines.filter((line) => line.startsWith("  ")),
    [
      "  plan    claude claude-opus-5-5  xhigh · 30m  ✓",
      "  impl    claude claude-opus-5-5  xhigh · 60m  ✓",
      "  review  codex  gpt-6.1-sol      xhigh · 30m  ✓"
    ]
  );
  // A ready launch spends no lines explaining authentication.
  assert.equal(
    io.lines.some((line) => line.includes("re-checks")),
    false
  );
});

test("an expired Claude session is reported at startup, before any phase runs", async () => {
  const auth = new FakeAuthentication({
    claude:
      "Claude subscription authentication is unavailable. Run `claude auth login`."
  });
  const runner = new FakeRunner([null]);
  const io = new FakeIO(["exit"]);

  await runInteractive(runner, io, {
    decidedBy: "human",
    models: new FakeModelConfiguration(reviewerOnlyClaudeConfig()),
    auth
  });

  assert.ok(
    io.lines.some(
      (line) => line === "  review  claude claude-opus-5-5  xhigh · 30m  ✗"
    )
  );
  // The reason wraps to the terminal, so assert against the joined notice.
  assert.ok(
    io.lines
      .filter((line) => line.startsWith("│ "))
      .map((line) => line.slice(2))
      .join(" ")
      .includes("Run `claude auth login`.")
  );
  assert.ok(
    io.lines.includes(
      "│ Every phase re-checks this; resolve it before starting a run."
    )
  );
  // Reporting is informational: the session continues to the normal loop.
  assert.deepEqual(io.choiceSets, [["start", "exit"]]);
});

test("Claude is checked whenever any role runs it, not only review", async () => {
  const config = reviewerOnlyClaudeConfig();
  config.models.planner.executable = "claude";
  config.models.planner.model = "claude-opus-5-5";
  config.models.implementer.executable = "claude";
  config.models.implementer.model = "claude-opus-5-5";
  const auth = new FakeAuthentication({ claude: "session expired" });
  const runner = new FakeRunner([null]);
  const io = new FakeIO(["exit"]);

  await runInteractive(runner, io, {
    decidedBy: "human",
    models: new FakeModelConfiguration(config),
    auth
  });

  assert.deepEqual(auth.checked, ["claude"]);
  // One vendor, three roles: the failure marks every row it blocks.
  assert.equal(
    io.lines.filter((line) => line.startsWith("  ") && line.endsWith("✗"))
      .length,
    3
  );
  // One notice per blocked vendor, naming every phase it blocks.
  assert.ok(
    io.lines.includes(
      "\u2502 claude (Planning, Implementation, Review): session expired"
    )
  );
  assert.equal(io.lines.filter((line) => line.includes("re-checks")).length, 1);
});

test("a thrown authentication check is reported instead of ending the session", async () => {
  const auth: AuthenticationGateway = {
    async check(): Promise<string | null> {
      throw new BanzaiError("COMMAND_NOT_FOUND", "codex is unavailable.");
    }
  };
  const runner = new FakeRunner([null]);
  const io = new FakeIO(["exit"]);

  await runInteractive(runner, io, {
    decidedBy: "human",
    models: new FakeModelConfiguration(DEFAULT_CONFIG),
    auth
  });

  assert.ok(io.lines.some((line) => line.includes("codex is unavailable.")));
  assert.deepEqual(io.choiceSets, [["start", "exit"]]);
});

test("startup skips the authentication check when no gateway is supplied", async () => {
  const runner = new FakeRunner([null]);
  const io = new FakeIO(["exit"]);

  await runInteractive(runner, io, {
    decidedBy: "human",
    models: new FakeModelConfiguration(DEFAULT_CONFIG)
  });

  // Without a gateway there is nothing to report, so no row carries a marker.
  assert.equal(
    io.lines.some(
      (line) =>
        line.startsWith("  ") && (line.endsWith("✓") || line.endsWith("✗"))
    ),
    false
  );
});

test("interactive startup shows the models for each phase", async () => {
  const runner = new FakeRunner([null]);
  const io = new FakeIO(["exit"]);

  await runInteractive(runner, io, {
    decidedBy: "human",
    models: new FakeModelConfiguration(DEFAULT_CONFIG)
  });

  assert.ok(
    io.lines.some(
      (line) =>
        line.includes("banzai") && line.includes(`v${packageManifest.version}`)
    )
  );
  assert.ok(
    io.lines.some((line) => /^ {2}plan {4}claude \S+ {2}xhigh · 30m/.test(line))
  );
  assert.ok(
    io.lines.some((line) => /^ {2}impl {4}claude .+xhigh · 60m/.test(line))
  );
  assert.ok(
    io.lines.some(
      (line) => line.includes("review") && line.includes("gpt-6.1-sol")
    )
  );
  assert.equal(
    io.lines.includes("No configured model needs a known update."),
    false
  );
  assert.deepEqual(runner.calls, []);
});

test("interactive startup offers to update a superseded model", async () => {
  const configuration = new FakeModelConfiguration(
    configWithReviewer("claude-opus-4-7")
  );
  const runner = new FakeRunner([null, null]);
  const io = new FakeIO(["update_all", "exit"], [], [true]);

  await runInteractive(runner, io, {
    decidedBy: "human",
    models: configuration
  });

  assert.deepEqual(configuration.applied, [
    [{ role: "reviewer", model: "claude-opus-5-5" }]
  ]);
  assert.ok(
    io.lines.some((line) =>
      line.includes("claude-opus-4-7 is superseded by claude-opus-5-5.")
    )
  );
  assert.ok(
    io.lines.includes(
      "Updated .banzai/config.json. Review and commit the change."
    )
  );
});

test("declining the model update leaves the configuration untouched", async () => {
  const configuration = new FakeModelConfiguration(
    configWithReviewer("claude-opus-4-7")
  );
  const runner = new FakeRunner([null, null]);
  const io = new FakeIO(["keep", "exit"]);

  await runInteractive(runner, io, {
    decidedBy: "human",
    models: configuration
  });

  assert.deepEqual(configuration.applied, []);
  assert.ok(io.lines.includes("Keeping the current model configuration."));
});

test("declining the write confirmation leaves the configuration untouched", async () => {
  const configuration = new FakeModelConfiguration(
    configWithReviewer("claude-opus-4-7")
  );
  const runner = new FakeRunner([null, null]);
  const io = new FakeIO(["update_all", "exit"], [], [false]);

  await runInteractive(runner, io, {
    decidedBy: "human",
    models: configuration
  });

  assert.deepEqual(configuration.applied, []);
  assert.ok(io.lines.includes("Keeping the current model configuration."));
});

test("per-model selection updates only the confirmed roles", async () => {
  const config = reviewerOnlyClaudeConfig();
  config.models.planner = {
    executable: "claude",
    model: "claude-opus-4-6",
    effort: "xhigh",
    timeoutMs: 30 * 60 * 1000
  };
  config.models.reviewer.model = "claude-opus-4-7";
  const configuration = new FakeModelConfiguration(config);
  const runner = new FakeRunner([null, null]);
  const io = new FakeIO(["update_some", "exit"], [], [false, true, true]);

  await runInteractive(runner, io, {
    decidedBy: "human",
    models: configuration
  });

  assert.deepEqual(configuration.applied, [
    [{ role: "reviewer", model: "claude-opus-5-5" }]
  ]);
});

test("an active run defers model updates instead of changing them mid-flight", async () => {
  const configuration = new FakeModelConfiguration(
    configWithReviewer("claude-opus-4-7")
  );
  const active = workflowStatus(runState("needs_plan_approval"));
  const runner = new FakeRunner([active, active]);
  const io = new FakeIO(["exit"]);

  await runInteractive(runner, io, {
    decidedBy: "human",
    models: configuration
  });

  assert.deepEqual(configuration.applied, []);
  assert.ok(
    io.lines.some((line) =>
      line.includes("is still needs_plan_approval. Finish or cancel it")
    )
  );
  // The only prompt shown is the plan decision from the main loop.
  assert.deepEqual(io.choiceSets, [["approve_plan", "cancel", "exit"]]);
});

test("an uninitialized project reports how to configure models", async () => {
  const runner = new FakeRunner([null]);
  const io = new FakeIO(["exit"]);

  await runInteractive(runner, io, {
    decidedBy: "human",
    models: new FakeModelConfiguration(null)
  });

  assert.ok(
    io.lines.some((line) =>
      line.includes("Run `banzai init` to configure models.")
    )
  );
});

test("an unreadable configuration reports the reason and continues", async () => {
  const runner = new FakeRunner([null]);
  const io = new FakeIO(["exit"]);

  await runInteractive(runner, io, {
    decidedBy: "human",
    models: new FakeModelConfiguration(
      null,
      new BanzaiError("INVALID_CONFIG", "config.json is not valid JSON.")
    )
  });

  assert.ok(
    io.lines.some((line) =>
      line.includes(
        "Model configuration unavailable: config.json is not valid JSON."
      )
    )
  );
  assert.deepEqual(io.choiceSets, [["start", "exit"]]);
});

test("a failed configuration write is reported without ending the session", async () => {
  const configuration = new FakeModelConfiguration(
    configWithReviewer("claude-opus-4-7"),
    null,
    new BanzaiError("INVALID_CONFIG", "config.json has no models section.")
  );
  const runner = new FakeRunner([null, null]);
  const io = new FakeIO(["update_all", "exit"], [], [true]);

  await runInteractive(runner, io, {
    decidedBy: "human",
    models: configuration
  });

  assert.ok(
    io.lines.some((line) =>
      line.includes(
        "Model configuration was not updated: config.json has no models section."
      )
    )
  );
  assert.deepEqual(io.choiceSets[1], ["start", "exit"]);
});

test("interactive mode starts a run from validated user input", async () => {
  const runner = new FakeRunner([
    null,
    workflowStatus(
      runState("needs_plan_approval", {
        planArtifacts: {
          description: "documentation/features/example/description.md",
          plan: "documentation/development-plans/example/plan.md",
          adrs: [],
          implementationReport: null,
          testReport: null
        }
      })
    ),
    workflowStatus(runState("done"))
  ]);
  const io = new FakeIO(
    ["start", "approve_plan", "exit"],
    ["Implement SC-12345."],
    [true, true]
  );

  await runInteractive(runner, io, { decidedBy: "human" });

  assert.deepEqual(runner.calls, [
    {
      operation: "start",
      value: {
        slug: "implement-sc-12345",
        request: "Implement SC-12345."
      }
    },
    { operation: "approvePlan", value: "human" }
  ]);
  assert.deepEqual(io.choiceSets[1], ["approve_plan", "cancel", "exit"]);
  assert.ok(
    io.lines.some((line) => line === "Generated slug: implement-sc-12345")
  );
  assert.equal(io.inputOptions[0]?.collapsedPaste, true);
});

test("attention counts runner time only and does not repeat on a declined confirmation", async () => {
  for (const duration of [1, 30_000]) {
    let now = 0;
    const writes: string[] = [];
    const output = Object.assign(
      new Writable({
        write(chunk, _encoding, callback) {
          writes.push(String(chunk));
          callback();
        }
      }),
      { isTTY: true }
    );
    const attention = new TerminalAttention({
      platform: "darwin",
      env: { TERM_PROGRAM: "iTerm.app" },
      interactiveTerminal: true,
      output,
      now: () => now
    });
    const waiting = workflowStatus(runState("needs_plan_approval"));
    const runner = new FakeRunner([
      null,
      waiting,
      waiting,
      workflowStatus(runState("done"))
    ]);
    const start = runner.start.bind(runner);
    runner.start = async (request) => {
      now += duration;
      return await start(request);
    };
    const io = new FakeIO(
      ["start", "approve_plan", "approve_plan", "exit"],
      ["Implement terminal attention."],
      [true, false, true]
    );
    const confirm = io.confirm.bind(io);
    io.confirm = async (message) => {
      now += 3_600_000;
      return await confirm(message);
    };
    const select = io.select.bind(io);
    let menus = 0;
    io.select = async (message, choices) => {
      assert.equal(writes.length, menus > 0 && duration >= 30_000 ? 1 : 0);
      menus += 1;
      now += 3_600_000;
      return await select(message, choices);
    };

    await runInteractive(runner, io, { decidedBy: "human", attention });

    assert.equal(menus, 4);
    assert.deepEqual(
      writes,
      duration >= 30_000 ? ["\x1b]1337;RequestAttention=once\x07"] : []
    );
    assert.deepEqual(
      runner.calls.map((call) => call.operation),
      ["start", "approvePlan"]
    );
  }
});

test("consultation continuation signals its next gate after automatic work", async () => {
  let now = 0;
  const writes: string[] = [];
  const output = Object.assign(
    new Writable({
      write(chunk, _encoding, callback) {
        writes.push(String(chunk));
        callback();
      }
    }),
    { isTTY: true }
  );
  const runner = new FakeRunner([
    workflowStatus(
      runState("needs_human_decision", {
        pendingHumanDecision: consultationPending()
      })
    ),
    workflowStatus(runState("needs_plan_approval"))
  ]);
  const answer = runner.answerDecisionConsultation.bind(runner);
  runner.answerDecisionConsultation = async (input) => {
    now += 30_000;
    return await answer(input);
  };
  const io = new FakeIO(
    [{ kind: "details" }, { kind: "option", optionId: "run-state" }, "exit"],
    [""],
    [true]
  );
  const select = io.select.bind(io);
  io.select = async (message, choices) => {
    assert.equal(writes.length, message === "Plan decision" ? 1 : 0);
    now += 60_000;
    return await select(message, choices);
  };
  await runInteractive(runner, io, {
    decidedBy: "human",
    attention: new TerminalAttention({
      platform: "darwin",
      env: { TERM_PROGRAM: "Apple_Terminal" },
      interactiveTerminal: true,
      output,
      now: () => now
    })
  });
  assert.deepEqual(writes, ["\x07"]);
  assert.equal(runner.calls[0]?.operation, "answerDecisionConsultation");
});

test("interactive status shows the persisted automatic workflow and reason", async () => {
  const runner = new FakeRunner([
    workflowStatus(
      runState("done", {
        workflowSelection: {
          contractVersion: CONTRACT_VERSION,
          recommendedWorkflow: "quick-fix",
          workflow: "quick-fix",
          confidence: "high",
          reason: "This corrects existing behavior.",
          escalationTriggers: [],
          selectedAt: "2026-07-29T12:00:00.000Z",
          attemptId: "selection-1",
          digest: "digest"
        }
      })
    )
  ]);
  const io = new FakeIO(["exit"]);

  await runInteractive(runner, io, { decidedBy: "human" });

  // The route and its reason are separated: the reason is prose and wraps.
  assert.ok(io.lines.some((line) => line.includes("quick-fix workflow")));
  assert.ok(io.lines.includes("Why this workflow"));
  assert.ok(io.lines.includes("  This corrects existing behavior."));
});

test("interactive status exposes bounded session and review policy evidence", async () => {
  const reviewFinding = {
    id: "R2-F1",
    severity: "should_fix" as const,
    category: "correctness" as const,
    summary: "The changed behavior is incomplete.",
    evidence: [
      { path: "src/example.ts", line: 10, detail: "The branch is missing." }
    ],
    violates: ["FR1"],
    reproduction: null,
    fixAcceptance: "Cover the missing branch.",
    confidence: "high" as const
  };
  const state = runState("needs_triage", {
    reviewIteration: 2,
    latestReview: {
      iteration: 2,
      resultPath: "reviews/review-2.json",
      artifactPath: "documentation/features/example/review-2.md",
      workspaceDigest: "digest",
      verdict: "changes_requested",
      sessionMode: "resumed",
      mode: "delta",
      rotationReason: null
    },
    pendingReviewRotationReason: "missing-session"
  });
  state.metrics.sessions = { fresh: 3, resumed: 2 };
  state.metrics.reviews = { full: 1, delta: 1, rotations: 0 };
  const runner = new FakeRunner([
    workflowStatus(state, {
      latestReview: {
        contractVersion: CONTRACT_VERSION,
        verdict: "changes_requested",
        summary: "One finding needs triage.",
        findings: [reviewFinding],
        reviewedFindingIds: [],
        deferredCoverage: []
      }
    })
  ]);
  const io = new FakeIO(["exit"]);

  await runInteractive(runner, io, { decidedBy: "human" });

  // The same three facts, as sentences rather than as internal tokens.
  const rendered = io.lines.join("\n").replace(/\s+/g, " ");
  assert.ok(io.lines.includes("Review 2  changes requested"));
  assert.ok(
    rendered.includes(
      "Reviewed only what changed since the last review continuing the reviewer's session."
    )
  );
  assert.ok(
    rendered.includes(
      "The next review starts over from a clean session, because the previous reviewer session was no longer available."
    )
  );
  // Session and review counters are operator telemetry, not launch reading.
  assert.equal(
    io.lines.some((line) => line.startsWith("Sessions:")),
    false
  );
  assert.equal(
    io.lines.some((line) => line.startsWith("Reviews:")),
    false
  );
  // The finding itself is listed, not just counted, and its severity reads as
  // a phrase rather than as the persisted token.
  assert.ok(
    io.lines.some((line) =>
      line.includes("R2-F1  should fix  The changed behavior is incomplete.")
    )
  );
  assert.equal(
    io.lines.some((line) => line.includes("should_fix")),
    false
  );
  assert.ok(io.lines.some((line) => line.includes("src/example.ts:10")));
});

test("interactive status distinguishes human-triaged completion from review pass", async () => {
  const finding = {
    id: "R1-F1",
    severity: "should_fix" as const,
    category: "correctness" as const,
    summary: "A suggestion was raised.",
    evidence: [{ path: "src/example.ts", line: 10, detail: "Observed here." }],
    violates: ["FR1"],
    reproduction: null,
    fixAcceptance: "Change the behavior.",
    confidence: "high" as const
  };
  const triage = {
    reviewIteration: 1,
    decidedAt: "2026-07-27T12:05:00.000Z",
    decidedBy: "human",
    items: [
      {
        findingId: "R1-F1",
        disposition: "rejected" as const,
        note: "Not accepted."
      }
    ]
  };
  const state = runState("done", {
    reviewIteration: 1,
    latestReview: {
      iteration: 1,
      resultPath: "reviews/review-1.json",
      artifactPath: "documentation/features/example/review-1.md",
      workspaceDigest: "digest",
      verdict: "changes_requested",
      sessionMode: "fresh",
      mode: "full",
      rotationReason: "primary-review"
    },
    triage,
    triageHistory: [triage]
  });
  const runner = new FakeRunner([
    workflowStatus(state, {
      latestReview: {
        contractVersion: CONTRACT_VERSION,
        verdict: "changes_requested",
        summary: "One finding was triaged.",
        findings: [finding],
        reviewedFindingIds: [],
        deferredCoverage: []
      }
    })
  ]);
  const io = new FakeIO(["exit"]);

  await runInteractive(runner, io, { decidedBy: "human" });

  assert.ok(io.lines.includes("Review 1  changes requested"));
  // Human triage closed the run, so it must not read as a reviewer pass.
  assert.ok(
    io.lines.includes(
      "  Completion: human triage (accepted=0, rejected=1, deferred=0)"
    )
  );
  assert.equal(io.lines.includes("Review: pass (iteration 1)"), false);
});

test("interactive slugs are normalized, bounded, and deterministic", () => {
  assert.equal(
    generateFeatureSlug("  Café: Add SSO / MFA!  "),
    "cafe-add-sso-mfa"
  );
  const longPrefix = "word ".repeat(30);
  const longSlug = generateFeatureSlug(`${longPrefix}alpha`);
  assert.equal(longSlug.length <= 64, true);
  assert.notEqual(longSlug, generateFeatureSlug(`${longPrefix}beta`));
  const fallback = generateFeatureSlug("Реалізувати нову можливість");
  assert.match(fallback, /^feature-[a-f0-9]{8}$/);
  assert.equal(fallback, generateFeatureSlug("Реалізувати нову можливість"));
});

test("interactive mode approves a visible plan and continues", async () => {
  const state = runState("needs_plan_approval", {
    planArtifacts: {
      description: "documentation/features/example/description.md",
      plan: "documentation/development-plans/example/plan.md",
      adrs: [],
      implementationReport: null,
      testReport: null
    }
  });
  const runner = new FakeRunner([
    workflowStatus(state, { planApprovalValid: null }),
    workflowStatus(runState("done"))
  ]);
  const io = new FakeIO(["approve_plan", "exit"], [], [true]);

  await runInteractive(runner, io, { decidedBy: "human" });

  assert.deepEqual(runner.calls, [
    { operation: "approvePlan", value: "human" }
  ]);
  assert.ok(
    io.lines.some((line) =>
      line.includes("documentation/development-plans/example/plan.md")
    )
  );
});

test("interactive mode records an ADR decision using the artifact id", async () => {
  const runner = new FakeRunner([
    workflowStatus(
      runState("needs_adr_approval", {
        blockReason: null,
        planArtifacts: {
          description: "documentation/features/example/description.md",
          plan: null,
          adrs: ["documentation/decisions/0001-example.md"],
          implementationReport: null,
          testReport: null
        }
      })
    ),
    workflowStatus(runState("planning"))
  ]);
  const io = new FakeIO(["accept", "exit"], ["Approved after review."], [true]);

  await runInteractive(runner, io, { decidedBy: "human" });

  assert.deepEqual(runner.calls, [
    {
      operation: "decideAdr",
      value: {
        id: "ADR-0001",
        decision: "accept",
        note: "Approved after review.",
        decidedBy: "human",
        autoResume: true
      }
    }
  ]);
});

test("interactive mode answers an implementation escalation and replans", async () => {
  const runner = new FakeRunner([
    workflowStatus(
      runState("needs_human_decision", {
        pendingHumanDecision: {
          kind: "escalation",
          phase: "implementation",
          gate: "escalation",
          summary: "The implementation needs a product decision.",
          questions: ["Should the new behavior remain backward compatible?"],
          requestedAt: "2026-07-27T12:00:00.000Z"
        }
      })
    ),
    workflowStatus(runState("needs_plan_approval"))
  ]);
  const io = new FakeIO(
    ["answer_human", "exit"],
    ["Yes, preserve backward compatibility."],
    [true]
  );

  await runInteractive(runner, io, { decidedBy: "human" });

  assert.deepEqual(runner.calls, [
    {
      operation: "answerHumanDecision",
      value: {
        answers: ["Yes, preserve backward compatibility."],
        decidedBy: "human"
      }
    }
  ]);
  assert.ok(
    io.lines.some((line) =>
      line.includes("The implementation needs a product decision.")
    )
  );
  assert.equal(io.choiceNames[0]?.[0], "Answer and return to planning");
  assert.equal(
    io.confirmationMessages[0],
    "Record these answers, invalidate the old plan approval, and replan?"
  );
});

test("interactive mode describes lite escalation as workflow reselection", async () => {
  const runner = new FakeRunner([
    workflowStatus(
      runState("needs_human_decision", {
        workflowSelection: {
          contractVersion: CONTRACT_VERSION,
          recommendedWorkflow: "quick-fix",
          workflow: "quick-fix",
          confidence: "high",
          reason: "This initially appeared to be a local fix.",
          escalationTriggers: [],
          selectedAt: "2026-07-29T12:00:00.000Z",
          attemptId: "selection-1",
          digest: "workflow-digest"
        },
        pendingHumanDecision: {
          kind: "escalation",
          phase: "implementation",
          gate: "escalation",
          summary: "The fix discovered a public contract.",
          questions: [],
          requestedAt: "2026-07-29T12:01:00.000Z"
        }
      })
    ),
    workflowStatus(runState("needs_plan_approval"))
  ]);
  const io = new FakeIO(
    ["answer_human", "exit"],
    ["Use strict workflow selection."],
    [true]
  );

  await runInteractive(runner, io, { decidedBy: "human" });

  assert.equal(io.choiceNames[0]?.[0], "Answer and reselect the workflow");
  assert.equal(
    io.inputMessages[0],
    "What decision should workflow reselection apply?"
  );
  assert.equal(
    io.confirmationMessages[0],
    "Record these answers, invalidate the lite workflow authorization, and select again?"
  );
  assert.deepEqual(runner.calls, [
    {
      operation: "answerHumanDecision",
      value: {
        answers: ["Use strict workflow selection."],
        decidedBy: "human"
      }
    }
  ]);
});

test("interactive consultation renders bounded cards, inspects detail, and submits one keyed round", async () => {
  const runner = new FakeRunner([
    workflowStatus(
      runState("needs_human_decision", {
        pendingHumanDecision: consultationPending()
      })
    ),
    workflowStatus(runState("needs_plan_approval"))
  ]);
  const io = new FakeIO(
    [{ kind: "details" }, { kind: "option", optionId: "run-state" }, "exit"],
    ["Chosen after inspecting the compatibility risk."],
    [true]
  );

  await runInteractive(runner, io, { decidedBy: "human" });

  assert.deepEqual(io.choiceNames[0], [
    "Use recommendation",
    "Choose Persist in run state",
    "Choose Keep in model session",
    "Explain another preference",
    "Inspect details",
    "Pause and decide later"
  ]);
  for (const label of [
    "Decision:",
    "Why this matters:",
    "Repository evidence:",
    "Options:",
    "Recommendation:"
  ]) {
    assert.ok(
      io.lines.some((line) => line.startsWith(label)),
      label
    );
  }
  assert.ok(
    io.lines.some((line) =>
      line.includes("Legacy decoding must remain truthful")
    )
  );
  assert.equal(io.inputOptions[0]?.collapsedPaste, true);
  assert.equal(
    io.confirmationMessages[0],
    "Submit all consultation answers and return to planning?"
  );
  assert.deepEqual(runner.calls, [
    {
      operation: "answerDecisionConsultation",
      value: {
        runId: "run-example",
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
            note: "Chosen after inspecting the compatibility risk."
          }
        ],
        decidedBy: "human"
      }
    }
  ]);
});

test("interactive consultation preserves an exact multiline preference as inert data", async () => {
  const pending = consultationPending();
  const firstDecision = pending.request.decisions[0];
  assert.ok(firstDecision);
  pending.request.decisions[0] = {
    ...firstDecision,
    responseMode: "free_text",
    options: [],
    recommendation: null
  };
  const preference = "Prefer a compatibility adapter.\nKeep `$(false)` | café.";
  const runner = new FakeRunner([
    workflowStatus(
      runState("needs_human_decision", { pendingHumanDecision: pending })
    ),
    workflowStatus(runState("needs_plan_approval"))
  ]);
  const io = new FakeIO([{ kind: "preference" }, "exit"], [preference], [true]);

  await runInteractive(runner, io, { decidedBy: "human" });

  assert.deepEqual(runner.calls[0], {
    operation: "answerDecisionConsultation",
    value: {
      runId: "run-example",
      requestId: "request-1",
      roundId: "round-1",
      answers: [
        {
          decisionId: "decision-store",
          response: {
            kind: "preference",
            optionId: null,
            text: preference
          },
          note: null
        }
      ],
      decidedBy: "human"
    }
  });
});

test("interactive consultation pause and declined final confirmation do not mutate", async (t) => {
  await t.test("pause", async () => {
    const runner = new FakeRunner([
      workflowStatus(
        runState("needs_human_decision", {
          pendingHumanDecision: consultationPending()
        })
      )
    ]);
    const io = new FakeIO([{ kind: "pause" }]);

    await runInteractive(runner, io, { decidedBy: "human" });

    assert.deepEqual(runner.calls, []);
  });

  await t.test("decline", async () => {
    const runner = new FakeRunner([
      workflowStatus(
        runState("needs_human_decision", {
          pendingHumanDecision: consultationPending()
        })
      )
    ]);
    const io = new FakeIO(
      [{ kind: "option", optionId: "session-only" }],
      [""],
      [false]
    );

    await runInteractive(runner, io, { decidedBy: "human" });

    assert.deepEqual(runner.calls, []);
  });
});

test("interactive mode triages every finding before applying the decision", async () => {
  const review: ReviewResult = {
    contractVersion: CONTRACT_VERSION,
    verdict: "changes_requested",
    summary: "Two findings need triage.",
    findings: [
      {
        id: "R1-F1",
        severity: "should_fix",
        category: "correctness",
        summary: "Fix the branch.",
        evidence: [{ path: "src/a.ts", line: 4, detail: "Wrong branch." }],
        violates: ["FR1"],
        reproduction: "Run the focused test.",
        fixAcceptance: "The branch is corrected.",
        confidence: "high"
      },
      {
        id: "R1-F2",
        severity: "nit",
        category: "documentation",
        summary: "Improve the comment.",
        evidence: [{ path: "src/b.ts", line: 8, detail: "Stale wording." }],
        violates: [],
        reproduction: null,
        fixAcceptance: "The comment is current.",
        confidence: "medium"
      }
    ],
    reviewedFindingIds: [],
    deferredCoverage: []
  };
  const runner = new FakeRunner([
    workflowStatus(
      runState("needs_triage", {
        reviewIteration: 1,
        latestReview: {
          iteration: 1,
          resultPath: "reviews/review-1.json",
          artifactPath: "documentation/features/example/review-1.md",
          workspaceDigest: "workspace-digest",
          verdict: "changes_requested",
          sessionMode: "fresh",
          mode: "full",
          rotationReason: "primary-review"
        }
      }),
      { latestReview: review }
    ),
    workflowStatus(runState("done"))
  ]);
  const io = new FakeIO(["accepted", "rejected", "exit"], [""], [true]);

  await runInteractive(runner, io, { decidedBy: "human" });

  assert.deepEqual(runner.calls, [
    {
      operation: "triage",
      value: {
        accepted: ["R1-F1"],
        rejected: ["R1-F2"],
        deferred: [],
        note: null,
        decidedBy: "human"
      }
    }
  ]);
  assert.ok(
    io.lines.includes("  → documentation/features/example/review-1.md")
  );
  // Each finding carries its own identity into the disposition prompt: by the
  // second one the summary list has scrolled away, and the prompt names only
  // the id.
  assert.ok(
    io.lines.some(
      (line) =>
        line.startsWith("── R1-F1 should fix ") && line.endsWith(" 1 of 2 ──")
    ),
    io.lines.join("\n")
  );
  assert.ok(
    io.lines.some(
      (line) => line.startsWith("── R1-F2 nit ") && line.endsWith(" 2 of 2 ──")
    ),
    io.lines.join("\n")
  );
  assert.ok(io.lines.includes("  Fix the branch."));
  // The locator owns its line so the implicated file set stays scannable and
  // stays copyable, with the detail wrapped beneath it.
  assert.ok(io.lines.includes("  src/a.ts:4"));
  assert.ok(io.lines.includes("    Wrong branch."));
  assert.ok(io.lines.includes("  Resolved by"));
  assert.ok(io.lines.includes("    The branch is corrected."));
});

test("interactive mode offers retry only when status marks it eligible", async () => {
  const runner = new FakeRunner([
    workflowStatus(
      runState("blocked", {
        blockedFrom: "planning",
        blockReason: "Codex authentication is unavailable."
      }),
      {
        retry: {
          eligible: true,
          reason: "Failed plan attempt can be retried.",
          attemptId: "plan-1-abcd1234"
        },
        nextAction: "banzai retry"
      }
    ),
    workflowStatus(runState("done"))
  ]);
  const io = new FakeIO(["retry", "exit"], [], [true]);

  await runInteractive(runner, io, { decidedBy: "human" });

  assert.deepEqual(runner.calls, [{ operation: "retry", value: null }]);
  assert.ok(
    io.lines.some((line) =>
      line.includes("Codex authentication is unavailable.")
    )
  );
});

test("interactive mode names completion-evidence repair instead of a read-only retry", async () => {
  const attemptId = "implementation-1-abcd1234";
  const runner = new FakeRunner([
    workflowStatus(
      runState("blocked", {
        blockedFrom: "implementing",
        blockReason:
          "[PLAN_TASK_COMPLETION_INVALID] Implementation report projection contradicts the structured completion ledger.",
        activeAttempt: {
          id: attemptId,
          kind: "implementation",
          mutable: true
        },
        planTaskCompletion: {
          schemaVersion: 1,
          status: "invalid",
          sourceAttemptId: attemptId,
          errorCode: "PLAN_TASK_COMPLETION_INVALID",
          violation: "report_projection_mismatch",
          taskId: null,
          recordedAt: "2026-08-18T12:24:21.173Z"
        }
      }),
      {
        retry: {
          eligible: true,
          reason: `Completion evidence for implementation attempt ${attemptId} can be repaired with a new attempt.`,
          attemptId
        },
        nextAction: "banzai retry"
      }
    ),
    workflowStatus(runState("done"))
  ]);
  const io = new FakeIO(["retry", "exit"], [], [true]);

  await runInteractive(runner, io, { decidedBy: "human" });

  assert.deepEqual(runner.calls, [{ operation: "retry", value: null }]);
  assert.equal(io.choiceNames[0]?.[0], "Repair plan-task completion evidence");
  assert.equal(
    io.confirmationMessages[0],
    "Repair plan-task completion evidence in a fresh attempt?"
  );
});

test("interactive mode offers completion repair after a post-fix projection rejection", async () => {
  const attemptId = "implementation-1-96de4a81";
  const runner = new FakeRunner([
    workflowStatus(
      runState("blocked", {
        blockedFrom: "verifying",
        blockReason:
          "[PLAN_TASK_COMPLETION_INVALID] Implementation report projection contradicts the structured completion ledger.",
        activeAttempt: null,
        planTaskCompletion: {
          schemaVersion: 1,
          status: "invalid",
          sourceAttemptId: attemptId,
          errorCode: "PLAN_TASK_COMPLETION_INVALID",
          violation: "report_projection_mismatch",
          taskId: null,
          recordedAt: "2026-08-20T17:45:21.241Z"
        }
      }),
      {
        retry: {
          eligible: true,
          reason:
            "Completion evidence rejected at revalidation can be repaired with a new implementation attempt.",
          attemptId
        },
        nextAction: "banzai retry"
      }
    ),
    workflowStatus(runState("done"))
  ]);
  const io = new FakeIO(["retry", "exit"], [], [true]);

  await runInteractive(runner, io, { decidedBy: "human" });

  assert.deepEqual(runner.calls, [{ operation: "retry", value: null }]);
  assert.equal(io.choiceNames[0]?.[0], "Repair plan-task completion evidence");
  assert.equal(
    io.confirmationMessages[0],
    "Repair plan-task completion evidence in a fresh attempt?"
  );
});

test("interactive mode offers approval restore when the snapshot diverges", async () => {
  const runner = new FakeRunner([
    workflowStatus(
      runState("blocked", {
        blockedFrom: "fixing",
        blockReason:
          "Approved planning artifacts changed. Restore the approved bundle (banzai restore) and retry, or cancel the run and approve a revised plan in a new run.",
        activeAttempt: null
      }),
      {
        retry: {
          eligible: true,
          reason:
            "Fix checks can be retried after resolving the reported prerequisite.",
          attemptId: null
        },
        nextAction: "banzai retry"
      }
    ),
    workflowStatus(runState("done"))
  ]);
  runner.restoreEligible = {
    eligible: true,
    reason:
      "The approved planning artifacts diverged from the recorded approval and can be restored from the snapshot."
  };
  const io = new FakeIO(["restore", "exit"], [], [true]);

  await runInteractive(runner, io, { decidedBy: "human" });

  assert.deepEqual(runner.calls, [{ operation: "restore", value: null }]);
  assert.ok(
    io.choiceNames[0]?.includes("Restore the approved planning artifacts")
  );
  assert.equal(
    io.confirmationMessages[0],
    "Rewrite the approved artifact paths with the exact approved bytes?"
  );
});

test("interactive mode retries persisted start checks", async () => {
  const runner = new FakeRunner([
    workflowStatus(
      runState("blocked", {
        blockedFrom: "created",
        blockReason:
          "[DIRTY_REPOSITORY] The repository must be clean before a run starts."
      }),
      {
        retry: {
          eligible: true,
          reason:
            "Startup checks can be retried after the repository is clean.",
          attemptId: null
        },
        nextAction: "banzai retry"
      }
    ),
    workflowStatus(runState("needs_plan_approval"))
  ]);
  const io = new FakeIO(["retry", "exit"], [], [true]);

  await runInteractive(runner, io, { decidedBy: "human" });

  assert.deepEqual(runner.calls, [{ operation: "retry", value: null }]);
  assert.equal(io.choiceNames[0]?.[0], "Retry start checks");
});

test("interactive mode retries review checks that failed before Claude started", async () => {
  const runner = new FakeRunner([
    workflowStatus(
      runState("blocked", {
        blockedFrom: "reviewing",
        blockReason: "Claude subscription authentication is unavailable."
      }),
      {
        retry: {
          eligible: true,
          reason:
            "Review checks can be retried after resolving the reported prerequisite.",
          attemptId: null
        },
        nextAction: "banzai retry"
      }
    ),
    workflowStatus(runState("done"))
  ]);
  const io = new FakeIO(["retry", "exit"], [], [true]);

  await runInteractive(runner, io, { decidedBy: "human" });

  assert.deepEqual(runner.calls, [{ operation: "retry", value: null }]);
  assert.equal(io.choiceNames[0]?.[0], "Retry review checks");
});

test("interactive mode hides retry when blocked status marks it unavailable", async () => {
  const runner = new FakeRunner([
    workflowStatus(
      runState("blocked", {
        blockedFrom: "implementing",
        blockReason: "A mutable attempt requires inspection."
      }),
      {
        retry: {
          eligible: false,
          reason: "Mutable attempts cannot be retried.",
          attemptId: "implementation-1-abcd1234"
        },
        nextAction: "banzai cancel"
      }
    )
  ]);
  const io = new FakeIO(["exit"]);

  await runInteractive(runner, io, { decidedBy: "human" });

  assert.deepEqual(io.choiceSets[0], ["cancel", "exit"]);
  assert.deepEqual(runner.calls, []);
});

test("interactive recovery requires a negative-default explicit side-effect acknowledgement", async () => {
  const recoveryIdentity = "a".repeat(64);
  const blocked = workflowStatus(
    runState("blocked", {
      blockedFrom: "fixing",
      blockReason: "Fix attempt was interrupted after changing the checkout."
    }),
    {
      retry: {
        eligible: false,
        reason: "Mutable attempts cannot be retried.",
        attemptId: "fix-4-9884535f"
      },
      recovery: {
        eligible: true,
        reason: "The exact interrupted fix workspace can be recovered.",
        warning:
          "Repository or external side effects may be partial or duplicated.",
        sourceKind: "interrupted",
        attemptId: "fix-4-9884535f",
        phase: "fix",
        resolvedFindingIds: [],
        remainingFindingIds: [],
        prerequisites: [],
        authorization: "plan_approval",
        recoveryIdentity,
        workspace: {
          digest: "forbidden-workspace-digest",
          added: 1,
          modified: 2,
          deleted: 0,
          total: 3
        },
        baseCommit: "b".repeat(40),
        approvalDigest: "c".repeat(64),
        workflowDigest: "d".repeat(64),
        scopeDigest: "e".repeat(64),
        configurationDigest: "f".repeat(64)
      },
      nextAction: "banzai recover"
    }
  );
  const runner = new FakeRunner([blocked, workflowStatus(runState("done"))]);
  const io = new FakeIO(["recover", "exit"], [], [true]);

  await runInteractive(runner, io, { decidedBy: "human" });

  assert.deepEqual(runner.calls, [
    {
      operation: "recover",
      value: {
        attemptId: "fix-4-9884535f",
        recoveryIdentity,
        unknownSideEffectsAccepted: true,
        decidedBy: "human",
        autoResume: true
      }
    }
  ]);
  assert.equal(io.choiceSets[0]?.[0], "recover");
  assert.ok(io.lines.some((line) => line.includes("Recovery identity")));
  assert.ok(
    io.confirmationMessages[0]?.includes("partial or duplicated") ?? false
  );

  const declined = new FakeRunner([blocked, workflowStatus(runState("done"))]);
  await runInteractive(declined, new FakeIO(["recover", "exit"], [], [false]), {
    decidedBy: "human"
  });
  assert.deepEqual(declined.calls, []);
});

test("interactive prerequisite recovery shows remaining scope and requires prerequisite confirmation", async () => {
  const recoveryIdentity = "b".repeat(64);
  const blocked = workflowStatus(
    runState("blocked", {
      blockedFrom: "fixing",
      blockReason: "Migration evidence requires operator commands."
    }),
    {
      retry: {
        eligible: false,
        reason: "This completed blocked result is not retryable.",
        attemptId: null
      },
      recovery: {
        eligible: true,
        reason:
          "Completed blocked fix may recover R1-F3 after 2 operator prerequisites.",
        warning:
          "The source remains completed and blocked while one linked fix addresses the remaining scope.",
        sourceKind: "prerequisite_blocked_fix",
        attemptId: "fix-2-fff81cb4",
        phase: "fix",
        resolvedFindingIds: ["R1-F2", "R1-F5", "R1-F6"],
        remainingFindingIds: ["R1-F3"],
        prerequisites: [
          "Run the migration round trip.",
          "Verify the generated schema catalog."
        ],
        authorization: "plan_approval",
        recoveryIdentity,
        workspace: {
          digest: "forbidden-workspace-digest",
          added: 0,
          modified: 3,
          deleted: 1,
          total: 4
        },
        baseCommit: "b".repeat(40),
        approvalDigest: "c".repeat(64),
        workflowDigest: null,
        scopeDigest: "e".repeat(64),
        configurationDigest: "f".repeat(64)
      },
      nextAction: "banzai recover"
    }
  );
  const runner = new FakeRunner([blocked, workflowStatus(runState("done"))]);
  const io = new FakeIO(["recover", "exit"], [], [true]);

  await runInteractive(runner, io, { decidedBy: "human" });

  assert.equal(
    io.choiceNames[0]?.[0],
    "Recover the remaining accepted findings"
  );
  assert.ok(io.lines.some((line) => line.includes("R1-F2, R1-F5, R1-F6")));
  assert.ok(io.lines.some((line) => line.includes("R1-F3")));
  assert.ok(
    io.lines.some((line) => line.includes("Run the migration round trip."))
  );
  assert.ok(
    io.confirmationMessages[0]?.includes("displayed prerequisites") ?? false
  );
  assert.deepEqual(runner.calls, [
    {
      operation: "recover",
      value: {
        attemptId: "fix-2-fff81cb4",
        recoveryIdentity,
        unknownSideEffectsAccepted: true,
        decidedBy: "human",
        autoResume: true
      }
    }
  ]);
});

test("interactive blocked checkpoint offers resume instead of recovery or cancel", async () => {
  const blocked = workflowStatus(
    runState("blocked", {
      blockedFrom: "implementing",
      blockReason: "Parent process was interrupted after terminal success."
    }),
    {
      recovery: {
        ...workflowStatus(runState("blocked")).recovery,
        terminalCheckpointPresent: true,
        reason: "A durable terminal checkpoint can be reconciled.",
        attemptId: "implementation-1-checkpoint",
        phase: "implementation"
      },
      nextAction: "banzai resume"
    }
  );
  const runner = new FakeRunner([blocked, workflowStatus(runState("done"))]);
  const io = new FakeIO(["resume", "exit"], [], [true]);

  await runInteractive(runner, io, { decidedBy: "human" });

  assert.deepEqual(io.choiceSets[0], ["resume", "cancel", "exit"]);
  assert.equal(io.choiceNames[0]?.[0], "Resume the proven terminal result");
  assert.deepEqual(runner.calls, [{ operation: "resume", value: null }]);
});

test("interactive rejected checkpoint prioritizes completion-evidence repair", async () => {
  const attemptId = "implementation-1-rejected-checkpoint";
  const blocked = workflowStatus(
    runState("blocked", {
      blockedFrom: "implementing",
      blockReason:
        "[INVALID_TERMINAL_CHECKPOINT] T001 references evidence outside the authorized changed surface.",
      activeAttempt: {
        id: attemptId,
        kind: "implementation",
        mutable: true
      },
      planTaskCompletion: {
        schemaVersion: 1,
        status: "invalid",
        sourceAttemptId: attemptId,
        errorCode: "PLAN_TASK_COMPLETION_INVALID",
        violation: "evidence_scope_violation",
        taskId: "T001",
        recordedAt: "2026-08-19T08:09:46.724Z"
      }
    }),
    {
      retry: {
        eligible: true,
        reason: `Completion evidence for implementation attempt ${attemptId} can be repaired with a new attempt.`,
        attemptId
      },
      recovery: {
        ...workflowStatus(runState("blocked")).recovery,
        terminalCheckpointPresent: true,
        reason:
          "The terminal checkpoint result was rejected by completion validation."
      },
      nextAction: "banzai retry"
    }
  );
  const runner = new FakeRunner([blocked, workflowStatus(runState("done"))]);
  const io = new FakeIO(["retry", "exit"], [], [true]);

  await runInteractive(runner, io, { decidedBy: "human" });

  assert.equal(io.choiceNames[0]?.[0], "Repair plan-task completion evidence");
  assert.equal(io.choiceSets[0]?.includes("resume"), false);
  assert.deepEqual(runner.calls, [{ operation: "retry", value: null }]);
});

test("interactive home shows historical runs read-only and offers only cancellation", async () => {
  const historical = (status: RunState["status"]) =>
    runState(status, {
      schemaVersion: 8,
      artifactBinding: historicalBindingFixture({
        workId: "11111111-1111-4111-8111-111111111111",
        slug: "example",
        createdAt: "2026-07-27T12:00:00.000Z",
        sourceCommit: null
      })
    });
  const runner = new FakeRunner([
    workflowStatus(historical("needs_plan_approval"), {
      nextAction: "banzai cancel"
    }),
    workflowStatus(historical("cancelled"))
  ]);
  const io = new FakeIO(["cancel", "exit"], [], [true]);

  await runInteractive(runner, io, { decidedBy: "human" });

  assert.deepEqual(io.choiceSets, [
    ["cancel", "exit"],
    ["start", "exit"]
  ]);
  assert.deepEqual(runner.calls, [{ operation: "cancel", value: null }]);
  const text = io.lines.join(" ").replace(/\s+/g, " ");
  assert.match(text, /earlier Banzai version and cannot resume/);
  assert.match(text, /earlier Banzai version and is read-only/);
});

test("declining cancellation leaves the active run unchanged", async () => {
  const state = runState("needs_plan_approval", {
    planArtifacts: {
      description: "documentation/features/example/description.md",
      plan: "documentation/development-plans/example/plan.md",
      adrs: [],
      implementationReport: null,
      testReport: null
    }
  });
  const runner = new FakeRunner([workflowStatus(state), workflowStatus(state)]);
  const io = new FakeIO(["cancel", "exit"], [], [false]);

  await runInteractive(runner, io, { decidedBy: "human" });

  assert.deepEqual(runner.calls, []);
});

test("closing a prompt exits without invoking a runner operation", async () => {
  const runner = new FakeRunner([null]);
  const io = new FakeIO([]);
  io.select = async () => {
    const error = new Error("User force closed the prompt");
    error.name = "ExitPromptError";
    throw error;
  };

  await runInteractive(runner, io, { decidedBy: "human" });

  assert.deepEqual(runner.calls, []);
  assert.ok(
    io.lines.some((line) => line.includes("Run state was not changed"))
  );
});

class FakeHumanTime implements HumanTimeGateway {
  readonly edits: { runId: string; revision: number; minutes: number }[] = [];
  detached = 0;
  attached = 0;
  result: HumanTimeWriteResult = { status: "saved", revision: 1 };
  summary: HumanTimeSummary = deriveHumanTime(
    { status: "absent", issue: "MISSING_EVIDENCE" },
    emptyHumanTimeEvidence(),
    "2026-09-06T10:00:00.000Z"
  );
  async attach(): Promise<void> {
    this.attached++;
  }
  async detach(): Promise<void> {
    this.detached++;
  }
  async readSummary(): Promise<HumanTimeSummary> {
    return this.summary;
  }
  async setEstimate(
    runId: string,
    revision: number,
    minutes: number
  ): Promise<HumanTimeWriteResult> {
    this.edits.push({ runId, revision, minutes });
    if (this.result.status === "saved") {
      this.summary = {
        ...this.summary,
        revision: this.result.revision,
        inventory: "partial",
        issues:
          this.summary.inventory === "unavailable" ? [] : this.summary.issues,
        effort: {
          id: "00000000-0000-4000-8000-000000000001",
          replaces: null,
          minutes,
          recordedAt: "2026-09-06T10:00:00.000Z",
          asOf: "2026-09-06T10:00:00.000Z",
          basis: "estimated",
          scope: "single_engineer_unverified"
        }
      };
    }
    return this.result;
  }
}

function recordedTimeSummary(): HumanTimeSummary {
  const ledger = emptyHumanTime("run-example");
  const anchor = {
    type: "triage",
    attemptId: "review-1",
    reviewIteration: 1
  } as const;
  ledger.observations = [
    humanTimeObservation(
      "run-example",
      anchor,
      "opened",
      "2026-09-06T10:00:00.000Z",
      { kind: "event", type: "review.completed", ordinal: 1 }
    ),
    humanTimeObservation(
      "run-example",
      anchor,
      "answered",
      "2026-09-06T10:00:24.000Z",
      { kind: "event", type: "review.triaged", ordinal: 2 }
    )
  ];
  for (const observation of ledger.observations)
    observation.clock.continuity = "process_correlated";
  const evidence = emptyHumanTimeEvidence();
  evidence.observations = ledger.observations;
  return deriveHumanTime(
    { status: "valid", ledger, issues: [] },
    evidence,
    "2026-09-06T10:01:00.000Z"
  );
}

async function timeView(
  summary: HumanTimeSummary,
  details = false,
  width = 96
) {
  const time = new FakeHumanTime();
  time.summary = summary;
  const io = new FakeIO(details ? ["human_time_details", "exit"] : ["exit"]);
  io.width = width;
  const runner = new FakeRunner([workflowStatus(runState("done"))]);
  await runInteractive(runner, io, { decidedBy: "human", humanTime: time });
  assert.deepEqual(runner.calls, []);
  assert.deepEqual(time.edits, []);
  return io;
}

test("human time: compact summary distinguishes absent, saved and explicit zero estimates", async () => {
  const absent = await timeView(new FakeHumanTime().summary);
  const text = absent.lines.join("\n");
  assert.match(text, /Time for this run/);
  assert.match(text, /Active time estimate\s+Not added · optional/);
  assert.ok(
    text.indexOf("Active time estimate") < text.indexOf("Waiting for decisions")
  );
  assert.match(
    text,
    /Decision waits include time away; they do not measure active work\./
  );
  assert.doesNotMatch(
    text,
    /Human time —|Timing issues|MISSING_EVIDENCE|0 open|identity not verified/
  );
  const actions = absent.choiceNames[0];
  assert.ok(actions);
  assert.equal(actions.at(-3), "Add active time estimate (optional)");
  assert.equal(actions.at(-2), "View time details");
  for (const minutes of [12, 0]) {
    const time = new FakeHumanTime();
    await time.setEstimate("run-example", 0, minutes);
    const io = await timeView(time.summary);
    assert.match(
      io.lines.join("\n"),
      new RegExp(
        `Active time estimate\\s+${minutes} min · Self-reported · one person`
      )
    );
    assert.doesNotMatch(io.lines.join("\n"), /as of|2026-09-06T10:00:00/);
    assert.equal(io.choiceNames[0]?.at(-3), "Edit active time estimate");
  }
});

test("human time: unavailable and conflicting evidence is never presented as an empty estimate", async () => {
  for (const code of [
    "INVALID_EVIDENCE",
    "UNSUPPORTED_VERSION",
    "UNSAFE_PATH",
    "CONFLICTING_EFFORT"
  ] as const) {
    const summary = recordedTimeSummary();
    summary.revision = code === "CONFLICTING_EFFORT" ? 1 : null;
    summary.issues = [{ code, episodeKey: null }];
    const time = new FakeHumanTime();
    time.summary = summary;
    const io = new FakeIO(["human_time_update", "human_time_details", "exit"]);
    const runner = new FakeRunner([workflowStatus(runState("done"))]);
    await runInteractive(runner, io, { decidedBy: "human", humanTime: time });
    const text = io.lines.join("\n");
    assert.match(text, /Active time estimate\s+Unavailable/);
    assert.doesNotMatch(text, /Not added · optional/);
    assert.equal(
      io.choiceNames[0]?.at(-3),
      "Review active time estimate (unavailable)"
    );
    assert.ok(io.lines.includes("Time was not saved"));
    assert.match(text, /Reopen the time editor/);
    assert.ok(text.indexOf(code) > text.indexOf("Timing diagnostics"));
    assert.deepEqual(io.inputMessages, []);
    assert.deepEqual(time.edits, []);
    assert.deepEqual(runner.calls, []);
  }
});

test("human time: partial inventory and capture gaps preserve known waits with honest response coverage", async () => {
  const summary = recordedTimeSummary();
  assert.equal(summary.inventory, "partial");
  summary.issues.push({ code: "CAPTURE_GAP", episodeKey: null });
  const partial = await timeView(summary);
  assert.match(
    partial.lines.join("\n"),
    /Waiting for decisions\s+24s · 1 of 1 answered response timed/
  );
  assert.match(
    partial.lines.join("\n"),
    /Recorded waits only · coverage may be incomplete/
  );
  assert.doesNotMatch(
    partial.lines.join("\n"),
    /CAPTURE_GAP|lost|interruption|attachment|missing wait/
  );
  const [episode] = summary.episodes;
  assert.ok(episode);
  summary.episodes.push({
    ...episode,
    key: "missing-duration",
    durationMs: null,
    continuity: "discontinuity"
  });
  summary.answeredCount = 2;
  summary.unavailableCount = 1;
  summary.issues.push({
    code: "CLOCK_DISCONTINUITY",
    episodeKey: "missing-duration"
  });
  const io = await timeView(summary, true);
  const text = io.lines.join("\n");
  assert.match(
    text,
    /Waiting for decisions\s+24s · 1 of 2 answered responses timed/
  );
  assert.match(
    text,
    /Recorded-response subtotal\s+24s · 1 of 2 answered responses timed/
  );
  assert.match(text, /2\. Review triage\s+Unavailable/);
  assert.ok(text.indexOf("CAPTURE_GAP") > text.indexOf("Timing diagnostics"));
});

test("human time: dedicated details share answered status, attribution and clock notes", async () => {
  const summary = recordedTimeSummary();
  const time = new FakeHumanTime();
  await time.setEstimate("run-example", 0, 12);
  summary.effort = time.summary.effort;
  const [episode] = summary.episodes;
  assert.ok(episode);
  summary.episodes.push({
    ...episode,
    key: "second-review",
    durationMs: 66000
  });
  summary.answeredMs = 90000;
  summary.answeredCount = 2;
  const io = await timeView(summary, true);
  const text = io.lines
    .slice(io.lines.indexOf("Time details · this run"))
    .join("\n");
  assert.doesNotMatch(
    text,
    /Time for this run|Gate coverage|Gate response elapsed/
  );
  assert.match(text, /Estimate as of\s+2026-09-06T10:00:00.000Z/);
  assert.match(text, /All recorded decisions are answered\./);
  assert.match(text, /1\. Review triage\s+24s/);
  assert.match(text, /2\. Review triage\s+1m 6s/);
  assert.doesNotMatch(text, /24s · answered|1m 6s · answered/);
  assert.match(text, /Recorded-response subtotal\s+1m 30s/);
  assert.match(
    text.replace(/\s+/g, " "),
    /self-reported estimate for one person.*identity is not verified.*other contributors.*complete task total is not established/
  );
  assert.equal((text.match(/Clock continuity was checked/g) ?? []).length, 1);
  assert.doesNotMatch(text, /UTC wall clock · process correlated/);
});

test("human time: mixed outcomes, provisional waits, recovery and clock exceptions stay distinct", async () => {
  const summary = recordedTimeSummary();
  const [episode] = summary.episodes;
  assert.ok(episode);
  summary.episodes.push(
    {
      ...episode,
      key: "open",
      outcome: "open",
      durationMs: 1500,
      provisional: true,
      continuity: "unverified"
    },
    { ...episode, key: "cancelled", outcome: "cancelled", durationMs: 0 },
    { ...episode, key: "superseded", outcome: "superseded", durationMs: 60000 },
    {
      ...episode,
      key: "incomplete",
      outcome: "incomplete",
      durationMs: null,
      provisional: true
    },
    { ...episode, key: "clock", durationMs: null, continuity: "discontinuity" },
    {
      ...episode,
      key: "recovery-open",
      kind: "recovery_wait",
      outcome: "open",
      durationMs: 90000,
      provisional: true,
      continuity: "unverified"
    },
    {
      ...episode,
      key: "recovery-ended",
      kind: "recovery_wait",
      outcome: "recovery_ended",
      durationMs: 120000
    }
  );
  summary.answeredCount = 2;
  summary.openCount = 1;
  summary.otherCount = 3;
  summary.unavailableCount = 2;
  summary.recoveryUnknown = true;
  const io = await timeView(summary, true);
  const text = io.lines
    .slice(io.lines.indexOf("Time details · this run"))
    .join("\n");
  const plain = text.replace(/\s+/g, " ");
  assert.doesNotMatch(text, /All recorded decisions are answered/);
  assert.match(plain, /24s · answered/);
  assert.match(plain, /2s · open · provisional · clock continuity unverified/);
  assert.match(plain, /0s · cancelled/);
  assert.match(plain, /1m · superseded/);
  assert.match(plain, /Unavailable · incomplete evidence · provisional/);
  assert.match(plain, /Unavailable · answered · clock discontinuity/);
  assert.match(
    plain,
    /Recorded-response subtotal 24s · 1 of 2 answered responses timed/
  );
  assert.match(
    plain,
    /Recovery waiting.*1m 30s · open · provisional.*2m · ended/
  );
  assert.match(plain, /Recovery start or endpoint is unavailable/);
  assert.match(plain, /Recovery waits are separate from answered responses/);
});

test("human time: automatic durations round from milliseconds with carries and positive subsecond values", async () => {
  for (const [milliseconds, display] of [
    [0, "0s"],
    [1, "<1s"],
    [999, "<1s"],
    [1000, "1s"],
    [1499, "1s"],
    [1500, "2s"],
    [24000, "24s"],
    [59499, "59s"],
    [59500, "1m"],
    [60000, "1m"],
    [90000, "1m 30s"],
    [300000, "5m"],
    [3599499, "59m 59s"],
    [3599500, "1h"],
    [3600000, "1h"],
    [3689999, "1h 1m"],
    [3690000, "1h 2m"],
    [3720000, "1h 2m"],
    [86400000, "24h"]
  ] as const) {
    const summary = recordedTimeSummary();
    summary.answeredMs = milliseconds;
    const [episode] = summary.episodes;
    assert.ok(episode);
    summary.episodes[0] = { ...episode, durationMs: milliseconds };
    const io = await timeView(summary);
    assert.ok(
      io.lines.some(
        (line) =>
          line.includes(`Waiting for decisions`) &&
          line.includes(`${display} ·`)
      ),
      `${milliseconds}: ${io.lines.join("\n")}`
    );
  }
  const summary = recordedTimeSummary();
  const [episode] = summary.episodes;
  assert.ok(episode);
  summary.episodes = [
    { ...episode, durationMs: 1499 },
    { ...episode, key: "second", durationMs: 1499 }
  ];
  summary.answeredCount = 2;
  summary.answeredMs = 2998;
  const io = await timeView(summary, true);
  assert.match(io.lines.join("\n"), /Recorded-response subtotal\s+3s/);
  assert.match(io.lines.join("\n"), /1\. Review triage\s+1s/);
  assert.match(io.lines.join("\n"), /2\. Review triage\s+1s/);
});

test("human time: action labels refresh after save and blank input returns to the same menu", async () => {
  const time = new FakeHumanTime();
  const runner = new FakeRunner([workflowStatus(runState("done"))]);
  const io = new FakeIO(
    [
      "human_time_details",
      "human_time_update",
      "human_time_details",
      "human_time_update",
      "exit"
    ],
    ["0", ""]
  );
  await runInteractive(runner, io, { decidedBy: "human", humanTime: time });
  assert.equal(
    io.choiceNames[0]?.at(-3),
    "Add active time estimate (optional)"
  );
  assert.equal(
    io.choiceNames[1]?.at(-3),
    "Add active time estimate (optional)"
  );
  for (const names of io.choiceNames.slice(2))
    assert.equal(names.at(-3), "Edit active time estimate");
  for (const choices of io.choiceSets)
    assert.deepEqual(choices, io.choiceSets[0]);
  assert.deepEqual(time.edits, [
    { runId: "run-example", revision: 0, minutes: 0 }
  ]);
  assert.equal(io.inputOptions[0]?.defaultValue, undefined);
  assert.equal(io.inputOptions[1]?.defaultValue, undefined);
  assert.match(
    io.lines.join("\n"),
    /Previous estimate: 0 min, as of 2026-09-06T10:00:00.000Z/
  );
  assert.deepEqual(runner.calls, []);
  assert.deepEqual(io.confirmationMessages, []);
});

test("human time: narrow color-disabled summary and details wrap without clipping", async () => {
  const summary = recordedTimeSummary();
  const [episode] = summary.episodes;
  assert.ok(episode);
  summary.episodes[0] = {
    ...episode,
    kind: "planning_review_triage",
    continuity: "unverified"
  };
  summary.issues.push({ code: "CAPTURE_GAP", episodeKey: null });
  const io = await timeView(summary, true, 40);
  const lines = io.lines.slice(io.lines.indexOf("Time for this run"));
  assert.ok(
    lines.every((line) => line.length <= 40),
    lines.filter((line) => line.length > 40).join("\n")
  );
  const text = lines.join("\n");
  assert.doesNotMatch(text, /\u001b\[/);
  assert.match(text, /Active time estimate\n\s+Not added · optional/);
  assert.match(text.replace(/\s+/g, " "), /Planning-review triage 24s/);
  assert.match(text.replace(/\s+/g, " "), /clock continuity unverified/);
});

test("human time: unreadable timing returns to workflow choices with unavailable action labels", async () => {
  const time = new FakeHumanTime();
  time.readSummary = async () => {
    throw new Error("PRIVATE-TIMING-READ-ERROR");
  };
  const runner = new FakeRunner([
    workflowStatus(runState("needs_plan_approval"))
  ]);
  const io = new FakeIO(["human_time_details", "exit"]);
  await runInteractive(runner, io, { decidedBy: "human", humanTime: time });
  assert.equal(
    io.choiceNames[0]?.at(-3),
    "Review active time estimate (unavailable)"
  );
  assert.deepEqual(io.choiceSets[0], io.choiceSets[1]);
  assert.match(io.lines.join("\n"), /Timing evidence: Unavailable/);
  assert.doesNotMatch(
    io.lines.join("\n"),
    /PRIVATE-TIMING-READ-ERROR|Not added · optional/
  );
  assert.deepEqual(time.edits, []);
  assert.deepEqual(runner.calls, []);
});

test("human time: failed saves are actionable and never change a saved estimate", async () => {
  for (const result of [
    { status: "stale", issue: "STALE_REVISION" },
    { status: "contended", issue: "WRITE_CONTENDED" },
    { status: "unavailable", issue: "WRITE_FAILED" }
  ] as const) {
    const time = new FakeHumanTime();
    await time.setEstimate("run-example", 0, 12);
    time.edits.length = 0;
    time.result = result;
    const runner = new FakeRunner([workflowStatus(runState("done"))]);
    const io = new FakeIO(["human_time_update", "exit"], ["15"]);
    io.width = 40;
    await runInteractive(runner, io, { decidedBy: "human", humanTime: time });
    const plain = io.lines.join("\n").replace(/\s+/g, " ");
    assert.match(plain, /Time was not saved/);
    assert.match(plain, /Reopen the time editor/);
    assert.match(
      plain,
      /Previous estimate: 12 min, as of 2026-09-06T10:00:00.000Z/
    );
    assert.equal(time.summary.effort?.minutes, 12);
    assert.equal(io.choiceNames[1]?.at(-3), "Edit active time estimate");
    assert.equal(io.inputOptions[0]?.defaultValue, undefined);
    assert.deepEqual(runner.calls, []);
  }
});

test("human time: optional English editor at human, blocked and terminal stops never calls workflow mutations", async () => {
  for (const status of [
    "needs_plan_approval",
    "blocked",
    "done",
    "cancelled"
  ] as const) {
    const runner = new FakeRunner([workflowStatus(runState(status))]);
    const io = new FakeIO(["human_time_update", "exit"], ["12"]);
    const humanTime = new FakeHumanTime();
    await runInteractive(runner, io, { decidedBy: "account-label", humanTime });
    assert.deepEqual(humanTime.edits, [
      { runId: "run-example", revision: 0, minutes: 12 }
    ]);
    assert.deepEqual(runner.calls, []);
    assert.deepEqual(io.confirmationMessages, []);
    assert.deepEqual(io.inputMessages, [
      "Your total active minutes for this run so far"
    ]);
    assert.equal(io.inputOptions[0]?.defaultValue, undefined);
    assert.equal(humanTime.detached, 1);
    assert.equal(humanTime.attached, 1);
    assert.ok(
      io.lines.some((line) => line.includes("Self-reported · one person"))
    );
    assert.ok(io.lines.some((line) => line.includes("Active time estimate")));
    assert.ok(!io.lines.some((line) => line.includes("Your active time")));
  }
});

test("human time: blank, invalid and explicit zero input have distinct effects; stale saves stay unsaved", async () => {
  for (const [input, expected] of [
    ["", 0],
    ["-1", 0],
    ["Infinity", 0],
    ["0", 1]
  ] as const) {
    const time = new FakeHumanTime();
    const io = new FakeIO(["human_time_update", "exit"], [input]);
    await runInteractive(
      new FakeRunner([workflowStatus(runState("done"))]),
      io,
      { decidedBy: "human", humanTime: time }
    );
    assert.equal(time.edits.length, expected);
  }
  const time = new FakeHumanTime();
  time.result = { status: "stale", issue: "STALE_REVISION" };
  const io = new FakeIO(["human_time_update", "exit"], ["15"]);
  await runInteractive(new FakeRunner([workflowStatus(runState("done"))]), io, {
    decidedBy: "human",
    humanTime: time
  });
  assert.ok(io.lines.includes("Time was not saved"));
  assert.equal(time.edits.length, 1);
});

test("human time: editing between triage findings retains prior choices and adds no post-gate prompt", async () => {
  const review: ReviewResult = {
    contractVersion: CONTRACT_VERSION,
    verdict: "changes_requested",
    summary: "Two findings.",
    findings: [1, 2].map((n) => ({
      id: `R1-F${n}`,
      severity: "should_fix",
      category: "correctness",
      summary: "Fix the branch.",
      evidence: [],
      violates: [],
      reproduction: null,
      fixAcceptance: "Branch corrected.",
      confidence: "high"
    })),
    reviewedFindingIds: [],
    deferredCoverage: []
  };
  const state = runState("needs_triage", {
    reviewIteration: 1,
    latestReview: {
      iteration: 1,
      resultPath: "reviews/review-1.json",
      workspaceDigest: "workspace-digest",
      verdict: "changes_requested",
      sessionMode: "fresh",
      mode: "full",
      rotationReason: "primary-review"
    }
  });
  const runner = new FakeRunner([
    workflowStatus(state, { latestReview: review }),
    workflowStatus(runState("done"))
  ]);
  const io = new FakeIO(
    ["accepted", "human_time_update", "rejected", "exit"],
    ["12", ""],
    [true]
  );
  const time = new FakeHumanTime();
  await runInteractive(runner, io, { decidedBy: "human", humanTime: time });
  assert.deepEqual(runner.calls, [
    {
      operation: "triage",
      value: {
        accepted: ["R1-F1"],
        rejected: ["R1-F2"],
        deferred: [],
        note: null,
        decidedBy: "human"
      }
    }
  ]);
  assert.equal(time.edits.length, 1);
  assert.equal(io.inputMessages.length, 2);
  assert.equal(io.confirmationMessages.length, 1);
});

test("human time: consultation choices and Ctrl-C retain the existing decision boundary", async () => {
  const pending = runState("needs_human_decision", {
    pendingHumanDecision: consultationPending()
  });
  const runner = new FakeRunner([workflowStatus(pending)]);
  const io = new FakeIO(["human_time_details", { kind: "pause" }]);
  const time = new FakeHumanTime();
  await runInteractive(runner, io, { decidedBy: "human", humanTime: time });
  assert.deepEqual(runner.calls, []);
  assert.deepEqual(time.edits, []);
  const interrupted = new FakeIO(["human_time_update"]);
  interrupted.input = async () => {
    const error = new Error("User force closed the prompt");
    error.name = "ExitPromptError";
    throw error;
  };
  await runInteractive(
    new FakeRunner([workflowStatus(runState("done"))]),
    interrupted,
    { decidedBy: "human", humanTime: time }
  );
  assert.deepEqual(time.edits, []);
  assert.equal(time.detached, 2);
});

test("cancellation: interactive confirmation precedes stopping and the optional base-IO choice", async () => {
  for (const reason of ["plan_unsuitable", null] as const) {
    const state = runState("needs_plan_approval");
    const runner = new FakeRunner([
      workflowStatus(state),
      workflowStatus(runState("cancelled"))
    ]);
    const receipt: CancellationReceipt = {
      kind: "cancellation-first-response"
    };
    const io = new FakeIO(["cancel", reason, "exit"], [], [true]);
    const time = new FakeHumanTime();
    let stopped = false;
    runner.cancel = async (input) => {
      assert.equal(io.confirmationMessages.length, 1);
      assert.deepEqual(input, {
        expectedRunId: state.runId,
        channel: "interactive"
      });
      stopped = true;
      return {
        outcome: "cancelled",
        runId: state.runId,
        state: runState("cancelled"),
        stopRequest: "no_active_process",
        observation: "available",
        receipt
      };
    };
    const select = io.select.bind(io);
    io.select = async (message, choices) => {
      if (message === "Why did you cancel this run? (optional)") {
        assert.equal(stopped, true);
        assert.equal(choices[0]?.name, "Skip");
        assert.equal(choices[0].value, null);
        assert.equal(choices.length, 8);
        assert.ok(
          !choices.some((c) => String(c.value).startsWith("human_time"))
        );
      }
      return await select(message, choices);
    };
    await runInteractive(runner, io, { decidedBy: "human", humanTime: time });
    assert.deepEqual(runner.calls, [
      {
        operation: "cancellation_response",
        value:
          reason === null ? { state: "skipped" } : { state: "reported", reason }
      }
    ]);
    assert.deepEqual(time.edits, []);
    assert.equal(io.confirmationMessages.length, 1);
  }
});

test("cancellation: prompt interruption before confirmation preserves the run and after cancellation ends the session truthfully", async () => {
  for (const phase of ["confirmation", "reason"] as const) {
    const runner = new FakeRunner([
      workflowStatus(runState("needs_plan_approval"))
    ]);
    const io = new FakeIO(["cancel"], [], [true]);
    const exit = () => {
      const error = new Error("Synthetic prompt exit");
      error.name = "ExitPromptError";
      throw error;
    };
    let cancelled = false;
    if (phase === "confirmation") io.confirm = async () => exit();
    else {
      const select = io.select.bind(io);
      io.select = async (message, choices) =>
        message === "Why did you cancel this run? (optional)"
          ? exit()
          : await select(message, choices);
    }
    runner.cancel = async () => {
      cancelled = true;
      return {
        outcome: "cancelled",
        runId: "run-example",
        state: runState("cancelled"),
        stopRequest: "no_active_process",
        observation: "available",
        receipt: { kind: "cancellation-first-response" }
      };
    };
    await runInteractive(runner, io, { decidedBy: "human" });
    assert.equal(cancelled, phase === "reason");
    if (phase === "reason") {
      assert.deepEqual(runner.calls, [
        { operation: "cancellation_response", value: { state: "interrupted" } }
      ]);
      assert.ok(
        io.lines.includes("Run cancelled. No cancellation reason was saved.")
      );
      assert.ok(
        !io.lines.some((line) => line.includes("Run state was not changed"))
      );
    } else assert.deepEqual(runner.calls, []);
    assert.equal(io.selections.length, 0);
  }
});

test("accepted review F3 interactive approval escapes controls before the decision", async () => {
  class PrerequisiteRunner extends FakeRunner {
    async getPlanHumanPrerequisites(): Promise<string> {
      return "Normal multiline\n\tIndented\n\x1b[2J\x1b]0;canary\x07\u202e\u2066Canary";
    }
  }
  const runner = new PrerequisiteRunner([
    workflowStatus(runState("needs_plan_approval"))
  ]);
  const io = new FakeIO(["exit"]);
  const select = io.select.bind(io);
  io.select = async (message, choices) => {
    if (message === "Plan decision") {
      const output = io.lines.join("\n");
      assert.match(output, /Normal multiline\n\tIndented/u);
      assert.doesNotMatch(output, /[\x1b\x07\u202e\u2066]/u);
      assert.match(output, /\\u001b\[2J/u);
    }
    return select(message, choices);
  };
  await runInteractive(runner, io, { decidedBy: "human" });
  assert.equal(
    runner.calls.some((call) => call.operation === "approvePlan"),
    false
  );
});

test("v10 ADR menu without human-time controls offers review after rework and exits last", async () => {
  const status = workflowStatus(
    runState("needs_adr_approval", {
      schemaVersion: 10,
      planArtifacts: {
        description: null,
        plan: null,
        adrs: ["documentation/decisions/0001-example.md"],
        implementationReport: null,
        testReport: null
      }
    })
  );
  status.planningReview = {
    decisions: ["accept", "reject", "rework", "review"],
    reviewPaths: ["documentation/decisions/0001-example.md"],
    active: null,
    latest: null
  };
  const runner = new FakeRunner([status]);
  const io = new FakeIO(["exit"]);
  await runInteractive(runner, io, { decidedBy: "owner" });
  assert.deepEqual(io.choiceNames[0], [
    "Accept",
    "Reject",
    "Request rework",
    "Request independent review",
    "Exit without deciding"
  ]);
  assert.deepEqual(runner.calls, []);
});

test("v10 plan menu offers rework and review in exact order with default-No feedback confirmation", async () => {
  const status = workflowStatus(runState("needs_plan_approval"));
  status.planningReview = {
    decisions: ["approve", "rework", "review"],
    reviewPaths: ["documentation/work/example/plan.md"],
    active: null,
    latest: null
  };
  const runner = new FakeRunner([status, status]);
  const io = new FakeIO(["rework_plan", "exit"], ["Owner feedback"], [true]);
  await runInteractive(runner, io, { decidedBy: "owner" });
  assert.deepEqual(io.choiceNames[0], [
    "Approve plan and continue",
    "Request rework",
    "Request independent review",
    "Cancel run",
    "Exit and decide later"
  ]);
  assert.equal(io.inputMessages[0], "Rework feedback for the planner");
  assert.equal(io.inputOptions[0]?.validate?.(" "), "A value is required.");
  assert.equal(io.confirmationDefaults[0], false);
  assert.equal(runner.calls[0]?.operation, "reworkPlan");
});
test("v10 selected review scope and declined confirmation cause no runner mutation", async () => {
  const status = workflowStatus(runState("needs_plan_approval"));
  status.planningReview = {
    decisions: ["approve", "rework", "review"],
    reviewPaths: ["documentation/work/example/plan.md"],
    active: null,
    latest: null
  };
  const runner = new FakeRunner([status, status]);
  const io = new FakeIO(
    [
      "planning_review",
      "choose",
      ["documentation/work/example/plan.md"],
      "exit"
    ],
    [],
    [false]
  );
  await runInteractive(runner, io, { decidedBy: "owner" });
  assert.deepEqual(runner.calls, []);
  assert.equal(
    io.confirmationMessages[0],
    "Send the selected artifacts to the configured reviewer?"
  );
  assert.equal(io.confirmationDefaults[0], false);
});
