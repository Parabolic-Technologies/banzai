# Implementation Report: Git-visible Work Artifacts

Slug: `git-visible-work-artifacts`

Related artifacts: [description.md](description.md), [plan.md](plan.md),
[test-report.md](test-report.md), [ADR-0054](../../decisions/0054-git-visible-work-artifacts.md).

## Authority and scope

The owner accepted the exact description/plan bundle in chat on 2026-10-13 and
instructed implementation, including removal of `banzai artifacts` and unused
storage code. The approved plan SHA-256 remains
`0fbde5a43214d319c6abc90a272ca95690fc5427b712dc4330c5d12f0cf3f084`;
its checkboxes and proposal-era approval text were not rewritten. The owner
subsequently selected release-train version `2.7.0`; the existing version-set
transaction synchronized all nine version fields.

This is standalone implementation evidence, with an author-owned v1 completion
table. It is not runner state, a completion receipt, independent review, or
permission to stage, commit, push, install or publish.

## Result

New human-reviewed documents use the flat `documentation/work/<slug>/`
convention. Standalone skills edit ordinary Markdown without declarations,
registration or storage commands. Existing selected standalone work keeps its
known paths. New runner state 9 carries binding 3 directly, workspace 3 accounts
for selected documents once, and snapshot 7 / rendered review 8 retain immutable
approval, review and completion identities. New capabilities 7 / control 7.0.0
advertise `workDocuments` instead of layout configuration.

Standalone verification request 3 selects an exact document and workflow.
Inspect/decide do not allocate metadata; execute records real attempts beneath
ignored `.banzai/verification/`. Runner verification stays under its existing
ignored run root. A shared executor lock excludes concurrent execution and
releases only its own live claim. Missing evidence remains unavailable; failed,
interrupted, passed and retried checks keep distinct meanings. Historical request
execution and historical runner bindings are refused without migration.

Source publication accepts the fixed work subtree without per-report inventory
entries, while content checks and actual plugin/npm exclusions remain enforced.
The CLI artifacts dispatcher, generic storage/archive writer, unused contracts
and their obsolete tests have been removed. The retained v1/v2 binding decoder
serves historical run/review readers only. Hook and CLI readers still share the
generated bounded artifact reader.

## Changed owners and structural assessment

The approved plan identified a structural trigger: a generalized layout/storage
subsystem had mixed document naming, safe filesystem operations, execution
ownership, adoption and history. Reuse search and the implementation preserve
one owner per responsibility:

| Responsibility | Implemented owner and invariant |
| --- | --- |
| Fixed paths and runner binding | `plugins/banzai/lib/work-documents.mjs`; exact role map, collision refusal, Git visibility and selected document inventory |
| Filesystem safety | `plugins/banzai/lib/project-files.mjs`; extracted existing bounded reads, containment, symlink checks and atomic/create-only primitives |
| Execution exclusion | `plugins/banzai/lib/execution-ownership.mjs`; private claims bound to selected directory and exact execution identity |
| Verification evidence | Existing task-verification modules and explicit helper v3; approved checks and physical origins retain their authority |
| Historical compatibility | `work-binding-history.mjs` and existing review readers; no new authoring layout or migration service |
| Adoption and review decoding | Existing dedicated project-adoption/review-snapshot modules, imported directly |

The TypeScript projections contain no alternate implementation. Shared modules
remain builtin-only ESM; explicit import-boundary entries name their owners.
No dependency, registry, remote service or background process was added.

Only exact canonical review outputs are omitted from the runner's verification
source observation: they are published after checks and separately protected by
frozen review snapshots, workspace guards and publication receipts. Approved
plans, descriptions, implementation/test reports and source edits remain
observed. Rendered review 8 projects check/result summaries and repository-relative
references, omitting raw execution captures and absolute runtime working paths.
Historical renderer meanings are retained.

## Remaining-reference inventory

| Retained reference or reader | Supported consumer and boundary |
| --- | --- |
| `lib/work-binding-history.mjs` and binding v1/v2 schemas | `work-documents.parseBinding`, `RunStore` and shared review-snapshot inspection decode original state/review identities; execution refuses them |
| `lib/review-snapshot.mjs` and generated `lib/artifact-readers.mjs` | CLI review validation and the hook consume bounded review/approval evidence; historical versions keep their original meanings |
| Existing verification decisions, applicability/origin parsers and retained contract files | Existing evidence/status/review readers inspect original records; old standalone request schemas are historical documentation, not an executable helper interface |
| Artifact storage/archive guides and migration roadmap | Maintained guide names the new convention; archive/roadmap text is explicitly historical and points to preserved tool source at Git baseline `ead9f32` |
| Baseline, legacy schema, evaluation and context fixtures | Original instruction extraction and historical reader meanings remain pinned; current executor/workspace fixture expectations alone follow successor semantics |

Reference inspection found no current import or executable dispatch to the
removed generic storage/archive modules or `artifacts.cjs`. CLI help omits
`banzai artifacts`; capabilities advertise only the fixed work-document contract.

## Preservation and delivery

The source implementation preserved existing work documents, declarations,
private archives and run records. The subsequent owner-authorized local-hook
delivery removed only `.banzai/artifacts.json`; historical work, archives and run
records remain in place. The lifecycle annotations
on seven older ADRs add reciprocal links only; their accepted bodies remain
unchanged. The finite recognized images are guarded by ADR-0054 acceptance.
Original instruction baselines and prior transition identities are preserved;
current expectations evolve through the explicit ADR-0044 transition mechanism.

The source guard is updated. A hash-bound local pre-push patch and disposable
fixture suite are available in [local-hook-delivery.md](local-hook-delivery.md).
Historical/pre-delivery evidence: seventeen local fixture tests passed,
including outgoing history inspection and private evidence exclusions; applying
the patch to a disposable copy produced the same tested bytes. The owner then
explicitly authorized real hook delivery on 2026-10-13. The patch is installed,
the declaration is removed, and the supplied 17-test suite passed against copies
of the installed bytes. Current installation hashes and native evidence are in
[local-hook-delivery.md](local-hook-delivery.md#current-delivery-status).
Installed clients, external model CLIs, hosted CI and external publication were
not exercised or claimed.

## Verification and remaining evidence

The focused feedback and final release evidence are recorded in
[test-report.md](test-report.md). The release-candidate driver source remains at
its plan-pinned SHA-256. Its normal checkout invocation refuses a deleted file
still listed in the index (`MISSING_RELEASE_CANDIDATE_FILE`). The final check is
therefore run from an exact disposable source mirror with its own index, with
the unchanged driver and real dependencies; the working checkout is never
staged. Only genuinely deleted index entries are omitted from the source mirror. An
extraneous dangling `node_modules/node_modules` link is omitted from the
dependency mirror; all real installed packages and workspace links are retained.

Historical/pre-fix evidence: the initial fresh release candidate check passed
all components, including 1572/1572 tests, with zero failing or skipped tests. `git diff --check` passed.
Source baseline: `ead9f328719822d4f630d89f3df5c9af3dc7cb5f`; candidate input tree SHA-256:
`cac03acb6d48832f1c71482abcaaaf33ccec2307463aaa915ca5f4531457e06f`. Current source inputs
were rehashed after the gate and matched its capture before evidence-only report
and implementation-index finalization. Raw stdout is retained privately at
`.banzai/verification/74816e2fd54e15645a1278e9a160ccd3d00e927149bff2ce185b7586ea78171c/manual-release-cac03acb6d48832f.log`.
This is actual manual gate output, not a fabricated helper record or receipt.
That gate preceded review-1 and does not establish fix closure. Review-1 requested
changes; the owner accepted F1, F2 and F3 in chat. The current v1 task table below
is refreshed against the corrected tree and fresh verification recorded next.

## Accepted review closure (historical/pre-delivery)

The [change report](change-report.md) records F1-F3. Concrete private verification
and runner destinations, including temporary files and reused standalone
identity/evidence, now require effective Git exclusion. Nested exceptions and
tracked machine evidence are refused before exposed bytes are written. Bootstrap
establishes narrow ignores before creating its lock. The dead legacy discovery
closure is removed; the maintained capabilities paragraph says schema 7.

Before local-hook delivery, final source-fix verification passed the unchanged default release-candidate gate:
**1581 tests passed**, zero failed, cancelled, skipped or todo, plus typecheck,
lint (zero errors; 382 advisory warnings), build/resource parity, formatting,
release/version/instruction checks, actual source/plugin/npm payload checks and
committed CLI smoke. The mandatory `git diff --check` passed. Candidate input
SHA-256: `10644445cefcee4a25efefdf8d32aa80c196488965ac43b2c57b91486452b8ce`.
Its bytes matched after the gate and before evidence-only finalization of these
three reports. The driver remains at its approved source pin; the same disposable
mirror/index workaround and local loopback permission apply.

Native F1-F3 source-fix gate output and its source capture are private:
`.banzai/verification/74816e2fd54e15645a1278e9a160ccd3d00e927149bff2ce185b7586ea78171c/manual-release-f1-f3-10644445cefcee4a.log`
and the sibling `manual-release-f1-f3-10644445cefcee4a-source.json`.
These are manual physical evidence, not helper applicability or runner receipts.
All eight source-implementation task claims are complete in the author-owned v1 projection.
The named gate certifies its recorded pre-delivery source snapshot, not the
subsequent local-hook, configuration and documentation changes.
Independent resolution review is a separate evidence owner.

## Deviations and engineering quality

The version change is explicitly owner-authorized. The disposable source mirror
addresses the existing driver's deleted-index limitation without editing its
pinned source or weakening a release component. No functional scope expansion
or approved authority change is introduced. There are no additional material
Engineering Quality deviations. Local-hook delivery is separately recorded as
applied; installed-client delivery remains separate from source implementation
acceptance. Independent review is a separate
phase and is not claimed by this report.

## Plan Task Completion

Format: `banzai-plan-task-completion/v1`

| Task | Status | Evidence | Gap or deviation |
| --- | --- | --- | --- |
| T001 | completed | [{"path":"plugins/banzai/lib/work-documents.mjs","detail":"Fixed roles, safe shared primitives and accepted lifecycle images."}] | null |
| T002 | completed | [{"path":"plugins/banzai/lib/verification-helper.mjs","detail":"Explicit document request v3; identity and reused evidence revalidated."},{"path":"plugins/banzai/lib/project-files.mjs","detail":"Concrete private leaves and temporaries require effective Git exclusion."}] | null |
| T003 | completed | [{"path":"packages/orchestrator/src/workflow.ts","detail":"New state 9 embeds binding 3 without registration."}] | null |
| T004 | completed | [{"path":"packages/orchestrator/src/review-artifact.ts","detail":"Workspace/snapshot successors and exact protected publication roles."}] | null |
| T005 | completed | [{"path":"plugins/banzai/policies/artifact-storage.md","detail":"Direct Markdown conventions and explicit instruction transitions."}] | null |
| T006 | completed | [{"path":"documentation/work/git-visible-work-artifacts/local-hook-delivery.md","detail":"Source/package guards and tested separate hook delivery."}] | null |
| T007 | completed | [{"path":"packages/orchestrator/src/cli.ts","detail":"Retired artifacts dispatch and unused storage/archive surfaces removed."},{"path":"plugins/banzai/lib/work-binding-history.mjs","detail":"Only supported historical parsing remains; dead discovery closure removed."}] | null |
| T008 | completed | [{"path":"documentation/work/git-visible-work-artifacts/test-report.md","detail":"Fresh 1581-test release gate, unchanged driver pin and current implemented documentation."}] | null |
