# Test Report: Planning Rework and Independent Planning Review

Slug: `planning-rework-and-review`. Date: 2026-10-15.
The approved [plan](plan.md) and [requirements](description.md) remain unchanged.
This report replaces pre-fix assurance claims following Opus's
[review-2.md](review-2.md), verdict `changes_requested`. The owner authorized
selected fixes; R2-F1 through R2-F12 are accepted for remediation. Resolution
review [review-3.md](review-3.md) left R3-F1 and R3-F2, both accepted by the
owner on 2026-10-15 and addressed below; [review-4.md](review-4.md) closed them.
The fresh full review [review-5.md](review-5.md) found missing T009
publication-boundary assurance (its F1), accepted by the owner on 2026-10-15
and addressed below. Independent resolution review and human acceptance remain
separate phases.

## Risk and Contract Assessment

The principal risks are unauthorized writes, accidental approval, stale reviewed
bytes, partial/replayed triage, publication overwrite, crash/session continuity
errors, invalid persisted identities and control-text corruption. Their owners
are the existing codecs, pure domain rules, hook, workspace scope, atomic
publisher and serialized runner. Both new model kinds are read-only. Applying
retains ordinary planning authority, and Accepted ADR body protection remains
instructional/review based. Local/fake evidence proves invocation construction
and runner checks, not live-vendor enforcement. Evaluation/KPI work is guard-only.

## Binding Assurance

All per-task behavioral obligations remain binding. No report edit waives one.
Paths below are relative to packages/orchestrator/test unless qualified.

| Task | Assertions and inspected evidence | Owners |
| --- | --- | --- |
| T001 | Finite authorized ADR images and exact instruction-transition scope; accepted bodies retained. | release-validation.test.ts; import-boundaries.test.ts; 52-file inspection |
| T002 | Closed objects, finding/option bounds, ordered scope/result binding, whole-answer atomic validation, exact byte/control/bidi/surrogate rules, reviewer line error code. | planning-review-contracts.test.ts; validation.test.ts |
| T003 | State v10 round trip, distinct active/closed slots, historical readers and refusal of v10 shapes on older schemas, plus identity/replay checks. Both read-only kinds deny work/decision/source targets and planning artifacts with the actual runner grants; plan cannot write a planning-review sibling. | store.test.ts; hook.test.ts; lifecycle, evidence, snapshot, doctor and release suites; unchanged characterization traces |
| T004 | Pure dispatch/restore tables and every structural negative, bounded numbering/gaps/names, exact scope and stale facts; new rework edge and guarded restore; planning retry decisions by episode step and attempt kind, with applying blocks left ordinary; no mutable or digest-rejected recovery authority. | workflow/domain/planning-review.test.ts; state-machine.test.ts; retry-eligibility, failure-classes, recovery-eligibility, digest-rejected-recovery, artifact-scope and human-decisions suites |
| T005 | All eight full argv cases across both vendors, fresh/resumed review/analysis, exact environment/schema, early session announcements; writes to plan, documentation, source and planning artifact refused for both kinds; own checkpoint contract and role. | planning-review-adapters.test.ts; workflow/attempts/result-scope.test.ts; workflow/checkpoints/terminal-checkpoints.test.ts; workflow/domain/routing.test.ts; validation.test.ts |
| T006 | Ordinary-finding threshold, EQ-only exclusion and both examples; prompt categories/filter/read-only override and exact immutable applying evidence; context v2 kinds/roles and v1 rejection; reviewer phase union and preflight before any model/attempt. | phase-instructions.test.ts; prompts.test.ts; context-accounting.test.ts and report siblings; doctor.test.ts; workflow-project.test.ts; publication, release, skill, smoke and import suites |
| T007 | Gate opened/requested, triage pending/answered, origin restored/approved, exact machine-time exclusion; plan rework, stale supersession and forged/renumbered anchors; cancellation origin and unsupported availability; exact planning token exclusion from cancellation v1 model inventory. | human-time.test.ts; human-time-store.test.ts; planning-review-workflow.test.ts; cancellation.test.ts; cancellation-report.test.ts |
| T008 | Invalid rework feedback/ADR ids preserve state/events/human-time bytes and cause no adapter call; exact ADR v10 record/next prompt, optional accept null/CR notes and legacy shape; successive plan reworks retain earlier answers/ADR feedback. | workflow-review.test.ts; planning-review-workflow.test.ts; cli-routing.test.ts |
| T009 | Deterministic/private-safe exact-byte create-only publication and invalid UTF-8 conflict; real-publisher refusal of the actual hidden numbered destination while fixed roles stay visible, and of exposed private candidate/temporary evidence, each with no destination or leftover temporary, beside a positive control; bounded work inventory; independent plain SHA-256; conflict renumber, both publication crash cursors, stale points and missing/symlink restart; no ordinary plan during read-only/triage; retained approval digest/snapshot/paths and fresh code-review R1 namespace. | planning-review-artifact.test.ts; work-documents.test.ts; planning-review-workflow.test.ts; workflow-recovery.test.ts; unchanged code-review artifact/result suites |
| T010 | Exact three mixed dispositions and complete immutable analysis reach applying; all-declined guarded restore has no model call; whole-answer/replay refusal; failed and interrupted read-only/applying retries, session rebinding, escalation after applying changed bytes, cancellation/status/events and exact ordered-answer refusal. | planning-review-workflow.test.ts; workflow-recovery.test.ts; human-time-store.test.ts |
| T011 | Exact plan and ADR menus with/without timing, default-No confirmations, full card/menu interleaving, C0/C1/bidi escaping and model Exit labels, Ctrl+C/EOF at all new prompts, declined confirmation reappears unchanged; real checkbox validation; rebuilt CLI exact grammars/diagnostics, successful review/rework routes, one Next line and smoke HELP. | interactive.test.ts; inquirer-io.test.ts; cli-routing.test.ts; committed-smoke.test.ts |
| T012 | Status v6 plan/ADR/triage projections including null ADR description and privacy canaries; exact decide direct-stdin grammar, v1 refusal before factory, foreign/busy/scope prechecks with exact refusal codes/messages beside a valid positive control, and over-limit escaped answer without call/mutation; negotiated supervisor identities, raw UTF-8 and non-inference. | agent-control.test.ts; agent-control-cli.test.ts; workflow-skills.test.ts; release-validation.test.ts |
| T013 | Owner-selected 2.7.1, current maintained facts and exact release pins, unchanged accepted bodies, synchronized generated resources/bundle and final author reports; required fresh candidate and whitespace descriptors. | release-validation.test.ts; final bound helper round below |

FR1-FR42 map to concrete assertions in
[implementation-report.md](implementation-report.md#requirement-traceability).
US1-US12 and ADR-0055 Compliance 1-13 retain the approved meanings. The MCP
whitelist remains ADR-0022's construction; owner-rejected review-1 F1 is not
reopened. Accepted review-1 F2's phase instruction assurance is now explicit.

## Executed Supplemental Evidence

Raw records are retained under
`.banzai/logs/planning-rework-and-review/review-2-fix/`.

| Record | Result | Meaning |
| --- | --- | --- |
| regression-1.log | 106 tests, 97 pass, 9 fail | Retained initial failures: stale-point test assertions and request-anchor renumbering. |
| regression-2.log | 49 tests, 48 pass, 1 fail | Stale boundaries pass; renumbering still failed. |
| regression-3.log | 230 tests, 222 pass, 8 fail | Retained control/UI/store fixture failures and renumbering regression. |
| regression-4.log | 386 tests, 384 pass, 2 fail | Broad regression: prior failures fixed, including renumbering; new clock and action-name fixture assumptions corrected afterwards. |
| regression-5.log | 9 tests, 6 pass, 3 fail | Timing/status/checkpoint/forged-anchor assertions pass; interrupted-attempt fixture incorrectly expected a persisted status label. |
| regression-6.log | 3 tests, 3 pass | Interrupted review and analysis resume only their own step, with no model call on reconciliation or renumbering. |
| regression-7.log | 400 tests, 400 pass | Current control/UI/contracts/prompt/ADR/publication/release regression; zero fail/cancelled/skipped. |
| regression-8.log | 3 tests, 1 pass, 2 fail | Stronger exact applying/prior-record assertions exposed fixture envelope/default-resume assumptions, corrected afterwards. |
| regression-9.log | 3 tests, 3 pass | Exact applying envelope and successive prior-feedback/answer journey pass. |

The full 386-test batch's two failed assertions were rechecked successfully in
regression-5; its other 384 results remain passed. Later source fixes are covered
by regression-7 and regression-9, and all suites are repeated by the final
candidate. Failed records are retained as failures, never relabeled as passes.
The earlier 1628-test release candidate belongs to the pre-fix implementation;
it is historical evidence and does not establish current applicability.

The review-3 fixes change only five test files and these reports. Their record
is `.banzai/logs/planning-rework-and-review/review-3-fix/focused.log`: 126 tests,
126 pass, zero fail/cancelled/skipped/todo across `agent-control-cli`,
`workflow/domain/retry-eligibility`, `interactive`, `phase-instructions` and
`cli-routing`. Typecheck, ESLint and Prettier report no problem in those files.

The review-5 fix changes only `planning-review-artifact.test.ts` and these
reports. Its record is
`.banzai/logs/planning-rework-and-review/review-5-fix/focused.log`: 4 tests,
4 pass, zero fail/cancelled/skipped/todo. Typecheck, ESLint and Prettier
report no problem in that file.

`npm run build`, `npm run typecheck`, `npm run format:check` and
`npm run release:validate` passed. ESLint JSON execution reports zero errors
and 415 advisory warnings; 204 complexity and 204 nested-ternary warnings globally; numeric diagnostics
in changed owners are assessed, and seven retained no-base-to-string warnings
are unchanged. Every
numeric diagnostic in a changed owner has a per-location comparison and
retention reason in `numeric-trigger-assessment.json`. Instruction baseline
`--describe` reports no changed keys. The earlier malformed standalone `--check`
invocation is retained as an invalid invocation; build/release parity and the
empty transition description are the applicable evidence.

All 52 Accepted ADR files match the hashes from the pre-fix decision-body
inspection. Requirements, plan, both review artifacts and ADR-0055 match the
separate immutable-input inventory. Root manifest/module/guide facts and
release pins are inspected for state v10 and capabilities schema 8.

## Mandatory Final Evidence

Fresh helper round: `d531c35e-738b-4aad-8d77-a49cafe60fe4`. Exact binding:
`documentation/work/planning-rework-and-review/plan.md`, workflow `strict`.
Round `a1c7312c-17cf-42b3-9a8d-41009104c650` passed both descriptors with 1734
tests on the pre-review-3 tree and is historical pre-review-3-fix evidence.
Round `c70e1a90-7b11-416e-9d44-a1eb0cc2ced9` passed both descriptors with 1738
tests on the pre-review-5 tree and is historical pre-review-5-fix evidence. The
candidate tree also contains the separate company-name and copyright edit and
review artifacts 1-5.

| Descriptor | Command | Evidence source |
| --- | --- | --- |
| final-release-candidate | `node packages/orchestrator/scripts/release-candidate-check.mjs` | Fresh physical attempt and applicability in final-candidate-result.json |
| final-diff-whitespace | `git diff --check` | Fresh physical attempt and applicability in the same result |

Author reports are finalized before that round runs and stay byte-identical
thereafter. The authoritative terminal outcomes, aggregate test count,
publication inventory and exact before/after source digest are retained at
`.banzai/logs/planning-rework-and-review/review-5-fix/final-candidate-result.json`
and its referenced ignored physical stdout/stderr. Final acceptance requires
both dispositions to be passed with fresh physical origins and matching
observed digests. A failed or unavailable descriptor is not a pass. This avoids
post-run report edits invalidating the final round, as occurred before review-2.

The frozen driver SHA-256 is
`698a35eebd4a7d5abf992d3ddbbb973d0332d350119fd99e70df57adf33f7eeb`.
The candidate uses a disposable index and source inventory. The existing dangling
node_modules link is held only during that check and restored in `finally`;
loopback tests run outside the sandbox. The real index is not staged and its
byte preservation is checked. The helper ledger stays ignored beneath
`.banzai/verification/26e24f88d11b73aec42ad3c9f5fe128965ddc8985c89647caa689d4f647e1ec8/`.

## Limits and Review Boundary

These are author-run local/fake checks. No installation, hosted CI, live vendor,
credentials, commit, push or release publication is claimed. Body protection
remains instructional/review based, and no runtime immutability claim is made.
Review-2, review-3 and review-5 remain immutable with their `changes_requested`
verdicts, and review-4 with `pass`; a separate resolution review and human
acceptance are still required.
