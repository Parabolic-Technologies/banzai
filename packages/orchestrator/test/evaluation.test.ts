import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  collectEvaluationExport,
  EVALUATION_ROTATION_REASON_ORDER
} from "../src/evaluation.js";
import { executeEvaluationExport } from "../src/evaluation-cli.js";
import { deriveEvaluationKpiReport } from "../src/evaluation-kpi.js";
import {
  renderEvaluationKpiJson,
  renderEvaluationKpiMarkdown
} from "../src/evaluation-kpi-render.js";
import {
  renderEvaluationJson,
  renderEvaluationMarkdown
} from "../src/evaluation-render.js";
import type { EvaluationExportOptions } from "../src/types.js";
import {
  createEvaluationRoot,
  evaluationAttemptFixture,
  evaluationStateFixture,
  snapshotTree,
  verificationAttemptFixture,
  writeVerificationLedger,
  writeEvaluationRun
} from "./helpers.js";
import {
  currentReviewFixture,
  reviewSnapshotFixture
} from "./review-fixtures.js";

const DEFAULT_OPTIONS: EvaluationExportOptions = {
  format: "json",
  from: null,
  to: null,
  runIds: []
};
test("exports a deterministic exact-zero dataset when the run set is empty or absent", async () => {
  const root = await createEvaluationRoot();
  try {
    const first = await collectEvaluationExport(root, DEFAULT_OPTIONS);
    const second = await collectEvaluationExport(root, DEFAULT_OPTIONS);
    assert.deepEqual(first, second);
    assert.equal(first.schema, "banzai-evaluation-export/v2");
    assert.equal(first.schemaVersion, 2);
    assert.equal(first.aggregates.overall.runCount, 0);
    assert.equal(first.aggregates.overall.metrics.attempts.total.value, 0);
    assert.equal(first.aggregates.overall.metrics.usage.inputTokens.value, 0);
    assert.equal(
      first.aggregates.overall.metrics.usage.costUsd.availability,
      "unavailable"
    );

    await rm(path.join(root, ".banzai", "runs"), {
      recursive: true,
      force: true
    });
    const absent = await collectEvaluationExport(root, DEFAULT_OPTIONS);
    assert.equal(absent.cohort.candidateRunCount, 0);
    assert.match(
      renderEvaluationMarkdown(absent),
      /No runs are included in this cohort\./
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("exports a complete strict run with phase, verification, usage, review, triage, and fix evidence", async () => {
  const root = await createEvaluationRoot();
  const attempts = [
    evaluationAttemptFixture({
      id: "selection-id",
      kind: "selection",
      durationMs: 1_000,
      usage: {
        inputTokens: 10,
        cachedInputTokens: 1,
        outputTokens: 2,
        costUsd: 0.1
      }
    }),
    evaluationAttemptFixture({
      id: "plan-id",
      kind: "plan",
      startedAt: "2026-07-01T00:02:00.000Z",
      durationMs: 2_000,
      usage: {
        inputTokens: 20,
        cachedInputTokens: 2,
        outputTokens: 3,
        costUsd: 0.2
      }
    }),
    evaluationAttemptFixture({
      id: "implementation-id",
      kind: "implementation",
      startedAt: "2026-07-01T00:03:00.000Z",
      durationMs: 3_000,
      usage: {
        inputTokens: 30,
        cachedInputTokens: 3,
        outputTokens: 4,
        costUsd: 0.3
      }
    }),
    evaluationAttemptFixture({
      id: "review-id",
      kind: "review",
      startedAt: "2026-07-01T00:04:00.000Z",
      durationMs: 4_000,
      usage: {
        inputTokens: 40,
        cachedInputTokens: 4,
        outputTokens: 5,
        costUsd: 0.4
      }
    }),
    evaluationAttemptFixture({
      id: "fix-id",
      kind: "fix",
      startedAt: "2026-07-01T00:05:00.000Z",
      durationMs: 5_000,
      usage: {
        inputTokens: 50,
        cachedInputTokens: 5,
        outputTokens: 6,
        costUsd: 0.5
      }
    })
  ];
  const triageHistory = [
    {
      items: [
        { disposition: "accepted", findingId: "FORBIDDEN-FINDING-1" },
        { disposition: "rejected", findingId: "FORBIDDEN-FINDING-2" },
        { disposition: "deferred", findingId: "FORBIDDEN-FINDING-3" }
      ],
      decidedBy: "FORBIDDEN-HUMAN",
      note: "FORBIDDEN-TRIAGE-NOTE"
    }
  ];
  try {
    await writeEvaluationRun(root, "strict-secret-slug", {
      state: evaluationStateFixture({
        attempts: {
          selection: 1,
          plan: 1,
          implementation: 1,
          fix: 1,
          review: 1,
          verification: 1
        },
        usage: {
          inputTokens: 150,
          cachedInputTokens: 15,
          outputTokens: 20,
          costUsd: 1.5
        },
        sessions: { fresh: 5, resumed: 0 },
        reviews: { full: 1, delta: 0, rotations: 0 },
        reviewIteration: 1,
        reviewFindingCount: 3,
        triageMetrics: { accepted: 1, rejected: 1, deferred: 1 },
        triageHistory,
        fixCycle: 2,
        verification: [
          {
            name: "FORBIDDEN-COMMAND-NAME",
            command: "FORBIDDEN-COMMAND",
            args: ["FORBIDDEN-ARG"],
            exitCode: 0,
            signal: null,
            stdoutPath: "/FORBIDDEN/VERIFY-STDOUT",
            stderrPath: "/FORBIDDEN/VERIFY-STDERR",
            startedAt: "2026-07-01T00:05:00.000Z",
            completedAt: "2026-07-01T00:05:05.000Z"
          }
        ]
      }),
      attempts,
      reviews: [
        {
          ordinal: 1,
          value: {
            verdict: "pass",
            summary: "FORBIDDEN-REVIEW-SUMMARY",
            findings: [
              { severity: "blocker", summary: "FORBIDDEN-BLOCKER" },
              { severity: "should_fix", evidence: "FORBIDDEN-EVIDENCE" },
              { severity: "nit", reproduction: "FORBIDDEN-REPRODUCTION" }
            ]
          }
        }
      ]
    });
    await writeVerificationLedger(root, "strict-secret-slug", [
      {
        ...verificationAttemptFixture({ sequence: 1 }),
        durationMs: 5_000,
        completedAt: "2026-07-01T00:01:05.000Z"
      }
    ]);
    const report = await collectEvaluationExport(root, DEFAULT_OPTIONS);
    const run = report.runs[0];
    assert.ok(run);
    assert.equal(run.completeness, "complete");
    assert.equal(run.workflow.value, "strict");
    assert.equal(run.status.value, "done");
    assert.deepEqual(run.attempts[0]?.source.schemaVersion, {
      value: 2,
      evidence: "observed"
    });
    assert.equal(run.metrics.attempts.total.value, 6);
    assert.equal(run.metrics.durationsMs.selection.value, 1_000);
    assert.equal(run.metrics.durationsMs.planning.value, 2_000);
    assert.equal(run.metrics.durationsMs.implementation.value, 3_000);
    assert.equal(run.metrics.durationsMs.review.value, 4_000);
    assert.equal(run.metrics.durationsMs.fixing.value, 5_000);
    assert.equal(run.metrics.durationsMs.verification.value, 5_000);
    assert.equal(run.metrics.sessions.fresh.value, 5);
    assert.equal(run.metrics.reviews.attempts.full.value, 1);
    assert.equal(run.metrics.usage.inputTokens.value, 150);
    assert.equal(run.metrics.usage.cachedInputTokens.value, 15);
    assert.equal(run.metrics.usage.outputTokens.value, 20);
    assert.equal(run.metrics.usage.costUsd.value, 1.5);
    assert.equal(run.metrics.reviews.findings.blocker.value, 1);
    assert.equal(run.metrics.reviews.findings.should_fix.value, 1);
    assert.equal(run.metrics.reviews.findings.nit.value, 1);
    assert.equal(run.metrics.triage.accepted.value, 1);
    assert.equal(run.metrics.triage.rejected.value, 1);
    assert.equal(run.metrics.triage.deferred.value, 1);
    assert.equal(run.metrics.fixCycles.value, 2);
    assert.equal(run.metrics.humanMinutes.availability, "unavailable");
    assert.equal(run.metrics.falsePositiveRate.availability, "unavailable");
    assert.equal(report.issues.length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("keeps human-triaged completion separate from a passing review", async () => {
  const root = await createEvaluationRoot();
  const triage = {
    reviewIteration: 1,
    decidedAt: "2026-07-01T00:05:00.000Z",
    decidedBy: "FORBIDDEN-HUMAN",
    items: [
      { disposition: "rejected", findingId: "FORBIDDEN-FINDING-1" },
      { disposition: "deferred", findingId: "FORBIDDEN-FINDING-2" }
    ]
  };
  try {
    await writeEvaluationRun(root, "triage-completed", {
      state: evaluationStateFixture({
        status: "done",
        reviewIteration: 1,
        attempts: { review: 1 },
        sessions: { fresh: 1, resumed: 0 },
        reviews: { full: 1, delta: 0, rotations: 0 },
        reviewFindingCount: 2,
        triageMetrics: { accepted: 0, rejected: 1, deferred: 1 },
        triageHistory: [triage],
        extra: {
          triage,
          latestReview: {
            iteration: 1,
            resultPath: "reviews/review-1.json",
            artifactPath: "FORBIDDEN-REVIEW-ARTIFACT-PATH",
            workspaceDigest: "FORBIDDEN-WORKSPACE-DIGEST",
            verdict: "changes_requested",
            sessionMode: "fresh",
            mode: "full",
            rotationReason: "primary-review"
          }
        }
      }),
      attempts: [
        evaluationAttemptFixture({
          id: "review-id",
          kind: "review",
          sessionMode: "fresh",
          reviewMode: "full",
          rotationReason: "primary-review",
          usage: {
            inputTokens: 0,
            cachedInputTokens: 0,
            outputTokens: 0,
            costUsd: null
          }
        })
      ],
      reviews: [
        {
          ordinal: 1,
          value: {
            verdict: "changes_requested",
            findings: [{ severity: "should_fix" }, { severity: "should_fix" }]
          }
        }
      ]
    });

    const report = await collectEvaluationExport(root, DEFAULT_OPTIONS);
    const run = report.runs[0];
    assert.ok(run);
    assert.equal(run.status.value, "done");
    assert.equal(run.terminal.value, true);
    assert.equal(run.reviews[0]?.verdict.value, "changes_requested");
    assert.equal(run.metrics.reviews.verdicts.changes_requested.value, 1);
    assert.equal(run.metrics.reviews.verdicts.pass.value, 0);
    assert.equal(run.metrics.reviews.findings.should_fix.value, 2);
    assert.equal(run.metrics.triage.accepted.value, 0);
    assert.equal(run.metrics.triage.rejected.value, 1);
    assert.equal(run.metrics.triage.deferred.value, 1);
    assert.equal(run.metrics.falsePositiveRate.availability, "unavailable");
    assert.equal(
      report.aggregates.overall.metrics.reviews.verdicts.pass.value,
      0
    );
    assert.equal(report.issues.length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("includes lite, blocked, cancelled, and incomplete runs in route and status aggregates", async () => {
  const root = await createEvaluationRoot();
  try {
    await writeEvaluationRun(root, "a-quick", {
      state: evaluationStateFixture({
        workflow: "quick-fix",
        status: "blocked"
      })
    });
    await writeEvaluationRun(root, "b-feature", {
      state: evaluationStateFixture({
        workflow: "feature",
        status: "cancelled"
      })
    });
    await writeEvaluationRun(root, "c-strict", {
      state: evaluationStateFixture({
        workflow: "strict",
        status: "implementing"
      })
    });
    const report = await collectEvaluationExport(root, DEFAULT_OPTIONS);
    assert.equal(report.aggregates.overall.runCount, 3);
    assert.equal(report.aggregates.byWorkflow["quick-fix"].runCount, 1);
    assert.equal(report.aggregates.byWorkflow.feature.runCount, 1);
    assert.equal(report.aggregates.byWorkflow.strict.runCount, 1);
    assert.equal(report.aggregates.byStatus.blocked.runCount, 1);
    assert.equal(report.aggregates.byStatus.cancelled.runCount, 1);
    assert.equal(report.aggregates.byStatus.implementing.runCount, 1);
    assert.equal(
      report.aggregates.byStatus.blocked.metrics.failures.blocked_other.value,
      1
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("exports refuse removed state versions without changing the selected run tree", async () => {
  const root = await createEvaluationRoot();
  try {
    for (const schemaVersion of [1, 2, 3, 4, 6]) {
      await writeEvaluationRun(root, "old-run", {
        state: evaluationStateFixture({ schemaVersion })
      });
      const before = await snapshotTree(root);
      await assert.rejects(collectEvaluationExport(root, DEFAULT_OPTIONS), {
        code: "RESOURCE_VERSION_UNSUPPORTED"
      });
      assert.deepEqual(await snapshotTree(root), before);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("export refuses removed attempt versions before exposing numeric evidence", async () => {
  const root = await createEvaluationRoot();
  try {
    for (const schemaVersion of [undefined, 1, 3, 999, "2"]) {
      const attempt = {
        ...evaluationAttemptFixture({
          id: "old-attempt",
          kind: "implementation"
        }),
        schemaVersion
      };
      await writeEvaluationRun(root, "old-attempt-run", {
        state: evaluationStateFixture(),
        attempts: [attempt]
      });
      const before = await snapshotTree(root);
      await assert.rejects(collectEvaluationExport(root, DEFAULT_OPTIONS), {
        code: "RESOURCE_VERSION_UNSUPPORTED"
      });
      assert.deepEqual(await snapshotTree(root), before);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("review snapshot sidecars leave frozen export and KPI bytes unchanged", async () => {
  const root = await createEvaluationRoot();
  const snapshot = reviewSnapshotFixture();
  const runDirectory = path.join(root, ".banzai", "runs", snapshot.runId);
  try {
    await writeEvaluationRun(root, snapshot.runId, {
      state: evaluationStateFixture({
        schemaVersion: 5,
        reviewIteration: 1,
        attempts: { review: 1 },
        sessions: { fresh: 1, resumed: 0 },
        reviews: { full: 1, delta: 0, rotations: 0 }
      }),
      attempts: [
        evaluationAttemptFixture({ id: snapshot.attemptId, kind: "review" })
      ],
      reviews: [{ ordinal: 1, value: currentReviewFixture(snapshot) }]
    });
    const withoutSidecar = await collectEvaluationExport(root, DEFAULT_OPTIONS);
    const run = withoutSidecar.runs[0];
    assert.ok(run);
    assert.equal(withoutSidecar.schema, "banzai-evaluation-export/v2");
    assert.equal(run.metrics.attempts.total.value, 1);
    assert.equal(run.metrics.attempts.total.availability, "complete");
    assert.deepEqual(
      withoutSidecar.issues.filter((issue) => issue.source === "attempt"),
      []
    );
    await writeFile(
      path.join(
        runDirectory,
        "attempts",
        `${snapshot.attemptId}.review-snapshot.json`
      ),
      JSON.stringify(snapshot, null, 2) + "\n",
      { mode: 0o600 }
    );
    const beforeRead = await snapshotTree(runDirectory);
    const withSidecar = await collectEvaluationExport(root, DEFAULT_OPTIONS);
    assert.equal(
      renderEvaluationJson(withSidecar),
      renderEvaluationJson(withoutSidecar)
    );
    assert.equal(
      renderEvaluationMarkdown(withSidecar),
      renderEvaluationMarkdown(withoutSidecar)
    );
    const kpiWithout = deriveEvaluationKpiReport([
      { label: "current", report: withoutSidecar }
    ]);
    const kpiWith = deriveEvaluationKpiReport([
      { label: "current", report: withSidecar }
    ]);
    assert.equal(kpiWith.schema, "banzai-evaluation-kpi/v2");
    assert.equal(
      renderEvaluationKpiJson(kpiWith),
      renderEvaluationKpiJson(kpiWithout)
    );
    assert.equal(
      renderEvaluationKpiMarkdown(kpiWith),
      renderEvaluationKpiMarkdown(kpiWithout)
    );
    assert.deepEqual(await snapshotTree(runDirectory), beforeRead);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("schema-two interrupted attempts preserve the v2 export shape and checkpoint privacy", async () => {
  const root = await createEvaluationRoot();
  const runId = "interrupted-schema-two";
  const secret = "sk-ant-terminal-checkpoint-secret";
  try {
    const attempt = evaluationAttemptFixture({
      id: "implementation-1-interrupted",
      kind: "implementation",
      status: "started",
      durationMs: null
    });
    attempt.schemaVersion = 2;
    attempt.status = "interrupted";
    attempt.interruptedAt = "2026-07-01T00:02:00.000Z";
    attempt.recoveryOf = null;
    attempt.recoveryAuthorizationId = null;
    await writeEvaluationRun(root, runId, {
      state: evaluationStateFixture({
        status: "blocked",
        attempts: { implementation: 1 }
      }),
      attempts: [attempt]
    });
    await writeFile(
      path.join(
        root,
        ".banzai",
        "runs",
        runId,
        "attempts",
        "attempt-01.terminal-checkpoint.json"
      ),
      JSON.stringify({ rawModelOutput: secret }),
      "utf8"
    );

    const report = await collectEvaluationExport(root, DEFAULT_OPTIONS);
    const run = report.runs[0];
    assert.ok(run);
    assert.deepEqual(run.attempts[0]?.source.schemaVersion, {
      value: 2,
      evidence: "observed"
    });
    assert.deepEqual(run.attempts[0].status, {
      value: "started",
      evidence: "derived"
    });
    assert.equal(run.metrics.attempts.byOutcome.started.value, 1);
    assert.equal(run.metrics.failures.interrupted_attempt.value, 1);
    assert.ok(!run.issueCodes.includes("ATTEMPT_MALFORMED"));
    assert.doesNotMatch(
      renderEvaluationJson(report),
      /terminal-checkpoint-secret/
    );
    assert.doesNotMatch(
      renderEvaluationMarkdown(report),
      /terminal-checkpoint-secret/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("completed blocked recovery evidence preserves evaluation v2 shape and privacy", async () => {
  const root = await createEvaluationRoot();
  const runId = "prerequisite-blocked-schema-two";
  const prerequisiteSecret =
    "FORBIDDEN RAW COMMAND docker exec private/database";
  const authorizationSecret = "FORBIDDEN-RECOVERY-AUTHORIZATION-IDENTITY";
  try {
    const attempt = evaluationAttemptFixture({
      id: "fix-2-fff81cb4",
      kind: "fix"
    });
    attempt.schemaVersion = 2;
    attempt.interruptedAt = null;
    attempt.recoveryOf = null;
    attempt.recoveryAuthorizationId = null;
    attempt.result = {
      phase: "fix",
      outcome: "blocked",
      summary: "Operator prerequisite remains.",
      resolvedFindingIds: ["R1-F2", "R1-F5", "R1-F6"],
      questions: [prerequisiteSecret],
      requestedVerification: ["/private/schema/catalog.json"]
    };
    await writeEvaluationRun(root, runId, {
      state: evaluationStateFixture({
        status: "blocked",
        attempts: { fix: 1 },
        extra: {
          recovery: {
            authorizationId: authorizationSecret,
            sourceAttemptId: "fix-2-fff81cb4",
            recoveryAttemptId: null,
            stage: "source_preserved"
          }
        }
      }),
      attempts: [attempt]
    });
    const authorizationDirectory = path.join(
      root,
      ".banzai",
      "runs",
      runId,
      "recovery-authorizations"
    );
    await mkdir(authorizationDirectory, { recursive: true });
    await writeFile(
      path.join(authorizationDirectory, "recovery-private.json"),
      JSON.stringify({
        recoveryIdentity: authorizationSecret,
        prerequisite: prerequisiteSecret
      }),
      "utf8"
    );

    const report = await collectEvaluationExport(root, DEFAULT_OPTIONS);
    const run = report.runs[0];
    assert.ok(run);
    assert.equal(report.schema, "banzai-evaluation-export/v2");
    assert.equal(report.schemaVersion, 2);
    assert.deepEqual(run.attempts[0]?.source.schemaVersion, {
      value: 2,
      evidence: "observed"
    });
    assert.deepEqual(run.attempts[0].status, {
      value: "completed",
      evidence: "observed"
    });
    assert.equal(run.metrics.attempts.byKind.fix.value, 1);
    assert.equal(run.metrics.attempts.byOutcome.completed.value, 1);
    const rendered = `${renderEvaluationJson(report)}\n${renderEvaluationMarkdown(report)}`;
    assert.doesNotMatch(rendered, /FORBIDDEN RAW COMMAND/);
    assert.doesNotMatch(rendered, /FORBIDDEN-RECOVERY-AUTHORIZATION/);
    assert.doesNotMatch(rendered, /private\/schema\/catalog/);
    assert.doesNotMatch(rendered, /source_preserved/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("matches active model attempts by exact identity and accounts once for missing or conflicting leaves", async () => {
  const root = await createEvaluationRoot();
  const activeProcess = {
    pid: 123,
    kind: "implementation",
    startedAt: "2026-07-01T00:01:00.000Z"
  };
  try {
    await writeEvaluationRun(root, "a-exact", {
      state: evaluationStateFixture({
        status: "implementing",
        attempts: { implementation: 1 },
        usage: {
          inputTokens: 10,
          cachedInputTokens: 2,
          outputTokens: 3,
          costUsd: 0.25
        },
        sessions: { fresh: 1, resumed: 0 },
        extra: {
          activeAttempt: { id: "active-exact", kind: "implementation" },
          activeProcess
        }
      }),
      attempts: [
        evaluationAttemptFixture({
          id: "active-exact",
          kind: "implementation",
          status: "started"
        })
      ]
    });
    await writeEvaluationRun(root, "b-missing", {
      state: evaluationStateFixture({
        status: "reviewing",
        attempts: { review: 2 },
        extra: {
          activeAttempt: { id: "missing-exact", kind: "review" },
          activeProcess: { ...activeProcess, kind: "review" }
        }
      }),
      attempts: [
        evaluationAttemptFixture({
          id: "different-started-review",
          kind: "review",
          status: "started"
        })
      ]
    });
    await writeFile(
      path.join(
        root,
        ".banzai",
        "runs",
        "b-missing",
        "attempts",
        "unrelated-malformed.json"
      ),
      "not json FORBIDDEN",
      "utf8"
    );
    await writeEvaluationRun(root, "c-conflict", {
      state: evaluationStateFixture({
        status: "implementing",
        attempts: { implementation: 1 },
        extra: {
          activeAttempt: { id: "active-conflict", kind: "implementation" },
          activeProcess
        }
      }),
      attempts: [
        evaluationAttemptFixture({
          id: "active-conflict",
          kind: "implementation",
          status: "completed"
        }),
        evaluationAttemptFixture({
          id: "active-conflict",
          kind: "implementation",
          status: "failed"
        })
      ]
    });

    const report = await collectEvaluationExport(root, DEFAULT_OPTIONS);
    const [exact, missing, conflicting] = report.runs;
    assert.ok(exact);
    assert.ok(missing);
    assert.ok(conflicting);
    assert.equal(exact.metrics.attempts.total.value, 1);
    assert.equal(exact.metrics.attempts.total.unknownCount, 0);
    assert.equal(exact.metrics.attempts.total.invalidCount, 0);
    assert.ok(!exact.issueCodes.includes("ACTIVE_ATTEMPT_INCOMPLETE"));

    assert.equal(missing.metrics.attempts.total.observedSubtotal, 1);
    assert.equal(missing.metrics.attempts.total.unknownCount, 1);
    assert.equal(missing.metrics.attempts.total.invalidCount, 1);
    assert.equal(missing.metrics.attempts.byKind.review.unknownCount, 1);
    assert.equal(missing.metrics.durationsMs.review.unknownCount, 1);
    assert.equal(missing.metrics.sessions.fresh.unknownCount, 1);
    assert.equal(missing.metrics.reviews.attempts.full.unknownCount, 1);
    assert.ok(missing.issueCodes.includes("ACTIVE_ATTEMPT_INCOMPLETE"));

    assert.equal(conflicting.metrics.attempts.total.observedSubtotal, 0);
    assert.equal(conflicting.metrics.attempts.total.invalidCount, 1);
    assert.equal(
      conflicting.metrics.attempts.byKind.implementation.invalidCount,
      1
    );
    assert.equal(
      conflicting.metrics.attempts.byOutcome.completed.invalidCount,
      1
    );
    assert.ok(conflicting.issueCodes.includes("ATTEMPT_CONFLICT"));
    assert.ok(conflicting.issueCodes.includes("ACTIVE_ATTEMPT_INCOMPLETE"));
    assert.doesNotMatch(renderEvaluationJson(report), /active-exact/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("preserves matching failed-retry and completed-reconciliation leaves as one authoritative contributor", async () => {
  const root = await createEvaluationRoot();
  try {
    await writeEvaluationRun(root, "a-failed-fix", {
      state: evaluationStateFixture({
        status: "blocked",
        fixCycle: 1,
        attempts: { fix: 1 },
        usage: {
          inputTokens: 7,
          cachedInputTokens: 1,
          outputTokens: 2,
          costUsd: 0.2
        },
        sessions: { fresh: 0, resumed: 1 },
        extra: {
          activeAttempt: { id: "failed-fix-secret", kind: "fix" },
          activeProcess: null
        }
      }),
      attempts: [
        evaluationAttemptFixture({
          id: "failed-fix-secret",
          kind: "fix",
          status: "failed",
          durationMs: 1_500,
          sessionMode: "resumed",
          usage: {
            inputTokens: 7,
            cachedInputTokens: 1,
            outputTokens: 2,
            costUsd: 0.2
          }
        })
      ]
    });
    await writeEvaluationRun(root, "b-completed-review", {
      state: evaluationStateFixture({
        status: "reviewing",
        reviewIteration: 1,
        appliedReviewIteration: 0,
        attempts: { review: 1 },
        usage: {
          inputTokens: 11,
          cachedInputTokens: 3,
          outputTokens: 4,
          costUsd: 0.4
        },
        sessions: { fresh: 0, resumed: 1 },
        reviews: { full: 0, delta: 1, rotations: 1 },
        extra: {
          activeAttempt: { id: "completed-review-secret", kind: "review" },
          activeProcess: null
        }
      }),
      attempts: [
        evaluationAttemptFixture({
          id: "completed-review-secret",
          kind: "review",
          status: "completed",
          durationMs: 2_500,
          sessionMode: "resumed",
          reviewMode: "delta",
          rotationReason: "settings-changed",
          usage: {
            inputTokens: 11,
            cachedInputTokens: 3,
            outputTokens: 4,
            costUsd: 0.4
          }
        })
      ]
    });

    const report = await collectEvaluationExport(root, DEFAULT_OPTIONS);
    const [failed, completed] = report.runs;
    assert.ok(failed);
    assert.ok(completed);

    assert.equal(failed.attempts.length, 1);
    assert.equal(failed.metrics.attempts.total.value, 1);
    assert.equal(failed.metrics.attempts.byKind.fix.value, 1);
    assert.equal(failed.metrics.attempts.byOutcome.failed.value, 1);
    assert.equal(failed.metrics.durationsMs.fixing.value, 1_500);
    assert.equal(failed.metrics.sessions.resumed.value, 1);
    assert.equal(failed.metrics.usage.inputTokens.value, 7);
    assert.equal(failed.metrics.usage.cachedInputTokens.value, 1);
    assert.equal(failed.metrics.usage.outputTokens.value, 2);
    assert.equal(failed.metrics.usage.costUsd.value, 0.2);
    assert.equal(failed.metrics.failures.model_attempt.value, 1);
    assert.equal(failed.metrics.fixCycles.value, 1);
    assert.ok(!failed.issueCodes.includes("ACTIVE_ATTEMPT_INCOMPLETE"));

    assert.equal(completed.attempts.length, 1);
    assert.equal(completed.metrics.attempts.total.value, 1);
    assert.equal(completed.metrics.attempts.byKind.review.value, 1);
    assert.equal(completed.metrics.attempts.byOutcome.completed.value, 1);
    assert.equal(completed.metrics.durationsMs.review.value, 2_500);
    assert.equal(completed.metrics.sessions.resumed.value, 1);
    assert.equal(completed.metrics.reviews.attempts.delta.value, 1);
    assert.equal(completed.metrics.reviews.rotations.total.value, 1);
    assert.equal(
      completed.metrics.reviews.rotations.byReason["settings-changed"].value,
      1
    );
    assert.equal(completed.metrics.usage.inputTokens.value, 11);
    assert.equal(completed.metrics.usage.cachedInputTokens.value, 3);
    assert.equal(completed.metrics.usage.outputTokens.value, 4);
    assert.equal(completed.metrics.usage.costUsd.value, 0.4);
    assert.ok(!completed.issueCodes.includes("ACTIVE_ATTEMPT_INCOMPLETE"));

    const rendered = renderEvaluationJson(report);
    assert.doesNotMatch(rendered, /failed-fix-secret/);
    assert.doesNotMatch(rendered, /completed-review-secret/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("deduplicates persisted attempts while retaining failed, retried, resumed, delta, rotation, and null usage evidence", async () => {
  const root = await createEvaluationRoot();
  const failed = evaluationAttemptFixture({
    id: "failed-implementation",
    kind: "implementation",
    status: "failed",
    durationMs: 10,
    usage: null
  });
  const review = evaluationAttemptFixture({
    id: "resumed-review",
    kind: "review",
    sessionMode: "resumed",
    reviewMode: "delta",
    rotationReason: "settings-changed",
    usage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, costUsd: 0 }
  });
  try {
    await writeEvaluationRun(root, "retry-run", {
      state: evaluationStateFixture({
        status: "blocked",
        attempts: { implementation: 1, review: 1 },
        sessions: { fresh: 1, resumed: 1 },
        reviews: { full: 0, delta: 1, rotations: 1 },
        reviewIteration: 1,
        usage: {
          inputTokens: 0,
          cachedInputTokens: 0,
          outputTokens: 0,
          costUsd: 0
        }
      }),
      attempts: [failed, structuredClone(failed), review],
      events: [
        { type: "attempt.retry_requested", secret: "FORBIDDEN-EVENT" },
        { type: "verification.retry_requested" },
        { type: "run.start_retry_requested" },
        { type: "review.checks_retry_requested" },
        { type: "attempt.reconciled", raw: "FORBIDDEN-RECONCILIATION" }
      ],
      reviews: [{ ordinal: 1, value: { verdict: "pass", findings: [] } }]
    });
    const report = await collectEvaluationExport(root, DEFAULT_OPTIONS);
    const run = report.runs[0];
    assert.ok(run);
    assert.equal(run.attempts.length, 2);
    assert.equal(run.metrics.attempts.total.observedSubtotal, 2);
    assert.equal(run.metrics.attempts.byOutcome.failed.value, 1);
    assert.equal(run.metrics.sessions.resumed.value, 1);
    assert.equal(run.metrics.reviews.attempts.delta.value, 1);
    assert.equal(run.metrics.reviews.rotations.total.value, 1);
    assert.equal(
      run.metrics.reviews.rotations.byReason["settings-changed"].value,
      1
    );
    assert.equal(run.metrics.retries.total.value, 4);
    assert.equal(run.metrics.retries.byKind.attempt.value, 2);
    assert.equal(run.metrics.failures.model_attempt.value, 1);
    assert.equal(run.metrics.usage.inputTokens.value, null);
    assert.equal(run.metrics.usage.inputTokens.observedSubtotal, 0);
    assert.equal(run.metrics.usage.inputTokens.unknownCount, 1);
    assert.equal(run.metrics.usage.costUsd.value, null);
    assert.equal(run.metrics.usage.costUsd.observedSubtotal, 0);
    assert.equal(run.metrics.usage.costUsd.unknownCount, 1);
    assert.ok(run.issueCodes.includes("ATTEMPT_DUPLICATE"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("exports completion-validation failure and retry without leaking diagnostics", async () => {
  const root = await createEvaluationRoot();
  const attempt = evaluationAttemptFixture({
    id: "completion-invalid-implementation",
    kind: "implementation",
    status: "failed"
  });
  attempt.failureCode = "PLAN_TASK_COMPLETION_INVALID";
  attempt.error =
    "PLAN_TASK_COMPLETION_INVALID PRIVATE /repository/path and model output";
  try {
    await writeEvaluationRun(root, "completion-invalid-run", {
      state: evaluationStateFixture({
        status: "blocked",
        attempts: { implementation: 1 },
        extra: {
          planTaskCompletion: {
            status: "invalid",
            violation: "missing_task",
            privatePath: "/PRIVATE/REPOSITORY/PATH"
          }
        }
      }),
      attempts: [attempt],
      events: [
        {
          type: "plan_task_completion.validation_failed",
          code: "PLAN_TASK_COMPLETION_INVALID",
          violation: "missing_task",
          detail: "PRIVATE MODEL DIAGNOSTIC"
        },
        {
          type: "attempt.retry_requested",
          detail: "PRIVATE RETRY DIAGNOSTIC"
        }
      ]
    });

    const report = await collectEvaluationExport(root, DEFAULT_OPTIONS);
    const run = report.runs[0];
    assert.ok(run);
    assert.equal(
      run.issueCodes.filter((code) => code === "PLAN_TASK_COMPLETION_INVALID")
        .length,
      1
    );
    assert.equal(run.metrics.attempts.byOutcome.failed.value, 1);
    assert.equal(run.metrics.failures.model_attempt.value, 1);
    assert.equal(run.metrics.retries.total.value, 1);
    assert.equal(run.metrics.retries.byKind.attempt.value, 1);
    const issue = report.issues.find(
      (item) => item.code === "PLAN_TASK_COMPLETION_INVALID"
    );
    assert.deepEqual(issue, {
      runKey: run.runKey,
      attemptKey: null,
      source: "event",
      field: null,
      code: "PLAN_TASK_COMPLETION_INVALID",
      severity: "error"
    });

    const rendered = `${renderEvaluationJson(report)}\n${renderEvaluationMarkdown(report)}`;
    assert.doesNotMatch(rendered, /PRIVATE/);
    assert.doesNotMatch(rendered, /repository\/path/i);
    assert.doesNotMatch(rendered, /missing_task/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("failed review candidate evidence remains diagnostic and never becomes canonical evaluation input", async () => {
  const root = await createEvaluationRoot();
  const failed = evaluationAttemptFixture({
    id: "failed-review-candidate",
    kind: "review",
    status: "failed",
    reviewMode: "full"
  });
  failed.failureCode = "INVALID_REVIEW_ARTIFACT";
  failed.reviewCandidate = {
    source: "reviewer-write",
    evidencePath: "attempts/failed-review-candidate.review-candidate.md",
    intendedArtifactPath: "documentation/features/example/review-1.md",
    sha256: "FORBIDDEN-CANDIDATE-DIGEST",
    validation: "failed",
    validationCode: "INVALID_REVIEW_ARTIFACT",
    validationError: "FORBIDDEN-CANDIDATE-DIAGNOSTIC",
    canonical: false
  };
  const completed = evaluationAttemptFixture({
    id: "successful-review-retry",
    kind: "review",
    status: "completed",
    startedAt: "2026-07-01T00:02:00.000Z",
    reviewMode: "full",
    rotationReason: "previous-review-failed"
  });
  try {
    await writeEvaluationRun(root, "review-candidate-run", {
      state: evaluationStateFixture({
        status: "done",
        attempts: { review: 2 },
        reviews: { full: 2, delta: 0, rotations: 1 },
        reviewIteration: 1
      }),
      attempts: [failed, completed],
      reviews: [
        {
          ordinal: 1,
          value: { verdict: "pass", findings: [] }
        }
      ]
    });
    const attemptsDirectory = path.join(
      root,
      ".banzai",
      "runs",
      "review-candidate-run",
      "attempts"
    );
    await writeFile(
      path.join(
        attemptsDirectory,
        "failed-review-candidate.review-candidate.md"
      ),
      "FORBIDDEN INVALID REVIEW CANDIDATE",
      "utf8"
    );
    await writeFile(
      path.join(attemptsDirectory, "failed-review-candidate-result.json"),
      JSON.stringify({ raw: "FORBIDDEN RAW RESULT" }),
      "utf8"
    );

    const report = await collectEvaluationExport(root, DEFAULT_OPTIONS);
    const run = report.runs[0];
    assert.ok(run);
    assert.equal(run.attempts.length, 2);
    assert.equal(run.metrics.attempts.byOutcome.failed.value, 1);
    assert.equal(run.metrics.reviews.attempts.full.value, 2);
    assert.equal(run.metrics.reviews.verdicts.pass.value, 1);
    const serialized = JSON.stringify(report);
    assert.equal(
      serialized.includes("FORBIDDEN INVALID REVIEW CANDIDATE"),
      false
    );
    assert.equal(serialized.includes("FORBIDDEN-CANDIDATE-DIAGNOSTIC"), false);
    assert.equal(serialized.includes("FORBIDDEN RAW RESULT"), false);
    assert.equal(serialized.includes("FORBIDDEN-CANDIDATE-DIGEST"), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("applies inclusive/exclusive date intersection and stable opaque keys for explicit runs", async () => {
  const root = await createEvaluationRoot();
  try {
    await writeEvaluationRun(root, "a-run-secret", {
      state: evaluationStateFixture({
        createdAt: "2026-07-01T00:00:00.000Z"
      })
    });
    await writeEvaluationRun(root, "z-run-secret", {
      state: evaluationStateFixture({
        createdAt: "2026-07-02T00:00:00.000Z"
      })
    });
    const filtered = await collectEvaluationExport(root, {
      format: "json",
      from: "2026-07-02T00:00:00.000Z",
      to: "2026-07-03T00:00:00.000Z",
      runIds: ["z-run-secret"]
    });
    assert.equal(filtered.runs.length, 1);
    assert.equal(filtered.runs[0]?.runKey, "run-000002");
    assert.equal(filtered.cohort.includedRunCount, 1);
    assert.equal(filtered.cohort.excludedRunCount, 1);

    const exclusive = await collectEvaluationExport(root, {
      format: "json",
      from: null,
      to: "2026-07-02T00:00:00.000Z",
      runIds: []
    });
    assert.deepEqual(
      exclusive.runs.map((run) => run.runKey),
      ["run-000001"]
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("keeps unreadable runs in unfiltered aggregates but excludes date-unresolved runs from filtered aggregates", async () => {
  const root = await createEvaluationRoot();
  const runDirectory = path.join(root, ".banzai", "runs", "unreadable-run");
  try {
    await mkdir(runDirectory, { recursive: true });
    await writeFile(path.join(runDirectory, "state.json"), "{broken", "utf8");

    const unfiltered = await collectEvaluationExport(root, DEFAULT_OPTIONS);
    assert.equal(unfiltered.runs[0]?.cohortMembership, "included");
    assert.equal(unfiltered.aggregates.overall.runCount, 1);
    assert.equal(unfiltered.cohort.unresolvedRunCount, 0);

    const filtered = await collectEvaluationExport(root, {
      ...DEFAULT_OPTIONS,
      from: "2026-07-01T00:00:00.000Z"
    });
    assert.equal(filtered.runs[0]?.cohortMembership, "unresolved");
    assert.equal(filtered.cohort.unresolvedRunCount, 1);
    assert.equal(filtered.aggregates.overall.runCount, 0);
    assert.equal(filtered.aggregates.byWorkflow.unknown.runCount, 0);
    assert.equal(filtered.aggregates.byStatus.unknown.runCount, 0);
    assert.deepEqual(filtered.aggregates.byWorkflowAndStatus, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("counts only review results proven applied by latestReview evidence", async () => {
  const root = await createEvaluationRoot();
  try {
    await writeEvaluationRun(root, "review-evidence", {
      state: evaluationStateFixture({
        reviewIteration: 2,
        appliedReviewIteration: 1,
        reviewFindingCount: 1
      }),
      reviews: [
        {
          ordinal: 1,
          value: {
            verdict: "changes_requested",
            findings: [{ severity: "should_fix" }]
          }
        },
        {
          ordinal: 2,
          value: {
            verdict: "blocked",
            findings: [{ severity: "blocker" }]
          }
        },
        {
          ordinal: 99,
          value: {
            verdict: "blocked",
            findings: [{ severity: "blocker" }]
          }
        }
      ]
    });
    const report = await collectEvaluationExport(root, DEFAULT_OPTIONS);
    const run = report.runs[0];
    assert.ok(run);
    assert.deepEqual(
      run.reviews.map((review) => review.ordinal),
      [1]
    );
    assert.equal(run.metrics.reviews.findings.should_fix.observedSubtotal, 1);
    assert.equal(run.metrics.reviews.findings.blocker.observedSubtotal, 0);
    assert.equal(run.metrics.reviews.findings.blocker.invalidCount, 2);
    assert.ok(run.issueCodes.includes("REVIEW_UNAPPLIED"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("state counters and retained results cannot fabricate physical verification evidence", async () => {
  const root = await createEvaluationRoot();
  try {
    await writeEvaluationRun(root, "state-only", {
      state: evaluationStateFixture({
        attempts: { verification: 3 },
        verification: [
          {
            exitCode: 0,
            signal: null,
            startedAt: "2026-07-01T00:00:00Z",
            completedAt: "2026-07-01T00:00:01Z"
          }
        ]
      })
    });
    const before = await snapshotTree(root);
    const run = (await collectEvaluationExport(root, DEFAULT_OPTIONS)).runs[0];
    assert.ok(run);
    assert.deepEqual(run.verification, []);
    assert.deepEqual(run.verificationEvidence, {
      coverage: "incomplete",
      physicalAttempts: [],
      dispositions: []
    });
    assert.equal(run.metrics.verification.completed.observedSubtotal, 0);
    assert.deepEqual(await snapshotTree(root), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("exports every durable verification round beyond the retained state window in stable sequence order", async () => {
  const root = await createEvaluationRoot();
  const runId = "durable-verification-history";
  const records = [
    verificationAttemptFixture({ sequence: 1, commandOrdinal: 1 }),
    verificationAttemptFixture({ sequence: 2, commandOrdinal: 2 }),
    verificationAttemptFixture({
      sequence: 3,
      roundOrdinal: 2,
      sourceAttemptId: "implementation-2-fixture",
      commandOrdinal: 1
    }),
    verificationAttemptFixture({
      sequence: 4,
      roundOrdinal: 2,
      sourceAttemptId: "implementation-2-fixture",
      commandOrdinal: 2
    })
  ];
  try {
    await writeEvaluationRun(root, runId, {
      state: evaluationStateFixture({
        attempts: { verification: 4 },
        verification: [
          {
            exitCode: 0,
            signal: null,
            startedAt: records[2]?.startedAt,
            completedAt: records[2]?.completedAt
          },
          {
            exitCode: 0,
            signal: null,
            startedAt: records[3]?.startedAt,
            completedAt: records[3]?.completedAt
          }
        ]
      })
    });
    await writeVerificationLedger(root, runId, records);
    const secret = `sk-ant-${"a".repeat(36)}`;
    await writeFile(
      path.join(
        root,
        ".banzai",
        "runs",
        runId,
        "verification-attempts",
        "forbidden.stdout.log"
      ),
      secret,
      "utf8"
    );
    await writeFile(
      path.join(
        root,
        ".banzai",
        "runs",
        runId,
        "attempts",
        "implementation-raw-result.json"
      ),
      JSON.stringify({ result: secret }),
      "utf8"
    );

    const first = await collectEvaluationExport(root, DEFAULT_OPTIONS);
    const second = await collectEvaluationExport(root, DEFAULT_OPTIONS);
    const run = first.runs[0];
    assert.ok(run);
    assert.deepEqual(
      run.verification.map((attempt) => attempt.ordinal),
      [1, 2, 3, 4]
    );
    assert.equal(run.metrics.attempts.byKind.verification.value, 4);
    assert.equal(run.metrics.attempts.total.value, 4);
    assert.equal(run.metrics.verification.retained.value, 2);
    assert.equal(run.metrics.verification.completed.value, 4);
    assert.equal(run.metrics.verification.failed.value, 0);
    assert.equal(run.metrics.durationsMs.verification.value, 4_000);
    assert.equal(
      run.issueCodes.includes("VERIFICATION_LEDGER_MALFORMED"),
      false
    );
    assert.equal(renderEvaluationJson(first), renderEvaluationJson(second));
    assert.doesNotMatch(renderEvaluationJson(first), /sk-ant|forbidden/i);
    assert.doesNotMatch(renderEvaluationMarkdown(first), /sk-ant|forbidden/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("treats an explicit empty durable verification ledger as exact complete zero evidence", async () => {
  const root = await createEvaluationRoot();
  const runId = "durable-verification-empty";
  try {
    await writeEvaluationRun(root, runId, {
      state: evaluationStateFixture({ attempts: { verification: 0 } })
    });
    await writeVerificationLedger(root, runId, []);

    const run = (await collectEvaluationExport(root, DEFAULT_OPTIONS)).runs[0];
    assert.ok(run);
    assert.equal(run.completeness, "complete");
    assert.equal(run.metrics.attempts.byKind.verification.value, 0);
    assert.equal(run.metrics.verification.retained.value, 0);
    assert.equal(run.metrics.verification.completed.value, 0);
    assert.equal(run.metrics.verification.failed.value, 0);
    assert.deepEqual(run.verification, []);
    assert.equal(
      run.issueCodes.includes("VERIFICATION_LEDGER_MALFORMED"),
      false
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("keeps interrupted and restarted durable verification attempts distinct without duplication", async () => {
  const root = await createEvaluationRoot();
  const runId = "verification-restart";
  const interrupted = verificationAttemptFixture({
    sequence: 1,
    status: "interrupted"
  });
  const restarted = verificationAttemptFixture({
    sequence: 2,
    restartOf: interrupted.id
  });
  try {
    await writeEvaluationRun(root, runId, {
      state: evaluationStateFixture({
        attempts: { verification: 2 },
        verification: [
          {
            exitCode: 0,
            signal: null,
            startedAt: restarted.startedAt,
            completedAt: restarted.completedAt
          }
        ]
      })
    });
    await writeVerificationLedger(root, runId, [interrupted, restarted]);

    const run = (await collectEvaluationExport(root, DEFAULT_OPTIONS)).runs[0];
    assert.ok(run);
    assert.deepEqual(
      run.verification.map((attempt) => attempt.status),
      ["interrupted", "completed"]
    );
    assert.equal(run.metrics.attempts.byKind.verification.value, 2);
    assert.equal(run.metrics.attempts.byOutcome.completed.value, 1);
    assert.equal(run.metrics.attempts.byOutcome.failed.value, 1);
    assert.equal(run.metrics.verification.retained.value, 1);
    assert.equal(run.metrics.verification.completed.value, 1);
    assert.equal(run.metrics.verification.failed.value, 1);
    assert.equal(run.metrics.failures.interrupted_attempt.value, 1);
    assert.equal(
      run.issueCodes.includes("VERIFICATION_LEDGER_MALFORMED"),
      false
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("diagnoses malformed durable verification evidence without exporting its raw content", async () => {
  const root = await createEvaluationRoot();
  const runId = "malformed-verification-ledger";
  const secret = "sk-ant-malformed-secret-output";
  try {
    await writeEvaluationRun(root, runId, {
      state: evaluationStateFixture({ attempts: { verification: 1 } })
    });
    await writeVerificationLedger(
      root,
      runId,
      [{ schemaVersion: 1, rawResult: secret }],
      { schemaVersion: 99, token: secret }
    );
    const report = await collectEvaluationExport(root, DEFAULT_OPTIONS);
    const run = report.runs[0];
    assert.ok(run);
    assert.equal(run.completeness, "partial");
    assert.ok(run.issueCodes.includes("VERIFICATION_LEDGER_MALFORMED"));
    assert.ok(run.issueCodes.includes("VERIFICATION_ATTEMPT_MALFORMED"));
    assert.ok(run.issueCodes.includes("VERIFICATION_LEDGER_MALFORMED"));
    assert.equal(run.metrics.attempts.byKind.verification.value, null);
    assert.doesNotMatch(
      renderEvaluationJson(report),
      /sk-ant|malformed-secret/
    );
    assert.doesNotMatch(
      renderEvaluationMarkdown(report),
      /sk-ant|malformed-secret/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("interrupted verification is counted only from its physical ledger leaf", async () => {
  const root = await createEvaluationRoot();
  try {
    await writeEvaluationRun(root, "interrupted-verification", {
      state: evaluationStateFixture({
        status: "blocked",
        attempts: { verification: 1 }
      })
    });
    await writeVerificationLedger(root, "interrupted-verification", [
      verificationAttemptFixture({ sequence: 1, status: "interrupted" })
    ]);
    const report = await collectEvaluationExport(root, DEFAULT_OPTIONS);
    const run = report.runs[0];
    assert.ok(run);
    assert.equal(run.metrics.attempts.total.value, 1);
    assert.equal(run.metrics.attempts.byOutcome.failed.value, 1);
    assert.equal(run.metrics.verification.completed.value, 0);
    assert.equal(run.verification[0]?.status, "interrupted");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("marks stale cumulative verification and unknown or invalid attempt outcomes as partial", async () => {
  const root = await createEvaluationRoot();
  try {
    const unknown = evaluationAttemptFixture({
      id: "unknown-status",
      kind: "implementation"
    });
    delete unknown.status;
    const invalid = evaluationAttemptFixture({
      id: "invalid-status",
      kind: "fix"
    });
    invalid.status = "FORBIDDEN INVALID STATUS";
    await writeEvaluationRun(root, "invalid-coverage", {
      state: evaluationStateFixture({
        status: "verifying",
        attempts: { implementation: 1, fix: 1, verification: 0 },
        extra: {
          activeProcess: {
            pid: 123,
            kind: "verification",
            startedAt: "2026-07-01T00:03:00.000Z"
          }
        }
      }),
      attempts: [unknown, invalid]
    });
    const report = await collectEvaluationExport(root, DEFAULT_OPTIONS);
    const metrics = report.runs[0]?.metrics;
    assert.ok(metrics);
    assert.equal(metrics.attempts.total.value, 2);
    assert.equal(metrics.attempts.total.observedSubtotal, 2);
    assert.equal(metrics.attempts.byKind.verification.observedSubtotal, 0);
    assert.equal(metrics.attempts.byKind.verification.invalidCount, 0);
    for (const outcome of ["completed", "failed"] as const) {
      assert.equal(metrics.attempts.byOutcome[outcome].value, null);
      assert.equal(metrics.attempts.byOutcome[outcome].unknownCount, 1);
      assert.equal(metrics.attempts.byOutcome[outcome].invalidCount, 1);
    }
    assert.equal(metrics.attempts.byOutcome.started.value, null);
    assert.equal(metrics.attempts.byOutcome.started.observedSubtotal, 0);
    assert.equal(metrics.attempts.byOutcome.started.unknownCount, 1);
    assert.equal(metrics.attempts.byOutcome.started.invalidCount, 1);
    assert.ok(report.runs[0]?.issueCodes.includes("STATE_FIELD_INVALID"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("accounts for every review rotation reason and preserves missing or invalid coverage", async () => {
  const root = await createEvaluationRoot();
  try {
    const attempts = EVALUATION_ROTATION_REASON_ORDER.map((reason, index) =>
      evaluationAttemptFixture({
        id: `review-${index}`,
        kind: "review",
        startedAt: `2026-07-01T00:${String(index + 1).padStart(2, "0")}:00.000Z`,
        rotationReason: reason
      })
    );
    attempts.push(
      evaluationAttemptFixture({
        id: "no-rotation",
        kind: "review",
        rotationReason: null
      })
    );
    const missing = evaluationAttemptFixture({
      id: "missing-rotation",
      kind: "review"
    });
    delete missing.rotationReason;
    attempts.push(missing);
    const invalid = evaluationAttemptFixture({
      id: "invalid-rotation",
      kind: "review"
    });
    invalid.rotationReason = "FORBIDDEN INVALID ROTATION";
    attempts.push(
      invalid,
      evaluationAttemptFixture({
        id: "new-contract-rotation",
        kind: "review",
        rotationReason: "output-contract-not-reusable"
      })
    );
    await writeEvaluationRun(root, "rotation-coverage", {
      state: evaluationStateFixture({
        attempts: { review: attempts.length },
        sessions: { fresh: attempts.length, resumed: 0 },
        reviews: {
          full: attempts.length,
          delta: 0,
          rotations: EVALUATION_ROTATION_REASON_ORDER.length - 1
        }
      }),
      attempts
    });
    const rotations = (await collectEvaluationExport(root, DEFAULT_OPTIONS))
      .runs[0]?.metrics.reviews.rotations;
    assert.ok(rotations);
    assert.equal(
      rotations.total.observedSubtotal,
      EVALUATION_ROTATION_REASON_ORDER.length - 1
    );
    assert.equal(rotations.total.unknownCount, 1);
    assert.equal(rotations.total.invalidCount, 2);
    assert.equal(rotations.byReason["primary-review"].observedSubtotal, 0);
    for (const reason of EVALUATION_ROTATION_REASON_ORDER.slice(1)) {
      assert.equal(rotations.byReason[reason].observedSubtotal, 1);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects conflicting duplicate identities and is deterministic across reverse insertion order", async () => {
  const firstRoot = await createEvaluationRoot();
  const secondRoot = await createEvaluationRoot();
  const fixture = (status: "completed" | "failed") => ({
    state: evaluationStateFixture({ attempts: { implementation: 1 } }),
    attempts: [
      evaluationAttemptFixture({
        id: "conflicting-id",
        kind: "implementation",
        status
      }),
      evaluationAttemptFixture({
        id: "conflicting-id",
        kind: "implementation",
        status: status === "completed" ? "failed" : "completed"
      })
    ]
  });
  try {
    await writeEvaluationRun(firstRoot, "b-run", fixture("completed"));
    await writeEvaluationRun(firstRoot, "a-run", {
      state: evaluationStateFixture({ workflow: "feature" })
    });
    await writeEvaluationRun(secondRoot, "a-run", {
      state: evaluationStateFixture({ workflow: "feature" })
    });
    await writeEvaluationRun(secondRoot, "b-run", fixture("failed"));
    const first = await collectEvaluationExport(firstRoot, DEFAULT_OPTIONS);
    const second = await collectEvaluationExport(secondRoot, DEFAULT_OPTIONS);
    assert.deepEqual(first, second);
    assert.equal(renderEvaluationJson(first), renderEvaluationJson(second));
    assert.equal(
      renderEvaluationMarkdown(first),
      renderEvaluationMarkdown(second)
    );
    const conflicting = first.runs[1];
    assert.ok(conflicting);
    assert.equal(conflicting.attempts.length, 0);
    assert.equal(conflicting.metrics.attempts.total.invalidCount, 1);
    assert.ok(conflicting.issueCodes.includes("ATTEMPT_CONFLICT"));
  } finally {
    await rm(firstRoot, { recursive: true, force: true });
    await rm(secondRoot, { recursive: true, force: true });
  }
});

test("treats impossible persisted state, attempt, and verification timestamps as invalid", async () => {
  const root = await createEvaluationRoot();
  try {
    const attempt = evaluationAttemptFixture({
      id: "invalid-date-attempt",
      kind: "implementation"
    });
    attempt.startedAt = "2026-02-30T00:00:00Z";
    attempt.completedAt = "2026-02-30T00:00:01Z";
    await writeEvaluationRun(root, "invalid-dates", {
      state: evaluationStateFixture({
        createdAt: "2026-02-30T00:00:00Z",
        attempts: { implementation: 1, verification: 1 },
        verification: [
          {
            exitCode: 0,
            signal: null,
            startedAt: "2026-02-30T00:00:00Z",
            completedAt: "2026-02-30T00:00:01Z"
          }
        ]
      }),
      attempts: [attempt]
    });
    await writeVerificationLedger(root, "invalid-dates", [
      {
        ...verificationAttemptFixture({ sequence: 1 }),
        startedAt: "2026-02-30T00:00:00Z"
      }
    ]);
    const report = await collectEvaluationExport(root, {
      ...DEFAULT_OPTIONS,
      from: "2026-03-01T00:00:00.000Z"
    });
    const run = report.runs[0];
    assert.ok(run);
    assert.equal(run.cohortMembership, "unresolved");
    assert.equal(report.aggregates.overall.runCount, 0);
    assert.equal(run.createdAt.evidence, "invalid");
    const exportedAttempt = run.attempts[0];
    const verification = run.verification[0];
    assert.ok(exportedAttempt);
    assert.equal(verification, undefined);
    assert.equal(exportedAttempt.startedAt.evidence, "invalid");
    assert.equal(exportedAttempt.completedAt.evidence, "invalid");
    assert.ok(run.issueCodes.includes("VERIFICATION_ATTEMPT_MALFORMED"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("counts invalid contributors once and keeps unrelated verification, categorical, and review metrics known", async () => {
  const root = await createEvaluationRoot();
  try {
    const invalidSession = evaluationAttemptFixture({
      id: "invalid-session",
      kind: "implementation"
    });
    invalidSession.sessionMode = "INVALID SESSION";
    const invalidReviewMode = evaluationAttemptFixture({
      id: "invalid-review-mode",
      kind: "review"
    });
    invalidReviewMode.reviewMode = "INVALID REVIEW MODE";
    await writeEvaluationRun(root, "isolated-invalid-fields", {
      state: evaluationStateFixture({
        attempts: { implementation: 1, review: 1, verification: 2 },
        reviewIteration: 1,
        reviewFindingCount: 1,
        verification: [
          {
            exitCode: 0,
            signal: 42,
            startedAt: "INVALID START",
            completedAt: "INVALID END"
          },
          {
            exitCode: "INVALID EXIT",
            signal: null,
            startedAt: "2026-07-01T00:02:00.000Z",
            completedAt: "2026-07-01T00:02:01.000Z"
          }
        ]
      }),
      attempts: [invalidSession, invalidReviewMode],
      reviews: [
        {
          ordinal: 1,
          value: {
            verdict: "INVALID VERDICT",
            findings: [{ severity: "blocker" }]
          }
        }
      ]
    });

    await writeVerificationLedger(root, "isolated-invalid-fields", [
      verificationAttemptFixture({ sequence: 1 }),
      verificationAttemptFixture({ sequence: 2, status: "failed" })
    ]);
    const run = (await collectEvaluationExport(root, DEFAULT_OPTIONS)).runs[0];
    assert.ok(run);
    assert.equal(run.metrics.verification.retained.value, 2);
    assert.equal(run.metrics.verification.completed.observedSubtotal, 1);
    assert.equal(run.metrics.verification.completed.invalidCount, 0);
    assert.equal(run.metrics.verification.failed.invalidCount, 0);
    assert.equal(run.metrics.attempts.byOutcome.completed.observedSubtotal, 3);
    assert.equal(run.metrics.attempts.byOutcome.completed.invalidCount, 0);
    assert.equal(run.metrics.attempts.byOutcome.failed.observedSubtotal, 1);
    assert.equal(run.metrics.attempts.byOutcome.failed.invalidCount, 0);
    assert.equal(run.metrics.attempts.byOutcome.started.value, 0);
    assert.equal(run.metrics.attempts.byOutcome.started.unknownCount, 0);
    assert.equal(run.metrics.attempts.byOutcome.started.invalidCount, 0);
    assert.equal(run.metrics.durationsMs.verification.observedSubtotal, 2_000);
    assert.equal(run.metrics.durationsMs.verification.invalidCount, 0);
    assert.equal(run.metrics.sessions.unknown.observedSubtotal, 0);
    assert.equal(run.metrics.sessions.unknown.invalidCount, 1);
    assert.equal(run.metrics.reviews.attempts.unknown.observedSubtotal, 0);
    assert.equal(run.metrics.reviews.attempts.unknown.invalidCount, 1);
    assert.equal(run.metrics.reviews.verdicts.pass.invalidCount, 1);
    assert.equal(run.metrics.reviews.findings.blocker.value, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("retains healthy and malformed or incomplete run evidence without survivorship bias", async () => {
  const root = await createEvaluationRoot();
  const runsRoot = path.join(root, ".banzai", "runs");
  try {
    await writeEvaluationRun(root, "a-healthy", {
      state: evaluationStateFixture()
    });
    await mkdir(path.join(runsRoot, "b-malformed-state"), { recursive: true });
    await writeFile(
      path.join(runsRoot, "b-malformed-state", "state.json"),
      "{FORBIDDEN",
      "utf8"
    );
    await mkdir(path.join(runsRoot, "c-invalid-shape"), { recursive: true });
    await writeFile(
      path.join(runsRoot, "c-invalid-shape", "state.json"),
      JSON.stringify([]),
      "utf8"
    );
    await mkdir(path.join(runsRoot, "d-missing-state"), { recursive: true });
    await writeEvaluationRun(root, "e-partial", {
      state: evaluationStateFixture({ reviewIteration: 1 }),
      reviews: [
        {
          ordinal: 1,
          value: { verdict: "pass", findings: "FORBIDDEN-NOT-ARRAY" }
        }
      ]
    });
    await writeFile(
      path.join(runsRoot, "e-partial", "attempts", "broken.json"),
      "not json FORBIDDEN",
      "utf8"
    );
    await writeFile(
      path.join(runsRoot, "e-partial", "events.jsonl"),
      "not json FORBIDDEN\n",
      "utf8"
    );

    const report = await collectEvaluationExport(root, DEFAULT_OPTIONS);
    assert.equal(report.runs.length, 5);
    assert.equal(report.aggregates.overall.runCount, 5);
    assert.equal(report.cohort.unresolvedRunCount, 0);
    assert.equal(report.aggregates.byWorkflow.unknown.runCount, 3);
    assert.equal(report.aggregates.byStatus.unknown.runCount, 3);
    assert.equal(report.runs[0]?.completeness, "complete");
    assert.equal(report.runs[1]?.completeness, "unreadable");
    assert.ok(report.issues.some((issue) => issue.code === "STATE_MALFORMED"));
    assert.ok(report.issues.some((issue) => issue.code === "STATE_MALFORMED"));
    assert.ok(report.issues.some((issue) => issue.code === "STATE_MISSING"));
    assert.ok(
      report.issues.some((issue) => issue.code === "ATTEMPT_MALFORMED")
    );
    assert.ok(
      report.issues.some((issue) => issue.code === "EVENT_LINE_MALFORMED")
    );
    assert.ok(report.issues.some((issue) => issue.code === "REVIEW_MALFORMED"));
    assert.equal(report.aggregates.overall.metrics.attempts.total.value, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("ignores Codex raw result artifacts without changing attempts, coverage, privacy, or bytes", async () => {
  const root = await createEvaluationRoot();
  const runDirectory = path.join(root, ".banzai", "runs", "codex-layout");
  const attemptDirectory = path.join(runDirectory, "attempts");
  const attempts = [
    evaluationAttemptFixture({
      id: "selection-1-610f15d2",
      kind: "selection",
      startedAt: "2026-07-01T00:01:00.000Z"
    }),
    evaluationAttemptFixture({
      id: "plan-1-508c2b91",
      kind: "plan",
      startedAt: "2026-07-01T00:02:00.000Z"
    }),
    evaluationAttemptFixture({
      id: "implementation-1-b694e401",
      kind: "implementation",
      startedAt: "2026-07-01T00:03:00.000Z"
    }),
    evaluationAttemptFixture({
      id: "review-1-72568aef",
      kind: "review",
      startedAt: "2026-07-01T00:04:00.000Z"
    }),
    evaluationAttemptFixture({
      id: "fix-1-a03f34ce",
      kind: "fix",
      startedAt: "2026-07-01T00:05:00.000Z"
    })
  ];
  const rawResultSentinels = [
    "RAW-RESULT-VALID-PRIVACY-SENTINEL",
    "RAW-RESULT-MALFORMED-PRIVACY-SENTINEL"
  ];
  try {
    await writeEvaluationRun(root, "codex-layout", {
      state: evaluationStateFixture({
        attempts: {
          selection: 1,
          plan: 1,
          implementation: 1,
          review: 1,
          fix: 1
        },
        usage: {
          inputTokens: 50,
          cachedInputTokens: 10,
          outputTokens: 15,
          costUsd: 1.25
        },
        sessions: { fresh: 5, resumed: 0 },
        reviews: { full: 1, delta: 0, rotations: 0 }
      })
    });
    for (const attempt of attempts) {
      const attemptIdentity = (attempt.attempt as Record<string, unknown>)
        .id as string;
      const attemptKind = (attempt.attempt as Record<string, unknown>)
        .kind as string;
      const rawResult: Record<string, unknown> =
        attemptKind === "selection"
          ? {
              contractVersion: "1.0.0",
              recommendedWorkflow: "strict",
              confidence: "high",
              reason: rawResultSentinels[0],
              escalationTriggers: []
            }
          : attemptKind === "review"
            ? {
                contractVersion: "1.0.0",
                verdict: "pass",
                summary: rawResultSentinels[0],
                findings: [],
                reviewedFindingIds: [],
                deferredCoverage: []
              }
            : {
                contractVersion: "1.0.0",
                phase: attemptKind,
                outcome: "completed",
                gate: null,
                summary: rawResultSentinels[0],
                artifacts: {
                  description: null,
                  plan: null,
                  adrs: [],
                  implementationReport: null
                },
                touchedPaths: [],
                questions: [],
                resolvedFindingIds: [],
                requestedVerification: []
              };
      await writeFile(
        path.join(attemptDirectory, `${attemptIdentity}-${attemptKind}.json`),
        JSON.stringify(attempt),
        "utf8"
      );
      await writeFile(
        path.join(attemptDirectory, `${attemptIdentity}-result.json`),
        JSON.stringify(rawResult),
        "utf8"
      );
    }
    await writeFile(
      path.join(attemptDirectory, "fix-1-a03f34ce-result.json"),
      `{${rawResultSentinels[1]}`,
      "utf8"
    );

    const before = await snapshotTree(runDirectory);
    const first = await collectEvaluationExport(root, DEFAULT_OPTIONS);
    const second = await collectEvaluationExport(root, DEFAULT_OPTIONS);
    const json = renderEvaluationJson(first);
    const markdown = renderEvaluationMarkdown(first);
    const cliOutput: string[] = [];
    const cliDiagnostics: string[] = [];
    await executeEvaluationExport(root, ["--json"], {
      stdout: (value) => cliOutput.push(value),
      stderr: (value) => cliDiagnostics.push(value)
    });
    await executeEvaluationExport(root, [], {
      stdout: (value) => cliOutput.push(value),
      stderr: (value) => cliDiagnostics.push(value)
    });
    const after = await snapshotTree(runDirectory);
    const run = first.runs[0];
    assert.ok(run);

    assert.deepEqual(after, before);
    assert.equal(renderEvaluationJson(second), json);
    assert.equal(renderEvaluationMarkdown(second), markdown);
    assert.equal(run.completeness, "complete");
    assert.equal(run.attempts.length, 5);
    assert.deepEqual(
      run.attempts.map((attempt) => attempt.kind.value),
      ["selection", "plan", "implementation", "review", "fix"]
    );
    assert.equal(run.metrics.attempts.total.value, 5);
    for (const kind of [
      "selection",
      "plan",
      "implementation",
      "review",
      "fix"
    ] as const) {
      assert.equal(run.metrics.attempts.byKind[kind].value, 1);
      assert.equal(run.metrics.attempts.byKind[kind].invalidCount, 0);
    }
    for (const metric of [
      run.metrics.attempts.total,
      run.metrics.durationsMs.selection,
      run.metrics.durationsMs.planning,
      run.metrics.durationsMs.implementation,
      run.metrics.durationsMs.review,
      run.metrics.durationsMs.fixing,
      run.metrics.sessions.fresh,
      run.metrics.reviews.attempts.full,
      run.metrics.failures.model_attempt,
      run.metrics.failures.interrupted_attempt,
      run.metrics.usage.inputTokens,
      run.metrics.usage.cachedInputTokens,
      run.metrics.usage.outputTokens,
      run.metrics.usage.costUsd
    ]) {
      assert.equal(metric.invalidCount, 0);
    }
    assert.equal(
      first.issues.some((issue) => issue.code === "ATTEMPT_MALFORMED"),
      false
    );
    for (const sentinel of rawResultSentinels) {
      assert.doesNotMatch(json, new RegExp(sentinel));
      assert.doesNotMatch(markdown, new RegExp(sentinel));
      assert.doesNotMatch(cliOutput.join(""), new RegExp(sentinel));
      assert.doesNotMatch(cliDiagnostics.join(""), new RegExp(sentinel));
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("keeps malformed canonical and unknown JSON attempt evidence fail-closed", async () => {
  const root = await createEvaluationRoot();
  const runDirectory = path.join(root, ".banzai", "runs", "fail-closed");
  const attemptDirectory = path.join(runDirectory, "attempts");
  const validAttempt = evaluationAttemptFixture({
    id: "selection-1-610f15d2",
    kind: "selection"
  });
  const sentinels = [
    "MALFORMED-CANONICAL-PRIVACY-SENTINEL",
    "UNKNOWN-JSON-PRIVACY-SENTINEL",
    "IGNORED-RAW-RESULT-PRIVACY-SENTINEL"
  ];
  try {
    await writeEvaluationRun(root, "fail-closed", {
      state: evaluationStateFixture({
        attempts: { selection: 1 },
        usage: {
          inputTokens: 10,
          cachedInputTokens: 2,
          outputTokens: 3,
          costUsd: 0.25
        },
        sessions: { fresh: 1, resumed: 0 }
      })
    });
    await writeFile(
      path.join(attemptDirectory, "selection-1-610f15d2-selection.json"),
      JSON.stringify(validAttempt),
      "utf8"
    );
    await writeFile(
      path.join(attemptDirectory, "plan-1-deadbeef-plan.json"),
      `{${sentinels[0]}`,
      "utf8"
    );
    await writeFile(
      path.join(attemptDirectory, "unexpected.json"),
      JSON.stringify({ raw: sentinels[1] }),
      "utf8"
    );
    await writeFile(
      path.join(attemptDirectory, "fix-1-deadbeef-result.json"),
      `{${sentinels[2]}`,
      "utf8"
    );

    const report = await collectEvaluationExport(root, DEFAULT_OPTIONS);
    const malformedIssues = report.issues.filter(
      (issue) => issue.code === "ATTEMPT_MALFORMED"
    );
    const json = renderEvaluationJson(report);
    const markdown = renderEvaluationMarkdown(report);
    const run = report.runs[0];
    assert.ok(run);

    assert.equal(malformedIssues.length, 2);
    assert.equal(run.completeness, "partial");
    assert.equal(run.attempts.length, 1);
    assert.equal(run.metrics.attempts.total.observedSubtotal, 1);
    assert.equal(run.metrics.attempts.total.invalidCount, 2);
    for (const sentinel of sentinels) {
      assert.doesNotMatch(json, new RegExp(sentinel));
      assert.doesNotMatch(markdown, new RegExp(sentinel));
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("exports malformed workflow selection as invalid while preserving explicit null as unknown", async () => {
  const root = await createEvaluationRoot();
  const runsRoot = path.join(root, ".banzai", "runs");
  try {
    await writeEvaluationRun(root, "a-null-selection", {
      state: evaluationStateFixture({
        extra: { workflowSelection: null }
      })
    });
    await writeEvaluationRun(root, "b-malformed-selection", {
      state: evaluationStateFixture({
        extra: { workflowSelection: 42 }
      })
    });

    const before = await snapshotTree(runsRoot);
    const report = await collectEvaluationExport(root, DEFAULT_OPTIONS);
    const after = await snapshotTree(runsRoot);

    assert.deepEqual(after, before);
    assert.deepEqual(report.runs[0]?.workflow, {
      value: null,
      evidence: "unknown"
    });
    assert.equal(report.runs[0].completeness, "complete");
    assert.deepEqual(report.runs[1]?.workflow, {
      value: null,
      evidence: "invalid"
    });
    assert.equal(report.runs[1].completeness, "partial");
    assert.ok(
      report.issues.some(
        (item) =>
          item.runKey === "run-000002" &&
          item.source === "state" &&
          item.field === "workflowSelection" &&
          item.code === "STATE_FIELD_INVALID" &&
          item.severity === "error"
      )
    );
    assert.equal(report.aggregates.byWorkflow.unknown.runCount, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("missing workflow in state 5 stays unknown without strict inference", async () => {
  const root = await createEvaluationRoot();
  try {
    const state = evaluationStateFixture();
    delete state.workflowSelection;
    await writeEvaluationRun(root, "missing-workflow", { state });
    const before = await snapshotTree(root);
    const report = await collectEvaluationExport(root, DEFAULT_OPTIONS);
    assert.deepEqual(report.runs[0]?.workflow, {
      value: null,
      evidence: "unknown"
    });
    assert.ok(
      report.issues.some(
        (item) =>
          item.code === "STATE_FIELD_MISSING" &&
          item.field === "workflowSelection"
      )
    );
    assert.deepEqual(await snapshotTree(root), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("degrades per-run filesystem read errors while keeping the root runs boundary fatal and read-only", async () => {
  const root = await createEvaluationRoot();
  const runsRoot = path.join(root, ".banzai", "runs");
  const fatalRoot = await createEvaluationRoot();
  try {
    await writeEvaluationRun(root, "a-healthy", {
      state: evaluationStateFixture()
    });
    await writeEvaluationRun(root, "b-state-unreadable", {
      state: evaluationStateFixture()
    });
    await rm(path.join(runsRoot, "b-state-unreadable", "state.json"));
    await mkdir(path.join(runsRoot, "b-state-unreadable", "state.json"));

    await writeEvaluationRun(root, "c-attempts-unreadable", {
      state: evaluationStateFixture({ attempts: { implementation: 1 } })
    });
    await rm(path.join(runsRoot, "c-attempts-unreadable", "attempts"), {
      recursive: true
    });
    await writeFile(
      path.join(runsRoot, "c-attempts-unreadable", "attempts"),
      "not a directory",
      "utf8"
    );

    await writeEvaluationRun(root, "d-reviews-unreadable", {
      state: evaluationStateFixture({ reviewIteration: 1 })
    });
    await rm(path.join(runsRoot, "d-reviews-unreadable", "reviews"), {
      recursive: true
    });
    await writeFile(
      path.join(runsRoot, "d-reviews-unreadable", "reviews"),
      "not a directory",
      "utf8"
    );

    await writeEvaluationRun(root, "e-events-unreadable", {
      state: evaluationStateFixture()
    });
    await rm(path.join(runsRoot, "e-events-unreadable", "events.jsonl"));
    await mkdir(path.join(runsRoot, "e-events-unreadable", "events.jsonl"));

    const before = await snapshotTree(runsRoot);
    const report = await collectEvaluationExport(root, DEFAULT_OPTIONS);
    const after = await snapshotTree(runsRoot);
    assert.deepEqual(after, before);
    assert.equal(report.runs.length, 5);
    assert.equal(report.runs[0]?.completeness, "complete");
    assert.equal(report.runs[1]?.completeness, "unreadable");
    assert.ok(report.issues.some((item) => item.code === "STATE_MALFORMED"));
    assert.ok(report.issues.some((item) => item.code === "ATTEMPT_MALFORMED"));
    assert.ok(report.issues.some((item) => item.code === "REVIEW_MALFORMED"));
    assert.ok(
      report.issues.some((item) => item.code === "EVENT_LINE_MALFORMED")
    );
    assert.equal(report.aggregates.overall.runCount, 5);
    assert.equal(report.aggregates.overall.metrics.attempts.total.value, null);

    await rm(path.join(fatalRoot, ".banzai", "runs"), { recursive: true });
    await writeFile(
      path.join(fatalRoot, ".banzai", "runs"),
      "not a directory",
      "utf8"
    );
    await assert.rejects(
      collectEvaluationExport(fatalRoot, DEFAULT_OPTIONS),
      (error: unknown) =>
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "EVAL_READ_FAILED"
    );
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(fatalRoot, { recursive: true, force: true });
  }
});

test("never exports forbidden persisted prose and leaves the run tree byte-for-byte unchanged", async () => {
  const root = await createEvaluationRoot();
  const runDirectory = path.join(
    root,
    ".banzai",
    "runs",
    "privacy-secret-slug"
  );
  try {
    const state = evaluationStateFixture({
      schemaVersion: 5,
      reviewIteration: 1,
      extra: {
        prompt: "FORBIDDEN-PROMPT",
        reasoning: "FORBIDDEN-REASONING",
        transcript: "FORBIDDEN-TRANSCRIPT",
        credentials: "FORBIDDEN-CREDENTIAL",
        environment: { SECRET: "FORBIDDEN-ENVIRONMENT" },
        humanDecisions: [
          {
            kind: "decision_consultation",
            question: "FORBIDDEN-CONSULTATION-QUESTION",
            option: "FORBIDDEN-CONSULTATION-OPTION",
            recommendation: "FORBIDDEN-CONSULTATION-RECOMMENDATION",
            answer: "FORBIDDEN-CONSULTATION-ANSWER",
            evidence: "/FORBIDDEN/CONSULTATION/EVIDENCE",
            decidedBy: "FORBIDDEN-CONSULTATION-DECIDER",
            requestId: "FORBIDDEN-CONSULTATION-ID"
          }
        ]
      }
    });
    state.contractVersion = "FORBIDDEN CONTRACT VERSION";
    state.status = "FORBIDDEN STATUS";
    state.createdAt = "FORBIDDEN CREATED TIMESTAMP";
    state.updatedAt = "FORBIDDEN UPDATED TIMESTAMP";
    (state.workflowSelection as Record<string, unknown>).workflow =
      "FORBIDDEN WORKFLOW";
    const attempt = evaluationAttemptFixture({
      id: "FORBIDDEN-ATTEMPT-ID",
      kind: "review"
    });
    (attempt.attempt as Record<string, unknown>).kind = "FORBIDDEN KIND";
    attempt.status = "FORBIDDEN STATUS";
    attempt.startedAt = "FORBIDDEN STARTED TIMESTAMP";
    attempt.completedAt = "FORBIDDEN COMPLETED TIMESTAMP";
    attempt.sessionMode = "FORBIDDEN SESSION MODE";
    attempt.reviewMode = "FORBIDDEN REVIEW MODE";
    attempt.rotationReason = "FORBIDDEN ROTATION REASON";
    const sessionContext = attempt.sessionContext as Record<string, unknown>;
    sessionContext.executable = "FORBIDDEN EXECUTABLE";
    sessionContext.model = "FORBIDDEN MODEL ID";
    sessionContext.effort = "FORBIDDEN EFFORT";
    await writeEvaluationRun(root, "privacy-secret-slug", {
      state,
      attempts: [attempt],
      events: [
        {
          type: "FORBIDDEN EVENT TYPE",
          output: "FORBIDDEN-COMMAND-OUTPUT"
        },
        {
          type: "decision.consultation.answered",
          details: {
            cardCount: 1,
            answerModes: { option: 1, preference: 0 },
            completion: "answered",
            answer: "FORBIDDEN-EVENT-CONSULTATION-ANSWER"
          }
        }
      ],
      reviews: [
        {
          ordinal: 1,
          value: {
            verdict: "FORBIDDEN REVIEW VERDICT",
            summary: "FORBIDDEN REVIEW SUMMARY",
            findings: [
              {
                severity: "blocker",
                summary: "FORBIDDEN FINDING SUMMARY"
              }
            ]
          }
        }
      ]
    });
    await mkdir(path.join(runDirectory, "logs"), { recursive: true });
    await writeFile(
      path.join(runDirectory, "logs", "raw.log"),
      "FORBIDDEN-RAW-LOG",
      "utf8"
    );
    const before = await snapshotTree(path.join(root, ".banzai", "runs"));
    const report = await collectEvaluationExport(root, DEFAULT_OPTIONS);
    const json = renderEvaluationJson(report);
    const markdown = renderEvaluationMarkdown(report);
    const kpi = deriveEvaluationKpiReport([{ label: "current", report }]);
    const kpiJson = renderEvaluationKpiJson(kpi);
    const kpiMarkdown = renderEvaluationKpiMarkdown(kpi);
    assert.equal(report.schema, "banzai-evaluation-export/v2");
    assert.equal(report.schemaVersion, 2);
    assert.equal(kpi.schema, "banzai-evaluation-kpi/v2");
    assert.equal(kpi.schemaVersion, 2);
    assert.equal(JSON.stringify(kpi).includes("consultation"), false);
    const cliOutput: string[] = [];
    const cliDiagnostics: string[] = [];
    await executeEvaluationExport(root, ["--json"], {
      stdout: (value) => cliOutput.push(value),
      stderr: (value) => cliDiagnostics.push(value)
    });
    const after = await snapshotTree(path.join(root, ".banzai", "runs"));
    assert.deepEqual(after, before);
    for (const forbidden of [
      "privacy-secret-slug",
      "FORBIDDEN-RUN-ID",
      "FORBIDDEN-FEATURE-SLUG",
      "FORBIDDEN-REQUEST-TEXT",
      "FORBIDDEN-PROMPT",
      "FORBIDDEN-REASONING",
      "FORBIDDEN-TRANSCRIPT",
      "FORBIDDEN-CREDENTIAL",
      "FORBIDDEN-ENVIRONMENT",
      "FORBIDDEN-ATTEMPT-ID",
      "FORBIDDEN-COMMAND-OUTPUT",
      "FORBIDDEN-RAW-LOG",
      "FORBIDDEN CONTRACT VERSION",
      "FORBIDDEN STATUS",
      "FORBIDDEN CREATED TIMESTAMP",
      "FORBIDDEN UPDATED TIMESTAMP",
      "FORBIDDEN WORKFLOW",
      "FORBIDDEN KIND",
      "FORBIDDEN STARTED TIMESTAMP",
      "FORBIDDEN COMPLETED TIMESTAMP",
      "FORBIDDEN SESSION MODE",
      "FORBIDDEN REVIEW MODE",
      "FORBIDDEN ROTATION REASON",
      "FORBIDDEN EXECUTABLE",
      "FORBIDDEN MODEL ID",
      "FORBIDDEN EFFORT",
      "FORBIDDEN-CONSULTATION-QUESTION",
      "FORBIDDEN-CONSULTATION-OPTION",
      "FORBIDDEN-CONSULTATION-RECOMMENDATION",
      "FORBIDDEN-CONSULTATION-ANSWER",
      "/FORBIDDEN/CONSULTATION/EVIDENCE",
      "FORBIDDEN-CONSULTATION-DECIDER",
      "FORBIDDEN-CONSULTATION-ID",
      "FORBIDDEN-EVENT-CONSULTATION-ANSWER",
      "FORBIDDEN EVENT TYPE",
      "FORBIDDEN REVIEW VERDICT",
      "FORBIDDEN REVIEW SUMMARY",
      "FORBIDDEN FINDING SUMMARY",
      "/FORBIDDEN/REPOSITORY/PATH"
    ]) {
      assert.doesNotMatch(json, new RegExp(forbidden.replaceAll("/", "\\/")));
      assert.doesNotMatch(
        markdown,
        new RegExp(forbidden.replaceAll("/", "\\/"))
      );
      assert.doesNotMatch(
        cliOutput.join("") + cliDiagnostics.join(""),
        new RegExp(forbidden.replaceAll("/", "\\/"))
      );
      assert.doesNotMatch(
        kpiJson,
        new RegExp(forbidden.replaceAll("/", "\\/"))
      );
      assert.doesNotMatch(
        kpiMarkdown,
        new RegExp(forbidden.replaceAll("/", "\\/"))
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
