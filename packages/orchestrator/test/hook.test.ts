import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { digestArtifactBundle, workspaceSnapshot } from "../src/git.js";
import { createWork } from "../src/artifact-storage.js";
import { createVendorAdapters } from "../src/adapters.js";
import { randomUUID } from "node:crypto";
import { CONTRACT_VERSION, type RunState } from "../src/types.js";
import {
  WorkflowRunner,
  workflowAuthorizationDigest
} from "../src/workflow.js";
import { createTestRepository, evaluationStateFixture } from "./helpers.js";

const hookPath = path.resolve(
  process.cwd(),
  "../../plugins/banzai/hooks/spec-gate.cjs"
);

function runHook(input: {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  event?: string;
  target?: string;
  tool?: string;
}): { decision: string | null; reason: string; stdout: string } {
  const env = { ...process.env, ...input.env };
  delete env.BANZAI_RUN_ID;
  delete env.BANZAI_APPROVAL_DIGEST;
  delete env.BANZAI_WORKFLOW_DIGEST;
  delete env.BANZAI_REVIEW_ARTIFACT;
  Object.assign(env, input.env);
  const result = spawnSync(process.execPath, [hookPath], {
    input: JSON.stringify({
      hook_event_name: input.event ?? "PreToolUse",
      tool_name: input.tool ?? "Edit",
      cwd: input.cwd,
      session_id: `test-${process.pid}-${Math.random()}`,
      permission_mode: "default",
      tool_input: { file_path: input.target ?? "src/example.ts" }
    }),
    encoding: "utf8",
    env
  });
  assert.equal(result.status, 0, result.stderr);
  if (result.stdout.length === 0) {
    return { decision: null, reason: "", stdout: result.stdout };
  }
  const decoded = JSON.parse(result.stdout) as {
    hookSpecificOutput: {
      permissionDecision: string;
      permissionDecisionReason: string;
    };
  };
  return {
    decision: decoded.hookSpecificOutput.permissionDecision,
    reason: decoded.hookSpecificOutput.permissionDecisionReason,
    stdout: result.stdout
  };
}

test("manual hook behavior still asks on the first code edit", async () => {
  const repository = await createTestRepository();
  try {
    const result = runHook({ cwd: repository.root });
    assert.equal(result.decision, "ask");
  } finally {
    await repository.dispose();
  }
});

test("manual hook stays silent outside banzai-adopted repositories", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "banzai-hook-unadopted-"));
  try {
    const result = runHook({ cwd: root });
    assert.equal(result.decision, null);
    assert.equal(result.stdout, "");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a root project manifest gates manual sessions from any subdirectory", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "banzai-hook-adopted-"));
  try {
    await writeFile(
      path.join(root, "PROJECT_MANIFEST.md"),
      "# PROJECT_MANIFEST.md\n",
      "utf8"
    );
    const nested = path.join(root, "packages", "app");
    await mkdir(nested, { recursive: true });
    const result = runHook({ cwd: nested });
    assert.equal(result.decision, "ask");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("orchestrated hook allows a valid bundle and denies drift or state writes", async () => {
  const repository = await createTestRepository();
  try {
    const description = "documentation/features/example/description.md";
    const plan = "documentation/development-plans/example/plan.md";
    await mkdir(path.join(repository.root, path.dirname(description)), {
      recursive: true
    });
    await mkdir(path.join(repository.root, path.dirname(plan)), {
      recursive: true
    });
    await writeFile(
      path.join(repository.root, description),
      "approved\n",
      "utf8"
    );
    await writeFile(path.join(repository.root, plan), "approved\n", "utf8");
    const bundle = await digestArtifactBundle(repository.root, [
      description,
      plan
    ]);
    const runId = "run-test";
    const runDirectory = path.join(repository.root, ".banzai", "runs", runId);
    await mkdir(runDirectory, { recursive: true });
    await writeFile(
      path.join(repository.root, ".banzai", "active-run.json"),
      JSON.stringify({ schemaVersion: 1, runId }),
      "utf8"
    );
    await writeFile(
      path.join(runDirectory, "state.json"),
      JSON.stringify({
        runId,
        repoRoot: repository.root,
        status: "implementing",
        planApproval: { digest: bundle.digest, paths: bundle.paths }
      }),
      "utf8"
    );
    const env = {
      BANZAI_RUN_ID: runId,
      BANZAI_APPROVAL_DIGEST: bundle.digest
    };

    assert.equal(runHook({ cwd: repository.root, env }).decision, "allow");
    const approvedArtifactWrite = runHook({
      cwd: repository.root,
      env,
      target: plan
    });
    assert.equal(approvedArtifactWrite.decision, "deny");
    assert.match(
      approvedArtifactWrite.reason,
      /approved planning artifacts are immutable/
    );

    const implementationReportWrite = runHook({
      cwd: repository.root,
      env,
      target: "documentation/features/example/implementation-report.md"
    });
    assert.equal(implementationReportWrite.decision, "allow");

    const stateWrite = runHook({
      cwd: repository.root,
      env,
      target: `.banzai/runs/${runId}/state.json`
    });
    assert.equal(stateWrite.decision, "deny");
    assert.match(stateWrite.reason, /control files/);

    await writeFile(path.join(repository.root, plan), "changed\n", "utf8");
    const stale = runHook({ cwd: repository.root, env });
    assert.equal(stale.decision, "deny");
    assert.match(stale.reason, /planning artifacts changed/);
  } finally {
    await repository.dispose();
  }
});

test("orchestrated reviewer cannot write even with stale inherited authorization", async () => {
  const repository = await createTestRepository();
  try {
    const description = "documentation/features/example/description.md";
    const plan = "documentation/development-plans/example/plan.md";
    const attemptId = "review-2-abcd1234";
    await mkdir(path.join(repository.root, path.dirname(description)), {
      recursive: true
    });
    await mkdir(path.join(repository.root, path.dirname(plan)), {
      recursive: true
    });
    await writeFile(
      path.join(repository.root, description),
      "approved\n",
      "utf8"
    );
    await writeFile(path.join(repository.root, plan), "approved\n", "utf8");
    const bundle = await digestArtifactBundle(repository.root, [
      description,
      plan
    ]);
    const runId = "review-run";
    const reviewCandidate = `.banzai/runs/${runId}/attempts/${attemptId}.review-candidate.md`;
    const runDirectory = path.join(repository.root, ".banzai", "runs", runId);
    await mkdir(runDirectory, { recursive: true });
    await writeFile(
      path.join(repository.root, ".banzai", "active-run.json"),
      JSON.stringify({ schemaVersion: 1, runId }),
      "utf8"
    );
    await writeFile(
      path.join(runDirectory, "state.json"),
      JSON.stringify({
        runId,
        slug: "example",
        repoRoot: repository.root,
        status: "reviewing",
        reviewIteration: 1,
        activeAttempt: { id: attemptId, kind: "review", mutable: false },
        planApproval: { digest: bundle.digest, paths: bundle.paths }
      }),
      "utf8"
    );
    for (const status of ["reviewing", "blocked"]) {
      const statePath = path.join(runDirectory, "state.json");
      const state = JSON.parse(await readFile(statePath, "utf8")) as {
        status: string;
      };
      state.status = status;
      await writeFile(statePath, JSON.stringify(state), "utf8");
      for (const stale of [false, true]) {
        const env = {
          BANZAI_RUN_ID: runId,
          BANZAI_APPROVAL_DIGEST: bundle.digest,
          ...(stale
            ? {
                BANZAI_REVIEW_ARTIFACT: reviewCandidate,
                BANZAI_WORKFLOW_DIGEST: "stale-workflow"
              }
            : {})
        };
        for (const target of [
          reviewCandidate,
          "src/example.ts",
          `.banzai/runs/${runId}/state.json`,
          "documentation/features/example/review-1.md"
        ]) {
          for (const tool of [
            "Write",
            "Edit",
            "MultiEdit",
            "NotebookEdit",
            "apply_patch"
          ]) {
            const result = runHook({ cwd: repository.root, env, target, tool });
            assert.equal(
              result.decision,
              "deny",
              `${status}/${stale}/${target}/${tool}`
            );
          }
        }
      }
    }
  } finally {
    await repository.dispose();
  }
});

test("lite orchestrated writes require a matching persisted workflow digest", async () => {
  const repository = await createTestRepository();
  try {
    const runId = "lite-run";
    const request = "Fix the existing label.";
    const runDirectory = path.join(repository.root, ".banzai", "runs", runId);
    await mkdir(runDirectory, { recursive: true });
    await writeFile(
      path.join(repository.root, ".banzai", "active-run.json"),
      JSON.stringify({ schemaVersion: 1, runId }),
      "utf8"
    );
    const selectionWithoutDigest = {
      contractVersion: CONTRACT_VERSION,
      recommendedWorkflow: "quick-fix" as const,
      workflow: "quick-fix" as const,
      confidence: "high" as const,
      reason: "This corrects existing behavior.",
      escalationTriggers: [],
      selectedAt: "2026-07-29T12:00:00.000Z",
      attemptId: "selection-1-abcd1234"
    };
    const digest = workflowAuthorizationDigest({
      runId,
      request,
      ...selectionWithoutDigest
    });
    const statePath = path.join(runDirectory, "state.json");
    const state = {
      runId,
      request,
      repoRoot: repository.root,
      status: "implementing",
      workflowSelection: {
        ...selectionWithoutDigest,
        digest
      },
      planApproval: null
    };
    await writeFile(statePath, JSON.stringify(state), "utf8");
    const env = {
      BANZAI_RUN_ID: runId,
      BANZAI_WORKFLOW_DIGEST: digest
    };

    const sourceWrite = runHook({ cwd: repository.root, env });
    assert.equal(sourceWrite.decision, "allow");
    assert.match(sourceWrite.reason, /valid quick-fix workflow authorization/);

    const reportWrite = runHook({
      cwd: repository.root,
      env,
      target: "documentation/changes/small-fix.md"
    });
    assert.equal(reportWrite.decision, "allow");

    const stateWrite = runHook({
      cwd: repository.root,
      env,
      target: `.banzai/runs/${runId}/state.json`
    });
    assert.equal(stateWrite.decision, "deny");
    assert.match(stateWrite.reason, /control files/);

    const missingDigest = runHook({
      cwd: repository.root,
      env: { BANZAI_RUN_ID: runId }
    });
    assert.equal(missingDigest.decision, "deny");
    assert.match(
      missingDigest.reason,
      /approval or workflow digest is missing/
    );

    await writeFile(
      statePath,
      JSON.stringify({
        ...state,
        workflowSelection: {
          ...state.workflowSelection,
          reason: "Tampered reason."
        }
      }),
      "utf8"
    );
    const stale = runHook({ cwd: repository.root, env });
    assert.equal(stale.decision, "deny");
    assert.match(stale.reason, /workflow digest does not match state/);
  } finally {
    await repository.dispose();
  }
});

test("plan and workflow authorizations cannot be crossed or combined", async () => {
  const repository = await createTestRepository();
  try {
    const runId = "mixed-run";
    const runDirectory = path.join(repository.root, ".banzai", "runs", runId);
    await mkdir(runDirectory, { recursive: true });
    await writeFile(
      path.join(repository.root, ".banzai", "active-run.json"),
      JSON.stringify({ schemaVersion: 1, runId }),
      "utf8"
    );
    await writeFile(
      path.join(runDirectory, "state.json"),
      JSON.stringify({
        runId,
        request: "Fix it.",
        repoRoot: repository.root,
        status: "implementing",
        workflowSelection: {
          recommendedWorkflow: "feature",
          workflow: "feature",
          confidence: "high",
          reason: "Small feature.",
          escalationTriggers: [],
          selectedAt: "2026-07-29T12:00:00.000Z",
          attemptId: "selection-1",
          digest: "workflow"
        },
        planApproval: null
      }),
      "utf8"
    );

    const result = runHook({
      cwd: repository.root,
      env: {
        BANZAI_RUN_ID: runId,
        BANZAI_WORKFLOW_DIGEST: "workflow",
        BANZAI_APPROVAL_DIGEST: "plan"
      }
    });
    assert.equal(result.decision, "deny");
    assert.match(result.reason, /cannot be combined/);
  } finally {
    await repository.dispose();
  }
});

test("runner PostToolUse does not create a manual approval marker", async () => {
  const repository = await createTestRepository();
  try {
    const result = runHook({
      cwd: repository.root,
      event: "PostToolUse",
      env: {
        BANZAI_RUN_ID: "partial",
        BANZAI_APPROVAL_DIGEST: "partial"
      }
    });
    assert.equal(result.stdout, "");
  } finally {
    await repository.dispose();
  }
});

test("runner mode fails closed when an edit target cannot be parsed", async () => {
  const repository = await createTestRepository();
  try {
    const env = {
      ...process.env,
      BANZAI_RUN_ID: "run-test",
      BANZAI_APPROVAL_DIGEST: "digest"
    };
    const result = spawnSync(process.execPath, [hookPath], {
      input: JSON.stringify({
        hook_event_name: "PreToolUse",
        tool_name: "apply_patch",
        cwd: repository.root,
        session_id: "unparseable",
        permission_mode: "bypassPermissions",
        tool_input: {}
      }),
      encoding: "utf8",
      env
    });
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout) as {
      hookSpecificOutput: { permissionDecision: string };
    };
    assert.equal(output.hookSpecificOutput.permissionDecision, "deny");
  } finally {
    await repository.dispose();
  }
});

for (const stateVersion of [4, 5] as const)
  test(`v${stateVersion} hook enforces bound phase roles, read-only selection/review and private layout`, async () => {
    const repository = await createTestRepository({
      artifactLayout: "private"
    });
    try {
      const root = await realpath(repository.root);
      const bound = await createWork({
        repoRoot: root,
        slug: "hook-bound",
        schemaVersion: stateVersion === 5 ? 2 : 1,
        mode: "workflow",
        creationId: randomUUID()
      });
      const other = await createWork({
        repoRoot: root,
        slug: "hook-other",
        mode: "workflow",
        creationId: randomUUID()
      });
      const roles = bound.binding.artifacts;
      assert.ok(other.binding.artifacts.plan);
      assert.ok(
        roles.description &&
          roles.plan &&
          roles.implementationReport &&
          roles.testReport &&
          roles.changeReport &&
          roles.work
      );
      const runId = `hook-v${stateVersion}`;
      const runDirectory = path.join(root, ".banzai/runs", runId);
      await mkdir(runDirectory, { recursive: true });
      await writeFile(
        path.join(root, ".banzai/active-run.json"),
        JSON.stringify({ schemaVersion: 1, runId })
      );
      for (const role of [roles.description, roles.plan])
        await writeFile(path.join(root, role), "approved\n");
      const bundle = await digestArtifactBundle(root, [
        roles.description,
        roles.plan
      ]);
      const statePath = path.join(runDirectory, "state.json");
      const save = async (
        phase: string,
        status: string,
        extra: Record<string, unknown> = {}
      ) =>
        writeFile(
          statePath,
          JSON.stringify(
            evaluationStateFixture({
              workflow: "strict",
              extra: {
                schemaVersion: stateVersion,
                runId,
                repoRoot: root,
                artifactBinding: bound,
                status,
                activeAttempt: {
                  id: `${phase}-1`,
                  kind: phase,
                  mutable: phase !== "review" && phase !== "selection"
                },
                planApproval: { digest: bundle.digest, paths: bundle.paths },
                ...extra
              }
            })
          )
        );
      const env = {
        BANZAI_RUN_ID: runId,
        BANZAI_APPROVAL_DIGEST: bundle.digest
      };
      const expect = (target: string, decision: string, grant = env) => {
        const result = runHook({ cwd: root, target, env: grant });
        assert.equal(result.decision, decision, `${target}: ${result.reason}`);
      };
      const forbidden = [
        `.banzai/runs/${runId}/state.json`,
        ".banzai/config.json",
        `.banzai/work/${bound.binding.workId}/work.json`,
        other.binding.artifacts.plan,
        ...(roles.verificationDirectory
          ? [`${roles.verificationDirectory}/forged.json`]
          : [])
      ];
      await save("plan", "planning");
      for (const target of [roles.description, roles.plan])
        expect(target, "allow", {
          BANZAI_RUN_ID: runId,
          BANZAI_APPROVAL_DIGEST: ""
        });
      for (const target of [
        ...forbidden,
        roles.implementationReport,
        roles.changeReport
      ])
        expect(target, "deny");
      for (const [phase, status] of [
        ["selection", "selecting"],
        ["review", "reviewing"],
        ["review", "blocked"]
      ] as const) {
        await save(phase, status);
        for (const target of [
          roles.description,
          roles.plan,
          roles.implementationReport,
          roles.changeReport,
          "src/example.ts"
        ])
          expect(target, "deny");
      }
      for (const [phase, status] of [
        ["implementation", "implementing"],
        ["fix", "fixing"]
      ] as const) {
        await save(phase, status);
        for (const target of [
          roles.implementationReport,
          roles.testReport,
          "src/example.ts"
        ])
          expect(target, "allow");
        for (const target of [
          ...forbidden,
          roles.plan,
          roles.description,
          `documentation/features/hook-bound/implementation-report.md`
        ])
          expect(target, "deny");
        expect(roles.changeReport, phase === "fix" ? "allow" : "deny");
      }
      await save("plan", "planning", {
        artifactBinding: { ...bound, sha256: "0".repeat(64) }
      });
      expect(roles.plan, "deny");
      await save("plan", "planning");
      await writeFile(path.join(root, ".gitignore"), ".banzai/runs/\n");
      expect(roles.plan, "deny");
    } finally {
      await repository.dispose();
    }
  });

for (const artifactLayout of ["private", "legacy"] as const)
  test(`bound artifact grants have runner and hook allow/deny parity (${artifactLayout})`, async () => {
    const repository = await createTestRepository({ artifactLayout });
    try {
      const root = await realpath(repository.root);
      const bound = await createWork({
        repoRoot: root,
        slug: "grant-parity",
        mode: "workflow",
        creationId: randomUUID()
      });
      const roles = bound.binding.artifacts;
      assert.ok(
        roles.description &&
          roles.plan &&
          roles.implementationReport &&
          roles.testReport &&
          roles.changeReport &&
          roles.work
      );
      const targets: string[] = [
        roles.description,
        roles.plan,
        roles.implementationReport,
        roles.testReport,
        roles.changeReport,
        roles.work
      ];
      for (const role of [roles.description, roles.plan]) {
        await mkdir(path.dirname(path.join(root, role)), { recursive: true });
        await writeFile(path.join(root, role), "approved\n");
      }
      const bundle = await digestArtifactBundle(root, [
        roles.description,
        roles.plan
      ]);
      const runId = "grant-parity";
      const runDirectory = path.join(root, ".banzai/runs", runId);
      await mkdir(runDirectory, { recursive: true });
      await writeFile(
        path.join(root, ".banzai/active-run.json"),
        JSON.stringify({ schemaVersion: 1, runId })
      );
      const runner = new WorkflowRunner(
        root,
        createVendorAdapters(async () => {
          throw new Error("Grant-boundary tests must not invoke a vendor.");
        })
      );
      const phaseBoundary = runner as unknown as {
        checkArtifactPhaseScope: WorkflowRunner["checkArtifactPhaseScope"];
      };
      for (const workflow of ["strict", "feature", "quick-fix"] as const) {
        for (const phase of [
          "selection",
          "plan",
          "implementation",
          "fix",
          "review"
        ] as const) {
          // Legacy hooks defer broader documentation scope to the runner. Compare
          // their shared strict-fix report/approved-byte boundary without changing it.
          if (
            artifactLayout === "legacy" &&
            (workflow !== "strict" || phase !== "fix")
          )
            continue;
          const state = evaluationStateFixture({
            workflow,
            extra: {
              schemaVersion: 4,
              runId,
              repoRoot: root,
              artifactBinding: bound,
              status: {
                selection: "selecting",
                plan: "planning",
                implementation: "implementing",
                fix: "fixing",
                review: "reviewing"
              }[phase],
              activeAttempt: {
                id: `${phase}-1`,
                kind: phase,
                mutable: phase !== "selection" && phase !== "review"
              },
              workflowSelection: {
                contractVersion: CONTRACT_VERSION,
                recommendedWorkflow: workflow,
                workflow,
                confidence: "high",
                reason: "Fixture selection.",
                escalationTriggers: [],
                selectedAt: "2026-09-11T00:00:00.000Z",
                attemptId: "selection-1"
              },
              planApproval: { digest: bundle.digest, paths: bundle.paths }
            }
          }) as unknown as RunState;
          const env = {
            BANZAI_RUN_ID: runId,
            BANZAI_APPROVAL_DIGEST: phase === "plan" ? "" : bundle.digest
          };
          if (workflow !== "strict" && phase === "implementation") {
            assert.ok(state.workflowSelection);
            state.workflowSelection.digest = workflowAuthorizationDigest({
              runId,
              request: state.request,
              ...state.workflowSelection
            });
            Object.assign(env, {
              BANZAI_APPROVAL_DIGEST: "",
              BANZAI_WORKFLOW_DIGEST: state.workflowSelection.digest
            });
          }
          await writeFile(
            path.join(runDirectory, "state.json"),
            JSON.stringify(state)
          );
          const expected: string[] =
            phase === "plan"
              ? [roles.description, roles.plan]
              : phase === "implementation" || phase === "fix"
                ? workflow === "feature"
                  ? [roles.work]
                  : workflow === "quick-fix"
                    ? [roles.changeReport]
                    : phase === "fix"
                      ? [
                          roles.implementationReport,
                          roles.testReport,
                          roles.changeReport
                        ]
                      : [roles.implementationReport, roles.testReport]
                : [];
          for (const target of targets) {
            if (artifactLayout === "legacy" && target === roles.work) continue;
            const allowed = expected.includes(target);
            const label: string = [workflow, phase, target].join(": ");
            assert.equal(
              runHook({ cwd: root, target, env }).decision,
              allowed ? "allow" : "deny",
              label
            );
            const before = await workspaceSnapshot(root, {
              artifactBinding: bound
            });
            const absolute = path.join(root, target);
            const original = await readFile(absolute).catch(
              (error: unknown) => {
                if (
                  !(error instanceof Error) ||
                  !("code" in error) ||
                  error.code !== "ENOENT"
                )
                  throw error;
                return null;
              }
            );
            try {
              await mkdir(path.dirname(absolute), { recursive: true });
              await writeFile(absolute, "changed artifact\n");
              // Exercise the post-model filesystem enforcement, not just its grant list.
              const check = phaseBoundary.checkArtifactPhaseScope(
                state,
                phase,
                before
              );
              if (allowed) await assert.doesNotReject(check, label);
              else
                await assert.rejects(
                  check,
                  { code: "ARTIFACT_PHASE_SCOPE_INVALID" },
                  label
                );
            } finally {
              if (original === null) await rm(absolute);
              else await writeFile(absolute, original);
            }
          }
        }
      }
    } finally {
      await repository.dispose();
    }
  });

test("R4-F4 manual hook defers only for validated private role paths", async () => {
  const repository = await createTestRepository({ artifactLayout: "private" });
  try {
    const root = await realpath(repository.root);
    const bound = await createWork({
      repoRoot: root,
      slug: "hook-manual",
      mode: "lite",
      creationId: randomUUID()
    });
    assert.ok(bound.binding.artifacts.work);
    assert.equal(
      runHook({ cwd: root, target: bound.binding.artifacts.work }).decision,
      null
    );
    assert.equal(
      runHook({ cwd: root, target: `.banzai/work/${randomUUID()}/work.md` })
        .decision,
      "deny"
    );
    await writeFile(
      path.join(root, `.banzai/work/${bound.binding.workId}/work.json`),
      "invalid binding"
    );
    assert.equal(
      runHook({ cwd: root, target: bound.binding.artifacts.work }).decision,
      "deny"
    );
  } finally {
    await repository.dispose();
  }
});
