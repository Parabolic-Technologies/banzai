# Effectiveness Task Worksheet Template

Reference fields only as of 2026-09-06: routine manual spreadsheet entry was
rejected by the user. See the
[Private work history](../historical-references.md).
This template remains empty and does not imply an implemented CLI interface.

Copy outside both repositories. Keep this tracked template empty. See
[method](effectiveness-study.md) for definitions and
runbook (historical record omitted from public source) for collection. Blank means not yet entered;
use explicit `unknown` or `not_applicable` when reviewed. No request text,
transcripts, personal data or secrets belong here; use private reference IDs.

## Study setup — one copy per pilot

| Field                                                            | Value |
| ---------------------------------------------------------------- | ----- |
| Study ID / method revision and digest                            |       |
| Retention owner ID / private location / review or deletion date  |       |
| Intake start / target task count / planned cutoff rule           |       |
| Participating repository and engineer IDs                        |       |
| Eligible task types / complexity and risk definitions            |       |
| Screening exclusions and allocation method                       |       |
| Native condition procedure / required shared rules               |       |
| Proposed threshold choices approved by / at / decision reference |       |
| Time-benefit, coverage, sample and quality decision thresholds   |       |
| Follow-up window / independent evaluator / blinding procedure    |       |
| Environment/configuration compatibility segments                 |       |

Screen every candidate before its outcome is known; include excluded candidates.

| Screening ID | Screened at | Repository / engineer IDs | Type / complexity / risk | Eligible? | Exclusion reason | Task ID if enrolled | Pair / segment ID | Pre-work allocation evidence | Assigned condition |
| ------------ | ----------- | ------------------------- | ------------------------ | --------- | ---------------- | ------------------- | ----------------- | ---------------------------- | ------------------ |

## Task — repeat per enrolled task

| Field                                                                                             | Value |
| ------------------------------------------------------------------------------------------------- | ----- |
| Stable task ID / enrolled at / assigned condition                                                 |       |
| Repository / engineer / additional contributor IDs                                                |       |
| Type / pre-work complexity / risk / rationale reference                                           |       |
| Pair ID / compatibility segment / allocation reference                                            |       |
| Scope / non-goals / acceptance criteria references and digests                                    |       |
| Baseline commit / relevant working-tree delta digest                                              |       |
| Rules, tools/MCP permissions, plugin/bundle versions and digests                                  |       |
| Vendor CLI / model identifier and exposed version / effort per role                               |       |
| Environment, dependencies, verification profile and required checks                               |       |
| Accepting human ID / independent evaluator ID                                                     |       |
| Task formulation started at / evidence / time basis                                               |       |
| Actual condition(s) / crossover or config changes / reasons                                       |       |
| Candidate completion state / time / revision / evidence                                           |       |
| Task state: accepted / failed / cancelled / open / unknown                                        |       |
| Reopened? / time / reason reference / later acceptance evidence                                   |       |
| First acceptance: verified / reported / unknown; time, revision, evidence                         |       |
| Merge: verified / reported / unknown / not_applicable; target and evidence                        |       |
| Deployment: verified / reported / unknown / not_applicable; revision, environment, time, evidence |       |
| Post-deployment check: strength, revision, time, result, evidence                                 |       |
| Outcome cutoff / censored? / follow-up due at / observed through                                  |       |
| Initial time coverage: complete / partial / unknown; missing contributors or activities           |       |
| Initial time basis: measured / estimated / unknown; log revision and digest                       |       |
| Measured / estimated initial minutes; known subtotal if partial                                   |       |
| Triage / manual repair / recovery minutes and coverage (subsets)                                  |       |
| Post-acceptance repair minutes / follow-up coverage and maturity                                  |       |
| Study-only overhead minutes (excluded from engineering time)                                      |       |
| Contributor coverage and non-overlap attestation references                                       |       |
| Independent assessment coverage / blinding / unresolved disputes                                  |       |
| Quality, boundary and environment observations below completed?                                   |       |
| Evaluator / annotation date / worksheet revision / superseded snapshot                            |       |

## Task-to-run and non-run work links

One row per execution or repair. All exact references stay private. Retain
failed
and cancelled work. `same_task_repair`, `continuation`, `new_scope`, and
`unknown` have different meanings. A shared topic is not linkage evidence.

| Link ID | Task ID or unknown | Relationship | Export ID / SHA-256 / run key, or non-run observation ID | Private persisted ID / canonical artifact or Git reference | Evidence type / digest / evaluator rationale | Workflow / terminal state / done basis | Attribution coverage / allocation |
| ------- | ------------------ | ------------ | -------------------------------------------------------- | ---------------------------------------------------------- | -------------------------------------------- | -------------------------------------- | --------------------------------- |

For unresolved work, assign an observation ID and record candidate relationships
and why none is verified. Do not assign a speculative task ID or omit costs.
If one execution covers multiple tasks, allocate once or mark usage partial.

## Quality and explanatory observations

One row per unique defect, boundary incident, environment episode or follow-up.
Use `none_observed` only after a completed assessment and specify its window.

| Observation ID | Task ID | Kind | Dedupe identity / related observation IDs | Original requirement and revision evidence | Discovered at / before or after first acceptance? | Severity / classification / confidence | Disposition / independent evaluator / evidence reference | Human-time block IDs / repair execution links | Assessment window / missing evidence |
| -------------- | ------- | ---- | ----------------------------------------- | ------------------------------------------ | ------------------------------------------------- | -------------------------------------- | -------------------------------------------------------- | --------------------------------------------- | ------------------------------------ |

Kinds: `defect`, `boundary`, `environment`, `same_task_repair`, `new_scope`,
`disputed`, or `none_observed`. Keep a repeated finding as another reference
to its existing identity. User-reported delivery/defects remain reported.

## Frozen evidence register — one copy per study snapshot

| Export ID | Captured at | Export SHA-256 | Candidate inventory / explicit selector reference | Source commit / working-tree digest / bundle digest | Node / dependency versions | Command record / exit status | KPI / context report digests | Read-only snapshot comparison | Issues / coverage |
| --------- | ----------- | -------------- | ------------------------------------------------- | --------------------------------------------------- | -------------------------- | ---------------------------- | ---------------------------- | ----------------------------- | ----------------- |

Keep source-label differences in input-mode KPI output documented. Preserve
original exports without adding annotations. Context reports and selectors can
contain identifying metadata and must remain private.

## Cohort analysis — repeat by assigned condition and compatible segment

| Condition / segment | Enrolled / accepted / unresolved acceptance | Failed / cancelled / open | Time M / E / U | Accepted time M / E / U | Independently assessed / mature follow-up | Initial known minutes / exactness | All-cohort effort per accepted result or unavailable | Accepted-time median / IQR / min-max / n | Elapsed-to-acceptance / censored ages | Rework / defects / boundaries | Decision / limitations |
| ------------------- | ------------------------------------------- | ------------------------- | -------------- | ----------------------- | ----------------------------------------- | --------------------------------- | ---------------------------------------------------- | ---------------------------------------- | ------------------------------------- | ----------------------------- | ---------------------- |

Use the metric dictionary's denominators. Unavailable values remain unavailable;
do not treat an empty template as an observation or the method as a result.
