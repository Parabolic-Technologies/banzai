import assert from "node:assert/strict";
import { readFile, rm, writeFile, symlink, unlink } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { createHash } from "node:crypto";
import { BanzaiError } from "../src/errors.js";
import { createTestRepository, requiredFixture } from "./helpers.js";
import {
  FakeAdapters,
  phaseResult,
  passingReview,
  finding,
  createPlanningReviewFixture as fixture
} from "./workflow-fixtures.js";
import {
  planningReviewResult,
  planningReviewAnalysis,
  planningTriageAnswer as answer
} from "./planning-review-fixtures.js";
import { WorkflowRunner } from "../src/workflow.js";
import type { RunState } from "../src/types.js";
import { executeAgentControlCommand } from "../src/agent-control-cli.js";
import { HumanTimeStore } from "../src/human-time-store.js";
import { artifactPaths } from "../src/workflow/domain/artifact-scope.js";
import { digestArtifactBundle } from "../src/git.js";

async function bytes(runner: WorkflowRunner): Promise<string[]> {
  const state = await runner.store.requireActiveState();
  return Promise.all([
    readFile(runner.store.statePath(state.runId), "utf8"),
    readFile(
      path.join(runner.store.runDirectory(state.runId), "events.jsonl"),
      "utf8"
    )
  ]);
}

test("planning publication retains the prior approval digest, snapshot bytes and approval artifact paths", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new FakeAdapters();
    const runner = new WorkflowRunner(repository.root, adapters);
    await runner.start({ slug: "example", request: "Plan the example." });
    const state = await runner.approvePlan("owner", false);
    const approval = structuredClone(state.planApproval);
    assert.ok(approval);
    const snapshot = await runner.store.readApprovalSnapshot(state.runId);
    assert.ok(snapshot);
    const manifestPath = path.join(
      runner.store.runDirectory(state.runId),
      "approval/bundle.json"
    );
    const manifestBytes = await readFile(manifestPath);
    const bundle = await digestArtifactBundle(
      repository.root,
      artifactPaths(state)
    );
    // A returned planning gate can retain a prior approval as historical evidence.
    state.status = "needs_plan_approval";
    await runner.store.writeState(state);
    const requested = await runner.requestPlanningReview({
      paths: null,
      decidedBy: "owner",
      autoResume: false
    });
    const e = requiredFixture(requested.planningReview?.active);
    adapters.planningReviewResults.push({
      ...planningReviewResult(0, e.reviewNumber),
      scope: e.scope
    });
    const restored = await runner.resume();
    assert.equal(
      restored.status,
      "needs_plan_approval",
      restored.blockReason ?? ""
    );
    assert.deepEqual(restored.planApproval, approval);
    assert.deepEqual(
      await runner.store.readApprovalSnapshot(state.runId),
      snapshot
    );
    assert.deepEqual(await readFile(manifestPath), manifestBytes);
    assert.deepEqual(
      await digestArtifactBundle(repository.root, artifactPaths(restored)),
      bundle
    );
    const publication = requiredFixture(
      restored.planningReview?.closed[0]?.artifact
    );
    assert.ok(!artifactPaths(restored).includes(publication.path));
    assert.ok(
      !requiredFixture(restored.planApproval).paths.includes(publication.path)
    );
  } finally {
    await repository.dispose();
  }
});

test("workflow status projects requested, active, triage, restored and stale planning episodes", async () => {
  const f = await fixture(1);
  try {
    const initial = requiredFixture((await f.runner.status()).planningReview);
    assert.equal(initial.active?.step, "reviewing");
    assert.deepEqual(initial.decisions, []);
    assert.equal(initial.latest, null);
    const steps: string[] = [];
    f.adapters.onPlanning = async () => {
      const current = requiredFixture((await f.runner.status()).planningReview);
      assert.ok(current.active);
      steps.push(current.active.step);
      assert.equal(current.latest, null);
    };
    const triage = await f.runner.resume();
    assert.deepEqual(steps, ["reviewing", "analyzing"]);
    const pending = requiredFixture((await f.runner.status()).planningReview);
    assert.equal(pending.active?.step, "awaiting_triage");
    assert.equal(pending.active.findingCount, 1);
    assert.match(
      requiredFixture(pending.active.artifactPath),
      /planning-review-1\.md$/
    );
    await f.runner.answerPlanningReview({
      answer: answer(triage),
      decidedBy: "owner"
    });
    const restored = requiredFixture((await f.runner.status()).planningReview);
    assert.equal(restored.active, null);
    assert.equal(restored.latest?.outcome, "restored_no_action");
    assert.deepEqual(restored.decisions, ["approve", "rework", "review"]);
    assert.ok(restored.reviewPaths.length > 0);
    const requested = await f.runner.requestPlanningReview({
      paths: null,
      decidedBy: "owner",
      autoResume: false
    });
    const e = requiredFixture(requested.planningReview?.active);
    await writeFile(
      path.join(f.repository.root, requiredFixture(e.scope[0]).path),
      "External scope change.\n"
    );
    await f.runner.resume();
    const stale = requiredFixture((await f.runner.status()).planningReview);
    assert.equal(stale.active, null);
    assert.equal(stale.latest?.outcome, "stale");
    assert.deepEqual(stale.decisions, []);
    assert.deepEqual(stale.reviewPaths, []);
  } finally {
    await f.repository.dispose();
  }
});

test("reviewed paths publish plain SHA-256 independently computed from their file bytes", async () => {
  const f = await fixture();
  try {
    const scope = requiredFixture(f.requested.planningReview?.active).scope;
    const expected = await Promise.all(
      scope.map(async (item) => ({
        path: item.path,
        sha256: createHash("sha256")
          .update(await readFile(path.join(f.repository.root, item.path)))
          .digest("hex")
      }))
    );
    assert.deepEqual(scope, expected);
    const restored = await f.runner.resume();
    const artifact = requiredFixture(
      restored.planningReview?.closed[0]?.artifact
    );
    const contents = await readFile(
      path.join(f.repository.root, artifact.path)
    );
    for (const item of expected) {
      assert.ok(contents.toString().includes(item.path));
      assert.ok(contents.toString().includes(item.sha256));
    }
    assert.equal(
      artifact.sha256,
      createHash("sha256").update(contents).digest("hex")
    );
  } finally {
    await f.repository.dispose();
  }
});

test("a linked planning artifact with no state cursor reconciles idempotently without a model call", async () => {
  const f = await fixture();
  try {
    const crash: { state: RunState | null; events: string | null } = {
      state: null,
      events: null
    };
    const writeState = f.runner.store.writeState.bind(f.runner.store);
    const eventFile = path.join(
      f.runner.store.runDirectory(f.requested.runId),
      "events.jsonl"
    );
    f.runner.store.writeState = async (state) => {
      if (
        crash.state === null &&
        state.activeAttempt?.kind === "planning_review" &&
        state.planningReview?.active?.artifact === null &&
        state.metrics.completedAttemptIds.includes(state.activeAttempt.id)
      ) {
        crash.state = structuredClone(state);
        crash.events = await readFile(eventFile, "utf8");
      }
      await writeState(state);
    };
    const first = await f.runner.resume();
    assert.equal(first.status, "needs_plan_approval");
    f.runner.store.writeState = writeState;
    assert.ok(crash.state && crash.events !== null);
    assert.equal(crash.state.planningReview?.active?.artifact, null);
    const artifact = requiredFixture(first.planningReview?.closed[0]?.artifact);
    const before = await readFile(path.join(f.repository.root, artifact.path));
    await writeState(crash.state);
    await writeFile(eventFile, crash.events);
    const calls = f.adapters.planningRequests.length;
    const restored = await f.runner.resume();
    assert.equal(
      restored.status,
      "needs_plan_approval",
      restored.blockReason ?? ""
    );
    assert.equal(f.adapters.planningRequests.length, calls);
    assert.deepEqual(
      await readFile(path.join(f.repository.root, artifact.path)),
      before
    );
    assert.equal(restored.metrics.attempts.planning_review, 1);
    assert.equal(
      (await readFile(eventFile, "utf8"))
        .split("\n")
        .filter((line) => line.includes('"type":"planning_review.published"'))
        .length,
      1
    );
  } finally {
    await f.repository.dispose();
  }
});

test("a blocked applying result follows ordinary planning retry eligibility", async () => {
  const f = await fixture(1);
  try {
    const pending = await f.runner.resume();
    const value = answer(pending);
    value.additionalInstruction = "Apply the owner's revision.";
    f.adapters.planResults.push(
      phaseResult("plan", {
        outcome: "blocked",
        gate: null,
        summary: "The planner cannot complete this revision."
      })
    );
    const blocked = await f.runner.answerPlanningReview({
      answer: value,
      decidedBy: "owner"
    });
    assert.equal(blocked.status, "blocked", blocked.blockReason ?? "");
    assert.equal(blocked.planningReview?.active?.step, "applying");
    assert.equal(blocked.activeAttempt, null);
    assert.equal((await f.runner.status()).retry.eligible, false);
    const before = await bytes(f.runner);
    const calls = f.adapters.phasePrompts.length;
    await assert.rejects(
      f.runner.retry(),
      (error: unknown) =>
        error instanceof BanzaiError && error.code === "RETRY_NOT_ALLOWED"
    );
    assert.deepEqual(await bytes(f.runner), before);
    assert.equal(f.adapters.phasePrompts.length, calls);
  } finally {
    await f.repository.dispose();
  }
});

test("publication conflict retry reserves a new number and preserves human-time request evidence", async () => {
  const f = await fixture();
  try {
    const initial = requiredFixture(f.requested.planningReview?.active);
    const directory = requiredFixture(f.requested.artifactBinding).binding
      .artifacts.reviewDirectory;
    await writeFile(
      path.join(
        f.repository.root,
        directory,
        `planning-review-${initial.reviewNumber}.md`
      ),
      "Existing different publication bytes.\n"
    );
    const blocked = await f.runner.resume();
    assert.equal(blocked.status, "blocked");
    assert.equal(
      (
        await f.runner.store.readRunAttempt(
          blocked.runId,
          requiredFixture(blocked.activeAttempt)
        )
      ).failureCode,
      "PLANNING_REVIEW_PUBLICATION_CONFLICT"
    );
    const result = {
      ...planningReviewResult(0, initial.reviewNumber + 1),
      scope: initial.scope
    };
    f.adapters.planningReviewResults.push(result);
    const restored = await f.runner.retry();
    assert.equal(
      restored.status,
      "needs_plan_approval",
      restored.blockReason ?? ""
    );
    const closed = requiredFixture(restored.planningReview?.closed[0]);
    assert.equal(closed.episodeId, initial.episodeId);
    assert.equal(closed.reviewNumber, initial.reviewNumber + 1);
    assert.equal(
      await readFile(
        path.join(
          f.repository.root,
          directory,
          `planning-review-${initial.reviewNumber}.md`
        ),
        "utf8"
      ),
      "Existing different publication bytes.\n"
    );
    const evidence = await new HumanTimeStore(f.repository.root).readEvidence(
      restored.runId
    );
    assert.deepEqual(evidence.issues, []);
    assert.ok(evidence.observations.some((o) => o.kind === "plan_approval"));
  } finally {
    await f.repository.dispose();
  }
});

test("planning review leaves the next code review in its own R1 and review-1 namespace", async () => {
  const f = await fixture();
  try {
    const restored = await f.runner.resume();
    const planningArtifact = requiredFixture(
      restored.planningReview?.closed[0]?.artifact
    ).path;
    const before = await readFile(
      path.join(f.repository.root, planningArtifact)
    );
    f.adapters.reviewResults.push({
      ...passingReview(),
      verdict: "changes_requested",
      findings: [finding("R1-F1", "should_fix")]
    });
    const reviewed = await f.runner.approvePlan("owner", true);
    assert.equal(reviewed.status, "needs_triage", reviewed.blockReason ?? "");
    assert.equal(reviewed.reviewIteration, 1);
    const latest = requiredFixture(reviewed.latestReview);
    assert.ok(latest.artifactPath?.endsWith("/review-1.md"));
    assert.equal(
      (await f.runner.status()).latestReview?.findings[0]?.id,
      "R1-F1"
    );
    assert.deepEqual(
      await readFile(path.join(f.repository.root, planningArtifact)),
      before
    );
  } finally {
    await f.repository.dispose();
  }
});

test("external drift is checked after review, publication and analysis before consumption", async (t) => {
  for (const point of [
    "before_publish",
    "before_restore",
    "before_triage",
    "analysis_before_attempt"
  ] as const)
    await t.test(point, async () => {
      const f = await fixture(point === "before_restore" ? 0 : 1);
      try {
        const file = path.join(
          f.repository.root,
          requiredFixture(f.requested.planningReview?.active?.scope[0]).path
        );
        const writeState = f.runner.store.writeState.bind(f.runner.store);
        let changed = false;
        f.runner.store.writeState = async (state) => {
          const e = state.planningReview?.active;
          const completed =
            state.activeAttempt !== null &&
            state.metrics.completedAttemptIds.includes(state.activeAttempt.id);
          const boundary =
            point === "before_publish"
              ? state.activeAttempt?.kind === "planning_review" &&
                completed &&
                e?.artifact === null
              : point === "before_triage"
                ? state.activeAttempt?.kind === "planning_analysis" && completed
                : point === "before_restore"
                  ? e?.artifact !== null &&
                    e?.step === "reviewing" &&
                    state.activeAttempt === null
                  : e?.step === "analyzing" && state.activeAttempt === null;
          if (!changed && boundary) {
            changed = true;
            await writeFile(file, "External reviewed-byte change.\n");
          }
          await writeState(state);
        };
        const blocked = await f.runner.resume();
        assert.ok(changed, point);
        assert.equal(blocked.status, "blocked", blocked.blockReason ?? "");
        assert.equal(blocked.planningReview?.closed.at(-1)?.outcome, "stale");
        assert.equal(blocked.pendingHumanDecision, null);
        const eventBytes = (await bytes(f.runner))[1] ?? "";
        assert.ok(
          eventBytes.includes(
            `"point":${JSON.stringify(point === "analysis_before_attempt" ? "before_attempt" : point)}`
          )
        );
        assert.equal(f.adapters.phasePrompts.length, 1);
        assert.equal(
          f.adapters.planningRequests.length,
          point === "before_triage" ? 2 : 1
        );
      } finally {
        await f.repository.dispose();
      }
    });
});

test("triage-answer and first-apply drift close the episode without an applying model call", async (t) => {
  for (const point of ["triage_answer", "before_apply"] as const)
    await t.test(point, async () => {
      const f = await fixture(1);
      try {
        const pending = await f.runner.resume();
        const value = answer(pending);
        value.additionalInstruction = "Apply the selected revision.";
        if (point === "before_apply")
          await f.runner.answerPlanningReview({
            answer: value,
            decidedBy: "owner",
            autoResume: false
          });
        await writeFile(
          path.join(
            f.repository.root,
            requiredFixture(f.requested.planningReview?.active?.scope[0]).path
          ),
          "External change before application.\n"
        );
        const blocked =
          point === "triage_answer"
            ? await f.runner.answerPlanningReview({
                answer: value,
                decidedBy: "owner"
              })
            : await f.runner.resume();
        assert.equal(blocked.status, "blocked", blocked.blockReason ?? "");
        assert.ok(
          ((await bytes(f.runner))[1] ?? "").includes(
            `"point":${JSON.stringify(point)}`
          )
        );
        assert.equal(blocked.planningReview?.closed.at(-1)?.outcome, "stale");
        assert.equal(f.adapters.phasePrompts.length, 1);
        assert.equal(
          blocked.humanDecisions?.filter(
            (r) => r.kind === "planning_review_triage"
          ).length,
          point === "before_apply" ? 1 : 0
        );
      } finally {
        await f.repository.dispose();
      }
    });
});

test("read-only episode steps and awaiting triage never dispatch an ordinary plan attempt", async () => {
  const f = await fixture(1);
  try {
    f.adapters.onPlanning = async () => {
      const records = await f.runner.store.readRunAttempts(f.requested.runId);
      assert.equal(records.filter((r) => r.attempt.kind === "plan").length, 1);
    };
    const pending = await f.runner.resume();
    const calls = f.adapters.planningRequests.length;
    assert.equal((await f.runner.resume()).status, "needs_human_decision");
    assert.equal(f.adapters.planningRequests.length, calls);
    assert.equal(f.adapters.phasePrompts.length, 1);
    const before = await bytes(f.runner);
    await assert.rejects(
      f.runner.answerHumanDecision({
        answers: ["Bypass triage"],
        decidedBy: "owner"
      }),
      (error: unknown) =>
        error instanceof BanzaiError &&
        error.code === "INVALID_DECISION" &&
        error.message ===
          "Planning-review triage requires a keyed planning-review answer."
    );
    assert.deepEqual(await bytes(f.runner), before);
    assert.equal(pending.pendingHumanDecision?.kind, "planning_review_triage");
  } finally {
    await f.repository.dispose();
  }
});

test("applying escalation continues ordinary planning after reviewed documents change", async () => {
  const f = await fixture(1);
  try {
    const pending = await f.runner.resume();
    const value = answer(pending);
    value.additionalInstruction = "Apply the selected revision.";
    f.adapters.planResults.push(
      phaseResult("plan", {
        gate: "escalation",
        questions: ["Confirm the revision detail."]
      })
    );
    const escalated = await f.runner.answerPlanningReview({
      answer: value,
      decidedBy: "owner"
    });
    assert.equal(
      escalated.status,
      "needs_human_decision",
      escalated.blockReason ?? ""
    );
    assert.equal(escalated.planningReview?.active?.step, "applying");
    assert.ok(escalated.planningReview.active.applyingAttemptId);
    await writeFile(
      path.join(
        f.repository.root,
        requiredFixture(f.requested.planningReview?.active?.scope[0]).path
      ),
      "The applying revision changed this document.\n"
    );
    const restored = await f.runner.answerHumanDecision({
      answers: ["Confirmed."],
      decidedBy: "owner"
    });
    assert.equal(
      restored.status,
      "needs_plan_approval",
      restored.blockReason ?? ""
    );
    assert.equal(restored.planningReview?.closed.at(-1)?.outcome, "applied");
    assert.equal(f.adapters.phasePrompts.length, 3);
  } finally {
    await f.repository.dispose();
  }
});

test("zero findings restores the exact gate without analysis or code-review continuity", async () => {
  const f = await fixture();
  try {
    const state = await f.runner.resume();
    assert.equal(state.status, "needs_plan_approval", state.blockReason ?? "");
    const closed = requiredFixture(state.planningReview?.closed[0]);
    assert.equal(closed.outcome, "restored_no_findings");
    assert.equal(state.planApproval, null);
    assert.equal(state.reviewIteration, 0);
    assert.equal(state.latestReview, null);
    assert.equal(state.sessions.reviewer, null);
    assert.equal(state.metrics.attempts.planning_review, 1);
    assert.equal(state.metrics.attempts.planning_analysis, undefined);
    const text = await readFile(
      path.join(f.repository.root, requiredFixture(closed.artifact).path),
      "utf8"
    );
    assert.match(text, /banzai-planning-review\/v1/);
    assert.match(text, /Independent review found no issues/);
    assert.ok(!text.includes(f.repository.root));
    assert.ok(!text.includes(state.runId));
    assert.deepEqual(state.planArtifacts, f.gate.planArtifacts);
    const records = await f.runner.store.readRunAttempts(state.runId);
    assert.equal(
      records.filter((r) => r.attempt.kind === "planning_review").length,
      1
    );
    assert.ok(
      path
        .basename(
          f.runner.store.attemptPath(
            state.runId,
            requiredFixture(
              records.find((r) => r.attempt.kind === "planning_review")
            ).attempt
          )
        )
        .endsWith("-planning-review.json")
    );
  } finally {
    await rm(f.repository.root, { recursive: true, force: true });
  }
});
test("three findings apply only the exact option, instruction and declined dispositions", async () => {
  const f = await fixture(3);
  try {
    const triage = await f.runner.resume();
    assert.equal(
      triage.status,
      "needs_human_decision",
      triage.blockReason ?? ""
    );
    const pending = triage.pendingHumanDecision;
    if (pending?.kind !== "planning_review_triage")
      throw new Error("Missing triage");
    const value = answer(triage);
    value.dispositions = [
      {
        findingId: "P1-F1",
        kind: "option",
        optionId: requiredFixture(pending.analysis[0]?.options[0]).optionId,
        instruction: null
      },
      {
        findingId: "P1-F2",
        kind: "instruction",
        optionId: null,
        instruction: "Owner instruction canary"
      },
      { findingId: "P1-F3", kind: "decline", optionId: null, instruction: null }
    ];
    const expectedDispositions = structuredClone(value.dispositions);
    const state = await f.runner.answerPlanningReview({
      answer: value,
      decidedBy: "owner"
    });
    assert.equal(state.status, "needs_plan_approval", state.blockReason ?? "");
    assert.equal(state.planApproval, null);
    assert.equal(state.planningReview?.closed[0]?.outcome, "applied");
    const record = state.humanDecisions?.at(-1);
    assert.equal(record?.kind, "planning_review_triage");
    assert.deepEqual(record.dispositions, expectedDispositions);
    assert.ok(
      requiredFixture(f.adapters.phasePrompts.at(-1)).includes(
        JSON.stringify(
          {
            artifactPath: pending.artifactPath,
            analysis: planningReviewAnalysis(f.result),
            decision: record
          },
          null,
          2
        )
      )
    );
    assert.match(
      requiredFixture(f.adapters.phasePrompts.at(-1)),
      /Owner instruction canary/
    );
    assert.match(
      requiredFixture(f.adapters.phasePrompts.at(-1)),
      /"kind": "decline"/
    );
    assert.equal(
      f.adapters.phaseResumeSessionIds.at(-1),
      requiredFixture(f.adapters.planningRequests.at(-1)).resumeSessionId ??
        "planning-analysis-session"
    );
    const events = await readFile(
      path.join(f.runner.store.runDirectory(state.runId), "events.jsonl"),
      "utf8"
    );
    assert.doesNotMatch(
      events,
      /Owner instruction canary|Example finding|Recommended option/
    );
    assert.equal(state.reviewIteration, 0);
  } finally {
    await rm(f.repository.root, { recursive: true, force: true });
  }
});
test("all-declined triage restores without another model call and replay is atomic", async () => {
  const f = await fixture(2);
  try {
    const triage = await f.runner.resume();
    const value = answer(triage);
    const calls = f.adapters.phasePrompts.length;
    const state = await f.runner.answerPlanningReview({
      answer: value,
      decidedBy: "owner"
    });
    assert.equal(state.status, "needs_plan_approval", state.blockReason ?? "");
    assert.equal(
      state.planningReview?.closed[0]?.outcome,
      "restored_no_action"
    );
    assert.equal(f.adapters.phasePrompts.length, calls);
    const before = await bytes(f.runner);
    await assert.rejects(
      f.runner.answerPlanningReview({ answer: value, decidedBy: "owner" })
    );
    assert.deepEqual(await bytes(f.runner), before);
  } finally {
    await rm(f.repository.root, { recursive: true, force: true });
  }
});
test("stale reviewed bytes block before a model and retry uses a new number", async () => {
  const f = await fixture();
  try {
    const e = requiredFixture(f.requested.planningReview?.active);
    const file = path.join(f.repository.root, requiredFixture(e.scope[0]).path);
    await writeFile(file, "Changed reviewed bytes\n");
    const blocked = await f.runner.resume();
    assert.equal(
      blocked.blockReason,
      "Planning review is stale: reviewed artifacts changed."
    );
    assert.equal(f.adapters.planningRequests.length, 0);
    const fresh = await f.runner.retry();
    assert.equal(fresh.status, "blocked");
    assert.equal(fresh.planningReview?.active?.reviewNumber, 2);
    assert.equal(fresh.planningReview.closed[0]?.outcome, "stale");
  } finally {
    await rm(f.repository.root, { recursive: true, force: true });
  }
});
test("deleted and symlinked members fail the contained stale restart", async (t) => {
  for (const mode of ["deleted", "symlink"])
    await t.test(mode, async () => {
      const f = await fixture();
      try {
        const e = requiredFixture(f.requested.planningReview?.active);
        const p = requiredFixture(e.scope[0]).path;
        await unlink(path.join(f.repository.root, p));
        if (mode === "symlink")
          await symlink("plan.md", path.join(f.repository.root, p));
        await f.runner.resume();
        const blocked = await f.runner.retry();
        assert.equal(
          blocked.blockReason,
          `Planning review cannot restart: ${p} is missing or not a regular file.`
        );
        assert.equal(blocked.planningReview?.active, null);
        assert.equal(f.adapters.planningRequests.length, 0);
      } finally {
        await rm(f.repository.root, { recursive: true, force: true });
      }
    });
});
test("invalid triage identities and dispositions leave state and events unchanged", async () => {
  const f = await fixture(2);
  try {
    const state = await f.runner.resume();
    const good = answer(state);
    const before = await bytes(f.runner);
    for (const value of [
      { ...good, analysisDigest: "f".repeat(64) },
      { ...good, episodeId: "planning-episode-aaaaaaaa" },
      { ...good, dispositions: good.dispositions.slice(1) },
      {
        ...good,
        dispositions: [
          requiredFixture(good.dispositions[0]),
          requiredFixture(good.dispositions[0])
        ]
      }
    ]) {
      await assert.rejects(
        f.runner.answerPlanningReview({ answer: value, decidedBy: "owner" })
      );
      assert.deepEqual(await bytes(f.runner), before);
    }
  } finally {
    await rm(f.repository.root, { recursive: true, force: true });
  }
});
test("plan rework preserves feedback as inert planning evidence", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new FakeAdapters();
    const runner = new WorkflowRunner(repository.root, adapters);
    await runner.start({ slug: "example", request: "Plan the example." });
    const before = await bytes(runner);
    const calls = adapters.phasePrompts.length;
    for (const feedback of ["", "\r", "\u200e", "a".repeat(8001)]) {
      await assert.rejects(runner.reworkPlan({ feedback, decidedBy: "owner" }));
      assert.deepEqual(await bytes(runner), before);
    }
    await assert.rejects(
      runner.reworkPlan({
        feedback: "Valid feedback",
        decidedBy: "owner\nforged label"
      })
    );
    assert.deepEqual(await bytes(runner), before);
    assert.equal(adapters.phasePrompts.length, calls);
    const revised = await runner.reworkPlan({
      feedback: "Exact owner feedback canary",
      decidedBy: "owner"
    });
    assert.equal(revised.status, "needs_plan_approval");
    assert.equal(revised.planApproval, null);
    assert.match(
      requiredFixture(adapters.phasePrompts.at(-1)),
      /Exact owner feedback canary/
    );
    const events = requiredFixture((await bytes(runner))[1]);
    assert.doesNotMatch(events, /Exact owner feedback canary/);
  } finally {
    await rm(repository.root, { recursive: true, force: true });
  }
});
test("successive rework prompts retain all earlier ADR feedback and human answers without approval", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new FakeAdapters();
    adapters.planResults.push(
      phaseResult("plan", {
        gate: "escalation",
        questions: ["Earlier decision?"]
      }),
      phaseResult("plan", { gate: "adr_approval" })
    );
    const runner = new WorkflowRunner(repository.root, adapters);
    const initial = await runner.start({
      slug: "example",
      request: "Plan the example."
    });
    assert.equal(initial.status, "needs_human_decision");
    const adrGate = await runner.answerHumanDecision({
      answers: ["EARLIER_ANSWER_CANARY"],
      decidedBy: "owner"
    });
    assert.equal(adrGate.status, "needs_adr_approval");
    const planGate = await runner.decideAdr({
      id: "ADR-0001",
      decision: "rework",
      note: "EARLIER_ADR_FEEDBACK_CANARY",
      decidedBy: "owner",
      autoResume: true
    });
    assert.equal(planGate.status, "needs_plan_approval");
    await runner.reworkPlan({
      feedback: "EARLIER_PLAN_FEEDBACK_CANARY",
      decidedBy: "owner"
    });
    const revised = await runner.reworkPlan({
      feedback: "CURRENT_PLAN_FEEDBACK_CANARY",
      decidedBy: "owner"
    });
    assert.equal(revised.status, "needs_plan_approval");
    assert.equal(revised.planApproval, null);
    const prompt = requiredFixture(adapters.phasePrompts.at(-1));
    for (const value of [
      "EARLIER_ANSWER_CANARY",
      "EARLIER_ADR_FEEDBACK_CANARY",
      "EARLIER_PLAN_FEEDBACK_CANARY",
      "CURRENT_PLAN_FEEDBACK_CANARY"
    ])
      assert.ok(prompt.includes(value), value);
    assert.equal(adapters.planningRequests.length, 0);
    assert.ok(
      !revised.adrDecisions.some((decision) => decision.decision === "accept")
    );
    const events = requiredFixture((await bytes(runner))[1]);
    assert.doesNotMatch(
      events,
      /EARLIER_(?:ANSWER|ADR_FEEDBACK|PLAN_FEEDBACK)_CANARY|CURRENT_PLAN_FEEDBACK_CANARY/
    );
  } finally {
    await repository.dispose();
  }
});
test("scope is an exact unique gate subset and numbering includes existing files", async () => {
  const f = await fixture();
  try {
    const state = f.requested;
    state.planningReview = { active: null, closed: [] };
    state.status = "needs_plan_approval";
    await f.runner.store.writeState(state);
    const before = await bytes(f.runner);
    for (const paths of [
      [],
      ["/tmp/no"],
      ["documentation/work/example/../example/plan.md"],
      [
        "documentation/work/example/plan.md",
        "documentation/work/example/plan.md"
      ]
    ]) {
      await assert.rejects(
        f.runner.requestPlanningReview({
          paths,
          decidedBy: "owner",
          autoResume: false
        })
      );
      assert.deepEqual(await bytes(f.runner), before);
    }
    await writeFile(
      path.join(
        f.repository.root,
        "documentation/work/example/planning-review-7.md"
      ),
      "Existing review\n"
    );
    const requested = await f.runner.requestPlanningReview({
      paths: ["documentation/work/example/plan.md"],
      decidedBy: "owner",
      autoResume: false
    });
    assert.equal(requested.planningReview?.active?.reviewNumber, 8);
    assert.equal(requested.planningReview.active.scope.length, 1);
  } finally {
    await rm(f.repository.root, { recursive: true, force: true });
  }
});
test("control gate document records plan rework through the real runner", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new FakeAdapters();
    const runner = new WorkflowRunner(repository.root, adapters);
    const gate = await runner.start({
      slug: "example",
      request: "Plan the example."
    });
    const doc = {
      schema: "banzai-agent-gate-decision/v1",
      schemaVersion: 1,
      runId: gate.runId,
      gate: "plan_approval",
      decision: "rework",
      adrId: null,
      feedback: "Document feedback",
      paths: null
    };
    await executeAgentControlCommand(
      { command: "decide", decidedBy: "owner", autoResume: false },
      () => runner,
      {
        stdin: (async function* () {
          yield Buffer.from(JSON.stringify(doc));
        })(),
        stdout: () => {}
      },
      "owner"
    );
    assert.equal((await runner.status()).state.status, "planning");
    assert.equal(
      (await runner.status()).state.humanDecisions?.at(-1)?.kind,
      "plan_rework"
    );
  } finally {
    await rm(repository.root, { recursive: true, force: true });
  }
});
test("control all-declined document restores through the real runner and human-time journey is unambiguous", async () => {
  const f = await fixture(1);
  try {
    const triage = await f.runner.resume();
    const doc = {
      schema: "banzai-agent-answer/v4",
      schemaVersion: 4,
      ...answer(triage)
    };
    const count = f.adapters.planningRequests.length;
    await executeAgentControlCommand(
      { command: "answer", decidedBy: "owner", autoResume: true },
      () => f.runner,
      {
        stdin: (async function* () {
          yield Buffer.from(JSON.stringify(doc));
        })(),
        stdout: () => {}
      },
      "owner"
    );
    assert.equal((await f.runner.status()).state.status, "needs_plan_approval");
    assert.equal(f.adapters.planningRequests.length, count);
    const evidence = await new HumanTimeStore(f.repository.root).readEvidence(
      triage.runId
    );
    assert.deepEqual(evidence.issues, []);
    assert.ok(
      evidence.observations.some((o) => o.kind === "planning_review_triage")
    );
  } finally {
    await rm(f.repository.root, { recursive: true, force: true });
  }
});

test("scope enforcement rejects writes by either read-only planning kind", async (t) => {
  for (const kind of [
    "planning-review-result/v1",
    "planning-review-analysis/v1"
  ] as const)
    await t.test(kind, async () => {
      const f = await fixture(1);
      try {
        f.adapters.onPlanning = async (request) => {
          if (request.outputContract.identity === kind)
            await writeFile(
              path.join(f.repository.root, "unauthorized-source.txt"),
              "Unauthorized write\n"
            );
        };
        const blocked = await f.runner.resume();
        assert.equal(blocked.status, "blocked");
        const record = await f.runner.store.readRunAttempt(
          blocked.runId,
          requiredFixture(blocked.activeAttempt)
        );
        assert.equal(record.failureCode, "ARTIFACT_PHASE_SCOPE_INVALID");
        assert.equal((await f.runner.status()).retry.eligible, true);
      } finally {
        await rm(f.repository.root, { recursive: true, force: true });
      }
    });
});
test("cancel at planning triage closes the episode and preserves its origin gate", async () => {
  const f = await fixture(1);
  try {
    const triage = await f.runner.resume();
    const cancelled = await f.runner.cancel();
    assert.equal(cancelled.state?.status, "cancelled");
    assert.equal(cancelled.state.pendingHumanDecision, null);
    assert.equal(cancelled.state.planningReview?.active, null);
    assert.equal(
      cancelled.state.planningReview.closed[0]?.outcome,
      "cancelled"
    );
    assert.equal(
      (await f.runner.store.readState(triage.runId)).status,
      "cancelled"
    );
  } finally {
    await rm(f.repository.root, { recursive: true, force: true });
  }
});
test("published-review resume reconstructs one event without rerunning a model", async () => {
  const f = await fixture();
  try {
    const restored = await f.runner.resume();
    const closed = requiredFixture(restored.planningReview?.closed[0]);
    const { outcome: _outcome, closedAt: _closedAt, ...base } = closed;
    void _outcome;
    void _closedAt;
    restored.status = "planning";
    restored.planningReview = {
      active: { ...base, step: "reviewing" },
      closed: []
    };
    await f.runner.store.writeState(restored);
    const count = f.adapters.planningRequests.length;
    const again = await f.runner.resume();
    assert.equal(again.status, "needs_plan_approval");
    assert.equal(f.adapters.planningRequests.length, count);
    const events = await readFile(
      path.join(f.runner.store.runDirectory(again.runId), "events.jsonl"),
      "utf8"
    );
    assert.equal(
      events
        .split("\n")
        .filter((line) => line.includes('"type":"planning_review.published"'))
        .length,
      1
    );
  } finally {
    await rm(f.repository.root, { recursive: true, force: true });
  }
});

test("failed analysis retries its compatible early session and rebinds the planner", async () => {
  const f = await fixture(1);
  try {
    const configPath = path.join(f.repository.root, ".banzai/config.json");
    const config = JSON.parse(await readFile(configPath, "utf8")) as {
      models: { planner: { model: string } };
    };
    config.models.planner.model = "new-analysis-model";
    await writeFile(configPath, JSON.stringify(config));
    f.adapters.planningAnalysisErrors.push(
      new Error("Interrupted analysis after session announcement")
    );
    const blocked = await f.runner.resume();
    assert.equal(blocked.status, "blocked");
    const record = await f.runner.store.readRunAttempt(
      blocked.runId,
      requiredFixture(blocked.activeAttempt)
    );
    assert.equal(record.attempt.kind, "planning_analysis");
    assert.equal(record.sessionId, "planning-analysis-session");
    f.adapters.planningAnalysisResults.push(planningReviewAnalysis(f.result));
    const triage = await f.runner.retry();
    assert.equal(
      triage.status,
      "needs_human_decision",
      triage.blockReason ?? ""
    );
    assert.equal(
      f.adapters.planningRequests.at(-1)?.resumeSessionId,
      "planning-analysis-session"
    );
    assert.equal(triage.sessions.planner?.id, "planning-analysis-session");
    assert.equal(triage.planningReview?.active?.reviewNumber, 1);
  } finally {
    await rm(f.repository.root, { recursive: true, force: true });
  }
});
test("failed reviewer retries with current settings and published bytes retain those settings", async () => {
  const f = await fixture();
  try {
    f.adapters.onPlanning = async () => {
      throw new Error("Reviewer transport failure");
    };
    const blocked = await f.runner.resume();
    assert.equal(blocked.status, "blocked");
    const configPath = path.join(f.repository.root, ".banzai/config.json");
    const config = JSON.parse(await readFile(configPath, "utf8")) as {
      models: { reviewer: { model: string } };
    };
    config.models.reviewer.model = "new-reviewer-model";
    await writeFile(configPath, JSON.stringify(config));
    f.adapters.onPlanning = null;
    const restored = await f.runner.retry();
    assert.equal(
      restored.status,
      "needs_plan_approval",
      restored.blockReason ?? ""
    );
    const closed = requiredFixture(restored.planningReview?.closed[0]);
    assert.equal(closed.reviewer?.model, "new-reviewer-model");
    assert.equal(f.adapters.planningRequests.at(-1)?.resumeSessionId, null);
    const artifact = requiredFixture(closed.artifact);
    assert.match(
      await readFile(path.join(f.repository.root, artifact.path), "utf8"),
      /new-reviewer-model/
    );
  } finally {
    await rm(f.repository.root, { recursive: true, force: true });
  }
});

test("v10 persisted validation rejects missing fields, unknown kinds and episode identity conflicts", async () => {
  const f = await fixture();
  try {
    const { validatePlanningReviewState } =
      await import("../src/planning-review-state.js");
    validatePlanningReviewState(f.requested);
    const missing = structuredClone(f.requested);
    delete missing.planningReview;
    assert.throws(() => {
      validatePlanningReviewState(missing);
    });
    const historical = { ...f.requested, schemaVersion: 9 as const };
    assert.throws(() => {
      validatePlanningReviewState(historical);
    });
    delete historical.planningReview;
    validatePlanningReviewState(historical);
    const unknown = structuredClone(f.requested);
    Object.assign(unknown, {
      humanDecisions: [
        {
          kind: "unknown",
          decidedBy: "owner",
          decidedAt: "2026-10-14T00:00:00.000Z"
        }
      ]
    });
    assert.throws(() => {
      validatePlanningReviewState(unknown);
    });
    const duplicate = structuredClone(f.requested);
    const pr = requiredFixture(duplicate.planningReview);
    const active = requiredFixture(pr.active);
    const { step, ...base } = active;
    void step;
    pr.closed.push({
      ...base,
      outcome: "stale",
      closedAt: "2026-10-14T00:00:00.000Z"
    });
    assert.throws(() => {
      validatePlanningReviewState(duplicate);
    });
    const writing = structuredClone(f.requested);
    Object.assign(writing, {
      activeAttempt: {
        id: "planning-review-1-12345678",
        kind: "planning_review",
        mutable: true
      }
    });
    assert.throws(() => {
      validatePlanningReviewState(writing);
    });
  } finally {
    await rm(f.repository.root, { recursive: true, force: true });
  }
});
