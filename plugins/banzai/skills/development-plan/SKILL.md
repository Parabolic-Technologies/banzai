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

Standalone verification inspection uses existing task and skill authority.
With a private v2 binding, resolve `../../scripts/verification.cjs` relative to
this installed skill and use its v2 inspect or decide request against the bound
task inventory. These operations are read-only and confer no execution grant.
This skill does not execute checks through the helper. An authorized implementing
skill may execute task descriptors within the existing scope; a missing helper,
v1 binding or unsupported bound artifact retains the applicable fresh-check owner.
Never require configured profile IDs or fabricate runner approval. Orchestrated
phases consume runner evidence and never invoke the helper or write its machine
directory.

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
`contracts/v4/phase-result.schema.json` with `taskCompletion: null`. This skill
closes the runner's planning
phase: use `decision_consultation` with `questions=[]` before drafting a plan or
Proposed ADR that depends on an unresolved material human-owned choice; use
`adr_approval` for a completed Proposed ADR; and use `plan_approval` only after
the consistency-checked plan exists. The CLI collects that approval and starts
implementation itself; never invoke `code-writing` from this phase.
Without runner context, the plan approval gate below is answered in chat
instead.

Task verification is supplied by the runner. Return `verificationCandidates`
with relevant task checks or an explicit absence rationale; strict mandatory
checks remain in the approved plan. Planning returns this field as `null` and
includes a self-contained `banzai-verification-obligations/v2` inventory in the
plan before requesting approval. Never edit profiles or machine evidence.

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

Read and apply [Document](../../guidance/planning.md#document)
from this installed skill. Stop before affected work if that guidance is missing
or unreadable.

## Rules

Read and apply [Rules](../../guidance/planning.md#rules)
from this installed skill. Stop before affected work if that guidance is missing
or unreadable.

Caller-specific process and contract details remain here:

- If planning discovers a new material human-owned choice, stop before writing
  a dependent plan and return one to three bounded decision cards with the
  fields defined under **Decision Consultation** in the installed `policies/decision-consultation.md`, including
  repository-relative evidence. Never select, infer, or repeat an answered
  choice against unchanged evidence. After its keyed answer is re-analyzed,
  route an ADR-eligible result to `architecture-decision`.
- If planning conflicts with an accepted ADR, stop and route to
  `architecture-decision`.

## Code Design

When an Engineering Quality structural assessment trigger or the
reuse-search duty applies, read and apply
[Ownership Discovery](../../guidance/code-design.md#ownership-discovery)
from this installed skill. When a structural assessment trigger applies, also
read and apply
[Assessment Contract](../../guidance/code-design.md#assessment-contract) and
[Planning Assessment](../../guidance/code-design.md#planning-assessment)
from this installed skill. Stop before affected work if that guidance is
missing or unreadable.

## Plan Approval Gate

Planning ends here. Present `plan.md`, the task list, the consistency result, and
the exact bundle under approval: `description.md`, every accepted ADR it relies
on, and `plan.md`. Wait for approval.

Present the binding obligations, scope, required evidence and explicitly marked
discretion in those bytes. Resolve conflicting guidance or ambiguous commitments
before asking for approval; a required constraint must not exist only in guidance.

This is one of the five existing decision gates in `AGENTS.md`, and the only gate that
authorizes the exact bundle for code work. Consultation and ADR lifecycle
decisions remain separate and non-substitutable. Approval covers the whole
bundle, so ordinary implementation, tests, verification and review continue
without another plan confirmation. Task verification adds no profile or
configuration-prerequisite gate. Models cannot write runner control files.
Present actual Human prerequisites alongside this exact bundle. Do not start `code-writing` before approval.
