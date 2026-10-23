import { validateHumanFreeText } from "./validation.js";
import type {
  PlanningReviewTriageAnswer,
  PlanningReviewTriageRequest,
  PlanningReviewDisposition
} from "./types.js";
import {
  configurationDecisionLines,
  taskVerificationStatusLines,
  editVerificationCommands
} from "./verification-ui.js";
import type {
  HumanTimeEpisode,
  HumanTimeGateway,
  HumanTimeIssueCode,
  HumanTimeSummary
} from "./human-time.js";
import { createHash } from "node:crypto";
import path from "node:path";
import type { ModelUpdate } from "./config.js";
import packageManifest from "../package.json" with { type: "json" };
import { createStyler, type Styler } from "./ansi.js";
import { BanzaiError, errorMessage } from "./errors.js";
import {
  escapeTerminalText,
  formatUsage,
  hangingLines,
  labeledLines,
  resolveWidth,
  wrapText
} from "./format.js";
import {
  configuredModels,
  describeRoles,
  modelAdvisories,
  vendorUsage,
  type ModelAdvisory,
  type ModelRole
} from "./models.js";
import type {
  AdrDecision,
  DecisionConsultationAnswer,
  DecisionConsultationCard,
  ModelSettings,
  OrchestratorConfig,
  ReviewFinding,
  RunState
} from "./types.js";
import type {
  DecisionConsultationInput,
  ConfigurationDecisionInput,
  HumanDecisionInput,
  RecoverInput,
  StartRunInput,
  TriageInput,
  WorkflowStatus
} from "./workflow.js";
import {
  historicalRunNotice,
  humanDecisionQuestions,
  reviewStatusLines,
  planningReviewStatusLines
} from "./workflow.js";
import type { TerminalAttention } from "./terminal-attention.js";
import {
  pendingRotationText,
  reviewExecutionText,
  reviewSeverityText,
  reviewVerdictText,
  runStatusText
} from "./vocabulary.js";

export interface InteractiveChoice<T> {
  name: string;
  value: T;
  description?: string;
  disabled?: string;
}

export interface InteractiveInput {
  message: string;
  defaultValue?: string;
  collapsedPaste?: boolean;
  validate?: (value: string) => true | string;
}

export interface InteractiveIO {
  /**
   * Terminal width in columns, when the surface knows it. Prose wraps to a
   * clamped form of this; surfaces that cannot report a width get the default.
   */
  readonly width?: number | undefined;
  input(options: InteractiveInput): Promise<string>;
  select<T>(
    message: string,
    choices: readonly InteractiveChoice<T>[],
    signal?: AbortSignal
  ): Promise<T>;
  multiSelect<T>(
    message: string,
    choices: readonly InteractiveChoice<T>[],
    validate: (values: T[]) => true | string
  ): Promise<T[]>;
  confirm(message: string, defaultValue?: boolean): Promise<boolean>;
  writeLine(message?: string): void;
}

import { cancellationMessages } from "./cancellation-cli.js";
import type {
  CancelRunInput,
  CancellationAnswer,
  CancellationReason,
  CancellationReceipt,
  CancellationResponseResult,
  CancellationResult
} from "./cancellation.js";

export interface InteractiveRunner {
  reworkPlan(input: {
    feedback: string;
    decidedBy: string;
    autoResume?: boolean;
  }): Promise<RunState>;
  requestPlanningReview(input: {
    paths: string[] | null;
    decidedBy: string;
    autoResume?: boolean;
  }): Promise<RunState>;
  answerPlanningReview(input: {
    answer: PlanningReviewTriageAnswer;
    decidedBy: string;
    autoResume?: boolean;
  }): Promise<RunState>;
  readonly repoRoot: string;
  getPlanHumanPrerequisites?(): Promise<string | null>;
  status(): Promise<WorkflowStatus>;
  start(input: StartRunInput): Promise<RunState>;
  resume(): Promise<RunState>;
  retry(): Promise<RunState>;
  restoreApproval(): Promise<string[]>;
  restoreEligibility(): Promise<{ eligible: boolean; reason: string }>;
  recover(input: RecoverInput, autoResume?: boolean): Promise<RunState>;
  approvePlan(approvedBy: string, autoResume?: boolean): Promise<RunState>;
  decideAdr(input: {
    id: string;
    decision: AdrDecision["decision"];
    note: string | null;
    decidedBy: string;
    autoResume: boolean;
  }): Promise<RunState>;
  answerHumanDecision(
    input: HumanDecisionInput,
    autoResume?: boolean
  ): Promise<RunState>;
  answerDecisionConsultation(
    input: DecisionConsultationInput,
    autoResume?: boolean
  ): Promise<RunState>;
  withConfigurationDecisionOwnership<T>(action: () => Promise<T>): Promise<T>;
  answerConfigurationPrerequisite(
    input: ConfigurationDecisionInput,
    autoResume?: boolean
  ): Promise<RunState>;
  triage(input: TriageInput, autoResume?: boolean): Promise<RunState>;
  cancel(input?: CancelRunInput): Promise<CancellationResult>;
  recordCancellationResponse(
    receipt: CancellationReceipt,
    answer: CancellationAnswer
  ): Promise<CancellationResponseResult>;
}

/**
 * Repository-local model configuration. Kept separate from the runner because
 * configuration is read and written outside any run.
 */
export interface ModelConfigurationGateway {
  /** Resolves to null when the project has no `.banzai/config.json` yet. */
  load(): Promise<OrchestratorConfig | null>;
  applyModelUpdates(updates: readonly ModelUpdate[]): Promise<void>;
}

/**
 * Subscription authentication for one configured vendor. Resolves to null when
 * the vendor is ready, or to the reason it is not.
 */
export interface AuthenticationGateway {
  check(settings: ModelSettings): Promise<string | null>;
}

/** Display-only repository facts for the launch header. */
export interface RepositoryIdentity {
  branch: string | null;
  commit: string | null;
  carriedInChanges: number;
}

export interface RepositoryIdentityGateway {
  describe(): Promise<RepositoryIdentity>;
}

export interface InteractiveOptions {
  beforeStart?: () => Promise<boolean>;
  /** Base IO for the single cancellation reason prompt, without timing actions. */
  cancellationIO?: InteractiveIO;
  humanTime?: HumanTimeGateway;
  decidedBy: string;
  attention?: TerminalAttention;
  models?: ModelConfigurationGateway;
  auth?: AuthenticationGateway;
  repository?: RepositoryIdentityGateway;
  styler?: Styler;
}

/**
 * The header degrades to the parts that resolved: a checkout with no commits,
 * a detached HEAD, or an unreadable index must not stop the session starting.
 */
async function describeRepository(
  options: InteractiveOptions
): Promise<RepositoryIdentity | null> {
  if (options.repository === undefined) {
    return null;
  }
  try {
    return await options.repository.describe();
  } catch {
    return null;
  }
}

type PrimaryAction =
  | "answer_human"
  | "approve_plan"
  | "rework_plan"
  | "planning_review"
  | "cancel"
  | "exit"
  | "resume"
  | "retry"
  | "restore"
  | "recover"
  | "start";

type ModelUpdateAction = "update_all" | "update_some" | "keep";

type FindingAction = "accepted" | "rejected" | "deferred" | "exit";
type AdrAction = AdrDecision["decision"] | "planning_review" | "exit";
type ConsultationCardAction =
  | { kind: "option"; optionId: string }
  | { kind: "preference" }
  | { kind: "details" }
  | { kind: "pause" };

function nonEmpty(value: string): true | string {
  return value.trim().length > 0 ? true : "A value is required.";
}

export function generateFeatureSlug(request: string): string {
  const digest = createHash("sha256")
    .update(request.trim().normalize("NFKC"))
    .digest("hex")
    .slice(0, 8);
  const normalized = request
    .normalize("NFKD")
    .replace(/\p{Mark}+/gu, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (normalized.length > 64) {
    const prefix = normalized.slice(0, 55).replace(/-+$/g, "");
    return `${prefix}-${digest}`;
  }
  if (normalized.length > 0) {
    return normalized;
  }
  return `feature-${digest}`;
}

function isPromptExit(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "ExitPromptError" || error.name === "AbortPromptError")
  );
}

async function statusOrNull(
  runner: InteractiveRunner
): Promise<WorkflowStatus | null> {
  try {
    return await runner.status();
  } catch (error) {
    if (error instanceof BanzaiError && error.code === "NO_ACTIVE_RUN") {
      return null;
    }
    throw error;
  }
}

function adrIdFromArtifact(artifact: string): string {
  const basename = path.basename(artifact, path.extname(artifact));
  const match = /^(?:adr[-_])?([0-9]+)/i.exec(basename);
  return match?.[1] === undefined ? basename : `ADR-${match[1]}`;
}

function renderArtifacts(
  io: InteractiveIO,
  state: RunState,
  styler: Styler
): void {
  const artifacts = state.planArtifacts;
  if (artifacts === null) {
    return;
  }
  const lines = ["Artifacts"];
  if (artifacts.description !== null) {
    lines.push(`Description: ${artifacts.description}`);
  }
  for (const adr of artifacts.adrs) {
    lines.push(`ADR: ${adr}`);
  }
  if (artifacts.plan !== null) {
    lines.push(`Plan: ${artifacts.plan}`);
  }
  renderSection(io, styler, lines);
}

/** The first line is a heading; the remaining lines share the body indent. */
function renderSection(
  io: InteractiveIO,
  styler: Styler,
  lines: readonly string[]
): void {
  const [heading, ...body] = lines;
  if (heading === undefined) return;
  io.writeLine();
  io.writeLine(styler.bold(heading));
  for (const text of body) {
    for (const line of wrapText(text, resolveWidth(io.width), "  ")) {
      io.writeLine(line);
    }
  }
}

/** Writes `Label: body`, wrapping to the terminal when the body is prose. */
function writeLabeled(io: InteractiveIO, label: string, body: string): void {
  for (const line of labeledLines(label, body, resolveWidth(io.width))) {
    io.writeLine(line);
  }
}

function renderConsultationCard(
  io: InteractiveIO,
  card: DecisionConsultationCard,
  ordinal: number,
  total: number,
  detailed: boolean
): void {
  const optionTitle = (optionId: string): string =>
    card.options.find((option) => option.optionId === optionId)?.title ??
    optionId;
  writeLabeled(
    io,
    "Decision",
    `${ordinal}/${total} ${card.title} [${card.decisionId}] — ${card.question}`
  );
  writeLabeled(
    io,
    "Why this matters",
    `${card.why} Affected: ${card.affectedRequirements.join(", ")}. Owner: human.`
  );
  writeLabeled(
    io,
    "Repository evidence",
    detailed
      ? `${card.evidence.length} reference${card.evidence.length === 1 ? "" : "s"}:`
      : card.evidence
          .map(
            (evidence) =>
              `${evidence.path}${evidence.line === null ? "" : `:${evidence.line}`}`
          )
          .join(", ")
  );
  if (detailed) {
    for (const evidence of card.evidence) {
      const source = `${evidence.path}${evidence.line === null ? "" : `:${evidence.line}`}`;
      for (const line of hangingLines(
        `  ${source} — `,
        evidence.detail,
        resolveWidth(io.width)
      )) {
        io.writeLine(line);
      }
    }
  }
  writeLabeled(
    io,
    "Options",
    card.options.length === 0
      ? "Explain a project-specific preference."
      : card.options
          .map((option) => `${option.optionId} — ${option.title}`)
          .join("; ")
  );
  if (detailed) {
    for (const option of card.options) {
      io.writeLine(`  ${option.optionId} — ${option.title}`);
      for (const [label, values] of [
        ["Benefits", option.benefits],
        ["Costs", option.costs],
        ["Risks", option.risks],
        ["Consequences", option.consequences]
      ] as const) {
        if (values.length > 0) {
          writeLabeled(io, `    ${label}`, values.join("; "));
        }
      }
    }
  }
  if (card.recommendation !== null) {
    writeLabeled(
      io,
      "Recommendation",
      `${card.recommendation.optionId} — ${optionTitle(card.recommendation.optionId)}. ${card.recommendation.rationale}`
    );
  }
}

function renderCost(io: InteractiveIO, state: RunState, styler: Styler): void {
  const usage = state.metrics.usage;
  if (usage.costUsd === null) {
    return;
  }
  renderSection(io, styler, [`Cost: $${usage.costUsd.toFixed(2)}`]);
}

/**
 * A blocker reads red, a nit recedes, and everything between is a warning.
 * Colour is the only severity cue that survives skimming, so both the summary
 * list and triage take it from here rather than each deciding for itself.
 */
function severityTone(
  styler: Styler,
  severity: ReviewFinding["severity"]
): string {
  const text = reviewSeverityText(severity);
  if (severity === "blocker") {
    return styler.red(text);
  }
  return severity === "nit" ? styler.dim(text) : styler.yellow(text);
}

/** Lists a finding in full: nothing else in the summary says what it was. */
function renderFinding(
  io: InteractiveIO,
  styler: Styler,
  finding: ReviewFinding,
  width: number
): void {
  const severity = reviewSeverityText(finding.severity);
  const prefix = `  ${finding.id}  ${severity}  `;
  const lines = hangingLines(prefix, finding.summary, width);
  const [first, ...rest] = lines;
  io.writeLine(
    (first ?? prefix).replace(
      `${finding.id}  ${severity}`,
      `${styler.bold(finding.id)}  ${severityTone(styler, finding.severity)}`
    )
  );
  for (const line of rest) {
    io.writeLine(line);
  }
  const evidence = finding.evidence[0];
  if (evidence !== undefined) {
    io.writeLine(
      `${" ".repeat(prefix.length)}${styler.dim(
        `${evidence.path}${evidence.line === null ? "" : `:${evidence.line}`}`
      )}`
    );
  }
}

function renderStatus(
  io: InteractiveIO,
  status: WorkflowStatus,
  styler: Styler,
  humanTime?: HumanTimeSummary
): void {
  const state = status.state;
  const width = resolveWidth(io.width);
  const terminal = state.status === "done" || state.status === "cancelled";
  const mark =
    state.status === "done"
      ? styler.green("✓")
      : state.status === "cancelled" || state.status === "blocked"
        ? styler.red("✗")
        : styler.yellow("•");

  io.writeLine();
  io.writeLine(
    `${mark} ${styler.bold(runStatusText(state.status))}  ${state.slug}`
  );
  const facts = [
    state.workflowSelection == null
      ? null
      : `${state.workflowSelection.workflow} workflow`,
    state.metrics.reviews.full + state.metrics.reviews.delta === 0
      ? null
      : `${state.metrics.reviews.full + state.metrics.reviews.delta} review${state.metrics.reviews.full + state.metrics.reviews.delta === 1 ? "" : "s"}`,
    state.metrics.usage.inputTokens === 0
      ? null
      : formatUsage(
          state.metrics.usage.inputTokens,
          state.metrics.usage.cachedInputTokens,
          state.metrics.usage.outputTokens
        )
  ].filter((part) => part !== null);
  if (facts.length > 0) {
    io.writeLine(styler.dim(`  ${facts.join(" · ")}`));
  }
  io.writeLine(styler.dim(`  ${state.runId}`));
  const historical = historicalRunNotice(state);
  if (historical !== null) {
    renderSection(io, styler, ["History", historical]);
  }

  if (state.workflowSelection != null) {
    renderSection(io, styler, [
      "Why this workflow",
      state.workflowSelection.reason
    ]);
  }
  renderSection(io, styler, taskVerificationStatusLines(state));
  if (state.blockReason !== null) {
    renderSection(io, styler, ["Blocked", state.blockReason]);
  }
  if (
    state.status === "needs_adr_approval" ||
    state.status === "needs_plan_approval"
  ) {
    renderArtifacts(io, state, styler);
  }
  if (
    state.status === "needs_human_decision" &&
    state.pendingHumanDecision != null
  ) {
    if (state.pendingHumanDecision.kind === "configuration_prerequisite") {
      renderSection(
        io,
        styler,
        configurationDecisionLines(
          state.pendingHumanDecision,
          status.configurationPrerequisite
        )
      );
    } else if (state.pendingHumanDecision.kind !== "planning_review_triage")
      renderSection(io, styler, [
        "Decision needed",
        state.pendingHumanDecision.summary
      ]);
    if (state.pendingHumanDecision.kind === "decision_consultation") {
      for (const [
        index,
        card
      ] of state.pendingHumanDecision.request.decisions.entries()) {
        io.writeLine();
        renderConsultationCard(
          io,
          card,
          index + 1,
          state.pendingHumanDecision.request.decisions.length,
          false
        );
      }
    } else {
      for (const [index, question] of humanDecisionQuestions(
        state.pendingHumanDecision,
        (state.workflowSelection?.workflow ?? "strict") !== "strict"
      ).entries()) {
        for (const line of hangingLines(`  ${index + 1}. `, question, width)) {
          io.writeLine(line);
        }
      }
    }
  }

  renderSection(
    io,
    styler,
    planningReviewStatusLines(status).map(escapeTerminalText)
  );
  if (status.latestReview !== null && state.latestReview !== null) {
    io.writeLine();
    io.writeLine(
      `${styler.bold(`Review ${state.latestReview.iteration}`)}  ${reviewVerdictText(status.latestReview.verdict)}`
    );
    for (const line of wrapText(
      reviewExecutionText(
        state.latestReview.mode,
        state.latestReview.sessionMode,
        state.latestReview.rotationReason ?? null
      ),
      width,
      "  "
    )) {
      io.writeLine(styler.dim(line));
    }
    // The first line is the verdict, already rendered above as a heading; the
    // rest is the shared completion projection, which must not be re-derived
    // here or terminal triage can display as a reviewer pass.
    for (const line of reviewStatusLines(status).slice(1)) {
      io.writeLine(`  ${line}`);
    }
    io.writeLine();
    for (const line of wrapText(status.latestReview.summary, width, "  ")) {
      io.writeLine(line);
    }
    for (const finding of status.latestReview.findings) {
      io.writeLine();
      renderFinding(io, styler, finding, width);
    }
    if (state.latestReview.artifactPath !== undefined) {
      io.writeLine();
      io.writeLine(`  ${styler.dim("→")} ${state.latestReview.artifactPath}`);
    }
  }
  if (state.pendingReviewRotationReason !== null) {
    io.writeLine();
    for (const line of wrapText(
      pendingRotationText(state.pendingReviewRotationReason),
      width
    )) {
      io.writeLine(styler.dim(line));
    }
  }
  if (
    state.status === "blocked" &&
    status.recovery.eligible &&
    status.recovery.workspace !== null
  ) {
    renderSection(io, styler, ["Recovery available", status.recovery.reason]);
    if (status.recovery.sourceKind === "prerequisite_blocked_fix") {
      writeLabeled(
        io,
        "  Resolved accepted findings",
        status.recovery.resolvedFindingIds.join(", ")
      );
      writeLabeled(
        io,
        "  Remaining accepted findings",
        status.recovery.remainingFindingIds.join(", ")
      );
      for (const prerequisite of status.recovery.prerequisites) {
        writeLabeled(io, "  Operator prerequisite", prerequisite);
      }
    }
    io.writeLine(`  Identity: ${status.recovery.recoveryIdentity}`);
    io.writeLine(
      `  Authorization: ${status.recovery.authorization === "plan_approval" ? "current plan approval is valid" : "current lite workflow selection is valid"}`
    );
    io.writeLine(
      `  Workspace: added=${status.recovery.workspace.added}, modified=${status.recovery.workspace.modified}, deleted=${status.recovery.workspace.deleted}, total=${status.recovery.workspace.total}`
    );
    writeLabeled(io, "  Recovery warning", status.recovery.warning);
  } else if (
    state.status === "blocked" &&
    status.recovery.terminalCheckpointPresent === true
  ) {
    renderSection(io, styler, ["Terminal checkpoint", status.recovery.reason]);
  }
  if (
    state.status === "blocked" &&
    !status.retry.eligible &&
    !status.recovery.eligible &&
    status.recovery.terminalCheckpointPresent !== true
  ) {
    renderSection(io, styler, ["Retry unavailable", status.retry.reason]);
  }
  if (terminal) {
    renderCost(io, state, styler);
  }
  if (humanTime !== undefined) renderHumanTime(io, humanTime, false, styler);
}

async function confirmCancellation(
  runner: InteractiveRunner,
  io: InteractiveIO,
  runId: string
): Promise<boolean> {
  if (
    await io.confirm(
      "Cancel this run? The persisted run becomes terminal.",
      false
    )
  ) {
    const result = await runner.cancel({
      expectedRunId: runId,
      channel: "interactive"
    });
    for (const message of cancellationMessages(result)) io.writeLine(message);
    if (result.outcome !== "cancelled" || result.receipt === null) return true;
    try {
      const reason = await io.select<CancellationReason | null>(
        "Why did you cancel this run? (optional)",
        [
          { name: "Skip", value: null },
          { name: "Intent or scope changed", value: "intent_changed" },
          { name: "Architectural direction rejected", value: "adr_rejected" },
          { name: "Plan unsuitable", value: "plan_unsuitable" },
          {
            name: "Workflow or overhead unsuitable",
            value: "workflow_unsuitable"
          },
          {
            name: "Technical problem blocked progress",
            value: "execution_blocked"
          },
          {
            name: "Continue in another run or another way",
            value: "superseded"
          },
          { name: "Other known reason", value: "other" }
        ]
      );
      const saved = await runner.recordCancellationResponse(
        result.receipt,
        reason === null ? { state: "skipped" } : { state: "reported", reason }
      );
      io.writeLine(
        saved.outcome === "saved"
          ? reason === null
            ? "Cancellation reason skipped."
            : "Cancellation reason saved."
          : "Run cancelled. Cancellation reason was not saved."
      );
    } catch {
      await runner
        .recordCancellationResponse(result.receipt, { state: "interrupted" })
        .catch(() => undefined);
      io.writeLine("Run cancelled. No cancellation reason was saved.");
      return false;
    }
  }
  return true;
}

async function runWork(
  options: InteractiveOptions,
  operation: () => Promise<RunState>
): Promise<void> {
  if (options.attention === undefined) {
    await operation();
  } else {
    await options.attention.run(operation);
  }
}

async function startRun(
  runner: InteractiveRunner,
  io: InteractiveIO,
  options: InteractiveOptions
): Promise<boolean> {
  if (options.beforeStart !== undefined && !(await options.beforeStart()))
    return false;
  const request = (
    await io.input({
      message: "What should Banzai implement?",
      collapsedPaste: true,
      validate: nonEmpty
    })
  ).trim();
  const slug = generateFeatureSlug(request);
  io.writeLine(`Generated slug: ${slug}`);
  io.writeLine(`Request: ${request}`);
  if (
    await io.confirm("Start this task with automatic workflow selection?", true)
  ) {
    await runWork(options, () => runner.start({ slug, request }));
  }
  return true;
}

async function handleHumanDecision(
  runner: InteractiveRunner,
  io: InteractiveIO,
  status: WorkflowStatus,
  options: InteractiveOptions
): Promise<boolean> {
  const pending = status.state.pendingHumanDecision ?? null;
  if (pending === null) {
    throw new BanzaiError(
      "INVALID_STATE",
      "The run has no persisted human decision request."
    );
  }
  if (pending.kind === "configuration_prerequisite") {
    const action = await io.select("Verification configuration prerequisite", [
      {
        name: "Accept",
        value: "accept" as const,
        ...(status.configurationPrerequisite?.acceptUnavailable ||
        pending.proposal.profile.commands.length === 0
          ? {
              disabled:
                status.configurationPrerequisite?.acceptUnavailable ??
                "Edit the empty draft first"
            }
          : {})
      },
      { name: "Edit", value: "edit" as const },
      {
        name: "Skip",
        value: "skip" as const
      },
      { name: "Cancel", value: "cancel" as const },
      { name: "Exit and decide later", value: "exit" as const }
    ]);
    if (action === "exit") return false;
    const profile =
      action === "edit"
        ? {
            id: pending.proposal.profile.id,
            commands: await editVerificationCommands(
              io,
              pending.proposal.profile.commands
            )
          }
        : undefined;
    if (
      action === "accept" &&
      !(await io.confirm(
        "Apply this exact profile and continue to verification?",
        false
      ))
    )
      return true;
    if (
      action === "skip" &&
      !(await io.confirm(
        "Continue with repository hygiene only for this run while project types and verification configuration stay unchanged?",
        false
      ))
    )
      return true;
    if (
      action === "cancel" &&
      !(await io.confirm("Cancel this run and retain its work?", false))
    )
      return true;
    await runWork(options, () =>
      runner.answerConfigurationPrerequisite(
        {
          runId: pending.runId,
          decisionId: pending.decisionId,
          proposalId: pending.proposalId,
          action,
          ...(profile ? { profile } : {}),
          decidedBy: options.decidedBy
        },
        true
      )
    );
    return true;
  }
  if (pending.kind === "decision_consultation") {
    const answers: DecisionConsultationAnswer[] = [];
    for (const [index, card] of pending.request.decisions.entries()) {
      for (;;) {
        const choices: InteractiveChoice<ConsultationCardAction>[] = [];
        if (card.recommendation !== null) {
          choices.push({
            name: "Use recommendation",
            value: {
              kind: "option",
              optionId: card.recommendation.optionId
            }
          });
        }
        for (const option of card.options) {
          choices.push({
            name: `Choose ${option.title}`,
            value: { kind: "option", optionId: option.optionId },
            ...(option.consequences[0] === undefined
              ? {}
              : { description: option.consequences[0] })
          });
        }
        choices.push(
          {
            name: "Explain another preference",
            value: { kind: "preference" }
          },
          { name: "Inspect details", value: { kind: "details" } },
          {
            name: "Pause and decide later",
            value: { kind: "pause" }
          }
        );
        const action = await io.select<ConsultationCardAction>(
          `Decision ${index + 1}/${pending.request.decisions.length}: ${card.title}`,
          choices
        );
        if (action.kind === "details") {
          io.writeLine();
          renderConsultationCard(
            io,
            card,
            index + 1,
            pending.request.decisions.length,
            true
          );
          continue;
        }
        if (action.kind === "pause") {
          return false;
        }
        if (action.kind === "preference") {
          const text = await io.input({
            message: "Explain another preference",
            collapsedPaste: true,
            validate: nonEmpty
          });
          answers.push({
            decisionId: card.decisionId,
            response: { kind: "preference", optionId: null, text },
            note: null
          });
        } else {
          const note = await io.input({
            message: "Note (optional)",
            collapsedPaste: true
          });
          answers.push({
            decisionId: card.decisionId,
            response: {
              kind: "option",
              optionId: action.optionId,
              text: null
            },
            note: note.trim().length === 0 ? null : note
          });
        }
        break;
      }
    }
    if (
      !(await io.confirm(
        "Submit all consultation answers and return to planning?",
        false
      ))
    ) {
      return false;
    }
    await runWork(options, () =>
      runner.answerDecisionConsultation(
        {
          runId: status.state.runId,
          requestId: pending.request.requestId,
          roundId: pending.request.roundId,
          answers,
          decidedBy: options.decidedBy
        },
        true
      )
    );
    return true;
  }
  const liteWorkflow =
    status.state.workflowSelection?.workflow === "feature" ||
    status.state.workflowSelection?.workflow === "quick-fix";
  const action = await io.select<PrimaryAction>("Human decision", [
    {
      name: liteWorkflow
        ? "Answer and reselect the workflow"
        : "Answer and return to planning",
      value: "answer_human"
    },
    { name: "Cancel run", value: "cancel" },
    { name: "Exit and decide later", value: "exit" }
  ]);
  if (action === "answer_human") {
    const questions = humanDecisionQuestions(pending, liteWorkflow);
    const answers: string[] = [];
    for (const question of questions) {
      answers.push(
        (
          await io.input({
            message: question,
            validate: nonEmpty
          })
        ).trim()
      );
    }
    if (
      await io.confirm(
        liteWorkflow
          ? "Record these answers, invalidate the lite workflow authorization, and select again?"
          : "Record these answers, invalidate the old plan approval, and replan?",
        false
      )
    ) {
      await runWork(options, () =>
        runner.answerHumanDecision(
          { answers, decidedBy: options.decidedBy },
          true
        )
      );
    }
    return true;
  }
  if (action === "cancel") {
    return await confirmCancellation(
      runner,
      options.cancellationIO ?? io,
      status.state.runId
    );
  }
  return false;
}

function planningTextValidation(
  maximum: number,
  optional = false
): (value: string) => true | string {
  return (value) => {
    if (optional && value.trim() === "") return true;
    if (value.trim() === "") return "A value is required.";
    try {
      validateHumanFreeText(value, "Planner instruction", maximum);
      return true;
    } catch (error) {
      return escapeTerminalText(errorMessage(error));
    }
  };
}
async function requestPlanningReviewUI(
  runner: InteractiveRunner,
  io: InteractiveIO,
  status: WorkflowStatus,
  options: InteractiveOptions
): Promise<boolean> {
  const base = options.cancellationIO ?? io;
  const scope = await base.select("Review scope", [
    { name: "Whole planning bundle", value: "whole" },
    { name: "Choose artifacts", value: "choose" }
  ]);
  const paths =
    scope === "whole"
      ? null
      : await base.multiSelect(
          "Artifacts to review",
          (status.planningReview?.reviewPaths ?? []).map((p) => ({
            name: escapeTerminalText(p),
            value: p
          })),
          (values) =>
            values.length > 0 ? true : "Choose at least one artifact."
        );
  if (
    await io.confirm(
      "Send the selected artifacts to the configured reviewer?",
      false
    )
  )
    await runWork(options, () =>
      runner.requestPlanningReview({
        paths,
        decidedBy: options.decidedBy,
        autoResume: true
      })
    );
  return true;
}
function renderPlanningTriage(
  io: InteractiveIO,
  finding: PlanningReviewTriageRequest["findings"][number],
  entry: PlanningReviewTriageRequest["analysis"][number]
): void {
  io.writeLine(
    `${escapeTerminalText(finding.id)}: ${reviewSeverityText(finding.severity)} / ${escapeTerminalText(finding.category)}`
  );
  io.writeLine(escapeTerminalText(finding.summary));
  for (const evidence of finding.evidence)
    io.writeLine(
      escapeTerminalText(
        `${evidence.path}${evidence.line === null ? "" : `:${evidence.line}`}: ${evidence.detail}`
      )
    );
  io.writeLine(
    `Suggested resolution: ${escapeTerminalText(finding.suggestedResolution)}`
  );
  io.writeLine(
    `Assessment: ${escapeTerminalText(entry.assessment)}. ${escapeTerminalText(entry.rationale)}`
  );
  for (const option of entry.options) {
    io.writeLine(
      `${escapeTerminalText(option.label)} (${escapeTerminalText(option.optionId)})`
    );
    for (const consequence of option.consequences)
      io.writeLine(`  ${escapeTerminalText(consequence)}`);
  }
  if (entry.recommendation !== null)
    io.writeLine(
      `Advisory recommendation: ${escapeTerminalText(entry.recommendation.optionId)}. ${escapeTerminalText(entry.recommendation.rationale)}`
    );
}
async function handlePlanningTriage(
  runner: InteractiveRunner,
  io: InteractiveIO,
  pending: PlanningReviewTriageRequest,
  options: InteractiveOptions
): Promise<boolean> {
  io.writeLine(
    `Planning-review triage: ${escapeTerminalText(pending.artifactPath)}`
  );
  const dispositions: PlanningReviewDisposition[] = [];
  for (const finding of pending.findings) {
    const entry = pending.analysis.find((a) => a.findingId === finding.id);
    if (entry === undefined)
      throw new BanzaiError(
        "INVALID_STATE",
        "Planning finding analysis is missing."
      );
    renderPlanningTriage(io, finding, entry);
    const action = await io.select(
      `Disposition for ${escapeTerminalText(entry.findingId)}`,
      [
        ...entry.options.map((option) => ({
          name: `${escapeTerminalText(option.label)}${entry.recommendation?.optionId === option.optionId ? " (recommended)" : ""}`,
          value: `option:${option.optionId}`
        })),
        { name: "Write my own instruction", value: "instruction" },
        { name: "Decline (no change)", value: "decline" },
        { name: "Exit and decide later", value: "exit" }
      ]
    );
    if (action === "exit") return false;
    const instruction =
      action === "instruction"
        ? await io.input({
            message: `Your instruction for ${escapeTerminalText(entry.findingId)}`,
            validate: planningTextValidation(2000)
          })
        : null;
    dispositions.push(
      action.startsWith("option:")
        ? {
            findingId: entry.findingId,
            kind: "option",
            optionId: action.slice(7),
            instruction: null
          }
        : action === "instruction"
          ? {
              findingId: entry.findingId,
              kind: "instruction",
              optionId: null,
              instruction: instruction ?? ""
            }
          : {
              findingId: entry.findingId,
              kind: "decline",
              optionId: null,
              instruction: null
            }
    );
  }
  const additional = await io.input({
    message: "Additional instruction for the planner (optional)",
    validate: planningTextValidation(8000, true)
  });
  io.writeLine(
    `Planning-review triage: options=${dispositions.filter((d) => d.kind === "option").length}, own=${dispositions.filter((d) => d.kind === "instruction").length}, declined=${dispositions.filter((d) => d.kind === "decline").length}`
  );
  if (
    await io.confirm(
      `Record this planning-review triage as ${escapeTerminalText(options.decidedBy)}?`,
      false
    )
  )
    await runWork(options, () =>
      runner.answerPlanningReview({
        answer: {
          runId: pending.runId,
          episodeId: pending.episodeId,
          reviewNumber: pending.reviewNumber,
          analysisDigest: pending.analysisDigest,
          dispositions,
          additionalInstruction: additional.trim() === "" ? null : additional
        },
        decidedBy: options.decidedBy,
        autoResume: true
      })
    );
  return true;
}

async function handleAdr(
  runner: InteractiveRunner,
  io: InteractiveIO,
  status: WorkflowStatus,
  options: InteractiveOptions
): Promise<boolean> {
  const artifacts = status.state.planArtifacts?.adrs ?? [];
  let artifact: string | null = null;
  if (artifacts.length === 1) {
    artifact = artifacts[0] ?? null;
  } else if (artifacts.length > 1) {
    artifact = await io.select(
      "Choose the ADR to decide",
      artifacts.map((candidate) => ({ name: candidate, value: candidate }))
    );
  }
  const id =
    artifact === null
      ? (
          await io.input({
            message: "ADR id",
            validate: nonEmpty
          })
        ).trim()
      : adrIdFromArtifact(artifact);
  const decision = await io.select<AdrAction>(`Decision for ${id}`, [
    { name: "Accept", value: "accept" },
    { name: "Reject", value: "reject" },
    { name: "Request rework", value: "rework" },
    ...(status.planningReview?.decisions.includes("review")
      ? [
          {
            name: "Request independent review",
            value: "planning_review" as const
          }
        ]
      : []),
    { name: "Exit without deciding", value: "exit" }
  ]);
  if (decision === "exit") {
    return false;
  }
  if (decision === "planning_review")
    return requestPlanningReviewUI(runner, io, status, options);
  const noteValue = await io.input({
    message:
      decision === "rework"
        ? "Rework feedback for the planner"
        : "Decision note (optional)",
    ...(decision === "rework" ? { validate: planningTextValidation(8000) } : {})
  });
  const note = noteValue.trim().length === 0 ? null : noteValue.trim();
  io.writeLine(`${id}: ${decision}`);
  if (
    await io.confirm(
      `Record this ADR decision as ${options.decidedBy} and continue planning?`,
      false
    )
  ) {
    await runWork(options, () =>
      runner.decideAdr({
        id,
        decision,
        note,
        decidedBy: options.decidedBy,
        autoResume: true
      })
    );
  }
  return true;
}

/**
 * The same rule the phase banners draw, so a triage step reads as part of the
 * same interface: identity at the head, position at the tail, dim rule between.
 */
function findingRule(
  styler: Styler,
  finding: ReviewFinding,
  position: string,
  width: number
): string {
  const head = `── ${finding.id} ${reviewSeverityText(finding.severity)} `;
  const tail = ` ${position} ──`;
  const rule = "─".repeat(Math.max(1, width - head.length - tail.length));
  return `${styler.dim("──")} ${styler.bold(finding.id)} ${severityTone(
    styler,
    finding.severity
  )} ${styler.dim(`${rule}${tail}`)}`;
}

async function findingDisposition(
  io: InteractiveIO,
  styler: Styler,
  finding: ReviewFinding,
  position: string
): Promise<FindingAction> {
  // Laid out for a decision rather than for scanning. The summary list is
  // several findings back by the time the second disposition is answered, so
  // identity leads and the prompt below is never answered blind. Each locator
  // takes its own line: it is the part a reader copies into an editor, and
  // giving it the line makes the implicated file set scannable while the
  // detail wraps at full width beneath it.
  const width = resolveWidth(io.width);
  io.writeLine();
  io.writeLine(findingRule(styler, finding, position, width));
  for (const line of wrapText(finding.summary, width, "  ")) {
    io.writeLine(line);
  }
  io.writeLine();
  for (const evidence of finding.evidence) {
    const location = `${evidence.path}${evidence.line === null ? "" : `:${evidence.line}`}`;
    io.writeLine(`  ${styler.cyan(location)}`);
    for (const line of wrapText(evidence.detail, width, "    ")) {
      io.writeLine(line);
    }
  }
  io.writeLine();
  io.writeLine(`  ${styler.bold("Resolved by")}`);
  for (const line of wrapText(finding.fixAcceptance, width, "    ")) {
    io.writeLine(line);
  }
  return await io.select<FindingAction>(`Disposition for ${finding.id}`, [
    { name: "Accept for fixing", value: "accepted" },
    { name: "Reject", value: "rejected" },
    { name: "Defer", value: "deferred" },
    { name: "Exit without saving triage", value: "exit" }
  ]);
}

async function handleTriage(
  runner: InteractiveRunner,
  io: InteractiveIO,
  status: WorkflowStatus,
  options: InteractiveOptions
): Promise<boolean> {
  const findings = status.latestReview?.findings ?? [];
  if (findings.length === 0) {
    throw new BanzaiError(
      "MISSING_REVIEW_FINDINGS",
      "Triage requires persisted review findings."
    );
  }
  const accepted: string[] = [];
  const rejected: string[] = [];
  const deferred: string[] = [];
  const styler = options.styler ?? createStyler(false);
  for (const [index, finding] of findings.entries()) {
    const disposition = await findingDisposition(
      io,
      styler,
      finding,
      `${index + 1} of ${findings.length}`
    );
    if (disposition === "exit") {
      return false;
    }
    if (disposition === "accepted") {
      accepted.push(finding.id);
    } else if (disposition === "rejected") {
      rejected.push(finding.id);
    } else {
      deferred.push(finding.id);
    }
  }
  const noteValue = await io.input({ message: "Triage note (optional)" });
  const note = noteValue.trim().length === 0 ? null : noteValue.trim();
  io.writeLine(
    `Triage: accept=${accepted.length}, reject=${rejected.length}, defer=${deferred.length}`
  );
  if (
    await io.confirm(
      `Record this triage as ${options.decidedBy} and continue?`,
      false
    )
  ) {
    await runWork(options, () =>
      runner.triage(
        { accepted, rejected, deferred, note, decidedBy: options.decidedBy },
        true
      )
    );
  }
  return true;
}

async function handleStatus(
  runner: InteractiveRunner,
  io: InteractiveIO,
  status: WorkflowStatus,
  options: InteractiveOptions
): Promise<boolean> {
  const state = status.state;
  if (state.status === "done" || state.status === "cancelled") {
    const action = await io.select<PrimaryAction>("What next?", [
      { name: "Start a new run", value: "start" },
      { name: "Exit", value: "exit" }
    ]);
    if (action === "start") {
      return await startRun(runner, io, options);
    }
    return false;
  }

  // A non-terminal historical run refuses every gate and continuation.
  if (historicalRunNotice(state) !== null) {
    const action = await io.select<PrimaryAction>("What next?", [
      { name: "Cancel run", value: "cancel" },
      { name: "Exit", value: "exit" }
    ]);
    if (action === "cancel") {
      return await confirmCancellation(
        runner,
        options.cancellationIO ?? io,
        state.runId
      );
    }
    return false;
  }

  if (state.status === "needs_plan_approval") {
    const prerequisites = await runner.getPlanHumanPrerequisites?.();
    if (prerequisites)
      io.writeLine(
        `Human prerequisites:\n${escapeTerminalText(prerequisites)}`
      );
    const action = await io.select<PrimaryAction>("Plan decision", [
      { name: "Approve plan and continue", value: "approve_plan" },
      ...(status.planningReview?.decisions.includes("rework")
        ? [{ name: "Request rework", value: "rework_plan" as const }]
        : []),
      ...(status.planningReview?.decisions.includes("review")
        ? [
            {
              name: "Request independent review",
              value: "planning_review" as const
            }
          ]
        : []),
      { name: "Cancel run", value: "cancel" },
      { name: "Exit and decide later", value: "exit" }
    ]);
    if (action === "planning_review")
      return requestPlanningReviewUI(runner, io, status, options);
    if (action === "rework_plan") {
      const feedback = await io.input({
        message: "Rework feedback for the planner",
        validate: planningTextValidation(8000)
      });
      if (
        await io.confirm(
          `Record this plan rework request as ${escapeTerminalText(options.decidedBy)} and return to planning?`,
          false
        )
      )
        await runWork(options, () =>
          runner.reworkPlan({
            feedback,
            decidedBy: options.decidedBy,
            autoResume: true
          })
        );
      return true;
    }
    if (action === "approve_plan") {
      if (
        await io.confirm(
          `Approve this exact artifact bundle as ${options.decidedBy}?`,
          false
        )
      ) {
        await runWork(options, () =>
          runner.approvePlan(options.decidedBy, true)
        );
      }
      return true;
    }
    if (action === "cancel") {
      return await confirmCancellation(
        runner,
        options.cancellationIO ?? io,
        status.state.runId
      );
    }
    return false;
  }

  if (state.status === "needs_human_decision") {
    if (state.pendingHumanDecision?.kind === "planning_review_triage")
      return handlePlanningTriage(
        runner,
        io,
        state.pendingHumanDecision,
        options
      );
    return status.state.pendingHumanDecision?.kind ===
      "configuration_prerequisite"
      ? runner.withConfigurationDecisionOwnership(() =>
          handleHumanDecision(runner, io, status, options)
        )
      : handleHumanDecision(runner, io, status, options);
  }

  if (state.status === "needs_adr_approval") {
    return await handleAdr(runner, io, status, options);
  }

  if (state.status === "needs_triage") {
    return await handleTriage(runner, io, status, options);
  }

  if (state.status === "blocked") {
    const choices: InteractiveChoice<PrimaryAction>[] = [];
    const invalidCompletion =
      state.planTaskCompletion?.status === "invalid"
        ? state.planTaskCompletion
        : null;
    const isPlanBundleRepair =
      invalidCompletion !== null &&
      (invalidCompletion.violation === "approved_plan_invalid" ||
        invalidCompletion.violation === "approval_invalid");
    const isCompletionEvidenceRepair =
      !isPlanBundleRepair &&
      (state.blockedFrom === "implementing" ||
        state.blockedFrom === "verifying" ||
        state.blockedFrom === "fixing") &&
      status.retry.attemptId !== null &&
      invalidCompletion !== null &&
      invalidCompletion.sourceAttemptId === status.retry.attemptId;
    const isDigestRejectedRepair =
      status.recovery.eligible &&
      status.recovery.sourceKind === "digest_rejected";
    if (isDigestRejectedRepair) {
      // Replaying the rejected evidence reproduces the rejection, so the
      // authorized repair is the offered route (ADR-0051).
      choices.push({
        name: "Authorize a replacement attempt for the rejected result",
        value: "recover"
      });
    } else if (status.retry.eligible) {
      choices.push({
        name:
          status.planningReview?.active?.step === "reviewing"
            ? "Retry planning review"
            : status.planningReview?.active?.step === "analyzing"
              ? "Retry planning analysis"
              : status.planningReview?.latest?.outcome === "stale"
                ? "Retry planning review"
                : status.retry.attemptId === null
                  ? state.blockedFrom === "reviewing"
                    ? "Retry review checks"
                    : "Retry start checks"
                  : isPlanBundleRepair
                    ? "Rerun planning to correct the approved plan"
                    : isCompletionEvidenceRepair
                      ? "Repair plan-task completion evidence"
                      : state.blockedFrom === "planning"
                        ? "Continue the failed planning attempt"
                        : "Retry the failed read-only attempt",
        value: "retry"
      });
    } else if (status.recovery.eligible) {
      choices.push({
        name:
          status.recovery.sourceKind === "prerequisite_blocked_fix"
            ? "Recover the remaining accepted findings"
            : "Recover from this exact partial workspace",
        value: "recover"
      });
    } else if (status.recovery.terminalCheckpointPresent === true) {
      choices.push({
        name: "Resume the proven terminal result",
        value: "resume"
      });
    }
    const restore = await runner.restoreEligibility();
    if (restore.eligible) {
      choices.push({
        name: "Restore the approved planning artifacts",
        value: "restore"
      });
    }
    choices.push(
      { name: "Cancel run", value: "cancel" },
      { name: "Exit", value: "exit" }
    );
    const action = await io.select("Blocked run action", choices);
    if (action === "resume") {
      if (
        await io.confirm("Reconcile the durable terminal checkpoint?", true)
      ) {
        await runWork(options, () => runner.resume());
      }
      return true;
    }
    if (action === "retry") {
      const message =
        status.retry.attemptId === null
          ? state.blockedFrom === "reviewing"
            ? "Rerun preflight and review checks?"
            : "Rerun preflight and the repository check?"
          : isPlanBundleRepair
            ? "Rerun planning and request a new plan approval?"
            : isCompletionEvidenceRepair
              ? "Repair plan-task completion evidence in a fresh attempt?"
              : state.blockedFrom === "planning"
                ? "Run preflight and continue planning, reusing saved context when compatible?"
                : "Run preflight and start a fresh retry?";
      if (await io.confirm(message, false)) {
        await runWork(options, () => runner.retry());
      }
      return true;
    }
    if (action === "restore") {
      if (
        await io.confirm(
          "Rewrite the approved artifact paths with the exact approved bytes?",
          false
        )
      ) {
        await runner.restoreApproval();
      }
      return true;
    }
    if (action === "recover") {
      if (
        status.recovery.attemptId === null ||
        status.recovery.recoveryIdentity === null ||
        status.recovery.workspace === null
      ) {
        throw new BanzaiError(
          "RECOVERY_STATUS_INVALID",
          "Recovery eligibility is missing its exact attempt, identity, or workspace summary."
        );
      }
      writeLabeled(io, "Recovery warning", status.recovery.warning);
      io.writeLine(`Recovery identity: ${status.recovery.recoveryIdentity}`);
      const confirmation =
        status.recovery.sourceKind === "prerequisite_blocked_fix"
          ? "Confirm the displayed prerequisites are addressed and authorize one new fix attempt for only the remaining accepted findings in this exact workspace?"
          : status.recovery.sourceKind === "digest_rejected"
            ? "Authorize one linked attempt to supply a corrected result for the rejected phase, keeping the rejected attempt and its result as evidence?"
            : "Authorize one new recovery attempt for this exact workspace and accept that repository or external side effects may be partial or duplicated?";
      if (await io.confirm(confirmation, false)) {
        const { attemptId, recoveryIdentity } = status.recovery;
        await runWork(options, () =>
          runner.recover(
            {
              attemptId,
              recoveryIdentity,
              unknownSideEffectsAccepted: true,
              decidedBy: options.decidedBy
            },
            true
          )
        );
      }
      return true;
    }
    if (action === "cancel") {
      return await confirmCancellation(
        runner,
        options.cancellationIO ?? io,
        status.state.runId
      );
    }
    return false;
  }

  const action = await io.select<PrimaryAction>(
    `Run is ${runStatusText(state.status).toLowerCase()}`,
    [
      { name: "Resume from persisted state", value: "resume" },
      { name: "Cancel run", value: "cancel" },
      { name: "Exit", value: "exit" }
    ]
  );
  if (action === "resume") {
    if (
      await io.confirm(
        `Resume ${runStatusText(state.status).toLowerCase()}?`,
        true
      )
    ) {
      await runWork(options, () => runner.resume());
    }
    return true;
  }
  if (action === "cancel") {
    return await confirmCancellation(
      runner,
      options.cancellationIO ?? io,
      status.state.runId
    );
  }
  return false;
}

const VERSION = packageManifest.version;

const SHORT_ROLE_LABELS: Record<ModelRole, string> = {
  planner: "plan",
  implementer: "impl",
  reviewer: "review"
};

/** One configured vendor's readiness, with the roles a failure would block. */
interface VendorAuthentication {
  executable: string;
  roles: string;
  reason: string | null;
}

/**
 * Checks every vendor the configuration actually uses, once each, before any
 * phase runs. A vendor whose session expired is reported at launch instead of
 * failing a run that has already spent planning and implementation time.
 */
async function checkAuthentication(
  config: OrchestratorConfig,
  auth: AuthenticationGateway | undefined
): Promise<VendorAuthentication[]> {
  if (auth === undefined) {
    return [];
  }
  const usage = vendorUsage(config).filter((entry) => entry.vendor !== null);
  const reasons = await Promise.all(
    usage.map(async (entry) => {
      try {
        return await auth.check(entry.settings);
      } catch (error) {
        return errorMessage(error);
      }
    })
  );
  return usage.map((entry, index) => ({
    executable: entry.executable,
    roles: describeRoles(entry.roles),
    reason: reasons[index] ?? null
  }));
}

/**
 * The launch header: what is running, where, and against which models. It
 * replaces a thirteen-line model-and-authentication report with one line per
 * phase, because at launch the only authentication fact worth a paragraph is a
 * failing one.
 */
function renderHeader(
  io: InteractiveIO,
  styler: Styler,
  repoRoot: string,
  identity: RepositoryIdentity | null,
  config: OrchestratorConfig | null,
  authentication: readonly VendorAuthentication[]
): void {
  const dim = (value: string): string => styler.dim(value);
  io.writeLine();
  io.writeLine(`${styler.brand(styler.bold("banzai"))} ${dim(`v${VERSION}`)}`);
  const location = [
    path.basename(repoRoot),
    identity?.branch == null ? null : styler.cyan(identity.branch),
    identity?.commit == null ? null : dim(`@ ${identity.commit.slice(0, 7)}`),
    identity === null || identity.carriedInChanges === 0
      ? null
      : dim(
          `${identity.carriedInChanges} carried-in change${identity.carriedInChanges === 1 ? "" : "s"}`
        )
  ].filter((part) => part !== null);
  io.writeLine(location.join(dim(" · ")));
  if (config === null) {
    return;
  }

  const readiness = new Map(
    authentication.map((entry) => [entry.executable, entry.reason])
  );
  const entries = configuredModels(config);
  const roleWidth = Math.max(
    ...entries.map((entry) => SHORT_ROLE_LABELS[entry.role].length)
  );
  const vendorWidth = Math.max(
    ...entries.map((entry) => path.basename(entry.executable).length)
  );
  const modelWidth = Math.max(...entries.map((entry) => entry.model.length));
  const effortWidth = Math.max(...entries.map((entry) => entry.effort.length));
  const timeoutWidth = Math.max(
    ...entries.map((entry) => entry.timeout.length)
  );
  io.writeLine();
  for (const entry of entries) {
    const reason = readiness.get(entry.executable);
    const marker =
      reason === undefined
        ? ""
        : reason === null
          ? styler.green("✓")
          : styler.red("✗");
    // Leave no trailing gap when no gateway supplied a readiness marker.
    const readinessCell =
      marker === ""
        ? ""
        : `${" ".repeat(timeoutWidth - entry.timeout.length + 2)}${marker}`;
    io.writeLine(
      `  ${SHORT_ROLE_LABELS[entry.role].padEnd(roleWidth)}  ${path
        .basename(entry.executable)
        .padEnd(vendorWidth)} ${styler.bold(entry.model)}${" ".repeat(
        modelWidth - entry.model.length
      )}  ${dim(`${entry.effort.padEnd(effortWidth)} · ${entry.timeout}`)}${readinessCell}`
    );
  }

  // One notice for every blocked vendor, not one per role that shares it.
  const failures = authentication.filter((entry) => entry.reason !== null);
  if (failures.length === 0) {
    return;
  }
  io.writeLine();
  renderNotice(io, styler, styler.red, [
    ...failures.map(
      (entry) => `${entry.executable} (${entry.roles}): ${entry.reason ?? ""}`
    ),
    "Every phase re-checks this; resolve it before starting a run."
  ]);
}

/** A left-ruled block for advisories and blockers, echoing the CLI convention. */
function renderNotice(
  io: InteractiveIO,
  styler: Styler,
  tone: (value: string) => string,
  lines: readonly string[]
): void {
  const width = resolveWidth(io.width);
  for (const line of lines) {
    for (const wrapped of wrapText(line, width - 2)) {
      io.writeLine(`${tone("│")} ${styler.enabled ? tone(wrapped) : wrapped}`);
    }
  }
}

async function chooseModelUpdates(
  io: InteractiveIO,
  advisories: readonly ModelAdvisory[]
): Promise<ModelUpdate[]> {
  const action = await io.select<ModelUpdateAction>("Model configuration", [
    {
      name: `Update ${advisories.length === 1 ? "this model" : `all ${advisories.length} models`} in .banzai/config.json`,
      value: "update_all"
    },
    { name: "Choose which models to update", value: "update_some" },
    { name: "Keep the current configuration", value: "keep" }
  ]);
  if (action === "keep") {
    return [];
  }
  const selected =
    action === "update_all"
      ? [...advisories]
      : await filterModelUpdates(io, advisories);
  return selected.map((advisory) => ({
    role: advisory.role,
    model: advisory.replacement
  }));
}

async function filterModelUpdates(
  io: InteractiveIO,
  advisories: readonly ModelAdvisory[]
): Promise<ModelAdvisory[]> {
  const selected: ModelAdvisory[] = [];
  for (const advisory of advisories) {
    if (
      await io.confirm(
        `${advisory.label}: replace ${advisory.model} with ${advisory.replacement}?`,
        false
      )
    ) {
      selected.push(advisory);
    }
  }
  return selected;
}

async function presentLaunch(
  runner: InteractiveRunner,
  io: InteractiveIO,
  options: InteractiveOptions
): Promise<void> {
  const styler = options.styler ?? createStyler(false);
  const gateway = options.models;
  const identity = await describeRepository(options);
  let config: OrchestratorConfig | null = null;
  let loadError: string | null = null;
  if (gateway !== undefined) {
    try {
      config = await gateway.load();
    } catch (error) {
      loadError = errorMessage(error);
    }
  }
  const authentication =
    config === null ? [] : await checkAuthentication(config, options.auth);
  renderHeader(io, styler, runner.repoRoot, identity, config, authentication);
  if (loadError !== null) {
    io.writeLine();
    io.writeLine(`Model configuration unavailable: ${loadError}`);
    return;
  }
  if (gateway === undefined) {
    return;
  }
  if (config === null) {
    io.writeLine();
    io.writeLine(
      "No .banzai/config.json found. Run `banzai init` to configure models."
    );
    return;
  }

  const advisories = modelAdvisories(config);
  if (advisories.length === 0) {
    return;
  }

  io.writeLine();
  renderNotice(io, styler, styler.yellow, [
    advisories.length === 1
      ? "A newer model is available:"
      : "Newer models are available:",
    ...advisories.map((advisory) => `${advisory.label}: ${advisory.detail}`)
  ]);

  const status = await statusOrNull(runner);
  const activeRun =
    status !== null &&
    status.state.status !== "done" &&
    status.state.status !== "cancelled";
  if (activeRun) {
    io.writeLine(
      `Run ${status.state.runId} is still ${status.state.status}. Finish or cancel it before changing models.`
    );
    return;
  }

  const updates = await chooseModelUpdates(io, advisories);
  if (updates.length === 0) {
    io.writeLine("Keeping the current model configuration.");
    return;
  }
  if (
    !(await io.confirm(
      `Write ${updates.length === 1 ? "this change" : `these ${updates.length} changes`} to .banzai/config.json?`,
      false
    ))
  ) {
    io.writeLine("Keeping the current model configuration.");
    return;
  }
  try {
    await gateway.applyModelUpdates(updates);
  } catch (error) {
    io.writeLine(`Model configuration was not updated: ${errorMessage(error)}`);
    return;
  }
  io.writeLine("Updated .banzai/config.json. Review and commit the change.");
}

function humanTimeDuration(milliseconds: number | null): string {
  if (milliseconds === null) return "Unavailable";
  if (milliseconds === 0) return "0s";
  if (milliseconds < 1000) return "<1s";
  const seconds = Math.round(milliseconds / 1000);
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) {
    const remainder = seconds % 60;
    const minutes = `${Math.floor(seconds / 60)}m`;
    return remainder === 0 ? minutes : `${minutes} ${remainder}s`;
  }
  const minutes = Math.round(milliseconds / 60000);
  const remainder = minutes % 60;
  const hours = `${Math.floor(minutes / 60)}h`;
  return remainder === 0 ? hours : `${hours} ${remainder}m`;
}

function humanTimeEstimateStatus(
  summary: HumanTimeSummary | undefined
): "missing" | "saved" | "unavailable" {
  if (
    summary?.revision == null ||
    summary.issues.some((issue) => issue.code === "CONFLICTING_EFFORT")
  )
    return "unavailable";
  return summary.effort === null ? "missing" : "saved";
}

function humanTimeEstimateValue(summary: HumanTimeSummary): string {
  if (humanTimeEstimateStatus(summary) === "unavailable") return "Unavailable";
  if (summary.effort === null) return "Not added · optional";
  return `${summary.effort.minutes} min · Self-reported · one person`;
}

function humanTimeResponseSubtotal(summary: HumanTimeSummary): string {
  if (summary.answeredCount === 0) {
    return summary.inventory === "unavailable"
      ? "Unavailable · no recorded response durations"
      : "No answered responses recorded";
  }
  const timed = summary.episodes.filter(
    (episode) =>
      episode.kind !== "recovery_wait" &&
      episode.outcome === "answered" &&
      !episode.provisional &&
      episode.durationMs !== null
  ).length;
  const responses = summary.answeredCount === 1 ? "response" : "responses";
  return `${humanTimeDuration(summary.answeredMs)} · ${timed} of ${summary.answeredCount} answered ${responses} timed`;
}

function writeHumanTimeRow(
  io: InteractiveIO,
  label: string,
  body: string
): void {
  for (const line of hangingLines(
    `  ${label.padEnd(23)} `,
    body,
    resolveWidth(io.width)
  ))
    io.writeLine(line);
}

function writeHumanTimeNote(
  io: InteractiveIO,
  text: string,
  styler: Styler
): void {
  for (const line of wrapText(text, resolveWidth(io.width), "  "))
    io.writeLine(styler.dim(line));
}

const HUMAN_TIME_EXPLANATIONS: Record<HumanTimeIssueCode, string> = {
  MISSING_EVIDENCE:
    "Some timing evidence is missing; affected durations are unavailable.",
  INVALID_EVIDENCE: "Could not read or validate the timing evidence.",
  UNSUPPORTED_VERSION: "The recording uses an unsupported version.",
  AMBIGUOUS_ANCHOR: "A decision could not be matched to its recording.",
  CONFLICTING_ENDPOINTS:
    "Conflicting timestamps prevent timing some decisions.",
  CONFLICTING_EFFORT:
    "Active time estimates conflict; review the evidence before editing.",
  CAPTURE_GAP: "Recorded waits only · coverage may be incomplete",
  CLOCK_DISCONTINUITY:
    "Some durations are unavailable because clock continuity failed.",
  LIMIT_EXCEEDED:
    "Timing evidence exceeds supported limits; totals may be unavailable.",
  UNSAFE_PATH: "Could not access the timing evidence safely.",
  STALE_REVISION:
    "The estimate changed before it could be saved. Reopen the time editor before retrying.",
  WRITE_CONTENDED:
    "Another timing write is in progress. Reopen the time editor and retry.",
  WRITE_FAILED:
    "Reopen the time editor to review current evidence before trying again."
};

function renderHumanTimeIssues(
  io: InteractiveIO,
  summary: HumanTimeSummary,
  styler: Styler
): void {
  const codes = new Set(summary.issues.map((issue) => issue.code));
  for (const code of codes) {
    if (code === "CAPTURE_GAP") continue;
    if (
      code === "MISSING_EVIDENCE" &&
      summary.revision === 0 &&
      summary.inventory === "unavailable"
    )
      continue;
    if (["STALE_REVISION", "WRITE_CONTENDED", "WRITE_FAILED"].includes(code))
      io.writeLine(styler.red("Time was not saved"));
    writeLabeled(io, "Timing evidence", HUMAN_TIME_EXPLANATIONS[code]);
  }
  if (summary.revision === null && codes.size === 0)
    writeLabeled(
      io,
      "Timing evidence",
      "Unavailable · the recording could not be read."
    );
}

function renderHumanTimeEpisode(
  io: InteractiveIO,
  episode: HumanTimeEpisode,
  sequence: number,
  allAnswered: boolean
): void {
  const names: Record<HumanTimeEpisode["kind"], string> = {
    plan_approval: "Plan approval",
    adr_approval: "ADR decision",
    decision_consultation: "Decision consultation",
    escalation: "Escalation",
    triage: "Review triage",
    planning_review_triage: "Planning-review triage",
    recovery_wait: "Recovery waiting"
  };
  const outcomes: Record<HumanTimeEpisode["outcome"], string> = {
    answered: "answered",
    open: "open",
    incomplete: "incomplete evidence",
    cancelled: "cancelled",
    superseded: "superseded",
    recovery_ended: "ended"
  };
  const parts = [humanTimeDuration(episode.durationMs)];
  if (!allAnswered) parts.push(outcomes[episode.outcome]);
  if (episode.provisional) parts.push("provisional");
  if (episode.continuity === "unverified")
    parts.push("clock continuity unverified");
  if (episode.continuity === "discontinuity") parts.push("clock discontinuity");
  writeHumanTimeRow(
    io,
    `${sequence}. ${names[episode.kind]}`,
    parts.join(" · ")
  );
}

function renderHumanTimeDetails(
  io: InteractiveIO,
  summary: HumanTimeSummary,
  styler: Styler
): void {
  io.writeLine(styler.bold("Time details · this run"));
  writeHumanTimeRow(
    io,
    "Active time estimate",
    humanTimeEstimateValue(summary)
  );
  if (summary.effort !== null && humanTimeEstimateStatus(summary) === "saved") {
    writeHumanTimeRow(io, "Estimate as of", summary.effort.asOf);
    writeHumanTimeNote(io, "Later work does not update this estimate.", styler);
  }
  io.writeLine();
  io.writeLine(styler.bold("Recorded decisions"));
  const decisions = summary.episodes.filter(
    (episode) => episode.kind !== "recovery_wait"
  );
  const allAnswered =
    decisions.length > 0 &&
    decisions.every(
      (episode) => episode.outcome === "answered" && !episode.provisional
    );
  if (allAnswered)
    writeHumanTimeNote(io, "All recorded decisions are answered.", styler);
  if (decisions.length === 0)
    writeHumanTimeNote(
      io,
      "No decision episodes recorded; timing coverage is not established.",
      styler
    );
  for (const [index, episode] of summary.episodes.entries()) {
    if (episode.kind !== "recovery_wait")
      renderHumanTimeEpisode(io, episode, index + 1, allAnswered);
  }
  writeHumanTimeRow(
    io,
    "Recorded-response subtotal",
    humanTimeResponseSubtotal(summary)
  );
  writeHumanTimeNote(io, HUMAN_TIME_EXPLANATIONS.CAPTURE_GAP, styler);
  writeHumanTimeNote(
    io,
    `${summary.answeredCount} answered · ${summary.openCount} open · ${summary.otherCount} other outcomes · ${summary.unavailableCount} unavailable decision durations`,
    styler
  );
  writeHumanTimeNote(
    io,
    "Open and provisional waits do not count as completed responses.",
    styler
  );

  if (
    summary.recoveryUnknown ||
    summary.episodes.some((episode) => episode.kind === "recovery_wait")
  ) {
    io.writeLine();
    io.writeLine(styler.bold("Recovery waiting"));
    for (const [index, episode] of summary.episodes.entries()) {
      if (episode.kind === "recovery_wait")
        renderHumanTimeEpisode(io, episode, index + 1, false);
    }
    if (summary.recoveryUnknown)
      writeHumanTimeNote(
        io,
        "Recovery start or endpoint is unavailable.",
        styler
      );
    writeHumanTimeNote(
      io,
      "Recovery waits are separate from answered responses and their subtotal.",
      styler
    );
  }
  renderHumanTimeIssues(io, summary, styler);
  renderHumanTimeRecordingNotes(io, summary, styler);
}

function renderHumanTimeRecordingNotes(
  io: InteractiveIO,
  summary: HumanTimeSummary,
  styler: Styler
): void {
  io.writeLine();
  io.writeLine(styler.bold("Recording and attribution"));
  writeHumanTimeNote(
    io,
    "Decision waits include time away; they do not measure active work.",
    styler
  );
  writeHumanTimeNote(io, "Durations use UTC timestamps.", styler);
  if (
    summary.episodes.some(
      (episode) => episode.continuity === "process_correlated"
    )
  ) {
    const allCorrelated = summary.episodes.every(
      (episode) => episode.continuity === "process_correlated"
    );
    writeHumanTimeNote(
      io,
      allCorrelated
        ? "Clock continuity was checked within one recording process."
        : "Clock continuity was checked within one process for rows without a clock warning.",
      styler
    );
  }
  writeHumanTimeNote(
    io,
    "Clock checks do not verify identity or active work.",
    styler
  );
  writeHumanTimeNote(
    io,
    "The active-time value is a self-reported estimate for one person; identity is not verified. Work by other contributors is not represented; a complete task total is not established.",
    styler
  );
  if (summary.issues.length > 0) {
    io.writeLine();
    writeHumanTimeNote(io, "Timing diagnostics", styler);
    for (const code of new Set(summary.issues.map((issue) => issue.code)))
      writeHumanTimeNote(io, code, styler);
  }
}

function renderHumanTime(
  io: InteractiveIO,
  summary: HumanTimeSummary,
  details = false,
  styler: Styler = createStyler(false)
): void {
  io.writeLine();
  if (details) {
    renderHumanTimeDetails(io, summary, styler);
    return;
  }
  io.writeLine(styler.bold("Time for this run"));
  writeHumanTimeRow(
    io,
    "Active time estimate",
    humanTimeEstimateValue(summary)
  );
  writeHumanTimeRow(
    io,
    "Waiting for decisions",
    humanTimeResponseSubtotal(summary)
  );
  writeHumanTimeNote(
    io,
    "Decision waits include time away; they do not measure active work.",
    styler
  );
  writeHumanTimeNote(io, HUMAN_TIME_EXPLANATIONS.CAPTURE_GAP, styler);
  const coverage = [];
  if (summary.openCount > 0) coverage.push(`${summary.openCount} open`);
  if (summary.otherCount > 0)
    coverage.push(`${summary.otherCount} other outcomes`);
  if (summary.unavailableCount > 0)
    coverage.push(`${summary.unavailableCount} unavailable decision durations`);
  if (coverage.length > 0) writeHumanTimeNote(io, coverage.join(" · "), styler);
  if (summary.recoveryUnknown)
    writeHumanTimeRow(
      io,
      "Recovery waiting",
      "Start or endpoint unavailable · see time details"
    );
  else if (summary.episodes.some((episode) => episode.kind === "recovery_wait"))
    writeHumanTimeRow(
      io,
      "Recovery waiting",
      "Recorded separately in time details"
    );
  renderHumanTimeIssues(io, summary, styler);
}

async function editHumanTime(
  io: InteractiveIO,
  gateway: HumanTimeGateway,
  runId: string
): Promise<void> {
  const summary = await gateway.readSummary(runId);
  if (
    summary.revision === null ||
    humanTimeEstimateStatus(summary) === "unavailable"
  ) {
    io.writeLine("Time was not saved");
    writeLabeled(
      io,
      "Active time estimate",
      "Unavailable · review the timing evidence before editing."
    );
    renderHumanTimeIssues(io, summary, createStyler(false));
    writeLabeled(
      io,
      "Next step",
      "Reopen the time editor after checking the current evidence."
    );
    return;
  }
  writeHumanTimeNote(
    io,
    "Include preparation, approvals, review, active checks, debugging, manual repair and recovery, including work outside the CLI.",
    createStyler(false)
  );
  writeHumanTimeNote(
    io,
    "Exclude passive waiting, time assigned to other runs or tasks, other contributors' work, and study-recording overhead.",
    createStyler(false)
  );
  writeHumanTimeNote(
    io,
    "This replaces your cumulative active time estimate for this run. Leave blank to keep the previous value; enter 0 to save zero. Decision waits are never used as active effort.",
    createStyler(false)
  );
  if (summary.effort !== null)
    writeLabeled(
      io,
      "Previous estimate",
      `${summary.effort.minutes} min, as of ${summary.effort.asOf}`
    );
  const validate = (value: string): true | string => {
    if (value.trim() === "") return true;
    const minutes = Number(value);
    return Number.isFinite(minutes) &&
      minutes >= 0 &&
      Number.isFinite(minutes * 60000)
      ? true
      : "Enter a finite, non-negative number of minutes, or leave blank.";
  };
  const value = await io.input({
    message: "Your total active minutes for this run so far",
    validate
  });
  if (value.trim() === "") return;
  const validation = validate(value);
  if (validation !== true) {
    io.writeLine(validation);
    return;
  }
  const result = await gateway.setEstimate(
    runId,
    summary.revision,
    Number(value)
  );
  if ("issue" in result) {
    io.writeLine("Time was not saved");
    writeHumanTimeNote(
      io,
      HUMAN_TIME_EXPLANATIONS[result.issue],
      createStyler(false)
    );
  }
}

function renderMenuSeparator(io: InteractiveIO, styler: Styler): void {
  io.writeLine();
  io.writeLine(styler.dim("─".repeat(resolveWidth(io.width))));
  io.writeLine();
}

function withRunMenu(
  io: InteractiveIO,
  gateway: HumanTimeGateway | undefined,
  runId: string,
  styler: Styler = createStyler(false)
): InteractiveIO {
  type TimeAction = "human_time_update" | "human_time_details";
  return {
    get width() {
      return io.width;
    },
    input: (options) => io.input(options),
    multiSelect: (message, choices, validate) =>
      io.multiSelect(message, choices, validate),
    confirm: (message, defaultValue) => io.confirm(message, defaultValue),
    writeLine: (message) => {
      io.writeLine(message);
    },
    async select<T>(
      message: string,
      choices: readonly InteractiveChoice<T>[],
      signal?: AbortSignal
    ): Promise<T> {
      if (gateway === undefined) {
        renderMenuSeparator(io, styler);
        return await io.select(message, choices, signal);
      }
      while (true) {
        let summary: HumanTimeSummary | undefined;
        try {
          summary = await gateway.readSummary(runId);
        } catch (error) {
          if (isPromptExit(error)) throw error;
        }
        const estimateLabels = {
          missing: "Add active time estimate (optional)",
          saved: "Edit active time estimate",
          unavailable: "Review active time estimate (unavailable)"
        };
        const items: InteractiveChoice<T | TimeAction>[] = [...choices];
        const exit = items.reduce(
          (last, choice, index) =>
            /^(Exit|Pause)\b/.test(choice.name) ? index : last,
          -1
        );
        items.splice(
          exit < 0 ? items.length : exit,
          0,
          {
            name: estimateLabels[humanTimeEstimateStatus(summary)],
            value: "human_time_update"
          },
          { name: "View time details", value: "human_time_details" }
        );
        renderMenuSeparator(io, styler);
        const action = await io.select(message, items, signal);
        if (action !== "human_time_update" && action !== "human_time_details")
          return action;
        try {
          if (action === "human_time_update")
            await editHumanTime(io, gateway, runId);
          renderHumanTime(
            io,
            await gateway.readSummary(runId),
            action === "human_time_details",
            styler
          );
        } catch (error) {
          if (isPromptExit(error)) throw error;
          if (action === "human_time_update")
            io.writeLine("Time was not saved");
          writeLabeled(
            io,
            "Timing evidence",
            "Unavailable · return to this menu and try again."
          );
        }
      }
    }
  };
}

async function interactiveLoop(
  runner: InteractiveRunner,
  io: InteractiveIO,
  options: InteractiveOptions
): Promise<void> {
  await presentLaunch(runner, io, options);
  while (true) {
    const status = await statusOrNull(runner);
    if (status === null) {
      io.writeLine();
      io.writeLine("No active repository-local run.");
      renderMenuSeparator(io, options.styler ?? createStyler(false));
      const action = await io.select<PrimaryAction>("What next?", [
        { name: "Start a new run", value: "start" },
        { name: "Exit", value: "exit" }
      ]);
      if (action === "exit") {
        return;
      }
      if (!(await startRun(runner, io, options))) return;
      continue;
    }
    let humanTime: HumanTimeSummary | undefined;
    if (options.humanTime !== undefined) {
      try {
        await options.humanTime.attach(status.state.runId);
        humanTime = await options.humanTime.readSummary(status.state.runId);
      } catch {
        io.writeLine("Time was not saved");
      }
    }
    renderStatus(io, status, options.styler ?? createStyler(false), humanTime);
    const decisionIO = withRunMenu(
      io,
      options.humanTime,
      status.state.runId,
      options.styler ?? createStyler(false)
    );
    if (
      !(await handleStatus(runner, decisionIO, status, {
        ...options,
        cancellationIO: io
      }))
    ) {
      return;
    }
  }
}

export async function runInteractive(
  runner: InteractiveRunner,
  io: InteractiveIO,
  options: InteractiveOptions
): Promise<void> {
  try {
    await interactiveLoop(runner, io, options);
  } catch (error) {
    if (!isPromptExit(error)) {
      throw error;
    }
    io.writeLine();
    io.writeLine("Interactive session closed. Run state was not changed.");
  } finally {
    try {
      await options.humanTime?.detach();
    } catch {
      io.writeLine("Time was not saved");
    }
  }
}
