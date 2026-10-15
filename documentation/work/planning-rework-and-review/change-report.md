# Review-2 Fix Report: Planning Rework and Independent Planning Review

Date: 2026-10-14. Work: [plan.md](plan.md), [description.md](description.md).
Review: [review-2.md](review-2.md). Authority:
[ADR-0055](../../decisions/0055-planning-gate-rework-and-independent-planning-review.md).

## Authorization and Scope

The owner requested analysis and authorized fixes selected from review-2.
R2-F1 through R2-F12 are accepted for this remediation. Confirmed defects are
corrected and the approved per-task assurance obligations gain behavioral
assertions. No obligation is narrowed. Requirements, approved plan, Accepted
ADR bodies and both review artifacts remain unchanged. Version 2.7.1 remains
the owner's selected unreleased implementation version.

Review-1 F1 remains rejected; the ADR-0022 MCP construction is unchanged.
Review-1 F2's required phase instruction assertions are delivered. This is
author remediation evidence; independent resolution review and human acceptance
remain separate phases. Opus's immutable review-2 verdict is still
`changes_requested`.

## Structural Assessment

The prior plan assessment remains applicable. WorkflowRunner retains locks,
effect ordering and continuation; pure dispatch/retry/restore decisions retain
their domain owners. Existing persisted text validation, hashing, artifact
scope, atomic publication and human-time corroboration are reused. No new
production module, dependency, schema or mutable-state owner is introduced.
The changes enforce the existing public/persisted contracts. Complexity-15 and
nested-ternary advisory diagnostics retain their current policy and owners.

## Finding Dispositions and Author Evidence

Each finding is accepted and addressed; independent confirmation is outstanding.
Test paths below are relative to packages/orchestrator/test.

| Finding | Implemented correction | Author regression evidence |
| --- | --- | --- |
| R2-F1 | ADR rework rejects noncanonical ids and invalid feedback before the workflow lock/persistence. Every accepted id satisfies persisted validation. | workflow-review.test.ts and rebuilt cli-routing.test.ts: whitespace/CR/LF/control/bidi/length ids preserve state/events and cause no human-time or adapter action. |
| R2-F2 | Reviewed path scope/stale hashes use plain lowercase SHA-256 of raw file bytes; artifact-bundle hashing retains its prior semantics. | planning-review-workflow.test.ts independently hashes each file and published artifact bytes. |
| R2-F3 | Restore guard now checks exact run, episode, review, analysis, origin and pending-request identities, no action and no active attempt/process. Existing hook and recovery boundaries gain their binding fact tables. | hook.test.ts uses actual runner environment for both kinds and all targets; domain dispatch/restore, state-machine, recovery/digest-rejected, artifact-scope, failure and human-decision suites. |
| R2-F4 | ADR feedback refusals use exact required text, durable v10 rework data reaches the planner, and existing accept/reject/legacy meanings remain. | workflow-review.test.ts and cli-routing.test.ts cover atomic invalid notes/ids, exact record/prompt, legacy record and accept null/CR note. |
| R2-F5 | Every listed assurance gap gains a behavioral assertion; implementation/test reports now name the exercised contract and separate failed/historical/current evidence. | Per-task matrix in test-report.md; exact argv, scopes/checkpoints, prompts/context/preflight, timing/cancellation, stale/recovery/approval/status, UI/checkbox/CLI/smoke and control privacy tests. No plan-change waiver. |
| R2-F6 | Completed review reconciliation derives the single reserved publication path even if the state artifact cursor was not written. Recovery alone excludes it; normal model scope checks still forbid writes. | planning-review-workflow.test.ts simulates linked bytes before state cursor, resumes with no model call, exact bytes and one publication event. Both-kind forbidden-path scope tests pass. |
| R2-F7 | An active applying episode follows ordinary plan retry evidence; a completed blocked result with no attempt is ineligible. Reviewing/analyzing and closed stale shortcuts remain distinct. | planning-review-workflow.test.ts: status and retry agree, rejection leaves bytes/calls unchanged; workflow-recovery.test.ts: failed applying retry retains immutable evidence without rehash. |
| R2-F8 | Review-request human-time corroboration uses immutable episode identity and permits an earlier positive reserved number in that episode. Triaged/restored anchors still require exact current number and gate/paths/owner corroboration. | Conflict retry reserves N+1, preserves existing bytes and same episode, and yields no HumanTimeStore ambiguity; forged anchor and stale/timing journeys pass. |
| R2-F9 | Each complete finding/analysis card is rendered immediately before its own disposition menu, in review order. | interactive.test.ts asserts interleaved card/menu order, full contents, recommendations and hostile text escaping. |
| R2-F10 | Exact ADR missing/dangling note diagnostic; stale retry label; approve-plan dangling note follows the selected decision rule; triage prints one Next line; HELP describes the loop and gate/answer v4 identities. | Rebuilt cli-routing.test.ts, interactive.test.ts and committed-smoke.test.ts exercise exact strings/grammar, atomic refusals and HELP pins. |
| R2-F11 | Current state/control facts, commands and new module ownership are folded into manifest/module owning sections; stale v9 guide sentences and consultation release pins move to v10. | Maintained-document inspection, release-validation.test.ts stale-document regression, instruction/resource parity and release validation. |
| R2-F12 | Reviewer evidence.line failures use INVALID_RESULT; positive-integer config callers retain INVALID_CONFIG. | planning-review-contracts.test.ts covers zero, negative, fraction, string and NaN lines with exact error code. |

Two additional bounded corrections arose from the approved contract assurance:

- planning-review-artifact.ts compares Buffers for idempotency. Different raw
  bytes that decode to the same replacement-character text must conflict;
  planning-review-artifact.test.ts demonstrates preservation without overwrite.
- planning-review-state.ts chooses shape by the persisted active/closed slot,
  rather than presence of outcome/step fields. store.test.ts rejects slot
  confusion and keeps historical state consumption closed.

## Verification

The 400-test regression batch passed with zero failures/cancellations/skips.
The three strengthened exact-disposition/prior-feedback scenarios and three
interrupted-attempt retry assertions also passed. A broad 386-test batch had
384 passes and two incorrect fixture assumptions; both were corrected and
rechecked. All earlier failed runs remain recorded as failures, including the
renumbering regression until R2-F8's fix. The detailed result history is in
[test-report.md](test-report.md); all suites repeat in the mandatory candidate.

Build, typecheck, format check and release validation passed. Lint reports zero
errors and 415 advisory warnings. The five additional advisories over the
pre-fix 410 are two exact CLI grammar branches and three workflow test scenario
branches. Every numeric warning in each changed owner has a per-location
baseline comparison and retention reason in the current ignored assessment.
Instruction --describe reports changes: []; no instruction authority is evolved.
All 52 Accepted ADR files match their pre-fix inspection hashes, and the five
immutable inputs match their separate inventory.

Fresh final helper round: `a1c7312c-17cf-42b3-9a8d-41009104c650`. Its required descriptors are exactly
`node packages/orchestrator/scripts/release-candidate-check.mjs` and
`git diff --check`, bound to the unchanged plan in strict mode. Author reports
are finished before execution and stay unchanged afterwards. The terminal
outcomes, fresh physical origins, complete-suite count and matching observed
digests are the authority in
`.banzai/logs/planning-rework-and-review/review-2-fix/final-candidate-result.json`
and its referenced ignored canonical ledger. Final acceptance requires both
passed dispositions; a failed or unavailable result is never a pass.

The frozen driver retains SHA-256
`698a35eebd4a7d5abf992d3ddbbb973d0332d350119fd99e70df57adf33f7eeb`.
The pre-fix source inventory and final exact-byte inventory remain ignored in
review-2-fix. The candidate uses its own index; the real index remains unstaged
and byte preservation is checked. The existing dangling dependency symlink is
held only during that check and restored in finally. Loopback tests execute
outside the sandbox; no credential or model call is involved.

## Security Exposure and Limits

Input/identity rejection precedes persistence. Both new model kinds retain
read-only argv and empty grants. Crash recovery excludes only the runner's
reserved publication path, then re-renders and checks exact bytes. Terminal and
control paths retain escaped presentation, bounded closed input and private
history exclusion. No authority boundary is widened.

Accepted ADR body protection remains instructional/review based. Evaluation/KPI
changes are guard-only. No hosted CI, live-vendor, installation, commit, push or
release publication is claimed. This report does not replace the separate
resolution review or human acceptance.

## Review-3 Fix (2026-10-15)

Review: [review-3.md](review-3.md), verdict `changes_requested`. It verified
R2-F1 through R2-F12 and closed all but R2-F5, whose residuals are R3-F1 and
R3-F2. The owner accepted both in chat on 2026-10-15. Production source,
requirements, the approved plan, Accepted ADR bodies and all review artifacts
are unchanged. The verification above describes the review-2 fix tree; round
`a1c7312c-17cf-42b3-9a8d-41009104c650` is historical pre-review-3-fix evidence.

| Finding | Change | Evidence |
| --- | --- | --- |
| R3-F1 | Added the direct assertions the four overstated citations named: planning retry eligibility by episode step and attempt kind (`workflow/domain/retry-eligibility.test.ts`), the untimed v10 ADR menu (`interactive.test.ts`), the delivered Accepted-ADR immutability rules (`phase-instructions.test.ts`) and successful CLI `review planning`, plan rework and ADR rework routes (`cli-routing.test.ts`). Narrowed and re-cited the FR24 and FR28 rows. | Focused batch below. |
| R3-F2 | The control decide precheck test asserts `INVALID_CONTROL_INPUT` with each refusal's exact message and zero runner mutations, beside a positive control whose valid document reaches exactly one `requestPlanningReview` call. | `agent-control-cli.test.ts`, focused batch below. |

Security exposure: none applies; only tests and reports changed.

Files changed: tests `packages/orchestrator/test/agent-control-cli.test.ts`,
`packages/orchestrator/test/workflow/domain/retry-eligibility.test.ts`,
`packages/orchestrator/test/interactive.test.ts`,
`packages/orchestrator/test/phase-instructions.test.ts` and
`packages/orchestrator/test/cli-routing.test.ts`; reports
`implementation-report.md`, `test-report.md` and this change report.

Documentation sync: no manifest, module or guide fact changed. ADR conformance:
no lifecycle or body change. Engineering Quality deviations: none. Structural
assessment: no trigger applies, because no production code changed.

Verification: the five changed suites passed 126 of 126 tests
(`.banzai/logs/planning-rework-and-review/review-3-fix/focused.log`).
Typecheck, ESLint and Prettier report no problem in the changed files. The
mandatory descriptors run fresh in helper round
`c70e1a90-7b11-416e-9d44-a1eb0cc2ced9` after these reports are final. The
candidate tree includes the separate company-name and copyright edit. Its
terminal outcomes are retained at
`.banzai/logs/planning-rework-and-review/review-3-fix/final-candidate-result.json`
and in the ignored canonical ledger. A failed or unavailable disposition is
not a pass.

Assurance critique: each new assertion protects a stated guarantee that the
cited evidence previously did not demonstrate directly. The precheck refusals
are now attributable through exact messages and the positive control.

## Review-5 Fix (2026-10-15)

Review: [review-5.md](review-5.md), a fresh full review with verdict
`changes_requested`. Its F1 found that the approved T009 assurance for planning
publication ignore and visibility conflicts (`plan.md:1466-1469`) was missing
while T009 was reported complete. The owner accepted F1 in chat on
2026-10-15. [review-4.md](review-4.md) had closed R3-F1 and R3-F2 with verdict
`pass`. Production source, requirements, the approved plan, Accepted ADR
bodies and all review artifacts are unchanged. Round
`c70e1a90-7b11-416e-9d44-a1eb0cc2ced9` (1738 tests, both descriptors passed) is
historical pre-review-5-fix evidence.

| Finding | Change | Evidence |
| --- | --- | --- |
| F1 | A new `planning-review-artifact.test.ts` case drives the real `publishPlanningReviewArtifact` with an existing runner-style candidate. An exact ignore rule hides only `planning-review-1.md`; the case first asserts that the roles-only visibility check still passes, so only the publisher's check of the actual numbered destination can refuse. Two further rules expose the private candidate and the private publication temporary. Each refusal asserts `ARTIFACT_IGNORE_CONFLICT` with its exact message, no destination file and no leftover `*.publication.tmp`; the same fixture then publishes the exact rendered bytes. T009 and FR16 report claims name this evidence. | Focused suite below. |

Regression reasoning: dropping the actual destination from the publisher's
visibility check, or either private ignore check, lets the corresponding case
publish instead of refusing, so its `assert.rejects` fails. This was
established by tracing the guards against the case setup; no source mutation
was run.

Security exposure: none applies; only a test and reports changed. The test
exercises the existing, unchanged Git-visibility and private-evidence controls.

Files changed: test `packages/orchestrator/test/planning-review-artifact.test.ts`;
reports `implementation-report.md`, `test-report.md` and this change report.

Documentation sync: no manifest, module or guide fact changed. ADR conformance:
no lifecycle or body change. Engineering Quality deviations: none. Structural
assessment: no trigger applies, because no production code changed.

Verification: the changed suite passed 4 of 4 tests
(`.banzai/logs/planning-rework-and-review/review-5-fix/focused.log`).
Typecheck, ESLint and Prettier report no problem in the changed file. The
mandatory descriptors run fresh in helper round
`d531c35e-738b-4aad-8d77-a49cafe60fe4` after these reports are final. The
candidate tree includes the separate company-name and copyright edit and review
artifacts 1-5. Its terminal outcomes are retained at
`.banzai/logs/planning-rework-and-review/review-5-fix/final-candidate-result.json`
and in the ignored canonical ledger. A failed or unavailable disposition is
not a pass.

Assurance critique: the case protects the new caller-owned boundary rather
than repeating shared-helper tests; the code-review publisher's equivalent
destination test does not exercise this caller.
