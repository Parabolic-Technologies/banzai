# Context Accounting and Budgeting

Banzai records privacy-safe evidence about the context it controls for every
model invocation. The attempt-owned contract is
`banzai-context-attempt/v2`; the independent cross-run report contract is
`banzai-context-report/v2`. Neither contract changes the model-facing umbrella
contract, `banzai-evaluation-export/v1`, or `banzai-evaluation-kpi/v1`.

## Evidence Surfaces

Four surfaces are deliberately separate and must not be added together:

1. **Runner payload** — exact UTF-8 bytes for the rendered prompt and the exact
   vendor-specific output schema. Prompt bytes are divided into closed semantic
   categories, and all categories plus `output_contract` equal the exact total.
2. **Authority surface** — counts of referenced project instructions,
   manifests, requirements, ADRs, plans, reports, review artifacts, human
   decisions, and verification profiles. A referenced artifact contributes no
   prompt bytes unless its text is actually embedded in the prompt.
3. **Session inventory** — vendor-reported counts for tools, MCP servers,
   skills, and commands. Every metric is explicitly available or unavailable;
   missing evidence is never zero.
4. **Vendor usage** — vendor-reported input, cached-input and output tokens,
   cost, and turns. These values describe vendor processing, not runner bytes,
   and retain independent availability.

Each physical attempt owns
`.banzai/runs/<run-id>/attempts/<attempt-id>.context.json`. A review normally has
one `primary` invocation and may have one separate
`review_artifact_repair` invocation. The pre-call payload is checkpointed before
the adapter starts; interruption may therefore leave a `pending` entry with
post-call surfaces unavailable.

Context ledgers are sidecars, separate from canonical
`<attempt-id>-<kind>.json` model records. Evaluation export and its derived
KPIs ignore `*.context.json` without reading or validating it; the context
reader alone owns context-ledger validation and coverage. A malformed ledger
can therefore fail `eval context` while canonical evaluation evidence remains
usable.

## Privacy Boundary

Persisted evidence is an allow-list of schema identity, run and attempt
identity, closed enums, timestamps, byte/count/usage values, budget outcomes,
authority counts, and the existing inventory digest. It does not retain prompt
components, requests, artifact or repository paths, source, model output,
reasoning, transcripts, tool names, arguments, results, commands, environment
values, credentials, personal data, or error prose.

A present malformed, unsupported, identity-conflicting, or content-bearing
ledger fails closed as `INVALID_CONTEXT_EVIDENCE`. The diagnostic names only
the run and attempt. Historical attempts with no context ledger are valid but
reported as incomplete coverage.

## Policy

An absent policy and a newly initialized project both normalize to observation
with no numerical limit:

```json
{
  "context": {
    "mode": "observe",
    "limits": []
  }
}
```

Limits select a metric and may additionally select a phase, a role, or both:

```json
{
  "context": {
    "mode": "enforce",
    "limits": [
      {
        "metric": "runner_payload_bytes",
        "phase": "review",
        "role": "reviewer",
        "maximum": 45000
      },
      {
        "metric": "vendor_input_tokens",
        "phase": "review",
        "maximum": 30000
      }
    ]
  }
}
```

Phase-plus-role is more specific than phase-only or role-only; either is more
specific than an unqualified limit. At equal specificity the smaller maximum
wins. Duplicate metric/phase/role selectors are invalid.

`observe` records crossings without changing execution. In `enforce`, only
exact pre-call `runner_payload_bytes` can block, with stable code
`CONTEXT_BUDGET_EXCEEDED`, before the adapter or vendor process starts. Banzai
never satisfies a limit by truncating, summarizing, rewriting, or omitting
required context. Vendor-token, cost, turn, and inventory limits are post-call
observations even in enforce mode. A blocked attempt is retried only through the
existing explicit retry path after policy or authorized input changes.

Version 1 intentionally defines no universal limit. A useful bound depends on
the project's workflows and evidence, not a guessed fraction of a vendor
context window.

## Reporting

The offline read-only report uses the same RFC3339 cohort grammar, half-open
`[from,to)` range, repeatable `--run`, and validation order as `eval export`:

```text
banzai eval context
banzai eval context --json
banzai eval context --from 2026-08-01T00:00:00Z --to 2026-09-01T00:00:00Z
banzai eval context --run 20260801-example --run 20260815-other
```

The report shows exact and incomplete physical-attempt coverage before values,
then fixed-order workflow/phase/role groups. Runner bytes, category totals,
budget outcomes, vendor usage, and session inventory remain separate. JSON is
canonical two-space-indented `banzai-context-report/v2` with one trailing
newline; Markdown is a projection of the same completed object. Identical
inputs and arguments produce identical bytes, and reporting never creates a
config, lock, run, active pointer, or report file.

## Establishing a Baseline

Before enabling enforcement or optimizing prompts:

1. Keep the project in `observe` with no limit.
2. Collect **15–30 representative completed runs**, covering the workflows and
   phases the project actually uses. Exclude synthetic outliers only with a
   recorded reason.
3. Run `banzai eval context --json` over the explicit run IDs or a fixed date
   cohort and archive the command, commit, cohort selectors, report bytes, and
   exact/incomplete coverage outside `.banzai/runs/` only when the project has
   an authorized evidence-retention location.
4. Identify the exact category or surface to reduce; do not treat total vendor
   tokens as a proxy for runner-controlled prompt bytes.
5. Name an existing outcome KPI from
   [`documentation/evaluation/README.md`](../evaluation/README.md) or a safety
   invariant that guards correctness, review independence, human gates,
   verification, privacy, or recovery.
6. Make one reversible change, collect a comparable cohort, and compare both
   the target context measure and its correctness guard. Revert when the guard
   degrades or coverage is not comparable.

Every context optimization change must therefore state: **target category or
surface, baseline cohort and coverage, expected reduction, correctness guard,
and rollback condition**.


Context v2 adds planning_review (reviewer, read-only) and planning_analysis
(planner, read-only) in the fixed report phase order after code review. The
per-version reader retains v1 vocabulary and identity; v1 cannot carry either
new phase. The configuration phase selector vocabulary is unchanged: role and
global limits apply to the new phases. Scope documents count as authority;
analysis and applying planning also count the planning-review artifact. Rework
and planning-triage records enter only planning-family human evidence.
