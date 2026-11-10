import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { digestArtifactBundle, workspaceSnapshot } from "../src/git.js";
import { createTestWork as createWork } from "./helpers.js";
import { checkArtifactPhaseScope } from "../src/workflow/attempts/result-scope.js";
import { randomUUID } from "node:crypto";
import {
  CONTRACT_VERSION,
  RUN_STATE_SCHEMA_VERSION,
  type RunState
} from "../src/types.js";
import { workflowAuthorizationDigest } from "../src/workflow.js";
import { createTestRepository, evaluationStateFixture } from "./helpers.js";
import { createPlanningReviewFixture } from "./workflow-fixtures.js";
import { planningTriageAnswer } from "./planning-review-fixtures.js";

test("the real hook denies both planning kinds with runner environments across every write target", async () => {
  const f = await createPlanningReviewFixture(1);
  try {
    const roles = f.requested.artifactBinding?.binding.artifacts;
    assert.ok(roles);
    assert.ok(roles.plan);
    const targets = [
      roles.plan,
      "documentation/decisions/9999-new.md",
      "src/example.ts",
      `${roles.reviewDirectory}/planning-review-1.md`
    ];
    const observed: string[] = [];
    f.adapters.onPlanning = async (request) => {
      const state = await f.runner.store.requireActiveState();
      const kind = state.activeAttempt?.kind;
      assert.ok(kind === "planning_review" || kind === "planning_analysis");
      observed.push(kind);
      assert.equal(request.env.BANZAI_RUN_ID, state.runId);
      for (const key of [
        "BANZAI_APPROVAL_DIGEST",
        "BANZAI_WORKFLOW_DIGEST",
        "BANZAI_REVIEW_ARTIFACT"
      ])
        assert.ok(!request.env[key]);
      for (const target of targets) {
        const result = runHook({
          cwd: f.repository.root,
          env: request.env,
          target
        });
        assert.equal(
          result.decision,
          "deny",
          `${kind}: ${target}: ${result.reason}`
        );
        assert.match(
          result.reason,
          /planning review and analysis are read-only/
        );
      }
    };
    await f.runner.resume();
    assert.deepEqual(observed, ["planning_review", "planning_analysis"]);
    const triage = await f.runner.store.requireActiveState();
    await f.runner.answerPlanningReview({
      answer: planningTriageAnswer(triage),
      decidedBy: "owner"
    });
    const state = await f.runner.reworkPlan({
      feedback: "Revise the plan.",
      decidedBy: "owner",
      autoResume: false
    });
    state.activeAttempt = {
      id: "plan-2-abcdef12",
      kind: "plan",
      mutable: true
    };
    await f.runner.store.writeState(state);
    await f.runner.store.requireActiveState();
    const denied = runHook({
      cwd: f.repository.root,
      env: {
        BANZAI_RUN_ID: state.runId,
        BANZAI_APPROVAL_DIGEST: "",
        BANZAI_WORKFLOW_DIGEST: "",
        BANZAI_REVIEW_ARTIFACT: ""
      },
      target: `${roles.reviewDirectory}/planning-review-1.md`
    });
    assert.equal(denied.decision, "deny", denied.reason);
  } finally {
    await f.repository.dispose();
  }
});

const hookPath = path.resolve(
  process.cwd(),
  "../../plugins/banzai/hooks/spec-gate.cjs"
);

function runHook(input: {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  event?: string | undefined;
  target?: string | undefined;
  tool?: string | undefined;
  sessionId?: string;
  scratchpadDir?: unknown;
  toolInput?: Record<string, unknown> | undefined;
}): {
  decision: string | null;
  reason: string;
  context: string;
  stdout: string;
} {
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
      session_id: input.sessionId ?? `test-${process.pid}-${Math.random()}`,
      permission_mode: "default",
      tool_input: input.toolInput ?? {
        file_path: input.target ?? "src/example.ts"
      },
      ...(input.scratchpadDir === undefined
        ? {}
        : { scratchpad_dir: input.scratchpadDir })
    }),
    encoding: "utf8",
    env
  });
  assert.equal(result.status, 0, result.stderr);
  if (result.stdout.length === 0) {
    return { decision: null, reason: "", context: "", stdout: result.stdout };
  }
  const decoded = JSON.parse(result.stdout) as {
    hookSpecificOutput: {
      permissionDecision: string;
      permissionDecisionReason: string;
      additionalContext?: string;
    };
  };
  return {
    decision: decoded.hookSpecificOutput.permissionDecision,
    reason: decoded.hookSpecificOutput.permissionDecisionReason,
    context: decoded.hookSpecificOutput.additionalContext ?? "",
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

// New runs start at the current schema and a plan re-check moves a run to the
// next one (ADR-0058), so the hook must execute both; the last entry is the
// newest schema the runner writes, and a bump fails here until the hook learns it.
const NEWEST_RUN_STATE_SCHEMA = RUN_STATE_SCHEMA_VERSION + 1;
for (const stateVersion of [
  RUN_STATE_SCHEMA_VERSION,
  NEWEST_RUN_STATE_SCHEMA
] as const)
  test(`v${stateVersion} hook enforces bound phase roles, read-only selection/review and private layout`, async () => {
    const repository = await createTestRepository({
      artifactLayout: "private"
    });
    try {
      const root = await realpath(repository.root);
      const bound = await createWork({
        repoRoot: root,
        slug: "hook-bound",
        runId: `hook-v${stateVersion}`,
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
                // Schema 7 adds only the nullable completion publication cursor
                // to the retained configuration/binding combination; schema 8
                // keeps the cursor and replaces setup with task verification.
                completionPublication: null,
                verificationMode: "task",
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
        // ADR-0062 §3: the manual memory-note deferral never reaches runner mode.
        const config = path.join(path.dirname(root), "hook-claude-config");
        const memoryNote = runHook({
          cwd: root,
          target: path.join(config, "projects", "p", "memory", "note.md"),
          env: { ...env, CLAUDE_CONFIG_DIR: config }
        });
        assert.equal(memoryNote.decision, "deny", memoryNote.reason);
      }
      {
        await save("plan", "planning", {
          schemaVersion: NEWEST_RUN_STATE_SCHEMA + 1
        });
        const stale = runHook({
          cwd: root,
          target: roles.plan,
          env: { BANZAI_RUN_ID: runId, BANZAI_APPROVAL_DIGEST: "" }
        });
        assert.equal(stale.decision, "deny");
        assert.match(
          stale.reason,
          new RegExp(
            `run state schema ${NEWEST_RUN_STATE_SCHEMA + 1} is newer than this installed Banzai hook supports \\(up to ${NEWEST_RUN_STATE_SCHEMA}\\); update the Banzai plugin`
          )
        );
      }
      await save("plan", "planning", {
        artifactBinding: { ...bound, sha256: "0".repeat(64) }
      });
      expect(roles.plan, "deny");
      await save("plan", "planning");
      await writeFile(
        path.join(root, ".gitignore"),
        ".banzai/runs/\ndocumentation/work/\n"
      );
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
      for (const workflow of ["strict", "feature", "quick-fix"] as const) {
        for (const phase of [
          "selection",
          "plan",
          "implementation",
          "fix",
          "review"
        ] as const) {
          const state = evaluationStateFixture({
            workflow,
            extra: {
              schemaVersion: 10,
              completionPublication: null,
              verificationMode: "task",
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
              const check = checkArtifactPhaseScope(
                { repoRoot: root },
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

test("strict planning may record an accepted ADR in the manifest index under hook and runner", async () => {
  const repository = await createTestRepository({ artifactLayout: "private" });
  try {
    const root = await realpath(repository.root);
    const bound = await createWork({
      repoRoot: root,
      slug: "adr-index",
      mode: "workflow",
      creationId: randomUUID()
    });
    const runId = "adr-index";
    await mkdir(path.join(root, ".banzai/runs", runId), { recursive: true });
    await writeFile(
      path.join(root, ".banzai/active-run.json"),
      JSON.stringify({ schemaVersion: 1, runId })
    );
    const state = evaluationStateFixture({
      workflow: "strict",
      extra: {
        schemaVersion: 10,
        completionPublication: null,
        verificationMode: "task",
        runId,
        repoRoot: root,
        artifactBinding: bound,
        status: "planning",
        activeAttempt: { id: "plan-1", kind: "plan", mutable: true }
      }
    }) as unknown as RunState;
    await writeFile(
      path.join(root, ".banzai/runs", runId, "state.json"),
      JSON.stringify(state)
    );
    // Accepting an ADR during planning updates its public record, the decision
    // index and the manifest's active ADR index; source stays out of scope.
    for (const [target, decision] of [
      ["PROJECT_MANIFEST.md", "allow"],
      ["documentation/decisions/0001-example.md", "allow"],
      ["src/example.ts", "deny"]
    ] as const) {
      assert.equal(
        runHook({ cwd: root, target, env: { BANZAI_RUN_ID: runId } }).decision,
        decision,
        target
      );
      const before = await workspaceSnapshot(root, { artifactBinding: bound });
      const absolute = path.join(root, target);
      await mkdir(path.dirname(absolute), { recursive: true });
      await writeFile(absolute, "changed by planning\n");
      const check = checkArtifactPhaseScope(
        { repoRoot: root },
        state,
        "plan",
        before
      );
      if (decision === "allow") await assert.doesNotReject(check, target);
      else
        await assert.rejects(
          check,
          { code: "ARTIFACT_PHASE_SCOPE_INVALID" },
          target
        );
    }
  } finally {
    await repository.dispose();
  }
});

test("manual hook supports exact historical Markdown without registration and refuses control files", async () => {
  const repository = await createTestRepository();
  try {
    const root = await realpath(repository.root);
    const directory = `.banzai/work/${randomUUID()}`;
    await mkdir(path.join(root, directory), { recursive: true });
    await writeFile(
      path.join(root, directory, "work.json"),
      "historical metadata stays inert"
    );
    assert.equal(
      runHook({ cwd: root, target: `${directory}/work.md` }).decision,
      null
    );
    assert.equal(
      runHook({ cwd: root, target: `${directory}/review-2.md` }).decision,
      null
    );
    assert.equal(
      runHook({ cwd: root, target: `${directory}/work.json` }).decision,
      "deny"
    );
    assert.equal(
      runHook({ cwd: root, target: `${directory}/verification/forged.json` })
        .decision,
      "deny"
    );
  } finally {
    await repository.dispose();
  }
});

// ADR-0062: Claude Code memory notes and host bookkeeping in the manual gate.
const FIRST_CHANGE = /first code\/codebase change this session/;
const PROJECT_ALLOW =
  "banzai spec-gate: implementation phase already approved for this session.";
const BOOKKEEPING_ASK =
  "banzai spec-gate: host bookkeeping write (plan, subagent memory or session scratchpad). Approval allows writes under these host directories for this session only; it does not authorize project code changes.";
const BOOKKEEPING_CONTEXT =
  "This approval covers host bookkeeping directories only (plans, subagent memory, session scratchpad). The first project code change in this session still needs its own approval.";
const BOOKKEEPING_ALLOW =
  "banzai spec-gate: host bookkeeping writes already approved for this session.";

// Every path comes from one sandbox string, so the hook's lexical matching
// never sees two spellings of the same directory, and the real ~/.claude and
// the real marker directory stay untouched.
async function createHostSandbox() {
  const root = await mkdtemp(path.join(tmpdir(), "banzai-hook-host-"));
  const home = path.join(root, "home");
  const tmp = path.join(root, "tmp");
  const config = path.join(root, "config");
  const scratch = path.join(root, "scratch");
  const repo = path.join(root, "repo");
  for (const directory of [home, tmp, config, scratch, repo])
    await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(repo, "PROJECT_MANIFEST.md"),
    "# PROJECT_MANIFEST.md\n",
    "utf8"
  );
  const markerDirectory = path.join(tmp, "banzai-spec-gate");
  const env: NodeJS.ProcessEnv = {
    HOME: home,
    TMPDIR: tmp,
    CLAUDE_CONFIG_DIR: config,
    PLUGIN_ROOT: undefined,
    CLAUDE_PLUGIN_ROOT: undefined
  };
  return {
    home,
    tmp,
    config,
    scratch,
    repo,
    env,
    markerDirectory,
    note: (base = config) =>
      path.join(base, "projects", "-repo", "memory", "note.md"),
    plan: path.join(config, "plans", "plan.md"),
    run: (input: {
      target?: string;
      session: string;
      event?: string;
      env?: NodeJS.ProcessEnv;
      cwd?: string;
      scratchpadDir?: unknown;
      toolInput?: Record<string, unknown>;
      tool?: string;
    }) =>
      runHook({
        cwd: input.cwd ?? repo,
        target: input.target,
        event: input.event,
        tool: input.tool,
        sessionId: input.session,
        env: { ...env, ...input.env },
        scratchpadDir: "scratchpadDir" in input ? input.scratchpadDir : scratch,
        toolInput: input.toolInput
      }),
    markers: async () => {
      try {
        return (await readdir(markerDirectory)).sort();
      } catch {
        return [];
      }
    },
    dispose: () => rm(root, { recursive: true, force: true })
  };
}

function patch(...targets: string[]) {
  return {
    command: [
      "*** Begin Patch",
      ...targets.map((target) => `*** Update File: ${target}`),
      "*** End Patch"
    ].join("\n")
  };
}

test("a manual memory-note write defers and writes no marker, while a code write still does", async () => {
  const s = await createHostSandbox();
  try {
    const pre = s.run({ target: s.note(), session: "s1" });
    assert.equal(pre.decision, null, pre.reason);
    assert.equal(pre.stdout, "");
    s.run({ target: s.note(), session: "s1", event: "PostToolUse" });
    assert.deepEqual(await s.markers(), []);
    s.run({ target: "src/example.ts", session: "s1", event: "PostToolUse" });
    assert.deepEqual(await s.markers(), ["approved-s1"]);
  } finally {
    await s.dispose();
  }
});

test("only an exact memory-note path defers; near misses keep the first-change prompt", async () => {
  const s = await createHostSandbox();
  try {
    const memory = path.join(s.config, "projects", "-repo", "memory");
    const targets = [
      path.join(s.config, "settings.json"),
      path.join(memory, "..", "escape.md"),
      path.join(memory, "note.json"),
      path.join(memory, "sub", "note.md"),
      path.join(memory, ".md"),
      path.join(s.config, "projects", "-repo", "Memory", "note.md"),
      "src/example.ts"
    ];
    for (const [index, target] of targets.entries()) {
      const result = s.run({ target, session: `s2-${index}` });
      assert.equal(result.decision, "ask", target);
      assert.match(result.reason, FIRST_CHANGE, target);
    }
    // A relative CLAUDE_CONFIG_DIR defines no memory root and does not fall
    // back to $HOME/.claude.
    for (const [index, target] of [
      s.note(),
      s.note(path.join(s.home, ".claude"))
    ].entries()) {
      const result = s.run({
        target,
        session: `s2-relative-${index}`,
        env: { CLAUDE_CONFIG_DIR: "relative-config" }
      });
      assert.equal(result.decision, "ask", target);
      assert.match(result.reason, FIRST_CHANGE, target);
    }
    const other = s.run({
      target: s.note(path.join(s.home, ".claude")),
      session: "s2-home"
    });
    assert.equal(other.decision, "ask");
  } finally {
    await s.dispose();
  }
});

test("CLAUDE_CONFIG_DIR selects the memory root, with $HOME/.claude when unset or empty", async () => {
  const s = await createHostSandbox();
  try {
    const homeNote = s.note(path.join(s.home, ".claude"));
    for (const [session, target, env] of [
      ["s3-set", s.note(), {}],
      ["s3-trailing", s.note(), { CLAUDE_CONFIG_DIR: s.config + path.sep }],
      ["s3-empty", homeNote, { CLAUDE_CONFIG_DIR: "" }],
      ["s3-unset", homeNote, { CLAUDE_CONFIG_DIR: undefined }]
    ] as const) {
      const result = s.run({ target, session, env });
      assert.equal(result.decision, null, `${session}: ${result.reason}`);
    }
  } finally {
    await s.dispose();
  }
});

test("a bookkeeping approval allows only bookkeeping writes until a code write is approved", async () => {
  const s = await createHostSandbox();
  try {
    const session = "s4";
    const first = s.run({ target: s.plan, session });
    assert.equal(first.decision, "ask");
    assert.equal(first.reason, BOOKKEEPING_ASK);
    assert.equal(first.context, BOOKKEEPING_CONTEXT);
    s.run({ target: s.plan, session, event: "PostToolUse" });
    assert.deepEqual(await s.markers(), ["bookkeeping-s4"]);
    const scratch = path.join(s.scratch, "notes.txt");
    const later = s.run({ target: scratch, session });
    assert.equal(later.decision, "allow");
    assert.equal(later.reason, BOOKKEEPING_ALLOW);
    const code = s.run({ target: "src/example.ts", session });
    assert.equal(code.decision, "ask");
    assert.match(code.reason, FIRST_CHANGE);
    s.run({ target: "src/example.ts", session, event: "PostToolUse" });
    assert.deepEqual(await s.markers(), ["approved-s4", "bookkeeping-s4"]);
    for (const target of [scratch, "src/example.ts"]) {
      const result = s.run({ target, session });
      assert.equal(result.decision, "allow", target);
      assert.equal(result.reason, PROJECT_ALLOW, target);
    }
  } finally {
    await s.dispose();
  }
});

test("scratchpad and subagent-memory writes record only the bookkeeping marker", async () => {
  const s = await createHostSandbox();
  try {
    s.run({
      target: path.join(s.scratch, "notes.txt"),
      session: "s5-scratch",
      event: "PostToolUse"
    });
    assert.deepEqual(await s.markers(), ["bookkeeping-s5-scratch"]);
    s.run({
      target: path.join(s.config, "agent-memory", "reviewer", "MEMORY.md"),
      session: "s5-agent",
      event: "PostToolUse"
    });
    assert.deepEqual(await s.markers(), [
      "bookkeeping-s5-agent",
      "bookkeeping-s5-scratch"
    ]);
  } finally {
    await s.dispose();
  }
});

test("a patch with any project target is a project write", async () => {
  const s = await createHostSandbox();
  try {
    const input = {
      toolInput: patch(s.plan, "src/example.ts"),
      tool: "apply_patch"
    };
    const pre = s.run({ ...input, session: "s6" });
    assert.equal(pre.decision, "ask");
    assert.match(pre.reason, FIRST_CHANGE);
    s.run({ ...input, session: "s6", event: "PostToolUse" });
    assert.deepEqual(await s.markers(), ["approved-s6"]);
  } finally {
    await s.dispose();
  }
});

test("bookkeeping beside free paths or memory notes is a bookkeeping write", async () => {
  const s = await createHostSandbox();
  try {
    for (const [session, other] of [
      ["s6-doc", "documentation/notes.md"],
      ["s6-note", s.note()]
    ] as const) {
      const result = s.run({
        toolInput: patch(s.plan, other),
        tool: "apply_patch",
        session
      });
      assert.equal(result.decision, "ask", session);
      assert.equal(result.reason, BOOKKEEPING_ASK, session);
    }
  } finally {
    await s.dispose();
  }
});

test("bookkeeping roots fail closed to project writes when excluded or mismatched", async () => {
  const s = await createHostSandbox();
  try {
    const scratchFile = path.join(s.scratch, "notes.txt");
    const nestedRepo = path.join(s.scratch, "repo");
    await mkdir(nestedRepo, { recursive: true });
    await writeFile(path.join(nestedRepo, "PROJECT_MANIFEST.md"), "# M\n");
    const nestedTmp = path.join(s.scratch, "tmp");
    const plugin = path.join(s.scratch, "plugin");
    const cases: {
      name: string;
      target: string;
      env?: NodeJS.ProcessEnv;
      cwd?: string;
      scratchpadDir?: unknown;
    }[] = [
      {
        name: "marker directory below the scratchpad",
        target: path.join(nestedTmp, "banzai-spec-gate", "approved-x"),
        env: { TMPDIR: nestedTmp }
      },
      {
        name: "scratchpad that holds the marker directory",
        target: scratchFile,
        env: { TMPDIR: nestedTmp }
      },
      {
        name: "plugin root below the scratchpad",
        target: path.join(plugin, "hooks", "spec-gate.cjs"),
        env: { CLAUDE_PLUGIN_ROOT: plugin }
      },
      {
        name: "marker segment in any case",
        target: path.join(s.scratch, "x", "Banzai-Spec-Gate", "approved-x")
      },
      {
        name: "cwd below the scratchpad",
        target: scratchFile,
        cwd: nestedRepo
      },
      {
        name: "no scratchpad_dir",
        target: scratchFile,
        scratchpadDir: undefined
      },
      {
        name: "relative scratchpad_dir",
        target: scratchFile,
        scratchpadDir: "scratch"
      },
      {
        name: "non-string scratchpad_dir",
        target: scratchFile,
        scratchpadDir: 42
      },
      { name: "settings.json", target: path.join(s.config, "settings.json") },
      ...(process.platform === "win32"
        ? []
        : [
            {
              name: "case variant of the plans root",
              target: path.join(s.config, "Plans", "plan.md")
            }
          ])
    ];
    for (const [index, item] of cases.entries()) {
      const result = s.run({ ...item, session: `s7-${index}` });
      assert.equal(result.decision, "ask", item.name);
      assert.match(result.reason, FIRST_CHANGE, item.name);
    }
  } finally {
    await s.dispose();
  }
});

test("an existing project marker still allows bookkeeping writes", async () => {
  const s = await createHostSandbox();
  try {
    await mkdir(s.markerDirectory, { recursive: true });
    await writeFile(path.join(s.markerDirectory, "approved-s8"), "1");
    const result = s.run({ target: s.plan, session: "s8" });
    assert.equal(result.decision, "allow");
    assert.equal(result.reason, PROJECT_ALLOW);
  } finally {
    await s.dispose();
  }
});

test("a bookkeeping marker alone never allows a project write", async () => {
  const s = await createHostSandbox();
  try {
    await mkdir(s.markerDirectory, { recursive: true });
    await writeFile(path.join(s.markerDirectory, "bookkeeping-s9"), "1");
    for (const target of [
      path.join(s.config, "settings.json"),
      "src/example.ts"
    ]) {
      const result = s.run({ target, session: "s9" });
      assert.equal(result.decision, "ask", target);
      assert.match(result.reason, FIRST_CHANGE, target);
    }
  } finally {
    await s.dispose();
  }
});

test("a memory note beside a non-historical .banzai/work target is still denied", async () => {
  const s = await createHostSandbox();
  const repository = await createTestRepository();
  try {
    const result = runHook({
      cwd: await realpath(repository.root),
      tool: "apply_patch",
      toolInput: patch(s.note(), `.banzai/work/${randomUUID()}/state.json`),
      env: s.env
    });
    assert.equal(result.decision, "deny", result.reason);
  } finally {
    await repository.dispose();
    await s.dispose();
  }
});
