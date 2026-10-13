import { requiredFixture } from "./helpers.js";
import { spawn, spawnSync } from "node:child_process";
import { collectEvaluationExport } from "../src/evaluation.js";
import { deriveEvaluationKpiReport } from "../src/evaluation-kpi.js";
import {
  readTaskVerificationAttempts,
  evidenceDigest
} from "../src/verification-evidence.js";
import { collectContextReport } from "../src/context-report.js";
import { projectAgentControlStatus } from "../src/agent-control.js";
import { emptyHumanTime } from "../src/human-time.js";
import { InteractiveHumanTime } from "../src/interactive-human-time.js";
import { HumanTimeStore } from "../src/human-time-store.js";
import type { HumanTimeBoundary } from "../src/human-time.js";
import assert from "node:assert/strict";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { BanzaiError, ProcessExitError } from "../src/errors.js";
import { parsePublishedCompletionRegion } from "../src/plan-task-completion.js";
import {
  CONTRACT_VERSION,
  PLAN_TASK_COMPLETION_SCHEMA_VERSION,
  type AdapterResult,
  type PhaseAdapterRequest,
  type PhaseResult,
  type ProcessRunner,
  type ProgressEvent
} from "../src/types.js";
import { WorkflowRunner } from "../src/workflow.js";
import * as workflowFacade from "../src/workflow.js";
import type {
  Clock,
  ConfigurationDecisionInput,
  DecisionConsultationInput,
  HumanDecisionInput,
  IdSource,
  RecoverInput,
  RecoveryEligibility,
  RetryEligibility,
  ReviewCompletion,
  RunnerSources,
  StartRunInput,
  TriageInput,
  WorkflowStatus,
  WorkflowTaskCompletionStatus
} from "../src/workflow.js";
import {
  createTestRepository,
  commitAll,
  monochromeEnv,
  snapshotTree
} from "./helpers.js";
import {
  assertTrace,
  assertTraceComplete,
  recordPersistence
} from "./characterization-trace.js";
import {
  FakeAdapters,
  blockedByFailedCheck,
  boundFixturePath,
  decisionConsultationResult,
  finding,
  passingReview,
  phaseResult,
  planPath,
  prerequisiteBlockedFixFixture,
  selectionResult
} from "./workflow-fixtures.js";

function repinFixtureInventory(markdown: string): string {
  const pattern = /```banzai-verification-obligations\/v2\n([\s\S]*?)\n```/u;
  const match = pattern.exec(markdown);
  if (!match)
    throw new Error("Fixture plan must retain its verification inventory.");
  const inventory = JSON.parse(requiredFixture(match[1])) as Record<
    string,
    unknown
  >;
  inventory.planRemainderSha256 = evidenceDigest(
    markdown.slice(0, match.index) +
      markdown.slice(match.index + match[0].length)
  );
  return (
    markdown.slice(0, match.index) +
    "```banzai-verification-obligations/v2\n" +
    JSON.stringify(inventory) +
    "\n```" +
    markdown.slice(match.index + match[0].length)
  );
}

async function writeFixturePlan(
  target: string,
  markdown: string
): Promise<void> {
  if (!markdown.includes("```banzai-verification-obligations/v2")) {
    const original = await readFile(target, "utf8");
    const inventory =
      /```banzai-verification-obligations\/v2\n[\s\S]*?\n```/u.exec(original);
    if (!inventory) throw new Error("No fixture inventory to retain.");
    markdown += "\n" + inventory[0] + "\n";
  }
  await writeFile(target, repinFixtureInventory(markdown));
}

test("a quick-fix route skips strict planning and independent review", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new FakeAdapters();
    adapters.selectionResults.push(
      selectionResult({
        recommendedWorkflow: "quick-fix",
        reason: "This corrects existing behavior."
      })
    );
    const progress: ProgressEvent[] = [];
    const runner = new WorkflowRunner(
      repository.root,
      adapters,
      undefined,
      (event) => progress.push(event)
    );

    const state = await runner.start({
      slug: "small-fix",
      request: "Fix the existing label."
    });

    assert.equal(state.status, "done");
    assert.equal(state.workflowSelection?.workflow, "quick-fix");
    assert.equal(state.metrics.attempts.selection, 1);
    assert.equal(state.metrics.attempts.plan, 0);
    assert.equal(state.metrics.attempts.review, 0);
    assert.equal(adapters.phasePrompts.length, 1);
    assert.match(adapters.phasePrompts[0] ?? "", /# Lite Quick-Fix Phase/);
    assert.match(adapters.phasePrompts[0] ?? "", /Verification is task-scoped/);

    assert.ok(
      progress.some(
        (event) =>
          event.kind === "info" && event.message.startsWith("ROUTE quick-fix -")
      )
    );
  } finally {
    await repository.dispose();
  }
});

test("observe mode records exact context evidence without changing workflow behavior", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new FakeAdapters();
    adapters.selectionResults.push(
      selectionResult({
        recommendedWorkflow: "quick-fix",
        reason: "This corrects existing behavior."
      })
    );
    const runner = new WorkflowRunner(repository.root, adapters);

    const state = await runner.start({
      slug: "observed-context",
      request: "Fix the existing label."
    });

    assert.equal(state.status, "done", state.blockReason ?? undefined);
    const attempts = await runner.store.readRunAttempts(state.runId);
    assert.equal(attempts.length, 2);
    for (const record of attempts) {
      const ledger = await runner.store.readContextLedgerIfPresent(
        state.runId,
        record.attempt
      );
      assert.ok(ledger);
      assert.equal(ledger.invocations.length, 1);
      const invocation = ledger.invocations[0];
      assert.ok(invocation);
      assert.equal(invocation.outcome, "completed");
      assert.equal(
        invocation.runnerPayload.components.reduce(
          (sum, component) => sum + component.bytes,
          0
        ),
        invocation.runnerPayload.totalBytes
      );
      assert.equal(
        invocation.vendorUsage.inputTokens.availability,
        "unavailable"
      );
    }
    const selectionAttempt = attempts.find(
      (record) => record.attempt.kind === "selection"
    );
    assert.ok(selectionAttempt);
    const selectionLedger = await runner.store.readContextLedgerIfPresent(
      state.runId,
      selectionAttempt.attempt
    );
    assert.ok(selectionLedger);
    assert.equal(
      selectionLedger.invocations[0]?.runnerPayload.promptBytes,
      Buffer.byteLength(adapters.selectionPrompts[0] ?? "", "utf8")
    );
  } finally {
    await repository.dispose();
  }
});

test("vendor exit retains structured usage and inventory in the failed context ledger", async () => {
  const repository = await createTestRepository();
  try {
    const usage = {
      inputTokens: 23,
      cachedInputTokens: 7,
      outputTokens: 5,
      costUsd: 0.125
    };
    const inventory = {
      toolCount: 9,
      mcpServerCount: 2,
      skillCount: 3,
      commandCount: 4,
      digest: "a".repeat(64)
    };
    const adapters = new FakeAdapters();
    adapters.selectionErrors.push(
      new ProcessExitError(
        "CODEX_SELECTION_FAILED",
        "Codex exited before selection completed.",
        {
          exitCode: 1,
          signal: null,
          stdout: "structured failure\n",
          stderr: "",
          startedAt: "2026-08-23T10:00:00.000Z",
          completedAt: "2026-08-23T10:00:01.000Z"
        },
        {
          failureCause: "transport",
          usage,
          inventory,
          turnCount: 2
        }
      )
    );
    const runner = new WorkflowRunner(repository.root, adapters);

    const blocked = await runner.start({
      slug: "context-vendor-failure",
      request: "Classify this request."
    });

    assert.equal(blocked.status, "blocked");
    assert.ok(blocked.activeAttempt);
    const record = await runner.store.readRunAttempt(
      blocked.runId,
      blocked.activeAttempt
    );
    assert.equal(record.status, "failed");
    assert.deepEqual(record.usage, usage);
    const ledger = await runner.store.readContextLedgerIfPresent(
      blocked.runId,
      blocked.activeAttempt
    );
    const invocation = ledger?.invocations[0];
    assert.ok(invocation);
    assert.equal(invocation.outcome, "failed");
    assert.equal(invocation.sessionMode, "fresh");
    assert.ok(invocation.runnerPayload.totalBytes > 0);
    assert.deepEqual(invocation.vendorUsage.inputTokens, {
      availability: "available",
      value: usage.inputTokens
    });
    assert.deepEqual(invocation.vendorUsage.turns, {
      availability: "available",
      value: 2
    });
    assert.deepEqual(invocation.sessionInventory.toolCount, {
      availability: "available",
      value: inventory.toolCount
    });
    assert.equal((await runner.status()).retry.eligible, true);
  } finally {
    await repository.dispose();
  }
});

test("timeout and process-start failures retain pre-call bytes with unavailable post-call evidence", async () => {
  for (const [code, message] of [
    ["PROCESS_TIMEOUT", "Model process timed out."],
    ["PROCESS_START_FAILED", "Model process could not start."]
  ] as const) {
    const repository = await createTestRepository();
    try {
      const adapters = new FakeAdapters();
      adapters.selectionErrors.push(new BanzaiError(code, message));
      const runner = new WorkflowRunner(repository.root, adapters);

      const blocked = await runner.start({
        slug: `context-${code.toLowerCase().replaceAll("_", "-")}`,
        request: "Classify this request."
      });

      assert.equal(blocked.status, "blocked");
      assert.ok(blocked.activeAttempt);
      const ledger = await runner.store.readContextLedgerIfPresent(
        blocked.runId,
        blocked.activeAttempt
      );
      const invocation = ledger?.invocations[0];
      assert.ok(invocation);
      assert.equal(invocation.outcome, "failed");
      assert.ok(invocation.runnerPayload.totalBytes > 0);
      assert.equal(
        invocation.vendorUsage.inputTokens.availability,
        "unavailable"
      );
      assert.equal(
        invocation.sessionInventory.toolCount.availability,
        "unavailable"
      );
      assert.equal((await runner.status()).retry.eligible, true);
    } finally {
      await repository.dispose();
    }
  }
});

test("downstream phase validation preserves a completed resumed invocation ledger", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new FakeAdapters();
    adapters.emitImplementationTerminalCheckpoint = false;
    adapters.implementationResults.push(phaseResult("fix"));
    const runner = new WorkflowRunner(repository.root, adapters);
    const planned = await runner.start({
      slug: "context-downstream-validation",
      request: "Implement the strict fixture."
    });
    assert.equal(planned.status, "needs_plan_approval");

    const blocked = await runner.approvePlan("human");

    assert.equal(blocked.status, "blocked");
    assert.ok(blocked.activeAttempt);
    const record = await runner.store.readRunAttempt(
      blocked.runId,
      blocked.activeAttempt
    );
    assert.equal(record.status, "failed");
    assert.match(record.error ?? "", /returned phase fix/);
    const ledger = await runner.store.readContextLedgerIfPresent(
      blocked.runId,
      blocked.activeAttempt
    );
    const invocation = ledger?.invocations[0];
    assert.ok(invocation);
    assert.equal(invocation.outcome, "completed");
    assert.equal(invocation.sessionMode, "resumed");
    assert.ok(invocation.runnerPayload.totalBytes > 0);
    assert.equal(
      invocation.vendorUsage.inputTokens.availability,
      "unavailable"
    );
    assert.equal((await runner.status()).retry.eligible, false);
  } finally {
    await repository.dispose();
  }
});

test("an enforced selection payload budget blocks before the adapter and stays retryable", async () => {
  const repository = await createTestRepository();
  try {
    const configPath = path.join(repository.root, ".banzai", "config.json");
    const config = JSON.parse(await readFile(configPath, "utf8")) as Record<
      string,
      unknown
    >;
    config.context = {
      mode: "enforce",
      limits: [
        {
          metric: "runner_payload_bytes",
          phase: "selection",
          role: "planner",
          maximum: 1
        }
      ]
    };
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
    const adapters = new FakeAdapters();
    const runner = new WorkflowRunner(repository.root, adapters);

    const state = await runner.start({
      slug: "blocked-selection-context",
      request: "Classify this request."
    });

    assert.equal(state.status, "blocked");
    assert.equal(state.blockedFrom, "selecting");
    assert.equal(adapters.selectionPrompts.length, 0);
    assert.ok(state.activeAttempt);
    const record = await runner.store.readRunAttempt(
      state.runId,
      state.activeAttempt
    );
    assert.equal(record.failureCode, "CONTEXT_BUDGET_EXCEEDED");
    const ledger = await runner.store.readContextLedgerIfPresent(
      state.runId,
      state.activeAttempt
    );
    assert.ok(ledger);
    const invocation = ledger.invocations[0];
    assert.ok(invocation);
    assert.equal(invocation.outcome, "budget_exceeded");
    const budget = invocation.budgets[0];
    assert.ok(budget);
    assert.equal(budget.result, "enforced_exceeded");
    assert.equal((await runner.status()).retry.eligible, true);
  } finally {
    await repository.dispose();
  }
});

test("an invalid context policy fails before creating run evidence", async () => {
  const repository = await createTestRepository();
  try {
    const configPath = path.join(repository.root, ".banzai", "config.json");
    const config = JSON.parse(await readFile(configPath, "utf8")) as Record<
      string,
      unknown
    >;
    config.context = {
      mode: "enforce",
      limits: [{ metric: "runner_payload_bytes", maximum: 0 }]
    };
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
    const before = await readdir(path.join(repository.root, ".banzai"));
    const runner = new WorkflowRunner(repository.root, new FakeAdapters());

    await assert.rejects(
      runner.start({
        slug: "invalid-context",
        request: "Do not create a run."
      }),
      (error: unknown) =>
        error instanceof BanzaiError && error.code === "INVALID_CONFIG"
    );
    assert.deepEqual(
      await readdir(path.join(repository.root, ".banzai")),
      before
    );
  } finally {
    await repository.dispose();
  }
});

test("post-call vendor limits remain advisory in enforce mode", async () => {
  const repository = await createTestRepository();
  try {
    const configPath = path.join(repository.root, ".banzai", "config.json");
    const config = JSON.parse(await readFile(configPath, "utf8")) as Record<
      string,
      unknown
    >;
    config.context = {
      mode: "enforce",
      limits: [
        {
          metric: "vendor_input_tokens",
          phase: "selection",
          role: "planner",
          maximum: 1
        }
      ]
    };
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
    const adapters = new FakeAdapters();
    adapters.selectionUsages.push({
      inputTokens: 10,
      cachedInputTokens: 0,
      outputTokens: 2,
      costUsd: null
    });
    const runner = new WorkflowRunner(repository.root, adapters);

    const state = await runner.start({
      slug: "advisory-vendor-budget",
      request: "Plan this strict request."
    });

    assert.equal(state.status, "needs_plan_approval");
    const selectionAttempt = (
      await runner.store.readRunAttempts(state.runId)
    ).find((record) => record.attempt.kind === "selection");
    assert.ok(selectionAttempt);
    const ledger = await runner.store.readContextLedgerIfPresent(
      state.runId,
      selectionAttempt.attempt
    );
    assert.equal(
      ledger?.invocations[0]?.budgets[0]?.result,
      "observed_exceeded"
    );
    assert.equal(selectionAttempt.usage?.inputTokens, 10);
  } finally {
    await repository.dispose();
  }
});

test("an enforced mutable payload budget blocks before source mutation and stays retryable", async () => {
  const repository = await createTestRepository();
  try {
    const configPath = path.join(repository.root, ".banzai", "config.json");
    const config = JSON.parse(await readFile(configPath, "utf8")) as Record<
      string,
      unknown
    >;
    config.context = {
      mode: "enforce",
      limits: [
        {
          metric: "runner_payload_bytes",
          phase: "implementation",
          role: "implementer",
          maximum: 1
        }
      ]
    };
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
    const adapters = new FakeAdapters();
    const runner = new WorkflowRunner(repository.root, adapters);
    const planned = await runner.start({
      slug: "blocked-implementation-context",
      request: "Implement the strict fixture."
    });
    assert.equal(planned.status, "needs_plan_approval");

    const blocked = await runner.approvePlan("human");

    assert.equal(blocked.status, "blocked");
    assert.equal(blocked.blockedFrom, "implementing");
    assert.equal(
      adapters.phasePrompts.filter((prompt) =>
        prompt.includes("Phase: implementation")
      ).length,
      0
    );
    await assert.rejects(
      readFile(path.join(repository.root, "src/example.txt"), "utf8"),
      /ENOENT/
    );
    assert.ok(blocked.activeAttempt);
    const record = await runner.store.readRunAttempt(
      blocked.runId,
      blocked.activeAttempt
    );
    assert.equal(record.failureCode, "CONTEXT_BUDGET_EXCEEDED");
    assert.equal((await runner.status()).retry.eligible, true);
  } finally {
    await repository.dispose();
  }
});

test("a feature route receives its embedded phase and ends after verification", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new FakeAdapters();
    adapters.selectionResults.push(
      selectionResult({
        recommendedWorkflow: "feature",
        reason: "This is a small new capability."
      })
    );
    const runner = new WorkflowRunner(repository.root, adapters);

    const state = await runner.start({
      slug: "small-feature",
      request: "Add a small local label."
    });

    assert.equal(state.status, "done");
    assert.equal(state.workflowSelection?.workflow, "feature");
    assert.equal(state.reviewIteration, 0);
    assert.match(adapters.phasePrompts[0] ?? "", /# Lite Feature Phase/);
    assert.doesNotMatch(
      adapters.phasePrompts[0] ?? "",
      /Use the available Skill tool/
    );
    assert.match(adapters.phasePrompts[0] ?? "", /Verification is task-scoped/);
  } finally {
    await repository.dispose();
  }
});

test("non-high lite recommendations conservatively fall back to strict", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new FakeAdapters();
    adapters.selectionResults.push(
      selectionResult({
        recommendedWorkflow: "quick-fix",
        confidence: "medium",
        reason: "The apparent fix may touch a contract."
      })
    );
    const runner = new WorkflowRunner(repository.root, adapters);

    const state = await runner.start({
      slug: "uncertain-fix",
      request: "Adjust the integration behavior."
    });

    assert.equal(state.status, "needs_plan_approval");
    assert.equal(state.workflowSelection?.recommendedWorkflow, "quick-fix");
    assert.equal(state.workflowSelection.workflow, "strict");
    assert.match(state.workflowSelection.reason, /strict fallback/i);
  } finally {
    await repository.dispose();
  }
});

test("failed read-only selection is retryable without repository mutation", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new FakeAdapters();
    adapters.selectionErrors.push(new Error("selector unavailable"));
    const runner = new WorkflowRunner(repository.root, adapters);

    const failed = await runner.start({
      slug: "retry-selection",
      request: "Fix the existing label."
    });
    assert.equal(failed.status, "blocked");
    assert.equal(failed.blockedFrom, "selecting");
    assert.equal(failed.activeAttempt?.kind, "selection");
    assert.equal((await runner.status()).retry.eligible, true);
    await assert.rejects(
      readFile(path.join(repository.root, "src/example.txt"), "utf8"),
      /ENOENT/
    );

    const retried = await runner.retry();
    assert.equal(retried.status, "needs_plan_approval");
    assert.equal(retried.workflowSelection?.workflow, "strict");
  } finally {
    await repository.dispose();
  }
});

test("a selection authentication failure is recorded as a retryable read-only attempt", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new FakeAdapters();
    adapters.onCodexPreflight = async () => {
      if (adapters.codexPreflights === 2) {
        throw new Error("planner session expired");
      }
    };
    const runner = new WorkflowRunner(repository.root, adapters);

    const failed = await runner.start({
      slug: "selection-auth",
      request: "Fix the existing label."
    });
    assert.equal(failed.status, "blocked");
    assert.equal(failed.blockedFrom, "selecting");
    assert.equal(failed.activeAttempt?.kind, "selection");
    assert.equal(failed.metrics.attempts.selection, 1);
    assert.equal((await runner.status()).retry.eligible, true);
    assert.equal(adapters.selectionPrompts.length, 0);

    const retried = await runner.retry();
    assert.equal(retried.status, "needs_plan_approval");
    assert.equal(retried.metrics.attempts.selection, 2);
  } finally {
    await repository.dispose();
  }
});

test("interrupted read-only selection is retryable with a fresh attempt", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new FakeAdapters();
    adapters.selectionErrors.push(new Error("selector interrupted"));
    const runner = new WorkflowRunner(repository.root, adapters);
    const blocked = await runner.start({
      slug: "interrupted-selection",
      request: "Fix the existing label."
    });
    const attempt = blocked.activeAttempt;
    assert.equal(attempt?.kind, "selection");
    assert.ok(attempt);
    const record = await runner.store.readRunAttempt(blocked.runId, attempt);
    record.status = "started";
    record.completedAt = null;
    record.error = null;
    await runner.store.writeRunAttempt(blocked.runId, record);

    const status = await runner.status();
    assert.equal(status.retry.eligible, true);
    assert.match(status.retry.reason, /read-only/);

    const retried = await runner.retry();
    assert.equal(retried.status, "needs_plan_approval");
    assert.equal(retried.metrics.attempts.selection, 2);
  } finally {
    await repository.dispose();
  }
});

test("an answered lite escalation reselects before further source changes", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new FakeAdapters();
    adapters.selectionResults.push(
      selectionResult({
        recommendedWorkflow: "quick-fix",
        reason: "This initially appears to be a local fix."
      }),
      selectionResult({
        recommendedWorkflow: "strict",
        reason: "The accepted escalation requires formal planning.",
        escalationTriggers: ["public API"]
      })
    );
    adapters.implementationResults.push(
      phaseResult("implementation", {
        outcome: "needs_human_decision",
        gate: "escalation",
        summary: "The fix changes a public API.",
        questions: ["Approve strict planning for the public API change?"],
        touchedPaths: ["documentation/work/example/work.md"]
      })
    );
    const runner = new WorkflowRunner(repository.root, adapters);

    const waiting = await runner.start({
      slug: "escalated-fix",
      request: "Fix the existing integration response."
    });
    assert.equal(waiting.status, "needs_human_decision");
    assert.equal(waiting.workflowSelection?.workflow, "quick-fix");

    const exactAnswer = "  Yes, use the strict workflow. | $(false)  ";
    const replanned = await runner.answerHumanDecision({
      answers: [exactAnswer],
      decidedBy: "human"
    });
    assert.equal(replanned.status, "needs_plan_approval");
    assert.equal(replanned.workflowSelection?.workflow, "strict");
    assert.equal(adapters.selectionPrompts.length, 2);
    const answeredDecision = replanned.humanDecisions?.at(-1);
    assert.ok(answeredDecision?.kind === "escalation");
    assert.deepEqual(answeredDecision.answers, [exactAnswer]);
    assert.match(
      adapters.selectionPrompts[1] ?? "",
      /Yes, use the strict workflow\. \| \$\(false\)/
    );
    await assert.rejects(
      readFile(path.join(repository.root, "src/example.txt"), "utf8"),
      /ENOENT/
    );
  } finally {
    await repository.dispose();
  }
});

test("a lite escalation after source changes blocks instead of reselecting", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new FakeAdapters();
    adapters.writeSourceBeforeEscalation = true;
    adapters.selectionResults.push(
      selectionResult({
        recommendedWorkflow: "feature",
        reason: "This appears to be a small capability."
      })
    );
    adapters.implementationResults.push(
      phaseResult("implementation", {
        outcome: "needs_human_decision",
        gate: "escalation",
        summary: "Architecture changed.",
        questions: ["Proceed?"],
        touchedPaths: ["src/example.txt"]
      })
    );
    const runner = new WorkflowRunner(repository.root, adapters);

    const state = await runner.start({
      slug: "late-escalation",
      request: "Add a small capability."
    });
    assert.equal(state.status, "blocked");
    assert.match(state.blockReason ?? "", /after source changes/);
  } finally {
    await repository.dispose();
  }
});

test("phases advertise Serena symbol tools only when the whitelist resolves", async () => {
  const repository = await createTestRepository();
  try {
    class WhitelistedAdapters extends FakeAdapters {
      async resolveMcpWhitelist() {
        const server = {
          command: "serena",
          args: ["start-mcp-server"],
          env: {},
          startupTimeoutSec: null
        };
        return { claude: server, codex: server, notes: [] };
      }
    }
    const adapters = new WhitelistedAdapters();
    adapters.reviewResults.push(passingReview());
    const runner = new WorkflowRunner(repository.root, adapters);

    const planned = await runner.start({
      slug: "serena-guidance",
      request: "Plan the example."
    });
    assert.equal(
      planned.status,
      "needs_plan_approval",
      planned.blockReason ?? ""
    );
    await runner.approvePlan("human", true);

    const guidance =
      /Serena MCP server's read-only symbol tools[\s\S]*find_referencing_symbols/;
    assert.match(adapters.phasePrompts[0] ?? "", guidance);
    const implementation =
      adapters.phasePrompts.find((prompt) =>
        prompt.includes("Phase: implementation")
      ) ?? "";
    assert.match(implementation, guidance);
    assert.match(adapters.reviewPrompts[0] ?? "", guidance);
  } finally {
    await repository.dispose();
  }
});

test("an externally mutated approved bundle restores from the snapshot and retries", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new FakeAdapters();
    adapters.reviewResults.push(passingReview());
    const runner = new WorkflowRunner(repository.root, adapters);
    const planned = await runner.start({
      slug: "example",
      request: "Implement it."
    });
    assert.equal(planned.status, "needs_plan_approval");
    const approved = await runner.approvePlan("human", false);
    assert.equal(approved.status, "plan_approved");

    const planFile = await boundFixturePath(repository.root, planPath);
    const approvedBytes = await readFile(planFile, "utf8");
    await writeFile(
      planFile,
      `${approvedBytes}\nExternal edit from another session.\n`,
      "utf8"
    );

    await assert.rejects(runner.resume(), /banzai restore/);
    const blocked = await runner.store.readState(planned.runId);
    assert.equal(blocked.status, "blocked");
    assert.match(blocked.blockReason ?? "", /banzai restore/);

    const status = await runner.status();
    assert.equal(status.retry.eligible, true);
    assert.match(status.retry.reason, /Implementation checks can be retried/);

    const eligibility = await runner.restoreEligibility();
    assert.equal(eligibility.eligible, true, eligibility.reason);
    const restored = await runner.restoreApproval();
    assert.ok(
      restored.includes(
        requiredFixture(
          requiredFixture(planned.artifactBinding).binding.artifacts.plan
        )
      )
    );
    assert.equal(await readFile(planFile, "utf8"), approvedBytes);

    const done = await runner.retry();
    assert.equal(done.status, "done", done.blockReason ?? "");
  } finally {
    await repository.dispose();
  }
});

test("a fix-checks approval failure restores and retries from the fixing block", async () => {
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
    adapters.reviewResults.push(passingReview(["R1-F1"]));
    const runner = new WorkflowRunner(repository.root, adapters);
    await runner.start({ slug: "example", request: "Implement it." });
    const triaged = await runner.approvePlan("human");
    assert.equal(triaged.status, "needs_triage");
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
    assert.equal(fixing.status, "fixing");

    const planFile = await boundFixturePath(repository.root, planPath);
    const approvedBytes = await readFile(planFile, "utf8");
    await writeFile(
      planFile,
      approvedBytes.replace("Implement the fixture", "Externally renamed"),
      "utf8"
    );

    await assert.rejects(runner.resume(), /banzai restore/);
    const blocked = await runner.store.readState(fixing.runId);
    assert.equal(blocked.status, "blocked");
    assert.equal(blocked.blockedFrom, "fixing");

    const status = await runner.status();
    assert.equal(status.retry.eligible, true);
    assert.match(status.retry.reason, /Fix checks can be retried/);

    await runner.restoreApproval();
    assert.equal(await readFile(planFile, "utf8"), approvedBytes);

    const done = await runner.retry();
    assert.equal(done.status, "done", done.blockReason ?? "");
  } finally {
    await repository.dispose();
  }
});

test("preflight checks each configured vendor once, including the implementer", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new FakeAdapters();
    const runner = new WorkflowRunner(repository.root, adapters);

    await runner.start({
      slug: "vendor-preflight",
      request: "Plan the example."
    });

    // The harness points every role at one executable. Planning and
    // implementation share a vendor and are checked once between them, the
    // reviewer's vendor is checked even though review has not run, and both
    // selection and strict planning re-check the planner vendor.
    assert.equal(adapters.codexPreflights, 3);
    assert.equal(adapters.claudePreflights, 1);
  } finally {
    await repository.dispose();
  }
});

test("each runner numbers its progress activities from one", async () => {
  const repositories = [
    await createTestRepository(),
    await createTestRepository()
  ];
  try {
    const firstIds: string[] = [];
    for (const repository of repositories) {
      const ids: string[] = [];
      const runner = new WorkflowRunner(
        repository.root,
        new FakeAdapters(),
        undefined,
        (event) => {
          if (event.kind === "activity_started") ids.push(event.id);
        }
      );
      await runner.start({ slug: "progress-example", request: "Plan it." });
      firstIds.push(ids[0] ?? "none");
      assert.ok(ids.length > 1, JSON.stringify(ids));
    }
    assert.deepEqual(firstIds, ["activity-1", "activity-1"]);
  } finally {
    for (const repository of repositories) await repository.dispose();
  }
});

test("workflow reports preflight and model phase progress", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new FakeAdapters();
    const events: ProgressEvent[] = [];
    const runner = new WorkflowRunner(
      repository.root,
      adapters,
      undefined,
      (event) => events.push(event)
    );

    const state = await runner.start({
      slug: "progress-example",
      request: "Plan the example."
    });

    assert.equal(state.status, "needs_plan_approval");
    assert.ok(
      events.some(
        (event) =>
          event.kind === "activity_started" && event.label === "Preflight"
      )
    );
    assert.ok(
      events.some(
        (event) =>
          event.kind === "activity_started" &&
          event.label === "Planning" &&
          event.detail.includes("model=") &&
          event.detail.includes("attempt=") &&
          event.detail.includes("phases=planning")
      )
    );
    // Model actions are forwarded structurally, so a presenter can filter them
    // by verbosity rather than parse a formatted string back apart.
    assert.ok(
      events.some(
        (event) =>
          event.kind === "model_action" &&
          event.label === "Planning" &&
          event.action === "skill" &&
          event.status === "started" &&
          event.detail === "banzai:feature-description"
      )
    );
    assert.ok(
      events.some(
        (event) =>
          event.kind === "activity_completed" && event.label === "Planning"
      )
    );
  } finally {
    await repository.dispose();
  }
});

test("approval digest drift blocks implementation before another model call", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new FakeAdapters();
    const runner = new WorkflowRunner(repository.root, adapters);
    await runner.start({ slug: "example", request: "Plan it." });
    await runner.approvePlan("human", false);
    await writeFile(
      await boundFixturePath(repository.root, planPath),
      "# Plan\n\nChanged after approval.\n",
      "utf8"
    );

    await assert.rejects(runner.resume(), /artifacts changed/);
    const status = await runner.status();
    assert.equal(status.state.status, "blocked");
    assert.equal(status.planApprovalValid, false);
    assert.equal(adapters.phasePrompts.length, 1);
  } finally {
    await repository.dispose();
  }
});

for (const editGuidance of [false, true]) {
  test(`plan authority approval and completion preserve optional bytes (edit=${editGuidance})`, async () => {
    const repository = await createTestRepository();
    try {
      let plan = await readFile(
        path.join(
          process.cwd(),
          "test/fixtures/plan-authority/opted-in-plan.md"
        ),
        "utf8"
      );
      const adapters = new FakeAdapters();
      adapters.reviewResults.push(passingReview());
      const runner = new WorkflowRunner(repository.root, adapters);
      await runner.start({ slug: "example", request: "Plan it." });
      const target = await boundFixturePath(repository.root, planPath);
      await writeFixturePlan(target, plan);
      plan = await readFile(target, "utf8");
      const approved = await runner.approvePlan("human", false);
      assert.ok(approved.planApproval);
      const snapshot = await runner.store.readApprovalSnapshot(approved.runId);
      assert.ok(snapshot);
      assert.equal(snapshot.digest, approved.planApproval.digest);
      assert.equal(
        snapshot.entries
          .find(
            (entry) => entry.path === path.relative(repository.root, target)
          )
          ?.contents.toString("utf8"),
        plan
      );

      if (editGuidance) {
        await writeFile(
          target,
          plan.replace("`writeFixture`", "`anotherHelper`")
        );
        await assert.rejects(runner.resume(), /artifacts changed/);
        const status = await runner.status();
        assert.equal(status.state.status, "blocked");
        assert.equal(status.planApprovalValid, false);
        assert.equal(adapters.phasePrompts.length, 1);
      } else {
        const done = await runner.resume();
        assert.equal(done.status, "done", done.blockReason ?? "");
        assert.equal(done.planTaskCompletion?.status, "valid");
        assert.equal(done.planTaskCompletion.counts.completed, 1);
        const report = await readFile(
          await boundFixturePath(
            repository.root,
            "documentation/work/example/implementation-report.md"
          ),
          "utf8"
        );
        assert.deepEqual(
          parsePublishedCompletionRegion(Buffer.from(report)),
          phaseResult("implementation").taskCompletion
        );
        assert.equal(await readFile(target, "utf8"), plan);
        assert.equal((await runner.status()).planApprovalValid, true);
      }
      assert.deepEqual(
        await runner.store.readApprovalSnapshot(approved.runId),
        snapshot
      );
    } finally {
      await repository.dispose();
    }
  });
}

test("implementation escalation waits for an interactive answer and replans", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new FakeAdapters();
    adapters.implementationResults.push(
      phaseResult("implementation", {
        outcome: "needs_human_decision",
        gate: "escalation",
        summary: "A compatibility decision is required.",
        questions: ["Must the existing behavior remain backward compatible?"]
      })
    );
    const runner = new WorkflowRunner(repository.root, adapters);
    await runner.start({ slug: "example", request: "Implement it." });

    const gated = await runner.approvePlan("human");
    assert.equal(gated.status, "needs_human_decision");
    assert.ok(gated.pendingHumanDecision?.kind === "escalation");
    assert.equal(gated.pendingHumanDecision.phase, "implementation");
    assert.deepEqual(gated.pendingHumanDecision.questions, [
      "Must the existing behavior remain backward compatible?"
    ]);
    assert.equal((await runner.status()).nextAction, "banzai");

    const planning = await runner.answerHumanDecision(
      {
        answers: ["Yes, preserve backward compatibility."],
        decidedBy: "human"
      },
      false
    );
    assert.equal(planning.status, "planning");
    assert.equal(planning.planApproval, null);
    assert.equal(planning.pendingHumanDecision, null);

    const replanned = await runner.resume();
    assert.equal(replanned.status, "needs_plan_approval");
    assert.match(
      adapters.phasePrompts[2] ?? "",
      /Yes, preserve backward compatibility\./
    );
  } finally {
    await repository.dispose();
  }
});

test("planning escalation waits for an interactive answer instead of blocking", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new FakeAdapters();
    adapters.planResults.push(
      phaseResult("plan", {
        outcome: "needs_human_decision",
        gate: "escalation",
        summary: "A product decision is required.",
        questions: ["Should the feature support the legacy behavior?"]
      }),
      phaseResult("plan")
    );
    const runner = new WorkflowRunner(repository.root, adapters);

    const gated = await runner.start({
      slug: "example",
      request: "Plan the product change."
    });
    assert.equal(gated.status, "needs_human_decision");
    assert.ok(gated.pendingHumanDecision?.kind === "escalation");
    assert.equal(gated.pendingHumanDecision.phase, "plan");

    const replanned = await runner.answerHumanDecision({
      answers: ["Yes, retain the legacy behavior."],
      decidedBy: "human"
    });
    assert.equal(replanned.status, "needs_plan_approval");
    assert.match(
      adapters.phasePrompts[1] ?? "",
      /Yes, retain the legacy behavior\./
    );
  } finally {
    await repository.dispose();
  }
});

test("planning consultation binds keyed answers and resumes from durable history", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new FakeAdapters();
    adapters.planResults.push(
      decisionConsultationResult(),
      phaseResult("plan")
    );
    const runner = new WorkflowRunner(repository.root, adapters);

    const waiting = await runner.start({
      slug: "consultation",
      request: "Plan a storage-sensitive feature."
    });
    assert.equal(waiting.status, "needs_human_decision");
    const pending = waiting.pendingHumanDecision;
    assert.ok(pending?.kind === "decision_consultation");
    assert.equal(pending.request.requestId, "request-1");
    assert.equal(waiting.planApproval, null);
    const before = JSON.stringify(waiting);
    await assert.rejects(
      runner.answerDecisionConsultation(
        {
          runId: waiting.runId,
          requestId: "stale-request",
          roundId: "round-1",
          answers: [
            {
              decisionId: "storage-model",
              response: {
                kind: "option",
                optionId: "reuse-store",
                text: null
              },
              note: null
            }
          ],
          decidedBy: "human"
        },
        false
      ),
      /stale/
    );
    assert.equal(
      JSON.stringify(await runner.store.requireActiveState()),
      before
    );

    const exactPreference =
      "  Keep it local | $(touch /tmp/never)\\nfor now.  ";
    const planning = await runner.answerDecisionConsultation(
      {
        runId: waiting.runId,
        requestId: "request-1",
        roundId: "round-1",
        answers: [
          {
            decisionId: "storage-model",
            response: {
              kind: "preference",
              optionId: null,
              text: exactPreference
            },
            note: "Prefer the existing operational boundary."
          }
        ],
        decidedBy: "human"
      },
      false
    );
    assert.equal(planning.status, "planning");
    assert.equal(planning.planApproval, null);
    assert.equal(planning.pendingHumanDecision, null);
    const record = planning.humanDecisions?.at(-1);
    assert.ok(record?.kind === "decision_consultation");
    assert.equal(record.runId, waiting.runId);
    assert.equal(record.requestId, "request-1");
    assert.equal(record.answers[0]?.response.text, exactPreference);

    const replanned = await runner.resume();
    assert.equal(replanned.status, "needs_plan_approval");
    assert.match(adapters.phasePrompts[1] ?? "", /Keep it local/);
    assert.match(adapters.phasePrompts[1] ?? "", /storage-model/);

    const events = await readFile(
      path.join(runner.store.runDirectory(waiting.runId), "events.jsonl"),
      "utf8"
    );
    const consultationEvents = events
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((event) =>
        String(event.type).startsWith("decision.consultation.")
      );
    assert.deepEqual(
      consultationEvents.map(({ type, details }) => ({ type, details })),
      [
        {
          type: "decision.consultation.requested",
          details: { cardCount: 1, completion: "pending" }
        },
        {
          type: "decision.consultation.answered",
          details: {
            cardCount: 1,
            answerModes: { option: 0, preference: 1 },
            completion: "answered"
          }
        }
      ]
    );
    const consultationEventJson = JSON.stringify(
      consultationEvents.map(({ type, details }) => ({ type, details }))
    );
    for (const forbidden of [
      "request-1",
      "round-1",
      "storage-model",
      "reuse-store",
      "Which storage model",
      "Reuse the store",
      "approved runner authority",
      "Keep it local",
      "existing operational boundary",
      "packages/orchestrator/src/store.ts",
      "human"
    ]) {
      assert.doesNotMatch(consultationEventJson, new RegExp(forbidden));
    }
  } finally {
    await repository.dispose();
  }
});

test("planning consultation rejects reused answered decision identities", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new FakeAdapters();
    adapters.planResults.push(
      decisionConsultationResult(),
      decisionConsultationResult({
        requestId: "request-2",
        roundId: "round-2"
      })
    );
    const runner = new WorkflowRunner(repository.root, adapters);
    const waiting = await runner.start({
      slug: "consultation-replay",
      request: "Plan a storage-sensitive feature."
    });
    const blocked = await runner.answerDecisionConsultation({
      runId: waiting.runId,
      requestId: "request-1",
      roundId: "round-1",
      answers: [
        {
          decisionId: "storage-model",
          response: {
            kind: "option",
            optionId: "reuse-store",
            text: null
          },
          note: null
        }
      ],
      decidedBy: "human"
    });
    assert.equal(blocked.status, "blocked");
    assert.match(blocked.blockReason ?? "", /reused an answered/);
    assert.equal(blocked.humanDecisions?.length, 1);
  } finally {
    await repository.dispose();
  }
});

test("a run starts on a dirty checkout and records the carried-in changes", async () => {
  const repository = await createTestRepository();
  try {
    // Unrelated tool output, exactly the case that used to block a run.
    await mkdir(path.join(repository.root, ".serena"), { recursive: true });
    await writeFile(
      path.join(repository.root, ".serena/project.yml"),
      "name: playground\n",
      "utf8"
    );
    await writeFile(
      path.join(repository.root, "notes.txt"),
      "unrelated\n",
      "utf8"
    );

    const adapters = new FakeAdapters();
    const events: ProgressEvent[] = [];
    const runner = new WorkflowRunner(
      repository.root,
      adapters,
      undefined,
      (event) => events.push(event)
    );

    const state = await runner.start({
      slug: "example",
      request: "Start on a dirty tree."
    });

    assert.equal(state.status, "needs_plan_approval");
    assert.deepEqual(
      (state.baseline ?? []).map((entry) => entry.path),
      [".serena/project.yml", "notes.txt"]
    );
    assert.equal(adapters.phasePrompts.length, 1);
    assert.ok(
      events.some(
        (event) =>
          event.kind === "info" &&
          event.message.includes("2 carried-in changes") &&
          event.message.includes(".serena/project.yml")
      )
    );
  } finally {
    await repository.dispose();
  }
});

test("carried-in changes stay out of the reviewed set until the run touches them", async () => {
  const repository = await createTestRepository();
  try {
    await writeFile(
      path.join(repository.root, "unrelated.txt"),
      "developer work\n",
      "utf8"
    );
    const adapters = new FakeAdapters();
    adapters.reviewResults.push(passingReview());
    const runner = new WorkflowRunner(repository.root, adapters);

    await runner.start({ slug: "example", request: "Implement it." });
    await runner.approvePlan("human", true);

    const reviewed = adapters.reviewPrompts[0] ?? "";
    // The implementer's file is reviewed; the developer's is not.
    assert.ok(reviewed.includes("src/example.txt"));
    assert.equal(reviewed.includes("unrelated.txt"), false);
  } finally {
    await repository.dispose();
  }
});

test("a carried-in file the run edits re-enters the reviewed set", async () => {
  const repository = await createTestRepository();
  try {
    const carried = path.join(repository.root, "src/example.txt");
    await mkdir(path.join(repository.root, "src"), { recursive: true });
    // Present before the run, then rewritten by the fake implementation phase.
    await writeFile(carried, "developer version\n", "utf8");

    const adapters = new FakeAdapters();
    adapters.reviewResults.push(passingReview());
    const runner = new WorkflowRunner(repository.root, adapters);

    const started = await runner.start({
      slug: "example",
      request: "Implement it."
    });
    assert.deepEqual(
      (started.baseline ?? []).map((entry) => entry.path),
      ["src/example.txt"]
    );

    await runner.approvePlan("human", true);

    const reviewed = adapters.reviewPrompts[0] ?? "";
    assert.ok(reviewed.includes("src/example.txt"));
  } finally {
    await repository.dispose();
  }
});

test("another active run is rejected even after the checkout is cleaned", async () => {
  const repository = await createTestRepository();
  try {
    const firstAdapters = new FakeAdapters();
    const first = new WorkflowRunner(repository.root, firstAdapters);
    await first.start({ slug: "example", request: "First run." });
    // Tracking the planning documents does not replace approval or run ownership.
    await commitAll(repository.root, "Track reviewable planning documents");
    assert.equal(
      spawnSync("git", ["status", "--porcelain"], {
        cwd: repository.root,
        encoding: "utf8"
      }).stdout.trim(),
      ""
    );

    const secondAdapters = new FakeAdapters();
    const second = new WorkflowRunner(repository.root, secondAdapters);
    await assert.rejects(
      second.start({ slug: "another", request: "Second run." }),
      /is still needs_plan_approval/
    );
    assert.equal(secondAdapters.phasePrompts.length, 0);
  } finally {
    await repository.dispose();
  }
});

test("human time: runner records plan and triage boundaries before continuation without exposing decision contents", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new FakeAdapters();
    adapters.reviewResults.push({
      contractVersion: CONTRACT_VERSION,
      verdict: "changes_requested",
      summary: "PRIVATE_REVIEW",
      findings: [finding("R1-F1", "PRIVATE_FINDING")],
      reviewedFindingIds: [],
      deferredCoverage: []
    });
    const warnings: string[] = [];
    const boundaries: HumanTimeBoundary[] = [];
    const time = new InteractiveHumanTime(
      new HumanTimeStore(repository.root),
      () => {
        warnings.push("unsaved");
      }
    );
    let triagePersistedBeforeState = false;
    const runner = new WorkflowRunner(
      repository.root,
      adapters,
      undefined,
      undefined,
      async (boundary) => {
        boundaries.push(boundary);
        if (boundary.eventType === "approval.plan")
          assert.equal(adapters.phasePrompts.length, 1);
        if (boundary.eventType === "review.triaged")
          triagePersistedBeforeState =
            (await runner.store.readState(boundary.runId)).status ===
            "needs_triage";
        await time.observe(boundary);
      }
    );
    const pending = await runner.start({
      slug: "example",
      request: "PRIVATE_REQUEST"
    });
    assert.equal(pending.status, "needs_plan_approval");
    assert.equal((await time.readSummary(pending.runId)).openCount, 1);
    const reviewed = await runner.approvePlan("PRIVATE_ACTOR");
    assert.equal(reviewed.status, "needs_triage");
    const before = await time.readSummary(pending.runId);
    assert.equal(before.answeredCount, 1);
    assert.equal(before.openCount, 1);
    assert.equal(before.effort, null);
    await assert.rejects(
      runner.triage({
        accepted: ["unknown-finding"],
        rejected: [],
        deferred: [],
        note: null,
        decidedBy: "PRIVATE_ACTOR"
      })
    );
    assert.equal(
      boundaries.filter((b) => b.eventType === "review.triaged").length,
      0
    );
    const done = await runner.triage({
      accepted: [],
      rejected: ["R1-F1"],
      deferred: [],
      note: "PRIVATE_NOTE",
      decidedBy: "PRIVATE_ACTOR"
    });
    assert.equal(done.status, "done", done.blockReason ?? "");
    assert.equal(triagePersistedBeforeState, true);
    assert.equal(
      boundaries.filter((b) => b.eventType === "review.triaged").length,
      1
    );
    const summary = await time.readSummary(done.runId);
    assert.equal(summary.answeredCount, 2);
    assert.equal(summary.unavailableCount, 0);
    assert.deepEqual(warnings, []);
    const ledger = await readFile(
      path.join(runner.store.runDirectory(done.runId), "human-time.json"),
      "utf8"
    );
    assert.ok(!ledger.includes("PRIVATE_"));
    assert.ok(!JSON.stringify(boundaries).includes("PRIVATE_"));
    await time.detach();
  } finally {
    await repository.dispose();
  }
});

test("human time: failed observation and failed following implementation never replay a recorded approval", async () => {
  for (const observerFails of [false, true]) {
    const repository = await createTestRepository();
    try {
      const adapters = new FakeAdapters();
      adapters.implementationErrors.push(
        new Error("synthetic following implementation failure")
      );
      const time = new InteractiveHumanTime(
        new HumanTimeStore(repository.root),
        () => {}
      );
      let approvals = 0;
      const runner = new WorkflowRunner(
        repository.root,
        adapters,
        undefined,
        undefined,
        async (boundary) => {
          if (boundary.eventType === "approval.plan") approvals++;
          if (observerFails) throw Error("synthetic observation failure");
          await time.observe(boundary);
        }
      );
      const pending = await runner.start({
        slug: "example",
        request: "Implement it."
      });
      const blocked = await runner.approvePlan("human");
      assert.equal(blocked.status, "blocked");
      assert.equal(approvals, 1);
      assert.equal(adapters.phasePrompts.length, 2);
      assert.notEqual(blocked.planApproval, null);
      if (!observerFails)
        assert.equal((await time.readSummary(pending.runId)).answeredCount, 1);
      await time.detach();
    } finally {
      await repository.dispose();
    }
  }
});

test("human time: ADR, consultation and escalation retain distinct attempt identities through cancellation", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new FakeAdapters();
    adapters.planResults.push(
      phaseResult("plan", { gate: "adr_approval" }),
      decisionConsultationResult(),
      phaseResult("plan", {
        gate: "escalation",
        questions: ["Choose an option."]
      }),
      phaseResult("plan")
    );
    const time = new InteractiveHumanTime(
      new HumanTimeStore(repository.root),
      () => {}
    );
    const runner = new WorkflowRunner(
      repository.root,
      adapters,
      undefined,
      undefined,
      (boundary) => time.observe(boundary)
    );
    const started = await runner.start({
      slug: "example",
      request: "Plan it."
    });
    assert.equal(started.status, "needs_adr_approval");
    const consultation = await runner.decideAdr({
      id: "ADR-EXAMPLE",
      decision: "rework",
      note: null,
      decidedBy: "human",
      autoResume: true
    });
    assert.equal(consultation.status, "needs_human_decision");
    await runner.answerDecisionConsultation({
      runId: started.runId,
      requestId: "request-1",
      roundId: "round-1",
      answers: [
        {
          decisionId: "storage-model",
          response: { kind: "option", optionId: "reuse-store", text: null },
          note: null
        }
      ],
      decidedBy: "human"
    });
    await runner.answerHumanDecision({
      answers: ["Keep the current option."],
      decidedBy: "human"
    });
    await runner.cancel();
    const summary = await time.readSummary(started.runId);
    assert.deepEqual(
      summary.episodes.map((e) => [e.kind, e.outcome]),
      [
        ["adr_approval", "answered"],
        ["decision_consultation", "answered"],
        ["escalation", "answered"],
        ["plan_approval", "cancelled"]
      ]
    );
    assert.equal(summary.answeredCount, 3);
    assert.equal(summary.effort, null);
    assert.equal(summary.unavailableCount, 0);
    await time.detach();
  } finally {
    await repository.dispose();
  }
});

test("human time: existing evaluation, KPI, context and control reports ignore timing ledgers without writes", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new FakeAdapters();
    const runner = new WorkflowRunner(repository.root, adapters);
    const run = await runner.start({
      slug: "example",
      request: "Plan a bounded feature."
    });
    const filename = path.join(
      runner.store.runDirectory(run.runId),
      "human-time.json"
    );
    const options = {
      format: "json" as const,
      from: null,
      to: null,
      runIds: []
    };
    const reports = async () => {
      const evaluation = await collectEvaluationExport(
        repository.root,
        options
      );
      assert.equal(
        evaluation.runs[0]?.metrics.humanMinutes.availability,
        "unavailable"
      );
      return {
        evaluation,
        kpi: deriveEvaluationKpiReport([
          { label: "frozen-fixture", report: evaluation }
        ]),
        context: await collectContextReport(repository.root, options),
        control: projectAgentControlStatus(await runner.status())
      };
    };
    const baselineTree = await snapshotTree(
      path.join(repository.root, ".banzai")
    );
    const baseline = await reports();
    assert.deepEqual(
      await snapshotTree(path.join(repository.root, ".banzai")),
      baselineTree
    );
    const ledger = emptyHumanTime(run.runId);
    ledger.effortRevisions.push({
      id: "00000000-0000-4000-8000-000000000001",
      replaces: null,
      minutes: 12,
      recordedAt: run.createdAt,
      asOf: run.createdAt,
      basis: "estimated",
      scope: "single_engineer_unverified"
    });
    for (const contents of [
      JSON.stringify(ledger),
      JSON.stringify({
        schema: "future-human-time",
        schemaVersion: 2,
        secret: "PRIVATE_TIME_CANARY"
      }),
      "invalid PRIVATE_TIME_CANARY"
    ]) {
      await writeFile(filename, contents, { mode: 0o600 });
      const before = await snapshotTree(path.join(repository.root, ".banzai"));
      const actual = await reports();
      assert.deepEqual(actual, baseline);
      assert.ok(!JSON.stringify(actual).includes("PRIVATE_TIME_CANARY"));
      assert.deepEqual(
        await snapshotTree(path.join(repository.root, ".banzai")),
        before
      );
    }
  } finally {
    await repository.dispose();
  }
});

test("cancellation: a late model result remains physical evidence without a failed rewrite or next phase", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new FakeAdapters();
    const runSelection = adapters.runSelection.bind(adapters);
    const runner = new WorkflowRunner(repository.root, adapters);
    adapters.runSelection = async (request) => {
      const result = await runSelection(request);
      await runner.cancel({ reason: "intent_changed" });
      return result;
    };
    const state = await runner.start({
      slug: "example",
      request: "Synthetic late selection."
    });
    assert.equal(state.status, "cancelled");
    assert.equal(adapters.phasePrompts.length, 0);
    assert.ok(state.activeAttempt);
    const record = await runner.store.readRunAttempt(
      state.runId,
      state.activeAttempt
    );
    assert.equal(record.status, "completed");
    assert.equal(record.failureCode, null);
    assert.ok(record.result);
    assert.equal(
      (await runner.store.readState(state.runId)).status,
      "cancelled"
    );
  } finally {
    await repository.dispose();
  }
});

test("cancellation: late model registration is stopped and cannot resurrect or advance the run", async () => {
  const repository = await createTestRepository();
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    detached: true,
    stdio: "ignore"
  });
  const exit = new Promise<void>((resolve) =>
    child.once("exit", () => {
      resolve();
    })
  );
  try {
    const adapters = new FakeAdapters();
    const runner = new WorkflowRunner(repository.root, adapters);
    adapters.runSelection = async (request) => {
      await runner.cancel();
      assert.ok(child.pid);
      await request.onStart(child.pid);
      throw new Error("A cancelled registration must not continue.");
    };
    const state = await runner.start({
      slug: "example",
      request: "Synthetic registration race."
    });
    assert.equal(state.status, "cancelled");
    await Promise.race([
      exit,
      new Promise<never>((_, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("Child was not stopped."));
        }, 3000);
        timeout.unref();
      })
    ]);
    assert.equal(adapters.phasePrompts.length, 0);
    assert.ok(state.activeAttempt);
    assert.equal(
      (await runner.store.readRunAttempt(state.runId, state.activeAttempt))
        .status,
      "started"
    );
    assert.equal(
      (await runner.store.readState(state.runId)).activeProcess,
      null
    );
  } finally {
    if (child.pid !== undefined) {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        /* Exited already. */
      }
    }
    await repository.dispose();
  }
});

test("cancellation: late verification registration leaves interrupted evidence and starts no review", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new FakeAdapters();
    const processRunner: ProcessRunner = async (request) => {
      await runner.cancel();
      await request.onStart?.(999999999);
      throw new Error("The stopped registration must unwind.");
    };
    const runner = new WorkflowRunner(repository.root, adapters, processRunner);
    await runner.start({
      slug: "example",
      request: "Synthetic verification registration."
    });
    const state = await runner.approvePlan("human");
    assert.equal(state.status, "cancelled");
    assert.equal(adapters.reviewPrompts.length, 0);
    const attempts = await readTaskVerificationAttempts({
      repoRoot: repository.root,
      workId: requiredFixture(state.artifactBinding).binding.workId,
      directory: requiredFixture(
        requiredFixture(state.artifactBinding).binding.artifacts
          .verificationDirectory
      )
    });
    assert.equal(attempts.at(-1)?.status, "interrupted");
  } finally {
    await repository.dispose();
  }
});

test("guided planning retains manifest tasks with control-path constraints and read-only evidence through approval", async () => {
  const repository = await createTestRepository({ artifactLayout: "private" });
  try {
    class ManifestPlanAdapters extends FakeAdapters {
      override async runPhase(
        request: PhaseAdapterRequest
      ): Promise<AdapterResult<PhaseResult>> {
        const result = await super.runPhase(request);
        if (result.result.phase === "plan") {
          const target = path.join(
            request.repoRoot,
            requiredFixture(result.result.artifacts.plan)
          );
          await writeFixturePlan(
            target,
            (await readFile(target, "utf8")).replace(
              "## Implementation Tasks",
              "## Implementation Tasks\n\n- [ ] **T002 - Synchronize manifest facts**\n\n  - Update `PROJECT_MANIFEST.md`.\n  - Do not add scripts, dependencies, verification commands, application\n    architecture, or any `.banzai/` change.\n  - Review the updated statements against `package.json` and\n    `.banzai/config.json`.\n"
            )
          );
        }
        return result;
      }
    }
    const runner = new WorkflowRunner(
      repository.root,
      new ManifestPlanAdapters()
    );
    const state = await runner.start({
      slug: "manifest-control-references",
      request: "Initialize the application."
    });
    assert.equal(state.status, "needs_plan_approval");
    const planPath = path.join(
      repository.root,
      requiredFixture(state.planArtifacts?.plan)
    );
    const offered = await readFile(planPath, "utf8");
    assert.match(offered, /T002 - Synchronize manifest facts/u);
    assert.equal(
      (await runner.approvePlan("human", false)).status,
      "plan_approved"
    );
    assert.equal(await readFile(planPath, "utf8"), offered);
  } finally {
    await repository.dispose();
  }
});

for (const targetRole of [
  "config",
  "fix_report",
  "case_alias",
  "sibling_alias"
] as const)
  test(`guided planning rejects ${targetRole} tasks before approval can be offered`, async () => {
    const repository = await createTestRepository({
      artifactLayout: "private"
    });
    try {
      class InvalidPlanAdapters extends FakeAdapters {
        override async runPhase(
          request: PhaseAdapterRequest
        ): Promise<AdapterResult<PhaseResult>> {
          const result = await super.runPhase(request);
          if (result.result.phase === "plan") {
            const target = path.join(
              request.repoRoot,
              requiredFixture(result.result.artifacts.plan)
            );
            await writeFixturePlan(
              target,
              (await readFile(target, "utf8"))
                .replace(
                  "## Implementation Tasks",
                  "## Human prerequisites\n\nConfigure verification using banzai verify.\n\n## Implementation Tasks"
                )
                .replace(
                  "**T001 -",
                  `**T001 - Update ${targetRole === "config" ? ".banzai/config.json" : targetRole === "case_alias" ? ".Banzai/config.json" : targetRole === "sibling_alias" ? `../${path.basename(request.repoRoot)}/.banzai/config.json` : path.posix.join(path.posix.dirname(requiredFixture(result.result.artifacts.plan)), "change-report.md")} and`
                )
            );
          }
          return result;
        }
      }
      const adapters = new InvalidPlanAdapters();
      const runner = new WorkflowRunner(repository.root, adapters);
      const state = await runner.start({
        slug: "bad-config-task",
        request: "Initialize the application."
      });
      assert.equal(state.status, "blocked");
      assert.equal(state.planApproval, null);
      assert.match(state.blockReason ?? "", /T001.*runner control path/u);
      await assert.rejects(runner.approvePlan("human"));
      assert.equal(
        adapters.phasePrompts.filter((prompt) =>
          prompt.includes("Phase: implementation")
        ).length,
        0
      );
    } finally {
      await repository.dispose();
    }
  });

test("accepted review F3 committed approval renders prerequisites as inert text", async () => {
  const repository = await createTestRepository({ artifactLayout: "private" });
  try {
    const runner = new WorkflowRunner(repository.root, new FakeAdapters());
    const state = await runner.start({
      slug: "approval-preview",
      request: "A harmless task"
    });
    assert.equal(state.status, "needs_plan_approval");
    const planPath = path.join(
      repository.root,
      requiredFixture(state.planArtifacts?.plan)
    );
    let plan =
      (await readFile(planPath, "utf8")) +
      "\n## Human prerequisites\nNormal multiline\n\x1b[2J\x1b]0;canary\x07\u202eCanary\n";
    await writeFixturePlan(planPath, plan);
    plan = await readFile(planPath, "utf8");
    const result = spawnSync(
      process.execPath,
      [
        path.join(process.cwd(), "dist/banzai.mjs"),
        "approve",
        "plan",
        "--no-resume"
      ],
      { cwd: repository.root, encoding: "utf8", env: monochromeEnv() }
    );
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout, /[\x1b\x07\u202e]/u);
    assert.match(result.stdout, /Normal multiline\n/u);
    assert.match(result.stdout, /\\u001b\[2J/u);
    assert.equal(await readFile(planPath, "utf8"), plan);
  } finally {
    await repository.dispose();
  }
});

test("accepted review F5 approval denies a fix-only report in implementation tasks", async () => {
  const repository = await createTestRepository({ artifactLayout: "private" });
  try {
    const runner = new WorkflowRunner(repository.root, new FakeAdapters());
    const state = await runner.start({
      slug: "phase-guard",
      request: "A harmless task"
    });
    assert.equal(state.status, "needs_plan_approval");
    const roles = requiredFixture(state.artifactBinding).binding.artifacts;
    const planPath = path.join(
      repository.root,
      requiredFixture(state.planArtifacts?.plan)
    );
    const plan = await readFile(planPath, "utf8");
    await writeFixturePlan(
      planPath,
      plan + `\nDuring implementation write \`${roles.changeReport}\`.\n`
    );
    await assert.rejects(runner.approvePlan("human", false), {
      code: "PLAN_RUNNER_CONTROL_TASK"
    });
    await writeFixturePlan(
      planPath,
      plan +
        `\nDuring implementation write \`${roles.implementationReport}\` and \`${roles.testReport}\`.\n`
    );
    assert.equal(
      (await runner.approvePlan("human", false)).status,
      "plan_approved"
    );
  } finally {
    await repository.dispose();
  }
});

test("characterization: a lite quick-fix run completes", async () => {
  const repository = await createTestRepository();
  const trace = recordPersistence();
  try {
    const adapters = new FakeAdapters();
    adapters.selectionResults.push(
      selectionResult({
        recommendedWorkflow: "quick-fix",
        reason: "This corrects existing behavior."
      })
    );
    const runner = new WorkflowRunner(repository.root, adapters);
    const done = await runner.start({
      slug: "small-fix",
      request: "Fix the existing label."
    });
    assert.equal(done.status, "done", done.blockReason ?? "");
    await assertTraceComplete(trace, runner.store, done.runId);
    await assertTrace(trace, repository.root, TRACE_LITE);
  } finally {
    trace.stop();
    await repository.dispose();
  }
});

test("characterization: a strict run passes review after plan approval", async () => {
  const repository = await createTestRepository();
  const trace = recordPersistence();
  try {
    const adapters = new FakeAdapters();
    adapters.reviewResults.push(passingReview());
    const runner = new WorkflowRunner(repository.root, adapters);
    const planned = await runner.start({
      slug: "example",
      request: "Implement it."
    });
    assert.equal(planned.status, "needs_plan_approval");
    const done = await runner.approvePlan("human");
    assert.equal(done.status, "done", done.blockReason ?? "");
    await assertTraceComplete(trace, runner.store, done.runId);
    await assertTrace(trace, repository.root, TRACE_STRICT);
  } finally {
    trace.stop();
    await repository.dispose();
  }
});

test("characterization: requested changes are triaged, fixed and re-reviewed", async () => {
  const repository = await createTestRepository();
  const trace = recordPersistence();
  try {
    const adapters = new FakeAdapters();
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
    const runner = new WorkflowRunner(repository.root, adapters);
    await runner.start({ slug: "example", request: "Implement it." });
    const reviewed = await runner.approvePlan("human");
    assert.equal(reviewed.status, "needs_triage");
    const done = await runner.triage({
      accepted: ["R1-F1"],
      rejected: ["R1-F2"],
      deferred: [],
      note: null,
      decidedBy: "human"
    });
    assert.equal(done.status, "done", done.blockReason ?? "");
    await assertTraceComplete(trace, runner.store, done.runId);
    await assertTrace(trace, repository.root, TRACE_FIX_CYCLE);
  } finally {
    trace.stop();
    await repository.dispose();
  }
});

test("characterization: a failed task check blocks and an explicit retry completes", async () => {
  const repository = await createTestRepository();
  const trace = recordPersistence();
  try {
    const { runner } = await blockedByFailedCheck(repository.root);
    const done = await runner.retry();
    assert.equal(done.status, "done", done.blockReason ?? "");
    await assertTraceComplete(trace, runner.store, done.runId);
    await assertTrace(trace, repository.root, TRACE_RETRY);
  } finally {
    trace.stop();
    await repository.dispose();
  }
});

async function interruptedImplementation(root: string) {
  const adapters = new FakeAdapters();
  adapters.implementationErrors.push(new Error("implementation interrupted"));
  adapters.reviewResults.push(passingReview());
  const runner = new WorkflowRunner(root, adapters);
  await runner.start({ slug: "example", request: "Implement it." });
  const blocked = await runner.approvePlan("human");
  const sourceAttempt = blocked.activeAttempt;
  assert.ok(sourceAttempt);
  const sourceRecord = await runner.store.readRunAttempt(
    blocked.runId,
    sourceAttempt
  );
  sourceRecord.status = "started";
  sourceRecord.completedAt = null;
  sourceRecord.durationMs = null;
  sourceRecord.error = null;
  sourceRecord.failureCode = null;
  await runner.store.writeRunAttempt(blocked.runId, sourceRecord);
  return { runner, blocked, sourceAttempt };
}

test("characterization: an interrupted implementation is recovered by authorization", async () => {
  const repository = await createTestRepository();
  const trace = recordPersistence();
  try {
    const { runner, sourceAttempt } = await interruptedImplementation(
      repository.root
    );
    const status = await runner.status();
    assert.equal(status.recovery.eligible, true, status.recovery.reason);
    assert.ok(status.recovery.recoveryIdentity);
    await runner.recover(
      {
        attemptId: sourceAttempt.id,
        recoveryIdentity: status.recovery.recoveryIdentity,
        unknownSideEffectsAccepted: true,
        decidedBy: "current-human"
      },
      false
    );
    const done = await runner.resume();
    assert.equal(done.status, "done", done.blockReason ?? "");
    await assertTraceComplete(trace, runner.store, done.runId);
    await assertTrace(trace, repository.root, TRACE_INTERRUPTED_RECOVERY);
  } finally {
    trace.stop();
    await repository.dispose();
  }
});

test("characterization: a prerequisite-blocked fix is recovered by authorization", async () => {
  const trace = recordPersistence();
  let dispose: (() => Promise<void>) | null = null;
  try {
    const fixture = await prerequisiteBlockedFixFixture();
    dispose = () => fixture.repository.dispose();
    const { runner, sourceRecord } = fixture;
    const status = await runner.status();
    assert.equal(status.recovery.eligible, true, status.recovery.reason);
    assert.ok(status.recovery.recoveryIdentity);
    await runner.recover(
      {
        attemptId: sourceRecord.attempt.id,
        recoveryIdentity: status.recovery.recoveryIdentity,
        unknownSideEffectsAccepted: true,
        decidedBy: "current-human"
      },
      false
    );
    const done = await runner.resume();
    assert.equal(done.status, "done", done.blockReason ?? "");
    await assertTraceComplete(trace, runner.store, done.runId);
    await assertTrace(
      trace,
      fixture.repository.root,
      TRACE_PREREQUISITE_RECOVERY
    );
  } finally {
    trace.stop();
    await dispose?.();
  }
});

test("characterization: a changed approved bundle is restored and retried", async () => {
  const repository = await createTestRepository();
  const trace = recordPersistence();
  try {
    const adapters = new FakeAdapters();
    adapters.reviewResults.push(passingReview());
    const runner = new WorkflowRunner(repository.root, adapters);
    await runner.start({ slug: "example", request: "Implement it." });
    const approved = await runner.approvePlan("human", false);
    assert.equal(approved.status, "plan_approved");
    const planFile = await boundFixturePath(repository.root, planPath);
    const approvedBytes = await readFile(planFile, "utf8");
    await writeFile(
      planFile,
      `${approvedBytes}\nExternal edit from another session.\n`,
      "utf8"
    );
    await assert.rejects(runner.resume(), /banzai restore/);
    const eligibility = await runner.restoreEligibility();
    assert.equal(eligibility.eligible, true, eligibility.reason);
    await runner.restoreApproval();
    const done = await runner.retry();
    assert.equal(done.status, "done", done.blockReason ?? "");
    await assertTraceComplete(trace, runner.store, done.runId);
    await assertTrace(trace, repository.root, TRACE_RESTORE);
  } finally {
    trace.stop();
    await repository.dispose();
  }
});

test("characterization: status on an interrupted strict attempt persists an approval block after the bundle changed", async () => {
  const repository = await createTestRepository();
  const trace = recordPersistence();
  try {
    const { runner, blocked } = await interruptedImplementation(
      repository.root
    );
    const planFile = await boundFixturePath(repository.root, planPath);
    await writeFile(
      planFile,
      `${await readFile(planFile, "utf8")}\nExternal edit from another session.\n`,
      "utf8"
    );
    const status = await runner.status();
    assert.equal(status.recovery.eligible, false);
    await assertTraceComplete(trace, runner.store, blocked.runId);
    await assertTrace(trace, repository.root, TRACE_STATUS_APPROVAL_BLOCK);
  } finally {
    trace.stop();
    await repository.dispose();
  }
});

test("characterization: a blocked run is cancelled", async () => {
  const repository = await createTestRepository();
  const trace = recordPersistence();
  try {
    const { runner, blocked } = await blockedByFailedCheck(repository.root);
    const cancelled = await runner.cancel({ reason: "execution_blocked" });
    assert.equal(cancelled.outcome, "cancelled");
    await assertTraceComplete(trace, runner.store, blocked.runId);
    await assertTrace(trace, repository.root, TRACE_CANCEL);
  } finally {
    trace.stop();
    await repository.dispose();
  }
});

test("characterization: a checkpointed implementation failure is reconciled on resume", async () => {
  const repository = await createTestRepository();
  const trace = recordPersistence();
  try {
    const adapters = new FakeAdapters();
    adapters.failImplementationAfterTerminalCheckpoint = true;
    adapters.reviewResults.push(passingReview());
    const runner = new WorkflowRunner(repository.root, adapters);
    await runner.start({ slug: "example", request: "Implement it." });
    const blocked = await runner.approvePlan("human");
    assert.equal(blocked.status, "blocked", blocked.blockReason ?? "");
    assert.equal(blocked.activeAttempt?.kind, "implementation");
    const done = await runner.resume();
    assert.equal(done.status, "done", done.blockReason ?? "");
    await assertTraceComplete(trace, runner.store, done.runId);
    await assertTrace(
      trace,
      repository.root,
      TRACE_IMPLEMENTATION_CHECKPOINT_RESUME
    );
  } finally {
    trace.stop();
    await repository.dispose();
  }
});

test("characterization: a checkpointed review failure is reconciled on resume", async () => {
  const repository = await createTestRepository();
  const trace = recordPersistence();
  try {
    const adapters = new FakeAdapters();
    adapters.failReviewAfterTerminalCheckpoint = true;
    adapters.reviewResults.push(passingReview());
    const runner = new WorkflowRunner(repository.root, adapters);
    await runner.start({ slug: "example", request: "Implement it." });
    const blocked = await runner.approvePlan("human");
    assert.equal(blocked.status, "blocked", blocked.blockReason ?? "");
    assert.equal(blocked.activeAttempt?.kind, "review");
    const done = await runner.resume();
    assert.equal(done.status, "done", done.blockReason ?? "");
    await assertTraceComplete(trace, runner.store, done.runId);
    await assertTrace(trace, repository.root, TRACE_REVIEW_CHECKPOINT_RESUME);
  } finally {
    trace.stop();
    await repository.dispose();
  }
});

test("characterization: an incomplete completion claim is repaired by one linked attempt", async () => {
  const repository = await createTestRepository();
  const trace = recordPersistence();
  try {
    const adapters = new FakeAdapters();
    adapters.implementationResults.push(
      phaseResult("implementation", {
        taskCompletion: {
          schemaVersion: PLAN_TASK_COMPLETION_SCHEMA_VERSION,
          tasks: [
            {
              taskId: "T001",
              status: "incomplete",
              evidence: [],
              gap: {
                reportPath:
                  "documentation/work/example/implementation-report.md",
                section: "Plan Task Completion",
                detail: "Still open."
              }
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
    assert.equal(blocked.status, "blocked", blocked.blockReason ?? "");
    assert.match(
      blocked.blockReason ?? "",
      /^\[PLAN_TASK_COMPLETION_INVALID\]/
    );
    const done = await runner.retry();
    assert.equal(done.status, "done", done.blockReason ?? "");
    await assertTraceComplete(trace, runner.store, done.runId);
    await assertTrace(trace, repository.root, TRACE_COMPLETION_REPAIR);
  } finally {
    trace.stop();
    await repository.dispose();
  }
});

test("characterization: a completion publication failure is published on resume", async () => {
  const repository = await createTestRepository();
  const trace = recordPersistence();
  try {
    const adapters = new FakeAdapters();
    adapters.reviewResults.push(passingReview());
    const runner = new WorkflowRunner(repository.root, adapters);
    const writeCandidate = runner.store.writeCompletionCandidate.bind(
      runner.store
    );
    let injected = 0;
    runner.store.writeCompletionCandidate = async (runId, candidate, bytes) => {
      if (injected === 0) {
        injected += 1;
        throw new Error("ENOSPC: injected candidate write failure");
      }
      await writeCandidate(runId, candidate, bytes);
    };
    await runner.start({ slug: "example", request: "Implement it." });
    const blocked = await runner.approvePlan("human");
    assert.equal(blocked.status, "blocked", blocked.blockReason ?? "");
    assert.match(blocked.blockReason ?? "", /^\[COMPLETION_PUBLICATION_IO\]/);
    const done = await runner.resume();
    assert.equal(done.status, "done", done.blockReason ?? "");
    await assertTraceComplete(trace, runner.store, done.runId);
    await assertTrace(trace, repository.root, TRACE_PUBLICATION_RESUME);
  } finally {
    trace.stop();
    await repository.dispose();
  }
});

const TRACE_LITE: readonly string[] = [
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
  "state implementing",
  "state verifying",
  "event attempt.applied",
  "state done",
  "event run.completed"
];

const TRACE_STRICT: readonly string[] = [
  "state created",
  "event run.created",
  "state selecting",
  "state selecting",
  "event attempt.started",
  "state selecting",
  "state planning",
  "event workflow.selected",
  "state planning",
  "event attempt.started",
  "state planning",
  "state needs_plan_approval",
  "event attempt.applied",
  "state plan_approved",
  "event approval.plan",
  "state implementing",
  "state implementing",
  "event attempt.started",
  "event attempt.terminal_checkpoint",
  "state implementing",
  "state implementing",
  "state implementing",
  "state implementing",
  "event completion.publication_applied",
  "state implementing",
  "state verifying",
  "event attempt.applied",
  "state verifying",
  "state verifying",
  "state reviewing",
  "state reviewing",
  "event attempt.started",
  "event attempt.terminal_checkpoint",
  "state reviewing",
  "event review.completed",
  "state done"
];

const TRACE_FIX_CYCLE: readonly string[] = [
  "state created",
  "event run.created",
  "state selecting",
  "state selecting",
  "event attempt.started",
  "state selecting",
  "state planning",
  "event workflow.selected",
  "state planning",
  "event attempt.started",
  "state planning",
  "state needs_plan_approval",
  "event attempt.applied",
  "state plan_approved",
  "event approval.plan",
  "state implementing",
  "state implementing",
  "event attempt.started",
  "event attempt.terminal_checkpoint",
  "state implementing",
  "state implementing",
  "state implementing",
  "state implementing",
  "event completion.publication_applied",
  "state implementing",
  "state verifying",
  "event attempt.applied",
  "state verifying",
  "state verifying",
  "state reviewing",
  "state reviewing",
  "event attempt.started",
  "event attempt.terminal_checkpoint",
  "state reviewing",
  "event review.completed",
  "state needs_triage",
  "event review.triaged",
  "state fixing",
  "state fixing",
  "event attempt.started",
  "event attempt.terminal_checkpoint",
  "state fixing",
  "state fixing",
  "state fixing",
  "state fixing",
  "event completion.publication_applied",
  "state fixing",
  "state verifying",
  "event attempt.applied",
  "state verifying",
  "state verifying",
  "state reviewing",
  "state reviewing",
  "event attempt.started",
  "event attempt.terminal_checkpoint",
  "state reviewing",
  "event review.completed",
  "state done"
];

const TRACE_RETRY: readonly string[] = [
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
  "state implementing",
  "state verifying",
  "event attempt.applied",
  "state verifying",
  "state blocked <- verifying: Task verification is incomplete. Inspect the retained physical evidence and retry the failed check without replaying implementation.",
  "state verifying",
  "event verification.retry_requested",
  "state verifying",
  "state done",
  "event run.completed"
];

const TRACE_INTERRUPTED_RECOVERY: readonly string[] = [
  "state created",
  "event run.created",
  "state selecting",
  "state selecting",
  "event attempt.started",
  "state selecting",
  "state planning",
  "event workflow.selected",
  "state planning",
  "event attempt.started",
  "state planning",
  "state needs_plan_approval",
  "event attempt.applied",
  "state plan_approved",
  "event approval.plan",
  "state implementing",
  "state implementing",
  "event attempt.started",
  "state blocked <- implementing: implementation failed: implementation interrupted",
  "event attempt.failed",
  "state blocked <- implementing: implementation failed: implementation interrupted",
  "event recovery.authorized",
  "state implementing",
  "event attempt.interrupted",
  "state implementing",
  "event attempt.recovery_started",
  "event attempt.terminal_checkpoint",
  "state implementing",
  "state implementing",
  "state implementing",
  "state implementing",
  "event completion.publication_applied",
  "state implementing",
  "state verifying",
  "event attempt.applied",
  "state verifying",
  "state verifying",
  "state reviewing",
  "state reviewing",
  "event attempt.started",
  "event attempt.terminal_checkpoint",
  "state reviewing",
  "event review.completed",
  "state done"
];

const TRACE_PREREQUISITE_RECOVERY: readonly string[] = [
  "state created",
  "event run.created",
  "state selecting",
  "state selecting",
  "event attempt.started",
  "state selecting",
  "state planning",
  "event workflow.selected",
  "state planning",
  "event attempt.started",
  "state planning",
  "state needs_plan_approval",
  "event attempt.applied",
  "state plan_approved",
  "event approval.plan",
  "state implementing",
  "state implementing",
  "event attempt.started",
  "event attempt.terminal_checkpoint",
  "state implementing",
  "state implementing",
  "state implementing",
  "state implementing",
  "event completion.publication_applied",
  "state implementing",
  "state verifying",
  "event attempt.applied",
  "state verifying",
  "state verifying",
  "state reviewing",
  "state reviewing",
  "event attempt.started",
  "event attempt.terminal_checkpoint",
  "state reviewing",
  "event review.completed",
  "state needs_triage",
  "event review.triaged",
  "state fixing",
  "state fixing",
  "event attempt.started",
  "event attempt.terminal_checkpoint",
  "state fixing",
  "state blocked <- fixing: Migration round-trip evidence requires operator commands.",
  "event attempt.applied",
  "state blocked <- fixing: Migration round-trip evidence requires operator commands.",
  "event recovery.authorized",
  "state fixing",
  "event attempt.blocked_source_preserved",
  "state fixing",
  "event attempt.recovery_started",
  "event attempt.terminal_checkpoint",
  "state fixing",
  "state fixing",
  "state fixing",
  "state fixing",
  "event completion.publication_applied",
  "state fixing",
  "state verifying",
  "event attempt.applied",
  "state verifying",
  "state verifying",
  "state reviewing",
  "state reviewing",
  "event attempt.started",
  "event attempt.terminal_checkpoint",
  "state reviewing",
  "event review.completed",
  "state done"
];

const TRACE_RESTORE: readonly string[] = [
  "state created",
  "event run.created",
  "state selecting",
  "state selecting",
  "event attempt.started",
  "state selecting",
  "state planning",
  "event workflow.selected",
  "state planning",
  "event attempt.started",
  "state planning",
  "state needs_plan_approval",
  "event attempt.applied",
  "state plan_approved",
  "event approval.plan",
  "state blocked <- plan_approved: Approved planning artifacts changed. Restore the approved bundle (banzai restore) and retry, or cancel the run and approve a revised plan in a new run.",
  "event approval.invalidated",
  "event approval.restored",
  "state plan_approved",
  "event implementation.checks_retry_requested",
  "state implementing",
  "state implementing",
  "event attempt.started",
  "event attempt.terminal_checkpoint",
  "state implementing",
  "state implementing",
  "state implementing",
  "state implementing",
  "event completion.publication_applied",
  "state implementing",
  "state verifying",
  "event attempt.applied",
  "state verifying",
  "state verifying",
  "state reviewing",
  "state reviewing",
  "event attempt.started",
  "event attempt.terminal_checkpoint",
  "state reviewing",
  "event review.completed",
  "state done"
];

const TRACE_STATUS_APPROVAL_BLOCK: readonly string[] = [
  "state created",
  "event run.created",
  "state selecting",
  "state selecting",
  "event attempt.started",
  "state selecting",
  "state planning",
  "event workflow.selected",
  "state planning",
  "event attempt.started",
  "state planning",
  "state needs_plan_approval",
  "event attempt.applied",
  "state plan_approved",
  "event approval.plan",
  "state implementing",
  "state implementing",
  "event attempt.started",
  "state blocked <- implementing: implementation failed: implementation interrupted",
  "event attempt.failed",
  "state blocked <- implementing: Approved planning artifacts changed. Restore the approved bundle (banzai restore) and retry, or cancel the run and approve a revised plan in a new run.",
  "event approval.invalidated"
];

const TRACE_IMPLEMENTATION_CHECKPOINT_RESUME: readonly string[] = [
  "state created",
  "event run.created",
  "state selecting",
  "state selecting",
  "event attempt.started",
  "state selecting",
  "state planning",
  "event workflow.selected",
  "state planning",
  "event attempt.started",
  "state planning",
  "state needs_plan_approval",
  "event attempt.applied",
  "state plan_approved",
  "event approval.plan",
  "state implementing",
  "state implementing",
  "event attempt.started",
  "event attempt.terminal_checkpoint",
  "state blocked <- implementing: implementation failed: parent interrupted after terminal checkpoint",
  "event attempt.failed",
  "event attempt.terminal_reconciled",
  "state blocked <- implementing: implementation failed: parent interrupted after terminal checkpoint",
  "state implementing",
  "state implementing",
  "state implementing",
  "event completion.publication_applied",
  "state implementing",
  "state verifying",
  "event attempt.applied",
  "state verifying",
  "state verifying",
  "state reviewing",
  "state reviewing",
  "event attempt.started",
  "event attempt.terminal_checkpoint",
  "state reviewing",
  "event review.completed",
  "state done"
];

const TRACE_REVIEW_CHECKPOINT_RESUME: readonly string[] = [
  "state created",
  "event run.created",
  "state selecting",
  "state selecting",
  "event attempt.started",
  "state selecting",
  "state planning",
  "event workflow.selected",
  "state planning",
  "event attempt.started",
  "state planning",
  "state needs_plan_approval",
  "event attempt.applied",
  "state plan_approved",
  "event approval.plan",
  "state implementing",
  "state implementing",
  "event attempt.started",
  "event attempt.terminal_checkpoint",
  "state implementing",
  "state implementing",
  "state implementing",
  "state implementing",
  "event completion.publication_applied",
  "state implementing",
  "state verifying",
  "event attempt.applied",
  "state verifying",
  "state verifying",
  "state reviewing",
  "state reviewing",
  "event attempt.started",
  "event attempt.terminal_checkpoint",
  "state blocked <- reviewing: review failed: parent interrupted after review terminal checkpoint",
  "event attempt.failed",
  "event attempt.reconciled",
  "state reviewing",
  "event attempt.terminal_reconciled",
  "event review.completed",
  "state done"
];

const TRACE_COMPLETION_REPAIR: readonly string[] = [
  "state created",
  "event run.created",
  "state selecting",
  "state selecting",
  "event attempt.started",
  "state selecting",
  "state planning",
  "event workflow.selected",
  "state planning",
  "event attempt.started",
  "state planning",
  "state needs_plan_approval",
  "event attempt.applied",
  "state plan_approved",
  "event approval.plan",
  "state implementing",
  "state implementing",
  "event attempt.started",
  "event attempt.terminal_checkpoint",
  "state implementing",
  "state implementing",
  "state blocked <- implementing: [PLAN_TASK_COMPLETION_INVALID] Completed implementation outcome contradicts T001=incomplete.",
  "event attempt.failed",
  "event plan_task_completion.validation_failed",
  "event completion.input_rejected",
  "state implementing",
  "event attempt.retry_requested",
  "event plan_task_completion.retry_requested",
  "state implementing",
  "event attempt.started",
  "event attempt.terminal_checkpoint",
  "state implementing",
  "state implementing",
  "state implementing",
  "state implementing",
  "event completion.publication_applied",
  "state implementing",
  "state verifying",
  "event attempt.applied",
  "state verifying",
  "state verifying",
  "state reviewing",
  "state reviewing",
  "event attempt.started",
  "event attempt.terminal_checkpoint",
  "state reviewing",
  "event review.completed",
  "state done"
];

const TRACE_PUBLICATION_RESUME: readonly string[] = [
  "state created",
  "event run.created",
  "state selecting",
  "state selecting",
  "event attempt.started",
  "state selecting",
  "state planning",
  "event workflow.selected",
  "state planning",
  "event attempt.started",
  "state planning",
  "state needs_plan_approval",
  "event attempt.applied",
  "state plan_approved",
  "event approval.plan",
  "state implementing",
  "state implementing",
  "event attempt.started",
  "event attempt.terminal_checkpoint",
  "state implementing",
  "state implementing",
  "state blocked <- implementing: [COMPLETION_PUBLICATION_IO] Completion publication for implementation attempt implementation-1-<id> stopped at stage candidate. Retry with banzai resume once storage is available, or cancel.",
  "event completion.publication_refused",
  "state implementing",
  "state implementing",
  "event completion.publication_applied",
  "state implementing",
  "state verifying",
  "event attempt.applied",
  "state verifying",
  "state verifying",
  "state reviewing",
  "state reviewing",
  "event attempt.started",
  "event attempt.terminal_checkpoint",
  "state reviewing",
  "event review.completed",
  "state done"
];

const TRACE_CANCEL: readonly string[] = [
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
  "state implementing",
  "state verifying",
  "event attempt.applied",
  "state verifying",
  "state blocked <- verifying: Task verification is incomplete. Inspect the retained physical evidence and retry the failed check without replaying implementation.",
  "state cancelled",
  "event run.cancelled"
];

type WorkflowFacadeTypes = [
  StartRunInput,
  TriageInput,
  HumanDecisionInput,
  DecisionConsultationInput,
  ConfigurationDecisionInput,
  WorkflowStatus,
  WorkflowTaskCompletionStatus,
  ReviewCompletion,
  RetryEligibility,
  RecoveryEligibility,
  RecoverInput,
  Clock,
  IdSource,
  RunnerSources
];

test("the workflow facade keeps every exported name while its internals move", () => {
  // Referencing each name makes a removed or renamed export a type error.
  const typeWitness: WorkflowFacadeTypes | null = null;
  assert.equal(typeWitness, null);
  const runtimeExports = [
    workflowFacade.WorkflowRunner,
    workflowFacade.invocationScopeDigest,
    workflowFacade.reviewExecutionPolicy,
    workflowFacade.workflowAuthorizationDigest,
    workflowFacade.humanDecisionQuestions,
    workflowFacade.reviewCompletion,
    workflowFacade.reviewStatusLines,
    workflowFacade.defaultDecisionMaker
  ];
  assert.deepEqual(
    runtimeExports.map((value) => typeof value),
    runtimeExports.map(() => "function")
  );
});

const RUN_ID_FORMAT = /^(\d{14})-small-fix-([0-9a-f]{8})$/u;

const ATTEMPT_ID_FORMAT = /^(?:selection|implementation)-1-([0-9a-f]{8})$/u;

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

async function quickFixRun(sources?: RunnerSources) {
  const repository = await createTestRepository();
  const adapters = new FakeAdapters();
  adapters.selectionResults.push(
    selectionResult({
      recommendedWorkflow: "quick-fix",
      reason: "This corrects existing behavior."
    })
  );
  const runner = new WorkflowRunner(
    repository.root,
    adapters,
    undefined,
    undefined,
    undefined,
    sources
  );
  const done = await runner.start({
    slug: "small-fix",
    request: "Fix the existing label."
  });
  assert.equal(done.status, "done", done.blockReason ?? "");
  const attempts = await runner.store.readRunAttempts(done.runId);
  return { repository, done, attempts };
}

test("supplied runner sources produce every runner-generated timestamp and identifier", async () => {
  const fixed = new Date("2026-01-02T03:04:05.678Z");
  const supplied: string[] = [];
  const ids = () => {
    const id = `${(supplied.length + 1).toString(16).padStart(8, "0")}-0000-4000-8000-000000000000`;
    supplied.push(id);
    return id;
  };
  const { repository, done, attempts } = await quickFixRun({
    clock: () => fixed,
    ids
  });
  try {
    const prefixes = supplied.map((id) => id.slice(0, 8));
    const run = RUN_ID_FORMAT.exec(done.runId);
    assert.ok(run, done.runId);
    assert.equal(run[1], "20260102030405");
    assert.ok(prefixes.includes(run[2] ?? ""), done.runId);
    assert.equal(done.createdAt, fixed.toISOString());
    assert.ok(attempts.length > 0);
    for (const record of attempts) {
      const attempt = ATTEMPT_ID_FORMAT.exec(record.attempt.id);
      assert.ok(attempt, record.attempt.id);
      assert.ok(prefixes.includes(attempt[1] ?? ""), record.attempt.id);
      assert.equal(record.startedAt, fixed.toISOString());
      assert.equal(record.completedAt, fixed.toISOString());
      assert.equal(record.durationMs, 0);
    }
  } finally {
    await repository.dispose();
  }
});

test("default runner sources keep the baseline timestamp and identifier formats", async () => {
  const { repository, done, attempts } = await quickFixRun();
  try {
    assert.match(done.runId, RUN_ID_FORMAT);
    assert.match(done.createdAt, ISO_TIMESTAMP);
    assert.ok(attempts.length > 0);
    for (const record of attempts) {
      assert.match(record.attempt.id, ATTEMPT_ID_FORMAT);
      assert.match(record.startedAt, ISO_TIMESTAMP);
      assert.match(record.completedAt ?? "", ISO_TIMESTAMP);
    }
  } finally {
    await repository.dispose();
  }
});
