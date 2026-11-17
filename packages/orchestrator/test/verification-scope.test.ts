import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  SCOPE_RULES,
  NO_SCOPE_RULE,
  ciChangeSet,
  classifyPath,
  localChangeSet,
  reportLines,
  runCi,
  scopeOfChangeSet,
  summaryText
} from "../scripts/verification-scope.mjs";

const MODULE = path.join(process.cwd(), "scripts", "verification-scope.mjs");

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
  return result.stdout.trim();
}

async function write(root: string, name: string, text = `${name}\n`) {
  await mkdir(path.dirname(path.join(root, name)), { recursive: true });
  await writeFile(path.join(root, name), text, "utf8");
}

async function temporary(prefix: string): Promise<string> {
  return await realpath(await mkdtemp(path.join(tmpdir(), prefix)));
}

async function repository(files: string[]): Promise<string> {
  const root = await temporary("banzai-scope-");
  git(root, ["init", "-q", "--initial-branch=main", "."]);
  for (const name of files) await write(root, name);
  git(root, ["add", "-A"]);
  git(root, ["commit", "-qm", "base"]);
  return root;
}

const sorted = (paths: string[] | null) => [...(paths ?? [])].sort();

test("scope rules carry the labels of FR2 in order and decide by precedence", () => {
  assert.deepEqual(
    [...new Set([...SCOPE_RULES.map((rule) => rule.label), NO_SCOPE_RULE])],
    [
      "orchestrator package",
      "plugin hook",
      "plugin library",
      "plugin contract",
      "plugin manifest",
      "root package file",
      "release-train version file",
      "workflow",
      "release policy",
      "plugin file",
      "documentation",
      "root Markdown",
      "publication policy",
      "no scope rule"
    ]
  );
  const cases: [string, string, string][] = [
    ["packages/orchestrator/src/cli.ts", "full", "orchestrator package"],
    ["packages/orchestrator/MODULES.md", "full", "orchestrator package"],
    [
      "packages/orchestrator/scripts/verification-scope.mjs",
      "full",
      "orchestrator package"
    ],
    ["plugins/banzai/hooks/spec-gate.cjs", "full", "plugin hook"],
    ["plugins/banzai/lib/work-documents.mjs", "full", "plugin library"],
    ["plugins/banzai/contracts/contract.json", "full", "plugin contract"],
    ["plugins/banzai/.claude-plugin/plugin.json", "full", "plugin manifest"],
    ["plugins/banzai/.codex-plugin/plugin.json", "full", "plugin manifest"],
    ["package.json", "full", "root package file"],
    ["package-lock.json", "full", "root package file"],
    ["marketplace.json", "full", "release-train version file"],
    [".agents/plugins/marketplace.json", "full", "release-train version file"],
    [".github/workflows/ci.yml", "full", "workflow"],
    ["release-policy.json", "full", "release policy"],
    ["plugins/banzai/skills/example/SKILL.md", "plugin", "plugin file"],
    ["plugins/banzai/scripts/verification.cjs", "plugin", "plugin file"],
    ["plugins/banzai/AGENTS.md", "plugin", "plugin file"],
    ["documentation/decisions/0072-example.md", "documents", "documentation"],
    ["README.md", "documents", "root Markdown"],
    ["PROJECT_MANIFEST.md", "documents", "root Markdown"],
    ["publication-policy.json", "documents", "publication policy"],
    // Whole segments, exact names and plain paths only; anything else is full.
    ["assets/logo/example.svg", "full", NO_SCOPE_RULE],
    ["documentationx/a.md", "full", NO_SCOPE_RULE],
    ["documentation", "full", NO_SCOPE_RULE],
    ["docs/nested.md", "full", NO_SCOPE_RULE],
    ["README.MD", "full", NO_SCOPE_RULE],
    [".claude-plugin/marketplace.json", "full", NO_SCOPE_RULE],
    ["plugins/other/notes.md", "full", NO_SCOPE_RULE],
    ["documentation/../packages/orchestrator/x.ts", "full", NO_SCOPE_RULE],
    ["/documentation/a.md", "full", NO_SCOPE_RULE]
  ];
  for (const [name, scope, label] of cases) {
    assert.deepEqual(classifyPath(name), { scope, label }, name);
  }
});

test("a change set takes the widest scope of its paths", () => {
  const record = "documentation/decisions/0072-example.md";
  const skill = "plugins/banzai/skills/example/SKILL.md";
  assert.deepEqual(scopeOfChangeSet([record]), {
    scope: "documents",
    reason: null,
    deciding: [{ path: record, label: "documentation" }]
  });
  assert.equal(scopeOfChangeSet([skill]).scope, "plugin");
  assert.deepEqual(scopeOfChangeSet([record, "publication-policy.json"]), {
    scope: "documents",
    reason: null,
    deciding: [
      { path: record, label: "documentation" },
      { path: "publication-policy.json", label: "publication policy" }
    ]
  });
  // A move counts under both paths; a deletion counts under its path.
  assert.deepEqual(
    scopeOfChangeSet([
      "packages/orchestrator/notes.md",
      "documentation/notes.md"
    ]).deciding,
    [{ path: "packages/orchestrator/notes.md", label: "orchestrator package" }]
  );
  assert.deepEqual(scopeOfChangeSet([record, skill]).deciding, [
    { path: skill, label: "plugin file" }
  ]);
  assert.equal(
    scopeOfChangeSet([record, "packages/orchestrator/src/cli.ts"]).scope,
    "full"
  );
  assert.deepEqual(scopeOfChangeSet(["assets/logo/example.svg"]).deciding, [
    { path: "assets/logo/example.svg", label: NO_SCOPE_RULE }
  ]);
  assert.deepEqual(scopeOfChangeSet([]), {
    scope: "full",
    reason: "the change set is empty",
    deciding: []
  });
  assert.deepEqual(scopeOfChangeSet(null), {
    scope: "full",
    reason: "the change set could not be computed",
    deciding: []
  });
});

test("every baseline-pinned path and release-train version path is full scope", async () => {
  const baseline = JSON.parse(
    await readFile(
      path.join(process.cwd(), "instruction-baseline.json"),
      "utf8"
    )
  ) as { expectations: Record<string, string> };
  const pinned = Object.keys(baseline.expectations).map(
    (key) => key.split("#")[0] ?? key
  );
  const policy = JSON.parse(
    await readFile(path.join("..", "..", "release-policy.json"), "utf8")
  ) as {
    project: {
      versionAuthority: { path: string };
      lockfileMirrors: { path: string }[];
    };
    plugin: { versionMirrors: { path: string }[] };
    orchestrator: { packageVersionMirror: string; lockfileMirror: string };
  };
  const versionPaths = [
    policy.project.versionAuthority.path,
    ...policy.project.lockfileMirrors.map((mirror) => mirror.path),
    ...policy.plugin.versionMirrors.map((mirror) => mirror.path),
    policy.orchestrator.packageVersionMirror,
    policy.orchestrator.lockfileMirror
  ];
  assert.ok(pinned.length > 0 && versionPaths.length >= 7);
  for (const name of [...pinned, ...versionPaths]) {
    assert.equal(classifyPath(name).scope, "full", name);
  }
});

test("the local change set compares the working tree with a base revision", async () => {
  const root = await repository([
    "documentation/a.md",
    "documentation/old.md",
    "packages/orchestrator/src/moved.ts",
    "tool.sh"
  ]);
  try {
    await writeFile(path.join(root, ".gitignore"), "ignored.txt\n", "utf8");
    git(root, ["add", ".gitignore"]);
    git(root, ["commit", "-qm", "ignore"]);
    const first = git(root, ["rev-parse", "HEAD"]);
    assert.deepEqual(await localChangeSet(root), []);
    assert.equal(
      scopeOfChangeSet(await localChangeSet(root)).reason,
      "the change set is empty"
    );

    await write(root, "documentation/a.md", "edited\n");
    await write(root, "documentation/staged.md");
    git(root, ["add", "documentation/staged.md"]);
    await write(root, "plugins/banzai/skills/new/SKILL.md");
    await write(root, "ignored.txt");
    await rm(path.join(root, "documentation/old.md"));
    git(root, [
      "mv",
      "packages/orchestrator/src/moved.ts",
      "documentation/moved.ts"
    ]);
    await chmod(path.join(root, "tool.sh"), 0o755);
    const expected = [
      "documentation/a.md",
      "documentation/moved.ts",
      "documentation/old.md",
      "documentation/staged.md",
      "packages/orchestrator/src/moved.ts",
      "plugins/banzai/skills/new/SKILL.md",
      "tool.sh"
    ];
    assert.deepEqual(sorted(await localChangeSet(root)), expected);
    // A tree names the same base as its commit.
    const tree = git(root, ["rev-parse", "HEAD^{tree}"]);
    assert.deepEqual(sorted(await localChangeSet(root, tree)), expected);

    git(root, ["add", "-A"]);
    git(root, ["commit", "-qm", "second"]);
    assert.deepEqual(await localChangeSet(root), []);
    assert.deepEqual(sorted(await localChangeSet(root, first)), expected);

    for (const base of ["missing-revision", "-x", ""]) {
      assert.equal(await localChangeSet(root, base), null, base);
    }
    assert.equal(await localChangeSet(path.join(root, "documentation")), null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }

  const outside = await temporary("banzai-scope-outside-");
  const empty = await temporary("banzai-scope-empty-");
  try {
    assert.equal(await localChangeSet(outside), null);
    git(empty, ["init", "-q", "."]);
    await write(empty, "documentation/a.md");
    assert.equal(await localChangeSet(empty), null);
  } finally {
    await rm(outside, { recursive: true, force: true });
    await rm(empty, { recursive: true, force: true });
  }
});

test("the CI change set compares a merge commit with its first parent", async () => {
  const root = await repository([
    "documentation/a.md",
    "packages/orchestrator/src/x.ts"
  ]);
  try {
    assert.equal(await ciChangeSet(root), null);
    git(root, ["checkout", "-qb", "change"]);
    await write(root, "documentation/a.md", "changed\n");
    git(root, ["commit", "-qam", "document"]);
    git(root, ["checkout", "-q", "main"]);
    await write(root, "packages/orchestrator/src/x.ts", "base moved on\n");
    git(root, ["commit", "-qam", "base"]);
    git(root, ["merge", "-q", "--no-ff", "-m", "merge", "change"]);
    assert.deepEqual(await ciChangeSet(root), ["documentation/a.md"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the report orders paths by bytes, quotes them and stops after fifty", () => {
  const names = [
    "documentation/é.md",
    "documentation/b.md",
    'documentation/quote".md',
    "documentation/B.md",
    "documentation/a.md"
  ];
  assert.deepEqual(reportLines(scopeOfChangeSet(names)), [
    "Verification scope: documents",
    "Deciding paths:",
    '  "documentation/B.md" (documentation)',
    '  "documentation/a.md" (documentation)',
    '  "documentation/b.md" (documentation)',
    '  "documentation/quote\\".md" (documentation)',
    '  "documentation/é.md" (documentation)'
  ]);
  const many = Array.from(
    { length: 52 },
    (_, index) => `documentation/${String(index).padStart(2, "0")}.md`
  );
  const lines = reportLines(scopeOfChangeSet(many));
  assert.equal(lines.length, 2 + 50 + 1);
  assert.equal(lines.at(-2), '  "documentation/49.md" (documentation)');
  assert.equal(lines.at(-1), "  and 2 more");
  assert.deepEqual(reportLines(scopeOfChangeSet(null)), [
    "Verification scope: full",
    "Reason: the change set could not be computed"
  ]);
  assert.equal(
    summaryText(scopeOfChangeSet([])),
    "## Verification scope: full\n\n```text\nReason: the change set is empty\n```\n"
  );
});

test("a file name cannot escape the job summary's fenced block", async () => {
  const root = await repository(["README.md"]);
  const outputs = await temporary("banzai-scope-outputs-");
  const odd = "documentation/odd\nname`x```y.md";
  try {
    await write(root, odd);
    git(root, ["add", "-A"]);
    git(root, ["commit", "-qm", "odd name"]);
    const summary = path.join(outputs, "summary.md");
    const output = path.join(outputs, "output.txt");
    let log = "";
    const status = await runCi({
      cwd: root,
      env: {
        GITHUB_EVENT_NAME: "pull_request",
        GITHUB_OUTPUT: output,
        GITHUB_STEP_SUMMARY: summary
      },
      writeOut: (value) => {
        log += value;
      }
    });
    assert.equal(status, 0);
    const lines = (await readFile(summary, "utf8")).split("\n");
    assert.deepEqual(
      lines.filter((line) => line.startsWith("#")),
      ["## Verification scope: documents"]
    );
    assert.equal(lines.filter((line) => /^\s{0,3}`{3}/.test(line)).length, 2);
    assert.ok(lines.includes(`  ${JSON.stringify(odd)} (documentation)`));
    assert.equal(await readFile(output, "utf8"), "scope=documents\n");
    assert.match(log, /^Verification scope: documents\n/);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outputs, { recursive: true, force: true });
  }
});

test("the CI entry runs as a lone copy outside the repository", async () => {
  const root = await repository(["documentation/a.md"]);
  const lone = await temporary("banzai-scope-lone-");
  try {
    await write(root, "documentation/a.md", "changed\n");
    git(root, ["commit", "-qam", "document"]);
    const copy = path.join(lone, "verification-scope.mjs");
    await copyFile(MODULE, copy);
    const run = (event: string | null, args = ["--ci"]) => {
      const env: Record<string, string | undefined> = {
        ...process.env,
        GITHUB_EVENT_NAME: event ?? undefined,
        GITHUB_OUTPUT: path.join(lone, `${event}-output`),
        GITHUB_STEP_SUMMARY: path.join(lone, `${event}-summary`)
      };
      if (event === null) delete env.GITHUB_EVENT_NAME;
      return spawnSync(process.execPath, [copy, ...args], {
        cwd: root,
        env,
        encoding: "utf8"
      });
    };
    const read = (name: string) => readFile(path.join(lone, name), "utf8");

    let result = run("pull_request");
    assert.equal(result.status, 0, result.stderr);
    assert.equal(await read("pull_request-output"), "scope=documents\n");
    assert.match(
      await read("pull_request-summary"),
      /^## Verification scope: documents\n\n```text\nDeciding paths:\n {2}"documentation\/a\.md" \(documentation\)\n```\n$/
    );

    result = run("workflow_dispatch");
    assert.equal(result.status, 0, result.stderr);
    assert.equal(await read("workflow_dispatch-output"), "scope=full\n");
    assert.equal(
      await read("workflow_dispatch-summary"),
      "## Verification scope: full\n\n```text\nReason: manual dispatch runs the complete check\n```\n"
    );

    result = run(null);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /^VERIFICATION_SCOPE_FAILED: /);
    await assert.rejects(read("null-output"));

    result = run("pull_request", ["--scope", "documents"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /usage/);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(lone, { recursive: true, force: true });
  }
});

test("the CI entry fails when the step output cannot be written", async () => {
  const root = await repository(["documentation/a.md"]);
  const outputs = await temporary("banzai-scope-outputs-");
  try {
    await write(root, "documentation/a.md", "changed\n");
    git(root, ["commit", "-qam", "document"]);
    let error = "";
    const status = await runCi({
      cwd: root,
      env: {
        GITHUB_EVENT_NAME: "pull_request",
        // A directory cannot be appended to.
        GITHUB_OUTPUT: outputs,
        GITHUB_STEP_SUMMARY: path.join(outputs, "summary.md")
      },
      writeOut: () => undefined,
      writeError: (value) => {
        error += value;
      }
    });
    assert.equal(status, 1);
    assert.equal(
      error,
      "VERIFICATION_SCOPE_FAILED: the step output could not be written\n"
    );
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outputs, { recursive: true, force: true });
  }
});
