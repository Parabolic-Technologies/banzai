import type {
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

/** A cooperating state writer lost to a terminal transition; never a model failure. */
export class TerminalRunStateError extends BanzaiError {
  constructor(readonly state: RunState) {
    super("RUN_ALREADY_TERMINAL", "The run is already terminal.");
    this.name = "TerminalRunStateError";
  }
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
