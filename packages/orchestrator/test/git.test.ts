import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import {
  appendCloneExcludeLine,
  changedRepositoryPaths,
  cloneExcludePath,
  currentCommit,
  discoverRepositoryRoot,
  digestArtifactBundle,
  isPathIgnored,
  isPathInIndex,
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
    baseCommit: "a".repeat(40),
    digest: "before",
    entries: [
      { path: "deleted.ts", kind: "file", sha256: "deleted" },
      { path: "same.ts", kind: "file", sha256: "same" },
      { path: "changed.ts", kind: "file", sha256: "before" }
    ]
  };
  const current: WorkspaceSnapshot = {
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

test("index and ignore queries answer yes or no for each Git state", async () => {
  const repository = await createTestRepository();
  try {
    const root = repository.root;
    await writeFile(path.join(root, ".gitignore"), "ignored.txt\n*.tracked\n", {
      flag: "a"
    });
    await writeFile(path.join(root, "committed.tracked"), "tracked\n");
    await git(root, ["add", "-f", "--", "committed.tracked"]);
    await commitAll(root, "track an ignored pattern");
    await writeFile(path.join(root, "staged.txt"), "staged\n");
    await git(root, ["add", "--", "staged.txt"]);
    await writeFile(path.join(root, "ignored.txt"), "ignored\n");
    await writeFile(path.join(root, "untracked.txt"), "untracked\n");
    await writeFile(path.join(root, "removed.txt"), "removed\n");
    await git(root, ["add", "--", "removed.txt"]);
    await git(root, ["rm", "-q", "--cached", "--", "removed.txt"]);

    const answers: Record<string, [boolean, boolean]> = {};
    for (const entry of [
      "base.txt",
      "committed.tracked",
      "staged.txt",
      "ignored.txt",
      "untracked.txt",
      "removed.txt",
      "absent.txt"
    ]) {
      answers[entry] = [
        await isPathInIndex(root, entry),
        await isPathIgnored(root, entry)
      ];
    }
    assert.deepEqual(answers, {
      "base.txt": [true, false],
      // Git never reports a path in the index as ignored.
      "committed.tracked": [true, false],
      "staged.txt": [true, false],
      "ignored.txt": [false, true],
      "untracked.txt": [false, false],
      "removed.txt": [false, false],
      "absent.txt": [false, false]
    });
  } finally {
    await repository.dispose();
  }
});

test("index and ignore queries fail instead of answering no when Git cannot answer", async () => {
  const outside = await mkdtemp(path.join(tmpdir(), "banzai-no-git-query-"));
  const repository = await createTestRepository();
  try {
    await writeFile(path.join(outside, "file.txt"), "outside\n");
    for (const query of [isPathInIndex, isPathIgnored]) {
      await assert.rejects(
        query(outside, "file.txt"),
        (error: unknown) =>
          error instanceof BanzaiError &&
          error.code === "GIT_REPOSITORY_REQUIRED"
      );
    }
    await mkdir(path.join(repository.root, "real"));
    await symlink("real", path.join(repository.root, "linked"));
    await assert.rejects(
      isPathIgnored(repository.root, "linked/file.txt"),
      (error: unknown) =>
        error instanceof BanzaiError &&
        error.code === "GIT_FAILED" &&
        error.message.includes("beyond a symbolic link")
    );
  } finally {
    await rm(outside, { recursive: true, force: true });
    await repository.dispose();
  }
});

const LOCAL_LINE = ".banzai/config.local.json";

test("the clone exclude path resolves in a main and a linked worktree", async () => {
  const repository = await createTestRepository();
  const linked = await mkdtemp(path.join(tmpdir(), "banzai-linked-worktree-"));
  try {
    const root = repository.root;
    assert.equal(
      await cloneExcludePath(root),
      path.join(root, ".git", "info", "exclude")
    );
    const worktree = path.join(linked, "wt");
    await git(root, ["worktree", "add", "-q", "-b", "linked", worktree]);
    // A linked worktree shares the common directory's exclude file.
    assert.equal(
      await realpath(path.dirname(await cloneExcludePath(worktree))),
      await realpath(path.join(root, ".git", "info"))
    );
  } finally {
    await repository.dispose();
    await rm(linked, { recursive: true, force: true });
  }
});

test("the exclude append creates info/, skips an exact line and repairs a missing newline", async () => {
  const repository = await createTestRepository();
  try {
    const root = repository.root;
    const info = path.join(root, ".git", "info");
    const exclude = path.join(info, "exclude");
    await rm(info, { recursive: true, force: true });
    assert.equal(await isPathIgnored(root, LOCAL_LINE), false);

    assert.equal(await appendCloneExcludeLine(root, LOCAL_LINE), "appended");
    assert.equal(await readFile(exclude, "utf8"), `${LOCAL_LINE}\n`);
    assert.equal((await lstat(info)).isDirectory(), true);
    assert.equal(await isPathIgnored(root, LOCAL_LINE), true);
    assert.equal(await appendCloneExcludeLine(root, LOCAL_LINE), "present");
    assert.equal(await readFile(exclude, "utf8"), `${LOCAL_LINE}\n`);

    // A broader or commented line is not the exact line.
    await writeFile(exclude, `# ${LOCAL_LINE}\r\n.banzai/*.json`);
    assert.equal(await appendCloneExcludeLine(root, LOCAL_LINE), "appended");
    assert.equal(
      await readFile(exclude, "utf8"),
      `# ${LOCAL_LINE}\r\n.banzai/*.json\n${LOCAL_LINE}\n`
    );
    await writeFile(exclude, `keep\r\n${LOCAL_LINE}\r\n`);
    assert.equal(await appendCloneExcludeLine(root, LOCAL_LINE), "present");
    await assert.rejects(
      appendCloneExcludeLine(root, "two\nlines"),
      (error: unknown) =>
        error instanceof BanzaiError && error.code === "INVALID_EXCLUDE_LINE"
    );
  } finally {
    await repository.dispose();
  }
});

test("an exclude append from a linked worktree writes the common exclude file", async () => {
  const repository = await createTestRepository();
  const linked = await mkdtemp(path.join(tmpdir(), "banzai-linked-exclude-"));
  try {
    const root = repository.root;
    const worktree = path.join(linked, "wt");
    await git(root, ["worktree", "add", "-q", "-b", "linked", worktree]);
    const common = path.join(root, ".git", "info");
    await rm(common, { recursive: true, force: true });
    const worktreeGitDirectory = (
      await execFileAsync("git", ["rev-parse", "--git-dir"], { cwd: worktree })
    ).stdout.trim();

    assert.equal(
      await appendCloneExcludeLine(worktree, LOCAL_LINE),
      "appended"
    );
    assert.equal(
      await readFile(path.join(common, "exclude"), "utf8"),
      `${LOCAL_LINE}\n`
    );
    // Nothing is written below the worktree's own Git directory.
    await assert.rejects(
      lstat(path.resolve(worktree, worktreeGitDirectory, "info")),
      /ENOENT/
    );
    assert.equal(await isPathIgnored(worktree, LOCAL_LINE), true);
    assert.equal(await isPathIgnored(root, LOCAL_LINE), true);
  } finally {
    await repository.dispose();
    await rm(linked, { recursive: true, force: true });
  }
});

test("a linked info/, a linked exclude file and a non-regular exclude file are refused", async () => {
  const repository = await createTestRepository();
  const outside = await mkdtemp(path.join(tmpdir(), "banzai-exclude-outside-"));
  try {
    const root = repository.root;
    const info = path.join(root, ".git", "info");
    const exclude = path.join(info, "exclude");
    const target = path.join(outside, "exclude");
    await writeFile(target, "outside\n");
    const refused = (error: unknown): boolean =>
      error instanceof BanzaiError &&
      error.code === "GIT_EXCLUDE_UNSAFE" &&
      !error.message.includes(outside);

    // A symbolic link at info/.
    await rm(info, { recursive: true, force: true });
    await symlink(outside, info);
    const before = await snapshotTree(outside);
    await assert.rejects(appendCloneExcludeLine(root, LOCAL_LINE), refused);
    assert.deepEqual(await snapshotTree(outside), before);

    // A symbolic link at the exclude file, live or dangling.
    await rm(info);
    await mkdir(info);
    await symlink(target, exclude);
    await assert.rejects(appendCloneExcludeLine(root, LOCAL_LINE), refused);
    assert.equal(await readFile(target, "utf8"), "outside\n");
    await rm(exclude);
    await symlink(path.join(outside, "missing"), exclude);
    await assert.rejects(appendCloneExcludeLine(root, LOCAL_LINE), refused);
    await assert.rejects(lstat(path.join(outside, "missing")), /ENOENT/);

    // A directory where the file belongs.
    await rm(exclude);
    await mkdir(exclude);
    await assert.rejects(appendCloneExcludeLine(root, LOCAL_LINE), refused);
    assert.deepEqual(await snapshotTree(outside), before);
  } finally {
    await repository.dispose();
    await rm(outside, { recursive: true, force: true });
  }
});

test("an info/ swapped for a link after its check receives no exclude line", async () => {
  const repository = await createTestRepository();
  const outside = await mkdtemp(path.join(tmpdir(), "banzai-exclude-swap-"));
  try {
    const root = repository.root;
    const info = path.join(root, ".git", "info");
    const moved = path.join(root, ".git", "info-moved");
    const refused = (error: unknown): boolean =>
      error instanceof BanzaiError && error.code === "GIT_EXCLUDE_UNSAFE";
    const swap = async () => {
      await rename(info, moved);
      await symlink(outside, info);
    };
    const restore = async () => {
      await rm(info);
      await rename(moved, info);
    };

    // The append path: an existing exclude file beyond the link stays as is.
    await writeFile(path.join(info, "exclude"), "# local\n");
    await writeFile(path.join(outside, "exclude"), "outside\n");
    const before = await snapshotTree(outside);
    await assert.rejects(
      appendCloneExcludeLine(root, LOCAL_LINE, { beforeOpen: swap }),
      refused
    );
    assert.deepEqual(await snapshotTree(outside), before);
    assert.equal(
      await readFile(path.join(moved, "exclude"), "utf8"),
      "# local\n"
    );
    await restore();

    // The create path: no exclude file appears beyond the link.
    await rm(path.join(info, "exclude"));
    await rm(path.join(outside, "exclude"));
    await assert.rejects(
      appendCloneExcludeLine(root, LOCAL_LINE, { beforeOpen: swap }),
      refused
    );
    assert.deepEqual(await snapshotTree(outside), []);
    await assert.rejects(lstat(path.join(moved, "exclude")), /ENOENT/);
    await restore();

    // Without a swap the same call appends.
    assert.equal(await appendCloneExcludeLine(root, LOCAL_LINE), "appended");
    assert.equal(
      await readFile(path.join(info, "exclude"), "utf8"),
      `${LOCAL_LINE}\n`
    );
  } finally {
    await repository.dispose();
    await rm(outside, { recursive: true, force: true });
  }
});
