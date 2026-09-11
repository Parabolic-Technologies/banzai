// Run only against the preserved pre-ADR-0033 writer, before policy migration.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const modulePath = path.resolve(process.argv[2]);
const policyPath = path.resolve(process.argv[3]);
const output = path.dirname(fileURLToPath(import.meta.url));
const moduleUrl = pathToFileURL(modulePath).href;
const { VERSION_SURFACES } = await import(moduleUrl);
assert.equal(VERSION_SURFACES.length, 6, "capture requires the legacy writer");
const sourceSha256 = createHash("sha256")
  .update(await readFile(modulePath))
  .digest("hex");

async function snapshot(root, relative = "") {
  const entries = [];
  for (const name of (await readdir(path.join(root, relative))).sort()) {
    const entry = path.posix.join(relative, name);
    const target = path.join(root, entry);
    const info = await stat(target);
    if (info.isDirectory()) entries.push(...(await snapshot(root, entry)));
    else
      entries.push({
        path: entry,
        mode: info.mode & 0o777,
        contents: (await readFile(target)).toString("base64")
      });
  }
  return entries;
}

for (const scenario of ["initial", "forward"]) {
  for (const phase of ["ready", "guard"]) {
    const parent = await mkdtemp(path.join(tmpdir(), "banzai-v1-capture-"));
    try {
      const requestedRoot = path.join(parent, "repository");
      await mkdir(requestedRoot);
      const root = await realpath(requestedRoot);
      await writeFile(
        path.join(root, "release-policy.json"),
        await readFile(policyPath)
      );
      for (const [index, surface] of VERSION_SURFACES.entries()) {
        const version =
          scenario === "initial" ? (index < 4 ? "1.18.1" : "0.8.2") : "1.19.0";
        const value =
          surface.pointer === "/version"
            ? { version }
            : surface.pointer === "/plugins/0/version"
              ? { plugins: [{ version }] }
              : { packages: { "packages/orchestrator": { version } } };
        const target = path.join(root, surface.path);
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, JSON.stringify(value, null, 2) + "\n");
        await chmod(target, 0o644);
      }
      const originals = (await snapshot(root)).filter(
        (entry) => entry.path !== "release-policy.json"
      );
      const targetVersion = scenario === "initial" ? "1.19.0" : "1.19.1";
      const child = `
import { createNodeVersionFileSystem, setProjectVersion } from ${JSON.stringify(moduleUrl)};
const root = ${JSON.stringify(root)};
const base = createNodeVersionFileSystem();
const first = root + ${JSON.stringify("/" + VERSION_SURFACES[0].path)};
const fileSystem = {
  ...base,
  async move(from, to) {
    await base.move(from, to);
    if (${JSON.stringify(phase)} === "ready" && to === first) process.kill(process.pid, "SIGKILL");
  },
  async remove(target, options) {
    await base.remove(target, options);
    if (${JSON.stringify(phase)} === "guard" && target === root + "/.banzai-version-set" && options?.recursive) process.kill(process.pid, "SIGKILL");
  }
};
await setProjectVersion({ root, targetVersion: ${JSON.stringify(targetVersion)}, ownerPid: 424242, fileSystem });
`;
      const helper = path.join(parent, "capture.mjs");
      await writeFile(helper, child);
      const result = spawnSync(process.execPath, [helper], {
        encoding: "utf8",
        timeout: 10000
      });
      assert.equal(result.signal, "SIGKILL", result.stderr);
      const retained = (await snapshot(root)).filter(
        (entry) => entry.path !== "release-policy.json"
      );
      const recordPath =
        phase === "ready"
          ? ".banzai-version-set/transaction.json"
          : ".banzai-version-set.guard";
      const record = JSON.parse(
        Buffer.from(
          retained.find((entry) => entry.path === recordPath).contents,
          "base64"
        ).toString()
      );
      assert.equal(record.format, 1);
      const fixture = {
        sourceSha256,
        scenario,
        phase,
        targetVersion,
        ownerPid: 424242,
        originals,
        retained
      };
      await writeFile(
        path.join(output, `${scenario}-${phase}.json`),
        JSON.stringify(fixture, null, 2) + "\n"
      );
      process.stdout.write(
        `Captured ${scenario}-${phase}: ${originals.length} originals, ${retained.length} retained files\n`
      );
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  }
}
