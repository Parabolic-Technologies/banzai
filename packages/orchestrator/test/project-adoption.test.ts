import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  open,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  adoptionDiagnostic,
  GUIDANCE_MAX_BYTES,
  inspectProjectAdoption,
  readAdoptionFile,
  SCAFFOLD_MARKER
} from "../src/project-adoption.js";
import {
  ADOPTED_AGENTS,
  POPULATED_MANIFEST,
  SOURCE_IDENTITY_FIXTURES,
  writeAdoptedGuidance,
  writeIdentity
} from "./adoption-fixtures.js";
import { snapshotTree } from "./helpers.js";

test("adoption structural matrix preserves bounded reasons and unchanged files", async (t) => {
  const cases = [
    {
      name: "missing",
      expected: "setup_required",
      agents: null,
      manifest: null
    },
    { name: "populated without shim", expected: "ready" },
    {
      name: "populated with shim",
      expected: "ready",
      claude: "@AGENTS.md\nHost notes."
    },
    {
      name: "generic rules",
      expected: "setup_required",
      agents: "# Personal rules\nBe precise."
    },
    {
      name: "partial inline policy",
      expected: "needs_attention",
      agents: null,
      claude: "## Engineering Quality\nOld rules."
    },
    {
      name: "partial",
      expected: "needs_attention",
      agents: "## Authority\nHuman rules."
    },
    {
      name: "conflict",
      expected: "needs_attention",
      claude: "## Security Assurance\nOld copy."
    },
    {
      name: "include",
      expected: "needs_attention",
      agents: `@/secret/path\n${ADOPTED_AGENTS}`
    },
    {
      name: "marker",
      expected: "setup_required",
      manifest: `${SCAFFOLD_MARKER}\n${POPULATED_MANIFEST}`
    },
    {
      name: "documented marker",
      expected: "ready",
      manifest: `${POPULATED_MANIFEST}\n${SCAFFOLD_MARKER}`
    },
    {
      name: "inline marker",
      expected: "ready",
      manifest: `Example ${SCAFFOLD_MARKER}\n${POPULATED_MANIFEST}`
    },
    { name: "old scaffold wording", expected: "ready" },
    {
      name: "comment headings",
      expected: "setup_required",
      manifest: `<!--\n${POPULATED_MANIFEST}\n-->`
    },
    {
      name: "fenced headings",
      expected: "setup_required",
      manifest: `\`\`\`markdown\n${POPULATED_MANIFEST}\`\`\``
    },
    {
      name: "empty section",
      expected: "setup_required",
      manifest: POPULATED_MANIFEST.replace(
        "Only guidance files exist.",
        "<!-- FORBIDDEN-CONTENT -->"
      )
    },
    {
      name: "unordered",
      expected: "setup_required",
      manifest: POPULATED_MANIFEST.replace("Project Overview", "Architecture")
    },
    {
      name: "fenced rules",
      expected: "setup_required",
      agents: `\`\`\`\n${ADOPTED_AGENTS}\`\`\``
    }
  ];
  for (const fixture of cases)
    await t.test(fixture.name, async () => {
      const root = await mkdtemp(path.join(tmpdir(), "banzai-adoption-"));
      try {
        if (fixture.agents !== null)
          await writeFile(
            path.join(root, "AGENTS.md"),
            fixture.agents ?? ADOPTED_AGENTS
          );
        if (fixture.manifest !== null)
          await writeFile(
            path.join(root, "PROJECT_MANIFEST.md"),
            fixture.manifest ?? POPULATED_MANIFEST
          );
        if (fixture.claude)
          await writeFile(path.join(root, "CLAUDE.md"), fixture.claude);
        const before = await snapshotTree(root);
        const result = await inspectProjectAdoption(root);
        assert.equal(result.classification, fixture.expected);
        assert.deepEqual(await snapshotTree(root), before);
        const diagnostic = adoptionDiagnostic(result);
        assert.doesNotMatch(
          diagnostic,
          /FORBIDDEN|secret\/path|<T>|Project Overview/
        );
        assert.ok(!diagnostic.includes(root));
        if (fixture.name === "partial inline policy")
          assert.ok(
            result.issues.some(
              (issue) =>
                issue.reason ===
                "CLAUDE.md contains Engineering Quality while AGENTS.md lacks Authority; instruction layout is partial."
            )
          );
        if (fixture.name === "marker")
          assert.equal(result.issues[0]?.reason, "scaffold marker present");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
});

test("adoption source identities require complete fixed metadata and preserve continuation exemption", async (t) => {
  for (const fixture of SOURCE_IDENTITY_FIXTURES)
    await t.test(fixture.name, async () => {
      const root = await mkdtemp(path.join(tmpdir(), "banzai-source-"));
      try {
        await writeAdoptedGuidance(root);
        await writeFile(
          path.join(root, "AGENTS.md"),
          "@/host/instructions\n# Plugin source rules\n"
        );
        await writeIdentity(root, fixture.files);
        const result = await inspectProjectAdoption(root);
        assert.equal(result.sourceRepository, fixture.source);
        assert.equal(
          result.classification,
          fixture.source
            ? "ready"
            : "attention" in fixture
              ? "needs_attention"
              : "setup_required"
        );
        await writeFile(
          path.join(root, "PROJECT_MANIFEST.md"),
          "broken by a workflow"
        );
        assert.equal(
          (await inspectProjectAdoption(root, { layoutOnly: true }))
            .classification,
          result.classification
        );
        if (fixture.name === "source workspace") {
          await rm(path.join(root, "plugins/banzai/.codex-plugin/plugin.json"));
          assert.equal(
            (await inspectProjectAdoption(root)).sourceRepository,
            false
          );
        }
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  const actual = await inspectProjectAdoption(path.resolve("../.."));
  assert.equal(actual.sourceRepository, true);
  assert.equal(actual.classification, "ready");
});

test("adoption rejects unsafe filesystem evidence without reading or disclosing it", async (t) => {
  for (const kind of [
    "internal link",
    "escaping link",
    "dangling link",
    "directory",
    "fifo",
    "oversize",
    "unreadable",
    "invalid metadata",
    "dangling metadata parent"
  ])
    await t.test(kind, async () => {
      const root = await mkdtemp(path.join(tmpdir(), "banzai-adoption-fs-"));
      const external = await mkdtemp(
        path.join(tmpdir(), "banzai-adoption-outside-")
      );
      try {
        await writeAdoptedGuidance(root);
        const target = path.join(root, "AGENTS.md");
        if (kind.endsWith("link")) {
          await rm(target);
          const destination =
            kind === "internal link"
              ? path.join(root, "rules.md")
              : path.join(external, "rules.md");
          if (kind !== "dangling link")
            await writeFile(destination, ADOPTED_AGENTS);
          await symlink(destination, target);
        } else if (kind === "directory" || kind === "fifo") {
          await rm(target);
          if (kind === "directory") await mkdir(target);
          else execFileSync("mkfifo", [target]);
        } else if (kind === "oversize")
          await writeFile(target, "x".repeat(GUIDANCE_MAX_BYTES + 1));
        else if (kind === "unreadable") await chmod(target, 0);
        else if (kind === "invalid metadata")
          await writeFile(
            path.join(root, "package.json"),
            "{FORBIDDEN_METADATA"
          );
        else
          await symlink(
            path.join(root, "missing"),
            path.join(root, ".claude-plugin")
          );
        const result = await inspectProjectAdoption(root);
        assert.equal(
          result.classification,
          kind === "internal link" ? "ready" : "needs_attention"
        );
        assert.doesNotMatch(
          JSON.stringify(result),
          /FORBIDDEN_METADATA|banzai-adoption-outside/
        );
        if (kind === "internal link")
          assert.equal(await readFile(target, "utf8"), ADOPTED_AGENTS);
      } finally {
        await rm(root, { recursive: true, force: true });
        await rm(external, { recursive: true, force: true });
      }
    });
});

test("adoption product source pins the shared identity predicate and approved scaffold-marker removal", async () => {
  const root = path.resolve("../..");
  const skill = await readFile(
    path.join(root, "plugins/banzai/skills/project-manifest/SKILL.md"),
    "utf8"
  );
  const section = (text: string) =>
    text.split("## Source Repository Exception\n")[1]?.split("\n## ")[0];
  assert.ok(section(skill));
  for (const required of [
    "at least one",
    "every present",
    "readable JSON",
    'name: "banzai"',
    'name: "banzai-spec-driven-dev"',
    "private: true",
    "packages/*",
    "exactly one",
    'source: "./plugins/banzai"',
    "plugins/banzai/.claude-plugin/plugin.json",
    "plugins/banzai/.codex-plugin/plugin.json",
    "unsafe, unreadable or conflicting"
  ])
    assert.ok((section(skill) ?? "").includes(required), required);
  const template = await readFile(
    path.join(root, "plugins/banzai/PROJECT_MANIFEST.md"),
    "utf8"
  );
  assert.equal(
    (template.split(/^#/m)[0] ?? "")
      .split("\n")
      .filter((line) => line === SCAFFOLD_MARKER).length,
    1
  );
  assert.match(
    skill,
    /When applying the approved bootstrap population, remove the complete line/
  );
  assert.match(skill, /Never overwrite existing files/);
  assert.match(skill, /^disable-model-invocation: true$/m);
  assert.match(
    skill,
    /On partial report the exact ambiguity without changing source/
  );
  const supervisor = await readFile(
    path.join(
      root,
      "plugins/banzai/skills/orchestrate/references/control-protocol.md"
    ),
    "utf8"
  );
  assert.match(
    supervisor,
    /On `PROJECT_SETUP_REQUIRED`, stop the automatic continuation loop/
  );
  assert.match(
    supervisor,
    /Do not run `banzai setup` or\n`project-manifest` autonomously/
  );
});

test("adoption detects a file changed through the filesystem during inspection", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "banzai-adoption-changing-"));
  try {
    await writeAdoptedGuidance(root);
    const target = path.join(root, "AGENTS.md");
    const handle = await open(target, "r");
    const prototype = Object.getPrototypeOf(handle) as Pick<FileHandle, "read">;
    const original = prototype.read;
    await handle.close();
    let changed = false;
    t.mock.method(
      prototype,
      "read",
      async function (
        this: FileHandle,
        ...args: Parameters<FileHandle["read"]>
      ) {
        const value = (await Reflect.apply(original, this, args)) as Awaited<
          ReturnType<FileHandle["read"]>
        >;
        if (!changed) {
          changed = true;
          await writeFile(target, `${ADOPTED_AGENTS}\nConcurrent update.\n`);
        }
        return value;
      }
    );
    const result = await readAdoptionFile(
      await realpath(root),
      "AGENTS.md",
      GUIDANCE_MAX_BYTES
    );
    assert.equal(changed, true);
    assert.equal(result.text, null);
    assert.equal(result.problem, "file changed during inspection");
  } finally {
    t.mock.restoreAll();
    await rm(root, { recursive: true, force: true });
  }
});

test("adoption unsafe companion metadata cannot grant a source exception", async () => {
  const root = await mkdtemp(
    path.join(tmpdir(), "banzai-identity-unreadable-")
  );
  try {
    await writeAdoptedGuidance(root);
    await writeIdentity(root, {
      ".codex-plugin/plugin.json": { name: "banzai" },
      ".claude-plugin/plugin.json": { name: "banzai" }
    });
    await chmod(path.join(root, ".claude-plugin/plugin.json"), 0);
    const result = await inspectProjectAdoption(root);
    assert.equal(result.classification, "needs_attention");
    assert.equal(result.sourceRepository, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
