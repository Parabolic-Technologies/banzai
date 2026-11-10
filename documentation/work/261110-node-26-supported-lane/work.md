# Feature: Node 26 supported release lane

Slug: 261110-node-26-supported-lane

## Related artifacts

- Accepted [ADR-0067](../../decisions/0067-node-26-supported-release-lane.md),
  accepted in chat on 2026-11-10 with `Accept ADR-0067`.
- Partially superseded or amended:
  [ADR-0009](../../decisions/0009-supported-node-release-matrix.md),
  [ADR-0010](../../decisions/0010-blocking-and-advisory-release-evidence.md),
  [ADR-0053](../../decisions/0053-single-pull-request-ci-gate-and-publish-evidence-reuse.md),
  [ADR-0056](../../decisions/0056-ci-built-orchestrator-distribution.md).
- Retained: [ADR-0039](../../decisions/0039-npm-trusted-publishing-on-github-release.md)
  (publishing runtime Node 24.11.1).

## Goal

The owner asked on 2026-11-10 for Node.js 26 support in the documentation and
descriptions, checked by a CI job. Node 26 entered Active LTS on 2026-10-28
with v26.13.0. Adding a supported major is ADR-eligible under ADR-0009, so the
escalation trigger was resolved by ADR-0067 before any source change.

## Requirements

1. **FR1:** `engines.node` is `>=22.20.0 <23 || >=24.11.1 <25 || >=26.13.0 <27`
   in both package manifests and both lockfile mirrors.
2. **FR2:** `release-policy.json` lists exactly three required supported lanes
   (22.20.0, 24.11.1, 26.13.0) with exact Bookworm images and no forward lane.
3. **FR3:** `ci.yml` runs `release_check_node_26` exactly like the other
   required lanes on pull requests and manual dispatch. The advisory
   `forward_compatibility_node_26` lane and the weekly schedule are removed.
4. **FR4:** `publish.yml` falls back to all three lanes and publishes only when
   all three pass or bound evidence covers all three. Evidence checking,
   publishing and the live lane keep Node 24.11.1.
5. **FR5:** The release validator and its tests reject a missing, extra,
   advisory or re-pinned supported lane, a reintroduced forward lane, a
   scheduled trigger, a publish gate without Node 26 and engines drift.
6. **FR6:** README, getting-started, orchestrator guide, contributing guide,
   release checklist and manifest state the three supported lines.

## Assumptions & Decisions

1. The publishing and live runtimes were previously derived from the last
   supported lane. The validator now names the Node 24 lane explicitly
   (`toolingLaneJob`), so adding Node 26 does not move publication off
   Node 24.11.1.
2. With no schedule, the required lanes no longer carry
   `if: github.event_name != 'schedule'`; the validator's exact job text drops
   that line.
3. `publish_npm.needs` is emitted as a block sequence so the four-entry list
   stays Prettier-clean.
4. The runtime minimum checks in `doctor` and the workflow runner (Node 22.18+)
   already accept Node 26 and are unchanged, as ADR-0067 records.
5. Security exposure class 7 (publication boundary): the change adds one more
   required gate before publication and keeps permissions, OIDC scope and the
   evidence binding unchanged. No new credential or authority is introduced.

## Changes

- Policy and engines: `release-policy.json`, `package.json`,
  `packages/orchestrator/package.json`, `package-lock.json`.
- Workflows: `.github/workflows/ci.yml`, `.github/workflows/publish.yml`.
- Validator and evidence: `packages/orchestrator/scripts/check-release.mjs`,
  `packages/orchestrator/scripts/release-evidence.mjs` (summary wording).
- Tests: `packages/orchestrator/test/release-validation.test.ts` (policy-shape
  test for the three lanes, CI and publish mutations),
  `packages/orchestrator/test/release-evidence.test.ts` (three lanes, missing
  Node 26 lane leaves evidence unbound).
- Documentation: `README.md`, `CONTRIBUTING.md`, `PROJECT_MANIFEST.md`,
  `documentation/getting-started.md`, `documentation/orchestrator.md`,
  `documentation/release-checklist.md`.
- Decisions: ADR-0067, reciprocal lifecycle links on ADR-0009, ADR-0010,
  ADR-0053 and ADR-0056, both decision indexes, `publication-policy.json`.

## Verification

- `npm run release:validate` passed on Node 26.13.0.
- `release-validation.test.ts` and `release-evidence.test.ts`: 274 tests passed
  on Node 26.13.0.
- `npm run format:check` passed; the edited workflows and tests are
  Prettier-clean. `release-policy.json` was already not Prettier-formatted at
  `HEAD` and keeps its layout.
- Full release gate (`release-candidate-check.mjs`, disposable candidate) on
  Node 26.13.0: `release candidate check passed`, 2172 tests, 0 failures. The
  first run failed on one lint error in the new policy-shape test (`type`
  instead of `interface`), fixed before the passing run. The candidate also
  contained an unrelated uncommitted edit of
  `packages/orchestrator/test/local-model-override.test.ts` from another
  session.
- ADR-0067 is recorded as `Implemented` in the manifest and decision index for
  the verified source change.

## Not verified here

- Hosted GitHub Actions runs of `release_check_node_26` and of the publish
  fallback.
- Node 22.20.0 and 24.11.1 local runs; CI covers them.
- `actionlint` is not installed locally.

## Owner follow-ups

- Where the GitHub plan offers branch protection or rulesets, require
  `release_check_node_26` after its first hosted run.
- Release notes for the next version state the new engines range.
