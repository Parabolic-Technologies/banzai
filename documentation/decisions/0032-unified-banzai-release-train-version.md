# ADR 0032: Unified Banzai Release-Train Version

## Status / Date / Owner / Decision Makers

- Status: Superseded
- Date: 2026-09-04
- Owner: Banzai maintainers
- Decision makers: User, explicitly accepted in chat on 2026-09-04
- Superseded: 2026-09-05 by explicitly accepted ADR-0033

## Related Artifacts

- Feature description:
  `documentation/features/unified-project-version/description.md`
- Escalation record:
  `documentation/features/unified-project-version/work.md`
- Feature plan:
  `documentation/development-plans/unified-project-version/plan.md`
- Repository authority: `AGENTS.md`
- Manifest: sections 1-4, 7, 9, and 10 of `PROJECT_MANIFEST.md`
- Release policy: `release-policy.json`
- Superseded decision: ADR-0012 defines the currently implemented independent
  product versioning and release policy.
- Related accepted decisions: ADR-0009, ADR-0010, and ADR-0011 continue to own
  runtime lanes, evidence classification, and live-vendor evidence.
- Related accepted decision: ADR-0018 requires explicit capability negotiation
  instead of inferring compatibility from an orchestrator package version.

## Context and Decision Drivers

The repository currently carries two product release versions. The plugin is
`1.18.1` in two host manifests and two marketplace descriptors. The private
orchestrator is `0.8.2` in its package manifest and lockfile workspace entry;
that value is also embedded into the committed CLI distribution and appears in
current documentation.

Those values identify two distinct releases. The plugin `1.18.1` release was
explicitly plugin-only and retained orchestrator `0.8.2`. Reusing `1.18.1` for
a later candidate whose orchestrator reports `1.18.1` would assign one release
identity to two different project states. The first unified release must
therefore use a new, previously unused version.

Accepted ADR-0012 deliberately made the versions independent. It treats all
four plugin values as co-authoritative consumer surfaces, the orchestrator
package as a separate authority, and the lockfile workspace value as the
orchestrator mirror. It explicitly rejects lockstep versioning because the two
products are independently usable and have supported separate release scopes.
The requested target consciously trades that component-level precision for one
project-level release identity.

The plugin and orchestrator remain independently usable and their delivery
actions can still differ. Equal source metadata does not prove which artifacts
a user installed. Their machine contracts also keep explicit versions of their
own. ADR-0018 already requires exact contract and operation negotiation rather
than treating the orchestrator package version as compatibility evidence.

Decision question: How must the plugin's established version line govern one
Banzai release-train identity, its persisted mirrors, release decisions,
delivery evidence, and migration from the current independent versions?

Decision owner: Banzai maintainers, with explicit user lifecycle approval.

Decision drivers:

- provide one memorable Banzai release identity across repository artifacts;
- continue the plugin's established `1.x` version line without reusing an
  existing release identifier;
- prevent future plugin/orchestrator source-version skew;
- distinguish release identity from component delivery and compatibility;
- keep every host and package consumer surface mechanically consistent;
- reduce error-prone manual edits without making validation mutating;
- retain explicit SemVer rationale and human release authorization;
- preserve separately versioned runtime contracts and compatibility checks;
- avoid a third root version and automatic version selection; and
- retain deterministic distribution, CI, installed-state, and rollback
  evidence.

## Options Considered

### Option 1: Adopt one plugin-led Banzai release-train version

Continue the plugin's version line as the only project release identity.
Require the four plugin consumer surfaces, orchestrator package, and lockfile
workspace entry to carry the same value. Make one SemVer decision for each
release train while retaining separate delivery evidence.

Benefits:

- one release identity covers the repository and both distributed parts;
- plugin and orchestrator source-version skew becomes invalid;
- the existing non-mutating validation model extends naturally to all six
  persisted values;
- a dedicated human-invoked synchronization operation can replace six manual
  edits without choosing a version automatically; and
- no new root version or release service is required.

Costs and risks:

- an unchanged component receives the common version when only the other
  component changes;
- the orchestrator jumps from its independent `0.8.2` line to the Banzai `1.x`
  train, so package SemVer no longer represents independent CLI maturity;
- matching source values cannot guarantee that separately installed artifacts
  match; and
- maintainers must evaluate SemVer impact across both components before a
  project bump.

### Option 2: Retain independent product versions

Keep ADR-0012 unchanged and continue to bump the plugin and orchestrator only
when each product is explicitly prepared for distribution.

Benefits:

- each version describes only the corresponding product change;
- unchanged products avoid metadata-only version movement; and
- the orchestrator can retain its independent pre-1.0 progression.

Rejection reason:

- it preserves the two-version coordination burden and skew that the requested
  project-level identity is intended to remove.

### Option 3: Add a root project version above both product versions

Add a new root release identity while preserving independent plugin and
orchestrator versions beneath it.

Benefits:

- one repository identifier can coexist with precise component histories; and
- individual component SemVer retains its current meaning.

Rejection reason:

- it creates three active values, additional synchronization policy, and more
  release decisions, while the requested direction is one plugin-led value.

### Option 4: Rewrite mirrors during build or release validation

Choose one plugin manifest as the physical source and let ordinary build or
validation commands rewrite the other plugin and orchestrator values.

Benefits:

- fewer explicit maintainer steps; and
- generated mirrors cannot remain stale after successful generation.

Rejection reason:

- npm requires persisted package metadata, consumer-facing plugin manifests
  still need parity, and a mutating check would conceal conflicts rather than
  fail for human review. Verification must remain deterministic and
  non-mutating.

## Decision

Adopt Option 1.

Define one **Banzai release-train version** as the only product release
identity in this repository. "One version" applies to product releases; it
does not replace the independent versions of machine contracts, schemas,
persisted state, evaluation formats, or diagnostic formats.

Continue the plugin's established `1.x` line as the release-train namespace.
Represent the logical release-train authority in these four mandatory plugin
consumer surfaces:

- `plugins/banzai/.claude-plugin/plugin.json`;
- `plugins/banzai/.codex-plugin/plugin.json`;
- `marketplace.json`; and
- `.agents/plugins/marketplace.json`.

All four values must exist, be semantic versions, and agree exactly. They form
one logical authority: no single host or marketplace file may silently win or
rewrite another on mismatch.

Treat `packages/orchestrator/package.json` and
`package-lock.json#/packages/packages~1orchestrator/version` as mandatory
mirrors of the release-train version, not independent version authorities.
Both must agree with every plugin surface. The committed orchestrator bundle
and source map remain delivery artifacts rather than additional authorities,
but runtime version output derived from the package must report the same
release-train value.

Use `1.19.0` as the first unified release-train version. This is a new minor
release after plugin `1.18.1`, so it does not reuse the identity of the existing
plugin-only `1.18.1` / orchestrator `0.8.2` state. The minor increment marks the
new project-level release identity and synchronization capability without
claiming a breaking installed-runtime or machine-contract change. The
migration updates all four plugin values from `1.18.1` to `1.19.0` and aligns
the orchestrator package and lockfile from `0.8.2` to `1.19.0`.

For every later release that ships a plugin change, an orchestrator change, or
both, make one explicit release-train version decision. Select patch, minor,
or major from the highest SemVer impact among all included plugin and
orchestrator changes. Every forward target must be strictly greater than the
current plugin release-train value under SemVer ordering. Repository-maintenance
work does not bump the version unless an explicit Banzai release is prepared.
Historical independent version records remain unchanged.

Provide a dedicated, human-invoked metadata operation with the maintainer
interface `npm run version:set -- <version>`. It accepts exactly one explicit
canonical SemVer core value selected and approved by the release owner: three
dot-separated decimal integers with no leading zero except the integer zero,
and no prerelease or build suffix. It derives no path, command, or JSON field
from that value and can mutate only the four fixed plugin version fields, the
orchestrator package version, and the exact orchestrator lockfile workspace
version. Any transaction working or recovery path must be derived solely from
those fixed repository-relative targets and constant internal names, never from
the version input; transaction artifacts are not release-version authorities.
Any retained unresolved-transaction state must be deterministically visible to
release validation in the same checkout.

The operation recognizes exactly two valid current-state classes:

1. initial migration: the four plugin values agree at `1.18.1`, the
   orchestrator package and lockfile agree at `0.8.2`, and the target is exactly
   `1.19.0`; or
2. unified forward update: all six current values agree and the target is
   strictly greater than that value under SemVer ordering.

Any other current state, malformed target, equal target, or lower target fails
before mutation. Rollback does not use this forward synchronization interface;
it restores a complete explicitly selected known-good candidate.

Before mutating, the operation prepares and validates every candidate document
and retains the exact original bytes and modes in recoverable transaction
state. A supported filesystem failure is any error reported to the process by
a filesystem operation used for preparation, replacement, syncing, or mode
preservation. For every such failure and every handled cancellation, `SIGINT`,
or `SIGTERM` after replacement begins, the operation restores all original
bytes and modes before exiting unsuccessfully. It never reports success until
it rereads all six documents, proves every target value, and confirms that
unrelated bytes and modes are unchanged. An uncatchable termination or a
failure while restoring cannot be claimed as atomic success: retained recovery
state and repository-relative diagnostics must identify every unresolved
target, and release validation must continue to block the repository until the
complete original or complete candidate state is restored.

The synchronization operation performs only its own target, current-state,
candidate-document, and final-state validation. It does not select a version,
invoke the full release-validation or release-check suite, rebuild, stage,
commit, push, tag, install, link, or publish. Ordinary build, test, CI, and
release-validation commands must never invoke it implicitly. Release validation
remains a separate read-only, fail-closed operation.

Keep delivery scope explicit even though version selection is unified. Every
candidate records whether plugin, orchestrator, both, or repository-maintenance
artifacts are intended for delivery, along with the observed installed or
published state of each applicable component. Matching repository metadata is
not evidence that a user has installed a matching pair, and an unavailable or
not-applicable delivery result must remain visible rather than being inferred
as success. Passing evidence never authorizes a delivery action.

Keep runtime and persistence compatibility identities independent from the
release-train version, including plugin contracts, phase-result schemas,
run-state schemas, agent-control contracts, evaluation exports, context
reports, and doctor reports. Consumers must continue to use their explicit
compatibility mechanisms rather than infer compatibility from `1.19.0`.

Treat the synchronization command as two Security Assurance exposures. Class 1
applies because a maintainer-supplied command argument reaches a filesystem
mutation boundary; strict parsing and fixed non-user-selectable metadata and
transaction targets enforce that boundary. Class 7 applies because the
operation overwrites tracked release metadata; preflight preparation,
recoverable transaction semantics, signal handling, restoration, and final
reread own that guarantee.

For rollback of the initial migration, restore the complete last known-good
pre-unification candidate, including its documented independent plugin and
orchestrator values. For any later unified release, restore one last known-good
release-train value across all six persisted surfaces before rebuilding and
revalidating the distribution. Rollback, like release, remains explicitly
human-authorized.

## Consequences

Positive:

- maintainers and users can identify a Banzai source release with one value;
- the unused `1.19.0` identity avoids colliding with the released `1.18.1`
  plugin-only state;
- release validation prevents future plugin/orchestrator source-version skew;
- one explicit synchronization operation reduces repetitive manual edits while
  preserving human version selection;
- release identity, delivery evidence, and contract compatibility have
  distinct meanings; and
- no root version, dependency, runtime contract, or publication mechanism is
  added.

Negative:

- component-specific package history becomes less expressive;
- plugin-only and orchestrator-only release trains move metadata for an
  unchanged component;
- the orchestrator's visible version jumps across major and minor numbers;
- all six release surfaces must change together for future bumps;
- the synchronization operation needs explicit recovery and interruption
  handling despite changing only metadata; and
- delivery evidence remains component-specific even though version metadata is
  unified.

Risks and required follow-ups:

- stale mirror: add mutation evidence for each orchestrator and plugin surface
  and one passing all-equal case;
- unsafe synchronization: test malformed, equal, and lower targets; both valid
  pre-state classes; every invalid drift class; fixed path scope; unrelated-byte
  and mode preservation; and absence of implicit invocation;
- partial mutation: inject failures after mutation begins and handled
  `SIGINT`/`SIGTERM`, proving exact restoration and non-success; keep an
  uncatchable termination or failed restoration fail-closed and diagnostically
  visible rather than claiming atomicity the platform cannot guarantee;
- misleading compatibility inference: keep explicit contract negotiation and
  document that the release-train value is not a machine-contract version;
- installed-state ambiguity: retain per-component delivery scope and observed
  install/publication evidence in the release checklist;
- incomplete documentation: update the release policy, checklist,
  contributing guide, package documentation, and current manifest facts;
- stale committed CLI: rebuild and byte-check the bundle and source map after
  aligning package metadata;
- historical ambiguity: preserve old ADR and release records unchanged while
  marking ADR-0012 superseded only after this ADR is accepted; and
- rollback skew: restore a complete known-good candidate, then rerun version
  parity and distribution checks before any renewed delivery.

## Compliance and Confirmation

Implementation and review must confirm:

1. all four plugin surfaces, the orchestrator package, and its lockfile entry
   report exactly `1.19.0` at migration completion;
2. no active release surface retains `1.18.1` or `0.8.2`, while historical
   release records remain unchanged;
3. each individual surface is protected by a failing drift or malformed-value
   test and an all-equal candidate passes;
4. release validation changes no tracked bytes or modes, never invokes the
   synchronization operation, and fails with a repository-relative diagnostic
   whenever fixed checkout-visible recovery state identifies an unresolved
   transaction, regardless of whether all six version values agree;
5. `npm run version:set -- <version>` accepts exactly one canonical SemVer core
   target and exactly the documented initial migration state or a six-way-equal
   forward state with a strictly greater target, and every other
   current/target state fails before mutation;
6. version input cannot select a metadata, working, or recovery path, command,
   or field, and successful synchronization changes exactly six version values
   while preserving every unrelated byte and mode;
7. injected preparation, replacement, syncing, and mode-preservation failures,
   cancellation, `SIGINT`, and `SIGTERM` after mutation begins restore the
   exact originals and exit unsuccessfully; retained recovery state makes an
   uncatchable or failed-restoration state detectable and fail-closed; success
   occurs only after a six-document final reread;
8. the synchronization operation performs bounded preflight/final validation
   but never invokes the full release gate or an unrelated/delivery action;
9. runtime help, interactive header, and capability output report the unified
   release-train version from package metadata;
10. release policy and current documentation define one Banzai release-train
    version, retain delivery scope, and remove the independent orchestrator
    version authority;
11. future guidance uses the highest SemVer impact across the complete plugin
    and orchestrator change set and requires every forward target to be strictly
    greater than the current release-train value;
12. installed or published component evidence is recorded independently and is
    not inferred from matching source values;
13. contract, schema, state, evaluation, context, and doctor versions remain
    unchanged;
14. the committed bundle and source map match a fresh build, with executable
    mode preserved;
15. no dependency, root version, automatic bump, commit, push, tag, install,
    link, publication, or hosted-setting change is introduced; and
16. ADR-0012 is marked superseded only after this proposal is explicitly
    accepted.

## Lifecycle Links

- Supersedes: ADR-0012
- Superseded by: [ADR-0033](./0033-root-package-version-authority.md)
