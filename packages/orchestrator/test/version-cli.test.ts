import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import packageManifest from "../package.json" with { type: "json" };
import { executeVersionCli } from "../src/version-cli.js";
import type { ProcessRunner, ProcessSpec } from "../src/types.js";

const CLI = path.resolve("dist/banzai.mjs");

function inventoryRunner(
  inventory: (spec: ProcessSpec) => unknown
): ProcessRunner {
  return async (spec) => ({
    exitCode: 0,
    signal: null,
    stdout: JSON.stringify(inventory(spec)),
    stderr: "",
    startedAt: "",
    completedAt: ""
  });
}

test("committed version aliases work without a repository or configuration and never start models", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "banzai-version-"));
  try {
    for (const vendor of ["codex", "claude"]) {
      const executable = path.join(cwd, vendor);
      await writeFile(
        executable,
        `#!${process.execPath}
const args = process.argv.slice(2).join(' ');
let result;
if (args === 'plugin marketplace list --json') result = {marketplaces: [{name: 'local'}]};
else if (args === 'plugin list --marketplace local --json') result = {installed: [{name: 'banzai', marketplaceName: 'local', installed: true, enabled: false, version: '1.2.3+installed', source: {path: '/must-not-read'}}]};
else if (args === 'plugin list --json' && ${JSON.stringify(vendor)} === 'claude') result = [{id: 'banzai@local', version: '2.3.4'}];
else process.exit(91);
console.log(JSON.stringify(result));
`
      );
      await chmod(executable, 0o755);
    }
    const before = await readdir(cwd);
    for (const flag of [
      "--version",
      "-v",
      "—version",
      "--plugin-version",
      "-pv",
      "—plugin-version"
    ]) {
      const result = spawnSync(process.execPath, [CLI, flag], {
        cwd,
        encoding: "utf8",
        timeout: 10_000,
        env: {
          PATH: cwd,
          BANZAI_PROGRESS: "invalid",
          BANZAI_RUN_ID: "nested",
          CLAUDECODE: "1"
        }
      });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.equal(
        result.stdout,
        flag.includes("plugin") || flag === "-pv"
          ? "Codex: 1.2.3+installed\nClaude Code: 2.3.4\n"
          : `${packageManifest.version}\n`
      );
    }
    assert.deepEqual(await readdir(cwd), before);
    const invalid = spawnSync(process.execPath, [CLI, "-v", "run"], {
      cwd,
      encoding: "utf8",
      env: { PATH: "" }
    });
    assert.equal(invalid.status, 1);
    assert.equal(invalid.stdout, "");
    assert.match(invalid.stderr, /^\[INVALID_VERSION_COMMAND\]/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("plugin versions retain distinct installed versions and bounded local subscription-only discovery", async () => {
  const output: string[] = [];
  const calls: ProcessSpec[] = [];
  const runner = inventoryRunner((spec) => {
    calls.push(spec);
    assert.equal(spec.env.OPENAI_API_KEY, undefined);
    assert.ok(spec.timeoutMs <= 5_000 && spec.timeoutMs > 0);
    assert.equal(spec.maxOutputBytes, 512 * 1024);
    if (spec.command === "claude") return [];
    if (spec.args[1] === "marketplace")
      return { marketplaces: [{ name: "one" }, { name: "two" }] };
    const marketplaceName = spec.args[3];
    return {
      installed: [
        {
          name: "banzai",
          marketplaceName,
          installed: true,
          enabled: false,
          version: marketplaceName === "one" ? "1.0.0" : "2.0.0-beta+build"
        },
        { name: "banzai", marketplaceName, installed: false, version: "9.0.0" },
        { name: "other", marketplaceName, installed: true, version: "9.0.0" }
      ]
    };
  });
  await executeVersionCli(
    ["-pv"],
    process.cwd(),
    (text) => output.push(text),
    { OPENAI_API_KEY: "secret" },
    runner
  );
  assert.equal(
    output.join(""),
    "Codex: 1.0.0, 2.0.0-beta+build\nClaude Code: not installed\n"
  );
  assert.equal(calls.filter((call) => call.command === "codex").length, 3);
  assert.ok(
    calls
      .filter((call) => call.command === "codex" && call.args[1] === "list")
      .every((call) => call.args.includes("--marketplace"))
  );
});

test("missing or failed plugin discovery cannot report a source version or false success", async () => {
  for (const failure of [
    "missing",
    "malformed",
    "unsafe-version",
    "unsafe-marketplace",
    "process-failure"
  ]) {
    const output: string[] = [];
    const runner = inventoryRunner((spec) => {
      if (failure === "process-failure") throw new Error("private error text");
      if (failure === "malformed") return {};
      if (spec.command === "claude")
        return failure === "unsafe-version"
          ? [{ id: "banzai@local", version: "1.0.0\u001b[2J" }]
          : [];
      return {
        marketplaces:
          failure === "unsafe-marketplace" ? [{ name: "--remote" }] : []
      };
    });
    await assert.rejects(
      executeVersionCli(
        ["--plugin-version"],
        process.cwd(),
        (text) => output.push(text),
        {},
        runner
      ),
      { code: "PLUGIN_VERSION_UNAVAILABLE" }
    );
    assert.match(output.join(""), /not installed|unavailable/);
    assert.doesNotMatch(output.join(""), /private|1\.0\.0|\u001b/);
  }
});

test("one unavailable client does not hide the other installed plugin version", async () => {
  const output: string[] = [];
  await executeVersionCli(
    ["-pv"],
    process.cwd(),
    (text) => output.push(text),
    {},
    inventoryRunner((spec) => {
      if (spec.command === "codex") throw new Error("unavailable");
      return [{ id: "banzai@local", version: "3.0.0" }];
    })
  );
  assert.equal(output.join(""), "Codex: unavailable\nClaude Code: 3.0.0\n");
});
