---
name: feature
description: Lite workflow for new work with no escalation trigger. Creates work.md, implements code/tests, verifies, and reports. Use for new capabilities unless strict mode or a trigger applies. Auto-select only in a Banzai-adopted repository (root PROJECT_MANIFEST.md or .banzai/) or by name.
user-invocable: true
---

# feature

Use for new capabilities with no escalation trigger.

Inputs: user request, `AGENTS.md`, `PROJECT_MANIFEST.md`, active accepted ADRs,
relevant code/docs.
Output: source/test changes plus `documentation/features/<slug>/work.md`.

Apply the canonical Engineering Quality policy in the installed
`policies/engineering-quality.md`; this skill adds
only lite-feature responsibilities and does not copy its rule set.

## Artifact Storage

Before artifact discovery or writing, read the installed
`../../policies/artifact-storage.md` and resolve the selected work through its
plugin-local helper. Use the returned role paths for internal work artifacts;
`documentation/` work paths below describe the explicit legacy layout only.
Keep ADRs, indexes, manifests and maintained product guidance at their existing
repository paths. Status/loading stays read-only, and orchestrated work follows
the persisted run binding and exact phase grants.

Standalone verification uses the existing task and skill authorization. With a
new private v2 work binding, invoke the installed `../../scripts/verification.cjs`
v2 helper using the task inventory in the bound plan or work artifact. Inspect
and decide are read-only; execute runs the authorized checks. Do not fabricate a
runner approval or add a report solely to use the helper. Where no applicable
bound artifact exists, retain fresh task checks and their actual results.
Orchestrated phases consume runner evidence and never invoke the helper or write
its machine directory.

## Sources

- Process: the project root `AGENTS.md`. Read it unless the host already
  assembled it into this session. Before lite discovery or implementation,
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
  - `test-assurance.md` before selecting or changing tests and assigning assurance evidence.
  - `security-assurance.md` before assessing changed exposures and their requirements or evidence.
  - `engineering-quality.md` before discovery, design, implementation, fix or review judgment within this skill.
   - `artifact-storage.md` before resolving, reading or writing work artifacts.

## Orchestrated Mode

A legacy or partial layout returns `outcome=needs_human_decision`,
`gate=escalation`, the layout diagnostic as `summary`, one question naming
the migration step, and no source change.

When the runner supplies `BANZAI_RUN_ID`, `BANZAI_WORKFLOW_DIGEST`, and a
versioned phase-result schema, this is an automatically selected lite route.
Follow the normal preconditions and stop gate, then return
`phase=implementation`. On an escalation trigger, make no source changes and
return `outcome=needs_human_decision` with `gate=escalation` and exact
questions. The runner records the answer and selects the workflow again.

Use `contracts/v4/phase-result.schema.json` and return `taskCompletion: null`
and `decisionConsultation: null`; lite work has no approved strict plan task set
and cannot use the planning-only consultation gate.

Return `outcome=completed` with `gate=null` after the feature report is
complete. The runner owns its configured deterministic verification and ends
the route after it passes; do not invoke `feature-review`.

Task verification is supplied by the runner. Return `verificationCandidates`
with relevant task checks or an explicit absence rationale; strict mandatory
checks remain in the approved plan. Planning returns this field as `null` and
includes a self-contained `banzai-verification-obligations/v2` inventory in the
plan before requesting approval. Never edit profiles or machine evidence.

## Preconditions

- Read `PROJECT_MANIFEST.md`.
- Read active accepted ADRs relevant to the touched architecture or contracts.
- If the manifest is missing or skeletal, ask the user to run
  `project-manifest` by name (`/` or `$`) first unless they asked for
  exploration; it is explicit-invocation-only and cannot be selected here.
- If the user asked for strict mode, route to `feature-description`.

## Stop Gate

Before source/code changes, check `AGENTS.md` escalation triggers. If one
applies:

1. Write/present the `work.md` plan.
2. Name the trigger.
3. Apply ADR eligibility from `AGENTS.md`.
4. If ADR-eligible, route to `feature-description` and then
   `architecture-decision`; lite implementation cannot continue.
5. Otherwise wait for explicit user approval.

Do not add dependencies, change public contracts, alter persistence, or make
security/privacy-sensitive choices without approval.

Apply the Security Assurance policy in the installed
`policies/security-assurance.md`. Introducing or widening a
security control is a trigger and follows the steps above. Complying with an
already established, unchanged control is not: record the class in `work.md`
and continue.

## Workflow

Read and apply [Workflow](../../guidance/feature.md#workflow)
from this installed skill. Stop before affected work if that guidance is missing
or unreadable.

Caller-specific process and contract details remain here:

2. Pick a short kebab-case slug.

6. Apply the stop gate.

13. Report changed paths, verification outcomes, deviations, and follow-ups. The
    stop gate above is the only place this skill waits.

## Code Design

When an Engineering Quality structural assessment trigger or the
reuse-search duty applies, read and apply
[Ownership Discovery](../../guidance/code-design.md#ownership-discovery)
from this installed skill. When a structural assessment trigger applies, also
read and apply
[Assessment Contract](../../guidance/code-design.md#assessment-contract),
[Planning Assessment](../../guidance/code-design.md#planning-assessment) and
[Implementation Assessment](../../guidance/code-design.md#implementation-assessment)
from this installed skill. Stop before affected work if that guidance is
missing or unreadable.

## `work.md`

Read and apply [work.md](../../guidance/feature.md#workmd)
from this installed skill. Stop before affected work if that guidance is missing
or unreadable.

## Rules

Read and apply [Rules](../../guidance/feature.md#rules)
from this installed skill. Stop before affected work if that guidance is missing
or unreadable.
