# ADR 0060: Local Model Override

## Status / Date / Owner / Decision Makers

- Status: Accepted
- Date: 2026-11-03
- Owner: Banzai maintainers
- Decision makers: Repository owner; explicitly accepted in chat on 2026-11-04
  with `Accept, all recommended`.
- Acceptance date: 2026-11-04
- Accepted proposal SHA-256: `43ed8818610d52e24b801c449c5a02d7ba99dab042da74814979ead157cfe166`.
- Lifecycle effect: the amendment of ADR-0008 in Lifecycle Links is accepted
  and its reciprocal link is recorded. The proposal-stage wording and the
  decision body are retained unchanged. Dependent planning is authorized;
  plan approval is still required before implementation.
- Owner choices (section 9): accepted as written, with the recommended
  answers: a human `banzai retry` of a blocked run records a new local layer;
  the whole role triple is the merge unit; "This machine only" is offered
  first; the local `executable` is the bare name `claude` or `codex`.
- Implementation state: Implemented on 2026-11-05 by
  [WP6](../work/wp06-local-model-override/implementation-report.md).
- Preparation authority: the owner's 2.8–2.9 brief of 2026-10-30 (WP6) and the
  owner's request on 2026-11-03 to continue the program. Preparing this
  proposal is not acceptance; no code may rely on it.

## Related Artifacts

- Program brief, WP6:
  [brief.md](../work/release-2-8-2-9-program/brief.md#wp6--local-model-override);
  status in [tracker.md](../work/release-2-8-2-9-program/tracker.md).
- Repository authority: [AGENTS.md](../../AGENTS.md) and the
  [decision lifecycle](./README.md#lifecycle).
- Related accepted decisions:
  - [ADR-0008](./0008-read-only-doctor-diagnostics.md): doctor never exposes
    "raw config/state content" and its JSON is versioned. This proposal amends
    it narrowly (section 8).
  - [ADR-0045](./0045-guided-verification-setup.md) §§3–8: verification
    configuration identity, the shared ownership boundary for config writers,
    the init order, version recognition and the doctor check shape. Preserved.
  - [ADR-0043](./0043-proportionate-verification-evidence.md): model-update
    byte preservation and no auto-migration for `.banzai/config.json`.
    Preserved; the local file is outside its scope.
  - [ADR-0054](./0054-git-visible-work-artifacts.md): `.banzai/` holds ignored
    execution state and machine evidence, and changed persisted contracts are
    versioned explicitly. Preserved; the local file is configuration, not
    execution evidence.
  - [ADR-0041](./0041-artifact-retention-and-publication-boundary.md): narrow
    ignore rules, never a broad exclusion that hides portable configuration.
    Preserved.
  - [ADR-0002](./0002-session-affinity-and-bounded-reviewer-continuity.md) and
    [ADR-0037](./0037-unified-runner-rendered-review-artifacts.md): the
    executable, model and effort triple decides session compatibility and
    reviewer rotation. Preserved.
  - [ADR-0018](./0018-agent-supervised-banzai-cli-control.md) and
    [ADR-0055](./0055-planning-gate-rework-and-independent-planning-review.md):
    the control status projection stays aligned with `nextAction` and changes
    only with a major control revision. Preserved; models stay out of it.
  - [ADR-0020](./0020-scoped-claude-subprocess-environment.md),
    [ADR-0040](./0040-project-adoption-preflight-and-interactive-setup.md) and
    [ADR-0042](./0042-runner-delivered-phase-instructions.md) §6: team-owned
    Claude environment, setup, and doctor parity over the configured roles.
    Preserved; "configured" reads as the effective configuration of section 2.
  - [ADR-0059](./0059-claude-default-reviewer-and-reviewer-isolation.md):
    the Claude default reviewer and its prerequisites. Its rules read the
    effective configuration.
  - [ADR-0027](./0027-exposure-driven-security-assurance.md): the widened
    surface is assessed in sections 1, 4 and 5 and in Compliance.
- Enforcement owners: `loadConfig` and a new layered reader of
  `.banzai/config.local.json`; `init`, `model` and `status` in
  `packages/orchestrator/src/cli.ts`; `selectModelSettings` in
  `model-selection.ts`; the launch header and advisory in `interactive.ts`;
  `RunStore.createRun` in `store.ts`; configuration resolution, run start and
  the command entry points in `workflow.ts`; a refusal error in `errors.ts`;
  `doctor.ts` and `doctor-cli.ts`; and
  `packages/orchestrator/import-boundaries.mjs`, which today lets `config.ts`
  import only errors, types and validation, and lets `doctor.ts` import
  neither project-files nor git. The layered reader's contained read and its
  Git query each need a permission under this ADR, added to the policy's
  authorities on acceptance.

## Context and Decision Drivers

`.banzai/config.json` is committed and team-owned. It holds the models per role
together with verification policy, context limits, the Claude environment mode
and timeouts. `banzai model` and the launch advisory write it, and every reader
reads only it. A developer who cannot run the team's reviewer vendor, for
example one without a Codex subscription, must edit a shared file and keep that
change out of every commit.

The runner reads the configuration again for each phase, and in some commands
more than once: verification and review can follow implementation inside one
command. A committed model edit made during a run therefore takes effect on the
next attempt, and the documentation and tests rely on that for retries.
`banzai model` refuses while a run is not done or cancelled, but nothing stops
a hand edit.

Decision question: How can a developer choose models for this checkout without
changing shared files, and how does a run stay consistent with that choice?

Drivers:

- A per-developer model choice leaves `git status` clean.
- Verification policy, context limits, the Claude environment, timeouts and
  every other team setting stay shared and reviewable.
- A model choice never changes during a run without the human seeing it.
- Committed configuration behaves as it does today, including mid-run edits
  that a retry picks up.
- Doctor, status, the picker and the runner agree on the effective model per
  role and on where it comes from.
- A Git-ignored file adds no new way to start an arbitrary program.
- No change to run state schemas, plugin hook behaviour, the agent control
  surface or phase instructions.

## Options Considered

Where the local choice lives:

1. **A Git-ignored `.banzai/config.local.json` with models only.** One merge
   rule and one file to inspect. Costs: a second file to validate, an ignore
   entry, and a guard against edits during a run. Selected.
2. **Environment variables per role.** No file. Choices are invisible to
   doctor and status from another shell, differ per terminal, and pass into
   every child process. Rejected.
3. **A local file that may override any key.** Most flexible. Lets one
   developer silently weaken team verification or context limits. Rejected.
4. **Keep editing the committed file and rely on discipline.** No change. The
   problem stays. Rejected.

How a run stays consistent:

1. **Record the local layer when the run is created, refuse a silent change,
   and let an explicit retry record a new one.** Committed models keep today's
   fresh reads, and the local file gets the same visible retry semantics.
   Selected (section 9 choice 1).
2. **Record the local layer and refuse every change until it is restored or
   the run is cancelled.** Simplest guard. A developer whose local reviewer
   fails mid-run must cancel the run to switch it, while a committed switch
   needs only a retry.
3. **Snapshot all effective models for the whole run.** Strongest consistency.
   Breaks the documented behaviour that a retry uses committed models edited
   after a failure. Rejected.
4. **Record the local layer and ignore later edits.** No refusal. The file
   then shows a model the run does not use. Rejected.

## Decision

Adopt option 1 for the file and option 1 for the run.

### 1. The local file

`.banzai/config.local.json` is an optional, per-developer, Git-ignored file:

```json
{
  "schemaVersion": 1,
  "models": {
    "reviewer": {
      "executable": "claude",
      "model": "claude-opus-5-5",
      "effort": "xhigh"
    }
  }
}
```

- Its keys are exactly `schemaVersion` (the integer 1) and `models`. `models`
  holds zero to three of `planner`, `implementer` and `reviewer`.
- A role entry has exactly `executable`, `model` and `effort`, and it replaces
  the committed triple for that role as one unit, because session
  compatibility and reviewer rotation compare the triple (ADR-0002, ADR-0037).
  - `executable` is the bare name `claude` or `codex`, which the operating
    system resolves through the developer's `PATH`. A path, another name or
    another case is refused (section 9 choice 4).
  - `model` matches `^[A-Za-z0-9][A-Za-z0-9._:/@\[\]-]{0,127}$`.
  - `effort` is validated as in the committed file.
- `timeoutMs` and every other key stay committed. Any other top-level key, an
  unknown role, `timeoutMs` or another field in a role is refused with
  `LOCAL_CONFIG_KEY_REFUSED`.
- Every other defect is refused with `LOCAL_CONFIG_INVALID`: invalid JSON, a
  wrong value, a symbolic link at `.banzai/` or at the file, a non-regular file,
  or a file over 64 KiB. Only a path that `lstat` reports as missing is absent
  and means no override; a dangling link is refused.
- Both messages name the failing field path. They name a key only when it
  matches `^[A-Za-z][A-Za-z0-9_]{0,63}$`, and otherwise say "an unsupported key".
  They never echo a value or the JSON parser's message. Both end with "Correct
  .banzai/config.local.json, or delete it to use the shared models in
  .banzai/config.json."
- Readers use the repository's contained-path reader (no symbolic link below
  the repository root, regular file only, bounded size). Writers publish
  through an exclusive temporary file in `.banzai/` renamed over the target,
  after checking the target with `lstat`, so they never write through a link.
  Removal checks the same way.
- Writers emit two-space indented JSON with a final newline, keys in the order
  shown, roles in planner, implementer, reviewer order. The byte preservation
  of ADR-0043 applies to the committed file only.

### 2. Precedence

The effective configuration is the committed configuration with each local role
triple put in place of the committed one. Every model value has one source per
role: `committed` (`.banzai/config.json`) or `local`
(`.banzai/config.local.json`).

- Outside a run, `loadConfig` returns the effective configuration. A layered
  reader returns the committed configuration, the local layer or its defect,
  and the sources. It never throws for a defective local file. The picker,
  status and doctor use it.
- Inside a non-terminal run, the runner uses the run-effective configuration of
  section 5: current committed configuration plus the run's recorded local
  layer.
- Committed-only readers (the verification configuration reader, its digest
  and its editors, ADR-0045 §3, §8) return the committed layer and never supply
  models to a phase. Every handoff from configuration-prerequisite handling to
  verification, review or fix passes the run-effective configuration,
  including the continuation after a prerequisite is satisfied by
  configuration.
- A local file never changes verification, context limits, the Claude
  environment or timeouts.
- ADR-0059's rules for a Claude reviewer and for the Codex prerequisite, and
  doctor's role-dependent checks, evaluate the effective configuration.

### 3. Writers

- `banzai model [--local]` has an exact grammar; any other argument fails with
  `INVALID_MODEL_OPTION`. Both forms still require a terminal, and
  `banzai model --help` still prints help. `--local` opens the picker on the
  local destination without the destination question; it needs a readable,
  valid `.banzai/config.json`, whatever its Git state.
- Without `--local`, the picker asks where to save before the role menus when
  `.banzai/config.json` is in the Git index (`git ls-files --error-unmatch`
  succeeds) or a local file exists. The options are "This machine only
  (`.banzai/config.local.json`, ignored by Git)" and "Shared with the team
  (`.banzai/config.json`; commit it)" (section 9 choice 3). Otherwise it writes
  the committed file as today.
- The picker reads through the layered reader. A defective local file stops it
  with the section 1 message before any menu, and nothing is written.
- For the local destination, each role menu starts from the role's effective
  triple and names its source. A role is written only when the developer picks
  a different triple, so unchanged committed triples are never copied into the
  local file. A role with a local entry also offers "Use shared setting:
  <committed triple>", which removes the entry; the file is deleted when no
  entry is left. "Match Planning" is offered only when the planner's effective
  executable is `claude` or `codex`.
- For the committed destination, the picker compares with the committed
  layer, and "Match Planning" copies the committed planner triple, so a local
  triple is never copied into `.banzai/config.json`. For a role the local file overrides, the summary says that this
  machine keeps using the local setting. The builder-session line uses the
  effective settings.
- The summary, confirmation and result line name the destination file. "Review
  and commit the change" is printed only when `.banzai/config.json` changed.
- Model writers take the runner lock under the shared ownership boundary of
  ADR-0045 §4, and refuse inside a model phase (`BANZAI_*` authorization
  present) as `init` does. While a run is not done or cancelled they refuse as
  today, with one exception: while the active run is `blocked` and status
  recommends `banzai retry` for it, the picker may write the local
  destination. In that state `banzai model` without `--local` uses the local
  destination without the destination question, the picker never writes
  `.banzai/config.json`, and it then prints "Run banzai retry to continue this
  run with the new models." The launch advisory refuses during any active
  run, as today. The refusal message for every other state names
  `banzai cancel`.
- The launch advisory writes each update to the file that supplies that role,
  and its options and confirmation name every file that will change.

### 4. Ignores

- `banzai init` appends the exact line `.banzai/config.local.json` to
  `.gitignore` when `.gitignore` has no such line, never a broader pattern
  (ADR-0041).
- Local writers never edit `.gitignore`. When Git does not ignore the path,
  the writer appends it to the clone's own exclude file, which Git honours and
  never tracks. That file is the path `git rev-parse --git-path info/exclude`
  prints, resolved against the repository root: the path is relative in the
  main worktree and is the common directory's file in a linked worktree. The
  writer creates `info/` when it is missing, refuses a symbolic link or a
  non-regular exclude file, and appends without following links. The
  contained-path reader does not apply, because it refuses `.git` segments and
  a linked worktree's exclude file is outside the worktree. Before writing the
  local file, the writer confirms that the path is ignored and not in the
  index.
- The effective-configuration loader refuses with `LOCAL_CONFIG_NOT_IGNORED`,
  before any executable starts, when a local file exists and is in the Git
  index or is not ignored. It checks once per command, for every command that
  reads the current local file, except `banzai status` and doctor (below).
  These include the interactive launch before its authentication check, the
  picker, `banzai setup`, run start, resume, `banzai retry` and every command
  with a section 5 check point of the first kind. An interactive session checks again at each launch, picker run and run start,
  and never reuses an earlier result. Each cause has its own message:
  - for a file in the Git index, the message says that the file is shared
    through Git and may hold someone else's choice. It tells the developer to
    run `git rm --cached .banzai/config.local.json`, review the local copy and
    commit the removal. Local writers refuse instead of writing;
  - for an untracked file that Git does not ignore, the message tells the
    developer to run `banzai model --local`, which ignores the file for this
    clone, or to add the line `.banzai/config.local.json` to `.gitignore` and
    commit it. The picker, in a terminal and outside a model phase, runs the
    exclude step of the previous bullet before its other checks, so it repairs
    that case instead of refusing.
- `banzai status` reports the condition without failing; doctor reports it as
  a failed `config.local` check, so the report is not ready and exits 1
  (ADR-0045 §7).
- The file is not added to the execution ignore set of
  `plugins/banzai/lib/execution-ownership.mjs` (ADR-0054).

### 5. Run guard

- **Record.** `RunStore.createRun` receives the local layer from the same read
  that starts the run and writes a create-only sidecar
  `.banzai/runs/<runId>/model-override.json` with identity
  `banzai-run-model-override/v1` in the new run directory, before `state.json`
  and the active-run pointer. Every run this release creates therefore has a
  sidecar. The record is the normalized role map: the `models` object of a
  valid local file, or `{}` when the file is absent.
- **Comparison value.** Two layers are equal when they have the same roles with
  the same `executable`, `model` and `effort`, independent of key order or
  formatting. An absent file equals an empty `models` object. A defective
  current file never equals the record.
- **Merge.** During a non-terminal run every runner configuration resolution
  merges the current committed configuration with the held record, never with
  the current local file. Each command reads the sidecar once, through the
  contained reader, at its first resolution and holds it. A command that
  records again holds the layer described under **Recording again**.
- **Check points.** The current local layer and the sidecar on disk are
  compared with the held record at exactly two kinds of point:
  1. once per state-changing command (resume, approve, triage, recover,
     rework, planning-review request and answer, ADR and human decisions,
     configuration answers other than Cancel), under the runner lock and
     before the command's first write. `banzai retry`, and resume of a run in
     `created` or `selecting` with no model attempt, record again instead
     (below);
  2. before each model attempt record is created and before a pending
     transition is committed; planning review and analysis check before they
     create their attempt.

  Nested resolutions inside a command never compare and never refuse.
  Verification commands are not model attempts and are not compared.
  `banzai cancel` and read-only projections never compare.

- **Refusal.** A difference refuses with `LOCAL_MODEL_OVERRIDE_CHANGED`,
  raised as a dedicated refusal error beside the instruction-resource refusal
  in `errors.ts`. Every catch between a check point and the command's boundary
  rethrows it unchanged. That covers each catch that passes the
  instruction-resource refusal through today, and the catches that pass
  nothing through today but enclose a later check point: the planning-review
  and planning-reconciliation attempt catches of `executePlanningStep` and
  `reconcilePlanningAttempt`, which call `failAttempt` around the analysis
  continuation, and the catch-all of `executeTaskChecks` around the review
  handoff. The start, review-check and verification-retry failure recorders
  are reached only from catches that already pass the instruction-resource
  refusal through. `LOCAL_MODEL_OVERRIDE_RECORD_INVALID` is raised and
  propagated the same way; in a state-changing command the catches of
  `requireVerificationApplicability` and `recoveryEligibility`, which enclose
  a configuration resolution, rethrow it too.
  The refusal sets no block reason, blocked-from status or review rotation
  reason, appends no event and consumes no retry or recovery authority. A
  refusal at a command's entry writes nothing. A refusal before an attempt
  adds no write, and what the same command already completed stays; the run
  continues from there. The message carries the drift lines of section 7,
  escaped. It says to restore the file, run `banzai retry` in a terminal when
  status recommends it, or run `banzai cancel`, and warns that a change the developer
  did not make may come from a model phase or a project script.
- **Recording again.** Two commands take a new local layer:
  - resume of a run in `created` or `selecting` with no model attempt reads
    the current layer under its lock, before its first write. Start and
    resume write `selecting` before the selection attempt exists, so a crash,
    a setup refusal or a check-point refusal there leaves such a run;
  - `banzai retry` of a `blocked` run (section 9 choice 1) reads the current
    layer and the sidecar under its eligibility lock, before any write, and
    holds that layer. When retry first reconciles a saved planning terminal
    result under that lock, it records a different layer there, before the
    reconcile's first write; its later locks then compare with that new
    record, and a later preflight failure keeps it. The retry preflight
    between its locks and every phase the retry starts resolve with the held
    layer. Under its failure lock and its execution lock, retry compares the
    current local layer with the held layer, and the sidecar on disk with the
    record read or written under the eligibility lock, before any check
    failure or transition is recorded. A preflight
    failure records the start or check failure as today and leaves the record
    unchanged. A planning-review retry, which runs under one lock, reads,
    compares and replaces under that lock before its first write.

  Both reads pass the section 1 validation and the section 4 ignore check.
  When the new layer differs from the record, the command, under its lock (for
  retry, its execution lock, or its eligibility lock before such a reconcile)
  and before any transition, prints each changed
  role with its recorded and new triple, replaces the sidecar (a temporary
  file renamed over it, or a new sidecar for a run that has none) and appends
  a `model_override.recorded` event that names roles and sources only. From a
  replacement on, the command holds the new record, and its later check points
  compare with it. A changed triple rotates sessions as a committed change
  does (ADR-0002). Once the run has a model attempt, recording a different
  layer needs a terminal, as `banzai model` does: `banzai retry` without one,
  as under agent control (ADR-0018), refuses with
  `LOCAL_MODEL_OVERRIDE_CHANGED` under its eligibility lock instead, so the
  agent reports the change to the human. No other path rewrites or deletes the
  sidecar.

- **Sidecar defects.** Only an absent sidecar means a run created before this
  decision. Such a run has an empty record: it runs on committed models and
  refuses while a local file with entries exists, except in a command that
  records again, which gives it a sidecar. A sidecar that is unreadable, a symbolic link,
  not a regular file, not valid JSON, of another identity or invalid under
  section 1 is never treated as absent. Every comparison refuses it with
  `LOCAL_MODEL_OVERRIDE_RECORD_INVALID`, which names the sidecar and says to
  cancel the run.
- Committed model edits keep their current effect, including session rotation
  on a changed triple.
- Run state schemas, `spec-gate.cjs` and phase instructions are unchanged.
- **Limit.** A model phase that can write `.banzai/` through a shell can
  rewrite the local file and the sidecar together between commands, as it can
  rewrite run state. Builder sandboxing (WP17) owns that boundary.

### 6. Doctor

Doctor stays `banzai-doctor/v6`, which this change extends before its first
release:

- **`config.local` check.** Category `config`, directly after `config.version`.
  It passes when the file is absent or valid. It fails when the file is unsafe
  under section 1, unreadable, invalid or has refused keys, and when Git tracks
  it or does not ignore it. Doctor learns this with the read-only Git queries
  that section 8 permits. Its messages are
  fixed text per cause and never echo a key or value from the file. Its
  `roles` list is empty, so the check and role shapes stay as ADR-0045 §7
  defines them.
- **`models` field.** A top-level array placed after `projectTypes` and before
  `summary`, one entry per role in planner, implementer, reviewer order, each
  with exactly `role`, `vendor`, `model`, `effort` and `source`.
  - `vendor` is `claude`, `codex` or `null` for any other executable.
  - `model` is disclosed under section 8, otherwise `null`.
  - The array is empty when the effective configuration is unavailable.
  - The text report prints `Models:` and one
    `  <role>: <vendor> <model> effort=<effort> (<source>)` line per role, after
    the `Project types:` line and before `Checks:`. An unknown vendor prints
    `other` and an undisclosed model prints `unlisted`.
- **Effective checks.** `claude.instructions`, `claude.permissions` and
  `executables.models` use the effective configuration; when `config.local`
  fails they are `skipped` and `models` is empty. `claude.environment` and the
  verification checks use committed values, which the local file cannot
  change.

### 7. Status and launch

- `banzai status` prints one line per role of the run with its source, for
  example `Review: claude claude-opus-5-5 xhigh (local)`, using the
  run-effective configuration. For a done or cancelled latest run it prints,
  instead of the run's lines, the current effective models under
  `Current models:`, with no drift lines. A defective local file shows as
  `invalid`, and a tracked or unignored one as `tracked` or `not ignored`, in
  place of those models, without failing status.
- While the run is not terminal and the current local layer differs from the
  record, status prints:
  - `Local models changed since this run recorded them`;
  - one `<Role>: recorded <triple|shared>, now <triple|shared>` line per
    differing role, or, when the current file is defective, the single line
    `.banzai/config.local.json: invalid (<field path>)` with the field path
    named as in section 1;
  - a closing line that says to restore `.banzai/config.local.json`, run
    `banzai retry` in a terminal when status recommends it, or run
    `banzai cancel`, and warns that a change the developer did not make may
    come from a model phase or a project script.
- `LOCAL_MODEL_OVERRIDE_CHANGED` carries the same drift lines.
- Status never compares-and-refuses and never fails on a defective local file
  or sidecar; it reports them. It evaluates retry, recovery, the
  completion-publication action and `nextAction` on the run-effective
  configuration. A drifted file therefore never turns a recommendation into
  cancel or hides an eligible recovery. A defective sidecar leaves no
  run-effective configuration: status then prints
  `.banzai/runs/<runId>/model-override.json: invalid` and the advice to cancel
  the run in place of the role and drift lines, reports retry and recovery as
  not eligible, and recommends `banzai cancel`, as that refusal does. None of
  its resolutions raises `LOCAL_MODEL_OVERRIDE_RECORD_INVALID`.
- `banzai status` without a run still fails with `NO_ACTIVE_RUN`. Outside a
  run, doctor and the picker show the effective models.
- `banzai status --json`, `banzai-agent-status/v7` and agent capabilities v9
  are unchanged; an agent learns of drift from `LOCAL_MODEL_OVERRIDE_CHANGED`
  on the recommended command (ADR-0018, ADR-0055).
- With a non-terminal run, the interactive launch header shows the run's
  models and the same drift lines. Without one, it marks each role that comes
  from the local file.
- Every model value from either file is printed through terminal escaping.

### 8. Amendment to ADR-0008

Doctor may disclose:

- for each role, the vendor (`claude`, `codex` or none), the effort, the
  source label, and the model identifier when it matches
  `^[A-Za-z0-9][A-Za-z0-9._:/@\[\]-]{0,127}$`. This holds for committed values
  too, which the committed schema still accepts unbounded. Committed
  validation is unchanged, and the local file enforces the pattern under
  section 1;
- whether the local file is absent, valid, defective, tracked or not ignored,
  as fixed text;
- for the `config.local` check only, the result of the read-only queries
  `git check-ignore -q -- .banzai/config.local.json` and
  `git ls-files --error-unmatch -- .banzai/config.local.json`. ADR-0008's
  permitted operations gain these two and no other Git command.

Executable paths, timeouts, key names and values from the local file, and every
other configuration value stay undisclosed. The text report escapes terminal
controls. All other privacy, offline and read-only rules of ADR-0008 are
unchanged.

### 9. Owner choices

The owner decides these at acceptance. Every section of this ADR, including
Consequences and Compliance, shows the recommended answer; an alternative is
adopted by revising the sections named with it before acceptance:

1. run guard: refuse a silent change and let a human `banzai retry` of a
   blocked run record a new local layer with a visible per-role notice.
   Alternative: refuse every change until the file is restored or the run is
   cancelled, recording again only on resume in `created` or `selecting`
   with no model attempt, or on retry of a run blocked from `created` before
   any model attempt, and let local writers run only while the active run is
   blocked from `created` (revises the Decision's opening line and the
   Selected mark under "How a run stays consistent", the §3 writer exception,
   §5 Check points, Recording again and Refusal, the §7 closing line,
   Consequences and Compliance 4).
2. merge unit: the whole role triple. Alternative: each field on its own
   (revises §1, §2, the §3 role menus, the §5 comparison value, the §6
   `models` field and the §7 role and drift lines).
3. picker destination: "This machine only" first. Alternative: "Shared with
   the team" first (revises §3).
4. local `executable`: the bare name `claude` or `codex`. Alternative: any
   value the committed file accepts, shown verbatim in the launch header and
   in the guard messages (revises the Decision Drivers bullet on arbitrary
   programs, §1, §3 Match Planning, the §7 launch header, the ADR-0027
   Consequences bullets and Compliance 2).

## Consequences

Positive:

- A developer chooses a reviewer, or any role, for this checkout without
  touching shared files, and `git status` stays clean, including in
  repositories initialized before this change.
- Team verification, context limits, the Claude environment and timeouts
  cannot be weakened locally.
- Doctor, status, the picker and the runner report the same effective model
  and its source.
- After a run's first model attempt, a local model never changes without the
  human seeing the change, unless a model phase rewrites the local file and
  the sidecar together (section 5, Limit).
- The local file can switch a role only between the vendor CLIs on the
  developer's `PATH`. It cannot name another program.
- No run state, hook behaviour, control or instruction change; regenerated
  plugin library bytes ride the Gate 1 version bump.

Negative and risks:

- Two developers can run the same repository with different models. The
  sources, the sidecar and attempt evidence are visible only on the machine
  that ran. Other developers see the difference only in the planning
  reviewer's identity, which `planning-review-N.md` records, and code review
  artifacts record no reviewer identity.
- A Git-ignored file still chooses which vendor CLI a phase starts (ADR-0027).
  Closed keys, bare executable names, contained reads and writes, the run
  guard, and the refusal of a tracked or unignored file bound it. A phase with
  shell access remains out of reach until WP17.
- Overriding only the planner or only the implementer breaks builder session
  reuse between planning and implementation; the picker shows this.
- A defective local file makes every command that loads configuration fail
  until it is repaired, except status and doctor, which name the file and the
  fix.
- During drift in a run that has a model attempt, agent status keeps
  recommending the action that becomes valid after restore, and that command
  refuses when an agent runs it. Only a human `banzai retry` in a terminal
  records a new layer for such a run. Before the first model attempt, an
  agent's `banzai retry` or `banzai resume` records the new layer and prints
  the change.
- `banzai init` adds one `.gitignore` line in repositories initialized
  earlier, which the team commits. Until then the clone's exclude file keeps
  local writes out of `git status`.

Follow-ups:

- After acceptance, record the reciprocal lifecycle link on ADR-0008 (not
  pinned).
- WP7 reads the effective configuration for its prerequisites and doctor
  rules, and sets the committed reviewer explicitly in tests.
- WP6's requirements, plan and report live in
  `documentation/work/wp06-local-model-override/`.

## Compliance and Confirmation

1. With a committed Codex reviewer and a local Claude reviewer, every review
   phase runs with the local triple, including a review reached through
   `banzai resume` after a configuration prerequisite was satisfied by
   configuration. `git status` stays clean before and after the run.
2. Each refused key, unknown role, `timeoutMs` in a role, executable path or
   unknown name, out-of-pattern model, invalid value, symbolic link, dangling
   link, FIFO, oversized and malformed file is refused with the stated code. No
   message echoes a value. After a writer runs against a symbolic link, the
   link's target is unchanged.
3. A local edit during a run refuses resume, approve, triage, recover and every
   pending transition with `LOCAL_MODEL_OVERRIDE_CHANGED`. A refusal at a
   command's entry writes nothing. A refusal before an attempt or a pending
   transition adds no write, and the command's earlier writes stay. No block
   reason, event or review rotation reason is added, including on the
   retry-preflight, review-check and verification-applicability paths. This
   includes a drift during task verification that refuses the review, and a
   drift that refuses the analysis after a completed planning review: the
   verification publication and the completed review attempt stay as
   recorded. Restoring the file lets the run continue. A formatting-only edit passes.
   `banzai status` shows the drift without failing, and `nextAction` is
   unchanged.
4. `banzai retry` of a blocked run prints the per-role change, records the new
   layer and runs with it. A run blocked from `created` by a missing reviewer
   executable accepts `banzai model --local`, and the retry runs with the local
   triple. A retry that reconciles a saved planning result records the new
   layer before it applies the plan, so the following approve passes. A
   preflight failure leaves the record unchanged, unless retry recorded it
   before such a reconcile. Without a terminal,
   the same retry of a run with a model attempt refuses with
   `LOCAL_MODEL_OVERRIDE_CHANGED` and writes nothing, and a local edit between
   retry's eligibility read and its execution lock refuses.
5. Committed model edits during a run keep their current effect on retry, and
   the existing retry tests pass unchanged.
6. A run without a sidecar runs on committed models and refuses while a local
   entry exists. A corrupt or symbolic-link sidecar refuses and is never read
   as absent. A crash between run creation and the first model attempt leaves
   a run that resumes with a fresh record.
7. A tracked or unignored local file is refused at launch before any vendor
   executable starts and at run start, each cause with its own fix. A tracked
   file is also refused by every writer, and the picker adds the exclude entry
   for an untracked, unignored one. `init` adds the exact
   ignore line once. Local writers in a repository without that line keep
   `.gitignore` unchanged.
8. `banzai model --local` and "Use shared setting" write only
   `.banzai/config.local.json`, the destination question writes only the
   chosen file, and the launch advisory writes only the file that supplies
   each role, all under the runner lock. The only other write is the picker's
   exclude entry of section 4, made when Git does not ignore the local file. A defective local file stops the picker before any menu.
9. Doctor reports `config.local` and the `models` field in the stated
   positions. It discloses no executable path, key name or other configuration
   value: an out-of-pattern committed model and a refused-key canary do not
   appear. Its role checks use the effective configuration.
10. `banzai model --help`, the CLI usage line, `documentation/orchestrator.md`,
    `documentation/getting-started.md`, `README.md` and `PROJECT_MANIFEST.md`
    describe the local file, its precedence, the guard and the retry
    behaviour.
11. Run state schemas, `spec-gate.cjs` and `execution-ownership.mjs`
    behaviour, the agent control surface and phase instructions are unchanged.
    Any regenerated `plugins/banzai/lib` bytes ride the Gate 1 version bump.
12. The owner accepts this ADR before any implementation relies on it.

## Lifecycle Links

- Amends, on acceptance, [ADR-0008](./0008-read-only-doctor-diagnostics.md):
  doctor v6 adds the `config.local` check, the top-level `models` field and the
  bounded disclosure and the two read-only Git queries of section 8. Its
  offline, read-only and other privacy rules remain authoritative. ADR-0045 §7
  fixes the v4 top-level order and the check and role shapes. v6 is a new
  version under ADR-0008's versioning rule: it keeps the check and role shapes
  and inserts `models` between `projectTypes` and `summary`. The pinned
  ADR-0045, which binds v4, therefore needs no lifecycle edit.
- Preserves ADR-0002, ADR-0018, ADR-0020, ADR-0027, ADR-0037, ADR-0040,
  ADR-0041, ADR-0042, ADR-0043, ADR-0045, ADR-0054, ADR-0055 and ADR-0059.
- Supersedes: None.
- Superseded by: None.
- Required lifecycle decision: accept, reject with a reason, or request rework.
