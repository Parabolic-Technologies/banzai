import assert from "node:assert/strict";
import test from "node:test";
import type {
  RunState,
  VerificationCommandDescriptor
} from "../../../src/types.js";
import {
  reconcileVerificationState,
  verificationRound
} from "../../../src/workflow/verification/rounds.js";
import { verificationAttemptFixture } from "../../helpers.js";

const CONFIGURATION_CHANGED = {
  name: "BanzaiError",
  code: "VERIFICATION_CONFIGURATION_CHANGED",
  message:
    "Configured verification commands changed during an open verification round."
};

function descriptor(
  overrides: Partial<VerificationCommandDescriptor> = {}
): VerificationCommandDescriptor {
  return {
    profileId: "node-primary",
    projectType: "node",
    profileOrdinal: 1,
    commandOrdinal: 1,
    configurationDigest: "c".repeat(64),
    command: { name: "test", command: "npm", args: ["test"], timeoutMs: 1000 },
    ...overrides
  };
}

// Sentinel values differ from anything reconcileVerificationState would
// write, so an unchanged state proves the refusal happened before any write.
function sentinelState(): RunState {
  return {
    metrics: { attempts: { verification: 99 } },
    verification: [
      {
        name: "sentinel",
        command: "sentinel",
        args: [],
        exitCode: 0,
        signal: null,
        stdoutPath: "sentinel-stdout.log",
        stderrPath: "sentinel-stderr.log",
        startedAt: "2026-07-01T00:00:00.000Z",
        completedAt: "2026-07-01T00:00:01.000Z"
      }
    ]
  } as unknown as RunState;
}

test("a verification round source attempt cannot change its recorded kind", () => {
  const records = [
    verificationAttemptFixture({
      sequence: 1,
      sourceAttemptId: "implementation-1-fixture"
    })
  ];
  const before = structuredClone(records);

  assert.throws(
    () =>
      verificationRound(records, {
        id: "implementation-1-fixture",
        kind: "fix",
        mutable: true
      }),
    {
      name: "BanzaiError",
      code: "VERIFICATION_ATTEMPT_CONFLICT",
      message: "Verification round source identity has conflicting kinds."
    }
  );
  assert.deepEqual(records, before);
  assert.deepEqual(
    verificationRound(records, {
      id: "implementation-1-fixture",
      kind: "implementation",
      mutable: true
    }),
    before[0]?.round
  );
});

test("an open verification round refuses a removed or reconfigured command without writing state", () => {
  const record = verificationAttemptFixture({ sequence: 1 });
  const cases: readonly (readonly VerificationCommandDescriptor[])[] = [
    [],
    [descriptor({ configurationDigest: "d".repeat(64) })]
  ];
  for (const descriptors of cases) {
    const state = sentinelState();
    const before = structuredClone(state);
    assert.throws(() => {
      reconcileVerificationState(state, [record], record.round, descriptors);
    }, CONFIGURATION_CHANGED);
    assert.deepEqual(state, before);
  }

  const state = sentinelState();
  reconcileVerificationState(state, [record], record.round, [descriptor()]);
  assert.equal(state.metrics.attempts.verification, 1);
  assert.deepEqual(state.verification, [
    {
      name: "test",
      command: "npm",
      args: ["test"],
      exitCode: 0,
      signal: null,
      stdoutPath: "verification/000001-stdout.log",
      stderrPath: "verification/000001-stderr.log",
      startedAt: "2026-07-01T00:01:00.000Z",
      completedAt: "2026-07-01T00:01:01.000Z"
    }
  ]);
});
