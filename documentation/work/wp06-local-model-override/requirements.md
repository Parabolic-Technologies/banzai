# WP6 · Local model override

Status: requirements ready for approval · Program:
[banzai 2.8–2.9](../release-2-8-2-9-program/tracker.md) · Source:
[brief, WP6](../release-2-8-2-9-program/brief.md#wp6--local-model-override)

## Problem

`.banzai/config.json` is committed and holds the models per role together with
every other team setting. `banzai model` and the launch advisory write it, and
every reader reads only it. A developer who cannot run the team's reviewer
vendor must edit a shared file and keep that change out of every commit. Phases
read the configuration again for each attempt, so a hand edit during a run
switches models without notice.

## Authority

- [ADR-0060](../../decisions/0060-local-model-override.md), accepted on
  2026-11-04 with the recommended answer to all four owner choices. It amends
  [ADR-0008](../../decisions/0008-read-only-doctor-diagnostics.md) and preserves
  ADR-0002, 0018, 0020, 0027, 0037, 0040, 0041, 0042, 0043, 0045, 0054, 0055 and 0059. The ADR text is authoritative wherever this document is shorter.
- Doctor stays `banzai-doctor/v6`, opened in WP5 and extended here without a
  bump (WP5 Q1).
- Run state schemas, `status --json`, `banzai-agent-status/v7`, capabilities
  v9, hook behaviour, the execution ignore set and phase instructions do not
  change (ADR-0060 Compliance 11).

## Requirements

- **R1 · Local file and reader (§1, §2).**
  - `.banzai/config.local.json` holds `schemaVersion: 1` and `models` with zero
    to three role triples. Executables are the bare names `claude` and `codex`.
    Models match the ADR pattern. Effort uses the committed enum.
  - Refused keys fail with `LOCAL_CONFIG_KEY_REFUSED`, and every other defect
    with `LOCAL_CONFIG_INVALID`. Messages name a field path and never echo a
    value or parser text.
  - Reads go through the contained-path reader, limited to 64 KiB. Only a
    missing path means no override.
  - A layered reader returns the committed configuration, the local layer or
    its defect, and a source per role. It never throws for a local defect.
- **R2 · Three resolutions (§2, §5 Merge).**
  - Outside a run, `loadConfig` returns the effective configuration: the
    committed file with each local triple in place of the committed one.
  - Inside a non-terminal run, the runner merges the current committed file
    with the run's recorded layer, never with the current local file.
  - Committed-only readers (verification configuration, its digest and
    editors, and the status prerequisite and inventory reads) never supply
    models.
  - Every handoff to verification, review or fix passes the run-effective
    configuration. That includes the continuation after a configuration
    prerequisite is satisfied.
  - Setup, init's permission report and ADR-0059's later rules read the
    effective configuration.
- **R3 · Ignores (§4).**
  - `banzai init` adds the exact `.gitignore` line once.
  - The loader refuses a local file in the Git index or not ignored with
    `LOCAL_CONFIG_NOT_IGNORED`, before any vendor executable starts. Each
    cause has its own message. The check runs once per command, and again at
    each interactive launch, picker run and run start.
  - Local writers use the clone's exclude file and never edit `.gitignore`.
    The file stays out of `execution-ownership.mjs`.
- **R4 · Writers (§3).**
  - `banzai model [--local]` has an exact grammar: any other argument fails
    with `INVALID_MODEL_OPTION`. It needs a terminal and refuses inside a model
    phase.
  - It asks the destination question ("This machine only" first) when
    `.banzai/config.json` is in the index or a local file exists.
  - The role menus start from the effective triple and name its source. Only
    changed triples are written. "Use shared setting" removes a role and
    deletes an empty file. "Match Planning" never copies a local triple into
    the committed file.
  - Writes take the runner lock and publish through a temporary file renamed
    over the target. The format is fixed. Before writing the local file, a
    writer confirms that the path is ignored and not in the Git index, and
    refuses a path in the index with the tracked-file message even when no
    local file exists.
  - While a run is not done or cancelled, writers refuse and name
    `banzai cancel`. The exception is a blocked run for which status
    recommends `banzai retry`: the picker may then write the local file and
    tells the developer to run `banzai retry`.
  - The launch advisory writes each update to the file that supplies the role
    and names every file it changes.
- **R5 · Run record (§5 Record, Sidecar defects).**
  - `RunStore.createRun` writes the create-only
    `.banzai/runs/<runId>/model-override.json`
    (`banzai-run-model-override/v1`) before `state.json` and the active-run
    pointer. The layer comes from the read that starts the run, and is `{}`
    when no local file exists.
  - A run without a sidecar is a legacy run with an empty record.
  - Any other sidecar defect refuses with
    `LOCAL_MODEL_OVERRIDE_RECORD_INVALID`.
- **R6 · Check points and refusal (§5).**
  - The current local layer and the sidecar are compared with the held record
    at two kinds of point:
    - once per state-changing command, before its first write;
    - before each model attempt and before each pending transition.
  - A difference refuses with `LOCAL_MODEL_OVERRIDE_CHANGED`. The refusal is
    a dedicated error that every catch between a check point and the command
    boundary rethrows unchanged. It writes no block reason, event or rotation
    reason and consumes no retry or recovery authority.
  - `banzai cancel`, status and verification commands never compare.
- **R7 · Recording again (§5, choice 1).**
  - These commands take a new layer:
    - resume of a run in `created` or `selecting` with no model attempt;
    - `banzai retry` of a blocked run, including its planning-review retry and
      its reconcile of a saved planning result.
  - They print each changed role, replace the sidecar and append
    `model_override.recorded`.
  - Once the run has a model attempt, recording a different layer needs a
    terminal. An agent's retry refuses instead.
  - A preflight failure leaves the record unchanged, unless retry recorded
    the new layer before reconciling a saved planning result.
- **R8 · Status and launch (§7).**
  - `banzai status` prints the run's models with their sources.
  - When the current layer differs from the record, status also prints the
    drift lines and the closing advice, including the model-phase warning.
  - For a done or cancelled run, status prints `Current models:` instead.
  - It reports a defective local file or sidecar without failing. It evaluates
    retry, recovery, the completion-publication action and `nextAction` on the
    run-effective configuration.
  - The interactive launch header shows the run's models and drift lines, or
    marks local roles when there is no run.
- **R9 · Doctor (§6, §8).**
  - A `config.local` check follows `config.version`. It fails, with fixed text
    per cause, for an unsafe, invalid, refused-key, tracked or unignored file.
  - The top-level `models` array (role, vendor, model, effort, source) sits
    between `projectTypes` and `summary`. The text report prints a `Models:`
    block.
  - `claude.instructions`, `claude.permissions` and `executables.models` use
    the effective configuration and are skipped while `config.local` fails.
  - Doctor runs only the two permitted Git queries, and only when the local
    file exists.
- **R10 · Escaping (§7).** Every model value from either file is printed
  through terminal escaping. The escaping covers status, the launch header,
  refusal messages, doctor text and phase progress lines.
- **R11 · Documentation (Compliance 10).**
  - `banzai model --help` and the usage line.
  - `documentation/orchestrator.md`: commands, Choosing Models, Model
    Configuration, doctor, Failure Recovery, Agent Control and Local State.
  - `documentation/getting-started.md`, `README.md`, `PROJECT_MANIFEST.md` and
    `packages/orchestrator/MODULES.md`.
  - The implementation state in ADR-0060's status block, its row in
    `documentation/decisions/README.md` and the ADR-0008 lifecycle line, once
    implemented.

## Implementation readings

ADR-0060 leaves these points open. The plan adopts the following readings,
each consistent with the accepted text; approving the plan approves them.

1. **Loader names.** The committed reader becomes `loadCommittedConfig` in
   `config.ts`. The effective `loadConfig` moves to a new `local-config.ts`.
   `workflow.ts` holds the run resolver and imports the committed reader and
   the `local-config.ts` layer helpers, never the effective `loadConfig`. A
   source test pins that binding, because import boundaries are per module.
2. **File-level defects.** A defect without a field (link, FIFO, oversize,
   unreadable, invalid UTF-8 or JSON) names `.banzai/config.local.json` as its
   path.
3. **Defect order.** The loader and doctor check in this order: Git index,
   then ignore state, then the contained read and validation.
4. **Picker order.** The picker checks the argument grammar, the terminal and
   the model-phase variables, then runs the exclude step. Only after that does
   it take the runner lock, check the run state and read the layer.
   - The exclude step depends only on Git state. It writes only the clone's
     exclude file, outside the runner lock, and skips an existing line.
   - "Nothing is written" in §3 refers to the configuration files.
   - The exclude step first checks the Git index. For a path in the index it
     appends nothing, and the picker refuses with the tracked-file message of
     §4. If a `.gitignore` negation keeps an untracked file unignored after
     the append, the picker refuses with `LOCAL_CONFIG_NOT_IGNORED`. The
     message names the negation case.
5. **`banzai model` routing.** `model` joins the exact-contract commands. The
   accepted forms are no argument, `--local`, or `--help` alone. Argument
   errors are reported before the terminal check and before repository
   discovery. Global flags are stripped as today.
6. **Init.** The init picker writes the committed file as today and never asks
   the destination question. With a local file present, its summary says that
   this machine keeps the local setting.
7. **Committed triple chosen in a local menu.** For a role with a local entry,
   choosing a triple equal to the committed one acts as "Use shared setting".
8. **Lock and messages.**
   - Model writers take the runner lock without stale reclaim and without a
     work-ownership claim.
   - A held lock refuses with model-specific text.
   - The launch advisory keeps its current deferral text during any active
     run.
9. **Interactive launch.** `LOCAL_CONFIG_NOT_IGNORED`, `LOCAL_CONFIG_INVALID`
   and `LOCAL_CONFIG_KEY_REFUSED` end the launch before the authentication
   check.
   - Committed configuration errors keep today's "Model configuration
     unavailable" report.
   - With a non-terminal run, the header and the authentication markers use
     the run-effective configuration.
10. **Status layout.**
    - Role lines sit under a `Models:` heading as indented
      `<Label>: <executable> <model> <effort> (<source>)` lines. This keeps
      them apart from the existing `Review: <verdict>` line.
    - A done or cancelled run uses `Current models:`.
    - A tracked, unignored or invalid local file prints one line naming the
      cause.
    - An unavailable committed file prints `Models: unavailable (<code>)`.
    - Only `banzai status` prints the block; post-command state prints do
      not.
11. **Defective sidecar in status.**
    - Human status prints
      `.banzai/runs/<runId>/model-override.json: invalid` and the advice to
      cancel. It reports retry and recovery as not eligible, with a reason
      naming the sidecar, and recommends `banzai cancel`.
    - Agent status stays state-derived, as for historical runs. The agent
      learns of the problem from `LOCAL_MODEL_OVERRIDE_RECORD_INVALID`.
12. **Check point 1 scope.**
    - A resume that only returns state does not compare, because it writes
      nothing: a run in `needs_adr_approval`, `needs_plan_approval` or
      `needs_triage`, or a `blocked` run with no active attempt and no
      authorized recovery. A resume that reconciles an attempt (including a
      pending completion publication) or continues an authorized recovery
      compares at entry.
    - Configuration Cancel never compares.
13. **"No model attempt".** The run has no attempt record, no active attempt
    and zero model-attempt metrics.
14. **Check point 2 placement.**
    - `executeVerification` compares only when a pending transition is
      supplied.
    - A comparison is added before the retry transition commit in
      `executeReview`.
    - In `executePlanningStep` the guard comparison moves ahead of attempt
      creation. The existing instruction checks stay where they are.
15. **Sidecar rewritten between check points.** A valid sidecar that differs
    from the held record refuses with `LOCAL_MODEL_OVERRIDE_CHANGED`.
16. **Retry order.**
    - Under the eligibility lock, retry checks the local file in the order of
      reading 3, then the sidecar, then the terminal rule.
    - For the `created` checkpoint, recording follows the repository check,
      which acts as preflight.
17. **Terminal.**
    - The CLI passes standard input and output TTY state to
      `runner.retry({ terminal })`. The interactive session passes `true`, and
      agent control passes `false`.
    - The default is `false`, so existing retry tests behave as an agent.
18. **Sidecar and event shapes.**
    - The sidecar is `{"schema":"banzai-run-model-override/v1","models":{…}}`,
      written as two-space JSON with mode 0600.
    - The `model_override.recorded` event carries role names with their
      sources (`committed` or `local`) and no model values.
19. **Run start.** The single layered read is the one under the start lock;
    the pre-lock read becomes committed-only. A refusal there comes after
    `.banzai/` initialization but before the run directory and any executable.
20. **Doctor Git probe.**
    - The probe runs at the repository root with `LC_ALL=C`.
    - When a query cannot run, `config.local` fails with fixed text.
    - A symbolic link at `.banzai/` fails `config.local` even when no local
      file exists, as §1 refuses a link there.
    - An empty `models` array prints `Models: unavailable`.
21. **Escaping helper.** A field-level escape adds TAB and LF to the existing
    terminal escaping. Progress banners and the live status line use it for
    model values.
22. **Catch scope.** The `executeTaskChecks` catch-all rethrows only the two
    new codes. Aligning its other pass-through errors is out of scope.
23. **Compliance 1, prerequisite clause.** New runs use task mode and never
    reach a configuration prerequisite. A legacy profile-mode run reaches one
    with a sidecar only after a retry or resume records a layer for it (§5).
    The clause is proven at the handoff with a profile-mode fixture that
    carries a sidecar.

## Owner decisions

- **Q1 · Change sets.** The ADR's scope is larger than the brief's estimate
  of 1–2 days, about 6–7 days in total.
  - **(a) Recommended:** one change set for all of WP6, as the program rule
    requires, with one report. The plan's two task groups are working
    milestones, not commits.
  - **(b)** Two change sets, committed in order, each with its own report.
    This departs from the brief's "one work package, one change set" rule and
    is recorded under the tracker's Deviations.
    - **WP6a**, local layer, run guard, doctor and status: tasks 1–9.
    - **WP6b**, writers and launch: tasks 10–13.

    WP6a alone does not meet all of ADR-0060, so until WP6b these limits
    apply:
    - the `banzai model` picker, the launch gateway and the advisory keep
      reading the committed configuration;
    - the `LOCAL_CONFIG_NOT_IGNORED` message, doctor's text and the docs name
      only the `.gitignore` line, because `banzai model` still ignores
      `--local`.

    The WP6b report proves Compliance 8 and the writer, picker, help and
    launch parts of 2, 4, 7 and 10, including the picker re-check of R3. The
    WP6a report proves the rest, and both prove 11.
- **Q2 · Live check.**
  - **(a) Recommended:** no live vendor session. The Done-when scenario runs
    with PATH shims named `claude` and `codex` in a temporary repository.
  - **(b)** As (a), plus one live run in `~/www/poc/banzai-demo` with a real
    local Claude reviewer after implementation. This needs your go-ahead and
    costs one full short run.
- **Q3 · Agent relay rule.** ADR-0060 expects an agent to relay
  `LOCAL_MODEL_OVERRIDE_CHANGED` to the human. The control protocol has such
  a stop-and-relay rule only for `PROJECT_SETUP_REQUIRED`.
  - **(a) Recommended:** no skill change in WP6, because ADR-0060 keeps phase
    instructions and the control surface unchanged. The tracker records a
    follow-up for a relay rule in the WP that next revises the control
    protocol.
  - **(b)** Add the relay rule to
    `skills/orchestrate/references/control-protocol.md`. ADR-0060 keeps the
    agent control surface unchanged (Compliance 11), so this needs its own
    accepted authority and cannot ride WP6. The file is not in the
    instruction baseline, so no baseline transition applies. Choosing (b)
    schedules that work as its own package now instead of waiting for the
    next control-protocol revision.

## Acceptance

1. ADR-0060 Compliance 1–11 hold, each proven by the tests named in the plan.
   Under Q1 (b), each report proves the part that Q1 assigns to it.
   Compliance 12 is met: the ADR is accepted before any code.
2. Brief Done-when: with a committed Codex reviewer and a local Claude
   reviewer, every review phase runs with the local triple and `git status`
   stays clean. Refused keys and the run guard are tested. Doctor shows the
   source of each model.
3. `status --json`, agent status v7, capabilities v9, run state schemas and
   the execution ignore set are byte-identical. The existing retry and
   eligibility baselines pass unchanged.
4. `npm run format:check` and `npm run verify` pass. `npm run release:validate`
   fails only with the deferred `HOOK_CHANGED_WITHOUT_VERSION_BUMP`.

## Out of scope

- Overriding any key other than the model triple, including `timeoutMs`.
- Builder sandboxing against a model phase that rewrites `.banzai/` (WP17).
- ADR-0059's reviewer rules (WP7), which will read the resolutions built here.
- Changing the plugin skills, policies or phase instructions (see Q3).
- The WP5 follow-up on the `claude.plugin-scope` message text.
