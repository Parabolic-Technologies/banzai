# Feature: Git-visible Work Artifacts

Slug: `git-visible-work-artifacts`

Requirements authority: the owner's acceptance of
[ADR-0054](../../decisions/0054-git-visible-work-artifacts.md) on 2026-10-13 and
explicit request for an implementation plan without document migration.
This document transcribes that accepted scope into testable requirements; it
does not record a separate approval of these file bytes. The description and
[plan](plan.md) form the pending implementation-approval bundle.

## Overview

An engineer starts new work, inspects all of its documents beneath one
`documentation/work/<slug>/` node in the IDE's Git Changes tree, and reviews
their diffs with the associated source changes. Standalone agents author these
documents through ordinary file tools. Execution evidence remains local and
machine-owned; Git visibility grants no approval or completion authority.

Existing work retains its documents and locations. There is no migration,
renaming campaign, legacy registration, archive restoration or historical-run
continuation project. The change adds no workflow phase, report requirement,
dependency, remote service, automatic commit, installation or publication.

## Functional Requirements

- **FR1 — Work grouping.** Newly started work uses
  `documentation/work/<slug>/` for its human-reviewed artifacts in standalone
  and orchestrated modes. Strict descriptions, plans, reports and numbered
  reviews are sibling files with the names specified by ADR-0054.
- **FR2 — Stable navigation.** A descriptive slug identifies one work directory.
  Features, fixes, investigations and refactors share this convention. Mode,
  date, owner and lifecycle status create no directory levels, required name
  prefixes or navigation metadata files.
- **FR3 — Proportionate artifacts.** Strict/lite/fix report triggers remain
  unchanged. A lite task uses `work.md`; a fix writes `change-report.md` only
  when required. Supporting assets are created only when needed. ADRs and
  maintained project documentation retain their established locations.
- **FR4 — Direct authoring.** New standalone document creation, reading,
  review and editing require no artifact-layout declaration, UUID registration,
  work-binding file, archive service or artifact-helper write protocol.
  Read-only discovery creates nothing. Existing declaration contents do not
  select or block the new convention.
- **FR5 — No migration.** Setup and new work preserve the bytes and locations
  of existing documents, private records and archive bundles. They do not move,
  rename, copy into Git, recursively unignore or delete existing evidence.
- **FR6 — Explicit continuation.** An explicitly selected existing standalone
  work continues at its known paths, including subsequent reports and reviews.
  An ambiguous selection requires a concrete path; it never chooses the newest
  item or creates a second work identity automatically. This grants no old-run
  continuation and adds no automatic legacy-discovery subsystem.
- **FR7 — Git visibility.** New work documents appear in ordinary Git status
  and can be staged and diffed without force-add. If an existing ignore hides
  them, report its narrow correction without staging files or exposing earlier
  ignored evidence.
- **FR8 — Execution privacy.** Raw logs, temporary candidates, locks, session
  data, runner records and machine verification evidence remain ignored under
  project-local `.banzai/`. Reports contain safe review context and evidence
  references, not copies of raw private or credential-bearing output.
- **FR9 — Verification authority.** Standalone task verification consumes an
  explicitly selected plan/work/change document without requiring private
  document storage. Required checks, actual execution, source and authority
  digests, retries and executor identity retain their semantics. Missing local
  evidence remains unavailable and cannot be reconstructed as success.
- **FR10 — Runner authority.** New runner work uses the same document convention
  while preserving exact phase grants, approved bytes, independent review,
  attempt-owned candidates, atomic publication and completion receipts.
  Concurrent edits cannot silently replace authoritative evidence.
- **FR11 — Explicit compatibility.** Changed binding, state, snapshot and public
  request semantics receive explicit successor versions. Private binding v2 and
  historical documents retain their original meaning; no old-run migration or
  implicit approval transfer is introduced.
- **FR12 — Source publication.** Source-tree and source-archive checks accept
  the fixed work-document subtree without per-report inventory entries.
  Existing content checks still apply. Machine evidence, credentials and
  unrelated private namespaces remain excluded, including forced-added files.
- **FR13 — Package boundary.** Actual npm and plugin payloads exclude
  source-project work documents. Adopted projects keep their own documents;
  no evidence is copied into the installed plugin or Banzai source checkout.
- **FR14 — Removal.** The shipped generic artifact-layout, registration,
  document-write and work-archive command surface is retired after its consumers
  are adapted. Unused implementation, contracts and tests are removed; retained
  readers or filesystem safeguards have an identified supported consumer.
- **FR15 — Coherent delivery.** Skills, shared phase resources, adoption guidance,
  templates, source publication checks and documented local-hook behavior agree
  on the new convention. Plugin-only usage does not require the orchestrator.
  Generated resources and the committed CLI bundle match their sources.
- **FR16 — Safe filesystem boundaries.** Executable consumers reject traversal,
  symlink escape, unsafe destinations and identity conflicts before writing.
  Exact selection never grants access to another work's artifacts or arbitrary
  runner control. Interrupted execution retains truthful evidence and releases
  only its own live ownership; stale ownership is never stolen by timeout.

## User Stories & Acceptance Criteria

| ID | Given / When / Then | Requirements |
| --- | --- | --- |
| AC01 | Given new strict work, when its documents are produced, then description, plan, required reports and `review-N.md` files share one stable, flat work directory visible in Git changes. | FR1, FR2, FR7 |
| AC02 | Given lite or fix work, when the applicable skill runs, then it produces only its required artifacts under the same convention; project guides and ADRs retain their locations. | FR1, FR2, FR3 |
| AC03 | Given no declaration, or an existing private/legacy/invalid declaration, when a standalone author starts new work, then that declaration is neither read as authority nor modified, and no registration/helper write protocol is needed. Read-only operations leave no new files. | FR4, FR5 |
| AC04 | Given tracked legacy documents, ignored private documents and archives, when new work starts, then their paths and bytes are unchanged; explicit standalone continuation adds its follow-up documents beside that existing work. | FR5, FR6 |
| AC05 | Given an ambiguous work selection, colliding target or unsafe path, when an executable consumer is invoked, then it refuses before mutation; one selected path cannot authorize unrelated work or control files. | FR6, FR10, FR16 |
| AC06 | Given an ignore rule hiding new work, when creating its documents, then the engineer receives the narrow correction needed for Git visibility; no force-add or broad unignore occurs. | FR5, FR7, FR8 |
| AC07 | Given an explicitly selected task document, when standalone verification runs, then real attempts and authority identities are retained privately; changed authority, failed checks, missing evidence and retries keep their existing truthful meanings. | FR8, FR9, FR16 |
| AC08 | Given a new strict runner task, when planning, approval, implementation, review and completion occur, then only the authorized tracked artifacts change and immutable approval/snapshot/receipt checks reject drift or forged completion. | FR10, FR11, FR16 |
| AC09 | Given old persisted versions, when upgraded tooling inspects or refuses to execute them, then it preserves bytes and reports their actual compatibility without converting them into new work or inventing completion evidence. | FR5, FR9, FR11 |
| AC10 | Given a new work document without a per-file publication entry, when source and source-archive checks run, then it is accepted subject to content checks; forced-added machine state and credential fixtures fail safely. | FR8, FR12 |
| AC11 | Given the release candidate, when actual plugin and npm payloads are assembled, then source-project work documents and private execution evidence are absent. | FR8, FR13 |
| AC12 | Given the adapted consumers and generated resources, when normal skills, CLI help, setup and capabilities are inspected, then retired layout/archive operations are absent, fixed-path instructions agree and plugin-only operation needs no CLI installation. | FR4, FR14, FR15 |

## Platform Specifics

Use the current Node 22/24 support lanes, builtin-only shared ESM plugin boundary,
TypeScript orchestrator, npm workspace and existing Codex/Claude instruction
delivery. Preserve root-owned release identity and separate plugin/CLI delivery
evidence. No new runtime dependency or supported platform is required.

## Security Exposure

- Class 1, input-selected filesystem destinations: FR6/FR16 require explicit
  selection and containment before executable consumers read or write evidence.
- Class 2, changed document write grants: FR10/FR16 preserve exact phase authority,
  approved bytes and ownership checks after documents become Git-visible.
- Class 4, generated reports entering repository history: FR8/FR12/FR13 keep raw
  private data outside tracked reports and package payloads.
- Class 7, publication and overwrite: FR5/FR10/FR12/FR16 preserve existing bytes,
  reject unsafe replacement and inspect actual candidate trees and packages.

## Architecture Decision Needs

None outstanding. ADR-0054 is accepted and defines the storage transition and
its bounded amendments. The plan specifies successor contract versions and
execution details within that accepted scope.

## Resolved Assumptions

1. **User-confirmed:** ADR-0054 is accepted; prepare its implementation plan.
2. **User-confirmed:** existing project documents stay where they are; no migration.
3. **User-confirmed:** organize new documents by work beneath `documentation/`.
4. **Manifest convention:** approvals, verification ownership and review semantics
   remain authoritative independently of document location.

## Open Questions & Risks

None outstanding
