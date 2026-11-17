# Implementation Review: 261116-p11-orchestrator-instruction-copy

- Format: `banzai-feature-review/v1`
- Feature slug: `261116-p11-orchestrator-instruction-copy`
- Review iteration: `2`
- Verdict: `changes_requested`
- Workspace digest: `not supplied`
- Review artifact: `documentation/work/261116-p11-orchestrator-instruction-copy/review-2.md`

## Review Scope

Standalone, source-read-only resolution review of the uncommitted working
tree on branch `dev` against `HEAD` (`3b457dd`). It is closure-oriented: it
decides whether the fix acceptance of each finding accepted from
[review-1.md](./review-1.md) is met and whether the fixes introduced a
defect. This artifact is the only file the review wrote.

Accepted findings: F1, F2 and F3 of review 1. The change report records the
owner's triage in chat on 2026-11-16 as `Accept all three`
(`change-report.md:8-9`); the review request states the same. The review did
not see the chat.

Authority, unchanged since review 1:

- `description.md` and `plan.md` (modification times precede review 1;
  SHA-256 now `bd6f7003…5bdff` and `2995e031…d400`; review 1 recorded no
  digest to compare with).
- `documentation/decisions/0070-orchestrator-owned-instruction-copy.md`,
  Accepted, SHA-256
  `17adcdd615e37d45bc57eca9be277edf841e4d7b7851f4f63ac3bde1b5d5bb50`.
- `packages/orchestrator/instruction-baseline.json`, SHA-256
  `9bb5fc691e7220691f93289b3e2dbe1ea48dcba58a9cb2ca2a90d9484af22fbd`, equal
  to `instruction-baseline.sha256`.
- The three v1 baseline files equal the digest constants of
  `check-release.mjs`.

Delta since review 1, by modification time and by reading:

- F1: `packages/orchestrator/scripts/successor-baseline.mjs`,
  `packages/orchestrator/scripts/check-release.mjs` (diagnostic text),
  `packages/orchestrator/test/release-validation.test.ts`,
  `PROJECT_MANIFEST.md`, `documentation/engineering-quality.md`,
  `packages/orchestrator/MODULES.md`.
- F2: `packages/orchestrator/test/phase-instruction-fixtures.ts`. This file
  is a new entry of `git status --short`, which now lists 42 entries (review
  1: 41).
- F3: `implementation-report.md`, deviation 7.
- Reports: `change-report.md` (new), `implementation-report.md`,
  `test-report.md`.
- `packages/orchestrator/src/phase-resources.ts` has a later modification
  time but the same content: its diff against `HEAD` is the two header
  comment lines review 1 recorded.

Verification evidence. `plugins/banzai/scripts/verification.cjs inspect` for
`plan.md` (workflow `strict`) still returns `evidence: "unavailable"` and
`physicalAttempts: 0`, so command results in the reports are report claims.
The review ran the following itself. `git status --short` and the SHA-256 of
`git diff HEAD` were the same before and after.

Verified by running, on the working tree:

- `npm run build:dist`, `npm run typecheck`, `npm run release:validate`:
  passed.
- Four test files, one invocation each, 342 tests, 0 failed:
  `release-validation` (200), `phase-instructions` (8), `doctor` (57),
  `workflow-project` (77).
- ESLint on `successor-baseline.mjs`, `check-release.mjs`,
  `phase-instruction-fixtures.ts` and `release-validation.test.ts`: 0 errors,
  no warning in `successor-baseline.mjs`. Prettier check on the same files
  and `MODULES.md`: passed.
- The value of `FIRST_GENERATION_PIN` equals the SHA-256 of
  `JSON.stringify({ predecessorBaselineSha256, origin })` of the committed
  baseline.

Verified by running, on copies outside the repository (built in the copy
with `node scripts/build.mjs`, cwd `packages/orchestrator`; all copies are
deleted):

- Both reproductions of F1 from review 1 and the probes listed under F1 in
  "Previously Accepted Findings".
- One mutation: with the comparison against `FIRST_GENERATION_PIN` disabled,
  `release-validation.test.ts` has 197 of 200 passing; the three failures
  are the two new tests and the adapted transition test.
- Without `plugins/banzai/phases/`: release validation and
  `check-dist.mjs --parity-only` pass; `phase-instructions` 8, `doctor` 57
  and `workflow-project` 77 pass; `release-validation` has 1 failure of 200;
  the whole suite (`node scripts/test.mjs`) has 2183 tests, 2182 passed, 1
  failed. The one failure is R2-F1.
- Without `phases/`, `guidance/` and `policies/`: the three parity files
  pass again (142 tests).

Verified by reading only:

- No flag, environment variable, file or parameter reaches the constant:
  `successor-baseline.mjs`, `instruction-baseline.mjs` and
  `check-release.mjs` read no environment variable, and the validator calls
  `validateInstructionBaseline` unconditionally
  (`check-release.mjs:671-679`, `:3068`).
- Release validation never reads the transition journal or a `.pending`
  file.
- The three document statements and the test report sentence that F1 named.
- The parity tests still edit, add and delete installed text and skew a hook
  file (`phase-instructions.test.ts:173-216`, `:362-390`;
  `doctor.test.ts:1238-1275`; `workflow-project.test.ts:1562-1576`,
  `:1833-1837`, `:1890-1897`).
- The agreement of the three reports with each other.

## Summary

F1 and F3 are resolved. F2 is resolved for the three test files its fix
acceptance names, and not for its last clause: one test of
`release-validation.test.ts` still needs the plugin's `phases/` directory,
so removing the directory still fails `npm run verify` with one test. The
change report states the opposite. That remainder is R2-F1 and keeps the
verdict at `changes_requested`.

F1. The first generation is fixed by a digest constant outside the baseline
file, and replay compares it on every path that reads the file. Both
reproductions of review 1 now fail, the tool writes nothing in either case,
and a transition recorded on top of the anchored first generation still
validates. No remaining route was found by which release validation accepts
a changed pinned resource without a transition that cites an Accepted
decision record.

Protection of the constant itself: it has the protection of the three
closed-file digests in `check-release.mjs` and no more. It is a private
constant in tracked script code, its value appears in no test and no
document, and a change of the constant together with a baseline written
again would pass release validation and every test, exactly as a changed v1
file together with its digest constant would. Both show as a diff of a
release script. The v1 root pin has one further record that the new constant
lacks: an Accepted ADR body names its value
(`documentation/decisions/0044-instruction-baseline-evolution.md:56`). This
meets the fix acceptance, which asked for an identity fixed "as the v1 root
and the three closed files are fixed"; it is recorded here as a fact, not as
a finding.

The control remains what the documents say it is: a transition must cite a
decision record that is Accepted, and any Accepted record admits any key
(FR13). In the probe a transition that cited ADR-0070 itself was accepted
for a changed policy entry. `documentation/engineering-quality.md:181-183`
states this limit ("Hashes establish consistency, not human approval").

Report consistency. `implementation-report.md`, `test-report.md` and
`change-report.md` agree: 2183 tests on the final tree, 2181 labelled
historical (before the fixes), 2191 labelled historical (before the
package). The implementation report lists 15 added tests and says fifteen
came in; the number of removed tests (23 by subtraction) is not itemized
and was not checked. The focused counts match what this review measured
(200, 8, 57, 77; 342 and 142 as sums). The full-suite run on the copy also
counted 2183 tests. One loose count is not raised as a finding: the
requirement trace still says "four successor-baseline tests"
(`implementation-report.md:81`), which is the count before F1.

## Findings

### R2-F1 — One orchestrator test still needs the plugin's phase directory

- Severity: `should_fix`
- Category: `test`
- Confidence: `high`
- Evidence:
  - `packages/orchestrator/test/release-validation.test.ts:656` — the test
    declared at `:650`, whose name starts with
    `frozen phase resources follow the hook files only`, calls `appendFile`
    on `plugins/banzai/phases/review.md` of its fixture root. The fixture is a
    recursive copy of the repository's `plugins/banzai` (`:123`,
    `:202-211`), and nothing creates the directory, so the call fails with
    `ENOENT` when the plugin has no `phases/` directory.
  - `packages/orchestrator/test/release-validation.test.ts:937-941` — the
    decoupling test in the same file handles the absent directory
    (`readdir(...).catch`, `mkdir` with `recursive`), so the pattern that
    works is already in the file.
  - `documentation/work/261116-p11-orchestrator-instruction-copy/change-report.md:68-70`
    — "The manifest sentence on the phase documents needed no edit and now
    holds for tests as well." `:118` — "Section 2 holds for tests." Both are
    false for the test above.
  - `PROJECT_MANIFEST.md:333-334` — the sentence in question ("read by no
    skill, build or check").
  - The dependency is one test in one file: the full suite on a copy without
    the directory has no other failure.
- Violates: the fix acceptance of F2 in review 1, last clause ("The manifest
  sentence is true for tests as well, or is narrowed to what holds"), and
  the guarantee F2 names (the later package that removes
  `plugins/banzai/phases/` stays a plugin-only change); ADR-0070 section 2
  ("Removing them is a text change like any other") and its first positive
  consequence (a plugin text change leaves the orchestrator's build and
  tests untouched). Report accuracy: the two change-report statements.
- Why this is raised in a resolution review: it is the unresolved part of
  accepted finding F2, shown by evidence review 1 did not have. Review 1 ran
  three test files without the directory; this review ran the whole suite.
  Deduplication identity: `release-validation.test.ts`, the frozen-module
  test, `appendFile` into the copied plugin's `phases/`.
- Why the severity is `should_fix`: the remainder has the severity of the
  finding it belongs to. The false statements are in the fix record only and
  are corrected by the same change.
- Reproduction (on a copy of the tree outside the repository, with
  `node_modules` linked and `node scripts/build.mjs` run in
  `packages/orchestrator` of the copy):
  1. Remove `plugins/banzai/phases/` from the copy.
  2. In `packages/orchestrator` of the copy run
     `node scripts/test.mjs --file release-validation.test.ts`. Result: 199
     of 200 pass; the frozen-module test fails with `ENOENT` on `open` of
     `<fixture>/repository/plugins/banzai/phases/review.md`.
  3. `node scripts/test.mjs` on the same copy: 2183 tests, 2182 passed, 1
     failed, the same test. With the directory present the file passes (200
     of 200 on the working tree).
- Fix acceptance: on a copy of the tree without `plugins/banzai/phases/`,
  `node scripts/test.mjs` in `packages/orchestrator` has no failing test,
  and the frozen-module test still asserts that changed, added and missing
  plugin text leaves `phaseResourceBytes` unchanged. The two change-report
  statements are true, or are narrowed to what holds.

## Previously Accepted Findings

### F1 — resolved

The fix acceptance is met in each part.

- Control. `packages/orchestrator/scripts/successor-baseline.mjs:36-37`
  holds `FIRST_GENERATION_PIN`; `:157-165` compares it in `replay` with the
  identity of `{ predecessorBaselineSha256, origin }`. `replay` is called by
  `validateInstructionBaseline`, `describeInstructionTransition`,
  `evolveInstructionBaseline` (on the previous and on the next file) and
  `initializeInstructionBaseline` (before the dry-run return), so every
  entry point is anchored.
- Reproduction 1 of review 1 (steps 1–4), replayed: after the text entry
  `policies/security-assurance.md` changed, `--initialize` and
  `--initialize --check` exit 1 with "first generation differs from its
  pinned identity; record a transition instead", both baseline files keep
  their bytes, and after a rebuild release validation fails with
  `INSTRUCTION_RESOURCE_DRIFT` on
  `packages/orchestrator/instruction-baseline.json`.
- Reproduction 2 (step 5), replayed with a recorded transition: with a
  chain present `--initialize` is refused with "already holds a
  transition"; after a second text entry changed and both baseline files
  were deleted, `--initialize` is refused by the anchor and writes neither
  file; release validation fails with the files absent and fails again for a
  hand-written first generation of the current bytes with an empty chain
  and a matching sibling digest. The recorded transition cited ADR-0070 for
  a text entry, not ADR-0069 for the Codex manifest as in review 1; the
  mechanism under test is the same.
- Further probes, each refused by release validation and by
  `validateInstructionBaseline`: a changed `origin` with matching
  `expectations`; changed top-level `expectations` only ("Unrecorded
  successor instruction expectations"); duplicate `origin` keys in either
  order; reordered `origin` keys with a changed value; a transition with no
  authority; an `__proto__` key inside `origin`; an unanchored first
  generation offered as `previous` through the transition journal, with and
  without `--check`; `--describe` on an unanchored file.
- Legitimate change. On the anchored first generation `--describe`,
  `--authorization --check` and `--authorization` recorded a transition for
  a changed text entry; release validation passed after the rebuild. A
  second transition on top of the first also validated.
- Tests. `packages/orchestrator/test/release-validation.test.ts:3537-3586`
  covers the empty-chain case and `:3588-3656` the dropped-chain case; both
  run the tool and the real validator on a copied tree and assert the
  diagnostic and unchanged bytes. The adapted test (`:3367`, tail
  `:3509-3527`) asserts the refusal. The mutation run shows that exactly
  these three tests detect a removed anchor.
- Statements. `PROJECT_MANIFEST.md:353-358`,
  `documentation/engineering-quality.md:167-183`,
  `packages/orchestrator/MODULES.md:1403-1414` and `test-report.md:97-101`
  describe the control that exists.
- Constraints of the review 1 handoff: the baseline file and its sibling
  digest, ADR-0070, the three v1 files and the text entries of the frozen
  module are unchanged.

### F2 — resolved for the three named files; one remainder (R2-F1)

- Met: on a copy without `plugins/banzai/phases/`,
  `phase-instructions.test.ts`, `doctor.test.ts` and
  `workflow-project.test.ts` pass (8, 57 and 77 tests), and pass again
  without `guidance/` and `policies/`. Review 1 measured 18 failures there.
- Met: the tests still prove that installed text is no parity evidence and
  that a skewed hook is refused. The fixture
  (`packages/orchestrator/test/phase-instruction-fixtures.ts:19-27`)
  replaces the copied `phases/`, `guidance/` and `policies/` with the 23
  text entries of the frozen module and keeps the plugin's hook files. The
  tests then edit, add and delete that text and expect `verified`, and skew
  `hooks/spec-gate.cjs` and expect a mismatch or
  `INSTRUCTION_RESOURCE_MISMATCH`. No test file needed a change.
- Not met: "The manifest sentence is true for tests as well, or is narrowed
  to what holds." See R2-F1.
- Other orchestrator tests: `publication.test.ts` writes its own plugin text
  into its archive root and reads no plugin phase document. The runner
  source reads no plugin `phases/`, `guidance/` or `policies/` file. The
  full-suite run confirms that R2-F1 is the only dependency left.

### F3 — resolved

`implementation-report.md:321-325` records the direct runs as deviation 7
with a pointer to the results in its Checks section. No report claims
machine evidence: `test-report.md:36-39` and `change-report.md:147` state
that the helper was not used, and the helper still reports no evidence. The
fix acceptance offered this form.

## Deferred Coverage

- `npm run verify` as a whole, `npm run lint` over the package and
  `npm run format:check` were not re-run on the working tree. Their reported
  results (2183 tests, lint 0 errors and 424 warnings, formatter clean) are
  report claims. This review ran typecheck, release validation, four test
  files, and lint and Prettier on the changed scripts and tests. The test
  count 2183 was observed only on the copy without `plugins/banzai/phases/`.
- `npm run build:check`, `npm run release:check` and the publication release
  script were not run. Hosted CI has not run on this tree.
- That `plan.md` and `description.md` keep the bytes the owner approved was
  judged by modification time only; no earlier digest is recorded.
- That a change of `FIRST_GENERATION_PIN` together with a rewritten baseline
  passes every check was concluded by reading, not run.
- The items review 1 deferred stand as recorded there and were not
  reassessed: the behaviour of a published CLI 2.8.x, the publication check
  on a tree without a phase document, a removed pinned key that cannot be
  recorded, and the shadow record `EQ-S1`. Its location,
  `packages/orchestrator/scripts/phase-resources-build.mjs`, has not changed
  since review 1.
- No new Engineering Quality shadow candidate.

## Handoff

Human triage is required for R2-F1. F1 and F3 need no further action. The
review changed no source, test, requirement, plan, ADR or report, and fixed
nothing.

If R2-F1 is accepted, it goes to `quick-fix`. Its scope is one test in
`packages/orchestrator/test/release-validation.test.ts` and two sentences of
`change-report.md`. Constraints the fixer must keep are those of review 1:
no byte of the 23 text entries or of `PHASE_RESOURCE_DEFINITIONS` in
`packages/orchestrator/src/phase-resources.ts` changes; the three
`phase-guidance-*` files, `instruction-baseline.json` and its sibling digest
keep their bytes; ADR-0070 keeps its bytes (`17adcdd6…bb50`); `plan.md`
keeps its bytes and unchecked boxes; no file under `plugins/banzai/`
changes. The test must keep its three assertions on plugin text (changed,
added, missing).

If R2-F1 is declined or deferred, the recorded triage closes the review
without converting this verdict to `pass`; the later package that removes
`plugins/banzai/phases/` must then change this test as well.
