import { instructionPluginFixture } from "./phase-instruction-fixtures.js";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { constants } from "node:fs";
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readlink,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import type { ClaudePermissionAudit } from "../src/claude-permissions.js";
import { CONFIG_FILE } from "../src/config.js";
import {
  doctorInspection,
  renderDoctorJson,
  renderDoctorText
} from "../src/doctor-cli.js";
import {
  inspectDoctor,
  type DoctorCheck,
  type DoctorDependencies,
  type DoctorFix,
  type DoctorLocalConfigGitProbe,
  type DoctorReport
} from "../src/doctor.js";
import { isPathIgnored, isPathInIndex } from "../src/git.js";
import { LOCAL_CONFIG_FILE, LOCAL_CONFIG_LIMIT } from "../src/local-config.js";
import type {
  LocalModelLayer,
  OrchestratorConfig,
  VerificationProjectType
} from "../src/types.js";
import {
  LOCAL_CONFIG_IGNORE_LINE,
  createTestRepository,
  historicalBindingFixture,
  localModelFileText,
  requiredFixture,
  reviewerOnlyClaudeConfig,
  snapshotTree,
  writeLocalModels
} from "./helpers.js";
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
  "config.local",
  "claude.environment",
  "claude.instructions",
  "claude.permissions",
  "claude.plugin-scope",
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
      assert.equal(report.schema, "banzai-doctor/v6");
      assert.equal(report.schemaVersion, 6);
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

const ABSENT_HOME = path.join(
  tmpdir(),
  `banzai-doctor-test-absent-home-${process.pid}`
);

function dependencies(options?: {
  unavailable?: readonly string[];
  liveness?: "live" | "stale";
  resolveClaudeInvocationScope?: NonNullable<
    DoctorDependencies["resolveClaudeInvocationScope"]
  >;
  inspectClaudePermissions?: NonNullable<
    DoctorDependencies["inspectClaudePermissions"]
  >;
  claudeSettingsEnvironment?: NodeJS.ProcessEnv;
  localConfigGitState?: DoctorLocalConfigGitProbe;
  /** Receives every command whose availability doctor asks about. */
  executableCalls?: string[];
}): DoctorDependencies {
  const unavailable = new Set(options?.unavailable ?? []);
  return {
    // No test reads the developer's own Claude settings.
    claudeSettingsEnvironment: options?.claudeSettingsEnvironment ?? {
      HOME: ABSENT_HOME
    },
    async executableAvailable(command) {
      options?.executableCalls?.push(command);
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
      : { inspectClaudePermissions: options.inspectClaudePermissions }),
    ...(options?.localConfigGitState === undefined
      ? {}
      : { localConfigGitState: options.localConfigGitState })
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

test("reports runs bound before binding v3 as read-only history", async () => {
  const repository = await temporaryRoot();
  const historicalState = (status: string, schemaVersion = 8) => ({
    schemaVersion,
    runId: "safe-run",
    repoRoot: repository.root,
    status,
    verificationMode: "task",
    artifactBinding: historicalBindingFixture({
      workId: "11111111-1111-4111-8111-111111111111",
      slug: "earlier-work",
      createdAt: "2026-09-18T15:25:14.369Z",
      sourceCommit: null
    })
  });
  const activeRun = async () =>
    requiredFixture(
      (await inspectDoctor(repository.root, dependencies())).checks.find(
        (item) => item.id === "run.active"
      )
    );
  try {
    await writeConfig(repository.root, substantiveConfig("custom"));
    await writeRunState(repository.root, { state: historicalState("done") });
    const done = await activeRun();
    assert.equal(done.status, "pass");
    assert.match(done.message, /earlier Banzai version/);

    await writeRunState(repository.root, { state: historicalState("blocked") });
    const blocked = await activeRun();
    assert.equal(blocked.status, "warning");
    assert.match(blocked.message, /cannot resume/);
    assert.match(blocked.fixes[0]?.action ?? "", /banzai cancel/);

    // Binding v3 is mandatory from state 9, so an older binding there is corrupt.
    await writeRunState(repository.root, {
      state: historicalState("done", 10)
    });
    assert.equal((await activeRun()).status, "fail");
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
    assert.equal(verified.schema, "banzai-doctor/v6");
    assert.equal(verified.schemaVersion, 6);
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
    const planningReviewPhase = path.join(
      plugin.directory,
      "phases/planning-review.md"
    );
    const planningReviewBytes = await readFile(planningReviewPhase);
    await writeFile(planningReviewPhase, "PRIVATE-PLANNING-INSTRUCTION-CANARY");
    const reviewerBefore = await snapshotTree(repository.root);
    const reviewerUnion = await inspectDoctor(repository.root, dependencies());
    assert.equal(checkStatus(reviewerUnion, "claude.instructions"), "fail");
    assert.equal(reviewerUnion.ready, false);
    assert.deepEqual(await snapshotTree(repository.root), reviewerBefore);
    assert.doesNotMatch(
      renderDoctorJson(reviewerUnion),
      /PRIVATE-PLANNING-INSTRUCTION-CANARY/
    );
    assert.ok(!renderDoctorJson(reviewerUnion).includes(plugin.directory));
    await writeFile(planningReviewPhase, planningReviewBytes);
    assert.equal(
      checkStatus(
        await inspectDoctor(repository.root, dependencies()),
        "claude.instructions"
      ),
      "pass"
    );
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

test("doctor advises repository scope only when Claude user settings enable Banzai", async () => {
  const repository = await temporaryRoot();
  const home = await mkdtemp(path.join(tmpdir(), "banzai-doctor-home-"));
  const userSettings = path.join(home, ".claude", "settings.json");
  const environment = { HOME: home };
  const inspect = async (env: NodeJS.ProcessEnv = environment) =>
    await inspectDoctor(
      repository.root,
      dependencies({ claudeSettingsEnvironment: env })
    );
  const scopeCheck = (report: DoctorReport) =>
    report.checks.find((item) => item.id === "claude.plugin-scope");
  try {
    await writeConfig(repository.root, reviewerOnlyClaudeConfig());
    const absent = await inspect();
    assert.equal(checkStatus(absent, "claude.plugin-scope"), "pass");
    assert.equal(
      scopeCheck(absent)?.message,
      "Banzai is not enabled in Claude user settings."
    );
    assert.deepEqual(checkFixes(absent, "claude.plugin-scope"), []);

    await mkdir(path.dirname(userSettings), { recursive: true });
    const enabled = JSON.stringify({
      enabledPlugins: {
        "other@claude-plugins-official": true,
        "banzai@banzai-plugins": true
      }
    });
    await writeFile(userSettings, enabled);
    const before = await snapshotTree(home);
    const warned = await inspect();
    const warning = scopeCheck(warned);
    assert.ok(warning);
    assert.equal(warning.status, "warning");
    assert.equal(warning.category, "config");
    assert.equal(
      warning.message,
      `Claude user settings at ${userSettings} enable banzai@banzai-plugins, so Banzai skill descriptions load in every repository.`
    );
    assert.deepEqual(warning.fixes, [
      {
        action:
          "Install Banzai for this repository instead: run `claude plugin uninstall banzai@banzai-plugins --scope user`, then `claude plugin install banzai@banzai-plugins --scope local`, or `--scope project` to share it with your team.",
        documentation: "documentation/getting-started.md#claude-code-plugin"
      }
    ]);
    // Advisory only: readiness and the other checks are unchanged.
    assert.equal(warned.ready, absent.ready);
    assert.equal(warned.summary.warnings, absent.summary.warnings + 1);
    assert.deepEqual(
      warned.checks.filter((item) => item.id !== "claude.plugin-scope"),
      absent.checks.filter((item) => item.id !== "claude.plugin-scope")
    );
    assert.match(
      renderDoctorText(warned),
      /\[WARNING\] claude\.plugin-scope \(config\): Claude user settings at .+\n {4}Fix: Install Banzai for this repository instead: .+ \(documentation\/getting-started\.md#claude-code-plugin\)/
    );
    assert.deepEqual(await snapshotTree(home), before);

    // CLAUDE_CONFIG_DIR replaces ~/.claude, and any marketplace name matches.
    const configured = path.join(home, "configured");
    await mkdir(configured);
    await writeFile(
      path.join(configured, "settings.json"),
      JSON.stringify({ enabledPlugins: { "banzai@fork": true } })
    );
    const relocated = scopeCheck(
      await inspect({ HOME: home, CLAUDE_CONFIG_DIR: configured })
    );
    assert.ok(relocated);
    assert.equal(relocated.status, "warning");
    assert.match(relocated.message, /enable banzai@fork,/);

    for (const document of [
      "{}",
      '{"enabledPlugins":{"banzai@banzai-plugins":false}}',
      '{"enabledPlugins":{"banzai-extra@banzai-plugins":true,"other@banzai":true}}',
      '{"enabledPlugins":["banzai@banzai-plugins"]}',
      '{"enabledPlugins":{"banzai@banzai-plugins":"true"}}'
    ]) {
      await writeFile(userSettings, document);
      assert.equal(
        checkStatus(await inspect(), "claude.plugin-scope"),
        "pass",
        document
      );
    }

    // Project and local scope are the recommended installs, never a hint.
    await rm(userSettings);
    await mkdir(path.join(repository.root, ".claude"), { recursive: true });
    for (const file of ["settings.json", "settings.local.json"])
      await writeFile(path.join(repository.root, ".claude", file), enabled);
    assert.equal(checkStatus(await inspect(), "claude.plugin-scope"), "pass");

    for (const document of ["{bad", "[]", '"settings"']) {
      await writeFile(userSettings, document);
      const malformed = await inspect();
      const skipped = scopeCheck(malformed);
      assert.ok(skipped);
      assert.equal(skipped.status, "skipped", document);
      assert.equal(
        skipped.message,
        `Claude user settings at ${userSettings} are unreadable or not a JSON object, so the plugin scope was not inspected.`
      );
      assert.deepEqual(skipped.fixes, []);
      assert.equal(malformed.ready, absent.ready);
    }
    await rm(userSettings);
    await mkdir(userSettings);
    assert.equal(
      checkStatus(await inspect(), "claude.plugin-scope"),
      "skipped"
    );
  } finally {
    await rm(home, { recursive: true, force: true });
    await repository.dispose();
  }
});

const execFileAsync = promisify(execFile);

const LOCAL_DOCUMENTATION = "documentation/orchestrator.md#model-configuration";
const LOCAL_MESSAGES = {
  absent:
    "No local model file is present; every role uses the shared models in .banzai/config.json.",
  valid:
    ".banzai/config.local.json is valid, ignored by Git and not in the Git index; the roles it sets replace the shared ones.",
  tracked:
    ".banzai/config.local.json is in the Git index, so it is shared through Git and may hold someone else's model choice.",
  notIgnored:
    ".banzai/config.local.json is not ignored by Git, so it could be committed and shared.",
  unsafe:
    ".banzai/config.local.json is unsafe to read: it or .banzai/ is a symbolic link, or it is not a regular file.",
  unreadable: ".banzai/config.local.json cannot be read.",
  invalidFile:
    ".banzai/config.local.json is not a local model file: it is larger than 64 KiB, not UTF-8 text, not JSON or not a JSON object.",
  git: "Git could not report whether .banzai/config.local.json is in the Git index or ignored, so the local model file was not used."
} as const;

function invalidAt(fieldPath: string): string {
  return `.banzai/config.local.json has a missing or invalid value at ${fieldPath}.`;
}

function refusedKey(location: string): string {
  return `.banzai/config.local.json sets a key that is not allowed ${location}; it may set only schemaVersion and models, with executable, model and effort for planner, implementer and reviewer.`;
}

const LOCAL_FIXES = {
  correct: {
    action:
      "Correct .banzai/config.local.json, or delete it to use the shared models in .banzai/config.json.",
    documentation: LOCAL_DOCUMENTATION
  },
  tracked: {
    action:
      "Run `git rm --cached .banzai/config.local.json`, review the local copy, and commit the removal.",
    documentation: LOCAL_DOCUMENTATION
  },
  notIgnored: {
    action:
      "Run `banzai model --local`, which ignores the file for this clone, or add the line .banzai/config.local.json to .gitignore and commit it.",
    documentation: LOCAL_DOCUMENTATION
  },
  unsafe: {
    action:
      "Make .banzai/ a directory and .banzai/config.local.json a regular file, or delete the local file to use the shared models in .banzai/config.json.",
    documentation: LOCAL_DOCUMENTATION
  },
  git: {
    action:
      "Make sure git runs in this checkout, then run banzai doctor again.",
    documentation: LOCAL_DOCUMENTATION
  }
} satisfies Record<string, DoctorFix>;

const LOCAL_SKIPS = {
  "claude.instructions":
    "Instruction comparison is skipped while the local model file fails config.local.",
  "claude.permissions":
    "Claude permission inspection is skipped while the local model file fails config.local.",
  "executables.models":
    "Model executable availability is skipped while the local model file fails config.local."
} as const;

const LOCAL_REVIEWER: LocalModelLayer = {
  reviewer: { executable: "claude", model: "claude-sonnet-5", effort: "high" }
};

/** A fake of the two ADR-0060 §8 queries that records each question asked. */
function recordingProbe(
  answers: {
    tracked?: boolean | "fails";
    ignored?: boolean | "fails";
  } = {}
): { calls: string[]; probe: DoctorLocalConfigGitProbe } {
  const calls: string[] = [];
  const answer = (value: boolean | "fails" | undefined, fallback: boolean) => {
    if (value === "fails") throw new Error("FORBIDDEN-GIT-STDERR");
    return value ?? fallback;
  };
  return {
    calls,
    probe: {
      async isPathInIndex(repoRoot, relativePath) {
        calls.push(`index ${repoRoot} ${relativePath}`);
        return answer(answers.tracked, false);
      },
      async isPathIgnored(repoRoot, relativePath) {
        calls.push(`ignored ${repoRoot} ${relativePath}`);
        return answer(answers.ignored, true);
      }
    }
  };
}

function findCheck(report: DoctorReport, id: string): DoctorCheck {
  return requiredFixture(report.checks.find((item) => item.id === id));
}

function doctorOutput(report: DoctorReport): string {
  return renderDoctorJson(report) + renderDoctorText(report);
}

test("config.local follows config.version, passes without a local file and asks Git nothing", async () => {
  const repository = await temporaryRoot();
  try {
    const recorded = recordingProbe();
    const unconfigured = await inspectDoctor(
      repository.root,
      dependencies({ localConfigGitState: recorded.probe })
    );
    assert.deepEqual(
      unconfigured.checks.map((item) => item.id),
      CHECK_ORDER
    );
    assert.equal(findCheck(unconfigured, "config.local").status, "pass");
    assert.deepEqual(unconfigured.models, []);
    assert.match(renderDoctorText(unconfigured), /\nModels: unavailable\n/);

    await writeConfig(repository.root, reviewerOnlyClaudeConfig());
    const report = await inspectDoctor(
      repository.root,
      dependencies({ localConfigGitState: recorded.probe })
    );
    const ids = report.checks.map((item) => item.id);
    assert.deepEqual(ids, CHECK_ORDER);
    assert.equal(
      ids.indexOf("config.local"),
      ids.indexOf("config.version") + 1
    );
    assert.deepEqual(findCheck(report, "config.local"), {
      id: "config.local",
      category: "config",
      status: "pass",
      message: LOCAL_MESSAGES.absent,
      fixes: [],
      roles: []
    });
    assert.deepEqual(recorded.calls, []);
    assert.equal(report.ready, true);
    assert.deepEqual(Object.keys(report), [
      "schema",
      "schemaVersion",
      "ready",
      "projectTypes",
      "models",
      "summary",
      "checks"
    ]);
    assert.deepEqual(report.models, [
      {
        role: "planner",
        vendor: "codex",
        model: "gpt-6.1-sol",
        effort: "xhigh",
        source: "committed"
      },
      {
        role: "implementer",
        vendor: "codex",
        model: "gpt-6.1-sol",
        effort: "xhigh",
        source: "committed"
      },
      {
        role: "reviewer",
        vendor: "claude",
        model: "claude-opus-5-5",
        effort: "xhigh",
        source: "committed"
      }
    ]);
    assert.match(
      renderDoctorText(report),
      /\nProject types: [^\n]*\nModels:\n {2}planner: codex gpt-6\.1-sol effort=xhigh \(committed\)\n {2}implementer: codex gpt-6\.1-sol effort=xhigh \(committed\)\n {2}reviewer: claude claude-opus-5-5 effort=xhigh \(committed\)\nChecks:\n/
    );
  } finally {
    await repository.dispose();
  }
});

test("config.local reports each local file cause with fixed text, asking Git only about an existing file", async (t) => {
  const repository = await temporaryRoot();
  const target = path.join(repository.root, LOCAL_CONFIG_FILE);
  const canonical = localModelFileText(LOCAL_REVIEWER);
  const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
  const triple = {
    executable: "claude",
    model: "claude-opus-5-5",
    effort: "xhigh"
  };
  const cases: {
    name: string;
    write(): Promise<void>;
    answers?: Parameters<typeof recordingProbe>[0];
    withoutProbe?: true;
    readable?: false;
    status: "pass" | "fail";
    message: string;
    fixes: DoctorFix[];
    queries: ("index" | "ignored")[];
  }[] = [
    {
      name: "valid",
      write: async () => {
        await writeFile(target, canonical);
      },
      status: "pass",
      message: LOCAL_MESSAGES.valid,
      fixes: [],
      queries: ["index", "ignored"]
    },
    {
      name: "tracked",
      write: async () => {
        await writeFile(target, canonical);
      },
      answers: { tracked: true, ignored: true },
      status: "fail",
      message: LOCAL_MESSAGES.tracked,
      fixes: [LOCAL_FIXES.tracked],
      queries: ["index"]
    },
    {
      name: "not ignored",
      write: async () => {
        await writeFile(target, canonical);
      },
      answers: { ignored: false },
      status: "fail",
      message: LOCAL_MESSAGES.notIgnored,
      fixes: [LOCAL_FIXES.notIgnored],
      queries: ["index", "ignored"]
    },
    {
      name: "index query cannot run",
      write: async () => {
        await writeFile(target, canonical);
      },
      answers: { tracked: "fails" },
      status: "fail",
      message: LOCAL_MESSAGES.git,
      fixes: [LOCAL_FIXES.git],
      queries: ["index"]
    },
    {
      name: "ignore query cannot run",
      write: async () => {
        await writeFile(target, canonical);
      },
      answers: { ignored: "fails" },
      status: "fail",
      message: LOCAL_MESSAGES.git,
      fixes: [LOCAL_FIXES.git],
      queries: ["index", "ignored"]
    },
    {
      name: "no Git probe",
      write: async () => {
        await writeFile(target, canonical);
      },
      withoutProbe: true,
      status: "fail",
      message: LOCAL_MESSAGES.git,
      fixes: [LOCAL_FIXES.git],
      queries: []
    },
    {
      name: "malformed JSON",
      write: async () => {
        await writeFile(target, "{FORBIDDEN-LOCAL-JSON");
      },
      status: "fail",
      message: LOCAL_MESSAGES.invalidFile,
      fixes: [LOCAL_FIXES.correct],
      queries: ["index", "ignored"]
    },
    {
      name: "not an object",
      write: async () => {
        await writeFile(target, json(["FORBIDDEN-ARRAY"]));
      },
      status: "fail",
      message: LOCAL_MESSAGES.invalidFile,
      fixes: [LOCAL_FIXES.correct],
      queries: ["index", "ignored"]
    },
    {
      name: "oversized",
      write: async () => {
        await writeFile(
          target,
          canonical.trimEnd() +
            " ".repeat(LOCAL_CONFIG_LIMIT - canonical.length + 1) +
            "\n"
        );
      },
      status: "fail",
      message: LOCAL_MESSAGES.invalidFile,
      fixes: [LOCAL_FIXES.correct],
      queries: ["index", "ignored"]
    },
    {
      name: "wrong schema version",
      write: async () => {
        await writeFile(target, json({ schemaVersion: 2, models: {} }));
      },
      status: "fail",
      message: invalidAt("schemaVersion"),
      fixes: [LOCAL_FIXES.correct],
      queries: ["index", "ignored"]
    },
    {
      name: "out-of-pattern model",
      write: async () => {
        await writeFile(
          target,
          json({
            schemaVersion: 1,
            models: { reviewer: { ...triple, model: "FORBIDDEN local model" } }
          })
        );
      },
      status: "fail",
      message: invalidAt("models.reviewer.model"),
      fixes: [LOCAL_FIXES.correct],
      queries: ["index", "ignored"]
    },
    {
      name: "executable path",
      write: async () => {
        await writeFile(
          target,
          json({
            schemaVersion: 1,
            models: {
              planner: { ...triple, executable: "/FORBIDDEN-PATH/claude" }
            }
          })
        );
      },
      status: "fail",
      message: invalidAt("models.planner.executable"),
      fixes: [LOCAL_FIXES.correct],
      queries: ["index", "ignored"]
    },
    {
      name: "missing effort",
      write: async () => {
        await writeFile(
          target,
          json({
            schemaVersion: 1,
            models: {
              implementer: { executable: "codex", model: "gpt-6.1-sol" }
            }
          })
        );
      },
      status: "fail",
      message: invalidAt("models.implementer.effort"),
      fixes: [LOCAL_FIXES.correct],
      queries: ["index", "ignored"]
    },
    {
      name: "refused top-level key",
      write: async () => {
        await writeFile(
          target,
          json({
            schemaVersion: 1,
            models: {},
            FORBIDDENTOPKEY: "FORBIDDEN-TOP-VALUE"
          })
        );
      },
      status: "fail",
      message: refusedKey("at the top level"),
      fixes: [LOCAL_FIXES.correct],
      queries: ["index", "ignored"]
    },
    {
      name: "unsupported top-level key",
      write: async () => {
        await writeFile(
          target,
          json({ schemaVersion: 1, models: {}, "FORBIDDEN key!": 1 })
        );
      },
      status: "fail",
      message: refusedKey("at the top level"),
      fixes: [LOCAL_FIXES.correct],
      queries: ["index", "ignored"]
    },
    {
      name: "unknown role",
      write: async () => {
        await writeFile(
          target,
          json({ schemaVersion: 1, models: { FORBIDDENROLE: triple } })
        );
      },
      status: "fail",
      message: refusedKey("in models"),
      fixes: [LOCAL_FIXES.correct],
      queries: ["index", "ignored"]
    },
    {
      name: "timeout in a role",
      write: async () => {
        await writeFile(
          target,
          json({
            schemaVersion: 1,
            models: { reviewer: { ...triple, timeoutMs: 7654321 } }
          })
        );
      },
      status: "fail",
      message: refusedKey("in models.reviewer"),
      fixes: [LOCAL_FIXES.correct],
      queries: ["index", "ignored"]
    },
    {
      name: "unsupported role key",
      write: async () => {
        await writeFile(
          target,
          json({
            schemaVersion: 1,
            models: {
              reviewer: { ...triple, "FORBIDDEN key!": "FORBIDDEN-VALUE" }
            }
          })
        );
      },
      status: "fail",
      message: refusedKey("in models.reviewer"),
      fixes: [LOCAL_FIXES.correct],
      queries: ["index", "ignored"]
    },
    {
      name: "symbolic link",
      write: async () => {
        await writeFile(
          path.join(repository.root, "FORBIDDEN-LINK-TARGET.json"),
          canonical
        );
        await symlink("../FORBIDDEN-LINK-TARGET.json", target);
      },
      status: "fail",
      message: LOCAL_MESSAGES.unsafe,
      fixes: [LOCAL_FIXES.unsafe],
      queries: ["index", "ignored"]
    },
    {
      name: "dangling link",
      write: async () => {
        await symlink("FORBIDDEN-MISSING-TARGET", target);
      },
      status: "fail",
      message: LOCAL_MESSAGES.unsafe,
      fixes: [LOCAL_FIXES.unsafe],
      queries: ["index", "ignored"]
    },
    {
      name: "directory",
      write: async () => {
        await mkdir(target);
      },
      status: "fail",
      message: LOCAL_MESSAGES.unsafe,
      fixes: [LOCAL_FIXES.unsafe],
      queries: ["index", "ignored"]
    },
    {
      name: "FIFO",
      write: async () => {
        await execFileAsync("mkfifo", [target]);
      },
      status: "fail",
      message: LOCAL_MESSAGES.unsafe,
      fixes: [LOCAL_FIXES.unsafe],
      queries: ["index", "ignored"]
    },
    ...(process.getuid?.() === 0
      ? []
      : [
          {
            name: "unreadable",
            write: async () => {
              await writeFile(target, canonical);
              await chmod(target, 0o000);
            },
            readable: false as const,
            status: "fail" as const,
            message: LOCAL_MESSAGES.unreadable,
            fixes: [LOCAL_FIXES.correct],
            queries: ["index" as const, "ignored" as const]
          }
        ])
  ];
  try {
    await writeConfig(repository.root, reviewerOnlyClaudeConfig());
    const root = path.resolve(repository.root);
    for (const item of cases)
      await t.test(item.name, async () => {
        try {
          await item.write();
          const recorded = recordingProbe(item.answers);
          const before =
            item.readable === false
              ? null
              : await snapshotTree(repository.root);
          const report = await inspectDoctor(
            repository.root,
            dependencies(
              item.withoutProbe === true
                ? {}
                : { localConfigGitState: recorded.probe }
            )
          );
          assert.deepEqual(
            report.checks.map((entry) => entry.id),
            CHECK_ORDER
          );
          assert.deepEqual(findCheck(report, "config.local"), {
            id: "config.local",
            category: "config",
            status: item.status,
            message: item.message,
            fixes: item.fixes,
            roles: []
          });
          assert.deepEqual(
            recorded.calls,
            item.queries.map((query) => `${query} ${root} ${LOCAL_CONFIG_FILE}`)
          );
          if (item.status === "pass") {
            assert.equal(report.ready, true);
            assert.deepEqual(report.models[2], {
              role: "reviewer",
              vendor: "claude",
              model: "claude-sonnet-5",
              effort: "high",
              source: "local"
            });
          } else {
            assert.equal(report.ready, false);
            assert.deepEqual(report.models, []);
            for (const [id, message] of Object.entries(LOCAL_SKIPS)) {
              assert.equal(findCheck(report, id).status, "skipped");
              assert.equal(findCheck(report, id).message, message);
            }
          }
          const output = doctorOutput(report);
          assert.doesNotMatch(output, /FORBIDDEN|7654321/);
          assert.equal(output.includes(repository.root), false);
          if (before !== null)
            assert.deepEqual(await snapshotTree(repository.root), before);
        } finally {
          if (item.readable === false) await chmod(target, 0o600);
          await rm(target, { recursive: true, force: true });
        }
      });
  } finally {
    await repository.dispose();
  }
});

test("a symbolic link or file at .banzai/ fails config.local even without a local file, asking Git nothing", async () => {
  const repository = await temporaryRoot();
  const external = await temporaryRoot();
  try {
    await writeConfig(external.root, reviewerOnlyClaudeConfig());
    const local = path.join(repository.root, ".banzai");
    await symlink(path.join(external.root, ".banzai"), local);
    for (const shape of ["symbolic link", "regular file"]) {
      const recorded = recordingProbe();
      const before = await snapshotTree(repository.root);
      const report = await inspectDoctor(
        repository.root,
        dependencies({ localConfigGitState: recorded.probe })
      );
      assert.deepEqual(
        findCheck(report, "config.local"),
        {
          id: "config.local",
          category: "config",
          status: "fail",
          message: LOCAL_MESSAGES.unsafe,
          fixes: [LOCAL_FIXES.unsafe],
          roles: []
        },
        shape
      );
      assert.deepEqual(recorded.calls, [], shape);
      assert.deepEqual(report.models, []);
      assert.equal(report.ready, false);
      assert.deepEqual(await snapshotTree(repository.root), before);
      await rm(local);
      await writeFile(local, "not a directory\n");
    }
  } finally {
    await repository.dispose();
    await external.dispose();
  }
});

test("role checks read the effective configuration and are skipped while config.local fails", async () => {
  const repository = await temporaryRoot();
  const plugin = await instructionPluginFixture();
  const audits: string[] = [];
  const recorded = recordingProbe();
  const inspect = async (executableCalls: string[] = []) =>
    await inspectDoctor(
      repository.root,
      dependencies({
        unavailable: ["claude"],
        executableCalls,
        localConfigGitState: recorded.probe,
        async inspectClaudePermissions(input) {
          audits.push(JSON.stringify(input.demand));
          return {
            demand: input.demand,
            sources: ["project"],
            trust: "trusted",
            tools: [],
            repositoryRulesIgnored: false,
            blocking: [],
            advisories: []
          };
        }
      })
    );
  const roleVendors = (report: DoctorReport) =>
    findCheck(report, "claude.instructions").roles.map((role) => [
      role.role,
      role.vendor,
      role.state
    ]);
  const claudeReviewer = {
    executable: "claude",
    model: "claude-opus-5-5",
    effort: "xhigh"
  } as const;
  try {
    const committed = substantiveConfig("custom");
    for (const role of ["planner", "implementer", "reviewer"] as const) {
      committed.models[role].executable = "codex";
      committed.models[role].model = "gpt-6.1-sol";
    }
    committed.claudeEnvironment = {
      mode: "scoped",
      pluginDirectory: plugin.directory
    };
    await writeConfig(repository.root, committed);

    const shared = await inspect();
    assert.deepEqual(roleVendors(shared), [
      ["planner", "codex", "not_applicable"],
      ["implementer", "codex", "not_applicable"],
      ["reviewer", "codex", "not_applicable"]
    ]);
    assert.equal(findCheck(shared, "executables.models").status, "pass");
    assert.equal(findCheck(shared, "claude.permissions").status, "skipped");
    assert.deepEqual(audits, []);

    // A local Claude reviewer over the committed Codex reviewer counts.
    await writeLocalModels(repository.root, { reviewer: claudeReviewer });
    const executableCalls: string[] = [];
    const reviewer = await inspect(executableCalls);
    assert.equal(findCheck(reviewer, "config.local").status, "pass");
    assert.deepEqual(roleVendors(reviewer), [
      ["planner", "codex", "not_applicable"],
      ["implementer", "codex", "not_applicable"],
      ["reviewer", "claude", "verified"]
    ]);
    assert.equal(findCheck(reviewer, "claude.instructions").status, "pass");
    assert.deepEqual(findCheck(reviewer, "executables.models"), {
      id: "executables.models",
      category: "executables",
      status: "fail",
      message: "1 of 2 configured model executables are unavailable.",
      fixes: [],
      roles: []
    });
    assert.ok(executableCalls.includes("claude"));
    assert.ok(executableCalls.includes("codex"));
    // A Claude reviewer depends on no permission rule (ADR-0045).
    assert.equal(findCheck(reviewer, "claude.permissions").status, "skipped");
    assert.deepEqual(reviewer.models[2], {
      role: "reviewer",
      vendor: "claude",
      model: "claude-opus-5-5",
      effort: "xhigh",
      source: "local"
    });
    assert.deepEqual(
      reviewer.models.map((model) => model.source),
      ["committed", "committed", "local"]
    );
    // The environment check keeps the committed values.
    assert.equal(findCheck(reviewer, "claude.environment").status, "pass");

    // A local Claude implementer makes the permission audit run.
    await writeLocalModels(repository.root, {
      implementer: claudeReviewer,
      reviewer: claudeReviewer
    });
    const building = await inspect();
    assert.equal(findCheck(building, "claude.permissions").status, "pass");
    assert.deepEqual(audits, [
      JSON.stringify({ fileWrites: true, shellCommands: true })
    ]);
    assert.deepEqual(roleVendors(building)[1]?.slice(0, 2), [
      "implementer",
      "claude"
    ]);

    // While config.local fails, all three skip and models is empty.
    audits.length = 0;
    await writeFile(
      path.join(repository.root, LOCAL_CONFIG_FILE),
      `${JSON.stringify({
        schemaVersion: 1,
        models: { implementer: claudeReviewer, reviewer: claudeReviewer },
        FORBIDDENKEY: true
      })}\n`
    );
    const failedCalls: string[] = [];
    const failed = await inspect(failedCalls);
    assert.equal(findCheck(failed, "config.local").status, "fail");
    for (const [id, message] of Object.entries(LOCAL_SKIPS)) {
      assert.deepEqual(findCheck(failed, id), {
        id,
        category: id === "executables.models" ? "executables" : "config",
        status: "skipped",
        message,
        fixes: [],
        roles: []
      });
    }
    assert.deepEqual(audits, []);
    assert.equal(failedCalls.includes("claude"), false);
    assert.equal(failedCalls.includes("codex"), false);
    assert.deepEqual(failed.models, []);
    assert.equal(failed.ready, false);
    assert.equal(findCheck(failed, "claude.environment").status, "pass");
    assert.match(renderDoctorText(failed), /\nModels: unavailable\nChecks:\n/);
    assert.doesNotMatch(doctorOutput(failed), /FORBIDDEN/);
  } finally {
    await plugin.dispose();
    await repository.dispose();
  }
});

test("doctor discloses only bounded model fields and never local keys or values or other committed values", async () => {
  const repository = await temporaryRoot();
  try {
    const committed = substantiveConfig("custom");
    committed.models.planner.executable = "/FORBIDDEN-EXEC-PATH/codex";
    committed.models.planner.model = "FORBIDDEN committed model";
    committed.models.planner.timeoutMs = 7654321;
    committed.models.implementer.executable = "FORBIDDEN-OTHER-EXEC";
    committed.models.implementer.model = "gpt-6.1-sol";
    committed.models.implementer.effort = "medium";
    committed.models.reviewer.model = "FORBIDDEN\u001b[31m";
    await writeConfig(repository.root, committed);
    const recorded = recordingProbe();
    const inspect = async () =>
      await inspectDoctor(
        repository.root,
        dependencies({ localConfigGitState: recorded.probe })
      );
    const assertPrivate = (report: DoctorReport) => {
      const output = doctorOutput(report);
      assert.doesNotMatch(output, /FORBIDDEN|7654321|\u001b/);
      assert.equal(output.includes(repository.root), false);
    };

    const shared = await inspect();
    const sharedModels = [
      {
        role: "planner",
        vendor: "codex",
        model: null,
        effort: "xhigh",
        source: "committed"
      },
      {
        role: "implementer",
        vendor: null,
        model: "gpt-6.1-sol",
        effort: "medium",
        source: "committed"
      },
      {
        role: "reviewer",
        vendor: "claude",
        model: null,
        effort: "xhigh",
        source: "committed"
      }
    ];
    assert.deepEqual(shared.models, sharedModels);
    assert.match(
      renderDoctorText(shared),
      /\nModels:\n {2}planner: codex unlisted effort=xhigh \(committed\)\n {2}implementer: other gpt-6\.1-sol effort=medium \(committed\)\n {2}reviewer: claude unlisted effort=xhigh \(committed\)\n/
    );
    assertPrivate(shared);

    // A valid local triple is disclosed under the same rules, with its source.
    await writeLocalModels(repository.root, {
      reviewer: { executable: "codex", model: "gpt-6.1-sol", effort: "low" }
    });
    const local = await inspect();
    assert.deepEqual(local.models, [
      ...sharedModels.slice(0, 2),
      {
        role: "reviewer",
        vendor: "codex",
        model: "gpt-6.1-sol",
        effort: "low",
        source: "local"
      }
    ]);
    assertPrivate(local);

    const triple = {
      executable: "claude",
      model: "claude-opus-5-5",
      effort: "xhigh"
    };
    for (const document of [
      { schemaVersion: 1, models: {}, FORBIDDENTOPKEY: "FORBIDDEN-VALUE" },
      {
        schemaVersion: 1,
        models: { reviewer: { ...triple, FORBIDDENFIELD: "FORBIDDEN-VALUE" } }
      },
      { schemaVersion: 1, models: { FORBIDDENROLE: triple } },
      {
        schemaVersion: 1,
        models: { reviewer: { ...triple, model: "FORBIDDEN MODEL VALUE" } }
      },
      {
        schemaVersion: 1,
        models: { reviewer: { ...triple, effort: "FORBIDDEN-EFFORT" } }
      },
      {
        schemaVersion: 1,
        models: { reviewer: { ...triple, executable: "FORBIDDEN-EXECUTABLE" } }
      },
      { schemaVersion: "FORBIDDEN-VERSION", models: {} }
    ]) {
      await writeFile(
        path.join(repository.root, LOCAL_CONFIG_FILE),
        `${JSON.stringify(document)}\n`
      );
      const refused = await inspect();
      assert.equal(findCheck(refused, "config.local").status, "fail");
      assert.deepEqual(refused.models, []);
      assertPrivate(refused);
    }
  } finally {
    await repository.dispose();
  }
});

async function realGitExecutable(): Promise<string> {
  for (const entry of (process.env.PATH ?? "").split(path.delimiter)) {
    if (entry.length === 0) continue;
    const candidate = path.join(entry, "git");
    try {
      await access(candidate, constants.X_OK);
      if ((await stat(candidate)).isFile()) return candidate;
    } catch {
      // Continue through PATH.
    }
  }
  throw new Error("git is not on PATH");
}

test("a real Git checkout answers only the two permitted queries, at the repository root with LC_ALL=C", async () => {
  const repository = await createTestRepository({ ignoreLocalConfig: true });
  const shims = await mkdtemp(path.join(tmpdir(), "banzai-doctor-git-shim-"));
  const log = path.join(shims, "git.log");
  const realGit = await realGitExecutable();
  await writeFile(
    path.join(shims, "git"),
    `#!/bin/sh\nprintf '%s|%s|%s\\n' "$(pwd -P)" "\${LC_ALL-}" "$*" >> '${log}'\nexec '${realGit}' "$@"\n`,
    { mode: 0o755 }
  );
  const previous = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR
  };
  const restore = () => {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) Reflect.deleteProperty(process.env, name);
      else process.env[name] = value;
    }
  };
  const root = await realpath(repository.root);
  const index = `${root}|C|ls-files --error-unmatch -- ${LOCAL_CONFIG_FILE}`;
  const ignore = `${root}|C|check-ignore -q -- ${LOCAL_CONFIG_FILE}`;
  const inspect = async (
    run: (repoRoot: string) => Promise<DoctorReport> = async (repoRoot) =>
      await inspectDoctor(
        repoRoot,
        dependencies({ localConfigGitState: { isPathInIndex, isPathIgnored } })
      )
  ): Promise<{ report: DoctorReport; queries: string[] }> => {
    await writeFile(log, "");
    const before = await snapshotTree(repository.root);
    process.env.PATH = `${shims}${path.delimiter}${previous.PATH ?? ""}`;
    // The CLI composition reads Claude user settings from this environment.
    process.env.HOME = ABSENT_HOME;
    delete process.env.CLAUDE_CONFIG_DIR;
    let report: DoctorReport;
    try {
      report = await run(repository.root);
    } finally {
      restore();
    }
    assert.deepEqual(await snapshotTree(repository.root), before);
    const queries = (await readFile(log, "utf8"))
      .split("\n")
      .filter((line) => line.length > 0);
    return { report, queries };
  };
  try {
    const absent = await inspect();
    assert.equal(findCheck(absent.report, "config.local").status, "pass");
    assert.deepEqual(absent.queries, []);

    await writeLocalModels(repository.root, LOCAL_REVIEWER);
    const valid = await inspect();
    assert.deepEqual(
      findCheck(valid.report, "config.local").message,
      LOCAL_MESSAGES.valid
    );
    assert.deepEqual(valid.queries, [index, ignore]);
    assert.equal(valid.report.models[2]?.source, "local");

    const gitignore = path.join(repository.root, ".gitignore");
    const ignoreText = await readFile(gitignore, "utf8");
    await writeFile(
      gitignore,
      ignoreText.replace(`${LOCAL_CONFIG_IGNORE_LINE}\n`, "")
    );
    const unignored = await inspect();
    assert.equal(
      findCheck(unignored.report, "config.local").message,
      LOCAL_MESSAGES.notIgnored
    );
    assert.deepEqual(unignored.queries, [index, ignore]);

    await writeFile(gitignore, ignoreText);
    await execFileAsync(realGit, ["add", "-f", "--", LOCAL_CONFIG_FILE], {
      cwd: repository.root
    });
    const tracked = await inspect();
    assert.equal(
      findCheck(tracked.report, "config.local").message,
      LOCAL_MESSAGES.tracked
    );
    assert.deepEqual(tracked.queries, [index]);

    // The CLI's own composition wires the same two queries.
    const composed = await inspect(
      doctorInspection({ isPathInIndex, isPathIgnored })
    );
    assert.equal(
      findCheck(composed.report, "config.local").message,
      LOCAL_MESSAGES.tracked
    );
    assert.deepEqual(composed.queries, [index]);
  } finally {
    restore();
    await rm(shims, { recursive: true, force: true });
    await repository.dispose();
  }
});
