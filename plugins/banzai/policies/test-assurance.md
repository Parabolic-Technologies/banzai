# Test Assurance

- Owner decision: ADR-0013/0014
- Consumers: `development-plan`, `code-writing`, `test-writing`, `feature-review`, `feature`, `quick-fix`; conditional: `project-manifest`
- Process source: the project `AGENTS.md` (authority order, escalation triggers, decision gates)
- Runner consumers: planning, implementation, review, fix, feature, quick-fix.
- Delivery: standalone skills load this policy relatively; runner phases receive its body inline. Conditional duties retain their conditions.

## Test Assurance

- Add or retain a test only when it protects a material observable guarantee or
  plausible regression that equivalent existing evidence does not already
  protect.
- Prioritize business rules, public and persisted contracts, authorization,
  security, privacy, state transitions, recovery, decision tables, and confirmed
  defects.
- Test count, coverage percentage, a syntactic branch, a private helper, or the
  ability to add another assertion is not enough by itself. An explicit approved
  project threshold recorded in `PROJECT_MANIFEST.md` remains authoritative.
- Boundary fakes, stubs, and injected runners are appropriate when they preserve
  the production command, event, callback, or state contract and make unstable
  dependencies deterministic. Reject tests that mock the unit under test,
  reproduce private call order, mirror implementation structure, or duplicate
  an already protected guarantee.
- One behavioral test may protect several requirements. Existing evidence, a
  non-unit evidence owner, or no new automated test is valid when proportionate
  and recorded accurately. Consolidate or remove redundant, hollow, obsolete,
  or implementation-coupled tests only when their guarantees remain protected.
- Reports must claim only behavior demonstrated by assertions or other recorded
  evidence. Narrowing an overstated claim is a valid correction; do not add a
  low-value test merely to preserve broader prose.
- Missing material contract or safety evidence, failed verification, hollow
  tests, and false evidence claims remain actionable. Lower test volume is not a
  goal independent of assurance.

### Deterministic equivalent evidence

ADR-0043 permits an explicitly configured check to use equivalent evidence only
when the shared verification owner returns a valid current decision and direct
physical origin. Config schema 3, project-owned dependency/explanatory rules and
complete non-secret input/environment evidence are required. A model's docs-only
label, a report claim or an earlier green command is never a waiver. Missing or
unsafe evidence, unknown/mixed changes, authoritative Markdown, tests, generated
inputs, config or toolchain changes retain required checks. Plan/project commands
marked fresh and every release:check execute afresh.

The runner owns decisions, physical starts/finishes and application under its
work claim; phase models do not invoke the standalone helper or write machine
evidence. Standalone callers use the installed `../scripts/verification.cjs`
through an explicitly selected v2 work binding. Helper absence, v1 bindings,
unapproved/missing policy and unsupported plans preserve the existing applicable
final-suite owner. A check without a supported reusable disposition still runs.

Distinguish executed, reused, historical/pre-fix, failed, unavailable and pending
evidence. Reuse references the exact original attempt, round and evidence digest;
it has no new process, exit code, log, duration or saved-time claim. Revalidate
source and origin applicability before completion. Never reclassify a failed or
incomplete physical attempt as reuse.
