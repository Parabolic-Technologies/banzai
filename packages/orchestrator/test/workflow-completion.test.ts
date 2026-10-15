import { requiredFixture } from "./helpers.js";
import { readTaskVerificationAttempts } from "../src/verification-evidence.js";
import assert from "node:assert/strict";
import { readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { BanzaiError } from "../src/errors.js";
import { digestArtifactBundle } from "../src/git.js";
import {
  parsePublishedCompletionRegion,
  renderCompletionRegion,
  renderPlanTaskCompletionProjection
} from "../src/plan-task-completion.js";
import {
  CONTRACT_VERSION,
  PLAN_TASK_COMPLETION_SCHEMA_VERSION,
  type AdapterResult,
  type AttemptRecord,
  type PhaseAdapterRequest,
  type PhaseResult,
  type ProcessRunner,
  type RunState
} from "../src/types.js";
import { WorkflowRunner } from "../src/workflow.js";
import { commitAll, createTestRepository } from "./helpers.js";
import {
  FakeAdapters,
  boundFixturePath,
  completionLedger,
  finding,
  passingReview,
  phaseResult,
  planPath,
  selectionResult
} from "./workflow-fixtures.js";

test("a fix that edits the published completion region is republished from the canonical ledger", async () => {
  const repository = await createTestRepository();
  try {
    class ProjectionEditingAdapters extends FakeAdapters {
      async runPhase(
        request: PhaseAdapterRequest
      ): Promise<AdapterResult<PhaseResult>> {
        const isFix =
          !request.prompt.includes("Phase: plan") &&
          !request.prompt.includes("Phase: implementation");
        if (isFix) {
          // Mirrors the observed defect: an accepted overstatement finding
          // led the fixer to edit the published region row directly.
          const reportPath = await boundFixturePath(
            request.repoRoot,
            "documentation/work/example/implementation-report.md"
          );
          const contents = await readFile(reportPath, "utf8");
          assert.ok(contents.includes("&#34;completed&#34;"));
          await writeFile(
            reportPath,
            contents.replace("&#34;completed&#34;", "&#34;incomplete&#34;"),
            "utf8"
          );
        }
        return await super.runPhase(request);
      }
    }
    const adapters = new ProjectionEditingAdapters();
    adapters.reviewResults.push(
      {
        contractVersion: CONTRACT_VERSION,
        verdict: "changes_requested",
        summary: "Completion overstated.",
        findings: [finding("R1-F1", "A completion record is overstated.")],
        reviewedFindingIds: [],
        deferredCoverage: []
      },
      passingReview(["R1-F1"])
    );
    const runner = new WorkflowRunner(repository.root, adapters);
    await runner.start({ slug: "example", request: "Implement it." });
    const triage = await runner.approvePlan("human");
    const implementationCompletion = triage.planTaskCompletion;
    assert.ok(implementationCompletion?.status === "valid");
    const done = await runner.triage({
      accepted: ["R1-F1"],
      rejected: [],
      deferred: [],
      note: null,
      decidedBy: "human"
    });

    // ADR-0047: the old region confers no authority. The null-ledger fix
    // republishes the retained canonical ledger over the edited row, keeps
    // the implementation as ledger author and records itself as publisher.
    assert.equal(done.status, "done", done.blockReason ?? "");
    assert.ok(
      adapters.phasePrompts.every((prompt) => !/repair retry/i.test(prompt))
    );
    const completion = done.planTaskCompletion;
    assert.ok(completion?.status === "valid");
    assert.equal(completion.schemaVersion, 2);
    assert.equal(
      completion.sourceAttemptId,
      implementationCompletion.sourceAttemptId
    );
    assert.equal(completion.sourceAttemptKind, "implementation");
    assert.equal(
      completion.ledgerDigest,
      implementationCompletion.ledgerDigest
    );
    assert.notEqual(completion.publisherAttemptId, completion.sourceAttemptId);
    assert.match(completion.publisherAttemptId ?? "", /^fix-/);
    const report = await readFile(
      await boundFixturePath(
        repository.root,
        "documentation/work/example/implementation-report.md"
      )
    );
    assert.ok(!report.toString("utf8").includes("&#34;incomplete&#34;"));
    assert.deepEqual(
      parsePublishedCompletionRegion(report),
      phaseResult("implementation").taskCompletion
    );
  } finally {
    await repository.dispose();
  }
});

test("a completion decode failure keeps the repair retry available", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new FakeAdapters();
    // Mirrors a structured result whose completion ledger fails decoding —
    // for example a gap detail over the 500-character bound: the adapter
    // throws before any result can be stored.
    adapters.implementationErrors.push(
      new BanzaiError(
        "PLAN_TASK_COMPLETION_INVALID",
        "T001 gap detail must be a bounded single-line string."
      )
    );
    adapters.reviewResults.push(passingReview());
    const runner = new WorkflowRunner(repository.root, adapters);
    await runner.start({ slug: "example", request: "Implement it." });
    const blocked = await runner.approvePlan("human");
    assert.equal(blocked.status, "blocked");
    assert.equal(blocked.blockedFrom, "implementing");
    assert.match(blocked.blockReason ?? "", /bounded single-line string/);
    const checkpoint = blocked.planTaskCompletion;
    assert.ok(checkpoint?.status === "invalid");
    assert.equal(checkpoint.violation, "source_attempt_invalid");

    const status = await runner.status();
    assert.equal(status.retry.eligible, true);
    assert.match(status.retry.reason, /repaired with a new attempt/);

    const repaired = await runner.retry();
    const repairPrompt = adapters.phasePrompts.at(-1) ?? "";
    assert.match(repairPrompt, /source_attempt_invalid/);
    assert.match(
      repairPrompt,
      /Rejected diagnostic: .*bounded single-line string/
    );
    assert.match(repairPrompt, /at most 500 characters/);
    assert.equal(repaired.status, "done");
  } finally {
    await repository.dispose();
  }
});

test("a plan with a malformed task heading fails before the approval gate", async () => {
  const repository = await createTestRepository();
  try {
    let corruptNextPlan = true;
    class AnnotatedPlanAdapters extends FakeAdapters {
      async runPhase(
        request: PhaseAdapterRequest
      ): Promise<AdapterResult<PhaseResult>> {
        const result = await super.runPhase(request);
        if (request.prompt.includes("Phase: plan") && corruptNextPlan) {
          corruptNextPlan = false;
          const planFile = await boundFixturePath(request.repoRoot, planPath);
          const contents = await readFile(planFile, "utf8");
          await writeFile(
            planFile,
            contents.replace(
              "- [ ] **T001 - Implement the fixture**",
              "- [ ] **T001 - Implement the fixture** *(added from review)*"
            ),
            "utf8"
          );
        }
        return result;
      }
    }
    const adapters = new AnnotatedPlanAdapters();
    const runner = new WorkflowRunner(repository.root, adapters);
    const blocked = await runner.start({
      slug: "example",
      request: "Implement it."
    });
    assert.equal(blocked.status, "blocked");
    assert.equal(blocked.blockedFrom, "planning");
    assert.match(
      blocked.blockReason ?? "",
      /checked or malformed task heading/
    );

    const retried = await runner.retry();
    assert.equal(retried.status, "needs_plan_approval");
  } finally {
    await repository.dispose();
  }
});

test("plan approval refuses a bundle whose task grammar broke after the gate", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new FakeAdapters();
    const runner = new WorkflowRunner(repository.root, adapters);
    const planned = await runner.start({
      slug: "example",
      request: "Implement it."
    });
    assert.equal(planned.status, "needs_plan_approval");
    const planFile = await boundFixturePath(repository.root, planPath);
    const contents = await readFile(planFile, "utf8");
    await writeFile(
      planFile,
      contents.replace(
        "- [ ] **T001 - Implement the fixture**",
        "- [x] **T001 - Implement the fixture**"
      ),
      "utf8"
    );
    await assert.rejects(
      runner.approvePlan("human"),
      /checked or malformed task heading/
    );
    const state = await runner.store.readState(planned.runId);
    assert.equal(state.status, "needs_plan_approval");
    assert.equal(state.planApproval, null);
  } finally {
    await repository.dispose();
  }
});

test("an approved plan with malformed headings retries into planning, never an evidence-repair loop", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new FakeAdapters();
    const runner = new WorkflowRunner(repository.root, adapters);
    const planned = await runner.start({
      slug: "example",
      request: "Implement it."
    });
    assert.equal(planned.status, "needs_plan_approval");
    const approved = await runner.approvePlan("human", false);
    assert.equal(approved.status, "plan_approved");

    // Emulate a bundle that was approved malformed — the pre-guard state this
    // repair path exists for: corrupt the heading and re-bind the recorded
    // approval digest to the corrupted bytes.
    const planFile = await boundFixturePath(repository.root, planPath);
    const contents = await readFile(planFile, "utf8");
    await writeFile(
      planFile,
      contents.replace(
        "- [ ] **T001 - Implement the fixture**",
        "- [ ] **T001 - Implement the fixture** *(added"
      ),
      "utf8"
    );
    const stateOnDisk = await runner.store.readState(approved.runId);
    assert.ok(stateOnDisk.planApproval);
    const rebound = await digestArtifactBundle(
      repository.root,
      stateOnDisk.planApproval.paths
    );
    stateOnDisk.planApproval.digest = rebound.digest;
    await runner.store.writeState(stateOnDisk);

    const blocked = await runner.resume();
    assert.equal(blocked.status, "blocked");
    const checkpoint = blocked.planTaskCompletion;
    assert.ok(checkpoint?.status === "invalid");
    assert.equal(checkpoint.violation, "approved_plan_invalid");

    const status = await runner.status();
    assert.equal(status.retry.eligible, true);
    assert.match(status.retry.reason, /reruns planning/);

    const replanned = await runner.retry();
    assert.equal(replanned.status, "needs_plan_approval");
    assert.equal(replanned.planApproval, null);
    assert.equal(replanned.planTaskCompletion ?? null, null);
  } finally {
    await repository.dispose();
  }
});

test("an accepted-finding fix refreshes the canonical ledger in one attempt", async () => {
  const repository = await createTestRepository();
  try {
    const refreshed = completionLedger(["T001"]);
    const first = refreshed.tasks[0];
    assert.ok(first);
    first.evidence = [
      {
        path: "src/example.txt",
        detail: "Compare-and-clear consumption verified after the accepted fix."
      }
    ];
    class RefreshingAdapters extends FakeAdapters {
      async runPhase(
        request: PhaseAdapterRequest
      ): Promise<AdapterResult<PhaseResult>> {
        const isFix =
          !request.prompt.includes("Phase: plan") &&
          !request.prompt.includes("Phase: implementation");
        const emitFixCheckpoint = this.emitFixTerminalCheckpoint;
        if (isFix) this.emitFixTerminalCheckpoint = false;
        const applied = await super.runPhase(request);
        this.emitFixTerminalCheckpoint = emitFixCheckpoint;
        if (isFix && applied.result.taskCompletion !== null) {
          await writeFile(
            await boundFixturePath(
              request.repoRoot,
              "documentation/work/example/implementation-report.md"
            ),
            `# Implementation Report\n\n${renderPlanTaskCompletionProjection(applied.result.taskCompletion)}\n`,
            "utf8"
          );
        }
        if (isFix && emitFixCheckpoint)
          await this.emitFixCheckpoint(request, applied.result);
        return applied;
      }
    }
    const adapters = new RefreshingAdapters();
    adapters.reviewResults.push({
      contractVersion: CONTRACT_VERSION,
      verdict: "changes_requested",
      summary: "Stale completion evidence.",
      findings: [finding("R1-F1", "Evidence describes a replaced mechanism.")],
      reviewedFindingIds: [],
      deferredCoverage: []
    });
    adapters.fixResults.push(
      phaseResult("fix", {
        taskCompletion: refreshed,
        resolvedFindingIds: ["R1-F1"]
      })
    );
    adapters.reviewResults.push(passingReview(["R1-F1"]));
    const runner = new WorkflowRunner(repository.root, adapters);
    await runner.start({ slug: "example", request: "Implement it." });
    await runner.approvePlan("human");
    const done = await runner.triage({
      accepted: ["R1-F1"],
      rejected: [],
      deferred: [],
      note: null,
      decidedBy: "human"
    });
    assert.equal(done.status, "done", done.blockReason ?? "");
    const checkpoint = done.planTaskCompletion;
    assert.ok(checkpoint?.status === "valid");
    assert.equal(checkpoint.sourceAttemptKind, "fix");
    assert.match(checkpoint.sourceAttemptId, /^fix-/);
  } finally {
    await repository.dispose();
  }
});

test("a rejected fix ledger refresh is repairable by rerunning the fix", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new FakeAdapters();
    adapters.reviewResults.push({
      contractVersion: CONTRACT_VERSION,
      verdict: "changes_requested",
      summary: "Stale completion evidence.",
      findings: [finding("R1-F1", "Evidence describes a replaced mechanism.")],
      reviewedFindingIds: [],
      deferredCoverage: []
    });
    // The first refreshed ledger cites a carried-in unchanged file, which the
    // runner rejects before any publication; only the rerun cites the changed
    // surface.
    const rejected = completionLedger(["T001"]);
    const rejectedTask = rejected.tasks[0];
    assert.ok(rejectedTask);
    rejectedTask.evidence = [
      {
        path: "base.txt",
        detail: "Read-only confirmation of carried-in behavior."
      }
    ];
    adapters.fixResults.push(
      phaseResult("fix", {
        taskCompletion: rejected,
        resolvedFindingIds: ["R1-F1"]
      }),
      phaseResult("fix", {
        taskCompletion: completionLedger(["T001"]),
        resolvedFindingIds: ["R1-F1"]
      })
    );
    adapters.reviewResults.push(passingReview(["R1-F1"]));
    const runner = new WorkflowRunner(repository.root, adapters);
    await runner.start({ slug: "example", request: "Implement it." });
    await runner.approvePlan("human");
    const blocked = await runner.triage({
      accepted: ["R1-F1"],
      rejected: [],
      deferred: [],
      note: null,
      decidedBy: "human"
    });
    assert.equal(blocked.status, "blocked");
    assert.equal(blocked.blockedFrom, "fixing");
    assert.match(
      blocked.blockReason ?? "",
      /outside the authorized changed surface/
    );
    const checkpoint = blocked.planTaskCompletion;
    assert.ok(checkpoint?.status === "invalid");
    assert.equal(checkpoint.sourceAttemptKind, "fix");
    assert.equal(checkpoint.schemaVersion, 2);
    assert.equal(checkpoint.violation, "evidence_scope_violation");
    const failedFix = blocked.activeAttempt;
    assert.ok(failedFix?.kind === "fix");
    const failedRecord = await runner.store.readRunAttempt(
      blocked.runId,
      failedFix
    );
    assert.equal(failedRecord.status, "failed");
    assert.equal(failedRecord.schemaVersion, 4);
    assert.equal(failedRecord.retryOf, null);

    const status = await runner.status();
    assert.equal(status.retry.eligible, true);
    assert.match(status.retry.reason, /fix attempt .* can be repaired/);

    const repaired = await runner.retry();
    const repairPrompt = adapters.phasePrompts.at(-1) ?? "";
    assert.match(
      repairPrompt,
      /completion-evidence repair retry for rejected fix attempt/
    );
    assert.equal(repaired.status, "done", repaired.blockReason ?? "");
    const repairedCheckpoint = repaired.planTaskCompletion;
    assert.ok(repairedCheckpoint?.status === "valid");
    assert.equal(repairedCheckpoint.sourceAttemptKind, "fix");
    assert.notEqual(repairedCheckpoint.sourceAttemptId, failedFix.id);
    const successor = await runner.store.readRunAttempt(repaired.runId, {
      id: repairedCheckpoint.sourceAttemptId,
      kind: "fix",
      mutable: true
    });
    assert.match(successor.attempt.id, /^fix-repair-/);
    assert.equal(successor.retryOf, failedFix.id);
    assert.equal(successor.completionProtocol, "banzai-completion-protocol/v1");
    assert.equal(
      (await runner.store.readRunAttempt(repaired.runId, failedFix)).status,
      "failed",
      "the rejected source stays intact"
    );
  } finally {
    await repository.dispose();
  }
});

test("six approved tasks require six canonical records before verification and status reports 6/6", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new FakeAdapters();
    const ids = ["T001", "T002", "T003", "T004", "T005", "T006"];
    adapters.planTaskIds = ids;
    adapters.implementationResults.push(
      phaseResult("implementation", { taskCompletion: completionLedger(ids) })
    );
    adapters.reviewResults.push(passingReview());
    const runner = new WorkflowRunner(repository.root, adapters);
    const approvalGate = await runner.start({
      slug: "example",
      request: "Implement six approved tasks."
    });
    assert.equal(approvalGate.status, "needs_plan_approval");
    const approvalDigest = (
      await digestArtifactBundle(repository.root, [
        requiredFixture(
          requiredFixture(approvalGate.planArtifacts).description
        ),
        requiredFixture(requiredFixture(approvalGate.planArtifacts).plan)
      ])
    ).digest;

    const done = await runner.approvePlan("human");
    const status = await runner.status();

    assert.equal(done.status, "done", done.blockReason ?? "");
    assert.equal(
      done.metrics.attempts.verification,
      1,
      JSON.stringify(done.verificationEvidence?.decision)
    );
    assert.equal(status.taskCompletion.state, "complete");
    assert.equal(status.taskCompletion.completed, 6);
    assert.equal(status.taskCompletion.total, 6);
    assert.equal(status.nextAction, null);
    assert.ok(done.planApproval);
    assert.equal(done.planApproval.digest, approvalDigest);
    assert.equal(
      (await digestArtifactBundle(repository.root, done.planApproval.paths))
        .digest,
      approvalDigest
    );
  } finally {
    await repository.dispose();
  }
});

test("missing completion evidence is rejected before verification even when the skill is skipped", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new FakeAdapters();
    adapters.emitImplementationSkill = false;
    adapters.implementationResults.push(
      phaseResult("implementation", { taskCompletion: null })
    );
    const runner = new WorkflowRunner(repository.root, adapters);
    await runner.start({ slug: "example", request: "Implement it." });

    const blocked = await runner.approvePlan("human");
    const status = await runner.status();
    assert.equal(blocked.status, "blocked");
    assert.equal(blocked.blockedFrom, "implementing");
    assert.match(blocked.blockReason ?? "", /PLAN_TASK_COMPLETION_INVALID/);
    assert.equal(blocked.metrics.attempts.verification, 0);
    assert.equal(adapters.reviewPrompts.length, 0);
    assert.equal(status.taskCompletion.state, "inconsistent");
    assert.equal(status.retry.eligible, true);
    const attempt = blocked.activeAttempt;
    assert.ok(attempt);
    const record = await runner.store.readRunAttempt(blocked.runId, attempt);
    assert.equal(record.status, "failed");
    assert.equal(record.failureCode, "PLAN_TASK_COMPLETION_INVALID");
    assert.equal(
      blocked.metrics.completedAttemptIds.includes(attempt.id),
      false
    );
  } finally {
    await repository.dispose();
  }
});

test("a malformed completion payload on an escalating implementation keeps the stop and retains its diagnostic", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new FakeAdapters();
    adapters.implementationResults.push(
      phaseResult("implementation", {
        outcome: "needs_human_decision",
        gate: "escalation",
        questions: ["May the implementation scope change?"],
        taskCompletion: {
          schemaVersion: PLAN_TASK_COMPLETION_SCHEMA_VERSION,
          tasks: []
        }
      })
    );
    const runner = new WorkflowRunner(repository.root, adapters);
    await runner.start({ slug: "example", request: "Implement it." });

    // ADR-0047: a safely decoded stop is applied as reported; the completion
    // diagnostic is retained beside the attempt and never replaces the stop.
    const waiting = await runner.approvePlan("human");
    assert.equal(waiting.status, "needs_human_decision");
    assert.equal(waiting.pendingHumanDecision?.kind, "escalation");
    assert.equal(waiting.metrics.attempts.verification, 0);
    assert.equal(adapters.reviewPrompts.length, 0);
    assert.equal(waiting.planTaskCompletion, null);
    const records = await runner.store.readRunAttempts(waiting.runId);
    const record = records.find(
      (item) => item.attempt.kind === "implementation"
    );
    assert.ok(record);
    assert.equal(record.status, "completed");
    assert.equal(record.schemaVersion, 4);
    assert.equal(record.completionDiagnostic?.violation, "missing_task");
    assert.match(record.completionDiagnostic.message, /missing T001/);
    assert.equal(
      waiting.metrics.completedAttemptIds.includes(record.attempt.id),
      true,
      "a stop is a completed model attempt, never task completion"
    );
  } finally {
    await repository.dispose();
  }
});

test("completion-validation retry preserves the failed attempt and accepts one replacement ledger", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new FakeAdapters();
    adapters.implementationResults.push(
      phaseResult("implementation", { taskCompletion: null }),
      phaseResult("implementation")
    );
    adapters.reviewResults.push(passingReview());
    const runner = new WorkflowRunner(repository.root, adapters);
    await runner.start({ slug: "example", request: "Implement it." });
    const blocked = await runner.approvePlan("human");
    const failedAttempt = blocked.activeAttempt;
    assert.ok(failedAttempt);

    const done = await runner.retry();
    const status = await runner.status();
    const retained = await runner.store.readRunAttempt(
      done.runId,
      failedAttempt
    );
    assert.equal(done.status, "done", done.blockReason ?? "");
    assert.equal(done.metrics.attempts.implementation, 2);
    assert.equal(retained.status, "failed");
    assert.equal(status.taskCompletion.completed, 1);
    assert.equal(
      done.metrics.completedAttemptIds.filter((id) =>
        id.startsWith("implementation-")
      ).length,
      1
    );
    assert.match(adapters.phasePrompts.at(-1) ?? "", /evidence repair retry/i);
  } finally {
    await repository.dispose();
  }
});

test("completion repair receives the exact rejected task and changed-surface rule", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new FakeAdapters();
    adapters.implementationResults.push(
      phaseResult("implementation", {
        taskCompletion: {
          schemaVersion: PLAN_TASK_COMPLETION_SCHEMA_VERSION,
          tasks: [
            {
              taskId: "T001",
              status: "completed",
              evidence: [
                {
                  path: "base.txt",
                  detail: "Read-only confirmation of carried-in behavior."
                }
              ],
              gap: null
            }
          ]
        }
      }),
      phaseResult("implementation")
    );
    adapters.reviewResults.push(passingReview());
    const runner = new WorkflowRunner(repository.root, adapters);
    await runner.start({ slug: "example", request: "Implement it." });

    const blocked = await runner.approvePlan("human");
    assert.equal(blocked.planTaskCompletion?.status, "invalid");
    assert.equal(
      blocked.planTaskCompletion.violation,
      "evidence_scope_violation"
    );
    assert.equal(blocked.planTaskCompletion.taskId, "T001");

    const done = await runner.retry();
    const repairPrompt = adapters.phasePrompts.at(-1) ?? "";
    assert.equal(done.status, "done", done.blockReason ?? "");
    assert.match(repairPrompt, /evidence_scope_violation/);
    assert.match(repairPrompt, /Rejected task: T001/);
    assert.match(repairPrompt, /carried-in unchanged source and test files/i);
  } finally {
    await repository.dispose();
  }
});

test("completion-invalid terminal checkpoint routes to evidence repair without replay", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new FakeAdapters();
    adapters.implementationResults.push(
      phaseResult("implementation", { taskCompletion: null }),
      phaseResult("implementation")
    );
    adapters.emitImplementationTerminalCheckpoint = true;
    adapters.reviewResults.push(passingReview());
    const runner = new WorkflowRunner(repository.root, adapters);
    await runner.start({ slug: "example", request: "Implement it." });

    const blocked = await runner.approvePlan("human");
    const failedAttempt = blocked.activeAttempt;
    assert.ok(failedAttempt);
    assert.equal(blocked.planTaskCompletion?.status, "invalid");
    assert.ok(
      await runner.store.readTerminalCheckpointIfExists(
        blocked.runId,
        failedAttempt
      )
    );

    const status = await runner.status();
    assert.equal(status.retry.eligible, true);
    assert.equal(status.recovery.terminalCheckpointPresent, true);
    assert.equal(status.nextAction, "banzai retry");

    const eventsPath = path.join(
      runner.store.runDirectory(blocked.runId),
      "events.jsonl"
    );
    const eventsBeforeResume = await readFile(eventsPath, "utf8");
    const repeated = await runner.resume();
    const eventsAfterResume = await readFile(eventsPath, "utf8");
    assert.equal(repeated.status, "blocked");
    assert.equal(repeated.blockReason, blocked.blockReason);
    assert.equal(eventsAfterResume, eventsBeforeResume);

    const done = await runner.retry();
    assert.equal(done.status, "done", done.blockReason ?? "");
    assert.equal(done.metrics.attempts.implementation, 2);
    assert.match(adapters.phasePrompts.at(-1) ?? "", /evidence repair retry/i);
  } finally {
    await repository.dispose();
  }
});

test("a model-authored legacy completion table is replaced by the runner-published region without a repair call", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new FakeAdapters();
    adapters.implementationResults.push(phaseResult("implementation"));
    adapters.implementationReportTransforms.push((contents) =>
      contents.replace(
        "Implementation fixture output.",
        "Equivalent implementation evidence."
      )
    );
    adapters.reviewResults.push(passingReview());
    const runner = new WorkflowRunner(repository.root, adapters);
    await runner.start({ slug: "example", request: "Implement it." });

    const done = await runner.approvePlan("human");
    assert.equal(done.status, "done", done.blockReason ?? "");
    assert.equal(done.metrics.attempts.implementation, 1);
    assert.equal(done.metrics.attempts.verification, 1);
    assert.ok(
      adapters.phasePrompts.every((prompt) => !/repair retry/i.test(prompt))
    );
    const report = await readFile(
      await boundFixturePath(
        repository.root,
        "documentation/work/example/implementation-report.md"
      )
    );
    const ledger = phaseResult("implementation").taskCompletion;
    assert.ok(ledger);
    assert.deepEqual(parsePublishedCompletionRegion(report), ledger);
    assert.ok(
      !report.toString("utf8").includes("banzai-plan-task-completion/v1")
    );
    assert.ok(report.toString("utf8").includes(renderCompletionRegion(ledger)));
    const completion = done.planTaskCompletion;
    assert.ok(completion?.status === "valid");
    assert.equal(completion.schemaVersion, 2);
    assert.equal(
      completion.completionProtocol,
      "banzai-completion-protocol/v1"
    );
    assert.equal(completion.publisherAttemptId, completion.sourceAttemptId);
  } finally {
    await repository.dispose();
  }
});

test("a reviewer pass cannot reach done after completion evidence becomes invalid", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new FakeAdapters();
    adapters.reviewResults.push(passingReview());
    adapters.onReview = async (request) => {
      const state = JSON.parse(
        await readFile(path.join(request.runDirectory, "state.json"), "utf8")
      ) as RunState;
      const completion = state.planTaskCompletion;
      assert.ok(completion?.status === "valid");
      const attemptPath = path.join(
        request.runDirectory,
        "attempts",
        `${completion.sourceAttemptId}-implementation.json`
      );
      const attempt = JSON.parse(
        await readFile(attemptPath, "utf8")
      ) as AttemptRecord<PhaseResult>;
      assert.ok(attempt.result);
      attempt.result.taskCompletion = null;
      await writeFile(
        attemptPath,
        `${JSON.stringify(attempt, null, 2)}\n`,
        "utf8"
      );
    };
    const runner = new WorkflowRunner(repository.root, adapters);
    await runner.start({ slug: "example", request: "Implement it." });

    const blocked = await runner.approvePlan("human");
    assert.equal(blocked.status, "blocked");
    assert.match(blocked.blockReason ?? "", /PLAN_TASK_COMPLETION_INVALID/);
    assert.equal(blocked.planTaskCompletion?.status, "invalid");
  } finally {
    await repository.dispose();
  }
});

test("failed deterministic verification blocks review", async () => {
  const repository = await createTestRepository();
  try {
    const configPath = path.join(repository.root, ".banzai", "config.json");
    const config = JSON.parse(await readFile(configPath, "utf8")) as {
      verification: { profiles: { commands: { args: string[] }[] }[] };
    };
    const verification = config.verification.profiles[0]?.commands[0];
    assert.ok(verification);
    verification.args = ["-e", "process.exit(7)"];
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
    await commitAll(repository.root, "failing verification profile");

    const adapters = new FakeAdapters();
    const runner = new WorkflowRunner(repository.root, adapters);
    await runner.start({ slug: "example", request: "Implement it." });
    const blocked = await runner.approvePlan("human");
    assert.equal(blocked.status, "blocked");
    assert.equal(blocked.taskVerification?.attempts[0]?.exitCode, 7);
    assert.equal(adapters.reviewPrompts.length, 0);
  } finally {
    await repository.dispose();
  }
});

test("verification executes task checks in selected order and stops on failure", async () => {
  const repository = await createTestRepository();
  try {
    const configPath = path.join(repository.root, ".banzai", "config.json");
    const config = JSON.parse(await readFile(configPath, "utf8")) as {
      verification: {
        profiles: {
          id: string;
          projectType: string;
          commands: {
            name: string;
            command: string;
            args: string[];
            timeoutMs: number;
          }[];
        }[];
      };
    };
    const command = (name: string) => ({
      name,
      command: process.execPath,
      args: ["-e", name],
      timeoutMs: 1_000
    });
    config.verification.profiles = [
      {
        id: "node-primary",
        projectType: "node",
        commands: [command("first"), command("second")]
      },
      {
        id: "repository-hygiene",
        projectType: "repository",
        commands: [command("third")]
      }
    ];
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
    await writeFile(path.join(repository.root, "package.json"), "{}");
    await commitAll(repository.root, "ordered verification profiles");

    const observed: string[] = [];
    const processRunner: ProcessRunner = async (spec) => {
      const name = spec.args[1] ?? "";
      observed.push(name);
      return {
        exitCode: name === "second" ? 7 : 0,
        signal: null,
        stdout: "",
        stderr: "",
        startedAt: "2026-01-01T00:00:00.000Z",
        completedAt: "2026-01-01T00:00:01.000Z"
      };
    };
    const adapters = new FakeAdapters();
    adapters.fixtureTaskChecks = true;
    adapters.selectionResults.push(
      selectionResult({
        recommendedWorkflow: "feature",
        reason: "Exercise verification profile ordering."
      })
    );
    const runner = new WorkflowRunner(repository.root, adapters, processRunner);

    const blocked = await runner.start({
      slug: "ordered-verification",
      request: "Exercise ordered verification."
    });

    assert.equal(blocked.status, "blocked");
    assert.deepEqual(observed, ["first", "second"]);
    assert.deepEqual(
      blocked.taskVerification?.attempts.map((result) => result.checkId),
      ["node-primary-1", "node-primary-2"]
    );
    assert.equal(blocked.taskVerification.attempts[1]?.exitCode, 7);
  } finally {
    await repository.dispose();
  }
});

test("resume reconciles a durable completed verification leaf without executing or duplicating it", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new FakeAdapters();
    adapters.fixtureTaskChecks = true;
    adapters.selectionResults.push(
      selectionResult({ recommendedWorkflow: "feature" })
    );
    let executions = 0;
    const processRunner: ProcessRunner = async () => {
      executions += 1;
      return {
        exitCode: 0,
        signal: null,
        stdout: "",
        stderr: "",
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString()
      };
    };
    const runner = new WorkflowRunner(repository.root, adapters, processRunner);
    const done = await runner.start({
      slug: "verification-reconcile",
      request: "Exercise durable verification reconciliation."
    });
    assert.equal(done.status, "done", done.blockReason ?? "");
    assert.equal(executions, 1);
    const runDirectory = path.join(
      repository.root,
      ".banzai",
      "runs",
      done.runId
    );
    assert.deepEqual(
      JSON.parse(
        await readFile(
          path.join(
            repository.root,
            requiredFixture(
              requiredFixture(done.artifactBinding).binding.artifacts
                .verificationDirectory
            ),
            "ledger.json"
          ),
          "utf8"
        )
      ),
      { schemaVersion: 3 }
    );
    const statePath = path.join(runDirectory, "state.json");
    const persisted = JSON.parse(await readFile(statePath, "utf8")) as Record<
      string,
      unknown
    >;
    persisted.status = "verifying";
    persisted.verification = [];
    await writeFile(
      statePath,
      `${JSON.stringify(persisted, null, 2)}\n`,
      "utf8"
    );

    const resumed = await new WorkflowRunner(
      repository.root,
      adapters,
      processRunner
    ).resume();
    assert.equal(resumed.status, "done");
    assert.equal(executions, 1);
    const files = (
      await readdir(
        path.join(
          repository.root,
          requiredFixture(
            requiredFixture(done.artifactBinding).binding.artifacts
              .verificationDirectory
          ),
          "attempts"
        )
      )
    ).filter((name) => name !== "ledger.json");
    assert.equal(files.length, 2);
    assert.equal(resumed.metrics.attempts.verification, 1);
  } finally {
    await repository.dispose();
  }
});

test("an explicit verification retry gets a new linked identity and durable retry event", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new FakeAdapters();
    adapters.fixtureTaskChecks = true;
    adapters.selectionResults.push(
      selectionResult({ recommendedWorkflow: "feature" })
    );
    let executions = 0;
    const processRunner: ProcessRunner = async () => {
      executions += 1;
      return {
        exitCode: executions === 1 ? 7 : 0,
        signal: null,
        stdout: "",
        stderr: "",
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString()
      };
    };
    const runner = new WorkflowRunner(repository.root, adapters, processRunner);
    const blocked = await runner.start({
      slug: "verification-retry",
      request: "Exercise explicit verification retry evidence."
    });
    assert.equal(blocked.status, "blocked");
    assert.equal(blocked.blockedFrom, "verifying");
    const blockedStatus = await runner.status();
    assert.equal(blockedStatus.retry.eligible, true);
    assert.equal(blockedStatus.nextAction, "banzai retry");

    const done = await runner.retry();
    assert.equal(done.status, "done", done.blockReason ?? "");
    assert.equal(executions, 2);
    assert.equal(done.metrics.attempts.verification, 2);
    assert.equal(done.taskVerification?.applicability.complete, true);
    const runDirectory = runner.store.runDirectory(done.runId);
    const records = await readTaskVerificationAttempts({
      repoRoot: repository.root,
      workId: requiredFixture(done.artifactBinding).binding.workId,
      directory: requiredFixture(
        requiredFixture(done.artifactBinding).binding.artifacts
          .verificationDirectory
      )
    });
    assert.equal(records.length, 2);
    records.sort((left, right) => left.sequence - right.sequence);
    const [failed, retried] = records;
    assert.ok(failed);
    assert.ok(retried);
    assert.equal(failed.status, "failed");
    assert.equal(retried.status, "completed");
    assert.equal(retried.retryOf, failed.id);
    assert.match(
      await readFile(path.join(runDirectory, "events.jsonl"), "utf8"),
      /"type":"verification\.retry_requested"/
    );
  } finally {
    await repository.dispose();
  }
});

test("resume closes an interrupted durable verification leaf and links one restarted execution", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new FakeAdapters();
    adapters.fixtureTaskChecks = true;
    adapters.selectionResults.push(
      selectionResult({ recommendedWorkflow: "feature" })
    );
    let executions = 0;
    const processRunner: ProcessRunner = async () => {
      executions += 1;
      return {
        exitCode: 0,
        signal: null,
        stdout: "safe output",
        stderr: "",
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString()
      };
    };
    const runner = new WorkflowRunner(repository.root, adapters, processRunner);
    const done = await runner.start({
      slug: "verification-restart",
      request: "Exercise interrupted verification recovery."
    });
    assert.equal(done.status, "done", done.blockReason ?? "");
    const runDirectory = path.join(
      repository.root,
      ".banzai",
      "runs",
      done.runId
    );
    const storage = {
      repoRoot: repository.root,
      workId: requiredFixture(done.artifactBinding).binding.workId,
      directory: requiredFixture(
        requiredFixture(done.artifactBinding).binding.artifacts
          .verificationDirectory
      )
    };
    const attemptsDirectory = path.join(
      repository.root,
      storage.directory,
      "attempts"
    );
    const [original] = await readTaskVerificationAttempts(storage);
    assert.ok(original);
    const finish = (await readdir(attemptsDirectory)).find((name) =>
      name.endsWith(".finish.json")
    );
    assert.ok(finish);
    await rm(path.join(attemptsDirectory, finish));
    await rm(
      path.join(
        repository.root,
        storage.directory,
        "origins",
        `${original.id}.finish.json`
      )
    );
    const statePath = path.join(runDirectory, "state.json");
    const persisted = JSON.parse(await readFile(statePath, "utf8")) as Record<
      string,
      unknown
    >;
    persisted.status = "verifying";
    persisted.verification = [];
    persisted.activeProcess = null;
    await writeFile(
      statePath,
      `${JSON.stringify(persisted, null, 2)}\n`,
      "utf8"
    );
    executions = 0;

    const resumed = await new WorkflowRunner(
      repository.root,
      adapters,
      processRunner
    ).resume();
    assert.equal(resumed.status, "done");
    assert.equal(executions, 1);
    const records = await readTaskVerificationAttempts(storage);
    assert.equal(records.length, 2);
    records.sort((left, right) => left.sequence - right.sequence);
    const [interrupted, restarted] = records;
    assert.ok(interrupted);
    assert.ok(restarted);
    assert.equal(interrupted.status, "interrupted");
    assert.equal(restarted.status, "completed");
    assert.equal(restarted.retryOf, interrupted.id);
    assert.equal(resumed.metrics.attempts.verification, 2);
  } finally {
    await repository.dispose();
  }
});
