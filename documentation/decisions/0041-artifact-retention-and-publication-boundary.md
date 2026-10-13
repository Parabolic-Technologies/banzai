# ADR 0041: Artifact Retention and Publication Boundary

## Status / Date / Owner / Decision Makers

- Status: Accepted
- Date: 2026-09-10
- Last revised: 2026-09-11
- Owner: Banzai maintainers
- Decision makers: Repository owner; explicitly accepted in chat on 2026-09-11
  (English translation: `Accept ADR-0041 and prepare the plan`).
- Acceptance date: 2026-09-11
- Lifecycle note: proposal-stage wording below is retained as accepted history;
  this acceptance does not authorize implementation or external delivery.
- Scope: Banzai source repository policy and the reusable plugin/orchestrator
  behavior needed to enforce that policy in adopted projects.
- Preparation: standalone architecture request. The request to prepare this
  ADR does not accept it. No feature description or strict implementation plan
  is approved for this change.

## Related Artifacts

- [Migration roadmap](../artifact-policy-migration.md), a planning proposal,
  not an approved strict implementation plan.
- Repository authority: root [AGENTS.md](../../AGENTS.md) and
  [PROJECT_MANIFEST.md](../../PROJECT_MANIFEST.md), sections 4, 6, 9 and 10;
  [module reference](../../packages/orchestrator/MODULES.md).
- [Current publication scope](../README.md#public-documentation-scope).
- Related decisions: [0017](./0017-versioned-plan-task-completion-ledger.md)
  and [0025](./0025-fix-authored-completion-ledger-refresh.md) (completion),
  [0019](./0019-attempt-owned-review-candidates.md) (review publication),
  [0023](./0023-durable-terminal-attempt-checkpoints.md) (recovery),
  [0036](./0036-vendor-neutral-policy-files-and-instruction-delivery.md)
  (policy delivery), [0037](./0037-unified-runner-rendered-review-artifacts.md)
  (review snapshots), [0038](./0038-explicit-plan-authority.md) (approval),
  [0033](./0033-root-package-version-authority.md) (release versions),
  [0039](./0039-npm-trusted-publishing-on-github-release.md) (publication), and
  [0040](./0040-project-adoption-preflight-and-interactive-setup.md)
  (adoption and setup).

## Context and Decision Drivers

Decision question: should new Banzai work use a shared, project-local private
artifact workspace in both standalone and orchestrated modes, with durable
retention and explicit promotion into repository documentation?

The owner requested a long-term policy and implementation plan and offered to
replace an origin branch and recreate releases. This authorizes preparation;
it does not record ADR acceptance or an instruction to mutate origin/npm now.

Inspection on 2026-09-11 at local commit
`bacb51f49264aad1b1f26e94e7b7c784073d3cee` found a clean worktree before this
revision, with 328 documentation files among 601 tracked files: 153 feature
files, 85 change reports, 27 plans, 42 decision files including this proposal
and the index, and 21 other documents. This is local source evidence, not
independently verified remote contents or delivery state.

Current skills generate reports under `documentation/`; review publication
and planning restrictions embed those paths. `.banzai/runs/` is already ignored.
Git-based change snapshots omit ignored untracked files, and completion
validation currently forbids `.banzai` path segments. Merely changing paths or
adding ignore rules would leave evidence outside existing enforcement.

| Current source boundary | Proposed change |
| --- | --- |
| Artifact paths in shipped skills and `review-artifact.ts` name `documentation/` | Resolve a declared layout and stable work identity before reading or writing artifacts. |
| `git.ts` inventories Git changes; planning scope in `prompts.ts` and `validation.ts` assumes documentation paths | Account for the authorized private work surface independently of Git visibility. |
| `plan-task-completion.ts` excludes `.banzai` path segments | Admit only exact authorized work reports under the new layout; keep arbitrary runner data ineligible. |
| `project-manifest` scaffolds project guidance and `documentation/`; runner setup follows ADR-0040 | Add storage initialization without bypassing guidance prerequisites or requiring the CLI for standalone use. |
| Root `.gitignore` excludes runs, active-run pointer and runner lock | Also exclude private work while keeping portable storage configuration eligible for Git. |

Drivers are durable approvals, independent review, recoverability, useful
public documentation, bounded authoring effort, privacy, contributor access,
offline operation, and compatibility with retained runs. Git tracking,
workflow authority, and public visibility must become separate concerns.

## Options Considered

| Option | Benefits | Costs and disposition |
| --- | --- | --- |
| Keep everything tracked; periodically delete old files | Minimal initial change | Repeated growth, public historical copies, and repeated cleanup; rejected. |
| Keep a private development repository and export every public release | Strong separation using ordinary Git | Two source histories and recurring synchronization of outside contributions; disproportionate as the permanent default. A one-time export remains useful for migration. |
| Keep public product sources and private workflow evidence, with explicit publication | One source-development history after migration; evidence remains available without automatic publication | Requires storage-aware integrity, archive/restore, and contributor rules; recommended. |
| Keep all artifacts only on one workstation or discard them at completion | Small public tree | Loses recovery and team handoff; rejected. |

## Decision

Adopt the third option, subject to acceptance. The following is the proposed
long-term policy; none of these target guarantees is implemented by this ADR.

### Scope and ownership

The reusable product rule separates repository documentation, local work
artifacts and runner evidence. Repository visibility remains the project
owner's choice: Git-tracked client documentation is not automatically public.
The public-distribution rules below apply to Banzai's public source and to
explicit public exports; they do not publish an adopted project's documents.

| Project and execution mode | Repository documentation | Local work | Runner state |
| --- | --- | --- | --- |
| Banzai source, plugin only | Root `documentation/`; shipped `plugins/banzai/` content remains product source | Root `.banzai/work/<work-id>/` | Not required |
| Banzai source, orchestrator | Same repository documentation | Same root work store | Root `.banzai/runs/<run-id>/` |
| Home project, plugin only | That project's `documentation/`, with its chosen Git visibility | That project's `.banzai/work/<work-id>/` | Not required |
| Home project, orchestrator | Same project documentation | Same project work store | That project's `.banzai/runs/<run-id>/` |
| Client project, plugin only | Client-owned `documentation/`, under the client's access policy | That client's project-local `.banzai/work/<work-id>/` | Not required |
| Client project, orchestrator | Same client documentation | Same client work store | That client's project-local `.banzai/runs/<run-id>/` |

No scenario stores work in an installed plugin cache or in the Banzai source
checkout merely because Banzai supplied the skill. The proposed
`.banzai/artifacts.json` is common portable layout configuration;
`.banzai/config.json` remains runner configuration and is not required by
standalone skills. No new global work registry or centralized client store is
introduced. Worktree discovery reuses the recognized checkout root.

Archive custody, access and retention belong to the project owner. The
retention durations and public-release checks below are Banzai source-project
policy and suggested defaults for others, not mandatory client retention terms.
Client transfers use a client-approved destination. Local work does not require
an archive account or network access; a verified backup is required before
removing the last working copy.

### 1. Classify by purpose, not file extension or author

| Class | Examples | Canonical location and publication rule |
| --- | --- | --- |
| Public product and maintenance documentation | Installation, CLI/configuration contracts, architecture, security/contribution/release policies, maintained examples, current manifest/module reference | Tracked source tree. Public builds and contributions must be possible from this material. |
| Public architecture decisions | Proposed, accepted, rejected, superseded and deprecated ADRs relevant to this project | `documentation/decisions/`, including stable IDs and lifecycle. Keep rationale and constraints; do not create an ADR for routine mechanics. |
| Private workflow evidence | Work records, descriptions, plans, approvals, completion records, implementation/test reports, review iterations, fix reports and detailed verification | Local ignored workspace plus a durable private archive. Public only through deliberate promotion. |
| Private execution diagnostics | Raw process streams, attempt candidates, traces and session/context observations | Existing run-owned storage and its access controls. Never automatically include in public exports or CI output. |
| Selected public evidence | A reusable worked example, benchmark protocol, curated case study or concise release assurance summary | Explicitly selected public documentation with purpose, limitations and provenance appropriate for public readers. No mandatory per-task publication. |

Keep legal files, licenses, third-party notices, shipped plugin templates,
contracts, policies and runtime assets as product source. Files under
`plugins/banzai/documentation/` are packaged product content; a root
documentation cleanup must not classify them as development waste.

Keep reusable fixtures and evaluation protocols required by public tests.
Relocate them to maintained test/example surfaces when an old feature folder
is archived. Do not make CI depend on private archive access.

Maintained product requirements and externally applicable contracts remain
repository documentation. A per-work `description.md` is private evidence by
default; its filename does not justify hiding a product contract needed by
contributors or the client. Classification follows purpose and audience.

### 2. Separate storage from authority

Use an ignored `.banzai/work/<work-id>/` workspace for new private workflow
artifacts. Preserve `.banzai/runs/<run-id>/` for runner-owned execution state.
Work identity must distinguish repeated work with the same slug and work in
different checkouts. An explicit run-to-work binding prevents accidental reuse.

A small tracked `.banzai/artifacts.json` declaration is the common storage
policy input for standalone skills and the orchestrator. It contains a schema
identity and portable layout selection, never credentials, private archive
URLs, absolute machine paths, evidence content or a second lifecycle ledger.
Define its exact schema in the subsequent strict specification. There must be
one layout authority, not competing settings in skills and runner config.

Own the reusable storage/classification rules once in a sixth installed policy,
`plugins/banzai/policies/artifact-storage.md`. Resolve it relative to the
installed skill under the existing policy-source convention. Require it before
artifact discovery or writing in `feature-description`, `architecture-decision`,
`development-plan`, `code-writing`, `test-writing`, `feature-review`,
`feature-status`, `feature`, `quick-fix` and `project-manifest`. Status remains
read-only. The supervisor consumes the declared control capabilities and
runner status; it does not implement a separate storage resolver. Preserve
the existing five policies and their authority; amend only enumerated path,
report-reference and delivery projections needed by this decision.

The deterministic local storage mechanism is shipped with the plugin so that
standalone use has no dependency on installing the npm CLI. The orchestrator
must reuse its semantics, with parity checks across both distributions. Define
the exact helper interface, schema versions and physical work-binding filename
in the approved implementation specification, not by inferring them from
examples or from the current package version.

Provide an explicit legacy layout for existing `documentation/` artifacts.
Absence of `.banzai/` or the declaration alone is not evidence of a legacy
layout and must not send a new project back to public workflow reports. Resolve
existing work from its recorded binding first, then the project declaration.
Without either, distinguish recognized Banzai work from ordinary documentation
using bounded discovery; unreadable or conflicting evidence is not absence.
Existing work retains its original paths and moves only through a reviewed
migration. Source-repository work uses the same declaration without requiring
a full orchestrator configuration or adopting its own bootstrap templates.

When recognized legacy work exists without a declaration, preserve the legacy
project default until an explicit storage migration selects private storage.
Starting another task is not permission to migrate the project. Do not
classify an ordinary `documentation/` directory as Banzai legacy work.

For a project with no existing managed work or storage declaration, initialize
private storage as part of authorized project setup or the first authorized
artifact-writing operation after normal project prerequisites are satisfied.
Create `.banzai/` and the declaration if absent, preserve existing contents,
establish effective Git exclusions for private work, and create the selected
work directory only when needed. The declaration is intended for version
control; initialization never stages, commits or pushes it automatically.
No manual folder creation, orchestrator installation or `banzai init` is needed.

Installing/loading the plugin, asking a question, inspecting status or another
read-only operation must not initialize storage. A completely unadopted project
still follows the existing manifest/setup prerequisites; storage initialization
does not bypass instruction-layout migration or human decision gates.

Initialization must be idempotent and safe to retry after partial failure or
concurrent first use. Establish and verify ignore coverage before creating
private evidence, without overwriting unrelated ignore rules. Detect broad
existing exclusions that also hide the portable declaration and report the
needed narrow adjustment rather than force-adding it. A file/symlink where a
directory is expected, denied writes, unsupported configuration or conflicting
work evidence produces an actionable diagnostic, never an automatic fallback
to `documentation/`. Existing private work with a missing declaration requires
binding recovery, not a new workspace or a guessed layout.

Standalone Codex/Claude Code skills are a first-class consumer. Storage
resolution must work with the installed plugin alone, without `banzai run`,
an installed orchestrator CLI, `.banzai/config.json` or a runner-owned active
run. A declaration does not redirect filesystem writes by itself: each
artifact-producing or artifact-reading skill must resolve it before using a
path. Supply deterministic resolution through the plugin's supported local
mechanism and validate parity with the runner; prose-only path substitution
is insufficient as the implementation's sole compatibility evidence.

For standalone work, persist a local work identity and its layout binding
independently of runner state. Accept an explicit existing work path/identity
for handoff between clients and sessions; never infer the selected work from
one global latest-work pointer when multiple work items exist. Ambiguity needs
selection, not a new duplicate work directory. Detect conflicting writes to
the same work item without blocking unrelated work items.

Resolve project-relative paths against the recognized project root, including
when a session starts in a nested directory or a separate worktree. Explicitly
read required ignored artifacts by their resolved paths; Git-aware search
results are not an inventory of the private work store. Missing evidence must
not be mistaken for absence of prior work or authorization to regenerate it.

Standalone approval and review retain their existing skill/human semantics;
they do not acquire runner-owned checkpoints, structured completion authority
or mechanically enforced review independence merely by changing folders.
Record only actual human decisions through the supported standalone workflow.
Archive the records needed for a fresh session to recover context, without
claiming that a summary recreates an absent approval.

Resolve paths once when work starts and persist the binding. Resume follows
that binding, not a later project default. Old runs retain original paths,
snapshots and semantics; never silently move active evidence or rewrite a
stored approval to match a new path.

Approved bytes, actor decisions, finding IDs, task order, run state and
integrity checks retain their existing authority. Private does not mean
optional. A public summary or archive receipt never establishes completion,
approval, coverage or correctness. The runner's use of “publish review
artifact” means canonicalization within the workflow, not internet publication.

### 3. Make private evidence a verified filesystem boundary

Track the exact authorized private artifact surface independently of Git's
tracked/untracked enumeration. Include additions, modifications and deletions
needed for phase-scope, approval, review and recovery checks. Preserve the
separation between builder and reviewer sessions and their write permissions.

The private work root is not a blanket write grant to `.banzai/`. Models must
not edit run state, decisions, checkpoints, another work item or approval
records merely because reports moved there. Approved files remain immutable;
new review candidates remain attempt-owned until validated canonicalization.

Permit only the precisely authorized work reports as completion references
where appropriate. Do not remove the general ban on arbitrary `.banzai` files
as evidence. Validate regular files, canonical containment, ancestor symlinks,
path traversal, identity collisions and export/restore destinations.
Restore must not overwrite existing work without an explicit conflict decision.

Use private local permissions consistent with existing run storage. Ignoring
files prevents ordinary accidental staging; it is neither an access-control
mechanism nor protection from explicit force-add or third-party synchronization.
Evidence may still be supplied to configured model clients as required by the
approved workflow; private here means excluded from public source distribution,
not a promise that no selected model provider processes it.

Version changed persistence, review-snapshot or capability semantics explicitly
where necessary. Do not reinterpret an existing schema version as supporting
new evidence coverage. Preserve frozen evaluation contracts and truthful
legacy/unknown evidence states.

New tooling must check layout/resolver compatibility before creating private
work. Older installed skills that do not understand this policy are unsupported
for that work and must be updated before adoption; do not claim this ADR can
make already-released tools enforce a configuration they never recognized.

Applicable Security Assurance exposures and required controls:

| Exposure | Enforcement boundary | Observable requirement |
| --- | --- | --- |
| 1: input selects filesystem paths | Work resolver and archive restore | Reject traversal, ancestor-symlink escape, conflicting identities and unsafe destinations before writing. |
| 2: changed artifact write grants | Phase scope and client hook integration | Authorize exact work artifacts without granting access to run state or another work item; preserve approved bytes. |
| 4/5: retained private or client material crosses a boundary | Project-bound export and archive custody | Export only the explicitly selected project/work bundle to the authorized destination; no global client store or automatic upload. |
| 7: publication, overwrite or removal | Publication check, conflict-safe restore and reviewed migration inventory | Reject excluded public payloads; never overwrite existing evidence or remove its last copy implicitly. |

### 4. Preserve originals and minimize duplicate authorship

Keep strict descriptions, plans, required reports and independent review
iterations when their existing authority requires them. Archive completed
iterations instead of overwriting them with a final narrative.

For lite work, maintain one work record. For routine fixes, prefer one bounded
entry in that work record or the final chat summary when no durable record is
required. Keep separate records for decisions, material exceptions and review
evidence when their semantics require one. Do not generate a new report merely
to repeat that another report was updated.

Where structured runner evidence already owns a result, render or reference it;
do not ask multiple model-authored reports to independently restate command
totals. Changes to today's reporting requirements must be explicit in the
implementing specification and policies; this proposal does not waive them
before that change ships. A missing evidence source stays missing.

Update public documentation when behavior changes, at the existing review
boundary. State the outcome once in the appropriate guide or release note;
avoid publishing intermediate diagnostics. Do not turn every private work
item into a permanent public summary file.

### 5. Archive before removing the last working copy

Maintainers own a separate private archive with named custodians and team
access. Keep a local working copy and at least one verified off-machine copy
before removing evidence from its original location. A same-disk archive or
an ignored directory alone is insufficient. The backend is an operational
choice; no cloud provider, service credential, SDK or automatic upload is
required by Banzai. Backend selection and upload authorization precede transfer.

An archive binds repository/work/run identity, source commit, original logical
paths, file sizes, content hashes and retained decision/approval provenance.
Keep original relative layout within each bundle so references remain
interpretable. Restoration checks hashes and links before offering evidence to
a workflow. Hashes establish byte identity, not the truth of a report or
authenticity of a human approval; preserve existing approval provenance.

Archive originals losslessly, including retained structured evidence required
by snapshots, completion, triage and recovery. Keep public projections separate
and labeled. Do not edit accepted ADR bodies or approved plan bytes to repair
publication links. Preserve stable public paths for retained ADRs; resolve
historical private references through one curated public archive notice and
private mapping, not a stub file per removed report. Public instructions may
not depend on those omitted records.

| Retention class | Minimum policy |
| --- | --- |
| Active, blocked, under review, or explicitly pinned work | Retain all evidence needed for continuation; no expiry while pinned. |
| Approved decisions and evidence needed to explain supported behavior | Retain originals while behavior is supported and for at least 24 months after retirement; public ADR lifecycle remains available. |
| Other completed or cancelled workflow bundles | Retain at least 24 months after closure; extend when another retained record depends on them. |
| Release source snapshots and migration provenance | Retain for the lifetime of the project. |
| Unreferenced raw process logs | Eligible for removal 30 days after closure. |
| Unreferenced invalid candidates and diagnostic traces | Eligible for removal 90 days after closure. |

These are proposed project defaults, not claims about external obligations.
Dependency retention wins over shorter timers: never remove evidence referenced
by a retained approval, checkpoint, review snapshot or recovery contract.
Credentials must not be deliberately archived; handle a discovered exposure
separately while retaining an appropriately restricted incident record.

Initial implementation provides inventory/export/restore and manual pruning
only. No automatic deletion, scheduled upload or new daemon. Review archive
capacity and eligibility quarterly; test restoration at migration and at least
annually. A retention inventory is sufficient; no recurring prose report is
required when there is no material change.

### 6. Enforce publication at existing delivery boundaries

Define a public distribution allowlist and excluded artifact classes. Apply
the same repository-owned check to the candidate Git tree, PR/CI verification,
release checks, source archives and actual npm/plugin package contents.
Check tracked files as well as ignored/untracked files when assembling exports;
`.gitignore` alone cannot reject a force-added report.

An unknown documentation path needs classification. A deliberate public example
needs a stated audience and a reviewed entry in the publication inventory.
Avoid an unrestricted exception for all of `documentation/` or all Markdown.
Use existing code review/merge/release approval to review promotion; do not add
a mandatory approval dialog to every agent step. Local staging checks are
prevention; public CI may detect a leak only after a branch has been pushed.

Scan selected public content for private identifiers and sensitive material,
including embedded source maps and generated assets. Describe the scan's scope
and limitations. A path allowlist or bounded scanner is not proof that no
sensitive content exists. Do not echo rejected private content into public CI
logs; report safe paths and rule identifiers.

Public clones must install, build, test, validate releases and support normal
contributions without private evidence or archive credentials. Public reviewers
receive sufficient requirements and rationale in maintained docs/ADRs and PR
context. If a private requirement changes a public obligation, publish the
necessary sanitized contract before expecting outside contributors to follow it.

### 7. Keep release identity separate from history cleanup

Use a new, unused forward release version for changed published bytes. Preserve
the root version authority and normal synchronization mechanism. Do not reset
versions or imply an old package was built from rewritten source.

Selecting storage policy does not select a Git-history rewrite, archive
provider, public ref deletion list or release version. Those independent
operational choices remain in the [migration roadmap](../artifact-policy-migration.md)
and its later concrete cutover manifest. They are not prerequisites for
accepting the local artifact architecture and are not authorized by acceptance.

Retain original release provenance and respect immutable published identities.
Do not turn one-time cleanup into a recurring source export workflow. Public
ref cleanup and complete erasure of previously distributed copies are different
claims; delivery and retention evidence must state the actual scope.

## Consequences

- Public growth follows meaningful product documentation and decisions rather
  than the number of agent attempts. Private evidence remains complete.
- A fresh clone is sufficient for product maintenance, but resuming a private
  internal task requires its verified work bundle and compatible source state.
- Archive custody and restoration become real maintenance responsibilities.
  Storage relocation cannot be reduced to a documentation-only rename.
- Accepted ADRs retain their bodies. A migration reference index can label
  historical omitted targets, but cannot hide missing current public guidance.
- Layout/integrity compatibility and artifact-generating skills must ship
  together. Do not enable private storage for production workflows before the
  required verification is complete.

## Compliance and Confirmation

This is a Proposed architecture, not an implementation verdict. The following
are requirements for confirming implementation after the ADR and strict bundle
are approved; they are not claims about the current checkout.

| Guarantee | Required confirmation |
| --- | --- |
| Six project/execution scenarios share the intended boundaries | Disposable source/home/client layouts in standalone and runner modes; no cross-project or plugin-cache writes. |
| Standalone first use works without `.banzai` or the npm CLI | Actual installed-plugin checks in Codex and Claude Code after normal project prerequisites; read-only invocations remain non-mutating. |
| Selection survives session/client changes | Reopen an explicit work identity, resolve multiple work items without guessing and reject a conflicting writer. |
| Git-ignore rules do not weaken integrity | Tamper, missing-file and unauthorized-write cases in approval, review, completion and recovery checks. |
| Legacy work retains its authority | Byte-preserved legacy fixtures, original paths and source baseline; no reinterpretation through current defaults. |
| Private evidence is recoverable | Bundle/hash verification and restore with missing-dependency and overwrite-conflict cases. |
| Repository maintenance needs no private credentials | Fresh public-only checkout passes the existing release gate; retained tests/docs have no hidden dependency. |
| Internal artifacts stay out of distributions | Tracked/staged and forced-add cases plus inspection of actual source, plugin and npm package payloads. |

Reuse existing assurance owners and lifecycle tests as described in the
roadmap. Fixture-only evidence cannot establish real installed-client behavior;
unavailable evidence remains explicit. Archive portability permits inspection
in another checkout, not resuming an old run against an unrelated/rebased HEAD.

No correctness or privacy claim follows from reducing the number of files.
No exact final file-count target replaces classification and dependency review.

## Lifecycle Links

- Partially superseded by [ADR-0054](./0054-git-visible-work-artifacts.md),
  accepted 2026-10-13: new work uses Git-visible documents with fixed paths;
  layout selection, the mandatory standalone storage protocol and private
  archival requirements for new documents are retired. Historical custody,
  execution-state privacy and workflow authority remain. Implementation is Planned.

- Amended by [ADR-0045](./0045-guided-verification-setup.md), accepted
  2026-09-14: state-6/binding-mode compatibility and private runner config
  transaction evidence. Preserve historical bindings and exact model-writable
  roles. Implementation of this amendment is Planned.

Supersedes: None in full. Acceptance would establish these bounded amendments:

| Existing authority | Amendment | Preserved authority |
| --- | --- | --- |
| ADR-0036: five installed policies and their projections | Add `artifact-storage.md` and its stated consumers; replace fixed storage references for the new layout | Existing five policy meanings, source resolution, instruction migration, human gates and source-repository exception |
| ADR-0017/0025: completion evidence and report projections | Resolve exact authorized reports under the selected private layout | Task identity/order, canonical ledger, projection parity, approval binding and refresh restrictions |
| ADR-0019/0037: review artifact publication | Resolve the canonical work artifact through the persisted binding | Attempt ownership, immutable snapshots, reviewer acknowledgment, independent review and validated atomic publication |
| ADR-0023/0038: recovery and approved plan authority | Identify the selected storage boundary in new compatible evidence | Existing checkpoints and approved bytes remain immutable; no approval transfer to changed paths or source |
| ADR-0040: adoption and setup | Add storage initialization to authorized setup/first writing work | Existing guidance preflight, read-only diagnostics, source exception, ownership, unfinished-run protection and no automatic task submission |

Do not edit these accepted ADR bodies. Record precise schema/capability changes
in approved implementation requirements before code work. Adding remote
synchronization, automatic deletion, new approval authority or incompatible
frozen evaluation semantics would require a separate decision; this ADR does
not authorize those through an implementation detail.

Superseded by: None.
