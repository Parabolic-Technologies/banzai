# WP1 plan

Requirements: [requirements.md](requirements.md).

## Approach

Everything R1 needs is already in run state except the output tail:
`state.taskVerification` holds the decision (descriptors with argv, cwd and
timeout) and every physical attempt (status, exit code, signal, failure
category, duration, log references). Status rendering stays a pure projection
of that state plus a bounded tail of the retained logs, loaded by the human
renderers only, so `status()` and `status --json` stay unchanged.

## Tasks

1. **Shared helpers.** Move `formatDuration` from `progress.ts` to `format.ts`
   so status and progress share it.
2. **Log tails.** New `src/verification-output.ts`: for each non-successful
   latest attempt, read the last 64 KiB of its stderr log (stdout when stderr
   is empty) through `safePath` with `O_NOFOLLOW`, keep the last 20 lines,
   redact, strip ANSI, escape and bound each line. Register the module in
   `import-boundaries.mjs` under ADR-0049.
3. **Status lines.** Extend `taskVerificationStatusLines(state, tails?)` in
   `verification-ui.ts` with the R1 detail block and R2 labels; export the
   outcome label for the block reason. Render the block preformatted in
   `interactive.ts` so indentation and output lines survive wrapping. Load
   tails in `cli.ts` (`status`, post-command state) and in the interactive
   loop.
4. **Block reason.** Build the R3 reason in `executeTaskChecks`
   (`workflow.ts`) from the applicability dispositions and attempts.
5. **Retry outlook.** Add `WorkflowRunner.verificationRetryOutlook()`: for a
   task-verification block whose retry target is `failed` + `command_exit`,
   recompute the current selection (extracted from `executeTaskChecks` into one
   helper), compare the check descriptor digest, capture current inputs and
   compare the observed digest with the attempt's `before`. Errors return no
   outlook. `interactive.ts` calls it only when building the blocked menu,
   through an optional `InteractiveRunner` method.
6. **Fixture and tests.** Add the shared phpcs fixture (R7) and tests for the
   detail block, every R2 label, redaction and escaping, missing logs, the
   block reason, the retry label in both directions, and unchanged
   `status --json`. Update characterization snapshots that pin the old block
   reason.
7. **Docs.** `documentation/orchestrator.md` (failure recovery),
   `PROJECT_MANIFEST.md` if a current fact changes, `MODULES.md`
   (`verification-ui.ts`, new module), tracker row and report.

## Checks

Focused: `node packages/orchestrator/scripts/test.mjs --file <file>` for the
touched suites. Final: `npm run verify`, `npm run format:check`.
