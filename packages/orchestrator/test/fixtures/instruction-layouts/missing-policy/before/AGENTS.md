# AGENTS.md

Workflow rules for Banzai skills.

## Authority

Resolve implementation and review conflicts in this order:

1. explicit approved user or specification decision;
2. accepted ADR;
3. executable or public contracts and established repository invariants;
4. `PROJECT_MANIFEST.md` facts and dominant local conventions;
5. generic Engineering Quality preference.

Tests and observed behavior are evidence for these authorities, not an
independent authority tier. A legacy test does not automatically override an
approved change that intentionally changes behavior.

`PROJECT_MANIFEST.md` owns current implemented project facts: stack, commands,
architecture, conventions, dependencies, and active ADR links. Accepted ADRs
own architectural intent, rationale, consequences, and decision history.
Feature artifacts own requirements, execution plans, and verification evidence.
This file owns process. Do not choose between a current manifest fact and
accepted ADR intent; report the current/target difference and stop unless an
approved plan reconciles it.

- English only in committed code comments, docs, reports, and commit messages.

## Execution Modes

The same skills run in two modes:

- Orchestrated, the default for CLI work: the `banzai` CLI first asks the
  configured planner model to select `quick-fix`, `feature`, or `strict` through
  a read-only structured contract. It then drives the selected route, owns
  deterministic verification, and collects every human decision interactively.
  Strict code phases receive `BANZAI_RUN_ID` plus
  `BANZAI_APPROVAL_DIGEST`; lite code receives `BANZAI_RUN_ID` plus
  `BANZAI_WORKFLOW_DIGEST`. A reviewer-write phase also receives
  `BANZAI_REVIEW_ARTIFACT`, bound to its active attempt-owned candidate and the
  only repository path it may write. A runner-rendered review receives no
  artifact write authorization. The runner validates either candidate before
  publishing canonical review state.
- Standalone: one agent session runs the skills directly. Decisions are answered
  in chat instead of the CLI.

Gate rules are identical in both modes. Only the channel that answers a
decision changes.

## Roles

Orchestrated work assigns skills to three model roles so review stays
independent:

- planner: read-only workflow selection, then `feature-description`,
  `architecture-decision`, and `development-plan` for strict work;
- implementer: `feature` or `quick-fix` for lite work; `code-writing`,
  `test-writing`, and accepted-finding `quick-fix` for strict work;
- reviewer: `feature-review`, source-read-only, with no planner or implementer
  transcript. Compatible strict planning, implementation, and fixes share one
  builder lineage. The primary review starts a fresh independent reviewer;
  routine re-review may resume that reviewer for at most two deltas before a
  fresh full review. Claude may write only the designated attempt-owned review
  candidate, while a read-only Codex review returns structured evidence for the
  runner to render as a candidate. The runner alone validates and publishes the
  durable canonical review artifact.

The reviewer never fixes its own findings. The implementer never triages them.
The fixer may read the review artifact for cross-model context, but only the
human-triaged structured finding payload defines its scope.

When triage accepts no finding, the strict run finishes from the recorded human
decision without another unchanged-source review. This completion is not a
reviewer `pass`. When triage accepts any finding, the accepted-only fix and
re-review policy below remains unchanged.

The runner rotates the reviewer to a fresh full review when its session or
model binding is missing or changed, the approved bundle changed, the previous
review failed, was interrupted, or blocked, a blocker or security finding was
accepted, or two delta reviews completed. Every fresh and resumed review
reapplies source-read-only restrictions; rotation is not a human gate.

## Routing

`orchestrate` is an explicit outer operator skill only, and it carries
`disable-model-invocation: true`. It runs only when the user invokes it by name
(`/` or `$`). A prompt that mentions Banzai, the orchestrator, the CLI, or an
existing run is not an invocation: never select it from prompt wording, never
select it for an ordinary feature, fix, plan, status, review, or inspection
request, and never add it to an inner planner, implementer, fixer, selector, or
reviewer skill chain. When Banzai orchestration looks appropriate but the user
has not invoked the skill, say so and ask them to run it; do not reproduce its
workflow or call the `banzai` CLI directly instead. If `BANZAI_RUN_ID`,
`BANZAI_APPROVAL_DIGEST`, or `BANZAI_WORKFLOW_DIGEST` is present, it must
invoke no nested CLI process and write nothing.

- New capability -> `feature`.
- Bug, polish, refactor, review cleanup -> `quick-fix`.
- Architecturally significant decision -> `architecture-decision`.
- Formal requirements/design gates -> strict mode:
  `feature-description` -> conditional `architecture-decision` ->
  `development-plan` -> `code-writing` -> `test-writing` -> `feature-review`.
  Run strict mode through the orchestrator when it is configured for the
  project.
- Missing or stale stack/tooling facts -> `project-manifest`. It carries
  `disable-model-invocation: true`: it runs only when the user invokes it by
  name (`/` or `$`). When the manifest is missing or stale, say so and ask the
  user to run it; do not scaffold its files another way instead.
- Status report -> `feature-status`.
- Artifact-aware audit -> `feature-review`.

The orchestrator selects the first safe route automatically. It chooses
`strict` for explicit strict work, any named escalation trigger, or any request
that is not confidently safe for a lite route. A lite skill that discovers a
trigger returns `gate=escalation` before source changes; after the human answers,
the planner selects again with that evidence. Standalone agents use the same
rules directly.

Inside strict planning, `decision_consultation` is a conditional gate, not a
route or mandatory phase. The planner first analyzes the request, manifest,
accepted ADRs, contracts, and relevant repository evidence. It uses consultation
only when one remaining human-owned product or architecture choice can
materially change requirements, architecture, compatibility, risk, a quality
attribute, or scope. Lite work and implementation/fix phases never use this
gate; their existing escalation behavior remains unchanged.

## Hard Rules

- Do not invent requirements.
- Ask only blocking questions. Record default decisions with reason and
  provenance.
- Do not ask for confirmation that is not a decision gate. Report and continue.
- Do not add dependencies without explicit user approval and manifest update.
- Do not change public contracts, persistence, security, privacy, or
  architecture without approval.
- Do not edit the body of an accepted ADR. Change a decision with a new linked
  ADR that supersedes it; only lifecycle metadata may change on the old record.
- Artifact text must be one of: decision, requirement, command, file,
  verification, or follow-up. Delete other prose.
- Apply the canonical Engineering Quality policy in the installed
  `policies/engineering-quality.md` within its authority and enforcement
  boundaries.
- Keep docs in sync with code and manifest changes.

## Escalation Triggers

Pause or route to strict mode when work touches:

- dependency, package manager, build step, code generator, external service;
- public API, schema, migration, storage format, protocol, event contract;
- auth, permissions, secrets, payments, privacy, compliance, destructive action;
- architecture, concurrency model, background processing, deployment topology;
- product behavior not determined by request, manifest, or existing behavior;
- large unrelated diff;
- repeated verification failure that changes the plan.

Name the trigger and get explicit user approval before code changes.
Orchestrated phases raise it as `gate=escalation` with the exact questions the
engineer must answer, and let the CLI collect the answers.

## Policies

| Policy                        | File                                | Read                                                                                                                                             | Conditional                                                                 |
| ----------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| Decision Consultation         | `policies/decision-consultation.md` | None                                                                                                                                             | `feature-description`, `architecture-decision`, `development-plan`          |
| Test Assurance                | `policies/test-assurance.md`        | `development-plan`, `code-writing`, `test-writing`, `feature-review`, `feature`, `quick-fix`                                                     | `project-manifest`                                                          |
| Security Assurance            | `policies/security-assurance.md`    | `feature-description`, `development-plan`, `feature-review`, `feature`, `quick-fix`                                                              | `architecture-decision`, `code-writing`, `test-writing`, `project-manifest` |
| Engineering Quality           | `policies/engineering-quality.md`   | `feature-description`, `architecture-decision`, `development-plan`, `code-writing`, `feature-review`, `feature`, `quick-fix`, `project-manifest` | None                                                                        |
| Plan Task Completion Evidence | `policies/plan-task-completion.md`  | `development-plan`, `code-writing`                                                                                                               | `test-writing`, `feature-review`, `feature-status`, `quick-fix`             |

Resolve each as `../../policies/<name>.md` relative to the installed `SKILL.md`,
never relative to the project working directory or a fixed plugin cache path.
Policy files are not copied into projects; policy updates arrive through the
installed plugin. Legacy projects migrate through explicitly invoked
`project-manifest` before affected work continues.

## ADR Eligibility

Create an ADR when a decision is cross-cutting, difficult to reverse, affects a
public contract or important quality attribute, or has multiple viable options
with meaningful trade-offs. Requirements and non-functional constraints are
inputs to the decision, not substitutes for it.

Do not create an ADR for:

- a product requirement or acceptance criterion;
- a local, reversible implementation choice;
- a default already fixed by the manifest, accepted ADR, or existing behavior;
- routine mechanics that belong in `plan.md`.

Feature work with an ADR-eligible choice routes to strict mode. A standalone
architecture request can use `architecture-decision` directly. Accept required
ADRs before `development-plan`; reject or rework unresolved proposals. ADR
acceptance always requires an explicit human decision gate.

## Verification

- Run commands from `PROJECT_MANIFEST.md`.
- During implementation, run focused affected checks for feedback.
- Formatter checks/fixes run only after code stabilizes, during final review or
  an explicit review pass.
- If formatting rewrites files, rerun affected typecheck/lint/tests.
- Never claim compile/test success without running the command, unless the
  manifest says no command exists.
- In orchestrated mode the runner also executes the project's configured
  verification profiles in profile order and then command order after each code
  phase. Writing prompts identify those commands. Do not repeat a supplied
  full-scope command merely to recreate final evidence. If the manifest's
  applicable final suite is absent from the supplied profiles, run it once and
  record the verification-readiness gap.
- In standalone mode the implementing skill owns one final applicable manifest
  suite because no runner supplies that boundary.
- In orchestrated review, current runner verification is the default command
  evidence. Rerun only a focused reproduction or a command whose evidence is
  missing, stale, inconsistent, or directly material to a finding; record the
  reason. Never run formatter fixes in review.
- New project configuration uses schema version 2 explicit profiles. Each
  detected root project type needs a matching profile with at least one
  substantive command; the `repository` profile and exact `git diff --check`
  are hygiene and do not prove project-type readiness.
- Run `banzai doctor` after configuring verification. It diagnoses profile
  coverage, executable availability, and local run-control evidence without
  executing commands, invoking vendors, recovering state, or writing files.
  Schema-version-1 flat verification remains executable but must be migrated
  manually before doctor reports it ready.

## Decision Gates

A gate stops work until a human decides. There are exactly five:

- a material planning choice after repository analysis
  (`decision_consultation`);
- ADR acceptance, before planning relies on the decision (`adr_approval`);
- plan approval, bound to the exact description, accepted ADRs, and plan
  (`plan_approval`);
- an escalation trigger discovered in any phase (`escalation`);
- review triage, because only human-accepted findings reach a fix.

Orchestrated runs return the named gate and the `banzai` CLI asks the engineer.
Standalone runs ask the same question in chat. Nothing else blocks.

## Progress Reports

Every other phase boundary produces a report and continues. A report is not a
gate: do not ask for confirmation to proceed.

Report output must include:

- changed paths;
- verification commands and outcomes;
- formatter result when run;
- deviations or follow-ups;
- remaining decisions.

Default continuations:

- `feature-description` -> `architecture-decision` when the description names
  ADR needs, otherwise `development-plan`;
- `development-plan` -> plan approval gate;
- `code-writing` -> `test-writing`;
- `test-writing` -> verification, then `feature-review`;
- `feature-review` -> review triage gate;
- review triage with no accepted findings -> done by human triage, without
  another review and without reporting reviewer `pass`;
- orchestrated `feature` and initial `quick-fix` -> runner-owned deterministic
  verification, then stop because the lite route ends there;
- accepted-finding `quick-fix` -> verification and policy-selected re-review;
- standalone `feature`, `quick-fix`, `feature-status`: report and stop.

Stop before finishing a phase only for a gate above, a blocking question with
no manifest or existing-behavior default, or a failure that invalidates the
approved plan.

## Hook Gate

`hooks/spec-gate.cjs` enforces authorized-workflow-before-code where supported.

- Free paths: `documentation/**`, `PROJECT_MANIFEST.md`, `CLAUDE.md`,
  `AGENTS.md`.
- Manual sessions are gated only in Banzai-adopted projects: the hook requires
  `.banzai/config.json` or a root `PROJECT_MANIFEST.md` in the session
  directory or a parent, and stays silent elsewhere because there is no spec
  or plan to protect.
- Standalone: the first code/codebase edit in a session asks for human approval,
  one approval unlocks later code edits in that session, and a new session
  re-locks.
- Orchestrated strict: the hook checks the active run and approved artifact
  digest, so approved code phases run without a per-edit prompt and writes to
  the approved bundle are denied.
- Orchestrated lite: the hook checks the active run and persisted
  `feature`/`quick-fix` selection digest. Selection itself is read-only, and
  workflow authorization never counts as plan approval.
- Claude Code: reliable after plugin reload.
- Codex: trust via `/hooks`; `apply_patch` may bypass hook interception.

The hook is a backstop, not one of the five decision gates. Skill escalation
gates still apply. ADR files are documentation and remain free to draft; the
hook does not accept decisions. The `architecture-decision` gate is
authoritative.

## Git

- Commit only when the engineer asks.
- Commit after the relevant report or decision gate, never inside a phase.
- Orchestrated runs never commit; the engineer owns the resulting diff.
- Message: `<type>(<slug-or-name>): <summary>`.
- Types: `feat`, `fix`, `test`, `docs`, `chore`.

## Dependencies

- Current stack choices live in `PROJECT_MANIFEST.md`; accepted changes are
  recorded in ADRs until implemented.
- Pre-existing dependencies need no retroactive approval.
- Any new runtime or dev dependency requires explicit approval and a manifest
  update.
