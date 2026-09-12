# Artifact Policy Migration Roadmap

Status: Operational roadmap; local implementation approved and verification in progress.
Last aligned with the Accepted ADR: 2026-09-11.

Accepted policy: [ADR 0041](decisions/0041-artifact-retention-and-publication-boundary.md).
The approved requirements and development plan are retained as
[private work history](historical-references.md).

The owner accepted ADR-0041 and approved the implementation bundle and amendment A1 on 2026-09-11. Its 12 tasks
cover local implementation, offline tools, prevention and non-destructive
migration preparation. This roadmap retains the broader operational sequencing
and cutover runbook; it is not additional implicit code or delivery authority.
Installed-client validation, off-machine custody, historical removal and remote
publication remain later concrete operations. Do not create a report for each
roadmap step.

## Intended Outcome

1. Public source contains the product, current maintenance guidance, decisions
   and deliberately selected examples.
2. Internal work artifacts remain durable, accessible and authoritative without
   being automatically tracked or published.
3. Banzai enforces this separation in both standalone and orchestrated work.
4. Existing work, releases and approval evidence are not silently reinterpreted.
5. Optional replacement of public history happens once, after prevention ships.

## Evidence and Current Limits

Initial inspection on 2026-09-10 used local HEAD
`6e330ceebac0954d368da12c767971fbb7a5cd8f` with existing tracked modifications
and untracked work, including project-adoption setup. On 2026-09-11, the
pre-revision worktree was clean at
`bacb51f49264aad1b1f26e94e7b7c784073d3cee`; the earlier dirty-worktree observation
is historical. Local version mirrors report `2.3.0`, not registry publication
evidence. Refresh the candidate inventory before implementation or migration;
do not reset or blanket-stage the active checkout.

The initial inventory was 304 tracked documentation files plus 22 untracked
files before this proposal. The 2026-09-11 inventory is 328 documentation files
among 601 tracked files. The final inventory must classify each file;
folder-level totals are not a deletion list.

| Current evidence | Migration implication |
| --- | --- |
| Root `.gitignore` ignores run state but not workflow reports | Prevent new tracking as well as migrate existing tracked files. |
| `git.ts` enumerates Git diffs and non-ignored untracked files | Add explicit integrity coverage for authorized private work artifacts. |
| `workflow.ts`, `prompts.ts`, `validation.ts` constrain planning to `documentation/` | Update scope, repair/retry, and persistence validation together. |
| `review-artifact.ts` constructs `documentation/features/<slug>/review-N.md` | Resolve canonical review paths from the persisted work binding. |
| `plan-task-completion.ts` forbids `.banzai` evidence paths | Add only narrowly authorized report references; preserve other exclusions. |
| Packaged skills and `spec-gate.cjs` assume the current layout | Standalone, runner and hook behavior need a coordinated transition. |
| Release validation depends on public docs and ADR indexes | Preserve those contracts and repair dependencies before removing history. |
| CLI package `files` includes `dist/`, license and notice; npm also includes mandatory package files | Root documentation is not explicitly packaged, but inspect actual tarballs and embedded map contents before making an exposure claim. |
| `.github/workflows/publish.yml` runs when a release is published and skips an existing npm version | Release recreation can trigger automation; a skipped publication does not establish that rewritten source matches old package bytes. |

Live repository settings, branch protections, ref inventory, immutable-release
flags and registry versions were not verified in this task. `gh` was unavailable
and direct API calls from the shell failed DNS resolution. Official provider
policies were verified through web access; execution requires fresh live state.

## Phase 0 — Agree Policy and Freeze the Migration Boundary

Owner: repository owner, with maintainer preparation.

- ADR 0041 acceptance and strict implementation bundle approval were recorded
  on 2026-09-11. Amendment A1 was separately approved before dependent work.
- Confirm whether the eventual cutover is current-tree cleanup only or the
  proposed one-time clean public snapshot across controlled refs. The owner's
  willingness to force-replace a branch makes the latter feasible, but does
  not select the exact ref deletion/replacement list.
- Name the private archive custodian and choose an off-machine destination
  with access restricted to the intended team. Banzai remains backend-neutral.
- Inventory tracked, staged, unstaged, untracked and needed ignored evidence;
  source branches/tags; active or blocked runs; and ongoing contributor work.
- Select the actual candidate only after unrelated work is completed or safely
  isolated. Record its commit, file inventory and any intentional uncommitted
  additions; no historical report is deleted in this phase.

Exit: accepted policy, bounded candidate scope, archive ownership, and a list of
external operations still requiring the owner's execution decision. These are
recorded in the migration inventory, not new application workflow gates.

## Phase 1 — Establish Inventory, Archive and Public Classification

Owner: maintainer. Depends on Phase 0 policy acceptance.

- Create a machine-readable inventory covering every current documentation
  file: class, source identity, dependencies, destination, retention/pin and
  disposition. Store private details privately.
- Keep root guides, release instructions, ADR records, legal material,
  supported protocols, policy docs and public test fixtures. Check imports,
  Markdown links, validators, test file reads, packaging and runtime resource
  paths, not only links in `documentation/README.md`.
- Classify `changes/`, `features/` and `development-plans/` records individually.
  Default internal histories to private archive; move maintained examples or
  fixtures to their enduring public location before archiving the enclosing
  feature. Consolidate current behavior into its appropriate public guide.
- Build a verified private backup of source history plus worktree evidence.
  A Git bundle alone omits uncommitted/untracked/ignored files; preserve those
  separately as needed. Exclude credentials and avoid indiscriminate home or
  authentication-directory backups.
- Record hashes and original paths; copy off-machine with explicitly authorized
  access. Restore a representative approved strict bundle and a cancelled or
  failed bundle into a disposable private location and verify all retained
  dependency references. Confirm a full inventory/hash comparison as well.

Exit: every existing file has a disposition, public dependencies are understood,
and restorable private originals exist. No removal based on a filename glob.

## Phase 2 — Specify and Implement Storage-Aware Workflow Integrity

Owner: implementation agent/maintainer under an approved strict bundle.
Depends on Phase 0; archive tooling preparation can proceed alongside Phase 1.

The approved private strict bundle specifies the following change areas. The table below
remains a roadmap summary; the exact approved plan owns implementation scope:

| Work item | Affected surfaces | Required outcome / evidence |
| --- | --- | --- |
| Shared layout declaration and work identity | Config/storage parsing, `types.ts`, validation, adoption/setup, standalone guidance | New projects initialize private storage during authorized setup/first write; absence of `.banzai` does not imply legacy layout. Existing work keeps its binding; malformed/unsupported declarations fail with a bounded diagnostic. Slug reuse cannot alias another work item. |
| First-use initialization | Plugin-local storage resolution, project-manifest bootstrap, ignore handling and setup integration | Create only missing storage entries after existing project prerequisites pass; verify private exclusions before writing evidence. Preserve unrelated files, support safe retry/concurrent first use, and never stage/commit or initialize during read-only work. |
| Persisted binding and path resolution | `store.ts`, `workflow.ts`, report/review path construction, recovery readers | Run layout is fixed at creation; changing project defaults does not relocate old work. Existing approval bytes and identities survive unchanged. |
| Private artifact integrity | `git.ts`, approval checks, phase scope, `review-snapshot.ts`, review application | Snapshot exact authorized ignored artifacts without scanning all `.banzai`. Detect deletion, addition and tampering. Preserve source baseline semantics and review independence. |
| Completion and security boundaries | `plan-task-completion.ts`, candidate publication, filesystem validation | Required private reports can serve their exact existing evidence role; arbitrary run state cannot. Traversal, symlink escape, overwrite and cross-work references fail safely. |
| Contracts and compatibility | Persisted schemas, snapshot formats, capabilities and adapters as affected | Use new versions where semantics change; read legacy records under their original rules. New tooling rejects unsupported layout/resolver combinations; older installed skills require update before private-work adoption. |
| Archive/export/restore | Existing CLI/storage seams and private bundle manifest | Dry-run inventory, deterministic content identities, conflict-safe restore, completeness verification and explicit missing-evidence status. No implicit upload or automatic prune. |

The strict plan pins the declaration, work binding, local helper interface,
archive format and affected version transitions. Review those exact bytes at
the implementation gate. This table is not permission to add an arbitrary
artifact platform or to change frozen evaluation exports.

Preserve existing failure semantics: a missing private authority blocks the
dependent phase; it does not recreate approval from a public summary. Restoring
an archive with matching bytes but a different source baseline is historical
inspection, not proof that an old run is resumable against rewritten HEAD.

Exit: focused lifecycle/integrity tests pass, legacy fixture bytes remain
unchanged, and the new layout works in disposable projects. Do not yet move an
active real workflow into the new layout.

## Phase 3 — Align Skills, Hooks and Report Production

Owner: plugin/runner maintainer. Depends on Phase 2 contracts.

- Deliver the sixth policy `plugins/banzai/policies/artifact-storage.md` with
  the consumer list in ADR 0041 and keep role-specific instructions short.
  Update the policy-delivery matrix and validators while preserving the
  existing five policy meanings and ADR-0036's source-resolution rules. Ship
  the deterministic local mechanism in the plugin; verify runner parity.
- Align feature description, development plan, implementation, tests, review,
  fixes, lite work, status, project manifest and supervisor references. Cover
  standalone use without an orchestrator configuration.
- Make standalone resolution available with the installed plugin alone, without
  the orchestrator CLI or `banzai run`. Persist work identity/layout outside
  runner state; support explicit handoff by work path between clients and fresh
  sessions. Detect ambiguous selection and conflicting writes instead of
  choosing the latest matching slug. Read required ignored files directly.
- Update `prompts.ts`, discovery/recovery prompts and `spec-gate.cjs`. Planning
  gets the authorized work-artifact surface; reviewers retain read-only
  semantics; hooks do not grant writes to all run state.
- Replace duplicate model-authored verification totals with canonical evidence
  references or deterministic projections where the current owner supports it.
  Keep required task-ledger projections, review iterations and meaningful
  limitations. Define the precise reduced report rule before changing it.
- Publish a short contributor explanation: private work is recoverable through
  a verified bundle; public documentation contains all externally applicable
  contracts; public contribution does not require access to internal history.
- Add source-repository guidance and layout selection only after the installed
  plugin/runner version used here understands them. Root template exceptions
  remain intact; do not bootstrap over this repository's instructions.

Exit: deterministic fixtures cover strict approval, accepted-finding fix,
re-review, interruption/recovery and lite work in both layouts, plus standalone
path/hook behavior. Perform a separately authorized real-client smoke before
claiming installed Codex/Claude end-to-end behavior; fixture evidence alone
does not establish it.

For that standalone smoke, use disposable projects and the actual installed
plugin in each client: start lite and strict work, continue the same work in a
fresh session and in the other client, invoke review/fix, and inspect the exact
resulting paths. Repeat path resolution from a nested directory and a separate
worktree; exercise missing configuration, malformed configuration, two work
items and a conflicting writer. Confirm normal Git staging excludes private
files, public ADR/manifest updates retain their intended paths, and no stage
requires runner state. Report unavailable client evidence explicitly. Do not
describe standalone prompt/hook behavior as equivalent to runner enforcement.

First-use acceptance also covers: no `.banzai` directory; an existing directory
used only for runner configuration; an adopted project with no prior work;
ordinary non-Banzai documentation; recognized legacy work; private work whose
declaration is missing; and a conflicting file, symlink or read-only target.
Verify that plugin loading/status leave the tree unchanged, approved setup or
first artifact write creates the private layout without orchestrator commands,
repeat/concurrent initialization preserves user files, and effective ignore
rules protect evidence while leaving the declaration eligible for tracking.
Treat an existing broad `.banzai/` ignore rule as a configuration conflict to
resolve explicitly, not a reason to force-add or silently omit the declaration.

## Phase 4 — Enforce Public Distribution and Curate the Candidate

Owner: release maintainer. Depends on Phases 1–3.

- Add a repository-owned publication inventory/check for public documentation
  and package surfaces. Reject excluded workflow artifacts even when tracked
  or force-added. Explicit examples remain allowed by reviewed classification.
- Reuse that check in the existing `release:check` and GitHub verification flow.
  Offer a local staged-tree check; document that CI cannot retroactively prevent
  exposure on an already-pushed branch. No automatically installed Git hooks.
- Inspect actual npm tarball, plugin distribution and source archive entries,
  including bundled source maps. Use the same byte identities for the candidate
  that will be delivered. Fail diagnostics must not disclose private contents.
- Apply the reviewed migration inventory in an isolated candidate checkout.
  Retain public ADR bodies and IDs; repair editable indexes and current guides.
  Use one explicit historical-reference mapping for immutable ADR references
  to archived evidence. Do not exempt missing current API/docs/test dependencies.
- Remove archived histories from the candidate Git tree only after verified
  backup. Add ignore rules for new private storage and the guard against
  reintroduced legacy artifact directories. Do not bulk remove all Markdown.
- Update `PROJECT_MANIFEST.md` and `MODULES.md` to implemented facts only after
  validation. Record migration rationale here/ADR, not in the current-state
  manifest. Normal work must no longer regenerate public review/fix reports.

Exit: a fresh public-only clone with no private store or archive credentials
passes `npm ci` and `npm run release:check`; publication checks and package
inspection pass. No live model invocation is needed for ordinary public CI.

## Phase 5 — Optional One-Time Public History Cutover

Owner: repository owner. Depends on Phase 4 and a concrete cutover approval.

Recommended path given the owner's offered flexibility: build one clean root
snapshot from the verified candidate, retain the full prior source/evidence
privately, then continue ordinary development on the public repository. A
filtered-history migration remains possible if preserving public commit
continuity is preferred. Do not repeatedly regenerate public history.

Before execution, produce one reviewable cutover manifest containing:

- the exact verified old remote OID for each affected branch/tag;
- the replacement commit/ref or explicit removal for each ref;
- default-branch/ruleset changes, release IDs and asset dispositions;
- candidate hashes, private backup/restore receipt and old-to-new provenance;
- the new unused version, tag, expected package bytes and publishing sequence;
- a list of retained public historical surfaces and unavoidable limitations.

Inventory all controlled refs. If an old tag or another public branch retains
excluded history, either retire it in the manifest or report it as retained
history; never call a main-only replacement a complete controlled-ref cleanup.
Inspect release immutability before including any tag deletion/replacement.

Execution order:

1. Freeze writes and coordinate the cutover window. Verify current remote OIDs
   still equal the approved manifest. Protect against unexpected publication
   from release events using an explicitly reviewed temporary workflow or
   environment hold, and record the restoration step.
2. Confirm backup and candidate byte identities. Replace only listed branch
   refs with explicit expected-OID leases. Handle listed tag/ref removals
   individually under their protection rules; avoid a blanket mirror push.
3. Retire only listed old releases/assets/tags, subject to provider rules.
   Never reuse old immutable release tags. Clearly distinguish removed release
   pages from still-existing historical npm packages and attestations.
4. Restore protections and publication settings, then create a fresh public
   clone. Verify refs, absence of excluded tracked paths, build/release checks,
   and that an ordinary new work item cannot repopulate public artifacts.
5. Have collaborators re-clone or transfer selected clean patches. Merging an
   old branch can reconnect the removed history. Preserve unfinished work in
   the private backup until its transfer is verified.
6. Document residual copies such as forks, pull-request refs and caches. A
   clean controlled-ref set is not universal data erasure. Sensitive-data
   removal, if actually needed, is a separate scoped incident procedure.

Before remote mutation, rollback means discarding the isolated candidate.
After publication, prefer a corrected clean commit/forward release. Restoring
old refs could re-expose removed artifacts and requires an explicit owner
decision; it is not an automatic rollback step. Retain old-to-new identities
privately for recovery and provenance explanation.

Exit: live controlled refs match the manifest, protections are restored,
fresh-clone checks pass, collaborators have a safe continuation path, and
remaining historical exposure is explicitly stated.

## Phase 6 — Publish a New Release and Verify Delivery

Owner: release maintainer with the owner's delivery authorization.

- Refresh the registry version list and GitHub release state. Select a new,
  unused forward SemVer version based on the actual compatibility change;
  use `npm run version:set -- <new-version>`, rebuild and run `release:check`.
  `2.3.0` in this checkout is not evidence that it is available for publication.
- Establish the versioned, checked candidate before signing/tagging. Do not
  mutate the candidate after approval; a version/build change needs refreshed
  candidate checks and hashes. This preparation precedes Phase 5's final
  cutover manifest when the release accompanies that cutover.
- Publish from the new source identity using the existing trusted publishing
  workflow. Recreating a GitHub release does not replace a registry tarball.
  Do not unpublish an unaffected package for documentation housekeeping.
- Verify registry version, dist-tag, tarball integrity, source/provenance
  relationship where available, clean installation and GitHub asset contents.
  Record verified delivery facts in the existing publication record once.
- Verify plugin delivery separately; CLI npm publication does not update
  already-installed skills. Runner phase/guidance/policy and hook identities are
  compared separately from release labels. A confirmed mismatch refuses a model
  call before an attempt; missing evidence remains a reported limitation. Rebuild
  the runner from current source, update the plugin to the matching release, or
  explicitly select ambient mode (unverifiable). These remedies do not migrate
  work, alter bindings, waive report triggers or grant new artifact writes.
  Use the supported plugin update path and restart
  sessions as required before declaring local adoption complete.

The npm rule is permanent per published name/version; unpublishing cannot free
that identity. GitHub immutable-release tags have their own reuse restriction.
See [npm policy](https://docs.npmjs.com/policies/unpublish/) and
[GitHub immutable releases](https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases).

Exit: local, hosted CI, registry and installed-client evidence are separately
recorded. Unknown or unavailable delivery evidence is not a successful release.

## Verification Matrix and Ongoing Success Criteria

| Guarantee | Proportionate evidence owner |
| --- | --- |
| Old runs retain meaning and can resume with original source/evidence | Legacy persisted fixtures and existing workflow recovery tests. |
| Ignored artifacts remain inside approval/review integrity | Focused workflow/snapshot tests with tampered, missing and unauthorized private files. |
| Work identity and path containment prevent cross-work access | Storage/path-boundary tests, including ancestor symlink and restore collision cases. |
| Retained evidence survives archival | Full manifest/hash comparison plus restore of representative strict and failed/cancelled bundles. |
| Public maintenance works without private history | Fresh public-only checkout and the existing full release gate. |
| Internal reports cannot silently enter distributions | Tracked/index fixtures, forced-add case, actual source/plugin/npm archive inventory. |
| Human decisions and reviewer independence remain intact | Existing approval/triage, hook/permission and reviewer-session tests reused with both layouts. |
| Future artifact growth is bounded by useful public output | Representative strict/lite/fix work produces zero newly tracked internal reports; inspect a subsequent real release. |
| Destructive cutover affects only intended refs | Owner-reviewed ref manifest, expected-OID checks and post-cutover remote verification. |

Run focused tests during implementation and the existing full gate on the final
candidate. Do not add a test per policy sentence or repeat a full suite without
a changed candidate or unresolved concern. No new benchmark or reporting
dashboard is needed for this migration.

Quarterly maintenance reviews only exceptions, archive capacity and retention
eligibility. At least annual restore verification checks recoverability.
No recurring automation has been scheduled by this proposal.

## Approval and Scope Boundary

ADR acceptance selected policy on 2026-09-11. Approval of the linked strict
requirements/plan bundle will authorize its bounded code work. A concrete
reviewed cutover manifest authorizes
the listed external ref/release operations when the owner elects to execute
them. These decisions are not interchangeable and do not add a new per-task
Banzai lifecycle gate.

The preparation and 2026-09-11 revision performed documentation edits only;
neither executed the migration or any external delivery action. This statement
describes those preparation turns, not unrelated owner actions or intervening
repository commits.
