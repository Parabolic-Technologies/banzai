import assert from "node:assert/strict";
import test from "node:test";
import { colorDepth, colorEnabled, createStyler } from "../src/ansi.js";

const ESC = "\u001b[";

test("a disabled styler is the identity function", () => {
  const styler = createStyler(false);
  assert.equal(styler.enabled, false);
  for (const style of [
    styler.bold,
    styler.dim,
    styler.red,
    styler.green,
    styler.yellow,
    styler.cyan,
    styler.brand
  ]) {
    assert.equal(style("value"), "value");
  }
});

test("an enabled styler wraps and always resets", () => {
  const styler = createStyler(true);
  assert.equal(styler.enabled, true);
  assert.equal(styler.red("x"), `${ESC}31mx${ESC}0m`);
  assert.equal(styler.bold("x"), `${ESC}1mx${ESC}0m`);
  assert.equal(styler.dim("x"), `${ESC}2mx${ESC}0m`);
});

test("the brand colour degrades with the colour depth", () => {
  assert.equal(
    createStyler(true, 24).brand("x"),
    `${ESC}38;2;255;90;60mx${ESC}0m`
  );
  assert.equal(createStyler(true, 8).brand("x"), `${ESC}38;5;203mx${ESC}0m`);
  assert.equal(createStyler(true, 4).brand("x"), `${ESC}91mx${ESC}0m`);
  // Callers that do not name a depth get the codes every terminal takes.
  assert.equal(createStyler(true).brand("x"), `${ESC}91mx${ESC}0m`);
});

test("colour depth follows COLORTERM, then TERM, unless FORCE_COLOR names it", () => {
  assert.equal(colorDepth({}), 4);
  assert.equal(colorDepth({ TERM: "xterm" }), 4);
  assert.equal(colorDepth({ TERM: "xterm-256color" }), 8);
  assert.equal(colorDepth({ TERM: "xterm-direct" }), 24);
  assert.equal(
    colorDepth({ TERM: "xterm-256color", COLORTERM: "truecolor" }),
    24
  );
  assert.equal(colorDepth({ COLORTERM: "24bit" }), 24);
  assert.equal(colorDepth({ COLORTERM: "TrueColor" }), 24);

  // FORCE_COLOR=3 and =2 name a depth outright; =1 only turns colour on.
  assert.equal(colorDepth({ TERM: "xterm", FORCE_COLOR: "3" }), 24);
  assert.equal(colorDepth({ COLORTERM: "truecolor", FORCE_COLOR: "2" }), 8);
  assert.equal(colorDepth({ TERM: "xterm-256color", FORCE_COLOR: "1" }), 8);
});

test("colour follows the stream unless the environment overrides it", () => {
  const tty = { isTTY: true };
  const pipe = { isTTY: false };
  assert.equal(colorEnabled(tty, {}), true);
  assert.equal(colorEnabled(pipe, {}), false);
  assert.equal(colorEnabled({}, {}), false);

  // NO_COLOR disables, but an empty value is not "present" by convention.
  assert.equal(colorEnabled(tty, { NO_COLOR: "1" }), false);
  assert.equal(colorEnabled(tty, { NO_COLOR: "" }), true);
  assert.equal(colorEnabled(tty, { TERM: "dumb" }), false);
  assert.equal(colorEnabled(tty, { TERM: "xterm-256color" }), true);

  // FORCE_COLOR opts a pipe in, and FORCE_COLOR=0 opts a terminal out.
  assert.equal(colorEnabled(pipe, { FORCE_COLOR: "1" }), true);
  assert.equal(colorEnabled(pipe, { FORCE_COLOR: "" }), false);
  assert.equal(colorEnabled(tty, { FORCE_COLOR: "0" }), false);
  assert.equal(colorEnabled(pipe, { FORCE_COLOR: "1", NO_COLOR: "1" }), true);
});
