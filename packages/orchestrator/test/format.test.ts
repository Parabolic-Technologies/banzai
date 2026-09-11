import assert from "node:assert/strict";
import test from "node:test";
import {
  formatTokenCount,
  formatUsage,
  hangingLines,
  labeledLines,
  resolveWidth,
  wrapText
} from "../src/format.js";

test("width clamps to the range worth wrapping to", () => {
  assert.equal(resolveWidth(undefined), 80);
  assert.equal(resolveWidth(Number.NaN), 80);
  assert.equal(resolveWidth(20), 40);
  assert.equal(resolveWidth(72), 72);
  assert.equal(resolveWidth(400), 96);
  assert.equal(resolveWidth(72.6), 72);
});

test("wrapping breaks on words and honours the indent", () => {
  assert.deepEqual(wrapText("one two three four", 10), [
    "one two",
    "three four"
  ]);
  assert.deepEqual(wrapText("one two three four", 10, "  "), [
    "  one two",
    "  three",
    "  four"
  ]);
  assert.deepEqual(wrapText("   ", 10), []);
  for (const line of wrapText("alpha beta gamma delta", 12)) {
    assert.ok(line.length <= 12);
  }
});

test("a token longer than the width is never broken", () => {
  // Paths and run ids stay selectable; the terminal soft-wraps the remainder.
  const long = "documentation/features/example/development-plan.md";
  assert.deepEqual(wrapText(`see ${long} now`, 20), ["see", long, "now"]);
});

test("labelled prose stays on one line until it overflows", () => {
  assert.deepEqual(labeledLines("Workflow", "quick-fix (short)", 80), [
    "Workflow: quick-fix (short)"
  ]);
  assert.deepEqual(
    labeledLines("Review summary", "one two three four five", 20),
    ["Review summary:", "  one two three four", "  five"]
  );
  assert.deepEqual(labeledLines("Blocked", "   ", 80), ["Blocked:"]);
});

test("labelled prose fits exactly at the width boundary", () => {
  const single = labeledLines("Blocked", "12345678901", 20);
  assert.deepEqual(single, ["Blocked: 12345678901"]);
  assert.equal(single[0]?.length, 20);
  assert.deepEqual(labeledLines("Blocked", "123456789012", 20), [
    "Blocked:",
    "  123456789012"
  ]);
});

test("hanging prose aligns continuations under the prefix", () => {
  assert.deepEqual(hangingLines("R1-F1 [major] ", "one two three four", 40), [
    "R1-F1 [major] one two three four"
  ]);
  assert.deepEqual(
    hangingLines("R1-F1 [major] ", "alpha beta gamma delta epsilon", 40),
    ["R1-F1 [major] alpha beta gamma delta", "              epsilon"]
  );
  assert.deepEqual(hangingLines("  1. ", "", 20), ["  1."]);
});

test("a prefix too long to hang under takes its own line", () => {
  // Hanging under a long evidence path leaves one column for prose, which
  // renders one word per line and can run to dozens of them.
  const path =
    "documentation/features/sandbox-project-layout-fixture-0000000000000/test-report.md:77";
  const lines = hangingLines(
    `  ${path} - `,
    "The risk map credits this test",
    96
  );
  assert.deepEqual(lines, [
    `  ${path} -`,
    "    The risk map credits this test"
  ]);
  // Continuations are indented relative to where the prefix started.
  assert.deepEqual(hangingLines(`${path} - `, "one two", 96).slice(1), [
    "  one two"
  ]);
});

test("a hanging body narrower than half the width takes its own line", () => {
  // This prefix leaves 25 columns — just over the old 24-column floor — so the
  // hang was kept and one sentence of review evidence rendered as seven ragged
  // lines: "composer / codecept:functional / exited nonzero on a / ...".
  const path =
    "documentation/features/sandbox-project-evidencess/test-report.md:54";
  const detail =
    "composer codecept:functional exited nonzero on a Functional failure, " +
    "and its script chain stopped before FunctionalApi ran.";
  const lines = hangingLines(`  ${path} - `, detail, 96);
  assert.equal(lines[0], `  ${path} -`);
  assert.equal(lines.length, 3);
  for (const line of lines.slice(1)) {
    assert.ok(line.startsWith("    "), line);
  }
  // Every filled line now carries a full measure of prose rather than the three
  // or four words a 25-column column allowed. The last line holds the
  // remainder, so only the lines before it are full.
  for (const line of lines.slice(1, -1)) {
    assert.ok(line.length > 48, `too narrow: ${line}`);
  }
  // A short label still hangs: the rule is about the share the body keeps, not
  // about abandoning alignment.
  assert.deepEqual(hangingLines("  Resolved by: ", "alpha beta gamma", 96), [
    "  Resolved by: alpha beta gamma"
  ]);
});

test("token counts render at terminal scale", () => {
  assert.equal(formatTokenCount(0), "0");
  assert.equal(formatTokenCount(-5), "0");
  assert.equal(formatTokenCount(Number.NaN), "0");
  assert.equal(formatTokenCount(120), "120");
  assert.equal(formatTokenCount(999), "999");
  assert.equal(formatTokenCount(1_000), "1K");
  assert.equal(formatTokenCount(21_594), "21.6K");
  assert.equal(formatTokenCount(8_289_499), "8.3M");
});

test("usage reports the fresh count and cache ratio that explain the input count", () => {
  assert.equal(
    formatUsage(8_289_499, 8_044_032, 21_594),
    "8.3M in (245.5K fresh · 97% cached) · 21.6K out"
  );
  assert.equal(
    formatUsage(120, 80, 30),
    "120 in (40 fresh · 66% cached) · 30 out"
  );
  assert.equal(formatUsage(120, 0, 30), "120 in · 30 out");
  assert.equal(formatUsage(0, 0, 0), "0 in · 0 out");
  // A vendor reporting more cached than input must not exceed 100%.
  assert.equal(
    formatUsage(100, 400, 10),
    "100 in (0 fresh · 100% cached) · 10 out"
  );
  // 100% appears only when every input token was served from cache: a real
  // strict run with 510 fresh tokens out of 71.9M must floor to 99%, never
  // round up to an impossible 100%.
  assert.equal(
    formatUsage(71_854_965, 71_854_455, 261_118),
    "71.9M in (510 fresh · 99% cached) · 261.1K out"
  );
  assert.equal(
    formatUsage(100, 100, 10),
    "100 in (0 fresh · 100% cached) · 10 out"
  );
});

test("the turn count gives a cumulative input total its denominator", () => {
  // The originating run: 49 stateless requests over ~670K of context sum to
  // 33M input, of which only 109.1K was fresh. Without the turn count the
  // total reads as one impossible prompt.
  assert.equal(
    formatUsage(32_967_078, 32_857_946, 41_062, 49),
    "49 turns · 33M in (109.1K fresh · 99% cached) · 41.1K out"
  );
  assert.equal(formatUsage(100, 0, 10, 1), "1 turn · 100 in · 10 out");
  // A non-reporting vendor omits the part rather than rendering a zero.
  assert.equal(formatUsage(100, 0, 10, 0), "100 in · 10 out");
  assert.equal(formatUsage(100, 0, 10, Number.NaN), "100 in · 10 out");
});
