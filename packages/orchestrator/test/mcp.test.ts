import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { resolveSerenaWhitelist } from "../src/mcp.js";
import type { ProcessResult, ProcessRunner } from "../src/types.js";

const completed = (exitCode: number, stdout: string): ProcessResult => ({
  exitCode,
  signal: null,
  stdout,
  stderr: "",
  startedAt: "2026-08-18T12:00:00.000Z",
  completedAt: "2026-08-18T12:00:00.100Z"
});

const CODEX_GET = JSON.stringify({
  name: "serena",
  enabled: true,
  transport: {
    type: "stdio",
    command: "serena",
    args: ["start-mcp-server", "--context=codex-lean", "--project-from-cwd"],
    env: null
  },
  startup_timeout_sec: 15.0
});

interface Fixture {
  repoRoot: string;
  home: string;
  binDir: string;
  env: NodeJS.ProcessEnv;
  dispose: () => Promise<void>;
}

/** A repo onboarded to Serena, a fake home, and a PATH with `serena` on it. */
async function fixture(): Promise<Fixture> {
  const root = await mkdtemp(path.join(tmpdir(), "banzai-mcp-"));
  const repoRoot = path.join(root, "repo");
  const home = path.join(root, "home");
  const binDir = path.join(root, "bin");
  await mkdir(path.join(repoRoot, ".serena"), { recursive: true });
  await writeFile(path.join(repoRoot, ".serena", "project.yml"), "name: x\n");
  await mkdir(home, { recursive: true });
  await mkdir(binDir, { recursive: true });
  const serena = path.join(binDir, "serena");
  await writeFile(serena, "#!/bin/sh\nexit 0\n");
  await chmod(serena, 0o755);
  return {
    repoRoot,
    home,
    binDir,
    env: { PATH: binDir, HOME: home },
    dispose: async () => {
      await rm(root, { recursive: true, force: true });
    }
  };
}

async function registerClaudeSerena(
  filePath: string,
  command = "serena"
): Promise<void> {
  await writeFile(
    filePath,
    JSON.stringify({
      mcpServers: {
        serena: {
          type: "stdio",
          command,
          args: ["start-mcp-server", "--context=claude-code"],
          env: {}
        }
      }
    })
  );
}

test("a repo without .serena/project.yml gets no whitelist and one reason", async () => {
  const { repoRoot, env, dispose } = await fixture();
  try {
    await rm(path.join(repoRoot, ".serena"), { recursive: true });
    let probed = false;
    const runner: ProcessRunner = async () => {
      probed = true;
      return completed(0, CODEX_GET);
    };
    const whitelist = await resolveSerenaWhitelist({
      repoRoot,
      codexExecutable: "codex",
      env,
      runner
    });
    assert.equal(whitelist.claude, null);
    assert.equal(whitelist.codex, null);
    assert.deepEqual(whitelist.notes, [
      "serena: .serena/project.yml is missing, so there is no project to serve"
    ]);
    // Without a project there is nothing to probe.
    assert.equal(probed, false);
  } finally {
    await dispose();
  }
});

test("each vendor's definition comes from that vendor's own registration", async () => {
  const { repoRoot, home, env, dispose } = await fixture();
  try {
    await registerClaudeSerena(path.join(home, ".claude.json"));
    const commands: string[][] = [];
    const runner: ProcessRunner = async (spec) => {
      commands.push([spec.command, ...spec.args]);
      return completed(0, CODEX_GET);
    };
    const whitelist = await resolveSerenaWhitelist({
      repoRoot,
      codexExecutable: "codex",
      env,
      runner
    });
    assert.deepEqual(whitelist.claude, {
      command: "serena",
      args: ["start-mcp-server", "--context=claude-code"],
      env: {},
      startupTimeoutSec: null
    });
    assert.deepEqual(whitelist.codex, {
      command: "serena",
      args: ["start-mcp-server", "--context=codex-lean", "--project-from-cwd"],
      env: {},
      startupTimeoutSec: 15
    });
    assert.deepEqual(whitelist.notes, []);
    assert.deepEqual(commands, [["codex", "mcp", "get", "serena", "--json"]]);
  } finally {
    await dispose();
  }
});

test("the project .mcp.json wins over the user-scope registration", async () => {
  const { repoRoot, home, binDir, env, dispose } = await fixture();
  try {
    const projectSerena = path.join(binDir, "project-serena");
    await writeFile(projectSerena, "#!/bin/sh\nexit 0\n");
    await chmod(projectSerena, 0o755);
    await registerClaudeSerena(path.join(home, ".claude.json"), "serena");
    await registerClaudeSerena(
      path.join(repoRoot, ".mcp.json"),
      "project-serena"
    );
    const whitelist = await resolveSerenaWhitelist({
      repoRoot,
      codexExecutable: null,
      env,
      runner: async () => completed(1, "")
    });
    assert.equal(whitelist.claude?.command, "project-serena");
  } finally {
    await dispose();
  }
});

test("an unresolvable command disables that vendor with a reason", async () => {
  const { repoRoot, home, env, dispose } = await fixture();
  try {
    await registerClaudeSerena(path.join(home, ".claude.json"), "no-such-tool");
    const whitelist = await resolveSerenaWhitelist({
      repoRoot,
      codexExecutable: null,
      env,
      runner: async () => completed(1, "")
    });
    assert.equal(whitelist.claude, null);
    assert.ok(
      whitelist.notes.some((note) =>
        note.includes("`no-such-tool` is not executable on PATH")
      )
    );
  } finally {
    await dispose();
  }
});

test("codex probe failures downgrade to notes instead of blocking", async () => {
  const { repoRoot, env, dispose } = await fixture();
  try {
    const cases: [ProcessRunner, string][] = [
      [async () => completed(1, ""), "not registered"],
      [
        async () => completed(0, JSON.stringify({ enabled: false })),
        "registered but disabled"
      ],
      [async () => completed(0, "not json"), "not readable JSON"],
      [
        async () => {
          throw new Error("spawn failure");
        },
        "spawn failure"
      ]
    ];
    for (const [runner, expected] of cases) {
      const whitelist = await resolveSerenaWhitelist({
        repoRoot,
        codexExecutable: "codex",
        env,
        runner
      });
      assert.equal(whitelist.codex, null);
      assert.ok(
        whitelist.notes.some((note) => note.includes(expected)),
        `${expected}: ${JSON.stringify(whitelist.notes)}`
      );
    }
  } finally {
    await dispose();
  }
});

test("without a codex role the codex side is skipped silently", async () => {
  const { repoRoot, env, dispose } = await fixture();
  try {
    const whitelist = await resolveSerenaWhitelist({
      repoRoot,
      codexExecutable: null,
      env,
      runner: async () => {
        throw new Error("must not run");
      }
    });
    assert.equal(whitelist.codex, null);
    assert.equal(
      whitelist.notes.some((note) => note.startsWith("codex:")),
      false
    );
  } finally {
    await dispose();
  }
});
