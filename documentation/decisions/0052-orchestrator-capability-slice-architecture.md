# ADR 0052: Orchestrator Capability-Slice Architecture and WorkflowRunner Decomposition

## Status / Date / Owner / Decision Makers

- Status: Accepted
- Date: 2026-09-28
- Owner: Banzai maintainers
- Decision makers: Project owner; explicitly accepted in chat on 2026-09-28.
- Accepted proposal SHA-256:
  `47bf2797f2c4e2ac27431a3acc457c540d9c779cfe39096449b44c613bcb529c`.
- Review: review-1 findings F1 and F2 accepted by the project owner on
  2026-09-28 and resolved in rework 1, together with two owner-accepted
  extensions: release pins in test files and path references in
  `release-policy.json`. Reviews are recorded in private work artifacts.

## Related Artifacts

- Requirements: standalone architecture request from the project owner on
  2026-09-28, recorded in chat: decompose `WorkflowRunner` first, then refactor
  the whole orchestrator gradually. The dependent plan is created after
  acceptance.
- Review: private work `adr-0052-capability-slice-architecture-review`,
  review-1.
- Manifest: sections 3 (architecture and dependency direction), 4 (flat source
  and mirrored test layout), 5 (module responsibilities) and 10 (active
  decision index) of `PROJECT_MANIFEST.md`; `packages/orchestrator/MODULES.md`.
- Related decisions:
  - ADR-0028, Phase Context Accounting and Budget Policy: its risks and
    follow-ups defer broad `WorkflowRunner` decomposition until phase ownership
    is shown to be a material context or maintenance bottleneck. This decision
    records the maintenance evidence and lifts that deferral.
  - ADR-0029, ESLint-Backed Orchestrator Import Boundary Policy: the exact
    per-module policy that makes this decision's dependency rule executable.
    This decision adds one restriction class for pure decision modules.
  - ADR-0030 and ADR-0050, Engineering Quality and triggered code-design
    assessment: supply decision drivers (EQ-02, EQ-03, EQ-06, EQ-09, EQ-10)
    and the constraint that decisions are separated from effects only with
    read timing, failures and ownership preserved. Neither mandates an
    architecture; this decision is specific to this repository.
  - ADR-0013, Risk-Driven Test Assurance: evidence at the cheapest layer that
    can falsify a guarantee.
  - Capability owners whose invariants this decision preserves unchanged:
    ADR-0017, ADR-0025, ADR-0047 and ADR-0048 (completion); ADR-0023 and
    ADR-0051 (terminal checkpoints and digest evidence); ADR-0024
    (prerequisite-blocked fix recovery); ADR-0043 and ADR-0049
    (verification); ADR-0021 and ADR-0037 (review); ADR-0045 (configuration
    prerequisite); ADR-0020 and ADR-0022 (Claude invocation scope and MCP
    whitelist); ADR-0034 (human time); ADR-0035 (cancellation).

## Context and Decision Drivers

**Current state.** Manifest section 3 places `workflow.ts` between the
interface modules and `adapters.ts`; section 4 records a flat `src/` with one
module per responsibility. The orchestrator has 72 production modules and about
57,000 source lines. `workflow.ts` holds 13,629 of them, and the
`WorkflowRunner` class alone spans about 12,400 lines and about 155 methods.

The file grew from 8,906 lines at v2.4.0 (2026-09-12) to 12,966 at v2.6.1
(2026-09-18) and 13,629 now. Ten of the seventeen commits since 2026-09-01
modified it, including the most recent defect fix (digest rejection handling
and retry eligibility). This is the maintenance bottleneck named by ADR-0028's
deferral condition.

The class is a module of procedures rather than a stateful object. Its only
owned mutable state is an invocation-scope cache with two reporting flags, a
progress sequence counter, an `AsyncLocalStorage` marking configuration
ownership, and a cancellation-receipt map. Run state lives in `RunStore`:
`this.store` appears in 89 methods and `this.repoRoot` in 70. The members
cluster by capability, and most clusters correspond to accepted ADRs:
completion protocol (about 2,000 lines), public commands (about 1,850),
eligibility and recovery (about 1,430), verification (about 1,260), attempt
lifecycle and context-bound invocation (about 1,100), phase executors (about
1,060), terminal checkpoints and digest evidence (about 1,000), review (about
eight hundred) and configuration prerequisite (about 670). Five methods exceed
about 350 lines each.

Three structural problems follow:

- Decisions are interleaved with effects. Retry eligibility is mostly pure
  rules over `RunState`, but it reads verification ledgers inside individual
  branches and selects outcomes by matching `blockReason` text prefixes. The
  rules cannot be tested without constructing persisted runs.
- Ambient effects bypass explicit collaborators: 27 direct filesystem calls,
  12 `randomUUID()` calls and 6 clock reads.
- Phase continuation is implicit. `resume` dispatches on `RunStatus`, while
  phase executors also continue by tail-calling the next phase:
  `applyPhaseResult` calls verification, verification calls review, review can
  return to verification, and authorized recovery calls planning,
  implementation or fix. `retry` repeats much of that dispatch in its own
  branches. At least one continuation, strict review after task checks, runs
  inside the verification error handler, so an exception escaping review is
  handled as a verification failure.

Two conditions make incremental change feasible. `test/workflow.test.ts`
(11,352 lines) constructs `WorkflowRunner` 165 times and exercises only its
public API; no test reaches a private member. Only five production modules
import `workflow.ts`: `cli.ts`, `interactive.ts`, `agent-control.ts`,
`agent-control-cli.ts` and `verification-cli.ts`. The import-boundary importer
pattern, the ESLint globs, the TypeScript includes and the test runner already
accept nested directories. `check-release.mjs` pins source text in `store.ts`,
`validation.ts`, `types.ts`, `prompts.ts` and `cli.ts`, but not in
`workflow.ts`.

Three existing mechanisms bind relocation beyond import statements:

- `plugins/banzai/lib/artifact-readers.mjs` is generated from ten production
  modules through `persisted-readers.ts`. Those modules are `artifact-storage`,
  `cancellation-evidence`, `config`, `configuration-prerequisite`, `errors`,
  `models`, `types`, `validation`, `verification-config` and `verification`.
  The generated file carries their source paths. `build:check` requires byte
  parity with a fresh generation. The release validator's hook-runtime rule
  requires a release-train version change whenever `plugins/banzai/lib` bytes
  change.
- `check-release.mjs` also pins text in five test files, including
  `workflow.test.ts`. `release-policy.json` names `src/phase-resources.ts`.
- Some tests identify production modules by path string rather than by
  import: lint importer identities, expected diagnostics and fixture file
  operations. Other path-like strings in tests are inert fixture data.

**Target state.** The orchestrator is organized by capability under one
executable dependency rule. Workflow decisions are pure functions testable
without a repository, effects cross explicit collaborators, and one dispatcher
owns phase continuation. `WorkflowRunner` remains the stable public facade
throughout the migration. No runtime behavior, persisted byte, public contract
or CLI output changes.

Decision question: which architecture and dependency rule should the
orchestrator adopt so that `WorkflowRunner` can be decomposed incrementally,
and the remaining modules can follow, without changing observable behavior?

Decision owner: Banzai maintainers, with explicit lifecycle approval by the
project owner.

Decision drivers:

- zero change to runtime behavior, persisted formats, events, contract
  identities, CLI output, exit and error codes, and block-reason text (EQ-09);
- ownership aligned with the accepted ADR that owns each capability (EQ-02);
- inward dependency direction, executable through the existing lint boundary
  (EQ-03, ADR-0029);
- decisions testable at the cheapest layer that can falsify them (ADR-0013);
- abstraction only where it isolates volatility or enables needed
  verification; no interface per dependency and no DI container (EQ-06);
- a staged path in which every stage passes the full gate and the migration
  can stop after any stage without leaving the tree inconsistent (EQ-10);
- preserved read timing, failure attribution, lock ownership and effect order
  when decisions are separated from effects;
- no new runtime or development dependency.

## Options Considered

### Option 1: Keep the single runner and ADR-0028's deferral

- Benefits: no churn; no policy or documentation change.
- Costs and risks: every capability change keeps landing in one class; review
  and test cost keep rising with its size; decision rules stay untestable in
  isolation; the implicit continuation chain keeps accumulating handler
  coupling.
- Rejected: the deferral condition is met by the maintenance evidence above.

### Option 2: Split `WorkflowRunner` into flat sibling modules

Move method groups into new top-level modules such as `workflow-completion.ts`
and `workflow-review.ts`, keeping the flat layout and adding no structural
rule.

- Benefits: the smallest convention change; the file-size symptom disappears
  quickly.
- Costs and risks: decisions and effects stay interleaved in smaller files;
  tail-call continuation stays; the flat namespace grows past one hundred
  modules with no grouping the policy can express; each module is likely to
  receive the whole runner or an equivalent coordinator merely to split files,
  which the code-design method rejects.
- Rejected: it relocates the problem without changing the structure that
  produced it.

### Option 3: Horizontal hexagonal or clean layering across the orchestrator

Organize `src/` as `domain/`, `application/`, `ports/` and `adapters/`, with an
interface for every infrastructure dependency, including the run store, Git and
artifact storage.

- Benefits: a widely known model; a strict dependency rule; the whole core is
  testable with fakes.
- Costs and risks: the orchestrator has no rich entity model; its domain is a
  state machine plus authority, digest and eligibility rules over persisted
  records. Horizontal layers would spread each ADR-owned capability across
  three or four directories. Mirror interfaces add ceremony without
  substitution value: `RunStore` alone exposes about 65 methods, and neither the
  filesystem store nor Git is expected to be replaced. `adapters.ts` already
  means vendor adapters, so the vocabulary would collide.
- Rejected: Option 4 adopts its core principles — inward dependencies, a pure
  core and explicit process-boundary ports — without the horizontal top-level
  partition or universal ports.

### Option 4: Capability slices with a functional core, boundary-only ports and one continuation dispatcher

Group modules by capability; inside each slice, keep pure decision modules
apart from effectful shells; introduce ports only at process boundaries;
replace tail-call continuation with one status-driven dispatcher behind the
unchanged facade.

- Benefits: ownership follows ADRs; the dependency rule stays executable at
  module granularity; decision rules become directly testable; the existing
  facade and tests act as the characterization net; work proceeds in
  independent stages.
- Costs: many new modules and policy entries; a documented change to the
  manifest's flat-layout convention; staged churn in the committed bundle and
  documentation; release-train version changes for stages that relocate modules
  bundled into the generated plugin reader.
- Risks: effect-order or handler-attribution drift during extraction and
  dispatcher conversion, constrained by the compliance checks below.
- Selected.

### Option 5: Separate workspace packages or TypeScript project references

- Benefits: physical isolation enforced by package exports.
- Costs and risks: multiple manifests, builds and release surfaces; it does not
  express narrow module constraints by itself. ADR-0029 already rejected it as
  disproportionate for the same source tree.
- Rejected: it remains available to a later decision if the orchestrator splits
  into separately delivered products.

## Decision

Adopt Option 4.

### 1. Architecture style and areas

Keep the orchestrator one workspace package and one bundled executable.
Organize production source into capability areas, each a directory directly
below `packages/orchestrator/src/`:

- `workflow/` — the run engine that replaces `workflow.ts`;
- `interface/` — human and agent entry surfaces: CLI command modules,
  interactive TTY modules, agent control, and terminal presentation and
  rendering;
- `reporting/` — read-only projections (evaluation export and KPI, context
  report, cancellation report, doctor), retaining every narrower isolation rule
  their ADRs already impose;
- `setup/` — initialization, project setup, model selection and
  verification-configuration flows;
- `contracts/` — runtime decoders, embedded schemas, prompt envelope and output
  contract;
- `infrastructure/` — effects at process boundaries: run store, Git, process
  execution, vendor adapters, MCP resolution, configuration loading and the
  artifact-storage and verification-evidence facades;
- `shared/` — `types` and `errors`.

`cli.ts` remains at the source root as the bundle entry point and composition
root. The dependent plan assigns every existing module to exactly one area; a
module consumed by several areas lives in the innermost area its dependencies
allow. Moving a module is a relocation, not a responsibility change; a plan may
split a module while relocating it only by naming each resulting module and
its owner.

### 2. Dependency rule

Dependencies point inward: `interface/` → application areas (`workflow/`,
`setup/`, `reporting/`) → `infrastructure/` and `contracts/` → `shared/`.
Modules classified as domain modules may depend only on other domain modules,
pure `contracts/` modules and `shared/`; they never depend on infrastructure,
application or interface modules. Infrastructure never depends on application
or interface modules. `reporting/` never imports `workflow/`. Outer areas import
`workflow/` only through its facade and the pure projection modules the facade
designates for status rendering. The production module graph is acyclic.

Within `workflow/`, dependencies run commands → continuation dispatcher →
phase executors → capability slices → workflow domain. A capability slice never
imports a command, the dispatcher or the facade. An edge between peer slices is
permitted only when a plan names it and the graph stays acyclic.

### 3. Workflow area

Decompose `WorkflowRunner` into:

- a facade that keeps the class name, its public methods, the exported types
  and functions production modules consume, and every existing constructor call
  form, and delegates to commands;
- an explicit runner context carrying only immutable collaborators: repository
  root, run store, vendor adapters, process runner, progress reporter,
  human-time observer, clock and identifier source;
- one command module per public use case: start, resume, retry, recover,
  restore, plan approval, ADR decision, human-decision answer, decision
  consultation, configuration prerequisite, triage, cancel, cancellation
  response and status;
- phase executors for selection, planning, implementation, fix, verification
  and review;
- capability slices for attempts, completion, verification, review, terminal
  checkpoints and digest evidence, recovery, configuration prerequisite and
  preflight;
- a workflow domain holding the state machine and pure decision rules.

The runner context is a collaborator record, not the runner and not a service
locator. Each piece of owned mutable state — the invocation-scope cache and its
reporting flags, the progress sequence, configuration-ownership storage and
cancellation receipts — has exactly one owning module that exposes operations
rather than fields. No extraction widens mutable access or passes the facade
into a slice.

### 4. Decisions separated from effects

Express eligibility, authority, next-action, review-execution policy,
transition selection and digest-comparison verdicts as pure functions over
explicit facts, with effectful shells that gather facts, apply decisions,
perform effects and record evidence.

Preserve read timing and failure semantics exactly. Where current code reads
evidence only on some branches, the extracted core must not read it
unconditionally: stage the decision into successive pure steps or give it
lazily evaluated facts, so a malformed or unreadable source fails on exactly the
paths where it fails today.

Block reasons keep their current text and their current matching. Replacing
text-prefix matching with a typed cause changes persisted state and is outside
this decision.

### 5. Ports

The workflow area's ports are the existing vendor adapters, process runner,
progress reporter and human-time observer, plus a new clock and a new
identifier source whose defaults preserve current values and formats. Run
store, Git, artifact storage and configuration loading remain concrete
infrastructure modules; introduce an interface for one of them only when an
accepted plan shows a concrete verification need that the facts-based core
does not already meet. Other areas keep their existing boundaries, such as the
interactive I/O interface.

### 6. Continuation dispatcher

One dispatcher owns phase continuation: given persisted state, it selects the
next phase executor from `RunStatus`. Phase executors return their resulting
state instead of invoking the next phase, and commands that continue a run go
through the dispatcher. Convert a continuation only after the phase executors
it connects have been extracted.

For every current continuation site, the conversion preserves the enclosing
error handling, lock ownership, activity and human-time observation, and the
exact ordered sequence of state writes and events. The strict-review
continuation inside the verification error handler is one such site. Where
exact preservation keeps a demonstrable defect, the conversion still preserves
current behavior; the defect is recorded and corrected under separate approval.

### 7. Migration and compatibility

Migrate in stages behind the unchanged facade. Each stage preserves behavior
and leaves the tree releasable:

- `npm run verify` and `npm run release:check` pass;
- generated outputs and the committed bundle are regenerated;
- the import-boundary policy, `MODULES.md` and the manifest describe the
  resulting current state.

`test/workflow.test.ts` and the other existing suites remain the
characterization evidence, and their assertion strength is preserved. A stage
may change existing tests only mechanically, to follow relocated modules. The
permitted changes are:

- import specifiers;
- strings that identify a relocated production module, such as lint importer
  identities, file-operation paths and path-bearing expected diagnostics;
- moving a test file to its mirrored path.

After such a change, the test still exercises the relocated production module.
It still rejects the same forbidden dependency, contract mutation or behavior.
Fixture data that refers to no production module, such as example evidence
paths, stays unchanged. New tests live at the mirrored path under `test/`, for
example `test/workflow/recovery/<module>.test.ts`.

Some files are named by path or pinned by text elsewhere in the repository:

- source or test files whose text `check-release.mjs` pins;
- modules named by a build script, a release script or `release-policy.json`.

When a stage moves such a file, the same stage updates the reference without
weakening the check. Stage order and content belong to the dependent plan.

### 8. Generated plugin reader

The only permitted plugin byte change is regeneration of
`plugins/banzai/lib/artifact-readers.mjs` when a relocation changes its
generated bytes. The regenerated reader keeps every export, behavior and
contract unchanged, and its byte-parity check stays intact. The change falls
under the hook-runtime version rule, so the stage carries a release-train
version change made through the existing version procedure. That rule and
the parity check are never weakened or bypassed.

The dependent plan groups reader-affecting relocations to limit version
changes. In one such stage, it may make the reader's generated bytes
independent of source layout, provided exports and behavior stay unchanged.

### 9. Enforcement

Keep ADR-0029's exact per-module policy model. Classify every new or relocated
module exactly once and cite this decision as the authority for its edges. Do
not introduce directory wildcards or layer defaults.

Add one restriction class to the ESLint projection for modules classified as
domain modules: lint rejects their imports of effectful Node built-ins
(filesystem, child process, network, process and operating-system APIs),
random-value APIs and ambient clock reads. Deterministic hashing remains
permitted. The restriction adds no dependency and follows ADR-0029's
fail-closed and no-inline-disable rules.

### 10. Out of scope

This decision does not permit:

- a behavior, schema, contract identity or CLI change;
- a new dependency, package or DI container;
- a typed block-cause migration;
- numeric size or complexity thresholds;
- a plugin behavior, hook, skill or policy change, beyond the reader
  regeneration permitted in section 8.

Each of these needs its own decision where it is ADR-eligible.

## Consequences

Positive:

- Each capability has one findable owner aligned with its ADR; a change to the
  completion protocol or recovery no longer shares a file with every other
  capability.
- Eligibility and authority rules gain direct table-driven tests in the area
  where the most recent defects occurred.
- Phase continuation becomes one explicit, reviewable table instead of
  distributed tail calls.
- The dependency rule, including domain purity, fails at lint time.
- Smaller modules reduce the context a maintainer or coding agent must load to
  change one capability.

Negative:

- The import-boundary policy grows substantially, and every stage edits it.
- The manifest's flat-layout and test-mirroring conventions change, and
  documentation must track each stage.
- The committed bundle and source map change on every stage, adding review
  noise.
- A stage that relocates a module bundled into the generated plugin reader
  requires a release-train version change.
- Concurrent feature work in `workflow.ts` conflicts with extraction stages in
  flight.

Risks:

- Effect-order drift: splitting a method can reorder a state write, event
  append or read. Unchanged characterization evidence and an explicit
  state-and-event sequence comparison for the dispatcher stage constrain it.
- Handler-attribution drift at continuation sites, as described in section 6.
- The runner context could decay into a service locator; section 3 and review
  of each stage constrain it.
- Peer-slice cycles; exact edges and the acyclic rule surface them at lint
  time.

Follow-ups:

- The dependent plan inventories every continuation site with its enclosing
  handler, lock and observation scopes before the dispatcher stage.
- The strict-review continuation inside the verification error handler is
  assessed as a possible defect in a separate work item.
- Separate decisions may later consider typed block causes, numeric thresholds
  under ADR-0050, or validated layer defaults under ADR-0029's recorded
  follow-up.

## Compliance and Confirmation

Implementation and review must confirm all of the following, per stage where
applicable:

1. Existing test suites pass, with edits limited to the mechanical relocation
   updates permitted in section 7. No assertion is removed or weakened. Each
   updated test still targets the relocated production module. Fixture data
   that refers to no production module is unchanged.
2. `WorkflowRunner` public methods, the exported functions and types consumed
   by production modules, and existing constructor call forms are unchanged.
3. State, event, attempt, checkpoint and digest-evidence bytes are unchanged;
   no schema or contract identity changes; CLI output, exit codes, error codes
   and block-reason texts are unchanged.
4. Before and after the dispatcher stage, each continuation path produces an
   identical ordered sequence of state writes and events in characterization
   tests; every continuation site is inventoried with its enclosing handler,
   lock and observation scopes, and each is shown to be preserved.
5. Every new or relocated production module has exactly one import-boundary
   entry citing this ADR or a prior authority; lint rejects a domain module
   importing an infrastructure, application or interface module, and rejects a
   representative effectful built-in, random API and ambient clock read in a
   domain module; the assurance runs the loaded production ESLint
   configuration.
6. No capability slice imports the facade, a command or the dispatcher; the
   production module graph is acyclic; `reporting/` does not import
   `workflow/`.
7. The runner context contains only the listed collaborators; each piece of
   owned mutable state has one owning module; no slice receives the facade.
8. Extracted pure decisions have direct tests covering every branch of the code
   they replace; where the original read evidence conditionally, tests show
   that the paths which did not read it still do not.
9. At the end of the workflow migration, `WorkflowRunner` contains only public
   delegation; phase executors, eligibility rules and completion logic live in
   their slices.
10. `npm run verify` and `npm run release:check` pass at every stage. Generated
    outputs and the committed bundle are regenerated. References in build
    scripts, release scripts and `release-policy.json`, and pinned source and
    test text, follow moved files without weakening any check.
11. `MODULES.md` and manifest sections 3, 4 and 5 describe the current state
    after each stage; the manifest never describes an unimplemented target.
12. No runtime or development dependency is introduced, and no plugin
    behavior, hook, skill or policy changes. A regenerated
    `artifact-readers.mjs` keeps its exports and behavior. It matches a fresh
    generation byte for byte, and it ships with a release-train version change
    under the hook-runtime rule.

## Lifecycle Links

- Supersedes: None
- Amends: [ADR-0028](./0028-phase-context-accounting-and-budget-policy.md) by
  lifting the deferral of broad `WorkflowRunner` decomposition recorded in its
  risks and follow-ups; its context accounting and budget decisions are
  unchanged.
  [ADR-0029](./0029-eslint-backed-orchestrator-import-boundary-policy.md) by
  adding one restriction class for domain modules; its exact per-module model,
  authority citation and fail-closed coverage are unchanged.
- Superseded by: None
- Accepted on 2026-09-28 by the project owner's explicit decision after the
  first rework. This lifecycle record supersedes pending-acceptance statements
  in the retained body, and the decision body is immutable from acceptance.
- Reciprocal "Narrowly amended by ADR-0052" links are recorded in the lifecycle
  metadata of ADR-0028 and ADR-0029; both remain Accepted.
- Implementation state: `Planned`.
