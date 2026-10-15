import { createTestWork as createWork } from "./helpers.js";
import { WorkflowRunner } from "../src/workflow.js";
import { createTestRepository } from "./helpers.js";
import type {
  VendorAdapters,
  PhaseResult,
  RunState,
  OrchestratorConfig
} from "../src/types.js";
import { randomUUID } from "node:crypto";
import { runProcess, subscriptionOnlyEnvironment } from "../src/process.js";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  realpath,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  executeTaskVerification,
  readTaskVerificationAttempts,
  captureTaskVerificationInputs,
  taskVerificationApplicability,
  authorizeTaskVerification,
  comparableTaskVerificationSources,
  discoverTaskVerification,
  evidenceDigest,
  taskVerificationDigestRole,
  TASK_VERIFICATION_SOURCE_MAX_BYTES,
  parseTaskVerificationCandidates,
  parseTaskVerificationDescriptor,
  parseTaskVerificationObligations,
  parseTaskVerificationPolicy,
  parseVerificationObligations,
  selectTaskVerification
} from "../src/verification-evidence.js";
import type {
  TaskVerificationAuthority,
  TaskVerificationContext,
  TaskVerificationDescriptor,
  TaskVerificationPolicy
} from "../src/verification-evidence.js";

const check: TaskVerificationDescriptor = {
  id: "lint",
  name: "Lint changed project",
  requirementRefs: ["FR1"],
  command: "npm",
  args: ["run", "lint"],
  cwd: ".",
  timeoutMs: 1000,
  evidence: "fresh",
  sources: [],
  materialization: null
};
const context: TaskVerificationContext = {
  kind: "inherited-local",
  invocationDigest: evidenceDigest("authorized local invocation"),
  restrictions: []
};
const authority: TaskVerificationAuthority = {
  workId: "work-1",
  sourceAttemptId: "implementation-1",
  workflow: "feature",
  taskDigest: evidenceDigest("Add lint"),
  selectionDigest: evidenceDigest("feature selection"),
  approvalDigest: null,
  contextDigest: evidenceDigest(context)
};
const policy: TaskVerificationPolicy = {
  schema: "banzai-task-verification-policy/v1",
  schemaVersion: 1,
  required: [],
  denied: [],
  limits: {
    timeoutMs: 1000,
    workingDirectories: ["."],
    requiredContext: "inherited-local"
  },
  reuse: null
};

function planFor(checks: TaskVerificationDescriptor[]) {
  const before = "# Plan\n\nRun fresh verification.\n\n";
  const after = "\n\n## Completion\nFulfil FR1.\n";
  return (
    before +
    "```banzai-verification-obligations/v2\n" +
    JSON.stringify({
      schema: "banzai-verification-obligations/v2",
      schemaVersion: 2,
      complete: true,
      planRemainderSha256: evidenceDigest(before + after),
      checks,
      absenceReason: checks.length
        ? null
        : "Documentation inspection is sufficient for this task."
    }) +
    "\n```" +
    after
  );
}

test("task contracts reject malformed, duplicate and authority-bearing proposals", () => {
  assert.deepEqual(parseTaskVerificationDescriptor(check), check);
  assert.throws(() =>
    parseTaskVerificationDescriptor({
      ...check,
      args: ["--api-key", "private-canary"]
    })
  );
  assert.throws(() =>
    parseTaskVerificationDescriptor({
      ...check,
      args: ["Bearer private-canary"]
    })
  );
  assert.throws(() =>
    parseTaskVerificationDescriptor({ ...check, env: { TOKEN: "unsafe" } })
  );
  assert.throws(() =>
    parseTaskVerificationDescriptor({ ...check, cwd: "../outside" })
  );
  assert.throws(() =>
    parseTaskVerificationDescriptor({ ...check, timeoutMs: Infinity })
  );
  assert.throws(() =>
    parseTaskVerificationDescriptor({ ...check, requirementRefs: [] })
  );
  assert.throws(() =>
    parseTaskVerificationDescriptor({ ...check, command: "npm run lint" })
  );
  assert.throws(() =>
    parseTaskVerificationCandidates({ checks: [], absenceReason: null })
  );
  assert.throws(() =>
    parseTaskVerificationCandidates({
      checks: [check, check],
      absenceReason: null
    })
  );
  assert.deepEqual(
    parseTaskVerificationCandidates({
      checks: [],
      absenceReason: "Manual inspection of prose."
    }),
    { checks: [], absenceReason: "Manual inspection of prose." }
  );
  assert.deepEqual(parseTaskVerificationPolicy(policy), policy);
  assert.throws(() =>
    parseTaskVerificationPolicy({ ...policy, schemaVersion: 2 })
  );
});

test("approved v2 inventory binds exact surrounding plan and future tooling without profiles", () => {
  const future = {
    ...check,
    materialization: { taskRef: "T001", paths: ["eslint.config.js"] }
  };
  const plan = planFor([future]);
  assert.deepEqual(parseTaskVerificationObligations(plan).checks, [future]);
  assert.equal(parseVerificationObligations(plan, { profiles: [] }), null);
  assert.throws(() =>
    parseTaskVerificationObligations(plan.replace("Fulfil FR1.", "Skip FR1."))
  );
  assert.throws(() => parseTaskVerificationObligations(plan + plan));
  assert.throws(() =>
    parseTaskVerificationObligations(
      plan.replace('"schemaVersion":2', '"schemaVersion":1')
    )
  );
  assert.throws(() =>
    parseTaskVerificationObligations(
      planFor([{ ...check, evidence: "equivalent_evidence" }])
    )
  );
});

test("supplements cannot weaken mandatory checks or conflict with project requirements", () => {
  const extra = {
    ...check,
    id: "unit-tests",
    command: "node",
    args: ["--test"]
  };
  const selected = selectTaskVerification({
    required: [check],
    candidates: { checks: [extra], absenceReason: null }
  });
  assert.deepEqual(
    selected.checks.map((item) => [item.descriptor.id, item.required]),
    [
      ["lint", true],
      ["unit-tests", false]
    ]
  );
  assert.throws(() =>
    selectTaskVerification({
      required: [check],
      candidates: { checks: [{ ...check, args: [] }], absenceReason: null }
    })
  );
  assert.throws(() =>
    selectTaskVerification({
      required: [check],
      candidates: null,
      policy: { ...policy, required: [{ ...check, timeoutMs: 1 }] }
    })
  );
});

test("restating a materialized obligation with captured sources keeps the approved descriptor", () => {
  const planned = {
    ...check,
    materialization: { taskRef: "T001", paths: ["package.json"] }
  };
  const restated = {
    ...planned,
    sources: [{ path: "package.json", sha256: evidenceDigest("{}") }]
  };
  const selected = selectTaskVerification({
    required: [planned],
    candidates: { checks: [restated], absenceReason: null }
  });
  assert.deepEqual(
    selected.checks.map((item) => [item.descriptor, item.required]),
    [[planned, true]]
  );
  assert.throws(
    () =>
      selectTaskVerification({
        required: [planned],
        candidates: {
          checks: [{ ...restated, evidence: "equivalent_evidence" }],
          absenceReason: null
        }
      }),
    /A proposal cannot change an existing verification obligation/
  );
});

test("one digest-role rule classifies the plan remainder, supplemental sources and approved obligations", () => {
  assert.equal(taskVerificationDigestRole("plan-remainder"), "binding");
  assert.equal(
    taskVerificationDigestRole("descriptor-source", false),
    "precondition"
  );
  assert.equal(
    taskVerificationDigestRole("descriptor-source", true),
    "descriptive"
  );
  assert.throws(() => taskVerificationDigestRole("other" as never));
  const sourced = {
    ...check,
    sources: [{ path: "package.json", sha256: evidenceDigest("{}") }]
  };
  // The acceptance comparison and the launch comparison read the same rule.
  assert.deepEqual(comparableTaskVerificationSources(sourced), sourced.sources);
  assert.deepEqual(comparableTaskVerificationSources(sourced, true), []);
  assert.deepEqual(comparableTaskVerificationSources(check), []);
});

test("a rejected plan remainder names the field and both digests without quoting the plan", () => {
  const plan = planFor([check]).replace(
    /"planRemainderSha256":"[a-f0-9]{64}"/u,
    `"planRemainderSha256":"${"a".repeat(64)}"`
  );
  assert.throws(
    () => parseTaskVerificationObligations(plan),
    (error: unknown) => {
      const digest = error as { code?: string; detail?: { role?: string } };
      assert.equal(digest.code, "TASK_VERIFICATION_DIGEST_MISMATCH");
      assert.equal(digest.detail?.role, "binding");
      assert.match(
        (error as Error).message,
        /planRemainderSha256 does not match the plan bytes outside its inventory: declared [a-f0-9]{64}, observed [a-f0-9]{64}/
      );
      assert.doesNotMatch((error as Error).message, /Run fresh verification/);
      return true;
    }
  );
});

test("an approved obligation executes after its sources changed and after anticipated tooling exists", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "banzai-task-materialize-"));
  try {
    const planned = {
      ...check,
      sources: [{ path: "package.json", sha256: evidenceDigest("{}") }],
      materialization: { taskRef: "T001", paths: ["scripts/check.mjs"] }
    };
    await writeFile(path.join(root, "package.json"), '{"scripts":{}}');
    await mkdir(path.join(root, "scripts"));
    await writeFile(path.join(root, "scripts/check.mjs"), "export {};\n");
    assert.equal(
      (
        await authorizeTaskVerification({
          repoRoot: root,
          descriptor: planned,
          authority,
          context,
          required: true
        })
      ).descriptor.id,
      planned.id
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a source above the permitted size is a separate cause from a digest mismatch", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "banzai-task-oversize-"));
  try {
    const bytes = Buffer.alloc(TASK_VERIFICATION_SOURCE_MAX_BYTES + 1, 97);
    await writeFile(path.join(root, "large.txt"), bytes);
    await assert.rejects(
      authorizeTaskVerification({
        repoRoot: root,
        descriptor: {
          ...check,
          sources: [{ path: "large.txt", sha256: evidenceDigest(bytes) }]
        },
        authority,
        context
      }),
      (error: unknown) => {
        assert.equal(
          (error as { code?: string }).code,
          "TASK_VERIFICATION_SOURCE_TOO_LARGE"
        );
        assert.match(
          (error as Error).message,
          /large\.txt is 1048577 bytes, above the 1048576-byte limit/
        );
        return true;
      }
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("execution validation checks actual context, source drift, policy and safe cwd ancestry", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "banzai-task-verification-"));
  try {
    await mkdir(path.join(root, "app"));
    await writeFile(path.join(root, "package.json"), "{}");
    const sourced = {
      ...check,
      cwd: "app",
      sources: [{ path: "package.json", sha256: evidenceDigest("{}") }]
    };
    assert.equal(
      (
        await authorizeTaskVerification({
          repoRoot: root,
          descriptor: sourced,
          authority,
          context
        })
      ).cwd,
      await realpath(path.join(root, "app"))
    );
    await assert.rejects(
      authorizeTaskVerification({
        repoRoot: root,
        descriptor: sourced,
        authority,
        context,
        policy: {
          ...policy,
          limits: {
            ...policy.limits,
            requiredContext: "network-disabled-sandbox"
          }
        }
      }),
      /context is unavailable/
    );
    await assert.rejects(
      authorizeTaskVerification({
        repoRoot: root,
        descriptor: sourced,
        authority,
        context,
        policy: {
          ...policy,
          denied: [{ command: "npm", args: null, cwd: null }]
        }
      }),
      /prohibited/
    );
    await assert.rejects(
      authorizeTaskVerification({
        repoRoot: root,
        descriptor: sourced,
        authority: { ...authority, contextDigest: evidenceDigest("different") },
        context
      }),
      /authorized context/
    );
    await writeFile(
      path.join(root, "package.json"),
      '{"scripts":{"lint":"changed"}}'
    );
    await assert.rejects(
      authorizeTaskVerification({
        repoRoot: root,
        descriptor: sourced,
        authority,
        context
      }),
      /does not match the identity recorded for check lint: declared [a-f0-9]{64}, observed [a-f0-9]{64}/
    );
    // Approved implementation may keep editing scripts after planning pinned them.
    assert.equal(
      (
        await authorizeTaskVerification({
          repoRoot: root,
          descriptor: sourced,
          authority,
          context,
          required: true
        })
      ).descriptor.id,
      sourced.id
    );
    await symlink(root, path.join(root, "alias"));
    await assert.rejects(
      authorizeTaskVerification({
        repoRoot: root,
        descriptor: { ...check, cwd: "alias" },
        authority,
        context
      }),
      /symlink/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("discovery reads root and selected nested scripts inertly and distinguishes placeholder, malformed and absent", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "banzai-task-discovery-"));
  try {
    await mkdir(path.join(root, "app"));
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({
        scripts: {
          test: 'echo "Error: no test specified" && exit 1',
          custom: "touch never-executed"
        }
      })
    );
    await writeFile(
      path.join(root, "app/package.json"),
      JSON.stringify({
        packageManager: "pnpm@9",
        scripts: { "check:ui": "node check.mjs" }
      })
    );
    await writeFile(path.join(root, "composer.json"), "broken");
    const result = await discoverTaskVerification(root, [".", "app"]);
    assert.equal(
      result.suggestions.find((item) => item.script === "test")?.placeholder,
      true
    );
    assert.equal(
      result.suggestions.find((item) => item.script === "check:ui")?.command,
      "pnpm"
    );
    assert.equal(
      result.sources.find((item) => item.path === "composer.json")?.status,
      "unavailable"
    );
    assert.equal(
      result.sources.find((item) => item.path === "Makefile")?.status,
      "absent"
    );
    const sentinel = await discoverTaskVerification(
      root,
      [],
      ["never-executed"]
    );
    assert.equal(sentinel.sources[0]?.status, "absent");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("real executor publishes private descriptor references and refuses denied launches", async () => {
  const { root } = await createTestRepository({ artifactLayout: null });
  const workId = randomUUID();
  const storage = {
    repoRoot: root,
    directory: `.banzai/work/${workId}/verification`,
    workId
  };
  const script =
    "console.log(JSON.stringify({cwd:process.cwd(),args:process.argv.slice(2)}))";
  await writeFile(path.join(root, "check.cjs"), script);
  let launches = 0;
  const descriptor = {
    ...check,
    command: "node",
    args: ["check.cjs", "literal $HOME; touch sentinel"],
    sources: [{ path: "check.cjs", sha256: evidenceDigest(script) }]
  };
  const invoke = async (command: TaskVerificationDescriptor, cwd: string) => {
    launches++;
    const result = await runProcess({
      command: command.command,
      args: command.args,
      cwd,
      timeoutMs: command.timeoutMs,
      env: subscriptionOnlyEnvironment()
    });
    return {
      ...result,
      status:
        result.exitCode === 0 ? ("completed" as const) : ("failed" as const),
      failureCategory: result.exitCode === 0 ? null : ("command_exit" as const)
    };
  };
  const input = {
    ...storage,
    selection: {
      checks: [{ descriptor, required: true }],
      absenceReason: null
    },
    authority: { ...authority, workId },
    context,
    policy: null,
    roundId: randomUUID(),
    revalidate: async () => {},
    invoke
  };
  try {
    await assert.rejects(
      executeTaskVerification({
        ...input,
        policy: {
          ...policy,
          denied: [{ command: "node", args: null, cwd: null }]
        }
      }),
      /prohibited/
    );
    assert.equal(launches, 0);
    await assert.rejects(
      executeTaskVerification({
        ...input,
        policy: {
          ...policy,
          limits: { ...policy.limits, requiredContext: "isolated" }
        }
      }),
      /context is unavailable/
    );
    assert.equal(launches, 0);
    const result = await executeTaskVerification(input);
    assert.equal(launches, 1);
    assert.equal(result.applicability.complete, true);
    assert.equal(result.applicability.dispositions[0]?.kind, "passed");
    const attempt = result.attempts[0];
    assert.ok(attempt?.stdout);
    assert.equal(Object.hasOwn(attempt, "command"), false);
    assert.equal(Object.hasOwn(attempt, "args"), false);
    assert.deepEqual(
      JSON.parse(
        await readFile(path.join(root, attempt.stdout.relativePath), "utf8")
      ),
      { cwd: await realpath(root), args: ["literal $HOME; touch sentinel"] }
    );
    await executeTaskVerification(input);
    assert.equal(launches, 1);
    await writeFile(path.join(root, attempt.stdout.relativePath), "tampered");
    const applied = await taskVerificationApplicability(
      storage,
      result.decision,
      await readTaskVerificationAttempts(storage),
      await captureTaskVerificationInputs(storage, [descriptor], null)
    );
    assert.equal(applied.complete, false);
    assert.equal(applied.dispositions[0]?.kind, "unavailable");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a check writing non-ignored output names the paths; ignored output passes", async () => {
  const { root } = await createTestRepository({ artifactLayout: null });
  const workId = randomUUID();
  const storage = {
    repoRoot: root,
    directory: `.banzai/work/${workId}/verification`,
    workId
  };
  const descriptor = {
    ...check,
    id: "build",
    command: "node",
    args: [
      "-e",
      "require('fs').mkdirSync('build',{recursive:true});require('fs').writeFileSync('build/out.js','built')"
    ],
    timeoutMs: 10000
  };
  const invoke = async (command: TaskVerificationDescriptor, cwd: string) => {
    const result = await runProcess({
      command: command.command,
      args: command.args,
      cwd,
      timeoutMs: command.timeoutMs,
      env: subscriptionOnlyEnvironment()
    });
    return {
      ...result,
      status:
        result.exitCode === 0 ? ("completed" as const) : ("failed" as const),
      failureCategory: result.exitCode === 0 ? null : ("command_exit" as const)
    };
  };
  const round = () => ({
    ...storage,
    selection: {
      checks: [{ descriptor, required: true }],
      absenceReason: null
    },
    authority: { ...authority, workId },
    context,
    policy: null,
    roundId: randomUUID(),
    revalidate: async () => {},
    invoke
  });
  try {
    await runProcess({
      command: "git",
      args: ["init", "-q"],
      cwd: root,
      timeoutMs: 30000,
      env: subscriptionOnlyEnvironment()
    });
    await writeFile(path.join(root, "index.js"), "source");
    await assert.rejects(
      executeTaskVerification(round()),
      /Check "build" changed observed project files: "build\/out\.js" \(added\)\. Keep generated output Git-ignored/
    );
    await writeFile(path.join(root, ".gitignore"), ".banzai/work/\nbuild/\n");
    const passed = await executeTaskVerification(round());
    assert.equal(passed.applicability.dispositions[0]?.kind, "passed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

for (const lintFails of [false, true])
  test(`new lite task ignores stale profiles and verifies real ESLint (failure=${lintFails})`, async () => {
    const repository = await createTestRepository({
      artifactLayout: "private"
    });
    const root = repository.root;
    const configPath = path.join(root, ".banzai/config.json");
    const config = JSON.parse(
      await readFile(configPath, "utf8")
    ) as OrchestratorConfig;
    const profile = config.verification.profiles[0];
    assert.ok(profile);
    profile.commands = [
      {
        name: "nonexistent typecheck",
        command: "never-authorized-typecheck",
        args: [],
        timeoutMs: 1000
      }
    ];
    const configBytes = JSON.stringify(config, null, 2) + "\n";
    await writeFile(configPath, configBytes);
    let phases = 0;
    const wrap = <T>(result: T) => ({
      result,
      sessionId: null,
      stdout: "",
      stderr: "",
      usage: null
    });
    const adapters: VendorAdapters = {
      runPlanningReview: async () => {
        throw new Error("Unexpected planning review");
      },
      runPlanningAnalysis: async () => {
        throw new Error("Unexpected planning analysis");
      },
      preflightCodex: async () => {},
      preflightClaude: async () => {},
      runSelection: async () =>
        wrap({
          contractVersion: "1.0.0",
          recommendedWorkflow: "feature",
          confidence: "high",
          reason: "Add local behavior and verify it.",
          escalationTriggers: []
        }),
      runPhase: async (request) => {
        phases++;
        assert.equal(request.outputContract.identity, "phase-result/v4");
        const state = JSON.parse(
          await readFile(path.join(request.runDirectory, "state.json"), "utf8")
        ) as RunState;
        const work = state.artifactBinding?.binding.artifacts.work;
        assert.ok(work);
        await mkdir(path.dirname(path.join(root, work)), { recursive: true });
        await writeFile(
          path.join(root, work),
          "# Work\n\nA real test checks the requested output.\n"
        );
        await writeFile(
          path.join(root, "actual.js"),
          lintFails ? "missingName();\n" : "const value = 4; void value;\n"
        );
        await writeFile(
          path.join(root, "eslint.config.mjs"),
          "export default [{files:['**/*.js'],rules:{'no-undef':'error'}}];\n"
        );
        await writeFile(
          path.join(root, "package.json"),
          JSON.stringify({
            scripts: {
              lint: "eslint .",
              test: 'echo "Error: no test specified" && exit 1'
            }
          })
        );
        const result: PhaseResult = {
          schemaVersion: 4,
          contractVersion: "1.0.0",
          phase: "implementation",
          outcome: "completed",
          gate: null,
          summary: "Added the example.",
          artifacts: {
            description: null,
            plan: null,
            adrs: [],
            implementationReport: work,
            testReport: null
          },
          taskCompletion: null,
          touchedPaths: ["actual.js", "eslint.config.mjs", "package.json"],
          questions: [],
          decisionConsultation: null,
          resolvedFindingIds: [],
          requestedVerification: [],
          verificationCandidates: {
            checks: [
              {
                ...check,
                id: "lint",
                command: process.execPath,
                args: [
                  path.resolve("../../node_modules/eslint/bin/eslint.js"),
                  "."
                ],
                timeoutMs: 5000
              }
            ],
            absenceReason: null
          }
        };
        await request.onTerminalSuccess?.({
          classification: "codex_turn_completed",
          observedAt: new Date().toISOString(),
          result,
          sessionId: null,
          usage: null
        });
        return wrap(result);
      },
      runReview: async () => {
        throw new Error("Lite must not request an independent reviewer.");
      }
    };
    try {
      const state = await new WorkflowRunner(root, adapters).start({
        slug: "task-check",
        request: "Add ESLint and check the project."
      });
      assert.equal(
        state.status,
        lintFails ? "blocked" : "done",
        state.blockReason ?? undefined
      );
      assert.equal(state.schemaVersion, 10);
      assert.equal(state.verificationMode, "task");
      assert.equal(Object.hasOwn(state, "configurationSetup"), false);
      assert.equal(phases, 1);
      assert.equal(state.taskVerification?.applicability.complete, !lintFails);
      assert.equal(
        state.taskVerification.attempts[0]?.status,
        lintFails ? "failed" : "completed"
      );
      assert.equal(state.taskVerification.attempts.length, 1);
      assert.equal(await readFile(configPath, "utf8"), configBytes);
    } finally {
      await repository.dispose();
    }
  });

test("failed task checks require exact retry and do not reuse older success", async () => {
  const { root } = await createTestRepository({ artifactLayout: null });
  const workId = randomUUID();
  const roundId = randomUUID();
  const storage = {
    repoRoot: root,
    directory: `.banzai/work/${workId}/verification`,
    workId
  };
  const native = { ...check, command: "node", args: ["check.cjs"] };
  await mkdir(path.join(root, ".banzai"), { recursive: true });
  await writeFile(
    path.join(root, "check.cjs"),
    "process.exit(require('node:fs').existsSync('.banzai/ready') ? 0 : 7)"
  );
  const input = {
    ...storage,
    roundId,
    selection: selectTaskVerification({ required: [native], candidates: null }),
    authority: { ...authority, workId },
    context,
    policy: null,
    revalidate: async () => {},
    invoke: async (descriptor: TaskVerificationDescriptor, cwd: string) => {
      const result = await runProcess({
        command: descriptor.command,
        args: descriptor.args,
        cwd,
        env: subscriptionOnlyEnvironment(),
        timeoutMs: descriptor.timeoutMs
      });
      return {
        status:
          result.exitCode === 0 ? ("completed" as const) : ("failed" as const),
        stdout: result.stdout,
        stderr: result.stderr,
        completedAt: new Date().toISOString(),
        exitCode: result.exitCode,
        signal: result.signal,
        failureCategory:
          result.exitCode === 0 ? null : ("command_exit" as const)
      };
    }
  };
  try {
    const failed = await executeTaskVerification(input);
    assert.equal(failed.applicability.dispositions[0]?.kind, "failed");
    await assert.rejects(
      executeTaskVerification({ ...input, retryOf: "wrong-id" })
    );
    await writeFile(path.join(root, ".banzai/ready"), "ready");
    const failedAttempt = failed.attempts[0];
    assert.ok(failedAttempt);
    const passed = await executeTaskVerification({
      ...input,
      retryOf: failedAttempt.id
    });
    assert.equal(passed.applicability.complete, true);
    assert.equal(passed.attempts.length, 2);
    assert.equal(passed.attempts[1]?.retryOf, failed.attempts[0]?.id);
    assert.equal(passed.attempts[0]?.exitCode, 7);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("standalone task helper executes bound descriptors without profile setup and inspect is read-only", async () => {
  const repository = await createTestRepository({ artifactLayout: "private" });
  const temp = await mkdtemp(path.join(tmpdir(), "banzai-task-helper-"));
  try {
    const work = await createWork({
      repoRoot: repository.root,
      slug: "helper-task",
      mode: "lite",
      creationId: randomUUID()
    });

    const document = work.binding.artifacts.work;
    assert.ok(document);
    await writeFile(
      path.join(repository.root, "helper-check.cjs"),
      "require('node:assert/strict').equal(require('node:fs').readFileSync('result.txt','utf8'),'requested result')"
    );
    await writeFile(
      path.join(repository.root, "result.txt"),
      "requested result"
    );
    await writeFile(
      path.join(repository.root, document),
      planFor([{ ...check, command: "node", args: ["helper-check.cjs"] }])
    );
    const request = {
      schema: "banzai-verification-request/v3",
      schemaVersion: 3,
      repoRoot: repository.root,
      documentPath: document,
      workflow: "feature",
      roundId: randomUUID()
    };
    const requestPath = path.join(temp, "request.json");
    await writeFile(requestPath, JSON.stringify(request), { mode: 0o600 });
    const invoke = async (operation: string) => {
      const result = await runProcess({
        command: process.execPath,
        args: [
          path.resolve("../../plugins/banzai/scripts/verification.cjs"),
          operation,
          "--json",
          requestPath
        ],
        cwd: repository.root,
        env: subscriptionOnlyEnvironment(),
        timeoutMs: 10000
      });
      assert.equal(result.exitCode, 0, result.stdout + result.stderr);
      return JSON.parse(result.stdout) as {
        schemaVersion: number;
        result: {
          authorityKind: string;
          applicability: { complete: boolean };
          physicalAttempts: number;
        };
      };
    };
    const configPath = path.join(repository.root, ".banzai/config.json");
    const originalConfig = await readFile(configPath);
    await writeFile(
      configPath,
      JSON.stringify({ schemaVersion: 4, verification: { policy: null } })
    );
    await assert.rejects(invoke("execute"), /VERIFICATION_POLICY_INVALID/);
    await writeFile(configPath, originalConfig);
    const inspected = await invoke("inspect");
    assert.equal(inspected.schemaVersion, 2);
    assert.equal(inspected.result.physicalAttempts, 0);
    assert.equal(inspected.result.applicability, null);
    const executed = await invoke("execute");
    assert.equal(executed.result.authorityKind, "standalone-skill");
    assert.equal(executed.result.applicability.complete, true);
    assert.equal(executed.result.physicalAttempts, 1);
    assert.equal((await invoke("inspect")).result.physicalAttempts, 1);
  } finally {
    await repository.dispose();
    await rm(temp, { recursive: true, force: true });
  }
});

test("interrupted task execution requires owner recovery and preserves physical uncertainty", async () => {
  const { root } = await createTestRepository({ artifactLayout: null });
  const workId = randomUUID();
  const storage = {
    repoRoot: root,
    workId,
    directory: `.banzai/work/${workId}/verification`
  };
  let calls = 0;
  const input = {
    ...storage,
    roundId: randomUUID(),
    selection: selectTaskVerification({
      required: [
        { ...check, command: process.execPath, args: ["-e", "process.exit(0)"] }
      ],
      candidates: null
    }),
    authority: { ...authority, workId },
    context,
    policy: null,
    revalidate: async () => {},
    invoke: async (descriptor: TaskVerificationDescriptor, cwd: string) => {
      calls++;
      const result = await runProcess({
        command: descriptor.command,
        args: descriptor.args,
        cwd,
        timeoutMs: descriptor.timeoutMs,
        env: subscriptionOnlyEnvironment()
      });
      if (calls === 1)
        throw new Error("simulated owner exit before result publication");
      return { ...result, status: "completed" as const, failureCategory: null };
    }
  };
  try {
    await assert.rejects(
      executeTaskVerification(input),
      /simulated owner exit/
    );
    const [start] = await readTaskVerificationAttempts(storage);
    assert.ok(start);
    assert.equal(start.status, "started");
    await assert.rejects(executeTaskVerification(input), /unresolved attempt/);
    assert.equal(calls, 1);
    await assert.rejects(
      executeTaskVerification({ ...input, roundId: randomUUID() }),
      /owner recovery/
    );
    assert.equal(calls, 1);
    const result = await executeTaskVerification({
      ...input,
      recoverInterrupted: true
    });
    assert.equal(calls, 2);
    assert.equal(result.applicability.complete, true);
    assert.equal(result.attempts[0]?.status, "interrupted");
    assert.equal(result.attempts[0].exitCode, null);
    assert.equal(result.attempts[0].durationMs, null);
    assert.equal(result.attempts[1]?.retryOf, start.id);
    const final = result.attempts[1];
    assert.ok(final);
    await rm(
      path.join(root, storage.directory, "origins", `${final.id}.finish.json`)
    );
    await assert.rejects(readTaskVerificationAttempts(storage));
    const repaired = await executeTaskVerification({
      ...input,
      recoverInterrupted: true
    });
    assert.equal(
      calls,
      2,
      "a retained terminal success repairs only its missing origin"
    );
    assert.deepEqual(repaired.attempts, result.attempts);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("equivalent evidence reuses only declared explanatory changes and reruns for code or policy changes", async () => {
  const repository = await createTestRepository({ artifactLayout: "private" });
  const root = repository.root;
  const workId = randomUUID();
  const executable = await realpath("/bin/echo");
  let launches = 0;
  const descriptor = {
    ...check,
    command: executable,
    args: ["checked"],
    evidence: "equivalent_evidence" as const
  };
  const reusePolicy: TaskVerificationPolicy = {
    ...policy,
    reuse: {
      schema: "banzai-verification-policy/v1",
      schemaVersion: 1,
      explanatory: [{ path: "notes.md", regions: [] }],
      dependencies: {
        complete: true,
        exclude: [],
        toolchain: [executable],
        environment: {},
        volatile: []
      }
    }
  };
  const input = {
    repoRoot: root,
    workId,
    directory: `.banzai/work/${workId}/verification`,
    selection: selectTaskVerification({
      required: [descriptor],
      candidates: null
    }),
    authority: { ...authority, workId },
    context,
    policy: reusePolicy,
    revalidate: async () => {},
    invoke: async (command: TaskVerificationDescriptor, cwd: string) => {
      launches++;
      const result = await runProcess({
        command: command.command,
        args: command.args,
        cwd,
        timeoutMs: command.timeoutMs,
        env: subscriptionOnlyEnvironment()
      });
      return { ...result, status: "completed" as const, failureCategory: null };
    }
  };
  try {
    await writeFile(path.join(root, "notes.md"), "First explanation.\n");
    const first = await executeTaskVerification({
      ...input,
      roundId: randomUUID()
    });
    assert.equal(first.decision.before.complete, true);
    assert.equal(first.applicability.complete, true);
    await writeFile(path.join(root, "notes.md"), "Revised explanation.\n");
    const reused = await executeTaskVerification({
      ...input,
      roundId: randomUUID(),
      authority: { ...input.authority, sourceAttemptId: "fix-2" }
    });
    assert.equal(reused.applicability.dispositions[0]?.kind, "reused");
    assert.equal(launches, 1);
    await writeFile(path.join(root, "source.cjs"), "module.exports = 2;\n");
    const fresh = await executeTaskVerification({
      ...input,
      roundId: randomUUID()
    });
    assert.equal(fresh.applicability.dispositions[0]?.kind, "passed");
    assert.equal(launches, 2);
    await executeTaskVerification({
      ...input,
      policy: {
        ...reusePolicy,
        limits: { ...reusePolicy.limits, timeoutMs: 2000 }
      },
      roundId: randomUUID()
    });
    assert.equal(launches, 3);
  } finally {
    await repository.dispose();
  }
});
