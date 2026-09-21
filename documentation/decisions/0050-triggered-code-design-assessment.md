# ADR 0050: Triggered Code-Design Assessment

## Status / Date / Owner / Decision Makers

- Status: Accepted
- Date: 2026-09-18
- Owner: Banzai maintainers
- Decision makers: Project owner; explicitly accepted in chat on 2026-09-19.
- Accepted proposal SHA-256:
  `eb565fd7ffffb063754e2625e5726775a9efb982539d57bf1e7e7ab88a22f788`.
- Review: five proposal review iterations resolved F1–F6; the final resolution
  review passed the accepted proposal without findings. Reviews are recorded in
  private work artifacts and were not an independent runner lineage.
- Amends: ADR-0030 (Vendor-Neutral Engineering Quality Policy)

## Related Artifacts

- Research:
  - [Preventing AI-generated structural debt](../ideas/2026-09-18-preventing-ai-generated-structural-debt.md)
  - [Composable code design for Banzai skills](../ideas/2026-09-18-composable-code-design-skill.md)
  - [Code-design method budget draft](../ideas/2026-09-18-code-design-method-draft.md)
- Manifest: sections 3, 5, 9 and 10 of `PROJECT_MANIFEST.md`.
- Related ADRs:
  - ADR-0030 owns the Engineering Quality rule set, authority order, shadow
    semantics and enforcement boundaries that this decision narrowly amends.
  - ADR-0028 owns phase context accounting and budgets for delivered bytes.
  - ADR-0036, as amended by ADR-0040/0041, owns installed policy files, relative
    standalone resolution and fail-closed source availability.
  - ADR-0038 owns Plan Authority: unlabelled explicit plan directives are binding.
  - ADR-0041 owns artifact storage roles; this decision adds none.
  - ADR-0042 owns runner-delivered phase instructions, the guidance resource
    inventory and the eleven-skill extraction history.
  - ADR-0043 and ADR-0049 own verification evidence and task-scoped
    verification, which stage 2b checks must reuse.
  - ADR-0044 owns authorized instruction-baseline transitions.
  - ADR-0029 owns this repository's import-boundary policy; it is unchanged.

## Context and Decision Drivers

Current state: Engineering Quality describes cohesion and proportional design,
but EQ-02 and EQ-06 are advisory and never block by themselves, EQ-only concerns
remain shadow observations, and ADR-0030 excludes new skills, methodologies and
analyzers. Planning, implementation and lite guidance ask for the "smallest
compatible" design, implementation or remediation, and EQ-07 excludes bundled
architecture refactoring. No shared procedure tells a planner or implementer
when to assess code structure, how to find the current owner of a behavior, or
where to record the outcome.

Scope and approval constraints, by contrast, are enforced strongly. The
combination creates a plausible incentive to append logic to an existing large
component rather than plan its decomposition. The motivating inspection found
`packages/orchestrator/src/workflow.ts` at roughly 13,000 lines, most of it one
`WorkflowRunner` class combining approval, phase execution, verification,
review, completion publication and recovery, in a repository whose manifest
states one responsibility per source module. This example motivates testing the
gap between available information and consistent design practice. It does not
prove that missing triggers caused the debt or that a method will fix it.

Target state: structural quality becomes an explicit, triggered responsibility of
the planner and implementer in both standalone and runner execution. Review
verifies obligations and remains the backstop, not the first place where module
design is considered. Success means less concentration of independently changing
responsibilities, fewer competing implementations of the same rule, and narrower
shared-state access in changed code; producing assessment records alone is not
success. Existing concentration debt still needs separately scoped remediation.

Decision question: Should Banzai adopt named structural-assessment triggers and a
shared code-design method, delivered through existing skills and runner phases
with conditional assessment records, followed by numeric-trigger coverage
checks and a conditionally authorized public `code-design` entry point, by
narrowly amending ADR-0030's boundaries?

Decision owner: Banzai maintainers, with explicit user lifecycle approval.

Decision drivers:

- make ownership, boundary, dependency and effect decisions before dependent
  code changes, where they are cheapest to correct;
- deliver identical duties to standalone skills and runner phases, including
  lite `feature` and `quick-fix` work, without relying on the orchestrator;
- preserve repository authority, approved scope, human gates, reviewer
  independence and ADR-0030 shadow semantics;
- avoid metric gaming: arbitrary extraction, pass-through layers, or passing a
  whole coordinator or universal mutable context into extracted code;
- keep added instruction bytes small and measured under ADR-0028;
- introduce no new phase, model role, reviewer call, lifecycle state, human gate,
  artifact role or completion contract;
- stage deterministic checks separately so the method's benefit does not wait
  for language adapters.

## Options Considered

### Option 1: Keep ADR-0030 boundaries unchanged

- Benefits: no new instruction bytes, resources or validation work.
- Costs and rejection reason: retains advisory-only structural guidance, the
  minimal-diff reading of "smallest compatible" and no trigger or record. The
  observed concentration shows that existing guidance does not reliably produce
  consistent design practice. Rejected because it preserves the gap.

### Option 2: Numeric gates only

Add size, nesting and complexity limits or a CI ratchet without a design method.

- Benefits: deterministic and cheap to check.
- Costs and rejection reason: invites gaming by arbitrary extraction and wide
  context objects; does not identify state ownership, lifecycle or dependency
  direction; universal thresholds would override repository authority. Rejected
  as the sole remedy. Project-configured measurements trigger assessment at
  stage 2a; stage 2b automates coverage checks.

### Option 3: Copy the method into each consumer's guidance

- Benefits: no new guidance resource or inventory change.
- Costs and rejection reason: four or more drifting copies and more total bytes
  than one shared resource. Rejected because one owner of the method is required.

### Option 4: Public skill as the primary delivery mechanism

Add `code-design` first and have other skills invoke it.

- Benefits: visible entry point for engineers.
- Costs and rejection reason: runner phases do not load skills (ADR-0042); skill
  invocation is host-specific and cannot be the reuse contract; the benefit
  would wait for catalogue, parity and publication work. Rejected as the primary
  mechanism; retained as a conditional later entry point.

### Option 5: Dedicated design phase, reviewer call or design gate

- Benefits: isolated design work, possibly with a specialized model.
- Costs and rejection reason: the reasons ADR-0030 gave for rejecting its
  Option 3 still hold for a phase or gate. Rejected.

### Option 6: Selective section loader now

Add `conditionalGuidance` or a dynamic loader so phases receive only their
sections.

- Benefits: potentially fewer delivered bytes.
- Costs and rejection reason: today section anchors express consumer duties but
  runner delivery sends whole resource bodies; a loader is a new delivery
  subsystem, the concern behind ADR-0030 Option 2. Rejected until measured cost
  justifies a separately designed change.

### Option 7: Triggered shared method with staged checks and conditional entry point

The selected option, detailed under Decision.

- Benefits: one method owner; duties reach standalone and runner work; design is
  visible at plan approval or before lite edits; records create evidence without
  a new contract; deterministic coverage arrives per stack without blocking the
  method.
- Costs: about 2 KB more instruction text in five runner phases on every call;
  semantic triggers rely on agent judgment until review; stage 2b adds a checker,
  adapters and versioned contracts; stage 3 adds a twelfth skill.
- Risks: over-triggering, relabelling preferences as binding obligations, stale
  assessments and budget overrun. Decision rules and confirmation below
  constrain them.

### Revisiting ADR-0030 Options 2 and 3

| ADR-0030 rejection reason                | Response under this decision                                                                                                                                   |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Duplicate discovery and `feature-review` | Existing planning and implementation apply the method to context they already gather and reuse applicable assessments. No additional automatic discovery pass. |
| Late rework                              | Assessment happens before dependent code changes, with bounded reassessment on new evidence. It aims to reduce, not eliminate, late redesign.                  |
| Additional reviewer or model cost        | No additional reviewer call or model session. Extra reasoning and prompt bytes remain and must be measured against review and fix savings.                     |
| More lifecycle states or gates           | Assessments return to the current workflow, which keeps its state, scope, approval and completion boundaries. The later entry point adds no runner phase.      |
| Another convergence point for findings   | The method produces assessments, not findings. Existing review and human triage keep finding authority.                                                        |
| Information already available            | Premise kept. The decision tests whether explicit triggers, a bounded method and retained outcomes improve use of that information.                            |
| Option 2: new loader and delivery cost   | No loader is added. The ADR-0042 system already delivers relative standalone guidance and embedded runner resources; this decision reuses it.                  |

## Decision

Adopt Option 7.

### 1. Structural Assessment Triggers

Add one named section, `Structural Assessment Triggers`, to the installed
Engineering Quality policy. It is an obligation owner, not a new `EQ-NN` rule;
EQ-01 through EQ-10 and their meanings are unchanged. Consumers link this
section and never copy its trigger list.

- Semantic triggers, active from stage 2a: a change adds a state-machine state or
  transition, an execution phase, a resource lifecycle, a mutable-state owner or
  a dependency across subsystem boundaries; adds an independently changing
  responsibility; or copies or near-duplicates an existing implementation of
  the same behavior. A responsibility is independent when its reason to change,
  collaborators, lifecycle or verification materially differs from its proposed
  host's. These triggers include pure computations and same-subsystem changes.
- Reuse-search duty, active from stage 2a: before adding a helper or rule
  implementation, search for existing owners by behavior and symbol names.
  Cite matches considered or the bounded search scope with no match in one line
  of the caller's existing artifact; if no artifact is otherwise required, use
  the final chat report. This duty alone creates neither a full assessment nor
  a lite pre-edit summary or new artifact. A match showing copying or semantic
  near-duplication, an independent responsibility, or another trigger requires
  the full assessment. Similar syntax alone is not semantic duplication. Merely
  calling an existing helper does not by itself trigger either duty.
- Numeric triggers, active from stage 2a: changed executable code in a function,
  class or file exceeds a size, nesting, complexity or member-count threshold
  adopted in the target project's configuration and executed by its verification.
  Warning and error signals both require assessment, even with unchanged
  ownership and dependencies and without a Banzai adapter. Treat those configured
  values as project authority; invent no universal thresholds. Without an adopted
  threshold, measurements remain advisory for this duty. Missing or failed
  measurement of an adopted threshold is unknown coverage, not advisory status
  or a pass. Stage 2b automates trigger-to-record coverage, not duty activation.
- Only a non-executable edit that meets no semantic trigger, such as formatting,
  comments or documentation text, is exempt. Preserving externally observable
  behavior never waives a trigger: a behavior-preserving extraction that creates
  an owner or changes a subsystem dependency is assessed.
- An applicable prior assessment satisfies a triggered duty by reference while
  the relevant responsibility and dependencies remain unchanged. Reuse never
  suppresses trigger detection.

A trigger requires analysis before dependent code changes, not a new human
gate. Use applicable baseline check evidence before edits and refresh it through
the task's authorized verification. A newly exposed threshold crossing requires
assessment and any needed correction before completion; late discovery is not
a waiver, and this rule grants no additional command-execution authority. It does not expand ADR eligibility or the existing escalation triggers,
which retain their decisions where a change overlaps them. Existing project hard
limits, required checks and approved invariants keep their authority
independently of this rollout.

### 2. Shared code-design method

Add `plugins/banzai/guidance/code-design.md` as the single method owner, with
four stable sections in this order: `Ownership Discovery`, `Assessment
Contract`, `Planning Assessment` and `Implementation Assessment`. The method
covers owner discovery through the manifest, symbol references and import edges;
grouping by reason to change, state, lifecycle and verification; preference for
existing owners; separation of pure decisions from effects only when read
timing, failure and resource ownership are preserved; and rejection of
extraction that passes a whole coordinator or shared mutable context.

Ownership Discovery also serves the lightweight reuse-search duty. The remaining
method and full record apply only when an assessment trigger holds.

For triggered work, the method must produce these outcomes before dependent
edits and verify them against the resulting code:

- Identify the owner of each changed responsibility and the relevant existing
  implementations and callers. Search by behavior as well as symbol names before
  adding a helper or rule; cite matches considered or the bounded search with
  no match. Similar syntax alone does not establish a shared responsibility.
- Keep one implementation owner for the same rule unless a concrete contract,
  dependency, lifecycle or compatibility constraint requires separation. Name
  that constraint and the divergence risk for an intentional duplicate.
- Give an independently changing responsibility an explicit boundary; appending
  it to an overloaded owner requires the retention rationale below. Do not
  broaden shared mutable access or expose a coordinator merely to shorten files.
- State task-specific ownership, reuse and effect invariants and verify them
  against source. File count, line reduction and record presence are not proof.

`retained` must explain why the existing boundary fits the changed responsibility,
what coupling or duplication the change adds or avoids, and why the smallest
plausible extraction or reuse is less suitable. A smaller diff, passing behavior
tests or legacy precedent alone is insufficient. Where a scope or compatibility
constraint prevents improvement, name the remaining debt and constraint; do not
claim structural improvement or waive an obligation. Escalate an actual authority
conflict through the existing workflow. No repository-wide cleanup is required.

The budget is a binding ceiling of 2,400 UTF-8 bytes for the whole file. Line
count is a readability guide of about 40 lines. An over-budget draft is
compressed; its content must not move into another always-delivered resource,
and required duties must not be dropped. Raising the ceiling requires a new ADR.
Review verifies compliance with the ceiling and cannot grant another. Direct
consultation, save and handoff instructions belong to the stage 3 entry point,
not to this resource.

Consumers use the established `Read and apply` convention with explicit section
anchors and name the common sections they require:

| Consumer                                                  | Sections                                                            |
| --------------------------------------------------------- | ------------------------------------------------------------------- |
| `development-plan`; runner planning                       | Ownership Discovery, Assessment Contract, Planning Assessment       |
| `code-writing`; runner implementation                     | Ownership Discovery, Assessment Contract, Implementation Assessment |
| `feature`, `quick-fix`; runner feature, fix and quick-fix | All four                                                            |
| `project-manifest` (explicit invocation only)             | Ownership Discovery                                                 |
| `test-writing`, `feature-review`; runner review           | None                                                                |

Add `code-design` to the runner guidance lists of the planning, implementation,
fix, feature and quick-fix phases after their existing guidance. The review phase
does not receive it. A missing or unreadable required source stops the affected
work, as for existing guidance.

Read "smallest compatible" in the Engineering Quality authority order and in
planning, implementation, feature and fix guidance as the simplest compatible
resulting design, weighing maintenance cost; diff size alone is not the measure.
Under EQ-07, decomposition recorded in approved plan or work scope is explicitly
approved, and private restructuring within approved behavior, affected scope and
write authority is not unrelated refactoring. Unrelated refactoring remains out
of scope.

### 3. Conditional assessment records

When a trigger applies, retain one short assessment in the caller's existing
permitted artifact: the strict plan and implementation report, lite `work.md`,
or the quick-fix change report produced for triggered work. Runner routes use
their existing role artifacts. The record states the trigger, affected container
and evidence; owner, collaborators, effects and allowed dependency direction; a
disposition of `reused`, `extracted` or `retained` with the section 2 evidence
and rationale, including reuse-search results and any intentional duplication;
invariants and how each is verified; and the authority outcome.

Before triggered lite edits, show a brief chat summary of owner, boundary,
dependencies and disposition. This is visibility, not an approval request. A
retained assessment is input, not approval, and is revalidated against current
source before reuse. A `retained` disposition never waives a binding obligation
or hard limit. Search-only work retains just the one-line citation from section 1;
untriggered work gains no new artifact duty. Add no artifact role,
`taskCompletion` field or completion schema version.

### 4. Binding obligations through Plan Authority

When a trigger applies during strict planning, put concise owner, boundary and
effect invariants in the human-facing plan summary and as unlabelled task
constraints, which ADR-0038 makes binding. Write invariants over ownership,
allowed effects, dependency direction and observable behavior, not private file
layouts; name exact paths or signatures only when a concrete constraint requires
them. Include needed extraction and its documentation or policy updates in
scope. Obligations need a real design rationale, never a relabelled preference.
Never retrofit obligations into approved plans.

The section 2 assessment duties also apply in triggered standalone lite work: capture concrete
invariants in `work.md` or the triggered fix report before dependent edits and
check the resulting code against them. These are implementation commitments
under existing task authority, not human-approved plans. Material design
changes require reassessment; a record cannot authorize an existing escalation
or silently erase an obligation after a failure.

A violation of an approved obligation is an ordinary plan-conformance finding.
ADR-0030 shadow semantics are unchanged: EQ-only observations stay shadow, and
EQ-02, EQ-06 and EQ-10 never block by themselves.
Missing required searches (including search-only citations) or rationale, source evidence contradicting the
assessment, and violations of applicable explicit invariants are auditable
obligation failures under this amendment. Findings still need exact evidence,
concrete impact and observable closure through existing review and triage;
there is no automatic structural blocker or finding merely because a reviewer
prefers another decomposition. These duties do not promote general cohesion
preferences out of shadow mode.

### 5. Review audit duty

Add a minimal audit duty to `guidance/review.md`: determine which assessment
obligation applies, inspect the record and its source identity, check available
coverage evidence, check section 2 outcome evidence and rationale, and verify
applicable invariants against code. Review guidance names the required search,
retention and source-conformance evidence without embedding the authoring
procedure. An assessment's presence does not prove cohesion, and missing coverage
is not a pass. A metric without an adopted project threshold creates no numeric
duty; a missing Banzai adapter never waives an existing duty. Review never receives the
design-authoring method. Resolution-review convergence is unchanged.

### 6. Numeric-trigger coverage (stage 2b)

Authorize one plugin-local, language-neutral coverage checker with explicit
project adapters. Standalone skills call its packaged entry point; runner host
code calls the same logic and owns the evidence. Orchestrated model phases never
invoke the standalone helper. Bound standalone work routes checks through
existing verification (ADR-0043/0049); a triggered quick-fix without a binding
passes explicit source, configuration and report inputs.

The checker joins a measured trigger inventory to assessment records bound to a
source snapshot, including moved or removed containers. A missing adapter,
parser, baseline, metric or record, or a stale or failed run, yields incomplete
or failed evidence, never a pass. Numeric assessment duties already apply under
section 1 at stage 2a, using project verification output and source inspection.
Activate mandatory automated coverage per stack and metric only with a supported
checker. Lack of that adapter does not defer the assessment duty; once automated
coverage is required, a failure never returns it to advisory status. No parser is bundled,
installed or globally discovered, and no project configuration is rewritten.
The checker proves numeric-trigger coverage only; it cannot certify ownership,
deduplication, retention rationale or structural quality. Semantic trigger and
outcome checks remain source-based planning, implementation and review duties.

Stage 2b may add newly versioned plugin-local contracts for the checker's
request, result and in-report record grammar. Existing contract versions,
including `taskCompletion`, phase-result, review-result and work-binding
schemas, remain unchanged.

### 7. Conditional public entry point (stage 3)

Authorize a twelfth discoverable skill, `code-design`, only when all of these
conditions, fixed before results are observed, are met:

1. stage 2a has shipped and its evaluation covers standalone strict, `feature`,
   `quick-fix` and runner work, with a positive outcome against the predeclared
   section 9 criteria, not merely complete records;
2. a bounded, unreleased prototype produced at least three direct consultations
   on distinct real targets, and at least two handoffs were consumed by strict
   planning or a quick-fix after source revalidation;
3. the prototype never edited application source, wrote without an
   engineer-supplied destination, or bypassed `architecture-decision` routing;
4. the added selection and instruction cost has been measured.

Maintainers record that the conditions are met through the stage 3 plan approval
and its independent review. An agent must not self-certify them. If they are not
met, retain the shared method without expanding the catalogue; a different
entry-point design requires a new ADR.

The entry point is source-read-only. Its instructions live in
`skills/code-design/SKILL.md`, which runner phases do not load. Output stays in
chat unless the engineer requests persistence and supplies a destination; it
creates no artifact role and never assumes a `documentation/` location. An
ADR-eligible question names `architecture-decision` as the next skill.
Substantial refactoring hands off to `feature-description` and
`development-plan`; a bounded refactor may hand off to `quick-fix`. It never
implements, approves or completes work. Its description must separate
code-structure proposals within existing constraints from architecture
decisions.

The stage 3 change updates the skill inventory, adapter required-skill list,
release consumer checks, installed-resource parity and publication
classification. ADR-0042's eleven-skill extraction scope remains historical
evidence.

### 8. Delivery order and authority

Deliver in this order:

| Stage | Scope                                                                                                                    |
| ----- | ------------------------------------------------------------------------------------------------------------------------ |
| 1     | This ADR, followed by approved work scope for the policy section, wording reconciliation and review audit duty.          |
| 2a    | Shared method, tiered reuse search, semantic/project-numeric duties and conditional records in skills and runner phases. |
| 2b    | Automated trigger-to-record coverage, activated per supported stack and metric.                                          |
| 3     | Public `code-design` entry point, only under section 7.                                                                  |
| 4     | Selective section delivery. Not authorized here; requires a separate decision backed by measured context cost.           |

Stage 2a must not wait for stage 2b, and stage 3 may follow stage 2a without
additional adapters. Each instruction change is an ADR-0044 transition that cites
this ADR as its public authority, with exact text approved in its plan. ADR-0028
budgets apply to every delivered byte; required instructions are never
truncated. Changing packaged `AGENTS.md` bootstrap templates is not a delivery
mechanism for these duties.

### 9. Outcome evaluation and bounded legacy pilot

Before observing pilot results, the approved evaluation scope fixes comparable
tasks, source baselines, execution modes, a structural-concern rubric and
decision criteria for benefit versus added effort. Compare current practice
with stage 2a, then stage 2a with stage 3; identify stage 2b separately. Assess
source changes using the same rubric for shadow and ordinary observations:

- newly concentrated independent responsibilities and their actual owners;
- competing implementations of the same rule, distinguishing justified
  separation from avoidable duplication;
- changes in shared mutable access and dependency coupling;
- concentration of privately owned types in shared contract/type modules,
  assessed against their actual owners and consumers; a repository-mandated
  shared types module is not itself a regression or grounds to override that
  convention;
- structural rework after first review, fix cycles and total reasoning/review
  effort, including pre-edit assessment cost.

Use changed responsibilities/tasks as comparison units and report sample counts,
task differences, regressions and uncertainty. Lines and complexity locate
hotspots; they are not standalone quality scores. Record compliance and checker
coverage are process measures, reported separately from code outcomes. No
improvement, excessive cost or insufficient evidence requires revising or
extending the pilot; it cannot be presented as demonstrated effectiveness or
used to qualify stage 3.

Include one separately authorized, bounded legacy-hotspot refactor to test that
the method can guide an actual extraction or consolidation while preserving
behavior. Capture before/after ownership, reuse, state access and relevant
behavioral evidence. It complements comparable feature/fix tasks rather than
substituting for them: one successful extraction does not demonstrate prevention. Selection,
scope and any repository boundary changes belong to its own approved work;
this ADR does not authorize editing `WorkflowRunner` or any client project.

### Amended decisions

| Decision                          | Change                                                                                                                                                                                                                                                                                                   | Preserved                                                                                                                                   |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| ADR-0030                          | Its no-skill, no-methodology and no-analyzer boundaries admit sections 1–9, including triggered outcome duties and their evidence requirements. The authority-order phrase "smallest compatible remediation" means the simplest compatible resulting design. EQ-07 receives the section 2 clarification. | Ten rules, authority order, finding model, shadow semantics, resolution convergence, blocker threshold, and no mandated architecture style. |
| ADR-0036, as amended by 0040/0041 | The Engineering Quality policy gains one named section.                                                                                                                                                                                                                                                  | Six-policy layout, relative resolution, consumer matrix and fail-closed availability.                                                       |
| ADR-0042                          | Adds the `code-design` guidance resource to five phase lists; stage 3 adds one discoverable skill.                                                                                                                                                                                                       | Composition order, whole-body delivery, cross-vendor text parity, review guidance boundary and the historical extraction scope.             |

## Explicit Non-Goals

- no universal size, complexity or member-count thresholds, and no mandated
  Clean Architecture, DDD, layering, DI container or directory layout;
- no new runner phase, model role, reviewer call, lifecycle state, human gate or
  escalation trigger;
- no new artifact role, `taskCompletion` field or completion schema version;
- no promotion of EQ-only observations to findings and no change to shadow
  semantics;
- no retrofitting of approved plans, repository-wide legacy audit or mandatory
  refactoring;
- no dynamic guidance loader or `conditionalGuidance` field;
- no bundled parser or new runtime dependency;
- no `code-refactoring` skill;
- no decision about refactoring Banzai's own `WorkflowRunner`, reconciling its
  manifest wording, or child import boundaries under ADR-0029; these remain
  repository-local follow-ups.

## Consequences

Positive:

- design decisions surface before dependent code, where correction is cheapest;
- one method owner serves standalone and runner work identically;
- plan approval exposes owner and boundary invariants, and lite work shows them
  before edits;
- conditional records make structural decisions reviewable without a new
  contract;
- deterministic numeric coverage arrives per stack without delaying the method;
- engineers may later request structural analysis directly.

Negative:

- every call of five runner phases carries up to 2,400 additional bytes,
  including retries and recovery;
- in stage 2a semantic triggers and numeric trigger-to-record matching depend
  on agent judgment and project verification evidence, with review as backstop;
- standalone skills cannot guarantee that an agent invokes the stage 2b checker;
- stage 2b adds a checker, adapters and new versioned contracts to maintain;
- a twelfth skill widens the selection surface.

Risks and mitigations:

- over-triggering or false escalations: explicit exclusions, reuse of applicable
  assessments and measured trigger rates;
- metric gaming: the method forbids arbitrary extraction and passing whole
  coordinators or shared mutable context;
- preferences relabelled as binding obligations: obligations need a design
  rationale and remain subject to plan approval;
- stale assessments: mandatory revalidation against current source;
- budget overrun: a binding byte ceiling that only a new ADR can raise;
- misattributed evaluation: separate comparisons per stage and execution mode.

Required follow-ups:

- approved stage 1 and 2a work for policy, guidance, consumer and baseline
  changes;
- separate stage 2b planning for checker contracts and the first adapter;
- a repository-local decision on Banzai's own concentration debt and manifest
  wording, and separately approved scope for the bounded legacy pilot in
  section 9.

## Compliance and Confirmation

Implementation and review must confirm:

1. The Engineering Quality policy has exactly one
   `Structural Assessment Triggers` section with semantic triggers, the numeric
   activation rule and exclusions. EQ-01 through EQ-10, shadow semantics and the
   blocker threshold are unchanged apart from the enumerated amendments. The
   exemption covers only a non-executable edit that meets no semantic trigger,
   such as a formatting- or comment-only edit. A behavior-preserving extraction
   that creates an owner or changes a subsystem dependency is assessed. Changed
   executable code above an active numeric threshold requires an assessment even
   with unchanged ownership and dependencies. Configured project warning/error
   signals activate this duty at stage 2a without a Banzai adapter; measurements
   without an adopted threshold stay advisory. Missing measurement of an adopted
   threshold is unknown coverage, not a waiver. Reuse of an applicable record satisfies a duty without
   suppressing trigger detection.
   Routine helper creation requires only a reuse-search citation unless another
   trigger applies. Copying or semantic near-duplication and a new independent
   responsibility require a full assessment at stage 2a even without state,
   lifecycle, cross-subsystem or numeric changes. Existing-helper use alone
   remains untriggered.
2. "Smallest compatible" wording in the policy and in planning, implementation,
   feature and fix guidance distinguishes the resulting design from diff size,
   and the EQ-07 clarification is present.
3. `guidance/code-design.md` has exactly the four sections in order, measures
   2,400 UTF-8 bytes or less with no review-time exception, reports its line
   count, and copies no trigger definitions.
4. Consumers reference the specified section anchors; runner planning,
   implementation, fix, feature and quick-fix phases embed the resource; review
   does not; per-phase delivered byte deltas are measured within ADR-0028 budgets.
5. Instruction changes pass ADR-0044 transition validation citing this ADR, the
   historical root stays unchanged, and `npm run release:check` passes.
6. Stage 2a acceptance uses an installed plugin in an adopted project without the
   orchestrator, covering strict, `feature` and `quick-fix`: semantic and configured
   numeric triggers, pre-edit summaries, conditional records and no new artifacts
   for search-only or untriggered work,
   plus equivalent runner behavior. Include pure-rule duplication, independent
   responsibility, justified retention and unjustified retention cases. Include a
   routine private formatting helper with one search citation and no full record
   or pre-edit summary, plus a report-free quick-fix using a chat citation. Inspect
   reuse-search evidence, resulting owners and invariant conformance, including
   lite work; a filled record with contradictory source or only a small-diff
   rationale fails the applicable duty. Include growth beyond a configured warning
   threshold without a semantic trigger: project check evidence requires an
   assessment without an adapter. Verify no-threshold advisory and missing-check
   unknown cases. Stage 2a claims no automated trigger-to-record coverage.
7. At stage 2a, `plugins/banzai/contracts/**` and the completion, phase-result,
   review-result and work-binding schemas are byte-identical.
8. Stage 2b acceptance shows equivalent standalone and runner coverage decisions
   for supported inputs, incomplete results for missing, stale, moved-container,
   parser-failure and unsupported-stack cases, a triggered quick-fix without a
   binding, and no model-phase invocation of the standalone helper.
9. Stage 3 lands only with recorded section 7 evidence; the entry point is
   source-read-only, never writes without a supplied destination, routes ADR
   questions to `architecture-decision`, and updates inventory, parity and
   publication checks.
10. Evaluation keeps two comparisons: current practice versus stage 2a for the
    method's effect, and stage 2a versus stage 3 for the entry point's value. It
    applies one structural-concern rubric across shadow and ordinary categories,
    separates execution modes and stage 2b effects, and reports inconclusive
    evidence as inconclusive. Apply section 9's predeclared code-outcome and
    effort criteria; distinguish record compliance from effectiveness. Include
    evidence from the separately authorized bounded legacy pilot. Stage 3 cannot
    qualify on process compliance alone.

## Lifecycle Links

- Supersedes: None
- Superseded by: None
- On acceptance, record in ADR-0030 lifecycle links only: "Narrowly amended by
  ADR-0050".
