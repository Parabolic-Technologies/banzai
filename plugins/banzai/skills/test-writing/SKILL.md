---
name: test-writing
description: Strict/backfill assurance phase. Adds or audits proportionate tests and writes test-report.md with risk, contract, and ADR evidence. Auto-select only in a Banzai-adopted repository (root PROJECT_MANIFEST.md or .banzai/) or by name.
user-invocable: true
---

# test-writing

Runs after `code-writing` in strict mode, and after `feature` when the user asks
for an assurance report or test backfill.

Inputs: strict artifacts (`description.md`, `plan.md`,
`implementation-report.md`) or lite `work.md`, relevant accepted ADRs, plus
source/tests.

Outputs: test changes plus `documentation/features/<slug>/test-report.md`.

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
  assembled it into this session. Before test selection or assurance,
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
  - `security-assurance.md` when assuring a security requirement or discovering a new exposure; existing escalation rules govern scope changes.
  - `plan-task-completion.md` when interpreting a strict plan or its assurance/completion obligations; lite backfill creates no strict ledger.
   - `artifact-storage.md` before resolving, reading or writing work artifacts.

## Orchestrated Mode

A legacy or partial layout returns `outcome=needs_human_decision`,
`gate=escalation`, the layout diagnostic as `summary`, one question naming
the migration step, and no source change.

In strict mode this skill is the second half of the runner's implementation
phase: `code-writing` hands over directly, with no human decision in between.
Keep the approved description, plan, and accepted ADRs immutable, and report
assurance in `test-report.md` and the structured phase result required by
`contracts/v3/phase-result.schema.json` with `decisionConsultation: null`.
Preserve the implementation phase's canonical `taskCompletion` ledger and
exact report projection; do not create a second ledger. Stop with
`gate=escalation` only when assurance work exposes a missing requirement or
decision. Deterministic verification and the independent review belong to the
runner and follow automatically.

The test report owns risk and contract assurance, not implementation-task
completion. Identify any `TNNN` whose required assurance remains incomplete or
contradicts the implementation report; do not promote an incomplete or blocked
implementation task to completed merely because a test exists.

## Rules

Read and apply [Rules](../../guidance/assurance.md#rules)
from this installed skill. Stop before affected work if that guidance is missing
or unreadable.

## What To Test

Read and apply [What To Test](../../guidance/assurance.md#what-to-test)
from this installed skill. Stop before affected work if that guidance is missing
or unreadable.

## Suite Runs

Read and apply [Suite Runs](../../guidance/assurance.md#suite-runs)
from this installed skill. Stop before affected work if that guidance is missing
or unreadable.

## Critique Loop

Read and apply [Critique Loop](../../guidance/assurance.md#critique-loop)
from this installed skill. Stop before affected work if that guidance is missing
or unreadable.

## Test Report

Read and apply [Test Report](../../guidance/assurance.md#test-report)
from this installed skill. Stop before affected work if that guidance is missing
or unreadable.

## Report And Continue

Report the suite command, its outcome, and `test-report.md`. Then continue to
verification and `feature-review` without asking for confirmation. Assurance
work is done when the report is accurate and required focused or fallback checks
pass; runner-owned final verification follows automatically. A human
confirmation is not required to reach that state.

Stop here only for an escalation trigger, a suite failure you cannot fix inside
the approved plan, or reliance on a non-Accepted ADR.
