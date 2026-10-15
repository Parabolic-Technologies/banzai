import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import test from "node:test";
import { stripVTControlCharacters } from "node:util";
import {
  collapsedPastePrompt,
  InquirerInteractiveIO
} from "../src/inquirer-io.js";

const PASTE_START = "\u001B[200~";
const PASTE_END = "\u001B[201~";
const PASTE_MODE_ENABLE = "\u001B[?2004h";
const PASTE_MODE_DISABLE = "\u001B[?2004l";

function nextTurn(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

interface PromptHarness {
  input: PassThrough;
  output(): string;
  result: Promise<string>;
}

async function promptHarness(
  validate: (value: string) => true | string = () => true
): Promise<PromptHarness> {
  const input = new PassThrough();
  const output = new PassThrough();
  output.setEncoding("utf8");
  let rendered = "";
  output.on("data", (chunk: string) => {
    rendered += chunk;
  });
  const result = collapsedPastePrompt(
    { message: "What should Banzai implement?", validate },
    { input, output }
  );
  await nextTurn();
  return { input, output: () => rendered, result };
}

function paste(input: PassThrough, content: string): void {
  input.write(`${PASTE_START}${content}${PASTE_END}`);
}

test("multi-select validates selected values and retains the checkbox after an empty selection", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  output.setEncoding("utf8");
  let rendered = "";
  output.on("data", (chunk: string) => {
    rendered += chunk;
  });
  const stdin = Object.getOwnPropertyDescriptor(process, "stdin");
  const stdout = Object.getOwnPropertyDescriptor(process, "stdout");
  assert.ok(stdin && stdout);
  const validations: string[][] = [];
  let result: Promise<string[]> | null = null;
  const guard = setTimeout(() => input.write("\u0003"), 5000);
  try {
    Object.defineProperty(process, "stdin", {
      configurable: true,
      value: input
    });
    Object.defineProperty(process, "stdout", {
      configurable: true,
      value: output
    });
    result = new InquirerInteractiveIO().multiSelect(
      "Select reviewed documents",
      [
        { name: "Plan", value: "plan.md" },
        { name: "Description", value: "description.md" }
      ],
      (values) => {
        validations.push([...values]);
        return values.length === 0 ? "Select at least one document." : true;
      }
    );
    await nextTurn();
    input.write("\r");
    await nextTurn();
    assert.match(
      stripVTControlCharacters(rendered),
      /Select at least one document\./
    );
    input.write(" ");
    await nextTurn();
    input.write("\r");
    assert.deepEqual(await result, ["plan.md"]);
    assert.deepEqual(validations, [[], ["plan.md"]]);
  } finally {
    clearTimeout(guard);
    input.write("\u0003");
    if (result !== null) await result.catch(() => {});
    Object.defineProperty(process, "stdin", stdin);
    Object.defineProperty(process, "stdout", stdout);
  }
});

test("collapsed paste preserves multiline Markdown and renders a placeholder", async () => {
  const harness = await promptHarness((value) =>
    value.trim().length === 0 ? "Required" : true
  );
  const markdown = [
    "# Feature",
    "",
    "- preserve `$VALUE`",
    "- keep `$(touch /tmp/not-run)` as text",
    "",
    "```ts",
    'const greeting = "Привіт";',
    "```"
  ].join("\n");

  paste(harness.input, markdown);
  await nextTurn();

  const visible = stripVTControlCharacters(harness.output());
  assert.match(visible, /\[Pasted text #1 \+7 lines\]/);
  assert.match(visible, /paste again to expand/);
  assert.ok(!visible.includes("touch /tmp/not-run"));

  harness.input.write("\r");
  assert.equal(await harness.result, markdown);
  assert.ok(harness.output().includes(PASTE_MODE_ENABLE));
  assert.ok(harness.output().includes(PASTE_MODE_DISABLE));
});

test("typed text and multiple pastes submit in their original order", async () => {
  const harness = await promptHarness();
  harness.input.write("Before ");
  paste(harness.input, "first\nblock");
  harness.input.write(" between ");
  paste(harness.input, "second\nblock\nend");
  harness.input.write(" after");
  await nextTurn();

  harness.input.write("\r");
  const result = await harness.result;

  const visible = stripVTControlCharacters(harness.output());
  assert.match(visible, /\[Pasted text #1 \+1 lines\]/);
  assert.match(visible, /\[Pasted\s+text #2 \+2 lines\]/);

  assert.equal(result, "Before first\nblock between second\nblock\nend after");
});

test("paste-like marker text inside a block is never expanded as another block", async () => {
  const harness = await promptHarness();
  const first = "literal [Pasted text #2 +1 lines]\nfirst";
  const second = "second\nblock";
  paste(harness.input, first);
  harness.input.write(" between ");
  paste(harness.input, second);
  harness.input.write("\r");

  assert.equal(await harness.result, `${first} between ${second}`);
});

test("single-line bracketed paste remains ordinary editable text", async () => {
  const harness = await promptHarness();
  paste(harness.input, "single-line");
  harness.input.write(" request\r");

  assert.equal(await harness.result, "single-line request");
  assert.doesNotMatch(
    stripVTControlCharacters(harness.output()),
    /Pasted text #/
  );
});

test("pasting the same block twice expands a sanitized preview without duplication", async () => {
  const harness = await promptHarness();
  const content = "\u001B[31mred\u001B[0m\nnext";
  paste(harness.input, content);
  await nextTurn();
  paste(harness.input, content);
  await nextTurn();

  const visible = stripVTControlCharacters(harness.output());
  assert.match(visible, /Pasted text #1 preview; exact text will be submitted/);
  assert.match(visible, /red\nnext/);
  assert.ok(!harness.output().includes("\u001B[31mred"));

  harness.input.write("\r");
  assert.equal(await harness.result, content);
});

test("Backspace at a placeholder boundary removes the complete paste", async () => {
  const harness = await promptHarness();
  paste(harness.input, "remove\nall");
  await nextTurn();
  harness.input.write("\u007F");
  harness.input.write("replacement\r");

  assert.equal(await harness.result, "replacement");
});

test("validation keeps the prompt active and paste mode is disabled after success", async () => {
  const harness = await promptHarness((value) =>
    value.trim().length === 0 ? "Request is required" : true
  );
  harness.input.write("\r");
  await nextTurn();
  assert.match(
    stripVTControlCharacters(harness.output()),
    /Request is required/
  );

  paste(harness.input, "valid\nrequest");
  harness.input.write("\r");
  assert.equal(await harness.result, "valid\nrequest");
  assert.equal(harness.output().split(PASTE_MODE_ENABLE).length - 1, 1);
  assert.equal(harness.output().split(PASTE_MODE_DISABLE).length - 1, 1);
});

test("Ctrl+C rejects the prompt and disables bracketed paste mode", async () => {
  const harness = await promptHarness();
  harness.input.write("\u0003");
  await assert.rejects(harness.result, /SIGINT/);
  assert.ok(harness.output().includes(PASTE_MODE_DISABLE));
});
