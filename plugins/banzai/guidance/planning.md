# Planning Guidance

Canonical portable guidance. The active execution context supplies artifact roles
and policies; entry, host transport and contract mechanics remain with the caller.

## Document

1. `# Development Plan: <Name>`, slug, link to description, accepted ADRs, and
   manifest facts used.
2. **Plan Authority**: copy the document convention (heading and three paragraphs)
   from the installed `policies/plan-task-completion.md`, before Technical
   Breakdown and Implementation Tasks. Make obligations explicit; add labeled
   optional guidance only when useful. Required behavior and safety constraints
   belong in binding text. Do not add a classification template to every task.
3. **Technical Breakdown** in dependency order, only for materially affected
   areas. Establish behavior, invariants, scope and relevant boundaries; retain
   necessary contract, dependency, failure/lifecycle and compatibility constraints.
   Name enforcement points for recorded security exposures and specific manifest
   facts that will become stale. Omit unaffected layers and empty sections.
4. **Implementation Tasks**: one canonical heading per task in the exact form
   `- [ ] **T001 - Title**`, `- [ ] **T002 - Title**`, in dependency order.
   The heading line ends at the closing `**`: no trailing annotation,
   emphasis, or continuation after it, and the box stays unchecked even in a
   revised plan whose earlier tasks were already implemented — put provenance
   notes such as "added from review finding" in the task body below the
   heading. A heading outside this grammar fails deterministic validation
   before the plan can be approved. Each task establishes behavior and binding
   invariants, affected files/units and boundaries, necessary implementation
   constraints, dependencies, FR/acceptance/ADR mapping, proportionate assurance
   and completion evidence, and review
   batch. For every material claim introduced by the change, name an existing
   proportionate evidence owner such as Test Assurance, Security Assurance,
   contract verification, a configured check, or justified inspection; do not
   create another test by default. Mark tasks that need separate approval. After
   strict orchestrated approval these checkboxes become an immutable approved
   work set; execution status is recorded in the structured completion ledger
   and its report projection, never by marking them `[x]`.
5. **Consistency Check**: map every FR and acceptance criterion to tasks, map
   every accepted ADR constraint or confirmation method, confirm there are no
   unresolved Proposed ADRs, name required manifest transitions, and state the
   plan's own security exposure or that none applies. Name only materially
   applicable Engineering Quality constraints and their task/evidence owner; do
   not add a ten-row checklist or per-rule `N/A` list.

When a new plan explicitly relies on equivalent verification, include the
versioned obligation inventory described by Plan Authority and Task Completion.
List every configured check in order, retain mandatory fresh requirements, bind
the complete surrounding prose and obtain normal bundle approval. Missing or
ambiguous commitments preserve fresh execution.

## Rules

- Runner control paths under `.banzai/` are outside model scope except exact
  private artifact roles bound for the intended implementation/fix phase.
  Put missing verification setup in **Human prerequisites** and show that section
  with plan approval. The runner's configuration prerequisite gate owns its
  proposal and write; do not plan JSON edits or invent an external updater.

- Specify exact contracts, signatures, state shapes, identifiers, config keys,
  locations or techniques when applicable authority or a concrete constraint
  requires them, including internal details. Link existing authoritative
  definitions instead of copying them; do not authorize future contract changes
  through a link. Leave routine private mechanics open where no such constraint
  applies, under the installed plan policy.
- Omit speculative layers, exhaustive file trees, function inventories and
  pseudocode bodies. Do not write function bodies.
- Map every FR and acceptance criterion to the plan.
- Do not repeat ADR option analysis or rationale; link the accepted ADR.
- If planning discovers a material human-owned choice or conflicts with an
  accepted ADR, stop dependent work. Resolve the choice through Decision
  Consultation when applicable; an ADR-eligible result requires an architecture
  decision before a dependent plan. Never infer or repeat an answered choice
  against unchanged evidence.
- State thread/actor/context boundaries when relevant.
- Do not introduce an unapproved dependency. If one is required, stop for
  explicit approval and ADR evaluation; after approval, include install,
  lockfile, verification, and manifest tasks.
- Follow the Engineering Quality authority order. Use the smallest compatible
  design that satisfies the description and accepted decisions; do not mandate
  a generic architecture, abstraction, directory, or dependency-injection
  technique.
- Apply the Security Assurance policy (`security-assurance.md`) supplied by the active execution context. For each exposure the
  description recorded, name the enforcement point — the module or boundary
  applying the control — and map its requirement to a task like any other.
- Apply the Test Assurance policy (`test-assurance.md`) supplied by the active execution context. Plan evidence for material
  guarantees and plausible regressions; do not require one test per requirement,
  branch, helper, edge case, or traceability row.

