# ADR 0028: Phase Context Accounting and Budget Policy

## Status / Date / Owner / Decision Makers

- Status: Accepted
- Date: 2026-08-23
- Owner: Banzai maintainers
- Decision makers: User, explicitly accepted in chat on 2026-08-23

## Related Artifacts

- Feature description:
  `documentation/features/evidence-driven-context-budgeting/description.md`
- Feature plan:
  `documentation/development-plans/evidence-driven-context-budgeting/plan.md`
  (created after acceptance)
- Manifest: sections 3–6 and 8 of `PROJECT_MANIFEST.md`
- Related ADRs:
  - ADR-0003, Versioned Evaluation Export Contract: owns the frozen
    `banzai-evaluation-export/v1` identity; this decision does not extend it.
  - ADR-0004, Privacy-Minimized Read-Only Evaluation Boundary: establishes the
    precedent that a reporting surface gets an explicit metadata allow-list and
    never infers unavailable evidence.
  - ADR-0005, Traceable Evaluation Aggregation: establishes coverage-aware,
    source-attributable aggregation.
  - ADR-0020, Scoped Claude Subprocess Environment: reduced one measured source
    of ambient context while preserving Banzai skills, hooks, and project
    instructions; this decision generalizes measurement across phases and
    vendors.
  - ADR-0021, Failure-Classified Reviewer Continuity: owns retry and session
    continuity semantics that a context policy must not silently change.
  - ADR-0023, Durable Terminal Attempt Checkpoints: establishes that consumed
    attempt evidence survives failure and interruption.
  - ADR-0026, Derived Evaluation KPI Projection Contract: demonstrates how a
    new deterministic report remains independent of export v1 and how missing
    historical evidence becomes coverage rather than zero.
  - ADR-0027, Exposure-Driven Security Assurance: requires the new evidence and
    report boundary to prevent retention of prompt, secret, personal, and path
    content.

## Context and Decision Drivers

Current state: Banzai's prompt builders return flat strings. `WorkflowRunner`
passes those strings and a phase output schema to a vendor adapter, then records
normalized vendor usage when the vendor reports it. The normalized
`ModelUsage.inputTokens` is useful for cost and cache ratios, but it is
post-call evidence with vendor-owned semantics. In particular, Claude's
cumulative result can count the growing conversation again on each stateless
round-trip. It therefore cannot answer how many bytes the runner supplied for
one invocation, which prompt category was large, which authoritative artifacts
were merely available by reference, or which portion came from vendor session
inventory and tools.

ADR-0020 proved that context architecture has material cost and correctness
effects: removing unrelated ambient MCP schemas and plugins reduced a measured
turn-1 prefix while preserving project instructions and enforcement. That
change was evidence-driven, but Banzai has no general evidence contract with
which to find the next opportunity. A maintainer can see millions of cumulative
input tokens in a run and still cannot distinguish a large review bundle, an
output schema, an ambient tool inventory, or repeated vendor turns.

The persistence boundary has a second gap. Successful and failed attempts retain
vendor usage when it can be decoded, but there is no attempt-owned pre-call
record of the runner payload. If the vendor times out, the process is
interrupted, or validation fails after the call, the one measurement Banzai can
compute exactly is not retained. Conversely, persisting the prompt to make the
measurement inspectable would violate the repository's established privacy and
redaction posture.

Target state: every model invocation has a privacy-safe, attempt-owned context
ledger that separates exact runner-controlled bytes from declared authority,
reported session inventory, and vendor usage. A deterministic read-only report
projects the evidence by phase and role. Observation is the compatible default;
operators may explicitly enforce only exact pre-call runner-payload limits, and
a crossing fails intact before the vendor starts rather than weakening the
specification.

Decision question: What architectural boundary and versioned contracts own
phase context accounting, persistence, reporting, and optional budget
enforcement without changing the frozen evaluation contracts or weakening
authority and review invariants?

Decision owner: Banzai maintainers, with explicit user lifecycle approval.

Decision drivers:

- exact, actionable evidence about runner-owned context composition;
- strict separation between byte counts, vendor tokens, declared authority,
  and adapter-reported inventory;
- no prompt, request, transcript, output, tool, environment, secret, personal,
  or absolute-path content in durable evidence;
- pre-call durability across timeout, interruption, vendor failure, and
  downstream validation failure;
- compatibility by default: no payload, workflow, approval, review, retry, or
  outcome change in observation mode;
- fail-intact enforcement with no truncation, rewriting, summarization, or
  omission of authoritative context;
- deterministic, coverage-aware reporting over historical and current runs;
- byte- and schema-stability of `banzai-evaluation-export/v1` and
  `banzai-evaluation-kpi/v1`;
- the manifest's inward dependency direction and no new dependency or vendor
  call;
- enough evidence to justify later optimization without committing to broad
  `WorkflowRunner` decomposition first.

## Options Considered

### Option 1: Continue using vendor usage as the context metric

Use `ModelUsage.inputTokens` and `cachedInputTokens` from existing attempt and
evaluation records, adding only documentation and perhaps KPI grouping.

- Benefits: no new persistence, configuration, or reporting contract; works
  with already recorded runs whose vendor usage is complete.
- Costs and risks: cannot identify runner-owned categories; cannot measure
  before a call; mixes one-call and cumulative multi-turn semantics; lacks
  evidence when a vendor does not report usage; cannot distinguish ambient
  session inventory from runner payload; turns unavailable evidence into an
  optimization guess.
- Rejected: it reports consumption, not the controllable architectural surface
  this decision needs to govern.

### Option 2: Enforce vendor token caps directly

Set one token limit per phase or model and reject an invocation based on the
vendor's reported or advertised context window.

- Benefits: a familiar budget unit; maps superficially to vendor limits and
  pricing.
- Costs and risks: actual input tokens are unavailable until after the call;
  tokenization and cumulative-turn semantics differ by vendor; context windows
  and ambient inventories are vendor-owned and can change; an estimate can
  block valid work or admit an oversized call while claiming exactness.
- Rejected: a post-call or estimated metric cannot authorize a pre-call block.

### Option 3: Fit budgets through automatic truncation or summarization

When a phase exceeds its budget, drop low-priority components or ask a model to
summarize requirements, plans, verification, or review evidence.

- Benefits: more invocations fit a fixed budget; can reduce vendor input without
  failing the workflow.
- Costs and risks: changes authority bytes and can erase an invariant, human
  decision, accepted finding, or negative verification result; summary quality
  is not cheaply verifiable; adds another vendor call and model-dependent
  failure mode; makes an enforcing budget silently change product semantics.
- Rejected for version 1: reversibility requires failing intact when mandatory
  context does not fit. A future compression proposal needs its own evidence,
  contract, and approval.

### Option 4: Versioned phase context envelope, attempt ledger, and report

Have prompt construction return the exact payload together with closed
component metadata. Persist a versioned, privacy-safe invocation entry before
the adapter call, append available inventory and vendor usage afterward, and
derive an independent deterministic report. Default to observation; permit
enforcement only over the exact pre-call runner-payload byte total.

- Benefits: measures the controllable surface exactly; identifies the category
  to optimize; survives failed calls; supports honest partial coverage;
  preserves payload and workflow behavior by default; enforcement is local,
  deterministic, and reversible; leaves evaluation v1 and KPI v1 untouched.
- Costs: adds a persisted contract, a report contract, configuration, lifecycle
  wiring, and tests; prompt builders must expose composition rather than only a
  final string; byte counts still cannot explain vendor-owned prefix tokens.
- Risks: instrumentation can leak content if its metadata boundary is loose;
  excessive category granularity can create its own maintenance burden; a
  pre-call byte budget is a Banzai payload control, not a vendor context-window
  guarantee.

### Option 5: Decompose `WorkflowRunner` before measuring context

Split the large workflow module into phase-owned runners and let each new module
define its own context contract and budgets.

- Benefits: phase ownership and context boundaries could improve together;
  smaller modules would reduce code context for maintainers and models.
- Costs and risks: a broad, high-churn refactor before evidence identifies the
  expensive phases; mixes a structural rewrite with a new persistence and
  reporting contract; increases review surface and makes attribution of any
  regression difficult.
- Deferred: the proposed evidence should determine whether phase-owned workflow
  modularization is the highest-value follow-up.

## Decision

Adopt Option 4.

Define two independent version-1 contracts:

- `banzai-context-attempt/v1` is the attempt-owned durable ledger. It contains
  one entry per actual model invocation, with a deterministic invocation
  ordinal and kind, run/attempt/workflow/phase/role/vendor/session attribution,
  exact runner-payload components, declared authority/artifact metadata,
  optional adapter-reported inventory, optional normalized vendor usage, budget
  evaluation, and per-surface availability. It contains no raw content.
- `banzai-context-report/v1` is the completed read-only report projected from
  valid context ledgers plus only the bounded run metadata required for cohort
  and attribution. Markdown and canonical JSON render from the same report
  object. It is not an extension of either evaluation contract.

Make prompt composition explicit. Each prompt builder constructs an internal
`PromptEnvelope` whose rendered prompt bytes are exactly the bytes supplied to
the adapter and whose non-empty components use the closed categories required
by the feature description. The phase output schema is measured as its own
runner-payload component. The envelope is data, not a policy layer: it does not
truncate, prioritize, summarize, or choose a model.

Maintain four non-interchangeable evidence surfaces:

1. **Runner payload**: exact pre-call UTF-8 bytes for the rendered prompt and
   output schema. This is the only enforceable surface in version 1.
2. **Authority/artifact surface**: bounded metadata identifying which approved
   or authoritative artifact classes are available to the invocation. Referenced
   artifact bytes are never counted as embedded payload bytes.
3. **Session inventory**: tool, MCP, skill, command, or other inventory counts
   only when the adapter reports them. No token estimate is derived from a
   count, and unavailable inventory stays unavailable.
4. **Vendor usage**: the existing normalized input, cached-input, output, cost,
   and turn evidence after the call. Its current cross-vendor semantics remain
   unchanged and it never retroactively authorizes a pre-call decision.

Persist the invocation entry atomically before starting the vendor process.
After the call, checkpoint only the inventory, usage, outcome, and availability
fields supported by observed adapter evidence. The pre-call entry remains if
the process never starts, times out, is interrupted, exits unsuccessfully, or
its result later fails validation. Historical attempts and interrupted writes
without valid ledgers are report coverage gaps, never zero-sized invocations.
When normalized usage also exists in the canonical attempt checkpoint, the
ledger value is a projection of that same decoded value; a disagreement is
invalid context evidence rather than a second source-precedence rule.

Put accounting, contract decoding, budget evaluation, aggregation, and
rendering in small inward modules that are testable from hand-built values.
`WorkflowRunner` owns only invocation attribution, atomic lifecycle wiring, and
the exact pre-adapter enforcement point. The report CLI composes read-only file
access around the pure decoder and projection; it does not construct adapters
or `WorkflowRunner`.

Expose an optional context policy in `.banzai/config.json`:

- an absent section is `observe` with no limits;
- `observe` records every configured crossing and changes no invocation or
  workflow behavior;
- `enforce` blocks only when an applicable exact runner-payload byte limit is
  crossed;
- phase-and-role-specific limits outrank phase-only or role-only limits;
  between equally specific applicable limits, the smaller limit wins; a
  default limit applies only when no more specific limit matches;
- malformed, duplicate, non-positive, or unsupported limits fail config
  validation before a run mutates;
- version 1 defines no universal numerical limit;
- vendor token, cache, cost, turn, and session-inventory thresholds, if
  configured, are observations only.

An enforcing crossing records the pre-call ledger entry and fails with stable
code `CONTEXT_BUDGET_EXCEEDED`, naming phase, role, exact measured bytes, and
effective limit without payload content. It starts no vendor process, performs
no automatic retry under the unchanged policy, and uses the existing run
authorization and recovery rules for any later retry after configuration or
authorized input changes.

Implement the command
`banzai eval context [--json] [--from <RFC3339>] [--to <RFC3339>] [--run <run-id>]...`
as a deterministic offline read-only surface. Reuse the existing evaluation
cohort grammar and validation order, but give context reporting its own narrow
input allow-list. Report exact and incomplete coverage before totals; group
runner-payload and category bytes by workflow, phase, and role; list category
totals largest-first with a stable tie order; report threshold crossings; and
display vendor usage and session inventory only in separately labeled covered
sections. A malformed or unsupported ledger fails closed as
`INVALID_CONTEXT_EVIDENCE`; a historical attempt with no ledger remains a
coverage gap.

Keep `banzai-evaluation-export/v1` and `banzai-evaluation-kpi/v1` byte-, schema-,
and semantics-identical. Context evidence does not enter either contract in
version 1. Add no dependency, external service, model call, API-key path,
automatic summarization, model switching, complete session read tracing, or
broad workflow-module decomposition.

After shipping observation, collect a representative baseline of 15–30
completed runs before proposing a default or enforcing project budget. Every
follow-up optimization names both the context category or surface it intends to
reduce and the outcome KPI or safety invariant that prevents a smaller context
from being mistaken for a better result.

## Consequences

Positive:

- Banzai can identify which phase-owned category it controls instead of
  optimizing against a cumulative vendor token total.
- Failed and interrupted invocations retain the exact pre-call evidence needed
  for truthful cost and reliability analysis.
- Observation is backward-compatible, while enforcement is explicit,
  deterministic, local, and reversible.
- Mandatory requirements, decisions, verification, and review evidence can
  never be silently traded for a smaller prompt.
- Historical gaps remain visible as coverage, and the frozen evaluation
  contracts remain stable.
- Evidence can justify narrower follow-ups such as review-envelope reduction,
  per-role inventory policy, artifact compactness, or phase-owned workflow
  modules.

Negative:

- Two versioned contracts and a context configuration surface must be
  maintained.
- Prompt construction becomes more structured, and every new category must
  preserve exact-byte accounting.
- Attempt persistence gains a pre-call checkpoint and a post-call enrichment,
  increasing lifecycle cases and fixture volume.
- UTF-8 bytes are exact for the runner payload but are not vendor tokens and do
  not predict an ambient or resumed session prefix.
- Projects do not get a ready-made numerical budget until they have enough
  representative evidence to choose one responsibly.

Risks and follow-ups:

- Metadata can still become a privacy side channel if a future field admits
  free text, arbitrary paths, or prompt-derived hashes. The version-1 decoder
  must be a closed allow-list and privacy tests must reject such fields.
- Instrumentation could drift from the actual adapter payload. The adapter
  boundary must consume the envelope's rendered bytes directly, and tests must
  prove the recorded total equals those exact bytes.
- A configured enforcing budget can stop a run and reduce availability. The
  default remains observation, the error is pre-call and content-preserving,
  and the operator can revert the policy without a state migration.
- The baseline may show that vendor-owned tool or cache behavior dominates the
  runner payload. That is a valid result; a later vendor-specific decision must
  use reported inventory and live evidence rather than byte-to-token inference.
- Broad `WorkflowRunner` decomposition remains deferred until the report shows
  that phase ownership is a material context or maintenance bottleneck.

## Compliance and Confirmation

Implementation and review must confirm all of the following:

1. multi-byte UTF-8 fixtures prove that each component sum and runner-payload
   total equal the exact bytes passed to the adapter, not string length;
2. selection, plan, implementation, fix, review, review repair, fresh, resumed,
   success, vendor failure, timeout, interruption, and downstream-validation
   paths retain the correct invocation ledger and availability;
3. observe-mode regression fixtures prove byte-identical prompt and output
   schema payloads plus unchanged workflow, retry, recovery, gate, review, and
   outcome behavior;
4. enforce-mode tests prove `CONTEXT_BUDGET_EXCEEDED` is raised with closed
   metadata before an injected vendor runner starts and that no component is
   altered or omitted;
5. config tests cover absent configuration, selector precedence, duplicate and
   invalid limits, observation-only post-call thresholds, and no implicit
   default limit;
6. privacy fixtures containing secrets, personal data, absolute paths, tool
   arguments, and transcript text prove that neither context contract nor
   either renderer retains them;
7. deterministic report fixtures cover exact, partial, historical, malformed,
   and unsupported ledgers, stable category tie order, and byte-identical
   Markdown and JSON over identical inputs;
8. fixed evaluation fixtures prove `eval export` and `eval kpi` bytes and
   schemas are unchanged;
9. import-boundary tests or direct hand-built construction prove accounting,
   budget evaluation, report projection, and rendering do not depend on
   adapters, store, config, locks, or `WorkflowRunner`;
10. the committed bundle is rebuilt and `npm run verify`,
    `npm run release:check`, supported-Node lanes, and proportionate live
    compatibility evidence are reported separately and truthfully.

## Lifecycle Links

- Narrowly amended by
  [ADR-0052](./0052-orchestrator-capability-slice-architecture.md), accepted
  2026-09-28: lifts the deferral of broad `WorkflowRunner` decomposition in
  Risks and follow-ups. Context accounting and budget decisions are unchanged.
- Supersedes: None
- Superseded by: None
