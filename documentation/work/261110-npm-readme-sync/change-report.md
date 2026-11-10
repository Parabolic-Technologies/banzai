# Change Report: npm Package README Sync

- Date: 2026-11-10
- Requested by: the owner, in chat on 2026-11-10, after noticing that the
  npm page for `@parabolic-technologies/banzai` differed from the root
  `README.md`; the owner then asked to record the sync rule in the manifest.
- Upstream feature artifacts: none. ADRs: none affected.

## What changed

- `packages/orchestrator/README.md` now mirrors the root `README.md`
  section by section: requirements with Node.js 26, team and local model
  configuration, Claude Code plugin scope, the numbered setup table, the
  illustrated strict workflow, the safety boundary, the five decision gates,
  plugin-only skill use, documentation and community links, advanced
  references, and the author and license section.
- Intended differences only: repository links and images use absolute
  GitHub and `raw.githubusercontent.com` URLs on `main`, legacy `<a id>`
  anchors are omitted, and the npm install command is kept.
- `PROJECT_MANIFEST.md` section 9 records that the package README mirrors the
  root README, lists the intended differences, and states that no release
  check compares the two files.

## Why

npm renders the package directory's README, not the root one. The package
README was last aligned on 2026-10-19 and had since missed Node.js 26 support
(already in the published 2.8.1 `engines`), local model overrides, plugin
scope, plugin-only skill usage, and the gates and safety-boundary text.

## Security exposure

None applies: the change edits documentation text only.

## Files changed

- Production: none.
- Tests: none.
- Docs: `packages/orchestrator/README.md`, `PROJECT_MANIFEST.md`, this report.

## Documentation sync

The manifest records the new convention. The root `README.md`,
`documentation/getting-started.md` and `documentation/orchestrator.md` were
already current and are unchanged.

## ADR conformance

No ADR governs README content; no lifecycle change.

## Engineering Quality deviations

None.

## Verification

- A script rewrote the root README's relative links to absolute URLs, dropped
  `<a id>` anchors, and formatted the result with Prettier. Its diff against
  the package README showed only the npm install block.
- All 41 GitHub links in the package README, including heading anchors,
  resolve against both the working tree and `origin/main`.
- `npx prettier --check` passed for both READMEs and `PROJECT_MANIFEST.md`.
- Not run: `npm run release:check`. Its README rules check root README
  phrases and the npm payload file list, and neither changed.

## Assurance critique

No automated test protects README parity; the manifest convention is the
current control. The npm page changes only with the next publication.

## Structural assessment

Not applicable: documentation-only change with no semantic trigger.
