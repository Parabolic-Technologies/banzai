import type {
  LocalConfigDefect,
  ModelFailureCause,
  RunState,
  ModelUsage,
  ProcessResult,
  SessionInventory
} from "./types.js";

export class BanzaiError extends Error {
  readonly code: string;
  readonly exitCode: number;

  constructor(code: string, message: string, exitCode = 1) {
    super(message);
    this.name = "BanzaiError";
    this.code = code;
    this.exitCode = exitCode;
  }
}

/** A refused invocation has no attempt or failure evidence to persist. */
export class ProjectSetupRequiredError extends BanzaiError {
  constructor(message: string) {
    super("PROJECT_SETUP_REQUIRED", message);
    this.name = "ProjectSetupRequiredError";
  }
}

/** A refused call preserves the last durable checkpoint and all retry authority. */
export class InstructionResourceMismatchError extends BanzaiError {
  constructor(message: string) {
    super("INSTRUCTION_RESOURCE_MISMATCH", message);
    this.name = "InstructionResourceMismatchError";
  }
}

/**
 * A refused `.banzai/config.local.json` (ADR-0060 §1, §4): code
 * `LOCAL_CONFIG_INVALID`, `LOCAL_CONFIG_KEY_REFUSED` or
 * `LOCAL_CONFIG_NOT_IGNORED`. The message never echoes a value from the file.
 */
export class LocalConfigError extends BanzaiError {
  readonly defect: LocalConfigDefect;

  constructor(defect: LocalConfigDefect) {
    super(defect.code, defect.message);
    this.name = "LocalConfigError";
    this.defect = defect;
  }
}

export type LocalModelOverrideRefusalCode =
  "LOCAL_MODEL_OVERRIDE_CHANGED" | "LOCAL_MODEL_OVERRIDE_RECORD_INVALID";

/**
 * A run guard refusal (ADR-0060 §5): the current local model file or the run's
 * model record differs from the record the command holds
 * (`LOCAL_MODEL_OVERRIDE_CHANGED`), or the record cannot be read
 * (`LOCAL_MODEL_OVERRIDE_RECORD_INVALID`). Like the instruction-resource
 * refusal it preserves the last durable checkpoint and every retry and
 * recovery authority: no block reason, event or review rotation reason.
 */
export class LocalModelOverrideRefusalError extends BanzaiError {
  constructor(
    override readonly code: LocalModelOverrideRefusalCode,
    message: string
  ) {
    super(code, message);
    this.name = "LocalModelOverrideRefusalError";
  }
}

/** A cooperating state writer lost to a terminal transition; never a model failure. */
export class TerminalRunStateError extends BanzaiError {
  constructor(readonly state: RunState) {
    super("RUN_ALREADY_TERMINAL", "The run is already terminal.");
    this.name = "TerminalRunStateError";
  }
}

/**
 * The errors every catch between a check point and a command's boundary
 * rethrows unchanged instead of recording a failure: a terminal transition,
 * the project-setup and instruction-resource refusals, and the run guard
 * refusals of ADR-0060 §5.
 */
export function passesThroughRunCatches(error: unknown): boolean {
  return (
    error instanceof TerminalRunStateError ||
    error instanceof ProjectSetupRequiredError ||
    error instanceof InstructionResourceMismatchError ||
    error instanceof LocalModelOverrideRefusalError
  );
}

export class ProcessExitError extends BanzaiError {
  /** Captured output survives process, durable-observer, and decoder failures. */
  readonly result: ProcessResult;
  readonly stdout: string;
  readonly stderr: string;
  /**
   * Structured evidence recovered from the failed process before it was
   * discarded: why it failed, and what it had already spent. Both stay `null`
   * for vendors or streams that carry neither.
   */
  readonly failureCause: ModelFailureCause | null;
  readonly usage: ModelUsage | null;
  readonly inventory: SessionInventory | null;
  readonly turnCount: number | null;

  constructor(
    code: string,
    message: string,
    result: ProcessResult,
    evidence: {
      failureCause?: ModelFailureCause | null;
      usage?: ModelUsage | null;
      inventory?: SessionInventory | null;
      turnCount?: number | null;
    } = {}
  ) {
    super(code, message);
    this.name = "ProcessExitError";
    this.result = result;
    this.stdout = result.stdout;
    this.stderr = result.stderr;
    this.failureCause = evidence.failureCause ?? null;
    this.usage = evidence.usage ?? null;
    this.inventory = evidence.inventory ?? null;
    this.turnCount = evidence.turnCount ?? null;
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
