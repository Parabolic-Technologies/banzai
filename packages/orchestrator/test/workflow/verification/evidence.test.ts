import assert from "node:assert/strict";
import test from "node:test";
import type { OrchestratorConfig, RunState } from "../../../src/types.js";
import {
  captureVerification,
  taskVerificationStorage,
  verificationStorage
} from "../../../src/workflow/verification/evidence.js";
import { recordingContext } from "../context-fixture.js";

const WORK_BINDING = {
  sha256: "a".repeat(64),
  binding: { workId: "work-1" }
};

test("policy verification storage requires a policy run with its original work binding", () => {
  const { context, calls } = recordingContext({});
  const refused = [
    {
      schemaVersion: 8,
      verificationMode: "task",
      runId: "run-1",
      artifactBinding: WORK_BINDING
    },
    { schemaVersion: 5, runId: "run-1" }
  ];
  for (const state of refused) {
    assert.throws(
      () => verificationStorage(context, state as unknown as RunState),
      {
        name: "BanzaiError",
        code: "VERIFICATION_EVIDENCE_INVALID",
        message:
          "Verification applicability requires its original work binding."
      }
    );
  }
  assert.deepEqual(calls, []);

  assert.deepEqual(
    verificationStorage(context, {
      schemaVersion: 5,
      runId: "run-1",
      artifactBinding: WORK_BINDING
    } as unknown as RunState),
    {
      repoRoot: context.repoRoot,
      workId: "work-1",
      directory: ".banzai/runs/run-1/verification"
    }
  );
});

test("verification capture refuses a project config without an explicit verification policy", async () => {
  const { context, calls } = recordingContext({});
  const state = {
    schemaVersion: 5,
    runId: "run-1",
    artifactBinding: WORK_BINDING
  } as unknown as RunState;
  const configs = [
    {
      schemaVersion: 3,
      verification: {
        profiles: [
          {
            id: "node",
            projectType: "node",
            commands: [
              {
                id: "test",
                name: "test",
                command: "npm",
                args: ["test"],
                timeoutMs: 1000
              }
            ]
          }
        ]
      }
    },
    { schemaVersion: 4, verification: { profiles: [], policy: {} } }
  ];
  for (const config of configs) {
    await assert.rejects(
      captureVerification(
        context,
        state,
        config as unknown as OrchestratorConfig
      ),
      {
        name: "BanzaiError",
        code: "VERIFICATION_CONFIGURATION_CHANGED",
        message:
          "Verification-enabled runs require their explicit project policy."
      }
    );
  }
  assert.deepEqual(calls, []);
});

test("task verification storage preserves historical v2 and bounds current v3 review exclusions", () => {
  const { context, calls } = recordingContext({});
  const refused = [
    undefined,
    {
      sha256: "a".repeat(64),
      binding: {
        schemaVersion: 1,
        workId: "w",
        artifacts: { verificationDirectory: ".banzai/work/w/verification" }
      }
    },
    {
      sha256: "a".repeat(64),
      binding: { schemaVersion: 2, workId: "w", artifacts: {} }
    }
  ];
  for (const artifactBinding of refused) {
    assert.throws(
      () =>
        taskVerificationStorage(context, {
          schemaVersion: 8,
          verificationMode: "task",
          runId: "run-1",
          artifactBinding
        } as unknown as RunState),
      {
        name: "BanzaiError",
        code: "VERIFICATION_EVIDENCE_INVALID",
        message: "Task verification requires its original evidence binding."
      }
    );
  }
  assert.deepEqual(calls, []);

  assert.deepEqual(
    taskVerificationStorage(context, {
      schemaVersion: 8,
      verificationMode: "task",
      runId: "run-1",
      artifactBinding: {
        sha256: "a".repeat(64),
        binding: {
          schemaVersion: 2,
          workId: "w",
          artifacts: { verificationDirectory: ".banzai/work/w/verification" }
        }
      }
    } as unknown as RunState),
    {
      repoRoot: context.repoRoot,
      directory: ".banzai/work/w/verification",
      workId: "w"
    }
  );
  const current = {
    schemaVersion: 9,
    verificationMode: "task",
    runId: "run-1",
    reviewIteration: 1,
    artifactBinding: {
      sha256: "a".repeat(64),
      binding: {
        schemaVersion: 3,
        workId: "w",
        artifacts: {
          reviewDirectory: "documentation/work/example",
          verificationDirectory: ".banzai/runs/run-1/verification"
        }
      }
    }
  } as unknown as RunState;
  assert.deepEqual(taskVerificationStorage(context, current), {
    repoRoot: context.repoRoot,
    directory: ".banzai/runs/run-1/verification",
    workId: "w",
    excludedSourcePaths: [
      "documentation/work/example/review-1.md",
      "documentation/work/example/review-2.md"
    ]
  });
  assert.throws(
    () =>
      taskVerificationStorage(context, { ...current, reviewIteration: 1001 }),
    { code: "VERIFICATION_EVIDENCE_INVALID" }
  );
});
