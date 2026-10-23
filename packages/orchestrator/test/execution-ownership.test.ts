import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { renameSync, writeFileSync } from "node:fs";
import {
  mkdir,
  readFile,
  readdir,
  symlink,
  unlink,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  executionKey,
  withExecutionOwnership,
  withRunnerWorkOwnership
} from "../../../plugins/banzai/lib/execution-ownership.mjs";
import { createExecutionBinding } from "../../../plugins/banzai/lib/work-documents.mjs";
import { RunStore } from "../src/store.js";
import { createTestRepository } from "./helpers.js";

async function recoveryFixture() {
  const repository = await createTestRepository();
  const bound = await createExecutionBinding({
    repoRoot: repository.root,
    slug: "recovery",
    mode: "strict",
    runId: "recovery-test"
  });
  const lock = await new RunStore(repository.root).acquireLock();
  const directory = bound.binding.artifacts.reviewDirectory;
  const claimDirectory = path.join(
    repository.root,
    ".banzai/execution-locks",
    executionKey(directory)
  );
  await mkdir(claimDirectory, { recursive: true });
  const child = spawn(process.execPath, ["-e", "process.exit(0)"], {
    stdio: "ignore"
  });
  await once(child, "exit");
  assert.ok(child.pid);
  const claim = {
    token: randomUUID(),
    directory,
    identity: bound.sha256,
    pid: child.pid
  };
  const claimPath = path.join(claimDirectory, "claim.json");
  const retainedPath = path.join(
    claimDirectory,
    `recovered-${claim.token}.json`
  );
  const bytes = `${JSON.stringify(claim)}\n`;
  await writeFile(claimPath, bytes);
  return {
    repository,
    bound,
    lock,
    claim,
    claimDirectory,
    claimPath,
    retainedPath,
    bytes,
    recover: (action: () => Promise<void> = async () => {}) =>
      withRunnerWorkOwnership(repository.root, bound, action, {
        recoverStale: true
      }),
    dispose: async () => {
      await lock.release();
      await repository.dispose();
    }
  };
}

test("ordinary execution cannot reclaim a dead claim and recovery requires repository ownership", async () => {
  const f = await recoveryFixture();
  try {
    await assert.rejects(
      withExecutionOwnership(
        f.repository.root,
        f.claim.directory,
        async () => {}
      ),
      { code: "ARTIFACT_OWNERSHIP_CONFLICT" }
    );
    await assert.rejects(
      withRunnerWorkOwnership(f.repository.root, f.bound, async () => {}),
      { code: "ARTIFACT_OWNERSHIP_CONFLICT" }
    );
    await f.lock.release();
    await assert.rejects(f.recover());
    assert.equal(await readFile(f.claimPath, "utf8"), f.bytes);
    assert.deepEqual(await readdir(f.claimDirectory), ["claim.json"]);
  } finally {
    await f.dispose();
  }
});

test("recovery survives an interruption after retaining a claim and keeps exclusive ownership", async () => {
  const f = await recoveryFixture();
  try {
    await writeFile(f.retainedPath, f.bytes);
    await assert.rejects(
      f.recover(async () => {
        const replacement = JSON.parse(await readFile(f.claimPath, "utf8")) as {
          pid: number;
          token: string;
        };
        assert.equal(replacement.pid, process.pid);
        assert.notEqual(replacement.token, f.claim.token);
        await assert.rejects(
          withExecutionOwnership(
            f.repository.root,
            f.claim.directory,
            async () => {}
          ),
          { code: "ARTIFACT_OWNERSHIP_CONFLICT" }
        );
        await f.recover();
        throw new Error("recovered action failed");
      }),
      /recovered action failed/u
    );
    assert.equal(await readFile(f.retainedPath, "utf8"), f.bytes);
    await assert.rejects(readFile(f.claimPath), { code: "ENOENT" });
    await f.recover();
    await assert.rejects(readFile(f.claimPath), { code: "ENOENT" });
  } finally {
    await f.dispose();
  }
});

test("recovery refuses malformed or foreign execution identities without changing evidence", async (t) => {
  const f = await recoveryFixture();
  try {
    const cases: Record<string, unknown> = {
      "invalid JSON": "{",
      "null claim": null,
      "foreign directory": {
        ...f.claim,
        directory: "documentation/work/other"
      },
      "foreign binding": { ...f.claim, identity: "0".repeat(64) },
      "standalone owner": { ...f.claim, identity: null },
      "unsupported shape": { ...f.claim, schemaVersion: 2 },
      "unsafe token": { ...f.claim, token: "../other" },
      "zero PID": { ...f.claim, pid: 0 },
      "process group PID": { ...f.claim, pid: -1 },
      "string PID": { ...f.claim, pid: String(f.claim.pid) },
      "fractional PID": { ...f.claim, pid: 1.5 },
      "out of range PID": { ...f.claim, pid: 2147483648 }
    };
    for (const [name, value] of Object.entries(cases))
      await t.test(name, async () => {
        const bytes = typeof value === "string" ? value : JSON.stringify(value);
        await writeFile(f.claimPath, bytes);
        await assert.rejects(f.recover(), {
          code: "ARTIFACT_OWNERSHIP_CONFLICT"
        });
        assert.equal(await readFile(f.claimPath, "utf8"), bytes);
        assert.deepEqual(await readdir(f.claimDirectory), ["claim.json"]);
      });
  } finally {
    await f.dispose();
  }
});

test("recovery retains live or reused PIDs and treats every probe error except ESRCH as uncertain", async (t) => {
  const f = await recoveryFixture();
  try {
    const liveBytes = JSON.stringify({ ...f.claim, pid: process.pid });
    await writeFile(f.claimPath, liveBytes);
    await assert.rejects(f.recover(), /still active/u);
    assert.equal(await readFile(f.claimPath, "utf8"), liveBytes);
    await writeFile(f.claimPath, f.bytes);
    for (const code of ["EPERM", "EACCES", "EINVAL"])
      await t.test(code, async (probe) => {
        probe.mock.method(process, "kill", () => {
          throw Object.assign(new Error("liveness unavailable"), { code });
        });
        await assert.rejects(f.recover(), /liveness could not be confirmed/u);
        assert.equal(await readFile(f.claimPath, "utf8"), f.bytes);
        assert.deepEqual(await readdir(f.claimDirectory), ["claim.json"]);
      });
    await t.test("PID becomes live before removal", async (probe) => {
      let checks = 0;
      probe.mock.method(process, "kill", () => {
        if (++checks === 1)
          throw Object.assign(new Error("gone"), { code: "ESRCH" });
        return true;
      });
      await assert.rejects(f.recover(), /still active/u);
      assert.equal(await readFile(f.claimPath, "utf8"), f.bytes);
      assert.equal(await readFile(f.retainedPath, "utf8"), f.bytes);
    });
  } finally {
    await f.dispose();
  }
});

test("recovery retains a claim changed or replaced while preserving its original bytes", async (t) => {
  for (const replacement of ["changed bytes", "new inode"])
    await t.test(replacement, async (probe) => {
      const f = await recoveryFixture();
      try {
        const replacementBytes =
          replacement === "changed bytes"
            ? JSON.stringify({
                ...f.claim,
                token: randomUUID(),
                pid: process.pid
              })
            : f.bytes;
        let checks = 0;
        probe.mock.method(process, "kill", () => {
          if (++checks === 2) {
            const temporary = `${f.claimPath}.replacement`;
            writeFileSync(temporary, replacementBytes);
            renameSync(temporary, f.claimPath);
          }
          throw Object.assign(new Error("gone"), { code: "ESRCH" });
        });
        await assert.rejects(f.recover(), /claim changed during recovery/u);
        assert.equal(await readFile(f.claimPath, "utf8"), replacementBytes);
        assert.equal(await readFile(f.retainedPath, "utf8"), f.bytes);
      } finally {
        probe.mock.restoreAll();
        await f.dispose();
      }
    });
});

test("recovery refuses conflicting retained evidence and Git-visible backup destinations", async (t) => {
  for (const obstacle of ["conflicting backup", "Git-visible backup"])
    await t.test(obstacle, async () => {
      const f = await recoveryFixture();
      try {
        if (obstacle === "conflicting backup") {
          await writeFile(f.retainedPath, "different retained evidence\n");
        } else {
          const ignorePath = path.join(f.repository.root, ".gitignore");
          const directory = path.relative(f.repository.root, f.claimDirectory);
          await writeFile(
            ignorePath,
            (await readFile(ignorePath, "utf8")).replace(
              ".banzai/execution-locks/\n",
              `.banzai/execution-locks/*\n!${directory}/\n${directory}/*\n!${directory}/${path.basename(f.retainedPath)}\n`
            )
          );
        }
        await assert.rejects(f.recover());
        assert.equal(await readFile(f.claimPath, "utf8"), f.bytes);
        if (obstacle === "conflicting backup")
          assert.equal(
            await readFile(f.retainedPath, "utf8"),
            "different retained evidence\n"
          );
        else await assert.rejects(readFile(f.retainedPath), { code: "ENOENT" });
      } finally {
        await f.dispose();
      }
    });
});

test("recovery never follows an active or retained claim symlink", async (t) => {
  for (const destination of ["active", "retained"])
    await t.test(destination, async () => {
      const f = await recoveryFixture();
      try {
        const target = path.join(f.repository.root, "outside-claim.json");
        await writeFile(target, f.bytes);
        if (destination === "active") await unlink(f.claimPath);
        await symlink(
          target,
          destination === "active" ? f.claimPath : f.retainedPath
        );
        await assert.rejects(f.recover(), { code: "ARTIFACT_UNSAFE_PATH" });
        assert.equal(await readFile(target, "utf8"), f.bytes);
        assert.equal(await readFile(f.claimPath, "utf8"), f.bytes);
      } finally {
        await f.dispose();
      }
    });
});
