# WP1 implementation report

Status: report ready, not committed · Requirements:
[requirements.md](requirements.md) · Plan: [plan.md](plan.md)

## What changed

| Area                    | Change                                                                                                                                                                                                                                                                                                         |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Outcome labels (R2, R3) | New pure `src/verification-outcome.ts`: `attemptOutcomeText` reads status, failure category and signal together; `incompleteVerificationSummary` builds the block-reason clause (at most five checks, then "and N more"); `hasCommandOutput` excludes start-failure placeholders.                              |
| Output tails (R1, R5)   | New `src/verification-output.ts`: reads at most the last 64 KiB of each non-successful attempt's stderr log, else stdout, through `safePath` and `O_NOFOLLOW`; keeps 20 lines; redacts, strips ANSI, keeps the visible part of carriage-return redraws, escapes controls and bounds lines to 300 characters.   |
| Status projection (R1)  | `taskVerificationStatusLines(state, tails?)` in `src/verification-ui.ts` adds Command (shell-quoted argv), Directory, Result, Details (failure category, duration, timeout), the output tail and both log paths under each failed check. The module still does no I/O.                                         |
| Renderers               | `src/cli.ts` (`banzai status` and the post-command state) and the interactive loop load tails before rendering. Interactive status renders the verification section preformatted: detail lines are never rewrapped, so commands and paths stay copyable.                                                       |
| Block reason (R3)       | `executeTaskChecks` in `src/workflow.ts` now blocks with `Task verification is incomplete: <check> (<required>) <outcome>; …. The verification details show each command, its output and log paths. Retry re-runs the failed check without replaying implementation.`                                          |
| Retry outlook (R4)      | `WorkflowRunner.verificationRetryOutlook()` compares a failed `command_exit` attempt's descriptor digest and observed-input digest with the current selection and capture; errors yield `null`. The blocked menu alone calls it (optional `InteractiveRunner` method) and relabels retry and its confirmation. |
| Refactor                | The source-attempt and selection steps of `executeTaskChecks` moved into `taskVerificationSource` and `taskVerificationSelection`, shared with the outlook; error order is unchanged. `formatDuration` moved from `progress.ts` to `format.ts`.                                                                |
| Import policy           | `import-boundaries.mjs` registers both new modules under ADR-0049 and the new edges from `verification-ui.ts`, `cli.ts`, `interactive.ts` and `workflow.ts`.                                                                                                                                                   |
| Docs                    | `documentation/orchestrator.md` (Failure Recovery), `documentation/getting-started.md` (troubleshooting row), `packages/orchestrator/MODULES.md`, `PROJECT_MANIFEST.md` §5.                                                                                                                                    |

## Tests

- New `test/phpcs-verification-fixture.ts` (R7): a strict run with plan
  obligations `phpcs-dry-run` (required, missing `--config`, exits 8 with 26
  coloured stderr lines including a credential-shaped token) and
  `schema-catalog-check` (required), plus the supplemental implementation check
  `phpcs-touched-src`. It exports the documented and planned argv for WP3, WP9
  and WP10. `FakeAdapters` gained `planVerificationChecks` and
  `strictVerificationCandidates` to support it.
- New `test/verification-failure-details.test.ts`, six tests:
  - every R1 field in the projection, in `banzai status` (built CLI) and in the
    interactive summary; redaction and ANSI stripping; log paths exist;
    `status --json` keeps its keys and carries no output;
  - the retry label and confirmation for an unchanged failure, declining keeps
    one attempt, and the label reverts after a tracked file changes;
  - a changed descriptor yields `sameCommand: false`;
  - every R2 status, category and signal combination;
  - a start failure shows no placeholder output; the summary bound;
  - stdout fallback, carriage returns, control and bidi escaping, line bound,
    empty output, symlinked and missing logs, and the 20-line tail of a long log.
- `test/workflow-eligibility.test.ts` (ten snapshots) and
  `test/workflow.test.ts` (two state traces) pinned the old block reason; they
  now pin the new one. No other expectation changed.

## Checks

| Command                                                                                                        | Result |
| -------------------------------------------------------------------------------------------------------------- | ------ |
| Focused suites (new file, task verification ×2, eligibility, interactive, progress, format, import boundaries) | passed |
| `npm run verify` (typecheck, lint 0 errors, 1798/1798 tests, build check)                                      | passed |
| `npm run format:check`                                                                                         | passed |

`npm run release:check` was not run: no release, version or instruction-layout
file changed. No live vendor probe was needed.

## Deviations from the brief

- `retry-eligibility.ts` lives at `src/workflow/domain/retry-eligibility.ts`,
  not `src/retry-eligibility.ts`. It was not changed: WP1 needs no new retry
  rule.
- The block reason carries check IDs and outcome labels but no argv or stderr.
  Persisted state and agent-control status stay free of command output; the
  full details render from the retained records and logs.
- No stable `banzai status --json` projection was added (R6). The raw
  `state.taskVerification` already carries every field except the output tail,
  whose log paths it includes; a documented projection is better designed
  together with `banzai control` support in WP9.
- The process-start placeholder ("Process could not be started.") is still what
  the runner persists. The label explains the failure, but the operating-system
  error text is not retained; recording it would change persisted evidence and
  was left out.
- Argv is taken from the current round's decision. A non-successful latest
  attempt is always launched by the current verification call, so this is the
  descriptor that ran.

## Open questions

None blocking. The retry warning is interactive only; `banzai retry` and
`banzai control` are unchanged.
