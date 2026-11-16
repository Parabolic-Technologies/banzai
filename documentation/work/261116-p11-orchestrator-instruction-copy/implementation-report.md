# Implementation report: Orchestrator-owned instruction copy (P11)

- Slug: `261116-p11-orchestrator-instruction-copy`
- Requirements: [description.md](./description.md)
- Plan: [plan.md](./plan.md), approved by the owner in chat on 2026-11-16
  with `Approve plan`
- Decision:
  [ADR-0070](../../decisions/0070-orchestrator-owned-instruction-copy.md)
- Date: 2026-11-16
- Mode: standalone. Each plan task was implemented by a separate agent with a
  fresh context and then checked by the session that owns this report.

## What changed

### Created

- `packages/orchestrator/instruction-baseline.json` and
  `packages/orchestrator/instruction-baseline.sha256`: the successor
  baseline, 28 keys, schema `banzai-instruction-baseline/v2`.
- `packages/orchestrator/scripts/successor-baseline.mjs` and its
  `.d.mts`: validation, transition and initialization of the successor
  baseline. A digest constant in this module fixes the first generation
  (review 1, F1).

### Modified

- `packages/orchestrator/scripts/phase-resources-build.mjs` and its `.d.mts`:
  the build writes only the two hook digests into the tracked module; the v1
  baseline is validated as a closed record (`validateClosedGuidanceBaseline`);
  the comparisons with plugin text, the directory-listing check and the
  `Runner consumers` check are removed.
- `packages/orchestrator/scripts/instruction-baseline.mjs`: the tool serves
  the successor baseline and gains `--initialize <json-file> [--check]`.
- `packages/orchestrator/scripts/check-release.mjs`: validates both
  baselines; loses `validateOrchestrateSkill`, its diagnostic
  `ORCHESTRATE_SKILL_POLICY_DRIFT` and the pins on the removed skill; reads
  guidance a skill links by its plugin path.
- `packages/orchestrator/src/phase-resources.ts`: the two-line header
  comment only.
- `packages/orchestrator/src/phase-instructions.ts`: parity compares the two
  hook ids.
- `packages/orchestrator/src/adapters.ts` and
  `packages/orchestrator/src/setup-client.ts`: ten required skills.
- `release-policy.json`: the two `orchestrate` paths and the seven phase
  documents leave the required paths.
- `publication-policy.json`: the three `orchestrate` entries are removed.
- `plugins/banzai/AGENTS.md`, `plugins/banzai/skills/initiative/SKILL.md`,
  `plugins/banzai/contracts/README.md`: they stop naming the skill.
- Tests: `release-validation.test.ts`, `phase-instructions.test.ts`,
  `publication.test.ts`, `workflow-project.test.ts`, `doctor.test.ts`,
  `adapters.test.ts`, `setup-client.test.ts`, `workflow-skills.test.ts`,
  `project-adoption.test.ts`, the shared fixture
  `test/phase-instruction-fixtures.ts` (review 1, F2) and the fixture
  `test/fixtures/instruction-layouts/fresh-adoption/after/AGENTS.md`.
- Documents: see [Documentation](#documentation).
- `documentation/decisions/0070-orchestrator-owned-instruction-copy.md` (the
  implementation-state line) and `documentation/decisions/README.md` (the
  ADR-0070 row).

### Deleted

- `plugins/banzai/skills/orchestrate/` (`SKILL.md`, `agents/openai.yaml`,
  `references/control-protocol.md`).

### Unchanged by design

- The three v1 baseline files, every other byte of
  `src/phase-resources.ts`, `test/prompts.test.ts`,
  `src/agent-control.ts`, `src/agent-control-cli.ts`, the control tests,
  `plugins/banzai/hooks/`, `plugins/banzai/lib/`, both plugin manifests,
  `plugins/banzai/contracts/contract.json` and its schemas, every plugin
  policy, guidance file and phase document, and every version field.

## Requirement trace

| Requirements | Acceptance | Task | Evidence                                                                                                                                                                     |
| ------------ | ---------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR1–FR5      | AC1–AC3    | T002 | [Byte comparison](#byte-comparison-of-the-frozen-module); frozen-module and hook-digest tests in `release-validation.test.ts`; internal comparisons in `publication.test.ts` |
| FR1          | AC14       | T002 | `prompts.test.ts` passes with no edit                                                                                                                                        |
| FR6–FR8      | AC4, AC5   | T001 | closed-baseline tests and the two lifecycle-annotation tests in `release-validation.test.ts`                                                                                 |
| FR9–FR14     | AC6, AC7   | T001 | the successor-baseline tests in `release-validation.test.ts`                                                                                                                 |
| FR15–FR19    | AC8, AC9   | T003 | parity tests in `phase-instructions.test.ts`, `workflow-project.test.ts` and `doctor.test.ts`                                                                                |
| FR20–FR25    | AC10–AC12  | T004 | `adapters.test.ts`, `setup-client.test.ts`, `workflow-skills.test.ts`; [search for the skill's name](#search-for-the-removed-skill); unedited control tests                  |
| FR26–FR28    | AC13       | T005 | two decoupling tests in `release-validation.test.ts`                                                                                                                         |
| FR29         | AC15       | T006 | [Documentation](#documentation); [Checks](#checks)                                                                                                                           |

### Byte comparison of the frozen module

Run after T002 with a script outside the repository:

- `src/phase-resources.ts` differs from commit `fa89da9` (release 2.8.3)
  in its two header comment lines and nowhere else.
- All 23 text entries are byte-identical to the module at `fa89da9` and to
  the plugin files at `fa89da9` they were generated from. Each entry's
  recorded digest equals the SHA-256 of its text.
- The two hook entries equal the SHA-256 of the current
  `plugins/banzai/hooks/hooks.json` and `plugins/banzai/hooks/spec-gate.cjs`.

### Search for the removed skill

`grep -rnw "orchestrate" plugins/banzai/` returns no line. The 58 lines that
`grep -rn "orchestrate" plugins/banzai/` returns all carry the word
`orchestrated` (an orchestrated run, mode or review). The test
`no plugin file holds, offers or routes to an orchestrate skill` keeps this
true.

## ADR conformance

ADR-0070 compliance items:

| Item | Evidence                                                                                                       |
| ---- | -------------------------------------------------------------------------------------------------------------- |
| 1    | byte comparison above                                                                                          |
| 2    | `a changed plugin policy changes no orchestrator file…` and the two decoupling tests                           |
| 3–5  | closed-baseline and successor-baseline tests; the validator pins the three v1 files by digest                  |
| 6    | parity tests                                                                                                   |
| 7    | `prompts.test.ts` unedited                                                                                     |
| 8    | no plugin policy, guidance file or standalone skill other than the three files of T004 changed                 |
| 9    | adapter and setup tests for a plugin with and without the skill                                                |
| 10   | `plugins/banzai/lib/` and the contracts are unchanged; their tests run in `verify`                             |
| 11   | the build and the release validator read only hook files, manifests and standalone-text checks from the plugin |
| 12   | the skill directory is deleted; `release validation accepts the plugin without the orchestrate skill`          |

Other accepted constraints:

- ADR-0044: the root, the chain and the transition mechanism are kept. The
  successor baseline was written through the tool's initializing form and
  names ADR-0070's final bytes
  (`17adcdd615e37d45bc57eca9be277edf841e4d7b7851f4f63ac3bde1b5d5bb50`) as its
  origin authority.
- ADR-0018: the control contract code and tests are unchanged.
- ADR-0033: no version field changed.
- ADR-0041: the removed files left `publication-policy.json`.
- ADR-0052 and ADR-0029: no production module was added; the new module is
  a build script.

## Tests

Added:

- `release-validation.test.ts`
  - `successor baseline pins exactly its 28 resources and rejects each
unrecorded change`
  - `release validation rejects a changed pinned resource, sibling digest or
closed baseline byte`
  - `successor baseline admits a hook configuration and manifest transition
only under an Accepted authority`
  - `successor chain replay refuses an unaccepted authority, a wrong
predecessor, an unchanged value and unordered keys`
  - `closed chain keeps its key protections and its files stay pinned by the
validator`
  - `closed baseline replay reads no plugin file`
  - `a changed plugin policy changes no orchestrator file while a changed
hook script is stale until rebuilt`
  - `release validation accepts a changed plugin skill section that the
closed baseline pinned`
  - `release validation accepts the plugin without the orchestrate skill`
  - `release validation and the build check pass after edits to plugin text
that no check names and a removed phase document`
  - `a standalone text check fails without its fragment and reads linked
guidance by its plugin path`
  - `release validation rejects a first generation written again over a
changed text entry while the chain is empty` (review 1, F1)
  - `release validation rejects a first generation written after a recorded
chain was dropped` (review 1, F1)
- `phase-instructions.test.ts`
  - `parity names the two hook ids for every role and phase set and leaves
delivered resource ids alone`
- `workflow-skills.test.ts`
  - `no plugin file holds, offers or routes to an orchestrate skill`

Adapted, with the guarantee each now protects:

- Frozen module and hook digests (`release-validation.test.ts`,
  `phase-instructions.test.ts`, `publication.test.ts`): a stale hook digest,
  a missing module and a module whose text entry does not match its digest
  are refused.
- Parity (`phase-instructions.test.ts`, `workflow-project.test.ts`,
  `doctor.test.ts`): installed text is ignored, a skewed hook file is
  refused before any model starts, and `doctor` reports it.
- Skill set (`adapters.test.ts`, `setup-client.test.ts`): a plugin with or
  without `orchestrate` is accepted, a plugin missing one of the ten skills
  is refused.

Removed with the behavior they pinned: the tests of the v1 baseline's
evolution and of its comparison with plugin files, the twenty-case loop
`release validation protects orchestration policy in …`, the supervisor
assertions of `workflow-skills.test.ts` and two assertions of
`project-adoption.test.ts` that read the removed control-protocol
reference. The control contract decoder stays covered by the unedited
`agent-control.test.ts` and `agent-control-cli.test.ts`.

## Documentation

- `PROJECT_MANIFEST.md`: section 2 (what `npm run build` and `build:check`
  do), section 3 (ownership of the runner's instruction text and of the
  shared hook, library and contracts), section 5 (hook-only parity, the
  frozen module, eleven skills of which the runner and setup require ten,
  the two baselines), section 8 (installed hook parity and the instruction
  baselines), section 10 (when a rebuild is needed; ADR-0070 row
  `Implemented`).
- `README.md` and `packages/orchestrator/README.md`: the sentence on the
  supervisor skill now points to the `banzai control` interface and says
  the plugin packages no supervisor skill. The pinned control contract
  version stays.
- `packages/orchestrator/MODULES.md`: the frozen module, hook-only parity,
  what the release validator and `build.mjs` do, and the section on the
  instruction module, baselines and parity.
- `documentation/orchestrator.md`: ten required skills, hook-only parity,
  what the build writes, the two baselines.
- `documentation/getting-started.md`: the `initiative` skill never invokes
  the `banzai` CLI.
- `documentation/engineering-quality.md`: runner phases receive the policy
  from the frozen module; the section on the maintained instruction
  baselines.
- `CONTRIBUTING.md`: a subsection on plugin text and the runner's
  instruction copy.

No guide carries a note for users of a published CLI 2.8.x; that text is an
owner decision (see [Follow-ups](#follow-ups-for-the-owner)).

Stale text found and left, because it is outside this package's scope:

- The `- Runner consumers:` and `- Delivery:` header lines of the six plugin
  policies and the `## Orchestrated Mode` sections of eight plugin skills
  describe delivery to runner phases. They are ordinary plugin text now and
  belong to the rework packages that rewrite the skills.
- `scripts/phase-resources-build.mjs` reports a stale hook digest as
  "Generated src/phase-resources.ts is missing or stale", and
  `src/phase-instructions.ts` tells the reader of an invalid embedded phase
  to run `npm run build`. AC2 expects the first message as it is, and the
  plan keeps the wording of parity and phase messages unchanged.
- `documentation/ideas/2026-09-18-composable-code-design-skill.md` names the
  removed skill in a dated idea document.

## Checks

Run on 2026-11-16 on the final tree after the fixes for reviews 1 and 2,
in this order. `npm run build` ran before the last test-only fix and
changed no tracked file (`git status` and `git diff` compared before and
after).

| Check id           | Command                    | Result                                                               |
| ------------------ | -------------------------- | -------------------------------------------------------------------- |
| `build-dist`       | `npm run build:dist`       | passed                                                               |
| `verify`           | `npm run verify`           | passed: typecheck; lint 0 errors, 424 warnings; 2183 tests, 0 failed |
| `format-check`     | `npm run format:check`     | passed                                                               |
| `release-validate` | `npm run release:validate` | passed: `release validation passed`                                  |

Historical, before the fixes for review 1: the same four checks passed on
the tree the review read, with 2181 tests. The two tests of F1 account for
the difference.

Historical, before this package: the suite had 2191 tests and lint reported
427 warnings. The count fell because the twenty-case loop on the removed
skill and the v1 evolution tests left, and fifteen tests came in.

Focused runs after each task, by the owning session (historical, before
the fixes for review 1; the fix runs are in the
[change report](./change-report.md)):

| After | Test files                                                                                                                                          | Result     |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| T001  | `release-validation`, `publication`                                                                                                                 | 215 passed |
| T002  | `phase-instructions`, `prompts`, `release-validation`, `publication`                                                                                | 257 passed |
| T003  | `phase-instructions`, `prompts`, `workflow-project`, `doctor`                                                                                       | 170 passed |
| T004  | `adapters`, `setup-client`, `release-validation`, `workflow-skills`, `project-adoption`, `instruction-layouts`, `publication`, both `agent-control` | 370 passed |
| T005  | `release-validation`, `publication`, `phase-instructions`, `workflow-skills`, `instruction-layouts`, `project-adoption`                             | 265 passed |

`npm run release:check` was not run; the plan does not require it for this
package. No live vendor probe ran.

## Structural assessment

Trigger and plan record: plan section 1, "Baselines".

- Disposition as planned: the successor baseline lives in its own script
  module, `scripts/successor-baseline.mjs`. The v1 code in
  `scripts/phase-resources-build.mjs` is reduced to the replay of the closed
  record.
- Dependency direction as planned: the successor module imports the digest,
  authority and module-parsing owners from the generator module. The
  generator does not import the successor module.
- Invariants 1–5 hold: one authority validation and one transition step
  serve both baselines; the v1 key protections are reachable from the v1
  chain only; the successor's expectations are compared with current bytes
  on every release validation; the three v1 files are pinned by digest
  constants; only the tool's initializing and publishing forms write the
  successor file.
- Verified by the T001 tests and by lint, which reports no error.
- Remaining debt: the v1 replay code stays for the closed record.

## Deviations from the plan

1. T002 moved the parser of the tracked module from the successor module
   (written in T001) into the generator module and changed
   `successor-baseline.mjs` and `phase-resources-build.d.mts`, which T002
   does not list. Reason: one parser instead of two copies; the planned
   dependency direction is kept.
2. T004 lists `scripts/phase-resources-build.mjs` and
   `test/instruction-layouts.test.ts`; neither needed a change. The two
   remaining mentions of the skill in the generator module are key rules of
   the closed v1 chain. The chain holds six transitions on the key
   `plugins/banzai/skills/orchestrate/SKILL.md`, so removing the rules would
   break its replay. They read no plugin file.
3. T004 removed the contracts guide's sentence that linked the skill's
   control-protocol reference instead of pointing it elsewhere: the plugin
   has no other document on that protocol.
4. T005 renamed `validateGuidanceExtraction` to the existing
   `validateClosedGuidanceBaseline` in 51 test calls. The assertions of
   those tests, including the two lifecycle-annotation tests that T001 keeps
   "unchanged", did not change. `phase-resources-build.d.mts` changed with
   the removed exports although T005 does not list it.
5. T005 moved `instructionConsumerText` into `check-release.mjs` instead of
   changing it in place, so the generator module reads only hook files from
   the plugin. A skill link to a missing guidance file now reports
   `MISSING_RELEASE_FILE` with the path instead of
   `RELEASE_VALIDATION_FAILED`.
6. The plan's task checkboxes stay unchecked: the plan's digest covers
   them. The table below is the completion record.

7. The four mandatory checks were run directly with the commands of the
   plan's inventory, not through the standalone verification helper
   (`plugins/banzai/scripts/verification.cjs`). The helper therefore holds
   no machine evidence for them; the results in [Checks](#checks) are this
   report's record (review 1, F3).

None of these changes an approved requirement, an acceptance criterion or
the scope.

No functional gap and no scope expansion.

## Engineering Quality deviations

None.

## Notes for assurance

- The tool's `--initialize` form writes only the first generation that the
  digest constant fixes, for example after the file was deleted. Its
  `--check` form is a dry run: it prints `"changed": true` and the digest it
  would write, also when the file already holds those bytes.
- `publication-policy.json` still classifies the seven plugin phase
  documents. This package removes none of them, and no test runs the
  publication check with a removed phase document.
- ADR-0044 names `validateGuidanceExtraction` at two places. The function
  is gone; the ADR body is immutable and stays as the record of its time.
- A published CLI 2.8.x with a configured plugin directory still compares
  text and still requires the removed skill. It refuses a plugin built from
  this state.
- No live vendor probe ran.

## Follow-ups for the owner

- Commit by hand.
- Decide the version at release. No hook file and no file under
  `plugins/banzai/lib` changed, so the release validator's version rule is
  not triggered by this package.
- Decide what users of a published CLI 2.8.x with a configured plugin
  directory are told (open item of the rework plan).

## Plan Task Completion

Format: `banzai-plan-task-completion/v1`

| Task | Status    | Evidence                                                                                                                                                                                                                                                                                                                                                                                     | Gap or deviation |
| ---- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| T001 | completed | [{"path":"packages/orchestrator/scripts/successor-baseline.mjs","detail":"Successor baseline validation, transition and initialization."},{"path":"packages/orchestrator/instruction-baseline.json","detail":"28 keys, predecessor digest and origin authority ADR-0070."},{"path":"packages/orchestrator/test/release-validation.test.ts","detail":"Successor and closed-baseline tests."}] | null             |
| T002 | completed | [{"path":"packages/orchestrator/scripts/phase-resources-build.mjs","detail":"Build writes only the two hook digests into the tracked module."},{"path":"packages/orchestrator/src/phase-resources.ts","detail":"Header comment only; text entries byte-identical to fa89da9."}]                                                                                                              | null             |
| T003 | completed | [{"path":"packages/orchestrator/src/phase-instructions.ts","detail":"Parity takes its ids from the hook id list."},{"path":"packages/orchestrator/test/phase-instructions.test.ts","detail":"Hook-only parity tests."}]                                                                                                                                                                      | null             |
| T004 | completed | [{"path":"packages/orchestrator/src/adapters.ts","detail":"Ten required skills."},{"path":"packages/orchestrator/src/setup-client.ts","detail":"Ten required skills."},{"path":"packages/orchestrator/test/workflow-skills.test.ts","detail":"No plugin file names the removed skill."}]                                                                                                     | null             |
| T005 | completed | [{"path":"packages/orchestrator/scripts/check-release.mjs","detail":"No comparison of plugin text with runner text; guidance read by plugin path."},{"path":"release-policy.json","detail":"Seven phase documents left the required paths."}]                                                                                                                                                | null             |
| T006 | completed | [{"path":"PROJECT_MANIFEST.md","detail":"Stale facts updated; ADR-0070 row Implemented."},{"path":"documentation/work/261116-p11-orchestrator-instruction-copy/implementation-report.md","detail":"Checks section: results of the four mandatory checks."}]                                                                                                                                  | null             |
