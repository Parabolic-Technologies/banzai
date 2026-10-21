# Publication Boundary

New human-reviewed work under `documentation/work/<slug>/` is eligible for source
Git trees and source archives without a per-file inventory entry (ADR-0054).
Safe names, explicit exclusions and existing content checks still apply. Raw
machine instances, credentials and ignored `.banzai/` execution namespaces remain
excluded, including force-added files and embedded payloads.

`publication-policy.json` continues to classify other documentation and plugin
resources. Its declared mode is never weakened automatically: `transition`
allows only exact reviewed historical exceptions; `clean` rejects them. Moving
an explicitly internal or sensitive file beneath `documentation/work/` does not
make it eligible.

`npm run publication:check` examines indexed bytes, actual source/plugin tar
archives from that index and an actual offline npm tarball. Source-project work
is absent from plugin/npm payloads; plugin scaffolding contains only the empty
`documentation/work/.gitkeep` template. npm retains its exact payload allowlist.
Source archives exclude the ignored orchestrator `dist/`; the npm tarball
contains the bundle and source map built from the candidate. Run
`npm run build:dist` before a standalone publication check. The check compares
packed distribution bytes with that local build and retains source/plugin
instruction and embedded source-map parity.
The checker stages nothing, rewrites no inventory and removes only its own
packaging output.

```sh
node packages/orchestrator/scripts/publication-check.mjs --tree staged
node packages/orchestrator/scripts/publication-check.mjs --tree HEAD
node packages/orchestrator/scripts/publication-check.mjs --archive /absolute/source.tar.gz --distribution source
node packages/orchestrator/scripts/publication-check.mjs --archive /absolute/package.tgz --distribution npm
node packages/orchestrator/scripts/publication-check.mjs --archive /absolute/plugin.tar.gz --distribution plugin
```

Archive inspection reads regular entries without extracting links or special
files. Source maps are inspected through their source identities and embedded
bytes. These bounded checks are not exhaustive secret detection or proof of
hosted delivery. Existing historical work and ignore rules stay in place; no
migration, history rewrite or new release version is implied.

The checkout-local pre-push guard is a separate installed copy. Tracked changes
do not update it. The ADR-0054 work includes a tested patch and exact original
hashes; delivery applies that reviewed patch under owner authorization, preserving
unrelated hooks. The guard keeps inspecting every outgoing commit through raw
Git objects without executing checkout code, even for deleted-later private files,
merges, tags and force pushes. See the transition's
[local-hook instructions](work/git-visible-work-artifacts/local-hook-delivery.md).

[Historical references](historical-references.md) retain earlier provenance.
Existing archive bytes and their last readable tool source require an explicit
custody decision before deletion. Installation, release selection and external
publication remain separate owner decisions.
