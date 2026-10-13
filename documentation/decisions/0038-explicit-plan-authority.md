# ADR 0038: Explicit Plan Authority

## Status / Date / Owner / Decision Makers

- Status: Accepted
- Date: 2026-09-08
- Owner: Banzai maintainers
- Decision makers: Repository user; explicitly accepted in chat on 2026-09-08

- Amended by [ADR-0049](./0049-task-scoped-verification.md), accepted 2026-09-17:
  a self-contained approved verification inventory v2 and separate non-replacing
  supplements govern new task verification. Approval immutability and human
  obligation changes remain. Implementation of the amendment is Planned.

## Related Artifacts

- [Description](../features/proportionate-development-plans/description.md)
- Phase 3 record (historical record omitted from public source)
- Development plan: not created; depends on acceptance of this decision
- Root `AGENTS.md`; `PROJECT_MANIFEST.md` sections 5, 6, 8–10
- [Phase 1 protocol](../evaluation/reviewer-calibration/comparison-protocol.md)
- Accepted ADRs: [0013](./0013-risk-driven-test-assurance.md),
  [0014](./0014-human-triaged-review-closure.md),
  [0017](./0017-versioned-plan-task-completion-ledger.md),
  [0025](./0025-fix-authored-completion-ledger-refresh.md),
  [0027](./0027-exposure-driven-security-assurance.md),
  [0030](./0030-vendor-neutral-engineering-quality-policy.md),
  [0036](./0036-vendor-neutral-policy-files-and-instruction-delivery.md), and
  [0037](./0037-unified-runner-rendered-review-artifacts.md)

## Context and Decision Drivers

Decision question: shall new plans explicitly opt into a document-level
authority convention, with one shared policy governing every consumer?

The current `development-plan` skill requires contracts, signatures, state
shapes, identifiers, config keys and control flow without a proportionality
condition. `code-writing` permits deviations only when required by reality.
Review already rejects unsupported design preferences, but it must also enforce
explicit approved directives. Updating only the planner leaves those consumers
in tension. Conversely, declaring all internal details optional would silently
waive real architectural or approved implementation commitments.

`parseApprovedPlanTaskIds` reads task identifiers from canonical headings, not
prose obligations. Approval binds exact description/ADR/plan bytes and saves
snapshots; completion validates ordered task records and evidence parity.
These boundaries can carry a prose convention without interpreting it at runtime.

Phase 1's proposed RC-005/RC-006 pair distinguishes an explicit binding directive
from a counterfactual non-binding alternative. It establishes no historical false
positive or successful calibration. RC-007 supplies synthetic unchanged-evidence
rediscovery controls. Phase 2 changes artifact representation, not plan authority.

Drivers: explicit obligations, useful implementation discretion, historical
compatibility, human authority, truthful evidence, proportionate authoring and
single policy ownership. This cross-role interpretation merits an ADR; no
additional unresolved product choice prevents presenting a concrete proposal.

## Options Considered

| Option                                             | Benefit                                                                          | Cost / disposition                                                                                                                                 |
| -------------------------------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Keep exhaustive prescription                       | Familiar approved meaning; no consumer change                                    | Retains unnecessary design commitments; does not meet FR4.                                                                                         |
| Make internal details optional globally            | Small instruction change                                                         | Cannot distinguish an internal architectural constraint from a preference; retroactively weakens approval. Rejected.                               |
| Explicit prose opt-in and labeled guidance         | Meaning travels with approved bytes; preserves task/parser contracts and history | Requires careful authoring and semantic judgment. Chosen, subject to acceptance.                                                                   |
| Versioned obligation schema and runtime classifier | Machine-readable classifications                                                 | Adds a new authoring/authority boundary and machinery without evidence of necessity; natural-language correctness would remain unproved. Rejected. |

## Decision

### Approved document convention

For newly authored plans, include this short section before Technical Breakdown
and Implementation Tasks. It is part of the plan presented for approval, not
metadata inferred from plugin version, timestamps, conversation or runtime state:

```markdown
## Plan Authority

Applicable approved requirements, accepted ADR constraints, public and persisted
contracts, security and authorization boundaries, transaction and lifecycle
guarantees, compatibility, scope, and required verification evidence are binding.
Exact internal details remain binding when required by applicable authority or
concrete constraints; unlabelled explicit directives remain binding.

Only paragraphs or list items prefixed `Optional implementation guidance:` are
non-binding suggestions. A label covers that paragraph or list item, including
its nested content, and ends before the next sibling block. A different compliant
implementation within approved scope needs no reapproval, finding or deviation
report merely for differing from this guidance.

Guidance never overrides binding authority or expands scope. Resolve conflicts
and ambiguous commitments before dependent work; missing or ambiguous optionality
does not waive an explicit commitment.
```

Use ordinary Markdown, with no schema version, runtime flag, obligation parser,
new heading grammar, machine gate or standalone approval mechanism. Optional
content may be omitted entirely. Do not infer guidance from location, private
visibility, example-like appearance or a generic heading alone. Put required
behavior and safety constraints in binding text, never solely inside guidance.

Link authoritative contract definitions and retain their exact required names,
keys, signatures, paths and semantics when material. A link cannot silently
authorize future contract changes; existing approved authority and compatibility
rules govern the referenced definition and any change to it.

### Compatibility and conflicts

Apply this convention only where the approved plan actually establishes it.
Existing plans keep their approved meaning, including any explicit optionality
they already express under their own terms. Absent or ambiguous optionality is
never permission to disregard a commitment; do not require retroactive insertion
of the new section into a legacy plan. An approved explicit internal directive
remains binding even if an alternative seems behaviorally equivalent.

Never edit historical plans, approval snapshots, findings or triage to align
them with the new convention. Changing an approved commitment requires the
existing applicable ADR/escalation and plan reapproval path. A deviation report
documents a real deviation; it does not authorize one. Preserve stronger
authority and resolve contradictory or ambiguous commitments before dependent
work. Use existing conflict handling rather than silently selecting an option.

Approval continues to bind the whole bundle, including optional guidance bytes.
Choosing within approved discretion differs from changing the approved document:
even an optional-text edit invalidates an orchestrated approval digest. Preserve
task identity/order, immutable orchestrated checkboxes, standalone completion
fallback and every ledger/projection/revalidation rule under ADR-0017/0025.

### Policy ownership and role responsibilities

Own this interpretation once, in a distinct `Plan Authority` section of the
existing installed `policies/plan-task-completion.md`. Identify ADR-0038 as owner
of that section; ADR-0017/0025 continue to own the unchanged completion section.
Preserve the filename, existing completion heading, five-policy layout, relative
resolution and fail-closed source availability rules.

Amend ADR-0036's conditional triggers for that file: `test-writing` reads when
interpreting a strict plan or its assurance/completion obligations;
`feature-review` and `feature-status` when interpreting strict plan authority or
completion; `quick-fix` when accepted findings involve an approved strict plan
or its completion evidence. Planner and implementer retain required reads.
Keep the same Read/Conditional matrix membership; add no EQ read to assurance,
status or supervisor, and no strict ledger to lite work. No required context
is removed. This explicitly extends the file beyond completion and supersedes
the delivery-only body-preservation restriction solely for the new section and
these trigger descriptions; all existing completion semantics remain binding.

Use short role-specific projections and installed-policy references in skills
and relevant runner prompts, not copies of the full policy. Align the packaged
process text so that useful, explicitly optional guidance is permitted artifact
content. Do not turn this convention into an additional template for every task.

- Planner: establish intended behavior/invariants, affected units and boundaries,
  dependencies and FR/acceptance/ADR links, proportionate evidence and necessary
  implementation constraints. Include only materially affected breakdown areas.
  Omit speculative architecture, exhaustive trees/inventories, pseudocode bodies,
  repeated ADR rationale and empty sections. Preserve canonical task headings.
- Approver: inspect the actual obligations, scope, required evidence and marked
  discretion in the bundle at the existing plan gate. Acceptance of this ADR
  alone authorizes no plan or implementation.
- Implementer/assurance: satisfy binding obligations within approved scope;
  choose compliant routine mechanics freely where the plan permits. Record
  material decisions and real deviations proportionately in existing reports.
  A merely different optional helper, constant or decomposition needs no entry.
- Reviewer: identify concrete violations of applicable authority. A difference
  from explicitly optional guidance alone is not a finding; independently
  supported correctness, security, compatibility, evidence or maintainability
  problems remain actionable even if all guidance was followed. Preserve existing
  severity rules and EQ shadow boundaries; do not globally suppress nits or
  downgrade plan violations. Resolve accepted findings first and retain existing
  rediscovery limits through reviewer rotation.
- Fixer: meet accepted finding scope and binding fix acceptance. A suggested
  remedy remains a suggestion unless an applicable explicit human decision makes
  it mandatory. Never silently waive an accepted explicit directive, turn a
  recommendation into extra required work, or change task achievement through
  evidence refresh. Conflicting authority uses existing escalation.
- Completion/status: keep structural completion validation and evidence provenance
  unchanged. Neither a syntactically valid ledger nor a compliant guidance choice
  proves that substantive requirements or required checks were satisfied.

Clarify claim-narrowing projections under ADR-0013 consistently: correction of
an unsupported report is allowed, but it never discharges a mandatory check or
missing material evidence. Required failures remain actionable; truthful pending
or unavailable evidence does not become pass. This preserves ADR-0013's existing
assurance rule rather than replacing it with a lower threshold.

### Bounded evidence

Keep Phase 1 documents, private cases, identities, proposed labels and splits
unchanged. Use RC-005/RC-006 for the authority distinction and RC-007 for unchanged
rediscovery; keep material-defect/evidence-integrity guards. Historical acceptance
or rejection is disposition evidence, not automatic correctness adjudication.
Do not read held-out answers while tuning instructions.

Keep input files physically separate from proposed answers and curation notes;
use explicit input allow-lists. Assign related variants to the same group.
Synthetic examples are calibration material, never a new blind holdout or
production observations.

Neither word reduction nor a string assertion proves plan quality or reviewer
judgment.

Any later semantic trial needs separate explicit authorization and Phase 1's
adjudication, frozen identities/settings, independent input-only sessions,
group splits, failed-trial retention and guard measures. Separate planner-output
comparison from fixed-input reviewer comparison; a change to both plan and
reviewer cannot be attributed solely to reviewer quality. Without trials, finish
approved implementation and deterministic checks with effectiveness unverified.

## Consequences

Plans retain obligations and evidence while avoiding unnecessary commitments.
Already-approved directives and immutable bundles stay protected. One existing
policy reaches all consumers without a new runtime subsystem or dependency.

Costs: new plans carry a short authority section; consumers must distinguish
semantic obligation from suggestion. Missing labels remain conservative rather
than granting discretion. A misplaced mandatory constraint can still mislead a
model, so authoring consistency and independent review remain necessary. This
decision provides no evidence of fewer unsupported findings or better plans yet.

## Compliance and Confirmation

Prepare six generic synthetic teaching/calibration examples: a binding public or
persisted contract; an optional private choice; a real defect despite following
guidance; guidance conflicting with stronger authority; a legacy explicit
directive; and a report claiming an unsupported required-check pass.

Provide illustrative before/after plans based on identical requirements and a
complete obligation/evidence retention map. State which prescribing details were
removed or made optional.

After explicit acceptance and plan approval, verify instruction delivery and
conditional reads, unchanged supported task extraction, approval digest/snapshot
integrity including optional bytes, completion parity and legacy behavior, and
relevant Phase 2 v2/legacy contracts. Use existing behavioral tests and bounded
new fixtures; do not mirror every policy sentence in assertions or pretend tests
establish semantic judgment. Update byte pins only for approved changed surfaces.

Run focused checks and applicable repository gates, rebuild committed outputs
when prompts/source change, and record actual results and unavailable lanes.
Inspect the before/after obligation map and separated example inputs/answers.
Keep private evidence and frozen documents unchanged. Semantic effectiveness,
live host delivery and vendor behavior remain unverified without separate work.

## Lifecycle Links

- Amended by [ADR-0054](./0054-git-visible-work-artifacts.md), accepted
  2026-10-13: new plans use the tracked work directory. Approval authority and
  immutable approved bytes remain. Implementation is Planned.

- Supersedes: None in full.
- Amends ADR-0036 only for the plan-policy section and read-trigger extension
  specified above. On acceptance, add reciprocal lifecycle metadata without
  rewriting its accepted body.
- Clarifies application of ADR-0013, ADR-0017/0025 and ADR-0030 without changing
  assurance, completion, authority precedence, EQ promotion or severity.
- Preserves ADR-0014 closure and all ADR-0037 review contracts.
- Superseded by: None.
- Accepted on 2026-09-08 by the user's explicit lifecycle decision after the
  accepted R1-F1 correction, with an instruction to proceed to planning.
  The body retains its proposal-stage wording; this lifecycle record supersedes
  pending-acceptance statements. Finding acceptance and ADR acceptance are
  separately recorded in the Phase 3 record.
- Implementation state: Planned. The subsequent plan-bundle approval remains
  required before implementation.
- [Development plan](../development-plans/proportionate-development-plans/plan.md)
  prepared after acceptance; awaiting its separate bundle approval. This link
  supersedes the proposal-stage plan-availability note in Related Artifacts.
- Implemented on 2026-09-09 after explicit approval of the Phase 3 plan bundle;
  see the [implementation report](../features/proportionate-development-plans/implementation-report.md)
  and [assurance report](../features/proportionate-development-plans/test-report.md).
  This supersedes the Planned implementation state above. Independent
  implementation review and semantic effectiveness evaluation remain pending.
