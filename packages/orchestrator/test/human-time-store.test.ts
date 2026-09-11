import { InteractiveHumanTime } from "../src/interactive-human-time.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  symlink,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { HumanTimeStore } from "../src/human-time-store.js";
import { HUMAN_TIME_LIMITS, deriveHumanTime } from "../src/human-time.js";
import type { HumanTimeChange } from "../src/human-time.js";

const runId = "run-example";
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "banzai-human-time-"));
  const directory = path.join(root, ".banzai", "runs", runId);
  await mkdir(path.join(directory, "attempts"), { recursive: true });
  await writeFile(
    path.join(root, ".banzai", "active-run.json"),
    JSON.stringify({ schemaVersion: 1, runId })
  );
  await writeFile(
    path.join(directory, "state.json"),
    JSON.stringify({
      schemaVersion: 3,
      runId,
      status: "needs_triage",
      latestReview: { iteration: 1 }
    })
  );
  await writeFile(
    path.join(directory, "attempts", "review-1-review.json"),
    JSON.stringify({
      schemaVersion: 2,
      attempt: { id: "review-1", kind: "review" },
      status: "completed",
      result: { verdict: "changes_requested", summary: "PRIVATE_CONTENT" }
    })
  );
  const events: {
    runId: string;
    at: string;
    type: string;
    details: Record<string, unknown>;
  }[] = [
    {
      runId,
      at: "2026-09-06T09:00:00.000Z",
      type: "run.created",
      details: { slug: "PRIVATE_CONTENT" }
    },
    {
      runId,
      at: "2026-09-06T10:00:00.000Z",
      type: "review.completed",
      details: {
        attemptId: "review-1",
        iteration: 1,
        verdict: "changes_requested",
        summary: "PRIVATE_CONTENT"
      }
    }
  ];
  await writeFile(
    path.join(directory, "events.jsonl"),
    events.map((e) => JSON.stringify(e) + "\n").join("")
  );
  return { root, directory, events, store: new HumanTimeStore(root) };
}
function change(minutes = 12, replaces: string | null = null): HumanTimeChange {
  return {
    captures: [],
    observations: [],
    issues: [],
    effort: {
      id: randomUUID(),
      replaces,
      minutes,
      recordedAt: "2026-09-06T10:12:00.000Z",
      asOf: "2026-09-06T10:12:00.000Z",
      basis: "estimated",
      scope: "single_engineer_unverified"
    }
  };
}

test("human time: private atomic estimates survive reopening without changing workflow evidence", async () => {
  const f = await fixture();
  try {
    const before = await readFile(path.join(f.directory, "state.json"));
    const first = await f.store.update(runId, 0, change());
    assert.deepEqual(first, { status: "saved", revision: 1 });
    const read = await new HumanTimeStore(f.root).read(runId);
    assert.equal(read.status, "valid");
    assert.equal(read.ledger.effortRevisions[0]?.minutes, 12);
    assert.equal(
      (await stat(path.join(f.directory, "human-time.json"))).mode & 0o777,
      0o600
    );
    assert.ok(
      (await readFile(path.join(f.directory, "state.json"))).equals(before)
    );
    assert.deepEqual(await f.store.update(runId, 0, change(15)), {
      status: "stale",
      issue: "STALE_REVISION"
    });
    assert.equal(
      (
        await f.store.update(
          runId,
          1,
          change(15, read.ledger.effortRevisions[0].id)
        )
      ).status,
      "saved"
    );
    assert.ok(
      !(await readdir(f.directory)).some(
        (name) => name.endsWith(".tmp") || name.endsWith(".lock")
      )
    );
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("human time: concurrent writers and orphan guard cannot silently overwrite an estimate", async () => {
  const f = await fixture();
  try {
    const results = await Promise.all([
      f.store.update(runId, 0, change(12)),
      new HumanTimeStore(f.root).update(runId, 0, change(15))
    ]);
    assert.equal(results.filter((r) => r.status === "saved").length, 1);
    assert.ok(
      results.some((r) => r.status === "stale" || r.status === "contended")
    );
    await writeFile(path.join(f.directory, "human-time.lock"), "orphan", {
      mode: 0o600
    });
    assert.deepEqual(await f.store.update(runId, 1, change()), {
      status: "contended",
      issue: "WRITE_CONTENDED"
    });
    assert.equal(
      await readFile(path.join(f.directory, "human-time.lock"), "utf8"),
      "orphan"
    );
    assert.equal((await f.store.read(runId)).status, "valid");
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("human time: failed atomic replacement preserves prior ledger, cleans owned files and hides raw errors", async () => {
  const f = await fixture();
  class FailingStore extends HumanTimeStore {
    protected override async replaceFile(): Promise<void> {
      throw Error("PRIVATE_CONTENT disk full");
    }
  }
  try {
    const entry = change();
    assert.ok(entry.effort);
    await f.store.update(runId, 0, entry);
    const before = await readFile(path.join(f.directory, "human-time.json"));
    const result = await new FailingStore(f.root).update(
      runId,
      1,
      change(15, entry.effort.id)
    );
    assert.deepEqual(result, { status: "unavailable", issue: "WRITE_FAILED" });
    assert.ok(
      (await readFile(path.join(f.directory, "human-time.json"))).equals(before)
    );
    assert.ok(
      !(await readdir(f.directory)).some(
        (name) => name.endsWith(".tmp") || name.endsWith(".lock")
      )
    );
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("human time: unsafe paths, wrong run bindings and switched active runs do not receive writes", async () => {
  const f = await fixture();
  const external = path.join(f.root, "outside.json");
  try {
    await writeFile(external, "PRIVATE_CONTENT", { mode: 0o600 });
    await symlink(external, path.join(f.directory, "human-time.json"));
    const result = await f.store.update(runId, 0, change());
    assert.deepEqual(result, { status: "unavailable", issue: "UNSAFE_PATH" });
    assert.equal(await readFile(external, "utf8"), "PRIVATE_CONTENT");
    await rm(path.join(f.directory, "human-time.json"));
    await writeFile(
      path.join(f.root, ".banzai", "active-run.json"),
      JSON.stringify({ schemaVersion: 1, runId: "another-run" })
    );
    assert.deepEqual(await f.store.update(runId, 0, change()), {
      status: "stale",
      issue: "STALE_REVISION"
    });
    assert.equal((await f.store.read("../outside")).status, "invalid");
    await writeFile(
      path.join(f.directory, "state.json"),
      JSON.stringify({ schemaVersion: 3, runId: "other-run" })
    );
    assert.equal((await f.store.read(runId)).status, "invalid");
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("human time: canonical triage closes before a following state write, and only bounded metadata leaves the reader", async () => {
  const f = await fixture();
  try {
    const evidence = await f.store.readEvidence(runId);
    assert.deepEqual(evidence.issues, []);
    assert.equal(evidence.pendingKeys.length, 1);
    assert.ok(!JSON.stringify(evidence).includes("PRIVATE_CONTENT"));
    await f.store.update(runId, 0, {
      captures: [],
      observations: evidence.observations,
      effort: null,
      issues: []
    });
    f.events.push({
      runId,
      at: "2026-09-06T10:12:00.000Z",
      type: "review.triaged",
      details: { reviewIteration: 1, decidedBy: "PRIVATE_CONTENT" }
    });
    await writeFile(
      path.join(f.directory, "events.jsonl"),
      f.events.map((e) => JSON.stringify(e) + "\n").join("")
    );
    const closed = await f.store.readEvidence(runId);
    assert.deepEqual(closed.issues, []);
    assert.equal(closed.pendingKeys.length, 0);
    const summary = deriveHumanTime(
      await f.store.read(runId),
      closed,
      "2026-09-06T10:50:00.000Z"
    );
    assert.equal(summary.answeredMs, 12 * 60000);
    assert.equal(summary.effort, null);
    assert.ok(!JSON.stringify(summary).includes("PRIVATE_CONTENT"));
    assert.equal((await f.store.read(runId)).status, "valid");
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("human time: recorder preserves a clock basis across live capture and unverified restart, with read-only summaries", async () => {
  const f = await fixture();
  try {
    let utc = "2026-09-06T10:00:00.000Z";
    let mono = 0;
    const warnings: string[] = [];
    const recorder = new InteractiveHumanTime(
      f.store,
      () => {
        warnings.push("unsaved");
      },
      { utc: () => utc, monotonic: () => mono }
    );
    await recorder.observe({
      kind: "gate_pending",
      runId,
      attemptId: "review-1",
      reviewIteration: 1,
      requestId: null,
      roundId: null,
      eventType: "review.completed",
      eventAt: utc
    });
    utc = "2026-09-06T10:12:00.000Z";
    mono = 12 * 60000;
    f.events.push({
      runId,
      at: utc,
      type: "review.triaged",
      details: { reviewIteration: 1 }
    });
    await writeFile(
      path.join(f.directory, "events.jsonl"),
      f.events.map((e) => JSON.stringify(e) + "\n").join("")
    );
    await recorder.observe({
      kind: "decision_recorded",
      runId,
      attemptId: null,
      reviewIteration: 1,
      requestId: null,
      roundId: null,
      eventType: "review.triaged",
      eventAt: utc
    });
    const summary = await recorder.readSummary(runId);
    assert.equal(summary.answeredMs, 12 * 60000);
    assert.equal(summary.episodes[0]?.continuity, "process_correlated");
    assert.equal(summary.effort, null);
    assert.ok(summary.revision !== null);
    assert.equal(
      (await recorder.setEstimate(runId, summary.revision, 12)).status,
      "saved"
    );
    const bytes = await readFile(path.join(f.directory, "human-time.json"));
    await recorder.readSummary(runId);
    await recorder.readSummary(runId);
    assert.ok(
      (await readFile(path.join(f.directory, "human-time.json"))).equals(bytes)
    );
    // Simulate an interrupted process: no detach, no cross-process monotonic samples.
    const reopened = new InteractiveHumanTime(
      new HumanTimeStore(f.root),
      () => {
        warnings.push("unsaved");
      }
    );
    await reopened.attach(runId);
    const after = await reopened.readSummary(runId);
    assert.equal(after.answeredMs, 12 * 60000);
    assert.equal(after.effort?.minutes, 12);
    assert.ok(after.issues.some((i) => i.code === "CAPTURE_GAP"));
    await reopened.detach();
    assert.deepEqual(warnings, []);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("human time: attaching to a historical terminal run does not backfill its completed gates", async () => {
  const f = await fixture();
  try {
    f.events.push({
      runId,
      at: "2026-09-06T10:12:00.000Z",
      type: "review.triaged",
      details: { reviewIteration: 1 }
    });
    await writeFile(
      path.join(f.directory, "events.jsonl"),
      f.events.map((e) => JSON.stringify(e) + "\n").join("")
    );
    await writeFile(
      path.join(f.directory, "state.json"),
      JSON.stringify({
        schemaVersion: 3,
        runId,
        status: "done",
        latestReview: { iteration: 1 }
      })
    );
    const recorder = new InteractiveHumanTime(f.store, () => {});
    assert.equal((await recorder.readSummary(runId)).answeredMs, null);
    assert.equal((await f.store.read(runId)).status, "absent");
    await recorder.attach(runId);
    const summary = await recorder.readSummary(runId);
    assert.equal(summary.answeredMs, null);
    assert.equal(summary.episodes.length, 0);
    assert.equal(summary.effort, null);
    await recorder.detach();
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("human time: external closure stays unattributed and a live clock jump invalidates elapsed duration", async () => {
  for (const mode of ["external", "jump"] as const) {
    const f = await fixture();
    try {
      let utc = "2026-09-06T10:00:00.000Z";
      let mono = 0;
      const time = new InteractiveHumanTime(f.store, () => {}, {
        utc: () => utc,
        monotonic: () => mono
      });
      await time.observe({
        kind: "gate_pending",
        runId,
        attemptId: "review-1",
        reviewIteration: 1,
        requestId: null,
        roundId: null,
        eventType: "review.completed",
        eventAt: utc
      });
      utc =
        mode === "jump"
          ? "2026-09-06T10:13:00.000Z"
          : "2026-09-06T10:12:00.000Z";
      mono = 12 * 60000;
      f.events.push({
        runId,
        at: utc,
        type: "review.triaged",
        details: { reviewIteration: 1 }
      });
      await writeFile(
        path.join(f.directory, "events.jsonl"),
        f.events.map((e) => JSON.stringify(e) + "\n").join("")
      );
      if (mode === "jump") {
        await time.observe({
          kind: "decision_recorded",
          runId,
          attemptId: null,
          reviewIteration: 1,
          requestId: null,
          roundId: null,
          eventType: "review.triaged",
          eventAt: utc
        });
        const summary = await time.readSummary(runId);
        assert.equal(summary.answeredMs, null);
        assert.equal(summary.episodes[0]?.continuity, "discontinuity");
      } else {
        const reopened = new InteractiveHumanTime(f.store, () => {});
        await reopened.attach(runId);
        const summary = await reopened.readSummary(runId);
        assert.equal(summary.answeredMs, 12 * 60000);
        assert.equal(summary.episodes[0]?.continuity, "unverified");
        const read = await f.store.read(runId);
        assert.equal(read.status, "valid");
        assert.equal(
          read.ledger.observations.find((o) => o.endpoint === "answered")
            ?.channel,
          "unattributed"
        );
        await reopened.detach();
      }
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  }
});

test("human time: contradictory canonical triage responses retain a conflict rather than choosing the later timestamp", async () => {
  const f = await fixture();
  try {
    const opened = await f.store.readEvidence(runId);
    await f.store.update(runId, 0, {
      captures: [],
      observations: opened.observations,
      effort: null,
      issues: []
    });
    for (const at of ["2026-09-06T10:12:00.000Z", "2026-09-06T10:13:00.000Z"])
      f.events.push({
        runId,
        at,
        type: "review.triaged",
        details: { reviewIteration: 1 }
      });
    await writeFile(
      path.join(f.directory, "events.jsonl"),
      f.events.map((e) => JSON.stringify(e) + "\n").join("")
    );
    const evidence = await f.store.readEvidence(runId);
    assert.equal(
      evidence.observations.filter((o) => o.endpoint === "answered").length,
      2
    );
    const summary = deriveHumanTime(
      await f.store.read(runId),
      evidence,
      "2026-09-06T10:15:00.000Z"
    );
    assert.equal(summary.answeredMs, null);
    assert.equal(summary.episodes[0]?.outcome, "incomplete");
    assert.ok(summary.issues.some((i) => i.code === "CONFLICTING_ENDPOINTS"));
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("human time: unsupported ledgers, symlink ancestors and oversized evidence remain intact and unavailable", async () => {
  const f = await fixture();
  try {
    const ledgerPath = path.join(f.directory, "human-time.json");
    for (const bytes of [
      "{",
      JSON.stringify({ schema: "future", schemaVersion: 2 })
    ]) {
      await writeFile(ledgerPath, bytes, { mode: 0o600 });
      assert.equal(
        (await f.store.update(runId, 0, change())).status,
        "unavailable"
      );
      assert.equal(await readFile(ledgerPath, "utf8"), bytes);
    }
    await rm(ledgerPath);
    await writeFile(
      path.join(f.directory, "events.jsonl"),
      Buffer.alloc(HUMAN_TIME_LIMITS.eventBytes + 1, 32)
    );
    const evidence = await f.store.readEvidence(runId);
    assert.deepEqual(evidence.observations, []);
    assert.deepEqual(evidence.issues, [
      { code: "LIMIT_EXCEEDED", episodeKey: null }
    ]);
    assert.equal((await f.store.read(runId)).status, "absent");
    const moved = path.join(f.root, "moved-run");
    await rename(f.directory, moved);
    await symlink(moved, f.directory);
    assert.deepEqual(await f.store.update(runId, 0, change()), {
      status: "unavailable",
      issue: "UNSAFE_PATH"
    });
    assert.ok(
      !(await readdir(moved)).some((name) => name.startsWith("human-time"))
    );
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("human time: blocked recovery waiting ends at the next attempt and never enters answered gates or active effort", async () => {
  const f = await fixture();
  try {
    f.events.splice(1);
    f.events.push({
      runId,
      at: "2026-09-06T10:00:00.000Z",
      type: "attempt.applied",
      details: {
        attemptId: "implementation-1",
        kind: "implementation",
        gate: null,
        status: "blocked"
      }
    });
    await writeFile(
      path.join(f.directory, "state.json"),
      JSON.stringify({ schemaVersion: 3, runId, status: "blocked" })
    );
    await writeFile(
      path.join(f.directory, "events.jsonl"),
      f.events.map((e) => JSON.stringify(e) + "\n").join("")
    );
    const recorder = new InteractiveHumanTime(f.store, () => {}, {
      utc: () => "2026-09-06T10:12:00.000Z",
      monotonic: () => 0
    });
    await recorder.attach(runId);
    const pending = await recorder.readSummary(runId);
    assert.equal(pending.episodes[0]?.kind, "recovery_wait");
    assert.equal(pending.episodes[0].durationMs, 12 * 60000);
    assert.equal(pending.recoveryUnknown, false);
    f.events.push({
      runId,
      at: "2026-09-06T10:12:00.000Z",
      type: "attempt.recovery_started",
      details: { attemptId: "fix-1" }
    });
    await writeFile(
      path.join(f.directory, "events.jsonl"),
      f.events.map((e) => JSON.stringify(e) + "\n").join("")
    );
    await writeFile(
      path.join(f.directory, "state.json"),
      JSON.stringify({ schemaVersion: 3, runId, status: "fixing" })
    );
    const closed = await recorder.readSummary(runId);
    assert.equal(closed.episodes[0]?.outcome, "recovery_ended");
    assert.equal(closed.episodes[0].durationMs, 12 * 60000);
    assert.equal(closed.answeredMs, null);
    assert.equal(closed.answeredCount, 0);
    assert.equal(closed.effort, null);
    await recorder.detach();
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});
