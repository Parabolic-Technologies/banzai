# WP2 plan

Requirements: [requirements.md](requirements.md). Authority:
[ADR-0057](../../decisions/0057-complete-task-verification-rounds.md).

## Approach

The continue-or-stop rule and the retry-set check live in the shared store
(`plugins/banzai/lib/task-verification-store.mjs`), so the runner and the
helper cannot diverge.

The runner side changes in three places:

- eligibility, which reads the round instead of the latest attempt;
- the retry dispatch, which passes the round's unsuccessful set;
- the human copy, which counts the rerun checks.

No record schema, run state, event or status projection changes.

## Tasks

1. **Store loop.** In `executeTaskVerification`:
   - Add `continuesAfterAttempt(attempt)` (R1, R2) and replace
     `if (terminal.status !== "completed") break;` with it.
   - Run the observed-input comparison after every terminal attempt, not only
     a completed one, with the current message (R3).
   - Accept `retrySet` (an array of attempt ids) beside the existing
     `retryOf` string. Before any launch, validate that the set equals the
     round's latest unsuccessful attempts, and fail closed with a message
     naming the mismatch.
   - Base the per-check "retains an unresolved attempt" guard on the set or
     on `retryOf`.
   - Update `task-verification-store.d.mts`.
2. **Helper.** In `verification-helper.mjs`:
   - accept request v4 for all three operations;
   - map a v4 `retryOf` array to `retrySet`;
   - keep v3 unchanged.

   Add the `plugins/banzai/contracts/verification/v4/` execute and inspect
   schemas, and update the helper's `.d.mts` if it names the request.

3. **Eligibility.**
   - `RetryFacts.taskVerification` gains the latest attempt of every check in
     the latest round: id, check id, status and sequence.
   - `decideRetry` in `workflow/domain/retry-eligibility.ts` applies R4.
   - `WorkflowRunner.retryEligibility` in `workflow.ts` gathers the fact from
     `readTaskVerificationAttempts`.
4. **Retry dispatch.**
   - In the retry path of `workflow.ts`, compute the round's unsuccessful set
     under the eligibility lock and keep the `expectedAttemptId` stale check.
   - Thread the set through `executeVerification` and `executeTaskChecks`
     into `executeTaskVerification`.
   - Count the checks in the progress line, and in the block reason when
     several fail (R7).
5. **Outlook and menu.**
   - `verificationRetryOutlook` describes the whole set: attempt ids, check
     ids, and whether every retried check would repeat its failure.
   - `interactive.ts` keeps the one-check labels.
   - With several checks, it shows "Retry the N failed checks" and the plural
     WP1 warning.
6. **Owner decisions.** No instruction text changes, so no instruction
   baseline transition (Q1). `agent-control.ts` and `control-protocol.md`
   stay unchanged; the tracker records that WP4 advertises and publishes v4
   (Q2).
7. **Tests.**
   - `task-verification.test.ts`:
     - the R1 and R2 continue and stop cases, with helper and runner outcome
       shapes;
     - a failed check that writes a file;
     - a multi-failure retry with `retryOf` links and a passed check kept;
     - a partial or stale set;
     - a `started` attempt;
     - v3 single `retryOf` unchanged;
     - helper v4.
   - `workflow/domain/retry-eligibility.test.ts`: started, several failures,
     latest attempt passed, and only passed.
   - `interactive.test.ts`: labels for one and several checks and the plural
     warning.
   - `verification-failure-details.test.ts`: the phpcs block reason now lists
     every check with an attempt.
   - The existing `workflow-eligibility` and `workflow` expectations stay
     unchanged.
8. **Docs.**
   - `documentation/orchestrator.md`: "Task verification" and the blocked-run
     retry paragraph.
   - `packages/orchestrator/MODULES.md`.
   - `PROJECT_MANIFEST.md`: the §10 ADR-0057 row and any changed fact.
   - ADR-0057 "Implementation state".
   - The tracker row and the report.

## Checks

- **Focused:** `node packages/orchestrator/scripts/test.mjs --file <file>`
  for each touched suite.
- **Final:** `npm run verify` and `npm run format:check`.

## Sequencing

The owner committed the ADR acceptance set as `a0041f6` and approved this
plan on 2026-10-31 with `Both recommended` (see the owner decisions in
requirements.md).
