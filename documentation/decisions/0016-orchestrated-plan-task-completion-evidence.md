# ADR 0016: Orchestrated Plan Task Completion Evidence

## Status / Date / Owner / Decision Makers

- Status: Superseded
- Date: 2026-08-13
- Owner: Banzai maintainers
- Decision makers: User, explicitly accepted in chat on 2026-08-13

## Related Artifacts

- Feature description:
  `documentation/features/orchestrator-evidence-readiness-alignment/description.md`
- Feature plan: Not created; planning cannot rely on this Proposed ADR.
- Manifest: sections 3, 5, 6, and 10 of `PROJECT_MANIFEST.md`
- Related ADRs:
  - ADR-0001 preserves strict plan approval and the approved bundle digest.
  - ADR-0002 preserves builder/reviewer boundaries and durable reports.
  - ADR-0013 defines risk-driven assurance and truthful report evidence.
  - ADR-0014 defines terminal human-triaged completion semantics.

## Context and Decision Drivers

In orchestrated strict mode, plan approval binds the exact description,
accepted ADRs, and plan. `code-writing` and `test-writing` explicitly leave
those approved artifacts unchanged and record work in implementation/test
reports and structured phase results. The hook and runner revalidate the
approval digest before authorized work and review.

`feature-status` currently also says persisted active-run state owns the next
action, but later says every unchecked plan task remains in `code-writing` even
when implementation exists. `feature-review` asks task statuses to match code
and reports without distinguishing immutable orchestrated checkboxes from
standalone mutable progress. These rules conflict.

The real `books-crud-api` run is terminal `done`, has a valid unchanged plan
approval, a passing final review, successful final verification, implementation
and test reports, and `nextAction: null`. Its approved plan correctly remains
`0/5` by checkbox. Treating that checkbox count as the completion authority
would send a completed run back to `code-writing` and incentivize a digest-
breaking edit.

State alone cannot prove every planned task is implemented: a terminal state
with missing or contradictory reports must remain visibly inconsistent. A new
run-state schema solely to duplicate report task IDs would add migration and
recovery cost. The workflow needs one evidence hierarchy that works for
orchestrated and standalone projects and remains independently reviewable.

Decision question: Which evidence owns lifecycle, next action, and per-plan-task
completion when an orchestrated approved plan is immutable, and how are
standalone fallback and contradictions reported?

Decision owner: Banzai maintainers, with explicit user lifecycle approval.

Decision drivers:

- approval-digest integrity and immutable approved artifacts;
- one consistent status/review/code-writing contract;
- truthful `N/N`, partial, unknown, and inconsistent representations;
- persisted state authority without masking missing reports or source gaps;
- compatibility with existing run state and phase-result schemas;
- independent review and human triage remain fail-closed;
- useful legacy handling for reports created before an explicit task ledger.

## Options Considered

### Option 1: State-owned lifecycle plus report-owned task completion ledger

Keep persisted orchestrator status and `nextAction` authoritative for lifecycle.
Require implementation reports for new strict runs to carry an explicit
per-task completion table linked to approved `TNNN` identifiers. Use the test
report, persisted structured phase result, verification, and review as
corroboration. Use plan checkboxes as primary progress only outside an
orchestrated immutable approval context.

Benefits:

- preserves the approval digest and existing run-state/model-result schemas;
- task evidence stays beside implementation trace and deviations;
- status can show exact source provenance rather than infer from file presence;
- review can distinguish unchecked immutable syntax from real gaps;
- standalone checked plans keep their established meaning.

Costs and risks:

- Markdown report structure is less mechanically strong than a state schema;
- legacy reports may require conservative evidence-aware interpretation;
- status and review instructions must apply the same hierarchy precisely;
- state/report contradiction cannot be auto-repaired and must remain visible.

### Option 2: Mark approved plan checkboxes after each task

Make plan checkboxes the single source in every mode and recompute or replace
the approval digest after implementation.

Benefits:

- current `feature-status` logic works unchanged;
- progress is visible in the original task list;
- no second task representation exists.

Costs and rejection reason:

- mutates the exact human-approved bundle;
- invalidates authorization and review digests;
- makes the implementer change its own authority;
- conflicts with hook, `code-writing`, retry, and Books-run behavior. Rejected
  because approval integrity is load-bearing.

### Option 3: Treat terminal orchestrator state as proof that every task is done

When state is `done`, report all plan tasks complete regardless of reports or
source. For active runs, use state only.

Benefits:

- smallest status rule;
- no report parsing or schema change;
- terminal runs never route backward.

Costs and rejection reason:

- masks missing implementation/test reports and false phase-result claims;
- converts state corruption or workflow bugs into false completion;
- cannot identify incomplete or deviated tasks;
- weakens independent review. Rejected because lifecycle authority is not the
  same as per-task evidence.

### Option 4: Add completed task IDs to phase results and run state

Version the model-result contract and run-state schema, persist a machine
completion ledger, and derive reports from it.

Benefits:

- strongest machine-readable task accounting;
- status does not parse Markdown;
- recovery can expose exact per-task progress.

Costs and rejection reason:

- requires contract, validation, prompt, state migration, and compatibility
  changes across every installed project;
- model-reported IDs still require report/source verification;
- disproportionate when the runner already retains structured phase results and
  required durable reports;
- creates another mutable authority that can disagree with implementation.
  Rejected for this correction; a later machine-status feature may propose it
  with measured need.

## Decision

Adopt Option 1.

Separate lifecycle authority from task-completion evidence.

For a matching orchestrated run, persisted state owns lifecycle status and the
runner-computed `nextAction`. Status output must report those values first and
must not replace `nextAction: null` on a terminal run with `code-writing` merely
because the approved plan remains unchecked. Approval validity, terminal review
or human-triage evidence, and required report presence remain consistency
checks, not alternate state transitions.

The approved description, plan, and accepted ADR bodies remain byte-identical
after approval. Plan checkboxes in that context describe the approved work set,
not mutable execution progress. `code-writing` and accepted-finding fixes must
not edit them.

For every new strict implementation report, require a **Plan Task Completion**
section with one row per approved `TNNN` identifier, in plan order, containing:

- task ID;
- `completed`, `incomplete`, or `blocked` status;
- bounded repository-relative implementation or report evidence;
- deviation or gap reference when not completed.

The report must not claim phase completion when any required task is incomplete
or blocked. The structured phase result's completed outcome and persisted report
path corroborate that ledger. The test report owns risk/contract assurance and
must identify any task whose required assurance remains incomplete; it does not
turn an incomplete implementation task complete by itself.

`feature-status` must display task completion and provenance separately:

- `plan checkbox` for standalone or non-approved mutable plans;
- `implementation report` for explicit task rows;
- `orchestrator state + reports` for a consistent legacy orchestrated report
  that predates the explicit table but maps every task and declares no gap;
- `structured completion evidence` when a supported durable contract exists;
- `unknown` or `inconsistent` when evidence is absent, malformed, or conflicts.

A terminal orchestrated run may report `N/N externally completed` only when the
approval remains valid, required implementation/test reports are present, all
tasks have consistent completion evidence, and terminal review or human-triage
evidence does not contradict completion. Legacy reports may support that result
only when their file/requirement/deviation/gap evidence covers every plan task;
file presence or state `done` alone is insufficient.

An active `implementing`, `fixing`, `verifying`, `reviewing`, or gated run is not
terminal task completion. Status uses the current run state and available task
evidence, and may show partial external progress without changing the runner's
next action.

For non-orchestrated work without an implementation report or structured
completion evidence, checked plan tasks are completed and unchecked tasks are
incomplete. This preserves the established standalone workflow.

When terminal state conflicts with a missing report, incomplete task row,
source/test gap, invalid approval, or review evidence, status reports the
persisted terminal state and `nextAction` faithfully, marks task completion
unknown or inconsistent, and recommends artifact/evidence audit rather than
`code-writing` solely to mutate checkboxes. It must not silently convert the
run to success or change persisted state.

`feature-review` uses the same hierarchy. An unchecked immutable plan is not a
finding by itself. A finding requires a material mismatch among the approved
task contract, implementation, report task ledger, assurance, state, approval,
or review evidence. The reviewer remains source-read-only and never repairs
state, plan, or reports.

Synchronize installed workflow rules, `code-writing`, `test-writing`,
`feature-status`, `feature-review`, documentation templates, root/product docs,
orchestrator docs, and manifest facts. Do not add a run-state or phase-result
schema field under this decision.

## Consequences

Positive:

- immutable approval and truthful task status no longer conflict;
- a completed orchestrated run cannot be routed backward by checkbox syntax;
- task counts disclose their evidence source;
- missing or contradictory reports remain visible;
- standalone plan checkboxes preserve their existing semantics;
- no state migration or model-result contract version is required.

Negative:

- implementation reports gain a required structured section;
- legacy report interpretation is conservative and may yield unknown rather
  than an exact count;
- Markdown evidence is not as mechanically closed as a versioned JSON ledger;
- status may show terminal lifecycle beside inconsistent task evidence, which
  requires careful wording.

Risks and required follow-ups:

- report overclaim: independent review must compare task rows with source,
  tests, deviations, and verification rather than trust the table alone;
- legacy false certainty: require full task mapping and a no-gap statement or
  report unknown/inconsistent;
- active-run confusion: always print state and runner next action before
  secondary artifact-derived progress;
- digest regression: retain approval validation and add a scenario proving the
  approved bundle digest is unchanged after implementation;
- duplicated policy text: protect the shared hierarchy with focused plugin
  contract tests and keep distributed copies synchronized.

## Compliance and Confirmation

Implementation and independent review must confirm:

1. `code-writing` leaves approved plan checkboxes unchanged and emits one
   completion row for every `TNNN` task;
2. an orchestrated `done` fixture with plan `0/N`, valid approval, complete
   reports, and consistent review reports `N/N externally completed` or an
   equivalent explicit representation and no next action;
3. an active code-writing fixture with incomplete task evidence does not report
   completion;
4. a standalone plan without external completion evidence treats unchecked
   tasks as incomplete and routes to `code-writing`;
5. terminal state with missing or contradictory required evidence reports an
   inconsistency and does not silently claim exact task completion;
6. `feature-review` creates no finding solely for immutable unchecked boxes and
   still finds a real report/source/test/task contradiction;
7. implementation, test, status, review, templates, and product documentation
   use the same evidence hierarchy and vocabulary;
8. the approved artifact bundle bytes and digest are identical before and after
   implementation, verification, status, and review;
9. persisted state remains read-only to status/review and no schema migration is
   introduced;
10. existing hook, retry, triage, high-risk reviewer rotation, and fail-closed
    authorization tests remain passing.

## Lifecycle Links

- Supersedes: None
- Superseded by: ADR-0017
