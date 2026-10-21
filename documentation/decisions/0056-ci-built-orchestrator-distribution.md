# ADR 0056: CI-Built Orchestrator Distribution

## Status / Date / Owner / Decision Makers

- Status: Accepted
- Date: 2026-10-21
- Owner: Banzai maintainers
- Decision makers: Repository owner; explicitly accepted in chat on 2026-10-21
  with `Accept ADR-0056` (English translation).
- Acceptance date: 2026-10-21
- Accepted proposal SHA-256:
  `eadc199ffb17d79a7bfa8b72489e8676ec1281459a5aa4e83188ee39e67e1b29`.
- Lifecycle effect: the partial supersessions and amendment below are accepted.
  Proposal-time context and the decision body remain unchanged; this acceptance
  supersedes their pending-approval wording. Independent review 2 verified
  R1-F1 resolved; review 3 verified R2-F1 resolved with verdict `pass`.
- Implementation state: Implemented; source and local verification reconciled
  on 2026-10-21 against [review 3](../work/ci-built-orchestrator-dist/review-3.md).
  Hosted CI and npm delivery remain separate release evidence.
- Preparation authority: the owner accepted review finding R1-F1 and requested
  this Proposed ADR in chat on 2026-10-21. Acceptance of the finding authorizes
  this proposal; it does not accept the ADR or close the finding.

## Related Artifacts

- Owner request: [issue #7](https://github.com/Parabolic-Technologies/banzai/issues/7)
  and the 2026-10-21 chat request to build the orchestrator distribution in
  CI/CD and include it in npm instead of storing it in the repository.
- Feature requirements, implementation and local evidence:
  [work.md](../work/ci-built-orchestrator-dist/work.md), FR1-FR6.
- Accepted finding:
  [review-1.md, R1-F1](../work/ci-built-orchestrator-dist/review-1.md#r1-f1--record-the-accepted-change-to-committed-release-output).
- Repository authority: [AGENTS.md](../../AGENTS.md) and the
  [decision lifecycle](./README.md#lifecycle).
- Manifest: sections 2, 7-8 and 10 of
  [PROJECT_MANIFEST.md](../../PROJECT_MANIFEST.md).
- Related accepted decisions:
  - [ADR-0009](./0009-supported-node-release-matrix.md): supported Node lanes,
    build target and committed-output baseline.
  - [ADR-0010](./0010-blocking-and-advisory-release-evidence.md): required
    release evidence, failure classification and human release authority.
  - [ADR-0039](./0039-npm-trusted-publishing-on-github-release.md): npm trusted
    publishing and release authorization.
  - [ADR-0053](./0053-single-pull-request-ci-gate-and-publish-evidence-reuse.md):
    source-tree evidence binding, two-lane fallback and publication checks.
- Existing enforcement owners: `packages/orchestrator/scripts/build.mjs`,
  `check-dist.mjs`, `release-check.mjs`, `check-release.mjs`,
  `phase-resources-build.mjs` and `publication-release.mjs`; the CI and publish
  workflows under `.github/workflows/`.

## Context and Decision Drivers

The accepted release architecture uses a committed executable bundle and
source map. ADR-0009 names Node 22.20.0 as the canonical committed-build
baseline and tests the same committed output on Node 24.11.1. ADR-0010 requires
committed-distribution parity and committed-bundle smoke. ADR-0053 changes
when evidence may be reused, but retains that output-storage convention.

The pending feature diff removes `packages/orchestrator/dist/banzai.mjs` and
`banzai.mjs.map` from Git, ignores rebuilt output, and builds from source in the
release gate and publishing job. It also changes local contributor commands.
The manifest describes those working-tree mechanisms. This implementation and
its recorded local checks do not amend the accepted decisions; R1-F1 identifies
the missing architectural authority. Hosted CI and npm delivery have not been
observed for this change.

Decision question: How should source-derived CLI output replace the committed
distribution while preserving supported-runtime and publication evidence?

Decision owner: Banzai maintainers, with explicit repository-owner acceptance.

Drivers:

- Satisfy the owner's requirement that generated distribution files leave Git
  while the executable and source map remain in the npm package.
- Bind release confidence to reviewed source, lockfile, build configuration
  and generated instruction resources without silently repairing tracked files.
- Keep independent blocking evidence on Node 22.20.0 and 24.11.1 and retain
  `target: "node22"` (compatibility and assurance ownership).
- Preserve deterministic parity, executable mode, CLI smoke and meaningful
  build failures through the existing build and verification owners.
- Keep ADR-0053's source-tree evidence reuse and two-lane fallback, with a
  fresh build in the publishing checkout on either path.
- Avoid adding a separate build-artifact transfer and retention lifecycle.

Security exposure class 7 applies because these bytes feed npm publication.
Retain the existing authorization and payload controls: the publishing job
must validate the release identity and publication payload before checking or
publishing the release version on npm, and it must depend on bound two-lane
evidence or a successful two-lane fallback. `publish.yml`, `check-release.mjs`
and `publication-release.mjs` own these controls. This proposal introduces no
credential, permission or new publication trigger.

## Options Considered

1. **Continue committing the bundle and source map.** Both supported runtimes
   can test the identical committed artifact, and a checkout contains the CLI
   immediately. Generated changes continue to occupy source history and require
   contributor rebuilds before commits. Rejected because it does not meet the
   owner's storage requirement.
2. **Build once and transfer a CI artifact between verification and publish
   jobs.** This can test and publish the same produced bytes and avoids repeated
   bundling. It adds artifact identity, integrity, availability and retention
   requirements across pull-request runs, release tags and fallback jobs.
   Rejected for this migration: it would introduce another release resource
   lifecycle alongside the existing source-tree evidence mechanism.
3. **Build from the selected source independently in each consuming job.**
   Required lanes exercise their own source-derived output; the publishing job
   builds again from the release tag. This uses existing build/parity owners,
   works with evidence reuse and fallback, and requires no distributed build
   artifact. It repeats bundling and requires an explicit build for local CLI
   use. Selected; the precise evidence boundary is stated below.

## Decision

Adopt option 3.

### Distribution ownership

Treat `packages/orchestrator/dist/banzai.mjs` and its `.map` as ignored build
output. Exclude them from future source commits and source archives; include
both in the npm CLI package. Keep the executable's Node shebang and mode `0755`.
Existing Git history and released artifacts retain their historical contents.

Build from the selected checkout and its lockfile-installed dependencies using
the repository-owned builder. Retain the Node 22 bundle target and the existing
runtime dependency and package contracts.

Keep generated initialization resources, phase resources and artifact readers
tracked. A distribution-only build writes only ignored output. Deterministic
checks compare tracked generated resources with canonical inputs and fail on
drift; they do not regenerate them to make a candidate pass. The explicit full
developer build remains the owner of tracked-resource regeneration.

### Verification and publication

Require each deterministic release-gate invocation to build its own
distribution before checks that consume it. Both supported Node lanes run the
complete gate independently, including fresh bundle/map parity, executable
mode checks, isolated CLI smoke and tracked-file non-mutation. Snapshot tracked
bytes and modes before the build. A build or required-check failure leaves the
gate unsatisfied and prevents downstream publication.

Keep Node 22.20.0 and Node 24.11.1 as the exact required lanes. Node 22 remains
the oldest supported runtime and compilation target; replace the common
committed-output baseline with per-lane builds of the same candidate source.
Parity compares each local bundle and map with a fresh temporary rebuild and
compares packed npm bytes with the publishing checkout's build. This evidence
does not assert byte comparison between artifacts produced by separate jobs.

In the Node 24.11.1 publishing job, build from the exact release-tag checkout
after `npm ci` and before release validation, publication checks, the registry
version lookup or publication. Require this build whether ADR-0053 reuses bound
evidence or its two-lane fallback ran. Reused evidence covers the verified source tree; it does
not supply or authorize reuse of a previously built distribution artifact.

Require publication checks to validate bundle/map presence and exact bytes
against the local build. Preserve canonical source/plugin/embedded-instruction
parity and require every bundled source-map input, including CLI source and
package metadata, to match the source archive. A source archive no longer
needs `dist` to establish those relationships.

The advisory forward lane uses the same gate-owned build when it runs. The
protected manual live job builds before executing the CLI and retains its
existing invocation and authorization conditions. Contributor and authorized
manual-release instructions must supply the same fresh-build prerequisite.
Keep the existing `smoke:committed` command name as a compatibility alias for
the smoke suite operating on locally built output.

Preserve ADR-0039 and ADR-0053's release trigger, tag/version checks, `npm`
environment, OIDC permissions, producer/run/attempt/tree evidence binding,
two-lane fallback, `--ignore-scripts` publication and skip-existing behavior.
Builds are explicit workflow actions; npm installation or publication hooks do
not replace the required build. Release remains a separate owner action.

## Consequences

Positive:

- Source review and Git history no longer carry generated distribution changes.
- Every consuming CI job owns a build from its selected source checkout.
- Existing parity, payload and runtime checks remain the assurance owners.
- Publication can reuse validated source-tree evidence without depending on
  retained build artifacts from an earlier run.

Costs and risks:

- A fresh checkout needs dependencies and a build before local CLI use.
- Every consuming job pays the build cost and depends on the build toolchain.
- Runtime confidence comes from each supported lane's own build; the published
  artifact is rebuilt in the publishing job. Cross-job artifact equality is
  outside this evidence model, so local rebuild and package parity must remain
  blocking.
- Old command names and historical ADR wording still mention committed output;
  lifecycle links and current guides must make the new ownership clear.

Required follow-ups:

- After acceptance, apply the lifecycle metadata changes below and reconcile
  the feature record with the accepted authority before resolution review.
- Review the existing implementation against this decision; do not treat the
  proposal or recorded local tests as closure of R1-F1.
- Keep hosted CI, trusted publishing and registry-delivery results separate
  from local verification, and record them only when actually observed.

## Compliance and Confirmation

Implementation and review must confirm:

1. A fresh source candidate has neither distribution file tracked or archived;
   the ignore rules cover subsequent output, while npm contains both files.
2. Both supported lanes and both publication fallback lanes run the complete
   release gate from source without a pre-existing `dist`. Required failures,
   cancellations and unavailable evidence retain ADR-0010's non-passing meaning.
3. The publishing job builds before release and publication checks on both the
   reuse and fallback paths; workflow validation rejects a missing, conditional
   or late build. The manual live job builds before CLI execution.
4. The distribution-only build preserves tracked bytes and modes. Stale tracked
   resources fail checks without repair, and a failed build cannot leave a
   previous successful bundle available for publication.
5. Fresh bundle/map parity, Node 22 target, mode `0755`, shebang and isolated CLI
   smoke remain checked. Missing, stale or tampered output fails the gate.
6. Actual package checks establish local-build/npm byte equality, canonical
   instruction parity and source-map/source-archive equality. Missing or
   changed CLI source, package metadata or instruction bytes are rejected.
7. Evidence binding, both supported pins, forward-lane cadence, live-job
   authorization and every retained publication control remain enforced by
   their existing owners and relevant regressions.
8. Current contributor/release documentation distinguishes source checkouts
   requiring a build from npm packages containing ready-to-run distribution.
9. The owner accepts the ADR, lifecycle/index links are reconciled, and an
   independent resolution review assesses R1-F1 against the accepted decision.
   Local checks alone do not establish hosted delivery or review acceptance.

## Lifecycle Links

- Partially supersedes
  [ADR-0009](./0009-supported-node-release-matrix.md), accepted 2026-10-21:
  its Decision paragraph defining the canonical committed-build baseline and
  Compliance item 3 only as to committed/shared output. Per-lane source builds
  replace that baseline; the supported pins, Node 22 target and two required
  lanes remain authoritative.
- Partially supersedes
  [ADR-0010](./0010-blocking-and-advisory-release-evidence.md), accepted
  2026-10-21: its Required and Blocking use of committed-distribution parity
  and committed-bundle smoke is replaced with the freshly built equivalents
  defined here. Its failure classification and release authority remain
  authoritative.
- Amends
  [ADR-0053](./0053-single-pull-request-ci-gate-and-publish-evidence-reuse.md),
  accepted 2026-10-21: its publication sequence and live-job prerequisite require
  a build in each consuming checkout, including the publishing job when evidence
  is reused. Its source-tree binding, evidence producer identity, fallback,
  permissions, cadence and cancellation policy remain authoritative.
- Reciprocal lifecycle links are recorded on ADR-0009, ADR-0010 and ADR-0053.
  Their statuses remain `Accepted` because each retains active provisions;
  their accepted bodies remain immutable. ADR-0039 remains in force as already
  partially superseded by ADR-0053.
- Earlier ADR references to committed-bundle checks retain their historical
  meaning; the replacement release-output policy is scoped by the amendments
  above. Tracked generated instruction resources are outside this replacement.
- The decision log records acceptance and the manifest's active ADR index
  records state `Implemented`. The implementation and its retained local
  evidence are mapped in `work.md`; independent review 2 resolved R1-F1 and
  [review 3](../work/ci-built-orchestrator-dist/review-3.md) resolved R2-F1 with
  verdict `pass`. This source implementation state does not assert hosted CI
  execution, npm publication or registry delivery.
- Superseded by: None.
