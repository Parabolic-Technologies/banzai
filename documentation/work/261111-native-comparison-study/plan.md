# Banzai versus native Claude Code: replay comparison plan

Status: frozen 2026-11-11 · shake-down done · Part A authorized 2026-11-12

No run is authorized by this document. Model execution starts only when the
owner authorizes live runs, the one choice still open in
[Owner decisions](#owner-decisions).

## Question

For which task classes does Banzai produce a better accepted change, or the
same change for less human attention, than Claude Code used directly on the
same model?

The answer decides where further work goes: the orchestrator, the plugin
skills, or neither.

## Relation to existing methods

- [effectiveness-study.md](../../evaluation/effectiveness-study.md) is the
  method for a prospective pilot on 24 real tasks. It forbids synthetic work
  and replays, and names a replay as "a separate approved, isolated
  experiment". This plan is that experiment. It does not replace the pilot.
- Routine manual time entry was rejected on 2026-09-06
  ([task-worksheet.md](../../evaluation/task-worksheet.md)). This plan keeps no
  manual time log.
- The review probe in Part B follows the trial and scoring rules of the
  [reviewer comparison protocol](../../evaluation/reviewer-calibration/comparison-protocol.md).
- This is not a package of the
  [2.8–2.9 program](../release-2-8-2-9-program/tracker.md). Whether it runs
  before Stage 3 is an owner decision.

## Design

Each task is replayed from a fixed baseline commit under three arms, with the
same model, effort, Claude Code version and repository rules.

| Arm | Name         | Procedure                                                                                                                          |
| --- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| A   | Native       | Claude Code without the Banzai plugin: plan mode, plan approval, implementation, `/code-review high` in a fresh session, triage, fixes |
| B   | Orchestrator | `banzai` CLI with ordinary routing and its existing gates; the plugin at local scope                                               |
| C   | Plugin only  | Standalone skills: `feature` or `quick-fix` for small and medium tasks, the strict skill sequence for large ones, then `/banzai:feature-review` in a fresh session, triage, fixes; no CLI |

Arm C separates the value of the instructions from the value of the runner.
Without it a difference between A and B cannot be attributed.

In this repository the root `AGENTS.md` already asks for requirements, a plan
and a report per change. Arm A keeps that rule, so here the contrast is the
narrower one the effectiveness study names: orchestration against manual
execution of the same policy.

### Part A: full task replay

- Six tasks, three arms, two trials each: 36 runs.
- A shake-down comes first: T7 in each arm, and T1 in arm B at least. Its
  runs fix the procedure and are excluded from the results.
- Run order is shuffled with a recorded seed before the first run.
- Every run is kept. A failed, blocked or cancelled run is a result and is
  never rerun. One exception is fixed in advance: a run that a subscription
  limit stops before its first model output is restarted once.

### Part B: review probe

- Three reference diffs from corpus tasks (T2, T4 and T5), each with three
  seeded defects that violate a frozen acceptance criterion.
- Two reviewers: `/code-review high` and the `feature-review` skill, each in a
  fresh session that may read the diff through read-only git. The native
  reviewer has no write tools. The skill keeps them, because it writes its
  review document; a check after the session shows that nothing else changed.
- Three trials per diff per reviewer: 18 review runs.
- Score: seeded defects detected, unsupported findings and duplicates, as the
  comparison protocol defines them.

### Weaker-model segment

Approved on 2026-11-11. T4 and T8, both medium and one per repository, are
repeated in all arms on `claude-sonnet-5-5` at effort `high`, one trial each:
6 runs. Only the model differs from the main segment. It tests whether the
scaffolding helps a weaker model more than a stronger one. Results are
reported apart and never pooled with the main segment. The segment has its
own shuffled order and runs as a block after the main one.

## Task corpus

Candidates come from this repository's history, which postdates the model's
training data. The task statement is the frozen
[brief](../release-2-8-2-9-program/brief.md) section; the baseline is the
parent of the commit that delivered the work.

| ID  | Source                               | Baseline     | Class  | Part A  | Notes                                |
| --- | ------------------------------------ | ------------ | ------ | ------- | ------------------------------------ |
| T1  | Live harness Codex fixture quick-fix | `fa79c8b`    | small  | yes     | Statement gives the symptoms only    |
| T2  | WP3 plan-gate verification commands  | `d03bc19`    | medium | reserve | Includes an instruction transition   |
| T3  | WP5 install guide and doctor hint    | `04abf55`    | medium | reserve | Mostly documentation                 |
| T4  | WP1 verification failure details     | `0724b6a`    | medium | yes     | phpcs fixture is part of the result  |
| T5  | WP2 full verification pass           | `a0041f6`    | large  | yes     | ADR-0057 is accepted at the baseline |
| T6  | WP4 plan-gate edit re-check          | `da624a4`    | large  | yes     | ADR-0058 is accepted at the baseline |
| T7  | Health response SHA-1 checksum       | owner commit | small  | yes     | `banzai-demo`; real earlier task     |
| T8  | In-memory notes API                  | owner commit | medium | yes     | `banzai-demo`; written for the study |

Six of the eight enter Part A: two per class. The owner confirmed the set in
the table on 2026-11-11.

WP6 and WP14 left the candidate list when their baselines were checked. The
WP6 baseline already holds that package's requirements and plan, and its
change is 12,906 lines. The WP14 commit also carries a version bump and
maintainer skills, and the owner decisions that shaped it are absent from its
baseline.

`banzai-demo` has two baseline branches, committed on 2026-11-11:
`study-banzai` (`4b5880a`), adopted with the 2.8.3 template, and
`study-native` (`ef03b2d`), the same source without Banzai files and with a
`CLAUDE.md` written from the code.

Each task gets a private card, written before any run:

- the statement, exactly as every arm receives it;
- the baseline commit and the repository rules that apply;
- the acceptance rubric: one pass/fail line per "Done when" item, plus the
  behaviours the delivered work has and the statement implies;
- the decision sheet: the operator's fixed answers to foreseeable questions,
  the plan-approval rule and the triage rule.

Both stacks in the table are TypeScript. A second stack needs a project the
owner supplies; without one the conclusions cover TypeScript only.

## Operator protocol

The operator knows the delivered solutions, so the operator's freedom is
removed rather than measured.

- Answer questions only from the decision sheet. A question the sheet does
  not cover gets "Use your judgement and state the assumption".
- Read every plan in full, in every arm. Approve it unless it contradicts a
  rubric line; then request rework once, quoting that line and nothing else.
  In arm C the gate can arrive as a permission prompt from the plugin's hook
  before the first source write: read the work document first.
- Triage: accept a finding that cites a rubric line or shows a concrete
  defect; reject style, preference and process-record findings. The rule is
  the same in every arm. When every finding is rejected, end the review
  session without a reply.
- Arms A and C run in `auto` permission mode, and the operator picks `auto`
  when approving arm A's plan. A permission prompt that still appears is
  allowed for a documented repository script or a read, and denied otherwise.
- Give no hints, corrections or file pointers beyond the statement.
- Respond as soon as a run waits, and do nothing else while it waits.

## Measures

| Measure            | Source                                                                                     | Notes                                                                      |
| ------------------ | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| Acceptance score   | Blind rubric assessment of the final diff: lines passed / lines total                      | Primary                                                                    |
| Material defects   | Blind assessment; defects deduplicated by criterion, locus and root cause                  | Primary; scope violations counted apart                                    |
| Lost runs          | Run ended blocked, cancelled or needing manual repair to reach a usable result             | Primary; its cost stays in every total                                     |
| Human interventions | Count of decisions, answers and rescues the run required                                  | Primary attention measure                                                  |
| Response time      | Arm B: gate elapsed time (ADR-0034). Arms A and C: time from a plan or prompt shown to its answer, and the transcript gap from a stop to a typed reply | A proxy under the operator protocol, not measured active time              |
| Reading load       | Words in every plan, question and findings list the operator had to decide on              | Explains response time                                                     |
| Repository checks  | Exit status of `npm run verify` on the final tree                                          | Objective guard                                                            |
| Cost               | Wall-clock time, model turns, input, cached and output tokens, subagents included          | Explanatory; subscription usage is not a dollar cost                       |
| Review yield       | Findings raised, accepted and rejected per review                                          | Explanatory                                                                |

Blind assessment:

- Export each final tree as a diff against its baseline plus the untracked
  files. Remove `documentation/work/**`, `.banzai/**` and review artifacts,
  which reveal the arm. Where the baseline differs by arm (T7, T8), also
  remove the root instruction files and the baseline commit. Label exports
  with random IDs.
- A fresh Claude session with no access to the runs scores every export
  against the rubric. The model is `claude-opus-5-5`, which runs in no arm
  and no segment, so the assessor never scores its own model's work.
- The owner adjudicates every claimed material defect and every rubric line on
  which two trials of one arm disagree.
- Arm labels are revealed only after all scores are frozen.

## Isolation

- One fresh directory per run, outside this repository. The baseline arrives
  as a shallow fetch of the single baseline commit, so the delivered solution
  is not in the object store and no commit is needed to prepare a run.
- Separate clones, not Git worktrees.
- Run directories are outside the operator's home directory. Claude Code
  reads instruction files from every parent directory of the working
  directory, so a run below the home directory loads the operator's own.
  Sessions are also denied reading those files.
- Arm A runs without user-scope plugins and without auto memory. Arms B and C
  load the plugin at local scope. A preflight step records the Claude Code
  version, the loaded plugins and skills, the model and the effort; a run
  whose preflight differs from the frozen configuration does not start.
- Tools are the same in every arm. The runner admits one MCP server, Serena,
  with read-only tools; arms A and C get the same server and tools, and no
  session has the Claude in Chrome tools.
- No permission rule is added to a baseline. The runner's phases have a shell
  only where the repository's own rules grant one, which is how the product
  runs today; arms A and C have one through `auto` mode.
- One Claude Code version for the whole batch. A forced update opens a new
  segment.
- Task cards, seeded cases and answer keys are in the Git-ignored
  `.banzai/study/261111-native-comparison-study/`. A run directory is a
  shallow fetch of a tracked commit, so nothing from there can reach a run.
- Raw transcripts and exports stay in a private directory outside both
  repositories. Only the summary report enters Git.
- Arm B needs `banzai init` in each run directory, because a fresh fetch has
  no `.banzai/config.json`.

## Shake-down record

Run on 2026-11-11: T7 in arm A (three times, the first cancelled), arm B and
arm C (twice), and T1 in arm B. None of these runs enters the results. They
changed the procedure, not the thresholds:

- run directories moved out of the home directory, after the first session
  loaded the operator's own instructions;
- the reviewer may read the diff, after `/code-review` without a shell
  reviewed file contents only;
- subagent usage is counted, after a review session turned out to spend
  nine tenths of its tokens there;
- arm C ends with `/banzai:feature-review`, as arm A ends with
  `/code-review high`; without it arm C did less work than arm A;
- Serena and Chrome tools were levelled across the arms;
- the export hides the instruction files and the baseline commit where the
  baseline differs by arm;
- the operator rules above gained the plan-reading, hook-prompt, triage and
  permission-mode lines.

Differences the shake-down found and the study keeps, because they are the
arms themselves:

- Arm A always has a plan gate and a review. Arm B has them on the strict
  route only: its `quick-fix` route ran T1 with no gate and no review.
- In arm C the session twice treated the request as the approval of a named
  escalation trigger. The plugin's hook, not the model, produced the one stop.
- On the `banzai` baselines the runner's implementation phase has no shell
  and writes a change without running a test; the runner verifies it after.

## Decision rules

Frozen before the shake-down. Results are read per task class, never pooled
across classes.

| Outcome for a class       | Condition                                                                                                                                                             | Consequence                                                               |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Orchestrator justified    | B beats both A and C on both tasks of the class: acceptance score higher by 10 points or fewer material defects, no more lost runs, at most 1.5 times A's interventions | Orchestrator work continues for that class                                |
| Plugin sufficient         | C is within 10 points of B and within one material defect, with no more lost runs                                                                                     | Freeze orchestrator features for that class; invest in skills and the hook |
| Native sufficient         | A is within the same margins of both B and C                                                                                                                          | Banzai's case for that class is audit and governance; the owner decides   |
| Inconclusive              | The spread between two trials of one arm exceeds the difference between arms, or any primary measure is missing                                                       | Preregister a second batch; thresholds do not change                      |

A confirmed scope or authorization violation in an arm blocks any conclusion
in that arm's favour for the class.

## Limits

- Twelve runs per arm show a direction. They support no statistical claim.
- One operator, one stack and one vendor. Conclusions do not extend past them.
- The assessor is a Claude model too. A blind spot the vendor's models share
  can pass unscored in every arm alike; the owner's adjudication of every
  material-defect claim is the only check on it.
- Six of the eight candidates come from Banzai's own repository, whose rules
  already resemble Banzai's process. That favours no arm by design, but it
  narrows the contrast as described under [Design](#design).
- Response time under a scripted operator understates real deliberation. The
  intervention count and the reading load are the sturdier attention measures.
- A replay cannot observe defects that surface weeks after acceptance. The
  prospective pilot remains the method for that.

## Steps

1. The owner settles the [Owner decisions](#owner-decisions). This plan is
   updated once and its SHA-256 recorded. Done on 2026-11-11 for decisions
   1–4: the harness recorded the tool identity and the shuffled order of all
   42 runs with seed 3795643388, and this file's SHA-256 is kept with them.
2. Write the eight task cards and choose six. Build the three seeded diffs.
   Done on 2026-11-11; the owner confirmed the set and the T8 statement the
   same day.
3. Write the run harness as a scratch script outside the product: prepare a
   run directory, run the preflight, capture the export, timestamps and usage.
   Done on 2026-11-11 and dry-run without a model call. It lives beside the
   cards. The owner decided the same day to pin the tools: the study runs
   Banzai 2.8.3 from a separate clone at `fa89da9`, so product work in this
   repository does not disturb the batch.
4. Run the shake-down. Correct the procedure, not the thresholds, and record
   the plan's new SHA-256. The shake-down uses T7 in every arm and T1 in
   arm B at least, under run keys of their own, so both repositories and the
   runner on its own source are exercised before a counted run. Done on
   2026-11-11; see the shake-down record.
5. Run Part A in the shuffled order.
6. Run Part B, then the weaker-model segment.
7. Blind assessment and owner adjudication.
8. Write `report.md` here: results per class, coverage gaps, the outcome each
   class reached and the open questions. The owner decides what changes in the
   program.

Rough effort, not a commitment: two days for steps 2–4, four to six days of
mostly passive operator time for step 5, one day for step 6 and two days for
steps 7–8.

## Owner decisions

1. Model and effort for the main segment. Decided on 2026-11-11:
   `claude-fable-5-2` at effort `high`, identical in every arm and every
   Banzai role. Banzai's own default is `claude-opus-5-5` at `xhigh`, so arm B
   is not measured in its default configuration.
2. Whether the weaker-model segment runs. Decided on 2026-11-11: it runs, on
   T4 and T8.
3. The Part A set, the T8 statement, and the two `banzai-demo` baseline
   commits. Decided on 2026-11-11: the set is T1, T4, T5, T6, T7 and T8, the
   T8 statement stands as written, and the baselines are `study-banzai`
   (`4b5880a`) and `study-native` (`ef03b2d`).
4. Whether another vendor's model may serve as the blind assessor. Decided
   on 2026-11-11: no, the assessor is a Claude model. Decided on 2026-11-12:
   `claude-opus-5-5`.
5. Authorization of live model runs for steps 4–6. The owner ran step 4 on
   2026-11-11. Decided on 2026-11-12: Part A (step 5) is authorized. Step 6,
   Part B and the weaker-model segment, needs a separate go-ahead.
6. Whether the study runs before Stage 3 of the 2.8–2.9 program, and how the
   tracker records it. Decided on 2026-11-12: Part A runs now, and the tracker
   question is settled together with the report.
