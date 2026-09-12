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

Read and apply [Clarification Loop](../../guidance/requirements.md#clarification-loop)
from this installed skill. Stop before affected work if that guidance is missing
or unreadable.

Caller-specific process and contract details remain here:

- In orchestrated strict planning, first inspect the manifest, accepted ADRs,
  executable/public contracts, and relevant source, tests, and documentation.
  Use `decision_consultation` only for a remaining choice that can materially
  change requirements, architecture, compatibility, risk, a quality attribute,
  or scope. In standalone mode present the same bounded cards in chat.
- Each consultation card carries the fields defined under **Decision
  Consultation** in the installed `policies/decision-consultation.md`, including repository-relative evidence and a
  recommendation only when current evidence supports it. Never select or infer
  the human answer.

## Document

Read and apply [Document](../../guidance/requirements.md#document)
from this installed skill. Stop before affected work if that guidance is missing
or unreadable.

## Rules

Read and apply [Rules](../../guidance/requirements.md#rules)
from this installed skill. Stop before affected work if that guidance is missing
or unreadable.

## Report And Continue

Report `description.md`, its resolved assumptions, and its architecture decision
needs. Then continue without asking for confirmation: hand off to
`architecture-decision` when **Architecture Decision Needs** is not `None`,
otherwise to `development-plan`.

The description is approved as part of the plan bundle at the plan approval gate,
not separately. Stop here only when **Open Questions & Risks** cannot reach
`None outstanding` without a human answer. Do not create a Proposed ADR or plan
that selects an option while that prerequisite consultation remains unanswered.
