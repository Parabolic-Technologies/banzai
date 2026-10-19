import { vendorFor } from "../src/models.js";
import type {
  PlanningAdapterRequest,
  PlanningReviewResult,
  PlanningReviewAnalysis
} from "../src/types.js";
import { RunStore } from "../src/store.js";
import {
  parseTaskVerificationDescriptor,
  evidenceDigest
} from "../src/verification-evidence.js";
import assert from "node:assert/strict";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { renderPlanTaskCompletionProjection } from "../src/plan-task-completion.js";
import {
  CONTRACT_VERSION,
  PHASE_RESULT_SCHEMA_VERSION,
  PLAN_TASK_COMPLETION_SCHEMA_VERSION,
  type AdapterResult,
  type ClaudeInvocationScope,
  type ModelUsage,
  type OrchestratorConfig,
  type PhaseAdapterRequest,
  type PhaseResult,
  type ProcessRunner,
  type ReviewAdapterRequest,
  type ReviewFinding,
  type ReviewResult,
  type RunState,
  type SessionInventory,
  type VendorAdapters,
  type WorkflowSelectionAdapterRequest,
  type WorkflowSelectionResult
} from "../src/types.js";
import { WorkflowRunner } from "../src/workflow.js";
import {
  createTestRepository,
  historicalBindingFixture,
  requiredFixture
} from "./helpers.js";
import {
  planningReviewResult,
  planningReviewAnalysis
} from "./planning-review-fixtures.js";
import type { HumanTimeObserver } from "../src/human-time.js";

/** Rewrites the active run as state 8 with the private binding v2 it persisted. */
export async function ageToHistoricalBinding(
  runner: WorkflowRunner
): Promise<void> {
  const state = await runner.store.requireActiveState();
  const binding = requiredFixture(state.artifactBinding).binding;
  state.schemaVersion = 8;
  delete state.planningReview;
  state.artifactBinding = historicalBindingFixture({
    workId: binding.workId,
    slug: binding.slug,
    createdAt: binding.createdAt,
    sourceCommit: binding.sourceCommit
  });
  // Raw bytes, because the store never rewrites a terminal state.
  await writeFile(
    runner.store.statePath(state.runId),
    JSON.stringify(state, null, 2),
    "utf8"
  );
}

export async function createAdrGateFixture(observer?: HumanTimeObserver) {
  const repository = await createTestRepository();
  const adapters = new FakeAdapters();
  adapters.planResults.push(phaseResult("plan", { gate: "adr_approval" }));
  const runner = new WorkflowRunner(
    repository.root,
    adapters,
    undefined,
    undefined,
    observer
  );
  const gate = await runner.start({
    slug: "adr-rework",
    request: "Plan the ADR."
  });
  assert.equal(gate.status, "needs_adr_approval", gate.blockReason ?? "");
  return { repository, adapters, runner, gate };
}

export async function createPlanningReviewFixture(count = 0) {
  const repository = await createTestRepository();
  const adapters = new FakeAdapters();
  const runner = new WorkflowRunner(repository.root, adapters);
  const gate = await runner.start({
    slug: "example",
    request: "Plan the example."
  });
  assert.equal(gate.status, "needs_plan_approval", gate.blockReason ?? "");
  const requested = await runner.requestPlanningReview({
    paths: null,
    decidedBy: "owner",
    autoResume: false
  });
  const episode = requiredFixture(requested.planningReview?.active);
  const result = {
    ...planningReviewResult(count, episode.reviewNumber),
    scope: episode.scope
  };
  adapters.planningReviewResults.push(result);
  if (count > 0)
    adapters.planningAnalysisResults.push(planningReviewAnalysis(result));
  return { repository, adapters, runner, gate, requested, result };
}

export const descriptionPath = "documentation/work/example/description.md";

export const planPath = "documentation/work/example/plan.md";

// Resolve the fixture's old role labels against the run's actual private binding.
export async function boundFixturePath(
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

export function phaseResult(
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
          : "documentation/work/example/implementation-report.md",
      testReport:
        phase === "plan" ? null : "documentation/work/example/test-report.md"
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

export function decisionConsultationResult(
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

export function completionLedger(taskIds: readonly string[]) {
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

export function selectionResult(
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

export function finding(id: string, summary: string): ReviewFinding {
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

export function adapterResult<T>(
  result: T,
  sessionId: string | null = null,
  usage: ModelUsage | null = null
): AdapterResult<T> {
  return { result, sessionId, stdout: "", stderr: "", usage };
}

export async function writeImplementationArtifacts(
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

export class FakeAdapters implements VendorAdapters {
  planningReviewResults: PlanningReviewResult[] = [];
  planningAnalysisResults: PlanningReviewAnalysis[] = [];
  planningAnalysisErrors: Error[] = [];
  planningRequests: (
    | PlanningAdapterRequest<PlanningReviewResult>
    | PlanningAdapterRequest<PlanningReviewAnalysis>
  )[] = [];
  onPlanning:
    | ((
        request:
          | PlanningAdapterRequest<PlanningReviewResult>
          | PlanningAdapterRequest<PlanningReviewAnalysis>
      ) => Promise<void>)
    | null = null;
  async runPlanningReview(
    request: PlanningAdapterRequest<PlanningReviewResult>
  ): Promise<AdapterResult<PlanningReviewResult>> {
    this.planningRequests.push(request);
    await this.onPlanning?.(request);
    const result = this.planningReviewResults.shift();
    if (result === undefined)
      throw new Error("Planning review fixture is missing");
    await request.onTerminalSuccess?.({
      classification:
        request.outputContract.vendor === "codex"
          ? "codex_turn_completed"
          : "claude_result",
      observedAt: new Date().toISOString(),
      result,
      sessionId: "planning-review-session",
      usage: null
    });
    return {
      result,
      sessionId: "planning-review-session",
      stdout: "",
      stderr: "",
      usage: null
    };
  }
  async runPlanningAnalysis(
    request: PlanningAdapterRequest<PlanningReviewAnalysis>
  ): Promise<AdapterResult<PlanningReviewAnalysis>> {
    this.planningRequests.push(request);
    await this.onPlanning?.(request);
    const result = this.planningAnalysisResults.shift();
    if (result === undefined)
      throw new Error("Planning analysis fixture is missing");
    const sessionId = request.resumeSessionId ?? "planning-analysis-session";
    await request.onSessionStarted?.(sessionId);
    const error = this.planningAnalysisErrors.shift();
    if (error !== undefined) throw error;
    await request.onTerminalSuccess?.({
      classification:
        request.outputContract.vendor === "codex"
          ? "codex_turn_completed"
          : "claude_result",
      observedAt: new Date().toISOString(),
      result,
      sessionId,
      usage: null
    });
    return { result, sessionId, stdout: "", stderr: "", usage: null };
  }
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
      roles?.description ?? "documentation/work/example/description.md";
    const planPath = roles?.plan ?? "documentation/work/example/plan.md";
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
        ["documentation/work/example/description.md", descriptionPath],
        ["documentation/work/example/plan.md", planPath],
        [
          "documentation/work/example/implementation-report.md",
          roles.implementationReport ?? null
        ],
        ["documentation/work/example/test-report.md", roles.testReport ?? null]
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
              : roles?.work) ?? "documentation/work/example/work.md"
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

export function passingReview(reviewedFindingIds: string[] = []): ReviewResult {
  return {
    contractVersion: CONTRACT_VERSION,
    verdict: "pass",
    summary: "Implementation matches the plan.",
    findings: [],
    reviewedFindingIds,
    deferredCoverage: []
  };
}

export async function authorizedImplementationRecoveryFixture(
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

export async function prerequisiteBlockedFixFixture(
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

export async function configureInstructionPlugin(
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

export function failingOnceVerification(): ProcessRunner {
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

export async function blockedByFailedCheck(root: string) {
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
