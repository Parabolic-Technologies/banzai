# ADR 0066: Date-Prefixed Work and Initiative Slugs

## Status / Date / Owner / Decision Makers

- Status: Accepted
- Date: 2026-11-10
- Owner: Banzai maintainers
- Decision makers: Repository owner; explicitly accepted in chat on 2026-11-10
  with `Accept ADR-0066`.
- Acceptance date: 2026-11-10
- Accepted proposal SHA-256: `5de91423822281275c29593967431015606d9be014f5167f8cec9053f9c0b5fa`.
- Lifecycle effect: the partial supersessions in Lifecycle Links are accepted.
  The proposal-stage wording and the decision body are retained unchanged. The
  reciprocal link on ADR-0061 is recorded at acceptance. ADR-0054 is a pinned
  instruction authority, so its reciprocal link is recorded by the first task
  of the dependent plan together with the admission of its exact file images.
  Dependent planning is authorized; plan approval is still required before
  implementation.
- Owner choices: given in chat on 2026-11-10 before drafting. The work takes
  the strict route with a new ADR; the prefix applies to every new work and
  initiative directory from every entry point; uniqueness compares the full
  directory name; the prefix uses the local calendar date (card C1); only the
  current date's prefix counts as already present (card C2). No owner choice
  is open.

## Related Artifacts

- Requirements:
  [description.md](../work/interactive-slug-selection/description.md),
  FR1-FR17 and Architecture Decision Need AD1.
- Code:
  - `packages/orchestrator/src/interactive.ts`: `generateFeatureSlug` and
    `startRun`;
  - `packages/orchestrator/src/cli.ts` (`banzai run`) and
    `packages/orchestrator/src/agent-control-cli.ts` (`banzai control start`):
    the two other callers of `WorkflowRunner.start`;
  - `packages/orchestrator/src/workflow/domain/run-identity.ts`: `runId` and
    `requireSlug`;
  - `plugins/banzai/lib/work-documents.mjs`: `workDirectory` and
    `createExecutionBinding`, which refuses an existing work directory with
    `ARTIFACT_WORK_CONFLICT`;
  - `packages/orchestrator/src/agent-control.ts`: capabilities advertise
    `workDocuments.directoryPattern: "documentation/work/<slug>/"`.
- Guidance: `plugins/banzai/policies/artifact-storage.md`,
  `plugins/banzai/skills/initiative/SKILL.md` and its tracker template,
  `documentation/artifact-storage.md`, `documentation/orchestrator.md`.
- Repository authority: [AGENTS.md](../../AGENTS.md),
  [PROJECT_MANIFEST.md](../../PROJECT_MANIFEST.md) sections 4, 6 and 9, and
  the [decision lifecycle](./README.md#lifecycle).
- Accepted decisions:
  - [ADR-0054](./0054-git-visible-work-artifacts.md): flat
    `documentation/work/<slug>/` directories; dates must not become required
    name prefixes. Partially superseded here.
  - [ADR-0061](./0061-initiative-skill-and-documents.md) §1: initiative slugs
    follow the ADR-0054 rules "with no date". Partially superseded here.
  - [ADR-0018](./0018-agent-supervised-banzai-cli-control.md): agent control.
    Unchanged; see Decision 6.
  - [ADR-0044](./0044-instruction-baseline-evolution.md): instruction changes
    are recorded as baseline transitions. Unchanged; this ADR is their
    authority.

## Context and Decision Drivers

Current state: the interactive session derives a slug from the request and
shows it, but the engineer cannot change it. `banzai run --slug` and
`banzai control start --slug` use the given slug as is. Standalone skills and
the initiative skill pick their own slugs. ADR-0054 and ADR-0061 forbid a
required date in work and initiative directory names. Starting a run refuses
an existing work directory, but no entry point looks at
`documentation/initiatives/`.

Target state: the owner wants every new work and initiative directory to start
with its local creation date as `yymmdd-`, with no way to remove the prefix,
and an interactive step where the engineer accepts the generated slug or types
an own one that is checked for uniqueness.

Drivers:

- FR1-FR4: one prefix rule and one uniqueness rule for every entry point.
- FR8: a slug accepted in the interactive step reaches the run unchanged,
  even when the local date changes before the start confirmation.
- FR10-FR12: scripted callers and agent supervisors keep working; runs and
  bindings created before the change stay valid.
- FR13-FR15: standalone skills and initiatives follow the same rule, although
  agents create those directories with ordinary file tools.
- Compatibility of public CLI behavior, agent-control contracts, binding v3,
  state schema and run IDs.
- Deterministic tests: the local date must be injectable.
- Proportional design: reuse the existing slug owners rather than adding a
  new subsystem.

## Options Considered

### Option 1: Finalize at each CLI entry point with one shared rule (selected)

A pure domain function computes the prefix from given local date parts and
finalizes a candidate slug. The interactive session, `banzai run` and
`banzai control start` each call it with the local clock before
`WorkflowRunner.start`. The shared work-document library checks name
conflicts in both roots, both read-only for the interactive step and
authoritatively when a run binds its work directory. Guidance carries the rule
to standalone skills and initiatives.

- Benefits: the slug the engineer accepted is the slug the runner receives,
  so FR8 needs no special case. The runner, binding and run identity stay
  date-agnostic, which keeps historical runs and in-process callers valid.
  One function owns the rule, and each public entry point has a direct test.
- Costs and risks: the in-process `WorkflowRunner.start` does not itself
  require the prefix, so a future entry point must call the finalizer.
  Standalone naming is enforced by guidance only.

### Option 2: The runner applies the prefix inside `WorkflowRunner.start`

- Benefits: one enforcement point for every orchestrated start.
- Costs and risks: the runner would re-date an interactively accepted slug
  after midnight, violating FR8, unless its input gains a "finalized" flag that
  every caller must set correctly. A local-calendar clock enters the runner.
  About 250 existing `start` calls and about 100 work-path assertions in tests
  would need date-dependent fixtures. Rejected: the boundary cannot tell an
  accepted slug from a requested one without a second input form.

### Option 3: The shared plugin library also owns the prefix

`plugins/banzai/lib/work-documents.mjs` would export the finalizer for both the
orchestrator and plugin scripts.

- Benefits: one owner for all slug mechanics.
- Costs and risks: no plugin script creates new work directories with a
  chosen slug; standalone agents name directories with file tools. The
  library's public declaration would grow without a consumer, and the
  orchestrator domain already owns slug validation. Rejected.

### Option 4: The hook denies writes that create an undated directory

- Benefits: mechanical enforcement for standalone sessions.
- Costs and risks: `spec-gate.cjs` is a pinned authorization backstop, not a
  naming validator. It cannot tell a new directory from explicit continuation
  of an existing undated one without new state, and Codex `apply_patch` may
  bypass it, so enforcement would differ by vendor. Rejected.

### Option 5: Keep the no-date rule

Rejected by the owner on 2026-11-10.

## Decision

1. **Name new directories with a creation-date prefix.** Every new
   `documentation/work/<slug>/` and `documentation/initiatives/<slug>/`
   directory uses a final slug of the form `yymmdd-<subject>`. The prefix is
   part of the slug: wherever a contract, document or tool writes `<slug>` for
   a new directory, it means the final, prefixed slug. This replaces the
   ADR-0054 rule that a date does not become a required name prefix and the
   "with no date" rule of ADR-0061 §1, for new directories only. All other
   ADR-0054 and ADR-0061 rules stay in force.

2. **Use the local date at finalization and recognize only today's prefix.**
   The prefix is the last two digits of the year, the zero-padded month and
   the zero-padded day of the machine's local calendar date when the slug is
   finalized, followed by `-`. A candidate that already begins with that
   prefix is kept; any other candidate receives it. No entry point offers a way
   to omit or replace the prefix.

3. **Finalize at the CLI entry points through one shared rule.** One pure
   function in the orchestrator's slug domain owns prefix computation,
   recognition and final-slug validation from injected local date parts. The
   interactive session finalizes when the engineer accepts the slug step;
   `banzai run` and `banzai control start` finalize when the command starts the
   run. Each passes the final slug to `WorkflowRunner.start`, which does not
   re-date its input and keeps validating lowercase kebab-case and the 100
   character bound. Every production caller of `WorkflowRunner.start` passes
   a finalized slug.

4. **Check uniqueness by full name in both roots.** The shared work-document
   library owns the name-conflict rule: a final slug conflicts when
   `documentation/work/<slug>/` or `documentation/initiatives/<slug>/` exists.
   The interactive step uses this rule read-only to keep its prompt open. Run
   start applies it again under the workflow lock and refuses, naming the
   existing path, before it creates the work directory or an active run. The
   comparison uses the full name only, so a subject repeated on another date
   is not a conflict.

5. **Carry the rule to standalone skills and initiatives through guidance.**
   The installed artifact-storage policy states the prefix, date, recognition
   and uniqueness rules for every skill that starts new work. The initiative
   skill applies them to `start` and to package work directories. A tracker
   row's work-directory cell holds the planned subject slug until the package
   starts; `next` hands off the dated name for the current date, and recording
   the package's progress writes the full name of the directory that was
   created. Cell validation accepts both forms. No hook enforces naming.

6. **Keep contracts, persistence and history unchanged.** Binding v3, state
   schema, run-ID format, agent-control contract `9.0.0`, capabilities v9,
   status v7 and the advertised `directoryPattern` do not change; the final
   slug already satisfies their kebab-case rules. Status reports the final
   slug. A supervisor passes a subject slug to `control start` and reports the
   slug that status returns. Existing undated directories, runs and bindings
   keep their names and remain valid for continuation, resumption and reading.
   Nothing is renamed or migrated.

## Consequences

Positive:

- `documentation/work/` and `documentation/initiatives/` list new work in
  creation order, and each name shows when the work began.
- The same subject can start again on a later date without a name conflict.
- Run starts no longer reuse a name already taken by an initiative.
- The runner, persisted formats and agent-control contracts need no version
  change.

Negative:

- Names grow by seven characters. Dated and undated directories coexist
  indefinitely.
- Enforcement at three entry points relies on each calling the shared
  finalizer; the in-process runner API accepts an undated slug.
- Standalone naming depends on agents following the installed policy.
- A run's slug differs from the `--slug` argument, which a script that
  assumed equality must now read from status.
- An initiative tracker cell changes from a planned subject to a dated name
  when its package starts.

Risks:

- A misconfigured machine time zone yields an unexpected date. The local clock
  is the accepted source; no correction is attempted.

Follow-ups:

- Record the policy, skill and template changes as instruction-baseline
  transitions with this ADR as authority.
- On acceptance, record the reciprocal lifecycle annotations on ADR-0054 and
  ADR-0061, admitting the exact pinned-file images where the build requires
  them.
- Update the manifest's naming convention and the documents named in FR17.

## Compliance and Confirmation

- The finalizer, given local date 2026-11-10, returns `261110-login-fix` for
  `login-fix` and for `261110-login-fix`, and `261110-251001-login-fix` for
  `251001-login-fix`; given 2027-01-05 it uses `270105-`.
- Interactive tests show the slug step's accept, typed, invalid, conflict and
  date-change cases from the description's acceptance criteria.
- `banzai run --slug` and `banzai control start --slug` tests show the final
  slug in run state, run ID, work directory and status, and show that an
  existing `documentation/initiatives/<final>/` refuses the start with no work
  directory and no active run.
- A library test shows run start refusing an initiative-root conflict.
- Every production call of `WorkflowRunner.start` passes a finalized slug.
- The installed policy and the initiative skill state the prefix rule and no
  longer state that work or initiative slugs carry no date.
- A run started before the change with an undated slug still resumes.

## Lifecycle Links

- Proposed partial supersession of
  [ADR-0054](./0054-git-visible-work-artifacts.md): only its rule that a date
  does not become a required name prefix, for new work directories. On
  acceptance, record the reciprocal link on ADR-0054.
- Proposed partial supersession of
  [ADR-0061](./0061-initiative-skill-and-documents.md) §1: only the "with no
  date" part of its slug rule, for new initiative directories. On acceptance,
  record the reciprocal link on ADR-0061.
- Supersedes: None in full.
- Superseded by: None.
