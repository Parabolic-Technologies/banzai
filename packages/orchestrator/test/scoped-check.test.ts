import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
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
import { setTimeout as delay } from "node:timers/promises";
import {
  ciChangeSet,
  reportLines,
  scopeOfChangeSet
} from "../scripts/verification-scope.mjs";
import { suiteFiles } from "../scripts/verification-suites.mjs";

const SCRIPT = path.join(process.cwd(), "scripts", "scoped-check.mjs");
const CHECKS = [
  "distribution-build",
  "build-check",
  "release-validation",
  "publication",
  "suite",
  "verify"
];

function git(root: string, args: string[]): string {
  const result = spawnSync(
    "git",
    [
      "-c",
      "user.name=Banzai Tests",
      "-c",
      "user.email=tests@banzai.local",
      "-c",
      "commit.gpgsign=false",
      "-c",
      "core.hooksPath=/dev/null",
      ...args
    ],
    { cwd: root, encoding: "utf8" }
  );
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

async function write(root: string, name: string, text = `${name}\n`) {
  await mkdir(path.dirname(path.join(root, name)), { recursive: true });
  await writeFile(path.join(root, name), text, "utf8");
}

async function temporary(prefix: string): Promise<string> {
  return await realpath(await mkdtemp(path.join(tmpdir(), prefix)));
}

/** A checkout with a link, an ignored built distribution and one commit. */
async function repository(): Promise<string> {
  const root = await temporary("banzai-check-repo-");
  git(root, ["init", "-q", "--initial-branch=main", "."]);
  await write(root, ".gitignore", "packages/orchestrator/dist/\nignored.md\n");
  for (const name of [
    "README.md",
    "documentation/a.md",
    "plugins/banzai/skills/example/SKILL.md",
    "packages/orchestrator/src/example.ts"
  ]) {
    await write(root, name);
  }
  await symlink("README.md", path.join(root, "link.md"));
  git(root, ["add", "-A"]);
  git(root, ["commit", "-qm", "base"]);
  await write(root, "packages/orchestrator/dist/banzai.mjs", "built\n");
  await write(root, "ignored.md");
  return root;
}

interface ProbeRecord {
  name: string;
  cwd: string;
  rest: string[];
  index?: string[];
  link?: string | null;
  distribution?: string;
}

/** Fixture components that record each run in `log` and pass by default. */
async function components(
  workspace: string,
  modes: Record<string, string> = {},
  commands: Record<string, string> = {}
): Promise<{ file: string; log: string }> {
  const probe = path.join(workspace, "probe.cjs");
  const log = path.join(workspace, "log.jsonl");
  await writeFile(
    probe,
    [
      "const fs = require('node:fs');",
      "const { execFileSync } = require('node:child_process');",
      "const [log, name, mode, ...rest] = process.argv.slice(2);",
      "const record = { name, cwd: process.cwd(), rest };",
      "if (name === 'publication') {",
      "  record.index = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\\0').filter(Boolean);",
      "  record.link = fs.lstatSync('link.md').isSymbolicLink() ? fs.readlinkSync('link.md') : null;",
      "  record.distribution = fs.readFileSync('packages/orchestrator/dist/banzai.mjs', 'utf8');",
      "}",
      "fs.appendFileSync(log, JSON.stringify(record) + '\\n');",
      "if (mode === 'wait') {",
      "  fs.writeFileSync(log + '.started', '');",
      "  setInterval(() => {}, 1000);",
      "} else {",
      "  process.exit(mode === 'fail' ? 3 : 0);",
      "}",
      ""
    ].join("\n"),
    "utf8"
  );
  const file = path.join(workspace, "components.json");
  await writeFile(
    file,
    JSON.stringify(
      CHECKS.map((name) => ({
        name,
        command: commands[name] ?? process.execPath,
        args: [probe, log, name, modes[name] ?? "pass"]
      }))
    ),
    "utf8"
  );
  return { file, log };
}

async function records(log: string): Promise<ProbeRecord[]> {
  const text = await readFile(log, "utf8").catch(() => "");
  return text
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as ProbeRecord);
}

function check(root: string, args: string[]) {
  const result = spawnSync(
    process.execPath,
    [SCRIPT, "--root", root, ...args],
    {
      cwd: root,
      encoding: "utf8"
    }
  );
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr
  };
}

/** What a check must leave unchanged in the inspected checkout. */
async function checkoutState(root: string) {
  return {
    index: await readFile(path.join(root, ".git", "index")),
    objects: git(root, ["count-objects", "-v"]),
    refs: git(root, ["for-each-ref"])
  };
}

const gone = async (name: string) => {
  assert.equal(await stat(name).catch(() => null), null, name);
};

test("a documents change runs the documents checks on a copy and leaves the checkout unchanged", async () => {
  const root = await repository();
  const workspace = await temporary("banzai-check-workspace-");
  try {
    await write(root, "documentation/a.md", "changed\n");
    await write(root, "untracked.md");
    const before = await checkoutState(root);
    const fixture = await components(workspace);
    const result = check(root, ["--fixture-components", fixture.file]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      result.stdout,
      [
        "Verification scope: documents",
        "Deciding paths:",
        '  "documentation/a.md" (documentation)',
        '  "untracked.md" (root Markdown)',
        "check: distribution-build",
        "check: build-check",
        "check: release-validation",
        "check: publication",
        "check: suite",
        "check passed (documents scope)",
        ""
      ].join("\n")
    );
    const ran = await records(fixture.log);
    assert.deepEqual(
      ran.map((record) => record.name),
      [
        "distribution-build",
        "build-check",
        "release-validation",
        "publication",
        "suite"
      ]
    );
    for (const record of ran.filter((item) => item.name !== "publication")) {
      assert.equal(record.cwd, root);
    }
    assert.deepEqual(
      ran.find((record) => record.name === "suite")?.rest,
      suiteFiles("documents").flatMap((file) => ["--file", file])
    );
    const publication = ran.find((record) => record.name === "publication");
    assert.ok(publication !== undefined);
    assert.notEqual(publication.cwd, root);
    assert.deepEqual(publication.index, [
      ".gitignore",
      "README.md",
      "documentation/a.md",
      "link.md",
      "packages/orchestrator/src/example.ts",
      "plugins/banzai/skills/example/SKILL.md",
      "untracked.md"
    ]);
    assert.equal(publication.link, "README.md");
    assert.equal(publication.distribution, "built\n");
    await gone(publication.cwd);
    await gone(`${publication.cwd}.pathspec`);
    assert.deepEqual(await checkoutState(root), before);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(workspace, { recursive: true, force: true });
  }
});

test("a plugin change runs both suites once and a full change runs the complete check", async () => {
  const root = await repository();
  const workspace = await temporary("banzai-check-workspace-");
  try {
    await write(root, "plugins/banzai/skills/example/SKILL.md", "changed\n");
    await write(root, "documentation/a.md", "changed\n");
    let fixture = await components(workspace);
    let result = check(root, ["--fixture-components", fixture.file]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(
      result.stdout,
      /^Verification scope: plugin\nDeciding paths:\n {2}"plugins\/banzai\/skills\/example\/SKILL\.md" \(plugin file\)\ncheck: distribution-build\n/
    );
    assert.match(
      result.stdout,
      /check: suite\ncheck passed \(plugin scope\)\n$/
    );
    const suite = (await records(fixture.log)).find(
      (record) => record.name === "suite"
    );
    const files = suite?.rest.filter((_, index) => index % 2 === 1) ?? [];
    assert.deepEqual(files, [...new Set(files)]);
    assert.deepEqual(
      suite?.rest,
      suiteFiles("plugin").flatMap((file) => ["--file", file])
    );

    await rm(workspace, { recursive: true, force: true });
    await mkdir(workspace);
    await write(root, "packages/orchestrator/src/example.ts", "changed\n");
    fixture = await components(workspace);
    result = check(root, ["--fixture-components", fixture.file]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      result.stdout,
      [
        "Verification scope: full",
        "Deciding paths:",
        '  "packages/orchestrator/src/example.ts" (orchestrator package)',
        "check: distribution-build",
        "check: verify",
        "check passed (full scope)",
        ""
      ].join("\n")
    );
    assert.deepEqual(
      (await records(fixture.log)).map((record) => record.name),
      ["distribution-build", "verify"]
    );
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(workspace, { recursive: true, force: true });
  }
});

test("a failing or unstartable publication check stops before the suite and removes the copy", async () => {
  const root = await repository();
  const workspace = await temporary("banzai-check-workspace-");
  try {
    await write(root, "documentation/a.md", "changed\n");
    const before = await checkoutState(root);
    let fixture = await components(workspace, { publication: "fail" });
    let result = check(root, ["--fixture-components", fixture.file]);
    assert.equal(result.status, 1);
    assert.equal(
      result.stderr,
      "CHECK_FAILED: publication exited with code 3\n"
    );
    assert.match(result.stdout, /check: publication\n$/);
    assert.doesNotMatch(result.stdout, /check: suite|check passed/);
    const publication = (await records(fixture.log)).find(
      (record) => record.name === "publication"
    );
    assert.ok(publication !== undefined);
    await gone(publication.cwd);
    assert.deepEqual(await checkoutState(root), before);

    await rm(workspace, { recursive: true, force: true });
    await mkdir(workspace);
    fixture = await components(
      workspace,
      {},
      { publication: path.join(workspace, "missing-command") }
    );
    result = check(root, ["--fixture-components", fixture.file]);
    assert.equal(result.status, 1);
    assert.equal(result.stderr, "CHECK_FAILED: publication could not start\n");
    assert.doesNotMatch(result.stdout, /check: suite|check passed/);
    assert.deepEqual(await checkoutState(root), before);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(workspace, { recursive: true, force: true });
  }
});

test("SIGTERM stops the running check and removes the copy", async () => {
  const root = await repository();
  const workspace = await temporary("banzai-check-workspace-");
  try {
    await write(root, "documentation/a.md", "changed\n");
    const before = await checkoutState(root);
    const fixture = await components(workspace, { publication: "wait" });
    const child = spawn(
      process.execPath,
      [SCRIPT, "--root", root, "--fixture-components", fixture.file],
      { cwd: root, stdio: ["ignore", "pipe", "pipe"] }
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    const closed = new Promise<number | null>((resolve) =>
      child.on("close", (code) => {
        resolve(code);
      })
    );
    for (let attempt = 0; attempt < 400; attempt += 1) {
      if ((await stat(`${fixture.log}.started`).catch(() => null)) !== null) {
        break;
      }
      await delay(50);
    }
    const publication = (await records(fixture.log)).find(
      (record) => record.name === "publication"
    );
    assert.ok(publication !== undefined, "the publication check never started");
    assert.ok((await stat(publication.cwd)).isDirectory());
    child.kill("SIGTERM");
    assert.equal(await closed, 1);
    assert.equal(stderr, "CHECK_FAILED: publication was interrupted\n");
    assert.doesNotMatch(stdout, /check: suite|check passed/);
    await gone(publication.cwd);
    await gone(`${publication.cwd}.pathspec`);
    assert.deepEqual(await checkoutState(root), before);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(workspace, { recursive: true, force: true });
  }
});

test("invalid options stop the command before any check", async () => {
  const root = await repository();
  const workspace = await temporary("banzai-check-workspace-");
  try {
    const fixture = await components(workspace);
    const incomplete = path.join(workspace, "incomplete.json");
    await writeFile(
      incomplete,
      JSON.stringify([{ name: "suite", command: "true", args: [] }]),
      "utf8"
    );
    for (const args of [
      ["--scope", "documents"],
      ["--base", "-x"],
      ["--base", ""],
      ["--base"],
      ["documents"],
      ["--base", "HEAD", "--base", "HEAD"],
      ["--fixture-components", incomplete]
    ]) {
      const result = check(root, [
        ...(args.includes("--fixture-components")
          ? []
          : ["--fixture-components", fixture.file]),
        ...args
      ]);
      assert.equal(result.status, 1, args.join(" "));
      assert.match(
        result.stderr,
        /^INVALID_CHECK_OPTION: .+\n$/,
        args.join(" ")
      );
      assert.equal(result.stdout, "", args.join(" "));
    }
    assert.deepEqual(await records(fixture.log), []);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(workspace, { recursive: true, force: true });
  }
});

test("a tracked file deleted only from the working tree stops the publication copy", async () => {
  const root = await repository();
  const workspace = await temporary("banzai-check-workspace-");
  try {
    // The copy refuses to shrink silently, as the release candidate does.
    await rm(path.join(root, "documentation/a.md"));
    const before = await checkoutState(root);
    const fixture = await components(workspace);
    const result = check(root, ["--fixture-components", fixture.file]);
    assert.equal(result.status, 1);
    assert.equal(
      result.stderr,
      "CHECK_FAILED: publication could not copy the checkout (missing-file: documentation/a.md)\n"
    );
    assert.match(result.stdout, /^Verification scope: documents\n/);
    assert.doesNotMatch(result.stdout, /check: suite|check passed/);
    assert.deepEqual(
      (await records(fixture.log)).map((record) => record.name),
      ["distribution-build", "build-check", "release-validation"]
    );
    assert.deepEqual(await checkoutState(root), before);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(workspace, { recursive: true, force: true });
  }
});

test("an empty or uncomputable change set runs the complete check with its reason", async () => {
  const root = await repository();
  const outside = await temporary("banzai-check-outside-");
  const workspace = await temporary("banzai-check-workspace-");
  try {
    const fixture = await components(workspace);
    const cases: [string, string[], string][] = [
      [root, [], "the change set is empty"],
      [
        root,
        ["--base", "missing-revision"],
        "the change set could not be computed"
      ],
      [outside, [], "the change set could not be computed"]
    ];
    for (const [directory, args, reason] of cases) {
      const result = check(directory, [
        "--fixture-components",
        fixture.file,
        ...args
      ]);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(
        result.stdout,
        [
          "Verification scope: full",
          `Reason: ${reason}`,
          "check: distribution-build",
          "check: verify",
          "check passed (full scope)",
          ""
        ].join("\n")
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
    await rm(workspace, { recursive: true, force: true });
  }
});

test("on a merge commit --base HEAD^1 computes the scope of the CI entry", async () => {
  for (const changed of [
    "documentation/a.md",
    "plugins/banzai/skills/example/SKILL.md"
  ]) {
    const root = await repository();
    const workspace = await temporary("banzai-check-workspace-");
    try {
      git(root, ["checkout", "-qb", "change"]);
      await write(root, changed, "changed\n");
      git(root, ["commit", "-qam", "change"]);
      git(root, ["checkout", "-q", "main"]);
      await write(root, "packages/orchestrator/src/example.ts", "moved on\n");
      git(root, ["commit", "-qam", "base moved on"]);
      git(root, ["merge", "-q", "--no-ff", "-m", "merge", "change"]);
      const expected = reportLines(scopeOfChangeSet(await ciChangeSet(root)));
      assert.equal(
        expected[0],
        `Verification scope: ${changed.startsWith("plugins/") ? "plugin" : "documents"}`
      );
      const fixture = await components(workspace);
      const result = check(root, [
        "--fixture-components",
        fixture.file,
        "--base",
        "HEAD^1"
      ]);
      assert.equal(result.status, 0, result.stderr);
      assert.ok(
        result.stdout.startsWith(`${expected.join("\n")}\ncheck: `),
        result.stdout
      );
      // A tree names the same base as its commit.
      const tree = git(root, ["rev-parse", "HEAD^1^{tree}"]).trim();
      const byTree = check(root, [
        "--fixture-components",
        fixture.file,
        "--base",
        tree
      ]);
      assert.equal(byTree.status, 0, byTree.stderr);
      assert.ok(byTree.stdout.startsWith(`${expected.join("\n")}\ncheck: `));
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(workspace, { recursive: true, force: true });
    }
  }
});
