import assert from "node:assert/strict";
import { readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { BanzaiError } from "../src/errors.js";
import { RunStore } from "../src/store.js";
import type { RunEvent } from "../src/store.js";
import type { RunState } from "../src/types.js";
import type { WorkflowRunner } from "../src/workflow.js";

/**
 * Ordered persisted effects of one run, used as behavior-preservation evidence
 * while WorkflowRunner is decomposed (ADR-0052). The trace holds exactly one
 * entry per persistence, in the order it happens: a state entry for each
 * completed write of state.json and an event entry for each line appended to
 * events.jsonl. Method calls that persist nothing add nothing.
 */
export type TraceEntry =
  | {
      kind: "state";
      status: string;
      blockedFrom: string | null;
      blockReason: string | null;
    }
  | { kind: "event"; type: string };

export interface PersistenceTrace {
  readonly entries: readonly TraceEntry[];
  stop(): void;
}

type CommitCancellation = RunStore["commitCancellation"];

function defined<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("RunStore method is missing.");
  return value;
}

function stateEntry(state: RunState): TraceEntry {
  return {
    kind: "state",
    status: state.status,
    blockedFrom: state.blockedFrom ?? null,
    blockReason: state.blockReason ?? null
  };
}

async function persistedStatus(
  store: RunStore,
  runId: string
): Promise<string | null> {
  try {
    const persisted = JSON.parse(
      await readFile(store.statePath(runId), "utf8")
    ) as { status?: unknown };
    return typeof persisted.status === "string" ? persisted.status : null;
  } catch {
    return null;
  }
}

async function eventLines(store: RunStore, runId: string): Promise<number> {
  try {
    const contents = await readFile(
      path.join(store.runDirectory(runId), "events.jsonl"),
      "utf8"
    );
    return contents.split("\n").filter(Boolean).length;
  } catch {
    return 0;
  }
}

/**
 * Observes every RunStore method that persists run state or events, across
 * all store instances, until stop(). Tests within one file run sequentially,
 * so patching the prototype for the duration of one flow is safe; it lets
 * existing fixtures that construct their own runner be reused unchanged.
 */
export function recordPersistence(): PersistenceTrace {
  const entries: TraceEntry[] = [];
  const prototype = RunStore.prototype;
  const descriptors = Object.getOwnPropertyDescriptors(prototype);
  const original = {
    createRun: defined(descriptors.createRun.value),
    writeState: defined(descriptors.writeState.value),
    commitCancellation: defined(descriptors.commitCancellation.value),
    appendEvent: defined(descriptors.appendEvent.value)
  };
  // createRun writes state.json before it appends run.created, so its state
  // entry is emitted ahead of the first event recorded during the same call.
  let pendingCreate: TraceEntry | null = null;
  const flushCreate = () => {
    if (pendingCreate === null) return;
    entries.push(pendingCreate);
    pendingCreate = null;
  };

  prototype.createRun = async function (this: RunStore, state: RunState) {
    pendingCreate = stateEntry(state);
    try {
      await original.createRun.call(this, state);
    } catch (error) {
      pendingCreate = null;
      throw error;
    }
    flushCreate();
  };

  prototype.writeState = async function (this: RunStore, state: RunState) {
    // A terminal run is never rewritten: an identical write returns without
    // persisting and any other write throws.
    const before = await persistedStatus(this, state.runId);
    await original.writeState.call(this, state);
    if (before !== "done" && before !== "cancelled")
      entries.push(stateEntry(state));
  };

  prototype.commitCancellation = async function (
    this: RunStore,
    ...args: Parameters<CommitCancellation>
  ) {
    const committed = await original.commitCancellation.apply(this, args);
    // Only the cancelled outcome writes; the other outcomes report prior state.
    if (committed.outcome === "cancelled")
      entries.push(stateEntry(committed.state));
    return committed;
  };

  prototype.appendEvent = async function (
    this: RunStore,
    ...args: Parameters<RunStore["appendEvent"]>
  ): Promise<RunEvent> {
    const [runId, type] = args;
    const before = await eventLines(this, runId);
    const event = await original.appendEvent.apply(this, args);
    const appended = (await eventLines(this, runId)) - before;
    // Idempotent event types return an existing event without appending.
    if (appended > 1)
      throw new Error(`One appendEvent call appended ${appended} lines.`);
    if (appended === 1) {
      flushCreate();
      entries.push({ kind: "event", type });
    }
    return event;
  };

  let stopped = false;
  return {
    entries,
    stop() {
      if (stopped) return;
      stopped = true;
      Object.assign(prototype, original);
    }
  };
}

const TIMESTAMP = /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\b/gu;
const UUID =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gu;
const SHA256 = /\b[0-9a-f]{64}\b/gu;
const COMMIT = /\b[0-9a-f]{40}\b/gu;
const RUN_ID = /\b\d{14}-[a-z0-9-]+?-[0-9a-f]{8}\b/gu;
const ATTEMPT_ID =
  /\b((?:selection|plan|implementation|fix|review)-\d+-)[0-9a-f]{8}\b/gu;

/**
 * Replaces only values derived from time, randomness, digests or the temporary
 * repository path; statuses, event types and all other reason text stay exact.
 */
export function normalizeTraceText(
  text: string,
  repositoryRoots: readonly string[]
): string {
  let normalized = text;
  for (const root of [...repositoryRoots].sort(
    (left, right) => right.length - left.length
  ))
    normalized = normalized.split(root).join("<repo>");
  return normalized
    .replace(TIMESTAMP, "<time>")
    .replace(UUID, "<uuid>")
    .replace(SHA256, "<sha256>")
    .replace(COMMIT, "<commit>")
    .replace(RUN_ID, "<run>")
    .replace(ATTEMPT_ID, "$1<id>");
}

export function traceLines(
  entries: readonly TraceEntry[],
  repositoryRoots: readonly string[]
): string[] {
  return entries.map((entry) => {
    if (entry.kind === "event") return `event ${entry.type}`;
    const from = entry.blockedFrom === null ? "" : ` <- ${entry.blockedFrom}`;
    const reason =
      entry.blockReason === null
        ? ""
        : `: ${normalizeTraceText(entry.blockReason, repositoryRoots)}`;
    return `state ${entry.status}${from}${reason}`;
  });
}

/**
 * Proves the trace missed no persistence path: its events equal events.jsonl
 * in order, and its last state entry equals the final state.json.
 */
export async function assertTraceComplete(
  trace: PersistenceTrace,
  store: RunStore,
  runId: string
): Promise<void> {
  const persistedEvents = (
    await readFile(path.join(store.runDirectory(runId), "events.jsonl"), "utf8")
  )
    .split("\n")
    .filter(Boolean)
    .map((line) => (JSON.parse(line) as RunEvent).type);
  assert.deepEqual(
    trace.entries.flatMap((entry) =>
      entry.kind === "event" ? [entry.type] : []
    ),
    persistedEvents,
    "traced events must equal events.jsonl in order"
  );
  const finalState = JSON.parse(
    await readFile(store.statePath(runId), "utf8")
  ) as RunState;
  const lastState = [...trace.entries]
    .reverse()
    .find((entry) => entry.kind === "state");
  assert.deepEqual(
    lastState,
    stateEntry(finalState),
    "the last traced state must equal the final state.json"
  );
}

/** Compares the normalized trace with its expected lines from the baseline source. */
export async function assertTrace(
  trace: PersistenceTrace,
  repositoryRoot: string,
  expected: readonly string[]
): Promise<void> {
  const actual = traceLines(trace.entries, [
    repositoryRoot,
    await realpath(repositoryRoot)
  ]);
  assert.deepEqual(actual, expected);
}

function normalizeValue(value: unknown, roots: readonly string[]): unknown {
  if (typeof value === "string") return normalizeTraceText(value, roots);
  if (Array.isArray(value))
    return value.map((item) => normalizeValue(item, roots));
  if (typeof value === "object" && value !== null)
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        normalizeValue(item, roots)
      ])
    );
  return value;
}

/**
 * The complete observable value of an eligibility decision with only its time-,
 * randomness-, digest- and path-derived text normalized, for comparison with
 * the value the baseline source produced.
 */
export async function normalizeOutcome(
  value: unknown,
  repositoryRoot: string
): Promise<unknown> {
  return normalizeValue(JSON.parse(JSON.stringify(value)) as unknown, [
    repositoryRoot,
    await realpath(repositoryRoot)
  ]);
}

/** Rewrites persisted run state directly, as an operator or crash would leave it. */
export async function rewriteRunState(
  store: RunStore,
  runId: string,
  mutate: (state: RunState) => void
): Promise<void> {
  const file = store.statePath(runId);
  const state = JSON.parse(await readFile(file, "utf8")) as RunState;
  mutate(state);
  await writeFile(file, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

/**
 * Observes one eligibility decision through the public runner: the status
 * projection's retry, recovery and next action, or restore eligibility, plus
 * the state persisted afterwards so eligibility-time effects stay visible.
 */
export async function observeEligibility(
  runner: WorkflowRunner,
  repositoryRoot: string,
  runId: string,
  observe: "status" | "restore" = "status"
): Promise<unknown> {
  let observed: unknown;
  try {
    if (observe === "restore") {
      observed = await runner.restoreEligibility();
    } else {
      const status = await runner.status();
      observed = {
        retry: status.retry,
        recovery: status.recovery,
        nextAction: status.nextAction
      };
    }
  } catch (error) {
    observed = {
      error: {
        code: error instanceof BanzaiError ? error.code : null,
        message: error instanceof Error ? error.message : String(error)
      }
    };
  }
  const persisted = JSON.parse(
    await readFile(runner.store.statePath(runId), "utf8")
  ) as RunState;
  return normalizeOutcome(
    {
      observed,
      persisted: {
        status: persisted.status,
        blockedFrom: persisted.blockedFrom,
        blockReason: persisted.blockReason
      }
    },
    repositoryRoot
  );
}
