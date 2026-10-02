# ADR 0010: Blocking and Advisory Release Evidence

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
- Manifest: sections 2, 8, and 10 of `PROJECT_MANIFEST.md`
- Related decisions accepted with this record:
  - ADR-0009 defines supported blocking and forward advisory Node lanes.
  - ADR-0011 defines the opt-in live-vendor evidence boundary.
- Related accepted decisions:
  - ADR-0007 keeps project-readiness diagnosis advisory for normal workflows.
  - ADR-0008 distinguishes expected not-ready evidence from unexpected fatal
    environment failures in a deterministic CLI contract.

## Context and Decision Drivers

The repository has no CI today. `npm run verify` is a local sequential gate,
and its non-zero result does not encode whether source is defective, a runner
lost infrastructure, or an optional external integration is unavailable. A
GitLab pipeline can express required and allowed-to-fail jobs, but the YAML
status alone cannot define release policy or turn unavailable evidence into
proof.

The target pipeline will contain three materially different evidence classes:

- deterministic checks under supported Node versions that the repository owns;
- forward-compatibility checks outside the supported contract; and
- a protected, manual live-vendor path that depends on external CLIs,
  subscription authentication, model availability, and paid execution.

Current and target differ as follows:

- current local failure is one undifferentiated non-zero result; target
  evidence must identify product, environment, and unavailable-external states;
- current merge/release confidence is informal; target required jobs and the
  release checklist must define what evidence is mandatory;
- current vendor behavior has no automated lane; target may expose it without
  letting default pipeline availability depend on it; and
- current passing tests can be mistaken for release authorization; target must
  keep automation as evidence and the release action as a human decision.

Decision question: Which CI evidence is blocking or advisory, how are failure
classes represented, and when may merge or release proceed after a failed or
unavailable advisory check?

Decision owner: Banzai maintainers, with explicit user lifecycle approval.

Decision drivers:

- required supported behavior must fail closed;
- infrastructure incidents must not be mislabeled as product defects or pass;
- optional external integration must not make ordinary pipelines flaky or
  credential-dependent;
- known live authorization regressions deserve stronger release treatment than
  missing credentials;
- merge and release have different risk and evidence requirements;
- GitLab project settings are out of scope, so repository policy must remain
  understandable without assuming an external merge configuration; and
- every non-pass state must remain visible and auditable.

## Options Considered

### Option 1: Make every job required

Block the pipeline on supported Node, forward Node, GitLab external lint, and
live Codex/Claude compatibility.

Benefits:

- maximal evidence before any green pipeline;
- no ambiguity about a failed job.

Costs and rejection reason:

- normal pipelines require protected subscription credentials and paid model
  availability;
- forks and unprotected branches cannot run safely;
- Current-Node regressions can block releases despite no support promise;
- external outages become product release blockers. Rejected because the
  default pipeline must remain deterministic and credential-free.

### Option 2: Make only the current local `verify` job required

Run `npm run verify` once as blocking and make formatter, plugin, distribution,
scratch, matrix, and live checks advisory.

Benefits:

- smallest required path;
- closely matches current maintenance behavior.

Costs and rejection reason:

- retains the formatter and plugin coverage gaps;
- provides no blocking evidence on every supported Node major;
- stale committed output or broken scratch CLI behavior could ship with a
  green pipeline. Rejected because it does not achieve release confidence.

### Option 3: Require deterministic supported evidence and keep external/forward evidence advisory

Require the complete release-confidence gate on every supported Node lane.
Treat forward Node, remote GitLab syntax validation, and live vendor
compatibility as advisory with explicit status semantics. Keep a confirmed
live permission regression release-blocking by policy even though its GitLab
job remains mechanically advisory.

Benefits:

- ordinary pipelines are deterministic and credential-free;
- every supported runtime proves the complete shipped surface;
- forward and live evidence remain visible without creating false required
  failures from external availability;
- a known real permission regression cannot be ignored as merely optional;
- unavailable and not-run states remain truthful without blocking source
  implementation.

Costs and risks:

- required release checks are duplicated across supported lanes;
- a mechanically green pipeline does not alone express a failed live release
  policy, so the checklist remains authoritative for release;
- maintainers must classify an environment incident and retry rather than
  waiving a missing required pass;
- advisory failure presentation needs tests to prevent accidental promotion to
  pass.

### Option 4: Make all non-deterministic evidence informational only

Require supported deterministic lanes and allow merge and release regardless
of any forward or live result, including confirmed live permission failure.

Benefits:

- simplest pipeline and release rule;
- external behavior never blocks delivery.

Costs and rejection reason:

- a reproduced source/control-write authorization regression could be shipped
  knowingly;
- the live job would provide diagnostics without a meaningful release safety
  consequence. Rejected because confirmed authorization defects are materially
  different from missing optional evidence.

## Decision

Adopt Option 3.

Classify evidence as follows.

### Required and Blocking

The complete deterministic `npm run release:check` result on every supported
Node lane from ADR-0009 is required. That aggregate includes source quality,
tests, format, plugin/release validation, hook syntax, committed distribution
parity, policy consistency, and disposable committed-bundle smoke.

A required lane provides release evidence only when setup and every owned check
complete successfully. Any non-zero result, timeout, cancellation, runner loss,
image pull failure, or dependency-registry failure means the required evidence
is unsatisfied. The suspected cause can guide retry and triage, but it cannot be
translated to pass or ignored for release.

### Advisory

The exact Node 26 forward-compatibility lane, remote GitLab CI syntax
validation when it needs an external service, and the protected manual live
Codex/Claude job are advisory in GitLab. They must not be dependencies of a
required job and must not change default pipeline behavior.

An advisory job records its actual result. `allow_failure` or manual status is
mechanical pipeline policy, not permission to print `pass` for a failed,
unavailable, skipped, or not-run check.

### Outcome Classification

- **Product failure:** dependency setup completed in a supported, pinned
  environment and a repository-owned assertion or command failed. In a
  required lane this blocks merge/release evidence. In live compatibility it
  means the external CLI ran but a required permission, mutation, schema,
  privacy, or cleanup assertion failed.
- **Environment failure:** the required process could not obtain or retain its
  declared runner, image, filesystem, process, or dependency-registry
  environment. It is not proof of a product defect and must be retried, but it
  is also not pass and leaves required evidence unsatisfied.
- **Unavailable external integration:** an advisory external service, supported
  CLI, protected subscription credential, or authenticated vendor session is
  absent before the behavior can be tested. Record `unavailable`; do not make a
  model call and do not present pass.
- **Not run/skipped:** policy prevented or no human requested the advisory live
  path. Record `not run` or GitLab skipped status; do not infer availability or
  compatibility.

### Merge and Release Consequences

Repository policy permits merge only after every required supported lane has a
current pass for the candidate commit. Advisory forward or live
failed/unavailable/not-run evidence does not mechanically block merge, but its
status remains visible.

Repository policy permits a later release only after every required supported
lane and the local release checklist pass for the exact release candidate.

- A forward-compatibility failure does not block the current supported release,
  but must be recorded with a follow-up disposition.
- Live `unavailable` or `not run` does not block source completion or release,
  but the release owner must record that actual vendor permission behavior was
  not proven.
- A live environment failure has the same release treatment as unavailable
  evidence after bounded retry: record it and do not call it pass.
- A confirmed live product or authorization failure blocks release by default.
  Proceeding despite it requires a separate, explicit human release-risk
  acceptance that identifies the failed check and rationale; ordinary plan
  approval or a green default pipeline is not that waiver.

Do not add a fifth Banzai workflow gate. These are CI/release evidence rules;
the existing ADR, plan, escalation, and review-triage gates remain unchanged.
Do not change GitLab project settings as part of implementation.

## Consequences

Positive:

- a green required pipeline proves the complete deterministic surface on every
  supported Node major;
- infrastructure failures stay distinct without weakening the required gate;
- ordinary branches and forks need no vendor credentials;
- forward and live evidence remain visible and truthful;
- missing live auth does not prevent source implementation or force unsafe
  credential distribution;
- a reproduced authorization defect receives an explicit release consequence;
- release remains a human decision over named evidence.

Negative:

- required work is repeated per supported Node lane;
- external outages can delay required evidence when they affect dependency
  installation even if source is healthy;
- GitLab green status alone cannot convey a release-policy block from an
  advisory live product failure;
- release owners must read and complete the checklist rather than relying only
  on the pipeline badge.

Risks and required follow-ups:

- misclassification: scripts must emit bounded check identities and exit
  states, while human triage distinguishes product from environment cause;
- accidental fail-open: tests must prove that environment/unavailable results
  never become pass and required evidence cannot be waived by YAML alone;
- hidden live regression: the release checklist must carry the latest live
  state and any explicit release-risk acceptance;
- merge setting mismatch: docs must state repository policy without claiming
  GitLab settings were configured by this feature;
- duplicate expensive work: the plan may share safe npm download cache only,
  but not outputs, source, dist, auth, or live state.

## Compliance and Confirmation

Implementation and review must confirm:

1. every ADR-0009 supported lane is required and runs the complete
   deterministic release-confidence gate;
2. no advisory result is a prerequisite of a required job;
3. Node forward, external GitLab lint, and live compatibility are labeled
   advisory and preserve non-pass states;
4. required product and environment failures both leave required evidence
   unsatisfied, with distinct diagnosis;
5. missing CLI/auth produces unavailable before a model call and never pass;
6. default and fork pipelines invoke no vendor/auth/model path;
7. merge/release docs require current passes for the exact candidate commit;
8. live unavailable/not-run and forward failures are recorded but do not block
   current supported release by themselves;
9. a confirmed live product/authorization failure blocks release unless a
   separate explicit release-risk acceptance is recorded;
10. automation does not add a human workflow gate or mutate GitLab settings.

## Lifecycle Links

- Amended by
  [ADR-0053](./0053-single-pull-request-ci-gate-and-publish-evidence-reuse.md),
  accepted 2026-10-01: required evidence is bound to the published tree, every
  publication path proves both supported lanes, and merge policy applies
  without GitHub enforcement. Required and advisory classification is
  unchanged. Implementation of this amendment is Planned.
- Supersedes: None
- Superseded by: None
