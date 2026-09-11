# Reviewer Calibration

This public guide describes how to prepare a project-independent reviewer
comparison. Private source-project baselines, case inventories, and capture
records are excluded from the public distribution. No private dataset is a
runtime, test, prompt, or installation dependency.

Use the [comparison protocol](comparison-protocol.md) to define a new study.
Its numerical targets are proposals to freeze before execution, not evidence
that a candidate improves review quality or productivity.

## Authority

Reuse the [evaluation/KPI definitions](../README.md),
[effectiveness method](../effectiveness-study.md), and
[context accounting](../../context/README.md). Preserve the separate
[EQ shadow-promotion policy](../engineering-quality-shadow.md); calibration
neither replaces its thresholds nor changes frozen export/KPI contracts.

Relevant accepted decisions remain binding:
[ADR-0017](../../decisions/0017-versioned-plan-task-completion-ledger.md) and
[ADR-0025](../../decisions/0025-fix-authored-completion-ledger-refresh.md) own
completion integrity; [ADR-0037](../../decisions/0037-unified-runner-rendered-review-artifacts.md)
owns the current review output contract;
[ADR-0026](../../decisions/0026-derived-evaluation-kpi-projection-contract.md)
owns derived KPIs; [ADR-0028](../../decisions/0028-phase-context-accounting-and-budget-policy.md)
owns context accounting; and
[ADR-0030](../../decisions/0030-vendor-neutral-engineering-quality-policy.md)
owns EQ semantics.

## Prepare cases

For each case, record an opaque case ID and task group, evidence origin,
revision and content hashes, reconstruction gaps, permitted input manifest,
expected answers, adjudication status, and intended calibration or held-out
use. Keep every variant and iteration of one task in the same split.

Include the applicable binding requirements, code or artifacts, and available
verification evidence. Keep expected findings, acceptable alternative remedies,
and adjudication records separate from evaluator-visible inputs. Match findings
by violated authority, stable locus, root cause, and independently remediable
impact, rather than wording or a historical finding ID.

Historical human triage is evidence of disposition, not ground-truth
correctness. Accepted findings are not automatically correct, and rejected
findings are not automatically false. A minimized or reconstructed fixture
must not be described as an exact historical replay.

## Isolation and adjudication

Give evaluators only the files explicitly listed in each input manifest. Keep
answers, source registers, capture scripts, later fixes and reviews, and builder
transcripts outside that workspace. Supply prior triage only when it existed
at the chosen boundary and is needed for resolution review.

Record prior exposure to cases. Held-out cases must be reserved from candidate
tuning; use independent evaluators and replace contaminated task groups before
claiming a blind holdout. Human adjudicators verify input fidelity, binding
authority, materiality, expected defects or absence, and acceptable remedies
before scoring. Preserve disagreements. Exclude insufficient evidence from
scored denominators rather than treating it as a pass or zero.
