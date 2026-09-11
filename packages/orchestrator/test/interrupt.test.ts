import assert from "node:assert/strict";
import test from "node:test";
import {
  createInterruptHandler,
  interruptExitCode,
  INTERRUPT_ACKNOWLEDGED,
  INTERRUPT_FORCED,
  INTERRUPT_STOPPED,
  INTERRUPT_STOPPED_AFTER_KILL,
  INTERRUPT_TIMED_OUT,
  type CancelTimer,
  type InterruptDependencies
} from "../src/interrupt.js";

interface ScheduledTimer {
  handler: () => void;
  delayMs: number;
  cancelled: boolean;
}

interface Harness {
  dependencies: InterruptDependencies;
  events: string[];
  lines: string[];
  timers: ScheduledTimer[];
  exitCodes: number[];
  raised: NodeJS.Signals[];
  settleShutdown: (drained: boolean) => void;
  failShutdown: (error: Error) => void;
}

function harness(overrides: Partial<InterruptDependencies> = {}): Harness {
  const events: string[] = [];
  const lines: string[] = [];
  const timers: ScheduledTimer[] = [];
  const exitCodes: number[] = [];
  const raised: NodeJS.Signals[] = [];
  let settle: (drained: boolean) => void = () => undefined;
  let fail: (error: Error) => void = () => undefined;

  const dependencies: InterruptDependencies = {
    closeProgress: () => events.push("closeProgress"),
    restoreTerminal: () => events.push("restoreTerminal"),
    write: (line) => {
      events.push("write");
      lines.push(line);
    },
    shutdown: async (timeoutMs) => {
      events.push(`shutdown:${timeoutMs}`);
      return await new Promise<boolean>((resolve, reject) => {
        settle = resolve;
        fail = reject;
      });
    },
    forceTerminate: () => events.push("forceTerminate"),
    releaseLocks: () => events.push("releaseLocks"),
    removeListeners: () => events.push("removeListeners"),
    raise: (signal) => {
      events.push("raise");
      raised.push(signal);
    },
    exit: (code) => {
      events.push("exit");
      exitCodes.push(code);
    },
    schedule: (handler, delayMs): CancelTimer => {
      const timer: ScheduledTimer = { handler, delayMs, cancelled: false };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
    ...overrides
  };

  return {
    dependencies,
    events,
    lines,
    timers,
    exitCodes,
    raised,
    settleShutdown: (drained) => {
      settle(drained);
    },
    failShutdown: (error) => {
      fail(error);
    }
  };
}

function timerAt(
  timers: readonly ScheduledTimer[],
  index: number
): ScheduledTimer {
  const timer = timers.at(index);
  assert.ok(timer, `expected a scheduled timer at ${index}`);
  return timer;
}

const tick = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

test("the first interrupt reports itself before it starts waiting", async () => {
  const context = harness();
  const handle = createInterruptHandler(context.dependencies);

  handle("SIGINT");

  assert.deepEqual(context.events.slice(0, 4), [
    "closeProgress",
    "restoreTerminal",
    "write",
    "shutdown:2000"
  ]);
  assert.equal(context.lines[0], INTERRUPT_ACKNOWLEDGED);
  assert.deepEqual(context.exitCodes, []);
});

test("a completed shutdown releases the lock and re-raises the signal", async () => {
  const context = harness();
  const handle = createInterruptHandler(context.dependencies);

  handle("SIGINT");
  context.settleShutdown(true);
  await tick();

  assert.deepEqual(context.lines, [INTERRUPT_ACKNOWLEDGED, INTERRUPT_STOPPED]);
  assert.ok(context.events.includes("releaseLocks"));
  assert.deepEqual(context.raised, ["SIGINT"]);
  assert.ok(
    context.events.indexOf("removeListeners") < context.events.indexOf("raise"),
    "the default disposition must be restored before the signal is re-raised"
  );
  const hardExit = timerAt(context.timers, 0);
  assert.equal(hardExit.delayMs, 6_000);
  assert.equal(hardExit.cancelled, true);
});

test("a re-raised signal that nothing acts on still exits", async () => {
  const context = harness();
  const handle = createInterruptHandler(context.dependencies);

  handle("SIGINT");
  context.settleShutdown(true);
  await tick();

  const fallback = timerAt(context.timers, -1);
  assert.equal(fallback.delayMs, 250);
  fallback.handler();
  assert.deepEqual(context.exitCodes, [130]);
});

test("a vendor that had to be killed says so", async () => {
  const context = harness();
  const handle = createInterruptHandler(context.dependencies);

  handle("SIGINT");
  context.settleShutdown(false);
  await tick();

  assert.equal(context.lines.at(-1), INTERRUPT_STOPPED_AFTER_KILL);
});

test("a failed shutdown still reaches an exit", async () => {
  const context = harness();
  const handle = createInterruptHandler(context.dependencies);

  handle("SIGINT");
  context.failShutdown(new Error("drain failed"));
  await tick();

  assert.equal(context.lines.at(-1), INTERRUPT_STOPPED_AFTER_KILL);
  assert.deepEqual(context.raised, ["SIGINT"]);
});

test("a second interrupt abandons the wait and exits immediately", async () => {
  const context = harness();
  const handle = createInterruptHandler(context.dependencies);

  handle("SIGINT");
  handle("SIGINT");

  assert.equal(context.lines.at(-1), INTERRUPT_FORCED);
  assert.ok(context.events.includes("forceTerminate"));
  assert.deepEqual(context.exitCodes, [130]);
  assert.equal(timerAt(context.timers, 0).cancelled, true);
  assert.deepEqual(context.raised, []);
});

test("a shutdown that never settles is cut off by the hard deadline", () => {
  const context = harness();
  const handle = createInterruptHandler(context.dependencies);

  handle("SIGINT");
  const hardExit = timerAt(context.timers, 0);
  assert.equal(hardExit.delayMs, 6_000);
  hardExit.handler();

  assert.equal(context.lines.at(-1), INTERRUPT_TIMED_OUT);
  assert.ok(context.events.includes("forceTerminate"));
  assert.ok(context.events.includes("releaseLocks"));
  assert.deepEqual(context.exitCodes, [130]);
});

test("terminal state is restored on every interrupt, including the forced one", () => {
  const context = harness();
  const handle = createInterruptHandler(context.dependencies);

  handle("SIGINT");
  handle("SIGINT");

  assert.equal(
    context.events.filter((event) => event === "restoreTerminal").length,
    2
  );
});

test("exit codes follow the signal a shell would report", () => {
  assert.equal(interruptExitCode("SIGINT"), 130);
  assert.equal(interruptExitCode("SIGTERM"), 143);

  const context = harness();
  const handle = createInterruptHandler(context.dependencies);
  handle("SIGTERM");
  handle("SIGTERM");
  assert.deepEqual(context.exitCodes, [143]);
});
