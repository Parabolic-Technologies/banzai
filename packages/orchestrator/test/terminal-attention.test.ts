import assert from "node:assert/strict";
import { Writable } from "node:stream";
import { setImmediate } from "node:timers/promises";
import test from "node:test";
import {
  TerminalAttention,
  type TerminalAttentionOptions
} from "../src/terminal-attention.js";
import type { RunState } from "../src/types.js";

function fixture(overrides: Partial<TerminalAttentionOptions> = {}) {
  let now = 0;
  const writes: string[] = [];
  const output = Object.assign(
    new Writable({
      write(chunk, _encoding, callback) {
        writes.push(String(chunk));
        callback();
      }
    }),
    { isTTY: true }
  );
  const attention = new TerminalAttention({
    platform: "darwin",
    env: { TERM_PROGRAM: "Apple_Terminal" },
    interactiveTerminal: true,
    output,
    now: () => now,
    ...overrides
  });
  return {
    attention,
    output,
    writes,
    advance(ms: number) {
      now += ms;
    },
    async work(status: RunState["status"], ms = 30_000) {
      const result = { status };
      assert.equal(
        await attention.run(async () => {
          now += ms;
          return result;
        }),
        result,
        "notification must preserve the exact runner result"
      );
    }
  };
}

test("long work signals each human gate once using the terminal's protocol", async () => {
  for (const [terminal, sequence] of [
    ["Apple_Terminal", "\x07"],
    ["iTerm.app", "\x1b]1337;RequestAttention=once\x07"]
  ] as const) {
    const f = fixture({ env: { TERM_PROGRAM: terminal } });
    const statuses: RunState["status"][] = [
      "needs_plan_approval",
      "needs_adr_approval",
      "needs_human_decision",
      "needs_triage",
      "blocked"
    ];
    for (const status of statuses) {
      await f.work(status);
    }
    assert.deepEqual(
      f.writes,
      statuses.map(() => sequence)
    );
    await setImmediate();
    assert.equal(f.output.listenerCount("error"), 0);
  }
});

test("short operations do not accumulate and time outside work is excluded", async () => {
  const f = fixture();
  await f.work("needs_plan_approval", 29_999);
  f.advance(3_600_000);
  await f.work("needs_plan_approval", 1);
  await f.work("needs_plan_approval", 29_999);
  assert.deepEqual(f.writes, []);
  await f.work("needs_plan_approval", 30_000);
  f.advance(3_600_000);
  assert.deepEqual(f.writes, ["\x07"]);
});

test("completion, cancellation, automatic states, and failed operations stay quiet", async () => {
  const f = fixture();
  for (const status of [
    "done",
    "cancelled",
    "planning",
    "implementing"
  ] as const) {
    await f.work(status, 60_000);
  }
  const error = new Error("runner failed");
  await assert.rejects(
    f.attention.run(async () => {
      f.advance(60_000);
      throw error;
    }),
    (actual) => actual === error
  );
  assert.deepEqual(f.writes, []);
});

test("unsupported and non-human surfaces never receive control bytes", async (t) => {
  const cases: [string, Partial<TerminalAttentionOptions>][] = [
    ["Linux", { platform: "linux" }],
    ["non-interactive input or output", { interactiveTerminal: false }],
    ["unknown terminal", { env: { TERM_PROGRAM: "unknown" } }],
    ["missing terminal identity", { env: {} }],
    ...[
      { BANZAI_ATTENTION: "off" },
      { CI: "true" },
      { TMUX: "/tmp/tmux/session" },
      { STY: "screen-session" },
      { TERM: "dumb" }
    ].map((env): [string, Partial<TerminalAttentionOptions>] => [
      Object.keys(env).join(","),
      { env: { TERM_PROGRAM: "iTerm.app", ...env } }
    ])
  ];
  for (const [name, options] of cases) {
    await t.test(name, async () => {
      const f = fixture(options);
      await f.work("needs_plan_approval", 60_000);
      assert.deepEqual(f.writes, []);
    });
  }
  const redirected = fixture();
  redirected.output.isTTY = false;
  const f = fixture({ output: redirected.output });
  await f.work("needs_plan_approval", 60_000);
  assert.deepEqual(redirected.writes, []);
});

test("synchronous and asynchronous notification write failures preserve the result", async () => {
  for (const synchronous of [true, false]) {
    const output = Object.assign(
      new Writable({
        write(_chunk, _encoding, callback) {
          const error = new Error("terminal unavailable");
          if (synchronous) {
            throw error;
          }
          queueMicrotask(() => {
            callback(error);
          });
        }
      }),
      { isTTY: true }
    );
    const f = fixture({ output });
    await f.work("needs_triage");
    await setImmediate();
    assert.equal(output.listenerCount("error"), 0);
  }
  const f = fixture();
  f.output.destroy();
  await f.work("blocked");
  assert.deepEqual(f.writes, []);
});
