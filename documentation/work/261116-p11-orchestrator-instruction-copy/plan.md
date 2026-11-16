# Development Plan: Orchestrator-owned instruction copy (P11)

Slug: 261116-p11-orchestrator-instruction-copy

- Description: [description.md](description.md)
- Program input: package P11 of the
  [plugin rework plan](../261116-standalone-plugin-rework/plan.md)
- Accepted ADRs this plan relies on:
  - [ADR-0070](../../decisions/0070-orchestrator-owned-instruction-copy.md),
    the authority for the package, with owner choice (c);
  - [ADR-0044](../../decisions/0044-instruction-baseline-evolution.md), the
    baseline mechanism, as amended by ADR-0070;
  - [ADR-0042](../../decisions/0042-runner-delivered-phase-instructions.md)
    section 6 and
    [ADR-0020](../../decisions/0020-scoped-claude-subprocess-environment.md),
    parity and the structural check, as amended by ADR-0070;
  - [ADR-0018](../../decisions/0018-agent-supervised-banzai-cli-control.md),
    the control contract, preserved without its packaged supervisor;
  - [ADR-0033](../../decisions/0033-root-package-version-authority.md),
    [ADR-0041](../../decisions/0041-artifact-retention-and-publication-boundary.md),
    [ADR-0052](../../decisions/0052-orchestrator-capability-slice-architecture.md)
    and
    [ADR-0029](../../decisions/0029-eslint-backed-orchestrator-import-boundary-policy.md),
    preserved.
- Manifest facts used: section 2 (build, check and release commands),
  section 3 (plugin and orchestrator ownership), section 4 (structure),
  section 5 (plugin and release owners), section 8 (required final suite),
  section 10 (ADR index).

## Plan Authority

Applicable approved requirements, accepted ADR constraints, public and persisted
contracts, security and authorization boundaries, transaction and lifecycle
guarantees, compatibility, scope, and required verification evidence are binding.
Exact internal details remain binding when required by applicable authority or
concrete constraints; unlabelled explicit directives remain binding.

Only paragraphs or list items prefixed `Optional implementation guidance:` are
non-binding suggestions. A label covers that paragraph or list item, including
its nested content, and ends before the next sibling block. A different compliant
implementation within approved scope needs no reapproval, finding or deviation
report merely for differing from this guidance.

Guidance never overrides binding authority or expands scope. Resolve conflicts
and ambiguous commitments before dependent work; missing or ambiguous optionality
does not waive an explicit commitment.

## Human prerequisites

Nothing blocks implementation. Three owner-only actions follow the package:

- Commit by hand.
- Decide the version at release. This package changes no hook file and no
  file under `plugins/banzai/lib`, so the release validator's version rule
  is not triggered by it.
- Decide what users of a published CLI 2.8.x with a configured plugin
  directory are told (open item of the rework plan). Such a CLI still
  compares text and still requires the removed skill.

## Technical Breakdown

### Current and target state

Current: `npm run build` generates `src/phase-resources.ts` from the plugin's
phase documents, guidance, policies and hook files. Release validation
replays the v1 baseline against plugin files, forbids every transition that
names `hooks.json` or a plugin manifest, and reads the `orchestrate` skill.
The runner compares a resolved plugin directory's text and hook files with
the embedded digests. Eleven skills are required by the runner and by setup.

Target: the description's FR1–FR29.

### 1. Baselines (structural assessment)

Recorded under the Engineering Quality structural assessment triggers.

- Trigger: a new independent responsibility, the successor baseline, with
  its own lifecycle (it keeps changing; the v1 baseline is closed). It
  near-duplicates the v1 transition rule.
- Container and source evidence:
  `packages/orchestrator/scripts/phase-resources-build.mjs` owns generation,
  the v1 root, the v1 chain replay (`applyTransition`, `validateCurrent`),
  authority validation (`validateAuthorities`, `retainedAuthorityMatches`)
  and the comparisons with plugin files (`validateGuidanceExtraction`).
  `scripts/instruction-baseline.mjs` is the tool.
  `scripts/check-release.mjs` calls the validation and reports
  `INSTRUCTION_RESOURCE_DRIFT`.
- Reuse search: owners found and reused are `resourceDigest`,
  `validateAuthorities`, `retainedAuthorityMatches` with its allow-list, the
  manifest `version` normalization of `validateGuidanceExtraction`, and the
  tool's `--describe`, `--authorization` and `--check` flow. No owner exists
  for a baseline whose keys name module entries; searched
  `packages/orchestrator/scripts/` and `plugins/banzai/lib/`.
- Owner and disposition: `extracted`. The successor baseline gets its own
  script module beside the generator. The v1 code is `retained` as the
  closed record's replay, reduced to what reads no plugin file.
- Dependency direction: the digest and authority owners stay in the
  generator module and are exported from it. The successor module imports
  them. The generator does not import the successor module; the release
  validator and the tool call it.
- Invariants:
  1. One implementation validates an authority: path, digest with the
     allow-list, scope text and `Accepted` status. Both baselines use it.
  2. One implementation applies a transition step: key order, predecessor
     digest, digest format and the authority check. The v1 key protections
     apply to the v1 chain only and are not reachable from the successor.
  3. The successor's expectations are compared with current bytes on every
     release validation; the v1 chain is compared with nothing under
     `plugins/banzai/`.
  4. The three v1 files are pinned by digest constants in the release
     validator. No build, test or tool writes them.
  5. Writing the successor file happens only in the tool's initializing and
     publishing forms. Build, `build:check`, tests and release validation
     never write it.
- Verification: the tests of T001; lint with no new complexity warning in
  the new module.
- Remaining debt: the v1 replay code stays for the closed record.
- Authority: within scope of ADR-0070 section 3 and ADR-0044.

The successor file is
`packages/orchestrator/instruction-baseline.json` with a sibling
`instruction-baseline.sha256`. Its keys:

- `packages/orchestrator/src/phase-resources.ts#<resource id>` for each of
  the 23 text entries, valued by the SHA-256 of the entry's text bytes;
- `packages/orchestrator/src/phase-resources.ts#definitions`, valued by the
  SHA-256 of `PHASE_RESOURCE_DEFINITIONS` serialized as JSON with object
  keys sorted recursively and array order preserved;
- `plugins/banzai/hooks/hooks.json` and `plugins/banzai/hooks/spec-gate.cjs`
  by raw bytes;
- the two plugin manifests with their `version` value normalized as the v1
  validation does.

It records the digest of `phase-guidance-current.json` as its predecessor,
and the authorities of its first generation in an `origin` field. The tool's
initializing form writes the first generation and is refused once the file
holds a transition.

### 2. Frozen module

`npm run build` writes only the two hook entries of
`src/phase-resources.ts`. Every other byte of the module is preserved. The
module's header comment is rewritten once, by hand, to say that the text is
frozen. The module's `PHASE_RESOURCE_DEFINITIONS` is the authoritative phase
table; a script constant that repeats it is removed or checked equal to it. The
build fails when it cannot find exactly one digest value for each hook id.
`build:check` compares the hook entries with the plugin's hook files and
reads no plugin text. The text entries are guarded by the successor
baseline, not by the build.

The publication check keeps its internal comparisons (entry text against
entry digest; module, bundle and source map against each other) and loses
the comparison with archived plugin text.

### 3. Parity

Parity takes its ids from the hook id list alone. `instructionResourceIds`,
its unknown-phase guard and the order it gives to delivered text are
unchanged, because prompt assembly relies on them. The states, the error
class and the message wording are unchanged; the id list inside the parity
messages shrinks. Security enforcement point for the access
decision that remains: the hook digests compared in
`src/phase-instructions.ts` and pinned by the successor baseline.

### 4. The `orchestrate` skill

The three files of the skill are deleted. `REQUIRED_BANZAI_SKILLS` in
`src/adapters.ts` and the required list in `src/setup-client.ts` name the
ten other skills. The release validator's skill inventory, required paths
and fragment checks stop naming the skill, and `validateOrchestrateSkill`
with its diagnostic is removed. The template's Routing section, the
`initiative` skill and the contracts guide stop naming it. The control
contract code and its tests are not touched.

### 5. Documentation and manifest

Facts that become stale:

- `PROJECT_MANIFEST.md`: section 2 (what `npm run build` regenerates),
  section 3 (ownership of instruction text), section 5 (twelve skills, the
  explicit-invocation list, "standalone skills load installed sources, and
  runners deliver applicable bodies inline", hook and release owners),
  section 8 (instruction parity), section 10 (ADR-0070 row).
- `README.md`, `packages/orchestrator/README.md`,
  `packages/orchestrator/MODULES.md`, `documentation/orchestrator.md`,
  `documentation/getting-started.md`,
  `documentation/engineering-quality.md`, `CONTRIBUTING.md`: the skill count,
  the supervisor skill, the build and baseline description.
- `documentation/decisions/README.md` row for ADR-0070 and the ADR's
  implementation-state line.

## Implementation Tasks

- [ ] **T001 - Successor baseline and closed v1 baseline**

  Behavior: FR6–FR14.

  Files: a new script module for the successor baseline under
  `packages/orchestrator/scripts/`,
  `packages/orchestrator/scripts/phase-resources-build.mjs` and its
  declaration file, a declaration file for the new module,
  `packages/orchestrator/scripts/instruction-baseline.mjs`,
  `packages/orchestrator/scripts/check-release.mjs`,
  `packages/orchestrator/test/committed-smoke.test.ts` if the new module
  joins the import graph of a script that test copies,
  `packages/orchestrator/instruction-baseline.json`,
  `packages/orchestrator/instruction-baseline.sha256`, `release-policy.json`,
  `packages/orchestrator/test/release-validation.test.ts`.

  Unchanged paths: `packages/orchestrator/phase-guidance-baseline.json`,
  `packages/orchestrator/phase-guidance-current.json`,
  `packages/orchestrator/phase-guidance-current.sha256`.

  Binding constraints:

  - The five invariants of Technical Breakdown section 1 hold.
  - The successor file has schema `banzai-instruction-baseline/v2`,
    `schemaVersion: 2`, the 28 keys of section 1, an `origin` field with
    the first generation's authorities and an ordered transition chain. Its
    first generation cites ADR-0070.
  - The tool's initializing form writes the first generation under the same
    authority rules and is refused once the file holds a transition.
  - A successor transition may change any key. It is refused without an
    Accepted authority, with a wrong predecessor digest, with an unchanged
    value, or with keys out of order.
  - Release validation fails with `INSTRUCTION_RESOURCE_DRIFT` when a v1 file
    differs from its pinned digest, when a successor expectation differs
    from current bytes, and when the successor file differs from its sibling
    digest.
  - The v1 validation keeps the root pin, the chain replay and the authority
    check. It reads no file under `plugins/banzai/`.
  - The existing tests that pin exact lifecycle annotations on authority
    ADRs pass unchanged.
  - The tool's describing, checking and publishing forms operate on the
    successor. No form writes the v1 files.

  Depends on: none. Maps to: FR6–FR14, AC4–AC7; ADR-0070 section 3 and
  compliance items 3, 4 and 5.

  Evidence: release-validation tests for each refusal above; for a valid
  transition that changes `hooks/hooks.json` and the Codex manifest under
  Accepted ADR-0069; for a v1 byte change; and for a changed plugin skill
  section that the v1 baseline pinned, which must pass.

  Review batch: A.

- [ ] **T002 - Frozen instruction module**

  Behavior: FR1–FR5.

  Files: `packages/orchestrator/scripts/phase-resources-build.mjs`,
  `packages/orchestrator/scripts/build.mjs`,
  `packages/orchestrator/scripts/check-dist.mjs`,
  `packages/orchestrator/scripts/publication-check.mjs`,
  `packages/orchestrator/scripts/publication-release.mjs`,
  `packages/orchestrator/test/release-validation.test.ts`,
  `packages/orchestrator/test/publication.test.ts`,
  `packages/orchestrator/test/phase-instructions.test.ts`.

  Unchanged paths: every text entry and `PHASE_RESOURCE_DEFINITIONS` of
  `packages/orchestrator/src/phase-resources.ts`; `plugins/banzai/phases/`,
  `plugins/banzai/guidance/`, `plugins/banzai/policies/`.

  Binding constraints:

  - The build writes the two hook digests and preserves every other byte of
    the module. No script reads a plugin phase document, guidance file or
    policy to write or to check an orchestrator source.
  - `build:check` fails on a stale hook digest with the existing message and
    passes when plugin text differs from the module.
  - The publication check keeps: archived module keys equal the embedded id
    list, each text matches its digest, and module, bundle and source map
    describe one candidate. It drops the comparison with plugin files.
  - Both tests that tie embedded text to plugin files, the comparison of
    every entry and the one that reads `guidance/code-design.md`, are
    replaced by tests that each text entry matches its own digest and the
    successor baseline.
  - The module's header comment states that the text is frozen and which
    entries the build still writes. No other byte of the module changes.
  - `PHASE_RESOURCE_DEFINITIONS` in the module is the authoritative phase
    table. A script constant that repeats it is removed or checked equal.
  - Prompt tests and the tests of delivered text and phase order pass with
    no changed expectation.

  Depends on: T001. Maps to: FR1–FR5, AC1–AC3, AC14; ADR-0070 sections 1
  and 5 and compliance items 1, 2, 7 and 11.

  Evidence: a build test with a changed plugin policy and a changed plugin
  hook script; the publication tests; the unchanged prompt tests; a
  byte comparison of the module's text entries with commit `fa89da9`, and
  with the plugin's files at that commit, recorded in the implementation
  report.

  Review batch: A.

- [ ] **T003 - Hook-only parity**

  Behavior: FR15–FR19.

  Files: `packages/orchestrator/src/phase-instructions.ts`,
  `packages/orchestrator/src/doctor.ts` where its check needs it,
  `packages/orchestrator/test/phase-instructions.test.ts`,
  `packages/orchestrator/test/workflow-project.test.ts`,
  `packages/orchestrator/test/doctor.test.ts`.

  Binding constraints:

  - Parity compares `hooks/hooks.json` and `hooks/spec-gate.cjs` only, for
    every Claude role and phase set.
  - `instructionResourceIds`, its unknown-phase guard and the order of
    delivered text are unchanged.
  - The states `verified`, `mismatch`, `bounded_failure`, `unverifiable` and
    `not_applicable` keep their meaning. `InstructionResourceMismatchError`,
    its code and every message keep their wording.
  - The existing tests that expected a mismatch from an edited phase
    document or guidance file now assert `verified` for that edit and a
    mismatch for an edited hook script. No test is deleted without such a
    replacement.

  Depends on: T002. Maps to: FR15–FR19, AC8, AC9; ADR-0070 section 4 and
  compliance item 6.

  Evidence: the parity, workflow and doctor tests named above.

  Review batch: B.

- [ ] **T004 - Remove the orchestrate skill**

  Behavior: FR20–FR25.

  Files: `plugins/banzai/skills/orchestrate/` (deleted),
  `plugins/banzai/AGENTS.md`, `plugins/banzai/skills/initiative/SKILL.md`,
  `plugins/banzai/contracts/README.md`,
  `packages/orchestrator/src/adapters.ts`,
  `packages/orchestrator/src/setup-client.ts`,
  `packages/orchestrator/scripts/check-release.mjs`,
  `packages/orchestrator/scripts/phase-resources-build.mjs`,
  `release-policy.json`, `publication-policy.json`, and the tests
  `adapters.test.ts`, `setup-client.test.ts`, `release-validation.test.ts`,
  `workflow-skills.test.ts`, `project-adoption.test.ts`,
  `instruction-layouts.test.ts` with the fixtures under
  `packages/orchestrator/test/fixtures/instruction-layouts/` that must equal
  the template.

  Unchanged paths: `packages/orchestrator/src/agent-control.ts`,
  `packages/orchestrator/src/agent-control-cli.ts`,
  `plugins/banzai/contracts/contract.json` and every schema under
  `plugins/banzai/contracts/`, `plugins/banzai/hooks/`.

  Binding constraints:

  - The runner's structural check and the setup check require the ten other
    skills and accept a plugin with or without `orchestrate`.
  - `validateOrchestrateSkill` and `ORCHESTRATE_SKILL_POLICY_DRIFT` are
    removed with their tests. Every other fragment check keeps its
    assertions, edited only where it named the skill or pinned an assertion
    about it. The release validator's pin of the fragments
    `assertSupervisorSafety` and `May choose and rewrite` in
    `workflow-skills.test.ts` is such a pin and is removed with those
    assertions.
  - The template's Routing section loses the paragraph about `orchestrate`
    and nothing else. Its fourteen headings and its Policies section keep
    their bytes.
  - A fixture that represents a project's file from before this change keeps
    its bytes; only a fixture that must equal the current template changes.
  - Control capability, status and decision tests pass with no changed
    expectation.

  Depends on: T001. Maps to: FR20–FR25, AC10–AC12; ADR-0070 sections 7 and 8
  and compliance items 9 and 12.

  Evidence: adapter and setup tests for a plugin with and without the skill;
  the release validation and publication tests; the unchanged control tests;
  a search of `plugins/banzai/` for the skill's name recorded in the
  implementation report.

  Review batch: B.

- [ ] **T005 - Decoupling proof for plugin text**

  Behavior: FR26–FR28.

  Files: `packages/orchestrator/scripts/check-release.mjs` and
  `packages/orchestrator/scripts/phase-resources-build.mjs` where a
  comparison of runner text with plugin files remains, `release-policy.json`,
  `packages/orchestrator/test/release-validation.test.ts`.

  Binding constraints:

  - No check compares a plugin phase document, guidance file or policy with
    runner instruction text, and no check requires the plugin's `phases/`
    and `guidance/` directory listings or a policy's `- Runner consumers:`
    line. `release-policy.json` no longer lists the seven phase documents
    as required paths.
  - A check on standalone text reads the guidance a skill links by its path
    in the plugin, not through the frozen phase table, so a skill may link a
    guidance file the runner never embedded.
  - Every check on standalone text keeps its assertions: the instruction
    layout, the six policy checks, the code-design check and the
    `initiative` skill check.
  - One test edits a sentence of a plugin skill, of a guidance file and of a
    policy that no check names, and removes one plugin phase document, and
    shows that release validation and the build check still pass. One test
    removes a fragment a remaining check requires and shows that check
    fails.

  Depends on: T001, T002, T004. Maps to: FR26–FR28, AC13; ADR-0070 section 6
  and compliance item 2.

  Evidence: the two tests above.

  Review batch: C.

- [ ] **T006 - Documentation, manifest and final checks**

  Behavior: FR29 and the package report.

  Files: `PROJECT_MANIFEST.md`, `README.md`,
  `packages/orchestrator/README.md`, `packages/orchestrator/MODULES.md`,
  `documentation/orchestrator.md`, `documentation/getting-started.md`,
  `documentation/engineering-quality.md`, `CONTRIBUTING.md`,
  `documentation/decisions/0070-orchestrator-owned-instruction-copy.md` (the
  implementation-state line only), `documentation/decisions/README.md` (the
  ADR-0070 row only), `packages/orchestrator/instruction-baseline.json` and
  its sibling digest (re-recorded once, see below), and the
  implementation-report and test-report roles of this work.

  Binding constraints, in this order:

  1. Run the focused tests of T001–T005.
  2. Update each stale fact listed in Technical Breakdown section 5. The
     manifest stays current-state only. Sentences that carry a fragment the
     release validator pins, such as the control contract version in
     `README.md`, keep that fragment.
  3. Set ADR-0070's implementation-state line and its index row to
     implemented, with the date and a link to this work's implementation
     report. Change no other byte of the ADR.
  4. Write the successor baseline's first generation again with the tool's
     initializing form, so its authority digest names ADR-0070's final bytes.
     After this step no byte of ADR-0070 changes in this package.
  5. Run `npm run build`, then the mandatory checks below, and fix every
     failure this package causes.
  6. Run no live vendor probe.

  The implementation report lists what changed and where, the tests added,
  the byte comparison of T002, the search of T004, deviations and the owner
  follow-ups of Human prerequisites. The test report follows the Test
  Assurance policy.

  Depends on: T001–T005. Maps to: FR29, AC15; ADR-0070 required follow-ups.

  Evidence: the mandatory checks below.

  Review batch: C.

## Task Verification Obligations

The checks use the documented commands of `package.json` (manifest sections
2 and 8). `npm run build:dist` builds the ignored distribution that the
tests and the build check need. `npm run verify` is the required final
suite: typecheck, lint, every test and the build check.
`npm run format:check` is the formatter check for the orchestrator package.
`npm run release:validate` runs the release validator, which this package
changes. All four leave tracked files unchanged. `npm run release:check` is
not mandatory here because the package is not a release.

```banzai-verification-obligations/v2
{
  "schema": "banzai-verification-obligations/v2",
  "schemaVersion": 2,
  "complete": true,
  "planRemainderSha256": "5201527ba3bcf9c1835172ce70926960b020cf39a826d4221d3f5d1984bd03e5",
  "checks": [
    {
      "id": "build-dist",
      "name": "Build the ignored distribution",
      "requirementRefs": ["T002", "T006"],
      "command": "npm",
      "args": ["run", "build:dist"],
      "cwd": ".",
      "timeoutMs": 600000,
      "evidence": "fresh",
      "sources": [
        {
          "path": "package.json",
          "sha256": "d3e1f361a726fb354f62b2c3917e63548af15825216b3ffd4297dcce20fee0f4"
        }
      ],
      "materialization": null
    },
    {
      "id": "verify",
      "name": "Typecheck, lint, tests and build check",
      "requirementRefs": [
        "T001",
        "T002",
        "T003",
        "T004",
        "T005",
        "T006",
        "AC1",
        "AC2",
        "AC3",
        "AC4",
        "AC5",
        "AC6",
        "AC7",
        "AC8",
        "AC9",
        "AC10",
        "AC11",
        "AC12",
        "AC13",
        "AC14",
        "AC15"
      ],
      "command": "npm",
      "args": ["run", "verify"],
      "cwd": ".",
      "timeoutMs": 3600000,
      "evidence": "fresh",
      "sources": [
        {
          "path": "package.json",
          "sha256": "d3e1f361a726fb354f62b2c3917e63548af15825216b3ffd4297dcce20fee0f4"
        }
      ],
      "materialization": null
    },
    {
      "id": "format-check",
      "name": "Prettier check of the orchestrator package",
      "requirementRefs": ["T006"],
      "command": "npm",
      "args": ["run", "format:check"],
      "cwd": ".",
      "timeoutMs": 600000,
      "evidence": "fresh",
      "sources": [
        {
          "path": "package.json",
          "sha256": "d3e1f361a726fb354f62b2c3917e63548af15825216b3ffd4297dcce20fee0f4"
        }
      ],
      "materialization": null
    },
    {
      "id": "release-validate",
      "name": "Release validation with the changed validator",
      "requirementRefs": ["T001", "T004", "T005", "T006", "AC4", "AC6", "AC15"],
      "command": "npm",
      "args": ["run", "release:validate"],
      "cwd": ".",
      "timeoutMs": 600000,
      "evidence": "fresh",
      "sources": [
        {
          "path": "package.json",
          "sha256": "d3e1f361a726fb354f62b2c3917e63548af15825216b3ffd4297dcce20fee0f4"
        }
      ],
      "materialization": null
    }
  ],
  "absenceReason": null
}
```

## Consistency Check

Requirements to tasks:

| Requirements | Tasks |
| ------------ | ----- |
| FR1–FR5      | T002  |
| FR6–FR14     | T001  |
| FR15–FR19    | T003  |
| FR20–FR25    | T004  |
| FR26–FR28    | T005  |
| FR29         | T006  |

Acceptance criteria to tasks: AC1–AC3 T002; AC4–AC7 T001; AC8, AC9 T003;
AC10–AC12 T004; AC13 T005; AC14 T002; AC15 T006.

ADR-0070 compliance items: 1 → T002 (byte comparison); 2 → T002, T005;
3, 4, 5 → T001; 6 → T003; 7 → T002 (unchanged prompt tests); 8 → no task:
standalone skills and the plugin's policy and guidance files are unchanged,
confirmed by the unchanged paths of T002; 9 → T004 (adapter and setup
tests); 10 → no task: the library and contracts are unchanged paths of
T004, and their tests run in `verify`; 11 → T002, T005; 12 → T004.

Other accepted constraints:

- ADR-0044: its mechanism, root and chain stay; the successor is recorded
  through the tool (T001, T006).
- ADR-0042 section 6 and ADR-0020: the structural check and parity keep
  their meaning for the hook (T003, T004).
- ADR-0018: the control contract and its tests are unchanged (T004).
- ADR-0033: no version field changes.
- ADR-0041: the removed skill's files leave `publication-policy.json`, and
  the new baseline files are classified there when the publication check
  requires it (T001, T004).
- ADR-0052 and ADR-0029: no new production module is planned; a module the
  implementation adds is registered in the import policy and verified by
  lint.

Proposed ADRs: none are unresolved; this plan creates no ADR.

Manifest transitions: ADR-0070 row `Planned` → `Implemented`; the facts of
Technical Breakdown section 5 (T006).

Security exposure of the plan itself: none applies, as the description
records. The enforcement point that remains is the hook digest comparison in
`src/phase-instructions.ts`, pinned by the successor baseline (T001, T003).

Engineering Quality constraints that apply: the structural assessment of
Technical Breakdown section 1 (owner T001, evidence its tests and lint);
compatibility of the CLI's control contract and of the runner's acceptance
of older plugins (owner T004, evidence its tests); bounded scope, with the
unchanged paths named in T001, T002 and T004.
