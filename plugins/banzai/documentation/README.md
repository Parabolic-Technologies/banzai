# documentation/

Keep maintained project guides and the shared decision log in `documentation/`.
Internal workflow evidence lives in ignored private work directories. Resolve
every work through the installed artifact helper and use the exact roles in its
immutable `work.json` binding; the paths below illustrate those roles.

Lite feature:

```text
.banzai/work/<work-id>/work.md
```

Strict feature:

```text
.banzai/work/<work-id>/description.md
.banzai/work/<work-id>/plan.md
.banzai/work/<work-id>/implementation-report.md
.banzai/work/<work-id>/test-report.md
.banzai/work/<work-id>/review-<iteration>.md
```

Architecture decisions:

```text
documentation/decisions/README.md
documentation/decisions/NNNN-<slug>.md
```

Quick-fix report:

```text
.banzai/work/<work-id>/change-report.md
```

Optional local orchestrator machine contracts are shipped separately from
project documentation templates:

```text
../contracts/contract.json
../contracts/v3/phase-result.schema.json # current consultation-aware phase hand-off
```

Rules:

- Use short kebab-case slugs/names.
- Link related artifacts at the top.
- Write the helper-resolved `changeReport` only when `quick-fix` requires an
  audit trail. Keep `.banzai/artifacts.json` shared, `.banzai/work/` ignored,
  and `.banzai/runs/` reserved for ignored orchestrator execution evidence.
- Each review lands at the next `review-<iteration>.md`. Both orchestrated
  reviewers are read-only; the runner renders, validates and publishes
  `banzai-feature-review/v4`. Standalone `feature-review` owns a durable
  `banzai-standalone-review/v1` Markdown artifact without the runner.
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
- In strict orchestrated work, approved plan checkboxes remain unchanged: v3
  implementation results carry the canonical per-task completion ledger and a
  required nullable planning-only consultation field, and
  `implementation-report.md` holds its `banzai-plan-task-completion/v1`
  projection. Completion semantics are defined in the installed
  `policies/plan-task-completion.md` under **Plan Task Completion Evidence**.
- A terminal run may retain a `changes_requested` review when human triage
  accepts no findings; never rewrite a review artifact as a pass.
