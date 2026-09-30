import assert from "node:assert/strict";
import test from "node:test";
import { BanzaiError } from "../../../src/errors.js";
import type {
  VerificationAttemptRecord,
  VerificationCommandDescriptor
} from "../../../src/types.js";
import {
  verificationCommandMatches,
  verificationFailureCategory
} from "../../../src/workflow/domain/verification-attempts.js";

test("verification failures map process codes to their persisted category", () => {
  const rows: [unknown, string][] = [
    [new BanzaiError("PROCESS_START_FAILED", "x"), "process_start"],
    [new BanzaiError("PROCESS_TIMEOUT", "x"), "timeout"],
    [new BanzaiError("PROCESS_OUTPUT_LIMIT", "x"), "output_limit"],
    [new BanzaiError("STATE_READ_FAILED", "x"), "runner_failure"],
    [new Error("PROCESS_TIMEOUT"), "runner_failure"],
    ["PROCESS_TIMEOUT", "runner_failure"]
  ];
  for (const [error, category] of rows)
    assert.equal(verificationFailureCategory(error), category, String(error));
});

test("a verification record matches only its exact command descriptor", () => {
  const descriptor = {
    profileId: "npm",
    projectType: "node",
    profileOrdinal: 1,
    commandOrdinal: 2,
    configurationDigest: "c".repeat(64)
  } as unknown as VerificationCommandDescriptor;
  const record = (
    overrides: Partial<Record<keyof typeof descriptor, unknown>> = {}
  ) =>
    ({
      command: { ...descriptor, ...overrides }
    }) as unknown as VerificationAttemptRecord;
  assert.equal(verificationCommandMatches(record(), descriptor), true);
  for (const overrides of [
    { profileId: "other" },
    { projectType: "python" },
    { profileOrdinal: 2 },
    { commandOrdinal: 1 },
    { configurationDigest: "d".repeat(64) }
  ])
    assert.equal(
      verificationCommandMatches(record(overrides), descriptor),
      false,
      JSON.stringify(overrides)
    );
});
