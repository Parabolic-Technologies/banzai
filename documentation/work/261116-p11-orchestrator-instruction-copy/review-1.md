# Implementation Review: 261116-p11-orchestrator-instruction-copy

- Format: `banzai-feature-review/v1`
- Feature slug: `261116-p11-orchestrator-instruction-copy`
- Review iteration: `1`
- Verdict: `changes_requested`
- Workspace digest: `not supplied`
- Review artifact: `documentation/work/261116-p11-orchestrator-instruction-copy/review-1.md`

## Review Scope

Standalone, source-read-only review of the uncommitted working tree on branch
`dev` against `HEAD` (`3b457dd`). Release 2.8.3 is commit `fa89da9`; the
orchestrator's `src/phase-resources.ts` is byte-identical at `fa89da9` and
`HEAD`. This artifact is the only file the review wrote.

Reviewed artifacts:

- `description.md` (FR1–FR29, AC1–AC15), `plan.md` (T001–T006, approved,
  checkboxes intentionally unchecked), `implementation-report.md` and
  `test-report.md` of this work directory.
- `documentation/decisions/0070-orchestrator-owned-instruction-copy.md`
  (Accepted) and its index row; the amended decisions only where the change
  touches them (ADR-0044 mechanism, ADR-0042 section 6, ADR-0020, ADR-0018,
  ADR-0033, ADR-0041).
- `PROJECT_MANIFEST.md` and the root `AGENTS.md`.
- The change: all 36 modified or deleted tracked paths of `git diff HEAD` and
  the four untracked files (`packages/orchestrator/instruction-baseline.json`,
  `instruction-baseline.sha256`, `scripts/successor-baseline.mjs` and its
  `.d.mts`).

Verification evidence. The verification helper
(`plugins/banzai/scripts/verification.cjs inspect`) reports the plan's
inventory as supported with `evidence: unavailable` and `physicalAttempts: 0`,
so the four mandatory checks exist only as report claims. The review therefore
ran the following itself, all on the unchanged working tree unless a scratch
copy is named. `git status --short` listed the same 41 entries before and
after.

Verified by running:

- Byte comparison with a script outside the repository: the module differs
  from `fa89da9` in its two header comment lines only; the
  `PHASE_RESOURCE_DEFINITIONS` and `EMBEDDED_PHASE_RESOURCES` literals are
  identical; all 23 text entries equal the plugin files at `fa89da9` and
  their own recorded digests; the two hook digests equal the current hook
  files (FR1, AC1).
- SHA-256 of the three v1 files equals the three constants in
  `check-release.mjs`; none of the three is modified (FR6). The successor
  file's digest equals its sibling pin, and its origin authority digest equals
  the current bytes of ADR-0070.
- `npm run release:validate`, `npm run typecheck`, `npm run build:check` and
  `npm run build:dist`: passed.
- Thirteen test files, one invocation each, 542 tests, 0 failed:
  `release-validation` (198), `phase-instructions` (8), `workflow-project`
  (77), `doctor` (57), `workflow-skills` (14), `adapters` (88), `setup-client`
  (1), `publication` (6), `project-adoption` (37), `agent-control` (14),
  `agent-control-cli` (12), `prompts` (28), `instruction-layouts` (2).
- ESLint on `successor-baseline.mjs`, `phase-resources-build.mjs`,
  `instruction-baseline.mjs` and `src/phase-instructions.ts`: 0 errors, no
  warning in the new module. Prettier check on the changed scripts and the
  new baseline file: passed.
- Four mutations on a scratch copy outside the repository, each detected by
  two failing tests: parity that never records a hook mismatch
  (`phase-instructions`); a validator that no longer pins the three closed
  files; successor validation that ignores drift of current bytes; an
  authority that no longer needs `Status: Accepted` (`release-validation`).
- The reproductions of F1 and F2 and the experiment behind the shadow record,
  all on the scratch copy.

Verified by reading only:

- The refactor of the v1 transition step into `applyTransitionStep` with
  `closedChainAdmits` keeps every v1 key rule of `HEAD` and makes none
  reachable from the successor.
- The build and `build:check` read only `hooks/hooks.json` and
  `hooks/spec-gate.cjs` from the plugin; `init-resources` comes from
  `documentation/verification-examples.md`.
- The publication check keeps the inventory and text-against-digest checks
  (`publication-check.mjs`, unchanged) and compares only hook files with the
  archives.
- The release validator's standalone-text checks lost only assertions about
  the removed skill; the removed tests pinned controls that ADR-0070 ends.
- No remaining test or script compares plugin text with runner text.
- The documentation and manifest changes, apart from the two statements named
  in F1 and F2.
- Unchanged by diff: `prompts.test.ts`, both `agent-control` tests,
  `instruction-layouts.test.ts`, `src/agent-control*.ts`,
  `plugins/banzai/hooks/`, `plugins/banzai/lib/`, `contracts/contract.json`.

## Summary

The package does what the description asks. The frozen module is exact, the
build and the build check are decoupled from plugin text, the v1 record is
pinned and replays without the plugin, parity is hook-only and still refuses a
skewed hook before any model starts, the `orchestrate` skill is gone with no
route left to it, and the control contract and prompt tests are untouched. The
new tests are behavioural and each mutation tried was caught.

Two gaps keep the verdict from `pass`. The successor baseline's first
generation has no anchor, so release validation accepts a baseline rewritten
with `--initialize` after a pinned resource changed, with no transition
recorded; this is the state the package ships in, and it remains reachable
after a transition exists (F1). The adapted parity tests read the plugin's
phase documents through the copied plugin fixture, so removing those
documents, which ADR-0070 calls a text change like any other, fails eighteen
orchestrator tests (F2). F3 is a low-severity note on verification evidence.

## Findings

### F1 — Release validation accepts a re-initialized successor baseline, so a pinned resource can change with no recorded transition

- Severity: `should_fix`
- Category: `adr`
- Confidence: `high` for the behaviour, `medium` for the severity
- Evidence:
  - `packages/orchestrator/scripts/successor-baseline.mjs:148-149` — replay
    takes `origin.expectations` and `origin.authorities` from the file itself;
    nothing outside the file fixes the first generation.
  - `packages/orchestrator/scripts/successor-baseline.mjs:332-343` and
    `:349-382` — `initializeInstructionBaseline` writes a new first generation
    from current bytes whenever the file holds no transition, and
    `holdsTransition` answers `false` when the file is absent.
  - `packages/orchestrator/scripts/check-release.mjs:47-60` and `:645-680` —
    the validator pins the three v1 files by digest constants, and
    `phase-resources-build.mjs:359` pins the v1 root; the successor has no
    counterpart.
  - `packages/orchestrator/instruction-baseline.json:74` — the delivered
    chain is empty, so the re-initializing form is open now.
  - `packages/orchestrator/test/release-validation.test.ts:3445-3463` — the
    test asserts that a first generation written again over a changed hook
    configuration and Codex manifest validates.
  - Statements that overstate the control: `test-report.md:92` of this work
    directory ("The successor baseline carries the guarantee from here on"),
    `PROJECT_MANIFEST.md:353-355` ("A pinned resource changes only through a
    transition that cites an Accepted ADR"),
    `documentation/engineering-quality.md:173-175`.
- Violates: ADR-0070 section 1 ("Its instruction entries change only through
  the successor baseline of section 3"), section 3 ("A pinned resource changes
  only through a transition in the successor baseline that cites an Accepted
  ADR") and compliance item 3; FR11 and AC6 in effect; decision driver 2 and
  FR1, whose 2.8.3 text has no enduring check. FR14 is met literally: the
  tool refuses while the file holds a transition. The plan's re-recording
  step (T006 step 4) needs the form once; the gap is that the validator
  cannot tell that one use from any later one.
- Reproduction (on a copy outside the repository, built with
  `node packages/orchestrator/scripts/build.mjs`; release validation passes
  on the copy first):
  1. Append a sentence to the `policies/security-assurance.md` text entry of
     `packages/orchestrator/src/phase-resources.ts` and set its `sha256` to
     the new text's digest. `check-release.mjs --root <copy>` fails with
     `INSTRUCTION_RESOURCE_DRIFT` on
     `packages/orchestrator/instruction-baseline.json`.
  2. Write `origin.json` with `schema: "banzai-instruction-origin/v1"`,
     `schemaVersion: 1` and the `authorities` array copied from the committed
     baseline's `origin` (ADR-0070 with its current digest).
  3. Run the tool's initializing form. It exits 0 with `"changed": true`.

     ```text
     node packages/orchestrator/scripts/instruction-baseline.mjs \
       --initialize origin.json
     ```

  4. Rebuild and validate: `release validation passed`. The baseline has
     `"transitions": []` and the new digest for the changed entry;
     `check-dist.mjs --package-root . --parity-only` passes. No new decision
     record was cited and no transition exists.
  5. Variant after a recorded transition: change the Codex manifest's
     `description`, publish the transition with `--authorization` under
     ADR-0069 (one transition recorded; `--initialize` is now refused with
     "already holds a transition"). Change the text entry as in step 1,
     delete `instruction-baseline.json` and `instruction-baseline.sha256`,
     run step 3. It exits 0, the file has `"transitions": []`, and release
     validation passes with the recorded chain gone.
- Fix acceptance: release validation fails with `INSTRUCTION_RESOURCE_DRIFT`
  when the successor's first generation differs from an identity fixed outside
  the baseline file (as the v1 root and the three closed files are fixed), or
  an equivalent control makes steps 1–4 and step 5 fail. A test covers both
  the empty-chain case and the dropped-chain case. The three overstated
  statements match the control that then exists.

### F2 — Orchestrator tests read the plugin's phase documents, so removing them fails `npm run verify`

- Severity: `should_fix`
- Category: `test`
- Confidence: `high`
- Evidence:
  - `packages/orchestrator/test/phase-instruction-fixtures.ts:13` — the
    shared fixture is a copy of `plugins/banzai/`; no test creates the text
    files it then skews.
  - `packages/orchestrator/test/phase-instructions.test.ts:189-192`
    (`readFile` of `phases/fix.md`) and `:365` (`writeFile` into `phases/`).
  - `packages/orchestrator/test/workflow-project.test.ts:94`, `:1567`,
    `:1574` (`rm` of `phases/implementation.md` without `force`), `:1677`,
    `:1835`, `:1891`.
  - `packages/orchestrator/test/doctor.test.ts:1241` and `:1269`.
  - The same pattern on plugin guidance, by reading only:
    `phase-instructions.test.ts:194`, `workflow-project.test.ts:1575`,
    `doctor.test.ts:1276` (`rm` of a guidance file without `force`).
  - `PROJECT_MANIFEST.md:333-334` states that the seven phase documents "are
    read by no skill, build or check"; the decoupling test says the same at
    `packages/orchestrator/test/release-validation.test.ts:869` and proves it
    for release validation and the build check only.
- Violates: ADR-0070 section 2 ("The plugin's phase documents are read by
  nothing after this decision. Removing them is a text change like any
  other"), decision driver 1 and the first positive consequence (a plugin
  text change leaves the orchestrator's build and tests untouched); FR2 in
  effect, because a missing plugin phase document forces edits to tracked
  orchestrator test files. Guarantee at risk: the later text package that
  removes `plugins/banzai/phases/` (description non-goal, ADR-0070 section 2)
  must stay a plugin-only change; under the path-scoped gate of ADR-0071 such
  a change would skip the orchestrator tests that it breaks. Current evidence
  cannot detect this because every test run has the phase documents present.
- Reproduction (on a copy outside the repository, built as in F1):
  1. Remove `plugins/banzai/phases/`.
  2. `check-release.mjs --root <copy>` passes and
     `check-dist.mjs --package-root . --parity-only` passes.
  3. In `packages/orchestrator` of the copy, run
     `node scripts/test.mjs --file <name>.test.ts`:
     `phase-instructions` 2 of 8 fail, `doctor` 1 of 57 fails,
     `workflow-project` 15 of 77 fail. Every failure is `ENOENT` on
     `<fixture>/phases/<name>.md`. With the directory present all three files
     pass.
- Fix acceptance: with `plugins/banzai/phases/` absent from a copy of the
  tree, `phase-instructions.test.ts`, `doctor.test.ts` and
  `workflow-project.test.ts` pass, and they still show that edited, added or
  missing installed text leaves parity `verified` while a skewed hook is
  refused. The manifest sentence is true for tests as well, or is narrowed to
  what holds.

### F3 — The four mandatory checks have no machine evidence

- Severity: `nit`
- Category: `plan`
- Confidence: `high`
- Evidence: paths are relative to
  `documentation/work/261116-p11-orchestrator-instruction-copy/`.
  `test-report.md:35-38` states that the checks were run directly and the
  standalone verification helper was not used. `verification.cjs inspect` for
  `plan.md` (workflow `strict`) returns `supported: true`,
  `evidence: "unavailable"`, `physicalAttempts: 0`. The plan's inventory
  (`plan.md:467-567`) declares all four checks with `"evidence": "fresh"`.
  The implementation report's deviation list
  (`implementation-report.md:280-310`) does not name this.
- Violates: plan section "Task Verification Obligations"; the installed
  Test Assurance policy, task verification evidence (absent and passed are
  recorded distinctly). No false claim was found: the report says plainly
  that no record exists, and this review reproduced `release:validate`,
  `typecheck`, `build:check` and 542 tests.
- Reproduction: write a `banzai-verification-request/v4` request for
  `documentation/work/261116-p11-orchestrator-instruction-copy/plan.md` with
  workflow `strict` and run
  `node plugins/banzai/scripts/verification.cjs inspect --json <request>`.
- Fix acceptance: after the accepted fixes, the four checks of the inventory
  run on the final tree through the helper's `execute` form, or the
  implementation report records the direct runs as a deviation with their
  results.

## Previously Accepted Findings

None.

## Deferred Coverage

- `npm run verify` as a whole and `npm run format:check` were not re-run.
  Their reported results (2181 tests, lint 0 errors and 424 warnings,
  formatter clean) are report claims. The review ran typecheck, the build
  check, release validation, 13 of the test files and lint and Prettier on
  the changed scripts only.
- `npm run release:check` and the publication release script were not run;
  the plan does not require them. No test runs the publication check on a
  tree without a plugin phase document while `publication-policy.json` still
  classifies the seven documents (also listed in the test report).
- The pre-change counts (2191 tests, 427 lint warnings) were not checked.
- The behaviour of a published CLI 2.8.x against this plugin was not tested;
  it is an owner follow-up in the implementation report.
- Hosted CI has not run on this tree.
- A removed pinned key cannot be recorded: `changedKeys`
  (`packages/orchestrator/scripts/successor-baseline.mjs:87-95`) lists only
  keys present in the current capture, so a text entry dropped from the
  module stays in the expectations and validation reports drift. Read only,
  not reproduced.
- EQ-SHADOW: candidateId=EQ-S1; ruleId=EQ-03; severity=nit; confidence=high; evidence=packages/orchestrator/scripts/phase-resources-build.mjs:430-442 rawResourceKeys and :830-840 closedChainAdmits derive the closed v1 chain's admissible keys from the live PHASE_DEFINITIONS constant, which :227-238 moduleWithHookDigests forces equal to the module's phase table; impact=a successor transition on the definitions key that drops a phase, guidance or policy name used by a v1 transition makes validateClosedGuidanceBaseline fail with "Invalid or protected instruction transition scope" and release validation report the closed record as no longer replaying, reproduced on a scratch copy by removing planning-review from the constant; remediation=derive the closed chain's raw keys from the closed record's own data or a constant frozen with it instead of the live phase table; references=ADR-0070 section 3 and plan Technical Breakdown section 1 invariant 2; verification=replay the closed baseline with a phase removed from the live table and expect success; dedupeKey=EQ-03|closedChainAdmits.rawResourceKeys|ADR-0070-section-3|closed-replay-coupled-to-live-phase-table; waiver=not_applicable (shadow-only)

## Handoff

Human triage is required for F1, F2 and F3. The review changed no source,
test, requirement, plan, ADR or report, and fixed nothing.

After triage, only accepted findings go to `quick-fix`. Constraints the fixer
must keep: no byte of the 23 text entries or of `PHASE_RESOURCE_DEFINITIONS`
in `packages/orchestrator/src/phase-resources.ts` changes; the three
`phase-guidance-*` files keep their bytes; `plugins/banzai/hooks/`,
`plugins/banzai/lib/` and the control contract stay untouched; ADR-0070 keeps
its current bytes, because the successor baseline's origin cites its digest
(`17adcdd6…bb50`); `plan.md` keeps its bytes and unchecked boxes. A fix for F1
that changes the baseline file must leave `instruction-baseline.sha256` equal
to the file's digest. The shadow record and the other deferred items need no
disposition.
