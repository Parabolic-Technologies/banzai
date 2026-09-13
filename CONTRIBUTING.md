# Contributing

This repository is the source of the Banzai plugin and the `banzai`
orchestrator. [`AGENTS.md`](AGENTS.md) is the process authority and
[`PROJECT_MANIFEST.md`](PROJECT_MANIFEST.md) is the source of truth for
implemented project facts — read both before changing anything.

The public repository is
[Parabolic-Technologies/banzai](https://github.com/Parabolic-Technologies/banzai).
The product owner is **Banzai International, Inc. d/b/a Parabolic, Inc.
("Parabolic")**.
The author and maintainer is [Alexander Torosh](https://github.com/alexander-torosh)
([alexander@parabolic.io](mailto:alexander@parabolic.io)). Participation follows our
[Code of Conduct](CODE_OF_CONDUCT.md).

## Issues and proposals

Use [GitHub Issues](https://github.com/Parabolic-Technologies/banzai/issues)
for reproducible bugs, documentation improvements, and feature proposals.
Search existing issues first. For a bug, include the Banzai version or commit,
OS, Node and client versions, minimal reproduction, and expected versus actual
behavior. Redact logs and use synthetic data; never attach credentials or raw
run directories. Report vulnerabilities privately through
[SECURITY.md](SECURITY.md).

Discuss significant features, dependencies, contract changes, or architecture
changes with the maintainers before investing in an implementation. Existing
accepted ADRs and approved artifacts retain their authority. Documentation
improvements and small fixes can be proposed directly.

## Pull requests

1. Fork the repository and create a focused branch from the intended upstream
   base. Use the default branch unless a maintainer directs you to `dev` or a
   different base for an existing change.
2. Install the locked dependencies with `npm ci`. Follow the repository process
   and keep unrelated changes out of the pull request.
3. Add or update tests when needed to protect material behavior. Update affected
   documentation and rebuild the committed distribution with `npm run build`
   if source or embedded metadata changes.
4. Run `npm run release:check` and `git diff --check`. Report the exact commands,
   results, and any unavailable checks. Documentation-only changes still need
   relevant link and release validation; explain any unrun checks.
5. Open a pull request describing the problem, resulting behavior, linked
   issue or approved artifacts, verification, and material limitations.

Keep code, documentation, UI text, and commit messages in English. Use commit
subjects such as `fix(orchestrator): preserve recovery evidence` or
`docs(installation): clarify setup`. Maintainers review and decide whether to
merge; a submitted contribution does not imply acceptance. Release owners
manage version changes, tags, and publication, so do not bump the version as
part of an unrelated contribution.

AI-assisted contributions are welcome. You remain responsible for understanding
the change, verifying it, and having the right to submit all included material.
Describe AI involvement when it helps reviewers understand the evidence or its
limits; model output is not independent verification by itself.

## Contribution licensing

Unless you explicitly state otherwise, contributions intentionally submitted
for inclusion are offered under Apache-2.0, as described in section 5 of
[LICENSE](LICENSE). You retain copyright in your contribution. Submit only
material you have the right to license, and identify third-party material with
its source, license, and required notices. Discuss a different license before
submitting such material; acceptance is not automatic.

No separate contributor license agreement or commit sign-off is required by
this project. These contribution rules do not impose extra restrictions on
use of the released software.

## Development

```text
npm ci
npm run verify
```

`verify` runs typecheck, lint, tests, and the committed-bundle byte check.
Focused test evidence uses
`node packages/orchestrator/scripts/test.mjs --pattern <regex>`. The formatter
(`npm run format:check`) is deliberately outside `verify`; run it during final
review.

### Mechanical import boundaries

`packages/orchestrator/import-boundaries.mjs` is the executable projection of
the orchestrator dependency direction in `PROJECT_MANIFEST.md` and accepted
ADRs. Every production module under `packages/orchestrator/src/` has exactly
one policy entry. `npm run lint` fails when a module is missing, duplicated, or
stale, even if that module contains no imports.

Each entry has separate exact permissions:

- `runtime` permits a static runtime import, side-effect import, re-export, or
  the less-coupled declaration-level `import type` / `export type` form;
- `typeOnly` adds a target that is permitted only through a declaration-level
  type import or export and never authorizes runtime loading.

Every entry and permission names its `PROJECT_MANIFEST.md` section or accepted
`ADR-NNNN` authority. ADR identities must also be present in the policy's closed
`POLICY_ADR_AUTHORITIES` set, and may join that set only after the corresponding
ADR is accepted. Do not generate permissions from the current graph, use
wildcards, add environment-specific exceptions, or add inline ESLint disables.
Dynamic relative imports, inline TypeScript import types, import-equals,
CommonJS local loaders, and static or dynamic `createRequire` acquisition are
rejected in production source so syntax cannot bypass the same table.

For a legitimate new module or dependency, first confirm the manifest's inward
direction and any narrower accepted ADR. Add or amend architectural authority
before broadening behavior, then add the narrow runtime or type-only permission
with that authority and run the focused import-boundary tests plus
`npm run lint`. A diagnostic names the repository-relative importer, target,
dependency kind, boundary, and authority. Test and build-tool imports remain
outside the production map and retain the ordinary lint rules.

## Release Confidence

Install the locked dependency graph, then run the single deterministic local
gate:

```text
npm ci
npm run release:check
```

It runs the full `verify` sequence plus the formatter check,
plugin/marketplace/release validation, hook syntax, committed-distribution
checks, and an isolated committed-bundle smoke, and fails if a component
changes a tracked byte or executable mode. CI runs the same gate on the
supported Node lanes:

<!-- release-policy:start -->

Engines: `>=22.20.0 <23 || >=24.11.1 <25`

Version authority: `package.json#/version`; 9 fields in 7 files.

| Evidence              | Node    | Image                   | GitHub Actions job              | Policy   |
| --------------------- | ------- | ----------------------- | ------------------------------- | -------- |
| Supported (blocking)  | 22.20.0 | `node:22.20.0-bookworm` | `release_check_node_22`         | required |
| Supported (blocking)  | 24.11.1 | `node:24.11.1-bookworm` | `release_check_node_24`         | required |
| Forward compatibility | 26.7.0  | `node:26.7.0-bookworm`  | `forward_compatibility_node_26` | advisory |

<!-- release-policy:end -->

Live vendor-permission evidence is a separate manual, protected-ref-only path;
deterministic tests are never labeled as proof of hosted permission behavior.
The [GitHub Actions workflow](.github/workflows/ci.yml) runs on pushes to
`main`, on pull requests, and on manual dispatch; a push to `dev` starts no
hosted run, so run `npm run release:check` locally or dispatch the workflow
by hand. Each lane uses a fresh checkout with read-only
repository permissions and no persisted checkout credentials. Release owners
publish the CLI to npm through the separate
[publish workflow](.github/workflows/publish.yml) described in the
[publication procedure](documentation/releases/public-publication.md). Passing a local
check does not prove a hosted run or configured branch protection.
Candidate identity, evidence classification, human authorization, and rollback
live in the [release checklist](documentation/release-checklist.md); the
detailed evidence rules are in
[Repository release confidence](documentation/orchestrator.md#repository-release-confidence).

## Versioning

Banzai uses one root-owned release-train version across nine persisted fields
in seven files. Root `package.json.version` is the sole authority. The two
plugin manifests, `marketplace.json`, `.agents/plugins/marketplace.json`, and
`packages/orchestrator/package.json` mirror it. The lockfile mirrors it in
`version`, `packages[""].version`, and `packages["packages/orchestrator"].version`.
`.claude-plugin/marketplace.json` remains versionless.

For a product release, select one explicit canonical SemVer target from the
highest impact among all included plugin and orchestrator changes, then run
`npm run version:set -- <version>`. Normal updates require nine equal current
values and a strictly greater target. Missing authority fields are invalid. The
command changes only these nine fields and never runs from build, test,
validation, or release checks. Before removing the main transaction directory,
the command durably writes a fixed `.banzai-version-set.guard` containing the
same bounded originals and candidates; it removes that guard only after the
main removal is synced. `npm run release:validate` is read-only and rejects
drift or any retained `.banzai-version-set`, cleanup-guard, or guard-temporary
state. `npm run version:recover` authenticates every retained journal remnant
against a coexisting guard before it changes targets or recursively cleans the
journal. Use it only to restore the exact originals from an incomplete local
synchronization transaction, not to choose a release rollback version. Each
physical file has one original/candidate snapshot; all three lockfile edits are
coordinated. Recovery reads only grouped seven-file format 2, independently of
the current write policy. It preserves later target edits or mode changes by
refusing restoration before any write. Unsupported journal formats fail closed
with `RESOURCE_VERSION_UNSUPPORTED`.

The common source version does not merge delivery evidence or compatibility
contracts. Record plugin and orchestrator delivery/install/publication states
separately, and continue to use explicit capability and contract negotiation
for runtime compatibility. Repository-maintenance work does not create a bump
unless a release owner explicitly prepares one.

## Conventions

Committed artifacts and code comments use English. Dependencies, commits, and
external writes remain explicit human decisions.

A change that alters planner, implementer, reviewer, verification, fix, or
prompt behavior names the KPI it intends to move in its change record; the KPI
set and its derivations are documented in
[`documentation/evaluation/README.md`](documentation/evaluation/README.md).

A context optimization must additionally name the exact
`banzai-context-report/v1` category or evidence surface it intends to reduce,
the representative baseline cohort and coverage, and the existing outcome KPI
or safety invariant that guards correctness. Use 15–30 representative completed
runs before setting a project limit; keep the change reversible and record the
rollback condition. The evidence surfaces, privacy boundary, selector rules,
and procedure are defined in
[`documentation/context/README.md`](documentation/context/README.md).
