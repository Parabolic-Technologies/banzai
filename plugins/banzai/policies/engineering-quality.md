# Engineering Quality

- Owner decision: ADR-0030
- Consumers: `feature-description`, `architecture-decision`, `development-plan`, `code-writing`, `feature-review`, `feature`, `quick-fix`, `project-manifest`; conditional: None
- Process source: the project `AGENTS.md` (authority order, escalation triggers, decision gates)

## Engineering Quality

This policy is vendor-neutral. The installed `policies/engineering-quality.md` is only its current storage and
delivery surface; the policy does not depend on Claude-specific tools,
permissions, hooks, commands, sessions, or behavior. Skills and prompts
reference this section instead of copying the complete rule set. Future Codex
or other-vendor delivery must preserve these semantics without interpreting the
filename as policy authority.

Apply the authority order in the project `AGENTS.md` before any generic quality preference. When two
remedies satisfy the same higher authority, use the smallest compatible
remediation rather than requiring a preferred pattern.

### EQ-01 — Local authority and context

Follow approved requirements, accepted ADRs, executable and public contracts,
manifest facts, established invariants, and dominant repository conventions.
Deviate only when the task, an approved decision, or a concrete correctness,
security, lifecycle, or compatibility need requires it. Generic preference does
not override repository authority.

Always active. An objective conflict with approved authority may be actionable;
a merely different local style is not.

### EQ-02 — Cohesive responsibilities and explicit boundaries

Keep changed responsibilities together when they share purpose, dependencies,
lifecycle, and verification needs. Separate them when those concerns materially
differ. Make important boundaries recognizable without arbitrary
fragmentation.

Contextual and advisory unless a concrete consequence independently violates a
stronger rule. It requires no function or file size, layer, service class, or
directory pattern and never creates a blocker by itself.

### EQ-03 — Dependency direction and visibility

Do not introduce dependency edges that violate the repository's intended
dependency direction or unnecessarily couple stable logic to volatile
implementation details. Make important runtime dependencies and mutable
collaborators visible at an appropriate existing composition or usage boundary.

Contextual. It assumes no domain-centric architecture and requires neither
interfaces nor a dependency-injection container. A mechanically forbidden edge
or unapproved dependency may remain actionable under existing repository rules.

### EQ-04 — Boundary contracts and ingress validation

At important public, process, network, persistence, filesystem, user-input, or
inter-module boundaries, make input, output, failure, and compatibility
semantics clear using repository-appropriate mechanisms. Validate external or
untrusted data at the first boundary where the system assumes it is trustworthy;
static types alone do not validate external bytes.

Contextual. A demonstrable contract, correctness, or security consequence may
be actionable under existing rules.

### EQ-05 — Failure semantics and resource lifecycle

Preserve useful failure meaning, original causes, and diagnostic context. Do not
silently turn failure into success. For resources with lifecycle semantics,
identify ownership and proportionate cleanup behavior for success, failure,
cancellation, timeout, shutdown, and partial initialization where applicable.

Contextual. It requires no universal error hierarchy or resource-management
pattern. Reproducible data loss, leaks, hangs, swallowed failure, or violated
lifecycle contracts may remain actionable under existing rules.

### EQ-06 — Proportional design

Prefer existing language, runtime, framework, platform, and project mechanisms
when adequate. Prefer straightforward control and data flow. Add an abstraction
or dependency only when it provides a concrete benefit such as isolating
volatility, enforcing a useful contract, removing meaningful duplication,
simplifying usage, or enabling necessary verification.

Always considered and advisory by default. It is not a ban on abstraction and
never creates a blocker by itself.

### EQ-07 — Bounded change scope

Keep the change within the approved task, plan, or accepted-finding scope. Do
not bundle unrelated cleanup, migration, abstraction work, dependency changes,
or architecture refactoring unless required for correctness or explicitly
approved.

Always active. Objective scope expansion remains actionable through existing
approval, plan, baseline, and accepted-finding enforcement.

### EQ-08 — Assurance ownership

Material claims introduced by a change must have an identifiable,
proportionate evidence owner. Reuse existing assurance mechanisms rather than
duplicating them. Test Assurance, Security Assurance, contract verification,
configured checks, or justified inspection may own evidence that compatibility
is preserved, malformed input is rejected, cancellation cleans up resources,
persisted data survives migration, or a failure remains observable.

Contextual. Engineering Quality detects missing assurance ownership; it does
not select tests, create a test quota, or require another test when equivalent
evidence already exists.

### EQ-09 — Compatibility

Preserve public APIs, persisted formats, events, protocols, CLI behavior, and
other externally depended-on semantics unless an approved specification or ADR
intentionally changes them and defines the relevant migration consequences.

Contextual. A high-confidence unapproved breaking change may remain actionable
under existing contract, specification, or ADR authority.

### EQ-10 — Incremental legacy evolution

When changing legacy code, prefer a bounded seam, adapter, characterization
evidence, staged migration, or similarly incremental path when it materially
reduces risk. Do not demand an incremental technique when a direct local change
is safer and simpler.

Contextual and advisory. It never creates a blocker by itself; a concrete scope
or compatibility consequence may be reported under the existing authority it
violates.

### Finding and shadow semantics

An actionable Engineering Quality concern must identify a primary rule ID,
severity, confidence, exact evidence and location, concrete impact, the smallest
reasonable remediation, relevant specification, ADR, contract, manifest, or
accepted-finding authority, a verification method, a stable deduplication
identity, and waiver state when applicable. Its identity is the primary rule,
stable code or contract locus, violated authority, and impact class; wording or
line-number drift does not create a new concern. Generic design preference
without exact evidence and material impact is not actionable.

In initial shadow mode, complete the ordinary review first and freeze its
findings, severities, and verdict. An ordinary finding that already qualifies
without Engineering Quality may add exactly one primary `EQ-NN` mapping to its
existing `violates` list; the mapping cannot create the finding or change its
severity or verdict. A genuinely incremental EQ-only candidate may be recorded
only as an `EQ-SHADOW:` string in existing free-form `deferredCoverage`. It is
not a finding, receives no mandatory human triage, cannot be accepted, never
enters fixer scope, and cannot affect severity, verdict, completion, or any
gate. Its suggested severity remains non-authoritative, and its waiver state is
`not_applicable` because triage does not apply. Ordinary deferred-coverage prose
remains valid. In reviewer-write mode, copy every structured `EQ-SHADOW:` record
byte-for-byte into the canonical Markdown Deferred Coverage section;
runner-rendered mode already projects the structured value. This retention rule
does not parse or validate the record. The human-readable shape is an evaluation
convention, not a runtime parser or versioned contract.

Resolution review is closure-oriented, not discovery-oriented. It first
verifies every immediately preceding accepted finding ID. A new finding or
shadow candidate is permitted only when introduced by the fix, newly observable
because the changed evidence surface exposes it, a direct regression of another
approved contract or established invariant, or a previously unobservable
critical correctness, security, or lifecycle issue. Name the new evidence and a
distinct deduplication identity. A stylistic opinion, preferred decomposition,
or alternative design is insufficient. Rejected or deferred findings must not
reopen against unchanged evidence and authority, including after reviewer
rotation.

### Enforcement boundaries

The initial release adds no EQ-native runtime blocker. Existing objective
approval, contract, scope, dependency, verification, correctness, security,
test, lifecycle, compatibility, review, and triage mechanisms retain their
current enforcement and severity. `EQ-02`, `EQ-06`, and `EQ-10` never create
blockers by themselves.

Any later blocker-eligibility proposal must require high confidence, exact
current evidence, current material impact, a violated approved authority,
correctness, security, data-integrity, lifecycle-safety, required-assurance,
scope, or compatibility invariant, and observable closure. Meeting this
threshold does not authorize hard enforcement; a separate approved decision is
still required.

Engineering Quality adds no phase, skill, hook, gate, test quota, architecture
methodology, static analyzer, or runtime contract.
