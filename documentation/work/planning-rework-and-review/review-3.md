# Implementation Review: planning-rework-and-review

- Format: `banzai-feature-review/v1`
- Feature slug: `planning-rework-and-review`
- Review iteration: `3`
- Verdict: `changes_requested`
- Workspace digest: `not supplied`
- Review artifact: `documentation/work/planning-rework-and-review/review-3.md`

## Review Scope

This is a standalone resolution review. It checks whether accepted findings
R2-F1 through R2-F12 from `review-2.md` are closed. The owner accepted all
twelve findings in chat on 2026-10-15. The fixes were already in the working
tree, applied by a separate author session and described in `change-report.md`
(dated 2026-10-14). The review is closure-oriented, not a new full discovery
review. It reports a new concern only when the fix introduced it or when the
changed evidence surface exposes it.

Unchanged inputs, verified by SHA-256:

| Input | SHA-256 |
| --- | --- |
| `description.md` | `cdf4fbcc00b77409241b1448b30e6b87342154d2f5e9f4a3b332a5e23b4ff0c5` |
| `plan.md` | `0c8cd35204636c2cc604bf65dce667b5c48ce01e1a76f90353b946f3f7d6c22d` |
| `review-1.md` | `5b07d0e3ed14a63fc089ba916b67c76aaaadb8a94676ba92f2ec85c3f45e2a98` |
| `review-2.md` | `5310951b94364b8a54f3684e8dcaad577f0c15179a769fc3457cfcb7f2bb06cd` |
| ADR-0055 | `ca70c1fc1cebb4b557aa5a8d456de60ff2ffb82db048ac860c127a296d3210a5` |

**Fix delta.** It was derived by comparing two ignored source-hash inventories:
`.banzai/logs/planning-rework-and-review/stable-final-source-hashes.json`
(pre-fix candidate) and `.../review-2-fix/stable-final-source-hashes.json`
(post-fix candidate). Their 62 differing paths are:

- source: `cli.ts`, `human-time-store.ts`, `interactive.ts`,
  `planning-review-artifact.ts`, `planning-review-state.ts`, `validation.ts`,
  `workflow.ts`, `workflow/attempts/result-scope.ts`,
  `workflow/checkpoints/terminal-checkpoints.ts`,
  `workflow/domain/planning-review.ts` and
  `workflow/domain/retry-eligibility.ts`;
- `import-boundaries.mjs`, `check-release.mjs`, the generated bundle and
  reader library, and `plugins/banzai/contracts/README.md`;
- 38 test files;
- `PROJECT_MANIFEST.md`, `MODULES.md` and `documentation/orchestrator.md`;
- the three author reports.

That complete delta surface was assessed against each finding's fix acceptance.

**Verification evidence**, inspected but not regenerated:

- **Final round.** The author's helper round
  `a1c7312c-17cf-42b3-9a8d-41009104c650` recorded both required dispositions as
  `passed`, in
  `.banzai/logs/planning-rework-and-review/review-2-fix/final-candidate-result.json`:
  - `final-release-candidate`, attempt
    `verification-4f8ac0b9-cc5e-4767-8253-e52714c7638f`;
  - `final-diff-whitespace`, attempt
    `verification-9e72c0ef-bbe0-470b-91d1-8adb83410201`.

  The observed digest was
  `abf7783ba8fbe79c650dc2ec03cdd277652d12e35e5083102038799a2fb0163a`. The
  candidate stdout shows 1734 tests, 1734 pass and 0 fail.
- **Current tree.** A read-only `inspect` for that round now reports both
  checks `unavailable`, with observed digest
  `bd9c63d76a0c66fe986cf00922e0f4412dffa10e9dcadb701c95e1267e8939b9`. After the
  candidate, 13 paths changed and one was added, all from separate concurrent
  company-name and copyright work
  (`documentation/work/company-name-and-copyright/change-report.md`):
  - `NOTICE` (three copies);
  - `README.md`, `CONTRIBUTING.md`, `PROJECT_MANIFEST.md`;
  - `TERMS_OF_USE.md`, `TRADEMARKS.md`;
  - three release-note files;
  - `.claude-plugin/marketplace.json`;
  - `publication-policy.json`.

  None of these is source or test code for this work. `publication-policy.json`
  changed while this review was running.

The reviewer ran no test, build, formatter or model command. Closure was
established by reading source and tests.

## Summary

Eleven of the twelve accepted findings are closed. R2-F5 is only partially
closed, so the verdict remains `changes_requested`.

**Closed by code and tests:**

- R2-F1: canonical ADR id validated before persistence;
- R2-F2: plain SHA-256 scope digests;
- R2-F6: crash reconciliation after publication;
- R2-F7: retry for an applying block;
- R2-F8: human-time after renumbering;
- R2-F9: triage card/menu interleaving;
- R2-F10: CLI and terminal strings;
- R2-F12: evidence-line error code.

**Closed by behavioral assurance:** R2-F3, R2-F4 and R2-F11.

**R2-F5:** every listed obligation now has an assertion, but:

- some report citations still overstate what their cited tests prove (R3-F1);
- one new control precheck test cannot distinguish its intended refusal from
  any other error (R3-F2).

Neither residual leaves a material guarantee unprotected. Both are bounded
corrections. Separately, the passed final round no longer matches the current
tree because of the concurrent copyright work. The mandatory final checks need
a fresh run before final acceptance; see Handoff.

## Findings

### R3-F1 — Four report citations still overstate their test evidence

- Severity: `should_fix`
- Category: `documentation`
- Confidence: `high`
- Evidence: These cited claims are not demonstrated by the cited tests:
  - **FR10, ADR menu "with and without human time".**
    `implementation-report.md:138` makes this claim. The
    ADR menu order is asserted only with human-time controls
    (`packages/orchestrator/test/interactive.test.ts:528-570`). The untimed v10
    menu test covers only the plan gate (`interactive.test.ts:2680-2699`).
  - **FR24, Accepted ADR immutability.** `implementation-report.md:152` cites
    `phase-instructions.test.ts`. No test asserts the Accepted ADR immutability
    rule in `plugins/banzai/phases/planning.md`. `grep` finds no such assertion
    in `phase-instructions.test.ts` or `prompts.test.ts`. The Accepted-ADR
    body inspection is real evidence.
  - **FR28, "exact review/rework routes".** `implementation-report.md:156`
    cites `cli-routing.test.ts`. Every CLI spawn there for
    `review planning`, `approve plan --decision rework` and
    `approve adr --decision rework` is a refusal case (for example
    `cli-routing.test.ts:46-114`, `:158-235`). The successful routes are
    exercised only through the runner, in `planning-review-workflow.test.ts`.
  - **T004 and retry-eligibility "directly tested".** `test-report.md:31`
    cites the retry-eligibility suite for T004. `implementation-report.md:112`
    says the `retry-eligibility.ts` outcomes are "directly tested". However,
    `packages/orchestrator/test/workflow/domain/retry-eligibility.test.ts` is
    byte-identical to `8a7ff64` and has no planning case.

    The new planning branch (`retry-eligibility.ts:100-111`) is protected only
    indirectly, by runner tests: `planning-review-workflow.test.ts:243-276`
    (blocked applying is not eligible), the scope-rejection and stale retries,
    and `workflow-recovery.test.ts`.

  In each case the underlying guarantee is protected elsewhere or is
  instructional by design. That is why this is `should_fix`, not a blocker.
  Only the attribution is inaccurate.
- Violates: review-2 R2-F5 fix acceptance ("The traceability rows cite only
  tests that exercise the named requirement"); Test Assurance (report claims
  only behavior demonstrated by assertions or other recorded evidence).
  Primary Engineering Quality overlap: `EQ-08`.
- Reproduction: compare each cited row with the cited test file. `git diff
  8a7ff64 --stat -- packages/orchestrator/test/workflow/domain/retry-eligibility.test.ts`
  prints nothing.
- Fix acceptance: Each of the four claims either cites the test that actually
  exercises it or is narrowed truthfully. Examples:
  - "ADR order with human time; plan order without";
  - "instructional rule plus Accepted ADR inspection";
  - "runner routes; CLI refusals";
  - "retry-eligibility planning branch covered through runner tests".

  Alternatively, add the missing direct assertions. No other report text needs
  to change.

### R3-F2 — The control decide precheck test cannot fail for the intended reason

- Severity: `should_fix`
- Category: `test`
- Confidence: `high`
- Evidence: `packages/orchestrator/test/agent-control-cli.test.ts:69-133`
  covers T012's foreign, busy and out-of-scope prechecks. Each of its five
  cases calls `assert.rejects(...)` with no error predicate. The test also has
  no positive control proving that the same fixture and document are accepted
  when nothing is wrong.

  Suppose the fixture's status projection or decoding failed for an unrelated
  reason. Every case would still reject, `mutations` would stay 0, and the test
  would pass. So it cannot detect removal of the run-id, gate-status,
  active-attempt or scope-membership prechecks. These are the guarantees R2-F5
  lists for T012: "foreign/busy/scope prechecks … without call/mutation". The
  fix introduced this test, and its evidence is weaker than the
  implementation-report T012 row claims (`implementation-report.md:301`).
- Violates: `plan.md:1640-1651` (T012 assurance: prechecks and refusals with no
  runner call); Test Assurance (reject hollow tests); review-2 R2-F5 fix
  acceptance for T012. Primary Engineering Quality overlap: `EQ-08`.
- Reproduction: static. Make `status()` in the loop throw any unrelated error.
  All five cases still pass.
- Fix acceptance: Each refusal case asserts the expected error, the
  `INVALID_CONTROL_INPUT` code with a distinguishing message, and still asserts
  zero mutation calls. One positive control uses the same fixture and an
  unmodified valid document, and reaches exactly one `requestPlanningReview`
  call.

## Previously Accepted Findings

Closed and verified:

- **R2-F1. ADR id validated before persistence.** `decideAdr` validates a
  rework id before the workflow lock
  (`packages/orchestrator/src/workflow.ts:3381-3399`). The check is
  `validateHumanFreeText(id, 500 bytes)`, then `decisionText` (no CR/LF,
  ≤500), then equality with the raw id. That rule is stricter than the
  persisted `text()` rule (`planning-review-state.ts:47-58`, `:451`), so every
  accepted id persists. Tests:
  - runner: `workflow-review.test.ts:61-101`, with seven non-canonical ids and
    byte-identical state, events and human time, and no adapter call;
  - CLI: `cli-routing.test.ts:82-114`.
- **R2-F2. Plain SHA-256 scope digests.** `gatherPlanningScope`
  (`workflow.ts:2415-2434`) is the single scope-digest producer, and it now uses
  plain SHA-256. Bundle hashing is unchanged.
  `planning-review-workflow.test.ts:152-183` compares the result with an
  independent `createHash("sha256")` of each file and of the artifact.
- **R2-F3. Read-only guards have binding tests:**
  - **hook:** denial for both kinds with the real runner environment across the
    work-directory, decisions, source and planning-artifact targets, plus a
    `plan` denial for the sibling (`hook.test.ts:28-104`);
  - **pure tables:** a dispatch table for every branch and every negative
    restore condition (`workflow/domain/planning-review.test.ts:18-261`);
  - **state machine:** the new edge and the guarded restore, accepted and
    refused (`state-machine.test.ts:8-52`);
  - **recovery:** both kinds excluded (`recovery-eligibility.test.ts:20-29`,
    `digest-rejected-recovery.test.ts:23-34`).
- **R2-F4. ADR rework compatibility break has behavioral tests:**
  - runner rejection, the v10 `adr_rework` record with feedback in the next
    prompt, the legacy state-9 shape, and accept with a null or CR note
    (`workflow-review.test.ts:61-199`);
  - the exact CLI code and message for missing, dangling, empty and whitespace
    notes, and CLI accept cases (`cli-routing.test.ts:46-156`).
- **R2-F5.** Partially closed:
  - every listed obligation now has a behavioral assertion (see the test-report
    matrix and the files named above);
  - the five previously uncited owner files now carry planning assertions;
  - the task table is truthful at task level;
  - the residual citation and precheck issues are R3-F1 and R3-F2.
- **R2-F6. Crash after publication now reconciles.**
  `result-scope.ts:113-126` excludes the path reserved from the episode's
  review number only when `reconcilingPublication` is set or the artifact is
  recorded. `reconcilePlanningAttempt` sets the flag only for a `completed`
  `planning_review` record (`workflow.ts:3246-3254`). That record has already
  passed the strict live scope check (`workflow.ts:6058`) and the terminal
  checkpoint check.

  Publication compares exact bytes. Test `planning-review-workflow.test.ts:185-241`
  rewinds to the linked-but-unrecorded state and resumes: there is no model
  call, the bytes are identical, and there is one publication event. Both
  kinds still reject model writes to the sibling
  (`workflow/attempts/result-scope.test.ts:13-58`).
- **R2-F7. Applying blocks follow ordinary retry rules.** The planning shortcut
  in `retry-eligibility.ts:100-111` covers only `reviewing`, `analyzing`, or no
  active episode with a stale latest closed episode. Test
  `planning-review-workflow.test.ts:243-276` shows that status and `retry`
  agree on the blocked applying result.
- **R2-F8. Human time survives renumbering.** `planning_review.requested` is
  corroborated by `episodeId`, with `1 ≤ reviewNumber ≤ current` and exact
  gate, owner and paths (`human-time-store.ts:672-700`). Other planning
  anchors stay exact.
  - **Conflict-retry journey:** `planning-review-workflow.test.ts:278-336`
    returns no issues.
  - **Forged anchor:** an unknown-episode anchor is still rejected
    (`human-time-store.test.ts:171-207`).
- **R2-F9. Card then menu, per finding.** Each card is rendered immediately
  before its own `Disposition for <id>` menu (`interactive.ts:1081-1100`).
  `interactive.test.ts:433-466` asserts card1 < menu1 < card2 < menu2.
- **R2-F10. Strings and codes match the approved text:**
  - **ADR dangling note:** `INVALID_DECISION` with the exact message
    (`cli.ts:1336-1349`).
  - **Stale retry label:** `Retry planning review` (`interactive.ts:1493-1494`).
  - **Approve-plan dangling note:** follows the selected decision and does not
    swallow the next flag (`cli.ts:343-356`, `:403-407`).
  - **Status:** a single `Next:` line at the triage gate.
  - **HELP:** names gate-decision v1 and answer v4, and the loop sentence is
    corrected (`cli.ts:257-267`). Pins are preserved.

  Tests: `cli-routing.test.ts:46-81`, `:167-182`, `:237-269`.
- **R2-F11. Documentation facts current:**
  - `PROJECT_MANIFEST.md` describes state v10;
  - the `workflow.ts` entry lists the new commands and executors;
  - the three new modules have section 5 entries;
  - the section 6 gate bullet describes the loop;
  - the paragraph after the ADR index is gone;
  - `documentation/orchestrator.md:533-534` and `:1685` are corrected.
- **R2-F12. Evidence-line error code.** `evidence.line` now uses
  `INVALID_RESULT` (`validation.ts:798-805`), while configuration callers keep
  `INVALID_CONFIG`. `planning-review-contracts.test.ts:19-33` asserts the code.

Review-1 F1 stays rejected and was not reopened. Review-1 F2's
phase-instruction assertions are now present
(`phase-instructions.test.ts:27-49`).

## Deferred Coverage

- **Final checks not current.** The mandatory final checks are not current for
  this tree. Round `a1c7312c-17cf-42b3-9a8d-41009104c650` passed against
  observed digest `abf7783b…0163a`. The current tree differs because of the
  separate copyright work described in Review Scope, and that session was still
  editing during this review. This is not a defect in the fixes. Final
  acceptance still requires a fresh run of both required descriptors on the
  final combined tree.
- **Low-severity observations, not elevated.** Each is pre-existing or harmless:
  - **Retry label.** `interactive.ts:1493` labels a retry "Retry planning
    review" whenever the latest closed episode is stale, even while a newer
    episode is active at `applying` with a failed plan attempt. Retry
    eligibility and dispatch use the correct condition. Only the label is
    affected. The condition predates the fix, which changed only the string.
  - **Session announcement.** `planning-review-adapters.test.ts:194-211`
    checks early session announcement only for analysis. The plan requires it
    only for analysis (`plan.md:1266-1267`), so the review-kind check is
    vacuous but not required.
  - **FR27 test setup.** `planning-review-workflow.test.ts:38-97` builds its FR27
    premise by writing a constructed state. Its digest, snapshot and byte
    assertions remain meaningful.
  - **Weak regex.** `prompts.test.ts:79` uses an alternation regex. Path and
    hash presence are asserted separately.
  - **Human-time lower bound.** `human-time-store.ts:689-691` accepts any
    earlier review number for the same episode's `requested` event.
- **No commands rerun by the reviewer.** No live vendor, installation, hosted
  CI or release publication is covered, and the reviewer reran no test.
- **Engineering Quality shadow.** Ordinary findings were frozen first. No
  EQ-only shadow candidate was retained.

## Handoff

Human triage is required for R3-F1 and R3-F2. Both are bounded:

- **R3-F1:** correct or narrow four report citations.
- **R3-F2:** strengthen one test with error predicates and a positive control.

Neither changes production behavior.

After any fix, and in any case before final acceptance or commit, rerun both
mandatory descriptors fresh on the final combined tree:

- `node packages/orchestrator/scripts/release-candidate-check.mjs`;
- `git diff --check`.

That tree also includes the concurrent copyright work, so coordinate with that
session so the tree is stable during the run.

This reviewer changed no source, tests, requirements, plan, ADRs, reports,
configuration or runner state. This review file is the only repository file it
created.
