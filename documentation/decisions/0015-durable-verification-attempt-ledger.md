# ADR 0015: Durable Verification Attempt Ledger

## Status / Date / Owner / Decision Makers

- Status: Accepted
- Date: 2026-08-13
- Owner: Banzai maintainers
- Decision makers: User, explicitly accepted in chat on 2026-08-13

## Related Artifacts

- Feature description:
  `documentation/features/orchestrator-evidence-readiness-alignment/description.md`
- Feature plan: Not created; planning cannot rely on this Proposed ADR.
- Manifest: sections 3, 5, 6, 8, and 10 of `PROJECT_MANIFEST.md`
- Related ADRs:
  - ADR-0003 defines the versioned deterministic evaluation export contract.
  - ADR-0004 defines the fixed privacy-minimized read-only evaluation boundary.
  - ADR-0005 assigns evidence ownership and explicitly defers append-only
    structured verification history to a separate feature.
  - ADR-0006 defines ordered verification profiles without changing run-state
    or evaluation contracts.

## Context and Decision Drivers

`RunState.metrics.attempts.verification` is cumulative, but
`RunState.verification` is cleared before every verification round. The real
`books-crud-api` run therefore records four verification attempts, retains only
the final two command results, and exports two historical outcomes as unknown.
The real `users-crud-api` run records eight attempts and retains two results.
Both correctly remain partial with `VERIFICATION_HISTORY_INCOMPLETE`.

The current event journal is not a complete verification ledger. It appends a
`verification.completed` summary only after the operational state was written.
The event has no stable attempt identity, start record, verification round,
source phase, profile identity, command ordinal, duration, restart relationship,
or log digest. A crash between state and event writes can leave either surface
insufficient for lossless reconciliation. Enriching completion events alone
would not make the journal an authoritative attempt lifecycle.

The operational state still needs a bounded latest-round view for review prompts
and status. Evaluation must remain direct, read-only, deterministic, and
privacy-minimized. Existing runs cannot acquire evidence that was never
persisted, while new runs must preserve every real attempt without growing the
mutable state indefinitely or copying command output into evaluation evidence.

Decision question: What durable source owns every new verification attempt, and
how do lifecycle identity, restart/reconciliation, state consistency, privacy,
legacy fallback, and evaluation compatibility work?

Decision owner: Banzai maintainers, with explicit user lifecycle approval.

Decision drivers:

- exact verification outcome history beyond the retained operational window;
- stable identity and ordering across restart, resume, and reconciliation;
- crash-tolerant persistence without unbounded mutable state;
- explicit malformed, duplicate, conflicting, missing, and legacy evidence;
- deterministic counts and durations without invention or double counting;
- no raw stdout/stderr, secrets, command arguments, or source in evaluation;
- compatibility with evaluation v1, committed distribution, and existing runs;
- no weakening of retry, review, triage, or authorization boundaries.

## Options Considered

### Option 1: Versioned per-attempt leaf ledger with atomic lifecycle updates

Persist one versioned structured leaf for each verification attempt. Allocate a
stable identity and sequence before process execution, atomically move that same
record from started to a terminal lifecycle when evidence becomes available,
and never prune a completed identity. Keep operational latest-round results and
cumulative counters in state as compatibility views and consistency checks.

Benefits:

- mirrors the proven model-attempt evidence pattern without mixing model and
  verification schemas;
- one malformed record degrades one contributor instead of an entire journal;
- atomic replacement avoids partially appended JSON lines;
- completed reconciliation is idempotent, while a real restarted execution can
  receive a distinct linked identity;
- evaluation can sort by persisted sequence and detect missing or conflicting
  leaves directly;
- mutable state stays bounded to its existing operational view.

Costs and risks:

- adds a persisted schema and recovery rules;
- allocation, state counters, leaf writes, and process start cannot be one
  filesystem transaction, so reconciliation must be explicitly idempotent;
- log digests and references require disciplined redaction and allow-listing;
- evaluation must support both ledger-backed and legacy state-backed runs.

### Option 2: Make enriched `events.jsonl` the canonical ledger

Append verification-started, verification-completed, failure, interruption, and
reconciliation events with stable identities and all bounded metadata.

Benefits:

- reuses the existing append-only surface;
- lifecycle and retry events remain in one chronological stream;
- no directory of small records is required.

Costs and rejection reason:

- an interrupted append can damage the journal tail or line;
- duplicate start/completion events need event-sourced folding and conflict
  rules before one attempt can be trusted;
- current event ordering relative to state writes is not transactional;
- one malformed or unreadable journal affects unrelated retry and lifecycle
  evidence;
- updating an already-started record is not possible without compensating
  events. Rejected because the event journal is valuable corroboration but a
  weaker canonical attempt store.

### Option 3: Retain every verification result indefinitely in `state.json`

Stop clearing `state.verification` and append every result to the atomically
replaced run state.

Benefits:

- minimal read-side change;
- status and evaluation see the same array;
- no new persisted directory or schema.

Costs and rejection reason:

- mutable operational state grows with every fix/review cycle;
- started, interrupted, restarted, and reconciled identity remains ambiguous;
- one malformed state blocks all run evidence;
- every update rewrites all historical attempts;
- it preserves the overlap that ADR-0005 intentionally treats conservatively.
  Rejected because it couples recovery state to an unbounded evaluation ledger.

### Option 4: Append a separate evaluation-only JSONL artifact

Write a privacy-projected verification event directly in the shape evaluation
needs and leave operational records unchanged.

Benefits:

- exporter reads a narrow allow-listed source;
- operational state and event journal stay unchanged;
- record volume remains small.

Costs and rejection reason:

- creates a second write-side projection that can drift from operational truth;
- lifecycle correction and reconciliation require compensating records;
- malformed tails and duplicate appends retain the JSONL risks;
- persistence code would need to understand downstream evaluation semantics.
  Rejected because canonical operational evidence should be projected by the
  read-only exporter, not pre-rendered for it.

## Decision

Adopt Option 1.

Create a verification-attempt persistence contract with its own exact schema
version. A new run creates an explicit ledger boundary even when it has zero
verification attempts, allowing the exporter to distinguish complete new
evidence from a legacy run with no ledger.

Each physical attempt owns one stable identity and one positive monotonically
increasing run-local sequence allocated before command execution. The record
contains only bounded structured metadata:

- schema version, identity, and sequence;
- source phase and verification-round identity;
- profile identifier, project type, profile ordinal, command ordinal, and a
  deterministic command-configuration digest;
- lifecycle status `started`, `completed`, `failed`, or `interrupted`;
- start/completion timestamps and duration when observed or derivable;
- exit code and signal when the process supplied them;
- `retryOf` or `restartOf` identity when applicable;
- relative references and SHA-256 digests of runner-owned redacted stdout and
  stderr logs when those logs exist.

Do not copy the command executable, arguments, environment, raw stdout/stderr,
prompt, model result, source, credential, or arbitrary error text into the
canonical record. A stable bounded failure classification may be stored; free
prose remains outside evaluation evidence.

Write the started leaf before the process is treated as active. Atomically
replace only that identity when terminal evidence arrives. Never reuse a
sequence or overwrite one completed attempt with another execution. Reapplying
a completed leaf after process or state reconciliation is idempotent. When a
previous started execution is proven interrupted, close it as interrupted; a
real new execution receives a new sequence and a `restartOf` or `retryOf` link.

Keep `state.metrics.attempts.verification` as the cumulative operational count
and `state.verification` as the latest retained round. For ledger-backed runs,
the unique supported ledger record count owns evaluation attempt history; the
state counter and retained array are consistency checks. Recovery must reconcile
counter/leaf write boundaries without duplicating a physical identity. The
append-only event journal remains a lifecycle and explicit-human-retry source,
not the verification outcome owner.

Evaluation reads the ledger directly without `RunStore`. Validate every
candidate record before aggregation, group by stable identity and sequence, and
sort by positive sequence with a deterministic filename tie-break for invalid
evidence. Byte-equivalent duplicates contribute once with a bounded duplicate
issue. Conflicting identities or sequences contribute no guessed numeric value
and emit a bounded conflict issue. Malformed or unsupported ledger evidence
emits a verification-specific issue such as
`VERIFICATION_ATTEMPT_MALFORMED`, never the model-attempt issue and never silent
fallback to mutable state.

For a ledger-backed run, absence of an expected sequence or disagreement with
the cumulative count is partial evidence and may use
`VERIFICATION_HISTORY_INCOMPLETE`. When every unique record is present and
valid, a retained-window difference alone is not an issue. For a legacy run
without the ledger boundary, preserve ADR-0005 behavior: the cumulative state
count remains exact, current retained results remain observed, lost historical
outcomes remain unknown, and `VERIFICATION_HISTORY_INCOMPLETE` remains visible.

Retain `banzai-evaluation-export/v1` as the default JSON identity and preserve
its top-level fields, field JSON types, aggregate meanings, ordering, and
privacy allow-list. Project ledger lifecycle into the existing verification and
numeric evidence surfaces; a bounded expansion of verification lifecycle values
and issue codes is authorized only where needed to represent observed started,
failed, interrupted, or malformed evidence without changing existing values.
Do not export profile IDs, command names/digests, log references/digests, paths,
executables, arguments, or raw content. A later disclosure or incompatible
field/type/metric change requires a new evaluation version under ADR-0003.

Exact Codex `*-result.json` files remain raw model output and never become
canonical model or verification attempt evidence. Existing malformed canonical
model-attempt behavior and issue codes remain unchanged.

## Consequences

Positive:

- new runs retain every verification attempt and outcome beyond the state
  window;
- restart and reconciliation have explicit idempotent identity semantics;
- evaluation counts, outcomes, and durations are reproducible from leaf
  evidence;
- one malformed verification record is isolated and diagnosed explicitly;
- old partial runs remain truthful instead of receiving fabricated history;
- state remains bounded and review prompts retain their current latest-round
  view.

Negative:

- the run directory gains another versioned persisted contract;
- recovery and evaluation require dual handling for ledger-backed and legacy
  runs;
- strict consumers of closed v1 lifecycle/issue enums must tolerate the bounded
  compatible expansion authorized here;
- log digests provide integrity linkage, not proof that redaction removed every
  possible secret.

Risks and required follow-ups:

- allocation crash gap: write/reconcile the leaf and counter idempotently and
  test every restart boundary that can create a duplicate or missing sequence;
- PID ambiguity after parent death: never infer interruption solely from a
  stale PID without the runner's existing liveness/recovery rules;
- configuration drift between rounds: persist profile/command ordinals and a
  digest per attempt rather than reinterpret records through current config;
- privacy drift: build evaluation records from an allow-list and use forbidden
  stdout/stderr/result/command/credential canaries;
- false legacy completeness: use an explicit ledger boundary rather than
  assuming an absent directory means zero attempts.

## Compliance and Confirmation

Implementation and independent review must confirm:

1. a new zero-attempt run has an explicit supported ledger boundary;
2. multiple verification rounds beyond the retained window export every unique
   attempt in stable sequence order without `VERIFICATION_HISTORY_INCOMPLETE`;
3. cumulative, unique-ledger, retained, exported total, outcome, and duration
   counts agree according to their declared meanings;
4. reconciliation of one completed record contributes once and starts no
   process;
5. an interrupted and restarted execution uses distinct linked identities and
   never reuses sequence;
6. reversed directory insertion and repeated export produce identical bytes;
7. missing, malformed, unsupported, duplicate, and conflicting ledger evidence
   emits verification-specific bounded issues and partial/invalid coverage;
8. a legacy run with lost history remains partial and does not acquire a
   fabricated record or outcome;
9. raw result files, logs, stdout/stderr, commands, paths, digests, arbitrary
   prose, credentials, and environment canaries do not cross the export
   allow-list;
10. state keeps only the operational latest-round window and its cumulative
    counter remains a consistency check for ledger-backed evaluation;
11. existing canonical model-attempt, Git-baseline, reviewer-rotation, triage,
    and authorization regressions remain passing;
12. source, committed `dist`, docs, manifest, CLI smoke, full verification, and
    eligible release-confidence evidence remain in parity.

## Lifecycle Links

- Supersedes: None. This implements ADR-0005's explicitly deferred structured
  verification-history follow-up and narrows its state fallback only for runs
  that carry the new complete leaf ledger.
- Superseded by: None
