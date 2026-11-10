# Change Report: Review-1 Fixes for Interactive Slug Selection

- Date: 2026-11-10
- Work: [description.md](description.md), [plan.md](plan.md),
  [implementation-report.md](implementation-report.md),
  [test-report.md](test-report.md)
- Review: [review-1.md](review-1.md); owner triage in chat on 2026-11-10
  accepted F1, F2, F3, F4, F5 and F6. [review-2.md](review-2.md) verified
  them and raised R2-F1, which the owner accepted in chat the same day.
- Decision: [ADR-0066](../../decisions/0066-date-prefixed-work-and-initiative-slugs.md)

## Accepted Findings

### F1 — Local-versus-UTC prefix had no discriminating test

- Changed scope: `packages/orchestrator/test/run-identity.test.ts`.
- Decision: added "the date prefix follows the local calendar date, not the UTC
  one". It fixes `process.env.TZ` to Asia/Tokyo and America/Los_Angeles,
  restoring it afterwards, for instants whose local and UTC dates differ.
- Evidence: the test passes; with UTC getters in `workSlugDatePrefix` it fails
  (mutation check, reverted).

### F2 — Validation precedence had no discriminating test

- Changed scope: `packages/orchestrator/test/interactive.test.ts`,
  `packages/orchestrator/test/run-identity.test.ts`.
- Decision: the slug-step validation test now covers `A`x94 (fails format and
  length: format message), `Login_Fix` reported as existing by the fake gateway
  (format message), and `b`x94 reported as existing (length message).
  `workSlugProblem` gets an over-long uppercase case that returns `format`.
- Evidence: both tests pass; checking length before format fails both
  (mutation check, reverted).

### F3 — Conflict check resolved paths outside the contained-path helpers

- Changed scope: `plugins/banzai/lib/work-documents.mjs`,
  `packages/orchestrator/test/work-documents.test.ts`.
- Decision: `occupied()` resolves the candidate through `safePath(root,
  relative, { missing: true, directory: true })` before `lstat`. A symlinked
  or non-directory component is refused with `ARTIFACT_UNSAFE_PATH`; a missing
  component is free. This applies to `workSlugConflict` and to the
  initiative-root refusal in `createExecutionBinding`.
- Evidence: new test "work slug conflicts refuse a symlinked root instead of
  following it" shows both refuse a symlinked `documentation/initiatives` and
  create no work directory.

### F4 — ADR-0066 confirmation item 3 lacked CLI-level evidence

- Changed scope: `packages/orchestrator/test/agent-control-cli.test.ts`,
  `packages/orchestrator/test/cli-routing.test.ts`, implementation report.
- Decision:
  - a real `WorkflowRunner` with fake model adapters, started through
    `control start --slug agent-task` at 2026-11-10, shows `261110-agent-task`
    in run state, run ID, projected status and the work directory;
  - a spawned `banzai run --slug fix-login` against an existing
    `documentation/initiatives/<today>-fix-login/` exits 1 with
    `ARTIFACT_WORK_CONFLICT` naming that path, creates no work directory, and
    `banzai status` then reports `NO_ACTIVE_RUN`. The test computes the prefix
    from the system clock and creates the initiative for both sides of a
    possible midnight crossing.
  - The implementation report now maps all seven ADR-0066 compliance items.
- Limitation: a successful spawned `banzai run` is not tested, because it would
  continue into real vendor preflight.

### F5 — Stale `MODULES.md` entries

- Changed scope: `packages/orchestrator/MODULES.md`.
- Decision: the `work-documents.ts`, `interactive.ts` and
  `workflow/domain/run-identity.ts` entries describe the conflict query, the
  slug step with its `clock` and `workSlugs` options, and the prefix rule, with
  ADR-0066 references.

### F6 — `banzai help run` did not mention the prefix

- Changed scope: `packages/orchestrator/src/cli.ts`.
- Decision: the `run` help says the run slug and work directory receive
  today's `yymmdd-` prefix unless `--slug` already starts with it, gives the
  2026-11-10 example result, and points to `banzai status`. No help test pins
  this text.

### R2-F1 — A refused existence check crashed the interactive session

- Changed scope: `packages/orchestrator/src/interactive.ts`,
  `packages/orchestrator/test/interactive.test.ts`,
  `documentation/orchestrator.md`, `packages/orchestrator/MODULES.md`.
- Cause: after F3, `workSlugConflict` refuses a symlinked or non-directory
  component with `ARTIFACT_UNSAFE_PATH`. The slug step awaited it inside the
  prompt's `validate`, and `@inquirer/core` drops a rejected validation
  (`void signal.current(...)`), so the process ended with a raw stack trace.
- Decision: the slug step catches a gateway refusal or failure and keeps the
  prompt open with `Could not check <slug>: <reason>`, following the existing
  `escapeTerminalText(errorMessage(error))` pattern of other validations. The
  engineer can type another slug or interrupt. `banzai run` and
  `control start` keep their `[CODE] message` refusal.
- Evidence: new test "a refused existence check keeps the slug prompt open
  with its reason": a rejecting fake gateway gives that message, another slug
  then passes, and `runner.start` is not called.

## Skipped Findings

None. The review's `EQ-SHADOW` entry EQ-S1 (the slug pattern and the
100-character bound are duplicated between `run-identity.ts` and
`work-documents.mjs`) is deferred coverage, not an accepted finding, and is out
of scope.

## Security Exposure

- Class 1 (untrusted input reaches a filesystem path): the existing
  contained-path control (`safePath`) now also guards the conflict query and
  the initiative-root refusal; the slug is validated before any path use.
- Class 7 (overwrite): unchanged control; a taken full name is still refused
  before the work directory is created.

## Documentation Sync

`packages/orchestrator/MODULES.md`, the `banzai help run` text, and the
implementation and test reports. `PROJECT_MANIFEST.md` needs no change: its
section 5 and 9 facts still hold.

## ADR Conformance

Conforms to ADR-0066. No ADR body or lifecycle metadata changed.

## Engineering Quality Deviations

None.

## Verification

After R2-F1 (current tree):

- `npm run format:check` (Prettier rewrote `test/interactive.test.ts`),
  `npm run build`, `npm run typecheck`, `npm run lint` (0 errors, existing
  warnings only) and `interactive` 122/122 passed.
- Helper round `67b3fa38`: `npm run verify` passed (typecheck, lint, 2170 of
  2170 tests, `build:check`); `git diff --check` passed; applicability
  `checked`.
- Afterwards, at the owner's request: `npm run version:set -- 2.8.1`, the
  manifest release-train version, `npm run build`; `npm run release:validate`
  passed (no `HOOK_CHANGED_WITHOUT_VERSION_BUMP`), and `release-validation`
  210/210, `version-cli` 4/4 and `version-set` 62/62 tests passed. The full
  `npm run release:check` was not run.

Historical, after F1-F6 and before R2-F1:

- `npm run format:check` in `packages/orchestrator`: Prettier rewrote
  `test/cli-routing.test.ts` and `test/work-documents.test.ts`, then passed.
- `npm run build`, `npm run typecheck`: passed. `npm run lint`: 0 errors,
  existing warnings only.
- Focused tests: `run-identity` 4/4, `interactive` 121/121, `work-documents`
  17/17, `agent-control-cli` 12/12, `cli-routing --pattern "committed run
  prefixes"` 1/1; mutation checks for F1 and F2 failed as expected and were
  reverted.
- Plan inventory through the standalone helper, round `7f514c57`:
  `npm run verify` passed (typecheck, lint, 2169 of 2169 tests, `build:check`);
  `git diff --check` passed; applicability `checked`.
- Not run: `npm run release:check`, which refuses with
  `HOOK_CHANGED_WITHOUT_VERSION_BUMP` until the owner's version bump.

## Assurance Critique

The new tests protect named regressions (UTC getters, reordered checks,
followed symlinks, undated CLI starts) and were shown to fail for the first
two. No hollow, redundant or implementation-coupled test was added.

## Reuse Search

`safePath` in `plugins/banzai/lib/project-files.mjs` already owns contained,
symlink-free resolution; F3 reuses it instead of a raw `lstat` of a joined
path.
