# Release 2.7.4 Version Synchronization

- Date: 2026-10-23
- Scope: the user-selected patch version `2.7.4`.
- Source baseline: `609e3f12e56639294157222b58120ec20dad9f6b` on `dev`.
- Validation runtime: Node.js `v24.11.1`.
- Authority: [ADR-0033](../../decisions/0033-root-package-version-authority.md).
- No separate feature requirements or plan applies to this metadata update.

## Changes

`npm run version:set -- 2.7.4` updated all nine version fields in seven files:
root `package.json`, both plugin manifests, both versioned marketplace
descriptors, the orchestrator package, and the three lockfile fields. The
manifest now records `2.7.4`; the ignored CLI distribution was rebuilt from
the updated metadata. Dependencies and machine-contract versions are unchanged.

The changed documentation consists of `PROJECT_MANIFEST.md` and this report.
No production logic or tests changed. No review findings were applied or
skipped. The existing transaction implements ADR-0033; no new architecture
decision or structural assessment is needed. Engineering Quality deviations:
None.

## Security Exposure

Classes 1 and 7: the existing version setter validates the canonical version,
restricts writes to fixed paths and fields, preserves unrelated bytes and modes,
and provides authenticated transaction recovery. No new exposure was introduced.

## Verification

- `npm run version:set -- 2.7.4`: passed, nine fields across seven files.
- `npm run build:dist`: passed.
- `npm run release:validate`: passed.
- `npm run release:check`: its `verify` component passed all 1,792 tests,
  typecheck, lint, and build parity; formatting and release validation passed.
  The aggregate stopped at `publication` with `INSTRUCTION_PAYLOAD_MISMATCH`
  because the real Git index still contains the pre-bump metadata. Its
  committed smoke component did not run. Raw evidence:
  `.banzai/release-2.7.4-check-GdlgLE`.
- `node packages/orchestrator/scripts/publication-check.mjs --tree working`:
  passed, 570 files classified.
- `node packages/orchestrator/dist/banzai.mjs --version`: `2.7.4`.
- Version-field inspection: all nine values equal `2.7.4`, no retained
  transaction, and the rebuilt CLI retains mode `0755`.
- Hook syntax, change-report formatting, and `git diff --check`: passed.
- `node packages/orchestrator/scripts/release-candidate-check.mjs`: passed
  the complete release gate in a disposable copy with its own Git index.
  All 1,792 tests passed with zero failures, cancellations, or skips;
  typecheck, lint, build parity, formatting, release validation, source/plugin/npm
  publication checks, instruction-payload parity, and committed CLI smoke passed.
  Raw evidence: `.banzai/release-2.7.4-candidate-ADB6vs`.
- Final `git diff --check` and `git diff --cached --exit-code`: passed.
  The real index and baseline commit remain unchanged.

The candidate environment initially exposed two existing local links: the
dangling `node_modules/node_modules` link and `node_modules/.bin/banzai`, which
targets the ignored generated distribution absent before the candidate build.
The first candidate attempt stopped at `UNSUPPORTED_WORKSPACE_LINK` (log:
`.banzai/release-2.7.4-candidate-Qu2sIL`). Both links were preserved outside
`node_modules` for the final candidate check, with automatic restoration on exit.
The candidate builds its own distribution using the unchanged installed package
contents. No validation code or dependency package was modified. Both links were
restored with their exact original targets after the successful check, and the
temporary backup directory was removed.

Assurance uses the existing release and version-transaction checks; no tests
were added for the metadata-only change. Local checks do not establish hosted
CI or delivery. Commit, push, publication, and client installation were not run.
