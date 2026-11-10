# WP2 · Run every required check in one pass

Status: report ready · Program:
[banzai 2.8–2.9](../release-2-8-2-9-program/tracker.md) · Source:
[brief, WP2](../release-2-8-2-9-program/brief.md#wp2--run-every-required-check-in-one-pass)

## Problem

`executeTaskVerification` in `plugins/banzai/lib/task-verification-store.mjs`
leaves its loop after the first attempt that did not complete. Later checks
stay "not run", so each fix costs another round to learn about the next
failure. Retry is shaped around one failure: the request carries one
`retryOf`, retry eligibility reads only the latest attempt, and any other
failed attempt of the round fails the next round with "Task verification
retains an unresolved attempt". A failed check that writes project files
surfaces only at the next launch, as "Task inputs changed between selection
and launch", without naming the check.

## Authority

[ADR-0057](../../decisions/0057-complete-task-verification-rounds.md),
accepted 2026-10-31. It amends ADR-0045 §5 for task-scoped verification and
preserves ADR-0015, ADR-0043, ADR-0049 and ADR-0051.

## Requirements

- **R1 · Continue after command-level failures.** After an attempt reaches
  its terminal record, the next selected check runs in order when the attempt
  ended with:
  - `failed` and `command_exit` without a signal (a non-zero exit);
  - `failed` and `process_start` (the executable could not be started);
  - `timeout` or `output_limit`, whether recorded as `failed` or
    `interrupted`.

  One predicate in `task-verification-store.mjs` reads status, failure
  category and signal together. The runner and the standalone helper both
  use it. The helper records timeouts as `failed` and the runner records them
  as `interrupted`; both continue.

- **R2 · Stop on everything else.** Scheduling stops in these cases:
  - `command_exit` with a signal: the runner records `interrupted` and the
    helper `failed`, and both stop;
  - `runner_failure`;
  - `process_start` recorded as `interrupted`, which is how the runner records
    a cancellation at launch;
  - every failure that throws today: authorization, ownership, policy, setup,
    input capture, authority or context revalidation, and inputs changed
    between selection and launch.

  The remaining checks get no attempt and their disposition is `not_run`.
  Every launch keeps its existing revalidation, authorization and input
  comparison.

- **R3 · Attribute file changes.** After every terminal attempt, whether it
  succeeded or not, the observed inputs after the check are compared with
  those captured at its launch. A difference stops the round with the existing
  message, which names the check and the bounded list of changed paths and
  states the remedy. No later check launches. The comparison between selection
  and launch stays as a second line of defence.
- **R4 · Retry eligibility over the round.** Eligibility reads the latest
  attempt of every check in the latest round, not only the latest attempt.
  - If any of these attempts is `started`, the existing reconcile reason
    applies and `attemptId` is null.
  - Otherwise, if any is `failed` or `interrupted`, retry is eligible.
    `attemptId` names the unsuccessful attempt with the highest sequence. The
    reason states how many checks the action reruns.
  - Otherwise, the existing prerequisite reason applies.

  The projection keeps `{eligible, reason, attemptId}`. `banzai retry` and
  `banzai control retry` take no new input. Retry stays available when the
  round's latest attempt passed.

- **R5 · One retry action for the round.** The runner computes the set of
  unsuccessful latest attempts of the round under the retry lock and passes it
  to `executeTaskVerification`. The store checks that the set equals the
  round's unsuccessful set at execution time, and fails closed otherwise. It
  then:
  - reruns those checks in selection order;
  - runs the round's checks that were not run;
  - keeps checks that passed or were reused, re-evaluated against current
    inputs as today;
  - links every new attempt's `retryOf` to its own predecessor.

  No attempt record is overwritten or removed. The single-attempt `retryOf`
  input keeps its meaning.

- **R6 · Helper request successor.** The standalone helper also accepts
  `banzai-verification-request/v4` with `schemaVersion: 4` for `inspect`,
  `decide` and `execute`. Execute may carry `retryOf` as a non-empty array of
  unique attempt ids, which must equal the round's unsuccessful set (R5).
  Contract schemas are published under `plugins/banzai/contracts/verification/v4/`.
  `banzai-verification-request/v3` and its single `retryOf` keep their meaning.
- **R7 · Human surfaces.**
  - **Block reason.** It ends with "Retry re-runs the failed check without
    replaying implementation." when one check is unsuccessful. When several
    are, it names their count.
  - **Interactive retry label.** With one retried check, the label is
    unchanged. With several, it reads "Retry the N failed checks".
  - **WP1 warning.** It appears only when every retried check is an ordinary
    non-zero exit whose command and observed inputs are unchanged. With
    several checks, it reads "Retry anyway (same commands, same files; expected
    to fail again)".
  - **Progress line.** The retry progress line names the count of rerun
    checks.
  - **No start-checks label.** "Retry start checks" never appears while any
    check of the round is unsuccessful.
- **R8 · Unchanged contracts.** The following stay as they are:
  - the aggregate outcome, which stays failed while any required check fails;
  - the disposition vocabulary and the completion rules (ADR-0049 §6);
  - evidence reuse (ADR-0043) and digest roles (ADR-0051);
  - the attempt, decision, applicability and publication record schemas;
  - run state, events and the `banzai status --json` shape;
  - `banzai verify check` and legacy profile-mode verification.
- **R9 · Documentation.**
  - `documentation/orchestrator.md`: the task verification and blocked-run
    retry text.
  - `packages/orchestrator/MODULES.md`: the "workflow verification remains
    fail-fast" sentence and the store and eligibility notes.
  - `PROJECT_MANIFEST.md`: any current fact that changes, and its ADR-0057
    row.
  - ADR-0057: its implementation state.
  - The tracker row and the report.

## Owner decisions

The owner approved this package on 2026-10-31 with `Both recommended`,
after the ADR acceptance commit `a0041f6`:

- Q1: WP2 implements and tests helper request v4 and changes no instruction
  text; skills keep the v3 request.
- Q2: agent capabilities advertise v4 in WP4's major control revision, where
  the policy and skill text also publish it.

The questions as asked follow. ADR-0057 §2 requires the helper successor
request (R6), but it says nothing about how the successor reaches standalone
skills or supervisors.

1. **Instruction text.** Standalone skills learn the helper request from two
   places:
   - `plugins/banzai/policies/artifact-storage.md`, which documents v3 and
     its single `retryOf`;
   - seven skills that name the "v3 request": `code-writing`, `feature`,
     `quick-fix` and `test-writing` (execute), and `development-plan`,
     `feature-review` and `feature-status` (inspect and decide).

   ADR-0057 §5 says "No model phase, instruction text or approval rule
   changes". Same-round retry matters to a standalone skill only when nothing
   changed since the failure, for example after installing a missing tool.
   After a code fix, the skill starts a new round with a new `roundId`, and v3
   handles that.
   - **Recommendation:** implement and test v4 now and leave the instruction
     text unchanged, so the skills keep v3. Publish v4 to skills later through
     an ADR-0044 transition, together with its capability (question 2).
   - **Alternative:** publish now. Update the policy and the four executing
     skills through an ADR-0044 transition that cites ADR-0057 §2. This reads
     §5 as "no change to phase behaviour or approval rules", and the owner
     approves that reading.

2. **Agent capabilities.** `banzai-agent-capabilities/v8` advertises exactly
   `verificationRequestSchemas: ["banzai-verification-request/v3"]`, and
   supervisors require that exact capability. The list was introduced with
   capabilities v8 in 2.7.0, so changing it needs a major control revision.
   - **Recommendation:** add v4 to the list in WP4's major control revision
     (ADR-0058 adds `recheck`), so 2.8 has one control major. Until then the
     list stays v3-only, which remains true because v3 is still supported.
   - **Alternative:** a separate major control revision in WP2, which gives
     2.8 two control majors.

## Acceptance

1. Three required checks run, and the first fails with a non-zero exit. All
   three have attempts and dispositions in one round, and the aggregate is
   failed.
2. On the phpcs fixture, all three checks have attempts, and the block reason
   lists each incomplete one with its outcome.
3. **Continue and stop cases.**
   - A timeout, an output-limit stop and an unavailable executable each let
     the next check run, in both the runner and the helper.
   - A signal-terminated check, a runner failure, a cancellation and every
     existing fail-closed exception each stop scheduling, and the remaining
     checks are `not_run`.
4. **Two failed checks.**
   - Eligibility names the later one and states the count.
   - One retry action reruns both and links each new attempt to its
     predecessor.
   - A passed check keeps its evidence when inputs are unchanged.
   - Retry is offered when the round's latest attempt passed.
   - A stale or partial retry set fails closed.
5. A failing check that writes a tracked file stops the round, the error names
   that check and path, and later checks are not run.
6. A `started` attempt without a terminal record still requires reconciliation
   before any rerun.
7. The helper behaves as follows:
   - v3 requests, including a single `retryOf`, behave as before;
   - a v4 execute request retries a multi-failure round;
   - a v4 request with a partial set is refused.
8. Existing fail-closed tests pass unchanged. Tests that pin
   stop-on-first-failure (`not run` for later checks) change only where R1
   intends it. `verify check` tests are unchanged.
9. `npm run verify` and `npm run format:check` pass.

## Out of scope

- A per-check or policy `stopOnFailure` flag (ADR-0057, option 3).
- Running checks in parallel (option 4).
- Correcting a verification command after approval (WP9) and running checks
  before implementation (WP10).
