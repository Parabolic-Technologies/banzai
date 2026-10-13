import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { RunStore } from "../src/store.js";
import { WorkflowRunner } from "../src/workflow.js";
import {
  effectiveResultSourceIdentities,
  parseResultDigestEvidence
} from "../src/validation.js";
import {
  evidenceDigest,
  parseTaskVerificationCandidates
} from "../src/verification-evidence.js";
import type {
  AttemptReference,
  PhaseResult,
  ResultDigestEvidence,
  RunState,
  VendorAdapters
} from "../src/types.js";
import { commitAll, createTestRepository } from "./helpers.js";
import {
  assertTrace,
  assertTraceComplete,
  observeEligibility,
  recordPersistence,
  rewriteRunState
} from "./characterization-trace.js";

const SECRET = "private-source-canary";
const checkSource = (exitCode = 0) =>
  `console.log("checked");\n// ${SECRET}\nprocess.exit(${exitCode});\n`;
const CHECK_SOURCE = checkSource();

type Mode = "match" | "mismatch" | "oversize" | "absent-source";

const wrap = <T>(result: T) => ({
  result,
  sessionId: null,
  stdout: "",
  stderr: "",
  usage: null
});

function liteResult(
  work: string,
  sources: { path: string; sha256: string }[]
): PhaseResult {
  return {
    schemaVersion: 4,
    contractVersion: "1.0.0",
    phase: "implementation",
    outcome: "completed",
    gate: null,
    summary: "Implemented.",
    artifacts: {
      description: null,
      plan: null,
      adrs: [],
      implementationReport: work,
      testReport: null
    },
    taskCompletion: null,
    touchedPaths: ["check.cjs"],
    questions: [],
    decisionConsultation: null,
    resolvedFindingIds: [],
    requestedVerification: [],
    verificationCandidates: {
      checks: [
        {
          id: "check",
          name: "Check local behavior",
          requirementRefs: ["request"],
          command: process.execPath,
          args: ["check.cjs"],
          cwd: ".",
          timeoutMs: 5000,
          evidence: "fresh",
          sources,
          materialization: null
        }
      ],
      absenceReason: null
    }
  };
}

/**
 * A lite run whose single proposed check pins one source. `modes` is consumed
 * one entry per implementation attempt, so a rejected attempt can be followed
 * by a corrected one through the authorized repair.
 */
/** A schema-4 project policy carrying one mandatory check of its own. */
async function writeMandatoryPolicy(root: string): Promise<void> {
  const configPath = path.join(root, ".banzai", "config.json");
  const config = JSON.parse(await readFile(configPath, "utf8")) as Record<
    string,
    unknown
  >;
  await writeFile(
    configPath,
    `${JSON.stringify(
      {
        schemaVersion: 4,
        contractVersion: config.contractVersion,
        models: config.models,
        claudeEnvironment: config.claudeEnvironment,
        context: config.context,
        maxFixCycles: config.maxFixCycles,
        verification: {
          policy: {
            schema: "banzai-task-verification-policy/v1",
            schemaVersion: 1,
            required: [
              {
                id: "mandatory",
                name: "Mandatory project check",
                requirementRefs: ["project-rule"],
                command: process.execPath,
                args: ["-e", "process.exit(0)"],
                cwd: ".",
                timeoutMs: 5000,
                evidence: "fresh",
                sources: [],
                materialization: null
              }
            ],
            denied: [],
            limits: {
              timeoutMs: 60000,
              workingDirectories: ["."],
              requiredContext: "inherited-local"
            },
            reuse: null
          }
        }
      },
      null,
      2
    )}\n`
  );
}

async function fixture(modes: Mode[], checkExit = 0, mandatory = false) {
  const repository = await createTestRepository({ artifactLayout: "private" });
  if (mandatory) await writeMandatoryPolicy(repository.root);
  const queue = [...modes];
  let phases = 0;
  const adapters: VendorAdapters = {
    preflightCodex: async () => {},
    preflightClaude: async () => {},
    runSelection: async () =>
      wrap({
        contractVersion: "1.0.0",
        recommendedWorkflow: "feature",
        confidence: "high",
        reason: "Verify local behavior.",
        escalationTriggers: []
      }),
    runReview: async () => {
      throw new Error("Unexpected lite review.");
    },
    runPhase: async (request) => {
      phases++;
      const mode = queue.shift() ?? "match";
      const state = JSON.parse(
        await readFile(path.join(request.runDirectory, "state.json"), "utf8")
      ) as RunState;
      const work = state.artifactBinding?.binding.artifacts.work;
      assert.ok(work);
      await writeFile(
        path.join(repository.root, work),
        "# Work\nVerify the requested local behavior.\n"
      );
      await writeFile(
        path.join(repository.root, "check.cjs"),
        checkSource(checkExit)
      );
      if (mode === "oversize") {
        await writeFile(
          path.join(repository.root, "large.txt"),
          Buffer.alloc(1024 * 1024 + 1, 97)
        );
      }
      const sources =
        mode === "oversize"
          ? [
              {
                path: "large.txt",
                sha256: createHash("sha256")
                  .update(Buffer.alloc(1024 * 1024 + 1, 97))
                  .digest("hex")
              }
            ]
          : mode === "absent-source"
            ? [{ path: "never-written.txt", sha256: "b".repeat(64) }]
            : [
                {
                  path: "check.cjs",
                  sha256:
                    mode === "match"
                      ? evidenceDigest(checkSource(checkExit))
                      : "a".repeat(64)
                }
              ];
      const result = liteResult(work, sources);
      await request.onTerminalSuccess?.({
        classification: "codex_turn_completed",
        observedAt: new Date().toISOString(),
        result,
        sessionId: null,
        usage: null
      });
      return wrap(result);
    }
  };
  return {
    repository,
    runner: new WorkflowRunner(repository.root, adapters),
    store: new RunStore(repository.root),
    phases: () => phases
  };
}

test("a fabricated source digest is rejected when the result is accepted, naming the field, path and both digests", async () => {
  const f = await fixture(["mismatch"]);
  try {
    const blocked = await f.runner.start({
      slug: "digest",
      request: "Verify local behavior."
    });
    assert.equal(blocked.status, "blocked");
    assert.equal(blocked.blockedFrom, "implementing");
    const reason = blocked.blockReason ?? "";
    assert.match(reason, /verificationCandidates\.checks\[check\]/);
    assert.match(reason, /check\.cjs/);
    assert.match(reason, new RegExp("a".repeat(64)));
    assert.match(reason, new RegExp(evidenceDigest(CHECK_SOURCE)));
    // FR10: paths, digests and sizes only.
    assert.doesNotMatch(reason, new RegExp(SECRET));
    // AC6: nothing executed and nothing recorded as a result.
    assert.equal(blocked.taskVerification, undefined);
    assert.deepEqual(blocked.verification, []);

    const rejectedAttempt = blocked.activeAttempt;
    assert.ok(rejectedAttempt);
    const evidence = await f.store.readResultDigestEvidenceIfExists(
      blocked.runId,
      rejectedAttempt
    );
    assert.ok(evidence);
    assert.equal(evidence.outcome, "rejected");
    const [comparison] = evidence.comparisons;
    assert.ok(comparison);
    assert.equal(comparison.role, "precondition");
    assert.equal(comparison.matched, false);
    assert.equal(comparison.observed, evidenceDigest(CHECK_SOURCE));
  } finally {
    await f.repository.dispose();
  }
});

test("a rejected result is repaired through an authorized linked attempt, keeping the rejected attempt as evidence", async () => {
  const f = await fixture(["mismatch", "match"]);
  try {
    const blocked = await f.runner.start({
      slug: "repair",
      request: "Verify local behavior."
    });
    assert.equal(blocked.status, "blocked");
    const rejectedAttempt = blocked.activeAttempt;
    assert.ok(rejectedAttempt);

    const status = await f.runner.status();
    // AC4: the stated next action leads to the repair, never to a replay.
    assert.equal(status.nextAction, "banzai recover");
    assert.equal(status.recovery.eligible, true, status.recovery.reason);
    assert.equal(status.recovery.sourceKind, "digest_rejected");
    assert.equal(status.recovery.phase, "implementation");
    assert.equal(status.recovery.attemptId, rejectedAttempt.id);
    assert.ok(status.recovery.recoveryIdentity);

    const done = await f.runner.recover({
      attemptId: rejectedAttempt.id,
      recoveryIdentity: status.recovery.recoveryIdentity,
      unknownSideEffectsAccepted: true,
      decidedBy: "tests"
    });
    assert.equal(done.status, "done", done.blockReason ?? undefined);
    assert.equal(f.phases(), 2);

    const attempts = await f.store.readRunAttempts(done.runId);
    const rejected = attempts.find(
      (item) => item.attempt.id === rejectedAttempt.id
    );
    assert.ok(rejected);
    assert.equal(rejected.status, "failed");
    assert.equal(rejected.failureCode, "RESULT_DIGEST_REJECTED");
    assert.notEqual(rejected.result, null);
    const successor = attempts.find(
      (item) => item.recoveryOf === rejectedAttempt.id
    );
    assert.ok(successor, "the replacement attempt links to the rejected one");
    assert.equal(successor.attempt.kind, "implementation");
  } finally {
    await f.repository.dispose();
  }
});

test("a mandatory project obligation does not permit continuing without the rejected candidates", async () => {
  const f = await fixture(["mismatch"], 0, true);
  try {
    const blocked = await f.runner.start({
      slug: "mandatory",
      request: "Verify local behavior."
    });
    assert.equal(blocked.status, "blocked");
    assert.equal(blocked.blockedFrom, "implementing");
    assert.match(blocked.blockReason ?? "", /check\.cjs/);
    // AC10: no check executed and no passed, advisory or reused result exists,
    // even though the project policy carries a mandatory obligation.
    assert.equal(blocked.taskVerification, undefined);
    assert.deepEqual(blocked.verification, []);
  } finally {
    await f.repository.dispose();
  }
});

test("a rejected result with no terminal checkpoint is refused because its side effects are unknown", async () => {
  const f = await fixture(["mismatch"]);
  try {
    const blocked = await f.runner.start({
      slug: "unproven",
      request: "Verify local behavior."
    });
    const rejectedAttempt = blocked.activeAttempt;
    assert.ok(rejectedAttempt);
    // Without terminal proof the attempt's repository changes are unknown
    // rather than complete, so no repair path may open for it.
    await rm(f.store.terminalCheckpointPath(blocked.runId, rejectedAttempt));
    const status = await f.runner.status();
    assert.equal(status.recovery.eligible, false);
    assert.match(status.recovery.reason, /side effects are unknown/);
    assert.equal(status.retry.eligible, false, status.retry.reason);
    assert.equal(status.nextAction, "banzai cancel");
  } finally {
    await f.repository.dispose();
  }
});

test("a source above the permitted size is reported with the limit and its size, distinguishably from a mismatch", async () => {
  const f = await fixture(["oversize"]);
  try {
    const blocked = await f.runner.start({
      slug: "oversize",
      request: "Verify local behavior."
    });
    assert.equal(blocked.status, "blocked");
    const reason = blocked.blockReason ?? "";
    // ADR-0051 item 6: both numbers, and never a mismatch claim.
    assert.match(reason, /1048577 bytes, above the 1048576-byte limit/);
    assert.match(reason, /large\.txt/);
    assert.doesNotMatch(reason, /hash to/);
    const rejected = blocked.activeAttempt;
    assert.ok(rejected);
    const evidence = await f.store.readResultDigestEvidenceIfExists(
      blocked.runId,
      rejected
    );
    const [comparison] = evidence?.comparisons ?? [];
    assert.ok(comparison);
    assert.equal(comparison.size, 1048577);
    assert.equal(comparison.limit, 1048576);
  } finally {
    await f.repository.dispose();
  }
});

test("the longest identity the contract permits is recorded rather than refused", () => {
  // The recorded field embeds the check id and the source path, so its bound
  // must admit every identity parseTaskVerificationDescriptor accepts.
  const id = "a".repeat(80);
  const source = `${"d/".repeat(246)}file.txt`;
  assert.equal(source.length, 500);
  const candidates = parseTaskVerificationCandidates({
    checks: [
      {
        id,
        name: "Longest permitted identity",
        requirementRefs: ["request"],
        command: process.execPath,
        args: ["-e", "process.exit(0)"],
        cwd: ".",
        timeoutMs: 5000,
        evidence: "fresh",
        sources: [{ path: source, sha256: evidenceDigest(CHECK_SOURCE) }],
        materialization: null
      }
    ],
    absenceReason: null
  });
  const [identity] = effectiveResultSourceIdentities(candidates, []);
  assert.ok(identity);
  assert.ok(
    identity.field.length > 600,
    "the identity must exceed the bound that used to reject it"
  );
  const recorded = parseResultDigestEvidence({
    schema: "banzai-result-digest-evidence/v1",
    schemaVersion: 1,
    runId: "run",
    attempt: { id: "attempt", kind: "implementation" },
    outcome: "accepted",
    comparisons: [
      {
        role: "precondition",
        field: identity.field,
        checkId: identity.checkId,
        path: identity.path,
        declared: identity.declared,
        observed: identity.declared,
        size: 3,
        limit: null,
        matched: true
      }
    ]
  });
  assert.equal(recorded.comparisons[0]?.field, identity.field);
});

test("a source that cannot be resolved is neither a mismatch claim nor a size claim", async () => {
  const f = await fixture(["absent-source"]);
  try {
    const blocked = await f.runner.start({
      slug: "absent",
      request: "Verify local behavior."
    });
    assert.equal(blocked.status, "blocked");
    assert.match(blocked.blockReason ?? "", /an unreadable source/);
    assert.match(blocked.blockReason ?? "", /never-written\.txt/);
  } finally {
    await f.repository.dispose();
  }
});

for (const baseline of ["present", "absent", "unrelated"] as const) {
  test(`a launch-time mismatch states its causal history from a ${baseline} acceptance baseline`, async () => {
    const f = await fixture(["match"], 7);
    try {
      const blocked = await f.runner.start({
        slug: `history-${baseline}`,
        request: "Verify local behavior."
      });
      assert.equal(blocked.status, "blocked");
      assert.equal(blocked.blockedFrom, "verifying");
      const accepted = (await f.store.readRunAttempts(blocked.runId)).find(
        (item) => item.attempt.kind === "implementation"
      );
      assert.ok(accepted);
      const evidencePath = f.store.resultDigestEvidencePath(
        blocked.runId,
        accepted.attempt
      );
      if (baseline === "absent") {
        // A run blocked before acceptance-time comparison existed has no
        // record; none is reconstructed from the bytes on disk now.
        await rm(evidencePath);
      } else if (baseline === "unrelated") {
        // A record that never covered this identity establishes no cause
        // either, so it must not be read as proof the digest never matched.
        const current = JSON.parse(
          await readFile(evidencePath, "utf8")
        ) as ResultDigestEvidence;
        await rm(evidencePath);
        await writeFile(
          evidencePath,
          `${JSON.stringify(
            {
              ...current,
              comparisons: current.comparisons.map((entry) => ({
                ...entry,
                path: "other.cjs",
                field: entry.field.replace("check.cjs", "other.cjs")
              }))
            },
            null,
            2
          )}\n`
        );
      }
      await writeFile(
        path.join(f.repository.root, "check.cjs"),
        `${checkSource(7)}// edited\n`
      );
      const rejected = await f.runner.retry();
      assert.equal(rejected.status, "blocked");
      const reason = rejected.blockReason ?? "";
      assert.match(reason, /check\.cjs/);
      if (baseline === "present") {
        assert.match(reason, /changed after acceptance/);
        assert.doesNotMatch(reason, /unknown/);
      } else {
        assert.match(reason, /no acceptance baseline.*unknown/);
        assert.doesNotMatch(reason, /changed after acceptance/);
        assert.doesNotMatch(reason, /never matched/);
      }
      assert.doesNotMatch(reason, new RegExp(SECRET));

      // FR5: an action is offered only when it can change the condition. A
      // recorded match makes the bytes restorable, so retry stays available;
      // an unestablished history leaves cancelling as the honest remainder.
      const status = await f.runner.status();
      if (baseline === "present") {
        assert.equal(status.retry.eligible, true, status.retry.reason);
        assert.equal(status.nextAction, "banzai retry");
      } else {
        assert.equal(status.retry.eligible, false, status.retry.reason);
        assert.match(status.retry.reason, /fails identically/);
        assert.equal(status.nextAction, "banzai cancel");
      }
    } finally {
      await f.repository.dispose();
    }
  });
}

test("an accepted result records its acceptance baseline, and removing it leaves no baseline", async () => {
  const f = await fixture(["match"]);
  try {
    const done = await f.runner.start({
      slug: "drift",
      request: "Verify local behavior."
    });
    assert.equal(done.status, "done", done.blockReason ?? undefined);
    const attempts = await f.store.readRunAttempts(done.runId);
    const accepted = attempts.find(
      (item) => item.attempt.kind === "implementation"
    );
    assert.ok(accepted);
    const baseline = await f.store.readResultDigestEvidenceIfExists(
      done.runId,
      accepted.attempt
    );
    assert.ok(baseline);
    assert.equal(baseline.outcome, "accepted");
    const [comparison] = baseline.comparisons;
    assert.ok(comparison);
    assert.equal(comparison.matched, true);
    assert.equal(comparison.path, "check.cjs");
    assert.equal(comparison.declared, evidenceDigest(CHECK_SOURCE));
    assert.equal(comparison.observed, comparison.declared);

    const evidencePath = f.store.resultDigestEvidencePath(
      done.runId,
      accepted.attempt
    );
    await stat(evidencePath);
    await rm(evidencePath);
    assert.equal(
      await f.store.readResultDigestEvidenceIfExists(
        done.runId,
        accepted.attempt
      ),
      null
    );
  } finally {
    await f.repository.dispose();
  }
});

test("malformed digest evidence is reported rather than resolved in either direction", async () => {
  const f = await fixture(["match"]);
  try {
    const done = await f.runner.start({
      slug: "malformed",
      request: "Verify local behavior."
    });
    const attempts = await f.store.readRunAttempts(done.runId);
    const accepted = attempts.find(
      (item) => item.attempt.kind === "implementation"
    );
    assert.ok(accepted);
    const evidencePath = f.store.resultDigestEvidencePath(
      done.runId,
      accepted.attempt
    );
    await rm(evidencePath);
    await writeFile(evidencePath, "{ not json");
    await assert.rejects(
      f.store.readResultDigestEvidenceIfExists(done.runId, accepted.attempt),
      /RESULT_DIGEST_EVIDENCE_INVALID|malformed/i
    );
  } finally {
    await f.repository.dispose();
  }
});

test("an established baseline is never restated by a later comparison", async () => {
  const f = await fixture(["match"]);
  try {
    const done = await f.runner.start({
      slug: "stable",
      request: "Verify local behavior."
    });
    const attempts = await f.store.readRunAttempts(done.runId);
    const accepted = attempts.find(
      (item) => item.attempt.kind === "implementation"
    );
    assert.ok(accepted);
    const first = await f.store.readResultDigestEvidenceIfExists(
      done.runId,
      accepted.attempt
    );
    assert.ok(first);
    const rewritten: ResultDigestEvidence = {
      ...first,
      outcome: "rejected",
      comparisons: first.comparisons.map((comparison) => ({
        ...comparison,
        observed: "c".repeat(64),
        matched: false
      }))
    };
    assert.deepEqual(
      await f.store.establishResultDigestEvidence(done.runId, rewritten),
      first
    );
  } finally {
    await f.repository.dispose();
  }
});

const PLAN_BODY =
  "# Plan\n\n## Implementation Tasks\n\n- [ ] **T001 - Implement the fixture**\n";

function planMarkdown(pin: "correct" | "fabricated"): string {
  const before = PLAN_BODY;
  const after = "\n";
  return (
    before +
    "```banzai-verification-obligations/v2\n" +
    JSON.stringify({
      schema: "banzai-verification-obligations/v2",
      schemaVersion: 2,
      complete: true,
      planRemainderSha256:
        pin === "correct" ? evidenceDigest(before + after) : "a".repeat(64),
      checks: [],
      absenceReason: "The fixture task is verified by inspection."
    }) +
    "\n```" +
    after
  );
}

const UNAVAILABLE_IMPLEMENTER_MODEL = "implementer-unavailable";

/** Gives the implementer a distinct model so a refused preflight is attributable. */
async function markImplementerUnavailable(root: string): Promise<void> {
  const configPath = path.join(root, ".banzai", "config.json");
  const config = JSON.parse(await readFile(configPath, "utf8")) as {
    models: { implementer: { model: string } };
  };
  config.models.implementer.model = UNAVAILABLE_IMPLEMENTER_MODEL;
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
}

/** A strict run whose planner pins the plan remainder digest per attempt. */
async function strictFixture(
  pins: ("correct" | "fabricated")[],
  refuseImplementer = false
) {
  const repository = await createTestRepository({ artifactLayout: "private" });
  if (refuseImplementer) await markImplementerUnavailable(repository.root);
  const queue = [...pins];
  let planAttempts = 0;
  let implementerPreflights = 0;
  const refuseUnavailable = async (settings: { model: string | null }) => {
    if (settings.model !== UNAVAILABLE_IMPLEMENTER_MODEL) return;
    implementerPreflights++;
    throw new Error("Vendor subscription authentication is unavailable.");
  };
  const adapters: VendorAdapters = {
    preflightCodex: refuseUnavailable,
    preflightClaude: refuseUnavailable,
    runSelection: async () =>
      wrap({
        contractVersion: "1.0.0",
        recommendedWorkflow: "strict",
        confidence: "high",
        reason: "Escalated by the fixture.",
        escalationTriggers: ["architecture"]
      }),
    runReview: async () => {
      throw new Error("Unexpected review.");
    },
    runPhase: async (request) => {
      planAttempts++;
      const state = JSON.parse(
        await readFile(path.join(request.runDirectory, "state.json"), "utf8")
      ) as RunState;
      const roles = state.artifactBinding?.binding.artifacts;
      assert.ok(roles?.plan && roles.description);
      await writeFile(
        path.join(repository.root, roles.description),
        "# Description\n\nFR1.\n"
      );
      await writeFile(
        path.join(repository.root, roles.plan),
        planMarkdown(queue.shift() ?? "correct")
      );
      const result: PhaseResult = {
        schemaVersion: 4,
        contractVersion: "1.0.0",
        phase: "plan",
        outcome: "needs_human_decision",
        gate: "plan_approval",
        summary: "Plan ready.",
        artifacts: {
          description: roles.description,
          plan: roles.plan,
          adrs: [],
          implementationReport: null,
          testReport: null
        },
        taskCompletion: null,
        touchedPaths: [roles.plan],
        questions: [],
        decisionConsultation: null,
        resolvedFindingIds: [],
        requestedVerification: [],
        verificationCandidates: null
      };
      await request.onTerminalSuccess?.({
        classification: "codex_turn_completed",
        observedAt: new Date().toISOString(),
        result,
        sessionId: null,
        usage: null
      });
      return wrap(result);
    }
  };
  return {
    repository,
    runner: new WorkflowRunner(repository.root, adapters),
    store: new RunStore(repository.root),
    planAttempts: () => planAttempts,
    implementerPreflights: () => implementerPreflights
  };
}

test("a fabricated plan remainder digest is rejected at acceptance and repaired through an authorized planning attempt", async () => {
  const f = await strictFixture(["fabricated", "correct"]);
  try {
    const blocked = await f.runner.start({
      slug: "plan-digest",
      request: "Escalate this change."
    });
    assert.equal(blocked.status, "blocked");
    assert.equal(blocked.blockedFrom, "planning");
    const reason = blocked.blockReason ?? "";
    assert.match(reason, /planRemainderSha256/);
    assert.match(reason, new RegExp("a".repeat(64)));
    assert.doesNotMatch(reason, /could not be read/);
    assert.doesNotMatch(reason, /Implementation Tasks/);
    // A planning result never gains a strict plan-task completion ledger.
    assert.equal(blocked.planTaskCompletion, null);

    const rejected = blocked.activeAttempt;
    assert.ok(rejected);
    assert.equal(
      (await f.store.readResultDigestEvidenceIfExists(blocked.runId, rejected))
        ?.outcome,
      "rejected"
    );

    const status = await f.runner.status();
    assert.equal(status.nextAction, "banzai recover");
    assert.equal(status.recovery.eligible, true, status.recovery.reason);
    assert.equal(status.recovery.sourceKind, "digest_rejected");
    assert.equal(status.recovery.phase, "plan");
    assert.ok(status.recovery.recoveryIdentity);

    const repaired = await f.runner.recover({
      attemptId: rejected.id,
      recoveryIdentity: status.recovery.recoveryIdentity,
      unknownSideEffectsAccepted: true,
      decidedBy: "tests"
    });
    // AC11: ordinary plan approval becomes reachable, through the same gate.
    assert.equal(
      repaired.status,
      "needs_plan_approval",
      repaired.blockReason ?? undefined
    );
    assert.equal(f.planAttempts(), 2);
    const attempts = await f.store.readRunAttempts(repaired.runId);
    const source = attempts.find((item) => item.attempt.id === rejected.id);
    assert.ok(source);
    assert.equal(source.status, "failed");
    assert.notEqual(source.result, null);
    assert.ok(
      attempts.some((item) => item.recoveryOf === rejected.id),
      "the replacement planning attempt links to the rejected one"
    );
    assert.ok(repaired.recovery);
    const authorization = await f.store.readRecoveryAuthorization(
      repaired.runId,
      repaired.recovery.authorizationId
    );
    assert.equal(authorization.phase, "plan");
    assert.equal(authorization.attempt.kind, "plan");
    assert.equal(authorization.attempt.mutable, false);
    assert.equal(authorization.unknownSideEffectsAccepted, true);
  } finally {
    await f.repository.dispose();
  }
});

test("a planning repair is not gated on the implementer vendor it never runs", async () => {
  const f = await strictFixture(["fabricated", "correct"], true);
  try {
    const blocked = await f.runner.start({
      slug: "plan-digest-preflight",
      request: "Escalate this change."
    });
    assert.equal(blocked.status, "blocked");
    const rejected = blocked.activeAttempt;
    assert.ok(rejected);
    const status = await f.runner.status();
    assert.equal(status.recovery.eligible, true, status.recovery.reason);
    assert.equal(status.recovery.phase, "plan");
    assert.ok(status.recovery.recoveryIdentity);
    // FR13/AC11: the repair runs the planner, so an unavailable implementer
    // must not stand between the operator and a corrected plan.
    const repaired = await f.runner.recover({
      attemptId: rejected.id,
      recoveryIdentity: status.recovery.recoveryIdentity,
      unknownSideEffectsAccepted: true,
      decidedBy: "tests"
    });
    assert.equal(
      repaired.status,
      "needs_plan_approval",
      repaired.blockReason ?? undefined
    );
    assert.equal(f.planAttempts(), 2);
    assert.equal(
      f.implementerPreflights(),
      0,
      "a planning repair must not preflight the implementer"
    );
  } finally {
    await f.repository.dispose();
  }
});

test("an unrelated failure gains no digest repair and keeps its existing refusal", async () => {
  const repository = await createTestRepository({ artifactLayout: "private" });
  try {
    const adapters: VendorAdapters = {
      preflightCodex: async () => {},
      preflightClaude: async () => {},
      runSelection: async () =>
        wrap({
          contractVersion: "1.0.0",
          recommendedWorkflow: "feature",
          confidence: "high",
          reason: "Verify local behavior.",
          escalationTriggers: []
        }),
      runReview: async () => {
        throw new Error("Unexpected lite review.");
      },
      runPhase: async () => {
        // A mutable attempt that changed the checkout and never returned a
        // result: its side effects are partial and stay refused.
        await writeFile(
          path.join(repository.root, "partial.txt"),
          "partial\n",
          "utf8"
        );
        throw new Error("vendor transport failure");
      }
    };
    const runner = new WorkflowRunner(repository.root, adapters);
    const blocked = await runner.start({
      slug: "unrelated",
      request: "Verify local behavior."
    });
    assert.equal(blocked.status, "blocked");
    const status = await runner.status();
    assert.notEqual(status.recovery.sourceKind, "digest_rejected");
    assert.notEqual(status.nextAction, "banzai retry");
  } finally {
    await repository.dispose();
  }
});

test("characterization: a digest-rejected result is repaired by authorized recovery", async () => {
  const f = await fixture(["mismatch", "match"]);
  const trace = recordPersistence();
  try {
    const blocked = await f.runner.start({
      slug: "repair",
      request: "Verify local behavior."
    });
    assert.equal(blocked.status, "blocked");
    const rejectedAttempt = blocked.activeAttempt;
    assert.ok(rejectedAttempt);
    const status = await f.runner.status();
    assert.equal(status.recovery.sourceKind, "digest_rejected");
    assert.ok(status.recovery.recoveryIdentity);
    const done = await f.runner.recover({
      attemptId: rejectedAttempt.id,
      recoveryIdentity: status.recovery.recoveryIdentity,
      unknownSideEffectsAccepted: true,
      decidedBy: "tests"
    });
    assert.equal(done.status, "done", done.blockReason ?? undefined);
    await assertTraceComplete(trace, f.runner.store, done.runId);
    await assertTrace(trace, f.repository.root, TRACE_DIGEST_REJECTED_RECOVERY);
  } finally {
    trace.stop();
    await f.repository.dispose();
  }
});

const TRACE_DIGEST_REJECTED_RECOVERY: readonly string[] = [
  "state created",
  "event run.created",
  "state selecting",
  "state selecting",
  "event attempt.started",
  "state selecting",
  "state implementing",
  "event workflow.selected",
  "state implementing",
  "event attempt.started",
  "event attempt.terminal_checkpoint",
  "state blocked <- implementing: implementation failed: The implementation result declared 1 digest that did not match the bytes it named when the result was accepted. verificationCandidates.checks[check].sources[check.cjs].sha256 at check.cjs declared <sha256> but the bytes hash to <sha256>.",
  "event attempt.failed",
  "state blocked <- implementing: implementation failed: The implementation result declared 1 digest that did not match the bytes it named when the result was accepted. verificationCandidates.checks[check].sources[check.cjs].sha256 at check.cjs declared <sha256> but the bytes hash to <sha256>.",
  "event recovery.authorized",
  "state implementing",
  "event attempt.digest_rejected_source_preserved",
  "state implementing",
  "event attempt.recovery_started",
  "event attempt.terminal_checkpoint",
  "state implementing",
  "state verifying",
  "event attempt.applied",
  "state verifying",
  "state verifying",
  "state done",
  "event run.completed"
];

type DigestFixture = Awaited<ReturnType<typeof fixture>>;

async function blockedDigestRejection(f: DigestFixture) {
  const blocked = await f.runner.start({
    slug: "repair",
    request: "Verify local behavior."
  });
  assert.equal(blocked.status, "blocked", "fixture must block");
  return { blocked, attempt: requiredAttempt(blocked.activeAttempt) };
}

function requiredAttempt<T>(value: T | null | undefined): T {
  assert.ok(value !== null && value !== undefined);
  return value;
}

async function authorizeDigestRecovery(f: DigestFixture): Promise<void> {
  const status = await f.runner.status();
  assert.equal(status.recovery.eligible, true, status.recovery.reason);
  await f.runner.recover(
    {
      attemptId: requiredAttempt(status.recovery.attemptId),
      recoveryIdentity: requiredAttempt(status.recovery.recoveryIdentity),
      unknownSideEffectsAccepted: true,
      decidedBy: "tests"
    },
    false
  );
}

const DIGEST_SCENARIOS: {
  name: string;
  arrange: () => Promise<{
    root: string;
    runner: WorkflowRunner;
    runId: string;
    dispose: () => Promise<void>;
  }>;
}[] = [
  ...(
    [
      ["digest-rejected implementation", async () => {}],
      [
        "digest-rejected implementation without a terminal checkpoint",
        async (f: DigestFixture, runId: string, attempt: AttemptReference) => {
          await rm(f.store.terminalCheckpointPath(runId, attempt));
        }
      ],
      [
        "digest-rejected implementation with a live process",
        (f: DigestFixture, runId: string) =>
          rewriteRunState(f.store, runId, (state) => {
            state.activeProcess = {
              pid: process.pid,
              kind: "implementation",
              startedAt: "2026-07-01T00:00:00.000Z"
            };
          })
      ],
      [
        "digest-rejected implementation after HEAD moved",
        async (f: DigestFixture) => {
          await writeFile(
            path.join(f.repository.root, "unrelated.txt"),
            "moved HEAD\n"
          );
          await commitAll(f.repository.root, "move HEAD");
        }
      ],
      [
        "digest-rejected implementation with malformed digest evidence",
        (f: DigestFixture, runId: string, attempt: AttemptReference) =>
          writeFile(f.store.resultDigestEvidencePath(runId, attempt), "{")
      ],
      [
        "digest-rejected implementation with malformed digest evidence and a malformed terminal checkpoint",
        async (f: DigestFixture, runId: string, attempt: AttemptReference) => {
          await writeFile(
            f.store.resultDigestEvidencePath(runId, attempt),
            "{"
          );
          await writeFile(f.store.terminalCheckpointPath(runId, attempt), "{");
        }
      ],
      [
        "digest-rejected implementation with an unreadable earlier attempt record",
        async (f: DigestFixture, runId: string, attempt: AttemptReference) => {
          const earlier = (await f.store.readRunAttempts(runId)).find(
            (record) => record.attempt.id !== attempt.id
          );
          await writeFile(
            f.store.attemptPath(runId, requiredAttempt(earlier).attempt),
            "{"
          );
        }
      ],
      [
        "digest-rejected implementation with unreadable configuration",
        (f: DigestFixture) =>
          writeFile(path.join(f.repository.root, ".banzai", "config.json"), "{")
      ],
      [
        "digest-rejected implementation superseded by a recovery attempt",
        async (f: DigestFixture, runId: string) => {
          await authorizeDigestRecovery(f);
          await rewriteRunState(f.store, runId, (state) => {
            requiredAttempt(state.recovery).recoveryAttemptId =
              "implementation-recovery-fixture";
          });
        }
      ],
      [
        "authorized digest-rejected implementation",
        (f: DigestFixture) => authorizeDigestRecovery(f)
      ],
      [
        "authorized digest-rejected implementation after workspace drift",
        async (f: DigestFixture) => {
          await authorizeDigestRecovery(f);
          await writeFile(path.join(f.repository.root, "drift.txt"), "drift\n");
        }
      ]
    ] as const
  ).map(([name, mutate]) => ({
    name,
    arrange: async () => {
      const f = await fixture(["mismatch", "match"]);
      try {
        const { blocked, attempt } = await blockedDigestRejection(f);
        await mutate(f, blocked.runId, attempt);
        return {
          root: f.repository.root,
          runner: f.runner,
          runId: blocked.runId,
          dispose: () => f.repository.dispose()
        };
      } catch (error) {
        await f.repository.dispose();
        throw error;
      }
    }
  })),
  ...(
    [
      ["digest-rejected plan", async () => {}],
      [
        "digest-rejected plan with a changed workflow selection",
        (store: RunStore, runId: string) =>
          rewriteRunState(store, runId, (state) => {
            requiredAttempt(state.workflowSelection).digest = "0".repeat(64);
          })
      ]
    ] as const
  ).map(([name, mutate]) => ({
    name,
    arrange: async () => {
      const f = await strictFixture(["fabricated", "correct"]);
      try {
        const blocked = await f.runner.start({
          slug: "plan-repair",
          request: "Plan it."
        });
        assert.equal(blocked.status, "blocked", "fixture must block");
        await mutate(f.runner.store, blocked.runId);
        return {
          root: f.repository.root,
          runner: f.runner,
          runId: blocked.runId,
          dispose: () => f.repository.dispose()
        };
      } catch (error) {
        await f.repository.dispose();
        throw error;
      }
    }
  }))
];

for (const scenario of DIGEST_SCENARIOS)
  test(`eligibility baseline: ${scenario.name}`, async () => {
    const arrangement = await scenario.arrange();
    try {
      assert.deepEqual(
        await observeEligibility(
          arrangement.runner,
          arrangement.root,
          arrangement.runId
        ),
        DIGEST_ELIGIBILITY_BASELINE[scenario.name]
      );
    } finally {
      await arrangement.dispose();
    }
  });

// Workspace v3 observes missing selected documents and excludes executor evidence.
const DIGEST_ELIGIBILITY_BASELINE: Readonly<Record<string, unknown>> = {
  "digest-rejected implementation": {
    observed: {
      retry: {
        eligible: false,
        reason:
          "Failed mutable attempts cannot be retried because their repository side effects may be incomplete. Inspect the checkout, then cancel the run.",
        attemptId: "implementation-1-<id>"
      },
      recovery: {
        eligible: true,
        terminalCheckpointPresent: true,
        reason:
          "The implementation result was refused because 1 digest it authored never matched the bytes it named. Recovery authorizes one linked implementation attempt to supply a corrected result; the rejected attempt and its result are retained.",
        warning:
          "The rejected attempt keeps its failed status and its result. Recovery authorizes one new attempt for the same phase and no additional scope; a replacement strict plan still passes the existing approval gate.",
        sourceKind: "digest_rejected",
        attemptId: "implementation-1-<id>",
        phase: "implementation",
        resolvedFindingIds: [],
        remainingFindingIds: [],
        prerequisites: [],
        authorization: "workflow_selection",
        recoveryIdentity: "<sha256>",
        workspace: {
          digest: "<sha256>",
          added: 2,
          modified: 0,
          deleted: 5,
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
      blockReason:
        "implementation failed: The implementation result declared 1 digest that did not match the bytes it named when the result was accepted. verificationCandidates.checks[check].sources[check.cjs].sha256 at check.cjs declared <sha256> but the bytes hash to <sha256>."
    }
  },
  "digest-rejected implementation without a terminal checkpoint": {
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
          "The rejected implementation result has no terminal checkpoint, so its repository side effects are unknown. Inspect the checkout, then cancel the run.",
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
        "implementation failed: The implementation result declared 1 digest that did not match the bytes it named when the result was accepted. verificationCandidates.checks[check].sources[check.cjs].sha256 at check.cjs declared <sha256> but the bytes hash to <sha256>."
    }
  },
  "digest-rejected implementation with a live process": {
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
      blockReason:
        "implementation failed: The implementation result declared 1 digest that did not match the bytes it named when the result was accepted. verificationCandidates.checks[check].sources[check.cjs].sha256 at check.cjs declared <sha256> but the bytes hash to <sha256>."
    }
  },
  "digest-rejected implementation after HEAD moved": {
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
      blockReason:
        "implementation failed: The implementation result declared 1 digest that did not match the bytes it named when the result was accepted. verificationCandidates.checks[check].sources[check.cjs].sha256 at check.cjs declared <sha256> but the bytes hash to <sha256>."
    }
  },
  "digest-rejected implementation with malformed digest evidence": {
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
          "Result digest evidence is malformed. Audit the run before continuing.",
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
        "implementation failed: The implementation result declared 1 digest that did not match the bytes it named when the result was accepted. verificationCandidates.checks[check].sources[check.cjs].sha256 at check.cjs declared <sha256> but the bytes hash to <sha256>."
    }
  },
  "digest-rejected implementation with unreadable configuration": {
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
          "Digest-rejected recovery preconditions could not be validated; inspect or cancel the run.",
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
        "implementation failed: The implementation result declared 1 digest that did not match the bytes it named when the result was accepted. verificationCandidates.checks[check].sources[check.cjs].sha256 at check.cjs declared <sha256> but the bytes hash to <sha256>."
    }
  },
  "digest-rejected implementation superseded by a recovery attempt": {
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
          "A later implementation attempt already supersedes this rejected result.",
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
        "implementation failed: The implementation result declared 1 digest that did not match the bytes it named when the result was accepted. verificationCandidates.checks[check].sources[check.cjs].sha256 at check.cjs declared <sha256> but the bytes hash to <sha256>."
    }
  },
  "authorized digest-rejected implementation": {
    observed: {
      retry: {
        eligible: false,
        reason:
          "Failed mutable attempts cannot be retried because their repository side effects may be incomplete. Inspect the checkout, then cancel the run.",
        attemptId: "implementation-1-<id>"
      },
      recovery: {
        eligible: true,
        terminalCheckpointPresent: true,
        reason:
          "The implementation result was refused because 1 digest it authored never matched the bytes it named. Recovery authorizes one linked implementation attempt to supply a corrected result; the rejected attempt and its result are retained.",
        warning:
          "The rejected attempt keeps its failed status and its result. Recovery authorizes one new attempt for the same phase and no additional scope; a replacement strict plan still passes the existing approval gate.",
        sourceKind: "digest_rejected",
        attemptId: "implementation-1-<id>",
        phase: "implementation",
        resolvedFindingIds: [],
        remainingFindingIds: [],
        prerequisites: [],
        authorization: "workflow_selection",
        recoveryIdentity: "<sha256>",
        workspace: {
          digest: "<sha256>",
          added: 2,
          modified: 0,
          deleted: 5,
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
      blockReason:
        "implementation failed: The implementation result declared 1 digest that did not match the bytes it named when the result was accepted. verificationCandidates.checks[check].sources[check.cjs].sha256 at check.cjs declared <sha256> but the bytes hash to <sha256>."
    }
  },
  "authorized digest-rejected implementation after workspace drift": {
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
      blockReason:
        "implementation failed: The implementation result declared 1 digest that did not match the bytes it named when the result was accepted. verificationCandidates.checks[check].sources[check.cjs].sha256 at check.cjs declared <sha256> but the bytes hash to <sha256>."
    }
  },
  "digest-rejected plan": {
    observed: {
      retry: {
        eligible: true,
        reason: "Failed plan attempt plan-1-<id> can be retried explicitly.",
        attemptId: "plan-1-<id>"
      },
      recovery: {
        eligible: true,
        terminalCheckpointPresent: true,
        reason:
          "The plan result was refused because 1 digest it authored never matched the bytes it named. Recovery authorizes one linked plan attempt to supply a corrected result; the rejected attempt and its result are retained.",
        warning:
          "The rejected attempt keeps its failed status and its result. Recovery authorizes one new attempt for the same phase and no additional scope; a replacement strict plan still passes the existing approval gate.",
        sourceKind: "digest_rejected",
        attemptId: "plan-1-<id>",
        phase: "plan",
        resolvedFindingIds: [],
        remainingFindingIds: [],
        prerequisites: [],
        authorization: "workflow_selection",
        recoveryIdentity: "<sha256>",
        workspace: {
          digest: "<sha256>",
          added: 2,
          modified: 0,
          deleted: 4,
          total: 6
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
      blockedFrom: "planning",
      blockReason:
        "plan failed: The plan result declared 1 digest that did not match the bytes it named when the result was accepted. planRemainderSha256 at documentation/work/plan-repair/plan.md declared <sha256> but the bytes hash to <sha256>."
    }
  },
  "digest-rejected plan with a changed workflow selection": {
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
          "Planning recovery requires the unchanged persisted workflow selection.",
        warning:
          "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.",
        sourceKind: null,
        attemptId: "plan-1-<id>",
        phase: "plan",
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
      blockReason:
        "plan failed: The plan result declared 1 digest that did not match the bytes it named when the result was accepted. planRemainderSha256 at documentation/work/plan-repair/plan.md declared <sha256> but the bytes hash to <sha256>."
    }
  },
  "digest-rejected implementation with malformed digest evidence and a malformed terminal checkpoint":
    {
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
            "Result digest evidence is malformed. Audit the run before continuing.",
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
          "implementation failed: The implementation result declared 1 digest that did not match the bytes it named when the result was accepted. verificationCandidates.checks[check].sources[check.cjs].sha256 at check.cjs declared <sha256> but the bytes hash to <sha256>."
      }
    },
  "digest-rejected implementation with an unreadable earlier attempt record": {
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
          "Digest-rejected recovery preconditions could not be validated; inspect or cancel the run.",
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
        "implementation failed: The implementation result declared 1 digest that did not match the bytes it named when the result was accepted. verificationCandidates.checks[check].sources[check.cjs].sha256 at check.cjs declared <sha256> but the bytes hash to <sha256>."
    }
  }
};
