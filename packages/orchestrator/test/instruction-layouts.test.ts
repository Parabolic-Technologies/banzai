import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const ROOT = path.resolve(process.cwd(), "../..");
const FIXTURES = path.join(process.cwd(), "test/fixtures/instruction-layouts");
const POLICY_HEADINGS = [
  "Decision Consultation",
  "Test Assurance",
  "Security Assurance",
  "Engineering Quality",
  "Plan Task Completion Evidence"
];
const DIAGNOSTIC = "legacy Banzai layout: run `project-manifest` to migrate";
type Layout = "target" | "legacy" | "partial" | "unadopted";
interface Files {
  agents: string | null;
  claude: string | null;
  unreadable?: boolean;
}

// This is a fixture oracle for the shipped prose, not a runtime policy loader.
function recognizeLayout(files: Files): Layout {
  if (files.unreadable) return "partial";
  const has = (text: string | null, heading: string) =>
    text?.split("\n").includes(`## ${heading}`) ?? false;
  if (
    has(files.agents, "Authority") &&
    has(files.agents, "Policies") &&
    !/^@/m.test(files.agents ?? "") &&
    !POLICY_HEADINGS.some((heading) => has(files.claude, heading))
  )
    return "target";
  if (
    has(files.claude, "Engineering Quality") &&
    !has(files.agents, "Authority")
  )
    return "legacy";
  if (
    !["Authority", ...POLICY_HEADINGS].some(
      (heading) => has(files.agents, heading) || has(files.claude, heading)
    )
  )
    return "unadopted";
  return "partial";
}

async function instructionFiles(directory: string): Promise<Files> {
  const read = async (name: string): Promise<string | null> => {
    try {
      return await readFile(path.join(directory, name), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  };
  return { agents: await read("AGENTS.md"), claude: await read("CLAUDE.md") };
}

test("instruction layout fixtures preserve approved migration and stop outcomes", async () => {
  const reference = await readFile(
    path.join(
      ROOT,
      "plugins/banzai/skills/project-manifest/references/layout-migration.md"
    ),
    "utf8"
  );
  const fixtureNames = (await readdir(FIXTURES, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const tableNames = [...reference.matchAll(/^\| ([a-z][a-z-]+)\s*\|/gm)]
    .map((match) => match[1])
    .sort();
  assert.deepEqual(tableNames, fixtureNames);
  for (const name of fixtureNames) {
    const directory = path.join(FIXTURES, name);
    const expected = JSON.parse(
      await readFile(path.join(directory, "expected.json"), "utf8")
    ) as { layout: Layout; behavior: string; diagnostic: string | null };
    const before = await instructionFiles(path.join(directory, "before"));
    assert.equal(recognizeLayout(before), expected.layout, name);
    if (expected.layout === "legacy")
      assert.equal(expected.diagnostic, DIAGNOSTIC, name);
    const after = await instructionFiles(path.join(directory, "after"));
    if (expected.behavior === "declined") {
      assert.deepEqual(after, before, "decline retains exact original bytes");
      continue;
    }
    if (
      ["scaffold", "approved_migration", "approved_completion"].includes(
        expected.behavior
      )
    ) {
      assert.equal(recognizeLayout(after), "target", name);
      for (const heading of POLICY_HEADINGS) {
        assert.ok(!after.agents?.split("\n").includes(`## ${heading}`), name);
        assert.ok(!after.claude?.split("\n").includes(`## ${heading}`), name);
      }
    } else {
      assert.deepEqual(
        after,
        { agents: null, claude: null },
        "stopped fixtures propose no applied output"
      );
      assert.ok(expected.diagnostic, name);
    }
  }
  const fresh = await instructionFiles(
    path.join(FIXTURES, "fresh-adoption/after")
  );
  assert.deepEqual(
    fresh,
    await instructionFiles(path.join(ROOT, "plugins/banzai")),
    "fresh scaffold copies the packaged files unchanged"
  );
  const custom = await instructionFiles(
    path.join(FIXTURES, "custom-content-migration/after")
  );
  const restriction = "Never change `public/schema.json` without approval.";
  const note = "Claude Code: prefer the `Bash` tool for `npm` commands.";
  assert.ok(custom.agents && custom.claude);
  assert.ok(
    custom.agents.indexOf(restriction) >
      custom.agents.indexOf("## Project Rules")
  );
  assert.ok(!custom.claude.includes(restriction));
  assert.ok(custom.claude.indexOf(note) > custom.claude.indexOf("@AGENTS.md"));
  assert.ok(!custom.agents.includes(note));
  assert.match(reference, /Apply only after approval/);
  assert.match(reference, /nothing is silently dropped, duplicated/);
  assert.match(reference, /No release is pinned, installed or downgraded/);
});

test("instruction layout unreadable and partial inputs never establish a target", () => {
  assert.equal(
    recognizeLayout({
      agents: "# AGENTS.md\n\n## Authority\n\n## Policies\n",
      claude: null,
      unreadable: true
    }),
    "partial"
  );
  assert.equal(
    recognizeLayout({ agents: "## Authority\n", claude: null }),
    "partial"
  );
  assert.equal(
    recognizeLayout({
      agents: "## Authority\n## Policies\n@other.md\n",
      claude: null
    }),
    "partial"
  );
});
