# WP6 implementation report

Status: report ready, not committed · Requirements:
[requirements.md](requirements.md) · Plan: [plan.md](plan.md) · Authority:
[ADR-0060](../../decisions/0060-local-model-override.md), which amends
[ADR-0008](../../decisions/0008-read-only-doctor-diagnostics.md)

The owner approved the plan with `All recommended`: one change set (WP6a and
WP6b were working milestones only), PATH shims instead of a live vendor run,
and no skill changes.

## What changed

| Area                   | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local layer (R1–R3)    | New `src/local-config.ts`: the `.banzai/config.local.json` validator (whole role triples, bare `claude`/`codex`, the ADR model pattern, refused keys as `LOCAL_CONFIG_KEY_REFUSED`, every other defect as `LOCAL_CONFIG_INVALID`, messages without values), the layered reader (`lstat`, then Git index, ignore state, contained read and validation), `mergeModelLayer`, `sameModelLayer` and the effective `loadConfig`. A per-command Git visibility context answers the §4 check once per command. `git.ts` gains exit-code-aware `isPathInIndex` and `isPathIgnored`. `banzai init` writes the exact ignore line. |
| Resolutions (R2)       | `config.ts` exports `loadCommittedConfig`. Every former `loadConfig` site was re-decided: committed-only (verification configuration, status prerequisite, plan inventory, pre-lock start read), effective outside a run (setup, init, the launch's pre-start reads, run start) or the run resolver (every other in-run site and the verification handoffs). `workflow.ts` imports no effective loader; a source test pins it.                                                                                                                                                                                         |
| Run record (R5)        | `RunStore.createRun(state, localModels)` writes `runs/<id>/model-override.json` (`banzai-run-model-override/v1`, mode 0600, create-only) before `state.json` and the active-run pointer. `readModelOverrideRecord` reports absent only for a confirmed run directory; `replaceModelOverrideRecord` renames a private temporary file over the record.                                                                                                                                                                                                                                                                   |
| Run guard (R6)         | A per-command guard holder on `WorkflowRunner`, reset at every public command entry. Check point 1 runs once per state-changing command before its first write, after the §4 Git check; check point 2 runs before every model attempt, before planning attempt creation and before pending transitions. Drift refuses with `LOCAL_MODEL_OVERRIDE_CHANGED` and escaped drift lines; a defective record refuses with `LOCAL_MODEL_OVERRIDE_RECORD_INVALID`. `status` and `cancel` never fill or compare.                                                                                                                 |
| Refusal propagation    | `LocalModelOverrideRefusalError` and `passesThroughRunCatches()` in `errors.ts`. The 33 three-error catches in `workflow.ts` and the ones in `completion/plan-tasks.ts` and `completion/publication.ts` use the predicate; the planning attempt catches, the `executeTaskChecks` catch-all, `requireVerificationApplicability`, `recoveryEligibility` and `failAttempt` rethrow the guard refusals. A refusal adds no block reason, event or review rotation reason.                                                                                                                                                   |
| Recording again (R7)   | Resume in `created` or `selecting` with no model attempt records the current layer. `retry({ terminal })` reads and checks under the eligibility lock, applies the terminal rule, records before a saved-planning reconcile, preflights with the held layer, compares under the failure and execution locks and records before the first transition. `retryPlanningReview` does the same under its lock. The `model_override.recorded` event carries sources only. The CLI passes a TTY-derived flag and the interactive session passes `true`.                                                                        |
| Status (R8)            | New `WorkflowRunner.modelStatus()` and `src/model-status.ts`. Human `banzai status` prints a `Models:` block (or `Current models:` for done and cancelled runs), drift lines and advice; a defective record makes retry and recovery not eligible in the human view and recommends `banzai cancel`. The interactive menu applies the same view. `status --json`, agent status v7 and capabilities v9 are unchanged.                                                                                                                                                                                                    |
| Doctor (R9)            | `config.local` check after `config.version` with fixed text per cause; the top-level `models` array between `projectTypes` and `summary` (role, vendor, model when it matches the pattern, effort, source); role checks on the effective configuration, skipped while `config.local` fails. The two Git queries run through an injected probe, only when the file exists, at the root with `LC_ALL=C`. Doctor JSON stays v6.                                                                                                                                                                                           |
| Writers (R3, R4)       | New `src/model-cli.ts`. `banzai model [--local]` has an exact grammar (`INVALID_MODEL_OPTION`). The picker refuses inside model phases, refuses before `banzai init` with `CONFIG_NOT_FOUND`, runs the exclude step (index first; the clone's exclude file through `git rev-parse --git-path info/exclude`; never `.gitignore`), takes the runner lock, refuses active runs except the blocked-run exception, asks the destination question when §3 requires it, and writes the local file canonically under the lock. "Use shared setting" and per-destination "Match Planning" follow §3.                            |
| Launch (R8, reading 9) | The launch gateway returns the layered view. The header shows run models and drift lines for a non-terminal run, or `(local)` marks; committed-only rows are byte-identical to before. `LOCAL_CONFIG_*` refusals end the launch before authentication. The advisory writes each update to the file that supplies the role, under the runner lock, and names every changed file.                                                                                                                                                                                                                                        |
| Escaping (R10)         | `escapeTerminalField` in `format.ts` adds TAB and LF to terminal escaping; status, header, doctor, picker and progress lines use it for configuration values.                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Docs and checks (R11)  | `documentation/orchestrator.md`, `getting-started.md`, `README.md`, `PROJECT_MANIFEST.md` and `MODULES.md`. `smoke-committed.mjs` checks the init ignore line and the doctor `models` array. `import-boundaries.mjs` registers every new module and edge under `ADR_0060`. ADR-0060 is in the release-validation fixture list. ADR-0060, its index row and the ADR-0008 lifecycle line are set to implemented.                                                                                                                                                                                                         |

## Tests

| Compliance        | Proof                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 Local reviewer  | `local-model-override.test.ts`: a committed `codex` reviewer and a local `claude` reviewer through PATH shims; every review request carries the local triple and no `.banzai` path appears in `git status`. A profile-mode fixture with a recorded sidecar shows that `resume` at a configuration prerequisite compares the record first (see Deviations for the satisfied branch).                             |
| 2 Refusals        | `local-config.test.ts`: each refused key and defect, value-free messages, link targets unchanged after a writer runs, merge and equality rules.                                                                                                                                                                                                                                                                 |
| 3 Drift refuses   | `local-model-override.test.ts` entry matrix over 13 commands with byte, status and adapter-call checks; drift during task verification, before analysis, before the verification and review retry transitions; retry-preflight, review-check and verification-applicability paths adding no block reason, event or rotation reason; `banzai cancel` during drift; a formatting-only edit; restore and continue. |
| 4 Retry records   | Terminal and non-terminal retry, the blocked-from-`created` case, the saved-planning reconcile, preflight failure with and without a reconcile, edits between locks, `retryPlanningReview`, a legacy run gaining a sidecar, and resume recording in `created` and `selecting`.                                                                                                                                  |
| 5 Committed edits | Existing retry tests and `workflow-eligibility.test.ts` `ELIGIBILITY_BASELINE` pass unchanged.                                                                                                                                                                                                                                                                                                                  |
| 6 Sidecar         | `store.test.ts`: write order, create-only and mode, injected failure, legacy, corrupt and symbolic-link records. `local-model-override.test.ts`: resume after a crash before the first attempt records afresh.                                                                                                                                                                                                  |
| 7 Ignores         | `config.test.ts`, `git.test.ts` (index, ignore, exclude in a main and a linked worktree, linked `info/`, a swapped `info/`), start, resume and approve refusals before any write, a second start re-checking, and the launch PTY refusal before any vendor executable.                                                                                                                                          |
| 8 Writers         | `model-selection.test.ts`, `cli-routing.test.ts`, `setup-pty.test.ts`, `interactive.test.ts`: every case of plan Tests row 8, the advisory routing in a real repository, refusals before `banzai init`, and a `.banzai/` swapped for a link mid-write.                                                                                                                                                          |
| 9 Doctor          | `doctor.test.ts` and `doctor-cli.test.ts`: check order, every cause, the probe and a real-Git query log, disclosure rules, the privacy canary, effective role checks and their skips, the symbolic-link `.banzai/` case, the `Models:` block.                                                                                                                                                                   |
| 10 Docs           | `cli-routing.test.ts` help and grammar assertions; the documentation listed above.                                                                                                                                                                                                                                                                                                                              |
| 11 Contracts      | A literal key-list pin for `status --json`, `agent-control*.test.ts`, `release-validation.test.ts`, `execution-ownership.test.ts`, `import-boundaries.test.ts` and the `workflow.ts` import pin.                                                                                                                                                                                                                |
| Escaping          | `format.test.ts`, `progress.test.ts`, status, header, doctor and picker tests with hostile values.                                                                                                                                                                                                                                                                                                              |

## Checks

All run on 2026-11-05 against the final working tree, after `npm run build`.

| Command                                               | Result                                                                                   |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `npm run verify`                                      | Pass: typecheck clean; lint 0 errors (426 warnings); 2022 of 2022 tests; `build:check`.  |
| `npm run smoke:committed`                             | Pass.                                                                                    |
| `npm run format:check` and `prettier --check` on docs | Pass.                                                                                    |
| `release-validation.test.ts`, `publication.test.ts`   | 193 of 193 after the ADR lifecycle edits.                                                |
| `npm run release:validate`                            | Only the deferred `HOOK_CHANGED_WITHOUT_VERSION_BUMP`; nothing under `plugins/` changed. |

An independent read-only review of the whole diff against ADR-0060 found no
major defects and four minor ones, all fixed:

1. A missing test for the Compliance 1 prerequisite clause; see Deviations.
2. `banzai model` before `banzai init` added an exclude line and then failed
   with the wrong code. It now refuses with `CONFIG_NOT_FOUND` before writing
   anything.
3. The local writer and the exclude append checked `.banzai/` and `info/`
   once. They now re-check identity before open and rename.
4. The interactive menu offered Retry and Recover for a run whose record is
   invalid. It now uses the same human view as `banzai status`.

## Deviations from the plan

- **Two more modules.** `src/model-status.ts` holds the human status
  rendering, and `src/model-cli.ts` holds the `banzai model` grammar, picker
  sequence and launch writer, because `cli.ts` runs on import and cannot be
  tested directly. Both are registered under ADR-0060.
- **Check point 1 splits by cause.** A tracked or unignored local file refuses
  with `LOCAL_CONFIG_NOT_IGNORED` at command entry; an invalid file at entry,
  and any unusable file at check point 2, refuses with
  `LOCAL_MODEL_OVERRIDE_CHANGED` and a one-line cause.
- **New error codes the ADR does not name.** `GIT_EXCLUDE_UNSAFE` (an unsafe
  `info/` or exclude file) and `MODEL_CONFIGURATION_CHANGED` (the launch
  advisory found the configuration changed after it was shown). The local file
  is written with mode 0600, like the run record; the ADR states no mode.
- **Launch.** Run rows in the header also carry `(local)` marks. The advisory
  writer takes the runner lock, re-checks the active run and the shown
  configuration under it, and writes the local file before the committed one.
- **Agent retry.** No agent-specific retry command exists; agents run
  `banzai retry` without a TTY and get `terminal: false`. An agent under a PTY
  would count as a terminal.
- **Compliance 1 prerequisite clause.** Every profile-mode state carries a
  pre-v3 work binding, which every configuration-prerequisite entry refuses
  with `ARTIFACT_VERSION_UNSUPPORTED` before reading configuration. The
  satisfied-prerequisite handoff therefore cannot be reached with valid state;
  it uses the run resolver by inspection, and the test proves the entry check
  that precedes it. A configuration answer cannot be driven to a drift refusal
  for the same reason.
- **Not tested end to end.** The `banzai setup` refusal (it needs a TTY), and a
  CLI-level test of the retry terminal flag; both paths are covered at the unit
  level.
- **Plugin library.** `plugins/banzai/lib/artifact-readers.mjs` is
  byte-identical. `npm run release:validate` still reports the deferred
  `HOOK_CHANGED_WITHOUT_VERSION_BUMP` from earlier packages.

## Follow-ups

- The WP that next revises
  `skills/orchestrate/references/control-protocol.md` adds a stop-and-relay
  rule for `LOCAL_MODEL_OVERRIDE_CHANGED` (owner decision, 2026-11-04).
- Before Gate 1, a quick fix checks the WP5 `claude.plugin-scope` doctor
  message against ADR-0008's privacy rules.
