# WP4 implementation report

Status: report ready, not committed · Requirements:
[requirements.md](requirements.md) · Plan: [plan.md](plan.md) · Authority:
[ADR-0058](../../decisions/0058-human-plan-edits-rechecked-at-the-plan-gate.md),
[ADR-0057](../../decisions/0057-complete-task-verification-rounds.md) §2

## What changed

| Area                         | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Inventory rewrite (R2)       | `plugins/banzai/lib/task-verification.mjs` shares one inventory inspection between the strict parser, the new lenient `readTaskVerificationObligations` and the new `rewritePlanRemainderDigest`. The rewrite refuses a declared value that is not 64 lowercase hex or a member that is not present exactly once in the block, replaces only those 64 characters and re-parses the result. The strict parser keeps ADR-0051's order: the remainder digest is checked before the descriptors.                                                     |
| Gate-entry snapshot (R1)     | `RunStore.writePlanGateSnapshot` writes numbered, create-only `.banzai/runs/<id>/plan-gate/<NNN>/` entries (private files, `bundle.json` last). `readLatestPlanGateSnapshot` returns null when none exists and fails with `PLAN_GATE_SNAPSHOT_INVALID` for an unreadable latest entry. `WorkflowRunner` retains one at the three entries into `needs_plan_approval` (planning result, planning-review restore, triage restore) for strict task-verification runs on v10+.                                                                        |
| State v11 (R4, Q1)           | `RUN_STATE_SCHEMA_VERSION` stays 10. A run moves to v11 in the state write that appends its first `plan_recheck` record. `planning-review-state.ts` validates the record with exact keys, unique `plan-recheck-<12 hex>` ids, consistent gate entry, planner and written digests, sanitized and bounded headings and known check fields, and `planApproval.recheckId` only on v11 and only naming a record. Every v10-only check (doctor, workflow, human time, agent control CLI, configuration prerequisite, the hook) now admits v10 and v11. |
| Summary (R3)                 | New pure `src/workflow/domain/plan-recheck.ts`. It compares the current bundle with the planner's version: files, Markdown sections by ATX heading outside fences (keyed by level, text and occurrence), checks by id with changed field names, absence rationale and changed accepted bundle ADRs. The runner-owned digest is masked before comparison. Limits: 16 files, a shared budget of 48 headings of up to 120 characters, 48 checks, with omitted counts.                                                                               |
| Re-check (R2, R4, R5)        | `WorkflowRunner.recheckPlan({ decidedBy })` runs under the workflow lock at an idle gate. It reads the bundle through `workflow/plan-gate/recheck.ts` (missing, symlinked and non-regular files refused), validates the runner-control task rule, the task grammar and the inventory, then rewrites the digest. The write is a compare-and-replace (`PLAN_RECHECK_CHANGED`). It appends the record and a `plan.recheck` event (ids, digests, counts, paths). Refusals are `PLAN_RECHECK_REFUSED` and write nothing.                              |
| Approval (R4, R5)            | `approvePlan` never rewrites a digest. On v10+ a remainder mismatch keeps `TASK_VERIFICATION_DIGEST_MISMATCH` and appends "Choose Re-check my edits, or run `banzai approve plan --decision recheck`, to record the digest of your edits." On v11 the approval's `recheckId` names the latest re-check of the current gate entry whose bundle digest equals the approved digest, or null. `status().planRecheck` shows only that entry's latest record.                                                                                          |
| Human time (R5)              | Neither the record nor the event is a decision boundary; the gate episode stays open until approval.                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Terminal and CLI (R7, R8)    | New `src/plan-gate-ui.ts` holds the waiting copy and the escaped summary. The interactive gate prints both and offers "Re-check my edits" between approve and rework, with no confirmation; a refusal is printed and the gate is shown again. `banzai approve plan --decision recheck` accepts `--by` and `--no-resume` (no effect) and refuses `--note`; `banzai status` prints the CLI waiting copy and the summary.                                                                                                                           |
| Agent control 9.0.0 (R9)     | Capabilities v9 and status v7. `planningGates.decisions.plan_approval` is approve, recheck, rework, review. `pendingGate.recheck` is `{ recheckId, decidedAt, summary }` or null, under a 32 KiB guard. `workDocuments.verificationRequestSchemas` lists v4 and v3. No new operation or input document. Release policy, `check-release.mjs`, `smoke-committed.mjs`, the protocol, the `orchestrate` skill and READMEs pin the new identities.                                                                                                    |
| Helper v4 publication (R10)  | `policies/artifact-storage.md` documents request v4 as current and keeps v3. The seven skills (Q2) name v4. Diagnostics in `verification-helper.mjs` and `scripts/verification.cjs` name v4.                                                                                                                                                                                                                                                                                                                                                     |
| Instruction transition (R11) | One transition for the policy, the seven skills, `orchestrate/SKILL.md` and `spec-gate.cjs`, citing ADR-0057 §2, ADR-0058 §§4, 6 and ADR-0055 at their final bytes (see Deviations).                                                                                                                                                                                                                                                                                                                                                             |
| Import boundaries            | `import-boundaries.mjs` registers the three new modules under ADR-0058 (the summary as a domain module) and the new edges from `cli.ts`, `interactive.ts`, `store.ts`, `workflow.ts` and `planning-review-state.ts`. `types.ts` re-exports the two inventory types so the domain module imports only `types.ts`.                                                                                                                                                                                                                                 |
| Docs (R12)                   | `documentation/orchestrator.md`, `documentation/getting-started.md`, `documentation/artifact-storage.md`, `documentation/verification-examples.md`, `README.md`, `packages/orchestrator/MODULES.md`, `PROJECT_MANIFEST.md` (facts, ADR-0058 row Implemented), the contracts, hooks and plugin documentation READMEs, ADR-0058 implementation state and the decisions index row, tracker.                                                                                                                                                         |

## Tests

- New `test/plan-recheck.test.ts`, 26 tests on the phpcs plan-gate fixture and
  pure inputs:
  - a prose edit: approval first fails with the new message; the re-check
    rewrites only the 64 digest characters, moves the run to v11 and reports an
    added section; status shows the record; the event and record carry no
    prose; approval links `recheckId` (acceptance 1, 5, 6);
  - a description edit with a matching digest writes nothing and still reports
    the changed file (5);
  - nine refusals with exact messages and an unchanged tree (files, state,
    events, snapshots): missing and duplicated inventory, malformed JSON, an
    invalid descriptor, a broken task heading, a runner-control task,
    equivalent evidence against a fresh commitment, a missing and a symlinked
    bundle file (2);
  - a plan saved during the re-check is kept and nothing is written; the
    replacement preserves mode and leaves no temporary file (4);
  - a run without a snapshot reports the planner's version as unavailable and
    lists the current checks (8);
  - a later gate entry (after rework) shows and links no earlier re-check;
  - the human-time observations are unchanged by a re-check, and approval
    closes the episode (9);
  - a v9 task run offers no re-check, refuses `recheckPlan` and keeps the
    unchanged mismatch message (10);
  - an unreadable latest snapshot refuses without writing;
  - the CLI waiting copy, `--note` refusal and `--decision recheck --by owner
--no-resume`;
  - the lib rewrite for LF and CRLF plans, idempotence, a malformed value, a
    duplicated member and two inventories;
  - the summary: fenced and repeated headings, check field names, the accepted
    ADR warning, a content canary, the masked digest, a changed absence
    rationale, bounds and unsafe headings;
  - persisted validation: a record on v10, unknown keys, malformed and
    duplicate ids, inconsistent digests and flags, control characters, unknown
    fields and too many files, and the store refusing a v10 state with a
    record.
- `interactive.test.ts`: choice order, waiting copy and paths, no
  confirmation, a refusal printed and the gate shown again, the summary lines,
  and an unexpected error propagating.
- `agent-control.test.ts`: request v4/v3 in capabilities, the plan decisions,
  `pendingGate.recheck` with and without a record, no private fields, the size
  guard; the existing plan gate projection now carries `recheck: null`.
- `hook.test.ts`: the bound-role test runs on v10 and v11, and v12 gets the
  update diagnostic.
- Version pins in `agent-control-cli`, `committed-smoke`, `release-validation`
  and `workflow-skills`.
- Acceptance 3: the ADR-0051 digest-rejected planning tests are unchanged and
  pass.

## Checks

- Focused suites: `plan-recheck`, `interactive`, `agent-control`,
  `agent-control-cli`, `hook`, `store`, `plan-gate-verification`,
  `human-time`, `committed-smoke`, `workflow-skills`, `release-validation`,
  `planning-review-workflow`, `work-documents`. All pass.
- `npm run format:check`: pass.
- `npm run verify` (typecheck, lint, test, build:check). The first two runs
  failed, and every cause is fixed:
  - lint: the new modules were missing from `import-boundaries.mjs`, plus
    three style errors in new code;
  - tests: the `PROJECT_MANIFEST.md` edit had broken a release-pinned
    fragment ("phase-result schema v4 and state schema v10 with explicit
    historical readers"), which masked the expected error in about 70
    release-validation tests; three expectations still named the old helper
    diagnostic, the plan decisions without `recheck` and the v10-only
    `RunState` union.

  The final run passes: 1843/1843 tests, lint with 0 errors and 422 warnings,
  and build:check.

- `npm run release:validate` fails only with
  `HOOK_CHANGED_WITHOUT_VERSION_BUMP`, which the owner deferred to the Gate 1
  release. `npm run release:check` was not run.

## Deviations from the plan

- **Third authority.** The instruction builder accepts an
  `orchestrate/SKILL.md` change only under ADR-0045, ADR-0049, ADR-0054 or
  ADR-0055. ADR-0058 amends ADR-0055 for this gate surface, so the
  authorization also cites ADR-0055 at its current bytes. The builder's
  protected list is unchanged.
- **Smaller summary bounds.** The plan named 64 files, 64 headings per file and
  200 checks. Those do not fit the status projection, so the limits are 16
  files, 48 headings shared across files and 48 checks, each with an omitted
  count.
- **Release policy.** `release-policy.json` keeps `currentSchemaVersion: 10`
  because new runs start there; v11 is pinned through the `RunState` type
  check in `check-release.mjs` instead.
- **Clearer refusals.** Missing, symlinked and non-regular bundle files get
  their own messages (`… is missing.`, `… is a symbolic link; replace it with a
regular file.`) rather than the generic contained-read error.

## Open questions

None. `HOOK_CHANGED_WITHOUT_VERSION_BUMP` stays until the Gate 1 release, as
the owner decided on 2026-10-31.
