import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";
const { build } = createRequire(import.meta.url)(
  "esbuild"
) as typeof import("esbuild");
import { withProjectSetupOwnership } from "../src/project-setup.js";
import { RunStore } from "../src/store.js";
import { createTestRepository, snapshotTree } from "./helpers.js";

test("setup ownership releases only its lock on success and failure, without run initialization", async () => {
  const repository = await createTestRepository();
  try {
    const before = await snapshotTree(path.join(repository.root, ".banzai"));
    for (const failure of [false, true]) {
      const operation = withProjectSetupOwnership(
        repository.root,
        async () => {
          const lock = JSON.parse(
            await readFile(
              path.join(repository.root, ".banzai/runner.lock"),
              "utf8"
            )
          ) as { schemaVersion: number; pid: number };
          assert.equal(lock.schemaVersion, 1);
          assert.equal(lock.pid, process.pid);
          if (failure) throw new Error("spawn failed");
          return "closed";
        },
        {}
      );
      if (failure) await assert.rejects(operation, /spawn failed/);
      else assert.equal(await operation, "closed");
      assert.deepEqual(
        await snapshotTree(path.join(repository.root, ".banzai")),
        before
      );
    }
    await assert.rejects(
      withProjectSetupOwnership(
        repository.root,
        async () => assert.fail("nested launch"),
        { BANZAI_RUN_ID: "parent" }
      ),
      { code: "PROJECT_SETUP_NESTED" }
    );
    assert.deepEqual(
      await snapshotTree(path.join(repository.root, ".banzai")),
      before
    );
  } finally {
    await repository.dispose();
  }
});

test("setup ownership never reclaims stale or malformed locks or deletes replacement ownership", async () => {
  const repository = await createTestRepository();
  try {
    const lockPath = path.join(repository.root, ".banzai/runner.lock");
    for (const contents of [
      "{malformed",
      JSON.stringify({
        schemaVersion: 1,
        pid: 2147483647,
        token: "stale",
        createdAt: "2000-01-01"
      })
    ]) {
      await writeFile(lockPath, contents);
      await assert.rejects(
        withProjectSetupOwnership(
          repository.root,
          async () => assert.fail("launched"),
          {}
        ),
        { code: "RUNNER_LOCKED" }
      );
      assert.equal(await readFile(lockPath, "utf8"), contents);
      await rm(lockPath);
    }
    const replacement = JSON.stringify({
      schemaVersion: 1,
      pid: process.pid,
      token: "other",
      createdAt: new Date().toISOString()
    });
    await withProjectSetupOwnership(
      repository.root,
      async () => {
        await rm(lockPath);
        await writeFile(lockPath, replacement);
      },
      {}
    );
    assert.equal(await readFile(lockPath, "utf8"), replacement);
  } finally {
    await repository.dispose();
  }
});

test("setup and workflow share cross-process exclusive ownership", async () => {
  const repository = await createTestRepository();
  const temporary = await mkdtemp(path.join(tmpdir(), "banzai-setup-worker-"));
  try {
    const worker = path.join(temporary, "worker.mjs");
    await build({
      stdin: {
        contents: `import { withProjectSetupOwnership } from './src/project-setup.ts';
        await withProjectSetupOwnership(process.argv[2], async () => {
          process.stdout.write('OWNED\\n');
          await new Promise(resolve => process.stdin.once('data', resolve));
        }, {});`,
        resolveDir: process.cwd(),
        loader: "ts"
      },
      bundle: true,
      platform: "node",
      format: "esm",
      outfile: worker,
      logLevel: "silent"
    });
    const child = spawn(process.execPath, [worker, repository.root], {
      stdio: ["pipe", "pipe", "pipe"]
    });
    try {
      const exit = once(child, "exit");
      const [output] = (await once(child.stdout, "data")) as [Buffer];
      assert.match(String(output), /OWNED/);
      await assert.rejects(
        withProjectSetupOwnership(
          repository.root,
          async () => assert.fail("second setup launched"),
          {}
        ),
        { code: "RUNNER_LOCKED" }
      );
      await assert.rejects(new RunStore(repository.root).acquireLock(), {
        code: "RUNNER_LOCKED"
      });
      child.stdin.end("close\n");
      assert.equal((await exit)[0], 0);
      const workflow = await new RunStore(repository.root).acquireLock();
      try {
        await assert.rejects(
          withProjectSetupOwnership(
            repository.root,
            async () => assert.fail("setup bypassed workflow"),
            {}
          ),
          { code: "RUNNER_LOCKED" }
        );
      } finally {
        await workflow.release();
      }
    } finally {
      child.kill();
    }
  } finally {
    await repository.dispose();
    await rm(temporary, { recursive: true, force: true });
  }
});
