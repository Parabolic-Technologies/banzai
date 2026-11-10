# Implementation Review: interactive-slug-selection

- Format: `banzai-feature-review/v1`
- Feature slug: `interactive-slug-selection`
- Review iteration: `1`
- Verdict: `changes_requested`
- Workspace digest: `not supplied`
- Review artifact: `documentation/work/interactive-slug-selection/review-1.md`

## Review Scope

Standalone strict review, fresh reviewer with no planner or implementer
transcript. Reviewed on 2026-11-10 against the uncommitted working tree on
branch `dev`:

- Work documents: `documentation/work/interactive-slug-selection/description.md`
  (FR1-FR17, AC1-AC16), `plan.md` (owner-approved 2026-11-10, T001-T008, v2
  verification inventory), `implementation-report.md`, `test-report.md`.
- Decisions: `documentation/decisions/0066-date-prefixed-work-and-initiative-slugs.md`
  (Accepted), lifecycle lines added to ADR-0054 and ADR-0061,
  `documentation/decisions/README.md`.
- Source: `packages/orchestrator/src/workflow/domain/run-identity.ts`,
  `src/interactive.ts`, `src/cli.ts`, `src/agent-control-cli.ts`,
  `src/work-documents.ts`, `import-boundaries.mjs`,
  `scripts/phase-resources-build.mjs`, `plugins/banzai/lib/work-documents.mjs`
  and `.d.mts`; generated `src/phase-resources.ts` and
  `phase-guidance-current.*` checked against the ADR-0066 transition.
- Guidance and docs: `plugins/banzai/policies/artifact-storage.md`,
  `plugins/banzai/skills/initiative/SKILL.md`,
  `documentation/artifact-storage.md`, `documentation/orchestrator.md`,
  `PROJECT_MANIFEST.md`, `packages/orchestrator/MODULES.md`,
  `publication-policy.json`.
- Tests: new `test/run-identity.test.ts`; changed `interactive`,
  `agent-control-cli`, `work-documents`, `workflow`, `phase-instructions`,
  `release-validation` tests.

Deterministic evidence:

- Standalone helper `decide` for round `a6180f65-25b6-49a7-9b4d-5d0700a1d029`
  (read-only, from the reviewer context): both required checks report
  `unavailable` ("Latest physical attempt does not establish applicable
  success"), because documents changed after the suite and the reviewer
  process context differs. The physical records under
  `.banzai/verification/7fade36c…/` show `final-verify` exit 0 with 2165 of
  2165 tests and `build:check`, `final-diff-whitespace` exit 0, and the earlier
  round `6d60f84a` failing 2164/2165 with `INSTRUCTION_PAYLOAD_MISMATCH`, as
  reported. All changed source predates the passing attempt (11:10:27Z); only
  the manifest, decision index and reports changed afterwards.
- Focused reproductions (reason: helper evidence is unavailable from this
  context), output root `packages/orchestrator/.dist-check-review`, removed
  afterwards: `run-identity` 3/3, `work-documents` 16/16,
  `agent-control-cli` 11/11, `phase-instructions` 7/7, `interactive` 121/121,
  `workflow --pattern "existing initiative"` 1/1,
  `release-validation --pattern "ADR-0066"` 1/1. `git diff --check` exit 0.
- ADR-0054 image admission verified: HEAD digest `fa51f115…` and working
  digest `3456df71…` equal the map in `phase-resources-build.mjs`. The
  baseline transition authority digest `409ebbb1…` equals the current
  ADR-0066 bytes.

## Summary

The functional behavior matches FR1-FR17: the pure prefix rule, entry-point
finalization at all three production `runner.start` calls, the shared
both-root conflict check before the work directory is created, the interactive
slug step with the exact copy and ordering, unchanged runner, contracts and
historical runs, and the guidance and lifecycle edits. No spec violation was
found. The verdict is `changes_requested` because the implementation and test
reports claim two test detections that the tests cannot make (F1, F2), which
the review rules classify as blockers; F1 also leaves the owner-chosen
local-date guarantee without regression evidence. Should-fix items cover a
path-resolution deviation from a binding plan constraint (F3), an ADR-0066
confirmation item recorded neither as met nor as a gap (F4), and stale
`MODULES.md` entries (F5).

## Findings

### F1 — The run-identity test cannot detect a UTC-based prefix, yet the reports claim it does

- Severity: `blocker`
- Category: `test`
- Confidence: `high`
- Evidence: `documentation/work/interactive-slug-selection/implementation-report.md:133`
  claims "`run-identity.test.ts` fails if the prefix uses UTC";
  `test-report.md:71` lists "Prefix is the zero-padded local date" as
  protected by that unit test. `packages/orchestrator/test/run-identity.test.ts:10-15`
  builds every instant at local noon (`new Date(2026, 10, 10, 12)`,
  `new Date(2027, 0, 5, 12)`). For any zone with an offset under 12 hours,
  local noon has the same UTC calendar date, so an implementation using
  `getUTCFullYear/getUTCMonth/getUTCDate` or `toISOString()` returns the same
  `261110-` and `270105-`. The midnight test
  (`interactive.test.ts:1441`) catches a UTC implementation only in
  negative-offset zones, not in UTC (CI) or the maintainer's positive offset.
- Violates: FR1 and ADR-0066 Decision 2 (local calendar date, owner card C1);
  Test Assurance ("Reports must claim only behavior demonstrated by
  assertions"); review rule: false report claim; EQ-08.
- Reproduction: `for tz in UTC Europe/Kyiv America/Los_Angeles Asia/Tokyo; do TZ=$tz node -e '<compute UTC-getter prefix of new Date(2026,10,10,12) and new Date(2027,0,5,12)>'; done`
  prints `261110- 270105-` in every zone, identical to the asserted values.
  Plausible regression: replacing the local getters with the common
  `toISOString()` idiom.
- Fix acceptance: a test in the default suite fails when the prefix is
  derived from UTC fields in UTC and positive-offset zones, for example with
  an instant whose local and UTC calendar dates differ in the test process
  (chosen from `getTimezoneOffset()`, or a child process with a fixed
  non-UTC `TZ`), while the existing assertions still pass; or both reports
  stop claiming UTC detection and record local-versus-UTC as inspection-only.

### F2 — No test detects a change in validation precedence, yet the reports claim it does

- Severity: `blocker`
- Category: `test`
- Confidence: `high`
- Evidence: `implementation-report.md:136-138` claims the slug-step tests fail
  "if a validation message or its order changes"; `test-report.md:77` claims
  "Validation order and exact messages". The precedence is in
  `packages/orchestrator/src/interactive.ts:967-977` and
  `src/workflow/domain/run-identity.ts:49-52`. Every input in
  `interactive.test.ts:1394-1435` and `run-identity.test.ts:29-40` fails at
  most one check (`Login_Fix` is short; `"a".repeat(94)` is well-formed; the
  conflicts are short, valid slugs), so checking length before format, or
  querying conflicts first, passes all tests.
- Violates: plan T004 step 3 ("format, then length, then conflict"); FR7;
  Test Assurance report-accuracy rule; review rule: false report claim; EQ-08.
- Reproduction: Not provided. Inspection of the listed inputs shows no input
  that fails two checks.
- Fix acceptance: tests include inputs that fail two checks and assert the
  higher-precedence message, for example an over-long uppercase candidate
  that shows the format message and an over-long candidate that the fake
  gateway also reports as existing that shows the length message; or both
  reports drop the order claim.

### F3 — The conflict check resolves paths outside the contained-path helpers

- Severity: `should_fix`
- Category: `plan`
- Confidence: `high`
- Evidence: `plugins/banzai/lib/work-documents.mjs:67-73` adds `occupied()`,
  which calls `lstat(path.join(root, relative))`; `workSlugConflict`
  (`:80-85`) and `createExecutionBinding` (`:94-95`) use it for
  `documentation/initiatives/<slug>` (and the work root in the query).
  `lstat` follows symlinks in intermediate components, whereas `safePath`
  (`plugins/banzai/lib/project-files.mjs:81-111`) refuses any symlinked
  component. With a symlinked `documentation/` or `documentation/initiatives/`
  the check consults a directory outside the repository. The slug is
  validated first, and the effect is fail-closed (extra refusals only), so the
  security impact is low. The approved plan requires "Resolve paths only
  through the existing contained-path helpers" (`plan.md:163-164`). The
  implementation report records no deviation, and its Structural Assessment
  (`implementation-report.md:172-175`) contains no reuse-search line for the
  new helper, which would have found `safePath`.
- Violates: plan T003 binding constraint; ADR-0050 reuse-search duty
  (`policies/engineering-quality.md`, Structural Assessment Triggers);
  undocumented deviation; EQ-01.
- Reproduction: Not provided. In a test repository, replace
  `documentation/initiatives` with a symlink to an outside directory that
  contains `<slug>/`; `workSlugConflict` returns
  `documentation/initiatives/<slug>` instead of refusing the unsafe path.
- Fix acceptance: the conflict query and binding refusal resolve both roots
  through the contained-path helpers, so a symlinked component is refused with
  `ARTIFACT_UNSAFE_PATH` and not followed, with a focused work-documents
  assertion; or the implementation report records the deviation, its
  rationale and the reuse-search line.

### F4 — ADR-0066 confirmation item 3 is neither evidenced as written nor recorded as a gap

- Severity: `should_fix`
- Category: `adr`
- Confidence: `medium`
- Evidence: `documentation/decisions/0066-date-prefixed-work-and-initiative-slugs.md:244-247`
  requires `banzai run --slug` and `banzai control start --slug` tests showing
  the final slug in run state, run ID, work directory and status, plus the
  initiative-root refusal with no work directory and no active run. The only
  CLI-level test, `test/agent-control-cli.test.ts:568`, uses a `FakeRunner`,
  so it shows the runner input but not state, run ID, work directory or real
  status. `banzai run --slug` has no test, and the refusal is shown only at
  runner level (`workflow.test.ts`). `implementation-report.md:70-89` labels six
  items "ADR-0066 compliance items", which do not match the ADR's seven, and
  states nothing about item 3. Its premise that "no test harness drives
  `cli.ts` `run`" (`:165-166`) holds only literally:
  `test/cli-routing.test.ts:366` already spawns `dist/banzai.mjs` in test
  repositories, and the AC12 refusal happens in `createExecutionBinding`
  before any vendor preflight. The approved plan's claim that "Every
  Compliance item maps to T002-T006 evidence" (`plan.md:398`) does not hold
  for item 3.
- Violates: ADR-0066 Compliance and Confirmation item 3; review audit items 5
  and 6; AC11/AC12 CLI-level evidence; EQ-08.
- Reproduction: Not provided.
- Fix acceptance: a spawned-CLI test runs `banzai run --slug <subject>` against
  a repository holding `documentation/initiatives/<today's prefix><subject>/`
  and asserts exit 1, a message naming that path, no work directory and
  `NO_ACTIVE_RUN`, computing the prefix from the same clock source and
  tolerating a midnight boundary. Alternatively, the implementation report
  maps every ADR-0066 compliance item and records that item 3 is met only by
  CLI finalization inspection plus unchanged runner tests under approved plan
  T005, with the residual risk.

### F5 — `MODULES.md` entries for the changed modules are stale

- Severity: `should_fix`
- Category: `documentation`
- Confidence: `high`
- Evidence: `packages/orchestrator/MODULES.md:7-8` says the file "is updated
  with the module it describes". `:651-652` still lists only `runId` and
  `requireSlug` for `run-identity.ts`, which now owns the ADR-0066 prefix,
  finalization and classification rule. `:330` describes `interactive.ts` as
  deriving the slug via `generateFeatureSlug`, without the slug step and its
  `clock` and `workSlugs` options. The `work-documents.ts` entry (`:12-18`)
  omits the both-root conflict query.
- Violates: AGENTS.md hard rule "Keep docs in sync with code and manifest
  changes"; review audit item 12.
- Reproduction: Not provided.
- Fix acceptance: the `run-identity.ts`, `interactive.ts` and
  `work-documents.ts` entries describe the new exports and behavior with an
  ADR-0066 reference, and no entry contradicts the code.

### F6 — `banzai help run` still presents `--slug` as the run slug

- Severity: `nit`
- Category: `documentation`
- Confidence: `medium`
- Evidence: `packages/orchestrator/src/cli.ts:305-308`
  (`Example: banzai run --slug fix-login …`) and `:364` say nothing about the
  date prefix. ADR-0066 Consequences say that scripts assuming equality must
  read the slug from status. The approved plan maps FR17's "CLI reference" to
  `documentation/orchestrator.md`, which is updated, so this is polish.
- Violates: ADR-0066 Consequences (discoverability), optional.
- Reproduction: `banzai help run`.
- Fix acceptance: the `run` help states that the run starts with the
  date-prefixed slug reported by status, with any pinned help test updated.

## Previously Accepted Findings

None.

## Deferred Coverage

- `npm run verify` was not rerun. Final-suite success rests on the physical
  attempt logs cited above, and the helper's `checked`/`passed` applicability
  claimed in the implementation report could not be reproduced from this
  context. That is not treated as a false claim.
- The real `@inquirer/input` path was inspected, not exercised: it passes the
  raw answer to the async `validate` and returns the same string, so
  `accepted.value === value` holds. An I/O error thrown by the conflict
  gateway inside `validate` (`ARTIFACT_IO_ERROR`) was not traced through the
  prompt's error handling.
- AC14 and AC15 (standalone skill and initiative guidance) were checked by
  inspection only. Wording matches FR13-FR16; agent compliance is
  guidance-enforced by design (ADR-0066 Decision 5).
- The ADR-0066 accepted-proposal SHA-256 (`5de91423…`) could not be
  reconstructed independently, so body immutability between proposal and
  acceptance rests on the recorded lifecycle text.
- `npm run release:check` and the PR CI `HOOK_CHANGED_WITHOUT_VERSION_BUMP`
  refusal were not run. The version bump is an owner delivery follow-up
  recorded in the plan and report.
- `npm run format:check` was not rerun.
- EQ-SHADOW: candidateId=EQ-S1; ruleId=EQ-06; severity=nit; confidence=medium; evidence=packages/orchestrator/src/workflow/domain/run-identity.ts:3-6 SLUG and MAX_WORK_SLUG_LENGTH duplicate plugins/banzai/lib/work-documents.mjs:15-19 workDirectory bound; impact=a later change to one bound makes the interactive prompt accept slugs that run start refuses, or reject slugs it accepts; remediation=derive the interactive bound from the shared library value or pin equality in a test; references=ADR-0066 Decisions 3-4, plan T002/T003; verification=one assertion that both owners agree on the bound and pattern; dedupeKey=EQ-06|work-slug-bound|ADR-0066-D3-D4|duplicated-rule; waiver=not_applicable (shadow-only)

## Handoff

Human triage is required for F1-F6. Only accepted findings go to
`quick-fix`. For F1 and F2 the fixer may add the discriminating tests or
narrow both reports' claims; F1's tests are preferred because the local-date
guarantee is owner-chosen and has a plausible regression path. F3 and F4
accept either the code or test change, or a truthful report record. No source,
test, plan, ADR or report was changed by this review.
