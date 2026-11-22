import { instructionPluginFixture } from "./phase-instruction-fixtures.js";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  combineInstructionParity,
  inspectInstructionParity,
  inspectRoleInstructionParity,
  instructionParityDiagnostic,
  instructionPhasesForRole,
  instructionResourceIds,
  phaseInstructionParts
} from "../src/phase-instructions.js";
import { EMBEDDED_PHASE_RESOURCES } from "../src/phase-resources.js";
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
const HOOK_IDS = ["hooks/hooks.json", "hooks/spec-gate.cjs"];
const INSTRUCTION_MODULE = "packages/orchestrator/src/phase-resources.ts";
const TEXT_ENTRIES = new Map(
  Object.entries(EMBEDDED_PHASE_RESOURCES).flatMap(([id, resource]) =>
    "text" in resource ? [[id, resource] as const] : []
  )
);

async function successorExpectations(): Promise<Record<string, string>> {
  const baseline = JSON.parse(
    await readFile(path.resolve("instruction-baseline.json"), "utf8")
  ) as { expectations: Record<string, string> };
  return baseline.expectations;
}

// The frozen module is the only source of runner text (ADR-0070 section 1):
// an entry is trusted through its own digest and the successor baseline.
function frozenText(id: string, expectations: Record<string, string>): string {
  const entry = TEXT_ENTRIES.get(id);
  assert.ok(entry, id);
  assert.equal(
    createHash("sha256").update(entry.text).digest("hex"),
    entry.sha256,
    id
  );
  assert.equal(expectations[`${INSTRUCTION_MODULE}#${id}`], entry.sha256, id);
  return entry.text;
}

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

test("embedded phase bodies match their own digests and the successor baseline in the exact resource order", async () => {
  const expectations = await successorExpectations();
  assert.equal(TEXT_ENTRIES.size, 23);
  for (const id of TEXT_ENTRIES.keys()) frozenText(id, expectations);
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
    assert.deepEqual(
      phaseInstructionParts(phase),
      ids.map((id) => frozenText(id, expectations)),
      phase
    );
    assert.equal(ids.filter((id) => id.startsWith("phases/")).length, 1);
    assert.equal(new Set(ids).size, ids.length);
  }
});

test("delivered artifact-storage policy states the ADR-0066 date-prefixed slug rule", () => {
  const text = phaseInstructionParts("feature").join("\n");
  assert.match(text, /The slug is `yymmdd-<subject>`: the local creation date/);
  assert.match(
    text,
    /must not exist under\s+`documentation\/work\/` or `documentation\/initiatives\/`/
  );
  assert.doesNotMatch(text, /without required dates/);
});

test("composed review instructions exclude the code-design method that its consumers receive", async () => {
  const method = frozenText(
    "guidance/code-design.md",
    await successorExpectations()
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

test("installed parity compares hook identities only, with mismatch before missing evidence and no path/content leak", async () => {
  const fixture = await instructionPluginFixture();
  try {
    const valid = await inspectInstructionParity(fixture.directory, PHASES);
    assert.equal(valid.state, "verified");
    assert.deepEqual(valid.resourceIds, HOOK_IDS);
    // Chat skill bytes and release labels are not runner-consumed identities.
    await writeFile(
      path.join(fixture.directory, "skills/code-writing/SKILL.md"),
      "Still structurally present.\n"
    );
    assert.equal(
      (await inspectInstructionParity(fixture.directory, PHASES)).state,
      "verified"
    );
    // Runner text comes from the frozen module (ADR-0070 section 4): edited
    // or deleted installed text is no parity evidence.
    const phase = path.join(fixture.directory, "phases/fix.md");
    await writeFile(
      phase,
      Buffer.concat([await readFile(phase), Buffer.from(" \n")])
    );
    await rm(path.join(fixture.directory, "guidance/assurance.md"));
    await writeFile(
      path.join(fixture.directory, "policies/test-assurance.md"),
      "PRIVATE-CONTENT-CANARY"
    );
    for (const phases of [PHASES, ["fix"], ["implementation"], []] as const)
      assert.deepEqual(
        await inspectInstructionParity(fixture.directory, phases),
        {
          state: "verified",
          resourceIds: HOOK_IDS,
          mismatched: [],
          unavailable: []
        }
      );
    await rm(path.join(fixture.directory, "phases"), { recursive: true });
    await rm(path.join(fixture.directory, "guidance"), { recursive: true });
    await rm(path.join(fixture.directory, "policies"), { recursive: true });
    assert.equal(
      (await inspectInstructionParity(fixture.directory, PHASES)).state,
      "verified"
    );
    const target = path.join(fixture.directory, "hooks/spec-gate.cjs");
    const config = path.join(fixture.directory, "hooks/hooks.json");
    const source = await readFile(target);
    await writeFile(target, Buffer.concat([source, Buffer.from(" \n")]));
    await rm(config);
    const mixed = await inspectInstructionParity(fixture.directory, PHASES);
    assert.equal(mixed.state, "mismatch");
    assert.deepEqual(mixed.resourceIds, HOOK_IDS);
    assert.deepEqual(mixed.mismatched, ["hooks/spec-gate.cjs"]);
    assert.deepEqual(mixed.unavailable, ["hooks/hooks.json"]);
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
    assert.deepEqual(missing.unavailable, ["hooks/hooks.json"]);
    assert.equal(
      combineInstructionParity([
        missing,
        await inspectInstructionParity(null, [])
      ]).state,
      "bounded_failure"
    );
    await symlink(path.join(SOURCE_PLUGIN, "hooks/hooks.json"), config);
    assert.equal(
      (await inspectInstructionParity(fixture.directory, ["implementation"]))
        .state,
      "bounded_failure"
    );
    await rm(config);
    await cp(path.join(SOURCE_PLUGIN, "hooks/hooks.json"), config);
    assert.equal(
      (await inspectInstructionParity(fixture.directory, ["fix"])).state,
      "verified"
    );
    await writeFile(target, Buffer.alloc(1024 * 1024 + 1, 65));
    const oversized = await inspectInstructionParity(fixture.directory, [
      "fix"
    ]);
    assert.equal(oversized.state, "bounded_failure");
    assert.deepEqual(oversized.unavailable, ["hooks/spec-gate.cjs"]);
    for (const result of [
      valid,
      mixed,
      missing,
      await inspectInstructionParity(null, PHASES)
    ]) {
      const diagnostic = instructionParityDiagnostic(result);
      assert.doesNotMatch(diagnostic, new RegExp(fixture.directory));
      assert.doesNotMatch(diagnostic, /phases\/|guidance\/|policies\//);
      if (result.state === "verified")
        assert.match(
          diagnostic,
          /^Applicable Claude instruction resources verified \(hooks\/hooks\.json, hooks\/spec-gate\.cjs\); /
        );
      else if (result.state === "unverifiable")
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

test("parity names the two hook ids for every role and phase set and leaves delivered resource ids alone", async () => {
  const fixture = await instructionPluginFixture();
  try {
    for (const role of ["planner", "implementer", "reviewer"] as const)
      for (const route of [null, "strict", "feature", "quick-fix"] as const) {
        const phases = instructionPhasesForRole(role, route) ?? [];
        const label = `${role} ${String(route)}`;
        assert.deepEqual(
          await inspectRoleInstructionParity(
            "claude",
            fixture.directory,
            phases
          ),
          {
            state: "verified",
            resourceIds: HOOK_IDS,
            mismatched: [],
            unavailable: []
          },
          label
        );
        assert.deepEqual(
          await inspectRoleInstructionParity("claude", null, phases),
          {
            state: "unverifiable",
            resourceIds: HOOK_IDS,
            mismatched: [],
            unavailable: []
          },
          label
        );
        assert.deepEqual(
          await inspectRoleInstructionParity(
            "codex",
            fixture.directory,
            phases
          ),
          {
            state: "not_applicable",
            resourceIds: [],
            mismatched: [],
            unavailable: []
          },
          label
        );
      }
  } finally {
    await fixture.dispose();
  }
  // Prompt assembly still reads the hook-first, phase-ordered id list.
  assert.deepEqual(instructionResourceIds(["review"]), [
    ...HOOK_IDS,
    "phases/review.md",
    "guidance/review.md",
    "policies/test-assurance.md",
    "policies/security-assurance.md",
    "policies/engineering-quality.md",
    "policies/plan-task-completion.md",
    "policies/artifact-storage.md"
  ]);
  const unknown = ["unknown-phase"] as unknown as InstructionPhase[];
  assert.throws(() => instructionResourceIds(unknown), {
    code: "INSTRUCTION_RESOURCE_INVALID"
  });
  await assert.rejects(inspectInstructionParity(null, unknown), {
    code: "INSTRUCTION_RESOURCE_INVALID"
  });
});

test("selection compares hooks only and structural hook refusal precedes content parity", async () => {
  const fixture = await instructionPluginFixture();
  try {
    await writeFile(
      path.join(fixture.directory, "phases/planning.md"),
      "PRIVATE-CONTENT-CANARY"
    );
    for (const phases of [[], PHASES])
      assert.equal(
        (await inspectInstructionParity(fixture.directory, phases)).state,
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
    for (const phases of [[], PHASES]) {
      const parity = await inspectInstructionParity(
        scope.scope.pluginDirectory,
        phases
      );
      assert.equal(parity.state, "mismatch");
      assert.deepEqual(parity.mismatched, ["hooks/spec-gate.cjs"]);
      assert.doesNotMatch(
        instructionParityDiagnostic(parity),
        /PRIVATE-CONTENT-CANARY/
      );
    }
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
