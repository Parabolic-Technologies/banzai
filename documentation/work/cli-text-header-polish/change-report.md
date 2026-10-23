# CLI Header and Section Layout

Date: 2026-10-23

The user selected a compact text-only launch header after reviewing the
font-dependent block-element logo. This is standalone UI polish with no upstream
feature document or accepted review findings. No ADR lifecycle change is needed.
The follow-up scope adds consistent section spacing and headings, a divider
before run menus, aligned model readiness markers, and one planning-review
artifact path per status display.

## Changes

- Removed the two block-element logo rows from the launch header.
- Applied the existing brand colour to the bold `banzai` title. The version
  remains beside it, with repository context on the next row. Removed the
  `spec-driven run orchestrator` tagline in the latest requested follow-up.
- Aligned the title and repository rows at the left edge and reduced phase-row
  indentation from four columns to two.
- Updated existing model/readiness expectations and removed the obsolete test
  whose sole guarantee was the old logo's exact glyph arrangement.
- Removed the no-update message and its preceding blank line when no model
  advisory exists, as requested in the user's follow-up. Updated the existing
  startup assertion; available-update notices retain their existing coverage.
- Grouped status content with one blank line before each section, a bold heading,
  and two-space body indentation. Verification, planning review, workflow
  reasoning, artifacts, and blocked/decision sections now follow the same layout.
- Added a dim horizontal divider with one blank line on either side immediately
  before run action menus, including the empty home screen and repeated menus
  after time details. Existing review and human-time content remains visible.
- Aligned effort and timeout columns before readiness markers, including mixed
  `max`/`xhigh` values and different timeout lengths.
- Kept the canonical planning-review artifact line and removed its duplicate
  from the independent-review outcome sentence in shared status text.

Changed files:

- `packages/orchestrator/src/interactive.ts`: header, sections, and run menus.
- `packages/orchestrator/src/workflow.ts`: shared planning-review status copy.
- `packages/orchestrator/src/ansi.ts`: brand-style documentation.
- `packages/orchestrator/test/interactive.test.ts`: existing UI expectations.
- `packages/orchestrator/MODULES.md`: maintained presentation facts.
- This change report.

## Boundaries and Documentation

Security exposure: none introduced or widened. The change adjusts presentation
formatting and status copy, reusing existing terminal styling and escaping.

No accepted ADR body, public machine contract, persisted format, authentication
decision, or dependency changes. There are no skipped review findings or
unresolved escalation triggers. Material Engineering Quality deviations: none.

The module reference and brand-style comment now describe the text title. The
root manifest's module ownership and terminal-presentation facts remain accurate;
no root-manifest edit was necessary. Pre-existing release work is outside scope.

## Structural Assessment

### Initial Header and Advisory Changes

The pre-edit ESLint check reported 18 existing warnings in `interactive.ts`,
including a nested readiness-marker ternary in `renderHeader`. This adopted
threshold signal triggers an assessment even though the warning is pre-existing.

- Owner: `interactive.ts::renderHeader`, called by `presentLaunch`. It formats
  supplied repository, configuration, and readiness data through `InteractiveIO`
  and `Styler`; collection and authentication remain with their existing owners.
- Disposition: retained. Title, repository context, and phase rows share the
  same launch-presentation responsibility and lifecycle. Extracting a logo or
  title helper would add a boundary with no distinct dependency or reuse need.
- Reuse: existing `Styler.brand`, `bold`, and `dim` provide the required styling;
  no new helper, rule implementation, dependency, or shared state was added.
- Invariants: retain version/context information, per-role readiness, failed
  vendor notices, and the existing plain/colour-depth behaviour. Changes are
  limited to visual layout and silence when no model advisory exists.
- Authority: within the user's selected UI scope. Existing lint warnings remain
  visible debt; this change does not expand into interactive-flow refactoring.

The follow-up also retains `presentLaunch` as the owner of advisory display.
Its previously measured complexity of 17 exceeds the advisory threshold of 15;
removing two writes from its existing empty-advisory return adds no condition,
dependency, responsibility, or effect. A new helper would have no independent
purpose. Existing model-update behavior and ownership remain in place.

## Verification and Assurance

The following results are historical/pre-follow-up evidence from the logo
removal. They do not claim verification of the subsequent no-update-message
removal; fresh follow-up results are recorded separately below.

- Pre-edit targeted ESLint: passed with 0 errors and 18 existing warnings.
- `npm run build:dist`: passed; rebuilt the ignored local CLI bundle. The
  installed `banzai` command resolves to this workspace's
  `packages/orchestrator/dist/banzai.mjs`, so the next launch uses the update.
- `npm run verify`: typecheck passed and lint completed with 0 errors and 415
  advisory warnings. Tests reported 1,791 total, 1,731 passed, and 60 failed;
  every failure was in `release-evidence.test.ts`, where the sandbox denied
  the local HTTP listener with `listen EPERM` on `127.0.0.1`. A separate
  loopback-listener probe confirmed this environment restriction. The aggregate
  command therefore exited 1 and did not reach its build-check step.
- `node --test test/release-evidence.test.ts`, from `packages/orchestrator/`
  with sandbox escalation for the isolated local HTTP fixtures: all 62 tests
  passed, with 0 failures or skips. This fresh retry covers the failed file;
  the two already-passing tests in that file are included in this count.
- `npm run build:check`: passed separately, including generated-source and
  distribution parity checks. All required verification components now have
  passing evidence across the initial run and the scoped retry; the original
  `npm run verify` exit remains recorded as failed, not rewritten as a pass.
- `npm run format:check`: passed. The separate Prettier check for this report
  also passed.
- `git diff --check`: passed.
- Display smoke through `runInteractive` with injected repository, models, and
  authentication: inspected the compact header with sample values from the
  supplied screenshot. Styled and plain output match after ANSI removal; the
  plain output contains no escape controls. The styled title uses bold and
  `#FF5A3C`. No real vendor process or workflow was invoked by this smoke.

Raw local verification and preview files are ignored under `.banzai/tmp/`.
Assurance is owned by the existing interactive and ANSI suites plus the display
smoke. No new test was added for this reversible visual change. The removed test
asserted only intentionally retired artwork; model and readiness guarantees
remain covered. Native terminal visual acceptance remains with the user.

### No-Update Message Follow-Up

These results precede the section-layout follow-up below and are historical
evidence for the no-update-message removal.

- `npm run build:dist`: passed; the linked local CLI includes this follow-up.
- `npm run verify`: passed with all 1,791 tests passing, 0 failures, and no
  skipped or cancelled tests. Typecheck, lint, and build parity also passed.
  This run allowed the local HTTP fixtures that the earlier sandboxed run
  could not start.
- `npm run format:check`: passed.
- Separate Prettier check for this report: passed.
- `git diff --check`: passed.

No new test was added: the existing startup test now asserts that the no-update
message is absent, alongside the existing available-update and authentication
checks. The module reference documents the quiet empty-advisory path. The
security exposure and ADR conclusions above still apply.

### Section Layout Follow-Up

The user explicitly authorized all five layout changes listed in the scope.
This follow-up does not hide details or add drilldown behavior.

Structural assessment:

- `interactive.ts::renderStatus` remains the presentation owner. Its existing
  complexity warning (52 before this follow-up) required a boundary assessment.
  The section layout is the repeated responsibility extracted into the local
  `renderSection` helper; it adds spacing, a heading, and wrapped indentation
  without deriving workflow or verification results. The existing
  `taskVerificationStatusLines`, `configurationDecisionLines`, and
  `planningReviewStatusLines` remain the semantic owners. `reviewStatusLines`
  still distinguishes human-triaged completion from reviewer pass.
- `renderHeader` retains model-column ownership and its existing readiness
  decision. Widths are calculated from unstyled labels; padding does not depend
  on ANSI codes or leave a trailing gap when authentication is not supplied.
- The existing human-time menu wrapper is renamed `withRunMenu` and also owns
  the divider before selection. This keeps one menu-composition boundary and
  preserves optional time actions and the final exit anchor. The wrapper
  forwards the selection abort signal and reads the live underlying width.
  `renderMenuSeparator` is reused by the empty home screen; no prompt adapter,
  workflow mutation, or new module dependency is introduced.
- `workflow.ts::planningReviewStatusLines` remains the shared owner of planning
  status copy for interactive and ordinary CLI text. Its artifact path appears
  once; persisted outcomes, review artifacts, events, and JSON are unchanged.
- Post-edit ESLint still reports 18 warnings in `interactive.ts`, with no
  errors or new warnings. `renderStatus` complexity decreases from 52 to 49.
  The larger state-driven renderer remains explicit local debt; unrelated
  workflow dispatch and decision ownership are outside this UI scope.

Verification:

- Focused existing interactive suite: 96 tests passed, no failures or skips.
  Updated the existing workflow-reason assertion for its heading/body layout;
  no new layout-only test was added.
- Targeted ESLint for both edited source files: passed with advisory warnings
  and no errors.
- `npm run build:dist`: passed; the linked local CLI bundle includes the layout.
- Display smoke through `runInteractive`: verified bold headings, one blank
  line between sections, one planning-review path, and aligned readiness for
  mixed efforts and 5m/60m/120m timeouts. Plain and styled captures match after
  ANSI removal at widths 40 and 96; plain output has no escape controls.
  Also checked the empty home screen, absent authentication/time gateways,
  repeated menus after time details, and a width change from 40 to 96.
  The injected runner performed no workflow or vendor operations.
- `npm run verify`: passed, with all 1,791 tests passing, 0 failures, and no
  skipped or cancelled tests. Typecheck, lint, and distribution parity passed;
  lint retains 415 advisory warnings and 0 errors. Local HTTP fixtures ran with
  the required sandbox escalation.
- The final request to remove `spec-driven run orchestrator` arrived after the
  full suite had bundled its tests. After that literal-only edit, rebuilt the
  distribution and reran all 96 interactive tests, the display smoke,
  typecheck, lint, and format check successfully. The aggregate suite's final
  distribution-parity step also completed after this rebuild. The first line
  now contains only the styled name and version.
- Separate Prettier check for this report and `git diff --check`: passed.

Smoke source, captures, and verification logs remain ignored under
`.banzai/tmp/`. The maintained module reference describes the new layout; the
root manifest's ownership and behavior remain accurate.
