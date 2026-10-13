# ADR 0049: Task-Scoped Verification Authority

## Status / Date / Owner / Decision Makers

- Status: Accepted
- Date: 2026-09-17
- Owner: Banzai maintainers
- Decision makers: Project owner; explicitly accepted in chat on 2026-09-17
  with `Accept ADR-0049`.
- Accepted proposal SHA-256: `d055e45a809e9aebd4a3137b507453425dfacdad288538f0b69b64bd8c0f98c8`.
- Implementation: Implemented locally under the approved plan. Repository gate
  evidence and independent review are recorded in the private work artifacts.
- Planning: the owner approved `Approve plan task-scoped-verification`.
- Lifecycle effect: acceptance activates the new-path partial supersession and
  amendments specified in Lifecycle Links. Existing ADR bodies and their legacy
  applicability remain intact. Proposal-stage wording below is retained as the
  accepted decision text; this metadata records its current lifecycle status.

## Owner-authorized implementation amendment — 2026-09-18

The owner approved the task-scoped-verification plan and then explicitly removed
historical-run compatibility and migration from its scope. Existing runs may be
disregarded. Do not introduce binding v3: new work uses private binding v2 without
a legacy-layout continuation layer. Historical artifacts are neither rewritten
nor adopted as new authority. The accepted text below records the original
decision; this amendment overrides its historical-run continuation requirements.
Independent review is required after implementation and repository verification.

## Related Artifacts

- Private strict work: `task-scoped-verification`; its description contains
  FR1-FR22 and AC01-AC24. Product requirements relevant to this decision are
  summarized below so private work evidence is not a public prerequisite.
- Plan: private task-scoped-verification plan approved by the project owner;
  the implementation amendment below its lifecycle metadata records scope.
- Authority: root `AGENTS.md`; `PROJECT_MANIFEST.md` sections 3, 5, 6, 8 and 10;
  `packages/orchestrator/MODULES.md`.
- Decisions directly affected: [ADR-0006](./0006-versioned-verification-profiles.md),
  [ADR-0007](./0007-project-type-verification-readiness.md),
  [ADR-0038](./0038-explicit-plan-authority.md),
  [ADR-0043](./0043-proportionate-verification-evidence.md), and
  [ADR-0045](./0045-guided-verification-setup.md).
- Preserved boundaries: ADR-0001 (workflow selection), ADR-0008 (read-only
  diagnostics), ADR-0013 (proportionate assurance), ADR-0015 (physical verification
  evidence), ADR-0018 (versioned control), ADR-0019/0023 (frozen review/checkpoints),
  ADR-0027 (security assurance), ADR-0037 (independent review), ADR-0041/0042
  (private storage and independent instruction delivery), ADR-0044 (explicit
  instruction evolution), and ADR-0047/0048 (completion ownership and rendering).

## Context and Decision Drivers

The inspected source baseline is `2e86422460106ffaa8539f1edb3a77b28cd98a6c`.
Current facts, not proposed behavior:

- `verification.ts:assessVerificationReadiness` permits bootstrap only with no
  recognized project marker and zero substantive commands across all profiles.
  `workflow.ts:assertVerificationPreflight` rejects missing profile coverage for
  config schemas 2/3 before a new model attempt.
- `verification-cli.ts` owns an init wizard and profile CRUD; the runner can stop
  after implementation at `configuration_prerequisite`. An ordinary task can
  therefore depend on maintaining a separate command catalogue.
- Discovery suggests existing conventional script names. Presence of a `test`
  key does not establish a real test: a new npm project's default script exits
  with an error, and a copied profile can refer to a nonexistent `typecheck`.
- `plugins/banzai/lib/verification-evidence.mjs:parseVerificationObligations`
  accepts one `banzai-verification-obligations/v1` inventory containing only check
  IDs/evidence modes and requires those IDs to mirror configured commands in
  order. This is evidence-reuse authority, not a self-contained execution plan.
- Strict approval binds the description, accepted ADRs and plan. Lite authority
  binds a persisted workflow selection; lite has no human-reviewed plan bundle.
- `workflow.ts:executeVerification` starts configured commands through
  `process.ts`. Direct executable/argv spawn and process termination do not imply
  the sandbox configured separately for a child Codex CLI invocation. Project
  scripts can execute arbitrary project code even when the outer spawn has
  `shell: false`.
- A protected profile prevents model edits to the runner's command declaration;
  it does not make `npm test` an independent witness when the agent can edit
  project scripts/tests within its implementation scope.

Decision question: what task-bound authority and evidence contract replaces
mandatory profile configuration across strict and lite work while preserving
actual execution permissions, mandatory assurance and historical meaning?

The owner has already specified the following product direction:

1. Start normal work without mandatory profiles, bootstrap or profile-coverage
   stops; optional policy must not be required to use Banzai.
2. Determine relevant verification from requirements and actual project evidence;
   do not copy discovery into another user-maintained configuration.
3. Bind strict obligations to approval and lite verification to the authorized
   task and existing permissions, with no new verification approval ceremony.
4. Permit authorized supplementary checks without weakening obligations or
   editing approved bytes.
5. Retain runner-owned actual results, meaningful outcome distinctions and
   substantive independent review in strict work.
6. Preserve historical authority and define unfinished-run compatibility.

This is one coupled execution-authority decision. Discovery parsers, individual
module splits and UI layout are implementation choices. The material drivers
are first-task usability, truthful failure/absence, authority separation,
proportionate assurance, bounded persistence and compatibility.

## Options Considered

| Option | Benefit | Cost and disposition |
| --- | --- | --- |
| Retain profiles and improve the wizard/bootstrap exceptions | Small change; existing command authority remains | Keeps a second catalogue and profile readiness as task prerequisites. Does not meet the requested product behavior. Reject. |
| Discover commands and automatically persist profiles | Removes some manual entry | Preserves drift and can confidently copy placeholders or irrelevant commands. Reject. |
| Use all discovered project commands as an ephemeral allowlist | Avoids persisted configuration and supports common scripts | Discovery is not authorization; mutable project metadata can extend the list, names do not establish relevance, and arbitrary project code remains executable. Reject as an authority boundary; retain discovery as input. |
| Let model output directly specify unbound runner commands | Flexible for empty/custom projects | Gives proposals execution authority without a task, policy, permission or immutable-evidence boundary. Reject. |
| Require human approval of every verification command in every workflow | Explicit command review | Creates the replacement ritual the owner rejected and turns lite into strict-like planning. Reject as the normal path; retain existing escalation for genuinely missing authority. |
| Bind strict verification to the approved plan and lite verification to delegated task authority; let the runner validate and record concrete execution | Removes profile setup, supports future-created tooling and retains provenance | Requires successor contracts, permission-context validation, legacy continuation and explicit limits on semantic guarantees. Select for proposal. |

## Decision

### 1. Make task verification the default for new work

Remove mandatory profile coverage, the bootstrap switch and the configuration
prerequisite from the new execution path. New initialization must not create a
verification profile or ask the user to configure one. Missing project markers,
tooling or conventional script names are not readiness failures. Preserve
unrelated adoption, authentication, instruction-integrity and ownership checks.

Read relevant project metadata, tool configuration, CI and instructions as
inert evidence. Do not execute discovery hooks. Support checks outside the
fixed root taxonomy, including relevant nested package work and custom names,
without attempting to interpret every build language. A bounded source
inspection may be unavailable; distinguish that from confirmed absence.

Let the planning/implementing agent propose task-relevant checks using existing
phase calls. Proposals identify the requirement/rule served, their source and
their concrete execution. Do not add a model phase solely for verification
configuration. Do not infer substantive coverage or a duty to execute from the
name `test`, from every CI step, or from documentation examples.

### 2. Bind strict obligations through a successor contract

Introduce `banzai-verification-obligations/v2` for new strict plans. The approved
inventory owns an ordered set of mandatory task obligations and concrete check
descriptors instead of referencing an independently configured profile list.
Each descriptor carries its stable check identity, requirement/rule reference,
executable, ordered arguments, repository-relative working directory, bounded
timeout and evidence requirement. The inventory's completeness assertion and
the surrounding plan commitments remain part of the exact approved bundle.
The machine inventory cannot weaken binding prose or stronger project policy.

Render these checks as readable task verification in the ordinary plan review;
the user does not author argv fields or approve a separate configuration form.
Plan approval is not permission to exceed the actual execution boundary.

Permit a descriptor for tooling the implementation is explicitly authorized to
create. For example, an approved plan can require `npm run lint` before an
ESLint configuration exists. Identify that future materialization and the
requirement it must exercise; absence before implementation does not prevent
approval. Capture the actual implementation and inputs for execution later.
Do not pretend to hash nonexistent inputs or freeze the pre-implementation
source tree as the only allowed final implementation.

Keep v1 decoding and semantics unchanged. A v1 inventory remains profile-derived
reuse authority for its legacy run and cannot authorize v2 execution.

### 3. Bind lite proposals to delegated task and execution authority

Use the existing user task/start authority and persisted workflow-selection
identity for lite verification. That authority delegates relevant routine local
verification within the already permitted task execution context; it does not
claim that the human reviewed each proposed command. Do not add a plan, profile,
new mandatory permission prompt or command-approval gate to normal lite work.

Before execution, the runner must resolve and bind:

- the exact work/run and source attempt, request/workflow authority and any
  stronger applicable project rules;
- the proposed check and its stated task purpose/source;
- the effective execution context and applicable limits/prohibitions;
- the current source/input identity used to resolve the command.

Separate the candidate's provenance from its authorization. Adding a script,
assigning a new check ID, returning model output or supplying a source hash
cannot create a new execution permission. The runner validates structured
requests, identifiers, allowed working directories, limits, applicable policy
and context before it launches them. Unknown or conflicting authority follows
the existing escalation/permission path; it never falls back to a more
privileged runner context.

Bind permissions at the actual executor. Do not treat the runner's ability to
spawn a process as user authorization, or a child model CLI's sandbox flag as
containment of runner commands. When an authorized context requires restrictions,
execution must retain them; if that cannot be established, report the concrete
missing capability without launching. Existing ambient local execution remains
ambient only where it is already authorized. This decision grants no new
filesystem/network/credential/publication capabilities and adds no sandbox
product or universal shell-safety classifier.

The validation guarantee is intentionally bounded. Project scripts, dependencies
and tests are executable code, not a trusted-command taxonomy. Structural
validation and source provenance cannot prove the absence of hidden side
effects or natural-language task relevance. Applicable host restrictions remain
the enforcement for restricted effects; normal authorized local project code
retains the trust assumption and capabilities of its real execution context.
Document that assumption instead of claiming `shell: false` makes scripts safe.

### 4. Keep required, supplemental and policy authority distinct

Mandatory strict obligations remain immutable under their approval. Record
additional permitted checks as runner-owned supplements linked to the same
authority and current work, not as edits to approved plan bytes. In lite, record
the selected checks and task-purpose claims under the persisted task authority.
The first execution freezes the concrete descriptor for that attempt.

Additions cannot replace missing mandatory checks, hide prior failed attempts,
or convert a required check to optional. A changed mandatory descriptor requires
the ordinary reapproval route. Source implementations may evolve within the
approved work without constant reapproval, but current evidence and semantic
assurance must follow that evolution. A new command ID is not an exemption.

Allow optional owner-defined requirements/prohibitions and execution limits.
Absence of that policy is valid; malformed or unreadable declared authority is
not absence. Project rules can require stronger checks than the selected task
would otherwise need. A model may not edit that authority through an execution
proposal or reinterpret ordinary project metadata as a new policy grant.

Do not introduce a new mandatory command-policy file. Preserve existing project
instruction authority and allow optional machine policy to enforce explicit
constraints. A policy can deliberately name a required check; it is not required
to repeat every discovered or task-specific command.

### 5. Persist execution records rather than another configuration

Give new task-verification requests, receipts and state projections explicit
successor contract identities. Validate proposals as data; the runner resolves
and publishes their executable records under existing ownership. Models cannot
write the runner's state, permissions, policy or successful receipts. Direct
executable/argv execution, bounded timeouts, process cleanup and output redaction
remain required.

Each physical attempt records its check/obligation identity, descriptor, actual
working directory, task/approval/policy/context authority, input identity and
capture completeness, start/terminal state, exit/signal/timeout observations and
redacted output references. Preserve previous attempts. A supplement, retry or
new round links to its own origin and cannot overwrite a failure.

These records explain what ran and why. They are immutable execution history,
not a user-maintained list consumed as the default for the next unrelated task.
Reinspect relevant project state for each new selection/round; revalidate before
launch and assess drift before applying results. External changes after capture
must not be silently attributed to the old inputs. A capture failure can require
fresh execution, but never proves equivalence or complete input coverage.

Keep ADR-0043's conservative evidence-reuse principle: only proven compatible
authority, command, relevant inputs and successful physical origin can establish
equivalent evidence. No cross-task cache or command-name shortcut is added.
Changed scripts, tests, runner configuration, toolchain or policy may invalidate
evidence even when `npm test` remains the same command. Mandatory fresh checks,
including this repository's release gate, remain fresh. Default to actual
execution when reuse cannot be established; report missing applicability
truthfully rather than synthesizing success.

### 6. Separate observation, assurance and completion

Expose the description's distinctions for passed, failed, not-run and absent
verification, with truthful timeout/interruption/unavailable reasons. A started
and interrupted process is not an unstarted command. An empty selected set is
not a passed suite. Status and review derive execution claims from receipts,
not implementer-written totals or completion prose.

Completion evaluates the applicable requirements. An absent irrelevant check
does not block a task, while an absent or failed required check does. A legitimate
task with no required automated check can complete using its actual proportionate
assurance while reporting `Verification: absent`. A failing supplemental check
remains visible; if it demonstrates an unsatisfied task requirement, labeling it
supplemental does not authorize successful completion. Existing human authority
may change an obligation through its actual decision path, not by editing a
result label or ignoring a failed receipt.

In strict review, require assessment of the connection between checks and
requirements and unjustified weakening of scripts/tests, using the frozen source
and execution evidence. A stable command digest, zero exit and completion ledger
do not prove a meaningful test. Retain existing triage and reviewer independence;
triage of findings alone is not a silent waiver of independently binding
verification obligations. Lite retains its current assurance model and does not
gain an additional independent-review phase.

Preserve the last valid completed implementation/fix checkpoint when verification
fails or is interrupted. Retry/resume uses its current authority and evidence;
it does not replay implementation just to repair verification configuration.
Source edits that are actually needed remain subject to the existing fix or
escalation scope. Do not invent success or automatically reclaim uncertain work.

### 7. Version the transition and retain bounded legacy continuation

Use the new model for newly created tasks, including projects with readable
config schemas 1/2/3. A successor configuration format permits an absent
verification section and optional policy, without profiles or bootstrap. New-run
mode selection is explicit in persisted state, not inferred repeatedly from the
current config schema or absence of a field.

Read old configuration without rewriting it. For new task verification, legacy
profiles are at most candidate information; their presence alone does not make
their commands mandatory, prove authority or trigger readiness. Independently
binding project rules remain binding. Existing opt-in reuse policy remains a
constraint on reuse where representable, not a reason to run every old profile.
If a relevant explicit policy cannot be faithfully interpreted, report that
specific incompatibility instead of dropping it. Do not silently convert old
profiles into mandatory policy, reintroducing the removed gate under a new name.

Keep unfinished legacy runs on their recorded verification authority and
version-bound continuation. Preserve existing approvals, pending configuration
decisions, retry eligibility and receipts. Do not automatically move them to the
new model. If a user needs the new semantics for such work, the supported first
transition is an explicit new task with fresh workflow/plan authority after the
old run is finished or explicitly cancelled; existing project source is not
discarded, and old execution results are not imported as newly authorized proof.
In-place migration of active approvals is outside this change.

Retain legacy readers/execution support only for this compatibility boundary,
and clearly label legacy configuration operations. Existing public commands and
v1 helper requests must not silently change what they authorize; version or
deprecate changed surfaces explicitly. New init/help/doctor and ordinary task
flows lead with task verification and never prescribe profiles/bootstrap. Doctor
remains read-only and executes no discovered command.

Use successor state/control/review contracts where meanings change. Frozen
evaluation/KPI/context contracts gain neither fields nor reinterpreted success
counters; represent new unsupported evidence through their existing truthful
incomplete/unknown handling or a separately versioned successor. Do not alter
historical plans, snapshots, receipts or exports during inspection or upgrade.

### 8. Preserve independent delivery and private evidence

Share the canonical task-verification authority/validation rules between the
plugin helper and the orchestrator, following the existing builtin-only shared
boundary. Give the standalone helper a successor request contract rather than
changing v1's configured-check meaning. Standalone execution binds actual
skill/human task authority and work ownership; it cannot invent persisted runner
workflow selection, plan approval or runner completion receipts.

Keep evidence in the existing private run/work ownership boundaries. The runner
and standalone helper publish their own records, and consumers identify the
actual executor. A missing orchestrator installation is not a reason to require
profiles or fake runner evidence in plugin-only work.

Treat new metadata as untrusted display input. Do not put secret values in
command descriptors, authority identities or public aggregates. Preserve exact
private provenance only within existing redaction and retention rules; retain
safe command/environment references when secret values are needed at execution.
No new cloud storage, vendor API, credential collection or external publication
is part of this feature.

## Consequences

Positive consequences:

- Empty and ordinary existing projects can perform useful work without profile
  maintenance; verification follows task needs and real tooling.
- Strict approval owns the checks it promises instead of depending on a second
  mutable command catalogue. Lite retains its shorter workflow.
- Failures, missing checks and incomplete evidence remain honest, and immutable
  receipts support review and recovery without becoming configuration.

Costs and explicit risks:

- Multiple public/persisted boundaries change together. Config acceptance alone
  is not implementation: execution, evidence, completion, diagnostic, helper,
  control, review and instruction surfaces require coordinated validation.
- Command relevance and test quality remain partly semantic judgments. The old
  profile did not prove these either. Strict review must inspect unjustified
  weakening; lite retains its existing lack of an independent reviewer. This is
  an explicit residual assurance risk proposed for owner acceptance.
- Authorized project scripts can run executable dependencies and nested tools.
  Direct spawn and provenance do not sandbox them. The effective permission
  context must be enforceable at the actual executor; a design that relies only
  on the model child's sandbox is noncompliant. Host/vendor boundary evidence
  cannot be substituted with mocked success.
- Conservatively checking inputs may require additional executions. Unknown
  input coverage cannot become a cache hit or fabricated assurance.
- Legacy unfinished runs retain their old UX until completion or explicit
  cancellation/new work. This bounded exception preserves their authority; the
  default new-task experience must not inherit it.

Required follow-ups after acceptance: a consistency-checked development plan,
exact successor contract inventory and compatibility fixtures, explicit
instruction-baseline transitions under ADR-0044, maintained guidance/help and
manifest updates after implementation, and the normal release verification.
Dependency additions or live vendor validation retain their separate authority.

## Compliance and Confirmation

The implementation plan must map every FR/AC from the description to its evidence
owner. The following are future checks, not results claimed by this proposal:

| Guarantee | Required observable confirmation |
| --- | --- |
| First task and stale profiles | Empty project and existing-config journeys start, create tooling and finish with relevant evidence without profile CRUD/bootstrap/configuration prompts. Include a failing npm placeholder and nonexistent unrelated typecheck. |
| Useful discovery | Read-only inspection handles custom/nested checks, malformed/unreadable metadata and inert display; discovery executes no project command or config write. |
| Strict authority | Approved v2 descriptors run; tampered mandatory argv/cwd/limits and removal/substitution are refused. Authorized future tooling can be created without gratuitous reapproval. |
| Lite permissions | An authorized local task runs checks without a new ceremony; an out-of-scope proposal and a less-restricted execution fallback are refused before launch. Adding a script or ID grants no permissions. |
| Supplement and policy | Supplementary execution preserves approved bytes and required failures; missing optional policy works, explicit obligations hold, and invalid declared authority never becomes an empty policy. |
| Evidence and drift | Actual descriptor/input/authority/result identities survive retry and inspection. Unchanged `npm test` with changed scripts/tests invalidates old applicability; unavailable inputs never establish equivalence. |
| Outcomes and completion | Absent, failed, unstarted, interrupted, timed-out and unavailable cases remain distinct; required failures block completion while a justified no-automation task can finish without claiming a pass. |
| Semantic assurance | Controlled cases with trivialized or narrowed tests expose the unmet requirement in strict review; completion ledger/zero exit cannot replace that assessment. Do not claim deterministic semantic proof from unit fixtures. |
| Continuation | Verification interruption preserves the completed implementation checkpoint and receipts; retry does not replay implementation for configuration repair. |
| Compatibility and privacy | New tasks use new semantics with old config bytes unchanged; legacy pending/approved runs retain their route; old contracts stay meaningful and frozen projections expose no new raw command/secret payload. |
| Delivery | Plugin-only and orchestrator paths share guarantees and identify the true executor; generated resources and committed CLI bundle remain in sync after implementation. |

Use proportionate deterministic contract/integration/CLI tests for the state and
authority guarantees. Claims about actual supported-host permission enforcement
require execution at that boundary; live vendor assertions require the existing
explicit authorization and protected evidence path. No live execution is
authorized by proposing or accepting this ADR alone.

## Lifecycle Links

- Amended by [ADR-0054](./0054-git-visible-work-artifacts.md), accepted
  2026-10-13: new task verification consumes explicitly selected tracked
  documents without requiring private document storage or binding v2.
  Verification authority and the exclusion of historical-run migration remain.
  Implementation is Planned.

Supersedes: None while Proposed. If accepted, this decision supersedes the
following provisions for the new task-verification path only:

- ADR-0006: mandatory profile representation and config-owned command selection;
  historical config interpretation and direct-process execution guarantees stay.
- ADR-0007: project-type profile coverage as readiness authority; read-only
  diagnostics and truthful hygiene/assurance distinctions stay.
- ADR-0045: bootstrap, mandatory profile setup/CRUD guidance, new-run profile
  preflight and the new-flow configuration-prerequisite lifecycle. Its legacy
  continuation and unrelated instruction/parity protections stay.

Amends on acceptance:

- ADR-0043: new verification authority, command identity, evidence-mode binding
  and the v2 plan inventory; conservative input/provenance/reuse rules remain.
- ADR-0038: required verification evidence is represented by a self-contained
  approved v2 inventory plus binding prose, with separate non-replacing
  supplements. Approval immutability and human obligation changes remain.
- ADR-0008/0018/0037: successor diagnostics/control/review projections represent
  task verification. Their offline/privacy/read-only/independence boundaries stay.

Related compatibility constraints: ADR-0015, ADR-0019, ADR-0023, ADR-0041,
ADR-0042 and ADR-0047/0048 retain their evidence, checkpoint, delivery, ownership
and rendering guarantees. This proposal neither self-accepts nor changes an
existing ADR's lifecycle metadata. On acceptance, update only appropriate
lifecycle links/status metadata on older records; do not rewrite their bodies.

Superseded by: None.
