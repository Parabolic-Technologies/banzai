# Development Plan: Git-visible Work Artifacts

Slug: `git-visible-work-artifacts`

Status: Prepared for owner approval; implementation has not started.

- Requirements: [description.md](description.md), derived from the owner's
  accepted scope. Approval of this bundle binds these exact requirement bytes.
- Governing decision: accepted
  [ADR-0054](../../decisions/0054-git-visible-work-artifacts.md).
- Other binding decisions: ADR-0041 as partially superseded; ADR-0049,
  ADR-0040/0042 and ADR-0037/0038/0047 as amended by ADR-0054; unchanged
  ADR-0013/0014 (assurance and triage), ADR-0027 (security), ADR-0029 (import
  boundaries), ADR-0030/0050 (quality and design assessment), ADR-0033 (release
  identity), ADR-0044 (instruction baseline evolution) and ADR-0051 (digest
  acceptance). Their accepted records are linked
  from the [decision log](../../decisions/README.md).
- Current facts: [PROJECT_MANIFEST.md](../../../PROJECT_MANIFEST.md), sections
  2-6 and 8-10; [MODULES.md](../../../packages/orchestrator/MODULES.md), artifact
  storage, task verification, scope, review and completion entries.
- Inspected source baseline: `ead9f32`, with this chat's documentation changes.
  Revalidate affected owners against the implementation checkout before edits.

## Plan Authority

Applicable approved requirements, accepted ADR constraints, public and persisted
contracts, security and authorization boundaries, transaction and lifecycle
guarantees, compatibility, scope, and required verification evidence are binding.
Exact internal details remain binding when required by applicable authority or
concrete constraints; unlabelled explicit directives remain binding.

Only paragraphs or list items prefixed `Optional implementation guidance:` are
non-binding suggestions. A label covers that paragraph or list item, including
its nested content, and ends before the next sibling block. A different compliant
implementation within approved scope needs no reapproval, finding or deviation
report merely for differing from this guidance.

Guidance never overrides binding authority or expands scope. Resolve conflicts
and ambiguous commitments before dependent work; missing or ambiguous optionality
does not waive an explicit commitment.

## Technical Breakdown

### Current behavior and target

| Current implementation | Accepted target | Task owner |
| --- | --- | --- |
| Private/legacy declaration, UUID registration and claim-based Markdown writes | Fixed document paths; direct standalone authoring | T001, T005, T007 |
| Verification helper v2 requires a private bound `work.json` | Explicit document request; executor-owned local evidence | T002 |
| New state v8 creates private binding v2 through `createWork` | New state v9 records an execution-owned binding v3 to tracked documents | T003 |
| Workspace v2 inventories ignored work separately from Git | Workspace v3 accounts for selected documents exactly once | T004 |
| Snapshot v6/rendered review v7 depend on private binding v2 | Successor snapshot/review with unchanged independent-review and completion guarantees | T004 |
| Skills, setup and phase delivery instruct layout initialization | Shared fixed-path guidance and unchanged project prerequisites | T005 |
| Source publication requires per-document classification and forbids private work | Fixed new-work source subtree; private machine data and package exclusions remain | T006 |
| Artifact CLI/helper exposes layout, registration, writing and archive operations | Retired surface; only justified execution/read-only primitives remain | T007 |

The acceptance annotations on ADR-0047/0049 currently make `release:validate`
fail its retained-authority hash check. The accepted bodies are unchanged. T001
must register only the exact accepted lifecycle annotation images, conditional
on ADR-0054 being Accepted, using the existing finite-image mechanism in
`phase-resources-build.mjs`. Preserve the original instruction baseline and
recorded transition hashes; arbitrary metadata/body edits must still fail.
This is an identified implementation prerequisite, not permission to repin history.

### Scope, identity and continuation

The new document root is exactly `documentation/work/<slug>/`. Keep current
filenames: `description.md`, `plan.md`, `implementation-report.md`,
`test-report.md`, `work.md`, `change-report.md` and `review-N.md`. Preserve report
conditions; create no empty placeholders for inapplicable roles. Slugs use the
existing lowercase kebab-case validation and are unique within the repository.
Status/mode changes do not rename the directory.

An explicit existing work/document path is a continuation request. Use that
work's known locations and links; do not relocate it or manufacture a new
binding. A new-work request whose directory already exists must not overwrite
it or treat a matching slug as approval to resume it. Request explicit selection
or a distinct slug. Do not crawl the private work store to guess identity.

Existing documents, declarations, archives, run records and ignore rules remain
untouched by new-work setup except a specifically required narrow correction
that makes the new subtree visible. Existing declarations are inert for new
work, including malformed or unsupported declarations; do not parse them as a
new-work prerequisite. Retain old directory paths only as explicit inputs and
historical documentation, not as selectable new-work layouts.

For an explicitly selected older standalone document without a supported task
inventory, retain the applicable fresh-check skill authority. Do not rewrite
its plan or claim helper support. Historical runner execution remains unsupported
where current policy already rejects it; this plan adds no migration or resume
layer. Read-only decoders may preserve supported historical meaning.

### Ownership and structural assessment

The change separates document naming from execution state and removes a shared
subsystem with many consumers. That is the structural-assessment trigger.
Reuse search found `artifactRoles`, path/byte primitives, work claims and archive
dispatch in `plugins/banzai/lib/artifact-storage.mjs`; verification imports that
module directly, while the TypeScript facade also re-exports adoption and review
readers. Keeping this facade as a generalized storage router would retain the
responsibilities ADR-0054 removes.

| Responsibility | Disposition, owner and invariant |
| --- | --- |
| Fixed role paths and execution binding validation | Extract into `plugins/banzai/lib/work-documents.mjs` with a typed declaration and thin orchestrator projection. One shared owner derives new paths; no filesystem registration or layout dispatch. |
| Contained filesystem access and create-only/atomic writes | Extract the existing primitives into `plugins/banzai/lib/project-files.mjs` with types. Reuse their bounded reads and ancestor-symlink rules across existing consumers; no second implementation per executor. |
| Verification selection, attempts, origins and applicability | Retain `task-verification.mjs` and `task-verification-store.mjs`; adapt their invocation/storage inputs. The helper owns standalone execution, the runner owns orchestrated execution. |
| Execution ownership | Retain only the ownership needed during verification and runner mutation, keyed by the selected canonical work directory. Keep it in ignored execution storage, with error/cancellation cleanup. Standalone Markdown editing has no claim protocol. |
| Adoption and shared review decoding | Retain their existing dedicated modules and import them directly. An artifact-layout facade is not their owner. |
| Archive/layout requests and generic artifact publication helper | Remove after consumers have moved. Historical bytes are preserved, not migrated or reapproved. |

Shared plugin modules remain builtin-only ESM and must not import the CLI or
workflow coordinator. TypeScript consumers follow `import-boundaries.mjs`;
update its explicit owner entries when modules move. No new dependency, general
storage interface, plugin service, registry or background job is authorized.
Internal helper signatures may vary within these boundaries. Retain generated
readers only when an actual supported read-only consumer still needs them.

### Document execution and storage contracts

Direct document authors need no machine identity. Executors may allocate an
identity as part of an actual run/check, never as a prerequisite for writing
Markdown. Retain the current `BoundWork` envelope (`binding`, `sha256`) for
runner authority, using a successor binding. Store that authority in runner
state; a separately registered work file is not required.

Binding v3 retains `workId`, `slug`, `mode`, `createdAt`, `sourceCommit` and the
exact `artifacts` role map. It removes the `layout` field. New document roles
must resolve to the fixed directory; the verification directory must resolve
to ignored executor-owned storage. Generate machine identities internally and
verify hashes/roles before granting writes. A request never supplies arbitrary
verification output destinations.

Runner evidence stays beneath its existing run root. Standalone verification
stores its execution identity and records beneath `.banzai/verification/`, keyed
by the canonical selected document directory; allocate metadata only on execute.
Use that stable directory identity for execution exclusion and evidence lookup.
Read-only inspect/decide can report absent evidence without creating metadata.
Preserve regular-file, containment and symlink checks for this new namespace.
Execution ownership may be shared by the helper and runner; it must not turn
ordinary document reads/writes into a storage transaction protocol.

The standalone v3 request keeps `repoRoot` and `roundId`, replaces private
`workPath` with the exact repository-relative `documentPath`, and names
`workflow` as `strict`, `feature` or `quick-fix`. `execute` retains optional
`retryOf`. Operations remain `inspect`, `decide`, `execute`; request files carry
no commands or arbitrary output paths. Descriptors come from the selected
document's existing v2 obligation inventory. Validate strict versus lite
authority using the explicit workflow, document contents and calling skill's
authorization; do not manufacture runner approval.

| Boundary | Approved successor or preserved meaning |
| --- | --- |
| Work binding | `banzai-work-binding/v3`, schemaVersion 3; fixed tracked roles, no `layout`. Add `contracts/artifacts/v3/work-binding.schema.json`. v1/v2 never acquire these semantics. |
| Standalone verification request | `banzai-verification-request/v3`, schemaVersion 3; explicit document/workflow input. Add inspect/execute schemas under `contracts/verification/v3/`; keep the response envelope if its shape and meaning remain unchanged. |
| New runner state | Schema 9 carries binding v3 and existing task-verification/completion authority. Earlier states are not upgraded by inspection or startup. |
| Workspace capture | Schema 3 binds the new work identity and a sorted, unique path inventory covering Git changes and exact selected work documents. No ignored-state crawl or duplicate document entries. |
| Review snapshot / rendered Markdown | `banzai-review-snapshot/v7` and rendered review version 8 bind the successor state/workspace meaning. Review-result v2 and finding/triage semantics stay unchanged. |
| Agent control | Capabilities v7 and control contract `7.0.0` replace `artifactStorage` with `workDocuments`: fixed `directoryPattern`, binding-v3 support, workspace version 3 and verification-request-v3 support. No declaration schemas or layout choices. Status v5 and existing answer/request/recovery shapes stay unchanged. |
| Other evidence | Keep obligation inventory v2, task verification decisions/attempts, completion protocol/receipts and frozen evaluation/KPI/context meanings. Their existing digests remain opaque authority identities; unsupported historical evidence remains explicit. |

The capability `directoryPattern` is the literal
`documentation/work/<slug>/`; `bindingSchemas` contains only
`banzai-work-binding/v3`, `workspaceSnapshotVersion` is 3 and
`verificationRequestSchemas` contains only `banzai-verification-request/v3`.
These describe the new executable path, not historical decoder availability.
Doctor retains its output shape and read-only behavior while checking state 9.
Do not bump unrelated contracts or the release-train version as a side effect.
Any additional public/persisted semantic change needs an explicit plan revision
before implementation relies on it.

### Integrity, scope and publication

Workspace capture includes selected documents that are unchanged relative to
Git as well as changed/untracked source, and deduplicates overlapping entries.
Deleted/missing required documents remain observable. Exclude raw execution
state from source accounting without hiding edits to approved documents.

Update prompt grants, result-scope checks and the Claude hook together. Planning,
implementation, fix and review retain their exact role permissions; a tracked
directory is not a wildcard write grant. External edits detected after capture
or verification invalidate dependent evidence. Canonical reviews and completion
reports remain runner-published, with atomic replacement and receipt validation.
Do not model-author runner state or substitute Git status for approval checks.

Source-tree/source-archive checks classify the fixed work subtree without a
per-file inventory entry. Apply existing safe-name and content scans first;
explicitly excluded/private content does not become publishable by moving under
that prefix. Retain package allowlists: source-project work never enters plugin
or npm payloads. Extend machine-namespace rejection to the new verification and
execution-lock paths, including force-added entries and embedded payloads.

The source repository's existing transition-only inventory entries for this
description/plan can be removed after the general source rule is implemented.
Existing documentation ignored for historical reasons remains ignored.
Update the root authoring rule to the general new-work convention only after
consumer changes pass their focused checks.

## Human prerequisites

None outstanding for preparing or approving the local implementation bundle.

Local hook installation and installed-client validation are delivery actions,
separate from source implementation. The implementer prepares a concrete patch
for the currently installed pre-push guard, verifies it in a disposable hook
fixture and records its expected original hash. Applying it to the real checkout
requires the owner's delivery instruction and any host write permission; preserve
unrelated hooks. Until applied, report local-hook delivery as pending. No task
below treats `.git/hooks/` as a source write target or requires a push.

A release version, plugin/CLI installation, authenticated model smoke run and
external publication require their existing owner decisions. Source acceptance
uses deterministic local evidence; it does not claim installed-client behavior.
Preserve historical archive bytes and their readable historical tool source;
removing a last usable copy remains outside this plan.

## Implementation Tasks

- [ ] **T001 - Establish fixed work paths and shared execution primitives**

  First recognize the exact accepted ADR-0054 reciprocal lifecycle annotations
  in the existing instruction-authority validator. Add finite before/after images
  for the changed retained authorities, guarded by ADR-0054 acceptance. Confirm
  that unaccepted ADR-0054, unrelated annotations and changed decision bodies
  remain rejected. Do not alter retained baseline or transition identities.

  Extract the fixed role mapper and contained filesystem primitives described
  above; add binding-v3 validation without a layout selector. Ordinary authoring
  performs no registration. Allocate machine identity only for an executor;
  enforce collision handling, exact role containment and read-only non-mutation.
  Keep old entry points temporarily only until their consumers are replaced.
  Add or adapt behavioral cases for role mapping, unsafe paths, collisions and
  unchanged existing documents. Preserve bounds and atomic/create-only semantics
  when moving existing primitives; do not duplicate them.

  Affected units: `plugins/banzai/lib/artifact-storage.mjs` and its types;
  new `work-documents.mjs` / `project-files.mjs` and their `.d.mts` projections;
  binding v3 contract; `packages/orchestrator/src/artifact-storage.ts`, its new
  typed projection and `packages/orchestrator/import-boundaries.mjs`;
  `packages/orchestrator/scripts/phase-resources-build.mjs` for exact lifecycle
  annotation recognition.
  Assurance owner: existing artifact-storage behavior tests, reorganized by
  surviving work-document/filesystem guarantees, and phase-instruction tests
  for retained-authority integrity.
  Dependencies: none. Mapping: FR1-F8, FR11, FR16; AC01-AC06, AC09; ADR-0054.
  Completion evidence: focused behavioral results and the retained/removed
  primitive ownership record. Review batch: A, with T002.

- [ ] **T002 - Verify explicitly selected standalone documents**

  Implement request v3 and connect explicit documents to the existing task
  selection/execution store. Revalidate document bytes, source context and policy
  before launch and application; retain failed/interrupted attempts and retry
  provenance. Inspect/decide create nothing. Execute initializes only its private
  machine evidence, establishes effective ignores and releases its own execution
  ownership on success/error/cancellation. A missing/unsupported old inventory
  reports unsupported helper evidence without rewriting that document or
  waiving applicable fresh checks. Reject legacy executable requests with a
  bounded upgrade diagnostic; preserve historical record decoding as needed.

  Affected units: `plugins/banzai/lib/verification-helper.mjs`,
  `task-verification-store.mjs`, `task-verification.mjs` and their affected types;
  `plugins/banzai/scripts/verification.cjs`; verification request v3 schemas.
  Assurance owner: `packages/orchestrator/test/task-verification.test.ts` and
  helper integration coverage currently in `artifact-storage.test.ts`.
  Dependencies: T001. Mapping: FR4-F6, FR8, FR9, FR11, FR16;
  AC03-AC05, AC07, AC09; ADR-0049/0054.
  Completion evidence: real disposable subprocess checks for success, failure,
  retry, changed authority, concurrent execution and absent evidence; preserved
  old-document hashes. Review batch: A.

- [ ] **T003 - Bind new runner work to tracked documents**

  Start new runs with state 9 and binding v3 to fixed document roles. Preserve
  unfinished-run protection, explicit work selection, source-baseline capture
  and runner locks. Replace generalized storage initialization in setup/startup.
  Wire executor-owned verification storage and exact mutable phase ownership
  without recreating standalone registration. Update state validation, doctor,
  capabilities v7/control 7.0.0 and the explicitly invoked orchestrate skill.
  Older-run inspection does not authorize execution, rewrite state or retarget
  approved paths. Missing machine evidence is a diagnostic, not a successful run.

  Affected units: `packages/orchestrator/src/workflow.ts`, `store.ts`, `types.ts`,
  `validation.ts`, `project-setup.ts`, `doctor.ts`, `agent-control.ts`,
  `workflow/preflight/approval.ts`, `workflow/verification/` and affected control
  schemas/protocol references. Keep changes to these integration points bounded.
  Assurance owner: existing workflow, project-adoption, doctor, control and
  task-verification-recovery suites.
  Dependencies: T001, T002. Mapping: FR1-F3, FR5, FR8-F11, FR15, FR16;
  AC01, AC02, AC04, AC05, AC08, AC09, AC12; ADR-0040/0049/0054.
  Completion evidence: disposable new-run/continuation refusal traces and the
  exact capability/state contract assertions. Review batch: B, with T004.

- [ ] **T004 - Preserve review and completion integrity for tracked work**

  Implement workspace v3, snapshot v7 and rendered review v8. Inventory selected
  artifacts once, including unchanged approved files, while preserving source
  baseline and unauthorized-write detection. Update prompts, phase/result scope,
  hook grants, review preparation/publication, completion capture and receipt
  checks to use the fixed roles. Keep previous review iterations intact and
  preserve independent reviewer context. A source/document change during
  verification or publication must invalidate stale authority. Preserve supported
  historical readers without reopening historical execution.

  Affected units: `packages/orchestrator/src/git.ts`, `prompts.ts`,
  `review-snapshot.ts`, `review-artifact.ts`, `plan-task-completion.ts`,
  `workflow/domain/artifact-scope.ts`, `workflow/attempts/result-scope.ts`,
  `workflow/completion/` and related typed validators;
  `plugins/banzai/lib/review-snapshot.mjs`; `plugins/banzai/hooks/spec-gate.cjs`.
  Assurance owner: existing hook, prompts, review-artifact, workflow-publication,
  workflow-completion and completion/domain scope suites. Reuse their boundary
  doubles rather than mocking the scope/integrity implementation being tested.
  Dependencies: T003. Mapping: FR1, FR8-F11, FR16; AC01, AC05, AC07-AC09;
  ADR-0037/0038/0047/0054.
  Completion evidence: drift, tampering, outside-role writes, duplicate inventory,
  atomic publication/recovery and completion receipt regressions remain covered.
  Review batch: B.

- [ ] **T005 - Deliver the convention through skills and project setup**

  Rewrite the installed artifact policy as concise fixed-path guidance; remove
  declaration/helper authoring instructions from its ten consumer skills.
  Update guidance, runner phases, orchestrate references, template scaffolding
  and adoption/setup output consistently. New scaffolds include `work/` instead
  of new feature/plan/change roots; existing project directories and declarations
  are left intact. Preserve explicit skill invocation rules, the source-repository
  exception, report triggers and all human gates. Existing-work continuation uses
  exact known paths. Warn about a hiding ignore with a narrow actionable remedy;
  perform no force-add, broad unignore or automatic legacy discovery.

  Evolve current instruction expectations through ADR-0044's existing explicit
  authorization/transition mechanism under ADR-0054. Extend only the necessary
  authority-to-consumer permissions for this accepted change; preserve the
  original extraction evidence, full transition history and rejection of an
  unrelated authority or out-of-scope resource change. Never overwrite pins
  merely to make changed instructions pass.

  Affected units: `plugins/banzai/policies/artifact-storage.md`, its consumer
  `skills/*/SKILL.md`, related `guidance/`, `phases/`, packaged `AGENTS.md`,
  `PROJECT_MANIFEST.md`, `documentation/` templates and project-manifest
  references; `packages/orchestrator/src/project-adoption.ts`,
  `plugins/banzai/lib/project-adoption.mjs` and affected setup resource generation.
  The authorized transition also updates `packages/orchestrator/phase-guidance-current.json`
  and its `.sha256` pin through the existing generator and any narrowly required
  validation support in `scripts/phase-resources-build.mjs`.
  Assurance owner: project-adoption/instruction-layout fixtures and phase
  instruction tests; final release resource validation follows T007 in T008.
  Packaged templates are product source, not this repository's authority.
  Dependencies: T001-T004. Mapping: FR1-F7, FR14, FR15; AC01-AC06, AC12;
  ADR-0040/0042/0054.
  Completion evidence: fresh and already-adopted project fixtures, exact
  standalone/runner resource parity and a documented installed-client smoke
  procedure. No authenticated model run or installation is implied.
  Review batch: C, with T006.

- [ ] **T006 - Separate Git review documents from package payloads**

  Add the fixed source work-subtree rule to publication checks while preserving
  explicit exclusions and content scanning. Reject new raw evidence namespaces
  even when force-added; verify actual source/plugin/npm tar contents. Remove
  this work's transitional per-file entries once covered by the general rule.
  Keep historical ignores and existing declarations untouched. Prepare and
  fixture-test a precise update for the checkout-local pre-push guard so that
  it accepts the new source policy and no longer requires a private declaration.
  Its history scan must still validate every outgoing tree without executing
  untrusted tree code. Keep the real hook installation a recorded delivery step.

  Affected units: `packages/orchestrator/scripts/publication-check.mjs`,
  `publication-release.mjs`, `publication-policy.json`, publication tests and
  `documentation/publication-boundary.md`; this work's prepared pre-push patch
  and application instructions.
  Read-only references: `.git/hooks/pre-push` and the installed
  `.git/hooks/banzai-publication/` guard.
  Assurance owner: publication payload tests and disposable local-hook fixtures.
  Dependencies: T001, T005. Mapping: FR5, FR7, FR8, FR12, FR13, FR15, FR16;
  AC04, AC06, AC10-AC12; ADR-0041 as superseded by ADR-0054.
  Completion evidence: unclassified new work accepted in source, sensitive/private
  fixtures refused, package exclusion proven, hook patch/hash and delivery status.
  Review batch: C.

- [ ] **T007 - Remove the retired artifact subsystem**

  Remove `banzai artifacts` dispatch/help and `scripts/artifacts.cjs`, generalized
  layout/registration/write/archive requests, unused archive implementation and
  obsolete tests after replacement consumers pass. Remove the old storage facade
  or leave only a narrowly named supported owner; no dead dispatcher, fallback
  layout switch or generic compatibility wrapper remains. Update build resource
  inventories, release validation and import policy for removed/retained units.
  Preserve generated historical readers that still have a concrete consumer;
  remove generator output only when the consumer graph is empty.

  Affected units: `packages/orchestrator/src/cli.ts`, retired storage facade,
  `plugins/banzai/scripts/artifacts.cjs`, `lib/artifact-storage.*`,
  `lib/artifact-archive.mjs`, obsolete `contracts/artifacts/` requests,
  affected build/check scripts, `release-policy.json`, publication inventory,
  tests and public artifact-storage/archive guides. Keep accepted ADR bodies and
  historical reference paths intact; label historical tooling documentation.
  Assurance owner: import/type checks, CLI help tests, reference inspection and
  release validation. Every retained old-format unit names its current reader.
  Dependencies: T001-T006. Mapping: FR4, FR5, FR11, FR14, FR15;
  AC03, AC04, AC09, AC12; ADR-0054.
  Completion evidence: remaining-reference inventory distinguishing historical
  text/readers from executable paths; obsolete surfaces absent from packaged help
  and plugin resources; historical bytes unmodified. Review batch: D.

- [ ] **T008 - Verify the integrated result and document current behavior**

  Finish behavioral coverage across new strict/lite/fix work and explicit old
  standalone continuation. Use disposable repositories to prove preservation,
  Git visibility and source/package separation; never stage the real checkout
  for a test. Run focused checks while editing, regenerate committed resources
  and the bundle with `npm run build`, then run the mandatory fresh checks below
  on the final candidate. Fix affected regressions; do not weaken unrelated
  release components or substitute earlier runs for final evidence.

  Update root `AGENTS.md`, current manifest/module facts and maintained user
  guides to the implemented convention. Remove the transition-only authoring
  exception once general support exists. Keep actual unsupported historical
  behavior and delivery limitations explicit. Write implementation/test reports
  in this work directory with task evidence, command results and deviations.
  Standalone reports use the existing author-owned v1 completion projection;
  create no runner receipts or control records. Retain unchecked approved plan
  tasks and record execution evidence in the reports.

  Affected units: relevant existing integration suites and fixtures;
  generated `packages/orchestrator/dist/` and instruction/reader resources;
  `AGENTS.md`, `PROJECT_MANIFEST.md`, `packages/orchestrator/MODULES.md`,
  `README.md`, relevant `documentation/` guides, and this work's required reports.
  Assurance owner: existing repository release gate and evidence-linked report
  review. Mark ADR-0054 Implemented only when required local implementation and
  verification are complete; separate local-hook/installed-client delivery.
  Dependencies: T001-T007. Mapping: all FRs and ACs; all binding ADR constraints.
  Completion evidence: final fresh candidate gate, whitespace check, traceability
  and reports. Review batch: D; then independent review of the complete bundle.

## Verification Obligations

The final source acceptance check uses the existing disposable release-candidate
driver. It copies tracked and untracked non-ignored files, gives the candidate
its own index and runs the complete `release:check` there. This includes tests,
type/lint checks, generated/bundle parity, formatting, release metadata, actual
publication payloads and committed smoke without staging the real checkout.
Run it after build and documentation updates stabilize. Record the exact source
baseline and final candidate result; a failed/unavailable required check is not
a pass. A sandbox restriction may require the same authorized check in an
appropriate host environment, never a weakened replacement.

The two descriptors below are mandatory final checks. Focused tests within tasks
are permitted supplemental checks, selected from the named owners. Behavioral
assertions and the manual source/document inspections described above are binding
coverage requirements; this command inventory is not a substitute for them.
No live vendor invocation, installation, push or publication is authorized by
these descriptors. Equivalent evidence does not replace these fresh checks.

```banzai-verification-obligations/v2
{
  "schema": "banzai-verification-obligations/v2",
  "schemaVersion": 2,
  "complete": true,
  "planRemainderSha256": "bbcb1bffde07e7b3bf90d7972f208ff94d48cc9061de42d392b29cb2aae6c206",
  "checks": [
    {
      "id": "final-release-candidate",
      "name": "Complete release gate on the final disposable candidate",
      "requirementRefs": [
        "T008",
        "FR9",
        "FR10",
        "FR11",
        "FR12",
        "FR13",
        "FR14",
        "FR15",
        "FR16"
      ],
      "command": "node",
      "args": [
        "packages/orchestrator/scripts/release-candidate-check.mjs"
      ],
      "cwd": ".",
      "timeoutMs": 900000,
      "evidence": "fresh",
      "sources": [
        {
          "path": "packages/orchestrator/scripts/release-candidate-check.mjs",
          "sha256": "698a35eebd4a7d5abf992d3ddbbb973d0332d350119fd99e70df57adf33f7eeb"
        }
      ],
      "materialization": null
    },
    {
      "id": "final-diff-whitespace",
      "name": "Final source diff whitespace validation",
      "requirementRefs": [
        "T008",
        "FR15"
      ],
      "command": "git",
      "args": [
        "diff",
        "--check"
      ],
      "cwd": ".",
      "timeoutMs": 30000,
      "evidence": "fresh",
      "sources": [],
      "materialization": null
    }
  ],
  "absenceReason": null
}
```

## Consistency Check

| Requirement coverage | Implementation tasks | Acceptance coverage |
| --- | --- | --- |
| FR1, FR2, FR3: grouping, naming, proportionate artifacts | T001, T003, T005, T008 | AC01, AC02 |
| FR4: direct authoring and inert declarations | T001, T002, T005, T007 | AC03, AC12 |
| FR5, FR6: preservation and explicit old-work continuation | T001, T002, T003, T005, T006, T007, T008 | AC03, AC04, AC05, AC09 |
| FR7: Git visibility and narrow ignore remedy | T001, T005, T006, T008 | AC01, AC06 |
| FR8: ignored machine evidence and safe reports | T001, T002, T004, T006, T008 | AC06, AC07, AC10, AC11 |
| FR9: verification authority | T002, T003, T004, T008 | AC07, AC09 |
| FR10: runner, review and completion authority | T003, T004, T008 | AC05, AC08 |
| FR11: versioned meaning without migration | T001, T002, T003, T004, T007 | AC08, AC09 |
| FR12, FR13: source/package distinction | T006, T008 | AC10, AC11 |
| FR14, FR15: removal and coherent delivery | T005, T006, T007, T008 | AC12 |
| FR16: filesystem and ownership boundaries | T001, T002, T003, T004, T006 | AC05, AC07, AC08 |

ADR-0054's seven confirmation rows map respectively to T001/T003/T005/T008,
T001/T005/T007, T002, T003/T004, T006, T001/T005/T008 and T007/T008. Its no-migration
rule applies to every task, including setup and tests. ADR-0049 task authority
maps to T002-T004; ADR-0040/0042 adoption/delivery to T003/T005; ADR-0037/0038/0047
approval, review and completion to T003/T004. No prerequisite ADR is Proposed.

Current manifest transitions are the section 4 artifact locations/ignore rules,
section 5 storage/CLI/setup/verification owners, section 6 new state/binding and
snapshot flow, section 8 assurance ownership and section 10 current contracts
and ADR-0054 implementation state. Section 2 build/resource facts change only
where generators or packaged inventories change. The recorded release version
already differs from current package metadata; T008 reconciles that current fact
without selecting a new release version. Earlier ADR bodies remain immutable.

Security enforcement owners: classes 1/2 at the shared filesystem boundary,
binding/request decoders, executor ownership, hook grants and result-scope checks
(T001-T004); class 4 at safe report projections and content/payload checks
(T004-T006); class 7 at collision-safe writes, immutable evidence, preserved old
files and source/package/local-hook checks (T001-T004, T006). The planning changes
themselves write only lifecycle metadata, repository authoring instructions and
new reviewable documents; they invoke no executor, migration or publication.

Material quality constraints: EQ-02/03 keep document naming, filesystem access
and execution ownership separate under T001-T004; EQ-04/05 preserve boundary
validation and cleanup; EQ-06/07 require actual removal without added layout or
migration machinery under T005/T007; EQ-08/09 bind evidence and successor contract
semantics under T002-T004/T008. These are mapped to concrete behavior, not generic
style requirements. Remaining justified legacy readers are documented in T007.

Consistency result: every FR and AC has an owner; accepted ADR intent is separated
from current source facts; task order and final evidence are explicit; there are
no unresolved product choices or migration tasks. This is planning consistency,
not independent review or implementation verification.

## Planning Validation

- The repository's plan parser accepted the eight ordered task headings and
  found no task write grant to runner control paths.
- The canonical v2 obligation parser validated the complete inventory, plan
  remainder digest and both descriptors; the pinned driver source matches.
- New document links, ordinary Git visibility, whitespace and the working-source
  publication classification passed. No files were staged.
- Decision-body hashes before and after acceptance match for ADR-0054 and all
  seven amended records. Only acceptance/lifecycle metadata changed.
- `npm run release:validate` failed with `INSTRUCTION_RESOURCE_DRIFT` because
  the retained authority images for ADR-0047/0049 do not yet admit their new
  reciprocal lifecycle links. In a disposable diagnostic copy, replacing only
  those two files with their pre-acceptance images made instruction validation
  pass. T001 owns the bounded validator update; it has not been implemented.
- The full release gate, feature implementation tests and installed-client
  checks have not run during planning. Their implementation/delivery obligations
  remain as specified above.

## Approval and Handoff

Approve this exact `description.md`, `plan.md` (including its inventory) and the
accepted ADR constraints named above as one implementation bundle. Approval is
pending. Subsequent edits to binding requirements or mandatory verification need
the normal bundle approval path; routine internal choices within these constraints
do not. The task write targets exclude existing project work and runner control.

After implementation and its required verification, run independent review into
the next `review-N.md` in this directory and stop at human finding triage when
required. Independent review is a separate workflow phase, not a task falsely
claimed complete before the implementation ledger can be validated.
