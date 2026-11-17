# Implementation Review: 261116-p12-path-scoped-verification-gate

- Format: `banzai-feature-review/v1`
- Feature slug: `261116-p12-path-scoped-verification-gate`
- Review iteration: `1`
- Verdict: `changes_requested`
- Workspace digest: `not supplied`
- Review artifact: `documentation/work/261116-p12-path-scoped-verification-gate/review-1.md`

## Review Scope

Standalone, source-read-only full review of the uncommitted working tree on
branch `dev` against `HEAD` (`12f5e15`), including the untracked new files
under `packages/orchestrator/scripts/` and `packages/orchestrator/test/`. This
artifact is the only file the review wrote.

Authority, checked against the owner's approval of 2026-11-16
(`Approve the P12 plan bundle`):

- `description.md`: SHA-256
  `2ce7666f6dd006e2b920f60a762708042f0a6ee6dafbef625e9b9890bb622905`,
  equal to the approved digest.
- `plan.md`: SHA-256
  `acffec286806347ff092ce0f2b8908acc59965841fc3bed01a23be321e461a28`,
  equal to the approved digest. It establishes the Plan Authority convention.
- `documentation/decisions/0071-path-scoped-verification-gate.md`, Accepted:
  the `HEAD` version hashes to the approved
  `30f9d705305d72e8a792be9d1a586b8a3dfaa3d1c6bd39ea303ff906e04af755`; the
  working tree differs only in the implementation-state line that T006
  authorizes (now
  `d1de5d2f958121c4ee903840d2969515e20ed13b8333c4d07feed1c1cd4f488a`).
- `PROJECT_MANIFEST.md`, root `AGENTS.md`; ADR-0053, ADR-0067, ADR-0056,
  ADR-0010, ADR-0043, ADR-0070 as the plan cites them.

Reviewed surface: every path in `git diff HEAD --stat` (16 files) and the
twelve untracked files: `scripts/verification-scope.mjs` and `.d.mts`,
`scripts/verification-suites.mjs` and `.d.mts`, `scripts/scoped-check.mjs`,
`scripts/checkout-copy.mjs`, `scripts/component-runner.mjs`, the four new
test files, and the work directory's reports. Also read for context:
`scripts/publication-release.mjs` (root resolution),
`scripts/release-evidence.mjs` (`bindRun`, `verify`), the hook version rule
of `scripts/check-release.mjs` (`validateHookRuntimeVersion`),
`instruction-baseline.json`, `release-policy.json` and `.gitignore`.

Verification evidence:

- The plan's one mandatory check, through the standalone helper, round
  `9fd01109-ada3-478f-84cd-9bf513f4a89f`: attempt
  `verification-3fad541d-b2c0-4db2-b088-9f23108bb416` completed with exit 0
  in 540 s (start 2026-11-16 23:56:15, finish 2026-11-17 00:05:15 local); its
  log ends with `committed smoke passed`, `release check passed`,
  `release candidate check passed`. Of the changed and untracked paths, only
  `implementation-report.md` and `test-report.md` were modified after the
  attempt started, so the evidence covers the current source and tests. The
  candidate gate was not rerun.
- Rerun by the reviewer: `git diff --check` (clean). No test was rerun: no
  finding depends on execution and the gate's evidence is current.
- The end-to-end runs of T004 (AC9, AC11) are recorded in the implementation
  report on a copy taken before T005 and T006; they were read, not rerun.

## Summary

The change implements FR1–FR29 as the approved plan specifies. The rule
table in `verification-scope.mjs` matches FR1 and FR2 in order, with literal
whole-segment matching and `full` for anything unnamed or non-plain; every
baseline-pinned and release-train version path is `full` by a test over the
real files. The local and CI change sets, the report, the job summary and
the `--ci` entry follow Technical Breakdown section 1; file names reach the
summary only as JSON strings inside the fenced block and the step output
carries only `scope=<scope>`. The three lanes of `.github/workflows/ci.yml`
equal the plan's section 5 text byte for byte, `ciLaneDefinition` pins it,
and the full and narrow conditions are complements. The scope step executes
the first parent's module from `$RUNNER_TEMP`; a test with a replaced module
proves a change cannot narrow its own lane. The clone stays shallow at depth
2, so `validateHookRuntimeVersion` keeps skipping in CI. `publish.yml`,
`release-policy.json`, `release-evidence.mjs` and `package-lock.json` are
unchanged; a merge without evidence is unbound and takes the fallback.

The extraction of `component-runner.mjs` and `checkout-copy.mjs` keeps the
order copy, prepare, index of the old candidate code, maps each copy refusal
to its old code, and keeps `RELEASE_COMPONENT_FAILED` wording for a signal or
a start failure. `npm run check` validates options and fixture components
before any check, runs the scope's checks in order, stops at the first
failure, and runs the publication check on a disposable copy that
`publication-release.mjs` inspects through `process.cwd()`. The membership
reading follows plan section 2, and a census of every test that mentions a
plugin path found none that FR15 requires outside the suites. The documents
state the new facts; ADR-0071 changed only in its implementation-state line,
its decision-log row records source implementation and the outstanding
hosted confirmation, and the manifest row stays `Planned`.

One nit: the implementation report's file list omits a changed test file.
No blocker or should-fix finding.

## Findings

### F1 — Implementation report omits the changed `release-check.test.ts`

- Severity: `nit`
- Category: `documentation`
- Confidence: `high`
- Evidence: `packages/orchestrator/test/release-check.test.ts:164-202` adds
  the test `release check words an interrupted or unstartable component as
  unable to complete` (`git diff HEAD` shows the file modified). The
  implementation report's Modified list,
  `documentation/work/261116-p12-path-scoped-verification-gate/implementation-report.md:35-61`,
  names `release-candidate-check.test.ts` and `release-validation.test.ts`
  but not this file, and the T003 completion row (line 245) cites only
  `release-candidate-check.test.ts` among the tests. The test report lists
  the change correctly
  (`documentation/work/261116-p12-path-scoped-verification-gate/test-report.md:53-56`).
- Violates: review audit item 6 (report file lists match reality); plan T006
  ("The implementation report lists what changed and where, the tests
  added").
- Reproduction: `git diff HEAD --stat -- packages/orchestrator/test/release-check.test.ts`
  shows 40 added lines; search the implementation report for
  `release-check.test.ts`.
- Fix acceptance: the implementation report's Modified list names
  `packages/orchestrator/test/release-check.test.ts` with its added test, and
  the T003 evidence either cites it or the report states why not. No source
  or test change is required.

## Previously Accepted Findings

None.

## Deferred Coverage

- Hosted confirmation of ADR-0071 compliance items 13 and 14 (AC13, AC14:
  narrow lanes record and upload no evidence and show the scope in the job
  summary; manual dispatch runs the full branch) needs hosted runs after the
  change reaches the base branch. The plan assigns it to the owner. The first
  pull request carrying this change runs `full` with the bootstrap reason.
- The end-to-end narrow-scope runs (AC9, AC11) were not repeated on the final
  tree. The command and its imported modules were, by the report, unchanged
  after the recorded runs; the final candidate gate exercised the full scope
  only.
- The membership reading is lexical, as FR15 and the ADR's Risks state. A
  test that reaches a `documents` or `plugin` file only through `src/` code,
  a spawned fixture script or a computed string is not detected. The census
  found no current case beyond the required-skills read that description
  assumption 7 records.
- To make the candidate gate pass, the implementer removed two ignored links
  from the local installation, `node_modules/.bin/banzai` and
  `node_modules/node_modules` (implementation report, Checks); both are
  still absent. The refusal `UNSUPPORTED_WORKSPACE_LINK` for a dependency
  link into an unindexed workspace file predates this change (the report
  says the `HEAD` script refused the same link). The review did not assess
  whether a normal reinstall recreates that link; it is outside P12.
- Narrow lanes print deciding paths to the step log. The runner's legacy
  `##[` command parser can match inside a line, but every path line ends in
  `" (<label>)`, so no output value can equal `documents` or `plugin`; and a
  pull request can already change the workflow it runs, as ADR-0071's
  security note states. Not a finding; recorded for completeness.
- EQ-SHADOW: candidateId=EQ-S1; ruleId=EQ-05; severity=nit; confidence=medium; evidence=packages/orchestrator/scripts/scoped-check.mjs:197-203 runPublication catch and :248-256 top-level catch; impact=a failure of the distribution copy, `git init` or `git add` in the copy is reported only as `CHECK_FAILED: publication could not copy the checkout`, and any other unexpected error only as `CHECK_FAILED: <name> could not complete`, without the original cause, so a contributor must rerun or debug to learn why; remediation=append the original error's one-line message to the generic diagnostic; references=FR21, plan Technical Breakdown section 4 (one-line diagnostic on unexpected failure); verification=focused test with an unreadable distribution directory asserting the cause appears on the CHECK_FAILED line; dedupeKey=EQ-05|scoped-check.runPublication|FR21|lost-failure-cause; waiver=not_applicable (shadow-only)

## Handoff

Human triage is required: the owner decides F1 in chat (accept, reject or
defer). If F1 is accepted, the next model may edit only the implementation
report as its fix acceptance states; no source, test or approved artifact
changes, and a delta re-review checks that one edit. If no finding is
accepted, the work is done by human triage without another review. The
`EQ-SHADOW` entry needs no disposition and never enters fix scope. The owner
follow-ups of the plan remain: commit by hand, and confirm AC13 and AC14 on
hosted runs before ADR-0071's manifest row leaves `Planned`.
