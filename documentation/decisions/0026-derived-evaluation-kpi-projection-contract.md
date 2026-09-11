# ADR 0026: Derived Evaluation KPI Projection Contract

## Status / Date / Owner / Decision Makers

- Status: Accepted
- Date: 2026-08-22
- Owner: Banzai maintainers
- Decision makers: User, explicitly accepted in chat on 2026-08-22

## Related Artifacts

- Feature description:
  `documentation/features/derived-evaluation-kpi-projection/description.md`
- Feature plan:
  `documentation/development-plans/derived-evaluation-kpi-projection/plan.md`
  (created after acceptance)
- Manifest: sections 3–6 and 8 of `PROJECT_MANIFEST.md`
- Related ADRs:
  - ADR-0003, Versioned Evaluation Export Contract: owns
    `banzai-evaluation-export/v1`, the sole input of this projection; extended,
    not changed.
  - ADR-0004, Privacy-Minimized Read-Only Evaluation Boundary: owns the
    allow-list between raw run state and the export; untouched, because this
    projection reads nothing beyond complete export objects.
  - ADR-0005, Traceable Evaluation Aggregation: owns source precedence and
    coverage-aware metrics inside the export; this decision applies the same
    evidence discipline one layer further downstream.

## Context and Decision Drivers

Current state: `banzai eval export` emits per-run usage (including `costUsd`),
cumulative triage counts, `fixCycles`, attempt model identity, and
workflow/status aggregates under the frozen `banzai-evaluation-export/v1`
identity. Nothing computes the ratios that answer outcome questions —
completion rate, first-review pass rate, reviewer precision, fix cycles and
cost per completed run — and nothing attributes those ratios to the
planner/implementer/reviewer configuration that produced a run. Engineers do
hand arithmetic over export tables, and comparisons between checkouts or
configuration changes have no stable, citable semantics.

Target state: a derived-KPI projection with its own versioned identity,
computed purely from one or more complete `EvaluationExport` objects, rendered
as Markdown tables or canonical JSON, with every KPI carrying numerator,
denominator, value, and explicit evidence coverage, grouped overall and by a
per-run configuration signature.

Decision question: What contract owns the derived KPI projection and its
comparison semantics, and how is a run's configuration signature derived from
attempt evidence without misattribution?

Decision owner: Banzai maintainers, with explicit user lifecycle approval.

Decision drivers:

- committed baseline documents need KPI semantics that are stable, versioned,
  and independent of export evolution;
- export v1 bytes and schema must remain unchanged (ADR-0003 stability,
  existing consumers, committed exports from other checkouts);
- the ADR-0004 boundary must remain untouched: no new evidence may be read
  from `.banzai/runs/`;
- ADR-0005 evidence discipline: partial or unavailable evidence must surface
  as coverage, never as an invented exact value;
- byte-for-byte determinism over identical inputs, in both output modes;
- KPIs must be attributable to configurations, so a signature that merges
  unknown evidence into a known identity is worse than reporting `unknown`;
- the projection must be callable from a test with a hand-built export object,
  which forbids dependencies on `RunStore`, config, locks, adapters, or
  `WorkflowRunner`.

## Options Considered

### Option 1: Independent versioned projection contract over complete exports

Define `banzai-evaluation-kpi/v1` as a pure function of one or more complete
`EvaluationExport` objects. The document carries one source entry per input in
input order, each with its own complete KPI set derived exclusively from that
source's per-run `runs[]` evidence; comparison across sources is a rendering
concern, never a second aggregation pass. Every KPI value is a closed shape of
numerator, denominator, nullable value, and run-level coverage counts.
Configuration signatures derive fail-closed from attempt evidence.

- Benefits: export v1 frozen; KPI semantics versioned independently and
  citable from baselines; in-memory and `--input` modes share one derivation;
  single arithmetic serves overall and grouped reporting; trivially testable
  with hand-built exports.
- Costs: one more versioned public identity to maintain; per-source
  independence means a multi-source document repeats structure.
- Risks: KPI semantics that later prove wrong require a v2 of this contract —
  contained by the version field and by baselines naming their schema.

### Option 2: Extend the export contract with KPI fields

Add KPI blocks to `banzai-evaluation-export` (new fields or a v2).

- Benefits: one contract, one document.
- Costs/risks: changes export bytes or forks its version, invalidating the
  frozen v1 and every committed export; couples KPI evolution to export
  evolution; comparison over multiple export files still needs a second
  document shape anyway. Rejected: violates the export-stability driver for no
  compensating benefit.

### Option 3: Unversioned CLI-side computation

Compute KPIs in the renderer with no contract identity.

- Benefits: least code.
- Costs/risks: committed baselines and cross-checkout comparisons would cite
  semantics with no version anchor; silent semantic drift between releases
  becomes undetectable. Rejected: the whole point is citable, stable KPI
  semantics.

### Option 4: Derive KPIs from export `aggregates`

Read the precomputed `aggregates` tree instead of `runs[]`.

- Benefits: less arithmetic for the overall row.
- Costs/risks: grouping by configuration signature and by workflow requires
  per-run derivation regardless, so overall and grouped values would come from
  two different arithmetics that can disagree. Rejected: one traceable
  arithmetic (ADR-0005) must serve every row.

### Option 5: Best-effort configuration signatures

When some attempts in a role carry unknown model evidence, attribute the run to
the known triple; merge partial evidence.

- Benefits: fewer `unknown` groups, denser tables.
- Costs/risks: a run whose unknown-evidence attempt actually ran on a
  different model is silently counted under the wrong configuration,
  corrupting exactly the comparison the feature exists to make trustworthy.
  Rejected: misattribution is strictly worse than `unknown`.

## Decision

Adopt Option 1.

- Define `banzai-evaluation-kpi/v1` with exported schema-identity and version
  constants, computed as a pure function of one or more complete
  `EvaluationExport` v1 objects and of nothing else.
- Keep `banzai-evaluation-export/v1` byte- and schema-identical; read no new
  evidence from `.banzai/runs/`.
- Carry one source entry per input in input order (ordinal, label,
  included-run count, structured-issue count), each with its own complete KPI
  set derived only from that source's `runs[]`; never from `aggregates`, never
  across sources.
- Report every KPI value as numerator, denominator, value (`null` on a zero
  denominator), and coverage counts of exact versus partial-or-unavailable
  runs; only exact-evidence runs contribute.
- Derive per-run configuration signatures fail-closed: `selection|plan`
  attempts attribute to `planner`, `implementation|fix` to `implementer`,
  `review` to `reviewer`, each rendered `vendor/model/effort`; disagreeing
  fully-known triples within a role yield `mixed`; a missing role, any
  contributing attempt with unknown identity evidence, or any attempt with an
  unattributable kind yields `unknown` (the last voids all three roles).
- Render Markdown and canonical two-space JSON from the same completed
  document; comparison tables are a projection of per-source values.
- Evolve KPI semantics only by incrementing this contract's version; the
  export contract version never moves for a KPI change.

## Consequences

Positive:

- Outcome questions get stable, versioned, citable answers; baselines and
  change records can name the KPI they intend to move.
- Export v1 consumers and committed export files remain valid unchanged.
- Configuration comparisons cannot silently misattribute runs.
- The projection is testable with hand-built exports and adds no dependency.

Negative:

- A second evaluation contract must be documented and version-managed.
- Fail-closed attribution yields `unknown` groups on legacy or partially
  readable runs, making sparse cohorts look sparser — an honest but sometimes
  disappointing table.

Risks and follow-ups:

- KPI definitions may need revision after real baseline use; that is a v2 of
  this contract plus regenerated baselines, and is acceptable.
- The baseline procedure itself is documentation (`documentation/evaluation/`);
  producing baseline numbers stays a human act outside this contract.

## Compliance and Confirmation

- The KPI module imports only `types` and evaluation-export/render output;
  no import of `store`, `config`, `workflow`, `adapters`, or locks (checked in
  review and enforceable by test construction with a hand-built export).
- Exported constants carry `banzai-evaluation-kpi/v1` and version `1`; JSON
  output embeds them.
- Determinism test: identical inputs produce byte-identical Markdown and JSON.
- Export-stability check: `eval export` output bytes for a fixed fixture are
  unchanged by this feature.
- Fail-closed tests: foreign or malformed `--input` documents produce
  `INVALID_EVAL_INPUT` and no stdout; unknown-evidence attribution cases
  produce `mixed`/`unknown` exactly as specified in FR11–FR13.
- Arithmetic tests cover every KPI including zero-denominator and
  partial-coverage cases (FR5–FR10).

## Lifecycle Links

- Supersedes: None
- Superseded by: None
