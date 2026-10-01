import { createHash } from "node:crypto";
import { BanzaiError } from "../../errors.js";
import { FALLBACK_VENDOR, vendorFor } from "../../models.js";
import { ledgerDigest, planTaskDigest } from "../../plan-task-completion.js";
import {
  type AttemptRecord,
  type AttemptReference,
  COMPLETION_CAPTURE_SCHEMA,
  COMPLETION_PROTOCOL,
  COMPLETION_RECORD_SCHEMA_VERSION,
  COMPLETION_TRANSITION_SCHEMA,
  type CompletionCapture,
  type CompletionTransition,
  type OrchestratorConfig,
  type PhaseResultEnvelope,
  type RunState,
  type TerminalAttemptCheckpointV2
} from "../../types.js";
import {
  completionRecordIntegrity,
  digestCanonicalJson
} from "../../validation.js";
import { attemptScopeDigest } from "../attempts/lifecycle.js";
import type { RunnerContext } from "../context.js";
import { sessionContext } from "../domain/sessions.js";
import { observeCompletionInputs, sameObservedInputs } from "./inputs.js";
import { approvedTaskIds } from "./plan-tasks.js";
import { CompletionRefusal } from "./refusal.js";

/**
 * Moves a v4/v6 run to schema 7 exactly once, when its first strict attempt
 * under the completion protocol is created. The exact prior state bytes are
 * retained as attempt-owned transition evidence before the new state exists,
 * and the run keeps its binding, verification mode and configuration setup.
 */
export async function transitionToCompletionState(
  context: RunnerContext,
  state: RunState,
  attempt: AttemptReference & { kind: "implementation" | "fix" }
): Promise<void> {
  if (state.schemaVersion === 7 || state.schemaVersion === 8) return;
  if (
    state.schemaVersion !== 3 &&
    state.schemaVersion !== 4 &&
    state.schemaVersion !== 6
  )
    throw new BanzaiError(
      "COMPLETION_STATE_UNSUPPORTED",
      `Run state v${state.schemaVersion} cannot host a runner-owned completion attempt. Cancel this run and start a new one.`
    );
  const priorBytes = await context.store.readStateBytes(state.runId);
  const transition: Omit<CompletionTransition, "integrityDigest"> = {
    schema: COMPLETION_TRANSITION_SCHEMA,
    schemaVersion: COMPLETION_RECORD_SCHEMA_VERSION,
    runId: state.runId,
    attemptId: attempt.id,
    attemptKind: attempt.kind,
    completionProtocol: COMPLETION_PROTOCOL,
    priorState: {
      schemaVersion: state.schemaVersion,
      path: context.store.completionEvidenceRelativePath(
        state.runId,
        attempt,
        "completion-state-input.json"
      ),
      sha256: createHash("sha256").update(priorBytes).digest("hex")
    }
  };
  await context.store.writeCompletionTransition(
    state.runId,
    { ...transition, integrityDigest: completionRecordIntegrity(transition) },
    priorBytes
  );
  state.schemaVersion = 7;
  state.completionPublication = null;
}

export function implementerConfigurationDigest(
  config: OrchestratorConfig
): string {
  const settings = config.models.implementer;
  return digestCanonicalJson({
    version: 1,
    vendor: vendorFor(settings.executable) ?? FALLBACK_VENDOR.implementer,
    executableDigest: digestCanonicalJson(settings.executable),
    model: settings.model,
    effort: settings.effort
  });
}

export function completionCheckpointConfigurationCurrent(
  record: AttemptRecord,
  checkpoint: TerminalAttemptCheckpointV2,
  config: OrchestratorConfig
): boolean {
  const settings = config.models.implementer;
  const expectedContext =
    record.sessionContext ?? sessionContext("implementer", settings);
  return (
    checkpoint.configuration.vendor ===
      (vendorFor(settings.executable) ?? FALLBACK_VENDOR.implementer) &&
    checkpoint.configuration.executableDigest ===
      digestCanonicalJson(settings.executable) &&
    checkpoint.configuration.model === settings.model &&
    checkpoint.configuration.effort === settings.effort &&
    checkpoint.configuration.sessionMode === (record.sessionMode ?? "fresh") &&
    checkpoint.configuration.sessionContextDigest ===
      digestCanonicalJson(expectedContext)
  );
}

/**
 * Capture: retain the original decoded result, terminal identity, authority
 * identities and byte-identical report originals before any validation. A
 * missing input identity is recorded as absent or unavailable, never inferred.
 */
export async function captureCompletionInput(
  context: RunnerContext,
  state: RunState,
  record: AttemptRecord,
  envelope: PhaseResultEnvelope,
  config: OrchestratorConfig,
  outcome: "completed" | "stop"
): Promise<CompletionCapture> {
  const attempt = record.attempt as AttemptReference & {
    kind: "implementation" | "fix";
  };
  const approval = state.planApproval;
  if (approval === null)
    throw new BanzaiError("PLAN_NOT_APPROVED", "Plan approval is missing.");
  const checkpoint = await context.store.readTerminalCheckpointIfExists(
    state.runId,
    attempt
  );
  if (!checkpoint || !("envelope" in checkpoint))
    throw new CompletionRefusal(
      "COMPLETION_PUBLICATION_INTEGRITY",
      "capture",
      checkpoint?.integrityDigest ?? null,
      "The exact terminal input observation is unavailable; cancel the run unless intact proof can be reproduced by a corrected runner."
    );
  if (checkpoint.observed.workspaceDigest === null)
    throw new CompletionRefusal(
      "COMPLETION_PUBLICATION_INTEGRITY",
      "capture",
      checkpoint.integrityDigest,
      "The terminal checkpoint did not prove the non-report workspace identity; cancel the run unless intact proof can be reproduced by a corrected runner."
    );
  if (!completionCheckpointConfigurationCurrent(record, checkpoint, config))
    throw new CompletionRefusal(
      "COMPLETION_PUBLICATION_DRIFT",
      "capture",
      checkpoint.integrityDigest,
      "The implementer configuration or session context changed after the model returned. Restore the exact recorded authority, then run banzai resume; otherwise cancel."
    );
  const transition = await context.store.readCompletionTransitionIfExists(
    state.runId,
    attempt
  );
  const inputs = await observeCompletionInputs(
    context,
    state,
    envelope.artifacts
  );
  // ADR-0047 section 4: the capture baseline is the input the runner observed
  // when the vendor returned, never a second read of files that may have
  // changed after it. A restart before the manifest or an original was
  // durable must prove those exact identities again; anything else is drift
  // with an explicit restore-then-resume route, never an adopted new input.
  const proven = checkpoint.observed;
  if (!sameObservedInputs(inputs.observed, proven))
    throw new CompletionRefusal(
      "COMPLETION_PUBLICATION_DRIFT",
      "capture",
      checkpoint.integrityDigest,
      "A required report or the non-report workspace changed after the model returned. Restore the exact recorded input and matching authority, then run banzai resume; otherwise cancel."
    );
  const observed = proven;
  const originals: CompletionCapture["originals"] = {
    implementationReport: null,
    testReport: null
  };
  if (inputs.bytes.implementationReport !== null)
    originals.implementationReport =
      await context.store.writeCompletionOriginal(
        state.runId,
        attempt,
        "implementationReport",
        inputs.bytes.implementationReport
      );
  if (inputs.bytes.testReport !== null)
    originals.testReport = await context.store.writeCompletionOriginal(
      state.runId,
      attempt,
      "testReport",
      inputs.bytes.testReport
    );
  const accepted =
    envelope.taskCompletion.state === "accepted"
      ? envelope.taskCompletion.ledger
      : null;
  const prior = state.planTaskCompletion;
  const ledgerSource: CompletionCapture["ledgerSource"] =
    accepted !== null
      ? {
          attemptId: attempt.id,
          attemptKind: attempt.kind,
          ledgerDigest: ledgerDigest(accepted)
        }
      : attempt.kind === "fix" &&
          envelope.taskCompletion.state === "accepted" &&
          prior?.status === "valid"
        ? {
            attemptId: prior.sourceAttemptId,
            attemptKind: prior.sourceAttemptKind ?? "implementation",
            ledgerDigest: prior.ledgerDigest
          }
        : null;
  const capture: Omit<CompletionCapture, "integrityDigest"> = {
    schema: COMPLETION_CAPTURE_SCHEMA,
    schemaVersion: COMPLETION_RECORD_SCHEMA_VERSION,
    runId: state.runId,
    attemptId: attempt.id,
    attemptKind: attempt.kind,
    completionProtocol: COMPLETION_PROTOCOL,
    outcome,
    resultDigest: envelope.originalDigest,
    terminalIntegrityDigest: checkpoint.integrityDigest,
    transitionDigest: transition?.integrityDigest ?? null,
    baseCommit: state.baseCommit,
    approvalDigest: approval.digest,
    planTaskDigest: planTaskDigest(await approvedTaskIds(context, state)),
    workBinding:
      state.artifactBinding === undefined
        ? null
        : {
            workId: state.artifactBinding.binding.workId,
            sha256: state.artifactBinding.sha256
          },
    configurationDigest: implementerConfigurationDigest(config),
    scopeDigest: attemptScopeDigest(state, attempt),
    ledgerSource,
    reports: {
      implementationReport: observed.implementationReport,
      testReport: observed.testReport
    },
    originals,
    workspace: {
      digest: observed.workspaceDigest ?? "0".repeat(64),
      excludedPaths: inputs.excludedPaths
    },
    // Identity-bearing time comes from durable terminal proof, not retry time.
    capturedAt: checkpoint.terminal.observedAt
  };
  const sealed: CompletionCapture = {
    ...capture,
    integrityDigest: completionRecordIntegrity(capture)
  };
  await context.store.writeCompletionCapture(state.runId, sealed);
  return sealed;
}

/**
 * The exact rejected predecessor an evidence-repair successor links to. Only
 * a failed attempt of the same kind whose input the runner rejected under
 * PLAN_TASK_COMPLETION_INVALID is a predecessor; a canonical source rejected
 * at revalidation has no failed predecessor and links to nothing.
 */
export async function completionRetryPredecessor(
  context: RunnerContext,
  state: RunState,
  kind: "implementation" | "fix"
): Promise<string | null> {
  const checkpoint = state.planTaskCompletion;
  if (checkpoint?.status !== "invalid") return null;
  if ((checkpoint.sourceAttemptKind ?? "implementation") !== kind) return null;
  const predecessor = await context.store.readRunAttemptIfExists(state.runId, {
    id: checkpoint.sourceAttemptId,
    kind,
    mutable: true
  });
  if (
    predecessor?.status !== "failed" ||
    predecessor.failureCode !== "PLAN_TASK_COMPLETION_INVALID"
  )
    return null;
  return predecessor.attempt.id;
}

/**
 * The persisted failure message of a rejected completion source attempt, so
 * a repair prompt names the exact offending field instead of only a
 * violation class. A missing or unreadable record degrades to null; the
 * repair stays available without it.
 */
export async function completionRepairDiagnostic(
  context: RunnerContext,
  state: RunState,
  sourceAttemptId: string,
  sourceAttemptKind: "implementation" | "fix" = "implementation"
): Promise<string | null> {
  try {
    const record = await context.store.readRunAttempt(state.runId, {
      id: sourceAttemptId,
      kind: sourceAttemptKind,
      mutable: true
    });
    return record.error;
  } catch {
    return null;
  }
}
