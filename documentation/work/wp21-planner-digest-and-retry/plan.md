# WP21 plan

Status: approved with `Approve plan` on 2026-11-09 · Requirements:
[requirements.md](requirements.md) · Authority:
[ADR-0064](../../decisions/0064-runner-recorded-plan-remainder-digest.md),
[ADR-0065](../../decisions/0065-continuable-planner-declared-planning-blocks.md)

WP21 is one change set with one report,
`documentation/work/wp21-planner-digest-and-retry/implementation-report.md`.
The owner commits by hand. At `2cc3954` (WP8), the working tree holds only
the ADR-0064/0065 lifecycle edits, the pinned ADR-0058 allow-list image and
its test, the tracker, and these documents.

## Approach

Each change stays with the owner that already holds the concern:

- **Plan acceptance.** `validatePlanningResult` in
  `workflow/completion/plan-tasks.ts` already runs before a planning attempt
  completes, both live and on terminal-checkpoint reconciliation. It
  becomes the one place where the runner records the remainder digest. It
  reuses `rewritePlanRemainderDigest` from the plugin library, which is
  unchanged, and the re-check's file refusal, exact UTF-8 decoding and
  compare-and-replace write.
- **Shared plan-file helpers.** The helpers in `workflow/plan-gate/recheck.ts`
  take a caller-supplied failure, so the re-check keeps its exact messages
  and acceptance gets its own. A new import edge from `plan-tasks.ts` is
  registered in `import-boundaries.mjs` under ADR-0064.
- **Digest evidence.** `banzai-result-digest-evidence/v2` adds `recorded` to
  each comparison. The writer, the parser in `validation.ts`, the recorder in
  `workflow/digest-evidence/records.ts` and `digestRejectionReason` change
  together. v1 stays a reader surface.
- **Retry eligibility.** The pure rule in
  `workflow/domain/retry-eligibility.ts` gains one source and one `needs`
  evidence step for the latest attempt record. `WorkflowRunner` gathers it.
- **Continuation.** `retry()` routes the new source into the existing
  planning retry path (`executePlan` with a retry source). That path already
  handles session continuity, `planningContext.retryOf`, the episode's
  `applying` step and the retry prompt. A new prompt component, "Continue
  blocked planning", replaces "Continue failed planning" for this source.

Tests come first and run against today's code. The validation change
regenerates nothing in the plugin library unless the artifact-reader bundle
reaches the evidence parser. If it does, `release:validate` reports the
deferred `HOOK_CHANGED_WITHOUT_VERSION_BUMP` (tracker, 2026-10-31).

## Tasks

### T1 · Tests first (Acceptance 1–14)

Add or extend these tests, run them against today's code, and record which
fail first:

- `plan-gate-verification.test.ts` or `workflow.test.ts`, with the existing
  task-verification fixtures:
  - zeros recorded, a correct digest kept, evidence v2 (Acceptance 1–2);
  - the refusals of Acceptance 3, each with the plan bytes unchanged;
  - a concurrent change between read and write, simulated through the
    helper's injectable read, failing with `PLAN_TASK_COMPLETION_INVALID`
    and a message naming the path, and staying retryable (Acceptance 4).
- `result-digest.test.ts`:
  - v2 parse and write, v1 read with `recorded: false`;
  - `rejected` only for unmatched, unrecorded comparisons;
  - `digestRejectionReason` treating a recorded comparison as a match;
  - the unchanged supplemental-source rejection (Acceptance 8).
- `workflow-recovery.test.ts`: reconciliation after an interruption before
  and after the plan write (Acceptance 5).
- `plan-recheck.test.ts`: the gate-entry snapshot holds the recorded bytes, a
  re-check without edits rewrites nothing, approval needs no re-check, and a
  later hand edit still fails approval and names the re-check
  (Acceptance 6–7). The existing test that expects a planning result with a
  mismatched remainder to be rejected at acceptance changes to expect the
  runner-recorded value. That is the ADR-0058 Compliance item 3 change.
- `workflow-eligibility.test.ts`: the R6 rule and every exclusion of
  Acceptance 11, plus the incident-shaped fixture (Acceptance 12).
- `workflow-recovery.test.ts` or `planning-review-workflow.test.ts`:
  `banzai retry` after a planner block, both ordinary and in the `applying`
  step. It checks `retryOf`, the prompt component, kept ADR decisions, the
  open episode and the event (Acceptance 9–10).
- `interactive.test.ts` and `agent-control.test.ts`: the label, the
  confirmation and the derived `retry` next action (Acceptance 13).
- `prompts.test.ts`: the two R1 sentences are present, and the hashing
  sentence is absent (Acceptance 14).

### T2 · Shared plan-file helpers (R2)

- `readRecheckBundle`, `exactUtf8` and `replacePlanBytes` accept the failure
  to raise. Re-check call sites pass today's `recheckRefused` and
  `PLAN_RECHECK_CHANGED` errors unchanged.
- Acceptance raises `PlanTaskCompletionError("approved_plan_invalid", …)` for
  refusals and for a plan changed between read and write. The changed-plan
  message names the path and says nothing was written. The attempt lifecycle
  records it as `PLAN_TASK_COMPLETION_INVALID`, which is already in
  `PLANNING_REPAIR_FAILURE_CODES`, so the failed planning attempt stays
  retryable with session reuse. No new failure code enters persisted state.
- Register the `plan-tasks.ts` → `../plan-gate/recheck.js` edge under
  ADR-0064.

### T3 · Digest evidence v2 (R3)

- `types.ts`: `RESULT_DIGEST_EVIDENCE_SCHEMA` and its version become v2.
  `ResultDigestComparison` gains `recorded: boolean`, and the v1 shape stays
  as a historical reader type.
- `validation.ts`: `parseResultDigestEvidence` accepts v2 with exact keys and
  v1 with `recorded` read as `false`. A `recorded: true` comparison must be a
  plan attempt's `binding` comparison on `planRemainderSha256` with
  `matched: false` and a non-null `observed`.
- `records.ts`: the outcome is `rejected` only for an unmatched, unrecorded
  comparison. `digestRejectionReason` matches a recorded comparison through
  its `observed` value and reports "matched when the runner recorded it at
  acceptance".
- Every existing writer of comparisons sets `recorded: false`.

### T4 · Runner-recorded remainder at acceptance (R2, R4, R5)

- `validatePlanningResult`, in task mode for `gate=plan_approval` with a plan
  artifact, follows these steps in order:
  1. read the bytes through the shared refusal and exact UTF-8 helpers;
  2. `parseApprovedPlanTaskIds`;
  3. `rewritePlanRemainderDigest`, which performs the inventory, descriptor
     and fresh-evidence validation and computes the observed value;
  4. `validateRunnerControlTasks`;
  5. record evidence with `recorded` set when the value differs;
  6. write through `replacePlanBytes` when the value differs.
- `establishPlanRemainderDigest` is replaced by this flow. No call site still
  rejects a planning result for a remainder mismatch.
- The non-task (legacy) branch is unchanged.
- `validatePlanningResult` keeps running before `completeAttempt`, so an
  acceptance failure fails the attempt through the existing lifecycle.
- Reconciliation reaches the same function. First-write-wins evidence and
  the matched second pass make it idempotent (R4).
- `retainPlanGateEntry` already runs after acceptance, so the snapshot holds
  the recorded bytes. Only tests change for R5.

### T5 · Planning instruction and prompt component (R1, R7)

- `prompts.ts`: replace the hashing sentence and add the block sentence (R1).
  Leave the rest of the instruction byte-identical.
- Add `blockedPlanningPromptEnvelope(base, source, summary, sessionMode)`. It
  is modelled on `planningRetryPromptEnvelope`, appends a
  `recovery_instructions` component headed "Continue blocked planning", and
  carries the redacted summary (at most 2,000 characters) as JSON diagnostic
  data. The existing envelope stays byte-identical for failed attempts.

### T6 · Retry eligibility (R6)

- `RetryEvidence` gains `latest_attempt`. `RetryFacts.latestAttempt` holds the
  latest run attempt record by `startedAt`. A tie or an unreadable record
  makes the source ineligible, never an error.
- In `decideWithoutAttempt`, after the planning-review rule and before the
  final refusal, the run is eligible when:
  - it is blocked from `planning`;
  - no episode is `reviewing` or `analyzing`, and the latest closed review is
    not stale;
  - the latest attempt is a plan attempt with status `completed` and a result
    whose `outcome` is `blocked`;
  - `blockReason` equals that result's `summary`.

  The decision returns the attempt's identity with the reason "The planner
  reported a block in attempt <id>; retry continues planning after you
  resolve it."

- `WorkflowRunner.retryEligibility` gathers the record only when the rule asks
  for it.

### T7 · Continuation (R7)

- `retry()`: when eligibility names a planner block (no active attempt,
  `blockedFrom: planning`, a non-null attempt identity):
  - after preflight, re-check eligibility under the lock and read the source
    record;
  - transition to `planning` and emit `attempt.retry_requested` with
    `failedAttemptId` set to the blocked attempt, `kind: "plan"` and
    `retryFrom: "planning"`;
  - call `executePlan(state, config, source, null, commitTransition)`.

  A preflight failure leaves the run blocked as it was.

- `executePlan`'s continuity rule treats a completed source with
  `outcome=blocked` as reusable. The workspace and settings checks still
  apply. The rule chooses `blockedPlanningPromptEnvelope` for that source.
- Confirm through T1 that the `applying` dispatch keeps the application
  prompt and does not close the episode early.

### T8 · Surfaces (R8)

- `interactive.ts`: the label "Continue planning after the reported block"
  and the confirmation "Run preflight and continue planning after the
  reported block?" for this source. The other labels stay unchanged.
- `cli.ts`: the human status already prints "Next: resolve the external
  failure, then run `banzai retry`." for retry-eligible blocks. Confirm it
  appears; change nothing else.
- Agent control: no source change. The test covers the derived `retry`.

### T9 · Documentation (R10)

- `documentation/orchestrator.md`: the plan-gate digest paragraph and the
  acceptance-time digest text say that the runner records the remainder. The
  retry section names the planner-block continuation.
- `packages/orchestrator/MODULES.md`: plan-tasks, plan-gate helpers, digest
  evidence v2 and retry eligibility.
- `PROJECT_MANIFEST.md` §6: one sentence for each fact. Keep the exact
  fragments that `check-release.mjs` pins.

### T10 · Lifecycle, facts, build and close-out

- Lifecycle metadata only:
  - ADR-0064 and ADR-0065 become Implemented by WP21;
  - the reciprocal lines in ADR-0051 and ADR-0036 say Implemented;
  - ADR-0058's annotation stays as admitted.
- Update the decision-index rows and the manifest rows to Implemented.
- Run `npm run build`, then `npm run build:check`.
- Write the report with:
  - R1–R10 and their evidence;
  - the T1 fail-first list;
  - deviations;
  - the Gate 1 item.
- Tracker: the WP21 row becomes `report ready`, and add the owner-decision
  entries.

## Tests

| Requirement | Evidence                                                                                 |
| ----------- | ---------------------------------------------------------------------------------------- |
| R1          | `prompts.test.ts`                                                                        |
| R2          | `plan-gate-verification.test.ts` or `workflow.test.ts`; `plan-recheck.test.ts` (helpers) |
| R3          | `result-digest.test.ts`                                                                  |
| R4          | `workflow-recovery.test.ts`                                                              |
| R5          | `plan-recheck.test.ts`                                                                   |
| R6          | `workflow-eligibility.test.ts`                                                           |
| R7          | `workflow-recovery.test.ts`; `planning-review-workflow.test.ts`                          |
| R8          | `interactive.test.ts`; `agent-control.test.ts`                                           |
| R9          | `result-digest.test.ts`; `workflow-eligibility.test.ts`; existing suites unchanged       |
| R10         | `release-validation.test.ts`; review of the diff                                         |

## Checks

- Focused, during work, through
  `node packages/orchestrator/scripts/test.mjs --file <name>.test.ts --output-root packages/orchestrator/.dist-check-wp21`:
  - `prompts`;
  - `result-digest`;
  - `plan-gate-verification`;
  - `plan-recheck`;
  - `task-verification`;
  - `workflow`;
  - `workflow-eligibility`;
  - `workflow-recovery`;
  - `planning-review-workflow`;
  - `interactive`;
  - `agent-control`;
  - `import-boundaries`.
- Final:
  - `npm run verify`;
  - `npm run format:check`;
  - `npx prettier --check` on the manifest, the tracker, the changed
    documentation and this work directory (not on ADRs or plugin files);
  - `release-validation.test.ts`;
  - `npm run release:validate`; if it stops, it stops only at the deferred
    `HOOK_CHANGED_WITHOUT_VERSION_BUMP`;
  - `node packages/orchestrator/scripts/release-candidate-check.mjs`, with
    the `node_modules` link workaround from WP19 and WP20.
- No live vendor run. The incident run's `banzai retry` is a Gate 1 item for
  the owner.

## Sequencing

T1 → T2 → T3 → T4 → T5 → T6 → T7 → T8 → T9 → T10.

- T4 needs the T2 helpers and the T3 evidence.
- T7 needs the T5 prompt component and the T6 rule.
- T10's build comes after every source change.

## Risks

- **The runner corrupts plan bytes.** Only a validated, exact-UTF-8 plan is
  rewritten. Only the 64-character value changes, through
  `rewritePlanRemainderDigest`, which re-parses its own output. The write is
  compare-and-replace. T1 checks byte equality outside the value.
- **A changed evidence contract breaks historical reads.** v1 stays a reader
  surface, and `result-digest.test.ts` reads a v1 fixture.
- **The eligibility rule offers retry for a block that is not the planner's.**
  Four conditions must all hold, including equality of the block reason with
  the result summary. T1 tests each exclusion.
- **Session reuse after the human edits settings.** Today's workspace and
  settings checks pick a fresh session when the workspace changed, and the
  prompt then restores context from the planning files.
- **The deferred version error masks later `release:validate` checks.**
  Evidence comes from `release-validation.test.ts` and the candidate check,
  as in WP8 and WP20.
