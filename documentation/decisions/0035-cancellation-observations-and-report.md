# ADR 0035: Cancellation Observations and Report

Publication note (2026-09-09): private operational identifiers were removed at
the project owner's request. The accepted decision and lifecycle are unchanged.

## Status / Date / Owner / Decision Makers

- Status: Accepted
- Date: 2026-09-06
- Owner: Banzai maintainers
- Decision makers: user, explicitly accepted in chat on 2026-09-06
  (English translation: `I accept ADR-0035`).
- Accepted companion: `ux-contract.md`, SHA-256
  `2faca732fe93b1f1e5972c4a7095514ec453e0b45b737c8293dbe0b19ae77995`.
  The requirements at acceptance have SHA-256
  `77c0556c663e2f42587c12dfd398e78fbba05eb9be2e793da9f7886e034f8284`.
  Acceptance records architectural intent and the linked UX/contracts, not
  approval of a subsequent implementation plan.
- Request provenance: the user approved the bounded product scope and enum,
  requested a concrete proposal before implementation, and explicitly excluded
  treating this prompt as acceptance of a new ADR.

## Related Artifacts

- [Requirements](../features/cancellation-observations/description.md).
- [Current gaps, exact UX and contract proposal](../features/cancellation-observations/ux-contract.md).
- Development plan: not created; planning must not rely on a Proposed ADR.
- Root [AGENTS.md](../../AGENTS.md), [CLAUDE.md](../../CLAUDE.md), and
  [PROJECT_MANIFEST.md](../../PROJECT_MANIFEST.md), sections 3, 5, 6, 8–10.
- Frozen baseline (historical record omitted from public source),
  [effectiveness method](../evaluation/effectiveness-study.md) and
  runbook (historical record omitted from public source).
- Accepted ADRs [0003](0003-versioned-evaluation-export-contract.md),
  [0004](0004-privacy-minimized-read-only-evaluation-boundary.md),
  [0005](0005-traceable-evaluation-aggregation.md),
  [0018](0018-agent-supervised-banzai-cli-control.md),
  [0023](0023-durable-terminal-attempt-checkpoints.md),
  [0026](0026-derived-evaluation-kpi-projection-contract.md),
  [0029](0029-eslint-backed-orchestrator-import-boundary-policy.md) and
  [0034](0034-durable-human-time-observations.md).
- Current human-time implementation and independent-review status:
  implementation report (historical record omitted from public source).

## Context and Decision Drivers

At inspected HEAD `54267e2998f4c1c8129b12fed0794fe7683d719a`, cancel records
terminal state followed by bare run.cancelled. The runner intentionally does
not wait for the workflow lock that another operation holds during a model
process. State replacement is atomic but unconditional. Completion/failure
paths contain cancellation rereads, leaving read/write races and late process
registration to address. transitionState clears blockedFrom on cancellation.

The event/store mechanism can retain a bounded observation and append a first
response. It cannot by itself prove that an append corresponds to the winning
terminal transition, distinguish missing new instrumentation from legacy events,
or prevent a stale state writer from replacing cancellation. A small canonical
transition anchor and store-level serialization are necessary for those claims.

The user requires optional collection after stopping, a non-TTY CLI and a useful
report. This changes persisted/public contracts and the disclosure of operator
metadata. ADR-0034 already separates timing observations from workflow authority
but expressly defers public human-time disclosure to a new decision. The new
report needs only a minimized existing estimate, not timing identities/history
or a new timer. Frozen evaluation/KPI v1 remain unchanged.

A run cancellation fraction is not a failed-task rate or proof
that routing is wrong. Existing typed failures and ADR rejections describe
preceding facts; they cannot establish why an operator stopped a run. The
collection interaction itself changes instrumentation and may change coverage.

**Decision question:** Which durable boundary should own one optional
operator-reported cancellation reason and its context, including the first
answer after a terminal transition, and the read-only disclosure of those
observations without competing with workflow authority?

**Decision owner:** Banzai maintainers, with explicit user lifecycle approval.

Drivers: exact run identity; terminal concurrency; nonblocking stopping;
idempotent first response; truthful partial-write outcomes; bounded privacy;
existing accounting reuse; explicit cohort/coverage; compatibility; and a narrow
implementation without a new workflow engine or historical editing surface.

## Options Considered

### 1. Enrich existing cancellation events with a canonical transition anchor

Use the existing state/event store. Add an immutable, versioned terminal anchor
to the winning cancelled state write; capture closed context in run.cancelled;
allow one receipt-bound response event for an interactive pending answer.
Serialize short state writes and guard terminal immutability. Keep reporting
independent, direct-read and separately versioned.

- Benefits: uses existing run identity, event retention and human-time closure;
  no parallel observation ledger; no historical reason mutation; missing new
  observation distinguishable from legacy evidence; one report semantics.
- Costs: state/event writes remain separate and can leave explicit gaps;
  state writers and process callbacks need terminal-boundary assurance; first
  responses need an internal process-local capability and conflict checks.
- Selection reason: the append-only first-response use case fits events.
  A small anchor supplies needed correlation without making analytics workflow
  authority. Existing store synchronization needs attention for any viable option.

### 2. Add a separate cancellation sidecar like human-time.json

Store context and a first-answer slot in an independently versioned run-local
file, with private mode, atomic replacement and a short guard.

- Benefits: natural bounded codec; corrupt observation writes are physically
  isolated from the shared events file; human-time offers implementation precedent.
- Costs: duplicates run/cancellation correlation and adds another file/writer/
  reader. It still needs terminal state fencing and a canonical cancellation
  anchor to distinguish crash, done, missing and legacy outcomes. It does not
  remove the essential concurrency work or create a true multi-file transaction.
- Rejection reason: unlike editable cumulative time estimates, this feature
  needs only one cancellation and one first response. Existing events can own
  that history; the extra ledger is not justified in this bounded phase.

### 3. Keep the complete observation in terminal run state

Store context and supplied reason together with cancellation and permit one
special terminal-state update after the optional prompt.

- Benefits: terminal identity and initial context can be atomically co-written;
  one read path; no event lookup for the current answer.
- Costs: optional analytics and later answer mutation expand operational state
  authority, terminal write exceptions and updatedAt semantics; a mutable slot
  makes original-answer history less explicit and complicates failure isolation.
- Rejection reason: the event approach keeps response history append-only while
  limiting operational metadata to the correlation needed for reliable writes.

### 4. Infer reason from technical failures/ADR events or extend frozen reports

- Benefit: little operator interaction or new contract work.
- Costs: fails provenance, invents motivation, conflates runs with tasks and/or
  silently changes frozen evaluation/KPI semantics.
- Rejected as incompatible with the already agreed requirements, not a product
  question requiring renewed consultation.

## Decision

Adopt Option 1, subject to explicit acceptance of this Proposed ADR.

### Workflow and persistence authority

Keep state-machine/runner as the sole lifecycle authority. The successful
guarded terminal state replacement decides whether cancellation or done won.
An observation cannot prove a transition by itself, alter retry/recovery or
approve a human decision. Preserve the existing process stop behavior and its
truthful distinction from confirmed process exit.

Use the existing RunStore for the optional immutable cancellation anchor,
run.cancelled observation, and at most one run.cancellation_response. Define
`banzai-cancellation-observation/v1` with schemaVersion 1 independently from
RunState schema 3. The anchor's schemaVersion/id/at identifies the terminal
transition and expectation of observation capture. Do not add a sidecar,
configuration switch, schema migration or synthetic legacy field.

Give all state replacements a shared short run-local serialization and terminal
immutability boundary. Preserve the existing long workflow lock for normal
operations. Never wait for that long lock or optional evidence scans before a
stop request. No new guard spans a prompt/model/verification or human-time
operation. A late process registration must stop that process rather than
revive cancellation; late attempt evidence may remain as evidence without
authorizing application or continuation.

Capture pre-transition status, blockedFrom, actual route and pending gate from
the state whose transition wins. Retain exact available local attempt/decision
references; missing source values remain explicit. Do not infer actual workflow
selection from a legacy strict fallback. Technical evidence uses existing
structured failure codes/causes and verification values, separate from reported
reason. No free-text field, raw record copy or causal classifier is allowed.
Only evidence known to precede the transition is preceding technical context;
a failure induced by the cancellation signal must not be presented as its
motivation. A reference with only a later terminal result retains unknown
pre-cancellation outcome.

### First-response and failure semantics

Interactive cancellation retains its explicit false-default confirmation.
Request stopping and commit the terminal transition before the one optional
reason prompt. Skip is initially focused and records unspecified/operator_skipped.
CLI can supply the agreed enum, or omit it and record unspecified/cli_omitted.
The input channel describes transport, not verified human identity or presence.

Only the winning interactive invocation whose pending observation is durably
readable receives an opaque process-local first-response receipt. Bind it to
the exact original run and cancellation anchor. It permits only the first
reported/skipped/interrupted response; it is not a public late-answer API or
workflow authorization. Identical repeat is idempotent; a conflicting answer
cannot append or overwrite. Restart and repeated cancel cannot obtain a new
receipt. A changed active run never changes the receipt's target.

An exit before confirmation does nothing. An exit after terminal cancellation
preserves it and makes no new prompt. Hard interruption may leave pending;
that is unanswered evidence, not an operator skip. Existing Ctrl-C during model
execution keeps its interruption/resume semantics and is not cancellation.

Make analytics failures non-fatal to stopping/cancellation. Preserve confirmed
state when event/context/response capture fails, return that exact run's result
and show the fixed unsaved warning. State-write or ownership failure that leaves
the terminal transition unconfirmed must be reported as unconfirmed even if a
stop signal was sent. Never retry cancellation to improve coverage. Reads and
repeated cancel do not backfill an event lost after a terminal write.

Preserve malformed partial lines and ambiguous write outcomes. Bounded reread
can establish an already-written identical answer, but no silent truncation,
last-write-wins response or guard reclamation may create false history. Detailed
guard lifetime and cooperative-writer behavior belong in the implementation
plan and must preserve these guarantees. Do not claim hostile-writer isolation
or power-loss durability from atomic file operations.

### Public interface and report boundary

Provide `banzai cancel [--run <run-id>] [--reason <enum>]`, exact validation
before mutation, and no new non-TTY prompts. --run binds the current expected
run rather than permitting historical cancellation. Print the operation result
for that identity, not a new active-pointer lookup.

Keep existing control v2 discovery/status contracts unchanged. Negotiate the
optional surface through `control capabilities --cancellation`, returning the
separate closed `banzai-cancellation-capabilities/v1`. Document real commands,
reason values and identities; do not advertise a nonexistent control cancel
stdin endpoint. The agent must already have cancellation authority and may
transport only a user-supplied reason. Logs and previous decisions do not provide
that authority or reason. The linked proposal pins the capability shape.

Provide `banzai eval cancellations`, Markdown default and --json with the
existing cohort selector grammar. Establish `banzai-cancellation-report/v1`,
schemaVersion 1, with cohort/runs/summary/issues and deterministic ordering.
JSON is authoritative; Markdown only projects the same completed document.
Field/semantic/privacy changes require deliberate version evolution; do not
silently add fields to frozen evaluation export/KPI v1 or this report v1.

Use direct bounded reads and pure source/metric helpers, without operational
RunStore, runner/adapters, model/verification/authentication or network calls.
Reading never writes, locks, normalizes or repairs. Retain unreadable, malformed,
unresolved and legacy candidates and their coverage. Preserve exact known
cancelled status when an observation is unavailable; do not count an orphan
observation as a cancellation of a done or unreadable run.

Every reason frequency and meaningful reported-reason coverage uses all
confirmed cancelled runs in the included cohort as denominator. Other is a
meaningful reported reason; unspecified is separate; missing/malformed/
unsupported/conflicting/unanswered/interrupted evidence is not unspecified.
Response availability is a different ratio. All ratios expose numerator,
denominator, and null for zero denominator. Unknown membership/status stays
visible and cannot silently improve the denominator.

Group by actual workflow and pre-transition status/blockedFrom/gate, with
unknown/unselected groups. Show bounded technical reference tables using
report-local opaque keys; exact run/attempt/decision identifiers stay private.
Keep diagnostics fixed and structurally minimize values before rendering.
Existing privacy exclusions apply: no requests, slugs, paths, prompts, logs,
commands, environment, credentials, human identity or error/decision prose.

Reuse existing canonical attempts, verification ledger, numeric coverage and
human-time codec. Show pre-cancellation attempts and known resource subtotals
with source/timestamp coverage, including failed work. Straddling/open attempts
have unknown pre-cancellation usage; do not prorate or label later whole-attempt
usage as pre-cancel. State counters corroborate completeness, not additive spend.
Vendor reported cost is a covered subtotal, not full cost or subscription price.

Permit only this new human-time disclosure: the existing unique current valid
single-engineer estimate's minutes, estimated basis, unverified single-engineer
scope, asOf and availability, per cancelled run. It is applicable to pre-cancel
work only if asOf is on/before cancellation. Never revive an older replaced
estimate, disclose contributor/capture/revision identities or gate episode
timestamps, convert elapsed into active time, or sum run estimates into
person-time/task totals. Existing timing UX and human-time ledger schema remain
unchanged. Frozen evaluation humanMinutes remains unavailable.

Superseded is reported continuation intent. No new task-link source is introduced;
MVP continuation confirmation is explicitly unavailable. Do not infer links from
names, timestamps or approved-bundle similarity automatically, or import the
private retrospective task worksheet. Any later confirmed continuation meaning
requires a reliable approved source and deliberate report-contract evolution.

### Study and compatibility

Record collection version and actual start only after implementation and actual
observations. Label the extra interaction as instrumentation; coverage changes
cannot establish better agent performance. Keep the frozen baseline, enrollment,
time-basis decisions, verification gates, native comparison and acceptance/quality
protocol unchanged. This proposal authorizes no prospective study run.

The linked UX/contract document is the reviewable companion to this proposal.
On acceptance its contract semantics must be carried into the mapped plan;
material changes require lifecycle review rather than silent implementation
reinterpretation. Local mechanics, exact guards and test seams remain planning
work after acceptance, not unspecified product choices.

## Consequences

Positive:

- Operators can give a short optional reason without delaying the stop action.
- Canonical outcome, operator statement and technical evidence remain distinct.
- One response, explicit gaps and opaque reporting support explainable research.
- No parallel ledger, new timer, remote service, dependency or workflow engine.
- Existing reports, timing UX and approval/recovery semantics retain their roles.

Negative and risks:

- State/event persistence has a crash gap; missing evidence remains possible.
- Short state-write serialization touches shared lifecycle infrastructure and
  requires deliberate race tests; old binaries cannot be assumed to cooperate.
- A hard interruption can lose a reason permanently because there is no editor.
- Optional collection can have low or biased coverage and recall/selection bias.
- Precise dates, reason combinations and estimates retain indirect linkability.
- Resource boundaries can yield partial subtotals; task continuation and true
  causal effects remain unknown. Run estimates do not identify contributors.

Follow-ups within this feature: after acceptance prepare the concrete plan,
approve that bundle, implement/test, update documented facts and committed build,
run the repository release-confidence gate once, then independent review and
human triage. Routing changes, stronger verification, task linking and comparative
pilot readiness remain separate work, not automatic consequences of this data.

## Compliance and Confirmation

Implementation/review must demonstrate the AC1–AC16 matrix, especially:

1. All enum/invalid CLI cases, non-TTY omission, exact-run preconditions,
   confirmation decline, selection, skip and interruption order.
2. Exact pre-transition context and no reason inference from ADR rejection or
   structured vendor failure.
3. Repeated/concurrent cancel, done-versus-cancel, stale completion/failure and
   late process-start interleavings at the actual storage boundary.
4. One first response, exact old-run binding after active-run change, no restart
   edit/backfill, and immutable first response on conflicts/retries.
5. Injected context/event/response failures and crash/partial-write cases retain
   truthful workflow state and explicit analytic gaps without read-side repair.
6. One human-time cancellation closure; no new time gate; existing export/KPI,
   context and ordinary control output compatibility on synthetic fixtures.
7. Cohort conservation, all-cancelled denominators, zero-denominator behavior,
   legacy/missing/malformed/conflict distinction, source-covered work and
   unavailable continuation despite similar names/times.
8. JSON/Markdown determinism/parity, safe references, canary privacy, bounded
   ingress/path handling, and before/after read-only filesystem evidence.
9. Updated manifest/docs/study instrumentation note and implementation report;
   focused tests, committed build parity, release:check and git diff --check.

No implementation test, live run, collection start, effectiveness result,
release, install, version bump, commit or push is claimed by this proposal.

## Lifecycle Links

- Supersedes: None.
- Superseded by: None.
- Complements ADR-0034 with a new report's narrow estimate disclosure; does not
  change that ledger or its existing interactive/reporting semantics.
- Accepted on 2026-09-06 by the user's explicit lifecycle decision. No further
  ADR acceptance is pending.
- The body and accepted companion retain their proposal-stage wording and
  preparation evidence. This lifecycle record supersedes their pending-approval
  statements; it does not rewrite their context, options or contract semantics.
- Implementation state: Planned. The subsequent
  [development plan](../development-plans/cancellation-observations/plan.md)
  requires its own exact-bundle approval before code work.
