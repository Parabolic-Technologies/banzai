# Test report: Path-scoped verification gate (P12)

- Slug: `261116-p12-path-scoped-verification-gate`
- Related: [description.md](./description.md), [plan.md](./plan.md),
  [implementation-report.md](./implementation-report.md),
  [ADR-0071](../../decisions/0071-path-scoped-verification-gate.md)
- Date: 2026-11-16

## Framework, layout and doubles

The Node built-in test runner with `node:assert/strict`, through
`packages/orchestrator/scripts/test.mjs`. New tests mirror the new scripts:
`test/verification-scope.test.ts`, `test/verification-suites.test.ts`,
`test/scoped-check.test.ts`, plus `test/verification-scope-ci.test.ts` for the
workflow's scope step. Test names follow the repository's sentence style.

Every repository in these tests is a real temporary Git repository with
commits and merges made by the test. The checks of `npm run check` are
replaced only through its test option `--fixture-components`: a small probe
script records its name, working directory and arguments, and for the
publication check the copy's index, its link and its built distribution. The
scope step test runs the exact script taken from `.github/workflows/ci.yml`
with `bash -e`, as GitHub runs a `run` step. The membership test reads test
sources with the TypeScript parser already in the development dependencies.
No mock of a unit under test is used.

## Commands and outcomes

Focused runs, from `packages/orchestrator/`, each with all tests passing:

| Command                                                                                                                      | Result                                                                          |
| ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `node scripts/test.mjs --file verification-scope.test.ts --file scoped-check.test.ts`                                        | 17 passed                                                                       |
| `node scripts/test.mjs --file verification-suites.test.ts --file release-validation.test.ts --file release-evidence.test.ts` | 270 passed                                                                      |
| `node scripts/test.mjs --file verification-scope-ci.test.ts`                                                                 | 4 passed                                                                        |
| `node scripts/test.mjs --file release-check.test.ts`                                                                         | 5 passed                                                                        |
| `node scripts/test.mjs --file release-check.test.ts --file release-candidate-check.test.ts` (after T003)                     | 10 passed                                                                       |
| `npx tsc --project tsconfig.json --noEmit`                                                                                   | clean                                                                           |
| `npx eslint` on every new or changed script and test                                                                         | no errors; five existing complexity and nesting warnings in `check-release.mjs` |
| `npx prettier --check scripts test MODULES.md`                                                                               | clean                                                                           |
| `npm run release:validate` (repository root)                                                                                 | passed                                                                          |

The end-to-end runs of `npm run check` on a repository copy are in the
implementation report. The final suite is the plan's mandatory check,
recorded under [Final check](#final-check).

## Files

Added: `test/verification-scope.test.ts` (9 tests),
`test/verification-suites.test.ts` (7), `test/scoped-check.test.ts` (8),
`test/verification-scope-ci.test.ts` (4).

Changed: `test/release-validation.test.ts` (two mutations re-anchored on the
new condition line, thirteen added), `test/release-candidate-check.test.ts`
(fixture copies the new runner module; the source-text test reads
`checkout-copy.mjs`), `test/release-check.test.ts` (one test added).

Removed: none.

## Risk and Contract Assurance Map

| Material guarantee                                                                                                                                                                                  | Impact if broken                                                     | Best level                                       | Evidence                                                                                                                                                                                                                                    | Deferred owner                 |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| Rule table: labels, order, first rule wins, whole segments, plain names only, unknown is `full` (FR1–FR2)                                                                                           | a runtime path runs only narrow checks                               | unit                                             | new: `scope rules carry the labels of FR2 ...` (AC3, AC4, AC7 label)                                                                                                                                                                        | —                              |
| Every baseline-pinned and release-train version path is `full` (FR3)                                                                                                                                | a pinned or version file escapes the release gate                    | unit over the real policy files                  | new: `every baseline-pinned path and release-train version path is full scope`                                                                                                                                                              | —                              |
| Widest scope, deciding paths, empty and uncomputable sets (FR4, FR9)                                                                                                                                | wrong scope or a silent pass on an empty set                         | unit                                             | new: `a change set takes the widest scope of its paths` (AC1, AC2, AC5, AC6, AC8)                                                                                                                                                           | —                              |
| Local change set: edits, staged, untracked, ignored excluded, deletion, move as two paths, mode, base commit or tree, refusal of `-` bases (FR7–FR8)                                                | a change escapes classification or `--base` reaches Git as an option | integration, temporary repository                | new: `the local change set compares the working tree with a base revision`                                                                                                                                                                  | —                              |
| CI change set is the merge commit against its first parent (FR6)                                                                                                                                    | a lane classifies the wrong diff                                     | integration                                      | new: `the CI change set compares a merge commit with its first parent`                                                                                                                                                                      | —                              |
| Report: byte order, JSON names, cap of 50, reasons (FR19)                                                                                                                                           | unreadable or misleading report                                      | unit                                             | new: `the report orders paths by bytes, ...` (AC7)                                                                                                                                                                                          | —                              |
| A file name cannot add a heading, a line or close the summary fence; only the scope word reaches the output (security, class 1)                                                                     | job-summary injection in a pull request                              | integration                                      | new: `a file name cannot escape the job summary's fenced block` (AC17)                                                                                                                                                                      | —                              |
| The CI entry runs alone from a copy, gives the dispatch reason, fails without its variables or when the output cannot be written                                                                    | a lane passes without a scope                                        | process                                          | new: `the CI entry runs as a lone copy outside the repository`, `the CI entry fails when the step output cannot be written`                                                                                                                 | —                              |
| A change cannot narrow its own lane; bootstrap; dispatch; documents-only merge (FR23–FR25)                                                                                                          | narrow checks for runtime code                                       | process, exact workflow script                   | new: the four tests of `verification-scope-ci.test.ts` (AC12, AC13 scope, AC14 scope)                                                                                                                                                       | hosted run: owner (AC13, AC14) |
| Suites list every test that reads their scope (FR14–FR16)                                                                                                                                           | a narrow scope skips a test that reads the changed files             | unit over the real test tree and temporary trees | new: the seven tests of `verification-suites.test.ts` (AC10)                                                                                                                                                                                | —                              |
| `npm run check` runs the checks of its scope in order, suites once, stops at the first failure (FR10–FR12, FR21)                                                                                    | wrong checks or a pass after a failure                               | process with fixture components                  | new: `a documents change ...`, `a plugin change ...`, `a failing or unstartable publication check ...`, `an empty or uncomputable change set ...`                                                                                           | —                              |
| The copy holds untracked files, an index listing them, links as links and the distribution, and writes nothing in the checkout; removed after success, failure and SIGTERM (FR20, security class 7) | checkout corruption or leaked temporary copies                       | process                                          | new: `a documents change ...` (index bytes, `count-objects -v`, refs), `SIGTERM stops the running check and removes the copy`, `a tracked file deleted only from the working tree stops the publication copy`                               | —                              |
| Options: no option selects a scope; invalid values stop before any check (FR18)                                                                                                                     | a contributor or script narrows the gate                             | process                                          | new: `invalid options stop the command before any check` (AC11 options)                                                                                                                                                                     | —                              |
| `--base HEAD^1` on a merge commit computes the CI entry's scope; a tree base equals its commit (narrow branch argument)                                                                             | the narrow branch runs a narrower scope than the lane                | integration                                      | new: `on a merge commit --base HEAD^1 computes the scope of the CI entry` (AC11 tree)                                                                                                                                                       | —                              |
| A narrow scope passes without a built distribution; publication rejects an unclassified record (FR13, AC9, AC11)                                                                                    | narrow lanes fail or pass wrongly in CI                              | end-to-end on a repository copy                  | implementation report, runs 1–3                                                                                                                                                                                                             | —                              |
| Lane text: full and narrow branches complementary, evidence only on the full branch, first parent's module, fetch depth 2 (FR22, FR27–FR28)                                                         | a workflow edit weakens the gate unnoticed                           | unit over the workflow                           | changed and new mutations in `release validation rejects weakened GitHub CI evidence and live isolation` (AC16)                                                                                                                             | —                              |
| A merge without evidence makes publication run the complete check (FR26)                                                                                                                            | an unchecked tag is published                                        | integration                                      | existing: `release-evidence.test.ts` run without evidence, `Release evidence not bound` (AC15)                                                                                                                                              | —                              |
| Release scripts keep every output line after the extraction (T003 invariants)                                                                                                                       | silent change of the release gate                                    | process                                          | existing `release-check.test.ts` and `release-candidate-check.test.ts` unchanged in expectation; new: `release check words an interrupted or unstartable component as unable to complete`, also run against the original script from `HEAD` | —                              |
| Documents state the new facts (FR29)                                                                                                                                                                | contributors follow a stale gate                                     | validator and review                             | `npm run release:validate`; content is a review item                                                                                                                                                                                        | reviewer                       |

## Decisions

- Shared evidence: the existing release-evidence test of a run without
  evidence already proves AC15; no new test.
- Non-unit: hosted confirmation of AC13 and AC14 (lanes skipping
  `release:check`, no uploaded artifact, the job summary on GitHub) needs a
  hosted run; the scope step itself is tested with the exact script.
- Claim narrowing: the membership reading is conservative. Any literal run
  that resolves to the repository root reads every scope, so the 8 tests that
  read the root sit in both suites. The reading does not follow values
  through variables; a test that names a scoped path only through computed
  strings is not detected. FR15 and the plan define this reading.
- The interrupted path of a release component was not covered before; one
  test now covers it, and the same cases were run against the original script
  of `HEAD` with identical output.

## Critique loop

First pass found three unasserted error paths: the CI entry's write failure,
a copy refusal in `npm run check`, and the interrupted or unstartable
component of `release-check.mjs`. One test each was added. No hollow,
redundant or implementation-coupled test was found; the source-text test of
the candidate check is retained by plan as a guard against Git writes. The
second pass found no further gap.

## Final check

The mandatory check of the plan, `node
packages/orchestrator/scripts/release-candidate-check.mjs` through the
standalone verification helper, passed on its retry, attempt
`verification-3fad541d-b2c0-4db2-b088-9f23108bb416`: 2212 tests, 2212 passed,
0 failed, then format, release validation, publication and committed smoke,
`release candidate check passed`, exit 0, 541 s. The first attempt stopped on
two stray dependency links in the local `node_modules`; see the implementation
report's [Checks](./implementation-report.md#checks).
