# ADR 0014: Human-Triaged Review Closure

## Status / Date / Owner / Decision Makers

- Status: Accepted
- Date: 2026-08-12
- Owner: Banzai maintainers
- Decision makers: User, explicitly accepted in chat on 2026-08-12

## Related Artifacts

- Feature description:
  `documentation/features/risk-driven-test-assurance/description.md`
- Feature plan: Not created; planning cannot rely on this Proposed ADR.
- Existing runner requirements:
  `documentation/features/cross-vendor-workflow-runner/work.md`
- Repository authority: `AGENTS.md`
- Manifest: sections 3, 5, 6, and 10 of `PROJECT_MANIFEST.md`
- Related ADRs:
  - ADR 0001 preserves automatic routing and the review-triage gate.
  - ADR 0002 defines independent reviewer continuity and accepted-finding
    re-review.

## Context and Decision Drivers

Current strict runs may finish only after the latest review returns `pass`.
After a `changes_requested` result, the human must disposition every finding as
accepted, rejected, or deferred. If no finding is accepted, the runner performs
no source change but starts another review anyway. The reviewer receives the
same source plus cumulative triage and is asked to produce a new verdict.

This preserves a simple terminal invariant but weakens human triage authority in
practice and spends another model call on an unchanged implementation. The new
review can repeat rejected or deferred concerns, discover unrelated findings, or
convert a human disposition into an implicit reviewer veto even though only
accepted findings are authorized for fixing.

The target is to let a complete human triage record close the review loop when
there is no accepted work. Completion by triage must remain visibly distinct
from a clean reviewer pass. Accepted findings must continue through the existing
fix, deterministic verification, and bounded re-review policy.

Decision drivers:

- preserve explicit human authority over every finding disposition;
- avoid unchanged-source model calls and repeated findings;
- retain durable review and triage evidence;
- distinguish workflow completion from reviewer pass;
- preserve accepted-only mutation and risk-triggered reviewer rotation;
- remain compatible with persisted state and evaluation evidence;
- avoid adding a new decision gate or allowing automatic triage.

## Options Considered

### Option 1: Require a passing re-review after every triage

Keep the current transition from no-accepted-finding triage back to review until
a reviewer returns `pass`.

Benefits:

- every completed strict run has the same latest-review verdict;
- CLI and status can equate `done` with review pass;
- a reviewer gets an opportunity to account for the human dispositions.

Costs and rejection reason:

- no implementation evidence changes before the additional model call;
- a reviewer can repeat findings the human already rejected or deferred;
- human triage does not actually close the scope it authorizes;
- latency and usage grow without a corresponding fix or new verification result.
  Rejected because the clean terminal invariant is not worth an unchanged-source
  review loop.

### Option 2: Complete from triage when no finding is accepted

After complete triage, transition directly to terminal `done` when the accepted
set is empty. Preserve the latest `changes_requested` review and all triage
dispositions. Present completion as human-triaged, never as reviewer pass. Keep
the current fixer, verification, and re-review path whenever any finding is
accepted.

Benefits:

- human disposition is the final authority for unaccepted work;
- no model call is made against unchanged source;
- rejected and deferred evidence remains auditable;
- accepted findings retain independent re-review;
- the existing terminal state and persisted schema can remain compatible.

Costs and risks:

- `done` no longer always implies the latest review verdict is `pass`;
- downstream status and documentation must distinguish completion basis;
- a human can defer a material concern and still close the current run;
- tooling that inferred pass from `done` must be corrected.

### Option 3: Add a new terminal state for triaged completion

Introduce `done_with_findings` or an equivalent persisted status for runs whose
latest review did not pass but whose findings were all rejected or deferred.

Benefits:

- the completion basis is explicit in the state enum;
- consumers cannot confuse triaged completion with a clean pass.

Costs and rejection reason:

- changes persisted run-state unions, state migration, status output,
  evaluation aggregation, contracts, fixtures, and downstream consumers;
- adds a durable state distinction already derivable from latest review plus
  triage evidence;
- complicates recovery and compatibility for limited additional information.
  Rejected unless implementation proves derivation is ambiguous.

### Option 4: Allow rejected findings to close but keep deferred findings open

Finish when every finding is rejected, but require a later review or a separate
resolution for deferred findings.

Benefits:

- distinguishes explicit disagreement from consciously postponed work;
- prevents deferred blocker or security concerns from appearing complete.

Costs and rejection reason:

- creates an additional unresolved-state workflow without an authorized source
  change that could make re-review useful;
- changes the meaning of the existing `deferred` triage action without defining
  its later owner or scheduling mechanism;
- still risks unchanged-source reviewer loops. Rejected for this feature; a
  future task-tracking integration may give deferred findings a separate owner.

## Decision

Adopt Option 2.

After a human dispositions every finding from a valid strict review, transition
the run directly from `needs_triage` to `done` when the accepted finding set is
empty. Do not invoke a fixer, deterministic verification, or another reviewer,
because no reviewed source or configuration changed.

Persist the latest review result and the complete triage record unchanged.
Rejected and deferred findings remain durable human dispositions and must never
be relabeled as reviewer pass, resolved fixes, or proven false positives.

Present the terminal basis explicitly. A strict `done` run whose latest review
is `pass` is completed by review. A strict `done` run whose latest review is
`changes_requested` and whose latest complete triage accepted no finding is
completed by human triage. CLI, status, documentation, and evaluation consumers
must not infer `pass` solely from `done`.

When at least one finding is accepted, retain the existing accepted-only fixer,
post-fix deterministic verification, bounded delta re-review, risk-triggered
fresh review, and maximum-fix-cycle behavior. This decision adds no decision
gate and does not authorize automatic disposition.

Prefer deriving the completion basis from latest review and triage evidence
without changing run-state schema version 2 or review contract version `1.0.0`.
If implementation proves the derivation ambiguous, stop and propose a versioned
state decision rather than adding an implicit field.

## Consequences

Positive:

- unchanged-source re-review calls are removed;
- human triage has a clear and final workflow effect;
- rejected or deferred findings cannot repeatedly regenerate themselves inside
  the same run;
- accepted defects still receive independent fix verification;
- persisted review and triage evidence remains available for later evaluation.

Negative:

- terminal `done` has two completion bases;
- consumers and messages that currently equate `done` with `pass` require
  correction;
- deferred concerns have no automatic future task owner;
- human decisions can close a run despite a reviewer concern, which is the
  intended authority boundary but carries risk.

Risks and mitigations:

- misleading status: render latest verdict and triage counts whenever completion
  is triage-based;
- silent security deferral: keep severity/category and disposition in durable
  evidence and never render a pass claim;
- invalid terminal derivation: require a complete triage that covers every
  latest finding and has zero accepted items;
- evaluation drift: preserve the latest review verdict and cumulative triage as
  distinct fields; do not synthesize a passing review;
- accidental fix bypass: direct completion is allowed only when the accepted set
  is empty;
- compatibility regression: retain current schemas unless ambiguity forces a
  separately approved versioned change.

Required follow-ups:

- update state transitions and triage execution for direct completion;
- correct CLI and status text that currently prints `Review: pass` for every
  strict `done` run;
- add lifecycle tests for all-rejected, all-deferred, mixed rejected/deferred,
  and accepted findings;
- prove that no fixer, verification command, or reviewer call occurs on direct
  completion;
- preserve evaluation separation between review verdict and triage disposition;
- update workflow skills, product documentation, manifest, and superseding
  feature requirements.

## Compliance and Confirmation

Implementation and review must confirm:

1. complete triage with zero accepted findings transitions directly to `done`;
2. all-rejected, all-deferred, and mixed rejected/deferred triage make no fixer,
   verification, or reviewer call;
3. latest review verdict, finding evidence, and triage dispositions remain
   persisted unchanged;
4. terminal output distinguishes clean review pass from human-triaged
   completion and reports accepted, rejected, and deferred counts;
5. no consumer infers a passing verdict from terminal `done` alone;
6. any accepted finding retains the existing fix, verification, re-review,
   rotation, and maximum-cycle path;
7. triage still requires a disposition for every latest finding and remains an
   explicit human gate;
8. rejected findings remain distinct from proven false positives in evaluation;
9. state schema 2 and review/phase contract `1.0.0` remain compatible, or work
   stops for a separately approved versioned decision;
10. focused lifecycle tests, the repository final gate, committed bundle parity,
    formatter check, and `git diff --check` pass.

## Lifecycle Links

- Supersedes: None
- Superseded by: None
