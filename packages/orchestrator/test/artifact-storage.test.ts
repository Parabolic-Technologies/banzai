import { requiredFixture } from "./helpers.js";
import { verificationOperation } from "../../../plugins/banzai/lib/verification-helper.mjs";
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFile, spawnSync } from "node:child_process";
import {
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  symlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import {
  acquireWork,
  artifactCommand,
  ArtifactStorageError,
  createWork,
  digestBytes,
  initializeArtifacts,
  inspectArtifacts,
  readBinding,
  releaseWork,
  writeArtifact
} from "../src/artifact-storage.js";
import {
  createTestRepository,
  snapshotTree,
  evaluationStateFixture
} from "./helpers.js";

const execute = promisify(execFile);
const commandPath = path.resolve("../../plugins/banzai/scripts/artifacts.cjs");
const code = (expected: string) => (error: unknown) =>
  error instanceof ArtifactStorageError && error.code === expected;

test("R4-F1 standalone invocation inputs allow symlinked parents while artifact and archive boundaries remain strict", async () => {
  const repository = await createTestRepository({ artifactLayout: "private" });
  const temporary = await mkdtemp(path.join(tmpdir(), "banzai-invocation-"));
  try {
    const root = await realpath(repository.root);
    const physical = await realpath(temporary);
    const alias = path.join(physical, "alias");
    await symlink(physical, alias);
    const requestFile = path.join(alias, "request.json");
    const invoke = async (
      operation: string,
      fields: Record<string, unknown> = {}
    ) => {
      await writeFile(
        requestFile,
        JSON.stringify({
          schema: "banzai-artifact-request/v2",
          schemaVersion: 2,
          repoRoot: root,
          ...fields
        }),
        { mode: 0o600 }
      );
      const child = spawnSync(
        process.execPath,
        [commandPath, operation, "--json", requestFile],
        { encoding: "utf8" }
      );
      const result = JSON.parse(child.stdout) as Awaited<
        ReturnType<typeof artifactCommand>
      >;
      assert.equal(child.status, result.ok ? 0 : 1, child.stderr);
      return result;
    };
    assert.equal((await invoke("inspect")).ok, true);
    const linkedRequest = path.join(physical, "linked-request.json");
    await symlink(requestFile, linkedRequest);
    assert.equal(
      (await artifactCommand(["inspect", "--json", linkedRequest])).error?.code,
      "ARTIFACT_UNSAFE_PATH"
    );
    const work = await createWork({
      repoRoot: root,
      slug: "local-inputs",
      mode: "lite",
      creationId: randomUUID()
    });
    const workPath = `.banzai/work/${work.binding.workId}`;
    const artifactPath = work.binding.artifacts.work;
    assert.ok(artifactPath);
    const claim = await acquireWork({
      repoRoot: root,
      workPath,
      ownerId: "local-inputs"
    });
    const inputFile = path.join(alias, "input.md");
    await writeFile(inputFile, "# Invocation-local bytes\n", { mode: 0o600 });
    const write = {
      workPath,
      token: claim.token,
      artifactPath,
      inputFile,
      expectedSha256: null
    };
    const linkedInput = path.join(physical, "linked-input.md");
    await symlink(inputFile, linkedInput);
    assert.equal(
      (await invoke("write", { ...write, inputFile: linkedInput })).error?.code,
      "ARTIFACT_UNSAFE_PATH"
    );
    assert.equal((await invoke("write", write)).ok, true);
    assert.equal(
      await readFile(path.join(root, artifactPath), "utf8"),
      "# Invocation-local bytes\n"
    );
    await releaseWork({ repoRoot: root, workPath, token: claim.token });
    const inventory = await invoke("inventory", { workPaths: [workPath] });
    assert.equal(inventory.ok, true);
    const inventoryFile = path.join(alias, "inventory.json");
    await writeFile(
      inventoryFile,
      JSON.stringify((inventory.result as { inventory: unknown }).inventory),
      { mode: 0o600 }
    );
    const linkedInventory = path.join(physical, "linked-inventory.json");
    await symlink(inventoryFile, linkedInventory);
    const bundlePath = path.join(physical, "bundle");
    assert.equal(
      (
        await invoke("export", {
          inventoryFile: linkedInventory,
          destination: bundlePath
        })
      ).error?.code,
      "ARTIFACT_UNSAFE_PATH"
    );
    assert.equal(
      (
        await invoke("export", {
          inventoryFile,
          destination: path.join(alias, "bundle")
        })
      ).error?.code,
      "ARTIFACT_UNSAFE_PATH"
    );
    assert.equal(
      (await invoke("export", { inventoryFile, destination: bundlePath })).ok,
      true
    );
    assert.equal(
      (await invoke("verify", { bundlePath: path.join(alias, "bundle") })).error
        ?.code,
      "ARTIFACT_UNSAFE_PATH"
    );
    assert.equal(
      (
        await invoke("restore", {
          bundlePath,
          destination: path.join(alias, "restore")
        })
      ).error?.code,
      "ARTIFACT_UNSAFE_PATH"
    );
    assert.equal(
      (
        await invoke("restore", {
          bundlePath,
          destination: path.join(physical, "restore")
        })
      ).ok,
      true
    );
    await rm(path.join(root, workPath), { recursive: true });
    await symlink(physical, path.join(root, workPath));
    assert.equal(
      (await invoke("inspect", { workPath })).error?.code,
      "ARTIFACT_UNSAFE_PATH"
    );
  } finally {
    await repository.dispose();
    await rm(temporary, { recursive: true, force: true });
  }
});

test("artifact storage first use is read-only until writing and works without runner configuration", async () => {
  const repository = await createTestRepository({ artifactLayout: null });
  try {
    const root = await realpath(repository.root);
    await rm(path.join(root, ".banzai"), { recursive: true });
    await mkdir(path.join(root, "src/nested"), { recursive: true });
    await mkdir(path.join(root, "documentation"));
    await writeFile(
      path.join(root, "documentation/user-guide.md"),
      "# User guide\n"
    );
    const before = await snapshotTree(root);
    const inspection = await inspectArtifacts({
      repoRoot: path.join(root, "src/nested")
    });
    assert.equal(inspection.projectRoot, root);
    assert.equal(inspection.classification, "fresh");
    assert.equal(inspection.layout, "private");
    assert.deepEqual(await snapshotTree(root), before);
    const creationId = randomUUID();
    const request = {
      repoRoot: root,
      slug: "same-slug",
      mode: "strict" as const,
      creationId
    };
    const work = await createWork(request);
    assert.deepEqual(await createWork(request), work);
    assert.equal(
      work.binding.artifacts.plan,
      `.banzai/work/${creationId}/plan.md`
    );
    assert.equal(
      (await stat(path.join(root, `.banzai/work/${creationId}`))).mode & 0o777,
      0o700
    );
    assert.equal(
      (await stat(path.join(root, `.banzai/work/${creationId}/work.json`)))
        .mode & 0o777,
      0o600
    );
    assert.equal(
      (
        await execute("git", [
          "-C",
          root,
          "check-ignore",
          `.banzai/work/${creationId}/plan.md`
        ])
      ).stdout.trim(),
      `.banzai/work/${creationId}/plan.md`
    );
    const status = (
      await execute("git", [
        "-C",
        root,
        "status",
        "--short",
        "--untracked-files=all"
      ])
    ).stdout;
    assert.match(status, /\?\? \.banzai\/artifacts\.json/u);
    assert.doesNotMatch(status, /work\.json/u);
    assert.equal(
      (await execute("git", ["-C", root, "diff", "--cached", "--name-only"]))
        .stdout,
      ""
    );
    assert.equal(
      (await inspectArtifacts({ repoRoot: root, workId: creationId })).work
        ?.sha256,
      work.sha256
    );
  } finally {
    await repository.dispose();
  }
});

test("artifact storage ignores old documentation bundles and creates only private work", async () => {
  const repository = await createTestRepository({ artifactLayout: null });
  try {
    const root = await realpath(repository.root);
    const old = "documentation/features/old/work.md";
    await mkdir(path.dirname(path.join(root, old)), { recursive: true });
    await writeFile(path.join(root, old), "# Original approved bytes\n");
    const before = await snapshotTree(root);
    const inspection = await inspectArtifacts({ repoRoot: root });
    assert.equal(inspection.classification, "fresh");
    assert.equal(inspection.layout, "private");
    assert.deepEqual(await snapshotTree(root), before);
    await assert.rejects(
      inspectArtifacts({ repoRoot: root, workPath: old }),
      code("ARTIFACT_INPUT_INVALID")
    );
    const work = await createWork({
      repoRoot: root,
      slug: "old",
      mode: "lite",
      creationId: randomUUID()
    });
    assert.equal(work.binding.schemaVersion, 2);
    assert.ok(work.binding.artifacts.work?.startsWith(".banzai/work/"));
    assert.equal(
      await readFile(path.join(root, old), "utf8"),
      "# Original approved bytes\n"
    );
    await rm(path.join(root, ".banzai/artifacts.json"));
    await assert.rejects(
      inspectArtifacts({ repoRoot: root }),
      code("ARTIFACT_RECOVERY_REQUIRED")
    );
    assert.deepEqual(
      await readBinding(root, `.banzai/work/${work.binding.workId}`),
      work
    );
  } finally {
    await repository.dispose();
  }
});

test("artifact storage rejects unsafe first-use paths malformed metadata and broad ignores", async () => {
  const repository = await createTestRepository({ artifactLayout: null });
  try {
    const root = await realpath(repository.root);
    await writeFile(path.join(root, ".gitignore"), ".banzai/\n");
    const before = await snapshotTree(root);
    await assert.rejects(
      initializeArtifacts({ repoRoot: root }),
      code("ARTIFACT_IGNORE_CONFLICT")
    );
    assert.deepEqual(await snapshotTree(root), before);
    await writeFile(path.join(root, ".gitignore"), "");
    await writeFile(
      path.join(root, ".banzai/artifacts.json"),
      "{malformed secret-value}"
    );
    const result = await artifactCommand([
      "inspect",
      "--json",
      "missing-request.json"
    ]);
    assert.equal(result.ok, false);
    assert.doesNotMatch(JSON.stringify(result), /secret-value/u);
    await assert.rejects(
      inspectArtifacts({ repoRoot: root }),
      code("ARTIFACT_INPUT_INVALID")
    );
    await rm(path.join(root, ".banzai/artifacts.json"));
    await mkdir(path.join(root, "outside"));
    await symlink(path.join(root, "outside"), path.join(root, ".banzai/work"));
    await assert.rejects(
      initializeArtifacts({ repoRoot: root }),
      code("ARTIFACT_UNSAFE_PATH")
    );
    assert.equal((await snapshotTree(path.join(root, "outside"))).length, 0);
  } finally {
    await repository.dispose();
  }
});

test("artifact storage conditional writes enforce ownership without blocking independent work", async () => {
  const repository = await createTestRepository({ artifactLayout: null });
  try {
    const root = await realpath(repository.root);
    const first = await createWork({
      repoRoot: root,
      slug: "same",
      mode: "strict",
      creationId: randomUUID()
    });
    const second = await createWork({
      repoRoot: root,
      slug: "same",
      mode: "strict",
      creationId: randomUUID()
    });
    const a = {
      repoRoot: root,
      workPath: `.banzai/work/${first.binding.workId}/work.json`
    };
    const b = {
      repoRoot: root,
      workPath: `.banzai/work/${second.binding.workId}/work.json`
    };
    const claim = await acquireWork({ ...a, ownerId: "codex" });
    await assert.rejects(
      acquireWork({ ...a, ownerId: "claude" }),
      code("ARTIFACT_OWNERSHIP_CONFLICT")
    );
    const other = await acquireWork({ ...b, ownerId: "claude" });
    await assert.rejects(
      releaseWork({ ...a, token: other.token }),
      code("ARTIFACT_OWNERSHIP_CONFLICT")
    );
    const inputFile = path.join(root, "draft.md");
    await writeFile(inputFile, "first evidence\n");
    const description = first.binding.artifacts.description;
    const otherDescription = second.binding.artifacts.description;
    assert.ok(description);
    assert.ok(otherDescription);
    const request = {
      ...a,
      token: claim.token,
      inputFile,
      artifactPath: description,
      expectedSha256: null
    };
    await writeArtifact(request);
    await assert.rejects(
      writeArtifact(request),
      code("ARTIFACT_OWNERSHIP_CONFLICT")
    );
    await assert.rejects(
      writeArtifact({ ...request, artifactPath: otherDescription }),
      code("ARTIFACT_UNSAFE_PATH")
    );
    await assert.rejects(
      writeArtifact({ ...request, artifactPath: ".banzai/runs/a/state.json" }),
      code("ARTIFACT_UNSAFE_PATH")
    );
    await writeFile(inputFile, "second evidence\n");
    const written = await writeArtifact({
      ...request,
      expectedSha256: digestBytes("first evidence\n")
    });
    assert.equal(written.sha256, digestBytes("second evidence\n"));
    await releaseWork({ ...a, token: claim.token });
    assert.ok((await acquireWork({ ...a, ownerId: "fresh-session" })).token);
    await releaseWork({ ...b, token: other.token });
  } finally {
    await repository.dispose();
  }
});

test("artifact storage plugin processes converge on first use and reject a conflicting writer", async () => {
  const repository = await createTestRepository({ artifactLayout: null });
  try {
    const root = await realpath(repository.root);
    const requestPath = path.join(root, "request.json");
    const envelope = {
      schema: "banzai-artifact-request/v2",
      schemaVersion: 2,
      repoRoot: root
    };
    await writeFile(requestPath, JSON.stringify(envelope));
    const initialize = () =>
      execute(process.execPath, [
        commandPath,
        "initialize",
        "--json",
        requestPath
      ]);
    const results = await Promise.all([initialize(), initialize()]);
    for (const result of results)
      assert.equal((JSON.parse(result.stdout) as { ok: boolean }).ok, true);
    const creationId = randomUUID();
    await writeFile(
      requestPath,
      JSON.stringify({
        ...envelope,
        slug: "parallel",
        mode: "lite",
        creationId
      })
    );
    const create = () =>
      execute(process.execPath, [commandPath, "create", "--json", requestPath]);
    const created = await Promise.all([create(), create()]);
    assert.deepEqual(
      JSON.parse(created[0].stdout),
      JSON.parse(created[1].stdout)
    );
    await writeFile(
      requestPath,
      JSON.stringify({
        ...envelope,
        workPath: `.banzai/work/${creationId}`,
        ownerId: "client"
      })
    );
    const acquire = () =>
      execute(process.execPath, [
        commandPath,
        "acquire",
        "--json",
        requestPath
      ]);
    const owners = await Promise.allSettled([acquire(), acquire()]);
    assert.equal(
      owners.filter((result) => result.status === "fulfilled").length,
      1
    );
    const rejected = owners.find((result) => result.status === "rejected");
    assert.ok(rejected);
    assert.match(
      (rejected.reason as { stdout: string }).stdout,
      /ARTIFACT_OWNERSHIP_CONFLICT/u
    );
  } finally {
    await repository.dispose();
  }
});

test("artifact storage keeps worktrees isolated and explicit handoff independent of other work", async () => {
  const repository = await createTestRepository({ artifactLayout: null });
  try {
    const root = await realpath(repository.root);
    const first = await createWork({
      repoRoot: root,
      slug: "shared-name",
      mode: "lite",
      creationId: randomUUID()
    });
    const checkout = path.join(root, "other-checkout");
    await execute("git", [
      "-C",
      root,
      "worktree",
      "add",
      "--detach",
      checkout,
      "HEAD"
    ]);
    await mkdir(path.join(checkout, "src/nested"), { recursive: true });
    const second = await createWork({
      repoRoot: path.join(checkout, "src/nested"),
      slug: "shared-name",
      mode: "lite",
      creationId: randomUUID()
    });
    assert.notEqual(first.binding.workId, second.binding.workId);
    assert.equal(
      (await inspectArtifacts({ repoRoot: checkout })).projectRoot,
      checkout
    );
    await assert.rejects(
      inspectArtifacts({ repoRoot: checkout, workId: first.binding.workId }),
      code("ARTIFACT_EVIDENCE_INCOMPLETE")
    );
    const unrelated = randomUUID();
    await mkdir(path.join(root, `.banzai/work/${unrelated}`));
    await writeFile(
      path.join(root, `.banzai/work/${unrelated}/work.json`),
      "broken"
    );
    assert.equal(
      (await inspectArtifacts({ repoRoot: root, workId: first.binding.workId }))
        .work?.sha256,
      first.sha256
    );
  } finally {
    await repository.dispose();
  }
});

test("artifact storage archive round trip preserves originals, proves closure and refuses corrupt or conflicting restore", async () => {
  const repository = await createTestRepository({ artifactLayout: null });
  try {
    const root = await realpath(repository.root);
    const work = await createWork({
      repoRoot: root,
      slug: "archive",
      mode: "lite",
      creationId: randomUUID()
    });
    const role = work.binding.artifacts.work;
    assert.ok(role);
    await writeFile(
      path.join(root, role),
      "# Work\n\nOriginal human decision: approved.\n"
    );
    const invoke = async (
      operation: string,
      fields: Record<string, unknown>
    ) => {
      const requestFile = path.join(root, "archive-request.json");
      await writeFile(
        requestFile,
        JSON.stringify({
          schema: "banzai-artifact-request/v2",
          schemaVersion: 2,
          repoRoot: root,
          ...fields
        })
      );
      return await artifactCommand([operation, "--json", requestFile]);
    };
    const source = `.banzai/work/${work.binding.workId}`;
    const original = await readFile(path.join(root, source, "work.json"));
    const archiveDirectory = path.join(root, "archive");
    const inventoried = await invoke("inventory", { workPaths: [source] });
    assert.equal(inventoried.ok, true, JSON.stringify(inventoried.error));
    const inventoryFile = path.join(root, "reviewed-inventory.json");
    await writeFile(
      inventoryFile,
      JSON.stringify((inventoried.result as { inventory: unknown }).inventory)
    );
    const exported = await invoke("export", {
      inventoryFile,
      destination: archiveDirectory
    });
    assert.equal(exported.ok, true, JSON.stringify(exported.error));
    const verified = await invoke("verify", { bundlePath: archiveDirectory });
    assert.equal(verified.ok, true, JSON.stringify(verified.error));
    assert.equal((verified.result as { complete: boolean }).complete, true);
    const destination = path.join(root, "restored");
    const restored = await invoke("restore", {
      bundlePath: archiveDirectory,
      destination
    });
    assert.equal(restored.ok, true, JSON.stringify(restored.error));
    assert.equal(
      (restored.result as { historicalOnly: boolean }).historicalOnly,
      true
    );
    assert.deepEqual(
      await readFile(path.join(destination, source, "work.json")),
      original
    );
    assert.deepEqual(
      await readFile(path.join(root, source, "work.json")),
      original
    );
    assert.equal(
      (
        await invoke("restore", {
          bundlePath: archiveDirectory,
          destination
        })
      ).ok,
      true
    );
    await writeFile(path.join(destination, role), "conflict");
    assert.equal(
      (
        await invoke("restore", {
          bundlePath: archiveDirectory,
          destination
        })
      ).error?.code,
      "ARTIFACT_DESTINATION_CONFLICT"
    );
    const manifest = JSON.parse(
      await readFile(path.join(archiveDirectory, "manifest.json"), "utf8")
    ) as { entries: { object: string }[] };
    assert.ok(manifest.entries[0]);
    await writeFile(
      path.join(archiveDirectory, manifest.entries[0].object),
      "corrupt"
    );
    assert.equal(
      (await invoke("verify", { bundlePath: archiveDirectory })).error?.code,
      "ARTIFACT_EVIDENCE_INCOMPLETE"
    );
  } finally {
    await repository.dispose();
  }
});

for (const context of [
  "banzai-source",
  "home-project",
  "client-project"
] as const) {
  test(`artifact storage standalone ${context} starts without a private directory`, async () => {
    const repository = await createTestRepository({ artifactLayout: null });
    try {
      const root = await realpath(repository.root);
      await rm(path.join(root, ".banzai"), { recursive: true });
      if (context === "banzai-source") {
        await mkdir(path.join(root, ".codex-plugin"), { recursive: true });
        await writeFile(
          path.join(root, ".codex-plugin/plugin.json"),
          '{"name":"banzai"}\n'
        );
        await writeFile(
          path.join(root, "AGENTS.md"),
          "# Source repository instructions\n"
        );
      }
      const work = await createWork({
        repoRoot: root,
        slug: "example",
        mode: "lite",
        creationId: randomUUID()
      });
      assert.equal(work.binding.layout, "private");
      assert.equal(
        work.binding.artifacts.work,
        `.banzai/work/${work.binding.workId}/work.md`
      );
      assert.equal(
        (await inspectArtifacts({ repoRoot: root })).candidates.length,
        1
      );
      await assert.rejects(readFile(path.join(root, ".banzai/config.json")), {
        code: "ENOENT"
      });
      await assert.rejects(
        readFile(path.join(root, ".banzai/active-run.json")),
        { code: "ENOENT" }
      );
    } finally {
      await repository.dispose();
    }
  });
}

const artifactRequest = async (
  root: string,
  operation: string,
  fields: Record<string, unknown>
) => {
  const filename = path.join(root, `request-${randomUUID()}.json`);
  await writeFile(
    filename,
    JSON.stringify({
      schema: "banzai-artifact-request/v2",
      schemaVersion: 2,
      repoRoot: root,
      ...fields
    })
  );
  return artifactCommand([operation, "--json", filename]);
};

test("accepted F1 rejects selected UUID and nested ignore negations before publishing private bytes", async () => {
  const repository = await createTestRepository({ artifactLayout: "private" });
  try {
    const root = await realpath(repository.root);
    const creationId = randomUUID();
    await writeFile(
      path.join(root, ".gitignore"),
      `.banzai/runs/\n.banzai/work/*\n!.banzai/work/${creationId}/\n`
    );
    await assert.rejects(
      createWork({
        repoRoot: root,
        creationId,
        slug: "selected",
        mode: "lite"
      }),
      code("ARTIFACT_IGNORE_CONFLICT")
    );
    await assert.rejects(
      readFile(path.join(root, `.banzai/work/${creationId}/work.json`)),
      { code: "ENOENT" }
    );
    await writeFile(
      path.join(root, ".gitignore"),
      ".banzai/work/\n.banzai/runs/\n"
    );
    const work = await createWork({
      repoRoot: root,
      creationId,
      slug: "selected",
      mode: "lite"
    });
    const workPath = `.banzai/work/${creationId}/work.json`;
    const claim = await acquireWork({
      repoRoot: root,
      workPath,
      ownerId: "fixture"
    });
    const inputFile = path.join(root, "input");
    await writeFile(inputFile, "private report");
    assert.ok(work.binding.artifacts.work);
    // Keep metadata ignored while a nested rule exposes only the exact report.
    await writeFile(
      path.join(root, ".gitignore"),
      ".banzai/work/**\n!.banzai/work/\n!.banzai/work/*/\n.banzai/runs/\n"
    );
    await writeFile(
      path.join(root, `.banzai/work/${creationId}/.gitignore`),
      "!work.md\n"
    );
    await assert.rejects(
      writeArtifact({
        repoRoot: root,
        workPath,
        token: claim.token,
        artifactPath: work.binding.artifacts.work,
        inputFile,
        expectedSha256: null
      }),
      code("ARTIFACT_IGNORE_CONFLICT")
    );
    await assert.rejects(
      readFile(path.join(root, work.binding.artifacts.work)),
      { code: "ENOENT" }
    );
    await writeFile(
      path.join(root, ".gitignore"),
      ".banzai/work/\n.banzai/runs/\n"
    );
    await writeArtifact({
      repoRoot: root,
      workPath,
      token: claim.token,
      artifactPath: work.binding.artifacts.work,
      inputFile,
      expectedSha256: null
    });
    await releaseWork({ repoRoot: root, workPath, token: claim.token });
    assert.doesNotMatch(
      (
        await execute("git", [
          "-C",
          root,
          "status",
          "--short",
          "--untracked-files=all"
        ])
      ).stdout,
      /private report|work\.json|work\.md/u
    );
  } finally {
    await repository.dispose();
  }
});

test("all artifact operations reject request v1 before any project mutation", async () => {
  const repository = await createTestRepository();
  try {
    const root = await realpath(repository.root);
    const requestFile = path.join(root, "old-request.json");
    await writeFile(
      requestFile,
      JSON.stringify({
        schema: "banzai-artifact-request/v1",
        schemaVersion: 1,
        repoRoot: root
      }),
      { mode: 0o600 }
    );
    const before = await snapshotTree(root);
    for (const operation of [
      "inventory",
      "export",
      "verify",
      "restore",
      "inspect",
      "initialize",
      "create",
      "acquire",
      "write",
      "release"
    ]) {
      const response = await artifactCommand([
        operation,
        "--json",
        requestFile
      ]);
      assert.equal(response.ok, false);
      assert.equal(
        response.error?.code,
        "RESOURCE_VERSION_UNSUPPORTED",
        operation
      );
      assert.match(
        response.error.message,
        /^artifact request version .+ is not supported; 3\.x supports .+; last read by release-train major 2$/u,
        operation
      );
      assert.deepEqual(await snapshotTree(root), before, operation);
    }
  } finally {
    await repository.dispose();
  }
});

test("a removed artifact declaration layout is refused without changing evidence", async () => {
  const repository = await createTestRepository();
  try {
    const root = await realpath(repository.root);
    const declarationPath = path.join(root, ".banzai/artifacts.json");
    const declaration = JSON.parse(
      await readFile(declarationPath, "utf8")
    ) as Record<string, unknown>;
    await writeFile(
      declarationPath,
      JSON.stringify({ ...declaration, layout: "legacy" })
    );
    const before = await snapshotTree(root);
    for (const action of [
      () => inspectArtifacts({ repoRoot: root }),
      () => initializeArtifacts({ repoRoot: root }),
      () =>
        createWork({
          repoRoot: root,
          slug: "blocked",
          mode: "lite",
          creationId: randomUUID()
        })
    ]) {
      await assert.rejects(action(), {
        code: "RESOURCE_VERSION_UNSUPPORTED",
        message:
          /^artifact layout version legacy is not supported; 3\.x supports private; last read by release-train major 2$/u
      });
      assert.deepEqual(await snapshotTree(root), before);
    }
  } finally {
    await repository.dispose();
  }
});

test("binding v1 is refused by readers and writers without changing files or claims", async () => {
  const repository = await createTestRepository();
  try {
    const root = await realpath(repository.root);
    const work = await createWork({
      repoRoot: root,
      slug: "current",
      mode: "lite",
      creationId: randomUUID()
    });
    const workPath = `.banzai/work/${work.binding.workId}`;
    await writeFile(
      path.join(root, workPath, "work.json"),
      JSON.stringify({
        ...work.binding,
        schema: "banzai-work-binding/v1",
        schemaVersion: 1
      })
    );
    const before = await snapshotTree(root);
    for (const action of [
      () => readBinding(root, workPath),
      () => inspectArtifacts({ repoRoot: root, workPath }),
      () => acquireWork({ repoRoot: root, workPath, ownerId: "test" }),
      () => releaseWork({ repoRoot: root, workPath, token: randomUUID() }),
      () =>
        writeArtifact({
          repoRoot: root,
          workPath,
          token: randomUUID(),
          artifactPath: `${workPath}/work.md`,
          inputFile: path.join(root, "missing.md"),
          expectedSha256: null
        })
    ]) {
      await assert.rejects(action(), {
        code: "RESOURCE_VERSION_UNSUPPORTED",
        message:
          /^.+ version .+ is not supported; 3\.x supports .+; last read by release-train major 2$/u
      });
      assert.deepEqual(await snapshotTree(root), before);
    }
  } finally {
    await repository.dispose();
  }
});

test("accepted F5 F6 F7 F9 archive reviewed bytes, mandatory Markdown authority, pins and safe restore ancestry", async () => {
  const repository = await createTestRepository({ artifactLayout: "private" });
  const other = await createTestRepository({ artifactLayout: "private" });
  try {
    const root = await realpath(repository.root);
    const bound = await createWork({
      repoRoot: root,
      slug: "pinned",
      mode: "lite",
      creationId: randomUUID()
    });
    const workPath = `.banzai/work/${bound.binding.workId}`;
    const role = bound.binding.artifacts.work;
    assert.ok(role);
    const authority = "documentation/decisions/0042-fixture.md";
    await writeFile(
      path.join(root, role),
      "# Feature: Pinned\n\nSlug: `pinned`\nExample: `[Accepted ADR](../../../documentation/decisions/missing.md)`\n```md\n[Accepted ADR](../../../documentation/decisions/also-missing.md)\n```\n[Accepted ADR](../../../documentation/decisions/0042-fixture.md)\n[Historical (optional): old plan](../../../documentation/development-plans/missing/plan.md)\n"
    );
    const missing = await artifactRequest(root, "inventory", {
      workPaths: [workPath]
    });
    assert.equal(missing.ok, true);
    assert.equal((missing.result as { complete: boolean }).complete, false);
    const runId = "run-only-selection";
    await mkdir(path.join(root, `.banzai/runs/${runId}`), { recursive: true });
    await writeFile(
      path.join(root, `.banzai/runs/${runId}/state.json`),
      JSON.stringify(
        evaluationStateFixture({
          workflow: "feature",
          extra: {
            schemaVersion: 5,
            runId,
            slug: "pinned",
            repoRoot: root,
            artifactBinding: bound
          }
        })
      )
    );
    const fromRun = await artifactRequest(root, "inventory", {
      runIds: [runId]
    });
    assert.equal(fromRun.ok, true);
    assert.equal(
      (fromRun.result as { complete: boolean }).complete,
      false,
      "runIds-only must include bound Markdown authority closure"
    );

    await mkdir(path.join(root, "documentation/decisions"), {
      recursive: true
    });
    await writeFile(path.join(root, authority), "# Accepted ADR fixture\n");
    const found = await artifactRequest(root, "inventory", {
      workPaths: [workPath]
    });
    assert.equal(found.ok, true);
    const result = found.result as {
      complete: boolean;
      inventory: { retention: unknown };
    };
    assert.equal(result.complete, true);
    const pins = [
      {
        sourceId: "project",
        workId: bound.binding.workId,
        reason: "Closed work retained for owner audit",
        recordedAt: "2026-09-11T00:00:00.000Z"
      }
    ];
    result.inventory.retention = {
      policy: "owner",
      rules: {},
      ownerPolicy: {
        ownerId: "fixture-custodian",
        recordedAt: "2026-09-11T00:00:00.000Z",
        terms:
          "Unreferenced logs eligible after 7 days; pins and required dependency closure override eligibility."
      },
      pins,
      deletionAuthorized: false
    };
    const inventoryFile = path.join(root, "reviewed.json");
    await writeFile(inventoryFile, JSON.stringify(result.inventory));
    await writeFile(path.join(root, authority), "changed after inventory");
    assert.equal(
      (
        await artifactRequest(root, "export", {
          inventoryFile,
          destination: path.join(root, "stale")
        })
      ).error?.code,
      "ARTIFACT_OWNERSHIP_CONFLICT"
    );
    await assert.rejects(stat(path.join(root, "stale")), { code: "ENOENT" });
    await writeFile(path.join(root, authority), "# Accepted ADR fixture\n");
    const bundlePath = path.join(root, "archive");
    assert.equal(
      (
        await artifactRequest(root, "export", {
          inventoryFile,
          destination: bundlePath
        })
      ).ok,
      true
    );
    const verified = await artifactRequest(root, "verify", { bundlePath });
    assert.equal(verified.ok, true);
    const verifiedResult = verified.result as {
      complete: boolean;
      retainedPaths: string[];
    };
    assert.equal(verifiedResult.complete, true);
    assert.ok(verifiedResult.retainedPaths.includes(authority));
    for (const target of [root, await realpath(other.root)]) {
      const otherWork = await createWork({
        repoRoot: target,
        slug: "active",
        mode: "lite",
        creationId: randomUUID()
      });
      const selected = `.banzai/work/${otherWork.binding.workId}`;
      const claim = await acquireWork({
        repoRoot: target,
        workPath: selected,
        ownerId: "other"
      });
      const destination = path.join(target, selected, "restore");
      assert.equal(
        (await artifactRequest(root, "restore", { bundlePath, destination }))
          .error?.code,
        "ARTIFACT_UNSAFE_PATH"
      );
      await assert.rejects(stat(destination), { code: "ENOENT" });
      const runParent = path.join(target, ".banzai/runs/active");
      await mkdir(runParent, { recursive: true });
      assert.equal(
        (
          await artifactRequest(root, "restore", {
            bundlePath,
            destination: path.join(runParent, "restore")
          })
        ).error?.code,
        "ARTIFACT_UNSAFE_PATH"
      );
      await mkdir(path.join(target, ".banzai/bridge"));
      const aliased = `${target}/.banzai/bridge/../work/${otherWork.binding.workId}/restore`;
      assert.equal(
        (
          await artifactRequest(root, "restore", {
            bundlePath,
            destination: aliased
          })
        ).error?.code,
        "ARTIFACT_UNSAFE_PATH"
      );
      await assert.rejects(stat(destination), { code: "ENOENT" });
      await releaseWork({
        repoRoot: target,
        workPath: selected,
        token: claim.token
      });
    }
    const restored = await artifactRequest(root, "restore", {
      bundlePath,
      destination: path.join(root, "inspection")
    });
    assert.equal(restored.ok, true);
    assert.deepEqual(
      (restored.result as { retention: unknown }).retention,
      result.inventory.retention
    );
    assert.deepEqual(
      await readFile(
        path.join(root, "inspection/.banzai/archive-manifest.json")
      ),
      await readFile(path.join(bundlePath, "manifest.json"))
    );
    assert.equal(
      await readFile(path.join(root, "inspection", authority), "utf8"),
      "# Accepted ADR fixture\n"
    );
    assert.equal(
      (await artifactRequest(root, "inventory", { paths: [workPath] })).error
        ?.code,
      "ARTIFACT_INPUT_INVALID"
    );
    const manifestPath = path.join(bundlePath, "manifest.json");
    const tampered = JSON.parse(await readFile(manifestPath, "utf8")) as {
      dependencies: { to: string; required: boolean }[];
    };
    const required = tampered.dependencies.find(
      (edge) => edge.to === authority
    );
    assert.ok(required);
    required.required = false;
    await writeFile(manifestPath, JSON.stringify(tampered));
    assert.equal(
      (await artifactRequest(root, "verify", { bundlePath })).error?.code,
      "ARTIFACT_EVIDENCE_INCOMPLETE"
    );
    assert.equal(
      (
        await artifactRequest(root, "restore", {
          bundlePath,
          destination: path.join(root, "downgraded")
        })
      ).error?.code,
      "ARTIFACT_EVIDENCE_INCOMPLETE"
    );
    const plan = "documentation/development-plans/strict/plan.md";
    await mkdir(path.dirname(path.join(root, plan)), { recursive: true });
    await writeFile(
      path.join(root, plan),
      "# Development Plan: Strict\n[Required description](../../features/strict/description.md)\n"
    );
    const strict = await artifactRequest(root, "inventory", {
      workPaths: [plan]
    });
    assert.equal(strict.ok, true);
    assert.equal((strict.result as { complete: boolean }).complete, false);
  } finally {
    await repository.dispose();
    await other.dispose();
  }
});

test("accepted F11 standalone and bundled CLI outputs validate against the shipped closed result schema", async () => {
  const repository = await createTestRepository();
  try {
    // Reuse the JSON Schema validator supplied by the pinned ESLint toolchain.
    const require = createRequire(import.meta.url);
    const toolRequire = createRequire(require.resolve("eslint/package.json"));
    const Ajv = toolRequire("ajv") as new (
      options: Record<string, unknown>
    ) => {
      compile(
        schema: unknown
      ): ((value: unknown) => boolean) & { errors?: unknown };
    };
    const validator = new Ajv({ allErrors: true });
    const schema = JSON.parse(
      await readFile(
        path.resolve(
          "../../plugins/banzai/contracts/artifacts/v1/result.schema.json"
        ),
        "utf8"
      )
    ) as Record<string, unknown>;
    delete schema.$schema;
    const validate = validator.compile(schema);
    const root = await realpath(repository.root);
    const request = path.join(root, "inspect.json");
    await writeFile(
      request,
      JSON.stringify({
        schema: "banzai-artifact-request/v2",
        schemaVersion: 2,
        repoRoot: root
      })
    );
    const work = await createWork({
      repoRoot: root,
      slug: "contract",
      mode: "lite",
      creationId: randomUUID()
    });
    const workPath = `.banzai/work/${work.binding.workId}`;
    const inventoried = await artifactRequest(root, "inventory", {
      workPaths: [workPath]
    });
    assert.equal(inventoried.ok, true);
    const inventoryFile = path.join(root, "reviewed-inventory.json");
    await writeFile(
      inventoryFile,
      JSON.stringify((inventoried.result as { inventory: unknown }).inventory)
    );
    for (const executable of [commandPath, path.resolve("dist/banzai.mjs")]) {
      const bundlePath = path.join(
        root,
        `${path.basename(executable)}-archive`
      );
      const validArgs: string[][] = [];
      for (const [operation, fields] of Object.entries({
        inventory: { workPaths: [workPath] },
        export: { inventoryFile, destination: bundlePath },
        verify: { bundlePath },
        restore: { bundlePath, destination: `${bundlePath}-restored` }
      })) {
        const input = {
          schema: "banzai-artifact-request/v2",
          schemaVersion: 2,
          repoRoot: root,
          ...fields
        };
        const contract = JSON.parse(
          await readFile(
            path.resolve(
              `../../plugins/banzai/contracts/artifacts/v2/${operation}-request.schema.json`
            ),
            "utf8"
          )
        ) as Record<string, unknown>;
        delete contract.$schema;
        const validateRequest = validator.compile(contract);
        assert.equal(
          validateRequest(input),
          true,
          JSON.stringify(validateRequest.errors)
        );
        const filename = path.join(
          root,
          `${path.basename(executable)}-${operation}.json`
        );
        await writeFile(filename, JSON.stringify(input));
        validArgs.push([operation, "--json", filename]);
      }
      for (const args of [
        [],
        ["unknown"],
        ["inspect", "--json", request],
        ["inspect", "--json", path.join(root, "absent.json")],
        ...validArgs
      ]) {
        let stdout: string;
        const commandArgs = [
          executable,
          ...(executable === commandPath ? [] : ["artifacts"]),
          ...args
        ];
        try {
          stdout = (await execute(process.execPath, commandArgs)).stdout;
        } catch (error) {
          stdout = (error as { stdout: string }).stdout;
        }
        const response: unknown = JSON.parse(stdout);
        assert.equal(validate(response), true, JSON.stringify(validate.errors));
        if (validArgs.includes(args))
          assert.equal(
            (response as { ok: boolean }).ok,
            true,
            JSON.stringify(response)
          );
      }
    }
  } finally {
    await repository.dispose();
  }
});

test("standalone verification refuses unsupported ledgers before claims or evidence creation", async () => {
  const repository = await createTestRepository({ artifactLayout: "private" });
  try {
    const root = await realpath(repository.root);
    const created = await createWork({
      repoRoot: root,
      slug: "ledger-preflight",
      mode: "lite",
      creationId: randomUUID()
    });
    const workPath = `.banzai/work/${created.binding.workId}/work.json`;
    const evidence = created.binding.artifacts.verificationDirectory;
    assert.ok(evidence);
    await mkdir(path.join(root, evidence), { recursive: true });
    await writeFile(
      path.join(root, evidence, "ledger.json"),
      '{"schemaVersion":1}\n'
    );
    await writeFile(
      path.join(root, ".banzai/config.json"),
      JSON.stringify({
        schemaVersion: 3,
        verification: {
          profiles: [
            {
              id: "project",
              projectType: "custom",
              commands: [
                {
                  id: "unit",
                  name: "Unit",
                  command: process.execPath,
                  args: [
                    "-e",
                    "require('node:fs').writeFileSync('unexpected-check', 'ran')"
                  ],
                  timeoutMs: 1000
                }
              ]
            }
          ]
        }
      })
    );
    const request = {
      schema: "banzai-verification-request/v1",
      schemaVersion: 1,
      repoRoot: root,
      workPath,
      roundId: randomUUID()
    };
    const refused = (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(
        (error as Error & { code: string }).code,
        "RESOURCE_VERSION_UNSUPPORTED"
      );
      assert.equal(
        error.message,
        "verification ledger version 1 is not supported; 3.x supports 2; last read by release-train major 2"
      );
      return true;
    };
    for (const operation of ["inspect", "decide", "execute"]) {
      const before = await snapshotTree(root);
      await assert.rejects(
        verificationOperation(operation, {
          ...request,
          ...(operation === "execute" ? { checkId: "unit" } : {})
        }),
        refused
      );
      assert.deepEqual(await snapshotTree(root), before);
    }
    // A held owner claim must never be consulted or replaced on version refusal.
    const claim = await acquireWork({
      repoRoot: root,
      workPath,
      ownerId: "preflight-owner"
    });
    try {
      const before = await snapshotTree(root);
      await assert.rejects(
        verificationOperation("execute", { ...request, checkId: "unit" }),
        refused
      );
      assert.deepEqual(await snapshotTree(root), before);
    } finally {
      await releaseWork({ repoRoot: root, workPath, token: claim.token });
    }
  } finally {
    await repository.dispose();
  }
});

test("standalone verification owns binding v2 evidence and reuses direct physical origins without CLI models", async () => {
  const repository = await createTestRepository({ artifactLayout: "private" });
  try {
    const root = await realpath(repository.root);
    const executable = await realpath(process.execPath);
    const created = await createWork({
      repoRoot: root,
      slug: "evidence",
      mode: "lite",
      creationId: randomUUID(),
      schemaVersion: 2
    });
    assert.equal(created.binding.schemaVersion, 2);
    const workPath = `.banzai/work/${created.binding.workId}/work.json`;
    const notes = path.join(root, "notes.md");
    await writeFile(
      notes,
      "First explanatory sentence. Second explanatory sentence.\n"
    );
    await writeFile(
      path.join(root, ".banzai/config.json"),
      JSON.stringify({
        schemaVersion: 3,
        verification: {
          profiles: [
            {
              id: "project",
              projectType: "custom",
              commands: [
                {
                  id: "unit",
                  name: "Unit",
                  command: executable,
                  args: ["-e", 'console.log("physical fixture check")'],
                  timeoutMs: 2000,
                  evidence: "equivalent_evidence",
                  ignoreExplanatory: true
                }
              ]
            }
          ],
          policy: {
            schema: "banzai-verification-policy/v1",
            schemaVersion: 1,
            explanatory: [{ path: "notes.md", regions: [] }],
            dependencies: {
              complete: true,
              exclude: [],
              toolchain: [executable],
              environment: { LANG: "C" },
              volatile: []
            }
          }
        }
      })
    );
    const request = {
      schema: "banzai-verification-request/v1",
      schemaVersion: 1,
      repoRoot: root,
      workPath,
      roundId: randomUUID()
    };
    const first = await verificationOperation("execute", {
      ...request,
      checkId: "unit"
    });
    assert.equal(first.supported, true);
    assert.equal(first.physicalAttempts, 1);
    assert.equal(first.applicability?.complete, true);
    assert.equal(first.applicability.dispositions[0]?.kind, "executed");
    await writeFile(
      notes,
      "Revised explanatory sentence. Another explanatory sentence.\n"
    );
    const second = await verificationOperation("execute", {
      ...request,
      roundId: randomUUID(),
      checkId: "unit"
    });
    assert.equal(second.physicalAttempts, 1);
    assert.equal(second.applicability?.complete, true);
    assert.equal(second.applicability.dispositions[0]?.kind, "reused");
    assert.deepEqual(
      second.applicability.dispositions[0].origin,
      first.applicability.dispositions[0].origin
    );
    const ingress = await mkdtemp(
      path.join(tmpdir(), "banzai-verification-ingress-")
    );
    try {
      const requestFile = path.join(ingress, "request.json");
      await writeFile(
        requestFile,
        JSON.stringify({ ...request, roundId: randomUUID() }),
        { mode: 0o600 }
      );
      const response = await execute(
        process.execPath,
        [
          path.resolve("../../plugins/banzai/scripts/verification.cjs"),
          "inspect",
          "--json",
          requestFile
        ],
        { cwd: root }
      );
      const envelope: unknown = JSON.parse(response.stdout);
      const require = createRequire(import.meta.url);
      const toolRequire = createRequire(require.resolve("eslint/package.json"));
      const Ajv = toolRequire("ajv") as new (
        options: Record<string, unknown>
      ) => {
        compile(
          schema: unknown
        ): ((value: unknown) => boolean) & { errors?: unknown };
      };
      const schema = JSON.parse(
        await readFile(
          path.resolve(
            "../../plugins/banzai/contracts/verification/v1/result.schema.json"
          ),
          "utf8"
        )
      ) as Record<string, unknown>;
      delete schema.$schema;
      const validate = new Ajv({ allErrors: true }).compile(schema);
      assert.equal(validate(envelope), true, JSON.stringify(validate.errors));
      assert.equal(
        validate({
          ...(envelope as Record<string, unknown>),
          modelGranted: true
        }),
        false
      );
      assert.equal((envelope as { ok: boolean }).ok, true);
    } finally {
      await rm(ingress, { recursive: true, force: true });
    }
    const archiveRequest = path.join(root, "archive-request.json");
    const archiveCall = async (
      operation: string,
      fields: Record<string, unknown>
    ) => {
      await writeFile(
        archiveRequest,
        JSON.stringify({
          schema: "banzai-artifact-request/v2",
          schemaVersion: 2,
          repoRoot: root,
          ...fields
        })
      );
      const response = await artifactCommand([
        operation,
        "--json",
        archiveRequest
      ]);
      assert.equal(response.ok, true, JSON.stringify(response));
      return response.result as Record<string, unknown>;
    };
    const inventory = await archiveCall("inventory", { workPaths: [workPath] });
    (inventory.inventory as { retention: { pins: unknown[] } }).retention.pins =
      [
        {
          sourceId: "project",
          workId: created.binding.workId,
          reason: "Fixture verification origin retention",
          recordedAt: "2026-09-12T00:00:00.000Z"
        }
      ];
    const inventoryFile = path.join(
      root,
      "reviewed-verification-inventory.json"
    );
    await writeFile(inventoryFile, JSON.stringify(inventory.inventory));
    const bundlePath = path.join(root, "verification-archive");
    await archiveCall("export", { inventoryFile, destination: bundlePath });
    const archived = await archiveCall("verify", { bundlePath });
    assert.equal(archived.complete, true, JSON.stringify(archived));
    const restored = path.join(root, "verification-restored");
    await archiveCall("restore", { bundlePath, destination: restored });
    assert.ok(
      (archived.retainedPaths as string[]).some((entry) =>
        entry.endsWith(".finish.json")
      )
    );
    const claim = await acquireWork({
      repoRoot: root,
      workPath,
      ownerId: "fixture"
    });
    try {
      await assert.rejects(
        verificationOperation("execute", { ...request, checkId: "unit" }),
        code("ARTIFACT_OWNERSHIP_CONFLICT")
      );
      const input = path.join(root, "untrusted.txt");
      await writeFile(input, "{}\n");
      await assert.rejects(
        writeArtifact({
          repoRoot: root,
          workPath,
          token: claim.token,
          artifactPath: `${created.binding.artifacts.verificationDirectory}/forged.json`,
          inputFile: input,
          expectedSha256: null
        })
      );
      await rm(input);
    } finally {
      await releaseWork({ repoRoot: root, workPath, token: claim.token });
    }
    await assert.rejects(
      verificationOperation("execute", {
        ...request,
        checkId: "unit",
        command: "arbitrary"
      })
    );
    const current = await createWork({
      repoRoot: root,
      slug: "fresh-evidence",
      mode: "lite",
      creationId: randomUUID()
    });
    assert.equal(current.binding.schemaVersion, 2);
    assert.equal(
      (
        await verificationOperation("decide", {
          ...request,
          workPath: `.banzai/work/${current.binding.workId}/work.json`
        })
      ).supported,
      true
    );
  } finally {
    await repository.dispose();
  }
});

test("matched explanatory and added-test closures retain fresh obligations with bounded physical counts", async () => {
  const measurements = [];
  for (const scenario of ["two-sentences", "added-unit-test"] as const) {
    const observations = [];
    const timings = [];
    for (const equivalent of [false, true]) {
      const repository = await createTestRepository({
        artifactLayout: "private"
      });
      try {
        const root = await realpath(repository.root);
        const executable = await realpath(process.execPath);
        const bound = await createWork({
          repoRoot: root,
          slug: "measurement",
          mode: "lite",
          creationId: randomUUID(),
          schemaVersion: 2
        });
        const region = {
          start: "<!-- explanation:start -->",
          end: "<!-- explanation:end -->"
        };
        const explanatory = ["PROJECT_MANIFEST.md", "MODULES.md"].map(
          (file) => ({ path: file, regions: [region] })
        );
        for (const item of explanatory)
          await appendFile(
            path.join(root, item.path),
            `\n${region.start}\nOriginal explanatory sentence.\n${region.end}\n`
          );
        await writeFile(path.join(root, "contract.txt"), "verified\n");
        await writeFile(
          path.join(root, "unit.test.cjs"),
          "require('node:test')('base contract', () => require('node:assert/strict').equal(require('node:fs').readFileSync('contract.txt','utf8'),'verified\\n'));\n"
        );
        const commands = ["unit", "fresh-gate"].map((id) => ({
          id,
          name: id,
          command: executable,
          args:
            id === "unit"
              ? ["--test"]
              : [
                  "-e",
                  "require('node:assert/strict').equal(require('node:fs').readFileSync('contract.txt','utf8'),'verified\\n')"
                ],
          timeoutMs: 2000,
          evidence:
            id === "unit" && equivalent ? "equivalent_evidence" : "fresh",
          ignoreExplanatory: true
        }));
        await writeFile(
          path.join(root, ".banzai/config.json"),
          JSON.stringify({
            schemaVersion: 3,
            verification: {
              profiles: [{ id: "fixture", projectType: "custom", commands }],
              policy: {
                schema: "banzai-verification-policy/v1",
                schemaVersion: 1,
                explanatory,
                dependencies: {
                  complete: true,
                  exclude: [],
                  toolchain: [executable],
                  environment: { LANG: "C" },
                  volatile: []
                }
              }
            }
          })
        );
        const request = {
          schema: "banzai-verification-request/v1",
          schemaVersion: 1,
          repoRoot: root,
          workPath: `.banzai/work/${bound.binding.workId}/work.json`,
          roundId: randomUUID()
        };
        await execute("git", [
          "-C",
          root,
          "add",
          "PROJECT_MANIFEST.md",
          "MODULES.md"
        ]);
        for (const checkId of ["unit", "fresh-gate"])
          await verificationOperation("execute", { ...request, checkId });
        if (scenario === "two-sentences") {
          for (const item of explanatory) {
            const filename = path.join(root, item.path);
            await writeFile(
              filename,
              (await readFile(filename, "utf8")).replace(
                "Original explanatory sentence.",
                "Revised explanatory sentence."
              )
            );
          }
        } else
          await writeFile(
            path.join(root, "additional.test.cjs"),
            "require('node:test')('added fixture', () => {});\n"
          );
        request.roundId = randomUUID();
        const startedAt = performance.now();
        const selected = await verificationOperation("decide", request);
        let completed = selected;
        for (const action of requiredFixture(selected.decision).actions)
          completed = await verificationOperation("execute", {
            ...request,
            checkId: action.checkId
          });
        assert.equal(completed.applicability?.complete, true);
        const invoked = requiredFixture(selected.decision)
          .actions.filter((action) => action.action === "execute")
          .map((action) => action.checkId);
        assert.ok(invoked.includes("fresh-gate"));
        const physical = requiredFixture(completed.physicalAttempts) - 2;
        assert.equal(physical, invoked.length);
        observations.push({
          policy: equivalent ? "equivalent-enabled" : "fresh",
          physical,
          invoked
        });
        const attemptDirectory = path.join(
          root,
          requiredFixture(bound.binding.artifacts.verificationDirectory),
          "attempts"
        );
        const physicalRecords = await Promise.all(
          (await readdir(attemptDirectory))
            .sort()
            .map(
              async (file) =>
                JSON.parse(
                  await readFile(path.join(attemptDirectory, file), "utf8")
                ) as { durationMs: number; status: string }
            )
        );
        assert.ok(
          physicalRecords.every((record) => record.status === "completed")
        );
        timings.push({
          policy: equivalent ? "equivalent-enabled" : "fresh",
          seedPhysical: 2,
          seedCommandMs: physicalRecords
            .slice(0, 2)
            .reduce((sum, item) => sum + item.durationMs, 0),
          currentCommandMs: physicalRecords
            .slice(2)
            .reduce((sum, item) => sum + item.durationMs, 0),
          currentHelperWallMs: Math.round(performance.now() - startedAt)
        });
      } finally {
        await repository.dispose();
      }
    }
    assert.equal(requiredFixture(observations[0]).physical, 2);
    assert.equal(
      requiredFixture(observations[1]).physical,
      scenario === "two-sentences" ? 1 : 2
    );
    const authority = "Approved fixture authority and accepted finding ID.\n";
    const report =
      Array.from(
        { length: 60 },
        (_, i) => `Unaffected report evidence ${i + 1}.`
      ).join("\n") + "\n";
    const closure = `Accepted finding: ${scenario}.\nScope: bounded fixture delta.\nDecision: see direct physical origins and current applicability.\nEvidence: ${JSON.stringify(observations[1])}.\nLimitations: command fixture; no model or full-repository timing claim.\n`;
    measurements.push({
      scenario,
      observations,
      timings,
      reportAddedLines: closure.trimEnd().split("\n").length,
      reportRemovedLines: 0,
      reviewerFullBytes: Buffer.byteLength(authority + report + closure),
      reviewerClosureBytes: Buffer.byteLength(authority + closure)
    });
  }
  // Deterministic scheduling and payload measurements, not saved wall time.
  process.stdout.write(
    `Closure measurements: ${JSON.stringify(measurements)}\n`
  );
});

test("binding schemas accept helper outputs for every mode and retain closed roles", async () => {
  const repository = await createTestRepository({ artifactLayout: "private" });
  try {
    const require = createRequire(path.resolve("package.json"));
    const toolRequire = createRequire(require.resolve("eslint/package.json"));
    const Ajv = toolRequire("ajv") as new (
      options: Record<string, unknown>
    ) => {
      compile(
        schema: unknown
      ): ((value: unknown) => boolean) & { errors?: unknown };
    };
    const root = await realpath(repository.root);
    for (const schemaVersion of [2] as const) {
      const schema = JSON.parse(
        await readFile(
          path.resolve(
            `../../plugins/banzai/contracts/artifacts/v${schemaVersion}/work-binding.schema.json`
          ),
          "utf8"
        )
      ) as Record<string, unknown>;
      delete schema.$schema;
      const validate = new Ajv({ allErrors: true }).compile(schema);
      for (const mode of ["strict", "lite", "fix", "workflow"] as const) {
        const work = await createWork({
          repoRoot: root,
          creationId: randomUUID(),
          slug: `binding-${schemaVersion}-${mode}`,
          mode,
          schemaVersion
        });
        assert.equal(
          validate(work.binding),
          true,
          JSON.stringify(validate.errors)
        );
        const directory = `.banzai/work/${work.binding.workId}`;
        const original = await readFile(
          path.join(root, directory, "work.json")
        );
        assert.deepEqual(
          (await readBinding(root, directory)).binding,
          work.binding
        );
        const roles = Object.keys(work.binding.artifacts);
        for (const mutate of [
          (artifacts: Record<string, unknown>) => {
            Reflect.deleteProperty(artifacts, requiredFixture(roles.at(-1)));
          },
          (artifacts: Record<string, unknown>) => {
            artifacts.unknownRole = "extra.md";
          },
          (artifacts: Record<string, unknown>) => {
            artifacts.reviewDirectory = "../escape";
          }
        ]) {
          const invalid = structuredClone(work.binding);
          mutate(invalid.artifacts);
          assert.equal(validate(invalid), false);
          await writeFile(
            path.join(root, directory, "work.json"),
            JSON.stringify(invalid)
          );
          await assert.rejects(readBinding(root, directory));
          await writeFile(path.join(root, directory, "work.json"), original);
        }
      }
    }
  } finally {
    await repository.dispose();
  }
});

test("unavailable capture cannot reconcile a stale same-round fresh success", async () => {
  const repository = await createTestRepository({ artifactLayout: "private" });
  try {
    const root = await realpath(repository.root);
    const executable = await realpath(process.execPath);
    const work = await createWork({
      repoRoot: root,
      creationId: randomUUID(),
      slug: "unavailable-fresh",
      mode: "lite",
      schemaVersion: 2
    });
    const config = {
      schemaVersion: 3,
      verification: {
        profiles: [
          {
            id: "project",
            projectType: "custom",
            commands: [
              {
                id: "unit",
                name: "Unit",
                command: executable,
                args: [
                  "-e",
                  "process.exit(Number(require('node:fs').readFileSync('exit.txt','utf8')))"
                ],
                timeoutMs: 2000,
                evidence: "fresh",
                ignoreExplanatory: false
              }
            ]
          }
        ],
        policy: {
          schema: "banzai-verification-policy/v1",
          schemaVersion: 1,
          explanatory: [],
          dependencies: {
            complete: true,
            exclude: [],
            toolchain: [executable],
            environment: { LANG: "C" },
            volatile: [] as string[]
          }
        }
      }
    };
    const configPath = path.join(root, ".banzai/config.json");
    await writeFile(configPath, JSON.stringify(config));
    await writeFile(path.join(root, "exit.txt"), "0");
    const request = {
      schema: "banzai-verification-request/v1",
      schemaVersion: 1,
      repoRoot: root,
      workPath: `.banzai/work/${work.binding.workId}/work.json`,
      roundId: randomUUID()
    };
    const executeCheck = () =>
      verificationOperation("execute", { ...request, checkId: "unit" });
    const initial = await executeCheck();
    const reconciled = await executeCheck();
    assert.equal(initial.applicability?.complete, true);
    assert.equal(reconciled.physicalAttempts, 1);
    assert.deepEqual(reconciled.applicability, initial.applicability);
    config.verification.policy.dependencies.volatile = ["external"];
    await writeFile(configPath, JSON.stringify(config));
    request.roundId = randomUUID();
    const fresh = await executeCheck();
    assert.equal(fresh.physicalAttempts, 2);
    assert.equal(fresh.applicability?.complete, false);
    await writeFile(path.join(root, "exit.txt"), "17");
    const current = await verificationOperation("inspect", request);
    assert.equal(current.applicability?.complete, false);
    assert.equal(current.applicability.dispositions[0]?.kind, "pending");
    await assert.rejects(
      executeCheck(),
      /explicit failure retry or owner recovery/
    );
    request.roundId = randomUUID();
    const failed = await executeCheck();
    assert.equal(failed.physicalAttempts, 3);
    assert.equal(failed.applicability?.complete, false);
    const directory = path.join(
      root,
      requiredFixture(work.binding.artifacts.verificationDirectory),
      "attempts"
    );
    const records = await Promise.all(
      (await readdir(directory)).sort().map(
        async (name) =>
          JSON.parse(await readFile(path.join(directory, name), "utf8")) as {
            exitCode: number;
            status: string;
          }
      )
    );
    assert.deepEqual(
      records.map((record) => record.exitCode),
      [0, 0, 17]
    );
    assert.deepEqual(
      records.map((record) => record.status),
      ["completed", "completed", "failed"]
    );
  } finally {
    await repository.dispose();
  }
});

test("standalone physical failures, retries and missing origin proof never become reused success", async () => {
  const repository = await createTestRepository({ artifactLayout: "private" });
  try {
    const root = await realpath(repository.root);
    const executable = await realpath(process.execPath);
    const created = await createWork({
      repoRoot: root,
      slug: "failure-proof",
      mode: "lite",
      creationId: randomUUID(),
      schemaVersion: 2
    });
    const directory = requiredFixture(
      created.binding.artifacts.verificationDirectory
    );
    const configPath = path.join(root, ".banzai/config.json");
    const config = {
      schemaVersion: 3,
      verification: {
        profiles: [
          {
            id: "project",
            projectType: "custom",
            commands: [
              {
                id: "unit",
                name: "Unit",
                command: executable,
                args: [
                  "-e",
                  "process.exit(Number(require('node:fs').readFileSync('exit.txt','utf8')))"
                ],
                timeoutMs: 2000,
                evidence: "equivalent_evidence",
                ignoreExplanatory: true
              }
            ]
          }
        ],
        policy: {
          schema: "banzai-verification-policy/v1",
          schemaVersion: 1,
          explanatory: [],
          dependencies: {
            complete: true,
            exclude: [],
            toolchain: [executable],
            environment: { LANG: "C" },
            volatile: []
          }
        }
      }
    };
    await writeFile(configPath, JSON.stringify(config));
    await writeFile(path.join(root, "exit.txt"), "0");
    const request = {
      schema: "banzai-verification-request/v1",
      schemaVersion: 1,
      repoRoot: root,
      workPath: `.banzai/work/${created.binding.workId}/work.json`,
      roundId: randomUUID(),
      checkId: "unit"
    };
    const initial = await verificationOperation("execute", request);
    assert.equal(initial.applicability?.complete, true);
    await writeFile(path.join(root, "exit.txt"), "1");
    request.roundId = randomUUID();
    const failed = await verificationOperation("execute", request);
    assert.equal(failed.applicability?.complete, false);
    await assert.rejects(
      verificationOperation("execute", request),
      /explicit failure retry/
    );
    await writeFile(path.join(root, "exit.txt"), "0");
    const records = await readdir(path.join(root, directory, "attempts"));
    const physical = JSON.parse(
      await readFile(
        path.join(
          root,
          directory,
          "attempts",
          requiredFixture(records.sort().at(-1))
        ),
        "utf8"
      )
    ) as { id: string };
    const inspection = {
      schema: request.schema,
      schemaVersion: request.schemaVersion,
      repoRoot: root,
      workPath: request.workPath,
      roundId: request.roundId
    };
    const pending = await verificationOperation("decide", {
      ...inspection,
      roundId: randomUUID()
    });
    assert.equal(pending.decision?.actions[0]?.reason, "later_attempt");
    const retried = await verificationOperation("execute", {
      ...request,
      retryOf: physical.id
    });
    assert.equal(retried.physicalAttempts, 3);
    assert.equal(retried.applicability?.complete, true);
    const origin = requiredFixture(
      requiredFixture(retried.applicability).dispositions[0]?.origin
    );
    const finishPath = path.join(
      root,
      directory,
      "origins",
      `${origin.attemptId}.finish.json`
    );
    const finish = await readFile(finishPath);
    await rm(finishPath);
    const missing = await verificationOperation("decide", inspection);
    assert.equal(missing.applicability?.complete, false);
    assert.equal(missing.decision?.actions[0]?.reason, "origin_invalid");
    await writeFile(finishPath, finish);
    const logPath = path.join(
      root,
      directory,
      `${origin.attemptId}.stdout.log`
    );
    await writeFile(logPath, "tampered physical output");
    assert.equal(
      (
        await verificationOperation("decide", {
          ...inspection,
          roundId: randomUUID()
        })
      ).decision?.actions[0]?.action,
      "execute"
    );
  } finally {
    await repository.dispose();
  }
});
