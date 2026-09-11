# Local Artifact Archives

Use `banzai artifacts <operation> --json <request-file>` or the plugin's standalone
helper. The common request fields are `schema: "banzai-artifact-request/v1"`,
`schemaVersion: 1` and the physical absolute `repoRoot`.

| Operation | Additional fields | Result |
| --- | --- | --- |
| `inventory` | Explicit project-relative `workPaths` and/or `runIds` | Read-only closure inventory and omissions |
| `export` | Absolute `inventoryFile`, new absolute `destination` | Verified copy of the exact reviewed inventory |
| `verify` | Absolute `bundlePath` | Object hashes, sizes, manifest identity and closure |
| `restore` | `bundlePath`, fresh absolute `destination` | Original bytes/modes and retention receipt; no active pointer |

Save the `inventory` object from a successful inventory result to a private local
JSON file. Review its entries, dependency omissions and retention metadata before
passing that file to `export`. Export consumes that fixed inventory, checks its
source checkout identity, and rejects changed source bytes or modes. It never
silently regenerates the inventory. Source identities hash the physical local
checkout path; they neither disclose that path nor infer identity from a remote URL.
No operation uploads, prunes, selects a release version or changes Git refs. Never
select authentication directories or credentials.

Archive v1 contains `manifest.json` and `objects/<sha256>`. Entries record original
relative path, source identity, size, mode and raw-byte SHA-256. Original approval
and decision text is evidence of recorded provenance; a hash does not establish
that its assertion was true. Work bindings, versioned JSON evidence and Markdown
links contribute dependency references. Machine authority references and Markdown description/plan/work/decision links
are required. A missing required reference prevents completeness and restore.
Explicit `[Historical (optional): label](path)` links record optional historical
references; other non-authority document links remain optional. Verification
rederives these requirements from original bytes and rejects a downgraded edge.
Run-relative logs/results resolve from their recorded run directory. Absolute references
inside the original run project resolve to preserved relative paths; other absolute
references receive a hashed external identity and are never crawled. Terminal,
recovery, attempt, verification and result evidence use the existing orchestrator
readers shipped as a generated builtin-only module; build parity checks that module.
Unknown metadata interpretation is reported and prevents a complete restore.

An export may retain an incomplete bundle with a clear `complete: false`; this
never authorizes source removal. Verification re-reads objects and dependency
references. Restore requires complete required closure, rejects symlink ancestors,
conflicts and unsafe paths, stages originals privately and publishes the complete
directory after verification. Use a fresh inactive destination. An existing
destination is accepted only as a verified identical no-op and without an active
runner pointer. Never overlay an active project or partially restore its authority.

Managed `.banzai/work`, `.banzai/runs` and `.banzai/control` ancestry is rejected,
including a missing child of claimed work in another project. Restores preserve
the byte-identical archive manifest at `.banzai/archive-manifest.json`; this
private receipt retains source identity, pins, dependency edges and owner terms.

A destination differing from the original local source identity marks the
restoration for historical inspection. A matching identity alone does not make a run resumable: original source
commit, approval, workflow, ignored evidence and normal recovery checks still
apply. Restoration never creates `active-run.json` or invokes resume.

Inventory starts with `retention.policy: "unspecified"`, empty rules/pins and
`ownerPolicy: null`. A custodian may explicitly select `banzai` with the fixed
rules below, or `owner` with empty `rules` and an `ownerPolicy` object containing
`ownerId`, ISO `recordedAt` and bounded written `terms`. This is inventory metadata,
not another operation's request field or an inferred client policy.

Set `retention.pins` to explicit `{sourceId: "project", workId, reason, recordedAt}`
records for archived bound work. Register original legacy work before pinning it
by work ID. Pins identify existing binding provenance, survive export/verification
and the restored receipt, and protect that work's included artifacts and required
dependency closure. `verify.retainedPaths` projects this protection, including
legacy role paths. Shorter log eligibility never overrides a pin. No automatic
prune or deletion authorization exists; `deletionAuthorized` must stay false.

Banzai retention defaults: active/pinned evidence has no expiry; supported
authority lasts through support plus 24 months; other closed work at least 24
months; release/migration provenance for the project lifetime. Unreferenced logs
may be eligible after 30 days and invalid candidates after 90 days following
closure. Dependencies override expiry. These are inventory rules, not an automatic
deletion schedule or a client legal retention claim.

Before destructive migration, the owner must verify an off-machine copy and a
restoration independently. A local archive alone is not that custody evidence.
