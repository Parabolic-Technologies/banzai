# Company Name and Contribution Copyright Correction

Date: 2026-10-15

Scope: maintainer documentation and attribution. No upstream feature artifact
applies. The user authorized the company-name correction and the contribution
copyright clarification. This report is required because the change updates
`PROJECT_MANIFEST.md`.

## Changes

- Corrected 15 company-name occurrences in 12 files to
  `Banzai International, Inc. d/b/a Parabolic`, following legal feedback.
- Clarified that the contributor or applicable copyright holder retains
  ownership and that no copyright assignment is required.
- Kept all three `LICENSE` copies byte-identical to their pre-edit versions.
  All three updated `NOTICE` copies remain identical.
- Preserved pre-existing changes and all other bytes in the 12 selected files.
  No source code, dependency, version, tag, or publication setting changed.

## Files Changed

- `.claude-plugin/marketplace.json`
- `CONTRIBUTING.md`
- `NOTICE`
- `PROJECT_MANIFEST.md`
- `README.md`
- `TERMS_OF_USE.md`
- `TRADEMARKS.md`
- `documentation/releases/2.2.0.md`
- `documentation/releases/2.2.1.md`
- `documentation/releases/public-publication.md`
- `packages/orchestrator/NOTICE`
- `plugins/banzai/NOTICE`

This change report is the only additional file.

## Scope and Conformance

- Security exposure: none; these text and display-name changes create or widen
  no executable, access-control, secret-handling, or publication mechanism.
- Documentation sync: corrected the existing product-owner fact in the
  manifest and the corresponding attribution and release documents.
- ADR conformance: no architectural decision or lifecycle changed. Report
  placement follows [ADR-0054](../../decisions/0054-git-visible-work-artifacts.md).
- Skipped requested changes: none. No numbered feature-review findings apply.
- Material Engineering Quality deviations: none. Structural assessment and
  reuse discovery do not apply to this non-executable text correction.

## Verification

- Inline `python3 -` content verification against a pre-edit snapshot: passed.
  Each selected file equals its original bytes with only the authorized
  replacements. No old company-name occurrence remains in tracked files.
  The marketplace JSON parses and contains the corrected owner name.
- SHA-256 comparison of all three `LICENSE` copies: unchanged. Direct byte
  comparison of all three updated `NOTICE` copies: identical.
- `git diff --check -- <12 selected paths>`: passed.
- `npm run release:validate`: passed.
- `node packages/orchestrator/scripts/publication-check.mjs --tree working`:
  passed for 534 tracked working-tree files in clean mode. This does not
  inspect untracked files, Git history, or hosted GitHub content.
- Assurance critique: focused content, parity, JSON, and release validation
  cover the requested edits. No runtime tests were added or run because no
  executable behavior changed; the full release gate was not run.

No staging, commit, push, or publication was performed.
