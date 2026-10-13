import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { git as projectGit } from "../../../plugins/banzai/lib/project-files.mjs";
const git = async (root: string, args: string[]) =>
  (await projectGit(root, args)).stdout;
import {
  createExecutionBinding,
  documentRoles,
  inspectBoundWork,
  parseBinding,
  workDocumentInventory
} from "../../../plugins/banzai/lib/work-documents.mjs";
import {
  executionKey,
  withExecutionOwnership,
  withRunnerWorkOwnership
} from "../../../plugins/banzai/lib/execution-ownership.mjs";
import { verificationOperation } from "../../../plugins/banzai/lib/verification-helper.mjs";
import { evidenceDigest } from "../../../plugins/banzai/lib/verification-evidence.mjs";
import { createTestRepository } from "./helpers.js";
import { RunStore } from "../src/store.js";

async function privateEvidenceFixture(root: string) {
  const directory = "documentation/work/ignore-probe";
  const documentPath = `${directory}/plan.md`;
  await mkdir(path.join(root, directory), { recursive: true });
  const remainder = "# Approved private-evidence check\n\n";
  await writeFile(
    path.join(root, documentPath),
    remainder +
      "```banzai-verification-obligations/v2\n" +
      JSON.stringify({
        schema: "banzai-verification-obligations/v2",
        schemaVersion: 2,
        complete: true,
        planRemainderSha256: evidenceDigest(remainder + "\n"),
        checks: [
          {
            id: "private-check",
            name: "Private output",
            requirementRefs: ["FR8"],
            command: process.execPath,
            args: [
              "-e",
              "console.log('synthetic private stdout'); console.error('synthetic private stderr')"
            ],
            cwd: ".",
            timeoutMs: 10000,
            evidence: "fresh",
            sources: [],
            materialization: null
          }
        ],
        absenceReason: null
      }) +
      "\n```\n"
  );
  const key = executionKey(directory);
  return {
    directory,
    base: `.banzai/verification/${key}`,
    claim: `.banzai/execution-locks/${key}/claim.json`,
    request: {
      schema: "banzai-verification-request/v3",
      schemaVersion: 3,
      repoRoot: root,
      documentPath,
      workflow: "strict",
      roundId: randomUUID()
    }
  };
}

function nestedException(base: string, exception: string) {
  const namespace = path.posix.dirname(base);
  return `.banzai/runs/\n.banzai/execution-locks/\n.banzai/verification/\n!${namespace}/\n${namespace}/*\n!${base}/\n${base}/*\n!${base}/${exception}\n`;
}

for (const exception of ["logs/", "attempts/", ".artifact-tmp-*"]) {
  test(`standalone verification refuses a nested ${exception} ignore exception before publishing exposed bytes`, async () => {
    const repo = await createTestRepository({ artifactLayout: null });
    try {
      const fixture = await privateEvidenceFixture(repo.root);
      await writeFile(
        path.join(repo.root, ".gitignore"),
        nestedException(fixture.base, exception)
      );
      await assert.rejects(verificationOperation("execute", fixture.request), {
        code: "ARTIFACT_IGNORE_CONFLICT"
      });
      const visible = await git(repo.root, [
        "status",
        "--porcelain",
        "--untracked-files=all"
      ]);
      assert.ok(!visible.includes(fixture.base), visible);
      const files = await readdir(path.join(repo.root, ".banzai"), {
        recursive: true
      });
      assert.ok(!files.some((file) => file.includes(".artifact-tmp-")));
      assert.ok(!files.includes(fixture.claim.slice(".banzai/".length)));
    } finally {
      await repo.dispose();
    }
  });
}

for (const exception of ["identity.json", "logs/"]) {
  test(`standalone verification revalidates existing ${exception} exclusion after ignore changes`, async () => {
    const repo = await createTestRepository({ artifactLayout: null });
    try {
      const fixture = await privateEvidenceFixture(repo.root);
      const passed = await verificationOperation("execute", fixture.request);
      assert.equal(passed.applicability?.complete, true);
      const identity = await readFile(
        path.join(repo.root, fixture.base, "identity.json")
      );
      const stdoutReference = passed.attempts?.[0]?.stdout;
      assert.ok(stdoutReference);
      const stdout = await readFile(
        path.join(repo.root, stdoutReference.relativePath)
      );
      await writeFile(
        path.join(repo.root, ".gitignore"),
        nestedException(fixture.base, exception)
      );
      await assert.rejects(verificationOperation("execute", fixture.request), {
        code: "ARTIFACT_IGNORE_CONFLICT"
      });
      assert.deepEqual(
        await readFile(path.join(repo.root, fixture.base, "identity.json")),
        identity
      );
      assert.deepEqual(
        await readFile(path.join(repo.root, stdoutReference.relativePath)),
        stdout
      );
      const files = await readdir(path.join(repo.root, ".banzai"), {
        recursive: true
      });
      assert.ok(!files.includes(fixture.claim.slice(".banzai/".length)));
    } finally {
      await repo.dispose();
    }
  });
}

test("execution ownership refuses a Git-visible temporary claim before publishing it", async () => {
  const repo = await createTestRepository({ artifactLayout: null });
  try {
    const directory = "documentation/work/claim-probe";
    const base = `.banzai/execution-locks/${executionKey(directory)}`;
    await writeFile(
      path.join(repo.root, ".gitignore"),
      nestedException(base, ".artifact-tmp-*")
    );
    let invoked = false;
    await assert.rejects(
      withExecutionOwnership(repo.root, directory, async () => {
        invoked = true;
      }),
      { code: "ARTIFACT_IGNORE_CONFLICT" }
    );
    assert.equal(invoked, false);
    assert.deepEqual(await readdir(path.join(repo.root, base)), []);
  } finally {
    await repo.dispose();
  }
});

for (const exception of ["logs/", "approval/*.tmp"]) {
  test(`runner evidence refuses a nested ${exception} exception before writing private bytes`, async () => {
    const repo = await createTestRepository({ artifactLayout: null });
    try {
      const runId = "ignore-probe";
      const base = `.banzai/runs/${runId}`;
      const rules =
        exception === "logs/"
          ? nestedException(base, exception)
          : nestedException(base, "approval/") +
            `${base}/approval/*\n!${base}/approval/*.tmp\n`;
      await writeFile(path.join(repo.root, ".gitignore"), rules);
      const store = new RunStore(repo.root);
      await assert.rejects(
        exception === "logs/"
          ? store.writeText(
              runId,
              "logs/stdout.log",
              "synthetic private stdout"
            )
          : store.writeApprovalSnapshot(runId, "a".repeat(64), []),
        { code: "ARTIFACT_IGNORE_CONFLICT" }
      );
      const visible = await git(repo.root, [
        "status",
        "--porcelain",
        "--untracked-files=all"
      ]);
      assert.ok(!visible.includes(base), visible);
      assert.deepEqual(
        await readdir(
          path.join(
            repo.root,
            base,
            exception === "logs/" ? "logs" : "approval"
          )
        ).catch((error: unknown) => {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
          throw error;
        }),
        []
      );
    } finally {
      await repo.dispose();
    }
  });
}

test("standalone execution rejects an existing identity tracked despite an ignore rule", async () => {
  const repo = await createTestRepository({ artifactLayout: null });
  try {
    const fixture = await privateEvidenceFixture(repo.root);
    await verificationOperation("execute", fixture.request);
    await git(repo.root, ["add", "-f", "--", `${fixture.base}/identity.json`]);
    await assert.rejects(verificationOperation("execute", fixture.request), {
      code: "ARTIFACT_IGNORE_CONFLICT"
    });
    const files = await readdir(path.join(repo.root, ".banzai"), {
      recursive: true
    });
    assert.ok(!files.includes(fixture.claim.slice(".banzai/".length)));
  } finally {
    await repo.dispose();
  }
});

test("new executor binding groups tracked documents, ignores declarations and preserves existing work", async () => {
  const repo = await createTestRepository({ artifactLayout: null });
  try {
    await writeFile(
      path.join(repo.root, ".banzai/artifacts.json"),
      "invalid declaration stays inert\n"
    );
    await mkdir(path.join(repo.root, ".banzai/work/old"), { recursive: true });
    await writeFile(
      path.join(repo.root, ".banzai/work/old/plan.md"),
      "existing\n"
    );
    const bound = await createExecutionBinding({
      repoRoot: repo.root,
      slug: "new-work",
      mode: "workflow",
      runId: "new-run"
    });
    assert.equal(bound.binding.schemaVersion, 3);
    assert.equal(Object.hasOwn(bound.binding, "layout"), false);
    assert.equal(
      bound.binding.artifacts.plan,
      "documentation/work/new-work/plan.md"
    );
    assert.deepEqual(
      await readdir(path.join(repo.root, "documentation/work/new-work")),
      []
    );
    await writeFile(
      path.join(repo.root, bound.binding.artifacts.plan),
      "new plan\n"
    );
    assert.match(
      await git(repo.root, ["status", "--porcelain", "--untracked-files=all"]),
      /documentation\/work\/new-work\/plan.md/u
    );
    const inventory = await workDocumentInventory(repo.root, bound);
    assert.equal(
      new Set(inventory.map((item) => item.path)).size,
      inventory.length
    );
    assert.ok(
      inventory.some(
        (item) => item.path.endsWith("/plan.md") && item.kind === "file"
      )
    );
    assert.ok(
      inventory.some(
        (item) =>
          item.path.endsWith("/description.md") && item.kind === "deleted"
      )
    );
    assert.equal(
      await readFile(path.join(repo.root, ".banzai/work/old/plan.md"), "utf8"),
      "existing\n"
    );
    assert.equal(
      await readFile(path.join(repo.root, ".banzai/artifacts.json"), "utf8"),
      "invalid declaration stays inert\n"
    );
    await assert.rejects(
      createExecutionBinding({
        repoRoot: repo.root,
        slug: "new-work",
        mode: "workflow",
        runId: "other-run"
      }),
      /already exists/u
    );
    await assert.rejects(
      inspectBoundWork(repo.root, { ...bound, sha256: "a".repeat(64) }),
      /digest/u
    );
    assert.throws(
      () =>
        parseBinding({
          ...bound.binding,
          artifacts: {
            ...bound.binding.artifacts,
            plan: "documentation/work/other/plan.md"
          }
        }),
      /outside/u
    );
    assert.equal(documentRoles("lite-work", "lite").plan, undefined);
    assert.equal(
      documentRoles("fix-work", "fix").changeReport,
      "documentation/work/fix-work/change-report.md"
    );
    let invoked = false;
    await assert.rejects(
      withRunnerWorkOwnership(repo.root, undefined, async () => {
        invoked = true;
      }),
      { code: "ARTIFACT_VERSION_UNSUPPORTED" }
    );
    assert.equal(invoked, false);
  } finally {
    await repo.dispose();
  }
});

test("new work rejects hiding ignores and symlink escape without changing prior evidence", async () => {
  const repo = await createTestRepository();
  try {
    await writeFile(
      path.join(repo.root, ".gitignore"),
      "documentation/\n.banzai/\n"
    );
    await assert.rejects(
      createExecutionBinding({
        repoRoot: repo.root,
        slug: "hidden",
        mode: "strict",
        runId: "run"
      }),
      /ignored/u
    );
    await writeFile(path.join(repo.root, ".gitignore"), ".banzai/\n");
    await symlink(repo.root, path.join(repo.root, "documentation"));
    await assert.rejects(
      createExecutionBinding({
        repoRoot: repo.root,
        slug: "escape",
        mode: "strict",
        runId: "run"
      }),
      /symlinks/u
    );
    assert.throws(() => documentRoles("../escape", "strict"), /slug/u);
  } finally {
    await repo.dispose();
  }
});

test("execution ownership excludes concurrent executors and releases only its own claim on failure", async () => {
  const repo = await createTestRepository();
  try {
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = withExecutionOwnership(
      repo.root,
      "documentation/work/shared",
      async () => {
        entered();
        await hold;
      }
    );
    await started;
    await assert.rejects(
      withExecutionOwnership(
        repo.root,
        "documentation/work/shared",
        async () => {}
      ),
      /Another executor/u
    );
    release();
    await first;
    await assert.rejects(
      withExecutionOwnership(
        repo.root,
        "documentation/work/shared",
        async () => {
          throw new Error("failure");
        }
      ),
      /failure/u
    );
    await withExecutionOwnership(
      repo.root,
      "documentation/work/shared",
      async () => {}
    );
  } finally {
    await repo.dispose();
  }
});

test("standalone v3 verification reads selected documents without registration and retains physical checks privately", async () => {
  const repo = await createTestRepository({ artifactLayout: null });
  try {
    const directory = "documentation/work/standalone";
    await mkdir(path.join(repo.root, directory), { recursive: true });
    const documentPath = `${directory}/plan.md`;
    const remainder = "# Approved test plan\n\n";
    const checks = [
      {
        id: "check",
        name: "Real subprocess",
        requirementRefs: ["FR9"],
        command: process.execPath,
        args: ["-e", "process.exit(0)"],
        cwd: ".",
        timeoutMs: 10000,
        evidence: "fresh",
        sources: [],
        materialization: null
      }
    ];
    await writeFile(
      path.join(repo.root, documentPath),
      remainder +
        "```banzai-verification-obligations/v2\n" +
        JSON.stringify({
          schema: "banzai-verification-obligations/v2",
          schemaVersion: 2,
          complete: true,
          planRemainderSha256: evidenceDigest(remainder + "\n"),
          checks,
          absenceReason: null
        }) +
        "\n```\n"
    );
    const request = {
      schema: "banzai-verification-request/v3",
      schemaVersion: 3,
      repoRoot: repo.root,
      documentPath,
      workflow: "strict",
      roundId: randomUUID()
    };
    const before = await readdir(path.join(repo.root, ".banzai"));
    const absent = await verificationOperation("inspect", request);
    assert.equal(absent.evidence, "unavailable");
    assert.deepEqual(await readdir(path.join(repo.root, ".banzai")), before);
    const executed = await verificationOperation("execute", request);
    assert.equal(executed.applicability?.complete, true);
    assert.equal(executed.physicalAttempts, 1);
    assert.equal(
      (await verificationOperation("inspect", request)).physicalAttempts,
      1
    );
    assert.ok(
      (
        await git(repo.root, ["status", "--porcelain", "--untracked-files=all"])
      ).includes(documentPath)
    );
    assert.ok(
      !(
        await git(repo.root, ["status", "--porcelain", "--untracked-files=all"])
      ).includes(".banzai/verification/")
    );
    await assert.rejects(
      verificationOperation("execute", {
        ...request,
        schema: "banzai-verification-request/v2",
        schemaVersion: 2
      }),
      /v3/u
    );
  } finally {
    await repo.dispose();
  }
});

test("standalone verification retains failures, requires an exact retry and rejects changed authority", async () => {
  const repo = await createTestRepository({ artifactLayout: null });
  try {
    const documentPath = "documentation/work/retry/work.md";
    await mkdir(path.join(repo.root, "documentation/work/retry"), {
      recursive: true
    });
    const writeDocument = async (args: string[]) => {
      const remainder = "# Authorized standalone task\n\n";
      const checks = [
        {
          id: "real-check",
          name: "Failure and authority",
          requirementRefs: ["FR9"],
          command: process.execPath,
          args,
          cwd: ".",
          timeoutMs: 10000,
          evidence: "fresh",
          sources: [],
          materialization: null
        }
      ];
      await writeFile(
        path.join(repo.root, documentPath),
        remainder +
          "```banzai-verification-obligations/v2\n" +
          JSON.stringify({
            schema: "banzai-verification-obligations/v2",
            schemaVersion: 2,
            complete: true,
            planRemainderSha256: evidenceDigest(remainder + "\n"),
            checks,
            absenceReason: null
          }) +
          "\n```\n"
      );
    };
    await writeDocument([
      "-e",
      "process.exit(require('node:fs').existsSync('.banzai/allow') ? 0 : 1)"
    ]);
    const request = {
      schema: "banzai-verification-request/v3",
      schemaVersion: 3,
      repoRoot: repo.root,
      documentPath,
      workflow: "feature",
      roundId: randomUUID()
    };
    const failed = await verificationOperation("execute", request);
    assert.equal(failed.applicability?.complete, false);
    assert.equal(failed.attempts?.[0]?.status, "failed");
    await assert.rejects(
      verificationOperation("execute", request),
      /retry|unresolved/u
    );
    await writeFile(
      path.join(repo.root, ".banzai/allow"),
      "fixture permits success\n"
    );
    const passed = await verificationOperation("execute", {
      ...request,
      retryOf: failed.attempts[0].id
    });
    assert.equal(passed.applicability?.complete, true);
    assert.equal(passed.physicalAttempts, 2);
    assert.equal(passed.attempts?.[0]?.status, "failed");
    assert.equal(passed.attempts[1]?.retryOf, passed.attempts[0].id);
    await writeDocument([
      "-e",
      `require('node:fs').appendFileSync('${documentPath}', 'changed authority')`
    ]);
    await assert.rejects(
      verificationOperation("execute", { ...request, roundId: randomUUID() }),
      /changed/u
    );
    // A rejected application still releases only this execution's ownership.
    await withExecutionOwnership(
      repo.root,
      "documentation/work/retry",
      async () => {}
    );
    const historical =
      ".banzai/work/11111111-1111-4111-8111-111111111111/plan.md";
    await mkdir(path.dirname(path.join(repo.root, historical)), {
      recursive: true
    });
    await writeFile(
      path.join(repo.root, historical),
      "# Historical authority without inventory\n"
    );
    const unsupported = await verificationOperation("inspect", {
      ...request,
      documentPath: historical,
      workflow: "strict"
    });
    assert.equal(unsupported.supported, false);
    assert.equal(
      await readFile(path.join(repo.root, historical), "utf8"),
      "# Historical authority without inventory\n"
    );
  } finally {
    await repo.dispose();
  }
});
