# ADR 0009: Supported Node Release Matrix

## Status / Date / Owner / Decision Makers

- Status: Accepted
- Date: 2026-08-10
- Owner: Banzai maintainers
- Decision makers: User, explicitly accepted in chat on 2026-08-10

## Related Artifacts

- Feature description:
  `documentation/features/release-confidence-pipeline/description.md`
- Feature plan:
  `documentation/development-plans/release-confidence-pipeline/plan.md`
  (must not be created until this proposal is accepted)
- Repository authority: `AGENTS.md`
- Manifest: sections 2, 7-8, and 10 of `PROJECT_MANIFEST.md`
- Related accepted decisions:
  - ADR-0006 requires configuration compatibility without selecting repository
    runtime support.
  - ADR-0008 permits doctor to inspect supported Node/platform values without
    defining the package support matrix.
- External lifecycle authority: the official
  [Node.js release schedule](https://github.com/nodejs/Release#release-schedule),
  which identifies Node 22 as Maintenance LTS, Node 24 as Active LTS, Node 25
  as end-of-life, and Node 26 as Current on the proposal date.

## Context and Decision Drivers

Both package manifests currently declare `engines.node: ">=22.18.0"`. That
range includes every future major and therefore presents untested Current,
end-of-life, and future Node lines as install-compatible. The manifest,
however, records Node 22.20.0 as the supported baseline, and the repository has
had no CI matrix.

The planning audit independently ran the complete 225-test suite on Node
22.18.0, 22.20.0, 24.11.1, and 25.2.1. All four runs passed. The Node 25 run is
not enough to make it supported: Node 25 is end-of-life, and its process
observer took 4482 ms against a 5000 ms timeout in this run and has exceeded
that timeout under prior full-suite load. A one-time pass must not turn an EOL
runtime into a release promise.

Current and target differ as follows:

- current engines promise every Node major from 22.18.0 onward; target engines
  must describe only explicitly supported LTS majors;
- current evidence is local and centered on Node 22.20.0; target CI must block
  on every supported major;
- current forward compatibility is accidental; target forward compatibility
  must be deliberate, visible, and advisory; and
- current source, docs, CI, and release policy have no consistency check;
  target drift between them must fail deterministically.

Decision question: Which Node versions does the repository support, which
versions block CI, and how is forward compatibility represented without
silently widening the package contract?

Decision owner: Banzai maintainers, with explicit user lifecycle approval.

Decision drivers:

- align package-manager installability with tested support;
- support maintained production LTS lines rather than EOL or speculative
  majors;
- keep the committed esbuild target at the oldest supported major;
- make supported failures release-blocking and forward failures informative;
- keep exact CI baselines reproducible and reviewable in source;
- avoid multiplying blocking lanes without a user-facing support benefit; and
- permit later patch-baseline maintenance without silently adding/removing a
  major.

## Options Considered

### Option 1: Support only Node 22

Change engines to a bounded Node 22 range and run one blocking Node 22 lane.

Benefits:

- smallest and cheapest matrix;
- matches the existing manifest baseline and esbuild target;
- excludes EOL, Current, and future majors clearly.

Costs and rejection reason:

- excludes Node 24 even though it is Active LTS and the full suite already
  passes on an available Node 24 baseline;
- forces users on the current LTS line to install the older maintenance line;
- defers a predictable compatibility commitment without evidence of need.
  Rejected because the release-confidence feature should cover both maintained
  LTS majors that the product can currently verify.

### Option 2: Support explicit Node 22 and Node 24 LTS ranges

Bound engines to the verified floors of Node 22 and Node 24, run both exact
floors as blocking lanes, and run the current forward major separately as an
advisory lane.

Benefits:

- engine claims and blocking evidence agree;
- covers both Maintenance and Active LTS users;
- excludes odd EOL majors and unaccepted future majors;
- preserves Node 22 as the build target and compatibility floor;
- forward breakage is visible before the next support decision.

Costs and risks:

- two blocking lanes increase CI time and runner use;
- Node 22.18.0, although currently passing, is removed from the public support
  floor in favor of the manifest's established 22.20.0 baseline;
- exact patch baselines require deliberate maintenance;
- adding Node 26 after it becomes LTS requires an explicit support decision.

### Option 3: Keep `>=22.18.0` with blocking LTS lanes and an advisory forward lane

Leave engines unchanged, block on Node 22 and 24, and run Node 26 as advisory.

Benefits:

- no immediate package-engine compatibility change;
- maintained LTS versions receive real blocking evidence;
- future issues can be discovered early.

Costs and rejection reason:

- npm continues to accept Node 23, 25, 26, and all future majors as satisfying
  the declared contract;
- documentation would need to explain that engines means something weaker than
  support;
- an advisory failure could coexist with an engine declaration that implies
  compatibility. Rejected because it preserves the exact ambiguity this
  feature is intended to remove.

### Option 4: Block on every non-EOL Node major, including Current

Bound engines to Node 22, 24, and 26 and make all three blocking immediately.

Benefits:

- strongest early compatibility signal;
- users of the Current line receive a supported path.

Costs and rejection reason:

- Node 26 is not LTS on the proposal date;
- Current-line behavior and toolchain changes can block releases without a
  production support commitment;
- the repository has no established Node 26 baseline evidence. Rejected
  because Current compatibility is useful as advisory evidence, not yet as a
  release promise.

## Decision

Adopt Option 2.

Support exactly two Node major lines for this release policy:

- Node 22 from `22.20.0` inclusive and below Node 23; and
- Node 24 from `24.11.1` inclusive and below Node 25.

Set both package `engines.node` values to the semantically equivalent explicit
range `>=22.20.0 <23 || >=24.11.1 <25`. This intentionally removes Node
22.18.x-22.19.x from the declared support floor even though the audit passed on
22.18.0, and it intentionally excludes Node 23, Node 25, Node 26, and future
majors until separately accepted.

Run exact Node 22.20.0 and Node 24.11.1 images as independent blocking supported
lanes. Each lane must install with `npm ci` and run the repository-owned
deterministic release-confidence gate. A failure in either lane means supported
compatibility has not been proven.

Keep esbuild target `node22`. Treat Node 22.20.0 as the oldest supported and
canonical committed-build baseline; Node 24.11.1 proves the second supported
runtime against the same committed output.

Run one exact, version-controlled Node 26 Current baseline as the
forward-compatibility lane after implementation rechecks the official release
line. Mark it advisory and non-release-authoritative. Do not run Node 25: it is
EOL and adds no useful future-support evidence.

Keep the exact supported and forward baseline values in repository-owned policy
data that can be validated against package engines, GitLab jobs,
documentation, and the release checklist. Do not infer support from whatever
version a floating container tag resolves to.

Adding or removing a supported major requires a new ADR. Advancing an exact
patch floor within an already accepted major requires an explicit release-plan
change, updated engine range, blocking evidence on the new floor, and
documentation reconciliation, but not automatically a new ADR.

## Consequences

Positive:

- npm's engine check reflects the same majors that CI blocks on;
- both maintained LTS lines receive independent release evidence;
- EOL and unaccepted future majors are no longer silently promised;
- the oldest supported build target stays Node 22;
- Node 26 regressions become visible without blocking current releases;
- policy drift can be caught by focused tests.

Negative:

- users on Node 22.18.x or 22.19.x receive an engine incompatibility after the
  change despite current test success;
- every required pipeline pays for two dependency installs and gates;
- pinned patch baselines need routine security and lifecycle maintenance;
- the range does not automatically expand when Node 26 becomes LTS.

Risks and required follow-ups:

- stale patch pins: the release checklist must compare pins with maintained
  Node releases and advance them through an explicit change when needed;
- image drift: CI implementation must use exact image versions and avoid
  floating `latest`, `lts`, or major-only tags for authoritative lanes;
- duplicated policy: one repository-owned validator must fail when engines,
  CI, docs, or checklist support statements disagree;
- advisory confusion: reports must label Node 26 as forward compatibility, not
  supported compatibility;
- timeout ambiguity: environment-sensitive failures must retain exact failing
  evidence and follow ADR-0010 classification rather than being masked or
  called a clean gate.

## Compliance and Confirmation

Implementation and review must confirm:

1. both package manifests use
   `>=22.20.0 <23 || >=24.11.1 <25` exactly or an npm-semver-equivalent range
   accepted during plan approval;
2. Node 22.20.0 and 24.11.1 are independent required lanes and both run
   `npm ci` plus the repository-owned release-confidence gate;
3. the committed bundle stays targeted to Node 22 and passes in both supported
   lanes;
4. Node 26 uses one exact pin, is advisory, and cannot satisfy a supported lane;
5. Node 23 and Node 25 have no CI lane or support claim;
6. policy tests fail for missing, extra, blocking/advisory, or engine-range
   drift;
7. docs and the release checklist distinguish supported and forward evidence;
8. a supported-lane failure remains non-passing even when suspected to be
   environment-sensitive;
9. no vendor/model/authentication behavior is introduced into any Node lane;
10. adding/removing a supported major cannot occur as an unreviewed matrix edit.

## Lifecycle Links

- Amended by
  [ADR-0053](./0053-single-pull-request-ci-gate-and-publish-evidence-reuse.md),
  accepted 2026-10-01: the advisory forward lane runs on a weekly schedule and
  on manual dispatch instead of on every pull request. Supported and forward
  pins are unchanged. Implementation of this amendment is Planned.
- Supersedes: None
- Superseded by: None
