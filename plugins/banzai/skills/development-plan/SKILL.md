---
name: development-plan
description: Strict planning phase. Converts an approved description.md and accepted ADRs into a consistency-checked plan with executable tasks. Writes no production code. Auto-select only in a Banzai-adopted repository (root PROJECT_MANIFEST.md or .banzai/) or by name.
user-invocable: true
---

# development-plan

Use after strict `description.md` is approved. Write no production code.

Output: `documentation/development-plans/<slug>/plan.md`.

Apply the canonical Engineering Quality policy in the installed
`policies/engineering-quality.md`; this skill adds
only planning-specific responsibilities and does not copy its rule set.

## Artifact Storage

Before artifact discovery or writing, read the installed
`../../policies/artifact-storage.md` and resolve the selected work through its
plugin-local helper. Use the returned role paths for internal work artifacts;
`documentation/` work paths below describe the explicit legacy layout only.
Keep ADRs, indexes, manifests and maintained product guidance at their existing
repository paths. Status/loading stays read-only, and orchestrated work follows
the persisted run binding and exact phase grants.

## Sources

- Process: the project root `AGENTS.md`. Read it unless the host already
  assembled it into this session. Before task and assurance planning,
  recognize the layout: target when `AGENTS.md` carries `## Authority` and
  `## Policies` with no line beginning with `@`, and the `CLAUDE.md` shim is
  absent or carries no policy heading; legacy layout when `CLAUDE.md` carries
  `## Engineering Quality` and `AGENTS.md` is absent or lacks `## Authority`.
  Policy headings for layout recognition are `## Decision Consultation`,
  `## Test Assurance`, `## Security Assurance`, `## Engineering Quality`,
  and `## Plan Task Completion Evidence`.
  On legacy stop with "legacy Banzai layout: run `project-manifest` to migrate"
  and ask the user to run `project-manifest`; read neither legacy policy
  copies nor installed replacements as applicable rules, and never scaffold or
  migrate files. On partial report the exact ambiguity and stop without source
  changes, precedence guesses or reconstructed rules.
  Unadopted means neither file has `## Authority` or a policy heading; keep
  existing missing-manifest behavior. Every other combination, including an
  unreadable file, is partial. Skip this recognition rule in the plugin source
  repository. Never read a policy body from a project file.
- Policies, resolved as `../../policies/<name>.md` from this `SKILL.md`,
  never from the project working directory or a fixed plugin cache path.
  Stop before affected work if a required source is absent or unreadable;
  never substitute a project copy, a legacy inline policy or memory:
  - `decision-consultation.md` when strict planning frames an unresolved material human-owned choice, before drafting dependent artifacts.
  - `test-assurance.md` before selecting or changing tests and assigning assurance evidence.
  - `security-assurance.md` before assessing changed exposures and their requirements or evidence.
  - `engineering-quality.md` before discovery, design, implementation, fix or review judgment within this skill.
  - `plan-task-completion.md` before defining strict tasks or recording their completion.
   - `artifact-storage.md` before resolving, reading or writing work artifacts.

## Orchestrated Mode

A legacy or partial layout returns `outcome=needs_human_decision`,
`gate=escalation`, the layout diagnostic as `summary`, one question naming
the migration step, and no source change.

When a local runner supplies a versioned output schema, follow this skill
normally and return the matching structured phase result from
`contracts/v3/phase-result.schema.json` with `taskCompletion: null`. This skill
closes the runner's planning
phase: use `decision_consultation` with `questions=[]` before drafting a plan or
Proposed ADR that depends on an unresolved material human-owned choice; use
`adr_approval` for a completed Proposed ADR; and use `plan_approval` only after
the consistency-checked plan exists. The CLI collects that approval and starts
implementation itself; never invoke `code-writing` from this phase.
Without runner context, the plan approval gate below is answered in chat
instead.

## Preconditions

- Stop if `description.md` is missing.
- Stop if **Open Questions & Risks** is not `None outstanding`.
- Read `PROJECT_MANIFEST.md`.
- Read the decision log and ADRs relevant to **Architecture Decision Needs**.
- Stop if a required ADR is missing, `Proposed`, or otherwise not `Accepted`.
- Use current manifest facts plus accepted ADR intent. When they differ, plan
  the explicit transition and manifest follow-up.
- Inspect relevant contracts, source, tests, and documentation before deciding
  that a choice remains unresolved. Consultation is conditional and
  planning-only; determined strict work proceeds without it.

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

## Rules

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
- If planning discovers a new material human-owned choice, stop before writing
  a dependent plan and return one to three bounded decision cards with the
  fields defined under **Decision Consultation** in the installed `policies/decision-consultation.md`, including
  repository-relative evidence. Never select, infer, or repeat an answered
  choice against unchanged evidence. After its keyed answer is re-analyzed,
  route an ADR-eligible result to `architecture-decision`.
- If planning conflicts with an accepted ADR, stop and route to
  `architecture-decision`.
- State thread/actor/context boundaries when relevant.
- Do not introduce an unapproved dependency. If one is required, stop for
  explicit approval and ADR evaluation; after approval, include install,
  lockfile, verification, and manifest tasks.
- Follow the Engineering Quality authority order. Use the smallest compatible
  design that satisfies the description and accepted decisions; do not mandate
  a generic architecture, abstraction, directory, or dependency-injection
  technique.
- Apply the Security Assurance policy in the installed
  `policies/security-assurance.md`. For each exposure the
  description recorded, name the enforcement point — the module or boundary
  applying the control — and map its requirement to a task like any other.
- Apply the Test Assurance policy in the installed
  `policies/test-assurance.md`. Plan evidence for material
  guarantees and plausible regressions; do not require one test per requirement,
  branch, helper, edge case, or traceability row.

## Plan Approval Gate

Planning ends here. Present `plan.md`, the task list, the consistency result, and
the exact bundle under approval: `description.md`, every accepted ADR it relies
on, and `plan.md`. Wait for approval.

Present the binding obligations, scope, required evidence and explicitly marked
discretion in those bytes. Resolve conflicting guidance or ambiguous commitments
before asking for approval; a required constraint must not exist only in guidance.

This is one of the five decision gates in `AGENTS.md`, and the only gate that
authorizes the exact bundle for code work. Consultation and ADR lifecycle
decisions remain separate and non-substitutable. Approval covers the whole
bundle, so there is no further confirmation between implementation, tests,
verification, and review. Do not start `code-writing` before approval.
