# ADR 0003: Versioned Evaluation Export Contract

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
- Manifest: sections 2-6 and 9-10 of `PROJECT_MANIFEST.md`
- Related ADRs:
  - ADR-0001, Automatic Workflow Selection: produces route evidence consumed by
    the export; no conflict.
  - ADR-0002, Session Affinity and Bounded Reviewer Continuity: produces
    session/review metrics consumed by the export; no conflict.

## Context and Decision Drivers

Banzai persists operational state for recovery and status reporting, not a
cross-run evaluation contract. Run state has its own schema version, attempt
records have another schema version, and structured model results use contract
version `1.0.0`. Those identities describe upstream evidence and cannot also
identify a stable downstream dataset.

The new command has two representations. JSON must remain safe for programmatic
analysis across Banzai changes, while Markdown must remain concise and exactly
agree with JSON. An export timestamp or filesystem-dependent ordering would make
unchanged evidence produce different bytes and undermine reproducible cohort
comparisons.

Decision question: What versioned contract owns the authoritative evaluation
dataset, and how are Markdown and deterministic ordering governed?

Decision owner: Banzai maintainers, with explicit user lifecycle approval.

Decision drivers:

- stable machine consumption without coupling consumers to mutable run state;
- one authoritative representation for per-run and aggregate evidence;
- explicit evolution rules independent of model-output contracts;
- byte-for-byte reproducibility over unchanged inputs and arguments;
- one renderer path so Markdown cannot drift from JSON;
- a compact stdout-only first iteration without an external service or file
  writer;
- compatibility with the committed single-file CLI distribution.

## Options Considered

### Option 1: Independent canonical JSON object with a versioned identity

Define an evaluation-specific top-level object with exact identity fields,
cohort metadata, ordered per-run records, derived aggregates, and structured
issues. Render JSON directly and render Markdown exclusively from that object.
Keep the evaluation identity independent from run-state and model-result
versions.

Benefits:

- downstream analysis has a stable purpose-built boundary;
- source schema versions remain visible without leaking into consumer logic;
- one object guarantees Markdown/JSON agreement;
- deterministic construction and rendering are directly testable;
- future incompatible evaluation semantics have an explicit migration point.

Costs and risks:

- a new public contract needs its own evolution discipline and documentation;
- the renderer and aggregation code must keep every field ordered and total;
- additive fields require deliberate compatibility treatment rather than ad hoc
  output growth.

### Option 2: Export an array of normalized `RunState` objects

Reuse workflow read-time normalization and serialize the result of
`RunStore.readState()` for every run.

Benefits:

- little new type design;
- exposes nearly all currently available data.

Costs and rejection reason:

- exports identifying requests, slugs, paths, sessions, approvals, and free-form
  evidence by default;
- couples analysis to an operational recovery schema;
- read-time legacy defaults erase whether values were absent or observed;
- state metrics alone cannot provide traceable attempt/finding breakdowns;
- Markdown would need a second implicit contract. Rejected because it violates
  privacy, completeness, and contract-separation requirements.

### Option 3: Make JSON Lines the authoritative representation

Emit one record per run followed by aggregate records.

Benefits:

- streams large cohorts with bounded memory;
- supports append-oriented tooling.

Costs and rejection reason:

- ordering and aggregate authority become less obvious;
- a consumer can accidentally analyze only a prefix or omit the aggregate
  record;
- current local cohorts are small and do not justify a streaming contract;
- Markdown still needs a complete in-memory view. Rejected for the first
  iteration because complexity is disproportionate to the evidence volume.

### Option 4: Make Markdown authoritative and offer `--json` as an alternate

Define the report first and independently serialize similar data as JSON.

Benefits:

- optimizes the common human invocation;
- allows a very compact report layout.

Costs and rejection reason:

- human presentation cannot reliably preserve provenance and missingness;
- two aggregation paths can disagree;
- downstream parsers would depend on prose. Rejected because the requested
  evaluation dataset, not its presentation, must be authoritative.

## Decision

Adopt Option 1.

Define the authoritative document with these required top-level fields in this
order:

1. `schema`, with exact value `banzai-evaluation-export/v1`;
2. `schemaVersion`, with exact integer value `1`;
3. `cohort`, containing normalized filter boundaries and candidate, included,
   excluded, and unresolved counts;
4. `runs`, containing ordered privacy-minimized per-run evidence;
5. `aggregates`, deterministically derived from `runs` and their declared
   coverage;
6. `issues`, containing ordered stable issue codes and bounded locations.

Every v1 field is always present. Use `null`, an empty array/object, or an
explicit availability/coverage value instead of omitting fields based on input
state. Do not include an export timestamp, executable path, current working
directory, random value, or other invocation-specific value.

Treat `banzai-evaluation-export/v1` plus `schemaVersion: 1` as independent from
`RunState.schemaVersion`, `AttemptRecord.schemaVersion`, and
`CONTRACT_VERSION`. A change that removes a field, changes its type, changes a
metric's meaning, changes default privacy, or changes aggregation semantics
requires a new `/vN` identity and matching integer. Documentation-only wording
and bug fixes that restore the declared v1 meaning do not change the identity.
Do not add speculative optional fields to v1.

Construct arrays in this order:

- assign export-local run keys from the lexically sorted complete candidate
  directory set before cohort filtering, then order included and unresolved
  records by those keys;
- order attempts by valid `startedAt`, then phase kind, then their export-local
  key, with invalid timestamps after valid timestamps;
- order verification entries by persisted ordinal;
- order enum-keyed count objects by the declared enum order, not discovery
  order;
- order issues by run key, source kind, bounded item key, field, and issue code.

Serialize JSON with two-space indentation and one trailing newline. Render
Markdown only from the completed canonical object. Markdown must display the
schema identity, cohort definition, completeness, aggregate summaries,
workflow/status breakdown, per-run compact rows, and data-quality summary. It
must not reread persisted evidence or recompute a metric. It is a projection,
not a separately versioned data contract.

Keep the first iteration stdout-only: Markdown by default and canonical JSON
with `--json`. File output, JSONL, upload, and dashboard representations require
later features.

## Consequences

Positive:

- cohort tools can reject or migrate incompatible evaluation versions;
- output bytes are reproducible for fixtures and real unchanged runs;
- Markdown cannot silently diverge from JSON aggregation;
- upstream state can evolve while the exporter adapts it to a stable boundary;
- the contract can represent an empty or partial cohort without special prose.

Negative:

- maintainers own another public version identity;
- all v1 fields and ordering rules need focused regression coverage;
- avoiding optional speculative fields may require a v2 sooner if later cohort
  work proves a missing dimension;
- no generation timestamp means invocation time must come from an external
  wrapper if a downstream process needs it.

Risks and required follow-ups:

- contract drift: centralize the identity and JSON shape in one source module
  and assert exact fixture output;
- projection drift: test Markdown from the same canonical fixture and prohibit
  renderer access to the filesystem;
- accidental nondeterminism: test reversed directory/input order, repeated
  invocations, and both empty and partial cohorts;
- stale documentation: document the exact CLI and schema identity in root and
  package READMEs;
- later persistence-schema changes: add a new source adapter without changing
  v1 meaning, or issue v2 when the meaning cannot be preserved.

## Compliance and Confirmation

Implementation and independent review must confirm:

1. every JSON export begins with the exact schema identity and integer version;
2. source state, attempt, and model contract versions remain separate fields or
   provenance and never replace the evaluation identity;
3. every v1 field is present in empty, complete, legacy, and partial fixtures;
4. repeated JSON exports over identical evidence are byte-for-byte identical;
5. repeated Markdown exports over identical evidence are byte-for-byte
   identical;
6. Markdown values are obtained from the canonical object and agree with it;
7. array and enum ordering is stable when filesystem and fixture insertion
   order changes;
8. JSON stdout contains no diagnostic prose and ends in one newline;
9. the command performs no report file write;
10. README documentation names JSON as authoritative and Markdown as its
    projection;
11. committed distribution parity and the complete verification gate pass.

## Lifecycle Links

- Supersedes: None
- Superseded by: None
