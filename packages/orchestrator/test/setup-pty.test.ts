import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { DEFAULT_CONFIG } from "../src/config.js";
import { ADOPTED_AGENTS, POPULATED_MANIFEST } from "./adoption-fixtures.js";
import { monochromeEnv, snapshotTree } from "./helpers.js";

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
    await writeFile(
      path.join(root, ".banzai/config.json"),
      JSON.stringify(DEFAULT_CONFIG)
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
      assert.match(
        result.output,
        /Banzai configuration saved\.\s+Project setup required\s+PROJECT_MANIFEST\.md\s+Missing\s+AGENTS\.md\s+Missing\s+CLAUDE\.md\s+Missing \(created during setup\)\s+Run banzai:project-manifest to prepare project guidance\./
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
    }
    await assert.rejects(readFile(host.capture), /ENOENT/);
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
        assert.doesNotMatch(
          JSON.stringify(captured),
          /FORBIDDEN_SECRET|FORBIDDEN_GRANT|dontAsk|bypass|--output-schema|approvals_reviewer/
        );
        assert.deepEqual(
          (await snapshotTree(path.join(host.root, ".banzai"))).map(
            (entry) => entry.path
          ),
          ["artifacts.json", "config.json"]
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

test("setup CLI non-TTY contracts never launch a client and retain configuration-only init", async () => {
  const host = await fixture();
  try {
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
