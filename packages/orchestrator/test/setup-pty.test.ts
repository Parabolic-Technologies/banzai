import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { ADOPTED_AGENTS, POPULATED_MANIFEST } from "./adoption-fixtures.js";
import {
  monochromeEnv,
  reviewerOnlyClaudeConfig,
  snapshotTree
} from "./helpers.js";

interface PtyResult {
  exitCode: number;
  output: string;
  steps: number;
  terminalRestored: boolean;
}
interface StubCapture {
  args: string[];
  cwd: string;
  pid: number;
  descendant?: number;
  tty: boolean[];
  env: Record<string, string>;
}
interface PtyAction {
  wait: string;
  send?: string;
  signal?: string;
}
const sourceCli = path.resolve("dist/banzai.mjs");
const driver = path.resolve("test/pty-driver.py");

/** A killed orphan stays signalable as a zombie when the job's init never
 * reaps it (container CI runs under `tail -f /dev/null`), so signal 0 alone
 * cannot prove termination; on Linux the kernel state tells a corpse apart. */
async function assertProcessGone(pid: number): Promise<void> {
  try {
    process.kill(pid, 0);
  } catch {
    return;
  }
  let state = "";
  try {
    const stat = await readFile(`/proc/${pid}/stat`, "utf8");
    state = stat.charAt(stat.lastIndexOf(")") + 2);
  } catch {
    /* No procfs: a signalable process is running. */
  }
  assert.equal(state, "Z", `Process ${pid} is still running.`);
}

async function fixture() {
  const base = await mkdtemp(path.join(tmpdir(), "banzai-setup-pty-"));
  const root = path.join(base, "project");
  const plugin = path.join(base, "independently-installed-plugin");
  const bin = path.join(base, "bin");
  const cli = path.join(base, "npm-package", "dist", "banzai.mjs");
  const capture = path.join(base, "stub-capture.json");
  await mkdir(root);
  await mkdir(bin);
  await mkdir(path.dirname(cli), { recursive: true });
  await cp(sourceCli, cli);
  await symlink(
    path.resolve("../../node_modules"),
    path.join(base, "npm-package", "node_modules"),
    "dir"
  );
  await cp(path.resolve("../../plugins/banzai"), plugin, { recursive: true });
  const git = spawnSync("git", ["init", "-q"], { cwd: root, encoding: "utf8" });
  assert.equal(git.status, 0, git.stderr);
  const script = `#!${process.execPath}
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
const vendor=path.basename(process.argv[1]); const args=process.argv.slice(2); const key=args.join(' ');
const plugin=${JSON.stringify(plugin)};
if(key==='--help') { console.log('--ask-for-approval --permission-mode'); process.exit(0); }
if(key==='--version') { console.log(vendor==='codex'?'codex-cli 0.145.0':'2.1.218'); process.exit(0); }
if(key==='login status') { if(process.env.BANZAI_TEST_REMOVE_EXECUTABLE==='1') fs.unlinkSync(process.argv[1]); console.log('Logged in using ChatGPT'); process.exit(0); }
if(key==='auth status --json') { console.log(JSON.stringify({loggedIn:true,authMethod:'oauth',apiProvider:'firstparty'})); process.exit(0); }
if(key==='plugin marketplace list --json') { console.log(JSON.stringify({marketplaces:[{name:'local-banzai',root:plugin}]})); process.exit(0); }
if(key==='plugin list --marketplace local-banzai --json') { console.log(JSON.stringify({installed:[{name:'banzai',marketplaceName:'local-banzai',installed:true,enabled:true,source:{source:'local',path:plugin}}]})); process.exit(0); }
if(key==='plugin list --json' && vendor==='claude') { console.log(JSON.stringify([{id:'banzai@local',enabled:true,installPath:plugin}])); process.exit(0); }
if(key==='mcp get serena --json') { console.log('{}'); process.exit(0); }
// Model the documented Claude --mcp-config <configs...> transport boundary.
if(vendor==='claude') {
  const start=args.indexOf('--mcp-config');
  if(start!==-1) for(let i=start+1;i<args.length&&!args[i].startsWith('-');i++) {
    try { JSON.parse(args[i]); }
    catch { if(!fs.existsSync(args[i])) { console.error('Error: Invalid MCP configuration: MCP config file not found: '+args[i]); process.exit(1); } }
  }
}
let descendant;
if(process.env.BANZAI_TEST_DESCENDANT==='1') {
  descendant=spawn(process.execPath,['-e',"process.on('SIGINT',()=>{});process.on('SIGTERM',()=>{});process.stdout.write('READY');setInterval(()=>{},1000)"],{stdio:['ignore','pipe','ignore']});
  await once(descendant.stdout,'data');
}
fs.writeFileSync(${JSON.stringify(capture)},JSON.stringify({args,cwd:process.cwd(),pid:process.pid,descendant:descendant?.pid,tty:[process.stdin.isTTY,process.stdout.isTTY,process.stderr.isTTY],env:Object.fromEntries(Object.entries(process.env).filter(([k])=>k.startsWith('BANZAI_')||k.includes('API_KEY')||k==='CLAUDECODE'))}));
process.stdin.setRawMode(true); process.stdin.resume(); console.log('BOOTSTRAP_QUESTION');
process.stdin.on('data',data=>{ if(data.toString().includes('a')) { fs.writeFileSync('AGENTS.md',${JSON.stringify(ADOPTED_AGENTS)}); fs.writeFileSync('PROJECT_MANIFEST.md',${JSON.stringify(POPULATED_MANIFEST)}); }
if(data.toString().includes('a')||data.toString().includes('q')) process.exit(0); });
`;
  for (const vendor of ["codex", "claude"]) {
    await writeFile(path.join(bin, vendor), script);
    await chmod(path.join(bin, vendor), 0o755);
  }
  const env = monochromeEnv({
    PATH: `${bin}${path.delimiter}/usr/bin${path.delimiter}/bin`,
    HOME: base,
    CODEX_HOME: base,
    TERM: "xterm-256color",
    OPENAI_API_KEY: "FORBIDDEN_SECRET",
    ANTHROPIC_API_KEY: "FORBIDDEN_SECRET",
    BANZAI_APPROVAL_DIGEST: "FORBIDDEN_GRANT",
    BANZAI_WORKFLOW_DIGEST: "FORBIDDEN_GRANT",
    BANZAI_REVIEW_ARTIFACT: "FORBIDDEN_GRANT"
  });
  delete env.BANZAI_RUN_ID;
  delete env.CLAUDECODE;
  const run = (args: string[], actions: PtyAction[]): PtyResult => {
    const result = spawnSync("python3", [driver], {
      input: JSON.stringify({
        argv: [process.execPath, cli, ...args],
        cwd: root,
        env,
        actions,
        timeout: 20
      }),
      encoding: "utf8",
      timeout: 25_000,
      maxBuffer: 1024 * 1024
    });
    assert.equal(
      result.status,
      0,
      result.error && "code" in result.error && result.error.code === "ENOENT"
        ? "Setup PTY tests require python3 on PATH (standard library only); missing Python fails the suite."
        : result.stderr || String(result.error)
    );
    const value = JSON.parse(result.stdout) as PtyResult;
    assert.equal(value.steps, actions.length, value.output);
    assert.equal(value.terminalRestored, true, value.output);
    return value;
  };
  const configure = async () => {
    await mkdir(path.join(root, ".banzai"), { recursive: true });
    // The recommended setup client follows the planning vendor, and these
    // flows are written against a Codex planner.
    await writeFile(
      path.join(root, ".banzai/config.json"),
      JSON.stringify(reviewerOnlyClaudeConfig())
    );
  };
  return {
    root,
    base,
    cli,
    capture,
    env,
    run,
    configure,
    dispose: async () => {
      await rm(base, { recursive: true, force: true });
    }
  };
}

test("setup PTY fresh and repeated init preserve default wording and offer manual setup on unborn HEAD", async () => {
  const host = await fixture();
  delete host.env.BANZAI_RUN_ID;
  delete host.env.BANZAI_APPROVAL_DIGEST;
  delete host.env.BANZAI_WORKFLOW_DIGEST;
  try {
    for (const fresh of [true, false]) {
      const result = host.run(
        ["init"],
        [
          { wait: "Planning model", send: "\r" },
          { wait: "Implementation model", send: "\r" },
          { wait: "Review model", send: "\r" },
          { wait: "? Project setup", send: "\u001b[B\u001b[B\r" },
          { wait: "explicitly invoke:", send: "\u001b[B\u001b[B\u001b[B\r" }
        ]
      );
      assert.equal(result.exitCode, 0, result.output);
      assert.match(result.output, fresh ? /Use default/ : /Keep /);
      const guideNotice = `${fresh ? "Created" : "Kept existing"} documentation/verification-examples.md.`;
      assert.ok(result.output.includes(guideNotice));
      assert.ok(
        result.output.indexOf(guideNotice) <
          result.output.indexOf("Planning model")
      );
      assert.match(
        await readFile(
          path.join(host.root, "documentation/verification-examples.md"),
          "utf8"
        ),
        /# Task Verification/
      );
      assert.match(
        result.output,
        /Banzai configuration saved\.[\s\S]*Project setup required\s+PROJECT_MANIFEST\.md\s+Missing\s+AGENTS\.md\s+Missing\s+CLAUDE\.md\s+Missing \(created during setup\)\s+Run banzai:project-manifest to prepare project guidance\./
      );
      assert.match(
        result.output,
        /The Banzai plugin must be installed and enabled in your chosen client before invoking the skill\./
      );
      assert.match(result.output, /\$banzai:project-manifest/);
      assert.doesNotMatch(
        result.output,
        /What should Banzai implement|GIT_INITIAL_COMMIT_REQUIRED/
      );
      // The hook grants a fresh project's writes, so nothing stops its first run.
      assert.doesNotMatch(result.output, /Claude permissions:/);
    }
    await assert.rejects(readFile(host.capture), /ENOENT/);
    await assert.rejects(readdir(path.join(host.root, ".claude")), /ENOENT/);
  } finally {
    await host.dispose();
  }
});

test("setup PTY independently packaged CLI transfers each explicit skill with TTY and no grants, then reinspects", async (t) => {
  for (const vendor of ["codex", "claude"])
    await t.test(vendor, async () => {
      const host = await fixture();
      try {
        await host.configure();
        if (vendor === "claude") {
          await mkdir(path.join(host.root, ".serena"));
          await writeFile(
            path.join(host.root, ".serena/project.yml"),
            "project_name: setup-fixture\n"
          );
          await writeFile(
            path.join(host.root, ".mcp.json"),
            JSON.stringify({
              mcpServers: { serena: { command: process.execPath, args: [] } }
            })
          );
        }
        const result = host.run(
          ["setup"],
          [
            {
              wait: "Project setup",
              send: vendor === "codex" ? "\r" : "\u001b[B\r"
            },
            { wait: "BOOTSTRAP_QUESTION", send: "a" }
          ]
        );
        assert.equal(result.exitCode, 0, result.output);
        assert.match(
          result.output,
          /Project guidance ready\s+PROJECT_MANIFEST\.md\s+Present\s+AGENTS\.md\s+Present\s+CLAUDE\.md\s+Missing \(optional\)/
        );
        assert.doesNotMatch(result.output, /What should Banzai implement/);
        assert.doesNotMatch(result.output, /Claude permissions:/);
        const captured = JSON.parse(
          await readFile(host.capture, "utf8")
        ) as StubCapture;
        assert.equal(captured.cwd, await realpath(host.root));
        assert.deepEqual(captured.tty, [true, true, true]);
        assert.equal(
          captured.args.at(-1),
          vendor === "codex"
            ? "$banzai:project-manifest"
            : "/banzai:project-manifest"
        );
        if (vendor === "claude") {
          const mcpIndex = captured.args.indexOf("--mcp-config");
          assert.notEqual(mcpIndex, -1);
          assert.deepEqual(JSON.parse(captured.args[mcpIndex + 1] ?? ""), {
            mcpServers: {
              serena: {
                type: "stdio",
                command: process.execPath,
                args: [],
                env: {}
              }
            }
          });
          assert.deepEqual(
            captured.args.slice(captured.args.indexOf("--") + 1),
            ["/banzai:project-manifest"]
          );
        }
        assert.doesNotMatch(
          JSON.stringify(captured),
          /FORBIDDEN_SECRET|FORBIDDEN_GRANT|dontAsk|bypass|--output-schema|approvals_reviewer/
        );
        assert.deepEqual(
          (await snapshotTree(path.join(host.root, ".banzai"))).map(
            (entry) => entry.path
          ),
          ["config.json"]
        );
        assert.equal(host.run(["setup"], []).exitCode, 0);
      } finally {
        await host.dispose();
      }
    });
});

test("setup PTY incomplete exit and signals restore the terminal and release ownership", async (t) => {
  for (const action of ["incomplete", "SIGINT", "SIGTERM"])
    await t.test(action, async () => {
      const host = await fixture();
      try {
        await host.configure();
        if (action !== "incomplete") host.env.BANZAI_TEST_DESCENDANT = "1";
        const result = host.run(
          ["setup"],
          [
            { wait: "Project setup", send: "\r" },
            action === "incomplete"
              ? { wait: "BOOTSTRAP_QUESTION", send: "q" }
              : { wait: "BOOTSTRAP_QUESTION", signal: action },
            ...(action === "incomplete"
              ? [
                  {
                    wait: "Choose a fresh action",
                    send: "\u001b[B\u001b[B\u001b[B\r"
                  }
                ]
              : [])
          ]
        );
        assert.equal(
          result.exitCode,
          action === "SIGINT" ? 130 : action === "SIGTERM" ? 143 : 0,
          result.output
        );
        await assert.rejects(
          readFile(path.join(host.root, ".banzai/runner.lock")),
          /ENOENT/
        );
        const captured = JSON.parse(
          await readFile(host.capture, "utf8")
        ) as StubCapture;
        await assertProcessGone(captured.pid);
        if (captured.descendant !== undefined)
          await assertProcessGone(captured.descendant);
        assert.doesNotMatch(result.output, /Project guidance ready/);
      } finally {
        await host.dispose();
      }
    });
});

test("setup CLI non-TTY init creates local verification guidance without launching a client", async () => {
  const host = await fixture();
  delete host.env.BANZAI_RUN_ID;
  delete host.env.BANZAI_APPROVAL_DIGEST;
  delete host.env.BANZAI_WORKFLOW_DIGEST;
  try {
    // A refusing rule is the one permission gap that stops the first run, so
    // init names it and leaves the operator's settings untouched.
    const settings = path.join(host.root, ".claude/settings.json");
    const refusal = `${JSON.stringify({ permissions: { deny: ["Write"] } })}\n`;
    await mkdir(path.dirname(settings));
    await writeFile(settings, refusal);
    for (const args of [[], ["setup"], ["init"]]) {
      const result = spawnSync(process.execPath, [host.cli, ...args], {
        cwd: host.root,
        env: host.env,
        encoding: "utf8"
      });
      assert.equal(result.status, args[0] === "setup" ? 1 : 0, result.stderr);
      if (args[0] === "setup") {
        assert.match(result.stderr, /TTY_REQUIRED.*banzai:project-manifest/);
        assert.match(
          result.stderr,
          /The Banzai plugin must be installed and enabled in your chosen client before invoking the skill\./
        );
      } else if (args[0] === "init") {
        assert.match(
          result.stdout,
          /Created documentation\/verification-examples\.md/
        );
        const guidePath = path.join(
          host.root,
          "documentation/verification-examples.md"
        );
        const guide = await readFile(guidePath, "utf8");
        const canonical = await readFile(
          path.resolve("../../documentation/verification-examples.md"),
          "utf8"
        );
        assert.equal(
          guide,
          canonical.replace(
            /\]\((getting-started|orchestrator)\.md/g,
            "](https://github.com/Parabolic-Technologies/banzai/blob/main/documentation/$1.md"
          )
        );
        assert.match(guide, /without verification profiles/);
        assert.match(
          result.stdout,
          /Claude permissions: A deny or ask rule refuses Write\.[^\n]*\nFix it before the first run: remove the deny or ask rules naming "Write"[^\n]*\.\nRun banzai doctor/
        );
        assert.equal(await readFile(settings, "utf8"), refusal);
        await writeFile(
          guidePath,
          "# Project-specific checks\r\nKeep my edits.\r\n"
        );
        const rerun = spawnSync(process.execPath, [host.cli, "init"], {
          cwd: host.root,
          env: host.env,
          encoding: "utf8"
        });
        assert.equal(rerun.status, 0, rerun.stderr);
        assert.match(
          rerun.stdout,
          /Kept existing documentation\/verification-examples\.md/
        );
        assert.equal(
          await readFile(guidePath, "utf8"),
          "# Project-specific checks\r\nKeep my edits.\r\n"
        );
        await rm(guidePath);
        const repair = spawnSync(process.execPath, [host.cli, "init"], {
          cwd: host.root,
          env: host.env,
          encoding: "utf8"
        });
        assert.equal(repair.status, 0, repair.stderr);
        assert.equal(await readFile(guidePath, "utf8"), guide);
        assert.match(result.stdout, /Run banzai setup in a terminal/);
        assert.match(
          result.stdout,
          /The Banzai plugin must be installed and enabled in your chosen client before invoking the skill\./
        );
      } else assert.match(result.stdout, /Usage:/);
    }
    await assert.rejects(readFile(host.capture), /ENOENT/);
  } finally {
    await host.dispose();
  }
});

test("init refuses unsafe verification guidance paths before creating configuration", async () => {
  const host = await fixture();
  const outside = await mkdtemp(path.join(tmpdir(), "banzai-init-outside-"));
  delete host.env.BANZAI_RUN_ID;
  delete host.env.BANZAI_APPROVAL_DIGEST;
  delete host.env.BANZAI_WORKFLOW_DIGEST;
  const directory = path.join(host.root, "documentation");
  const guide = path.join(directory, "verification-examples.md");
  try {
    for (const kind of [
      "directory-link",
      "file-link",
      "dangling-link",
      "directory-file"
    ] as const) {
      if (kind === "directory-link") await symlink(outside, directory);
      else {
        await mkdir(directory);
        if (kind === "directory-file") await mkdir(guide);
        else {
          const target = path.join(outside, "verification-examples.md");
          if (kind === "file-link")
            await writeFile(target, "Keep outside content.");
          await symlink(target, guide);
        }
      }
      const before = await snapshotTree(outside);
      const result = spawnSync(process.execPath, [host.cli, "init"], {
        cwd: host.root,
        env: host.env,
        encoding: "utf8"
      });
      assert.equal(result.status, 1, result.stdout);
      assert.match(result.stderr, /regular files without symlinks/);
      assert.deepEqual(await snapshotTree(outside), before);
      await assert.rejects(
        readFile(path.join(host.root, ".banzai/config.json")),
        /ENOENT/
      );
      await rm(directory, { recursive: true, force: true });
      await rm(path.join(outside, "verification-examples.md"), { force: true });
    }
  } finally {
    await host.dispose();
    await rm(outside, { recursive: true, force: true });
  }
});

test("setup PTY spawn failure returns to a usable menu and leaves no ownership", async () => {
  const host = await fixture();
  try {
    await host.configure();
    host.env.BANZAI_TEST_REMOVE_EXECUTABLE = "1";
    const result = host.run(
      ["setup"],
      [
        { wait: "Project setup", send: "\r" },
        {
          wait: "Run project-manifest with Claude Code (Recommended)",
          send: "\u001b[B\u001b[B\u001b[B\r"
        }
      ]
    );
    assert.equal(result.exitCode, 0, result.output);
    assert.match(result.output, /Project setup is incomplete/);
    await assert.rejects(
      readFile(path.join(host.root, ".banzai/runner.lock")),
      /ENOENT/
    );
    await assert.rejects(readFile(host.capture), /ENOENT/);
  } finally {
    await host.dispose();
  }
});

test("setup PTY task entry offers guidance first and keeps initial commit as a separate prerequisite", async () => {
  const host = await fixture();
  try {
    await host.configure();
    const incomplete = host.run(
      [],
      [{ wait: "Project setup", send: "\u001b[B\u001b[B\u001b[B\r" }]
    );
    assert.equal(incomplete.exitCode, 0, incomplete.output);
    assert.doesNotMatch(incomplete.output, /What should Banzai implement/);
    await writeFile(path.join(host.root, "AGENTS.md"), ADOPTED_AGENTS);
    await writeFile(
      path.join(host.root, "PROJECT_MANIFEST.md"),
      POPULATED_MANIFEST
    );
    const ready = host.run([], []);
    assert.equal(ready.exitCode, 1, ready.output);
    assert.match(ready.output, /GIT_INITIAL_COMMIT_REQUIRED/);
    assert.doesNotMatch(ready.output, /What should Banzai implement/);
  } finally {
    await host.dispose();
  }
});

const LOCAL_MODEL_FILE = ".banzai/config.local.json";
const RUN_STATE_IGNORES =
  ".banzai/runs/\n.banzai/active-run.json\n.banzai/runner.lock\n.banzai/config.local.json\n";

async function readOptional(target: string): Promise<string | null> {
  try {
    return await readFile(target, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

test("model PTY asks where to save when the shared file is tracked and writes only the chosen file", async () => {
  const host = await fixture();
  try {
    await host.configure();
    await writeFile(path.join(host.root, ".gitignore"), RUN_STATE_IGNORES);
    const add = spawnSync("git", ["add", "--", ".banzai/config.json"], {
      cwd: host.root,
      encoding: "utf8"
    });
    assert.equal(add.status, 0, add.stderr);
    const files = async () => ({
      shared: await readFile(
        path.join(host.root, ".banzai/config.json"),
        "utf8"
      ),
      local: await readOptional(path.join(host.root, LOCAL_MODEL_FILE)),
      gitignore: await readFile(path.join(host.root, ".gitignore"), "utf8"),
      exclude: await readOptional(path.join(host.root, ".git/info/exclude"))
    });
    const before = await files();

    // A model phase never reaches the picker.
    const denied = host.run(["model"], [{ wait: "Model phases" }]);
    assert.notEqual(denied.exitCode, 0, denied.output);
    assert.match(denied.output, /CONFIGURATION_MODEL_WRITE_DENIED/);
    assert.doesNotMatch(denied.output, /Where should these model choices/);
    assert.deepEqual(await files(), before);
    delete host.env.BANZAI_APPROVAL_DIGEST;
    delete host.env.BANZAI_WORKFLOW_DIGEST;

    // "This machine only" is the first answer.
    const local = host.run(
      ["model"],
      [
        { wait: "Where should these model choices be saved?", send: "\r" },
        { wait: "Planning model", send: "\r" },
        { wait: "Implementation model", send: "\r" },
        { wait: "Review model", send: "\u001b[B\u001b[B\r" },
        { wait: "Review effort", send: "\r" },
        {
          wait: "Write these changes to .banzai/config.local.json?",
          send: "y\r"
        },
        { wait: "Updated .banzai/config.local.json for this machine only." }
      ]
    );
    assert.equal(local.exitCode, 0, local.output);
    assert.ok(
      local.output.indexOf("This machine only") <
        local.output.indexOf("Shared with the team"),
      local.output
    );
    assert.match(local.output, /Git ignores it, so there is nothing to commit/);
    const afterLocal = await files();
    assert.deepEqual(
      { ...afterLocal, local: before.local },
      before,
      "only the local file changes"
    );
    const layer = JSON.parse(afterLocal.local ?? "null") as {
      schemaVersion: number;
      models: Record<string, { executable: string; model: string }>;
    };
    assert.equal(layer.schemaVersion, 1);
    assert.deepEqual(Object.keys(layer.models), ["reviewer"]);
    assert.equal(layer.models.reviewer?.executable, "claude");
    assert.equal(layer.models.reviewer.model, "claude-fable-5-1");

    // The shared answer writes .banzai/config.json and keeps the local layer.
    const shared = host.run(
      ["model"],
      [
        {
          wait: "Where should these model choices be saved?",
          send: "\u001b[B\r"
        },
        { wait: "Planning model", send: "\r" },
        { wait: "Implementation model", send: "\r" },
        { wait: "Review model", send: "\u001b[B\u001b[B\r" },
        { wait: "Review effort", send: "\r" },
        { wait: "Write these changes to .banzai/config.json?", send: "y\r" },
        { wait: "Updated .banzai/config.json. Review and commit the change." }
      ]
    );
    assert.equal(shared.exitCode, 0, shared.output);
    assert.match(
      shared.output,
      /This machine keeps using its local Review setting: claude claude-fable-5-1 effort=\S+ \(\.banzai\/config\.local\.json\)\./
    );
    const afterShared = await files();
    assert.equal(afterShared.local, afterLocal.local);
    assert.equal(afterShared.gitignore, before.gitignore);
    assert.equal(afterShared.exclude, before.exclude);
    assert.equal(
      (
        JSON.parse(afterShared.shared) as {
          models: { reviewer: { model: string } };
        }
      ).models.reviewer.model,
      "claude-fable-5-1"
    );
    await assert.rejects(readFile(host.capture), /ENOENT/);
  } finally {
    await host.dispose();
  }
});

test("init PTY never asks where to save and names the kept local setting", async () => {
  const host = await fixture();
  delete host.env.BANZAI_APPROVAL_DIGEST;
  delete host.env.BANZAI_WORKFLOW_DIGEST;
  try {
    await host.configure();
    const localText = `${JSON.stringify(
      {
        schemaVersion: 1,
        models: {
          reviewer: { executable: "codex", model: "gpt-6-sol", effort: "high" }
        }
      },
      null,
      2
    )}\n`;
    await writeFile(path.join(host.root, LOCAL_MODEL_FILE), localText);
    const shared = await readFile(
      path.join(host.root, ".banzai/config.json"),
      "utf8"
    );
    const result = host.run(
      ["init"],
      [
        { wait: "Planning model", send: "\r" },
        { wait: "Implementation model", send: "\r" },
        { wait: "Review model", send: "\r" },
        { wait: "? Project setup", send: "\u001b[B\u001b[B\r" },
        { wait: "explicitly invoke:", send: "\u001b[B\u001b[B\u001b[B\r" }
      ]
    );
    assert.equal(result.exitCode, 0, result.output);
    assert.doesNotMatch(result.output, /Where should these model choices/);
    assert.match(
      result.output,
      /This machine uses codex gpt-6-sol effort=high \(local\)\./
    );
    assert.match(
      result.output,
      /This machine keeps using its local Review setting: codex gpt-6-sol effort=high \(\.banzai\/config\.local\.json\)\./
    );
    assert.equal(
      await readFile(path.join(host.root, LOCAL_MODEL_FILE), "utf8"),
      localText
    );
    assert.equal(
      await readFile(path.join(host.root, ".banzai/config.json"), "utf8"),
      shared
    );
    // Init's own .gitignore line covers the file, so the exclude file is untouched.
    assert.match(
      await readFile(path.join(host.root, ".gitignore"), "utf8"),
      /^\.banzai\/config\.local\.json$/mu
    );
    assert.doesNotMatch(
      (await readOptional(path.join(host.root, ".git/info/exclude"))) ?? "",
      /config\.local\.json/
    );
  } finally {
    await host.dispose();
  }
});

test("launch PTY refuses a defective or tracked local file before any vendor executable starts", async () => {
  const host = await fixture();
  delete host.env.BANZAI_APPROVAL_DIGEST;
  delete host.env.BANZAI_WORKFLOW_DIGEST;
  try {
    await host.configure();
    await writeFile(path.join(host.root, ".gitignore"), RUN_STATE_IGNORES);
    const git = (...args: string[]) => {
      const result = spawnSync(
        "git",
        [
          "-c",
          "user.name=Banzai Tests",
          "-c",
          "user.email=tests@banzai.local",
          ...args
        ],
        { cwd: host.root, encoding: "utf8" }
      );
      assert.equal(result.status, 0, result.stderr);
    };
    // An adopted project with a commit reaches the launch header.
    await writeFile(path.join(host.root, "AGENTS.md"), ADOPTED_AGENTS);
    await writeFile(
      path.join(host.root, "PROJECT_MANIFEST.md"),
      POPULATED_MANIFEST
    );
    git(
      "add",
      "--",
      ".gitignore",
      ".banzai/config.json",
      "AGENTS.md",
      "PROJECT_MANIFEST.md"
    );
    git("commit", "-q", "--no-gpg-sign", "-m", "configure");
    // Every vendor invocation is logged before it reaches the stub.
    const logged = path.join(host.base, "logged-bin");
    const log = path.join(host.base, "vendor-invocations.log");
    await mkdir(logged);
    for (const vendor of ["claude", "codex"]) {
      await writeFile(
        path.join(logged, vendor),
        `#!/bin/sh\nprintf '%s\\n' "${vendor} $*" >> ${JSON.stringify(log)}\nexec ${JSON.stringify(path.join(host.base, "bin", vendor))} "$@"\n`
      );
      await chmod(path.join(logged, vendor), 0o755);
    }
    host.env.PATH = `${logged}${path.delimiter}/usr/bin${path.delimiter}/bin`;
    const localPath = path.join(host.root, LOCAL_MODEL_FILE);

    await writeFile(localPath, "{");
    const invalid = host.run([], [{ wait: "LOCAL_CONFIG_INVALID" }]);
    assert.notEqual(invalid.exitCode, 0, invalid.output);
    assert.doesNotMatch(invalid.output, /banzai v\d/);
    assert.equal(await readOptional(log), null);

    const localText = `${JSON.stringify({
      schemaVersion: 1,
      models: {
        reviewer: { executable: "codex", model: "gpt-6-sol", effort: "high" }
      }
    })}\n`;
    await writeFile(localPath, localText);
    git("add", "-f", "--", LOCAL_MODEL_FILE);
    const tracked = host.run([], [{ wait: "LOCAL_CONFIG_NOT_IGNORED" }]);
    assert.notEqual(tracked.exitCode, 0, tracked.output);
    assert.match(
      tracked.output,
      /git rm --cached \.banzai\/config\.local\.json/
    );
    assert.equal(await readOptional(log), null);
    git("rm", "-q", "--cached", "--", LOCAL_MODEL_FILE);

    // Control: an ignored local file launches, marks its role and checks
    // only the vendors the effective configuration uses.
    const ready = host.run(
      [],
      [{ wait: "(local)" }, { wait: "What next?", send: "\u001b[B\r" }]
    );
    assert.equal(ready.exitCode, 0, ready.output);
    assert.match(ready.output, /review\s+codex\s+\S*gpt-6-sol/);
    const invocations = (await readOptional(log)) ?? "";
    assert.match(invocations, /^codex /mu);
    assert.doesNotMatch(invocations, /^claude /mu);
    assert.equal(await readFile(localPath, "utf8"), localText);
  } finally {
    await host.dispose();
  }
});

test("model PTY refuses CONFIG_NOT_FOUND before banzai init and leaves the exclude file unchanged", async () => {
  const host = await fixture();
  delete host.env.BANZAI_APPROVAL_DIGEST;
  delete host.env.BANZAI_WORKFLOW_DIGEST;
  try {
    const exclude = path.join(host.root, ".git", "info", "exclude");
    const before = await readOptional(exclude);
    for (const args of [["model"], ["model", "--local"]]) {
      const result = host.run(args, [{ wait: "CONFIG_NOT_FOUND" }]);
      assert.notEqual(result.exitCode, 0, result.output);
      assert.match(result.output, /Run "banzai init" first\./);
      assert.doesNotMatch(result.output, /Planning model|Where should/);
      assert.equal(await readOptional(exclude), before);
      await assert.rejects(readdir(path.join(host.root, ".banzai")), /ENOENT/);
    }
    await assert.rejects(readFile(host.capture), /ENOENT/);
  } finally {
    await host.dispose();
  }
});
