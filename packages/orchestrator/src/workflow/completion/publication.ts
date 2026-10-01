import { createHash } from "node:crypto";
import { lstat, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { safePath } from "../../artifact-storage.js";
import {
  BanzaiError,
  InstructionResourceMismatchError,
  ProjectSetupRequiredError,
  TerminalRunStateError
} from "../../errors.js";
import { currentCommit, digestArtifactBundle } from "../../git.js";
import {
  composeCompletionCandidate,
  eligibleGapHeadings,
  ledgerDigest,
  PlanTaskCompletionError,
  planTaskDigest,
  scanCompletionRegion,
  validateCompletionClaims,
  type ValidatedCompletionClaims
} from "../../plan-task-completion.js";
import {
  type AttemptRecord,
  type AttemptReference,
  COMPLETION_CANDIDATE_SCHEMA,
  COMPLETION_PROTOCOL,
  COMPLETION_PUBLICATION_SCHEMA,
  COMPLETION_RECORD_SCHEMA_VERSION,
  COMPLETION_SUMMARY_SCHEMA_VERSION,
  type CompletionCandidate,
  type CompletionCapture,
  type CompletionPublication,
  type CompletionPublicationCursor,
  type CompletionPublicationStage,
  type OrchestratorConfig,
  type PhaseResult,
  type PhaseResultEnvelope,
  type PlanTaskCompletionLedger,
  type ReviewCompletionPublication,
  type RunState,
  type TerminalAttemptCheckpointV2,
  type ValidPlanTaskCompletionSummary
} from "../../types.js";
import {
  completionRecordIntegrity,
  envelopeResultFields,
  parsePersistedPhaseResult
} from "../../validation.js";
import {
  accountCompletedAttempt,
  attemptScopeDigest,
  completionProtocolAttempt
} from "../attempts/lifecycle.js";
import { type RunnerContext, timestamp } from "../context.js";
import {
  captureCompletionInput,
  completionCheckpointConfigurationCurrent,
  implementerConfigurationDigest
} from "./capture.js";
import { observeCompletionInputs, observeReport } from "./inputs.js";
import { approvedTaskIds, completionPlanPath } from "./plan-tasks.js";
import {
  CompletionRefusal,
  refuseCompletionPublication,
  rejectCompletionInput
} from "./refusal.js";

export async function storeCursor(
  context: RunnerContext,
  state: RunState,
  cursor: CompletionPublicationCursor
): Promise<void> {
  state.completionPublication = cursor;
  try {
    await context.store.writeState(state);
  } catch (error) {
    if (error instanceof TerminalRunStateError) throw error;
    throw new CompletionRefusal(
      "COMPLETION_PUBLICATION_IO",
      cursor.stage,
      cursor.receiptDigest ??
        cursor.candidateDigest ??
        cursor.captureDigest ??
        null,
      "Retry with banzai resume once storage is available, or cancel."
    );
  }
}

/** Resolves the canonical ledger a capture names; null-ledger fixes reuse the prior author. */
export async function completionLedgerFor(
  context: RunnerContext,
  state: RunState,
  record: AttemptRecord,
  envelope: PhaseResultEnvelope,
  capture: CompletionCapture
): Promise<PlanTaskCompletionLedger> {
  const source = capture.ledgerSource;
  if (source === null || envelope.taskCompletion.state !== "accepted")
    throw new PlanTaskCompletionError(
      envelope.taskCompletion.state === "unaccepted"
        ? "source_attempt_invalid"
        : "missing_ledger",
      envelope.taskCompletion.state === "unaccepted"
        ? envelope.taskCompletion.diagnostic
        : record.attempt.kind === "fix"
          ? "Completed fix has no canonical ledger source to republish."
          : "Strict implementation result is missing taskCompletion."
    );
  if (source.attemptId === record.attempt.id) {
    const ledger = envelope.taskCompletion.ledger;
    if (ledger === null || ledgerDigest(ledger) !== source.ledgerDigest)
      throw new CompletionRefusal(
        "COMPLETION_PUBLICATION_INTEGRITY",
        "validate",
        capture.integrityDigest,
        "The captured ledger does not match its recorded identity."
      );
    return ledger;
  }
  const author = await context.store.readRunAttemptIfExists(state.runId, {
    id: source.attemptId,
    kind: source.attemptKind,
    mutable: true
  });
  const ledger = author === null ? null : recordLedger(author);
  if (
    author?.status !== "completed" ||
    ledger === null ||
    ledgerDigest(ledger) !== source.ledgerDigest
  )
    throw new PlanTaskCompletionError(
      "source_attempt_invalid",
      "Canonical completion source attempt is missing, incomplete or changed."
    );
  return ledger;
}

/** The ledger a completed attempt record carries, under either protocol. */
export function recordLedger(
  record: AttemptRecord
): PlanTaskCompletionLedger | null {
  if (completionProtocolAttempt(record)) {
    const envelope = record.envelope ?? null;
    return envelope?.taskCompletion.state === "accepted"
      ? envelope.taskCompletion.ledger
      : null;
  }
  if (record.result === null) return null;
  try {
    return parsePersistedPhaseResult(record.result).taskCompletion;
  } catch {
    return null;
  }
}

export async function completionAuthorityCurrent(
  context: RunnerContext,
  state: RunState,
  capture: CompletionCapture,
  config: OrchestratorConfig
): Promise<boolean> {
  if (state.planApproval === null) return false;
  try {
    if ((await currentCommit(context.repoRoot)) !== capture.baseCommit)
      return false;
    const bundle = await digestArtifactBundle(
      context.repoRoot,
      state.planApproval.paths
    );
    return (
      bundle.digest === state.planApproval.digest &&
      capture.approvalDigest === state.planApproval.digest &&
      capture.planTaskDigest ===
        planTaskDigest(await approvedTaskIds(context, state)) &&
      capture.scopeDigest ===
        attemptScopeDigest(state, {
          id: capture.attemptId,
          kind: capture.attemptKind,
          mutable: true
        }) &&
      (capture.workBinding?.sha256 ?? null) ===
        (state.artifactBinding?.sha256 ?? null) &&
      // The implementer configuration that produced this result is part of
      // the recorded authority: `.banzai/config.json` is excluded from the
      // non-report workspace digest, so nothing else would detect its drift.
      capture.configurationDigest === implementerConfigurationDigest(config)
    );
  } catch {
    return false;
  }
}

/** Read-only authority check while a capture manifest is still incomplete. */
export async function completionCheckpointAuthorityCurrent(
  context: RunnerContext,
  state: RunState,
  record: AttemptRecord,
  checkpoint: TerminalAttemptCheckpointV2,
  config: OrchestratorConfig
): Promise<boolean> {
  const approval = state.planApproval;
  if (approval === null || record.envelope == null) return false;
  try {
    if ((await currentCommit(context.repoRoot)) !== checkpoint.baseCommit)
      return false;
    const bundle = await digestArtifactBundle(context.repoRoot, approval.paths);
    return (
      checkpoint.runId === state.runId &&
      checkpoint.attempt.id === record.attempt.id &&
      checkpoint.attempt.kind === record.attempt.kind &&
      checkpoint.phase === record.attempt.kind &&
      checkpoint.resultDigest === record.envelope.originalDigest &&
      checkpoint.baseCommit === state.baseCommit &&
      checkpoint.approvalDigest === approval.digest &&
      bundle.digest === approval.digest &&
      checkpoint.workflowDigest === null &&
      checkpoint.scopeDigest === attemptScopeDigest(state, record.attempt) &&
      completionCheckpointConfigurationCurrent(record, checkpoint, config)
    );
  } catch {
    return false;
  }
}

/**
 * Deterministic continuation from the last durable stage: validate, render,
 * persist the candidate, conditionally replace only the exact implementation
 * report, write the receipt and apply once. Every re-entry recognizes its
 * interruption boundary from retained proof and never invokes a model.
 */
export async function continueCompletionPublication(
  context: RunnerContext,
  state: RunState,
  record: AttemptRecord,
  config: OrchestratorConfig
): Promise<
  | { kind: "applied"; result: PhaseResult }
  | { kind: "stopped"; state: RunState }
> {
  const attempt = record.attempt as AttemptReference & {
    kind: "implementation" | "fix";
  };
  const envelope = record.envelope ?? null;
  if (envelope === null)
    return {
      kind: "stopped",
      state: await refuseCompletionPublication(
        context,
        state,
        record,
        new CompletionRefusal(
          "COMPLETION_PUBLICATION_INTEGRITY",
          "capture",
          null,
          "The captured envelope is missing; cancel the run."
        )
      )
    };
  let capture: CompletionCapture;
  try {
    const retainedCapture = await context.store.readCompletionCaptureIfExists(
      state.runId,
      attempt
    );
    if (retainedCapture === null) {
      const [retainedCandidate, retainedReceipt] = await Promise.all([
        context.store.readCompletionCandidateIfExists(state.runId, attempt),
        context.store.readCompletionPublicationIfExists(state.runId, attempt)
      ]);
      if (retainedCandidate !== null || retainedReceipt !== null)
        throw new CompletionRefusal(
          "COMPLETION_PUBLICATION_INTEGRITY",
          "capture",
          retainedReceipt?.captureDigest ??
            retainedCandidate?.candidate.captureDigest ??
            null,
          "Later publication evidence exists without its capture manifest; cancel the run unless intact proof can be reproduced by a corrected runner."
        );
    }
    capture =
      retainedCapture ??
      (await captureCompletionInput(
        context,
        state,
        record,
        envelope,
        config,
        "completed"
      ));
    if (
      state.completionPublication?.attemptId !== attempt.id ||
      state.completionPublication.captureDigest !== capture.integrityDigest
    )
      await storeCursor(context, state, {
        attemptId: attempt.id,
        attemptKind: attempt.kind,
        stage: "capture",
        captureDigest: capture.integrityDigest,
        candidateDigest: null,
        receiptDigest: null,
        refusal: null
      });
  } catch (error) {
    if (error instanceof TerminalRunStateError) throw error;
    // A capture-stage refusal already names its closed class, stage and
    // proof; it is never reclassified as transient storage failure.
    if (error instanceof CompletionRefusal)
      return {
        kind: "stopped",
        state: await refuseCompletionPublication(context, state, record, error)
      };
    const conflicting =
      error instanceof BanzaiError &&
      (error.code.startsWith("INVALID_COMPLETION") ||
        error.code === "COMPLETION_CAPTURE_CONFLICT");
    return {
      kind: "stopped",
      state: await refuseCompletionPublication(
        context,
        state,
        record,
        new CompletionRefusal(
          conflicting
            ? "COMPLETION_PUBLICATION_INTEGRITY"
            : "COMPLETION_PUBLICATION_IO",
          "capture",
          null,
          conflicting
            ? "Retained capture evidence is corrupt or conflicts with the recorded input; cancel the run."
            : "Retry with banzai resume once storage is available, or cancel."
        )
      )
    };
  }
  try {
    return await publishCapturedCompletion(
      context,
      state,
      record,
      envelope,
      capture,
      config
    );
  } catch (error) {
    if (
      error instanceof TerminalRunStateError ||
      error instanceof ProjectSetupRequiredError ||
      error instanceof InstructionResourceMismatchError
    )
      throw error;
    if (error instanceof PlanTaskCompletionError)
      return {
        kind: "stopped",
        state: await rejectCompletionInput(
          context,
          state,
          record,
          error,
          capture
        )
      };
    if (error instanceof CompletionRefusal)
      return {
        kind: "stopped",
        state: await refuseCompletionPublication(context, state, record, error)
      };
    throw error;
  }
}

export async function publishCapturedCompletion(
  context: RunnerContext,
  state: RunState,
  record: AttemptRecord,
  envelope: PhaseResultEnvelope,
  capture: CompletionCapture,
  config: OrchestratorConfig
): Promise<
  | { kind: "applied"; result: PhaseResult }
  | { kind: "stopped"; state: RunState }
> {
  const attempt = record.attempt as AttemptReference & {
    kind: "implementation" | "fix";
  };
  const proof = capture.integrityDigest;
  const drift = (message: string, stage: CompletionPublicationStage) =>
    new CompletionRefusal(
      "COMPLETION_PUBLICATION_DRIFT",
      stage,
      proof,
      `${message} Restore the exact recorded input or proven output and matching authority, then run banzai resume; otherwise cancel.`
    );
  const integrity = (message: string, stage: CompletionPublicationStage) =>
    new CompletionRefusal(
      "COMPLETION_PUBLICATION_INTEGRITY",
      stage,
      proof,
      `${message} Cancel the run unless intact proof can be reproduced by a corrected runner.`
    );
  const receipt = await context.store.readCompletionPublicationIfExists(
    state.runId,
    attempt
  );
  const existingCandidate = await context.store.readCompletionCandidateIfExists(
    state.runId,
    attempt
  );
  if (
    existingCandidate !== null &&
    existingCandidate.candidate.captureDigest !== proof
  )
    throw integrity(
      "The retained candidate belongs to a different capture.",
      "candidate"
    );
  if (receipt !== null) {
    if (
      receipt.captureDigest !== proof ||
      receipt.candidateDigest !== existingCandidate?.candidate.integrityDigest
    )
      throw integrity(
        "The retained receipt does not bind this capture and candidate.",
        "receipt"
      );
  }
  // Drift before validation: every later step assumes the captured inputs.
  const inputs = await observeCompletionInputs(
    context,
    state,
    envelope.artifacts
  );
  const currentImplementation = inputs.observed.implementationReport;
  const currentTest = inputs.observed.testReport;
  const capturedImplementation = capture.reports.implementationReport;
  const capturedTest = capture.reports.testReport;
  const published =
    existingCandidate !== null &&
    currentImplementation.state === "present" &&
    currentImplementation.sha256 === existingCandidate.candidate.outputSha256;
  if (
    !published &&
    (capturedImplementation.state !== "present" ||
      currentImplementation.state !== "present" ||
      currentImplementation.sha256 !== capturedImplementation.sha256)
  ) {
    if (capturedImplementation.state === "present")
      throw drift(
        "The implementation report no longer equals its captured input.",
        "publication"
      );
    throw new PlanTaskCompletionError(
      "implementation_report_missing",
      "Required implementation report was absent, unsafe or unavailable when the model returned."
    );
  }
  if (
    capturedTest.state !== "present" ||
    currentTest.state !== "present" ||
    currentTest.sha256 !== capturedTest.sha256
  ) {
    if (capturedTest.state === "present")
      throw drift(
        "The test report no longer equals its captured input.",
        "publication"
      );
    throw new PlanTaskCompletionError(
      "test_report_missing",
      "Required test report was absent, unsafe or unavailable when the model returned."
    );
  }
  if (
    inputs.observed.workspaceDigest === null ||
    inputs.observed.workspaceDigest !== capture.workspace.digest
  )
    throw drift(
      "The non-report workspace changed since capture.",
      "publication"
    );
  if (!(await completionAuthorityCurrent(context, state, capture, config)))
    throw drift(
      "Base commit, approval, plan tasks, scope, work binding or implementer configuration changed since capture.",
      "publication"
    );
  const originalImplementation =
    await context.store.readCompletionOriginalIfExists(
      state.runId,
      attempt,
      "implementationReport"
    );
  const originalTest = await context.store.readCompletionOriginalIfExists(
    state.runId,
    attempt,
    "testReport"
  );
  if (
    originalImplementation === null ||
    originalTest === null ||
    capture.originals.implementationReport === null ||
    capture.originals.testReport === null ||
    createHash("sha256").update(originalImplementation).digest("hex") !==
      capture.originals.implementationReport.sha256 ||
    createHash("sha256").update(originalTest).digest("hex") !==
      capture.originals.testReport.sha256
  )
    throw integrity(
      "Captured report originals are missing or changed.",
      "capture"
    );
  const originals = {
    implementationReport: originalImplementation,
    testReport: originalTest
  };
  const inputSha256 =
    capturedImplementation.state === "present"
      ? capturedImplementation.sha256
      : (existingCandidate?.candidate.inputSha256 ?? null);
  if (inputSha256 === null)
    throw integrity(
      "The captured implementation report identity is missing.",
      "capture"
    );
  if (state.planApproval === null)
    throw new PlanTaskCompletionError(
      "approval_invalid",
      "Strict completion validation requires an approved plan bundle."
    );
  // Validate: claims, evidence, authority, report roles and preserved gaps.
  const ledger = await completionLedgerFor(
    context,
    state,
    record,
    envelope,
    capture
  );
  const claims = await validateCompletionClaims({
    repoRoot: context.repoRoot,
    artifactBinding: state.artifactBinding,
    ledger,
    outcome: "completed",
    artifacts: envelope.artifacts,
    planPath: completionPlanPath(state),
    approval: state.planApproval,
    baseline: state.baseline,
    captured: originals
  });
  if (claims.testReport.sha256 !== capturedTest.sha256)
    throw integrity(
      "Captured test report identity conflicts with validation.",
      "validate"
    );
  // Render: deterministic candidate from the admitted ledger and preserved narrative.
  const composition = composeCompletionCandidate(
    originals.implementationReport,
    ledger
  );
  const outputSha256 = createHash("sha256")
    .update(composition.bytes)
    .digest("hex");
  const eligible = eligibleGapHeadings(
    composition.bytes.toString("utf8"),
    scanCompletionRegion(composition.bytes.toString("utf8"))
  );
  for (const task of ledger.tasks) {
    if (
      task.gap !== null &&
      task.gap.reportPath === claims.implementationReport.path &&
      !eligible.has(task.gap.section)
    )
      throw new PlanTaskCompletionError(
        "invalid_gap_reference",
        `${task.taskId} gap section is not a unique preserved heading of the final candidate.`,
        task.taskId
      );
  }
  let candidate: CompletionCandidate;
  if (existingCandidate !== null) {
    if (
      existingCandidate.candidate.outputSha256 !== outputSha256 ||
      existingCandidate.candidate.ledgerDigest !== claims.ledgerDigest
    )
      throw integrity(
        "The retained candidate differs from the deterministic rendering.",
        "candidate"
      );
    candidate = existingCandidate.candidate;
  } else {
    const metadata: Omit<CompletionCandidate, "integrityDigest"> = {
      schema: COMPLETION_CANDIDATE_SCHEMA,
      schemaVersion: COMPLETION_RECORD_SCHEMA_VERSION,
      runId: state.runId,
      attemptId: attempt.id,
      attemptKind: attempt.kind,
      completionProtocol: COMPLETION_PROTOCOL,
      captureDigest: proof,
      ledgerDigest: claims.ledgerDigest,
      destination: claims.implementationReport.path,
      inputSha256,
      candidatePath: context.store.completionEvidenceRelativePath(
        state.runId,
        attempt,
        "completion-candidate.md"
      ),
      outputSha256,
      outputBytes: composition.bytes.length,
      testReportSha256: capturedTest.sha256,
      region: composition.region,
      preservation: "verified",
      roundtrip: "verified"
    };
    candidate = {
      ...metadata,
      integrityDigest: completionRecordIntegrity(metadata)
    };
    try {
      await context.store.writeCompletionCandidate(
        state.runId,
        candidate,
        composition.bytes
      );
    } catch (error) {
      if (error instanceof TerminalRunStateError) throw error;
      throw new CompletionRefusal(
        "COMPLETION_PUBLICATION_IO",
        "candidate",
        proof,
        "Retry with banzai resume once storage is available, or cancel."
      );
    }
  }
  await storeCursor(context, state, {
    attemptId: attempt.id,
    attemptKind: attempt.kind,
    stage: "candidate",
    captureDigest: proof,
    candidateDigest: candidate.integrityDigest,
    receiptDigest: receipt?.integrityDigest ?? null,
    refusal: null
  });
  // Publish: recheck cancellation and destination ownership, then replace
  // only the exact implementation report with a same-directory rename.
  const current = await context.store.readState(state.runId);
  if (current.status === "cancelled")
    return { kind: "stopped", state: current };
  const destination = path.join(context.repoRoot, candidate.destination);
  if (!published) {
    if (candidate.destination.startsWith(".banzai/"))
      await safePath(context.repoRoot, candidate.destination);
    const before = await observeReport(context, candidate.destination);
    if (
      before.observation.state !== "present" ||
      before.observation.sha256 !== candidate.inputSha256
    )
      throw drift(
        "The implementation report changed before publication.",
        "publication"
      );
    try {
      const mode = (await lstat(destination)).mode & 0o777;
      const temporary = `${destination}.${context.ids()}.completion.tmp`;
      await writeFile(temporary, composition.bytes, { flag: "wx", mode });
      try {
        await rename(temporary, destination);
      } catch (error) {
        await unlink(temporary).catch(() => undefined);
        throw error;
      }
    } catch (error) {
      if (error instanceof TerminalRunStateError) throw error;
      throw new CompletionRefusal(
        "COMPLETION_PUBLICATION_IO",
        "publication",
        candidate.integrityDigest,
        "Retry with banzai resume once storage is available, or cancel."
      );
    }
  }
  const final = await observeReport(context, candidate.destination);
  if (
    final.observation.state !== "present" ||
    final.observation.sha256 !== candidate.outputSha256
  )
    throw integrity(
      "The published implementation report does not equal the candidate bytes.",
      "publication"
    );
  // Receipt: immutable, bound to capture, candidate and terminal proof.
  let sealedReceipt: CompletionPublication;
  if (receipt !== null) {
    sealedReceipt = receipt;
  } else {
    const ledgerAuthor = capture.ledgerSource ?? {
      attemptId: attempt.id,
      attemptKind: attempt.kind,
      ledgerDigest: claims.ledgerDigest
    };
    const body: Omit<CompletionPublication, "integrityDigest"> = {
      schema: COMPLETION_PUBLICATION_SCHEMA,
      schemaVersion: COMPLETION_RECORD_SCHEMA_VERSION,
      runId: state.runId,
      attemptId: attempt.id,
      attemptKind: attempt.kind,
      completionProtocol: COMPLETION_PROTOCOL,
      captureDigest: proof,
      candidateDigest: candidate.integrityDigest,
      terminalIntegrityDigest: capture.terminalIntegrityDigest,
      authority: {
        baseCommit: capture.baseCommit,
        approvalDigest: capture.approvalDigest,
        planTaskDigest: capture.planTaskDigest,
        scopeDigest: capture.scopeDigest,
        workBindingSha256: capture.workBinding?.sha256 ?? null,
        configurationDigest: capture.configurationDigest
      },
      ledgerAuthor,
      publisher: { attemptId: attempt.id, attemptKind: attempt.kind },
      implementationReport: {
        path: candidate.destination,
        sha256: candidate.outputSha256
      },
      testReport: {
        path: claims.testReport.path,
        sha256: capturedTest.sha256
      },
      // Receipt identity remains stable when publication resumes later.
      publishedAt: capture.capturedAt
    };
    sealedReceipt = {
      ...body,
      integrityDigest: completionRecordIntegrity(body)
    };
    try {
      await context.store.writeCompletionPublication(
        state.runId,
        sealedReceipt
      );
    } catch (error) {
      if (error instanceof TerminalRunStateError) throw error;
      throw new CompletionRefusal(
        "COMPLETION_PUBLICATION_IO",
        "receipt",
        candidate.integrityDigest,
        "Retry with banzai resume once storage is available, or cancel."
      );
    }
  }
  // Apply once: attempt completion, canonical summary, cursor and events.
  return {
    kind: "applied",
    result: await applyCompletionPublication(
      context,
      state,
      record,
      envelope,
      ledger,
      claims,
      sealedReceipt
    )
  };
}

export async function applyCompletionPublication(
  context: RunnerContext,
  state: RunState,
  record: AttemptRecord,
  envelope: PhaseResultEnvelope,
  ledger: PlanTaskCompletionLedger,
  claims: ValidatedCompletionClaims,
  receipt: CompletionPublication
): Promise<PhaseResult> {
  const attempt = record.attempt as AttemptReference & {
    kind: "implementation" | "fix";
  };
  const io = (stage: CompletionPublicationStage) =>
    new CompletionRefusal(
      "COMPLETION_PUBLICATION_IO",
      stage,
      receipt.integrityDigest,
      "Retry with banzai resume once storage is available, or cancel."
    );
  if (record.status !== "completed") {
    record.status = "completed";
    record.completedAt ??= timestamp(context);
    record.durationMs ??=
      Date.parse(record.completedAt) - Date.parse(record.startedAt);
    record.error = null;
    record.failureCode = null;
    try {
      await context.store.writeRunAttempt(state.runId, record);
    } catch (error) {
      if (error instanceof TerminalRunStateError) throw error;
      throw io("attempt");
    }
  }
  const current = await context.store.readState(state.runId);
  if (current.status === "cancelled") throw new TerminalRunStateError(current);
  accountCompletedAttempt(state, record);
  const refreshedFix =
    attempt.kind === "fix" && receipt.ledgerAuthor.attemptId === attempt.id;
  const durable = state.planTaskCompletion;
  // Re-entry after an interrupted application completes the missing writes
  // without restamping a summary this exact receipt already established.
  const applied =
    durable?.status === "valid" &&
    durable.schemaVersion === COMPLETION_SUMMARY_SCHEMA_VERSION &&
    durable.publication?.sha256 === receipt.integrityDigest;
  if (!applied)
    state.planTaskCompletion = {
      schemaVersion: COMPLETION_SUMMARY_SCHEMA_VERSION,
      status: "valid",
      sourceAttemptId: receipt.ledgerAuthor.attemptId,
      sourceAttemptKind: receipt.ledgerAuthor.attemptKind,
      approvalDigest: claims.approvalDigest,
      planTaskDigest: claims.planTaskDigest,
      ledgerDigest: claims.ledgerDigest,
      implementationReport: receipt.implementationReport,
      testReport: receipt.testReport,
      counts: claims.counts,
      validatedAt: timestamp(context),
      completionProtocol: COMPLETION_PROTOCOL,
      publisherAttemptId: attempt.id,
      publication: {
        path: context.store.completionEvidenceRelativePath(
          state.runId,
          attempt,
          "completion-publication.json"
        ),
        sha256: receipt.integrityDigest
      }
    };
  state.completionPublication = {
    attemptId: attempt.id,
    attemptKind: attempt.kind,
    stage: "state",
    captureDigest: receipt.captureDigest,
    candidateDigest: receipt.candidateDigest,
    receiptDigest: receipt.integrityDigest,
    refusal: null
  };
  state.activeProcess = null;
  try {
    await context.store.writeState(state);
  } catch (error) {
    if (error instanceof TerminalRunStateError) throw error;
    throw io("state");
  }
  try {
    await context.store.appendEventOnce(
      state.runId,
      "completion.publication_applied",
      {
        attemptId: attempt.id,
        attemptKind: attempt.kind,
        stage: "event",
        proofDigest: receipt.integrityDigest,
        code: null,
        violation: null,
        taskId: null
      }
    );
    if (refreshedFix)
      await context.store.appendEventOnce(
        state.runId,
        "plan_task_completion.refreshed",
        {
          attemptId: attempt.id,
          ledgerDigest: claims.ledgerDigest
        }
      );
  } catch (error) {
    if (error instanceof TerminalRunStateError) throw error;
    throw io("event");
  }
  if (state.completionPublication.stage !== "event") {
    await storeCursor(context, state, {
      ...state.completionPublication,
      stage: "event"
    });
  }
  return { ...envelopeResultFields(envelope), taskCompletion: ledger };
}

/**
 * Read-only revalidation of a runner-published completion: canonical source,
 * receipt, final report hashes, task set, evidence paths and authority. No
 * report write, receipt creation or digest refresh happens here.
 */
/** Receipt, capture and candidate identities frozen into a v5 review snapshot. */
export async function frozenCompletionPublication(
  context: RunnerContext,
  state: RunState,
  summary: ValidPlanTaskCompletionSummary
): Promise<ReviewCompletionPublication | null> {
  if (
    summary.schemaVersion !== COMPLETION_SUMMARY_SCHEMA_VERSION ||
    summary.publisherAttemptId === undefined ||
    summary.publication === undefined
  )
    return null;
  const receipt = await context.store.readCompletionPublicationIfExists(
    state.runId,
    { id: summary.publisherAttemptId }
  );
  if (receipt?.integrityDigest !== summary.publication.sha256)
    throw new BanzaiError(
      "INVALID_REVIEW_SNAPSHOT",
      "The published completion receipt is missing or conflicts with the canonical summary."
    );
  return {
    completionProtocol: COMPLETION_PROTOCOL,
    publisherAttemptId: summary.publisherAttemptId,
    receiptPath: summary.publication.path,
    receiptDigest: receipt.integrityDigest,
    captureDigest: receipt.captureDigest,
    candidateDigest: receipt.candidateDigest
  };
}
