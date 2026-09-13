import assert from "node:assert/strict";
import { appendFile, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  CANCELLATION_SCHEMA,
  captureCancellationContext,
  initialCancellationResponse
} from "../src/cancellation.js";
import type {
  CancellationReason,
  CancellationReport
} from "../src/cancellation.js";
import { collectCancellationReport } from "../src/cancellation-report.js";
import {
  renderCancellationJson,
  renderCancellationMarkdown
} from "../src/cancellation-report-render.js";
import { parseCancellationReportArgs } from "../src/cancellation-cli.js";
import {
  readCancellationDirectory,
  readCancellationFile
} from "../src/cancellation-evidence.js";
import { emptyHumanTime } from "../src/human-time.js";
import {
  evaluationAttemptFixture,
  verificationAttemptFixture,
  evaluationStateFixture,
  snapshotTree,
  writeEvaluationRun,
  writeVerificationLedger
} from "./helpers.js";

const at = "2026-07-01T01:00:00.000Z";
const anchor = {
  schemaVersion: 1,
  id: "12345678-1234-4123-8123-123456789abc",
  at
};
const options = parseCancellationReportArgs([]);
async function add(
  root: string,
  id: string,
  reason?: CancellationReason,
  status = "cancelled"
) {
  const before = evaluationStateFixture({
    schemaVersion: 5,
    status: "planning",
    extra: { runId: id }
  });
  const state: Record<string, unknown> = {
    ...before,
    status,
    cancellation: anchor
  };
  const observation = {
    schema: CANCELLATION_SCHEMA,
    schemaVersion: 1,
    cancellationId: anchor.id,
    runId: id,
    cancelledAt: at,
    context: captureCancellationContext(before),
    response: initialCancellationResponse(
      reason === undefined ? {} : { reason },
      at
    )
  };
  const event = { at, type: "run.cancelled", runId: id, details: observation };
  await writeEvaluationRun(root, id, { state, events: [event] });
  await writeVerificationLedger(root, id, []);
  return {
    state,
    event,
    observation,
    directory: path.join(root, ".banzai", "runs", id)
  };
}
async function root() {
  return await mkdtemp(path.join(tmpdir(), "banzai-cancellation-report-"));
}

test("cancellation: report conserves mixed-cohort denominators and separates missing, malformed and conflicting evidence", async () => {
  const directory = await root();
  try {
    await add(directory, "run-a", "plan_unsuitable");
    await add(directory, "run-b", "other");
    await add(directory, "run-c");
    const legacy = await add(directory, "run-d");
    const old = { ...legacy.state } as Record<string, unknown>;
    delete old.cancellation;
    await writeEvaluationRun(directory, "run-d", {
      state: old,
      events: [{ at, type: "run.cancelled", runId: "run-d", details: {} }]
    });
    const malformed = await add(directory, "run-e");
    await appendFile(
      path.join(malformed.directory, "events.jsonl"),
      "{partial"
    );
    const missing = await add(directory, "run-f");
    await writeFile(path.join(missing.directory, "events.jsonl"), "");
    const conflict = await add(directory, "run-g", "other");
    await appendFile(
      path.join(conflict.directory, "events.jsonl"),
      JSON.stringify({
        ...conflict.event,
        details: {
          ...conflict.observation,
          response: initialCancellationResponse(
            { reason: "intent_changed" },
            at
          )
        }
      }) + "\n"
    );
    const unsupported = await add(directory, "run-h");
    await writeFile(
      path.join(unsupported.directory, "events.jsonl"),
      JSON.stringify({
        ...unsupported.event,
        details: { ...unsupported.observation, schemaVersion: 2 }
      }) + "\n"
    );
    const unknown = await add(directory, "run-i");
    await writeFile(path.join(unknown.directory, "state.json"), "{partial");
    await add(directory, "run-j", "other", "done");
    const before = await snapshotTree(directory);
    const document = await collectCancellationReport(directory, options);
    assert.deepEqual(await snapshotTree(directory), before);
    assert.equal(document.cohort.includedRunCount, 10);
    assert.equal(document.summary.cancelledRunCount, 8);
    assert.equal(document.summary.nonCancelledRunCount, 1);
    assert.equal(document.summary.unknownLifecycleRunCount, 1);
    assert.deepEqual(document.summary.reasonCoverage, {
      numerator: 2,
      denominator: 8,
      value: 0.25
    });
    assert.equal(document.summary.responseCoverage.numerator, 3);
    for (const reason of document.summary.reasons)
      assert.equal(reason.ratio.denominator, 8);
    assert.equal(
      document.summary.reasons.find((r) => r.reason === "unspecified")?.count,
      1
    );
    for (const availability of [
      "malformed",
      "missing",
      "conflicting",
      "unsupported"
    ])
      assert.equal(
        document.summary.observationAvailability.find(
          (r) => r.availability === availability
        )?.count,
        availability === "conflicting" ? 2 : 1
      );
    const total =
      document.summary.reasons.reduce((n, r) => n + r.count, 0) +
      document.summary.observationAvailability
        .filter((r) => r.availability !== "available")
        .reduce((n, r) => n + r.count, 0);
    assert.equal(total, 8);
    const json = renderCancellationJson(document);
    const markdown = renderCancellationMarkdown(document);
    assert.equal(
      json,
      renderCancellationJson(
        await collectCancellationReport(directory, options)
      )
    );
    assert.equal(
      markdown,
      renderCancellationMarkdown(JSON.parse(json) as CancellationReport)
    );
    for (const canary of [
      "FORBIDDEN",
      "run-a",
      "12345678-1234",
      "partial",
      "run.cancelled"
    ]) {
      if (canary !== "partial")
        assert.ok(!json.includes(canary) && !markdown.includes(canary));
    }
    assert.match(markdown, /Meaningful reported-reason coverage: 2\/8/);
    assert.match(markdown, /Confirmed cancelled: 8/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("cancellation: empty cohort, date boundary and explicit selection preserve all denominator meanings", async () => {
  const directory = await root();
  try {
    const before = await snapshotTree(directory);
    const empty = await collectCancellationReport(directory, options);
    assert.deepEqual(await snapshotTree(directory), before);
    assert.equal(empty.cohort.candidateRunCount, 0);
    assert.ok(
      empty.summary.reasons.every(
        (r) =>
          r.count === 0 && r.ratio.value === null && r.ratio.denominator === 0
      )
    );
    assert.equal(empty.summary.reasonCoverage.value, null);
    assert.equal(empty.summary.work.modelAttempts.value, 0);
    assert.equal(empty.summary.work.reportedCostUsd.value, null);
    await add(directory, "run-a", "other");
    const b = await add(directory, "run-b", "other");
    await writeFile(path.join(b.directory, "state.json"), "{}");
    const dates = await collectCancellationReport(
      directory,
      parseCancellationReportArgs([
        "--from",
        "2026-07-01T00:00:00Z",
        "--to",
        "2026-07-02T00:00:00Z"
      ])
    );
    assert.equal(dates.cohort.includedRunCount, 1);
    assert.equal(dates.cohort.unresolvedRunCount, 1);
    const exclusive = await collectCancellationReport(
      directory,
      parseCancellationReportArgs(["--to", "2026-07-01T00:00:00Z"])
    );
    assert.equal(exclusive.cohort.excludedRunCount, 1);
    assert.equal(exclusive.summary.cancelledRunCount, 0);
    const selected = await collectCancellationReport(
      directory,
      parseCancellationReportArgs(["--run", "run-b"])
    );
    assert.equal(
      selected.runs.find((r) => r.membership === "included")?.runKey,
      "run-000002"
    );
    assert.equal(selected.cohort.selectedRunCount, 1);
    assert.equal(selected.summary.unknownLifecycleRunCount, 1);
    await assert.rejects(
      collectCancellationReport(
        directory,
        parseCancellationReportArgs(["--run", "missing"])
      ),
      /explicitly selected/
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("cancellation: resources respect cutoff, inventory gaps and current human-time replacement semantics", async () => {
  const directory = await root();
  try {
    const fixture = await add(directory, "run-a", "execution_blocked");
    const before = evaluationAttemptFixture({
      id: "closed",
      kind: "plan",
      status: "failed",
      usage: {
        inputTokens: 20,
        cachedInputTokens: 2,
        outputTokens: 3,
        costUsd: 0.2
      }
    });
    const straddling = evaluationAttemptFixture({
      id: "open",
      kind: "implementation",
      startedAt: "2026-07-01T00:59:59.000Z",
      durationMs: 5000,
      usage: {
        inputTokens: 999,
        cachedInputTokens: 0,
        outputTokens: 999,
        costUsd: 99
      }
    });
    before.failureCode = "PROCESS_TIMEOUT";
    before.failureCause = "timeout";
    straddling.failureCode = "FORBIDDEN-FAILURE-CODE";
    await writeFile(
      path.join(fixture.directory, "attempts", "closed-plan.json"),
      JSON.stringify(before)
    );
    await writeFile(
      path.join(fixture.directory, "attempts", "open-implementation.json"),
      JSON.stringify(straddling)
    );
    const metrics = fixture.state.metrics as {
      attempts: Record<string, number>;
    };
    metrics.attempts.plan = 1;
    metrics.attempts.implementation = 1;
    metrics.attempts.verification = 2;
    const verification = verificationAttemptFixture({
      sequence: 1,
      status: "failed"
    });
    const verificationOpen = verificationAttemptFixture({
      sequence: 2,
      status: "started"
    });
    for (const record of [verification, verificationOpen]) {
      await writeFile(
        path.join(
          fixture.directory,
          "verification-attempts",
          `verification-${String(record.sequence).padStart(6, "0")}-${record.id}.json`
        ),
        JSON.stringify(record)
      );
    }
    await writeFile(
      path.join(fixture.directory, "state.json"),
      JSON.stringify(fixture.state)
    );
    const ledger = emptyHumanTime("run-a");
    ledger.effortRevisions = [
      {
        id: "99999999-9999-4999-8999-999999999999",
        replaces: null,
        recordedAt: at,
        asOf: at,
        minutes: 15,
        basis: "estimated",
        scope: "single_engineer_unverified"
      }
    ];
    await writeFile(
      path.join(fixture.directory, "human-time.json"),
      JSON.stringify(ledger)
    );
    const doc = await collectCancellationReport(directory, options);
    const run = doc.runs[0];
    assert.ok(run);
    assert.equal(run.work.modelAttempts.value, 2);
    assert.equal(run.work.verificationAttempts.value, 2);
    assert.equal(run.work.verificationDurationMs.observedSubtotal, 1000);
    assert.equal(run.work.verificationDurationMs.unknownCount, 1);
    assert.equal(
      run.technical.find((t) => t.kind === "verification")
        ?.verificationExitCode,
      7
    );
    assert.equal(run.work.modelDurationMs.observedSubtotal, 1000);
    assert.equal(run.work.inputTokens.observedSubtotal, 20);
    assert.equal(run.work.inputTokens.unknownCount, 1);
    assert.equal(run.work.inputTokens.value, null);
    assert.equal(run.work.reportedCostUsd.observedSubtotal, 0.2);
    assert.equal(run.work.activeTimeEstimate.minutes, 15);
    assert.equal(run.work.runElapsedMs.value, 3600000);
    assert.equal(
      run.technical.find((t) => t.failureCode === "PROCESS_TIMEOUT")
        ?.failureCause,
      "timeout"
    );
    assert.ok(!renderCancellationJson(doc).includes("FORBIDDEN"));
    assert.deepEqual(doc.summary.work.activeTimeEstimate, {
      exact: 0,
      partial: 1,
      unavailable: 0
    });
    ledger.effortRevisions.push({
      id: "88888888-8888-4888-8888-888888888888",
      replaces: "99999999-9999-4999-8999-999999999999",
      recordedAt: "2026-07-01T02:00:00.000Z",
      asOf: "2026-07-01T02:00:00.000Z",
      minutes: 20,
      basis: "estimated",
      scope: "single_engineer_unverified"
    });
    await writeFile(
      path.join(fixture.directory, "human-time.json"),
      JSON.stringify(ledger)
    );
    metrics.attempts.review = 1;
    await writeFile(
      path.join(fixture.directory, "state.json"),
      JSON.stringify(fixture.state)
    );
    const changed = await collectCancellationReport(directory, options);
    assert.equal(changed.runs[0]?.work.activeTimeEstimate.minutes, null);
    assert.equal(changed.runs[0].work.modelAttempts.value, null);
    assert.equal(changed.runs[0].work.modelAttempts.unknownCount, 1);
    assert.equal(changed.runs[0].work.inventory.model, "incomplete");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("cancellation: unsafe paths, oversized inputs and changed sources stay visible without repair or raw disclosure", async () => {
  const directory = await root();
  try {
    const a = await add(directory, "run-a", "superseded");
    await add(directory, "run-b", "superseded");
    await writeFile(
      path.join(a.directory, "events.jsonl"),
      "x".repeat(8 * 1024 * 1024 + 1)
    );
    const outside = path.join(directory, "outside.json");
    await writeFile(outside, '{"secret":"FORBIDDEN"}');
    await symlink(outside, path.join(a.directory, "human-time.json"));
    const before = await snapshotTree(path.join(directory, ".banzai"));
    const doc = await collectCancellationReport(directory, options);
    assert.deepEqual(
      await snapshotTree(path.join(directory, ".banzai")),
      before
    );
    assert.equal(doc.summary.cancelledRunCount, 2);
    assert.ok(doc.issues.some((i) => i.code === "EVIDENCE_LIMIT"));
    assert.ok(doc.issues.some((i) => i.code === "UNSAFE_EVIDENCE"));
    assert.equal(doc.runs[1]?.continuation.intent, "reported_superseded");
    assert.equal(doc.runs[1].continuation.confirmation, "unavailable");
    assert.deepEqual(doc.runs[1].continuation.runKeys, []);
    let changed = false;
    const unstable = await collectCancellationReport(directory, options, {
      directory: readCancellationDirectory,
      file: async (...args) => {
        const read = await readCancellationFile(...args);
        if (!changed && args[1].endsWith("run-b/state.json")) {
          changed = true;
          await appendFile(path.join(directory, args[1]), " ");
        }
        return read;
      }
    });
    assert.ok(unstable.issues.some((i) => i.code === "SOURCE_CHANGED"));
    assert.equal(unstable.runs[1]?.observation.availability, "unavailable");
    assert.equal(unstable.summary.cancelledRunCount, 2);
    assert.ok(!renderCancellationJson(unstable).includes("FORBIDDEN"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("cancellation: exact duplicates count once; pending and missing markers never become unspecified", async () => {
  const directory = await root();
  try {
    const duplicate = await add(directory, "run-a", "other");
    await appendFile(
      path.join(duplicate.directory, "events.jsonl"),
      JSON.stringify(duplicate.event) + "\n"
    );
    const pending = await add(directory, "run-b");
    pending.observation.response = initialCancellationResponse(
      { channel: "interactive" },
      at
    );
    await writeFile(
      path.join(pending.directory, "events.jsonl"),
      JSON.stringify(pending.event) + "\n"
    );
    const absent = await add(directory, "run-c");
    const old = { ...absent.state } as Record<string, unknown>;
    delete old.cancellation;
    await writeEvaluationRun(directory, "run-c", { state: old });
    const doc = await collectCancellationReport(directory, options);
    assert.equal(doc.summary.cancelledRunCount, 3);
    assert.equal(
      doc.summary.reasons.find((r) => r.reason === "other")?.count,
      1
    );
    assert.equal(
      doc.summary.reasons.find((r) => r.reason === "unspecified")?.count,
      0
    );
    assert.equal(doc.runs[1]?.observation.availability, "unanswered");
    assert.equal(doc.runs[2]?.observation.availability, "missing");
    assert.ok(doc.issues.some((i) => i.code === "DUPLICATE_OBSERVATION"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("cancellation: conflicting physical identities invalidate both resource contributors", async () => {
  const directory = await root();
  try {
    const fixture = await add(directory, "run-a");
    const first = evaluationAttemptFixture({
      id: "same",
      kind: "plan",
      usage: {
        inputTokens: 50,
        cachedInputTokens: 0,
        outputTokens: 10,
        costUsd: 1
      }
    });
    const second = evaluationAttemptFixture({
      id: "same",
      kind: "implementation",
      usage: {
        inputTokens: 80,
        cachedInputTokens: 0,
        outputTokens: 10,
        costUsd: 2
      }
    });
    await writeFile(
      path.join(fixture.directory, "attempts", "same-plan.json"),
      JSON.stringify(first)
    );
    await writeFile(
      path.join(fixture.directory, "attempts", "same-implementation.json"),
      JSON.stringify(second)
    );
    const report = await collectCancellationReport(directory, options);
    assert.equal(report.runs[0]?.work.inputTokens.observedSubtotal, 0);
    assert.equal(report.runs[0].work.inputTokens.invalidCount, 2);
    assert.equal(report.runs[0].work.inputTokens.value, null);
    assert.ok(report.issues.some((i) => i.code === "ATTEMPT_EVIDENCE_INVALID"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
