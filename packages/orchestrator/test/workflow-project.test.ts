import { requiredFixture } from "./helpers.js";
import { instructionPluginFixture } from "./phase-instruction-fixtures.js";
import { inspectDoctor } from "../src/doctor.js";
import { spawnSync } from "node:child_process";
import {
  acquireWork,
  createWork,
  releaseWork,
  inspectArtifacts
} from "../src/artifact-storage.js";
import { reviewResultSchema } from "../src/contracts.js";
import { collectEvaluationExport } from "../src/evaluation.js";
import { deriveEvaluationKpiReport } from "../src/evaluation-kpi.js";
import { collectContextReport } from "../src/context-report.js";
import { projectAgentControlStatus } from "../src/agent-control.js";
import { resolveCancellation } from "../src/cancellation.js";
import {
  CANCELLATION_LIMITS,
  decodeCancellationEvents,
  readCancellationFile
} from "../src/cancellation-evidence.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { BanzaiError, ProcessExitError } from "../src/errors.js";
import {
  PLAN_TASK_COMPLETION_SCHEMA_VERSION,
  type AdapterResult,
  type OrchestratorConfig,
  type PhaseAdapterRequest,
  type PhaseResult,
  type ReviewResult,
  type RunState,
  type WorkflowSelectionAdapterRequest,
  type WorkflowSelectionResult
} from "../src/types.js";
import { WorkflowRunner } from "../src/workflow.js";
import {
  commitAll,
  createTestRepository,
  monochromeEnv,
  snapshotTree
} from "./helpers.js";
import {
  ADOPTED_AGENTS,
  SOURCE_IDENTITY_FIXTURES,
  writeIdentity
} from "./adoption-fixtures.js";
import {
  FakeAdapters,
  adapterResult,
  authorizedImplementationRecoveryFixture,
  boundFixturePath,
  configureInstructionPlugin,
  decisionConsultationResult,
  finding,
  passingReview,
  phaseResult,
  prerequisiteBlockedFixFixture,
  selectionResult
} from "./workflow-fixtures.js";

const LAYOUT_DIAGNOSTIC =
  "legacy Banzai layout: run `project-manifest` to migrate";

class LayoutStopAdapters extends FakeAdapters {
  stopPhase: PhaseResult["phase"] | null = null;
  override async runPhase(
    request: PhaseAdapterRequest
  ): Promise<AdapterResult<PhaseResult>> {
    if (
      this.stopPhase !== null &&
      request.prompt.includes(`Phase: ${this.stopPhase}`)
    ) {
      this.phasePrompts.push(request.prompt);
      this.phaseResumeSessionIds.push(request.resumeSessionId);
      const reportPath = path.relative(
        request.repoRoot,
        await boundFixturePath(
          request.repoRoot,
          "documentation/features/example/implementation-report.md"
        )
      );
      const strictImplementation =
        this.stopPhase === "implementation" &&
        !request.prompt.includes("Selected workflow:");
      if (strictImplementation) {
        await mkdir(path.dirname(path.join(request.repoRoot, reportPath)), {
          recursive: true
        });
        await writeFile(
          path.join(request.repoRoot, reportPath),
          `# Implementation report\n\n## Layout stop\n\n${LAYOUT_DIAGNOSTIC}\n`,
          "utf8"
        );
      }
      return adapterResult(
        phaseResult(this.stopPhase, {
          outcome: "needs_human_decision",
          gate: "escalation",
          summary: LAYOUT_DIAGNOSTIC,
          questions: [
            "Run project-manifest, approve the migration diff, then answer to replan."
          ],
          artifacts: {
            description: null,
            plan: null,
            adrs: [],
            implementationReport: strictImplementation ? reportPath : null,
            testReport: null
          },
          taskCompletion: strictImplementation
            ? {
                schemaVersion: PLAN_TASK_COMPLETION_SCHEMA_VERSION,
                tasks: [
                  {
                    taskId: "T001",
                    status: "incomplete",
                    evidence: [],
                    gap: {
                      reportPath,
                      section: "Layout stop",
                      detail: "Migration is required before implementation."
                    }
                  }
                ]
              }
            : null
        }),
        "layout-stop-session"
      );
    }
    return await super.runPhase(request);
  }
}

function layoutBlockedReview(): ReviewResult {
  return { ...passingReview(), verdict: "blocked", summary: LAYOUT_DIAGNOSTIC };
}

async function layoutProjectBytes(root: string) {
  return {
    agents: await readFile(path.join(root, "AGENTS.md"), "utf8"),
    claude: await readFile(path.join(root, "CLAUDE.md"), "utf8"),
    source: await snapshotTree(path.join(root, "src"))
  };
}

async function installLayoutFixture(
  root: string,
  fixture: string,
  side: "before" | "after"
): Promise<void> {
  for (const name of ["AGENTS.md", "CLAUDE.md"]) {
    const contents = await readFile(
      path.join(
        process.cwd(),
        "test/fixtures/instruction-layouts",
        fixture,
        side,
        name
      ),
      "utf8"
    );
    await writeFile(path.join(root, name), contents, "utf8");
  }
}

for (const stopPoint of [
  "planning",
  "implementation",
  "fix",
  "review",
  "review-retry",
  "lite"
] as const) {
  test(`skill-reported layout stop at ${stopPoint} continues only through the existing route`, async () => {
    const repository = await createTestRepository();
    try {
      // The runtime starts from adopted files. The fake then reports a
      // skill-level stop observed after preflight; it still grants no repair authority.
      await installLayoutFixture(
        repository.root,
        "approved-migration",
        "after"
      );
      await commitAll(repository.root, "adopted instruction fixture");
      const adapters = new LayoutStopAdapters();
      const runner = new WorkflowRunner(repository.root, adapters);
      let before: Awaited<ReturnType<typeof layoutProjectBytes>>;
      let stopped: RunState;
      if (stopPoint === "planning" || stopPoint === "lite") {
        adapters.stopPhase =
          stopPoint === "planning" ? "plan" : "implementation";
        if (stopPoint === "lite")
          adapters.selectionResults.push(
            selectionResult({ recommendedWorkflow: "feature" })
          );
        before = await layoutProjectBytes(repository.root);
        stopped = await runner.start({
          slug: "example",
          request: "Apply the bounded feature."
        });
      } else {
        await runner.start({
          slug: "example",
          request: "Apply the bounded feature."
        });
        if (stopPoint === "implementation") {
          adapters.stopPhase = "implementation";
          await runner.approvePlan("human", false);
          before = await layoutProjectBytes(repository.root);
          stopped = await runner.resume();
        } else if (stopPoint === "fix") {
          adapters.reviewResults.push({
            ...passingReview(),
            verdict: "changes_requested",
            findings: [finding("R1-F1", "Fixture defect.")]
          });
          await runner.approvePlan("human");
          await runner.triage(
            {
              accepted: ["R1-F1"],
              rejected: [],
              deferred: [],
              note: null,
              decidedBy: "human"
            },
            false
          );
          adapters.stopPhase = "fix";
          before = await layoutProjectBytes(repository.root);
          stopped = await runner.resume();
        } else {
          adapters.reviewResults.push(
            stopPoint === "review-retry"
              ? {
                  ...layoutBlockedReview(),
                  summary: "Initial fixture evidence unavailable."
                }
              : layoutBlockedReview()
          );
          // Implementation is completed before the simulated plugin update.
          // The adapter captures source bytes at the review boundary itself.
          before = await layoutProjectBytes(repository.root);
          adapters.onReview = async () => {
            before = await layoutProjectBytes(repository.root);
          };
          stopped = await runner.approvePlan("human");
          if (stopPoint === "review-retry") {
            adapters.reviewResults.push(layoutBlockedReview());
            stopped = await runner.retry();
          }
        }
      }
      assert.deepEqual(
        await layoutProjectBytes(repository.root),
        before,
        "layout stop changes neither source nor project instructions"
      );
      const statusCommand = spawnSync(
        process.execPath,
        [path.join(process.cwd(), "dist/banzai.mjs"), "status"],
        {
          cwd: repository.root,
          encoding: "utf8",
          env: monochromeEnv()
        }
      );
      assert.equal(statusCommand.status, 0, statusCommand.stderr);
      assert.ok(
        statusCommand.stdout.replace(/\s+/g, " ").includes(LAYOUT_DIAGNOSTIC),
        statusCommand.stdout
      );
      adapters.onReview = null;
      if (stopPoint === "review" || stopPoint === "review-retry") {
        assert.equal(stopped.status, "blocked");
        assert.equal(stopped.blockedFrom, "reviewing");
        const status = await runner.status();
        assert.equal(status.retry.eligible, true);
        assert.ok(status.latestReview);
        assert.deepEqual(status.latestReview.findings, []);
        assert.equal(status.latestReview.summary, LAYOUT_DIAGNOSTIC);
        const approval = stopped.planApproval;
        const triage = stopped.triage;
        adapters.reviewResults.push(layoutBlockedReview());
        const repeated = await runner.retry();
        assert.equal(
          (await runner.status()).latestReview?.summary,
          LAYOUT_DIAGNOSTIC
        );
        assert.equal(repeated.status, "blocked");
        assert.deepEqual(repeated.planApproval, approval);
        assert.deepEqual(repeated.triage, triage);
        assert.deepEqual(await layoutProjectBytes(repository.root), before);
        await installLayoutFixture(
          repository.root,
          "approved-migration",
          "after"
        );
        adapters.reviewResults.push(passingReview());
        const done = await runner.retry();
        assert.equal(done.status, "done", done.blockReason ?? "");
        assert.equal(adapters.reviewResumeSessionIds.at(-1), null);
        assert.equal(
          done.latestReview?.rotationReason,
          "previous-review-blocked"
        );
      } else {
        assert.equal(stopped.status, "needs_human_decision");
        assert.ok(stopped.pendingHumanDecision?.kind === "escalation");
        assert.equal(stopped.pendingHumanDecision.gate, "escalation");
        assert.equal(stopped.pendingHumanDecision.summary, LAYOUT_DIAGNOSTIC);
        const answered = await runner.answerHumanDecision(
          {
            answers: ["Continue under the existing route."],
            decidedBy: "human"
          },
          false
        );
        assert.equal(answered.planApproval, null);
        assert.equal(
          answered.status,
          stopPoint === "lite" ? "selecting" : "planning"
        );
        assert.deepEqual(await layoutProjectBytes(repository.root), before);
        // An answer is not a migration: the next affected phase stops again.
        adapters.stopPhase = "plan";
        const repeated = await runner.resume();
        assert.ok(repeated.pendingHumanDecision?.kind === "escalation");
        assert.equal(repeated.pendingHumanDecision.summary, LAYOUT_DIAGNOSTIC);
        assert.deepEqual(await layoutProjectBytes(repository.root), before);
        await installLayoutFixture(
          repository.root,
          "approved-migration",
          "after"
        );
        adapters.stopPhase = null;
        const replanned = await runner.answerHumanDecision({
          answers: ["The explicit fixture migration is complete; replan."],
          decidedBy: "human"
        });
        assert.equal(replanned.status, "needs_plan_approval");
        assert.equal(replanned.planApproval, null);
      }
    } finally {
      await repository.dispose();
    }
  });
}

test("layout stop after authorized recovery grants no migration authority", async () => {
  const repository = await createTestRepository();
  try {
    await installLayoutFixture(repository.root, "approved-migration", "after");
    await commitAll(repository.root, "adopted instruction fixture");
    const adapters = new LayoutStopAdapters();
    adapters.implementationErrors.push(
      new ProcessExitError(
        "CLAUDE_PHASE_FAILED",
        "Fixture transport interruption.",
        {
          exitCode: 1,
          signal: null,
          stdout: "",
          stderr: "",
          startedAt: "2026-01-01T00:00:00.000Z",
          completedAt: "2026-01-01T00:01:00.000Z"
        },
        { failureCause: "transport" }
      )
    );
    const runner = new WorkflowRunner(repository.root, adapters);
    await runner.start({
      slug: "example",
      request: "Recover the bounded feature."
    });
    const blocked = await runner.approvePlan("human");
    const status = await runner.status();
    assert.ok(blocked.activeAttempt && status.recovery.recoveryIdentity);
    assert.equal(status.recovery.eligible, true, status.recovery.reason);
    const before = await layoutProjectBytes(repository.root);
    adapters.stopPhase = "implementation";
    const stopped = await runner.recover({
      attemptId: blocked.activeAttempt.id,
      recoveryIdentity: status.recovery.recoveryIdentity,
      unknownSideEffectsAccepted: true,
      decidedBy: "human"
    });
    assert.equal(stopped.status, "needs_human_decision");
    assert.ok(stopped.pendingHumanDecision?.kind === "escalation");
    assert.equal(stopped.pendingHumanDecision.summary, LAYOUT_DIAGNOSTIC);
    assert.deepEqual(await layoutProjectBytes(repository.root), before);
  } finally {
    await repository.dispose();
  }
});

test("layout review stop stays within the closed review-result v1 schema", () => {
  const blocked = layoutBlockedReview();
  assert.equal(reviewResultSchema.additionalProperties, false);
  const acceptedKeys = Object.keys(reviewResultSchema.properties);
  assert.deepEqual(
    Object.keys(blocked).filter((key) => !acceptedKeys.includes(key)),
    []
  );
  const withGate = { ...blocked, gate: "escalation" };
  assert.deepEqual(
    Object.keys(withGate).filter((key) => !acceptedKeys.includes(key)),
    ["gate"],
    "the closed schema rejects an added gate key"
  );
});

for (const gate of ["escalation", "decision_consultation"] as const) {
  test(`layout cancellation from ${gate} preserves context and allows a new unmigrated run`, async () => {
    const repository = await createTestRepository();
    try {
      const adapters = new FakeAdapters();
      const escalation = phaseResult("plan", {
        gate: "escalation",
        summary: LAYOUT_DIAGNOSTIC,
        questions: ["Run project-manifest to migrate before continuing."]
      });
      const stop =
        gate === "escalation" ? escalation : decisionConsultationResult();
      adapters.planResults.push(
        phaseResult("plan", {
          gate: "escalation",
          questions: ["Should the feature preserve compatibility?"]
        }),
        stop,
        structuredClone(escalation)
      );
      const runner = new WorkflowRunner(repository.root, adapters);
      await runner.start({
        slug: "example",
        request: "Plan the bounded feature."
      });
      const waiting = await runner.answerHumanDecision({
        answers: ["Preserve compatibility."],
        decidedBy: "human"
      });
      assert.equal(waiting.status, "needs_human_decision");
      assert.equal(waiting.pendingHumanDecision?.kind, gate);
      assert.equal(waiting.humanDecisions?.length, 1);
      const cancelled = await runner.cancel();
      assert.equal(cancelled.outcome, "cancelled");
      // No manual state edits: the existing public cancellation route must leave
      // a readable terminal run before a new run can reach its own layout stop.
      const terminal = await runner.status();
      assert.equal(terminal.state.status, "cancelled");
      assert.equal(terminal.state.pendingHumanDecision, null);
      assert.deepEqual(terminal.state.humanDecisions, waiting.humanDecisions);
      const eventPath = `.banzai/runs/${waiting.runId}/events.jsonl`;
      const evidence = decodeCancellationEvents(
        await readCancellationFile(
          repository.root,
          eventPath,
          CANCELLATION_LIMITS.events
        )
      );
      const resolved = resolveCancellation(
        terminal.state,
        waiting.runId,
        evidence.events,
        evidence.availability
      );
      assert.equal(
        resolved.observation?.context.status.value,
        "needs_human_decision"
      );
      assert.equal(resolved.observation.context.gate.value, gate);
      if (gate === "decision_consultation") {
        assert.deepEqual(resolved.observation.context.decision.value, {
          kind: "consultation",
          requestId: "request-1",
          roundId: "round-1",
          relationship: "pending_at_cancel"
        });
      }
      const eventsBeforeRepeat = await readFile(
        path.join(repository.root, eventPath)
      );
      const repeated = await runner.cancel();
      assert.equal(repeated.outcome, "already_cancelled");
      assert.deepEqual(
        repeated.state?.cancellation,
        terminal.state.cancellation
      );
      assert.deepEqual(
        await readFile(path.join(repository.root, eventPath)),
        eventsBeforeRepeat
      );
      const restarted = await runner.start({
        slug: "example-again",
        request: "Try again without migration."
      });
      assert.notEqual(restarted.runId, waiting.runId);
      assert.ok(restarted.pendingHumanDecision?.kind === "escalation");
      assert.equal(restarted.pendingHumanDecision.summary, LAYOUT_DIAGNOSTIC);
    } finally {
      await repository.dispose();
    }
  });
}

test("adoption workflow start refuses before lock, run, attempt and authentication", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new FakeAdapters();
    adapters.reviewResults.push(passingReview());
    const runner = new WorkflowRunner(repository.root, adapters);
    await rm(path.join(repository.root, "PROJECT_MANIFEST.md"));
    const before = await snapshotTree(repository.root);
    await assert.rejects(
      runner.start({ slug: "example", request: "Implement it." }),
      (error) => {
        assert.ok(error instanceof BanzaiError);
        assert.equal(error.code, "PROJECT_SETUP_REQUIRED");
        assert.match(error.message, /PROJECT_MANIFEST.md.*banzai setup/);
        return true;
      }
    );
    assert.deepEqual(await snapshotTree(repository.root), before);
    assert.equal(adapters.codexPreflights + adapters.claudePreflights, 0);
    assert.equal(adapters.selectionPrompts.length, 0);
  } finally {
    await repository.dispose();
  }
});

test("adoption start rechecks under ownership before publishing a run", async (t) => {
  const repository = await createTestRepository();
  try {
    const adapters = new FakeAdapters();
    const runner = new WorkflowRunner(repository.root, adapters);
    const acquire = runner.store.acquireLock.bind(runner.store);
    t.mock.method(runner.store, "acquireLock", async () => {
      const lock = await acquire();
      await rm(path.join(repository.root, "PROJECT_MANIFEST.md"));
      return lock;
    });
    await assert.rejects(
      runner.start({ slug: "example", request: "Plan it." }),
      { code: "PROJECT_SETUP_REQUIRED" }
    );
    assert.deepEqual(
      await readdir(path.join(repository.root, ".banzai/runs")),
      []
    );
    await assert.rejects(
      readFile(path.join(repository.root, ".banzai/active-run.json")),
      /ENOENT/
    );
    await assert.rejects(
      readFile(path.join(repository.root, ".banzai/runner.lock")),
      /ENOENT/
    );
    assert.equal(adapters.codexPreflights + adapters.claudePreflights, 0);
  } finally {
    await repository.dispose();
  }
});

test("adoption saved ADR, answer and triage survive refused automatic continuation", async (t) => {
  for (const decision of ["adr", "answer", "triage"] as const)
    await t.test(decision, async () => {
      const repository = await createTestRepository();
      try {
        const adapters = new FakeAdapters();
        if (decision === "adr")
          adapters.planResults.push(
            phaseResult("plan", {
              outcome: "needs_human_decision",
              gate: "adr_approval"
            })
          );
        if (decision === "answer")
          adapters.planResults.push(
            phaseResult("plan", {
              outcome: "needs_human_decision",
              gate: "escalation",
              questions: ["Preserve compatibility?"]
            })
          );
        if (decision === "triage")
          adapters.reviewResults.push({
            ...passingReview(),
            verdict: "changes_requested",
            findings: [finding("R1-F1", "Repair the finding.")]
          });
        const runner = new WorkflowRunner(repository.root, adapters);
        await runner.start({ slug: "example", request: "Plan it." });
        if (decision === "triage") await runner.approvePlan("human");
        const prior = (await runner.status()).state;
        await rm(path.join(repository.root, "AGENTS.md"));
        const action =
          decision === "adr"
            ? runner.decideAdr({
                id: "ADR-0001",
                decision: "accept",
                note: null,
                decidedBy: "human",
                autoResume: true
              })
            : decision === "answer"
              ? runner.answerHumanDecision({
                  answers: ["Preserve compatibility."],
                  decidedBy: "human"
                })
              : runner.triage({
                  accepted: ["R1-F1"],
                  rejected: [],
                  deferred: [],
                  note: null,
                  decidedBy: "human"
                });
        await assert.rejects(action, { code: "PROJECT_SETUP_REQUIRED" });
        const saved = await runner.status();
        assert.equal(
          saved.state.status,
          decision === "triage" ? "fixing" : "planning"
        );
        assert.equal(saved.state.activeAttempt, null);
        assert.equal(saved.state.blockReason, null);
        assert.deepEqual(saved.state.metrics.usage, prior.metrics.usage);
        assert.deepEqual(saved.state.metrics.attempts, prior.metrics.attempts);
        if (decision === "adr")
          assert.equal(saved.state.adrDecisions[0]?.decision, "accept");
        if (decision === "answer") {
          const answer = saved.state.humanDecisions?.[0];
          assert.ok(answer?.kind === "escalation");
          assert.deepEqual(answer.answers, ["Preserve compatibility."]);
        }
        if (decision === "triage")
          assert.equal(saved.state.triage?.items[0]?.disposition, "accepted");
        const tree = await snapshotTree(path.join(repository.root, ".banzai"));
        const options = {
          format: "json" as const,
          from: null,
          to: null,
          runIds: []
        };
        const evaluation = await collectEvaluationExport(
          repository.root,
          options
        );
        const control = projectAgentControlStatus(saved);
        await assert.rejects(runner.resume(), {
          code: "PROJECT_SETUP_REQUIRED"
        });
        assert.deepEqual(
          await snapshotTree(path.join(repository.root, ".banzai")),
          tree
        );
        assert.deepEqual(
          await collectEvaluationExport(repository.root, options),
          evaluation
        );
        assert.deepEqual(
          projectAgentControlStatus(await runner.status()),
          control
        );
        assert.equal(saved.nextAction, "banzai resume");
        await runner.cancel({ reason: "execution_blocked" });
        const cancelled = (await runner.status()).state;
        assert.deepEqual(cancelled.metrics.usage, prior.metrics.usage);
        const events = decodeCancellationEvents(
          await readCancellationFile(
            repository.root,
            `.banzai/runs/${prior.runId}/events.jsonl`,
            CANCELLATION_LIMITS.events
          )
        );
        const observed = resolveCancellation(
          cancelled,
          prior.runId,
          events.events,
          events.availability
        );
        assert.equal(
          observed.observation?.context.status.value,
          saved.state.status
        );
        assert.doesNotMatch(
          JSON.stringify(observed),
          /PROJECT_SETUP_REQUIRED|process_start/
        );
      } finally {
        await repository.dispose();
      }
    });
});

test("adoption zero-accepted triage does not complete with stale evidence after guidance removal", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new FakeAdapters();
    adapters.reviewResults.push({
      ...passingReview(),
      verdict: "changes_requested",
      findings: [finding("R1-F1", "Optional observation.")]
    });
    const runner = new WorkflowRunner(repository.root, adapters);
    await runner.start({ slug: "example", request: "Implement it." });
    await runner.approvePlan("human");
    await rm(path.join(repository.root, "AGENTS.md"));
    const calls = adapters.phasePrompts.length;
    const done = await runner.triage({
      accepted: [],
      rejected: ["R1-F1"],
      deferred: [],
      note: "No change required.",
      decidedBy: "human"
    });
    assert.equal(done.status, "blocked");
    assert.match(
      done.blockReason ?? "",
      /verification is unavailable or stale/
    );
    assert.equal(done.triage?.items[0]?.disposition, "rejected");
    assert.equal(adapters.phasePrompts.length, calls);
  } finally {
    await repository.dispose();
  }
});

test("adoption continuation entry matrix preserves persisted bytes, next action and eligibility", async (t) => {
  for (const checkpoint of [
    "created",
    "selecting",
    "planning",
    "plan_approved",
    "implementing",
    "verifying",
    "reviewing",
    "fixing"
  ] as const)
    await t.test(checkpoint, async () => {
      const repository = await createTestRepository();
      try {
        const adapters = new FakeAdapters();
        adapters.reviewResults.push(passingReview());
        const runner = new WorkflowRunner(repository.root, adapters);
        const state = await runner.start({
          slug: "example",
          request: "Implement it."
        });
        state.status = checkpoint;
        state.activeAttempt = null;
        await runner.store.writeState(state);
        await rm(path.join(repository.root, "AGENTS.md"));
        const before = await snapshotTree(
          path.join(repository.root, ".banzai")
        );
        const status = await runner.status();
        const calls = [
          adapters.codexPreflights,
          adapters.claudePreflights,
          adapters.phasePrompts.length
        ];
        await assert.rejects(runner.resume(), (error) => {
          assert.ok(error instanceof BanzaiError);
          assert.equal(error.code, "PROJECT_SETUP_REQUIRED");
          assert.match(
            error.message,
            /AGENTS.md.*Repair or migrate.*cancel the unfinished run/
          );
          assert.doesNotMatch(error.message, /Run banzai setup/);
          return true;
        });
        assert.deepEqual(
          await snapshotTree(path.join(repository.root, ".banzai")),
          before
        );
        assert.deepEqual(await runner.status(), status);
        assert.deepEqual(
          [
            adapters.codexPreflights,
            adapters.claudePreflights,
            adapters.phasePrompts.length
          ],
          calls
        );
      } finally {
        await repository.dispose();
      }
    });
});

test("adoption refusal after saved plan approval retains the decision and adds no usage or cancellation attribution", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new FakeAdapters();
    adapters.reviewResults.push(passingReview());
    const runner = new WorkflowRunner(repository.root, adapters);
    const planned = await runner.start({
      slug: "example",
      request: "Implement it."
    });
    const beforeMetrics = structuredClone(planned.metrics);
    await rm(path.join(repository.root, "AGENTS.md"));
    await assert.rejects(runner.approvePlan("human"), {
      code: "PROJECT_SETUP_REQUIRED"
    });
    const saved = (await runner.status()).state;
    assert.equal(saved.status, "plan_approved");
    assert.ok(saved.planApproval);
    assert.equal(saved.activeAttempt, null);
    assert.equal(saved.blockedFrom, null);
    assert.equal(saved.blockReason, null);
    assert.deepEqual(saved.metrics, beforeMetrics);
    const before = await snapshotTree(path.join(repository.root, ".banzai"));
    await assert.rejects(runner.resume(), { code: "PROJECT_SETUP_REQUIRED" });
    assert.deepEqual(
      await snapshotTree(path.join(repository.root, ".banzai")),
      before
    );
    await writeFile(path.join(repository.root, "AGENTS.md"), ADOPTED_AGENTS);
    assert.equal((await runner.resume()).status, "done");
  } finally {
    await repository.dispose();
  }
});

test("adoption late retry refusal leaves original failure and retry transition unconsumed", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new FakeAdapters();
    adapters.reviewResults.push(passingReview());
    adapters.planErrors.push(
      new BanzaiError("MODEL_TIMEOUT", "Planner timed out.")
    );
    const runner = new WorkflowRunner(repository.root, adapters);
    const blocked = await runner.start({
      slug: "example",
      request: "Plan it."
    });
    assert.equal(blocked.status, "blocked");
    const before = await snapshotTree(path.join(repository.root, ".banzai"));
    const prior = await runner.status();
    const initial = adapters.codexPreflights;
    adapters.onCodexPreflight = async () => {
      // The first call is retry-wide preflight. Drift occurs later in the
      // planner's preparation, after the old implementation published retry.
      if (adapters.codexPreflights === initial + 2)
        await rm(path.join(repository.root, "AGENTS.md"));
    };
    await assert.rejects(runner.retry(), { code: "PROJECT_SETUP_REQUIRED" });
    assert.deepEqual(
      await snapshotTree(path.join(repository.root, ".banzai")),
      before
    );
    const after = await runner.status();
    assert.deepEqual(after.state, prior.state);
    assert.deepEqual(after.retry, prior.retry);
    assert.equal(adapters.phasePrompts.length, 1);
    adapters.onCodexPreflight = null;
    await writeFile(path.join(repository.root, "AGENTS.md"), ADOPTED_AGENTS);
    assert.equal((await runner.retry()).status, "needs_plan_approval");
  } finally {
    await repository.dispose();
  }
});

test("adoption mid-chain drift retains completed selection and the last durable planning checkpoint", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new FakeAdapters();
    adapters.reviewResults.push(passingReview());
    const runner = new WorkflowRunner(repository.root, adapters);
    const checkpoint: {
      value: Awaited<ReturnType<typeof snapshotTree>> | null;
    } = { value: null };
    adapters.onCodexPreflight = async () => {
      if (adapters.selectionPrompts.length === 1) {
        checkpoint.value = await snapshotTree(
          path.join(repository.root, ".banzai")
        );
        await rm(path.join(repository.root, "AGENTS.md"));
      }
    };
    await assert.rejects(
      runner.start({ slug: "example", request: "Plan it." }),
      { code: "PROJECT_SETUP_REQUIRED" }
    );
    assert.ok(checkpoint.value);
    const after = await snapshotTree(path.join(repository.root, ".banzai"));
    const status = await runner.status();
    const ownedClaim = `work/${status.state.artifactBinding?.binding.workId}/.writer-claim.json`;
    assert.ok(checkpoint.value.some((entry) => entry.path === ownedClaim));
    assert.ok(!after.some((entry) => entry.path === ownedClaim));
    // Only this command's runner/work claims are released; durable evidence stays exact.
    assert.deepEqual(
      after.filter(
        (entry) => entry.path !== "runner.lock" && entry.path !== ownedClaim
      ),
      checkpoint.value.filter(
        (entry) => entry.path !== "runner.lock" && entry.path !== ownedClaim
      )
    );
    assert.equal(status.state.status, "planning");
    assert.equal(status.state.activeAttempt, null);
    assert.equal(status.state.blockedFrom, null);
    assert.equal(status.state.metrics.attempts.selection, 1);
    assert.equal(status.state.metrics.attempts.plan, 0);
    assert.equal(status.nextAction, "banzai resume");
    assert.equal(status.retry.eligible, false);
    assert.equal(status.recovery.eligible, false);
    assert.equal(adapters.phasePrompts.length, 0);
  } finally {
    await repository.dispose();
  }
});

test("adoption ignores run-authored manifest structure until the next new start", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new FakeAdapters();
    adapters.reviewResults.push(passingReview());
    const runner = new WorkflowRunner(repository.root, adapters);
    await runner.start({ slug: "example", request: "Implement it." });
    await writeFile(
      path.join(repository.root, "PROJECT_MANIFEST.md"),
      "Temporarily incomplete phase output."
    );
    assert.equal((await runner.approvePlan("human")).status, "done");
    const before = await snapshotTree(path.join(repository.root, ".banzai"));
    await assert.rejects(
      runner.start({ slug: "next", request: "Next task." }),
      { code: "PROJECT_SETUP_REQUIRED" }
    );
    assert.deepEqual(
      await snapshotTree(path.join(repository.root, ".banzai")),
      before
    );
  } finally {
    await repository.dispose();
  }
});

test("adoption continuation honors the real source-workspace topology", async () => {
  const repository = await createTestRepository();
  try {
    await writeIdentity(repository.root, SOURCE_IDENTITY_FIXTURES[2].files);
    const configPath = path.join(repository.root, ".banzai/config.json");
    const fixtureConfig = JSON.parse(
      await readFile(configPath, "utf8")
    ) as OrchestratorConfig;
    requiredFixture(fixtureConfig.verification.profiles[0]).projectType =
      "node";
    await writeFile(configPath, JSON.stringify(fixtureConfig));
    await writeFile(
      path.join(repository.root, "AGENTS.md"),
      "@/host/instructions\n# Banzai source rules\n"
    );
    await commitAll(repository.root, "source identity");
    const adapters = new FakeAdapters();
    adapters.reviewResults.push(passingReview());
    const runner = new WorkflowRunner(repository.root, adapters);
    await runner.start({ slug: "example", request: "Implement it." });
    assert.equal((await runner.approvePlan("human")).status, "done");
  } finally {
    await repository.dispose();
  }
});

test("setup eligibility refuses unfinished and corrupt runs while preserving all evidence", async (t) => {
  const { withProjectSetupOwnership } = await import("../src/project-setup.js");
  for (const status of [
    "needs_plan_approval",
    "blocked",
    "done",
    "cancelled",
    "corrupt",
    "unsupported"
  ] as const)
    await t.test(status, async () => {
      const repository = await createTestRepository();
      try {
        const runner = new WorkflowRunner(repository.root, new FakeAdapters());
        const state = await runner.start({
          slug: "example",
          request: "Plan it."
        });
        if (status === "corrupt")
          await writeFile(runner.store.statePath(state.runId), "{}");
        else {
          state.status = status === "unsupported" ? "done" : status;
          await runner.store.writeState(state);
          if (status === "unsupported")
            await writeFile(
              runner.store.statePath(state.runId),
              JSON.stringify({ ...state, contractVersion: "unsupported" })
            );
        }
        const before = await snapshotTree(
          path.join(repository.root, ".banzai")
        );
        let launched = false;
        const operation = withProjectSetupOwnership(
          repository.root,
          async () => {
            launched = true;
          },
          {}
        );
        if (status === "done" || status === "cancelled") await operation;
        else
          await assert.rejects(operation, {
            code:
              status === "corrupt" || status === "unsupported"
                ? "PROJECT_SETUP_STATE_INVALID"
                : "PROJECT_SETUP_RUN_UNFINISHED"
          });
        assert.equal(launched, status === "done" || status === "cancelled");
        assert.deepEqual(
          await snapshotTree(path.join(repository.root, ".banzai")),
          before
        );
      } finally {
        await repository.dispose();
      }
    });
});

test("adoption pending recovery refusal preserves source, authorization and failure evidence before and after auth drift", async (t) => {
  for (const late of [false, true])
    await t.test(late ? "after auth" : "entry", async () => {
      const fixture = await authorizedImplementationRecoveryFixture();
      try {
        const { repository, runner, adapters } = fixture;
        const before = await snapshotTree(
          path.join(repository.root, ".banzai")
        );
        const calls = adapters.phasePrompts.length;
        if (late)
          adapters.onCodexPreflight = async () => {
            await rm(path.join(repository.root, "AGENTS.md"), { force: true });
          };
        else await rm(path.join(repository.root, "AGENTS.md"));
        await assert.rejects(runner.resume(), {
          code: "PROJECT_SETUP_REQUIRED"
        });
        assert.deepEqual(
          await snapshotTree(path.join(repository.root, ".banzai")),
          before
        );
        assert.equal(adapters.phasePrompts.length, calls);
        const status = await runner.status();
        assert.equal(status.state.recovery?.stage, "authorized");
        assert.equal(status.state.blockedFrom, "implementing");
        adapters.onCodexPreflight = null;
        await writeFile(
          path.join(repository.root, "AGENTS.md"),
          ADOPTED_AGENTS
        );
        assert.equal((await runner.resume()).status, "done");
      } finally {
        await fixture.repository.dispose();
      }
    });
});

test("adoption new recovery refusal retains prerequisite-blocked fix evidence and eligibility", async () => {
  const fixture = await prerequisiteBlockedFixFixture();
  try {
    const { runner, adapters, repository } = fixture;
    await rm(path.join(repository.root, "AGENTS.md"));
    const status = await runner.status();
    assert.ok(status.recovery.eligible);
    assert.ok(status.recovery.attemptId);
    assert.ok(status.recovery.recoveryIdentity);
    const before = await snapshotTree(path.join(repository.root, ".banzai"));
    const calls = adapters.phasePrompts.length;
    await assert.rejects(
      runner.recover({
        attemptId: status.recovery.attemptId,
        recoveryIdentity: status.recovery.recoveryIdentity,
        unknownSideEffectsAccepted: true,
        decidedBy: "human"
      }),
      { code: "PROJECT_SETUP_REQUIRED" }
    );
    assert.deepEqual(
      await snapshotTree(path.join(repository.root, ".banzai")),
      before
    );
    assert.deepEqual((await runner.status()).recovery, status.recovery);
    assert.equal(adapters.phasePrompts.length, calls);
  } finally {
    await fixture.repository.dispose();
  }
});

test("adoption first-selection refusal preserves the already-published created checkpoint", async (t) => {
  const repository = await createTestRepository();
  try {
    const adapters = new FakeAdapters();
    const runner = new WorkflowRunner(repository.root, adapters);
    const create = runner.store.createRun.bind(runner.store);
    let checkpoint: Awaited<ReturnType<typeof snapshotTree>> = [];
    t.mock.method(runner.store, "createRun", async (state: RunState) => {
      await create(state);
      checkpoint = await snapshotTree(
        path.join(repository.root, ".banzai/runs")
      );
      await rm(path.join(repository.root, "AGENTS.md"));
    });
    await assert.rejects(
      runner.start({ slug: "example", request: "Plan it." }),
      { code: "PROJECT_SETUP_REQUIRED" }
    );
    assert.deepEqual(
      await snapshotTree(path.join(repository.root, ".banzai/runs")),
      checkpoint
    );
    const status = await runner.status();
    assert.equal(status.state.status, "created");
    assert.equal(status.state.activeAttempt, null);
    assert.equal(status.nextAction, "banzai resume");
    assert.equal(adapters.codexPreflights + adapters.claudePreflights, 0);
  } finally {
    await repository.dispose();
  }
});

for (const artifactLayout of ["legacy", "private"] as const) {
  for (const workflow of ["strict", "feature", "quick-fix"] as const) {
    test(`artifact storage A1 ${artifactLayout} selection-to-${workflow} preserves binding and completes`, async () => {
      const repository = await createTestRepository({ artifactLayout });
      try {
        let originalBinding = "";
        class BoundAdapters extends FakeAdapters {
          override async runSelection(
            request: WorkflowSelectionAdapterRequest
          ): Promise<AdapterResult<WorkflowSelectionResult>> {
            const state = JSON.parse(
              await readFile(
                path.join(request.runDirectory, "state.json"),
                "utf8"
              )
            ) as RunState;
            assert.equal(state.schemaVersion, 8);
            assert.equal(state.workflowSelection, null);
            assert.equal(state.artifactBinding?.binding.mode, "workflow");
            originalBinding = await readFile(
              path.join(
                repository.root,
                `.banzai/work/${state.artifactBinding.binding.workId}/work.json`
              ),
              "utf8"
            );
            return await super.runSelection(request);
          }
        }
        const adapters = new BoundAdapters();
        adapters.selectionResults.push(
          selectionResult({ recommendedWorkflow: workflow })
        );
        adapters.reviewResults.push(passingReview());
        const runner = new WorkflowRunner(repository.root, adapters);
        let state = await runner.start({
          slug: "example",
          request: "Implement the fixture."
        });
        if (workflow === "strict") {
          assert.equal(
            state.status,
            "needs_plan_approval",
            state.blockReason ?? ""
          );
          state = await runner.approvePlan("human", true);
        }
        assert.equal(state.status, "done", state.blockReason ?? "");
        const bound = state.artifactBinding;
        assert.ok(bound);
        assert.equal(
          await readFile(
            path.join(
              repository.root,
              `.banzai/work/${bound.binding.workId}/work.json`
            ),
            "utf8"
          ),
          originalBinding
        );
        assert.equal(bound.binding.layout, "private");
        assert.equal(bound.binding.schemaVersion, 2);
        if (workflow === "strict") {
          assert.ok(state.latestReview?.artifactPath);
          assert.match(
            await readFile(
              path.join(repository.root, state.latestReview.artifactPath),
              "utf8"
            ),
            /banzai-feature-review\/v7/u
          );
          assert.equal(state.planTaskCompletion?.status, "valid");
        }
      } finally {
        await repository.dispose();
      }
    });
  }
}

for (const artifactLayout of ["legacy", "private"] as const) {
  for (const workflow of ["strict", "feature", "quick-fix"] as const)
    test(`artifact storage ${artifactLayout} ${workflow} implementation rejects another workflow's report`, async () => {
      const repository = await createTestRepository({ artifactLayout });
      try {
        class WrongRoleAdapters extends FakeAdapters {
          override async runPhase(
            request: PhaseAdapterRequest
          ): Promise<AdapterResult<PhaseResult>> {
            const result = await super.runPhase(request);
            if (result.result.phase !== "implementation") return result;
            const state = JSON.parse(
              await readFile(
                path.join(request.runDirectory, "state.json"),
                "utf8"
              )
            ) as RunState;
            const roles = state.artifactBinding?.binding.artifacts;
            const wrongRole =
              workflow === "quick-fix"
                ? roles?.implementationReport
                : roles?.changeReport;
            assert.ok(wrongRole);
            await mkdir(path.dirname(path.join(request.repoRoot, wrongRole)), {
              recursive: true
            });
            await writeFile(
              path.join(request.repoRoot, wrongRole),
              "Unauthorized report.\n"
            );
            return result;
          }
        }
        const adapters = new WrongRoleAdapters();
        adapters.selectionResults.push(
          selectionResult({ recommendedWorkflow: workflow })
        );
        const runner = new WorkflowRunner(repository.root, adapters);
        let state = await runner.start({
          slug: "example",
          request: "Implement the fixture."
        });
        if (workflow === "strict") state = await runner.approvePlan("human");
        assert.equal(state.status, "blocked");
        assert.match(state.blockReason ?? "", /unauthorized artifact/u);
      } finally {
        await repository.dispose();
      }
    });
}

for (const artifactLayout of ["legacy", "private"] as const) {
  test(`artifact storage ${artifactLayout} quick-fix without a report trigger completes without a report`, async () => {
    const repository = await createTestRepository({ artifactLayout });
    try {
      class NoReportAdapters extends FakeAdapters {
        override async runPhase(
          request: PhaseAdapterRequest
        ): Promise<AdapterResult<PhaseResult>> {
          const result = await super.runPhase(request);
          const report = result.result.artifacts.implementationReport;
          assert.ok(report);
          await rm(path.join(request.repoRoot, report));
          result.result.artifacts.implementationReport = null;
          assert.match(
            request.prompt,
            /only when the existing report trigger applies; otherwise keep it null/u
          );
          return result;
        }
      }
      const adapters = new NoReportAdapters();
      adapters.selectionResults.push(
        selectionResult({ recommendedWorkflow: "quick-fix" })
      );
      const state = await new WorkflowRunner(repository.root, adapters).start({
        slug: "example",
        request: "Make a routine internal cleanup with no report trigger."
      });
      assert.equal(state.status, "done", state.blockReason ?? "");
      const report = state.artifactBinding?.binding.artifacts.changeReport;
      assert.ok(report);
      await assert.rejects(readFile(path.join(repository.root, report)), {
        code: "ENOENT"
      });
    } finally {
      await repository.dispose();
    }
  });
}

for (const context of [
  "banzai-source",
  "home-project",
  "client-project"
] as const) {
  test(`artifact storage orchestrated ${context} separates work from run authority`, async () => {
    const repository = await createTestRepository({ artifactLayout: null });
    try {
      if (context === "banzai-source") {
        const identity = SOURCE_IDENTITY_FIXTURES.find(
          (fixture) => fixture.name === "source workspace"
        );
        assert.ok(identity);
        await writeIdentity(repository.root, identity.files);
        const configPath = path.join(repository.root, ".banzai/config.json");
        const fixtureConfig = JSON.parse(
          await readFile(configPath, "utf8")
        ) as OrchestratorConfig;
        requiredFixture(fixtureConfig.verification.profiles[0]).projectType =
          "node";
        await writeFile(configPath, JSON.stringify(fixtureConfig));
        await writeFile(
          path.join(repository.root, "AGENTS.md"),
          "# Source repository instructions\n"
        );
      }
      const adapters = new FakeAdapters();
      adapters.selectionResults.push(
        selectionResult({ recommendedWorkflow: "feature" })
      );
      const runner = new WorkflowRunner(repository.root, adapters);
      const state = await runner.start({
        slug: "example",
        request: "Implement the fixture."
      });
      assert.equal(state.status, "done", state.blockReason ?? "");
      assert.equal(state.artifactBinding?.binding.layout, "private");
      // The lite feature workflow never enters the completion protocol, so the
      // run keeps the bootstrap schema.
      assert.equal(state.schemaVersion, 8);
      assert.ok(
        (await readFile(runner.store.statePath(state.runId), "utf8")).includes(
          state.runId
        )
      );
    } finally {
      await repository.dispose();
    }
  });
}

test("accepted F2 runner claims exclude standalone writes throughout a phase and clean up on failure", async () => {
  const repository = await createTestRepository({ artifactLayout: "private" });
  try {
    let rejected = 0;
    class ClaimProbe extends FakeAdapters {
      override async runPhase(
        request: PhaseAdapterRequest
      ): Promise<AdapterResult<PhaseResult>> {
        const state = JSON.parse(
          await readFile(path.join(request.runDirectory, "state.json"), "utf8")
        ) as RunState;
        assert.ok(state.artifactBinding);
        const workPath = `.banzai/work/${state.artifactBinding.binding.workId}`;
        await assert.rejects(
          acquireWork({
            repoRoot: repository.root,
            workPath,
            ownerId: "standalone"
          }),
          { code: "ARTIFACT_OWNERSHIP_CONFLICT" }
        );
        rejected++;
        const independent = await createWork({
          repoRoot: repository.root,
          slug: "unrelated",
          mode: "lite",
          creationId: "11111111-1111-4111-8111-111111111111"
        });
        const otherPath = `.banzai/work/${independent.binding.workId}`;
        const other = await acquireWork({
          repoRoot: repository.root,
          workPath: otherPath,
          ownerId: "independent"
        });
        await releaseWork({
          repoRoot: repository.root,
          workPath: otherPath,
          token: other.token
        });
        return super.runPhase(request);
      }
    }
    const adapters = new ClaimProbe();
    adapters.selectionResults.push(
      selectionResult({ recommendedWorkflow: "feature" })
    );
    adapters.implementationErrors.push(new Error("controlled phase failure"));
    const runner = new WorkflowRunner(repository.root, adapters);
    const blocked = await runner.start({
      slug: "claimed",
      request: "Exercise exclusive evidence ownership."
    });
    assert.equal(blocked.status, "blocked", blocked.blockReason ?? "");
    assert.equal(rejected, 1);
    assert.ok(blocked.artifactBinding);
    const workPath = `.banzai/work/${blocked.artifactBinding.binding.workId}`;
    const claim = await acquireWork({
      repoRoot: repository.root,
      workPath,
      ownerId: "after-failure"
    });
    await releaseWork({
      repoRoot: repository.root,
      workPath,
      token: claim.token
    });
    await runner.cancel({ reason: "intent_changed" });
    adapters.reviewResults.push(passingReview());
    const planned = await runner.start({
      slug: "reverse-order",
      request: "Check standalone-first ownership."
    });
    assert.equal(
      planned.status,
      "needs_plan_approval",
      planned.blockReason ?? ""
    );
    assert.ok(planned.artifactBinding);
    const nextPath = `.banzai/work/${planned.artifactBinding.binding.workId}`;
    const held = await acquireWork({
      repoRoot: repository.root,
      workPath: nextPath,
      ownerId: "before-runner"
    });
    const beforeApproval = rejected;
    await assert.rejects(
      runner.approvePlan("human", true),
      /writer|ownership|claim/iu
    );
    assert.equal(rejected, beforeApproval);
    await releaseWork({
      repoRoot: repository.root,
      workPath: nextPath,
      token: held.token
    });
    const recovered = await runner.resume();
    assert.equal(recovered.status, "done", recovered.blockReason ?? "");
    const final = await acquireWork({
      repoRoot: repository.root,
      workPath: nextPath,
      ownerId: "after-completion"
    });
    await releaseWork({
      repoRoot: repository.root,
      workPath: nextPath,
      token: final.token
    });
  } finally {
    await repository.dispose();
  }
});

test("accepted F10 public doctor recognizes actual v4 runs and rejects binding drift read-only", async () => {
  const repository = await createTestRepository({ artifactLayout: "private" });
  try {
    const runner = new WorkflowRunner(repository.root, new FakeAdapters());
    const state = await runner.start({
      slug: "doctor",
      request: "Inspect a current run."
    });
    assert.equal(state.schemaVersion, 8);
    assert.ok(state.artifactBinding);
    const report = await inspectDoctor(repository.root);
    assert.notEqual(
      report.checks.find((item) => item.id === "run.active")?.status,
      "fail"
    );
    const filename = path.join(
      repository.root,
      ".banzai/runs",
      state.runId,
      "state.json"
    );
    for (const malformed of [
      { ...state, schemaVersion: 99 },
      { ...state, artifactBinding: null }
    ]) {
      const bytes = JSON.stringify(malformed);
      await writeFile(filename, bytes);
      const invalid = await inspectDoctor(repository.root);
      assert.equal(
        invalid.checks.find((item) => item.id === "run.active")?.status,
        "fail"
      );
      assert.equal(await readFile(filename, "utf8"), bytes);
    }
    await writeFile(filename, JSON.stringify(state));
    const bindingFile = path.join(
      repository.root,
      `.banzai/work/${state.artifactBinding.binding.workId}/work.json`
    );
    await writeFile(bindingFile, (await readFile(bindingFile, "utf8")) + "\n");
    const drift = await inspectDoctor(repository.root);
    assert.equal(
      drift.checks.find((item) => item.id === "run.active")?.status,
      "fail"
    );
  } finally {
    await repository.dispose();
  }
});

test("instruction preflight refuses resource skew before any model or attempt and preserves structural refusal precedence", async (t) => {
  for (const structural of [false, true])
    await t.test(
      structural ? "invalid hook" : "resource mismatch",
      async () => {
        const repository = await createTestRepository({
          artifactLayout: "private"
        });
        const plugin = await instructionPluginFixture();
        try {
          await configureInstructionPlugin(repository.root, plugin.directory);
          await writeFile(
            path.join(plugin.directory, "phases/fix.md"),
            "PRIVATE-SKEW-CANARY"
          );
          if (structural)
            await rm(path.join(plugin.directory, "hooks/spec-gate.cjs"));
          const adapters = new FakeAdapters();
          const runner = new WorkflowRunner(repository.root, adapters);
          if (structural) {
            const state = await runner.start({
              slug: "example",
              request: "Plan it."
            });
            assert.equal(state.status, "blocked");
            assert.equal(
              (await runner.status()).state.metrics.attempts.plan,
              0
            );
          } else {
            await assert.rejects(
              runner.start({ slug: "example", request: "Plan it." }),
              { code: "INSTRUCTION_RESOURCE_MISMATCH" }
            );
            const status = await runner.status();
            assert.equal(status.state.status, "created");
            assert.equal(status.state.activeAttempt, null);
            assert.equal(status.state.blockReason, null);
            assert.deepEqual(
              await runner.store.readRunAttempts(status.state.runId),
              []
            );
            assert.equal(status.state.metrics.usage.inputTokens, 0);
          }
          assert.equal(
            adapters.selectionPrompts.length +
              adapters.phasePrompts.length +
              adapters.reviewPrompts.length,
            0
          );
          assert.equal(adapters.codexPreflights + adapters.claudePreflights, 0);
        } finally {
          await plugin.dispose();
          await repository.dispose();
        }
      }
    );
});

test("instruction per-call refusal retains saved approval and triage, exact bindings and usage in private and legacy work", async (t) => {
  for (const layout of ["private", "legacy"] as const)
    for (const gate of ["approval", "triage"] as const)
      await t.test(`${layout} ${gate}`, async () => {
        const repository = await createTestRepository({
          artifactLayout: layout
        });
        const plugin = await instructionPluginFixture();
        try {
          await configureInstructionPlugin(repository.root, plugin.directory);
          const adapters = new FakeAdapters();
          if (gate === "triage")
            adapters.reviewResults.push({
              ...passingReview(),
              verdict: "changes_requested",
              findings: [finding("R1-F1", "Repair it.")]
            });
          adapters.reviewResults.push(
            passingReview(gate === "triage" ? ["R1-F1"] : [])
          );
          const runner = new WorkflowRunner(repository.root, adapters);
          await runner.start({ slug: "example", request: "Implement it." });
          if (gate === "triage") {
            const approved = await runner.approvePlan("human");
            assert.notEqual(
              approved.status,
              "blocked",
              JSON.stringify(approved.blockReason)
            );
          }
          const prior = (await runner.status()).state;
          const resource = path.join(
            plugin.directory,
            `phases/${gate === "triage" ? "fix" : "implementation"}.md`
          );
          const original = await readFile(resource);
          await writeFile(
            resource,
            Buffer.concat([original, Buffer.from("\n")])
          );
          const calls = adapters.phasePrompts.length;
          await assert.rejects(
            gate === "approval"
              ? runner.approvePlan("human")
              : runner.triage({
                  accepted: ["R1-F1"],
                  rejected: [],
                  deferred: [],
                  note: null,
                  decidedBy: "human"
                }),
            { code: "INSTRUCTION_RESOURCE_MISMATCH" }
          );
          const saved = (await runner.status()).state;
          assert.equal(
            saved.status,
            gate === "approval" ? "plan_approved" : "fixing"
          );
          assert.ok(saved.planApproval);
          if (gate === "triage")
            assert.equal(saved.triage?.items[0]?.disposition, "accepted");
          assert.deepEqual(saved.metrics, {
            ...prior.metrics,
            triage:
              gate === "triage"
                ? { accepted: 1, rejected: 0, deferred: 0 }
                : prior.metrics.triage
          });
          assert.deepEqual(saved.artifactBinding, prior.artifactBinding);
          assert.equal(saved.activeAttempt, null);
          assert.equal(saved.blockReason, null);
          const before = await snapshotTree(
            path.join(repository.root, ".banzai")
          );
          const projectionOptions = {
            format: "json" as const,
            from: null,
            to: null,
            runIds: []
          };
          const projections = async () => {
            const evaluation = await collectEvaluationExport(
              repository.root,
              projectionOptions
            );
            return {
              evaluation,
              kpi: deriveEvaluationKpiReport([
                { label: "instruction-fixture", report: evaluation }
              ]),
              context: await collectContextReport(
                repository.root,
                projectionOptions
              )
            };
          };
          const beforeProjections = await projections();
          await assert.rejects(runner.resume(), {
            code: "INSTRUCTION_RESOURCE_MISMATCH"
          });
          assert.deepEqual(
            await snapshotTree(path.join(repository.root, ".banzai")),
            before
          );
          assert.deepEqual(await projections(), beforeProjections);
          assert.equal(adapters.phasePrompts.length, calls);
          await writeFile(resource, original);
          const resumed = await runner.resume();
          assert.equal(
            resumed.status,
            "done",
            JSON.stringify(resumed.blockReason)
          );
          const bound = saved.artifactBinding;
          assert.ok(bound);
          // Standalone status/review use this same explicit binding reader.
          const unrelated = await createWork({
            repoRoot: repository.root,
            slug: "unrelated",
            mode: "strict",
            creationId: randomUUID()
          });
          const consumerBefore = await snapshotTree(
            path.join(repository.root, ".banzai")
          );
          const selected = await inspectArtifacts({
            repoRoot: repository.root,
            workId: bound.binding.workId
          });
          assert.deepEqual(selected.work, bound);
          assert.notEqual(
            selected.work.binding.workId,
            unrelated.binding.workId
          );
          assert.deepEqual(
            await snapshotTree(path.join(repository.root, ".banzai")),
            consumerBefore
          );
          const roles = selected.work.binding.artifacts;
          assert.ok(roles);
          for (const prompt of [
            ...adapters.phasePrompts,
            ...adapters.reviewPrompts
          ]) {
            for (const role of [
              "description",
              "plan",
              "implementationReport",
              "testReport",
              "work",
              "changeReport"
            ] as const) {
              const target = roles[role];
              assert.ok(target);
              assert.ok(prompt.includes(target), role);
            }
            assert.doesNotMatch(
              prompt,
              /Use the available Skill tool|\$banzai:/
            );
          }
          assert.match(
            adapters.reviewPrompts[0] ?? "",
            /Model artifact write set: \[\]/
          );
          assert.match(
            adapters.selectionPrompts[0] ?? "",
            /Model artifact write set: \[\]/
          );
        } finally {
          await plugin.dispose();
          await repository.dispose();
        }
      });
});

test("late instruction skew preserves the failed planner retry and authorized recovery snapshots", async (t) => {
  await t.test("planner retry after authentication", async () => {
    const repository = await createTestRepository();
    const plugin = await instructionPluginFixture();
    const previousClaudeConfig = process.env.CLAUDE_CONFIG_DIR;
    try {
      process.env.CLAUDE_CONFIG_DIR = plugin.directory;
      await writeFile(
        path.join(plugin.directory, ".claude.json"),
        JSON.stringify({
          projects: { [repository.root]: { hasTrustDialogAccepted: true } }
        })
      );
      await configureInstructionPlugin(repository.root, plugin.directory, true);
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
      assert.match(blocked.blockReason ?? "", /Planner timed out/);
      const before = await snapshotTree(path.join(repository.root, ".banzai"));
      const prior = await runner.status();
      const initial = adapters.claudePreflights;
      const resource = path.join(plugin.directory, "phases/planning.md");
      const original = await readFile(resource);
      adapters.onClaudePreflight = async () => {
        if (adapters.claudePreflights === initial + 3)
          await writeFile(resource, "changed");
      };
      await assert.rejects(runner.retry(), {
        code: "INSTRUCTION_RESOURCE_MISMATCH"
      });
      assert.deepEqual(
        await snapshotTree(path.join(repository.root, ".banzai")),
        before
      );
      assert.deepEqual((await runner.status()).retry, prior.retry);
      assert.equal(adapters.phasePrompts.length, 1);
      adapters.onClaudePreflight = null;
      await writeFile(resource, original);
      assert.equal((await runner.retry()).status, "needs_plan_approval");
      assert.match(adapters.phasePrompts[1] ?? "", /# Planning Guidance/);
    } finally {
      if (previousClaudeConfig === undefined)
        delete process.env.CLAUDE_CONFIG_DIR;
      else process.env.CLAUDE_CONFIG_DIR = previousClaudeConfig;
      await plugin.dispose();
      await repository.dispose();
    }
  });
  await t.test("authorized implementation recovery", async () => {
    const plugin = await instructionPluginFixture();
    const fixture = await authorizedImplementationRecoveryFixture(
      plugin.directory
    );
    try {
      const { repository, runner, adapters } = fixture;
      const resource = path.join(plugin.directory, "phases/implementation.md");
      const original = await readFile(resource);
      await writeFile(resource, "changed");
      const prior = await runner.status();
      const before = await snapshotTree(path.join(repository.root, ".banzai"));
      const calls = adapters.phasePrompts.length;
      await assert.rejects(runner.resume(), {
        code: "INSTRUCTION_RESOURCE_MISMATCH"
      });
      assert.deepEqual(
        await snapshotTree(path.join(repository.root, ".banzai")),
        before
      );
      assert.deepEqual((await runner.status()).recovery, prior.recovery);
      assert.equal(adapters.phasePrompts.length, calls);
      await writeFile(resource, original);
      assert.equal((await runner.resume()).status, "done");
      assert.match(adapters.phasePrompts.at(-1) ?? "", /# Assurance Guidance/);
      assert.match(
        adapters.phasePrompts.at(-1) ?? "",
        /Operator-authorized interrupted-attempt recovery/
      );
    } finally {
      await fixture.repository.dispose();
      await plugin.dispose();
    }
  });
});
