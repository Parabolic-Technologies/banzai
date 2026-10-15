---
name: feature-status
description: Read-only status report for documented features and ADRs. Reports lifecycle state, task progress, inconsistencies, and next action. Auto-select only in a Banzai-adopted repository (root PROJECT_MANIFEST.md or .banzai/) or by name.
user-invocable: true
---

# feature-status

Read-only. Write nothing.

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

Standalone verification inspection uses the installed
`../../scripts/verification.cjs` v3 inspect/decide request with the exact
`documentPath`, `workflow` and `roundId`. These operations are read-only and
create no execution authority or metadata. This skill does not execute checks.
An authorized implementing skill owns applicable fresh checks when no supported
inventory or local evidence exists. Never fabricate runner approval or passing
evidence. Orchestrated phases consume runner evidence and never invoke the
standalone helper.

## Sources

- Process: the project root `AGENTS.md`. Read it unless the host already
  assembled it into this session. Before status reporting,
  recognize the layout: target when `AGENTS.md` carries `## Authority` and
  `## Policies` with no line beginning with `@`, and the `CLAUDE.md` shim is
  absent or carries no policy heading; legacy layout when `CLAUDE.md` carries
  `## Engineering Quality` and `AGENTS.md` is absent or lacks `## Authority`.
  Policy headings for layout recognition are `## Decision Consultation`,
  `## Test Assurance`, `## Security Assurance`, `## Engineering Quality`,
  and `## Plan Task Completion Evidence`.
  Report the legacy diagnostic: "legacy Banzai layout: run `project-manifest` to migrate".
  On a legacy or partial layout apply the bootstrap source rule: take process
  text from the installed plugin's packaged `AGENTS.md` (`../../AGENTS.md`
  from this `SKILL.md`) and policies from `../../policies/`; project files
  are inputs to the status report only, legacy Banzai text is never an
  applicable policy, and approved decisions recorded there keep their authority.
  Stop if an installed source is unreadable. Report a partial layout as partial.
  Unadopted means neither file has `## Authority` or a policy heading; keep
  existing missing-manifest behavior. Every other combination, including an
  unreadable file, is partial. Skip this recognition rule in the plugin source
  repository. Never read a policy body from a project file.
- Policies, resolved as `../../policies/<name>.md` from this `SKILL.md`,
  never from the project working directory or a fixed plugin cache path.
  Stop before affected work if a required source is absent or unreadable;
  never substitute a project copy, a legacy inline policy or memory:
  - `plan-task-completion.md` when interpreting strict plan authority or completion evidence.
   - `artifact-storage.md` before resolving, reading or writing work artifacts.

## Scan

- `documentation/work/<slug>/work.md`
- `documentation/work/<slug>/description.md`
- `documentation/work/<slug>/plan.md`
- `documentation/work/<slug>/implementation-report.md`
- `documentation/work/<slug>/test-report.md`
- `documentation/work/<slug>/review-*.md`
- `documentation/decisions/README.md`
- `documentation/decisions/NNNN-*.md`
- `documentation/work/*/change-report.md`
- `git status`
- `.banzai/active-run.json`, if present

For each `description.md`, check whether **Open Questions & Risks** is
`None outstanding`.

When an active orchestrator run exists, its persisted state owns the next action
for that slug. Report the run status and the next action `banzai status` reports,
and mark artifact-derived next actions as secondary. This includes terminal
orchestrated runs: never replace persisted `nextAction: null` with
`code-writing` solely because immutable approved plan boxes remain unchecked.

## Task Completion Evidence

Apply Plan Authority in the installed `policies/plan-task-completion.md` to
strict obligations: permitted guidance differences do not make work incomplete,
and structural validity does not prove required behavior or checks. Preserve
legacy approved meaning and report missing or contradictory material evidence.

Report task completion separately from lifecycle, and name its source:

1. `structured completion evidence` only when the supported canonical ledger,
   approved plan digest, required reports, the report's completion section
   (the runner-published `banzai-plan-task-completion/v2` region, or the
   legacy model-authored v1 projection), and the persisted validated summary
   with its publication receipt when present agree;
2. `plan checkbox` for standalone or non-approved mutable work without
   orchestrator evidence;
3. `legacy` or `unknown` for an orchestrated run whose source attempt predates
   the structured ledger, even when report prose appears to map every task;
4. `inconsistent` when supported evidence is malformed, incomplete, or
   contradictory.

A terminal `done` orchestrated run may show `N/N externally completed` only
when approval, reports, all task evidence, and terminal review or human-triage
evidence agree. State `done` or file presence alone is insufficient. An active
`implementing`, `fixing`, `verifying`, `reviewing`, or gated run remains active
and may show only proven partial task evidence. A terminal inconsistency keeps
the persisted lifecycle and next action visible and recommends an
artifact/evidence audit, not plan-checkbox mutation.

Never parse legacy report prose into a fabricated `N/N`. The report's
completion section cannot independently establish completion: a v2 region is
the runner's receipt of validated claims, a v1 table is a model-authored
projection, and neither is repository evidence. A run whose latest attempt is
`pending_application` or whose completion publication was refused has no
completed claims yet. Persisted state
continues to determine lifecycle and `nextAction` even when task completion is
legacy, unknown, or inconsistent.

## Position

| Artifacts                                                   | Next action                                                   |
| ----------------------------------------------------------- | ------------------------------------------------------------- |
| `work.md` only                                              | done or continue with `feature` follow-ups                    |
| description with open questions                             | `feature-description`                                         |
| description with ADR needs and no ADR                       | `architecture-decision`                                       |
| description with required Proposed ADR                      | review via `architecture-decision`                            |
| description with required Rejected ADR                      | create or rework another proposal via `architecture-decision` |
| description with no ADR needs or all required ADRs Accepted | `development-plan`                                            |
| description + plan                                          | `code-writing`                                                |
| + implementation report                                     | `test-writing`                                                |
| + test report                                               | `feature-review`                                              |
| + review artifact with findings                             | triage, then `quick-fix` for accepted findings                |
| + passing review artifact                                   | done                                                          |
| + triaged findings                                          | done, or `quick-fix` for accepted findings                    |

Report inconsistencies: plan without description, implementation without plan,
slug split across trees, change report linking to missing feature, plan relying
on a non-Accepted ADR, accepted ADR missing from the index, non-reciprocal
supersession links, or manifest ADR implementation state that disagrees with
artifacts and current facts.

For each plan, report completed, incomplete, blocked, unknown, or inconsistent
`TNNN` tasks and their evidence source. Outside an immutable orchestrated
approval context, a plan with unchecked tasks and no external evidence remains
in `code-writing` even when implementation files exist.

## Output

Table columns:

- slug;
- mode: `lite`, `strict`, or `mixed`;
- artifacts present;
- related ADR IDs and statuses;
- completed/total plan tasks;
- next action;
- next skill and its role from `AGENTS.md`.

Below the table list decision-log entries, change reports, inconsistencies, and
uncommitted work. End by asking which feature or decision to resume. Do not
start another phase.
