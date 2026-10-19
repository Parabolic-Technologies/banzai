# Banzai 2.7.2 Version Bump

Date: 2026-10-19

## Scope and Authority

The user explicitly selected version `2.7.2`. This patch updates the existing
release identity under [ADR-0033](../../decisions/0033-root-package-version-authority.md).
No upstream feature artifact applies to this metadata-only task.

## Changes

- Ran `npm run version:set -- 2.7.2` to update nine version fields in seven files:
  root and orchestrator `package.json`, `package-lock.json`, both plugin manifests,
  `marketplace.json`, and `.agents/plugins/marketplace.json`.
- Updated the current version fact in `PROJECT_MANIFEST.md`.
- Rebuilt `packages/orchestrator/dist/banzai.mjs` and its source map.

The source patch increments the shared version from `2.7.1` to `2.7.2` without
changing dependencies, runtime behavior, contracts, or accepted ADRs. No review
findings apply. Engineering Quality deviations: None.

## Security and Assurance

Existing Security Assurance Classes 1 and 7 apply to the version writer's fixed
filesystem targets and metadata replacement. The established validated,
recoverable writer performed synchronization; no control or exposure was widened.
The first sandboxed attempt could not replace the protected `.agents/` mirror
and restored exact originals. The authorized retry completed successfully.

No new tests are needed for a version-only change; existing version, distribution,
and release checks own the relevant guarantees.

## Verification

- `npm run version:set -- 2.7.2`: passed; nine fields in seven files.
- `npm run build`: passed.
- `npm run release:check`: failed at `verify` because the sandbox denied
  loopback HTTP listeners (`listen EPERM: operation not permitted 127.0.0.1`).
  Typecheck passed; lint passed with 0 errors and 415 existing warnings.
  The full test run recorded 1,745 tests: 1,685 passed and 60 failed, with no
  cancelled, skipped, or todo tests. All failures were in
  `release-evidence.test.ts` and reported the same listener restriction.
- Repeated the entire already-built release-evidence test file outside the
  sandbox using `node --test .test-dist/release-evidence.test.mjs` from
  `packages/orchestrator`: 62/62 passed, covering all 60 restricted cases.
  The full release gate was not repeated and is not recorded as passed.
- `npm run build:check`, `npm run format:check`, and
  `npm run smoke:committed`: passed separately.
- `npm run release:validate`: passed, including a final rerun after correcting
  both current-version references in `PROJECT_MANIFEST.md`.
- Publication validation passed in a disposable copy with its own temporary
  Git index: source archive, plugin archive, npm tarball, and all 25 instruction
  resources matched. The direct checkout command compared the unchanged index's
  old bundle with the new working bundle and therefore failed payload parity.
  The standard disposable-candidate helper was blocked by a pre-existing dangling
  `node_modules/node_modules` link; the successful isolated publication check
  linked only its required installed esbuild dependencies. The real index and
  dependency installation were preserved. This checked packaging only, not the
  full disposable release gate.
- `git diff --check` and `git diff --cached --exit-code`: passed.

The full-suite log and focused retry log remain ignored under
`.banzai/logs/version-2-7-2-*.log`. No source or test behavior changed after the
test runs; the final documentation correction updated one additional version
fact. No structural assessment trigger applies, and existing assurance covers
the metadata and distribution guarantees without adding duplicate tests.

No installation, commit, push, tag, or publication was performed.
