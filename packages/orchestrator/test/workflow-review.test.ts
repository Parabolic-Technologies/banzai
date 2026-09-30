import { requiredFixture } from "./helpers.js";
import assert from "node:assert/strict";
import {
  chmod,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { BanzaiError, ProcessExitError } from "../src/errors.js";
import { renderReviewArtifact } from "../src/review-artifact.js";
import {
  CONTRACT_VERSION,
  type AdapterResult,
  type AttemptRecord,
  type PhaseAdapterRequest,
  type PhaseResult,
  type ProcessResult,
  type ProgressEvent,
  type ReviewResult,
  type RunState
} from "../src/types.js";
import {
  invocationScopeDigest,
  reviewCompletion,
  reviewExecutionPolicy,
  reviewStatusLines,
  WorkflowRunner
} from "../src/workflow.js";
import { commitAll, createTestRepository } from "./helpers.js";
import {
  FakeAdapters,
  boundFixturePath,
  descriptionPath,
  finding,
  passingReview,
  phaseResult,
  planPath
} from "./workflow-fixtures.js";

test("a Codex reviewer gets its artifact rendered by the runner", async () => {
  const repository = await createTestRepository();
  try {
    // Codex reviews run under --sandbox read-only and cannot write the
    // artifact, so the runner renders it from the structured result.
    const configPath = path.join(repository.root, ".banzai", "config.json");
    const config = JSON.parse(await readFile(configPath, "utf8")) as {
      models: { reviewer: { executable: string; model: string } };
    };
    const codexExecutable = path.join(repository.root, "tools", "codex");
    await mkdir(path.dirname(codexExecutable), { recursive: true });
    await writeFile(codexExecutable, "#!/bin/sh\nexit 0\n", "utf8");
    await chmod(codexExecutable, 0o755);
    config.models.reviewer.executable = codexExecutable;
    config.models.reviewer.model = "gpt-5.6-sol";
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
    await commitAll(repository.root, "point review at codex");

    const adapters = new FakeAdapters();
    // The fake writes no artifact, mirroring a read-only Codex sandbox.
    adapters.reviewResults.push(passingReview());
    const runner = new WorkflowRunner(repository.root, adapters);

    const planned = await runner.start({
      slug: "codex-review",
      request: "Plan the example."
    });
    assert.equal(
      planned.status,
      "needs_plan_approval",
      planned.blockReason ?? ""
    );
    const completed = await runner.approvePlan("human", true);
    assert.equal(completed.status, "done", completed.blockReason ?? "");

    const prompt = adapters.reviewPrompts[0] ?? "";
    assert.match(prompt, /Do not call any write tool or create Markdown/);
    assert.match(prompt, /The runner renders and publishes the artifact/);
    assert.match(prompt, /review-result\/v2/);
    assert.equal(prompt.includes("You may use Write"), false);
    // No whitelist resolver on these adapters: the prompt must stay
    // byte-identical to its pre-whitelist form.
    assert.equal(
      prompt.includes(
        "The Serena MCP server's read-only symbol tools are whitelisted"
      ),
      false
    );

    assert.ok(completed.latestReview?.artifactPath);
    const artifact = path.join(
      repository.root,
      completed.latestReview.artifactPath
    );
    const rendered = await readFile(artifact, "utf8");
    assert.match(rendered, /banzai-feature-review\/v7/);
    assert.match(rendered, /pass/);
  } finally {
    await repository.dispose();
  }
});

for (const [artifactLayout, writeChangeReport] of [
  ["legacy", false],
  ["legacy", true],
  ["private", false],
  ["private", true]
] as const)
  test(`end-to-end workflow fixes only accepted findings and finishes after re-review (${artifactLayout}, change report ${writeChangeReport ? "written" : "absent"})`, async () => {
    const repository = await createTestRepository({ artifactLayout });
    try {
      class ReportAdapters extends FakeAdapters {
        override async runPhase(
          request: PhaseAdapterRequest
        ): Promise<AdapterResult<PhaseResult>> {
          const isFix =
            !request.prompt.includes("Phase: plan") &&
            !request.prompt.includes("Phase: implementation");
          const emitFixCheckpoint = this.emitFixTerminalCheckpoint;
          if (isFix) this.emitFixTerminalCheckpoint = false;
          const result = await super.runPhase(request);
          this.emitFixTerminalCheckpoint = emitFixCheckpoint;
          if (result.result.phase === "fix" && writeChangeReport) {
            const state = JSON.parse(
              await readFile(
                path.join(request.runDirectory, "state.json"),
                "utf8"
              )
            ) as RunState;
            const report =
              state.artifactBinding?.binding.artifacts.changeReport;
            assert.ok(report);
            await mkdir(path.dirname(path.join(request.repoRoot, report)), {
              recursive: true
            });
            await writeFile(
              path.join(request.repoRoot, report),
              "# Change report\n\nResolved R1-F1.\n"
            );
          }
          if (isFix && emitFixCheckpoint)
            await this.emitFixCheckpoint(request, result.result);
          return result;
        }
      }
      const adapters = new ReportAdapters();
      adapters.reviewResults.push(
        {
          contractVersion: CONTRACT_VERSION,
          verdict: "changes_requested",
          summary: "Two findings.",
          findings: [
            finding("R1-F1", "Accepted defect."),
            finding("R1-F2", "Rejected suggestion.")
          ],
          reviewedFindingIds: [],
          deferredCoverage: []
        },
        passingReview(["R1-F1"])
      );
      const progress: ProgressEvent[] = [];
      const runner = new WorkflowRunner(
        repository.root,
        adapters,
        undefined,
        (event) => progress.push(event)
      );

      const planned = await runner.start({
        slug: "example",
        request: "Implement the requested behavior."
      });
      assert.equal(planned.status, "needs_plan_approval");

      const reviewed = await runner.approvePlan("human");
      assert.equal(reviewed.status, "needs_triage");
      assert.equal(reviewed.reviewIteration, 1);
      assert.equal(
        reviewed.latestReview?.artifactPath,
        `${reviewed.artifactBinding?.binding.artifacts.reviewDirectory}/review-1.md`
      );

      const done = await runner.triage({
        accepted: ["R1-F1"],
        rejected: ["R1-F2"],
        deferred: [],
        note: null,
        decidedBy: "human"
      });
      assert.equal(done.status, "done", done.blockReason ?? "");
      assert.equal(done.fixCycle, 1);
      assert.equal(done.reviewIteration, 2);
      assert.equal(
        done.latestReview?.artifactPath,
        `${done.artifactBinding?.binding.artifacts.reviewDirectory}/review-2.md`
      );
      assert.equal(done.metrics.attempts.plan, 1);
      assert.equal(done.metrics.attempts.implementation, 1);
      assert.equal(done.metrics.attempts.fix, 1);
      assert.equal(done.metrics.attempts.review, 2);
      assert.equal(done.metrics.reviewFindingCount, 2);
      assert.deepEqual(done.metrics.triage, {
        accepted: 1,
        rejected: 1,
        deferred: 0
      });
      assert.deepEqual(done.metrics.sessions, { fresh: 3, resumed: 3 });
      assert.deepEqual(done.metrics.reviews, {
        full: 1,
        delta: 1,
        rotations: 0
      });
      assert.equal(done.triageHistory.length, 1);
      assert.deepEqual(adapters.phaseResumeSessionIds, [
        null,
        "planner-session",
        "implementer-session"
      ]);
      assert.deepEqual(adapters.reviewResumeSessionIds, [
        null,
        "fresh-review-session"
      ]);
      assert.equal(done.latestReview.sessionMode, "resumed");
      assert.equal(done.latestReview.mode, "delta");
      assert.equal(done.sessions.implementer?.id, "implementer-session");
      assert.equal(done.sessions.reviewer?.consecutiveDeltaReviews, 1);

      const fixPrompt = adapters.phasePrompts.find((prompt) =>
        prompt.includes("Phase: fix")
      );
      const implementationPrompt = adapters.phasePrompts.find((prompt) =>
        prompt.includes("Phase: implementation")
      );
      assert.ok(implementationPrompt);
      assert.match(implementationPrompt, /Verification is task-scoped/);
      assert.ok(fixPrompt?.includes("R1-F1"));
      assert.ok(fixPrompt);
      const roles = done.artifactBinding?.binding.artifacts;
      assert.ok(roles?.changeReport);
      const grants = (prompt: string) =>
        JSON.parse(
          /Artifact writes allowed in this phase: (\[[^\n]*\])\./u.exec(
            prompt
          )?.[1] ?? "null"
        ) as string[];
      assert.deepEqual(grants(fixPrompt), [
        roles.implementationReport,
        roles.testReport,
        roles.changeReport
      ]);
      assert.deepEqual(grants(implementationPrompt), [
        roles.implementationReport,
        roles.testReport
      ]);
      assert.deepEqual(done.artifactBinding, planned.artifactBinding);
      if (writeChangeReport) {
        assert.match(
          await readFile(
            path.join(repository.root, roles.changeReport),
            "utf8"
          ),
          /Resolved R1-F1/u
        );
      } else {
        // A write grant alone does not impose report existence at the runner boundary.
        await assert.rejects(
          readFile(path.join(repository.root, roles.changeReport)),
          { code: "ENOENT" }
        );
      }
      assert.equal(fixPrompt.includes("R1-F2"), false);
      assert.match(fixPrompt, /Approved planning artifacts are immutable/);
      assert.ok(
        fixPrompt.includes(
          `Latest review artifact: ${reviewed.latestReview.artifactPath}`
        )
      );
      assert.match(fixPrompt, /Verification is task-scoped/);
      assert.equal(adapters.reviewPrompts.length, 2);
      assert.match(adapters.reviewPrompts[0] ?? "", /fresh full reviewer/);
      assert.match(adapters.reviewPrompts[1] ?? "", /resumed delta review/);
      assert.match(adapters.reviewPrompts[1] ?? "", /R1-F1/);
      assert.match(adapters.reviewPrompts[1] ?? "", /R1-F2/);
      assert.match(adapters.reviewPrompts[1] ?? "", /"rejected"/);
      const deltaChanges = (adapters.reviewPrompts[1] ?? "")
        .split("Changes since the preceding successful review:\n")[1]
        ?.split("Runner evidence root (read-only):\n")[0];
      assert.ok(deltaChanges);
      assert.match(deltaChanges, /"path": "src\/example\.txt"/);
      assert.doesNotMatch(deltaChanges, /review-1\.md/);
      assert.ok(
        progress.some(
          (event) =>
            event.kind === "activity_started" &&
            event.label === "Review 2" &&
            event.detail.includes("session=resumed") &&
            event.detail.includes("review=delta") &&
            event.detail.includes("rotation=none")
        )
      );

      const reviewAttemptFiles = (
        await readdir(
          path.join(runner.store.runDirectory(done.runId), "attempts")
        )
      )
        .filter((entry) => entry.endsWith("-review.json"))
        .sort();
      const attemptEvidence = await Promise.all(
        reviewAttemptFiles.map(
          async (entry) =>
            JSON.parse(
              await readFile(
                path.join(
                  runner.store.runDirectory(done.runId),
                  "attempts",
                  entry
                ),
                "utf8"
              )
            ) as Pick<
              AttemptRecord,
              "sessionMode" | "reviewMode" | "rotationReason"
            >
        )
      );
      assert.deepEqual(
        attemptEvidence.map((record) => ({
          sessionMode: record.sessionMode,
          reviewMode: record.reviewMode,
          rotationReason: record.rotationReason
        })),
        [
          {
            sessionMode: "fresh",
            reviewMode: "full",
            rotationReason: "primary-review"
          },
          {
            sessionMode: "resumed",
            reviewMode: "delta",
            rotationReason: null
          }
        ]
      );
      assert.equal(
        attemptEvidence.some(
          (record) => "prompt" in record || "transcript" in record
        ),
        false
      );

      const firstReviewArtifact = await readFile(
        path.join(
          repository.root,
          `${reviewed.artifactBinding?.binding.artifacts.reviewDirectory}/review-1.md`
        ),
        "utf8"
      );
      assert.match(firstReviewArtifact, /^# Implementation Review$/m);
      assert.match(firstReviewArtifact, /"verdict": "changes_requested"/);
      assert.match(firstReviewArtifact, /^## Review Scope$/m);
      assert.match(firstReviewArtifact, /^## Summary$/m);
      assert.match(firstReviewArtifact, /^## Findings$/m);
      assert.match(firstReviewArtifact, /^### R1-F1$/m);
      assert.match(firstReviewArtifact, /"fixAcceptance":/);
      assert.match(firstReviewArtifact, /^## Handoff$/m);

      const secondReviewArtifact = await readFile(
        path.join(
          repository.root,
          `${done.artifactBinding?.binding.artifacts.reviewDirectory}/review-2.md`
        ),
        "utf8"
      );
      assert.match(secondReviewArtifact, /"verdict": "pass"/);
      assert.match(secondReviewArtifact, /"reviewedFindingIds": \[\s*"R1-F1"/);
      const finalStatus = await runner.status();
      assert.deepEqual(reviewCompletion(finalStatus), {
        basis: "review_pass",
        iteration: 2
      });
      assert.deepEqual(reviewStatusLines(finalStatus), [
        "Review: pass (iteration 2)"
      ]);
    } finally {
      await repository.dispose();
    }
  });

test("zero-accepted triage closes without fixer, verification, or re-review", async () => {
  const scenarios = [
    {
      name: "all rejected",
      rejected: ["R1-F1", "R1-F2"],
      deferred: []
    },
    {
      name: "all deferred",
      rejected: [],
      deferred: ["R1-F1", "R1-F2"]
    },
    {
      name: "mixed rejected and deferred",
      rejected: ["R1-F1"],
      deferred: ["R1-F2"]
    }
  ];

  for (const scenario of scenarios) {
    const repository = await createTestRepository();
    try {
      const adapters = new FakeAdapters();
      if (scenario.name === "all rejected") {
        adapters.reviewSessionIds.push(null);
      }
      adapters.reviewResults.push({
        contractVersion: CONTRACT_VERSION,
        verdict: "changes_requested",
        summary: "Two findings need human triage.",
        findings: [
          finding("R1-F1", "First suggestion."),
          finding("R1-F2", "Second suggestion.")
        ],
        reviewedFindingIds: [],
        deferredCoverage: []
      });
      const runner = new WorkflowRunner(repository.root, adapters);
      await runner.start({ slug: "example", request: "Implement it." });
      const reviewed = await runner.approvePlan("human");
      const verificationAttempts = reviewed.metrics.attempts.verification;
      const phaseAttempts = adapters.phasePrompts.length;

      const done = await runner.triage({
        accepted: [],
        rejected: scenario.rejected,
        deferred: scenario.deferred,
        note: scenario.name,
        decidedBy: "human"
      });

      assert.equal(done.status, "done", scenario.name);
      assert.equal(done.latestReview?.verdict, "changes_requested");
      assert.equal(done.reviewIteration, 1);
      assert.equal(done.fixCycle, 0);
      assert.equal(done.pendingReviewRotationReason, null);
      assert.equal(done.metrics.attempts.fix, 0);
      assert.equal(done.metrics.attempts.review, 1);
      assert.equal(done.metrics.attempts.verification, verificationAttempts);
      assert.equal(adapters.phasePrompts.length, phaseAttempts);
      assert.equal(adapters.reviewPrompts.length, 1);
      assert.deepEqual(done.metrics.triage, {
        accepted: 0,
        rejected: scenario.rejected.length,
        deferred: scenario.deferred.length
      });

      const status = await runner.status();
      assert.equal(status.latestReview?.verdict, "changes_requested");
      assert.deepEqual(reviewCompletion(status), {
        basis: "human_triage",
        iteration: 1,
        accepted: 0,
        rejected: scenario.rejected.length,
        deferred: scenario.deferred.length
      });
      assert.deepEqual(reviewStatusLines(status), [
        "Review: changes_requested (iteration 1)",
        `Completion: human triage (accepted=0, rejected=${scenario.rejected.length}, deferred=${scenario.deferred.length})`
      ]);
      const events = (
        await readFile(
          path.join(runner.store.runDirectory(done.runId), "events.jsonl"),
          "utf8"
        )
      )
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as { type: string });
      assert.equal(
        events.filter((event) => event.type === "review.triaged").length,
        1
      );
    } finally {
      await repository.dispose();
    }
  }
});

test("review policy chooses delta continuity and every fresh rotation trigger", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new FakeAdapters();
    adapters.reviewResults.push({
      contractVersion: CONTRACT_VERSION,
      verdict: "changes_requested",
      summary: "One finding.",
      findings: [finding("R1-F1", "Defect.")],
      reviewedFindingIds: [],
      deferredCoverage: []
    });
    const runner = new WorkflowRunner(repository.root, adapters);
    await runner.start({ slug: "example", request: "Implement it." });
    const reviewed = await runner.approvePlan("human");
    const reviewer = reviewed.sessions.reviewer;
    assert.ok(reviewer);
    const settings = {
      executable: reviewer.executable,
      model: reviewer.model,
      effort: reviewer.effort,
      timeoutMs: 1_000
    };

    assert.deepEqual(reviewExecutionPolicy(reviewed, settings), {
      sessionMode: "resumed",
      reviewMode: "delta",
      rotationReason: null,
      resumeSessionId: reviewer.id,
      sessionContext: {
        role: "reviewer",
        executable: reviewer.executable,
        model: reviewer.model,
        effort: reviewer.effort
      }
    });

    const primary = structuredClone(reviewed);
    primary.latestReview = null;
    primary.sessions.reviewer = null;
    assert.equal(
      reviewExecutionPolicy(primary, settings).rotationReason,
      "primary-review"
    );

    const missing = structuredClone(reviewed);
    missing.sessions.reviewer = null;
    assert.equal(
      reviewExecutionPolicy(missing, settings).rotationReason,
      "missing-session"
    );
    for (const changedSettings of [
      { ...settings, executable: "changed-reviewer-cli" },
      { ...settings, model: "changed-reviewer-model" },
      { ...settings, effort: "low" as const }
    ]) {
      assert.equal(
        reviewExecutionPolicy(reviewed, changedSettings).rotationReason,
        "settings-changed"
      );
    }
    assert.equal(
      reviewExecutionPolicy(reviewed, {
        ...settings,
        timeoutMs: settings.timeoutMs + 1
      }).sessionMode,
      "resumed"
    );

    const approvalChanged = structuredClone(reviewed);
    assert.ok(approvalChanged.planApproval);
    approvalChanged.planApproval.digest = "new-approval";
    assert.equal(
      reviewExecutionPolicy(approvalChanged, settings).rotationReason,
      "approval-changed"
    );

    const evidenceChanged = structuredClone(reviewed);
    assert.ok(evidenceChanged.sessions.reviewer);
    evidenceChanged.sessions.reviewer.lastSnapshot.digest = "stale-snapshot";
    assert.equal(
      reviewExecutionPolicy(evidenceChanged, settings).rotationReason,
      "unreliable-review"
    );

    const blocked = structuredClone(reviewed);
    assert.ok(blocked.latestReview);
    blocked.latestReview.verdict = "blocked";
    assert.equal(
      reviewExecutionPolicy(blocked, settings).rotationReason,
      "previous-review-blocked"
    );

    const deltaLimit = structuredClone(reviewed);
    assert.ok(deltaLimit.sessions.reviewer);
    deltaLimit.sessions.reviewer.consecutiveDeltaReviews = 2;
    assert.equal(
      reviewExecutionPolicy(deltaLimit, settings).rotationReason,
      "delta-limit-reached"
    );

    for (const reason of [
      "legacy-state",
      "previous-review-failed",
      "previous-review-interrupted",
      "accepted-high-risk-finding",
      "unreliable-review"
    ] as const) {
      const forced = structuredClone(reviewed);
      forced.pendingReviewRotationReason = reason;
      const policy = reviewExecutionPolicy(forced, settings);
      assert.equal(policy.sessionMode, "fresh");
      assert.equal(policy.reviewMode, "full");
      assert.equal(policy.rotationReason, reason);
      assert.equal(policy.resumeSessionId, null);
    }
  } finally {
    await repository.dispose();
  }
});

test("mismatched builder settings start implementation fresh", async () => {
  const repository = await createTestRepository();
  try {
    const configPath = path.join(repository.root, ".banzai/config.json");
    const config = JSON.parse(await readFile(configPath, "utf8")) as {
      models: { implementer: { model: string } };
    };
    config.models.implementer.model = "different-model";
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");

    const adapters = new FakeAdapters();
    adapters.reviewResults.push(passingReview());
    const runner = new WorkflowRunner(repository.root, adapters);
    await runner.start({ slug: "example", request: "Implement it." });
    const done = await runner.approvePlan("human");

    assert.equal(done.status, "done", done.blockReason ?? "");
    assert.deepEqual(adapters.phaseResumeSessionIds, [null, null]);
    assert.equal(done.sessions.implementer?.model, "different-model");
    assert.deepEqual(done.metrics.sessions, { fresh: 4, resumed: 0 });
  } finally {
    await repository.dispose();
  }
});

test("accepted security findings rotate the reviewer before re-review", async () => {
  const repository = await createTestRepository();
  try {
    const securityFinding = {
      ...finding("R1-F1", "Security defect."),
      category: "security" as const
    };
    const adapters = new FakeAdapters();
    adapters.reviewResults.push(
      {
        contractVersion: CONTRACT_VERSION,
        verdict: "changes_requested",
        summary: "Security finding.",
        findings: [securityFinding],
        reviewedFindingIds: [],
        deferredCoverage: []
      },
      passingReview(["R1-F1"])
    );
    const runner = new WorkflowRunner(repository.root, adapters);
    await runner.start({ slug: "example", request: "Implement it." });
    await runner.approvePlan("human");

    const fixing = await runner.triage(
      {
        accepted: ["R1-F1"],
        rejected: [],
        deferred: [],
        note: null,
        decidedBy: "human"
      },
      false
    );
    assert.equal(
      fixing.pendingReviewRotationReason,
      "accepted-high-risk-finding"
    );

    const done = await runner.resume();
    assert.equal(done.status, "done", done.blockReason ?? "");
    assert.deepEqual(adapters.reviewResumeSessionIds, [null, null]);
    assert.equal(done.latestReview?.mode, "full");
    assert.equal(
      done.latestReview.rotationReason,
      "accepted-high-risk-finding"
    );
    assert.deepEqual(done.metrics.reviews, {
      full: 2,
      delta: 0,
      rotations: 1
    });
  } finally {
    await repository.dispose();
  }
});

test("accepted blocker findings rotate the reviewer before re-review", async () => {
  const repository = await createTestRepository();
  try {
    const blockerFinding = {
      ...finding("R1-F1", "Blocking defect."),
      severity: "blocker" as const
    };
    const adapters = new FakeAdapters();
    adapters.reviewResults.push(
      {
        contractVersion: CONTRACT_VERSION,
        verdict: "changes_requested",
        summary: "Blocker finding.",
        findings: [blockerFinding],
        reviewedFindingIds: [],
        deferredCoverage: []
      },
      passingReview(["R1-F1"])
    );
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
    assert.deepEqual(adapters.reviewResumeSessionIds, [null, null]);
    assert.equal(
      done.latestReview?.rotationReason,
      "accepted-high-risk-finding"
    );
  } finally {
    await repository.dispose();
  }
});

test("two delta reviews force the following review to start fresh and full", async () => {
  const repository = await createTestRepository();
  try {
    const changesRequested = (
      iteration: number,
      reviewedFindingIds: string[]
    ): ReviewResult => ({
      contractVersion: CONTRACT_VERSION,
      verdict: "changes_requested",
      summary: `Finding in review ${iteration}.`,
      findings: [finding(`R${iteration}-F1`, `Defect ${iteration}.`)],
      reviewedFindingIds,
      deferredCoverage: []
    });
    const adapters = new FakeAdapters();
    adapters.reviewResults.push(
      changesRequested(1, []),
      changesRequested(2, ["R1-F1"]),
      changesRequested(3, ["R2-F1"]),
      passingReview(["R3-F1"])
    );
    const runner = new WorkflowRunner(repository.root, adapters);
    await runner.start({ slug: "example", request: "Implement it." });
    await runner.approvePlan("human");
    for (const findingId of ["R1-F1", "R2-F1", "R3-F1"]) {
      await runner.triage({
        accepted: [findingId],
        rejected: [],
        deferred: [],
        note: null,
        decidedBy: "human"
      });
    }
    const done = (await runner.status()).state;

    assert.equal(done.status, "done", done.blockReason ?? "");
    assert.deepEqual(adapters.reviewResumeSessionIds, [
      null,
      "fresh-review-session",
      "fresh-review-session",
      null
    ]);
    assert.equal(done.latestReview?.mode, "full");
    assert.equal(done.latestReview.rotationReason, "delta-limit-reached");
    assert.deepEqual(done.metrics.reviews, {
      full: 2,
      delta: 2,
      rotations: 1
    });
    assert.equal(done.triageHistory.length, 3);
    assert.deepEqual(done.metrics.triage, {
      accepted: 3,
      rejected: 0,
      deferred: 0
    });
  } finally {
    await repository.dispose();
  }
});

test("a reviewer result without a session id falls back to a fresh full re-review", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new FakeAdapters();
    adapters.reviewSessionIds.push(null);
    adapters.reviewResults.push(
      {
        contractVersion: CONTRACT_VERSION,
        verdict: "changes_requested",
        summary: "One finding.",
        findings: [finding("R1-F1", "Defect.")],
        reviewedFindingIds: [],
        deferredCoverage: []
      },
      passingReview(["R1-F1"])
    );
    const runner = new WorkflowRunner(repository.root, adapters);
    await runner.start({ slug: "example", request: "Implement it." });
    const reviewed = await runner.approvePlan("human");
    assert.equal(reviewed.sessions.reviewer, null);
    assert.equal(reviewed.pendingReviewRotationReason, "missing-session");

    const done = await runner.triage({
      accepted: ["R1-F1"],
      rejected: [],
      deferred: [],
      note: null,
      decidedBy: "human"
    });
    assert.equal(done.status, "done", done.blockReason ?? "");
    assert.deepEqual(adapters.reviewResumeSessionIds, [null, null]);
    assert.equal(done.latestReview?.rotationReason, "missing-session");
  } finally {
    await repository.dispose();
  }
});

test("a terminal passing review without a session id does not advertise a future rotation", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new FakeAdapters();
    adapters.reviewSessionIds.push(null);
    adapters.reviewResults.push(passingReview());
    const runner = new WorkflowRunner(repository.root, adapters);
    await runner.start({ slug: "example", request: "Implement it." });

    const done = await runner.approvePlan("human");

    assert.equal(done.status, "done", done.blockReason ?? "");
    assert.equal(done.sessions.reviewer, null);
    assert.equal(done.pendingReviewRotationReason, null);
  } finally {
    await repository.dispose();
  }
});

test("a blocked review verdict rotates before an explicit retry", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new FakeAdapters();
    adapters.reviewResults.push(
      {
        contractVersion: CONTRACT_VERSION,
        verdict: "blocked",
        summary: "Required evidence is unavailable.",
        findings: [],
        reviewedFindingIds: [],
        deferredCoverage: ["External evidence was unavailable."]
      },
      passingReview()
    );
    const runner = new WorkflowRunner(repository.root, adapters);
    await runner.start({ slug: "example", request: "Implement it." });
    const blocked = await runner.approvePlan("human");
    assert.equal(blocked.status, "blocked");
    assert.equal(
      blocked.pendingReviewRotationReason,
      "previous-review-blocked"
    );
    assert.equal((await runner.status()).retry.eligible, true);

    const done = await runner.retry();
    assert.equal(done.status, "done", done.blockReason ?? "");
    assert.deepEqual(adapters.reviewResumeSessionIds, [null, null]);
    assert.equal(done.latestReview?.mode, "full");
    assert.equal(done.latestReview.rotationReason, "previous-review-blocked");
  } finally {
    await repository.dispose();
  }
});

function capacityFailure(): ProcessExitError {
  return new ProcessExitError(
    "CLAUDE_REVIEW_FAILED",
    "Claude exited 1: You've hit your session limit",
    {
      exitCode: 1,
      signal: null,
      stdout: "capacity stdout\n",
      stderr: "",
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:00:30.000Z"
    },
    {
      failureCause: "capacity",
      usage: {
        inputTokens: 4,
        cachedInputTokens: 368982,
        outputTokens: 469,
        costUsd: 3.2666075
      }
    }
  );
}

async function useClaudeReviewer(root: string): Promise<void> {
  const configPath = path.join(root, ".banzai/config.json");
  const config = JSON.parse(await readFile(configPath, "utf8")) as {
    models: { reviewer: { executable: string } };
  };
  const claudeExecutable = path.join(root, "tools", "claude");
  await mkdir(path.dirname(claudeExecutable), { recursive: true });
  await writeFile(claudeExecutable, "#!/bin/sh\nexit 0\n", "utf8");
  await chmod(claudeExecutable, 0o755);
  config.models.reviewer.executable = claudeExecutable;
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

async function failedRereviewFixture(error: Error) {
  const repository = await createTestRepository();
  await useClaudeReviewer(repository.root);
  const adapters = new FakeAdapters();
  adapters.reviewResults.push({
    contractVersion: CONTRACT_VERSION,
    verdict: "changes_requested",
    summary: "One finding.",
    findings: [finding("R1-F1", "Defect.")],
    reviewedFindingIds: [],
    deferredCoverage: []
  });
  let reviewCalls = 0;
  adapters.onReview = async () => {
    reviewCalls += 1;
    if (reviewCalls === 2) {
      throw error;
    }
  };
  const runner = new WorkflowRunner(repository.root, adapters);
  await runner.start({ slug: "example", request: "Implement it." });
  const triaged = await runner.approvePlan("human");
  assert.equal(triaged.status, "needs_triage");
  const beforeUsage = structuredClone(triaged.metrics.usage);
  const reviewerBefore = triaged.sessions.reviewer;
  assert.ok(reviewerBefore);
  const blocked = await runner.triage({
    accepted: ["R1-F1"],
    rejected: [],
    deferred: [],
    note: null,
    decidedBy: "human"
  });
  return { repository, runner, adapters, blocked, beforeUsage, reviewerBefore };
}

test("a capacity failure preserves reviewer continuity instead of forcing a full re-audit", async () => {
  const { repository, runner, blocked, beforeUsage, reviewerBefore } =
    await failedRereviewFixture(capacityFailure());
  try {
    assert.equal(blocked.status, "blocked");
    assert.equal(blocked.activeAttempt?.kind, "review");
    assert.equal(blocked.pendingReviewRotationReason, null);
    const reviewer = blocked.sessions.reviewer;
    assert.ok(reviewer);
    assert.equal(reviewer.id, reviewerBefore.id);
    const policy = reviewExecutionPolicy(blocked, {
      executable: reviewer.executable,
      model: reviewer.model,
      effort: reviewer.effort,
      timeoutMs: 1_000
    });
    assert.equal(policy.sessionMode, "resumed");
    assert.equal(policy.reviewMode, "delta");
    assert.equal(policy.rotationReason, null);
    assert.equal(policy.resumeSessionId, reviewer.id);

    const record = await runner.store.readRunAttempt(
      blocked.runId,
      blocked.activeAttempt
    );
    assert.equal(record.failureCause, "capacity");
    assert.ok(record.usage);
    assert.equal(record.usage.cachedInputTokens, 368982);
    assert.equal(record.usage.costUsd, 3.2666075);
    assert.ok(record.rawStdoutPath);
    assert.equal(
      blocked.metrics.usage.cachedInputTokens - beforeUsage.cachedInputTokens,
      368982
    );
    assert.equal(
      (blocked.metrics.usage.costUsd ?? 0) - (beforeUsage.costUsd ?? 0),
      3.2666075
    );
    // Consumed, but never completed: no verdict or review metric may follow.
    assert.ok(
      !blocked.metrics.completedAttemptIds.includes(blocked.activeAttempt.id)
    );
    assert.equal(blocked.latestReview?.iteration, 1);
  } finally {
    await repository.dispose();
  }
});

test("an unclassified review failure still rotates to a fresh full reviewer", async () => {
  const { repository, runner, blocked } = await failedRereviewFixture(
    new Error("review provider returned nonsense")
  );
  try {
    assert.equal(blocked.pendingReviewRotationReason, "previous-review-failed");
    assert.ok(blocked.activeAttempt);
    const record = await runner.store.readRunAttempt(
      blocked.runId,
      blocked.activeAttempt
    );
    assert.equal(record.failureCause, "unclassified");
    const reviewer = blocked.sessions.reviewer;
    assert.ok(reviewer);
    const policy = reviewExecutionPolicy(blocked, {
      executable: reviewer.executable,
      model: reviewer.model,
      effort: reviewer.effort,
      timeoutMs: 1_000
    });
    assert.equal(policy.sessionMode, "fresh");
    assert.equal(policy.reviewMode, "full");
    assert.equal(policy.rotationReason, "previous-review-failed");
  } finally {
    await repository.dispose();
  }
});

test("a changed invocation scope rotates the reviewer before any process starts", async () => {
  const repository = await createTestRepository();
  try {
    await useClaudeReviewer(repository.root);
    const adapters = new FakeAdapters();
    adapters.reviewResults.push({
      contractVersion: CONTRACT_VERSION,
      verdict: "changes_requested",
      summary: "One finding.",
      findings: [finding("R1-F1", "Defect.")],
      reviewedFindingIds: [],
      deferredCoverage: []
    });
    const runner = new WorkflowRunner(repository.root, adapters);
    await runner.start({ slug: "example", request: "Implement it." });
    const reviewed = await runner.approvePlan("human");
    const reviewer = reviewed.sessions.reviewer;
    assert.ok(reviewer);
    const settings = {
      executable: reviewer.executable,
      model: reviewer.model,
      effort: reviewer.effort,
      timeoutMs: 1_000
    };
    assert.ok(reviewer.invocationDigest);
    assert.equal(
      reviewExecutionPolicy(reviewed, settings, reviewer.invocationDigest)
        .rotationReason,
      null
    );
    assert.equal(
      reviewExecutionPolicy(
        reviewed,
        settings,
        invocationScopeDigest({
          strictMcpConfig: false,
          settingSources: null,
          pluginDirectory: null
        })
      ).rotationReason,
      "session-inventory-changed"
    );

    // A binding written before this evidence existed is unknown, not mismatched.
    const legacy = structuredClone(reviewed);
    assert.ok(legacy.sessions.reviewer);
    delete legacy.sessions.reviewer.invocationDigest;
    assert.equal(
      reviewExecutionPolicy(legacy, settings, "any-other-digest")
        .rotationReason,
      null
    );
  } finally {
    await repository.dispose();
  }
});

test("both reviewers publish one runner artifact with one primary context invocation", async () => {
  for (const vendor of ["codex", "claude"]) {
    const repository = await createTestRepository();
    try {
      if (vendor === "claude") await useClaudeReviewer(repository.root);
      const adapters = new FakeAdapters();
      adapters.reviewResults.push(passingReview());
      adapters.reviewUsages.push({
        inputTokens: 11,
        cachedInputTokens: 3,
        outputTokens: 5,
        costUsd: 0.1
      });
      const runner = new WorkflowRunner(repository.root, adapters);
      await runner.start({ slug: "example", request: "Implement it." });
      const done = await runner.approvePlan("human");
      assert.equal(done.status, "done", done.blockReason ?? "");
      assert.equal(adapters.reviewPrompts.length, 1);
      const attempt = (await runner.store.readRunAttempts(done.runId)).find(
        (record) => record.attempt.kind === "review"
      );
      assert.ok(attempt);
      const ledger = await runner.store.readContextLedgerIfPresent(
        done.runId,
        attempt.attempt
      );
      assert.ok(ledger);
      assert.deepEqual(
        ledger.invocations.map((invocation) => invocation.kind),
        ["primary"]
      );
      assert.deepEqual(
        ledger.invocations.map((invocation) => invocation.outcome),
        ["completed"]
      );
      assert.equal(attempt.usage?.inputTokens, 11);
      const checkpoint = await runner.store.readTerminalCheckpointIfExists(
        done.runId,
        attempt.attempt
      );
      assert.ok(checkpoint);
      assert.equal(checkpoint.resultContract, "review-result/v2");
      const frozen = await runner.store.readReviewSnapshot(
        done.runId,
        attempt.attempt
      );
      const canonical = await readFile(
        path.join(repository.root, frozen.artifact.path),
        "utf8"
      );
      assert.equal(
        canonical,
        renderReviewArtifact(attempt.result as ReviewResult, {
          ...frozen.artifact,
          snapshot: frozen
        })
      );
      assert.ok(frozen.completionSource);
      assert.ok(
        canonical.includes(
          JSON.stringify(frozen.completionSource.implementationReport.sha256)
        )
      );
      assert.ok(
        canonical.includes(
          JSON.stringify(frozen.completionSource.testReport.sha256)
        )
      );
      const policyState = structuredClone(done);
      policyState.status = "needs_triage";
      assert.ok(policyState.sessions.reviewer);
      for (const outputContract of [undefined, "review-result/v1"] as const) {
        if (outputContract === undefined)
          delete policyState.sessions.reviewer.outputContract;
        else policyState.sessions.reviewer.outputContract = outputContract;
        const policy = reviewExecutionPolicy(policyState, {
          ...policyState.sessions.reviewer,
          timeoutMs: 1000
        });
        assert.equal(policy.rotationReason, "output-contract-not-reusable");
        assert.equal(policy.reviewMode, "full");
        assert.equal(policy.resumeSessionId, null);
      }
    } finally {
      await repository.dispose();
    }
  }
});

test("review rendering failures retain primary evidence and make zero formatting repair calls", async () => {
  for (const vendor of ["codex", "claude"]) {
    for (const defect of ["write", "validation"]) {
      const repository = await createTestRepository();
      try {
        if (vendor === "claude") await useClaudeReviewer(repository.root);
        const adapters = new FakeAdapters();
        adapters.reviewResults.push(passingReview());
        adapters.reviewUsages.push({
          inputTokens: 1,
          cachedInputTokens: 2,
          outputTokens: 3,
          costUsd: 4
        });
        adapters.reviewStdout.push("primary stdout\n");
        adapters.reviewStderr.push("primary stderr\n");
        const runner = new WorkflowRunner(repository.root, adapters);
        const write = runner.store.writeText.bind(runner.store);
        let injected = false;
        runner.store.writeText = async (runId, relative, text) => {
          if (relative.endsWith(".review-candidate.md")) {
            injected = true;
            if (defect === "write")
              throw new BanzaiError(
                "RENDER_IO_FAILED",
                "Injected candidate write failure."
              );
            text = "Injected corrupt candidate.\n";
          }
          return await write(runId, relative, text);
        };
        await runner.start({ slug: "example", request: "Implement it." });
        const blocked = await runner.approvePlan("human");
        assert.equal(injected, true);
        assert.equal(blocked.status, "blocked");
        assert.equal(adapters.reviewPrompts.length, 1);
        assert.equal(blocked.latestReview, null);
        assert.ok(blocked.activeAttempt);
        const record = await runner.store.readRunAttempt(
          blocked.runId,
          blocked.activeAttempt
        );
        assert.equal(record.reviewCandidate?.validation, "failed");
        assert.equal(
          record.failureCode,
          defect === "write" ? "RENDER_IO_FAILED" : "INVALID_REVIEW_ARTIFACT"
        );
        assert.equal((record.result as ReviewResult).schemaVersion, 2);
        assert.deepEqual(record.usage, {
          inputTokens: 1,
          cachedInputTokens: 2,
          outputTokens: 3,
          costUsd: 4
        });
        assert.equal(blocked.metrics.usage.inputTokens, 1);
        assert.ok(record.rawStdoutPath);
        assert.ok(record.rawStderrPath);
        assert.equal(
          await readFile(
            path.join(
              runner.store.runDirectory(blocked.runId),
              record.rawStdoutPath
            ),
            "utf8"
          ),
          "primary stdout\n"
        );
        assert.equal(
          await readFile(
            path.join(
              runner.store.runDirectory(blocked.runId),
              record.rawStderrPath
            ),
            "utf8"
          ),
          "primary stderr\n"
        );
        await assert.rejects(
          readFile(
            await boundFixturePath(
              repository.root,
              "documentation/features/example/review-1.md"
            )
          ),
          /ENOENT/
        );
      } finally {
        await repository.dispose();
      }
    }
  }
});

test("retry reruns a failed review in a fresh attempt", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new FakeAdapters();
    adapters.reviewErrors.push(new Error("review provider unavailable"));
    adapters.reviewResults.push(passingReview());
    const runner = new WorkflowRunner(repository.root, adapters);
    await runner.start({ slug: "example", request: "Implement it." });

    const blocked = await runner.approvePlan("human");
    assert.equal(blocked.status, "blocked");
    assert.equal(blocked.activeAttempt?.kind, "review");
    assert.equal(blocked.pendingReviewRotationReason, "previous-review-failed");
    assert.equal((await runner.status()).retry.eligible, true);

    const done = await runner.retry();
    assert.equal(done.status, "done", done.blockReason ?? "");
    assert.equal(done.reviewIteration, 1);
    assert.equal(done.latestReview?.iteration, 1);
    assert.equal(
      done.latestReview.artifactPath,
      path.relative(
        repository.root,
        await boundFixturePath(
          repository.root,
          "documentation/features/example/review-1.md"
        )
      )
    );
    assert.equal(done.metrics.attempts.review, 2);
    assert.equal(adapters.reviewPrompts.length, 2);
    assert.deepEqual(adapters.reviewResumeSessionIds, [null, null]);
    assert.equal(done.latestReview.rotationReason, "previous-review-failed");
  } finally {
    await repository.dispose();
  }
});

test("invalid review candidate retains diagnostic evidence and retry publishes without replacing prior canonical state", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new FakeAdapters();
    adapters.reviewResults.push(
      {
        contractVersion: CONTRACT_VERSION,
        verdict: "changes_requested",
        summary: "One finding.",
        findings: [finding("R1-F1", "Fix this defect.")],
        reviewedFindingIds: [],
        deferredCoverage: []
      },
      passingReview(["R1-F1"]),
      passingReview(["R1-F1"])
    );
    adapters.reviewStdout.push(
      "first review stdout\n",
      "invalid review stdout\n",
      "retry review stdout\n"
    );
    adapters.reviewStderr.push(
      "first review stderr\n",
      "invalid review stderr\n",
      "retry review stderr\n"
    );
    const runner = new WorkflowRunner(repository.root, adapters);
    await runner.start({ slug: "example", request: "Implement it." });

    const firstReview = await runner.approvePlan("human");
    assert.equal(firstReview.status, "needs_triage");
    assert.ok(firstReview.latestReview);
    assert.equal(firstReview.latestReview.iteration, 1);
    const firstArtifactPath = firstReview.latestReview.artifactPath;
    assert.ok(firstArtifactPath);
    const firstCanonicalPath = path.join(repository.root, firstArtifactPath);
    const firstCanonical = await readFile(firstCanonicalPath, "utf8");

    const write = runner.store.writeText.bind(runner.store);
    let corrupt = true;
    runner.store.writeText = async (runId, relative, text) => {
      if (corrupt && relative.endsWith(".review-candidate.md")) {
        corrupt = false;
        text = "Corrupt candidate.\n";
      }
      return await write(runId, relative, text);
    };
    const blocked = await runner.triage({
      accepted: ["R1-F1"],
      rejected: [],
      deferred: [],
      note: null,
      decidedBy: "human"
    });
    assert.equal(blocked.status, "blocked");
    assert.equal(blocked.latestReview?.iteration, 1);
    assert.equal(await readFile(firstCanonicalPath, "utf8"), firstCanonical);
    const failedAttempt = blocked.activeAttempt;
    assert.equal(failedAttempt?.kind, "review");
    assert.ok(failedAttempt);
    const failedRecord = await runner.store.readRunAttempt(
      blocked.runId,
      failedAttempt
    );
    assert.equal(failedRecord.status, "failed");
    assert.equal(failedRecord.failureCode, "INVALID_REVIEW_ARTIFACT");
    assert.ok(failedRecord.result);
    assert.ok(failedRecord.rawStdoutPath);
    assert.ok(failedRecord.rawStderrPath);
    assert.ok(failedRecord.reviewCandidate);
    assert.deepEqual(failedRecord.reviewCandidate, {
      source: "runner-rendered",
      evidencePath: `attempts/${failedAttempt.id}.review-candidate.md`,
      intendedArtifactPath: path.relative(
        repository.root,
        await boundFixturePath(
          repository.root,
          "documentation/features/example/review-2.md"
        )
      ),
      sha256: failedRecord.reviewCandidate.sha256,
      validation: "failed",
      validationCode: "INVALID_REVIEW_ARTIFACT",
      validationError: failedRecord.reviewCandidate.validationError,
      canonical: false
    });
    assert.match(failedRecord.reviewCandidate.sha256 ?? "", /^[a-f0-9]{64}$/u);
    const runDirectory = runner.store.runDirectory(blocked.runId);
    assert.equal(
      await readFile(
        path.join(runDirectory, failedRecord.rawStdoutPath),
        "utf8"
      ),
      "invalid review stdout\n"
    );
    assert.equal(
      await readFile(
        path.join(runDirectory, failedRecord.rawStderrPath),
        "utf8"
      ),
      "invalid review stderr\n"
    );
    const failedCandidate = await readFile(
      path.join(runDirectory, failedRecord.reviewCandidate.evidencePath),
      "utf8"
    );
    assert.equal(
      (
        await stat(
          path.join(runDirectory, failedRecord.reviewCandidate.evidencePath)
        )
      ).mode & 0o777,
      0o600
    );
    assert.doesNotMatch(
      failedCandidate,
      /"documentation\/features\/example\/description\.md"/
    );
    await assert.rejects(
      readFile(
        await boundFixturePath(
          repository.root,
          "documentation/features/example/review-2.md"
        ),
        "utf8"
      ),
      /ENOENT/u
    );
    const status = await runner.status();
    assert.equal(status.retry.eligible, true);
    assert.equal(status.nextAction, "banzai retry");

    const done = await runner.retry();
    assert.equal(done.status, "done", done.blockReason ?? "");
    assert.ok(done.latestReview);
    assert.equal(done.latestReview.iteration, 2);
    const retryArtifactPath = done.latestReview.artifactPath;
    assert.ok(retryArtifactPath);
    assert.notEqual(done.activeAttempt?.id, failedAttempt.id);
    assert.equal(
      await readFile(
        path.join(runDirectory, failedRecord.rawStdoutPath),
        "utf8"
      ),
      "invalid review stdout\n"
    );
    assert.equal(
      await readFile(
        path.join(runDirectory, failedRecord.reviewCandidate.evidencePath),
        "utf8"
      ),
      failedCandidate
    );
    const canonicalRetry = await readFile(
      path.join(repository.root, retryArtifactPath),
      "utf8"
    );
    assert.ok(
      canonicalRetry.includes(
        JSON.stringify(requiredFixture(done.planArtifacts).description)
      )
    );
    const attemptFiles = (
      await readdir(path.join(runDirectory, "attempts"))
    ).filter((entry) => entry.endsWith("-review.json"));
    assert.equal(attemptFiles.length, 3);
    const completedRetryRecord = (
      await Promise.all(
        attemptFiles.map(
          async (entry) =>
            JSON.parse(
              await readFile(path.join(runDirectory, "attempts", entry), "utf8")
            ) as AttemptRecord
        )
      )
    ).find(
      (record) =>
        record.attempt.id !== failedAttempt.id &&
        record.status === "completed" &&
        record.reviewCandidate?.intendedArtifactPath.endsWith("review-2.md")
    );
    assert.ok(completedRetryRecord);
    assert.ok(completedRetryRecord.reviewCandidate);
    assert.equal(completedRetryRecord.reviewCandidate.validation, "passed");
    assert.equal(completedRetryRecord.reviewCandidate.canonical, false);
    assert.notEqual(
      completedRetryRecord.reviewCandidate.evidencePath,
      failedRecord.reviewCandidate.evidencePath
    );
  } finally {
    await repository.dispose();
  }
});

test("workspace drift during review invalidates the result", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new FakeAdapters();
    adapters.reviewResults.push(passingReview(), passingReview());
    adapters.onReview = async (request) => {
      await writeFile(
        path.join(request.repoRoot, "src/review-drift.txt"),
        "changed during review\n",
        "utf8"
      );
    };
    const runner = new WorkflowRunner(repository.root, adapters);
    await runner.start({ slug: "example", request: "Implement it." });
    const blocked = await runner.approvePlan("human");
    assert.equal(blocked.status, "blocked");
    assert.match(
      blocked.blockReason ?? "",
      /Phase review changed an unauthorized artifact or source path/
    );
    assert.equal(blocked.reviewIteration, 0);
    assert.equal(blocked.pendingReviewRotationReason, "unreliable-review");

    const done = await runner.retry();
    assert.equal(done.status, "done", done.blockReason ?? "");
    assert.equal(done.reviewIteration, 1);
    assert.equal(done.latestReview?.rotationReason, "unreliable-review");
  } finally {
    await repository.dispose();
  }
});

test("ADR decisions are recorded before planning can continue", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new FakeAdapters();
    adapters.planResults.push(
      phaseResult("plan", {
        outcome: "needs_human_decision",
        gate: "adr_approval",
        summary: "ADR-0001 needs a human decision.",
        artifacts: {
          description: descriptionPath,
          plan: null,
          adrs: ["documentation/decisions/0001-example.md"],
          implementationReport: null,
          testReport: null
        }
      }),
      phaseResult("plan", {
        artifacts: {
          description: descriptionPath,
          plan: planPath,
          adrs: ["documentation/decisions/0001-example.md"],
          implementationReport: null,
          testReport: null
        }
      })
    );
    const adrPath = path.join(
      repository.root,
      "documentation/decisions/0001-example.md"
    );
    await mkdir(path.dirname(adrPath), { recursive: true });
    await writeFile(adrPath, "# ADR-0001\n\nStatus: Proposed\n", "utf8");
    await commitAll(repository.root, "proposed ADR");

    const runner = new WorkflowRunner(repository.root, adapters);
    const gated = await runner.start({
      slug: "example",
      request: "Plan the architectural change."
    });
    assert.equal(gated.status, "needs_adr_approval");

    const planning = await runner.decideAdr({
      id: "ADR-0001",
      decision: "accept",
      note: "Approved after review.",
      decidedBy: "human",
      autoResume: false
    });
    assert.equal(planning.status, "planning");
    assert.equal(planning.adrDecisions[0]?.decision, "accept");

    const planGate = await runner.resume();
    assert.equal(planGate.status, "needs_plan_approval");
    assert.match(adapters.phasePrompts[1] ?? "", /ADR-0001/);
    assert.match(adapters.phasePrompts[1] ?? "", /"decision": "accept"/);
  } finally {
    await repository.dispose();
  }
});

test("cancel requested during verification is not overwritten by completion", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new FakeAdapters();
    const verificationRunner = async (): Promise<ProcessResult> => {
      await runner.cancel();
      return {
        exitCode: 0,
        signal: null,
        stdout: "",
        stderr: "",
        startedAt: "2026-01-01T00:00:00.000Z",
        completedAt: "2026-01-01T00:00:01.000Z"
      };
    };
    const runner = new WorkflowRunner(
      repository.root,
      adapters,
      verificationRunner
    );
    await runner.start({ slug: "example", request: "Implement it." });
    const cancelled = await runner.approvePlan("human");
    assert.equal(cancelled.status, "cancelled");
    assert.equal(adapters.reviewPrompts.length, 0);
  } finally {
    await repository.dispose();
  }
});

test("review v2 snapshot failure prevents invocation", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new FakeAdapters();
    const runner = new WorkflowRunner(repository.root, adapters);
    await runner.start({ slug: "example", request: "Implement it." });
    runner.store.writeReviewSnapshot = async () => {
      throw new BanzaiError("SNAPSHOT_IO_FAILED", "Injected snapshot failure.");
    };
    const blocked = await runner.approvePlan("human");
    assert.equal(blocked.status, "blocked");
    assert.equal(adapters.reviewPrompts.length, 0);
    assert.ok(blocked.activeAttempt);
    assert.equal(
      (await runner.store.readRunAttempt(blocked.runId, blocked.activeAttempt))
        .failureCode,
      "SNAPSHOT_IO_FAILED"
    );
  } finally {
    await repository.dispose();
  }
});

test("review v2 publication and application interruptions reconcile exactly once without a model call", async () => {
  for (const boundary of [
    "publication",
    "json",
    "event-before",
    "event-after",
    "state-before",
    "state-after"
  ]) {
    const repository = await createTestRepository();
    try {
      const adapters = new FakeAdapters();
      adapters.reviewResults.push(passingReview());
      const runner = new WorkflowRunner(repository.root, adapters);
      await runner.start({ slug: "example", request: "Implement it." });
      const artifact = await boundFixturePath(
        repository.root,
        "documentation/features/example/review-1.md"
      );
      let injected = false;
      const write = runner.store.writeText.bind(runner.store);
      runner.store.writeText = async (id, relative, text) => {
        return await write(id, relative, text);
      };
      const jsonWrite = runner.store.writeReviewResult.bind(runner.store);
      runner.store.writeReviewResult = async (...args) => {
        if (!injected && boundary === "json") {
          injected = true;
          throw new Error("Injected JSON failure.");
        }
        await jsonWrite(...args);
      };
      const recordWrite = runner.store.writeRunAttempt.bind(runner.store);
      runner.store.writeRunAttempt = async (id, record) => {
        await recordWrite(id, record);
        if (
          !injected &&
          boundary === "publication" &&
          record.reviewCandidate?.validation === "passed"
        ) {
          injected = true;
          await mkdir(artifact);
        }
      };
      const event = runner.store.appendEvent.bind(runner.store);
      runner.store.appendEvent = async (...args) => {
        if (
          !injected &&
          args[1] === "review.completed" &&
          boundary.startsWith("event-")
        ) {
          injected = true;
          if (boundary === "event-after") await event(...args);
          throw new Error("Injected event boundary.");
        }
        return await event(...args);
      };
      const state = runner.store.writeState.bind(runner.store);
      runner.store.writeState = async (...args) => {
        if (
          !injected &&
          args[0].status === "done" &&
          boundary.startsWith("state-")
        ) {
          injected = true;
          if (boundary === "state-after") await state(...args);
          throw new Error("Injected state boundary.");
        }
        await state(...args);
      };
      const interrupted = await runner.approvePlan("human");
      assert.equal(injected, true, boundary);
      assert.equal(
        interrupted.status,
        boundary === "state-after" ? "done" : "blocked",
        boundary
      );
      const before = await runner.store.readRunAttempts(interrupted.runId);
      const review = before.find((record) => record.attempt.kind === "review");
      assert.ok(review);
      assert.ok(
        await runner.store.readTerminalCheckpointIfExists(
          interrupted.runId,
          review.attempt
        )
      );
      if (boundary === "publication") await rm(artifact, { recursive: true });
      const done =
        interrupted.status === "done" ? interrupted : await runner.resume();
      assert.equal(done.status, "done", `${boundary}: ${done.blockReason}`);
      assert.equal(adapters.reviewPrompts.length, 1, boundary);
      assert.equal(done.reviewIteration, 1);
      assert.equal(
        done.metrics.completedAttemptIds.filter(
          (id) => id === review.attempt.id
        ).length,
        1
      );
      const events = (
        await readFile(
          path.join(runner.store.runDirectory(done.runId), "events.jsonl"),
          "utf8"
        )
      )
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as { type: string });
      assert.equal(
        events.filter((item) => item.type === "review.completed").length,
        1,
        boundary
      );
      assert.ok(
        (await runner.store.readRunAttempt(done.runId, review.attempt))
          .reviewDiagnostics?.length
      );
      const frozen = await runner.store.readReviewSnapshot(
        done.runId,
        review.attempt
      );
      assert.equal(
        await readFile(artifact, "utf8"),
        renderReviewArtifact(review.result as ReviewResult, {
          ...frozen.artifact,
          snapshot: frozen
        })
      );
      assert.deepEqual(
        JSON.parse(
          await readFile(
            path.join(
              runner.store.runDirectory(done.runId),
              "reviews/review-1.json"
            ),
            "utf8"
          )
        ),
        review.result
      );
    } finally {
      await repository.dispose();
    }
  }
});

test("review v2 truthful layout blockers publish incomplete coverage without completion or triage", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new FakeAdapters();
    adapters.onReview = async (request) => {
      const frozen = request.artifact.snapshot;
      assert.ok(frozen);
      adapters.reviewResults.push({
        ...passingReview(),
        schemaVersion: 2,
        reviewNotes: ["Authority is unavailable."],
        verdict: "blocked",
        summary: "legacy Banzai layout: run project-manifest to migrate",
        scopeAcknowledgment: {
          schemaVersion: 1,
          snapshotDigest: frozen.digest,
          artifacts: frozen.approval.paths.map((path) => ({
            path,
            status: "not_reviewed",
            reason: "Layout authority blocker."
          }))
        }
      });
    };
    const runner = new WorkflowRunner(repository.root, adapters);
    await runner.start({ slug: "example", request: "Implement it." });
    const blocked = await runner.approvePlan("human");
    assert.equal(blocked.status, "blocked");
    assert.equal(blocked.latestReview?.verdict, "blocked");
    assert.equal(blocked.activeAttempt, null);
    assert.equal(adapters.reviewPrompts.length, 1);
    assert.equal(blocked.triage, null);
    const contents = await readFile(
      await boundFixturePath(
        repository.root,
        "documentation/features/example/review-1.md"
      ),
      "utf8"
    );
    assert.match(contents, /not_reviewed/);
    assert.match(contents, /Layout authority blocker/);
  } finally {
    await repository.dispose();
  }
});

test("review v2 retains schema-valid rejected scope and terminal proof before coverage validation", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new FakeAdapters();
    adapters.onReview = async (request) => {
      const frozen = request.artifact.snapshot;
      assert.ok(frozen);
      adapters.reviewResults.push({
        ...passingReview(),
        schemaVersion: 2,
        reviewNotes: [],
        scopeAcknowledgment: {
          schemaVersion: 1,
          snapshotDigest: "f".repeat(64),
          artifacts: frozen.approval.paths.map((path) => ({
            path,
            status: "reviewed",
            reason: null
          }))
        }
      });
    };
    const runner = new WorkflowRunner(repository.root, adapters);
    await runner.start({ slug: "example", request: "Implement it." });
    const blocked = await runner.approvePlan("human");
    assert.equal(blocked.status, "blocked");
    assert.ok(blocked.activeAttempt);
    const record = await runner.store.readRunAttempt(
      blocked.runId,
      blocked.activeAttempt
    );
    assert.ok(record.result);
    assert.equal(
      (record.result as ReviewResult).scopeAcknowledgment?.snapshotDigest,
      "f".repeat(64)
    );
    assert.ok(
      await runner.store.readTerminalCheckpointIfExists(
        blocked.runId,
        blocked.activeAttempt
      )
    );
    assert.equal(record.status, "failed");
    assert.equal(blocked.latestReview, null);
    assert.equal(adapters.reviewPrompts.length, 1);
    await assert.rejects(
      readFile(
        await boundFixturePath(
          repository.root,
          "documentation/features/example/review-1.md"
        )
      ),
      /ENOENT/
    );
  } finally {
    await repository.dispose();
  }
});
