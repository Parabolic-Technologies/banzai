# Change Report: R2-F1 publication inventory

Date: 2026-10-21

## Scope and authority

- Feature: [ci-built-orchestrator-dist](./work.md), FR2/FR5 and plan step 4.
- Accepted finding: [review 2, R2-F1](./review-2.md#r2-f1--classify-the-new-adr-in-the-publication-inventory).
  The owner accepted it in chat on 2026-10-21 and requested fresh
  `publication:check` and `release:check` in a source-only candidate.
- Accepted architecture: [ADR-0056](../../decisions/0056-ci-built-orchestrator-distribution.md),
  especially Compliance and Confirmation 6-7; retained publication controls in
  [ADR-0039](../../decisions/0039-npm-trusted-publishing-on-github-release.md) and
  [ADR-0053](../../decisions/0053-single-pull-request-ci-gate-and-publish-evidence-reuse.md).
- R1-F1 was verified resolved by review 2. No other finding is included or skipped.

## Change and rationale

Add exactly `documentation/decisions/0056-ci-built-orchestrator-distribution.md`
to `publication-policy.json` with classification `maintainer` and `sha256: null`,
matching the neighboring accepted ADR entries. Its absence made the current
source archive fail with `PUBLICATION_UNCLASSIFIED`.

The publication guard, matching rules and payload boundaries remain unchanged.
The accepted ADR and both review artifacts are preserved. `work.md` records
R1-F1's independent resolution and this accepted follow-up; this report owns
fresh evidence. No new manifest fact or architecture decision is introduced.

Changed files: `publication-policy.json`, `work.md` and this `change-report.md`.
No production JavaScript/TypeScript, workflow, dependency or test changes.

Security exposure class 7: this exact maintainer-document entry uses the
existing publication allowlist. Unclassified documentation must remain rejected;
source/plugin/npm payload and instruction parity remain required. No wildcard,
credential, permission or publication authority is added.

Engineering Quality deviations: None. This data/documentation change adds no
owner, lifecycle or dependency. Existing `parsePublicationPolicy`,
`inspectPublicationFiles` and `publication-release.mjs` own validation; the
release gate owns aggregate evidence.

## Verification

The original 1746-test run is historical/pre-fix evidence and is not reused as
the requested fresh gate. The new candidate contains **564 indexed source
files**, including the exact accepted ADR, current inventory, lifecycle documents,
both reviews and the initial fix reports. Neither `dist` file is indexed.
The candidate has its own index; the real index is unchanged.

The repository candidate wrapper rejects missing tracked files. Since the real
index still contains the two authorized distribution deletions, prepare an
explicit copy omitting exactly those two absent paths and fail on any other
missing source. Preserve modes and give the copy its own history-free index.

Raw execution evidence and candidate files belong under ignored
`.banzai/ci-built-orchestrator-dist/r2-f1/`.

Physical context: local macOS, Node **24.11.1**, npm **11.3.0**. The candidate
was created without `dist`; `npm ci --offline` installed from the unchanged
lockfile. The full release gate uses the same deterministic, vendor-free
execution as before and runs outside the sandbox for loopback HTTP fixtures.

| Check                               | Current result and evidence                                                                                                                                                                                                                                |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pre-fix and exact-entry regression  | Passed: saved pre-fix policy rejects actual ADR-0056 bytes with `PUBLICATION_UNCLASSIFIED`; the current policy accepts them. Every other inventory entry is unchanged, and a separate unclassified document remains rejected. `focused-policy-check.json`. |
| `npm ci --offline`                  | Passed, exit 0; `npm-ci.log`.                                                                                                                                                                                                                              |
| `npm run build:dist`                | Passed, exit 0; initial candidate build from absent dist, `build-dist.log`.                                                                                                                                                                                |
| `npm run publication:check`         | Passed, exit 0; actual indexed/source archives contain 564 files, plugin archive 99, npm package 6, and 25 instruction resources pass source/plugin/npm/source-map parity. `publication-check.log`.                                                        |
| `npm run release:check`             | Passed, exit 0 in 439.759 seconds: 1746 tests passed, 0 failed, cancelled or skipped. Typecheck, lint, build parity, format, release validation, actual publication and isolated CLI smoke passed. `release-check.log` and `release-check-result.json`.    |
| Final report-only publication check | Passed, exit 0 after synchronizing the final reports into the candidate index; source/plugin/npm inventories remain 564/99/6 files, with 25 instruction resources passing parity. `final-publication-check.log` and `final-publication-check-result.json`. |

Both the standalone publication check and the full gate cover the accepted ADR
and current inventory through actual archives and packages. Ignored dist was
removed before the full gate, which rebuilt it; the executable has mode `0755`.
All 564 indexed source files and modes remained identical to the gate-input
snapshot, `source-snapshot.json`. Full-workspace lint reports 0 errors and 415
advisory warnings, matching the recorded feature baseline.

Only `work.md` and this report change after the completed full gate to record
its results. Their final bytes are synchronized into the candidate's index
and publication checked again. Executable source, workflows, tests, dependency
metadata, accepted decisions and the publication policy remain identical to
the full-gate input; the full gate is not rerun for results-only report text.

Final integrity checks preserve all 563 pre-existing paths and modes outside
the three-file fix scope, including accepted decisions and both reviews, and
the real Git index. All 564 candidate source files and modes match the final
working tree; no dist is indexed. `final-source-snapshot.json` and
`final-verification.json` identify the final source bytes and report-only delta.
Scoped formatting, local report links/anchors and `git diff --check` pass.

## Assurance critique and review handoff

The existing fail-closed inventory check and actual source/plugin/npm package
checks exercise the reported defect; an ADR-specific unit test would duplicate
that guard. Check the pre-fix rejection, the exact new classification and a
separate unknown-document rejection, then run the actual publication check and
complete release gate without weakening either.

R2-F1 is ready for independent resolution review: the exact inventory fix,
fresh full release gate and final report-only publication check have passed.
Review 3 must assess this bounded delta and its exact evidence while preserving
accepted ADR bodies and earlier reviews. Hosted Node 22/24 CI, npm trusted
publishing and registry delivery remain outside this local verification.
