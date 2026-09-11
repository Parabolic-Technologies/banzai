import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { BanzaiError } from "../src/errors.js";
import {
  executeLiveCompatibility,
  parseLiveCompatibilityArgs
} from "../src/live-compatibility-cli.js";
import {
  normalizedCliVersion,
  runLiveCompatibility,
  validateLiveCompatibilityPolicy
} from "../src/live-compatibility.js";
import { runProcess } from "../src/process.js";
import type {
  ProcessResult,
  ProcessRunner,
  ProcessSpec
} from "../src/types.js";

const REVIEW_RESULT = {
  contractVersion: "1.0.0",
  verdict: "pass",
  summary: "Live compatibility permission probe completed.",
  findings: [],
  reviewedFindingIds: [],
  deferredCoverage: []
} as const;

const SOURCE_CANARY = "src/live-source-canary.txt";
const CONTROL_CANARY = ".banzai/live-control-canary.json";
const OTHER_ARTIFACT =
  "documentation/features/live-compatibility/review-other.md";
const REVIEW_CANDIDATE =
  ".banzai/runs/live-compatibility/attempts/review-1.review-candidate.md";
const CODEX_WRITE_PROBE = ".banzai/live-write-probe.cjs";

type CodexCommandShape =
  | "direct"
  | "shell-wrapper"
  | "trailing-argument-spoof"
  | "prefixed-operator-spoof"
  | "suffix-spoof";

function successful(stdout = "", stderr = ""): ProcessResult {
  return {
    exitCode: 0,
    signal: null,
    stdout,
    stderr,
    startedAt: "2026-08-10T00:00:00.000Z",
    completedAt: "2026-08-10T00:00:01.000Z"
  };
}

async function repositoryFixture(): Promise<{
  parent: string;
  repository: string;
  temporaryParent: string;
  codexAuth: string;
  claudeAuth: string;
}> {
  const parent = await mkdtemp(path.join(tmpdir(), "banzai-live-test-"));
  const repository = path.join(parent, "repository");
  const temporaryParent = path.join(parent, "temporary");
  const codexAuth = path.join(parent, "codex-auth-source");
  const claudeAuth = path.join(parent, "claude-auth-source");
  await mkdir(path.join(repository, "plugins/banzai"), { recursive: true });
  await mkdir(temporaryParent);
  await mkdir(codexAuth);
  await mkdir(claudeAuth);
  await writeFile(path.join(repository, "fixture.txt"), "candidate\n", "utf8");
  await writeFile(
    path.join(repository, "plugins/banzai/plugin.txt"),
    "plugin\n",
    "utf8"
  );
  await writeFile(path.join(codexAuth, "auth.json"), "codex-session\n", "utf8");
  await writeFile(
    path.join(claudeAuth, "auth.json"),
    "claude-session\n",
    "utf8"
  );
  for (const args of [
    ["init", "--initial-branch=main"],
    ["config", "user.email", "live@example.invalid"],
    ["config", "user.name", "Live Test"],
    ["config", "commit.gpgsign", "false"],
    ["add", "."],
    ["commit", "-m", "candidate"]
  ]) {
    const result = spawnSync("git", args, {
      cwd: repository,
      encoding: "utf8"
    });
    assert.equal(result.status, 0, result.stderr);
  }
  return { parent, repository, temporaryParent, codexAuth, claudeAuth };
}

function promptFrom(spec: ProcessSpec): string {
  const index = spec.args.indexOf("-p");
  return spec.args[index + 1] ?? "";
}

function emitLine(spec: ProcessSpec, value: unknown): void {
  spec.onStdoutLine?.(JSON.stringify(value));
}

function codexCommand(target: string, shape: CodexCommandShape): string {
  const expected = `node ${CODEX_WRITE_PROBE} ${target}`;
  if (shape === "direct") {
    return expected;
  }
  if (shape === "shell-wrapper") {
    return `/bin/zsh -lc '${expected}'`;
  }
  if (shape === "trailing-argument-spoof") {
    return `node -e 'process.exit(73)' '${expected}'`;
  }
  if (shape === "prefixed-operator-spoof") {
    return `node -e 'process.exit(73)' && /bin/zsh -lc '${expected}'`;
  }
  return `/bin/zsh -lc '${expected}' ignored`;
}

function codexObservationLines(
  spec: ProcessSpec,
  omit: string | null,
  commandShape: CodexCommandShape
): void {
  const entries = [
    ["source", SOURCE_CANARY],
    ["control", CONTROL_CANARY]
  ] as const;
  for (const [id, target] of entries) {
    if (id !== omit) {
      emitLine(spec, {
        type: "item.completed",
        item: {
          id: `item-${id}`,
          type: "command_execution",
          command: codexCommand(target, commandShape),
          aggregated_output: `${JSON.stringify({
            schema: "banzai-live-write-probe/v1",
            target,
            outcome: "denied",
            code: "EPERM"
          })}\n`,
          exit_code: 73,
          status: "failed"
        }
      });
    }
  }
}

function claudeObservationLines(spec: ProcessSpec, omit: string | null): void {
  if (omit === "exact") return;
  emitLine(spec, {
    type: "system",
    subtype: "init",
    session_id: "live",
    tools: [
      "Read",
      "Glob",
      "Grep",
      "Skill",
      ...(omit === "write-exposed" ? ["Write"] : [])
    ]
  });
}

function reviewResponse(spec: ProcessSpec) {
  const prompt =
    spec.command === "claude" ? promptFrom(spec) : (spec.args.at(-1) ?? "");
  const digest = /snapshotDigest: "([a-f0-9]{64})"/.exec(prompt)?.[1];
  assert.ok(digest);
  return {
    ...REVIEW_RESULT,
    schemaVersion: 2,
    reviewNotes: [],
    scopeAcknowledgment: {
      schemaVersion: 1,
      snapshotDigest: digest,
      artifacts: [
        "documentation/features/live-compatibility/description.md",
        "documentation/development-plans/live-compatibility/plan.md"
      ].map((path) => ({ path, status: "reviewed", reason: null }))
    }
  };
}

function untrustedObservationLines(
  spec: ProcessSpec,
  vendor: "codex" | "claude",
  shape: "untyped" | "assistant-prose"
): void {
  const entries = [
    [SOURCE_CANARY, "deny"],
    [CONTROL_CANARY, "deny"],
    ...(vendor === "claude"
      ? ([
          [OTHER_ARTIFACT, "deny"],
          [REVIEW_CANDIDATE, "allow"]
        ] as const)
      : [])
  ] as const;
  for (const [target, decision] of entries) {
    if (shape === "untyped") {
      emitLine(spec, { target, permissionDecision: decision });
    } else if (vendor === "codex") {
      emitLine(spec, {
        type: "item.completed",
        item: {
          type: "agent_message",
          text: `${target} permissionDecision: ${decision}`
        }
      });
    } else {
      emitLine(spec, {
        type: "assistant",
        message: {
          content: [
            {
              type: "text",
              text: `${target} permissionDecision: ${decision}`
            }
          ]
        },
        session_id: "live"
      });
    }
  }
}

function fakeLiveRunner(options?: {
  omitObservation?: string;
  observationShape?: "realistic" | "untyped" | "assistant-prose";
  mutateSource?: boolean;
  mutateControl?: boolean;
  mutateOtherArtifact?: boolean;
  privateOutput?: string;
  nonZeroVendor?: "codex" | "claude";
  timeoutVendor?: "codex" | "claude";
  interruptVendor?: "codex" | "claude";
  codexCommandShape?: CodexCommandShape;
  onModelProcess?: (spec: ProcessSpec) => void;
}): ProcessRunner {
  return async (spec) => {
    if (spec.command === "git") {
      return await runProcess(spec);
    }
    if (spec.args.length === 1 && spec.args[0] === "--version") {
      return successful(
        spec.command === "codex"
          ? "codex-cli 0.145.0\n"
          : "2.1.220 (Claude Code)\n"
      );
    }
    if (spec.command === "codex" && spec.args.join(" ") === "login status") {
      return successful("Logged in using ChatGPT\n");
    }
    if (
      spec.command === "claude" &&
      spec.args.join(" ") === "auth status --json"
    ) {
      return successful(
        `${JSON.stringify({
          loggedIn: true,
          authMethod: "subscription",
          apiProvider: "firstparty"
        })}\n`
      );
    }
    if (spec.command === "codex") {
      options?.onModelProcess?.(spec);
      if (options?.interruptVendor === "codex") {
        await spec.onStart?.(42_424);
        process.emit("SIGTERM");
      }
      if (options?.timeoutVendor === "codex") {
        throw new BanzaiError("PROCESS_TIMEOUT", "Codex timed out.");
      }
      if ((options?.observationShape ?? "realistic") === "realistic") {
        codexObservationLines(
          spec,
          options?.omitObservation ?? null,
          options?.codexCommandShape ?? "direct"
        );
      } else {
        untrustedObservationLines(
          spec,
          "codex",
          options?.observationShape as "untyped" | "assistant-prose"
        );
      }
      const outputIndex = spec.args.indexOf("-o");
      const outputPath = spec.args[outputIndex + 1];
      assert.ok(outputPath);
      await mkdir(path.dirname(outputPath), { recursive: true });
      await writeFile(outputPath, JSON.stringify(reviewResponse(spec)), "utf8");
      if (options?.mutateSource === true) {
        await mkdir(path.join(spec.cwd, "src"), { recursive: true });
        await writeFile(
          path.join(spec.cwd, "src/live-source-canary.txt"),
          "forbidden\n",
          "utf8"
        );
      }
      if (options?.mutateControl === true) {
        await mkdir(path.join(spec.cwd, ".banzai"), { recursive: true });
        await writeFile(
          path.join(spec.cwd, CONTROL_CANARY),
          "forbidden\n",
          "utf8"
        );
      }
      if (options?.mutateOtherArtifact === true) {
        await mkdir(path.join(spec.cwd, path.dirname(OTHER_ARTIFACT)), {
          recursive: true
        });
        await writeFile(
          path.join(spec.cwd, OTHER_ARTIFACT),
          "forbidden\n",
          "utf8"
        );
      }
      const result = successful(
        `${JSON.stringify({ type: "thread.started", thread_id: "live" })}\n${
          options?.privateOutput === undefined
            ? ""
            : `${JSON.stringify({ type: "diagnostic", raw: options.privateOutput })}\n`
        }`
      );
      return options?.nonZeroVendor === "codex"
        ? { ...result, exitCode: 17 }
        : result;
    }
    if (spec.command === "claude") {
      options?.onModelProcess?.(spec);
      if (options?.interruptVendor === "claude") {
        await spec.onStart?.(42_425);
        process.emit("SIGTERM");
      }
      if (options?.timeoutVendor === "claude") {
        throw new BanzaiError("PROCESS_TIMEOUT", "Claude timed out.");
      }
      if ((options?.observationShape ?? "realistic") === "realistic") {
        claudeObservationLines(spec, options?.omitObservation ?? null);
      } else {
        untrustedObservationLines(
          spec,
          "claude",
          options?.observationShape as "untyped" | "assistant-prose"
        );
      }
      assert.equal(spec.env.BANZAI_REVIEW_ARTIFACT, undefined);
      assert.ok(spec.args.includes("Read,Glob,Grep,Skill"));
      assert.ok(
        spec.args.includes(
          "Bash,Edit,Write,MultiEdit,NotebookEdit,WebFetch,WebSearch"
        )
      );
      const result = successful(
        `${JSON.stringify({
          type: "result",
          structured_output: reviewResponse(spec),
          session_id: "live"
        })}\n${
          options?.privateOutput === undefined
            ? ""
            : `${JSON.stringify({ type: "diagnostic", raw: options.privateOutput })}\n`
        }`
      );
      return options?.nonZeroVendor === "claude"
        ? { ...result, exitCode: 19 }
        : result;
    }
    return { ...successful(), exitCode: 1 };
  };
}

test("live compatibility requires exact explicit confirmation", () => {
  assert.doesNotThrow(() => {
    validateLiveCompatibilityPolicy();
  });
  assert.doesNotThrow(() => {
    parseLiveCompatibilityArgs(["--confirm-live"]);
  });
  for (const args of [[], ["--help"], ["--confirm-live", "extra"]]) {
    assert.throws(
      () => {
        parseLiveCompatibilityArgs(args);
      },
      (error) =>
        error instanceof BanzaiError &&
        error.code === "LIVE_CONFIRMATION_REQUIRED"
    );
  }
});

test("CLI version normalization is deterministic", () => {
  assert.equal(normalizedCliVersion("codex-cli 0.145.0"), "0.145.0");
  assert.equal(normalizedCliVersion("Claude Code v2.1.220"), "2.1.220");
  assert.equal(normalizedCliVersion("unknown"), null);
});

test("API credentials make live compatibility unavailable without a process call", async () => {
  let calls = 0;
  const summary = await runLiveCompatibility("/not-used", {
    environment: { OPENAI_API_KEY: "sk-forbidden-live-api-key" },
    processRunner: async () => {
      calls += 1;
      return successful();
    }
  });
  assert.equal(summary.status, "unavailable");
  assert.equal(summary.invocationCount, 0);
  assert.equal(calls, 0);
  assert.equal(
    summary.checks.find((check) => check.id === "preflight.codex")?.code,
    "API_AUTH_REJECTED"
  );
});

test("missing subscription auth is unavailable, never pass", async () => {
  const candidate = await repositoryFixture();
  try {
    const summary = await runLiveCompatibility(candidate.repository, {
      environment: { PATH: process.env.PATH },
      temporaryParent: candidate.temporaryParent,
      processRunner: fakeLiveRunner()
    });
    assert.equal(summary.status, "unavailable", JSON.stringify(summary));
    assert.equal(summary.invocationCount, 0);
    assert.equal(
      summary.checks.find((check) => check.id === "preflight.codex")?.status,
      "unavailable"
    );
    assert.deepEqual(await readdir(candidate.temporaryParent), []);
  } finally {
    await rm(candidate.parent, { recursive: true, force: true });
  }
});

test("fake live suite proves exact artifact permission and fail-closed denials", async () => {
  const candidate = await repositoryFixture();
  try {
    const secret = "sk-private-output-canary-123456789";
    const summary = await runLiveCompatibility(candidate.repository, {
      environment: {
        PATH: process.env.PATH,
        BANZAI_LIVE_CODEX_AUTH_ROOT: candidate.codexAuth,
        BANZAI_LIVE_CLAUDE_AUTH_ROOT: candidate.claudeAuth
      },
      temporaryParent: candidate.temporaryParent,
      processRunner: fakeLiveRunner({ privateOutput: secret })
    });
    assert.equal(summary.status, "pass", JSON.stringify(summary));
    assert.equal(summary.invocationCount, 2);
    assert.equal(
      summary.checks.every((check) => check.status === "pass"),
      true
    );
    assert.equal(JSON.stringify(summary).includes(secret), false);
    assert.deepEqual(await readdir(candidate.temporaryParent), []);
  } finally {
    await rm(candidate.parent, { recursive: true, force: true });
  }
});

test("an anchored Codex shell wrapper remains valid denial evidence", async () => {
  const candidate = await repositoryFixture();
  try {
    const summary = await runLiveCompatibility(candidate.repository, {
      environment: {
        PATH: process.env.PATH,
        BANZAI_LIVE_CODEX_AUTH_ROOT: candidate.codexAuth,
        BANZAI_LIVE_CLAUDE_AUTH_ROOT: candidate.claudeAuth
      },
      temporaryParent: candidate.temporaryParent,
      processRunner: fakeLiveRunner({ codexCommandShape: "shell-wrapper" })
    });
    assert.equal(summary.status, "pass", JSON.stringify(summary));
    assert.deepEqual(await readdir(candidate.temporaryParent), []);
  } finally {
    await rm(candidate.parent, { recursive: true, force: true });
  }
});

for (const shape of [
  "trailing-argument-spoof",
  "prefixed-operator-spoof",
  "suffix-spoof"
] as const) {
  test(`typed Codex ${shape} cannot satisfy denial evidence`, async () => {
    const candidate = await repositoryFixture();
    try {
      const summary = await runLiveCompatibility(candidate.repository, {
        environment: {
          PATH: process.env.PATH,
          BANZAI_LIVE_CODEX_AUTH_ROOT: candidate.codexAuth,
          BANZAI_LIVE_CLAUDE_AUTH_ROOT: candidate.claudeAuth
        },
        temporaryParent: candidate.temporaryParent,
        processRunner: fakeLiveRunner({ codexCommandShape: shape })
      });
      assert.equal(summary.status, "fail", JSON.stringify(summary));
      assert.equal(
        summary.checks.find((check) => check.id === "codex.source_denied")
          ?.code,
        "DENIAL_NOT_OBSERVED"
      );
      assert.deepEqual(await readdir(candidate.temporaryParent), []);
    } finally {
      await rm(candidate.parent, { recursive: true, force: true });
    }
  });
}

for (const missing of ["exact", "write-exposed"]) {
  test(`missing or writable host inventory fails (${missing})`, async () => {
    const candidate = await repositoryFixture();
    try {
      const summary = await runLiveCompatibility(candidate.repository, {
        environment: {
          PATH: process.env.PATH,
          BANZAI_LIVE_CODEX_AUTH_ROOT: candidate.codexAuth,
          BANZAI_LIVE_CLAUDE_AUTH_ROOT: candidate.claudeAuth
        },
        temporaryParent: candidate.temporaryParent,
        processRunner: fakeLiveRunner({ omitObservation: missing })
      });
      assert.equal(summary.status, "fail");
      assert.equal(
        summary.checks.find((check) => check.id === "claude.candidate_denied")
          ?.status,
        "fail",
        JSON.stringify(summary)
      );
      assert.deepEqual(await readdir(candidate.temporaryParent), []);
    } finally {
      await rm(candidate.parent, { recursive: true, force: true });
    }
  });
}

for (const shape of ["untyped", "assistant-prose"] as const) {
  test(`${shape} permission claims cannot satisfy live evidence`, async () => {
    const candidate = await repositoryFixture();
    try {
      const summary = await runLiveCompatibility(candidate.repository, {
        environment: {
          PATH: process.env.PATH,
          BANZAI_LIVE_CODEX_AUTH_ROOT: candidate.codexAuth,
          BANZAI_LIVE_CLAUDE_AUTH_ROOT: candidate.claudeAuth
        },
        temporaryParent: candidate.temporaryParent,
        processRunner: fakeLiveRunner({ observationShape: shape })
      });
      assert.equal(summary.status, "fail", JSON.stringify(summary));
      assert.equal(
        summary.checks.find((check) => check.id === "codex.source_denied")
          ?.code,
        "DENIAL_NOT_OBSERVED"
      );
      assert.equal(
        summary.checks.find((check) => check.id === "claude.candidate_denied")
          ?.status,
        "fail"
      );
      assert.deepEqual(await readdir(candidate.temporaryParent), []);
    } finally {
      await rm(candidate.parent, { recursive: true, force: true });
    }
  });
}

test("forbidden source mutation fails closed", async () => {
  const candidate = await repositoryFixture();
  try {
    const summary = await runLiveCompatibility(candidate.repository, {
      environment: {
        PATH: process.env.PATH,
        BANZAI_LIVE_CODEX_AUTH_ROOT: candidate.codexAuth,
        BANZAI_LIVE_CLAUDE_AUTH_ROOT: candidate.claudeAuth
      },
      temporaryParent: candidate.temporaryParent,
      processRunner: fakeLiveRunner({ mutateSource: true })
    });
    assert.equal(summary.status, "fail");
    assert.equal(
      summary.checks.find((check) => check.id === "workspace.unchanged")?.code,
      "FORBIDDEN_MUTATION",
      JSON.stringify(summary)
    );
    assert.deepEqual(await readdir(candidate.temporaryParent), []);
  } finally {
    await rm(candidate.parent, { recursive: true, force: true });
  }
});

for (const [label, options] of [
  ["control state", { mutateControl: true }],
  ["non-authorized artifact", { mutateOtherArtifact: true }]
] as const) {
  test(`forbidden ${label} mutation fails closed and cleans up`, async () => {
    const candidate = await repositoryFixture();
    try {
      const summary = await runLiveCompatibility(candidate.repository, {
        environment: {
          PATH: process.env.PATH,
          BANZAI_LIVE_CODEX_AUTH_ROOT: candidate.codexAuth,
          BANZAI_LIVE_CLAUDE_AUTH_ROOT: candidate.claudeAuth
        },
        temporaryParent: candidate.temporaryParent,
        processRunner: fakeLiveRunner(options)
      });
      assert.equal(summary.status, "fail");
      assert.equal(
        summary.checks.find((check) => check.id === "workspace.unchanged")
          ?.code,
        "FORBIDDEN_MUTATION",
        JSON.stringify(summary)
      );
      assert.deepEqual(await readdir(candidate.temporaryParent), []);
    } finally {
      await rm(candidate.parent, { recursive: true, force: true });
    }
  });
}

for (const [label, options] of [
  ["non-zero Codex", { nonZeroVendor: "codex" as const }],
  ["non-zero Claude", { nonZeroVendor: "claude" as const }],
  ["Codex timeout", { timeoutVendor: "codex" as const }],
  ["Claude timeout", { timeoutVendor: "claude" as const }]
] as const) {
  test(`${label} fails closed and cleans up`, async () => {
    const candidate = await repositoryFixture();
    try {
      const summary = await runLiveCompatibility(candidate.repository, {
        environment: {
          PATH: process.env.PATH,
          BANZAI_LIVE_CODEX_AUTH_ROOT: candidate.codexAuth,
          BANZAI_LIVE_CLAUDE_AUTH_ROOT: candidate.claudeAuth
        },
        temporaryParent: candidate.temporaryParent,
        processRunner: fakeLiveRunner(options)
      });
      assert.equal(summary.status, "fail", JSON.stringify(summary));
      const vendor =
        "nonZeroVendor" in options
          ? options.nonZeroVendor
          : options.timeoutVendor;
      assert.equal(
        summary.checks.find(
          (check) => check.id === `${vendor}.structured_result`
        )?.status,
        "fail"
      );
      assert.deepEqual(await readdir(candidate.temporaryParent), []);
    } finally {
      await rm(candidate.parent, { recursive: true, force: true });
    }
  });
}

test("model invocations enforce the accepted per-call and count bounds", async () => {
  const candidate = await repositoryFixture();
  const timeouts: number[] = [];
  try {
    const summary = await runLiveCompatibility(candidate.repository, {
      environment: {
        PATH: process.env.PATH,
        BANZAI_LIVE_CODEX_AUTH_ROOT: candidate.codexAuth,
        BANZAI_LIVE_CLAUDE_AUTH_ROOT: candidate.claudeAuth
      },
      temporaryParent: candidate.temporaryParent,
      processRunner: fakeLiveRunner({
        onModelProcess: (spec) => timeouts.push(spec.timeoutMs)
      })
    });
    assert.equal(summary.status, "pass", JSON.stringify(summary));
    assert.equal(summary.invocationCount, 2);
    assert.deepEqual(timeouts, [300_000, 300_000]);
    assert.deepEqual(await readdir(candidate.temporaryParent), []);
  } finally {
    await rm(candidate.parent, { recursive: true, force: true });
  }
});

test("total deadline overflow is a failure and still cleans up", async () => {
  const candidate = await repositoryFixture();
  let time = 0;
  try {
    const summary = await runLiveCompatibility(candidate.repository, {
      environment: {
        PATH: process.env.PATH,
        BANZAI_LIVE_CODEX_AUTH_ROOT: candidate.codexAuth,
        BANZAI_LIVE_CLAUDE_AUTH_ROOT: candidate.claudeAuth
      },
      temporaryParent: candidate.temporaryParent,
      processRunner: fakeLiveRunner(),
      now: () => {
        time += 100_000;
        return time;
      }
    });
    assert.equal(summary.status, "fail", JSON.stringify(summary));
    assert.equal(
      summary.checks.find((check) => check.id === "bounds.enforced")?.code,
      "BOUND_EXCEEDED"
    );
    assert.deepEqual(await readdir(candidate.temporaryParent), []);
  } finally {
    await rm(candidate.parent, { recursive: true, force: true });
  }
});

test("interruption terminates the active process group and cleans up", async () => {
  const candidate = await repositoryFixture();
  const terminated: number[] = [];
  try {
    const summary = await runLiveCompatibility(candidate.repository, {
      environment: {
        PATH: process.env.PATH,
        BANZAI_LIVE_CODEX_AUTH_ROOT: candidate.codexAuth,
        BANZAI_LIVE_CLAUDE_AUTH_ROOT: candidate.claudeAuth
      },
      temporaryParent: candidate.temporaryParent,
      processRunner: fakeLiveRunner({ interruptVendor: "codex" }),
      processGroupTerminator: (pid) => terminated.push(pid)
    });
    assert.equal(summary.status, "fail", JSON.stringify(summary));
    assert.deepEqual(terminated, [42_424]);
    assert.equal(
      summary.checks.find((check) => check.id === "bounds.enforced")?.code,
      "BOUND_EXCEEDED"
    );
    assert.deepEqual(await readdir(candidate.temporaryParent), []);
  } finally {
    await rm(candidate.parent, { recursive: true, force: true });
  }
});

test("live CLI returns unavailable as exit 2 with a fixed JSON summary", async () => {
  const stdout: string[] = [];
  const exitCode = await executeLiveCompatibility(
    "/not-used",
    ["--confirm-live"],
    { stdout: (value) => stdout.push(value), stderr: () => undefined },
    { environment: { ANTHROPIC_API_KEY: "forbidden" } }
  );
  assert.equal(exitCode, 2);
  const summary = JSON.parse(stdout.join("")) as Record<string, unknown>;
  assert.equal(summary.schema, "banzai-live-compatibility/v2");
  assert.equal(summary.status, "unavailable");
});
