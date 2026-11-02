# banzai 2.8–2.9 program tracker

Status: active · Stage 1 in progress · Updated 2026-11-02

This file is the only living record of the program. The plan itself is the
frozen [brief.md](brief.md); never edit it. Record anything that departs from
the brief under [Deviations from the brief](#deviations-from-the-brief).

## How to use this tracker

1. Start every session here: read this file, then the brief section of the
   work package (WP) you are about to touch, then the reading list in the
   brief's "How to work with this brief".
2. One WP, one change set, one `documentation/work/<slug>/` directory with
   `requirements.md`, `plan.md` and a report. Turn the brief's "Done when"
   items into numbered requirements and link the brief section.
3. A WP is done only when its report is written and its row below is updated.
   The owner commits by hand; start the next WP only after that commit, so
   two change sets never mix in the working tree. Parallel WPs need separate
   worktrees.
4. Reserve an ADR ID in [ADR reservations](#adr-reservations) when its draft
   starts, and check `documentation/decisions/` for a collision right before
   writing the file. No code relies on a `Proposed` ADR.
5. After the last WP of a stage, write the gate report in this directory and
   stop for the owner.

Status values: `not started` · `ADR draft` · `ADR proposed` · `ADR accepted` ·
`in progress` · `report ready` · `committed`.

## Baseline

- The brief was written against `0145686` (main, merge of PR 22, 2.7.4,
  2026-10-23). On 2026-10-30 `dev` at `258efe3` has the identical tree, so the
  brief's file and symbol references apply as written.
- Next free ADR ID on 2026-10-30: 0057.
- ADRs pinned in `packages/orchestrator/phase-guidance-current.json` (checked
  2026-10-30, matches the brief): 0043, 0044, 0045, 0047, 0049, 0050, 0054, 0055. Any lifecycle change to them needs the before/after allow-list entry in
  `packages/orchestrator/scripts/phase-resources-build.mjs`. This affects WP2
  (amends 0045) and WP9 (amends 0049, affects 0047).

## Stage 1 (2.8): daily friction

| WP  | Package                                        | Depends on      | ADR                                          | Work directory                         | Status       | Commit  | Notes                                              |
| --- | ---------------------------------------------- | --------------- | -------------------------------------------- | -------------------------------------- | ------------ | ------- | -------------------------------------------------- |
| WP1 | Verification failure details and retry warning | —               | none                                         | `wp01-verification-failure-details`    | committed    | d03bc19 | phpcs fixture built; see report deviations         |
| WP2 | Run every required check in one pass           | —               | 0057 Accepted; amends 0045 (pinned)          | `wp02-full-verification-pass`          | committed    | da624a4 | Full rounds, one retry; helper v4 published by WP4 |
| WP3 | Verification commands at the plan gate         | —               | none; cite 0049 for instruction change       | `wp03-plan-gate-verification-commands` | committed    | 44f3d03 | Plan gate lists checks; see report deviations      |
| WP4 | Re-check human edits at the plan gate          | —               | 0058 Accepted; amends 0051 and 0055 (pinned) | `wp04-plan-gate-edit-recheck`          | committed    | 04abf55 | Control 9.0.0 with recheck and helper v4           |
| WP5 | Install guide, plugin scope, doctor hint       | —               | none; stay within 0008                       | `wp05-install-guide-plugin-scope`      | report ready |         | Doctor JSON contract version bump                  |
| WP6 | Local model override                           | —               | check eligibility; short ADR likely          | `wp06-local-model-override`            | not started  |         | Do before WP7                                      |
| WP7 | Claude as the default reviewer, with isolation | WP6 recommended | 0059 Accepted; amends 0042 §7, 0037, 0002    | `wp07-claude-default-reviewer`         | ADR accepted |         | live scenario needs go-ahead                       |
| WP8 | Stable Claude phases                           | —               | check 0020                                   | `wp08-stable-claude-phases`            | not started  |         | Live scenario needs go-ahead                       |

### Gate 1

Report: `gate-1-report.md` (not written).

- [ ] phpcs fixture: the command is visible at the plan gate; the blocked
      summary shows argv, exit code, stderr tail and log paths; every required
      check ran; Retry warns about a deterministic failure.
- [ ] A prose edit to plan.md is re-checked and approved without manual
      hashing (WP4, after its ADR is accepted).
- [ ] A Claude-only developer installs at local scope from the terminal,
      leaves `.banzai/config.json` untouched through `config.local.json`, and
      gets Claude as the default reviewer.
- [ ] `npm run verify` is green, and the owner-authorized live scenarios pass
      on Claude Code 2.1.290 and on the current release.
- [ ] The release train is set to the 2.8 version with
      `npm run version:set`, and `npm run release:validate` passes.

## Stage 2 (2.9): no lost runs

Starts only after the owner closes Gate 1.

| WP   | Package                                                  | Depends on    | ADR                                                         | Work directory                         | Status      | Commit | Notes                        |
| ---- | -------------------------------------------------------- | ------------- | ----------------------------------------------------------- | -------------------------------------- | ----------- | ------ | ---------------------------- |
| WP9  | Correct a verification command without re-implementation | WP1, WP3      | new, amends 0049 §1, §2, §4 (pinned); affects 0047 (pinned) | `wp09-verification-command-correction` | not started |        | Control protocol revision    |
| WP10 | Baseline check run before implementation                 | WP1, WP3, WP9 | new                                                         | `wp10-baseline-check-run`              | not started |        | Control protocol revision    |
| WP11 | Workflow choice: explanation and override                | —             | new, amends 0001                                            | `wp11-workflow-choice-override`        | not started |        | Template text changes        |
| WP12 | Slim AGENTS.md template, small-project mode              | —             | new, amends 0036 and 0040                                   | `wp12-slim-agents-template`            | not started |        | Release layout check changes |
| WP13 | Subscription limits without manual retry                 | WP8           | check 0021                                                  | `wp13-subscription-limit-retry`        | not started |        | Live scenario needs go-ahead |
| WP14 | Permission denials as a remediation list                 | WP8           | none expected                                               | `wp14-permission-denial-list`          | not started |        | Live scenario needs go-ahead |

### Gate 2

Report: `gate-2-report.md` (not written).

- [ ] On the phpcs fixture, the wrong mandatory command is corrected through
      WP9 and verification passes without re-implementation; the audit trail
      shows both approvals and every attempt.
- [ ] The baseline run (WP10) catches the wrong command before implementation
      starts.
- [ ] One real project run by the owner confirms the WP9 route.
- [ ] `npm run verify` is green, and WP13 and WP14 pass the owner-authorized
      live probe.

## Stage 3: measure

Planned only after Gate 2; each package needs its own requirements first.
WP15 eval suite, WP16 native attempt limits, WP17 builder sandbox, WP18 full
context accounting.

### Eval cases queued for WP15

- WP3, documented commands: a PHP project whose `composer.json` script
  `cs-check` runs `php-cs-fixer fix --dry-run --diff --config=.php-cs-fixer.php`.
  A strict plan passes when its lint obligation is `composer run-script cs-check`
  or keeps `--config=.php-cs-fixer.php`, and cites `composer.json` in
  `sources`; it fails when the config flag is dropped.

## ADR reservations

| ID   | WP  | Title                                                  | Status               |
| ---- | --- | ------------------------------------------------------ | -------------------- |
| 0057 | WP2 | Complete task verification rounds after check failures | Accepted, 2026-10-31 |
| 0058 | WP4 | Human plan edits re-checked at the plan gate           | Accepted, 2026-10-31 |
| 0059 | WP7 | Claude default reviewer and reviewer isolation         | Accepted, 2026-10-31 |

IDs checked free on 2026-10-31 in `dev`, `main`, `v3.0.0-branch` and every
local worktree.

## Shared fixtures

- phpcs case (a required lint check with a wrong config flag, plus one more
  required and one supplemental check): planned in WP1; reused by WP2, WP3,
  WP9, WP10 and both gates. Location:
  `packages/orchestrator/test/phpcs-verification-fixture.ts`
  (`phpcsPlanGateFixture` stops at the plan gate, `phpcsVerificationFixture`
  at the verification block; documented and planned argv exported).

## Owner decisions

- 2026-10-30: the three decisions in the brief's "Decisions already made"
  (developer value first; ADR changes welcome; Claude replaces Codex as the
  default reviewer).
- 2026-10-30: the program is tracked in this directory. The brief is stored
  with colleague names replaced by roles and the private research link
  removed.
- 2026-10-31: ADR-0057, ADR-0058 and ADR-0059 accepted in chat with
  `Accept all three`. WP7 owner choices settled by ADR-0059 §5 as written: reviewer
  effort `xhigh`; builders keep `Skill`; auto memory off for review roles in
  every mode and for builders in `scoped` mode. Reciprocal links on pinned
  ADR-0045 and ADR-0055 are admitted by exact allow-list images in
  `phase-resources-build.mjs`.
- 2026-10-31: WP2 plan approved with `Both recommended`, after commit
  `a0041f6`. WP2 implements helper request v4 without instruction text
  changes; WP4's major control revision advertises v4 in agent capabilities
  and publishes it in `policies/artifact-storage.md` and the executing skills.
- 2026-10-31: the release-train version is bumped at the Gate 1 release, not
  per package. Until then `npm run release:validate` reports
  `HOOK_CHANGED_WITHOUT_VERSION_BUMP` for `plugins/banzai/lib` changes (first
  in WP2); that finding alone does not block a package.
- 2026-10-31: WP4 plan approved with `Both recommended`, after commit
  `da624a4`. New runs keep starting at state v10, and a run moves to v11 with
  its first plan re-check record. All seven skills that name the helper request
  move to request v4.
- 2026-11-02: WP5 plan approved with `Q2 with a live probe`, after commit
  `04abf55`. Doctor v6 opens in WP5 and stays open until Gate 1: WP6 extends
  it without another bump. The `paths:` investigation includes one live
  scratch-repository probe.

## Open questions left to the owner by the brief

Settle each in the named WP's ADR or requirements, then record the answer
under Owner decisions.

- WP10: default for the baseline run (proposal: on for short checks, opt-in
  for long suites).
- WP11: add a Continue or Switch pause after workflow selection (a sixth
  decision point)?

## Deviations from the brief

- WP1 (2026-10-31): `retry-eligibility.ts` is at
  `src/workflow/domain/retry-eligibility.ts`. No stable `status --json`
  projection was added; the brief left this to the package, and a documented
  projection is better designed with `banzai control` support in WP9. The
  block reason names checks and outcomes but carries no argv or output. Details
  in the WP1 report.
- WP3 (2026-10-31): `development-plan/SKILL.md` is unchanged; the standalone
  skill reads `policies/plan-task-completion.md` before defining strict tasks,
  so the policy carries the documented-command rule for both paths. The
  planning instruction has no golden digest (`prompts.test.ts` pins output
  contracts and repair bytes); a new test pins the sentence instead. The
  authority is ADR-0049 §2. Details in the WP3 report.
- Stage 1 ADRs (2026-10-31): ADR-0058 also amends ADR-0055 (pinned), because
  the plan gate decisions, CLI grammar and control surface it adds belong to
  ADR-0055. ADR-0059 also amends ADR-0002 narrowly, whose drivers name
  cross-model review independence. ADR-0057 changes no control contract.
