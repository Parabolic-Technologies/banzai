# Implementation report: Path-scoped verification gate (P12)

- Slug: `261116-p12-path-scoped-verification-gate`
- Requirements: [description.md](./description.md)
- Plan: [plan.md](./plan.md), approved by the owner in chat on 2026-11-16
  with `Approve the P12 plan bundle`
- Decision:
  [ADR-0071](../../decisions/0071-path-scoped-verification-gate.md)
- Tests: [test-report.md](./test-report.md)
- Date: 2026-11-16
- Mode: standalone, one session.

## What changed

### Created

- `packages/orchestrator/scripts/verification-scope.mjs` and its declaration
  file: the scope rules of ADR-0071 section 1 in precedence order, path
  classification, the scope of a change set, the local change set (working
  tree against a commit or tree, plus untracked non-ignored files), the CI
  change set (merge commit against its first parent), the report, the job
  summary and the `--ci` entry. It imports only Node built-ins.
- `packages/orchestrator/scripts/verification-suites.mjs` and its declaration
  file: the documents suite (8 files) and the plugin suite (14 files), and
  `suiteFiles(scope)`, which returns each file of the scope's suites once.
- `packages/orchestrator/scripts/component-runner.mjs`: the credential-free
  child environment and the execution of one component, extracted from
  `release-check.mjs`.
- `packages/orchestrator/scripts/checkout-copy.mjs`: the disposable checkout
  copy with its own index, extracted from `release-candidate-check.mjs`.
- `packages/orchestrator/scripts/scoped-check.mjs`: `npm run check`.
- Tests: `test/verification-scope.test.ts`, `test/verification-suites.test.ts`,
  `test/scoped-check.test.ts`, `test/verification-scope-ci.test.ts`.

### Modified

- `package.json`: the `check` script. `package-lock.json` is unchanged.
- `.github/workflows/ci.yml`: the three release lanes have the text of the
  plan's Technical Breakdown section 5. Triggers, permissions, concurrency and
  the live job keep their bytes.
- `packages/orchestrator/scripts/check-release.mjs`: `ciLaneDefinition`
  returns the new lane text; the full and narrow conditions are named
  constants. The specific lane checks before the whole-text comparison keep
  their codes, labels and order.
- `packages/orchestrator/scripts/release-check.mjs`: uses
  `component-runner.mjs`; output, codes and step order are unchanged.
- `packages/orchestrator/scripts/release-candidate-check.mjs`: uses
  `checkout-copy.mjs`, mapping each copy refusal to its existing code;
  dependency linking stays here and runs before the candidate is indexed.
- `packages/orchestrator/test/release-candidate-check.test.ts`: fixture
  repositories also copy `component-runner.mjs`; the source-text test reads
  `checkout-copy.mjs` and keeps its three assertions.
- `packages/orchestrator/test/release-check.test.ts`: one test added,
  `release check words an interrupted or unstartable component as unable to
complete`, for the component outcomes now reported by
  `component-runner.mjs`; the same cases give identical output with the
  script of `HEAD`.
- `packages/orchestrator/test/release-validation.test.ts`: the two mutations
  of the `release:check` condition now replace the step's existing condition;
  thirteen mutations were added (see the test report).
- Documents: `PROJECT_MANIFEST.md` sections 2 and 8, `CONTRIBUTING.md`,
  `documentation/release-checklist.md`, `documentation/orchestrator.md`
  (Repository Release Confidence), `documentation/releases/public-publication.md`
  (step 2), `packages/orchestrator/MODULES.md` (release scripts), the
  implementation-state line of ADR-0071 and its row in
  `documentation/decisions/README.md`.

### Unchanged by design

`.github/workflows/publish.yml`, `release-policy.json`,
`packages/orchestrator/scripts/release-evidence.mjs`, `package-lock.json`,
`publication-policy.json` and the ADR-0071 row of the manifest index
(`Planned`).

## Requirement trace

| Requirement | Where                                                                                    | Evidence                                                           |
| ----------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| FR1–FR4     | `verification-scope.mjs` (`SCOPE_RULES`, `classifyPath`, `scopeOfChangeSet`)             | `verification-scope.test.ts`                                       |
| FR5         | rules and suites under `packages/orchestrator/scripts/`; the workflow holds no path rule | `verification-scope-ci.test.ts`, release validation                |
| FR6–FR9     | `ciChangeSet`, `localChangeSet`                                                          | `verification-scope.test.ts`, `scoped-check.test.ts`               |
| FR10–FR13   | `scoped-check.mjs` (`SCOPE_CHECKS`, `suiteFiles`)                                        | `scoped-check.test.ts`, end-to-end runs below                      |
| FR14–FR16   | `verification-suites.mjs`, membership reading in `verification-suites.test.ts`           | `verification-suites.test.ts`                                      |
| FR17–FR21   | `scoped-check.mjs`, `checkout-copy.mjs`, `component-runner.mjs`                          | `scoped-check.test.ts`, end-to-end runs below                      |
| FR22–FR25   | `.github/workflows/ci.yml`                                                               | `verification-scope-ci.test.ts`; hosted confirmation outstanding   |
| FR26        | `publish.yml` and `release-evidence.mjs` unchanged                                       | existing `release-evidence.test.ts` case of a run without evidence |
| FR27–FR28   | `check-release.mjs` (`ciLaneDefinition`)                                                 | `release-validation.test.ts`                                       |
| FR29        | the documents listed above                                                               | `npm run release:validate`                                         |

## ADR conformance

- Section 1 (scopes and rules): one rule table, first rule wins, the widest
  scope decides, an unknown path and an empty or uncomputable change set are
  `full`. Every baseline-pinned path and every release-train version path
  classifies as `full` (test reads both files).
- Section 2 (suites): the membership test reads every test file and its
  test-local imports with the TypeScript parser and fails for a missing entry
  or a listed file that does not exist.
- Section 3 (local command): `npm run check` prints the scope and runs its
  checks; no option selects or narrows the scope. The publication check runs
  on a disposable copy; the checkout's index bytes, object count and refs are
  unchanged after success, failure and SIGTERM (tests), and the end-to-end
  runs below confirm index and object count on a full repository copy.
- Section 4 (CI): each lane runs the first parent's copy of the scope module
  from `$RUNNER_TEMP`; a change cannot narrow its own lane (test with a
  replaced module); a first parent without the module and manual dispatch
  give `full` with their reasons.
- Section 5 (evidence): only the `full` branch runs `release:check` and
  records and uploads evidence. A merge whose lanes recorded none is
  `Release evidence not bound` and publication runs the complete check on
  the tag (existing test of `release-evidence.test.ts`).
- Compliance items 13 and 14 need a hosted run (owner follow-up).

## Structural assessment

The plan's two assessments held:

- Scope rules (Technical Breakdown section 1): `verification-scope.mjs` is
  the only owner of path rules; `check-release.mjs` holds the lane text only.
- Shared release-tool helpers (section 3): extracted into
  `component-runner.mjs` and `checkout-copy.mjs`. The four invariants hold:
  one credential blocklist; a component runs without a shell, stdin ignored,
  output inherited, and the module reports exit code, signal or start
  failure; one copy implementation with no mutating Git command in the
  source checkout; and both release scripts keep every output line, code and
  step order. `release-check.mjs` still reports an interrupted component as
  `RELEASE_COMPONENT_FAILED: <name> could not complete`. Remaining debt:
  none.

## Deviations from the plan

1. The publication check of `npm run check` runs the checkout's
   `packages/orchestrator/scripts/publication-release.mjs` (under `--root`)
   with the copy as its working directory. The first end-to-end run used the
   copy's own script and failed: the copy has no `node_modules`, and the
   script imports `esbuild`. The plan states only the working directory; the
   inspected files are still the copy's.
2. The plugin suite lists 14 files, not the census's 6: the 8 files of the
   documents suite also read the repository root, which reads every scope.
   The plan names the census as the expected start and the membership test
   as the decision.
3. The membership test loads the existing `typescript` development dependency
   at run time through `createRequire`, because the test bundle cannot hold
   the compiler's CommonJS build. No dependency was added.
4. The scope step test is the new file `test/verification-scope-ci.test.ts`,
   which T005 allows.
5. Wording the plan leaves open: an invalid fixture file reports
   `INVALID_CHECK_OPTION: --fixture-components ...`; a repeated option is
   refused; `CHECK_FAILED` details are `exited with code <n>`,
   `could not start`, `was interrupted` and
   `could not copy the checkout (<reason>: <name>)`.
6. `documentation/releases/public-publication.md` step 2 said every required
   lane records evidence; it now says a release candidate runs the `full`
   scope and a narrow lane records none (T006, "any other maintained
   document").
7. The plan's task checkboxes stay unchecked: the approved digest covers
   them. The table below is the completion record.

None of these changes an approved requirement, an acceptance criterion or
the scope.

## Engineering Quality deviations

None.

## End-to-end evidence (T004)

Setup: the working tree's tracked and untracked non-ignored files copied with
`rsync` into a scratch directory, without `packages/orchestrator/dist/`;
`git init`, `git add -A` and `git write-tree` in the copy, with no commit;
`npm ci` (146 packages). After the deviation 1 fix the copy's
`scoped-check.mjs` was replaced by the fixed file, added to the copy's index
and a new base tree written, `f8777007d897dcf2fba8f54651f97609859d8049`. Each
run is `npm run check -- --base <tree>` in the copy, recording the SHA-256 of
`.git/index`, `git count-objects -v` and the number of `banzai-check-*`
directories in the system temporary directory before and after.

| Run | Change                                                                                       | Result                                                                                                                                                                             | Duration | Index, objects, copies        |
| --- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ----------------------------- |
| 1   | new `documentation/decisions/0072-scope-probe.md` with its policy entry                      | `documents`; deciding paths the record and `publication-policy.json`; five checks; suite 356 tests passed; `check passed (documents scope)`, exit 0                                | 87 s     | unchanged, unchanged, 0 and 0 |
| 2   | the same record without its entry                                                            | `documents`; `check: publication`, `PUBLICATION_UNCLASSIFIED documentation/decisions/0072-scope-probe.md: ...`, `CHECK_FAILED: publication exited with code 1`; no `suite`; exit 1 | 11 s     | unchanged, unchanged, 0 and 0 |
| 3   | the record removed; new `plugins/banzai/skills/feature/scope-probe.md` with its policy entry | `plugin`; deciding path the skill file; five checks; suite 526 tests passed; `check passed (plugin scope)`, exit 0                                                                 | 240 s    | unchanged, unchanged, 0 and 0 |

The copy was taken during T004, before the workflow and validator changes of
T005, the documentation edits of T006 and two later tests.
`scoped-check.mjs`, the scope and suite modules and the two shared helpers did
not change after the fix; the final check below covers the complete tree. The
first attempt of run 1, before the fix, stopped at `check: publication`
with `Cannot find package 'esbuild'` and `CHECK_FAILED: publication exited
with code 1`, index and object count unchanged and no copy left.

## Checks

The plan's mandatory check ran through the standalone verification helper
(`verification.cjs execute`, request `banzai-verification-request/v4`, round
`9fd01109-ada3-478f-84cd-9bf513f4a89f`, check `release-candidate`:
`node packages/orchestrator/scripts/release-candidate-check.mjs`).

| Attempt                                             | Result                                                                                      |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `verification-4a95a41d-2298-4d68-8021-07635ea6223a` | failed, exit 1, 238 ms: `UNSUPPORTED_WORKSPACE_LINK: packages/orchestrator/dist/banzai.mjs` |
| `verification-3fad541d-b2c0-4db2-b088-9f23108bb416` | retry of the first: passed, exit 0, 541 s; disposition `passed`, applicability complete     |

The first attempt failed on the local installation, not on this change: the
ignored root `node_modules` held `.bin/banzai`, a link to the ignored
`packages/orchestrator/dist/banzai.mjs`, and `node_modules/node_modules`, a
link into another session's temporary directory, both dated 2026-11-11. The
candidate check refuses a dependency link into an unindexed workspace file;
the script of `HEAD` gave the same line on the same installation. Both links
were removed and the check retried unchanged.

The passing attempt ran `distribution-build`, `verify` (2212 tests, 2212
passed, 0 failed), `format`, `release-validation`, `publication` (689 indexed
files, clean, every resource classified) and `committed-smoke`, and ended with
`release check passed` and `release candidate check passed`.
`git diff --check` reports nothing.

## Notes for assurance

- A tracked file deleted from the working tree but not from the index stops
  the publication check with
  `CHECK_FAILED: publication could not copy the checkout (missing-file: <path>)`.
  The copy refuses to shrink silently, as the release candidate check does
  with `MISSING_RELEASE_CANDIDATE_FILE`; `git rm` avoids it.
- The narrow CI branch reruns the command with the head's code. Its scope
  rules, the command and `package.json` are `full`-scope paths, so they are
  the base revision's bytes whenever that branch runs; the command's change
  set contains the lane's, so it computes the same scope or a wider one.
- `verification-scope.mjs` is a compatibility surface: a lane runs the first
  parent's copy, so its `--ci` command line, environment variables and single
  output line must stay compatible with later workflows.

## Follow-ups for the owner

- Confirm compliance items 13 and 14 on a hosted run: a pull request that
  changes only a decision record (each lane runs the documents checks and
  uploads no evidence) and a manual dispatch (each lane runs the `full`
  branch with the dispatch reason). The first pull request that introduces
  this change runs `full` with the bootstrap reason.
- Commit the change; nothing is staged or committed.

## Plan Task Completion

Format: `banzai-plan-task-completion/v1`

| Task | Status    | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Gap or deviation |
| ---- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| T001 | completed | [{"path":"packages/orchestrator/scripts/verification-scope.mjs","detail":"Scope rules, change sets, report, job summary and the --ci entry."},{"path":"packages/orchestrator/test/verification-scope.test.ts","detail":"Rules, pinned and version paths, change sets, report, summary and CI entry tests."}]                                                                                                                                                                                                                                                  | null             |
| T002 | completed | [{"path":"packages/orchestrator/scripts/verification-suites.mjs","detail":"Documents suite (8 files), plugin suite (14 files) and suiteFiles."},{"path":"packages/orchestrator/test/verification-suites.test.ts","detail":"Membership test over the real test tree and temporary trees."}]                                                                                                                                                                                                                                                                    | null             |
| T003 | completed | [{"path":"packages/orchestrator/scripts/component-runner.mjs","detail":"Credential-free environment and one-component execution."},{"path":"packages/orchestrator/scripts/checkout-copy.mjs","detail":"Disposable checkout copy with its own index."},{"path":"packages/orchestrator/test/release-candidate-check.test.ts","detail":"Fixture copies the runner module; source-text test reads checkout-copy.mjs."},{"path":"packages/orchestrator/test/release-check.test.ts","detail":"Interrupted or unstartable component worded as unable to complete."}] | null             |
| T004 | completed | [{"path":"packages/orchestrator/scripts/scoped-check.mjs","detail":"npm run check: scope, checks in order, publication on a copy."},{"path":"package.json","detail":"The check script."},{"path":"packages/orchestrator/test/scoped-check.test.ts","detail":"Scope checks, failures, options, SIGTERM and merge-commit base tests."},{"path":"documentation/work/261116-p12-path-scoped-verification-gate/implementation-report.md","detail":"End-to-end runs 1-3 on a repository copy."}]                                                                    | null             |
| T005 | completed | [{"path":".github/workflows/ci.yml","detail":"Release lanes with the scope step and complementary full and narrow branches."},{"path":"packages/orchestrator/scripts/check-release.mjs","detail":"ciLaneDefinition returns the new lane text."},{"path":"packages/orchestrator/test/release-validation.test.ts","detail":"Re-anchored and thirteen new lane mutations."},{"path":"packages/orchestrator/test/verification-scope-ci.test.ts","detail":"The workflow's scope step run with bash -e."}]                                                          | null             |
| T006 | completed | [{"path":"PROJECT_MANIFEST.md","detail":"Sections 2 and 8 state npm run check and the scoped CI lanes."},{"path":"documentation/decisions/0071-path-scoped-verification-gate.md","detail":"Implementation-state line."},{"path":"documentation/work/261116-p12-path-scoped-verification-gate/test-report.md","detail":"Final check: the mandatory candidate gate result."}]                                                                                                                                                                                   | null             |
