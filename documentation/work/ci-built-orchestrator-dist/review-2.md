# Implementation Review: ci-built-orchestrator-dist

- Format: `banzai-feature-review/v1`
- Feature slug: `ci-built-orchestrator-dist`
- Review iteration: `2`
- Verdict: `changes_requested`
- Workspace digest: `not supplied`
- Review artifact: `documentation/work/ci-built-orchestrator-dist/review-2.md`

## Review Scope

Resolution review of the owner-accepted R1-F1 in `review-1.md`. Reviewed the lite feature record (`work.md`), accepted ADR-0056, reciprocal lifecycle metadata in ADR-0009/0010/0053, ADR-0039's retained publication controls, both decision indexes, the pending source/workflow/test/documentation diff, and the local verification records under `.banzai/ci-built-orchestrator-dist/`. The four accepted ADR bodies match the retained pre-acceptance hashes. All 554 paths shared with the pre-acceptance source snapshot still match; the differences are lifecycle and feature documents. The earlier source-only candidate recorded a passing local `release:check` on Node 24.11.1 (1746 tests), and its npm pack inventory contains the executable bundle and source map. `git diff --check` passed. No full gate was rerun in this source-read-only review.

## Summary

R1-F1's architectural-authority gap is resolved: ADR-0056 is Accepted, narrowly replaces the committed-output provisions, and has reciprocal links in the older Accepted ADRs and both indexes. The implementation's per-checkout builds, local parity, publish ordering and documented evidence boundary fit that decision. The newly added ADR is absent from the repository's publication inventory, however. Once included in the release source tree, it causes the required publication check to fail. This new release-blocking consequence requires a separate human triage decision.

## Findings

### R2-F1 — Classify the new ADR in the publication inventory

- Severity: `blocker`
- Category: `correctness`
- Confidence: `high`
- Evidence: `documentation/decisions/0056-ci-built-orchestrator-distribution.md:1` is a new source document. `publication-policy.json:412` lists ADR-0055 followed directly by `documentation/decisions/README.md` at line 417, with no ADR-0056 entry. `packages/orchestrator/scripts/publication-check.mjs:306` rejects an unclassified `documentation/` file as `PUBLICATION_UNCLASSIFIED`; `packages/orchestrator/scripts/publication-release.mjs:24` applies this policy to the staged source tree. A read-only call to `inspectPublicationFiles` with the current policy and actual ADR-0056 bytes reproduced `PUBLICATION_UNCLASSIFIED documentation/decisions/0056-ci-built-orchestrator-distribution.md`. The earlier successful `release:check` candidate predates this ADR and cannot establish the current source archive's publication result.
- Violates: `work.md` FR2/FR5 and Implementation Plan step 4; ADR-0056 Compliance and Confirmation 6–7 (`documentation/decisions/0056-ci-built-orchestrator-distribution.md:221`). The publication inventory's fail-closed classification rule is an established release control.
- Reproduction: In a disposable source candidate, include ADR-0056 in the candidate Git index with the current `publication-policy.json`, leave `dist/` out of that index, build the distribution, then run `npm run publication:check`. It fails with `PUBLICATION_UNCLASSIFIED` for the ADR before the release gate can pass. The focused read-only policy invocation above reproduces the exact diagnostic without modifying the real index.
- Fix acceptance: Add the exact ADR-0056 path to `publication-policy.json` with its appropriate maintainer classification. On a source-only candidate containing the accepted ADR and no indexed `dist/`, the actual publication check and required release gate complete while retaining source/plugin/npm parity and the publication guard. Preserve the accepted ADR body.

## Previously Accepted Findings

- R1-F1 — Verified resolved. ADR-0056 is recorded as Accepted in `documentation/decisions/0056-ci-built-orchestrator-distribution.md:5`; it defines per-lane source builds, parity, mode, smoke and publish prerequisites. Its lifecycle links at lines 233–263 are reciprocal with ADR-0009, ADR-0010 and ADR-0053; `documentation/decisions/README.md:65` and `PROJECT_MANIFEST.md:1815` record the decision. The retained body hashes match. The finding's authority and release-evidence acceptance conditions are met; R2-F1 is a distinct publication-inventory consequence introduced by the new ADR file.

## Deferred Coverage

- The retained full gate and npm pack are local Node 24.11.1 evidence for the pre-acceptance source candidate. The later ADR and lifecycle documents have not had a fresh complete release gate or source-archive publication check. R2-F1 demonstrates one resulting failure.
- The real Git index still contains the two distribution paths pending deletion; the disposable source candidate omitted them. No staging, commit, hosted Node 22/24 CI, npm trusted-publishing run or registry delivery was performed or observed in this review.

## Handoff

Human triage is required for R2-F1. Only an accepted finding may enter a subsequent fix; this review changes no source, policy, decision or prior artifact, and it grants no release or publication authority.
