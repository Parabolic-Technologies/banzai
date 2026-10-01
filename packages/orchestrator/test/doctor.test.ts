import { instructionPluginFixture } from "./phase-instruction-fixtures.js";
import assert from "node:assert/strict";
import {
  chmod,
  mkdir,
  mkdtemp,
  readlink,
  readFile,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { ClaudePermissionAudit } from "../src/claude-permissions.js";
import { CONFIG_FILE } from "../src/config.js";
import { renderDoctorJson, renderDoctorText } from "../src/doctor-cli.js";
import {
  inspectDoctor,
  type DoctorDependencies,
  type DoctorReport
} from "../src/doctor.js";
import type {
  OrchestratorConfig,
  VerificationProjectType
} from "../src/types.js";
import { reviewerOnlyClaudeConfig, snapshotTree } from "./helpers.js";
import { writeAdoptedGuidance } from "./adoption-fixtures.js";
import { ADOPTED_AGENTS } from "./adoption-fixtures.js";

const CHECK_ORDER = [
  "repository.git",
  "project.guidance",
  "runtime.node",
  "runtime.platform",
  "contract.parity",
  "config.present",
  "config.valid",
  "config.version",
  "claude.environment",
  "claude.instructions",
  "claude.permissions",
  "project.types",
  "verification.task",
  "executables.models",
  "executables.verification",
  "authentication.models",
  "run.active",
  "run.lock"
];

test("task readiness is independent of empty, mixed or stale legacy profile coverage", async () => {
  for (const metadata of [
    null,
    "{}",
    '{"scripts":{"test":"echo no test && exit 1"}}'
  ]) {
    const repository = await temporaryRoot();
    try {
      await writeConfig(repository.root, reviewerOnlyClaudeConfig());
      if (metadata !== null)
        await writeFile(path.join(repository.root, "package.json"), metadata);
      const before = await snapshotTree(repository.root);
      const report = await inspectDoctor(repository.root, dependencies());
      assert.equal(report.schema, "banzai-doctor/v5");
      assert.equal(report.schemaVersion, 5);
      assert.equal(checkStatus(report, "verification.task"), "pass");
      assert.equal(report.ready, true);
      assert.doesNotMatch(
        renderDoctorText(report),
        /Fix: banzai verify|Bootstrap/
      );
      assert.deepEqual(
        report.checks.map((check) => check.id),
        CHECK_ORDER
      );
      assert.deepEqual(await snapshotTree(repository.root), before);
    } finally {
      await repository.dispose();
    }
  }
});

test("doctor adoption classifications remain independent of verification and expose only bounded diagnostics", async (t) => {
  for (const classification of [
    "ready",
    "setup_required",
    "migration_required",
    "needs_attention"
  ])
    await t.test(classification, async () => {
      const repository = await temporaryRoot();
      try {
        await writeConfig(repository.root, reviewerOnlyClaudeConfig());
        if (classification === "setup_required")
          await writeFile(
            path.join(repository.root, "AGENTS.md"),
            "# FORBIDDEN-GUIDANCE\nPersonal rules."
          );
        if (classification === "migration_required") {
          await rm(path.join(repository.root, "AGENTS.md"));
          await writeFile(
            path.join(repository.root, "CLAUDE.md"),
            "## Engineering Quality\nFORBIDDEN-GUIDANCE"
          );
        }
        if (classification === "needs_attention")
          await writeFile(
            path.join(repository.root, "AGENTS.md"),
            `@/FORBIDDEN-HOST-PATH\n${ADOPTED_AGENTS}`
          );
        const before = await snapshotTree(repository.root);
        const report = await inspectDoctor(repository.root, dependencies());
        assert.equal(
          checkStatus(report, "project.guidance"),
          classification === "ready" ? "pass" : "fail"
        );
        assert.equal(checkStatus(report, "verification.task"), "pass");
        assert.equal(report.ready, classification === "ready");
        assert.deepEqual(
          report.checks.map((item) => item.id),
          CHECK_ORDER
        );
        assert.doesNotMatch(
          renderDoctorJson(report) + renderDoctorText(report),
          /FORBIDDEN-GUIDANCE|FORBIDDEN-HOST-PATH/
        );
        assert.deepEqual(await snapshotTree(repository.root), before);
      } finally {
        await repository.dispose();
      }
    });
});

async function temporaryRoot(): Promise<{
  root: string;
  dispose(): Promise<void>;
}> {
  const root = await mkdtemp(path.join(tmpdir(), "banzai-doctor-test-"));
  await writeAdoptedGuidance(root);
  return {
    root,
    dispose: async () => {
      await rm(root, { recursive: true, force: true });
    }
  };
}

function dependencies(options?: {
  unavailable?: readonly string[];
  liveness?: "live" | "stale";
  resolveClaudeInvocationScope?: NonNullable<
    DoctorDependencies["resolveClaudeInvocationScope"]
  >;
  inspectClaudePermissions?: NonNullable<
    DoctorDependencies["inspectClaudePermissions"]
  >;
}): DoctorDependencies {
  const unavailable = new Set(options?.unavailable ?? []);
  return {
    async executableAvailable(command) {
      return !unavailable.has(command);
    },
    processAlive() {
      return options?.liveness ?? "live";
    },
    ...(options?.resolveClaudeInvocationScope === undefined
      ? {}
      : {
          resolveClaudeInvocationScope: options.resolveClaudeInvocationScope
        }),
    ...(options?.inspectClaudePermissions === undefined
      ? {}
      : { inspectClaudePermissions: options.inspectClaudePermissions })
  };
}

function substantiveConfig(
  projectType: VerificationProjectType = "node"
): OrchestratorConfig {
  const config = reviewerOnlyClaudeConfig();
  config.verification.profiles.push({
    id: projectType,
    projectType,
    commands: [
      {
        name: `${projectType} verification`,
        command: "project-check",
        args: ["verify"],
        timeoutMs: 1_000
      }
    ]
  });
  return config;
}

function locallyExecutableConfig(
  command = process.execPath
): OrchestratorConfig {
  const config = substantiveConfig("node");
  config.models.planner.executable = process.execPath;
  config.models.implementer.executable = process.execPath;
  config.models.reviewer.executable = process.execPath;
  const nodeProfile = config.verification.profiles.find(
    (profile) => profile.projectType === "node"
  );
  assert.ok(nodeProfile);
  const nodeCommand = nodeProfile.commands[0];
  assert.ok(nodeCommand);
  nodeCommand.command = command;
  return config;
}

function policyExecutableConfig(command: string): unknown {
  return {
    ...locallyExecutableConfig(),
    schemaVersion: 4,
    verification: {
      policy: {
        schema: "banzai-task-verification-policy/v1",
        schemaVersion: 1,
        required: [
          {
            id: "project-check",
            name: "Project check",
            requirementRefs: ["project-policy"],
            command,
            args: [],
            cwd: ".",
            timeoutMs: 1000,
            evidence: "fresh",
            sources: [],
            materialization: null
          }
        ],
        denied: [],
        limits: {
          timeoutMs: 1000,
          workingDirectories: ["."],
          requiredContext: "inherited-local"
        },
        reuse: null
      }
    }
  };
}

async function writeConfig(
  root: string,
  config: unknown = substantiveConfig()
): Promise<void> {
  await mkdir(path.join(root, ".banzai"), { recursive: true });
  await writeFile(
    path.join(root, CONFIG_FILE),
    typeof config === "string"
      ? config
      : `${JSON.stringify(config, null, 2)}\n`,
    "utf8"
  );
}

function checkStatus(report: DoctorReport, id: string): string | undefined {
  return report.checks.find((item) => item.id === id)?.status;
}

function checkFixes(report: DoctorReport, id: string): unknown {
  return report.checks.find((item) => item.id === id)?.fixes;
}

test("reports a deterministic ready Node project without mutating it", async () => {
  const repository = await temporaryRoot();
  try {
    await writeFile(path.join(repository.root, "package.json"), "{}\n", "utf8");
    await writeConfig(repository.root);
    const before = await snapshotTree(repository.root);

    const first = await inspectDoctor(repository.root, dependencies());
    const second = await inspectDoctor(repository.root, dependencies());

    assert.equal(first.ready, true);
    assert.deepEqual(first.projectTypes, ["node"]);
    assert.deepEqual(
      first.checks.map((item) => item.id),
      CHECK_ORDER
    );
    assert.deepEqual(second, first);
    assert.equal(checkStatus(first, "authentication.models"), "warning");
    assert.match(
      first.checks.find((item) => item.id === "authentication.models")
        ?.message ?? "",
      /not checked.*not authentication proof.*startup preflight/s
    );
    assert.equal(first.summary.warnings, 1);
    assert.equal(
      first.summary.passed +
        first.summary.warnings +
        first.summary.failed +
        first.summary.skipped,
      CHECK_ORDER.length
    );
    assert.deepEqual(await snapshotTree(repository.root), before);
  } finally {
    await repository.dispose();
  }
});

test("distinguishes missing malformed unsupported invalid and legacy config", async () => {
  const repository = await temporaryRoot();
  try {
    const missing = await inspectDoctor(repository.root, dependencies());
    assert.equal(checkStatus(missing, "config.present"), "fail");
    assert.equal(checkStatus(missing, "config.valid"), "skipped");
    assert.equal(checkStatus(missing, "config.version"), "skipped");
    assert.equal(checkStatus(missing, "verification.task"), "skipped");

    await writeConfig(repository.root, "{not-json");
    const malformed = await inspectDoctor(repository.root, dependencies());
    assert.equal(checkStatus(malformed, "config.present"), "pass");
    assert.equal(checkStatus(malformed, "config.valid"), "fail");
    assert.equal(checkStatus(malformed, "config.version"), "skipped");

    await writeConfig(repository.root, {
      ...reviewerOnlyClaudeConfig(),
      schemaVersion: 99
    });
    const unsupported = await inspectDoctor(repository.root, dependencies());
    assert.equal(checkStatus(unsupported, "config.valid"), "fail");
    assert.equal(checkStatus(unsupported, "config.version"), "fail");

    const optedIn = reviewerOnlyClaudeConfig();
    optedIn.schemaVersion = 3;
    for (const profile of optedIn.verification.profiles)
      for (const [index, command] of profile.commands.entries())
        command.id = `${profile.id}-${index + 1}`;
    await writeConfig(repository.root, optedIn);
    const supported = await inspectDoctor(repository.root, dependencies());
    assert.equal(checkStatus(supported, "config.version"), "pass");
    assert.equal(checkStatus(supported, "config.valid"), "pass");

    const invalid = reviewerOnlyClaudeConfig();
    const invalidProfile = invalid.verification.profiles[0];
    assert.ok(invalidProfile);
    invalidProfile.commands = [];
    await writeConfig(repository.root, invalid);
    const invalidProfiles = await inspectDoctor(
      repository.root,
      dependencies()
    );
    assert.equal(checkStatus(invalidProfiles, "config.valid"), "fail");
    assert.equal(checkStatus(invalidProfiles, "config.version"), "pass");
    assert.equal(checkStatus(invalidProfiles, "verification.task"), "skipped");

    const legacy = {
      ...reviewerOnlyClaudeConfig(),
      schemaVersion: 1,
      verification: [
        {
          name: "legacy project check",
          command: "project-check",
          args: ["verify"],
          timeoutMs: 1_000
        }
      ]
    };
    await writeConfig(repository.root, legacy);
    const legacyReport = await inspectDoctor(repository.root, dependencies());
    assert.equal(checkStatus(legacyReport, "config.valid"), "pass");
    assert.equal(checkStatus(legacyReport, "config.version"), "fail");
    assert.equal(checkStatus(legacyReport, "verification.task"), "pass");
  } finally {
    await repository.dispose();
  }
});

test("reports verified degraded ambient and invalid Claude environments without exposing paths", async () => {
  const repository = await temporaryRoot();
  try {
    await writeConfig(repository.root, substantiveConfig("custom"));
    const verified = await inspectDoctor(repository.root, dependencies());
    assert.equal(checkStatus(verified, "claude.environment"), "pass");

    const degraded = await inspectDoctor(
      repository.root,
      dependencies({
        async resolveClaudeInvocationScope() {
          return {
            scope: {
              strictMcpConfig: true,
              settingSources: null,
              pluginDirectory: null
            },
            degradedReason: "FORBIDDEN-RAW-DEGRADATION-REASON"
          };
        }
      })
    );
    assert.equal(checkStatus(degraded, "claude.environment"), "warning");
    assert.equal(degraded.ready, true);
    assert.doesNotMatch(JSON.stringify(degraded), /FORBIDDEN/);

    const ambientConfig = substantiveConfig("custom");
    ambientConfig.claudeEnvironment.mode = "ambient";
    await writeConfig(repository.root, ambientConfig);
    const ambient = await inspectDoctor(
      repository.root,
      dependencies({
        async resolveClaudeInvocationScope() {
          throw new Error("ambient mode must not resolve a plugin");
        }
      })
    );
    assert.equal(checkStatus(ambient, "claude.environment"), "warning");
    assert.equal(ambient.ready, true);

    const invalidPlugin = path.join(repository.root, "wrong-plugin");
    await mkdir(path.join(invalidPlugin, ".claude-plugin"), {
      recursive: true
    });
    await writeFile(
      path.join(invalidPlugin, ".claude-plugin", "plugin.json"),
      `${JSON.stringify({ name: "not-banzai", skills: "./skills/" })}\n`,
      "utf8"
    );
    const invalidConfig = substantiveConfig("custom");
    invalidConfig.claudeEnvironment.pluginDirectory = invalidPlugin;
    await writeConfig(repository.root, invalidConfig);
    const invalid = await inspectDoctor(repository.root, dependencies());
    assert.equal(checkStatus(invalid, "claude.environment"), "fail");
    assert.equal(invalid.ready, false);
    assert.equal(JSON.stringify(invalid).includes(repository.root), false);
  } finally {
    await repository.dispose();
  }
});

test("reports Claude permission readiness only for the roles that depend on it", async () => {
  const repository = await temporaryRoot();
  const audit = (
    blocking: string[],
    advisories: string[],
    tools: ClaudePermissionAudit["tools"] = []
  ): ClaudePermissionAudit => ({
    demand: { fileWrites: true, shellCommands: true },
    sources: ["project"],
    trust: "trusted",
    tools,
    repositoryRulesIgnored: false,
    blocking,
    advisories
  });
  try {
    // A reviewer-only Claude configuration depends on no ambient rule, so the
    // check stays out of readiness entirely.
    await writeConfig(repository.root, substantiveConfig("custom"));
    const reviewerOnly = await inspectDoctor(
      repository.root,
      dependencies({
        async inspectClaudePermissions() {
          throw new Error("a reviewer-only configuration must not be audited");
        }
      })
    );
    assert.equal(checkStatus(reviewerOnly, "claude.permissions"), "skipped");
    assert.equal(reviewerOnly.ready, true);

    const planning = substantiveConfig("custom");
    planning.models.planner.executable = "claude";
    planning.models.planner.model = "claude-opus-5-5";
    await writeConfig(repository.root, planning);

    const granted = await inspectDoctor(
      repository.root,
      dependencies({
        async inspectClaudePermissions() {
          return audit([], []);
        }
      })
    );
    assert.equal(checkStatus(granted, "claude.permissions"), "pass");

    const degraded = await inspectDoctor(
      repository.root,
      dependencies({
        async inspectClaudePermissions() {
          return audit([], ["No loaded permission rule grants Bash."]);
        }
      })
    );
    assert.equal(checkStatus(degraded, "claude.permissions"), "warning");
    assert.equal(degraded.ready, true);
    // Bash grants are the operator's per-command choice, so no fix names one.
    assert.deepEqual(checkFixes(degraded, "claude.permissions"), []);

    const blocked = await inspectDoctor(
      repository.root,
      dependencies({
        async inspectClaudePermissions(input) {
          assert.equal(input.repoRoot, repository.root);
          assert.equal(input.settingSources, "project");
          assert.deepEqual(input.demand, {
            fileWrites: true,
            shellCommands: true
          });
          return audit(
            ["A deny or ask rule refuses Write."],
            [],
            [
              { tool: "Write", grant: "denied" },
              { tool: "Edit", grant: "missing" },
              { tool: "Bash", grant: "missing" }
            ]
          );
        }
      })
    );
    assert.equal(checkStatus(blocked, "claude.permissions"), "fail");
    assert.equal(blocked.ready, false);
    assert.deepEqual(checkFixes(blocked, "claude.permissions"), [
      {
        action:
          'Remove the deny or ask rules naming "Write" from the settings Claude loads; a rule in administrator policy settings needs your administrator.',
        documentation: "documentation/orchestrator.md#claude-tool-permissions"
      }
    ]);
    assert.match(
      renderDoctorText(blocked),
      /Fix: Remove the deny or ask rules/
    );
    assert.equal(JSON.stringify(blocked).includes(repository.root), false);

    // An environment that cannot be resolved is the environment check's
    // failure; the permission check has no sources to read and says so.
    const unresolvable = await inspectDoctor(
      repository.root,
      dependencies({
        async resolveClaudeInvocationScope() {
          throw new Error("unverifiable");
        },
        async inspectClaudePermissions() {
          throw new Error("an unverifiable environment must not be audited");
        }
      })
    );
    assert.equal(checkStatus(unresolvable, "claude.permissions"), "skipped");
  } finally {
    await repository.dispose();
  }
});

test("reports unavailable configured executables without running them", async () => {
  const repository = await temporaryRoot();
  try {
    await writeConfig(repository.root, substantiveConfig("custom"));
    const report = await inspectDoctor(
      repository.root,
      dependencies({ unavailable: ["codex", "project-check"] })
    );
    assert.equal(checkStatus(report, "executables.models"), "fail");
    assert.equal(checkStatus(report, "executables.verification"), "pass");
  } finally {
    await repository.dispose();
  }
});

test("default executable inspection rejects directories and accepts executable files and symlinks", async () => {
  const repository = await temporaryRoot();
  try {
    await writeFile(path.join(repository.root, "package.json"), "{}\n", "utf8");
    await writeConfig(repository.root, policyExecutableConfig("."));

    const directoryCommand = await inspectDoctor(repository.root);
    assert.equal(
      checkStatus(directoryCommand, "executables.verification"),
      "fail"
    );
    assert.equal(directoryCommand.ready, false);

    const executablePath = path.join(repository.root, "verify-tool");
    await writeFile(executablePath, "#!/bin/sh\nexit 0\n", "utf8");
    await chmod(executablePath, 0o755);
    await writeConfig(repository.root, policyExecutableConfig("./verify-tool"));
    const executableFile = await inspectDoctor(repository.root);
    assert.equal(
      checkStatus(executableFile, "executables.verification"),
      "pass"
    );
    assert.equal(executableFile.ready, true);

    await symlink("verify-tool", path.join(repository.root, "verify-link"));
    await writeConfig(repository.root, policyExecutableConfig("./verify-link"));
    const executableSymlink = await inspectDoctor(repository.root);
    assert.equal(
      checkStatus(executableSymlink, "executables.verification"),
      "pass"
    );
    assert.equal(executableSymlink.ready, true);
  } finally {
    await repository.dispose();
  }
});

test("rejects symlinked Banzai and runs boundaries without reading external evidence", async () => {
  const repository = await temporaryRoot();
  const external = await temporaryRoot();
  try {
    await writeFile(path.join(repository.root, "package.json"), "{}\n", "utf8");
    await writeConfig(external.root, locallyExecutableConfig());
    const externalBanzai = path.join(external.root, ".banzai");
    const localBanzai = path.join(repository.root, ".banzai");
    await symlink(externalBanzai, localBanzai);
    const beforeRepository = await snapshotTree(repository.root);
    const beforeExternal = await snapshotTree(external.root);

    const escapedBanzai = await inspectDoctor(repository.root, dependencies());
    assert.equal(checkStatus(escapedBanzai, "config.present"), "fail");
    assert.equal(checkStatus(escapedBanzai, "run.active"), "fail");
    assert.equal(checkStatus(escapedBanzai, "run.lock"), "fail");
    assert.equal(escapedBanzai.ready, false);
    assert.equal(await readlink(localBanzai), externalBanzai);
    assert.deepEqual(await snapshotTree(repository.root), beforeRepository);
    assert.deepEqual(await snapshotTree(external.root), beforeExternal);

    await rm(localBanzai);
    await writeConfig(repository.root, locallyExecutableConfig());
    await writeFile(
      path.join(repository.root, ".banzai", "active-run.json"),
      JSON.stringify({ schemaVersion: 1, runId: "safe-run" }),
      "utf8"
    );
    const externalRuns = path.join(external.root, "external-runs");
    const externalRun = path.join(externalRuns, "safe-run");
    await mkdir(externalRun, { recursive: true });
    await writeFile(
      path.join(externalRun, "state.json"),
      JSON.stringify({
        schemaVersion: 2,
        runId: "safe-run",
        repoRoot: repository.root,
        status: "done"
      }),
      "utf8"
    );
    const localRuns = path.join(repository.root, ".banzai", "runs");
    await symlink(externalRuns, localRuns);

    const escapedRuns = await inspectDoctor(repository.root, dependencies());
    assert.equal(checkStatus(escapedRuns, "run.active"), "fail");
    assert.equal(escapedRuns.ready, false);
    assert.equal(await readlink(localRuns), externalRuns);
  } finally {
    await repository.dispose();
    await external.dispose();
  }
});

test("rejects final config pointer state and lock symlinks outside their boundaries", async () => {
  const repository = await temporaryRoot();
  const external = await temporaryRoot();
  try {
    await writeFile(path.join(repository.root, "package.json"), "{}\n", "utf8");
    await mkdir(path.join(repository.root, ".banzai"), { recursive: true });
    const externalConfig = path.join(external.root, "config.json");
    await writeFile(
      externalConfig,
      `${JSON.stringify(locallyExecutableConfig(), null, 2)}\n`,
      "utf8"
    );
    const localConfig = path.join(repository.root, CONFIG_FILE);
    await symlink(externalConfig, localConfig);
    const configEscape = await inspectDoctor(repository.root, dependencies());
    assert.equal(checkStatus(configEscape, "config.present"), "fail");
    assert.equal(configEscape.ready, false);
    await rm(localConfig);
    await writeConfig(repository.root, locallyExecutableConfig());

    const externalPointer = path.join(external.root, "active-run.json");
    await writeFile(
      externalPointer,
      JSON.stringify({ schemaVersion: 1, runId: "safe-run" }),
      "utf8"
    );
    const localPointer = path.join(
      repository.root,
      ".banzai",
      "active-run.json"
    );
    await symlink(externalPointer, localPointer);
    const pointerEscape = await inspectDoctor(repository.root, dependencies());
    assert.equal(checkStatus(pointerEscape, "run.active"), "fail");
    await rm(localPointer);
    await writeFile(
      localPointer,
      JSON.stringify({ schemaVersion: 1, runId: "safe-run" }),
      "utf8"
    );

    const localRun = path.join(repository.root, ".banzai", "runs", "safe-run");
    await mkdir(localRun, { recursive: true });
    const externalState = path.join(external.root, "state.json");
    await writeFile(
      externalState,
      JSON.stringify({
        schemaVersion: 2,
        runId: "safe-run",
        repoRoot: repository.root,
        status: "done"
      }),
      "utf8"
    );
    await symlink(externalState, path.join(localRun, "state.json"));
    const stateEscape = await inspectDoctor(repository.root, dependencies());
    assert.equal(checkStatus(stateEscape, "run.active"), "fail");

    const externalLock = path.join(external.root, "runner.lock");
    await writeFile(
      externalLock,
      JSON.stringify({
        schemaVersion: 1,
        pid: 123,
        token: "external-token",
        createdAt: "2026-08-04T00:00:00.000Z"
      }),
      "utf8"
    );
    await symlink(
      externalLock,
      path.join(repository.root, ".banzai", "runner.lock")
    );
    const lockEscape = await inspectDoctor(repository.root, dependencies());
    assert.equal(checkStatus(lockEscape, "run.lock"), "fail");
  } finally {
    await repository.dispose();
    await external.dispose();
  }
});

async function writeRunState(
  root: string,
  options: {
    pointer?: unknown;
    state?: unknown;
    runId?: string;
  } = {}
): Promise<void> {
  const runId = options.runId ?? "safe-run";
  const runDirectory = path.join(root, ".banzai", "runs", runId);
  await mkdir(runDirectory, { recursive: true });
  await writeFile(
    path.join(root, ".banzai", "active-run.json"),
    JSON.stringify(options.pointer ?? { schemaVersion: 1, runId }, null, 2),
    "utf8"
  );
  if (options.state !== null) {
    await writeFile(
      path.join(runDirectory, "state.json"),
      JSON.stringify(
        options.state ?? {
          schemaVersion: 2,
          runId,
          repoRoot: root,
          status: "done"
        },
        null,
        2
      ),
      "utf8"
    );
  }
}

test("distinguishes terminal active malformed unsafe missing and mismatched run state", async () => {
  const repository = await temporaryRoot();
  try {
    await writeConfig(repository.root, substantiveConfig("custom"));
    await writeRunState(repository.root);
    assert.equal(
      checkStatus(
        await inspectDoctor(repository.root, dependencies()),
        "run.active"
      ),
      "pass"
    );

    await writeRunState(repository.root, {
      state: {
        schemaVersion: 2,
        runId: "safe-run",
        repoRoot: repository.root,
        status: "implementing"
      }
    });
    assert.equal(
      checkStatus(
        await inspectDoctor(repository.root, dependencies()),
        "run.active"
      ),
      "warning"
    );

    await writeFile(
      path.join(repository.root, ".banzai", "active-run.json"),
      "{bad",
      "utf8"
    );
    assert.equal(
      checkStatus(
        await inspectDoctor(repository.root, dependencies()),
        "run.active"
      ),
      "fail"
    );

    await writeRunState(repository.root, {
      pointer: { schemaVersion: 2, runId: "safe-run" },
      state: null
    });
    assert.match(
      (await inspectDoctor(repository.root, dependencies())).checks.find(
        (item) => item.id === "run.active"
      )?.message ?? "",
      /unsupported structure/
    );

    const pointerPath = path.join(
      repository.root,
      ".banzai",
      "active-run.json"
    );
    await rm(pointerPath);
    await symlink("missing-pointer-target", pointerPath);
    assert.match(
      (await inspectDoctor(repository.root, dependencies())).checks.find(
        (item) => item.id === "run.active"
      )?.message ?? "",
      /unreadable or escapes/
    );
    await rm(pointerPath);

    await writeRunState(repository.root, {
      pointer: { schemaVersion: 1, runId: "../escape" },
      state: null
    });
    assert.match(
      (await inspectDoctor(repository.root, dependencies())).checks.find(
        (item) => item.id === "run.active"
      )?.message ?? "",
      /unsafe/
    );

    await writeRunState(repository.root, {
      runId: "missing-run",
      state: null
    });
    assert.match(
      (await inspectDoctor(repository.root, dependencies())).checks.find(
        (item) => item.id === "run.active"
      )?.message ?? "",
      /missing state/
    );

    await writeRunState(repository.root, {
      state: {
        schemaVersion: 2,
        runId: "different-run",
        repoRoot: repository.root,
        status: "done"
      }
    });
    assert.match(
      (await inspectDoctor(repository.root, dependencies())).checks.find(
        (item) => item.id === "run.active"
      )?.message ?? "",
      /do not match/
    );

    await writeRunState(repository.root, {
      state: {
        schemaVersion: 2,
        runId: "safe-run",
        repoRoot: path.join(repository.root, "other-checkout"),
        status: "done"
      }
    });
    assert.match(
      (await inspectDoctor(repository.root, dependencies())).checks.find(
        (item) => item.id === "run.active"
      )?.message ?? "",
      /do not match this checkout/
    );

    await writeRunState(repository.root);
    await writeFile(
      path.join(repository.root, ".banzai", "runs", "safe-run", "state.json"),
      "{bad",
      "utf8"
    );
    assert.match(
      (await inspectDoctor(repository.root, dependencies())).checks.find(
        (item) => item.id === "run.active"
      )?.message ?? "",
      /state is malformed/
    );

    await writeRunState(repository.root, {
      state: {
        schemaVersion: 99,
        runId: "safe-run",
        repoRoot: repository.root,
        status: "done"
      }
    });
    assert.match(
      (await inspectDoctor(repository.root, dependencies())).checks.find(
        (item) => item.id === "run.active"
      )?.message ?? "",
      /unsupported structure/
    );
  } finally {
    await repository.dispose();
  }
});

test("distinguishes absent live stale malformed and unsupported runner locks", async () => {
  const repository = await temporaryRoot();
  const lockPath = path.join(repository.root, ".banzai", "runner.lock");
  try {
    await writeConfig(repository.root, substantiveConfig("custom"));
    assert.equal(
      checkStatus(
        await inspectDoctor(repository.root, dependencies()),
        "run.lock"
      ),
      "pass"
    );

    const lock = {
      schemaVersion: 1,
      pid: 123,
      token: "FORBIDDEN-LOCK-TOKEN",
      createdAt: "2026-08-04T00:00:00.000Z"
    };
    await writeFile(lockPath, JSON.stringify(lock), "utf8");
    const before = await snapshotTree(path.join(repository.root, ".banzai"));
    assert.equal(
      checkStatus(
        await inspectDoctor(
          repository.root,
          dependencies({ liveness: "live" })
        ),
        "run.lock"
      ),
      "warning"
    );
    assert.equal(
      checkStatus(
        await inspectDoctor(
          repository.root,
          dependencies({ liveness: "stale" })
        ),
        "run.lock"
      ),
      "warning"
    );
    assert.deepEqual(
      await snapshotTree(path.join(repository.root, ".banzai")),
      before
    );

    await writeFile(lockPath, "{bad", "utf8");
    assert.equal(
      checkStatus(
        await inspectDoctor(repository.root, dependencies()),
        "run.lock"
      ),
      "fail"
    );
    await writeFile(
      lockPath,
      JSON.stringify({ ...lock, schemaVersion: 2 }),
      "utf8"
    );
    assert.equal(
      checkStatus(
        await inspectDoctor(repository.root, dependencies()),
        "run.lock"
      ),
      "fail"
    );

    await rm(lockPath);
    await writeFile(
      path.join(repository.root, "outside-lock.json"),
      JSON.stringify(lock),
      "utf8"
    );
    await symlink("../outside-lock.json", lockPath);
    assert.match(
      (await inspectDoctor(repository.root, dependencies())).checks.find(
        (item) => item.id === "run.lock"
      )?.message ?? "",
      /unreadable or escapes/
    );
  } finally {
    await repository.dispose();
  }
});

test("never exports private persisted config state environment or source canaries", async () => {
  const repository = await temporaryRoot();
  try {
    await writeConfig(repository.root, substantiveConfig("custom"));
    await writeFile(
      path.join(repository.root, "source.txt"),
      "FORBIDDEN-SOURCE-CONTENT\n",
      "utf8"
    );
    await writeRunState(repository.root, {
      state: {
        schemaVersion: 2,
        runId: "safe-run",
        repoRoot: repository.root,
        status: "done",
        request: "FORBIDDEN-REQUEST-TEXT",
        slug: "FORBIDDEN-SLUG",
        blockReason: "FORBIDDEN-RAW-ERROR",
        approvalDigest: "FORBIDDEN-DIGEST",
        rawOutput: "FORBIDDEN-MODEL-OUTPUT"
      }
    });
    await writeFile(
      path.join(repository.root, ".banzai", "runner.lock"),
      JSON.stringify({
        schemaVersion: 1,
        pid: 123,
        token: "FORBIDDEN-LOCK-TOKEN",
        createdAt: "2026-08-04T00:00:00.000Z"
      }),
      "utf8"
    );
    const before = await snapshotTree(repository.root);
    const output = JSON.stringify(
      await inspectDoctor(repository.root, dependencies({ liveness: "stale" }))
    );
    assert.doesNotMatch(output, /FORBIDDEN/);
    assert.equal(output.includes(repository.root), false);
    assert.equal(output.includes("123"), false);
    assert.deepEqual(await snapshotTree(repository.root), before);
  } finally {
    await repository.dispose();
  }
});

test("does not create local state when the Banzai directory is absent", async () => {
  const repository = await temporaryRoot();
  try {
    const before = await snapshotTree(repository.root);
    await inspectDoctor(repository.root, dependencies());
    assert.deepEqual(await snapshotTree(repository.root), before);
  } finally {
    await repository.dispose();
  }
});

test("doctor v4 compares mixed role unions without hiding structural failures or mutating evidence", async () => {
  const repository = await temporaryRoot();
  const plugin = await instructionPluginFixture();
  try {
    const config = substantiveConfig();
    for (const role of ["planner", "implementer", "reviewer"] as const)
      config.models[role].executable = "claude";
    config.claudeEnvironment = {
      mode: "scoped",
      pluginDirectory: plugin.directory
    };
    await writeConfig(repository.root, config);
    const before = await snapshotTree(repository.root);
    const verified = await inspectDoctor(repository.root, dependencies());
    assert.equal(verified.schema, "banzai-doctor/v5");
    assert.equal(verified.schemaVersion, 5);
    assert.equal(checkStatus(verified, "claude.instructions"), "pass");
    assert.deepEqual(
      verified.checks.map((entry) => entry.id),
      CHECK_ORDER
    );
    assert.deepEqual(await snapshotTree(repository.root), before);
    config.models.planner.executable = "codex";
    config.models.implementer.executable = "codex";
    await writeConfig(repository.root, config);
    const defaults = (
      await inspectDoctor(repository.root, dependencies())
    ).checks.find((item) => item.id === "claude.instructions");
    assert.equal(defaults?.status, "pass");
    assert.deepEqual(
      defaults.roles.map((role) => [role.role, role.state, role.fixes]),
      [
        ["planner", "not_applicable", []],
        ["implementer", "not_applicable", []],
        ["reviewer", "verified", []]
      ]
    );
    assert.deepEqual(defaults.fixes, []);
    config.models.planner.executable = "claude";
    config.models.implementer.executable = "claude";
    const target = path.join(plugin.directory, "phases/fix.md");
    const original = await readFile(target);
    await writeFile(target, "PRIVATE-INSTRUCTION-CANARY");
    await rm(path.join(plugin.directory, "guidance/requirements.md"));
    config.models.reviewer.executable = "codex";
    await writeConfig(repository.root, config);
    const mixed = await inspectDoctor(repository.root, dependencies());
    assert.equal(checkStatus(mixed, "claude.instructions"), "fail");
    assert.equal(mixed.ready, false);
    assert.doesNotMatch(renderDoctorJson(mixed), /PRIVATE-INSTRUCTION-CANARY/);
    assert.ok(!renderDoctorJson(mixed).includes(plugin.directory));
    await writeFile(target, original);
    assert.equal(
      checkStatus(
        await inspectDoctor(repository.root, dependencies()),
        "claude.instructions"
      ),
      "warning"
    );
    await rm(path.join(plugin.directory, "hooks/spec-gate.cjs"));
    const invalid = await inspectDoctor(repository.root, dependencies());
    assert.equal(checkStatus(invalid, "claude.environment"), "fail");
    assert.equal(checkStatus(invalid, "claude.instructions"), "skipped");
    assert.equal(invalid.ready, false);
  } finally {
    await plugin.dispose();
    await repository.dispose();
  }
});
