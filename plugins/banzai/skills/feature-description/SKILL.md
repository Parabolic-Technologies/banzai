---
name: feature-description
description: Strict requirements phase. Turns a feature idea into a precise, testable description.md. Writes no code. Auto-select only in a Banzai-adopted repository (root PROJECT_MANIFEST.md or .banzai/) or by name.
user-invocable: true
---

# feature-description

Use for strict mode requirements. Write no code.

Output: `documentation/features/<slug>/description.md`.

Apply the canonical Engineering Quality policy in the installed
`policies/engineering-quality.md`; this skill adds
only requirements-specific responsibilities and does not copy its rule set.

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
  assembled it into this session. Before requirements discovery,
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
  - `security-assurance.md` before assessing changed exposures and their requirements or evidence.
  - `engineering-quality.md` before discovery, design, implementation, fix or review judgment within this skill.
   - `artifact-storage.md` before resolving, reading or writing work artifacts.

## Orchestrated Mode

A legacy or partial layout returns `outcome=needs_human_decision`,
`gate=escalation`, the layout diagnostic as `summary`, one question naming
the migration step, and no source change.

In strict mode this skill opens the runner's planning phase and hands over
directly to `architecture-decision` or `development-plan` inside the same
session. Do not return a phase result after the description alone: planning ends
at `gate=decision_consultation` when evidence-first analysis leaves a material
human-owned product or architecture choice unresolved, at `gate=adr_approval`
for a completed Proposed ADR, or at `gate=plan_approval` once the
consistency-checked plan exists. A consultation request has `questions=[]` and
one to three closed decision cards; it is not description approval.

## Preconditions

- Read `PROJECT_MANIFEST.md`.
- Route ordinary work with no escalation trigger and no explicit strict request
  to `feature`.

## Clarification Loop

- Ask concrete, batched questions for unpinned product decisions.
- In orchestrated strict planning, first inspect the manifest, accepted ADRs,
  executable/public contracts, and relevant source, tests, and documentation.
  Use `decision_consultation` only for a remaining choice that can materially
  change requirements, architecture, compatibility, risk, a quality attribute,
  or scope. In standalone mode present the same bounded cards in chat.
- Each consultation card carries the fields defined under **Decision
  Consultation** in the installed `policies/decision-consultation.md`, including repository-relative evidence and a
  recommendation only when current evidence supports it. Never select or infer
  the human answer.
- Choose a default only when the manifest or existing behavior determines it
  and the decision has no escalation trigger.
- Record every decision under **Resolved Assumptions** with one tag:
  `User-confirmed`, `Sensible default`, or `Manifest convention`.
- Continue until **Open Questions & Risks** is `None outstanding`.
- Record ADR-eligible technical questions under **Architecture Decision Needs**;
  do not choose a technical solution in this phase.
- Do not repeat an answered decision against unchanged evidence. Treat exact
  keyed answers as decision provenance, not approval or broader authority; a
  newly justified round uses new IDs.

## Document

1. `# Feature: <Name>` and `Slug: <slug>`.
2. **Overview**: behavior, primary flow, key constraint, non-goals.
3. **Functional Requirements**: numbered `FR1`, `FR2`; single, testable
   statements with exact names for assets, APIs, events, fields, formats, sort
   order, and states.
4. **User Stories & Acceptance Criteria**: Given/When/Then for observable
   behavior.
5. **Platform Specifics**: only touched constraints from the manifest.
6. **Security Exposure**: one line per applicable exposure class naming the
   mechanism and the FR numbers that satisfy it; or one line stating that no
   class applies and why.
7. **Architecture Decision Needs**: decision question, drivers, affected FRs or
   quality attributes, and relevant existing ADRs; or `None`.
8. **Resolved Assumptions**: numbered product decisions with provenance.
9. **Open Questions & Risks**: must be `None outstanding` before hand-off.

## Rules

- No file layout, class design, or implementation detail.
- Do not put options, solution selection, or ADR rationale in the description.
- If an FR cannot map to acceptance criteria, rewrite it.
- Apply the Security Assurance policy in the installed
  `policies/security-assurance.md`. Every applicable exposure
  class becomes an ordinary numbered FR with acceptance criteria; a security
  requirement that cannot map to acceptance criteria is rewritten like any
  other. Do not write a per-class `N/A` list.
- Inspect only load-bearing context relevant to the requested change. Turn a
  materially applicable observable Engineering Quality constraint into an
  ordinary FR and acceptance criterion. Leave internal design constraints to an
  ADR decision need or the development plan.
- Do not create an Engineering Quality section, a ten-rule checklist, or
  per-rule `N/A` entries. Generic preference is not a requirement.
- Quote user-facing strings exactly.
- Pin enable/disable states, error paths, and interruption behavior.

## Report And Continue

Report `description.md`, its resolved assumptions, and its architecture decision
needs. Then continue without asking for confirmation: hand off to
`architecture-decision` when **Architecture Decision Needs** is not `None`,
otherwise to `development-plan`.

The description is approved as part of the plan bundle at the plan approval gate,
not separately. Stop here only when **Open Questions & Risks** cannot reach
`None outstanding` without a human answer. Do not create a Proposed ADR or plan
that selects an option while that prerequisite consultation remains unanswered.
