---
name: code-writing
description: Strict implementation. Executes approved tasks under accepted ADRs, writes code/tests, verifies requirements and decisions, writes implementation-report.md, and updates the manifest. Auto-select only in a Banzai-adopted repository (root PROJECT_MANIFEST.md or .banzai/) or by name.
user-invocable: true
---

# code-writing

Use after an approved strict `plan.md`.

Apply the canonical Engineering Quality policy in the installed
`policies/engineering-quality.md`; this skill adds
only implementation-specific responsibilities and does not copy its rule set.

## Artifact Storage

Before reading or writing work documents, read the installed
`../../policies/artifact-storage.md`. New work uses one flat
`documentation/work/<slug>/` directory; read and edit selected Markdown files
with ordinary file tools. Existing work continues at its explicit known paths,
including follow-up reports and reviews. Do not migrate existing documents or
consult an artifact-layout declaration. Resolve ambiguous work selection before
writing. Keep ADRs, indexes, manifests and maintained guidance at their existing
paths. Read-only discovery creates nothing; runner phases follow their supplied
binding and exact phase grants.

Concrete `documentation/work/` paths below are new-work defaults. For explicit
continuation, resolve inputs and outputs from the selected work's known locations
and links, including its report and review directory; never create a replacement
work directory to satisfy a new-work path example.

Standalone verification retains the calling skill's task/plan authorization.
Use the installed `../../scripts/verification.cjs` v3 request with the exact
`documentPath`, `workflow` and `roundId` when the selected document has a
supported task inventory. Inspect/decide are read-only; execute owns private
machine evidence. Where no supported inventory exists, retain applicable fresh
checks and their actual results. Add no report solely to use the helper and
fabricate no runner approval. Orchestrated phases consume runner evidence and
never invoke standalone verification or write its machine directory.

## Sources

- Process: the project root `AGENTS.md`. Read it unless the host already
  assembled it into this session. Before implementation,
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
  - `security-assurance.md` when implementing a security requirement or discovering a new exposure; existing escalation rules govern scope changes.
  - `engineering-quality.md` before discovery, design, implementation, fix or review judgment within this skill.
  - `plan-task-completion.md` before interpreting approved strict plan authority or recording task completion.
   - `artifact-storage.md` before resolving, reading or writing work artifacts.

## Orchestrated Mode

A legacy or partial layout returns `outcome=needs_human_decision`,
`gate=escalation`, the layout diagnostic as `summary`, one question naming
the migration step, and no source change.

`BANZAI_RUN_ID` and `BANZAI_APPROVAL_DIGEST` identify a runner-recorded human
approval; do not edit or reinterpret runner state. Follow this skill normally
and return the phase result required by `contracts/v4/phase-result.schema.json`
with `decisionConsultation: null`; on a new escalation trigger, stop with
`gate=escalation`. The approved description, plan, and accepted ADRs are
immutable: do not edit them or mark plan tasks `[x]`. The structured
`taskCompletion` ledger is the canonical evidence; the implementation report's
**Plan Task Completion** section is its deterministic projection, not a second
source of truth. The phase covers this skill and then `test-writing` in one
session: return `outcome=completed` with `gate=null` only after the test report
exists, and leave deterministic verification and the independent review to the
runner. Without runner context, the same preconditions and continuations apply.

Inputs:

- `documentation/work/<slug>/description.md`
- `documentation/work/<slug>/plan.md`
- accepted ADRs linked by the description and plan;
- `PROJECT_MANIFEST.md`

Outputs:

- source/test changes;
- `documentation/work/<slug>/implementation-report.md`;
- manifest updates when code changes project facts.

Task verification is supplied by the runner. Return `verificationCandidates`
with relevant task checks or an explicit absence rationale; strict mandatory
checks remain in the approved plan. Planning returns this field as `null` and
includes a self-contained `banzai-verification-obligations/v2` inventory in the
plan before requesting approval. Never edit profiles or machine evidence.

## Preconditions

- Stop if `plan.md` is missing or unapproved.
- Stop if the plan has an incomplete consistency check or a required ADR is not
  `Accepted`.
- Read `description.md`, `plan.md`, accepted ADRs, and `PROJECT_MANIFEST.md`.
- Use current manifest facts and accepted ADR intent. Implement only the
  transition authorized by the plan.

## Implementation Rules

Read and apply [Implementation Rules](../../guidance/implementation.md#implementation-rules)
from this installed skill. Stop before affected work if that guidance is missing
or unreadable.

Caller-specific process and contract details remain here:

1. Follow the plan's task order. Outside orchestrated mode, mark only completed
   tasks `[x]`; do not change approved task meaning silently. In orchestrated
   mode, leave the plan unchanged and record completion once in the structured
   ledger, then project the same records into the implementation report.

## Code Design

When an Engineering Quality structural assessment trigger or the
reuse-search duty applies, read and apply
[Ownership Discovery](../../guidance/code-design.md#ownership-discovery)
from this installed skill. When a structural assessment trigger applies, also
read and apply
[Assessment Contract](../../guidance/code-design.md#assessment-contract) and
[Implementation Assessment](../../guidance/code-design.md#implementation-assessment)
from this installed skill. Stop before affected work if that guidance is
missing or unreadable.

## Deviations

Read and apply [Deviations](../../guidance/implementation.md#deviations)
from this installed skill. Stop before affected work if that guidance is missing
or unreadable.

Caller-specific process and contract details remain here:

Route to `architecture-decision` for a superseding proposal,
then revise and reapprove the plan.

## Final Verification

Read and apply [Final Verification](../../guidance/implementation.md#final-verification)
from this installed skill. Stop before affected work if that guidance is missing
or unreadable.

## Implementation Report

Read and apply [Implementation Report](../../guidance/implementation.md#implementation-report)
from this installed skill. Stop before affected work if that guidance is missing
or unreadable.

Caller-specific process and contract details remain here:

In standalone mode, include a **Plan Task Completion** table with exactly one
row per approved `TNNN` task, in plan order. Each row contains task ID,
`completed`, `incomplete`, or `blocked` status, a JSON array of bounded
repository-relative evidence objects, and a JSON gap object or `null`. Precede
the table with `` Format: `banzai-plan-task-completion/v1` `` and use the exact
columns `Task`, `Status`, `Evidence`, and `Gap or deviation`. Create the task
records once and reuse them verbatim in the table and the structured
`taskCompletion` ledger; after parsing, the two must be JSON-identical.
In orchestrated mode, do not author that table: return the same records only in
the structured `taskCompletion` ledger under the runner prompt's field bounds,
write the report narrative under your own headings, and leave at most one
existing **Plan Task Completion** section for the runner to replace with its
published `banzai-plan-task-completion/v2` region. A gap reference names a
unique narrative heading outside that section and outside code fences.

Every completed task needs at least one existing regular repository file in
the approved run's changed scope, with a bounded detail. Every incomplete or
blocked task needs a gap/deviation reference to an existing implementation or
test report heading. Never update approved plan checkboxes to mirror the ledger.
A changed-scope evidence path must name a file created or modified relative to
the run baseline, or an exact required implementation or test report. Carried-in
unchanged source and test files are not completion evidence even when the task
only reads or verifies them; record that confirmation in a required report and
cite the report instead. Do not return `outcome=completed` while any required
task is incomplete or blocked.

## Report And Continue

Report implementation, tests, report path, manifest updates, verification
outcomes, and any incomplete tasks or follow-ups. Then continue to
`test-writing` without asking for confirmation.

This boundary is not a decision gate. Stop here only for an escalation trigger,
a failure that invalidates the approved plan, or an unresolved decision that no
manifest or existing-behavior default answers.
