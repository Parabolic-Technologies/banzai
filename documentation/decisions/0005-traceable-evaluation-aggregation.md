# ADR 0005: Traceable Evaluation Aggregation

## Status / Date / Owner / Decision Makers

- Status: Accepted
- Date: 2026-08-02
- Owner: Banzai maintainers
- Decision makers: User, explicitly accepted in chat on 2026-08-02

## Related Artifacts

- Feature description:
  `documentation/features/evidence-driven-evaluation-export/description.md`
- Feature plan:
  `documentation/development-plans/evidence-driven-evaluation-export/plan.md`
- Manifest: sections 3, 5-6, 8, and 10 of `PROJECT_MANIFEST.md`
- Related ADRs:
  - ADR-0001 defines persisted workflow-selection evidence and legacy strict
    fallback; no conflict.
  - ADR-0002 defines session/review attempt evidence, cumulative triage, and
    current run metrics. This ADR governs cross-run interpretation and does not
    change those operational semantics.

## Context and Decision Drivers

The run directory contains overlapping evidence with different purposes:

- `state.json` owns current status, route, cumulative triage/fix state,
  verification's latest retained cycle, and operational aggregate metrics;
- `attempts/*.json` owns individual model-attempt status, timing, session/review
  policy, structured result, and usage when the adapter reported it;
- `reviews/review-*.json` owns applied structured review results;
- `events.jsonl` owns append-only retry and lifecycle summaries;
- output and verification log files contain forbidden raw content and are not
  evaluation inputs.

These surfaces are not a lossless event-sourced ledger. In particular,
`state.verification` is cleared before each verification cycle, while
`metrics.attempts.verification` is cumulative. Historical verification command
durations can therefore be unavailable even when a cumulative command count is
known. Legacy schema version 1 lacks the session/review fields added in version 2. Failed or interrupted attempts can have null usage or duration. A completed
attempt can be reconciled later, but reconciliation is not another attempt.

Trusting only terminal `state.metrics` hides failure detail and can double-count
if combined naively with attempts. Trusting only leaf files discards useful
cumulative state and makes missing files invisible. Failing the whole export on
one malformed file recreates survivorship bias.

Decision question: Which persisted source owns each evaluation value, and how
do exact, partial, unavailable, legacy, malformed, resumed, and reconciled
evidence aggregate without invention or double counting?

Decision owner: Banzai maintainers, with explicit user lifecycle approval.

Decision drivers:

- every total must be reproducible from exported per-run evidence;
- failed, cancelled, blocked, incomplete, and malformed runs must remain
  visible;
- zero, null, absent, unavailable, and invalid must stay distinguishable;
- retry, resume, and reconciliation must not inflate attempts or usage;
- current schema limitations must be represented, not guessed around;
- review/triage terminology must not overclaim human quality labels;
- one corrupt source must degrade a run or metric, not the entire cohort;
- aggregation must remain deterministic and understandable without raw prose.

## Options Considered

### Option 1: Source-precedence matrix with coverage-aware leaf aggregation

Assign ownership per metric, deduplicate leaf evidence by persisted identity,
project safe per-run records, and derive cohort totals only from those records.
Use state accumulators as owners only where no complete leaf ledger exists and
as consistency checks elsewhere. Represent partial coverage explicitly.

Benefits:

- maximizes traceability without treating overlapping records as additive;
- retains failed and incomplete attempts;
- exposes state/leaf disagreement rather than silently choosing a larger value;
- supports legacy and malformed evidence without false precision;
- makes every aggregate formula deterministic from exported records.

Costs and risks:

- requires explicit per-field ownership and more detailed tests;
- some totals remain null with an observed subtotal;
- historical verification duration cannot be reconstructed under current
  persistence;
- malformed duplicate identities need conservative exclusion.

### Option 2: Trust normalized `state.metrics` as authoritative

Read each state through `RunStore`, sum its aggregate metrics, and use leaf files
only for optional details.

Benefits:

- small implementation and fast reads;
- matches current `banzai status` totals for healthy v2 runs.

Costs and rejection reason:

- workflow normalization invents fresh/full defaults for legacy evidence;
- state metrics cannot provide duration by phase, finding severity, retry
  history, attempt outcomes, or data-quality provenance;
- missing or corrupt leaf evidence is invisible;
- cancelled/incomplete reconciliation boundaries are harder to audit. Rejected
  because state totals alone cannot satisfy traceability or missingness.

### Option 3: Sum every readable state, attempt, review, and event value

Treat all persisted records as additive evidence and reconcile discrepancies by
taking the maximum observed total.

Benefits:

- appears tolerant of missing files;
- tends to retain more non-zero values.

Costs and rejection reason:

- double-counts completed and reconciled attempts, review results, and usage;
- maximum values have no defensible meaning under corruption;
- silently converts disagreement into false certainty. Rejected because it
  violates evidence authority.

### Option 4: Fail the command when any run is not fully valid v2

Validate every source strictly and return no dataset on the first error.

Benefits:

- consumers receive only uniform complete records;
- implementation avoids partial-total semantics.

Costs and rejection reason:

- drops legacy, blocked, cancelled, interrupted, and corrupt runs;
- creates survivorship bias and makes the exporter least useful when the
  workflow fails;
- one damaged run prevents evaluation of every healthy run. Rejected because
  partial evidence is a first-class requirement.

## Decision

Adopt Option 1.

### Source ownership

Read raw persisted JSON without calling workflow normalization. Use this
precedence matrix:

| Evaluation evidence                             | Primary source                                      | Secondary use                                                      |
| ----------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------ |
| source schema/contract, creation/update, status | raw `state.json`                                    | directory presence creates an unresolved record if unreadable      |
| workflow route                                  | `state.workflowSelection.workflow`                  | missing legacy selection becomes strict with `inferred-legacy`     |
| model attempts, outcomes, timing, usage         | unique valid `attempts/*.json`                      | corresponding state metrics are consistency checks only            |
| fresh/resumed, full/delta, rotation reason      | unique valid `attempts/*.json`                      | absent legacy fields remain unknown                                |
| verification cumulative attempt count           | `state.metrics.attempts.verification`               | latest `state.verification` count is a consistency/coverage check  |
| verification result and known duration          | ordered entries in current `state.verification`     | events confirm completion only; never invent a start time          |
| applied review verdict and finding severities   | unique valid `reviews/review-*.json`                | state review metrics are consistency checks only                   |
| cumulative triage                               | v2 `state.triageHistory`                            | v1 `state.triage` is a partial legacy fallback                     |
| applied fix cycles                              | `state.fixCycle`                                    | fix attempt records expose attempted/failed/interrupted work       |
| explicit retries and failure boundaries         | safe closed fields from `events.jsonl` and attempts | state status/blocked phase provides a bounded final-state category |

Never read raw stdout/stderr, verification logs, source files, review Markdown,
or artifact paths for aggregation.

### Deduplication and reconciliation

Group attempt files by their persisted attempt ID before assigning opaque keys.
One valid physical identity contributes at most once. A reconciliation event
only confirms that the same completed attempt was applied; it never increments
attempt count, duration, usage, session, or review-mode totals. A resumed model
invocation is one attempt whose `sessionMode` is `resumed`, not the old attempt
plus a new one.

If duplicate identities are byte-equivalent after safe parsing, count one and
emit a duplicate-evidence issue. If they conflict, exclude that identity's
numeric contribution, retain an invalid contributor, and emit a conflict issue.
Do not take the first, last, sum, or maximum silently.

Count every unique started, completed, or failed attempt, including attempts in
blocked/cancelled/incomplete runs. Include a duration only when the persisted
`durationMs` is a valid non-negative number or both valid persisted start and
completion instants permit deterministic derivation. Never use export time for
an open attempt.

### Numeric coverage

Represent an aggregatable numeric metric with:

- `value`: exact total when coverage is complete, otherwise `null`;
- `observedSubtotal`: sum of valid observed contributors, including a true
  zero;
- `observedCount`: valid contributing evidence count;
- `unknownCount`: eligible contributors whose value is absent or null;
- `invalidCount`: eligible contributors whose evidence is malformed or
  contradictory;
- `availability`: `complete`, `partial`, `unavailable`, or `not_applicable`.

For additive metrics, `value` equals `observedSubtotal` only when both unknown
and invalid counts are zero and the metric is applicable. A value of zero is
therefore different from null. An empty cohort has exact zero counts, tokens,
durations, findings, triage, retries, failures, and fix cycles; reported cost is
`unavailable` with null value when no eligible model attempt exists. A reported
cost of `0` from at least one otherwise fully covered eligible attempt is exact
zero.

Each run contains the same metric structure. Cohort totals and workflow/status
breakdowns combine only those exported run structures. If any contributing run
is partial for a metric, the aggregate `value` is null while its
`observedSubtotal`, unknown count, and invalid count remain available.

### Phase, verification, and usage rules

Map attempt kinds to duration buckets as follows: `selection` to `selection`,
`plan` to `planning`, `implementation` to `implementation`, `review` to
`review`, and `fix` to `fixing`. Sum failed-attempt duration when known. Model
usage and reported cost come only from each unique attempt's usage record;
state-level usage is a consistency check and never an additional contribution.

Verification duration is the sum of valid retained verification start/completion
pairs. If cumulative verification count exceeds retained valid entries, duration
is partial and `value` is null. Do not reconstruct historical durations from
completion-only events, current time, model duration, or workflow state.

Preserve input, cached-input, and output tokens as separate metrics. A null
usage object makes each token/cost value unknown for that eligible model
attempt. A non-null usage object with null cost makes only reported cost unknown;
it does not affect token coverage.

### Review, triage, retry, and failure rules

Count findings by severity only from unique structurally readable applied review
result files. Keep review attempts, review modes, verdicts, and applied review
results as separate counts so a failed/unreliable review attempt does not become
valid finding yield. A malformed or missing applied result produces an invalid
or unknown contributor instead of being treated as zero findings.

Count cumulative triage from ordered v2 history. For v1, the latest `triage`
record contributes an observed subtotal but marks cumulative triage partial
because earlier cycles may have been replaced. Keep `accepted`, `rejected`, and
`deferred` separate. Export `falsePositiveRate` as unavailable and provide no v1
proxy. Export `humanMinutes` as unavailable. Rejected count remains named
`rejected` only.

Count retries only from explicit `attempt.retry_requested`,
`run.start_retry_requested`, and `review.checks_retry_requested` event types.
An extra attempt without a retry event remains visible in attempt counts but is
not retroactively labelled a retry.

Use a closed evidence-level failure taxonomy rather than causal guesses:

- `startup_check`;
- `model_attempt` with a closed attempt kind;
- `verification_command`;
- `review_check`;
- `review_verdict_blocked`;
- `interrupted_attempt`;
- `malformed_persisted_evidence`;
- `blocked_other`.

Use only event type, attempt kind/status, verification exit status, review
verdict, active-attempt completeness, state status/blocked phase, and parser
validity to assign these categories. Do not parse or export free-form error or
block text to infer authentication, provider, code, or human cause.

### Partial and corrupt runs

Classify each candidate as `complete`, `partial`, or `unreadable`. A readable
state with any missing, legacy-absent, unknown-schema, malformed, conflicting,
or incomplete eligible source is partial. An unreadable state produces an
opaque unresolved-run record and safe issues; it does not contribute a guessed
status, route, date, or numeric value.

Without date filters, include partial and unreadable candidates in cohort data
quality counts. With a date filter, a candidate whose creation instant cannot
be read cannot be proven inside the cohort; retain it as unresolved and exclude
it from numeric cohort aggregates. An explicit valid run selector does not make
unreadable values safe to guess.

Warn on stderr when issues or unresolved candidates exist, using only fixed
text and counts. Successful partial exports exit zero because incompleteness is
represented in the contract. Invalid CLI input, an inaccessible runs root, or a
missing explicitly selected run is a command error and produces no report.

## Consequences

Positive:

- healthy evidence remains usable beside legacy or damaged runs;
- all totals retain contributor coverage and avoid false precision;
- state/leaf overlap cannot inflate usage, duration, review, or retry counts;
- failed and interrupted work remains part of evaluation;
- current verification-history loss is visible and does not become invented
  time;
- rejected triage cannot be mistaken for ground-truth model error.

Negative:

- some headline totals are null even when an observed subtotal is useful;
- the JSON contract is more verbose than flat counters;
- raw state/attempt/review/event adapters require careful version-aware parsing;
- applied finding severity depends on retained structured review files;
- root-cause failure analysis remains unavailable without better persisted
  structured codes.

Risks and required follow-ups:

- consumer misuse of subtotal: label it explicitly and make Markdown show
  partial coverage beside it;
- v1 legacy overconfidence: tag legacy fallback and test multiple lost-history
  scenarios;
- drift between current metrics and leaf evidence: emit a consistency issue and
  never merge conflicting values silently;
- future need for true false-positive rate or human minutes: add explicit
  ground-truth/human-time evidence in a separately approved persistence change,
  then version the evaluation contract as required;
- historical verification analysis: consider append-only structured
  verification records in a separate feature; do not change persistence here.

## Compliance and Confirmation

Implementation and independent review must confirm:

1. empty, one strict done, lite, blocked, cancelled, non-terminal, v1 legacy,
   unknown-schema, malformed-state, malformed-attempt, malformed-event, and
   missing-review fixtures produce the declared completeness;
2. attempt counts include completed, failed, and started/incomplete records;
3. known failed-attempt durations contribute while open durations remain null;
4. fresh/resumed, full/delta, rotation reasons, retries, and failure categories
   come only from their declared evidence sources;
5. a reconciled completed attempt and its reconciliation event contribute once;
6. cumulative triage and fix cycles remain distinct from triage/fix attempts;
7. finding severity comes only from applied valid review results;
8. verification count can remain exact while historical duration is partial;
9. input, cached-input, output, and cost zero/null coverage behaves exactly as
   declared;
10. rejected triage is never named a false positive, and false-positive rate and
    human minutes remain unavailable;
11. aggregate totals and every workflow/status breakdown can be recalculated
    from exported run records;
12. one corrupt run cannot suppress healthy runs or make a partial total exact;
13. state metrics are not added to leaf metrics and disagreements emit safe
    issues;
14. default partial exports use safe stderr warnings and clean stdout;
15. all focused tests, CLI smoke tests, full verification, formatter, diff, and
    committed distribution parity checks pass.

## Lifecycle Links

- Supersedes: None
- Superseded by: None
