# ADR 0065: Continuable Planner-Declared Planning Blocks

## Status / Date / Owner / Decision Makers

- Status: Accepted
- Date: 2026-11-06
- Owner: Banzai maintainers
- Decision makers: Repository owner; explicitly accepted in chat on 2026-11-06
  with `Accept both` (ADR-0064 and ADR-0065).
- Acceptance date: 2026-11-06
- Accepted proposal SHA-256: `e1ca071f6549d6a7d1ac35d9cbe713c1d0cdaf47159617295decf43f83b22954`.
- Lifecycle effect: the amendment in Lifecycle Links is accepted and its
  reciprocal link is recorded. The proposal-stage wording and the decision
  body are retained unchanged. Dependent planning is authorized; plan
  approval is still required before implementation.
- Implementation state: Implemented on 2026-11-09 by WP21 of the 2.8–2.9
  program, for the 2.8 release; the Gate 1 item awaits the owner.
- Owner choices: given on 2026-11-06, before drafting, through three closed
  questions. This ADR records the answer "Allow retry" to the question how a
  run continues after the planner returns `outcome=blocked`. The digest
  answer is recorded in
  [ADR-0064](./0064-runner-recorded-plan-remainder-digest.md) and the
  placement answer is "New WP21 in Stage 1". No owner choice is open.
- Review: one independent read-only review of this ADR and ADR-0064 on
  2026-11-06 before submission. Its findings are applied: a block during a
  planning review's `applying` step is covered, ADR-0024's reasons against
  retrying completed blocked results are addressed, the attempt identity is
  specified and the attempt-kind terms are exact.
- Preparation authority: the owner's `Yes, fix it here` of 2026-11-06.
  Preparing this proposal is not acceptance; no code may rely on it.

## Related Artifacts

- Incident: the owner run of 2026-11-06 described in ADR-0064. The planner
  named the missing permission, asked the owner to "resume the planning
  phase", and returned `outcome=blocked`. The run status then said: "This
  blocked state is not tied to a failed attempt. Resolve it manually or cancel
  the run." No command could resume planning.
- Program tracker: [tracker.md](../work/release-2-8-2-9-program/tracker.md),
  WP21.
- Code:
  - `packages/orchestrator/src/workflow.ts`: plan result application sends
    `outcome=blocked` to `blockState` with the planner's summary, and
    `retry` runs a retry after its preflight;
  - `packages/orchestrator/src/workflow/domain/retry-eligibility.ts`:
    `decideWithoutAttempt` offers no retry for this state;
  - `packages/orchestrator/src/interactive.ts`: blocked-run choices;
  - `packages/orchestrator/src/agent-control.ts`: the blocked next action
    follows retry eligibility;
  - `packages/orchestrator/src/prompts.ts`: the common rule for
    `outcome=blocked`.
- Repository authority: [AGENTS.md](../../AGENTS.md),
  [PROJECT_MANIFEST.md](../../PROJECT_MANIFEST.md) sections 6 and 10, and the
  [decision lifecycle](./README.md#lifecycle).
- Accepted decisions:
  - [ADR-0023](./0023-durable-terminal-attempt-checkpoints.md): retry versus
    recovery of mutable attempts. Unchanged.
  - [ADR-0024](./0024-operator-authorized-prerequisite-blocked-fix-recovery.md):
    a completed blocked fix result continues through operator-authorized
    recovery; its Option 2 rejected ordinary retry for that source. Unchanged;
    the Context explains why its reasons do not carry over to planning.
  - [ADR-0051](./0051-acceptance-time-digest-validation.md): the
    digest-rejected repair source. Unchanged.
  - [ADR-0055](./0055-planning-gate-rework-and-independent-planning-review.md):
    planning gates, rework and planning review retries. Unchanged.
  - [ADR-0036](./0036-vendor-neutral-policy-files-and-instruction-delivery.md):
    its layout stop uses `gate=escalation` because "a completed attempt with
    that outcome is not retryable". Amended narrowly here.
  - [ADR-0018](./0018-agent-supervised-banzai-cli-control.md): agent-control
    retry. Unchanged.

## Context and Decision Drivers

**Current behaviour.** A phase result may return `outcome=blocked`. For a
planning attempt the runner applies the result: it records the planner's
summary as the block reason and moves the run to `blocked` from `planning`.
The attempt completed, so there is no failed attempt to retry and no
recovery source applies. The run can only be cancelled. ADR-0036 relies on
this when it routes its layout stop through `gate=escalation`.

The common instruction allows `outcome=blocked` only "for a failure that a
human decision cannot resolve through the requested gate". In planning such
failures are often external and fixable by a human: a missing permission,
tool, credential or file. The planner can name the fix but cannot be resumed.
Cancelling keeps the planning files but discards the run's recorded ADR
decisions, consultation answers, planning-review triage and session
continuity, and a new run must repeat them.

Planning attempts change only planning artifacts, under the hook's planning
grant. They make no code changes, so ADR-0023's concern about unknown partial
side effects of mutable attempts does not apply to them.

ADR-0024 rejected ordinary retry for a completed blocked fix result for three
reasons: retry is designed around failed attempts, a supervising agent could
infer retry without a current human decision, and retry authorization is not
bound to the exact workspace the operator inspected. For a fix, these matter:
the blocked result proves partial accepted progress in source files, and a
continuation must start from exactly that workspace. A planning block has no
such stake. Its attempt changed no source, the next planning attempt reads
the current planning files and returns through the same human gates, and no
approval or acceptance can follow without a human decision. A supervisor that
retries early spends model budget and can reach the same block again, but
cannot change code or approvals; the `orchestrate` skill already lets a
supervisor retry only after the reported prerequisite is resolved. The
retry-versus-recovery distinction therefore stays as ADR-0024 decides for
fixes, and planning uses retry.

**Target.** After fixing the cause a planner reported, the human continues the
same run with the existing retry action.

**Drivers.**

- A human who fixes the reported cause continues the same run.
- Continuing grants no approval, acceptance, scope or code change.
- Mutable attempts keep their current refusal.
- Every continuation is an explicit, current human action.
- Runs already blocked this way can continue after the upgrade.

## Options Considered

1. **Retry continues planning.** `banzai retry`, the terminal's blocked-run
   menu and agent control continue a planner-declared planning block.
   Selected.

   Benefits: reuses the retry action every surface already has; no new
   command, gate or contract version; runs blocked before the upgrade
   qualify.

   Costs: a planner that reports a block for a cause no human can fix can be
   retried repeatedly at model cost. Each retry is an explicit action. Retry
   now covers one completed result, which departs from ADR-0024's reading of
   retry as failure-only; the Context bounds that departure to planning.

2. **Steer the planner to `gate=escalation`.** A prompt change asks the
   planner to escalate human-fixable prerequisites. Runs already blocked stay
   cancel-only, and a model that still returns `outcome=blocked` leaves the
   same dead end. Rejected.

3. **A new resume command or gate for planning blocks.** Adds a command and an
   agent-control revision for what retry already expresses. Rejected.

4. **Keep the block terminal.** Cancelling discards recorded decisions and
   continuity. Rejected.

## Decision

Adopt option 1.

### 1. Eligibility

A blocked run is retryable when all of the following hold:

- it is blocked from `planning` and has no active attempt or process;
- no planning-review step is `reviewing` or `analyzing`, and the latest
  planning review did not end stale (those cases keep ADR-0055's
  planning-review retry);
- its block was applied from the result of its latest plan attempt, and that
  result returned `outcome=blocked`.

This includes a block returned by the plan attempt of an episode's
`applying` step. The runner recognizes the last condition from the run's
durable attempt records, so runs blocked this way before this decision is
implemented qualify too. Every other planning block keeps its current
disposition.

### 2. Effect

Retry eligibility reports the blocked plan attempt's identity. After the
usual retry preflight, the runner starts a new plan attempt that records the
blocked attempt as the one it continues. It resumes the planner session when
the existing planner continuity rules allow, otherwise it starts fresh. It
receives the current planning instructions and the block summary it
continues from. It has the planning phase's write authority and nothing more.
Recorded ADR decisions, consultation answers and planning-review triage keep
their effect. The attempt returns through the ordinary planning gates.

A block from the `applying` step continues that step: the new attempt applies
the recorded triage within the open episode, which closes as ADR-0055
decides. It never falls through to ordinary planning.

### 3. Surfaces

- `banzai retry` performs the continuation. The status's next step names it.
- The terminal blocked-run menu offers it with copy that says planning
  continues after the reported block, distinct from the copy for a failed
  planning attempt.
- Agent control already derives its blocked next action from retry
  eligibility and already performs retry. No control contract changes.

### 4. Planning instruction

The planning instruction tells the planner that a block it reports can be
continued by the human with `banzai retry`. The block summary must therefore
name the cause and the exact human action needed before the retry.

### 5. What stays

- Blocks reported by implementation attempts (including lite feature and
  quick-fix work) and by fix attempts keep their current disposition,
  including ADR-0024's recovery. Failed mutable attempts stay refused for
  ordinary retry (ADR-0023).
- The retry and recovery rules of ADR-0023, ADR-0024, ADR-0051 and ADR-0055
  are unchanged.
- ADR-0036's layout stop keeps using `gate=escalation`.

## Consequences

Positive:

- A planner-declared block becomes recoverable without losing the run's
  recorded decisions.
- No new command, gate or contract version.
- The incident run can continue after the upgrade.

Negative and risks:

- A block that no human can fix can be retried repeatedly at model cost,
  bounded only by the human's explicit retries.
- Retry eligibility reads one more fact from the attempt records. A wrong
  reading could offer retry for a block that is not the planner's own; tests
  of each excluded case carry that risk.

Follow-ups:

- After acceptance, record the reciprocal lifecycle link on ADR-0036 (not
  pinned in `phase-guidance-current.json`).
- The planning instruction sentence has no golden digest. A test pins the new
  sentence.
- Update `documentation/orchestrator.md`, `packages/orchestrator/MODULES.md`
  and the manifest where retry eligibility is described.

## Compliance and Confirmation

1. A run blocked by a plan attempt result with `outcome=blocked` reports retry
   as eligible with the blocked attempt's identity and a reason that names
   the planner's block. `banzai retry` runs the preflight and starts a plan
   attempt that records the blocked attempt as the one it continues.
2. That attempt resumes the planner session when continuity allows, has only
   planning write authority, receives the block summary, and keeps recorded
   ADR decisions, consultation answers and planning-review triage.
3. A run blocked this way before this decision is implemented is retryable
   after the upgrade.
4. A blocked result from an implementation attempt (including lite feature
   and quick-fix work) or a fix attempt keeps its current disposition, and a
   failed mutable attempt is still refused ordinary retry.
5. A block from the plan attempt of an `applying` step is retryable, and the
   retry continues that step inside the open episode. Planning blocks during a
   `reviewing` or `analyzing` step, or after a stale review, keep ADR-0055's
   behaviour.
6. The terminal offers the continuation, and agent control reports `retry` as
   the blocked next action with no contract version change.
7. The planning instruction tells the planner how to word a block.
8. `npm run verify` passes.

## Lifecycle Links

- Amends, on acceptance,
  [ADR-0036](./0036-vendor-neutral-policy-files-and-instruction-delivery.md)
  narrowly: its statement that a completed attempt with `outcome=blocked` is
  not retryable no longer holds for planning attempts. Its layout stop keeps
  `gate=escalation`.
- Preserves ADR-0018, ADR-0023, ADR-0024, ADR-0051 and ADR-0055.
- Supersedes: None.
- Superseded by: None.
- Required lifecycle decision: accept, reject with a reason, or request rework.
