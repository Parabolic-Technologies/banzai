# Publication Boundary

`publication-policy.json` classifies documentation and plugin resources. Product,
maintainer and reviewed example entries are eligible for publication. New internal
work evidence is excluded even when a local task still uses legacy paths.

The declared mode is never weakened automatically:

- `transition` retains only exact path and SHA-256 exceptions for already-public
  historical exposure. Modified or new internal evidence fails. Exceptions are
  retained exposure, not a claim that historical work is public-safe.
- `clean` rejects historical exceptions too. Use it for the isolated sanitized
  candidate and its source, npm and plugin distributions.

`npm run publication:check` examines indexed bytes, actual source/plugin tar
archives from that index, and an actual offline npm tarball of the current
workspace. It removes disposable packaging output afterwards. This is part of the existing
release gate and therefore CI and release publication. Unstaged private reports
remain local; staging one does not make it eligible. The checker never stages,
rewrites the inventory, updates version mirrors or modifies its selected tree.
Before an inventory exists in an old selected tree, the explicit local inventory
provides its classification authority; the result still examines selected bytes.

```sh
node packages/orchestrator/scripts/publication-check.mjs --tree staged
node packages/orchestrator/scripts/publication-check.mjs --tree HEAD
node packages/orchestrator/scripts/publication-check.mjs --archive /absolute/source.tar.gz --distribution source
node packages/orchestrator/scripts/publication-check.mjs --archive /absolute/package.tgz --distribution npm
node packages/orchestrator/scripts/publication-check.mjs --archive /absolute/plugin.tar.gz --distribution plugin
```

Archive inspection reads entries without extracting links or special files. npm
has an exact expected payload set; plugin resources need explicit classification.
Source maps are inspected through `sources` and `sourcesContent`. Path and bounded
content checks are prevention controls, not exhaustive secret detection or proof
that Git hosting has removed old objects.

A sanitized snapshot is prepared separately, with a clean inventory and current
public dependencies. [Historical references](historical-references.md) explain
omitted work history without rewriting accepted ADR bodies. Real cutover needs
verified remote/ref identities, protected-branch decisions, off-machine custody,
and explicitly selected release actions. Use a new unused npm version for changed
package bytes. No local check proves hosted delivery or installed-client behavior.
