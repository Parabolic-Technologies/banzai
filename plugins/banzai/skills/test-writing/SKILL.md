---
name: test-writing
description: Strict/backfill assurance phase. Adds or audits proportionate tests and writes test-report.md with risk, contract, and ADR evidence. Auto-select only in a Banzai-adopted repository (root PROJECT_MANIFEST.md or .banzai/) or by name.
user-invocable: true
---

# test-writing

Runs after `code-writing` in strict mode, and after `feature` when the user asks
for an assurance report or test backfill.

Inputs: strict artifacts (`description.md`, `plan.md`,
`implementation-report.md`) or lite `work.md`, relevant accepted ADRs, plus
source/tests.

Outputs: test changes plus `documentation/features/<slug>/test-report.md`.

## Artifact Storage

Before artifact discovery or writing, read the installed
`../../policies/artifact-storage.md` and resolve the selected work through its
plugin-local helper. Use the returned role paths for internal work artifacts;
`documentation/` work paths below describe the explicit legacy layout only.
Keep ADRs, indexes, manifests and maintained product guidance at their existing
repository paths. Status/loading stays read-only, and orchestrated work follows
the persisted run binding and exact phase grants.

## Sources

- Process: the project root `AGENTS.md`. Read it unless the host already
  assembled it into this session. Before test selection or assurance,
  recognize the layout: target when `AGENTS.md` carries `## Authority` and
  `## Policies` with no line beginning with `@`, and the `CLAUDE.md` shim is
  absent or carries no policy heading; legacy layout when `CLAUDE.md` carries
  `## Engineering Quality` and `AGENTS.md` is absent or lacks `## Authority`.
  Policy headings for layout recognition are `## Decision Consultation`,
  `## Test Assurance`, `## Security Assurance`, `## Engineering Quality`,
  and `## Plan Task Completion Evidence`.
  On legacy stop with "legacy Banzai layout: run `project-manifest` to migrate"
  and ask the user to run `project-manifest`; read neither legacy policy
  copies nor installed replacements as applicable rules, and never scaffold or
  migrate files. On partial report the exact ambiguity and stop without source
  changes, precedence guesses or reconstructed rules.
  Unadopted means neither file has `## Authority` or a policy heading; keep
  existing missing-manifest behavior. Every other combination, including an
  unreadable file, is partial. Skip this recognition rule in the plugin source
  repository. Never read a policy body from a project file.
- Policies, resolved as `../../policies/<name>.md` from this `SKILL.md`,
  never from the project working directory or a fixed plugin cache path.
  Stop before affected work if a required source is absent or unreadable;
  never substitute a project copy, a legacy inline policy or memory:
  - `test-assurance.md` before selecting or changing tests and assigning assurance evidence.
  - `security-assurance.md` when assuring a security requirement or discovering a new exposure; existing escalation rules govern scope changes.
  - `plan-task-completion.md` when interpreting a strict plan or its assurance/completion obligations; lite backfill creates no strict ledger.
   - `artifact-storage.md` before resolving, reading or writing work artifacts.

## Orchestrated Mode

A legacy or partial layout returns `outcome=needs_human_decision`,
`gate=escalation`, the layout diagnostic as `summary`, one question naming
the migration step, and no source change.

In strict mode this skill is the second half of the runner's implementation
phase: `code-writing` hands over directly, with no human decision in between.
Keep the approved description, plan, and accepted ADRs immutable, and report
assurance in `test-report.md` and the structured phase result required by
`contracts/v3/phase-result.schema.json` with `decisionConsultation: null`.
Preserve the implementation phase's canonical `taskCompletion` ledger and
exact report projection; do not create a second ledger. Stop with
`gate=escalation` only when assurance work exposes a missing requirement or
decision. Deterministic verification and the independent review belong to the
runner and follow automatically.

The test report owns risk and contract assurance, not implementation-task
completion. Identify any `TNNN` whose required assurance remains incomplete or
contradicts the implementation report; do not promote an incomplete or blocked
implementation task to completed merely because a test exists.

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
- Apply the Test Assurance policy in the installed
  `policies/test-assurance.md`. Test count, coverage
  percentage, syntactic reach, and private implementation structure are not
  completion criteria unless the manifest records an explicit approved policy.
- A valid result may add no test, reuse existing evidence, use a non-unit owner,
  consolidate redundant tests, or narrow an overstated report claim.
  Claim narrowing cannot discharge a required check or missing material evidence.
- For strict plans, apply Plan Authority in the installed
  `policies/plan-task-completion.md`: protect binding obligations, including
  legacy directives, without turning an optional private choice into a test target.

## What To Test

- First protect material business rules, public or persisted contracts,
  authorization/security/privacy boundaries, state transitions, recovery,
  decision tables, and confirmed regressions.
- Choose the smallest realistic test level that observes the guarantee. One test
  may protect several requirements.
- A security requirement recorded under the Security Assurance policy in the installed
  `policies/security-assurance.md` is a material guarantee: give it evidence at the proportionate
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
- In standalone mode, run the applicable final suite once after tests stabilize.
- Fix failures before proceeding.
- Never claim tests pass without a run.

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

Write `documentation/features/<slug>/test-report.md`:

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

## Report And Continue

Report the suite command, its outcome, and `test-report.md`. Then continue to
verification and `feature-review` without asking for confirmation. Assurance
work is done when the report is accurate and required focused or fallback checks
pass; runner-owned final verification follows automatically. A human
confirmation is not required to reach that state.

Stop here only for an escalation trigger, a suite failure you cannot fix inside
the approved plan, or reliance on a non-Accepted ADR.
