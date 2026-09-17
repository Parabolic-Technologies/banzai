import {
  parseVerificationDecision,
  parseVerificationApplicability
} from "./verification-evidence.js";
import { parseBinding } from "./artifact-storage.js";
import {
  validateConfigurationStateEnvelope,
  CONFIGURATION_ACTIONS,
  configurationText,
  hasConfigurationSetup,
  parseConfigurationPrerequisite,
  parseConfigurationSetupState
} from "./configuration-prerequisite.js";
import { usesVerificationPolicy } from "./verification.js";
import { createHash, randomUUID } from "node:crypto";
import { constants, readFileSync, unlinkSync } from "node:fs";
import {
  lstat,
  link,
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
  rename,
  unlink,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { BanzaiError, TerminalRunStateError } from "./errors.js";
import {
  CANCELLATION_STATUSES,
  cancellationRecord,
  decodeCancellationAnchor
} from "./cancellation.js";
import {
  cancellationEvidencePath,
  cancellationFileIdentityMatches,
  CANCELLATION_LIMITS,
  readCancellationFile
} from "./cancellation-evidence.js";
import type { CancellationFingerprint } from "./cancellation-evidence.js";
import { decodeContextAttemptLedger } from "./context-accounting.js";
import {
  assertReviewPathOwned,
  parseReviewSnapshot
} from "./review-snapshot.js";
import type {
  AttemptRecord,
  AttemptReference,
  ContextAttemptLedger,
  ContextInvocationEvidence,
  EscalationDecisionRecord,
  EscalationDecisionRequest,
  CompletionCandidate,
  CompletionCapture,
  CompletionPublication,
  CompletionTransition,
  PersistedTerminalCheckpoint,
  RecoveryAuthorization,
  ReviewReference,
  ReviewSnapshot,
  RunMetrics,
  RunState,
  TerminalCheckpointResult,
  TriageRecord,
  VerificationAttemptLogEvidence,
  VerificationAttemptRecord,
  VerificationCommandDescriptor
} from "./types.js";
import {
  CONTRACT_VERSION,
  CONTEXT_ATTEMPT_SCHEMA,
  CONTEXT_ATTEMPT_SCHEMA_VERSION,
  VERIFICATION_LEDGER_SCHEMA_VERSION
} from "./types.js";
import {
  parseCompletionCandidate,
  parseCompletionCapture,
  parseCompletionPublication,
  parseCompletionPublicationCursor,
  parseCompletionTransition,
  parseCurrentReviewResult,
  parseDecisionConsultationAnswers,
  parseDecisionConsultationRequest,
  parseModelAttemptRecord,
  parsePlanTaskCompletionCheckpoint,
  parseRecoveryAuthorization,
  parseTerminalAttemptCheckpoint,
  parseVerificationAttemptRecord,
  parseVerificationLedger
} from "./validation.js";

interface LockFile {
  schemaVersion: 1;
  pid: number;
  token: string;
  createdAt: string;
}

function safeEvidenceSegment(
  value: string,
  label: string,
  maximum = 300
): string {
  if (
    value.length === 0 ||
    value.length > maximum ||
    value === "." ||
    value === ".." ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(value)
  ) {
    throw new BanzaiError(
      "UNSAFE_EVIDENCE_PATH",
      `${label} must be a canonical safe path segment.`
    );
  }
  return value;
}

function containedEvidencePath(base: string, ...segments: string[]): string {
  const resolvedBase = path.resolve(base);
  const resolved = path.resolve(resolvedBase, ...segments);
  if (!resolved.startsWith(`${resolvedBase}${path.sep}`)) {
    throw new BanzaiError(
      "UNSAFE_EVIDENCE_PATH",
      "Evidence path escaped its owned directory."
    );
  }
  return resolved;
}

export interface RunnerLock {
  token: string;
  release(): Promise<void>;
}

/**
 * Locks this process currently owns, by lock path. Held here rather than on the
 * store so an interrupt can drop them without an instance: a signal kills the
 * `try/finally` that normally releases, and the file left behind makes the next
 * invocation report a live runner until the recorded pid is proven dead.
 */
const heldLocks = new Map<string, string>();

/**
 * Releases every lock this process still owns, synchronously, so it is safe on
 * the way out of a signal handler. A lock file whose token is no longer ours
 * belongs to a different runner and is left exactly as found.
 */
export function releaseHeldRunnerLocksSync(): void {
  for (const [lockPath, token] of [...heldLocks]) {
    heldLocks.delete(lockPath);
    try {
      const current = JSON.parse(
        readFileSync(lockPath, "utf8")
      ) as Partial<LockFile>;
      if (current.token !== token) {
        continue;
      }
      unlinkSync(lockPath);
    } catch {
      // Already released, replaced, or unreadable: never guess.
    }
  }
}

export interface RunEvent {
  at: string;
  type: string;
  runId: string;
  details: Record<string, unknown>;
}

async function atomicWriteJson(
  filePath: string,
  value: unknown,
  initialize = true
): Promise<void> {
  if (initialize) await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  const handle = await open(temporaryPath, "wx", 0o600);
  try {
    try {
      await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporaryPath, filePath);
  } finally {
    await unlink(temporaryPath).catch(() => undefined);
  }
}

async function readJson<T>(filePath: string, label: string): Promise<T> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch (error) {
    throw new BanzaiError(
      "STATE_READ_FAILED",
      `Could not read ${label}: ${(error as Error).message}`
    );
  }
}

type LegacyEscalationDecisionRequest = Omit<EscalationDecisionRequest, "kind">;
type LegacyEscalationDecisionRecord = Omit<EscalationDecisionRecord, "kind">;

interface LegacyRunStateV2 extends Omit<
  RunState,
  "schemaVersion" | "pendingHumanDecision" | "humanDecisions"
> {
  schemaVersion: 2;
  pendingHumanDecision?: LegacyEscalationDecisionRequest | null;
  humanDecisions?: LegacyEscalationDecisionRecord[];
}

interface LegacyRunState extends Omit<
  LegacyRunStateV2,
  | "schemaVersion"
  | "sessions"
  | "pendingReviewRotationReason"
  | "triageHistory"
  | "latestReview"
  | "metrics"
> {
  schemaVersion: 1;
  sessions: {
    planner: string | null;
    implementer: string | null;
  };
  latestReview: Omit<
    ReviewReference,
    "sessionMode" | "mode" | "rotationReason"
  > | null;
  metrics: Omit<RunMetrics, "sessions" | "reviews">;
}

function decisionStateError(): never {
  throw new BanzaiError(
    "STATE_READ_FAILED",
    "Persisted human decision state is malformed."
  );
}

function decisionStateRecord(
  value: unknown,
  keys: readonly string[]
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return decisionStateError();
  }
  const record = value as Record<string, unknown>;
  const allowed = new Set(keys);
  if (Object.keys(record).some((key) => !allowed.has(key))) {
    return decisionStateError();
  }
  return record;
}

function decisionStateString(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    return decisionStateError();
  }
  return value;
}

function decisionStateStringArray(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    return decisionStateError();
  }
  return value as string[];
}

function validateDecisionState(state: RunState): RunState {
  try {
    const pending = state.pendingHumanDecision ?? null;
    if (
      (state.status === "needs_human_decision" && pending === null) ||
      (state.status !== "needs_human_decision" && pending !== null)
    ) {
      return decisionStateError();
    }
    if (pending?.kind === "configuration_prerequisite") {
      if (
        !hasConfigurationSetup(state) ||
        state.configurationSetup === undefined ||
        pending.runId !== state.runId
      )
        return decisionStateError();
      state.pendingHumanDecision = parseConfigurationPrerequisite(
        pending,
        state.configurationSetup.configSchemaVersion
      );
    } else if (pending !== null) {
      const record = decisionStateRecord(
        pending,
        pending.kind === "escalation"
          ? ["kind", "phase", "gate", "summary", "questions", "requestedAt"]
          : ["kind", "phase", "gate", "summary", "request", "requestedAt"]
      );
      decisionStateString(record.summary);
      decisionStateString(record.requestedAt);
      if (pending.kind === "escalation") {
        if (record.gate !== "escalation") return decisionStateError();
        decisionStateStringArray(record.questions);
      } else if (
        record.phase === "plan" &&
        record.gate === "decision_consultation"
      ) {
        pending.request = parseDecisionConsultationRequest(record.request);
      } else {
        return decisionStateError();
      }
    }
    const requestIds = new Set<string>();
    const roundIds = new Set<string>();
    const decisionIds = new Set<string>();
    const configurationProposalIds = new Set<string>();
    for (const decision of state.humanDecisions ?? []) {
      if (decision.kind === "configuration_prerequisite") {
        if (
          !hasConfigurationSetup(state) ||
          state.configurationSetup === undefined ||
          decision.runId !== state.runId ||
          configurationProposalIds.has(decision.proposalId)
        )
          return decisionStateError();
        const { action, decidedAt, decidedBy, ...request } = decision;
        if (!CONFIGURATION_ACTIONS.includes(action))
          return decisionStateError();
        configurationText(decidedAt, 24);
        configurationText(decidedBy);
        parseConfigurationPrerequisite(
          request,
          state.configurationSetup.configSchemaVersion
        );
        configurationProposalIds.add(decision.proposalId);
        continue;
      }
      const record = decisionStateRecord(
        decision,
        decision.kind === "escalation"
          ? [
              "kind",
              "phase",
              "gate",
              "summary",
              "questions",
              "requestedAt",
              "answers",
              "decidedAt",
              "decidedBy"
            ]
          : [
              "kind",
              "phase",
              "gate",
              "summary",
              "request",
              "requestedAt",
              "runId",
              "requestId",
              "roundId",
              "answers",
              "decidedAt",
              "decidedBy"
            ]
      );
      decisionStateString(record.summary);
      decisionStateString(record.requestedAt);
      decisionStateString(record.decidedAt);
      decisionStateString(record.decidedBy);
      if (decision.kind === "escalation") {
        if (record.gate !== "escalation") return decisionStateError();
        decisionStateStringArray(record.questions);
        decisionStateStringArray(record.answers);
        continue;
      }
      if (
        record.phase !== "plan" ||
        record.gate !== "decision_consultation" ||
        record.runId !== state.runId
      ) {
        return decisionStateError();
      }
      const request = parseDecisionConsultationRequest(record.request);
      if (
        record.requestId !== request.requestId ||
        record.roundId !== request.roundId ||
        requestIds.has(request.requestId) ||
        roundIds.has(request.roundId) ||
        request.decisions.some((card) => decisionIds.has(card.decisionId))
      ) {
        return decisionStateError();
      }
      requestIds.add(request.requestId);
      roundIds.add(request.roundId);
      for (const card of request.decisions) decisionIds.add(card.decisionId);
      decision.request = request;
      decision.answers = parseDecisionConsultationAnswers(
        record.answers,
        request
      );
    }
    if (
      pending?.kind === "configuration_prerequisite" &&
      configurationProposalIds.has(pending.proposalId)
    )
      return decisionStateError();
    if (
      pending?.kind === "decision_consultation" &&
      (requestIds.has(pending.request.requestId) ||
        roundIds.has(pending.request.roundId) ||
        pending.request.decisions.some((card) =>
          decisionIds.has(card.decisionId)
        ))
    ) {
      return decisionStateError();
    }
    return state;
  } catch (error) {
    if (error instanceof BanzaiError && error.code === "STATE_READ_FAILED") {
      throw error;
    }
    return decisionStateError();
  }
}

function normalizeRunState(
  state: RunState | LegacyRunStateV2 | LegacyRunState
): RunState {
  if (![1, 2, 3, 4, 5, 6, 7].includes(state.schemaVersion)) {
    throw new BanzaiError(
      "ARTIFACT_VERSION_UNSUPPORTED",
      "Unsupported persisted run state version."
    );
  }
  if (state.schemaVersion < 4 && state.artifactBinding !== undefined) {
    throw new BanzaiError(
      "ARTIFACT_VERSION_UNSUPPORTED",
      "Legacy run state cannot acquire private binding semantics."
    );
  }
  if (state.schemaVersion === 7) {
    // Only the completion cursor is new. Everything else must remain one of
    // the combinations a v4 or v6 bootstrap could have produced.
    if (!Object.hasOwn(state, "completionPublication"))
      throw new BanzaiError(
        "ARTIFACT_VERSION_UNSUPPORTED",
        "Run state v7 requires its completion publication cursor."
      );
    if (state.completionPublication !== null)
      state.completionPublication = parseCompletionPublicationCursor(
        state.completionPublication
      );
    if (
      state.planTaskCompletion !== null &&
      state.planTaskCompletion !== undefined
    )
      state.planTaskCompletion = parsePlanTaskCompletionCheckpoint(
        state.planTaskCompletion
      );
  } else if ("completionPublication" in state) {
    throw new BanzaiError(
      "ARTIFACT_VERSION_UNSUPPORTED",
      "Legacy run state cannot carry a completion publication cursor."
    );
  } else if (
    state.planTaskCompletion !== null &&
    state.planTaskCompletion !== undefined &&
    state.planTaskCompletion.schemaVersion !== 1
  ) {
    throw new BanzaiError(
      "ARTIFACT_VERSION_UNSUPPORTED",
      "Legacy run state cannot carry runner-published completion evidence."
    );
  }
  // A schema-7 run keeps whichever binding combination its origin had: an
  // absent binding is valid only for a v3-origin run, which the later
  // verification-mode and configuration checks keep free of policy semantics.
  if (
    state.schemaVersion === 4 ||
    state.schemaVersion === 5 ||
    state.schemaVersion === 6 ||
    (state.schemaVersion === 7 && state.artifactBinding !== undefined)
  ) {
    if (
      state.artifactBinding === undefined ||
      !/^[0-9a-f]{64}$/.test(state.artifactBinding.sha256)
    ) {
      throw new BanzaiError(
        "ARTIFACT_RECOVERY_REQUIRED",
        "Run state v4 requires its original artifact binding."
      );
    }
    if (
      Object.keys(state.artifactBinding).sort().join(",") !==
        "binding,sha256" ||
      parseBinding(state.artifactBinding.binding).mode !== "workflow"
    )
      throw new BanzaiError(
        "ARTIFACT_RECOVERY_REQUIRED",
        "Run state requires an exact immutable workflow binding."
      );
  }
  if (
    (state.schemaVersion === 4 ||
      (state.schemaVersion === 7 &&
        state.artifactBinding !== undefined &&
        !hasConfigurationSetup(state))) &&
    state.artifactBinding?.binding.schemaVersion !== 1
  )
    throw new BanzaiError(
      "ARTIFACT_VERSION_UNSUPPORTED",
      "Run state v4 retains binding v1 semantics."
    );
  if (hasConfigurationSetup(state as RunState)) {
    if (
      state.verificationMode !== "ordered" &&
      state.verificationMode !== "policy"
    )
      return decisionStateError();
    state.configurationSetup = parseConfigurationSetupState(
      state.configurationSetup
    );
    if (
      state.artifactBinding?.binding.schemaVersion !==
        (state.verificationMode === "policy" ? 2 : 1) ||
      (state.verificationMode === "policy" &&
        state.configurationSetup.configSchemaVersion !== 3)
    )
      return decisionStateError();
  } else if ("verificationMode" in state || "configurationSetup" in state)
    return decisionStateError();
  const policy = usesVerificationPolicy(state as RunState);
  if (policy && state.verificationEvidence !== undefined) {
    parseVerificationDecision(state.verificationEvidence.decision);
    if (state.verificationEvidence.applicability !== null)
      parseVerificationApplicability(state.verificationEvidence.applicability);
  }
  if (
    state.schemaVersion === 5 &&
    state.artifactBinding?.binding.schemaVersion !== 2
  )
    throw new BanzaiError(
      "ARTIFACT_RECOVERY_REQUIRED",
      "Run state v5 requires its original verification-enabled binding."
    );
  if (!policy && state.verificationEvidence !== undefined)
    throw new BanzaiError(
      "ARTIFACT_VERSION_UNSUPPORTED",
      "Legacy state cannot acquire verification applicability."
    );
  if (
    state.schemaVersion === 3 ||
    state.schemaVersion === 4 ||
    state.schemaVersion === 5 ||
    state.schemaVersion === 6 ||
    state.schemaVersion === 7
  ) {
    const recovery = state.recovery ?? null;
    if (recovery !== null && recovery.stage === undefined) {
      recovery.stage =
        recovery.recoveryAttemptId === null
          ? state.activeAttempt?.id === recovery.sourceAttemptId
            ? "authorized"
            : "source_interrupted"
          : "attempt_started";
    }
    validateConfigurationStateEnvelope(state);
    return validateDecisionState(state);
  }
  if (state.schemaVersion === 2) {
    const normalized: RunState = {
      ...state,
      schemaVersion: 3,
      pendingHumanDecision:
        state.pendingHumanDecision === null ||
        state.pendingHumanDecision === undefined
          ? null
          : { kind: "escalation", ...state.pendingHumanDecision },
      humanDecisions: (state.humanDecisions ?? []).map((decision) => ({
        kind: "escalation",
        ...decision
      }))
    };
    const recovery = normalized.recovery ?? null;
    if (recovery !== null && recovery.stage === undefined) {
      recovery.stage =
        recovery.recoveryAttemptId === null
          ? normalized.activeAttempt?.id === recovery.sourceAttemptId
            ? "authorized"
            : "source_interrupted"
          : "attempt_started";
    }
    return validateDecisionState(normalized);
  }
  const triageHistory: TriageRecord[] =
    state.triage === null ? [] : [state.triage];
  const mayReviewAgain =
    state.status !== "done" &&
    state.status !== "cancelled" &&
    (state.workflowSelection?.workflow ?? "strict") === "strict";
  return validateDecisionState({
    ...state,
    schemaVersion: 3,
    pendingHumanDecision:
      state.pendingHumanDecision === null ||
      state.pendingHumanDecision === undefined
        ? null
        : { kind: "escalation", ...state.pendingHumanDecision },
    humanDecisions: (state.humanDecisions ?? []).map((decision) => ({
      kind: "escalation",
      ...decision
    })),
    sessions: { planner: null, implementer: null, reviewer: null },
    pendingReviewRotationReason: mayReviewAgain ? "legacy-state" : null,
    latestReview:
      state.latestReview === null
        ? null
        : {
            ...state.latestReview,
            sessionMode: "fresh",
            mode: "full",
            rotationReason: "legacy-state"
          },
    triageHistory,
    metrics: {
      ...state.metrics,
      sessions: { fresh: 0, resumed: 0 },
      reviews: {
        full: state.latestReview === null ? 0 : 1,
        delta: 0,
        rotations: 0
      }
    }
  });
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export class RunStore {
  readonly banzaiDirectory: string;
  readonly runsDirectory: string;
  readonly activeRunPath: string;
  readonly lockPath: string;

  constructor(readonly repoRoot: string) {
    this.banzaiDirectory = path.join(repoRoot, ".banzai");
    this.runsDirectory = path.join(this.banzaiDirectory, "runs");
    this.activeRunPath = path.join(this.banzaiDirectory, "active-run.json");
    this.lockPath = path.join(this.banzaiDirectory, "runner.lock");
  }

  runDirectory(runId: string): string {
    return containedEvidencePath(
      this.runsDirectory,
      safeEvidenceSegment(runId, "runId")
    );
  }

  statePath(runId: string): string {
    return path.join(this.runDirectory(runId), "state.json");
  }

  attemptPath(runId: string, attempt: AttemptReference): string {
    return containedEvidencePath(
      this.runDirectory(runId),
      "attempts",
      `${safeEvidenceSegment(attempt.id, "attempt.id", 200)}-${attempt.kind}.json`
    );
  }

  contextLedgerPath(runId: string, attempt: AttemptReference): string {
    return containedEvidencePath(
      this.runDirectory(runId),
      "attempts",
      `${safeEvidenceSegment(attempt.id, "attempt.id", 200)}.context.json`
    );
  }

  private approvalSnapshotManifestPath(runId: string): string {
    return containedEvidencePath(
      this.runDirectory(runId),
      "approval",
      "bundle.json"
    );
  }

  private approvalSnapshotFilePath(runId: string, file: string): string {
    return containedEvidencePath(this.runDirectory(runId), "approval", file);
  }

  /**
   * Stores the exact bytes of the approved planning artifacts beside the run
   * evidence. The approval record binds digests of files that are typically
   * uncommitted, so without this snapshot an externally mutated bundle has no
   * recoverable approved form.
   */
  async writeApprovalSnapshot(
    runId: string,
    digest: string,
    entries: { path: string; sha256: string; contents: Buffer }[]
  ): Promise<void> {
    await mkdir(path.join(this.runDirectory(runId), "approval"), {
      recursive: true,
      mode: 0o700
    });
    const manifest: { path: string; file: string; sha256: string }[] = [];
    for (const [index, entry] of entries.entries()) {
      const file = `${String(index).padStart(3, "0")}-${safeEvidenceSegment(
        path.posix.basename(entry.path),
        "approval artifact name",
        150
      )}`;
      await writeFile(
        this.approvalSnapshotFilePath(runId, file),
        entry.contents,
        { mode: 0o600 }
      );
      manifest.push({ path: entry.path, file, sha256: entry.sha256 });
    }
    await atomicWriteJson(this.approvalSnapshotManifestPath(runId), {
      schemaVersion: 1,
      digest,
      entries: manifest
    });
  }

  /** Null when the run predates approval snapshots or the snapshot is unreadable. */
  async readApprovalSnapshot(runId: string): Promise<{
    digest: string;
    entries: { path: string; sha256: string; contents: Buffer }[];
  } | null> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(
        await readFile(this.approvalSnapshotManifestPath(runId), "utf8")
      );
    } catch {
      return null;
    }
    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }
    const record = parsed as {
      schemaVersion?: unknown;
      digest?: unknown;
      entries?: unknown;
    };
    if (
      record.schemaVersion !== 1 ||
      typeof record.digest !== "string" ||
      !Array.isArray(record.entries)
    ) {
      return null;
    }
    const entries: { path: string; sha256: string; contents: Buffer }[] = [];
    for (const item of record.entries) {
      if (typeof item !== "object" || item === null) {
        return null;
      }
      const entry = item as {
        path?: unknown;
        file?: unknown;
        sha256?: unknown;
      };
      if (
        typeof entry.path !== "string" ||
        typeof entry.file !== "string" ||
        typeof entry.sha256 !== "string"
      ) {
        return null;
      }
      let contents: Buffer;
      try {
        contents = await readFile(
          this.approvalSnapshotFilePath(runId, entry.file)
        );
      } catch {
        return null;
      }
      entries.push({ path: entry.path, sha256: entry.sha256, contents });
    }
    return { digest: record.digest, entries };
  }

  reviewCandidatePath(runId: string, attempt: AttemptReference): string {
    return containedEvidencePath(
      this.runDirectory(runId),
      "attempts",
      `${safeEvidenceSegment(attempt.id, "attempt.id", 200)}.review-candidate.md`
    );
  }

  reviewSnapshotPath(runId: string, attempt: AttemptReference): string {
    return containedEvidencePath(
      this.runDirectory(runId),
      "attempts",
      `${safeEvidenceSegment(attempt.id, "attempt.id", 200)}.review-snapshot.json`
    );
  }

  async writeReviewSnapshot(
    runId: string,
    attempt: AttemptReference,
    value: ReviewSnapshot
  ): Promise<void> {
    const snapshot = parseReviewSnapshot(value);
    if (
      snapshot.runId !== runId ||
      snapshot.attemptId !== attempt.id ||
      attempt.kind !== "review" ||
      attempt.mutable
    )
      throw new BanzaiError(
        "INVALID_REVIEW_SNAPSHOT",
        "Review snapshot identity does not match its attempt."
      );
    const destination = this.reviewSnapshotPath(runId, attempt);
    const relative = path
      .relative(this.repoRoot, destination)
      .split(path.sep)
      .join("/");
    await assertReviewPathOwned(this.repoRoot, relative, true);
    await mkdir(path.dirname(destination), { recursive: true });
    const temporary = `${destination}.${randomUUID()}.tmp`;
    const handle = await open(temporary, "wx", 0o600);
    try {
      try {
        await handle.writeFile(`${JSON.stringify(snapshot, null, 2)}\n`);
        await handle.sync();
      } finally {
        await handle.close();
      }
      // An immutable leaf must never replace an existing snapshot, even on a race.
      try {
        await link(temporary, destination);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const existing = await this.readReviewSnapshot(runId, attempt);
        if (existing.digest !== snapshot.digest)
          throw new BanzaiError(
            "REVIEW_SNAPSHOT_CONFLICT",
            "Review snapshot already exists with different evidence."
          );
      }
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  }

  async readReviewSnapshot(
    runId: string,
    attempt: AttemptReference
  ): Promise<ReviewSnapshot> {
    const file = this.reviewSnapshotPath(runId, attempt);
    await assertReviewPathOwned(
      this.repoRoot,
      path.relative(this.repoRoot, file).split(path.sep).join("/")
    );
    const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || (stat.mode & 0o077) !== 0)
        throw new BanzaiError(
          "INVALID_REVIEW_SNAPSHOT",
          "Review snapshot must remain private regular evidence."
        );
      const snapshot = parseReviewSnapshot(
        JSON.parse(await handle.readFile("utf8")) as unknown
      );
      if (snapshot.runId !== runId || snapshot.attemptId !== attempt.id)
        throw new BanzaiError(
          "INVALID_REVIEW_SNAPSHOT",
          "Review snapshot identity conflicts with its path."
        );
      return snapshot;
    } finally {
      await handle.close();
    }
  }

  /**
   * Attempt-owned completion protocol evidence (ADR-0047). Every leaf lives
   * beside the attempt record under `attempts/` and is written once.
   */
  completionEvidencePath(
    runId: string,
    attempt: Pick<AttemptReference, "id">,
    leaf:
      | "completion-transition.json"
      | "completion-state-input.json"
      | "completion-input.json"
      | "implementation-input.md"
      | "test-input.md"
      | "completion-candidate.md"
      | "completion-candidate.json"
      | "completion-publication.json"
  ): string {
    return containedEvidencePath(
      this.runDirectory(runId),
      "attempts",
      `${safeEvidenceSegment(attempt.id, "attempt.id", 200)}.${leaf}`
    );
  }

  /** Run-relative evidence path as recorded in receipts and summaries. */
  completionEvidenceRelativePath(
    runId: string,
    attempt: Pick<AttemptReference, "id">,
    leaf: Parameters<RunStore["completionEvidencePath"]>[2]
  ): string {
    return path
      .relative(
        this.runDirectory(runId),
        this.completionEvidencePath(runId, attempt, leaf)
      )
      .split(path.sep)
      .join(path.posix.sep);
  }

  /**
   * Writes one immutable private leaf. A second write with identical bytes is
   * a no-op; different bytes under the same identity are a conflict. Bytes are
   * never replaced, so a crash between leaves leaves each leaf whole or absent.
   */
  private async writeImmutableEvidence(
    destination: string,
    bytes: Buffer,
    conflictCode: string
  ): Promise<void> {
    await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`;
    const handle = await open(temporary, "wx", 0o600);
    try {
      try {
        await handle.writeFile(bytes);
        await handle.sync();
      } finally {
        await handle.close();
      }
      try {
        await link(temporary, destination);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const existing = await this.readImmutableEvidence(destination);
        if (!existing?.equals(bytes))
          throw new BanzaiError(
            conflictCode,
            `${path.basename(destination)} already exists with different content.`
          );
      }
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  }

  /** Null when absent; every other failure surfaces as a bounded read error. */
  private async readImmutableEvidence(
    destination: string
  ): Promise<Buffer | null> {
    let handle;
    try {
      handle = await open(
        destination,
        constants.O_RDONLY | constants.O_NOFOLLOW
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw new BanzaiError(
        "STATE_READ_FAILED",
        `Could not read ${path.basename(destination)}: ${(error as Error).message}`
      );
    }
    try {
      const stat = await handle.stat();
      if (!stat.isFile())
        throw new BanzaiError(
          "UNSAFE_EVIDENCE_PATH",
          "Completion evidence must be a private regular file."
        );
      return await handle.readFile();
    } finally {
      await handle.close();
    }
  }

  async writeCompletionTransition(
    runId: string,
    transition: CompletionTransition,
    priorStateBytes: Buffer
  ): Promise<void> {
    const parsed = parseCompletionTransition(transition);
    const attempt = { id: parsed.attemptId, kind: parsed.attemptKind };
    if (
      parsed.runId !== runId ||
      parsed.priorState.path !==
        this.completionEvidenceRelativePath(
          runId,
          attempt,
          "completion-state-input.json"
        ) ||
      parsed.priorState.sha256 !==
        createHash("sha256").update(priorStateBytes).digest("hex")
    )
      throw new BanzaiError(
        "INVALID_COMPLETION_TRANSITION",
        "Completion transition does not bind the exact prior state bytes."
      );
    await this.writeImmutableEvidence(
      this.completionEvidencePath(
        runId,
        attempt,
        "completion-state-input.json"
      ),
      priorStateBytes,
      "COMPLETION_TRANSITION_CONFLICT"
    );
    await this.writeImmutableEvidence(
      this.completionEvidencePath(runId, attempt, "completion-transition.json"),
      Buffer.from(`${JSON.stringify(parsed, null, 2)}\n`),
      "COMPLETION_TRANSITION_CONFLICT"
    );
  }

  async readCompletionTransitionIfExists(
    runId: string,
    attempt: AttemptReference
  ): Promise<CompletionTransition | null> {
    const bytes = await this.readImmutableEvidence(
      this.completionEvidencePath(runId, attempt, "completion-transition.json")
    );
    if (bytes === null) return null;
    const parsed = parseCompletionTransition(
      JSON.parse(bytes.toString("utf8")) as unknown
    );
    if (
      parsed.runId !== runId ||
      parsed.attemptId !== attempt.id ||
      parsed.attemptKind !== attempt.kind
    )
      throw new BanzaiError(
        "INVALID_COMPLETION_TRANSITION",
        "Completion transition identity conflicts with its path."
      );
    return parsed;
  }

  /** Byte-identical original report input retained beside the capture manifest. */
  async writeCompletionOriginal(
    runId: string,
    attempt: AttemptReference,
    role: "implementationReport" | "testReport",
    bytes: Buffer
  ): Promise<{ path: string; sha256: string }> {
    const leaf =
      role === "implementationReport"
        ? "implementation-input.md"
        : "test-input.md";
    await this.writeImmutableEvidence(
      this.completionEvidencePath(runId, attempt, leaf),
      bytes,
      "COMPLETION_CAPTURE_CONFLICT"
    );
    return {
      path: this.completionEvidenceRelativePath(runId, attempt, leaf),
      sha256: createHash("sha256").update(bytes).digest("hex")
    };
  }

  async readCompletionOriginalIfExists(
    runId: string,
    attempt: AttemptReference,
    role: "implementationReport" | "testReport"
  ): Promise<Buffer | null> {
    return await this.readImmutableEvidence(
      this.completionEvidencePath(
        runId,
        attempt,
        role === "implementationReport"
          ? "implementation-input.md"
          : "test-input.md"
      )
    );
  }

  async writeCompletionCapture(
    runId: string,
    capture: CompletionCapture
  ): Promise<void> {
    const parsed = parseCompletionCapture(capture);
    if (parsed.runId !== runId)
      throw new BanzaiError(
        "INVALID_COMPLETION_CAPTURE",
        "Completion capture run identity does not match its path."
      );
    await this.writeImmutableEvidence(
      this.completionEvidencePath(
        runId,
        { id: parsed.attemptId },
        "completion-input.json"
      ),
      Buffer.from(`${JSON.stringify(parsed, null, 2)}\n`),
      "COMPLETION_CAPTURE_CONFLICT"
    );
  }

  async readCompletionCaptureIfExists(
    runId: string,
    attempt: AttemptReference
  ): Promise<CompletionCapture | null> {
    const bytes = await this.readImmutableEvidence(
      this.completionEvidencePath(runId, attempt, "completion-input.json")
    );
    if (bytes === null) return null;
    const parsed = parseCompletionCapture(
      JSON.parse(bytes.toString("utf8")) as unknown
    );
    if (
      parsed.runId !== runId ||
      parsed.attemptId !== attempt.id ||
      parsed.attemptKind !== attempt.kind
    )
      throw new BanzaiError(
        "INVALID_COMPLETION_CAPTURE",
        "Completion capture identity conflicts with its path."
      );
    return parsed;
  }

  async writeCompletionCandidate(
    runId: string,
    candidate: CompletionCandidate,
    bytes: Buffer
  ): Promise<void> {
    const parsed = parseCompletionCandidate(candidate);
    const attempt = { id: parsed.attemptId, kind: parsed.attemptKind };
    if (
      parsed.runId !== runId ||
      parsed.candidatePath !==
        this.completionEvidenceRelativePath(
          runId,
          attempt,
          "completion-candidate.md"
        ) ||
      parsed.outputSha256 !==
        createHash("sha256").update(bytes).digest("hex") ||
      parsed.outputBytes !== bytes.length
    )
      throw new BanzaiError(
        "INVALID_COMPLETION_CANDIDATE",
        "Completion candidate metadata does not bind its exact bytes."
      );
    await this.writeImmutableEvidence(
      this.completionEvidencePath(runId, attempt, "completion-candidate.md"),
      bytes,
      "COMPLETION_CANDIDATE_CONFLICT"
    );
    await this.writeImmutableEvidence(
      this.completionEvidencePath(runId, attempt, "completion-candidate.json"),
      Buffer.from(`${JSON.stringify(parsed, null, 2)}\n`),
      "COMPLETION_CANDIDATE_CONFLICT"
    );
  }

  async readCompletionCandidateIfExists(
    runId: string,
    attempt: AttemptReference
  ): Promise<{ candidate: CompletionCandidate; bytes: Buffer } | null> {
    const metadata = await this.readImmutableEvidence(
      this.completionEvidencePath(runId, attempt, "completion-candidate.json")
    );
    if (metadata === null) return null;
    const candidate = parseCompletionCandidate(
      JSON.parse(metadata.toString("utf8")) as unknown
    );
    const bytes = await this.readImmutableEvidence(
      this.completionEvidencePath(runId, attempt, "completion-candidate.md")
    );
    if (
      candidate.runId !== runId ||
      candidate.attemptId !== attempt.id ||
      candidate.attemptKind !== attempt.kind ||
      bytes === null ||
      createHash("sha256").update(bytes).digest("hex") !==
        candidate.outputSha256 ||
      bytes.length !== candidate.outputBytes
    )
      throw new BanzaiError(
        "INVALID_COMPLETION_CANDIDATE",
        "Completion candidate bytes or identity conflict with their metadata."
      );
    return { candidate, bytes };
  }

  async writeCompletionPublication(
    runId: string,
    receipt: CompletionPublication
  ): Promise<void> {
    const parsed = parseCompletionPublication(receipt);
    if (parsed.runId !== runId)
      throw new BanzaiError(
        "INVALID_COMPLETION_PUBLICATION",
        "Completion publication run identity does not match its path."
      );
    await this.writeImmutableEvidence(
      this.completionEvidencePath(
        runId,
        { id: parsed.attemptId },
        "completion-publication.json"
      ),
      Buffer.from(`${JSON.stringify(parsed, null, 2)}\n`),
      "COMPLETION_PUBLICATION_CONFLICT"
    );
  }

  async readCompletionPublicationIfExists(
    runId: string,
    attempt: Pick<AttemptReference, "id"> &
      Partial<Pick<AttemptReference, "kind">>
  ): Promise<CompletionPublication | null> {
    const bytes = await this.readImmutableEvidence(
      this.completionEvidencePath(runId, attempt, "completion-publication.json")
    );
    if (bytes === null) return null;
    const parsed = parseCompletionPublication(
      JSON.parse(bytes.toString("utf8")) as unknown
    );
    if (
      parsed.runId !== runId ||
      parsed.attemptId !== attempt.id ||
      (attempt.kind !== undefined && parsed.attemptKind !== attempt.kind)
    )
      throw new BanzaiError(
        "INVALID_COMPLETION_PUBLICATION",
        "Completion publication identity conflicts with its path."
      );
    return parsed;
  }

  /** Exact current state bytes, for attempt-owned transition evidence. */
  async readStateBytes(runId: string): Promise<Buffer> {
    const bytes = await this.readImmutableEvidence(this.statePath(runId));
    if (bytes === null)
      throw new BanzaiError(
        "STATE_READ_FAILED",
        `Could not read state for ${runId}.`
      );
    return bytes;
  }

  terminalCheckpointPath(runId: string, attempt: AttemptReference): string {
    return containedEvidencePath(
      this.runDirectory(runId),
      "attempts",
      `${safeEvidenceSegment(attempt.id, "attempt.id", 200)}.terminal-checkpoint.json`
    );
  }

  recoveryAuthorizationPath(runId: string, authorizationId: string): string {
    return containedEvidencePath(
      this.runDirectory(runId),
      "recovery-authorizations",
      `${safeEvidenceSegment(authorizationId, "authorizationId", 200)}.json`
    );
  }

  verificationAttemptsDirectory(runId: string): string {
    return path.join(this.runDirectory(runId), "verification-attempts");
  }

  verificationLedgerPath(runId: string): string {
    return path.join(this.verificationAttemptsDirectory(runId), "ledger.json");
  }

  verificationAttemptPath(runId: string, sequence: number, id: string): string {
    return path.join(
      this.verificationAttemptsDirectory(runId),
      `verification-${String(sequence).padStart(6, "0")}-${id}.json`
    );
  }

  async initialize(): Promise<void> {
    await mkdir(this.runsDirectory, { recursive: true });
  }

  async acquireLock(
    options: { reclaimStale?: boolean } = {}
  ): Promise<RunnerLock> {
    if (options.reclaimStale !== false) await this.initialize();
    const token = randomUUID();
    const lock: LockFile = {
      schemaVersion: 1,
      pid: process.pid,
      token,
      createdAt: new Date().toISOString()
    };

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const handle = await open(this.lockPath, "wx", 0o600);
        const owned = await handle.stat();
        try {
          await handle.writeFile(`${JSON.stringify(lock)}\n`, "utf8");
          await handle.sync();
        } finally {
          await handle.close();
        }
        heldLocks.set(this.lockPath, token);
        return {
          token,
          release: async () => {
            if (heldLocks.get(this.lockPath) === token) {
              heldLocks.delete(this.lockPath);
            }
            const named = await lstat(this.lockPath).catch(() => null);
            if (
              named === null ||
              !named.isFile() ||
              named.isSymbolicLink() ||
              named.ino !== owned.ino ||
              named.dev !== owned.dev
            )
              return;
            const current = await readJson<LockFile>(
              this.lockPath,
              "runner lock"
            ).catch(() => null);
            if (current?.token === token) {
              await unlink(this.lockPath).catch(() => undefined);
            }
          }
        };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
          throw error;
        }
        if (options.reclaimStale === false) {
          throw new BanzaiError(
            "RUNNER_LOCKED",
            "Project setup cannot acquire ownership while .banzai/runner.lock exists. Use banzai doctor and resolve the existing owner before trying again."
          );
        }
        const current = await readJson<LockFile>(
          this.lockPath,
          "runner lock"
        ).catch(() => null);
        if (current !== null && isProcessAlive(current.pid)) {
          throw new BanzaiError(
            "RUNNER_LOCKED",
            `Another banzai process is active (pid ${current.pid}).`
          );
        }
        await unlink(this.lockPath).catch(() => undefined);
      }
    }
    throw new BanzaiError(
      "RUNNER_LOCKED",
      "Could not acquire the runner lock."
    );
  }

  async assertLockOwned(): Promise<void> {
    const expected = heldLocks.get(this.lockPath);
    const named = await lstat(this.lockPath).catch(() => null);
    const current =
      named?.isFile() && !named.isSymbolicLink()
        ? await readJson<LockFile>(this.lockPath, "runner lock").catch(
            () => null
          )
        : null;
    if (
      expected === undefined ||
      current?.token !== expected ||
      current.pid !== process.pid
    ) {
      throw new BanzaiError(
        "RUNNER_LOCKED",
        "Configuration changes require the current Banzai session's repository ownership."
      );
    }
  }

  /** Called only while setup owns the ordinary runner lock; never repairs state. */
  async assertSetupEligible(): Promise<void> {
    const invalid = () =>
      new BanzaiError(
        "PROJECT_SETUP_STATE_INVALID",
        "Project setup cannot verify the latest run state. Inspect banzai doctor and banzai status; resolve the existing run evidence before setup."
      );
    const file = await readCancellationFile(
      this.repoRoot,
      ".banzai/active-run.json",
      16 * 1024
    );
    if (file.availability === "missing") return;
    let runId: string;
    try {
      if (file.availability !== "available" || file.text === null)
        throw invalid();
      const pointer = cancellationRecord(JSON.parse(file.text));
      if (
        pointer.schemaVersion !== 1 ||
        typeof pointer.runId !== "string" ||
        !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,199}$/.test(pointer.runId)
      )
        throw invalid();
      runId = pointer.runId;
    } catch {
      throw invalid();
    }
    let state: RunState;
    try {
      const result = await this.readMutationState(runId);
      state = result.state;
      const raw = cancellationRecord(state);
      if (
        typeof state.repoRoot !== "string" ||
        (await realpath(state.repoRoot)) !== (await realpath(this.repoRoot)) ||
        raw.contractVersion !== CONTRACT_VERSION ||
        typeof state.slug !== "string" ||
        typeof state.request !== "string" ||
        !Number.isFinite(Date.parse(state.createdAt)) ||
        !Number.isFinite(Date.parse(state.updatedAt)) ||
        typeof state.baseCommit !== "string" ||
        !/^[a-f0-9]{40,64}$/.test(state.baseCommit) ||
        !Array.isArray(state.baseline) ||
        !Array.isArray(state.verification) ||
        raw.metrics === null ||
        typeof raw.metrics !== "object" ||
        raw.sessions === null ||
        typeof raw.sessions !== "object"
      )
        throw invalid();
    } catch {
      throw invalid();
    }
    if (state.status !== "done" && state.status !== "cancelled") {
      throw new BanzaiError(
        "PROJECT_SETUP_RUN_UNFINISHED",
        "Finish or explicitly cancel the unfinished run before banzai setup. Use banzai status for its current action. You can repair instruction files manually and then follow the existing resume, retry or recovery route."
      );
    }
  }

  async createRun(state: RunState): Promise<void> {
    await this.initialize();
    const existing = await this.readActiveRunId();
    if (existing !== null) {
      const existingState = await this.readState(existing);
      if (!["done", "cancelled"].includes(existingState.status)) {
        throw new BanzaiError(
          "ACTIVE_RUN_EXISTS",
          `Run ${existing} is still ${existingState.status}.`
        );
      }
    }
    await mkdir(this.runDirectory(state.runId), { recursive: false });
    await mkdir(path.join(this.runDirectory(state.runId), "attempts"));
    await mkdir(this.verificationAttemptsDirectory(state.runId));
    await atomicWriteJson(this.verificationLedgerPath(state.runId), {
      schemaVersion: usesVerificationPolicy(state)
        ? 2
        : VERIFICATION_LEDGER_SCHEMA_VERSION
    });
    await this.withStateMutation(state.runId, async () => {
      await atomicWriteJson(this.statePath(state.runId), state, false);
    });
    await atomicWriteJson(this.activeRunPath, {
      schemaVersion: 1,
      runId: state.runId
    });
    await this.appendEvent(state.runId, "run.created", {
      slug: state.slug,
      baseCommit: state.baseCommit
    });
  }

  async readActiveRunId(): Promise<string | null> {
    try {
      const value = await readJson<{ schemaVersion: 1; runId: string }>(
        this.activeRunPath,
        "active run pointer"
      );
      return value.runId;
    } catch (error) {
      if (
        error instanceof BanzaiError &&
        (error.message.includes("ENOENT") ||
          error.message.includes("no such file"))
      ) {
        return null;
      }
      throw error;
    }
  }

  async requireActiveState(): Promise<RunState> {
    const runId = await this.readActiveRunId();
    if (runId === null) {
      throw new BanzaiError("NO_ACTIVE_RUN", "No repository-local run exists.");
    }
    return await this.readState(runId);
  }

  async readState(runId: string): Promise<RunState> {
    return normalizeRunState(
      await readJson<RunState | LegacyRunStateV2 | LegacyRunState>(
        this.statePath(runId),
        `state for ${runId}`
      )
    );
  }

  async writeState(state: RunState): Promise<void> {
    await this.withStateMutation(state.runId, async () => {
      const { state: current } = await this.readMutationState(state.runId);
      if (current.status === "done" || current.status === "cancelled") {
        if (JSON.stringify(current) === JSON.stringify(state)) return;
        throw new TerminalRunStateError(current);
      }
      if (
        JSON.stringify(current.cancellation) !==
        JSON.stringify(state.cancellation)
      ) {
        throw new BanzaiError(
          "CANCELLATION_ANCHOR_IMMUTABLE",
          "Only cancellation can create its terminal anchor."
        );
      }
      state.updatedAt = new Date().toISOString();
      await atomicWriteJson(this.statePath(state.runId), state, false);
    });
  }

  private async withStateMutation<T>(
    runId: string,
    action: () => Promise<T>
  ): Promise<T> {
    const directory = await cancellationEvidencePath(
      this.repoRoot,
      `.banzai/runs/${runId}`,
      true
    );
    const guardPath = path.join(directory, ".state-write.lock");
    const deadline = performance.now() + 1000;
    const token = randomUUID();
    let handle;
    for (;;) {
      try {
        handle = await open(guardPath, "wx", 0o600);
        break;
      } catch (error) {
        if (cancellationRecord(error).code !== "EEXIST") throw error;
        if (performance.now() >= deadline)
          throw new BanzaiError(
            "RUN_MUTATION_BUSY",
            "Run persistence is busy or its ownership is unresolved."
          );
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }
    const owned = await handle.stat();
    try {
      await handle.writeFile(token, "utf8");
      await handle.sync();
      return await action();
    } finally {
      await handle.close();
      const named = await lstat(guardPath).catch(() => null);
      if (
        named !== null &&
        !named.isSymbolicLink() &&
        named.ino === owned.ino &&
        named.dev === owned.dev
      ) {
        await unlink(guardPath);
      }
    }
  }

  private async readMutationState(
    runId: string
  ): Promise<{ state: RunState; raw: Record<string, unknown> }> {
    const file = await readCancellationFile(
      this.repoRoot,
      `.banzai/runs/${runId}/state.json`,
      CANCELLATION_LIMITS.state
    );
    let raw: Record<string, unknown>;
    try {
      if (file.availability !== "available" || file.text === null)
        throw new Error();
      raw = cancellationRecord(JSON.parse(file.text));
      if (
        raw.runId !== runId ||
        !CANCELLATION_STATUSES.includes(raw.status as RunState["status"]) ||
        ![1, 2, 3, 4, 5, 6, 7].includes(raw.schemaVersion as number)
      )
        throw new Error();
    } catch {
      throw new BanzaiError(
        "STATE_READ_FAILED",
        "The exact run state could not be read safely."
      );
    }
    return { raw, state: normalizeRunState(raw as unknown as RunState) };
  }

  async commitCancellation(
    runId: string,
    transition: (state: RunState, raw: Record<string, unknown>) => void
  ): Promise<{
    state: RunState;
    outcome:
      "cancelled" | "already_cancelled" | "already_done" | "active_run_changed";
  }> {
    return await this.withStateMutation(runId, async () => {
      const { state, raw } = await this.readMutationState(runId);
      if ((await this.readActiveRunId()) !== runId)
        return { state, outcome: "active_run_changed" };
      if (state.status === "done") return { state, outcome: "already_done" };
      if (state.status === "cancelled")
        return { state, outcome: "already_cancelled" };
      transition(state, raw);
      decodeCancellationAnchor(state.cancellation);
      if (cancellationRecord(state).status !== "cancelled")
        throw new BanzaiError(
          "INVALID_CANCELLATION",
          "Cancellation must be terminal."
        );
      state.updatedAt = new Date().toISOString();
      await atomicWriteJson(this.statePath(runId), state, false);
      return { state, outcome: "cancelled" };
    });
  }

  async appendEvent(
    runId: string,
    type: string,
    details: Record<string, unknown> = {},
    expectedFingerprint?: CancellationFingerprint | null,
    oncePerReviewAttempt = false
  ): Promise<RunEvent> {
    return await this.withStateMutation(runId, async () => {
      const { state } = await this.readMutationState(runId);
      if (oncePerReviewAttempt || type === "config.verification.applied") {
        const identityKey =
          type === "config.verification.applied" ? "operationId" : "attemptId";
        if (
          (type !== "review.completed" &&
            type !== "config.verification.applied") ||
          typeof details[identityKey] !== "string"
        )
          throw new BanzaiError(
            "INVALID_REVIEW_EVENT",
            "Idempotent review events require an attempt identity."
          );
        const prior = await readFile(
          path.join(this.runDirectory(runId), "events.jsonl"),
          "utf8"
        ).catch((error: unknown) => {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
          throw error;
        });
        const matches = prior
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line) as RunEvent)
          .filter(
            (event) =>
              event.type === type &&
              event.details[identityKey] === details[identityKey]
          );
        if (
          matches.length > 1 ||
          matches.some(
            (event) => JSON.stringify(event.details) !== JSON.stringify(details)
          )
        )
          throw new BanzaiError(
            "INVALID_REVIEW_EVENT",
            "Review application event has conflicting evidence."
          );
        if (matches[0] !== undefined) return matches[0];
      }
      const terminalEvidence =
        type === "attempt.terminal_checkpoint" ||
        (state.status === "done" &&
          ["run.completed", "review.completed"].includes(type)) ||
        (state.status === "cancelled" &&
          ["run.cancelled", "run.cancellation_response"].includes(type));
      if (
        (state.status === "done" || state.status === "cancelled") &&
        !terminalEvidence
      )
        throw new TerminalRunStateError(state);
      if (type === "run.cancelled" || type === "run.cancellation_response") {
        const anchor = decodeCancellationAnchor(state.cancellation);
        if (
          state.status !== "cancelled" ||
          details.cancellationId !== anchor.id ||
          details.runId !== runId ||
          expectedFingerprint === undefined
        ) {
          throw new BanzaiError(
            "INVALID_CANCELLATION",
            "Cancellation evidence is not bound to this transition."
          );
        }
      }
      const relative = `.banzai/runs/${runId}/events.jsonl`;
      if (
        expectedFingerprint !== undefined &&
        !(await cancellationFileIdentityMatches(
          this.repoRoot,
          relative,
          expectedFingerprint
        ))
      ) {
        throw new BanzaiError(
          "CANCELLATION_SOURCE_CHANGED",
          "Cancellation evidence changed before its write."
        );
      }
      const event: RunEvent = {
        at: new Date().toISOString(),
        type,
        runId,
        details
      };
      const file = path.join(this.runDirectory(runId), "events.jsonl");
      const named = await lstat(file).catch((error: unknown) => {
        if (cancellationRecord(error).code === "ENOENT") return null;
        throw error;
      });
      if (named !== null && (!named.isFile() || named.isSymbolicLink()))
        throw new BanzaiError("UNSAFE_EVIDENCE_PATH", "Unsafe event storage.");
      const handle = await open(
        file,
        constants.O_WRONLY |
          constants.O_APPEND |
          constants.O_CREAT |
          constants.O_NOFOLLOW |
          constants.O_NONBLOCK,
        0o600
      );
      try {
        await handle.writeFile(`${JSON.stringify(event)}\n`, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      return event;
    });
  }

  /**
   * Appends a typed event once per exact identity: an identical (type, details)
   * event already on the ledger is returned instead of duplicated, so repeated
   * inspection or resume of the same durable refusal adds nothing.
   */
  async appendEventOnce(
    runId: string,
    type: string,
    details: Record<string, unknown>
  ): Promise<RunEvent> {
    const prior = await readFile(
      path.join(this.runDirectory(runId), "events.jsonl"),
      "utf8"
    ).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
      throw error;
    });
    const canonical = JSON.stringify(details);
    const existing = prior
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as RunEvent)
      .find(
        (event) =>
          event.type === type && JSON.stringify(event.details) === canonical
      );
    if (existing !== undefined) return existing;
    return await this.appendEvent(runId, type, details);
  }

  async writeRunAttempt(runId: string, record: AttemptRecord): Promise<void> {
    parseModelAttemptRecord(record);
    await atomicWriteJson(this.attemptPath(runId, record.attempt), record);
  }

  async readRunAttempt(
    runId: string,
    attempt: AttemptReference
  ): Promise<AttemptRecord> {
    return parseModelAttemptRecord(
      await readJson<unknown>(
        this.attemptPath(runId, attempt),
        `attempt ${attempt.id}`
      )
    );
  }

  async readRunAttempts(runId: string): Promise<AttemptRecord[]> {
    const directory = path.join(this.runDirectory(runId), "attempts");
    const entries = (await readdir(directory, { withFileTypes: true }))
      .filter(
        (entry) =>
          entry.isFile() &&
          /-(selection|plan|implementation|fix|review)\.json$/u.test(entry.name)
      )
      .map((entry) => entry.name)
      .sort();
    const records: AttemptRecord[] = [];
    for (const entry of entries) {
      const record = parseModelAttemptRecord<TerminalCheckpointResult>(
        await readJson<unknown>(
          path.join(directory, entry),
          `attempt record ${entry}`
        )
      );
      if (path.basename(this.attemptPath(runId, record.attempt)) !== entry) {
        throw new BanzaiError(
          "ATTEMPT_PATH_MISMATCH",
          `Attempt record ${entry} does not match its canonical identity.`
        );
      }
      records.push(record);
    }
    return records;
  }

  async readContextLedgerIfPresent(
    runId: string,
    attempt: AttemptReference
  ): Promise<ContextAttemptLedger | null> {
    const ledgerPath = this.contextLedgerPath(runId, attempt);
    for (const directory of [
      this.banzaiDirectory,
      this.runsDirectory,
      this.runDirectory(runId),
      path.dirname(ledgerPath)
    ]) {
      try {
        if ((await lstat(directory)).isDirectory()) continue;
        throw new BanzaiError(
          "INVALID_CONTEXT_EVIDENCE",
          `Invalid context evidence for run ${runId}, attempt ${attempt.id}: evidence directory is not physically owned.`
        );
      } catch (error) {
        if (error instanceof BanzaiError) throw error;
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw new BanzaiError(
          "INVALID_CONTEXT_EVIDENCE",
          `Invalid context evidence for run ${runId}, attempt ${attempt.id}: evidence directory could not be read safely.`
        );
      }
    }
    let handle;
    try {
      handle = await open(
        ledgerPath,
        constants.O_RDONLY | constants.O_NOFOLLOW
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw new BanzaiError(
        "INVALID_CONTEXT_EVIDENCE",
        `Invalid context evidence for run ${runId}, attempt ${attempt.id}: ledger is not a regular owned file.`
      );
    }
    let raw: string;
    try {
      if (!(await handle.stat()).isFile()) {
        throw new BanzaiError(
          "INVALID_CONTEXT_EVIDENCE",
          `Invalid context evidence for run ${runId}, attempt ${attempt.id}: ledger is not a regular owned file.`
        );
      }
      raw = await handle.readFile("utf8");
    } catch (error) {
      if (error instanceof BanzaiError) throw error;
      throw new BanzaiError(
        "INVALID_CONTEXT_EVIDENCE",
        `Invalid context evidence for run ${runId}, attempt ${attempt.id}: ledger could not be read safely.`
      );
    } finally {
      await handle.close().catch(() => undefined);
    }
    let value: unknown;
    try {
      value = JSON.parse(raw) as unknown;
    } catch {
      throw new BanzaiError(
        "INVALID_CONTEXT_EVIDENCE",
        `Invalid context evidence for run ${runId}, attempt ${attempt.id}: JSON is malformed.`
      );
    }
    return decodeContextAttemptLedger(value, runId, attempt.id);
  }

  async beginContextInvocation(
    runId: string,
    attempt: AttemptReference,
    evidence: Omit<ContextInvocationEvidence, "ordinal">
  ): Promise<ContextInvocationEvidence> {
    const existing = await this.readContextLedgerIfPresent(runId, attempt);
    const entry: ContextInvocationEvidence = {
      ...evidence,
      ordinal: (existing?.invocations.length ?? 0) + 1
    };
    const ledger: ContextAttemptLedger = {
      schema: CONTEXT_ATTEMPT_SCHEMA,
      schemaVersion: CONTEXT_ATTEMPT_SCHEMA_VERSION,
      runId,
      attempt,
      invocations: [...(existing?.invocations ?? []), entry]
    };
    decodeContextAttemptLedger(ledger, runId, attempt.id);
    await atomicWriteJson(this.contextLedgerPath(runId, attempt), ledger);
    return entry;
  }

  async finishContextInvocation(
    runId: string,
    attempt: AttemptReference,
    ordinal: number,
    evidence: Pick<
      ContextInvocationEvidence,
      "completedAt" | "outcome" | "sessionInventory" | "vendorUsage" | "budgets"
    >
  ): Promise<ContextInvocationEvidence> {
    const ledger = await this.readContextLedgerIfPresent(runId, attempt);
    const current = ledger?.invocations[ordinal - 1];
    if (ledger === null || current?.ordinal !== ordinal) {
      throw new BanzaiError(
        "INVALID_CONTEXT_EVIDENCE",
        `Invalid context evidence for run ${runId}, attempt ${attempt.id}: invocation ${ordinal} is missing.`
      );
    }
    if (current.outcome !== "pending") {
      throw new BanzaiError(
        "INVALID_CONTEXT_EVIDENCE",
        `Invalid context evidence for run ${runId}, attempt ${attempt.id}: invocation ${ordinal} is already terminal.`
      );
    }
    const finished = { ...current, ...evidence };
    ledger.invocations[ordinal - 1] = finished;
    decodeContextAttemptLedger(ledger, runId, attempt.id);
    await atomicWriteJson(this.contextLedgerPath(runId, attempt), ledger);
    return finished;
  }

  async writeTerminalCheckpoint(
    runId: string,
    checkpoint: PersistedTerminalCheckpoint
  ): Promise<void> {
    const parsed = parseTerminalAttemptCheckpoint(checkpoint);
    if (parsed.runId !== runId) {
      throw new BanzaiError(
        "INVALID_TERMINAL_CHECKPOINT",
        "Terminal checkpoint run identity does not match its path."
      );
    }
    const checkpointPath = this.terminalCheckpointPath(runId, parsed.attempt);
    try {
      const existing = parseTerminalAttemptCheckpoint(
        await readJson<unknown>(
          checkpointPath,
          `terminal checkpoint ${parsed.attempt.id}`
        )
      );
      if (JSON.stringify(existing) !== JSON.stringify(parsed)) {
        throw new BanzaiError(
          "TERMINAL_CHECKPOINT_CONFLICT",
          `Terminal checkpoint ${parsed.attempt.id} already exists with different content.`
        );
      }
      return;
    } catch (error) {
      if (!(
        error instanceof BanzaiError &&
        error.code === "STATE_READ_FAILED" &&
        (error.message.includes("ENOENT") ||
          error.message.includes("no such file"))
      )) {
        throw error;
      }
    }
    await atomicWriteJson(checkpointPath, parsed);
  }

  async readTerminalCheckpointIfExists(
    runId: string,
    attempt: AttemptReference
  ): Promise<PersistedTerminalCheckpoint | null> {
    try {
      const parsed = parseTerminalAttemptCheckpoint(
        await readJson<unknown>(
          this.terminalCheckpointPath(runId, attempt),
          `terminal checkpoint ${attempt.id}`
        )
      );
      if (
        parsed.runId !== runId ||
        parsed.attempt.id !== attempt.id ||
        parsed.attempt.kind !== attempt.kind ||
        parsed.attempt.mutable !== attempt.mutable
      ) {
        throw new BanzaiError(
          "INVALID_TERMINAL_CHECKPOINT",
          "Terminal checkpoint identity does not match its path."
        );
      }
      return parsed;
    } catch (error) {
      if (
        error instanceof BanzaiError &&
        error.code === "STATE_READ_FAILED" &&
        (error.message.includes("ENOENT") ||
          error.message.includes("no such file"))
      ) {
        return null;
      }
      throw error;
    }
  }

  async writeRecoveryAuthorization(
    runId: string,
    authorization: RecoveryAuthorization
  ): Promise<void> {
    const parsed = parseRecoveryAuthorization(authorization);
    if (parsed.runId !== runId) {
      throw new BanzaiError(
        "INVALID_RECOVERY_AUTHORIZATION",
        "Recovery authorization run identity does not match its path."
      );
    }
    const authorizationPath = this.recoveryAuthorizationPath(
      runId,
      parsed.authorizationId
    );
    try {
      const existing = parseRecoveryAuthorization(
        await readJson<unknown>(
          authorizationPath,
          `recovery authorization ${parsed.authorizationId}`
        )
      );
      if (JSON.stringify(existing) !== JSON.stringify(parsed)) {
        throw new BanzaiError(
          "RECOVERY_AUTHORIZATION_CONFLICT",
          `Recovery authorization ${parsed.authorizationId} already exists with different content.`
        );
      }
      return;
    } catch (error) {
      if (!(
        error instanceof BanzaiError &&
        error.code === "STATE_READ_FAILED" &&
        (error.message.includes("ENOENT") ||
          error.message.includes("no such file"))
      )) {
        throw error;
      }
    }
    await atomicWriteJson(authorizationPath, parsed);
  }

  async readRecoveryAuthorization(
    runId: string,
    authorizationId: string
  ): Promise<RecoveryAuthorization> {
    const parsed = parseRecoveryAuthorization(
      await readJson<unknown>(
        this.recoveryAuthorizationPath(runId, authorizationId),
        `recovery authorization ${authorizationId}`
      )
    );
    if (parsed.runId !== runId || parsed.authorizationId !== authorizationId) {
      throw new BanzaiError(
        "INVALID_RECOVERY_AUTHORIZATION",
        "Recovery authorization identity does not match its path."
      );
    }
    return parsed;
  }

  async readRecoveryAuthorizationIfExists(
    runId: string,
    authorizationId: string
  ): Promise<RecoveryAuthorization | null> {
    try {
      return await this.readRecoveryAuthorization(runId, authorizationId);
    } catch (error) {
      if (
        error instanceof BanzaiError &&
        error.code === "STATE_READ_FAILED" &&
        (error.message.includes("ENOENT") ||
          error.message.includes("no such file"))
      ) {
        return null;
      }
      throw error;
    }
  }

  async readRunAttemptIfExists(
    runId: string,
    attempt: AttemptReference
  ): Promise<AttemptRecord | null> {
    try {
      return await this.readRunAttempt(runId, attempt);
    } catch (error) {
      if (
        error instanceof BanzaiError &&
        (error.message.includes("ENOENT") ||
          error.message.includes("no such file"))
      ) {
        return null;
      }
      throw error;
    }
  }

  async readVerificationAttempts(
    runId: string
  ): Promise<VerificationAttemptRecord[]> {
    parseVerificationLedger(
      await readJson<unknown>(
        this.verificationLedgerPath(runId),
        "verification ledger"
      )
    );
    const directory = this.verificationAttemptsDirectory(runId);
    const entries = (await readdir(directory, { withFileTypes: true }))
      .filter(
        (entry) =>
          entry.isFile() &&
          entry.name !== "ledger.json" &&
          entry.name.endsWith(".json")
      )
      .map((entry) => entry.name)
      .sort();
    const records: VerificationAttemptRecord[] = [];
    for (const entry of entries) {
      records.push(
        parseVerificationAttemptRecord(
          await readJson<unknown>(
            path.join(directory, entry),
            "verification attempt"
          )
        )
      );
    }
    const identities = new Set<string>();
    const sequences = new Set<number>();
    for (const record of records) {
      if (identities.has(record.id) || sequences.has(record.sequence)) {
        throw new BanzaiError(
          "VERIFICATION_ATTEMPT_CONFLICT",
          "Verification evidence contains a duplicate identity or sequence."
        );
      }
      identities.add(record.id);
      sequences.add(record.sequence);
    }
    return records.sort((left, right) => left.sequence - right.sequence);
  }

  async verificationLedgerSupported(runId: string): Promise<boolean> {
    try {
      parseVerificationLedger(
        JSON.parse(
          await readFile(this.verificationLedgerPath(runId), "utf8")
        ) as unknown
      );
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return false;
      }
      if (error instanceof BanzaiError) {
        throw error;
      }
      throw new BanzaiError(
        "VERIFICATION_LEDGER_MALFORMED",
        "Verification ledger marker is malformed."
      );
    }
  }

  async beginVerificationAttempt(
    runId: string,
    input: {
      round: VerificationAttemptRecord["round"];
      descriptor: VerificationCommandDescriptor;
      startedAt: string;
      retryOf?: string | null;
      restartOf?: string | null;
    }
  ): Promise<VerificationAttemptRecord> {
    const records = await this.readVerificationAttempts(runId);
    const sequence = (records.at(-1)?.sequence ?? 0) + 1;
    const record: VerificationAttemptRecord = {
      schemaVersion: VERIFICATION_LEDGER_SCHEMA_VERSION,
      id: `verification-${randomUUID()}`,
      sequence,
      round: input.round,
      command: {
        profileId: input.descriptor.profileId,
        projectType: input.descriptor.projectType,
        profileOrdinal: input.descriptor.profileOrdinal,
        commandOrdinal: input.descriptor.commandOrdinal,
        configurationDigest: input.descriptor.configurationDigest
      },
      status: "started",
      startedAt: input.startedAt,
      completedAt: null,
      durationMs: null,
      exitCode: null,
      signal: null,
      failureCategory: null,
      retryOf: input.retryOf ?? null,
      restartOf: input.restartOf ?? null,
      stdout: null,
      stderr: null
    };
    parseVerificationAttemptRecord(record);
    await atomicWriteJson(
      this.verificationAttemptPath(runId, record.sequence, record.id),
      record
    );
    return record;
  }

  async finishVerificationAttempt(
    runId: string,
    record: VerificationAttemptRecord
  ): Promise<void> {
    const parsed = parseVerificationAttemptRecord(record);
    const filePath = this.verificationAttemptPath(
      runId,
      parsed.sequence,
      parsed.id
    );
    const existing = parseVerificationAttemptRecord(
      await readJson<unknown>(filePath, "verification attempt")
    );
    if (existing.status !== "started") {
      if (JSON.stringify(existing) === JSON.stringify(parsed)) {
        return;
      }
      throw new BanzaiError(
        "VERIFICATION_ATTEMPT_CONFLICT",
        "A terminal verification attempt cannot be replaced."
      );
    }
    if (
      existing.id !== parsed.id ||
      existing.sequence !== parsed.sequence ||
      existing.round.id !== parsed.round.id ||
      existing.command.configurationDigest !==
        parsed.command.configurationDigest
    ) {
      throw new BanzaiError(
        "VERIFICATION_ATTEMPT_CONFLICT",
        "Verification attempt identity changed before completion."
      );
    }
    await atomicWriteJson(filePath, parsed);
  }

  async writeVerificationLog(
    runId: string,
    relativePath: string,
    value: string
  ): Promise<VerificationAttemptLogEvidence> {
    await this.writeText(runId, relativePath, value);
    return {
      relativePath,
      sha256: createHash("sha256").update(value).digest("hex")
    };
  }

  processAlive(pid: number): boolean {
    return isProcessAlive(pid);
  }

  async writeReviewResult(
    runId: string,
    iteration: number,
    value: unknown
  ): Promise<void> {
    if (!Number.isInteger(iteration) || iteration < 1)
      throw new BanzaiError(
        "INVALID_REVIEW_ARTIFACT_PATH",
        "Review iteration must be positive."
      );
    const relative = `reviews/review-${iteration}.json`;
    const target = path.join(this.runDirectory(runId), relative);
    await assertReviewPathOwned(
      this.repoRoot,
      path.relative(this.repoRoot, target).split(path.sep).join("/"),
      true
    );
    const result = parseCurrentReviewResult(value);
    const expected = `${JSON.stringify(result, null, 2)}\n`;
    const existing = await readFile(target, "utf8").catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    });
    if (existing !== null && existing !== expected)
      throw new BanzaiError(
        "INVALID_REVIEW_CANDIDATE_EVIDENCE",
        "Canonical review JSON contains conflicting evidence."
      );
    if (existing === null) await atomicWriteJson(target, result);
  }

  async writeText(
    runId: string,
    relativePath: string,
    value: string
  ): Promise<string> {
    const target = path.join(this.runDirectory(runId), relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, value, { encoding: "utf8", mode: 0o600 });
    return target;
  }
}
