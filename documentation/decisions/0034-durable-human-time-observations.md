# ADR 0034: Durable Human-Time Observations

## Status / Date / Owner / Decision Makers

- Status: Accepted
- Date: 2026-09-06
- Owner: Banzai maintainers
- Decision makers: User, explicitly accepted in chat on 2026-09-06:
  `Approve adr`.
- Acceptance order: this later explicit approval supersedes the earlier
  proposed deferral. `HT-UX-01` and `HT-ID-01` remain unanswered; the approval
  records architectural intent without inferring product answers, description
  approval or implementation authorization.
- Pinned description reference at acceptance:
  [description-0034-reference.md](../features/interactive-human-time/description-0034-reference.md),
  SHA-256 `db44af7811b5bbe83e0db19854b5d256e7b64f1a378f543292b6fba07144731a`.
  This is a byte-identical snapshot of the referenced draft, not an approved
  feature description. Numbered FR references in the accepted body refer to
  this revision; the live description may continue through product consultation.
- Request provenance: explicit request to prepare an ADR after the interactive
  human-time UX proposal. This is authorization to propose architecture, not
  approval of the feature, its open UX choice or implementation.

## Related Artifacts

- [Draft feature requirements](../features/interactive-human-time/description.md),
  principally `FR1`–`FR4` and `FR7`–`FR13`.
- [UX proposal](../features/interactive-human-time/ux.md). Consultation
  `HT-UX-01` about correction-prompt cadence and `HT-ID-01` about contributor
  attribution remain open. The sidecar proposal does not select either product
  answer or approve a run-only final product scope. Its attribution fields
  remain provisional until the requirements settle that choice.
- [Independent review 2](../features/interactive-human-time/review-2.md) and
  [author response](../features/interactive-human-time/review-2-response.md).
- Feature plan: not created. Feature planning still requires resolved product
  requirements and an accepted architectural decision.
- Repository authority: root [AGENTS.md](../../AGENTS.md),
  [CLAUDE.md](../../CLAUDE.md) and
  [PROJECT_MANIFEST.md](../../PROJECT_MANIFEST.md), sections 2, 3, 5, 6 and 9.
- [Effectiveness method](../evaluation/effectiveness-study.md) and
  2026-09-05 retrospective baseline (historical record omitted from public source):
  task-level research, coverage and historical evidence; no timing backfill.
- Related accepted ADRs:
  - [0003](0003-versioned-evaluation-export-contract.md),
    [0004](0004-privacy-minimized-read-only-evaluation-boundary.md) and
    [0005](0005-traceable-evaluation-aggregation.md) freeze evaluation semantics,
    privacy and unavailable human minutes. No amendment is proposed.
  - [0018](0018-agent-supervised-banzai-cli-control.md) and
    [0031](0031-interactive-decision-consultation.md) preserve runner authority,
    exact decision identities and non-authorizing consultation.
  - [0023](0023-durable-terminal-attempt-checkpoints.md) and
    [0024](0024-operator-authorized-prerequisite-blocked-fix-recovery.md) retain
    their completion, interruption and recovery authority.
  - [0026](0026-derived-evaluation-kpi-projection-contract.md) keeps KPI v1 a
    pure projection of evaluation v1, without a new evidence input.
  - [0028](0028-phase-context-accounting-and-budget-policy.md) establishes a
    precedent for separately versioned, bounded accounting evidence; its
    context and usage meanings remain unchanged.

## Context and Decision Drivers

The user rejected routine spreadsheet entry for human-time collection and
requested interaction in the CLI, automatic timestamps around human decisions,
summary visibility and an opportunity to clarify active effort. The main study
question remains active human minutes per accepted engineering task, including
unsuccessful work and quality outcomes.

Current source, inspected on 2026-09-06 at HEAD
`d2e760b2cf1afb619ad7704665a6b0a5f91c075d`, has no human-time observation store.
The related research and UX documents are working-tree drafts, not implemented
behavior. Load-bearing evidence is:

- [interactive.ts](../../packages/orchestrator/src/interactive.ts) owns the
  summary, approval, consultation and triage UI. Calls including
  `approvePlan(..., true)` and `triage(..., true)` may continue automatically
  through later model/verification work before returning.
- [workflow.ts](../../packages/orchestrator/src/workflow.ts) owns validated
  decisions and records `approval.plan`, `approval.adr`, `decision.human`,
  `decision.consultation.answered` and `review.triaged`. Pending consultation
  and escalation requests have `requestedAt`. `attempt.applied` includes the
  originating attempt, resulting `status` and `gate`, providing an opening
  anchor for plan/ADR approval where complete. `review.completed` supplies
  review-iteration evidence. These are not a uniform historical timing ledger.
- [store.ts](../../packages/orchestrator/src/store.ts) updates `updatedAt` on
  state writes and timestamps events separately. For example, triage records
  its valid decision before checking completion and persisting the following
  workflow state. A downstream failure does not necessarily mean the decision
  was never recorded; a crash can leave partial evidence.
- [terminal-attention.ts](../../packages/orchestrator/src/terminal-attention.ts)
  times automatic operations for terminal notification. It is presentation-only,
  excludes human prompts and is not a human-activity timer.
- [evaluation.ts](../../packages/orchestrator/src/evaluation.ts) explicitly
  leaves `humanMinutes` unavailable. Read-only evaluation and context reports
  already use narrow evidence boundaries rather than serializing run state.

Target: durable, local observations usable by the interactive summary, with
truthful availability and correction history, without adding workflow authority
or silently changing existing reporting contracts.

**Decision question:** Which durable evidence boundary should own automatic
decision timing and explicit operator effort estimates while preserving
workflow authority, privacy, resumability and measurement semantics?

**Decision owner:** Banzai maintainers, with explicit user lifecycle approval.

Drivers:

- distinguish decision-response elapsed time from active person-time;
- make ordinary work observable without a separate worksheet interaction;
- retain cancelled, failed, interrupted and corrected observations;
- avoid double counting across repeated renders, retries and concurrent CLIs;
- tolerate observation failures without altering authorization or recovery;
- keep existing public contracts, schemas and model inputs stable;
- minimize human-related metadata, network exposure and operational overhead;
- support later task-level research without pretending a run is a task.

## Options Considered

### Option 1: Derive timing from existing evidence; keep effort in UI memory

Read current events and state to display only supported gate durations; keep
entered effort estimates in the current interactive session.

- Benefits: no new persisted contract, small implementation, useful bounded
  latency information where endpoints and identities are available.
- Costs: estimates disappear on exit; corrections have no durable history;
  existing gate evidence has incomplete coverage and does not prove activity.
- Rejection reason: it cannot provide the required resumable observation UX.
  General event gaps or model durations would not repair that limitation.

### Option 2: Extend run state, events and versioned evaluation together

Make timing a workflow-state metric and introduce an evaluation version that
exports it, with corresponding KPI evolution when required.

- Benefits: one familiar operational access path; an immediate public dataset
  could support downstream analysis.
- Costs: couples optional observation to recovery state, migrations and public
  reporting; expands disclosure before task, contributor and study semantics
  are settled; needs coordinated compatibility work across several surfaces.
- Rejection reason: broader than the current observation component. Doing this
  without new versions would also violate accepted evaluation/KPI decisions.

### Option 3: Independent versioned local observation ledger

Keep gate observations and effort revisions in a run-owned sidecar. The runner
provides semantic lifecycle boundaries; the interactive composition owns
recording and renders a pure projection of bounded evidence.

- Benefits: durable observations and correction history; unchanged workflow
  state and export contracts; explicit failure/coverage semantics; independent
  tests and no service, dependency or activity monitor.
- Costs: a new local contract and write boundary; concurrency and partial writes
  need deliberate handling; run-local records are not yet a task-level dataset.
- Selection reason: meets persistence and measurement needs with the smallest
  change to existing authorities. It works with either proposed prompt cadence.

### Option 4: External private study journal written by the CLI

Store observations in a separate user-selected directory, potentially shared
by native and Banzai work across repositories.

- Benefits: task/contributor observations could share one research home; private
  data stays outside repository storage and survives deletion of individual runs.
- Costs: collection now needs directory selection, retention ownership, durable
  cross-repository identities and concurrent external writes; Banzai-only users
  acquire study setup before they can see a useful run summary.
- Rejection reason: suitable for a later explicitly scoped study collector,
  but unnecessary for the run observation component. Selecting this now would
  pre-decide unresolved task and native-condition collection design.

## Decision

Adopt Option 3. Establish a separate local observation boundary and keep it
subordinate to canonical workflow evidence. The following is proposed target
intent; no runtime or persisted contract is changed by this document.

### Evidence and persistence ownership

Define the independent local contract `banzai-human-time/v1`, with
`schemaVersion: 1`, at `.banzai/runs/<run-id>/human-time.json`. It is a private
run-owned ledger, not an evaluation export, run-state metric, event-log
extension or authorization record.

Keep the ledger optional. Its absence means human-time evidence is unavailable.
Do not migrate historical runs, change `RunState`, model-result or configuration
schemas, or inject this ledger into model prompts and context inputs.

The contract owns only these bounded data classes:

| Data class                    | Allowed content and authority                                                                                                                                                                                        |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and capture coverage | Contract identity/version, exact local run binding, ledger revision, capture start and known observation gaps. Run IDs stay private.                                                                                 |
| Decision episode              | Stable episode identity, closed gate kind, exact bounded workflow anchor, opening/closing timestamps, outcome and endpoint provenance.                                                                               |
| Clock evidence                | UTC timestamps, explicitly sourced duration where supported, clock basis and continuity/availability classification.                                                                                                 |
| Effort revision               | Attribution reference governed by pending `HT-ID-01`, observation identity, recorded/as-of time, explicit finite non-negative cumulative minutes, constant basis `estimated`, and the previous revision it replaces. |
| Issues                        | Closed codes for missing, invalid, conflicting, interrupted, unsupported or unsaved evidence; no raw error messages or arbitrary notes.                                                                              |

Specify a closed decoder and finite size/count bounds in the implementation
plan. Reject unknown fields, unsupported versions and malformed identities at
this boundary. A bound exceeded is incomplete evidence, never silent truncation
or an exact total. Adding measured active sessions or another evidence meaning
requires deliberate contract evolution; do not reserve speculative v1 fields.

Persist updates by atomic replacement, retaining prior observations and effort
revisions inside the ledger. Serialize each short update and check its expected
revision so concurrent writers cannot overwrite each other silently. Do not
hold a timing lock across a human prompt or model/workflow operation, nest a
workflow operation inside a timing write, or reuse the workflow lock as a new
time-editing gate. Contention or stale edits produce an unsaved/conflict result;
they never cause a workflow retry. Detailed lock mechanics belong in the plan.

Repeated observation of the same semantic episode is idempotent. Conflicting
endpoints or branched effort revisions remain conflicts, not a last-writer or
latest-timestamp winner. Do not rewrite old observations to make totals agree.

### Semantic capture and lifecycle

Keep the runner as the sole workflow authority. It must expose bounded
observation points after a gate or validated decision becomes durable, before
automatic continuation. The interactive composition subscribes to those points
and owns the optional ledger writer. The observer may not supply a workflow
result, acquire approval or change execution policy.
Keep human prompts in the interactive flow; the lifecycle recorder never waits
for a human answer. Prompt cadence does not alter the stored decision boundary.

Attach recording only to interactive operation. Existing command/control,
read-only status, evaluation and context surfaces receive no new timing writes,
prompts or output fields. Pure summary rendering also performs no writes. An
interactive recording session may attach to an already pending run; use an
exact canonical opening anchor when available and record later capture start
separately. Otherwise show an unknown start rather than using CLI launch time
as the time the gate became pending.

Bind an episode to the exact persisted run, gate kind and its originating
attempt/round/review identity. Where needed, use the exact approval-bundle
identity to distinguish the authorized artifact set. Never use a slug, status
name, time proximity, finding count or export-local ordinal as identity. If
canonical evidence cannot distinguish two episodes, leave the association
unresolved. A consultation round and a triage iteration each form one episode;
their questions/findings are not additive timing units.

Use the following lifecycle rules:

| Situation                                                  | Observation result                                                                                                                                                                 |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Exact decision becomes pending                             | Open that episode at its canonical boundary, independently of notification or first keypress.                                                                                      |
| Valid response becomes durably recorded                    | Close once at the decision boundary before model/verification continuation. Rejection or rework of an ADR is still a response.                                                     |
| Response validation fails or user exits without submitting | Keep pending; do not fabricate a completed response.                                                                                                                               |
| A later phase fails after the response was recorded        | Preserve the answered episode; the later failure has its own evidence.                                                                                                             |
| Run is cancelled or the request is superseded              | Close with that distinct outcome; retain its known elapsed time outside the answered subtotal.                                                                                     |
| Process stops while the gate is pending                    | Preserve the episode. On restart use matching durable endpoints if available; show gaps where evidence is missing or contradictory.                                                |
| Another control surface records the decision               | Corroborated canonical evidence may establish closure when subsequently read, with unattributed response channel. It cannot establish interactive human presence or active effort. |
| Run is blocked                                             | Keep recovery-wait evidence separate from mandatory gate response elapsed; an unknown blocking start remains unknown.                                                              |

Define endpoint authority per gate in the implementation plan against actual
durable state/event writes. In particular, a recorded `review.triaged` decision
followed by failed completion validation must not be treated as unsubmitted.
A sidecar alone cannot prove a response absent corroborating canonical evidence.
Do not change the ordering or authority of workflow writes to simplify timing.

Do not time the entire auto-resuming `approvePlan`/`triage` call. Do not derive
active time from `updatedAt - createdAt`, arbitrary event gaps, model duration,
message counts, prompt residence or approval counts.

### Time basis and effort corrections

For a closed episode with valid endpoints, gate response elapsed is its closing
UTC timestamp minus its opening UTC timestamp. Persist the time basis and
coverage, not just a formatted number. A monotonic clock can corroborate
continuity within one process, but cannot bridge restarts. Cross-process wall
time remains explicitly wall-clock evidence with unverified continuity.
Negative durations, contradictory anchors and detected clock discontinuities
are unavailable; never clamp them to zero or silently cap overnight waits.
Any clock-discontinuity tolerance must be specified before implementation tests
and observations, not selected to improve study results.

An open episode may display elapsed waiting as of an explicitly supplied display
time. That display is provisional, does not write the ledger, and never enters
the completed-response subtotal. Sum only unique valid answered episodes for
`Gate response elapsed`, with answered, other-outcome and unavailable counts.
Show known subtotals alongside coverage when the episode inventory is incomplete.
Do not infer a complete inventory from the existence of a ledger alone.

Keep explicit operator totals separate from all automatic timing. An entered
total is an estimate for one contributor's active work associated with the run
through the observation time. Include outside-CLI work only when the operator
includes it; do not infer it. Passive waiting and minutes already assigned to
another run/task must be excluded. Study-recording overhead is also excluded
from engineering effort and remains a separate study concern.

The attribution source, supported contributor count and any identification
interaction are product choices in `HT-ID-01`. The earlier requirement to
identify an opaque contribution before editing is withdrawn as an unapproved
product choice. Do not introduce that interaction through an implementation
plan. Finalize attribution and the local allow-list after the recorded answer,
before this ADR is accepted.

Current interactive gates receive `defaultDecisionMaker()`, which returns the
OS username; standalone commands may override `--by`. This is an available
account label, not authenticated evidence of a unique engineer. No attribution
option may silently turn account continuity into proof of human continuity.

For each attribution unit established by the agreed contributor scope, use only
the unique valid current effort revision, reached through explicit replacement
links. A correction from 12 to 15 means 15, not 27;
the old 12 remains in history. Cancelled input leaves the value unchanged.
No entry means unknown; zero requires explicit entry. A correction may decrease
the total when the previous estimate was wrong. A stale or conflicting edit is
not silently applied. A value remains bounded by its as-of time after more work.

V1 supplies no measured active-time evidence. Confirming an elapsed value or
entering a precise number still produces `estimated`. Gate elapsed must not be
pre-accepted as active effort. The summary ownership label and its behavior
before attribution must follow the product answer to `HT-ID-01` and matching
requirements. This ADR does not prescribe an identification step or an alternate
label ahead of that answer. Attribution uncertainty must remain visible.

Never sum overlapping gate waits as active time. Without explicit contributor
and allocation evidence, run totals do not become complete task totals. A
cumulative run estimate cannot establish activity-specific effort or split
pre-acceptance work from rework; those fields remain unavailable. No proportional
allocation by gate duration is permitted.

### Failure, privacy and reporting boundary

Observation is optional evidence, not a workflow prerequisite. A timing failure
must preserve the authoritative workflow result, show `Time was not saved` on
the interactive surface when applicable, and degrade timing coverage. It must
not approve, reject, roll back or replay a decision, block model work because
time is absent, or trigger recovery. Conversely, invalid workflow evidence
cannot be repaired or overridden by a timing ledger.

Store the ledger as a private regular file with mode `0600` inside the existing
run directory. Enforce physical directory ownership, path containment and safe
file handling for both reads and writes; reject symlink redirection rather than
reading or overwriting another location. Validate the embedded run identity
against that directory. Never create a run as a side effect of reading timing.

This ADR proposes an explicit expansion of local runtime metadata only. Do not
capture keystrokes, screen/focus state, idle activity, requests, prompts,
transcripts, answer/triage text, arbitrary notes, credentials or personal names.
Do not copy source objects and redact them afterwards. Keep the allow-list
structural, including fixed diagnostics. No service, database, dependency,
network transmission, global identity registry or automatic upload is added.

Retain observations with their run, including failed/cancelled runs; do not
introduce automatic cleanup or expiry. Run deletion removes this evidence, so
the run directory is not a durable research archive. Private study mappings and
future authorized snapshots still belong outside repositories. Source control
receives only specifications, synthetic fixtures and minimized research results.

Read and project this ledger through a separate bounded, pure summary path.
Keep `banzai-evaluation-export/v1`, `banzai-evaluation-kpi/v1`, context reports
and existing machine-control/status contracts unchanged. In particular,
evaluation v1 `humanMinutes` remains unavailable even for a run with this ledger.
This difference must be documented: the interactive value is a local estimate,
and evaluation v1 has no approved source/meaning for it.

Define no public human-time report or disclosure option in this ADR. A future
research export needs its own privacy allow-list, source/snapshot identities,
coverage and compatible versioned contract. Exact run/contributor identities
and precise timing do not become safe to share merely because they are local
or pseudonymous. Do not repurpose export-local `run-000001` as a durable join.

## Consequences

Positive:

- the CLI can retain useful timing and corrections without spreadsheet entry;
- semantic response boundaries exclude following model execution;
- observation errors cannot create authorization or recovery side effects;
- independent evidence ownership limits compatibility and privacy changes;
- cancelled work, missingness and estimate provenance remain visible.

Negative and residual risks:

- one new local contract, writer and decoder need maintenance;
- separate workflow/observation writes leave possible gaps; this design favors
  truthful incomplete evidence over coupling workflow success to timing writes;
- optional correction may have low coverage and recall/anchoring bias;
- wall clocks across restarts and run-local contributor attribution have limits;
- task joins, multiple contributors, concurrent allocation and post-acceptance
  work remain insufficiently measured by a simple run total;
- old CLI versions ignore the sidecar, so work performed there may create gaps;
- deleting a run loses observations unless an authorized private snapshot exists.

Required follow-ups:

1. Resolve `HT-UX-01` and `HT-ID-01`, reconcile requirements/UX/ADR and approve
   the description before ADR acceptance. A run-level evidence component is
   not approval to omit task-level requirements from the study.
2. Specify gate anchors, the exact closed codec, resource bounds, concurrency
   and the agreed attribution behavior in the plan; include focused tests of
   material lifecycle, privacy and arithmetic failures.
3. Complete comparable native-workflow capture, task association, acceptance and
   quality observations before the comparative pilot. Do not execute the same
   production task twice or run replay under this decision.
4. Agree the pilot's time basis and thresholds before intake. Estimated totals
   cannot satisfy its proposed measured-time coverage rule. Retain failed,
   cancelled and unfinished tasks and their costs in cohort accounting.

## Compliance and Confirmation

Implementation and independent review must demonstrate:

1. A gate pending at 10:00, answered at 10:20, followed by model work until 10:50
   contributes 20 minutes of response elapsed and no inferred active minutes.
2. Five findings submitted in one 12-minute triage contribute one episode.
   Redisplay, restart and repeated capture do not count it twice.
3. Invalid submissions, pending exits, superseded gates, cancellations and
   post-response failures retain distinct outcomes and truthful coverage.
4. Missing/corrupt evidence, unsupported contracts, ambiguous anchors and clock
   discontinuities cannot produce exact durations or confirmed zeroes.
5. An estimate corrected from 12 to 15 contributes 15, preserves its prior
   revision, remains estimated, and is visibly bounded after later work.
6. Concurrent stale updates cannot overwrite each other; conflicting branches
   and contributor uncertainty stay visible. Parallel gate waits never become
   summed human effort or an automatically accepted task total.
7. Process interruption, contention, disk/write failure and a symlink/path
   escape do not replay workflow decisions or escape the owned run directory.
   Completed workflow authority remains independent of timing availability.
8. Ownership labels and editing behavior match the resolved `HT-ID-01` scope,
   including its limitations on handoffs and additional contributors. No account
   label or agent-control action asserts observed human presence or active time.
9. Privacy canaries for all prohibited content stay out of the ledger,
   projections and diagnostics. No model/network/activity service is invoked.
10. Existing run-state, configuration, model, evaluation/KPI, context and machine
    contracts remain unchanged. Their existing read-only reporting calls do not
    create, repair or write human-time evidence. Timing-present and timing-absent
    fixtures preserve existing evaluation/KPI bytes, including unavailable
    `humanMinutes`.
11. Historical absence, unsuccessful runs and additional contributors are
    coverage states, not exclusions that improve a productivity comparison.
12. The summary works on supported macOS/Linux terminals independently of
    terminal attention, with no new dependency or human gate. Prompt cadence
    follows the subsequently recorded product decision.

These are future implementation checks, not claims that code or tests were run
for this documentation proposal. Current delivery is the Proposed ADR and links;
there is no implementation, release, installation or prospective observation.

## Lifecycle Links

- Supersedes: None
- Superseded by: None
- Accepted on 2026-09-06 by the user's explicit `Approve adr` instruction.
  This is the recorded lifecycle decision; no further ADR acceptance is pending.
- The prior proposal deferred acceptance until the product questions were
  answered. The later user instruction overrides that ordering only. References
  are pinned above to the actual draft reviewed at acceptance; no product answer
  or feature-description approval has been recorded.
- The context, options, decision, consequences and confirmation text are
  preserved exactly as reviewed. Their references to future acceptance describe
  the earlier proposal's sequencing, now superseded by this lifecycle record.
- Implementation state: Planned. Resolve the product choices and approve a
  consistent plan before implementation. Changes to accepted architectural
  intent require a new Proposed ADR, not edits to this accepted body.
