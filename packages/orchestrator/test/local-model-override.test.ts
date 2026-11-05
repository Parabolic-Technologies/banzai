import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { writeFileSync } from "node:fs";
import { appendFile, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { executeAgentControlCommand } from "../src/agent-control-cli.js";
import { CONFIGURATION_ACTIONS } from "../src/configuration-prerequisite.js";
import {
  BanzaiError,
  LocalConfigError,
  LocalModelOverrideRefusalError,
  ProcessExitError,
  ProjectSetupRequiredError
} from "../src/errors.js";
import {
  LOCAL_MODEL_DRIFT_ADVICE,
  localModelDriftLines
} from "../src/local-config.js";
import {
  humanStatusView,
  modelStatusLines,
  requireRecoverable
} from "../src/model-status.js";
import { runProcess } from "../src/process.js";
import type {
  AdapterResult,
  LocalModelLayer,
  ModelSettings,
  OrchestratorConfig,
  PhaseAdapterRequest,
  PhaseResult,
  ProcessRunner,
  ProgressReporter,
  RunState
} from "../src/types.js";
import { WorkflowRunner } from "../src/workflow.js";
import {
  commitAll,
  createTestRepository,
  historicalBindingFixture,
  LOCAL_CONFIG_IGNORE_LINE,
  localModelFileText,
  requiredFixture,
  snapshotTree,
  withVendorExecutablesOnPath,
  writeLocalModels
} from "./helpers.js";
import {
  planningReviewAnalysis,
  planningReviewResult,
  planningTriageAnswer
} from "./planning-review-fixtures.js";
import {
  blockedByFailedCheck,
  decisionConsultationResult,
  FakeAdapters,
  finding,
  passingReview,
  phaseResult
} from "./workflow-fixtures.js";

const execFileAsync = promisify(execFile);
const PACKAGE_ROOT = fileURLToPath(new URL("../", import.meta.url));

/** A local reviewer the runs below never recorded. */
const DRIFTED: LocalModelLayer = {
  reviewer: { executable: "codex", model: "gpt-6.1-sol", effort: "high" }
};
const DRIFT_MESSAGE = [
  "Local models changed since this run recorded them",
  "  Review: recorded shared, now codex gpt-6.1-sol high",
  LOCAL_MODEL_DRIFT_ADVICE
].join("\n");

function isDrift(error: unknown): boolean {
  assert.ok(error instanceof LocalModelOverrideRefusalError, String(error));
  assert.equal(error.code, "LOCAL_MODEL_OVERRIDE_CHANGED");
  assert.equal(error.message, DRIFT_MESSAGE);
  return true;
}

function isNotIgnored(error: unknown): boolean {
  assert.ok(error instanceof LocalConfigError, String(error));
  assert.equal(error.code, "LOCAL_CONFIG_NOT_IGNORED");
  return true;
}

/** A local reviewer for the recording cases; the committed one is shared. */
const LOCAL_REVIEWER: LocalModelLayer = {
  reviewer: { executable: "claude", model: "claude-opus-5-5", effort: "xhigh" }
};
/** A local planner, which also invalidates a saved planner checkpoint. */
const LOCAL_PLANNER: LocalModelLayer = {
  planner: { executable: "codex", model: "gpt-6.1-sol", effort: "high" }
};
const RECORDING_HEADING = "Recording the changed local models for this run:";
const REVIEWER_RECORDED = {
  sources: { planner: "committed", implementer: "committed", reviewer: "local" }
};

function changeLines(
  recorded: LocalModelLayer,
  models: LocalModelLayer
): string[] {
  return localModelDriftLines(recorded, { state: "valid", models }).map(
    (line) => `  ${line}`
  );
}

/** A refusal naming each role whose triple differs from the held one. */
function changedFrom(recorded: LocalModelLayer, models: LocalModelLayer) {
  return (error: unknown): boolean => {
    assert.ok(error instanceof LocalModelOverrideRefusalError, String(error));
    assert.equal(error.code, "LOCAL_MODEL_OVERRIDE_CHANGED");
    assert.equal(
      error.message,
      [
        "Local models changed since this run recorded them",
        ...changeLines(recorded, models),
        LOCAL_MODEL_DRIFT_ADVICE
      ].join("\n")
    );
    return true;
  };
}

/** Collects the runner's info lines and passes each to `onInfo`. */
function infoLines(onInfo: (message: string) => void = () => {}) {
  const lines: string[] = [];
  const reporter: ProgressReporter = (event) => {
    if (event.kind !== "info") return;
    lines.push(event.message);
    onInfo(event.message);
  };
  return { lines, reporter };
}

/** The printed recording: the heading and one line per changed role. */
function printedRecording(lines: string[]): string[] {
  const at = lines.indexOf(RECORDING_HEADING);
  if (at === -1) return [];
  const end = lines.findIndex(
    (line, index) => index > at && !line.startsWith("  ")
  );
  return lines.slice(at, end === -1 ? undefined : end);
}

interface RunEvent {
  type: string;
  details: Record<string, unknown>;
}

async function runEvents(
  runner: WorkflowRunner,
  runId: string
): Promise<RunEvent[]> {
  return (
    await readFile(
      path.join(runner.store.runDirectory(runId), "events.jsonl"),
      "utf8"
    )
  )
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as RunEvent);
}

async function recordedLayer(
  runner: WorkflowRunner,
  runId: string
): Promise<LocalModelLayer | "absent"> {
  const record = await runner.store.readModelOverrideRecord(runId);
  assert.notEqual(record.state, "defective");
  return record.state === "recorded" ? record.models : "absent";
}

function triple(settings: ModelSettings) {
  return {
    executable: settings.executable,
    model: settings.model,
    effort: settings.effort
  };
}

/** Records the reviewer triple of every review request. */
function reviewTriples(adapters: FakeAdapters): unknown[] {
  const triples: unknown[] = [];
  adapters.onReview = (request) => {
    triples.push(triple(request.settings));
    return Promise.resolve();
  };
  return triples;
}

/** Writes `models` synchronously once a recording starts to print. */
function editOnRecording(root: string, models: LocalModelLayer) {
  let armed = true;
  return infoLines((message) => {
    if (!armed || message !== RECORDING_HEADING) return;
    armed = false;
    writeFileSync(
      path.join(root, LOCAL_CONFIG_IGNORE_LINE),
      localModelFileText(models)
    );
  });
}

/** A run whose planning attempt failed after one model attempt. */
async function failedPlanning(root: string, reporter?: ProgressReporter) {
  const adapters = new FakeAdapters();
  adapters.planErrors.push(
    new BanzaiError("MODEL_TIMEOUT", "Planner timed out.")
  );
  adapters.reviewResults.push(passingReview());
  const runner = new WorkflowRunner(root, adapters, undefined, reporter);
  const blocked = await runner.start({
    slug: "example",
    request: "Implement it."
  });
  assert.equal(blocked.status, "blocked");
  assert.equal(blocked.activeAttempt?.kind, "plan");
  return { adapters, runner, blocked };
}

/** A run whose startup checks failed before any model attempt. */
async function blockedAtStartup(root: string, reporter?: ProgressReporter) {
  const adapters = new FakeAdapters();
  adapters.claudePreflightErrors.push(
    new BanzaiError("CLAUDE_AUTH_REQUIRED", "Sign in to Claude.")
  );
  adapters.reviewResults.push(passingReview());
  const runner = new WorkflowRunner(root, adapters, undefined, reporter);
  const blocked = await runner.start({
    slug: "example",
    request: "Implement it."
  });
  assert.equal(blocked.status, "blocked");
  assert.equal(blocked.blockedFrom, "created", blocked.blockReason ?? "");
  return { adapters, runner, blocked };
}

/**
 * Plans once, saves the planner's terminal result and then fails, so a retry
 * reconciles that saved result (as `workflow-recovery.test.ts` does).
 */
class SavedPlanningAdapters extends FakeAdapters {
  saved = false;
  readonly planTriples: unknown[] = [];

  async runPhase(
    request: PhaseAdapterRequest
  ): Promise<AdapterResult<PhaseResult>> {
    if (!request.prompt.includes("Phase: plan"))
      return await super.runPhase(request);
    this.planTriples.push(triple(request.settings));
    await request.onSessionStarted?.("planner-session");
    const result = await super.runPhase(request);
    if (this.saved) return result;
    this.saved = true;
    await request.onTerminalSuccess?.({
      classification: "codex_turn_completed",
      observedAt: new Date().toISOString(),
      result: result.result,
      sessionId: "planner-session",
      usage: null
    });
    const now = new Date().toISOString();
    throw new ProcessExitError(
      "PROCESS_TIMEOUT",
      "Planning stopped after writing its artifacts.",
      {
        exitCode: 1,
        signal: null,
        stdout: "",
        stderr: "",
        startedAt: now,
        completedAt: now
      },
      { failureCause: "timeout", usage: null }
    );
  }
}

/** Ignores the local file through the clone's exclude file only. */
async function excludeLocalConfig(root: string): Promise<void> {
  await appendFile(
    path.join(root, ".git/info/exclude"),
    `${LOCAL_CONFIG_IGNORE_LINE}\n`
  );
}

/** Every byte below `.banzai/runs`: state, events, attempts and the record. */
async function runBytes(root: string) {
  return snapshotTree(path.join(root, ".banzai/runs"));
}

/** Every byte below `.banzai`, including human-time and work records. */
async function banzaiBytes(root: string) {
  return snapshotTree(path.join(root, ".banzai"));
}

function modelCalls(adapters: FakeAdapters): number[] {
  return [
    adapters.codexPreflights,
    adapters.claudePreflights,
    adapters.selectionPrompts.length,
    adapters.phasePrompts.length,
    adapters.reviewPrompts.length,
    adapters.planningRequests.length
  ];
}

async function updateCommittedConfig(
  root: string,
  edit: (config: OrchestratorConfig) => void
): Promise<void> {
  const configPath = path.join(root, ".banzai/config.json");
  const config = JSON.parse(
    await readFile(configPath, "utf8")
  ) as OrchestratorConfig;
  edit(config);
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  await commitAll(root, "configure models");
}

async function gitStatus(root: string): Promise<string> {
  return (await execFileAsync("git", ["status", "--porcelain"], { cwd: root }))
    .stdout;
}

interface EntryFixture {
  adapters: FakeAdapters;
  runner: WorkflowRunner;
  act(): Promise<unknown>;
}

/** A run whose implementation was interrupted and left a started attempt. */
async function interruptedImplementation(root: string) {
  const adapters = new FakeAdapters();
  adapters.implementationErrors.push(new Error("implementation interrupted"));
  adapters.reviewResults.push(passingReview());
  const runner = new WorkflowRunner(root, adapters);
  await runner.start({ slug: "example", request: "Implement it." });
  const blocked = await runner.approvePlan("human");
  const sourceAttempt = requiredFixture(blocked.activeAttempt);
  const record = await runner.store.readRunAttempt(
    blocked.runId,
    sourceAttempt
  );
  record.status = "started";
  record.completedAt = null;
  record.durationMs = null;
  record.error = null;
  record.failureCode = null;
  await runner.store.writeRunAttempt(blocked.runId, record);
  const status = await runner.status();
  const recoveryIdentity = requiredFixture(status.recovery.recoveryIdentity);
  return { adapters, runner, sourceAttempt, recoveryIdentity };
}

async function planGate(root: string, adapters = new FakeAdapters()) {
  adapters.reviewResults.push(passingReview());
  const runner = new WorkflowRunner(root, adapters);
  const gate = await runner.start({ slug: "example", request: "Plan it." });
  assert.equal(gate.status, "needs_plan_approval", gate.blockReason ?? "");
  return { adapters, runner, gate };
}

const ENTRY_FIXTURES: Record<string, (root: string) => Promise<EntryFixture>> =
  {
    "approve plan": async (root) => {
      const f = await planGate(root);
      return { ...f, act: () => f.runner.approvePlan("human") };
    },
    "re-check plan edits": async (root) => {
      const f = await planGate(root);
      return {
        ...f,
        act: () => f.runner.recheckPlan({ decidedBy: "human" })
      };
    },
    "rework plan": async (root) => {
      const f = await planGate(root);
      return {
        ...f,
        act: () =>
          f.runner.reworkPlan({
            feedback: "Tighten the rollout steps.",
            decidedBy: "owner"
          })
      };
    },
    "request planning review": async (root) => {
      const f = await planGate(root);
      return {
        ...f,
        act: () =>
          f.runner.requestPlanningReview({
            paths: null,
            decidedBy: "owner",
            autoResume: false
          })
      };
    },
    "answer planning review": async (root) => {
      const f = await planGate(root);
      const requested = await f.runner.requestPlanningReview({
        paths: null,
        decidedBy: "owner",
        autoResume: false
      });
      const episode = requiredFixture(requested.planningReview?.active);
      const result = {
        ...planningReviewResult(1, episode.reviewNumber),
        scope: episode.scope
      };
      f.adapters.planningReviewResults.push(result);
      f.adapters.planningAnalysisResults.push(planningReviewAnalysis(result));
      const triage = await f.runner.resume();
      return {
        ...f,
        act: () =>
          f.runner.answerPlanningReview({
            answer: planningTriageAnswer(triage),
            decidedBy: "owner"
          })
      };
    },
    "decide ADR": async (root) => {
      const adapters = new FakeAdapters();
      adapters.planResults.push(
        phaseResult("plan", {
          outcome: "needs_human_decision",
          gate: "adr_approval"
        })
      );
      const runner = new WorkflowRunner(root, adapters);
      const gate = await runner.start({ slug: "example", request: "Plan it." });
      assert.equal(gate.status, "needs_adr_approval", gate.blockReason ?? "");
      return {
        adapters,
        runner,
        act: () =>
          runner.decideAdr({
            id: "ADR-0001",
            decision: "accept",
            note: null,
            decidedBy: "human",
            autoResume: true
          })
      };
    },
    "answer human decision": async (root) => {
      const adapters = new FakeAdapters();
      adapters.planResults.push(
        phaseResult("plan", {
          outcome: "needs_human_decision",
          gate: "escalation",
          questions: ["Preserve compatibility?"]
        })
      );
      const runner = new WorkflowRunner(root, adapters);
      const gate = await runner.start({ slug: "example", request: "Plan it." });
      assert.equal(gate.status, "needs_human_decision", gate.blockReason ?? "");
      return {
        adapters,
        runner,
        act: () =>
          runner.answerHumanDecision({
            answers: ["Preserve compatibility."],
            decidedBy: "human"
          })
      };
    },
    "answer decision consultation": async (root) => {
      const adapters = new FakeAdapters();
      adapters.planResults.push(decisionConsultationResult());
      const runner = new WorkflowRunner(root, adapters);
      const gate = await runner.start({ slug: "example", request: "Plan it." });
      assert.equal(gate.status, "needs_human_decision", gate.blockReason ?? "");
      return {
        adapters,
        runner,
        act: () =>
          runner.answerDecisionConsultation({
            runId: gate.runId,
            requestId: "request-1",
            roundId: "round-1",
            answers: [
              {
                decisionId: "storage-model",
                response: {
                  kind: "option",
                  optionId: "reuse-store",
                  text: null
                },
                note: null
              }
            ],
            decidedBy: "human"
          })
      };
    },
    triage: async (root) => {
      const adapters = new FakeAdapters();
      adapters.reviewResults.push({
        ...passingReview(),
        verdict: "changes_requested",
        findings: [finding("R1-F1", "Repair the finding.")]
      });
      const runner = new WorkflowRunner(root, adapters);
      await runner.start({ slug: "example", request: "Implement it." });
      const waiting = await runner.approvePlan("human");
      assert.equal(waiting.status, "needs_triage", waiting.blockReason ?? "");
      return {
        adapters,
        runner,
        act: () =>
          runner.triage({
            accepted: ["R1-F1"],
            rejected: [],
            deferred: [],
            note: null,
            decidedBy: "human"
          })
      };
    },
    recover: async (root) => {
      const f = await interruptedImplementation(root);
      return {
        ...f,
        act: () =>
          f.runner.recover({
            attemptId: f.sourceAttempt.id,
            recoveryIdentity: f.recoveryIdentity,
            unknownSideEffectsAccepted: true,
            decidedBy: "current-human"
          })
      };
    },
    "resume reconciling an attempt": async (root) => {
      const f = await interruptedImplementation(root);
      return { ...f, act: () => f.runner.resume() };
    },
    "resume an authorized recovery": async (root) => {
      const f = await interruptedImplementation(root);
      await f.runner.recover(
        {
          attemptId: f.sourceAttempt.id,
          recoveryIdentity: f.recoveryIdentity,
          unknownSideEffectsAccepted: true,
          decidedBy: "current-human"
        },
        false
      );
      return { ...f, act: () => f.runner.resume() };
    },
    "resume an approved plan": async (root) => {
      const f = await planGate(root);
      const approved = await f.runner.approvePlan("human", false);
      assert.equal(approved.status, "plan_approved");
      return { ...f, act: () => f.runner.resume() };
    }
  };

test("each state-changing command refuses drifted local models at entry without writing", async (t) => {
  for (const [name, prepare] of Object.entries(ENTRY_FIXTURES))
    await t.test(name, async () => {
      const repository = await createTestRepository({
        ignoreLocalConfig: true
      });
      try {
        const f = await prepare(repository.root);
        await writeLocalModels(repository.root, DRIFTED);
        const before = await banzaiBytes(repository.root);
        const status = await f.runner.status();
        const calls = modelCalls(f.adapters);
        await assert.rejects(f.act(), isDrift);
        assert.deepEqual(await banzaiBytes(repository.root), before);
        assert.deepEqual(await f.runner.status(), status);
        assert.deepEqual(modelCalls(f.adapters), calls);
      } finally {
        await repository.dispose();
      }
    });
});

test("drift during task verification keeps the verification and a restored file continues", async () => {
  const repository = await createTestRepository({ ignoreLocalConfig: true });
  try {
    const adapters = new FakeAdapters();
    adapters.reviewResults.push(passingReview());
    let armed = false;
    let drifted = false;
    const processRunner: ProcessRunner = async (spec) => {
      const result = await runProcess(spec);
      if (armed && !drifted) {
        drifted = true;
        await writeLocalModels(repository.root, DRIFTED);
      }
      return result;
    };
    const runner = new WorkflowRunner(repository.root, adapters, processRunner);
    await runner.start({ slug: "example", request: "Implement it." });
    armed = true;
    await assert.rejects(runner.approvePlan("human"), isDrift);
    assert.equal(drifted, true);
    const saved = (await runner.status()).state;
    // The review checks ran; the comparison before the review attempt
    // refused, so no review attempt, rotation reason or block exists.
    assert.equal(saved.status, "reviewing");
    assert.ok(saved.taskVerification);
    assert.equal(saved.blockReason, null);
    assert.equal(saved.blockedFrom, null);
    assert.equal(saved.activeAttempt, null);
    assert.equal(saved.metrics.reviews.rotations, 0);
    assert.equal(adapters.reviewPrompts.length, 0);
    const attempts = await runner.store.readRunAttempts(saved.runId);
    assert.ok(attempts.every((record) => record.attempt.kind !== "review"));
    const events = (
      await readFile(
        path.join(runner.store.runDirectory(saved.runId), "events.jsonl"),
        "utf8"
      )
    )
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { type: string });
    assert.ok(
      events.every((event) => !/block|review/u.test(event.type)),
      events.map((event) => event.type).join(", ")
    );

    await rm(path.join(repository.root, LOCAL_CONFIG_IGNORE_LINE));
    const done = await runner.resume();
    assert.equal(done.status, "done", done.blockReason ?? "");
    assert.equal(adapters.reviewPrompts.length, 1);
  } finally {
    await repository.dispose();
  }
});

test("drift before planning analysis keeps the completed planning review", async () => {
  const repository = await createTestRepository({ ignoreLocalConfig: true });
  try {
    const { adapters, runner } = await planGate(repository.root);
    const requested = await runner.requestPlanningReview({
      paths: null,
      decidedBy: "owner",
      autoResume: false
    });
    const episode = requiredFixture(requested.planningReview?.active);
    const result = {
      ...planningReviewResult(1, episode.reviewNumber),
      scope: episode.scope
    };
    adapters.planningReviewResults.push(result);
    adapters.planningAnalysisResults.push(planningReviewAnalysis(result));
    adapters.onPlanning = async () => {
      if (adapters.planningRequests.length === 1)
        await writeLocalModels(repository.root, DRIFTED);
    };
    await assert.rejects(runner.resume(), isDrift);
    assert.equal(adapters.planningRequests.length, 1);
    const saved = (await runner.status()).state;
    assert.equal(saved.blockReason, null);
    assert.equal(saved.activeAttempt, null);
    const attempts = await runner.store.readRunAttempts(saved.runId);
    const reviews = attempts.filter(
      (record) => record.attempt.kind === "planning_review"
    );
    assert.equal(reviews.length, 1);
    assert.equal(reviews[0]?.status, "completed");
    assert.ok(
      attempts.every((record) => record.attempt.kind !== "planning_analysis")
    );

    adapters.onPlanning = null;
    await rm(path.join(repository.root, LOCAL_CONFIG_IGNORE_LINE));
    const triage = await runner.resume();
    assert.equal(
      triage.pendingHumanDecision?.kind,
      "planning_review_triage",
      triage.blockReason ?? ""
    );
    assert.equal(adapters.planningRequests.length, 2);
  } finally {
    await repository.dispose();
  }
});

test("drift refuses before a verification retry commits its transition", async () => {
  const repository = await createTestRepository({ ignoreLocalConfig: true });
  try {
    await withVendorExecutablesOnPath(async () => {
      const { blocked } = await blockedByFailedCheck(repository.root);
      // A terminal retry records the reviewer, and an edit while it prints
      // reaches the comparison before the pending transition.
      await writeLocalModels(repository.root, LOCAL_REVIEWER);
      const output = editOnRecording(repository.root, DRIFTED);
      const adapters = new FakeAdapters();
      adapters.fixtureTaskChecks = true;
      const runner = new WorkflowRunner(
        repository.root,
        adapters,
        undefined,
        output.reporter
      );
      const events = await runEvents(runner, blocked.runId);
      await assert.rejects(
        runner.retry({ terminal: true }),
        changedFrom(LOCAL_REVIEWER, DRIFTED)
      );
      // The recording was committed; neither the transition nor its event
      // was.
      const after = await runEvents(runner, blocked.runId);
      assert.deepEqual(after.slice(0, events.length), events);
      assert.deepEqual(
        after
          .slice(events.length)
          .map((event) => ({ type: event.type, details: event.details })),
        [{ type: "model_override.recorded", details: REVIEWER_RECORDED }]
      );
      assert.deepEqual(
        await recordedLayer(runner, blocked.runId),
        LOCAL_REVIEWER
      );
      const saved = (await runner.status()).state;
      assert.equal(saved.status, "blocked");
      assert.equal(saved.blockedFrom, blocked.blockedFrom);
      assert.equal(saved.blockReason, blocked.blockReason);
    });
  } finally {
    await repository.dispose();
  }
});

test("drift refuses before a review retry commits its verification transition", async () => {
  const repository = await createTestRepository({ ignoreLocalConfig: true });
  try {
    await withVendorExecutablesOnPath(async () => {
      const adapters = new FakeAdapters();
      adapters.reviewResults.push(passingReview());
      const output = editOnRecording(repository.root, DRIFTED);
      const runner = new WorkflowRunner(
        repository.root,
        adapters,
        undefined,
        output.reporter
      );
      await runner.start({ slug: "example", request: "Implement it." });
      // The reviewer's subscription check fails once, so the run blocks at
      // the review checks with its task verification recorded.
      adapters.claudePreflightErrors.push(
        new BanzaiError("CLAUDE_AUTH_REQUIRED", "Sign in to Claude.")
      );
      const blocked = await runner.approvePlan("human");
      assert.equal(blocked.status, "blocked");
      assert.equal(blocked.blockedFrom, "reviewing", blocked.blockReason ?? "");
      // A source edit makes that task verification stale, so the review
      // retry must re-establish it through a pending transition to verifying.
      await writeFile(path.join(repository.root, "base.txt"), "edited\n");
      const events = await runEvents(runner, blocked.runId);
      await writeLocalModels(repository.root, LOCAL_REVIEWER);
      const calls = modelCalls(adapters);
      await assert.rejects(
        runner.retry({ terminal: true }),
        changedFrom(LOCAL_REVIEWER, DRIFTED)
      );
      // The recording was committed; neither the transition nor its event
      // was.
      const after = await runEvents(runner, blocked.runId);
      assert.deepEqual(
        after.slice(events.length).map((event) => event.type),
        ["model_override.recorded"]
      );
      const saved = await runner.status();
      assert.equal(saved.state.status, "blocked");
      assert.equal(saved.state.blockedFrom, "reviewing");
      assert.equal(
        saved.state.blockReason,
        "Required task verification is unavailable or stale."
      );
      assert.equal(saved.retry.eligible, true);
      assert.equal(adapters.reviewPrompts.length, calls[4]);

      // Without the local file the run records the shared reviewer again.
      await rm(path.join(repository.root, LOCAL_CONFIG_IGNORE_LINE));
      const done = await runner.retry({ terminal: true });
      assert.equal(done.status, "done", done.blockReason ?? "");
      assert.deepEqual(await recordedLayer(runner, blocked.runId), {});
    });
  } finally {
    await repository.dispose();
  }
});

test("a defective run record refuses retry at its eligibility read without a block reason or event", async () => {
  const repository = await createTestRepository({ ignoreLocalConfig: true });
  try {
    const adapters = new FakeAdapters();
    adapters.planErrors.push(
      new BanzaiError("MODEL_TIMEOUT", "Planner timed out.")
    );
    const runner = new WorkflowRunner(repository.root, adapters);
    const blocked = await runner.start({
      slug: "example",
      request: "Plan it."
    });
    assert.equal(blocked.status, "blocked");
    const record = path.join(
      runner.store.runDirectory(blocked.runId),
      "model-override.json"
    );
    await writeFile(record, "not a record\n");
    const before = await runBytes(repository.root);
    const calls = modelCalls(adapters);
    await assert.rejects(runner.retry(), (error) => {
      assert.ok(error instanceof LocalModelOverrideRefusalError);
      assert.equal(error.code, "LOCAL_MODEL_OVERRIDE_RECORD_INVALID");
      assert.match(
        error.message,
        new RegExp(`\\.banzai/runs/${blocked.runId}/model-override\\.json`)
      );
      return true;
    });
    assert.deepEqual(await runBytes(repository.root), before);
    assert.deepEqual(modelCalls(adapters), calls);
    const saved = (await runner.status()).state;
    assert.equal(saved.blockReason, blocked.blockReason);
  } finally {
    await repository.dispose();
  }
});

test("verification applicability rethrows a defective run record instead of blocking", async () => {
  const repository = await createTestRepository({ ignoreLocalConfig: true });
  try {
    const adapters = new FakeAdapters();
    adapters.reviewResults.push({
      ...passingReview(),
      verdict: "changes_requested",
      findings: [finding("R1-F1", "Optional observation.")]
    });
    const runner = new WorkflowRunner(repository.root, adapters);
    await runner.start({ slug: "example", request: "Implement it." });
    const waiting = await runner.approvePlan("human");
    assert.equal(waiting.status, "needs_triage");
    assert.equal(waiting.verificationMode, "task");
    await writeFile(
      path.join(
        runner.store.runDirectory(waiting.runId),
        "model-override.json"
      ),
      "{}\n"
    );
    const before = await runBytes(repository.root);
    // A fresh runner holds no record, so the applicability check makes the
    // command's first resolution, as a state-changing command would.
    const fresh = new WorkflowRunner(repository.root, adapters) as unknown as {
      requireVerificationApplicability(state: RunState): Promise<boolean>;
    };
    await assert.rejects(
      fresh.requireVerificationApplicability(
        await runner.store.requireActiveState()
      ),
      { code: "LOCAL_MODEL_OVERRIDE_RECORD_INVALID" }
    );
    assert.deepEqual(await runBytes(repository.root), before);
  } finally {
    await repository.dispose();
  }
});

test("cancel succeeds while the local models drift", async () => {
  const repository = await createTestRepository({ ignoreLocalConfig: true });
  try {
    const { runner } = await planGate(repository.root);
    await writeLocalModels(repository.root, DRIFTED);
    const result = await runner.cancel();
    assert.equal(result.outcome, "cancelled");
    assert.equal((await runner.status()).state.status, "cancelled");
  } finally {
    await repository.dispose();
  }
});

test("status during drift keeps the recommendation and eligibility", async () => {
  const repository = await createTestRepository({ ignoreLocalConfig: true });
  try {
    const { runner } = await planGate(repository.root);
    const before = await runner.status();
    await writeLocalModels(repository.root, DRIFTED);
    assert.deepEqual(await runner.status(), before);
  } finally {
    await repository.dispose();
  }
});

test("a local reviewer replaces the committed reviewer for every review and keeps Git clean", async () => {
  const repository = await createTestRepository({ ignoreLocalConfig: true });
  try {
    await withVendorExecutablesOnPath(async () => {
      await updateCommittedConfig(repository.root, (config) => {
        config.models.reviewer.executable = "codex";
        config.models.reviewer.model = "gpt-6.1-sol";
        config.models.reviewer.effort = "high";
      });
      const local = {
        executable: "claude",
        model: "claude-opus-5-5",
        effort: "xhigh"
      } as const;
      await writeLocalModels(repository.root, { reviewer: local });
      assert.equal(await gitStatus(repository.root), "");

      const adapters = new FakeAdapters();
      adapters.reviewResults.push(
        {
          ...passingReview(),
          verdict: "changes_requested",
          findings: [finding("R1-F1", "Repair the finding.")]
        },
        passingReview(["R1-F1"])
      );
      const reviewers: unknown[] = [];
      adapters.onReview = (request) => {
        reviewers.push({
          executable: request.settings.executable,
          model: request.settings.model,
          effort: request.settings.effort
        });
        return Promise.resolve();
      };
      const runner = new WorkflowRunner(repository.root, adapters);
      const gate = await runner.start({
        slug: "example",
        request: "Implement it."
      });
      assert.equal(gate.status, "needs_plan_approval", gate.blockReason ?? "");
      // A formatting-only edit is the same layer and never refuses.
      await writeFile(
        path.join(repository.root, LOCAL_CONFIG_IGNORE_LINE),
        JSON.stringify({
          models: {
            reviewer: {
              effort: local.effort,
              model: local.model,
              executable: local.executable
            }
          },
          schemaVersion: 1
        })
      );
      const waiting = await runner.approvePlan("human");
      assert.equal(waiting.status, "needs_triage", waiting.blockReason ?? "");
      const done = await runner.triage({
        accepted: ["R1-F1"],
        rejected: [],
        deferred: [],
        note: null,
        decidedBy: "human"
      });
      assert.equal(done.status, "done", done.blockReason ?? "");
      assert.deepEqual(reviewers, [local, local]);
      assert.ok(adapters.claudePreflights > 0);
      // The run leaves its implementation changes; neither the local file
      // nor run state ever shows in Git.
      assert.doesNotMatch(await gitStatus(repository.root), /\.banzai/u);
    });
  } finally {
    await repository.dispose();
  }
});

test("run start refuses an unignored or tracked local file before any executable", async (t) => {
  for (const cause of ["not ignored", "tracked"] as const)
    await t.test(cause, async () => {
      const repository = await createTestRepository({
        ignoreLocalConfig: cause === "tracked"
      });
      try {
        await writeLocalModels(repository.root, DRIFTED);
        if (cause === "tracked")
          await execFileAsync(
            "git",
            ["add", "--force", LOCAL_CONFIG_IGNORE_LINE],
            { cwd: repository.root }
          );
        const adapters = new FakeAdapters();
        const runner = new WorkflowRunner(repository.root, adapters);
        await assert.rejects(
          runner.start({ slug: "example", request: "Plan it." }),
          (error) => {
            isNotIgnored(error);
            assert.ok(error instanceof LocalConfigError);
            assert.equal(
              error.defect.cause,
              cause === "tracked" ? "tracked" : "not_ignored"
            );
            return true;
          }
        );
        assert.deepEqual(modelCalls(adapters), [0, 0, 0, 0, 0, 0]);
        assert.deepEqual(await runBytes(repository.root), []);
        assert.equal(await runner.store.readActiveRunId(), null);
      } finally {
        await repository.dispose();
      }
    });
});

test("approve and resume refuse an unignored local file before any write", async (t) => {
  for (const command of ["approve", "resume"] as const)
    await t.test(command, async () => {
      const repository = await createTestRepository();
      try {
        const { adapters, runner } = await planGate(repository.root);
        if (command === "resume") await runner.approvePlan("human", false);
        await writeLocalModels(repository.root, DRIFTED);
        const before = await banzaiBytes(repository.root);
        const calls = modelCalls(adapters);
        await assert.rejects(
          command === "approve" ? runner.approvePlan("human") : runner.resume(),
          isNotIgnored
        );
        assert.deepEqual(await banzaiBytes(repository.root), before);
        assert.deepEqual(modelCalls(adapters), calls);
      } finally {
        await repository.dispose();
      }
    });
});

test("a second start on the same runner checks Git again", async () => {
  const repository = await createTestRepository();
  try {
    await withVendorExecutablesOnPath(async () => {
      await excludeLocalConfig(repository.root);
      await writeLocalModels(repository.root, DRIFTED);
      const adapters = new FakeAdapters();
      const runner = new WorkflowRunner(repository.root, adapters);
      const first = await runner.start({ slug: "first", request: "Plan it." });
      assert.equal(
        first.status,
        "needs_plan_approval",
        first.blockReason ?? ""
      );
      assert.equal((await runner.cancel()).outcome, "cancelled");
      await writeFile(path.join(repository.root, ".git/info/exclude"), "");
      const calls = modelCalls(adapters);
      await assert.rejects(
        runner.start({ slug: "second", request: "Plan it." }),
        isNotIgnored
      );
      assert.deepEqual(modelCalls(adapters), calls);
    });
  } finally {
    await repository.dispose();
  }
});

test("retry with a terminal prints the change, records it and runs with the new triple", async () => {
  const repository = await createTestRepository({ ignoreLocalConfig: true });
  try {
    await withVendorExecutablesOnPath(async () => {
      const output = infoLines();
      const { adapters, runner, blocked } = await failedPlanning(
        repository.root,
        output.reporter
      );
      const reviewers = reviewTriples(adapters);
      assert.deepEqual(await recordedLayer(runner, blocked.runId), {});
      await writeLocalModels(repository.root, LOCAL_REVIEWER);
      const events = await runEvents(runner, blocked.runId);
      const gate = await runner.retry({ terminal: true });
      assert.equal(gate.status, "needs_plan_approval", gate.blockReason ?? "");
      assert.deepEqual(printedRecording(output.lines), [
        RECORDING_HEADING,
        "  Review: recorded shared, now claude claude-opus-5-5 xhigh"
      ]);
      assert.deepEqual(await recordedLayer(runner, gate.runId), LOCAL_REVIEWER);
      // Recorded before the retry's first transition, with sources only.
      const added = (await runEvents(runner, gate.runId)).slice(events.length);
      assert.deepEqual(
        added.slice(0, 2).map((event) => event.type),
        ["model_override.recorded", "attempt.retry_requested"]
      );
      assert.deepEqual(added[0]?.details, REVIEWER_RECORDED);
      assert.doesNotMatch(
        JSON.stringify(added[0]),
        /claude-opus-5-5|xhigh|claude"/u
      );
      const done = await runner.approvePlan("human");
      assert.equal(done.status, "done", done.blockReason ?? "");
      assert.deepEqual(reviewers, [LOCAL_REVIEWER.reviewer]);
    });
  } finally {
    await repository.dispose();
  }
});

test("retry without a terminal after a model attempt refuses a changed layer and writes nothing", async () => {
  const repository = await createTestRepository({ ignoreLocalConfig: true });
  try {
    const output = infoLines();
    const { adapters, runner, blocked } = await failedPlanning(
      repository.root,
      output.reporter
    );
    await writeLocalModels(repository.root, LOCAL_REVIEWER);
    const before = await banzaiBytes(repository.root);
    const calls = modelCalls(adapters);
    for (const options of [undefined, { terminal: false }])
      await assert.rejects(
        runner.retry(options),
        changedFrom({}, LOCAL_REVIEWER)
      );
    assert.deepEqual(await banzaiBytes(repository.root), before);
    assert.deepEqual(modelCalls(adapters), calls);
    assert.deepEqual(printedRecording(output.lines), []);

    // An unchanged layer needs no terminal and records nothing.
    await rm(path.join(repository.root, LOCAL_CONFIG_IGNORE_LINE));
    const gate = await runner.retry();
    assert.equal(gate.status, "needs_plan_approval", gate.blockReason ?? "");
    assert.deepEqual(await recordedLayer(runner, blocked.runId), {});
    assert.ok(
      (await runEvents(runner, blocked.runId)).every(
        (event) => event.type !== "model_override.recorded"
      )
    );
  } finally {
    await repository.dispose();
  }
});

test("a run blocked from created records without a terminal after its startup checks pass", async () => {
  const repository = await createTestRepository({ ignoreLocalConfig: true });
  try {
    await withVendorExecutablesOnPath(async () => {
      const output = infoLines();
      const { adapters, runner, blocked } = await blockedAtStartup(
        repository.root,
        output.reporter
      );
      const reviewers = reviewTriples(adapters);
      await writeLocalModels(repository.root, LOCAL_REVIEWER);
      // The startup checks fail again: the failure is recorded, the layer is
      // not.
      adapters.claudePreflightErrors.push(
        new BanzaiError("CLAUDE_AUTH_REQUIRED", "Sign in to Claude again.")
      );
      const failed = await runner.retry();
      assert.equal(failed.status, "blocked");
      assert.equal(failed.blockedFrom, "created");
      assert.match(failed.blockReason ?? "", /Sign in to Claude again/u);
      assert.deepEqual(await recordedLayer(runner, blocked.runId), {});
      const events = await runEvents(runner, blocked.runId);
      assert.ok(
        events.every((event) => event.type !== "model_override.recorded")
      );
      assert.deepEqual(printedRecording(output.lines), []);

      const gate = await runner.retry();
      assert.equal(gate.status, "needs_plan_approval", gate.blockReason ?? "");
      assert.deepEqual(printedRecording(output.lines), [
        RECORDING_HEADING,
        ...changeLines({}, LOCAL_REVIEWER)
      ]);
      assert.deepEqual(
        await recordedLayer(runner, blocked.runId),
        LOCAL_REVIEWER
      );
      const added = (await runEvents(runner, blocked.runId)).slice(
        events.length
      );
      assert.deepEqual(
        added.slice(0, 2).map((event) => event.type),
        ["model_override.recorded", "run.start_retry_requested"]
      );
      const done = await runner.approvePlan("human");
      assert.equal(done.status, "done", done.blockReason ?? "");
      assert.deepEqual(reviewers, [LOCAL_REVIEWER.reviewer]);
    });
  } finally {
    await repository.dispose();
  }
});

test("a reconcile of a saved planning result records the layer before approval", async () => {
  const repository = await createTestRepository({ ignoreLocalConfig: true });
  try {
    await withVendorExecutablesOnPath(async () => {
      const output = infoLines();
      const adapters = new SavedPlanningAdapters();
      adapters.reviewResults.push(passingReview());
      const reviewers = reviewTriples(adapters);
      const runner = new WorkflowRunner(
        repository.root,
        adapters,
        undefined,
        output.reporter
      );
      const blocked = await runner.start({
        slug: "example",
        request: "Implement it."
      });
      assert.equal(blocked.status, "blocked");
      await writeLocalModels(repository.root, LOCAL_REVIEWER);
      const before = await runBytes(repository.root);
      await assert.rejects(runner.retry(), changedFrom({}, LOCAL_REVIEWER));
      assert.deepEqual(await runBytes(repository.root), before);

      const events = await runEvents(runner, blocked.runId);
      const gate = await runner.retry({ terminal: true });
      assert.equal(gate.status, "needs_plan_approval", gate.blockReason ?? "");
      // The saved result was applied; no planner ran again.
      assert.equal(adapters.planTriples.length, 1);
      assert.deepEqual(printedRecording(output.lines), [
        RECORDING_HEADING,
        ...changeLines({}, LOCAL_REVIEWER)
      ]);
      assert.ok(
        output.lines.indexOf(RECORDING_HEADING) <
          output.lines.indexOf(
            "Reconciling the saved planning terminal result before retry"
          )
      );
      const added = (await runEvents(runner, blocked.runId)).slice(
        events.length
      );
      assert.equal(added[0]?.type, "model_override.recorded");
      assert.ok(added.length > 1, JSON.stringify(added));
      assert.deepEqual(
        await recordedLayer(runner, blocked.runId),
        LOCAL_REVIEWER
      );
      const done = await runner.approvePlan("human");
      assert.equal(done.status, "done", done.blockReason ?? "");
      assert.deepEqual(reviewers, [LOCAL_REVIEWER.reviewer]);
    });
  } finally {
    await repository.dispose();
  }
});

test("a retry preflight failure leaves the record, except the layer a reconcile recorded", async (t) => {
  await t.test("without a reconcile", async () => {
    const repository = await createTestRepository({ ignoreLocalConfig: true });
    try {
      await withVendorExecutablesOnPath(async () => {
        const output = infoLines();
        const { adapters, runner } = await failedPlanning(
          repository.root,
          output.reporter
        );
        await writeLocalModels(repository.root, LOCAL_REVIEWER);
        adapters.claudePreflightErrors.push(
          new BanzaiError("CLAUDE_AUTH_REQUIRED", "Sign in to Claude.")
        );
        const before = await runBytes(repository.root);
        await assert.rejects(runner.retry({ terminal: true }), {
          code: "CLAUDE_AUTH_REQUIRED"
        });
        assert.deepEqual(await runBytes(repository.root), before);
        assert.deepEqual(printedRecording(output.lines), []);
      });
    } finally {
      await repository.dispose();
    }
  });

  await t.test("after a reconcile", async () => {
    const repository = await createTestRepository({ ignoreLocalConfig: true });
    try {
      await withVendorExecutablesOnPath(async () => {
        const output = infoLines();
        const adapters = new SavedPlanningAdapters();
        const runner = new WorkflowRunner(
          repository.root,
          adapters,
          undefined,
          output.reporter
        );
        const blocked = await runner.start({
          slug: "example",
          request: "Plan it."
        });
        assert.equal(blocked.status, "blocked");
        // The local planner no longer matches the saved checkpoint, so the
        // reconcile rejects it and the retry goes on to a fresh attempt,
        // whose preflight fails.
        await writeLocalModels(repository.root, LOCAL_PLANNER);
        adapters.onCodexPreflight = () => {
          adapters.onCodexPreflight = null;
          return Promise.reject(
            new BanzaiError("CODEX_AUTH_REQUIRED", "Sign in to Codex.")
          );
        };
        await assert.rejects(runner.retry({ terminal: true }), {
          code: "CODEX_AUTH_REQUIRED"
        });
        const saved = (await runner.status()).state;
        assert.match(
          saved.blockReason ?? "",
          /^\[INVALID_TERMINAL_CHECKPOINT\]/u
        );
        assert.deepEqual(
          await recordedLayer(runner, blocked.runId),
          LOCAL_PLANNER
        );
        assert.deepEqual(printedRecording(output.lines), [
          RECORDING_HEADING,
          ...changeLines({}, LOCAL_PLANNER)
        ]);
        assert.equal(adapters.planTriples.length, 1);

        // The layer is now the recorded one, so retry needs no terminal.
        const gate = await runner.retry();
        assert.equal(
          gate.status,
          "needs_plan_approval",
          gate.blockReason ?? ""
        );
        assert.equal(adapters.planTriples.length, 2);
        assert.notDeepEqual(adapters.planTriples[0], LOCAL_PLANNER.planner);
        assert.deepEqual(adapters.planTriples[1], LOCAL_PLANNER.planner);
        assert.equal(
          (await runEvents(runner, blocked.runId)).filter(
            (event) => event.type === "model_override.recorded"
          ).length,
          1
        );
      });
    } finally {
      await repository.dispose();
    }
  });
});

test("edits between the retry locks refuse without recording", async (t) => {
  await t.test("local file edited during preflight", async () => {
    const repository = await createTestRepository({ ignoreLocalConfig: true });
    try {
      await withVendorExecutablesOnPath(async () => {
        const output = infoLines();
        const { adapters, runner } = await failedPlanning(
          repository.root,
          output.reporter
        );
        await writeLocalModels(repository.root, LOCAL_REVIEWER);
        adapters.onClaudePreflight = async () => {
          adapters.onClaudePreflight = null;
          await writeLocalModels(repository.root, DRIFTED);
        };
        const before = await runBytes(repository.root);
        await assert.rejects(
          runner.retry({ terminal: true }),
          changedFrom(LOCAL_REVIEWER, DRIFTED)
        );
        assert.deepEqual(await runBytes(repository.root), before);
        assert.deepEqual(printedRecording(output.lines), []);
      });
    } finally {
      await repository.dispose();
    }
  });

  await t.test("run record rewritten during preflight", async () => {
    const repository = await createTestRepository({ ignoreLocalConfig: true });
    try {
      await withVendorExecutablesOnPath(async () => {
        const { adapters, runner, blocked } = await failedPlanning(
          repository.root
        );
        await writeLocalModels(repository.root, LOCAL_REVIEWER);
        adapters.onClaudePreflight = async () => {
          adapters.onClaudePreflight = null;
          await runner.store.replaceModelOverrideRecord(blocked.runId, DRIFTED);
        };
        const events = await runEvents(runner, blocked.runId);
        await assert.rejects(runner.retry({ terminal: true }), (error) => {
          assert.ok(error instanceof LocalModelOverrideRefusalError);
          assert.equal(error.code, "LOCAL_MODEL_OVERRIDE_CHANGED");
          assert.match(
            error.message,
            new RegExp(
              `\\.banzai/runs/${blocked.runId}/model-override\\.json: rewritten after this command read it`
            )
          );
          return true;
        });
        assert.deepEqual(await runEvents(runner, blocked.runId), events);
        assert.deepEqual(await recordedLayer(runner, blocked.runId), DRIFTED);
        const saved = (await runner.status()).state;
        assert.equal(saved.blockReason, blocked.blockReason);
      });
    } finally {
      await repository.dispose();
    }
  });

  await t.test(
    "local file edited before a startup failure is recorded",
    async () => {
      const repository = await createTestRepository({
        ignoreLocalConfig: true
      });
      try {
        await withVendorExecutablesOnPath(async () => {
          const { adapters, runner, blocked } = await blockedAtStartup(
            repository.root
          );
          await writeLocalModels(repository.root, LOCAL_REVIEWER);
          adapters.onClaudePreflight = async () => {
            adapters.onClaudePreflight = null;
            await writeLocalModels(repository.root, DRIFTED);
            throw new BanzaiError("CLAUDE_AUTH_REQUIRED", "Sign in to Claude.");
          };
          const before = await runBytes(repository.root);
          await assert.rejects(
            runner.retry(),
            changedFrom(LOCAL_REVIEWER, DRIFTED)
          );
          assert.deepEqual(await runBytes(repository.root), before);
          const saved = (await runner.status()).state;
          assert.equal(saved.blockReason, blocked.blockReason);
        });
      } finally {
        await repository.dispose();
      }
    }
  );
});

test("a planning-review retry reads, checks and records under its single lock", async () => {
  const repository = await createTestRepository({ ignoreLocalConfig: true });
  try {
    await withVendorExecutablesOnPath(async () => {
      const output = infoLines();
      const adapters = new FakeAdapters();
      adapters.reviewResults.push(passingReview());
      const runner = new WorkflowRunner(
        repository.root,
        adapters,
        undefined,
        output.reporter
      );
      await runner.start({ slug: "example", request: "Plan it." });
      const requested = await runner.requestPlanningReview({
        paths: null,
        decidedBy: "owner",
        autoResume: false
      });
      const episode = requiredFixture(requested.planningReview?.active);
      const result = {
        ...planningReviewResult(1, episode.reviewNumber),
        scope: episode.scope
      };
      adapters.planningReviewResults.push(result);
      adapters.planningAnalysisResults.push(planningReviewAnalysis(result));
      adapters.planningAnalysisErrors.push(
        new Error("Interrupted analysis after session announcement")
      );
      const blocked = await runner.resume();
      assert.equal(blocked.status, "blocked", blocked.blockReason ?? "");
      assert.equal(blocked.activeAttempt?.kind, "planning_analysis");
      adapters.planningAnalysisResults.push(planningReviewAnalysis(result));

      await writeLocalModels(repository.root, LOCAL_PLANNER);
      const before = await runBytes(repository.root);
      const calls = modelCalls(adapters);
      await assert.rejects(runner.retry(), changedFrom({}, LOCAL_PLANNER));
      assert.deepEqual(await runBytes(repository.root), before);
      assert.deepEqual(modelCalls(adapters), calls);

      const events = await runEvents(runner, blocked.runId);
      const triage = await runner.retry({ terminal: true });
      assert.equal(
        triage.pendingHumanDecision?.kind,
        "planning_review_triage",
        triage.blockReason ?? ""
      );
      assert.deepEqual(printedRecording(output.lines), [
        RECORDING_HEADING,
        ...changeLines({}, LOCAL_PLANNER)
      ]);
      assert.deepEqual(
        await recordedLayer(runner, blocked.runId),
        LOCAL_PLANNER
      );
      const added = (await runEvents(runner, blocked.runId)).slice(
        events.length
      );
      assert.equal(added[0]?.type, "model_override.recorded");
      assert.deepEqual(added[0].details, {
        sources: {
          planner: "local",
          implementer: "committed",
          reviewer: "committed"
        }
      });
      assert.deepEqual(
        triple(requiredFixture(adapters.planningRequests.at(-1)).settings),
        LOCAL_PLANNER.planner
      );
    });
  } finally {
    await repository.dispose();
  }
});

test("a legacy run without a record gains one on its first recording", async () => {
  const repository = await createTestRepository({ ignoreLocalConfig: true });
  try {
    await withVendorExecutablesOnPath(async () => {
      const output = infoLines();
      const { runner, blocked } = await failedPlanning(
        repository.root,
        output.reporter
      );
      await rm(
        path.join(
          runner.store.runDirectory(blocked.runId),
          "model-override.json"
        )
      );
      assert.equal(await recordedLayer(runner, blocked.runId), "absent");
      await writeLocalModels(repository.root, LOCAL_REVIEWER);
      const gate = await runner.retry({ terminal: true });
      assert.equal(gate.status, "needs_plan_approval", gate.blockReason ?? "");
      assert.deepEqual(printedRecording(output.lines), [
        RECORDING_HEADING,
        "  Review: recorded shared, now claude claude-opus-5-5 xhigh"
      ]);
      assert.deepEqual(
        await recordedLayer(runner, blocked.runId),
        LOCAL_REVIEWER
      );
    });
  } finally {
    await repository.dispose();
  }
});

test("resume of a run with no model attempt records the current layer", async (t) => {
  const cases = {
    // A pass-through error stands in for a crash during the startup checks:
    // the run keeps its directory, its record and its `created` state.
    "created, after a crash during the startup checks": {
      left: "created",
      during: async (root: string) => {
        await writeLocalModels(root, LOCAL_REVIEWER);
        throw new ProjectSetupRequiredError("Simulated crash.");
      },
      refusal: { code: "PROJECT_SETUP_REQUIRED" } as object
    },
    "selecting, after the selection check point refused": {
      left: "selecting",
      during: async (root: string) => {
        await writeLocalModels(root, LOCAL_REVIEWER);
      },
      refusal: changedFrom({}, LOCAL_REVIEWER) as object
    }
  } as const;
  for (const [name, { left, during, refusal }] of Object.entries(cases))
    await t.test(name, async () => {
      const repository = await createTestRepository({
        ignoreLocalConfig: true
      });
      try {
        await withVendorExecutablesOnPath(async () => {
          const output = infoLines();
          const adapters = new FakeAdapters();
          adapters.reviewResults.push(passingReview());
          const reviewers = reviewTriples(adapters);
          adapters.onCodexPreflight = async () => {
            adapters.onCodexPreflight = null;
            await during(repository.root);
          };
          const runner = new WorkflowRunner(
            repository.root,
            adapters,
            undefined,
            output.reporter
          );
          await assert.rejects(
            runner.start({ slug: "example", request: "Implement it." }),
            refusal
          );
          const state = await runner.store.requireActiveState();
          assert.equal(state.status, left);
          assert.deepEqual(await runner.store.readRunAttempts(state.runId), []);
          assert.deepEqual(await recordedLayer(runner, state.runId), {});
          const events = await runEvents(runner, state.runId);

          const gate = await runner.resume();
          assert.equal(
            gate.status,
            "needs_plan_approval",
            gate.blockReason ?? ""
          );
          assert.deepEqual(printedRecording(output.lines), [
            RECORDING_HEADING,
            ...changeLines({}, LOCAL_REVIEWER)
          ]);
          assert.deepEqual(
            await recordedLayer(runner, state.runId),
            LOCAL_REVIEWER
          );
          const added = (await runEvents(runner, state.runId)).slice(
            events.length
          );
          assert.equal(added[0]?.type, "model_override.recorded");
          assert.deepEqual(added[0].details, REVIEWER_RECORDED);
          const done = await runner.approvePlan("human");
          assert.equal(done.status, "done", done.blockReason ?? "");
          assert.deepEqual(reviewers, [LOCAL_REVIEWER.reviewer]);
        });
      } finally {
        await repository.dispose();
      }
    });
});

/**
 * A profile-mode run (ADR-0060 reading 23): run state 7 with configuration
 * setup and the binding v2 such a run persisted, waiting at a configuration
 * prerequisite after its implementation, with a recorded local reviewer.
 */
async function profilePrerequisite(root: string) {
  await writeLocalModels(root, LOCAL_REVIEWER);
  const f = await planGate(root);
  assert.deepEqual(await recordedLayer(f.runner, f.gate.runId), LOCAL_REVIEWER);
  const state = await f.runner.store.requireActiveState();
  const binding = requiredFixture(state.artifactBinding).binding;
  const workId = "33333333-3333-4333-8333-333333333333";
  const continuation = {
    attemptId: "implementation-1-profile",
    attemptKind: "implementation",
    verificationRound: {
      id: "verification-round-implementation-1-profile",
      ordinal: 1
    },
    baseCommit: state.baseCommit,
    workId,
    workBindingSha256: "c".repeat(64),
    approvalDigest: "e".repeat(64),
    workflowSelectionDigest: null
  };
  const decisionId = "11111111-1111-4111-8111-111111111111";
  const proposalId = "22222222-2222-4222-8222-222222222222";
  const legacy = state as unknown as Record<string, unknown>;
  legacy.schemaVersion = 7;
  delete legacy.planningReview;
  delete legacy.taskVerification;
  legacy.verificationMode = "policy";
  legacy.artifactBinding = historicalBindingFixture({
    workId,
    slug: binding.slug,
    createdAt: binding.createdAt,
    sourceCommit: binding.sourceCommit
  });
  legacy.status = "needs_human_decision";
  legacy.configurationSetup = {
    configSchemaVersion: 3,
    configurationDigest: "f".repeat(64),
    coverage: "configured",
    projectTypes: ["node"],
    uncoveredTypes: ["node"],
    continuation,
    resolutions: [],
    skip: null,
    transactions: []
  };
  legacy.pendingHumanDecision = {
    schema: "banzai-configuration-prerequisite/v1",
    schemaVersion: 1,
    kind: "configuration_prerequisite",
    runId: state.runId,
    decisionId,
    proposalId,
    requestedAt: "2026-09-14T12:00:00.000Z",
    reason: "missing_profile",
    proposal: {
      projectType: "node",
      profile: {
        id: "node",
        commands: [
          {
            id: "tests",
            name: "tests",
            command: "npm",
            args: ["run", "test"],
            timeoutMs: 1000
          }
        ]
      },
      source: {
        kind: "project_scripts",
        path: "package.json",
        packageManager: "npm",
        scriptNames: ["test"]
      }
    },
    options: CONFIGURATION_ACTIONS,
    configSha256: "b".repeat(64),
    sourceSha256: "a".repeat(64),
    continuation
  };
  await writeFile(
    f.runner.store.statePath(state.runId),
    JSON.stringify(state, null, 2),
    "utf8"
  );
  const waiting = await f.runner.store.requireActiveState();
  assert.equal(waiting.schemaVersion, 7);
  assert.equal(
    waiting.pendingHumanDecision?.kind,
    "configuration_prerequisite"
  );
  return {
    ...f,
    answer: {
      runId: state.runId,
      decisionId,
      proposalId,
      action: "accept" as const,
      decidedBy: "human"
    }
  };
}

test("a profile-mode run at a configuration prerequisite compares its record on resume", async () => {
  const repository = await createTestRepository({ ignoreLocalConfig: true });
  try {
    const f = await profilePrerequisite(repository.root);
    const calls = modelCalls(f.adapters);
    // Persisted work bound before binding v3 cannot resume execution, and
    // every route into the prerequisite (resume, an answer, banzai verify)
    // checks the bound work first. So the prerequisite is never satisfied
    // and no review starts; with recorded models resume reaches that check.
    const historical = {
      code: "ARTIFACT_VERSION_UNSUPPORTED",
      message: /^Historical work can be inspected but cannot resume execution/u
    };
    const recorded = await banzaiBytes(repository.root);
    await assert.rejects(f.runner.resume(), historical);
    await assert.rejects(
      f.runner.answerConfigurationPrerequisite(f.answer, false),
      historical
    );
    assert.deepEqual(await banzaiBytes(repository.root), recorded);

    // A changed local layer refuses at resume entry, before the bound work
    // is read. An answer refuses at its bound-work check, which comes first.
    await writeLocalModels(repository.root, DRIFTED);
    const drifted = await banzaiBytes(repository.root);
    await assert.rejects(
      f.runner.resume(),
      changedFrom(LOCAL_REVIEWER, DRIFTED)
    );
    await assert.rejects(
      f.runner.answerConfigurationPrerequisite(f.answer, false),
      historical
    );
    assert.deepEqual(await banzaiBytes(repository.root), drifted);
    assert.deepEqual(
      await recordedLayer(f.runner, f.gate.runId),
      LOCAL_REVIEWER
    );
    assert.deepEqual(modelCalls(f.adapters), calls);
  } finally {
    await repository.dispose();
  }
});

/** What `status --json` and `banzai control status` print for the run. */
async function machineStatus(runner: WorkflowRunner) {
  const agent: string[] = [];
  await executeAgentControlCommand(
    { command: "status" },
    () => runner,
    {
      stdin: Readable.from([]),
      stdout: (value) => agent.push(value)
    },
    "human"
  );
  return {
    json: JSON.stringify(await runner.status(), null, 2),
    agent: agent.join("")
  };
}

async function committedModels(
  root: string
): Promise<OrchestratorConfig["models"]> {
  return (
    JSON.parse(
      await readFile(path.join(root, ".banzai/config.json"), "utf8")
    ) as OrchestratorConfig
  ).models;
}

function roleLine(
  label: string,
  triple: { executable: string; model: string; effort: string },
  source: "committed" | "local"
): string {
  return `  ${label}: ${triple.executable} ${triple.model} ${triple.effort} (${source})`;
}

test("status shows the run's models and drift to a human while status JSON and agent status stay unchanged", async () => {
  const repository = await createTestRepository({ ignoreLocalConfig: true });
  try {
    await withVendorExecutablesOnPath(async () => {
      await writeLocalModels(repository.root, LOCAL_REVIEWER);
      const { runner, blocked } = await failedPlanning(repository.root);
      const status = await runner.status();
      assert.equal(status.nextAction, "banzai retry");
      assert.equal(status.retry.eligible, true);
      const machine = await machineStatus(runner);
      const committed = await committedModels(repository.root);
      const runLines = [
        "Models:",
        roleLine("Planning", committed.planner, "committed"),
        roleLine("Implementation", committed.implementer, "committed"),
        "  Review: claude claude-opus-5-5 xhigh (local)"
      ];
      const observe = async () => {
        const models = await runner.modelStatus(status.state);
        assert.deepEqual(await machineStatus(runner), machine);
        return models;
      };
      const localFile = path.join(repository.root, LOCAL_CONFIG_IGNORE_LINE);

      // The recorded layer, unchanged.
      let models = await observe();
      assert.equal(models.state, "recorded");
      assert.deepEqual(modelStatusLines(models), runLines);
      assert.equal(humanStatusView(status, models), status);

      // A changed layer: the run's models stay, the drift lines follow.
      await writeLocalModels(repository.root, DRIFTED);
      models = await observe();
      assert.deepEqual(modelStatusLines(models), [
        ...runLines,
        "Local models changed since this run recorded them",
        "  Review: recorded claude claude-opus-5-5 xhigh, now codex gpt-6.1-sol high",
        LOCAL_MODEL_DRIFT_ADVICE
      ]);
      assert.ok(models.state === "recorded");
      assert.deepEqual(models.current?.reviewer, {
        executable: "codex",
        model: "gpt-6.1-sol",
        effort: "high",
        source: "local"
      });
      assert.equal(humanStatusView(status, models), status);

      // An invalid local file is one drift line; status never fails.
      await writeFile(localFile, "{ not json\n");
      models = await observe();
      assert.ok(models.state === "recorded");
      assert.equal(models.current, null);
      const invalid = modelStatusLines(models);
      assert.deepEqual(invalid.slice(0, runLines.length + 1), [
        ...runLines,
        "Local models changed since this run recorded them"
      ]);
      assert.match(
        invalid[runLines.length + 1] ?? "",
        /^ {2}\.banzai\/config\.local\.json: invalid \(.*\)$/u
      );
      assert.deepEqual(invalid.slice(runLines.length + 2), [
        LOCAL_MODEL_DRIFT_ADVICE
      ]);

      // A tracked local file names its cause.
      await writeLocalModels(repository.root, LOCAL_REVIEWER);
      await execFileAsync("git", ["add", "--force", LOCAL_CONFIG_IGNORE_LINE], {
        cwd: repository.root
      });
      models = await observe();
      assert.deepEqual(modelStatusLines(models), [
        ...runLines,
        "Local models changed since this run recorded them",
        "  .banzai/config.local.json: tracked",
        LOCAL_MODEL_DRIFT_ADVICE
      ]);
      await execFileAsync(
        "git",
        ["rm", "--cached", "--quiet", LOCAL_CONFIG_IGNORE_LINE],
        { cwd: repository.root }
      );

      // A defective record: human output alone turns to cancel (reading 11).
      const recordPath = `.banzai/runs/${blocked.runId}/model-override.json`;
      await writeFile(path.join(repository.root, recordPath), "not a record\n");
      models = await observe();
      assert.deepEqual(models, {
        scope: "run",
        state: "record_invalid",
        runId: blocked.runId,
        recordPath
      });
      assert.deepEqual(modelStatusLines(models), [
        "Models:",
        `  ${recordPath}: invalid`,
        "The models this run recorded cannot be confirmed. Run banzai cancel to end this run."
      ]);
      const view = humanStatusView(status, models);
      assert.equal(view.nextAction, "banzai cancel");
      assert.equal(view.retry.eligible, false);
      assert.equal(view.recovery.eligible, false);
      for (const reason of [view.retry.reason, view.recovery.reason])
        assert.ok(reason.startsWith(`${recordPath} is invalid`), reason);
      assert.throws(
        () => requireRecoverable(view),
        (error) => {
          assert.ok(error instanceof BanzaiError);
          assert.equal(error.code, "RECOVERY_NOT_ALLOWED");
          assert.ok(error.message.includes(recordPath), error.message);
          return true;
        }
      );
      assert.equal(status.nextAction, "banzai retry");
    });
  } finally {
    await repository.dispose();
  }
});

test("a done or cancelled run shows the current models without drift lines", async (t) => {
  for (const end of ["done", "cancelled"] as const)
    await t.test(end, async () => {
      const repository = await createTestRepository({
        ignoreLocalConfig: true
      });
      try {
        await withVendorExecutablesOnPath(async () => {
          await writeLocalModels(repository.root, LOCAL_REVIEWER);
          const { runner, gate } = await planGate(repository.root);
          if (end === "done") {
            const done = await runner.approvePlan("human");
            assert.equal(done.status, "done", done.blockReason ?? "");
          } else assert.equal((await runner.cancel()).outcome, "cancelled");
          const status = await runner.status();
          assert.equal(status.state.status, end);
          const machine = await machineStatus(runner);
          const committed = await committedModels(repository.root);
          const committedLines = [
            roleLine("Planning", committed.planner, "committed"),
            roleLine("Implementation", committed.implementer, "committed")
          ];
          const observe = async () => {
            const models = await runner.modelStatus(status.state);
            assert.deepEqual(await machineStatus(runner), machine);
            assert.equal(humanStatusView(status, models), status);
            return modelStatusLines(models);
          };

          await writeLocalModels(repository.root, DRIFTED);
          assert.deepEqual(await observe(), [
            "Current models:",
            ...committedLines,
            "  Review: codex gpt-6.1-sol high (local)"
          ]);
          await writeFile(
            path.join(repository.root, LOCAL_CONFIG_IGNORE_LINE),
            "{ not json\n"
          );
          const invalid = await observe();
          assert.equal(invalid.length, 2);
          assert.equal(invalid[0], "Current models:");
          assert.match(
            invalid[1] ?? "",
            /^ {2}\.banzai\/config\.local\.json: invalid \(.*\)$/u
          );
          // A finished run's record is not read.
          await writeFile(
            path.join(
              runner.store.runDirectory(gate.runId),
              "model-override.json"
            ),
            "not a record\n"
          );
          await rm(path.join(repository.root, LOCAL_CONFIG_IGNORE_LINE));
          assert.deepEqual(await observe(), [
            "Current models:",
            ...committedLines,
            roleLine("Review", committed.reviewer, "committed")
          ]);
        });
      } finally {
        await repository.dispose();
      }
    });
});

test("model status outside a run shows the current models and an unreadable committed file", async () => {
  const repository = await createTestRepository({ ignoreLocalConfig: true });
  try {
    await writeLocalModels(repository.root, LOCAL_REVIEWER);
    const runner = new WorkflowRunner(repository.root, new FakeAdapters());
    const committed = await committedModels(repository.root);
    assert.deepEqual(modelStatusLines(await runner.modelStatus(null)), [
      "Current models:",
      roleLine("Planning", committed.planner, "committed"),
      roleLine("Implementation", committed.implementer, "committed"),
      "  Review: claude claude-opus-5-5 xhigh (local)"
    ]);
    await rm(path.join(repository.root, ".banzai/config.json"));
    const unavailable = await runner.modelStatus(null);
    assert.deepEqual(unavailable, {
      scope: "current",
      state: "unavailable",
      code: "CONFIG_NOT_FOUND"
    });
    assert.deepEqual(modelStatusLines(unavailable), [
      "Current models: unavailable (CONFIG_NOT_FOUND)"
    ]);
    assert.deepEqual(
      modelStatusLines({
        scope: "run",
        state: "unavailable",
        code: "CONFIG_INVALID"
      }),
      ["Models: unavailable (CONFIG_INVALID)"]
    );
  } finally {
    await repository.dispose();
  }
});

test("model status lines escape every model value", () => {
  const role = {
    executable: "codex",
    model: "gpt\u001b[31m\nnext\tcolumn",
    effort: "high",
    source: "committed"
  } as const;
  const lines = modelStatusLines({
    scope: "current",
    state: "effective",
    current: { planner: role, implementer: role, reviewer: role }
  });
  assert.equal(lines.length, 4);
  for (const line of lines) assert.doesNotMatch(line, /[\u001b\n\t]/u);
  assert.equal(
    lines[1],
    "  Planning: codex gpt\\u001b[31m\\u000anext\\u0009column high (committed)"
  );
});

test("status JSON keeps its top-level keys and carries no local model value", async () => {
  const repository = await createTestRepository({ ignoreLocalConfig: true });
  try {
    await withVendorExecutablesOnPath(async () => {
      const canary = "claude-local-canary-5";
      await writeLocalModels(repository.root, {
        reviewer: { executable: "claude", model: canary, effort: "high" }
      });
      const { runner, gate } = await planGate(repository.root);
      const record = await readFile(
        path.join(runner.store.runDirectory(gate.runId), "model-override.json"),
        "utf8"
      );
      assert.match(record, new RegExp(canary));
      const json = JSON.stringify(await runner.status(), null, 2);
      assert.deepEqual(Object.keys(JSON.parse(json) as object), [
        "state",
        "planningReview",
        "planApprovalValid",
        "reviewValid",
        "latestReview",
        "retry",
        "recovery",
        "nextAction",
        "taskCompletion",
        "completionPublication"
      ]);
      assert.doesNotMatch(json, new RegExp(canary));
    });
  } finally {
    await repository.dispose();
  }
});

test("workflow.ts imports only layer helpers from local-config.ts, never loadConfig", async () => {
  const source = await readFile(
    path.join(PACKAGE_ROOT, "src/workflow.ts"),
    "utf8"
  );
  const imports = [
    ...source.matchAll(
      /import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*"\.\/local-config\.js"/gu
    )
  ];
  assert.equal(imports.length, 1);
  const bindings = requiredFixture(imports[0]?.[1])
    .split(",")
    .map((binding) => binding.trim().replace(/^type\s+/u, ""))
    .filter((binding) => binding.length > 0)
    .map((binding) => binding.split(/\s+as\s+/u)[0]);
  assert.ok(bindings.length > 0);
  assert.ok(!bindings.includes("loadConfig"), bindings.join(", "));
  assert.ok(!bindings.includes("loadEffectiveConfig"), bindings.join(", "));
  assert.doesNotMatch(source, /\bloadConfig\s*\(/u);
  assert.match(
    source,
    /import\s*\{[^}]*\bloadCommittedConfig\b[^}]*\}\s*from\s*"\.\/config\.js"/u
  );
});
