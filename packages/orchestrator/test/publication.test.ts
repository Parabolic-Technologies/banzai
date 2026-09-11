import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { createTestRepository } from "./helpers.js";

const execute = promisify(execFile);
const script = path.resolve("scripts/publication-check.mjs");
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");

test("publication guard inspects staged bytes and exact historical exceptions", async () => {
  const repository = await createTestRepository();
  try {
    const root = repository.root;
    const publicDoc = "PUBLIC.md";
    const internalDoc = "HISTORY.md";
    await writeFile(path.join(root, publicDoc), "# Public\n");
    await writeFile(path.join(root, internalDoc), "# Old history\n");
    const inventory = {
      schema: "banzai-publication-inventory/v1",
      schemaVersion: 1,
      mode: "transition",
      entries: [
        ...["PROJECT_MANIFEST.md", "AGENTS.md", "CLAUDE.md", publicDoc].map(
          (file) => ({ path: file, classification: "maintainer", sha256: null })
        ),
        {
          path: internalDoc,
          classification: "historical-exposure",
          sha256: digest("# Old history\n")
        }
      ]
    };
    await writeFile(
      path.join(root, "publication-policy.json"),
      JSON.stringify(inventory)
    );
    await execute("git", [
      "-C",
      root,
      "add",
      "--",
      publicDoc,
      internalDoc,
      "publication-policy.json"
    ]);
    const run = () =>
      execute(process.execPath, [script, "--root", root, "--tree", "staged"]);
    assert.equal(
      (JSON.parse((await run()).stdout) as { historicalExposure: number })
        .historicalExposure,
      1
    );
    await writeFile(path.join(root, internalDoc), "# New private details\n");
    assert.equal(
      (JSON.parse((await run()).stdout) as { historicalExposure: number })
        .historicalExposure,
      1,
      "unstaged bytes cannot substitute for indexed bytes"
    );
    await execute("git", ["-C", root, "add", "--", internalDoc]);
    await assert.rejects(run(), /PUBLICATION_HISTORICAL_EXPOSURE/u);
    await writeFile(path.join(root, internalDoc), "# Old history\n");
    inventory.mode = "clean";
    await writeFile(
      path.join(root, "publication-policy.json"),
      JSON.stringify(inventory)
    );
    await execute("git", [
      "-C",
      root,
      "add",
      "--",
      internalDoc,
      "publication-policy.json"
    ]);
    await assert.rejects(run(), /PUBLICATION_HISTORICAL_EXPOSURE/u);
    assert.equal(
      await readFile(path.join(root, internalDoc), "utf8"),
      "# Old history\n"
    );
  } finally {
    await repository.dispose();
  }
});

test("publication guard rejects nested private data, source-map leakage and links in real tar payloads", async () => {
  const repository = await createTestRepository();
  try {
    const root = repository.root;
    await writeFile(
      path.join(root, "publication-policy.json"),
      JSON.stringify({
        schema: "banzai-publication-inventory/v1",
        schemaVersion: 1,
        mode: "clean",
        entries: []
      })
    );
    const archive = path.join(root, "payload.tar");
    const check = async (file: string) => {
      await execute("tar", ["-cf", archive, "-C", root, file], {
        env: { ...process.env, COPYFILE_DISABLE: "1" }
      });
      return execute(process.execPath, [
        script,
        "--root",
        root,
        "--archive",
        archive
      ]);
    };
    await mkdir(path.join(root, "nested/.banzai/work/w"), { recursive: true });
    await writeFile(
      path.join(root, "nested/.banzai/work/w/report.md"),
      "private evidence"
    );
    await assert.rejects(check("nested"), /PUBLICATION_PRIVATE_PATH/u);
    await writeFile(
      path.join(root, "bundle.mjs.map"),
      JSON.stringify({
        sources: ["../.banzai/work/w/report.md"],
        sourcesContent: ["evidence"]
      })
    );
    await assert.rejects(
      check("bundle.mjs.map"),
      /PUBLICATION_PRIVATE_SOURCE/u
    );
    await writeFile(
      path.join(root, "bundle.mjs.map"),
      JSON.stringify({
        sources: ["src/record.json"],
        sourcesContent: [JSON.stringify({ schema: "banzai-work-binding/v1" })]
      })
    );
    await assert.rejects(
      check("bundle.mjs.map"),
      /PUBLICATION_PRIVATE_CONTENT/u
    );
    await symlink("PROJECT_MANIFEST.md", path.join(root, "link"));
    await assert.rejects(check("link"), /PUBLICATION_ARCHIVE_INVALID/u);
  } finally {
    await repository.dispose();
  }
});

test("accepted F8 rejects force-added environment variants and real tar/map payloads without content disclosure", async () => {
  const repository = await createTestRepository();
  try {
    const root = repository.root;
    await writeFile(
      path.join(root, "publication-policy.json"),
      JSON.stringify({
        schema: "banzai-publication-inventory/v1",
        schemaVersion: 1,
        mode: "clean",
        entries: ["AGENTS.md", "CLAUDE.md", "PROJECT_MANIFEST.md"].map(
          (name) => ({ path: name, classification: "maintainer", sha256: null })
        )
      })
    );
    await execute("git", ["-C", root, "add", "publication-policy.json"]);
    await mkdir(path.join(root, "nested"));
    const secret = "SYNTHETIC_TOKEN_DO_NOT_PRINT";
    for (const filename of [
      ".env.local",
      ".env.production",
      "nested/.env.production"
    ]) {
      await writeFile(path.join(root, filename), `API_TOKEN=${secret}\n`);
      await execute("git", ["-C", root, "add", "-f", "--", filename]);
      const reject = (error: unknown) => {
        const stderr = (error as { stderr: string }).stderr;
        assert.match(stderr, /PUBLICATION_PRIVATE_PATH/u);
        assert.ok(!stderr.includes(secret));
        return true;
      };
      await assert.rejects(
        execute(process.execPath, [script, "--root", root, "--tree", "staged"]),
        reject
      );
      const payload = path.join(root, "payload.tar");
      await execute("tar", ["-cf", payload, "-C", root, filename], {
        env: { ...process.env, COPYFILE_DISABLE: "1" }
      });
      await assert.rejects(
        execute(process.execPath, [
          script,
          "--root",
          root,
          "--archive",
          payload
        ]),
        reject
      );
      await execute("git", ["-C", root, "rm", "--cached", "--", filename]);
    }
    await writeFile(
      path.join(root, "bundle.map"),
      JSON.stringify({
        sources: ["../nested/.env.production"],
        sourcesContent: [secret]
      })
    );
    const payload = path.join(root, "map.tar");
    await execute("tar", ["-cf", payload, "-C", root, "bundle.map"], {
      env: { ...process.env, COPYFILE_DISABLE: "1" }
    });
    await assert.rejects(
      execute(process.execPath, [script, "--root", root, "--archive", payload]),
      (error: unknown) => {
        const stderr = (error as { stderr: string }).stderr;
        assert.match(stderr, /PUBLICATION_PRIVATE_SOURCE/u);
        assert.ok(!stderr.includes(secret));
        return true;
      }
    );
  } finally {
    await repository.dispose();
  }
});
