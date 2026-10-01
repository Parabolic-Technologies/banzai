import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { PersistedPhaseResult, RunState } from "../../../src/types.js";
import {
  validateArtifactRoleReferences,
  validateSavedArtifactScope
} from "../../../src/workflow/attempts/result-scope.js";
import { recordingContext } from "../context-fixture.js";

const ROLES = {
  description: "work/description.md",
  plan: "work/plan.md",
  implementationReport: "work/implementation-report.md",
  testReport: "work/test-report.md",
  work: "work/work.md",
  changeReport: "work/change-report.md"
};

function bound(workflow: "strict" | "feature" = "strict"): RunState {
  return {
    artifactBinding: { binding: { artifacts: ROLES }, sha256: "a".repeat(64) },
    workflowSelection: workflow === "strict" ? null : { workflow }
  } as unknown as RunState;
}

function artifacts(
  overrides: Partial<PersistedPhaseResult["artifacts"]> = {}
): Pick<PersistedPhaseResult, "artifacts"> {
  return {
    artifacts: {
      description: null,
      plan: null,
      adrs: [],
      implementationReport: null,
      testReport: null,
      ...overrides
    }
  };
}

test("result artifacts must name the bound work roles and public ADR paths", () => {
  assert.doesNotThrow(() => {
    validateArtifactRoleReferences(
      bound(),
      artifacts({
        plan: ROLES.plan,
        adrs: ["documentation/decisions/0001-example.md"]
      })
    );
  });
  assert.doesNotThrow(() => {
    validateArtifactRoleReferences(
      bound("feature"),
      artifacts({ implementationReport: ROLES.work })
    );
  });
  assert.throws(
    () => {
      validateArtifactRoleReferences(
        bound(),
        artifacts({ plan: "elsewhere/plan.md" })
      );
    },
    {
      code: "ARTIFACT_PHASE_SCOPE_INVALID",
      message: "Result plan does not match the persisted work binding."
    }
  );
  assert.throws(
    () => {
      validateArtifactRoleReferences(
        bound(),
        artifacts({ adrs: [".banzai/work/adr.md"] })
      );
    },
    {
      code: "ARTIFACT_PHASE_SCOPE_INVALID",
      message: "ADR references must retain their public decision paths."
    }
  );
});

test("a bound attempt needs its saved workspace evidence, and consistent evidence at that", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "banzai-result-scope-"));
  try {
    const attempts = path.join(root, ".banzai/runs/run-1/attempts");
    await mkdir(attempts, { recursive: true });
    const { context, calls } = recordingContext({}, root);
    const state = {
      ...bound(),
      runId: "run-1",
      baseCommit: "b".repeat(40)
    } as RunState;
    const attempt = {
      id: "implementation-1-x",
      kind: "implementation",
      mutable: true
    } as const;
    const rejection = {
      code: "ARTIFACT_RECOVERY_REQUIRED",
      message:
        "Original attempt artifact workspace evidence is missing or inconsistent."
    };
    // The reader treats the evidence as required, so a missing file never
    // reaches the inconsistency check.
    await assert.rejects(validateSavedArtifactScope(context, state, attempt), {
      code: "ARTIFACT_EVIDENCE_INCOMPLETE",
      message: "Required artifact evidence is missing."
    });
    await writeFile(
      path.join(attempts, `${attempt.id}.artifact-workspace.json`),
      JSON.stringify({
        schemaVersion: 2,
        baseCommit: "b".repeat(40),
        artifactBindingDigest: "a".repeat(64),
        entries: [],
        digest: "0".repeat(64)
      })
    );
    await assert.rejects(
      validateSavedArtifactScope(context, state, attempt),
      rejection
    );
    assert.deepEqual(calls, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
