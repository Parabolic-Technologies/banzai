import { requiredFixture } from "./helpers.js";
import { RunStore } from "../src/store.js";
import { instructionPluginFixture } from "./phase-instruction-fixtures.js";
import { inspectDoctor } from "../src/doctor.js";
import { spawn, spawnSync } from "node:child_process";
import {
  acquireWork,
  createWork,
  releaseWork,
  artifactCommand,
  inspectArtifacts
} from "../src/artifact-storage.js";
import { reviewResultSchema } from "../src/contracts.js";
import { collectEvaluationExport } from "../src/evaluation.js";
import { deriveEvaluationKpiReport } from "../src/evaluation-kpi.js";
import {
  readTaskVerificationAttempts,
  parseTaskVerificationDescriptor,
  evidenceDigest
} from "../src/verification-evidence.js";
import { collectContextReport } from "../src/context-report.js";
import { projectAgentControlStatus } from "../src/agent-control.js";
import { emptyHumanTime } from "../src/human-time.js";
import { resolveCancellation } from "../src/cancellation.js";
import {
  CANCELLATION_LIMITS,
  decodeCancellationEvents,
  readCancellationFile
} from "../src/cancellation-evidence.js";
import { InteractiveHumanTime } from "../src/interactive-human-time.js";
import { HumanTimeStore } from "../src/human-time-store.js";
import type { HumanTimeBoundary } from "../src/human-time.js";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  symlink,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  BanzaiError,
  ProcessExitError,
  TerminalRunStateError
} from "../src/errors.js";
import { digestArtifactBundle } from "../src/git.js";
import { renderReviewArtifact } from "../src/review-artifact.js";
import { vendorFor } from "../src/models.js";
import {
  parsePublishedCompletionRegion,
  renderCompletionRegion,
  renderPlanTaskCompletionProjection
} from "../src/plan-task-completion.js";
import { transitionState } from "../src/state-machine.js";
import { phaseResultEnvelopeOf } from "../src/validation.js";
import {
  CONTRACT_VERSION,
  PHASE_RESULT_SCHEMA_VERSION,
  PLAN_TASK_COMPLETION_SCHEMA_VERSION,
  type AdapterResult,
  type AttemptRecord,
  type AttemptReference,
  type ClaudeInvocationScope,
  type ModelUsage,
  type OrchestratorConfig,
  type PhaseAdapterRequest,
  type PhaseResult,
  type PlanTaskCompletionViolation,
  type ProcessRunner,
  type ProcessResult,
  type ProgressEvent,
  type ReviewAdapterRequest,
  type ReviewFinding,
  type ReviewResult,
  type RunState,
  type SessionInventory,
  type VendorAdapters,
  type WorkflowSelectionAdapterRequest,
  type WorkflowSelectionResult
} from "../src/types.js";
import {
  invocationScopeDigest,
  reviewCompletion,
  reviewExecutionPolicy,
  reviewStatusLines,
  WorkflowRunner
} from "../src/workflow.js";
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
  commitAll,
  createTestRepository,
  monochromeEnv,
  snapshotTree,
  verificationAttemptFixture,
  writeVerificationLedger
} from "./helpers.js";
import {
  ADOPTED_AGENTS,
  SOURCE_IDENTITY_FIXTURES,
  writeIdentity
} from "./adoption-fixtures.js";
import {
  assertTrace,
  assertTraceComplete,
  observeEligibility,
  recordPersistence,
  rewriteRunState
} from "./characterization-trace.js";

const descriptionPath = "documentation/features/example/description.md";
const planPath = "documentation/development-plans/example/plan.md";

// Resolve the fixture's old role labels against the run's actual private binding.
async function boundFixturePath(
  root: string,
  relative: string
): Promise<string> {
  if (!relative.startsWith("documentation/")) return path.join(root, relative);
  const store = new RunStore(root);
  const active = await store.readActiveRunId();
  if (active === null) return path.join(root, relative);
  const state = await store.readState(active);
  const roles = state.artifactBinding?.binding.artifacts;
  const parts = relative.split("/");
  if (!roles || !["example", state.slug].includes(parts[2] ?? ""))
    return path.join(root, relative);
  const name = parts.at(-1);
  const role =
    name === "plan.md"
      ? roles.plan
      : name === "description.md"
        ? roles.description
        : name === "implementation-report.md"
          ? roles.implementationReport
          : name === "test-report.md"
            ? roles.testReport
            : name?.startsWith("review-")
              ? `${roles.reviewDirectory}/${name}`
              : null;
  return path.join(root, role ?? relative);
}

for (const outcome of ["completed", "cancelled"] as const) {
  test(`frozen archive retains a ${outcome} task run as explicitly unsupported evidence`, async () => {
    const repository = await createTestRepository({
      artifactLayout: "private"
    });
    try {
      const adapters = new FakeAdapters();
      adapters.reviewResults.push(passingReview());
      const runner = new WorkflowRunner(repository.root, adapters);
      let state = await runner.start({
        slug: "example",
        request: "Archive the fixture."
      });
      if (outcome === "completed")
        state = await runner.approvePlan("human", true);
      else {
        await runner.cancel({ reason: "intent_changed" });
        state = (await runner.status()).state;
      }
      assert.equal(
        state.status,
        outcome === "completed" ? "done" : "cancelled",
        state.blockReason ?? ""
      );
      const invoke = async (
        operation: string,
        fields: Record<string, unknown>
      ) => {
        const request = path.join(
          await realpath(repository.root),
          "archive-request.json"
        );
        await writeFile(
          request,
          JSON.stringify({
            schema: "banzai-artifact-request/v1",
            schemaVersion: 1,
            repoRoot: repository.root,
            ...fields
          })
        );
        const response = await artifactCommand([operation, "--json", request]);
        assert.equal(response.ok, true, JSON.stringify(response));
        return response.result as Record<string, unknown>;
      };
      const archiveDirectory = path.join(
        await realpath(repository.root),
        "archive"
      );
      const inventoried = await invoke("inventory", {
        workPaths: [`.banzai/work/${state.artifactBinding?.binding.workId}`],
        runIds: [state.runId]
      });
      const inventoryFile = path.join(
        await realpath(repository.root),
        "reviewed-inventory.json"
      );
      const reviewed = inventoried.inventory as {
        retention: { pins: unknown[] };
      };
      reviewed.retention.pins = [
        {
          sourceId: "project",
          workId: state.artifactBinding?.binding.workId,
          reason: "Closed run audit",
          recordedAt: "2026-09-11T00:00:00.000Z"
        }
      ];
      await writeFile(inventoryFile, JSON.stringify(inventoried.inventory));
      const exported = await invoke("export", {
        inventoryFile,
        destination: archiveDirectory
      });
      const verified = await invoke("verify", { bundlePath: archiveDirectory });
      assert.equal(exported.complete, false, JSON.stringify(verified));
      assert.ok(
        (verified.uninterpreted as string[]).includes(
          `.banzai/runs/${state.runId}/state.json`
        )
      );
      assert.ok(
        (verified.retainedPaths as string[]).includes(
          `.banzai/runs/${state.runId}/state.json`
        )
      );
      const destination = path.join(
        await realpath(repository.root),
        "restored"
      );
      await assert.rejects(
        invoke("restore", {
          bundlePath: archiveDirectory,
          destination
        }),
        /Restore requires complete dependency interpretation/
      );
      if (outcome === "cancelled") {
        const plan = state.artifactBinding?.binding.artifacts.plan;
        assert.ok(plan);
        await rm(path.join(repository.root, plan));
        const incomplete = await invoke("inventory", {
          runIds: [state.runId]
        });
        assert.equal(
          incomplete.complete,
          false,
          "missing approved authority must not be a complete inventory"
        );
      }
    } finally {
      await repository.dispose();
    }
  });
}

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

function phaseResult(
  phase: PhaseResult["phase"],
  overrides: Partial<PhaseResult> = {}
): PhaseResult {
  return {
    schemaVersion: PHASE_RESULT_SCHEMA_VERSION,
    verificationCandidates: null,
    contractVersion: CONTRACT_VERSION,
    phase,
    outcome: phase === "plan" ? "needs_human_decision" : "completed",
    gate: phase === "plan" ? "plan_approval" : null,
    summary: `${phase} complete`,
    artifacts: {
      description: descriptionPath,
      plan: planPath,
      adrs: [],
      implementationReport:
        phase === "plan"
          ? null
          : "documentation/features/example/implementation-report.md",
      testReport:
        phase === "plan"
          ? null
          : "documentation/features/example/test-report.md"
    },
    taskCompletion:
      phase === "implementation"
        ? {
            schemaVersion: PLAN_TASK_COMPLETION_SCHEMA_VERSION,
            tasks: [
              {
                taskId: "T001",
                status: "completed",
                evidence: [
                  {
                    path: "src/example.txt",
                    detail: "Implementation fixture output."
                  }
                ],
                gap: null
              }
            ]
          }
        : null,
    touchedPaths: [],
    questions: [],
    decisionConsultation: null,
    resolvedFindingIds: [],
    requestedVerification: [],
    ...overrides
  };
}

function decisionConsultationResult(
  overrides: Partial<NonNullable<PhaseResult["decisionConsultation"]>> = {}
): PhaseResult {
  const base = phaseResult("plan");
  return {
    ...base,
    gate: "decision_consultation",
    artifacts: { ...base.artifacts, plan: null },
    decisionConsultation: {
      schema: "banzai-decision-consultation/v1",
      schemaVersion: 1,
      requestId: "request-1",
      roundId: "round-1",
      decisions: [
        {
          decisionId: "storage-model",
          title: "Storage model",
          question: "Which storage model should the feature use?",
          why: "The choice changes compatibility and ownership.",
          affectedRequirements: ["FR4", "EQ-09"],
          evidence: [
            {
              path: "packages/orchestrator/src/store.ts",
              line: 120,
              detail: "The runner already owns durable state."
            }
          ],
          decisionOwner: "human",
          responseMode: "single_choice",
          options: [
            {
              optionId: "reuse-store",
              title: "Reuse the store",
              benefits: ["One state authority."],
              costs: ["State schema revision."],
              risks: ["Legacy compatibility work."],
              consequences: ["No new service."]
            },
            {
              optionId: "external-service",
              title: "External service",
              benefits: ["Remote collaboration."],
              costs: ["New operations."],
              risks: ["Split authority."],
              consequences: ["Deployment required."]
            }
          ],
          recommendation: {
            optionId: "reuse-store",
            rationale: "It reuses the approved runner authority."
          }
        }
      ],
      ...overrides
    }
  };
}

/**
 * Rewrites a protocol attempt's result together with its retained envelope so
 * the record stays internally consistent; the reader rejects either alone.
 */
function withProtocolResult(
  record: AttemptRecord,
  result: PhaseResult
): AttemptRecord {
  const envelope = phaseResultEnvelopeOf(result);
  record.result = JSON.parse(envelope.original) as PhaseResult;
  record.envelope = envelope;
  return record;
}

function completionLedger(taskIds: readonly string[]) {
  return {
    schemaVersion: PLAN_TASK_COMPLETION_SCHEMA_VERSION,
    tasks: taskIds.map((taskId) => ({
      taskId,
      status: "completed" as const,
      evidence: [
        {
          path: "src/example.txt",
          detail: `Implementation evidence for ${taskId}.`
        }
      ],
      gap: null
    }))
  };
}

function selectionResult(
  overrides: Partial<WorkflowSelectionResult> = {}
): WorkflowSelectionResult {
  return {
    contractVersion: CONTRACT_VERSION,
    recommendedWorkflow: "strict",
    confidence: "high",
    reason: "The test uses the existing strict workflow.",
    escalationTriggers: [],
    ...overrides
  };
}

function finding(id: string, summary: string): ReviewFinding {
  return {
    id,
    severity: "should_fix",
    category: "correctness",
    summary,
    evidence: [
      { path: "src/example.txt", line: 1, detail: "Observed defect." }
    ],
    violates: ["FR1"],
    reproduction: "Read the file.",
    fixAcceptance: "The value is fixed.",
    confidence: "high"
  };
}

function adapterResult<T>(
  result: T,
  sessionId: string | null = null,
  usage: ModelUsage | null = null
): AdapterResult<T> {
  return { result, sessionId, stdout: "", stderr: "", usage };
}

async function writeImplementationArtifacts(
  repoRoot: string,
  result: PhaseResult,
  source = "needs-fix\n",
  transformReport: (contents: string) => string = (contents) => contents
): Promise<void> {
  await mkdir(path.join(repoRoot, "src"), { recursive: true });
  await writeFile(path.join(repoRoot, "src/example.txt"), source, "utf8");
  if (
    result.artifacts.implementationReport === null ||
    result.artifacts.testReport === null
  ) {
    return;
  }
  await mkdir(
    path.join(repoRoot, path.dirname(result.artifacts.implementationReport)),
    { recursive: true }
  );
  const implementationReport = `# Implementation Report\n\n${
    result.taskCompletion === null
      ? "No strict task ledger."
      : renderPlanTaskCompletionProjection(result.taskCompletion)
  }\n`;
  await writeFile(
    path.join(repoRoot, result.artifacts.implementationReport),
    transformReport(implementationReport),
    "utf8"
  );
  await writeFile(
    path.join(repoRoot, result.artifacts.testReport),
    "# Test Report\n\nFocused assurance complete.\n",
    "utf8"
  );
}

class FakeAdapters implements VendorAdapters {
  fixtureTaskChecks = false;
  codexPreflights = 0;
  claudePreflights = 0;
  onCodexPreflight: (() => Promise<void>) | null = null;
  onClaudePreflight: (() => Promise<void>) | null = null;
  claudePreflightErrors: Error[] = [];
  selectionPrompts: string[] = [];
  selectionErrors: Error[] = [];
  selectionResults: WorkflowSelectionResult[] = [];
  selectionUsages: (ModelUsage | null)[] = [];
  phasePrompts: string[] = [];
  phaseResumeSessionIds: (string | null)[] = [];
  planErrors: Error[] = [];
  implementationErrors: Error[] = [];
  fixErrors: Error[] = [];
  planResults: PhaseResult[] = [];
  implementationResults: PhaseResult[] = [];
  fixResults: PhaseResult[] = [];
  implementationReportTransforms: ((contents: string) => string)[] = [];
  reviewPrompts: string[] = [];
  reviewResumeSessionIds: (string | null)[] = [];
  reviewSessionIds: (string | null)[] = [];
  reviewErrors: Error[] = [];
  reviewResults: ReviewResult[] = [];
  reviewStdout: string[] = [];
  reviewStderr: string[] = [];
  reviewUsages: (ModelUsage | null)[] = [];
  reviewEnvironments: (ClaudeInvocationScope | undefined)[] = [];
  reviewInventories: (SessionInventory | null)[] = [];
  reviewTerminalCheckpointCallbacks: boolean[] = [];
  reviewTerminalObservedAts: string[] = [];
  onReview: ((request: ReviewAdapterRequest) => Promise<void>) | null = null;
  writeSourceBeforeEscalation = false;
  emitImplementationSkill = true;
  emitImplementationTerminalCheckpoint = true;
  failImplementationAfterTerminalCheckpoint = false;
  implementationTerminalUsage: ModelUsage | null = null;
  emitFixTerminalCheckpoint = true;
  failFixAfterTerminalCheckpoint = false;
  fixTerminalUsage: ModelUsage | null = null;
  emitReviewTerminalCheckpoint = true;
  failReviewAfterTerminalCheckpoint = false;
  planTaskIds = ["T001"];

  protected async emitImplementationCheckpoint(
    request: PhaseAdapterRequest,
    result: PhaseResult
  ): Promise<void> {
    if (!this.emitImplementationTerminalCheckpoint) return;
    await request.onTerminalSuccess?.({
      classification:
        vendorFor(request.settings.executable) === "claude"
          ? "claude_result"
          : "codex_turn_completed",
      observedAt: new Date().toISOString(),
      result,
      sessionId: "implementer-session",
      usage: this.implementationTerminalUsage
    });
  }

  protected async emitFixCheckpoint(
    request: PhaseAdapterRequest,
    result: PhaseResult
  ): Promise<void> {
    if (!this.emitFixTerminalCheckpoint) return;
    await request.onTerminalSuccess?.({
      classification:
        vendorFor(request.settings.executable) === "claude"
          ? "claude_result"
          : "codex_turn_completed",
      observedAt: new Date().toISOString(),
      result,
      sessionId: "implementer-session",
      usage: this.fixTerminalUsage
    });
  }

  async preflightCodex(): Promise<void> {
    this.codexPreflights += 1;
    await this.onCodexPreflight?.();
  }

  async preflightClaude(): Promise<void> {
    this.claudePreflights += 1;
    await this.onClaudePreflight?.();
    const error = this.claudePreflightErrors.shift();
    if (error !== undefined) {
      throw error;
    }
  }

  async runSelection(
    request: WorkflowSelectionAdapterRequest
  ): Promise<AdapterResult<WorkflowSelectionResult>> {
    this.selectionPrompts.push(request.prompt);
    request.onProgress({
      kind: "action",
      status: "started",
      detail: "classifying workflow"
    });
    const error = this.selectionErrors.shift();
    if (error !== undefined) {
      throw error;
    }
    return adapterResult(
      this.selectionResults.shift() ?? selectionResult(),
      null,
      this.selectionUsages.shift() ?? null
    );
  }

  async runPhase(
    request: PhaseAdapterRequest
  ): Promise<AdapterResult<PhaseResult>> {
    const state = JSON.parse(
      await readFile(path.join(request.runDirectory, "state.json"), "utf8")
    ) as RunState;
    const roles = state.artifactBinding?.binding.artifacts;
    const descriptionPath =
      roles?.description ?? "documentation/features/example/description.md";
    const planPath =
      roles?.plan ?? "documentation/development-plans/example/plan.md";
    const fixtureChecks = this.fixtureTaskChecks
      ? (
          JSON.parse(
            await readFile(
              path.join(request.repoRoot, ".banzai/config.json"),
              "utf8"
            )
          ) as OrchestratorConfig
        ).verification.profiles.flatMap((profile) =>
          profile.commands.map((command, index) =>
            parseTaskVerificationDescriptor({
              name: command.name,
              command: command.command,
              args: command.args,
              timeoutMs: command.timeoutMs,
              id: `${profile.id}-${index + 1}`,
              requirementRefs: ["FR1"],
              cwd: ".",
              evidence: "fresh",
              sources: [],
              materialization: null
            })
          )
        )
      : [];
    const bind = (result: PhaseResult): PhaseResult => {
      if (state.verificationMode === "task") {
        result.schemaVersion = 4;
        result.verificationCandidates =
          result.phase === "plan" ||
          (state.workflowSelection?.workflow ?? "strict") === "strict"
            ? null
            : {
                checks: fixtureChecks,
                absenceReason: fixtureChecks.length
                  ? null
                  : "Fixture task uses direct source assertions."
              };
      }
      if (!roles) return result;
      const mapping = new Map<string, string | null>([
        ["documentation/features/example/description.md", descriptionPath],
        ["documentation/development-plans/example/plan.md", planPath],
        [
          "documentation/features/example/implementation-report.md",
          roles.implementationReport ?? null
        ],
        [
          "documentation/features/example/test-report.md",
          roles.testReport ?? null
        ]
      ]);
      for (const key of [
        "description",
        "plan",
        "implementationReport",
        "testReport"
      ] as const) {
        const value = result.artifacts[key];
        if (value !== null && mapping.has(value))
          result.artifacts[key] = mapping.get(value) ?? null;
      }
      if (
        (state.workflowSelection?.workflow ?? "strict") !== "strict" &&
        result.phase !== "plan"
      ) {
        result.artifacts = {
          description: null,
          plan: null,
          adrs: [],
          implementationReport:
            state.workflowSelection?.workflow === "feature"
              ? (roles.work ?? null)
              : (roles.changeReport ?? null),
          testReport: null
        };
        result.taskCompletion = null;
      }
      return result;
    };
    this.phasePrompts.push(request.prompt);
    this.phaseResumeSessionIds.push(request.resumeSessionId);
    if (
      request.prompt.includes("Phase: plan") ||
      this.emitImplementationSkill
    ) {
      request.onProgress({
        kind: "skill",
        status: "started",
        detail: request.prompt.includes("Phase: plan")
          ? "banzai:feature-description"
          : "banzai:code-writing"
      });
    }
    if (request.prompt.includes("Phase: plan")) {
      const error = this.planErrors.shift();
      if (error !== undefined) {
        throw error;
      }
      await mkdir(path.join(request.repoRoot, path.dirname(descriptionPath)), {
        recursive: true
      });
      await mkdir(path.join(request.repoRoot, path.dirname(planPath)), {
        recursive: true
      });
      await writeFile(
        await boundFixturePath(request.repoRoot, descriptionPath),
        "# Description\n\nFR1.\n",
        "utf8"
      );
      await writeFile(
        await boundFixturePath(request.repoRoot, planPath),
        `# Plan\n\n## Implementation Tasks\n\n${this.planTaskIds
          .map((taskId) => `- [ ] **${taskId} - Implement the fixture**`)
          .join("\n")}\n`,
        "utf8"
      );
      if (state.verificationMode === "task") {
        const file = await boundFixturePath(request.repoRoot, planPath);
        const before = await readFile(file, "utf8");
        const config = JSON.parse(
          await readFile(
            path.join(request.repoRoot, ".banzai/config.json"),
            "utf8"
          )
        ) as OrchestratorConfig;
        const checks = config.verification.profiles.flatMap((profile) =>
          profile.commands.map((command, index) =>
            parseTaskVerificationDescriptor({
              ...command,
              id: `${profile.id}-${index + 1}`,
              requirementRefs: ["FR1"],
              cwd: ".",
              evidence: "fresh",
              sources: [],
              materialization: null
            })
          )
        );
        await writeFile(
          file,
          before +
            "```banzai-verification-obligations/v2\n" +
            JSON.stringify({
              schema: "banzai-verification-obligations/v2",
              schemaVersion: 2,
              complete: true,
              planRemainderSha256: evidenceDigest(before + "\n"),
              checks,
              absenceReason: checks.length
                ? null
                : "Fixture task uses direct source assertions."
            }) +
            "\n```\n"
        );
      }
      return adapterResult(
        bind(this.planResults.shift() ?? phaseResult("plan")),
        "planner-session"
      );
    }
    if (request.prompt.includes("Phase: implementation")) {
      const error = this.implementationErrors.shift();
      if (error !== undefined) {
        await mkdir(path.join(request.repoRoot, "src"), { recursive: true });
        await writeFile(
          path.join(request.repoRoot, "src/example.txt"),
          "partial\n",
          "utf8"
        );
        throw error;
      }
      const result = bind(
        this.implementationResults.shift() ?? phaseResult("implementation")
      );
      if (request.prompt.includes("Selected workflow:")) {
        result.taskCompletion = null;
      }
      if (
        result.outcome === "needs_human_decision" &&
        !this.writeSourceBeforeEscalation
      ) {
        const workPath = path.join(
          request.repoRoot,
          ((state.workflowSelection?.workflow ?? "strict") === "strict"
            ? roles?.implementationReport
            : state.workflowSelection?.workflow === "quick-fix"
              ? roles?.changeReport
              : roles?.work) ?? "documentation/features/example/work.md"
        );
        await mkdir(path.dirname(workPath), { recursive: true });
        await writeFile(workPath, "# Work\n\nEscalation found.\n", "utf8");
      } else if ((state.workflowSelection?.workflow ?? "strict") !== "strict") {
        await mkdir(path.join(request.repoRoot, "src"), { recursive: true });
        await writeFile(
          path.join(request.repoRoot, "src/example.txt"),
          "needs-fix\n"
        );
        if (result.artifacts.implementationReport) {
          await mkdir(
            path.dirname(
              path.join(request.repoRoot, result.artifacts.implementationReport)
            ),
            { recursive: true }
          );
          await writeFile(
            path.join(request.repoRoot, result.artifacts.implementationReport),
            "# Work\n\nVerified fixture.\n"
          );
        }
      } else {
        await writeImplementationArtifacts(
          request.repoRoot,
          result,
          "needs-fix\n",
          this.implementationReportTransforms.shift()
        );
      }
      await this.emitImplementationCheckpoint(request, result);
      if (this.failImplementationAfterTerminalCheckpoint) {
        throw new Error("parent interrupted after terminal checkpoint");
      }
      return adapterResult(result, "implementer-session");
    }
    const fixError = this.fixErrors.shift();
    if (fixError !== undefined) {
      await writeFile(
        path.join(request.repoRoot, "src/example.txt"),
        "partial-fix\n",
        "utf8"
      );
      throw fixError;
    }
    await writeFile(
      path.join(request.repoRoot, "src/example.txt"),
      "fixed\n",
      "utf8"
    );
    const result = bind(
      this.fixResults.shift() ??
        phaseResult("fix", { resolvedFindingIds: ["R1-F1"] })
    );
    await this.emitFixCheckpoint(request, result);
    if (this.failFixAfterTerminalCheckpoint) {
      throw new Error("parent interrupted after fix terminal checkpoint");
    }
    return adapterResult(result, "implementer-session");
  }

  async runReview(
    request: ReviewAdapterRequest
  ): Promise<AdapterResult<ReviewResult>> {
    this.reviewPrompts.push(request.prompt);
    this.reviewResumeSessionIds.push(request.resumeSessionId);
    this.reviewEnvironments.push(request.environment);
    this.reviewTerminalCheckpointCallbacks.push(
      request.onTerminalSuccess !== undefined
    );
    await this.onReview?.(request);
    const error = this.reviewErrors.shift();
    if (error !== undefined) {
      throw error;
    }
    const queued = this.reviewResults.shift();
    const result =
      queued === undefined || queued.schemaVersion !== undefined
        ? queued
        : {
            ...queued,
            schemaVersion: 2 as const,
            reviewNotes: [],
            // A deliberate assertion by the synthetic reviewer, never runner backfill.
            scopeAcknowledgment: {
              schemaVersion: 1 as const,
              snapshotDigest:
                request.artifact.snapshot?.digest ?? "missing-snapshot",
              artifacts: (request.artifact.snapshot?.approval.paths ?? []).map(
                (path) => ({ path, status: "reviewed" as const, reason: null })
              )
            }
          };
    if (result === undefined) {
      throw new Error("No fake review result queued.");
    }

    if (this.emitReviewTerminalCheckpoint) {
      await request.onTerminalSuccess?.({
        classification:
          path.basename(request.settings.executable) === "codex"
            ? "codex_turn_completed"
            : "claude_result",
        observedAt:
          this.reviewTerminalObservedAts.shift() ?? new Date().toISOString(),
        result,
        sessionId: "fresh-review-session",
        usage: null
      });
    }
    if (this.failReviewAfterTerminalCheckpoint) {
      throw new Error("parent interrupted after review terminal checkpoint");
    }
    const sessionId =
      this.reviewSessionIds.length > 0
        ? (this.reviewSessionIds.shift() ?? null)
        : (request.resumeSessionId ?? "fresh-review-session");
    const inventory =
      this.reviewInventories.length > 0
        ? (this.reviewInventories.shift() ?? null)
        : null;
    return {
      ...adapterResult(result, sessionId),
      stdout: this.reviewStdout.shift() ?? "",
      stderr: this.reviewStderr.shift() ?? "",
      usage:
        this.reviewUsages.length > 0
          ? (this.reviewUsages.shift() ?? null)
          : null,
      inventory
    };
  }
}

function passingReview(reviewedFindingIds: string[] = []): ReviewResult {
  return {
    contractVersion: CONTRACT_VERSION,
    verdict: "pass",
    summary: "Implementation matches the plan.",
    findings: [],
    reviewedFindingIds,
    deferredCoverage: []
  };
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
        touchedPaths: ["documentation/features/example/work.md"]
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
            "documentation/features/example/implementation-report.md"
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
        "documentation/features/example/implementation-report.md"
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
              "documentation/features/example/implementation-report.md"
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
        "documentation/features/example/implementation-report.md"
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
            "documentation/features/example/implementation-report.md"
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

for (const artifactLayout of ["legacy", "private"] as const)
  test(`resume promotes a durable terminal checkpoint after parent interruption without another model call (${artifactLayout})`, async () => {
    const repository = await createTestRepository({ artifactLayout });
    try {
      const adapters = new FakeAdapters();
      adapters.emitImplementationTerminalCheckpoint = true;
      adapters.failImplementationAfterTerminalCheckpoint = true;
      adapters.reviewResults.push(passingReview());
      const runner = new WorkflowRunner(repository.root, adapters);
      await runner.start({ slug: "example", request: "Implement it." });

      const blocked = await runner.approvePlan("human");
      assert.equal(blocked.status, "blocked");
      const attempt = blocked.activeAttempt;
      assert.ok(attempt);
      assert.equal(attempt.kind, "implementation");
      const failed = await runner.store.readRunAttempt(blocked.runId, attempt);
      assert.equal(failed.status, "failed");
      assert.ok(
        await runner.store.readTerminalCheckpointIfExists(
          blocked.runId,
          attempt
        ),
        failed.error ?? blocked.blockReason ?? "checkpoint missing"
      );
      const promptsBeforeResume = adapters.phasePrompts.length;

      const status = await runner.status();
      assert.equal(status.recovery.terminalCheckpointPresent, true);
      assert.equal(status.recovery.eligible, false);
      assert.equal(status.nextAction, "banzai resume");

      const done = await runner.resume();
      assert.equal(done.status, "done", done.blockReason ?? "");
      assert.equal(adapters.phasePrompts.length, promptsBeforeResume);
      assert.equal(
        done.metrics.completedAttemptIds.filter((id) => id === attempt.id)
          .length,
        1
      );
      const promoted = await runner.store.readRunAttempt(done.runId, attempt);
      assert.equal(promoted.status, "completed");
      assert.equal(promoted.error, null);
      assert.equal(promoted.failureCode, null);

      const repeated = await runner.resume();
      assert.equal(repeated.status, "done");
      assert.equal(adapters.phasePrompts.length, promptsBeforeResume);
      assert.equal(
        repeated.metrics.completedAttemptIds.filter((id) => id === attempt.id)
          .length,
        1
      );
    } finally {
      await repository.dispose();
    }
  });

test("resume rejects a terminal implementation checkpoint with an invalid task ledger before completion accounting", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new FakeAdapters();
    adapters.implementationResults.push(
      phaseResult("implementation", { taskCompletion: null })
    );
    adapters.emitImplementationTerminalCheckpoint = true;
    adapters.failImplementationAfterTerminalCheckpoint = true;
    adapters.implementationTerminalUsage = {
      inputTokens: 101,
      cachedInputTokens: 11,
      outputTokens: 13,
      costUsd: 1.25
    };
    const runner = new WorkflowRunner(repository.root, adapters);
    await runner.start({ slug: "example", request: "Implement it." });
    const blocked = await runner.approvePlan("human");
    const attempt = blocked.activeAttempt;
    assert.ok(attempt);
    const metricsBefore = structuredClone(blocked.metrics);
    const promptsBefore = adapters.phasePrompts.length;
    const resumed = await runner.resume();

    // The proven terminal result is reconciled and its usage accounted, but
    // the missing ledger is a final input rejection: no completion, no
    // verification, no review and no replay.
    assert.equal(resumed.status, "blocked");
    assert.match(resumed.blockReason ?? "", /PLAN_TASK_COMPLETION_INVALID/);
    assert.match(resumed.blockReason ?? "", /missing taskCompletion/);
    assert.equal(adapters.phasePrompts.length, promptsBefore);
    assert.deepEqual(
      resumed.metrics.completedAttemptIds,
      metricsBefore.completedAttemptIds
    );
    assert.equal(resumed.metrics.usage.inputTokens, 101);
    assert.equal(resumed.metrics.usage.costUsd, 1.25);
    assert.equal(resumed.verification.length, 0);
    assert.equal(adapters.reviewPrompts.length, 0);
    assert.equal(resumed.planTaskCompletion?.status, "invalid");
    assert.equal(resumed.planTaskCompletion.violation, "missing_ledger");
    const record = await runner.store.readRunAttempt(resumed.runId, attempt);
    assert.equal(record.status, "failed");
    assert.equal(record.failureCode, "PLAN_TASK_COMPLETION_INVALID");
    const status = await runner.status();
    assert.equal(status.retry.eligible, true);
    assert.equal(status.nextAction, "banzai retry");
  } finally {
    await repository.dispose();
  }
});

test("resume rejects a terminal checkpoint whose phase does not match its attempt", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new FakeAdapters();
    adapters.implementationResults.push(phaseResult("plan"));
    adapters.emitImplementationTerminalCheckpoint = true;
    adapters.failImplementationAfterTerminalCheckpoint = true;
    const runner = new WorkflowRunner(repository.root, adapters);
    await runner.start({ slug: "example", request: "Implement it." });
    const blocked = await runner.approvePlan("human");
    const attempt = blocked.activeAttempt;
    assert.ok(attempt);
    const completedBefore = [...blocked.metrics.completedAttemptIds];

    // Under the completion protocol the mismatch is refused when the terminal
    // proof is written, so no checkpoint exists to replay on resume.
    const resumed = await runner.resume();
    assert.equal(resumed.status, "blocked");
    assert.match(
      resumed.blockReason ?? "",
      /envelope phase must match attempt kind/
    );
    assert.deepEqual(resumed.metrics.completedAttemptIds, completedBefore);
    assert.equal(
      (await runner.store.readRunAttempt(resumed.runId, attempt)).status,
      "failed"
    );
  } finally {
    await repository.dispose();
  }
});

test("resume republishes a proven fix checkpoint's refreshed ledger without another model call", async () => {
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
    const refreshed = completionLedger(["T001"]);
    adapters.fixResults.push(
      phaseResult("fix", {
        taskCompletion: refreshed,
        resolvedFindingIds: ["R1-F1"]
      })
    );
    adapters.emitFixTerminalCheckpoint = true;
    adapters.failFixAfterTerminalCheckpoint = true;
    adapters.fixTerminalUsage = {
      inputTokens: 71,
      cachedInputTokens: 7,
      outputTokens: 9,
      costUsd: null
    };
    const runner = new WorkflowRunner(repository.root, adapters);
    await runner.start({ slug: "example", request: "Implement it." });
    const triage = await runner.approvePlan("human");
    assert.equal(triage.status, "needs_triage");
    const blocked = await runner.triage({
      accepted: ["R1-F1"],
      rejected: [],
      deferred: [],
      note: null,
      decidedBy: "human"
    });
    assert.equal(blocked.status, "blocked");
    assert.equal(blocked.blockedFrom, "fixing");
    const attempt = blocked.activeAttempt;
    assert.ok(attempt?.kind === "fix");
    const implementationCompletion = blocked.planTaskCompletion;
    assert.ok(implementationCompletion?.status === "valid");
    const usageBefore = blocked.metrics.usage.inputTokens;
    const promptsBefore = adapters.phasePrompts.length;

    // The proven terminal result is the model's whole contribution: the
    // runner renders the refreshed ledger and continues to review itself.
    adapters.reviewResults.push(passingReview(["R1-F1"]));
    const done = await runner.resume();
    assert.equal(done.status, "done", done.blockReason ?? "");
    assert.equal(adapters.phasePrompts.length, promptsBefore);
    assert.equal(done.metrics.usage.inputTokens, usageBefore + 71);
    const record = await runner.store.readRunAttempt(done.runId, attempt);
    assert.equal(record.status, "completed");
    assert.equal(record.schemaVersion, 4);
    const completion = done.planTaskCompletion;
    assert.ok(completion?.status === "valid");
    assert.equal(completion.schemaVersion, 2);
    assert.equal(completion.sourceAttemptKind, "fix");
    assert.equal(completion.sourceAttemptId, attempt.id);
    assert.equal(completion.publisherAttemptId, attempt.id);
    assert.notEqual(
      completion.ledgerDigest,
      implementationCompletion.ledgerDigest
    );
    const report = await readFile(
      await boundFixturePath(
        repository.root,
        "documentation/features/example/implementation-report.md"
      )
    );
    assert.deepEqual(parsePublishedCompletionRegion(report), refreshed);
  } finally {
    await repository.dispose();
  }
});

test("resume does not complete a review checkpoint before candidate validation", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new FakeAdapters();
    adapters.reviewResults.push(passingReview());
    adapters.emitReviewTerminalCheckpoint = true;
    adapters.failReviewAfterTerminalCheckpoint = true;
    const runner = new WorkflowRunner(repository.root, adapters);
    await runner.start({ slug: "example", request: "Implement it." });
    const blocked = await runner.approvePlan("human");
    assert.equal(blocked.status, "blocked");
    const attempt = blocked.activeAttempt;
    assert.ok(attempt);
    assert.equal(attempt.kind, "review");
    const metricsBefore = structuredClone(blocked.metrics);

    await writeFile(
      runner.store.reviewCandidatePath(blocked.runId, attempt),
      "Corrupt candidate.\n",
      "utf8"
    );
    const resumed = await runner.resume();
    assert.equal(resumed.status, "blocked");
    assert.match(
      resumed.blockReason ?? "",
      /deterministic snapshot projection/i
    );
    assert.deepEqual(resumed.metrics, metricsBefore);
    const record = await runner.store.readRunAttempt(resumed.runId, attempt);
    assert.equal(record.status, "failed");
  } finally {
    await repository.dispose();
  }
});

class PlanningContinuityAdapters extends FakeAdapters {
  announceSession = true;
  checkpoint = false;
  failureCode = "PROCESS_TIMEOUT";
  failed = false;
  readonly planningUsage: ModelUsage = {
    inputTokens: 100,
    cachedInputTokens: 60,
    outputTokens: 5,
    costUsd: null
  };

  async runPhase(
    request: PhaseAdapterRequest
  ): Promise<AdapterResult<PhaseResult>> {
    if (!request.prompt.includes("Phase: plan"))
      return await super.runPhase(request);
    if (this.announceSession) {
      await request.onSessionStarted?.("planner-session");
      const record = JSON.parse(
        await readFile(
          path.join(
            request.runDirectory,
            "attempts",
            `${request.attemptId}-plan.json`
          ),
          "utf8"
        )
      ) as AttemptRecord;
      assert.equal(record.status, "started");
      assert.equal(record.sessionId, "planner-session");
      assert.equal(record.result, null);
    }
    const result = await super.runPhase(request);
    if (this.failed) return result;
    this.failed = true;
    if (this.checkpoint)
      await request.onTerminalSuccess?.({
        classification: "codex_turn_completed",
        observedAt: new Date().toISOString(),
        result: result.result,
        sessionId: "planner-session",
        usage: this.planningUsage
      });
    throw new ProcessExitError(
      this.failureCode,
      "Planning stopped after writing its artifacts.",
      {
        exitCode: 1,
        signal: null,
        stdout:
          '{"type":"thread.started","thread_id":"planner-session","password":"private-fixture"}\n',
        stderr: "Captured diagnostic.",
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString()
      },
      {
        failureCause:
          this.failureCode === "PROCESS_TIMEOUT" ? "timeout" : "unclassified",
        usage: this.planningUsage
      }
    );
  }
}

test("planning retry resumes the early saved session and preserves failed evidence", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new PlanningContinuityAdapters();
    const runner = new WorkflowRunner(repository.root, adapters);
    const blocked = await runner.start({
      slug: "example",
      request: "Plan the fixture."
    });
    assert.equal(blocked.status, "blocked");
    assert.equal(blocked.sessions.planner, null);
    assert.ok(blocked.activeAttempt);
    const source = await runner.store.readRunAttempt(
      blocked.runId,
      blocked.activeAttempt
    );
    assert.equal(source.sessionId, "planner-session");
    assert.ok(source.planningContext?.workspaceDigest);
    assert.ok(
      source.planningContext.artifactPaths.includes(
        blocked.planArtifacts?.plan ??
          path.relative(
            repository.root,
            await boundFixturePath(repository.root, planPath)
          )
      )
    );
    assert.deepEqual(blocked.metrics.usage, adapters.planningUsage);
    assert.ok(!blocked.metrics.completedAttemptIds.includes(source.attempt.id));
    assert.ok(source.rawStdoutPath);
    assert.doesNotMatch(
      await readFile(
        path.join(
          runner.store.runDirectory(blocked.runId),
          source.rawStdoutPath
        ),
        "utf8"
      ),
      /private-fixture/
    );

    // A new runner proves reuse comes from durable evidence, not process memory.
    const resumedRunner = new WorkflowRunner(repository.root, adapters);
    const planned = await resumedRunner.retry();
    assert.equal(planned.status, "needs_plan_approval");
    assert.equal(planned.planApproval, null);
    assert.deepEqual(adapters.phaseResumeSessionIds, [null, "planner-session"]);
    assert.match(
      adapters.phasePrompts[1] ?? "",
      /Do not restart repository discovery/
    );
    assert.match(
      adapters.phasePrompts[1] ?? "",
      /Planning stopped after writing its artifacts/
    );
    assert.deepEqual(
      await runner.store.readRunAttempt(blocked.runId, source.attempt),
      source
    );
    const descendant = (await runner.store.readRunAttempts(blocked.runId)).find(
      (record) => record.planningContext?.retryOf === source.attempt.id
    );
    assert.ok(descendant);
    assert.notEqual(descendant.attempt.id, source.attempt.id);
    assert.equal(descendant.sessionMode, "resumed");
    assert.equal(descendant.recoveryOf, null);
    assert.deepEqual(planned.metrics.usage, adapters.planningUsage);
  } finally {
    await repository.dispose();
  }
});

for (const change of [
  "workspace",
  "model",
  "scope",
  "legacy",
  "missing-session",
  "conflict"
] as const) {
  test(`planning retry uses artifacts in a fresh session after ${change}`, async () => {
    const repository = await createTestRepository();
    try {
      const adapters = new PlanningContinuityAdapters();
      if (change === "missing-session") adapters.announceSession = false;
      if (change === "conflict")
        adapters.failureCode = "TERMINAL_RESULT_CONFLICT";
      const runner = new WorkflowRunner(repository.root, adapters);
      const blocked = await runner.start({
        slug: "example",
        request: "Plan the fixture."
      });
      assert.ok(blocked.activeAttempt);
      if (change === "workspace")
        await writeFile(
          path.join(repository.root, "user-change.txt"),
          "New user input.\n"
        );
      if (change === "model" || change === "scope") {
        const configPath = path.join(repository.root, ".banzai/config.json");
        const config = JSON.parse(
          await readFile(configPath, "utf8")
        ) as OrchestratorConfig;
        if (change === "model")
          config.models.planner.model = "different-planner-model";
        else
          config.claudeEnvironment = { mode: "ambient", pluginDirectory: null };
        await writeFile(configPath, JSON.stringify(config));
      }
      if (change === "legacy") {
        const record = await runner.store.readRunAttempt(
          blocked.runId,
          blocked.activeAttempt
        );
        delete record.planningContext;
        await runner.store.writeRunAttempt(blocked.runId, record);
      }
      const planned = await runner.retry();
      assert.equal(planned.status, "needs_plan_approval");
      assert.deepEqual(adapters.phaseResumeSessionIds, [null, null]);
      assert.match(
        adapters.phasePrompts[1] ?? "",
        /Restore context from existing planning artifacts first/
      );
    } finally {
      await repository.dispose();
    }
  });
}

test("planning retry reconciles terminal proof without another model call or double-counted usage", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new PlanningContinuityAdapters();
    adapters.checkpoint = true;
    const runner = new WorkflowRunner(repository.root, adapters);
    const blocked = await runner.start({
      slug: "example",
      request: "Plan the fixture."
    });
    const planned = await runner.retry();
    assert.equal(
      planned.status,
      "needs_plan_approval",
      planned.blockReason ?? undefined
    );
    assert.equal(adapters.phasePrompts.length, 1);
    assert.equal(planned.metrics.attempts.plan, 1);
    assert.deepEqual(planned.metrics.usage, adapters.planningUsage);
    assert.deepEqual((await runner.resume()).metrics, planned.metrics);
    assert.ok(blocked.activeAttempt);
    assert.equal(
      (await runner.store.readRunAttempt(blocked.runId, blocked.activeAttempt))
        .status,
      "completed"
    );
  } finally {
    await repository.dispose();
  }
});

test("planning terminal conflict blocks reconciliation but permits an explicit fresh retry", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new PlanningContinuityAdapters();
    adapters.checkpoint = true;
    adapters.failureCode = "TERMINAL_RESULT_CONFLICT";
    const runner = new WorkflowRunner(repository.root, adapters);
    const sourceState = await runner.start({
      slug: "example",
      request: "Plan the fixture."
    });
    assert.ok(sourceState.activeAttempt);
    const source = await runner.store.readRunAttempt(
      sourceState.runId,
      sourceState.activeAttempt
    );
    const blocked = await runner.resume();
    assert.equal(blocked.status, "blocked");
    assert.match(blocked.blockReason ?? "", /Conflicting terminal/);
    assert.equal(adapters.phasePrompts.length, 1);
    assert.equal((await runner.resume()).status, "blocked");
    const planned = await runner.retry();
    assert.equal(planned.status, "needs_plan_approval");
    assert.deepEqual(adapters.phaseResumeSessionIds, [null, null]);
    assert.deepEqual(
      await runner.store.readRunAttempt(sourceState.runId, source.attempt),
      source
    );
  } finally {
    await repository.dispose();
  }
});

test("planning retry uses a new session when its terminal checkpoint no longer matches the model", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new PlanningContinuityAdapters();
    adapters.checkpoint = true;
    const runner = new WorkflowRunner(repository.root, adapters);
    await runner.start({ slug: "example", request: "Plan the fixture." });
    const configPath = path.join(repository.root, ".banzai/config.json");
    const config = JSON.parse(
      await readFile(configPath, "utf8")
    ) as OrchestratorConfig;
    config.models.planner.model = "different-planner-model";
    await writeFile(configPath, JSON.stringify(config));
    const planned = await runner.retry();
    assert.equal(planned.status, "needs_plan_approval");
    assert.deepEqual(adapters.phaseResumeSessionIds, [null, null]);
    assert.match(
      adapters.phasePrompts[1] ?? "",
      /Terminal checkpoint does not match/
    );
    assert.deepEqual(planned.metrics.usage, adapters.planningUsage);
  } finally {
    await repository.dispose();
  }
});

test("retry starts a distinct planning attempt and retains failed output", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new FakeAdapters();
    adapters.planErrors.push(
      new ProcessExitError(
        "CODEX_PHASE_FAILED",
        "Codex exited 1: Shortcut MCP authorization is required.",
        {
          exitCode: 1,
          signal: null,
          stdout:
            '{"type":"error","message":"Shortcut MCP authorization is required.","api_key":"secret-value"}\n',
          stderr: "Reading additional input from stdin...\n",
          startedAt: "2026-01-01T00:00:00.000Z",
          completedAt: "2026-01-01T00:00:01.000Z"
        }
      )
    );
    const runner = new WorkflowRunner(repository.root, adapters);

    const blocked = await runner.start({
      slug: "example",
      request: "Plan after authentication is restored."
    });
    assert.equal(blocked.status, "blocked");
    assert.equal(blocked.metrics.attempts.plan, 1);
    const failedAttempt = blocked.activeAttempt;
    assert.ok(failedAttempt);

    const failedRecord = await runner.store.readRunAttempt(
      blocked.runId,
      failedAttempt
    );
    assert.equal(failedRecord.status, "failed");
    assert.ok(failedRecord.rawStdoutPath);
    assert.ok(failedRecord.rawStderrPath);
    const retainedStdout = await readFile(
      path.join(
        runner.store.runDirectory(blocked.runId),
        failedRecord.rawStdoutPath
      ),
      "utf8"
    );
    assert.equal(retainedStdout.includes("secret-value"), false);
    assert.match(retainedStdout, /Shortcut MCP authorization is required/);

    const status = await runner.status();
    assert.equal(status.retry.eligible, true);
    assert.equal(status.nextAction, "banzai retry");

    const codexPreflightsBeforeRetry = adapters.codexPreflights;
    const claudePreflightsBeforeRetry = adapters.claudePreflights;
    const planned = await runner.retry();
    assert.equal(planned.status, "needs_plan_approval");
    assert.equal(planned.metrics.attempts.plan, 2);
    assert.ok(adapters.codexPreflights >= codexPreflightsBeforeRetry + 2);
    assert.ok(adapters.claudePreflights >= claudePreflightsBeforeRetry + 1);
    const planAttemptFiles = (
      await readdir(
        path.join(runner.store.runDirectory(blocked.runId), "attempts")
      )
    ).filter((entry) => entry.endsWith("-plan.json"));
    assert.equal(planAttemptFiles.length, 2);

    const preserved = await runner.store.readRunAttempt(
      blocked.runId,
      failedAttempt
    );
    assert.equal(preserved.status, "failed");
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

test("resume makes an interrupted read-only review explicitly retryable", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new FakeAdapters();
    adapters.reviewErrors.push(new Error("review interrupted"));
    adapters.reviewResults.push(passingReview());
    const runner = new WorkflowRunner(repository.root, adapters);
    await runner.start({ slug: "example", request: "Implement it." });

    const blocked = await runner.approvePlan("human");
    const attempt = blocked.activeAttempt;
    assert.equal(attempt?.kind, "review");
    assert.ok(attempt);
    const record = await runner.store.readRunAttempt(blocked.runId, attempt);
    record.status = "started";
    record.completedAt = null;
    record.error = null;
    await runner.store.writeRunAttempt(blocked.runId, record);
    transitionState(blocked, "reviewing");
    await runner.store.writeState(blocked);

    const reconciled = await runner.resume();
    assert.equal(reconciled.status, "blocked");
    assert.equal(reconciled.blockedFrom, "reviewing");
    assert.equal(reconciled.reviewIteration, 0);
    assert.equal(
      reconciled.pendingReviewRotationReason,
      "previous-review-interrupted"
    );
    assert.match(reconciled.blockReason ?? "", /banzai retry/);
    const status = await runner.status();
    assert.equal(status.retry.eligible, true);
    assert.match(status.retry.reason, /read-only/);
    assert.equal(status.nextAction, "banzai retry");

    const done = await runner.retry();
    assert.equal(done.status, "done", done.blockReason ?? "");
    assert.equal(done.reviewIteration, 1);
    assert.equal(done.latestReview?.iteration, 1);
    assert.equal(done.metrics.attempts.review, 2);
    assert.equal(adapters.reviewPrompts.length, 2);
    assert.deepEqual(adapters.reviewResumeSessionIds, [null, null]);
    assert.equal(
      done.latestReview.rotationReason,
      "previous-review-interrupted"
    );

    const preserved = await runner.store.readRunAttempt(blocked.runId, attempt);
    assert.equal(preserved.status, "started");
  } finally {
    await repository.dispose();
  }
});

test("retry resumes review checks after Claude authentication recovers", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new FakeAdapters();
    adapters.reviewResults.push(passingReview());
    const runner = new WorkflowRunner(repository.root, adapters);
    await runner.start({ slug: "example", request: "Implement it." });
    adapters.claudePreflightErrors.push(
      new Error("Claude subscription authentication is unavailable.")
    );

    const blocked = await runner.approvePlan("human");
    assert.equal(blocked.status, "blocked");
    assert.equal(blocked.blockedFrom, "reviewing");
    assert.equal(blocked.activeAttempt, null);
    assert.equal(blocked.pendingReviewRotationReason, "unreliable-review");
    assert.match(
      blocked.blockReason ?? "",
      /Claude subscription authentication/
    );
    assert.match(
      adapters.phasePrompts[1] ?? "",
      /Approved planning artifacts are immutable/
    );

    const status = await runner.status();
    assert.equal(status.retry.eligible, true);
    assert.equal(status.retry.attemptId, null);
    assert.equal(status.nextAction, "banzai retry");

    const done = await runner.retry();
    assert.equal(done.status, "done", done.blockReason ?? "");
    assert.equal(done.metrics.attempts.review, 1);
    assert.equal(adapters.reviewPrompts.length, 1);
    assert.equal(done.latestReview?.rotationReason, "unreliable-review");
  } finally {
    await repository.dispose();
  }
});

test("retry rejects failed mutable attempts without another model call", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new FakeAdapters();
    adapters.implementationErrors.push(new Error("implementation failed"));
    const runner = new WorkflowRunner(repository.root, adapters);
    await runner.start({ slug: "example", request: "Implement it." });

    const blocked = await runner.approvePlan("human");
    assert.equal(blocked.status, "blocked");
    assert.equal(blocked.activeAttempt?.mutable, true);
    const callsBeforeRetry = adapters.phasePrompts.length;

    const status = await runner.status();
    assert.equal(status.retry.eligible, false);
    assert.equal(status.nextAction, "banzai cancel");
    await assert.rejects(runner.retry(), /mutable attempts cannot be retried/);
    assert.equal(adapters.phasePrompts.length, callsBeforeRetry);
  } finally {
    await repository.dispose();
  }
});

test("transport-failed mutable implementation offers explicit recovery without weakening retry", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new FakeAdapters();
    adapters.implementationErrors.push(
      new ProcessExitError(
        "CLAUDE_PHASE_FAILED",
        "Claude exited 1: API Error: Server error mid-response.",
        {
          exitCode: 1,
          signal: null,
          stdout: "partial model output\n",
          stderr: "API Error: Server error mid-response.\n",
          startedAt: "2026-01-01T00:00:00.000Z",
          completedAt: "2026-01-01T00:01:00.000Z"
        },
        { failureCause: "transport" }
      )
    );
    adapters.reviewResults.push(passingReview());
    const runner = new WorkflowRunner(repository.root, adapters);
    await runner.start({ slug: "example", request: "Implement it." });

    const blocked = await runner.approvePlan("human");
    assert.equal(blocked.status, "blocked");
    const sourceAttempt = blocked.activeAttempt;
    assert.ok(sourceAttempt);
    assert.equal(sourceAttempt.kind, "implementation");
    const failed = await runner.store.readRunAttempt(
      blocked.runId,
      sourceAttempt
    );
    assert.equal(failed.status, "failed");
    assert.equal(failed.result, null);
    assert.equal(failed.failureCause, "transport");
    const failedLedger = await runner.store.readContextLedgerIfPresent(
      blocked.runId,
      sourceAttempt
    );
    const failedInvocation = failedLedger?.invocations[0];
    assert.ok(failedInvocation);
    assert.equal(failedInvocation.outcome, "failed");
    assert.ok(failedInvocation.runnerPayload.totalBytes > 0);
    assert.equal(
      failedInvocation.vendorUsage.inputTokens.availability,
      "unavailable"
    );

    const status = await runner.status();
    assert.equal(status.retry.eligible, false);
    assert.equal(status.recovery.eligible, true, status.recovery.reason);
    assert.equal(status.nextAction, "banzai recover");
    assert.ok(status.recovery.recoveryIdentity);

    const authorized = await runner.recover(
      {
        attemptId: sourceAttempt.id,
        recoveryIdentity: status.recovery.recoveryIdentity,
        unknownSideEffectsAccepted: true,
        decidedBy: "current-human"
      },
      false
    );
    assert.equal(authorized.recovery?.stage, "authorized");

    const done = await runner.resume();
    assert.equal(done.status, "done", done.blockReason ?? "");
    const interrupted = await runner.store.readRunAttempt(
      done.runId,
      sourceAttempt
    );
    assert.equal(interrupted.status, "interrupted");
    assert.equal(interrupted.failureCause, "transport");
    assert.match(interrupted.error ?? "", /Server error mid-response/);
    const preservedLedger = await runner.store.readContextLedgerIfPresent(
      done.runId,
      sourceAttempt
    );
    assert.deepEqual(preservedLedger, failedLedger);
    const recoveryRecord = (
      await runner.store.readRunAttempts(done.runId)
    ).find((record) => record.recoveryOf === sourceAttempt.id);
    assert.ok(recoveryRecord);
    const recoveryLedger = await runner.store.readContextLedgerIfPresent(
      done.runId,
      recoveryRecord.attempt
    );
    const recoveryInvocation = recoveryLedger?.invocations[0];
    assert.ok(recoveryInvocation);
    assert.equal(recoveryInvocation.sessionMode, "resumed");
    assert.equal(recoveryInvocation.outcome, "completed");
    assert.ok(recoveryInvocation.runnerPayload.totalBytes > 0);
  } finally {
    await repository.dispose();
  }
});

async function authorizedImplementationRecoveryFixture(
  pluginDirectory?: string
) {
  const repository = await createTestRepository();
  if (pluginDirectory !== undefined)
    await configureInstructionPlugin(repository.root, pluginDirectory);
  const adapters = new FakeAdapters();
  adapters.implementationErrors.push(new Error("implementation interrupted"));
  adapters.reviewResults.push(passingReview());
  const runner = new WorkflowRunner(repository.root, adapters);
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
  const status = await runner.status();
  assert.ok(status.recovery.recoveryIdentity);
  const authorized = await runner.recover(
    {
      attemptId: sourceAttempt.id,
      recoveryIdentity: status.recovery.recoveryIdentity,
      unknownSideEffectsAccepted: true,
      decidedBy: "current-human"
    },
    false
  );
  return { repository, adapters, runner, sourceAttempt, authorized };
}

test("explicit recovery preserves the interrupted attempt and creates one linked implementation", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new FakeAdapters();
    adapters.implementationErrors.push(new Error("implementation interrupted"));
    adapters.reviewResults.push(passingReview());
    const runner = new WorkflowRunner(repository.root, adapters);
    await runner.start({ slug: "example", request: "Implement it." });
    const blocked = await runner.approvePlan("human");
    const sourceAttempt = blocked.activeAttempt;
    assert.ok(sourceAttempt);
    assert.equal(sourceAttempt.kind, "implementation");
    const sourceRecord = await runner.store.readRunAttempt(
      blocked.runId,
      sourceAttempt
    );
    sourceRecord.status = "started";
    sourceRecord.schemaVersion = 1;
    sourceRecord.completedAt = null;
    sourceRecord.durationMs = null;
    sourceRecord.error = null;
    sourceRecord.failureCode = null;
    delete sourceRecord.interruptedAt;
    delete sourceRecord.recoveryOf;
    delete sourceRecord.recoveryAuthorizationId;
    // A schema-1 record predates the completion protocol fields.
    delete sourceRecord.completionProtocol;
    delete sourceRecord.retryOf;
    delete sourceRecord.envelope;
    delete sourceRecord.completionDiagnostic;
    await runner.store.writeRunAttempt(blocked.runId, sourceRecord);

    const status = await runner.status();
    assert.equal(status.retry.eligible, false);
    assert.equal(status.recovery.eligible, true, status.recovery.reason);
    assert.equal(status.nextAction, "banzai recover");
    assert.ok(status.recovery.recoveryIdentity);
    const callsBeforeAuthorization = adapters.phasePrompts.length;

    const authorized = await runner.recover(
      {
        attemptId: sourceAttempt.id,
        recoveryIdentity: status.recovery.recoveryIdentity,
        unknownSideEffectsAccepted: true,
        decidedBy: "current-human"
      },
      false
    );
    assert.equal(authorized.status, "blocked");
    assert.equal(adapters.phasePrompts.length, callsBeforeAuthorization);
    assert.equal(authorized.recovery?.sourceAttemptId, sourceAttempt.id);
    assert.equal(authorized.recovery.recoveryAttemptId, null);
    assert.equal(authorized.recovery.stage, "authorized");

    const done = await runner.resume();
    assert.equal(done.status, "done", done.blockReason ?? "");
    const recoveryAttemptId = done.recovery?.recoveryAttemptId;
    assert.ok(recoveryAttemptId);
    assert.equal(done.recovery?.stage, "attempt_started");
    assert.notEqual(recoveryAttemptId, sourceAttempt.id);
    const interrupted = await runner.store.readRunAttempt(
      done.runId,
      sourceAttempt
    );
    assert.equal(interrupted.status, "interrupted");
    assert.ok(interrupted.interruptedAt);
    const recoveryAttempt = await runner.store.readRunAttempt(done.runId, {
      id: recoveryAttemptId,
      kind: "implementation",
      mutable: true
    });
    assert.equal(recoveryAttempt.status, "completed");
    assert.equal(recoveryAttempt.recoveryOf, sourceAttempt.id);
    assert.equal(
      recoveryAttempt.recoveryAuthorizationId,
      done.recovery.authorizationId
    );
    assert.match(
      adapters.phasePrompts.at(-1) ?? "",
      /inspect the current checkout/i
    );
    assert.match(
      adapters.phasePrompts.at(-1) ?? "",
      new RegExp(sourceAttempt.id)
    );
    assert.equal(
      done.metrics.completedAttemptIds.filter((id) => id === recoveryAttemptId)
        .length,
      1
    );
  } finally {
    await repository.dispose();
  }
});

test("recovery resumes from a persisted interrupted-source stage and reuses one deterministic attempt leaf", async () => {
  const fixture = await authorizedImplementationRecoveryFixture();
  try {
    const { runner, adapters, sourceAttempt, authorized } = fixture;
    const originalWriteState = runner.store.writeState.bind(runner.store);
    let injected = false;
    runner.store.writeState = async (state) => {
      if (!injected && state.recovery?.stage === "attempt_started") {
        injected = true;
        throw new Error("injected before recovery attempt state link");
      }
      await originalWriteState(state);
    };
    const promptsBefore = adapters.phasePrompts.length;
    await assert.rejects(runner.resume(), /injected before recovery attempt/);
    runner.store.writeState = originalWriteState;

    const interruptedStage = await runner.store.readState(authorized.runId);
    assert.equal(interruptedStage.activeAttempt, null);
    assert.equal(interruptedStage.recovery?.stage, "source_interrupted");
    assert.equal(adapters.phasePrompts.length, promptsBefore);
    const recoveryAttemptId = `implementation-recovery-${authorized.recovery?.authorizationId.replace(/^recovery-/u, "")}`;
    const leaf = await runner.store.readRunAttempt(interruptedStage.runId, {
      id: recoveryAttemptId,
      kind: "implementation",
      mutable: true
    });
    assert.equal(leaf.status, "started");
    assert.equal(leaf.recoveryOf, sourceAttempt.id);

    const done = await runner.resume();
    assert.equal(done.status, "done", done.blockReason ?? "");
    assert.equal(done.recovery?.recoveryAttemptId, recoveryAttemptId);
    assert.equal(adapters.phasePrompts.length, promptsBefore + 1);
    assert.equal(
      done.metrics.attempts.implementation,
      authorized.metrics.attempts.implementation + 1
    );
    assert.equal(
      done.metrics.completedAttemptIds.filter((id) => id === recoveryAttemptId)
        .length,
      1
    );
    assert.equal(
      (
        await readdir(
          path.join(
            runner.store.runDirectory(done.runId),
            "recovery-authorizations"
          )
        )
      ).length,
      1
    );
  } finally {
    await fixture.repository.dispose();
  }
});

test("recovery reuses one authorization leaf after a crash before its state link", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new FakeAdapters();
    adapters.implementationErrors.push(new Error("implementation interrupted"));
    const runner = new WorkflowRunner(repository.root, adapters);
    await runner.start({ slug: "example", request: "Implement it." });
    const blocked = await runner.approvePlan("human");
    const sourceAttempt = blocked.activeAttempt;
    assert.ok(sourceAttempt);
    const record = await runner.store.readRunAttempt(
      blocked.runId,
      sourceAttempt
    );
    record.status = "started";
    record.completedAt = null;
    record.durationMs = null;
    record.error = null;
    record.failureCode = null;
    await runner.store.writeRunAttempt(blocked.runId, record);
    const status = await runner.status();
    assert.ok(status.recovery.recoveryIdentity);
    const input = {
      attemptId: sourceAttempt.id,
      recoveryIdentity: status.recovery.recoveryIdentity,
      unknownSideEffectsAccepted: true as const,
      decidedBy: "first-human"
    };
    const originalWriteState = runner.store.writeState.bind(runner.store);
    runner.store.writeState = async (state) => {
      if (state.recovery?.stage === "authorized") {
        throw new Error("injected before authorization state link");
      }
      await originalWriteState(state);
    };
    await assert.rejects(
      runner.recover(input, false),
      /injected before authorization state link/
    );
    runner.store.writeState = originalWriteState;

    const authorizationDirectory = path.join(
      runner.store.runDirectory(blocked.runId),
      "recovery-authorizations"
    );
    assert.equal((await readdir(authorizationDirectory)).length, 1);
    const authorized = await runner.recover(
      { ...input, decidedBy: "second-human" },
      false
    );
    assert.ok(authorized.recovery);
    assert.equal(authorized.recovery.stage, "authorized");
    assert.equal((await readdir(authorizationDirectory)).length, 1);
    const persisted = await runner.store.readRecoveryAuthorization(
      authorized.runId,
      authorized.recovery.authorizationId
    );
    assert.equal(persisted.decidedBy, "first-human");
  } finally {
    await repository.dispose();
  }
});

test("recovery crash after the attempt state link never starts another model call", async () => {
  const fixture = await authorizedImplementationRecoveryFixture();
  try {
    const { runner, adapters, authorized } = fixture;
    const originalWriteState = runner.store.writeState.bind(runner.store);
    let injected = false;
    runner.store.writeState = async (state) => {
      await originalWriteState(state);
      if (!injected && state.recovery?.stage === "attempt_started") {
        injected = true;
        throw new Error("injected after recovery attempt state link");
      }
    };
    const promptsBefore = adapters.phasePrompts.length;
    await assert.rejects(runner.resume(), /injected after recovery attempt/);
    runner.store.writeState = originalWriteState;

    const linked = await runner.store.readState(authorized.runId);
    assert.equal(linked.recovery?.stage, "attempt_started");
    assert.ok(linked.activeAttempt);
    assert.equal(adapters.phasePrompts.length, promptsBefore);
    assert.equal(
      linked.metrics.attempts.implementation,
      authorized.metrics.attempts.implementation + 1
    );

    const blocked = await runner.resume();
    assert.equal(blocked.status, "blocked");
    assert.match(blocked.blockReason ?? "", /interrupted/i);
    assert.equal(adapters.phasePrompts.length, promptsBefore);
    assert.equal(
      blocked.metrics.attempts.implementation,
      linked.metrics.attempts.implementation
    );
    assert.equal(
      (
        await readdir(
          path.join(
            runner.store.runDirectory(blocked.runId),
            "recovery-authorizations"
          )
        )
      ).length,
      1
    );
  } finally {
    await fixture.repository.dispose();
  }
});

test("workspace drift invalidates recovery authorization before any model call", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new FakeAdapters();
    adapters.implementationErrors.push(new Error("implementation interrupted"));
    const runner = new WorkflowRunner(repository.root, adapters);
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
    const status = await runner.status();
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
    const callsBeforeDrift = adapters.phasePrompts.length;
    await writeFile(
      path.join(repository.root, "src/after-authorization.txt"),
      "drift\n",
      "utf8"
    );

    await assert.rejects(
      runner.resume(),
      (error: unknown) =>
        error instanceof BanzaiError && error.code === "RECOVERY_STALE"
    );
    assert.equal(adapters.phasePrompts.length, callsBeforeDrift);
    const current = await runner.store.readState(blocked.runId);
    assert.equal(current.recovery, null);
    assert.equal(current.activeAttempt?.id, sourceAttempt.id);
    const refreshed = await runner.status();
    assert.equal(refreshed.recovery.eligible, true);
    assert.notEqual(
      refreshed.recovery.recoveryIdentity,
      status.recovery.recoveryIdentity
    );
  } finally {
    await repository.dispose();
  }
});

test("recovery revalidates workspace after vendor preflight before creating an attempt", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new FakeAdapters();
    adapters.implementationErrors.push(new Error("implementation interrupted"));
    const runner = new WorkflowRunner(repository.root, adapters);
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
    const status = await runner.status();
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
    const promptsBeforeResume = adapters.phasePrompts.length;
    adapters.onCodexPreflight = async () => {
      adapters.onCodexPreflight = null;
      await writeFile(
        path.join(repository.root, "src/preflight-drift.txt"),
        "changed during preflight\n",
        "utf8"
      );
    };

    await assert.rejects(
      runner.resume(),
      (error: unknown) =>
        error instanceof BanzaiError && error.code === "RECOVERY_STALE"
    );
    assert.equal(adapters.phasePrompts.length, promptsBeforeResume);
    const current = await runner.store.readState(blocked.runId);
    assert.equal(current.activeAttempt?.id, sourceAttempt.id);
    assert.equal(current.recovery, null);
    assert.equal(
      await runner.store.readRunAttemptIfExists(blocked.runId, {
        id: `implementation-recovery-${status.recovery.recoveryIdentity.slice(0, 24)}`,
        kind: "implementation",
        mutable: true
      }),
      null
    );
  } finally {
    await repository.dispose();
  }
});

test("malformed terminal checkpoint blocks resume and recovery without another model call", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new FakeAdapters();
    adapters.implementationErrors.push(new Error("implementation interrupted"));
    const runner = new WorkflowRunner(repository.root, adapters);
    await runner.start({ slug: "example", request: "Implement it." });
    const blocked = await runner.approvePlan("human");
    const attempt = blocked.activeAttempt;
    assert.ok(attempt);
    const record = await runner.store.readRunAttempt(blocked.runId, attempt);
    record.status = "started";
    record.completedAt = null;
    record.durationMs = null;
    record.error = null;
    record.failureCode = null;
    await runner.store.writeRunAttempt(blocked.runId, record);
    await writeFile(
      runner.store.terminalCheckpointPath(blocked.runId, attempt),
      '{"schema":"banzai-terminal-attempt-checkpoint/v1","secret":"FORBIDDEN"}\n',
      "utf8"
    );
    const callsBeforeResume = adapters.phasePrompts.length;

    const status = await runner.status();
    assert.equal(status.recovery.eligible, false);
    assert.match(status.recovery.reason, /malformed or conflicting/);
    assert.equal(status.nextAction, "banzai cancel");
    const stillBlocked = await runner.resume();
    assert.equal(stillBlocked.status, "blocked");
    assert.match(stillBlocked.blockReason ?? "", /INVALID_TERMINAL_CHECKPOINT/);
    assert.doesNotMatch(stillBlocked.blockReason ?? "", /FORBIDDEN/);
    assert.equal(adapters.phasePrompts.length, callsBeforeResume);
  } finally {
    await repository.dispose();
  }
});

async function prerequisiteBlockedFixFixture(
  recoveryResult: PhaseResult = phaseResult("fix", {
    resolvedFindingIds: ["R1-F3"]
  })
) {
  const repository = await createTestRepository();
  const adapters = new FakeAdapters();
  const accepted = ["R1-F2", "R1-F3", "R1-F5", "R1-F6"];
  adapters.reviewResults.push(
    {
      contractVersion: CONTRACT_VERSION,
      verdict: "changes_requested",
      summary: "Migration and link-delivery fixes are required.",
      findings: [
        finding("R1-F1", "Rejected mail-template change."),
        finding("R1-F2", "Do not return an unpersisted token."),
        finding("R1-F3", "Prove the migration and schema catalog."),
        finding("R1-F4", "Rejected functional expansion."),
        finding("R1-F5", "Restore the complete functional gate."),
        {
          ...finding("R1-F6", "Remove scratch artifacts."),
          evidence: [
            {
              path: "tests/Unit/ScratchUsersModelProbeTest.php",
              line: 1,
              detail: "Scratch artifact."
            }
          ]
        }
      ],
      reviewedFindingIds: [],
      deferredCoverage: []
    },
    passingReview(accepted)
  );
  adapters.fixResults.push(
    phaseResult("fix", {
      outcome: "blocked",
      gate: null,
      summary: "Migration round-trip evidence requires operator commands.",
      resolvedFindingIds: ["R1-F2", "R1-F5", "R1-F6"],
      questions: [
        "Run the migration round trip.",
        "Delete tests/Unit/ScratchUsersModelProbeTest.php."
      ],
      requestedVerification: ["Verify the generated schema catalog."]
    }),
    recoveryResult
  );
  adapters.emitFixTerminalCheckpoint = true;
  const runner = new WorkflowRunner(repository.root, adapters);
  await runner.start({ slug: "example", request: "Implement it." });
  const triageState = await runner.approvePlan("human");
  assert.equal(triageState.status, "needs_triage");
  const blocked = await runner.triage({
    accepted,
    rejected: ["R1-F1", "R1-F4"],
    deferred: [],
    note: null,
    decidedBy: "human"
  });
  adapters.emitFixTerminalCheckpoint = true;
  assert.equal(blocked.status, "blocked");
  assert.equal(blocked.blockedFrom, "fixing");
  assert.equal(blocked.activeAttempt, null);
  const completion = blocked.planTaskCompletion;
  if (completion?.status !== "valid") {
    throw new Error("Fixture requires valid plan-task completion.");
  }
  // The blocked fix leaves the runner-published reports untouched: under
  // ADR-0047 only an authorized publication may change their bytes.
  const sourceRecord = (await runner.store.readRunAttempts(blocked.runId)).find(
    (record) =>
      record.attempt.kind === "fix" &&
      record.status === "completed" &&
      (record.result as PhaseResult).outcome === "blocked"
  );
  assert.ok(sourceRecord);
  return { repository, adapters, runner, blocked, sourceRecord, accepted };
}

test("completed prerequisite-blocked fix recovers only remaining accepted findings and preserves its source", async () => {
  const fixture = await prerequisiteBlockedFixFixture();
  try {
    const { runner, adapters, blocked, sourceRecord } = fixture;
    const sourceBefore = JSON.stringify(sourceRecord);
    const completionBefore = JSON.stringify(blocked.planTaskCompletion);
    const status = await runner.status();
    assert.equal(status.retry.eligible, false);
    assert.equal(status.recovery.eligible, true, status.recovery.reason);
    assert.equal(status.taskCompletion.state, "complete");
    assert.equal(
      JSON.stringify(
        (await runner.store.readState(blocked.runId)).planTaskCompletion
      ),
      completionBefore
    );
    assert.equal(status.recovery.sourceKind, "prerequisite_blocked_fix");
    assert.equal(status.recovery.terminalCheckpointPresent, undefined);
    assert.deepEqual(status.recovery.resolvedFindingIds, [
      "R1-F2",
      "R1-F5",
      "R1-F6"
    ]);
    assert.deepEqual(status.recovery.remainingFindingIds, ["R1-F3"]);
    assert.deepEqual(status.recovery.prerequisites, [
      "Run the migration round trip.",
      "Verify the generated schema catalog."
    ]);
    assert.equal(status.nextAction, "banzai recover");
    assert.ok(status.recovery.recoveryIdentity);

    const authorized = await runner.recover(
      {
        attemptId: sourceRecord.attempt.id,
        recoveryIdentity: status.recovery.recoveryIdentity,
        unknownSideEffectsAccepted: true,
        decidedBy: "current-human"
      },
      false
    );
    assert.equal(authorized.recovery?.stage, "authorized");
    assert.equal(
      JSON.stringify(
        await runner.store.readRunAttempt(blocked.runId, sourceRecord.attempt)
      ),
      sourceBefore
    );

    const done = await runner.resume();
    assert.equal(done.status, "done", done.blockReason ?? "");
    assert.equal(done.fixCycle, 1);
    assert.equal(done.metrics.attempts.fix, 2);
    assert.equal(
      JSON.stringify(
        await runner.store.readRunAttempt(done.runId, sourceRecord.attempt)
      ),
      sourceBefore
    );
    const recoveryAttemptId = done.recovery?.recoveryAttemptId;
    assert.ok(recoveryAttemptId);
    const recoveryAttempt = await runner.store.readRunAttempt(done.runId, {
      id: recoveryAttemptId,
      kind: "fix",
      mutable: true
    });
    assert.equal(recoveryAttempt.recoveryOf, sourceRecord.attempt.id);
    assert.equal(recoveryAttempt.status, "completed");
    const prompt = adapters.phasePrompts.at(-1) ?? "";
    assert.match(prompt, /prerequisite-blocked fix recovery/i);
    assert.match(prompt, /Remaining accepted finding IDs/);
    assert.match(prompt, /R1-F3/);
    assert.match(prompt, /Resolved accepted finding IDs \(out of scope\)/);
    const acceptedSection = prompt
      .split("Accepted findings:\n")[1]
      ?.split("\n\n## Operator-authorized")[0];
    assert.ok(acceptedSection);
    assert.equal(acceptedSection.match(/"id":/g)?.length, 1);
    assert.match(acceptedSection, /R1-F3/);
    assert.doesNotMatch(acceptedSection, /R1-F2|R1-F5|R1-F6/);
    assert.doesNotMatch(prompt, /R1-F1|R1-F4/);
  } finally {
    await fixture.repository.dispose();
  }
});

test("prerequisite-blocked recovery resumes one prepared descendant after a crash", async () => {
  const fixture = await prerequisiteBlockedFixFixture();
  try {
    const { runner, adapters, sourceRecord } = fixture;
    const status = await runner.status();
    assert.ok(status.recovery.recoveryIdentity);
    const authorized = await runner.recover(
      {
        attemptId: sourceRecord.attempt.id,
        recoveryIdentity: status.recovery.recoveryIdentity,
        unknownSideEffectsAccepted: true,
        decidedBy: "current-human"
      },
      false
    );
    const originalWriteState = runner.store.writeState.bind(runner.store);
    let injected = false;
    runner.store.writeState = async (state) => {
      if (!injected && state.recovery?.stage === "attempt_started") {
        injected = true;
        throw new Error("injected before blocked-source attempt state link");
      }
      await originalWriteState(state);
    };
    const promptsBefore = adapters.phasePrompts.length;
    await assert.rejects(
      runner.resume(),
      /injected before blocked-source attempt state link/
    );
    runner.store.writeState = originalWriteState;

    const preserved = await runner.store.readState(authorized.runId);
    assert.equal(preserved.activeAttempt, null);
    assert.equal(preserved.recovery?.stage, "source_preserved");
    assert.equal(adapters.phasePrompts.length, promptsBefore);
    const recoveryAttemptId = `fix-recovery-${authorized.recovery?.authorizationId.replace(/^recovery-/u, "")}`;
    const prepared = await runner.store.readRunAttempt(preserved.runId, {
      id: recoveryAttemptId,
      kind: "fix",
      mutable: true
    });
    assert.equal(prepared.status, "started");
    assert.equal(prepared.recoveryOf, sourceRecord.attempt.id);

    const done = await runner.resume();
    assert.equal(done.status, "done", done.blockReason ?? "");
    assert.equal(done.recovery?.recoveryAttemptId, recoveryAttemptId);
    assert.equal(adapters.phasePrompts.length, promptsBefore + 1);
  } finally {
    await fixture.repository.dispose();
  }
});

test("a blocked recovery descendant cannot start another prerequisite chain", async () => {
  const fixture = await prerequisiteBlockedFixFixture(
    phaseResult("fix", {
      outcome: "blocked",
      gate: null,
      summary: "Another operator prerequisite remains.",
      resolvedFindingIds: ["R1-F3"],
      questions: ["Perform the remaining external check."]
    })
  );
  try {
    const { runner, adapters, sourceRecord } = fixture;
    const status = await runner.status();
    assert.ok(status.recovery.recoveryIdentity);
    const callsBefore = adapters.phasePrompts.length;
    const blockedAgain = await runner.recover({
      attemptId: sourceRecord.attempt.id,
      recoveryIdentity: status.recovery.recoveryIdentity,
      unknownSideEffectsAccepted: true,
      decidedBy: "current-human"
    });
    assert.equal(blockedAgain.status, "blocked");
    assert.equal(blockedAgain.activeAttempt, null);
    assert.equal(adapters.phasePrompts.length, callsBefore + 1);
    const finalStatus = await runner.status();
    assert.equal(finalStatus.recovery.eligible, false);
    assert.equal(finalStatus.nextAction, "banzai cancel");
    await assert.rejects(
      runner.recover({
        attemptId: sourceRecord.attempt.id,
        recoveryIdentity: status.recovery.recoveryIdentity,
        unknownSideEffectsAccepted: true,
        decidedBy: "current-human"
      }),
      (error: unknown) =>
        error instanceof BanzaiError && error.code === "RECOVERY_NOT_ALLOWED"
    );
    assert.equal(adapters.phasePrompts.length, callsBefore + 1);
  } finally {
    await fixture.repository.dispose();
  }
});

test("invalid prerequisite-blocked scopes fail closed without an authorization identity", async () => {
  const cases: {
    name: string;
    mutate(result: PhaseResult): void;
  }[] = [
    {
      name: "duplicate resolved finding",
      mutate: (result) => {
        result.resolvedFindingIds = ["R1-F2", "R1-F2"];
      }
    },
    {
      name: "resolved finding outside accepted scope",
      mutate: (result) => {
        result.resolvedFindingIds = ["R1-F2", "R1-F9"];
      }
    },
    {
      name: "empty remaining scope",
      mutate: (result) => {
        result.resolvedFindingIds = ["R1-F2", "R1-F3", "R1-F5", "R1-F6"];
      }
    },
    {
      name: "missing operator prerequisite",
      mutate: (result) => {
        result.questions = [];
        result.requestedVerification = [];
      }
    }
  ];

  for (const item of cases) {
    const fixture = await prerequisiteBlockedFixFixture();
    try {
      const result = structuredClone(
        fixture.sourceRecord.result as PhaseResult
      );
      item.mutate(result);
      await fixture.runner.store.writeRunAttempt(
        fixture.blocked.runId,
        withProtocolResult(fixture.sourceRecord, result)
      );

      const status = await fixture.runner.status();
      assert.equal(status.recovery.eligible, false, item.name);
      assert.equal(status.recovery.recoveryIdentity, null, item.name);
      assert.equal(status.nextAction, "banzai cancel", item.name);
    } finally {
      await fixture.repository.dispose();
    }
  }
});

test("review-triage mismatch and recovery-chain sources fail closed", async () => {
  const triageFixture = await prerequisiteBlockedFixFixture();
  try {
    const state = await triageFixture.runner.store.readState(
      triageFixture.blocked.runId
    );
    assert.ok(state.triage);
    state.triage.items = state.triage.items.slice(1);
    await triageFixture.runner.store.writeState(state);
    const status = await triageFixture.runner.status();
    assert.equal(status.recovery.eligible, false);
    assert.equal(status.recovery.recoveryIdentity, null);
  } finally {
    await triageFixture.repository.dispose();
  }

  const chainFixture = await prerequisiteBlockedFixFixture();
  try {
    chainFixture.sourceRecord.recoveryOf = "fix-1-prior";
    chainFixture.sourceRecord.recoveryAuthorizationId = "recovery-prior";
    await chainFixture.runner.store.writeRunAttempt(
      chainFixture.blocked.runId,
      chainFixture.sourceRecord
    );
    const status = await chainFixture.runner.status();
    assert.equal(status.recovery.eligible, false);
    assert.equal(status.recovery.recoveryIdentity, null);
  } finally {
    await chainFixture.repository.dispose();
  }
});

test("a live process keeps prerequisite recovery unavailable", async () => {
  const fixture = await prerequisiteBlockedFixFixture();
  try {
    const state = await fixture.runner.store.readState(fixture.blocked.runId);
    state.activeProcess = {
      pid: process.pid,
      kind: "fix",
      startedAt: new Date().toISOString()
    };
    await fixture.runner.store.writeState(state);

    const status = await fixture.runner.status();
    assert.equal(status.recovery.eligible, false);
    assert.match(status.recovery.reason, /no active attempt or process/);
    assert.equal(status.recovery.recoveryIdentity, null);
  } finally {
    await fixture.repository.dispose();
  }
});

test("an existing descendant permanently closes prerequisite recovery", async () => {
  const fixture = await prerequisiteBlockedFixFixture();
  try {
    const descendant: AttemptRecord = {
      ...fixture.sourceRecord,
      attempt: {
        id: "fix-recovery-existing",
        kind: "fix",
        mutable: true
      },
      status: "started",
      completedAt: null,
      interruptedAt: null,
      recoveryOf: fixture.sourceRecord.attempt.id,
      recoveryAuthorizationId: "recovery-existing",
      result: null,
      durationMs: null,
      error: null,
      failureCode: null,
      failureCause: null
    };
    await fixture.runner.store.writeRunAttempt(
      fixture.blocked.runId,
      descendant
    );

    const status = await fixture.runner.status();
    assert.equal(status.recovery.eligible, false);
    assert.match(status.recovery.reason, /descendant already exists/i);
    assert.equal(status.recovery.recoveryIdentity, null);
  } finally {
    await fixture.repository.dispose();
  }
});

test("workspace drift invalidates prerequisite recovery before a model call", async () => {
  const fixture = await prerequisiteBlockedFixFixture();
  try {
    const { runner, adapters, sourceRecord } = fixture;
    const sourceBefore = JSON.stringify(sourceRecord);
    const status = await runner.status();
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
    await writeFile(
      path.join(fixture.repository.root, "operator-evidence.txt"),
      "new evidence after authorization\n",
      "utf8"
    );
    const promptsBefore = adapters.phasePrompts.length;

    await assert.rejects(
      runner.resume(),
      (error: unknown) =>
        error instanceof BanzaiError && error.code === "RECOVERY_STALE"
    );
    assert.equal(adapters.phasePrompts.length, promptsBefore);
    const invalidated = await runner.store.readState(fixture.blocked.runId);
    assert.equal(invalidated.activeAttempt, null);
    assert.equal(invalidated.recovery, null);
    assert.equal(
      JSON.stringify(
        await runner.store.readRunAttempt(
          fixture.blocked.runId,
          sourceRecord.attempt
        )
      ),
      sourceBefore
    );
    const refreshed = await runner.status();
    assert.equal(refreshed.recovery.eligible, true, refreshed.recovery.reason);
    assert.notEqual(
      refreshed.recovery.recoveryIdentity,
      status.recovery.recoveryIdentity
    );
  } finally {
    await fixture.repository.dispose();
  }
});

test("source-result drift invalidates prerequisite recovery before a model call", async () => {
  const fixture = await prerequisiteBlockedFixFixture();
  try {
    const { runner, adapters, sourceRecord } = fixture;
    const status = await runner.status();
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
    const drifted = await runner.store.readRunAttempt(
      fixture.blocked.runId,
      sourceRecord.attempt
    );
    const result = structuredClone(drifted.result as PhaseResult);
    result.questions = [...result.questions, "A new prerequisite appeared."];
    await runner.store.writeRunAttempt(
      fixture.blocked.runId,
      withProtocolResult(drifted, result)
    );
    const promptsBefore = adapters.phasePrompts.length;

    await assert.rejects(
      runner.resume(),
      (error: unknown) =>
        error instanceof BanzaiError && error.code === "RECOVERY_STALE"
    );
    assert.equal(adapters.phasePrompts.length, promptsBefore);
    const invalidated = await runner.store.readState(fixture.blocked.runId);
    assert.equal(invalidated.activeAttempt, null);
    assert.equal(invalidated.recovery, null);
  } finally {
    await fixture.repository.dispose();
  }
});

test("multiple completed blocked sources fail closed without a recovery identity", async () => {
  const fixture = await prerequisiteBlockedFixFixture();
  try {
    const { runner, blocked, sourceRecord } = fixture;
    await runner.store.writeRunAttempt(blocked.runId, {
      ...sourceRecord,
      attempt: { ...sourceRecord.attempt, id: "fix-2-ambiguous" }
    });
    const status = await runner.status();
    assert.equal(status.recovery.eligible, false);
    assert.match(status.recovery.reason, /Multiple completed blocked/);
    assert.equal(status.recovery.recoveryIdentity, null);
    assert.equal(status.nextAction, "banzai cancel");
  } finally {
    await fixture.repository.dispose();
  }
});

test("fix recovery retains accepted-finding scope and never creates a second task ledger", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new FakeAdapters();
    adapters.fixErrors.push(new Error("fix interrupted"));
    adapters.reviewResults.push(
      {
        contractVersion: CONTRACT_VERSION,
        verdict: "changes_requested",
        summary: "One accepted fix is required.",
        findings: [finding("R1-F1", "Fix the fixture.")],
        reviewedFindingIds: [],
        deferredCoverage: []
      },
      passingReview(["R1-F1"])
    );
    const runner = new WorkflowRunner(repository.root, adapters);
    await runner.start({ slug: "example", request: "Implement it." });
    const triageState = await runner.approvePlan("human");
    assert.equal(triageState.status, "needs_triage");
    const blocked = await runner.triage({
      accepted: ["R1-F1"],
      rejected: [],
      deferred: [],
      note: null,
      decidedBy: "human"
    });
    assert.equal(blocked.status, "blocked");
    const sourceAttempt = blocked.activeAttempt;
    assert.ok(sourceAttempt);
    assert.equal(sourceAttempt.kind, "fix");
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

    const status = await runner.status();
    assert.equal(status.recovery.eligible, true, status.recovery.reason);
    assert.equal(status.recovery.phase, "fix");
    assert.equal(status.recovery.authorization, "plan_approval");
    assert.ok(status.recovery.recoveryIdentity);
    const done = await runner.recover({
      attemptId: sourceAttempt.id,
      recoveryIdentity: status.recovery.recoveryIdentity,
      unknownSideEffectsAccepted: true,
      decidedBy: "current-human"
    });

    assert.equal(done.status, "done", done.blockReason ?? "");
    const recoveryAttemptId = done.recovery?.recoveryAttemptId;
    assert.ok(recoveryAttemptId);
    const interrupted = await runner.store.readRunAttempt(
      done.runId,
      sourceAttempt
    );
    assert.equal(interrupted.status, "interrupted");
    const recovered = await runner.store.readRunAttempt(done.runId, {
      id: recoveryAttemptId,
      kind: "fix",
      mutable: true
    });
    assert.equal(recovered.recoveryOf, sourceAttempt.id);
    assert.equal((recovered.result as PhaseResult).taskCompletion, null);
    assert.deepEqual((recovered.result as PhaseResult).resolvedFindingIds, [
      "R1-F1"
    ]);
    assert.match(adapters.phasePrompts.at(-1) ?? "", /accepted finding IDs/);
    assert.match(adapters.phasePrompts.at(-1) ?? "", /R1-F1/);
  } finally {
    await repository.dispose();
  }
});

test("retry rejects interrupted planning attempts", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new FakeAdapters();
    adapters.planErrors.push(new Error("planner interrupted"));
    const runner = new WorkflowRunner(repository.root, adapters);
    const blocked = await runner.start({
      slug: "example",
      request: "Plan it."
    });
    const attempt = blocked.activeAttempt;
    assert.ok(attempt);
    assert.equal(attempt.kind, "plan");
    const record = await runner.store.readRunAttempt(blocked.runId, attempt);
    record.status = "started";
    record.completedAt = null;
    record.error = null;
    await runner.store.writeRunAttempt(blocked.runId, record);

    const status = await runner.status();
    assert.equal(status.retry.eligible, false);
    assert.equal(status.nextAction, "banzai cancel");
    await assert.rejects(
      runner.retry(),
      /Interrupted attempts cannot be retried/
    );
  } finally {
    await repository.dispose();
  }
});

test("cancellation during retry preflight is never overwritten", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new FakeAdapters();
    adapters.planErrors.push(new Error("planner unavailable"));
    const runner = new WorkflowRunner(repository.root, adapters);
    const blocked = await runner.start({
      slug: "example",
      request: "Plan it."
    });
    assert.equal(blocked.status, "blocked");

    adapters.onCodexPreflight = async () => {
      adapters.onCodexPreflight = null;
      await runner.cancel();
    };
    const cancelled = await runner.retry();
    assert.equal(cancelled.status, "cancelled");
    assert.equal((await runner.status()).state.status, "cancelled");
    assert.equal(adapters.phasePrompts.length, 1);
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

const LAYOUT_DIAGNOSTIC =
  "legacy Banzai layout: run `project-manifest` to migrate";

class LayoutStopAdapters extends FakeAdapters {
  stopPhase: PhaseResult["phase"] | null = null;
  override async runPhase(
    request: PhaseAdapterRequest
  ): Promise<AdapterResult<PhaseResult>> {
    if (
      this.stopPhase !== null &&
      request.prompt.includes(`Phase: ${this.stopPhase}`)
    ) {
      this.phasePrompts.push(request.prompt);
      this.phaseResumeSessionIds.push(request.resumeSessionId);
      const reportPath = path.relative(
        request.repoRoot,
        await boundFixturePath(
          request.repoRoot,
          "documentation/features/example/implementation-report.md"
        )
      );
      const strictImplementation =
        this.stopPhase === "implementation" &&
        !request.prompt.includes("Selected workflow:");
      if (strictImplementation) {
        await mkdir(path.dirname(path.join(request.repoRoot, reportPath)), {
          recursive: true
        });
        await writeFile(
          path.join(request.repoRoot, reportPath),
          `# Implementation report\n\n## Layout stop\n\n${LAYOUT_DIAGNOSTIC}\n`,
          "utf8"
        );
      }
      return adapterResult(
        phaseResult(this.stopPhase, {
          outcome: "needs_human_decision",
          gate: "escalation",
          summary: LAYOUT_DIAGNOSTIC,
          questions: [
            "Run project-manifest, approve the migration diff, then answer to replan."
          ],
          artifacts: {
            description: null,
            plan: null,
            adrs: [],
            implementationReport: strictImplementation ? reportPath : null,
            testReport: null
          },
          taskCompletion: strictImplementation
            ? {
                schemaVersion: PLAN_TASK_COMPLETION_SCHEMA_VERSION,
                tasks: [
                  {
                    taskId: "T001",
                    status: "incomplete",
                    evidence: [],
                    gap: {
                      reportPath,
                      section: "Layout stop",
                      detail: "Migration is required before implementation."
                    }
                  }
                ]
              }
            : null
        }),
        "layout-stop-session"
      );
    }
    return await super.runPhase(request);
  }
}

function layoutBlockedReview(): ReviewResult {
  return { ...passingReview(), verdict: "blocked", summary: LAYOUT_DIAGNOSTIC };
}

async function layoutProjectBytes(root: string) {
  return {
    agents: await readFile(path.join(root, "AGENTS.md"), "utf8"),
    claude: await readFile(path.join(root, "CLAUDE.md"), "utf8"),
    source: await snapshotTree(path.join(root, "src"))
  };
}

async function installLayoutFixture(
  root: string,
  fixture: string,
  side: "before" | "after"
): Promise<void> {
  for (const name of ["AGENTS.md", "CLAUDE.md"]) {
    const contents = await readFile(
      path.join(
        process.cwd(),
        "test/fixtures/instruction-layouts",
        fixture,
        side,
        name
      ),
      "utf8"
    );
    await writeFile(path.join(root, name), contents, "utf8");
  }
}

for (const stopPoint of [
  "planning",
  "implementation",
  "fix",
  "review",
  "review-retry",
  "lite"
] as const) {
  test(`skill-reported layout stop at ${stopPoint} continues only through the existing route`, async () => {
    const repository = await createTestRepository();
    try {
      // The runtime starts from adopted files. The fake then reports a
      // skill-level stop observed after preflight; it still grants no repair authority.
      await installLayoutFixture(
        repository.root,
        "approved-migration",
        "after"
      );
      await commitAll(repository.root, "adopted instruction fixture");
      const adapters = new LayoutStopAdapters();
      const runner = new WorkflowRunner(repository.root, adapters);
      let before: Awaited<ReturnType<typeof layoutProjectBytes>>;
      let stopped: RunState;
      if (stopPoint === "planning" || stopPoint === "lite") {
        adapters.stopPhase =
          stopPoint === "planning" ? "plan" : "implementation";
        if (stopPoint === "lite")
          adapters.selectionResults.push(
            selectionResult({ recommendedWorkflow: "feature" })
          );
        before = await layoutProjectBytes(repository.root);
        stopped = await runner.start({
          slug: "example",
          request: "Apply the bounded feature."
        });
      } else {
        await runner.start({
          slug: "example",
          request: "Apply the bounded feature."
        });
        if (stopPoint === "implementation") {
          adapters.stopPhase = "implementation";
          await runner.approvePlan("human", false);
          before = await layoutProjectBytes(repository.root);
          stopped = await runner.resume();
        } else if (stopPoint === "fix") {
          adapters.reviewResults.push({
            ...passingReview(),
            verdict: "changes_requested",
            findings: [finding("R1-F1", "Fixture defect.")]
          });
          await runner.approvePlan("human");
          await runner.triage(
            {
              accepted: ["R1-F1"],
              rejected: [],
              deferred: [],
              note: null,
              decidedBy: "human"
            },
            false
          );
          adapters.stopPhase = "fix";
          before = await layoutProjectBytes(repository.root);
          stopped = await runner.resume();
        } else {
          adapters.reviewResults.push(
            stopPoint === "review-retry"
              ? {
                  ...layoutBlockedReview(),
                  summary: "Initial fixture evidence unavailable."
                }
              : layoutBlockedReview()
          );
          // Implementation is completed before the simulated plugin update.
          // The adapter captures source bytes at the review boundary itself.
          before = await layoutProjectBytes(repository.root);
          adapters.onReview = async () => {
            before = await layoutProjectBytes(repository.root);
          };
          stopped = await runner.approvePlan("human");
          if (stopPoint === "review-retry") {
            adapters.reviewResults.push(layoutBlockedReview());
            stopped = await runner.retry();
          }
        }
      }
      assert.deepEqual(
        await layoutProjectBytes(repository.root),
        before,
        "layout stop changes neither source nor project instructions"
      );
      const statusCommand = spawnSync(
        process.execPath,
        [path.join(process.cwd(), "dist/banzai.mjs"), "status"],
        {
          cwd: repository.root,
          encoding: "utf8",
          env: monochromeEnv()
        }
      );
      assert.equal(statusCommand.status, 0, statusCommand.stderr);
      assert.ok(
        statusCommand.stdout.replace(/\s+/g, " ").includes(LAYOUT_DIAGNOSTIC),
        statusCommand.stdout
      );
      adapters.onReview = null;
      if (stopPoint === "review" || stopPoint === "review-retry") {
        assert.equal(stopped.status, "blocked");
        assert.equal(stopped.blockedFrom, "reviewing");
        const status = await runner.status();
        assert.equal(status.retry.eligible, true);
        assert.ok(status.latestReview);
        assert.deepEqual(status.latestReview.findings, []);
        assert.equal(status.latestReview.summary, LAYOUT_DIAGNOSTIC);
        const approval = stopped.planApproval;
        const triage = stopped.triage;
        adapters.reviewResults.push(layoutBlockedReview());
        const repeated = await runner.retry();
        assert.equal(
          (await runner.status()).latestReview?.summary,
          LAYOUT_DIAGNOSTIC
        );
        assert.equal(repeated.status, "blocked");
        assert.deepEqual(repeated.planApproval, approval);
        assert.deepEqual(repeated.triage, triage);
        assert.deepEqual(await layoutProjectBytes(repository.root), before);
        await installLayoutFixture(
          repository.root,
          "approved-migration",
          "after"
        );
        adapters.reviewResults.push(passingReview());
        const done = await runner.retry();
        assert.equal(done.status, "done", done.blockReason ?? "");
        assert.equal(adapters.reviewResumeSessionIds.at(-1), null);
        assert.equal(
          done.latestReview?.rotationReason,
          "previous-review-blocked"
        );
      } else {
        assert.equal(stopped.status, "needs_human_decision");
        assert.ok(stopped.pendingHumanDecision?.kind === "escalation");
        assert.equal(stopped.pendingHumanDecision.gate, "escalation");
        assert.equal(stopped.pendingHumanDecision.summary, LAYOUT_DIAGNOSTIC);
        const answered = await runner.answerHumanDecision(
          {
            answers: ["Continue under the existing route."],
            decidedBy: "human"
          },
          false
        );
        assert.equal(answered.planApproval, null);
        assert.equal(
          answered.status,
          stopPoint === "lite" ? "selecting" : "planning"
        );
        assert.deepEqual(await layoutProjectBytes(repository.root), before);
        // An answer is not a migration: the next affected phase stops again.
        adapters.stopPhase = "plan";
        const repeated = await runner.resume();
        assert.ok(repeated.pendingHumanDecision?.kind === "escalation");
        assert.equal(repeated.pendingHumanDecision.summary, LAYOUT_DIAGNOSTIC);
        assert.deepEqual(await layoutProjectBytes(repository.root), before);
        await installLayoutFixture(
          repository.root,
          "approved-migration",
          "after"
        );
        adapters.stopPhase = null;
        const replanned = await runner.answerHumanDecision({
          answers: ["The explicit fixture migration is complete; replan."],
          decidedBy: "human"
        });
        assert.equal(replanned.status, "needs_plan_approval");
        assert.equal(replanned.planApproval, null);
      }
    } finally {
      await repository.dispose();
    }
  });
}

test("layout stop after authorized recovery grants no migration authority", async () => {
  const repository = await createTestRepository();
  try {
    await installLayoutFixture(repository.root, "approved-migration", "after");
    await commitAll(repository.root, "adopted instruction fixture");
    const adapters = new LayoutStopAdapters();
    adapters.implementationErrors.push(
      new ProcessExitError(
        "CLAUDE_PHASE_FAILED",
        "Fixture transport interruption.",
        {
          exitCode: 1,
          signal: null,
          stdout: "",
          stderr: "",
          startedAt: "2026-01-01T00:00:00.000Z",
          completedAt: "2026-01-01T00:01:00.000Z"
        },
        { failureCause: "transport" }
      )
    );
    const runner = new WorkflowRunner(repository.root, adapters);
    await runner.start({
      slug: "example",
      request: "Recover the bounded feature."
    });
    const blocked = await runner.approvePlan("human");
    const status = await runner.status();
    assert.ok(blocked.activeAttempt && status.recovery.recoveryIdentity);
    assert.equal(status.recovery.eligible, true, status.recovery.reason);
    const before = await layoutProjectBytes(repository.root);
    adapters.stopPhase = "implementation";
    const stopped = await runner.recover({
      attemptId: blocked.activeAttempt.id,
      recoveryIdentity: status.recovery.recoveryIdentity,
      unknownSideEffectsAccepted: true,
      decidedBy: "human"
    });
    assert.equal(stopped.status, "needs_human_decision");
    assert.ok(stopped.pendingHumanDecision?.kind === "escalation");
    assert.equal(stopped.pendingHumanDecision.summary, LAYOUT_DIAGNOSTIC);
    assert.deepEqual(await layoutProjectBytes(repository.root), before);
  } finally {
    await repository.dispose();
  }
});

test("layout review stop stays within the closed review-result v1 schema", () => {
  const blocked = layoutBlockedReview();
  assert.equal(reviewResultSchema.additionalProperties, false);
  const acceptedKeys = Object.keys(reviewResultSchema.properties);
  assert.deepEqual(
    Object.keys(blocked).filter((key) => !acceptedKeys.includes(key)),
    []
  );
  const withGate = { ...blocked, gate: "escalation" };
  assert.deepEqual(
    Object.keys(withGate).filter((key) => !acceptedKeys.includes(key)),
    ["gate"],
    "the closed schema rejects an added gate key"
  );
});

for (const gate of ["escalation", "decision_consultation"] as const) {
  test(`layout cancellation from ${gate} preserves context and allows a new unmigrated run`, async () => {
    const repository = await createTestRepository();
    try {
      const adapters = new FakeAdapters();
      const escalation = phaseResult("plan", {
        gate: "escalation",
        summary: LAYOUT_DIAGNOSTIC,
        questions: ["Run project-manifest to migrate before continuing."]
      });
      const stop =
        gate === "escalation" ? escalation : decisionConsultationResult();
      adapters.planResults.push(
        phaseResult("plan", {
          gate: "escalation",
          questions: ["Should the feature preserve compatibility?"]
        }),
        stop,
        structuredClone(escalation)
      );
      const runner = new WorkflowRunner(repository.root, adapters);
      await runner.start({
        slug: "example",
        request: "Plan the bounded feature."
      });
      const waiting = await runner.answerHumanDecision({
        answers: ["Preserve compatibility."],
        decidedBy: "human"
      });
      assert.equal(waiting.status, "needs_human_decision");
      assert.equal(waiting.pendingHumanDecision?.kind, gate);
      assert.equal(waiting.humanDecisions?.length, 1);
      const cancelled = await runner.cancel();
      assert.equal(cancelled.outcome, "cancelled");
      // No manual state edits: the existing public cancellation route must leave
      // a readable terminal run before a new run can reach its own layout stop.
      const terminal = await runner.status();
      assert.equal(terminal.state.status, "cancelled");
      assert.equal(terminal.state.pendingHumanDecision, null);
      assert.deepEqual(terminal.state.humanDecisions, waiting.humanDecisions);
      const eventPath = `.banzai/runs/${waiting.runId}/events.jsonl`;
      const evidence = decodeCancellationEvents(
        await readCancellationFile(
          repository.root,
          eventPath,
          CANCELLATION_LIMITS.events
        )
      );
      const resolved = resolveCancellation(
        terminal.state,
        waiting.runId,
        evidence.events,
        evidence.availability
      );
      assert.equal(
        resolved.observation?.context.status.value,
        "needs_human_decision"
      );
      assert.equal(resolved.observation.context.gate.value, gate);
      if (gate === "decision_consultation") {
        assert.deepEqual(resolved.observation.context.decision.value, {
          kind: "consultation",
          requestId: "request-1",
          roundId: "round-1",
          relationship: "pending_at_cancel"
        });
      }
      const eventsBeforeRepeat = await readFile(
        path.join(repository.root, eventPath)
      );
      const repeated = await runner.cancel();
      assert.equal(repeated.outcome, "already_cancelled");
      assert.deepEqual(
        repeated.state?.cancellation,
        terminal.state.cancellation
      );
      assert.deepEqual(
        await readFile(path.join(repository.root, eventPath)),
        eventsBeforeRepeat
      );
      const restarted = await runner.start({
        slug: "example-again",
        request: "Try again without migration."
      });
      assert.notEqual(restarted.runId, waiting.runId);
      assert.ok(restarted.pendingHumanDecision?.kind === "escalation");
      assert.equal(restarted.pendingHumanDecision.summary, LAYOUT_DIAGNOSTIC);
    } finally {
      await repository.dispose();
    }
  });
}

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

test("adoption workflow start refuses before lock, run, attempt and authentication", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new FakeAdapters();
    adapters.reviewResults.push(passingReview());
    const runner = new WorkflowRunner(repository.root, adapters);
    await rm(path.join(repository.root, "PROJECT_MANIFEST.md"));
    const before = await snapshotTree(repository.root);
    await assert.rejects(
      runner.start({ slug: "example", request: "Implement it." }),
      (error) => {
        assert.ok(error instanceof BanzaiError);
        assert.equal(error.code, "PROJECT_SETUP_REQUIRED");
        assert.match(error.message, /PROJECT_MANIFEST.md.*banzai setup/);
        return true;
      }
    );
    assert.deepEqual(await snapshotTree(repository.root), before);
    assert.equal(adapters.codexPreflights + adapters.claudePreflights, 0);
    assert.equal(adapters.selectionPrompts.length, 0);
  } finally {
    await repository.dispose();
  }
});

test("adoption start rechecks under ownership before publishing a run", async (t) => {
  const repository = await createTestRepository();
  try {
    const adapters = new FakeAdapters();
    const runner = new WorkflowRunner(repository.root, adapters);
    const acquire = runner.store.acquireLock.bind(runner.store);
    t.mock.method(runner.store, "acquireLock", async () => {
      const lock = await acquire();
      await rm(path.join(repository.root, "PROJECT_MANIFEST.md"));
      return lock;
    });
    await assert.rejects(
      runner.start({ slug: "example", request: "Plan it." }),
      { code: "PROJECT_SETUP_REQUIRED" }
    );
    assert.deepEqual(
      await readdir(path.join(repository.root, ".banzai/runs")),
      []
    );
    await assert.rejects(
      readFile(path.join(repository.root, ".banzai/active-run.json")),
      /ENOENT/
    );
    await assert.rejects(
      readFile(path.join(repository.root, ".banzai/runner.lock")),
      /ENOENT/
    );
    assert.equal(adapters.codexPreflights + adapters.claudePreflights, 0);
  } finally {
    await repository.dispose();
  }
});

test("adoption saved ADR, answer and triage survive refused automatic continuation", async (t) => {
  for (const decision of ["adr", "answer", "triage"] as const)
    await t.test(decision, async () => {
      const repository = await createTestRepository();
      try {
        const adapters = new FakeAdapters();
        if (decision === "adr")
          adapters.planResults.push(
            phaseResult("plan", {
              outcome: "needs_human_decision",
              gate: "adr_approval"
            })
          );
        if (decision === "answer")
          adapters.planResults.push(
            phaseResult("plan", {
              outcome: "needs_human_decision",
              gate: "escalation",
              questions: ["Preserve compatibility?"]
            })
          );
        if (decision === "triage")
          adapters.reviewResults.push({
            ...passingReview(),
            verdict: "changes_requested",
            findings: [finding("R1-F1", "Repair the finding.")]
          });
        const runner = new WorkflowRunner(repository.root, adapters);
        await runner.start({ slug: "example", request: "Plan it." });
        if (decision === "triage") await runner.approvePlan("human");
        const prior = (await runner.status()).state;
        await rm(path.join(repository.root, "AGENTS.md"));
        const action =
          decision === "adr"
            ? runner.decideAdr({
                id: "ADR-0001",
                decision: "accept",
                note: null,
                decidedBy: "human",
                autoResume: true
              })
            : decision === "answer"
              ? runner.answerHumanDecision({
                  answers: ["Preserve compatibility."],
                  decidedBy: "human"
                })
              : runner.triage({
                  accepted: ["R1-F1"],
                  rejected: [],
                  deferred: [],
                  note: null,
                  decidedBy: "human"
                });
        await assert.rejects(action, { code: "PROJECT_SETUP_REQUIRED" });
        const saved = await runner.status();
        assert.equal(
          saved.state.status,
          decision === "triage" ? "fixing" : "planning"
        );
        assert.equal(saved.state.activeAttempt, null);
        assert.equal(saved.state.blockReason, null);
        assert.deepEqual(saved.state.metrics.usage, prior.metrics.usage);
        assert.deepEqual(saved.state.metrics.attempts, prior.metrics.attempts);
        if (decision === "adr")
          assert.equal(saved.state.adrDecisions[0]?.decision, "accept");
        if (decision === "answer") {
          const answer = saved.state.humanDecisions?.[0];
          assert.ok(answer?.kind === "escalation");
          assert.deepEqual(answer.answers, ["Preserve compatibility."]);
        }
        if (decision === "triage")
          assert.equal(saved.state.triage?.items[0]?.disposition, "accepted");
        const tree = await snapshotTree(path.join(repository.root, ".banzai"));
        const options = {
          format: "json" as const,
          from: null,
          to: null,
          runIds: []
        };
        const evaluation = await collectEvaluationExport(
          repository.root,
          options
        );
        const control = projectAgentControlStatus(saved);
        await assert.rejects(runner.resume(), {
          code: "PROJECT_SETUP_REQUIRED"
        });
        assert.deepEqual(
          await snapshotTree(path.join(repository.root, ".banzai")),
          tree
        );
        assert.deepEqual(
          await collectEvaluationExport(repository.root, options),
          evaluation
        );
        assert.deepEqual(
          projectAgentControlStatus(await runner.status()),
          control
        );
        assert.equal(saved.nextAction, "banzai resume");
        await runner.cancel({ reason: "execution_blocked" });
        const cancelled = (await runner.status()).state;
        assert.deepEqual(cancelled.metrics.usage, prior.metrics.usage);
        const events = decodeCancellationEvents(
          await readCancellationFile(
            repository.root,
            `.banzai/runs/${prior.runId}/events.jsonl`,
            CANCELLATION_LIMITS.events
          )
        );
        const observed = resolveCancellation(
          cancelled,
          prior.runId,
          events.events,
          events.availability
        );
        assert.equal(
          observed.observation?.context.status.value,
          saved.state.status
        );
        assert.doesNotMatch(
          JSON.stringify(observed),
          /PROJECT_SETUP_REQUIRED|process_start/
        );
      } finally {
        await repository.dispose();
      }
    });
});

test("adoption zero-accepted triage does not complete with stale evidence after guidance removal", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new FakeAdapters();
    adapters.reviewResults.push({
      ...passingReview(),
      verdict: "changes_requested",
      findings: [finding("R1-F1", "Optional observation.")]
    });
    const runner = new WorkflowRunner(repository.root, adapters);
    await runner.start({ slug: "example", request: "Implement it." });
    await runner.approvePlan("human");
    await rm(path.join(repository.root, "AGENTS.md"));
    const calls = adapters.phasePrompts.length;
    const done = await runner.triage({
      accepted: [],
      rejected: ["R1-F1"],
      deferred: [],
      note: "No change required.",
      decidedBy: "human"
    });
    assert.equal(done.status, "blocked");
    assert.match(
      done.blockReason ?? "",
      /verification is unavailable or stale/
    );
    assert.equal(done.triage?.items[0]?.disposition, "rejected");
    assert.equal(adapters.phasePrompts.length, calls);
  } finally {
    await repository.dispose();
  }
});

test("adoption continuation entry matrix preserves persisted bytes, next action and eligibility", async (t) => {
  for (const checkpoint of [
    "created",
    "selecting",
    "planning",
    "plan_approved",
    "implementing",
    "verifying",
    "reviewing",
    "fixing"
  ] as const)
    await t.test(checkpoint, async () => {
      const repository = await createTestRepository();
      try {
        const adapters = new FakeAdapters();
        adapters.reviewResults.push(passingReview());
        const runner = new WorkflowRunner(repository.root, adapters);
        const state = await runner.start({
          slug: "example",
          request: "Implement it."
        });
        state.status = checkpoint;
        state.activeAttempt = null;
        await runner.store.writeState(state);
        await rm(path.join(repository.root, "AGENTS.md"));
        const before = await snapshotTree(
          path.join(repository.root, ".banzai")
        );
        const status = await runner.status();
        const calls = [
          adapters.codexPreflights,
          adapters.claudePreflights,
          adapters.phasePrompts.length
        ];
        await assert.rejects(runner.resume(), (error) => {
          assert.ok(error instanceof BanzaiError);
          assert.equal(error.code, "PROJECT_SETUP_REQUIRED");
          assert.match(
            error.message,
            /AGENTS.md.*Repair or migrate.*cancel the unfinished run/
          );
          assert.doesNotMatch(error.message, /Run banzai setup/);
          return true;
        });
        assert.deepEqual(
          await snapshotTree(path.join(repository.root, ".banzai")),
          before
        );
        assert.deepEqual(await runner.status(), status);
        assert.deepEqual(
          [
            adapters.codexPreflights,
            adapters.claudePreflights,
            adapters.phasePrompts.length
          ],
          calls
        );
      } finally {
        await repository.dispose();
      }
    });
});

test("adoption refusal after saved plan approval retains the decision and adds no usage or cancellation attribution", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new FakeAdapters();
    adapters.reviewResults.push(passingReview());
    const runner = new WorkflowRunner(repository.root, adapters);
    const planned = await runner.start({
      slug: "example",
      request: "Implement it."
    });
    const beforeMetrics = structuredClone(planned.metrics);
    await rm(path.join(repository.root, "AGENTS.md"));
    await assert.rejects(runner.approvePlan("human"), {
      code: "PROJECT_SETUP_REQUIRED"
    });
    const saved = (await runner.status()).state;
    assert.equal(saved.status, "plan_approved");
    assert.ok(saved.planApproval);
    assert.equal(saved.activeAttempt, null);
    assert.equal(saved.blockedFrom, null);
    assert.equal(saved.blockReason, null);
    assert.deepEqual(saved.metrics, beforeMetrics);
    const before = await snapshotTree(path.join(repository.root, ".banzai"));
    await assert.rejects(runner.resume(), { code: "PROJECT_SETUP_REQUIRED" });
    assert.deepEqual(
      await snapshotTree(path.join(repository.root, ".banzai")),
      before
    );
    await writeFile(path.join(repository.root, "AGENTS.md"), ADOPTED_AGENTS);
    assert.equal((await runner.resume()).status, "done");
  } finally {
    await repository.dispose();
  }
});

test("adoption late retry refusal leaves original failure and retry transition unconsumed", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new FakeAdapters();
    adapters.reviewResults.push(passingReview());
    adapters.planErrors.push(
      new BanzaiError("MODEL_TIMEOUT", "Planner timed out.")
    );
    const runner = new WorkflowRunner(repository.root, adapters);
    const blocked = await runner.start({
      slug: "example",
      request: "Plan it."
    });
    assert.equal(blocked.status, "blocked");
    const before = await snapshotTree(path.join(repository.root, ".banzai"));
    const prior = await runner.status();
    const initial = adapters.codexPreflights;
    adapters.onCodexPreflight = async () => {
      // The first call is retry-wide preflight. Drift occurs later in the
      // planner's preparation, after the old implementation published retry.
      if (adapters.codexPreflights === initial + 2)
        await rm(path.join(repository.root, "AGENTS.md"));
    };
    await assert.rejects(runner.retry(), { code: "PROJECT_SETUP_REQUIRED" });
    assert.deepEqual(
      await snapshotTree(path.join(repository.root, ".banzai")),
      before
    );
    const after = await runner.status();
    assert.deepEqual(after.state, prior.state);
    assert.deepEqual(after.retry, prior.retry);
    assert.equal(adapters.phasePrompts.length, 1);
    adapters.onCodexPreflight = null;
    await writeFile(path.join(repository.root, "AGENTS.md"), ADOPTED_AGENTS);
    assert.equal((await runner.retry()).status, "needs_plan_approval");
  } finally {
    await repository.dispose();
  }
});

test("adoption mid-chain drift retains completed selection and the last durable planning checkpoint", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new FakeAdapters();
    adapters.reviewResults.push(passingReview());
    const runner = new WorkflowRunner(repository.root, adapters);
    const checkpoint: {
      value: Awaited<ReturnType<typeof snapshotTree>> | null;
    } = { value: null };
    adapters.onCodexPreflight = async () => {
      if (adapters.selectionPrompts.length === 1) {
        checkpoint.value = await snapshotTree(
          path.join(repository.root, ".banzai")
        );
        await rm(path.join(repository.root, "AGENTS.md"));
      }
    };
    await assert.rejects(
      runner.start({ slug: "example", request: "Plan it." }),
      { code: "PROJECT_SETUP_REQUIRED" }
    );
    assert.ok(checkpoint.value);
    const after = await snapshotTree(path.join(repository.root, ".banzai"));
    const status = await runner.status();
    const ownedClaim = `work/${status.state.artifactBinding?.binding.workId}/.writer-claim.json`;
    assert.ok(checkpoint.value.some((entry) => entry.path === ownedClaim));
    assert.ok(!after.some((entry) => entry.path === ownedClaim));
    // Only this command's runner/work claims are released; durable evidence stays exact.
    assert.deepEqual(
      after.filter(
        (entry) => entry.path !== "runner.lock" && entry.path !== ownedClaim
      ),
      checkpoint.value.filter(
        (entry) => entry.path !== "runner.lock" && entry.path !== ownedClaim
      )
    );
    assert.equal(status.state.status, "planning");
    assert.equal(status.state.activeAttempt, null);
    assert.equal(status.state.blockedFrom, null);
    assert.equal(status.state.metrics.attempts.selection, 1);
    assert.equal(status.state.metrics.attempts.plan, 0);
    assert.equal(status.nextAction, "banzai resume");
    assert.equal(status.retry.eligible, false);
    assert.equal(status.recovery.eligible, false);
    assert.equal(adapters.phasePrompts.length, 0);
  } finally {
    await repository.dispose();
  }
});

test("adoption ignores run-authored manifest structure until the next new start", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new FakeAdapters();
    adapters.reviewResults.push(passingReview());
    const runner = new WorkflowRunner(repository.root, adapters);
    await runner.start({ slug: "example", request: "Implement it." });
    await writeFile(
      path.join(repository.root, "PROJECT_MANIFEST.md"),
      "Temporarily incomplete phase output."
    );
    assert.equal((await runner.approvePlan("human")).status, "done");
    const before = await snapshotTree(path.join(repository.root, ".banzai"));
    await assert.rejects(
      runner.start({ slug: "next", request: "Next task." }),
      { code: "PROJECT_SETUP_REQUIRED" }
    );
    assert.deepEqual(
      await snapshotTree(path.join(repository.root, ".banzai")),
      before
    );
  } finally {
    await repository.dispose();
  }
});

test("adoption continuation honors the real source-workspace topology", async () => {
  const repository = await createTestRepository();
  try {
    await writeIdentity(repository.root, SOURCE_IDENTITY_FIXTURES[2].files);
    const configPath = path.join(repository.root, ".banzai/config.json");
    const fixtureConfig = JSON.parse(
      await readFile(configPath, "utf8")
    ) as OrchestratorConfig;
    requiredFixture(fixtureConfig.verification.profiles[0]).projectType =
      "node";
    await writeFile(configPath, JSON.stringify(fixtureConfig));
    await writeFile(
      path.join(repository.root, "AGENTS.md"),
      "@/host/instructions\n# Banzai source rules\n"
    );
    await commitAll(repository.root, "source identity");
    const adapters = new FakeAdapters();
    adapters.reviewResults.push(passingReview());
    const runner = new WorkflowRunner(repository.root, adapters);
    await runner.start({ slug: "example", request: "Implement it." });
    assert.equal((await runner.approvePlan("human")).status, "done");
  } finally {
    await repository.dispose();
  }
});

test("setup eligibility refuses unfinished and corrupt runs while preserving all evidence", async (t) => {
  const { withProjectSetupOwnership } = await import("../src/project-setup.js");
  for (const status of [
    "needs_plan_approval",
    "blocked",
    "done",
    "cancelled",
    "corrupt",
    "unsupported"
  ] as const)
    await t.test(status, async () => {
      const repository = await createTestRepository();
      try {
        const runner = new WorkflowRunner(repository.root, new FakeAdapters());
        const state = await runner.start({
          slug: "example",
          request: "Plan it."
        });
        if (status === "corrupt")
          await writeFile(runner.store.statePath(state.runId), "{}");
        else {
          state.status = status === "unsupported" ? "done" : status;
          await runner.store.writeState(state);
          if (status === "unsupported")
            await writeFile(
              runner.store.statePath(state.runId),
              JSON.stringify({ ...state, contractVersion: "unsupported" })
            );
        }
        const before = await snapshotTree(
          path.join(repository.root, ".banzai")
        );
        let launched = false;
        const operation = withProjectSetupOwnership(
          repository.root,
          async () => {
            launched = true;
          },
          {}
        );
        if (status === "done" || status === "cancelled") await operation;
        else
          await assert.rejects(operation, {
            code:
              status === "corrupt" || status === "unsupported"
                ? "PROJECT_SETUP_STATE_INVALID"
                : "PROJECT_SETUP_RUN_UNFINISHED"
          });
        assert.equal(launched, status === "done" || status === "cancelled");
        assert.deepEqual(
          await snapshotTree(path.join(repository.root, ".banzai")),
          before
        );
      } finally {
        await repository.dispose();
      }
    });
});

test("adoption pending recovery refusal preserves source, authorization and failure evidence before and after auth drift", async (t) => {
  for (const late of [false, true])
    await t.test(late ? "after auth" : "entry", async () => {
      const fixture = await authorizedImplementationRecoveryFixture();
      try {
        const { repository, runner, adapters } = fixture;
        const before = await snapshotTree(
          path.join(repository.root, ".banzai")
        );
        const calls = adapters.phasePrompts.length;
        if (late)
          adapters.onCodexPreflight = async () => {
            await rm(path.join(repository.root, "AGENTS.md"), { force: true });
          };
        else await rm(path.join(repository.root, "AGENTS.md"));
        await assert.rejects(runner.resume(), {
          code: "PROJECT_SETUP_REQUIRED"
        });
        assert.deepEqual(
          await snapshotTree(path.join(repository.root, ".banzai")),
          before
        );
        assert.equal(adapters.phasePrompts.length, calls);
        const status = await runner.status();
        assert.equal(status.state.recovery?.stage, "authorized");
        assert.equal(status.state.blockedFrom, "implementing");
        adapters.onCodexPreflight = null;
        await writeFile(
          path.join(repository.root, "AGENTS.md"),
          ADOPTED_AGENTS
        );
        assert.equal((await runner.resume()).status, "done");
      } finally {
        await fixture.repository.dispose();
      }
    });
});

test("adoption new recovery refusal retains prerequisite-blocked fix evidence and eligibility", async () => {
  const fixture = await prerequisiteBlockedFixFixture();
  try {
    const { runner, adapters, repository } = fixture;
    await rm(path.join(repository.root, "AGENTS.md"));
    const status = await runner.status();
    assert.ok(status.recovery.eligible);
    assert.ok(status.recovery.attemptId);
    assert.ok(status.recovery.recoveryIdentity);
    const before = await snapshotTree(path.join(repository.root, ".banzai"));
    const calls = adapters.phasePrompts.length;
    await assert.rejects(
      runner.recover({
        attemptId: status.recovery.attemptId,
        recoveryIdentity: status.recovery.recoveryIdentity,
        unknownSideEffectsAccepted: true,
        decidedBy: "human"
      }),
      { code: "PROJECT_SETUP_REQUIRED" }
    );
    assert.deepEqual(
      await snapshotTree(path.join(repository.root, ".banzai")),
      before
    );
    assert.deepEqual((await runner.status()).recovery, status.recovery);
    assert.equal(adapters.phasePrompts.length, calls);
  } finally {
    await fixture.repository.dispose();
  }
});

test("adoption first-selection refusal preserves the already-published created checkpoint", async (t) => {
  const repository = await createTestRepository();
  try {
    const adapters = new FakeAdapters();
    const runner = new WorkflowRunner(repository.root, adapters);
    const create = runner.store.createRun.bind(runner.store);
    let checkpoint: Awaited<ReturnType<typeof snapshotTree>> = [];
    t.mock.method(runner.store, "createRun", async (state: RunState) => {
      await create(state);
      checkpoint = await snapshotTree(
        path.join(repository.root, ".banzai/runs")
      );
      await rm(path.join(repository.root, "AGENTS.md"));
    });
    await assert.rejects(
      runner.start({ slug: "example", request: "Plan it." }),
      { code: "PROJECT_SETUP_REQUIRED" }
    );
    assert.deepEqual(
      await snapshotTree(path.join(repository.root, ".banzai/runs")),
      checkpoint
    );
    const status = await runner.status();
    assert.equal(status.state.status, "created");
    assert.equal(status.state.activeAttempt, null);
    assert.equal(status.nextAction, "banzai resume");
    assert.equal(adapters.codexPreflights + adapters.claudePreflights, 0);
  } finally {
    await repository.dispose();
  }
});

for (const artifactLayout of ["legacy", "private"] as const) {
  for (const workflow of ["strict", "feature", "quick-fix"] as const) {
    test(`artifact storage A1 ${artifactLayout} selection-to-${workflow} preserves binding and completes`, async () => {
      const repository = await createTestRepository({ artifactLayout });
      try {
        let originalBinding = "";
        class BoundAdapters extends FakeAdapters {
          override async runSelection(
            request: WorkflowSelectionAdapterRequest
          ): Promise<AdapterResult<WorkflowSelectionResult>> {
            const state = JSON.parse(
              await readFile(
                path.join(request.runDirectory, "state.json"),
                "utf8"
              )
            ) as RunState;
            assert.equal(state.schemaVersion, 8);
            assert.equal(state.workflowSelection, null);
            assert.equal(state.artifactBinding?.binding.mode, "workflow");
            originalBinding = await readFile(
              path.join(
                repository.root,
                `.banzai/work/${state.artifactBinding.binding.workId}/work.json`
              ),
              "utf8"
            );
            return await super.runSelection(request);
          }
        }
        const adapters = new BoundAdapters();
        adapters.selectionResults.push(
          selectionResult({ recommendedWorkflow: workflow })
        );
        adapters.reviewResults.push(passingReview());
        const runner = new WorkflowRunner(repository.root, adapters);
        let state = await runner.start({
          slug: "example",
          request: "Implement the fixture."
        });
        if (workflow === "strict") {
          assert.equal(
            state.status,
            "needs_plan_approval",
            state.blockReason ?? ""
          );
          state = await runner.approvePlan("human", true);
        }
        assert.equal(state.status, "done", state.blockReason ?? "");
        const bound = state.artifactBinding;
        assert.ok(bound);
        assert.equal(
          await readFile(
            path.join(
              repository.root,
              `.banzai/work/${bound.binding.workId}/work.json`
            ),
            "utf8"
          ),
          originalBinding
        );
        assert.equal(bound.binding.layout, "private");
        assert.equal(bound.binding.schemaVersion, 2);
        if (workflow === "strict") {
          assert.ok(state.latestReview?.artifactPath);
          assert.match(
            await readFile(
              path.join(repository.root, state.latestReview.artifactPath),
              "utf8"
            ),
            /banzai-feature-review\/v7/u
          );
          assert.equal(state.planTaskCompletion?.status, "valid");
        }
      } finally {
        await repository.dispose();
      }
    });
  }
}

for (const artifactLayout of ["legacy", "private"] as const) {
  for (const workflow of ["strict", "feature", "quick-fix"] as const)
    test(`artifact storage ${artifactLayout} ${workflow} implementation rejects another workflow's report`, async () => {
      const repository = await createTestRepository({ artifactLayout });
      try {
        class WrongRoleAdapters extends FakeAdapters {
          override async runPhase(
            request: PhaseAdapterRequest
          ): Promise<AdapterResult<PhaseResult>> {
            const result = await super.runPhase(request);
            if (result.result.phase !== "implementation") return result;
            const state = JSON.parse(
              await readFile(
                path.join(request.runDirectory, "state.json"),
                "utf8"
              )
            ) as RunState;
            const roles = state.artifactBinding?.binding.artifacts;
            const wrongRole =
              workflow === "quick-fix"
                ? roles?.implementationReport
                : roles?.changeReport;
            assert.ok(wrongRole);
            await mkdir(path.dirname(path.join(request.repoRoot, wrongRole)), {
              recursive: true
            });
            await writeFile(
              path.join(request.repoRoot, wrongRole),
              "Unauthorized report.\n"
            );
            return result;
          }
        }
        const adapters = new WrongRoleAdapters();
        adapters.selectionResults.push(
          selectionResult({ recommendedWorkflow: workflow })
        );
        const runner = new WorkflowRunner(repository.root, adapters);
        let state = await runner.start({
          slug: "example",
          request: "Implement the fixture."
        });
        if (workflow === "strict") state = await runner.approvePlan("human");
        assert.equal(state.status, "blocked");
        assert.match(state.blockReason ?? "", /unauthorized artifact/u);
      } finally {
        await repository.dispose();
      }
    });
}

for (const artifactLayout of ["legacy", "private"] as const) {
  test(`artifact storage ${artifactLayout} quick-fix without a report trigger completes without a report`, async () => {
    const repository = await createTestRepository({ artifactLayout });
    try {
      class NoReportAdapters extends FakeAdapters {
        override async runPhase(
          request: PhaseAdapterRequest
        ): Promise<AdapterResult<PhaseResult>> {
          const result = await super.runPhase(request);
          const report = result.result.artifacts.implementationReport;
          assert.ok(report);
          await rm(path.join(request.repoRoot, report));
          result.result.artifacts.implementationReport = null;
          assert.match(
            request.prompt,
            /only when the existing report trigger applies; otherwise keep it null/u
          );
          return result;
        }
      }
      const adapters = new NoReportAdapters();
      adapters.selectionResults.push(
        selectionResult({ recommendedWorkflow: "quick-fix" })
      );
      const state = await new WorkflowRunner(repository.root, adapters).start({
        slug: "example",
        request: "Make a routine internal cleanup with no report trigger."
      });
      assert.equal(state.status, "done", state.blockReason ?? "");
      const report = state.artifactBinding?.binding.artifacts.changeReport;
      assert.ok(report);
      await assert.rejects(readFile(path.join(repository.root, report)), {
        code: "ENOENT"
      });
    } finally {
      await repository.dispose();
    }
  });
}

for (const context of [
  "banzai-source",
  "home-project",
  "client-project"
] as const) {
  test(`artifact storage orchestrated ${context} separates work from run authority`, async () => {
    const repository = await createTestRepository({ artifactLayout: null });
    try {
      if (context === "banzai-source") {
        const identity = SOURCE_IDENTITY_FIXTURES.find(
          (fixture) => fixture.name === "source workspace"
        );
        assert.ok(identity);
        await writeIdentity(repository.root, identity.files);
        const configPath = path.join(repository.root, ".banzai/config.json");
        const fixtureConfig = JSON.parse(
          await readFile(configPath, "utf8")
        ) as OrchestratorConfig;
        requiredFixture(fixtureConfig.verification.profiles[0]).projectType =
          "node";
        await writeFile(configPath, JSON.stringify(fixtureConfig));
        await writeFile(
          path.join(repository.root, "AGENTS.md"),
          "# Source repository instructions\n"
        );
      }
      const adapters = new FakeAdapters();
      adapters.selectionResults.push(
        selectionResult({ recommendedWorkflow: "feature" })
      );
      const runner = new WorkflowRunner(repository.root, adapters);
      const state = await runner.start({
        slug: "example",
        request: "Implement the fixture."
      });
      assert.equal(state.status, "done", state.blockReason ?? "");
      assert.equal(state.artifactBinding?.binding.layout, "private");
      // The lite feature workflow never enters the completion protocol, so the
      // run keeps the bootstrap schema.
      assert.equal(state.schemaVersion, 8);
      assert.ok(
        (await readFile(runner.store.statePath(state.runId), "utf8")).includes(
          state.runId
        )
      );
    } finally {
      await repository.dispose();
    }
  });
}

test("accepted F2 runner claims exclude standalone writes throughout a phase and clean up on failure", async () => {
  const repository = await createTestRepository({ artifactLayout: "private" });
  try {
    let rejected = 0;
    class ClaimProbe extends FakeAdapters {
      override async runPhase(
        request: PhaseAdapterRequest
      ): Promise<AdapterResult<PhaseResult>> {
        const state = JSON.parse(
          await readFile(path.join(request.runDirectory, "state.json"), "utf8")
        ) as RunState;
        assert.ok(state.artifactBinding);
        const workPath = `.banzai/work/${state.artifactBinding.binding.workId}`;
        await assert.rejects(
          acquireWork({
            repoRoot: repository.root,
            workPath,
            ownerId: "standalone"
          }),
          { code: "ARTIFACT_OWNERSHIP_CONFLICT" }
        );
        rejected++;
        const independent = await createWork({
          repoRoot: repository.root,
          slug: "unrelated",
          mode: "lite",
          creationId: "11111111-1111-4111-8111-111111111111"
        });
        const otherPath = `.banzai/work/${independent.binding.workId}`;
        const other = await acquireWork({
          repoRoot: repository.root,
          workPath: otherPath,
          ownerId: "independent"
        });
        await releaseWork({
          repoRoot: repository.root,
          workPath: otherPath,
          token: other.token
        });
        return super.runPhase(request);
      }
    }
    const adapters = new ClaimProbe();
    adapters.selectionResults.push(
      selectionResult({ recommendedWorkflow: "feature" })
    );
    adapters.implementationErrors.push(new Error("controlled phase failure"));
    const runner = new WorkflowRunner(repository.root, adapters);
    const blocked = await runner.start({
      slug: "claimed",
      request: "Exercise exclusive evidence ownership."
    });
    assert.equal(blocked.status, "blocked", blocked.blockReason ?? "");
    assert.equal(rejected, 1);
    assert.ok(blocked.artifactBinding);
    const workPath = `.banzai/work/${blocked.artifactBinding.binding.workId}`;
    const claim = await acquireWork({
      repoRoot: repository.root,
      workPath,
      ownerId: "after-failure"
    });
    await releaseWork({
      repoRoot: repository.root,
      workPath,
      token: claim.token
    });
    await runner.cancel({ reason: "intent_changed" });
    adapters.reviewResults.push(passingReview());
    const planned = await runner.start({
      slug: "reverse-order",
      request: "Check standalone-first ownership."
    });
    assert.equal(
      planned.status,
      "needs_plan_approval",
      planned.blockReason ?? ""
    );
    assert.ok(planned.artifactBinding);
    const nextPath = `.banzai/work/${planned.artifactBinding.binding.workId}`;
    const held = await acquireWork({
      repoRoot: repository.root,
      workPath: nextPath,
      ownerId: "before-runner"
    });
    const beforeApproval = rejected;
    await assert.rejects(
      runner.approvePlan("human", true),
      /writer|ownership|claim/iu
    );
    assert.equal(rejected, beforeApproval);
    await releaseWork({
      repoRoot: repository.root,
      workPath: nextPath,
      token: held.token
    });
    const recovered = await runner.resume();
    assert.equal(recovered.status, "done", recovered.blockReason ?? "");
    const final = await acquireWork({
      repoRoot: repository.root,
      workPath: nextPath,
      ownerId: "after-completion"
    });
    await releaseWork({
      repoRoot: repository.root,
      workPath: nextPath,
      token: final.token
    });
  } finally {
    await repository.dispose();
  }
});

test("accepted F10 public doctor recognizes actual v4 runs and rejects binding drift read-only", async () => {
  const repository = await createTestRepository({ artifactLayout: "private" });
  try {
    const runner = new WorkflowRunner(repository.root, new FakeAdapters());
    const state = await runner.start({
      slug: "doctor",
      request: "Inspect a current run."
    });
    assert.equal(state.schemaVersion, 8);
    assert.ok(state.artifactBinding);
    const report = await inspectDoctor(repository.root);
    assert.notEqual(
      report.checks.find((item) => item.id === "run.active")?.status,
      "fail"
    );
    const filename = path.join(
      repository.root,
      ".banzai/runs",
      state.runId,
      "state.json"
    );
    for (const malformed of [
      { ...state, schemaVersion: 99 },
      { ...state, artifactBinding: null }
    ]) {
      const bytes = JSON.stringify(malformed);
      await writeFile(filename, bytes);
      const invalid = await inspectDoctor(repository.root);
      assert.equal(
        invalid.checks.find((item) => item.id === "run.active")?.status,
        "fail"
      );
      assert.equal(await readFile(filename, "utf8"), bytes);
    }
    await writeFile(filename, JSON.stringify(state));
    const bindingFile = path.join(
      repository.root,
      `.banzai/work/${state.artifactBinding.binding.workId}/work.json`
    );
    await writeFile(bindingFile, (await readFile(bindingFile, "utf8")) + "\n");
    const drift = await inspectDoctor(repository.root);
    assert.equal(
      drift.checks.find((item) => item.id === "run.active")?.status,
      "fail"
    );
  } finally {
    await repository.dispose();
  }
});

async function configureInstructionPlugin(
  repoRoot: string,
  directory: string,
  claudePlanner = false
): Promise<void> {
  const configPath = path.join(repoRoot, ".banzai/config.json");
  const config = JSON.parse(
    await readFile(configPath, "utf8")
  ) as OrchestratorConfig;
  config.claudeEnvironment = { mode: "scoped", pluginDirectory: directory };
  const executable = path.join(directory, "claude");
  await symlink(process.execPath, executable);
  config.models.implementer.executable = executable;
  if (claudePlanner) config.models.planner.executable = executable;
  await mkdir(path.join(repoRoot, ".claude"), { recursive: true });
  await writeFile(
    path.join(repoRoot, ".claude/settings.json"),
    JSON.stringify({ permissions: { allow: ["Write", "Edit", "Bash(*)"] } })
  );
  await writeFile(configPath, JSON.stringify(config));
}

test("instruction preflight refuses resource skew before any model or attempt and preserves structural refusal precedence", async (t) => {
  for (const structural of [false, true])
    await t.test(
      structural ? "invalid hook" : "resource mismatch",
      async () => {
        const repository = await createTestRepository({
          artifactLayout: "private"
        });
        const plugin = await instructionPluginFixture();
        try {
          await configureInstructionPlugin(repository.root, plugin.directory);
          await writeFile(
            path.join(plugin.directory, "phases/fix.md"),
            "PRIVATE-SKEW-CANARY"
          );
          if (structural)
            await rm(path.join(plugin.directory, "hooks/spec-gate.cjs"));
          const adapters = new FakeAdapters();
          const runner = new WorkflowRunner(repository.root, adapters);
          if (structural) {
            const state = await runner.start({
              slug: "example",
              request: "Plan it."
            });
            assert.equal(state.status, "blocked");
            assert.equal(
              (await runner.status()).state.metrics.attempts.plan,
              0
            );
          } else {
            await assert.rejects(
              runner.start({ slug: "example", request: "Plan it." }),
              { code: "INSTRUCTION_RESOURCE_MISMATCH" }
            );
            const status = await runner.status();
            assert.equal(status.state.status, "created");
            assert.equal(status.state.activeAttempt, null);
            assert.equal(status.state.blockReason, null);
            assert.deepEqual(
              await runner.store.readRunAttempts(status.state.runId),
              []
            );
            assert.equal(status.state.metrics.usage.inputTokens, 0);
          }
          assert.equal(
            adapters.selectionPrompts.length +
              adapters.phasePrompts.length +
              adapters.reviewPrompts.length,
            0
          );
          assert.equal(adapters.codexPreflights + adapters.claudePreflights, 0);
        } finally {
          await plugin.dispose();
          await repository.dispose();
        }
      }
    );
});

test("instruction per-call refusal retains saved approval and triage, exact bindings and usage in private and legacy work", async (t) => {
  for (const layout of ["private", "legacy"] as const)
    for (const gate of ["approval", "triage"] as const)
      await t.test(`${layout} ${gate}`, async () => {
        const repository = await createTestRepository({
          artifactLayout: layout
        });
        const plugin = await instructionPluginFixture();
        try {
          await configureInstructionPlugin(repository.root, plugin.directory);
          const adapters = new FakeAdapters();
          if (gate === "triage")
            adapters.reviewResults.push({
              ...passingReview(),
              verdict: "changes_requested",
              findings: [finding("R1-F1", "Repair it.")]
            });
          adapters.reviewResults.push(
            passingReview(gate === "triage" ? ["R1-F1"] : [])
          );
          const runner = new WorkflowRunner(repository.root, adapters);
          await runner.start({ slug: "example", request: "Implement it." });
          if (gate === "triage") {
            const approved = await runner.approvePlan("human");
            assert.notEqual(
              approved.status,
              "blocked",
              JSON.stringify(approved.blockReason)
            );
          }
          const prior = (await runner.status()).state;
          const resource = path.join(
            plugin.directory,
            `phases/${gate === "triage" ? "fix" : "implementation"}.md`
          );
          const original = await readFile(resource);
          await writeFile(
            resource,
            Buffer.concat([original, Buffer.from("\n")])
          );
          const calls = adapters.phasePrompts.length;
          await assert.rejects(
            gate === "approval"
              ? runner.approvePlan("human")
              : runner.triage({
                  accepted: ["R1-F1"],
                  rejected: [],
                  deferred: [],
                  note: null,
                  decidedBy: "human"
                }),
            { code: "INSTRUCTION_RESOURCE_MISMATCH" }
          );
          const saved = (await runner.status()).state;
          assert.equal(
            saved.status,
            gate === "approval" ? "plan_approved" : "fixing"
          );
          assert.ok(saved.planApproval);
          if (gate === "triage")
            assert.equal(saved.triage?.items[0]?.disposition, "accepted");
          assert.deepEqual(saved.metrics, {
            ...prior.metrics,
            triage:
              gate === "triage"
                ? { accepted: 1, rejected: 0, deferred: 0 }
                : prior.metrics.triage
          });
          assert.deepEqual(saved.artifactBinding, prior.artifactBinding);
          assert.equal(saved.activeAttempt, null);
          assert.equal(saved.blockReason, null);
          const before = await snapshotTree(
            path.join(repository.root, ".banzai")
          );
          const projectionOptions = {
            format: "json" as const,
            from: null,
            to: null,
            runIds: []
          };
          const projections = async () => {
            const evaluation = await collectEvaluationExport(
              repository.root,
              projectionOptions
            );
            return {
              evaluation,
              kpi: deriveEvaluationKpiReport([
                { label: "instruction-fixture", report: evaluation }
              ]),
              context: await collectContextReport(
                repository.root,
                projectionOptions
              )
            };
          };
          const beforeProjections = await projections();
          await assert.rejects(runner.resume(), {
            code: "INSTRUCTION_RESOURCE_MISMATCH"
          });
          assert.deepEqual(
            await snapshotTree(path.join(repository.root, ".banzai")),
            before
          );
          assert.deepEqual(await projections(), beforeProjections);
          assert.equal(adapters.phasePrompts.length, calls);
          await writeFile(resource, original);
          const resumed = await runner.resume();
          assert.equal(
            resumed.status,
            "done",
            JSON.stringify(resumed.blockReason)
          );
          const bound = saved.artifactBinding;
          assert.ok(bound);
          // Standalone status/review use this same explicit binding reader.
          const unrelated = await createWork({
            repoRoot: repository.root,
            slug: "unrelated",
            mode: "strict",
            creationId: randomUUID()
          });
          const consumerBefore = await snapshotTree(
            path.join(repository.root, ".banzai")
          );
          const selected = await inspectArtifacts({
            repoRoot: repository.root,
            workId: bound.binding.workId
          });
          assert.deepEqual(selected.work, bound);
          assert.notEqual(
            selected.work.binding.workId,
            unrelated.binding.workId
          );
          assert.deepEqual(
            await snapshotTree(path.join(repository.root, ".banzai")),
            consumerBefore
          );
          const roles = selected.work.binding.artifacts;
          assert.ok(roles);
          for (const prompt of [
            ...adapters.phasePrompts,
            ...adapters.reviewPrompts
          ]) {
            for (const role of [
              "description",
              "plan",
              "implementationReport",
              "testReport",
              "work",
              "changeReport"
            ] as const) {
              const target = roles[role];
              assert.ok(target);
              assert.ok(prompt.includes(target), role);
            }
            assert.doesNotMatch(
              prompt,
              /Use the available Skill tool|\$banzai:/
            );
          }
          assert.match(
            adapters.reviewPrompts[0] ?? "",
            /Model artifact write set: \[\]/
          );
          assert.match(
            adapters.selectionPrompts[0] ?? "",
            /Model artifact write set: \[\]/
          );
        } finally {
          await plugin.dispose();
          await repository.dispose();
        }
      });
});

test("late instruction skew preserves the failed planner retry and authorized recovery snapshots", async (t) => {
  await t.test("planner retry after authentication", async () => {
    const repository = await createTestRepository();
    const plugin = await instructionPluginFixture();
    const previousClaudeConfig = process.env.CLAUDE_CONFIG_DIR;
    try {
      process.env.CLAUDE_CONFIG_DIR = plugin.directory;
      await writeFile(
        path.join(plugin.directory, ".claude.json"),
        JSON.stringify({
          projects: { [repository.root]: { hasTrustDialogAccepted: true } }
        })
      );
      await configureInstructionPlugin(repository.root, plugin.directory, true);
      const adapters = new FakeAdapters();
      adapters.planErrors.push(
        new BanzaiError("MODEL_TIMEOUT", "Planner timed out.")
      );
      const runner = new WorkflowRunner(repository.root, adapters);
      const blocked = await runner.start({
        slug: "example",
        request: "Plan it."
      });
      assert.equal(blocked.status, "blocked");
      assert.match(blocked.blockReason ?? "", /Planner timed out/);
      const before = await snapshotTree(path.join(repository.root, ".banzai"));
      const prior = await runner.status();
      const initial = adapters.claudePreflights;
      const resource = path.join(plugin.directory, "phases/planning.md");
      const original = await readFile(resource);
      adapters.onClaudePreflight = async () => {
        if (adapters.claudePreflights === initial + 3)
          await writeFile(resource, "changed");
      };
      await assert.rejects(runner.retry(), {
        code: "INSTRUCTION_RESOURCE_MISMATCH"
      });
      assert.deepEqual(
        await snapshotTree(path.join(repository.root, ".banzai")),
        before
      );
      assert.deepEqual((await runner.status()).retry, prior.retry);
      assert.equal(adapters.phasePrompts.length, 1);
      adapters.onClaudePreflight = null;
      await writeFile(resource, original);
      assert.equal((await runner.retry()).status, "needs_plan_approval");
      assert.match(adapters.phasePrompts[1] ?? "", /# Planning Guidance/);
    } finally {
      if (previousClaudeConfig === undefined)
        delete process.env.CLAUDE_CONFIG_DIR;
      else process.env.CLAUDE_CONFIG_DIR = previousClaudeConfig;
      await plugin.dispose();
      await repository.dispose();
    }
  });
  await t.test("authorized implementation recovery", async () => {
    const plugin = await instructionPluginFixture();
    const fixture = await authorizedImplementationRecoveryFixture(
      plugin.directory
    );
    try {
      const { repository, runner, adapters } = fixture;
      const resource = path.join(plugin.directory, "phases/implementation.md");
      const original = await readFile(resource);
      await writeFile(resource, "changed");
      const prior = await runner.status();
      const before = await snapshotTree(path.join(repository.root, ".banzai"));
      const calls = adapters.phasePrompts.length;
      await assert.rejects(runner.resume(), {
        code: "INSTRUCTION_RESOURCE_MISMATCH"
      });
      assert.deepEqual(
        await snapshotTree(path.join(repository.root, ".banzai")),
        before
      );
      assert.deepEqual((await runner.status()).recovery, prior.recovery);
      assert.equal(adapters.phasePrompts.length, calls);
      await writeFile(resource, original);
      assert.equal((await runner.resume()).status, "done");
      assert.match(adapters.phasePrompts.at(-1) ?? "", /# Assurance Guidance/);
      assert.match(
        adapters.phasePrompts.at(-1) ?? "",
        /Operator-authorized interrupted-attempt recovery/
      );
    } finally {
      await fixture.repository.dispose();
      await plugin.dispose();
    }
  });
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

// ---------------------------------------------------------------------------
// ADR-0047 runner-owned completion publication: durable proof, crash seams,
// refusal routes, tamper guards, stop diagnostics and archive closure.
// ---------------------------------------------------------------------------

const NARRATIVE_REPORT =
  "# Implementation Report\n\n## Narrative\n\nThe fixture was implemented.\n";
const artifactsCommandPath = path.resolve(
  "../../plugins/banzai/scripts/artifacts.cjs"
);

async function completionEventCount(
  runner: WorkflowRunner,
  runId: string,
  type: string
): Promise<number> {
  const events = await readFile(
    path.join(runner.store.runDirectory(runId), "events.jsonl"),
    "utf8"
  );
  return events
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as { type: string })
    .filter((event) => event.type === type).length;
}

test("a narrative-only implementation is published once by the runner with attempt-owned durable proof", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new FakeAdapters();
    adapters.implementationReportTransforms.push(() => NARRATIVE_REPORT);
    adapters.reviewResults.push(passingReview());
    const runner = new WorkflowRunner(repository.root, adapters);
    await runner.start({ slug: "example", request: "Implement it." });
    const done = await runner.approvePlan("human");
    assert.equal(done.status, "done", done.blockReason ?? "");
    assert.equal(done.schemaVersion, 8);
    assert.equal(done.metrics.attempts.implementation, 1);
    assert.ok(
      adapters.phasePrompts.every((prompt) => !/repair retry/i.test(prompt))
    );
    const completion = done.planTaskCompletion;
    assert.ok(completion?.status === "valid");
    assert.equal(completion.schemaVersion, 2);
    assert.equal(
      completion.completionProtocol,
      "banzai-completion-protocol/v1"
    );
    const attempt = {
      id: completion.sourceAttemptId,
      kind: "implementation" as const,
      mutable: true
    };
    const ledger = phaseResult("implementation").taskCompletion;
    assert.ok(ledger);
    const reportPath = await boundFixturePath(
      repository.root,
      "documentation/features/example/implementation-report.md"
    );
    const report = await readFile(reportPath);
    const text = report.toString("utf8");
    assert.ok(text.startsWith(NARRATIVE_REPORT));
    assert.equal(
      text.split("<!-- banzai-plan-task-completion/v2:start -->").length,
      2
    );
    assert.ok(text.includes(renderCompletionRegion(ledger)));
    assert.deepEqual(parsePublishedCompletionRegion(report), ledger);

    const candidate = await runner.store.readCompletionCandidateIfExists(
      done.runId,
      attempt
    );
    assert.ok(candidate);
    assert.ok(candidate.bytes.equals(report));
    const receipt = await runner.store.readCompletionPublicationIfExists(
      done.runId,
      attempt
    );
    assert.ok(receipt);
    assert.equal(receipt.candidateDigest, candidate.candidate.integrityDigest);
    assert.deepEqual(receipt.ledgerAuthor, {
      attemptId: attempt.id,
      attemptKind: "implementation",
      ledgerDigest: completion.ledgerDigest
    });
    assert.deepEqual(receipt.publisher, {
      attemptId: attempt.id,
      attemptKind: "implementation"
    });
    assert.equal(completion.publisherAttemptId, attempt.id);
    assert.equal(completion.publication?.sha256, receipt.integrityDigest);
    const capture = await runner.store.readCompletionCaptureIfExists(
      done.runId,
      attempt
    );
    assert.ok(capture);
    assert.equal(capture.outcome, "completed");
    assert.equal(capture.integrityDigest, receipt.captureDigest);
    assert.equal(
      capture.originals.implementationReport?.sha256,
      createHash("sha256").update(NARRATIVE_REPORT).digest("hex")
    );
    assert.equal(
      await readFile(
        runner.store.completionEvidencePath(
          done.runId,
          attempt,
          "implementation-input.md"
        ),
        "utf8"
      ),
      NARRATIVE_REPORT
    );
    const transition = await runner.store.readCompletionTransitionIfExists(
      done.runId,
      attempt
    );
    assert.equal(transition, null);
    assert.equal(done.completionPublication?.stage, "event");
    assert.equal(done.completionPublication.refusal, null);
    assert.equal(
      await completionEventCount(
        runner,
        done.runId,
        "completion.publication_applied"
      ),
      1
    );
    assert.equal(
      await completionEventCount(
        runner,
        done.runId,
        "completion.publication_refused"
      ),
      0
    );
    const record = await runner.store.readRunAttempt(done.runId, attempt);
    assert.equal(record.status, "completed");
    assert.equal(record.schemaVersion, 4);
    assert.equal(record.completionProtocol, "banzai-completion-protocol/v1");
    assert.equal(record.retryOf, null);
    assert.equal(record.envelope?.originalDigest, capture.resultDigest);

    // The independent review froze the publication identities (snapshot v5,
    // rendered v6) instead of re-reading mutable report text.
    const review = (await runner.store.readRunAttempts(done.runId)).find(
      (item) => item.attempt.kind === "review"
    );
    assert.ok(review);
    const frozen = await runner.store.readReviewSnapshot(
      done.runId,
      review.attempt
    );
    assert.equal(frozen.schemaVersion, 6);
    assert.equal(
      frozen.completionPublication?.receiptDigest,
      receipt.integrityDigest
    );
    const artifact = await readFile(
      await boundFixturePath(
        repository.root,
        "documentation/features/example/review-1.md"
      ),
      "utf8"
    );
    assert.match(artifact, /banzai-feature-review\/v7/);
    assert.match(artifact, /Runner-owned completion publication/);
    assert.ok(artifact.includes(receipt.integrityDigest));
  } finally {
    await repository.dispose();
  }
});

for (const boundary of ["capture-manifest", "between-originals"] as const)
  test(`a restart ${boundary} keeps the terminal input authoritative and reconciles only after exact restoration`, async () => {
    const repository = await createTestRepository();
    try {
      const adapters = new FakeAdapters();
      adapters.reviewResults.push(passingReview());
      const runner = new WorkflowRunner(repository.root, adapters);
      let interrupted = false;
      if (boundary === "capture-manifest") {
        const writeCapture = runner.store.writeCompletionCapture.bind(
          runner.store
        );
        runner.store.writeCompletionCapture = async (runId, capture) => {
          if (!interrupted) {
            interrupted = true;
            throw new TerminalRunStateError(
              await runner.store.readState(runId)
            );
          }
          await writeCapture(runId, capture);
        };
      } else {
        const writeOriginal = runner.store.writeCompletionOriginal.bind(
          runner.store
        );
        runner.store.writeCompletionOriginal = async (
          runId,
          attempt,
          role,
          bytes
        ) => {
          const result = await writeOriginal(runId, attempt, role, bytes);
          if (!interrupted && role === "implementationReport") {
            interrupted = true;
            throw new TerminalRunStateError(
              await runner.store.readState(runId)
            );
          }
          return result;
        };
      }

      await runner.start({ slug: "example", request: "Implement it." });
      await runner.approvePlan("human");
      assert.equal(interrupted, true);
      const interruptedState = await runner.store.requireActiveState();
      assert.ok(interruptedState);
      const attempt = interruptedState.activeAttempt;
      assert.ok(attempt?.kind === "implementation");
      assert.ok(
        await runner.store.readTerminalCheckpointIfExists(
          interruptedState.runId,
          attempt
        )
      );
      assert.equal(
        await runner.store.readCompletionCaptureIfExists(
          interruptedState.runId,
          attempt
        ),
        null
      );

      const target =
        boundary === "capture-manifest"
          ? await boundFixturePath(
              repository.root,
              "documentation/features/example/implementation-report.md"
            )
          : path.join(repository.root, "src/example.txt");
      const original = await readFile(target);
      await writeFile(
        target,
        Buffer.concat([original, Buffer.from("drift\n")])
      );

      const resumedRunner = new WorkflowRunner(repository.root, adapters);
      const promptsBefore = adapters.phasePrompts.length;
      const drifted = await resumedRunner.resume();
      assert.equal(drifted.status, "blocked");
      assert.match(
        drifted.blockReason ?? "",
        /^\[COMPLETION_PUBLICATION_DRIFT\]/
      );
      assert.equal(adapters.phasePrompts.length, promptsBefore);
      assert.equal(
        await resumedRunner.store.readCompletionCaptureIfExists(
          drifted.runId,
          attempt
        ),
        null,
        "changed current bytes never become a replacement capture baseline"
      );
      const blockedStatus = await resumedRunner.status();
      assert.equal(blockedStatus.completionPublication?.action, "cancel");
      assert.equal(blockedStatus.nextAction, "banzai cancel");

      await writeFile(target, original);
      const restoredStatus = await resumedRunner.status();
      assert.equal(restoredStatus.completionPublication?.action, "resume");
      assert.equal(restoredStatus.nextAction, "banzai resume");
      const done = await resumedRunner.resume();
      assert.equal(done.status, "done", done.blockReason ?? "");
      assert.equal(adapters.phasePrompts.length, promptsBefore);
      assert.equal(
        done.metrics.completedAttemptIds.filter((id) => id === attempt.id)
          .length,
        1
      );
      assert.equal(
        await completionEventCount(
          resumedRunner,
          done.runId,
          "completion.publication_applied"
        ),
        1
      );
    } finally {
      await repository.dispose();
    }
  });

for (const setting of ["executable", "model", "effort"] as const)
  test(`checkpoint-only pending publication blocks ${setting} drift until the exact implementer configuration is restored`, async () => {
    const repository = await createTestRepository();
    try {
      const adapters = new FakeAdapters();
      adapters.reviewResults.push(passingReview());
      const runner = new WorkflowRunner(repository.root, adapters);
      const writeCapture = runner.store.writeCompletionCapture.bind(
        runner.store
      );
      let interrupted = false;
      runner.store.writeCompletionCapture = async (runId, capture) => {
        if (!interrupted) {
          interrupted = true;
          throw new TerminalRunStateError(await runner.store.readState(runId));
        }
        await writeCapture(runId, capture);
      };

      await runner.start({ slug: "example", request: "Implement it." });
      await runner.approvePlan("human");
      assert.equal(interrupted, true);
      const interruptedState = await runner.store.requireActiveState();
      const attempt = interruptedState.activeAttempt;
      assert.ok(attempt?.kind === "implementation");
      assert.equal(
        (await runner.store.readRunAttempt(interruptedState.runId, attempt))
          .status,
        "pending_application"
      );
      assert.equal(
        await runner.store.readCompletionCaptureIfExists(
          interruptedState.runId,
          attempt
        ),
        null
      );

      const configPath = path.join(repository.root, ".banzai/config.json");
      const originalConfig = await readFile(configPath);
      const hideConfigFromWorkspace = spawnSync(
        "git",
        ["update-index", "--assume-unchanged", ".banzai/config.json"],
        { cwd: repository.root }
      );
      assert.equal(
        hideConfigFromWorkspace.status,
        0,
        hideConfigFromWorkspace.stderr.toString()
      );
      const config = JSON.parse(
        originalConfig.toString("utf8")
      ) as OrchestratorConfig;
      if (setting === "executable")
        config.models.implementer.executable += "-changed";
      else if (setting === "model")
        config.models.implementer.model = `${config.models.implementer.model}-changed`;
      else
        config.models.implementer.effort =
          config.models.implementer.effort === "high" ? "medium" : "high";
      await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);

      const resumedRunner = new WorkflowRunner(repository.root, adapters);
      const promptsBefore = adapters.phasePrompts.length;
      const drifted = await resumedRunner.resume();
      assert.equal(drifted.status, "blocked");
      assert.match(
        drifted.blockReason ?? "",
        /^\[COMPLETION_PUBLICATION_DRIFT\]/
      );
      assert.equal(adapters.phasePrompts.length, promptsBefore);
      assert.equal(
        await resumedRunner.store.readCompletionCaptureIfExists(
          drifted.runId,
          attempt
        ),
        null,
        "changed configuration never becomes a replacement capture authority"
      );
      assert.equal(
        (await resumedRunner.status()).completionPublication?.action,
        "cancel"
      );

      await writeFile(configPath, originalConfig);
      assert.equal(
        (await resumedRunner.status()).completionPublication?.action,
        "resume"
      );
      const done = await resumedRunner.resume();
      assert.equal(done.status, "done", done.blockReason ?? "");
      assert.equal(adapters.phasePrompts.length, promptsBefore);
      assert.equal(
        done.metrics.completedAttemptIds.filter((id) => id === attempt.id)
          .length,
        1
      );
    } finally {
      await repository.dispose();
    }
  });

for (const setting of ["executable", "model", "effort"] as const)
  test(`pending publication blocks ${setting} drift until the exact implementer configuration is restored`, async () => {
    const repository = await createTestRepository();
    try {
      const adapters = new FakeAdapters();
      adapters.reviewResults.push(passingReview());
      const runner = new WorkflowRunner(repository.root, adapters);
      const writeCandidate = runner.store.writeCompletionCandidate.bind(
        runner.store
      );
      let injected = false;
      runner.store.writeCompletionCandidate = async (
        runId,
        candidate,
        bytes
      ) => {
        if (!injected) {
          injected = true;
          throw new Error("EIO: injected candidate write failure");
        }
        await writeCandidate(runId, candidate, bytes);
      };
      await runner.start({ slug: "example", request: "Implement it." });
      const blocked = await runner.approvePlan("human");
      assert.equal(blocked.status, "blocked");
      assert.equal(
        blocked.completionPublication?.refusal?.code,
        "COMPLETION_PUBLICATION_IO"
      );
      const attempt = blocked.activeAttempt;
      assert.ok(attempt?.kind === "implementation");
      const configPath = path.join(repository.root, ".banzai/config.json");
      const originalConfig = await readFile(configPath);
      const config = JSON.parse(
        originalConfig.toString("utf8")
      ) as OrchestratorConfig;
      if (setting === "executable")
        config.models.implementer.executable += "-changed";
      else if (setting === "model")
        config.models.implementer.model = `${config.models.implementer.model}-changed`;
      else
        config.models.implementer.effort =
          config.models.implementer.effort === "high" ? "medium" : "high";
      await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);

      const promptsBefore = adapters.phasePrompts.length;
      const driftStatus = await runner.status();
      assert.equal(driftStatus.completionPublication?.action, "cancel");
      assert.equal(driftStatus.nextAction, "banzai cancel");
      assert.equal(
        projectAgentControlStatus(driftStatus).activeRun?.nextAction,
        "cancel"
      );
      const drifted = await runner.resume();
      assert.equal(drifted.status, "blocked");
      assert.match(
        drifted.blockReason ?? "",
        /^\[COMPLETION_PUBLICATION_DRIFT\]/
      );
      assert.equal(adapters.phasePrompts.length, promptsBefore);
      assert.equal(drifted.planTaskCompletion, null);
      assert.equal(
        (await runner.store.readRunAttempt(drifted.runId, attempt)).status,
        "pending_application"
      );

      await writeFile(configPath, originalConfig);
      assert.equal(
        (await runner.status()).completionPublication?.action,
        "resume"
      );
      const done = await runner.resume();
      assert.equal(done.status, "done", done.blockReason ?? "");
      assert.equal(adapters.phasePrompts.length, promptsBefore);
      assert.equal(
        done.metrics.completedAttemptIds.filter((id) => id === attempt.id)
          .length,
        1
      );
      assert.equal(
        await completionEventCount(
          runner,
          done.runId,
          "completion.publication_applied"
        ),
        1
      );
    } finally {
      await repository.dispose();
    }
  });

for (const boundary of ["capture", "candidate", "event"] as const)
  for (const timing of ["before", "after"] as const)
    test(`an ordinary ${timing}-write ${boundary} cursor failure remains publication I/O and resumes without a model failure`, async () => {
      const repository = await createTestRepository();
      try {
        const adapters = new FakeAdapters();
        adapters.reviewResults.push(passingReview());
        const runner = new WorkflowRunner(repository.root, adapters);
        const writeState = runner.store.writeState.bind(runner.store);
        let injected = false;
        runner.store.writeState = async (state) => {
          if (
            !injected &&
            state.completionPublication?.stage === boundary &&
            state.completionPublication.refusal === null
          ) {
            injected = true;
            if (timing === "after") await writeState(state);
            throw new Error(
              `EIO: injected ${timing} ${boundary} cursor failure`
            );
          }
          await writeState(state);
        };

        await runner.start({ slug: "example", request: "Implement it." });
        const blocked = await runner.approvePlan("human");
        assert.equal(injected, true);
        assert.equal(blocked.status, "blocked");
        const refusal = blocked.completionPublication?.refusal;
        assert.ok(refusal);
        assert.equal(refusal.code, "COMPLETION_PUBLICATION_IO");
        assert.equal(refusal.stage, boundary);
        const attempt = blocked.activeAttempt;
        assert.ok(attempt?.kind === "implementation");
        assert.equal(
          (await runner.store.readRunAttempt(blocked.runId, attempt)).status,
          "pending_application"
        );
        assert.equal(
          await completionEventCount(runner, blocked.runId, "attempt.failed"),
          0
        );

        const promptsBefore = adapters.phasePrompts.length;
        const resumedRunner = new WorkflowRunner(repository.root, adapters);
        const done = await resumedRunner.resume();
        assert.equal(done.status, "done", done.blockReason ?? "");
        assert.equal(adapters.phasePrompts.length, promptsBefore);
        assert.equal(
          done.metrics.completedAttemptIds.filter((id) => id === attempt.id)
            .length,
          1
        );
        assert.equal(
          await completionEventCount(
            resumedRunner,
            done.runId,
            "attempt.failed"
          ),
          0
        );
        assert.equal(
          await completionEventCount(
            resumedRunner,
            done.runId,
            "completion.publication_applied"
          ),
          1
        );
      } finally {
        await repository.dispose();
      }
    });

for (const boundary of ["capture", "candidate", "event"] as const)
  for (const timing of ["before", "after"] as const)
    test(`consecutive ordinary ${timing}-write ${boundary} cursor and refusal failures never become a model failure`, async () => {
      const repository = await createTestRepository();
      try {
        const adapters = new FakeAdapters();
        adapters.reviewResults.push(passingReview());
        const runner = new WorkflowRunner(repository.root, adapters);
        const writeState = runner.store.writeState.bind(runner.store);
        let cursorInjected = false;
        let refusalInjected = false;
        runner.store.writeState = async (state) => {
          const publication = state.completionPublication;
          if (
            !cursorInjected &&
            publication?.stage === boundary &&
            publication.refusal === null
          ) {
            cursorInjected = true;
            if (timing === "after") await writeState(state);
            throw new Error(
              `EIO: injected ${timing} ${boundary} cursor failure`
            );
          }
          if (
            cursorInjected &&
            !refusalInjected &&
            publication?.stage === boundary &&
            publication.refusal?.code === "COMPLETION_PUBLICATION_IO"
          ) {
            refusalInjected = true;
            if (timing === "after") await writeState(state);
            throw new Error(
              `EIO: injected ${timing} ${boundary} refusal-state failure`
            );
          }
          await writeState(state);
        };

        await runner.start({ slug: "example", request: "Implement it." });
        const blocked = await runner.approvePlan("human");
        assert.equal(cursorInjected, true);
        assert.equal(refusalInjected, true);
        assert.equal(blocked.status, "blocked");
        const attempt = blocked.activeAttempt;
        assert.ok(attempt?.kind === "implementation");
        assert.equal(
          (await runner.store.readRunAttempt(blocked.runId, attempt)).status,
          "pending_application"
        );
        assert.equal(
          await completionEventCount(runner, blocked.runId, "attempt.failed"),
          0
        );

        const promptsBefore = adapters.phasePrompts.length;
        const resumedRunner = new WorkflowRunner(repository.root, adapters);
        const done = await resumedRunner.resume();
        assert.equal(done.status, "done", done.blockReason ?? "");
        assert.equal(adapters.phasePrompts.length, promptsBefore);
        assert.equal(
          done.metrics.completedAttemptIds.filter((id) => id === attempt.id)
            .length,
          1
        );
        assert.equal(
          await completionEventCount(
            resumedRunner,
            done.runId,
            "attempt.failed"
          ),
          0
        );
        assert.equal(
          await completionEventCount(
            resumedRunner,
            done.runId,
            "completion.publication_applied"
          ),
          1
        );
        assert.equal(
          await completionEventCount(
            resumedRunner,
            done.runId,
            "completion.publication_refused"
          ),
          timing === "after" ? 1 : 0
        );

        const repeated = await resumedRunner.resume();
        assert.equal(repeated.status, "done");
        assert.equal(
          await completionEventCount(
            resumedRunner,
            done.runId,
            "completion.publication_applied"
          ),
          1
        );
      } finally {
        await repository.dispose();
      }
    });

for (const timing of ["before", "after"] as const)
  test(`an ordinary ${timing}-append publication-refusal event failure resumes without a model failure`, async () => {
    const repository = await createTestRepository();
    try {
      const adapters = new FakeAdapters();
      adapters.reviewResults.push(passingReview());
      const runner = new WorkflowRunner(repository.root, adapters);
      const writeState = runner.store.writeState.bind(runner.store);
      let cursorInjected = false;
      runner.store.writeState = async (state) => {
        if (
          !cursorInjected &&
          state.completionPublication?.stage === "capture" &&
          state.completionPublication.refusal === null
        ) {
          cursorInjected = true;
          throw new Error("EIO: injected capture cursor failure");
        }
        await writeState(state);
      };
      const appendEventOnce = runner.store.appendEventOnce.bind(runner.store);
      let refusalEventInjected = false;
      runner.store.appendEventOnce = async (runId, type, data) => {
        if (
          !refusalEventInjected &&
          type === "completion.publication_refused"
        ) {
          refusalEventInjected = true;
          if (timing === "after") await appendEventOnce(runId, type, data);
          throw new Error(
            `EIO: injected ${timing} publication-refusal event failure`
          );
        }
        return await appendEventOnce(runId, type, data);
      };

      await runner.start({ slug: "example", request: "Implement it." });
      const blocked = await runner.approvePlan("human");
      assert.equal(cursorInjected, true);
      assert.equal(refusalEventInjected, true);
      assert.equal(blocked.status, "blocked");
      const attempt = blocked.activeAttempt;
      assert.ok(attempt?.kind === "implementation");
      assert.equal(
        (await runner.store.readRunAttempt(blocked.runId, attempt)).status,
        "pending_application"
      );
      assert.equal(
        await completionEventCount(runner, blocked.runId, "attempt.failed"),
        0
      );

      const promptsBefore = adapters.phasePrompts.length;
      const resumedRunner = new WorkflowRunner(repository.root, adapters);
      const done = await resumedRunner.resume();
      assert.equal(done.status, "done", done.blockReason ?? "");
      assert.equal(adapters.phasePrompts.length, promptsBefore);
      assert.equal(
        done.metrics.completedAttemptIds.filter((id) => id === attempt.id)
          .length,
        1
      );
      assert.equal(
        await completionEventCount(resumedRunner, done.runId, "attempt.failed"),
        0
      );
      assert.equal(
        await completionEventCount(
          resumedRunner,
          done.runId,
          "completion.publication_refused"
        ),
        1
      );
      assert.equal(
        await completionEventCount(
          resumedRunner,
          done.runId,
          "completion.publication_applied"
        ),
        1
      );
    } finally {
      await repository.dispose();
    }
  });

for (const boundary of ["capture", "receipt"] as const)
  test(`a delayed ${boundary} retry preserves the deterministic completion identity`, async () => {
    const repository = await createTestRepository();
    try {
      const adapters = new FakeAdapters();
      adapters.reviewResults.push(passingReview());
      const runner = new WorkflowRunner(repository.root, adapters);
      let firstDigest: string | null = null;
      let firstTimestamp: string | null = null;
      if (boundary === "capture") {
        const writeCapture = runner.store.writeCompletionCapture.bind(
          runner.store
        );
        runner.store.writeCompletionCapture = async (runId, capture) => {
          if (firstDigest === null) {
            firstDigest = capture.integrityDigest;
            firstTimestamp = capture.capturedAt;
            throw new Error("EIO: injected capture manifest failure");
          }
          await writeCapture(runId, capture);
        };
      } else {
        const writePublication = runner.store.writeCompletionPublication.bind(
          runner.store
        );
        runner.store.writeCompletionPublication = async (runId, receipt) => {
          if (firstDigest === null) {
            firstDigest = receipt.integrityDigest;
            firstTimestamp = receipt.publishedAt;
            throw new Error("EIO: injected receipt failure");
          }
          await writePublication(runId, receipt);
        };
      }

      await runner.start({ slug: "example", request: "Implement it." });
      const blocked = await runner.approvePlan("human");
      assert.equal(blocked.status, "blocked");
      assert.equal(
        blocked.completionPublication?.refusal?.code,
        "COMPLETION_PUBLICATION_IO"
      );
      const attempt = blocked.activeAttempt;
      assert.ok(attempt?.kind === "implementation");
      assert.ok(firstDigest);
      assert.ok(firstTimestamp);

      await new Promise((resolve) => setTimeout(resolve, 5));
      const promptsBefore = adapters.phasePrompts.length;
      const resumedRunner = new WorkflowRunner(repository.root, adapters);
      const done = await resumedRunner.resume();
      assert.equal(done.status, "done", done.blockReason ?? "");
      assert.equal(adapters.phasePrompts.length, promptsBefore);
      if (boundary === "capture") {
        const capture = await resumedRunner.store.readCompletionCaptureIfExists(
          done.runId,
          attempt
        );
        assert.ok(capture);
        assert.equal(capture.integrityDigest, firstDigest);
        assert.equal(capture.capturedAt, firstTimestamp);
      } else {
        const receipt =
          await resumedRunner.store.readCompletionPublicationIfExists(
            done.runId,
            attempt
          );
        assert.ok(receipt);
        assert.equal(receipt.integrityDigest, firstDigest);
        assert.equal(receipt.publishedAt, firstTimestamp);
      }
    } finally {
      await repository.dispose();
    }
  });

for (const boundary of [
  "attempt",
  "state",
  "publication-event",
  "event-cursor"
] as const)
  test(`a restart after the durable completion ${boundary} reconciles state and events exactly once`, async () => {
    const repository = await createTestRepository();
    try {
      const adapters = new FakeAdapters();
      adapters.reviewResults.push(passingReview());
      const runner = new WorkflowRunner(repository.root, adapters);
      let interrupted = false;
      if (boundary === "attempt") {
        const writeAttempt = runner.store.writeRunAttempt.bind(runner.store);
        runner.store.writeRunAttempt = async (runId, record) => {
          await writeAttempt(runId, record);
          if (
            !interrupted &&
            record.attempt.kind === "implementation" &&
            record.status === "completed"
          ) {
            interrupted = true;
            throw new TerminalRunStateError(
              await runner.store.readState(runId)
            );
          }
        };
      } else if (boundary === "state" || boundary === "event-cursor") {
        const writeState = runner.store.writeState.bind(runner.store);
        runner.store.writeState = async (state) => {
          await writeState(state);
          if (
            !interrupted &&
            state.activeAttempt?.kind === "implementation" &&
            state.completionPublication?.stage ===
              (boundary === "state" ? "state" : "event")
          ) {
            interrupted = true;
            throw new TerminalRunStateError(state);
          }
        };
      } else {
        const appendEventOnce = runner.store.appendEventOnce.bind(runner.store);
        runner.store.appendEventOnce = async (runId, type, data) => {
          const event = await appendEventOnce(runId, type, data);
          if (!interrupted && type === "completion.publication_applied") {
            interrupted = true;
            throw new TerminalRunStateError(
              await runner.store.readState(runId)
            );
          }
          return event;
        };
      }

      await runner.start({ slug: "example", request: "Implement it." });
      await runner.approvePlan("human");
      assert.equal(interrupted, true);
      const interruptedState = await runner.store.requireActiveState();
      assert.ok(interruptedState.activeAttempt?.kind === "implementation");
      const attempt = interruptedState.activeAttempt;
      assert.equal(
        (await runner.store.readRunAttempt(interruptedState.runId, attempt))
          .status,
        "completed"
      );
      assert.ok(
        await runner.store.readCompletionPublicationIfExists(
          interruptedState.runId,
          attempt
        )
      );

      const promptsBefore = adapters.phasePrompts.length;
      const resumedRunner = new WorkflowRunner(repository.root, adapters);
      const done = await resumedRunner.resume();
      assert.equal(
        done.status,
        "done",
        `${boundary}: ${done.blockReason ?? ""}`
      );
      assert.equal(adapters.phasePrompts.length, promptsBefore);
      assert.equal(
        done.metrics.completedAttemptIds.filter((id) => id === attempt.id)
          .length,
        1
      );
      assert.equal(done.metrics.attempts.implementation, 1);
      assert.equal(done.metrics.attempts.verification, 1);
      assert.equal(
        await completionEventCount(
          resumedRunner,
          done.runId,
          "completion.publication_applied"
        ),
        1
      );
      const repeated = await resumedRunner.resume();
      assert.equal(repeated.status, "done");
      assert.equal(
        await completionEventCount(
          resumedRunner,
          done.runId,
          "completion.publication_applied"
        ),
        1
      );
    } finally {
      await repository.dispose();
    }
  });

test("a restart after the refreshed-fix event preserves both application events exactly once", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new FakeAdapters();
    adapters.reviewResults.push(
      {
        contractVersion: CONTRACT_VERSION,
        verdict: "changes_requested",
        summary: "One finding requires a fix.",
        findings: [finding("R1-F1", "Fix the fixture.")],
        reviewedFindingIds: [],
        deferredCoverage: []
      },
      passingReview(["R1-F1"])
    );
    adapters.fixResults.push(
      phaseResult("fix", {
        taskCompletion: completionLedger(["T001"]),
        resolvedFindingIds: ["R1-F1"]
      })
    );
    const runner = new WorkflowRunner(repository.root, adapters);
    await runner.start({ slug: "example", request: "Implement it." });
    const triage = await runner.approvePlan("human");
    assert.equal(triage.status, "needs_triage");

    const appendEventOnce = runner.store.appendEventOnce.bind(runner.store);
    let interrupted = false;
    runner.store.appendEventOnce = async (runId, type, data) => {
      const event = await appendEventOnce(runId, type, data);
      if (!interrupted && type === "plan_task_completion.refreshed") {
        interrupted = true;
        throw new TerminalRunStateError(await runner.store.readState(runId));
      }
      return event;
    };
    await runner.triage({
      accepted: ["R1-F1"],
      rejected: [],
      deferred: [],
      note: null,
      decidedBy: "human"
    });
    assert.equal(interrupted, true);
    const interruptedState = await runner.store.requireActiveState();
    assert.ok(interruptedState.activeAttempt?.kind === "fix");
    const attempt = interruptedState.activeAttempt;
    assert.equal(
      (await runner.store.readRunAttempt(interruptedState.runId, attempt))
        .status,
      "completed"
    );

    const promptsBefore = adapters.phasePrompts.length;
    const resumedRunner = new WorkflowRunner(repository.root, adapters);
    const done = await resumedRunner.resume();
    assert.equal(done.status, "done", done.blockReason ?? "");
    assert.equal(adapters.phasePrompts.length, promptsBefore);
    assert.equal(
      done.metrics.completedAttemptIds.filter((id) => id === attempt.id).length,
      1
    );
    assert.equal(
      await completionEventCount(
        resumedRunner,
        done.runId,
        "completion.publication_applied"
      ),
      2,
      "implementation and fix each publish exactly once"
    );
    assert.equal(
      await completionEventCount(
        resumedRunner,
        done.runId,
        "plan_task_completion.refreshed"
      ),
      1
    );
  } finally {
    await repository.dispose();
  }
});

test("a candidate write failure leaves the proven attempt pending and resume publishes without another model call", async () => {
  const repository = await createTestRepository();
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
    assert.equal(blocked.status, "blocked");
    assert.equal(blocked.blockedFrom, "implementing");
    assert.match(blocked.blockReason ?? "", /^\[COMPLETION_PUBLICATION_IO\]/);
    assert.match(blocked.blockReason ?? "", /stage candidate/);
    assert.doesNotMatch(blocked.blockReason ?? "", /ENOSPC/);
    const attempt = blocked.activeAttempt;
    assert.ok(attempt?.kind === "implementation");
    assert.equal(
      (await runner.store.readRunAttempt(blocked.runId, attempt)).status,
      "pending_application"
    );
    assert.equal(blocked.planTaskCompletion, null);
    assert.equal(
      blocked.completionPublication?.refusal?.code,
      "COMPLETION_PUBLICATION_IO"
    );
    assert.equal(blocked.completionPublication.stage, "candidate");
    const status = await runner.status();
    assert.deepEqual(status.completionPublication, {
      attemptId: attempt.id,
      attemptKind: "implementation",
      stage: "candidate",
      refusal: "COMPLETION_PUBLICATION_IO",
      pending: true,
      action: "resume"
    });
    assert.equal(status.retry.eligible, false);
    assert.equal(status.recovery.eligible, false);
    assert.equal(status.nextAction, "banzai resume");
    const control = projectAgentControlStatus(status).activeRun;
    assert.ok(control);
    assert.equal(control.nextAction, "resume");
    assert.deepEqual(control.completionPublication, {
      attemptId: attempt.id,
      attemptKind: "implementation",
      stage: "candidate",
      refusalCode: "COMPLETION_PUBLICATION_IO",
      publisherAttemptId: null
    });
    assert.equal(
      await completionEventCount(
        runner,
        blocked.runId,
        "completion.publication_refused"
      ),
      1
    );

    const promptsBefore = adapters.phasePrompts.length;
    const done = await runner.resume();
    assert.equal(done.status, "done", done.blockReason ?? "");
    assert.equal(adapters.phasePrompts.length, promptsBefore);
    assert.equal(done.metrics.attempts.implementation, 1);
    assert.equal(
      done.metrics.completedAttemptIds.filter((id) => id === attempt.id).length,
      1
    );
    assert.equal(
      await completionEventCount(
        runner,
        done.runId,
        "completion.publication_applied"
      ),
      1
    );
    assert.equal(
      await completionEventCount(
        runner,
        done.runId,
        "completion.publication_refused"
      ),
      1
    );
    assert.equal(
      (await runner.store.readRunAttempt(done.runId, attempt)).status,
      "completed"
    );
    assert.equal(done.planTaskCompletion?.status, "valid");
    assert.equal(done.completionPublication?.refusal, null);
  } finally {
    await repository.dispose();
  }
});

test("a receipt write failure after report replacement reconciles the proven bytes once and drift must be restored before resume", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new FakeAdapters();
    adapters.reviewResults.push(passingReview());
    const runner = new WorkflowRunner(repository.root, adapters);
    const writeReceipt = runner.store.writeCompletionPublication.bind(
      runner.store
    );
    let injected = 0;
    runner.store.writeCompletionPublication = async (runId, receipt) => {
      if (injected === 0) {
        injected += 1;
        throw new Error("EIO: injected receipt write failure");
      }
      await writeReceipt(runId, receipt);
    };
    await runner.start({ slug: "example", request: "Implement it." });
    const blocked = await runner.approvePlan("human");
    assert.equal(blocked.status, "blocked");
    assert.match(blocked.blockReason ?? "", /^\[COMPLETION_PUBLICATION_IO\]/);
    assert.match(blocked.blockReason ?? "", /stage receipt/);
    const attempt = blocked.activeAttempt;
    assert.ok(attempt?.kind === "implementation");
    const reportPath = await boundFixturePath(
      repository.root,
      "documentation/features/example/implementation-report.md"
    );
    const published = await readFile(reportPath);
    const candidate = await runner.store.readCompletionCandidateIfExists(
      blocked.runId,
      attempt
    );
    assert.ok(candidate);
    assert.ok(
      published.equals(candidate.bytes),
      "the destination already holds the exact candidate bytes"
    );
    assert.equal(
      (await runner.status()).completionPublication?.action,
      "resume"
    );

    // Drift: a later edit of the destination is never adopted as the output;
    // the deterministic resume detects it and switches to the drift route.
    await writeFile(
      reportPath,
      Buffer.concat([published, Buffer.from("\nLater edit.\n")])
    );
    const drifted = await runner.resume();
    assert.equal(drifted.status, "blocked");
    assert.match(
      drifted.blockReason ?? "",
      /^\[COMPLETION_PUBLICATION_DRIFT\]/
    );
    assert.equal(
      (await runner.store.readRunAttempt(drifted.runId, attempt)).status,
      "pending_application"
    );
    const driftedStatus = await runner.status();
    assert.equal(
      driftedStatus.completionPublication?.refusal,
      "COMPLETION_PUBLICATION_DRIFT"
    );
    assert.equal(driftedStatus.completionPublication.action, "cancel");
    assert.equal(driftedStatus.nextAction, "banzai cancel");
    assert.equal(
      projectAgentControlStatus(driftedStatus).activeRun?.nextAction,
      "cancel"
    );

    // Restoring the exact proven output re-enables the deterministic resume.
    await writeFile(reportPath, candidate.bytes);
    assert.equal(
      (await runner.status()).completionPublication?.action,
      "resume"
    );
    const promptsBefore = adapters.phasePrompts.length;
    const done = await runner.resume();
    assert.equal(done.status, "done", done.blockReason ?? "");
    assert.equal(adapters.phasePrompts.length, promptsBefore);
    assert.ok((await readFile(reportPath)).equals(candidate.bytes));
    assert.equal(
      await completionEventCount(
        runner,
        done.runId,
        "completion.publication_applied"
      ),
      1
    );
    assert.equal(
      done.metrics.completedAttemptIds.filter((id) => id === attempt.id).length,
      1
    );
    const receipt = await runner.store.readCompletionPublicationIfExists(
      done.runId,
      attempt
    );
    assert.ok(receipt);
    assert.equal(receipt.candidateDigest, candidate.candidate.integrityDigest);
    assert.equal(
      receipt.implementationReport.sha256,
      candidate.candidate.outputSha256
    );
  } finally {
    await repository.dispose();
  }
});

test("a receipt whose retained candidate is missing is a publication integrity refusal whose only exit is cancel", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new FakeAdapters();
    adapters.reviewResults.push(passingReview());
    const runner = new WorkflowRunner(repository.root, adapters);
    const writeAttempt = runner.store.writeRunAttempt.bind(runner.store);
    let injected = 0;
    runner.store.writeRunAttempt = async (runId, record) => {
      if (
        injected === 0 &&
        record.attempt.kind === "implementation" &&
        record.status === "completed"
      ) {
        injected += 1;
        throw new Error("EIO: injected attempt write failure");
      }
      await writeAttempt(runId, record);
    };
    await runner.start({ slug: "example", request: "Implement it." });
    const blocked = await runner.approvePlan("human");
    assert.equal(blocked.status, "blocked");
    assert.match(blocked.blockReason ?? "", /^\[COMPLETION_PUBLICATION_IO\]/);
    assert.match(blocked.blockReason ?? "", /stage attempt/);
    const attempt = blocked.activeAttempt;
    assert.ok(attempt?.kind === "implementation");
    assert.ok(
      await runner.store.readCompletionPublicationIfExists(
        blocked.runId,
        attempt
      )
    );
    await rm(
      runner.store.completionEvidencePath(
        blocked.runId,
        attempt,
        "completion-candidate.json"
      )
    );
    const promptsBefore = adapters.phasePrompts.length;
    const corrupt = await runner.resume();
    assert.equal(corrupt.status, "blocked");
    assert.match(
      corrupt.blockReason ?? "",
      /^\[COMPLETION_PUBLICATION_INTEGRITY\]/
    );
    assert.equal(adapters.phasePrompts.length, promptsBefore);
    assert.equal(
      (await runner.store.readRunAttempt(corrupt.runId, attempt)).status,
      "pending_application"
    );
    assert.equal(corrupt.planTaskCompletion, null);
    const status = await runner.status();
    assert.equal(
      status.completionPublication?.refusal,
      "COMPLETION_PUBLICATION_INTEGRITY"
    );
    assert.equal(status.completionPublication.action, "cancel");
    assert.equal(status.nextAction, "banzai cancel");
    assert.equal(status.retry.eligible, false);
    assert.equal(status.recovery.eligible, false);
    assert.equal(
      projectAgentControlStatus(status).activeRun?.nextAction,
      "cancel"
    );
    assert.equal(
      await completionEventCount(
        runner,
        corrupt.runId,
        "completion.publication_applied"
      ),
      0
    );
    const cancelled = await runner.cancel();
    assert.equal(cancelled.outcome, "cancelled");
    assert.equal(
      (await runner.store.readState(corrupt.runId)).status,
      "cancelled"
    );
    assert.equal(
      (await runner.store.readRunAttempt(corrupt.runId, attempt)).status,
      "pending_application",
      "cancellation never promotes or rewrites the pending proof"
    );
  } finally {
    await repository.dispose();
  }
});

for (const tamper of ["receipt", "report"] as const)
  test(`a published completion ${tamper} edited before the review pass is rejected read-only with a repair route`, async () => {
    const repository = await createTestRepository();
    try {
      const adapters = new FakeAdapters();
      adapters.reviewResults.push(passingReview());
      const runner = new WorkflowRunner(repository.root, adapters);
      // Tamper between publication and the verification boundary, after the
      // runner persisted its applied completion.
      const writeState = runner.store.writeState.bind(runner.store);
      let tampered = false;
      runner.store.writeState = async (state) => {
        await writeState(state);
        if (tampered || state.status !== "verifying") return;
        tampered = true;
        const completion = state.planTaskCompletion;
        assert.ok(
          completion?.status === "valid" &&
            completion.schemaVersion === 2 &&
            completion.publication
        );
        if (tamper === "receipt") {
          const receiptPath = path.join(
            runner.store.runDirectory(state.runId),
            completion.publication.path
          );
          const receipt = JSON.parse(await readFile(receiptPath, "utf8")) as {
            implementationReport: { sha256: string };
          };
          receipt.implementationReport.sha256 = "0".repeat(64);
          await writeFile(receiptPath, JSON.stringify(receipt), "utf8");
        } else {
          const reportPath = path.join(
            repository.root,
            completion.implementationReport.path
          );
          await writeFile(
            reportPath,
            `${await readFile(reportPath, "utf8")}\nEdited after publication.\n`,
            "utf8"
          );
        }
      };
      await runner.start({ slug: "example", request: "Implement it." });
      const blocked = await runner.approvePlan("human");
      assert.equal(tampered, true);
      assert.equal(blocked.status, "blocked");
      assert.equal(blocked.blockedFrom, "verifying");
      assert.equal(adapters.reviewPrompts.length, 0);
      assert.match(blocked.blockReason ?? "", /PLAN_TASK_COMPLETION_INVALID/);
      assert.equal(blocked.planTaskCompletion?.status, "invalid");
      assert.equal(blocked.planTaskCompletion.violation, "summary_mismatch");
      assert.equal(
        await completionEventCount(
          runner,
          blocked.runId,
          "completion.publication_applied"
        ),
        1
      );
      const status = await runner.status();
      assert.equal(status.retry.eligible, true);
      assert.match(
        status.retry.reason,
        /repaired with a new implementation attempt/
      );
    } finally {
      await repository.dispose();
    }
  });

test("a blocked implementation whose gap targets the runner-owned section keeps its stop with an invalid-gap diagnostic", async () => {
  const repository = await createTestRepository();
  try {
    const adapters = new FakeAdapters();
    adapters.implementationResults.push(
      phaseResult("implementation", {
        outcome: "blocked",
        gate: null,
        summary: "Blocked on an operator prerequisite.",
        questions: ["Provision the fixture credential."],
        taskCompletion: {
          schemaVersion: PLAN_TASK_COMPLETION_SCHEMA_VERSION,
          tasks: [
            {
              taskId: "T001",
              status: "blocked",
              evidence: [],
              gap: {
                reportPath:
                  "documentation/features/example/implementation-report.md",
                section: "Plan Task Completion",
                detail: "Blocked until the credential exists."
              }
            }
          ]
        }
      })
    );
    const runner = new WorkflowRunner(repository.root, adapters);
    await runner.start({ slug: "example", request: "Implement it." });
    const blocked = await runner.approvePlan("human");
    assert.equal(blocked.status, "blocked");
    assert.equal(blocked.blockedFrom, "implementing");
    assert.equal(blocked.planTaskCompletion, null);
    assert.equal(blocked.metrics.attempts.verification, 0);
    assert.equal(adapters.reviewPrompts.length, 0);
    const record = (await runner.store.readRunAttempts(blocked.runId)).find(
      (item) => item.attempt.kind === "implementation"
    );
    assert.ok(record);
    assert.equal(record.status, "completed");
    assert.equal(
      record.completionDiagnostic?.violation,
      "invalid_gap_reference"
    );
    assert.equal(record.completionDiagnostic.taskId, "T001");
    assert.equal(
      await runner.store.readCompletionPublicationIfExists(
        blocked.runId,
        record.attempt
      ),
      null
    );
    assert.equal(
      await runner.store.readCompletionCandidateIfExists(
        blocked.runId,
        record.attempt
      ),
      null
    );
    const capture = await runner.store.readCompletionCaptureIfExists(
      blocked.runId,
      record.attempt
    );
    assert.equal(capture?.outcome, "stop");
    assert.equal(
      await completionEventCount(
        runner,
        blocked.runId,
        "completion.publication_applied"
      ),
      0
    );
    assert.ok(
      (
        await readFile(
          await boundFixturePath(
            repository.root,
            "documentation/features/example/implementation-report.md"
          ),
          "utf8"
        )
      ).includes("banzai-plan-task-completion/v1"),
      "a stop never rewrites the model's report"
    );
  } finally {
    await repository.dispose();
  }
});

test("a completed claim with an incomplete task is rejected before any publication and repaired by one linked successor", async () => {
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
              status: "incomplete",
              evidence: [],
              gap: {
                reportPath:
                  "documentation/features/example/implementation-report.md",
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
    assert.equal(blocked.status, "blocked");
    assert.equal(blocked.blockedFrom, "implementing");
    assert.match(
      blocked.blockReason ?? "",
      /^\[PLAN_TASK_COMPLETION_INVALID\]/
    );
    const failed = blocked.activeAttempt;
    assert.ok(failed?.kind === "implementation");
    const record = await runner.store.readRunAttempt(blocked.runId, failed);
    assert.equal(record.status, "failed");
    assert.equal(record.failureCode, "PLAN_TASK_COMPLETION_INVALID");
    assert.equal(blocked.planTaskCompletion?.status, "invalid");
    assert.equal(
      await runner.store.readCompletionCandidateIfExists(blocked.runId, failed),
      null
    );
    assert.equal(
      await runner.store.readCompletionPublicationIfExists(
        blocked.runId,
        failed
      ),
      null
    );
    assert.equal(
      await completionEventCount(
        runner,
        blocked.runId,
        "completion.input_rejected"
      ),
      1
    );
    const status = await runner.status();
    assert.equal(status.nextAction, "banzai retry");
    const done = await runner.retry();
    assert.equal(done.status, "done", done.blockReason ?? "");
    const completion = done.planTaskCompletion;
    assert.ok(completion?.status === "valid");
    assert.notEqual(completion.sourceAttemptId, failed.id);
    assert.match(
      completion.sourceAttemptId,
      /^implementation-repair-[0-9a-f]{12}$/
    );
    const successor = await runner.store.readRunAttempt(done.runId, {
      id: completion.sourceAttemptId,
      kind: "implementation",
      mutable: true
    });
    assert.equal(successor.retryOf, failed.id);
    assert.equal(
      (await runner.store.readRunAttempt(done.runId, failed)).status,
      "failed",
      "the rejected source is retained unchanged"
    );
  } finally {
    await repository.dispose();
  }
});

test("archive closure carries the runner-owned completion proof and fails when the receipt is missing", async () => {
  const repository = await createTestRepository({ artifactLayout: "private" });
  try {
    const root = await realpath(repository.root);
    const adapters = new FakeAdapters();
    adapters.reviewResults.push(passingReview());
    const runner = new WorkflowRunner(repository.root, adapters);
    await runner.start({ slug: "example", request: "Implement it." });
    const done = await runner.approvePlan("human");
    assert.equal(done.status, "done", done.blockReason ?? "");
    assert.ok(done.artifactBinding);
    const workPath = `.banzai/work/${done.artifactBinding.binding.workId}`;
    const completion = done.planTaskCompletion;
    assert.ok(completion?.status === "valid" && completion.publication);
    const invoke = async (
      operation: string,
      fields: Record<string, unknown>
    ) => {
      const requestFile = path.join(root, "archive-request.json");
      await writeFile(
        requestFile,
        JSON.stringify({
          schema: "banzai-artifact-request/v1",
          schemaVersion: 1,
          repoRoot: root,
          ...fields
        })
      );
      const child = spawnSync(
        process.execPath,
        [artifactsCommandPath, operation, "--json", requestFile],
        { encoding: "utf8" }
      );
      return JSON.parse(child.stdout) as {
        ok: boolean;
        result?: unknown;
        error?: { code: string; message: string };
      };
    };
    const archive = async (destination: string) => {
      const inventoried = await invoke("inventory", {
        workPaths: [workPath],
        runIds: [done.runId]
      });
      if (!inventoried.ok) return inventoried;
      const inventoryFile = path.join(root, "reviewed-inventory.json");
      await writeFile(
        inventoryFile,
        JSON.stringify((inventoried.result as { inventory: unknown }).inventory)
      );
      return await invoke("export", { inventoryFile, destination });
    };
    const first = path.join(root, "archive-one");
    const exported = await archive(first);
    assert.equal(exported.ok, true, JSON.stringify(exported.error));
    const verified = await invoke("verify", { bundlePath: first });
    assert.equal(verified.ok, true, JSON.stringify(verified.error));
    const manifest = JSON.parse(
      await readFile(path.join(first, "manifest.json"), "utf8")
    ) as { entries: { path: string }[] };
    const receiptPath = `.banzai/runs/${done.runId}/${completion.publication.path}`;
    assert.ok(manifest.entries.some((entry) => entry.path === receiptPath));
    for (const leaf of [
      "completion-input.json",
      "completion-candidate.json",
      "completion-candidate.md",
      "implementation-input.md"
    ])
      assert.ok(
        manifest.entries.some((entry) => entry.path.endsWith(`.${leaf}`)),
        leaf
      );

    // Removing the receipt breaks completion closure even for a partial archive.
    await rm(path.join(root, receiptPath));
    const broken = await archive(path.join(root, "archive-two"));
    assert.equal(broken.ok, false);
    assert.equal(broken.error?.code, "ARTIFACT_EVIDENCE_INCOMPLETE");
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

function failingOnceVerification(): ProcessRunner {
  let executions = 0;
  return async () => {
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
}

async function blockedByFailedCheck(root: string) {
  const adapters = new FakeAdapters();
  adapters.fixtureTaskChecks = true;
  adapters.selectionResults.push(
    selectionResult({ recommendedWorkflow: "feature" })
  );
  const runner = new WorkflowRunner(root, adapters, failingOnceVerification());
  const blocked = await runner.start({
    slug: "verification-retry",
    request: "Exercise explicit verification retry evidence."
  });
  assert.equal(blocked.status, "blocked");
  assert.equal(blocked.blockedFrom, "verifying");
  return { runner, blocked };
}

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

/*
 * Eligibility baseline (ADR-0052 stage 2 differential evidence). Each scenario
 * persists one run condition through the existing harness and records the
 * complete observable decision: the status projection's retry, recovery and
 * next action, or restore eligibility, plus the state persisted afterwards so
 * eligibility-time effects stay visible. Expected values come from the
 * baseline source and must not change when the rules move.
 */
type PrerequisiteFixture = Awaited<
  ReturnType<typeof prerequisiteBlockedFixFixture>
>;

interface EligibilityArrangement {
  root: string;
  runner: WorkflowRunner;
  runId: string;
  dispose: () => Promise<void>;
}

async function rewriteActiveAttempt(
  runner: WorkflowRunner,
  runId: string,
  mutate: (record: AttemptRecord) => void
): Promise<AttemptReference> {
  const state = await runner.store.readState(runId);
  const attempt = requiredFixture(state.activeAttempt);
  const record = await runner.store.readRunAttempt(runId, attempt);
  mutate(record);
  await runner.store.writeRunAttempt(runId, record);
  return attempt;
}

async function inRepository(
  arrange: (root: string) => Promise<{ runner: WorkflowRunner; runId: string }>
): Promise<EligibilityArrangement> {
  const repository = await createTestRepository();
  try {
    const { runner, runId } = await arrange(repository.root);
    return {
      root: repository.root,
      runner,
      runId,
      dispose: () => repository.dispose()
    };
  } catch (error) {
    await repository.dispose();
    throw error;
  }
}

async function strictAwaitingApproval(root: string) {
  const adapters = new FakeAdapters();
  adapters.reviewResults.push(passingReview());
  const runner = new WorkflowRunner(root, adapters);
  const state = await runner.start({
    slug: "example",
    request: "Implement it."
  });
  return { runner, runId: state.runId };
}

async function strictApproved(root: string) {
  const arranged = await strictAwaitingApproval(root);
  await arranged.runner.approvePlan("human", false);
  return arranged;
}

async function failedStrictImplementation(
  root: string,
  configure: (adapters: FakeAdapters) => void = (adapters) =>
    adapters.implementationErrors.push(new Error("implementation interrupted"))
) {
  const adapters = new FakeAdapters();
  configure(adapters);
  adapters.reviewResults.push(passingReview());
  const runner = new WorkflowRunner(root, adapters);
  await runner.start({ slug: "example", request: "Implement it." });
  const blocked = await runner.approvePlan("human");
  assert.equal(blocked.status, "blocked", "fixture must block");
  return { runner, runId: blocked.runId };
}

async function authorizeRecovery(runner: WorkflowRunner): Promise<void> {
  const status = await runner.status();
  assert.equal(status.recovery.eligible, true, status.recovery.reason);
  await runner.recover(
    {
      attemptId: requiredFixture(status.recovery.attemptId),
      recoveryIdentity: requiredFixture(status.recovery.recoveryIdentity),
      unknownSideEffectsAccepted: true,
      decidedBy: "current-human"
    },
    false
  );
}

async function failedFix(root: string) {
  const adapters = new FakeAdapters();
  adapters.reviewResults.push(
    {
      contractVersion: CONTRACT_VERSION,
      verdict: "changes_requested",
      summary: "One finding.",
      findings: [finding("R1-F1", "Accepted defect.")],
      reviewedFindingIds: [],
      deferredCoverage: []
    },
    passingReview(["R1-F1"])
  );
  adapters.fixErrors.push(new Error("fix interrupted"));
  const runner = new WorkflowRunner(root, adapters);
  await runner.start({ slug: "example", request: "Implement it." });
  await runner.approvePlan("human");
  const blocked = await runner.triage({
    accepted: ["R1-F1"],
    rejected: [],
    deferred: [],
    note: null,
    decidedBy: "human"
  });
  assert.equal(blocked.status, "blocked", "fixture must block");
  return { runner, runId: blocked.runId };
}

async function failedSelection(root: string) {
  const adapters = new FakeAdapters();
  adapters.selectionErrors.push(new Error("selection failed"));
  const runner = new WorkflowRunner(root, adapters);
  const blocked = await runner.start({
    slug: "example",
    request: "Implement it."
  });
  assert.equal(blocked.status, "blocked", "fixture must block");
  return { runner, runId: blocked.runId };
}

async function failedPlanning(root: string) {
  const adapters = new FakeAdapters();
  adapters.planErrors.push(new Error("planning failed"));
  const runner = new WorkflowRunner(root, adapters);
  const blocked = await runner.start({
    slug: "example",
    request: "Implement it."
  });
  assert.equal(blocked.status, "blocked", "fixture must block");
  return { runner, runId: blocked.runId };
}

async function liteDone(root: string) {
  const adapters = new FakeAdapters();
  adapters.fixtureTaskChecks = true;
  adapters.selectionResults.push(
    selectionResult({ recommendedWorkflow: "feature" })
  );
  const runner = new WorkflowRunner(root, adapters, async () => ({
    exitCode: 0,
    signal: null,
    stdout: "",
    stderr: "",
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString()
  }));
  const done = await runner.start({
    slug: "verification-done",
    request: "Exercise task verification."
  });
  assert.equal(done.status, "done", done.blockReason ?? "");
  return { runner, runId: done.runId };
}

async function failedLiteImplementation(root: string) {
  const adapters = new FakeAdapters();
  adapters.selectionResults.push(
    selectionResult({ recommendedWorkflow: "feature" })
  );
  adapters.implementationErrors.push(new Error("implementation interrupted"));
  const runner = new WorkflowRunner(root, adapters);
  const blocked = await runner.start({
    slug: "lite-recovery",
    request: "Implement it."
  });
  assert.equal(blocked.status, "blocked", "fixture must block");
  return { runner, runId: blocked.runId };
}

const markStarted = (record: AttemptRecord) => {
  record.status = "started";
  record.completedAt = null;
  record.durationMs = null;
  record.error = null;
  record.failureCode = null;
};

const APPROVAL_CHANGED_REASON =
  "Approved planning artifacts changed. Restore the approved bundle (banzai restore) and retry, or cancel the run and approve a revised plan in a new run.";

async function changeApprovedPlan(root: string): Promise<void> {
  const planFile = await boundFixturePath(root, planPath);
  await writeFile(
    planFile,
    `${await readFile(planFile, "utf8")}\nExternal edit from another session.\n`,
    "utf8"
  );
}

async function commitUnrelatedChange(root: string): Promise<void> {
  await writeFile(path.join(root, "unrelated.txt"), "moved HEAD\n", "utf8");
  await commitAll(root, "move HEAD");
}

function invalidCompletion(
  sourceAttemptId: string,
  violation: PlanTaskCompletionViolation
): NonNullable<RunState["planTaskCompletion"]> {
  return {
    schemaVersion: PLAN_TASK_COMPLETION_SCHEMA_VERSION,
    status: "invalid",
    sourceAttemptId,
    errorCode: "PLAN_TASK_COMPLETION_INVALID",
    violation,
    taskId: null,
    recordedAt: "2026-07-01T00:00:00.000Z"
  };
}

const ELIGIBILITY_SCENARIOS: {
  name: string;
  observe?: "status" | "restore";
  arrange: () => Promise<EligibilityArrangement>;
}[] = [
  {
    name: "awaiting plan approval",
    arrange: () => inRepository(strictAwaitingApproval)
  },
  {
    name: "awaiting triage",
    arrange: () =>
      inRepository(async (root) => {
        const adapters = new FakeAdapters();
        adapters.reviewResults.push({
          contractVersion: CONTRACT_VERSION,
          verdict: "changes_requested",
          summary: "One finding.",
          findings: [finding("R1-F1", "Accepted defect.")],
          reviewedFindingIds: [],
          deferredCoverage: []
        });
        const runner = new WorkflowRunner(root, adapters);
        await runner.start({ slug: "example", request: "Implement it." });
        const state = await runner.approvePlan("human");
        assert.equal(state.status, "needs_triage");
        return { runner, runId: state.runId };
      })
  },
  ...(["needs_adr_approval", "implementing", "cancelled"] as const).map(
    (status) => ({
      name: `persisted status ${status}`,
      arrange: () =>
        inRepository(async (root) => {
          const arranged = await strictAwaitingApproval(root);
          await rewriteRunState(
            arranged.runner.store,
            arranged.runId,
            (state) => {
              state.status = status;
            }
          );
          return arranged;
        })
    })
  ),
  {
    name: "planning escalation awaiting a human decision",
    arrange: () =>
      inRepository(async (root) => {
        const adapters = new FakeAdapters();
        adapters.planResults.push(
          phaseResult("plan", {
            outcome: "needs_human_decision",
            gate: "escalation",
            summary: "A product decision is required.",
            questions: ["Should the feature support the legacy behavior?"]
          })
        );
        const runner = new WorkflowRunner(root, adapters);
        const gated = await runner.start({
          slug: "example",
          request: "Plan the product change."
        });
        assert.equal(gated.status, "needs_human_decision");
        return { runner, runId: gated.runId };
      })
  },
  { name: "completed lite run", arrange: () => inRepository(liteDone) },
  ...(
    [
      ["created", null],
      ["reviewing", null],
      ["planning", null],
      ["plan_approved", APPROVAL_CHANGED_REASON],
      ["implementing", APPROVAL_CHANGED_REASON],
      ["fixing", APPROVAL_CHANGED_REASON]
    ] as const
  ).map(([blockedFrom, blockReason]) => ({
    name: `blocked from ${blockedFrom} without an attempt${blockReason === null ? "" : " after approval changed"}`,
    arrange: () =>
      inRepository(async (root) => {
        const arranged = await strictAwaitingApproval(root);
        await rewriteRunState(
          arranged.runner.store,
          arranged.runId,
          (state) => {
            state.status = "blocked";
            state.blockedFrom = blockedFrom;
            state.blockReason = blockReason ?? "Fixture block.";
            state.activeAttempt = null;
          }
        );
        return arranged;
      })
  })),
  {
    name: "blocked while a model process is active",
    arrange: () =>
      inRepository(async (root) => {
        const arranged = await strictAwaitingApproval(root);
        await rewriteRunState(
          arranged.runner.store,
          arranged.runId,
          (state) => {
            state.status = "blocked";
            state.blockedFrom = "created";
            state.blockReason = "Fixture block.";
            state.activeProcess = {
              pid: process.pid,
              kind: "implementation",
              startedAt: "2026-07-01T00:00:00.000Z"
            };
          }
        );
        return arranged;
      })
  },
  {
    name: "approved bundle changed before implementation",
    arrange: () =>
      inRepository(async (root) => {
        const arranged = await strictApproved(root);
        await changeApprovedPlan(root);
        await assert.rejects(arranged.runner.resume(), /banzai restore/);
        return arranged;
      })
  },
  {
    name: "failed task check",
    arrange: () =>
      inRepository(async (root) => {
        const { runner, blocked } = await blockedByFailedCheck(root);
        return { runner, runId: blocked.runId };
      })
  },
  {
    name: "failed task check with an unreadable implementation attempt record",
    arrange: () =>
      inRepository(async (root) => {
        const { runner, blocked } = await blockedByFailedCheck(root);
        const implementation = (
          await runner.store.readRunAttempts(blocked.runId)
        ).find((record) => record.attempt.kind === "implementation");
        await writeFile(
          runner.store.attemptPath(
            blocked.runId,
            requiredFixture(implementation).attempt
          ),
          "{",
          "utf8"
        );
        return { runner, runId: blocked.runId };
      })
  },
  {
    name: "blocked from verifying after every task check completed",
    arrange: () =>
      inRepository(async (root) => {
        const arranged = await liteDone(root);
        await rewriteRunState(
          arranged.runner.store,
          arranged.runId,
          (state) => {
            state.status = "blocked";
            state.blockedFrom = "verifying";
            state.blockReason = "Fixture verification block.";
          }
        );
        return arranged;
      })
  },
  {
    name: "blocked from verifying with an unresolved physical task check",
    arrange: () =>
      inRepository(async (root) => {
        const arranged = await liteDone(root);
        const state = await arranged.runner.store.readState(arranged.runId);
        const directory = path.join(
          root,
          requiredFixture(
            requiredFixture(state.artifactBinding).binding.artifacts
              .verificationDirectory
          )
        );
        const attempts = path.join(directory, "attempts");
        for (const name of (await readdir(attempts)).filter((entry) =>
          entry.endsWith(".finish.json")
        ))
          await rm(path.join(attempts, name));
        for (const name of (
          await readdir(path.join(directory, "origins"))
        ).filter((entry) => entry.endsWith(".finish.json")))
          await rm(path.join(directory, "origins", name));
        await rewriteRunState(arranged.runner.store, arranged.runId, (next) => {
          next.status = "blocked";
          next.blockedFrom = "verifying";
          next.blockReason = "Fixture verification block.";
        });
        return arranged;
      })
  },
  {
    name: "blocked from verifying with an unresolved digest",
    arrange: () =>
      inRepository(async (root) => {
        const { runner, blocked } = await blockedByFailedCheck(root);
        await rewriteRunState(runner.store, blocked.runId, (state) => {
          state.blockReason =
            "[RESULT_DIGEST_UNRESOLVED] The recorded digest does not match.";
        });
        return { runner, runId: blocked.runId };
      })
  },
  {
    name: "blocked from verifying with malformed task evidence",
    arrange: () =>
      inRepository(async (root) => {
        const { runner, blocked } = await blockedByFailedCheck(root);
        const directory = path.join(
          root,
          requiredFixture(
            requiredFixture(blocked.artifactBinding).binding.artifacts
              .verificationDirectory
          ),
          "attempts"
        );
        const [file] = (await readdir(directory)).filter(
          (name) => name !== "ledger.json"
        );
        await writeFile(
          path.join(directory, requiredFixture(file)),
          "{",
          "utf8"
        );
        return { runner, runId: blocked.runId };
      })
  },
  ...(
    [
      ["missing_task", "completion evidence"],
      ["approved_plan_invalid", "plan bundle"]
    ] as const
  ).map(([violation, label]) => ({
    name: `blocked from verifying with invalid ${label}`,
    arrange: () =>
      inRepository(async (root) => {
        const { runner, blocked } = await blockedByFailedCheck(root);
        await rewriteRunState(runner.store, blocked.runId, (state) => {
          state.planTaskCompletion = invalidCompletion(
            "implementation-1-fixture",
            violation
          );
        });
        return { runner, runId: blocked.runId };
      })
  })),
  {
    name: "blocked from verifying without a legacy ledger",
    arrange: () =>
      inRepository(async (root) => {
        const { runner, blocked } = await blockedByFailedCheck(root);
        await rewriteRunState(runner.store, blocked.runId, (state) => {
          const legacy = state as unknown as Record<string, unknown>;
          legacy.schemaVersion = 7;
          delete legacy.verificationMode;
          delete legacy.taskVerification;
          delete legacy.artifactBinding;
        });
        await rm(runner.store.verificationLedgerPath(blocked.runId), {
          force: true
        });
        return { runner, runId: blocked.runId };
      })
  },
  ...(["failed", "completed"] as const).map((status) => ({
    name: `blocked from verifying with a ${status} legacy attempt`,
    arrange: () =>
      inRepository(async (root) => {
        const { runner, blocked } = await blockedByFailedCheck(root);
        await rewriteRunState(runner.store, blocked.runId, (state) => {
          const legacy = state as unknown as Record<string, unknown>;
          legacy.schemaVersion = 7;
          delete legacy.verificationMode;
          delete legacy.taskVerification;
          delete legacy.artifactBinding;
        });
        await writeVerificationLedger(root, blocked.runId, [
          verificationAttemptFixture({ sequence: 1, status })
        ]);
        return { runner, runId: blocked.runId };
      })
  })),
  ...(
    [
      ["a malformed legacy ledger", "ledger.json"],
      ["a malformed legacy attempt", "verification-fixture-01.json"]
    ] as const
  ).map(([label, file]) => ({
    name: `blocked from verifying with ${label}`,
    arrange: () =>
      inRepository(async (root) => {
        const { runner, blocked } = await blockedByFailedCheck(root);
        await rewriteRunState(runner.store, blocked.runId, (state) => {
          const legacy = state as unknown as Record<string, unknown>;
          legacy.schemaVersion = 7;
          delete legacy.verificationMode;
          delete legacy.taskVerification;
          delete legacy.artifactBinding;
        });
        await writeVerificationLedger(root, blocked.runId, [
          verificationAttemptFixture({ sequence: 1, status: "failed" })
        ]);
        await writeFile(
          path.join(
            path.dirname(runner.store.verificationLedgerPath(blocked.runId)),
            file
          ),
          "{",
          "utf8"
        );
        return { runner, runId: blocked.runId };
      })
  })),
  {
    name: "failed mutable implementation",
    arrange: () => inRepository((root) => failedStrictImplementation(root))
  },
  {
    name: "context-budget-blocked implementation",
    arrange: () =>
      inRepository(async (root) => {
        const arranged = await failedStrictImplementation(root);
        await rewriteActiveAttempt(
          arranged.runner,
          arranged.runId,
          (record) => {
            record.failureCode = "CONTEXT_BUDGET_EXCEEDED";
          }
        );
        return arranged;
      })
  },
  {
    name: "implementation pending completion application",
    arrange: () =>
      inRepository(async (root) => {
        const adapters = new FakeAdapters();
        adapters.reviewResults.push(passingReview());
        const runner = new WorkflowRunner(root, adapters);
        const writeCandidate = runner.store.writeCompletionCandidate.bind(
          runner.store
        );
        let injected = 0;
        runner.store.writeCompletionCandidate = async (
          runId,
          candidate,
          bytes
        ) => {
          if (injected === 0) {
            injected += 1;
            throw new Error("ENOSPC: injected candidate write failure");
          }
          await writeCandidate(runId, candidate, bytes);
        };
        await runner.start({ slug: "example", request: "Implement it." });
        const blocked = await runner.approvePlan("human");
        assert.equal(blocked.status, "blocked", "fixture must block");
        return { runner, runId: blocked.runId };
      })
  },
  ...(
    [
      ["missing_task", "completion evidence"],
      ["approved_plan_invalid", "plan bundle"]
    ] as const
  ).map(([violation, label]) => ({
    name: `implementation rejected for invalid ${label}`,
    arrange: () =>
      inRepository(async (root) => {
        const arranged = await failedStrictImplementation(root);
        const attempt = await rewriteActiveAttempt(
          arranged.runner,
          arranged.runId,
          (record) => {
            record.failureCode = "PLAN_TASK_COMPLETION_INVALID";
          }
        );
        await rewriteRunState(
          arranged.runner.store,
          arranged.runId,
          (state) => {
            state.planTaskCompletion = invalidCompletion(attempt.id, violation);
          }
        );
        return arranged;
      })
  })),
  {
    name: "interrupted implementation",
    arrange: () =>
      inRepository(async (root) => {
        const arranged = await failedStrictImplementation(root);
        await rewriteActiveAttempt(
          arranged.runner,
          arranged.runId,
          markStarted
        );
        return arranged;
      })
  },
  {
    name: "interrupted implementation with a live process",
    arrange: () =>
      inRepository(async (root) => {
        const arranged = await failedStrictImplementation(root);
        await rewriteActiveAttempt(
          arranged.runner,
          arranged.runId,
          markStarted
        );
        await rewriteRunState(
          arranged.runner.store,
          arranged.runId,
          (state) => {
            state.activeProcess = {
              pid: process.pid,
              kind: "implementation",
              startedAt: "2026-07-01T00:00:00.000Z"
            };
          }
        );
        return arranged;
      })
  },
  {
    name: "interrupted implementation with an unreadable attempt record",
    arrange: () =>
      inRepository(async (root) => {
        const arranged = await failedStrictImplementation(root);
        const attempt = await rewriteActiveAttempt(
          arranged.runner,
          arranged.runId,
          markStarted
        );
        await writeFile(
          arranged.runner.store.attemptPath(arranged.runId, attempt),
          "{",
          "utf8"
        );
        return arranged;
      })
  },
  {
    name: "interrupted implementation with a malformed verification ledger",
    arrange: () =>
      inRepository(async (root) => {
        const arranged = await failedStrictImplementation(root);
        await rewriteActiveAttempt(
          arranged.runner,
          arranged.runId,
          markStarted
        );
        await writeFile(
          arranged.runner.store.verificationLedgerPath(arranged.runId),
          "{",
          "utf8"
        );
        return arranged;
      })
  },
  {
    name: "unreadable attempt record behind an exited process",
    arrange: () =>
      inRepository(async (root) => {
        const arranged = await failedStrictImplementation(root);
        const attempt = await rewriteActiveAttempt(
          arranged.runner,
          arranged.runId,
          markStarted
        );
        await rewriteRunState(
          arranged.runner.store,
          arranged.runId,
          (state) => {
            state.activeProcess = {
              pid: 2_147_483_646,
              kind: "implementation",
              startedAt: "2026-07-01T00:00:00.000Z"
            };
          }
        );
        await writeFile(
          arranged.runner.store.attemptPath(arranged.runId, attempt),
          "{",
          "utf8"
        );
        return arranged;
      })
  },
  {
    name: "interrupted implementation after HEAD moved",
    arrange: () =>
      inRepository(async (root) => {
        const arranged = await failedStrictImplementation(root);
        await rewriteActiveAttempt(
          arranged.runner,
          arranged.runId,
          markStarted
        );
        await commitUnrelatedChange(root);
        return arranged;
      })
  },
  {
    name: "interrupted implementation after the approved bundle changed",
    arrange: () =>
      inRepository(async (root) => {
        const arranged = await failedStrictImplementation(root);
        await rewriteActiveAttempt(
          arranged.runner,
          arranged.runId,
          markStarted
        );
        await changeApprovedPlan(root);
        return arranged;
      })
  },
  {
    name: "interrupted implementation with unreadable configuration",
    arrange: () =>
      inRepository(async (root) => {
        const arranged = await failedStrictImplementation(root);
        await rewriteActiveAttempt(
          arranged.runner,
          arranged.runId,
          markStarted
        );
        await writeFile(path.join(root, ".banzai", "config.json"), "{", "utf8");
        return arranged;
      })
  },
  {
    name: "authorized interrupted implementation",
    arrange: () =>
      inRepository(async (root) => {
        const arranged = await failedStrictImplementation(root);
        await rewriteActiveAttempt(
          arranged.runner,
          arranged.runId,
          markStarted
        );
        await authorizeRecovery(arranged.runner);
        return arranged;
      })
  },
  {
    name: "authorized interrupted implementation after workspace drift",
    arrange: () =>
      inRepository(async (root) => {
        const arranged = await failedStrictImplementation(root);
        await rewriteActiveAttempt(
          arranged.runner,
          arranged.runId,
          markStarted
        );
        await authorizeRecovery(arranged.runner);
        await writeFile(path.join(root, "drift.txt"), "drift\n", "utf8");
        return arranged;
      })
  },
  {
    name: "authorized interrupted implementation with an unreadable authorization",
    arrange: () =>
      inRepository(async (root) => {
        const arranged = await failedStrictImplementation(root);
        await rewriteActiveAttempt(
          arranged.runner,
          arranged.runId,
          markStarted
        );
        await authorizeRecovery(arranged.runner);
        const state = await arranged.runner.store.readState(arranged.runId);
        await writeFile(
          arranged.runner.store.recoveryAuthorizationPath(
            arranged.runId,
            requiredFixture(state.recovery).authorizationId
          ),
          "{",
          "utf8"
        );
        return arranged;
      })
  },
  {
    name: "interrupted implementation superseded by a recovery attempt",
    arrange: () =>
      inRepository(async (root) => {
        const arranged = await failedStrictImplementation(root);
        await rewriteActiveAttempt(
          arranged.runner,
          arranged.runId,
          markStarted
        );
        await authorizeRecovery(arranged.runner);
        await rewriteRunState(
          arranged.runner.store,
          arranged.runId,
          (state) => {
            const recovery = requiredFixture(state.recovery);
            recovery.recoveryAttemptId = "implementation-recovery-fixture";
          }
        );
        return arranged;
      })
  },
  {
    name: "implementation failed after its terminal checkpoint",
    arrange: () =>
      inRepository((root) =>
        failedStrictImplementation(root, (adapters) => {
          adapters.failImplementationAfterTerminalCheckpoint = true;
        })
      )
  },
  {
    name: "implementation checkpoint rejected by completion validation",
    arrange: () =>
      inRepository((root) =>
        failedStrictImplementation(root, (adapters) => {
          adapters.implementationResults.push(
            phaseResult("implementation", { taskCompletion: null })
          );
        })
      )
  },
  {
    name: "implementation with a malformed terminal checkpoint",
    arrange: () =>
      inRepository(async (root) => {
        const arranged = await failedStrictImplementation(root, (adapters) => {
          adapters.failImplementationAfterTerminalCheckpoint = true;
        });
        const state = await arranged.runner.store.readState(arranged.runId);
        await writeFile(
          arranged.runner.store.terminalCheckpointPath(
            arranged.runId,
            requiredFixture(state.activeAttempt)
          ),
          "{",
          "utf8"
        );
        return arranged;
      })
  },
  {
    name: "interrupted lite implementation",
    arrange: () =>
      inRepository(async (root) => {
        const arranged = await failedLiteImplementation(root);
        await rewriteActiveAttempt(
          arranged.runner,
          arranged.runId,
          markStarted
        );
        return arranged;
      })
  },
  {
    name: "interrupted fix",
    arrange: () =>
      inRepository(async (root) => {
        const arranged = await failedFix(root);
        await rewriteActiveAttempt(
          arranged.runner,
          arranged.runId,
          markStarted
        );
        return arranged;
      })
  },
  {
    name: "interrupted fix without accepted findings",
    arrange: () =>
      inRepository(async (root) => {
        const arranged = await failedFix(root);
        await rewriteActiveAttempt(
          arranged.runner,
          arranged.runId,
          markStarted
        );
        await rewriteRunState(
          arranged.runner.store,
          arranged.runId,
          (state) => {
            for (const item of requiredFixture(state.triage).items)
              item.disposition = "rejected";
          }
        );
        return arranged;
      })
  },
  ...(
    [
      ["prerequisite-blocked fix", async () => {}],
      [
        "prerequisite-blocked fix with a live process",
        async (fixture: PrerequisiteFixture) => {
          await rewriteRunState(
            fixture.runner.store,
            fixture.blocked.runId,
            (state) => {
              state.activeProcess = {
                pid: process.pid,
                kind: "fix",
                startedAt: "2026-07-01T00:00:00.000Z"
              };
            }
          );
        }
      ],
      [
        "prerequisite-blocked fix after HEAD moved",
        (fixture: PrerequisiteFixture) =>
          commitUnrelatedChange(fixture.repository.root)
      ],
      [
        "prerequisite-blocked fix after the approved bundle changed",
        (fixture: PrerequisiteFixture) =>
          changeApprovedPlan(fixture.repository.root)
      ],
      [
        "prerequisite-blocked fix whose block reason changed",
        (fixture: PrerequisiteFixture) =>
          rewriteRunState(
            fixture.runner.store,
            fixture.blocked.runId,
            (state) => {
              state.blockReason = "A different prerequisite block.";
            }
          )
      ],
      [
        "prerequisite-blocked fix with an unreadable review",
        async (fixture: PrerequisiteFixture) => {
          const state = await fixture.runner.store.readState(
            fixture.blocked.runId
          );
          await writeFile(
            path.join(
              fixture.runner.store.runDirectory(fixture.blocked.runId),
              requiredFixture(state.latestReview).resultPath
            ),
            "{",
            "utf8"
          );
        }
      ],
      [
        "prerequisite-blocked fix with a started descendant",
        (fixture: PrerequisiteFixture) =>
          fixture.runner.store.writeRunAttempt(fixture.blocked.runId, {
            ...fixture.sourceRecord,
            attempt: {
              id: "fix-recovery-existing",
              kind: "fix",
              mutable: true
            },
            status: "started",
            completedAt: null,
            interruptedAt: null,
            recoveryOf: fixture.sourceRecord.attempt.id,
            recoveryAuthorizationId: "recovery-existing",
            result: null,
            durationMs: null,
            error: null,
            failureCode: null,
            failureCause: null
          })
      ],
      [
        "prerequisite-blocked fix with two matching sources",
        (fixture: PrerequisiteFixture) =>
          fixture.runner.store.writeRunAttempt(fixture.blocked.runId, {
            ...fixture.sourceRecord,
            attempt: { ...fixture.sourceRecord.attempt, id: "fix-2-ambiguous" }
          })
      ],
      [
        "prerequisite-blocked fix with a conflicting terminal checkpoint",
        async (fixture: PrerequisiteFixture) => {
          const checkpointPath = fixture.runner.store.terminalCheckpointPath(
            fixture.blocked.runId,
            fixture.sourceRecord.attempt
          );
          const checkpoint = JSON.parse(
            await readFile(checkpointPath, "utf8")
          ) as { baseCommit: string };
          checkpoint.baseCommit = "0".repeat(40);
          await writeFile(checkpointPath, JSON.stringify(checkpoint), "utf8");
        }
      ],
      [
        "authorized prerequisite-blocked fix",
        (fixture: PrerequisiteFixture) => authorizeRecovery(fixture.runner)
      ],
      [
        "authorized prerequisite-blocked fix after workspace drift",
        async (fixture: PrerequisiteFixture) => {
          await authorizeRecovery(fixture.runner);
          await writeFile(
            path.join(fixture.repository.root, "drift.txt"),
            "drift\n",
            "utf8"
          );
        }
      ],
      [
        "prerequisite-blocked fix with a mismatched recovery state",
        async (fixture: PrerequisiteFixture) => {
          await authorizeRecovery(fixture.runner);
          await rewriteRunState(
            fixture.runner.store,
            fixture.blocked.runId,
            (state) => {
              requiredFixture(state.recovery).sourceAttemptId = "fix-9-other";
            }
          );
        }
      ]
    ] as const
  ).map(([name, mutate]) => ({
    name,
    arrange: async (): Promise<EligibilityArrangement> => {
      const fixture = await prerequisiteBlockedFixFixture();
      try {
        await mutate(fixture);
      } catch (error) {
        await fixture.repository.dispose();
        throw error;
      }
      return {
        root: fixture.repository.root,
        runner: fixture.runner,
        runId: fixture.blocked.runId,
        dispose: () => fixture.repository.dispose()
      };
    }
  })),
  {
    name: "failed read-only selection",
    arrange: () => inRepository(failedSelection)
  },
  ...(
    [
      ["started", "selecting", "interrupted"],
      ["completed", "selecting", "completed"],
      ["failed", "planning", "inconsistent"]
    ] as const
  ).map(([recordStatus, blockedFrom, label]) => ({
    name: `${label} read-only selection`,
    arrange: () =>
      inRepository(async (root) => {
        const arranged = await failedSelection(root);
        await rewriteActiveAttempt(
          arranged.runner,
          arranged.runId,
          (record) => {
            record.status = recordStatus;
          }
        );
        await rewriteRunState(
          arranged.runner.store,
          arranged.runId,
          (state) => {
            state.blockedFrom = blockedFrom;
          }
        );
        return arranged;
      })
  })),
  {
    name: "failed planning",
    arrange: () => inRepository(failedPlanning)
  },
  {
    name: "interrupted planning",
    arrange: () =>
      inRepository(async (root) => {
        const arranged = await failedPlanning(root);
        await rewriteActiveAttempt(
          arranged.runner,
          arranged.runId,
          markStarted
        );
        return arranged;
      })
  },
  {
    name: "restore without a plan approval",
    observe: "restore",
    arrange: () => inRepository(strictAwaitingApproval)
  },
  {
    name: "restore with matching approved artifacts",
    observe: "restore",
    arrange: () => inRepository(strictApproved)
  },
  {
    name: "restore of a changed approved bundle",
    observe: "restore",
    arrange: () =>
      inRepository(async (root) => {
        const arranged = await strictApproved(root);
        await changeApprovedPlan(root);
        return arranged;
      })
  },
  {
    name: "restore without an approval snapshot",
    observe: "restore",
    arrange: () =>
      inRepository(async (root) => {
        const arranged = await strictApproved(root);
        await rm(
          path.join(
            arranged.runner.store.runDirectory(arranged.runId),
            "approval",
            "bundle.json"
          )
        );
        return arranged;
      })
  },
  {
    name: "restore with an unverifiable approval snapshot",
    observe: "restore",
    arrange: () =>
      inRepository(async (root) => {
        const arranged = await strictApproved(root);
        const manifest = path.join(
          arranged.runner.store.runDirectory(arranged.runId),
          "approval",
          "bundle.json"
        );
        const snapshot = JSON.parse(await readFile(manifest, "utf8")) as {
          digest: string;
        };
        snapshot.digest = "0".repeat(64);
        await writeFile(manifest, JSON.stringify(snapshot), "utf8");
        return arranged;
      })
  }
];

for (const scenario of ELIGIBILITY_SCENARIOS)
  test(`eligibility baseline: ${scenario.name}`, async () => {
    const arrangement = await scenario.arrange();
    try {
      assert.deepEqual(
        await observeEligibility(
          arrangement.runner,
          arrangement.root,
          arrangement.runId,
          scenario.observe ?? "status"
        ),
        ELIGIBILITY_BASELINE[scenario.name]
      );
    } finally {
      await arrangement.dispose();
    }
  });

for (const name of [
  "blocked from verifying with malformed task evidence",
  "blocked from verifying with a malformed legacy ledger"
])
  test(`status retry snapshots stay independent across calls (${name})`, async () => {
    const scenario = requiredFixture(
      ELIGIBILITY_SCENARIOS.find((candidate) => candidate.name === name)
    );
    const arrangement = await scenario.arrange();
    try {
      // The caller owns its snapshot; editing it must not reach the next call.
      const first = await arrangement.runner.status();
      first.retry.eligible = true;
      first.retry.reason = "Caller changed its own status snapshot.";
      assert.deepEqual(
        await observeEligibility(
          arrangement.runner,
          arrangement.root,
          arrangement.runId
        ),
        ELIGIBILITY_BASELINE[name]
      );
    } finally {
      await arrangement.dispose();
    }
  });

const ELIGIBILITY_BASELINE: Readonly<Record<string, unknown>> = {
  "awaiting plan approval": {
    observed: {
      retry: {
        eligible: false,
        reason:
          "Retry requires a blocked run, but the run is needs_plan_approval.",
        attemptId: null
      },
      recovery: {
        eligible: false,
        terminalCheckpointPresent: false,
        reason:
          "Recovery requires a blocked run, but the run is needs_plan_approval.",
        warning:
          "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.",
        sourceKind: null,
        attemptId: null,
        phase: null,
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
      nextAction: "banzai approve plan"
    },
    persisted: {
      status: "needs_plan_approval",
      blockedFrom: null,
      blockReason: null
    }
  },
  "awaiting triage": {
    observed: {
      retry: {
        eligible: false,
        reason: "Retry requires a blocked run, but the run is needs_triage.",
        attemptId: null
      },
      recovery: {
        eligible: false,
        terminalCheckpointPresent: false,
        reason: "Recovery requires a blocked run, but the run is needs_triage.",
        warning:
          "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.",
        sourceKind: null,
        attemptId: null,
        phase: null,
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
      nextAction: "banzai triage"
    },
    persisted: {
      status: "needs_triage",
      blockedFrom: null,
      blockReason: null
    }
  },
  "persisted status needs_adr_approval": {
    observed: {
      retry: {
        eligible: false,
        reason:
          "Retry requires a blocked run, but the run is needs_adr_approval.",
        attemptId: null
      },
      recovery: {
        eligible: false,
        terminalCheckpointPresent: false,
        reason:
          "Recovery requires a blocked run, but the run is needs_adr_approval.",
        warning:
          "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.",
        sourceKind: null,
        attemptId: null,
        phase: null,
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
      nextAction: "banzai approve adr"
    },
    persisted: {
      status: "needs_adr_approval",
      blockedFrom: null,
      blockReason: null
    }
  },
  "persisted status implementing": {
    observed: {
      retry: {
        eligible: false,
        reason: "Retry requires a blocked run, but the run is implementing.",
        attemptId: null
      },
      recovery: {
        eligible: false,
        terminalCheckpointPresent: false,
        reason: "Recovery requires a blocked run, but the run is implementing.",
        warning:
          "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.",
        sourceKind: null,
        attemptId: null,
        phase: null,
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
      status: "implementing",
      blockedFrom: null,
      blockReason: null
    }
  },
  "persisted status cancelled": {
    observed: {
      retry: {
        eligible: false,
        reason: "Retry requires a blocked run, but the run is cancelled.",
        attemptId: null
      },
      recovery: {
        eligible: false,
        terminalCheckpointPresent: false,
        reason: "Recovery requires a blocked run, but the run is cancelled.",
        warning:
          "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.",
        sourceKind: null,
        attemptId: null,
        phase: null,
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
      nextAction: null
    },
    persisted: {
      status: "cancelled",
      blockedFrom: null,
      blockReason: null
    }
  },
  "planning escalation awaiting a human decision": {
    observed: {
      retry: {
        eligible: false,
        reason:
          "Retry requires a blocked run, but the run is needs_human_decision.",
        attemptId: null
      },
      recovery: {
        eligible: false,
        terminalCheckpointPresent: false,
        reason:
          "Recovery requires a blocked run, but the run is needs_human_decision.",
        warning:
          "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.",
        sourceKind: null,
        attemptId: null,
        phase: null,
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
      nextAction: "banzai"
    },
    persisted: {
      status: "needs_human_decision",
      blockedFrom: null,
      blockReason: null
    }
  },
  "completed lite run": {
    observed: {
      retry: {
        eligible: false,
        reason: "Retry requires a blocked run, but the run is done.",
        attemptId: null
      },
      recovery: {
        eligible: false,
        terminalCheckpointPresent: false,
        reason: "Recovery requires a blocked run, but the run is done.",
        warning:
          "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.",
        sourceKind: null,
        attemptId: null,
        phase: null,
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
      nextAction: null
    },
    persisted: {
      status: "done",
      blockedFrom: null,
      blockReason: null
    }
  },
  "blocked from created without an attempt": {
    observed: {
      retry: {
        eligible: true,
        reason:
          "Startup checks can be retried after resolving the reported prerequisite.",
        attemptId: null
      },
      recovery: {
        eligible: false,
        terminalCheckpointPresent: false,
        reason:
          "Recovery requires an interrupted mutable implementation or fix attempt.",
        warning:
          "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.",
        sourceKind: null,
        attemptId: null,
        phase: null,
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
      blockedFrom: "created",
      blockReason: "Fixture block."
    }
  },
  "blocked from reviewing without an attempt": {
    observed: {
      retry: {
        eligible: true,
        reason:
          "Review checks can be retried after resolving the reported prerequisite.",
        attemptId: null
      },
      recovery: {
        eligible: false,
        terminalCheckpointPresent: false,
        reason:
          "Recovery requires an interrupted mutable implementation or fix attempt.",
        warning:
          "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.",
        sourceKind: null,
        attemptId: null,
        phase: null,
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
      blockedFrom: "reviewing",
      blockReason: "Fixture block."
    }
  },
  "blocked from planning without an attempt": {
    observed: {
      retry: {
        eligible: false,
        reason:
          "This blocked state is not tied to a failed attempt. Resolve it manually or cancel the run.",
        attemptId: null
      },
      recovery: {
        eligible: false,
        terminalCheckpointPresent: false,
        reason:
          "Recovery requires an interrupted mutable implementation or fix attempt.",
        warning:
          "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.",
        sourceKind: null,
        attemptId: null,
        phase: null,
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
      blockedFrom: "planning",
      blockReason: "Fixture block."
    }
  },
  "blocked from plan_approved without an attempt after approval changed": {
    observed: {
      retry: {
        eligible: true,
        reason:
          "Implementation checks can be retried after resolving the reported prerequisite.",
        attemptId: null
      },
      recovery: {
        eligible: false,
        terminalCheckpointPresent: false,
        reason:
          "Recovery requires an interrupted mutable implementation or fix attempt.",
        warning:
          "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.",
        sourceKind: null,
        attemptId: null,
        phase: null,
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
      blockedFrom: "plan_approved",
      blockReason:
        "Approved planning artifacts changed. Restore the approved bundle (banzai restore) and retry, or cancel the run and approve a revised plan in a new run."
    }
  },
  "blocked from implementing without an attempt after approval changed": {
    observed: {
      retry: {
        eligible: true,
        reason:
          "Implementation checks can be retried after resolving the reported prerequisite.",
        attemptId: null
      },
      recovery: {
        eligible: false,
        terminalCheckpointPresent: false,
        reason:
          "Recovery requires an interrupted mutable implementation or fix attempt.",
        warning:
          "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.",
        sourceKind: null,
        attemptId: null,
        phase: null,
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
      blockedFrom: "implementing",
      blockReason:
        "Approved planning artifacts changed. Restore the approved bundle (banzai restore) and retry, or cancel the run and approve a revised plan in a new run."
    }
  },
  "blocked from fixing without an attempt after approval changed": {
    observed: {
      retry: {
        eligible: true,
        reason:
          "Fix checks can be retried after resolving the reported prerequisite.",
        attemptId: null
      },
      recovery: {
        eligible: false,
        terminalCheckpointPresent: false,
        reason: "Implementation requires explicit plan approval.",
        warning:
          "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.",
        sourceKind: null,
        attemptId: null,
        phase: "fix",
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
      blockedFrom: "fixing",
      blockReason:
        "Approved planning artifacts changed. Restore the approved bundle (banzai restore) and retry, or cancel the run and approve a revised plan in a new run."
    }
  },
  "blocked while a model process is active": {
    observed: {
      retry: {
        eligible: false,
        reason: "Retry is unavailable while a model process is still active.",
        attemptId: null
      },
      recovery: {
        eligible: false,
        terminalCheckpointPresent: false,
        reason:
          "Recovery requires an interrupted mutable implementation or fix attempt.",
        warning:
          "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.",
        sourceKind: null,
        attemptId: null,
        phase: null,
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
      blockedFrom: "created",
      blockReason: "Fixture block."
    }
  },
  "approved bundle changed before implementation": {
    observed: {
      retry: {
        eligible: true,
        reason:
          "Implementation checks can be retried after resolving the reported prerequisite.",
        attemptId: null
      },
      recovery: {
        eligible: false,
        terminalCheckpointPresent: false,
        reason:
          "Recovery requires an interrupted mutable implementation or fix attempt.",
        warning:
          "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.",
        sourceKind: null,
        attemptId: null,
        phase: null,
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
      blockedFrom: "plan_approved",
      blockReason:
        "Approved planning artifacts changed. Restore the approved bundle (banzai restore) and retry, or cancel the run and approve a revised plan in a new run."
    }
  },
  "failed task check": {
    observed: {
      retry: {
        eligible: true,
        reason: "The unsuccessful task check can be retried explicitly.",
        attemptId: "verification-<uuid>"
      },
      recovery: {
        eligible: false,
        terminalCheckpointPresent: false,
        reason:
          "Recovery requires an interrupted mutable implementation or fix attempt.",
        warning:
          "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.",
        sourceKind: null,
        attemptId: null,
        phase: null,
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
      blockedFrom: "verifying",
      blockReason:
        "Task verification is incomplete. Inspect the retained physical evidence and retry the failed check without replaying implementation."
    }
  },
  "blocked from verifying after every task check completed": {
    observed: {
      retry: {
        eligible: true,
        reason:
          "Verification prerequisites can be retried without replaying implementation.",
        attemptId: null
      },
      recovery: {
        eligible: false,
        terminalCheckpointPresent: false,
        reason:
          "Recovery requires an interrupted mutable implementation or fix attempt.",
        warning:
          "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.",
        sourceKind: null,
        attemptId: null,
        phase: null,
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
      blockedFrom: "verifying",
      blockReason: "Fixture verification block."
    }
  },
  "blocked from verifying with an unresolved physical task check": {
    observed: {
      retry: {
        eligible: true,
        reason:
          "Retry reconciles the unresolved physical attempt before running eligible checks.",
        attemptId: null
      },
      recovery: {
        eligible: false,
        terminalCheckpointPresent: false,
        reason:
          "Recovery requires an interrupted mutable implementation or fix attempt.",
        warning:
          "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.",
        sourceKind: null,
        attemptId: null,
        phase: null,
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
      blockedFrom: "verifying",
      blockReason: "Fixture verification block."
    }
  },
  "blocked from verifying with an unresolved digest": {
    observed: {
      retry: {
        eligible: false,
        reason:
          "A digest this run's result authored does not match the bytes it names, and no recorded baseline shows those bytes changed after acceptance. Retrying reads the same bytes and fails identically. Inspect the checkout, then cancel the run.",
        attemptId: null
      },
      recovery: {
        eligible: false,
        terminalCheckpointPresent: false,
        reason:
          "Recovery requires an interrupted mutable implementation or fix attempt.",
        warning:
          "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.",
        sourceKind: null,
        attemptId: null,
        phase: null,
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
      blockedFrom: "verifying",
      blockReason:
        "[RESULT_DIGEST_UNRESOLVED] The recorded digest does not match."
    }
  },
  "blocked from verifying with malformed task evidence": {
    observed: {
      retry: {
        eligible: false,
        reason:
          "Verification evidence is malformed or conflicting. Audit the run before continuing.",
        attemptId: null
      },
      recovery: {
        eligible: false,
        terminalCheckpointPresent: false,
        reason:
          "Recovery requires an interrupted mutable implementation or fix attempt.",
        warning:
          "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.",
        sourceKind: null,
        attemptId: null,
        phase: null,
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
      blockedFrom: "verifying",
      blockReason:
        "Task verification is incomplete. Inspect the retained physical evidence and retry the failed check without replaying implementation."
    }
  },
  "blocked from verifying with invalid completion evidence": {
    observed: {
      retry: {
        eligible: true,
        reason:
          "Completion evidence rejected at revalidation can be repaired with a new implementation attempt.",
        attemptId: "implementation-1-fixture"
      },
      recovery: {
        eligible: false,
        terminalCheckpointPresent: false,
        reason:
          "Recovery requires an interrupted mutable implementation or fix attempt.",
        warning:
          "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.",
        sourceKind: null,
        attemptId: null,
        phase: null,
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
      blockedFrom: "verifying",
      blockReason:
        "Task verification is incomplete. Inspect the retained physical evidence and retry the failed check without replaying implementation."
    }
  },
  "blocked from verifying with invalid plan bundle": {
    observed: {
      retry: {
        eligible: true,
        reason:
          "The approved plan bundle is invalid; retry reruns planning for a corrected bundle and a new approval.",
        attemptId: "implementation-1-fixture"
      },
      recovery: {
        eligible: false,
        terminalCheckpointPresent: false,
        reason:
          "Recovery requires an interrupted mutable implementation or fix attempt.",
        warning:
          "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.",
        sourceKind: null,
        attemptId: null,
        phase: null,
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
      blockedFrom: "verifying",
      blockReason:
        "Task verification is incomplete. Inspect the retained physical evidence and retry the failed check without replaying implementation."
    }
  },
  "blocked from verifying without a legacy ledger": {
    observed: {
      retry: {
        eligible: false,
        reason:
          "Legacy verification evidence has no retryable durable attempt identity. Inspect the checkout, then cancel the run.",
        attemptId: null
      },
      recovery: {
        eligible: false,
        terminalCheckpointPresent: false,
        reason:
          "Recovery requires an interrupted mutable implementation or fix attempt.",
        warning:
          "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.",
        sourceKind: null,
        attemptId: null,
        phase: null,
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
      blockedFrom: "verifying",
      blockReason:
        "Task verification is incomplete. Inspect the retained physical evidence and retry the failed check without replaying implementation."
    }
  },
  "blocked from verifying with a failed legacy attempt": {
    observed: {
      retry: {
        eligible: true,
        reason:
          "Failed verification attempt verification-attempt-1 can be retried explicitly.",
        attemptId: "verification-attempt-1"
      },
      recovery: {
        eligible: false,
        terminalCheckpointPresent: false,
        reason:
          "Recovery requires an interrupted mutable implementation or fix attempt.",
        warning:
          "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.",
        sourceKind: null,
        attemptId: null,
        phase: null,
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
      blockedFrom: "verifying",
      blockReason:
        "Task verification is incomplete. Inspect the retained physical evidence and retry the failed check without replaying implementation."
    }
  },
  "blocked from verifying with a completed legacy attempt": {
    observed: {
      retry: {
        eligible: false,
        reason:
          "This blocked state is not tied to a failed attempt. Resolve it manually or cancel the run.",
        attemptId: null
      },
      recovery: {
        eligible: false,
        terminalCheckpointPresent: false,
        reason:
          "Recovery requires an interrupted mutable implementation or fix attempt.",
        warning:
          "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.",
        sourceKind: null,
        attemptId: null,
        phase: null,
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
      blockedFrom: "verifying",
      blockReason:
        "Task verification is incomplete. Inspect the retained physical evidence and retry the failed check without replaying implementation."
    }
  },
  "failed mutable implementation": {
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
          "Attempt implementation-1-<id> is not an uncompleted interruption.",
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
      blockReason: "implementation failed: implementation interrupted"
    }
  },
  "context-budget-blocked implementation": {
    observed: {
      retry: {
        eligible: true,
        reason:
          "Context-budget-blocked implementation attempt implementation-1-<id> can be retried explicitly after policy or authorized input changes because no vendor process started.",
        attemptId: "implementation-1-<id>"
      },
      recovery: {
        eligible: false,
        terminalCheckpointPresent: false,
        reason:
          "Attempt implementation-1-<id> is not an uncompleted interruption.",
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
      nextAction: "banzai retry"
    },
    persisted: {
      status: "blocked",
      blockedFrom: "implementing",
      blockReason: "implementation failed: implementation interrupted"
    }
  },
  "implementation pending completion application": {
    observed: {
      retry: {
        eligible: false,
        reason:
          "Completion publication for this attempt is pending; use banzai resume to reconcile it without another model call, or cancel the run.",
        attemptId: "implementation-1-<id>"
      },
      recovery: {
        eligible: false,
        terminalCheckpointPresent: true,
        reason:
          "A terminal checkpoint exists; use banzai resume so Banzai can reconcile proven completion.",
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
        "[COMPLETION_PUBLICATION_IO] Completion publication for implementation attempt implementation-1-<id> stopped at stage candidate. Retry with banzai resume once storage is available, or cancel."
    }
  },
  "implementation rejected for invalid completion evidence": {
    observed: {
      retry: {
        eligible: true,
        reason:
          "Completion evidence for implementation attempt implementation-1-<id> can be repaired with a new attempt.",
        attemptId: "implementation-1-<id>"
      },
      recovery: {
        eligible: false,
        terminalCheckpointPresent: false,
        reason:
          "Attempt implementation-1-<id> is not an uncompleted interruption.",
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
      nextAction: "banzai retry"
    },
    persisted: {
      status: "blocked",
      blockedFrom: "implementing",
      blockReason: "implementation failed: implementation interrupted"
    }
  },
  "implementation rejected for invalid plan bundle": {
    observed: {
      retry: {
        eligible: true,
        reason:
          "The approved plan bundle is invalid; retry reruns planning for a corrected bundle and a new approval.",
        attemptId: "implementation-1-<id>"
      },
      recovery: {
        eligible: false,
        terminalCheckpointPresent: false,
        reason:
          "Attempt implementation-1-<id> is not an uncompleted interruption.",
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
      nextAction: "banzai retry"
    },
    persisted: {
      status: "blocked",
      blockedFrom: "implementing",
      blockReason: "implementation failed: implementation interrupted"
    }
  },
  "interrupted implementation": {
    observed: {
      retry: {
        eligible: false,
        reason:
          "Failed mutable attempts cannot be retried because their repository side effects may be incomplete. Inspect the checkout, then cancel the run.",
        attemptId: "implementation-1-<id>"
      },
      recovery: {
        eligible: true,
        reason:
          "Interrupted implementation attempt implementation-1-<id> may be recovered only with current explicit authorization.",
        warning:
          "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.",
        sourceKind: "interrupted",
        attemptId: "implementation-1-<id>",
        phase: "implementation",
        resolvedFindingIds: [],
        remainingFindingIds: [],
        prerequisites: [],
        authorization: "plan_approval",
        recoveryIdentity: "<sha256>",
        workspace: {
          digest: "<sha256>",
          added: 3,
          modified: 0,
          deleted: 0,
          total: 3
        },
        baseCommit: "<commit>",
        approvalDigest: "<sha256>",
        workflowDigest: null,
        scopeDigest: "<sha256>",
        configurationDigest: "<sha256>"
      },
      nextAction: "banzai recover"
    },
    persisted: {
      status: "blocked",
      blockedFrom: "implementing",
      blockReason: "implementation failed: implementation interrupted"
    }
  },
  "interrupted implementation with a live process": {
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
      blockReason: "implementation failed: implementation interrupted"
    }
  },
  "interrupted implementation with an unreadable attempt record": {
    observed: {
      error: {
        code: "STATE_READ_FAILED",
        message:
          "Could not read attempt implementation-1-<id>: Expected property name or '}' in JSON at position 1 (line 1 column 2)"
      }
    },
    persisted: {
      status: "blocked",
      blockedFrom: "implementing",
      blockReason: "implementation failed: implementation interrupted"
    }
  },
  "unreadable attempt record behind an exited process": {
    observed: {
      retry: {
        eligible: false,
        reason: "Retry is unavailable while a model process is still active.",
        attemptId: "implementation-1-<id>"
      },
      recovery: {
        eligible: false,
        terminalCheckpointPresent: false,
        reason: "Digest acceptance evidence is unreadable or inconsistent.",
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
      blockReason: "implementation failed: implementation interrupted"
    }
  },
  "interrupted implementation after HEAD moved": {
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
      blockReason: "implementation failed: implementation interrupted"
    }
  },
  "interrupted implementation after the approved bundle changed": {
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
          "Recovery preconditions could not be validated; inspect or cancel the run.",
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
        "Approved planning artifacts changed. Restore the approved bundle (banzai restore) and retry, or cancel the run and approve a revised plan in a new run."
    }
  },
  "interrupted implementation with unreadable configuration": {
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
          "Recovery preconditions could not be validated; inspect or cancel the run.",
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
      blockReason: "implementation failed: implementation interrupted"
    }
  },
  "authorized interrupted implementation": {
    observed: {
      retry: {
        eligible: false,
        reason:
          "Failed mutable attempts cannot be retried because their repository side effects may be incomplete. Inspect the checkout, then cancel the run.",
        attemptId: "implementation-1-<id>"
      },
      recovery: {
        eligible: true,
        reason:
          "Interrupted implementation attempt implementation-1-<id> may be recovered only with current explicit authorization.",
        warning:
          "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.",
        sourceKind: "interrupted",
        attemptId: "implementation-1-<id>",
        phase: "implementation",
        resolvedFindingIds: [],
        remainingFindingIds: [],
        prerequisites: [],
        authorization: "plan_approval",
        recoveryIdentity: "<sha256>",
        workspace: {
          digest: "<sha256>",
          added: 3,
          modified: 0,
          deleted: 0,
          total: 3
        },
        baseCommit: "<commit>",
        approvalDigest: "<sha256>",
        workflowDigest: null,
        scopeDigest: "<sha256>",
        configurationDigest: "<sha256>"
      },
      nextAction: "banzai recover"
    },
    persisted: {
      status: "blocked",
      blockedFrom: "implementing",
      blockReason: "implementation failed: implementation interrupted"
    }
  },
  "authorized interrupted implementation after workspace drift": {
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
      blockReason: "implementation failed: implementation interrupted"
    }
  },
  "interrupted implementation superseded by a recovery attempt": {
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
          "A later recovery attempt already supersedes this interruption.",
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
      blockReason: "implementation failed: implementation interrupted"
    }
  },
  "implementation failed after its terminal checkpoint": {
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
          "A terminal checkpoint exists; use banzai resume so Banzai can reconcile proven completion.",
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
        "implementation failed: parent interrupted after terminal checkpoint"
    }
  },
  "implementation checkpoint rejected by completion validation": {
    observed: {
      retry: {
        eligible: true,
        reason:
          "Completion evidence for implementation attempt implementation-1-<id> can be repaired with a new attempt.",
        attemptId: "implementation-1-<id>"
      },
      recovery: {
        eligible: false,
        terminalCheckpointPresent: true,
        reason:
          "The terminal checkpoint result was rejected by completion validation; use banzai retry to repair its evidence.",
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
      nextAction: "banzai retry"
    },
    persisted: {
      status: "blocked",
      blockedFrom: "implementing",
      blockReason:
        "[PLAN_TASK_COMPLETION_INVALID] Strict implementation result is missing taskCompletion."
    }
  },
  "implementation with a malformed terminal checkpoint": {
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
          "Terminal checkpoint evidence is malformed or conflicting; inspect or cancel the run.",
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
        "implementation failed: parent interrupted after terminal checkpoint"
    }
  },
  "interrupted lite implementation": {
    observed: {
      retry: {
        eligible: false,
        reason:
          "Failed mutable attempts cannot be retried because their repository side effects may be incomplete. Inspect the checkout, then cancel the run.",
        attemptId: "implementation-1-<id>"
      },
      recovery: {
        eligible: true,
        reason:
          "Interrupted implementation attempt implementation-1-<id> may be recovered only with current explicit authorization.",
        warning:
          "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.",
        sourceKind: "interrupted",
        attemptId: "implementation-1-<id>",
        phase: "implementation",
        resolvedFindingIds: [],
        remainingFindingIds: [],
        prerequisites: [],
        authorization: "workflow_selection",
        recoveryIdentity: "<sha256>",
        workspace: {
          digest: "<sha256>",
          added: 1,
          modified: 0,
          deleted: 0,
          total: 1
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
      blockReason: "implementation failed: implementation interrupted"
    }
  },
  "interrupted fix": {
    observed: {
      retry: {
        eligible: false,
        reason:
          "Failed mutable attempts cannot be retried because their repository side effects may be incomplete. Inspect the checkout, then cancel the run.",
        attemptId: "fix-2-<id>"
      },
      recovery: {
        eligible: true,
        reason:
          "Interrupted fix attempt fix-2-<id> may be recovered only with current explicit authorization.",
        warning:
          "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.",
        sourceKind: "interrupted",
        attemptId: "fix-2-<id>",
        phase: "fix",
        resolvedFindingIds: [],
        remainingFindingIds: [],
        prerequisites: [],
        authorization: "plan_approval",
        recoveryIdentity: "<sha256>",
        workspace: {
          digest: "<sha256>",
          added: 15,
          modified: 0,
          deleted: 0,
          total: 15
        },
        baseCommit: "<commit>",
        approvalDigest: "<sha256>",
        workflowDigest: null,
        scopeDigest: "<sha256>",
        configurationDigest: "<sha256>"
      },
      nextAction: "banzai recover"
    },
    persisted: {
      status: "blocked",
      blockedFrom: "fixing",
      blockReason: "fix failed: fix interrupted"
    }
  },
  "interrupted fix without accepted findings": {
    observed: {
      retry: {
        eligible: false,
        reason:
          "Failed mutable attempts cannot be retried because their repository side effects may be incomplete. Inspect the checkout, then cancel the run.",
        attemptId: "fix-2-<id>"
      },
      recovery: {
        eligible: false,
        terminalCheckpointPresent: false,
        reason:
          "Fix recovery requires a non-empty current accepted-finding scope.",
        warning:
          "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.",
        sourceKind: null,
        attemptId: "fix-2-<id>",
        phase: "fix",
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
      blockedFrom: "fixing",
      blockReason: "fix failed: fix interrupted"
    }
  },
  "prerequisite-blocked fix": {
    observed: {
      retry: {
        eligible: false,
        reason:
          "This blocked state is not tied to a failed attempt. Resolve it manually or cancel the run.",
        attemptId: null
      },
      recovery: {
        eligible: true,
        reason:
          "Completed blocked fix attempt fix-2-<id> may be recovered for remaining accepted findings R1-F3 after 2 operator prerequisites.",
        warning:
          "The source attempt remains completed and blocked. Recovery authorizes one new fix attempt for the exact remaining accepted scope after the displayed prerequisites are addressed.",
        sourceKind: "prerequisite_blocked_fix",
        attemptId: "fix-2-<id>",
        phase: "fix",
        resolvedFindingIds: ["R1-F2", "R1-F5", "R1-F6"],
        remainingFindingIds: ["R1-F3"],
        prerequisites: [
          "Run the migration round trip.",
          "Verify the generated schema catalog."
        ],
        authorization: "plan_approval",
        recoveryIdentity: "<sha256>",
        workspace: {
          digest: "<sha256>",
          added: 15,
          modified: 0,
          deleted: 0,
          total: 15
        },
        baseCommit: "<commit>",
        approvalDigest: "<sha256>",
        workflowDigest: null,
        scopeDigest: "<sha256>",
        configurationDigest: "<sha256>"
      },
      nextAction: "banzai recover"
    },
    persisted: {
      status: "blocked",
      blockedFrom: "fixing",
      blockReason: "Migration round-trip evidence requires operator commands."
    }
  },
  "prerequisite-blocked fix with a live process": {
    observed: {
      retry: {
        eligible: false,
        reason: "Retry is unavailable while a model process is still active.",
        attemptId: null
      },
      recovery: {
        eligible: false,
        terminalCheckpointPresent: false,
        reason:
          "Prerequisite recovery requires a completed blocked fix with no active attempt or process.",
        warning:
          "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.",
        sourceKind: null,
        attemptId: null,
        phase: "fix",
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
      blockedFrom: "fixing",
      blockReason: "Migration round-trip evidence requires operator commands."
    }
  },
  "prerequisite-blocked fix after HEAD moved": {
    observed: {
      retry: {
        eligible: false,
        reason:
          "This blocked state is not tied to a failed attempt. Resolve it manually or cancel the run.",
        attemptId: null
      },
      recovery: {
        eligible: false,
        terminalCheckpointPresent: false,
        reason: "Recovery is unavailable because checkout HEAD changed.",
        warning:
          "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.",
        sourceKind: null,
        attemptId: null,
        phase: "fix",
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
      blockedFrom: "fixing",
      blockReason: "Migration round-trip evidence requires operator commands."
    }
  },
  "prerequisite-blocked fix after the approved bundle changed": {
    observed: {
      retry: {
        eligible: false,
        reason:
          "This blocked state is not tied to a failed attempt. Resolve it manually or cancel the run.",
        attemptId: null
      },
      recovery: {
        eligible: false,
        terminalCheckpointPresent: false,
        reason:
          "Approved planning artifacts changed. Run `banzai restore` to write back the approved bytes and then `banzai retry`, or cancel the run and approve a revised plan in a new run.",
        warning:
          "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.",
        sourceKind: null,
        attemptId: null,
        phase: "fix",
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
      blockedFrom: "fixing",
      blockReason:
        "Approved planning artifacts changed. Restore the approved bundle (banzai restore) and retry, or cancel the run and approve a revised plan in a new run."
    }
  },
  "prerequisite-blocked fix whose block reason changed": {
    observed: {
      retry: {
        eligible: false,
        reason:
          "This blocked state is not tied to a failed attempt. Resolve it manually or cancel the run.",
        attemptId: null
      },
      recovery: {
        eligible: false,
        terminalCheckpointPresent: false,
        reason:
          "No exact completed prerequisite-blocked fix source is available.",
        warning:
          "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.",
        sourceKind: null,
        attemptId: null,
        phase: "fix",
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
      blockedFrom: "fixing",
      blockReason: "A different prerequisite block."
    }
  },
  "prerequisite-blocked fix with a started descendant": {
    observed: {
      retry: {
        eligible: false,
        reason:
          "This blocked state is not tied to a failed attempt. Resolve it manually or cancel the run.",
        attemptId: null
      },
      recovery: {
        eligible: false,
        terminalCheckpointPresent: false,
        reason:
          "A recovery descendant already exists for the completed blocked fix source.",
        warning:
          "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.",
        sourceKind: null,
        attemptId: null,
        phase: "fix",
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
      blockedFrom: "fixing",
      blockReason: "Migration round-trip evidence requires operator commands."
    }
  },
  "prerequisite-blocked fix with two matching sources": {
    observed: {
      retry: {
        eligible: false,
        reason:
          "This blocked state is not tied to a failed attempt. Resolve it manually or cancel the run.",
        attemptId: null
      },
      recovery: {
        eligible: false,
        terminalCheckpointPresent: false,
        reason:
          "Multiple completed blocked fix attempts match the current review; recovery is ambiguous.",
        warning:
          "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.",
        sourceKind: null,
        attemptId: null,
        phase: "fix",
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
      blockedFrom: "fixing",
      blockReason: "Migration round-trip evidence requires operator commands."
    }
  },
  "prerequisite-blocked fix with a conflicting terminal checkpoint": {
    observed: {
      retry: {
        eligible: false,
        reason:
          "This blocked state is not tied to a failed attempt. Resolve it manually or cancel the run.",
        attemptId: null
      },
      recovery: {
        eligible: false,
        terminalCheckpointPresent: false,
        reason: "Terminal checkpoint integrity mismatch.",
        warning:
          "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.",
        sourceKind: null,
        attemptId: null,
        phase: "fix",
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
      blockedFrom: "fixing",
      blockReason: "Migration round-trip evidence requires operator commands."
    }
  },
  "authorized prerequisite-blocked fix": {
    observed: {
      retry: {
        eligible: false,
        reason:
          "This blocked state is not tied to a failed attempt. Resolve it manually or cancel the run.",
        attemptId: null
      },
      recovery: {
        eligible: true,
        reason:
          "Completed blocked fix attempt fix-2-<id> may be recovered for remaining accepted findings R1-F3 after 2 operator prerequisites.",
        warning:
          "The source attempt remains completed and blocked. Recovery authorizes one new fix attempt for the exact remaining accepted scope after the displayed prerequisites are addressed.",
        sourceKind: "prerequisite_blocked_fix",
        attemptId: "fix-2-<id>",
        phase: "fix",
        resolvedFindingIds: ["R1-F2", "R1-F5", "R1-F6"],
        remainingFindingIds: ["R1-F3"],
        prerequisites: [
          "Run the migration round trip.",
          "Verify the generated schema catalog."
        ],
        authorization: "plan_approval",
        recoveryIdentity: "<sha256>",
        workspace: {
          digest: "<sha256>",
          added: 15,
          modified: 0,
          deleted: 0,
          total: 15
        },
        baseCommit: "<commit>",
        approvalDigest: "<sha256>",
        workflowDigest: null,
        scopeDigest: "<sha256>",
        configurationDigest: "<sha256>"
      },
      nextAction: "banzai recover"
    },
    persisted: {
      status: "blocked",
      blockedFrom: "fixing",
      blockReason: "Migration round-trip evidence requires operator commands."
    }
  },
  "authorized prerequisite-blocked fix after workspace drift": {
    observed: {
      retry: {
        eligible: false,
        reason:
          "This blocked state is not tied to a failed attempt. Resolve it manually or cancel the run.",
        attemptId: null
      },
      recovery: {
        eligible: false,
        terminalCheckpointPresent: false,
        reason: "Persisted recovery authorization is stale or inconsistent.",
        warning:
          "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.",
        sourceKind: null,
        attemptId: "fix-2-<id>",
        phase: "fix",
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
      blockedFrom: "fixing",
      blockReason: "Migration round-trip evidence requires operator commands."
    }
  },
  "prerequisite-blocked fix with a mismatched recovery state": {
    observed: {
      retry: {
        eligible: false,
        reason:
          "This blocked state is not tied to a failed attempt. Resolve it manually or cancel the run.",
        attemptId: null
      },
      recovery: {
        eligible: false,
        terminalCheckpointPresent: false,
        reason:
          "Persisted recovery state does not match the completed blocked fix source.",
        warning:
          "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.",
        sourceKind: null,
        attemptId: "fix-9-other",
        phase: "fix",
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
      blockedFrom: "fixing",
      blockReason: "Migration round-trip evidence requires operator commands."
    }
  },
  "failed read-only selection": {
    observed: {
      retry: {
        eligible: true,
        reason:
          "Failed selection attempt selection-1-<id> can be retried explicitly.",
        attemptId: "selection-1-<id>"
      },
      recovery: {
        eligible: false,
        terminalCheckpointPresent: false,
        reason:
          "Recovery requires an interrupted mutable implementation or fix attempt.",
        warning:
          "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.",
        sourceKind: null,
        attemptId: "selection-1-<id>",
        phase: null,
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
      blockedFrom: "selecting",
      blockReason: "selection failed: selection failed"
    }
  },
  "interrupted read-only selection": {
    observed: {
      retry: {
        eligible: true,
        reason:
          "Interrupted selection attempt selection-1-<id> can be retried explicitly because it was read-only.",
        attemptId: "selection-1-<id>"
      },
      recovery: {
        eligible: false,
        terminalCheckpointPresent: false,
        reason:
          "Recovery requires an interrupted mutable implementation or fix attempt.",
        warning:
          "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.",
        sourceKind: null,
        attemptId: "selection-1-<id>",
        phase: null,
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
      blockedFrom: "selecting",
      blockReason: "selection failed: selection failed"
    }
  },
  "completed read-only selection": {
    observed: {
      retry: {
        eligible: false,
        reason: "Attempt selection-1-<id> is completed, not failed.",
        attemptId: "selection-1-<id>"
      },
      recovery: {
        eligible: false,
        terminalCheckpointPresent: false,
        reason:
          "Recovery requires an interrupted mutable implementation or fix attempt.",
        warning:
          "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.",
        sourceKind: null,
        attemptId: "selection-1-<id>",
        phase: null,
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
      blockedFrom: "selecting",
      blockReason: "selection failed: selection failed"
    }
  },
  "inconsistent read-only selection": {
    observed: {
      retry: {
        eligible: false,
        reason:
          "The failed selection attempt is inconsistent with blockedFrom=planning.",
        attemptId: "selection-1-<id>"
      },
      recovery: {
        eligible: false,
        terminalCheckpointPresent: false,
        reason:
          "Recovery requires an interrupted mutable implementation or fix attempt.",
        warning:
          "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.",
        sourceKind: null,
        attemptId: "selection-1-<id>",
        phase: null,
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
      blockedFrom: "planning",
      blockReason: "selection failed: selection failed"
    }
  },
  "failed planning": {
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
          "Recovery requires an interrupted mutable implementation or fix attempt.",
        warning:
          "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.",
        sourceKind: null,
        attemptId: "plan-1-<id>",
        phase: null,
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
      blockReason: "plan failed: planning failed"
    }
  },
  "interrupted planning": {
    observed: {
      retry: {
        eligible: false,
        reason:
          "Interrupted attempts cannot be retried automatically. Inspect the checkout, then cancel the run.",
        attemptId: "plan-1-<id>"
      },
      recovery: {
        eligible: false,
        terminalCheckpointPresent: false,
        reason:
          "Recovery requires an interrupted mutable implementation or fix attempt.",
        warning:
          "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.",
        sourceKind: null,
        attemptId: "plan-1-<id>",
        phase: null,
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
      blockedFrom: "planning",
      blockReason: "plan failed: planning failed"
    }
  },
  "restore without a plan approval": {
    observed: {
      eligible: false,
      reason: "The run has no recorded plan approval."
    },
    persisted: {
      status: "needs_plan_approval",
      blockedFrom: null,
      blockReason: null
    }
  },
  "restore with matching approved artifacts": {
    observed: {
      eligible: false,
      reason:
        "The approved planning artifacts already match the recorded approval."
    },
    persisted: {
      status: "plan_approved",
      blockedFrom: null,
      blockReason: null
    }
  },
  "restore of a changed approved bundle": {
    observed: {
      eligible: true,
      reason:
        "The approved planning artifacts diverged from the recorded approval and can be restored from the snapshot."
    },
    persisted: {
      status: "plan_approved",
      blockedFrom: null,
      blockReason: null
    }
  },
  "restore without an approval snapshot": {
    observed: {
      eligible: false,
      reason:
        "This run predates approval snapshots; restore the approved bytes manually or cancel the run."
    },
    persisted: {
      status: "plan_approved",
      blockedFrom: null,
      blockReason: null
    }
  },
  "restore with an unverifiable approval snapshot": {
    observed: {
      eligible: false,
      reason:
        "The stored approval snapshot does not verify against the recorded approval digest."
    },
    persisted: {
      status: "plan_approved",
      blockedFrom: null,
      blockReason: null
    }
  },
  "failed task check with an unreadable implementation attempt record": {
    observed: {
      retry: {
        eligible: true,
        reason: "The unsuccessful task check can be retried explicitly.",
        attemptId: "verification-<uuid>"
      },
      recovery: {
        eligible: false,
        terminalCheckpointPresent: false,
        reason:
          "Recovery requires an interrupted mutable implementation or fix attempt.",
        warning:
          "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.",
        sourceKind: null,
        attemptId: null,
        phase: null,
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
      blockedFrom: "verifying",
      blockReason:
        "Task verification is incomplete. Inspect the retained physical evidence and retry the failed check without replaying implementation."
    }
  },
  "blocked from verifying with a malformed legacy ledger": {
    observed: {
      retry: {
        eligible: false,
        reason:
          "Verification evidence is malformed or conflicting. Audit the run before continuing.",
        attemptId: null
      },
      recovery: {
        eligible: false,
        terminalCheckpointPresent: false,
        reason:
          "Recovery requires an interrupted mutable implementation or fix attempt.",
        warning:
          "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.",
        sourceKind: null,
        attemptId: null,
        phase: null,
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
      blockedFrom: "verifying",
      blockReason:
        "Task verification is incomplete. Inspect the retained physical evidence and retry the failed check without replaying implementation."
    }
  },
  "blocked from verifying with a malformed legacy attempt": {
    observed: {
      retry: {
        eligible: false,
        reason:
          "Verification evidence is malformed or conflicting. Audit the run before continuing.",
        attemptId: null
      },
      recovery: {
        eligible: false,
        terminalCheckpointPresent: false,
        reason:
          "Recovery requires an interrupted mutable implementation or fix attempt.",
        warning:
          "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.",
        sourceKind: null,
        attemptId: null,
        phase: null,
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
      blockedFrom: "verifying",
      blockReason:
        "Task verification is incomplete. Inspect the retained physical evidence and retry the failed check without replaying implementation."
    }
  },
  "interrupted implementation with a malformed verification ledger": {
    observed: {
      retry: {
        eligible: false,
        reason:
          "Failed mutable attempts cannot be retried because their repository side effects may be incomplete. Inspect the checkout, then cancel the run.",
        attemptId: "implementation-1-<id>"
      },
      recovery: {
        eligible: true,
        reason:
          "Interrupted implementation attempt implementation-1-<id> may be recovered only with current explicit authorization.",
        warning:
          "Repository and external side effects may be partial or duplicated. Recovery authorizes new work from this exact checkout; it does not mark the interrupted attempt completed.",
        sourceKind: "interrupted",
        attemptId: "implementation-1-<id>",
        phase: "implementation",
        resolvedFindingIds: [],
        remainingFindingIds: [],
        prerequisites: [],
        authorization: "plan_approval",
        recoveryIdentity: "<sha256>",
        workspace: {
          digest: "<sha256>",
          added: 3,
          modified: 0,
          deleted: 0,
          total: 3
        },
        baseCommit: "<commit>",
        approvalDigest: "<sha256>",
        workflowDigest: null,
        scopeDigest: "<sha256>",
        configurationDigest: "<sha256>"
      },
      nextAction: "banzai recover"
    },
    persisted: {
      status: "blocked",
      blockedFrom: "implementing",
      blockReason: "implementation failed: implementation interrupted"
    }
  },
  "authorized interrupted implementation with an unreadable authorization": {
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
          "Recovery preconditions could not be validated; inspect or cancel the run.",
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
      blockReason: "implementation failed: implementation interrupted"
    }
  },
  "prerequisite-blocked fix with an unreadable review": {
    observed: {
      error: {
        code: null,
        message:
          "Expected property name or '}' in JSON at position 1 (line 1 column 2)"
      }
    },
    persisted: {
      status: "blocked",
      blockedFrom: "fixing",
      blockReason: "Migration round-trip evidence requires operator commands."
    }
  }
};
