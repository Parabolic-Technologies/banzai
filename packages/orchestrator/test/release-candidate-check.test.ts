import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFile,
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

const SCRIPT = path.join(
  process.cwd(),
  "scripts",
  "release-candidate-check.mjs"
);
const RELEASE_CHECK = path.join(process.cwd(), "scripts", "release-check.mjs");

const git = (root: string, args: string[]) => {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "buffer",
    maxBuffer: 16 * 1024 * 1024
  });
  assert.equal(result.status, 0, result.stderr.toString("utf8"));
  return result.stdout;
};

type WorkspaceLink = "none" | "relative" | "absolute" | "unmapped";

async function fixtureRepository(
  workspaceLink: WorkspaceLink = "none"
): Promise<string> {
  const root = await realpath(
    await mkdtemp(path.join(tmpdir(), "banzai-candidate-fixture-"))
  );
  await mkdir(path.join(root, "packages/orchestrator/scripts"), {
    recursive: true
  });
  await copyFile(
    RELEASE_CHECK,
    path.join(root, "packages/orchestrator/scripts/release-check.mjs")
  );
  await writeFile(
    path.join(root, ".gitignore"),
    "ignored.txt\nnode_modules/\nignored-workspace/\n",
    "utf8"
  );
  await writeFile(path.join(root, "tracked.txt"), "tracked\n", "utf8");
  if (workspaceLink !== "none") {
    const tracked =
      workspaceLink === "unmapped" ? "ignored-workspace" : "packages/probe";
    await mkdir(path.join(root, tracked), { recursive: true });
    await writeFile(
      path.join(root, tracked, "package.json"),
      JSON.stringify({
        name: "workspace-probe",
        version: "1.0.0",
        main: "index.js"
      }),
      "utf8"
    );
    await writeFile(
      path.join(root, tracked, "index.js"),
      "module.exports = 'original';\n",
      "utf8"
    );
    await mkdir(path.join(root, "node_modules"), { recursive: true });
    await symlink(
      workspaceLink === "absolute"
        ? path.join(root, tracked)
        : path.join("..", tracked),
      path.join(root, "node_modules/workspace-probe")
    );
  }
  for (const args of [
    ["init", "--initial-branch=main"],
    ["config", "user.email", "candidate@example.invalid"],
    ["config", "user.name", "Candidate Check"],
    ["config", "commit.gpgsign", "false"],
    ["add", "."],
    ["commit", "-m", "fixture"]
  ]) {
    git(root, args);
  }
  // One untracked non-ignored file and one ignored file, so the candidate's
  // enumeration boundary is observable.
  await writeFile(path.join(root, "untracked.txt"), "untracked\n", "utf8");
  await writeFile(path.join(root, "ignored.txt"), "ignored\n", "utf8");
  return root;
}

const checkoutState = (root: string) => ({
  status: git(root, ["status", "--porcelain=v1", "-z"]),
  index: git(root, ["ls-files", "-s", "-z"]),
  tree: git(root, ["ls-files", "-z", "--cached", "--others"])
});

async function probeComponents(
  workspace: string,
  probe: string,
  exitCode = 0
): Promise<string> {
  const componentsPath = path.join(workspace, "components.json");
  const script = [
    "const fs = require('node:fs');",
    "const { execFileSync } = require('node:child_process');",
    "const listing = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' });",
    "let workspace = null;",
    "try {",
    "  workspace = require.resolve('workspace-probe', { paths: [process.cwd()] });",
    "} catch {}",
    `fs.writeFileSync(${JSON.stringify(probe)}, JSON.stringify({`,
    "  candidate: process.cwd(),",
    "  workspace,",
    "  files: listing.split('\\0').filter(Boolean)",
    "}));",
    `process.exit(${exitCode});`
  ].join("\n");
  await writeFile(
    componentsPath,
    JSON.stringify([
      { name: "probe", command: process.execPath, args: ["-e", script] }
    ]),
    "utf8"
  );
  return componentsPath;
}

const runCandidate = (root: string, componentsPath: string) =>
  spawnSync(
    process.execPath,
    [SCRIPT, "--root", root, "--fixture-components", componentsPath],
    { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }
  );

test("the candidate carries untracked work, excludes ignored files and leaves the checkout untouched", async () => {
  const root = await fixtureRepository();
  const workspace = await mkdtemp(
    path.join(tmpdir(), "banzai-candidate-probe-")
  );
  try {
    const probe = path.join(workspace, "probe.json");
    const componentsPath = await probeComponents(workspace, probe);
    const before = checkoutState(root);
    const result = runCandidate(root, componentsPath);
    assert.equal(result.status, 0, result.stderr);
    const after = checkoutState(root);

    assert.ok(before.status.equals(after.status));
    assert.ok(before.index.equals(after.index));
    assert.ok(before.tree.equals(after.tree));

    const observed = JSON.parse(await readFile(probe, "utf8")) as {
      candidate: string;
      files: string[];
    };
    assert.ok(observed.files.includes("untracked.txt"));
    assert.ok(!observed.files.includes("ignored.txt"));
    assert.ok(observed.files.includes("tracked.txt"));
    // The candidate is a disposable copy outside the checkout, not the checkout.
    assert.ok(!observed.candidate.startsWith(root));
    await assert.rejects(stat(observed.candidate));
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(workspace, { recursive: true, force: true });
  }
});

test("a failing component fails the candidate check and still removes the candidate", async () => {
  const root = await fixtureRepository();
  const workspace = await mkdtemp(
    path.join(tmpdir(), "banzai-candidate-probe-")
  );
  try {
    const probe = path.join(workspace, "probe.json");
    const componentsPath = await probeComponents(workspace, probe, 3);
    const before = checkoutState(root);
    const result = runCandidate(root, componentsPath);
    assert.notEqual(result.status, 0);
    const after = checkoutState(root);
    assert.ok(before.status.equals(after.status));
    assert.ok(before.index.equals(after.index));

    const observed = JSON.parse(await readFile(probe, "utf8")) as {
      candidate: string;
    };
    await assert.rejects(stat(observed.candidate));
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(workspace, { recursive: true, force: true });
  }
});

for (const form of ["relative", "absolute"] as const) {
  test(`a ${form} workspace link resolves inside the candidate, never the real checkout`, async () => {
    const root = await fixtureRepository(form);
    const workspace = await mkdtemp(
      path.join(tmpdir(), "banzai-candidate-probe-")
    );
    try {
      const probe = path.join(workspace, "probe.json");
      const componentsPath = await probeComponents(workspace, probe);
      const original = path.join(root, "packages/probe/index.js");
      const before = await readFile(original);
      const result = runCandidate(root, componentsPath);
      assert.equal(result.status, 0, result.stderr);

      const observed = JSON.parse(await readFile(probe, "utf8")) as {
        candidate: string;
        workspace: string | null;
      };
      assert.ok(observed.workspace, "workspace package must resolve");
      // The link text is irrelevant; where it physically lands is the guarantee.
      assert.ok(
        observed.workspace.startsWith(observed.candidate + path.sep),
        `${form} link resolved outside the candidate: ${observed.workspace}`
      );
      assert.ok(!observed.workspace.startsWith(root + path.sep));
      assert.ok(before.equals(await readFile(original)));
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(workspace, { recursive: true, force: true });
    }
  });
}

test("an unmappable workspace link fails closed before any component runs", async () => {
  const root = await fixtureRepository("unmapped");
  const workspace = await mkdtemp(
    path.join(tmpdir(), "banzai-candidate-probe-")
  );
  try {
    const probe = path.join(workspace, "probe.json");
    const componentsPath = await probeComponents(workspace, probe);
    const result = runCandidate(root, componentsPath);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /UNSUPPORTED_WORKSPACE_LINK/);
    // Failing closed means the probe never ran, so no evidence was produced.
    await assert.rejects(stat(probe));
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(workspace, { recursive: true, force: true });
  }
});

test("the candidate check never commits and never writes in the real checkout", async () => {
  const source = await readFile(SCRIPT, "utf8");
  assert.doesNotMatch(source, /"commit"/);
  // Every mutating Git call must target the candidate, never the enumerated root.
  assert.match(source, /git\(candidate, \[\s*"add"/);
  assert.match(
    source,
    /ls-files",\s*"-z",\s*"--cached",\s*"--others",\s*"--exclude-standard"/
  );
});
