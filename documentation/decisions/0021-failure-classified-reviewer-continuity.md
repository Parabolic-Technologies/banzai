# ADR 0021: Failure-Classified Reviewer Continuity

## Status / Date / Owner / Decision Makers

- Status: Accepted
- Date: 2026-08-17
- Owner: Banzai maintainers
- Decision makers: User, explicitly accepted in chat on 2026-08-17

## Related Artifacts

- Feature description:
  `documentation/features/bounded-model-invocation-cost/description.md`
- Repository authority: `AGENTS.md`
- Manifest: sections 5, 6, 8, and 10 of `PROJECT_MANIFEST.md`
- Related ADRs:
  - ADR 0002, Session affinity and bounded reviewer continuity
  - ADR 0014, Human-triaged review closure
  - ADR 0019, Attempt-owned review candidates
  - ADR 0020, Scoped Claude subprocess environment

## Context and Decision Drivers

ADR 0002 established that the primary review is fresh and full, routine
re-reviews resume the reviewer session in delta mode, and specific risk or
recovery conditions rotate the reviewer. `reviewExecutionPolicy` in
`workflow.ts` implements that policy and returns `sessionMode: "fresh"` with
`reviewMode: "full"` for any pending rotation reason.

`failAttempt` sets that pending rotation reason on every failed review attempt,
without regard to cause:

```js
if (record.attempt.kind === "review") {
  state.pendingReviewRotationReason = "previous-review-failed";
}
```

Consequence: a rate limit provokes the single most expensive possible response.
In the source run, the cheap resumed delta review hit
`You've hit your session limit`, and its retry was promoted to a full
from-scratch audit costing 2,385,435 input tokens. That run's metrics record
`reviews: {full: 4, delta: 1, rotations: 3}` — the delta path was used once and
then lost. A capacity, timeout, process-start, or transport failure says nothing
about review integrity, and treating it as if it did converts a transient vendor
condition into a full re-audit.

Three further problems share this boundary.

**Untyped causes.** The workflow can only see a message string. The adapter
composes `Claude exited 1: You've hit your session limit · resets 8pm` from the
last structured error in the stream. The stream itself is far more precise: the
failed attempt's final `result` event carries `is_error: true`,
`terminal_reason: "api_error"`, and `api_error_status: 429`, and the preceding
assistant message carries `"error": "rate_limit"` with
`is_api_error_message: true`. Branching on message text would be fragile; the
structured fields are not.

**Silent inventory invalidation.** In the same run, `review-2-0e1b215f` created
session `73f339bc-…` with 84 tools and `review-3-40c6dd3c` resumed it with 27,
because the operator's MCP servers raced between `pending` and `connected`
between attempts. Because tool definitions lead the cached prefix, the mismatch
invalidated all of it. That resumed attempt wrote 323,197 cache-creation tokens
and cost `$3.2666075` for 33 seconds of work that then died on the session
limit — as expensive as the successful 3m46s review, for zero output. The
orchestrator absorbed this as an invisible full re-cache. ADR 0020 removes the
dominant source of that nondeterminism by pinning MCP and plugin discovery, but
a `claude` upgrade or a project settings edit between attempts can still change
the inventory.

**Untruthful accounting.** `state.metrics.usage` is incremented only in
`completeAttempt` and `reconcileAttempt`. `failAttempt` never contributes, and
the adapter throws `processExitError` without ever parsing the usage that the
stream already contains. The source run's recorded cost is `$7.177443` while
`review-3-40c6dd3c` alone burned `$3.27` unrecorded, plus a 6m33s attempt that
recorded nothing at all. Any cost work in this repository is otherwise measuring
a fiction.

**Disproportionate rejection.** `review-2-f09d97a7` ran 6m33s to completion and
was rejected because its Markdown artifact did not enumerate one approved-scope
path. The structured result already carried the authoritative values; the
artifact is a rendering of them. ADR 0019 deliberately kept reviewer-write mode
and deferred unified runner rendering to a separate decision, so the artifact
requirement stands — but discarding a complete review over a list omission,
rather than asking the still-resumable session to fix the list, is not
proportionate.

Decision drivers:

- reserve the most expensive recovery for causes that actually invalidate
  reviewer continuity;
- classify from structured vendor evidence, never from message text;
- keep every rotation reason closed, named, and observable;
- make a changed session inventory a deliberate decision, not an invisible cost;
- make run metrics truthful about failed attempts;
- prefer a bounded in-session repair to a discarded run;
- preserve review independence, approval binding, drift detection, and human
  triage exactly;
- add no dependency.

## Options Considered

### Option 1: Keep the current unconditional rotation

Benefits:

- simplest; always errs toward a fresh reviewer.

Costs and rejection reason:

- makes a transient vendor condition maximally expensive;
- observed to consume 2.39M input tokens in response to a rate limit;
- the delta path it discards is the mechanism ADR 0002 introduced to bound
  reviewer cost.

Rejected because it defeats ADR 0002's own purpose exactly when cost matters
most.

### Option 2: Classify by error message text

Match `session limit`, `rate limit`, `429`, and similar strings in the composed
error message.

Benefits:

- no adapter contract change.

Costs and rejection reason:

- vendor prose is not a contract and changes without notice;
- localisation, redaction, and truncation all corrupt the signal;
- a false negative silently restores the expensive path, and a false positive
  would preserve a session that should have rotated.

Rejected as an unsafe basis for a continuity decision.

### Option 3: Typed failure cause from the structured stream

Give the adapter a closed cause type derived from structured stream fields —
`api_error_status`, `terminal_reason`, `is_error`, and the existing
`PROCESS_TIMEOUT` / `PROCESS_START_FAILED` / `PROCESS_OUTPUT_LIMIT` Banzai codes.
Carry it on the thrown error. Let `failAttempt` branch on it: integrity-neutral
causes preserve the reviewer binding and set no pending rotation reason;
everything else keeps today's `previous-review-failed` rotation.

Benefits:

- decisions rest on machine-readable vendor fields;
- the closed cause set is testable without a vendor call;
- capacity and transport failures retry as `resumed` / `delta`;
- the cause is also useful in events, status, and evaluation.

Costs and risks:

- adds a type to the adapter/workflow boundary;
- an unrecognised structured shape must default to the conservative rotating
  behaviour;
- a resumed session may be genuinely unusable after a long outage, which the
  existing binding, approval-digest, and workspace-digest checks must still
  catch.

### Option 4: Retry the same review attempt in place, without policy change

Benefits:

- no continuity semantics change.

Costs and rejection reason:

- retry entry points, iteration reset, and attempt evidence are already built
  around a new attempt per try, per ADR 0019;
- it would hide the capacity failure from metrics and evidence;
- it does not fix the accounting or inventory problems.

Rejected as a narrower fix that leaves the surrounding defects in place.

## Decision

Adopt Option 3, and decide the three adjacent boundaries with it.

**Typed causes.** Introduce a closed model-failure cause set covering at least
capacity, timeout, process start, transport, and unclassified. Derive it from the
vendor's structured stream and from existing typed Banzai process codes, never
from message text. An unrecognised shape classifies as unclassified. Carry the
cause on the thrown error and persist it on the attempt record alongside the
existing `failureCode`.

**Reviewer retry policy.** In `failAttempt`, set
`pendingReviewRotationReason = "previous-review-failed"` only when the typed cause
is not integrity-neutral. Treat capacity, timeout, process-start, and transport
causes as integrity-neutral: leave the reviewer session binding and the pending
rotation reason untouched so `reviewExecutionPolicy` can reach its normal
`resumed` / `delta` outcome. Unclassified causes keep today's rotating behaviour.
Every existing rotation condition — contract violations, artifact validation
failures, workspace or approval digest drift, `unreliable-review`,
`previous-review-blocked`, `previous-review-interrupted`, `delta-limit-reached`,
`settings-changed`, `missing-session`, and `accepted-high-risk-finding` — is
unchanged and still forces a fresh full review.

**Session inventory continuity.** Record on the session binding both the resolved
invocation identity that ADR 0020 makes deterministic and the observed tool
inventory of the session as created, taken from the vendor's `system/init` event.
Compare the invocation identity before resuming: a mismatch rotates deliberately,
before any process starts and at zero token cost. Compare the observed inventory
when a resumed session reports its own `system/init`: a mismatch is recorded as a
named rotation condition for the next review and emitted as an event, so a full
re-cache is never absorbed silently. Add exactly one new closed rotation reason
for this condition. Historical bindings without the recorded fields keep working
and are treated as unknown rather than mismatched.

**Failed-attempt accounting.** Parse usage from the vendor stream on a non-zero
exit and carry it on the thrown error so the failure path reaches the existing
`normalizedUsage`. Persist usage and retained redacted stdout and stderr on the
failed attempt record, and include a failed attempt's usage in
`state.metrics.usage`. A failed attempt must remain distinguishable from a
completed one in metrics and evaluation; adding its usage must not make it count
as a completed attempt, a review, or a verdict.

**Bounded artifact repair.** When a review returns a valid structured result but
its candidate artifact fails content validation, issue at most one additional
turn in the same reviewer session, naming the exact typed validation failure and
requiring the candidate be rewritten. Re-run the complete unchanged validation
afterwards. Both turns belong to the same attempt, and their usage accumulates on
that attempt. A second failure fails the attempt exactly as today. Repair must
not relax, skip, or parameterise any validation rule, must not apply when the
failure is a path or authorization violation, and must not apply in
runner-rendered mode, where the runner authored the candidate. ADR 0019's
deferral of unified runner rendering stands; this decision does not revisit it.

## Consequences

Positive consequences:

- a rate limit costs a resumed delta review instead of a 2.39M-token full audit;
- continuity decisions rest on structured vendor evidence and a closed cause set;
- a changed session inventory becomes a named, observable decision;
- run metrics and `banzai eval export` stop understating real consumption;
- a complete review rejected over a list omission is repaired in a warm session
  instead of discarded;
- every rotation reason remains closed and enumerable.

Negative consequences and risks:

- preserving a reviewer session across a capacity failure could resume a session
  the vendor has since expired; the existing binding, approval-digest, and
  workspace-digest checks plus the `missing-session` and `unreliable-review`
  rotations remain the backstop, and a failed resume classifies and retries
  normally;
- the closed cause set must be extended by hand when a vendor adds a terminal
  reason, and an unrecognised shape deliberately falls back to the expensive but
  safe path;
- one new rotation reason and new optional binding fields widen persisted state,
  the evaluation rotation-reason list, and the status projections;
- including failed-attempt usage changes historical-versus-new metric
  comparability, which the README and manifest must state;
- the repair turn adds one bounded vendor call to a path that previously failed
  immediately, and its prompt must not become a channel for relaxing validation.

Required follow-ups:

- implement the typed cause, its structured derivation, and its persistence;
- branch `failAttempt` and confirm `reviewExecutionPolicy` reaches
  `resumed` / `delta` after an integrity-neutral failure;
- record and compare invocation identity and observed inventory on session
  bindings;
- carry usage through the failure path and into run metrics;
- implement the single bounded repair turn;
- extend the closed rotation-reason lists in `types.ts`, `validation.ts`, and
  `evaluation.ts` together;
- update the manifest, README, and packaged documentation.

## Compliance and Confirmation

Implementation and review must confirm all of the following:

1. a review attempt that fails with a capacity cause leaves the reviewer binding
   intact, sets no pending rotation reason, and produces a `resumed` / `delta`
   policy on the next review;
2. a review attempt that fails with a contract, artifact-validation, drift, or
   approval cause still forces `fresh` / `full` with its existing reason;
3. classification is derived from structured stream fields and typed process
   codes, and no branch depends on vendor message text;
4. an unrecognised failure shape classifies as unclassified and takes the
   rotating path;
5. a created session records its invocation identity and observed tool
   inventory; a changed identity rotates before a process starts; a changed
   observed inventory emits an event and sets the new named rotation reason;
6. historical bindings without those fields neither rotate spuriously nor claim a
   match;
7. a non-zero-exit failure whose stream carries usage persists that usage and its
   redacted stdout and stderr, and contributes to `state.metrics.usage`;
8. a failed attempt contributing usage is still excluded from completed-attempt,
   review, verdict, and finding metrics and from canonical review evidence;
9. a candidate failing content validation triggers exactly one same-session
   repair turn, re-runs the complete unchanged validation, and fails the attempt
   on a second failure;
10. repair does not run for path or authorization violations, does not run in
    runner-rendered mode, and never publishes an unvalidated candidate;
11. review independence, exact-path reviewer-write authorization, approved bundle
    immutability, workspace drift detection, retry eligibility, and human triage
    are unchanged;
12. `npm run verify` passes and the committed bundle is rebuilt in the same
    change.

## Lifecycle Links

- Supersedes: None
- Superseded by: None
- Amended by [ADR-0037](./0037-unified-runner-rendered-review-artifacts.md),
  accepted 2026-09-08: new runner-rendered attempts perform no formatting-only
  model repair and require compatible output-contract evidence for session
  reuse. Typed failure handling, existing reason meanings and historical
  repair evidence remain binding.
