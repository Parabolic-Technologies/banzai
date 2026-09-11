# ADR 0013: Risk-Driven Test Assurance

## Status / Date / Owner / Decision Makers

- Status: Accepted
- Date: 2026-08-12
- Owner: Banzai maintainers
- Decision makers: User, explicitly accepted in chat on 2026-08-12

## Related Artifacts

- Feature description:
  `documentation/features/risk-driven-test-assurance/description.md`
- Feature plan: Not created; planning cannot rely on this Proposed ADR.
- Repository authority: `AGENTS.md`
- Manifest: sections 3, 6, 8, 9, and 10 of `PROJECT_MANIFEST.md`
- Related ADRs:
  - ADR 0006 defines versioned deterministic verification profiles.
  - ADR 0007 defines project-type verification readiness.
  - ADR 0010 distinguishes blocking and advisory release evidence.

## Context and Decision Drivers

Current Banzai instructions reject hollow tests but still create exhaustive
pressure. New logic is universally expected to receive unit tests; strict test
reports map every requirement, edge case, and failure path; implementer and test
skills repeatedly run full suites; the runner executes deterministic
verification afterward; and independent review is instructed to rerun the same
toolchain. A reviewer can also request tests without having to establish why the
missing test protects a material observable guarantee.

No Banzai instruction requires 100 percent line or branch coverage. The current
failure mode is instead traceability and execution amplification: multiple
models interpret comprehensive maps and repeated critique as a reason to add
tests for private branches, duplicate already-protected behavior, overuse test
doubles, and repeat full commands that produce no new evidence.

The target is proportionate assurance. Every retained test must protect a
material observable guarantee or plausible regression, while one realistic test
may protect several requirements. Coverage measurements remain diagnostic unless
a target project explicitly adopts a threshold. Orchestrated phases must share
one final verification owner without weakening focused implementation feedback
or standalone execution.

Decision drivers:

- protect business, contract, authorization, security, privacy, state,
  recovery, and confirmed regression behavior;
- reduce redundant test code, brittle implementation coupling, and over-mocking;
- reduce repeated full-suite duration and cross-model usage;
- keep reports truthful without forcing automation for every traceability row;
- retain deterministic post-phase enforcement and independent source review;
- support target projects with different test tools and explicit local policies;
- avoid a new framework, dependency, or universal numeric threshold.

## Options Considered

### Option 1: Keep exhaustive traceability and repeated verification

Keep mandatory unit tests for new logic, comprehensive coverage maps, critique
passes, full-suite execution in each writing phase, runner verification, and
reviewer reruns.

Benefits:

- maximizes the amount of locally recorded test evidence;
- requires no policy or prompt changes;
- repeated commands can expose nondeterministic failures.

Costs and rejection reason:

- test quantity and trace completeness become proxies for risk reduction;
- multiple phases pay for identical full-suite evidence;
- private implementation details attract tests even when no distinct guarantee
  exists;
- report overstatement tends to be corrected by adding more code rather than by
  narrowing the claim;
- cross-model critique can converge on volume rather than assurance. Rejected
  because it does not meet the maintainability, latency, and cost goals.

### Option 2: Adopt a universal coverage target

Configure one line or branch coverage threshold and allow models to stop when the
metric passes.

Benefits:

- provides a simple machine-readable completion condition;
- makes regression in measured coverage visible;
- is familiar across many test ecosystems.

Costs and rejection reason:

- a universal number does not distinguish business guarantees from trivial
  lines;
- encourages tests optimized for reach rather than defect detection;
- requires project-specific coverage tooling and dependencies;
- does not solve repeated execution or over-mocking;
- is unsuitable for heterogeneous plugin target repositories. Rejected because
  the metric would recreate the problem as an explicit gate.

### Option 3: Use risk-driven assurance with one final verification owner

Require each new or retained test to protect a material observable guarantee or
plausible regression not already protected by equivalent evidence. Replace
exhaustive coverage maps with a Risk and Contract Assurance Map. Permit no-test,
test consolidation, and truthful claim narrowing decisions when they are
proportionate and explicit.

During orchestrated work, have implementers run focused affected tests and avoid
commands the runner identifies as final deterministic verification. The runner
executes those configured commands once after each code phase. If configuration
omits the manifest's applicable final suite, the implementer runs it once and
records the readiness gap. Independent review consumes current evidence and
reruns only focused reproductions or missing, stale, inconsistent, or directly
material commands. Standalone work retains one final full-suite owner in the
implementing skill.

Benefits:

- aligns test work with failure impact and observable behavior;
- retains strong evidence for load-bearing system boundaries;
- removes normal duplicate full-suite runs across model roles;
- allows smaller, more realistic, less implementation-coupled portfolios;
- makes report correction possible without mandatory test growth;
- preserves deterministic runner enforcement and standalone safety.

Costs and risks:

- models must make qualitative risk judgments rather than follow a counting
  heuristic;
- an underconfigured runner can omit intended final evidence unless the builder
  detects and reports the gap;
- two requirements may receive shared evidence, making simplistic traceability
  less direct;
- reviewers need a stricter finding threshold and may disagree about
  proportionality;
- reduced repetition can make latent flaky behavior less visible during one
  workflow run.

### Option 4: Remove test expectations and rely on independent review

Make tests optional without a risk model and let the reviewer decide whether the
implementation is credible.

Benefits:

- minimizes test code and test execution;
- gives each feature maximum implementation flexibility.

Costs and rejection reason:

- loses executable regression protection;
- makes review dependent on model inspection and reasoning alone;
- weakens fail-closed contracts, recovery, and security evidence;
- provides no durable rule for choosing when tests are essential. Rejected
  because fewer tests are not the objective; proportionate assurance is.

## Decision

Adopt Option 3.

Define a test as justified only when it protects a material observable guarantee
or plausible regression that equivalent existing evidence does not already
protect. Prioritize business rules, public and persisted contracts,
authorization, security, privacy, state transitions, recovery, decision tables,
and confirmed defects. Do not require a test solely for a coverage percentage,
syntactic branch, private helper, or traceability row unless the target project's
approved policy explicitly requires that evidence.

Permit boundary fakes and injected runners when they preserve the production
contract and make unstable dependencies deterministic. Reject tests that merely
mirror private call order, reproduce implementation structure, mock the unit
under test, or duplicate an existing guarantee. Permit consolidation or removal
of such tests only when protected behavior remains evidenced.

Replace exhaustive coverage maps in test artifacts with a Risk and Contract
Assurance Map. It must state material guarantees, risk, best evidence level, and
deferred evidence. It may map one test to multiple requirements, record that
existing evidence is sufficient, or choose a non-test owner. Reports must never
claim more than their evidence demonstrates, and narrowing an overstated claim
is a valid correction.

In orchestrated mode, the runner must identify its configured deterministic
verification commands in writing-phase prompts. The implementer must run focused
affected tests and must not repeat a full-scope command the runner will execute.
The runner remains the authoritative final verification owner after every code
phase. When supplied runner commands omit the manifest's applicable final suite,
the implementer must run it once and record the configuration gap. In standalone
mode, the implementing skill owns one final applicable full-suite run.

Independent review must consume the runner's current verification evidence and
must not rerun the complete suite by default. It may run focused reproduction or
rerun evidence that is missing, stale, inconsistent, or directly material to a
finding. A missing-test finding must name the unprotected observable guarantee,
plausible regression, insufficiency of current evidence, and proportionate test
level. Coverage reach alone is not a finding.

An accepted finding receives a new regression test only when it exposes a
meaningful testable behavior not already protected by equivalent evidence.
Verification failure, false evidence claims, and missing material safety or
contract assurance remain actionable and fail closed.

## Consequences

Positive:

- test portfolios focus on important behavior and regression value;
- one realistic behavioral test can replace several implementation-coupled
  assertions;
- normal strict execution avoids repeated full-suite calls by each model role;
- reviewers must justify test findings with risk and observable behavior;
- reports can become more accurate without automatically generating more tests;
- target projects retain authority over any explicit local coverage threshold.

Negative:

- assurance decisions become qualitative and require better model judgment;
- the Risk and Contract Assurance Map is less mechanically exhaustive than a
  requirement-by-requirement coverage table;
- incomplete verification profiles become more visible and may require project
  configuration work;
- fewer repeated runs reduce incidental flake detection inside one task;
- existing feature reports remain historical and are not retroactively
  rewritten.

Risks and mitigations:

- under-testing: retain explicit priority for load-bearing guarantees and require
  reviewers to report missing material evidence;
- subjective findings: require a guarantee, regression mechanism, evidence gap,
  and proportionate level in every missing-test finding;
- missing final suite: expose runner commands to the implementer and require one
  builder-owned fallback plus a recorded readiness gap;
- hidden duplication: distinguish focused feedback from final full-scope
  commands in artifacts and prompts;
- misleading lower counts: evaluate escaped defects, accepted test findings,
  fix cycles, flake rate, test LOC, and verification duration together rather
  than optimizing one metric;
- target-project conflict: an explicit approved local testing policy overrides
  the default diagnostic-only treatment of coverage metrics.

Required follow-ups:

- update installed workflow policy and `code-writing`, `test-writing`, `feature`,
  `quick-fix`, `feature-review`, and `project-manifest` skills;
- update the packaged `PROJECT_MANIFEST.md` template;
- expose runner verification commands in implementation and fix prompts;
- update strict and lite skill behavior for orchestrated versus standalone final
  suites;
- add prompt, skill-policy, and runner regressions without testing prose that is
  not contractual;
- update product documentation and the root manifest;
- evaluate 15-30 later tasks using verification duration, test-code change,
  accepted test findings, fix cycles, flake rate, and escaped defects before
  proposing a separate model or effort change.

## Compliance and Confirmation

Implementation and review must confirm:

1. workflow policy defines material observable guarantees and rejects
   coverage-only test requirements;
2. high-risk contract, security, privacy, state, recovery, and confirmed
   regression evidence remains required;
3. boundary fakes remain allowed while implementation-mirroring and hollow tests
   are rejected;
4. test reports use Risk and Contract Assurance Map and allow truthful no-test,
   shared-evidence, non-test-owner, consolidation, and claim-narrowing outcomes;
5. runner-owned command details reach implementation and accepted-fix prompts
   without changing command execution or exposing secrets;
6. orchestrated builders run focused tests and avoid duplicate supplied
   full-scope commands;
7. a missing manifest final suite is run once by the implementer and recorded as
   a configuration gap;
8. standalone implementation retains one final applicable full-suite run;
9. independent review uses supplied verification evidence and reruns commands
   only for an explicit evidence or reproduction reason;
10. every missing-test finding satisfies the guarantee, regression, evidence-gap,
    and proportionality threshold;
11. accepted fixes add regression tests only when they protect non-redundant
    meaningful behavior;
12. verification failure, false report claims, and missing material safety
    evidence still block or become actionable findings;
13. phase/review contracts, reviewer isolation, authorization, and human gates
    remain compatible;
14. focused tests, the repository final gate, committed bundle parity, formatter
    check, and `git diff --check` pass.

## Lifecycle Links

- Supersedes: None
- Superseded by: None
