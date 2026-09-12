# ADR 0017: Versioned Plan Task Completion Ledger

Publication note (2026-09-09): private operational identifiers were removed at
the project owner's request. The accepted decision and lifecycle are unchanged.

## Status / Date / Owner / Decision Makers

- Status: Accepted
- Date: 2026-08-14
- Owner: Banzai maintainers
- Decision makers: User, explicitly accepted in chat on 2026-08-14
- Amended by: ADR-0025 (fix-authored completion ledger refresh) — an
  accepted-finding fix may return a complete refreshed ledger under the same
  fail-closed validation; the fixes-return-null clause is narrowed accordingly.

## Related Artifacts

- Feature description:
  `documentation/features/deterministic-plan-task-completion-enforcement/description.md`
- Feature plan:
  `documentation/development-plans/deterministic-plan-task-completion-enforcement/plan.md`
- Manifest: sections 3, 5, 6, 8, and 10 of `PROJECT_MANIFEST.md`
- Related ADRs:
  - ADR-0001 preserves automatic strict routing and plan approval.
  - ADR-0002 preserves durable session boundaries and independent review.
  - ADR-0003 through ADR-0005 govern evaluation versioning, privacy, and
    traceable aggregation.
  - ADR-0013 governs proportionate test assurance.
  - ADR-0014 governs terminal review and human-triage closure.
  - ADR-0015 provides the precedent for a versioned durable runner ledger and
    truthful legacy fallback.
  - ADR-0016 made the implementation report the task-completion authority and
    is superseded by this decision.

## Context and Decision Drivers

ADR-0016 resolved the conflict between immutable approved plan checkboxes and
orchestrated lifecycle. It correctly made persisted state authoritative for
lifecycle and `nextAction`, kept approved artifacts immutable, preserved
standalone checkbox behavior, and required a **Plan Task Completion** table for
new strict implementation reports.

However, ADR-0016 selected Markdown report rows as the primary task-completion
ledger, treated the structured phase result only as corroboration, explicitly
declined a phase-result or state schema change, and relied on model instructions
plus independent review to enforce the table. The current runner does not parse
or validate that table.

The real sandbox project run
`[historical run identifier omitted]` demonstrates terminal false success:

- the exact approved plan contains six immutable unchecked tasks, `T001`
  through `T006`;
- the implementation report has no **Plan Task Completion** section or other
  exact per-task ledger, yet claims completion was recorded in the report;
- the structured implementation result has `outcome=completed` but no task
  records;
- persisted `planArtifacts.implementationReport` remains `null`, and state has
  no task-completion evidence or summary;
- the implementation attempt was recorded `completed`, four deterministic
  verification attempts passed across two rounds, the final reviewer returned
  `pass`, and state became `done` with `nextAction: null`;
- the Claude initialization event proves that the Skill tool and Banzai plugin
  1.11.0, including `banzai:code-writing`, were available, but the complete
  implementation stream contains no Skill invocation.

The repository code explains the result. The v1 phase-result schema and runtime
decoder contain no task ledger. `WorkflowRunner` records a model attempt as
completed before applying its phase result. A completed implementation result
then transitions directly from `implementing` to `verifying`; a passing review
transitions directly from `reviewing` to `done`. Neither boundary validates
plan task coverage, report parity, required report presence, or persisted task
evidence. Human and JSON status expose lifecycle but no runner-computed task
completion.

This evidence invalidates ADR-0016's assumption that a report-owned ledger plus
declarative instructions is proportionate. The workflow needs a machine-owned
completion contract before verification, while preserving ADR-0016's correct
immutability, lifecycle, legacy-truthfulness, and standalone boundaries.

Decision question: Which artifact owns plan-task completion for new strict
orchestrated runs, how is it versioned and projected into reports and state,
and where must the runner enforce it so invalid evidence cannot reach
verification, review, or terminal success?

Decision owner: Banzai maintainers, with explicit user lifecycle approval.

Decision drivers:

- deterministic fail-closed enforcement before side-effecting verification;
- one canonical source rather than structured, Markdown, and state claims that
  can drift independently;
- exact coverage of the immutable approved `TNNN` task set and order;
- approval-digest and approved-artifact immutability;
- Structured Outputs compatibility for both Codex and Claude;
- durable audit, retry, status, review, and evaluation evidence;
- truthful pre-contract legacy behavior without migration or fabrication;
- compatibility with existing configuration and overall Banzai contract
  identity;
- no dependence on whether a model invokes an installed skill;
- preservation of independent review, human triage, verification history,
  evaluation privacy, and existing retry safety.

## Options Considered

### Option 1: Versioned phase-result ledger with derived report and state projections

Introduce a new phase-result schema version for new model calls. Keep the
overall Banzai plugin/orchestrator/config contract identity at `1.0.0`, retain
the current phase-result schema as the immutable legacy v1 definition, and make
the current implementation adapter use phase-result v2.

Phase-result v2 adds an explicit schema-version field and a required nullable
task-completion property because Structured Outputs requires every object
property to be listed as required. A strict orchestrated implementation result
must provide a non-null versioned ledger; phases without an approved strict
task set use `null`. Runtime validation owns phase- and route-specific
requirements that JSON Schema cannot express.

The ledger contains one ordered record per approved task:

- exact `taskId`;
- `completed`, `incomplete`, or `blocked` status;
- bounded repository-relative evidence entries;
- a nullable structured gap/deviation reference that is required for
  `incomplete` and `blocked` and forbidden for `completed`.

The implementation report contains a versioned deterministic Markdown
projection of the ledger. Persisted state contains only an integrity-bound
validated summary and bounded invalid checkpoint, linked to the source attempt,
approval, plan-task-set digest, ledger digest, required reports, and counts.
The canonical full records remain in the versioned attempt result. The runner
validates projection and summary parity whenever it crosses completion,
verification, review, retry, status, or terminal boundaries.

Benefits:

- the schema forces every new model result to acknowledge the completion field;
- cross-field and repository validation occurs before an attempt is successful
  or verification starts;
- Markdown and state become projections with explicit integrity links rather
  than competing authorities;
- old v1 attempts remain identifiable and readable as legacy evidence;
- the overall contract/config identity need not change solely to evolve one
  model-result schema;
- Codex and Claude receive the same closed structured contract;
- evaluator privacy can expose a bounded failure code without raw task paths or
  model prose.

Costs and risks:

- contract loading, release validation, adapters, types, runtime validation,
  attempts, state, status, prompts, review context, evaluation, docs, and
  committed distribution all change together;
- the approved Markdown plan still needs a deterministic parser for the task
  ID set, though not for completion status;
- the report projection needs a versioned exact grammar and escaping rules;
- a normally returned mutable attempt rejected after source edits needs a
  narrowly classified safe retry distinct from unknown partial-process
  failure;
- adding independent per-schema versioning makes contract documentation and
  release parity checks more explicit.

### Option 2: Dedicated durable runner artifact as the canonical ledger

Require the implementer to write a machine-readable completion artifact at a
deterministic run-local or repository path. Validate it before verification,
copy or bind it into runner state, and derive the Markdown report from it.

Benefits:

- phase-result v1 can remain byte-identical;
- the completion ledger has a dedicated lifecycle and schema;
- the runner can retain a durable canonical object independently of model
  result parsing.

Costs and rejection reason:

- current vendor invocations have one structured result channel; a second
  model-written JSON file would need separate discovery and trust rules;
- a repository artifact can be edited independently after model return, while
  a run-local artifact requires the runner to reconstruct it from an
  unversioned source;
- binding, atomicity, retry, and report-generation complexity exceed the
  phase-result option without improving the trust boundary;
- it creates another artifact identity when the canonical model attempt already
  exists durably. Rejected because the phase result is the narrower existing
  contract boundary.

### Option 3: Keep Markdown primary and add a strict table parser

Retain ADR-0016 ownership, define a versioned Markdown table grammar, parse it
before verification, and persist a derived summary.

Benefits:

- no model-result schema evolution;
- humans see and edit the primary evidence directly;
- the implementation skill already requests the table.

Costs and rejection reason:

- the confirmed defect is precisely that the model omitted the report contract
  while returning a valid completed phase result;
- Markdown becomes a machine authorization boundary with escaping, duplicate
  section, and ambiguous-format risks;
- structured outcome and state remain separate claims that must still be
  reconciled;
- model prose remains too close to the primary trust boundary. Rejected because
  the runner already has a stronger structured-output channel.

### Option 4: Enforce skill invocation and harden prompts only

Require observable `banzai:code-writing` and `banzai:test-writing` Skill tool
calls and reject a result when progress events do not contain them.

Benefits:

- directly addresses the observed skipped skill;
- small prompt and adapter surface;
- improves operator diagnostics.

Costs and rejection reason:

- skill progress events are vendor-specific execution telemetry, not completion
  evidence;
- a model can invoke a skill and still omit or falsify the ledger;
- Codex and Claude can change event shapes independently;
- standalone plugin and resumed-session behavior would become coupled to tool
  telemetry. Rejected as a correctness boundary. Prompt hardening remains a
  defense-in-depth consequence of Option 1.

## Decision

Adopt Option 1.

Supersede ADR-0016's report-owned completion authority. Preserve ADR-0016's
approved-artifact immutability, state-owned
lifecycle and `nextAction`, standalone checkbox fallback, contradiction
visibility, independent review, and prohibition on retroactive legacy repair.

Version the model-result boundary per schema:

- retain the current phase-result schema as legacy v1;
- introduce phase-result v2 for all new orchestrator phase calls;
- keep umbrella `contractVersion: 1.0.0` and existing configuration
  compatibility;
- add an explicit phase-result `schemaVersion` and a required nullable
  `taskCompletion` property;
- require a self-versioned non-null completion ledger for every strict
  orchestrated implementation result after plan approval;
- require `taskCompletion: null` where no approved strict task set is owned by
  that phase;
- decode historical v1 attempts only as legacy persisted evidence and never as
  valid new implementation completion.

The exact approved plan owns only the ordered task identifier set. Parse the
`## Implementation Tasks` section using the canonical checkbox task-heading
grammar already emitted by `development-plan`. Reject duplicate, malformed, or
ambiguous task declarations before completion can be accepted. Never edit the
plan or infer completion from its checkbox state in orchestrated mode.

Make the phase-result v2 ledger the sole canonical completion source. Require
exact ID coverage and order, allowed status values, repository-scoped evidence,
and status-consistent gap/deviation references. A completed phase outcome is
valid only when every approved task is `completed`.

Evidence paths must be normalized repository-relative paths that resolve to
existing files inside the canonical repository. Reject absolute paths,
traversal, backslash ambiguity, NUL, symlink escape, `.git`, `.banzai`,
dependency/cache output, the immutable approved bundle as implementation proof,
and paths outside the runner-owned changed surface. The exact required
implementation and test reports are allowed projection/assurance evidence. A
completed task must cite at least one allowed evidence path; an incomplete or
blocked task must provide a structured reference to an explicit report gap or
deviation.

Define **Plan Task Completion** format
`banzai-plan-task-completion/v1` as the human projection. The runner renders the
expected projection from the canonical ledger and validates that the report's
single section represents exactly the same records. The runner does not choose
between conflicting sources and does not edit the approved plan. The
implementation report remains model-authored; missing or non-equivalent
projection fails closed.

Validate completion after the model returns but before the attempt is marked
completed. On failure:

- persist the attempt as `failed`, retaining its structured result when safely
  decoded and retaining existing redacted raw-output references;
- do not add its ID to completed-attempt metrics;
- do not run verification or review;
- block from `implementing` with code `PLAN_TASK_COMPLETION_INVALID` and a
  bounded deterministic diagnostic;
- persist one invalid completion checkpoint linked to the failed attempt;
- emit a completion-validation event for retry and privacy-minimized evaluation.

Permit `banzai retry` only for a normally returned implementation result whose
sole runner rejection is completion validation and whose base commit and
approval remain valid. Resume the compatible implementer lineage with an
evidence-repair instruction and create a new unique attempt. Preserve the
invalid prior attempt and event. Do not enable retry for interrupted or
process-failed mutable attempts with unknown partial effects. A successful
retry replaces the single active state summary; it does not overwrite prior
attempt evidence or append duplicate task records to state.

Persist a versioned completion summary outside `planArtifacts`. The summary is
derived from the canonical attempt and includes its source attempt, approval
digest, plan-task-set digest, ledger digest, report paths and digests, total and
per-status counts, and validation time. It is not a second task ledger. An
invalid checkpoint contains only bounded identity, error code, and diagnostic
data needed for status and retry.

Revalidate canonical attempt, summary, report projection, required report,
approval, plan-task set, and workspace evidence:

1. before every verification round;
2. before independent review;
3. after accepted-finding fixes and before re-review;
4. before applying reviewer `pass`;
5. before zero-accepted human triage enters `done`;
6. whenever status reports exact completion.

Pass the validated task records and summary to the independent reviewer. The
reviewer checks material contradictions against source, tests, reports,
verification, and approval, but deterministic validation remains primary. A
reviewer `pass` cannot override `PLAN_TASK_COMPLETION_INVALID`.

Add a computed task-completion object to human, interactive, and JSON status.
Persisted state continues to own lifecycle and `nextAction`. Exact `N/N` is
available only from a currently valid v2 ledger and summary. State without the
new field is pre-contract legacy: retain lifecycle, show completion as
`unknown` or `legacy`, and report bounded diagnostics without parsing prose into
fabricated completion. Standalone non-orchestrated status continues to use
mutable checkboxes.

Keep `banzai-evaluation-export/v1` top-level fields and failure categories
unchanged. A rejected implementation attempt already contributes to
`model_attempt`; add a bounded completion-specific issue derived from the
runner event rather than exporting ledger content, task paths, report prose, or
state diagnostics. Preserve exact `*-result.json` exclusion and all existing
privacy allow-lists.

Strengthen Codex and Claude prompts to require an actual load of the named
Banzai skill and to state ledger/report obligations. Keep Skill available in
both adapters and cover prompt/argument parity. Do not reject otherwise valid
completion evidence merely because vendor telemetry did not expose a skill
event, and do not accept invalid evidence because it did.

Synchronize contracts, runtime validation, state machine, store, status,
review, evaluation, adapters, prompts, skills, installed rules, templates,
root/product/orchestrator documentation, release validation, and committed
distribution. Add no dependency and make no release-version change.

## Consequences

Positive:

- terminal success becomes impossible without exact approved-task coverage;
- the runner, not model behavior, owns the enforcement boundary;
- machine, Markdown, state, review, status, and evaluation claims have one
  canonical source and deterministic parity rules;
- the immutable approval bundle remains unchanged;
- invalid implementation evidence is rejected before any verification cost;
- completion-specific retry is auditable without weakening unknown-partial
  mutable-attempt safety;
- legacy terminal runs remain truthful and visible without fabricated `N/N`;
- standalone checkbox workflows keep existing behavior.

Negative:

- a second phase-result schema version and per-schema contract routing are
  required;
- implementation results and reports become stricter and older model output is
  rejected for new runs;
- status must read and revalidate more bounded local evidence;
- evidence repair may require another model turn even when source code itself
  is already correct;
- old orchestrated runs without v2 evidence cannot receive exact task counts
  from the corrected runner.

Risks and required follow-ups:

- Markdown projection drift: keep one versioned renderer/parser and compare
  semantic records, including escaping and duplicate-section cases;
- plan task parsing: keep one canonical task-heading grammar in
  `development-plan` and reject ambiguity at approval/completion boundaries;
- evidence scope false positives: test carried-in baseline, approved artifacts,
  reports, symlinks, deleted paths, and unusual names without weakening
  repository containment;
- retry duplication: preserve unique attempt identity, completed-attempt
  metrics, active summary replacement, and evaluation deduplication;
- review timing: revalidate immediately before all terminal transitions, not
  only before the initial review;
- contract drift: release validation must check v1 legacy retention, v2 current
  schema identity, adapter selection, runtime constants, and committed bundle
  parity;
- historical interpretation: the corrected runner must show the sandbox project run
  as lifecycle `done` with task completion unknown/inconsistent, not silently
  convert it to failure or success evidence.

## Compliance and Confirmation

Implementation and independent review must confirm:

1. a valid approved `T001`-`T006` fixture accepts six ordered completed records,
   starts verification, reports `6/6`, and preserves approval bytes/digest;
2. missing ledger or legacy report format fails before verification even when
   the model did not invoke a skill;
3. missing, duplicate, unknown, out-of-order, malformed-status, incomplete, and
   blocked task cases fail with `PLAN_TASK_COMPLETION_INVALID`;
4. absolute, outside-repository, traversal, symlink-escape, missing,
   control-state, approved-bundle-only, and out-of-scope evidence fails closed;
5. structured ledger and Markdown projection mismatch fails closed;
6. required implementation/test report absence or digest mismatch fails closed;
7. a reviewer `pass` and zero-accepted triage cannot enter `done` when
   completion validation fails;
8. the validated summary is outside `planArtifacts`, integrity-bound to its
   source attempt and approval, and never becomes a second full ledger;
9. completion-validation retry creates a unique attempt, preserves the rejected
   attempt for evaluation, and does not duplicate task, model-attempt,
   verification, or state-summary evidence;
10. process-failed or interrupted mutable attempts remain non-retryable;
11. a legacy terminal fixture keeps lifecycle/next action while completion is
    unknown/legacy, and the read-only sandbox project run diagnoses its missing task
    projection without mutation;
12. standalone mutable checkbox completion remains unchanged;
13. evaluation reports the failed attempt and bounded completion issue without
    raw task records, paths, prose, or result files;
14. Codex and Claude prompts and allowed-tool arguments name the required skill
    load and current phase-result schema, while deterministic rejection remains
    independent of skill telemetry;
15. existing verification ledger/history, retained-window, exact raw-result
    exclusion, malformed canonical evidence, Git baseline/NUL, doctor/auth,
    human gate/triage, review rotation, approval, hook, authorization, and
    privacy tests remain passing;
16. focused suites, full orchestrator tests, typecheck, formatter, build/dist
    parity, `npm run verify`, conditional `npm run release:check`, diff check,
    and scratch status/doctor/eval smoke report exact commands and outcomes;
17. no live vendor call, dependency, release-version change, release, commit,
    push, global reinstall, or sandbox project write occurs.

## Lifecycle Links

- Amended by [ADR-0042](./0042-runner-delivered-phase-instructions.md), accepted
  2026-09-11: runner implementation/assurance receive their complete obligations
  through embedded instructions instead of required host skill loading.
  Approved task authority, completion ledger/projection, reporting and fix
  refresh remain binding. Implementation of this amendment is Planned.
- Supersedes: ADR-0016
- Superseded by: None
