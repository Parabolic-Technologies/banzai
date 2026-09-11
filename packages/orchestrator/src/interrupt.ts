/**
 * Ctrl+C handling for a run in progress.
 *
 * A phase can hold the terminal for an hour, so the interrupt path is the only
 * control the human has left. It must therefore be *visible*: the previous
 * handler erased the live status line and then worked silently for as long as
 * the vendor took to drain, which is indistinguishable from an ignored
 * keystroke. Every step here writes what it is doing, terminates on a bounded
 * schedule, and can be forced by pressing the key again.
 */

/** How long a vendor process group may take to exit after SIGTERM. */
export const INTERRUPT_GRACE_MS = 2_000;
/** Backstop for a shutdown that never settles at all. */
export const INTERRUPT_HARD_EXIT_MS = 6_000;
/** How long a re-raised signal has to take effect before we exit outright. */
export const INTERRUPT_RAISE_FALLBACK_MS = 250;

export const INTERRUPT_ACKNOWLEDGED =
  "[banzai] Interrupt received. Stopping the running phase; press Ctrl+C again to quit now.";
export const INTERRUPT_FORCED =
  "[banzai] Forcing shutdown; vendor processes are being killed.";
export const INTERRUPT_TIMED_OUT =
  "[banzai] Shutdown did not settle in time; forcing exit.";
export const INTERRUPT_STOPPED =
  "[banzai] Stopped. The run is preserved — start `banzai` again to resume or cancel it.";
export const INTERRUPT_STOPPED_AFTER_KILL =
  "[banzai] Stopped. A vendor process ignored the stop request and was killed; the run is preserved — start `banzai` again to resume or cancel it.";

/** Cancels a scheduled callback. Scheduling is injected so tests stay exact. */
export type CancelTimer = () => void;

export interface InterruptDependencies {
  /** Erases the live status line so the cursor row is ours to write on. */
  closeProgress: () => void;
  /**
   * Undoes what an interactive prompt may have done to the terminal. A prompt
   * interrupted mid-render leaves raw mode on and the cursor hidden, which
   * survives the process and breaks the shell the human returns to.
   */
  restoreTerminal: () => void;
  /** Writes one whole line to the progress stream. */
  write: (line: string) => void;
  /** Terminates the vendor process groups and waits for them to drain. */
  shutdown: (timeoutMs: number) => Promise<boolean>;
  /** Kills every vendor process group without waiting. */
  forceTerminate: () => void;
  /**
   * Drops the runner lock. Without this an interrupt leaves `.banzai/runner.lock`
   * behind, and the next invocation reports a live runner until the recorded
   * pid is proven dead.
   */
  releaseLocks: () => void;
  /** Restores the default disposition so a re-raised signal can terminate. */
  removeListeners: () => void;
  raise: (signal: NodeJS.Signals) => void;
  exit: (code: number) => void;
  schedule: (handler: () => void, delayMs: number) => CancelTimer;
  graceMs?: number;
  hardExitMs?: number;
  raiseFallbackMs?: number;
}

/** The status a shell expects from a process that died of `signal`. */
export function interruptExitCode(signal: NodeJS.Signals): number {
  return signal === "SIGTERM" ? 143 : 130;
}

/**
 * Returns one handler shared by every trapped signal. The first press starts a
 * bounded graceful stop; any later press abandons it. Both paths always reach
 * an exit, so a wedged vendor can never hold the terminal.
 */
export function createInterruptHandler(
  dependencies: InterruptDependencies
): (signal: NodeJS.Signals) => void {
  const graceMs = dependencies.graceMs ?? INTERRUPT_GRACE_MS;
  const hardExitMs = dependencies.hardExitMs ?? INTERRUPT_HARD_EXIT_MS;
  const raiseFallbackMs =
    dependencies.raiseFallbackMs ?? INTERRUPT_RAISE_FALLBACK_MS;
  let stopping = false;
  let cancelHardExit: CancelTimer | null = null;

  const forceExit = (signal: NodeJS.Signals, line: string): void => {
    cancelHardExit?.();
    cancelHardExit = null;
    dependencies.write(line);
    dependencies.forceTerminate();
    dependencies.releaseLocks();
    dependencies.exit(interruptExitCode(signal));
  };

  const settle = (signal: NodeJS.Signals, drained: boolean): void => {
    cancelHardExit?.();
    cancelHardExit = null;
    dependencies.releaseLocks();
    dependencies.write(
      drained ? INTERRUPT_STOPPED : INTERRUPT_STOPPED_AFTER_KILL
    );
    dependencies.removeListeners();
    // Re-raising keeps the shell's "killed by signal" status truthful; the
    // fallback covers the case where something else still traps the signal.
    dependencies.schedule(() => {
      dependencies.exit(interruptExitCode(signal));
    }, raiseFallbackMs);
    dependencies.raise(signal);
  };

  return (signal: NodeJS.Signals): void => {
    dependencies.closeProgress();
    dependencies.restoreTerminal();
    if (stopping) {
      forceExit(signal, INTERRUPT_FORCED);
      return;
    }
    stopping = true;
    dependencies.write(INTERRUPT_ACKNOWLEDGED);
    cancelHardExit = dependencies.schedule(() => {
      forceExit(signal, INTERRUPT_TIMED_OUT);
    }, hardExitMs);
    void dependencies.shutdown(graceMs).then(
      (drained) => {
        settle(signal, drained);
      },
      () => {
        settle(signal, false);
      }
    );
  };
}
