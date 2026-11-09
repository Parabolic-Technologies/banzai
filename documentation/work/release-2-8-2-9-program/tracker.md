# banzai 2.8–2.9 program tracker

Status: active · Stage 1 in progress · Updated 2026-11-06

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
| WP19 | Initiative skill with brief and tracker        | —               | 0061 Accepted; amends 0054 (pinned), 0041, 0036 | `wp19-initiative-skill`                | committed    | 138b206 | Outside the brief; template overlaps WP12          |
| WP20 | Memory notes: no gate prompt, no code unlock   | —               | 0062 accepted; authority for the pinned hook    | `wp20-spec-gate-memory-notes`          | committed    | ebfcd3e | Pinned hook; template shared with WP19, WP12       |
| WP7  | Claude as the default reviewer, with isolation | WP6 recommended | 0059 Accepted; amends 0042 §7, 0037, 0002       | `wp07-claude-default-reviewer`         | committed    | d0785db | Live run at Gate 1 needs go-ahead                  |
| WP8  | Stable Claude phases                           | —               | 0063 Accepted; amends 0020, 0022, 0059          | `wp08-stable-claude-phases`            | committed    | 2cc3954 | Gate 1 probe needs the owner's run                 |
| WP21 | Runner-recorded plan digest, planning retry    | —               | 0064, 0065 Accepted; amend 0051, 0058, 0036     | `wp21-planner-digest-and-retry`        | report ready |         | Outside the brief; owner-run incident              |

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
      next code edit in that session still asks (WP20). Approving one
      scratchpad write leaves only `bookkeeping-<session>` in
      `$TMPDIR/banzai-spec-gate/`, and the next code edit still asks with the
      first-change reason.
- [ ] WP8 probe (ADR-0063 §6), on Claude Code 2.1.290 and on the current
      release: a Banzai implementation phase runs one foreground command
      longer than 10 minutes, whose sentinel exists before the result; no
      background-task event occurs; the phase and a resumed invocation each
      emit exactly one `result` event and exit 0. Run
      `node packages/orchestrator/scripts/gate-1-probe.mjs --repository <scratch>`
      per `documentation/work/wp08-stable-claude-phases/gate-1-probe.md`.
- [ ] WP21, after ADR-0064 and ADR-0065 are accepted: a strict run with the
      default Claude planner and no shell allow rules reaches the plan gate
      with a remainder digest the runner recorded, and a planner-declared
      planning block continues with `banzai retry`.

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
| 0062 | WP20 | Claude Code memory notes in the manual hook gate       | Accepted, 2026-11-05 |
| 0063 | WP8  | Stable headless vendor invocations                     | Accepted, 2026-11-06 |
| 0064 | WP21 | Runner-recorded plan remainder digest                  | Accepted, 2026-11-06 |
| 0065 | WP21 | Continuable planner-declared planning blocks           | Accepted, 2026-11-06 |

IDs checked free on 2026-10-31 (0057–0059), 2026-11-03 (0060) and 2026-11-05
(0061) and 2026-11-06 (0063, 0064–0065) in `dev`, `main`, `v3.0.0-branch`,
every local branch and every local worktree.

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
- 2026-11-05: WP19 committed as `138b206`, with the WP20 brief and tracker
  additions. WP20 starts with `Yes, WP20 next`; ADR ID 0062 is reserved.
- 2026-11-05: ADR-0062 proposed after three review rounds. Option B was
  refined from the brief's project-root line to a closed allow-list of host
  bookkeeping roots with its own marker, because a project-root line fails
  open; the ADR records that variant as rejected. It awaits owner acceptance
  and owner choice 1 (B recommended, or A).
- 2026-11-05: `Ок, приймаю B`. ADR-0062 is accepted with choice 1 B, so
  WP20 covers memory notes and the separate host-bookkeeping approval scope.
- 2026-11-06: `Approve, Q1 (a)`. The WP20 requirements and plan are approved;
  host evidence comes from hook tests, and the WP20 Gate 1 item gains a
  scratchpad step.
- 2026-11-06: WP20 implemented as one change set; report ready. ADR-0062 is
  Implemented, and its hook transition is published. Installed clients receive
  the change with the 2.8 version bump.
- 2026-11-06: WP20 committed as `ebfcd3e`. WP7 starts with `WP7 next`. Its
  requirements and plan are drafted after one independent review round and
  await approval with three owner questions: the review isolation floor
  version (Q1), how doctor enforces it (Q2), and what the live scenario must
  prove about isolation (Q3).
- 2026-11-06: `Approve, all (a)`. The WP7 requirements and plan are approved.
  Q1 (a): the review isolation floor is 2.1.290, after a check of the 2.1.290
  binary that never runs it. Q2 (a): doctor reads the Claude reviewer's
  version from the file system only. Q3 (a): the live scenario requires the
  inventory without `Skill`, both variables in the reviewer's spawn
  environment and both names in the client binary. The host's honouring of
  the variables is not observed live; see Deviations.
- 2026-11-06: WP7 implemented as one change set; report ready. Claude
  `claude-opus-5-5` is the default reviewer, Claude review roles run with
  `Read`, `Glob` and `Grep` only and without auto memory or refusal fallback,
  a Claude reviewer needs Claude Code 2.1.290, and doctor reads that version
  offline. ADR-0059 is Implemented. The Gate 1 live run still needs the
  owner's go-ahead; the 2.8 version bump clears the deferred
  `HOOK_CHANGED_WITHOUT_VERSION_BUMP`.
- 2026-11-06: WP7 committed as `d0785db`. WP8 starts with `WP8 next`.
- 2026-11-06: before drafting WP8, the owner answered four closed questions
  with the recommended options:
  - ambient mode: "New ADR, every mode". The run-stability variables and the
    stdin prompt apply in `scoped` and `ambient` mode, through ADR-0063, which
    narrowly amends ADR-0020, ADR-0022 and ADR-0059;
  - live evidence: "Gate 1 manual probe". `compatibility:live`, its v2
    summary and its two-invocation budget stay unchanged, and a live-suite
    budget decision comes before WP13 and WP14;
  - doctor: "Every Claude role". `claude.version` covers every role on
    Claude;
  - Codex: "Yes, with `-`". The Codex prompt also moves to stdin.

  ADR-0063 is drafted as Proposed. One independent review found that the
  stdin prompt also touches ADR-0022's no-whitelist argv and ADR-0059's
  unchanged Codex review arguments. The draft now amends both. It also
  sharpens the probe: the command runs longer than 10 minutes, so it
  exercises the raised Bash maximum, and a resumed invocation follows. The
  ADR awaits acceptance.

- 2026-11-06: ADR-0063 accepted with `Accept`. Its reciprocal links are
  recorded in ADR-0020, ADR-0022 and ADR-0059, and the manifest lists it as
  Planned. WP8 requirements and plan follow.

- 2026-11-06: WP8 requirements and plan drafted under ADR-0063. An
  independent read-only review found five major and eleven minor issues, all
  addressed. Three owner questions wait at plan approval: Q1 the Bash timeout
  reserve, Q2 settings `env` overrides, Q3 the Gate 1 probe form.

- 2026-11-06: WP8 plan approved with `Approve, all (a)`: Q1 a 5-minute Bash
  reserve with a 2-minute floor, Q2 settings `env` overrides documented only,
  Q3 a maintainer probe script for Gate 1.

- 2026-11-06: WP8 implemented as one change set; report ready. Every Claude
  role needs Claude Code 2.1.290. Every headless model invocation receives
  its prompt on stdin, and every headless Claude invocation runs, in both
  modes, without background tasks, with `BASH_MAX_TIMEOUT_MS` at its timeout
  minus 5 minutes (2-minute floor) and without `BASH_DEFAULT_TIMEOUT_MS`.
  Doctor's `claude.version` covers every Claude role. ADR-0063 is
  Implemented. The Gate 1 probe is built and documented, and awaits the
  owner's run on 2.1.290 and on the current release.

- 2026-11-06: WP8 committed as `2cc3954`.

- 2026-11-06: an owner run in a bootstrap-only project stopped at strict
  planning. The default Claude planner could not compute
  `planRemainderSha256`: under `dontAsk` every hashing command was denied.
  It returned `outcome=blocked`, which left the run cancel-only. With
  `Yes, fix it here`, the owner answered three closed questions with the
  recommended options:
  - digest: "Runner records it". The runner records the remainder digest
    when it accepts a planning result that requests plan approval
    (ADR-0064, amends ADR-0051 and ADR-0058);
  - blocked planning: "Allow retry". `banzai retry` continues a
    planner-declared planning block (ADR-0065, amends ADR-0036);
  - placement: "New WP21 in Stage 1". WP21 ships with 2.8 and has a Gate 1
    item.

  ADR-0064 and ADR-0065 are drafted as Proposed. One independent read-only
  review found three major and six minor issues, all applied: ADR-0058 is
  pinned, so its reciprocal link needs an allow-list image; a block during a
  planning review's `applying` step is covered; ADR-0024's reasons against
  retrying completed blocked results are addressed. Both ADRs await
  acceptance.

- 2026-11-06: ADR-0064 and ADR-0065 accepted with `Accept both`. Their
  reciprocal links are recorded in ADR-0051, ADR-0036 and pinned ADR-0058,
  whose exact before and after images are admitted in
  `phase-resources-build.mjs` keyed by ADR-0064. The manifest lists both as
  Planned. WP21 requirements and plan follow.

- 2026-11-06: WP21 requirements and plan written and awaiting plan approval.
  The plan has no open questions. A plan changed during acceptance fails with
  the existing `PLAN_TASK_COMPLETION_INVALID` code, which already keeps a
  failed planning attempt retryable with session reuse, so no new failure code
  enters persisted state.

- 2026-11-09: `Approve plan`. The WP21 requirements and plan are approved.

- 2026-11-09: WP21 implemented as one change set; report ready. ADR-0064 and
  ADR-0065 are Implemented. The incident run's `banzai retry` stays a Gate 1
  item for the owner.

- 2026-11-09: The owner ran `banzai retry` on the incident run. Retry continued
  planning, and the planner requested plan approval with the zeros in place. The
  runner-control plan check then refused the plan on two false positives that
  the earlier block had hidden. `Yes, fix it here`: both are fixed in
  [`change-report.md`](../wp21-planner-digest-and-retry/change-report.md).

- 2026-11-09: The incident run then produced the WP21 Gate 1 evidence: it reached
  the plan gate with a runner-recorded digest and was approved, and a later
  planner block continued with retry in the resumed session. The Gate 1 item
  stays unticked for the owner. The run's current block is outside WP21: proto
  0.58.2 launches `bin/pnpm.cjs`, which pnpm 12.18.0 no longer ships, and the
  running CLI kept the Node 24 `PATH` it started with.

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
- WP7 (2026-11-06): ADR-0059 Compliance 7 says the live scenario confirms the
  Claude reviewer's isolation. With Q3 (a) it confirms the inventory without
  `Skill`, both variables in the reviewer's spawn environment and both names
  in the client binary. The host reports no auto memory or fallback state and
  a classifier flag cannot be triggered safely, so whether the host honours
  the variables rests on the vendor's documentation and the version floor.
- WP8 (2026-11-06): owner choices before drafting depart from the brief in
  three places:
  - the brief asks for a new live scenario in the suite; the long-command
    evidence is instead a Gate 1 probe run by the owner, because
    `release-policy.json` and ADR-0046 keep `compatibility:live` at two
    invocations under the v2 summary;
  - the brief says doctor checks no versions; WP7 already added the offline
    `claude.version`, and WP8 extends it to every Claude role;
  - the brief leaves Codex to a separate check; Codex `exec` and
    `exec resume` read a `-` prompt from stdin from 0.145.0, so WP8 moves the
    Codex prompt too.
- Stage 1 (2026-11-06): WP21 is not in the brief; the owner added it after
  the planning incident recorded under Owner decisions, because Claude is the
  default planner since ADR-0059.
- WP8 (2026-11-06): under Q1 (a), a timeout below 7 minutes gets the
  2-minute Bash floor instead of the full 5-minute reserve, which departs from
  ADR-0063 Compliance 4. No default role is affected; the live review's
  5-minute bound gets 120,000 ms.
