import { spawn } from "node:child_process";
import { once } from "node:events";
import assert from "node:assert/strict";
import { readFile, rm, writeFile, appendFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  CANCELLATION_REASONS,
  captureCancellationContext,
  decodeCancellationResponse,
  resolveCancellation
} from "../src/cancellation.js";
import {
  CANCELLATION_LIMITS,
  decodeCancellationEvents,
  readCancellationFile
} from "../src/cancellation-evidence.js";
import {
  parseCancellationArgs,
  cancellationCapabilities
} from "../src/cancellation-cli.js";
import { TerminalRunStateError } from "../src/errors.js";
import { WorkflowRunner } from "../src/workflow.js";
import type { RunState, VendorAdapters } from "../src/types.js";
import { CONTRACT_VERSION } from "../src/types.js";
import { planningRestoreState } from "./planning-review-fixtures.js";

test("planning cancellation keeps the origin gate and marks both new kinds and triage unsupported", () => {
  for (const gate of ["plan_approval", "adr_approval"] as const) {
    const state = planningRestoreState();
    const pending = state.pendingHumanDecision;
    assert.ok(pending?.kind === "planning_review_triage");
    pending.originGate = gate;
    const context = captureCancellationContext(state);
    assert.equal(context.gate.value, gate);
    assert.equal(context.gate.availability, "available");
    assert.equal(context.decision.availability, "unsupported");
  }
  for (const kind of ["planning_review", "planning_analysis"] as const) {
    const state = planningRestoreState();
    state.status = "planning";
    state.pendingHumanDecision = null;
    state.activeAttempt = { id: `${kind}-1`, kind, mutable: false };
    assert.equal(
      captureCancellationContext(state).attempt.availability,
      "unsupported"
    );
  }
});
import {
  evaluationAttemptFixture,
  evaluationStateFixture,
  snapshotTree,
  createTestRepository
} from "./helpers.js";

async function fixture(status: RunState["status"] = "planning") {
  const { root } = await createTestRepository({ artifactLayout: null });
  const boundaries: string[] = [];
  const runner = new WorkflowRunner(
    root,
    {} as VendorAdapters,
    undefined,
    undefined,
    async (boundary) => {
      boundaries.push(boundary.kind);
    }
  );
  const state = evaluationStateFixture({
    schemaVersion: 3,
    status,
    extra: {
      contractVersion: CONTRACT_VERSION,
      runId: "run-a",
      repoRoot: root,
      pendingHumanDecision: null,
      humanDecisions: [],
      adrDecisions: [],
      planApproval: null,
      planArtifacts: null,
      sessions: { planner: null, implementer: null, reviewer: null },
      baseCommit: "a".repeat(40),
      blockReason: null
    }
  }) as unknown as RunState;
  await runner.store.createRun(state);
  return {
    root,
    runner,
    state,
    boundaries,
    dispose: async () => rm(root, { recursive: true, force: true })
  };
}
async function observation(runner: WorkflowRunner, runId = "run-a") {
  const state = await runner.store.readState(runId);
  const input = decodeCancellationEvents(
    await readCancellationFile(
      runner.repoRoot,
      `.banzai/runs/${runId}/events.jsonl`,
      CANCELLATION_LIMITS.events
    )
  );
  return {
    state,
    events: input.events,
    resolved: resolveCancellation(
      state,
      runId,
      input.events,
      input.availability
    )
  };
}

test("cancellation: all reasons and provenance are closed; CLI validates before mutation", async () => {
  for (const reason of CANCELLATION_REASONS) {
    assert.deepEqual(
      parseCancellationArgs(["--reason", reason, "--run", "run-a"]),
      { reason, expectedRunId: "run-a" }
    );
    const f = await fixture();
    try {
      const result = await f.runner.cancel({ reason });
      assert.equal(result.outcome, "cancelled");
      const { resolved } = await observation(f.runner);
      assert.equal(resolved.response?.reason, reason);
      assert.equal(resolved.response.provenance, "operator_reported");
    } finally {
      await f.dispose();
    }
  }
  assert.deepEqual(parseCancellationArgs([]), {});
  assert.equal(parseCancellationArgs(["--help"]), "help");
  for (const args of [
    ["--reason", "SECRET"],
    ["--reason"],
    ["--reason", "other", "--reason", "other"],
    ["--run"],
    ["--run", "../bad"],
    ["--help", "--reason", "other"],
    ["--unknown"],
    ["other"]
  ]) {
    assert.throws(
      () => parseCancellationArgs(args),
      (error) => error instanceof Error && !error.message.includes("SECRET")
    );
  }
  assert.throws(() =>
    decodeCancellationResponse({
      state: "skipped",
      reason: "other",
      provenance: "operator_skipped",
      channel: "interactive",
      recordedAt: "2026-09-06T12:00:00.000Z"
    })
  );
  assert.deepEqual(cancellationCapabilities().reasons, CANCELLATION_REASONS);
});

test("cancellation: pre-state and selected workflow survive transition without inferring motivation", async () => {
  const f = await fixture("blocked");
  try {
    f.state.blockedFrom = "planning";
    f.state.activeAttempt = { id: "attempt-a", kind: "plan", mutable: false };
    f.state.blockReason = "A vendor failed; an ADR was rejected";
    const failed = evaluationAttemptFixture({
      id: "attempt-a",
      kind: "plan",
      status: "failed"
    });
    failed.failureCause = "timeout";
    failed.failureCode = "PROCESS_TIMEOUT";
    await writeFile(
      path.join(
        f.runner.store.runDirectory("run-a"),
        "attempts",
        "attempt-a-plan.json"
      ),
      JSON.stringify(failed)
    );
    await f.runner.store.writeState(f.state);
    const result = await f.runner.cancel();
    assert.equal(result.outcome, "cancelled");
    const { state, resolved } = await observation(f.runner);
    assert.equal(state.blockedFrom, null);
    assert.equal(resolved.observation?.context.blockedFrom.value, "planning");
    assert.equal(resolved.observation.context.status.value, "blocked");
    assert.equal(
      resolved.observation.context.gate.availability,
      "not_applicable"
    );
    assert.equal(resolved.observation.context.workflow.value, "strict");
    assert.equal(resolved.response?.reason, "unspecified");
    assert.equal(resolved.response.provenance, "cli_omitted");
    assert.deepEqual(f.boundaries, ["run_cancelled"]);
    assert.ok(
      !JSON.stringify(resolved.observation).includes(f.state.blockReason)
    );
    const legacy = { ...f.state };
    delete legacy.workflowSelection;
    assert.equal(
      captureCancellationContext(legacy).workflow.availability,
      "legacy_absent"
    );
    assert.equal(
      captureCancellationContext({ ...legacy, workflowSelection: null })
        .workflow.value,
      "unselected"
    );
  } finally {
    await f.dispose();
  }
});

test("cancellation: concurrent and repeated requests own one immutable transition", async () => {
  const f = await fixture();
  try {
    const outcomes = await Promise.all([
      f.runner.cancel({ reason: "other" }),
      f.runner.cancel({ reason: "plan_unsuitable" })
    ]);
    assert.equal(outcomes.filter((o) => o.outcome === "cancelled").length, 1);
    assert.equal(
      outcomes.filter((o) => o.outcome === "already_cancelled").length,
      1
    );
    const before = await snapshotTree(f.root);
    const original = await observation(f.runner);
    assert.equal(
      (await f.runner.cancel({ reason: "superseded" })).outcome,
      "already_cancelled"
    );
    assert.deepEqual(await snapshotTree(f.root), before);
    assert.equal(
      original.events.filter((e) => e.type === "run.cancelled").length,
      1
    );
    assert.deepEqual(f.boundaries, ["run_cancelled"]);
    const staleDone = { ...f.state, status: "done" as const };
    await assert.rejects(
      f.runner.store.writeState(staleDone),
      TerminalRunStateError
    );
    assert.equal((await f.runner.store.readState("run-a")).status, "cancelled");
  } finally {
    await f.dispose();
  }
});

test("cancellation: done-versus-cancel has one winner and a done run gets no observation", async () => {
  for (let i = 0; i < 3; i++) {
    const f = await fixture();
    try {
      const results = await Promise.allSettled([
        f.runner.store.writeState({ ...f.state, status: "done" }),
        f.runner.cancel()
      ]);
      const current = await observation(f.runner);
      if (current.state.status === "done") {
        assert.equal(current.events.length, 0);
        assert.equal((await f.runner.cancel()).outcome, "already_done");
      } else {
        assert.equal(current.state.status, "cancelled");
        assert.equal(current.events.length, 1);
        assert.equal(results[0].status, "rejected");
      }
    } finally {
      await f.dispose();
    }
  }
});

test("cancellation: first response is receipt-bound, idempotent and survives active-run change", async () => {
  const f = await fixture();
  try {
    const cancelled = await f.runner.cancel({
      channel: "interactive",
      expectedRunId: "run-a"
    });
    assert.ok(cancelled.receipt);
    assert.equal(
      (await observation(f.runner)).resolved.availability,
      "unanswered"
    );
    await f.runner.store.createRun({ ...f.state, runId: "run-b" });
    const b = await readFile(f.runner.store.statePath("run-b"), "utf8");
    const mismatched = await f.runner.cancel({
      expectedRunId: "run-a",
      reason: "other"
    });
    assert.equal(mismatched.outcome, "active_run_changed");
    const [answer, repeat] = await Promise.all([
      f.runner.recordCancellationResponse(cancelled.receipt, {
        state: "reported",
        reason: "superseded"
      }),
      f.runner.recordCancellationResponse(cancelled.receipt, {
        state: "reported",
        reason: "superseded"
      })
    ]);
    assert.equal(answer.outcome, "saved");
    assert.deepEqual(answer, repeat);
    assert.equal(
      (
        await f.runner.recordCancellationResponse(cancelled.receipt, {
          state: "skipped"
        })
      ).outcome,
      "conflict"
    );
    assert.equal(
      (
        await f.runner.recordCancellationResponse(
          { kind: "cancellation-first-response" },
          { state: "skipped" }
        )
      ).outcome,
      "unavailable"
    );
    assert.equal(await readFile(f.runner.store.statePath("run-b"), "utf8"), b);
    const observed = await observation(f.runner);
    assert.equal(
      observed.events.filter((e) => e.type === "run.cancellation_response")
        .length,
      1
    );
    assert.equal(observed.resolved.response?.reason, "superseded");
  } finally {
    await f.dispose();
  }
});

test("cancellation: skipped, interrupted and crashed prompts retain distinct availability", async () => {
  for (const answer of ["skipped", "interrupted", "crash"] as const) {
    const f = await fixture();
    try {
      const result = await f.runner.cancel({ channel: "interactive" });
      assert.ok(result.receipt);
      if (answer !== "crash")
        assert.equal(
          (
            await f.runner.recordCancellationResponse(result.receipt, {
              state: answer
            })
          ).outcome,
          "saved"
        );
      const resolved = (await observation(f.runner)).resolved;
      assert.equal(
        resolved.availability,
        answer === "skipped"
          ? "available"
          : answer === "crash"
            ? "unanswered"
            : "interrupted"
      );
      assert.equal(
        resolved.response?.reason,
        answer === "skipped" ? "unspecified" : null
      );
      const restarted = new WorkflowRunner(f.root, {} as VendorAdapters);
      assert.equal(
        (await restarted.cancel({ channel: "interactive" })).receipt,
        null
      );
      assert.equal(
        (
          await restarted.recordCancellationResponse(result.receipt, {
            state: "skipped"
          })
        ).outcome,
        "unavailable"
      );
    } finally {
      await f.dispose();
    }
  }
});

test("cancellation: analytics failure and partial writes cannot undo cancellation or repair history", async () => {
  for (const mode of ["before", "after", "partial"] as const) {
    const f = await fixture();
    try {
      const append = f.runner.store.appendEvent.bind(f.runner.store);
      f.runner.store.appendEvent = async (...args) => {
        if (args[1] === "run.cancelled") {
          if (mode === "after") await append(...args);
          if (mode === "partial")
            await appendFile(
              path.join(f.runner.store.runDirectory("run-a"), "events.jsonl"),
              '{"type":"run.cancelled"'
            );
          throw new Error("synthetic write failure");
        }
        return await append(...args);
      };
      const result = await f.runner.cancel({ reason: "other" });
      assert.equal(result.outcome, "cancelled");
      assert.equal(
        result.observation,
        mode === "after" ? "available" : "unsaved"
      );
      const before = await snapshotTree(f.root);
      await f.runner.cancel();
      assert.deepEqual(await snapshotTree(f.root), before);
      assert.equal(
        (await observation(f.runner)).resolved.availability,
        mode === "before"
          ? "missing"
          : mode === "partial"
            ? "malformed"
            : "available"
      );
    } finally {
      await f.dispose();
    }
  }
});

test("cancellation: unresolved mutation ownership reports unconfirmed and never reclaims the guard", async () => {
  const f = await fixture();
  try {
    const guard = path.join(
      f.runner.store.runDirectory("run-a"),
      ".state-write.lock"
    );
    await writeFile(guard, "synthetic orphan", { mode: 0o600 });
    const before = await snapshotTree(f.root);
    assert.equal((await f.runner.cancel()).outcome, "unconfirmed");
    assert.deepEqual(await snapshotTree(f.root), before);
    assert.equal((await f.runner.store.readState("run-a")).status, "planning");
  } finally {
    await f.dispose();
  }
});

test("cancellation: cross-process ownership and a hard crash retain the guard without false transition", async () => {
  const f = await fixture();
  const guard = path.join(
    f.runner.store.runDirectory("run-a"),
    ".state-write.lock"
  );
  const child = spawn(
    process.execPath,
    [
      "-e",
      'const fs=require("node:fs");const fd=fs.openSync(process.argv[1],"wx",0o600);fs.writeSync(fd,"child-owner");process.stdout.write("ready");setInterval(()=>{},1000);',
      guard
    ],
    { stdio: ["ignore", "pipe", "pipe"] }
  );
  try {
    await once(child.stdout, "data");
    assert.equal((await f.runner.cancel()).outcome, "unconfirmed");
    const exited = once(child, "exit");
    child.kill("SIGKILL");
    await exited;
    assert.equal((await f.runner.cancel()).outcome, "unconfirmed");
    assert.equal(await readFile(guard, "utf8"), "child-owner");
    assert.equal((await observation(f.runner)).state.status, "planning");
  } finally {
    child.kill("SIGKILL");
    await f.dispose();
  }
});

test("cancellation: ADR rejection stays in planning and is context only when subsequently cancelled", async () => {
  const f = await fixture("needs_adr_approval");
  try {
    const planned = await f.runner.decideAdr({
      id: "ADR-0001",
      decision: "reject",
      note: "FORBIDDEN NOTE",
      decidedBy: "operator",
      autoResume: false
    });
    assert.equal(planned.status, "planning");
    assert.equal((await observation(f.runner)).events.length, 0);
    await f.runner.cancel();
    const { resolved } = await observation(f.runner);
    assert.equal(resolved.response?.reason, "unspecified");
    assert.equal(resolved.observation?.context.decision.value?.kind, "adr");
    assert.equal(
      resolved.observation.context.decision.value.relationship,
      "prior_decision"
    );
    assert.ok(!JSON.stringify(resolved.observation).includes("FORBIDDEN"));
  } finally {
    await f.dispose();
  }
});

test("cancellation: failed first-response writes disclose the saved state without replaying history", async () => {
  for (const mode of ["before", "after", "partial"] as const) {
    const f = await fixture();
    try {
      const result = await f.runner.cancel({ channel: "interactive" });
      assert.ok(result.receipt);
      const append = f.runner.store.appendEvent.bind(f.runner.store);
      f.runner.store.appendEvent = async (...args) => {
        if (args[1] === "run.cancellation_response") {
          if (mode === "after") await append(...args);
          if (mode === "partial")
            await appendFile(
              path.join(f.runner.store.runDirectory("run-a"), "events.jsonl"),
              '{"type":"run.cancellation_response"'
            );
          throw new Error("synthetic response failure");
        }
        return await append(...args);
      };
      const answer = await f.runner.recordCancellationResponse(result.receipt, {
        state: "reported",
        reason: "other"
      });
      assert.equal(answer.outcome, mode === "after" ? "saved" : "unavailable");
      const evidence = await observation(f.runner);
      assert.equal(evidence.state.status, "cancelled");
      assert.equal(
        evidence.resolved.availability,
        mode === "after"
          ? "available"
          : mode === "before"
            ? "unanswered"
            : "malformed"
      );
      assert.deepEqual(f.boundaries, ["run_cancelled"]);
      if (mode === "after") {
        const events = structuredClone(evidence.events);
        const response = events.find(
          (event) => event.type === "run.cancellation_response"
        );
        assert.ok(response);
        response.at = "2000-01-01T00:00:00.000Z";
        assert.equal(
          resolveCancellation(evidence.state, "run-a", events).availability,
          "malformed"
        );
      }
    } finally {
      await f.dispose();
    }
  }
});

test("cancellation: gate capture uses actual pending structures and missing context cannot suppress a reason", async () => {
  const base = {
    workflowSelection: null,
    activeAttempt: null,
    blockedFrom: null
  };
  for (const [status, gate] of [
    ["needs_adr_approval", "adr_approval"],
    ["needs_plan_approval", "plan_approval"],
    ["needs_triage", "triage"]
  ] as const) {
    assert.equal(
      captureCancellationContext({ ...base, status }).gate.value,
      gate
    );
  }
  const consultation = captureCancellationContext({
    ...base,
    status: "needs_human_decision",
    pendingHumanDecision: {
      kind: "decision_consultation",
      request: { requestId: "request-a", roundId: "round-a" }
    }
  });
  assert.equal(consultation.gate.value, "decision_consultation");
  assert.deepEqual(consultation.decision.value, {
    kind: "consultation",
    requestId: "request-a",
    roundId: "round-a",
    relationship: "pending_at_cancel"
  });
  assert.equal(
    captureCancellationContext({
      ...base,
      status: "needs_human_decision",
      pendingHumanDecision: { kind: "escalation" }
    }).gate.value,
    "escalation"
  );
  assert.equal(
    captureCancellationContext({ ...base, status: "needs_human_decision" }).gate
      .availability,
    "missing"
  );
  assert.equal(
    captureCancellationContext({
      ...base,
      status: "needs_human_decision",
      pendingHumanDecision: { kind: "FORBIDDEN" }
    }).gate.availability,
    "malformed"
  );
  const f = await fixture("blocked");
  try {
    f.state.blockedFrom = "done";
    await f.runner.store.writeState(f.state);
    const result = await f.runner.cancel({ reason: "other" });
    assert.equal(result.observation, "available");
    const observed = await observation(f.runner);
    assert.equal(
      observed.resolved.observation?.context.blockedFrom.availability,
      "malformed"
    );
    assert.equal(observed.resolved.response?.reason, "other");
  } finally {
    await f.dispose();
  }
});

test("cancellation: ambiguous state cleanup reports the committed cancellation without inventing analytics", async () => {
  const f = await fixture();
  try {
    const commit = f.runner.store.commitCancellation.bind(f.runner.store);
    f.runner.store.commitCancellation = async (...args) => {
      await commit(...args);
      throw new Error("synthetic post-replace cleanup failure");
    };
    const result = await f.runner.cancel({ reason: "other" });
    assert.equal(result.outcome, "cancelled");
    assert.equal(result.state?.status, "cancelled");
    assert.equal(result.observation, "unsaved");
    const resolved = (await observation(f.runner)).resolved;
    assert.equal(resolved.availability, "missing");
    assert.equal(resolved.response, null);
    assert.deepEqual(f.boundaries, []);
  } finally {
    await f.dispose();
  }
});
