# banzai 2.8–2.9 program tracker

Status: active · Stage 1 in progress · Updated 2026-11-05

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

| WP   | Package                                        | Depends on      | ADR                                             | Work directory                         | Status       | Commit  | Notes                                              |
| ---- | ---------------------------------------------- | --------------- | ----------------------------------------------- | -------------------------------------- | ------------ | ------- | -------------------------------------------------- |
| WP1  | Verification failure details and retry warning | —               | none                                            | `wp01-verification-failure-details`    | committed    | d03bc19 | phpcs fixture built; see report deviations         |
| WP2  | Run every required check in one pass           | —               | 0057 Accepted; amends 0045 (pinned)             | `wp02-full-verification-pass`          | committed    | da624a4 | Full rounds, one retry; helper v4 published by WP4 |
| WP3  | Verification commands at the plan gate         | —               | none; cite 0049 for instruction change          | `wp03-plan-gate-verification-commands` | committed    | 44f3d03 | Plan gate lists checks; see report deviations      |
| WP4  | Re-check human edits at the plan gate          | —               | 0058 Accepted; amends 0051 and 0055 (pinned)    | `wp04-plan-gate-edit-recheck`          | committed    | 04abf55 | Control 9.0.0 with recheck and helper v4           |
| WP5  | Install guide, plugin scope, doctor hint       | —               | none; stay within 0008                          | `wp05-install-guide-plugin-scope`      | committed    | 5c89c1c | Doctor JSON contract version bump                  |
| WP6  | Local model override                           | —               | 0060 Accepted; amends 0008                      | `wp06-local-model-override`            | committed    | e26ea54 | One change set; see report deviations              |
| WP19 | Initiative skill with brief and tracker        | —               | 0061 Accepted; amends 0054 (pinned), 0041, 0036 | `wp19-initiative-skill`                | report ready |         | Outside the brief; template overlaps WP12          |
| WP20 | Memory notes: no gate prompt, no code unlock   | —               | new; authority for the pinned hook change       | `wp20-spec-gate-memory-notes`          | not started  |         | Pinned hook; template shared with WP19, WP12       |
| WP7  | Claude as the default reviewer, with isolation | WP6 recommended | 0059 Accepted; amends 0042 §7, 0037, 0002       | `wp07-claude-default-reviewer`         | ADR accepted |         | live scenario needs go-ahead                       |
| WP8  | Stable Claude phases                           | —               | check 0020                                      | `wp08-stable-claude-phases`            | not started  |         | Live scenario needs go-ahead                       |

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
- [ ] A new initiative started through the WP19 skill keeps its brief,
      tracker and gate reports in `documentation/initiatives/<slug>/`, while
      its packages stay in `documentation/work/<slug>/`.
- [ ] With the 2.8 plugin installed, the hook lets a manual session write a
      Claude Code memory note without a prompt or an approval marker, and the
      next code edit in that session still asks (WP20).

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

| ID   | WP   | Title                                                  | Status               |
| ---- | ---- | ------------------------------------------------------ | -------------------- |
| 0057 | WP2  | Complete task verification rounds after check failures | Accepted, 2026-10-31 |
| 0058 | WP4  | Human plan edits re-checked at the plan gate           | Accepted, 2026-10-31 |
| 0059 | WP7  | Claude default reviewer and reviewer isolation         | Accepted, 2026-10-31 |
| 0060 | WP6  | Local model override                                   | Accepted, 2026-11-04 |
| 0061 | WP19 | Initiative skill and documents                         | Accepted, 2026-11-05 |

IDs checked free on 2026-10-31 (0057–0059), 2026-11-03 (0060) and 2026-11-05
(0061) in `dev`, `main`, `v3.0.0-branch`, every local branch and every local
worktree.

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
- 2026-11-03: this program's brief-and-tracker method becomes a Banzai
  feature, added to Stage 2 as WP19 with `As a Stage 2 WP`. Initiative
  documents live in `documentation/initiatives/<slug>/` (chosen with
  `documentation/initiatives`); packages stay flat in
  `documentation/work/<slug>/`, and this program keeps its current path. A
  nested `work/<initiative>/<wp>/` layout was declined. Proposal: an
  `initiative` skill invoked by name; its design is settled in the WP19 ADR and
  requirements.
- 2026-11-03: WP5 committed as `5c89c1c`. ADR-0060 (local model override) is
  proposed after three adversarial review rounds and awaits owner acceptance
  with four owner choices (§9). WP6 requirements and plan wait for that
  decision.
- 2026-11-04: ADR-0060 accepted with `Accept, all recommended`: a human
  `banzai retry` of a blocked run records a new local layer, the whole role
  triple is the merge unit, "This machine only" is offered first, and the
  local `executable` is bare `claude` or `codex`. The reciprocal link is on
  ADR-0008.
- 2026-11-04: WP6 plan approved with `All recommended`, after commit
  `64763e6`. WP6 is one change set with one report; WP6a and WP6b are working
  milestones only. The Done-when scenario uses `claude` and `codex` PATH shims
  with no live vendor run. No skill changes in WP6. Follow-ups:
  - the WP that next revises
    `skills/orchestrate/references/control-protocol.md` adds a stop-and-relay
    rule for `LOCAL_MODEL_OVERRIDE_CHANGED`;
  - before Gate 1, a quick fix checks the WP5 `claude.plugin-scope` doctor
    message against ADR-0008's privacy rules: it may print an absolute
    settings path and raw keys.
- 2026-11-05: WP6 implemented as one change set; report ready. ADR-0060 and
  the ADR-0008 amendment are marked implemented. `npm run verify` passes;
  `release:validate` reports only the deferred
  `HOOK_CHANGED_WITHOUT_VERSION_BUMP`.
- 2026-11-05: WP6 committed as `e26ea54`. WP19 moves from Stage 2 to Stage 1,
  right after WP6, and is the next package; WP7 and WP8 follow it. WP19 ships
  with 2.8, and its initiative check moves from Gate 2 to Gate 1.
- 2026-11-05: ADR-0061 (initiative skill and documents) is proposed after two
  independent review rounds and awaits owner acceptance with three owner
  choices (section 8). It narrowly amends ADR-0054 and ADR-0041 and adds an
  `initiative` row to the ADR-0036 read matrix. WP19 requirements and plan
  wait for that decision.
- 2026-11-05: ADR-0061 accepted with `Accept, all recommended`: no
  runner-delivered instruction changes (`artifact-storage.md` and
  `feature-status` stay as they are), the brief's SHA-256 in the tracker with
  the re-freeze stop, and explicit invocation only. Reciprocal links are on
  ADR-0054 (admitted by an exact allow-list image in
  `phase-resources-build.mjs`), ADR-0041 and ADR-0036. Before the skill can
  write to this program's tracker, the owner must record a decision that
  freezes the current `brief.md`.
- 2026-11-05: WP19 plan approved with `Both recommended`. Q1 (a): a subagent
  follows the source skill in disposable repositories, with no live vendor
  run; the live Gate 1 check covers host loading. Q2 (a): the checkout-local
  publication hook copy is not changed in WP19. Follow-up: refresh it on the
  owner's request before the first initiative document is pushed.
- 2026-11-05: WP20 (Claude Code memory notes: no spec-gate prompt, no code
  unlock) joins Stage 1 right after WP19, so it ships with 2.8 and has a
  Gate 1 check. It comes from a quick-fix proposal validated that day: the
  hook is a pinned instruction resource, so the change needs a new ADR and an
  instruction-baseline transition. On the owner's instruction the brief
  gains a WP20 row in "Plan at a glance" and a WP20 section in Stage 1; its
  header records the addition, and no other brief text changed.
- 2026-11-05: WP19 implemented as one change set; report ready. ADR-0061 is
  marked implemented except the checkout-local hook reconciliation, which
  stays the Q2 follow-up. Commits are denied in this environment, so the
  scenario left three commit-dependent Acceptance items partial; the live
  Gate 1 check covers them.

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
- Stage 2 (2026-11-03): WP19 is not in the brief; the owner added it. Stage 3
  keeps WP15–WP18.
- Stage 1 (2026-11-05): the owner moved WP19 into Stage 1 after WP6, so 2.8
  ships the initiative skill and Gate 1 checks it. WP12 stays in Stage 2 and
  builds on the AGENTS.md template line that WP19 adds.
