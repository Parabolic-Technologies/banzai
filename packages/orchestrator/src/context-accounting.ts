import { BanzaiError } from "./errors.js";
import {
  CONTEXT_ATTEMPT_SCHEMA,
  CONTEXT_ATTEMPT_SCHEMA_VERSION,
  PROMPT_COMPONENT_CATEGORY_ORDER,
  type AttemptReference,
  type ContextAttemptLedger,
  type ContextAuthorityClass,
  type ContextBudgetEvaluation,
  type ContextInventoryEvidence,
  type ContextInvocationEvidence,
  type ContextLimit,
  type ContextMetric,
  type ContextObserved,
  type ContextPolicy,
  type ContextRunnerPayload,
  type ContextVendorEvidence,
  type OutputContractEnvelope,
  type PromptComponentCategory,
  type PromptEnvelope,
  type SessionRole
} from "./types.js";

const PHASES = [
  "selection",
  "plan",
  "implementation",
  "fix",
  "review"
] as const;
const PHASES_V2 = [...PHASES, "planning_review", "planning_analysis"] as const;
const ROLES = ["planner", "implementer", "reviewer"] as const;
const WORKFLOWS = ["unselected", "quick-fix", "feature", "strict"] as const;
const INVOCATION_KINDS = ["primary", "review_artifact_repair"] as const;
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
const AUTHORITY_CLASSES = [
  "project_instructions",
  "project_manifest",
  "feature_description",
  "architecture_decision",
  "development_plan",
  "implementation_report",
  "test_report",
  "review_artifact",
  "human_decision",
  "verification_profile"
] as const satisfies readonly ContextAuthorityClass[];

export const unavailable = <T>(): ContextObserved<T> => ({
  availability: "unavailable",
  value: null
});

export const available = <T>(value: T): ContextObserved<T> => ({
  availability: "available",
  value
});

export function emptyContextInventory(): ContextInventoryEvidence {
  return {
    toolCount: unavailable(),
    mcpServerCount: unavailable(),
    skillCount: unavailable(),
    commandCount: unavailable(),
    digest: unavailable()
  };
}

export function emptyContextVendorUsage(): ContextVendorEvidence {
  return {
    inputTokens: unavailable(),
    cachedInputTokens: unavailable(),
    outputTokens: unavailable(),
    costUsd: unavailable(),
    turns: unavailable()
  };
}

export function measureRunnerPayload(
  input: string | PromptEnvelope,
  outputContract: OutputContractEnvelope
): ContextRunnerPayload {
  const envelope: PromptEnvelope =
    typeof input === "string"
      ? {
          rendered: input,
          components: [{ category: "phase_instructions", text: input }]
        }
      : input;
  const totals = new Map<PromptComponentCategory, number>();
  for (const component of envelope.components) {
    const bytes = Buffer.byteLength(component.text, "utf8");
    if (bytes > 0) {
      totals.set(
        component.category,
        (totals.get(component.category) ?? 0) + bytes
      );
    }
  }
  const promptBytes = Buffer.byteLength(envelope.rendered, "utf8");
  const componentPromptBytes = [...totals.values()].reduce(
    (sum, bytes) => sum + bytes,
    0
  );
  if (componentPromptBytes !== promptBytes) {
    throw new BanzaiError(
      "CONTEXT_ACCOUNTING_INVALID",
      "Prompt component bytes do not equal the rendered prompt bytes."
    );
  }
  const outputSchemaBytes = Buffer.byteLength(
    outputContract.serialized,
    "utf8"
  );
  if (outputSchemaBytes === 0) {
    throw new BanzaiError(
      "CONTEXT_ACCOUNTING_INVALID",
      "The output contract cannot be empty."
    );
  }
  totals.set("output_contract", outputSchemaBytes);
  const components = PROMPT_COMPONENT_CATEGORY_ORDER.flatMap((category) => {
    const bytes = totals.get(category) ?? 0;
    return bytes === 0 ? [] : [{ category, bytes }];
  });
  const totalBytes = promptBytes + outputSchemaBytes;
  if (
    components.reduce((sum, component) => sum + component.bytes, 0) !==
    totalBytes
  ) {
    throw new BanzaiError(
      "CONTEXT_ACCOUNTING_INVALID",
      "Runner payload components do not equal the runner payload total."
    );
  }
  return { promptBytes, outputSchemaBytes, totalBytes, components };
}

export function effectiveContextLimit(
  policy: ContextPolicy,
  metric: ContextMetric,
  phase: AttemptReference["kind"],
  role: SessionRole
): ContextLimit | null {
  const matching = policy.limits
    .filter(
      (limit) =>
        limit.metric === metric &&
        (limit.phase === null || limit.phase === phase) &&
        (limit.role === null || limit.role === role)
    )
    .map((limit) => ({
      limit,
      specificity: Number(limit.phase !== null) + Number(limit.role !== null)
    }));
  if (matching.length === 0) return null;
  const specificity = Math.max(
    ...matching.map((candidate) => candidate.specificity)
  );
  return (
    matching
      .filter((candidate) => candidate.specificity === specificity)
      .sort((left, right) => left.limit.maximum - right.limit.maximum)[0]
      ?.limit ?? null
  );
}

export function evaluateContextBudgets(
  policy: ContextPolicy,
  phase: AttemptReference["kind"],
  role: SessionRole,
  values: Partial<Record<ContextMetric, number>>
): ContextBudgetEvaluation[] {
  const evaluations: ContextBudgetEvaluation[] = [];
  for (const metric of METRICS) {
    const limit = effectiveContextLimit(policy, metric, phase, role);
    if (limit === null) continue;
    const value = values[metric];
    if (value === undefined) {
      evaluations.push({
        metric,
        selector: { phase: limit.phase, role: limit.role },
        maximum: limit.maximum,
        observed: unavailable(),
        result: "unavailable"
      });
      continue;
    }
    const exceeded = value > limit.maximum;
    evaluations.push({
      metric,
      selector: { phase: limit.phase, role: limit.role },
      maximum: limit.maximum,
      observed: available(value),
      result: !exceeded
        ? "within_limit"
        : policy.mode === "enforce" && metric === "runner_payload_bytes"
          ? "enforced_exceeded"
          : "observed_exceeded"
    });
  }
  return evaluations;
}

function invalid(runId: string, attemptId: string, detail: string): never {
  throw new BanzaiError(
    "INVALID_CONTEXT_EVIDENCE",
    `Invalid context evidence for run ${runId}, attempt ${attemptId}: ${detail}`
  );
}

function record(
  value: unknown,
  runId: string,
  attemptId: string,
  label: string
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return invalid(runId, attemptId, `${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function keys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  runId: string,
  attemptId: string,
  label: string
): void {
  const actual = Object.keys(value).sort();
  const expected = [...allowed].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    invalid(runId, attemptId, `${label} has unsupported fields.`);
  }
}

function identifier(
  value: unknown,
  runId: string,
  attemptId: string,
  label: string
): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 300 ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(value)
  ) {
    return invalid(runId, attemptId, `${label} is invalid.`);
  }
  return value;
}

function enumValue<T extends string>(
  value: unknown,
  allowed: readonly T[],
  runId: string,
  attemptId: string,
  label: string
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    return invalid(runId, attemptId, `${label} is unsupported.`);
  }
  return value as T;
}

function nonNegative(
  value: unknown,
  runId: string,
  attemptId: string,
  label: string,
  integer = true
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    (integer && !Number.isInteger(value))
  ) {
    return invalid(runId, attemptId, `${label} is invalid.`);
  }
  return value;
}

function instant(
  value: unknown,
  runId: string,
  attemptId: string,
  label: string,
  nullable = false
): string | null {
  if (nullable && value === null) return null;
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    return invalid(runId, attemptId, `${label} is invalid.`);
  }
  return value;
}

function observedNumber(
  value: unknown,
  runId: string,
  attemptId: string,
  label: string,
  integer = true
): ContextObserved<number> {
  const item = record(value, runId, attemptId, label);
  keys(item, ["availability", "value"], runId, attemptId, label);
  if (item.availability === "unavailable" && item.value === null) {
    return unavailable();
  }
  if (item.availability !== "available") {
    return invalid(runId, attemptId, `${label}.availability is invalid.`);
  }
  return available(
    nonNegative(item.value, runId, attemptId, `${label}.value`, integer)
  );
}

function observedDigest(
  value: unknown,
  runId: string,
  attemptId: string,
  label: string
): ContextObserved<string> {
  const item = record(value, runId, attemptId, label);
  keys(item, ["availability", "value"], runId, attemptId, label);
  if (item.availability === "unavailable" && item.value === null)
    return unavailable();
  if (
    item.availability !== "available" ||
    typeof item.value !== "string" ||
    !/^[a-f0-9]{64}$/u.test(item.value)
  ) {
    return invalid(runId, attemptId, `${label} is invalid.`);
  }
  return available(item.value);
}

function parseInvocation(
  value: unknown,
  ordinal: number,
  runId: string,
  attemptId: string,
  phases: readonly AttemptReference["kind"][]
): ContextInvocationEvidence {
  const item = record(value, runId, attemptId, `invocations[${ordinal - 1}]`);
  keys(
    item,
    [
      "ordinal",
      "kind",
      "workflow",
      "phase",
      "role",
      "vendor",
      "sessionMode",
      "measuredAt",
      "completedAt",
      "outcome",
      "runnerPayload",
      "authority",
      "sessionInventory",
      "vendorUsage",
      "budgets"
    ],
    runId,
    attemptId,
    "invocation"
  );
  if (item.ordinal !== ordinal)
    invalid(runId, attemptId, "Invocation ordinals are not contiguous.");
  const payload = record(item.runnerPayload, runId, attemptId, "runnerPayload");
  keys(
    payload,
    ["promptBytes", "outputSchemaBytes", "totalBytes", "components"],
    runId,
    attemptId,
    "runnerPayload"
  );
  const promptBytes = nonNegative(
    payload.promptBytes,
    runId,
    attemptId,
    "runnerPayload.promptBytes"
  );
  const outputSchemaBytes = nonNegative(
    payload.outputSchemaBytes,
    runId,
    attemptId,
    "runnerPayload.outputSchemaBytes"
  );
  const totalBytes = nonNegative(
    payload.totalBytes,
    runId,
    attemptId,
    "runnerPayload.totalBytes"
  );
  if (!Array.isArray(payload.components) || payload.components.length === 0)
    invalid(runId, attemptId, "runnerPayload.components is invalid.");
  const seenCategories = new Set<string>();
  let previousCategoryIndex = -1;
  const components = (payload.components as unknown[]).map(
    (component, index) => {
      const entry = record(component, runId, attemptId, `components[${index}]`);
      keys(
        entry,
        ["category", "bytes"],
        runId,
        attemptId,
        `components[${index}]`
      );
      const category = enumValue(
        entry.category,
        PROMPT_COMPONENT_CATEGORY_ORDER,
        runId,
        attemptId,
        `components[${index}].category`
      );
      const bytes = nonNegative(
        entry.bytes,
        runId,
        attemptId,
        `components[${index}].bytes`
      );
      const categoryIndex = PROMPT_COMPONENT_CATEGORY_ORDER.indexOf(category);
      if (
        bytes === 0 ||
        seenCategories.has(category) ||
        previousCategoryIndex >= categoryIndex
      ) {
        invalid(
          runId,
          attemptId,
          "Runner components must be non-zero, unique, and ordered."
        );
      }
      seenCategories.add(category);
      previousCategoryIndex = categoryIndex;
      return { category, bytes };
    }
  );
  if (
    outputSchemaBytes === 0 ||
    promptBytes + outputSchemaBytes !== totalBytes ||
    components.reduce((sum, component) => sum + component.bytes, 0) !==
      totalBytes ||
    components.find((component) => component.category === "output_contract")
      ?.bytes !== outputSchemaBytes
  ) {
    invalid(runId, attemptId, "Runner payload totals disagree.");
  }
  if (!Array.isArray(item.authority))
    invalid(runId, attemptId, "authority must be an array.");
  const authoritySeen = new Set<string>();
  const authority = (item.authority as unknown[]).map((entryValue, index) => {
    const entry = record(entryValue, runId, attemptId, `authority[${index}]`);
    keys(entry, ["class", "count"], runId, attemptId, `authority[${index}]`);
    const authorityClass = enumValue(
      entry.class,
      AUTHORITY_CLASSES,
      runId,
      attemptId,
      `authority[${index}].class`
    );
    const count = nonNegative(
      entry.count,
      runId,
      attemptId,
      `authority[${index}].count`
    );
    if (count === 0 || authoritySeen.has(authorityClass))
      invalid(
        runId,
        attemptId,
        "Authority entries must be positive and unique."
      );
    authoritySeen.add(authorityClass);
    return { class: authorityClass, count };
  });
  const inventory = record(
    item.sessionInventory,
    runId,
    attemptId,
    "sessionInventory"
  );
  keys(
    inventory,
    ["toolCount", "mcpServerCount", "skillCount", "commandCount", "digest"],
    runId,
    attemptId,
    "sessionInventory"
  );
  const usage = record(item.vendorUsage, runId, attemptId, "vendorUsage");
  keys(
    usage,
    ["inputTokens", "cachedInputTokens", "outputTokens", "costUsd", "turns"],
    runId,
    attemptId,
    "vendorUsage"
  );
  if (!Array.isArray(item.budgets))
    invalid(runId, attemptId, "budgets must be an array.");
  const budgetSeen = new Set<string>();
  let previousBudgetMetricIndex = -1;
  const budgets = (item.budgets as unknown[]).map((budgetValue, index) => {
    const budget = record(budgetValue, runId, attemptId, `budgets[${index}]`);
    keys(
      budget,
      ["metric", "selector", "maximum", "observed", "result"],
      runId,
      attemptId,
      `budgets[${index}]`
    );
    const selector = record(
      budget.selector,
      runId,
      attemptId,
      `budgets[${index}].selector`
    );
    keys(
      selector,
      ["phase", "role"],
      runId,
      attemptId,
      `budgets[${index}].selector`
    );
    const metric = enumValue(
      budget.metric,
      METRICS,
      runId,
      attemptId,
      `budgets[${index}].metric`
    );
    const metricIndex = METRICS.indexOf(metric);
    const maximum = nonNegative(
      budget.maximum,
      runId,
      attemptId,
      `budgets[${index}].maximum`,
      metric === "vendor_cost_usd" ? false : true
    );
    if (maximum <= 0)
      invalid(runId, attemptId, "Budget maximum must be positive.");
    if (budgetSeen.has(metric) || metricIndex <= previousBudgetMetricIndex)
      invalid(
        runId,
        attemptId,
        "Budget metrics must be unique and deterministically ordered per invocation."
      );
    budgetSeen.add(metric);
    previousBudgetMetricIndex = metricIndex;
    const observed = observedNumber(
      budget.observed,
      runId,
      attemptId,
      `budgets[${index}].observed`,
      metric === "vendor_cost_usd" ? false : true
    );
    const result = enumValue(
      budget.result,
      [
        "within_limit",
        "observed_exceeded",
        "enforced_exceeded",
        "unavailable"
      ] as const,
      runId,
      attemptId,
      `budgets[${index}].result`
    );
    if (
      (result === "unavailable") !==
      (observed.availability === "unavailable")
    ) {
      invalid(runId, attemptId, "Budget result and availability disagree.");
    }
    if (
      observed.availability === "available" &&
      ((result === "within_limit" && observed.value > maximum) ||
        ((result === "observed_exceeded" || result === "enforced_exceeded") &&
          observed.value <= maximum))
    ) {
      invalid(runId, attemptId, "Budget result and observed value disagree.");
    }
    if (result === "enforced_exceeded" && metric !== "runner_payload_bytes") {
      invalid(runId, attemptId, "Only runner payload bytes can be enforced.");
    }
    return {
      metric,
      selector: {
        phase:
          selector.phase === null
            ? null
            : enumValue(
                selector.phase,
                PHASES,
                runId,
                attemptId,
                "budget.selector.phase"
              ),
        role:
          selector.role === null
            ? null
            : enumValue(
                selector.role,
                ROLES,
                runId,
                attemptId,
                "budget.selector.role"
              )
      },
      maximum,
      observed,
      result
    };
  });
  const outcome = enumValue(
    item.outcome,
    ["pending", "completed", "failed", "budget_exceeded"] as const,
    runId,
    attemptId,
    "outcome"
  );
  const completedAt = instant(
    item.completedAt,
    runId,
    attemptId,
    "completedAt",
    true
  );
  if ((outcome === "pending") !== (completedAt === null))
    invalid(runId, attemptId, "Outcome and completion time disagree.");
  const enforced = budgets.some(
    (budget) => budget.result === "enforced_exceeded"
  );
  if ((outcome === "budget_exceeded") !== enforced) {
    invalid(runId, attemptId, "Budget outcome and evaluation disagree.");
  }
  const measuredAt = instant(item.measuredAt, runId, attemptId, "measuredAt");
  if (measuredAt === null) invalid(runId, attemptId, "measuredAt is invalid.");
  const parsed = {
    ordinal,
    kind: enumValue(item.kind, INVOCATION_KINDS, runId, attemptId, "kind"),
    workflow: enumValue(item.workflow, WORKFLOWS, runId, attemptId, "workflow"),
    phase: enumValue(item.phase, phases, runId, attemptId, "phase"),
    role: enumValue(item.role, ROLES, runId, attemptId, "role"),
    vendor: enumValue(
      item.vendor,
      ["codex", "claude"] as const,
      runId,
      attemptId,
      "vendor"
    ),
    sessionMode: enumValue(
      item.sessionMode,
      ["fresh", "resumed"] as const,
      runId,
      attemptId,
      "sessionMode"
    ),
    measuredAt,
    completedAt,
    outcome,
    runnerPayload: { promptBytes, outputSchemaBytes, totalBytes, components },
    authority,
    sessionInventory: {
      toolCount: observedNumber(
        inventory.toolCount,
        runId,
        attemptId,
        "sessionInventory.toolCount"
      ),
      mcpServerCount: observedNumber(
        inventory.mcpServerCount,
        runId,
        attemptId,
        "sessionInventory.mcpServerCount"
      ),
      skillCount: observedNumber(
        inventory.skillCount,
        runId,
        attemptId,
        "sessionInventory.skillCount"
      ),
      commandCount: observedNumber(
        inventory.commandCount,
        runId,
        attemptId,
        "sessionInventory.commandCount"
      ),
      digest: observedDigest(
        inventory.digest,
        runId,
        attemptId,
        "sessionInventory.digest"
      )
    },
    vendorUsage: {
      inputTokens: observedNumber(
        usage.inputTokens,
        runId,
        attemptId,
        "vendorUsage.inputTokens"
      ),
      cachedInputTokens: observedNumber(
        usage.cachedInputTokens,
        runId,
        attemptId,
        "vendorUsage.cachedInputTokens"
      ),
      outputTokens: observedNumber(
        usage.outputTokens,
        runId,
        attemptId,
        "vendorUsage.outputTokens"
      ),
      costUsd: observedNumber(
        usage.costUsd,
        runId,
        attemptId,
        "vendorUsage.costUsd",
        false
      ),
      turns: observedNumber(usage.turns, runId, attemptId, "vendorUsage.turns")
    },
    budgets
  };
  if (
    (ordinal === 1 && parsed.kind !== "primary") ||
    (parsed.kind === "review_artifact_repair" && ordinal !== 2)
  ) {
    invalid(runId, attemptId, "Invocation kind and ordinal disagree.");
  }
  for (const budget of parsed.budgets) {
    if (
      (budget.selector.phase !== null &&
        budget.selector.phase !== parsed.phase) ||
      (budget.selector.role !== null && budget.selector.role !== parsed.role)
    ) {
      invalid(
        runId,
        attemptId,
        "Budget selector conflicts with invocation identity."
      );
    }
    const measured: ContextObserved<number> = (() => {
      switch (budget.metric) {
        case "runner_payload_bytes":
          return available(parsed.runnerPayload.totalBytes);
        case "vendor_input_tokens":
          return parsed.vendorUsage.inputTokens;
        case "vendor_cached_input_tokens":
          return parsed.vendorUsage.cachedInputTokens;
        case "vendor_output_tokens":
          return parsed.vendorUsage.outputTokens;
        case "vendor_cost_usd":
          return parsed.vendorUsage.costUsd;
        case "vendor_turns":
          return parsed.vendorUsage.turns;
        case "session_tools":
          return parsed.sessionInventory.toolCount;
        case "session_mcp_servers":
          return parsed.sessionInventory.mcpServerCount;
        case "session_skills":
          return parsed.sessionInventory.skillCount;
        case "session_commands":
          return parsed.sessionInventory.commandCount;
      }
    })();
    if (
      budget.observed.availability !== measured.availability ||
      (budget.observed.availability === "available" &&
        measured.availability === "available" &&
        budget.observed.value !== measured.value)
    ) {
      invalid(
        runId,
        attemptId,
        "Budget observation conflicts with measured evidence."
      );
    }
  }
  return parsed;
}

export function decodeContextAttemptLedger(
  value: unknown,
  expectedRunId: string,
  expectedAttemptId: string
): ContextAttemptLedger {
  const root = record(value, expectedRunId, expectedAttemptId, "ledger");
  keys(
    root,
    ["schema", "schemaVersion", "runId", "attempt", "invocations"],
    expectedRunId,
    expectedAttemptId,
    "ledger"
  );
  if (!(
    (root.schema === "banzai-context-attempt/v1" && root.schemaVersion === 1) ||
    (root.schema === CONTEXT_ATTEMPT_SCHEMA &&
      root.schemaVersion === CONTEXT_ATTEMPT_SCHEMA_VERSION)
  )) {
    invalid(
      expectedRunId,
      expectedAttemptId,
      "Schema identity is unsupported."
    );
  }
  const runId = identifier(
    root.runId,
    expectedRunId,
    expectedAttemptId,
    "runId"
  );
  const attempt = record(
    root.attempt,
    expectedRunId,
    expectedAttemptId,
    "attempt"
  );
  keys(
    attempt,
    ["id", "kind", "mutable"],
    expectedRunId,
    expectedAttemptId,
    "attempt"
  );
  const attemptId = identifier(
    attempt.id,
    expectedRunId,
    expectedAttemptId,
    "attempt.id"
  );
  if (runId !== expectedRunId || attemptId !== expectedAttemptId) {
    invalid(
      expectedRunId,
      expectedAttemptId,
      "Ledger identity does not match its owner."
    );
  }
  if (typeof attempt.mutable !== "boolean")
    invalid(expectedRunId, expectedAttemptId, "attempt.mutable is invalid.");
  if (!Array.isArray(root.invocations) || root.invocations.length === 0)
    invalid(expectedRunId, expectedAttemptId, "invocations must be non-empty.");
  const phases = root.schemaVersion === 1 ? PHASES : PHASES_V2;
  const parsedAttempt: AttemptReference = {
    id: attemptId,
    kind: enumValue(
      attempt.kind,
      phases,
      expectedRunId,
      expectedAttemptId,
      "attempt.kind"
    ),
    mutable: attempt.mutable
  };
  const invocations = (root.invocations as unknown[]).map((item, index) =>
    parseInvocation(item, index + 1, expectedRunId, expectedAttemptId, phases)
  );
  const expectedMutable =
    parsedAttempt.kind === "implementation" || parsedAttempt.kind === "fix";
  if (parsedAttempt.mutable !== expectedMutable) {
    invalid(
      expectedRunId,
      expectedAttemptId,
      "Attempt mutability conflicts with its phase."
    );
  }
  const expectedRole: SessionRole =
    parsedAttempt.kind === "selection" ||
    parsedAttempt.kind === "plan" ||
    parsedAttempt.kind === "planning_analysis"
      ? "planner"
      : parsedAttempt.kind === "review" ||
          parsedAttempt.kind === "planning_review"
        ? "reviewer"
        : "implementer";
  for (const invocation of invocations) {
    if (
      invocation.phase !== parsedAttempt.kind ||
      invocation.role !== expectedRole ||
      (parsedAttempt.kind === "selection" &&
        invocation.workflow !== "unselected") ||
      (invocation.kind === "review_artifact_repair" &&
        parsedAttempt.kind !== "review")
    ) {
      invalid(
        expectedRunId,
        expectedAttemptId,
        "Invocation identity conflicts with its attempt."
      );
    }
  }
  if (invocations.length > 2) {
    invalid(
      expectedRunId,
      expectedAttemptId,
      "Invocation count exceeds the bounded ledger contract."
    );
  }
  return {
    schema: root.schema,
    schemaVersion: root.schemaVersion,
    runId,
    attempt: parsedAttempt,
    invocations
  };
}
