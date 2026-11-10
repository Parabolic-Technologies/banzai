# WP4 plan

Requirements: [requirements.md](requirements.md). Authority:
[ADR-0058](../../decisions/0058-human-plan-edits-rechecked-at-the-plan-gate.md),
[ADR-0057](../../decisions/0057-complete-task-verification-rounds.md) §2 for
the helper v4 publication.

## Approach

- **Shared inventory bytes.** The digest rewrite sits beside
  `parseTaskVerificationObligations` in `plugins/banzai/lib/task-verification.mjs`,
  so the block regex and the remainder definition have one owner.
- **Pure summary.** The summary is a pure domain function over two byte sets.
- **Workflow shell.** The workflow runner owns the lock, the reads, the
  compare-and-replace write, the record and the event.
- **One record.** The state change is one additive record kind and one
  optional approval field. Under Q1's recommendation they arrive with v11 at
  the first re-check.
- **One control revision.** Control 9.0.0 carries both `recheck` and helper v4.

## Tasks

1. **Inventory rewrite (lib).** In `task-verification.mjs`, add
   `planRemainderDigest(plan)` and `rewritePlanRemainderDigest(plan)`.
   - Both use the existing single-block match. The rewrite returns
     `{ plan, declared, observed, rewritten }`.
   - It replaces only the declared 64-hex value inside the
     `"planRemainderSha256": "<hex>"` member of the one inventory block.
   - It refuses when that member is not present exactly once in the block or
     the declared value is not 64 lowercase hex.
   - It then re-parses the result with `parseTaskVerificationObligations`.
   - Update `task-verification.d.mts`.
2. **Gate-entry snapshot (store).**
   - In `store.ts`, add `writePlanGateSnapshot(runId, entries)`, which writes
     `.banzai/runs/<id>/plan-gate/<NNN>/`. It is create-only, private 0o700/0o600
     like the approval snapshot, and its manifest holds the number, digest,
     entries and time.
   - Add `readLatestPlanGateSnapshot(runId)`, which returns null when no
     snapshot exists or it is unreadable.
   - In `workflow.ts`, call it at the three gate entries: the planning-result
     transition, `restorePlanningGate`, and the triage restore. It runs after
     the transition is validated and before the state write. A snapshot failure
     blocks the transition with a precise error, so no gate entry lacks its
     snapshot.
3. **State v11 (types, store, validation).** Each step follows Q1's
   recommendation.
   - `types.ts`:
     - `schemaVersion` gains 11;
     - `PlanRecheckRecord` joins `HumanDecisionRecord`;
     - `PlanRecheckSummary`;
     - `ApprovalRecord.recheckId?: string | null` for plan approvals on v11.
     - `RUN_STATE_SCHEMA_VERSION` stays 10 for new runs.
   - `store.ts` `normalizeRunState` accepts 11 with v10 rules.
   - In `planning-review-state.ts` (`validatePlanningReviewState`), v10 and v11
     share the planning rules; `plan_recheck` is valid only on v11, with exact
     keys, bounded summary and digest checks.
   - Every v10-only check becomes "v10 or v11": `doctor.ts`,
     `agent-control-cli.ts`, `configuration-prerequisite.ts`,
     `workflow/domain/planning-review.ts` (`planningGateActions`, restore
     eligibility) and the hook's executable-version check in
     `hooks/spec-gate.cjs`. `NEWEST_RUN_STATE_SCHEMA` becomes 11.
   - `npm run build` regenerates `lib/artifact-readers.mjs`.
4. **Summary (domain).** New `src/workflow/domain/plan-recheck.ts`:
   - `planRecheckSummary(planner, current)` works over `{path, bytes}[]` and
     two parsed inventories:
     - file changes;
     - Markdown sections by ATX heading outside fenced code, keyed by heading
       path and occurrence and compared by section bytes;
     - check changes by id with changed field names;
     - absence-rationale change;
     - accepted-ADR notices, from a `Status: Accepted` line in the current or
       planner's bytes of a bundle ADR.
   - Counts are capped (64 files, 64 headings per file, 200 checks). A
     truncated list states its omitted count.
   - It returns headings, ids, field names and paths only.
5. **Re-check (workflow).** Add `WorkflowRunner.recheckPlan({ decidedBy })`.
   Under the workflow lock it:
   - requires an idle `needs_plan_approval` gate on a task-verification run on
     v10 or v11;
   - reads each bundle path with `lstat` and refuses a missing, symlinked or
     non-regular file;
   - runs `approvedTaskIds`, `validateRunnerControlTasks` and the rewrite
     (task 1), with the fresh-evidence rule inside the parser;
   - writes the plan through a temp file plus rename. Right before the rename
     it compares the plan's bytes with those read in step 1 and refuses
     `PLAN_RECHECK_CHANGED` on any difference;
   - digests the resulting bundle and builds the summary against the latest
     gate snapshot;
   - appends the `plan_recheck` record, moving v10 to v11 in the same write;
   - appends a `plan.recheck` event (id, snapshot number, digests, counts,
     paths) and returns the state.

   A refusal throws before any write. `approvePlan` changes in two ways:
   - On a mismatch it wraps the digest error, keeping the code
     `TASK_VERIFICATION_DIGEST_MISMATCH`. The message appends: "Choose Re-check
     my edits, or run `banzai approve plan --decision recheck`, to record the
     digest of your edits."
   - On v11 it sets `planApproval.recheckId` to the latest re-check of the
     current gate entry whose resulting digest equals the approved digest, or
     null.

   `WorkflowStatus.planRecheck` exposes the latest summary of the current gate
   entry: the record's snapshot number equals the latest snapshot number, or
   both are null.

6. **Human time.** In `human-time.ts` and `human-time-store.ts`,
   `plan_recheck` records and `plan.recheck` events are not decision
   boundaries. A test pins that the gate episode stays open across a re-check
   and closes on approval.
7. **Terminal and CLI.**
   - **Terminal.** In `interactive.ts`, the plan gate prints the R7 copy with
     the bundle paths and the latest summary. It offers "Re-check my edits"
     between approve and rework when `planningReview.decisions` includes
     `recheck`. After a re-check it loops back to the gate without a
     confirmation, because the action never approves.
   - **CLI.** In `cli.ts`, `parsePlanGateArgs` accepts `recheck` (no note) and
     dispatches to `recheckPlan`. `printState` at the gate shows the CLI form
     of the copy and the summary. A summary-rendering helper is shared with the
     terminal in `verification-ui.ts` or a sibling module.
8. **Agent control 9.0.0.**
   - **Constants.** In `types.ts` and `agent-control.ts`: control
     `9.0.0`, capabilities v9, status v7.
   - **Decisions.** `plan_approval` decisions are
     `["approve", "recheck", "rework", "review"]`.
   - **Status.** `pendingGate.recheck` is a bounded summary or null; the
     status size check covers it.
   - **Requests.** `verificationRequestSchemas` lists
     `["banzai-verification-request/v4", "banzai-verification-request/v3"]`.
   - **Operations.** There is no new operation: a supervisor relays
     `banzai approve plan --decision recheck` under `approvePlan`, which already
     has `inputSchemas: []`.
   - **Protocol.** `control-protocol.md` and `orchestrate/SKILL.md` pin the v9
     declaration, the status v7 field and the relay rule (only on the current
     human's explicit request; never edit planning files).
   - **Release pins.** Update `release-policy.json`, `scripts/check-release.mjs`
     and `scripts/smoke-committed.mjs`, and the README files that name the
     control revision.
9. **Helper v4 publication.**
   - `policies/artifact-storage.md` documents request v4 (`retryOf` as the
     round's exact unsuccessful set) and keeps v3 as retained.
   - The skills in Q2 name v4.
   - `verification-helper.mjs` and `scripts/verification.cjs` diagnostics name
     v4.
   - `contracts/README.md` lists the v4 contracts.
10. **Lifecycle and transitions.**
    - Set ADR-0058 "Implementation state: Implemented … by WP4" and update its
      decisions index row.
    - Then run `npm run build` and `instruction-baseline.mjs --describe`. With
      an authorization citing ADR-0057 §2 and ADR-0058 §§4, 6 at their final
      bytes, `--check` and publish one transition for the policy, the skills,
      `orchestrate/SKILL.md` and `spec-gate.cjs`.
    - ADR-0057 is not edited.
11. **Tests.**
    - **New `test/plan-recheck.test.ts`** on the phpcs plan-gate fixture,
      covering acceptance items 1, 2, 4, 5, 8, 9 and 10:
      - a prose edit is rewritten in place, approved, and linked by
        `recheckId`;
      - each refused edit leaves files, state, events and snapshots unchanged;
      - a write race returns `PLAN_RECHECK_CHANGED`;
      - a matching digest writes nothing;
      - a run without a snapshot says the planner's version is unavailable;
      - the human-time episode stays open;
      - a v9 state offers no re-check.
    - **Lib tests:** the rewrite helper with byte-exact output, CRLF plans and
      a duplicated member.
    - **Domain tests:** sections, check field diffs, the accepted-ADR notice,
      bounds and the no-content canary.
    - **Changed suites:**
      - `plan-gate-verification.test.ts`: the approval message now names
        re-check;
      - `interactive.test.ts`: choice order, copy, loop;
      - `cli.test.ts`: grammar, including `--note` with `recheck`;
      - `agent-control.test.ts` and `agent-control-cli.test.ts`: v9, v7, the
        decisions list and `pendingGate.recheck`;
      - `store.test.ts`: v11 normalization and refusal of `plan_recheck` on
        v10;
      - `hook.test.ts`: v11 is executable;
      - `release-validation.test.ts` and `committed-smoke.test.ts`: new pins;
      - `workflow-skills.test.ts`: the protocol text.
    - **Item 3:** the existing ADR-0051 digest-rejected tests stay unchanged
      and pass.
12. **Docs.**
    - `documentation/orchestrator.md`: plan gate, approve plan grammar, control
      9.0.0, helper v4.
    - `documentation/getting-started.md`: the strict plan gate.
    - `packages/orchestrator/MODULES.md`: store, workflow, the new domain
      module, agent control.
    - `PROJECT_MANIFEST.md`: current facts and the ADR-0058 row.
    - The tracker row and the report.

## Checks

- **Focused:** `node packages/orchestrator/scripts/test.mjs --file <file>`
  for each touched suite.
- **Final:**
  - `npm run build`, then `npm run verify` and `npm run format:check`;
  - `npm run release:validate`, where only
    `HOOK_CHANGED_WITHOUT_VERSION_BUMP` is expected (Gate 1).

## Sequencing

WP2 is committed as `da624a4`. The owner approved this plan on 2026-10-31
with `Both recommended` (see the owner decisions in requirements.md). Tasks 1–7
come first,
then 8–9 (contract and text), then 10 (transitions on final bytes), 11 and 12.
