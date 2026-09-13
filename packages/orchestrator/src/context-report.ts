import { constants } from "node:fs";
import { lstat, open, readdir } from "node:fs/promises";
import path from "node:path";
import { decodeContextAttemptLedger } from "./context-accounting.js";
import { BanzaiError, ResourceVersionUnsupportedError } from "./errors.js";
import {
  CONTEXT_REPORT_SCHEMA,
  CONTEXT_REPORT_SCHEMA_VERSION,
  MODEL_ATTEMPT_SCHEMA_VERSION,
  PROMPT_COMPONENT_CATEGORY_ORDER,
  type AttemptReference,
  type ContextAttemptLedger,
  type ContextBudgetAggregate,
  type ContextMetric,
  type ContextNumericAggregate,
  type ContextObserved,
  type ContextReport,
  type ContextReportGroup,
  type ContextWorkflow,
  type EvaluationExportOptions,
  type ModelUsage,
  type PromptComponentCategory,
  type SessionRole
} from "./types.js";

const WORKFLOWS = [
  "unselected",
  "quick-fix",
  "feature",
  "strict"
] as const satisfies readonly ContextWorkflow[];
const PHASES = [
  "selection",
  "plan",
  "implementation",
  "fix",
  "review"
] as const satisfies readonly AttemptReference["kind"][];
const ROLES = [
  "planner",
  "implementer",
  "reviewer"
] as const satisfies readonly SessionRole[];
const CATEGORIES =
  PROMPT_COMPONENT_CATEGORY_ORDER satisfies readonly PromptComponentCategory[];
const METRICS = [
  "runner_payload_bytes",
  "vendor_input_tokens",
  "vendor_cached_input_tokens",
  "vendor_output_tokens",
  "vendor_cost_usd",
  "vendor_turns",
  "session_tools",
  "session_mcp_servers",
  "session_skills",
  "session_commands"
] as const satisfies readonly ContextMetric[];

interface ContextCanonicalAttempt {
  attempt: AttemptReference;
  usage: ModelUsage | null;
}

export interface ContextReportAttemptEvidence extends ContextCanonicalAttempt {
  runId: string;
  workflow: ContextWorkflow;
  ledger: ContextAttemptLedger | null;
}

interface MutableGroup {
  workflow: ContextWorkflow;
  phase: AttemptReference["kind"];
  role: SessionRole;
  exactAttemptIds: Set<string>;
  incompleteAttemptIds: Set<string>;
  invocations: ContextAttemptLedger["invocations"];
}

interface ContextRunMetadata {
  createdAt: string;
  workflow: Exclude<ContextWorkflow, "unselected">;
}

function invalid(runId: string, attemptId: string, detail: string): never {
  throw new BanzaiError(
    "INVALID_CONTEXT_EVIDENCE",
    `Invalid context evidence for run ${runId}, attempt ${attemptId}: ${detail}`
  );
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function safeIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 300 &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(value)
  );
}

function roleForPhase(phase: AttemptReference["kind"]): SessionRole {
  return phase === "selection" || phase === "plan"
    ? "planner"
    : phase === "review"
      ? "reviewer"
      : "implementer";
}

function mutableForPhase(phase: AttemptReference["kind"]): boolean {
  return phase === "implementation" || phase === "fix";
}

function decodeUsage(
  value: unknown,
  runId: string,
  attemptId: string
): ModelUsage | null {
  if (value === null) return null;
  const item = record(value);
  if (item === null)
    return invalid(runId, attemptId, "Canonical usage is invalid.");
  const number = (key: keyof ModelUsage, nullable = false): number | null => {
    const observed = item[key];
    if (nullable && observed === null) return null;
    if (
      typeof observed !== "number" ||
      !Number.isFinite(observed) ||
      observed < 0 ||
      (key !== "costUsd" && !Number.isInteger(observed))
    ) {
      return invalid(runId, attemptId, `Canonical usage ${key} is invalid.`);
    }
    return observed;
  };
  const requiredNumber = (key: keyof ModelUsage): number => {
    const value = number(key);
    if (value === null) {
      return invalid(runId, attemptId, `Canonical usage ${key} is invalid.`);
    }
    return value;
  };
  return {
    inputTokens: requiredNumber("inputTokens"),
    cachedInputTokens: requiredNumber("cachedInputTokens"),
    outputTokens: requiredNumber("outputTokens"),
    costUsd: number("costUsd", true)
  };
}

function decodeCanonicalAttempt(
  value: unknown,
  file: string,
  runId: string
): ContextCanonicalAttempt {
  const item = record(value);
  if (item !== null && item.schemaVersion !== MODEL_ATTEMPT_SCHEMA_VERSION) {
    throw new ResourceVersionUnsupportedError(
      "model attempt",
      String(item.schemaVersion),
      MODEL_ATTEMPT_SCHEMA_VERSION
    );
  }
  const identity = record(item?.attempt);
  const safeAttemptId = safeIdentifier(identity?.id) ? identity.id : "unknown";
  if (item === null || identity === null) {
    return invalid(runId, safeAttemptId, "Canonical attempt is invalid.");
  }
  if (!safeIdentifier(identity.id)) {
    return invalid(runId, "unknown", "Canonical attempt identity is invalid.");
  }
  if (
    typeof identity.kind !== "string" ||
    !PHASES.includes(identity.kind as AttemptReference["kind"])
  ) {
    return invalid(runId, identity.id, "Canonical attempt phase is invalid.");
  }
  const kind = identity.kind as AttemptReference["kind"];
  const attempt: AttemptReference = {
    id: identity.id,
    kind,
    mutable: mutableForPhase(kind)
  };
  if (
    identity.mutable !== attempt.mutable ||
    file !== `${attempt.id}-${attempt.kind}.json`
  ) {
    return invalid(
      runId,
      attempt.id,
      "Canonical attempt identity conflicts with its owner."
    );
  }
  if (
    item.status !== "started" &&
    item.status !== "completed" &&
    item.status !== "failed" &&
    item.status !== "interrupted"
  ) {
    return invalid(runId, attempt.id, "Canonical attempt status is invalid.");
  }
  return { attempt, usage: decodeUsage(item.usage, runId, attempt.id) };
}

function observedValues(values: readonly ContextObserved<number>[]): number[] {
  return values.flatMap((item) =>
    item.availability === "available" ? [item.value] : []
  );
}

function numericAggregate(
  values: readonly ContextObserved<number>[]
): ContextNumericAggregate {
  const observed = observedValues(values);
  const total =
    observed.length === 0
      ? null
      : observed.reduce((sum, item) => sum + item, 0);
  return {
    total,
    mean: total === null ? null : total / observed.length,
    maximum: observed.length === 0 ? null : Math.max(...observed),
    observed: observed.length,
    unavailable: values.length - observed.length
  };
}

function availableValues(values: readonly number[]): ContextObserved<number>[] {
  return values.map((value) => ({ availability: "available", value }));
}

function budgetAggregates(
  invocations: MutableGroup["invocations"]
): ContextBudgetAggregate[] {
  const groups = new Map<string, ContextBudgetAggregate>();
  for (const invocation of invocations) {
    for (const budget of invocation.budgets) {
      const key = `${budget.metric}\u0000${budget.maximum}`;
      const aggregate = groups.get(key) ?? {
        metric: budget.metric,
        maximum: budget.maximum,
        withinLimit: 0,
        observedExceeded: 0,
        enforcedExceeded: 0,
        unavailable: 0
      };
      if (budget.result === "within_limit") aggregate.withinLimit += 1;
      else if (budget.result === "observed_exceeded") {
        aggregate.observedExceeded += 1;
      } else if (budget.result === "enforced_exceeded") {
        aggregate.enforcedExceeded += 1;
      } else aggregate.unavailable += 1;
      groups.set(key, aggregate);
    }
  }
  return [...groups.values()].sort((left, right) => {
    const metric = METRICS.indexOf(left.metric) - METRICS.indexOf(right.metric);
    return metric !== 0 ? metric : left.maximum - right.maximum;
  });
}

function groupKey(
  workflow: ContextWorkflow,
  phase: AttemptReference["kind"],
  role: SessionRole
): string {
  return `${workflow}\u0000${phase}\u0000${role}`;
}

function getGroup(
  groups: Map<string, MutableGroup>,
  workflow: ContextWorkflow,
  phase: AttemptReference["kind"],
  role: SessionRole
): MutableGroup {
  const key = groupKey(workflow, phase, role);
  const existing = groups.get(key);
  if (existing !== undefined) return existing;
  const created: MutableGroup = {
    workflow,
    phase,
    role,
    exactAttemptIds: new Set(),
    incompleteAttemptIds: new Set(),
    invocations: []
  };
  groups.set(key, created);
  return created;
}

function compareUsage(attempt: ContextReportAttemptEvidence): void {
  if (attempt.usage === null || attempt.ledger === null) return;
  const comparisons: [
    keyof ModelUsage,
    readonly ContextObserved<number>[],
    number | null
  ][] = [
    [
      "inputTokens",
      attempt.ledger.invocations.map((item) => item.vendorUsage.inputTokens),
      attempt.usage.inputTokens
    ],
    [
      "cachedInputTokens",
      attempt.ledger.invocations.map(
        (item) => item.vendorUsage.cachedInputTokens
      ),
      attempt.usage.cachedInputTokens
    ],
    [
      "outputTokens",
      attempt.ledger.invocations.map((item) => item.vendorUsage.outputTokens),
      attempt.usage.outputTokens
    ],
    [
      "costUsd",
      attempt.ledger.invocations.map((item) => item.vendorUsage.costUsd),
      attempt.usage.costUsd
    ]
  ];
  for (const [metric, observed, canonical] of comparisons) {
    if (
      canonical === null ||
      observed.some((item) => item.availability === "unavailable")
    ) {
      continue;
    }
    const total = observedValues(observed).reduce(
      (sum, value) => sum + value,
      0
    );
    if (Math.abs(total - canonical) > Number.EPSILON) {
      invalid(
        attempt.runId,
        attempt.attempt.id,
        `Per-invocation ${metric} conflicts with canonical attempt usage.`
      );
    }
  }
}

export function aggregateContextEvidence(
  attempts: readonly ContextReportAttemptEvidence[]
): Pick<ContextReport, "coverage" | "groups"> {
  const groups = new Map<string, MutableGroup>();
  let exact = 0;
  let incomplete = 0;
  for (const source of attempts) {
    const owner = `${source.runId}\u0000${source.attempt.id}`;
    if (source.ledger === null) {
      incomplete += 1;
      const workflow =
        source.attempt.kind === "selection" ? "unselected" : source.workflow;
      getGroup(
        groups,
        workflow,
        source.attempt.kind,
        roleForPhase(source.attempt.kind)
      ).incompleteAttemptIds.add(owner);
      continue;
    }
    compareUsage(source);
    exact += 1;
    const touched = new Set<string>();
    for (const invocation of source.ledger.invocations) {
      const group = getGroup(
        groups,
        invocation.workflow,
        invocation.phase,
        invocation.role
      );
      group.invocations.push(invocation);
      touched.add(
        groupKey(invocation.workflow, invocation.phase, invocation.role)
      );
    }
    for (const key of touched) groups.get(key)?.exactAttemptIds.add(owner);
  }

  const result: ContextReportGroup[] = [];
  for (const workflow of WORKFLOWS) {
    for (const phase of PHASES) {
      for (const role of ROLES) {
        const group = groups.get(groupKey(workflow, phase, role));
        if (group === undefined) continue;
        const categoryTotals = new Map<PromptComponentCategory, number>();
        for (const invocation of group.invocations) {
          for (const component of invocation.runnerPayload.components) {
            categoryTotals.set(
              component.category,
              (categoryTotals.get(component.category) ?? 0) + component.bytes
            );
          }
        }
        const invocations = group.invocations;
        result.push({
          workflow,
          phase,
          role,
          attemptCoverage: {
            exact: group.exactAttemptIds.size,
            incomplete: group.incompleteAttemptIds.size
          },
          invocationCount: invocations.length,
          runnerPayload: numericAggregate(
            availableValues(
              invocations.map((item) => item.runnerPayload.totalBytes)
            )
          ),
          categories: [...categoryTotals.entries()]
            .map(([category, bytes]) => ({ category, bytes }))
            .sort(
              (left, right) =>
                right.bytes - left.bytes ||
                CATEGORIES.indexOf(left.category) -
                  CATEGORIES.indexOf(right.category)
            ),
          budgets: budgetAggregates(invocations),
          vendorUsage: {
            inputTokens: numericAggregate(
              invocations.map((item) => item.vendorUsage.inputTokens)
            ),
            cachedInputTokens: numericAggregate(
              invocations.map((item) => item.vendorUsage.cachedInputTokens)
            ),
            outputTokens: numericAggregate(
              invocations.map((item) => item.vendorUsage.outputTokens)
            ),
            costUsd: numericAggregate(
              invocations.map((item) => item.vendorUsage.costUsd)
            ),
            turns: numericAggregate(
              invocations.map((item) => item.vendorUsage.turns)
            )
          },
          sessionInventory: {
            tools: numericAggregate(
              invocations.map((item) => item.sessionInventory.toolCount)
            ),
            mcpServers: numericAggregate(
              invocations.map((item) => item.sessionInventory.mcpServerCount)
            ),
            skills: numericAggregate(
              invocations.map((item) => item.sessionInventory.skillCount)
            ),
            commands: numericAggregate(
              invocations.map((item) => item.sessionInventory.commandCount)
            )
          }
        });
      }
    }
  }
  return { coverage: { exact, incomplete }, groups: result };
}

function missing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

async function ownedDirectoryStatus(
  directory: string
): Promise<"owned" | "missing" | "invalid"> {
  try {
    return (await lstat(directory)).isDirectory() ? "owned" : "invalid";
  } catch (error) {
    return missing(error) ? "missing" : "invalid";
  }
}

async function runDirectories(runsDirectory: string): Promise<string[]> {
  const directoryStatus = await ownedDirectoryStatus(runsDirectory);
  if (directoryStatus === "missing") return [];
  if (directoryStatus === "invalid") {
    throw new BanzaiError(
      "EVAL_READ_FAILED",
      "Context evaluation evidence could not be read safely."
    );
  }
  try {
    const directories = (await readdir(runsDirectory, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    if (directories.some((runId) => !safeIdentifier(runId))) {
      throw new BanzaiError(
        "EVAL_READ_FAILED",
        "Context evaluation evidence could not be read safely."
      );
    }
    return directories;
  } catch (error) {
    if (error instanceof BanzaiError) throw error;
    if (missing(error)) return [];
    throw new BanzaiError(
      "EVAL_READ_FAILED",
      "Context evaluation evidence could not be read safely."
    );
  }
}

type OwnedText =
  | { status: "read"; text: string }
  | { status: "missing" }
  | { status: "invalid" };

async function readOwnedText(file: string): Promise<OwnedText> {
  let handle;
  try {
    handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    return missing(error) ? { status: "missing" } : { status: "invalid" };
  }
  try {
    if (!(await handle.stat()).isFile()) return { status: "invalid" };
    return { status: "read", text: await handle.readFile("utf8") };
  } catch {
    return { status: "invalid" };
  } finally {
    await handle.close().catch(() => undefined);
  }
}

async function readJson(file: string): Promise<unknown> {
  const owned = await readOwnedText(file);
  if (owned.status !== "read") return null;
  try {
    return JSON.parse(owned.text) as unknown;
  } catch {
    return null;
  }
}

async function readRunMetadata(
  runDirectory: string,
  runId: string
): Promise<ContextRunMetadata | null> {
  const value = await readJson(path.join(runDirectory, "state.json"));
  const state = record(value);
  if (state !== null && state.schemaVersion !== 5) {
    throw new ResourceVersionUnsupportedError(
      "run state",
      String(state.schemaVersion),
      5
    );
  }
  const selection = record(state?.workflowSelection);
  if (
    state?.runId !== runId ||
    typeof state.createdAt !== "string" ||
    !Number.isFinite(Date.parse(state.createdAt))
  ) {
    return null;
  }
  const workflow = selection?.workflow;
  return {
    createdAt: state.createdAt,
    workflow:
      typeof workflow === "string" &&
      workflow !== "unselected" &&
      WORKFLOWS.includes(workflow as ContextWorkflow)
        ? (workflow as ContextRunMetadata["workflow"])
        : "strict"
  };
}

async function collectRunAttempts(
  runDirectory: string,
  runId: string,
  workflow: ContextRunMetadata["workflow"]
): Promise<ContextReportAttemptEvidence[]> {
  const attemptsDirectory = path.join(runDirectory, "attempts");
  const directoryStatus = await ownedDirectoryStatus(attemptsDirectory);
  if (directoryStatus === "missing") return [];
  if (directoryStatus === "invalid") {
    throw new BanzaiError(
      "EVAL_READ_FAILED",
      "Context evaluation evidence could not be read safely."
    );
  }
  let files: string[];
  try {
    files = (await readdir(attemptsDirectory, { withFileTypes: true }))
      .filter(
        (entry) =>
          entry.isFile() &&
          /-(selection|plan|implementation|fix|review)\.json$/u.test(entry.name)
      )
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if (missing(error)) return [];
    throw new BanzaiError(
      "EVAL_READ_FAILED",
      "Context evaluation evidence could not be read safely."
    );
  }
  const attempts: ContextReportAttemptEvidence[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    const raw = await readJson(path.join(attemptsDirectory, file));
    const canonical = decodeCanonicalAttempt(raw, file, runId);
    if (seen.has(canonical.attempt.id)) {
      invalid(
        runId,
        canonical.attempt.id,
        "Canonical attempt identity is duplicated."
      );
    }
    seen.add(canonical.attempt.id);
    const contextFile = path.join(
      attemptsDirectory,
      `${canonical.attempt.id}.context.json`
    );
    let contextRaw: unknown;
    const ownedContext = await readOwnedText(contextFile);
    if (ownedContext.status === "missing") {
      contextRaw = null;
    } else if (ownedContext.status === "invalid") {
      invalid(
        runId,
        canonical.attempt.id,
        "Context ledger is not a regular owned file."
      );
    } else {
      try {
        contextRaw = JSON.parse(ownedContext.text) as unknown;
      } catch {
        invalid(
          runId,
          canonical.attempt.id,
          "Context ledger JSON is malformed."
        );
      }
    }
    const ledger =
      contextRaw === null
        ? null
        : decodeContextAttemptLedger(contextRaw, runId, canonical.attempt.id);
    if (
      ledger !== null &&
      (ledger.attempt.kind !== canonical.attempt.kind ||
        ledger.attempt.mutable !== canonical.attempt.mutable)
    ) {
      invalid(
        runId,
        canonical.attempt.id,
        "Context ledger owner conflicts with its canonical attempt."
      );
    }
    attempts.push({ ...canonical, runId, workflow, ledger });
  }
  return attempts;
}

function inCohort(
  createdAt: string,
  options: EvaluationExportOptions
): boolean {
  const timestamp = Date.parse(createdAt);
  return (
    (options.from === null || timestamp >= Date.parse(options.from)) &&
    (options.to === null || timestamp < Date.parse(options.to))
  );
}

export async function collectContextReport(
  repoRoot: string,
  options: EvaluationExportOptions
): Promise<ContextReport> {
  const banzaiDirectory = path.join(repoRoot, ".banzai");
  const banzaiStatus = await ownedDirectoryStatus(banzaiDirectory);
  if (banzaiStatus === "invalid") {
    throw new BanzaiError(
      "EVAL_READ_FAILED",
      "Context evaluation evidence could not be read safely."
    );
  }
  const runsDirectory = path.join(banzaiDirectory, "runs");
  const candidates =
    banzaiStatus === "missing" ? [] : await runDirectories(runsDirectory);
  const candidateSet = new Set(candidates);
  for (const runId of options.runIds) {
    if (!candidateSet.has(runId)) {
      throw new BanzaiError(
        "EVAL_RUN_NOT_FOUND",
        "An explicitly selected evaluation run does not exist."
      );
    }
  }
  const selected =
    options.runIds.length === 0
      ? candidates
      : candidates.filter((candidate) => options.runIds.includes(candidate));
  const unresolvedRunIds: string[] = [];
  const evidence: ContextReportAttemptEvidence[] = [];
  let includedRunCount = 0;
  for (const runId of selected) {
    const runDirectory = path.join(runsDirectory, runId);
    if ((await ownedDirectoryStatus(runDirectory)) !== "owned") {
      throw new BanzaiError(
        "EVAL_READ_FAILED",
        "Context evaluation evidence could not be read safely."
      );
    }
    const metadata = await readRunMetadata(runDirectory, runId);
    if (metadata === null) {
      unresolvedRunIds.push(runId);
      continue;
    }
    if (!inCohort(metadata.createdAt, options)) continue;
    includedRunCount += 1;
    evidence.push(
      ...(await collectRunAttempts(runDirectory, runId, metadata.workflow))
    );
  }
  const aggregate = aggregateContextEvidence(evidence);
  return {
    schema: CONTEXT_REPORT_SCHEMA,
    schemaVersion: CONTEXT_REPORT_SCHEMA_VERSION,
    cohort: {
      from: options.from,
      to: options.to,
      requestedRunIds: [...options.runIds],
      discoveredRunCount: candidates.length,
      includedRunCount,
      unresolvedRunIds
    },
    ...aggregate
  };
}
