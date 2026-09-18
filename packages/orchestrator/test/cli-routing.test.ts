import { RunStore } from "../src/store.js";
import assert from "node:assert/strict";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { resolveCliMode, stripGlobalFlags } from "../src/cli-routing.js";
import { CONFIG_FILE, DEFAULT_CONFIG } from "../src/config.js";
import { workspaceDigest } from "../src/git.js";
import {
  CONTRACT_VERSION,
  type ReviewResult,
  type RunState,
  type VerificationProfile
} from "../src/types.js";
import {
  createTestRepository,
  evaluationStateFixture,
  monochromeEnv,
  snapshotTree
} from "./helpers.js";

import { writeAdoptedGuidance } from "./adoption-fixtures.js";

const COMMITTED_CLI = path.join(process.cwd(), "dist", "banzai.mjs");

test("committed interactive CLI explains Git and first-task HEAD prerequisites before task input", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "banzai-git-prerequisites-"));
  try {
    const preload = path.join(root, "terminal-host.mjs");
    await writeFile(
      preload,
      `for (const stream of [process.stdin, process.stdout, process.stderr]) {
  Object.defineProperty(stream, "isTTY", { value: true });
}\n`
    );
    for (const initialized of [false, true]) {
      const cwd = path.join(root, initialized ? "unborn" : "no-git");
      await mkdir(cwd);
      if (initialized) {
        const init = spawnSync("git", ["init", "-q"], {
          cwd,
          encoding: "utf8"
        });
        assert.equal(init.status, 0, init.stderr);
        await mkdir(path.join(cwd, ".banzai"));
        await writeFile(
          path.join(cwd, ".banzai/config.json"),
          JSON.stringify(DEFAULT_CONFIG)
        );
        await writeAdoptedGuidance(cwd);
      }
      const before = await snapshotTree(cwd);
      for (const args of [[], ["interactive"]]) {
        const result = spawnSync(
          process.execPath,
          ["--import", preload, COMMITTED_CLI, ...args],
          {
            cwd,
            encoding: "utf8",
            timeout: 10_000,
            env: monochromeEnv({ LC_ALL: "uk_UA.UTF-8" })
          }
        );
        assert.equal(result.status, 1, result.stderr || String(result.error));
        assert.equal(result.stdout, "");
        assert.match(
          result.stderr,
          initialized
            ? /^\[GIT_INITIAL_COMMIT_REQUIRED\].*git commit --allow-empty --only -m "Initial commit"/
            : /^\[GIT_REPOSITORY_REQUIRED\].*git init/
        );
        assert.doesNotMatch(result.stderr, /GIT_FAILED|rev-parse|fatal:/);
        assert.deepEqual(await snapshotTree(cwd), before);
      }
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function runCommittedDoctor(
  cwd: string,
  args: string[],
  env: NodeJS.ProcessEnv = process.env
): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [COMMITTED_CLI, "doctor", ...args], {
    cwd,
    env,
    encoding: "utf8"
  });
}

function runCommittedStatus(
  cwd: string,
  args: string[] = []
): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [COMMITTED_CLI, "status", ...args], {
    cwd,
    encoding: "utf8"
  });
}

async function writeDoctorConfig(
  root: string,
  profiles: VerificationProfile[]
): Promise<void> {
  const config = structuredClone(DEFAULT_CONFIG);
  config.models.planner.executable = process.execPath;
  config.models.implementer.executable = process.execPath;
  config.models.reviewer.executable = process.execPath;
  config.verification.profiles = profiles;
  await mkdir(path.join(root, ".banzai"), { recursive: true });
  await writeFile(
    path.join(root, CONFIG_FILE),
    `${JSON.stringify(config, null, 2)}\n`,
    "utf8"
  );
}

function verificationProfile(
  id: string,
  projectType: VerificationProfile["projectType"],
  command: string,
  args: string[] = []
): VerificationProfile {
  return {
    id,
    projectType,
    commands: [{ name: `${id} check`, command, args, timeoutMs: 1_000 }]
  };
}

function checkMessage(document: unknown, id: string): string {
  const report = document as {
    checks: { id: string; message: string }[];
  };
  return report.checks.find((item) => item.id === id)?.message ?? "";
}

function checkStatus(document: unknown, id: string): string {
  const report = document as {
    checks: { id: string; status: string }[];
  };
  return report.checks.find((item) => item.id === id)?.status ?? "";
}

async function writeTerminalRunState(
  root: string,
  repoRoot: string
): Promise<void> {
  const runRoot = path.join(root, ".banzai", "runs", "safe-run");
  await mkdir(runRoot, { recursive: true });
  await writeFile(
    path.join(root, ".banzai", "active-run.json"),
    `${JSON.stringify({ schemaVersion: 1, runId: "safe-run" }, null, 2)}\n`,
    "utf8"
  );
  await writeFile(
    path.join(runRoot, "state.json"),
    `${JSON.stringify(
      {
        schemaVersion: 2,
        runId: "safe-run",
        repoRoot,
        status: "done"
      },
      null,
      2
    )}\n`,
    "utf8"
  );
}

async function writeTriagedCompletionState(
  root: string,
  status: RunState["status"] = "done"
): Promise<void> {
  const runId = "triaged-run";
  const runRoot = path.join(root, ".banzai", "runs", runId);
  const reviewRoot = path.join(runRoot, "reviews");
  const timestamp = "2026-08-12T12:00:00.000Z";
  const review: ReviewResult = {
    contractVersion: CONTRACT_VERSION,
    verdict: "changes_requested",
    summary: "Two findings were triaged.",
    findings: [
      {
        id: "R1-F1",
        severity: "should_fix",
        category: "correctness",
        summary: "Rejected suggestion.",
        evidence: [{ path: "base.txt", line: 1, detail: "Observed here." }],
        violates: ["FR1"],
        reproduction: null,
        fixAcceptance: "Change the behavior.",
        confidence: "high"
      },
      {
        id: "R1-F2",
        severity: "nit",
        category: "documentation",
        summary: "Deferred suggestion.",
        evidence: [{ path: "base.txt", line: 1, detail: "Observed here." }],
        violates: [],
        reproduction: null,
        fixAcceptance: "Update the wording.",
        confidence: "medium"
      }
    ],
    reviewedFindingIds: [],
    deferredCoverage: []
  };
  const triage = {
    reviewIteration: 1,
    decidedAt: timestamp,
    decidedBy: "human",
    items: [
      { findingId: "R1-F1", disposition: "rejected" as const, note: null },
      { findingId: "R1-F2", disposition: "deferred" as const, note: null }
    ]
  };
  const digest = await workspaceDigest(root, { baseline: [] });
  const state: RunState = {
    schemaVersion: 3,
    contractVersion: CONTRACT_VERSION,
    runId,
    slug: "triaged-example",
    request: "Implement the example.",
    repoRoot: root,
    status,
    createdAt: timestamp,
    updatedAt: timestamp,
    baseCommit: "a".repeat(40),
    baseline: [],
    planArtifacts:
      status === "needs_plan_approval"
        ? {
            description: "documentation/features/example/description.md",
            plan: "documentation/development-plans/example/plan.md",
            adrs: [],
            implementationReport: null,
            testReport: null
          }
        : null,
    planApproval: null,
    adrDecisions: [],
    sessions: { planner: null, implementer: null, reviewer: null },
    pendingReviewRotationReason: null,
    reviewIteration: 1,
    latestReview: {
      iteration: 1,
      resultPath: "reviews/review-1.json",
      workspaceDigest: digest,
      verdict: "changes_requested",
      sessionMode: "fresh",
      mode: "full",
      rotationReason: "primary-review"
    },
    triage,
    triageHistory: [triage],
    fixCycle: 0,
    workspaceDigest: digest,
    verification: [],
    metrics: {
      completedAttemptIds: [],
      attempts: {
        plan: 1,
        implementation: 1,
        fix: 0,
        review: 1,
        verification: 1
      },
      modelDurationMs: 0,
      usage: {
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        costUsd: null
      },
      reviewFindingCount: 2,
      sessions: { fresh: 3, resumed: 0 },
      reviews: { full: 1, delta: 0, rotations: 0 },
      triage: { accepted: 0, rejected: 1, deferred: 1 }
    },
    activeAttempt: null,
    activeProcess: null,
    blockedFrom: null,
    blockReason: null
  };

  await mkdir(reviewRoot, { recursive: true });
  await writeFile(
    path.join(root, ".banzai", "active-run.json"),
    `${JSON.stringify({ schemaVersion: 1, runId }, null, 2)}\n`,
    "utf8"
  );
  await writeFile(
    path.join(reviewRoot, "review-1.json"),
    `${JSON.stringify(review, null, 2)}\n`,
    "utf8"
  );
  await writeFile(
    path.join(runRoot, "state.json"),
    `${JSON.stringify(state, null, 2)}\n`,
    "utf8"
  );
}

test("committed CLI attention reaches human commands and leaves machine output clean", async () => {
  const repository = await createTestRepository();
  try {
    await writeTriagedCompletionState(repository.root, "needs_plan_approval");
    const preload = path.join(repository.root, "attention-host.mjs");
    // Model the host and elapsed time only in the child process. Resume stops
    // at the existing gate, so this fixture never invokes a model or waits.
    await writeFile(
      preload,
      `Object.defineProperty(process, "platform", { value: "darwin" });
for (const stream of [process.stdin, process.stdout, process.stderr]) {
  Object.defineProperty(stream, "isTTY", {
    value: process.env.BANZAI_TEST_TTY === "1"
  });
}
let tick = 0;
Object.defineProperty(performance, "now", { value: () => (tick += 30_000) });
`
    );
    const statePath = path.join(
      repository.root,
      ".banzai/runs/triaged-run/state.json"
    );
    const before = await readFile(statePath, "utf8");
    const cases = [
      { args: ["resume"], tty: true, signals: 1 },
      { args: ["resume"], tty: false, signals: 0 },
      { args: ["resume"], tty: true, off: true, signals: 0 },
      { args: ["resume", "--json"], tty: true, signals: 0 },
      { args: ["status", "--json"], tty: true, json: true, signals: 0 },
      { args: ["control", "status"], tty: true, json: true, signals: 0 }
    ];
    for (const scenario of cases) {
      const result = spawnSync(
        process.execPath,
        ["--import", preload, COMMITTED_CLI, ...scenario.args, "--quiet"],
        {
          cwd: repository.root,
          encoding: "utf8",
          timeout: 10_000,
          env: monochromeEnv({
            TERM_PROGRAM: "iTerm.app",
            TERM: "xterm-256color",
            CI: "",
            TMUX: "",
            STY: "",
            BANZAI_ATTENTION: scenario.off ? "off" : "",
            BANZAI_TEST_TTY: scenario.tty ? "1" : "0"
          })
        }
      );
      assert.equal(result.status, 0, result.stderr || String(result.error));
      assert.equal(
        result.stderr.split("\x1b]1337;RequestAttention=once\x07").length - 1,
        scenario.signals,
        JSON.stringify(scenario)
      );
      assert.ok(!result.stdout.includes("\x07"));
      if (scenario.json) {
        assert.ok(JSON.parse(result.stdout));
        assert.equal(result.stderr, "");
      }
    }
    assert.equal(await readFile(statePath, "utf8"), before);
  } finally {
    await repository.dispose();
  }
});

test("bare banzai launches interactive mode only with input and output TTYs", () => {
  assert.equal(resolveCliMode([], true, true), "interactive");
  assert.equal(resolveCliMode([], false, true), "help");
  assert.equal(resolveCliMode([], true, false), "help");
});

test("help, explicit interactive mode, and existing commands route distinctly", () => {
  assert.equal(resolveCliMode(["help"], true, true), "help");
  assert.equal(resolveCliMode(["--help"], true, true), "help");
  assert.equal(resolveCliMode(["run", "--help"], true, true), "help");
  assert.equal(resolveCliMode(["interactive"], true, true), "interactive");
  assert.equal(resolveCliMode(["interactive"], false, true), "tty_required");
  assert.equal(resolveCliMode(["status"], true, true), "command");
  assert.equal(resolveCliMode(["doctor"], false, false), "command");
  assert.equal(resolveCliMode(["doctor", "--json"], false, false), "command");
  assert.equal(resolveCliMode(["doctor", "--help"], false, false), "command");
  assert.equal(
    resolveCliMode(["doctor", "--json", "--help"], false, false),
    "command"
  );
  assert.equal(resolveCliMode(["eval", "export"], false, false), "command");
  assert.equal(
    resolveCliMode(["eval", "export", "--help"], false, false),
    "help"
  );
  assert.equal(
    resolveCliMode(["compatibility", "live", "--confirm-live"], false, false),
    "command"
  );
  assert.equal(
    resolveCliMode(["compatibility", "--help"], false, false),
    "command"
  );
  assert.equal(resolveCliMode(["control", "--help"], false, false), "command");
});

test("committed status renders human-triaged completion without changing JSON", async () => {
  const repository = await createTestRepository();
  try {
    await writeTriagedCompletionState(repository.root);

    const human = runCommittedStatus(repository.root);
    assert.equal(human.status, 0, human.stderr);
    assert.equal(human.stderr, "");
    assert.match(human.stdout, /Status: done/);
    assert.match(human.stdout, /Plan tasks: legacy \(legacy\)/);
    assert.match(human.stdout, /Review: changes_requested \(iteration 1\)/);
    assert.match(
      human.stdout,
      /Completion: human triage \(accepted=0, rejected=1, deferred=1\)/
    );
    assert.doesNotMatch(human.stdout, /Review: pass/);
    assert.doesNotMatch(human.stdout, /Next review:/);

    const json = runCommittedStatus(repository.root, ["--json"]);
    assert.equal(json.status, 0, json.stderr);
    assert.equal(json.stderr, "");
    const status = JSON.parse(json.stdout) as {
      state: RunState;
      latestReview: ReviewResult;
      nextAction: string | null;
      taskCompletion: {
        state: string;
        source: string;
        completed: number | null;
      };
    };
    assert.equal(status.state.status, "done");
    assert.equal(status.latestReview.verdict, "changes_requested");
    assert.deepEqual(status.state.metrics.triage, {
      accepted: 0,
      rejected: 1,
      deferred: 1
    });
    assert.equal(status.nextAction, null);
    assert.deepEqual(status.taskCompletion, {
      state: "legacy",
      source: "legacy",
      completed: null,
      total: null,
      diagnostics: [
        {
          code: "PLAN_TASK_COMPLETION_LEGACY",
          taskId: null,
          message:
            "Run predates the canonical task-completion ledger; exact completion is unknown."
        }
      ]
    });
    assert.equal(json.stdout.includes('"completion"'), false);
  } finally {
    await repository.dispose();
  }
});

test("committed doctor CLI rejects invalid options before Git discovery", async () => {
  const outsideGit = await mkdtemp(
    path.join(tmpdir(), "banzai-doctor-invalid-options-")
  );
  try {
    // The parser unit matrix covers every invalid shape. These built-CLI cases
    // exercise the critical precedence where Git discovery itself must fail.
    for (const args of [["--help"], ["--json", "--help"]]) {
      const result = runCommittedDoctor(outsideGit, args);
      assert.equal(result.status, 1);
      assert.equal(result.stdout, "");
      assert.match(result.stderr, /^\[INVALID_DOCTOR_OPTION\] /);
    }

    for (const args of [[], ["--json"]]) {
      const result = runCommittedDoctor(outsideGit, args);
      assert.equal(result.status, 1);
      assert.equal(result.stdout, "");
      assert.match(result.stderr, /^\[GIT_FAILED\] /);
    }
  } finally {
    await rm(outsideGit, { recursive: true, force: true });
  }
});

test("committed doctor does not require missing hygiene-only or unused profiles", async () => {
  const repository = await createTestRepository();
  try {
    await writeFile(path.join(repository.root, "package.json"), "{}\n", "utf8");
    const hygieneCommand = structuredClone(
      DEFAULT_CONFIG.verification.profiles[0]?.commands[0]
    );
    assert.ok(hygieneCommand);
    const scenarios = [
      {
        profiles: [
          verificationProfile("repository", "repository", "git", [
            "diff",
            "--check"
          ])
        ],
        profileMessage:
          "Missing profiles for: node; hygiene-only detected types: none; covered: none; unused profiles: none.",
        substantiveMessage:
          "No substantive verification command is configured for detected project types or unused project profiles."
      },
      {
        profiles: [
          {
            id: "node",
            projectType: "node" as const,
            commands: [hygieneCommand]
          }
        ],
        profileMessage:
          "Missing profiles for: none; hygiene-only detected types: node; covered: none; unused profiles: none.",
        substantiveMessage:
          "No substantive verification command is configured for detected project types or unused project profiles."
      },
      {
        profiles: [
          verificationProfile("unused-rust", "rust", process.execPath)
        ],
        profileMessage:
          "Missing profiles for: node; hygiene-only detected types: none; covered: none; unused profiles: unused-rust.",
        substantiveMessage:
          "No substantive verification command is configured for detected project types; 1 substantive command is configured for unused project profiles."
      }
    ];
    const jsonOutputs: string[] = [];
    for (const scenario of scenarios) {
      await writeDoctorConfig(repository.root, scenario.profiles);
      const before = await snapshotTree(path.join(repository.root, ".banzai"));
      const jsonResult = runCommittedDoctor(repository.root, ["--json"]);
      const humanResult = runCommittedDoctor(repository.root, []);
      assert.equal(jsonResult.status, 0);
      assert.equal(jsonResult.stderr, "");
      assert.equal(humanResult.status, 0);
      assert.equal(humanResult.stderr, "");
      const report = JSON.parse(jsonResult.stdout) as unknown;
      assert.equal(checkStatus(report, "verification.task"), "pass");
      assert.doesNotMatch(humanResult.stdout, /Missing profiles for/);
      assert.deepEqual(
        await snapshotTree(path.join(repository.root, ".banzai")),
        before
      );
      jsonOutputs.push(jsonResult.stdout);
    }
    assert.equal(jsonOutputs[0], jsonOutputs[1]);
  } finally {
    await repository.dispose();
  }
});

test("committed doctor resolves PATH and persisted repository evidence independently of invocation cwd", async () => {
  const repository = await createTestRepository();
  const aliasPath = `${repository.root}-alias`;
  try {
    await writeFile(path.join(repository.root, "package.json"), "{}\n", "utf8");
    const nestedRoot = path.join(repository.root, "nested");
    const toolsRoot = path.join(repository.root, "tools");
    await mkdir(nestedRoot);
    await mkdir(toolsRoot);
    const relativeTool = path.join(toolsRoot, "verify-tool");
    await writeFile(relativeTool, "#!/bin/sh\nexit 0\n", "utf8");
    await chmod(relativeTool, 0o755);

    await writeDoctorConfig(repository.root, [
      verificationProfile("node", "node", "verify-tool")
    ]);
    const relativeBefore = await snapshotTree(
      path.join(repository.root, ".banzai")
    );
    const relativePathEnvironment = {
      ...process.env,
      PATH: `${process.env.PATH ?? ""}${path.delimiter}tools`
    };
    const relativeFromRoot = runCommittedDoctor(
      repository.root,
      ["--json"],
      relativePathEnvironment
    );
    const relativeFromNested = runCommittedDoctor(
      nestedRoot,
      ["--json"],
      relativePathEnvironment
    );
    assert.equal(relativeFromRoot.status, 0);
    assert.equal(relativeFromNested.status, 0);
    assert.equal(relativeFromRoot.stderr, "");
    assert.equal(relativeFromNested.stderr, "");
    assert.equal(relativeFromNested.stdout, relativeFromRoot.stdout);
    assert.equal(
      checkStatus(
        JSON.parse(relativeFromRoot.stdout) as unknown,
        "executables.verification"
      ),
      "pass"
    );
    assert.deepEqual(
      await snapshotTree(path.join(repository.root, ".banzai")),
      relativeBefore
    );

    const rootTool = path.join(repository.root, "root-tool");
    await writeFile(rootTool, "#!/bin/sh\nexit 0\n", "utf8");
    await chmod(rootTool, 0o755);
    await writeDoctorConfig(repository.root, [
      verificationProfile("node", "node", "root-tool")
    ]);
    const emptyBefore = await snapshotTree(
      path.join(repository.root, ".banzai")
    );
    const emptyPathEnvironment = {
      ...process.env,
      PATH: `${process.env.PATH ?? ""}${path.delimiter}`
    };
    const emptyFromRoot = runCommittedDoctor(
      repository.root,
      ["--json"],
      emptyPathEnvironment
    );
    const emptyFromNested = runCommittedDoctor(
      nestedRoot,
      ["--json"],
      emptyPathEnvironment
    );
    assert.equal(emptyFromRoot.status, 0);
    assert.equal(emptyFromNested.status, 0);
    assert.equal(emptyFromRoot.stderr, "");
    assert.equal(emptyFromNested.stderr, "");
    assert.equal(emptyFromNested.stdout, emptyFromRoot.stdout);
    assert.deepEqual(
      await snapshotTree(path.join(repository.root, ".banzai")),
      emptyBefore
    );

    await writeDoctorConfig(repository.root, [
      verificationProfile("node", "node", process.execPath)
    ]);
    for (const persistedRoot of [".", ""]) {
      await writeTerminalRunState(repository.root, persistedRoot);
      const before = await snapshotTree(path.join(repository.root, ".banzai"));
      const fromRoot = runCommittedDoctor(repository.root, ["--json"]);
      const fromNested = runCommittedDoctor(nestedRoot, ["--json"]);
      assert.equal(fromRoot.status, 1);
      assert.equal(fromNested.status, 1);
      assert.equal(fromRoot.stderr, "");
      assert.equal(fromNested.stderr, "");
      assert.equal(fromNested.stdout, fromRoot.stdout);
      assert.equal(
        checkStatus(JSON.parse(fromRoot.stdout) as unknown, "run.active"),
        "fail"
      );
      assert.deepEqual(
        await snapshotTree(path.join(repository.root, ".banzai")),
        before
      );
    }

    await symlink(repository.root, aliasPath);
    await writeTerminalRunState(repository.root, aliasPath);
    const before = await snapshotTree(path.join(repository.root, ".banzai"));
    const canonicalFromRoot = runCommittedDoctor(repository.root, ["--json"]);
    const canonicalFromNested = runCommittedDoctor(nestedRoot, ["--json"]);
    assert.equal(canonicalFromRoot.status, 0);
    assert.equal(canonicalFromNested.status, 0);
    assert.equal(canonicalFromRoot.stderr, "");
    assert.equal(canonicalFromNested.stderr, "");
    assert.equal(canonicalFromNested.stdout, canonicalFromRoot.stdout);
    assert.equal(
      checkStatus(
        JSON.parse(canonicalFromRoot.stdout) as unknown,
        "run.active"
      ),
      "pass"
    );
    assert.deepEqual(
      await snapshotTree(path.join(repository.root, ".banzai")),
      before
    );
  } finally {
    await rm(aliasPath, { force: true });
    await repository.dispose();
  }
});

test("committed doctor bounds Git discovery failures without raw output or paths", async () => {
  const ordinary = await mkdtemp(path.join(tmpdir(), "banzai-doctor-non-git-"));
  const malformed = await mkdtemp(
    path.join(tmpdir(), "banzai-doctor-malformed-git-")
  );
  const canaryPath = path.join(tmpdir(), "FORBIDDEN-ABSOLUTE-GITDIR-CANARY");
  try {
    await writeFile(
      path.join(malformed, ".git"),
      `gitdir: ${canaryPath}\n`,
      "utf8"
    );
    for (const root of [ordinary, malformed]) {
      const before = await snapshotTree(root);
      for (const args of [[], ["--json"]]) {
        const result = runCommittedDoctor(root, args);
        assert.equal(result.status, 1);
        assert.equal(result.stdout, "");
        assert.equal(
          result.stderr,
          "[GIT_FAILED] Doctor requires a readable Git checkout.\n"
        );
        assert.doesNotMatch(result.stderr, /fatal:/i);
        assert.equal(result.stderr.includes(canaryPath), false);
      }
      assert.deepEqual(await snapshotTree(root), before);
    }
  } finally {
    await rm(ordinary, { recursive: true, force: true });
    await rm(malformed, { recursive: true, force: true });
  }
});

test("committed doctor fails closed on unreadable project marker evidence", async () => {
  const unreadableMarker = await createTestRepository();
  try {
    await symlink(
      "package.json",
      path.join(unreadableMarker.root, "package.json")
    );
    await writeDoctorConfig(unreadableMarker.root, [
      verificationProfile("custom", "custom", process.execPath)
    ]);
    const before = await snapshotTree(unreadableMarker.root);
    const jsonResult = runCommittedDoctor(unreadableMarker.root, ["--json"]);
    const repeatedJsonResult = runCommittedDoctor(unreadableMarker.root, [
      "--json"
    ]);
    const humanResult = runCommittedDoctor(unreadableMarker.root, []);
    assert.equal(jsonResult.status, 1);
    assert.equal(jsonResult.stderr, "");
    assert.equal(repeatedJsonResult.stdout, jsonResult.stdout);
    assert.equal(humanResult.status, 1);
    assert.equal(humanResult.stderr, "");
    const report = JSON.parse(jsonResult.stdout) as {
      projectTypes: string[];
    };
    assert.deepEqual(report.projectTypes, []);
    assert.equal(checkStatus(report, "project.types"), "fail");
    assert.equal(
      checkMessage(report, "project.types"),
      "Project marker evidence is unreadable or invalid."
    );
    assert.equal(checkStatus(report, "verification.task"), "pass");
    assert.equal(
      humanResult.stdout.includes(
        "Project marker evidence is unreadable or invalid."
      ),
      true
    );
    assert.equal(
      humanResult.stdout.includes("Project types: unavailable"),
      true
    );
    assert.equal(jsonResult.stdout.includes(unreadableMarker.root), false);
    assert.deepEqual(await snapshotTree(unreadableMarker.root), before);
  } finally {
    await unreadableMarker.dispose();
  }
});

test("global flags are never mistaken for a command", () => {
  // `banzai --verbose` in a terminal must open the interactive session, not
  // fail as an unknown command; the flags are stripped before routing.
  assert.deepEqual(stripGlobalFlags(["--verbose"]), []);
  assert.deepEqual(stripGlobalFlags(["--quiet", "--metrics"]), []);
  assert.equal(
    resolveCliMode(stripGlobalFlags(["--verbose"]), true, true),
    "interactive"
  );
  assert.equal(
    resolveCliMode(stripGlobalFlags(["--quiet"]), false, false),
    "help"
  );
});

test("stripping global flags leaves every command contract intact", () => {
  assert.deepEqual(
    stripGlobalFlags(["run", "--slug", "x", "--request", "y", "--verbose"]),
    ["run", "--slug", "x", "--request", "y"]
  );
  // A value that happens to equal a flag name still belongs to its option, so
  // strip only bare occurrences and let the option parser see the rest.
  assert.deepEqual(stripGlobalFlags(["status", "--json"]), [
    "status",
    "--json"
  ]);
  assert.deepEqual(
    stripGlobalFlags(["triage", "--accept", "R1-F1", "--metrics", "--quiet"]),
    ["triage", "--accept", "R1-F1"]
  );
  assert.deepEqual(stripGlobalFlags([]), []);
});

test("cancellation: committed CLI supports no-TTY omission, exact validation, optional discovery and read-only reports", async () => {
  const repository = await createTestRepository();
  try {
    const store = new RunStore(repository.root);
    const state = evaluationStateFixture({
      schemaVersion: 3,
      status: "planning",
      extra: {
        runId: "cancel-cli",
        repoRoot: repository.root,
        adrDecisions: [],
        pendingHumanDecision: null,
        humanDecisions: [],
        planApproval: null
      }
    }) as unknown as RunState;
    await store.createRun(state);
    const invoke = (args: string[], cwd = repository.root) =>
      spawnSync(process.execPath, [COMMITTED_CLI, ...args], {
        cwd,
        encoding: "utf8",
        stdio: "pipe"
      });
    const before = await snapshotTree(repository.root);
    for (const args of [
      ["cancel", "--reason", "FORBIDDEN"],
      ["cancel", "--reason"],
      ["cancel", "--reason", "other", "--reason", "other"]
    ]) {
      const invalid = invoke(args);
      assert.notEqual(invalid.status, 0);
      assert.ok(!invalid.stderr.includes("FORBIDDEN"));
    }
    assert.deepEqual(await snapshotTree(repository.root), before);
    const external = await mkdtemp(
      path.join(tmpdir(), "banzai-cancellation-cli-empty-")
    );
    try {
      assert.equal(invoke(["cancel", "--help"], external).status, 0);
      const capabilities = invoke(
        ["control", "capabilities", "--cancellation"],
        external
      );
      assert.equal(capabilities.status, 0);
      assert.equal(
        (JSON.parse(capabilities.stdout) as { schema: string }).schema,
        "banzai-cancellation-capabilities/v1"
      );
      assert.deepEqual(await snapshotTree(external), []);
    } finally {
      await rm(external, { recursive: true, force: true });
    }
    const cancelled = invoke(["cancel"]);
    assert.equal(cancelled.status, 0, cancelled.stderr);
    assert.match(cancelled.stdout, /Run cancelled\./);
    assert.match(cancelled.stdout, /Run: cancel-cli/);
    const events = await readFile(
      path.join(store.runDirectory("cancel-cli"), "events.jsonl"),
      "utf8"
    );
    assert.match(events, /"provenance":"cli_omitted"/);
    const terminal = await snapshotTree(repository.root);
    const json = invoke(["eval", "cancellations", "--json"]);
    const md = invoke(["eval", "cancellations"]);
    assert.equal(json.status, 0, json.stderr);
    assert.equal(md.status, 0, md.stderr);
    assert.equal(
      (JSON.parse(json.stdout) as { summary: { cancelledRunCount: number } })
        .summary.cancelledRunCount,
      1
    );
    assert.match(md.stdout, /Confirmed cancelled: 1/);
    assert.ok(!json.stdout.includes("cancel-cli"));
    assert.ok(!json.stdout.includes("FORBIDDEN"));
    assert.deepEqual(await snapshotTree(repository.root), terminal);
  } finally {
    await repository.dispose();
  }
});
