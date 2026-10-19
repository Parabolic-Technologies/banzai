# Change Report: Historical Run Inspection

Date: 2026-10-15.
Authority: the owner reported the failure from a project upgraded to 2.7.1 and
approved this quick-fix scope: status, the interactive home and doctor present a
historical run as read-only, the CLI keeps the real error code, and regression
tests protect both. The version bump is decided separately.
Affected work: [git-visible-work-artifacts](../git-visible-work-artifacts/description.md)
AC09. Decision: [ADR-0054](../../decisions/0054-git-visible-work-artifacts.md).

## Defect

Any project whose active-run pointer references a run created by 2.6.x or earlier
(state 4–8 with work binding v1/v2) could not use `banzai`, `banzai status` or
`banzai model`:

```text
[UNEXPECTED_ERROR] Historical work can be inspected but cannot resume execution. Start new work without migrating its documents.
```

`WorkflowRunner.status` revalidated the latest review through `workspaceDigest`,
whose selected-document inventory calls `inspectBoundWork`, which refuses every
binding older than v3. The shared library throws `ProjectFileError`, which the
CLI boundary did not recognize, so its `ARTIFACT_VERSION_UNSUPPORTED` code was
printed as `UNEXPECTED_ERROR`. `banzai doctor` reported the same run as a
`run.active` failure with "missing, malformed or conflicting artifact binding
evidence". The interactive home calls status first, so it could never reach
"Start a new run". This contradicted AC09: upgraded tooling must inspect old
persisted versions and report their actual compatibility.

## Changes

- `work-documents.ts` adds `isHistoricalWork`, which delegates parsing to the
  shared `parseBinding` and identifies bindings older than v3.
- `WorkflowRunner.status` skips review revalidation for historical work
  (`reviewValid: null`), reports its task completion as `legacy` with a
  read-only diagnostic instead of a false `inconsistent`, and recommends no
  action for a terminal run and only `banzai cancel` for an unfinished one.
  `historicalRunNotice` supplies one shared read-only notice.
- `banzai status` prints the notice as `History:`; the interactive home renders
  it and offers only `Cancel run` or `Exit` for an unfinished historical run.
- Doctor inspects a binding v1/v2 run in state ≤8 without `inspectBoundWork`: a
  terminal run passes as read-only history and an unfinished one warns with a
  `banzai cancel` remedy. An older binding in state 9 or 10 still fails.
- The CLI boundary prints the stable code of a shared-library `ProjectFileError`.
- `getting-started.md`, `orchestrator.md`, `MODULES.md` and the manifest state
  the read-only presentation.

No historical bytes, bindings or documents are migrated or rewritten, and no
execution path gains authority: `resume` still refuses historical work.

## Security exposure

None applies: the change reads already-persisted local state, adds no input
path, identity decision, secret handling or destructive effect, and the printed
error codes are fixed library identifiers.

## Files

- Production: `packages/orchestrator/src/{work-documents,workflow,cli,interactive,doctor}.ts`
  and the rebuilt `packages/orchestrator/dist/banzai.mjs{,.map}`.
- Tests: `test/{helpers,workflow-fixtures}.ts` add a binding v2 fixture and an
  ageing helper; `workflow-review` and `cli-routing` add two cases each, and
  `doctor` and `interactive` add one each.
- Docs: `documentation/getting-started.md`, `documentation/orchestrator.md`,
  `packages/orchestrator/MODULES.md`, `PROJECT_MANIFEST.md`.

No review finding initiated or was skipped by this fix.

## ADR and Engineering Quality

Conforms to ADR-0054: historical runs stay read-only evidence with no migration
or continuation. No ADR lifecycle change. No material Engineering Quality
deviation.

Structural assessment (semantic near-duplication trigger). Reuse search by
behavior and by `schemaVersion !== 3` found the version gate in
`plugins/banzai/lib/work-documents.mjs` `inspectBoundWork` and in
`hooks/spec-gate.cjs`; `configuration-prerequisite.ts` reads binding versions
for configuration semantics, a different rule. Owner: the shared library owns
binding decoding and the execution refusal; `work-documents.ts` is its typed
projection, which status, home (through `historicalRunNotice`) and doctor
already import. Disposition: retained in the projection. Parsing stays with the
shared `parseBinding`; only the version comparison is repeated. Extracting it
into the library is the better final owner, but every edit under
`plugins/banzai/lib` is hook runtime and requires a release version bump, which
the owner scheduled separately. Debt: a future binding v4 must update both
comparisons; move the predicate into the library with the next hook-runtime
change. Authority: within the approved scope.

## Verification

- Reproduction before the fix: in an upgraded project whose pointer referenced a
  `done` state-8 run with private binding v2, `banzai status` and bare `banzai`
  failed with the reported line; the stack ran `status` → `workspaceDigest` →
  `workDocumentInventory` → `inspectBoundWork`. Doctor reported `run.active` as
  failed.
- Both new committed-CLI tests failed against the pre-fix bundle with
  `[UNEXPECTED_ERROR]` and passed after `npm run build`.
- Focused runs of the new `workflow-review`, `doctor`, `interactive` and
  `cli-routing` cases: all passed.
- `prettier --check` on every changed TypeScript file: passed. The three edited
  Markdown documents were already unformatted at `HEAD` and were not reformatted.
- `npm run verify` on the final tree: passed. Typecheck passed; lint reported
  0 errors and 415 advisory warnings, none on changed lines; 1745 tests passed
  with 0 failed, cancelled, skipped or todo; committed `dist/` parity passed.
- `git diff --check`: passed.
- The same upgraded project after the rebuild: `banzai status` exited 0 with the
  `History:` notice and no stale review claim; `banzai doctor` reported
  `run.active` as passed and `failed=0`. Only read-only commands were run there.

No change under `plugins/banzai/` was made, so the hook runtime is unchanged.
`release:check`, version synchronization and release publication were not run;
the release version is decided separately.

## Assurance critique

Each new test protects an observable guarantee not covered before: status of a
historical done run with a review (the reported crash), the cancel-only exit of
an unfinished one followed by new work, doctor's three outcomes, the
interactive choices, the committed CLI status output and the CLI error code.
Both committed-CLI tests failed against the pre-fix bundle with the reported
`[UNEXPECTED_ERROR]` lines and pass after the rebuild.

## Follow-ups

- `approvePlan` on a historical run waiting for plan approval records the
  approval instead of refusing it; execution is still refused at the next
  model attempt. This predates the fix and is outside its scope.
- The interactive home still attaches human-time records to a historical
  run's directory, as it did before.
