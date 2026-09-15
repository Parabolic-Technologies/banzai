# ADR 0046: Supervised Live End-to-End First Task

## Status / Date / Owner / Decision Makers

- Status: Accepted
- Date: 2026-09-15
- Owner: Banzai maintainers
- Decision makers: Project owner; explicitly accepted in chat on 2026-09-15
  with `Accept ADR-0046`.

## Related Artifacts

- Private strict work: `optional-live-e2e`. Its description defines FR1-FR19
  and AC1-AC14. The requirements needed to understand this decision are stated
  below; private work evidence is not required by public consumers.
- Plan: not created; dependent planning follows acceptance of this ADR.
- Authority: root `AGENTS.md`; `PROJECT_MANIFEST.md` sections 1, 2, 5, 8 and 10.
- Related decisions: [ADR-0010](0010-blocking-and-advisory-release-evidence.md),
  [ADR-0011](0011-protected-live-vendor-compatibility.md),
  [ADR-0018](0018-agent-supervised-banzai-cli-control.md),
  [ADR-0027](0027-exposure-driven-security-assurance.md),
  [ADR-0037](0037-unified-runner-rendered-review-artifacts.md),
  [ADR-0040](0040-project-adoption-preflight-and-interactive-setup.md),
  [ADR-0041](0041-artifact-retention-and-publication-boundary.md), and
  [ADR-0045](0045-guided-verification-setup.md).

## Context and Decision Drivers

The current workflow tests inject vendor processes. The committed-bundle smoke
checks CLI behavior in disposable repositories. `compatibility:live` exercises
real read-only vendor permission and structured-output behavior under
`banzai-live-compatibility/v2`; the current release policy limits it to two
model-bearing processes, five minutes each, and fifteen minutes overall.
None establishes the complete user journey from an application-empty project
through real initialization to a working first task.

Current setup opens a real foreground client and the project-manifest skill.
The task needs committed `HEAD`, confirmed bootstrap readiness and valid
guidance. ADR-0045 provides a configuration prerequisite after implementation
creates its stack, followed by verification under retained plan approval.
`setup-client.ts:prepareSetupLaunch` currently does not pass model/effort argv;
configured workflow roles alone cannot prove the setup client's effective model.

The owner requested an optional live E2E, approved preparation of a local,
supervised first scenario, and requested medium-capability models and effort.
The target exercises a small dependency-free Node expense CLI through strict
planning, implementation, substantive verification and independent review. It
checks the application's JSON behavior independently of agent-authored tests.
Its initial profile is Terra/medium for setup and builder roles and Sonnet
5/medium for review, using explicit model IDs from the maintained catalog.
This profile is a test configuration, not a product default or architecture pin.

Decision question: What execution and evidence boundary permits that longer,
interactive journey while preserving human gates, bounded resource consumption,
subscription privacy, independent assertions and truthful release evidence?

Drivers: first-user coverage (FR3-FR8), exact candidate/profile identity
(FR2/FR5), an independent success oracle (FR9-FR13), explicit non-pass outcomes
(FR14), finite resource ownership (FR15-FR17), and minimal retention
(FR18-FR19). The choice is ADR-eligible because the new harness executes generated
code with subscription access, owns teardown, and retains live evidence under
a contract different from the existing permission probe.

## Options Considered

### 1. Expand the existing live compatibility command

Benefits: one launch surface, reusable auth/preflight/cleanup concepts.

Costs: the short permission probe and interactive first-task journey have
different pass conditions, durations, human involvement and retention needs.
Changing its v2 summary or two-process budget would alter existing evidence.
Do not select this option; preserve the current probe intact.

### 2. Add an unattended E2E with automatic gate answers

Benefits: easier repeatability and eventual CI scheduling.

Costs: generated plans, configuration proposals and review findings are dynamic.
Unconditional approvals or copied approval state would invent human authority.
A bounded test-operator policy is a separate authorization design, not a switch
on the existing workflow. Defer this option; it is outside the initial scope.

### 3. Add a separate local supervised journey

Benefits: exercises real public setup and workflow behavior, retains actual human
decisions, preserves existing deterministic and live-probe contracts, and provides
external application assertions. A single scenario makes failures diagnosable.

Costs: requires an attended terminal, dedicated authenticated client state and
isolation for generated execution. Human time and hosted behavior vary. Minimal
retention restricts post-run debugging. Select this option.

### 4. Keep only a manual runbook

Benefits: minimal implementation and authentic human interaction.

Costs: no mechanically enforced candidate identity, deadline, external oracle,
cleanup or result projection. It cannot deliver repeatable E2E evidence. Keep
operator guidance as a companion, not the evidence owner.

## Decision

### Independent opt-in boundary

Provide a repository-owned local journey command with explicit live confirmation
and a real TTY. Keep it outside `test`, `verify`, `release:check`, the existing
`compatibility:live` command and all hosted jobs. A future CI wrapper requires a
separate proposal addressing attended decisions and protected execution.

Use public CLI operations and the actual independently installed plugin for the
candidate. Keep the target application-empty until Banzai setup creates its
guidance and configuration. Use an identified committed candidate distributed
into an isolated local runtime; never resolve the ambient global `banzai` or
silently use a different installed plugin. Record bundle/plugin content identity
as well as version. This establishes local candidate evidence only; it does not
claim npm registry availability or either client's marketplace installation.

Provision candidate runtime dependencies and matching client/plugin installation
as explicit prerequisites outside the scenario's model budget. Do not install
globally or update normal user configuration. A missing prerequisite is
`unavailable`; a confirmed candidate identity mismatch is `fail`.

### Human and model authority

The operator supplies current setup answers and reviews each applicable gate
through the existing interface. The harness may present instructions and observe
structured control status, but cannot invent, replay or blanket-approve decisions.
Do not alter production approval rules or insert a test bypass. An unresolved
gate remains unresolved until an exact human answer or the overall deadline.

Require the selected medium model/effort profile during onboarding as well as
workflow phases. Establish setup settings in the dedicated client context and
verify their effective selection using supported client behavior. Do not infer
them from Banzai role config. If a necessary production correction is discovered,
describe and verify it explicitly in the plan; do not patch the tested candidate
inside the harness. No silent model substitution or increased effort is allowed.

### Subscription and generated-code isolation

Use dedicated out-of-band subscription state and disposable client copies under
the established ADR-0011 principles. Do not accept API keys, third-party-provider
substitution, unrestricted ambient MCP servers, personal client transcripts,
deployment credentials or unrelated project mounts. Keep auth material out of
the application and its artifacts. Verify source credential stores and normal
client configuration are not modified.

The generated application and its verification commands run with access only to
their required synthetic project/input resources. They must not read vendor auth
state or write checker definitions, expected results, harness authority or the
retained summary. The planning boundary must name and demonstrate actual host
or sandbox enforcement; a sibling temporary directory or same-user file mode
alone is not an isolation proof. If the supported host cannot establish that
boundary, return `unavailable` before generated code executes. Do not claim a
temporary directory itself is a security sandbox.

### Independent application and workflow evidence

Keep scenario assertions fixed outside the model-writable project. The first
application reads JSON expenses with uppercase currency codes and safe integer
minor amounts and emits exact per-currency sums. Check empty input, mixed and
repeated currencies, deterministic key order, malformed/invalid input, overflow,
arguments, unreadable files, output streams, exit codes and unchanged inputs.
Validate checker identity before and after execution. Do not constrain generated
source layout beyond its specified command contract or require matching prose.

Pass only when all these facts are established for the same attempt:

1. genuine initialization, guidance and confirmed bootstrap readiness;
2. required effective model/effort settings and candidate identities;
3. strict planning and real implementation under current human authority;
4. accepted substantive Node verification setup continues the same run without
   invalidating plan approval or rerunning implementation just for configuration;
5. fresh, applicable runner-owned checks succeed on the final source;
6. independent review provides the run's review-pass completion basis;
7. external assertions and checker integrity checks succeed; and
8. owned resources are cleaned successfully.

`done`, a successful doctor result, builder prose, profile Skip, hygiene-only
checks or human-triage completion without review pass cannot replace these facts.
Permitted operator-authorized fixes remain within the same aggregate budget;
the first failure and all subsequent attempts stay distinguishable.

### Resource envelope

For the initial supervised scenario, enforce at most twelve model-bearing vendor
process launches, at most ten minutes per such process, and sixty minutes from
journey start to mandatory teardown. The overall deadline includes human waiting
and all checks; reserve bounded teardown time within it. Setup, workflow selection,
planning continuations, implementation, review, fixes and retries all consume
the same launch allowance. Bound generated application invocations separately
to short one-shot deadlines within the overall allowance.

These are conservative initial ceilings, not measured runtime estimates. An
interactive CLI process can make multiple provider requests. Report this limit
as process launches, never as twelve model requests, a token cap or a monetary
guarantee. Use supported client turn limits where available without pretending
they cap undocumented internal requests. Failure to enforce process ownership
or the deadline prevents live execution. Never restart the budget automatically.

### Results, local display and retention

Give the journey a separate versioned closed summary. Its allowed contents are
candidate/scenario content identities, normalized runtime/client versions,
effective model IDs/efforts, fixed stage/check IDs, per-check outcomes, bounded
durations and process counts, and fixed reason codes. The implementation plan
must pin exact keys, limits, exit semantics and validation before implementation.
Do not reuse or extend `banzai-live-compatibility/v2` for this evidence.

Use `pass`, `fail`, `unavailable` and `cancelled` as distinct overall outcomes,
with `not_run` for unexecuted checks. A demonstrable auth/quota/service outage is
unavailable evidence, even if it occurs after earlier stages. An authenticated
assertion violation, invalid mandatory evidence or a breached execution bound
is fail. Unknown errors are fail with a bounded code, not an inferred outage.
An observed failure cannot be overwritten by later cancellation or unavailability.

Local interactive display of the synthetic task, proposed changes and current
human decisions is necessary for informed approval. Allow that foreground display
without teeing it to normal logs or retaining a terminal transcript. Never print
raw auth diagnostics. Retain no prompts, reasoning, model/tool transcripts,
environment dumps, private paths or generated source. This local display rule
belongs only to this new journey; the current compatibility probe remains
noninteractive with its stricter stdout contract.

Close the attempt by terminating owned process groups and removing disposable
project, copied auth state, raw outputs and synthetic artifacts. Preserve only
the validated closed summary outside that disposable boundary. A cleanup failure
always produces fail with a fixed reason code; do not expose failed paths.
Post-run retention of raw diagnostic material needs a separate explicitly
authorized diagnostic design and is not provided by this increment.

Keep live results advisory to automatic gates. Missing evidence is not pass;
confirmed regressions still require maintainer triage under the principles of
ADR-0010. A live pass never authorizes a release and one pass establishes no
statistical reliability claim.

## Consequences

Positive: the first-user journey becomes observable without replacing real
approvals, the existing live probe remains stable, moderate model profiles are
explicit, and product assertions are independent of model-authored tests.

Negative: execution is attended, host isolation and dedicated client provisioning
are prerequisites, effective setup settings need separate confirmation, and
minimal retention limits later diagnosis. Provider-internal requests remain
outside exact counting; duration and process ceilings provide the enforceable
resource boundary.

Required follow-ups after acceptance: produce the implementation plan with exact
summary/exit contracts, enforceable isolation and lifecycle mechanisms, an FR/AC
traceability map, and proportionate deterministic negative controls. Measure
actual timing/process use only during a separately authorized live trial. Do not
increase ceilings silently when a trial fails. Consider additional stacks or
unattended execution only after separate evidence and scope decisions.

## Compliance and Confirmation

- Default commands and CI cannot start this journey or inherit its auth state.
- Missing confirmation, TTY, candidate/client prerequisites or enforceable
  isolation produces an explicit non-pass before dependent model/code execution.
- Real setup creates guidance from an application-empty repository; prewritten
  fixture guidance cannot qualify as E2E setup evidence.
- Profile checks detect an ambient setup model/effort even if workflow settings
  are correct, and no fallback hides the mismatch.
- Missing/stale human answers stop dependent work; exact Accept resumes the
  existing bootstrap run with substantive checks and valid plan approval.
- Negative controls reject `done` with absent review pass, stale verification,
  Skip, a broken generated command or a changed external checker.
- Process/time exhaustion, child descendants, interruption and partial setup
  are covered by ownership/cleanup checks without extra paid model calls.
- Secret/raw-output canaries cannot enter the closed summary or retained files;
  unrelated configuration/source sentinels survive success and failure teardown.
- Local deterministic checks, live candidate evidence and any future hosted run
  are reported separately. Current preparation asserts none of them was run.

## Lifecycle Links

- Supersedes: None.
- Superseded by: None.
- Complements ADR-0011 with a separate supervised E2E evidence class; does not
  amend its existing live probe, invocation budget, output or CI policy.
- Preserves ADR-0018 and ADR-0045 human/runner authority; introduces no automated
  approval actor or general product authorization mechanism.
