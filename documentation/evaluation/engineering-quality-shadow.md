# Engineering Quality Shadow Evaluation

## Purpose

This procedure evaluates ADR-0030's initial non-blocking Engineering Quality
rollout. It measures both overlap with ordinary Banzai findings and useful
incremental concerns that the EQ pass identifies after the ordinary verdict is
frozen.

The procedure is a sampled maintainer evaluation, not a workflow phase, runtime
contract, gate, or mandatory human-triage queue. It reuses
`banzai-evaluation-export/v2`, `banzai-evaluation-kpi/v2`, and canonical review
artifacts. Do not add fields to those contracts or parse `EQ-SHADOW:` strings in
runtime code for this rollout.

## Cohort

Select 20–30 completed strict runs whose first independent review used the
shadow policy. Include more than one repository or materially different stack,
more than one change type, and at least two reviewer vendor/model signatures
when available. Record eligible-run count, sampled-run count, selection dates,
and selection rationale so coverage and selection bias are visible.

Inspect at least 10 distinct shadow candidates before drawing a promotion
conclusion. If 20 completed reviewed runs produce fewer than 10, continue to 30
runs. If the full cohort still produces fewer than 10, record the evaluation as
insufficient evidence and keep shadow mode. Double-review at least 10 unique
shadow candidates, or all of them when the cohort contains fewer than 10; fewer
than 10 cannot satisfy the advisory-promotion disagreement threshold.

Use `banzai eval export` to identify the cohort and `banzai eval kpi` for the
ordinary reviewer baseline. Inspect each sampled run's applied canonical review
artifacts for ordinary EQ mappings and `EQ-SHADOW:` entries. Failed or
non-canonical attempt candidates are diagnostic evidence only and stay out of
the sample.

## Unit of evaluation and deduplication

An ordinary mapped finding and a shadow candidate are separate observation
types. Deduplicate candidate wording using the policy identity:

`primary rule + stable code or contract locus + violated authority + impact class`.

Line-number drift, reviewer wording, and repeated evidence for one root cause do
not create another identity. Distinct observable consequences that require
independent remediation may remain separate. Record the canonical identity and
all source review/run references in the evaluation worksheet.

## Primary classifications

Assign exactly one primary classification to every observed mapping or shadow
candidate:

| Classification                  | Applies when                                                                                                                                                                                                          |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `existing_finding_mapped_to_eq` | The concern was already an ordinary actionable finding before EQ classification and has one primary EQ mapping. This measures overlap; it is not incremental yield.                                                   |
| `new_useful_shadow_candidate`   | The record is genuinely incremental, has exact current evidence and material impact, is consistent with the authority order, proposes the smallest reasonable remediation, and has an observable verification method. |
| `duplicate`                     | The semantic identity duplicates an ordinary finding or another candidate in the applicable review lineage/cohort and adds no independently remediable impact.                                                        |
| `rejected_no_material_impact`   | The evidence may be factually accurate, but no current material consequence or violated authority justifies action; this includes preference-only design advice.                                                      |
| `false_positive`                | The evidence, code path, authority, claimed consequence, or applicability is materially incorrect or unsupported.                                                                                                     |

Classify a duplicate before judging whether its repeated prose sounds useful;
duplicate records do not count as incremental yield. Missing semantic fields are
measured separately as shape incompleteness and do not automatically turn a
factually valid candidate into a false positive.

## Cross-reviewer agreement

For every identity selected for double review, a second reviewer independently
assesses the current evidence, authority, impact class, and primary
classification without seeing the first reviewer's prose. Record one orthogonal
agreement value:

- `agree`: both reviewers select the same semantic identity and primary
  classification;
- `disagree`: they differ on identity, materiality, authority, or primary
  classification;
- `not_double_reviewed`: no independent comparison exists.

Cross-reviewer disagreement is not a sixth primary classification. Keeping it
orthogonal allows disagreement to be measured for useful, rejected, duplicate,
and false-positive records alike. Resolve disagreements for the evaluation by
the policy authority order, not by reviewer majority or preferred design. An
explicit approved user/specification choice or accepted ADR overrides generic
quality preference; a legacy test is evidence, not an automatic veto of an
intentional approved change.

## Shadow isolation and resolution checks

For every sampled run, confirm that a shadow-only candidate:

- did not enter ordinary `findings`;
- did not change an ordinary finding's severity or the review verdict;
- received no required triage disposition and did not become accepted;
- was absent from the accepted-finding payload and fixer scope;
- did not change completion, create a gate, or consume a fix cycle.

For every sampled fix/re-review lineage, also inspect whether a rejected,
deferred, or semantically identical concern was reopened against unchanged
evidence and authority. Count any such event as a resolution rediscovery
violation. A permitted new concern must name evidence that the fix introduced,
newly exposed, directly regressed, or made a previously unobservable critical
correctness/security/lifecycle issue visible.

Any isolation or resolution rediscovery violation keeps the rollout in shadow
mode regardless of other metrics.

## Minimum worksheet fields

Keep the sampled result in a dated Markdown file under
`documentation/evaluation/`. For each observation record:

- run ID, repository/cohort label, review iteration, and reviewer signature;
- ordinary finding ID or shadow candidate ID;
- primary EQ rule, semantic dedupe identity, and stable evidence location;
- primary classification;
- whether every proposed semantic field was present: severity, confidence,
  evidence/location, impact, remediation, references, verification, dedupe key,
  and waiver state;
- agreement value and second-reviewer signature when applicable;
- isolation violation and resolution rediscovery violation flags;
- one concise evaluator rationale.

This worksheet is evaluation evidence, not a serialized runtime schema. Field
names may evolve during shadow mode as long as the metrics below remain
comparable and the canonical review artifact is preserved as source evidence.

## Minimum metrics

Report counts, denominators, and percentages; use `unavailable` rather than zero
when a denominator is absent.

| Metric                            | Definition                                                                                                                                                |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sample coverage                   | reviews with an available applied canonical artifact and completed worksheet / sampled reviewed runs                                                      |
| EQ overlap rate                   | `existing_finding_mapped_to_eq` / all ordinary findings in sampled reviews; also show counts by EQ rule                                                    |
| Incremental candidate yield       | unique shadow candidate identities and runs containing at least one unique candidate / sampled reviewed runs                                               |
| Useful incremental rate           | `new_useful_shadow_candidate` / unique non-duplicate shadow candidates                                                                                    |
| Duplicate rate                    | `duplicate` / all recorded shadow candidates                                                                                                              |
| No-material-impact rate           | `rejected_no_material_impact` / unique non-duplicate shadow candidates                                                                                    |
| False-positive rate               | `false_positive` / unique non-duplicate shadow candidates                                                                                                 |
| Shape completeness                | records containing every semantic field / all mapped ordinary findings and shadow candidates                                                              |
| Cross-reviewer disagreement       | `disagree` / double-reviewed candidate identities                                                                                                         |
| Shadow isolation violations       | candidates that changed verdict/severity, entered `findings`, required triage, entered accepted-fixer scope, or affected completion                       |
| Resolution rediscovery violations | new findings or candidates satisfying none of the four permitted conditions, including unchanged rejected/deferred concerns reopened during resolution review |

Alongside these metrics, compare the existing `first_review_pass_rate`,
`first_review_mean_findings`, `first_review_acceptance_rate`,
`reviewer_precision`, `zero_accepted_review_rate`, `triage_deferred`, and
`fix_cycles_per_completed_run` against the previous representative baseline.
These outcomes detect ordinary-review or convergence regressions that shadow
records alone cannot show. Do not use `first_review_pass_rate` alone as a
review-quality measure.

## Decision threshold for advisory rollout

Recommend a separate ADR for advisory EQ findings only when all conditions hold:

- exactly zero shadow-isolation violations;
- exactly zero resolution rediscovery violations;
- at least 90% semantic shape completeness;
- at least 70% candidate usefulness among unique non-duplicate candidates;
- at most 10% false positives;
- at most 20% duplicate observations;
- at most 20% disagreement across at least 10 double-reviewed identities;
- at least five useful incremental identities across at least three runs and at
  least two EQ rules;
- no material deterioration in the ordinary reviewer and fix-cycle KPIs above.

The cohort-size and candidate-count requirements must also be met. Passing these
thresholds permits only a proposal for advisory findings; it does not authorize
hard enforcement, blocker eligibility, mandatory runtime fields, or automated
EQ KPI extraction. Missing, partial, or contradictory evidence keeps the policy
in shadow mode.
