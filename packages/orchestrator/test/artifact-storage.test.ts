import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFile, spawnSync } from "node:child_process";
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
          schema: "banzai-artifact-request/v1",
          schemaVersion: 1,
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

test("artifact storage legacy and recovery classifications never silently migrate work", async () => {
  const repository = await createTestRepository({ artifactLayout: null });
  try {
    const root = await realpath(repository.root);
    await mkdir(path.join(root, "documentation/features/old"), {
      recursive: true
    });
    await writeFile(
      path.join(root, "documentation/features/old/work.md"),
      "# Feature: Old\n\nSlug: `old`\n"
    );
    assert.equal((await inspectArtifacts({ repoRoot: root })).layout, "legacy");
    await assert.rejects(
      initializeArtifacts({ repoRoot: root, layout: "private" }),
      code("ARTIFACT_RECOVERY_REQUIRED")
    );
    const work = await createWork({
      repoRoot: root,
      slug: "new",
      mode: "lite",
      creationId: randomUUID()
    });
    assert.equal(
      work.binding.artifacts.work,
      "documentation/features/new/work.md"
    );
    await assert.rejects(
      createWork({
        repoRoot: root,
        slug: "new",
        mode: "lite",
        creationId: randomUUID()
      }),
      code("ARTIFACT_WORK_AMBIGUOUS")
    );
    const declarationPath = path.join(root, ".banzai/artifacts.json");
    const declaration = JSON.parse(
      await readFile(declarationPath, "utf8")
    ) as Record<string, unknown>;
    await writeFile(
      declarationPath,
      JSON.stringify({ ...declaration, layout: "private" })
    );
    assert.deepEqual(
      (await inspectArtifacts({ repoRoot: root, workId: work.binding.workId }))
        .work,
      work
    );
    await rm(declarationPath);
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
      schema: "banzai-artifact-request/v1",
      schemaVersion: 1,
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
          schema: "banzai-artifact-request/v1",
          schemaVersion: 1,
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
      schema: "banzai-artifact-request/v1",
      schemaVersion: 1,
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

test("accepted F3 serializes separate-process legacy slug ownership and idempotent retries", async () => {
  const repository = await createTestRepository({ artifactLayout: "legacy" });
  try {
    const root = await realpath(repository.root);
    const requests = await Promise.all(
      Array.from({ length: 8 }, async () => {
        const creationId = randomUUID();
        const filename = path.join(root, `${creationId}.json`);
        const input = {
          schema: "banzai-artifact-request/v1",
          schemaVersion: 1,
          repoRoot: root,
          creationId,
          slug: "concurrent-legacy",
          mode: "lite" as const
        };
        await writeFile(filename, JSON.stringify(input));
        return { filename, input };
      })
    );
    const results = await Promise.all(
      requests.map(async (request) => {
        try {
          return JSON.parse(
            (
              await execute(process.execPath, [
                commandPath,
                "create",
                "--json",
                request.filename
              ])
            ).stdout
          ) as { ok: boolean };
        } catch (error) {
          return JSON.parse((error as { stdout: string }).stdout) as {
            ok: boolean;
          };
        }
      })
    );
    assert.equal(results.filter((result) => result.ok).length, 1);
    const winner = requests[results.findIndex((result) => result.ok)];
    assert.ok(winner);
    assert.equal(
      (await createWork(winner.input)).binding.workId,
      winner.input.creationId
    );
    assert.equal(
      (
        await createWork({
          ...winner.input,
          creationId: randomUUID(),
          slug: "independent"
        })
      ).binding.slug,
      "independent"
    );
  } finally {
    await repository.dispose();
  }
});

for (const mode of ["strict", "lite", "fix"] as const) {
  test(`accepted F4 continues original ${mode} standalone work with immutable explicit identity`, async () => {
    const repository = await createTestRepository({ artifactLayout: null });
    try {
      const root = await realpath(repository.root);
      const relative =
        mode === "fix"
          ? "documentation/changes/old.md"
          : `documentation/features/old/${mode === "lite" ? "work" : "description"}.md`;
      await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
      const original =
        mode === "fix"
          ? "# Change Report: Old\nOriginal decision.\n"
          : "# Feature: Old\n\nSlug: `old`\nOriginal approved bytes.\n";
      await writeFile(path.join(root, relative), original);
      const before = await inspectArtifacts({
        repoRoot: root,
        workPath: relative
      });
      assert.equal(before.layout, "legacy");
      assert.equal(before.legacySelection?.mode, mode);
      await initializeArtifacts({ repoRoot: root });
      const selected = (
        await inspectArtifacts({ repoRoot: root, workPath: relative })
      ).legacySelection;
      assert.deepEqual(selected, before.legacySelection);
      assert.ok(selected);
      await assert.rejects(
        createWork({
          repoRoot: root,
          slug: "old",
          mode,
          creationId: randomUUID()
        }),
        code("ARTIFACT_WORK_AMBIGUOUS")
      );
      // Original work remains legacy even after the owner's default changes.
      await writeFile(
        path.join(root, ".banzai/artifacts.json"),
        JSON.stringify({
          schema: "banzai-artifact-layout/v1",
          schemaVersion: 1,
          layout: "private"
        })
      );
      await writeFile(
        path.join(root, relative),
        original + "changed after selection\n"
      );
      await assert.rejects(
        createWork({
          repoRoot: root,
          slug: selected.slug,
          mode,
          creationId: selected.creationId
        }),
        code("ARTIFACT_WORK_AMBIGUOUS")
      );
      await assert.rejects(
        readFile(
          path.join(root, `.banzai/work/${selected.creationId}/work.json`)
        ),
        { code: "ENOENT" }
      );
      await writeFile(path.join(root, relative), original);
      const bound = await createWork({
        repoRoot: root,
        slug: selected.slug,
        mode,
        creationId: selected.creationId
      });
      assert.deepEqual(bound.binding.artifacts, selected.artifacts);
      assert.equal(await readFile(path.join(root, relative), "utf8"), original);
      const workPath = `.banzai/work/${bound.binding.workId}/work.json`;
      const handedOff = await artifactRequest(root, "inspect", { workPath });
      assert.equal(handedOff.ok, true);
      const handoffFile = path.join(root, "handoff.json");
      await writeFile(
        handoffFile,
        JSON.stringify({
          schema: "banzai-artifact-request/v1",
          schemaVersion: 1,
          repoRoot: root,
          workPath
        })
      );
      const fresh = JSON.parse(
        (
          await execute(process.execPath, [
            commandPath,
            "inspect",
            "--json",
            handoffFile
          ])
        ).stdout
      ) as { result: { work: { binding: { workId: string } } } };
      assert.equal(fresh.result.work.binding.workId, bound.binding.workId);
      assert.equal(
        (await inspectArtifacts({ repoRoot: root, workPath: relative })).work
          ?.binding.workId,
        bound.binding.workId
      );
      const claim = await acquireWork({
        repoRoot: root,
        workPath,
        ownerId: "next-session"
      });
      await releaseWork({ repoRoot: root, workPath, token: claim.token });
      assert.equal(await readFile(path.join(root, relative), "utf8"), original);
    } finally {
      await repository.dispose();
    }
  });
}

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
            schemaVersion: 4,
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
        schema: "banzai-artifact-request/v1",
        schemaVersion: 1,
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
          schema: "banzai-artifact-request/v1",
          schemaVersion: 1,
          repoRoot: root,
          ...fields
        };
        const contract = JSON.parse(
          await readFile(
            path.resolve(
              `../../plugins/banzai/contracts/artifacts/v1/${operation}-request.schema.json`
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
