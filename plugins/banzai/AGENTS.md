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
Work documents own requirements, execution plans, and human-reviewed reports.
New work uses `documentation/work/<slug>/` with sibling Markdown files; explicit
existing work retains its known paths. Raw execution evidence stays ignored
under `.banzai/`. No document migration or layout registration is required.
This file owns process. Do not choose between a current manifest fact and
accepted ADR intent; report the current/target difference and stop unless an
approved plan reconciles it.

- English only in committed code comments, docs, reports, and commit messages.

## Execution Modes

Banzai supports orchestrated runner phases and standalone skill sessions:

- Orchestrated, the default for CLI work: the `banzai` CLI first asks the
  configured planner model to select `quick-fix`, `feature`, or `strict` through
  a read-only structured contract. It then drives the selected route, owns
  deterministic verification, and collects every human decision interactively.
  For each phase of the selected route, the runner supplies embedded phase
  instructions, shared guidance and applicable policies directly to the model;
  it does not load or chain standalone chat skills. Workflow selection remains
  prompt-only.
  Strict code phases receive `BANZAI_RUN_ID` plus
  `BANZAI_APPROVAL_DIGEST`; lite code receives `BANZAI_RUN_ID` plus
  `BANZAI_WORKFLOW_DIGEST`. Both orchestrated reviewers are read-only and
  receive `BANZAI_RUN_ID` plus `BANZAI_APPROVAL_DIGEST` for review context,
  without artifact write authorization. They read approved artifacts, source,
  policies, verification logs and completion evidence and return review-result
  v2. The hook denies every mutation during review, including stale inherited
  write grants. The runner renders and validates an attempt-owned candidate
  before publishing canonical `banzai-feature-review/v3` Markdown for bound work (historical v2 remains readable).
- Standalone: one agent session runs the skills directly. Decisions are answered
  in chat instead of the CLI. The reviewer owns the durable
  `banzai-feature-review/v1` Markdown artifact.

Gate rules are identical in both modes. Only the channel that answers a
decision changes.

## Roles

Orchestrated work assigns phase responsibilities to three model roles so review stays independent:

- planner: read-only workflow selection, then strict requirements, conditional
  architecture decisions and development planning;
- implementer: lite feature or quick-fix work; strict implementation and
  assurance, followed by accepted-finding fixes when human triage requires them;
- reviewer: independent source-read-only review, with no planner or implementer
  transcript. Compatible strict planning, implementation, and fixes share one
  builder lineage. The primary review starts a fresh independent reviewer;
  routine re-review may resume that reviewer for at most two deltas before a
  fresh full review. Both vendors return structured review evidence. The runner
  alone renders and validates the attempt-owned candidate and publishes the
  canonical review artifact.

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
- Artifact text must serve a decision, requirement, command, file, verification
  or follow-up, or useful explicitly optional implementation guidance under the
  installed plan policy. Delete unrelated prose.
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

| Artifact Storage | `policies/artifact-storage.md` | `feature-description`, `architecture-decision`, `development-plan`, `code-writing`, `test-writing`, `feature-review`, `feature-status`, `feature`, `quick-fix`, `project-manifest` | None |

Resolve each as `../../policies/<name>.md` relative to the installed `SKILL.md`,
never relative to the project working directory or a fixed plugin cache path.
Policy files are not copied into projects; policy updates arrive through the
installed plugin. Legacy projects migrate through explicitly invoked
`project-manifest` before affected work continues.

`plan-task-completion.md` owns both Plan Authority and Plan Task Completion
Evidence. Its authority convention applies only when the approved plan explicitly
establishes it; existing approved meanings and completion contracts are preserved.

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
- In orchestrated mode the runner owns final task checks and physical evidence.
  Strict checks come from the approved plan; additional candidates remain
  separate and cannot weaken required obligations. Do not repeat a supplied
  final command merely to recreate evidence. Identify any required missing
  check and create permitted tooling within the approved task scope.
- In standalone mode the implementing skill owns one final applicable manifest
  suite because no runner supplies that boundary.
- In orchestrated review, current runner verification is the default command
  evidence. Rerun only a focused reproduction or a command whose evidence is
  missing, stale, inconsistent, or directly material to a finding; record the
  reason. Never run formatter fixes in review.
- New project configuration uses schema 4 without mandatory profiles or
  bootstrap. Discovery supplies information, never execution permission. Missing
  optional tooling is a normal starting state; mandatory failed or unavailable
  checks prevent confirmed completion.
- `banzai doctor` inspects project guidance, configuration and execution
  prerequisites read-only. It never runs checks or asks for profile coverage.

## Decision Gates

A gate stops work until a human decides. There are five existing gates:

- a material planning choice after repository analysis
  (`decision_consultation`);
- ADR acceptance, before planning relies on the decision (`adr_approval`);
  the owner may request rework with required feedback or independent read-only
  planning review, followed by explicit human planning-review triage;
- plan approval, bound to the exact description, accepted ADRs, and plan
  (`plan_approval`); the owner may request required-feedback rework or an
  independent planning review. Revisions return to approval; advisory model
  recommendations and triage never approve or accept an ADR;
- an escalation trigger discovered in any phase (`escalation`);
- review triage, because only human-accepted findings reach a fix.

Orchestrated model phases return their existing named gates and the CLI asks
for the human decision. Models cannot write runner control files. Standalone
runs ask their existing gates in chat. Task verification requires no separate
profile-configuration approval.

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
- `test-writing` -> task verification, then `feature-review`; required failures
  preserve implemented work and use the eligible verification retry path;
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

The hook is a backstop, not one of the decision gates. Skill escalation
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
