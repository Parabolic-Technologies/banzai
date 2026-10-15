# Implementation Review: planning-rework-and-review

- Format: `banzai-feature-review/v1`
- Feature slug: `planning-rework-and-review`
- Review iteration: `5`
- Verdict: `changes_requested`
- Workspace digest: `not supplied`
- Review artifact: `documentation/work/planning-rework-and-review/review-5.md`

## Review Scope

Fresh-context, standalone full implementation review of the exact existing
`documentation/work/planning-rework-and-review/` binding, requested after
`review-4.md`. This is a full audit of the current approved authority and
implementation, rather than another closure-only review. No planner or
implementer transcript was used. Prior reviews and author reports were read
as required repository evidence; their conclusions were independently checked.

Read the complete `description.md` (FR1-FR42 and all twelve acceptance
stories), `plan.md` (T001-T013, binding assurance and both mandatory final
descriptors), Accepted ADR-0055, `implementation-report.md`, `test-report.md`,
`change-report.md` and reviews 1-4. Read root `AGENTS.md`, `PROJECT_MANIFEST.md`,
the decision index and the relevant module reference and maintained guides.
Assessed the applicable decision constraints for control, context, timing,
review publication, plan authority, instruction evolution, task verification,
Engineering Quality and domain boundaries, including ADR-0018, ADR-0028,
ADR-0030/0050, ADR-0034, ADR-0037/0038, ADR-0042/0044, ADR-0049 and ADR-0052/0054
as amended by ADR-0055.

Applied the explicitly invoked installed Banzai 2.7.1 feature-review skill,
its review guidance and artifact-storage, engineering-quality, test-assurance,
security-assurance and plan-task-completion policies. This is the plugin
source repository: target-project layout recognition does not apply, and
`plugins/**/AGENTS.md` was assessed only as product source.

The source and assertion audit covered these material boundaries:

| Area | Inspected current owners and evidence |
| --- | --- |
| State, authority and completion | `types.ts`, `store.ts`, the complete `planning-review-state.ts`, `state-machine.ts`, pure planning-review/artifact-scope/retry/recovery rules and their focused tests; the author-owned completion table and report narrative. |
| Runner lifecycle | Planning gate commands, all review/analysis/publication/triage/applying branches, scope rehashes, retry/reconciliation and cancellation in `workflow.ts`; attempt lifecycle, result-scope, routing and terminal checkpoints; `planning-review-workflow.test.ts` and recovery tests. |
| Read-only execution | Dedicated adapter methods and full argv/environment fixtures for both vendors, hook denial under actual runner grants, workspace scope rejection, session separation and Accepted-ADR instructions. |
| Contracts and input | Both new JSON Schemas, runtime result/analysis/triage and free-text decoders, control stdin decoding/prechecks, status projections and exact CLI parsers; contract, validation, control and CLI assertions. |
| Publication | `planning-review-artifact.ts`, shared `publishArtifactBytes`, `reviewValue`, work-document membership/inventory, and both planning and code-review publication tests, including exact-byte conflicts and publication crash reconciliation. F1 records the remaining negative-assurance gap. |
| Presentation and instruction delivery | Interactive review scope, feedback, interleaved finding cards/options, default-No confirmations, terminal escaping, prompt filtering and applying evidence; phase resources, retained skill/control protocol and relevant prompt/UI/instruction tests. |
| Evidence and compatibility | Context v2 with v1 readers, human-time anchors and renumbering, cancellation origin/token exclusion, evaluation vocabulary isolation, import permissions, release pins, instruction transitions and maintained-document changes. |

Paths abbreviated in this table are under `packages/orchestrator/src/` or
`packages/orchestrator/test/` unless explicitly identified as plugin resources.
Static inspection and assertions establish the stated local coverage; they
do not constitute execution of those tests.

Input identities at finalization:

| Input | SHA-256 |
| --- | --- |
| `description.md` | `cdf4fbcc00b77409241b1448b30e6b87342154d2f5e9f4a3b332a5e23b4ff0c5` |
| `plan.md` | `0c8cd35204636c2cc604bf65dce667b5c48ce01e1a76f90353b946f3f7d6c22d` |
| `implementation-report.md` | `985baad82400a40a5759a11d3430c3268d970cfb528e0ec1cfbaaf141b7f3caa` |
| `test-report.md` | `5cc4fb412da91a9f71aa3482ceb8c6e9a40e7c0cfaa74d319347b892fc8123f2` |
| `change-report.md` | `d86294af2b4b9937922e2d55ea7c5574299f6301b5808a8a9bd83cb61915747a` |
| ADR-0055 | `ca70c1fc1cebb4b557aa5a8d456de60ff2ffb82db048ac860c127a296d3210a5` |
| `review-4.md` | `3cedf7a8d1a3dc8f89f5cca3f4ef32385c04787812f2c9a81f118f3638e19cf9` |

HEAD is `8a7ff64f578fe78f18e517bc7f9f110d7b937da3` plus the existing working
tree. Hashes for all 555 Git-visible input files were held in memory and
rechecked before creating this artifact; no input changed or disappeared and
no additional file appeared during the review. The selected machine evidence
and installed review resources were also rechecked. The already-present
company-name/copyright work was preserved; its source bytes are included in
the latest candidate's retained inventory.

Verification was inspected read-only, never regenerated:

- Used the existing request
  `.banzai/logs/planning-rework-and-review/review-3-fix/final-verification-request-c70e1a90-7b11-416e-9d44-a1eb0cc2ced9.json`
  with the installed 2.7.1 `verification.cjs inspect` and `decide`. The exact
  binding is this `plan.md`, workflow `strict`, round
  `c70e1a90-7b11-416e-9d44-a1eb0cc2ced9`.
- Retained physical attempts
  `verification-670926ed-60e4-4cc0-ad2c-93c662016c6c`
  (`final-release-candidate`) and
  `verification-1883a5d5-efe4-4206-b8dc-af1506bb975c`
  (`final-diff-whitespace`) are completed with exit 0. Their referenced
  stdout/stderr files match their recorded SHA-256 values. The candidate
  stdout records 1738 tests, 1738 pass, zero fail/cancelled/skipped/todo,
  followed by `release check passed` and `release candidate check passed`.
- The retained result records applicability `complete: true` and both
  dispositions `passed` for observed digest
  `95f16816aef53c3e5b9498a8c41fbdffe5aed989ad5bfb350ac295c0a8e9ea3d`
  and execution context digest
  `ce6dac3506e2d9c52fd244e774d6458f72ca79e4608d166d12b51469a19ef566`.
- Current inspection and decision are `supported: true` but applicability
  `complete: false`, with both required dispositions `unavailable` and
  13 retained physical attempts. The current observed digest is
  `730ea6e472ce37ddb5b75b947de89ab56b2e410d7f780fb58b4045aa65bd5e46`;
  this invocation's context digest is
  `e45a72f9fa95db2fa70bb34db3fdad381c29c4cf4f991109f49a33e5ec7e4339`.
  Both differ from the physical round.
- All 554 content hashes in
  `review-3-fix/stable-final-source-hashes.json` match current files.
  The only extra Git-visible input is `review-4.md`. Reconstructing the
  helper's ordered hash/mode inventory in memory gives the current digest;
  filtering only that entry in memory reproduces the retained observed
  digest exactly. No file was moved, renamed, hidden or modified to do this.
  This establishes the input delta, not current passing applicability:
  the execution-context mismatch remains independently material.

Thus there is real successful physical evidence, but no currently applicable
pass for the two mandatory fresh descriptors. Creating this review adds
another observed input. No test, build, formatter, linter, release gate, model
or vendor invocation, installation, hosted check, commit, push or publication
was run by this reviewer.

## Summary

Changes are requested for one narrow binding-assurance omission: the new
planning publisher lacks the approved visibility/ignore-conflict negative
assertions, while T009 is reported completed with no gap. The production
guards are present and appear correctly wired; this review found no observed
unsafe publication or additional production correctness defect.

The prior accepted fixes remain implemented and their cited assertions are
present. The full audit does not infer completion from immutable unchecked
plan boxes, a prior verdict or the aggregate passing test count. The author-owned
`banzai-plan-task-completion/v1` table is a claim, not a runner-validated
completion ledger. F1 is a substantive contradiction in its binding-assurance
claim. Separately, current mandatory verification applicability is unavailable
and prevents a final pass.

## Findings

### F1 — Complete planning-publication visibility assurance before claiming T009 complete

- Severity: `blocker`
- Category: `test`
- Confidence: `high`
- Evidence: `documentation/work/planning-rework-and-review/plan.md:1466`
  assigns the new planning-artifact suite these explicit duties:
  `ignore and visibility conflicts, symlinked destination`. At
  `plan.md:1731`, the plan makes the behavioral assertions and inspections
  binding coverage requirements and says the command inventory does not
  substitute for them. The complete
  `packages/orchestrator/test/planning-review-artifact.test.ts` has only
  renderer, ordinary create/idempotent/different-content/symlink
  (`:67`) and invalid-UTF-8 conflict (`:142`) scenarios. No call there creates
  an ignore or visibility conflict. The planning workflow fixtures/tests
  likewise contain no filename-specific hidden destination or exposed
  planning-publication temporary-file case.

  The relevant new boundary is
  `packages/orchestrator/src/planning-review-artifact.ts:109`: its callback
  must pass the actual dynamic `planning-review-<N>.md` path as an extra
  visibility path and keep private publication evidence ignored
  (`:114`, `:131`). `plugins/banzai/lib/work-documents.mjs:56` checks fixed
  roles and uses `review-1.md` as the review-directory probe. That probe does
  not detect a Git ignore rule hiding only `planning-review-1.md`.

  Existing shared evidence does not close this gap.
  `packages/orchestrator/test/review-artifact.test.ts:462` tests hidden
  destinations and exposed publication temporaries through
  `publishReviewArtifact`, a different caller with its own destination
  callback (`packages/orchestrator/src/review-artifact.ts:794`).
  Work-document ignore tests exercise binding/helper behavior, not the new
  caller's selection of the dynamic extra path. `publishArtifactBytes`
  delegates destination verification to its caller; it does not choose those
  paths. Removing the extra planning path from the new callback would leave
  the shared-helper and old-publisher assertions intact, and all existing
  planning tests still use non-conflicting ignore rules. This is an uncovered
  observable boundary, not a request to duplicate tests merely by filename.

  Nevertheless `implementation-report.md:297` says its completion projection
  covers binding local assurance and `implementation-report.md:312` marks
  T009 `completed`, gap `null`. `test-report.md:26` retains every per-task
  behavioral obligation; no approved narrowing or alternative assurance
  record is present.
- Violates: approved T009 assurance (`plan.md:1466-1469`) and the binding
  coverage rule (`plan.md:1731-1733`); ADR-0055 Contracts and artifact 5
  and Compliance 6/13; ADR-0054's Git-visible-document/private-evidence
  boundary; Test Assurance's material evidence and truthful-claim rules.
  Primary Engineering Quality overlap, added after severity/verdict froze:
  `EQ-08`.
- Reproduction: static coverage trace; no test or mutation was executed.
  Enumerate references to `publishPlanningReviewArtifact` across the test
  tree, then inspect their fixtures and all ignore-conflict assertions.
  The only direct calls are in `planning-review-artifact.test.ts`; none
  configures a conflict. Compare the old publisher's negative tests with
  the new caller-owned callback. The regression mechanism is a missing or
  wrong actual-path check allowing a planning review to be published under
  a filename-specific hiding rule, or a private publication temporary to
  become Git-visible, without the current planning assertions failing.
- Fix acceptance: add proportionate boundary assertions through the real
  planning publisher for an exact `planning-review-<N>.md` hiding rule while
  fixed work roles remain visible, and for a private planning-publication
  ignore conflict. Use a valid positive fixture, assert the specific
  refusal and preservation/non-publication of destination bytes, and ensure
  no exposed temporary is left. Existing shared tests can stay shared; no
  production refactor is requested. Refresh the reports/completion claim
  from the resulting evidence and run the two approved final descriptors
  fresh on the stable final tree. A report-only wording correction cannot
  discharge this mandatory assurance without the normal approved-plan
  change path.

This finding is blocking because a binding material assurance obligation is
unfulfilled while its task is claimed complete. It does not claim that the
current production guard is absent or that an unsafe publication occurred.
Its stable identity is
`T009|publishPlanningReviewArtifact actual-destination/ignore boundary|binding assurance missing`.
This obligation was not waived, rejected or deferred in prior triage. The
full audit newly assesses this omitted boundary; it does not reopen the
rejected MCP concern, any deferred design observation, or the closed R3 fixes.

## Previously Accepted Findings

- Review-1 F1 remains rejected. The unchanged ADR-0022/MCP decision is not
  reopened. Review-1 F2 is implemented in the planning-review phase and
  directly asserted at `packages/orchestrator/test/phase-instructions.test.ts:27`.
- R2-F1/F2: canonical ADR-rework identity refusal precedes persistence
  (`workflow.ts:3381`); scope digests use plain file SHA-256
  (`workflow.ts:2415`), independently asserted by
  `planning-review-workflow.test.ts:152`.
- R2-F3/F4: hook denial, pure dispatch/restore/state-machine/recovery
  assertions and ADR-rework feedback/legacy/accept-note cases are present
  in their named suites. They cover the previously identified guard and
  compatibility gaps.
- R2-F5: the obligations enumerated in that finding gained the recorded
  argv, scope/checkpoint, prompt/context, timing/cancellation,
  stale/recovery/status, UI/CLI and control assertions. Its four residual
  attribution issues and weak precheck test are addressed by R3-F1/F2.
  This statement does not certify every other T009 duty; F1 above records
  the independently discovered remaining obligation.
- R2-F6/F7/F8: the reserved-path reconciliation scope is recovery-only;
  linked-before-cursor recovery has a no-model-call assertion
  (`planning-review-workflow.test.ts:185`); applying blocks use ordinary
  retry evidence (`:243`); publication-conflict renumbering retains
  corroborated human-time request evidence (`:278`).
- R2-F9/F10/F11/F12: interleaved cards, exact corrected CLI/status strings,
  current state/control/module facts and `INVALID_RESULT` evidence-line
  classification remain present with the cited assertions.
- R3-F1: the untimed v10 ADR menu (`interactive.test.ts:2678`), delivered
  Accepted-ADR immutability (`phase-instructions.test.ts:50`), successful
  rebuilt CLI routes (`cli-routing.test.ts:158`) and direct planning
  retry table (`workflow/domain/retry-eligibility.test.ts:848`) now
  substantiate the corrected citations.
- R3-F2: `agent-control-cli.test.ts:69` has the valid positive control and
  exact `INVALID_CONTROL_INPUT`/message predicates with zero mutations.
  These accepted fixes are verified by current source/assertion inspection
  and retained physical evidence, not a newly executed suite.

## Deferred Coverage

- Both mandatory final descriptors currently have unavailable applicability.
  Retained success applies to its recorded tree/context. This review does
  not manually relabel it, infer equivalence for a fresh check, or hide
  review artifacts to make hashes match. F1 requires its own accepted fix
  and evidence; the applicability gap remains separate.
- Prior unchanged deferred observations remain deferred, including the
  previously discussed event-order/error-wrapper/unsafe-destination edges,
  the retry-label and request-anchor observations, T004's single-path
  completion citation and the unexercised `activeProcess` precheck clause.
  None is promoted into a new finding in this review.
- No new physical failure, crash, timeout, Ctrl+C, live-vendor denial or
  installed-client behavior was induced. Assertions and source were read;
  local recorded results do not establish installation, hosted CI, release
  publication, or owner acceptance.
- The structural assessment and retained numeric-trigger record were
  inspected against the changed owners. Earlier instruction history is
  unchanged; three finite ADR-0055 transitions are appended. Current
  Accepted-ADR diffs are limited to ADR-0054's approved lifecycle annotation
  and ADR-0055's implementation metadata; no decision body changed.
- Ordinary finding, severity and verdict were fixed before Engineering
  Quality overlap classification. No additional EQ-only shadow candidate
  was retained.

## Handoff

Human triage is required for F1: accept, reject or defer it. This review
makes no disposition. Only an accepted finding may enter a subsequent fix;
its bounded scope is publication-boundary assurance and truthful report
evidence. A new implementation defect has not been established.

An authorized implementing/fixing phase owns any needed test changes and
fresh execution of `node packages/orchestrator/scripts/release-candidate-check.mjs`
and `git diff --check`, using the approved descriptors and actual execution
context after all final inputs stabilize. Inspection/decision alone cannot
produce that evidence. Human triage of F1 cannot silently waive those
independently binding final checks.

The reviewer created only this standalone review artifact. Source, tests,
requirements, approved plan, ADRs, reports, configuration, installed tools,
Git index, prior reviews and runner state were left unchanged. This artifact
grants no implementation, acceptance, commit or release authority.
