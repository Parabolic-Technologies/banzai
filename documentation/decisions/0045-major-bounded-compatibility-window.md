# ADR 0045: Major-Bounded Compatibility Window

## Status / Date / Owner / Decision Makers

- Status: Accepted
- Date: 2026-09-12
- Owner: Banzai maintainers
- Decision makers: Project owner; explicitly accepted in chat on 2026-09-12.

## Related Artifacts

- Request: standalone owner request in chat on 2026-09-12 to stop supporting
  earlier contract versions and other legacy resources, remove existing
  migrations, and clean code and documentation. No feature work item exists
  yet; the first application is planned as strict work under this ADR.
- Authority: root `AGENTS.md`; `PROJECT_MANIFEST.md` sections 2 (release-train
  version), 3 (contract boundaries), 5, 6 and 10; `release-policy.json`;
  `packages/orchestrator/scripts/check-release.mjs`;
  `documentation/release-checklist.md`; `plugins/banzai/contracts/README.md`.
- Related ADRs: [0003](./0003-versioned-evaluation-export-contract.md),
  [0006](./0006-versioned-verification-profiles.md),
  [0017](./0017-versioned-plan-task-completion-ledger.md),
  [0018](./0018-agent-supervised-banzai-cli-control.md),
  [0033](./0033-root-package-version-authority.md),
  [0036](./0036-vendor-neutral-policy-files-and-instruction-delivery.md),
  [0037](./0037-unified-runner-rendered-review-artifacts.md),
  [0041](./0041-artifact-retention-and-publication-boundary.md),
  [0043](./0043-proportionate-verification-evidence.md),
  [0044](./0044-instruction-baseline-evolution.md).

## Context and Decision Drivers

### Current state

Banzai versions its machine-readable resources with document identifiers such
as `banzai-review-snapshot/v3` and numeric `schemaVersion` fields. The
inventory taken on 2026-09-12 at release-train version `2.5.0` shows 34
document families in production code. Eight of them accept more than one
version, and several other resources carry version branches without a
document identifier:

| Resource | Versions accepted | Emitted today |
| --- | --- | --- |
| Run state `state.json` | 1, 2, 3, 4, 5 (`store.ts:normalizeRunState`) | 4, or 5 when config 3 carries a verification policy |
| Orchestrator config | 1, 2, 3 (`validation.ts:parseConfig`) | 2 by default, 3 explicitly |
| Phase result | v1, v2, v3 | v3 |
| Review result | v1, v2 | v2 orchestrated; v1 standalone Markdown |
| Review snapshot | v1, v2, v3 | v3 for state 5, v2 when bound, else v1 |
| Rendered review artifact | v1, v2, v3, v4 | v4, v3 or v2 by snapshot version; v1 standalone |
| Work binding | v1, v2 | v1 for state 4, v2 for state 5 |
| Artifact request | v1, v2 | v1 for all operations, v2 for `create` only |
| Agent control | capabilities v1/v3, status v1/v2, answer v1/v2 | v3, v2, v2; v1 answer still accepted |
| Evaluation export and KPI | v1, v2 | v1 by default, v2 opt-in |
| Model attempt record | 1, 2 | 2 |
| Verification ledger | 1, 2 | 2 |
| Version transaction | format 1 (six files), format 2 (seven files) | 2 |
| Instruction layout | `target`, `legacy`, `partial`, `unadopted` | `target`; `legacy` pinned to release `1.21.0` |
| Artifact storage layout | `private`, `legacy` (`documentation/` roles) | `private` |

Every accepted older version is read-only tolerance. No code upgrades a
persisted document in place; each branch either normalizes on read or fails
with a manual-migration message. The compatibility surface is spread across
`packages/orchestrator/src` (roughly 1.6 to 1.9 thousand lines),
`plugins/banzai/lib` (about 950 lines, near 14 percent of the libraries),
tests and fixtures (2 to 3 thousand lines, including six
`["legacy", "private"]` layout loops and nine instruction-layout fixtures) and
documentation (about 2 thousand lines, with the layout-migration procedure
restated in nine places).

Release machinery currently protects the presence of legacy surfaces rather
than bounding them: `release-policy.json` lists `contracts.*.legacy` entries
with byte pins, `check-release.mjs` fails on `LEGACY_CONTRACT_DRIFT` and
requires a `Last legacy-compatible release` line, and the release checklist
carries one-time blocks for the ADR-0036 migration, the `1.19.0` bootstrap and
the `1.18.1` plus `0.8.2` rollback. The policy file also drifts from runtime:
it declares run-state `currentSchemaVersion: 4` while ADR-0043 runs write 5.
Documentation disagrees with itself about the current rendered review format
(v2 in the contracts README, v3 in the packaged `AGENTS.md`, v4 in the CLI
reference).

Accepted ADRs commit to retention without bounding it in time: ADR-0006 keeps a
schema-1 config decoder, ADR-0017 keeps v1 attempts readable as legacy evidence,
ADR-0037 keeps historical v1 review rules, ADR-0041 keeps the legacy artifact
layout until explicit migration, ADR-0043 keeps config v1 and v2 readers, and
ADR-0036 keeps the legacy instruction-layout stop with the `1.21.0` pin. The
contracts README states the only written rule: schema changes are
backward-compatible within a contract directory and breaking changes need a new
directory plus an orchestrator compatibility update.

### Product context

The product is used by a small group of engineers inside one company. The CLI
is published on npm (`2.2.0` to `2.2.2` recorded in the delivery record; later
versions tagged) and the source repository has a public identity. No external
consumer of persisted runs, configs or exports is known. This makes the first
application cheap, but the policy below must hold regardless of audience.

### Decision question

How long does Banzai keep readers, producers, schemas, fixtures, migration
guidance and documentation for a superseded version of a versioned resource,
and what happens to them at a release boundary? Owner: project owner.

### Drivers

- Bounded maintenance cost and a predictable meaning for a major release.
- Fail-closed handling of unsupported persisted evidence (EQ-05); no silent
  reinterpretation and no fabricated upgrades.
- One declared source of supported versions consumed by the release validator
  instead of pins that protect legacy bytes.
- Immutability of accepted ADR bodies; only lifecycle metadata changes.
- Bounded change scope for the first application (EQ-07) with explicit
  compatibility consequences (EQ-09).
- Independence from vendor behavior and from private history access.

## Options Considered

| Option | Benefits | Costs, risks and disposition |
| --- | --- | --- |
| Indefinite retention, decided per ADR (status quo) | Nothing persisted ever becomes unreadable | Unbounded growth; version lists duplicated in four files; nine restatements of one migration; drift between policy file, runtime and docs already visible. Rejected. |
| Exactly one version at all times; remove readers on every schema change | Smallest code | Any minor release can strand in-flight runs; contradicts SemVer expectations and the ADR-0018 negotiation model; forces frequent majors. Rejected. |
| Compatibility window bounded by the release-train major | Predictable boundary aligned with SemVer; additive evolution stays possible within a major; removal is a planned, reviewable event | Every major strands evidence of the previous major and needs an operator procedure; requires a declared supported set and validator changes. Proposed choice. |
| Sliding window of N releases or a time window | Smoother than a hard major boundary | Boundary unrelated to the version signal users see; more bookkeeping; hard to state in release notes. Rejected. |

## Decision

### 1. The window is one release-train major

Bound compatibility of every versioned resource to the release-train major
line owned by root `package.json.version` (ADR-0033). Within one major, a
resource may gain a new version only additively: the producer emits the newest
version, every version introduced under the same major stays readable, and
migrations stay manual or absent as today. Never add in-place upgrade code.

### 2. A major release keeps exactly one version per family

At a major boundary `X.0.0`, support exactly one version of each versioned
resource family: the version the last `X-1` release emitted by default, unless
the release plan selects a newer one and states why. Remove, in the same major
release, every reader, decoder, normalizer, schema file, fixture, test branch,
release-policy entry, checklist item, migration guide and documentation
section that exists only for versions outside the window. Keep existing
version numbers; do not renumber identifiers.

### 3. Unsupported evidence fails closed

Reject persisted state, sidecars, bindings, requests, configs, snapshots,
exports and control documents whose version lies outside the window with a
stable error that names the resource, the version found, the supported
version, and the last release-train major that read it. Do not normalize,
infer, downgrade or repair. Read-only tools report the same classification
without mutating anything.

### 4. Scope of "versioned resource"

In scope: persisted run state and sidecars; model hand-off contracts under
`plugins/banzai/contracts/`; plugin helper request, result, binding, layout and
archive documents; verification evidence, ledgers and attempt records; review
snapshots and rendered review artifacts; agent-control documents; evaluation
export, KPI, context, cancellation and human-time documents; orchestrator
config; version-transaction formats; instruction-layout recognition classes;
artifact storage layouts; and the guidance, skills, checklists and reference
documents that describe any of them.

Out of scope, retained under their own rules: model catalog standings
(`superseded`, `deprecated`, `retired` models are product facts); Node forward
lanes and live vendor compatibility (ADR-0009, ADR-0011); the decision log with
all lifecycle states; release notes and the delivery record of earlier majors;
evidence roots pinned byte-for-byte by an accepted ADR (the ADR-0042 extraction
root under ADR-0044) until that ADR is superseded; and Engineering Quality
EQ-09 and EQ-10, which govern end-user projects, not this policy.

### 5. One declaration, checked at release

Make `release-policy.json` the single declaration of the supported version set:
for each family, the current major and exactly the versions supported within
it. The release validator fails a candidate when a shipped contract schema file
is not declared, when a major target declares more than one version for any
family, or when documentation still names a removed version as supported.
Replace the `Last legacy-compatible release` rule and the `LEGACY_CONTRACT_DRIFT`
byte pins with checks derived from this declaration.

### 6. Major release notes and checklist

Require every `X.0.0` release note to carry a `Removed compatibility` section
listing the removed families and versions and the operator actions. Replace the
one-time blocks in `documentation/release-checklist.md` with one generic
major-boundary block: confirm the declaration, confirm removal, confirm the
release note, and confirm the rollback target is the last release of the
previous major.

### 7. First application: 3.0.0

Apply the policy for the first time in `3.0.0`, removing every version that
`2.5.0` does not emit by default and collapsing each family to one version:

| Family | Supported in 3.x | Removed |
| --- | --- | --- |
| Run state | 5 | 1, 2, 3, 4 and `normalizeRunState` branches |
| Orchestrator config | 3 | 1, 2 |
| Work binding | v2 | v1 |
| Artifact request | v2 for every operation | v1 |
| Artifact storage layout | `private` | `legacy`, `documentation/` role paths, unbound legacy work registration |
| Phase result | v3 | v1, v2 schemas and readers |
| Orchestrated review result | v2 | v1 ingress and checkpoint dispatch |
| Review snapshot | v3 | v1, v2 |
| Runner-rendered review artifact | v4 | v1, v2, v3 rendering and prose validator |
| Standalone review artifact | pending owner decision CC-01 | see Consequences |
| Agent control | capabilities v3, status v2, answer v2, request v1, recovery v1 | capabilities v1, status v1, answer v1 |
| Evaluation export and KPI | v2 | v1 and the `legacy_absent` evidence taxonomy |
| Model attempt record | 2 | 1 |
| Verification ledger and path | 2 with durable attempts | 1 and `executeLegacyVerification` |
| Version transaction | format 2 | format 1, `1.19.0` bootstrap, `1.18.1` plus `0.8.2` rollback |
| Instruction layout | `target`, `partial`, `unadopted` | `legacy`, the `1.21.0` pin, the layout-migration procedure |

Run state 5 currently requires config 3 with a verification policy. The plan
must define how a config without a policy maps onto state 5, for example by
making the policy optional within schema 3, without reintroducing state 4.

## Consequences

### Positive

- Maintenance cost is bounded and the meaning of a major release is explicit.
- The first application removes roughly 5 to 7 thousand lines of compatibility
  code, tests, fixtures and documentation, and collapses duplicated version
  lists in `store.ts`, `artifact-storage.mjs`, `artifact-archive.mjs`,
  `artifact-readers.mjs` and `spec-gate.cjs` into one.
- One declaration replaces byte pins that protected legacy files, and the
  validator can detect drift like the current state-version mismatch.
- Documentation describes one supported shape per family.

### Negative

- Every major strands persisted runs, configs, bindings and exports of the
  previous major. Operators must finish or cancel active runs, delete
  `.banzai/runs/`, regenerate `.banzai/config.json`, and re-run project
  adoption checks before upgrading. Evaluation exports must be produced before
  the upgrade if cross-major history is wanted.
- Archive bundles restore bytes unchanged, but evidence inside them from an
  earlier major is unreadable by the new major.
- Accepted ADR bodies keep describing removed versions. Readers must consult
  the lifecycle links and the release note to learn what still applies.
- Repository-local `.banzai/config.json` (schema 2) and the five local work
  items must be revisited before `3.0.0` work starts.

### Risks and mitigations

- Cleanup slices can break `release:check` mid-way. Update the declaration and
  validator first, then remove surfaces family by family with a green
  `npm run verify` after each slice.
- Editing policy prose changes the ADR-0044 instruction baseline digest. Use
  the documented rebaseline procedure; never move the original extraction root.
- A single-version family could be removed by mistake. The declaration lists
  every family, including single-version ones, and the validator rejects a
  shipped schema that is not declared.
- Standalone and orchestrated review artifacts share the `banzai-feature-review`
  identifier but have different producers. The owner decision CC-01 selects
  either unification on v4 or a separately named standalone format. Until it is
  recorded, standalone v1 is not removed.

### Required follow-ups

- Strict feature work for `3.0.0` under this ADR: description, plan and
  implementation, with `PROJECT_MANIFEST.md`, `packages/orchestrator/MODULES.md`,
  `documentation/orchestrator.md`, `plugins/banzai/contracts/README.md`, the
  skills and the packaged `AGENTS.md` rewritten in the same work.
- Lifecycle notes on ADR-0003, 0006, 0017, 0018, 0036, 0037, 0041 and 0043
  recording that their retention clauses are bounded by this window. Bodies
  stay unchanged.
- `release-policy.json` declaration, `check-release.mjs` checks, release
  checklist block and the `3.0.0` release note.
- Decide separately whether the `transition` publication mode of ADR-0041 still
  has a retained exception; if not, remove it with an ADR-0041 lifecycle note.

## Compliance and Confirmation

- `release-policy.json` declares the current major and exactly one supported
  version per family for a major target; the validator fails on an undeclared
  shipped schema, on more than one version per family at a major target, and on
  documentation naming a removed version as supported.
- For each family, one test feeds a document of a removed version and asserts
  the stable rejection with resource, found version, supported version and last
  reading major; no test asserts normalization of a removed version.
- Production code, plugin libraries and the hook contain no readers, branches,
  identifiers or diagnostics for removed versions; the only retained
  `superseded` and `deprecated` vocabulary belongs to the model catalog and the
  decision lifecycle.
- The test tree contains no fixtures or parameterized loops for removed
  layouts or versions.
- Documentation names one supported version per family; the layout-migration
  reference and the artifact-policy migration roadmap no longer exist; the
  release checklist carries the generic major-boundary block; the `3.0.0`
  release note carries `Removed compatibility`.
- Review confirms that accepted ADR bodies are byte-identical and that only
  lifecycle links were appended.

## Lifecycle Links

- Supersedes: None in full.
- Amends the retention clauses of ADR-0003, ADR-0006, ADR-0017, ADR-0018,
  ADR-0036, ADR-0037, ADR-0041 and ADR-0043: versions they preserve remain
  readable only within the release-train major that introduced them. Their
  semantics within the window are unchanged.
- Superseded by: None.
- Accepted on 2026-09-12 for further planning. The proposal had SHA-256
  `1f643c561bc72244729a26823208dd5e501100b8f2a5e0e6705c7d53fd5e519a` before this lifecycle update.
  This record supersedes proposal-stage pending-decision wording; the decision
  body is preserved. Implementation state: Planned. Owner consultation cards
  CC-01 and CC-02 were not answered at acceptance and are carried into the
  strict description as open questions.
