import {
  INSTRUCTION_RESOURCE_IDS,
  GENERATED_PHASE_RESOURCE_PATH
} from "../scripts/phase-resources-build.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
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

test("actual source/plugin/npm archive resources and source-map bytes must describe one candidate", async () => {
  const { readTar, inspectPublicationFiles } = (await import(
    pathToFileURL(path.resolve("scripts/publication-check.mjs")).href
  )) as typeof import("../scripts/publication-check.mjs");
  const { checkInstructionPayloads } = (await import(
    pathToFileURL(path.resolve("scripts/phase-resources-build.mjs")).href
  )) as typeof import("../scripts/phase-resources-build.mjs");
  const root = path.resolve(process.cwd(), "../..");
  const fixture = await createTestRepository();
  try {
    const resources = INSTRUCTION_RESOURCE_IDS.map(
      (id) => `plugins/banzai/${id}`
    );
    const sourceNames = [
      ...resources,
      GENERATED_PHASE_RESOURCE_PATH,
      "packages/orchestrator/dist/banzai.mjs",
      "packages/orchestrator/dist/banzai.mjs.map"
    ];
    const sourceRoot = path.join(fixture.root, "source");
    for (const name of sourceNames) {
      const target = path.join(sourceRoot, name);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, await readFile(path.join(root, name)));
    }
    const npmRoot = path.join(fixture.root, "npm");
    for (const name of [
      "package.json",
      "README.md",
      "LICENSE",
      "NOTICE",
      "dist/banzai.mjs",
      "dist/banzai.mjs.map"
    ]) {
      const target = path.join(npmRoot, "package", name);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(
        target,
        await readFile(path.join(root, "packages/orchestrator", name))
      );
    }
    const archive = async (
      directory: string,
      name: string,
      files: string[]
    ) => {
      const target = path.join(fixture.root, `${name}.tar`);
      await execute("tar", ["-cf", target, "-C", directory, ...files], {
        env: { ...process.env, COPYFILE_DISABLE: "1" }
      });
      return readTar(await readFile(target));
    };
    const source = await archive(sourceRoot, "source", ["."]);
    const plugin = await archive(sourceRoot, "plugin", ["plugins/banzai"]);
    const npm = await archive(npmRoot, "npm", ["package"]);
    assert.equal(npm.size, 6);
    assert.equal(
      (await checkInstructionPayloads(root, { source, plugin, npm }))
        .resourceCount,
      24
    );
    const policy = JSON.parse(
      await readFile(path.join(root, "publication-policy.json"), "utf8")
    ) as unknown;
    for (const [distribution, files] of [
      ["source", source],
      ["plugin", plugin],
      ["npm", npm]
    ] as const)
      inspectPublicationFiles(policy, files, { distribution });
    for (const [files, key] of [
      [source, "plugins/banzai/phases/fix.md"],
      [plugin, "plugins/banzai/guidance/review.md"],
      [npm, "package/dist/banzai.mjs"],
      [source, GENERATED_PHASE_RESOURCE_PATH]
    ] as const) {
      const original = files.get(key);
      assert.ok(original);
      files.set(key, Buffer.concat([original, Buffer.from(" \n")]));
      await assert.rejects(
        checkInstructionPayloads(root, { source, plugin, npm }),
        /INSTRUCTION_PAYLOAD_MISMATCH/
      );
      files.delete(key);
      await assert.rejects(
        checkInstructionPayloads(root, { source, plugin, npm }),
        /INSTRUCTION_PAYLOAD_MISMATCH/
      );
      files.set(key, original);
    }
    // Matching distribution files do not excuse an incorrect embedded source map.
    const originalMap = npm.get("package/dist/banzai.mjs.map");
    assert.ok(originalMap);
    const map = JSON.parse(originalMap.toString("utf8")) as {
      sources: string[];
      sourcesContent: string[];
    };
    const index = map.sources.findIndex((id) =>
      id.endsWith("/src/phase-resources.ts")
    );
    assert.ok(index >= 0);
    map.sourcesContent[index] =
      (map.sourcesContent[index] ?? "") + "\n// skew\n";
    const skew = Buffer.from(JSON.stringify(map));
    npm.set("package/dist/banzai.mjs.map", skew);
    source.set("packages/orchestrator/dist/banzai.mjs.map", skew);
    await assert.rejects(
      checkInstructionPayloads(root, { source, plugin, npm }),
      /source map resource bytes/
    );
    npm.set("package/dist/banzai.mjs.map", originalMap);
    source.set("packages/orchestrator/dist/banzai.mjs.map", originalMap);
    const originalBundle = npm.get("package/dist/banzai.mjs");
    assert.ok(originalBundle);
    const changedBundle = Buffer.from(
      originalBundle
        .toString("utf8")
        .replace(
          "var EMBEDDED_PHASE_RESOURCES =",
          "var OTHER_PHASE_RESOURCES ="
        )
    );
    npm.set("package/dist/banzai.mjs", changedBundle);
    source.set("packages/orchestrator/dist/banzai.mjs", changedBundle);
    await assert.rejects(
      checkInstructionPayloads(root, { source, plugin, npm }),
      /bundled instruction identities/
    );
    // Privacy inspection decodes embedded bodies instead of scanning only quoted JS.
    const generated = JSON.parse(
      /export const EMBEDDED_PHASE_RESOURCES = ([\s\S]*?) as const;/.exec(
        map.sourcesContent[index] ?? ""
      )?.[1] ?? ""
    ) as Record<string, { text?: string; sha256: string }>;
    const resource = generated["phases/fix.md"];
    assert.ok(resource);
    // Resource prose can contain TypeScript examples without ending the module.
    resource.text = "Example: const value = {} as const;\n";
    resource.sha256 = digest(resource.text);
    map.sourcesContent[index] =
      `export const EMBEDDED_PHASE_RESOURCES = ${JSON.stringify(generated)} as const;`;
    inspectPublicationFiles(
      policy,
      new Map([
        ["package/dist/banzai.mjs.map", Buffer.from(JSON.stringify(map))]
      ]),
      { distribution: "npm" }
    );
    resource.text =
      '{"schema":"banzai-work-binding/v1","workId":"private-canary"}';
    resource.sha256 = digest(resource.text);
    map.sourcesContent[index] =
      `export const EMBEDDED_PHASE_RESOURCES = ${JSON.stringify(generated)} as const;`;
    const privateMap = new Map([
      ["package/dist/banzai.mjs.map", Buffer.from(JSON.stringify(map))]
    ]);
    assert.throws(
      () =>
        inspectPublicationFiles(policy, privateMap, { distribution: "npm" }),
      /PUBLICATION_PRIVATE_CONTENT/
    );
    const unclassified = new Map(plugin);
    unclassified.set(
      "plugins/banzai/guidance/unknown.md",
      Buffer.from("unclassified")
    );
    assert.throws(
      () =>
        inspectPublicationFiles(policy, unclassified, {
          distribution: "plugin"
        }),
      /PUBLICATION_UNCLASSIFIED/
    );
  } finally {
    await fixture.dispose();
  }
});
