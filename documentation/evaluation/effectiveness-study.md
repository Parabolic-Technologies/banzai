# Practical Effectiveness Study

This is a proposed analytical method. Freeze its numerical pilot choices with
the study owner before intake; they are not runtime policy or evidence of
Banzai's effectiveness. Private retrospective reports are not part of the
public source distribution.

Question: **For which task types does Banzai reduce active human minutes per
accepted change while preserving result quality and agreed work boundaries?**

The [task worksheet](task-worksheet.md) is an empty analytical reference and
the [manual human-time log](#manual-human-time-log) is a column format only.
The CLI provides run-level gate elapsed and
optional active-time estimates under ADR-0034, plus optional cancellation
reasons and read-only reporting under ADR-0035. Neither provides task-wide
native-workflow comparison or independently measured acceptance and quality.

Record the adoption revision and observation window for each study. Preserve
unknown task links, missing measurements, unsuccessful work, and coverage gaps.
A run cancellation fraction is not a failed-task rate; technical context does
not establish human motivation. Synthetic fixtures are verification evidence,
not observations of effectiveness.

## Authority and scope

This document defines study semantics, not an implemented runtime feature or
evaluation-contract extension. Its manual collection procedure is
retained as a study-design reference alongside the CLI observation component.
[ADR-0003](../decisions/0003-versioned-evaluation-export-contract.md),
[ADR-0004](../decisions/0004-privacy-minimized-read-only-evaluation-boundary.md),
[ADR-0005](../decisions/0005-traceable-evaluation-aggregation.md),
[ADR-0015](../decisions/0015-durable-verification-attempt-ledger.md),
[ADR-0026](../decisions/0026-derived-evaluation-kpi-projection-contract.md), and
[ADR-0028](../decisions/0028-phase-context-accounting-and-budget-policy.md)
remain authoritative. Use the canonical [KPI definitions](README.md#kpi-set)
and [context surfaces](../context/README.md#evidence-surfaces); do not redefine
them in worksheets. The first-stage
integrity fix (historical record omitted from public source) is an
input prerequisite, not a productivity intervention in this study.

All authorization, repository rules, human gates, independent review,
verification, privacy, and recovery requirements continue to apply. No model
settings, profiles, schemas, contracts, or limits change for this study.
The completed-run sampling used for
[EQ shadow evaluation](engineering-quality-shadow.md) and context-budget
research answers different questions; it must not replace this study's
all-outcome task cohort.

## Units, identities, and outcomes

- **Task:** one agreed engineering result with recorded scope and acceptance
  criteria. Assign a permanent study-local ID before work, such as `PROJECT-T001`.
- **Run:** one Banzai execution. Cancellation and continuation can belong to
  one task. A native task can have no Banzai run and several native sessions.
- **Attempt:** one physical phase execution. A reconciliation is not another
  attempt; a retry with a new physical identity is. Attempts are not independent
  task observations.

Join runs only through direct evidence: the same approved artifact bundle,
explicit artifact references identifying a continuation, or an independently
verified work-item relationship with unchanged scope. Record evidence type,
reference, content digest, interpretation, and evaluator. A shared ticket,
slug, topic, branch, or nearby timestamp alone is insufficient. Conflicting
evidence stays unresolved. An unknown run gets an unresolved-observation ID,
not an invented task. Keep its costs visible and outside identified-task
denominators until the join is established.

Repairs necessary to deliver the original agreed result stay with its task,
including failed/cancelled runs and manual work outside the runner. A separately
approved extension with different acceptance criteria gets a new task ID and a
`new_scope` relationship. A later finding is not automatically a defect missed
by the earlier task. Deduplicate defects by violated requirement/authority,
stable code or contract locus, root cause, and independently remediable impact;
record all finding/review references without counting changed wording twice.

Every run reference is `(export_id, export_sha256, run_key)`. Export-local
`run-000001` is never a global ID. Keep the mapping to persisted IDs private.
One physical attempt or human-time entry contributes once across linked runs.
If a run serves several tasks, document an allocation; unresolved allocation
keeps task usage partial rather than copying the full run total to each task.

Record these separately, with an evidence reference and time when known:

| Outcome                 | Required evidence                                                                                                                |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Workflow done           | Persisted Banzai status, with review/triage completion basis; native uses `not_applicable`                                       |
| Candidate complete      | Engineer claims all agreed work ready for acceptance; not acceptance itself                                                      |
| Change accepted         | Authorized accepting human explicitly accepts an identified revision against the agreed criteria and checks                      |
| Change merged           | Identified change integrated into the specified target, demonstrated by merge/ancestry evidence or an authoritative merge record |
| Change deployed         | Deployment record ties that revision to the named environment                                                                    |
| Post-deployment checked | Dated result of the specified checks against that deployed revision/environment                                                  |

Use `verified`, `reported`, `unknown`, or `not_applicable` for evidence
strength.
User-reported delivery remains `reported` until corroborated. A merge is not
proof of deployment. Neither `done`, a passing review, nor plan approval is
task acceptance. Acceptance can occur before a merge, and work from a cancelled
run can later be integrated. Preserve the original first acceptance when work
is reopened; record the repair and later acceptance separately.
For disjoint cohort counts, the accepted bucket means accepted at least once
by the cutoff, including reopened tasks, whose count is shown separately.
The failed, cancelled, open and unknown buckets contain only tasks without
verified first acceptance. Never remove a costly reopened task from its original
acceptance denominator.

## Metric dictionary

Let `C` be all enrolled tasks in an assigned condition at the fixed cutoff,
`A` the tasks with verified first acceptance by that cutoff, and `H_i` active
person-minutes from task formulation through first acceptance, or through the
cutoff/terminal cancellation for tasks without acceptance. All human
contributors count, including reviewers and approvers. Do not count a task's
post-acceptance repair in `H_i`; it has its own follow-up measure below.

`M` is the subset with complete measured time; `E` has complete time containing
at least one estimate; `U` has partial or unknown time. Counts of `M/E/U` must
always accompany results. A zero denominator means unavailable, never zero.
Post-acceptance follow-up coverage is independent of initial-time coverage.
Include hands-on implementation and task-specific environment/tool preparation
as active work too. Record pre-assignment scoping time contemporaneously and
attribute it to the enrolled task in either condition; the assignment still
precedes solution execution and knowledge of the result.

| Metric / unit                                                            | Source and rule, numerator / denominator                                                                                                                                                  | Inclusion and coverage                                                                                                                                                                                                                            | Interpretation limit                                                                                                                                         |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Active human minutes per accepted change** / task, person-minutes      | Manual time log; primary distribution of `H_i` for `A ∩ M`. Also report `sum(H_i for A ∩ M) / count(A ∩ M)`                                                                               | Include formulation, clarification, approvals, review/triage, active verification, debugging, manual repair and recovery across all linked runs. Show accepted tasks in `M/E/U`; `A ∩ E` is a separately labeled sensitivity view                 | Accepted-only results can hide abandoned work; incomplete time is not an exact total. No historical reconstruction from runtime timing                       |
| **All-cohort effort per accepted result** / condition, person-minutes    | `sum(H_i for all C) / count(A)` when all time and acceptance statuses are known                                                                                                           | Includes failed, cancelled and unfinished work. With gaps, show known time subtotal, tasks with gaps, verified acceptance count and unresolved acceptance count; exact ratio unavailable. Separate complete measured and estimate-inclusive views | An interim ratio includes open tasks' costs before possible acceptance; show cutoff and unresolved work. Never silently remove failures to improve the ratio |
| End-to-end elapsed / task, hours                                         | Verified first-acceptance time minus the start of task formulation                                                                                                                        | Include passive waits, weekends, all linked runs. Show start/acceptance coverage. Unaccepted tasks have censored age at cutoff, separately from elapsed-to-acceptance                                                                             | Run creation/update span or summed process duration is not task delivery time                                                                                |
| Completion and acceptance / task, count and fraction                     | `verified accepted tasks / all enrolled C`; candidate-complete and workflow-done counts are separate                                                                                      | Show accepted, explicitly not accepted, failed, cancelled, open and unknown; uncertain acceptance makes the rate a verified lower bound, not an exact rate                                                                                        | Cancellation of one run is not necessarily task failure. No runner status substitutes for human acceptance                                                   |
| Triage, manual repair, recovery / task, person-minutes                   | Sums of the mutually exclusive activity categories in the time log; counts of tasks with each activity                                                                                    | Include activities in all outcomes; measured/estimated/unknown and category coverage accompany each sum                                                                                                                                           | These are subsets of human time, not additional costs to add to it. Environment repair uses `recovery`, with a separate cause tag                            |
| Rework after first acceptance / task, person-minutes and incidence       | `sum(post_acceptance repair/debugging/recovery minutes)`; affected tasks / accepted tasks with complete follow-up                                                                         | Same-scope repairs during the fixed follow-up window; link new runs and non-run repairs. Report minutes, incidents and observation maturity; new scope excluded with a reason                                                                     | Without first acceptance or complete follow-up, timing/incidence is unknown, not zero. Later discovered events remain append-only updates                    |
| Material defects missed before acceptance / task and deduplicated defect | Independent evaluator confirms a violated original criterion present in the accepted revision; report unique defects and affected tasks / accepted tasks with complete quality follow-up  | Use all acceptance checks and follow-up observations; distinguish major, minor and disputed. Record introduction/existence evidence and discovery time. Defer disputed classification                                                             | Human acceptance of a finding is agreement, not ground-truth precision. A pre-existing out-of-scope issue or new request is not an escaped defect            |
| Mandatory-boundary violations / task and incident                        | Independent evidence-backed assessment of scope, authorization, privacy, review independence, verification or recovery rules; report confirmed incidents, affected tasks / assessed tasks | Include failures and cancellations, suspected incidents and unassessed tasks. A confirmed zero requires a completed assessment; a missing assessment is unknown                                                                                   | A logged runtime failure does not itself prove a boundary violation or a safe outcome                                                                        |
| Model usage / run/attempt, explanatory                                   | Existing covered export/KPI usage; allocate each physical attempt once to tasks where justified                                                                                           | Preserve exact/partial/unavailable coverage, failed attempts and cancelled runs; configuration signatures remain the canonical KPI signatures                                                                                                     | Cumulative vendor input tokens are not runner payload bytes. Reported cost subtotal is not full cost; subscription usage is not API-dollar cost              |
| Environment failures / task and incident, explanatory                    | Existing closed failure evidence or manual observation with a corroborating artifact; record classification, affected tasks, human recovery minutes and passive wait separately           | Include both conditions and all outcomes; keep `unknown` causes and distinct failure episodes                                                                                                                                                     | Generic model/verification failures do not establish environmental root cause. Counts do not determine engineering quality or human effort                   |

Study-only annotation and adjudication time uses `stage=study_overhead`, is
reported separately by condition, and is excluded from engineering-time
comparisons. Ordinary review needed to accept the change belongs in `H_i`.
Optional economics would require a separately approved valuation model; none
is provided here.

## Manual human-time log

Reference format only: this is no longer the proposed routine user interaction.
An interactive replacement must preserve the distinctions below. In particular,
gate response timestamps measure elapsed waiting; a user correction supplies
an estimate, not measured active time. If estimates become the pilot's primary
basis, revise and agree the measured-time coverage/decision rules before intake.

Keep the log as a private CSV with the columns `entry_id`, `block_id`,
`task_id`, `person_id`, `stage`, `activity`, `mode`, `time_basis`,
`started_at`, `ended_at`, `minutes`, `allocation_fraction`, `recorded_at`,
`evidence_ref` and `gap_or_correction_ref`. One row is a person's active block
allocated to one task and activity. Use pseudonymous people and private
reference IDs.

- `entry_id` is unique; corrections replace the erroneous entry with a recorded
  correction note, rather than adding both to the total.
- `task_id` and `person_id` reference the private worksheet. `recorded_at` is
  the timezone-bearing logging time; `evidence_ref` names the timer/scheduling
  or classification evidence, and `gap_or_correction_ref` explains missing or
  corrected work without copying private prose into a public dataset.
- `block_id` identifies one real block for one person. Several task allocation
  rows can share it. Their `allocation_fraction` must sum to at most 1.
- `stage`: `pre_acceptance`, `post_acceptance`, or `study_overhead`.
- `activity`: `formulation`, `clarification`, `approval`, `review_triage`,
  `implementation`, `preparation`, `active_verification`, `debugging`,
  `manual_repair`, `recovery`, `other_active`, or `study_recording`. Use one
  primary activity; split a block when it changes. `other_active` requires a
  concise private classification reference so actual work is not omitted just
  because it does not fit another category.
- `mode=interval`: fill timezone-bearing `started_at` and `ended_at`, leave
  `minutes` blank. Base minutes = `(end - start) / 60 seconds`.
- `mode=minutes`: fill actual counted or estimated `minutes`; leave interval
  fields blank. Add a private scheduling reference sufficient to reconcile
  parallel work. Never fill both an interval calculation and a minutes total.
- `time_basis`: `measured`, `estimated`, or `unknown`. A timed interval or a
  contemporaneous timer total is measured; recalled time is estimated. For
  unknown work use `mode=missing`, no numeric duration, and a gap reference.
- Effective contribution = base minutes × `allocation_fraction`. Reject
  negative durations, invalid timestamps and fractions outside `(0,1]`.

Stop the timer during passive model/human waiting and unrelated work. Do not
derive time from `updatedAt - createdAt`, event gaps, model duration, message
counts or approval counts. Log brief approvals as actual minutes, not a fixed
charge per approval. Estimated entries should be recorded the same day where
possible, with the estimation basis; delayed recall must remain labeled.

For one person, overlapping distinct blocks must be reconciled before totals
are exact. Split the real active time or allocate a single block across tasks;
never charge the same minute twice because two agents were running. Simultaneous
work by two different humans is two person-minutes per wall-clock minute.
For minutes-only rows, the person explicitly attests that entries do not
overlap; unknown overlap makes the affected tasks partial. A missing row is
not evidence of zero work. At task closure, each contributor confirms coverage
and names any gaps. Freeze that declaration with the log revision.

## Prospective pilot: the next real tasks

### Intake and conditions

Proposed target: **24 consecutive eligible tasks**, within the requested 20–30
range. Freeze the target, intake start, repositories, participants, task-type
definitions and decision thresholds before work. Log every screened task,
including exclusions and reasons, before its outcome is known. Do not create
synthetic work, rerun production work, or start new model runs for this study.

Eligible tasks have an agreed reviewable change, a responsible engineer, written
acceptance criteria, and can safely use either condition. Exclude work already
started, emergency incidents requiring a prescribed response, and tasks whose
mandatory rules prohibit either condition; retain the screening entry. Do not
exclude difficult, security-sensitive, unsuccessful or cancelled tasks merely
because of their outcome. Naturally occurring work supplies the sample.

The conditions are:

1. **Native:** normal Codex/Claude use with repository rules and the same
   mandatory approvals, acceptance checks and independent review. If a
   repository
   requires specific artifacts or gates, perform them in this condition too.
2. **Banzai:** ordinary Banzai routing, orchestration and existing gates, under
   those same repository requirements.

Record how the native condition is actually performed, including any installed
Banzai skills/policies required by the repository. If the only permissible
contrast is orchestration versus manual execution of the same policy, state
that narrower intervention. Never disable a required rule to create a control.

Before assignment classify the primary task type as `bounded_bug_fix`,
`cross_layer_bug_fix`, `feature_or_policy_change`, or
`behavior_preserving_refactor`. Record a short evidence-based complexity rating:
`small` (known local mechanism, one component), `medium` (multiple known
components/contracts), or `large` (cross-system change or material technical
uncertainty). Separately record risk as `ordinary` or `elevated` based on
security/privacy, permissions, destructive effects, migration or public contract
exposure. These ratings must precede results; retrospective categories are
explicitly post hoc and are not substituted for them.

### Allocation and comparability

Use paired consecutive **different** real tasks within
`repository × engineer × task type × complexity × risk`. At the first eligible
task in a stratum, record a coin flip privately and assign native or Banzai;
assign the next eligible task in that stratum to the other condition. Keep an
incomplete pair if no compatible second task arrives. The intake coordinator
records the order and flip before work; do not swap assignments after
discovering
difficulty. Do not delay urgent work to complete a pair.

Keep intended assignments in the primary all-enrolled accounting. Record
crossovers, reasons, actual conditions and all costs. A per-protocol comparison
can be secondary, with explicit exclusions; a crossover must not erase the
failed original attempt. Model changes, changed rules or major environment
changes create a new compatibility segment, even within an allocated pair.

Use at least two engineers and two repositories/stacks **if naturally
available**. Otherwise report the actual coverage and restrict conclusions to
that engineer/repository. Do not manufacture diversity or interpret unseen
groups. A study without a native-workflow control cannot establish comparative savings.

Freeze the baseline commit plus working-tree delta digest, vendor CLI version,
model identifier/version when exposed, effort per role, repository rules,
plugin/bundle identity, tools/MCP permissions, session reuse, verification
profile, dependency/runtime/container versions and relevant external-service
conditions. Record `unknown` for unavailable historical or vendor-internal
versions. An alias is not an immutable model build. Record actual changes
during execution. Current configuration cannot reconstruct past settings.

### Shared quality assessment

Before either condition starts, name the accepting human, criteria, required
automated/manual checks, permitted scope and authorization boundaries. Preserve
these identically across conditions. Record check outcomes against the actual
candidate revision; the study creates no additional runtime gate.

Use an independent human evaluator who did not implement the task to assess
criteria, material defects and boundaries from the specification, diff and
verification evidence. Hide condition labels and model findings during their
initial assessment where practical, then reveal provenance to audit boundaries.
Record evaluator identity, independence, blinding feasibility and discrepancies.
The implementing engineer alone cannot provide independent quality evidence.
An independent model review can support the assessment but does not replace
human acceptance or ground-truth adjudication.

Proposed observation window: follow each accepted revision for **14 calendar
days after first acceptance**. Record deployment and post-deployment checks only
when available; a not-deployed change has no production-exposure evidence.
Freeze the pilot's initial outcome cutoff **30 days after the last enrollment**;
tasks still open are censored. Follow tasks accepted by the cutoff for their
full 14 days before the final quality summary. Later acceptance or discoveries
are appended as dated follow-up snapshots, not silently rewritten into the
original cutoff. No incidents observed without complete assessment is unknown.

Assess major defects as those violating a mandatory safety/security boundary,
causing data loss, preventing a required core result or demanding rollback;
other demonstrable criterion violations are minor. Disputed cases remain
unresolved. Record severity rationale and whether the defect existed at first
acceptance. Findings already resolved before acceptance are review workload,
not escaped defects.

## Analysis and proposed decisions

Report enrolled and accepted sample sizes, timing `M/E/U`, quality/follow-up
coverage, open/cancelled/failed tasks and crossovers for each condition and
compatible task-type segment. Compare only like segments; retain unmatched
tasks in descriptive totals. Do not pool incompatible models, settings, rules,
engineers or task mix into a model ranking. Case mix, selection, learning,
ordering, engineer familiarity, model drift, missingness, control contamination
and assessor unblinding are explicit sources of bias.

For at least five complete measured accepted tasks per condition in a compatible
segment, show median, IQR, minimum and maximum `H_i`; below five, show
individual
values/range and label the segment too sparse for a recommendation. Define
quartiles by linear interpolation at sorted index `(n - 1) × p`, with
`p = 0.25, 0.5, 0.75`. Also show the complete-time mean, all-cohort effort
ratio,
elapsed distribution and quality outcomes. For at least five complete compatible
pairs, additionally report the median within-pair difference; otherwise do not
call unpaired observations matched evidence. No inferential significance is
promised from these sample sizes.

**All choices in this paragraph require approval before intake:** practical
benefit means at least **20% and 10 person-minutes** lower median accepted-task
time in a compatible segment. Report the absolute difference and
`1 - median_Banzai / median_native` (unavailable if native median is zero).
Require at least **80% complete measured initial-time coverage in each arm**,
**80% mature independently assessed follow-up among accepted tasks in each
arm**, and the per-segment sample minimum above. All-cohort effort must also
support the direction; with incomplete cohort time its exact ratio is
unavailable and the recommendation remains inconclusive. A descriptive
acceptance decrease greater than **10 percentage points**, or increased
same-scope rework, requires longer collection and investigation. These are
feasibility/practicality rules, not statistical-power guarantees or tolerances
that authorize lower quality.

Any confirmed major escaped defect, scope/authorization/privacy violation,
bypassed required check/gate, or compromised review independence blocks a
recommendation to simplify work on the basis of time savings. Unresolved safety
incidents block that recommendation too. Existing mandatory rules remain
mandatory even if the pilot passes. A recommendation for a specific task type
is provisional and authorizes no product/policy change by itself.

The conclusion is **inconclusive** when groups are sparse or incompatible,
time/acceptance coverage is inadequate, quality follow-up is immature, the
all-cohort ratio is unavailable, estimates change the direction, crossover or
case mix dominates, or practical benefit is below/uncertain around the agreed
threshold. Continue a separately preregistered collection period for the missing
strata or follow-up; do not tune thresholds after seeing outcomes. At 24 tasks,
missing evidence is a valid pilot result, not a reason to invent the remaining
data or declare effectiveness. A later replay would be a separate approved,
isolated experiment with no deployment or access to solutions, review findings
or future commits; no replay is authorized here.

## Storage and publication

Version control contains this method, empty templates and minimized summaries.
Private worksheets contain exact task/run/commit/artifact mappings, approved
scope references, local command records and frozen datasets **outside both
repositories**. Do not add study fields to `.banzai`, evaluation exports or KPI
contracts. Do not copy requests, transcripts, prompts, raw logs, personal data
or secrets into the study package. Store concise classifications and evidence
references instead of raw artifact prose.

No telemetry, activity monitor, external service or new dependency is needed.
Restrict local access, record a retention owner/date, and review the minimized
publication for indirect identification. Temporary storage is working evidence,
not a durable archive. If source evidence later disappears, frozen reports
still support frozen calculations, but a fresh export or artifact audit may no
longer be reproducible. A wider disclosure/export boundary requires a separate
privacy decision; do not implement it through this study.
