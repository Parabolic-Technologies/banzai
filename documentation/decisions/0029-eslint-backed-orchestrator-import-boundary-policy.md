# ADR 0029: ESLint-Backed Orchestrator Import Boundary Policy

## Status / Date / Owner / Decision Makers

- Status: Accepted
- Date: 2026-08-23
- Owner: Banzai maintainers
- Decision makers: User, explicitly accepted in chat on 2026-08-23

## Related Artifacts

- Feature description:
  `documentation/features/mechanically-enforced-import-boundaries/description.md`
- Feature plan:
  `documentation/development-plans/mechanically-enforced-import-boundaries/plan.md`
  (created after acceptance)
- Manifest: sections 3, 8, and 10 of `PROJECT_MANIFEST.md`
- Related ADRs:
  - ADR-0010, Blocking and Advisory Release Evidence: owns the blocking local
    and supported-Node release evidence into which lint already composes.
  - ADR-0013, Risk-Driven Test Assurance: requires evidence at the cheapest
    layer that can falsify a material architectural guarantee.
  - ADR-0026, Derived Evaluation KPI Projection Contract: establishes the
    narrow KPI dependency boundary that currently lacks mechanical enforcement.
  - ADR-0028, Phase Context Accounting and Budget Policy: establishes narrow
    context-accounting and context-reporting boundaries and repeats the
    manifest's inward-only direction.

## Context and Decision Drivers

Current state: the root manifest specifies a strict outer-to-inner dependency
direction for the orchestrator and several accepted ADRs narrow individual
modules further. For example, the derived KPI module is deliberately isolated
from configuration, workflow, adapters, locks, and persistence. These rules are
architectural authority, but none is executable: the orchestrator ESLint
configuration contains no import restrictions, and release validation does not
inspect the TypeScript dependency graph.

The consequence is a blind spot across every existing mechanical gate. A used
or side-effect import from `evaluation-kpi.ts` to `config.ts` can receive green
typecheck, lint, tests, bundle smoke, and release validation. A reviewer must
remember the ADR, identify the edge visually, and spend full attention on a
question a deterministic source check can answer. AI increases both the rate at
which plausible imports can be introduced and the amount of otherwise valid
code competing for that attention.

The source tree is already suited to explicit enforcement: production modules
are local TypeScript files with NodeNext `.js` specifiers, the architecture is
documented at module granularity, and lint is already a blocking entry point.
The complication is completeness. Static import declarations are not the only
way to create a local dependency, runtime and type-only edges do not have the
same meaning, and a permissive default for a newly added module would preserve
the original blind spot.

Target state: one version-controlled executable projection classifies every
production module and separately permits its runtime and type-only local edges.
The ordinary lint command rejects unauthorized imports, re-exports, alternate
loading forms, and incomplete policy coverage. The manifest and accepted ADRs
remain the architectural authority; changing the projection is an explicit
reviewable decision, never an automatic response to generated code.

Decision question: What representation and enforcement point should own the
complete production import-boundary policy while providing immediate feedback,
failing closed on new modules and bypass syntax, and adding no dependency?

Decision owner: Banzai maintainers, with explicit user lifecycle approval.

Decision drivers:

- fail at the ordinary lint boundary before typecheck, tests, or review;
- classify every present and future production module exactly once;
- distinguish runtime permissions from type-only permissions;
- cover static imports, side-effect imports, re-exports, and alternate local
  loading syntax without a bypass;
- project the manifest and accepted ADRs rather than bless the observed graph;
- deterministic repository-relative diagnostics and no automatic fix;
- no runtime or development dependency, network call, or vendor process;
- reuse existing verify, release, and supported-Node command composition;
- keep policy reviewable at the current flat source-tree scale.

## Options Considered

### Option 1: Canonical module policy projected into built-in ESLint rules

Store one declarative module policy beside the orchestrator lint configuration.
It classifies every production source module exactly once, lists separate
allowed runtime and type-only local targets, and cites the manifest or accepted
ADR authority for narrower constraints. Load-time validation compares policy
keys with the production source set, so an unclassified new module and a stale
or duplicate entry fail lint even without an import edge. Generate per-module
built-in ESLint restrictions from the validated policy. Permit governed static
imports and re-exports; reject relative dynamic imports, inline TypeScript
import types, import-equals declarations, and local `require` forms in
production source so they cannot escape the same policy.

- Benefits: earliest existing feedback loop; no package dependency; one
  reviewable source of executable policy; runtime and type-only permissions can
  be kept distinct; `verify` and `release:check` inherit the result; fail-closed
  completeness does not depend on a module already containing imports.
- Costs: the policy has an entry for every production module and must be
  maintained when modules or legitimate edges change; current inline import
  types must be normalized into governed static type imports; generated rule
  diagnostics and pattern escaping need direct assurance.
- Risks: an overly broad permission could still encode a bad decision. Authority
  citations, exact-target permissions, mutation fixtures, and explicit review
  constrain that risk; the tool cannot replace architectural judgment.

### Option 2: Parse and validate imports only in `check-release.mjs`

Add a repository-owned source graph checker to the release script, using the
existing TypeScript parser or another already installed parser.

- Benefits: complete AST control; one place for cross-file release invariants;
  straightforward global graph checks and custom diagnostics; no new package is
  necessarily required.
- Costs and risks: violations appear late, outside the normal lint/editor loop;
  developers can receive green lint and tests until the full release gate;
  parsing and resolver behavior would become custom release-script logic; a
  second invocation would be needed if lint should also enforce the rule.
- Rejected as the primary enforcement point: it satisfies release protection
  but not the cheap feedback loop that motivates the change.

### Option 3: Add a third-party dependency-boundary ESLint plugin

Adopt a package such as a boundary- or import-graph plugin and express zones or
element types in its configuration.

- Benefits: dedicated diagnostics and established graph concepts; less custom
  rule generation; potential cycle and resolver features.
- Costs and risks: adds a development dependency and its update/security
  surface; plugin abstractions may not express exact module-level runtime versus
  type-only permissions or completeness without supplementary code; behavior
  can drift across ESLint and parser releases.
- Rejected for the current flat source tree: built-in ESLint capabilities plus
  a small policy projection meet the requirement with less ownership surface.

### Option 4: Enforce boundaries through package or TypeScript project splits

Move architectural layers into separate packages or composite TypeScript
projects and let package exports and project references constrain dependencies.

- Benefits: strong physical isolation; package tooling makes some dependency
  direction explicit; can scale if the orchestrator becomes several products.
- Costs and risks: broad, difficult-to-reverse restructuring; more manifests,
  builds, exports, and release surfaces; does not by itself encode narrow
  same-package module constraints such as the KPI allow-list; disproportionate
  to the current source tree.
- Rejected: the enforcement need is real, but it does not justify a packaging
  migration.

### Option 5: Preserve documentation and reviewer enforcement

Keep the manifest and ADRs as prose, perhaps adding a review checklist item.

- Benefits: no code or policy maintenance.
- Costs and risks: preserves the demonstrated green-gate failure; scales review
  attention instead of cheap verification; generated code can violate an
  invariant without any mechanical signal.
- Rejected: it is the state this decision is intended to correct.

## Decision

Adopt Option 1.

Create one canonical, declarative import-boundary policy for
`packages/orchestrator/src/**/*.ts` and consume it from the flat ESLint
configuration. The policy is an executable projection, not a new architectural
authority: the root manifest defines the general direction, accepted ADRs
define narrower module constraints, and each exceptional or narrowed
permission cites one of those sources.

Classify every production module exactly once. Validate the policy against the
actual production source set when ESLint loads, and fail before file linting if
a module is unclassified, multiply classified, or stale. Do not infer or add a
permission from the current import graph. Test and tool modules keep their
existing lint rules but remain outside the production layer map.

For each module, define exact repository-local target permissions separately
for runtime dependencies and type-only dependencies. A type-only permission
never implies runtime permission. Preserve the manifest guarantee that
`types.ts` has no runtime imports, while representing any approved type-only
edge explicitly. Resolve NodeNext `.js` specifiers to canonical production
module identities for policy comparison; use no absolute checkout path as
policy data.

Generate the enforcement from built-in ESLint rules. Static imports,
side-effect imports, and re-exports are the only permitted production forms for
local dependencies. Reject relative dynamic imports, inline TypeScript import
types, import-equals declarations, and local CommonJS `require` calls in
production source. Normalize current inline type references into top-level
static type imports during implementation so every retained local edge crosses
the same enforceable surface. Do not allow inline disables for the boundary
rules and do not provide auto-fixes that mutate imports or permissions.

Make `npm run lint` the canonical execution entry point. Existing command
composition makes the same verdict blocking in `npm run verify` and
`npm run release:check`; do not duplicate the graph policy in
`check-release.mjs`. Add assurance that loads and exercises the production
ESLint configuration itself, validates policy completeness and authority
metadata, and mutates representative allowed and forbidden forms so a parallel
test-only implementation cannot go green while lint is ineffective.

Keep diagnostics deterministic and repository-relative. A violation names the
importer, target, runtime or type-only kind, and governing boundary or
authority, but never source contents or an absolute path. Add no dependency,
runtime code path, public contract, network call, vendor process, credential,
or persisted-state change.

## Consequences

Positive:

- An outward or ADR-forbidden edge fails at lint time, before reviewer
  attention becomes the only control.
- Every new production module is fail-closed even if it initially contains no
  imports.
- Runtime and type-only coupling are visible and cannot authorize one another
  accidentally.
- One policy projects both general layering and narrow module isolation; verify
  and release checks inherit it without a second parser or rule source.
- The implementation uses the existing toolchain and adds no dependency or
  runtime surface.

Negative:

- Maintainers must update an explicit policy entry when adding, removing, or
  legitimately coupling production modules.
- Exact module permissions are more verbose than broad layer zones and can
  create friction during refactoring.
- Dynamic local loading and inline import-type conveniences are unavailable in
  production source unless a future accepted decision adds a governed form.
- ESLint configuration now carries architecture-significant behavior and needs
  direct tests rather than configuration-only review.

Risks and follow-ups:

- The initial policy could canonize an accidental current edge. The
  implementation plan must map every allowed edge to manifest direction or an
  accepted ADR and resolve unexplained edges instead of grandfathering them.
- A generator bug could reverse an allow-list or mishandle regexp characters.
  Tests must exercise the loaded ESLint configuration with actual allowed and
  forbidden `.js` specifiers, including used, side-effect, and type-only forms.
- The source graph can grow until exact module entries become costly. Measure
  policy churn; a future ADR may introduce validated layer defaults, but only
  if it preserves fail-closed module coverage and narrow exceptions.
- This decision prevents unauthorized direct edges; it does not prove that an
  authorized dependency exposes only the desired API. Contract design and
  review remain necessary.

## Compliance and Confirmation

Implementation and review must confirm all of the following:

1. the policy and production source set have an exact one-to-one module key
   match; added, removed, duplicate, and stale entries fail through
   `npm run lint`;
2. a used import and a side-effect import from `evaluation-kpi.ts` to
   `config.ts` fail with deterministic repository-relative diagnostics that
   identify the KPI boundary;
3. representative forbidden imports for context reporting, context accounting,
   prompt-envelope, output-contract, and the global inward direction fail;
4. `types.ts` rejects every runtime local import, while an explicitly approved
   static type-only edge passes and does not authorize the runtime form;
5. static import, side-effect import, re-export, dynamic import, inline
   TypeScript import type, import-equals, and local `require` fixtures prove
   there is no syntax bypass or ineffective unused-import-only check;
6. every initial allowed edge and every narrower permission is mapped to the
   root manifest or an accepted ADR; unexplained present edges are removed or
   brought back for an explicit architectural decision;
7. boundary rules cannot be bypassed by an inline disable, broad wildcard, or
   automatic permission generation from current imports;
8. assurance invokes the loaded production ESLint configuration and detects a
   deliberately weakened or removed rule;
9. identical source and policy bytes produce stable verdicts and diagnostics
   on every supported Node lane without network, vendor, credential, or
   environment-specific state;
10. no package dependency, runtime behavior, public CLI behavior, persisted
    schema, control/evaluation contract identity, or plugin behavior changes;
11. maintainer documentation explains module classification, authority
    citation, legitimate permission changes, type-only versus runtime edges,
    and diagnostic remediation;
12. focused policy assurance, `npm run lint`, `npm run verify`,
    `npm run release:check`, and supported-Node evidence are reported
    separately and truthfully.

## Lifecycle Links

- Supersedes: None
- Superseded by: None
