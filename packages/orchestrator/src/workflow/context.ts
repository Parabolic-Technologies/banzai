import type {
  HumanTimeBoundary,
  HumanTimeEventType,
  HumanTimeObserver
} from "../human-time.js";
import type { RunStore } from "../store.js";
import type {
  ProcessRunner,
  ProgressReporter,
  RunState,
  VendorAdapters
} from "../types.js";
import type { Clock, IdSource } from "./ports.js";

/**
 * The runner's immutable collaborators (ADR-0052 section 3). Capability code
 * receives this record, never the runner, so it cannot reach runner state.
 * The store and adapters are the runner's own public instances.
 */
export interface RunnerContext {
  readonly repoRoot: string;
  readonly store: RunStore;
  readonly adapters: VendorAdapters;
  readonly processRunner: ProcessRunner;
  readonly progressReporter: ProgressReporter;
  readonly humanTimeObserver: HumanTimeObserver | undefined;
  readonly clock: Clock;
  readonly ids: IdSource;
}

/** The ISO-8601 UTC text of one clock reading. */
export function timestamp(context: Pick<RunnerContext, "clock">): string {
  return context.clock().toISOString();
}

export async function observeHumanTime(
  context: Pick<RunnerContext, "humanTimeObserver">,
  state: RunState,
  kind: HumanTimeBoundary["kind"],
  eventType: HumanTimeEventType | null = null,
  eventAt: string | null = null,
  attemptId: string | null = state.activeAttempt?.id ?? null
): Promise<void> {
  if (context.humanTimeObserver === undefined) return;
  const pending = state.pendingHumanDecision;
  try {
    await context.humanTimeObserver({
      kind,
      runId: state.runId,
      attemptId,
      reviewIteration: state.reviewIteration > 0 ? state.reviewIteration : null,
      requestId:
        pending?.kind === "decision_consultation"
          ? pending.request.requestId
          : null,
      roundId:
        pending?.kind === "decision_consultation"
          ? pending.request.roundId
          : null,
      eventType,
      eventAt
    });
  } catch {
    // Optional observation cannot change a durable decision or continuation.
  }
}
