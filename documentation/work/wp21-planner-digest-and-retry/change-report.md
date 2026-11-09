# Change Report: Runner-Control Plan Check False Positives

Date: 2026-11-09. Affected work: [WP21](implementation-report.md), Gate 1 retry.
Authority: the owner's `Yes, fix it here`. Related decisions:
[ADR-0064](../../decisions/0064-runner-recorded-plan-remainder-digest.md) and
[ADR-0065](../../decisions/0065-continuable-planner-declared-planning-blocks.md),
which this fix does not change.

## What changed

`planClauseAccess` in `packages/orchestrator/src/plan-task-completion.ts`
classifies each plan statement that names a runner control path. It now treats
two more forms as reads:

- **A path list joined with `and` or `or` under a read-only label.** A
  conjunction directly before a path continues the list, so
  `` `.banzai/**` and `.claude/settings.json` `` under `Unchanged paths:` reads
  like the comma form, which was already accepted. A conjunction before anything
  else still counts as ambiguous prose.
- **A stated absence of change to a closed list.** `no change to`, and the same
  form with `changes`, `edits`, `modifications`, `updates` or `writes` and `to`,
  `in` or `under`, is a read only when no path comes before it and nothing but
  the list follows it.

## Why

The owner's `banzai retry` of the incident run continued planning as ADR-0065
decides, and the planner requested plan approval. Acceptance then refused the
plan with `PLAN_RUNNER_CONTROL_TASK`. The earlier block had stopped the run
before this check ever ran. Reproduced on the real plan text:

- T001's `Unchanged paths:` item failed as "ambiguous access", although the
  message itself tells the planner to use that label;
- T003's evidence sentence, `` `git status` shows no change to any Markdown file,
`documentation/`, `.banzai/`, … ``, failed as a write target, because `change`
  is a write word and only `do not`, `must not`, `should not` and `never` counted
  as prohibitions.

The refusal wrote nothing: `plan.md` kept its bytes and no digest evidence exists.
That is the order ADR-0064 requires.

## Security exposure

No exposure class applies. The check is a plan-time lint that grants no writes;
the spec-gate hook and phase scope still decide every write, and neither changed.

## Files changed

- Production: `packages/orchestrator/src/plan-task-completion.ts`.
- Tests: `packages/orchestrator/test/plan-task-completion.test.ts`, two tests.
- Documents: this report, the WP21 report's checks and follow-up, and the tracker.

No review finding was involved, so none was skipped.

## Documentation sync

`plugins/banzai/guidance/planning.md` and the planning instruction already tell
planners to use these labels, and the fix makes the check agree with them. The
manifest, `documentation/orchestrator.md` and `MODULES.md` do not describe this
grammar, so they are unchanged. Nothing under `plugins/` changed.

## ADR conformance

No ADR lifecycle change, and accepted ADR bodies are unchanged. ADR-0064's
acceptance order and ADR-0065's continuation are untouched.

[ADR-0045](../../decisions/0045-guided-verification-setup.md) governs this check.
It requires deterministic validation, rejection of ambiguous unsafe targets, and
the spec-gate and post-call scope checks as independent enforcement. All three
hold. Its wording rejects any task naming a path under `.banzai/`, which is
stricter than the code: the check has told reads from writes since `cc61ffc`, and
the planning instruction documents that. This fix stays within that distinction
and does not settle the difference.

## Engineering Quality

Material deviations: None. No structural assessment trigger applies.

Reuse search: `planClauseAccess` is the only classifier of this kind (it appears
only in `plan-task-completion.ts`), and the two new patterns sit beside
`PLAN_PROHIBITION` in that owner.

## Verification

All on 2026-11-09.

| Check                                                            | Result                                                                                                                                                                                        |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fail-first on the pre-fix source                                 | Both new tests failed on the demonstrated inputs.                                                                                                                                             |
| The real `initialize-pnpm/plan.md`, read only                    | Refused before the fix on T001; accepted after it, for tasks T001–T004.                                                                                                                       |
| `plan-task-completion.test.ts`                                   | 28 of 28.                                                                                                                                                                                     |
| `plan-gate-verification.test.ts`, `task-verification.test.ts`    | 6 of 6, 19 of 19.                                                                                                                                                                             |
| `npm run typecheck`, `npm run build`, `npm run build:check`      | Pass, with no change under `plugins/`.                                                                                                                                                        |
| Lint on the two changed files                                    | 0 errors. The warnings are on existing functions, not on changed lines.                                                                                                                       |
| `node packages/orchestrator/scripts/release-candidate-check.mjs` | Pass: verify 2153 of 2153 with lint 0 errors, format, release validation, publication (637 files, clean) and committed smoke. The two local `node_modules` links were set aside and restored. |
| Live vendor run                                                  | Not run by this fix. The owner's next `banzai retry` on the incident run is the confirmation.                                                                                                 |

## Assurance critique

One pass. The negative rows protect the material guarantee, that a write stays
refused:

- a write after the list or after a joined clause;
- a path before the stated absence;
- text after the list;
- a joined list outside a read-only label;
- a joined list under `Files to change:`.

Limit: the check stays lexical. A contrived sentence that hides a write in other
wording can still pass, as it could before. The hook remains the enforcement
point.
