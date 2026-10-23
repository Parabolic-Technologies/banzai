# Release 2.7.3 preparation

Date: 2026-10-20

## Change

Applied the owner-selected `2.7.3` release version using `npm run version:set --
2.7.3`: nine fields across seven files. Rebuilt the committed CLI bundle and
source map, updated both current-version facts in `PROJECT_MANIFEST.md`, and
added [release notes](https://github.com/Parabolic-Technologies/banzai/releases/tag/v2.7.3).

The release content covers the README and documentation refresh already in
commit `88ed48f` and the Parabolic logo asset updates. The release notes are
classified as maintainer documentation under the existing publication policy.

Changed release-preparation files: root `package.json` and `package-lock.json`,
the orchestrator package, both plugin manifests, both versioned marketplace
manifests, `packages/orchestrator/dist/banzai.mjs` and its source map,
`PROJECT_MANIFEST.md`, `publication-policy.json`, the release notes and this
report. Existing logo edits are retained.

Security exposure: none created or widened by the version and documentation
updates. Publication controls are unchanged. No ADR lifecycle change, review
finding, Engineering Quality deviation or structural assessment trigger applies.
No upstream feature plan was selected; the existing version transaction remains
the owner of synchronization.

## Verification

- `npm run version:set -- 2.7.3`: passed, all nine fields synchronized.
- `npm run build`: passed.
- `node packages/orchestrator/dist/banzai.mjs --version`: `2.7.3`.
- Initial `npm run release:check`: stopped during tests in the sandbox;
  1,685 passed and 60 failed because loopback HTTP fixtures could not bind
  (`listen EPERM`). Typecheck and lint completed before the test stage.
- `node packages/orchestrator/scripts/test.mjs --file release-evidence.test.ts`
  outside the sandbox: 62 passed, including every previously blocked test in
  that file.
- Direct `npm run build:check`, `npm run format:check`,
  `npm run release:validate`, `npm run smoke:committed` and
  `node --check plugins/banzai/hooks/spec-gate.cjs`: passed.
- Direct `npm run publication:check`: rejected the unstaged checkout because
  the source archive uses the old Git index while npm packs the new bundle.
- `node packages/orchestrator/scripts/publication-check.mjs --tree working`:
  passed, 559 files classified in clean mode with no historical exposure.
- `node packages/orchestrator/scripts/release-candidate-check.mjs`: blocked
  before its checks by `UNRESOLVED_DEPENDENCY_LINK: node_modules/node_modules`.
  That pre-existing symlink points to an unavailable temporary checkout. The
  dependency installation and the real Git index were left unchanged.
- Prettier checks of the release notes, change report, publication inventory
  and asset guide, plus `git diff --check`: passed.

No new tests are needed for metadata, documentation and generated-version
changes. The executed checks cover version synchronization, bundle parity and
CLI smoke behavior; the aggregate release gate has not passed. A complete
candidate check still requires a usable dependency tree. There are no unresolved
implementation triggers or accepted review findings.
