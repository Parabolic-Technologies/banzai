# Feature: Planning Rework and Independent Planning Review

Slug: `planning-rework-and-review`

Requirements authority: the owner's request of 2026-10-13. The owner found that
the interactive plan approval menu offers no way to send a plan back for rework,
and that this option must exist when approving a plan or an ADR. The owner then
added an independent planning review, performed by the configured reviewer model
and followed by human triage of the planner's recommendations. The owner also
answered decision cards PR-D2, PR-D3 and PR-D4. PR-D1 was left unanswered and is
superseded by PR-D3. This description is approved only as part of the plan bundle
at the plan approval gate.

Evidence of the current behavior:

- `packages/orchestrator/src/interactive.ts:1148`: the `Plan decision` menu
  offers only approval, cancellation and exit.
- `packages/orchestrator/src/state-machine.ts:15`: `needs_plan_approval` leads
  only to `plan_approved`, `cancelled` or `blocked`.
- `packages/orchestrator/src/interactive.ts:976` and `:985`: ADR rework exists,
  but its note is optional.
- `packages/orchestrator/src/cli.ts:1165`: `banzai approve plan` can only
  approve.
- `plugins/banzai/skills/orchestrate/references/control-protocol.md:285-286`:
  the supervisor has no route for plan rework and sends ADR rework without a
  note.

## Overview

The ADR approval gate and the plan approval gate of a strict run gain two
actions, each available in the interactive terminal, in the non-interactive CLI
and through agent control:

1. **Rework.** The human sends the pending artifacts back to the planner. The
   request must carry written feedback. The planner revises the bundle with
   that feedback and the run returns to a normal planning gate.
2. **Independent planning review.** The human sends selected planning
   artifacts, or the whole planning bundle, to the configured `reviewer` model.
   That model reviews them without write access, and the runner publishes the
   review as a durable artifact. When the review has findings, the planner
   analyzes each one and proposes fix options. The human then triages every
   finding by choosing one of those options, writing an own instruction or
   declining the finding. The planner applies exactly the recorded
   dispositions, and the run returns to a normal planning gate.

Primary flow at the plan gate: the human opens the run at
`needs_plan_approval` and chooses `Request independent review`. They pick
`Whole planning bundle` and confirm. The reviewer publishes
`planning-review-1.md` with three findings, and the planner returns an analysis
for each one. For the first finding the human picks the recommended option.
For the second they write an own instruction, and they decline the third. They
confirm the triage. The planner revises the bundle and the run returns to plan
approval. There the human approves the revised bundle, requests rework, or asks
for another review, which produces `planning-review-2.md`.

Key constraint: rework, review requests and planning-review triage never
approve a plan, never accept an ADR and never authorize code. The planner's
recommendations are advisory, and only the human selects a disposition.

Non-goals:

- automatic re-review after the planner applies the triage;
- mandatory or automatically triggered planning review;
- rework or planning review in lite workflows (`feature`, `quick-fix`), or in
  standalone skill sessions, where chat already carries this conversation;
- changes to code review, its `review-<N>.md` artifacts, its triage or its
  re-review policy;
- a separate "reject plan" action (`Cancel run` with the `plan_unsuitable`
  reason remains the rejection path);
- new evaluation or KPI metrics.

## Functional Requirements

### Plan rework

- **FR1** At `needs_plan_approval` the interactive `Plan decision` menu offers
  these choices in this order: `Approve plan and continue`, `Request rework`,
  `Request independent review`, `Cancel run`. When human-time actions are
  enabled, `Update my active time` and `Show human-time details` come next.
  `Exit and decide later` is always last.
- **FR2** Choosing `Request rework` prompts `Rework feedback for the planner`.
  Empty or whitespace-only input is rejected with `A value is required.`, and
  the prompt stays active.
- **FR3** After the feedback is entered, the interface asks
  `Record this plan rework request as <decidedBy> and return to planning?`.
  The default is No. Declining records nothing, and the run stays at
  `needs_plan_approval`.
- **FR4** Confirming durably records the rework request with its trimmed
  feedback, `decidedBy` and decision time. It returns the run to planning
  without any plan approval. The next planning attempt receives this feedback
  together with every earlier rework feedback, ADR decision and human-decision
  answer of the run.
- **FR5** A rework planning attempt revises the existing description, ADRs and
  plan in place. It ends at one of planning's normal gates
  (`decision_consultation`, `adr_approval` or `plan_approval`). A later plan
  approval binds only the bytes current at that approval.
- **FR6** The non-interactive CLI offers plan rework with non-empty feedback.
  Missing or empty feedback fails with error code `INVALID_DECISION`. A request
  made outside `needs_plan_approval` fails with the existing invalid-state
  error. In both cases the run state does not change.

### ADR rework feedback

- **FR7** In the interactive ADR decision, `Request rework` prompts
  `Rework feedback for the planner`, which is required and validated as in
  FR2. `Accept` and `Reject` keep the prompt `Decision note (optional)`.
- **FR8** `banzai approve adr --decision rework` without a non-empty `--note`
  fails with error code `INVALID_DECISION` and the message
  `ADR rework requires a non-empty --note.` before any state change. For
  `accept` and `reject`, `--note` stays optional.
- **FR9** The planning attempt after an ADR rework receives that ADR's rework
  feedback together with its decision.

### Requesting an independent planning review

- **FR10** The interactive ADR decision menu (`Decision for <ADR-ID>`) offers
  `Request independent review` after `Request rework`. When human-time actions
  are enabled, they come next, and `Exit without deciding` is always last. The
  `Plan decision` menu offers it as specified in FR1.
- **FR11** Choosing `Request independent review` asks `Review scope` with the
  choices `Whole planning bundle` and `Choose artifacts`.
  - At the plan gate, the whole planning bundle is the description, every ADR
    in the approval bundle and the plan.
  - At the ADR gate, it is the description and every pending ADR.
  - `Choose artifacts` offers exactly the same list for multiple selection.
    Submitting no selection is rejected with
    `Choose at least one artifact.`.
- **FR12** The interface then asks
  `Send the selected artifacts to the configured reviewer?`. The default is No.
  Declining records nothing, and the run stays at its gate.
- **FR13** Confirming durably records the request with the reviewed paths,
  `decidedBy` and request time. It then runs one review attempt with the
  executable, model and effort configured for the `reviewer` role, in a session
  that does not inherit the planner session.
- **FR14** The planning review attempt is read-only. Any attempt by it to write
  a project file is denied. Every reviewed artifact has the same SHA-256 before
  and after the attempt.
- **FR15** A completed review yields zero to twenty findings. Each finding has
  a stable ID, a severity, a summary, at least one evidence item (a
  repository-relative path, an optional line and a detail) and a suggested
  resolution. A result with more than twenty findings is rejected as invalid
  reviewer output.
- **FR16** The runner publishes each completed review as
  `planning-review-<N>.md` beside the run's `description.md` and `plan.md`.
  - `<N>` starts at `1` and increases by one for each planning review of the
    same work.
  - An existing file is never overwritten.
  - The artifact names each reviewed path with its SHA-256 at review time, the
    reviewer's executable name (its basename, never a local absolute path),
    model and effort, and every finding.
- **FR17** A review with zero findings starts no planner analysis. The run
  returns to the gate where the review was requested, and the interface shows
  `Independent review found no issues: <artifact path>`.

### Planner analysis and planning-review triage

- **FR18** A review with at least one finding starts a read-only planner
  analysis attempt. The attempt reads the review artifact and the reviewed
  artifacts and returns exactly one entry per finding. Each entry contains:
  - an assessment: `agree`, `partially_agree` or `disagree`;
  - a rationale;
  - one to three fix options, each with a label and its consequences;
  - a recommended option, only when the evidence supports one.

  The attempt changes no project file.

- **FR19** After the analysis, the run waits at a planning-review triage gate.
  For each finding, in review order, the interface shows:
  - the finding ID, severity and summary;
  - each evidence location;
  - the reviewer's suggested resolution;
  - the planner's assessment and rationale.

  It then offers the `Disposition for <finding-id>` menu. The menu lists every
  option label, with ` (recommended)` appended to the recommended one, then
  `Write my own instruction` and `Decline (no change)`. When human-time actions
  are enabled, they come next, and `Exit and decide later` is always last.

- **FR20** `Write my own instruction` prompts
  `Your instruction for <finding-id>`. The value is required and validated as
  in FR2.
- **FR21** After every finding has a disposition:
  - the interface prompts `Additional instruction for the planner (optional)`;
  - it shows `Planning-review triage: options=<n>, own=<n>, declined=<n>`;
  - it asks `Record this planning-review triage as <decidedBy>?`, with default
    No.

  Declining the confirmation or choosing `Exit and decide later` records
  nothing, and the run stays at the planning-review triage gate.

- **FR22** A triage is recorded only when it carries exactly one disposition
  for every finding of the current analysis. It is bound to that planning
  review number and analysis. The durable record keeps:
  - the chosen option, own instruction or decline for each finding;
  - the optional additional instruction;
  - `decidedBy` and the decision time.

  Missing, duplicate, unknown or stale finding or option identities are
  rejected without any state change or model invocation.

- **FR23** The planner then applies the recorded dispositions and only those,
  and ends at one of planning's normal gates. This happens when at least one
  finding has a chosen option or an own instruction, or when the additional
  instruction is non-empty. In every other case the run returns, without
  invoking a model, to the gate where the review was requested.
- **FR24** Rework and triage never modify the body of an Accepted ADR. A
  disposition that requires changing an accepted decision produces a new or
  revised Proposed ADR, which reaches the ADR approval gate before planning
  relies on it.
- **FR25** No review starts automatically after rework or triage. At the
  returned gate, the human may request another independent review, which
  receives the next `<N>`.

### Authority invariants

- **FR26** Rework requests, review requests, review completion and
  planning-review triage never set plan approval, never record ADR acceptance
  and never authorize implementation. Explicit plan approval remains the only
  transition to `plan_approved`.
- **FR27** `planning-review-<N>.md` artifacts are not part of the plan
  approval bundle. Creating them does not change or invalidate an approval
  digest.

### Non-interactive CLI and agent control

- **FR28** The non-interactive CLI offers each of these operations at the
  matching gate:
  - plan rework (FR6);
  - ADR rework (FR8);
  - an independent planning review request with whole-bundle or explicit
    artifact scope;
  - a planning-review triage answer.

  Each operation fails without state change outside its gate.

- **FR29** Agent-control status lists rework and independent review as
  available decisions at `needs_adr_approval` and `needs_plan_approval`. At
  the planning-review triage gate, status reports a distinct next action and a
  pending gate. That gate carries the review artifact path, every finding, the
  planner's analysis and the identities a triage answer must reference.
- **FR30** Through agent control, rework feedback, review requests and triage
  answers travel only in closed, versioned direct-stdin documents. These
  documents are validated completely before any mutation and are bounded by the
  existing 64 KiB agent-control input limit. No free text travels through shell
  arguments. The supervisor sends them as raw UTF-8 JSON, with no `\u`
  escaping of non-ASCII text (Resolved Assumption 20).
- **FR31** Existing agent-control capability, status and answer versions keep
  their current meaning. A supervisor that has not negotiated the revised
  version receives an explicit unsupported-version error, never a downcast or
  relabeled projection.
- **FR32** The `orchestrate` control protocol documents the new decisions and
  the triage gate. It requires the supervisor to show the exact artifacts,
  findings and options and to wait for the current user's explicit decision.
  The supervisor never chooses, infers or rewrites a disposition, a
  recommendation or feedback.

### Input validation and rendering

- **FR33** On every surface, each human free-text value (rework feedback, own
  instruction and additional instruction) must be:
  - non-empty after trimming, where FR2, FR7, FR8 or FR20 requires it;
  - valid UTF-8, with no unpaired surrogate;
  - free of NUL, of other control characters except tab and line feed, and of
    bidirectional formatting characters;
  - within its maximum length in UTF-8 bytes. The maximum is 8000 bytes for
    rework feedback and for the additional instruction, and 2000 bytes for each
    own instruction.

  An invalid value is rejected before any state change or model invocation.

- **FR34** Model-authored text (findings, assessments, rationales and option
  labels) and echoed human feedback reach the terminal with terminal control
  sequences neutralized.
- **FR35** A review scope accepts only paths among the gate's persisted
  artifact paths. Any other path, including absolute paths, `..` traversal or a
  symlink alias, is rejected before model invocation.
- **FR36** The planner receives rework feedback and triage records as recorded
  human-decision data. That data does not widen planning's write scope: the
  planner still writes no production code.

### Failure, interruption and cancellation

- **FR37** A review or analysis attempt that fails, times out or is
  interrupted:
  - leaves every bundle artifact byte-identical and records no approval;
  - leaves the run `blocked` with the existing retry and cancel paths;
  - when retried, repeats only the failed attempt with the same recorded
    review scope.

  If any reviewed artifact changes between the review request and the moment
  its triage is applied or its gate restored, no result is published and no
  triage is recorded for those bytes. The run is `blocked` with the reason
  `Planning review is stale: reviewed artifacts changed.`, and a retry starts a
  new planning review of the same paths at their current bytes, which receives
  the next `<N>`.
- **FR38** `Ctrl+C` at any prompt of these flows exits the interface without
  changing the run. A run left at the planning-review triage gate is presented
  again the next time `banzai` opens.
- **FR39** `banzai cancel` cancels a run that waits at the planning-review
  triage gate.

### Observability and documentation

- **FR40** Each recorded rework request, review request and triage closes the
  current gate's human-time episode as a recorded response. The
  planning-review triage gate opens its own gate episode. Gate elapsed time
  never becomes active effort.
- **FR41** `banzai status` and `banzai status --json` show the
  planning-review triage gate, the review artifact path and the finding count.
  The run's event history records each rework request, review request, review
  completion and triage record.
- **FR42** `documentation/orchestrator.md` and the installed workflow process
  (`plugins/banzai/AGENTS.md`) describe the new gate actions, the mandatory
  rework feedback, the planning review flow and its triage gate, and the CLI
  and agent-control routes.

## User Stories & Acceptance Criteria

1. **Plan rework (FR1–FR5)**
   - Given a run at `needs_plan_approval`,
   - when the human chooses `Request rework`, enters `Split T003 into
migration and rollout tasks` and confirms,
   - then the run leaves the gate without plan approval, and the next planning
     attempt receives that exact feedback. The run returns to plan approval
     with a revised plan that must be approved again.
2. **Empty rework feedback (FR2, FR6, FR8)**
   - Given a run at either gate,
   - when the human submits whitespace as rework feedback in the terminal, or
     runs the CLI rework without feedback or with `--note ""`,
   - then the terminal shows `A value is required.`, or the CLI fails with
     `INVALID_DECISION`, and `state.json` and the event history do not change.
3. **ADR rework compatibility break (FR8)**
   - Given a run at `needs_adr_approval`,
   - when `banzai approve adr --id ADR-0061 --decision rework` runs without
     `--note`,
   - then it fails with `ADR rework requires a non-empty --note.`. The same
     command with `--decision accept` and no note still succeeds.
4. **Whole-bundle review with triage (FR11–FR23)**
   - Given a run at `needs_plan_approval`,
   - when the human requests `Whole planning bundle` and the reviewer returns
     findings `P1-F1`, `P1-F2` and `P1-F3`,
   - then:
     - `planning-review-1.md` exists and lists the description, ADRs and plan
       with their SHA-256 values;
     - the bundle bytes are unchanged;
     - the triage gate shows the planner's analysis for every finding.
   - When the human picks the recommended option for `P1-F1`, writes an own
     instruction for `P1-F2`, declines `P1-F3` and confirms,
   - then the planner receives exactly those dispositions, and the run returns
     to a planning gate without any approval.
5. **All declined (FR23)**
   - Given a triage gate with two findings,
   - when both are declined, no additional instruction is entered and the human
     confirms,
   - then no model is invoked, and the run returns to the gate where the review
     was requested.
6. **Clean review (FR17)**
   - Given a run at `needs_adr_approval`,
   - when a review of one chosen ADR returns no findings,
   - then no planner analysis runs. The interface shows
     `Independent review found no issues: <path>`, and the ADR decision menu is
     shown again.
7. **Scope containment (FR35)**
   - Given a run at `needs_plan_approval`,
   - when a non-interactive review request names `src/secret.ts` or
     `../description.md`,
   - then the request is rejected before any model invocation, and the run is
     unchanged.
8. **Reviewer cannot write (FR14)**
   - Given a planning review attempt,
   - when the reviewer tries to edit `plan.md`,
   - then the write is denied, and `plan.md` keeps its pre-review SHA-256.
9. **Stale triage (FR22)**
   - Given a triage gate for `planning-review-2.md`,
   - when an agent-control answer references a finding of
     `planning-review-1.md` or an unknown option,
   - then the answer is rejected without mutation or model invocation.
10. **Failure (FR37)**
    - Given a review attempt that times out,
    - then the run is `blocked` with retry eligible and the bundle bytes are
      unchanged. A retry repeats the review with the same recorded scope.
11. **Supervisor parity (FR29–FR32)**
    - Given the `orchestrate` supervisor on the revised agent-control version,
    - when the run reaches each gate,
    - then status advertises rework and review, or the triage next action and
      its complete pending content. A supervisor limited to the previous
      version gets an explicit unsupported-version error.
12. **No automatic re-review (FR25)**
    - Given a completed triage whose planner revision returns to plan approval,
    - then no review attempt starts until the human requests one, and the next
      artifact is `planning-review-2.md`.

## Platform Specifics

- The orchestrator layering stays inward. `interactive` and `cli` depend on
  `workflow`. State transitions remain owned by `state-machine.ts`, an
  ADR-0052 domain module subject to the domain purity lint.
- `@inquirer/prompts` is the only interactive prompt dependency, and
  `inquirer-io.ts` is its only binding. No new runtime dependency is
  authorized.
- Contract JSON is embedded in the committed bundle. Contract, validation or
  hook-library changes require a rebuild, matching `dist/`, and a version bump
  where `HOOK_CHANGED_WITHOUT_VERSION_BUMP` applies.
- An agent-control revision ships under the single release-train version, with
  the plugin control protocol and the CLI released together.
- New maintained documents need a `publication-policy.json` classification.
  Work documents follow ADR-0054's `documentation/work/<slug>/` layout.
- All user-facing strings are English (repository `AGENTS.md`).

## Security Exposure

- **Class 1: untrusted input reaching a resource path or terminal renderer.**
  Human free text and model-authored findings and options are persisted, sent
  to the planner and rendered in the terminal. Review scope paths select files
  for the reviewer to read. Satisfied by FR30, FR33, FR34 and FR35.
- **Class 2: capability decision for new attempt kinds.** The planning review
  and planner analysis attempts must receive read-only capability. Rework and
  triage must not widen the planner's write scope. Satisfied by FR14, FR18,
  FR26 and FR36.

## Architecture Decision Needs

All three needs are addressed together by
[ADR-0055](../../decisions/0055-planning-gate-rework-and-independent-planning-review.md),
accepted by the owner on 2026-10-13.

1. **Planning gate decision lifecycle.** How do rework, planning review,
   planner analysis and the planning-review triage gate enter the run state
   machine? This covers the transitions out of `needs_plan_approval` and
   `needs_adr_approval`, any new states, the run state schema revision and its
   legacy readers, and event identities. It also covers the closed human-time
   gate vocabulary and cancellation evidence, and the change to the installed
   process's list of five existing decision gates.
   - Drivers: FR4, FR13–FR26, FR37–FR41.
   - Related ADRs: ADR-0031, ADR-0034, ADR-0035, ADR-0038, ADR-0052.
2. **Planning review contracts.** This need covers:
   - the reviewer result contract for planning artifacts (reuse of review-result
     v2 or a new contract);
   - the runner-rendered `planning-review-<N>.md` format, numbering and
     create-only publication;
   - the planner analysis result contract and its relation to phase-result v4
     decision-consultation cards;
   - reviewer session and independence policy, and phase-instruction delivery;
   - prompt-envelope and context-accounting categories for feedback and triage
     data.
   - Drivers: FR13–FR18, FR22, FR33–FR36.
   - Related ADRs: ADR-0021, ADR-0037, ADR-0042, ADR-0047, ADR-0054.
3. **Public CLI and agent-control revision.** This need covers the command
   grammar for plan rework, review requests and triage answers, and the
   compatibility break that makes the ADR rework note mandatory. It also covers
   the agent-control capability, status and answer document versions, their
   compatibility and negotiation rules, the `orchestrate` protocol, and
   coordinated release.
   - Drivers: FR6, FR8, FR28–FR32.
   - Related ADRs: ADR-0023, ADR-0031, ADR-0033.

## Resolved Assumptions

1. **User-confirmed:** the plan approval gate must offer rework, and rework must
   exist at both the plan gate and the ADR gate. This comes from the original
   request.
2. **User-confirmed (PR-D2 = B):** non-empty written feedback is mandatory for
   both plan rework and ADR rework, on every surface. The owner accepted the
   resulting break for `banzai approve adr --decision rework` without
   `--note`.
3. **User-confirmed (PR-D3 = C):** rework and independent planning review are
   offered in the interactive terminal, in the non-interactive CLI and through
   agent control. PR-D3 superseded the unanswered PR-D1 after the scope grew.
4. **User-confirmed (PR-D4 = A):** after the planner applies the triage, the
   run returns to a gate and starts no automatic re-review.
5. **User-confirmed:** this follow-up request was added to the PR-D1 answer. The
   configured reviewer reviews selected planning artifacts or the whole
   bundle. The planner analyzes the review and recommends fixes. The human
   chooses among the recommended options or writes an own triage.
6. **Sensible default:** independent review is offered at both the ADR gate
   and the plan gate, because ADRs are planning artifacts and the original
   request covered both gates.
7. **Sensible default:** each finding takes one of three dispositions: a
   recommended option, an own instruction, or decline. There is no "defer",
   because strict planning requires **Open Questions & Risks** to be
   `None outstanding`. Declined findings stay visible in the review artifact.
8. **Sensible default:** a triage that declines everything and has no
   additional instruction returns to the gate without a model call.
9. **Manifest convention:** planning reviews are Git-visible numbered siblings
   in the work directory (ADR-0054). They are named `planning-review-<N>.md`
   so they do not collide with code-review `review-<N>.md` artifacts.
10. **Manifest convention:** the reviewer is the configured `reviewer` role. It
    runs read-only and never inherits the planner session, as manifest
    section 3 requires for review attempts.
11. **Manifest convention:** Accepted ADR bodies are immutable. A changed
    decision goes through a new or revised Proposed ADR and the ADR approval
    gate (installed process, ADR lifecycle).
12. **Sensible default:** a failed review or analysis follows the existing
    `blocked`, retry and cancel lifecycle and leaves the bundle unchanged.
13. **Sensible default:** lite workflows and standalone skill sessions are out
    of scope.
14. **Sensible default:** `Cancel run` with `plan_unsuitable` stays the plan
    rejection path. No separate reject-plan action is added.
15. **Manifest convention:** all new user-facing strings are English.
16. **Sensible default (planning refinement):** the free-text limits reuse the
    numeric consultation bounds, measured in UTF-8 bytes as FR33 requires: 8000
    for feedback and the additional instruction, 2000 for each own instruction.
    With at most twenty findings per review (FR15), a triage answer carries at
    most 48,000 UTF-8 bytes of human text.
17. **Manifest convention:** human-time actions appear at every human stop
    (ADR-0034), so the ADR decision and triage disposition menus include them
    before their exit choice, as the plan gate already does.
18. **Sensible default:** stale reviewed bytes block the run instead of
    silently re-reviewing (ADR-0055, planning review episode 5). The human
    keeps the retry and cancel choices.
19. **Sensible default:** the artifact names the reviewer executable by
    basename only, so a local absolute path never reaches a Git-visible file.
20. **User-confirmed (PR-D5 = A):** a named exception to PR-D3 parity. The
    `orchestrate` supervisor must send raw UTF-8 JSON, with no `\u` escaping of
    non-ASCII text, and a realistic triage answer then fits the existing
    64 KiB agent-control input limit. An answer whose JSON escaping (quote,
    backslash, tab, line feed) pushes the document past 64 KiB fails with
    `CONTROL_INPUT_TOO_LARGE` before any state change. The interactive terminal
    route still accepts it. No text limit and no ADR changes.

## Open Questions & Risks

None outstanding.
