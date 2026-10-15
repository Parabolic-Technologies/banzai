import { instructionPluginFixture } from "./phase-instruction-fixtures.js";
import assert from "node:assert/strict";
import { readFile, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  combineInstructionParity,
  inspectInstructionParity,
  instructionParityDiagnostic,
  instructionResourceIds,
  phaseInstructionParts
} from "../src/phase-instructions.js";
import { resolveClaudeInvocationScope } from "../src/adapters.js";
import type { InstructionPhase } from "../src/types.js";

const SOURCE_PLUGIN = path.resolve(process.cwd(), "../../plugins/banzai");
const PHASES: InstructionPhase[] = [
  "planning",
  "implementation",
  "review",
  "fix",
  "feature",
  "quick-fix",
  "planning-review"
];

test("planning-review instructions deliver the ordinary threshold, EQ-only exclusion and both examples", () => {
  const text = phaseInstructionParts("planning-review").join("\n");
  assert.match(
    text,
    /An ordinary finding\s+must independently establish a violated requirement/
  );
  assert.match(text, /an EQ-only observation is excluded/);
  assert.match(
    text,
    /omit an EQ-only candidate instead of sending it to\s+analysis or triage/
  );
  assert.match(
    text,
    /a task that removes an authorization check required by an accepted\s+ADR is an ordinary safety and architecture finding/
  );
  assert.match(text, /extract a helper solely to reduce function length/);
  assert.match(
    text,
    /without a violated requirement or invariant, is an excluded EQ-only observation/
  );
  assert.match(text, /Write no files/);
});

test("planning instructions keep Accepted ADR bodies immutable across rework, analysis and triage application", () => {
  const text = phaseInstructionParts("planning").join("\n");
  assert.match(
    text,
    /Accepted ADR\s+bodies remain immutable; a changed decision requires the normal Proposed ADR\s+and explicit acceptance lifecycle/
  );
  assert.match(text, /return a phase gate\s+or change an Accepted ADR body/);
  assert.match(
    text,
    /Preserve Accepted ADR bodies and normal planning\s+write grants/
  );
});

test("embedded phase bodies preserve all canonical UTF-8 bytes in the exact resource order", async () => {
  const guidance = {
    planning: ["requirements", "architecture", "planning", "code-design"],
    implementation: ["implementation", "assurance", "manifest", "code-design"],
    review: ["review"],
    fix: ["fix", "manifest", "code-design"],
    feature: ["feature", "manifest", "code-design"],
    "quick-fix": ["fix", "manifest", "code-design"],
    "planning-review": ["requirements", "architecture", "planning"]
  };
  for (const phase of PHASES) {
    const ids = instructionResourceIds([phase]).filter(
      (id) => !id.startsWith("hooks/")
    );
    assert.deepEqual(
      ids.filter((id) => id.startsWith("guidance/")),
      guidance[phase].map((name) => `guidance/${name}.md`)
    );
    const policies = [
      "test-assurance",
      "security-assurance",
      "engineering-quality",
      ...(phase === "feature" ? [] : ["plan-task-completion"]),
      ...(phase === "planning-review" ? [] : ["artifact-storage"])
    ];
    if (phase === "planning") policies.unshift("decision-consultation");
    assert.deepEqual(
      ids.filter((id) => id.startsWith("policies/")),
      policies.map((name) => `policies/${name}.md`)
    );
    const source = await Promise.all(
      ids.map((id) => readFile(path.join(SOURCE_PLUGIN, id), "utf8"))
    );
    assert.deepEqual(phaseInstructionParts(phase), source, phase);
    assert.equal(ids.filter((id) => id.startsWith("phases/")).length, 1);
    assert.equal(new Set(ids).size, ids.length);
  }
});

test("composed review instructions exclude the code-design method that its consumers receive", async () => {
  const method = await readFile(
    path.join(SOURCE_PLUGIN, "guidance/code-design.md"),
    "utf8"
  );
  // Reviewers assess the recorded assessment under existing authority; giving
  // them the method itself would couple the audit to the design procedure.
  const review = phaseInstructionParts("review").join("\n\n");
  assert.ok(!review.includes(method));
  assert.ok(!review.includes("# Code Design Guidance"));
  for (const phase of [
    "planning",
    "implementation",
    "fix",
    "feature",
    "quick-fix"
  ] as const) {
    assert.ok(
      phaseInstructionParts(phase).join("\n\n").includes(method),
      phase
    );
  }
});

test("installed parity uses bounded raw identities, with mismatch before missing evidence and no path/content leak", async () => {
  const fixture = await instructionPluginFixture();
  try {
    const valid = await inspectInstructionParity(fixture.directory, PHASES);
    assert.equal(valid.state, "verified");
    // Chat skill bytes and release labels are not runner-consumed identities.
    await writeFile(
      path.join(fixture.directory, "skills/code-writing/SKILL.md"),
      "Still structurally present.\n"
    );
    assert.equal(
      (await inspectInstructionParity(fixture.directory, PHASES)).state,
      "verified"
    );
    const target = path.join(fixture.directory, "phases/fix.md");
    const source = await readFile(target);
    await writeFile(target, Buffer.concat([source, Buffer.from(" \n")]));
    await rm(path.join(fixture.directory, "guidance/assurance.md"));
    const mixed = await inspectInstructionParity(fixture.directory, PHASES);
    assert.equal(mixed.state, "mismatch");
    assert.deepEqual(mixed.mismatched, ["phases/fix.md"]);
    assert.deepEqual(mixed.unavailable, ["guidance/assurance.md"]);
    assert.equal(
      combineInstructionParity([
        mixed,
        await inspectInstructionParity(null, PHASES)
      ]).state,
      "mismatch"
    );
    await writeFile(target, source);
    const missing = await inspectInstructionParity(fixture.directory, PHASES);
    assert.equal(missing.state, "bounded_failure");
    assert.equal(
      combineInstructionParity([
        missing,
        await inspectInstructionParity(null, [])
      ]).state,
      "bounded_failure"
    );
    await symlink(
      path.join(SOURCE_PLUGIN, "guidance/assurance.md"),
      path.join(fixture.directory, "guidance/assurance.md")
    );
    assert.equal(
      (await inspectInstructionParity(fixture.directory, ["implementation"]))
        .state,
      "bounded_failure"
    );
    await writeFile(target, Buffer.alloc(1024 * 1024 + 1, 65));
    assert.equal(
      (await inspectInstructionParity(fixture.directory, ["fix"])).state,
      "bounded_failure"
    );
    for (const result of [
      mixed,
      missing,
      await inspectInstructionParity(null, PHASES)
    ]) {
      const diagnostic = instructionParityDiagnostic(result);
      assert.doesNotMatch(diagnostic, new RegExp(fixture.directory));
      if (result.state === "unverifiable")
        assert.doesNotMatch(
          diagnostic,
          /Rebuild|update the installed plugin|Codex/
        );
      else
        assert.match(
          diagnostic,
          /Rebuild the orchestrator bundle.*update the installed plugin.*explicitly select ambient mode/
        );
    }
  } finally {
    await fixture.dispose();
  }
});

test("selection compares hooks only and structural hook refusal precedes content parity", async () => {
  const fixture = await instructionPluginFixture();
  try {
    await writeFile(
      path.join(fixture.directory, "phases/planning.md"),
      "PRIVATE-CONTENT-CANARY"
    );
    assert.equal(
      (await inspectInstructionParity(fixture.directory, [])).state,
      "verified"
    );
    const script = path.join(fixture.directory, "hooks/spec-gate.cjs");
    await writeFile(
      script,
      (await readFile(script, "utf8")) + "\n// local skew\n"
    );
    const scope = await resolveClaudeInvocationScope({
      mode: "scoped",
      pluginDirectory: fixture.directory
    });
    const parity = await inspectInstructionParity(
      scope.scope.pluginDirectory,
      []
    );
    assert.equal(parity.state, "mismatch");
    assert.deepEqual(parity.mismatched, ["hooks/spec-gate.cjs"]);
    assert.doesNotMatch(
      instructionParityDiagnostic(parity),
      /PRIVATE-CONTENT-CANARY/
    );
    await rm(script);
    await assert.rejects(
      resolveClaudeInvocationScope({
        mode: "scoped",
        pluginDirectory: fixture.directory
      }),
      { code: "BANZAI_PLUGIN_DIRECTORY_INVALID" }
    );
    assert.equal(
      (await inspectInstructionParity(null, [])).state,
      "unverifiable"
    );
  } finally {
    await fixture.dispose();
  }
});
