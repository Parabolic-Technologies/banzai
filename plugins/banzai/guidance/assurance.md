# Assurance Guidance

Canonical portable guidance. The active execution context supplies artifact roles
and policies; entry, host transport and contract mechanics remain with the caller.

## Rules

- Use the manifest's test framework, layout, and import pattern.
- Read linked accepted ADRs and test their compliance/confirmation criteria when
  automation is appropriate.
- Stop and report if the implementation relies on a non-Accepted ADR.
- No new test dependency, framework, or runner without explicit approval and
  manifest update. Test counts, case inventories, and run results go in
  `test-report.md`, never in the manifest.
- Mirror production layout in test paths.
- Keep test doubles together; fakes record calls/arguments and use the same
  event/callback/state mechanism as production.
- Match the code's async/concurrency context.
- Name tests `<unit>_<condition>_<expectedResult>` unless the manifest says
  otherwise.
- Preserve existing tests that assert behavior; delete generated stubs.
- Delete hollow tests.
- Comment sparingly and with high signal. Write a comment only to explain why:
  a constraint, trade-off, invariant, side effect, or non-obvious behavior. Do
  not narrate what the test visibly does.
- Apply the Test Assurance policy (`test-assurance.md`) supplied by the active execution context. Test count, coverage
  percentage, syntactic reach, and private implementation structure are not
  completion criteria unless the manifest records an explicit approved policy.
- A valid result may add no test, reuse existing evidence, use a non-unit owner,
  consolidate redundant tests, or narrow an overstated report claim.
  Claim narrowing cannot discharge a required check or missing material evidence.
- For strict plans, apply Plan Authority (`plan-task-completion.md`) supplied by the active execution context: protect binding obligations, including
  legacy directives, without turning an optional private choice into a test target.

## What To Test

- First protect material business rules, public or persisted contracts,
  authorization/security/privacy boundaries, state transitions, recovery,
  decision tables, and confirmed regressions.
- Choose the smallest realistic test level that observes the guarantee. One test
  may protect several requirements.
- A security requirement recorded under the Security Assurance policy (`security-assurance.md`) supplied by the active execution context is a material guarantee: give it evidence at the proportionate
  level, with no separate security-test quota.
- Test a pure helper directly only when its behavior is itself a material
  contract or the direct test is the clearest non-redundant evidence.
- Environment-sensitive values: assert round trips, not local literal strings.

Not unit-testable behavior goes in the report with owner:
UI/snapshot, integration/smoke, e2e, or platform behavior.
Apply the same rule to ADR confirmation that requires operational, security,
performance, or architecture review rather than a unit test.

## Suite Runs

- Run focused affected tests while developing or critiquing evidence.
- In orchestrated mode, do not repeat a full-scope command listed in the runner
  verification block. If the manifest's applicable final suite is absent, run
  it once and record the configuration gap.
- In standalone mode, run the applicable final suite once after tests stabilize,
  except for a permitted current equivalent disposition established by the
  shared deterministic owner under Test Assurance; keep all other checks fresh.
- Fix failures before proceeding.
- Never claim a physical test pass without its actual run. Label reuse separately
  with the exact original physical evidence and current applicability.

## Critique Loop

Check for:

- unasserted error paths;
- unprotected material guarantees;
- tangled assertions;
- hollow tests;
- implementation-coupled or redundant tests;
- disproportionate doubles and suite cost;
- unused helper parameters.

Run one focused pass. Run a second pass only if the first changed the assurance
portfolio or found a material gap.

## Test Report

Write the resolved `testReport` artifact:

1. title, slug, related artifacts;
2. framework/layout/doubles note;
3. focused feedback commands and outcomes plus the runner-owned final commands,
   standalone final suite, or recorded runner-profile gap as applicable;
4. files added/removed/changed;
5. **Risk and Contract Assurance Map** with material guarantee, impact or
   regression risk, best evidence level, existing/new evidence, and deferred
   evidence owner;
6. shared evidence, no-new-test, test-consolidation, claim-narrowing, non-unit,
   and non-automated ADR decisions with reasons and owners;
7. critique loop result.


For a focused closure, append the accepted finding ID, changed scope, decision,
current executed/reused evidence, historical references and pending limitations.
Retain unrelated report text and inspect current claims for contradictions. A
consistency sweep does not rerun commands and cannot discharge required assurance.
