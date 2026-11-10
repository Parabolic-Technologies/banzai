# ADR 0067: Node 26 Supported Release Lane

## Status / Date / Owner / Decision Makers

- Status: Accepted
- Date: 2026-11-10
- Owner: Banzai maintainers
- Decision makers: Repository owner; explicitly accepted in chat on 2026-11-10
  with `Accept ADR-0067`.
- Acceptance date: 2026-11-10
- Accepted proposal SHA-256: `daeb0fbbba6e0ee88c849fedd0d9908675de1f5abad464c4eb194ed41e9d373c`.
- Lifecycle effect: the partial supersession of ADR-0009 and the amendments of
  ADR-0010, ADR-0053 and ADR-0056 are accepted. Reciprocal links are recorded
  on those records; their bodies stay unchanged. The decision body is retained
  unchanged. Implementation follows in one lite change set.

## Related Artifacts

- Request: the owner asked in chat on 2026-11-10 to support Node.js 26 in the
  documentation and descriptions and to check it in a CI job.
- Work: none yet. Implementation follows acceptance in one change set under
  `documentation/work/`.
- Manifest: section 2 (Platform & Tooling) and the active ADR index of
  `PROJECT_MANIFEST.md`.
- Policy data and validation: `release-policy.json`,
  `packages/orchestrator/scripts/check-release.mjs`,
  `packages/orchestrator/scripts/release-evidence.mjs`.
- Workflows: `.github/workflows/ci.yml`, `.github/workflows/publish.yml`.
- Related accepted decisions:
  - ADR-0009 fixes the supported matrix at Node 22 and Node 24, runs Node 26 as
    an advisory forward lane, and requires a new ADR to add a supported major.
  - ADR-0010 lists the Node 26 forward lane as advisory evidence.
  - ADR-0039 runs the publishing job on Node 24.11.1.
  - ADR-0053 binds publication to pull-request evidence from both required
    lanes, runs the forward lane only on a weekly schedule and on dispatch, and
    falls back to both supported images.
  - ADR-0056 keeps Node 22.20.0 and Node 24.11.1 as the exact required lanes
    with per-lane source builds and the `node22` target.
- External lifecycle authority: the official
  [Node.js release schedule](https://github.com/nodejs/Release#release-schedule)
  and [release index](https://nodejs.org/dist/index.json), read on 2026-11-10.

## Context and Decision Drivers

Current state:

- `engines.node` is `>=22.20.0 <23 || >=24.11.1 <25` in both package manifests
  and both lockfile mirrors. npm reports Node 26 as an unsupported engine.
- CI runs required `release_check_node_22` (`node:22.20.0-bookworm`) and
  `release_check_node_24` (`node:24.11.1-bookworm`) on pull requests and manual
  dispatch, and advisory `forward_compatibility_node_26`
  (`node:26.7.0-bookworm`) on the weekly schedule and on dispatch.
- The release validator hard-codes the two supported lanes and the forward pin
  and checks `ci.yml`, `publish.yml`, the engines mirrors and the generated
  policy table in the README-level documents.
- The runtime minimum checks in `doctor` and the workflow runner accept any
  Node at or above 22.18, so they already accept Node 26.

External facts on 2026-11-10:

- Node 26 ("Lithium") entered Active LTS on 2026-10-28 with v26.13.0, which is
  also its newest release. It moves to Maintenance on 2027-10-20 and reaches
  end-of-life on 2029-04-30. The official image `node:26.13.0-bookworm` exists.
- Node 22 is Maintenance LTS until 2027-04-30. Node 24 is Maintenance LTS
  until 2028-04-30.
- From Node 27 on, Node ships one line a year. Node 27 is in Alpha
  (`27.0.0-alpha`) since 2026-10-28; its first Current release is scheduled
  for 2027-04-22. No official Node 27 container image exists.

Drivers:

- A supported major means a matching engines range plus independent blocking
  evidence on an exact pin (ADR-0009). A documentation claim alone is not
  support.
- Every required lane must keep binding publication evidence (ADR-0053) and run
  the same per-lane source build (ADR-0056).
- The advisory forward lane now pins a pre-LTS release of a line that becomes
  supported, so it no longer measures anything the supported lane does not.
- CI cost: one more complete `release:check` per pull request. Lanes run in
  parallel; ADR-0053 measured the Node 26 lane as the slowest, about 22
  minutes.
- Reversibility: dropping the lane later is a new ADR plus a policy edit.

## Options Considered

### Option 1: Add a required Node 26.13.0 lane and retire the forward lane

Support Node 26 from 26.13.0, run it as a third required lane wherever the two
required lanes run, and remove the advisory forward lane and its weekly
schedule until a newer line has a Current release.

- Benefits: npm, CI and documentation agree on three LTS lines; Node 26 gets
  per-pull-request and publish-time blocking evidence; no lane tests a stale
  pre-LTS pin.
- Costs: one more required job per pull request and per publish fallback; a
  third pin to maintain; branch protection must list the new job.
- Risks: a Node 26-only regression now blocks merges and releases. That is the
  intent of support.

### Option 2: Add the required lane and move the forward lane to Node 27 Alpha

- Benefits: keeps an early-warning lane.
- Costs and risks: no official Node 27 image exists, so the lane cannot use an
  exact Bookworm pin as ADR-0009 requires; Alpha builds change without semver
  guarantees and would produce noise.
- Rejected: the lane cannot meet the pinning rule before April 2027.

### Option 3: Claim Node 26 in documentation and keep the advisory lane

- Benefits: no CI cost.
- Costs and risks: npm still rejects Node 26 through engines, or the engines
  range is widened without blocking evidence; both contradict ADR-0009.
- Rejected: support without blocking evidence is the drift ADR-0009 removed.

### Option 4: Replace Node 22 with Node 26

- Benefits: keeps two required lanes and the current CI cost.
- Costs and risks: Node 22 remains Maintenance LTS until 2027-04-30; users on
  it would get an engine error, and the `node22` build target would change.
- Rejected: dropping Node 22 is a separate decision with its own timing.

### Option 5: Run the Node 26 required lane only on the schedule

- Benefits: lower per-pull-request cost.
- Costs and risks: no per-pull-request evidence, so ADR-0053 publication
  binding would always fall back or would publish without Node 26 evidence.
- Rejected: support needs evidence for the exact published tree.

## Decision

Adopt Option 1.

Supported matrix:

- Support exactly three Node major lines: Node 22 from `22.20.0` below 23,
  Node 24 from `24.11.1` below 25, and Node 26 from `26.13.0` below 27.
- Set both package `engines.node` values and both lockfile mirrors to
  `>=22.20.0 <23 || >=24.11.1 <25 || >=26.13.0 <27`.
- Keep esbuild target `node22`.

Lanes:

- Run `release_check_node_26` in `node:26.13.0-bookworm` as a required lane,
  defined exactly like the other required lanes: on pull requests and manual
  dispatch, never on the schedule, with `npm ci`, the complete
  `release:check` and the recorded tree evidence.
- Publication evidence binds only when every required lane listed in
  `release-policy.json` succeeded in one attempt and recorded the tag's tree.
  The publish fallback runs the complete `release:check` in every supported
  image, and publication requires all of them to succeed. ADR-0053's binding
  rules are otherwise unchanged.
- The `release_evidence` and `publish_npm` jobs and the live lane keep
  Node 24.11.1. ADR-0039 is unchanged.
- Retire `forward_compatibility_node_26` and the weekly `schedule` trigger.
  Node 23, 25 and 27 have no lane and no support claim.
- An advisory forward lane for a newer line may return after that line has a
  Current release with an official exact Bookworm image. It keeps ADR-0009's
  and ADR-0053's forward-lane shape (exact pin, advisory, schedule and dispatch
  only) and needs a release-plan change, not a new ADR. Adding a supported
  major still needs a new ADR.

Policy and documentation:

- `release-policy.json` remains the single source of the matrix. The validator
  accepts exactly the three supported lanes above and no forward lane, and
  derives the CI jobs, the publish fallback and the generated policy table from
  that data.
- User-facing requirements and contributor documentation state the three
  supported lines. Release notes for the release that ships this change state
  the new engines range.

## Consequences

Positive:

- Node 26 users install without an engine warning and get blocking evidence on
  every pull request and release.
- npm, CI, validator and documentation keep one support statement.
- The scheduled run no longer spends a runner on a lane with no new signal.

Negative:

- Each pull request and each publish fallback runs a third complete gate.
- Three exact pins need routine patch maintenance.
- No early signal for Node 27 until its first Current release and a later
  release-plan change.

Risks and required follow-ups:

- Branch protection on `main` must list `release_check_node_26` as a required
  status check. The repository cannot set this; the owner does it in GitHub
  settings after the lane first runs.
- A Node 26-only failure blocks merges. Triage follows ADR-0010; it is never
  reclassified as passing.
- Node 22 reaches end-of-life on 2027-04-30. Removing it needs a new ADR before
  then.
- The `doctor` and runner minimum checks stay at 22.18 and still accept
  unsupported majors; aligning them with engines is out of scope.

## Compliance and Confirmation

Implementation and review must confirm:

1. both package manifests and both lockfile mirrors declare
   `>=22.20.0 <23 || >=24.11.1 <25 || >=26.13.0 <27`;
2. `release-policy.json` lists exactly the three supported lanes, each
   required, with exact `-bookworm` patch images, and no forward lane;
3. `ci.yml` has exactly the three required lanes and the live job, with the
   pull-request and dispatch triggers and no schedule;
4. `publish.yml` falls back to all three lanes, publishes only when all three
   succeed or bound evidence covers all three, and keeps Node 24.11.1 for
   evidence checking and publishing;
5. release evidence verification refuses a binding that lacks any required
   lane;
6. validator tests fail on a missing, extra, advisory or re-pinned supported
   lane, on a reintroduced unapproved forward lane, and on engines drift;
7. the README, getting-started guide, orchestrator guide, contributing guide,
   release checklist and manifest state the three supported lines and carry no
   Node 26 advisory wording;
8. `npm run release:check` passes on Node 26.13.0 as well as on 22.20.0 and
   24.11.1.

## Lifecycle Links

- Partially supersedes ADR-0009, on acceptance: the two-major support set, the
  engines value, the Node 26 forward lane and Compliance items 1, 2 and 4.
  ADR-0009's pinning, validation and new-major rules remain.
- Amends ADR-0053, on acceptance: "both required lanes" becomes every required
  lane in `release-policy.json`, and the forward lane and weekly schedule are
  retired.
- Amends ADR-0010 and ADR-0056, on acceptance: the Node 26 forward lane leaves
  ADR-0010's advisory set, and ADR-0056's exact required lanes include
  Node 26.13.0.
