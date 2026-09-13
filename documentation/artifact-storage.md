# Artifact Storage

ADR-0041 separates current shared documentation from local workflow evidence.
The plugin and CLI use the same resolver and project prerequisite reader. A
plugin-only project needs Node and Git, but no orchestrator configuration.

## Layout and first use

New eligible projects default to private work. During an authorized first write,
complete normal project guidance setup first. The helper then adds only missing
storage and narrow Git exclusions. Read-only inspection and status never create
folders. An absent `.banzai` is a normal first-use case. Malformed or ambiguous evidence requires explicit recovery.
A broad `.banzai/` ignore must be repaired explicitly so the declaration remains
shareable. Initialization never stages files.

```text
project/
├── AGENTS.md / CLAUDE.md / PROJECT_MANIFEST.md
├── documentation/
│   ├── decisions/                 # shared architectural decisions
│   └── …                         # curated product and maintenance guides
└── .banzai/
    ├── artifacts.json            # shared private declaration
    ├── work/<uuid>/              # ignored local work
    │   ├── work.json             # immutable identity, layout and exact roles
    │   ├── description.md / plan.md
    │   ├── implementation-report.md / test-report.md
    │   ├── work.md               # lite feature instead of strict documents
    │   ├── change-report.md      # quick-fix only when its report trigger applies
    │   └── review-1.md           # independent numbered reviews
    └── runs/<run-id>/            # orchestrator only, ignored execution evidence
```

The tree shows possible roles, not mandatory files in every workflow. Orchestrator
configuration, active pointer and runner lock retain their separate existing
ownership. The Banzai source repository retains its own guidance and source
identity exception; installing the plugin does not turn its templates into root
instructions. Home and client projects follow their own visibility, retention and
custody rules. None writes evidence into the installed plugin or Banzai source.

| Development context | Plugin only                             | With orchestrator                             |
| ------------------- | --------------------------------------- | --------------------------------------------- |
| Banzai source       | Source instructions; local work binding | Same work binding plus local run evidence     |
| Personal project    | Project setup; local work binding       | Same setup and binding plus run evidence      |
| Client project      | Client-owned setup and local evidence   | Same client-owned evidence plus run authority |

Every work uses an immutable `banzai-work-binding/v2` with private role paths.
A handoff passes the project-relative `work.json` path or work ID explicitly.
A slug alone cannot select among identities; independent worktrees create
independent IDs. Unsupported evidence fails before writing with
`RESOURCE_VERSION_UNSUPPORTED`. The helper does not register or migrate old work.

## Local commands

Use the installed plugin's `scripts/artifacts.cjs`, resolved relative to its skill,
or `banzai artifacts`. Both accept the same versioned JSON request file:

```sh
node /absolute/installed/plugin/scripts/artifacts.cjs inspect --json /absolute/request.json
banzai artifacts inspect --json /absolute/request.json
```

```json
{
  "schema": "banzai-artifact-request/v2",
  "schemaVersion": 2,
  "repoRoot": "/absolute/project"
}
```

`initialize` optionally accepts `layout`; `create` adds `slug`, `mode` and a
caller-retained UUID v4 `creationId`. Retrying that identity returns the same
binding. Standalone modes are `strict`, `lite` and `fix`; the runner uses immutable
`workflow` capacity before selection. The actual strict/feature/quick-fix choice
and phase permissions remain in `state.workflowSelection`.

Writers `acquire` an explicit `workPath` with an `ownerId`, retain the returned
claim token, and `write` exact role paths with `inputFile` and `expectedSha256`
(null means create only). `release` requires the same work path and token. Claims
coordinate standalone writers and entire runner phases for that work; they never
approve requirements or implementation. Effective Git checks cover the selected
binding, claim and report destinations, including nested ignore negations.
Request files, `inputFile` and `inventoryFile` may use symlinked parent directories
such as macOS `/tmp` or `/var`; their leaf must be a regular non-symlink file.
Project-relative artifact paths, private work roots, archive bundles and
export/restore destinations still reject symlink ancestors. Use physical absolute
paths for those archive directories. Do not resolve an abandoned claim by deleting
another owner's evidence.

Run state 5 records the binding and byte hash. Workspace v2 includes the
selected ignored work without crawling other work items or runner state. Review
snapshot v3 and runner Markdown v4 retain that identity; required completion
reports are the only private exceptions to the completion evidence exclusion.
Control capabilities v3 declares binding v2 and private layout under control
contract 4.0.0. Restart updated clients before using their new plugin contents.

See [archive operations](artifact-archive.md) and the
[publication boundary](publication-boundary.md).
