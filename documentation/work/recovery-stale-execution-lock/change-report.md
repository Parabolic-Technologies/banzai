# Recover stale execution ownership after a crash

Date: 2026-10-22

## Scope and authority

The owner explicitly requested safe execution-lock recovery after an abrupt
executor exit. This is a bounded correction to operator-authorized recovery
under [ADR-0023](../../decisions/0023-durable-terminal-attempt-checkpoints.md)
and execution coordination retained by
[ADR-0054](../../decisions/0054-git-visible-work-artifacts.md).
No upstream feature specification or approved plan is selected for this fix.
There are no review findings to triage. No ADR lifecycle change is required:
the existing recovery decision and exclusive execution boundary remain intact.

## Problem and required behavior

An abrupt exit leaves a valid work execution claim after its owner process
has gone. Recovery records the human authorization, but normal execution
ownership then rejects the retained claim before starting a replacement.

- Reclaim only during an explicitly authorized recovery whose attempt,
  workspace, approval, configuration and bound work still match.
- Hold repository ownership while reclaiming. Normal execution and standalone
  verification must continue to reject conflicting claims, including dead ones.
- Require the exact work directory and binding identity, a valid claim and a
  positive bounded PID. Only an OS `ESRCH` result proves the owner absent.
  Live, reused, inaccessible or uncertain PIDs retain their claim.
- Reject unsafe paths, malformed or mismatched claims and changing ownership.
  Preserve original claim bytes privately before removing the active name.
- Revalidate recovery after acquiring work ownership; preserve source attempt
  history and create only the existing single linked recovery attempt.

## Security exposures

- Class 1, filesystem input: shared contained-path, regular-file, bounded-read
  and ignore checks govern the claim and its retained copy.
- Class 2, ownership: exact binding, repository ownership, current recovery
  authorization and confirmed PID absence gate reclamation.
- Class 7, removal: retain original bytes, compare claim identity and inode
  again, and use normal create-only acquisition after removal.

## Structural assessment

Trigger: extension of execution-claim cleanup after a crash. The existing
execution ownership module owns claim paths, exclusivity and release; it also
owns the new bounded recovery operation. `WorkflowRunner` retains recovery
authorization and ordering, and `RunStore` retains repository serialization.
Disposition: retained owners; no new subsystem, dependency or state format.

Reuse search: `execution-ownership.mjs`, `project-files.mjs`,
`RunStore.acquireLock/assertLockOwned/processAlive`, and
`WorkflowRunner.executeAuthorizedRecovery/recoveryEligibility`. Reuse the
shared filesystem and claim acquisition primitives. The generic runner PID
predicate treats errors other than `EPERM` as absence, so claim removal uses a
narrower `ESRCH`-only check. Do not broaden normal runner-lock reclamation or
standalone verification permissions as part of this fix.

The recovery path validates authority before reclaiming, then re-enters its
existing checks under work ownership before preflight and model execution.
All competing recovery operations use the repository lock; ordinary competing
executors use create-only claim publication. A changed claim fails closed.
No protection against a checkout owner deliberately bypassing coordination is
claimed. PID reuse conservatively blocks recovery and requires inspection.

The final lint check reports `executeAuthorizedRecovery` complexity 73 against
the advisory threshold 15; a separate check of its unchanged `HEAD` source
reports 71. Retain this recovery coordinator: the two added conditions select
its existing ownership/preflight boundary, while filesystem reclamation stays
in the shared ownership module. Extracting the existing source-transition and
authority branches would broaden this fix and couple a new owner to the same
attempt state and collaborators. Existing coordinator complexity remains debt;
no advisory rule is suppressed. New tests introduce no lint warnings.

## Changes and documentation

- `plugins/banzai/lib/execution-ownership.mjs` and its `.d.mts` declaration add
  an opt-in runner recovery path, retaining the existing claim shape and normal
  execution behavior. Original claims use create-only
  `recovered-<token>.json` files in the same ignored lock directory.
- `packages/orchestrator/src/workflow.ts` enters that path only after validating
  persisted recovery authority and repository ownership, then revalidates under
  work ownership before preflight or a model call.
- `packages/orchestrator/test/execution-ownership.test.ts` covers dead and live
  owners, uncertain liveness, malformed/foreign claims, replacement races,
  backup interruption/conflict, private destinations and symlinks.
  `workflow-recovery.test.ts` extends existing lineage coverage with the actual
  stale claim and proves authority/drift/live-executor refusals.
- `PROJECT_MANIFEST.md`, `packages/orchestrator/MODULES.md`,
  `documentation/artifact-storage.md` and `documentation/orchestrator.md`
  describe the implemented recovery boundary.
- `npm run build` rebuilt the ignored CLI distribution. Generated tracked
  resources were already current and did not change. No version bump, commit,
  publication or client-project mutation belongs to this fix.

Engineering Quality deviations: None. The remaining advisory complexity is
recorded above with its ownership disposition.

## Verification and assurance critique

- Regression before production changes: the focused workflow recovery test
  failed with `ARTIFACT_OWNERSHIP_CONFLICT`, reproducing the reported defect.
- The same focused regression passed after the implementation. A first combined
  affected-file run exposed an incorrectly constructed Git-ignore exception in
  a new test fixture; its parent directory still hid the intended visible leaf.
  The corrected fixture and all four workflow refusal cases passed the targeted
  follow-up (8 tests including subtests).
- `npm run build`: passed.
- `npm run format:check`: passed.
- `npm run verify`: typecheck and lint passed with 0 lint errors and 415 advisory
  warnings. The full test run completed with 1,720 passing and 60 failing out of
  1,780 tests. Every failure was in `release-evidence.test.ts`, where the sandbox
  denied the disposable local HTTP server with `listen EPERM 127.0.0.1`.
- `node packages/orchestrator/scripts/test.mjs --output-root
/tmp/banzai-release-evidence-recovery --file release-evidence.test.ts`: all
  62 tests passed with permission to bind local loopback, on the same production
  and test sources. This rerun covers all 60 sandbox failures and the two tests
  from that file which already passed. The combined runs establish passing
  results for all 1,780 distinct tests; the original full command still has its
  nonzero sandbox result.
- `npm run build:check`: passed separately because the initial test exit
  prevented the verify script from reaching this final stage. Generated-source
  checks, distribution parity and CLI smoke succeeded.
- `git diff --check` and the new report's Prettier check: passed.
- Private command logs are under
  `.banzai/verification/recovery-stale-execution-lock/`; no raw log is published
  with this report.
- Assurance owns actual recovery and safety refusals, without treating claim
  cleanup as successful completion of the interrupted model attempt. Tests use
  real local files and an exited child PID; workflow adapters replace live model
  calls, and boundary mocks exercise otherwise nondeterministic liveness errors
  and claim replacement. No external model or physical power-cut test ran.
