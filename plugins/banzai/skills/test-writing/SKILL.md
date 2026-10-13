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

Outputs: test changes plus `documentation/work/<slug>/test-report.md`.

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
`contracts/v4/phase-result.schema.json` with `decisionConsultation: null`.
Preserve the implementation phase's canonical `taskCompletion` ledger and
exact report projection; do not create a second ledger. Stop with
`gate=escalation` only when assurance work exposes a missing requirement or
decision. Deterministic verification and the independent review belong to the
runner and follow automatically.

The test report owns risk and contract assurance, not implementation-task
completion. Identify any `TNNN` whose required assurance remains incomplete or
contradicts the implementation report; do not promote an incomplete or blocked
implementation task to completed merely because a test exists.

Task verification is supplied by the runner. Return `verificationCandidates`
with relevant task checks or an explicit absence rationale; strict mandatory
checks remain in the approved plan. Planning returns this field as `null` and
includes a self-contained `banzai-verification-obligations/v2` inventory in the
plan before requesting approval. Never edit profiles or machine evidence.

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
