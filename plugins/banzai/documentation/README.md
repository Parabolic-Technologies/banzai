# documentation/

Workflow artifact tree.

Lite feature:

```text
work/<slug>/work.md
```

Strict feature:

```text
work/<slug>/description.md
work/<slug>/plan.md
work/<slug>/implementation-report.md
work/<slug>/test-report.md
work/<slug>/review-<iteration>.md
```

Architecture decisions:

```text
decisions/README.md
decisions/NNNN-<slug>.md
```

Quick-fix report:

```text
work/<slug>/change-report.md
```

Optional local orchestrator machine contracts are shipped separately from
project documentation templates:

```text
../contracts/contract.json
../contracts/v1/phase-result.schema.json # legacy persisted attempts
../contracts/v1/review-result.schema.json
../contracts/v2/phase-result.schema.json # legacy task-completion attempts
../contracts/v4/phase-result.schema.json # current task-verification phase hand-off
```

Rules:

- Use short kebab-case slugs/names.
- Link related artifacts at the top.
- Create `work/<slug>/change-report.md` only when `quick-fix` requires an audit trail.
- Each review lands at the next `review-<iteration>.md`. Both orchestrated
  reviewers are read-only; the runner renders, validates and publishes
  `banzai-feature-review/v8`. Standalone `feature-review` owns a durable
  `banzai-feature-review/v1` Markdown artifact without the runner.
- Keep ADRs in the central decision log and link them from affected feature
  artifacts and the manifest's active decision index. Accepted ADR bodies are
  immutable; supersede a changed decision with a new, linked ADR.
- `test-report.md` carries the Risk and Contract Assurance Map defined by
  `test-writing`.
- New strict plans copy the **Plan Authority** convention from the installed
  `policies/plan-task-completion.md` and describe binding behavior, scope,
  necessary constraints and evidence. Useful optional guidance is explicitly
  labeled; legacy plans keep their approved meanings. The approver reviews
  obligations and discretion in the exact bundle, and guidance never replaces
  a required check or authorizes more scope.
- In strict orchestrated work, approved plan checkboxes remain unchanged: v4
  implementation results carry the canonical per-task completion ledger and a
  required nullable planning-only consultation field. Task verification candidates
  stay within existing execution authority, and
  `implementation-report.md` holds the runner-published
  `banzai-plan-task-completion/v2` region rendered from that ledger after
  validation (ADR-0047); historical runs keep their model-authored
  `banzai-plan-task-completion/v1` projection. Completion semantics are
  defined in the installed `policies/plan-task-completion.md` under
  **Plan Task Completion Evidence**.
- A terminal run may retain a `changes_requested` review when human triage
  accepts no findings; never rewrite a review artifact as a pass.

New work uses one flat `work/<slug>/` directory visible in ordinary Git changes.
Existing work remains at its known paths, including subsequent reports/reviews.
No document migration, layout declaration or registration is required.
