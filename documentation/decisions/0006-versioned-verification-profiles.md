# ADR 0006: Versioned Verification Profiles

## Status / Date / Owner / Decision Makers

- Status: Accepted
- Date: 2026-08-04
- Owner: Banzai maintainers
- Decision makers: User, explicitly accepted in chat on 2026-08-04

## Related Artifacts

- Feature description:
  `documentation/features/project-verification-readiness/description.md`
- Feature plan:
  `documentation/development-plans/project-verification-readiness/plan.md`
  (created after acceptance and required to conform to this decision)
- Manifest: sections 3, 5, 6, 9, and 10 of `PROJECT_MANIFEST.md`
- Existing runner requirements:
  `documentation/features/cross-vendor-workflow-runner/work.md`
- Related ADRs: ADR-0001, Automatic Workflow Selection; ADR-0002, Session
  Affinity and Bounded Reviewer Continuity.

## Context and Decision Drivers

The tracked target-project config currently requires `schemaVersion: 1`, keeps
the model-result `contractVersion`, and stores deterministic verification as one
flat, non-empty `VerificationCommand[]`. Documentation calls that array a
profile, but no persisted profile identity or project-type association exists.
The default contains only `git diff --check`.

The target needs profiles that are explicit enough for deterministic readiness
analysis and polyglot checkouts without changing command execution from direct
executable plus argv. Existing tracked schema-version-1 files must remain
readable and must not be silently rewritten by a read-only command. Profile
metadata must not enter plan or workflow authorization digests, change model
handoff contracts, or require a run-state schema migration.

Decision drivers:

- make the tracked configuration's new shape explicit and versioned;
- associate commands with a declared project type without parsing command
  prose;
- preserve deterministic profile and command ordering;
- keep existing direct no-shell execution, timeout, redaction, and failure
  behavior;
- provide a bounded compatibility path for existing schema-version-1 config;
- avoid automatic migration, new dependencies, and plugin-version changes;
- keep `contractVersion`, run state, evaluation export, and hook authorization
  contracts independent.

## Options Considered

### Option 1: Add optional metadata while retaining schema version 1

Allow `verification` to remain either the flat command array or a profile
object without changing `schemaVersion`.

Benefits:

- smallest edit to existing configuration;
- old config continues to load unchanged.

Costs and rejection reason:

- one schema version would identify incompatible shapes;
- tools could not know whether absence means legacy or malformed current data;
- migration and readiness output would be ambiguous;
- future config changes would repeat the same ambiguity. Rejected because the
  tracked public contract must identify its shape exactly.

### Option 2: Replace the flat array with one named profile

Use schema version 2 with one profile carrying an ID, one project type, and the
ordered commands.

Benefits:

- simple representation for single-stack repositories;
- explicit identity and project type.

Costs and rejection reason:

- a polyglot checkout cannot express independent Node and PHP coverage without
  inventing a mixed type;
- repository-wide hygiene either falsely satisfies a project type or must be
  duplicated;
- adding multiple profiles later would require another shape migration.
  Rejected because multiple root project markers are a required readiness case.

### Option 3: Use schema version 2 with an ordered profile list and a legacy reader

Replace the flat array with `verification.profiles`. Each profile contains a
unique kebab-case `id`, one `projectType`, and a non-empty ordered `commands`
array of the existing `VerificationCommand` shape. Reserve `repository` for
checkout-wide hygiene and `custom` for unrecognized project types. Execute by
profile order and then command order.

Accept schema version 1 only through a compatibility decoder that presents its
flat commands to the runner in their original order. Preserve its on-disk shape
during model-only edits. New initialization writes schema version 2. Migration
is manual and documented; neither loading nor doctor rewrites a config.

Benefits:

- explicit version and deterministic semantics;
- independently covers polyglot roots and repository hygiene;
- keeps `VerificationCommand` and process execution stable;
- old runs can still execute their existing tracked config while engineers
  migrate deliberately;
- profile metadata need not change run-state or model-result schemas.

Costs and risks:

- validation and runner composition must support two config versions;
- schema-version-1 files cannot prove project-type coverage and therefore do
  not pass doctor readiness;
- new projects still need an engineer to replace hygiene-only defaults with
  substantive commands;
- manual migration creates documentation and support burden.

### Option 4: Require schema version 2 immediately and reject all version-1 config

Remove version-1 parsing from every runner command.

Benefits:

- one runtime shape and the strongest immediate enforcement;
- no compatibility decoder.

Costs and rejection reason:

- every existing downstream checkout breaks on upgrade before it can run or
  use the model picker;
- a read-only diagnostic could explain the break but not remediate it;
- it turns a readiness feature into an unrequested fleet-wide migration gate.
  Rejected because compatibility can be retained without claiming legacy
  evidence is ready.

## Decision

Adopt Option 3.

Define target-project config schema version 2. Replace the flat
`verification` array with an object whose `profiles` field is an ordered,
non-empty list. Every profile has a unique kebab-case `id`, a `projectType`
from the readiness taxonomy, and a non-empty ordered `commands` list. Keep each
command's `name`, `command`, `args`, and positive `timeoutMs` fields unchanged.

Reserve the `repository` project type for checkout-wide hygiene and `custom`
for a checkout with no recognized project marker. Flatten profiles only at the
execution boundary, preserving profile order and command order. Do not add a
shell, infer argv from prose, or add profile data to approval or workflow
digests.

Keep a schema-version-1 compatibility decoder for normal runner execution and
model-only updates. Treat its flat command list as legacy compatibility data,
not as explicit project-type evidence. Preserve the file's version, command
order, unknown fields, and byte-unrelated content when updating model settings.
New `banzai init` output uses schema version 2. Provide a documented manual
migration; do not auto-migrate on load, init, model selection, or doctor.

Keep `contractVersion`, run-state schema version 2, model-result contracts,
evaluation export `banzai-evaluation-export/v1`, and hook authorization digests
unchanged.

## Consequences

Positive:

- configuration explicitly states which project type each command group
  covers;
- polyglot and repository-hygiene commands have separate deterministic places;
- profile order is stable and runner behavior remains no-shell;
- existing projects retain execution compatibility without a silent tracked
  rewrite;
- doctor can distinguish legacy absence from malformed current evidence.

Negative:

- the config decoder and tests permanently carry a version-1 compatibility
  branch until a separately approved removal;
- legacy config remains operational even though doctor reports it not ready;
- a fresh generic config can be structurally valid but verification-unready
  until project commands are configured;
- engineers must migrate tracked files manually.

Risks and required follow-ups:

- config drift: document exact version-1-to-version-2 examples and test both;
- accidental execution reorder: test profile-major and command-minor order;
- authorization drift: retain hook regression tests and exclude profiles from
  existing authorization digests;
- run evidence ambiguity: retain existing verification result shape and avoid
  changing the evaluation export contract in this iteration;
- removal of schema version 1 requires a separate accepted decision and release
  migration plan.

## Compliance and Confirmation

Implementation and review must confirm:

1. schema version 2 validates a non-empty ordered profile list, unique
   kebab-case IDs, known project types, non-empty command lists, and the existing
   command invariants;
2. new initialization writes schema version 2 and keeps the existing default
   model and effort settings;
3. schema version 1 loads and executes commands in original order without an
   on-disk rewrite;
4. model-only updates preserve the source config version, profile/command data,
   timeouts, and unknown fields;
5. multiple profiles execute in profile-major, command-minor order with
   `shell: false` and stop on the first failure;
6. no run-state, evaluation-export, model-result, approval-digest,
   workflow-digest, or hook-authorization contract changes;
7. migration documentation and focused compatibility tests exist;
8. no dependency or plugin-version change is present;
9. committed dist parity and repository verification gates pass.

## Lifecycle Links

- Amended by [ADR-0045](./0045-guided-verification-setup.md), accepted
  2026-09-14: optional bootstrap in schemas 2/3, guided profile mutation and
  explicit check-all diagnostics. Preserve schema-1 compatibility and ordinary
  runner order/failure behavior. Implementation of this amendment is Planned.

- Supersedes: None
- Superseded by: None
