# Release 2.8.0 Version Synchronization

- Date: 2026-11-09
- Scope: the `2.8.0` release-train version of the 2.8–2.9 program's Gate 1.
- Source baseline: `d84ba84` on `dev`.
- Validation runtime: Node.js `v24.11.1`.
- Authority: [ADR-0033](../../decisions/0033-root-package-version-authority.md)
  and the [program tracker](../release-2-8-2-9-program/tracker.md) decision of
  2026-10-31. The owner approved moving on to this step on 2026-11-09.
- No separate feature requirements or plan applies to this metadata update.

## Changes

`npm run version:set -- 2.8.0` updated all nine version fields in seven files:
root `package.json`, both plugin manifests, both versioned marketplace
descriptors, the orchestrator package, and the three lockfile fields. The
manifest now records `2.8.0`, and the ignored CLI distribution was rebuilt.
Dependencies and machine-contract versions are unchanged.

Installed plugin caches refresh on this version change, so clients receive the
hook and library changes of WP2–WP21 once the plugin is delivered.

The changed documentation is `PROJECT_MANIFEST.md`, this report, and the program
tracker and Gate 1 report. This version change touches no production logic or
tests. The same working tree also holds the fix for WP21's third false positive in
`plan-task-completion.ts` and its test, recorded in the WP21
[change report](../wp21-planner-digest-and-retry/change-report.md).

## Security Exposure

Classes 1 and 7: the existing version setter validates the canonical version,
restricts writes to fixed paths and fields, and provides authenticated
transaction recovery. No new exposure was introduced.

## Verification

- `npm run version:set -- 2.8.0`: passed, nine fields across seven files.
- `npm run build` and `npm run build:dist`: passed, with no other tracked change.
- `npm run release:validate`: passed. The deferred
  `HOOK_CHANGED_WITHOUT_VERSION_BUMP` is gone, and it was not hiding any other
  failure.
- `node packages/orchestrator/dist/banzai.mjs --version`: `2.8.0`.
- `node packages/orchestrator/scripts/release-candidate-check.mjs`: passed on the
  final tree, including WP21's third fix: `verify` 2153 of 2153 tests and 0 lint
  errors, formatting, release validation, the publication check (640 files) and
  committed smoke. An earlier run on the bytes before that fix also passed, with
  2153 of 2153 tests. `node_modules/.bin/banzai` and the dangling
  `node_modules/node_modules` link were set aside for each run and restored to
  their exact targets afterwards.

Local checks do not establish hosted CI or delivery. Commit, push, publication,
client installation and live vendor runs were not performed.
