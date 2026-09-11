# Test Assurance

- Owner decision: ADR-0013/0014
- Consumers: `development-plan`, `code-writing`, `test-writing`, `feature-review`, `feature`, `quick-fix`; conditional: `project-manifest`
- Process source: the project `AGENTS.md` (authority order, escalation triggers, decision gates)

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
