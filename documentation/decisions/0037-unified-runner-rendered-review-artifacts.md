# ADR 0037: Unified Runner-Rendered Review Artifacts

## Status / Date / Owner / Decision Makers

- Status: Accepted
- Date: 2026-09-08
- Owner: Banzai maintainers
- Decision makers: Repository user; explicitly accepted in chat on 2026-09-08
- Rework: R1-F1, R1-F2 and R1-F3 accepted for proposal rework in chat on
  2026-09-08; this is not ADR acceptance.

- Amended by [ADR-0049](./0049-task-scoped-verification.md), accepted 2026-09-17:
  successor review projections carry task verification and assess its connection
  to requirements. Independent read-only review, frozen evidence and historical
  artifact semantics remain. Implementation of the amendment is Planned.

## Related Artifacts

- [Feature description](../features/unified-review-artifacts/description.md)
- Phase 2 evidence and limitations (historical record omitted from public source)
- Plan: not created; may be prepared only after acceptance
- Repository authority: root `AGENTS.md` and `PROJECT_MANIFEST.md` sections
  3, 5, 6, 8–10; `packages/orchestrator/MODULES.md`
- [Phase 1 protocol](../evaluation/reviewer-calibration/comparison-protocol.md)
- Related accepted decisions: ADR-0019 (candidate/scope authority), ADR-0023
  (terminal checkpoints), ADR-0002/0021 (continuity/failures/repair), ADR-0011
  (live permission evidence), ADR-0014 (human-triaged closure), ADR-0017/0025
  (completion ownership), ADR-0026/0028 (frozen KPI/context boundaries), and
  ADR-0030/0036 (EQ semantics and installed policy delivery).

## Context and Decision Drivers

Decision question: shall new orchestrated reviews use a single structured
result with reviewer-owned scope acknowledgment and runner-only artifact
generation, under the compatibility and failure rules below?

Current code sends `review-result/v1` to both vendors. Claude writes one
attempt-owned Markdown candidate with `Write`; Codex is read-only and the runner
renders its candidate. Content-invalid Claude candidates can receive one
same-session formatting repair. The v1 result has no scope assertion, while
Markdown may contain independently worded summary, deferred coverage, and other
review prose. Recovery reconstructs rendering context from current state.

ADR-0019 expressly deferred unified rendering until a separate accepted
decision and versioned reviewer-owned acknowledgment exist. This proposal meets
that prerequisite rather than treating the runner's approved-path list as
reviewer coverage. It also distinguishes a valid incomplete review from a
malformed result: a layout blocker must not force false coverage.

Phase 1 is the starting evidence, not a quality claim. RC-008 is a final failed
representation diagnostic; RC-009 has two valid and four invalid v1 variants.
There is no exact complete historical replay, adjudicated semantic case set,
or demonstrated reviewer improvement. Repair observations are partial workload
evidence, not savings. The full-session source-integrity discrepancy remains
unresolved and the baseline stays unchanged.

## Options Considered

| Option                                                      | Benefits                                                                   | Costs / disposition                                                                                             |
| ----------------------------------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Keep vendor-specific writing and bounded repair             | Existing compatibility and free Markdown prose                             | Retains duplicate model representation and formatting-only calls; does not satisfy the objective.               |
| Render v1 and copy approved paths                           | Smallest runtime change                                                    | Manufactures apparent scope coverage from runner data and loses Markdown-only meaning; rejected under ADR-0019. |
| Version structured scope and unify runner rendering         | One semantic response, deterministic artifact, explicit evidence ownership | New contract, snapshot, compatibility, permission and recovery coverage; proposed choice.                       |
| Ask models for both Markdown and a richer structured result | Preserves arbitrary Markdown                                               | Retains parity work and dual semantic surfaces; rejected.                                                       |

## Decision

Adopt the third option, subject to explicit acceptance. The following are
boundary contracts, not a binding private-helper decomposition.

### Structured result and reviewer assertion

Introduce `contracts/v2/review-result.schema.json` with explicit
`schemaVersion: 2`; keep umbrella `contractVersion: "1.0.0"`, phase-result,
configuration and release versions unchanged. Pin output identity
`review-result/v2` in the contract manifest, adapters, context accounting, and
terminal result decoding. Preserve the v1 schema bytes as a historical reader
surface, following phase-result versioning conventions.

Keep all existing semantic fields and their meanings. Add required
`reviewNotes: string[]` and required `scopeAcknowledgment`:

```text
scopeAcknowledgment = {
  schemaVersion: 1,
  snapshotDigest: <exact runner-supplied review snapshot digest>,
  artifacts: [
    { path: <exact approved path>, status: "reviewed", reason: null },
    { path: <exact approved path>, status: "not_reviewed", reason: <nonempty text> }
  ]
}
```

The alternatives shown above describe entry shapes, not duplicate entries for
one path. The acknowledgment has its own version so its semantics cannot change
silently under the review-result version. Use closed schema objects, required
properties, explicit types and nullable values within the supported structured
output subset. Runtime validation enforces the remaining invariants:

- Exactly one entry for every path in the validated approval snapshot, no
  extras or duplicates even when duplicate statuses agree. Require exact
  normalized repository-relative identity; reject absolute paths, traversal,
  backslash ambiguity, NUL, basename/substrings, and symlink escape. Do not
  silently normalize an invalid assertion into the required path.
- `reviewed` requires `reason: null`; `not_reviewed` requires nonblank reason.
  Invalid versions, unknown keys, snapshot mismatch, missing entries and
  contradictions are contract failures, never implicit v1 or blocked success.
- Entry order is not a coverage assertion; canonical coverage display follows
  the recorded required-scope order while retained structured input preserves
  its original order and values. No acknowledgment is populated from findings,
  Markdown, supplied context, session memory, or `planApproval.paths`.

**Full:** `reviewed` asserts that the reviewer assessed that approved artifact
as authority for the complete approved review surface in this invocation.
**Delta:** it asserts assessment of that artifact's applicability to accepted
findings and the complete current delta in this invocation. Every required
artifact is still explicitly accounted for. Delta does not imply another full
audit of unchanged source or permit skipped mandatory context. Resume requires
a valid compatible full-review anchor and current approval/snapshot lineage.
There is no automatic carried-forward acknowledgment state.

An acknowledgment is a reviewer assertion, not independent evidence of a file
read or substantive assessment. Tool telemetry does not manufacture it.

### Incomplete outcomes and meaningful prose

Require `verdict=blocked` whenever any required artifact is `not_reviewed`.
All other verdicts require complete required-artifact acknowledgment. Continue
requiring all immediately preceding accepted finding IDs for non-blocked
resolution review. For blocked review, `reviewedFindingIds` contains only
actually assessed IDs; missing accepted IDs are displayed as unacknowledged,
not silently marked reviewed. Reject duplicate and unrelated IDs. Preserve any
actual partial findings without exposing a blocked result to triage or fixes.

A layout/authority stop can validly return all required artifacts as
`not_reviewed` with the diagnostic as reason and summary, no findings, and no
reviewed finding IDs. It follows the existing blocked/retry/fresh-review path.
For new attempts, this explicitly amends ADR-0036's review-phase layout-stop
binding from `review-result/v1` to `review-result/v2`, including its closed-result
confirmation item. Keep the stop's `blocked` verdict, absent gate field, empty
findings, diagnostic summary, existing retry and reviewer rotation, and unchanged
approval/triage/completion authority. Historical v1 stops retain their contract.
Invalid approval or an unavailable runner snapshot before invocation remains a
runner check failure; do not invent an artifact to fill that absence.

Use `summary` for verdict rationale and `deferredCoverage` for limitations.
Use `reviewNotes` for meaningful additional scope analysis, resolution
reasoning, or handoff commentary that previously existed only in Markdown.
An empty array is valid; require no boilerplate duplication. Notes never add
findings, waive scope, establish command success, or override lifecycle.
Existing historical prose remains in its original artifact, without migration.
Preserve every `EQ-SHADOW:` string as opaque deferred-coverage content.

### Immutable runner snapshot and one artifact pipeline

Persist a runner-owned, independently versioned
`banzai-review-snapshot/v1` value in each new review attempt before the model
starts, with a canonical content digest. It binds run/attempt/iteration,
`review-result/v2`, base commit, the exact approval paths and file identities,
workspace snapshot, full/delta mode and change surface, prior canonical review
anchor when applicable, required accepted finding IDs and relevant human triage,
recorded verification results/log references, and validated completion evidence
including its source-attempt and report identities. Store it under existing
private attempt permissions; it is runner evidence, not model-returned content.
Its digest is the acknowledgment's exact snapshot identity. Snapshot capture
failure prevents invocation. A terminal result's checkpoint integrity covers
the returned acknowledgment and therefore its snapshot binding.

Keep snapshots immutable once an invocation begins. Recovery reads that
snapshot; it may check current evidence for drift but may not replace old
verification, completion, or coverage values with later state. Existing
sequence-owned verification logs remain read-accessible; unavailable legacy
log integrity remains explicit. No test counts are derived from prose.

For both vendors, follow one boundary sequence:

1. Retain returned structured input and available redacted process/session/
   usage diagnostics; malformed input remains diagnostic, never canonical.
2. Validate the current schema, reviewer acknowledgment, and application scope.
3. Use the existing renderer to create the attempt-owned candidate from the
   validated result and frozen runner snapshot.
4. Validate candidate bytes, identity, semantic/evidence projection, and current
   base/approval/workspace/completion integrity boundaries.
5. Reuse `publishReviewArtifact` to atomically publish exactly the validated
   in-memory proof bytes, then apply through the existing review lifecycle.

Use `banzai-feature-review/v2` for new canonical Markdown, visibly separating
runner-required scope and reviewer coverage. Preserve existing major human
sections and add Review Notes. Render all semantic fields, including evidence
details, without paraphrasing, truncation or lossy normalization. Use an inert,
lossless Markdown representation for arbitrary strings: reviewer text cannot
inject metadata/section headings, close its container, or become raw HTML.
Escaping/container syntax must preserve original content, including multiline
and EQ strings. Test content recovery as well as stable complete bytes.

Verification projection retains the recorded command/argv, outcome/signal,
timing and log references; completion projection retains recorded identities,
counts and exact task records. These are runner projections, never additional
reviewer claims. Handoff is verdict-specific: pass, triage, blocked or replan
must not all receive the current generic non-pass triage instruction.

There is no formatting-only repair invocation in this path. A rendering,
projection, validation, or publication defect fails explicitly with retained
candidate/result/diagnostics and unchanged previous canonical evidence. Never
rewrite semantic values or waive validation. Actual model/process/contract
failures retain existing typed handling and explicit retry semantics.

### Read authority and standalone behavior

Remove `Write` from new Claude review tools and explicitly disallow mutating
built-in tools; keep Codex fresh/resumed review sandbox read-only. Preserve
required `Read`, `Glob`, `Grep`, `Skill` and existing non-mutating Serena access,
subscription isolation, installed policy reads, and independent sessions.
Do not reduce required context or introduce new command execution authority.

Strip inherited `BANZAI_REVIEW_ARTIFACT` and conflicting workflow authorization
from review child environments. The packaged hook denies every orchestrated
review mutation, including the formerly permitted exact candidate path, even
if a stale variable, ambient grant, or resumed tool inventory supplies it.
There is no legacy reviewer-write invocation after upgrade; old evidence is
read/reconciled without spawning a legacy writer. Hook denial does not depend
solely on prompt compliance or the absence of an environment variable.

Standalone `feature-review` retains reviewer-owned next-iteration Markdown
under `banzai-feature-review/v1`, normal standalone finding IDs and existing
manual host permissions. Its reviewed inputs remain read-only. Runner-only
snapshot/acknowledgment obligations do not apply without runner context, and
standalone Markdown does not enter orchestrated completion automatically.
Preserve the ADR-0036 read matrix and layout blockers for both uses.

### Compatibility, recovery and consumers

| Evidence / boundary                                               | Required behavior after upgrade                                                                                                                                                                                               |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Historical v1 result and canonical Markdown                       | Read under v1 rules, preserving exact bytes and prose. Missing acknowledgment is legacy absence, never inferred coverage.                                                                                                     |
| Every newly created review attempt, including retry in an old run | Record v2 identity and immutable snapshot before invocation; require v2 at decoding, checkpoint, validation and application.                                                                                                  |
| Missing version on a persisted result                             | Legacy only when original attempt/checkpoint identity permits v1 and no v2-only fields are present. A v2 attempt cannot downgrade by losing `schemaVersion`.                                                                  |
| Historical terminal checkpoint / candidate                        | Preserve original result contract and integrity digest. Reconcile only evidence that passes its original candidate, approval and workspace rules; never regenerate old prose or invent a snapshot.                            |
| New terminal checkpoint, candidate absent                         | With matching valid v2 terminal proof and immutable snapshot, the runner may render the same candidate without a model call; conflicts fail closed.                                                                           |
| Candidate validated; publication/application interrupted          | Revalidate version-bound proof and current integrity, publish/apply idempotently. Existing different bytes or inconsistent ownership block; file presence alone is insufficient.                                              |
| No terminal proof, invalid candidate, or snapshot drift           | Retain original failed/interrupted attempt and diagnostic. Existing explicit review retry creates a distinct attempt; it never overwrites the failed candidate.                                                               |
| Reviewer sessions                                                 | Require recorded compatible output-contract evidence before reuse; otherwise use the distinct runtime reason `output-contract-not-reusable` as defined below. Preserve the meanings and precedence of other rotation reasons. |
| Status, control, latest review, triage and fixes                  | Read supported persisted versions; preserve blocked, pass and human-triaged completion distinctions and accepted-only fixing. No new control operation or gate.                                                               |
| Frozen evaluation/KPI and context                                 | Keep existing schemas, keys, enums, meanings and privacy allow-lists. No snapshot, assertion or prose enters exports. Existing repair events/usage remain readable and are counted once.                                      |

When an otherwise reusable reviewer session has no recorded output-contract
identity or names a different supported contract, rotate before invocation to
fresh/full with `output-contract-not-reusable`. The reason means that the
session cannot safely be reused with the current output contract; missing
evidence does not prove that the model settings changed or the previous review
was invalid. Malformed or unsupported persisted identities remain explicit
validation failures. Preserve existing independent rotation conditions:
`settings-changed` continues to mean model/executable/effort incompatibility,
and `legacy-state` remains the pre-session-affinity state case. Neither becomes
a label for the v1-to-v2 review contract transition.

Keep the new reason closed, named and observable in runtime types, persisted
attempt/event evidence, runtime validation, reviewer policy, human vocabulary,
and applicable status projections. Separate the runtime reason domain from the
frozen evaluation reason domain. Do not extend the export v1 rotation enum,
decoder allow-list, ordering or `byReason` keys, and do not alias the new cause
to an old reason, `null`, or a fabricated absent field.

The unchanged export v1 decoder treats an unsupported present rotation reason
as `value: null, evidence: "invalid"`. Its existing bounded diagnostic and
aggregation rules therefore produce incomplete rotation coverage, including
an invalid contributor to rotation totals and per-reason metrics. That means
the reason cannot be represented by export v1, not that the runtime review or
its canonical findings are invalid. Preserve all existing propagation of
incompleteness into export/KPI consumers; do not suppress issues or manufacture
exactness. Equivalent evidence representable by v1 keeps identical semantics.
Exact export coverage for this new cause requires a separately authorized
future evaluation version and is outside Phase 2.

Retain terminal-checkpoint v1's existing envelope and immutable hash rules;
dispatch its explicitly named result contract to v1 or v2 decoding as is
already done for phase-result versions. Add bounded attempt/snapshot and
reviewer binding evidence using the existing additive persistence convention;
historical absence stays valid. New-contract presence/identity is mandatory
for new attempts. Do not rewrite historical state to enable this path.

Reconciliation must distinguish terminal model success, candidate validation,
publication, and canonical application; none implies the next. Preserve typed
failure evidence even when publication fails after terminal success. Retrying
or recovering must not overwrite immutable checkpoints or account usage,
review iterations, findings, events, or completion twice. Mutable builder
recovery remains under ADR-0023/0024 and outside this change.

Revise the optional live probe to `banzai-live-compatibility/v2`: its former
Claude exact-artifact-write success condition no longer describes the product.
Both scenarios use v2 structured output and runner publication. Claude checks
must establish the actual restricted inventory and source/control/candidate
write protection without enabling `Write` merely for a probe. Preserve bounded
observable host evidence; model prose or unchanged files alone cannot prove
denial. Missing preflight support is unavailable; an authenticated scenario
that cannot establish its required outcome fails under ADR-0011. Offline hook
injection is separate deterministic evidence, not a live-host pass. Preserve
the existing confirmation, privacy, cleanup and invocation/time bounds.
Historical live v1 summaries keep their original meanings.

## Consequences

One structured semantic response replaces dual model representation. The
runner becomes responsible for renderer defects and immutable snapshot storage;
there is no model repair to conceal deterministic failure. The additional
assertion adds explicit coverage accountability but cannot prove review depth.

The contract upgrade causes a deliberate fresh/full review on incompatible
legacy session lineages. Standalone and historical Markdown remain a separate
compatibility surface. Arbitrary legacy layout is retained historically;
new meaningful prose must be expressed in structured fields.

The new runtime rotation reason is intentionally unrepresentable in frozen
export v1. Runs containing it have incomplete rotation statistics under the
existing invalid-evidence rules; runtime status still names the actual cause.
This compatibility cost is accepted only with this ADR, not hidden by widening
an old enum meaning. Existing historical rotation evidence remains unchanged.

Implementation must handle crash windows and every schema consumer together.
Tests must not mistake renderer/validator agreement for semantic preservation:
independent content and lifecycle assertions are required. Live vendor
compatibility and semantic quality remain unverified until separately
authorized evidence exists. No productivity or cost-saving claim follows.

## Compliance and Confirmation

Map the feature's AC1–AC10 to proportionate deterministic checks covering both
vendor decoders and the shared runner path; full/delta/incomplete/blocked scope;
path/duplicate/contradiction rejection; all prose and runner-evidence fields;
fresh/resumed/stale-variable write denial and required read inventory;
standalone writing; zero formatting-only invocation counts; immutable legacy
reads; and unchanged frozen projections for equivalent evidence.

Specifically verify that a v2 layout stop preserves ADR-0036's blocked/no-gate/
no-findings/retry behavior; missing or different supported output-contract
evidence rotates without mislabeling model settings or legacy session state;
and the new runtime reason stays absent from frozen export keys while its
unsupported-evidence diagnostic, invalid coverage and downstream propagation
remain truthful. Existing supported rotation reasons retain their meanings.

Inject failures around snapshot persistence, terminal checkpoint, rendering,
candidate validation, atomic rename, canonical JSON/state/event application,
and repeated resume/retry. Prove earlier canonical bytes and failed-attempt
evidence survive. Do not test only successful rendering.

Run focused tests first, then applicable verification, formatting, whitespace,
release-contract and committed build-parity checks; rebuild distribution after
source/schema changes. Keep Phase 1 immutable and record new expectations and
candidate identity separately. Use generic fixtures without private material.
Live or semantic trials require separate authorization and the Phase 1
adjudication/isolation protocol. ADR acceptance authorizes planning only; code
requires the subsequent approved plan.

## Lifecycle Links

- Amended by [ADR-0045](./0045-guided-verification-setup.md), accepted
  2026-09-14: snapshot v4/rendered review v5 carry exact runner configuration
  authorship and truthful configured/deferred/skipped coverage. Preserve
  independent review, triage and historical renderers. Implementation is Planned.

- Supersedes: None in full.
- Amends [ADR-0019](./0019-attempt-owned-review-candidates.md)'s reviewer-write
  requirement and [ADR-0021](./0021-failure-classified-reviewer-continuity.md)'s
  formatting repair for new attempts, plus
  [ADR-0011](./0011-protected-live-vendor-compatibility.md)'s Claude
  artifact-write probe. Their other guarantees and historical semantics remain
  binding.
- Amends [ADR-0036](./0036-vendor-neutral-policy-files-and-instruction-delivery.md)'s
  review-phase layout-stop result-contract binding and closed-v1 confirmation
  for new attempts only. Closed `review-result/v2` preserves the stop behavior
  specified above. Reciprocal lifecycle links are recorded on all four ADRs;
  their accepted bodies and historical behavior remain unchanged.
- Superseded by: None
- Related clarification: ADR-0030 EQ semantics and ADR-0036's policy read matrix,
  authority, layout recognition and stop behavior stay unchanged. The explicit
  review result-contract amendment above is not a policy relaxation.
- Accepted on 2026-09-08 by the user's explicit instruction "Accept ADR-0037".
  The body retains its proposal-stage wording; this lifecycle record supersedes
  pending-acceptance statements. R1-F1–R1-F3 rework preceded acceptance.
- Implementation state: Implemented under the approved
  [development plan](../development-plans/unified-review-artifacts/plan.md);
  see the [implementation report](../features/unified-review-artifacts/implementation-report.md)
  and [accepted review cleanup](../changes/unified-review-artifacts-implementation-review-cleanup.md).
  Live vendor calls, semantic trials and release/delivery operations still
  require separate authorization.
