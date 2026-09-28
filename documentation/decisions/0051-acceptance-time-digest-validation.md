# ADR 0051: Acceptance-Time Validation of Model-Authored Digests

## Status / Date / Owner / Decision Makers

- Status: Accepted
- Date: 2026-09-21
- Owner: Banzai maintainers
- Decision makers: Project owner; explicitly accepted in chat on 2026-09-21.
- Accepted proposal SHA-256:
  `1eea0c36c2cd79cdcd6184382cbf2b1b1d886e7ef39b6e7e9a3f9a2209331b35`.
- Review: four review iterations; review-3 F1/F2 and review-4 F1 were accepted
  and resolved before acceptance. Reviews are recorded in private work
  artifacts.

## Related Artifacts

- Requirements: private work `model-authored-digest-validation`, decision need
  AD1, requirements FR1, FR3, FR4, FR7, FR8, FR11 and FR13.
- Defect: issue 11 in the product repository, with a follow-up recording a
  second reproduction in a different code path.
- Related decisions: ADR-0049 (task-scoped verification authority, sections 2
  and 4), ADR-0043 (proportionate verification evidence), ADR-0024
  (operator-authorized prerequisite-blocked fix recovery), ADR-0023 (durable
  terminal attempt checkpoints), ADR-0017 (versioned plan task completion
  ledger).
- Manifest sections: 2 (commands), 5 (module responsibilities), 10 (active
  decision index).

## Context and Decision Drivers

A model authors digests into two structured surfaces. A phase result may carry
`sha256` for each source of a proposed verification descriptor. A strict plan
carries `planRemainderSha256` inside its `banzai-verification-obligations/v2`
inventory.

**Current behaviour.** Both are accepted after a shape check only:
`parseTaskVerificationCandidates` validates schema, identity uniqueness and
credential absence, not whether a digest matches any file. Agreement with the
repository is established later — at verification launch for descriptor
sources, and when the planning artifact is parsed for the plan remainder. Both
late checks fail closed, which is correct.

Two observed runs failed there. In one, an implementation result pinned a
source digest the same attempt never computed; the file had not changed since
before the run began. In the other, a planning result declared a remainder
digest that did not match the plan bytes the same attempt wrote. Both
diagnostics state that the input changed, which was false, and both direct the
operator to `banzai retry`, which re-reads the same unchanged artifact and
fails identically. Each run became terminal while presenting as externally
blocked.

**Target difference.** Disagreement between a model-authored digest and the
bytes it names must be attributable to the phase that produced it, reported as
such, and recoverable by obtaining a corrected result rather than by editing
artifacts or abandoning the run.

**Drivers.**

- Recoverability. FR13 requires recovery for exactly these two conditions;
  today neither is recoverable.
- Truthful diagnosis. FR3 requires distinguishing a digest that never matched
  from one that matched and later stopped matching. Nothing records a baseline
  that would make the distinction possible.
- The fail-closed guarantee. FR7 must survive unchanged for digests that are
  execution preconditions.
- ADR-0049's boundary. An approved obligation binds its command, not the
  pre-implementation bytes its plan observed; source identities recorded on a
  required obligation are descriptive. Any change must preserve the approved
  case where a plan names tooling the implementation will create.
- Cost asymmetry. Re-running one phase costs a bounded amount of model budget;
  a terminal run costs the whole run.
- Existing recovery authority, and its limits. A failed mutable attempt is
  refused ordinary retry because its repository side effects may be incomplete.
  The single exception requires failure code `PLAN_TASK_COMPLETION_INVALID`
  together with a matching invalid completion checkpoint for that same attempt.
  A lite result carrying a defective source identity establishes no such
  checkpoint, so it falls to the general refusal and the run can only be
  cancelled. Moving a comparison earlier does not by itself create a corrected
  result path, and planning already validates its result before the attempt
  completes. Any recovery this decision relies on must therefore be decided
  here rather than assumed, because recovery source classes are governed by
  ADR-0023 and ADR-0024.

## Options Considered

**Option 1 — Diagnostics and a recovery command, timing unchanged.** Keep
validation where it is; correct the wording and add a command that replays the
producing phase.

Benefits: smallest change; no contract movement; addresses the operator-visible
symptoms directly. Costs: the mismatch is still discovered far from its cause,
so the message must infer intent it cannot observe; without a recorded baseline
the "never matched" and "changed since" cases remain indistinguishable, leaving
FR3 unsatisfiable. Rejected for that reason.

**Option 2 — Establish digests when the result is accepted; retain the
consumption check.** Compare each model-authored digest against the bytes it
names at the boundary where the phase result or planning artifact is accepted.
A mismatch there is a defective result from that phase, handled by the existing
invalid-result path. The later check remains and, because acceptance recorded a
baseline, can truthfully report a change that happened afterwards.

Benefits: the failure is attributed where it originates, so the producing phase
can be re-run through a path that already exists; FR3 becomes satisfiable
because there is a recorded baseline; defence in depth against genuine drift is
preserved; the approved-obligation exception is untouched because only digests
acting as execution preconditions, plus the plan remainder, are compared. Costs:
adds bounded filesystem reads to result acceptance; introduces one more place a
result can be rejected; requires the comparison and the late check to agree on
what each digest role means.

**Option 3 — Runner-derived digests.** Stop accepting model-authored digests;
have the runner compute them when it accepts a result and when it prepares a
plan for approval.

Benefits: removes the failure class outright, since a value the model never
writes cannot be fabricated. Costs: changes the meaning of the fields from "what
the model observed" to "what the runner observed", which weakens the proposal's
own evidentiary value; the plan remainder must be inserted into bytes before
approval, so the runner would be editing an artifact the approval then covers,
which sits badly with the immutability rules in ADR-0017 and ADR-0049;
contract-visible change to `banzai-verification-obligations/v2` and the phase
result schema. Rejected as disproportionate to a defect whose checks already
work, and because it moves authorship into approved bytes.

**Option 4 — Remove source pins from proposals.** Drop `sources` from
model-proposed descriptors and rely on the inputs the runner captures at
execution.

Benefits: eliminates the descriptor half of the problem and aligns with
ADR-0049's position that captured inputs record what actually ran. Costs: does
nothing for `planRemainderSha256`, which is half the reported defect; loses the
supplemental proposal's binding to what it was proposed against, which ADR-0049
deliberately retains. Rejected as incomplete.

## Decision

Adopt Option 2 if this ADR is accepted.

Establish every model-authored digest against the bytes it names at the
boundary where the artifact carrying it is accepted, before any later phase
depends on it. A disagreement found there is a defective phase result, not an
external condition: attribute it to the producing phase and retain the rejected
attempt and its result as evidence.

### Digest-rejected repair source

Add one narrowly bounded recovery source, amending ADR-0023 and ADR-0024 by
extension without replacing any existing path. A **digest-rejected result** is
exactly an attempt satisfying all of the following:

- the run is non-terminal and has no live active attempt;
- the attempt reached a terminal checkpoint, and either applied its repository
  changes or produced none, so its side effects are known rather than partial;
- the only recorded failure for that attempt is a digest rejection at
  acceptance, attributed to that exact attempt;
- no successor attempt exists for that phase.

An attempt that fails these conditions keeps its current disposition. In
particular, a failed mutable attempt with unknown or partial side effects gains
no ordinary retry from this decision.

Repair requires explicit operator authorization, as ADR-0024 requires for its
own source. The successor attempt is linked to the rejected one, may only
supply a corrected result for the same phase, and gains no additional scope.
A replacement strict plan passes the existing approval gate and never inherits
the prior approval.

Every rejected digest goes through this repair route. The presence of a
mandatory obligation does not make a rejected candidate dispensable: the
`required` flag records where a check draws its execution authority from, not
whether the task needs it, and lite task assurance normally enters through the
candidate path. Removing a check remains a decision a corrected selection can
justify under existing assurance rules; a rejection alone never establishes it.

### Applicability

The acceptance-time comparison governs attempts accepted after this decision is
implemented. A run blocked before that point has no acceptance baseline, and
none may be reconstructed from current bytes. Such a run reports its causal
history as unknown, never as "never matched" or "changed after acceptance", and
is offered the repair route above when it satisfies the source conditions. When
it does not, the run states accurately that it cannot continue and that
cancelling is the remaining action.

Classify each digest by the role it holds, and compare only those roles that
bear on execution or on binding:

- a plan remainder digest binds its inventory to the plan bytes outside that
  inventory, and is compared when the planning artifact is accepted;
- an effective source identity on a lite or supplemental descriptor is an
  execution precondition, and is compared when the result carrying it is
  accepted;
- a source identity recorded on a required obligation in an approved plan is
  descriptive metadata, is not an execution precondition, and is not compared.

Retain the existing consumption-time checks. Their authority is unchanged for
refusing execution; their diagnostics change only in that a baseline
established at acceptance now lets them state whether the bytes changed after
acceptance or never matched.

Keep the size rejection distinct from a digest mismatch in both diagnosis and
reporting.

This decision does not alter which checks a phase may propose, the authority of
an approved obligation, model selection or effort, or any digest the runner
computes for its own evidence.

## Consequences

**Positive.** The two reported failures become recoverable through a path that
already exists rather than ending the run. Failures are attributed to the phase
that caused them, so the operator is not sent to look for an external change.
The distinction FR3 requires becomes expressible because acceptance records a
baseline. The approved-obligation boundary from ADR-0049 is stated explicitly
rather than left implicit in code.

**Negative.** Result acceptance does bounded filesystem work it did not do
before. A phase can now be rejected for a reason it could previously pass, so
some runs will spend an extra attempt where they previously proceeded to a
later failure. Two code paths must share one classification of digest roles, and
a divergence between them would reintroduce the inconsistency this decision
removes. Recovery authority grows by one source class, which enlarges the
surface that must keep proving side effects are known before permitting a
successor. Runs blocked under the current release gain accurate reporting and a
conditional route, not a guaranteed continuation.

**Risks.** A digest naming a path that does not yet exist must not be treated as
a mismatch where the approved plan legitimately anticipates future tooling;
misreading that case would break an accepted ADR-0049 guarantee. Re-running a
producing phase consumes model budget, so the recovery path must remain bounded
by existing attempt limits rather than retrying without limit.

**Follow-ups.** The dependent plan must state how the baseline is retained for
the later check, how the two code paths share the role classification, and how
the digest-rejected source is recognized and authorized. The plan chooses
helper names, record layouts and diagnostics wording; it does not decide which
attempts are repairable, which this decision fixes.

## Compliance and Confirmation

An implementation satisfies this decision when all of the following are
observable:

1. A phase result whose effective source identity does not match the file it
   names is rejected at acceptance, and the rejection names the field, the
   repository-relative path, the declared digest and the observed digest.
2. A planning artifact whose declared remainder digest does not match its own
   remaining bytes is rejected at acceptance under the same reporting rule.
3. After such a rejection and a valid replacement result, verification or
   ordinary plan approval is reachable with no manual edit to artifacts,
   private evidence or runner state, and the rejected attempt and result remain
   readable as evidence.
4. An approved obligation whose descriptor records source identities executes
   after the authorized implementation has changed those sources, and after
   tooling the plan anticipated has been created, without any source-identity
   comparison blocking it.
5. A proposal restating an approved obligation with different source identities
   leaves the approved obligation in force and is not refused for that
   difference alone.
6. A source exceeding the permitted size is reported with the limit and the
   observed size, distinguishably from a digest mismatch.
7. No unresolved digest condition yields an executed check or a result recorded
   as passed, advisory or reused.
8. No diagnostic introduced by this decision contains file contents.
9. A digest-rejected attempt that satisfies the source conditions reaches a
   linked successor after explicit operator authorization, and the rejected
   attempt and its result remain readable; a failed mutable attempt with
   partial or unknown side effects is still refused ordinary retry.
10. A lite result whose candidates were rejected executes no check and is not
    recorded as passed, advisory or reused until a corrected result replaces
    them; the presence of a mandatory obligation does not permit continuing
    without them.
11. A run blocked before this decision was implemented reports its causal
    history as unknown rather than asserting either cause, and is either
    offered the repair route or told accurately that cancelling is the
    remaining action.

## Lifecycle Links

- Supersedes: None
- Amends: [ADR-0023](./0023-durable-terminal-attempt-checkpoints.md) and
  [ADR-0024](./0024-operator-authorized-prerequisite-blocked-fix-recovery.md)
  by adding one recovery source; existing sources, refusals and terminal-proof
  requirements are unchanged.
- Superseded by: None
