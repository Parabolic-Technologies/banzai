import assert from "node:assert/strict";
import test from "node:test";
import { createStyler } from "../src/ansi.js";
import {
  resolveProgressLevel,
  TerminalProgressReporter,
  type ProgressLevel
} from "../src/progress.js";

const ESC = "\u001b[";
/** Strips SGR sequences so a banner can be measured in visible columns. */
const bare = (line: string): string => line.replace(/\u001b\[[0-9]+m/g, "");

test("terminal progress reports start, heartbeat, and completion", async () => {
  const lines: string[] = [];
  const progress = new TerminalProgressReporter((line) => lines.push(line), 5);

  progress.report({
    kind: "activity_started",
    id: "plan-1",
    label: "Planning",
    detail: "codex model=gpt-5.6-sol effort=xhigh"
  });
  await new Promise((resolve) => setTimeout(resolve, 16));
  progress.report({
    kind: "activity_completed",
    id: "plan-1",
    label: "Planning",
    durationMs: 16
  });
  progress.close();

  assert.equal(
    lines[0],
    "[banzai] START Planning - codex model=gpt-5.6-sol effort=xhigh"
  );
  assert.ok(
    lines.some((line) => /^\[banzai\] WAIT Planning \(\d+ms\)$/.test(line))
  );
  assert.equal(lines.at(-1), "[banzai] DONE Planning (16ms)");
});

test("terminal progress keeps informational and failed activities concise", () => {
  const lines: string[] = [];
  const progress = new TerminalProgressReporter((line) => lines.push(line));

  progress.report({
    kind: "info",
    message: "Preparing\nrun example"
  });
  progress.report({
    kind: "activity_started",
    id: "review-1",
    label: "Review",
    detail: "claude model=opus effort=xhigh"
  });
  progress.report({
    kind: "activity_failed",
    id: "review-1",
    label: "Review",
    durationMs: 1_250
  });
  progress.close();

  assert.deepEqual(lines, [
    "[banzai] Preparing run example",
    "[banzai] START Review - claude model=opus effort=xhigh",
    "[banzai] FAIL Review (1.3s)"
  ]);
});

test("a model phase renders a banner only when styling is on", () => {
  const started = {
    kind: "activity_started",
    id: "review-7",
    label: "Review 7",
    detail: "codex model=gpt-5.6-sol effort=xhigh timeout=30m",
    descriptor: {
      executable: "/usr/local/bin/codex",
      model: "gpt-5.6-sol",
      effort: "xhigh",
      sessionMode: "fresh",
      timeoutMs: 1_800_000,
      phases: ["review"]
    }
  } as const;

  const plain: string[] = [];
  const unstyled = new TerminalProgressReporter((line) => plain.push(line));
  unstyled.report(started);
  unstyled.close();
  // Unstyled output ignores the descriptor entirely: the detail line is intact.
  assert.deepEqual(plain, [
    "[banzai] START Review 7 - codex model=gpt-5.6-sol effort=xhigh timeout=30m"
  ]);

  const styled: string[] = [];
  const reporter = new TerminalProgressReporter(
    (line) => styled.push(line),
    30_000,
    { styler: createStyler(true), columns: () => 78 }
  );
  reporter.report(started);
  reporter.close();
  const banner = bare(styled[0] ?? "");
  assert.equal(banner.length, 78);
  assert.match(
    banner,
    /^── Review 7 ─+ codex · gpt-5\.6-sol · xhigh · fresh · 30m cap ──$/
  );
});

test("an activity without a descriptor keeps the plain line under styling", () => {
  const lines: string[] = [];
  const reporter = new TerminalProgressReporter(
    (line) => lines.push(line),
    30_000,
    { styler: createStyler(true), columns: () => 78 }
  );
  reporter.report({
    kind: "activity_started",
    id: "checks",
    label: "Planning checks",
    detail: "codex subscription authentication"
  });
  reporter.report({
    kind: "activity_failed",
    id: "checks",
    label: "Planning checks",
    durationMs: 400
  });
  reporter.close();

  assert.equal(
    lines[0],
    "[banzai] START Planning checks - codex subscription authentication"
  );
  // Failure is the one line that takes a colour.
  assert.equal(
    lines[1],
    `${ESC}31m[banzai] FAIL Planning checks (400ms)${ESC}0m`
  );
  assert.equal(bare(lines[1]), "[banzai] FAIL Planning checks (400ms)");
});

test("a narrow terminal keeps the banner readable instead of negative-width", () => {
  const lines: string[] = [];
  const reporter = new TerminalProgressReporter(
    (line) => lines.push(line),
    30_000,
    { styler: createStyler(true), columns: () => 10 }
  );
  reporter.report({
    kind: "activity_started",
    id: "x",
    label: "Implementation",
    detail: "detail",
    descriptor: {
      executable: "claude",
      model: "claude-sonnet-5",
      effort: "xhigh",
      sessionMode: "resumed",
      timeoutMs: 3_600_000,
      phases: []
    }
  });
  reporter.close();
  assert.match(
    bare(lines[0] ?? ""),
    /^── Implementation ─ claude · claude-sonnet-5 · xhigh · resumed · 60m cap ──$/
  );
});

test("progress level takes the flag over the environment over the default", () => {
  assert.equal(resolveProgressLevel([], {}), "normal");
  assert.equal(resolveProgressLevel(["--quiet"], {}), "quiet");
  assert.equal(resolveProgressLevel(["--verbose"], {}), "verbose");
  assert.equal(resolveProgressLevel([], { BANZAI_PROGRESS: "quiet" }), "quiet");
  assert.equal(
    resolveProgressLevel([], { BANZAI_PROGRESS: " VERBOSE " }),
    "verbose"
  );
  assert.equal(
    resolveProgressLevel(["--verbose"], { BANZAI_PROGRESS: "quiet" }),
    "verbose"
  );
  // Verbosity must never be the reason a run cannot start.
  assert.equal(resolveProgressLevel([], { BANZAI_PROGRESS: "loud" }), "normal");
  assert.equal(resolveProgressLevel([], { BANZAI_PROGRESS: "" }), "normal");
});

/**
 * Action durations are wall-clock and land on 0ms or 1ms depending on load, so
 * assert the shape of the line rather than the machine it ran on.
 */
function withoutActionTimings(lines: readonly string[]): string[] {
  return lines.map((line) => line.replace(/(✗|·) +\d+ms /, "$1 "));
}

function actionStream(level: ProgressLevel): string[] {
  const lines: string[] = [];
  const reporter = new TerminalProgressReporter(
    (line) => lines.push(line),
    5_000,
    {
      level
    }
  );
  const action = (
    id: string,
    detail: string,
    status: "started" | "completed" | "failed"
  ): void => {
    reporter.report({
      kind: "model_action",
      label: "Review 7",
      action: "action",
      status,
      detail,
      actionId: id
    });
  };
  reporter.report({
    kind: "activity_started",
    id: "r",
    label: "Review 7",
    detail: "codex model=gpt-5.6-sol"
  });
  action("c1", "command: git diff --check", "started");
  action("c1", "command: git diff --check", "completed");
  for (const n of [2, 3, 4]) {
    action(`c${n}`, "command: git status", "started");
    action(`c${n}`, "command: git status", "completed");
  }
  action("c5", "command: npm run lint", "started");
  action("c5", "command: npm run lint", "failed");
  reporter.report({
    kind: "activity_completed",
    id: "r",
    label: "Review 7",
    durationMs: 1_000
  });
  reporter.close();
  return lines;
}

test("verbosity decides how much of a model turn reaches the terminal", () => {
  // Verbose keeps the pre-existing shape exactly: every start, every finish.
  assert.deepEqual(actionStream("verbose"), [
    "[banzai] START Review 7 - codex model=gpt-5.6-sol",
    "[banzai] ACTION Review 7 - START command: git diff --check",
    "[banzai] ACTION Review 7 - DONE command: git diff --check",
    "[banzai] ACTION Review 7 - START command: git status",
    "[banzai] ACTION Review 7 - DONE command: git status",
    "[banzai] ACTION Review 7 - START command: git status",
    "[banzai] ACTION Review 7 - DONE command: git status",
    "[banzai] ACTION Review 7 - START command: git status",
    "[banzai] ACTION Review 7 - DONE command: git status",
    "[banzai] ACTION Review 7 - START command: npm run lint",
    "[banzai] ACTION Review 7 - FAIL command: npm run lint",
    "[banzai] DONE Review 7 (1.0s)"
  ]);

  // Quiet keeps phase boundaries and failures only.
  assert.deepEqual(withoutActionTimings(actionStream("quiet")), [
    "[banzai] START Review 7 - codex model=gpt-5.6-sol",
    "[banzai] ✗ command: npm run lint",
    "[banzai] DONE Review 7 (1.0s)"
  ]);

  // Normal settles each action into one line and counts consecutive repeats.
  assert.deepEqual(withoutActionTimings(actionStream("normal")), [
    "[banzai] START Review 7 - codex model=gpt-5.6-sol",
    "[banzai] · command: git diff --check",
    "[banzai] · command: git status",
    "[banzai]   ×3 total",
    "[banzai] ✗ command: npm run lint",
    "[banzai] DONE Review 7 (1.0s)"
  ]);
});

test("durations right-align in a fixed column and slow calls stay undimmed", () => {
  const realNow = Date.now;
  let now = 1_000_000;
  Date.now = () => now;
  try {
    const lines: string[] = [];
    const reporter = new TerminalProgressReporter(
      (line) => lines.push(line),
      5_000,
      { styler: createStyler(true) }
    );
    const action = (
      id: string,
      detail: string,
      status: "started" | "completed"
    ): void => {
      reporter.report({
        kind: "model_action",
        label: "Implementation",
        action: "action",
        status,
        detail,
        actionId: id
      });
    };
    action("a1", "Read: plan.md", "started");
    now += 18;
    action("a1", "Read: plan.md", "completed");
    action("a2", "command: composer test", "started");
    now += 29_000;
    action("a2", "command: composer test", "completed");
    reporter.close();

    // `18ms` pads to the same five-character column as `29s`, so the verb
    // after it starts at one x-position; only the fast call is dimmed — a
    // dimmed `29s` would be typographically identical to a dimmed `18ms`.
    assert.deepEqual(lines, [
      `[banzai] · ${ESC}2m 18ms${ESC}0m Read: plan.md`,
      "[banzai] ·   29s command: composer test"
    ]);
    assert.equal(
      bare(lines[0] ?? "").indexOf("Read:"),
      lines[1]?.indexOf("command:")
    );
  } finally {
    Date.now = realNow;
  }
});

test("an open run of repeats is closed before any other line", () => {
  const lines: string[] = [];
  const reporter = new TerminalProgressReporter(
    (line) => lines.push(line),
    5_000
  );
  for (const n of [1, 2]) {
    reporter.report({
      kind: "model_action",
      label: "Fix",
      action: "action",
      status: "completed",
      detail: "command: git add -A",
      actionId: `c${n}`
    });
  }
  reporter.report({ kind: "info", message: "Publishing the review artifact" });
  reporter.close();

  // The count lands before the unrelated line, never after it.
  assert.deepEqual(lines, [
    "[banzai] · command: git add -A",
    "[banzai]   ×2 total",
    "[banzai] Publishing the review artifact"
  ]);
});

test("the heartbeat names what is still running", async () => {
  const lines: string[] = [];
  const reporter = new TerminalProgressReporter((line) => lines.push(line), 10);
  reporter.report({
    kind: "activity_started",
    id: "impl",
    label: "Implementation",
    detail: "claude"
  });
  for (const [id, detail] of [
    ["a", "command: npm test"],
    ["b", "MCP tool: serena/find_symbol"],
    ["c", "command: git status"],
    ["d", "command: rg -n pattern"]
  ]) {
    reporter.report({
      kind: "model_action",
      label: "Implementation",
      action: "action",
      status: "started",
      detail: detail ?? "",
      actionId: id ?? null
    });
  }
  await new Promise((resolve) => setTimeout(resolve, 25));
  reporter.close();

  const wait = lines.find((line) => line.includes("WAIT Implementation"));
  assert.ok(wait !== undefined);
  assert.match(
    wait,
    /running: command: npm test, MCP tool: serena\/find_symbol, command: git status \(\+1 more\)$/
  );
});

test("a completed action stops being reported as still running", async () => {
  const lines: string[] = [];
  const reporter = new TerminalProgressReporter((line) => lines.push(line), 10);
  reporter.report({
    kind: "activity_started",
    id: "impl",
    label: "Implementation",
    detail: "claude"
  });
  reporter.report({
    kind: "model_action",
    label: "Implementation",
    action: "action",
    status: "started",
    detail: "command: npm test",
    actionId: "a"
  });
  reporter.report({
    kind: "model_action",
    label: "Implementation",
    action: "action",
    status: "completed",
    detail: "command: npm test",
    actionId: "a"
  });
  await new Promise((resolve) => setTimeout(resolve, 25));
  reporter.close();

  const wait = lines.find((line) => line.includes("WAIT Implementation"));
  assert.ok(wait !== undefined);
  assert.equal(wait.includes("running:"), false);
});

test("turn and session openings never occupy the in-flight list", async () => {
  const lines: string[] = [];
  const reporter = new TerminalProgressReporter((line) => lines.push(line), 15);
  reporter.report({
    kind: "activity_started",
    id: "r",
    label: "Review 7",
    detail: "codex"
  });
  // Codex reports `turn` and Claude reports `session` on start and never send
  // a matching completion, so tracking them would pin them in flight forever.
  for (const detail of ["turn", "session"]) {
    reporter.report({
      kind: "model_action",
      label: "Review 7",
      action: "model",
      status: "started",
      detail,
      actionId: null
    });
  }
  reporter.report({
    kind: "model_action",
    label: "Review 7",
    action: "usage",
    status: "info",
    detail: "1K in - 2 out",
    actionId: null
  });
  await new Promise((resolve) => setTimeout(resolve, 30));
  reporter.close();

  const wait = lines.find((line) => line.includes("WAIT Review 7"));
  assert.ok(wait !== undefined);
  assert.equal(wait.includes("running:"), false);
});

function liveReporter(level: ProgressLevel = "normal"): {
  lines: string[];
  raw: string[];
  reporter: TerminalProgressReporter;
} {
  const lines: string[] = [];
  const raw: string[] = [];
  const reporter = new TerminalProgressReporter(
    (line) => lines.push(line),
    20,
    {
      level,
      columns: () => 60,
      write: (chunk) => raw.push(chunk)
    }
  );
  return { lines, raw, reporter };
}

const ERASE = "\r\u001b[2K";
const drawnText = (chunk: string): string => chunk.slice(ERASE.length);

test("the live line erases before every settled line and on close", async () => {
  const { lines, raw, reporter } = liveReporter();
  reporter.report({
    kind: "activity_started",
    id: "r",
    label: "Review 7",
    detail: "codex"
  });
  reporter.report({
    kind: "model_action",
    label: "Review 7",
    action: "action",
    status: "started",
    detail: "command: npm test",
    actionId: "a"
  });
  reporter.report({
    kind: "model_action",
    label: "Review 7",
    action: "action",
    status: "completed",
    detail: "command: npm test",
    actionId: "a"
  });
  reporter.report({ kind: "info", message: "Publishing" });
  await new Promise((resolve) => setTimeout(resolve, 40));
  reporter.report({
    kind: "activity_completed",
    id: "r",
    label: "Review 7",
    durationMs: 1_000
  });
  reporter.close();

  // Nothing is ever drawn without first clearing the row it shares.
  assert.ok(raw.every((chunk) => chunk.startsWith(ERASE)));
  // The last thing written leaves the row empty for the shell prompt.
  assert.equal(raw.at(-1), ERASE);
  // The settled log is unaffected by the live line.
  assert.deepEqual(withoutActionTimings(lines), [
    "[banzai] START Review 7 - codex",
    "[banzai] · command: npm test",
    "[banzai] Publishing",
    "[banzai] DONE Review 7 (1.0s)"
  ]);
  // The periodic heartbeat is redundant while elapsed time is continuous.
  assert.equal(
    lines.some((line) => line.includes("WAIT")),
    false
  );
});

test("the live line names the phase, the elapsed time, and the work", () => {
  const { raw, reporter } = liveReporter();
  reporter.report({
    kind: "activity_started",
    id: "i",
    label: "Implementation",
    detail: "claude"
  });
  reporter.report({
    kind: "model_action",
    label: "Implementation",
    action: "action",
    status: "started",
    detail: "command: npm test",
    actionId: "a"
  });
  reporter.report({
    kind: "model_action",
    label: "Implementation",
    action: "action",
    status: "completed",
    detail: "command: npm test",
    actionId: "a"
  });
  reporter.close();

  const drawn = raw.filter((chunk) => chunk !== ERASE).map(drawnText);
  assert.ok(drawn.some((line) => line.includes("command: npm test")));
  assert.ok(drawn.some((line) => line.includes("1 action")));
  assert.ok(drawn.every((line) => line.includes("Implementation")));
});

test("quiet still advances the live line it does not print to", () => {
  const { lines, raw, reporter } = liveReporter("quiet");
  reporter.report({
    kind: "activity_started",
    id: "i",
    label: "Implementation",
    detail: "claude"
  });
  for (const status of ["started", "completed"] as const) {
    reporter.report({
      kind: "model_action",
      label: "Implementation",
      action: "action",
      status,
      detail: "command: npm test",
      actionId: "a"
    });
  }
  reporter.close();

  assert.equal(
    lines.some((line) => line.includes("npm test")),
    false
  );
  assert.ok(
    raw.some((chunk) => chunk.includes("1 action")),
    "quiet suppresses the line but not the live counter"
  );
});

test("verbose keeps a faithful log and never takes the cursor", () => {
  const { raw, reporter } = liveReporter("verbose");
  reporter.report({
    kind: "activity_started",
    id: "r",
    label: "Review",
    detail: "codex"
  });
  reporter.report({
    kind: "model_action",
    label: "Review",
    action: "action",
    status: "completed",
    detail: "command: npm test",
    actionId: "a"
  });
  reporter.close();

  assert.deepEqual(raw, []);
});

test("a live line never outgrows the terminal row it owns", () => {
  const lines: string[] = [];
  const raw: string[] = [];
  const reporter = new TerminalProgressReporter(
    (line) => lines.push(line),
    20,
    {
      columns: () => 40,
      write: (chunk) => raw.push(chunk)
    }
  );
  reporter.report({
    kind: "activity_started",
    id: "i",
    label: "Implementation",
    detail: "claude"
  });
  for (const id of ["a", "b", "c", "d"]) {
    reporter.report({
      kind: "model_action",
      label: "Implementation",
      action: "action",
      status: "started",
      detail: `command: a-very-long-command-name-${id} --with --flags`,
      actionId: id
    });
  }
  reporter.close();

  for (const chunk of raw.filter((entry) => entry !== ERASE)) {
    // One column short: a status line that wraps survives the next erase.
    assert.ok(
      Array.from(
        new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(
          drawnText(chunk)
        )
      ).length <= 39,
      chunk
    );
  }
});

test("a phase banner names delivered phases without claiming Skill events", () => {
  const render = (phases: readonly string[]): string[] => {
    const lines: string[] = [];
    const reporter = new TerminalProgressReporter(
      (line) => lines.push(line),
      30_000,
      { styler: createStyler(true), columns: () => 96 }
    );
    reporter.report({
      kind: "activity_started",
      id: "x",
      label: "Implementation",
      detail: "d",
      descriptor: {
        executable: "claude",
        model: "claude-sonnet-5",
        effort: "xhigh",
        sessionMode: "fresh",
        timeoutMs: 3_600_000,
        phases
      }
    });
    reporter.close();
    return lines.map(bare);
  };

  // A lite route runs one phase; without the chain it reads as an
  // implementation that skipped planning rather than the whole workflow.
  assert.deepEqual(render(["feature"]).slice(1), ["   phases: feature"]);
  // The route is displayed as a phase responsibility.
  assert.deepEqual(render(["quick-fix"]).slice(1), ["   phases: quick-fix"]);
  // A long strict chain wraps instead of crushing the rule.
  const strict = render(["planning", "planning", "planning"]);
  assert.equal(
    strict.slice(1).join(" ").replace(/\s+/g, " ").trim(),
    "phases: planning → planning → planning"
  );
  for (const line of strict) {
    assert.ok(line.length <= 96, line);
  }
  assert.deepEqual(render(["selection"]).slice(1), ["   phases: selection"]);
  assert.deepEqual(render([]).slice(1), []);
});

test("the live phase line names the phase and what is running it", () => {
  // The banner scrolls away during a long phase; this line does not, so it has
  // to answer both questions on its own.
  const { raw, reporter } = liveReporter();
  reporter.report({
    kind: "activity_started",
    id: "i",
    label: "Implementation",
    detail: "d",
    descriptor: {
      executable: "claude",
      model: "claude-sonnet-5",
      effort: "xhigh",
      sessionMode: "fresh",
      timeoutMs: 3_600_000,
      phases: ["feature"]
    }
  });
  reporter.close();

  const drawn = raw.filter((chunk) => chunk !== ERASE).map(drawnText);
  assert.ok(drawn.length > 0);
  for (const line of drawn) {
    assert.match(line, /Implementation · claude-sonnet-5 xhigh/);
  }
});

test("an activity with no model omits it rather than inventing one", () => {
  const { raw, reporter } = liveReporter();
  reporter.report({
    kind: "activity_started",
    id: "v",
    label: "Verification 1/2",
    detail: "npm test"
  });
  reporter.close();

  const drawn = raw.filter((chunk) => chunk !== ERASE).map(drawnText);
  assert.ok(drawn.length > 0);
  for (const line of drawn) {
    assert.match(line, /^⠋ Verification 1\/2 {2}\d/);
  }
});
