# WP2 implementation report

Status: report ready, not committed · Requirements:
[requirements.md](requirements.md) · Plan: [plan.md](plan.md) · Authority:
[ADR-0057](../../decisions/0057-complete-task-verification-rounds.md)

## What changed

| Area                         | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Store loop (R1, R2)          | `taskVerificationContinues(attempt)` in `plugins/banzai/lib/task-verification-store.mjs` reads status, failure category and signal together. The round continues after `failed`+`command_exit` without a signal, `failed`+`process_start`, and `timeout` or `output_limit` in either status. Everything else stops it, as do all errors that throw. It replaces `if (terminal.status !== "completed") break;`.                                                                                                                                               |
| File-change attribution (R3) | The observed-input comparison now runs after every terminal attempt, not only a completed one. It keeps the existing message, which names the check, its changed paths and the remedy.                                                                                                                                                                                                                                                                                                                                                                       |
| Retry set (R5)               | `executeTaskVerification` accepts `retrySet`. It must equal `unsuccessfulRoundAttempts(attempts, selection, roundId)` (new export): the latest failed or interrupted attempt of each selected check in the round. A lone `retryOf` is valid only while it names the round's one unsuccessful check. Both refusals happen before any launch. The per-check guard accepts either form.                                                                                                                                                                         |
| Helper request v4 (R6)       | `verification-helper.mjs` accepts `banzai-verification-request/v4` for all three operations. A v4 execute `retryOf` is a non-empty array of attempt ids and maps to `retrySet`; v3 is unchanged. New contracts are in `plugins/banzai/contracts/verification/v4/` (execute, inspect), registered in `release-policy.json` (plugin `jsonDocuments` and `requiredPaths`) and `publication-policy.json` (product).                                                                                                                                              |
| Eligibility (R4)             | `RetryFacts.taskVerification` now carries `round`: the latest attempt of every check in the latest round, in sequence order, built by `latestRoundAttempts` in `workflow.ts`. In `decideRetry`, a started attempt keeps the reconcile reason. Otherwise the latest unsuccessful attempt names the retry: the reason is unchanged for one check and states the count for several. The projection shape is unchanged.                                                                                                                                          |
| Retry dispatch (R5, R7)      | `executeVerification` and `executeTaskChecks` take `retry?: { attemptId }` instead of `retryOf?: string`, and the legacy path still reads the id. On retry, task mode computes the round's unsuccessful set. It fails closed with `VERIFICATION_RETRY_CHANGED` if the eligible attempt is missing from that set, then passes the set to the store. The progress line counts the rerun checks; the generic retry-path line remains for legacy mode only.                                                                                                      |
| Block reason (R7)            | `retryReach` in `verification-outcome.ts`. One incomplete check keeps "Retry re-runs the failed check without replaying implementation."; several give "Retry re-runs the N incomplete checks without replaying implementation."                                                                                                                                                                                                                                                                                                                             |
| Outlook and menu (R7)        | `VerificationRetryOutlook` now describes the whole rerun set: `checkIds`, `ordinaryExits`, `sameCommand`, `sameInputs`. The descriptor comparison moved into `unchangedRetryCommands`. `interactive.ts` keeps the one-check labels. Several checks get "Retry the N failed checks", the plural WP1 warning ("same commands") and a confirmation that names every check. A verification retry with no attempt id reads "Retry verification checks" and "Rerun the verification checks without replaying implementation?" instead of the start-checks wording. |
| Docs (R9)                    | `documentation/orchestrator.md` (task verification and blocked-run retry), `packages/orchestrator/MODULES.md` (store, eligibility, `verify check` note), `PROJECT_MANIFEST.md` (process fact, ADR-0057 row Implemented), ADR-0057 implementation state and the decisions index row, tracker.                                                                                                                                                                                                                                                                 |

No run state, event, attempt, decision, applicability or publication schema
changes. `banzai status --json`, `banzai control`, `verify check` and legacy
profile verification are unchanged (R8).

## Tests

- New `test/task-verification-rounds.test.ts`, eight tests at store and helper
  level:
  - three required checks all run after the first exits non-zero;
  - six continue cases in runner and helper shapes;
  - four stop cases: runner signal, helper signal, runner failure, cancellation
    at launch;
  - a revalidation failure stops before the next launch;
  - a failing check that rewrites a tracked file is named, and the round stops;
  - a retry set reruns both failed checks with `retryOf` links and keeps the
    passed check, while a partial set, an extra id and a lone `retryOf` launch
    nothing;
  - a started attempt still needs reconciliation;
  - the helper runs both checks under v3, refuses a lone v3 `retryOf`, a
    partial v4 set and a malformed v4 value, and retries the round with v4.
- `verification-failure-details.test.ts`:
  - On the phpcs fixture, the block reason now lists only the failed lint
    check. All three checks have dispositions, and `status` shows the other
    two as passed.
  - The outlook is asserted in its new shape.
  - New test: two failed required checks (the fixture's new
    `schemaFailsWithout` option). It checks the count in the block reason, the
    eligibility naming the later attempt, the plural warning, "Retry the 2
    failed checks" after a fix, one retry rerunning all three checks with
    links, and the single-check wording afterwards.
- `workflow/domain/retry-eligibility.test.ts`:
  - round facts;
  - started among failed;
  - one unsuccessful after a pass;
  - several unsuccessful, naming the latest;
  - prerequisites for a passed or empty round.
- `interactive.test.ts`: the verification retry label and confirmation without
  an attempt id.
- `workflow-completion.test.ts`: the task-mode ordering test pinned
  stop-on-first-failure. It now asserts that all three checks run after the
  second exits 7, which is the ADR-0057 change.
- The fail-closed and `verify check` suites and the `workflow-eligibility` and
  `workflow` block-reason expectations are unchanged.

## Checks

- Focused suites: `task-verification`, `task-verification-rounds`,
  `task-verification-recovery`, `verification-failure-details`,
  `workflow/domain/retry-eligibility`, `interactive`. All pass.
- `npm run format:check`: pass.
- `npm run verify` (typecheck, lint, test, build:check). The first two runs
  failed, and both causes are fixed:
  - two lint errors in a new test;
  - the ordering test above, plus `publication.test.ts`, which compares the
    local `dist` source map with the sources and needed `npm run build`.

  The final run passes: 1813/1813 tests, lint with 0 errors and 417 warnings
  (415 before WP2), and build:check.

- `npm run release:validate` fails only with
  `HOOK_CHANGED_WITHOUT_VERSION_BUMP`. WP2 is the first 2.8 package that
  changes `plugins/banzai/lib`, and the release train is still 2.7.4, so
  `npm run version:set -- <next version>` is needed. That is the owner's
  decision and has not been run. `npm run release:check` was not run.

## Deviations from the brief

- **Helper v4 publication.** The helper accepts request v4, but no instruction
  text names it. The policy and the seven skills keep describing v3. Agent
  capabilities still list only v3. By the owner's decision, WP4's major
  control revision advertises and publishes v4.
- **Store refusals.** A lone `retryOf` in a round with several unsuccessful
  checks is refused before any launch. Before, it would have launched the named
  check and then failed on the next one. Such a round could not exist before
  WP2.
- **New label.** A verification retry without an attempt id (a started attempt
  to reconcile, or prerequisites) used the start-checks label. It now reads
  "Retry verification checks", so R7 holds in every verification state.

## Open questions

- **Release-train version:** settled by the owner on 2026-10-31. The
  version is bumped at the Gate 1 release, so the `release:validate` finding
  stays until then.

WP4 depends on this package: it publishes helper v4 in the policy, the
executing skills and the agent capabilities.
