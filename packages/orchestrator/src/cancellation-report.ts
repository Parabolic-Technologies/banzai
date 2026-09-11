import { BanzaiError } from "./errors.js";
import {
  CANCELLATION_AVAILABILITIES,
  CANCELLATION_REASONS,
  CANCELLATION_REPORT_SCHEMA,
  cancellationId,
  cancellationRecord,
  cancellationValue,
  emptyCancellationContext,
  resolveCancellation
} from "./cancellation.js";
import type {
  CancellationContext,
  CancellationInventory,
  CancellationPublicContext,
  CancellationReport,
  CancellationReportRun,
  CancellationResource,
  CancellationRunCoverage,
  CancellationTechnical,
  CancellationWork,
  CancellationWorkSummary
} from "./cancellation.js";
import {
  CANCELLATION_LIMITS,
  decodeCancellationEvents,
  readCancellationDirectory,
  readCancellationFile
} from "./cancellation-evidence.js";
import type {
  CancellationDirectory,
  CancellationFile
} from "./cancellation-evidence.js";
import {
  combineMetrics,
  exactMetric,
  partialMetric,
  unavailableMetric
} from "./evaluation.js";
import { currentHumanTimeEffort, decodeHumanTime } from "./human-time.js";
import {
  normalizeRfc3339Instant,
  parseEvaluationAttemptSource,
  parseEvaluationStateSource,
  parseVerificationAttemptRecord,
  parseVerificationLedger
} from "./validation.js";
import type {
  EvaluationAttemptSource,
  EvaluationExportOptions,
  NumericMetric,
  VerificationAttemptRecord
} from "./types.js";

// Existing structured codes only. Never turn an arbitrary persisted string into export data.
const FAILURE_CODES = new Set([
  "CLAUDE_PHASE_FAILED",
  "CLAUDE_REVIEW_FAILED",
  "CLAUDE_SELECTION_FAILED",
  "CODEX_PHASE_FAILED",
  "CODEX_RESULT_MISSING",
  "CODEX_REVIEW_FAILED",
  "CODEX_SELECTION_FAILED",
  "CLI_UNAVAILABLE",
  "INVALID_RESULT",
  "MODEL_RESULT_INVALID",
  "OUTPUT_CONTRACT_MISMATCH",
  "PROCESS_START_FAILED",
  "PROCESS_TIMEOUT",
  "PROMPT_ENVELOPE_MISMATCH",
  "SESSION_ID_CONFLICT",
  "TERMINAL_RESULT_CONFLICT",
  "PLAN_TASK_COMPLETION_INVALID",
  "PHASE_RESULT_SCHEMA_MISMATCH"
]);
const FAILURE_CAUSES = new Set([
  "capacity",
  "timeout",
  "process_start",
  "transport",
  "unclassified"
]);
const MODEL_KINDS = [
  "selection",
  "plan",
  "implementation",
  "fix",
  "review"
] as const;
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const ratio = (numerator: number, denominator: number) => ({
  numerator,
  denominator,
  value: denominator === 0 ? null : numerator / denominator
});
function instant(value: unknown): string | null {
  return normalizeRfc3339Instant(value) ?? null;
}
function publicContext(
  context: CancellationContext
): CancellationPublicContext {
  return {
    status: context.status,
    blockedFrom: context.blockedFrom,
    gate: context.gate,
    workflow: context.workflow,
    attempt: cancellationValue(
      null,
      context.attempt.source,
      context.attempt.availability === "available"
        ? "unavailable"
        : context.attempt.availability
    ),
    decision: cancellationValue(
      null,
      context.decision.source,
      context.decision.availability === "available"
        ? "unavailable"
        : context.decision.availability
    )
  };
}
function emptyWork(): CancellationWork {
  return {
    runElapsedMs: {
      value: null,
      availability: "unavailable",
      basis: "utc_wall",
      continuity: "unverified"
    },
    modelAttempts: unavailableMetric(),
    verificationAttempts: unavailableMetric(),
    modelDurationMs: unavailableMetric(),
    verificationDurationMs: unavailableMetric(),
    inputTokens: unavailableMetric(),
    cachedInputTokens: unavailableMetric(),
    outputTokens: unavailableMetric(),
    reportedCostUsd: unavailableMetric(),
    activeTimeEstimate: {
      minutes: null,
      basis: "estimated",
      scope: "single_engineer_unverified",
      asOf: null,
      availability: "unavailable"
    },
    inventory: { model: "unavailable", verification: "unavailable" }
  };
}
function emptyRun(runKey: string): CancellationReportRun {
  return {
    runKey,
    membership: "included",
    lifecycle: { value: null, availability: "unavailable" },
    createdAt: { value: null, availability: "unavailable" },
    cancelledAt: { value: null, availability: "unavailable" },
    observation: {
      availability: "missing",
      reason: null,
      provenance: null,
      channel: null,
      responseState: null,
      recordedAt: null
    },
    context: publicContext(emptyCancellationContext()),
    technical: [],
    work: emptyWork(),
    continuation: {
      intent: "not_reported",
      confirmation: "unavailable",
      runKeys: [],
      source: "no_supported_task_link_source"
    },
    issueCodes: []
  };
}
interface ModelLeaf {
  source: EvaluationAttemptSource;
  raw: Record<string, unknown>;
}
interface Sources {
  model: ModelLeaf[];
  verification: VerificationAttemptRecord[];
  inventory: {
    model: CancellationInventory;
    verification: CancellationInventory;
  };
  modelInvalid: number;
  verificationInvalid: number;
  modelMissing: number;
  verificationMissing: number;
}
function metric(
  values: (number | null | "invalid")[],
  inventory: CancellationInventory,
  invalid = 0,
  missing = 0,
  cost = false
): NumericMetric {
  const observed = values.filter((n): n is number => typeof n === "number");
  const subtotal = observed.reduce((a, b) => a + b, 0);
  const unknown = values.filter((n) => n === null).length + missing;
  invalid += values.filter((n) => n === "invalid").length;
  if (!Number.isFinite(subtotal))
    return partialMetric(0, 0, unknown, invalid + observed.length);
  if (
    inventory === "complete" &&
    unknown === 0 &&
    invalid === 0 &&
    (!cost || observed.length > 0)
  )
    return exactMetric(subtotal, observed.length);
  if (observed.length > 0 || invalid > 0 || unknown > 0)
    return partialMetric(subtotal, observed.length, unknown, invalid);
  return unavailableMetric();
}
function closedBefore(
  start: string | null,
  end: string | null,
  cutoff: string | null
): boolean {
  return (
    cutoff !== null &&
    start !== null &&
    end !== null &&
    start <= end &&
    end <= cutoff
  );
}
function workFromSources(
  sources: Sources,
  cutoff: string | null,
  createdAt: string | null
): CancellationWork {
  const work = emptyWork();
  work.inventory = sources.inventory;
  if (cutoff !== null && createdAt !== null && cutoff >= createdAt)
    work.runElapsedMs = {
      value: Date.parse(cutoff) - Date.parse(createdAt),
      availability: "available",
      basis: "utc_wall",
      continuity: "unverified"
    };
  const models = sources.model.filter(
    (m) =>
      cutoff === null ||
      m.source.startedAt.value === null ||
      m.source.startedAt.value <= cutoff
  );
  const verifications = sources.verification.filter(
    (v) => cutoff === null || v.startedAt <= cutoff
  );
  const modelInventory =
    cutoff === null ? "unavailable" : sources.inventory.model;
  const verificationInventory =
    cutoff === null ? "unavailable" : sources.inventory.verification;
  work.modelAttempts = metric(
    models.map((m) =>
      m.source.startedAt.evidence === "invalid"
        ? "invalid"
        : cutoff !== null && m.source.startedAt.value !== null
          ? 1
          : null
    ),
    modelInventory,
    sources.modelInvalid,
    sources.modelMissing
  );
  work.verificationAttempts = metric(
    verifications.map(() => (cutoff !== null ? 1 : null)),
    verificationInventory,
    sources.verificationInvalid,
    sources.verificationMissing
  );
  const beforeModel = (m: ModelLeaf) =>
    ["completed", "failed", "interrupted"].includes(String(m.raw.status)) &&
    closedBefore(
      m.source.startedAt.value,
      m.raw.status === "interrupted"
        ? instant(m.raw.interruptedAt)
        : m.source.completedAt.value,
      cutoff
    );
  work.modelDurationMs = metric(
    models.map((m) =>
      beforeModel(m)
        ? m.source.durationMs.evidence === "invalid"
          ? "invalid"
          : m.source.durationMs.value
        : null
    ),
    modelInventory,
    sources.modelInvalid,
    sources.modelMissing
  );
  for (const [field, key] of [
    ["inputTokens", "inputTokens"],
    ["cachedInputTokens", "cachedInputTokens"],
    ["outputTokens", "outputTokens"],
    ["reportedCostUsd", "costUsd"]
  ] as const) {
    work[field] = metric(
      models.map((m) =>
        beforeModel(m)
          ? m.source.usage[key].evidence === "invalid"
            ? "invalid"
            : m.source.usage[key].value
          : null
      ),
      modelInventory,
      sources.modelInvalid,
      sources.modelMissing,
      key === "costUsd"
    );
  }
  work.verificationDurationMs = metric(
    verifications.map((v) =>
      v.status !== "started" && closedBefore(v.startedAt, v.completedAt, cutoff)
        ? v.durationMs
        : null
    ),
    verificationInventory,
    sources.verificationInvalid,
    sources.verificationMissing
  );
  return work;
}
function referenceTable(
  context: CancellationContext,
  sources: Sources,
  cutoff: string | null
): { context: CancellationPublicContext; technical: CancellationTechnical[] } {
  const references = context.attempt.value ?? [];
  const technical: CancellationTechnical[] = [];
  const pending: {
    identity: string;
    row: Omit<CancellationTechnical, "evidenceKey">;
    referenced: boolean;
  }[] = [];
  for (const model of sources.model) {
    const { source, raw } = model;
    const referenced = references.some(
      (r) =>
        r.kind === "model" &&
        r.id === source.identity &&
        r.attemptKind === source.kind.value
    );
    const before =
      closedBefore(
        source.startedAt.value,
        raw.status === "interrupted"
          ? instant(raw.interruptedAt)
          : source.completedAt.value,
        cutoff
      ) && raw.status !== "started";
    if (!referenced && !before) continue;
    pending.push({
      identity: `model:${source.identity}`,
      referenced,
      row: {
        kind: "model",
        relationship: referenced
          ? "referenced_at_cancel"
          : "completed_before_cancel",
        availability: before ? "available" : "unavailable",
        attemptKind: source.kind.value,
        attemptStatus:
          before &&
          ["completed", "failed", "interrupted"].includes(String(raw.status))
            ? (raw.status as CancellationTechnical["attemptStatus"])
            : null,
        failureCause:
          before &&
          typeof raw.failureCause === "string" &&
          FAILURE_CAUSES.has(raw.failureCause)
            ? (raw.failureCause as CancellationTechnical["failureCause"])
            : null,
        failureCode:
          before &&
          typeof raw.failureCode === "string" &&
          FAILURE_CODES.has(raw.failureCode)
            ? raw.failureCode
            : null,
        verificationExitCode: null,
        signalPresent: null
      }
    });
  }
  for (const record of sources.verification) {
    const referenced = references.some(
      (r) =>
        r.kind === "verification" &&
        r.id === record.id &&
        r.sequence === record.sequence
    );
    const before =
      record.status !== "started" &&
      closedBefore(record.startedAt, record.completedAt, cutoff);
    if (!referenced && !before) continue;
    pending.push({
      identity: `verification:${record.id}`,
      referenced,
      row: {
        kind: "verification",
        relationship: referenced
          ? "referenced_at_cancel"
          : "completed_before_cancel",
        availability: before ? "available" : "unavailable",
        attemptKind: "verification",
        attemptStatus: before ? record.status : null,
        failureCause: null,
        failureCode: null,
        verificationExitCode: before ? record.exitCode : null,
        signalPresent: before ? record.signal !== null : null
      }
    });
  }
  for (const reference of references) {
    const identity = `${reference.kind}:${reference.id}`;
    if (!pending.some((p) => p.identity === identity))
      pending.push({
        identity,
        referenced: true,
        row: {
          kind: reference.kind,
          relationship: "referenced_at_cancel",
          availability: "missing",
          attemptKind:
            reference.kind === "model" ? reference.attemptKind : "verification",
          attemptStatus: null,
          failureCause: null,
          failureCode: null,
          verificationExitCode: null,
          signalPresent: null
        }
      });
  }
  if (context.decision.value !== null)
    pending.push({
      identity: "decision",
      referenced: false,
      row: {
        kind: "decision",
        relationship: "referenced_at_cancel",
        availability: "available",
        attemptKind: null,
        attemptStatus: null,
        failureCause: null,
        failureCode: null,
        verificationExitCode: null,
        signalPresent: null
      }
    });
  pending.sort((a, b) => compare(a.identity, b.identity));
  const projected = publicContext(context);
  const attemptKeys: string[] = [];
  const decisionKeys: string[] = [];
  for (const [index, p] of pending.entries()) {
    const evidenceKey = `evidence-${String(index + 1).padStart(3, "0")}`;
    technical.push({ evidenceKey, ...p.row });
    if (p.referenced) attemptKeys.push(evidenceKey);
    if (p.row.kind === "decision") decisionKeys.push(evidenceKey);
  }
  if (attemptKeys.length > 0)
    projected.attempt = cancellationValue(attemptKeys, context.attempt.source);
  if (decisionKeys.length > 0)
    projected.decision = cancellationValue(
      decisionKeys,
      context.decision.source
    );
  return { context: projected, technical };
}

export async function collectCancellationReport(
  repoRoot: string,
  options: EvaluationExportOptions,
  readers = { file: readCancellationFile, directory: readCancellationDirectory }
): Promise<CancellationReport> {
  const rootInventory = await readers.directory(repoRoot, ".banzai/runs");
  if (rootInventory.availability === "unavailable")
    throw new BanzaiError(
      "CANCELLATION_REPORT_UNAVAILABLE",
      "Cancellation report storage is not safely readable."
    );
  const candidates = rootInventory.entries.filter((e) => e.kind !== "file");
  if (options.runIds.some((id) => !candidates.some((c) => c.name === id)))
    throw new BanzaiError(
      "EVAL_RUN_NOT_FOUND",
      "An explicitly selected evaluation run does not exist."
    );
  const runs: CancellationReportRun[] = [];
  const issues: CancellationReport["issues"] = [];
  for (const [index, candidate] of candidates.entries()) {
    const row = emptyRun(`run-${String(index + 1).padStart(6, "0")}`);
    runs.push(row);
    if (options.runIds.length > 0 && !options.runIds.includes(candidate.name)) {
      row.membership = "excluded";
      continue;
    }
    const issue = (
      source: CancellationReport["issues"][number]["source"],
      field: string,
      code: string
    ) => {
      issues.push({ runKey: row.runKey, source, field, code });
      row.issueCodes.push(code);
    };
    if (candidate.kind === "unsafe" || !cancellationId(candidate.name)) {
      issue("inventory", "run", "UNSAFE_EVIDENCE");
      if (options.from !== null || options.to !== null)
        row.membership = "unresolved";
      continue;
    }
    const runId = candidate.name;
    const base = `.banzai/runs/${runId}`;
    const files: {
      relative: string;
      maximum: number;
      file: CancellationFile;
    }[] = [];
    const directories: {
      relative: string;
      directory: CancellationDirectory;
    }[] = [];
    const read = async (
      suffix: string,
      maximum: number,
      source: CancellationReport["issues"][number]["source"],
      field: string
    ) => {
      const relative = `${base}/${suffix}`;
      const file = await readers.file(repoRoot, relative, maximum);
      files.push({ relative, maximum, file });
      if (file.issue !== null) issue(source, field, file.issue);
      return file;
    };
    const directory = async (
      suffix: string,
      source: "model" | "verification"
    ) => {
      const relative = `${base}/${suffix}`;
      const directory = await readers.directory(repoRoot, relative);
      directories.push({ relative, directory });
      if (directory.issue !== null) issue(source, "inventory", directory.issue);
      return directory;
    };
    const parse = (file: CancellationFile): Record<string, unknown> => {
      if (file.text === null) return {};
      try {
        return cancellationRecord(JSON.parse(file.text));
      } catch {
        return {};
      }
    };
    const stateFile = await read(
      "state.json",
      CANCELLATION_LIMITS.state,
      "state",
      "state"
    );
    const state = parse(stateFile);
    try {
      if (state.runId !== runId) throw new Error();
      const decoded = parseEvaluationStateSource(state).value;
      row.lifecycle = {
        value: decoded.status.value,
        availability: decoded.status.value === null ? "malformed" : "available"
      };
      row.createdAt = {
        value: decoded.createdAt.value,
        availability:
          decoded.createdAt.value === null ? "malformed" : "available"
      };
      if (decoded.status.value === null)
        issue("state", "lifecycle", "MALFORMED_EVIDENCE");
    } catch {
      issue(
        "state",
        "state",
        stateFile.availability === "available"
          ? "MALFORMED_EVIDENCE"
          : "EVIDENCE_UNAVAILABLE"
      );
    }
    if (
      (options.from !== null || options.to !== null) &&
      row.createdAt.value === null
    )
      row.membership = "unresolved";
    else if (
      row.createdAt.value !== null &&
      ((options.from !== null && row.createdAt.value < options.from) ||
        (options.to !== null && row.createdAt.value >= options.to))
    )
      row.membership = "excluded";
    const eventFile = await read(
      "events.jsonl",
      CANCELLATION_LIMITS.events,
      "events",
      "observation"
    );
    const events = decodeCancellationEvents(eventFile);
    const resolved = resolveCancellation(
      state,
      runId,
      events.events,
      events.availability
    );
    if (row.lifecycle.value !== "cancelled") {
      if (events.events.length > 0 || state.cancellation !== undefined) {
        row.observation.availability = "conflicting";
        issue("events", "observation", "CANCELLATION_LIFECYCLE_CONFLICT");
      }
    } else {
      row.cancelledAt = {
        value: resolved.cancelledAt,
        availability:
          resolved.cancelledAt === null ? "unavailable" : "available"
      };
      row.observation.availability = resolved.availability;
      if (resolved.availability !== "available")
        issue(
          "events",
          "observation",
          `OBSERVATION_${resolved.availability.toUpperCase()}`
        );
      for (const code of resolved.issues) issue("events", "observation", code);
      if (
        ["available", "unanswered", "interrupted"].includes(
          resolved.availability
        ) &&
        resolved.response !== null
      ) {
        const response = resolved.response;
        row.observation = {
          availability: resolved.availability,
          reason: response.reason,
          provenance: response.provenance,
          channel: response.channel,
          responseState: response.state,
          recordedAt: response.recordedAt
        };
      }
      const sources: Sources = {
        model: [],
        verification: [],
        inventory: { model: "unavailable", verification: "unavailable" },
        modelInvalid: 0,
        verificationInvalid: 0,
        modelMissing: 0,
        verificationMissing: 0
      };
      const modelDirectory = await directory("attempts", "model");
      const verificationDirectory = await directory(
        "verification-attempts",
        "verification"
      );
      sources.inventory.model =
        modelDirectory.availability === "available"
          ? "complete"
          : "unavailable";
      const ledgerFile = await read(
        "verification-attempts/ledger.json",
        CANCELLATION_LIMITS.state,
        "verification",
        "ledger"
      );
      try {
        parseVerificationLedger(parse(ledgerFile));
        sources.inventory.verification =
          verificationDirectory.availability === "available"
            ? "complete"
            : "unavailable";
      } catch {
        issue("verification", "ledger", "VERIFICATION_INVENTORY_UNAVAILABLE");
      }
      let bytes = 0;
      let leafCount = 0;
      for (const kind of ["model", "verification"] as const) {
        const entries = (
          kind === "model" ? modelDirectory : verificationDirectory
        ).entries.filter((e) =>
          kind === "model"
            ? /-(selection|plan|implementation|fix|review)\.json$/u.test(e.name)
            : e.name !== "ledger.json" && e.name.endsWith(".json")
        );
        const identities = new Set<string>();
        for (const entry of entries) {
          leafCount++;
          if (
            leafCount > CANCELLATION_LIMITS.leaves ||
            bytes >= CANCELLATION_LIMITS.leafBytes
          ) {
            sources.inventory[kind] = "incomplete";
            issue(kind, "inventory", "EVIDENCE_LIMIT");
            break;
          }
          const file = await read(
            `${kind === "model" ? "attempts" : "verification-attempts"}/${entry.name}`,
            CANCELLATION_LIMITS.leafBytes - bytes,
            kind,
            "attempt"
          );
          bytes += file.fingerprint?.size ?? 0;
          try {
            if (file.availability !== "available") throw new Error();
            const raw = parse(file);
            if (kind === "model") {
              const decoded = parseEvaluationAttemptSource(raw).value;
              if (
                !cancellationId(decoded.identity) ||
                decoded.kind.value === null ||
                decoded.schemaVersion.value === null ||
                entry.name !== `${decoded.identity}-${decoded.kind.value}.json`
              )
                throw new Error();
              if (identities.has(decoded.identity)) {
                const previous = sources.model.findIndex(
                  (m) => m.source.identity === decoded.identity
                );
                if (previous !== -1) {
                  sources.model.splice(previous, 1);
                  sources.modelInvalid++;
                }
                throw new Error();
              }
              identities.add(decoded.identity);
              sources.model.push({ source: decoded, raw });
            } else {
              const record = parseVerificationAttemptRecord(raw);
              if (
                entry.name !==
                `verification-${String(record.sequence).padStart(6, "0")}-${record.id}.json`
              )
                throw new Error();
              if (
                identities.has(record.id) ||
                identities.has(`sequence:${record.sequence}`)
              ) {
                const previous = sources.verification.findIndex(
                  (v) => v.id === record.id || v.sequence === record.sequence
                );
                if (previous !== -1) {
                  sources.verification.splice(previous, 1);
                  sources.verificationInvalid++;
                }
                identities.add(record.id);
                identities.add(`sequence:${record.sequence}`);
                throw new Error();
              }
              identities.add(`sequence:${record.sequence}`);
              identities.add(record.id);
              sources.verification.push(record);
            }
          } catch {
            sources.inventory[kind] = "incomplete";
            sources[
              kind === "model" ? "modelInvalid" : "verificationInvalid"
            ]++;
            issue(kind, "attempt", "ATTEMPT_EVIDENCE_INVALID");
          }
        }
      }
      const counters = cancellationRecord(
        cancellationRecord(state.metrics).attempts
      );
      const modelCount = MODEL_KINDS.every(
        (k) => Number.isSafeInteger(counters[k]) && (counters[k] as number) >= 0
      )
        ? MODEL_KINDS.reduce((n, k) => n + (counters[k] as number), 0)
        : null;
      for (const kind of ["model", "verification"] as const) {
        const expected =
          kind === "model"
            ? modelCount
            : Number.isSafeInteger(counters.verification) &&
                (counters.verification as number) >= 0
              ? (counters.verification as number)
              : null;
        const length =
          kind === "model" ? sources.model.length : sources.verification.length;
        if (expected === null || expected !== length) {
          sources.inventory[kind] =
            sources.inventory[kind] === "unavailable"
              ? "unavailable"
              : "incomplete";
          sources[kind === "model" ? "modelMissing" : "verificationMissing"] =
            expected === null
              ? 0
              : Math.max(
                  0,
                  expected -
                    length -
                    sources[
                      kind === "model" ? "modelInvalid" : "verificationInvalid"
                    ]
                );
          issue(kind, "inventory", "ATTEMPT_INVENTORY_GAP");
        }
      }
      row.work = workFromSources(
        sources,
        row.cancelledAt.value,
        row.createdAt.value
      );
      const references = referenceTable(
        resolved.observation?.context ?? emptyCancellationContext(),
        sources,
        row.cancelledAt.value
      );
      row.context = references.context;
      row.technical = references.technical;
      const humanFile = await read(
        "human-time.json",
        CANCELLATION_LIMITS.humanTime,
        "human_time",
        "estimate"
      );
      const human = decodeHumanTime(parse(humanFile), runId);
      const effort =
        human.status === "valid"
          ? currentHumanTimeEffort(human.ledger.effortRevisions)
          : null;
      if (
        effort !== null &&
        row.cancelledAt.value !== null &&
        effort.asOf <= row.cancelledAt.value
      ) {
        row.work.activeTimeEstimate = {
          minutes: effort.minutes,
          basis: "estimated",
          scope: "single_engineer_unverified",
          asOf: effort.asOf,
          availability: "available"
        };
      } else if (humanFile.availability !== "missing")
        issue("human_time", "estimate", "ACTIVE_ESTIMATE_UNAVAILABLE");
      if (
        row.observation.availability === "available" &&
        row.observation.reason === "superseded"
      )
        row.continuation.intent = "reported_superseded";
    }
    let changed = false;
    for (const file of files) {
      const current = await readers.file(repoRoot, file.relative, file.maximum);
      if (
        JSON.stringify(current.fingerprint) !==
          JSON.stringify(file.file.fingerprint) ||
        current.availability !== file.file.availability
      )
        changed = true;
    }
    for (const entry of directories) {
      const current = await readers.directory(repoRoot, entry.relative);
      if (JSON.stringify(current) !== JSON.stringify(entry.directory))
        changed = true;
    }
    if (changed) {
      issue("inventory", "snapshot", "SOURCE_CHANGED");
      row.observation = {
        ...emptyRun(row.runKey).observation,
        availability: "unavailable"
      };
      row.context = publicContext(emptyCancellationContext());
      row.technical = [];
      row.work = emptyWork();
      row.continuation.intent = "not_reported";
    }
  }
  const afterInventory = await readers.directory(repoRoot, ".banzai/runs");
  if (JSON.stringify(afterInventory) !== JSON.stringify(rootInventory))
    issues.push({
      runKey: null,
      source: "inventory",
      field: "cohort",
      code: "SOURCE_CHANGED"
    });
  for (const row of runs)
    row.issueCodes = [...new Set(row.issueCodes)].sort(compare);
  issues.sort((a, b) =>
    compare(
      `${a.runKey ?? ""}/${a.source}/${a.field}/${a.code}`,
      `${b.runKey ?? ""}/${b.source}/${b.field}/${b.code}`
    )
  );
  const uniqueIssues = issues.filter(
    (issue, i) =>
      i === 0 || JSON.stringify(issue) !== JSON.stringify(issues[i - 1])
  );
  return {
    schema: CANCELLATION_REPORT_SCHEMA,
    schemaVersion: 1,
    cohort: {
      from: options.from,
      to: options.to,
      dateBasis: "run_created_at",
      explicitRuns: options.runIds.length > 0,
      selectedRunCount: options.runIds.length,
      candidateRunCount: candidates.length,
      includedRunCount: runs.filter((r) => r.membership === "included").length,
      excludedRunCount: runs.filter((r) => r.membership === "excluded").length,
      unresolvedRunCount: runs.filter((r) => r.membership === "unresolved")
        .length
    },
    runs,
    summary: summarize(runs),
    issues: uniqueIssues
  };
}

function summarize(
  runs: CancellationReportRun[]
): CancellationReport["summary"] {
  const included = runs.filter((r) => r.membership === "included");
  const cancelled = included.filter((r) => r.lifecycle.value === "cancelled");
  const count = cancelled.length;
  const coverage = (values: string[]): CancellationRunCoverage => ({
    exact: values.filter((v) => v === "complete").length,
    partial: values.filter((v) => v === "partial").length,
    unavailable: values.filter((v) => v !== "complete" && v !== "partial")
      .length
  });
  const aggregate = (field: CancellationResource) => {
    const metrics = cancelled.map((r) => r.work[field]);
    let combined =
      metrics.length === 0
        ? field === "reportedCostUsd"
          ? unavailableMetric()
          : exactMetric(0, 0)
        : combineMetrics(metrics);
    if (
      metrics.some((m) => m.availability !== "complete") &&
      combined.availability === "complete"
    )
      combined = {
        ...combined,
        value: null,
        availability: combined.observedCount > 0 ? "partial" : "unavailable"
      };
    return {
      ...combined,
      runCoverage: coverage(metrics.map((m) => m.availability))
    };
  };
  const work: CancellationWorkSummary = {
    modelAttempts: aggregate("modelAttempts"),
    verificationAttempts: aggregate("verificationAttempts"),
    modelDurationMs: aggregate("modelDurationMs"),
    verificationDurationMs: aggregate("verificationDurationMs"),
    inputTokens: aggregate("inputTokens"),
    cachedInputTokens: aggregate("cachedInputTokens"),
    outputTokens: aggregate("outputTokens"),
    reportedCostUsd: aggregate("reportedCostUsd"),
    runElapsedMs: coverage(
      cancelled.map((r) =>
        r.work.runElapsedMs.availability === "available"
          ? "complete"
          : "unavailable"
      )
    ),
    activeTimeEstimate: coverage(
      cancelled.map((r) =>
        r.work.activeTimeEstimate.availability === "available"
          ? "partial"
          : "unavailable"
      )
    )
  };
  const workflows: CancellationReport["summary"]["workflow"] = [];
  for (const workflow of [
    "strict",
    "feature",
    "quick-fix",
    "unselected",
    "unknown"
  ] as const) {
    const n = cancelled.filter(
      (r) => (r.context.workflow.value ?? "unknown") === workflow
    ).length;
    if (n > 0) workflows.push({ workflow, count: n, ratio: ratio(n, count) });
  }
  const phases = new Map<
    string,
    CancellationReport["summary"]["phaseGate"][number]
  >();
  for (const row of cancelled) {
    const fields = {
      status: row.context.status.value,
      blockedFrom: row.context.blockedFrom.value,
      gate: row.context.gate.value
    };
    const key = JSON.stringify(fields);
    const previous = phases.get(key);
    phases.set(key, {
      ...fields,
      count: (previous?.count ?? 0) + 1,
      ratio: ratio((previous?.count ?? 0) + 1, count)
    });
  }
  return {
    cancelledRunCount: count,
    nonCancelledRunCount: included.filter(
      (r) => r.lifecycle.value !== null && r.lifecycle.value !== "cancelled"
    ).length,
    unknownLifecycleRunCount: included.filter((r) => r.lifecycle.value === null)
      .length,
    reasons: CANCELLATION_REASONS.map((reason) => {
      const n = cancelled.filter(
        (r) =>
          r.observation.availability === "available" &&
          r.observation.reason === reason
      ).length;
      return { reason, count: n, ratio: ratio(n, count) };
    }),
    reasonCoverage: ratio(
      cancelled.filter(
        (r) =>
          r.observation.availability === "available" &&
          r.observation.provenance === "operator_reported" &&
          r.observation.reason !== "unspecified"
      ).length,
      count
    ),
    responseCoverage: ratio(
      cancelled.filter((r) => r.observation.availability === "available")
        .length,
      count
    ),
    observationAvailability: CANCELLATION_AVAILABILITIES.map((availability) => {
      const n = cancelled.filter(
        (r) => r.observation.availability === availability
      ).length;
      return { availability, count: n, ratio: ratio(n, count) };
    }),
    workflow: workflows,
    phaseGate: [...phases.entries()]
      .sort((a, b) => compare(a[0], b[0]))
      .map(([, value]) => value),
    work
  };
}
