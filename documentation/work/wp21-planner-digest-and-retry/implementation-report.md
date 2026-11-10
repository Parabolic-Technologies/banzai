# WP21 implementation report

Slug: `wp21-planner-digest-and-retry` · Requirements:
[requirements.md](requirements.md) · Plan: [plan.md](plan.md) · Authority:
[ADR-0064](../../decisions/0064-runner-recorded-plan-remainder-digest.md) and
[ADR-0065](../../decisions/0065-continuable-planner-declared-planning-blocks.md)
(accepted 2026-11-06 with `Accept both`) · Plan approved on 2026-11-09 with
`Approve plan`.

WP21 is one change set. Nothing is staged or committed. No live vendor run
took place, and the incident run's `state.json` was only read.

## What changed

- **Planning instruction** (`prompts.ts`).
  - The hashing sentence is replaced: the planner sets `planRemainderSha256`
    to 64 zeros and does not compute it.
  - A new sentence says a reported block can be continued with `banzai retry`,
    so the summary must name the cause and the exact human action needed.
  - New component `blockedPlanningPromptEnvelope`, headed "Continue blocked
    planning", carries the redacted summary (at most 2,000 characters) as JSON
    diagnostic data. `planningRetryPromptEnvelope` keeps its exact bytes; the
    two share `planningContinuationSession`.
- **Runner-recorded digest** (`workflow/completion/plan-tasks.ts`).
  - In task mode, for a result that requests plan approval,
    `recordPlanRemainderDigest` reads the plan, decodes exact UTF-8, parses the
    task headings, calls the unchanged `rewritePlanRemainderDigest`, checks
    the runner-control rule, records evidence, and writes only when the value
    differs.
  - `establishPlanRemainderDigest` and its `ResultDigestRejectedError` branch
    are gone. No call site rejects a planning result for a remainder mismatch.
  - The non-task branch is unchanged.
- **Shared plan-file helpers** (`workflow/plan-gate/recheck.ts`).
  - `readRecheckBundle`, `exactUtf8` and `replacePlanBytes` take the failure
    to raise. The defaults keep the exact re-check messages, including
    `PLAN_RECHECK_CHANGED`.
  - The `plan-tasks.ts` → `plan-gate/recheck.js` edge is registered under
    ADR-0064, and the no-longer-used `validation.js` permission is removed.
- **Digest evidence v2** (`types.ts`, `validation.ts`, `store.ts`,
  `workflow/digest-evidence/records.ts`,
  `workflow/checkpoints/terminal-checkpoints.ts`,
  `workflow/domain/digest-rejected-recovery.ts`).
  - Comparisons gain `recorded`. The parser reads v1 as `recorded: false` and
    allows `recorded: true` only on a plan attempt's `binding` comparison of
    `planRemainderSha256` with `matched: false` and a non-null `observed`.
  - `rejected` and the recovery count consider only unmatched, unrecorded
    comparisons.
  - `digestRejectionReason` matches a recorded comparison through its
    `observed` value and reports a change after acceptance.
- **Retry eligibility** (`workflow/domain/retry-eligibility.ts`,
  `workflow/domain/failure-classes.ts`, `workflow.ts`).
  - New `needs` step `latest_attempt`, gathered by
    `WorkflowRunner.retryEligibility`.
  - `latestAttemptRecord` picks the latest by `startedAt`, because
    `readRunAttempts` sorts by file name; a tie gives no record.
  - `plannerBlockSummary` reads the block from a completed plan attempt. The
    run is eligible when that summary equals `state.blockReason`.
- **Continuation** (`workflow.ts`).
  - `retry()` has a new branch for a planner block: base-commit validation,
    source lookup, transition to `planning`, the `attempt.retry_requested`
    event, then `executePlan` with that source.
  - `executePlan` treats the source as a supported failure and chooses the
    blocked envelope.
  - `captureStoppedPlanningWorkspace` is extracted from the catch path and
    also runs for a blocked result, so a later retry can reuse the session.
- **Surfaces** (`interactive.ts`). The label "Continue planning after the
  reported block" and its confirmation apply when there is no active attempt.
  `cli.ts` already prints "Next: resolve the external failure, then run
  `banzai retry`." at line 734 and is unchanged. Agent control derives `retry`
  with no source change.
- **Documentation and facts.** `documentation/orchestrator.md`,
  `packages/orchestrator/MODULES.md`, `PROJECT_MANIFEST.md` §6 and its ADR
  rows, the decision index, and the ADR lifecycle lines.

## Requirement trace

| Requirement         | Evidence                                                                                                                                                                                  |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1 · Instruction    | `prompts.ts`; `plan-gate-verification.test.ts`: "the planning instruction leaves the remainder digest to the runner", "the planning instruction says a reported block can be continued".  |
| R2 · Recorded       | `plan-tasks.ts`; `workflow/completion/plan-tasks.test.ts` (recording, no write when correct, refusal table, concurrent change); `workflow-recovery.test.ts` ("the runner records…zeros"). |
| R3 · Evidence v2    | `validation.ts`, `records.ts`, `store.ts`; `result-digest.test.ts` (v2 and v1 readers, refusals, store guard, later mismatch).                                                            |
| R4 · Reconciliation | `workflow-recovery.test.ts`: the three "reconciling…" tests.                                                                                                                              |
| R5 · Gate entry     | `plan-recheck.test.ts`: the three runner-recorded tests.                                                                                                                                  |
| R6 · Eligibility    | `retry-eligibility.ts`; `workflow/domain/retry-eligibility.test.ts`; `planning-review-workflow.test.ts` ("a run shaped like the 2026-11-06 incident can continue planning").              |
| R7 · Continuation   | `workflow-recovery.test.ts` (retry, fresh session, ADR decisions, failed preflight); `planning-review-workflow.test.ts` ("a blocked applying result continues the applying step").        |
| R8 · Surfaces       | `interactive.test.ts` (two menu tests); `workflow-recovery.test.ts` (`nextAction`, `projectAgentControlStatus`).                                                                          |
| R9 · Unchanged      | `result-digest.test.ts` (fabricated source digest still rejected; historical plan rejection still repaired); retry-eligibility refusals; the existing suites pass.                        |
| R10 · Documentation | The files above; `release-validation.test.ts`; review of the diff.                                                                                                                        |

## ADR conformance

- **ADR-0064 §1** (planner writes zeros): R1 sentences, pinned by tests.
- **ADR-0064 §2** (runner records before the attempt completes, evidence
  before write, compare-and-replace, reconciliation): `recordPlanRemainderDigest`
  runs inside `validatePlanningResult`, which runs before `completeAttempt`,
  live and on reconciliation. First-write-wins plus the matched second pass make
  it idempotent.
- **ADR-0064 amendments to ADR-0051 and ADR-0058**: descriptor source roles and
  consumption checks still reject; approval still never rewrites a digest and
  names the re-check. The gate-entry snapshot holds the recorded bytes because
  `retainPlanGateEntry` already runs after acceptance.
- **ADR-0065 §1–§3**: the rule stays pure in the domain module; continuation
  reuses `executePlan`; the applying step stays an open episode and keeps its
  application prompt; surfaces match the ADR's copy.
- **ADR-0065 amendment to ADR-0036**: the layout stop still uses
  `gate=escalation`; only a completed `outcome=blocked` plan attempt qualifies.

## Tests

### T1 · Fail-first

The final test files ran against an export of `2cc3954`, the unchanged source.
32 tests failed, and the eligibility suite could not run because
`latestAttemptRecord` did not exist there.

| File                                        | Failed / passed | Tests that failed first                                                                                                                                                                                  |
| ------------------------------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `workflow/completion/plan-tasks.test.ts`    | 9 / 8           | Recording before writing; a correct digest causes no write; concurrent change; six refusals (check overriding a fresh commitment, missing, not a regular file, not UTF-8, symlink, runner-control task). |
| `result-digest.test.ts`                     | 6 / 38          | Fabricated source digest wording; later mismatch of a recorded remainder; fabricated remainder recorded; v1 and v2 readers; store v2 guard.                                                              |
| `plan-recheck.test.ts`                      | 3 / 25          | The three runner-recorded tests.                                                                                                                                                                         |
| `workflow/domain/retry-eligibility.test.ts` | did not run     | Missing export.                                                                                                                                                                                          |
| `interactive.test.ts`                       | 1 / 115         | "interactive mode continues planning after a block the planner reported".                                                                                                                                |
| `plan-gate-verification.test.ts`            | 2 / 2           | The two instruction sentences.                                                                                                                                                                           |
| `workflow-recovery.test.ts`                 | 9 / 54          | Failed preflight leaves the block; plan changed during acceptance; fresh session after a workspace change; ADR decisions kept; three reconciliation tests; retry after a block; zeros recorded.          |
| `planning-review-workflow.test.ts`          | 2 / 37          | "a blocked applying result continues the applying step on retry"; the incident-shaped run, which failed with the incident's own message, "This blocked state is not tied to a failed attempt."           |

Notes on this table:

- Three more tests failed in the export for an unrelated reason and are not
  counted: two in `plan-gate-verification.test.ts` and one in
  `plan-recheck.test.ts` run the CLI, and the export has no `dist/banzai.mjs`.
  All three pass in the checkout.
- A first fail-first run, on earlier test bytes, reported 37 failures. Some of
  those came from fixture mistakes, such as reading `source.result` on an
  attempt that only had a terminal checkpoint. The tests were corrected, so this
  table replaces that run.
- New tests that pass on both are guards, not proof of the change:
  - "a block the planner did not report is not continued";
  - "interactive mode keeps the failed planning copy for a failed attempt";
  - "a run without task verification keeps its plan bytes and records no digest";
  - "a plan digest rejected before ADR-0064 is still repaired through an
    authorized planning attempt";
  - the refusal of a task heading outside the grammar;
  - the v1 and v2 refusal rows that the old parser also refused.
- The rule itself has its failing-first evidence at workflow level, through the
  retry tests above. The pure-rule tests have passing evidence only.

### Changed tests

- `result-digest.test.ts`: tests of the plan digest-rejected route now build a
  historical v1 rejection through `recreatePlanDigestRejection`, because a live
  run can no longer reach that source for a plan.
- `planning-review-workflow.test.ts`: the test that expected a blocked applying
  result to stay refused now expects it to continue. ADR-0065 §2 decides that.
- `retry-eligibility.test.ts`: planning rows with no active attempt supply
  `latestAttempt`, because the rule now asks for it.

## Checks

All on 2026-11-09. The focused rows describe the WP21 change set. The `verify`
and candidate rows were rerun after the first follow-up fix in
[change-report.md](change-report.md), so they describe the tree committed for WP21.
Later changes and their checks are in that report.

| Check                                                                                             | Result                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run build`, then `npm run build:check`                                                       | Pass, with no change under `plugins/`.                                                                                                                                                                                                                   |
| `npm run typecheck`                                                                               | Pass.                                                                                                                                                                                                                                                    |
| `npm run format:check`                                                                            | Pass.                                                                                                                                                                                                                                                    |
| `npx prettier --check` on the manifest, the tracker, the changed documentation and this directory | Pass. `documentation/decisions/README.md` and the ADRs were not formatted.                                                                                                                                                                               |
| Lint                                                                                              | 0 errors and 427 warnings, none on a changed line. The first candidate check stopped at 13 errors in new test passages; they were fixed.                                                                                                                 |
| Focused suites                                                                                    | All pass. These tests needed fixes after the first run: the reconciliation fixture, the event field name in one retry test, two eligibility table rows and the incident test's setup.                                                                    |
| `release-validation.test.ts`                                                                      | 209 of 209.                                                                                                                                                                                                                                              |
| `npm run release:validate`                                                                        | Stops only at the deferred `HOOK_CHANGED_WITHOUT_VERSION_BUMP` (`hooks.json`, `spec-gate.cjs` and `plugins/banzai/lib` from earlier packages), as planned. WP21 changes nothing under `plugins/`.                                                        |
| `npm run verify`                                                                                  | Pass inside the candidate check: 2153 of 2153 tests, lint 0 errors, including the two follow-up tests. It was not run a second time on its own.                                                                                                          |
| `node packages/orchestrator/scripts/release-candidate-check.mjs`                                  | Pass on the rerun: verify, format, release validation, publication (637 files, clean) and committed smoke. `node_modules/.bin/banzai` and the dangling `node_modules/node_modules` link were set aside for each run and restored to their exact targets. |
| Live vendor run                                                                                   | Not run. The incident run's `banzai retry` needs the owner's go-ahead.                                                                                                                                                                                   |

## Structural assessment

- Trigger: a new dependency across subsystem boundaries (`completion/plan-tasks`
  → `plan-gate/recheck`) and a changed persisted evidence contract.
- Container: `workflow/completion/plan-tasks.ts`, which already owns planning
  result acceptance, live and on reconciliation.
- Reuse search: `rewritePlanRemainderDigest` (plugin library) already holds the
  digest and inventory rules. `readRecheckBundle`, `exactUtf8` and
  `replacePlanBytes` already hold the file refusal and compare-and-replace.
  `completion/inputs.ts` and `plan-task-completion.ts` read files but have no
  compare-and-replace write. Nothing else fits.
- Owner and dependency direction: acceptance depends on the plan-gate helpers;
  the re-check does not depend on acceptance. Failures are injected, so each
  caller keeps its own message and code. Evidence writing stays in
  `digest-evidence/records.ts`.
- Disposition: `reused`. The helpers stay in `plan-gate/recheck.ts`. Moving them
  to a new module would add a third owner for a plan-file rule that has two
  callers and one lifecycle.
- Invariants:
  - one implementation of the digest rule and one of the compare-and-replace
    write;
  - evidence is durable before the plan write;
  - only the 64-character value changes;
  - the re-check's messages are unchanged.
- Verification: `plan-tasks.test.ts`, `plan-recheck.test.ts`,
  `import-boundaries.test.ts`.
- Remaining debt: none added. `workflow.ts` keeps its known size, with one new
  `retry()` branch that follows its neighbours.
- Authority: within scope; the edge is registered under ADR-0064.

## Deviations from the plan

1. **Test placement.** Acceptance tests live in
   `test/workflow/completion/plan-tasks.test.ts` and
   `workflow-recovery.test.ts`, not `plan-gate-verification.test.ts` or
   `workflow.test.ts`. R6 tests live in
   `test/workflow/domain/retry-eligibility.test.ts`, because
   `workflow-eligibility.test.ts` does not exercise the pure rule directly. The
   R1 sentences are pinned in `plan-gate-verification.test.ts`, beside the WP3
   sentence tests. Agent control's derived `retry` is asserted through
   `projectAgentControlStatus` in `workflow-recovery.test.ts`.
2. **Concurrent change.** The helper has no injectable read, so the test changes
   the plan through the `establishResultDigestEvidence` seam, between the read
   and the write.
3. **Added: store guard.** `establishResultDigestEvidence` refuses new v1
   evidence with `RESULT_DIGEST_EVIDENCE_INVALID`, so R3's "new records use v2"
   is enforced, not assumed.
4. **Added: workspace capture on blocked results.** The plan did not list it.
   Without it, a completed attempt has no `workspaceDigest` and R7's session
   reuse can never apply.
5. **Eligibility also excludes `awaiting_triage`.** The rule accepts a null or
   `applying` active episode, which is narrower than R6's wording and matches
   ADR-0055's dispatch.
6. **Lint fixes after the first candidate check.** It stopped at 13
   `no-unnecessary-condition` errors in three new test passages. They were fixed
   by removing the optional chains, and the check was rerun.

## Notes for assurance

- The R3 clause of `digestRejectionReason` has unit-level evidence only. Live
  callers pass the implementation attempt as `sourceAttemptId`, and
  `validateApproval` catches a post-approval plan change first, so no workflow
  scenario reaches it today.
- The incident run will continue in a fresh session: its completed plan attempts
  have `workspaceDigest: null` because they predate the new capture. Its state
  was read only: schema 10, blocked from planning, closed reviews `['applied']`,
  and `summary == blockReason`.
- `readRunAttempts` sorts by file name, and the incident proves why "latest" uses
  `startedAt`: `plan-1-caf41b68` (15:25:07, blocked) sorts before
  `plan-1-cb7aaafe` (15:24:01).

## Follow-ups

- Gate 1 item, Acceptance 16: the incident run in `demio-ai-automations-api`
  must reach the plan gate through `banzai retry`. The owner's first retry on
  2026-11-09 continued planning, with `planningContext.retryOf` naming the
  blocked attempt and the planner requesting approval with the zeros in place.
  The runner-control plan check then refused the plan on two false positives,
  now fixed in [change-report.md](change-report.md). The second retry reached the
  plan gate with evidence v2 and a recorded digest, and the owner approved it. A
  later planner block continued in the resumed session. The owner closes Gate 1.

## Plan Task Completion

Format: `banzai-plan-task-completion/v1`

| Task | Status    | Evidence                                                                                                                                                                                                                                                                                                                                                                                                              | Gap or deviation |
| ---- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| T1   | completed | [{"path":"documentation/work/wp21-planner-digest-and-retry/implementation-report.md","detail":"T1 fail-first table: 32 failures across seven suites, one suite not runnable."}]                                                                                                                                                                                                                                       | null             |
| T2   | completed | [{"path":"packages/orchestrator/src/workflow/plan-gate/recheck.ts","detail":"Helpers take the failure to raise; re-check messages unchanged."},{"path":"packages/orchestrator/import-boundaries.mjs","detail":"plan-tasks to plan-gate/recheck edge under ADR-0064."}]                                                                                                                                                | null             |
| T3   | completed | [{"path":"packages/orchestrator/src/types.ts","detail":"Evidence v2 and legacy v1 schema constants; recorded field."},{"path":"packages/orchestrator/src/validation.ts","detail":"Parser for v1 and v2 with the recorded rule."},{"path":"packages/orchestrator/src/workflow/digest-evidence/records.ts","detail":"rejected ignores recorded comparisons; digestRejectionReason reports a change after acceptance."}] | null             |
| T4   | completed | [{"path":"packages/orchestrator/src/workflow/completion/plan-tasks.ts","detail":"recordPlanRemainderDigest replaces establishPlanRemainderDigest."},{"path":"packages/orchestrator/test/workflow/completion/plan-tasks.test.ts","detail":"Recording, refusal and concurrent-change tests."}]                                                                                                                          | null             |
| T5   | completed | [{"path":"packages/orchestrator/src/prompts.ts","detail":"Two instruction sentences and blockedPlanningPromptEnvelope."},{"path":"packages/orchestrator/test/plan-gate-verification.test.ts","detail":"Both sentences pinned; the hashing sentence absent."}]                                                                                                                                                         | null             |
| T6   | completed | [{"path":"packages/orchestrator/src/workflow/domain/retry-eligibility.ts","detail":"latest_attempt step, latestAttemptRecord and the planner-block rule."},{"path":"packages/orchestrator/src/workflow/domain/failure-classes.ts","detail":"plannerBlockSummary."},{"path":"packages/orchestrator/test/workflow/domain/retry-eligibility.test.ts","detail":"Rule, exclusions and latest-record tests."}]              | null             |
| T7   | completed | [{"path":"packages/orchestrator/src/workflow.ts","detail":"retry branch, executePlan continuity and captureStoppedPlanningWorkspace."},{"path":"packages/orchestrator/test/workflow-recovery.test.ts","detail":"Retry, session, event and preflight tests."},{"path":"packages/orchestrator/test/planning-review-workflow.test.ts","detail":"Applying step and incident-shaped run."}]                                | null             |
| T8   | completed | [{"path":"packages/orchestrator/src/interactive.ts","detail":"Label and confirmation for the reported block."},{"path":"packages/orchestrator/test/interactive.test.ts","detail":"Two menu tests."}]                                                                                                                                                                                                                  | null             |
| T9   | completed | [{"path":"documentation/orchestrator.md","detail":"Runner-recorded digest and planning continuation."},{"path":"packages/orchestrator/MODULES.md","detail":"Plan-tasks, plan-gate helpers, digest evidence v2, retry eligibility."},{"path":"PROJECT_MANIFEST.md","detail":"Section 6 facts and ADR rows."}]                                                                                                          | null             |
| T10  | completed | [{"path":"documentation/decisions/0064-runner-recorded-plan-remainder-digest.md","detail":"Implementation state Implemented."},{"path":"documentation/decisions/0065-continuable-planner-declared-planning-blocks.md","detail":"Implementation state Implemented."},{"path":"documentation/work/release-2-8-2-9-program/tracker.md","detail":"WP21 row report ready; approval and close-out entries."}]               | null             |
