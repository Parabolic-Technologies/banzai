# Feature: Orchestrator-owned instruction copy (P11)

Slug: 261116-p11-orchestrator-instruction-copy

Sources: accepted
[ADR-0070](../../decisions/0070-orchestrator-owned-instruction-copy.md) with
owner choice (c), and package P11 of the
[plugin rework plan](../261116-standalone-plugin-rework/plan.md).

## Overview

The orchestrator stops taking its instruction text from the plugin. The
tracked module `packages/orchestrator/src/phase-resources.ts` becomes its own
frozen instruction set. The plugin's skills, policies, guidance and templates
become ordinary source that no orchestrator build, baseline or parity check
depends on. The hook stays shared and pinned. The `orchestrate` skill leaves
the plugin.

Primary flow: a maintainer edits a plugin skill or policy; no orchestrator
file becomes stale, no baseline transition is needed, and the full suite
still passes.

Key constraint: the text a runner phase receives does not change by one byte.
Every expectation of the runner about delivered text passes unchanged.

Non-goals:

- No change to any plugin skill, policy, guidance file or phase document
  other than what removing the `orchestrate` skill requires.
- No change to the hook script or the hook configuration.
- No change to the CLI's control contract, its capabilities or its status
  documents.
- No path-scoped test gate; that is package P12 (ADR-0071).
- No version change. The owner decides the version at release.
- No removal of the plugin's phase documents; that is later text work.

## Functional Requirements

### Frozen instruction set

- **FR1.** The 23 text entries of `EMBEDDED_PHASE_RESOURCES` (seven phase
  documents, ten guidance files, six policies) and
  `PHASE_RESOURCE_DEFINITIONS` are byte-identical to their state at commit
  `fa89da9` (2.8.3), and the text entries equal the plugin's files at that
  commit.
- **FR2.** `npm run build` writes those entries from the tracked module, not
  from files under `plugins/banzai/`. A changed, added or missing plugin
  phase document, guidance file or policy changes no tracked orchestrator
  file.
- **FR3.** `npm run build` still derives the two hook entries,
  `hooks/hooks.json` and `hooks/spec-gate.cjs`, from the plugin's hook files,
  and
  `npm run build:check` fails with its existing stale-source message when
  they differ.
- **FR4.** `npm run build:check` passes when plugin text differs from the
  module's text entries.
- **FR5.** The publication check still fails when a text entry of the built
  or archived module does not match its own recorded digest, and when the
  module, the bundle and the source map describe different entries. It no
  longer compares the module's text with plugin files.

### Closed baseline

- **FR6.** `packages/orchestrator/phase-guidance-baseline.json`,
  `phase-guidance-current.json` and `phase-guidance-current.sha256` keep
  their bytes. Release validation pins the digest of each and fails with
  `INSTRUCTION_RESOURCE_DRIFT` when one changes.
- **FR7.** Release validation no longer compares the closed baseline's
  expectations with files under `plugins/banzai/`.
- **FR8.** The rule that an ADR cited as a transition authority keeps its
  bytes, apart from the exact lifecycle annotations in the allow-list, still
  holds for every authority of the closed baseline.

### Successor baseline

- **FR9.** A successor baseline exists with schema
  `banzai-instruction-baseline/v2`. It pins, by SHA-256: each of the 23 text
  entries of the frozen module, `PHASE_RESOURCE_DEFINITIONS` as one key
  (serialized with object keys sorted recursively and array order kept),
  `plugins/banzai/hooks/spec-gate.cjs`,
  `plugins/banzai/hooks/hooks.json`, `plugins/banzai/.claude-plugin/plugin.json`
  and `plugins/banzai/.codex-plugin/plugin.json`. The two manifests are
  pinned with their `version` value excluded, as today.
- **FR10.** Its initial expectations equal the current bytes of those 28
  resources and cite ADR-0070 as authority.
- **FR11.** A pinned resource whose bytes differ from the latest expectation,
  with no recorded transition, fails release validation with
  `INSTRUCTION_RESOURCE_DRIFT`.
- **FR12.** A transition is valid only when it cites at least one decision
  record whose status is `Accepted`, under the existing authority rules for
  path, digest and scope text.
- **FR13.** A transition may change any pinned key, the hook configuration
  and either plugin manifest included. No key is protected, and no key is
  reserved to named ADRs.
- **FR14.** The baseline tool's `--describe`, `--authorization <file> --check`
  and publishing forms operate on the successor baseline. One further form
  writes the first generation with its authorities. It is refused once the
  successor holds a transition.

### Parity

- **FR15.** For a Claude role call with a resolved plugin directory, the
  runner compares only `hooks/hooks.json` and `hooks/spec-gate.cjs` with the
  embedded digests.
- **FR16.** When both hook files match, parity is `verified`, whatever the
  state of the directory's phase documents, guidance and policies: changed,
  missing or unchanged.
- **FR17.** When a hook file differs, parity is `mismatch` and the call is
  refused with `InstructionResourceMismatchError`, as today. When a hook
  file cannot be read, parity is `bounded_failure`, as today.
- **FR18.** `banzai doctor`'s `claude.instructions` check reports the same
  states under the same rule. Its messages keep their wording; the resource
  list they print holds the two hook ids.
- **FR19.** With no resolved plugin directory, and for Codex roles, parity
  behaves as today.

### The `orchestrate` skill

- **FR20.** The plugin contains no `skills/orchestrate/` directory.
- **FR21.** The runner's structural check of a plugin directory and the
  setup check accept a plugin that has the ten other skill files and no
  `orchestrate` skill. They still accept a plugin that has it.
- **FR22.** Release validation requires neither the skill's files nor any
  text of them, and has no check named `ORCHESTRATE_SKILL_POLICY_DRIFT`.
- **FR23.** No file of the plugin offers or routes to the skill: the
  `AGENTS.md` template, the `initiative` skill and the contracts guide.
- **FR24.** The CLI's control contract is unchanged: every capabilities and
  status document and every control test expectation keeps its bytes.
- **FR25.** `publication-policy.json` and `release-policy.json` name no file
  of the removed skill.

### Checks on plugin text

- **FR26.** A test or validation that compared runner instruction text with
  plugin files ends or reads the frozen module. Release validation no longer
  requires the plugin's phase documents to exist.
- **FR27.** Every other check on plugin skills, policies, guidance and
  templates keeps its current assertions, except assertions about the
  removed skill.
- **FR28.** Changing a sentence of a plugin skill, policy, guidance file or
  template that no remaining check names leaves `npm run verify` and
  `npm run release:validate` passing with no other file changed.

### Documentation

- **FR29.** `PROJECT_MANIFEST.md`, `README.md`,
  `packages/orchestrator/README.md`, `packages/orchestrator/MODULES.md`,
  `documentation/orchestrator.md`, `documentation/getting-started.md`,
  `documentation/engineering-quality.md` and `CONTRIBUTING.md` state the new
  facts: what `npm run build` regenerates,
  the frozen module, the two baselines, hook-only parity, eleven skills, and
  that plugin text needs no transition. The manifest's ADR-0070 row becomes
  `Implemented` after verification.

## User Stories & Acceptance Criteria

- **AC1 (FR1, FR2).** Given the repository at this package's result, when the
  text entries of the module are compared with commit `fa89da9` and with the
  plugin's files at that commit, then they are byte-identical. Given a changed
  plugin policy, when `npm run build` runs, then `git status` shows no changed
  orchestrator file.
- **AC2 (FR3, FR4).** Given a changed plugin guidance file, when
  `npm run build:check` runs, then it passes. Given a changed hook script
  and no rebuild, then it fails with the stale-source message.
- **AC3 (FR5).** Given an archived module whose text entry does not match
  its digest, when the publication check runs, then it fails. Given plugin
  text that differs from the module, then it passes.
- **AC4 (FR6, FR7).** Given one changed byte in a closed baseline file, when
  release validation runs, then it fails with `INSTRUCTION_RESOURCE_DRIFT`.
  Given a changed plugin skill section that the closed baseline pinned, then
  it passes.
- **AC5 (FR8).** Given a body edit to an ADR that a closed-baseline
  transition cites, when release validation runs, then it fails; given only
  an allow-listed lifecycle annotation, then it passes.
- **AC6 (FR9–FR11).** Given the successor baseline, then it lists exactly
  the 28 keys of FR9 with the current digests. Given a changed text entry of
  the module, a changed phase definition, a changed hook file or a changed
  manifest field other than
  `version`, with no transition, when release validation runs, then it
  fails with `INSTRUCTION_RESOURCE_DRIFT`. Given only a changed manifest
  `version`, then it passes.
- **AC7 (FR12–FR14).** Given a transition that changes `hooks/hooks.json`
  and the Codex manifest and cites Accepted ADR-0069, when the tool checks
  and publishes it, then it validates. Given the same transition citing a
  Proposed decision record or none, then it is refused.
- **AC8 (FR15–FR17, FR19).** Given a resolved plugin directory with an
  edited policy, a deleted phase document and unchanged hook files, when a
  Claude phase starts, then parity is `verified` and the phase runs. Given
  an edited hook script, then the call is refused with
  `InstructionResourceMismatchError`. Given an unreadable hook file, then
  parity is `bounded_failure`.
- **AC9 (FR18).** Given the same three directories, when `banzai doctor`
  runs, then `claude.instructions` reports verified, mismatch and bounded
  failure in turn, and names only hook ids.
- **AC10 (FR20–FR22, FR25).** Given the plugin without the skill, when the
  runner resolves it as a plugin directory, when setup inspects it and when
  release validation and the publication check run, then each accepts it.
  Given a plugin that still has the skill, then the runner and setup accept
  it too.
- **AC11 (FR23).** Given the plugin's files, when they are searched for the
  skill's name, then no file offers or routes to it.
- **AC12 (FR24).** Given the control tests, then they pass with no changed
  expectation.
- **AC13 (FR26–FR28).** Given an edit to one sentence of a plugin skill
  that no check names, when `npm run verify` and `npm run release:validate`
  run, then both pass and no tracked file other than that skill changed.
  Given the removal of a fragment a remaining check requires, then that
  check fails as before.
- **AC14 (FR1, key constraint).** Given the runner's prompt tests and its
  tests of delivered instruction text and phase order, then they pass with
  no changed expectation. Parity expectations change as AC8 states.
- **AC15 (FR29).** Given the updated documents, then `npm run verify` and
  `npm run release:validate` pass, including the validator's pinned
  manifest fragments.

## Platform Specifics

- Node.js `>=22.20.0 <23 || >=24.11.1 <25 || >=26.13.0 <27`, macOS or Linux.
- The plugin library stays builtin-only ESM; orchestrator code is
  TypeScript bundled by esbuild.
- New production modules are registered in the import policy.
- The hook, `plugins/banzai/lib` and `plugins/banzai/contracts` are not
  changed, so the release validator's version rule for hook changes is not
  triggered.
- UI copy, documents and reports are English.

## Security Exposure

No exposure class applies: the change makes no new access decision and adds
no input path, secret, personal data or outbound request. It narrows two
integrity checks, parity (FR15–FR17) and the structural check (FR21). The
hook, which makes the access decision for writes, stays under both the
parity comparison and the successor baseline (FR9, FR11, FR17).

## Architecture Decision Needs

None. ADR-0070 is Accepted and decides the frozen module, the closed and
successor baselines, hook-only parity, the handling of checks on plugin text
and the removal of the `orchestrate` skill.

## Resolved Assumptions

1. The successor baseline's schema identity is
   `banzai-instruction-baseline/v2`. ADR-0044 names v1 "the first versioned
   baseline format". `Sensible default`.
2. The build keeps deriving the two hook digests from the plugin's hook
   files (ADR-0070 section 5). `User-confirmed` (accepted ADR).
3. The plugin's phase documents stay in the plugin in this package. ADR-0070
   section 2 leaves their removal to text work. `User-confirmed`.
4. Plugin manifests are pinned with `version` excluded, because ADR-0033
   owns version-only changes. `Manifest convention`.
5. The pinned-authority rule for decision records applies to the closed
   baseline and to successor transitions alike. `Manifest convention`.
6. A plugin that still contains the `orchestrate` skill stays acceptable to
   the runner and to setup, so an older installed plugin keeps working.
   `Sensible default`.
7. Checks on standalone plugin text stay where they are today. Moving them
   so that a text change stays in the plugin scope belongs to P12.
   `Sensible default`.
8. No version change in this package; the owner decides it at release, as
   decided for the 2.8–2.9 program on 2026-10-31. `Manifest convention`.
9. CLIs already published are not changed. With a resolved plugin directory
   they still compare text and still require the `orchestrate` skill
   (ADR-0070, Risks). `User-confirmed`.

## Open Questions & Risks

None outstanding.
