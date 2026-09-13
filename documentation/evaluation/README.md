# Evaluation KPIs

`banzai eval kpi` projects one or more `banzai-evaluation-export/v1` datasets
into the derived-KPI contract `banzai-evaluation-kpi/v1` (ADR-0026). The
projection is a pure function of complete export documents: it reads nothing
from `.banzai/runs/` beyond what `banzai eval export` already reads, derives
every KPI from per-run evidence only (never from the export's `aggregates`),
and is byte-for-byte deterministic over identical inputs.

Every KPI value reports four things: `numerator`, `denominator`, `value`
(`null` when the denominator is zero — a missing measurement is never rendered
as a number), and `coverage` — how many in-scope runs carried exact evidence
versus partial or unavailable evidence. Only exact-evidence runs contribute to
the arithmetic. Runs outside the export cohort (`cohortMembership` other than
`included`) are invisible to every KPI.

## KPI Set

| KPI (measure) | Meaning | Numerator | Denominator | Scope and exactness |
| --- | --- | --- | --- | --- |
| `completion_rate` (rate) | Share of finished runs that completed | Runs with status `done` | Terminal runs | All included runs; a run with unknown `terminal` (or terminal with unknown status) is coverage-incomplete. Also grouped by workflow (`quick-fix`, `feature`, `strict`, `unknown`). |
| `first_review_pass_rate` (rate) | How often the first independent review passes outright | Reviewed runs whose lowest-ordinal review verdict is `pass` | Reviewed runs with a known first verdict | Runs with at least one review; unknown first verdict is coverage-incomplete. |
| `first_review_mean_findings` (mean) | Average findings raised by the first review | Sum of `blocker` + `should_fix` + `nit` findings of the first review | Reviewed runs with a known first verdict | Same scope as the pass rate. |
| `first_review_acceptance_rate` (rate) | Share of everything the first review raised that a human accepted | Accepted triage | All triaged findings (`accepted` + `rejected` + `deferred`) | Reviewed runs. Exact only for a run with exactly one applied review whose triaged total equals the findings that review raised — exported triage is cumulative per run and is never decomposed by guesswork, so multi-review and mismatched runs are coverage-incomplete. A first review that raised nothing contributes no denominator. |
| `reviewer_precision` (rate) | Proxy for reviewer signal quality from human triage | Sum of `accepted` triage | Sum of `accepted` + `rejected` triage | All included runs; exact only when accepted, rejected, and deferred triage metrics are all complete. `deferred` is never folded in. |
| `zero_accepted_review_rate` (rate) | Share of reviewed runs where triage accepted nothing at all | Reviewed runs with zero accepted triage | Reviewed runs that triaged at least one finding | Reviewed runs with complete triage. A run whose reviews raised no finding is not evidence either way and contributes no denominator. |
| `triage_deferred` (count) | Deferred findings, reported separately | Sum of `deferred` triage | Exact-triage runs | Same exactness as precision. |
| `fix_cycles_per_completed_run` (mean, max) | Fix effort a completed run needed | Sum (or max) of `fixCycles` | Completed (`done`) runs with a complete `fixCycles` metric | `done` runs only. |
| `attempt_retry_ratio` (plan, implementation, fix, review) | Share of attempts that ended without completing | Attempts of the kind with status `failed` or `interrupted` | All attempts of the kind | A run is exact only when its complete model-attempt set is established and every attempt has a known kind and status; otherwise the whole run is coverage-incomplete and contributes no attempts. |
| `usage_per_completed_run` (mean_input_tokens, mean_cached_input_tokens, mean_output_tokens) | Token consumption of a completed run | Summed run tokens | `done` runs whose three token metrics are complete | Token coverage is independent of cost coverage. |
| `usage_per_completed_run` (cache_ratio) | Share of input served from cache | Summed cached input tokens | Summed input tokens | Over the token-exact `done` runs. |
| `usage_per_completed_run` (mean_cost_usd) | Reported cost of a completed run | Summed `costUsd` | `done` runs with a complete `costUsd` metric | Cost coverage is explicit because subscription-authenticated vendors report no cost. |

### Attempt Evidence and Retry Coverage

Canonical model records currently use `<attempt-id>-<kind>.json`; supported
historical JSON filenames remain readable. The exporter excludes only the
known `*-result.json`, `*.terminal-checkpoint.json`, and `*.context.json`
sidecars. It does not decode their contents. Every other JSON candidate still
passes through canonical evidence checks; malformed, unreadable, unsupported,
and conflicting records remain visible as bounded issues and coverage gaps.
Equivalent duplicates contribute once and retain their duplicate diagnostic.

Retry coverage uses the five model `metrics.attempts.byKind` metrics
(`selection`, `plan`, `implementation`, `fix`, `review`) and checks their counts
against the exported attempts. These counts carry collection, schema,
identity, and unresolved active-attempt gaps. A higher persisted model counter
also prevents an otherwise complete leaf set from claiming exact coverage;
its gap applies only to that kind and its duration phase. Review-mode and
rotation metrics take only review gaps; model-wide counts, outcomes, sessions,
failures, and usage take the sum. Unrelated kinds retain their exact coverage,
including confirmed zeros. The counter supplies no missing status, model
identity, or usage. Lower stale counters retain their consistency diagnostic
without overriding canonical leaves. Neither `attempts.total` nor
`attempts.byOutcome` is a model-only signal: both also include verification.

An incomplete model set contributes only incomplete run coverage, even when
some valid attempts remain. A confirmed empty set contributes exact coverage
with numerator and denominator zero and `value: null`. Cost, token, event,
review, or verification gaps alone do not invalidate known model-attempt
statuses. Global run completeness is therefore not a substitute for these
checks.

Status semantics are unchanged. In export v1 a persisted schema-two
`interrupted` model attempt projects as `started` with derived evidence; KPI
v1 consumes that public status without reconstructing a different outcome.
The retry ratio is an attempt-outcome measure, separate from explicit retry
event counts.

### Reading Reviewer Quality

Pass rate alone cannot separate a reviewer that stays silent from one that
raises noise, so three measures are read together:

- `first_review_pass_rate` says how often the first review found nothing to
  change.
- `first_review_acceptance_rate` and `reviewer_precision` say how much of what
  it raised a human agreed with. Precision excludes deferred findings;
  acceptance keeps them in the denominator, so a reviewer whose findings are
  mostly parked still reads as low signal.
- `zero_accepted_review_rate` isolates the extreme: reviews that produced
  findings of which a human accepted none.

A low pass rate with a low acceptance rate and a high zero-accepted rate is
the reviewer manufacturing work. A low pass rate with a high acceptance rate is
the reviewer doing its job.

### Not Derivable From Export v1

Accepted findings by severity — for example accepted blockers per first
review — cannot be derived today. The export carries the severity of findings
a review *raised* and the disposition counts of triage, but no join between
them: `state.triageHistory` holds per-finding dispositions, which
`banzai-evaluation-export/v1` deliberately collapses into cumulative per-run
counts. Reporting that measure requires new export evidence and therefore a
separate decision; it is not approximated here.

## Configuration Signatures

Every KPI is also grouped by each run's configuration signature, derived from
its attempts: `selection` and `plan` attempts attribute to the planner,
`implementation` and `fix` to the implementer, `review` to the reviewer. Each
role renders as `vendor/model/effort`. Attribution fails closed:

- a role with no attempts is `unknown`;
- a role whose attempts carry more than one distinct fully-known triple is
  `mixed`;
- a role with any attempt whose vendor, model, or effort is unknown is
  `unknown`;
- a run containing an attempt whose kind is unknown derives every role as
  `unknown`, because that attempt could belong to any role;
- a run whose complete model-attempt set cannot be established derives every
  role as `unknown`; surviving leaves cannot identify excluded attempts.

Unknown evidence never merges into a known signature, so a configuration
comparison can be sparse but not silently wrong. The signature key is
`planner=<p> implementer=<i> reviewer=<r>`.

## Reading The Output

Markdown renders one table per KPI measure. Columns are the sources (the
in-memory checkout source is labeled `current`; file sources are labeled
`<ordinal>: <basename>` in argument order), rows are `overall`, the workflow
groups where applicable, then the signature groups. Each cell reads
`value (numerator/denominator; exact e, incomplete i)`; ratios render as
percentages, a zero denominator renders `unavailable`, and a group absent from
a source renders `-`. `--json` emits the canonical two-space document instead;
JSON is authoritative and Markdown is a pure projection of it.

## Baseline Procedure

To establish or refresh a KPI baseline across projects:

1. In each project checkout, export its evidence:
   `banzai eval export --json > <project>.json`.
2. Derive the comparison from the collected files:
   `banzai eval kpi --input <a>.json --input <b>.json ...`
   (add `--json` if the baseline should keep the machine-readable document).
3. Commit the result as `documentation/evaluation/<yyyy-mm>-baseline.md` in
   this repository.

Inputs are validated before use: a file that is not a readable
`banzai-evaluation-export/v1` version-1 document fails closed with
`INVALID_EVAL_INPUT` and no output.

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
log remain separate from the frozen export/KPI contracts. Existing run KPIs
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

## Practice

The [reviewer calibration foundation](reviewer-calibration/README.md) describes
case preparation, evidence isolation, adjudication, and a future comparison
protocol. Private study results and case inventories are excluded from public source.

A change that alters planner, implementer, reviewer, verification, fix, or
prompt behavior names the KPI it intends to move in its change record (see
`CONTRIBUTING.md`). A later `eval kpi` comparison against the previous baseline
then shows whether the change moved it.

## Verification applicability in export/KPI v2

Explicitly use `banzai eval export --schema-version 2 --json` and
`banzai eval kpi --schema-version 2 --json` for ADR-0043 evidence. Omission and
`--schema-version 1` preserve the v1 contracts. Export v1 marks unsupported new
verification meaning as incomplete instead of guessing reusable passes.

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
