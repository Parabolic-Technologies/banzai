import { validateHumanFreeText } from "./validation.js";
import { mkdir, writeFile } from "node:fs/promises";
import {
  executeVerificationCli,
  parseVerificationArgs
} from "./verification-cli.js";
import {
  configurationDecisionLines,
  taskVerificationStatusLines
} from "./verification-ui.js";
import { InteractiveHumanTime } from "./interactive-human-time.js";
import {
  CANCELLATION_HELP,
  cancellationCapabilities,
  cancellationMessages,
  parseCancellationArgs,
  parseCancellationReportArgs,
  executeCancellationReport
} from "./cancellation-cli.js";
import { HumanTimeStore } from "./human-time-store.js";
import process from "node:process";
import packageManifest from "../package.json" with { type: "json" };
import {
  createVendorAdapters,
  resolveClaudeInvocationScope
} from "./adapters.js";
import {
  claudePermissionRemediation,
  inspectConfiguredClaudePermissions
} from "./claude-permissions.js";
import {
  executeAgentControlCapabilities,
  executeAgentControlCommand,
  parseVerificationApprovalArgs,
  parseAgentControlArgs,
  type AgentControlCliIO
} from "./agent-control-cli.js";
import { colorDepth, colorEnabled, createStyler } from "./ansi.js";
import { resolveCliMode, stripGlobalFlags } from "./cli-routing.js";
import { executeVersionCli } from "./version-cli.js";
import { applyModelUpdates, initializeConfig, loadConfig } from "./config.js";
import {
  executeContextReportWithOptions,
  parseContextReportArgs
} from "./context-report-cli.js";
import { executeDoctor, parseDoctorArgs } from "./doctor-cli.js";
import { BanzaiError, errorMessage } from "./errors.js";
import { executeEvaluationExport } from "./evaluation-cli.js";
import {
  executeEvaluationKpiFromCheckout,
  executeEvaluationKpiFromInputs,
  parseEvaluationKpiArgs
} from "./evaluation-kpi-cli.js";
import {
  escapeTerminalText,
  formatUsage,
  hangingLines,
  labeledLines,
  resolveWidth
} from "./format.js";
import {
  changedRepositoryPaths,
  currentBranch,
  currentCommit,
  discoverRepositoryRoot
} from "./git.js";
import { InquirerInteractiveIO } from "./inquirer-io.js";
import { createInterruptHandler } from "./interrupt.js";
import {
  executeLiveCompatibility,
  parseLiveCompatibilityArgs
} from "./live-compatibility-cli.js";
import {
  pendingRotationText,
  reviewExecutionText,
  reviewSeverityText,
  runStatusGloss
} from "./vocabulary.js";
import {
  runInteractive,
  type AuthenticationGateway,
  type ModelConfigurationGateway,
  type RepositoryIdentity,
  type RepositoryIdentityGateway
} from "./interactive.js";
import { selectModelSettings } from "./model-selection.js";
import { vendorFor } from "./models.js";
import { resolveProgressLevel, TerminalProgressReporter } from "./progress.js";
import {
  forceTerminateActiveProcesses,
  shutdownActiveProcesses
} from "./process.js";
import { releaseHeldRunnerLocksSync, RunStore } from "./store.js";
import { inspectProjectAdoption } from "./project-adoption.js";
import {
  renderProjectAdoption,
  runProjectSetup,
  SETUP_PLUGIN_PREREQUISITE
} from "./project-setup.js";
import { TerminalAttention } from "./terminal-attention.js";
import type {
  OrchestratorConfig,
  ReviewFinding,
  RunState,
  VendorAdapters
} from "./types.js";
import {
  defaultDecisionMaker,
  historicalRunNotice,
  reviewStatusLines,
  planningReviewStatusLines,
  WorkflowRunner,
  type WorkflowStatus
} from "./workflow.js";

import { ProjectFileError, safePath } from "./project-files.js";
import { ensureExecutionIgnores } from "./work-documents.js";
import { VERIFICATION_EXAMPLES } from "./init-resources.js";

function authenticationGateway(
  adapters: VendorAdapters
): AuthenticationGateway {
  return {
    async check(settings): Promise<string | null> {
      // Dispatch on the executable the role actually runs, not on the role.
      const vendor = vendorFor(settings.executable);
      if (vendor === null) {
        return null;
      }
      try {
        if (vendor === "claude") {
          await adapters.preflightClaude(settings);
        } else {
          await adapters.preflightCodex(settings);
        }
        return null;
      } catch (error) {
        return errorMessage(error);
      }
    }
  };
}

/**
 * Names the Claude permission gap that would stop the first planning phase
 * while the operator is still setting the project up. It only reads: granting
 * the rule stays the operator's decision.
 */
async function reportClaudePermissionGaps(
  repoRoot: string,
  config: OrchestratorConfig
): Promise<void> {
  const permissions = await inspectConfiguredClaudePermissions(
    repoRoot,
    config,
    { resolveScope: resolveClaudeInvocationScope }
  );
  if (
    permissions.state !== "audited" ||
    permissions.audit.blocking.length === 0
  ) {
    return;
  }
  console.log(`Claude permissions: ${permissions.audit.blocking.join(" ")}`);
  console.log(
    `Fix it before the first run: ${claudePermissionRemediation(permissions.audit)}.`
  );
}

function modelConfigurationGateway(
  repoRoot: string
): ModelConfigurationGateway {
  return {
    async load(): Promise<OrchestratorConfig | null> {
      try {
        return await loadConfig(repoRoot);
      } catch (error) {
        if (error instanceof BanzaiError && error.code === "CONFIG_NOT_FOUND") {
          return null;
        }
        throw error;
      }
    },
    async applyModelUpdates(updates): Promise<void> {
      await applyModelUpdates(repoRoot, updates);
    }
  };
}

/**
 * Header facts only. Each is read independently so a detached HEAD or an
 * unreadable index costs that one field rather than the whole header.
 */
function repositoryIdentityGateway(
  repoRoot: string
): RepositoryIdentityGateway {
  return {
    async describe(): Promise<RepositoryIdentity> {
      const [branch, commit, changed] = await Promise.all([
        currentBranch(repoRoot).catch(() => null),
        currentCommit(repoRoot).catch(() => null),
        changedRepositoryPaths(repoRoot).catch(() => [])
      ]);
      return { branch, commit, carriedInChanges: changed.length };
    }
  };
}

const HELP = `Banzai v${packageManifest.version} local cross-vendor workflow runner

Usage:
  banzai --version | -v
  banzai --plugin-version | -pv
  banzai
  banzai interactive
  banzai init
  banzai setup
  banzai doctor [--json]
  banzai control capabilities [--cancellation]
  banzai control status
  banzai control start --slug <kebab-case>
  banzai control answer [--by <name>] [--no-resume]
  banzai control decide [--by <name>] [--no-resume]
  banzai control recover [--by <name>] [--no-resume]
  banzai model
  banzai run --slug <kebab-case> --request <text>
  banzai status [--json]
  banzai eval export [--json] [--from <RFC3339>] [--to <RFC3339>] [--run <run-id>]...
  banzai eval kpi [--json] [--from <RFC3339>] [--to <RFC3339>] [--run <run-id>]...
  banzai eval context [--json] [--from <RFC3339>] [--to <RFC3339>] [--run <run-id>]...
  banzai eval cancellations [--json] [--from <RFC3339>] [--to <RFC3339>] [--run <run-id>]...
  banzai eval kpi --input <export.json> [--input <export.json>]... [--json]
  banzai compatibility live --confirm-live
  banzai resume
  banzai retry
  banzai restore
  banzai recover
  banzai approve plan [--by <name>] [--no-resume]
  banzai approve plan --decision rework --note <text> [--by <name>] [--no-resume]
  banzai review planning [--artifact <path> ...] [--by <name>] [--no-resume]
  banzai verify add <type> | edit <id> | remove <id> | list | check
  banzai approve verification [--by <name>] [--no-resume]
  banzai approve adr --id <id> --decision <accept|reject|rework> [--note <text>] [--by <name>] [--no-resume]
  banzai triage --accept <ids> --reject <ids> --defer <ids> [--note <text>] [--by <name>] [--no-resume]
  banzai cancel [--run <run-id>] [--reason <enum>]

Progress verbosity applies to any command that runs a phase:
  --quiet     phase boundaries, failures, and runner messages only
  --verbose   every model action, started and finished
  --metrics   also print attempt, session, and review counters
Default is one settled line per finished action. \`BANZAI_PROGRESS\` sets the
same levels (quiet|normal|verbose) and an explicit flag wins over it.
On a terminal, a live status line reports the running phase until it settles.

Finding lists are comma-separated. Pass an empty string for an empty list.
Run without arguments in a terminal for interactive mode.
\`banzai model\` picks the model and effort for each phase and needs a terminal.
Within the ADR and plan gates, rework returns to planning with required feedback; requested independent planning review uses human planning-review triage. Neither action grants approval.
Five existing human decision gates remain distinct: conditional planning consultation,
ADR acceptance, plan approval, escalation, and review triage. Consultation
records preference provenance; it is not approval or execution authority.
New tasks use task-scoped verification without profiles, bootstrap, or a
configuration-prerequisite gate. Legacy configuration commands and answer formats
remain explicit utilities; they do not authorize continuation of historical runs.
The legacy \`banzai approve verification\` command reads a closed \`banzai-agent-answer/v3\` document.
\`banzai control decide\` reads \`banzai-agent-gate-decision/v1\` from direct stdin.
\`banzai control answer\` reads \`banzai-agent-answer/v4\` planning-review triage, \`banzai-agent-answer/v3\` configuration, keyed
\`banzai-agent-answer/v2\` consultation, or ordered \`banzai-agent-answer/v1\` escalation document from direct stdin.
The runner uses the current checkout and never creates or manages Git worktrees.`;

function option(args: string[], name: string): string | null {
  const index = args.indexOf(name);
  if (index === -1) {
    return null;
  }
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new BanzaiError("MISSING_OPTION", `${name} requires a value.`);
  }
  return value;
}

function requireOption(args: string[], name: string): string {
  const value = option(args, name);
  if (value === null) {
    throw new BanzaiError("MISSING_OPTION", `Missing required option ${name}.`);
  }
  return value;
}

function listOption(args: string[], name: string): string[] {
  const value = option(args, name);
  if (value === null || value.trim().length === 0) {
    return [];
  }
  return [
    ...new Set(
      value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    )
  ];
}

/** Writes `Label: body`, wrapping to the terminal when the body is prose. */
function printLabeled(label: string, body: string): void {
  for (const line of labeledLines(
    label,
    body,
    resolveWidth(process.stdout.columns)
  )) {
    console.log(line);
  }
}

function printFinding(finding: ReviewFinding): void {
  const body = `${finding.summary} (${finding.evidence[0]?.path ?? "no evidence path"})`;
  for (const line of hangingLines(
    `${finding.id} [${reviewSeverityText(finding.severity)}] `,
    body,
    resolveWidth(process.stdout.columns)
  )) {
    console.log(line);
  }
}

/**
 * Attempt, session, and review counters are operator telemetry: precise, and
 * the three lines a newcomer most reliably misreads. They stay one flag away
 * rather than leading every command's output.
 */
export function parsePlanGateArgs(args: readonly string[]): {
  decision: "approve" | "rework";
  note: string | null;
  by: string | null;
  autoResume: boolean;
} {
  const options = exactPlanningOptions(args, false);
  const decision = options.decision ?? "approve";
  if (decision !== "approve" && decision !== "rework")
    throw new BanzaiError(
      "INVALID_DECISION",
      "Plan decision must be approve or rework."
    );
  if (decision === "approve" && options.note !== null)
    throw new BanzaiError(
      "INVALID_DECISION",
      "--note is accepted only with --decision rework."
    );
  if (
    decision === "rework" &&
    (options.note === null || options.note.trim().length === 0)
  )
    throw new BanzaiError(
      "INVALID_DECISION",
      "Plan rework requires a non-empty --note."
    );
  const note =
    options.note === null
      ? null
      : validateHumanFreeText(options.note, "Plan rework feedback", 8000);
  return { decision, note, by: options.by, autoResume: options.autoResume };
}
function exactPlanningOptions(
  args: readonly string[],
  review: boolean
): {
  decision: string | null;
  note: string | null;
  by: string | null;
  autoResume: boolean;
  paths: string[];
} {
  const result = {
    decision: null as string | null,
    note: null as string | null,
    by: null as string | null,
    autoResume: true,
    paths: [] as string[]
  };
  const seen = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (
      flag === undefined ||
      !(
        review
          ? ["--artifact", "--by", "--no-resume"]
          : ["--decision", "--note", "--by", "--no-resume"]
      ).includes(flag) ||
      (seen.has(flag) && flag !== "--artifact")
    )
      throw new BanzaiError(
        "INVALID_COMMAND",
        "Unknown, repeated or positional planning command argument."
      );
    seen.add(flag);
    if (flag === "--no-resume") {
      result.autoResume = false;
      continue;
    }
    const value = args[++i];
    if (flag === "--note" && (value === undefined || value.startsWith("--"))) {
      result.note = "";
      i--;
      continue;
    }
    if (value === undefined || value.startsWith("--"))
      throw new BanzaiError(
        flag === "--note" ? "INVALID_DECISION" : "INVALID_COMMAND",
        flag === "--note"
          ? "Plan rework requires a non-empty --note."
          : "Planning command option requires a value."
      );
    if (flag === "--artifact") result.paths.push(value);
    else if (flag === "--by")
      result.by = validateHumanFreeText(value, "Decision owner", 500);
    else if (flag === "--note") result.note = value;
    else result.decision = value;
  }
  return result;
}
function parsePlanningReviewArgs(args: readonly string[]): {
  paths: string[] | null;
  by: string | null;
  autoResume: boolean;
} {
  if (args[0] !== "planning")
    throw new BanzaiError("INVALID_COMMAND", "Review target must be planning.");
  const options = exactPlanningOptions(args.slice(1), true);
  return {
    paths: options.paths.length === 0 ? null : options.paths,
    by: options.by,
    autoResume: options.autoResume
  };
}

function printState(status: WorkflowStatus, metrics = false): void {
  const { state, nextAction } = status;
  console.log(`Run: ${state.runId}`);
  console.log(`Feature: ${state.slug}`);
  const gloss = runStatusGloss(state.status);
  console.log(`Status: ${state.status}${gloss === null ? "" : ` (${gloss})`}`);
  const historical = historicalRunNotice(state);
  if (historical !== null) printLabeled("History", historical);
  const completion = status.taskCompletion;
  const count =
    completion.completed === null
      ? completion.total === null
        ? completion.state
        : `${completion.state}/${completion.total}`
      : `${completion.completed}/${completion.total ?? "?"}`;
  console.log(`Plan tasks: ${count} (${completion.source})`);
  for (const diagnostic of completion.diagnostics) {
    printLabeled(
      "Plan task evidence",
      `[${diagnostic.code}]${diagnostic.taskId === null ? "" : ` ${diagnostic.taskId}`} ${diagnostic.message}`
    );
  }
  if (state.workflowSelection != null) {
    printLabeled(
      "Workflow",
      `${state.workflowSelection.workflow} (${state.workflowSelection.reason})`
    );
  }
  for (const line of taskVerificationStatusLines(state)) console.log(line);
  if (state.blockReason !== null) {
    printLabeled("Blocked", state.blockReason);
  }
  if (status.recovery.eligible && status.recovery.workspace !== null) {
    printLabeled("Recovery", status.recovery.reason);
    if (status.recovery.sourceKind === "prerequisite_blocked_fix") {
      console.log(
        `Resolved accepted findings: ${status.recovery.resolvedFindingIds.join(", ")}`
      );
      console.log(
        `Remaining accepted findings: ${status.recovery.remainingFindingIds.join(", ")}`
      );
      for (const prerequisite of status.recovery.prerequisites) {
        printLabeled("Operator prerequisite", prerequisite);
      }
    }
    console.log(`Recovery identity: ${status.recovery.recoveryIdentity}`);
    console.log(
      `Recovery authorization: ${status.recovery.authorization === "plan_approval" ? "current plan approval is valid" : "current lite workflow selection is valid"}`
    );
    console.log(
      `Recovery workspace: added=${status.recovery.workspace.added}, modified=${status.recovery.workspace.modified}, deleted=${status.recovery.workspace.deleted}, total=${status.recovery.workspace.total}`
    );
    printLabeled("Recovery warning", status.recovery.warning);
  } else if (status.recovery.terminalCheckpointPresent === true) {
    printLabeled("Terminal checkpoint", status.recovery.reason);
  }
  if (state.configurationSetup?.coverage === "skipped")
    console.log(
      `Substantive coverage skipped for this run: ${state.configurationSetup.uncoveredTypes.join(", ")}. Recorded hygiene results: ${state.verification.length}.`
    );
  if (state.pendingHumanDecision?.kind === "configuration_prerequisite") {
    for (const line of configurationDecisionLines(
      state.pendingHumanDecision,
      status.configurationPrerequisite
    ))
      console.log(line);
  } else if (
    state.pendingHumanDecision != null &&
    state.pendingHumanDecision.kind !== "planning_review_triage"
  ) {
    printLabeled("Decision needed", state.pendingHumanDecision.summary);
    for (const question of state.pendingHumanDecision.kind === "escalation"
      ? state.pendingHumanDecision.questions
      : state.pendingHumanDecision.request.decisions.map(
          (decision) => decision.question
        )) {
      printLabeled("Question", question);
    }
  }
  for (const line of planningReviewStatusLines(status))
    console.log(escapeTerminalText(line));
  for (const line of reviewStatusLines(status)) {
    console.log(line);
  }
  if (state.latestReview?.artifactPath !== undefined) {
    console.log(`Review artifact: ${state.latestReview.artifactPath}`);
  }
  if (state.latestReview !== null) {
    printLabeled(
      "Review execution",
      reviewExecutionText(
        state.latestReview.mode,
        state.latestReview.sessionMode,
        state.latestReview.rotationReason ?? null
      )
    );
  }
  for (const finding of status.latestReview?.findings ?? []) {
    printFinding(finding);
  }
  if (state.pendingReviewRotationReason !== null) {
    printLabeled(
      "Next review",
      pendingRotationText(state.pendingReviewRotationReason)
    );
  }
  if (nextAction === "banzai retry") {
    console.log(
      state.blockedFrom === "created"
        ? "Next: resolve the startup prerequisite, then run `banzai retry`."
        : "Next: resolve the external failure, then run `banzai retry`."
    );
  } else if (nextAction === "banzai recover") {
    console.log(
      "Next: inspect the exact checkout and warning above, then run `banzai recover` in a terminal."
    );
  } else if (nextAction === "banzai cancel") {
    console.log(
      "Next: inspect the checkout and attempt logs, then run `banzai cancel`."
    );
  } else if (state.status === "needs_adr_approval") {
    console.log(
      "Next: review the proposed ADRs, then run `banzai approve adr ...`."
    );
  } else if (state.status === "needs_plan_approval") {
    console.log(
      "Next: review the plan artifacts, then run `banzai approve plan`."
    );
  } else if (state.status === "needs_human_decision") {
    console.log(
      state.pendingHumanDecision?.kind === "planning_review_triage"
        ? "Next: answer in banzai in a terminal or send banzai-agent-answer/v4 to banzai control answer."
        : "Next: run `banzai` in a terminal to answer the pending decision and continue."
    );
  } else if (state.status === "needs_triage") {
    console.log("Next: triage every finding with `banzai triage ...`.");
  } else if (nextAction !== null) {
    console.log(`Next: run \`${nextAction}\`.`);
  }
  if (metrics) {
    console.log(
      `Attempts: selection=${state.metrics.attempts.selection ?? 0}, plan=${state.metrics.attempts.plan}, implementation=${state.metrics.attempts.implementation}, fix=${state.metrics.attempts.fix}, review=${state.metrics.attempts.review}, planning_review=${state.metrics.attempts.planning_review ?? 0}, planning_analysis=${state.metrics.attempts.planning_analysis ?? 0}`
    );
    console.log(
      `Sessions: fresh=${state.metrics.sessions.fresh}, resumed=${state.metrics.sessions.resumed}`
    );
    console.log(
      `Reviews: full=${state.metrics.reviews.full}, delta=${state.metrics.reviews.delta}, rotations=${state.metrics.reviews.rotations}`
    );
  }
  const usage = state.metrics.usage;
  if (usage.inputTokens > 0 || usage.outputTokens > 0) {
    console.log(
      `Tokens: ${formatUsage(usage.inputTokens, usage.cachedInputTokens, usage.outputTokens)}${usage.costUsd === null ? "" : ` · $${usage.costUsd.toFixed(2)}`}`
    );
  }
}

async function printRunnerState(
  runner: WorkflowRunner,
  metrics: boolean
): Promise<void> {
  printState(await runner.status(), metrics);
}

async function activeRunState(
  runner: WorkflowRunner
): Promise<RunState | null> {
  try {
    return (await runner.status()).state;
  } catch (error) {
    if (error instanceof BanzaiError && error.code === "NO_ACTIVE_RUN") {
      return null;
    }
    throw error;
  }
}

/**
 * Runs the model picker and writes the result. Returns false when the terminal
 * cannot host the dialog, so callers can degrade instead of failing.
 */
async function runModelPicker(
  repoRoot: string,
  interactiveTerminal: boolean,
  configCreated = false
): Promise<boolean> {
  if (!interactiveTerminal) {
    return false;
  }
  const io = new InquirerInteractiveIO();
  const config = await loadConfig(repoRoot);
  const updates = await selectModelSettings(io, config, configCreated);
  if (updates.length === 0) {
    return true;
  }
  await applyModelUpdates(repoRoot, updates);
  io.writeLine("Updated .banzai/config.json. Review and commit the change.");
  return true;
}

/**
 * The live status line owns the cursor's row while a phase runs, so it must be
 * erased before the process writes anything else or ends. Held here so both the
 * success and failure paths can close it exactly once.
 */
let activeProgress: TerminalProgressReporter | null = null;

function closeProgress(): void {
  activeProgress?.close();
  activeProgress = null;
}

/**
 * An interrupted prompt leaves raw mode on and the cursor hidden, and both
 * outlive the process. Restoring them is the difference between returning to a
 * usable shell and one that no longer echoes.
 */
function restoreTerminal(): void {
  if (process.stdin.isTTY && process.stdin.isRaw) {
    try {
      process.stdin.setRawMode(false);
    } catch {
      // The terminal is already gone; nothing left to restore.
    }
  }
  if (process.stderr.isTTY) {
    process.stderr.write("\u001b[?25h");
  }
}

function installSignalCleanup(settled?: Promise<void>): () => void {
  const handlers = new Map<NodeJS.Signals, () => void>();
  const interrupt = createInterruptHandler({
    closeProgress,
    restoreTerminal,
    write: (line) => {
      process.stderr.write(
        `${
          settled && line.startsWith("[banzai] Stopped.")
            ? "[banzai] Verification check stopped. Run banzai verify check to start again."
            : line
        }\n`
      );
    },
    shutdown: async (timeoutMs) => {
      const drained = await shutdownActiveProcesses(timeoutMs);
      await settled;
      return drained;
    },
    forceTerminate: forceTerminateActiveProcesses,
    releaseLocks: releaseHeldRunnerLocksSync,
    removeListeners: () => {
      for (const [registeredSignal, registeredHandler] of handlers) {
        process.removeListener(registeredSignal, registeredHandler);
      }
      handlers.clear();
    },
    raise: (signal) => {
      process.kill(process.pid, signal);
    },
    exit: (code) => {
      process.exit(code);
    },
    schedule: (handler, delayMs) => {
      const timer = setTimeout(handler, delayMs);
      return () => {
        clearTimeout(timer);
      };
    }
  });
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    const handler = (): void => {
      interrupt(signal);
    };
    handlers.set(signal, handler);
    process.on(signal, handler);
  }
  return () => {
    for (const [signal, handler] of handlers)
      process.removeListener(signal, handler);
  };
}

async function main(): Promise<void> {
  const invocation = process.argv.slice(2);
  if (
    await executeVersionCli(invocation, process.cwd(), (text) =>
      process.stdout.write(text)
    )
  )
    return;
  const progressLevel = resolveProgressLevel(invocation, process.env);
  const metrics = invocation.includes("--metrics");
  const args = stripGlobalFlags(invocation);
  const command = args[0];
  const cancellationInput =
    command === "cancel" ? parseCancellationArgs(args.slice(1)) : null;
  if (cancellationInput === "help") {
    console.log(CANCELLATION_HELP);
    return;
  }
  const planCommand =
    command === "approve" && args[1] === "plan"
      ? parsePlanGateArgs(args.slice(2))
      : null;
  const reviewCommand =
    command === "review" ? parsePlanningReviewArgs(args.slice(1)) : null;
  const controlCommand =
    command === "control"
      ? parseAgentControlArgs(args.slice(1))
      : command === "approve" && args[1] === "verification"
        ? parseVerificationApprovalArgs(args.slice(2))
        : null;
  const controlIO: AgentControlCliIO = {
    stdin: process.stdin,
    stdout: (value) => process.stdout.write(value)
  };
  const interactiveTerminal = process.stdin.isTTY && process.stdout.isTTY;
  const mode = resolveCliMode(args, process.stdin.isTTY, process.stdout.isTTY);
  if (mode === "help") {
    console.log(HELP);
    return;
  }
  if (mode === "tty_required") {
    throw new BanzaiError(
      "TTY_REQUIRED",
      "Interactive mode requires terminal input and output."
    );
  }

  if (controlCommand?.command === "capabilities") {
    if (controlCommand.cancellation === true)
      controlIO.stdout(
        `${JSON.stringify(cancellationCapabilities(), null, 2)}\n`
      );
    else executeAgentControlCapabilities(controlIO);
    return;
  }

  // Doctor owns an exact argument contract. Validate it before repository
  // discovery so invalid syntax has one stable diagnostic in every cwd.
  if (command === "doctor") {
    parseDoctorArgs(args.slice(1));
  }
  const verificationCommand =
    command === "verify" ? parseVerificationArgs(args.slice(1)) : null;
  if (command === "compatibility") {
    if (args[1] !== "live") {
      throw new BanzaiError(
        "INVALID_COMPATIBILITY_COMMAND",
        "Compatibility target must be `live`."
      );
    }
    parseLiveCompatibilityArgs(args.slice(2));
  }

  // Eval arguments are validated before repository discovery so invalid
  // syntax has one stable diagnostic in every cwd, and the pure `--input`
  // projection never requires a Git checkout at all.
  let evaluationKpiOptions: ReturnType<typeof parseEvaluationKpiArgs> | null =
    null;
  let contextReportOptions: ReturnType<typeof parseContextReportArgs> | null =
    null;
  let cancellationReportOptions: ReturnType<
    typeof parseCancellationReportArgs
  > | null = null;
  if (command === "eval") {
    if (
      args[1] !== "export" &&
      args[1] !== "kpi" &&
      args[1] !== "context" &&
      args[1] !== "cancellations"
    ) {
      throw new BanzaiError(
        "INVALID_EVAL_COMMAND",
        "Eval target must be `export`, `kpi`, `context`, or `cancellations`."
      );
    }
    if (args[1] === "kpi") {
      evaluationKpiOptions = parseEvaluationKpiArgs(args.slice(2));
      if (evaluationKpiOptions.inputs.length > 0) {
        await executeEvaluationKpiFromInputs(evaluationKpiOptions, {
          stdout: (value) => process.stdout.write(value),
          stderr: (value) => process.stderr.write(value)
        });
        return;
      }
    }
    if (args[1] === "context") {
      contextReportOptions = parseContextReportArgs(args.slice(2));
    }
    if (args[1] === "cancellations")
      cancellationReportOptions = parseCancellationReportArgs(args.slice(2));
  }

  let repoRoot: string;
  if (command === "doctor" || cancellationReportOptions !== null) {
    try {
      repoRoot = await discoverRepositoryRoot(process.cwd());
    } catch (error) {
      if (
        error instanceof BanzaiError &&
        (error.code === "GIT_FAILED" ||
          error.code === "GIT_REPOSITORY_REQUIRED")
      ) {
        throw new BanzaiError(
          "GIT_FAILED",
          cancellationReportOptions === null
            ? "Doctor requires a readable Git checkout."
            : "Cancellation reporting requires a readable Git checkout."
        );
      }
      throw error;
    }
  } else {
    repoRoot = await discoverRepositoryRoot(process.cwd());
  }
  if (command === "init") {
    if (
      [
        "BANZAI_RUN_ID",
        "BANZAI_APPROVAL_DIGEST",
        "BANZAI_WORKFLOW_DIGEST"
      ].some((name) => Object.hasOwn(process.env, name))
    )
      throw new BanzaiError(
        "CONFIGURATION_MODEL_WRITE_DENIED",
        "Model phases cannot initialize runner configuration. Record missing configuration in Human prerequisites."
      );
    const configDirectory = await safePath(repoRoot, ".banzai", {
      directory: true,
      missing: true
    });
    await mkdir(configDirectory, { recursive: true, mode: 0o700 });
    await safePath(repoRoot, ".banzai", { directory: true });
    await safePath(repoRoot, ".banzai/config.json", { missing: true });
    await safePath(repoRoot, ".gitignore", { missing: true });
    const examplesPath = await safePath(
      repoRoot,
      "documentation/verification-examples.md",
      { missing: true }
    );
    const initStore = new RunStore(repoRoot);
    const executionIgnoresUpdated = await ensureExecutionIgnores(repoRoot);
    const initLock = await initStore.acquireLock({ reclaimStale: false });
    let result;
    let examplesCreated = false;
    try {
      const activeId = await initStore.readActiveRunId();
      if (activeId) {
        const active = await initStore.readState(activeId);
        if (active.status !== "done" && active.status !== "cancelled")
          throw new BanzaiError(
            "CONFIGURATION_RUN_UNFINISHED",
            "An unfinished run retains its configuration checkpoint. Use banzai status and the supported verify repair path, then banzai resume."
          );
      }
      result = await initializeConfig(repoRoot);
      const documentationDirectory = await safePath(repoRoot, "documentation", {
        directory: true,
        missing: true
      });
      await mkdir(documentationDirectory, { recursive: true });
      await safePath(repoRoot, "documentation/verification-examples.md", {
        missing: true
      });
      try {
        await writeFile(examplesPath, VERIFICATION_EXAMPLES, {
          encoding: "utf8",
          flag: "wx"
        });
        examplesCreated = true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        await safePath(repoRoot, "documentation/verification-examples.md");
      }
    } finally {
      await initLock.release();
    }
    console.log(`Initialized Banzai in ${repoRoot}`);
    console.log(
      examplesCreated
        ? "Created documentation/verification-examples.md."
        : "Kept existing documentation/verification-examples.md."
    );
    console.log(
      result.configCreated
        ? "Created .banzai/config.json."
        : "Kept existing .banzai/config.json."
    );
    console.log(
      result.gitignoreUpdated || executionIgnoresUpdated
        ? "Updated .gitignore for local run state."
        : ".gitignore already covers local run state."
    );
    if (
      !(await runModelPicker(
        repoRoot,
        interactiveTerminal,
        result.configCreated
      ))
    ) {
      console.log(
        "Run `banzai model` in a terminal to choose the model and effort for each phase."
      );
    }
    const config = await loadConfig(repoRoot);
    console.log("Banzai configuration saved.\n");
    if (interactiveTerminal) {
      process.exitCode = await runProjectSetup(
        repoRoot,
        config,
        new InquirerInteractiveIO()
      );
    } else {
      const guidance = await inspectProjectAdoption(repoRoot);
      renderProjectAdoption(new InquirerInteractiveIO(), guidance);
      if (guidance.classification !== "ready")
        console.log(
          `Run banzai setup in a terminal, or explicitly invoke banzai:project-manifest in your installed client. ${SETUP_PLUGIN_PREREQUISITE}`
        );
    }
    console.log(
      "Verification follows each task; no profile setup is required."
    );
    await reportClaudePermissionGaps(repoRoot, config);
    console.log(
      "Run banzai doctor, then review and commit your files before starting a task."
    );
    return;
  }

  if (verificationCommand) {
    let finishCheck = (): void => {};
    const settled = new Promise<void>((resolve) => {
      finishCheck = resolve;
    });
    const removeCleanup =
      verificationCommand.command === "check"
        ? installSignalCleanup(settled)
        : () => {};
    try {
      process.exitCode = await executeVerificationCli(
        verificationCommand,
        new WorkflowRunner(repoRoot, createVendorAdapters()),
        new InquirerInteractiveIO(),
        defaultDecisionMaker(),
        interactiveTerminal
      );
    } finally {
      finishCheck();
      removeCleanup();
    }
    return;
  }

  if (command === "setup") {
    if (args.length !== 1)
      throw new BanzaiError("INVALID_SETUP_ARGS", "Usage: banzai setup");
    if (!interactiveTerminal)
      throw new BanzaiError(
        "TTY_REQUIRED",
        `banzai setup requires terminal input and output. Open your client in this project and explicitly invoke banzai:project-manifest, or rerun banzai setup in a terminal. ${SETUP_PLUGIN_PREREQUISITE}`
      );
    const config = await loadConfig(repoRoot);
    process.exitCode = await runProjectSetup(
      repoRoot,
      config,
      new InquirerInteractiveIO()
    );
    if (process.exitCode === 0)
      await reportClaudePermissionGaps(repoRoot, config);
    return;
  }
  if (mode === "interactive") {
    const store = new RunStore(repoRoot);
    const active = await store.readActiveRunId();
    const state = active === null ? null : await store.readState(active);
    if (
      state === null ||
      state.status === "done" ||
      state.status === "cancelled"
    ) {
      const config = await loadConfig(repoRoot);
      if ((await inspectProjectAdoption(repoRoot)).classification !== "ready") {
        process.exitCode = await runProjectSetup(
          repoRoot,
          config,
          new InquirerInteractiveIO()
        );
        return;
      }
      await currentCommit(repoRoot);
    }
  }

  if (command === "doctor") {
    process.exitCode = await executeDoctor(repoRoot, args.slice(1), {
      stdout: (value) => process.stdout.write(value),
      stderr: (value) => process.stderr.write(value)
    });
    return;
  }

  if (command === "eval") {
    if (cancellationReportOptions !== null) {
      await executeCancellationReport(
        repoRoot,
        cancellationReportOptions,
        (value) => {
          process.stdout.write(value);
        }
      );
      return;
    }
    if (contextReportOptions !== null) {
      await executeContextReportWithOptions(repoRoot, contextReportOptions, {
        stdout: (value) => process.stdout.write(value),
        stderr: (value) => process.stderr.write(value)
      });
      return;
    }
    if (evaluationKpiOptions !== null) {
      await executeEvaluationKpiFromCheckout(repoRoot, evaluationKpiOptions, {
        stdout: (value) => process.stdout.write(value),
        stderr: (value) => process.stderr.write(value)
      });
      return;
    }
    await executeEvaluationExport(repoRoot, args.slice(2), {
      stdout: (value) => process.stdout.write(value),
      stderr: (value) => process.stderr.write(value)
    });
    return;
  }

  if (command === "compatibility") {
    process.exitCode = await executeLiveCompatibility(repoRoot, args.slice(2), {
      stdout: (value) => process.stdout.write(value),
      stderr: (value) => process.stderr.write(value)
    });
    return;
  }

  const progress = new TerminalProgressReporter(undefined, undefined, {
    // Progress goes to stderr, so that is the stream whose capabilities decide.
    styler: createStyler(
      colorEnabled(process.stderr, process.env),
      colorDepth(process.env)
    ),
    level: progressLevel,
    columns: () => process.stderr.columns,
    // Cursor control only where there is a cursor.
    write: process.stderr.isTTY
      ? (chunk) => {
          process.stderr.write(chunk);
        }
      : undefined
  });
  activeProgress = progress;
  let removeSignalCleanup = installSignalCleanup();
  if (controlCommand !== null) {
    await executeAgentControlCommand(
      controlCommand,
      () =>
        new WorkflowRunner(
          repoRoot,
          createVendorAdapters(),
          undefined,
          progress.report
        ),
      controlIO,
      defaultDecisionMaker()
    );
    return;
  }
  const adapters = createVendorAdapters();
  const interactiveIO =
    mode === "interactive" ? new InquirerInteractiveIO() : undefined;
  const humanTime =
    interactiveIO === undefined
      ? undefined
      : new InteractiveHumanTime(new HumanTimeStore(repoRoot), () => {
          interactiveIO.writeLine("Time was not saved");
        });
  const runner = new WorkflowRunner(
    repoRoot,
    adapters,
    undefined,
    progress.report,
    humanTime === undefined
      ? undefined
      : (boundary) => humanTime.observe(boundary)
  );
  const attention = new TerminalAttention({
    platform: process.platform,
    env: process.env,
    interactiveTerminal: interactiveTerminal && !args.includes("--json"),
    output: process.stderr
  });
  if (mode === "interactive") {
    await runInteractive(runner, interactiveIO ?? new InquirerInteractiveIO(), {
      ...(humanTime === undefined ? {} : { humanTime }),
      decidedBy: defaultDecisionMaker(),
      beforeStart: async () => {
        if (
          (await inspectProjectAdoption(repoRoot)).classification !== "ready"
        ) {
          progress.close();
          removeSignalCleanup();
          try {
            process.exitCode = await runProjectSetup(
              repoRoot,
              await loadConfig(repoRoot),
              interactiveIO ?? new InquirerInteractiveIO()
            );
          } finally {
            removeSignalCleanup = installSignalCleanup();
          }
          return false;
        }
        await currentCommit(repoRoot);
        await loadConfig(repoRoot);
        return true;
      },
      attention,
      models: modelConfigurationGateway(repoRoot),
      auth: authenticationGateway(adapters),
      repository: repositoryIdentityGateway(repoRoot),
      styler: createStyler(
        colorEnabled(process.stdout, process.env),
        colorDepth(process.env)
      )
    });
    return;
  }
  if (command === "model") {
    if (!interactiveTerminal) {
      throw new BanzaiError(
        "TTY_REQUIRED",
        "`banzai model` requires terminal input and output."
      );
    }
    // Phases read model settings fresh, so changing them mid-run would swap the
    // model executing the rest of an approved plan.
    const active = await activeRunState(runner);
    if (
      active !== null &&
      active.status !== "done" &&
      active.status !== "cancelled"
    ) {
      throw new BanzaiError(
        "RUN_IN_PROGRESS",
        `Run ${active.runId} is ${active.status}. Finish or cancel it before changing models.`
      );
    }
    await runModelPicker(repoRoot, interactiveTerminal);
    return;
  }
  if (command === "run") {
    await loadConfig(repoRoot);
    await attention.run(() =>
      runner.start({
        slug: requireOption(args, "--slug"),
        request: requireOption(args, "--request")
      })
    );
    await printRunnerState(runner, metrics);
    return;
  }
  if (command === "status") {
    const status = await runner.status();
    if (args.includes("--json")) {
      console.log(JSON.stringify(status, null, 2));
    } else {
      printState(status, metrics);
      if (status.planApprovalValid !== null) {
        console.log(
          `Plan approval: ${status.planApprovalValid ? "valid" : "STALE"}`
        );
      }
      if (status.reviewValid !== null) {
        console.log(
          `Review snapshot: ${status.reviewValid ? "valid" : "STALE"}`
        );
      }
    }
    return;
  }
  if (command === "resume") {
    await attention.run(() => runner.resume());
    await printRunnerState(runner, metrics);
    return;
  }
  if (command === "retry") {
    await attention.run(() => runner.retry());
    await printRunnerState(runner, metrics);
    return;
  }
  if (command === "restore") {
    const restored = await runner.restoreApproval();
    for (const artifact of restored) {
      process.stderr.write(`[banzai] Restored ${artifact}\n`);
    }
    process.stderr.write(
      "[banzai] Approved planning artifacts match the recorded approval again; run `banzai retry` to continue.\n"
    );
    return;
  }
  if (command === "recover") {
    if (!interactiveTerminal) {
      throw new BanzaiError(
        "TTY_REQUIRED",
        "`banzai recover` requires terminal input and output; non-TTY callers must use `banzai control recover`."
      );
    }
    if (args.length !== 1) {
      throw new BanzaiError(
        "INVALID_COMMAND",
        "Recover accepts no options; inspect status and confirm interactively."
      );
    }
    const status = await runner.status();
    printState(status, metrics);
    if (
      !status.recovery.eligible ||
      status.recovery.attemptId === null ||
      status.recovery.recoveryIdentity === null
    ) {
      throw new BanzaiError("RECOVERY_NOT_ALLOWED", status.recovery.reason);
    }
    const io = new InquirerInteractiveIO();
    const confirmation =
      status.recovery.sourceKind === "prerequisite_blocked_fix"
        ? "Confirm the displayed prerequisites are addressed and authorize one new fix attempt for only the remaining accepted findings in this exact workspace?"
        : status.recovery.sourceKind === "digest_rejected"
          ? "Authorize one linked attempt to supply a corrected result for the rejected phase, keeping the rejected attempt and its result as evidence?"
          : "Authorize one new recovery attempt for this exact workspace and accept that repository or external side effects may be partial or duplicated?";
    if (!(await io.confirm(confirmation, false))) {
      return;
    }
    const { attemptId, recoveryIdentity } = status.recovery;
    await attention.run(() =>
      runner.recover({
        attemptId,
        recoveryIdentity,
        unknownSideEffectsAccepted: true,
        decidedBy: defaultDecisionMaker()
      })
    );
    await printRunnerState(runner, metrics);
    return;
  }
  if (command === "review" && reviewCommand !== null) {
    await attention.run(() =>
      runner.requestPlanningReview({
        paths: reviewCommand.paths,
        decidedBy: reviewCommand.by ?? defaultDecisionMaker(),
        autoResume: reviewCommand.autoResume
      })
    );
    await printRunnerState(runner, metrics);
    return;
  }
  if (command === "approve") {
    const target = args[1];
    const approvedBy = option(args, "--by") ?? defaultDecisionMaker();
    const autoResume = !args.includes("--no-resume");
    if (target === "plan") {
      const prerequisites = await runner.getPlanHumanPrerequisites();
      if (prerequisites)
        console.log(
          `Human prerequisites:\n${escapeTerminalText(prerequisites)}`
        );
      if (planCommand === null)
        throw new BanzaiError("INVALID_COMMAND", "Invalid plan command.");
      await attention.run(() =>
        planCommand.decision === "rework"
          ? runner.reworkPlan({
              feedback: planCommand.note ?? "",
              decidedBy: planCommand.by ?? defaultDecisionMaker(),
              autoResume: planCommand.autoResume
            })
          : runner.approvePlan(
              planCommand.by ?? defaultDecisionMaker(),
              planCommand.autoResume
            )
      );
      await printRunnerState(runner, metrics);
      return;
    }
    if (target === "adr") {
      const decision = requireOption(args, "--decision");
      if (!["accept", "reject", "rework"].includes(decision)) {
        throw new BanzaiError(
          "INVALID_DECISION",
          "ADR decision must be accept, reject, or rework."
        );
      }
      const noteIndex = args.indexOf("--note");
      const note =
        decision === "rework"
          ? noteIndex < 0
            ? null
            : (args[noteIndex + 1] ?? null)
          : option(args, "--note");
      if (decision === "rework") {
        if (note === null || note.startsWith("--") || note.trim().length === 0)
          throw new BanzaiError(
            "INVALID_DECISION",
            "ADR rework requires a non-empty --note."
          );
        validateHumanFreeText(note, "ADR rework feedback", 8000);
      }
      await attention.run(() =>
        runner.decideAdr({
          id: requireOption(args, "--id"),
          decision: decision as "accept" | "reject" | "rework",
          note,
          decidedBy: approvedBy,
          autoResume
        })
      );
      await printRunnerState(runner, metrics);
      return;
    }
    throw new BanzaiError(
      "INVALID_COMMAND",
      "Approve target must be `plan` or `adr`."
    );
  }
  if (command === "triage") {
    await attention.run(() =>
      runner.triage(
        {
          accepted: listOption(args, "--accept"),
          rejected: listOption(args, "--reject"),
          deferred: listOption(args, "--defer"),
          note: option(args, "--note"),
          decidedBy: option(args, "--by") ?? defaultDecisionMaker()
        },
        !args.includes("--no-resume")
      )
    );
    await printRunnerState(runner, metrics);
    return;
  }
  if (command === "cancel") {
    const result = await runner.cancel(cancellationInput ?? {});
    if (result.state !== null) {
      console.log(`Run: ${result.state.runId}`);
      console.log(`Status: ${result.state.status}`);
    }
    for (const line of cancellationMessages(result)) console.log(line);
    if (
      result.outcome === "unconfirmed" ||
      result.outcome === "active_run_changed"
    )
      process.exitCode = 1;
    return;
  }
  throw new BanzaiError("INVALID_COMMAND", `Unknown command: ${command}`);
}

main()
  .catch((error: unknown) => {
    // Shared plugin-library refusals carry their own stable codes.
    const code =
      error instanceof BanzaiError || error instanceof ProjectFileError
        ? error.code
        : "UNEXPECTED_ERROR";
    closeProgress();
    console.error(`[${code}] ${errorMessage(error)}`);
    process.exitCode = error instanceof BanzaiError ? error.exitCode : 1;
  })
  .finally(closeProgress);
