# ADR 0053: Single Pull-Request CI Gate and Publish-Time Evidence Reuse

## Status / Date / Owner / Decision Makers

- Status: Accepted
- Date: 2026-10-01
- Owner: Banzai maintainers
- Decision makers: project owner; explicitly accepted in chat on 2026-10-01.
- Accepted proposal SHA-256:
  `facf962de85b2f972fd956cee877213d795b921a52b1ac8792bfadab7cd14eb4`.
- Review: review-1 findings F1 (two-lane fallback) and F2 (evidence producer
  identity) accepted by the project owner on 2026-10-01 and resolved in
  rework 1. Reviews are recorded in private work artifacts.

## Related Artifacts

- Requirements: standalone owner request on 2026-10-01, recorded in chat:
  stop verifying the same release candidate three times at about 20 minutes
  each. The owner selected four changes together: concurrent test files on
  small runners, a single pull-request gate with publish-time evidence reuse,
  the advisory forward lane off pull requests, and cancellation of superseded
  pull-request runs. The dependent plan is created after acceptance.
- Review: private work `adr-0053-ci-evidence-reuse-review`, review-1.
- Workflows: `.github/workflows/ci.yml`, `.github/workflows/publish.yml`.
- Release validator: `validateCi` in
  `packages/orchestrator/scripts/check-release.mjs`; policy data in
  `release-policy.json`.
- Release documentation: `documentation/release-checklist.md`,
  `documentation/releases/public-publication.md`, and the release-policy part
  of `documentation/orchestrator.md`.
- Manifest: sections 2 (CI) and 10 (constraints, decision index) of
  `PROJECT_MANIFEST.md`.
- Related decisions:
  - ADR-0009 fixes the supported and forward Node lanes and their exact pins.
    The pins stay; this decision sets when the forward lane runs.
  - ADR-0010 makes the complete `release:check` on every supported lane the
    required evidence. That stays; this decision defines how that evidence is
    bound to the published bytes and how merge policy works without GitHub
    enforcement.
  - ADR-0011 keeps default CI credential-free and vendor-free. Unchanged.
  - ADR-0039 runs `release:check` on the release tag before every publication.
    This decision replaces that single-runtime re-run; the release trigger, the
    `npm` environment, OIDC trusted publishing, the tag and npm version checks
    and the skip-existing step stay.

## Context and Decision Drivers

Current state, measured on 2026-10-01 from GitHub Actions run records and the
local Git graph:

- `ci.yml` runs its three deterministic lanes on `pull_request` and on `push` to
  `main`, and `publish.yml` runs `release:check` again on the release tag. One
  release candidate is therefore verified three times: on the pull-request
  merge ref, on the merge commit and on the tag. For v2.6.3 (CI runs
  36433711501 and 36436419217, Publish run 36436493590) and v2.6.4 (CI run
  36851949671, Publish run 36852854512) each verification took 19 to 23
  minutes. About 60 minutes passed between opening the release pull request and
  npm publication, at roughly 136 hosted-runner minutes per release.
- The three verifications covered identical bytes. `main` receives only merge
  commits from `dev`; the v2.6.4 merge commit `482ce14` and its pull-request
  head `4b52130` both have tree `bead82c`.
- The push-to-`main` run is not dependable evidence. Merge commit `482ce14` has
  no CI run at all, only Publish run 36852854512, and the release relied on the
  publish job's own `release:check`. Nothing reported the missing run.
- The publish re-run covers Node 24.11.1 only, and publication depends on no
  Node 22 result. A candidate whose Node 22 lane failed can be published today
  if it is merged, because nothing enforces the merge rule (see below).
- About 95% of each lane is `npm test`. In run 36851949671 on Node 24, the
  summed top-level test durations (948.6 s) equal the test wall time (954.8 s),
  so test files ran one at a time. The repository is private on GitHub Free,
  whose standard hosted Linux runner has two vCPUs, and `node --test` defaults
  to `availableParallelism() - 1` concurrent files. On a 10-core workstation
  the same suite takes 454 s wall for 3077 s of summed test time. The largest
  single file takes about 108 s of the 949 s total.
- The advisory Node 26 lane is the slowest job, about 22 minutes, on every pull
  request, although ADR-0010 lets it block neither merge nor release.
- GitHub Free offers no branch protection or rulesets for private repositories:
  the branch-protection API returns HTTP 403 with an upgrade notice. Required
  checks, the "branch must be up to date" rule and merge queues are therefore
  unavailable. The release checklist's branch-protection item cannot be
  satisfied, and merge rules are repository policy applied by the owner.
- The release validator owns the layout of `ci.yml` only. Other files under
  `.github/`, including additional workflows, are permitted (ADR-0039).

Decision drivers:

- Keep ADR-0010's required evidence: the complete deterministic `release:check`
  on both supported Node lanes for exactly the bytes that are published, on
  every publication path.
- Stop re-verifying identical bytes and shorten the path from pull request to
  npm.
- Fail closed. Any doubt about evidence leads to a complete two-lane
  verification, never to a publication without one.
- Add no stored credential, no write scope and no vendor path (ADR-0011,
  ADR-0039).
- Work within GitHub Free without branch protection or merge queues.
- Keep one validated CI workflow file.

Security exposure created or widened by this decision:

- Identity or access decision: the publication gate gains an evidence-reuse
  path that trusts a previous run, and the publish workflow gains read-only
  Actions access. The question this path must answer is which workflow
  produced the evidence. The enforcement point is the repository-owned evidence
  check in the publish workflow.
- Irreversible external effect: npm publication cannot be undone. Reuse may
  skip only the re-run, and every unbound case falls back to the complete
  two-lane gate.
- Untrusted input reaching an interpreter: run metadata and recorded evidence
  can originate from pull-request runs, including fork runs and any other
  workflow present in the pull request. The evidence check validates every value
  before use and never passes it to a shell.

Out of ADR scope: running test files concurrently on small runners is a local,
reversible test-driver choice. The plan carries it without an ADR. It shortens
every lane but does not change which runs count as evidence.

## Options Considered

1. **Keep current triggers and the publish re-run.** No change. Three full
   verifications per release remain, a missing push run stays silent, and
   publication still depends on Node 24 alone. Rejected: the cost is the problem
   being solved.
2. **Speed up the suite only.** Every run becomes faster, but identical bytes
   are still verified three times. Rejected as insufficient on its own; kept as
   the planned non-ADR change.
3. **Drop the push-to-`main` run and keep the publish re-run.** Removes one
   duplicate, but publication still waits for a full verification of bytes the
   pull-request run already verified, and only on Node 24. Rejected.
4. **Keep the push-to-`main` run as release evidence and let publish reuse it
   by exact commit.** The binding is simple because the run's commit is the tag
   commit. Two full runs per release remain, the owner must wait for the main
   run before publishing the GitHub Release, and push runs are not guaranteed
   to exist (v2.6.4). Rejected.
5. **Required checks with up-to-date branches, or a merge queue.** GitHub would
   make the pull-request run authoritative. Not available on GitHub Free for
   private repositories. Rejected.
6. **Publish from a tag-push CI run that depends on the lanes.** The tag is
   still re-verified, and ADR-0039's authorization by publishing a GitHub
   Release changes. Rejected.
7. **Single pull-request gate with evidence reuse at publication.** Required
   lanes record the tree they verified. Publication reuses that evidence only
   when GitHub metadata identifies its producer as this repository's `ci.yml`
   and binds it to the published tree. Otherwise publication runs the complete
   gate on both supported lanes. Selected.

Forward-lane cadence: running it on every pull request costs the longest job
with no merge effect; removing it contradicts ADR-0009. A weekly schedule plus
manual dispatch keeps the evidence visible at a bounded cost. Because `main`
carries only trees that a pull-request run verified on both supported lanes,
the supported baseline for a scheduled forward result already exists, so the
schedule does not need to repeat the required lanes.

Superseded pull-request runs: keeping them spends runner time on bytes no
longer under review. Cancelling them loses nothing, because ADR-0010 never
counts a cancelled run as evidence.

## Decision

Adopt option 7.

CI triggers and lanes:

- `ci.yml` runs on `pull_request`, on `workflow_dispatch` with the existing live
  input unchanged, and on one weekly `schedule`. It has no `push` trigger.
- The required Node 22.20.0 and 24.11.1 lanes run the complete `release:check`
  independently on every pull-request and manual-dispatch run, and never on the
  schedule. After `release:check` succeeds, each required lane records the Git
  tree id it verified, together with the run id, run attempt and lane in which
  it was recorded, as evidence retrievable from that run.
- The advisory Node 26.7.0 lane runs only on the schedule and on manual
  dispatch, never on pull requests. Its pin, advisory status and visibility are
  unchanged.
- At most one CI run is in progress per pull request. A newer push to the same
  pull request cancels its older run; runs from other events are never
  cancelled. A cancelled run is not evidence.
- The live job is unchanged.

Release evidence identity:

- Producer identity comes only from GitHub's run, attempt, job, workflow-path
  and repository metadata. Workflow or job display names, artifact or evidence
  payloads, and head or tree equality never establish who produced evidence.
- Required evidence exists for a published tag when all of these hold:
  - the tag commit is a merge commit whose tree equals its second parent's tree;
  - GitHub identifies a workflow run of this repository whose workflow file is
    `.github/workflows/ci.yml`, whose event is `pull_request`, whose head commit
    is that second parent, and which concluded successfully;
  - in one attempt of that run, GitHub's job records show both required lanes
    succeeded, and the evidence each lane recorded is attributable to that same
    run, attempt and lane and names exactly the tag's tree.
- Anything unresolved is unbound: evidence that cannot be attributed to the
  successful execution of its lane, attempts that disagree, or missing metadata.
- For publication, this binding is ADR-0010's exact candidate.

Trust boundary of the binding:

- GitHub's run, attempt, job, workflow-path and repository metadata is trusted
  platform evidence.
- The content of the `ci.yml` that produced bound evidence is the content
  validated in the published tree, because the tree recorded by its lanes equals
  the tag's tree and `release:validate` runs on the tag.
- Actors with write access to `main` are trusted. They can already publish a
  GitHub Release, which is ADR-0039's publication authorization.

Publication:

- `publish.yml` keeps its trigger, the `npm` environment, OIDC trusted
  publishing, the tag and npm version checks, `npm ci` and the skip-existing
  step.
- Before any registry call it checks the evidence binding:
  - Bound: run `release:validate` and `publication:check` on the tag, then
    publish.
  - Not bound for any reason, including a non-merge tag, a tree mismatch,
    missing, expired, foreign or ambiguous evidence, a failed or cancelled lane,
    or an API failure: run the complete `release:check` on the tag tree in both
    exact supported images, `node:22.20.0-bookworm` and
    `node:24.11.1-bookworm`. Publish only when both succeed.
- A failure, cancellation, timeout or unavailability of either fallback lane
  blocks publication. Node 24 alone never satisfies the gate.
- Evidence reuse can replace the re-run, never the gate.
- Only the job that publishes holds `id-token: write`. Reading run metadata and
  recorded evidence uses read-only `actions: read`. No other write scope and no
  stored credential are added.
- The evidence check is repository-owned code covered by tests, not inline
  workflow logic:
  - It accepts a tree id only as an exact hexadecimal Git object id and never
    interpolates external values into a shell.
  - It writes to the job summary either the reused run and attempt or the reason
    for the two-lane fallback.

Validation ownership:

- The release validator owns the new `ci.yml` layout: triggers and schedule,
  the cancellation rule, the evidence step in the required lanes and the event
  conditions of the required and forward lanes.
- It also owns these `publish.yml` gate invariants:
  - the permissions above;
  - the evidence check before publication;
  - the two-lane complete `release:check` fallback in the exact supported images;
  - publication depending on either a bound check or both fallback lanes
    succeeding.

Merge policy:

- Repository policy still permits merge only when both required lanes pass for
  the current pull-request head.
- GitHub Free cannot enforce that rule. The release checklist therefore makes
  branch protection conditional on plan availability, and the publication gate
  above is the mechanical release enforcement.

## Consequences

Positive:

- One full verification per release instead of three. With concurrent test
  files, the estimated path from pull request to npm drops from about 60 to
  about 12-15 minutes. Hosted usage drops from about 136 to about 25 runner
  minutes per release, plus about 10 minutes for each weekly forward run.
- Every publication path now proves both supported runtimes for the published
  tree. Today's publish re-run proves Node 24 only.
- A missing run can no longer go unnoticed: publication either names the run it
  reuses or verifies the tag on both lanes itself.
- Pull-request results no longer wait for the advisory lane.

Negative:

- The evidence check is new release-path code to maintain and test.
- The fast path depends on the GitHub Actions API and on evidence retention.
  Outages, expiry and unattributable re-run attempts fall back to the two-lane
  re-run, which costs two parallel lanes instead of today's single one.
- Squash or rebase merges, and tags not on a merge commit, always take the
  two-lane re-run.
- Node 26 results arrive weekly or on demand instead of per pull request, so a
  forward regression can surface up to a week later.
- Workflows, validator, policy documentation and manifest must change together.

Risks and required follow-ups:

- Fail-open evidence: tests must show that every unbound case runs both
  fallback lanes, and that publication is blocked when either fails, is
  cancelled or is unavailable.
- Foreign producers: another workflow in the same pull request shares its head
  and checked-out tree and can use the same job names and evidence format.
  Only the workflow-path, repository, run, attempt and job identities from
  GitHub metadata distinguish it, so tests must show that such a producer
  always leads to the fallback.
- Re-run attempts: a lane's success and its recorded evidence can come from
  different attempts. The plan must define how evidence is attributed to the
  successful execution, and anything it cannot attribute is unbound.
- `main` moving between the pull-request run and the merge: the recorded tree
  then differs from the published tree, and publication runs the two-lane gate.
- Direct pushes to `main` remain technically possible on GitHub Free. They
  break the tree conditions and force the two-lane gate; their authors are
  inside the trust boundary above.
- The release checklist and publication procedure must describe both
  publication paths and where the reused run is recorded.

## Compliance and Confirmation

1. `ci.yml` has exactly the `pull_request`, `workflow_dispatch` (input
   unchanged) and weekly `schedule` triggers, and no `push` trigger.
2. Required lanes have no `needs`, run on every pull-request and dispatch run,
   skip only the schedule, run the complete `release:check`, and record the
   verified tree with its run, attempt and lane only after it succeeds.
3. The forward lane runs only on the schedule and dispatch and keeps
   `continue-on-error: true`.
4. Cancellation applies only to superseded runs of the same pull request.
5. Publish checks the evidence binding before any registry call. Tests cover:
   - reuse when the binding holds;
   - the two-lane fallback for a non-merge tag, a tree mismatch, missing or
     expired evidence, a failed or cancelled lane, malformed values and an API
     failure;
   - the fallback for a different workflow with the same head, tree, job names
     and evidence format;
   - the fallback for evidence and job success from different or ambiguous
     attempts;
   - publication blocked when either fallback lane fails, is cancelled or is
     unavailable, including when Node 24 passes alone.
6. Only the publishing job holds `id-token: write`; evidence reading uses
   `actions: read`; every job keeps `contents: read` and no other write scope.
7. `npm run release:validate` rejects a `push` trigger, a forward lane on pull
   requests, a missing evidence step, a missing evidence check, a missing or
   single-runtime fallback, and publication that does not depend on the gate.
8. On the first release after implementation, the publish summary names the
   reused run and attempt, and the published `gitHead` equals the tag.
9. The manifest, release checklist and publication procedure describe both
   publication paths and the GitHub Free limitation.

## Lifecycle Links

- Amended by
  [ADR-0056](./0056-ci-built-orchestrator-distribution.md), accepted 2026-10-21:
  each consuming checkout builds its distribution, including the publishing
  job on both evidence-reuse and fallback paths and the manual live job before
  CLI execution. Evidence identity and binding, both supported lanes, fallback,
  permissions, cadence, cancellation and live authorization remain unchanged.
  ADR-0056's implementation state is Planned pending final reconciliation and
  review.
- Supersedes: None while Proposed. If accepted, it supersedes only ADR-0039's
  provision that the publish job runs `release:check` on the tag before every
  publication. The rest of ADR-0039 stays.
- Amends on acceptance:
  - ADR-0010: binding of required evidence to the published tree, the
    two-lane publication fallback, and merge policy without GitHub enforcement.
  - ADR-0009: forward-lane cadence.
- On acceptance, change only lifecycle links and status metadata on the older
  records; their bodies stay unchanged.
- Superseded by: None.
- Accepted on 2026-10-01 after the owner's explicit acceptance of rework 1,
  whose SHA-256 is recorded above. This lifecycle record supersedes the
  proposal-stage pending-acceptance wording; the decision body is preserved.
  The partial supersession of ADR-0039 and the amendments of ADR-0009 and
  ADR-0010 are accepted target intent with implementation state Planned. The
  dependent plan requires separate human approval before implementation.
