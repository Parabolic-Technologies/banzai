# WP6 plan

Requirements: [requirements.md](requirements.md). Authority:
[ADR-0060](../../decisions/0060-local-model-override.md), accepted 2026-11-04;
it amends [ADR-0008](../../decisions/0008-read-only-doctor-diagnostics.md).

The tasks are grouped as WP6a (tasks 1–9) and WP6b (tasks 10–13).

- Under Q1 (a), the recommendation, both groups form one change set with one
  report. Task 9 writes no separate report, and Sequencing step 4 does not
  pause for a commit.
- Under Q1 (b), each group is its own change set. WP6a keeps the
  `banzai model` picker, the launch gateway and the advisory on
  `loadCommittedConfig` until WP6b. In the Tests table these are WP6b proofs:
  - the writer clause of row 2;
  - the `banzai model --local` path of row 4;
  - the exclude and launch-refusal cases of row 7;
  - row 8;
  - the help assertions of row 10;
  - the header case of the escaping row.

  Row 11 runs in both.

## Approach

- **One new module for the local layer.** `src/local-config.ts` holds:
  - `LOCAL_CONFIG_FILE` as a string literal;
  - the pure validator `parseLocalModelLayer`;
  - the layered reader;
  - `mergeModelLayer` and `sameModelLayer`;
  - the effective `loadConfig`;
  - the local writer, the exclude step and the doctor Git probe.

  Keeping it out of `config.ts` and `validation.ts` keeps the persisted-reader
  bundle (`plugins/banzai/lib/artifact-readers.mjs`) unchanged where possible.
  Any byte change that remains rides the Gate 1 version bump.

- **Compiler-visible audit of every reader.** `config.ts` stops exporting
  `loadConfig` and exports `loadCommittedConfig`. Every one of the 29
  `workflow.ts` call sites and every `cli.ts` call site must then choose
  between three resolutions: committed-only, effective (outside a run), or the
  run resolver.
- **Per-command guard holder.** `WorkflowRunner` gets a holder that each
  public command entry resets. It holds the record, or for retry the held
  layer, and serves the run resolver and both check points.
  - `status()` never fills or uses it. It reads the sidecar once without
    throwing and passes the run-effective configuration it builds (none for a
    defective sidecar) as an argument to `recoveryEligibility` and
    `completionPublicationStatus`. With none, their configuration evidence
    counts as unavailable, as an unreadable configuration does today.
  - State-changing callers of `recoveryEligibility` pass the holder's
    resolution.
- **One refusal predicate.** `errors.ts` adds `LocalModelOverrideRefusalError`
  (both codes) and `passesThroughRunCatches(error)`.
  - Every catch that today passes all three of `TerminalRunStateError`,
    `ProjectSetupRequiredError` and `InstructionResourceMismatchError` through
    switches to the predicate: 33 in `workflow.ts`, and one each in
    `workflow/completion/plan-tasks.ts` and
    `workflow/completion/publication.ts`.
  - Catches that pass only `TerminalRunStateError` keep their behaviour.
  - The catches named in ADR-0060 §5 add the predicate. `failAttempt`
    rethrows the guard refusals as a backstop.
- **Human-only model status.** A new read-only runner method,
  `modelStatus(state)`, feeds `banzai status` and the launch header.
  `WorkflowStatus` gains no field, so `status --json` and agent status stay
  byte-identical.
- **Fixtures.**
  - `createTestRepository` gains an opt-in ignore line.
  - Tests get a helper that writes canonical local files, and a PATH shim
    helper that provides `claude` and `codex` executables delegating to the
    existing fake adapters.

## Tasks

### WP6a · Local layer, run guard, doctor and status

1. **Local layer (`local-config.ts`, `types.ts`, `git.ts`, `errors.ts`).**
   - Add the validator per R1, including the message rules and readings 2–3.
   - Add the layered reader through `readBytes(…, {optional: true, limit:
65536})`. Map every `ProjectFileError` to `LOCAL_CONFIG_INVALID`.
   - Add `mergeModelLayer`, `sameModelLayer` and the source types.
   - `git.ts` gains exit-code-aware `isPathInIndex` and `isPathIgnored`.
   - Add the per-cause `LOCAL_CONFIG_NOT_IGNORED` messages. Under Q1 (b),
     until WP6b the message for an untracked, unignored file names only the
     `.gitignore` line; task 11 adds the `banzai model --local` route to it.
   - Add the effective `loadConfig({ visibility })`. It takes a per-command
     visibility context that callers create at each command entry and never
     cache.
   - Register in `import-boundaries.mjs`, each edge under ADR-0060:
     - the module and its own edges;
     - every importer's edge to it, such as `cli.ts`, `doctor.ts`,
       `store.ts` and `workflow.ts`;
     - `doctor-cli.ts` → `format.js` (WP6a) and `model-selection.ts` →
       `format.js` (WP6b), for escaping.

     Add `ADR_0060` to `POLICY_ADR_AUTHORITIES`.

   - Add ADR-0060 to `FIXTURE_PATHS` in
     `packages/orchestrator/test/release-validation.test.ts` (brief rule 4).
2. **Resolutions (`config.ts`, `cli.ts`, `workflow.ts`).**
   - Rename the committed reader to `loadCommittedConfig`.
   - Route each call site per R2:
     - committed-only: verification configuration, the status prerequisite
       (`workflow.ts:5189`), the plan inventory (`:4417`) and the pre-lock
       start read (`:1419`);
     - effective: `cli.ts` setup (`:1147`, `:1296`), init's project setup and
       permission report (`:1089`), the launch's `beforeStart` reads
       (`:1166`) and run start (`:1305`, `:1343`);
     - committed until tasks 11–12 move them to the layered reader:
       `runModelPicker` (`:773`, the init picker and `banzai model`) and the
       launch gateway (`:183`: header, authentication markers and advisory).
       No local triple reaches `applyModelUpdates` before then. The gateway
       still runs the effective loader's checks, so a local-file refusal ends
       the launch before authentication;
     - run resolver: every other in-run site, including the handoffs at
       `:4348`, `:4362` and `:4614`.
   - `initializeConfig` adds the exact ignore line (R3).
   - Pass effective configuration to setup client discovery and the init
     permission report.
3. **Store (`store.ts`).**
   - `createRun(state, localModels = {})` writes the sidecar create-only, mode
     0600, before `state.json` and the pointer.
   - Add `readModelOverrideRecord(runId)`. It reports absent only after the
     run directory is confirmed, and defective otherwise.
   - Add `replaceModelOverrideRecord(runId, models)`, which writes a temporary
     file and renames it over the sidecar.
   - `characterization-trace.ts` forwards every `createRun` argument.
4. **Guard holder and check points (`workflow.ts`).**
   - Add the holder, the run resolver and check point 1 at every listed
     command entry, before its first write (readings 12, 15). Check point 1
     and the resume recording first run the §4 index and ignore check once
     per command and refuse with `LOCAL_CONFIG_NOT_IGNORED`.
   - Run start makes the single layered read under its lock and passes the
     layer to `createRun` (reading 19).
   - Add check point 2 in `beforeModelAttempt` (only with an invocation or a
     pending transition), before attempt creation in `executePlanningStep`,
     and before the retry transition commit in `executeReview` (reading 14).
   - Build the drift lines with the field-level escape (task 8).
5. **Refusal propagation (`errors.ts`, `workflow.ts`, `lifecycle.ts`,
   `completion/plan-tasks.ts`, `completion/publication.ts`).**
   - Switch the existing three-error pass-through catches to the predicate.
   - Add the rethrow to the `executePlanningStep` and
     `reconcilePlanningAttempt` attempt catches and to the `executeTaskChecks`
     catch-all.
   - Add the `RECORD_INVALID` rethrow to `requireVerificationApplicability`
     and `recoveryEligibility` in state-changing commands only.
   - Add the guard refusals to the `executeAuthorizedRecovery` and retry
     preflight pass-throughs.
   - Add the `failAttempt` backstop.
6. **Recording again (`workflow.ts`, `cli.ts`, `interactive.ts`).**
   - Resume of a run in `created` or `selecting` with no model attempt records
     the layer (reading 13).
   - `retry({ terminal })`:
     - under the eligibility lock: read, check (reading 16), apply the
       terminal rule, and record before a saved-planning reconcile;
     - preflight with the held layer;
     - compare under the failure and execution locks;
     - under the execution lock, before the first transition: print, replace
       the sidecar and append `model_override.recorded`.
   - `retryPlanningReview` does all of this under its single lock.
   - A legacy run gains a sidecar on its first recording.
   - The CLI, interactive and agent routes pass the terminal flag (reading 17).
7. **Status (`workflow.ts`, `cli.ts`).**
   - Add `modelStatus(state)`.
   - `status()` reads the sidecar without throwing and passes the
     run-effective configuration to the recovery and completion-publication
     helpers (see Approach).
   - For a defective sidecar `status()` leaves `retry`, `recovery` and
     `nextAction` as state and evidence give them, because `status --json`
     carries those fields and `agent-control.ts` derives agent status from
     `retry` and `recovery`. `modelStatus(state)` reports the defect, and
     `cli.ts` applies the reading 11 override to the human output only.
   - `cli.ts` renders the status block of reading 10 on the human path only.
   - The CLI `recover` pre-check names the sidecar when it is invalid.
8. **Doctor and escaping (`doctor.ts`, `doctor-cli.ts`, `format.ts`,
   `progress.ts`, `workflow.ts`).**
   - `format.ts` gains the field-level escape (reading 21). Progress banners
     and the live status line use it.
   - Doctor reads the local layer through the layered reader. An injected
     `localConfigGitState` probe runs exactly the two §8 queries, only when
     the file exists.
   - Add the `config.local` check after `config.version`, the `models` array
     before `summary`, and the effective role checks with their skip reasons.
   - `doctor-cli.ts` prints the escaped `Models:` block.
9. **WP6a tests and docs.**
   - Tests: see "Tests" below.
   - Docs:
     - `documentation/orchestrator.md`: doctor, Failure Recovery, Agent Control
       and Local State;
     - `getting-started.md`: a hand-written local file and the troubleshooting
       rows;
     - `README.md` and `PROJECT_MANIFEST.md`;
     - `MODULES.md` entries for config, local-config, git, errors, store,
       workflow, doctor, doctor-cli and format.
   - `scripts/smoke-committed.mjs` and its fake bundle check the init ignore
     line and the `models` array.
   - Under Q1 (b), write the WP6a report and update the tracker.

### WP6b · Writers and launch

10. **Grammar and routing (`cli-routing.ts`, `cli.ts`).**
    - `model` joins the exact-contract list. Add the exact parser
      (`INVALID_MODEL_OPTION`, reading 5).
    - Update the help, the usage line and the overview row.
11. **Picker and writers (`cli.ts`, `model-selection.ts`, `local-config.ts`).**
    - Picker order as in reading 4, with the exclude step resolved through
      `git rev-parse --git-path info/exclude`.
    - Add the destination question, the local menus, "Use shared setting"
      (reading 7) and per-destination "Match Planning".
    - Add the local writer with temporary file, rename, link checks and fixed
      format.
    - Add the blocked-run exception and the `banzai cancel` refusal
      (reading 8).
    - Add the init picker behaviour (reading 6).
    - Escape picker text built from configuration values.
12. **Launch (`interactive.ts`, `cli.ts`).**
    - The gateway returns the layered view.
    - The launch refuses before authentication (reading 9).
    - The header shows run models and drift lines, or local marks; rows from
      the committed file only stay byte-identical.
    - The advisory routes each update to its source file and names every
      changed file.
13. **WP6b tests and docs.**
    - Tests: `model-selection`, `cli-routing` (grammar, help, non-TTY),
      `setup-pty` (destination question, init), `interactive` (header,
      advisory, launch refusal) and the `local-config` writer and exclude
      cases.
    - Docs: `orchestrator.md` (commands, Choosing Models, Model
      Configuration), `getting-started.md` (`banzai model --local` route),
      `README.md`, `PROJECT_MANIFEST.md` and `MODULES.md` (cli, cli-routing,
      model-selection, interactive).
    - Set ADR-0060's implementation state line and its decisions-index row to
      implemented, and update the ADR-0008 lifecycle line's implementation
      state.
    - Write the report (the WP6b report under Q1 (b)) and update the tracker.

## Tests

| Compliance        | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1 Local reviewer  | New `local-model-override.test.ts`. It uses a temporary Git repository with the ignore line, a committed `codex` reviewer, a local `claude` reviewer and PATH shims. Every review request carries the local triple, and `git status` is clean before and after. The prerequisite clause uses a profile-mode fixture that carries a sidecar (reading 23).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 2 Refusals        | New `local-config.test.ts` covers each refused key and defect, the messages without values, the link targets left unchanged after a writer runs, and the merge and equality rules.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 3 Drift refuses   | Entry matrix in `local-model-override.test.ts`, modelled on `workflow-project.test.ts:774`. Resume, approve, triage, recover, rework, planning-review request and answer, ADR and human decisions, and configuration answers each refuse and leave bytes unchanged. Also covered: drift during task verification (`state.taskVerification` kept); drift before analysis after a completed planning review (the review attempt stays completed); drift before a pending transition is committed (the `executeVerification` transition and the `executeReview` retry transition); a refusal on the retry-preflight, review-check and verification-applicability paths (the last with a corrupt sidecar) adding no block reason, event or rotation reason; `banzai cancel` succeeding during drift; a formatting-only edit passing; a restore continuing; and status showing drift with `nextAction` unchanged. |
| 4 Retry records   | Retry with a terminal prints the change, replaces the sidecar, appends the event and runs with the new triple. Retry without a terminal after a model attempt refuses and writes nothing. A run blocked from `created` records without a terminal. A reconcile of a saved planning result records before approval. A preflight failure leaves the record unchanged, and one after such a reconcile keeps the layer recorded there. Edits between locks refuse. WP6b adds the `banzai model --local` path.                                                                                                                                                                                                                                                                                                                                                                                                    |
| 5 Committed edits | The existing retry tests and `workflow-eligibility.test.ts` `ELIGIBILITY_BASELINE` pass unchanged.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 6 Sidecar         | `store.test.ts`: write order, create-only and mode, and an injected failure leaving no state. Legacy, corrupt and symbolic-link sidecars, and a crash before the first attempt resuming with a fresh record.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 7 Ignores         | `config.test.ts` (init line once, broad rules), `git.test.ts` (index, ignore, exclude in a main and a linked worktree, linked `info/`), the launch, run start, `banzai setup`, resume, retry and approve refusing before any executable or write, and an interactive second start re-checking.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 8 Writers         | WP6b. `model-selection.test.ts`, `cli-routing.test.ts`, `setup-pty.test.ts` and `interactive.test.ts`, as in task 13, with these cases: `--local` and "Use shared setting" write only the local file and delete an empty one; the destination question writes only the chosen file; committed-destination "Match Planning" copies the committed planner triple; the advisory writes only the file that supplies each role; a held runner lock and `BANZAI_*` variables refuse with nothing written; a blocked run for which status recommends retry writes only the local file and prints the retry line; every other active state refuses and names `banzai cancel`; a defective local file stops the picker before any menu; a tracked local file is refused by the picker and the advisory; local writes leave `.gitignore` unchanged.                                                                    |
| 9 Doctor          | `doctor.test.ts`: check order, each fixed-text cause, the injected probe and a real-Git run showing only the two queries, the `models` disclosure rules, the privacy canary extended to keys and committed values, `claude.instructions`, `claude.permissions` and `executables.models` evaluated on a local reviewer triple and skipped with an empty `models` while `config.local` fails, and the symbolic-link `.banzai/` case. `doctor-cli.test.ts`: key order and the `Models:` block.                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 10 Docs           | `cli-routing.test.ts` help assertions; documentation reviewed with the plan review of each report.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 11 Contracts      | A new `local-model-override.test.ts` case pins the literal top-level key list of `status --json` for a run with a local file and a sidecar and finds no local model value in it (`verification-failure-details.test.ts:191` compares with `runner.status()` and cannot detect a new field). Also `agent-control*.test.ts`, `release-validation.test.ts:1038`, `execution-ownership.test.ts` (no local entry) and `import-boundaries.test.ts` (ADR-0060 edges; doctor still cannot import `git.js` or `project-files.js`), plus a source check that `workflow.ts` imports no `loadConfig` binding from `./local-config.js`.                                                                                                                                                                                                                                                                                   |
| Escaping          | `format.test.ts`: TAB, LF, ESC, C1 and bidi, idempotent. A status, header and progress line with a hostile model value.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

## Checks

- Focused suites with
  `node packages/orchestrator/scripts/test.mjs --file <name>.test.ts` after
  each task.
- `npm run build` before the committed-CLI, smoke and PTY suites. The PTY
  suite needs `npm ci` and `python3`.
- `npm run format:check` and `npm run verify` at the end of each change set.
- `npm run release:validate`: the only expected failure is the deferred
  `HOOK_CHANGED_WITHOUT_VERSION_BUMP`. The report records whether
  `artifact-readers.mjs` bytes changed.
- A manual run of the built CLI in a scratch repository:
  - `banzai doctor` with no local file, a valid one, a tracked one and an
    invalid one;
  - `banzai status` with drift;
  - after task 11, `banzai model --local`.

## Sequencing

1. Tasks 1 and 3 first. Task 2 lands with task 4, because its in-run sites
   route to task 4's run resolver.
2. The field-level escape of task 8 comes before task 4, which builds the
   drift lines with it. Tasks 4–6 form one unit: the guard is safe only once
   refusals propagate.
3. Task 7 follows task 4. The doctor part of task 8 can run in parallel with
   tasks 4–6 once task 1 is done.
4. Task 9 closes WP6a. Under Q1 (b), WP6b starts only after the owner commits
   WP6a.
5. Tasks 10–12 are sequential; task 13 closes WP6.

## Risks

- **Missed in-run reader.** A site left on the effective loader reads the
  current local file during a run. Deleting the `loadConfig` import from
  `workflow.ts` and `cli.ts`, with no alias, makes every call site fail with
  TS2304 until it is re-decided. Renaming the export alone fails only the
  import line (TS2305). The `:4362` handoff passes `readVerificationConfig`'s
  committed configuration and is changed by hand. A source test pins that
  `workflow.ts` never imports the effective loader.
- **Status contract.** Any field added to `WorkflowStatus` changes
  `status --json`. Model data comes only from `modelStatus`.
- **Plugin library bytes.** Changes to `validation.ts`, `models.ts`,
  `config.ts` top-level code or `project-files.mjs` regenerate
  `artifact-readers.mjs`. The plan avoids them; any change that remains is
  reported and rides Gate 1.
- **Fixture defaults.** Without the opt-in ignore line, tests that write a
  local file hit `LOCAL_CONFIG_NOT_IGNORED`. Executables in the fixtures are
  `process.execPath`, so local triples need the PATH shims.
- **WP7 overlap.** WP7 edits `models.ts` and `model-selection.ts`. The
  bare-name guarantee rests on the catalog's executables being exactly
  `claude` and `codex`; `model-selection.test.ts` keeps asserting that.

Size: about 6–7 days in total (WP6a about 4 days, WP6b about 2–3 days).
