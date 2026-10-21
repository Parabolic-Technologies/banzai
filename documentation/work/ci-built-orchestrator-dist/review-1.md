# Implementation Review: ci-built-orchestrator-dist

- Format: `banzai-feature-review/v1`
- Feature slug: `ci-built-orchestrator-dist`
- Review iteration: `1`
- Verdict: `replan_required`
- Workspace digest: `not supplied`
- Review artifact: `documentation/work/ci-built-orchestrator-dist/review-1.md`

## Review Scope

Reviewed `work.md` as the lite feature's requirements, plan, implementation and verification record; the current diff across build scripts, release validation, publication parity, GitHub workflows, tests, guides and `PROJECT_MANIFEST.md`; the decision index and ADR-0009, ADR-0010, ADR-0039, ADR-0050 and ADR-0053. Inspected the retained local `release-check.log`, publication result and npm pack inventory under `.banzai/ci-built-orchestrator-dist/`. The log records a successful source-candidate `release:check` with 1746 passing tests, format, release validation, publication checks and CLI smoke; the pack inventory records the executable bundle and source map. These are local recorded results, not hosted CI or npm publication evidence. This source-read-only review did not rerun checks.

## Summary

The implementation builds ignored distribution output before release checks and npm packing, and the reviewed local evidence supports the proposed parity and payload behavior. One architectural authority gap prevents a passing review: the new source-built release path replaces an accepted committed-output decision without an accepted successor ADR.

## Findings

### R1-F1 — Record the accepted change to committed release output

- Severity: `blocker`
- Category: `adr`
- Confidence: `high`
- Evidence: `documentation/work/ci-built-orchestrator-dist/work.md:44` states that the owner requested replacement of the committed-distribution convention. `.gitignore:7` now ignores `dist/`, and `packages/orchestrator/scripts/release-check.mjs:30` builds it during the gate. ADR-0009 still calls committed output the canonical build baseline at `documentation/decisions/0009-supported-node-release-matrix.md:174` and requires the committed bundle in both supported lanes at line 235. ADR-0010 still includes committed distribution parity and committed-bundle smoke in required release evidence at `documentation/decisions/0010-blocking-and-advisory-release-evidence.md:165`. ADR-0053 amends evidence binding and forward-lane cadence, but does not replace the committed-output decision; its amendment scope is recorded at `documentation/decisions/0053-single-pull-request-ci-gate-and-publish-evidence-reuse.md:333`. The decision index has no successor for this migration.
- Violates: ADR-0009 Decision and Compliance 3; ADR-0010 Required and Blocking; `documentation/decisions/README.md:98` lifecycle rule for changing an accepted decision.
- Reproduction: Compare the accepted decision text and its lifecycle links with `work.md` FR1-FR3, the pending distribution deletions, `.gitignore`, and `release-check.mjs`.
- Fix acceptance: Record the CI-built distribution decision in a new owner-accepted ADR, with reciprocal amendment or supersession links and an updated decision index. Reconcile the feature's release-evidence requirements with that accepted authority while retaining both supported lanes, byte parity, executable mode and CLI smoke. Then review the implementation against the accepted decision.

## Previously Accepted Findings

None.

## Deferred Coverage

Hosted GitHub Actions execution, npm trusted publishing and registry acceptance were not observed. Issue #7 was not reachable from this environment; the feature's `work.md` records the owner's migration request.

## Handoff

Human triage is required for R1-F1. No source or approved decision was changed during review. Only an accepted finding may enter a subsequent fix or planning path; this review does not authorize publication.
