# Test Report: Git-visible Work Artifacts

Slug: `git-visible-work-artifacts`

Related artifacts: [description.md](description.md), [plan.md](plan.md),
[implementation-report.md](implementation-report.md),
[ADR-0054](../../decisions/0054-git-visible-work-artifacts.md).

## Assurance ownership

Tests use the existing TypeScript/Node test runner, temporary Git repositories
and shared fake vendor adapters. No live model, remote service, new framework or
test dependency was introduced. Fake adapters prove local protocol enforcement,
not installed-client or provider behavior. Actual package assembly and committed
CLI smoke belong to the unchanged full release gate.

## Historical/pre-fix feedback and commands

Before review-1, the initial fresh `node packages/orchestrator/scripts/release-candidate-check.mjs`
passed with its original plan-pinned driver. It ran all default components with
no fixture replacement or skipped checks:

| Pre-fix component | Historical observed result |
| --- | --- |
| TypeScript typecheck | Passed |
| ESLint | Passed, zero errors; advisory warnings remain |
| Complete Node test suite | 1572 passed, zero failed, cancelled, skipped or todo |
| Committed bundle/resource parity | Passed |
| Prettier check | Passed |
| Release/version/instruction validation | Passed |
| Indexed source and source archive publication | Passed |
| Actual plugin and npm payloads, instruction and source-map parity | Passed |
| Committed CLI smoke | Passed |
| `git diff --check` | Passed after report finalization |

Focused feedback included 50 passing rebuilt-bundle/document/review cases,
13 passing publisher cases, five passing publication cases, a 344-case assurance
batch followed by targeted closure of its two stale expectations, and 17 passing
local pre-push fixture cases. That pre-fix full suite confirmed those earlier closures; no
prior failed command is substituted for final evidence. Exact application of
the local hook patch was also checked in a disposable copy. The real hook was
not changed.

The initial full sandboxed suite exposed outdated release/adoption/recovery
fixtures and local HTTP server tests failed with `listen EPERM`. Corrected
fixtures and the same final gate with required local process permissions passed.
Source publication also caught a literal key header in a negative test; the
fixture now constructs that rejected content at runtime, without weakening the
guard.

The direct checkout candidate preflight refuses genuinely deleted files still
listed in its read-only index. The final source mirror gives the unchanged
driver a matching disposable index and preserves current non-ignored source
bytes, untracked additions and executable modes. Only those deleted paths and
an unrelated dangling `node_modules/node_modules` dependency link are omitted;
all actual installed packages and workspace links remain. Nothing is staged in
the working checkout. The mirror's own complete default release gate runs fresh.

Source baseline: `ead9f328719822d4f630d89f3df5c9af3dc7cb5f`.
Candidate input tree SHA-256: `cac03acb6d48832f1c71482abcaaaf33ccec2307463aaa915ca5f4531457e06f`.
The checked inputs were rehashed unchanged after the gate, before evidence-only
report/index finalization. Native stdout is retained at
`.banzai/verification/74816e2fd54e15645a1278e9a160ccd3d00e927149bff2ce185b7586ea78171c/manual-release-cac03acb6d48832f.log` (ignored).
It is manual execution evidence, not helper applicability or runner authority.

## Risk and Contract Assurance Map

| Material guarantee / impact | Evidence owner and coverage | Deferred evidence owner |
| --- | --- | --- |
| FR1-7, FR16: one visible flat directory; inert declarations; collisions, ignores and symlink escapes cannot overwrite other work | New `work-documents.test.ts`, existing setup/project/hook suites; real temporary Git status and path refusal | Engineer IDE inspection; no UI automation claim |
| FR8-9, FR16: exact document authority; inspect is read-only; failed checks/retries/drift cannot become success; private identity and execution ownership | New helper v3 cases plus existing task-verification, recovery, evidence and concurrency suites | Live process/environment acceptance remains owner controlled |
| FR10-11: immutable approved documents, exact phase grants, selected work inventory, review snapshots and completion publication survive restarts without forged success | Existing workflow, review-artifact, result-scope, completion/publication and plan-task-completion suites adapted to state9/binding3/workspace3/snapshot7/review8 | Independent substantive implementation review |
| FR8/12/13: tracked source work is allowed, raw machine state/credentials remain excluded, actual distribution payloads exclude source work | New source/publication negative cases; existing actual source/plugin/npm archive and source-map tests; installed local pre-push fixture evidence in the delivery record | External publication |
| FR14-15: retired CLI/helper/contracts absent; source, templates, generated resources and release identity agree | Existing import boundaries, instruction-baseline negative tests, release validation, build parity and committed CLI smoke | Installed-client/model smoke after separate delivery |
| FR5/6/11: older documents and records keep original bytes and historical meaning | New preservation/inert-declaration fixture; existing historical state/review/evaluation decoders and negative execution checks | No migration or old-run continuation is an acceptance target |

## Evidence portfolio and critique

The obsolete generalized storage and archive writer tests were removed with
those unsupported product surfaces. Current path/verification tests protect
observable public safety behavior; they do not recreate generic storage CRUD.
Existing approval, scope, review, completion, cancellation and evidence suites
remain the primary owners of their guarantees. Original instruction-baseline
fixtures and transitions remain immutable; explicit authorized transitions and
negative drift checks retain fail-closed coverage.

The critique found material integration seams and added coverage at their
existing owners: canonical review publication must not invalidate its own
preceding verification; rendered Git-visible review must omit the absolute
runtime checkout path while retaining check dispositions and evidence references;
and historical storage projections retain their original field requirements.
Recovery fixtures now explicitly account for missing selected documents and
deduplicated workspace3 paths without changing eligibility reasons or gates.
The failure injection for completion replacement targets its new private
temporary file, so it still exercises resumable I/O refusal without changing
Git-visible source during the check.
Failure/retry/changed-authority tests exercise real local child processes, without
claiming provider sandbox behavior. No percentage or test-count quota is used as
acceptance authority. Hosted CI, live provider behavior and installed clients are
unverified; no local/fake result substitutes for them.

## F1-F3 fix verification (historical/pre-delivery)

The owner accepted review-1 findings F1, F2 and F3. All preceding command totals
are historical/pre-fix. The corrected tree passed the unchanged mandatory
`node packages/orchestrator/scripts/release-candidate-check.mjs` through the same
exact disposable source mirror with its own index and real dependencies.

| Pre-delivery source-fix check | Observed result and physical origin |
| --- | --- |
| Full final release-candidate gate | Passed all default components; 1581 tests passed; zero failed, cancelled, skipped or todo |
| Typecheck and ESLint | Passed; zero lint errors, 382 advisory warnings |
| Build/resource and committed bundle parity; formatting | Passed |
| Release/version/instruction validation | Passed |
| Actual source, plugin and npm payloads; instruction/source-map parity | Passed |
| Committed CLI smoke | Passed |
| Mandatory `git diff --check` | Passed |
| Focused store, helper, review, task verification/recovery and completion/evidence batch | 114 passed; `manual-f1-f3-focused-114.log` |
| Supplemental bootstrap/PTY, cancellation and privacy batch | 59 passed; `manual-f1-f3-bootstrap-59.log` |
| Supplemental verification utilities, historical review decoder and import-boundary batch | 45 passed; `manual-f1-f3-utilities-and-decoders-45.log` |

The focused batches overlap; their totals are not summed. They are actual
standalone checks. The complete gate owns the named pre-delivery source snapshot;
it does not certify later local-hook, configuration or documentation changes.
The six new targeted regressions failed before production edits, then passed
with the fix; their native pre-fix origin is `manual-f1-f3-pre-fix-six-regressions.log`.

The F1-F3 gate's exact candidate input SHA-256 is
`10644445cefcee4a25efefdf8d32aa80c196488965ac43b2c57b91486452b8ce`, baseline
HEAD `ead9f328719822d4f630d89f3df5c9af3dc7cb5f`. Inputs were rehashed unchanged
after the gate and before evidence-only finalization of the implementation,
test and change reports. The approved driver remains SHA-256
`698a35eebd4a7d5abf992d3ddbbb973d0332d350119fd99e70df57adf33f7eeb`.

All named native logs are retained under the effectively ignored directory
`.banzai/verification/74816e2fd54e15645a1278e9a160ccd3d00e927149bff2ce185b7586ea78171c/`.
The final gate origin is `manual-release-f1-f3-10644445cefcee4a.log`, with the
verbatim source capture in `manual-release-f1-f3-10644445cefcee4a-source.json`.
These manual files create no helper applicability, runner approval or completion
receipt. The earlier failed final attempts remain separately identified in
`manual-f1-f3-failed-gate-lint.log` and `manual-f1-f3-failed-gate-fixtures.log`.
They are failures, not partial passes or substitutes for the final gate.

The first fix gate exposed missing explicit lower-level import permissions and
test catch typing; the next exposed non-Git legacy fixtures and the bootstrap
lock being created before its ignore rule. The explicit dependency map and
fixtures were corrected, and init/setup now establish the narrow ignores before
lock publication. Existing cancellation, utility, retry, recovery and PTY
assertions remain. No release component or approved obligation was weakened.

F1 adds nine material behavioral cases in `work-documents.test.ts`, including
nested log/record/temporary exceptions, changed exclusions with an existing
identity, tracked identity and runner private writes. The existing review
publication case also checks a private temporary exception. Existing suites
continue to protect successful, failed, interrupted and explicitly retried
physical checks, immutable origins and canonical report publication. F2 is
covered by reference-aware deletion and retained historical decoding/refusal
suites; F3 by source/contract inspection and the committed capabilities smoke.
No test quota or new framework was introduced.

All eight source-implementation tasks have completion claims for the recorded
snapshot. Independent resolution review, installed-client/model smoke, hosted
CI and external publication retain their separate ownership. Existing work
documents, archives and run records remain at their original locations; the
declaration was removed in the separately authorized delivery below.

## Owner-authorized local-hook delivery

On 2026-10-13 the prepared patch was installed in the real checkout and
`.banzai/artifacts.json` was deleted under explicit owner instruction. All three
original hashes matched; the installed two-file patch matches the tested bytes.
The supplied suite passed all 17 tests against copies of the installed modules
and original wrapper, including new work without a declaration and refusal of
private evidence in outgoing history. Both installed modules passed
`node --check`; the original wrapper passed `sh -n`.

The exact command, installed hashes and ignored native log are recorded in
[local-hook-delivery.md](local-hook-delivery.md#current-delivery-status).
The source release gate above was not rerun for this bounded delivery; its
results remain historical/pre-delivery evidence for the named source snapshot.
No real remote push or provider/client acceptance is inferred from these local
fixture results.
