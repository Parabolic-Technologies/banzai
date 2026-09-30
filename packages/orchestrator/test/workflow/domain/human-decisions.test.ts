import assert from "node:assert/strict";
import test from "node:test";
import { BanzaiError } from "../../../src/errors.js";
import {
  decisionIdentifier,
  decisionText
} from "../../../src/workflow/domain/human-decisions.js";

const invalid = (message: string) => (error: unknown) =>
  error instanceof BanzaiError &&
  error.code === "INVALID_DECISION" &&
  error.message === message;

test("decision text accepts only bounded non-empty safe strings", () => {
  assert.equal(decisionText("Owner", "decidedBy", 10), "Owner");
  assert.equal(decisionText("a\nb", "note", 10, true), "a\nb");
  const rejected: [string, unknown, number, boolean][] = [
    ["a non-string", 7, 10, false],
    ["an empty string", "", 10, false],
    ["a string over its bound", "abcdefghijk", 10, false],
    ["whitespace only", "   ", 10, false],
    ["a control character", "a\u0007b", 10, false],
    ["a bidirectional override", "a‮b", 10, false],
    ["a newline where none is allowed", "a\nb", 10, false],
    ["a carriage return where none is allowed", "a\rb", 10, false]
  ];
  for (const [name, value, maximum, allowNewlines] of rejected)
    assert.throws(
      () => decisionText(value, "decidedBy", maximum, allowNewlines),
      invalid("decidedBy must be a bounded non-empty safe string."),
      name
    );
});

test("decision identifiers must be canonical and bounded", () => {
  assert.equal(decisionIdentifier("run-1.a:b_c", "runId"), "run-1.a:b_c");
  assert.throws(
    () => decisionIdentifier("x".repeat(129), "runId"),
    invalid("runId must be a bounded non-empty safe string.")
  );
  assert.equal(decisionIdentifier("x".repeat(300), "runId", 300).length, 300);
  for (const value of ["-leading", ".leading", "has space", "slash/inside"])
    assert.throws(
      () => decisionIdentifier(value, "requestId"),
      invalid("requestId must be a canonical identifier."),
      value
    );
});
