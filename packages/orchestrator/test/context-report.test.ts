import assert from "node:assert/strict";
import { mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  available,
  emptyContextInventory,
  emptyContextVendorUsage,
  measureRunnerPayload,
  unavailable
} from "../src/context-accounting.js";
import {
  aggregateContextEvidence,
  collectContextReport,
  type ContextReportAttemptEvidence
} from "../src/context-report.js";
import { BanzaiError } from "../src/errors.js";
import { resolveOutputContract } from "../src/output-contract.js";
import { createPromptEnvelope } from "../src/prompt-envelope.js";
import {
  CONTEXT_ATTEMPT_SCHEMA,
  CONTEXT_ATTEMPT_SCHEMA_VERSION,
  type AttemptReference,
  type ContextAttemptLedger,
  type ContextWorkflow,
  type ModelUsage
} from "../src/types.js";
import { createEvaluationRoot, snapshotTree } from "./helpers.js";

function roleFor(
  kind: AttemptReference["kind"]
): "planner" | "implementer" | "reviewer" {
  return kind === "selection" || kind === "plan"
    ? "planner"
    : kind === "review"
      ? "reviewer"
      : "implementer";
}

function ledger(
  runId: string,
  attempt: AttemptReference,
  workflow: ContextWorkflow = "strict",
  usage: ModelUsage | null = null
): ContextAttemptLedger {
  const runnerPayload = measureRunnerPayload(
    createPromptEnvelope([
      { category: "phase_instructions", text: "phase" },
      { category: "user_request_scope", text: "scope" }
    ]),
    resolveOutputContract("codex", "phase-result/v3")
  );
  return {
    schema: CONTEXT_ATTEMPT_SCHEMA,
    schemaVersion: CONTEXT_ATTEMPT_SCHEMA_VERSION,
    runId,
    attempt,
    invocations: [
      {
        ordinal: 1,
        kind: "primary",
        workflow,
        phase: attempt.kind,
        role: roleFor(attempt.kind),
        vendor: "codex",
        sessionMode: "fresh",
        measuredAt: "2026-08-23T10:00:00.000Z",
        completedAt: "2026-08-23T10:01:00.000Z",
        outcome: "completed",
        runnerPayload,
        authority: [{ class: "project_manifest", count: 1 }],
        sessionInventory: {
          ...emptyContextInventory(),
          toolCount: available(4)
        },
        vendorUsage:
          usage === null
            ? emptyContextVendorUsage()
            : {
                ...emptyContextVendorUsage(),
                inputTokens: available(usage.inputTokens),
                cachedInputTokens: available(usage.cachedInputTokens),
                outputTokens: available(usage.outputTokens),
                costUsd:
                  usage.costUsd === null
                    ? unavailable()
                    : available(usage.costUsd)
              },
        budgets: [
          {
            metric: "runner_payload_bytes",
            selector: { phase: attempt.kind, role: roleFor(attempt.kind) },
            maximum: runnerPayload.totalBytes - 1,
            observed: available(runnerPayload.totalBytes),
            result: "observed_exceeded"
          }
        ]
      }
    ]
  };
}

async function writeRun(
  root: string,
  runId: string,
  options: {
    createdAt?: string;
    workflow?: Exclude<ContextWorkflow, "unselected">;
    attempt?: AttemptReference;
    context?: ContextAttemptLedger | null;
    usage?: ModelUsage | null;
    malformedState?: boolean;
    status?: "started" | "completed" | "failed" | "interrupted";
  } = {}
): Promise<void> {
  const directory = path.join(root, ".banzai", "runs", runId);
  const attempts = path.join(directory, "attempts");
  await mkdir(attempts, { recursive: true });
  await writeFile(
    path.join(directory, "state.json"),
    options.malformedState === true
      ? "not-json"
      : JSON.stringify({
          schemaVersion: 5,
          runId,
          createdAt: options.createdAt ?? "2026-08-23T10:00:00.000Z",
          workflowSelection: { workflow: options.workflow ?? "strict" }
        }),
    "utf8"
  );
  const attempt =
    options.attempt ??
    ({ id: `${runId}-plan-1`, kind: "plan", mutable: false } as const);
  await writeFile(
    path.join(attempts, `${attempt.id}-${attempt.kind}.json`),
    JSON.stringify({
      schemaVersion: 2,
      attempt,
      status: options.status ?? "completed",
      usage: options.usage ?? null
    }),
    "utf8"
  );
  if (options.context !== null && options.context !== undefined) {
    await writeFile(
      path.join(attempts, `${attempt.id}.context.json`),
      JSON.stringify(options.context),
      "utf8"
    );
  }
}

test("context aggregation keeps surfaces separate and orders groups and ties deterministically", () => {
  const planAttempt = {
    id: "plan-one",
    kind: "plan",
    mutable: false
  } as const;
  const implementationAttempt = {
    id: "implementation-one",
    kind: "implementation",
    mutable: true
  } as const;
  const sources: ContextReportAttemptEvidence[] = [
    {
      runId: "run-one",
      attempt: implementationAttempt,
      workflow: "strict",
      usage: null,
      ledger: null
    },
    {
      runId: "run-one",
      attempt: planAttempt,
      workflow: "strict",
      usage: null,
      ledger: ledger("run-one", planAttempt)
    }
  ];

  const report = aggregateContextEvidence(sources);

  assert.deepEqual(report.coverage, { exact: 1, incomplete: 1 });
  assert.deepEqual(
    report.groups.map((group) => [group.phase, group.role]),
    [
      ["plan", "planner"],
      ["implementation", "implementer"]
    ]
  );
  const plan = report.groups[0];
  assert.ok(plan);
  assert.equal(plan.invocationCount, 1);
  assert.equal(plan.runnerPayload.observed, 1);
  assert.equal(plan.vendorUsage.inputTokens.total, null);
  assert.equal(plan.vendorUsage.inputTokens.unavailable, 1);
  assert.equal(plan.sessionInventory.tools.total, 4);
  assert.deepEqual(
    plan.categories.slice(-2).map((item) => item.category),
    ["phase_instructions", "user_request_scope"]
  );
  assert.equal(plan.budgets[0]?.observedExceeded, 1);
});

test("context collector is deterministic read-only and reports historical gaps", async () => {
  const root = await createEvaluationRoot();
  try {
    const exactAttempt = {
      id: "run-a-plan-1",
      kind: "plan",
      mutable: false
    } as const;
    await writeRun(root, "run-a", {
      attempt: exactAttempt,
      context: ledger("run-a", exactAttempt)
    });
    await writeRun(root, "run-b", { context: null });
    await writeRun(root, "run-out", {
      createdAt: "2026-08-24T00:00:00.000Z",
      context: null
    });
    await writeRun(root, "run-unresolved", { malformedState: true });
    const before = await snapshotTree(path.join(root, ".banzai"));
    const options = {
      format: "json" as const,
      from: "2026-08-23T00:00:00.000Z",
      to: "2026-08-24T00:00:00.000Z",
      runIds: []
    };

    const first = await collectContextReport(root, options);
    const second = await collectContextReport(root, options);

    assert.deepEqual(second, first);
    assert.equal(first.schema, "banzai-context-report/v1");
    assert.equal(first.cohort.discoveredRunCount, 4);
    assert.equal(first.cohort.includedRunCount, 2);
    assert.deepEqual(first.cohort.unresolvedRunIds, ["run-unresolved"]);
    assert.deepEqual(first.coverage, { exact: 1, incomplete: 1 });
    assert.deepEqual(await snapshotTree(path.join(root, ".banzai")), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("interrupted attempts retain pending runner evidence or honest incomplete coverage", async () => {
  const root = await createEvaluationRoot();
  try {
    const exactAttempt = {
      id: "interrupted-exact-plan-1",
      kind: "plan",
      mutable: false
    } as const;
    const pending = ledger("interrupted-exact", exactAttempt);
    const invocation = pending.invocations[0];
    assert.ok(invocation);
    invocation.completedAt = null;
    invocation.outcome = "pending";
    invocation.sessionInventory = emptyContextInventory();
    invocation.vendorUsage = emptyContextVendorUsage();
    await writeRun(root, "interrupted-exact", {
      attempt: exactAttempt,
      context: pending,
      status: "interrupted"
    });
    const gapAttempt = {
      id: "interrupted-gap-plan-1",
      kind: "plan",
      mutable: false
    } as const;
    await writeRun(root, "interrupted-gap", {
      attempt: gapAttempt,
      context: null,
      status: "interrupted"
    });
    const options = {
      format: "json" as const,
      from: null,
      to: null,
      runIds: []
    };

    const first = await collectContextReport(root, options);
    const second = await collectContextReport(root, options);

    assert.deepEqual(second, first);
    assert.deepEqual(first.coverage, { exact: 1, incomplete: 1 });
    const plan = first.groups.find((group) => group.phase === "plan");
    assert.ok(plan);
    assert.equal(plan.runnerPayload.observed, 1);
    assert.equal(plan.runnerPayload.total, invocation.runnerPayload.totalBytes);
    assert.equal(plan.vendorUsage.inputTokens.observed, 0);
    assert.equal(plan.vendorUsage.inputTokens.unavailable, 1);
    assert.equal(plan.sessionInventory.tools.observed, 0);
    assert.equal(plan.sessionInventory.tools.unavailable, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("context collector rejects missing runs and conflicting canonical usage", async () => {
  const root = await createEvaluationRoot();
  try {
    await assert.rejects(
      collectContextReport(root, {
        format: "json",
        from: null,
        to: null,
        runIds: ["missing-run"]
      }),
      (error: unknown) =>
        error instanceof BanzaiError && error.code === "EVAL_RUN_NOT_FOUND"
    );
    const attempt = {
      id: "run-conflict-plan-1",
      kind: "plan",
      mutable: false
    } as const;
    const usage = {
      inputTokens: 99,
      cachedInputTokens: 0,
      outputTokens: 0,
      costUsd: null
    };
    await writeRun(root, "run-conflict", {
      attempt,
      usage,
      context: ledger("run-conflict", attempt, "strict", {
        ...usage,
        inputTokens: 1
      })
    });
    await assert.rejects(
      collectContextReport(root, {
        format: "json",
        from: null,
        to: null,
        runIds: ["run-conflict"]
      }),
      (error: unknown) => {
        assert.ok(error instanceof BanzaiError);
        assert.equal(error.code, "INVALID_CONTEXT_EVIDENCE");
        assert.match(error.message, /run-conflict.*run-conflict-plan-1/);
        return true;
      }
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("malformed present context evidence fails closed without repeating content", async () => {
  const root = await createEvaluationRoot();
  try {
    const runId = "run-hostile";
    const attempt = {
      id: "hostile-plan-1",
      kind: "plan",
      mutable: false
    } as const;
    await writeRun(root, runId, { attempt, context: null });
    await writeFile(
      path.join(
        root,
        ".banzai",
        "runs",
        runId,
        "attempts",
        `${attempt.id}.context.json`
      ),
      '{"secret":"Bearer private@example.com /Users/private"',
      "utf8"
    );

    await assert.rejects(
      collectContextReport(root, {
        format: "markdown",
        from: null,
        to: null,
        runIds: [runId]
      }),
      (error: unknown) => {
        assert.ok(error instanceof BanzaiError);
        assert.equal(error.code, "INVALID_CONTEXT_EVIDENCE");
        assert.match(error.message, /run-hostile.*hostile-plan-1/);
        assert.doesNotMatch(
          error.message,
          /Bearer|example\.com|\/Users\/private/
        );
        return true;
      }
    );
    assert.match(
      await readFile(
        path.join(
          root,
          ".banzai",
          "runs",
          runId,
          "attempts",
          `${attempt.id}.context.json`
        ),
        "utf8"
      ),
      /Bearer/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("context collector rejects unsafe run names and symlinked owned leaves without disclosure", async () => {
  const hostileRoot = await createEvaluationRoot();
  const stateRoot = await createEvaluationRoot();
  const contextRoot = await createEvaluationRoot();
  try {
    const hostileName = "private@example.com";
    await mkdir(path.join(hostileRoot, ".banzai", "runs", hostileName));
    await assert.rejects(
      collectContextReport(hostileRoot, {
        format: "json",
        from: null,
        to: null,
        runIds: []
      }),
      (error: unknown) => {
        assert.ok(error instanceof BanzaiError);
        assert.equal(error.code, "EVAL_READ_FAILED");
        assert.doesNotMatch(error.message, /private@example\.com/);
        return true;
      }
    );

    const stateRunId = "symlinked-state";
    const stateDirectory = path.join(stateRoot, ".banzai", "runs", stateRunId);
    await mkdir(path.join(stateDirectory, "attempts"), { recursive: true });
    const externalState = path.join(stateRoot, "external-state.json");
    await writeFile(
      externalState,
      JSON.stringify({
        schemaVersion: 5,
        runId: stateRunId,
        createdAt: "2026-08-23T10:00:00.000Z",
        workflowSelection: { workflow: "strict" },
        canary: "state-canary@example.com"
      }),
      "utf8"
    );
    await symlink(externalState, path.join(stateDirectory, "state.json"));
    const stateReport = await collectContextReport(stateRoot, {
      format: "json",
      from: null,
      to: null,
      runIds: []
    });
    assert.deepEqual(stateReport.cohort.unresolvedRunIds, [stateRunId]);
    assert.equal(JSON.stringify(stateReport).includes("state-canary"), false);

    const contextRunId = "symlinked-context";
    const contextAttempt = {
      id: "symlinked-context-plan-1",
      kind: "plan",
      mutable: false
    } as const;
    await writeRun(contextRoot, contextRunId, {
      attempt: contextAttempt,
      context: null
    });
    const externalLedger = path.join(contextRoot, "external-context.json");
    await writeFile(
      externalLedger,
      JSON.stringify(ledger(contextRunId, contextAttempt)),
      "utf8"
    );
    await symlink(
      externalLedger,
      path.join(
        contextRoot,
        ".banzai",
        "runs",
        contextRunId,
        "attempts",
        `${contextAttempt.id}.context.json`
      )
    );
    await assert.rejects(
      collectContextReport(contextRoot, {
        format: "markdown",
        from: null,
        to: null,
        runIds: []
      }),
      (error: unknown) => {
        assert.ok(error instanceof BanzaiError);
        assert.equal(error.code, "INVALID_CONTEXT_EVIDENCE");
        assert.doesNotMatch(error.message, /external-context|state-canary/);
        return true;
      }
    );
    assert.match(
      await readFile(externalLedger, "utf8"),
      /banzai-context-attempt/
    );
  } finally {
    await rm(hostileRoot, { recursive: true, force: true });
    await rm(stateRoot, { recursive: true, force: true });
    await rm(contextRoot, { recursive: true, force: true });
  }
});

test("context collector rejects a symlinked attempts directory before reading external evidence", async () => {
  const root = await createEvaluationRoot();
  try {
    const runId = "symlinked-attempts";
    const attempt = {
      id: "symlinked-attempts-plan-1",
      kind: "plan",
      mutable: false
    } as const;
    const runsDirectory = path.join(root, ".banzai", "runs");
    const runDirectory = path.join(runsDirectory, runId);
    const attemptsDirectory = path.join(runDirectory, "attempts");
    const canary = "private@example.com";
    const externalDirectory = path.join(root, `external-attempts-${canary}`);
    await mkdir(runDirectory, { recursive: true });
    await mkdir(externalDirectory);
    await writeFile(
      path.join(runDirectory, "state.json"),
      JSON.stringify({
        schemaVersion: 5,
        runId,
        createdAt: "2026-08-23T10:00:00.000Z",
        workflowSelection: { workflow: "strict" }
      }),
      "utf8"
    );
    const canonicalFile = path.join(
      externalDirectory,
      `${attempt.id}-${attempt.kind}.json`
    );
    await writeFile(
      canonicalFile,
      JSON.stringify({
        schemaVersion: 2,
        attempt,
        status: "completed",
        usage: null,
        externalCanary: canary
      }),
      "utf8"
    );
    const contextFile = path.join(
      externalDirectory,
      `${attempt.id}.context.json`
    );
    await writeFile(
      contextFile,
      JSON.stringify(ledger(runId, attempt)),
      "utf8"
    );
    await symlink(externalDirectory, attemptsDirectory);
    const beforeTree = await snapshotTree(runsDirectory);
    const beforeCanonical = await readFile(canonicalFile, "utf8");
    const beforeContext = await readFile(contextFile, "utf8");

    await assert.rejects(
      collectContextReport(root, {
        format: "json",
        from: null,
        to: null,
        runIds: []
      }),
      (error: unknown) => {
        assert.ok(error instanceof BanzaiError);
        assert.equal(error.code, "EVAL_READ_FAILED");
        assert.doesNotMatch(error.message, /private@example\.com/);
        return true;
      }
    );
    assert.deepEqual(await snapshotTree(runsDirectory), beforeTree);
    assert.equal(await readFile(canonicalFile, "utf8"), beforeCanonical);
    assert.equal(await readFile(contextFile, "utf8"), beforeContext);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("historical formatting repair invocations remain readable and usage is counted once", async () => {
  const root = await createEvaluationRoot();
  try {
    const attempt = {
      id: "historical-review-1",
      kind: "review" as const,
      mutable: false
    };
    const context = ledger("historical", attempt, "strict", {
      inputTokens: 10,
      cachedInputTokens: 2,
      outputTokens: 3,
      costUsd: 0.1
    });
    const primary = context.invocations[0];
    assert.ok(primary);
    context.invocations.push({
      ...structuredClone(primary),
      ordinal: 2,
      kind: "review_artifact_repair",
      sessionMode: "resumed"
    });
    await writeRun(root, "historical", {
      attempt,
      context,
      usage: {
        inputTokens: 20,
        cachedInputTokens: 4,
        outputTokens: 6,
        costUsd: 0.2
      }
    });
    const before = await snapshotTree(root);
    const report = await collectContextReport(root, {
      format: "json",
      from: null,
      to: null,
      runIds: []
    });
    const review = report.groups.find((group) => group.phase === "review");
    assert.ok(review);
    assert.equal(review.invocationCount, 2);
    assert.equal(review.vendorUsage.inputTokens.total, 20);
    assert.deepEqual(await snapshotTree(root), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
