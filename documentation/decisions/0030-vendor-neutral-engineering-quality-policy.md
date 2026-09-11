# ADR 0030: Vendor-Neutral Engineering Quality Policy

## Status / Date / Owner / Decision Makers

- Status: Accepted
- Date: 2026-08-26
- Owner: Banzai maintainers
- Decision makers: User, who approved the proposed design in principle and
  supplied the binding final corrections in chat on 2026-08-26

## Related Artifacts

- Feature description:
  `documentation/features/pragmatic-engineering-quality/description.md`
- Feature plan:
  `documentation/development-plans/pragmatic-engineering-quality/plan.md`
- Manifest: sections 3–6, 8–10 of `PROJECT_MANIFEST.md`
- Related ADRs:
  - ADR-0013, Risk-Driven Test Assurance: owns proportionate test selection and
    permits non-test evidence owners.
  - ADR-0014, Human-Triaged Review Closure: owns finding disposition and direct
    completion when no finding is accepted.
  - ADR-0019, Attempt-Owned Review Candidates: separates diagnostic candidate
    evidence from canonical review state.
  - ADR-0027, Exposure-Driven Security Assurance: establishes the single-policy
    and short-reference precedent without a new phase or contract.
  - ADR-0029, ESLint-Backed Orchestrator Import Boundary Policy: demonstrates
    that repository-specific dependency direction may be deterministic while a
    generic cross-repository architecture analyzer is not.

## Context and Decision Drivers

Banzai already protects requirements, accepted architecture decisions,
approved-plan scope, structured task completion, configured verification,
security exposure, evidence quality, independent review, human triage, and
accepted-only fixing. It also contains scattered maintainability guidance:
follow manifest conventions, keep code simple, avoid speculative layers,
preserve public contracts, reject hollow tests, and record deviations.

That guidance does not form a coherent technology-agnostic policy for changed
boundaries, dependency direction, important runtime collaborators, ingress
validation, error meaning, resource ownership, compatibility, or bounded legacy
evolution. Different model vendors can therefore make different implicit design
assumptions even when they obey the same specification and plan.

The gap does not justify another methodology. Banzai serves repositories with
different languages, frameworks, architecture styles, conventions, and legacy
constraints. Universal requirements for layers, interfaces, dependency
injection, directory structure, function size, control-flow style, or design
patterns would override repository authority and manufacture low-signal review
work.

The current plugin also has no vendor-neutral standalone policy loader. The
installed `plugins/banzai/CLAUDE.md` is already the common workflow-rule source,
and `plugins/banzai/AGENTS.md` includes it for agent-neutral delivery. Test
Assurance and Security Assurance use this surface successfully. Creating a new
subsystem only to avoid the filename would add delivery and drift complexity
without changing semantics.

The initial rollout must measure both overlap with findings Banzai already
emits and incremental useful concerns that Engineering Quality alone discovers.
At the same time it must not create verdict changes, fixer scope, triage burden,
or a premature machine contract before cross-model evidence shows that the
semantic shape converges.

Decision question: Should Banzai adopt a single vendor-neutral Engineering
Quality policy, projected through the existing discovery, planning,
implementation, review, triage, and resolution mechanisms, initially in
non-blocking shadow mode?

Decision owner: Banzai maintainers, with explicit user lifecycle approval.

Decision drivers:

- improve architecture, cohesion, coupling, boundary design, contracts,
  dependency handling, errors, resource lifecycle, maintainability,
  testability, and generated-code clarity without imposing a methodology;
- make cross-model behavior consistent enough to converge;
- preserve repository-local authority and approved intentional changes;
- reuse Test Assurance, Security Assurance, deterministic verification, review,
  triage, fixing, and evaluation instead of duplicating them;
- allow genuine incremental shadow discoveries while guaranteeing that they
  remain non-authoritative;
- avoid a new skill, phase, hook, gate, policy engine, analyzer, dependency,
  config surface, or contract version;
- defer enforcement until sampled evidence demonstrates stable, useful rules
  and fields.

## Options Considered

### Option 1: One policy projected through existing mechanisms, shadow first

Place one Engineering Quality policy beside the existing assurance policies in
`plugins/banzai/CLAUDE.md`. State explicitly that the policy is vendor-neutral
and the file is only its current storage and delivery surface. Add short
phase-specific references to existing skills and runner prompts. Map ordinary
findings to EQ through existing fields and carry additional shadow-only
candidates through an existing non-finding field for sampled evaluation.

- Benefits: smallest coherent change; one source of rule text; no phase or
  contract movement; both supported vendors receive the same semantics; genuine
  incremental candidates are measurable; existing human and runtime authority
  remains unchanged.
- Costs: every agent session pays for the policy text; `deferredCoverage` is a
  temporary semantic transport for shadow records; evaluation is initially
  sampled and partly manual.
- Risks: models may blur ordinary and shadow review or treat preferences as
  findings. Explicit freeze-order, actionability, deduplication, severity, and
  resolution rules constrain that risk.

### Option 2: Move the canonical policy to a new vendor-neutral plugin document

Add a new shared-reference loader or require every skill to locate and read a
new document under `plugins/banzai/documentation/` or a skill `references/`
directory.

- Benefits: the filename would communicate vendor neutrality directly.
- Costs and rejection reason: the plugin has no general shared-reference loader;
  a documentation template is not guaranteed phase context; putting the file
  under one skill would couple unrelated skills to that skill; duplicating it
  under each skill creates drift. Rejected for the first version because storage
  naming does not justify a new delivery subsystem. A later relocation remains
  possible without changing policy semantics.

### Option 3: Add an Engineering Quality skill or review phase

Create a dedicated planning or review skill, an additional reviewer call, or a
new decision gate.

- Benefits: quality work is visibly isolated and may use a specialized model.
- Costs and rejection reason: duplicates discovery and `feature-review`, creates
  late rework, adds model cost and lifecycle states, and introduces another
  place findings must converge. Rejected because the required information is
  already available in existing phases.

### Option 4: Introduce a first-class runtime finding contract and evaluator

Add EQ fields to review results, persist explicit shadow candidates, validate
their normalized shape, and export rule-level KPIs immediately.

- Benefits: deterministic parsing and automated metrics from the first run.
- Costs and rejection reason: field names, waiver provenance, deduplication, and
  useful severity semantics have not been validated across reviewers. This
  would freeze speculative design into a public versioned contract and expand
  validation, state, rendering, evaluation, and compatibility work. Rejected
  until shadow evidence supports a separate decision.

### Option 5: Keep the scattered guidance unchanged

- Benefits: no context or implementation cost.
- Costs and rejection reason: leaves boundary, lifecycle, compatibility, and
  cross-model convergence expectations implicit and prevents measurement of
  incremental EQ value. Rejected because it preserves the identified gap.

## Decision

Adopt Option 1.

### Canonical policy and delivery

Define exactly one `## Engineering Quality` policy in
`plugins/banzai/CLAUDE.md`. The policy is vendor-neutral. `CLAUDE.md` is only
its current storage and delivery surface, already included by the packaged
`AGENTS.md`; its filename grants no Claude-specific meaning. Policy language
must not depend on Claude tools, permissions, hooks, commands, session state, or
vendor behavior.

Every consuming skill and prompt references the canonical policy and states
only its phase-specific responsibility. It must not copy the complete ten-rule
set. Future Codex or other-vendor delivery may relocate or project the same
policy, but must not translate it into Claude-specific semantics. Do not create
a new loader or subsystem solely to rename the storage surface.

### Final ten rules

#### EQ-01 — Local authority and context

Follow approved requirements, accepted ADRs, executable and public contracts,
manifest facts, established invariants, and dominant repository conventions.
Deviate only when the task, an approved decision, or a concrete correctness,
security, lifecycle, or compatibility need requires it. Generic preference does
not override repository authority.

Always active. An objective conflict with approved authority may be actionable;
a merely different local style is not.

#### EQ-02 — Cohesive responsibilities and explicit boundaries

Keep changed responsibilities together when they share purpose, dependencies,
lifecycle, and verification needs. Separate them when those concerns materially
differ. Make important boundaries recognizable without arbitrary
fragmentation.

Contextual and advisory unless a concrete consequence independently violates a
stronger rule. It requires no function or file size, layer, service class, or
directory pattern and never creates a blocker by itself.

#### EQ-03 — Dependency direction and visibility

Do not introduce dependency edges that violate the repository's intended
dependency direction or unnecessarily couple stable logic to volatile
implementation details. Make important runtime dependencies and mutable
collaborators visible at an appropriate existing composition or usage boundary.

Contextual. It assumes no domain-centric architecture and requires neither
interfaces nor a dependency-injection container. A mechanically forbidden edge
or unapproved dependency may remain actionable under existing repository rules.

#### EQ-04 — Boundary contracts and ingress validation

At important public, process, network, persistence, filesystem, user-input, or
inter-module boundaries, make input, output, failure, and compatibility
semantics clear using repository-appropriate mechanisms. Validate external or
untrusted data at the first boundary where the system assumes it is trustworthy;
static types alone do not validate external bytes.

Contextual. A demonstrable contract, correctness, or security consequence may
be actionable under existing rules.

#### EQ-05 — Failure semantics and resource lifecycle

Preserve useful failure meaning, original causes, and diagnostic context. Do not
silently turn failure into success. For resources with lifecycle semantics,
identify ownership and proportionate cleanup behavior for success, failure,
cancellation, timeout, shutdown, and partial initialization where applicable.

Contextual. It requires no universal error hierarchy or resource-management
pattern. Reproducible data loss, leaks, hangs, swallowed failure, or violated
lifecycle contracts may remain actionable under existing rules.

#### EQ-06 — Proportional design

Prefer existing language, runtime, framework, platform, and project mechanisms
when adequate. Prefer straightforward control and data flow. Add an abstraction
or dependency only when it provides a concrete benefit such as isolating
volatility, enforcing a useful contract, removing meaningful duplication,
simplifying usage, or enabling necessary verification.

Always considered and advisory by default. It is not a ban on abstraction and
never creates a blocker by itself.

#### EQ-07 — Bounded change scope

Keep the change within the approved task, plan, or accepted-finding scope. Do
not bundle unrelated cleanup, migration, abstraction work, dependency changes,
or architecture refactoring unless required for correctness or explicitly
approved.

Always active. Objective scope expansion remains actionable through existing
approval, plan, baseline, and accepted-finding enforcement.

#### EQ-08 — Assurance ownership

Material claims introduced by a change must have an identifiable,
proportionate evidence owner. Reuse existing assurance mechanisms rather than
duplicating them. Test Assurance, Security Assurance, contract verification,
configured checks, or justified inspection may own evidence that compatibility
is preserved, malformed input is rejected, cancellation cleans up resources,
persisted data survives migration, or a failure remains observable.

Contextual. Engineering Quality detects missing assurance ownership; it does
not select tests, create a test quota, or require another test when equivalent
evidence already exists.

#### EQ-09 — Compatibility

Preserve public APIs, persisted formats, events, protocols, CLI behavior, and
other externally depended-on semantics unless an approved specification or ADR
intentionally changes them and defines the relevant migration consequences.

Contextual. A high-confidence unapproved breaking change may remain actionable
under existing contract, specification, or ADR authority.

#### EQ-10 — Incremental legacy evolution

When changing legacy code, prefer a bounded seam, adapter, characterization
evidence, staged migration, or similarly incremental path when it materially
reduces risk. Do not demand an incremental technique when a direct local change
is safer and simpler.

Contextual and advisory. It never creates a blocker by itself; a concrete scope
or compatibility consequence may be reported under `EQ-07`, `EQ-09`, or the
existing authority it violates.

### Authority precedence

Resolve conflicts in this order:

1. explicit approved user or specification decision;
2. accepted ADR;
3. executable or public contracts and established repository invariants;
4. repository manifest facts and dominant local conventions;
5. generic Engineering Quality preference.

Tests and observed behavior are evidence for these authorities, not an
independent authority tier. A legacy test does not automatically override an
approved change that intentionally changes behavior. When two remedies satisfy
the same higher authority, a reviewer may not require its preferred pattern;
the implementer chooses the smallest compatible remediation.

### Projection through the existing workflow

- Discovery records relevant repository facts and changed surfaces, not generic
  preferences or an audit of the entire legacy system.
- Requirements express only externally observable or otherwise testable quality
  constraints as ordinary FRs and acceptance criteria.
- Planning records only materially applicable rule IDs in existing breakdowns,
  task bodies, evidence ownership, deviations, and consistency mappings. It
  creates no mandatory ten-row checklist.
- ADRs use applicable rules as decision drivers. They do not convert a generic
  principle into a required architecture style.
- Implementation and lite workflows apply the policy to approved scope, use
  existing assurance owners, and record material deviations in existing reports.
- Independent review applies the ordinary review policy first, then records EQ
  overlap and shadow-only candidates under the semantics below.
- Human triage and accepted-only fixing remain unchanged. Shadow candidates are
  invisible to both.
- Resolution review follows the convergence invariant below. The current
  maximum fix-cycle policy remains the loop bound.
- Final acceptance remains existing deterministic completion validation,
  configured verification, independent review, and human triage. There is no
  separate EQ pass or gate.

### Semantic finding model

Treat the following as a semantic and evaluation model, not a versioned machine
contract: rule ID; severity; confidence; exact evidence and location; concrete
impact; smallest reasonable remediation; relevant requirement, ADR, contract,
manifest, or accepted-finding reference; verification method; deduplication
identity; and waiver state plus authority provenance when applicable.

An ordinary actionable finding continues to use the existing
`banzai-feature-review/v1` fields. It may carry exactly one primary `EQ-NN`
entry in `violates`; evidence and impact remain in `summary` and `evidence`, and
`fixAcceptance` states remediation and verification. Human triage remains the
waiver/disposition authority. No EQ-specific field becomes mandatory.

The semantic deduplication identity is:

`primary rule + stable code/contract locus + violated authority + impact class`.

Wording differences and line-number drift do not create a new identity. One
root cause with multiple evidence locations is one finding. Distinct observable
consequences that require independent remediation may remain separate.

Generic comments such as "consider SOLID", "extract a service", "this function
is too complex", or "use dependency injection" are not actionable without
exact evidence, a material current impact, applicable authority, the smallest
remediation, and observable verification.

### Shadow semantics

The reviewer completes the existing audit first and freezes the ordinary
findings, their severities, and the verdict. It may then:

1. add one primary `EQ-NN` mapping to the `violates` list of an ordinary finding
   that already qualifies without Engineering Quality; and
2. record a genuinely incremental EQ-only candidate as a prefixed
   `EQ-SHADOW:` string in the existing free-form `deferredCoverage` array.

Each shadow string should carry a review-local candidate ID and the semantic
fields above in a stable, human-readable form. This is an evaluation convention,
not a parser contract. The runtime does not validate, normalize, deduplicate,
accept, or promote it.

A shadow-only candidate:

- is not a `ReviewFinding` and does not enter `findings`;
- cannot affect verdict or the severity of any existing finding;
- receives no mandatory human disposition and cannot become accepted;
- is absent from the accepted-finding payload and fixer loop;
- cannot block completion or create another gate;
- is retained in the applied structured review result and canonical Markdown
  review artifact for sampled evaluation;
- remains non-authoritative even when its suggested severity is `blocker`;
- uses waiver state `not_applicable` with shadow provenance because triage does
  not apply.

Ordinary `deferredCoverage` entries remain valid. The `EQ-SHADOW:` prefix is the
only distinction during this stage. Do not change the v1 schema, runtime
validation, run state, or evaluation export to formalize it.

Shadow evaluation must measure both classification overlap and incremental
usefulness. Existing `banzai eval export` and `banzai eval kpi` select cohorts
and retain ordinary reviewer outcome metrics; sampled evaluators inspect the
canonical review artifacts for EQ details. A separate versioned export or
machine contract is not authorized by this decision.

### Resolution-review convergence

Resolution review is closure-oriented, not discovery-oriented. For a fix cycle,
its primary responsibility is to verify closure of every immediately preceding
accepted finding and report each accepted ID in `reviewedFindingIds`.

A new ordinary finding or shadow candidate may be created only when it is:

- introduced by the fix;
- newly observable because the changed evidence surface exposes it;
- a direct regression of another approved contract or established invariant;
- a previously unobservable critical correctness, security, or lifecycle issue.

The review must name the new evidence and a distinct deduplication identity. A
new stylistic opinion, preferred decomposition, or alternative design is
insufficient. Rejected or deferred findings must not be reopened against
unchanged evidence and authority. The same restriction applies after automatic
reviewer rotation: a fresh session does not reset durable authority or triage.

### Enforcement boundaries

The initial release adds no EQ-native runtime blocker. Ordinary deterministic
and review enforcement continues to own:

- approved artifact immutability, task and accepted-finding scope, baseline and
  changed-surface identity;
- dependency approval and repository-specific import policies;
- schema, contract, plan-task-completion, review-artifact, and report parity;
- configured verification and required material contract or safety evidence;
- existing spec, ADR, correctness, security, test, maintainability, and
  documentation findings;
- human disposition and accepted-only fixes.

The release validator may deterministically protect policy structure and
references: one canonical heading, rule IDs and selected invariant fragments,
vendor-neutral storage wording, required skill references, shadow isolation,
and resolution convergence. It must not decide cohesion, abstraction value,
dependency stability, remediation quality, or legacy strategy.

The blocker threshold for any later advisory or enforcement proposal is:
high confidence; exact current evidence; current material impact; a violated
approved authority, correctness, security, data-integrity, lifecycle-safety,
required-assurance, scope, or compatibility invariant; and observable closure.
`EQ-02`, `EQ-06`, and `EQ-10` never create blockers by themselves. This ADR does
not authorize future hard enforcement even when that threshold is met.

## Explicit Non-Goals

- no required early returns, maximum function or file size, repository pattern,
  service or use-case class, interface-per-dependency, or DI container;
- no mandated Clean Architecture, Hexagonal Architecture, DDD, functional
  programming, OOP, universal immutability, or universal purity;
- no generic naming, directory, or formatting policy that supersedes the
  repository;
- no new skill, model role, phase, hook, gate, state, config option, policy
  engine, static architecture analyzer, or dependency;
- no duplicate test-selection policy, observability platform, test quota, or
  coverage target;
- no new review-result, phase-result, state, evaluation, KPI, control, doctor,
  or context contract version;
- no automatic waiver, triage, finding acceptance, severity promotion, or fix;
- no repository-wide legacy audit or mandatory refactoring;
- no future advisory or hard-enforcement decision in this ADR.

## Consequences

Positive:

- supported model vendors receive one common, explicit engineering-quality
  vocabulary;
- local architecture and approved intent remain above generic preferences;
- boundary, dependency, failure, lifecycle, compatibility, and legacy concerns
  can enter planning early instead of appearing only as late review taste;
- ordinary findings can be classified for overlap without changing existing
  review semantics;
- genuinely incremental EQ candidates become measurable without creating human
  triage or fixer work;
- Test Assurance, Security Assurance, configured verification, contracts, and
  inspection remain the evidence owners they already are;
- closure-oriented re-review reduces cross-model style churn;
- no public or persisted machine contract changes.

Negative:

- the installed workflow policy and several skills grow, increasing context;
- `deferredCoverage` temporarily carries two semantic kinds distinguished only
  by a prefix;
- sampled evaluation requires human classification and cannot be derived from
  frozen evaluation export v1 alone;
- semantic rules depend on reviewer judgment and cannot guarantee consistent
  application;
- a policy stored in a file named `CLAUDE.md` needs an explicit neutrality note
  until delivery surfaces are reorganized.

Risks and mitigations:

- ordinary findings change because the reviewer sees the new policy: require the
  existing audit and verdict to be completed and frozen before EQ mapping and
  shadow discovery; compare existing reviewer KPIs during rollout;
- shadow records leak into triage or fixing: keep them out of `findings` and
  verify zero isolation violations in sampled runs and prompt tests;
- duplicate or reopened findings prevent convergence: use stable semantic
  dedupe identity, durable triage authority, and closure-oriented resolution
  rules;
- generic preferences become findings: require evidence, current impact,
  authority, smallest remediation, and verification; `EQ-02`, `EQ-06`, and
  `EQ-10` never block by themselves;
- the free-form shape drifts across models: measure field completeness and
  cross-reviewer disagreement before standardizing it;
- policy copies drift: enforce one heading and short consuming references in
  the existing release validator.

## Compliance and Confirmation

Implementation and review must confirm:

1. `plugins/banzai/CLAUDE.md` contains exactly one Engineering Quality policy
   with `EQ-01` through `EQ-10`, the authority order, vendor-neutral storage
   statement, shadow isolation, blocker boundary, and resolution invariant;
2. consuming skills reference that policy and do not reproduce all ten rules;
3. discovery, planning, ADR, implementation, lite, review, fix, and resolution
   responsibilities use existing skills and prompts;
4. an ordinary EQ mapping uses existing `violates`, while an incremental
   candidate uses prefixed `deferredCoverage` and never enters `findings`;
5. prompts and skill tests prove shadow candidates cannot alter verdict,
   severity, triage, fixer scope, or completion;
6. resolution review verifies accepted closure first and admits a new concern
   only under the four listed evidence conditions;
7. `EQ-02`, `EQ-06`, and `EQ-10` are explicitly non-blocking by themselves;
8. `plugins/banzai/contracts/**`, `packages/orchestrator/src/validation.ts`,
   state schemas, hooks, gates, configuration, dependencies, and evaluation/KPI
   contracts are byte-identical before and after implementation;
9. release validation fails on canonical-policy or reference drift without
   performing semantic source analysis;
10. the sampled evaluation procedure records overlap, incremental usefulness,
    duplicates, no-material-impact rejections, false positives, disagreement,
    shape completeness, and isolation violations alongside existing KPIs;
11. focused tests, `npm run release:check`, committed bundle parity, formatter
    check, and `git diff --check` pass.

## Deferred Decisions

- whether any EQ-only candidate should become an advisory `should_fix` or `nit`
  finding;
- whether selected objective EQ consequences should become blocker-eligible;
- whether the normalized semantic shape is stable enough for a new versioned
  review/triage or evaluation contract;
- whether shadow extraction and KPI projection should be automated;
- whether the canonical policy should move to a newly supported vendor-neutral
  delivery surface;
- whether a specific repository should adopt an additional static architecture
  rule, which remains a repository-local decision rather than a generic Banzai
  requirement.

Each promotion requires separate evidence and approval. In particular, this ADR
does not authorize future hard enforcement.

## Lifecycle Links

- Supersedes: None
- Superseded by: None
