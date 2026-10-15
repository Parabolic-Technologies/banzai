# ADR 0054: Git-visible Work Artifacts

## Status / Date / Owner / Decision Makers

- Status: Accepted
- Date: 2026-10-13
- Owner: Banzai maintainers
- Decision makers: Repository owner; explicitly accepted in chat on 2026-10-13
  with `Accept ADR-0054` and a request to prepare the implementation plan.
- Acceptance date: 2026-10-13
- Accepted proposal SHA-256: `00624c0589339ead459e26dbac411a487cf81f6f188b67e8ecc1c521dad4adb4`.
- Lifecycle effect: the partial supersession and amendments in Lifecycle Links
  are accepted. Their proposal-stage wording and the decision body are retained
  unchanged. Dependent planning is authorized; plan approval is still required
  before implementation.
- Scope: Banzai source and the reusable plugin's standalone and orchestrated
  work-document conventions.
- Preparation: standalone owner request to remove unnecessary artifact-layout
  complexity and restore Git visibility for documents requiring engineer review.
  This proposal records a target, not implemented behavior or plan approval.

## Related Artifacts

- Authority: [AGENTS.md](../../AGENTS.md),
  [PROJECT_MANIFEST.md](../../PROJECT_MANIFEST.md), sections 4, 5, 9 and 10,
  and the [decision log](README.md). No implementation plan is approved.
- Current [artifact storage](../artifact-storage.md),
  [archive](../artifact-archive.md) and
  [publication boundary](../publication-boundary.md) documentation.
- [ADR-0041](0041-artifact-retention-and-publication-boundary.md): private work,
  selectable layouts, storage helper, archive and publication policy.
- [ADR-0049](0049-task-scoped-verification.md): task verification, including its
  owner amendment removing historical-run continuation from implementation scope.
- [ADR-0040](0040-project-adoption-preflight-and-interactive-setup.md) and
  [ADR-0042](0042-runner-delivered-phase-instructions.md): adoption and shared
  instruction delivery.
- [ADR-0037](0037-unified-runner-rendered-review-artifacts.md),
  [ADR-0038](0038-explicit-plan-authority.md) and
  [ADR-0047](0047-runner-owned-completion-projection.md): independent review,
  approved plan authority and runner-owned completion evidence.

## Context and Decision Drivers

Decision question: should human-reviewed work documents use one ordinary,
Git-visible repository convention, replacing configurable private storage and
its mandatory authoring protocol?

The owner reports that plans and reviews are inconvenient to inspect in the
IDE's Git Changes view because they are ignored. The requested improvement is
both visible work documents and less functionality to maintain. Adding another
layout option would address only the first concern.

The owner additionally requires no migration: existing project documents stay
where they are. The supplied IDE screenshots show one work split between
`documentation/development-plans/<slug>/` and
`documentation/features/<slug>/`. Even when these documents are Git-visible,
the engineer must mentally join two branches of the change tree. The primary
navigation unit must therefore be the work itself, with its artifact roles
visible together beneath one directory.

Inspection on 2026-10-13 at `ead9f32` found these current boundaries:

| Evidence | Current behavior and consequence |
| --- | --- |
| Root `.banzai/artifacts.json` and `.gitignore` | Declare `private`; ignore `.banzai/work/` and historical feature, plan and change directories. New documents are absent from ordinary Git changes. |
| `plugins/banzai/policies/artifact-storage.md` and `lib/artifact-storage.mjs` | Require initialization, identity resolution and claims before standalone artifact writes. `verifyIgnores` rejects private evidence that becomes Git-visible. Removing an ignore alone is insufficient. |
| `plugins/banzai/contracts/artifacts/v2/work-binding.schema.json` | Requires `layout: private`; the convention cannot change by relabeling existing binding-v2 data. |
| `plugins/banzai/lib/verification-helper.mjs` | Task verification loads the bound plan/work document, takes a work claim and writes machine evidence under the binding. Deleting storage code without adapting this consumer would break verification. |
| `publication-policy.json` and `packages/orchestrator/scripts/publication-check.mjs` | Reject private/internal evidence and unclassified documentation in candidate trees and distributions. Git tracking and package eligibility currently share the classification mechanism. |
| Checkout-local `.git/hooks/banzai-publication/pre-push.mjs` | Additionally requires the private declaration and rejects historical workflow directories in outgoing commits. This local installation is outside the tracked source. |

These mechanisms enforce the earlier decision, but their cost now conflicts
with the owner's workflow. Human review benefits from diffs, adjacent source
changes, branch history and ordinary repository handoff. A document's presence
in Git does not make its claims true or record its approval.

Drivers are review usability, fewer storage concepts, explicit work selection,
portable documents, truthful verification and preservation of existing data.
Repository visibility belongs to the project owner. A Git-tracked document is
available to that repository's readers; it is not implicitly a package asset.

## Options Considered

| Option | Benefits | Costs and disposition |
| --- | --- | --- |
| Keep private storage and improve links or add a viewer | Preserves existing contracts with limited change | Still misses ordinary Git review and adds another surface to maintain. Rejected. |
| Unignore or force-add the current UUID work directories | Small apparent filesystem change | Conflicts with ignore validation and publication rules, mixes documents with machine metadata, and retains layout/claim/archive complexity. Rejected. |
| Add a third, tracked layout or revive configurable legacy storage | Can reuse much of the resolver | Adds or preserves branching, configuration, initialization and compatibility behavior. Rejected as the permanent model. |
| Use one fixed document convention with separate execution state | Makes new documents visible to Git and removes layout selection from ordinary work | Requires coordinated changes to skills, verification, runner integration and publication rules. Selected proposal. |

## Decision

### Keep work documents in Git

Use `documentation/work/<slug>/` for the documents of newly started work in
both standalone and orchestrated workflows. Use a descriptive repository-unique slug and pass
the exact directory or document path when continuing work. Do not choose work
by newest timestamp or silently reuse a conflicting directory.

```text
documentation/
  decisions/                         # ADRs and decision index
  work/<slug>/
    description.md                   # strict requirements
    plan.md                          # strict plan
    implementation-report.md
    test-report.md
    review-1.md                      # successive reviews retain their versions
    work.md                          # lite work instead of strict documents
    change-report.md                 # only when the existing fix rule requires it
.banzai/                             # ignored execution state and machine evidence
```

The tree lists possible roles, not mandatory files for every task. Requested
analysis, design notes, human decision records and handoff documents that need
engineer review follow the same tracked convention. Preserve existing report
triggers and approval rules; the storage change creates no additional reports.
ADRs, the project manifest and maintained product guidance keep their paths.

Keep the ordinary work directory flat: requirements, plan, reports and numbered
reviews are sibling files. This gives the IDE change tree one expandable work
node and keeps artifact names visible without opening additional type folders.
Do not recreate separate feature/plan/report roots inside `work/`. Introduce a
local assets directory only when that work actually needs supporting files.

Use the same `work/` root for features, fixes, investigations and refactors.
Name the directory for the work's subject; keep its name stable through
planning, implementation, review and completion. Workflow mode, current status,
assignee and date do not become directory levels or required name prefixes.
Do not add an index, metadata file or status document solely for navigation.
Existing guides, decisions, assets and project-specific documentation directories
retain their organization; the new work convention does not reorganize them.

New documents must be eligible for ordinary `git status`, staging and diffs,
without `git add -f`, a plugin-specific viewer or a promotion operation. An
existing broader ignore that hides this directory needs a narrow correction,
not forced staging. Git visibility does not authorize staging, commits or pushes.

### Remove layout management from ordinary authoring

Remove `.banzai/artifacts.json` as an input or prerequisite for new work. Do not
replace it with a layout selector, configurable document root or global registry.
Standalone skills read and edit their selected documents with ordinary file
tools. Creating a plan or review must not require a UUID registration, private
request file or `inspect/acquire/write/release` protocol.

Retire the generic artifact-layout and work-archive command surface and remove
its implementation, contracts, instructions and tests when its supported
consumers have been adapted. New tracked documents use ordinary Git history and
the project's backup practices; Banzai provides no separate archive service for
them. Do not add a migration framework or keep private/legacy/tracked as three
supported authoring modes. Unrelated runner checkpoint recovery remains a
separate responsibility.

Keep only execution mechanisms justified by their actual consumers: runner
ownership and exact phase grants, verification execution coordination, immutable
snapshots, approved-byte checks and atomic canonical review publication. These
mechanisms must not become mandatory ceremony for standalone Markdown editing.
Do not silently overwrite concurrent work or treat a directory as a grant to
edit every artifact it contains.

### Preserve verification and authority independently of document storage

Keep raw logs, temporary candidates, locks, session data, runner state and
machine verification ledgers ignored under project-local `.banzai/`. Human-facing
reports retain the commands, results, limitations and decision context needed
for review; link to machine evidence when it exists. A Git clone without that
evidence must report it as unavailable, not reconstruct a passing result from
prose or claim to resume an old run.

Adapt task verification to consume the explicitly selected tracked plan or
work document. Preserve task obligations, actual command execution, source and
authority binding, executor identity and mandatory-check semantics. The helper
may own its machine metadata; it must not require private storage of the
document it verifies. Git visibility does not relax runner approvals, reviewer
independence or protection against forged completion evidence.

Version any changed persisted or public contract semantics explicitly; do not
reinterpret private binding v2 as supporting the new convention. Keep runner
changes bounded to the storage, verification, scope and instruction integration
needed for this decision, without a wider orchestrator redesign.

### Separate repository review from package contents

Treat new work documents as ordinary reviewable repository content. Make the
fixed work-document subtree eligible at source-tree and source-archive checks
without a separate publication-inventory entry for every report. Keep ordinary
code review and existing secret/content checks; remove the rule that a work
document is forbidden solely because it is workflow evidence.

Exclude source-project work documents from plugin and npm payloads. Keep raw
execution evidence and credentials excluded from Git and distributions. Do not
weaken unrelated product-resource classification or release checks. An adopted
project's repository visibility remains its owner's responsibility; do not copy
client evidence into the Banzai source repository.

The checkout-local pre-push installation must be reconciled with the accepted
policy before delivery. Editing tracked code alone does not update that hook;
preserve unrelated hooks and do not disable publication checks wholesale.

### Leave existing work in place without migration

Apply the new convention only to newly started work. Leave all existing work
documents at their current paths, including tracked legacy documents and ignored
private documents. Preserve their references, archive bundles and runner records.
Do not move, rename, copy into Git, recursively unignore or delete existing
evidence as part of this change. There is no migration inventory, migration
command or migration phase.

An explicitly requested continuation of existing standalone work uses its known
documents and locations, including follow-up reports and reviews, so that one
existing work is not split again across old and new roots. Direct references
to those documents do not require automatic legacy discovery, a layout selector
or registration in a new storage system. This convention does not authorize
continuation of a historical run. Do not add old-run migration or continuation
support removed by the ADR-0049 owner amendment. Retained historical
bytes and any tools needed to read existing archives require an explicit custody
decision before their last usable copy is removed.

After acceptance, author this transition's own requirements, plan, reports and
reviews under `documentation/work/git-visible-work-artifacts/`. Update the root
authoring instructions for that bounded transition before creating them. Use
explicit file paths until product consumers support the new convention; do not
retarget an existing private binding or claim the product cutover has occurred.

## Consequences

- Engineers can inspect a new plan or review beside its source changes and
  retain both in ordinary repository history.
- Layout selection, document registration and archive management disappear from
  the normal skill workflow instead of gaining another supported mode.
- Repository history will contain more work documents. Accept that cost in
  exchange for reviewability; deleting a later file does not erase Git history.
- Existing projects can contain earlier directory conventions alongside `work/`
  for new work. Accept that coexistence without a migration subsystem or a
  project-wide cleanup. Existing private evidence remains local.
- Verification and runner integration need coordinated changes before obsolete
  storage components can be removed. A prompt-only path change is incomplete.
- Required follow-ups are a strict specification and plan covering consumer
  removal, changed contracts, publication checks, the local hook and repository
  guidance. This ADR does not approve implementation or a release version.

## Compliance and Confirmation

The following are implementation acceptance checks, not results of this proposal.

| Guarantee | Observable confirmation and owner |
| --- | --- |
| Reviewable documents are visible in Git | Disposable standalone and runner workflows create applicable strict/lite/fix documents and numbered reviews as siblings under one work directory. Git status lists new files and ordinary staged diffs show them without force-add. |
| Authoring is simpler | Installed skills can create and continue a selected document without a declaration, registration or artifact-helper write protocol. Read-only invocations create nothing. No alternate-layout fallback remains on the new path. |
| Verification remains meaningful | Task-verification tests exercise tracked plan edits, stale source/authority, command failures and missing local evidence. Mandatory checks and executor provenance retain their meaning. |
| Runner authority survives | Existing approval, phase-scope, review publication and completion tests cover tracked documents; unauthorized or changed approved bytes still fail. |
| Source and package boundaries differ correctly | Source checks accept a new work document through ordinary review; actual plugin/npm payload checks exclude it. Forced-added machine state and credential fixtures still fail. The installed local hook is checked separately. |
| Existing data is preserved without migration | Fixtures with tracked legacy work, ignored private work and archives remain at the same paths with identical bytes after new-work setup. An explicit standalone continuation uses the existing work locations. No relocation, approval adoption or historical-run continuation occurs. |
| Removal is complete | Consumer inventory and repository checks show no new-work dependency on the layout declaration or retired artifact/archival protocol; generated resources and committed bundle match. |

Security exposures are bounded to filesystem destinations and write grants
(classes 1/2), repository visibility of generated documents (class 4), and
publication or overwrite (class 7). The implementation must reject unsafe path
escape at helper/runner boundaries, retain exact write ownership, keep raw
private evidence out of generated repository documents, preserve historical
bytes and verify real package contents. Use the existing assurance owners;
these checks do not add a new approval service or claim exhaustive secret
detection. Report local, installed-client and delivery evidence separately.

## Lifecycle Links

- Proposed partial supersession of
  [ADR-0041](0041-artifact-retention-and-publication-boundary.md): replace the
  private default, selectable layouts, mandatory standalone storage protocol,
  private archive requirement for new documents, and categorical exclusion of
  work documents from source Git history. Preserve historical custody,
  execution-state privacy and workflow authority.
- Proposed narrow amendment to
  [ADR-0049](0049-task-scoped-verification.md): remove private document/binding-v2
  storage as a prerequisite for new task work while preserving verification
  authority and the owner decision against historical-run migration.
- Proposed consequential amendments to ADR-0040/0042 for initialization and
  instruction delivery, and ADR-0037/0038/0047 for document locations. Their
  approval, review, verification and completion semantics remain authoritative.
- No existing ADR is superseded by this proposal before acceptance. Record
  accepted lifecycle links without rewriting historical decision bodies.
- Amended by
  [ADR-0055](./0055-planning-gate-rework-and-independent-planning-review.md),
  accepted 2026-10-13: the flat work directory also holds runner-rendered
  `planning-review-<N>.md` siblings, recognized by name pattern. Binding v3
  gains no role. Implementation is Planned.
- Superseded by: None.
