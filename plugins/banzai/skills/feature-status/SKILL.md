---
name: feature-status
description: Read-only status report for documented features and ADRs. Reports lifecycle state, task progress, inconsistencies, and next action. Auto-select only in a Banzai-adopted repository (root PROJECT_MANIFEST.md or .banzai/) or by name.
user-invocable: true
---

# feature-status

Read-only. Write nothing.

## Artifact Storage

Before artifact discovery or writing, read the installed
`../../policies/artifact-storage.md` and resolve the selected work through its
plugin-local helper. Use the returned private role paths for internal work artifacts.
Keep ADRs, indexes, manifests and maintained product guidance at their existing
repository paths. Status/loading stays read-only, and orchestrated work follows
the persisted run binding and exact phase grants.

Standalone verification follows the Test Assurance policy's deterministic
fallback rule. With explicit project opt-in and a v2 binding, resolve
`../../scripts/verification.cjs` relative to this installed skill; read-only
status/review uses inspect or decide, and authorized implementation uses execute
for configured check IDs. Preserve human plan/ADR/triage gates. In orchestrated
mode consume the runner's evidence and never invoke this helper or write its
machine directory. A missing helper or unsupported binding retains fresh checks.

## Sources

- Process: the project root `AGENTS.md`. Read it unless the host already
  assembled it into this session. Before status reporting,
  recognize the layout: target when `AGENTS.md` carries `## Authority` and
  `## Policies` with no line beginning with `@`, and the `CLAUDE.md` shim is
  absent or carries no policy heading.
  Policy headings for layout recognition are `## Decision Consultation`,
  `## Test Assurance`, `## Security Assurance`, `## Engineering Quality`,
  and `## Plan Task Completion Evidence`.
  On partial report the exact ambiguity without changing source or guessing
  precedence. Read process from the installed plugin's packaged `AGENTS.md`
  (`../../AGENTS.md` from this skill) and policies from `../../policies/`
  for the report only; project policy bodies are never applicable rules.
  Approved project decisions retain their authority. Stop if an installed
  source is unreadable. Bootstrap may apply only explicitly approved merges.
  Unadopted means neither file has `## Authority` or a policy heading; keep
  existing missing-manifest behavior. Every other combination, including an
  unreadable file, is partial. Skip this recognition rule in the plugin source
  repository. Never read a policy body from a project file.
- Policies, resolved as `../../policies/<name>.md` from this `SKILL.md`,
  never from the project working directory or a fixed plugin cache path.
  Stop before affected work if a required source is absent or unreadable;
  never substitute a project copy, an inline policy or memory:
  - `plan-task-completion.md` when interpreting strict plan authority or completion evidence.
   - `artifact-storage.md` before resolving, reading or writing work artifacts.

## Scan

- `<work role>`
- `<description role>`
- `<plan role>`
- `<implementationReport role>`
- `<testReport role>`
- `<reviewDirectory>/review-*.md`
- `documentation/decisions/README.md`
- `documentation/decisions/NNNN-*.md`
- `<changeReport role>`
- `git status`
- `.banzai/active-run.json`, if present

For each `description.md`, check whether **Open Questions & Risks** is
`None outstanding`.

When an active orchestrator run exists, its persisted state owns the next action
for that slug. Report the run status and the next action `banzai status` reports,
and mark artifact-derived next actions as secondary. This includes terminal
orchestrated runs: never replace persisted `nextAction: null` with
`code-writing` solely because immutable approved plan boxes remain unchecked.

## Review Formats

Recognize runner-produced `banzai-feature-review/v4` and standalone
`banzai-standalone-review/v1`. Report any other marker as unsupported without
interpreting its contents as current review evidence.

## Task Completion Evidence

Apply Plan Authority in the installed `policies/plan-task-completion.md` to
strict obligations: permitted guidance differences do not make work incomplete,
and structural validity does not prove required behavior or checks. Preserve
legacy approved meaning and report missing or contradictory material evidence.

Report task completion separately from lifecycle, and name its source:

1. `structured completion evidence` only when the supported canonical ledger,
   approved plan digest, required reports, deterministic Markdown projection,
   and persisted validated summary agree;
2. `plan checkbox` for standalone or non-approved mutable work without
   orchestrator evidence;
3. `unknown` when an orchestrated run has not persisted canonical completion
   evidence; report prose cannot establish exact completion;
4. `inconsistent` when supported evidence is malformed, incomplete, or
   contradictory.

A terminal `done` orchestrated run may show `N/N externally completed` only
when approval, reports, all task evidence, and terminal review or human-triage
evidence agree. State `done` or file presence alone is insufficient. An active
`implementing`, `fixing`, `verifying`, `reviewing`, or gated run remains active
and may show only proven partial task evidence. A terminal inconsistency keeps
the persisted lifecycle and next action visible and recommends an
artifact/evidence audit, not plan-checkbox mutation.

Never parse report prose into a fabricated `N/N`. The report table is a
projection and cannot independently establish completion. Persisted state
continues to determine lifecycle and `nextAction` even when task completion is
unknown or inconsistent.

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
