import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
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

// The scope step of the release lanes (ADR-0071 section 4), taken verbatim
// from the workflow and run as GitHub runs a `run` script: `bash -e`.

const MODULE = path.join(process.cwd(), "scripts", "verification-scope.mjs");
const MODULE_PATH = "packages/orchestrator/scripts/verification-scope.mjs";

async function scopeStep(): Promise<string> {
  const workflow = await readFile(
    path.join("..", "..", ".github", "workflows", "ci.yml"),
    "utf8"
  );
  const scripts = [
    ...workflow.matchAll(/\n {6}- id: scope\n {8}run: \|\n((?: {10}.*\n)+)/g)
  ].map((match) =>
    (match[1] ?? "")
      .split("\n")
      .map((line) => line.slice(10))
      .join("\n")
  );
  assert.equal(scripts.length, 3, "every release lane has one scope step");
  assert.equal(new Set(scripts).size, 1, "the lanes share one scope step");
  return scripts[0] ?? "";
}

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

/**
 * A repository whose main branch has `base` files, merged with a branch that
 * applies `change`; HEAD is the merge commit with main as its first parent.
 */
async function mergeCommit(
  base: (root: string) => Promise<void>,
  change: (root: string) => Promise<void>
): Promise<string> {
  const root = await temporary("banzai-scope-step-");
  git(root, ["init", "-q", "--initial-branch=main", "."]);
  await write(root, "README.md");
  await write(root, "documentation/a.md");
  await base(root);
  git(root, ["add", "-A"]);
  git(root, ["commit", "-qm", "base"]);
  git(root, ["checkout", "-qb", "change"]);
  await change(root);
  git(root, ["add", "-A"]);
  git(root, ["commit", "-qm", "change"]);
  git(root, ["checkout", "-q", "main"]);
  await write(root, "README.md", "main moved on\n");
  git(root, ["commit", "-qam", "main moved on"]);
  git(root, ["merge", "-q", "--no-ff", "-m", "merge", "change"]);
  return root;
}

const withModule = async (root: string) => {
  await mkdir(path.join(root, path.dirname(MODULE_PATH)), { recursive: true });
  await copyFile(MODULE, path.join(root, MODULE_PATH));
};

async function runStep(root: string, event: string) {
  const runner = await temporary("banzai-scope-runner-");
  try {
    const output = path.join(runner, "output");
    const summary = path.join(runner, "summary");
    const result = spawnSync("bash", ["-e", "-c", await scopeStep()], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH ?? ""}`,
        RUNNER_TEMP: runner,
        GITHUB_EVENT_NAME: event,
        GITHUB_OUTPUT: output,
        GITHUB_STEP_SUMMARY: summary
      }
    });
    assert.equal(result.status, 0, result.stderr);
    return {
      output: await readFile(output, "utf8"),
      summary: await readFile(summary, "utf8"),
      stdout: result.stdout
    };
  } finally {
    await rm(runner, { recursive: true, force: true });
  }
}

test("a change cannot narrow its own lane by replacing the scope module", async () => {
  const root = await mergeCommit(withModule, async (change) => {
    // A replacement that would call every change set `documents`.
    await write(
      change,
      MODULE_PATH,
      'import { appendFileSync } from "node:fs";\nappendFileSync(process.env.GITHUB_OUTPUT, "scope=documents\\n");\n'
    );
    await write(change, "documentation/a.md", "edited\n");
  });
  try {
    const step = await runStep(root, "pull_request");
    assert.equal(step.output, "scope=full\n");
    assert.equal(
      step.summary,
      `## Verification scope: full\n\n\`\`\`text\nDeciding paths:\n  "${MODULE_PATH}" (orchestrator package)\n\`\`\`\n`
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a first parent without scope rules gives the full scope and the bootstrap reason", async () => {
  const root = await mergeCommit(
    async () => {},
    async (change) => {
      await withModule(change);
      await write(change, "documentation/a.md", "edited\n");
    }
  );
  try {
    for (const event of ["pull_request", "workflow_dispatch"]) {
      const step = await runStep(root, event);
      assert.equal(step.output, "scope=full\n", event);
      const expected =
        "## Verification scope: full\n\n```text\nReason: the base revision has no scope rules\n```\n";
      assert.equal(step.summary, expected, event);
      assert.equal(step.stdout, expected, event);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a merge commit that changes only a decision record runs the documents scope", async () => {
  const root = await mergeCommit(withModule, async (change) => {
    await write(change, "documentation/decisions/0072-example.md");
  });
  try {
    const step = await runStep(root, "pull_request");
    assert.equal(step.output, "scope=documents\n");
    assert.equal(
      step.summary,
      '## Verification scope: documents\n\n```text\nDeciding paths:\n  "documentation/decisions/0072-example.md" (documentation)\n```\n'
    );
    assert.match(step.stdout, /^Verification scope: documents\n/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("manual dispatch runs the complete check when the first parent has scope rules", async () => {
  const root = await mergeCommit(withModule, async (change) => {
    await write(change, "documentation/a.md", "edited\n");
  });
  try {
    const step = await runStep(root, "workflow_dispatch");
    assert.equal(step.output, "scope=full\n");
    assert.equal(
      step.summary,
      "## Verification scope: full\n\n```text\nReason: manual dispatch runs the complete check\n```\n"
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
