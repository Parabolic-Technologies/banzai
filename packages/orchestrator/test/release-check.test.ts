import assert from "node:assert/strict";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const SCRIPT = path.join(process.cwd(), "scripts", "release-check.mjs");

test("release check keeps contract drift validation before committed smoke", async () => {
  const source = await readFile(SCRIPT, "utf8");
  const build = source.indexOf('name: "distribution-build"');
  const verify = source.indexOf('name: "verify"');
  const validation = source.indexOf('name: "release-validation"');
  const smoke = source.indexOf('name: "committed-smoke"');
  assert.ok(validation >= 0);
  assert.ok(build >= 0 && verify > build && validation > verify);
  assert.match(source, /args: \["run", "build:dist"\]/);
  assert.ok(smoke > validation);
  assert.match(source, /args: \["run", "release:validate"\]/);
  assert.match(source, /args: \["run", "smoke:committed"\]/);
  const defaults = source.slice(
    source.indexOf("function defaultComponents()"),
    source.indexOf("async function parseArguments")
  );
  assert.doesNotMatch(defaults, /version:set/);
  assert.doesNotMatch(defaults, /version:recover/);
});

async function fixtureRepository(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "banzai-release-check-"));
  await mkdir(path.join(root, "packages/orchestrator/.test-dist"), {
    recursive: true
  });
  await mkdir(path.join(root, "packages/orchestrator/.dist-check-stale"), {
    recursive: true
  });
  await writeFile(path.join(root, "tracked.txt"), "original\n", "utf8");
  const commands = [
    ["init"],
    ["config", "user.email", "release-check@example.invalid"],
    ["config", "user.name", "Release Check"],
    ["config", "commit.gpgsign", "false"],
    ["add", "tracked.txt"],
    ["commit", "-m", "fixture"]
  ];
  for (const args of commands) {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  }
  await writeFile(
    path.join(root, "tracked.txt"),
    "pre-existing dirty\n",
    "utf8"
  );
  return root;
}

async function runFixture(
  root: string,
  scripts: string[],
  environment: NodeJS.ProcessEnv = process.env
): Promise<SpawnSyncReturns<string>> {
  const componentPath = path.join(root, "components.json");
  await writeFile(
    componentPath,
    `${JSON.stringify(
      scripts.map((source, index) => ({
        name: `component-${index + 1}`,
        command: process.execPath,
        args: ["-e", source]
      }))
    )}\n`,
    "utf8"
  );
  return spawnSync(
    process.execPath,
    [SCRIPT, "--root", root, "--fixture-components", componentPath],
    {
      cwd: root,
      env: environment,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    }
  );
}

async function withRepository(
  exercise: (root: string) => Promise<void>
): Promise<void> {
  const root = await fixtureRepository();
  try {
    await exercise(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("release check is non-TTY, ordered, clean, and preserves pre-existing changes", async () => {
  await withRepository(async (root) => {
    const log = path.join(root, "order.log");
    const forbiddenEnvironment = [
      "OPENAI_API_KEY",
      "AWS_BEARER_TOKEN_BEDROCK",
      "CLAUDE_CODE_USE_VERTEX",
      "BANZAI_LIVE_COMPATIBILITY"
    ];
    const result = await runFixture(
      root,
      [
        `if (process.stdin.isTTY || ${JSON.stringify(forbiddenEnvironment)}.some((key) => process.env[key] !== undefined)) process.exit(7); require('node:fs').appendFileSync(${JSON.stringify(log)}, 'one\\n')`,
        `if (process.stdin.isTTY) process.exit(7); require('node:fs').appendFileSync(${JSON.stringify(log)}, 'two\\n')`
      ],
      {
        ...process.env,
        OPENAI_API_KEY: "fixture-only",
        AWS_BEARER_TOKEN_BEDROCK: "fixture-only",
        CLAUDE_CODE_USE_VERTEX: "1",
        BANZAI_LIVE_COMPATIBILITY: "1"
      }
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /release check passed/);
    assert.equal(await readFile(log, "utf8"), "one\ntwo\n");
    assert.equal(
      await readFile(path.join(root, "tracked.txt"), "utf8"),
      "pre-existing dirty\n"
    );
    const entries = await readdir(path.join(root, "packages/orchestrator"));
    assert.deepEqual(entries, []);
  });
});

test("release check propagates component failure and still cleans transients", async () => {
  await withRepository(async (root) => {
    const result = await runFixture(root, ["process.exit(9)"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /^RELEASE_COMPONENT_FAILED:/);
    assert.deepEqual(
      await readdir(path.join(root, "packages/orchestrator")),
      []
    );
  });
});

test("release check fails closed when a component mutates a tracked file", async () => {
  await withRepository(async (root) => {
    const target = path.join(root, "tracked.txt");
    const result = await runFixture(root, [
      `require('node:fs').writeFileSync(${JSON.stringify(target)}, 'mutated\\n')`
    ]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /^RELEASE_TRACKED_MUTATION:/);
  });
});
