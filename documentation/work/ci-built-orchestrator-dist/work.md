# Feature: Build the orchestrator distribution in CI

Slug: ci-built-orchestrator-dist

## Related artifacts

- [Issue #7](https://github.com/Parabolic-Technologies/banzai/issues/7).
- Accepted [ADR-0009](../../decisions/0009-supported-node-release-matrix.md),
  [ADR-0010](../../decisions/0010-blocking-and-advisory-release-evidence.md),
  [ADR-0039](../../decisions/0039-npm-trusted-publishing-on-github-release.md),
  and [ADR-0053](../../decisions/0053-single-pull-request-ci-gate-and-publish-evidence-reuse.md).
- Accepted [ADR-0056](../../decisions/0056-ci-built-orchestrator-distribution.md).
- [Review 1](./review-1.md), finding R1-F1.
- [Review 2](./review-2.md), R1-F1 verified resolved and new finding R2-F1.
- [R2-F1 change report](./change-report.md).
- [Review 3](./review-3.md), verdict `pass`, R2-F1 verified resolved and no
  new findings.

## Review disposition

On 2026-10-21, the owner accepted R1-F1, requested the proposal, and subsequently
accepted ADR-0056 explicitly in chat. The acceptance record identifies the
proposal by SHA-256. Reciprocal lifecycle links and both decision indexes now
record the accepted replacement of committed distribution output.

Review 2 **verified R1-F1 resolved** and reported a new publication-inventory
blocker, R2-F1, with verdict `changes_requested`. The owner accepted R2-F1 on
2026-10-21 and requested its exact inventory entry plus fresh publication and
release checks in a source-only candidate. The exact maintainer entry is added;
fresh publication and release checks passed, including all 1746 tests. Final
report synchronization and its publication check also passed. Review 3 then
**verified R2-F1 resolved** with verdict `pass` and no new findings. Both
accepted findings are independently resolved; no finding disposition remains.
ADR-0056 and both indexes now record implementation state `Implemented` for
the verified source change. Hosted CI and npm delivery remain separate release
evidence. All review artifacts retain their original bytes.

## Goal

Build the CLI bundle and source map from the selected source checkout during
CI and publication, and ship them in npm without storing them in Git.
Release authorization, supported Node versions, runtime contracts, plugin
delivery, dependencies, and the release version are outside this change.

## Requirements

1. **FR1:** Remove both `packages/orchestrator/dist/banzai.mjs` and its `.map`
   from the source tree and ignore subsequent local build output.
2. **FR2:** The deterministic release gate and the npm publish job build the
   distribution from their own checkout before consuming it, including the
   reused-evidence path. The manual live job also builds before CLI execution.
3. **FR3:** CI builds only ignored distribution output. Generated tracked
   instruction resources remain checked for drift without repair. Bundle/map
   parity, executable mode, isolated CLI smoke, tracked-file non-mutation,
   and build failure propagation remain enforced.
4. **FR4:** The npm tarball contains the executable bundle and source map.
   Publication checks compare packed bytes with the local build and retain
   source/plugin/embedded-instruction parity without requiring source archives
   to include `dist`. Every bundled source-map input must match the source
   archive, including CLI source and package metadata.
5. **FR5:** Preserve release trigger, exact tag/version checks, both supported
   verification lanes, evidence reuse, npm environment, OIDC permissions,
   ignore-scripts publication, and skip-existing behavior.
6. **FR6:** Contributor/release guidance and the manifest describe the new
   build prerequisite and generated-output ownership accurately.

## Assumptions & Decisions

1. **Accepted architecture:** The owner accepted ADR-0056 on 2026-10-21. It
   partially supersedes ADR-0009 and ADR-0010's committed-output provisions and
   amends ADR-0053's build prerequisites. FR1-FR4 use that accepted authority;
   FR5 retains the remaining release guarantees, and FR6 records current
   behavior. All accepted decision bodies remain unchanged.
2. **Sensible default:** Reuse `build.mjs` with a distribution-only option;
   preserve explicit `npm run build` for refreshing tracked generated modules.
3. **Manifest convention:** Keep `smoke:committed` as a compatible command
   name for the existing smoke suite, now operating on locally built output.
4. Security exposure class 7: this change feeds the existing npm publication
   boundary; FR4 and FR5 retain its payload checks and authorization controls.
   No new credential, access rule, or publication authority is introduced.

## Implementation Plan

1. Remove the two generated files and their ignore exceptions. Add
   `build:dist` using the existing build owner. Run it before the release
   gate's checks and explicitly in publish/live jobs.
2. Update distribution diagnostics and publication parity to compare the
   local generated output with the npm tarball. Keep stale-output refusal.
3. Adapt release fixtures to build from source, and extend existing build,
   publication, and workflow regression tests for FR1-FR5.
4. Update affected current guidance and manifest facts; run focused checks
   followed by the full release gate in a disposable source candidate.

Structural assessment: the added CI build phase uses existing `build.mjs`
and `release-check.mjs` owners; workflows compose them, while `check-dist.mjs`
and `phase-resources-build.mjs` retain parity ownership. Reuse search covered
these scripts, `publication-release.mjs`, `check-release.mjs`, their callers,
and release/publication tests. Disposition: **reused/retained**. An additional
builder or artifact-download lifecycle would duplicate existing ownership.
The build writes only ignored `dist`; tracked generated sources, release
identity, evidence binding, and publication permissions remain unchanged.
The user migration request defines the feature intent and accepted ADR-0056
defines release-output authority. The compliance mapping below relates the
implementation to that decision. Tests and a source-only candidate own
local assurance; hosted publication remains separate delivery evidence.

The scoped ESLint baseline has 10 warnings and no errors. After implementation
it still has 10 warnings and no errors; `checkInstructionPayloads` complexity
changes from 17 to 21 (configured advisory threshold: 15). Retention is
intentional: source/plugin identities, embedded instruction bytes and packed
build parity are one publication invariant over the same candidate. Extracting
individual comparisons would split that joint failure boundary and add an
interface over the same candidate data without separating an independently
changing responsibility. No new owner or dependency is added.

## Files Changed

- `.gitignore`, `packages/orchestrator/dist/banzai.mjs` and `.map`: remove the
  two generated source files and their ignore exceptions.
- Root/workspace `package.json`, `scripts/build.mjs`, `scripts/release-check.mjs`:
  distribution-only build and its ordering before deterministic verification.
- `.github/workflows/ci.yml`, `.github/workflows/publish.yml`: explicit builds
  before live CLI execution and npm publish-path validation, respectively.
- `scripts/check-dist.mjs`, `scripts/check-release.mjs`: local-build parity
  diagnostics and validated publish/live build ordering.
- `scripts/phase-resources-build.mjs`: compare npm bytes with built output while
  preserving source/plugin and embedded instruction checks.
- `test/release-validation.test.ts`, `test/release-check.test.ts`,
  `test/publication.test.ts`: source-only fixture builds, stale-resource and
  failed-build behavior, publish ordering, and distribution payload regressions.
- `packages/orchestrator/.prettierignore`, `packages/orchestrator/MODULES.md`,
  `PROJECT_MANIFEST.md`, `CONTRIBUTING.md`, `documentation/orchestrator.md`,
  `documentation/release-checklist.md`, `documentation/publication-boundary.md`,
  `documentation/releases/public-publication.md`: current build/storage and
  release instructions. Script/test paths above are workspace-relative.
- `documentation/decisions/0056-ci-built-orchestrator-distribution.md`, the
  lifecycle sections of ADR-0009, ADR-0010 and ADR-0053, the decision log and
  the manifest's ADR index: record owner acceptance and its narrow architectural
  effect. This feature record carries the R1-F1 resolution-review handoff.
- `publication-policy.json`: classify the exact ADR-0056 path as `maintainer`
  for accepted finding R2-F1. The fix's `change-report.md` owns fresh candidate
  and gate evidence for the next independent review.

## R1-F1 resolution-review handoff (historical)

Accepted scope: R1-F1 from [review 1](./review-1.md). The owner accepted both the
finding and ADR-0056 in chat on 2026-10-21. The accepted proposal SHA-256 is
`eadc199ffb17d79a7bfa8b72489e8676ec1281459a5aa4e83188ee39e67e1b29`.

The remediation records the accepted authority, reciprocal lifecycle links and
consistent indexes. ADR-0009, ADR-0010 and ADR-0053 remain Accepted for their
retained provisions. The current implementation uses per-lane source builds
and local rebuild/npm byte parity; it does not compare artifacts between jobs.
Review 2 subsequently verified this finding resolved. This section retains the
handoff and evidence boundary assessed by that review.

| ADR-0056 confirmation                                      | Requirements and implementation evidence                                                                     | Evidence boundary                                                                                                                                                                                        |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1: ignored source output, npm payload                      | FR1/FR4; `.gitignore`, package `files`, source-only candidate and actual package inventory                   | Original candidate omitted both indexed dist files; npm contained the bundle and map. Real-checkout deletions remain unstaged.                                                                           |
| 2, 3, 7: lane/build ordering and retained release controls | FR2/FR5; `release-check.mjs`, `ci.yml`, `publish.yml`, `check-release.mjs` and workflow mutation regressions | Source and recorded tests cover both configured Node lanes, reuse/fallback and live prerequisites. The full local gate ran on Node 24.11.1; hosted two-lane execution and publication remain unobserved. |
| 4, 5: non-mutation, parity, executable mode and smoke      | FR3; `build.mjs`, `check-dist.mjs`, `release-check.mjs`, release-validation tests and isolated smoke         | Retained local evidence covers clean builds, stale-resource refusal, build failure, byte parity and mode `0755`.                                                                                         |
| 6: source/plugin/map/npm correspondence                    | FR4; `phase-resources-build.mjs`, `publication-release.mjs` and `publication.test.ts`                        | Actual archive tests reject missing or changed CLI source, package metadata, instructions, bundle and map; packed bytes match the local build.                                                           |
| 8: contributor and release guidance                        | FR6; `CONTRIBUTING.md`, `documentation/orchestrator.md`, release/publication guides and manifest             | Current source guidance requires a build; npm continues to contain ready-to-run output.                                                                                                                  |
| 9: architectural lifecycle and independent assessment      | Accepted ADR-0056, reciprocal links on ADR-0009/0010/0053, decision log, manifest row and this handoff       | Review 2 verified R1-F1 resolved. Its separate R2-F1 publication-inventory blocker requires correction and fresh release evidence.                                                                       |

Script and test names above are under `packages/orchestrator/scripts/` and
`packages/orchestrator/test/`; workflows are under `.github/workflows/`.

Review 2 assessed this record, unchanged `review-1.md`, accepted ADR-0056 and
its linked decisions, both decision indexes, the pending feature diff and the
retained verification evidence below. It resolved R1-F1 and identified R2-F1 as
a distinct consequence of adding the ADR. Current fix scope and fresh evidence
are recorded in [change-report.md](./change-report.md). The subsequent independent
[review 3](./review-3.md) verified R2-F1 resolved with verdict `pass`; this
implementation record does not replace that review.

## Verification

The results below predate R2-F1 unless explicitly labeled otherwise. They are
historical evidence for their named candidates; the current fix's fresh command
results and source-candidate identity belong to [change-report.md](./change-report.md).

- Baseline `npm run build:check`: passed before edits.
- Focused test driver with exact files `release-validation.test.ts`,
  `release-check.test.ts` and `publication.test.ts`: **196 passed, 0 failed**.
  FR2/FR3 are covered by clean distribution build, tracked-resource preservation,
  stale-resource rejection, build-failure propagation and existing parity/mode
  tests. FR4 is covered by actual archive byte/omission/tamper checks. FR5 is
  covered by workflow mutation rejection, including missing, conditional and
  late publish builds.
- Scoped ESLint: **0 errors, 10 advisory warnings**; see assessment above.
- Final publication regression suite after adding bundled-source parity:
  **5 passed, 0 failed**; includes source-only archives and missing/changed CLI
  source and package metadata. The first full gate was intentionally interrupted
  before completion to incorporate this fix; it is not counted as a pass.
- Full `npm run release:check`: **passed (exit 0)** in a disposable candidate
  with no `dist` files or index entries at launch. **1746 tests passed, 0 failed**;
  typecheck, lint, build parity, formatter, release validation, actual
  source/plugin/npm publication checks and isolated CLI smoke all passed.
  Full-workspace lint reports **0 errors, 415 advisory warnings**; the scoped
  baseline and changed publication-function assessment are recorded above.
  `npm ci --offline` passed
  from the unchanged lockfile. Execution uses local Node **24.11.1** and npm
  **11.3.0**; this local run does not exercise npm OIDC publication.
- `npm pack --ignore-scripts --offline` in that candidate: exactly six files
  (`LICENSE`, `NOTICE`, `README.md`, `package.json`, `dist/banzai.mjs` and
  `dist/banzai.mjs.map`); the executable bundle has mode **0755**. The first
  standalone pack attempt could not write the default npm cache/log directory
  in the sandbox; retry with a task-local cache passed.
- FR1: both generated files are pending working-tree deletions and
  `git check-ignore --no-index` confirms both ignore rules. The real index
  remains untouched. FR6: maintained guide/manifest diff inspected.
- Original candidate comparison before review 1: all **560** indexed source
  files and modes matched that working tree, with neither distribution file
  indexed. `git diff --check` passed; the only post-gate change at that point
  was completion of this verification report. Subsequent proposal documentation
  is covered separately below.
- Raw logs and the disposable candidate are ignored beneath
  `.banzai/ci-built-orchestrator-dist/`.

### ADR proposal follow-up, 2026-10-21

- Changed only ADR-0056, its proposed decision-index row and this feature record.
- Scoped Prettier checks for ADR-0056 and `work.md` passed; the decision index
  parsed successfully. `git diff --check` passed.
- All 15 local Markdown links and anchors in the ADR and feature record
  resolved. ADR ID 0056 is unique, required sections are present, its index row
  was `Proposed` at proposal preparation, and no active-manifest ADR entry had
  been added at that point.
- Hash comparison confirmed that the other **561** Git-visible paths and their
  modes, including existing accepted ADRs and review 1, remained unchanged;
  the real Git index also remained unchanged.
- These are documentation checks. Application tests, hosted CI and npm delivery
  were not rerun for the proposal, and R1-F1 is not claimed resolved.

### ADR acceptance and review preparation, 2026-10-21

- Recorded explicit owner acceptance of ADR-0056 and the exact proposal digest.
  Changed only acceptance/lifecycle metadata, the two indexes and this record.
- Hash checks passed for all four immutable ADR bodies. The other **557**
  Git-visible paths and modes, including review 1 and executable source/tests,
  remained unchanged, as did the real Git index. FR1-FR6 and the four original
  implementation-plan steps also remained unchanged.
- Reciprocal links, all four Accepted decision-log rows, the single Planned
  manifest row and the exact proposal digest passed consistency checks.
  All **19** local links and anchors in ADR-0056 and this record resolved.
- Scoped Prettier checks for ADR-0056 and this record passed. All seven changed
  Markdown documents parsed successfully, and `git diff --check` passed.
  Existing accepted bodies were not reformatted.
- Comparison with the retained, previously verified candidate found **554**
  matching files and modes. Differences are limited to the seven lifecycle/
  report documents, the added review-1 artifact and the intended absence of
  the two generated distribution files from the real checkout. Runtime source,
  tests, build scripts, workflows and dependency metadata still match that
  candidate.
- The 1746-test result remains the original local evidence. No new full-suite,
  publication-payload or hosted result is claimed for this documentation pass.
  The acceptance snapshot and validation record are ignored beneath
  `.banzai/ci-built-orchestrator-dist/adr-0056-acceptance/`.
- R1-F1 is ready for independent resolution review; no `review-2.md` or passing
  reviewer verdict was produced during preparation.

### R2-F1 publication-inventory fix, 2026-10-21

- The owner accepted R2-F1 from review 2. Added the exact ADR-0056 maintainer
  entry; the existing publication guard and accepted ADR bodies are unchanged.
- Fresh source-only candidate: **564 indexed files**, including the accepted
  ADR, current policy, lifecycle documents and both prior reviews. Neither
  distribution file is indexed; the full gate started without generated dist.
- Fresh `npm run publication:check`: **passed**. Actual source/plugin/npm
  inventories contain **564/99/6 files**, with **25** instruction resources
  matching across source, plugin, npm and source map.
- Fresh `npm run release:check`: **passed, exit 0**, **1746 tests passed,
  0 failed**, in **439.759 seconds**, on local Node **24.11.1** and npm **11.3.0**.
  Typecheck, lint, build parity, format, release validation, actual publication
  and isolated CLI smoke passed; lint has **0 errors, 415 advisory warnings**.
  All 564 indexed source files and modes were unchanged by the gate.
- Only this record and `change-report.md` are updated after the full gate to
  record results. Final report synchronization and its publication check
  passed. Exact evidence and the local/hosted boundary are recorded in
  [change-report.md](./change-report.md); private logs and candidate files are
  under `.banzai/ci-built-orchestrator-dist/r2-f1/`.
- R1-F1 is independently resolved by review 2. R2-F1 was handed off for
  independent resolution review; its subsequent passing review 3 was supplied
  separately and is recorded below.

### Review 3 closure and implementation-state reconciliation, 2026-10-21

- Review 3 records `pass`, verifies R2-F1 resolved and reports no new findings.
  It retains review 2's resolution of R1-F1. No additional triage is required.
- Before reconciliation, all **564** source paths and modes matched the R2-F1
  final candidate snapshot; the only additional source document was review 3.
  Its evidence still applies to the exact reviewed implementation.
- Changed only this record, ADR-0056's lifecycle metadata, its decision-log
  row and its manifest state. The accepted decision body and all three reviews
  remain unchanged. Implementation is recorded as `Implemented`; the owner
  retains release authority.
- The **1746-test** full-gate result remains the fresh R2-F1 local result on
  Node **24.11.1**, assessed by review 3. No additional full-gate or hosted run
  is claimed for this documentation-only reconciliation.
- A separate source-only candidate contains **565 indexed source files**,
  including review 3 and the reconciled metadata, with no indexed dist.
  `npm ci --offline`, `npm run build:dist` and actual `publication:check`
  passed: **565/99/6** source/plugin/npm files and **25** instruction resources
  pass parity. The final report bytes are synchronized into its index and
  publication checked again; `final-publication-check.log` records that result.
- Scoped Prettier and `git diff --check` passed; all four changed Markdown
  files parsed, and all **28** local links and anchors in the ADR and this
  record resolved. Hash checks preserve the accepted decision body, original
  requirements and plan, all **563** pre-existing paths outside the four-file
  scope, and the real Git index. The manifest changes only ADR-0056's state.
- Raw closure evidence belongs under
  `.banzai/ci-built-orchestrator-dist/review-3-closure/`; the candidate,
  snapshots and report assessed by review 3 are preserved. The lifecycle
  reconciliation is complete; hosted CI and npm delivery remain unobserved.

## Deviations & Follow-ups

Hosted CI and npm delivery require a subsequent owner-authorized release.
No dependency or version changes, real-index staging, commits, pushes, vendor
calls, or npm publication were performed. The full local test run requires
loopback sockets and runs outside the sandbox; it retains the same deterministic
gate and vendor-free environment.
