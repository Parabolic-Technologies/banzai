# GitHub Release Notes as the Sole Source

Date: 2026-10-23

## Scope and Changes

The owner requested GitHub Releases as the sole maintained source of release
notes, removal of local version notes, and retention of the publication procedure.
No separate feature requirements or plan applies to this documentation change.

- Updated `documentation/release-checklist.md` and
  `documentation/releases/public-publication.md` to prepare and review notes in
  GitHub draft releases. Version bumps require no local release-note file.
- Deleted the nine local notes for `2.2.0`, `2.2.1`, `2.2.2`, `2.3.0`, `2.4.0`,
  `2.5.0`, `2.6.0`, `2.7.1`, and `2.7.3`, and removed their exact entries from
  `publication-policy.json`.
- Recorded the convention in `PROJECT_MANIFEST.md` and changed the old `2.7.3`
  report's Markdown link to its verified GitHub Release URL.
- Preserved the publication procedure's delivery record and existing version
  `2.7.4` changes. This task changes no runtime source, tests, or publication
  workflow.

The current GitHub API returned no published release for `v2.2.0`, `v2.2.1`,
`v2.2.2`, `v2.3.0`, or `v2.6.0`. The requested local deletions still apply;
their original text remains in Git history. No GitHub release was created or
edited, and this change does not claim that GitHub contains the complete
historical notes archive.

## Conformance and Assurance

[ADR-0039](../../decisions/0039-npm-trusted-publishing-on-github-release.md)
and [ADR-0053](../../decisions/0053-single-pull-request-ci-gate-and-publish-evidence-reuse.md)
retain publication authorization and CI evidence ownership. A draft is not
publication authorization; the publication workflow remains unchanged.
No ADR lifecycle changes or review findings apply. Engineering Quality
deviations: None. No executable implementation or structural trigger is added.

Security exposure, Class 7: deletion is limited to the nine explicitly authorized
tracked files; the publication procedure and delivery evidence remain, and
the originals are recoverable from Git. Inventory entries are removed only for
those files, preserving the existing publication boundary.

Existing publication and release checks own assurance. No new tests are needed
for the documentation and inventory change. Historical work descriptions and
approved plans keep their original statements; the corrected hyperlink does
not rewrite their original evidence.

## Verification

- GitHub API release inventory: read successfully; `v2.7.3` resolves to the
  canonical URL used by the corrected link.
- Content and link inspection: passed. Only `public-publication.md` remains in
  the releases directory; all nine deleted originals match recoverable Git
  history; no Markdown hyperlinks reference deleted notes or the replaced
  section anchor. The delivery record is byte-identical to the starting state.
- Publication inventory comparison: passed; exactly the nine removed paths
  were pruned, with every other inventory value preserved.
- `node packages/orchestrator/scripts/publication-check.mjs --tree working`:
  passed, 561 tracked files classified in clean mode.
- `npm run release:validate`: passed before the full candidate run.
- `npm run release:check` in an isolated snapshot with its own Git index and
  dependency copy: passed on Node `v24.11.1`. All 1,792 tests passed with no
  failures, cancellations, or skips; typecheck, lint, build parity, formatting,
  release validation, source/plugin/npm checks, instruction-payload parity,
  and committed CLI smoke passed. Raw log and captured input hashes:
  `.banzai/github-release-notes-verification-h6KhH9/release-check.log` and
  `inputs.json` in that directory. The temporary candidate was removed.
- Targeted Prettier checks and `git diff --check`: passed.
- Final scope comparison: this task's maintained documents and inventory match
  the tested snapshot; the previous `2.7.4` metadata/report, delivery record,
  and real Git index retain their original hashes.

The wrapper's final source-consistency assertion failed because a parallel task
changed `packages/orchestrator/MODULES.md`, `src/ansi.ts`, `src/interactive.ts`,
and `test/interactive.test.ts` (the latter paths are under the same package)
while the isolated check ran. It also added
`documentation/work/cli-text-header-polish/change-report.md`. These changes were
preserved and are outside this task. `result.json` retains that wrapper failure;
`source-drift.json` records the changed input hashes. The full release pass
applies to the captured snapshot, not the later combined working tree. The
documentation and inventory changes in this task match their tested bytes.
