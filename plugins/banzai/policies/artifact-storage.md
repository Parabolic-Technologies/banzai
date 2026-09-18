# Artifact Storage

- Owner decision: ADR-0041
- Consumers: `feature-description`, `architecture-decision`, `development-plan`, `code-writing`, `test-writing`, `feature-review`, `feature-status`, `feature`, `quick-fix`, `project-manifest`; conditional: None
- Process source: the project `AGENTS.md` (authority order, escalation triggers, decision gates)
- Runner consumers: planning, implementation, review, fix, feature, quick-fix.
- Delivery: standalone skills load this policy relatively; runner phases receive its body inline. Conditional duties retain their conditions.

## Artifact Storage

Standalone callers resolve this policy relative to the installed skill as
`../../policies/artifact-storage.md`. Use the helper shipped in that same plugin:
`../../scripts/artifacts.cjs` from the skill directory. Do not substitute a
project policy copy, plugin-cache destination or npm CLI prerequisite.

Storage does not grant authority. Existing requirements, accepted ADRs, approved
bytes, task order, human gates and reviewer independence retain their meaning.
Standalone use retains skill/human authority; it does not create runner-owned
approvals, completion ledgers or recovery checkpoints.

The shared declaration is `.banzai/artifacts.json`. New eligible projects use
ignored `.banzai/work/<work-id>/` for internal work. `.banzai/runs/<run-id>/`
remains runner-owned. Product guidance, public contracts, ADRs/indexes and the
project manifest remain repository documentation. Repository visibility and
archive custody belong to that project; client evidence never belongs in the
Banzai source checkout or installed plugin directories.

## Resolve Before Reading or Writing

The procedure in this section is for standalone callers. Runner phases use the
supplied binding, role paths and exact phase grants; the runner alone resolves
work, creates bindings and acquires/releases claims. A runner phase does not
invoke this helper or acquire a standalone claim. Missing supplied authority
stops dependent work instead of selecting or creating another work item.

For standalone callers, after normal project guidance prerequisites, invoke the local helper with
`node <installed-plugin>/scripts/artifacts.cjs <operation> --json <request-file>`.
Requests follow `contracts/artifacts/v1/*-request.schema.json`; every request has
`schema: "banzai-artifact-request/v1"`, `schemaVersion: 1` and an absolute local
`repoRoot`. Store temporary request/input files privately with mode `0600` and
remove only your own temporary files when finished. The helper outputs one
versioned JSON result and exits nonzero on failure. Never infer success from
partial output or print token/input contents in reports.

Request files, `inputFile` and `inventoryFile` accept OS temporary directories
with symlinked ancestors; their leaf must be a regular non-symlink file. Artifact
paths and private work roots retain full ancestor-symlink checks. Use physical
absolute paths without symlink ancestors for archive bundles and export/restore
destinations.

1. Use `inspect` with an explicit `workPath`/`workId` when continuing work.
   Otherwise inspect available identities. Multiple candidates require an
   explicit selection; a matching slug or newest timestamp is not authority to
   choose one. Read resolved ignored files directly, not only through Git-aware
   search. Missing required evidence blocks the dependent step.
2. Loading the plugin, status, review-only discovery and questions do not run
   `initialize` or `create`. For authorized setup or first artifact writing,
   after existing prerequisites pass, `initialize` safely establishes the layout
   and effective ignores. It neither initializes Git nor stages files.
3. For genuinely new work, retain a caller-generated UUID `creationId`, then
   `create` with that ID, bounded slug and `strict`, `lite` or `fix` mode. Retry
   using the same ID after an interrupted response. Persisted `work.json`
   supplies exact role paths; use them instead of a hard-coded legacy path.
   For unbound recognized legacy work, `inspect` its conventional file/directory
   `workPath`. Explicitly select `legacySelection` (or one `legacyCandidates`
   entry), then register it with `create` using the returned exact `creationId`,
   slug and mode. This content-bound continuation identity preserves original
   roles, bytes and recorded Git provenance, even after a private default is
   declared. A stale identity requires inspection again. Registration never
   grants a new approval; hand off the resulting immutable `work.json`.
4. Before a standalone artifact write, `acquire` the selected work using a
   bounded local `ownerId`. `write` takes its token, an exact artifact role path,
   a private `inputFile` and `expectedSha256` (`null` means create-only).
   Conditional-write conflicts require reading current evidence, not retrying
   with a guessed hash. `release` only your token in success/error cleanup.
   Runner phases hold the same exclusive work claim through mutable processing.
   Another work item is independent; do not remove its claim.
5. Handoff includes the project and exact work path/identity plus actual decision
   and evidence references. Release the writer claim before a normal handoff.
   After a crashed writer, inspect the claim, verify that its original process
   has stopped and obtain the owner's explicit recovery decision before removing
   that exact stale claim. Never steal a claim based on elapsed time alone.

Read-only inspections never repair declarations. Missing declarations alongside
private evidence, unsupported schemas, unsafe ancestors, unreadable files or
broad ignores produce bounded repair diagnostics. Do not fall back to public
workflow paths. Recognized legacy work keeps its recorded paths; ordinary
documentation is not a legacy marker. Existing bindings keep their paths. New task-verification work uses private
binding v2, even where the previous default was legacy (ADR-0049 amendment). A declaration change cannot move an existing binding.

Public ADR/manifest/product-guide edits use their established repository paths
and existing approval rules; the private helper is not a blanket write grant
for them. In orchestrated mode, use the run's supplied binding and exact phase
grants. The runner owns its state, approvals, candidate publication and recovery;
standalone claims never replace those checks. Existing hooks have host-specific
limits and do not sandbox unrestricted shell tools.

## Required Evidence and Publication

Strict work retains description, plan, implementation/test reports and each
independent review iteration. Lite work needs one `work.md`; quick-fix retains
its existing report trigger. Read-only work, initialization and individual
attempts do not require additional prose reports. Keep the completion projection
and required report sections. Refer to canonical runner verification identities
or deterministic projections instead of model-authoring duplicate totals;
standalone reports preserve actual command/result evidence when no runner ledger
exists.

Private files are durable evidence, not disposable scratch. Ignore rules prevent
ordinary staging, not force-add, third-party synchronization or model processing
authorized by the workflow. Do not stage internal artifacts for convenience.
Explicit public promotion requires maintained, sanitized product information and
normal review; it cannot replace private approval or completion evidence.

Retain active/pinned work and dependency closure. Archive operations are local,
explicit and backend-neutral; no automatic upload or prune is implied. Verify
hashes and restoration, including owner-confirmed off-machine custody, before
removing a last copy. Restoring historical bytes does not approve resuming a run
against a different source baseline. Credential material must not be deliberately
archived and rejected private contents must not appear in diagnostics.


## Task verification work

New task work uses private `banzai-work-binding/v2`, created with the existing
v2 artifact create request. No binding v3 or historical-run migration is needed.
The exact `verificationDirectory` role is helper-owned machine evidence, never
a model-writable report role. Inspect/acquire/write/release keep their contracts.

Standalone callers use `../scripts/verification.cjs <inspect|decide|execute>`
with a private JSON request: schema `banzai-verification-request/v2`, schemaVersion
2, repoRoot, exact workPath and roundId UUID. Execute may include an exact retryOf
for a failed attempt in that round. The request contains no commands or arbitrary
output paths: descriptors come from the bound plan (strict) or existing work/change
artifact (lite), using the self-contained obligations inventory. The calling skill
must already have task/plan authorization; the helper does not establish human
approval and labels its authority `standalone-skill`. Inspect/decide never persist
new evidence. Execute owns the work claim and preserves physical attempts.

No additional prose report is required solely for verification. A standalone fix
without a required bound report runs fresh task checks under its existing skill
authority. Missing helper support never waives a mandatory check. Orchestrated
phases always leave verification to the runner and never invoke this helper.
