# ADR 0057: Complete Task Verification Rounds After Check Failures

## Status / Date / Owner / Decision Makers

- Status: Accepted
- Date: 2026-10-31
- Owner: Banzai maintainers
- Decision makers: Repository owner; explicitly accepted in chat on 2026-10-31
  with `Accept all three` (ADR-0057, ADR-0058 and ADR-0059).
- Acceptance date: 2026-10-31
- Accepted proposal SHA-256: `e9c596d25a609434a06db120bbbd05a40e6b89b81e4a19f2ba8bf5e8d237e045`.
- Lifecycle effect: the amendments in Lifecycle Links are accepted and their
  reciprocal links are recorded. Their proposal-stage wording and the
  decision body are retained unchanged. Dependent planning is authorized;
  plan approval is still required before implementation.
- Implementation state: Planned.
- Preparation authority: the owner's 2.8–2.9 brief of 2026-10-30 (WP2) and the
  owner's request on 2026-10-31 to draft the Stage 1 ADRs before their
  packages. Preparing this proposal is not acceptance; no code may rely on it.

## Related Artifacts

- Program brief, WP2:
  [brief.md](../work/release-2-8-2-9-program/brief.md#wp2--run-every-required-check-in-one-pass);
  status and deviations in
  [tracker.md](../work/release-2-8-2-9-program/tracker.md).
- Failure details and retry warning already shipped in WP1:
  [WP1 report](../work/wp01-verification-failure-details/implementation-report.md).
- Repository authority: [AGENTS.md](../../AGENTS.md) and the
  [decision lifecycle](./README.md#lifecycle).
- Related accepted decisions:
  - [ADR-0045](./0045-guided-verification-setup.md) §5: `verify check` attempts
    all commands, while "ordinary runner verification still stops on its first
    failure". This proposal amends that sentence.
  - [ADR-0049](./0049-task-scoped-verification.md) §5–§6: immutable attempt
    records, per-launch revalidation, truthful outcomes and verification-only
    retry. Unchanged.
  - [ADR-0015](./0015-durable-verification-attempt-ledger.md): durable attempt
    ledger. Unchanged.
  - [ADR-0043](./0043-proportionate-verification-evidence.md) and
    [ADR-0051](./0051-acceptance-time-digest-validation.md): evidence reuse and
    digest roles. Unchanged.
- Enforcement owners: `executeTaskVerification` and
  `taskVerificationApplicability` in
  `plugins/banzai/lib/task-verification-store.mjs`, shared by the runner and by
  `plugins/banzai/lib/verification-helper.mjs`;
  `packages/orchestrator/src/workflow/domain/retry-eligibility.ts`; the retry
  path and the task-check invoker in `packages/orchestrator/src/workflow.ts`;
  blocked-run choices in `packages/orchestrator/src/interactive.ts`.

## Context and Decision Drivers

`executeTaskVerification` runs the selected checks in order and leaves its loop
after the first attempt that did not complete. Later checks are recorded as not
run. In the observed phpcs run, the first required check failed and the other
two (one required, one supplemental) stayed "not run", so each fix would have
cost another verification round to learn about the next failure. ADR-0045 §5
chose this deliberately for runner verification while `banzai verify check`
continues after command-level failures.

Retry is shaped around one failure. The request carries a single `retryOf`;
retry eligibility reads only the latest attempt; and any other failed attempt
of the same round fails the next round with "Task verification retains an
unresolved attempt". If verification continued after a failure, the latest
attempt could be a later success, and today's eligibility would offer no retry
at all.

A check that writes project files is detected only when it succeeds. A failed
check that writes files lets the next launch fail with "Task inputs changed
between selection and launch", which names the paths but not the check that
changed them.

Decision question: Should ordinary task verification continue after a failed
check, and how do retry and file-change detection work when one round holds
several failures?

Drivers:

- One round shows every failing check, so a fix addresses all of them at once.
- Fail-closed paths stay fail-closed: interruption, ownership, authorization,
  policy, setup, capture and changed inputs.
- Attempt records stay immutable and linked (ADR-0015, ADR-0049 §5); retry
  never replays implementation (ADR-0049 §6).
- File changes are attributed to the check that made them.
- The runner and the standalone helper keep one shared rule.
- Wall time is bounded by the checks the plan already requires.

## Options Considered

1. **Keep stop-on-first-failure.** WP1 already shows each failure's command,
   output and logs. Rounds stay short when an early check fails fast. Every
   additional failure still costs a full fix-and-retry cycle. Rejected: the
   developer value of the program is fewer lost rounds.
2. **Continue after command-level failures; stop on integrity failures; retry
   the whole round's failures in one action.** Mirrors the accepted
   `verify check` rule. A round runs every check unless something makes its
   evidence untrustworthy. Costs: a round with a fast early failure now also
   runs the slower later checks. Selected.
3. **Option 2 plus a per-check or policy `stopOnFailure` flag.** Lets a project
   skip a long suite after a failed lint. Adds a field to the
   `banzai-verification-obligations/v2` descriptor or to the task policy, plus
   a choice for every planner and owner. Rejected for now; a separate decision
   can add it if long suites prove a real cost.
4. **Run checks in parallel.** Shortest wall time. The input snapshot, the
   launch comparison and file-change attribution assume one process at a time;
   shared caches, ports and build directories would contend. Rejected.

## Decision

Adopt option 2 for task-scoped verification: ordinary runner verification in
strict and lite runs, and the standalone verification helper, which shares the
same loop.

### 1. Continue after command-level failures

After an attempt reaches its terminal record and its process is cleaned up,
continue with the next selected check in order when the attempt ended with a
command-level outcome:

- `failed` with `command_exit` and no signal: a non-zero exit;
- `failed` with `process_start`: the executable could not be started;
- `interrupted` with `timeout`: stopped at the descriptor's timeout;
- `interrupted` with `output_limit`: stopped by the runner's output bound.

Stop scheduling, and record the remaining checks as not run, when:

- an attempt ended `interrupted` with `command_exit` and a signal: the runner
  cannot tell an operator's interrupt from an out-of-memory or manual kill;
- an attempt ended with `runner_failure`, or the run was cancelled or the
  runner itself was interrupted;
- authorization, ownership, policy, setup or input capture failed;
- inputs changed between selection and launch, or a check changed observed
  project files (section 3).

Each launch keeps its existing revalidation, authorization and per-launch input
comparison.

### 2. Retry every unsuccessful check of the round in one action

- The retry action reruns, within the same round and in selection order, every
  check whose latest attempt in that round failed or was interrupted, and runs
  every check of the round that was not run. Checks that passed, or whose
  evidence was reused, keep their applicability, re-evaluated against current
  inputs exactly as today.
- Each new attempt links `retryOf` to its own predecessor. No attempt record is
  overwritten or removed.
- Retry eligibility considers every unsuccessful attempt of the latest round,
  not only the latest attempt. A `started` attempt without a terminal record
  still requires owner recovery before any retry.
- The runner's verification request carries the set of attempts it retries.
  The standalone helper's execute request gains a successor revision for that
  set. Existing helper request revisions keep their meaning.
- The retry eligibility projection keeps its shape: its attempt identity names
  an unsuccessful attempt that the action covers, and its reason states how many
  checks the action reruns. `banzai retry` and `banzai control retry` take no
  new input, so the agent-control contract does not change.
- Human surfaces present one retry action per round. The WP1 warning ("Retry
  anyway (same command, same files; expected to fail again)") applies only when
  every retried check is an ordinary exit whose command and observed inputs are
  unchanged.

### 3. Attribute file changes to the check that made them

After every terminal attempt, successful or not, compare the observed inputs
after the check with those captured at its launch. A difference stops the
round: record which check changed which repository-relative paths (bounded),
record the remaining checks as not run, and block with the existing remedy
(keep generated output Git-ignored or make the check leave project files
unchanged). Keep the selection-to-launch comparison as a second line of
defence.

### 4. Outcomes and evidence unchanged

The aggregate outcome stays failed while any required check fails. The
disposition vocabulary, completion rules (ADR-0049 §6), a failing supplemental
check's visibility, evidence reuse (ADR-0043), digest roles (ADR-0051) and the
attempt, decision and applicability record contracts are unchanged.

### 5. Scope

`banzai verify check` keeps ADR-0045 §5 unchanged. Legacy profile-mode
verification keeps its original behaviour under ADR-0049 §7. No model phase,
instruction text or approval rule changes; runner instructions that describe
verification as stopping on the first failure, if any, follow ADR-0044.

## Consequences

Positive:

- One round reports every failing check, so one fix and one retry can address
  all of them.
- Retry stays available after a later success in the same round.
- A check that writes files is named, instead of surfacing as an unexplained
  input change at the next launch.
- The runner, the helper and `verify check` share one continue-or-stop rule.

Negative and risks:

- A round whose first check fails quickly now also runs slow later checks. An
  operator can still interrupt, which stops scheduling.
- A signal-terminated check stops the round even when the cause was an
  out-of-memory kill rather than an operator interrupt; the WP1 label explains
  the signal.
- Retry covers several attempts at once, so eligibility, the helper request and
  the blocked-run copy change together; tests must cover partial passes inside
  one round.
- More attempts per round mean more retained logs under `.banzai/`.

Follow-ups:

- After acceptance, record the reciprocal lifecycle link on ADR-0045 (pinned:
  add its exact before and after images to the allow-list in
  `packages/orchestrator/scripts/phase-resources-build.mjs`, keyed by this ADR)
  and update `packages/orchestrator/MODULES.md`, which describes workflow
  verification as fail-fast.
- WP2's requirements, plan and report live in
  `documentation/work/wp02-full-verification-pass/`.

## Compliance and Confirmation

1. With three required checks and the first failing with a non-zero exit, all
   three have attempts and dispositions in one round, and the aggregate is
   failed.
2. A timeout, an output-limit stop and an unavailable executable each let the
   next check run; a signal-terminated check, a runner failure, a cancellation
   and every existing fail-closed exception stop scheduling and leave the
   remaining checks not run.
3. With two failed checks, one retry action reruns both, links each new attempt
   to its predecessor and keeps passed checks' evidence when inputs are
   unchanged; retry is offered when the latest attempt of the round passed.
4. A failing check that writes a tracked file stops the round and names that
   check and path; later checks are not run.
5. A started attempt without a terminal record still requires owner recovery.
6. Existing fail-closed tests pass unchanged, `verify check` behaviour is
   unchanged, and earlier helper request revisions keep their results.
7. The owner accepts this ADR before any implementation relies on it.

## Lifecycle Links

- Amends, on acceptance, [ADR-0045](./0045-guided-verification-setup.md) §5:
  its sentence "Ordinary runner verification still stops on its first failure"
  and the matching driver in its context no longer apply to task-scoped
  verification. Its `verify check` rule, configuration authority and legacy
  behaviour remain authoritative. ADR-0045's body stays unchanged; only its
  lifecycle metadata gains the link.
- Preserves ADR-0015, ADR-0043, ADR-0049 and ADR-0051.
- Supersedes: None.
- Superseded by: None.
- Required lifecycle decision: accept, reject with a reason, or request rework.
