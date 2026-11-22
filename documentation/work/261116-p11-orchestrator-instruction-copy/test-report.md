# Test report: Orchestrator-owned instruction copy (P11)

- Slug: `261116-p11-orchestrator-instruction-copy`
- Requirements: [description.md](./description.md)
- Plan: [plan.md](./plan.md)
- Implementation: [implementation-report.md](./implementation-report.md)
- Decision:
  [ADR-0070](../../decisions/0070-orchestrator-owned-instruction-copy.md),
  Accepted
- Date: 2026-11-16

## Framework, layout and doubles

Node's built-in test runner through
`packages/orchestrator/scripts/test.mjs`, test files under
`packages/orchestrator/test/`. No test dependency, framework or runner was
added.

The release-validation tests copy the files they need into a temporary
root, edit the copy and run the real validator, build check or baseline
tool on it. They mock no unit under test. The workflow and `doctor` tests
keep their existing fake vendor CLIs and a temporary plugin directory.

## Commands and outcomes

Final suite, run on 2026-11-16 on the final tree after the fixes for
reviews 1 and 2:

| Command                    | Outcome                                                              |
| -------------------------- | -------------------------------------------------------------------- |
| `npm run build:dist`       | passed                                                               |
| `npm run verify`           | passed: typecheck; lint 0 errors, 424 warnings; 2183 tests, 0 failed |
| `npm run format:check`     | passed                                                               |
| `npm run release:validate` | passed                                                               |

These are the four mandatory checks of the plan. They were executed
directly with the commands of the plan's inventory; the standalone
verification helper was not used, so no machine evidence record exists for
them.

Focused runs with
`node packages/orchestrator/scripts/test.mjs --file <name>.test.ts` after
each task are listed in the implementation report; each passed.

The whole suite also passes on a copy of the tree without
`plugins/banzai/phases/`: 2183 tests, 0 failed.

Historical, before the fixes for review 1: the same four checks passed with
2181 tests.

Not run: `npm run release:check` (not required for this package), live
vendor probes, and a run of the new tests against the code before the
change. That each new test fails without its production change is by
reading, except where a mutation run shows it: review 1 ran four mutations
on a copy, and the fix for F1 ran one (see the
[change report](./change-report.md)).

## Files changed

- Added: none. All new tests live in existing files.
- Changed: `release-validation.test.ts`, `phase-instructions.test.ts`,
  `publication.test.ts`, `workflow-project.test.ts`, `doctor.test.ts`,
  `adapters.test.ts`, `setup-client.test.ts`, `workflow-skills.test.ts`,
  `project-adoption.test.ts`, the shared installed-plugin fixture
  `phase-instruction-fixtures.ts`, and the fixture
  `fixtures/instruction-layouts/fresh-adoption/after/AGENTS.md`.
- Unchanged on purpose: `prompts.test.ts`, `agent-control.test.ts`,
  `agent-control-cli.test.ts`, `instruction-layouts.test.ts`.

## Risk and Contract Assurance Map

| Guarantee                                                                                                  | Risk when it breaks                                                                                       | Level                                      | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Deferred owner                                |
| ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------- |
| The runner's instruction text is the text of release 2.8.3 (FR1, AC1, AC14)                                | runner phases get different instructions without a decision                                               | script comparison plus existing unit tests | byte comparison recorded in the implementation report; `prompts.test.ts` unedited; `embedded phase bodies match their own digests and the successor baseline…`                                                                                                                                                                                                                                                                                                                                                                       | none                                          |
| The build writes only the two hook digests (FR2–FR4, AC2)                                                  | a plugin text edit changes the runner, or a hook edit ships with a stale digest                           | integration on a copied tree               | `frozen phase resources follow the hook files only…`; `a changed plugin policy changes no orchestrator file while a changed hook script is stale until rebuilt`; `hook digest generation rejects absent invalid and escaping hook input…`                                                                                                                                                                                                                                                                                            | none                                          |
| The publication check keeps its internal comparisons (FR5, AC3)                                            | a tampered archive is published                                                                           | integration                                | adapted `publication.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | none                                          |
| The v1 baseline is a closed record (FR6–FR8, AC4, AC5)                                                     | history of authorized instruction changes is rewritten                                                    | integration                                | `release validation rejects a changed pinned resource, sibling digest or closed baseline byte`; `closed chain keeps its key protections…`; `closed baseline replay reads no plugin file`; the two lifecycle-annotation tests for ADR-0062 and ADR-0044                                                                                                                                                                                                                                                                               | none                                          |
| The successor baseline pins 28 resources and changes only by an authorized transition (FR9–FR14, AC6, AC7) | the frozen text, the hook or a manifest changes without an Accepted decision                              | integration, including the tool            | `successor baseline pins exactly its 28 resources and rejects each unrecorded change`; `successor baseline admits a hook configuration and manifest transition only under an Accepted authority`; `successor chain replay refuses an unaccepted authority, a wrong predecessor, an unchanged value and unordered keys`; `release validation rejects a first generation written again over a changed text entry while the chain is empty`; `release validation rejects a first generation written after a recorded chain was dropped` | none                                          |
| Parity compares the hook only and still refuses a skewed hook (FR15–FR19, AC8, AC9)                        | a run starts with a hook that differs from the runner's expectation, or a harmless text edit blocks a run | unit and workflow integration              | `installed parity compares hook identities only…`; `parity names the two hook ids for every role and phase set…`; the two instruction-preflight tests and the per-call and late-skew tests of `workflow-project.test.ts`; `doctor v4 compares mixed role unions…`                                                                                                                                                                                                                                                                    | none                                          |
| The plugin works without `orchestrate` and no file routes to it (FR20–FR23, FR25, AC10, AC11)              | setup or a run refuses the plugin; a skill sends the agent to a missing skill                             | unit and integration                       | `adapters.test.ts` and `setup-client.test.ts` for a plugin with and without the skill; `release validation accepts the plugin without the orchestrate skill`; `no plugin file holds, offers or routes to an orchestrate skill`                                                                                                                                                                                                                                                                                                       | none                                          |
| The control contract is unchanged (FR24, AC12)                                                             | supervisors of the CLI break                                                                              | existing unit tests                        | `agent-control.test.ts` and `agent-control-cli.test.ts`, unedited, passing                                                                                                                                                                                                                                                                                                                                                                                                                                                           | none                                          |
| Plugin text is free of runner checks, and standalone-text checks still bite (FR26–FR28, AC13)              | plugin rework stays blocked by runner checks, or a required policy fragment disappears unnoticed          | integration                                | `release validation and the build check pass after edits to plugin text that no check names and a removed phase document`; `a standalone text check fails without its fragment and reads linked guidance by its plugin path`                                                                                                                                                                                                                                                                                                         | none                                          |
| Maintained documents state current facts (FR29, AC15)                                                      | readers act on a removed skill or an old build rule                                                       | release validation plus review             | `npm run release:validate`; the pinned fragments in `release-validation.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                     | independent review reads the document changes |

## Assurance decisions

- Shared evidence: one copied-tree test often covers several requirements,
  for example the closed-byte test covers the three v1 files, the successor
  file and its sibling digest.
- No new test: FR24 (control contract) and AC14 (prompt assembly) are
  proven by existing tests that pass with no edit. A new test would repeat
  them.
- Consolidation and removal: the tests of the v1 baseline's evolution and
  of its comparison with plugin files were replaced by the closed-record
  and successor tests. The twenty-case loop on the removed skill's policy
  text and the supervisor assertions of `workflow-skills.test.ts` were
  removed with the skill. The control-protocol JSON examples they decoded
  no longer exist; the decoder is covered by the control tests.
- Claim narrowing: none.
- Non-unit evidence: the byte comparison of the frozen module against
  commit `fa89da9` is a one-time script run, recorded in the implementation
  report. From here on the successor baseline carries the guarantee: its
  first generation is fixed by a digest constant and every later change
  needs a recorded transition (review 1, F1).
- Non-automated ADR confirmation: none is required by ADR-0070.
- Security: the plan's remaining enforcement point is the hook digest
  comparison and its pin in the successor baseline. Both have tests above.
  No new exposure was found.

## Known limits

- No test runs the publication check on a tree with a removed plugin phase
  document. `publication-policy.json` still classifies the seven phase
  documents, and this package removes none.
- The behavior of a published CLI 2.8.x against a plugin built from this
  state is not tested. It is expected to refuse the plugin and is an owner
  follow-up in the implementation report.
- Hosted CI has not run on this tree.

## Critique loop

One pass over the changed and added tests.

- Error paths: the refusals of the baseline tool, of the build on an
  unusable module, of parity on an unreadable hook file and of setup on a
  missing skill each have an assertion on the diagnostic.
- Material guarantees: each row of the map has at least one failing
  condition under test.
- Hollow or implementation-coupled tests: none found. The decoupling test
  chooses its edits by position, so it pins no plugin sentence.
- Doubles: no new double.

The pass changed nothing and found no material gap, so no second pass ran.
