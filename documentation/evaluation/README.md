# Evaluation KPIs

`banzai eval kpi` derives the current `banzai-evaluation-kpi/v2` contract
from `banzai-evaluation-export/v2`. It reports verification applicability; run
outcome, review and usage evidence remains available in the export for separate
analysis. Identical inputs produce identical JSON and Markdown. Derivation reads
per-run evidence, never export aggregates or additional files under `.banzai/runs/`.

## Verification applicability in export/KPI v2

`banzai eval export --json` and `banzai eval kpi --json` emit v2 by default.
The optional `--schema-version` accepts only `2`; other versions fail with
`RESOURCE_VERSION_UNSUPPORTED` before producing output.

Export v2 retains the existing run/cohort evidence and adds per-run
`verificationEvidence`: physical attempt ordinals/status/duration, terminal
round/check ordinals, executed/reused/pending dispositions and original physical
ordinals, with exact/incomplete coverage. It includes no raw commands, paths,
work/check/attempt IDs, digests, environment, report or approval prose. Original
physical leaves, capture records and redacted logs must be present and consistent.

KPI v2 accepts only export v2. File inputs and checkout filters remain mutually
exclusive; sources are reported independently and never pooled. Only exact
included runs contribute to counts and arithmetic. Physical retries count as
attempts. Each terminal round/check contributes once to executed or reused checks.
Reuse ratio is reused / (executed + reused), with numerator, denominator, null on
zero and exact/incomplete coverage. Pending, invalid and unsupported evidence
add incomplete coverage. These are disposition counts, not saved time, physical
passes or model calls. The context-attempt/report v1 byte accounting is unchanged.

## Reading the output

Each source has an ordinal, included-run count, exact/incomplete coverage,
physical-attempt count, executed-check count, reused-check count and reuse ratio.
Markdown uses one row per source; JSON preserves the complete current contract.
Sources stay independent. Source filenames, paths and labels are not emitted.

For a comparison, export each selected cohort with
`banzai eval export --json > <project>.json`, then run
`banzai eval kpi --input a.json --input b.json --json`.
Keep private project inputs and derived evidence under the selected private work
binding. Publish only explicitly approved, sanitized research artifacts.
Produce and retain needed history using the matching release before a major
upgrade; current readers never convert earlier exports.

## Engineering Quality Shadow Evaluation

ADR-0030's initial Engineering Quality rollout uses a sampled, non-authoritative
procedure over the existing exports, KPIs, and canonical review artifacts. See
[`engineering-quality-shadow.md`](engineering-quality-shadow.md) for cohort
selection, finding/candidate classifications, deduplication, cross-reviewer
agreement, isolation checks, minimum metrics, and the evidence threshold for a
future advisory-mode decision. The procedure does not add a KPI or runtime
contract field.

## Practical Effectiveness Study

The [effectiveness study](effectiveness-study.md) measures engineering tasks,
including linked cancelled runs and manual repairs, with active human minutes
per accepted change as its primary outcome. Its manual annotations and time
log remain separate from the frozen export/KPI contracts. Exported run evidence and verification KPIs
are explanatory evidence; reviewer agreement alone does not establish result
quality or engineering-time savings.

The [task/run worksheet](task-worksheet.md) is an empty analytical reference
and the [manual human-time log](effectiveness-study.md#manual-human-time-log)
is a column format only. The
[interactive human-time component](../orchestrator.md#interactive-human-time)
provides run-level gate elapsed and optional active-time estimates. Task-wide
and comparable native-workflow collection remain follow-ups. A prospective
pilot needs a usable collection interface, new observations, and pre-intake
approval of its research choices. Method readiness is not effectiveness evidence.

## Reviewer calibration

The [reviewer calibration foundation](reviewer-calibration/README.md) describes
case preparation, evidence isolation, adjudication and future comparisons.
Private study results and case inventories are excluded from public source.
These procedures do not extend the runtime KPI contract or establish effectiveness
without observations and the required owner decisions.
