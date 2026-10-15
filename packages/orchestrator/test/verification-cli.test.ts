import assert from "node:assert/strict";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { initializeConfig, DEFAULT_CONFIG } from "../src/config.js";
import { WorkflowRunner } from "../src/workflow.js";
import { RunStore } from "../src/store.js";
import { createVendorAdapters } from "../src/adapters.js";
import {
  executeVerificationCli,
  parseVerificationArgs,
  runVerificationWizard
} from "../src/verification-cli.js";
import { readVerificationConfig } from "../src/verification-config.js";
import {
  assessVerificationReadiness,
  inspectVerificationProject
} from "../src/verification.js";
import type {
  InteractiveChoice,
  InteractiveInput,
  InteractiveIO
} from "../src/interactive.js";
import type { ProcessRunner } from "../src/types.js";
import { createTestRepository } from "./helpers.js";

class ScriptedIO implements InteractiveIO {
  async multiSelect<T>(): Promise<T[]> {
    throw new Error("Unexpected multi-select");
  }
  lines: string[] = [];
  prompts: string[] = [];
  constructor(readonly answers: unknown[]) {}
  async select<T>(
    message: string,
    choices: readonly InteractiveChoice<T>[]
  ): Promise<T> {
    this.prompts.push(message);
    const answer = this.answers.shift();
    assert.ok(
      choices.some((choice) => choice.value === answer && !choice.disabled),
      `Unexpected answer ${String(answer)} for ${message}`
    );
    return answer as T;
  }
  async confirm(message: string): Promise<boolean> {
    this.prompts.push(message);
    const answer = this.answers.shift();
    assert.equal(typeof answer, "boolean");
    return answer as boolean;
  }
  async input(input: InteractiveInput): Promise<string> {
    this.prompts.push(input.message);
    const answer = this.answers.shift();
    assert.equal(typeof answer, "string");
    assert.equal(input.validate?.(answer as string) ?? true, true);
    return answer as string;
  }
  writeLine(line = ""): void {
    this.lines.push(line);
  }
}
const forbiddenExecution: ProcessRunner = async () => {
  assert.fail("Setup must never execute project commands");
};
async function fixture() {
  const { root } = await createTestRepository({ artifactLayout: null });
  await initializeConfig(root);
  // These tests exercise retained explicit legacy profile utilities, not new-task setup.
  await writeFile(
    path.join(root, ".banzai/config.json"),
    JSON.stringify(DEFAULT_CONFIG)
  );
  return {
    root,
    runner: new WorkflowRunner(
      root,
      createVendorAdapters(),
      forbiddenExecution
    ),
    dispose: () => rm(root, { recursive: true, force: true })
  };
}

test("empty wizard requires confirmation and does not infer Node or execute", async () => {
  const f = await fixture();
  try {
    await runVerificationWizard(f.runner, new ScriptedIO([false]), "human");
    assert.equal(
      (await readVerificationConfig(f.root)).config.verification.bootstrap,
      undefined
    );
    await runVerificationWizard(f.runner, new ScriptedIO([true]), "human");
    const saved = (await readVerificationConfig(f.root)).config;
    assert.equal(saved.verification.bootstrap, true);
    assert.equal(saved.verification.profiles.length, 1);
    assert.equal(saved.verification.profiles[0]?.projectType, "repository");
    await assert.rejects(
      readFile(path.join(f.root, ".banzai/active-run.json")),
      { code: "ENOENT" }
    );
  } finally {
    await f.dispose();
  }
});

test("markerless wizard explains conflicting profiles without offering ineffective bootstrap and supports confirmed repair", async () => {
  const f = await fixture();
  try {
    const initial = (await readVerificationConfig(f.root)).config;
    for (const schemaVersion of [2, 3] as const) {
      for (const bootstrap of [undefined, false, true]) {
        const config = structuredClone(initial);
        config.schemaVersion = schemaVersion;
        config.verification.profiles.push({
          id: "node",
          projectType: "node",
          commands: [
            { name: "test", command: "npm", args: ["test"], timeoutMs: 1000 }
          ]
        });
        if (schemaVersion === 3)
          for (const profile of config.verification.profiles)
            profile.commands.forEach((command, index) => {
              command.id = `${profile.id}-${index}`;
            });
        if (bootstrap !== undefined) config.verification.bootstrap = bootstrap;
        const before = JSON.stringify(config, null, 2) + "\n";
        await writeFile(path.join(f.root, ".banzai/config.json"), before);
        const io = new ScriptedIO([]);
        await runVerificationWizard(f.runner, io, "human");
        assert.deepEqual(io.prompts, []);
        assert.equal((await readVerificationConfig(f.root)).raw, before);
        assert.match(
          io.lines.join("\n"),
          /Bootstrap mode is unavailable.*substantive profiles/
        );
        assert.ok(io.lines.includes("Profile: node (node)."));
        assert.ok(io.lines.includes("Fix: banzai verify remove node"));
        assert.ok(
          io.lines.includes(
            "Then run banzai init and explicitly confirm bootstrap mode."
          )
        );
        assert.doesNotMatch(io.lines.join("\n"), /coverage is deferred/);
      }
    }
    const before = (await readVerificationConfig(f.root)).raw;
    await executeVerificationCli(
      { command: "remove", profileId: "node" },
      f.runner,
      new ScriptedIO([false]),
      "human",
      true
    );
    assert.equal((await readVerificationConfig(f.root)).raw, before);
    await executeVerificationCli(
      { command: "remove", profileId: "node" },
      f.runner,
      new ScriptedIO([true]),
      "human",
      true
    );
    // The last fixture already had bootstrap=true; removal makes it effective.
    let config = (await readVerificationConfig(f.root)).config;
    delete config.verification.bootstrap;
    await writeFile(
      path.join(f.root, ".banzai/config.json"),
      JSON.stringify(config)
    );
    await runVerificationWizard(f.runner, new ScriptedIO([true]), "human");
    config = (await readVerificationConfig(f.root)).config;
    assert.equal(
      assessVerificationReadiness(
        config,
        await inspectVerificationProject(f.root)
      ).bootstrapEffective,
      true
    );
    assert.deepEqual(
      config.verification.profiles.map((p) => p.id),
      ["repository"]
    );
  } finally {
    await f.dispose();
  }
});

test("bootstrap conflict lists every substantive profile and never suggests removing the final profile", async () => {
  const f = await fixture();
  try {
    const config = (await readVerificationConfig(f.root)).config;
    const hygiene = config.verification.profiles[0];
    assert.ok(hygiene);
    config.verification.profiles = [
      {
        id: "node-checks",
        projectType: "node",
        commands: [
          { name: "test", command: "npm", args: ["test"], timeoutMs: 1000 }
        ]
      },
      {
        id: "python-checks",
        projectType: "python",
        commands: [
          {
            name: "test",
            command: "python",
            args: ["-m", "pytest"],
            timeoutMs: 1000
          }
        ]
      }
    ];
    for (const retainHygiene of [false, true]) {
      if (retainHygiene) config.verification.profiles.push(hygiene);
      const before = JSON.stringify(config);
      await writeFile(path.join(f.root, ".banzai/config.json"), before);
      const io = new ScriptedIO([]);
      await runVerificationWizard(f.runner, io, "human");
      assert.deepEqual(io.prompts, []);
      assert.equal((await readVerificationConfig(f.root)).raw, before);
      assert.ok(io.lines.includes("Profile: node-checks (node)."));
      assert.ok(io.lines.includes("Profile: python-checks (python)."));
      if (retainHygiene) {
        assert.deepEqual(
          io.lines.filter((line) => line.startsWith("Fix:")),
          [
            "Fix: banzai verify remove node-checks",
            "Fix: banzai verify remove python-checks"
          ]
        );
      } else {
        assert.match(io.lines.join("\n"), /final profile cannot be removed/);
        assert.doesNotMatch(io.lines.join("\n"), /banzai verify remove/);
      }
    }
  } finally {
    await f.dispose();
  }
});

test("Node wizard proposes only existing scripts and skip/decline preserve bytes", async () => {
  const f = await fixture();
  try {
    await writeFile(
      path.join(f.root, "package.json"),
      JSON.stringify({
        packageManager: "pnpm@10.0.0",
        scripts: { test: "exit 99", build: "exit 98", dev: "exit 97" }
      })
    );
    const before = (await readVerificationConfig(f.root)).raw;
    await runVerificationWizard(f.runner, new ScriptedIO(["skip"]), "human");
    assert.equal((await readVerificationConfig(f.root)).raw, before);
    await runVerificationWizard(
      f.runner,
      new ScriptedIO(["accept", false]),
      "human"
    );
    assert.equal((await readVerificationConfig(f.root)).raw, before);
    const io = new ScriptedIO(["accept", true]);
    await runVerificationWizard(f.runner, io, "human");
    const node = (
      await readVerificationConfig(f.root)
    ).config.verification.profiles.find(
      (profile) => profile.projectType === "node"
    );
    assert.deepEqual(
      node?.commands.map((command) => [command.command, ...command.args]),
      [
        ["pnpm", "run", "test"],
        ["pnpm", "run", "build"]
      ]
    );
    assert.equal(io.answers.length, 0);
  } finally {
    await f.dispose();
  }
});

test("explicit remove previews coverage, preserves final profile and shares the owner", async () => {
  const f = await fixture();
  try {
    await assert.rejects(
      executeVerificationCli(
        { command: "remove", profileId: "repository" },
        f.runner,
        new ScriptedIO([]),
        "human",
        true
      ),
      { code: "VERIFICATION_LAST_PROFILE" }
    );
    await writeFile(
      path.join(f.root, "package.json"),
      '{"scripts":{"test":"never run"},"packageManager":"npm@10.0.0"}'
    );
    await runVerificationWizard(
      f.runner,
      new ScriptedIO(["accept", true]),
      "human"
    );
    const lock = await new RunStore(f.root).acquireLock({
      reclaimStale: false
    });
    try {
      await assert.rejects(
        executeVerificationCli(
          { command: "remove", profileId: "node" },
          f.runner,
          new ScriptedIO([true]),
          "human",
          true
        ),
        /Answer there, or pause\/exit/u
      );
    } finally {
      await lock.release();
    }
    const io = new ScriptedIO([true]);
    assert.equal(
      await executeVerificationCli(
        { command: "remove", profileId: "node" },
        f.runner,
        io,
        "human",
        true
      ),
      0
    );
    assert.ok(io.lines.some((line) => line.includes("missing for node")));
    assert.equal(
      (await readVerificationConfig(f.root)).config.verification.profiles
        .length,
      1
    );
  } finally {
    await f.dispose();
  }
});

test("verify check runs all commands after exit, launch error and timeout; creates no run evidence", async () => {
  const f = await fixture();
  try {
    const { config } = await readVerificationConfig(f.root);
    config.verification.profiles = [
      {
        id: "custom",
        projectType: "custom",
        commands: ["fail", "missing", "timeout", "pass"].map((name) => ({
          name,
          command: "fake",
          args: [name],
          timeoutMs: 10
        }))
      }
    ];
    await writeFile(
      path.join(f.root, ".banzai/config.json"),
      JSON.stringify(config)
    );
    const called: string[] = [];
    const execute: ProcessRunner = async (spec) => {
      const name = spec.args[0] ?? "";
      called.push(name);
      if (name === "missing")
        throw Object.assign(new Error("Executable not found"), {
          code: "ENOENT"
        });
      return {
        exitCode: name === "pass" ? 0 : 1,
        signal: name === "timeout" ? "SIGTERM" : null,
        stdout: "",
        stderr: "",
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString()
      };
    };
    const io = new ScriptedIO([]);
    assert.equal(
      await executeVerificationCli(
        { command: "check" },
        new WorkflowRunner(f.root, createVendorAdapters(), execute),
        io,
        "human",
        false
      ),
      1
    );
    assert.deepEqual(called, ["fail", "missing", "timeout", "pass"]);
    assert.equal(
      io.lines.filter((line) => /^(?:Pass|Fail):/u.test(line)).length,
      4
    );
    await assert.rejects(
      readFile(path.join(f.root, ".banzai/active-run.json")),
      { code: "ENOENT" }
    );
  } finally {
    await f.dispose();
  }
});

test("verify grammar rejects unknown, extra, malformed and missing arguments", () => {
  for (const args of [
    [],
    ["add"],
    ["add", "repository"],
    ["add", "node", "extra"],
    ["check", "--help"],
    ["remove", "../x"],
    ["list", "x"]
  ])
    assert.throws(() => parseVerificationArgs(args));
  assert.deepEqual(parseVerificationArgs(["edit", "node"]), {
    command: "edit",
    profileId: "node"
  });
});

test("schema-3 explicit edit replaces changed IDs, preserves untouched IDs and allows hygiene edits", async () => {
  const f = await fixture();
  try {
    const { config } = await readVerificationConfig(f.root);
    config.schemaVersion = 3;
    const profile = config.verification.profiles[0];
    assert.ok(profile?.commands[0]);
    profile.commands[0].id = "hygiene";
    await writeFile(
      path.join(f.root, ".banzai/config.json"),
      JSON.stringify(config)
    );
    const io = new ScriptedIO([
      0,
      "edit",
      "Renamed hygiene",
      "git",
      "done",
      "2000",
      "done",
      "accept",
      true
    ]);
    await executeVerificationCli(
      { command: "edit", profileId: profile.id },
      f.runner,
      io,
      "human",
      true
    );
    const saved = (await readVerificationConfig(f.root)).config.verification
      .profiles[0];
    assert.ok(saved?.commands[0]);
    assert.notEqual(saved.commands[0].id, "hygiene");
    assert.equal(saved.commands[0].name, "Renamed hygiene");
    assert.deepEqual(saved.commands[0].args, ["diff", "--check"]);
    assert.ok(io.lines.some((line) => line.includes("old IDs cannot satisfy")));
    const before = (await readVerificationConfig(f.root)).raw;
    await executeVerificationCli(
      { command: "edit", profileId: profile.id },
      f.runner,
      new ScriptedIO(["done", "accept"]),
      "human",
      true
    );
    assert.equal((await readVerificationConfig(f.root)).raw, before);
  } finally {
    await f.dispose();
  }
});

for (const drift of ["config", "scripts"] as const) {
  test(`accepted review F2 refuses ${drift} drift during the editor`, async () => {
    const f = await fixture();
    try {
      const { config } = await readVerificationConfig(f.root);
      config.schemaVersion = 3;
      const hygiene = config.verification.profiles[0]?.commands[0];
      assert.ok(hygiene);
      hygiene.id = "hygiene";
      config.verification.profiles.push({
        id: "node",
        projectType: "node",
        commands: [
          {
            id: "original-check",
            name: "original",
            command: "npm",
            args: ["run", "test"],
            timeoutMs: 1000
          }
        ]
      });
      const configPath = path.join(f.root, ".banzai/config.json");
      await writeFile(configPath, JSON.stringify(config));
      await writeFile(
        path.join(f.root, "package.json"),
        JSON.stringify({
          packageManager: "npm@10.0.0",
          scripts: { test: "original" }
        })
      );
      const io = new ScriptedIO(["done", "accept", true]);
      const select = io.select.bind(io);
      let expectedConfig = "";
      io.select = async (message, choices) => {
        if (message === "Profile commands") {
          if (drift === "config") {
            const original = config.verification.profiles[1]?.commands[0];
            assert.ok(original);
            original.name = "external-change";
            await writeFile(configPath, JSON.stringify(config));
          } else
            await writeFile(
              path.join(f.root, "package.json"),
              JSON.stringify({ scripts: { test: "external-change" } })
            );
          expectedConfig = await readFile(configPath, "utf8");
        }
        return select(message, choices);
      };
      await assert.rejects(
        executeVerificationCli(
          { command: "edit", profileId: "node" },
          f.runner,
          io,
          "human",
          true
        ),
        { code: "CONFIGURATION_PROPOSAL_STALE" }
      );
      assert.equal(await readFile(configPath, "utf8"), expectedConfig);
      assert.equal(
        io.prompts.includes("Save this exact verification profile?"),
        false
      );
    } finally {
      await f.dispose();
    }
  });
}

test("accepted review F6 list distinguishes missing, deferred, mixed and unavailable coverage read-only", async () => {
  const f = await fixture();
  try {
    const configPath = path.join(f.root, ".banzai/config.json");
    const show = async () => {
      const before = await readFile(configPath, "utf8");
      const io = new ScriptedIO([]);
      await executeVerificationCli(
        { command: "list" },
        f.runner,
        io,
        "human",
        false
      );
      assert.equal(await readFile(configPath, "utf8"), before);
      return io.lines.join("\n");
    };
    await writeFile(
      path.join(f.root, "package.json"),
      '{"scripts":{"test":"anything"}}'
    );
    assert.match(await show(), /coverage.*missing for node/iu);
    const { config } = await readVerificationConfig(f.root);
    config.verification.profiles.push({
      id: "node",
      projectType: "node",
      commands: [
        { name: "test", command: "npm", args: ["run", "test"], timeoutMs: 1000 }
      ]
    });
    await writeFile(configPath, JSON.stringify(config));
    await writeFile(path.join(f.root, "composer.json"), "{}");
    assert.match(await show(), /coverage.*missing for php/iu);
    await rm(path.join(f.root, "package.json"));
    await rm(path.join(f.root, "composer.json"));
    config.verification.profiles.pop();
    config.verification.bootstrap = true;
    await writeFile(configPath, JSON.stringify(config));
    assert.match(await show(), /coverage.*deferred.*bootstrap/iu);
    await writeFile(path.join(f.root, "package.json"), "{");
    assert.match(await show(), /coverage.*unavailable/iu);
  } finally {
    await f.dispose();
  }
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  test(
    `accepted review F4 committed verify check drains children on ${signal}`,
    { timeout: 15000 },
    async () => {
      const { spawn } = await import("node:child_process");
      const { createTestRepository, monochromeEnv } =
        await import("./helpers.js");
      const repository = await createTestRepository();
      let cli: ReturnType<typeof spawn> | undefined;
      let childPid: number | undefined;
      try {
        const pidPath = path.join(repository.root, "check.pid");
        const laterPath = path.join(repository.root, "later.txt");
        const commands = [
          {
            name: "long command",
            command: process.execPath,
            args: [
              "-e",
              `require('node:fs').writeFileSync(${JSON.stringify(pidPath)},String(process.pid));setInterval(()=>{},1000)`
            ],
            timeoutMs: 60000
          },
          {
            name: "later command",
            command: process.execPath,
            args: [
              "-e",
              `require('node:fs').writeFileSync(${JSON.stringify(laterPath)},'ran')`
            ],
            timeoutMs: 1000
          }
        ];
        const { config } = await readVerificationConfig(repository.root);
        config.verification.profiles = [
          { id: "node", projectType: "node", commands }
        ];
        await writeFile(
          path.join(repository.root, ".banzai/config.json"),
          JSON.stringify(config)
        );
        cli = spawn(
          process.execPath,
          [path.join(process.cwd(), "dist/banzai.mjs"), "verify", "check"],
          {
            cwd: repository.root,
            env: monochromeEnv(),
            stdio: ["ignore", "pipe", "pipe"]
          }
        );
        let output = "";
        assert.ok(cli.stdout);
        assert.ok(cli.stderr);
        cli.stdout.on("data", (chunk: Buffer) => {
          output += chunk.toString();
        });
        cli.stderr.on("data", (chunk: Buffer) => {
          output += chunk.toString();
        });
        const child = cli;
        const done = new Promise<{
          code: number | null;
          signal: NodeJS.Signals | null;
        }>((resolve) => {
          child.once("close", (code, stoppedBy) => {
            resolve({ code, signal: stoppedBy });
          });
        });
        for (let i = 0; i < 100; i++) {
          try {
            childPid = Number(await readFile(pidPath, "utf8"));
            break;
          } catch {
            await new Promise((resolve) => setTimeout(resolve, 25));
          }
        }
        assert.ok(childPid, output);
        cli.kill(signal);
        const exit = await done;
        assert.ok(exit.code !== 0 || exit.signal !== null);
        const checkedPid = childPid;
        assert.throws(() => process.kill(checkedPid, 0), { code: "ESRCH" });
        assert.match(output, /Not run: later command.*interrupt/iu);
        await assert.rejects(readFile(laterPath), { code: "ENOENT" });
        await assert.rejects(
          readFile(path.join(repository.root, ".banzai/runner.lock")),
          { code: "ENOENT" }
        );
      } finally {
        if (childPid) {
          try {
            process.kill(-childPid, "SIGKILL");
          } catch {
            /* already drained */
          }
        }
        cli?.kill("SIGKILL");
        await repository.dispose();
      }
    }
  );
}

test("guided legacy command metadata stays inert in list, remove preview and every check outcome", async () => {
  const f = await fixture();
  try {
    const current = await readVerificationConfig(f.root);
    const canary = "CANARY\u001b[2J\u009b2J\u202e";
    const config = current.config;
    config.verification.profiles.push({
      id: "legacy",
      projectType: "custom",
      commands: [
        { name: canary, command: "legacy", args: [canary], timeoutMs: 1000 },
        { name: canary, command: "later", args: [], timeoutMs: 1000 }
      ]
    });
    const filename = path.join(f.root, ".banzai/config.json");
    const bytes = JSON.stringify(config);
    await writeFile(filename, bytes);
    const outputs: string[] = [];
    for (const command of [
      { command: "list" as const },
      { command: "remove" as const, profileId: "legacy" }
    ]) {
      const io = new ScriptedIO(command.command === "remove" ? [false] : []);
      await executeVerificationCli(command, f.runner, io, "human", true);
      outputs.push(...io.lines, ...io.prompts);
    }
    const { BanzaiError } = await import("../src/errors.js");
    for (const outcome of ["pass", "fail", "launch", "stale"] as const) {
      const io = new ScriptedIO([]);
      const runner = new WorkflowRunner(
        f.root,
        createVendorAdapters(),
        async () => {
          if (outcome === "launch") throw new Error(canary);
          if (outcome === "stale")
            throw new BanzaiError("CONFIGURATION_PROPOSAL_STALE", canary);
          return {
            exitCode: outcome === "pass" ? 0 : 1,
            signal: null,
            stdout: "",
            stderr: "",
            startedAt: new Date().toISOString(),
            completedAt: new Date().toISOString()
          };
        }
      );
      assert.equal(
        await executeVerificationCli(
          { command: "check" },
          runner,
          io,
          "human",
          false
        ),
        outcome === "pass" ? 0 : 1
      );
      outputs.push(...io.lines);
    }
    assert.doesNotMatch(outputs.join("\n"), /[\u001b\u009b\u202e]/u);
    assert.match(outputs.join("\n"), /\\u009b/u);
    assert.match(outputs.join("\n"), /Not run:.*CANARY/u);
    assert.equal(await readFile(filename, "utf8"), bytes);
  } finally {
    await f.dispose();
  }
});
