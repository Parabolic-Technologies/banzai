# ADR 0061: Initiative Skill and Documents

## Status / Date / Owner / Decision Makers

- Status: Accepted
- Date: 2026-11-05
- Owner: Banzai maintainers
- Decision makers: Repository owner; explicitly accepted in chat on 2026-11-05
  with `Accept, all recommended`.
- Acceptance date: 2026-11-05
- Accepted proposal SHA-256: `f411a53c111b2dab3ff57662ac132783e07778b64ca5e1b31931a0779237af67`.
- Lifecycle effect: the narrow amendments of ADR-0054 and ADR-0041 and the
  consequential amendment of ADR-0036 in Lifecycle Links are accepted, and
  their reciprocal links are recorded. The proposal-stage wording and the
  decision body are retained unchanged. Dependent planning is authorized; plan
  approval is still required before implementation.
- Owner choices (section 8): accepted as written, with the recommended
  answers: no runner-delivered instruction changes; the brief's SHA-256 in the
  tracker with the re-freeze stop; explicit invocation only.
- Implementation state: Implemented except the checkout-local hook
  reconciliation, an owner follow-up.
- Preparation authority: the owner's decisions of 2026-11-03 (add the
  brief-and-tracker method as WP19, keep initiative documents in
  `documentation/initiatives/<slug>/`, decline a nested work layout) and of
  2026-11-05 (WP19 moves to Stage 1 as the next package). Preparing this
  proposal is not acceptance; no code may rely on it.

## Related Artifacts

- Program tracker, WP19 row and owner decisions:
  [tracker.md](../work/release-2-8-2-9-program/tracker.md). WP19 is not in the
  [brief](../work/release-2-8-2-9-program/brief.md); the tracker records that
  deviation.
- Working example: the program's own `brief.md` and `tracker.md`. They stay in
  `documentation/work/release-2-8-2-9-program/`.
- Repository authority: [AGENTS.md](../../AGENTS.md),
  [PROJECT_MANIFEST.md](../../PROJECT_MANIFEST.md) and the
  [decision lifecycle](./README.md#lifecycle).
- Related accepted decisions:
  - [ADR-0054](./0054-git-visible-work-artifacts.md) (pinned): flat
    `documentation/work/<slug>/` directories, human decision records kept in
    that convention, no "status document solely for navigation", no
    migration, and a source-tree exemption for "the fixed work-document
    subtree" only. Amended narrowly (sections 1 and 6).
  - [ADR-0041](./0041-artifact-retention-and-publication-boundary.md), as
    partially superseded by ADR-0054: "An unknown documentation path needs
    classification" and no unrestricted exception. Amended narrowly
    (section 6).
  - [ADR-0036](./0036-vendor-neutral-policy-files-and-instruction-delivery.md):
    the policy read matrix that every skill must agree with. Gains one row
    (section 7).
  - [ADR-0055](./0055-planning-gate-rework-and-independent-planning-review.md):
    runner-rendered planning-review siblings in the flat work directory.
    Preserved.
  - [ADR-0001](./0001-automatic-workflow-selection.md) and
    [ADR-0018](./0018-agent-supervised-banzai-cli-control.md): workflow
    selection and the explicit-only `orchestrate` skill. Preserved: an
    initiative is not a workflow route, and the new skill never runs the
    `banzai` CLI.
  - [ADR-0042](./0042-runner-delivered-phase-instructions.md) and
    [ADR-0044](./0044-instruction-baseline-evolution.md): runner-delivered
    phase instructions and instruction baselines. Preserved: no
    runner-delivered instruction changes (section 7).
  - [ADR-0027](./0027-exposure-driven-security-assurance.md): exposure classes
    used in Compliance and Confirmation.

## Context and Decision Drivers

Decision question: how should Banzai support work that spans several packages,
stages and owner gates, so that a long effort keeps one plan and one living
record while each package still runs through the existing workflows?

Inspection on 2026-11-05 at `e26ea54` found:

| Evidence                                                                                                                 | Current behavior and consequence                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The eleven skills under `plugins/banzai/skills/`                                                                         | Each works on one work: `feature-description` writes one `description.md`, `development-plan` one `plan.md`, and `feature-status` reports features and ADRs read-only. No skill holds a plan above one work or the decisions taken between works.                                                                                                                                                                                        |
| `documentation/work/release-2-8-2-9-program/`                                                                            | The 2.8–2.9 program uses a hand-made method: a frozen `brief.md` with packages, "Done when" items and gates, and a living `tracker.md` with package rows, gate lists, ADR reservations, owner decisions, open questions and deviations. Six packages were delivered with it across many sessions, each starting from the tracker. Nothing detects an edited brief, a row marked committed without a commit, or an ADR ID reserved twice. |
| ADR-0054                                                                                                                 | Puts "human decision records and handoff documents that need engineer review" in the flat work convention, which is where the program lives. There the initiative is one more work directory beside its own packages, and the convention defines no frozen or living document roles.                                                                                                                                                     |
| Runner work binding (`directoryPattern`) and plan task completion checks                                                 | Bind one flat work directory per run. A nested `work/<initiative>/<wp>/` layout would break them.                                                                                                                                                                                                                                                                                                                                        |
| `packages/orchestrator/scripts/publication-check.mjs` and the checkout-local copy under `.git/hooks/banzai-publication/` | Exempt only `documentation/work/<slug>/` from per-file classification, and scan only that subtree for private binding content. A new documentation root fails `PUBLICATION_UNCLASSIFIED` in both.                                                                                                                                                                                                                                        |
| `packages/orchestrator/scripts/check-release.mjs`                                                                        | Holds a closed skill list. Every listed skill except `orchestrate` must carry a `## Sources` policy list and the legacy-layout diagnostic that match the ADR-0036 matrix.                                                                                                                                                                                                                                                                |
| `plugins/banzai/hooks/spec-gate.cjs`                                                                                     | Leaves `documentation/**` free in manual sessions and lets runner planning phases write documentation outside `documentation/work/`. No hook protects a document root by owner.                                                                                                                                                                                                                                                          |
| `orchestrate` and `project-manifest` frontmatter                                                                         | Explicit-only skills already exist: Claude `disable-model-invocation: true`, Codex `policy.allow_implicit_invocation: false`. WP5 verified for Claude Code that such a description costs no context; Codex was not tested.                                                                                                                                                                                                               |
| `project-manifest` scaffolding                                                                                           | Never overwrites an existing `AGENTS.md`, so a template change reaches only newly adopted projects.                                                                                                                                                                                                                                                                                                                                      |

Drivers:

- Orientation: a new session finds the next package, its brief section and
  the open decisions in one file.
- Authority: initiative documents record decisions. They never accept an ADR,
  approve a plan, triage a review or authorize a commit.
- Plan integrity: the brief stays frozen, and departures are recorded.
- Small footprint: no runner, CLI, contract or binding change, and almost no
  context cost in sessions that do not use an initiative. The brief's WP5
  reports always-loaded skill text as a cost, and its WP12 slims the template.
- Both hosts and both modes: Claude Code and Codex; packages run standalone or
  orchestrated.
- No migration, as ADR-0054 decided.
- The owner's choice of 2026-11-03: a separate `documentation/initiatives/`
  root, with packages kept flat.

## Options Considered

| Option                                                                                             | Benefits                                                                    | Costs and disposition                                                                                                                                                                                                                   |
| -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A user guide describing the method                                                                 | No new product surface                                                      | Nothing checks the brief, rows or reservations; every session re-derives the method. Rejected.                                                                                                                                          |
| Extend existing skills: `feature-description` writes the brief, `feature-status` keeps the tracker | Reuses existing skills                                                      | No existing skill works above one work. Tracker writes would spread across skills and runner phases that hold exact write grants, and `feature-status` is read-only. Rejected.                                                          |
| Runner support: `banzai initiative` commands with state under `.banzai/`                           | Machine-enforced checks; could gate runs                                    | Needs a control-protocol revision, new persisted contracts and CLI surface. The runner needs no initiative knowledge to run one package, and the tracker would become machine state instead of a reviewable document. Rejected for now. |
| The skill, with initiative documents in an ordinary flat `documentation/work/<slug>/`              | Needs no amendment of ADR-0054 or the publication boundary                  | The initiative stays one more work directory among its own packages, and a work directory then holds roles no workflow defines. The owner chose a separate root on 2026-11-03. Rejected.                                                |
| Nested layout `documentation/work/<initiative>/<wp>/`                                              | One IDE node per initiative                                                 | Breaks ADR-0054 flatness, the runner directory pattern and plan task completion checks. Declined by the owner on 2026-11-03. Rejected.                                                                                                  |
| An explicitly invoked `initiative` skill with its own document root; packages stay flat            | Git-reviewable documents, no runner change, context cost only on invocation | Checks run only when the skill runs, the user must invoke it, and the publication boundary gains a second fixed root. Selected.                                                                                                         |

## Decision

### 1. Keep initiative documents in their own root

Store the documents of a newly started initiative in
`documentation/initiatives/<slug>/`. Name it under the ADR-0054 slug rules:
stable, repository-unique, lowercase kebab-case, with no date, status or owner
level. The directory holds only these sibling files:

```text
documentation/initiatives/<slug>/
  brief.md             # the owner's plan, frozen at start
  tracker.md           # the only living record of the initiative
  gate-<N>-report.md   # one per stage gate
```

Add no index, metadata or placeholder file. Each package of the initiative is
an ordinary flat work directory, `documentation/work/<slug>/`, with its usual
document roles. Nest nothing under the initiative and add no initiative file to
a work directory. The handoff asks the package's requirements document, when
its route writes one, to link the brief section it implements.

This narrowly amends ADR-0054 by adding a second fixed document root for
documents that span several works. The tracker is allowed there because it
records owner decisions, deviations, reservations and gate state, not
navigation alone. Work-directory flatness, slug rules, Git visibility and the
no-migration rule stay as ADR-0054 decided.

### 2. Freeze the brief and keep one living tracker

The brief is the owner's plan: goal, context, decisions already made, stages
with their packages and "Done when" items, gates, and what is out of scope.
After the owner approves it at start, never edit it. Record every departure
under the tracker's deviations.

Record the brief's SHA-256 in the tracker's brief digest line at start (owner
choice 2). Every mode compares the brief with it before acting. On a mismatch,
or when no digest is recorded, the skill reports it, `next` hands off no
package, and the only write allowed is a re-freeze: one `record` that adds the
owner's decision, in the owner's words, to freeze the current bytes and
updates the digest line to match. An initiative started before this skill,
such as the 2.8–2.9 program, therefore needs that decision before its first
write or handoff.

The tracker holds a status line, the brief digest line, the baseline commit,
one package table per stage (package, dependencies, ADR, work directory,
status, commit, notes), the gate lists, ADR reservations, owner decisions,
open questions and deviations. Record each owner decision with its date and
the owner's exact words from the session, with personal names and private
links replaced when the owner so chooses. Never infer or invent an owner
decision.

### 3. Deliver the method as one explicitly invoked skill

Add a plugin skill named `initiative`. It is entered only when the user
invokes it by name: `disable-model-invocation: true` for Claude Code and
`policy.allow_implicit_invocation: false` for Codex (owner choice 3). Each
invocation runs one mode:

- `start`: store the owner's brief as `brief.md` after asking whether to
  replace personal names and private links, then build `tracker.md`. Refuse
  when the directory exists.
- `next`: read-only orientation. Read the tracker and the next package's brief
  section, reconcile the rows with Git history, report drift, and hand off one
  package: its slug, its route, its brief section, and its "Done when" items as
  requirements to number.
- `record`: change one tracker row or add one owner decision, deviation, open
  question or ADR reservation. An ADR reservation first checks the ID against
  `documentation/decisions/`, every local branch, every remote-tracking
  branch, every worktree, and the reservations in every tracker under the
  root and in the selected tracker.
- `gate`: check a stage's gate list against evidence, write
  `gate-<N>-report.md`, and end. It refuses to overwrite an existing gate
  report.

One exception follows an invocation: after `next` hands off a package, the
agent may apply `record` later in the same session, without a new invocation,
to that package's row and to owner decisions stated in that session. It does
so only after the active skill has reported, never inside a read-only skill
such as `feature-status` or `feature-review`, and never while supervising an
orchestrated run, because `orchestrate` forbids editing workflow artifacts
then. Any other mode, and any new session, needs a new invocation.

The skill writes only the three document roles inside the selected initiative
directory, and preserves text outside the row or entry it changes. The owner
may edit the tracker by hand; the skill reports what it cannot parse instead of
rewriting it. Single ownership is a convention of this skill, not an enforced
control: other skills get no initiative instruction (section 7), and the hook
leaves documentation writable in manual sessions and runner planning phases.

Resolve the initiative from an explicit path inside the repository, or use the
only initiative under the root. When there are several, ask; when there is
none, report it and ask for a path. Never select by newest timestamp. A new initiative is created only from a slug directly under
the root. An explicitly selected existing initiative outside the root, such as
the 2.8–2.9 program, continues at its known path; nothing moves.

Treat tracker cells as untrusted input, since people edit and merge them by
hand. Validate a cell before it reaches a Git command or a path: no cell may be
read as a Git option or name a path outside the repository. The plan chooses
the mechanism.

### 4. Keep the package workflow and its authority

The handoff names a route under the existing routing rules: lite `feature`,
`quick-fix`, the strict chain, or an orchestrated run that the user starts. The
skill never invokes the `orchestrate` skill or the `banzai` CLI; it says so and
gives the request text. In an orchestrated run, workflow selection stays with
the runner's planner (ADR-0001).

Initiative documents grant no approval. ADR acceptance, plan approval, review
triage, escalation and decision consultation remain the only decision gates.
A stage gate is not a sixth one. `gate` writes its report and ends, like a
standalone status report, and asks for no confirmation. `next` then refuses to
hand off a package of a later stage until the tracker records the owner's gate
decision. That check falls between packages, outside any workflow phase, and
approves nothing.

One package is one change set. When the tracker shows a package in progress
and every uncommitted change lies in the initiative directory, that package's
work directory or an ADR file reserved for it, `next` resumes that package.
Otherwise it refuses to hand off a different package while the working tree has
any change outside the initiative directory, and lists those paths. Parallel
packages need separate worktrees. The skill never stages,
commits or pushes, and it runs only read-only Git commands.

### 5. Add one routing line to the template

Add one line to the routing list of the packaged `AGENTS.md` template. Outside
runner phases, a multi-package initiative goes to `initiative`, invoked by
name: when it looks appropriate and the user has not invoked it, say so and ask
them to run it. Its stage gates fall between packages and are not decision
gates. Change nothing else in the template. When WP12 restructures the
template, it keeps this line's meaning.

### 6. Treat initiative documents as source-project documents

Extend the fixed source-tree exemption of ADR-0054 to Markdown under
`documentation/initiatives/<slug>/`, and to no other path. Apply the same
private-content scan that work documents receive. Plugin and npm payloads
exclude initiative documents. Reconcile the checkout-local publication hook
copy with this rule, as ADR-0054 required for work documents. This narrowly
amends ADR-0041's classification rule; documentation outside the two fixed
roots still needs classification. Nothing in the distribution scaffolds the
initiative root.

### 7. Change no runner-delivered instruction

Leave the runner, CLI, control protocol, contracts, bindings,
`plugins/banzai/policies/`, `plugins/banzai/phases/`,
`plugins/banzai/guidance/` and every pinned skill resource byte-identical.
`phase-guidance-current.json` gains no transition (owner choice 1).
`feature-status` does not report initiatives.

The new skill states its own rules and reads the project `AGENTS.md` as its
process source. It reads no policy file, so its `## Sources` names no policy;
the ADR-0036 read matrix gains an `initiative` row with no policy duty. It
keeps the ADR-0036 layout recognition and stops on a legacy or partial layout
with the standard diagnostic; it is not one of the two bootstrap exceptions.
The release layout check lists the skill on those terms.

### 8. Owner choices

Acceptance with the recommended answers settles these choices as written
above.

1. Shared instruction footprint.
   - (a) Recommended: section 7 as written.
   - (b) Also add an initiative paragraph to `policies/artifact-storage.md` and
     an initiative report to `feature-status`. Both are pinned resources, so
     each needs a recorded instruction transition, and the policy text is
     delivered inline to every runner phase of every project, with or without
     an initiative.
2. Brief integrity.
   - (a) Recommended: the SHA-256 in the tracker and the stop in section 2.
   - (b) An instruction-only freeze, with Git history as the only evidence.
3. Invocation.
   - (a) Recommended: explicit invocation only, as section 3 says.
   - (b) Model invocation in adopted repositories. The skill description then
     enters every session's skill list, including projects with no initiative.

## Consequences

Positive:

- One file orients every session. An edited brief, a stale row, a duplicate
  ADR ID or a row marked committed without a commit is reported when the skill
  runs, not discovered late.
- The runner, CLI and pinned instructions stay untouched, so the change
  carries no orchestration risk.
- The method works the same for standalone and orchestrated packages and on
  both hosts.

Negative:

- Checks run only when the skill runs; nothing enforces them between
  invocations. A runner-enforced version needs a new ADR.
- Single ownership of initiative documents is a convention; no hook or other
  skill enforces it.
- The user must invoke the skill; an agent can only suggest it.
- `feature-status` does not show initiatives (owner choice 1).
- The template line reaches every session of a newly adopted project,
  including runner phases that load the project `AGENTS.md`. Existing adopted
  projects never receive it, because `project-manifest` does not overwrite
  their `AGENTS.md`.
- Whether a Codex skill with implicit invocation disabled still costs context
  is unverified.
- Parallel packages in separate worktrees each change `tracker.md`; those
  edits are merged by hand.
- Adopted repositories gain a second documentation root, and the publication
  boundary a second fixed exemption.

Follow-ups:

- WP19 requirements and plan in `documentation/work/wp19-initiative-skill/`.
- WP12 keeps the routing line's meaning when it slims the template.
- Later, separately decided: initiative status in `feature-status` and runner
  awareness of initiatives.

## Compliance and Confirmation

The following are implementation acceptance checks, not results of this
proposal.

| Guarantee                  | Observable confirmation                                                                                                                                                                                                                                                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Explicit invocation only   | `skills/initiative/SKILL.md` has `user-invocable: true` and `disable-model-invocation: true`; `skills/initiative/agents/openai.yaml` has `policy.allow_implicit_invocation: false`. `release-policy.json`, `publication-policy.json` and the release layout check cover the new files.                                    |
| No runner-delivered change | `phase-guidance-current.json`, the generated `phase-resources.ts`, policies, phases, guidance and pinned skill resources are byte-identical to the base commit. Runner source and contracts are unchanged.                                                                                                                |
| Policy matrix              | The release layout check lists `initiative` with a `## Sources` that names no policy and with the legacy-layout diagnostic, and fails if a policy read is added. On a legacy or partial layout the skill stops with that diagnostic.                                                                                      |
| Initiative root            | In a disposable repository, `start` creates exactly `brief.md` and `tracker.md` in `documentation/initiatives/<slug>/`; a second `start` with the same slug refuses. Packages land in `documentation/work/<slug>/` with no initiative file.                                                                               |
| Frozen brief               | After `start`, the brief matches the digest line. After an edit, or with no digest, every mode reports it, `next` hands off no package, and the only write is a re-freeze that records the owner's decision and updates the digest line.                                                                                  |
| Read-only orientation      | `next` leaves the working tree byte-identical. It resumes an in-progress package whose changes lie only in the initiative directory, its work directory and its reserved ADR files; otherwise it refuses a handoff while a change exists outside the initiative directory, listing the paths.                             |
| Records                    | `record` changes only the named row or entry, or for a re-freeze the decision and the digest line, and preserves other text. Owner decisions carry a date and the owner's words. An ADR reservation refuses an ID found in any source section 3 names.                                                                    |
| Gates                      | `gate` writes `gate-<N>-report.md`, refuses an existing one and ends; no later-stage package is handed off until the decision is recorded.                                                                                                                                                                                |
| Tracker input              | A hand-edited cell shaped as a Git option or naming a path outside the repository is reported and never reaches Git or the filesystem.                                                                                                                                                                                    |
| Authority                  | The skill text forbids staging, commits, pushes, CLI runs and invoking `orchestrate`. The five decision gates in the packaged `AGENTS.md` are unchanged.                                                                                                                                                                  |
| Publication                | Source checks accept initiative Markdown without per-file entries and scan it for private content; plugin and npm payload checks reject it; other unclassified documentation still fails. Reconciling the checkout-local hook is a separate step that needs the owner's authorization, reported apart from source checks. |
| No migration               | No existing work directory moves; `documentation/work/release-2-8-2-9-program/` stays in place.                                                                                                                                                                                                                           |

Security exposure covers three classes. Class 1: the slug and tracker cells
become filesystem paths and Git arguments, so new initiatives take only a
kebab-case slug directly under the root, explicit paths stay inside the
repository, and no cell can act as a Git option or leave the repository. Class
4: an owner brief and recorded owner words can carry personal names and private
links, so `start` and `record` ask before storing them, and no raw logs or
credentials are copied into the tracker or a gate report. Class 7: overwriting
is bounded, because `start` and `gate` refuse existing files, the brief is
never rewritten, and `record` changes only its own entry. Class 2 does not
apply: the decision adds no access check, and single ownership is stated as a
convention, not a control. The decision adds no secret-handling,
cross-principal or outbound-request surface.

## Lifecycle Links

- Narrow amendment of [ADR-0054](./0054-git-visible-work-artifacts.md)
  (sections 1 and 6). On acceptance, record the reciprocal link on ADR-0054.
  ADR-0054 is pinned, so the exact before and after images go into the
  allow-list in `packages/orchestrator/scripts/phase-resources-build.mjs`.
- Narrow amendment of
  [ADR-0041](./0041-artifact-retention-and-publication-boundary.md)'s
  classification rule (section 6), with a reciprocal link on acceptance.
- Consequential amendment of
  [ADR-0036](./0036-vendor-neutral-policy-files-and-instruction-delivery.md):
  its read matrix gains the `initiative` row (section 7), with a reciprocal
  link on acceptance.
- Partially superseded by
  [ADR-0066](./0066-date-prefixed-work-and-initiative-slugs.md), accepted
  2026-11-10: a new initiative directory name begins with its local creation
  date as `yymmdd-`, replacing only the "with no date" part of the slug rule
  in section 1. All other rules of this ADR stay in force.
- Supersedes: None.
- Superseded by: None.
