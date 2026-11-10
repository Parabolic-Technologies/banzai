# WP21 · Runner-recorded plan digest and continuable planning blocks

Status: approved with `Approve plan` on 2026-11-09 · Program:
[banzai 2.8–2.9](../release-2-8-2-9-program/tracker.md) (Stage 1, outside
the brief) · Authority:
[ADR-0064](../../decisions/0064-runner-recorded-plan-remainder-digest.md),
[ADR-0065](../../decisions/0065-continuable-planner-declared-planning-blocks.md)

## Problem

On 2026-11-06 an owner run in a bootstrap-only project stopped at strict
planning. The default Claude planner had to compute `planRemainderSha256`,
the SHA-256 of `plan.md` outside its `banzai-verification-obligations/v2`
block. Under `--permission-mode dontAsk` every hashing command it tried was
denied, because the project allows only its own build and test commands. The
planner left 64 zeros in the field and returned `outcome=blocked`. The run
status then offered only cancellation: "This blocked state is not tied to a
failed attempt."

Two defects caused this:

- `packages/orchestrator/src/prompts.ts` tells the planner to compute the
  digest, and ADR-0051 rejects a wrong value at acceptance. A model cannot
  hash without a shell command, and a Claude planner has none unless a loaded
  allow rule grants one.
- `decideWithoutAttempt` in
  `packages/orchestrator/src/workflow/domain/retry-eligibility.ts` offers no
  retry for a planning block that the planner's own completed result
  declared.

## Authority

- [ADR-0064](../../decisions/0064-runner-recorded-plan-remainder-digest.md),
  accepted on 2026-11-06 with `Accept both`: the runner records the plan
  remainder digest when it accepts a planning result that requests plan
  approval. It amends ADR-0051 (plan remainder role) and pinned ADR-0058 (§1,
  §4, §5 and Compliance item 3).
- [ADR-0065](../../decisions/0065-continuable-planner-declared-planning-blocks.md),
  accepted on 2026-11-06 with `Accept both`: `banzai retry` continues a
  planner-declared planning block. It amends ADR-0036 narrowly.
- The ADR texts are authoritative wherever this document is shorter. The
  reciprocal links and the pinned ADR-0058 allow-list image are already
  recorded.
- Unchanged and binding: ADR-0017 and ADR-0038 (approval binds current bytes),
  ADR-0049 §2 (the inventory is part of the approved bundle), ADR-0023 and
  ADR-0024 (mutable attempts and fix recovery), ADR-0055 (planning review
  dispatch never falls through to ordinary planning), ADR-0018 (agent
  control).
- Tracker owner decision of 2026-10-31: the release-train version is bumped at
  the Gate 1 release, so `HOOK_CHANGED_WITHOUT_VERSION_BUMP` alone does not
  block a package.

The strict planning instruction in `prompts.ts` has no golden digest, so
these sentence changes need no instruction-baseline transition. New tests pin
the sentences, as WP3 did. No policy, phase file, skill or contract text
changes.

## Requirements

- **R1 · Planning instruction (ADR-0064 §1, ADR-0065 §4).** In the strict
  planning instruction:
  - the sentence "Compute the SHA-256 of the exact plan bytes after removing
    that complete fenced block (leave surrounding newlines)." is replaced.
    The new text tells the planner to set `planRemainderSha256` to 64 zeros
    and not to compute it, because the runner records the digest when it
    accepts a result that requests plan approval;
  - a new sentence says that a planning block reported with
    `outcome=blocked` can be continued by the human with `banzai retry`, so
    the summary names the cause and the exact human action needed first;
  - every other byte of the instruction is unchanged.
- **R2 · Runner-recorded remainder digest (ADR-0064 §2).** For a strict
  task-verification planning result with `gate=plan_approval` and a plan
  artifact, the runner, before the attempt completes:
  1. reads the plan as a regular, non-symlinked file that decodes as exact
     UTF-8; a missing, symlinked, non-regular or non-UTF-8 plan is rejected
     as an invalid planning result, and nothing is written;
  2. validates the plan as today, except for the remainder comparison: the
     canonical task headings, exactly one well-formed v2 inventory with valid
     descriptors, the fresh-evidence rule and the runner-control task rule.
     A failure keeps today's rejection, and nothing is written;
  3. computes the remainder digest with the existing
     `rewritePlanRemainderDigest`;
  4. records the acceptance-time digest evidence (R3) before any write;
  5. when the declared value differs, replaces the plan through the existing
     compare-and-replace write, so only the 64-character value changes. A
     plan whose bytes changed since step 1 is not written; the attempt fails
     with the existing `PLAN_TASK_COMPLETION_INVALID` code and a message that
     names the plan path and says nothing was written, so the failed
     planning attempt stays retryable with session reuse;
  6. accepts a correct declared value without writing.

  The compare-and-replace and file-refusal helpers in
  `workflow/plan-gate/recheck.ts` take caller-specific failures, so the
  re-check keeps its exact messages and acceptance gets its own.

- **R3 · Digest evidence v2 (ADR-0064 §2 step 3).**
  - `banzai-result-digest-evidence/v2` adds `recorded` to every comparison.
    It is `true` only for the plan remainder comparison of a plan attempt
    whose observed value the runner writes, and `false` everywhere else.
  - The outcome is `rejected` only when a comparison is unmatched and not
    recorded. A runner-recorded remainder never raises
    `ResultDigestRejectedError`.
  - New records use v2. v1 records stay readable with `recorded` read as
    `false`. The store keeps first-write-wins.
  - `digestRejectionReason` treats a recorded comparison as a match of its
    observed value, so a later consumption-time mismatch of a runner-recorded
    remainder reports a change after acceptance, not an unknown history.
- **R4 · Reconciliation (ADR-0064 §2).** Reconciling a planning attempt from
  its terminal checkpoint runs the same R2 steps:
  - after an interruption between the evidence write and the plan write, it
    writes the plan and keeps the first evidence record;
  - after the plan write, it writes nothing and keeps the evidence;
  - it never records a second, conflicting comparison.
- **R5 · Gate entry and re-check (ADR-0064 §2, amended ADR-0058 §1 and §4).**
  The plan-gate entry snapshot holds the runner-recorded bytes. An immediate
  re-check without edits rewrites nothing. The re-check record's planner
  remainder digest is the runner-recorded value. Approval still never
  rewrites a digest and still names the re-check on a mismatch.
- **R6 · Planner-declared block eligibility (ADR-0065 §1).** Retry
  eligibility gains one rule. A blocked run is retryable when all of these
  hold:
  - it is blocked from `planning`, with no active attempt or process;
  - no planning-review episode is `reviewing` or `analyzing`, and the latest
    closed review did not end stale;
  - the run's latest attempt is a completed plan attempt whose recorded
    result has `outcome=blocked`;
  - the run's block reason equals that result's summary.

  The decision reports that attempt's identity and a reason that names the
  planner's block. The rule stays in the pure domain module and reads the
  latest attempt record only through a new `needs` evidence step. A run
  blocked this way before WP21, such as the incident run, qualifies.

- **R7 · Continuation (ADR-0065 §2).**
  - `banzai retry` runs the usual retry preflight. It then moves the run to
    `planning` and starts a new plan attempt from the blocked attempt's
    record, through the existing planning retry path.
  - `planningContext.retryOf` names the blocked attempt.
  - The existing continuity rules decide whether the planner session resumes.
    A planner-declared block counts as a reusable source, unlike an
    unsupported failure.
  - The attempt receives a "Continue blocked planning" prompt component. It
    states that the human chose to continue after the reported block, and it
    carries the redacted, bounded summary as diagnostic data only.
  - A block from an episode's `applying` step continues that step: the
    planning-review application prompt is still supplied, and the episode
    closes as ADR-0055 decides.
  - The continuation emits `attempt.retry_requested` with the blocked
    attempt's identity, `kind: "plan"` and `retryFrom: "planning"`.
  - Recorded ADR decisions, consultation answers and planning-review triage
    stay in force.
- **R8 · Surfaces (ADR-0065 §3).**
  - The terminal blocked-run menu shows "Continue planning after the reported
    block". It confirms with "Run preflight and continue planning after the
    reported block?".
  - The failed-attempt copy is unchanged.
  - Human status names `banzai retry` as the next step.
  - Agent control already derives `retry` from eligibility, and its contracts
    do not change.
- **R9 · Unchanged behaviour.**
  - Approval never rewrites a digest.
  - A mismatched source identity on a lite or supplemental descriptor in an
    implementation or fix result is still rejected at acceptance and offered
    the digest-rejected repair route.
  - Blocks reported by implementation and fix attempts keep their current
    disposition. Failed mutable attempts stay refused.
  - Planning-review retries for `reviewing`, `analyzing` and stale episodes
    are unchanged.
  - The standalone plan policy is unchanged.
- **R10 · Documentation and facts.**
  - `documentation/orchestrator.md` describes the runner-recorded digest and
    the planning continuation.
  - `packages/orchestrator/MODULES.md` covers the changed owners: plan-tasks,
    plan-gate helpers, digest evidence and retry eligibility.
  - `PROJECT_MANIFEST.md` §6 states both facts.
  - At close-out, ADR-0064 and ADR-0065 become Implemented, and the
    non-pinned reciprocal lines in ADR-0051 and ADR-0036 say Implemented.
    Pinned ADR-0058's annotation stays as admitted, as ADR-0055's did after
    WP4.

## Acceptance

1. A workflow test with a fake planner that writes 64 zeros reaches
   `needs_plan_approval`. The plan's remainder digest then matches its bytes,
   only the 64-character value differs from the planner's bytes, and the
   evidence is v2 with `recorded: true`, `outcome: "accepted"`, the zeros as
   `declared` and the digest as `observed`.
2. A planner that writes the correct digest causes no plan write, and its
   evidence has `matched: true` and `recorded: false`.
3. A missing, symlinked or non-UTF-8 plan, a duplicated or malformed
   inventory, an invalid descriptor, a non-canonical heading or a
   runner-control task violation is rejected as today, with the plan bytes
   unchanged.
4. A plan changed between the read and the write keeps the changed bytes,
   and the attempt fails with `PLAN_TASK_COMPLETION_INVALID`, a message naming
   the plan path, and stays retryable.
5. Reconciling after an interruption at either point of R4 reaches the same
   plan bytes and one evidence record.
6. The gate-entry snapshot equals the recorded plan, a re-check without edits
   reports no rewrite, and approval succeeds without any re-check.
7. Approval over a later hand-edited mismatch still fails, names the re-check
   and writes nothing.
8. An implementation result with a mismatched supplemental source identity is
   still rejected and offered the digest-rejected route.
9. A run blocked by a planner result reports `retry.eligible: true` with the
   blocked attempt's identity. `banzai retry` starts a plan attempt with
   `planningContext.retryOf` set to it and the "Continue blocked planning"
   component, and recorded ADR decisions survive.
10. The same holds for a block from the `applying` step, which keeps the
    application prompt and the open episode.
11. A run whose block reason differs from the latest plan result's summary,
    or whose latest attempt is not a plan attempt, stays ineligible. So do a
    blocked implementation or fix result and a failed mutable attempt.
12. A state fixture shaped like the incident run, blocked from planning with
    a closed applied planning review and a completed blocked plan attempt, is
    eligible.
13. The terminal shows the new label and confirmation, agent control reports
    `retry` as the blocked next action, and no contract version changes.
14. The two instruction sentences of R1 are pinned by tests, and the old
    hashing sentence is absent.
15. `npm run verify` passes.
16. At Gate 1, with the owner's go-ahead, the incident run continues with
    `banzai retry` and reaches the plan gate.

## Out of scope

- A hashing helper or any new permission for model sessions (ADR-0064 option
  2).
- Retry for blocks reported by implementation, fix, feature or quick-fix work.
- Changes to the standalone `development-plan` skill or the plan policy.
- Steering the planner to `gate=escalation` (ADR-0065 option 2).
- A release-train version bump; it happens at the Gate 1 release.
