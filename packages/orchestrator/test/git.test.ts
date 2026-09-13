import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import {
  changedRepositoryPaths,
  currentCommit,
  discoverRepositoryRoot,
  digestArtifactBundle,
  repositoryBaseline,
  workspaceChanges,
  workspaceChangeCounts,
  workspaceDigest,
  workspaceSnapshot,
  type WorkspaceSnapshot
} from "../src/git.js";
import { BanzaiError } from "../src/errors.js";
import { commitAll, createTestRepository, snapshotTree } from "./helpers.js";

const execFileAsync = promisify(execFile);

async function git(root: string, args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd: root });
}

test("Git prerequisites explain missing initialization without changing the directory", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "banzai-no-git-"));
  try {
    const before = await snapshotTree(root);
    await assert.rejects(discoverRepositoryRoot(root), (error: unknown) => {
      assert.ok(error instanceof BanzaiError);
      assert.equal(error.code, "GIT_REPOSITORY_REQUIRED");
      assert.match(error.message, /git init/);
      return true;
    });
    assert.deepEqual(await snapshotTree(root), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Git prerequisites explain an unborn HEAD and the empty commit remedy preserves staged files", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "banzai-unborn-head-"));
  try {
    await git(root, ["init", "-q"]);
    await git(root, ["config", "user.email", "tests@banzai.local"]);
    await git(root, ["config", "user.name", "Banzai Tests"]);
    await git(root, ["config", "commit.gpgsign", "false"]);
    await writeFile(path.join(root, "staged.txt"), "keep staged\n");
    await git(root, ["add", "--", "staged.txt"]);
    const before = await snapshotTree(root);
    await assert.rejects(currentCommit(root), (error: unknown) => {
      assert.ok(error instanceof BanzaiError);
      assert.equal(error.code, "GIT_INITIAL_COMMIT_REQUIRED");
      assert.match(error.message, /at least one commit/);
      assert.match(
        error.message,
        /git commit --allow-empty --only -m "Initial commit"/
      );
      return true;
    });
    assert.deepEqual(await snapshotTree(root), before);

    await git(root, [
      "commit",
      "--allow-empty",
      "--only",
      "-m",
      "Initial commit"
    ]);
    const commit = await currentCommit(root);
    assert.equal(
      commit,
      (
        await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: root })
      ).stdout.trim()
    );
    assert.equal(
      (
        await execFileAsync("git", ["ls-tree", "-r", "--name-only", "HEAD"], {
          cwd: root
        })
      ).stdout,
      ""
    );
    assert.equal(
      (
        await execFileAsync("git", ["diff", "--cached", "--name-only"], {
          cwd: root
        })
      ).stdout,
      "staged.txt\n"
    );
    await git(root, ["checkout", "--detach", "HEAD"]);
    assert.equal(await currentCommit(root), commit);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Git prerequisites preserve failures for a corrupt existing HEAD", async () => {
  const repository = await createTestRepository();
  try {
    const reference = (
      await execFileAsync("git", ["symbolic-ref", "HEAD"], {
        cwd: repository.root
      })
    ).stdout.trim();
    await writeFile(
      path.join(repository.root, ".git", reference),
      `${"f".repeat(40)}\n`
    );
    await assert.rejects(
      currentCommit(repository.root),
      (error: unknown) =>
        error instanceof BanzaiError && error.code === "GIT_FAILED"
    );
  } finally {
    await repository.dispose();
  }
});

test("artifact paths cannot escape the repository", async () => {
  const repository = await createTestRepository();
  try {
    await assert.rejects(
      digestArtifactBundle(repository.root, ["../outside"]),
      /escapes the repository/
    );
  } finally {
    await repository.dispose();
  }
});

test("workspace digest can exclude the designated review artifact only", async () => {
  const repository = await createTestRepository();
  try {
    const reviewArtifact = "documentation/features/example/review-1.md";
    const sourcePath = "src/example.ts";
    const baseline = await workspaceDigest(repository.root, {
      excludedPaths: [reviewArtifact]
    });

    await mkdir(path.join(repository.root, path.dirname(reviewArtifact)), {
      recursive: true
    });
    await writeFile(
      path.join(repository.root, reviewArtifact),
      "# Review\n",
      "utf8"
    );
    assert.equal(
      await workspaceDigest(repository.root, {
        excludedPaths: [reviewArtifact]
      }),
      baseline
    );
    assert.notEqual(await workspaceDigest(repository.root), baseline);

    await mkdir(path.join(repository.root, path.dirname(sourcePath)), {
      recursive: true
    });
    await writeFile(
      path.join(repository.root, sourcePath),
      "changed\n",
      "utf8"
    );
    assert.notEqual(
      await workspaceDigest(repository.root, {
        excludedPaths: [reviewArtifact]
      }),
      baseline
    );
  } finally {
    await repository.dispose();
  }
});

test("workspace changes report added modified and removed reviewed entries", () => {
  const previous: WorkspaceSnapshot = {
    schemaVersion: 2,
    baseCommit: "a".repeat(40),
    digest: "before",
    entries: [
      { path: "deleted.ts", kind: "file", sha256: "deleted" },
      { path: "same.ts", kind: "file", sha256: "same" },
      { path: "changed.ts", kind: "file", sha256: "before" }
    ]
  };
  const current: WorkspaceSnapshot = {
    schemaVersion: 2,
    baseCommit: previous.baseCommit,
    digest: "after",
    entries: [
      { path: "added.ts", kind: "file", sha256: "added" },
      { path: "same.ts", kind: "file", sha256: "same" },
      { path: "changed.ts", kind: "file", sha256: "after" }
    ]
  };

  assert.deepEqual(
    workspaceChanges(previous, current).map(({ path: entryPath, change }) => ({
      path: entryPath,
      change
    })),
    [
      { path: "added.ts", change: "added" },
      { path: "changed.ts", change: "modified" },
      { path: "deleted.ts", change: "deleted" }
    ]
  );
});

test("changed repository paths returns the sorted NUL-safe union for a fully dirty checkout", async () => {
  const repository = await createTestRepository();
  try {
    for (const relativePath of [
      "staged-modified.txt",
      "staged-deleted.txt",
      "unstaged-modified.txt",
      "unstaged-deleted.txt",
      "mixed-mm.txt"
    ]) {
      await writeFile(
        path.join(repository.root, relativePath),
        "committed\n",
        "utf8"
      );
    }
    await commitAll(repository.root, "add dirty-checkout fixtures");

    await writeFile(
      path.join(repository.root, "staged-new.txt"),
      "staged\n",
      "utf8"
    );
    await git(repository.root, ["add", "--", "staged-new.txt"]);

    await writeFile(
      path.join(repository.root, "staged-modified.txt"),
      "staged modification\n",
      "utf8"
    );
    await git(repository.root, ["add", "--", "staged-modified.txt"]);

    await rm(path.join(repository.root, "staged-deleted.txt"));
    await git(repository.root, ["add", "-u", "--", "staged-deleted.txt"]);

    await writeFile(
      path.join(repository.root, "unstaged-modified.txt"),
      "unstaged modification\n",
      "utf8"
    );
    await rm(path.join(repository.root, "unstaged-deleted.txt"));
    await writeFile(
      path.join(repository.root, "untracked.txt"),
      "untracked\n",
      "utf8"
    );

    await writeFile(
      path.join(repository.root, "mixed-mm.txt"),
      "staged version\n",
      "utf8"
    );
    await git(repository.root, ["add", "--", "mixed-mm.txt"]);
    await writeFile(
      path.join(repository.root, "mixed-mm.txt"),
      "worktree version\n",
      "utf8"
    );

    await writeFile(
      path.join(repository.root, "mixed-am.txt"),
      "staged addition\n",
      "utf8"
    );
    await git(repository.root, ["add", "--", "mixed-am.txt"]);
    await writeFile(
      path.join(repository.root, "mixed-am.txt"),
      "worktree modification\n",
      "utf8"
    );

    const spacePath = "path with space.txt";
    const newlinePath = "path\nwith-newline.txt";
    const unicodePath = "path-ß.txt";
    await writeFile(path.join(repository.root, spacePath), "space\n", "utf8");
    await writeFile(
      path.join(repository.root, newlinePath),
      "newline\n",
      "utf8"
    );
    await writeFile(
      path.join(repository.root, unicodePath),
      "unicode\n",
      "utf8"
    );

    const expected = [
      "staged-new.txt",
      "staged-modified.txt",
      "staged-deleted.txt",
      "unstaged-modified.txt",
      "unstaged-deleted.txt",
      "untracked.txt",
      "mixed-mm.txt",
      "mixed-am.txt",
      spacePath,
      newlinePath,
      unicodePath
    ].sort();
    assert.deepEqual(await changedRepositoryPaths(repository.root), expected);
    assert.deepEqual(await changedRepositoryPaths(repository.root), expected);
  } finally {
    await repository.dispose();
  }
});

test("repository baseline includes staged-only entries and excludes them until their bytes change", async () => {
  const repository = await createTestRepository();
  try {
    await writeFile(
      path.join(repository.root, "staged-modified.txt"),
      "committed modification target\n",
      "utf8"
    );
    await writeFile(
      path.join(repository.root, "staged-deleted.txt"),
      "committed deletion target\n",
      "utf8"
    );
    await commitAll(repository.root, "add baseline fixtures");

    await writeFile(
      path.join(repository.root, "staged-added.txt"),
      "staged addition\n",
      "utf8"
    );
    await writeFile(
      path.join(repository.root, "staged-modified.txt"),
      "staged modification\n",
      "utf8"
    );
    await rm(path.join(repository.root, "staged-deleted.txt"));
    await git(repository.root, [
      "add",
      "-A",
      "--",
      "staged-added.txt",
      "staged-modified.txt",
      "staged-deleted.txt"
    ]);

    const baseline = await repositoryBaseline(repository.root);
    assert.deepEqual(
      baseline.map((entry) => ({ path: entry.path, kind: entry.kind })),
      [
        { path: "staged-added.txt", kind: "file" },
        { path: "staged-deleted.txt", kind: "deleted" },
        { path: "staged-modified.txt", kind: "file" }
      ]
    );

    const untouched = await workspaceSnapshot(repository.root, { baseline });
    const untouchedAgain = await workspaceSnapshot(repository.root, {
      baseline
    });
    assert.deepEqual(untouched.entries, []);
    assert.equal(untouchedAgain.digest, untouched.digest);

    await writeFile(
      path.join(repository.root, "staged-modified.txt"),
      "run modification\n",
      "utf8"
    );
    const changed = await workspaceSnapshot(repository.root, { baseline });
    const changedAgain = await workspaceSnapshot(repository.root, { baseline });
    assert.deepEqual(
      changed.entries.map((entry) => entry.path),
      ["staged-modified.txt"]
    );
    assert.notEqual(changed.digest, untouched.digest);
    assert.equal(changedAgain.digest, changed.digest);
  } finally {
    await repository.dispose();
  }
});

test("workspace snapshot digest includes staged-only evidence", async () => {
  const repository = await createTestRepository();
  try {
    const clean = await workspaceSnapshot(repository.root);
    await writeFile(
      path.join(repository.root, "staged-only.txt"),
      "staged evidence\n",
      "utf8"
    );
    await git(repository.root, ["add", "--", "staged-only.txt"]);

    const staged = await workspaceSnapshot(repository.root);
    const stagedAgain = await workspaceSnapshot(repository.root);
    assert.deepEqual(
      staged.entries.map((entry) => entry.path),
      ["staged-only.txt"]
    );
    assert.notEqual(staged.digest, clean.digest);
    assert.equal(stagedAgain.digest, staged.digest);
  } finally {
    await repository.dispose();
  }
});

test("workspace change counts classify paths against the snapshot base commit", async () => {
  const repository = await createTestRepository();
  try {
    await writeFile(
      path.join(repository.root, "modified.txt"),
      "before\n",
      "utf8"
    );
    await writeFile(
      path.join(repository.root, "deleted.txt"),
      "before\n",
      "utf8"
    );
    await commitAll(repository.root, "add count fixtures");
    await writeFile(
      path.join(repository.root, "modified.txt"),
      "after\n",
      "utf8"
    );
    await rm(path.join(repository.root, "deleted.txt"));
    await writeFile(path.join(repository.root, "added.txt"), "added\n", "utf8");
    await git(repository.root, ["add", "-A"]);

    const snapshot = await workspaceSnapshot(repository.root);
    assert.deepEqual(await workspaceChangeCounts(repository.root, snapshot), {
      added: 1,
      modified: 1,
      deleted: 1,
      total: 3
    });
  } finally {
    await repository.dispose();
  }
});
