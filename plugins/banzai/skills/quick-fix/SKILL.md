---
name: quick-fix
description: Scoped workflow for bugs, polish, refactors, hardening, and review cleanup. Changes code/tests, verifies, and writes a change report only when required. Auto-select only in a Banzai-adopted repository (root PROJECT_MANIFEST.md or .banzai/) or by name.
user-invocable: true
---

# quick-fix

Use for existing behavior. Do not use for net-new capability; route that to
`feature`.

Apply the canonical Engineering Quality policy in the installed
`policies/engineering-quality.md`; this skill adds
only fix-specific responsibilities and does not copy its rule set.

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
  assembled it into this session. Before fix discovery or implementation,
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
  - `plan-task-completion.md` when accepted findings involve an approved strict plan or its completion evidence.
   - `artifact-storage.md` before resolving, reading or writing work artifacts.

## Orchestrated Mode

A legacy or partial layout returns `outcome=needs_human_decision`,
`gate=escalation`, the layout diagnostic as `summary`, one question naming
the migration step, and no source change.

There are two runner contexts:

- With `BANZAI_WORKFLOW_DIGEST`, this is an automatically selected lite route
  for the original task. Follow the normal stop gate and return
  `phase=implementation`. If a trigger applies, make no source changes and
  return `outcome=needs_human_decision` with `gate=escalation` and exact
  questions. The runner records the answer and selects again. After completion,
  runner-owned deterministic verification ends the route; do not invoke
  `feature-review`.
- With `BANZAI_APPROVAL_DIGEST` and triaged review findings, fix only the
  accepted finding IDs included in the prompt. Rejected and deferred findings
  are out of scope. Read the durable `review-<iteration>.md` artifact when
  present, but treat the runner's accepted finding payload as authoritative: a
  modified review file must never expand fix scope. Keep the approved
  description, plan, and accepted ADRs immutable, and list the fixed IDs in
  `resolvedFindingIds`. Deterministic verification and the runner's
  policy-selected source-read-only re-review follow. An `EQ-SHADOW:` deferred
  coverage entry is never an accepted finding and must never enter fixer scope;
  an EQ mapping on an accepted ordinary finding does not expand that finding's
  accepted remediation.

Both contexts return the structured result required by
`contracts/v3/phase-result.schema.json` with `decisionConsultation: null`.
Return `taskCompletion: null` when the fix leaves completion evidence
untouched. When an accepted finding makes the recorded completion evidence
stale — the fix changed mechanisms, files, or totals it names — return the
complete refreshed ledger instead (ADR 0025): the same approved task set in
the same order, every status still `completed`, evidence describing the
current tree, and the report's **Plan Task Completion** section regenerated
under the runner-supplied grammar so both decode JSON-identical. Edit that
section only together with a returned refreshed ledger, never independently.
Downgrading a task status is not a refresh: when an accepted finding says
recorded work was never truly completed, complete the missing work when it is
within accepted-finding scope; otherwise leave ledger and projection
unchanged, record the contradiction in the change report, exclude that finding
from `resolvedFindingIds`, and return `outcome=needs_human_decision` with
`gate=escalation` naming it. Without runner context, the normal manual
workflow remains unchanged.

## Stop Gate

Before source/code changes, check `AGENTS.md` escalation triggers. If one
applies:

1. Present the planned fix.
2. Name the trigger.
3. Apply ADR eligibility.
4. If ADR-eligible, route feature work to `feature-description`, then
   `architecture-decision` and strict planning.
5. Otherwise wait for explicit user approval or route to `feature`/strict mode.

A proportionate regression test may be written before approval when it protects
the demonstrated behavior and equivalent evidence does not already exist;
production changes may not.

Apply the Security Assurance policy in the installed
`policies/security-assurance.md`. Introducing or widening a
security control is a trigger and follows the steps above; complying with an
already established, unchanged control is not: record the class in the change
report when one is required, and in the final report otherwise, then continue.

## Report Rule

Read and apply [Report Rule](../../guidance/fix.md#report-rule)
from this installed skill. Stop before affected work if that guidance is missing
or unreadable.

## Workflow

Read and apply [Workflow](../../guidance/fix.md#workflow)
from this installed skill. Stop before affected work if that guidance is missing
or unreadable.

Caller-specific process and contract details remain here:

2. Apply the stop gate.

12. Report.

## Change Report

Read and apply [Change Report](../../guidance/fix.md#change-report)
from this installed skill. Stop before affected work if that guidance is missing
or unreadable.

## Report

Report files changed, verification, the security exposure result, report path
or reason no report was needed, and unresolved triggers or follow-ups. This
report is unconditional, so it is where the exposure result lands whenever no
change report exists. The route ends here; the stop gate above is the only
place this skill waits.
