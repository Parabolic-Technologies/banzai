import { requiredFixture } from "./helpers.js";
import assert from "node:assert/strict";
import { readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  CONTRACT_VERSION,
  PLAN_TASK_COMPLETION_SCHEMA_VERSION,
  type AttemptRecord,
  type AttemptReference,
  type PlanTaskCompletionViolation,
  type RunState
} from "../src/types.js";
import { WorkflowRunner } from "../src/workflow.js";
import {
  commitAll,
  createTestRepository,
  verificationAttemptFixture,
  writeVerificationLedger
} from "./helpers.js";
import {
  observeEligibility,
  rewriteRunState
} from "./characterization-trace.js";
import {
  FakeAdapters,
  blockedByFailedCheck,
  boundFixturePath,
  finding,
  passingReview,
  phaseResult,
  planPath,
  prerequisiteBlockedFixFixture,
  selectionResult
} from "./workflow-fixtures.js";

/*
 * Eligibility baseline (ADR-0052 stage 2 differential evidence). Each scenario
 * persists one run condition through the existing harness and records the
 * complete observable decision: the status projection's retry, recovery and
 * next action, or restore eligibility, plus the state persisted afterwards so
 * eligibility-time effects stay visible. Expected values come from the
 * baseline source and must not change when the rules move.
 */
type PrerequisiteFixture = Awaited<
  ReturnType<typeof prerequisiteBlockedFixFixture>
>;

interface EligibilityArrangement {
  root: string;
  runner: WorkflowRunner;
  runId: string;
  dispose: () => Promise<void>;
}

async function rewriteActiveAttempt(
  runner: WorkflowRunner,
  runId: string,
  mutate: (record: AttemptRecord) => void
): Promise<AttemptReference> {
  const state = await runner.store.readState(runId);
  const attempt = requiredFixture(state.activeAttempt);
  const record = await runner.store.readRunAttempt(runId, attempt);
  mutate(record);
  await runner.store.writeRunAttempt(runId, record);
  return attempt;
}

async function inRepository(
  arrange: (root: string) => Promise<{ runner: WorkflowRunner; runId: string }>
): Promise<EligibilityArrangement> {
  const repository = await createTestRepository();
  try {
    const { runner, runId } = await arrange(repository.root);
    return {
      root: repository.root,
      runner,
      runId,
      dispose: () => repository.dispose()
    };
  } catch (error) {
    await repository.dispose();
    throw error;
  }
}

async function strictAwaitingApproval(root: string) {
  const adapters = new FakeAdapters();
  adapters.reviewResults.push(passingReview());
  const runner = new WorkflowRunner(root, adapters);
  const state = await runner.start({
    slug: "example",
    request: "Implement it."
  });
  return { runner, runId: state.runId };
}

async function strictApproved(root: string) {
  const arranged = await strictAwaitingApproval(root);
  await arranged.runner.approvePlan("human", false);
  return arranged;
}

async function failedStrictImplementation(
  root: string,
  configure: (adapters: FakeAdapters) => void = (adapters) =>
    adapters.implementationErrors.push(new Error("implementation interrupted"))
) {
  const adapters = new FakeAdapters();
  configure(adapters);
  adapters.reviewResults.push(passingReview());
  const runner = new WorkflowRunner(root, adapters);
  await runner.start({ slug: "example", request: "Implement it." });
  const blocked = await runner.approvePlan("human");
  assert.equal(blocked.status, "blocked", "fixture must block");
  return { runner, runId: blocked.runId };
}

async function authorizeRecovery(runner: WorkflowRunner): Promise<void> {
  const status = await runner.status();
  assert.equal(status.recovery.eligible, true, status.recovery.reason);
  await runner.recover(
    {
      attemptId: requiredFixture(status.recovery.attemptId),
      recoveryIdentity: requiredFixture(status.recovery.recoveryIdentity),
      unknownSideEffectsAccepted: true,
      decidedBy: "current-human"
    },
    false
  );
}

async function failedFix(root: string) {
  const adapters = new FakeAdapters();
  adapters.reviewResults.push(
    {
      contractVersion: CONTRACT_VERSION,
      verdict: "changes_requested",
      summary: "One finding.",
      findings: [finding("R1-F1", "Accepted defect.")],
      reviewedFindingIds: [],
      deferredCoverage: []
    },
    passingReview(["R1-F1"])
  );
  adapters.fixErrors.push(new Error("fix interrupted"));
  const runner = new WorkflowRunner(root, adapters);
  await runner.start({ slug: "example", request: "Implement it." });
  await runner.approvePlan("human");
  const blocked = await runner.triage({
    accepted: ["R1-F1"],
    rejected: [],
    deferred: [],
    note: null,
    decidedBy: "human"
  });
  assert.equal(blocked.status, "blocked", "fixture must block");
  return { runner, runId: blocked.runId };
}

async function failedSelection(root: string) {
  const adapters = new FakeAdapters();
  adapters.selectionErrors.push(new Error("selection failed"));
  const runner = new WorkflowRunner(root, adapters);
  const blocked = await runner.start({
    slug: "example",
    request: "Implement it."
  });
  assert.equal(blocked.status, "blocked", "fixture must block");
  return { runner, runId: blocked.runId };
}

async function failedPlanning(root: string) {
  const adapters = new FakeAdapters();
  adapters.planErrors.push(new Error("planning failed"));
  const runner = new WorkflowRunner(root, adapters);
  const blocked = await runner.start({
    slug: "example",
    request: "Implement it."
  });
  assert.equal(blocked.status, "blocked", "fixture must block");
  return { runner, runId: blocked.runId };
}

async function liteDone(root: string) {
  const adapters = new FakeAdapters();
  adapters.fixtureTaskChecks = true;
  adapters.selectionResults.push(
    selectionResult({ recommendedWorkflow: "feature" })
  );
  const runner = new WorkflowRunner(root, adapters, async () => ({
    exitCode: 0,
    signal: null,
    stdout: "",
    stderr: "",
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString()
  }));
  const done = await runner.start({
    slug: "verification-done",
    request: "Exercise task verification."
  });
  assert.equal(done.status, "done", done.blockReason ?? "");
  return { runner, runId: done.runId };
}

async function failedLiteImplementation(root: string) {
  const adapters = new FakeAdapters();
  adapters.selectionResults.push(
    selectionResult({ recommendedWorkflow: "feature" })
  );
  adapters.implementationErrors.push(new Error("implementation interrupted"));
  const runner = new WorkflowRunner(root, adapters);
  const blocked = await runner.start({
    slug: "lite-recovery",
    request: "Implement it."
  });
  assert.equal(blocked.status, "blocked", "fixture must block");
  return { runner, runId: blocked.runId };
}

const markStarted = (record: AttemptRecord) => {
  record.status = "started";
  record.completedAt = null;
  record.durationMs = null;
  record.error = null;
  record.failureCode = null;
};

const APPROVAL_CHANGED_REASON =
  "Approved planning artifacts changed. Restore the approved bundle (banzai restore) and retry, or cancel the run and approve a revised plan in a new run.";

async function changeApprovedPlan(root: string): Promise<void> {
  const planFile = await boundFixturePath(root, planPath);
  await writeFile(
    planFile,
    `${await readFile(planFile, "utf8")}\nExternal edit from another session.\n`,
    "utf8"
  );
}

async function commitUnrelatedChange(root: string): Promise<void> {
  await writeFile(path.join(root, "unrelated.txt"), "moved HEAD\n", "utf8");
  await commitAll(root, "move HEAD");
}

function invalidCompletion(
  sourceAttemptId: string,
  violation: PlanTaskCompletionViolation
): NonNullable<RunState["planTaskCompletion"]> {
  return {
    schemaVersion: PLAN_TASK_COMPLETION_SCHEMA_VERSION,
    status: "invalid",
    sourceAttemptId,
    errorCode: "PLAN_TASK_COMPLETION_INVALID",
    violation,
    taskId: null,
    recordedAt: "2026-07-01T00:00:00.000Z"
  };
}

const ELIGIBILITY_SCENARIOS: {
  name: string;
  observe?: "status" | "restore";
  arrange: () => Promise<EligibilityArrangement>;
}[] = [
  {
    name: "awaiting plan approval",
    arrange: () => inRepository(strictAwaitingApproval)
  },
  {
    name: "awaiting triage",
    arrange: () =>
      inRepository(async (root) => {
        const adapters = new FakeAdapters();
        adapters.reviewResults.push({
          contractVersion: CONTRACT_VERSION,
          verdict: "changes_requested",
          summary: "One finding.",
          findings: [finding("R1-F1", "Accepted defect.")],
          reviewedFindingIds: [],
          deferredCoverage: []
        });
        const runner = new WorkflowRunner(root, adapters);
        await runner.start({ slug: "example", request: "Implement it." });
        const state = await runner.approvePlan("human");
        assert.equal(state.status, "needs_triage");
        return { runner, runId: state.runId };
      })
  },
  ...(["needs_adr_approval", "implementing", "cancelled"] as const).map(
    (status) => ({
      name: `persisted status ${status}`,
      arrange: () =>
        inRepository(async (root) => {
          const arranged = await strictAwaitingApproval(root);
          await rewriteRunState(
            arranged.runner.store,
            arranged.runId,
            (state) => {
              state.status = status;
            }
          );
          return arranged;
        })
    })
  ),
  {
    name: "planning escalation awaiting a human decision",
    arrange: () =>
      inRepository(async (root) => {
        const adapters = new FakeAdapters();
        adapters.planResults.push(
          phaseResult("plan", {
            outcome: "needs_human_decision",
            gate: "escalation",
            summary: "A product decision is required.",
            questions: ["Should the feature support the legacy behavior?"]
          })
        );
        const runner = new WorkflowRunner(root, adapters);
        const gated = await runner.start({
          slug: "example",
          request: "Plan the product change."
        });
        assert.equal(gated.status, "needs_human_decision");
        return { runner, runId: gated.runId };
      })
  },
  { name: "completed lite run", arrange: () => inRepository(liteDone) },
  ...(
    [
      ["created", null],
      ["reviewing", null],
      ["planning", null],
      ["plan_approved", APPROVAL_CHANGED_REASON],
      ["implementing", APPROVAL_CHANGED_REASON],
      ["fixing", APPROVAL_CHANGED_REASON]
    ] as const
  ).map(([blockedFrom, blockReason]) => ({
    name: `blocked from ${blockedFrom} without an attempt${blockReason === null ? "" : " after approval changed"}`,
    arrange: () =>
      inRepository(async (root) => {
        const arranged = await strictAwaitingApproval(root);
        await rewriteRunState(
          arranged.runner.store,
          arranged.runId,
          (state) => {
            state.status = "blocked";
            state.blockedFrom = blockedFrom;
            state.blockReason = blockReason ?? "Fixture block.";
            state.activeAttempt = null;
          }
        );
        return arranged;
      })
  })),
  {
    name: "blocked while a model process is active",
    arrange: () =>
      inRepository(async (root) => {
        const arranged = await strictAwaitingApproval(root);
        await rewriteRunState(
          arranged.runner.store,
          arranged.runId,
          (state) => {
            state.status = "blocked";
            state.blockedFrom = "created";
            state.blockReason = "Fixture block.";
            state.activeProcess = {
              pid: process.pid,
              kind: "implementation",
              startedAt: "2026-07-01T00:00:00.000Z"
            };
          }
        );
        return arranged;
      })
  },
  {
    name: "approved bundle changed before implementation",
    arrange: () =>
      inRepository(async (root) => {
        const arranged = await strictApproved(root);
        await changeApprovedPlan(root);
        await assert.rejects(arranged.runner.resume(), /banzai restore/);
        return arranged;
      })
  },
  {
    name: "failed task check",
    arrange: () =>
      inRepository(async (root) => {
        const { runner, blocked } = await blockedByFailedCheck(root);
        return { runner, runId: blocked.runId };
      })
  },
  {
    name: "failed task check with an unreadable implementation attempt record",
    arrange: () =>
      inRepository(async (root) => {
        const { runner, blocked } = await blockedByFailedCheck(root);
        const implementation = (
          await runner.store.readRunAttempts(blocked.runId)
        ).find((record) => record.attempt.kind === "implementation");
        await writeFile(
          runner.store.attemptPath(
            blocked.runId,
            requiredFixture(implementation).attempt
          ),
          "{",
          "utf8"
        );
        return { runner, runId: blocked.runId };
      })
  },
  {
    name: "blocked from verifying after every task check completed",
    arrange: () =>
      inRepository(async (root) => {
        const arranged = await liteDone(root);
        await rewriteRunState(
          arranged.runner.store,
          arranged.runId,
          (state) => {
            state.status = "blocked";
            state.blockedFrom = "verifying";
            state.blockReason = "Fixture verification block.";
          }
        );
        return arranged;
      })
  },
  {
    name: "blocked from verifying with an unresolved physical task check",
    arrange: () =>
      inRepository(async (root) => {
        const arranged = await liteDone(root);
        const state = await arranged.runner.store.readState(arranged.runId);
        const directory = path.join(
          root,
          requiredFixture(
            requiredFixture(state.artifactBinding).binding.artifacts
              .verificationDirectory
          )
        );
        const attempts = path.join(directory, "attempts");
        for (const name of (await readdir(attempts)).filter((entry) =>
          entry.endsWith(".finish.json")
        ))
          await rm(path.join(attempts, name));
        for (const name of (
          await readdir(path.join(directory, "origins"))
        ).filter((entry) => entry.endsWith(".finish.json")))
          await rm(path.join(directory, "origins", name));
        await rewriteRunState(arranged.runner.store, arranged.runId, (next) => {
          next.status = "blocked";
          next.blockedFrom = "verifying";
          next.blockReason = "Fixture verification block.";
        });
        return arranged;
      })
  },
  {
    name: "blocked from verifying with an unresolved digest",
    arrange: () =>
      inRepository(async (root) => {
        const { runner, blocked } = await blockedByFailedCheck(root);
        await rewriteRunState(runner.store, blocked.runId, (state) => {
          state.blockReason =
            "[RESULT_DIGEST_UNRESOLVED] The recorded digest does not match.";
        });
        return { runner, runId: blocked.runId };
      })
  },
  {
    name: "blocked from verifying with malformed task evidence",
    arrange: () =>
      inRepository(async (root) => {
        const { runner, blocked } = await blockedByFailedCheck(root);
        const directory = path.join(
          root,
          requiredFixture(
            requiredFixture(blocked.artifactBinding).binding.artifacts
              .verificationDirectory
          ),
          "attempts"
        );
        const [file] = (await readdir(directory)).filter(
          (name) => name !== "ledger.json"
        );
        await writeFile(
          path.join(directory, requiredFixture(file)),
          "{",
          "utf8"
        );
        return { runner, runId: blocked.runId };
      })
  },
  ...(
    [
      ["missing_task", "completion evidence"],
      ["approved_plan_invalid", "plan bundle"]
    ] as const
  ).map(([violation, label]) => ({
    name: `blocked from verifying with invalid ${label}`,
    arrange: () =>
      inRepository(async (root) => {
        const { runner, blocked } = await blockedByFailedCheck(root);
        await rewriteRunState(runner.store, blocked.runId, (state) => {
          state.planTaskCompletion = invalidCompletion(
            "implementation-1-fixture",
            violation
          );
        });
        return { runner, runId: blocked.runId };
      })
  })),
  {
    name: "blocked from verifying without a legacy ledger",
    arrange: () =>
      inRepository(async (root) => {
        const { runner, blocked } = await blockedByFailedCheck(root);
        await rewriteRunState(runner.store, blocked.runId, (state) => {
          const legacy = state as unknown as Record<string, unknown>;
          legacy.schemaVersion = 7;
          delete legacy.planningReview;
          delete legacy.verificationMode;
          delete legacy.taskVerification;
          delete legacy.artifactBinding;
        });
        await rm(runner.store.verificationLedgerPath(blocked.runId), {
          force: true
        });
        return { runner, runId: blocked.runId };
      })
  },
  ...(["failed", "completed"] as const).map((status) => ({
    name: `blocked from verifying with a ${status} legacy attempt`,
    arrange: () =>
      inRepository(async (root) => {
        const { runner, blocked } = await blockedByFailedCheck(root);
        await rewriteRunState(runner.store, blocked.runId, (state) => {
          const legacy = state as unknown as Record<string, unknown>;
          legacy.schemaVersion = 7;
          delete legacy.planningReview;
          delete legacy.verificationMode;
          delete legacy.taskVerification;
          delete legacy.artifactBinding;
        });
        await writeVerificationLedger(root, blocked.runId, [
          verificationAttemptFixture({ sequence: 1, status })
        ]);
        return { runner, runId: blocked.runId };
      })
  })),
  ...(
    [
      ["a malformed legacy ledger", "ledger.json"],
      ["a malformed legacy attempt", "verification-fixture-01.json"]
    ] as const
  ).map(([label, file]) => ({
    name: `blocked from verifying with ${label}`,
    arrange: () =>
      inRepository(async (root) => {
        const { runner, blocked } = await blockedByFailedCheck(root);
        await rewriteRunState(runner.store, blocked.runId, (state) => {
          const legacy = state as unknown as Record<string, unknown>;
          legacy.schemaVersion = 7;
          delete legacy.planningReview;
          delete legacy.verificationMode;
          delete legacy.taskVerification;
          delete legacy.artifactBinding;
        });
        await writeVerificationLedger(root, blocked.runId, [
          verificationAttemptFixture({ sequence: 1, status: "failed" })
        ]);
        await writeFile(
          path.join(
            path.dirname(runner.store.verificationLedgerPath(blocked.runId)),
            file
          ),
          "{",
          "utf8"
        );
        return { runner, runId: blocked.runId };
      })
  })),
  {
    name: "failed mutable implementation",
    arrange: () => inRepository((root) => failedStrictImplementation(root))
  },
  {
    name: "context-budget-blocked implementation",
    arrange: () =>
      inRepository(async (root) => {
        const arranged = await failedStrictImplementation(root);
        await rewriteActiveAttempt(
          arranged.runner,
          arranged.runId,
          (record) => {
            record.failureCode = "CONTEXT_BUDGET_EXCEEDED";
          }
        );
        return arranged;
      })
  },
  {
    name: "implementation pending completion application",
    arrange: () =>
      inRepository(async (root) => {
        const adapters = new FakeAdapters();
        adapters.reviewResults.push(passingReview());
        const runner = new WorkflowRunner(root, adapters);
        const writeCandidate = runner.store.writeCompletionCandidate.bind(
          runner.store
        );
        let injected = 0;
        runner.store.writeCompletionCandidate = async (
          runId,
          candidate,
          bytes
        ) => {
          if (injected === 0) {
            injected += 1;
            throw new Error("ENOSPC: injected candidate write failure");
          }
          await writeCandidate(runId, candidate, bytes);
        };
        await runner.start({ slug: "example", request: "Implement it." });
        const blocked = await runner.approvePlan("human");
        assert.equal(blocked.status, "blocked", "fixture must block");
        return { runner, runId: blocked.runId };
      })
  },
  ...(
    [
      ["missing_task", "completion evidence"],
      ["approved_plan_invalid", "plan bundle"]
    ] as const
  ).map(([violation, label]) => ({
    name: `implementation rejected for invalid ${label}`,
    arrange: () =>
      inRepository(async (root) => {
        const arranged = await failedStrictImplementation(root);
        const attempt = await rewriteActiveAttempt(
          arranged.runner,
          arranged.runId,
          (record) => {
            record.failureCode = "PLAN_TASK_COMPLETION_INVALID";
          }
        );
        await rewriteRunState(
          arranged.runner.store,
          arranged.runId,
          (state) => {
            state.planTaskCompletion = invalidCompletion(attempt.id, violation);
          }
        );
        return arranged;
      })
  })),
  {
    name: "interrupted implementation",
    arrange: () =>
      inRepository(async (root) => {
        const arranged = await failedStrictImplementation(root);
        await rewriteActiveAttempt(
          arranged.runner,
          arranged.runId,
          markStarted
        );
        return arranged;
      })
  },
  {
    name: "interrupted implementation with a live process",
    arrange: () =>
      inRepository(async (root) => {
        const arranged = await failedStrictImplementation(root);
        await rewriteActiveAttempt(
          arranged.runner,
          arranged.runId,
          markStarted
        );
        await rewriteRunState(
          arranged.runner.store,
          arranged.runId,
          (state) => {
            state.activeProcess = {
              pid: process.pid,
              kind: "implementation",
              startedAt: "2026-07-01T00:00:00.000Z"
            };
          }
        );
        return arranged;
      })
  },
  {
    name: "interrupted implementation with an unreadable attempt record",
    arrange: () =>
      inRepository(async (root) => {
        const arranged = await failedStrictImplementation(root);
        const attempt = await rewriteActiveAttempt(
          arranged.runner,
          arranged.runId,
          markStarted
        );
        await writeFile(
          arranged.runner.store.attemptPath(arranged.runId, attempt),
          "{",
          "utf8"
        );
        return arranged;
      })
  },
  {
    name: "interrupted implementation with a malformed verification ledger",
    arrange: () =>
      inRepository(async (root) => {
        const arranged = await failedStrictImplementation(root);
        await rewriteActiveAttempt(
          arranged.runner,
          arranged.runId,
          markStarted
        );
        await writeFile(
          arranged.runner.store.verificationLedgerPath(arranged.runId),
          "{",
          "utf8"
        );
        return arranged;
      })
  },
  {
    name: "unreadable attempt record behind an exited process",
    arrange: () =>
      inRepository(async (root) => {
        const arranged = await failedStrictImplementation(root);
        const attempt = await rewriteActiveAttempt(
          arranged.runner,
          arranged.runId,
          markStarted
        );
        await rewriteRunState(
          arranged.runner.store,
          arranged.runId,
          (state) => {
            state.activeProcess = {
              pid: 2_147_483_646,
              kind: "implementation",
              startedAt: "2026-07-01T00:00:00.000Z"
            };
          }
        );
        await writeFile(
          arranged.runner.store.attemptPath(arranged.runId, attempt),
          "{",
          "utf8"
        );
        return arranged;
      })
  },
  {
    name: "interrupted implementation after HEAD moved",
    arrange: () =>
      inRepository(async (root) => {
        const arranged = await failedStrictImplementation(root);
        await rewriteActiveAttempt(
          arranged.runner,
          arranged.runId,
          markStarted
        );
        await commitUnrelatedChange(root);
        return arranged;
      })
  },
  {
    name: "interrupted implementation after the approved bundle changed",
    arrange: () =>
      inRepository(async (root) => {
        const arranged = await failedStrictImplementation(root);
        await rewriteActiveAttempt(
          arranged.runner,
          arranged.runId,
          markStarted
        );
        await changeApprovedPlan(root);
        return arranged;
      })
  },
  {
    name: "interrupted implementation with unreadable configuration",
    arrange: () =>
      inRepository(async (root) => {
        const arranged = await failedStrictImplementation(root);
        await rewriteActiveAttempt(
          arranged.runner,
          arranged.runId,
          markStarted
        );
        await writeFile(path.join(root, ".banzai", "config.json"), "{", "utf8");
        return arranged;
      })
  },
  {
    name: "authorized interrupted implementation",
    arrange: () =>
      inRepository(async (root) => {
        const arranged = await failedStrictImplementation(root);
        await rewriteActiveAttempt(
          arranged.runner,
          arranged.runId,
          markStarted
        );
        await authorizeRecovery(arranged.runner);
        return arranged;
      })
  },
  {
    name: "authorized interrupted implementation after workspace drift",
    arrange: () =>
      inRepository(async (root) => {
        const arranged = await failedStrictImplementation(root);
        await rewriteActiveAttempt(
          arranged.runner,
          arranged.runId,
          markStarted
        );
        await authorizeRecovery(arranged.runner);
        await writeFile(path.join(root, "drift.txt"), "drift\n", "utf8");
        return arranged;
      })
  },
  {
    name: "authorized interrupted implementation with an unreadable authorization",
    arrange: () =>
      inRepository(async (root) => {
        const arranged = await failedStrictImplementation(root);
        await rewriteActiveAttempt(
          arranged.runner,
          arranged.runId,
          markStarted
        );
        await authorizeRecovery(arranged.runner);
        const state = await arranged.runner.store.readState(arranged.runId);
        await writeFile(
          arranged.runner.store.recoveryAuthorizationPath(
            arranged.runId,
            requiredFixture(state.recovery).authorizationId
          ),
          "{",
          "utf8"
        );
        return arranged;
      })
  },
  {
    name: "interrupted implementation superseded by a recovery attempt",
    arrange: () =>
      inRepository(async (root) => {
        const arranged = await failedStrictImplementation(root);
        await rewriteActiveAttempt(
          arranged.runner,
          arranged.runId,
          markStarted
        );
        await authorizeRecovery(arranged.runner);
        await rewriteRunState(
          arranged.runner.store,
          arranged.runId,
          (state) => {
            const recovery = requiredFixture(state.recovery);
            recovery.recoveryAttemptId = "implementation-recovery-fixture";
          }
        );
        return arranged;
      })
  },
  {
    name: "implementation failed after its terminal checkpoint",
    arrange: () =>
      inRepository((root) =>
        failedStrictImplementation(root, (adapters) => {
          adapters.failImplementationAfterTerminalCheckpoint = true;
        })
      )
  },
  {
    name: "implementation checkpoint rejected by completion validation",
    arrange: () =>
      inRepository((root) =>
        failedStrictImplementation(root, (adapters) => {
          adapters.implementationResults.push(
            phaseResult("implementation", { taskCompletion: null })
          );
        })
      )
  },
  {
    name: "implementation with a malformed terminal checkpoint",
    arrange: () =>
      inRepository(async (root) => {
        const arranged = await failedStrictImplementation(root, (adapters) => {
          adapters.failImplementationAfterTerminalCheckpoint = true;
        });
        const state = await arranged.runner.store.readState(arranged.runId);
        await writeFile(
          arranged.runner.store.terminalCheckpointPath(
            arranged.runId,
            requiredFixture(state.activeAttempt)
          ),
          "{",
          "utf8"
        );
        return arranged;
      })
  },
  {
    name: "interrupted lite implementation",
    arrange: () =>
      inRepository(async (root) => {
        const arranged = await failedLiteImplementation(root);
        await rewriteActiveAttempt(
          arranged.runner,
          arranged.runId,
          markStarted
        );
        return arranged;
      })
  },
  {
    name: "interrupted fix",
    arrange: () =>
      inRepository(async (root) => {
        const arranged = await failedFix(root);
        await rewriteActiveAttempt(
          arranged.runner,
          arranged.runId,
          markStarted
        );
        return arranged;
      })
  },
  {
    name: "interrupted fix without accepted findings",
    arrange: () =>
      inRepository(async (root) => {
        const arranged = await failedFix(root);
        await rewriteActiveAttempt(
          arranged.runner,
          arranged.runId,
          markStarted
        );
        await rewriteRunState(
          arranged.runner.store,
          arranged.runId,
          (state) => {
            for (const item of requiredFixture(state.triage).items)
              item.disposition = "rejected";
          }
        );
        return arranged;
      })
  },
  ...(
    [
      ["prerequisite-blocked fix", async () => {}],
      [
        "prerequisite-blocked fix with a live process",
        async (fixture: PrerequisiteFixture) => {
          await rewriteRunState(
            fixture.runner.store,
            fixture.blocked.runId,
            (state) => {
              state.activeProcess = {
                pid: process.pid,
                kind: "fix",
                startedAt: "2026-07-01T00:00:00.000Z"
              };
            }
          );
        }
      ],
      [
        "prerequisite-blocked fix after HEAD moved",
        (fixture: PrerequisiteFixture) =>
          commitUnrelatedChange(fixture.repository.root)
      ],
      [
        "prerequisite-blocked fix after the approved bundle changed",
        (fixture: PrerequisiteFixture) =>
          changeApprovedPlan(fixture.repository.root)
      ],
      [
        "prerequisite-blocked fix whose block reason changed",
        (fixture: PrerequisiteFixture) =>
          rewriteRunState(
            fixture.runner.store,
            fixture.blocked.runId,
            (state) => {
              state.blockReason = "A different prerequisite block.";
            }
          )
      ],
      [
        "prerequisite-blocked fix with an unreadable review",
        async (fixture: PrerequisiteFixture) => {
          const state = await fixture.runner.store.readState(
            fixture.blocked.runId
          );
          await writeFile(
            path.join(
              fixture.runner.store.runDirectory(fixture.blocked.runId),
              requiredFixture(state.latestReview).resultPath
            ),
            "{",
            "utf8"
          );
        }
      ],
      [
        "prerequisite-blocked fix with a started descendant",
        (fixture: PrerequisiteFixture) =>
          fixture.runner.store.writeRunAttempt(fixture.blocked.runId, {
            ...fixture.sourceRecord,
            attempt: {
              id: "fix-recovery-existing",
              kind: "fix",
              mutable: true
            },
            status: "started",
            completedAt: null,
            interruptedAt: null,
            recoveryOf: fixture.sourceRecord.attempt.id,
            recoveryAuthorizationId: "recovery-existing",
            result: null,
            durationMs: null,
            error: null,
            failureCode: null,
            failureCause: null
          })
      ],
      [
        "prerequisite-blocked fix with two matching sources",
        (fixture: PrerequisiteFixture) =>
          fixture.runner.store.writeRunAttempt(fixture.blocked.runId, {
            ...fixture.sourceRecord,
            attempt: { ...fixture.sourceRecord.attempt, id: "fix-2-ambiguous" }
          })
      ],
      [
        "prerequisite-blocked fix with a conflicting terminal checkpoint",
        async (fixture: PrerequisiteFixture) => {
          const checkpointPath = fixture.runner.store.terminalCheckpointPath(
            fixture.blocked.runId,
            fixture.sourceRecord.attempt
          );
          const checkpoint = JSON.parse(
            await readFile(checkpointPath, "utf8")
          ) as { baseCommit: string };
          checkpoint.baseCommit = "0".repeat(40);
          await writeFile(checkpointPath, JSON.stringify(checkpoint), "utf8");
        }
      ],
      [
        "authorized prerequisite-blocked fix",
        (fixture: PrerequisiteFixture) => authorizeRecovery(fixture.runner)
      ],
      [
        "authorized prerequisite-blocked fix after workspace drift",
        async (fixture: PrerequisiteFixture) => {
          await authorizeRecovery(fixture.runner);
          await writeFile(
            path.join(fixture.repository.root, "drift.txt"),
            "drift\n",
            "utf8"
          );
        }
      ],
      [
        "prerequisite-blocked fix with a mismatched recovery state",
        async (fixture: PrerequisiteFixture) => {
          await authorizeRecovery(fixture.runner);
          await rewriteRunState(
            fixture.runner.store,
            fixture.blocked.runId,
            (state) => {
              requiredFixture(state.recovery).sourceAttemptId = "fix-9-other";
            }
          );
        }
      ]
    ] as const
  ).map(([name, mutate]) => ({
    name,
    arrange: async (): Promise<EligibilityArrangement> => {
      const fixture = await prerequisiteBlockedFixFixture();
      try {
        await mutate(fixture);
      } catch (error) {
        await fixture.repository.dispose();
        throw error;
      }
      return {
        root: fixture.repository.root,
        runner: fixture.runner,
        runId: fixture.blocked.runId,
        dispose: () => fixture.repository.dispose()
      };
    }
  })),
  {
    name: "failed read-only selection",
    arrange: () => inRepository(failedSelection)
  },
  ...(
    [
      ["started", "selecting", "interrupted"],
      ["completed", "selecting", "completed"],
      ["failed", "planning", "inconsistent"]
    ] as const
  ).map(([recordStatus, blockedFrom, label]) => ({
    name: `${label} read-only selection`,
    arrange: () =>
      inRepository(async (root) => {
        const arranged = await failedSelection(root);
        await rewriteActiveAttempt(
          arranged.runner,
          arranged.runId,
          (record) => {
            record.status = recordStatus;
          }
        );
        await rewriteRunState(
          arranged.runner.store,
          arranged.runId,
          (state) => {
            state.blockedFrom = blockedFrom;
          }
        );
        return arranged;
      })
  })),
  {
    name: "failed planning",
    arrange: () => inRepository(failedPlanning)
  },
  {
    name: "interrupted planning",
    arrange: () =>
      inRepository(async (root) => {
        const arranged = await failedPlanning(root);
        await rewriteActiveAttempt(
          arranged.runner,
          arranged.runId,
          markStarted
        );
        return arranged;
      })
  },
  {
    name: "restore without a plan approval",
    observe: "restore",
    arrange: () => inRepository(strictAwaitingApproval)
  },
  {
    name: "restore with matching approved artifacts",
    observe: "restore",
    arrange: () => inRepository(strictApproved)
  },
  {
    name: "restore of a changed approved bundle",
    observe: "restore",
    arrange: () =>
      inRepository(async (root) => {
        const arranged = await strictApproved(root);
        await changeApprovedPlan(root);
        return arranged;
      })
  },
  {
    name: "restore without an approval snapshot",
    observe: "restore",
    arrange: () =>
      inRepository(async (root) => {
        const arranged = await strictApproved(root);
        await rm(
          path.join(
            arranged.runner.store.runDirectory(arranged.runId),
            "approval",
            "bundle.json"
          )
        );
        return arranged;
      })
  },
  {
    name: "restore with an unverifiable approval snapshot",
    observe: "restore",
    arrange: () =>
      inRepository(async (root) => {
        const arranged = await strictApproved(root);
        const manifest = path.join(
          arranged.runner.store.runDirectory(arranged.runId),
          "approval",
          "bundle.json"
        );
        const snapshot = JSON.parse(await readFile(manifest, "utf8")) as {
          digest: string;
        };
        snapshot.digest = "0".repeat(64);
        await writeFile(manifest, JSON.stringify(snapshot), "utf8");
        return arranged;
      })
  }
];

for (const scenario of ELIGIBILITY_SCENARIOS)
  test(`eligibility baseline: ${scenario.name}`, async () => {
    const arrangement = await scenario.arrange();
    try {
      assert.deepEqual(
        await observeEligibility(
          arrangement.runner,
          arrangement.root,
          arrangement.runId,
          scenario.observe ?? "status"
        ),
        ELIGIBILITY_BASELINE[scenario.name]
      );
    } finally {
      await arrangement.dispose();
    }
  });

for (const name of [
  "blocked from verifying with malformed task evidence",
  "blocked from verifying with a malformed legacy ledger"
])
  test(`status retry snapshots stay independent across calls (${name})`, async () => {
    const scenario = requiredFixture(
      ELIGIBILITY_SCENARIOS.find((candidate) => candidate.name === name)
    );
    const arrangement = await scenario.arrange();
    try {
      // The caller owns its snapshot; editing it must not reach the next call.
      const first = await arrangement.runner.status();
      first.retry.eligible = true;
      first.retry.reason = "Caller changed its own status snapshot.";
      assert.deepEqual(
        await observeEligibility(
          arrangement.runner,
          arrangement.root,
          arrangement.runId
        ),
        ELIGIBILITY_BASELINE[name]
      );
    } finally {
      await arrangement.dispose();
    }
  });

// Workspace v3 observes missing selected documents and excludes executor evidence.
const ELIGIBILITY_BASELINE: Readonly<Record<string, unknown>> = {
  "awaiting plan approval": {
    observed: {
      retry: {
        eligible: false,
        reason:
          "Retry requires a blocked run, but the run is needs_plan_approval.",
        attemptId: null
      },
      recovery: {
        eligible: false,
        terminalCheckpointPresent: false,
        reason:
          "Recovery requires a blocked run, but the run is needs_plan_approval.",
        warning:
          "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.",
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
      nextAction: "banzai approve plan"
    },
    persisted: {
      status: "needs_plan_approval",
      blockedFrom: null,
      blockReason: null
    }
  },
  "awaiting triage": {
    observed: {
      retry: {
        eligible: false,
        reason: "Retry requires a blocked run, but the run is needs_triage.",
        attemptId: null
      },
      recovery: {
        eligible: false,
        terminalCheckpointPresent: false,
        reason: "Recovery requires a blocked run, but the run is needs_triage.",
        warning:
          "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.",
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
      nextAction: "banzai triage"
    },
    persisted: {
      status: "needs_triage",
      blockedFrom: null,
      blockReason: null
    }
  },
  "persisted status needs_adr_approval": {
    observed: {
      retry: {
        eligible: false,
        reason:
          "Retry requires a blocked run, but the run is needs_adr_approval.",
        attemptId: null
      },
      recovery: {
        eligible: false,
        terminalCheckpointPresent: false,
        reason:
          "Recovery requires a blocked run, but the run is needs_adr_approval.",
        warning:
          "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.",
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
      nextAction: "banzai approve adr"
    },
    persisted: {
      status: "needs_adr_approval",
      blockedFrom: null,
      blockReason: null
    }
  },
  "persisted status implementing": {
    observed: {
      retry: {
        eligible: false,
        reason: "Retry requires a blocked run, but the run is implementing.",
        attemptId: null
      },
      recovery: {
        eligible: false,
        terminalCheckpointPresent: false,
        reason: "Recovery requires a blocked run, but the run is implementing.",
        warning:
          "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.",
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
      nextAction: "banzai resume"
    },
    persisted: {
      status: "implementing",
      blockedFrom: null,
      blockReason: null
    }
  },
  "persisted status cancelled": {
    observed: {
      retry: {
        eligible: false,
        reason: "Retry requires a blocked run, but the run is cancelled.",
        attemptId: null
      },
      recovery: {
        eligible: false,
        terminalCheckpointPresent: false,
        reason: "Recovery requires a blocked run, but the run is cancelled.",
        warning:
          "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.",
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
      nextAction: null
    },
    persisted: {
      status: "cancelled",
      blockedFrom: null,
      blockReason: null
    }
  },
  "planning escalation awaiting a human decision": {
    observed: {
      retry: {
        eligible: false,
        reason:
          "Retry requires a blocked run, but the run is needs_human_decision.",
        attemptId: null
      },
      recovery: {
        eligible: false,
        terminalCheckpointPresent: false,
        reason:
          "Recovery requires a blocked run, but the run is needs_human_decision.",
        warning:
          "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.",
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
      nextAction: "banzai"
    },
    persisted: {
      status: "needs_human_decision",
      blockedFrom: null,
      blockReason: null
    }
  },
  "completed lite run": {
    observed: {
      retry: {
        eligible: false,
        reason: "Retry requires a blocked run, but the run is done.",
        attemptId: null
      },
      recovery: {
        eligible: false,
        terminalCheckpointPresent: false,
        reason: "Recovery requires a blocked run, but the run is done.",
        warning:
          "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.",
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
      nextAction: null
    },
    persisted: {
      status: "done",
      blockedFrom: null,
      blockReason: null
    }
  },
  "blocked from created without an attempt": {
    observed: {
      retry: {
        eligible: true,
        reason:
          "Startup checks can be retried after resolving the reported prerequisite.",
        attemptId: null
      },
      recovery: {
        eligible: false,
        terminalCheckpointPresent: false,
        reason:
          "Recovery requires an interrupted mutable implementation or fix attempt.",
        warning:
          "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.",
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
      nextAction: "banzai retry"
    },
    persisted: {
      status: "blocked",
      blockedFrom: "created",
      blockReason: "Fixture block."
    }
  },
  "blocked from reviewing without an attempt": {
    observed: {
      retry: {
        eligible: true,
        reason:
          "Review checks can be retried after resolving the reported prerequisite.",
        attemptId: null
      },
      recovery: {
        eligible: false,
        terminalCheckpointPresent: false,
        reason:
          "Recovery requires an interrupted mutable implementation or fix attempt.",
        warning:
          "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.",
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
      nextAction: "banzai retry"
    },
    persisted: {
      status: "blocked",
      blockedFrom: "reviewing",
      blockReason: "Fixture block."
    }
  },
  "blocked from planning without an attempt": {
    observed: {
      retry: {
        eligible: false,
        reason:
          "This blocked state is not tied to a failed attempt. Resolve it manually or cancel the run.",
        attemptId: null
      },
      recovery: {
        eligible: false,
        terminalCheckpointPresent: false,
        reason:
          "Recovery requires an interrupted mutable implementation or fix attempt.",
        warning:
          "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.",
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
      nextAction: "banzai cancel"
    },
    persisted: {
      status: "blocked",
      blockedFrom: "planning",
      blockReason: "Fixture block."
    }
  },
  "blocked from plan_approved without an attempt after approval changed": {
    observed: {
      retry: {
        eligible: true,
        reason:
          "Implementation checks can be retried after resolving the reported prerequisite.",
        attemptId: null
      },
      recovery: {
        eligible: false,
        terminalCheckpointPresent: false,
        reason:
          "Recovery requires an interrupted mutable implementation or fix attempt.",
        warning:
          "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.",
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
      nextAction: "banzai retry"
    },
    persisted: {
      status: "blocked",
      blockedFrom: "plan_approved",
      blockReason:
        "Approved planning artifacts changed. Restore the approved bundle (banzai restore) and retry, or cancel the run and approve a revised plan in a new run."
    }
  },
  "blocked from implementing without an attempt after approval changed": {
    observed: {
      retry: {
        eligible: true,
        reason:
          "Implementation checks can be retried after resolving the reported prerequisite.",
        attemptId: null
      },
      recovery: {
        eligible: false,
        terminalCheckpointPresent: false,
        reason:
          "Recovery requires an interrupted mutable implementation or fix attempt.",
        warning:
          "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.",
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
      nextAction: "banzai retry"
    },
    persisted: {
      status: "blocked",
      blockedFrom: "implementing",
      blockReason:
        "Approved planning artifacts changed. Restore the approved bundle (banzai restore) and retry, or cancel the run and approve a revised plan in a new run."
    }
  },
  "blocked from fixing without an attempt after approval changed": {
    observed: {
      retry: {
        eligible: true,
        reason:
          "Fix checks can be retried after resolving the reported prerequisite.",
        attemptId: null
      },
      recovery: {
        eligible: false,
        terminalCheckpointPresent: false,
        reason: "Implementation requires explicit plan approval.",
        warning:
          "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.",
        sourceKind: null,
        attemptId: null,
        phase: "fix",
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
      nextAction: "banzai retry"
    },
    persisted: {
      status: "blocked",
      blockedFrom: "fixing",
      blockReason:
        "Approved planning artifacts changed. Restore the approved bundle (banzai restore) and retry, or cancel the run and approve a revised plan in a new run."
    }
  },
  "blocked while a model process is active": {
    observed: {
      retry: {
        eligible: false,
        reason: "Retry is unavailable while a model process is still active.",
        attemptId: null
      },
      recovery: {
        eligible: false,
        terminalCheckpointPresent: false,
        reason:
          "Recovery requires an interrupted mutable implementation or fix attempt.",
        warning:
          "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.",
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
      nextAction: "banzai cancel"
    },
    persisted: {
      status: "blocked",
      blockedFrom: "created",
      blockReason: "Fixture block."
    }
  },
  "approved bundle changed before implementation": {
    observed: {
      retry: {
        eligible: true,
        reason:
          "Implementation checks can be retried after resolving the reported prerequisite.",
        attemptId: null
      },
      recovery: {
        eligible: false,
        terminalCheckpointPresent: false,
        reason:
          "Recovery requires an interrupted mutable implementation or fix attempt.",
        warning:
          "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.",
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
      nextAction: "banzai retry"
    },
    persisted: {
      status: "blocked",
      blockedFrom: "plan_approved",
      blockReason:
        "Approved planning artifacts changed. Restore the approved bundle (banzai restore) and retry, or cancel the run and approve a revised plan in a new run."
    }
  },
  "failed task check": {
    observed: {
      retry: {
        eligible: true,
        reason: "The unsuccessful task check can be retried explicitly.",
        attemptId: "verification-<uuid>"
      },
      recovery: {
        eligible: false,
        terminalCheckpointPresent: false,
        reason:
          "Recovery requires an interrupted mutable implementation or fix attempt.",
        warning:
          "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.",
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
      nextAction: "banzai retry"
    },
    persisted: {
      status: "blocked",
      blockedFrom: "verifying",
      blockReason:
        "Task verification is incomplete. Inspect the retained physical evidence and retry the failed check without replaying implementation."
    }
  },
  "blocked from verifying after every task check completed": {
    observed: {
      retry: {
        eligible: true,
        reason:
          "Verification prerequisites can be retried without replaying implementation.",
        attemptId: null
      },
      recovery: {
        eligible: false,
        terminalCheckpointPresent: false,
        reason:
          "Recovery requires an interrupted mutable implementation or fix attempt.",
        warning:
          "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.",
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
      nextAction: "banzai retry"
    },
    persisted: {
      status: "blocked",
      blockedFrom: "verifying",
      blockReason: "Fixture verification block."
    }
  },
  "blocked from verifying with an unresolved physical task check": {
    observed: {
      retry: {
        eligible: true,
        reason:
          "Retry reconciles the unresolved physical attempt before running eligible checks.",
        attemptId: null
      },
      recovery: {
        eligible: false,
        terminalCheckpointPresent: false,
        reason:
          "Recovery requires an interrupted mutable implementation or fix attempt.",
        warning:
          "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.",
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
      nextAction: "banzai retry"
    },
    persisted: {
      status: "blocked",
      blockedFrom: "verifying",
      blockReason: "Fixture verification block."
    }
  },
  "blocked from verifying with an unresolved digest": {
    observed: {
      retry: {
        eligible: false,
        reason:
          "A digest this run's result authored does not match the bytes it names, and no recorded baseline shows those bytes changed after acceptance. Retrying reads the same bytes and fails identically. Inspect the checkout, then cancel the run.",
        attemptId: null
      },
      recovery: {
        eligible: false,
        terminalCheckpointPresent: false,
        reason:
          "Recovery requires an interrupted mutable implementation or fix attempt.",
        warning:
          "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.",
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
      nextAction: "banzai cancel"
    },
    persisted: {
      status: "blocked",
      blockedFrom: "verifying",
      blockReason:
        "[RESULT_DIGEST_UNRESOLVED] The recorded digest does not match."
    }
  },
  "blocked from verifying with malformed task evidence": {
    observed: {
      retry: {
        eligible: false,
        reason:
          "Verification evidence is malformed or conflicting. Audit the run before continuing.",
        attemptId: null
      },
      recovery: {
        eligible: false,
        terminalCheckpointPresent: false,
        reason:
          "Recovery requires an interrupted mutable implementation or fix attempt.",
        warning:
          "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.",
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
      nextAction: "banzai cancel"
    },
    persisted: {
      status: "blocked",
      blockedFrom: "verifying",
      blockReason:
        "Task verification is incomplete. Inspect the retained physical evidence and retry the failed check without replaying implementation."
    }
  },
  "blocked from verifying with invalid completion evidence": {
    observed: {
      retry: {
        eligible: true,
        reason:
          "Completion evidence rejected at revalidation can be repaired with a new implementation attempt.",
        attemptId: "implementation-1-fixture"
      },
      recovery: {
        eligible: false,
        terminalCheckpointPresent: false,
        reason:
          "Recovery requires an interrupted mutable implementation or fix attempt.",
        warning:
          "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.",
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
      nextAction: "banzai retry"
    },
    persisted: {
      status: "blocked",
      blockedFrom: "verifying",
      blockReason:
        "Task verification is incomplete. Inspect the retained physical evidence and retry the failed check without replaying implementation."
    }
  },
  "blocked from verifying with invalid plan bundle": {
    observed: {
      retry: {
        eligible: true,
        reason:
          "The approved plan bundle is invalid; retry reruns planning for a corrected bundle and a new approval.",
        attemptId: "implementation-1-fixture"
      },
      recovery: {
        eligible: false,
        terminalCheckpointPresent: false,
        reason:
          "Recovery requires an interrupted mutable implementation or fix attempt.",
        warning:
          "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.",
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
      nextAction: "banzai retry"
    },
    persisted: {
      status: "blocked",
      blockedFrom: "verifying",
      blockReason:
        "Task verification is incomplete. Inspect the retained physical evidence and retry the failed check without replaying implementation."
    }
  },
  "blocked from verifying without a legacy ledger": {
    observed: {
      retry: {
        eligible: false,
        reason:
          "Legacy verification evidence has no retryable durable attempt identity. Inspect the checkout, then cancel the run.",
        attemptId: null
      },
      recovery: {
        eligible: false,
        terminalCheckpointPresent: false,
        reason:
          "Recovery requires an interrupted mutable implementation or fix attempt.",
        warning:
          "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.",
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
      nextAction: "banzai cancel"
    },
    persisted: {
      status: "blocked",
      blockedFrom: "verifying",
      blockReason:
        "Task verification is incomplete. Inspect the retained physical evidence and retry the failed check without replaying implementation."
    }
  },
  "blocked from verifying with a failed legacy attempt": {
    observed: {
      retry: {
        eligible: true,
        reason:
          "Failed verification attempt verification-attempt-1 can be retried explicitly.",
        attemptId: "verification-attempt-1"
      },
      recovery: {
        eligible: false,
        terminalCheckpointPresent: false,
        reason:
          "Recovery requires an interrupted mutable implementation or fix attempt.",
        warning:
          "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.",
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
      nextAction: "banzai retry"
    },
    persisted: {
      status: "blocked",
      blockedFrom: "verifying",
      blockReason:
        "Task verification is incomplete. Inspect the retained physical evidence and retry the failed check without replaying implementation."
    }
  },
  "blocked from verifying with a completed legacy attempt": {
    observed: {
      retry: {
        eligible: false,
        reason:
          "This blocked state is not tied to a failed attempt. Resolve it manually or cancel the run.",
        attemptId: null
      },
      recovery: {
        eligible: false,
        terminalCheckpointPresent: false,
        reason:
          "Recovery requires an interrupted mutable implementation or fix attempt.",
        warning:
          "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.",
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
      nextAction: "banzai cancel"
    },
    persisted: {
      status: "blocked",
      blockedFrom: "verifying",
      blockReason:
        "Task verification is incomplete. Inspect the retained physical evidence and retry the failed check without replaying implementation."
    }
  },
  "failed mutable implementation": {
    observed: {
      retry: {
        eligible: false,
        reason:
          "Failed mutable attempts cannot be retried because their repository side effects may be incomplete. Inspect the checkout, then cancel the run.",
        attemptId: "implementation-1-<id>"
      },
      recovery: {
        eligible: false,
        terminalCheckpointPresent: false,
        reason:
          "Attempt implementation-1-<id> is not an uncompleted interruption.",
        warning:
          "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.",
        sourceKind: null,
        attemptId: "implementation-1-<id>",
        phase: "implementation",
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
      nextAction: "banzai cancel"
    },
    persisted: {
      status: "blocked",
      blockedFrom: "implementing",
      blockReason: "implementation failed: implementation interrupted"
    }
  },
  "context-budget-blocked implementation": {
    observed: {
      retry: {
        eligible: true,
        reason:
          "Context-budget-blocked implementation attempt implementation-1-<id> can be retried explicitly after policy or authorized input changes because no vendor process started.",
        attemptId: "implementation-1-<id>"
      },
      recovery: {
        eligible: false,
        terminalCheckpointPresent: false,
        reason:
          "Attempt implementation-1-<id> is not an uncompleted interruption.",
        warning:
          "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.",
        sourceKind: null,
        attemptId: "implementation-1-<id>",
        phase: "implementation",
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
      nextAction: "banzai retry"
    },
    persisted: {
      status: "blocked",
      blockedFrom: "implementing",
      blockReason: "implementation failed: implementation interrupted"
    }
  },
  "implementation pending completion application": {
    observed: {
      retry: {
        eligible: false,
        reason:
          "Completion publication for this attempt is pending; use banzai resume to reconcile it without another model call, or cancel the run.",
        attemptId: "implementation-1-<id>"
      },
      recovery: {
        eligible: false,
        terminalCheckpointPresent: true,
        reason:
          "A terminal checkpoint exists; use banzai resume so Banzai can reconcile proven completion.",
        warning:
          "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.",
        sourceKind: null,
        attemptId: "implementation-1-<id>",
        phase: "implementation",
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
      nextAction: "banzai resume"
    },
    persisted: {
      status: "blocked",
      blockedFrom: "implementing",
      blockReason:
        "[COMPLETION_PUBLICATION_IO] Completion publication for implementation attempt implementation-1-<id> stopped at stage candidate. Retry with banzai resume once storage is available, or cancel."
    }
  },
  "implementation rejected for invalid completion evidence": {
    observed: {
      retry: {
        eligible: true,
        reason:
          "Completion evidence for implementation attempt implementation-1-<id> can be repaired with a new attempt.",
        attemptId: "implementation-1-<id>"
      },
      recovery: {
        eligible: false,
        terminalCheckpointPresent: false,
        reason:
          "Attempt implementation-1-<id> is not an uncompleted interruption.",
        warning:
          "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.",
        sourceKind: null,
        attemptId: "implementation-1-<id>",
        phase: "implementation",
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
      nextAction: "banzai retry"
    },
    persisted: {
      status: "blocked",
      blockedFrom: "implementing",
      blockReason: "implementation failed: implementation interrupted"
    }
  },
  "implementation rejected for invalid plan bundle": {
    observed: {
      retry: {
        eligible: true,
        reason:
          "The approved plan bundle is invalid; retry reruns planning for a corrected bundle and a new approval.",
        attemptId: "implementation-1-<id>"
      },
      recovery: {
        eligible: false,
        terminalCheckpointPresent: false,
        reason:
          "Attempt implementation-1-<id> is not an uncompleted interruption.",
        warning:
          "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.",
        sourceKind: null,
        attemptId: "implementation-1-<id>",
        phase: "implementation",
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
      nextAction: "banzai retry"
    },
    persisted: {
      status: "blocked",
      blockedFrom: "implementing",
      blockReason: "implementation failed: implementation interrupted"
    }
  },
  "interrupted implementation": {
    observed: {
      retry: {
        eligible: false,
        reason:
          "Failed mutable attempts cannot be retried because their repository side effects may be incomplete. Inspect the checkout, then cancel the run.",
        attemptId: "implementation-1-<id>"
      },
      recovery: {
        eligible: true,
        reason:
          "Interrupted implementation attempt implementation-1-<id> may be recovered only with current explicit authorization.",
        warning:
          "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.",
        sourceKind: "interrupted",
        attemptId: "implementation-1-<id>",
        phase: "implementation",
        resolvedFindingIds: [],
        remainingFindingIds: [],
        prerequisites: [],
        authorization: "plan_approval",
        recoveryIdentity: "<sha256>",
        workspace: {
          digest: "<sha256>",
          added: 3,
          modified: 0,
          deleted: 4,
          total: 7
        },
        baseCommit: "<commit>",
        approvalDigest: "<sha256>",
        workflowDigest: null,
        scopeDigest: "<sha256>",
        configurationDigest: "<sha256>"
      },
      nextAction: "banzai recover"
    },
    persisted: {
      status: "blocked",
      blockedFrom: "implementing",
      blockReason: "implementation failed: implementation interrupted"
    }
  },
  "interrupted implementation with a live process": {
    observed: {
      retry: {
        eligible: false,
        reason: "Retry is unavailable while a model process is still active.",
        attemptId: "implementation-1-<id>"
      },
      recovery: {
        eligible: false,
        terminalCheckpointPresent: false,
        reason:
          "Recovery is unavailable while the model process is still active.",
        warning:
          "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.",
        sourceKind: null,
        attemptId: "implementation-1-<id>",
        phase: "implementation",
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
      nextAction: "banzai cancel"
    },
    persisted: {
      status: "blocked",
      blockedFrom: "implementing",
      blockReason: "implementation failed: implementation interrupted"
    }
  },
  "interrupted implementation with an unreadable attempt record": {
    observed: {
      error: {
        code: "STATE_READ_FAILED",
        message:
          "Could not read attempt implementation-1-<id>: Expected property name or '}' in JSON at position 1 (line 1 column 2)"
      }
    },
    persisted: {
      status: "blocked",
      blockedFrom: "implementing",
      blockReason: "implementation failed: implementation interrupted"
    }
  },
  "unreadable attempt record behind an exited process": {
    observed: {
      retry: {
        eligible: false,
        reason: "Retry is unavailable while a model process is still active.",
        attemptId: "implementation-1-<id>"
      },
      recovery: {
        eligible: false,
        terminalCheckpointPresent: false,
        reason: "Digest acceptance evidence is unreadable or inconsistent.",
        warning:
          "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.",
        sourceKind: null,
        attemptId: "implementation-1-<id>",
        phase: "implementation",
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
      nextAction: "banzai cancel"
    },
    persisted: {
      status: "blocked",
      blockedFrom: "implementing",
      blockReason: "implementation failed: implementation interrupted"
    }
  },
  "interrupted implementation after HEAD moved": {
    observed: {
      retry: {
        eligible: false,
        reason:
          "Failed mutable attempts cannot be retried because their repository side effects may be incomplete. Inspect the checkout, then cancel the run.",
        attemptId: "implementation-1-<id>"
      },
      recovery: {
        eligible: false,
        terminalCheckpointPresent: false,
        reason: "Recovery is unavailable because checkout HEAD changed.",
        warning:
          "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.",
        sourceKind: null,
        attemptId: "implementation-1-<id>",
        phase: "implementation",
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
      nextAction: "banzai cancel"
    },
    persisted: {
      status: "blocked",
      blockedFrom: "implementing",
      blockReason: "implementation failed: implementation interrupted"
    }
  },
  "interrupted implementation after the approved bundle changed": {
    observed: {
      retry: {
        eligible: false,
        reason:
          "Failed mutable attempts cannot be retried because their repository side effects may be incomplete. Inspect the checkout, then cancel the run.",
        attemptId: "implementation-1-<id>"
      },
      recovery: {
        eligible: false,
        terminalCheckpointPresent: false,
        reason:
          "Recovery preconditions could not be validated; inspect or cancel the run.",
        warning:
          "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.",
        sourceKind: null,
        attemptId: "implementation-1-<id>",
        phase: "implementation",
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
      nextAction: "banzai cancel"
    },
    persisted: {
      status: "blocked",
      blockedFrom: "implementing",
      blockReason:
        "Approved planning artifacts changed. Restore the approved bundle (banzai restore) and retry, or cancel the run and approve a revised plan in a new run."
    }
  },
  "interrupted implementation with unreadable configuration": {
    observed: {
      retry: {
        eligible: false,
        reason:
          "Failed mutable attempts cannot be retried because their repository side effects may be incomplete. Inspect the checkout, then cancel the run.",
        attemptId: "implementation-1-<id>"
      },
      recovery: {
        eligible: false,
        terminalCheckpointPresent: false,
        reason:
          "Recovery preconditions could not be validated; inspect or cancel the run.",
        warning:
          "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.",
        sourceKind: null,
        attemptId: "implementation-1-<id>",
        phase: "implementation",
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
      nextAction: "banzai cancel"
    },
    persisted: {
      status: "blocked",
      blockedFrom: "implementing",
      blockReason: "implementation failed: implementation interrupted"
    }
  },
  "authorized interrupted implementation": {
    observed: {
      retry: {
        eligible: false,
        reason:
          "Failed mutable attempts cannot be retried because their repository side effects may be incomplete. Inspect the checkout, then cancel the run.",
        attemptId: "implementation-1-<id>"
      },
      recovery: {
        eligible: true,
        reason:
          "Interrupted implementation attempt implementation-1-<id> may be recovered only with current explicit authorization.",
        warning:
          "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.",
        sourceKind: "interrupted",
        attemptId: "implementation-1-<id>",
        phase: "implementation",
        resolvedFindingIds: [],
        remainingFindingIds: [],
        prerequisites: [],
        authorization: "plan_approval",
        recoveryIdentity: "<sha256>",
        workspace: {
          digest: "<sha256>",
          added: 3,
          modified: 0,
          deleted: 4,
          total: 7
        },
        baseCommit: "<commit>",
        approvalDigest: "<sha256>",
        workflowDigest: null,
        scopeDigest: "<sha256>",
        configurationDigest: "<sha256>"
      },
      nextAction: "banzai recover"
    },
    persisted: {
      status: "blocked",
      blockedFrom: "implementing",
      blockReason: "implementation failed: implementation interrupted"
    }
  },
  "authorized interrupted implementation after workspace drift": {
    observed: {
      retry: {
        eligible: false,
        reason:
          "Failed mutable attempts cannot be retried because their repository side effects may be incomplete. Inspect the checkout, then cancel the run.",
        attemptId: "implementation-1-<id>"
      },
      recovery: {
        eligible: false,
        terminalCheckpointPresent: false,
        reason: "Persisted recovery authorization is stale or inconsistent.",
        warning:
          "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.",
        sourceKind: null,
        attemptId: "implementation-1-<id>",
        phase: "implementation",
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
      nextAction: "banzai cancel"
    },
    persisted: {
      status: "blocked",
      blockedFrom: "implementing",
      blockReason: "implementation failed: implementation interrupted"
    }
  },
  "interrupted implementation superseded by a recovery attempt": {
    observed: {
      retry: {
        eligible: false,
        reason:
          "Failed mutable attempts cannot be retried because their repository side effects may be incomplete. Inspect the checkout, then cancel the run.",
        attemptId: "implementation-1-<id>"
      },
      recovery: {
        eligible: false,
        terminalCheckpointPresent: false,
        reason:
          "A later recovery attempt already supersedes this interruption.",
        warning:
          "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.",
        sourceKind: null,
        attemptId: "implementation-1-<id>",
        phase: "implementation",
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
      nextAction: "banzai cancel"
    },
    persisted: {
      status: "blocked",
      blockedFrom: "implementing",
      blockReason: "implementation failed: implementation interrupted"
    }
  },
  "implementation failed after its terminal checkpoint": {
    observed: {
      retry: {
        eligible: false,
        reason:
          "Failed mutable attempts cannot be retried because their repository side effects may be incomplete. Inspect the checkout, then cancel the run.",
        attemptId: "implementation-1-<id>"
      },
      recovery: {
        eligible: false,
        terminalCheckpointPresent: true,
        reason:
          "A terminal checkpoint exists; use banzai resume so Banzai can reconcile proven completion.",
        warning:
          "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.",
        sourceKind: null,
        attemptId: "implementation-1-<id>",
        phase: "implementation",
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
      nextAction: "banzai resume"
    },
    persisted: {
      status: "blocked",
      blockedFrom: "implementing",
      blockReason:
        "implementation failed: parent interrupted after terminal checkpoint"
    }
  },
  "implementation checkpoint rejected by completion validation": {
    observed: {
      retry: {
        eligible: true,
        reason:
          "Completion evidence for implementation attempt implementation-1-<id> can be repaired with a new attempt.",
        attemptId: "implementation-1-<id>"
      },
      recovery: {
        eligible: false,
        terminalCheckpointPresent: true,
        reason:
          "The terminal checkpoint result was rejected by completion validation; use banzai retry to repair its evidence.",
        warning:
          "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.",
        sourceKind: null,
        attemptId: "implementation-1-<id>",
        phase: "implementation",
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
      nextAction: "banzai retry"
    },
    persisted: {
      status: "blocked",
      blockedFrom: "implementing",
      blockReason:
        "[PLAN_TASK_COMPLETION_INVALID] Strict implementation result is missing taskCompletion."
    }
  },
  "implementation with a malformed terminal checkpoint": {
    observed: {
      retry: {
        eligible: false,
        reason:
          "Failed mutable attempts cannot be retried because their repository side effects may be incomplete. Inspect the checkout, then cancel the run.",
        attemptId: "implementation-1-<id>"
      },
      recovery: {
        eligible: false,
        terminalCheckpointPresent: false,
        reason:
          "Terminal checkpoint evidence is malformed or conflicting; inspect or cancel the run.",
        warning:
          "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.",
        sourceKind: null,
        attemptId: "implementation-1-<id>",
        phase: "implementation",
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
      nextAction: "banzai cancel"
    },
    persisted: {
      status: "blocked",
      blockedFrom: "implementing",
      blockReason:
        "implementation failed: parent interrupted after terminal checkpoint"
    }
  },
  "interrupted lite implementation": {
    observed: {
      retry: {
        eligible: false,
        reason:
          "Failed mutable attempts cannot be retried because their repository side effects may be incomplete. Inspect the checkout, then cancel the run.",
        attemptId: "implementation-1-<id>"
      },
      recovery: {
        eligible: true,
        reason:
          "Interrupted implementation attempt implementation-1-<id> may be recovered only with current explicit authorization.",
        warning:
          "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.",
        sourceKind: "interrupted",
        attemptId: "implementation-1-<id>",
        phase: "implementation",
        resolvedFindingIds: [],
        remainingFindingIds: [],
        prerequisites: [],
        authorization: "workflow_selection",
        recoveryIdentity: "<sha256>",
        workspace: {
          digest: "<sha256>",
          added: 1,
          modified: 0,
          deleted: 6,
          total: 7
        },
        baseCommit: "<commit>",
        approvalDigest: null,
        workflowDigest: "<sha256>",
        scopeDigest: "<sha256>",
        configurationDigest: "<sha256>"
      },
      nextAction: "banzai recover"
    },
    persisted: {
      status: "blocked",
      blockedFrom: "implementing",
      blockReason: "implementation failed: implementation interrupted"
    }
  },
  "interrupted fix": {
    observed: {
      retry: {
        eligible: false,
        reason:
          "Failed mutable attempts cannot be retried because their repository side effects may be incomplete. Inspect the checkout, then cancel the run.",
        attemptId: "fix-2-<id>"
      },
      recovery: {
        eligible: true,
        reason:
          "Interrupted fix attempt fix-2-<id> may be recovered only with current explicit authorization.",
        warning:
          "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.",
        sourceKind: "interrupted",
        attemptId: "fix-2-<id>",
        phase: "fix",
        resolvedFindingIds: [],
        remainingFindingIds: [],
        prerequisites: [],
        authorization: "plan_approval",
        recoveryIdentity: "<sha256>",
        workspace: {
          digest: "<sha256>",
          added: 6,
          modified: 0,
          deleted: 2,
          total: 8
        },
        baseCommit: "<commit>",
        approvalDigest: "<sha256>",
        workflowDigest: null,
        scopeDigest: "<sha256>",
        configurationDigest: "<sha256>"
      },
      nextAction: "banzai recover"
    },
    persisted: {
      status: "blocked",
      blockedFrom: "fixing",
      blockReason: "fix failed: fix interrupted"
    }
  },
  "interrupted fix without accepted findings": {
    observed: {
      retry: {
        eligible: false,
        reason:
          "Failed mutable attempts cannot be retried because their repository side effects may be incomplete. Inspect the checkout, then cancel the run.",
        attemptId: "fix-2-<id>"
      },
      recovery: {
        eligible: false,
        terminalCheckpointPresent: false,
        reason:
          "Fix recovery requires a non-empty current accepted-finding scope.",
        warning:
          "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.",
        sourceKind: null,
        attemptId: "fix-2-<id>",
        phase: "fix",
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
      nextAction: "banzai cancel"
    },
    persisted: {
      status: "blocked",
      blockedFrom: "fixing",
      blockReason: "fix failed: fix interrupted"
    }
  },
  "prerequisite-blocked fix": {
    observed: {
      retry: {
        eligible: false,
        reason:
          "This blocked state is not tied to a failed attempt. Resolve it manually or cancel the run.",
        attemptId: null
      },
      recovery: {
        eligible: true,
        reason:
          "Completed blocked fix attempt fix-2-<id> may be recovered for remaining accepted findings R1-F3 after 2 operator prerequisites.",
        warning:
          "The source attempt remains completed and blocked. Recovery authorizes one new fix attempt for the exact remaining accepted scope after the displayed prerequisites are addressed.",
        sourceKind: "prerequisite_blocked_fix",
        attemptId: "fix-2-<id>",
        phase: "fix",
        resolvedFindingIds: ["R1-F2", "R1-F5", "R1-F6"],
        remainingFindingIds: ["R1-F3"],
        prerequisites: [
          "Run the migration round trip.",
          "Verify the generated schema catalog."
        ],
        authorization: "plan_approval",
        recoveryIdentity: "<sha256>",
        workspace: {
          digest: "<sha256>",
          added: 6,
          modified: 0,
          deleted: 2,
          total: 8
        },
        baseCommit: "<commit>",
        approvalDigest: "<sha256>",
        workflowDigest: null,
        scopeDigest: "<sha256>",
        configurationDigest: "<sha256>"
      },
      nextAction: "banzai recover"
    },
    persisted: {
      status: "blocked",
      blockedFrom: "fixing",
      blockReason: "Migration round-trip evidence requires operator commands."
    }
  },
  "prerequisite-blocked fix with a live process": {
    observed: {
      retry: {
        eligible: false,
        reason: "Retry is unavailable while a model process is still active.",
        attemptId: null
      },
      recovery: {
        eligible: false,
        terminalCheckpointPresent: false,
        reason:
          "Prerequisite recovery requires a completed blocked fix with no active attempt or process.",
        warning:
          "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.",
        sourceKind: null,
        attemptId: null,
        phase: "fix",
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
      nextAction: "banzai cancel"
    },
    persisted: {
      status: "blocked",
      blockedFrom: "fixing",
      blockReason: "Migration round-trip evidence requires operator commands."
    }
  },
  "prerequisite-blocked fix after HEAD moved": {
    observed: {
      retry: {
        eligible: false,
        reason:
          "This blocked state is not tied to a failed attempt. Resolve it manually or cancel the run.",
        attemptId: null
      },
      recovery: {
        eligible: false,
        terminalCheckpointPresent: false,
        reason: "Recovery is unavailable because checkout HEAD changed.",
        warning:
          "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.",
        sourceKind: null,
        attemptId: null,
        phase: "fix",
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
      nextAction: "banzai cancel"
    },
    persisted: {
      status: "blocked",
      blockedFrom: "fixing",
      blockReason: "Migration round-trip evidence requires operator commands."
    }
  },
  "prerequisite-blocked fix after the approved bundle changed": {
    observed: {
      retry: {
        eligible: false,
        reason:
          "This blocked state is not tied to a failed attempt. Resolve it manually or cancel the run.",
        attemptId: null
      },
      recovery: {
        eligible: false,
        terminalCheckpointPresent: false,
        reason:
          "Approved planning artifacts changed. Run `banzai restore` to write back the approved bytes and then `banzai retry`, or cancel the run and approve a revised plan in a new run.",
        warning:
          "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.",
        sourceKind: null,
        attemptId: null,
        phase: "fix",
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
      nextAction: "banzai cancel"
    },
    persisted: {
      status: "blocked",
      blockedFrom: "fixing",
      blockReason:
        "Approved planning artifacts changed. Restore the approved bundle (banzai restore) and retry, or cancel the run and approve a revised plan in a new run."
    }
  },
  "prerequisite-blocked fix whose block reason changed": {
    observed: {
      retry: {
        eligible: false,
        reason:
          "This blocked state is not tied to a failed attempt. Resolve it manually or cancel the run.",
        attemptId: null
      },
      recovery: {
        eligible: false,
        terminalCheckpointPresent: false,
        reason:
          "No exact completed prerequisite-blocked fix source is available.",
        warning:
          "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.",
        sourceKind: null,
        attemptId: null,
        phase: "fix",
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
      nextAction: "banzai cancel"
    },
    persisted: {
      status: "blocked",
      blockedFrom: "fixing",
      blockReason: "A different prerequisite block."
    }
  },
  "prerequisite-blocked fix with a started descendant": {
    observed: {
      retry: {
        eligible: false,
        reason:
          "This blocked state is not tied to a failed attempt. Resolve it manually or cancel the run.",
        attemptId: null
      },
      recovery: {
        eligible: false,
        terminalCheckpointPresent: false,
        reason:
          "A recovery descendant already exists for the completed blocked fix source.",
        warning:
          "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.",
        sourceKind: null,
        attemptId: null,
        phase: "fix",
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
      nextAction: "banzai cancel"
    },
    persisted: {
      status: "blocked",
      blockedFrom: "fixing",
      blockReason: "Migration round-trip evidence requires operator commands."
    }
  },
  "prerequisite-blocked fix with two matching sources": {
    observed: {
      retry: {
        eligible: false,
        reason:
          "This blocked state is not tied to a failed attempt. Resolve it manually or cancel the run.",
        attemptId: null
      },
      recovery: {
        eligible: false,
        terminalCheckpointPresent: false,
        reason:
          "Multiple completed blocked fix attempts match the current review; recovery is ambiguous.",
        warning:
          "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.",
        sourceKind: null,
        attemptId: null,
        phase: "fix",
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
      nextAction: "banzai cancel"
    },
    persisted: {
      status: "blocked",
      blockedFrom: "fixing",
      blockReason: "Migration round-trip evidence requires operator commands."
    }
  },
  "prerequisite-blocked fix with a conflicting terminal checkpoint": {
    observed: {
      retry: {
        eligible: false,
        reason:
          "This blocked state is not tied to a failed attempt. Resolve it manually or cancel the run.",
        attemptId: null
      },
      recovery: {
        eligible: false,
        terminalCheckpointPresent: false,
        reason: "Terminal checkpoint integrity mismatch.",
        warning:
          "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.",
        sourceKind: null,
        attemptId: null,
        phase: "fix",
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
      nextAction: "banzai cancel"
    },
    persisted: {
      status: "blocked",
      blockedFrom: "fixing",
      blockReason: "Migration round-trip evidence requires operator commands."
    }
  },
  "authorized prerequisite-blocked fix": {
    observed: {
      retry: {
        eligible: false,
        reason:
          "This blocked state is not tied to a failed attempt. Resolve it manually or cancel the run.",
        attemptId: null
      },
      recovery: {
        eligible: true,
        reason:
          "Completed blocked fix attempt fix-2-<id> may be recovered for remaining accepted findings R1-F3 after 2 operator prerequisites.",
        warning:
          "The source attempt remains completed and blocked. Recovery authorizes one new fix attempt for the exact remaining accepted scope after the displayed prerequisites are addressed.",
        sourceKind: "prerequisite_blocked_fix",
        attemptId: "fix-2-<id>",
        phase: "fix",
        resolvedFindingIds: ["R1-F2", "R1-F5", "R1-F6"],
        remainingFindingIds: ["R1-F3"],
        prerequisites: [
          "Run the migration round trip.",
          "Verify the generated schema catalog."
        ],
        authorization: "plan_approval",
        recoveryIdentity: "<sha256>",
        workspace: {
          digest: "<sha256>",
          added: 6,
          modified: 0,
          deleted: 2,
          total: 8
        },
        baseCommit: "<commit>",
        approvalDigest: "<sha256>",
        workflowDigest: null,
        scopeDigest: "<sha256>",
        configurationDigest: "<sha256>"
      },
      nextAction: "banzai recover"
    },
    persisted: {
      status: "blocked",
      blockedFrom: "fixing",
      blockReason: "Migration round-trip evidence requires operator commands."
    }
  },
  "authorized prerequisite-blocked fix after workspace drift": {
    observed: {
      retry: {
        eligible: false,
        reason:
          "This blocked state is not tied to a failed attempt. Resolve it manually or cancel the run.",
        attemptId: null
      },
      recovery: {
        eligible: false,
        terminalCheckpointPresent: false,
        reason: "Persisted recovery authorization is stale or inconsistent.",
        warning:
          "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.",
        sourceKind: null,
        attemptId: "fix-2-<id>",
        phase: "fix",
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
      nextAction: "banzai cancel"
    },
    persisted: {
      status: "blocked",
      blockedFrom: "fixing",
      blockReason: "Migration round-trip evidence requires operator commands."
    }
  },
  "prerequisite-blocked fix with a mismatched recovery state": {
    observed: {
      retry: {
        eligible: false,
        reason:
          "This blocked state is not tied to a failed attempt. Resolve it manually or cancel the run.",
        attemptId: null
      },
      recovery: {
        eligible: false,
        terminalCheckpointPresent: false,
        reason:
          "Persisted recovery state does not match the completed blocked fix source.",
        warning:
          "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.",
        sourceKind: null,
        attemptId: "fix-9-other",
        phase: "fix",
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
      nextAction: "banzai cancel"
    },
    persisted: {
      status: "blocked",
      blockedFrom: "fixing",
      blockReason: "Migration round-trip evidence requires operator commands."
    }
  },
  "failed read-only selection": {
    observed: {
      retry: {
        eligible: true,
        reason:
          "Failed selection attempt selection-1-<id> can be retried explicitly.",
        attemptId: "selection-1-<id>"
      },
      recovery: {
        eligible: false,
        terminalCheckpointPresent: false,
        reason:
          "Recovery requires an interrupted mutable implementation or fix attempt.",
        warning:
          "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.",
        sourceKind: null,
        attemptId: "selection-1-<id>",
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
      nextAction: "banzai retry"
    },
    persisted: {
      status: "blocked",
      blockedFrom: "selecting",
      blockReason: "selection failed: selection failed"
    }
  },
  "interrupted read-only selection": {
    observed: {
      retry: {
        eligible: true,
        reason:
          "Interrupted selection attempt selection-1-<id> can be retried explicitly because it was read-only.",
        attemptId: "selection-1-<id>"
      },
      recovery: {
        eligible: false,
        terminalCheckpointPresent: false,
        reason:
          "Recovery requires an interrupted mutable implementation or fix attempt.",
        warning:
          "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.",
        sourceKind: null,
        attemptId: "selection-1-<id>",
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
      nextAction: "banzai retry"
    },
    persisted: {
      status: "blocked",
      blockedFrom: "selecting",
      blockReason: "selection failed: selection failed"
    }
  },
  "completed read-only selection": {
    observed: {
      retry: {
        eligible: false,
        reason: "Attempt selection-1-<id> is completed, not failed.",
        attemptId: "selection-1-<id>"
      },
      recovery: {
        eligible: false,
        terminalCheckpointPresent: false,
        reason:
          "Recovery requires an interrupted mutable implementation or fix attempt.",
        warning:
          "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.",
        sourceKind: null,
        attemptId: "selection-1-<id>",
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
      nextAction: "banzai cancel"
    },
    persisted: {
      status: "blocked",
      blockedFrom: "selecting",
      blockReason: "selection failed: selection failed"
    }
  },
  "inconsistent read-only selection": {
    observed: {
      retry: {
        eligible: false,
        reason:
          "The failed selection attempt is inconsistent with blockedFrom=planning.",
        attemptId: "selection-1-<id>"
      },
      recovery: {
        eligible: false,
        terminalCheckpointPresent: false,
        reason:
          "Recovery requires an interrupted mutable implementation or fix attempt.",
        warning:
          "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.",
        sourceKind: null,
        attemptId: "selection-1-<id>",
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
      nextAction: "banzai cancel"
    },
    persisted: {
      status: "blocked",
      blockedFrom: "planning",
      blockReason: "selection failed: selection failed"
    }
  },
  "failed planning": {
    observed: {
      retry: {
        eligible: true,
        reason: "Failed plan attempt plan-1-<id> can be retried explicitly.",
        attemptId: "plan-1-<id>"
      },
      recovery: {
        eligible: false,
        terminalCheckpointPresent: false,
        reason:
          "Recovery requires an interrupted mutable implementation or fix attempt.",
        warning:
          "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.",
        sourceKind: null,
        attemptId: "plan-1-<id>",
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
      nextAction: "banzai retry"
    },
    persisted: {
      status: "blocked",
      blockedFrom: "planning",
      blockReason: "plan failed: planning failed"
    }
  },
  "interrupted planning": {
    observed: {
      retry: {
        eligible: false,
        reason:
          "Interrupted attempts cannot be retried automatically. Inspect the checkout, then cancel the run.",
        attemptId: "plan-1-<id>"
      },
      recovery: {
        eligible: false,
        terminalCheckpointPresent: false,
        reason:
          "Recovery requires an interrupted mutable implementation or fix attempt.",
        warning:
          "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.",
        sourceKind: null,
        attemptId: "plan-1-<id>",
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
      nextAction: "banzai cancel"
    },
    persisted: {
      status: "blocked",
      blockedFrom: "planning",
      blockReason: "plan failed: planning failed"
    }
  },
  "restore without a plan approval": {
    observed: {
      eligible: false,
      reason: "The run has no recorded plan approval."
    },
    persisted: {
      status: "needs_plan_approval",
      blockedFrom: null,
      blockReason: null
    }
  },
  "restore with matching approved artifacts": {
    observed: {
      eligible: false,
      reason:
        "The approved planning artifacts already match the recorded approval."
    },
    persisted: {
      status: "plan_approved",
      blockedFrom: null,
      blockReason: null
    }
  },
  "restore of a changed approved bundle": {
    observed: {
      eligible: true,
      reason:
        "The approved planning artifacts diverged from the recorded approval and can be restored from the snapshot."
    },
    persisted: {
      status: "plan_approved",
      blockedFrom: null,
      blockReason: null
    }
  },
  "restore without an approval snapshot": {
    observed: {
      eligible: false,
      reason:
        "This run predates approval snapshots; restore the approved bytes manually or cancel the run."
    },
    persisted: {
      status: "plan_approved",
      blockedFrom: null,
      blockReason: null
    }
  },
  "restore with an unverifiable approval snapshot": {
    observed: {
      eligible: false,
      reason:
        "The stored approval snapshot does not verify against the recorded approval digest."
    },
    persisted: {
      status: "plan_approved",
      blockedFrom: null,
      blockReason: null
    }
  },
  "failed task check with an unreadable implementation attempt record": {
    observed: {
      retry: {
        eligible: true,
        reason: "The unsuccessful task check can be retried explicitly.",
        attemptId: "verification-<uuid>"
      },
      recovery: {
        eligible: false,
        terminalCheckpointPresent: false,
        reason:
          "Recovery requires an interrupted mutable implementation or fix attempt.",
        warning:
          "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.",
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
      nextAction: "banzai retry"
    },
    persisted: {
      status: "blocked",
      blockedFrom: "verifying",
      blockReason:
        "Task verification is incomplete. Inspect the retained physical evidence and retry the failed check without replaying implementation."
    }
  },
  "blocked from verifying with a malformed legacy ledger": {
    observed: {
      retry: {
        eligible: false,
        reason:
          "Verification evidence is malformed or conflicting. Audit the run before continuing.",
        attemptId: null
      },
      recovery: {
        eligible: false,
        terminalCheckpointPresent: false,
        reason:
          "Recovery requires an interrupted mutable implementation or fix attempt.",
        warning:
          "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.",
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
      nextAction: "banzai cancel"
    },
    persisted: {
      status: "blocked",
      blockedFrom: "verifying",
      blockReason:
        "Task verification is incomplete. Inspect the retained physical evidence and retry the failed check without replaying implementation."
    }
  },
  "blocked from verifying with a malformed legacy attempt": {
    observed: {
      retry: {
        eligible: false,
        reason:
          "Verification evidence is malformed or conflicting. Audit the run before continuing.",
        attemptId: null
      },
      recovery: {
        eligible: false,
        terminalCheckpointPresent: false,
        reason:
          "Recovery requires an interrupted mutable implementation or fix attempt.",
        warning:
          "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.",
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
      nextAction: "banzai cancel"
    },
    persisted: {
      status: "blocked",
      blockedFrom: "verifying",
      blockReason:
        "Task verification is incomplete. Inspect the retained physical evidence and retry the failed check without replaying implementation."
    }
  },
  "interrupted implementation with a malformed verification ledger": {
    observed: {
      retry: {
        eligible: false,
        reason:
          "Failed mutable attempts cannot be retried because their repository side effects may be incomplete. Inspect the checkout, then cancel the run.",
        attemptId: "implementation-1-<id>"
      },
      recovery: {
        eligible: true,
        reason:
          "Interrupted implementation attempt implementation-1-<id> may be recovered only with current explicit authorization.",
        warning:
          "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.",
        sourceKind: "interrupted",
        attemptId: "implementation-1-<id>",
        phase: "implementation",
        resolvedFindingIds: [],
        remainingFindingIds: [],
        prerequisites: [],
        authorization: "plan_approval",
        recoveryIdentity: "<sha256>",
        workspace: {
          digest: "<sha256>",
          added: 3,
          modified: 0,
          deleted: 4,
          total: 7
        },
        baseCommit: "<commit>",
        approvalDigest: "<sha256>",
        workflowDigest: null,
        scopeDigest: "<sha256>",
        configurationDigest: "<sha256>"
      },
      nextAction: "banzai recover"
    },
    persisted: {
      status: "blocked",
      blockedFrom: "implementing",
      blockReason: "implementation failed: implementation interrupted"
    }
  },
  "authorized interrupted implementation with an unreadable authorization": {
    observed: {
      retry: {
        eligible: false,
        reason:
          "Failed mutable attempts cannot be retried because their repository side effects may be incomplete. Inspect the checkout, then cancel the run.",
        attemptId: "implementation-1-<id>"
      },
      recovery: {
        eligible: false,
        terminalCheckpointPresent: false,
        reason:
          "Recovery preconditions could not be validated; inspect or cancel the run.",
        warning:
          "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.",
        sourceKind: null,
        attemptId: "implementation-1-<id>",
        phase: "implementation",
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
      nextAction: "banzai cancel"
    },
    persisted: {
      status: "blocked",
      blockedFrom: "implementing",
      blockReason: "implementation failed: implementation interrupted"
    }
  },
  "prerequisite-blocked fix with an unreadable review": {
    observed: {
      error: {
        code: null,
        message:
          "Expected property name or '}' in JSON at position 1 (line 1 column 2)"
      }
    },
    persisted: {
      status: "blocked",
      blockedFrom: "fixing",
      blockReason: "Migration round-trip evidence requires operator commands."
    }
  }
};
