# Change Report: Runner-Control Plan Check False Positives

Date: 2026-11-09. Affected work: [WP21](implementation-report.md), Gate 1 retry.
Authority: the owner's `Yes, fix it here`, and the owner's later request to fix
the third refusal. Related decisions:
[ADR-0064](../../decisions/0064-runner-recorded-plan-remainder-digest.md) and
[ADR-0065](../../decisions/0065-continuable-planner-declared-planning-blocks.md),
which this fix does not change.

## What changed

`planClauseAccess` in `packages/orchestrator/src/plan-task-completion.ts`
classifies each plan statement that names a runner control path. It now treats
two more forms as reads:

- **A statement under a read-only label that names no write.** Under
  `Unchanged paths:` or `Read-only references:`, a statement is a read unless it
  contains a recognized write action. Its entries can be paths joined with `and`
  or `or`, or descriptions such as `the reference`. This replaces the first
  version of this fix, which allowed only `and` and `or` directly before a path.
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

The first version of this fix, committed in `d84ba84`, covered only those two
forms. A new run in the same project then spent 13 minutes planning and failed on
T003:

```text
Unchanged paths: `AGENTS.md`, the reference, `CLAUDE.md`, `.claude/**`,
`.banzai/**`, `package.json`, and accepted ADR bodies.
```

Patching one more phrase would not end this. The label already states what its
entries are, and the check was second-guessing it, even though its own message
tells planners to use that label. Each false refusal also costs a planning attempt.

## Security exposure

No exposure class applies. The check is a plan-time lint that grants no writes;
the spec-gate hook and phase scope still decide every write, and neither changed.

## Files changed

- Production: `packages/orchestrator/src/plan-task-completion.ts`.
- Tests: `packages/orchestrator/test/plan-task-completion.test.ts`, two tests. The
  first was rewritten for the broader rule.
- Documents: this report, the WP21 report's checks and follow-up, and the tracker.

No review finding was involved, so none was skipped.

## Documentation sync

`plugins/banzai/guidance/planning.md` and the planning instruction already tell
planners to use these labels, and the fix makes the check agree with them. The
manifest, `documentation/orchestrator.md` and `MODULES.md` do not describe this
grammar, so they are unchanged. This fix changes nothing under `plugins/`.

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
only in `plan-task-completion.ts`), and `PLAN_NO_CHANGE` sits beside
`PLAN_PROHIBITION` in that owner. The read-only rule replaces the earlier
list-only check, so the classifier has one rule less.

## Verification

All on 2026-11-09.

| Check                                                            | Result                                                                                                                                                                                                                                             |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fail-first on the pre-fix source                                 | The first version's two tests failed on the demonstrated inputs. The rewritten test failed on the real T003 text before the broader rule.                                                                                                          |
| The real plans, read only                                        | `initialize-pnpm` (4 tasks) and `optimize-agents-md-file-using-context-engineering-technics` (3 tasks) are both accepted.                                                                                                                          |
| `plan-task-completion.test.ts`                                   | 28 of 28.                                                                                                                                                                                                                                          |
| `plan-gate-verification.test.ts`, `task-verification.test.ts`    | 6 of 6, 19 of 19.                                                                                                                                                                                                                                  |
| `npm run typecheck`, `npm run build`, `npm run build:check`      | Pass. The `plugins/` changes in the tree are the separate 2.8.0 version edit.                                                                                                                                                                      |
| Lint on the two changed files                                    | 0 errors. The warnings are on existing functions, not on changed lines.                                                                                                                                                                            |
| `node packages/orchestrator/scripts/release-candidate-check.mjs` | Pass on the tree with this fix and the 2.8.0 version edit: verify 2153 of 2153 with lint 0 errors, format, release validation, publication (640 files, clean) and committed smoke. The two local `node_modules` links were set aside and restored. |
| Historical, first version of this fix                            | The candidate check passed: verify 2153 of 2153, format, release validation, publication and committed smoke.                                                                                                                                      |
| Real run                                                         | The new run accepted its plan on `banzai retry` and reached implementation, which completed. No separate live vendor suite ran.                                                                                                                    |

## Assurance critique

One pass. The negative rows protect the material guarantee, that a recognized write
stays refused:

- a write after the list, after `and` or after `then`;
- a path before the stated absence;
- text after the list;
- a joined list outside a read-only label;
- a read-only statement followed by a `Files:` line naming the same path;
- a joined list under `Files to change:`.

Limit, and the trade-off in this fix: an unrecognized verb under a read-only label
now passes, for example ``Unchanged paths: `.banzai/x` and regenerate it``. That
label is explicit, a false refusal costs a whole planning attempt, and this check is
not the enforcement point: the spec-gate hook and phase scope still refuse the write
at run time. A descriptive entry that contains a write word, such as `the update
log`, is still refused as a write, which the planner can reword on retry.
