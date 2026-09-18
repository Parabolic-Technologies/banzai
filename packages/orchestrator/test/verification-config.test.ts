import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  initializeConfig,
  CONFIG_FILE,
  DEFAULT_CONFIG
} from "../src/config.js";
import { RunStore } from "../src/store.js";
import {
  applyVerificationConfigDelta,
  previewVerificationConfig,
  publishVerificationConfig,
  readVerificationConfig,
  readVerificationConfigTransactions
} from "../src/verification-config.js";

test("confirmed inactive saves require ownership, pin bytes/source, and retain an exact reversible delta", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "banzai-guided-config-"));
  try {
    await initializeConfig(root);
    await writeFile(
      path.join(root, CONFIG_FILE),
      JSON.stringify(DEFAULT_CONFIG)
    );
    const store = new RunStore(root);
    const before = await readVerificationConfig(root);
    const bootstrap = await previewVerificationConfig(root, {
      operation: "bootstrap",
      value: true
    });
    await assert.rejects(
      publishVerificationConfig(store, bootstrap, "operator"),
      { code: "RUNNER_LOCKED" }
    );
    const lock = await store.acquireLock({ reclaimStale: false });
    try {
      await assert.rejects(
        new RunStore(root).acquireLock({ reclaimStale: false }),
        { code: "RUNNER_LOCKED" }
      );
      assert.equal(
        await publishVerificationConfig(store, bootstrap, "operator"),
        null
      );
      const after = await readVerificationConfig(root);
      assert.equal(after.config.verification.bootstrap, true);
      assert.equal(
        applyVerificationConfigDelta(after.raw, bootstrap.delta, true),
        before.raw
      );
      await assert.rejects(
        publishVerificationConfig(store, bootstrap, "operator"),
        { code: "CONFIGURATION_PROPOSAL_STALE" }
      );
      const profile = {
        id: "node",
        projectType: "node" as const,
        commands: [
          {
            name: "tests",
            command: "npm",
            args: ["run", "test"],
            timeoutMs: 1000
          }
        ]
      };
      await writeFile(
        path.join(root, "package.json"),
        '{"scripts":{"test":"exit 99"}}'
      );
      const addition = await previewVerificationConfig(root, {
        operation: "add",
        profile,
        clearBootstrap: true
      });
      await writeFile(
        path.join(root, "package.json"),
        '{"scripts":{"test":"exit 0"}}'
      );
      await assert.rejects(
        publishVerificationConfig(store, addition, "operator"),
        { code: "CONFIGURATION_PROPOSAL_STALE" }
      );
      assert.equal((await readVerificationConfig(root)).raw, after.raw);
      const refreshed = await previewVerificationConfig(root, {
        operation: "add",
        profile,
        clearBootstrap: true
      });
      await publishVerificationConfig(store, refreshed, "operator");
      const configured = await readVerificationConfig(root);
      assert.equal(configured.config.verification.bootstrap, undefined);
      assert.equal(configured.config.verification.profiles.length, 2);
      assert.equal(
        applyVerificationConfigDelta(configured.raw, refreshed.delta, true),
        after.raw
      );
      assert.equal(
        (await readdir(path.join(root, ".banzai"))).some(
          (entry) => entry.endsWith(".tmp") || entry === "runs"
        ),
        false
      );
    } finally {
      await lock.release();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("unsafe config targets and unavailable selected-run identity evidence refuse mutation", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "banzai-guided-unsafe-"));
  try {
    await initializeConfig(root);
    await writeFile(
      path.join(root, CONFIG_FILE),
      JSON.stringify(DEFAULT_CONFIG)
    );
    const original = await readFile(path.join(root, CONFIG_FILE));
    await writeFile(path.join(root, "unrelated.json"), original);
    await rm(path.join(root, CONFIG_FILE));
    await symlink("../unrelated.json", path.join(root, CONFIG_FILE));
    await assert.rejects(
      previewVerificationConfig(root, { operation: "bootstrap", value: true })
    );
    assert.deepEqual(
      await readFile(path.join(root, "unrelated.json")),
      original
    );
    // Inactive callers need no history. A requested unsafe run identity never
    // becomes an empty set of historical IDs.
    await assert.rejects(
      readVerificationConfigTransactions(root, "../unrelated"),
      { code: "CONFIGURATION_TRANSACTION_INVALID" }
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
