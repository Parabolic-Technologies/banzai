# Compact Interactive Time UI — Change Report

Date: 2026-10-23. Work ID: `a91ef415-f9ee-43cf-9ab8-94d1c1a00551`.

Authority: the runner-supplied original Compact design request, under
[ADR-0034](../../decisions/0034-durable-human-time-observations.md).
No accepted review finding IDs were supplied. This is scoped UI polish, not
resolution of another review or a change to timing semantics.

The supplied binding selects this directory and permits this report only.
The original request's suggested `human-time-compact-ui/` directory is absent;
no second work directory was created. No upstream `description.md`, `work.md`,
`plan.md`, `implementation-report.md` or `test-report.md` exists in the selected
binding. No strict task ledger or machine-owned evidence was authored.

## What Changed and Why

- `Time for this run` shows the optional active estimate before recorded
  decision waiting. Missing, saved (including zero), and unavailable estimates
  have different copy and action labels.
- The known response subtotal includes explicit timed/answered coverage. Valid
  partial inventory and `CAPTURE_GAP` retain known durations; coverage wording
  names neither an unsupported cause nor a specific missing wait.
- `Time details · this run` has its own episode layout, subtotal, coverage,
  recovery section, recording/attribution notes and secondary diagnostic codes.
  All-answered decision lists state that status once. Mixed outcomes,
  unavailable durations, provisional waits and clock exceptions remain visible.
- Automatic display uses original milliseconds: explicit zero is `0s`, positive
  subsecond values are `<1s`, seconds round with carries below an hour, and
  hour-scale values round to minutes. Source subtotal arithmetic is unchanged.
- Existing terminal helpers align wide rows and stack/wrap narrow rows. Headings
  use the injected styler; secondary notes remain readable without colors.
- Menu labels refresh from current evidence. Details and the optional editor
  return to the originating menu, preserving action identifiers and ordering,
  Exit/Pause placement, triage selections, confirmation and cancellation.
- The editor retains replacement, blank, explicit-zero, as-of and no-prefill
  behavior. Read/conflict and failed-save explanations preserve the previous
  value and workflow authority. Work outside the CLI may be included; passive
  waits, other contributors, allocated-elsewhere time and recording overhead
  remain excluded.

## Security Exposure

None applies to a new or widened surface: this change renders the existing
bounded summary and uses the existing optional estimate gateway. It adds no
input interpreter, path, identity/access decision, secret/personal-data
collection, cross-principal access, outbound destination or irreversible effect.
Existing ledger decoding, privacy, safe-path and write controls remain owned by
the unchanged timing/store modules. Synthetic read-error canaries stay out of
displayed diagnostics.

## Files Changed

- Production: `packages/orchestrator/src/interactive.ts`.
- Generated local build output (ignored):
  `packages/orchestrator/dist/banzai.mjs` and its `.map`.
- Tests: `packages/orchestrator/test/interactive.test.ts`.
- Maintained documentation: `documentation/orchestrator.md` and
  `packages/orchestrator/MODULES.md`.
- Work evidence: this change report at its exact supplied role path.

## Review Findings

Accepted finding closure records: None; no IDs were supplied.
Skipped review findings: None. No shadow or alternative-design concern entered
the implementation scope.

## Documentation Sync and ADR Conformance

The maintained CLI guide and module reference describe the current Compact UI,
duration rounding, availability, action names and attribution limits.
`PROJECT_MANIFEST.md` was reviewed: the existing UI ownership, private timing,
dependencies, assurance and ADR-0034 facts remain current, so no manifest edit
is needed. Feature reports in other work items were not changed.

ADR-0034 conformance is preserved: gate elapsed never becomes active effort;
the ledger, episode identities, collection boundaries, duration arithmetic,
contributor scope and private storage remain unchanged. No run-state,
evaluation, KPI, context, cancellation, control or status JSON contract changes.
No ADR lifecycle change is required; accepted ADR bodies were not edited.

Material Engineering Quality deviations: None.

## Structural Assessment and Reuse Search

- Trigger/container: the changed `renderStatus` remains above the adopted ESLint
  complexity threshold (`52`, threshold `15`); before editing, the affected
  timing/model/UI baseline had zero lint errors and 23 advisory warnings.
  The new details renderer initially measured `17`; shared recording notes
  were separated into a local renderer before handoff. Baseline target tests
  passed before edits. These observations trigger assessment, not a new gate.
- Ownership discovery/reuse search: inspected manifest/module owners,
  `renderHumanTime` callers, `humanTimeMinutes`, `deriveHumanTime`, gateway
  `readSummary`, existing human-time UI tests, `format.ts` row/wrapping helpers
  and `progress.ts/formatDuration`; bounded symbol/behavior search covered
  `packages/orchestrator/src/`. Existing progress duration formatting has
  different subsecond/hour behavior and is private to progress rendering.
- Owner/boundary: `interactive.ts` owns presentation and optional menu/editor
  composition; `human-time.ts` owns immutable summary meaning and arithmetic;
  `interactive-human-time.ts` and the store own recording, revision checks and
  persistence. Collaborators are the existing `InteractiveIO`, `Styler` and
  `HumanTimeGateway`. Effects remain terminal output, existing prompt calls
  and the existing explicit estimate replacement. No mutable owner, runtime
  import edge, resource lifecycle or subsystem dependency was added.
- Disposition: reused `hangingLines`, `labeledLines`, `wrapText`, `resolveWidth`
  and the injected styler. Retained the existing UI module and status owner;
  local helpers give duration display, estimate availability, coverage,
  episode rows, notes and diagnostics one presentation implementation each.
  Splitting the high-complexity status coordinator or moving UI into the
  recorder would couple unrelated workflow rendering or recording to this
  change. A new rendering module/import-policy entry would add a boundary
  without an independently changing collaborator or lifecycle here. Reusing
  progress formatting would require changing its unrelated established output.
- Invariants: no reconstruction from rounded minutes, no open/provisional or
  recovery contribution to completed responses, no inferred active effort,
  no fabricated episode context, no new workflow decision, no raw diagnostics,
  and no new persistence or authority. Source inspection and behavioral tests
  own these UI claims; existing timing/store tests own unchanged arithmetic,
  recording, lifecycle and privacy guarantees.
- Remaining debt: pre-existing status/coordinator complexity and other
  advisory warnings remain visible. They are assessed, not waived or expanded
  into unrelated refactoring. Authority: within the delegated Compact UI scope.

## Verification

Physical origin: builder-invoked local processes in this checkout; commands
below use repository-root cwd unless a workspace cwd is explicitly named.
These are implementation checks, not runner-owned final verification.

- Historical/pre-fix: selected existing interactive tests passed before edits
  (six tests); the eight initial Compact tests then failed against the old UI,
  demonstrating the changed observable guarantees before production edits.
- `npm run build`: passed; only the ignored distribution is regenerated beyond
  the authorized source changes, with no generated tracked-source delta.
- `node packages/orchestrator/scripts/test.mjs --file interactive.test.ts
--file human-time.test.ts --file human-time-store.test.ts`: passed after
  final formatting, 118 tests, zero failures/skips. Physical origin: final
  builder process in the repository root, exit 0.
- `../../node_modules/.bin/eslint src/interactive.ts test/interactive.test.ts
--format ./scripts/eslint-formatter.mjs`, cwd `packages/orchestrator/`:
  passed after final formatting, zero errors and 18 existing advisory warnings;
  no new timing-helper warning. The RTK ESLint wrapper was unavailable and the
  baseline/final checks used the native executable instead.
- `npm run typecheck`: passed on the final production/test tree, exit 0.
- Historical/pre-final `npm run verify`: failed in the test stage (exit 1),
  before the final saved-estimate test fake was aligned with valid partial
  ledger coverage. Typecheck and lint stages passed at that scope. Observed
  failures include `CONFIGURATION_MODEL_WRITE_DENIED` in
  initialization/guided-configuration tests and `listen EPERM 127.0.0.1` in
  release-evidence tests that open local socket fixtures. This is a failed
  builder run, not a passing final suite; no aggregate test count is claimed.
- The existing init guard in `src/cli.ts` checks runner-owned environment
  markers. A separate disposable scratch-repository diagnostic confirmed
  `[CONFIGURATION_MODEL_WRITE_DENIED] Model phases cannot initialize runner
configuration`. `BANZAI_RUN_ID` and `BANZAI_WORKFLOW_DIGEST` are present in
  this model process; their values were not printed, unset or overridden.
  `node packages/orchestrator/scripts/smoke-committed.mjs` independently failed
  with `SMOKE_NON_ZERO: init exited unsuccessfully`. No production/test change
  or permission bypass was made for these environment failures.
- `npm run build:check`: passed separately, including distribution parity and
  the non-TTY CLI smoke; the failed `verify` test stage prevents its final build
  stage from running inside that command.
- `npm run format:check`: passed. The additional root-document check
  `node node_modules/prettier/bin/prettier.cjs --check
documentation/orchestrator.md
documentation/work/improve-the-interactive-cli-human-time-summary-and-deta-728d8f5d/change-report.md`
  also passed; it covers the maintained guide and report outside the workspace
  formatter's normal scope.
- `node --input-type=module` with the in-memory esbuild rendering harness:
  passed; all three fenced synthetic examples below match the current renderer
  output byte-for-byte. The harness creates no project artifact.
- `git diff --check`: passed. Serena TypeScript diagnostics for the changed
  production and test files were empty after the fixes.
- Runner-owned final task verification:
  pending at fix handoff; durable runner evidence owns the eventual result.

No fixed full-scope runner descriptor was supplied; package discovery is inert.
The manifest requires `npm run verify`; it was attempted once as the builder
fallback for the missing supplied final suite and is selected fresh for the
runner's own execution context. The failed local attempt supplies no equivalent
pass and does not waive any check. Only implementation feedback is complete;
final task acceptance still depends on durable runner verification.
Checks proposed at handoff use existing executable scripts and leave observed
project files unchanged. No release or live-vendor check is implied by this
UI-only task.

## Assurance Critique

Behavioral assertions cover estimate missingness/zero/unavailability, source
subtotals and timed coverage, capture-gap interpretation, mixed/provisional and
recovery waits, clock exceptions, rounding/carries, menu refresh and ordering,
triage/cancellation preservation, failed saves, redacted read failures and
40-column color-disabled rendering. Existing model/store suites cover unchanged
persisted semantics. Fixtures exercise the real UI through the gateway/IO
boundary; no snapshot fixes incidental whitespace as a public contract.

Representative synthetic rendering below is implementation evidence only.
Live terminal/user acceptance has not been performed or inferred. Runner final
verification remains pending as stated above.

## Representative Synthetic Terminal Examples

These examples were rendered from in-memory synthetic summaries through the
current private renderer, bundled in memory with the existing esbuild tool.
They are 80-column, color-disabled output; no real run or ledger was read or
written. The display-only export existed only in the in-memory harness.

Compact summary:

```text
Time for this run
  Active time estimate    12 min · Self-reported · one person
  Waiting for decisions   1m 30s · 2 of 2 answered responses timed
  Decision waits include time away; they do not measure active work.
  Recorded waits only · coverage may be incomplete
```

Dedicated details:

```text
Time details · this run
  Active time estimate    12 min · Self-reported · one person
  Estimate as of          2026-10-23T12:00:00.000Z
  Later work does not update this estimate.

Recorded decisions
  All recorded decisions are answered.
  1. Plan approval        24s
  2. Review triage        1m 6s
  Recorded-response subtotal 1m 30s · 2 of 2 answered responses timed
  Recorded waits only · coverage may be incomplete
  2 answered · 0 open · 0 other outcomes · 0 unavailable decision durations
  Open and provisional waits do not count as completed responses.

Recording and attribution
  Decision waits include time away; they do not measure active work.
  Durations use UTC timestamps.
  Clock continuity was checked within one recording process.
  Clock checks do not verify identity or active work.
  The active-time value is a self-reported estimate for one person; identity is
  not verified. Work by other contributors is not represented; a complete task
  total is not established.
```

Unavailable-data summary:

```text
Time for this run
  Active time estimate    Unavailable
  Waiting for decisions   Unavailable · no recorded response durations
  Decision waits include time away; they do not measure active work.
  Recorded waits only · coverage may be incomplete
Timing evidence: Could not read or validate the timing evidence.
```

For a known subtotal with one unavailable answered duration, the response row
reads `24s · 1 of 2 answered responses timed`; no missing duration becomes zero.
At 40 columns, labels stack above values and prose wraps rather than clipping.
