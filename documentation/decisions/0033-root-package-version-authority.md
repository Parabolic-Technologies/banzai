# ADR 0033: Root Package Version Authority

## Status / Date / Owner / Decision Makers

- Status: Accepted
- Date: 2026-09-05
- Owner: Banzai maintainers
- Decision makers: User, explicitly accepted in chat on 2026-09-05

## Related Artifacts

- Repository authority: [AGENTS.md](../../AGENTS.md)
- Current facts: sections 1-4, 7, 9, and 10 of
  [PROJECT_MANIFEST.md](../../PROJECT_MANIFEST.md)
- Current release policy: [release-policy.json](../../release-policy.json)
- Existing feature:
  [unified-project-version](../features/unified-project-version/description.md)
- Existing plan:
  [unified-project-version](../development-plans/unified-project-version/plan.md)
- Existing recovery and smoke findings:
  [review-7.md](../features/unified-project-version/review-7.md) and
  [fix evidence](../changes/unified-project-version-review-7-fixes.md)
- Decision proposed for replacement:
  [ADR-0032](./0032-unified-banzai-release-train-version.md)
- Related accepted decisions: ADR-0009 through ADR-0011 retain release-evidence
  ownership; ADR-0018 retains explicit runtime compatibility negotiation;
  ADR-0027 retains exposure-driven security assurance.

This is a standalone architecture proposal requested after validation of root
package ownership. The existing approved feature and plan describe six version
fields and do not authorize the expanded target below. They remain historical
inputs; implementation requires reconciled requirements and an approved plan.

## Context and Decision Drivers

The current working tree implements ADR-0032: four plugin version fields form
one logical authority, with the orchestrator package and its lockfile workspace
entry as mirrors. All six values are `1.19.0`. The private root `package.json`
has no version; the lockfile also lacks a top-level version and a root-package
version. Release validation expressly rejects a root package version.

The requested target makes the root `package.json.version` the primary place
to identify the current project version. It retains one common release identity
and changes its physical authority. ADR-0032 explicitly excludes that root
field, so this requires a replacement decision.

Validation before this proposal established:

- npm lockfile v3 represents root version metadata in both top-level `version`
  and `packages[""].version`. The
  [official npm lockfile documentation](https://docs.npmjs.com/cli/v11/configuring-npm/package-lock-json/)
  describes the root entry and package version metadata.
- A dependency-free, offline npm 11.3.0 workspace experiment generated both root
  lockfile fields from root `package.json.version`. Changing only the root from
  `1.19.0` to `1.19.1` and regenerating the lockfile left the workspace version
  at `1.19.0`. npm does not provide the required project-wide synchronization.
- The existing synchronization and recovery representation assumes one version
  pointer per physical file. Three lockfile pointers therefore require one
  coordinated candidate document, not three independent file replacements.
- The bundled CLI derives its version from its own package metadata. Retaining
  that validated mirror allows standalone distribution without the repository
  root at runtime.

Decision question: Which persisted field owns the Banzai release identity, and
what consistency and recovery guarantees must its mirrors retain?

Drivers are clear ownership, deterministic validation, npm metadata consistency,
standalone CLI use, bounded mutation, preservation of post-interruption edits,
and continuity of release identity and recovery evidence.

## Options Considered

### Option 1: Make root package version the sole authority

Persist the project version at root `package.json.version` and require all
consumer and lockfile copies to match it.

Benefits: an explicit conventional entry point, unambiguous drift diagnostics,
and one release decision across the repository. Costs: three additional fields,
one additional physical target file, migration of policy and transaction
handling, and continued explicit synchronization of consumer metadata.

Selected because it satisfies the requested ownership while retaining the
existing release and recovery boundaries.

### Option 2: Retain the four plugin fields as the logical authority

Benefits: no authority migration or transaction-format expansion. Cost: the
current version remains distributed across four consumer descriptors.

Rejected because it does not give root `package.json` the requested ownership.

### Option 3: Generate all consumer metadata implicitly from the root

Benefits: one manually maintained value and fewer explicit synchronization
steps. Costs and risks: ordinary build or validation would rewrite tracked
metadata, conceal drift, and couple verification to mutation and recovery.

Rejected because release checks must remain read-only and synchronization must
remain an explicitly invoked, bounded operation.

## Decision

Adopt Option 1. Use root `package.json.version` as the **sole persisted authority
for the Banzai release-train version**. Retain the common `1.x` release line
established by ADR-0032 and the root package's private workspace role.

Require exactly these nine fields across seven physical files:

| File                                        | JSON pointer                               | Role                         |
| ------------------------------------------- | ------------------------------------------ | ---------------------------- |
| `package.json`                              | `/version`                                 | Sole authority               |
| `plugins/banzai/.claude-plugin/plugin.json` | `/version`                                 | Consumer mirror              |
| `plugins/banzai/.codex-plugin/plugin.json`  | `/version`                                 | Consumer mirror              |
| `marketplace.json`                          | `/plugins/0/version`                       | Consumer mirror              |
| `.agents/plugins/marketplace.json`          | `/plugins/0/version`                       | Consumer mirror              |
| `packages/orchestrator/package.json`        | `/version`                                 | Package and runtime mirror   |
| `package-lock.json`                         | `/version`                                 | Root lockfile mirror         |
| `package-lock.json`                         | `/packages//version`                       | Root package lockfile mirror |
| `package-lock.json`                         | `/packages/packages~1orchestrator/version` | Workspace lockfile mirror    |

The empty pointer segment in `/packages//version` identifies `packages[""]`.
Keep `.claude-plugin/marketplace.json` versionless. Do not add other version
authorities or change dependency versions.

Require all nine values to exist, be canonical SemVer core values, and agree
exactly. Use the root to establish the expected value; a missing or malformed
root is invalid even if every mirror agrees. Reject mirror drift rather than
selecting a majority value or repairing metadata during validation.

Retain `npm run version:set -- <version>` as the explicit synchronization
interface. Accept exactly one canonical core value: three decimal integers
without leading zeros except zero itself, prerelease suffixes, or build
metadata. For normal updates, require a valid nine-way-equal current state and
a target strictly greater than the root version. The command updates the
authority and all mirrors together; manually editing the root first does not
make a drifted pre-state valid.

Provide one explicit bootstrap transition from the existing six-way-equal
`1.19.0` state, with all three new fields absent, to the nine-way-equal
`1.19.0` state. This changes metadata ownership without assigning a new release
identity or asserting that the working-tree candidate has been published.
Reject every other partial bootstrap or drifted state before mutation, apart
from restoration through authenticated recovery evidence. Do not retain the
older independent-version migration as an ordinary forward-update pre-state;
preserve its history and supported recovery evidence.

Treat each physical file as one recoverable mutation unit. Prepare all edits
to the lockfile as one candidate with one original snapshot. Preserve unrelated
bytes and file modes. Bootstrap rollback must restore the exact versionless
root and lockfile originals, including absence of the new fields.

Retain preparation, final reread, failure restoration, handled cancellation,
and signal guarantees from the existing transaction boundary. Do not claim
atomic success after an uncatchable termination or failed restoration. Keep
unresolved transaction evidence visible and release validation blocked.

Preserve recognition and explicit recovery of valid prior six-file journal and
cleanup-guard evidence, including transactions prepared by the previous
independent-version migration. Interpret each supported format according to
its original fixed targets; never reinterpret old snapshots as new targets,
silently discard evidence, or start bootstrap over an unresolved transaction.
Reject unknown or malformed formats without mutation.

Before explicit recovery writes anything, validate every target against its
authenticated original or candidate bytes and expected mode. Refuse restoration
if any target contains a later edit, unexpected mode, or unsafe filesystem
state. Preserve all targets and recovery evidence on that refusal. This applies
to both old and new supported journal and cleanup-guard formats.

Keep mutation paths and JSON fields fixed and independent of the supplied
version. Retain Security Assurance Class 1 for input reaching a filesystem
boundary and Class 7 for overwriting tracked metadata. Expand their assurance
scope to the root package and all lockfile version fields.

Keep release validation read-only and fail-closed. Build, tests, CI, and release
checks must never invoke synchronization or recovery implicitly. The version
command performs bounded transaction validation without invoking the full
release gate, rebuilding, staging, committing, pushing, tagging, installing,
linking, or publishing.

Keep the CLI version derived from its own package mirror and embedded in the
distribution. Validate that source and distribution report the root-authorized
release value without requiring root package access at runtime. Derive smoke
expectations from the candidate metadata so future versions remain testable.

Retain the highest SemVer impact across included plugin and orchestrator
changes as the basis for each explicitly selected release. Repository
maintenance alone does not require a bump. Keep delivery scope and observed
installation/publication evidence separate for each component; passing checks
and matching metadata authorize no delivery action. Keep machine-contract,
schema, state, evaluation, and diagnostic versions independent.

Keep rollback explicitly authorized and based on a complete known-good
candidate. Historical candidates retain their original version-authority
format. Root-authoritative candidates restore all nine fields consistently,
then rebuild and revalidate before renewed delivery.

## Consequences

Positive:

- The current project version has one obvious, machine-readable owner.
- Host descriptors and standalone CLI metadata remain directly consumable.
- Validation detects stale copies without hiding inconsistent edits.
- The existing `1.19.0` candidate can adopt ownership without an artificial bump.

Negative and required follow-ups:

- Nine fields still need coordinated updates; adding the root does not make
  npm a synchronizer for plugin or workspace versions.
- Grouped document mutation and multiple recovery formats increase assurance
  work. Exact restoration must cover new-field absence as well as replacement.
- Approved requirements and a plan must reconcile the six-field current state
  with this target before implementation. Policy, validation, synchronization,
  recovery, tests, release guidance, and manifest facts need coordinated work.
- Historical ADRs and reports must remain intact; mark ADR-0032 superseded only
  after this proposal is explicitly accepted.

## Compliance and Confirmation

Implementation and review must establish:

1. The explicit bootstrap yields nine `1.19.0` values in seven files while
   preserving unrelated bytes, modes, dependencies, and contract identities.
2. Missing or malformed root metadata and each individually drifted mirror
   fail read-only validation; an all-equal candidate passes.
3. A future explicit forward target updates all nine values, while equal,
   lower, malformed, and invalid-pre-state requests fail before mutation.
4. The three lockfile fields survive one coordinated document update. A
   dependency-free offline npm fixture confirms the root/workspace lockfile
   relationships without changing repository dependencies.
5. Faults and handled signals restore exact originals, including absent root
   fields during bootstrap. Success requires a final reread of all seven files.
6. Old and new supported journal and guard recovery succeed for authenticated
   original/candidate states, block new transactions while unresolved, and
   preserve every target and recovery byte when later edits or modes conflict.
7. A real next-version build and standalone committed-bundle smoke succeed;
   runtime version mismatches still fail independently of contract checks.
8. Existing security, recovery, non-mutation, and release-gate regressions pass.
   Validation and build never synchronize or recover implicitly, and no delivery
   action is added.
9. Current documentation and policy name the root as the only authority after
   implementation; historical releases, approved artifacts, and predecessor ADR
   bodies retain their original facts.

## Lifecycle Links

- Supersedes: [ADR-0032](./0032-unified-banzai-release-train-version.md),
  effective 2026-09-05 after explicit user acceptance.
- Superseded by: None
