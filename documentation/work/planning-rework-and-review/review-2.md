# Implementation Review: planning-rework-and-review

- Format: `banzai-feature-review/v1`
- Feature slug: `planning-rework-and-review`
- Review iteration: `2`
- Verdict: `changes_requested`
- Workspace digest: `not supplied`
- Review artifact: `documentation/work/planning-rework-and-review/review-2.md`

## Review Scope

This is a standalone implementation review, requested by the owner, of
`documentation/work/planning-rework-and-review/implementation-report.md`. It
reviews the implementation against the approved bundle. It is not plan
approval, human triage or release acceptance. The earlier `review-1.md` was a
planning-readiness review of the plan.

Inputs reviewed:

| Input | SHA-256 |
| --- | --- |
| `description.md` | `cdf4fbcc00b77409241b1448b30e6b87342154d2f5e9f4a3b332a5e23b4ff0c5` |
| `plan.md` | `0c8cd35204636c2cc604bf65dce667b5c48ce01e1a76f90353b946f3f7d6c22d` |
| `implementation-report.md` | `8ce3eeb87546dc248e5adb8bfcbde5d7782ffe8381863f47282a5cc23c7c6ba1` |
| `test-report.md` | `8cd8db658e048ba2e0898034780ce97b1037bd32f1461e0871262f542a9b0449` |
| `documentation/decisions/0055-planning-gate-rework-and-independent-planning-review.md` | `ca70c1fc1cebb4b557aa5a8d456de60ff2ffb82db048ac860c127a296d3210a5` |

Further scope:

- `review-1.md`, the decision log and ADR-0054/0055 diffs, the root
  `AGENTS.md` and `PROJECT_MANIFEST.md`, and `packages/orchestrator/MODULES.md`;
- the full uncommitted diff against baseline HEAD
  `8a7ff64f578fe78f18e517bc7f9f110d7b937da3`: about 5,900 changed lines
  outside `dist/`, plus the new source, schema, phase and test files listed by
  `git status`;
- maintained documentation and release notes `documentation/releases/2.7.1.md`.

Applied: the installed review guidance and the artifact-storage,
engineering-quality, test-assurance, security-assurance and
plan-task-completion policies. This is the plugin source repository, so
target-project layout recognition does not apply.

Verification evidence was inspected, not regenerated:

- **Helper.** The installed `verification.cjs` v3 `inspect` and `decide` ran
  read-only for `documentPath` `documentation/work/planning-rework-and-review/plan.md`,
  `workflow: strict` and round `90f777b9-3c9b-46c8-98e4-837e8fa3208f`. Both
  returned `supported: true`. Both required checks are now `unavailable`,
  because the current observed digest
  (`28a49af0667af3e427de4f6258c6a62d68090164f5f7b4221724065efbace619`) differs
  from the attempts' before/after digest
  (`57856666a49c09015fa46b375613fa80f3e9f2a4448089b06a8ebda118ae5483`).
- **Source drift since the run.** The ignored recorded source-hash inventory
  `.banzai/logs/planning-rework-and-review/stable-final-source-hashes.json` was
  compared with the current tree. Only `implementation-report.md` and
  `test-report.md` differ, with no missing or new files. This matches the
  report's statement that only author-report bytes changed after the run.
- **Release candidate.** The retained stdout of attempt
  `verification-96136f7b-6b9e-4b47-913e-98d64eec4b73` (exit 0) shows 1628
  tests, 1628 pass and 0 fail/cancelled/skipped. It ends with
  `release check passed` and `release candidate check passed`.
- **Whitespace check.** Attempt
  `verification-b8800b66-1277-4add-8b20-33bc71213a6f` exited 0.

The reviewer ran no tests, build, formatter, installation or vendor/model
invocation. Every finding below rests on static tracing of the current source.

## Summary

Changes are requested. The source passes the complete release gate, and much of
the design is implemented as planned. That includes:

- closed contracts and decoders;
- the shared free-text validator;
- create-only publication;
- read-only adapter argv;
- the hook denial clause;
- stale rehash points;
- separation from code review;
- control 8.0.0 identities.

However:

- **Two blocking correctness defects.** A non-canonical ADR id on CLI ADR
  rework persists a state that every later read rejects. Scope digests are
  domain-separated hashes labeled `sha256`, contrary to FR16 and the plan's
  explicit digest rule.
- **Missing binding assurance.** The plan makes its per-task behavioral
  assertions binding coverage requirements (`plan.md:1731-1733`). Many of them
  are absent, including:
  - the hook denial;
  - the guarded restore transition;
  - ADR rework;
  - stale points after publication;
  - terminal escaping on the new prompts;
  - the control status projections.

  The implementation report still records every task as completed with its
  bound assurance, and it cites unchanged test files as evidence.
- **Lifecycle defects.** Three runner paths fail: crash reconciliation after
  publication, retry advertised at the `applying` step, and human-time
  evidence after renumbering.
- **Smaller defects.** There are presentation and string deviations, plus stale
  documentation facts.

## Findings

### R2-F1 — CLI ADR rework with a non-canonical id writes an unreadable run state

- Severity: `blocker`
- Category: `correctness`
- Confidence: `high`
- Evidence: The defect runs from CLI input to persisted state:
  1. `packages/orchestrator/src/cli.ts:1340` passes the raw `--id` value to
     `decideAdr`.
  2. On state v10, `packages/orchestrator/src/workflow.ts:3402-3412` appends
     `{ kind: "adr_rework", adrId: input.id, ... }` without validating the id.
  3. The only id check, at `workflow.ts:3413`, rejects just an empty trimmed
     value.
  4. `store.ts:1618-1641` (`writeState`) persists the state unvalidated.
  5. Every later read runs `validatePlanningReviewState`
     (`store.ts:310`). That validator checks `record.adrId` with `text()`
     (`packages/orchestrator/src/planning-review-state.ts:47-58`, `:451`), which
     requires the value to equal its trimmed form, be at most 500 characters,
     contain no CR/LF and pass the shared free-text rule.

  So an id such as `"ADR-0001 "`, an id longer than 500 characters, or one
  containing a bidi or control character is written. The run then fails with
  `STATE_READ_FAILED` everywhere: the auto-resume write, `banzai status`,
  `banzai resume` and `banzai cancel`. Agent control is not affected, because
  it limits `adrId` to projected canonical ids.
- Violates: `plan.md:161-162` (human text in records passes the shared rule);
  `plan.md:374-377` (rejection before any state change); FR22/FR33 input
  validation intent; ADR-0055 Compliance 8 (identity and byte failures before
  mutation). Primary Engineering Quality overlap: `EQ-04`.
- Reproduction: static trace. On a v10 run at `needs_adr_approval`, run
  `banzai approve adr --id "ADR-0001 " --decision rework --note "x"`. The state
  is written with `adrId: "ADR-0001 "`, and the next state read throws
  `STATE_READ_FAILED`.
- Fix acceptance: An ADR rework request whose id would not pass persisted
  validation is rejected before the lock or under it, with no state, event or
  human-time change. Either restrict the id to the pending gate's ADR ids, or
  validate it with the same rule the store applies. Both have to agree for
  every accepted id. A focused test drives a non-canonical id through the
  runner (and CLI), then asserts rejection and byte-identical `state.json` and
  `events.jsonl`.

### R2-F2 — Planning scope digests are domain-separated hashes labeled `sha256`

- Severity: `blocker`
- Category: `spec`
- Confidence: `high`
- Evidence: `packages/orchestrator/src/workflow.ts:2416-2429`
  (`gatherPlanningScope`) computes each scope entry with `hashArtifactBytes`
  (`packages/orchestrator/src/git.ts:139-145`). That is SHA-256 over
  `"file" + "\0" + bytes`, the domain-separated bundle hash. These values become:
  - the persisted episode `scope[].sha256`;
  - the reviewer's required scope echo;
  - the rendered Git-visible `## Reviewed Scope` section of
    `planning-review-<N>.md` (`packages/orchestrator/src/planning-review-artifact.ts:62-64`);
  - the status projection.

  Meanwhile `artifact.sha256` in the same module uses plain SHA-256
  (`planning-review-artifact.ts:92`). The tests build the reviewer result from
  `episode.scope`, so they cannot notice the difference.
- Violates: `plan.md:355-357` ("plain SHA-256 of the file bytes … they are not
  the domain-separated artifact-bundle hash"); FR16 (the artifact names each
  reviewed path with its SHA-256); user story 4 (the artifact lists the paths
  "with their SHA-256 values"); FR14/US8 wording of before/after SHA-256.
  Primary Engineering Quality overlap: `EQ-04`.
- Reproduction: static. For any reviewed file, `shasum -a 256 <file>` differs
  from the `sha256` that the episode, the published artifact and status record
  for it.
- Fix acceptance: scope, staleness and rendered reviewed-path digests use plain
  lowercase SHA-256 of the file bytes. Do this before state v10 and
  `banzai-planning-review/v1` are released. A test asserts that a published
  artifact's reviewed-path `sha256` equals an independently computed
  `createHash("sha256").update(fileBytes)` value. Stale detection keeps working.

### R2-F3 — The read-only and authority guards lack their binding assurance

- Severity: `blocker`
- Category: `test`
- Confidence: `high`
- Evidence: `plan.md:1731-1733` declares the per-task behavioral assertions
  binding coverage requirements. These safety-critical obligations are missing:
  - **T003, `plan.md:1205-1209`.** It requires `hook.test.ts` to assert
    denial while `planning_review` or `planning_analysis` is active, with the
    runner environment shape, for targets in the work directory, the decisions
    directory and the source tree. It also requires `planning-review-<N>.md` to
    be denied to `plan` and both kinds.

    The hook clause exists (`plugins/banzai/hooks/spec-gate.cjs:307`), but
    `packages/orchestrator/test/hook.test.ts` changed only two
    `schemaVersion: 9` → `10` fixtures (`:695`, `:833`). No test mentions a
    planning kind. `planning-review-workflow.test.ts:419-446` exercises only
    the runner's after-the-fact scope detection.
  - **T004, `plan.md:1250-1259`.** It requires pure fact tables for dispatch
    and restore eligibility, plus `state-machine.test.ts`,
    `recovery-eligibility.test.ts`, `digest-rejected-recovery.test.ts` and
    `artifact-scope.test.ts` coverage.
    `packages/orchestrator/test/workflow/domain/planning-review.test.ts` never
    imports `planningReviewDispatch` or `planningRestoreEligible`, and those
    test files are unchanged. Nothing tests:
    - the new `needs_plan_approval → planning` edge;
    - the structural guard that alone admits
      `needs_human_decision → needs_*_approval` (`state-machine.ts:103-109`),
      including its refusal for actionable or mismatched triage;
    - the recovery exclusions for both kinds.

  The current evidence cannot detect a regression in any of these:
  - a reordered hook clause that admits writes, leaving only post-hoc
    detection, which does not deny the write that FR14 forbids;
  - a guard predicate that admits an actionable or foreign triage restore,
    bypassing application;
  - an inconsistent dispatch.
- Violates: `plan.md:1202-1213` (T003 assurance) and `plan.md:1250-1260` (T004
  assurance); FR14, FR26, US8; ADR-0055 Compliance 1, 4 and 9; Test Assurance
  (authorization and state-transition guarantees). Primary Engineering
  Quality overlap: `EQ-08`.
- Reproduction: `grep -n planning packages/orchestrator/test/hook.test.ts`
  returns nothing. `git diff 8a7ff64 --stat` shows `state-machine.test.ts`,
  `recovery-eligibility.test.ts`, `digest-rejected-recovery.test.ts` and
  `artifact-scope.test.ts` unchanged.
- Fix acceptance: Hook tests assert denial, with the runner environment shape,
  for both kinds and all three target classes, and denial of the planning
  artifact to `plan` and both kinds. Pure tests cover dispatch rows and
  restore eligibility, including every negative condition of
  `planningRestoreEligible`. State-machine tests cover the new edge and the
  guarded restore, accepted and refused. Recovery tests confirm both kinds stay
  excluded. Alternatively, record an approved plan change that narrows these
  obligations.

### R2-F4 — The ADR rework compatibility break has no behavioral assurance

- Severity: `blocker`
- Category: `test`
- Confidence: `high`
- Evidence: The intentional break (ADR rework requires non-empty feedback) has
  binding obligations:
  - T008 (`plan.md:1414-1428`): runner rejection without feedback, the
    `adr_rework` record, feedback reaching the next plan prompt, and ADR
    accept with no note and with a CR note in `workflow-review.test.ts`;
  - T011 (`plan.md:1592-1594`): CLI accept with no note and with a CR note;
  - US3 (`description.md:333-338`): the exact CLI message
    `ADR rework requires a non-empty --note.`

  None exists:
  - no test file contains `adr_rework` or the exact CLI message;
  - `workflow-review.test.ts` is unchanged;
  - `workflow.test.ts:1708` only changed an existing note from `null` to text;
  - the test named "plan and ADR rework preserve feedback as inert planning
    evidence" (`planning-review-workflow.test.ts:267-300`) exercises only plan
    rework.

  The gap let R2-F1 and the dangling-`--note` error-code defect in R2-F10 go
  unnoticed. The implementation report nevertheless states, for "US1-US3:
  required-feedback rework and exact CLI refusals; … Evidence is in the
  focused planning suites" (`implementation-report.md:163-169`).
- Violates: `plan.md:1422-1428`, `plan.md:1586-1601`; FR7, FR8, FR9; US2, US3;
  Resolved Assumption 2; Test Assurance (report claims only demonstrated
  behavior). Primary Engineering Quality overlap: `EQ-08`.
- Reproduction: `grep -rn "adr_rework\|ADR rework requires" packages/orchestrator/test`
  returns no matches.
- Fix acceptance: Behavioral tests cover:
  - runner rejection without valid feedback, with byte-identical state and
    events and no adapter call;
  - the v10 `adr_rework` record, and the feedback in the next plan prompt;
  - legacy-shape behavior below v10;
  - the exact CLI code and message for missing, dangling, empty and whitespace
    notes;
  - ADR accept with no note and with a CR note, through the runner and CLI.

  The report's US3 evidence claim then cites them.

### R2-F5 — Task completion and traceability claims overstate assurance

- Severity: `blocker`
- Category: `documentation`
- Confidence: `high`
- Evidence: `implementation-report.md:267-285` records T001–T013 as
  `completed`, with "implemented behavior and its bound assurance are
  described above". Beyond R2-F3 and R2-F4, these binding obligations have no
  matching assertion:
  - **T005 (`plan.md:1301-1307`):**
    - full argv fixtures for both vendors, fresh and resumed;
    - early session announcement;
    - `result-scope` rejection of `plan.md` and documentation paths;
    - routing and checkpoint contract selection.
  - **T006 (`plan.md:1361-1369`):**
    - phase-instructions assertions that the planning-review text delivers the
      ordinary-finding threshold, the EQ-only exclusion and both examples
      (the assurance carried from accepted review-1 F2);
    - planning prompt envelopes, the category filter and applying evidence;
    - context ledger v2 planning kinds and v1 rejection;
    - the doctor reviewer union;
    - instruction preflight.
  - **T007 (`plan.md:1399-1403`):**
    - human-time journeys: gate restored, plan rework, stale supersession,
      machine time excluded;
    - forged anchors;
    - the cancellation origin gate;
    - the cancellation-report exclusion.
  - **T009/T010 (`plan.md:1471-1543`):**
    - the stale points `before_publish`, `before_triage`, `triage_answer`,
      `before_apply` and `before_restore`;
    - publication-conflict re-reservation;
    - no `plan` attempt during reviewing, analyzing or awaiting triage;
    - FR27 approval digest and snapshot unchanged;
    - the next code review fresh as `review-1.md`/`R1-F*`;
    - an applying attempt that escalates without a stale block;
    - a failed applying retry;
    - status projection cases;
    - the precise `answerHumanDecision` error;
    - `workflow-recovery.test.ts` retries by step.
  - **T011 (`plan.md:1586-1601`):**
    - menu order with human time;
    - C0/C1/bidi escaping in the new triage lines and choice names (FR34);
    - Ctrl+C at every new prompt;
    - a model label starting with `Exit`;
    - `inquirer-io` multi-select;
    - `banzai review planning` grammar;
    - the smoke HELP check.
  - **T012 (`plan.md:1640-1651`):**
    - status v6 projections for v10 plan/ADR gates (including a null ADR-gate
      description) and the triage gate, with privacy canaries;
    - `control decide` CLI grammar, prechecks and v1 refusal with no runner
      call;
    - no mutation and no runner call for an over-limit escaped answer.

  The traceability table (`implementation-report.md:142-157`) also cites
  `store.test.ts`, `work-documents.test.ts`, `workflow-recovery.test.ts`,
  `cancellation.test.ts` and `human-time-store.test.ts` as assurance for FR25-FR27
  and FR37-FR40. Those files are byte-identical to `8a7ff64` and never mention
  the new state, records or kinds. `test-report.md:39-40` says
  `interactive.test.ts` covers "exact menu order", but only the variant without
  human time is tested.
- Violates: `plan.md:1731-1733` (binding coverage requirements); the
  plan-task-completion policy (false success claims remain actionable;
  structural validity does not prove fulfillment); Test Assurance (claims only
  what assertions demonstrate). Primary Engineering Quality overlap:
  `EQ-08`.
- Reproduction: `git diff 8a7ff64 --stat -- packages/orchestrator/test` and
  `grep -rln "planning_review\|planningReview\|planning-review" packages/orchestrator/test`.
  The named owner files above are absent from both outputs.
- Fix acceptance: Each listed binding obligation either gains a behavioral
  assertion or is narrowed through the approved plan-change path. A report
  correction cannot discharge a mandatory obligation. The traceability rows
  cite only tests that exercise the named requirement. The task completion
  table marks a task completed only when its binding assurance exists, and
  records any remaining gap.

### R2-F6 — A crash after publication but before the state write cannot be reconciled

- Severity: `should_fix`
- Category: `correctness`
- Confidence: `high`
- Evidence: The failing sequence is:
  1. `packages/orchestrator/src/workflow.ts:2702-2713` links
     `planning-review-<N>.md` into place.
  2. Only afterwards does it record `e.artifact` and write state, while the
     `planning_review` attempt is still active.
  3. If the process stops between those two steps, resume reaches
     `reconcilePlanningAttempt`. That calls `validateTerminalCheckpointResult`
     (`terminal-checkpoints.ts:422`), then `validateSavedArtifactScope`, then
     `checkArtifactPhaseScope`.
  4. `packages/orchestrator/src/workflow/attempts/result-scope.ts:107-114`
     excludes the planning artifact only when
     `state.planningReview.active.artifact != null`, and it is still null.
  5. The work-document inventory includes `planning-review-*.md`
     (`plugins/banzai/lib/work-documents.mjs:106`). The new file is therefore a
     prohibited `planning_review` change, and the completed attempt fails with
     `ARTIFACT_PHASE_SCOPE_INVALID`.
  6. A retry pays for another review at the same `<N>`. Its different bytes
     then hit `PLANNING_REVIEW_PUBLICATION_CONFLICT`, and the next retry
     renumbers. That renumbering also triggers R2-F8.
- Violates: `plan.md:216` (reconcile: "revalidate the result, rehash, publish
  idempotently, continue"); `plan.md:563` (recovery after publication excludes
  only the just-published artifact path); FR37. Primary Engineering Quality
  overlap: `EQ-05`.
- Reproduction: static trace. Publish, then stop the process before
  `writeState` at `workflow.ts:2711`, then run `banzai resume`.
- Fix acceptance: The just-published path is derived from the episode's
  reserved review number, not from the recorded artifact. Reconciliation then
  re-renders, accepts the identical bytes idempotently, records the artifact
  once and continues with no model call. A workflow test simulates a stop
  between link and state write.

### R2-F7 — A blocked applying attempt is advertised as retryable, and retry then fails

- Severity: `should_fix`
- Category: `correctness`
- Confidence: `high`
- Evidence: The failing sequence is:
  1. An actionable triage leaves the episode at `applying`.
  2. The applying `plan` attempt returns `outcome: "blocked"`.
     `applyPhaseResult` blocks the run (`workflow.ts:7784-7785`), leaves the
     episode at `applying` and sets `activeAttempt = null` (`workflow.ts:7912`).
  3. `decideWithoutAttempt`
     (`packages/orchestrator/src/workflow/domain/retry-eligibility.ts:98-109`)
     reports eligible for any `blockedFrom: planning` with an active episode,
     whatever its step. Status therefore recommends retry.
  4. `retry()` computes dispatch `apply` (`workflow.ts:1588-1595`), which is not
     routed to `retryPlanningReview`.
  5. The ordinary path reaches `failedAttempt === null` and throws
     `INVALID_RETRY_STATE` "Retry state changed while the command was being
     validated." (`workflow.ts:1955-1961`).
- Violates: `plan.md:220` (the `applying` row follows ordinary planning retry
  rules); `plan.md:224-227`. The run never advertises an action that must fail
  identically. Primary Engineering Quality overlap: `EQ-05`.
- Reproduction: static trace. Use a fake applying `plan` result with
  `outcome: "blocked"`, then `banzai status` and `banzai retry`.
- Fix acceptance: The planning-episode shortcut in retry eligibility applies
  only to the `reviewing`/`analyzing` steps and to a stale latest closed
  episode. An `applying` block follows the ordinary planning rules, so status
  and `retry` agree. A test covers the blocked applying result.

### R2-F8 — Renumbering after a publication conflict invalidates the run's human-time evidence

- Severity: `should_fix`
- Category: `correctness`
- Confidence: `high`
- Evidence: The failing sequence is:
  1. On a `PLANNING_REVIEW_PUBLICATION_CONFLICT` retry,
     `packages/orchestrator/src/workflow.ts:3187` changes the active episode's
     `reviewNumber` and keeps its `episodeId`, as specified.
  2. The earlier `planning_review.requested` event still carries the old number.
  3. The human-time replay finds the episode by both `episodeId` and
     `reviewNumber`
     (`packages/orchestrator/src/human-time-store.ts:672-697`). It finds none
     and throws `AMBIGUOUS_ANCHOR`.
  4. `readEvidence` then returns empty evidence for the whole run
     (`human-time-store.ts:832-838`), and every later read repeats this.
- Violates: `plan.md:271-273` (re-reservation keeps the episode id);
  `plan.md:674` (a review-request response closes the episode named by its
  gate); `plan.md:1395-1396` (an unhandled shape must never invalidate a run's
  human-time evidence on a supported path); FR40; ADR-0055 Compliance 11.
  Primary Engineering Quality overlap: `EQ-05`.
- Reproduction: static trace. Place a file with different bytes at the
  reserved `planning-review-<N>.md` path before publication, retry the review,
  then read the human-time evidence.
- Fix acceptance: The `requested` response is corroborated by `episodeId` and
  stays valid after a re-reservation. A human-time journey test with a
  publication-conflict retry returns evidence with no issues.

### R2-F9 — The triage terminal prints all finding cards before any disposition menu

- Severity: `should_fix`
- Category: `spec`
- Confidence: `medium`
- Evidence: `packages/orchestrator/src/interactive.ts:1083` renders every
  finding and analysis card (`renderPlanningTriage`). Only afterwards does the
  loop at `:1085` ask `Disposition for <finding-id>` for each finding. With up
  to 20 findings, each menu ends up far from its card. The existing code-review
  triage presents card then menu per finding.
- Violates: FR19 (`description.md:168-177`: for each finding, in review order,
  the interface shows the finding, evidence, suggestion and analysis, "then
  offers the `Disposition for <finding-id>` menu"); `plan.md:718-721`.
- Reproduction: static. Use a pending triage with two or more findings in the
  terminal.
- Fix acceptance: Each finding's card is shown immediately before its own
  disposition menu, in review order. An interactive test asserts the
  interleaving.

### R2-F10 — CLI and terminal strings and error codes deviate from the approved text

- Severity: `should_fix`
- Category: `spec`
- Confidence: `high`
- Evidence: Five deviations:
  - **ADR `--note` error code.** `banzai approve adr --decision rework --note`
    with a dangling value uses `option()` (`cli.ts:1330`, helper
    `cli.ts:269-279`). It fails with `MISSING_OPTION` "`--note requires a
    value.`" instead of `INVALID_DECISION` "ADR rework requires a non-empty
    --note."
  - **Stale retry label.** For a stale block the label is
    `Review the current planning artifacts again`
    (`interactive.ts:1490-1491`), not `Retry planning review`.
  - **Plan `--note` message.** `banzai approve plan --note` (dangling, with
    the default `approve`) reports `Plan rework requires a non-empty --note.`
    (`cli.ts:403-407`) instead of the `--note is accepted only with --decision
    rework.` rule.
  - **Status Next lines.** `banzai status` at the triage gate prints two `Next:`
    lines (`cli.ts:496-499` and `cli.ts:559-562`).
  - **HELP.** The `control answer` sentence (`cli.ts:264-265`) omits
    `banzai-agent-answer/v4` and the gate-decision document. The new loop
    sentence (`cli.ts:257`) says rework returns revisions "through human
    planning-review triage", but rework has no triage.

  No path grants an approval or mutates state.
- Violates: FR8 and `plan.md:751-753` (missing or dangling note →
  `INVALID_DECISION` with the exact message); `plan.md:725-727`;
  `plan.md:735-738`; `plan.md:766-771`.
- Reproduction: run the listed commands against a run at the matching gate, and
  read `banzai status` at a triage gate.
- Fix acceptance: Each listed string and code matches the approved text, and
  CLI tests assert the ADR code and message and the single `Next:` line.

### R2-F11 — Maintained documentation states stale or incorrect current facts

- Severity: `should_fix`
- Category: `documentation`
- Confidence: `high`
- Evidence: In `PROJECT_MANIFEST.md`:
  - `:1579` still says "every new route begins at state 9".
  - The section 5 `workflow.ts` entry (`:491-515`) does not list `reworkPlan`,
    `requestPlanningReview`, `answerPlanningReview` or the planning executors.
  - Section 5 has no entries for `planning-review-state.ts`,
    `planning-review-artifact.ts` or `workflow/domain/planning-review.ts`.
  - The section 6 five-gate bullet (`:972-978`) does not mention the loop that
    `plan.md:985-987` requires.
  - The feature summary was appended after the ADR decision index table, at the
    end of section 10 (`:1789-1802`), not in the sections it describes.

  In `documentation/orchestrator.md`:
  - `:533-534` says capabilities v8 is emitted "with schema version 7". It is
    8: `AGENT_CAPABILITIES_SCHEMA_VERSION = 8` at `src/types.ts:115`.
  - `:1685` still says "directly in state 9".
- Violates: `plan.md:975-1010` (current facts that become stale); T013
  (`plan.md:1666-1674`); root `AGENTS.md` (manifest current-state rules); the
  plugin process rule "keep docs in sync with code and manifest changes".
- Reproduction: `grep -n "state 9\|schema version 7, control contract"`
  over `PROJECT_MANIFEST.md` and `documentation/orchestrator.md`.
- Fix acceptance: These statements describe state v10 and capabilities schema
  8. The section 5 and 6 entries describe the new commands, modules and gate
  loop in their owning sections. The appended paragraph is folded into those
  sections. No current-fact statement contradicts the source.

### R2-F12 — An invalid evidence line in reviewer output is reported as a configuration error

- Severity: `nit`
- Category: `correctness`
- Confidence: `high`
- Evidence: `packages/orchestrator/src/validation.ts:797-800` decodes
  `evidence.line` with `requirePositiveInteger` (`validation.ts:190-196`),
  which throws `INVALID_CONFIG`. Every other planning-review decoder failure
  uses `INVALID_RESULT`, so the block reason misattributes invalid reviewer
  output to configuration.
- Violates: the plan's contract-decoder conventions (`plan.md:346-353`).
- Reproduction: decode a reviewer result whose evidence item has `line: 0`.
- Fix acceptance: the failure is `INVALID_RESULT`, and a contracts test asserts
  the code.

## Previously Accepted Findings

`review-1.md` was a planning-readiness review. The plan records that the owner
rejected F1 (MCP scope) and that F2 was accepted and resolved in the plan
(`plan.md:1969-1977`).

- **F2.** The delivered `plugins/banzai/phases/planning-review.md` contains the
  ordinary-finding threshold, the EQ-only exclusion and both examples. The
  behavior is implemented. The assurance that review-1 F2 asked T006 to carry
  is missing, and is reported under R2-F5.
- **F1.** Rejected by the owner and not reopened. The adapter keeps the
  ADR-0022 whitelist construction unchanged, as recorded.

## Deferred Coverage

- **No commands rerun by the reviewer.** No live vendor invocation,
  installation, hosted CI or release publication is covered. The reviewer
  reran no test or release command. The retained final candidate evidence
  covers the current source, except the two reports changed afterwards, as
  described in Review Scope.
- **Findings established by static trace.** R2-F1 and R2-F6 to R2-F8 were
  established by static tracing, without executing a reproduction. The
  narrow-window crash in R2-F6 and the publication-conflict precondition in
  R2-F8 were not physically induced.
- **Lower-severity observations, not elevated.** These were reported during
  review but not traced to a confirmed defect:
  - **Nested analysis error path.** The analysis step runs inside the
    published review's error handler (`continuePublishedPlanningReview`). An
    exception from analysis attempt creation could mark the completed review
    record failed.
  - **Events after the state write.** `planning_review.triage_pending` and
    `planning_review.gate_restored` are appended after the state write, and no
    reconcile path re-appends them.
  - **Unsafe destination.** A symlinked or non-regular destination fails with
    `ARTIFACT_UNSAFE_PATH` rather than the conflict code, so each retry repeats
    the reviewer call.
  - **Cancellation wrapper.** The new runner commands lack the
    `TerminalRunStateError` wrapper used by `approvePlan`/`decideAdr`.
  - **Text comparison.** Idempotent publication compares decoded text, not
    bytes.
  - **Store slot shape.** Store validation selects the closed or active episode
    shape by field presence, not by slot.
  - **Trimming.** Persisted triage instructions are not checked for trimming.
- **Advisory numeric-trigger diagnostics.** `workflow.ts` grows from 64 to 70
  numeric warnings. The report records these as advisory under the plan's
  structural assessment, and they were not reassessed.
- **Agent control status.** Status v6 projects `reviewPaths` at gates of runs
  below v10, while plan rework and review are not advertised there. This was
  not judged a contract violation.
- **Engineering Quality shadow.** Ordinary findings and the verdict were
  frozen before the Engineering Quality overlap was classified. No incremental
  EQ-only shadow candidate was retained.

## Handoff

Human triage is required for R2-F1 through R2-F12: accept, reject or defer
each finding. Only accepted findings enter the fix scope.

- **Narrowing obligations.** Obligations in R2-F3 to R2-F5 that the owner
  prefers to narrow, rather than satisfy, need the approved plan-change path.
  A report edit alone cannot discharge them.
- **Fix-phase test duty.** Fixes for R2-F1, R2-F2 and R2-F6 to R2-F8 must add
  the focused tests named in their fix acceptance.
- **Fresh checks.** After source fixes, rerun the two mandatory final checks
  fresh and refresh the report claims.

This reviewer changed no source, tests, requirements, plan, ADRs,
configuration, runner state or reports. This review file is the only repository
file it created.
