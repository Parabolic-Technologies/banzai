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

Before artifact discovery or writing, read the installed
`../../policies/artifact-storage.md` and resolve the selected work through its
plugin-local helper. Use the returned role paths for internal work artifacts;
`documentation/` work paths below describe the explicit legacy layout only.
Keep ADRs, indexes, manifests and maintained product guidance at their existing
repository paths. Status/loading stays read-only, and orchestrated work follows
the persisted run binding and exact phase grants.

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
and return the phase result required by `contracts/v3/phase-result.schema.json`
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

- `documentation/features/<slug>/description.md`
- `documentation/development-plans/<slug>/plan.md`
- accepted ADRs linked by the description and plan;
- `PROJECT_MANIFEST.md`

Outputs:

- source/test changes;
- `documentation/features/<slug>/implementation-report.md`;
- manifest updates when code changes project facts.

## Preconditions

- Stop if `plan.md` is missing or unapproved.
- Stop if the plan has an incomplete consistency check or a required ADR is not
  `Accepted`.
- Read `description.md`, `plan.md`, accepted ADRs, and `PROJECT_MANIFEST.md`.
- Use current manifest facts and accepted ADR intent. Implement only the
  transition authorized by the plan.

## Implementation Rules

1. Follow the plan's task order. Outside orchestrated mode, mark only completed
   tasks `[x]`; do not change approved task meaning silently. In orchestrated
   mode, leave the plan unchanged and record completion once in the structured
   ledger, then project the same records into the implementation report.
2. Group adjacent steps with no escalation trigger into batches. Report a batch
   and continue; a batch boundary is not a gate.
3. Stop before any planned or discovered escalation trigger; name it and wait
   for explicit approval.
4. After each batch, run focused affected checks that give useful feedback.
5. Do not run formatter in batch loops. Run it only during final verification.
6. Apply the Test Assurance policy in the installed
   `policies/test-assurance.md`. Preserve tests that protect
   material guarantees. Add, consolidate, or remove tests only when the resulting
   evidence remains proportionate and non-redundant.
7. Do not add unapproved dependencies. Add only dependencies explicitly
   authorized by the approved plan, then update the lockfile and manifest.
8. Apply the Engineering Quality authority order and materially applicable
   constraints. Keep work within approved scope, use the smallest compatible
   implementation, and reuse repository mechanisms and evidence owners rather
   than creating an EQ checklist, methodology, or test quota.
9. Apply each linked ADR's compliance and confirmation constraints.
10. Make important implementation dependencies, boundary behavior, failure and
    lifecycle consequences, and compatibility changes explicit when the plan
    identifies them; do not invent those concerns for an unaffected surface.
11. Comment sparingly and with high signal. Write a comment only to explain
    why: a constraint, trade-off, invariant, side effect, or non-obvious
    behavior. Do not narrate what the code visibly does.
12. When Serena MCP tools are listed, prefer `find_symbol`,
    `find_referencing_symbols`, and `get_symbols_overview` over pattern search
    or line-window reads for code.

## Deviations

Apply Plan Authority in the installed `policies/plan-task-completion.md`.
Satisfy binding requirements within approved scope; a different compliant choice
under explicitly optional guidance is not a deviation and needs no reapproval or
report entry merely for differing. Preserve legacy approved meanings and exact
directives; private appearance alone does not make a constraint optional.

Record material decisions and real deviations proportionately, with rationale
and confirmation that `description.md` still holds. A missing/deprecated API,
framework behavior or correctness gap may require a deviation, but documenting
it does not authorize a changed commitment. Use existing escalation/reapproval
for conflicts. Record material Engineering Quality deviations in the existing
implementation report, not a separate artifact or mandatory per-rule checklist.

If a deviation conflicts with or invalidates an accepted ADR, stop before the
conflicting change. Route to `architecture-decision` for a superseding proposal,
then revise and reapprove the plan. Never edit the accepted ADR body.

## Final Verification

Before the report:

1. Trace every FR and acceptance criterion to implementation and proportionate
   assurance evidence.
2. Confirm every resolved assumption is honored.
3. Trace every accepted ADR compliance/confirmation item to code, tests, or an
   explicitly owned non-automated check.
4. Confirm every plan task is complete or reported as a gap.
5. Confirm each material claim has the proportionate evidence owner assigned by
   the plan and that applicable Engineering Quality constraints and deviations
   match the current implementation.
6. Run formatter check/fix if configured.
7. In orchestrated mode, do not repeat a full-scope command supplied in the
   runner verification block. If the manifest's applicable final suite is absent
   from that block, run it once and record the configuration gap.
8. In standalone mode, run the applicable typecheck, lint, and final test suite
   once.
9. If formatting changed files, rerun affected checks.
10. Set verified ADR entries in the manifest index to `Implemented`; leave
    unimplemented accepted decisions as `Planned`.
11. Update only the manifest facts the change made stale, following the
    `project-manifest` writing rules: rewrite the affected bullet, add or remove
    module entries, and record no delivery narrative, verification history, or
    test counts. Those belong in the implementation and test reports.

## Implementation Report

Write `documentation/features/<slug>/implementation-report.md`:

1. title, slug, links to description and plan;
2. files created/modified/deleted and new folders/modules;
3. FR/story trace plus final verification commands and outcomes;
4. ADR conformance and confirmation evidence;
5. statement: no functional gap and no scope expansion, or list gaps;
6. deviations from plan;
7. assurance evidence added, reused, consolidated, or intentionally deferred,
   and the material guarantee each automated test can fail to protect;
8. material Engineering Quality deviations and their authority, impact, and
   evidence owner, or `None`;
9. notes for `test-writing`.

Include a **Plan Task Completion** table with exactly one row per approved
`TNNN` task, in plan order. Each row contains task ID, `completed`, `incomplete`,
or `blocked` status, a JSON array of bounded repository-relative evidence
objects, and a JSON gap object or `null`. Precede the table with
`` Format: `banzai-plan-task-completion/v1` `` and use the exact columns `Task`,
`Status`, `Evidence`, and `Gap or deviation`. Create the task records once and
reuse them verbatim in the table and the structured `taskCompletion` ledger;
after parsing, the two must be JSON-identical. In orchestrated mode the runner
prompt supplies the exact cell escaping, field bounds, and a canonical row;
follow it verbatim and reread the written table before returning the result.

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
