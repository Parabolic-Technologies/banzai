# ADR 0011: Protected Live Vendor Compatibility

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
- Manifest: sections 1, 3, 6, and 10 of `PROJECT_MANIFEST.md`
- Related decision accepted with this record: ADR-0010 defines advisory status and the release
  consequences of live pass, fail, unavailable, and not-run evidence.
- Related accepted decisions:
  - ADR-0002 requires independent source-read-only review and reapplied vendor
    restrictions for every invocation.
  - ADR-0004 requires privacy-minimized projection rather than treating
    redaction as permission to retain raw evidence.
  - ADR-0008 establishes structural read-only composition, fixed bounded
    output, and no authorization implication from diagnostic evidence.

## Context and Decision Drivers

Existing unit and integration tests prove the argv, sandbox, allowed-tool,
subscription-environment, hook, exact-artifact, redaction, and runner-rendered
contracts under injected processes. They do not prove that currently installed
Codex and Claude CLIs, authenticated vendor sessions, hosted model behavior,
and host permission enforcement still implement those contracts in reality.

Running a live model in default CI would introduce credentials, external
availability, nondeterminism, cost, privacy exposure, and fork risk into the
required path. Avoiding live evidence entirely would leave an important host
compatibility boundary untested before release.

The repository's installed workflow has asymmetric reviewer behavior:

- Codex review runs in a read-only sandbox and cannot receive
  `BANZAI_REVIEW_ARTIFACT`; the runner renders the review artifact from the
  structured result.
- Claude review receives restricted read/glob/grep/write tools and may write
  only the exact path in `BANZAI_REVIEW_ARTIFACT`; source, `.banzai` control
  state, other artifacts, edit tools, and shell remain forbidden.

Current and target differ as follows:

- current permission evidence is simulated; target may gather actual hosted
  CLI behavior in a disposable checkout;
- current repository stores no CI auth policy; target must accept only
  out-of-band protected subscription credentials;
- current tests retain ordinary test output; target live evidence must retain
  only a bounded summary and delete raw model/auth material; and
- current default checks cost no model usage; target must keep that default and
  make every live call an explicit, bounded human action.

Decision question: What execution, authentication, isolation, privacy, cost,
and result boundary permits useful live Codex/Claude compatibility evidence
without weakening default CI or repository authorization?

Decision owner: Banzai maintainers, with explicit user lifecycle approval.

Decision drivers:

- test actual supported CLI and host permission behavior;
- never expose subscription state to repository, cache, fork, or retained
  artifacts;
- make absence of auth unavailable rather than pass or product failure;
- preserve reviewer/source/control-state isolation and exact artifact writes;
- bound model invocations, duration, and retained data;
- clean up after success, assertion failure, timeout, and interruption;
- keep default CI deterministic, free of vendor calls, and safe for forks; and
- let source implementation complete when live infrastructure is unavailable.

## Options Considered

### Option 1: Run live compatibility automatically in every pipeline

Provision both subscription sessions to normal runners and invoke live models
on pushes and merge requests.

Benefits:

- every commit gets current hosted compatibility evidence;
- regressions are discovered immediately.

Costs and rejection reason:

- exposes credentials to a broad execution surface, including fork risk;
- creates paid, slow, nondeterministic default CI;
- external outages block ordinary development;
- raw vendor output is difficult to keep out of routine logs. Rejected because
  it violates the explicit credential-free default boundary.

### Option 2: Provide an unprotected manual job using runner-local user auth

Let any pipeline user click a manual job that reads whatever Codex/Claude
credentials happen to exist on the runner account.

Benefits:

- no repository credential files;
- easy for a maintainer with a pre-authenticated runner.

Costs and rejection reason:

- fork and branch policy is implicit;
- shared runner state can leak across jobs or produce non-reproducible auth;
- no explicit per-run opt-in or protected evidence source;
- cleanup cannot prove it did not touch a persistent user's auth. Rejected
  because identity and isolation must be deliberate.

### Option 3: Use a protected, manual, explicitly enabled disposable live job

Provide one repository-owned local command and a GitLab wrapper that is visible
only on protected refs, requires a manual action plus an explicit live-enable
input, and receives subscription credential material only from a protected
out-of-band runner/secret boundary. Copy only the needed auth state into
disposable per-job client directories, run bounded scenarios in a disposable
scratch checkout, retain only a closed summary, and delete everything else.

Benefits:

- no live execution in default, scheduled-by-default, or fork pipelines;
- actual host behavior is tested with current supported CLIs;
- credentials and raw output stay outside repository artifacts and caches;
- unavailable auth can be detected before cost;
- exact-path and no-mutation outcomes are independently snapshot-checked;
- GitLab remains advisory while release policy can react to a confirmed defect.

Costs and risks:

- requires protected runner/secret administration outside this feature;
- hosted models remain nondeterministic and can make evidence inconclusive;
- subscription use consumes time and model allowance;
- host credential layouts and CLI flags can change;
- strong cleanup and log suppression need adversarial tests.

### Option 4: Keep live compatibility local-only and undocumented in CI

Provide a maintainer script but no GitLab job.

Benefits:

- credentials never enter CI;
- smallest operational surface.

Costs and rejection reason:

- evidence is harder to reproduce and associate with a release candidate;
- no version-controlled protected-job policy;
- teams are more likely to retain ad hoc terminal output containing private
  model material. Rejected because a protected GitLab wrapper gives a safer,
  auditable opt-in path while preserving local execution.

## Decision

Adopt Option 3.

Provide a repository-owned live compatibility command and a separate GitLab
job that invokes the same command. The command must require an explicit live
confirmation input. The GitLab job must additionally require all of:

- a protected ref;
- an explicit live-enable CI input; and
- a human-triggered manual action.

When any condition is absent, the job is not run. Never expose it as an
automatic dependency of a default or required job, and never make protected
credential material available to an unprotected or fork pipeline.

Accept authentication only from a dedicated protected runner secret store or
masked/protected file variables provisioned outside the repository. The
material must represent the existing individual-subscription CLI sessions; do
not accept vendor API keys or add an API-client path. Copy only required client
state into job-unique disposable configuration directories with restrictive
permissions. Never place those directories under the checkout, npm cache,
GitLab cache, or retained artifacts.

Before any model call:

1. resolve the exact candidate commit and create a disposable scratch checkout;
2. verify Codex and Claude executable identity and minimum versions through
   bounded parsing that retains only normalized version strings;
3. check subscription-auth availability without printing or retaining raw auth
   output; and
4. snapshot scratch source, `.banzai` control state, modes, and authorized
   artifact state.

If an executable or usable subscription session is absent, stop before a model
call and return `unavailable`. If the CLI/auth probe itself exposes only
unclassifiable output, fail closed as unavailable or fail; never infer pass.

Use the committed bundle, packaged hook, real supported CLIs, and hosted models
for the smallest scenarios that establish all of the following:

- Codex review runs with source-read-only enforcement, leaves source and
  `.banzai` control state byte/mode-identical, returns a structured review
  result, and receives no artifact-write authorization; the runner alone
  creates and validates the review artifact.
- Claude review can create the one exact authorized review artifact through
  `Write` and the packaged hook.
- Claude source writes, `.banzai` control-state writes, and writes to any other
  artifact path are denied fail-closed.
- No scenario weakens the four human gates or reuses a builder transcript.

An authenticated scenario that cannot establish its expected allowed or denied
outcome is `fail`, not `pass`; hosted nondeterminism does not authorize an
optimistic result.

Bound one live run to at most four model invocations total, at most five minutes
per invocation, and at most fifteen minutes wall-clock overall. Apply the
smallest supported vendor turn/tool limits where the CLI exposes them. These
invocation and time limits are the hard cost envelope; do not claim an exact
dollar cap when subscription CLIs do not enforce one. A bound breach is a
failed or unavailable live result, followed by process-group termination and
cleanup.

Do not stream or retain prompts, reasoning, transcripts, assistant prose, raw
structured results, tool calls/results, auth output, credentials, environment,
source, diffs, or raw stdout/stderr. Raw material needed for parsing may exist
only in restrictive temporary files inside the disposable boundary and must be
deleted before the summary is emitted. The only retainable summary fields are:

- summary schema identity and version;
- candidate commit identity in GitLab's existing job metadata, not duplicated
  in the summary body;
- overall `pass`, `fail`, or `unavailable`;
- normalized Codex and Claude versions;
- fixed check IDs with closed `pass`, `fail`, `unavailable`, or `not run`
  states;
- bounded duration and invocation counts; and
- fixed remediation codes without raw vendor text.

Publish no GitLab artifact from the live job by default. Write the bounded
summary to the job log only after applying the closed projection. Keep the job
mechanically advisory and apply ADR-0010's separate release consequences.

On normal exit, assertion failure, timeout, or interruption, terminate child
process groups and remove the scratch checkout, temporary client auth state,
raw output, and any test artifact. A cleanup failure makes the live result fail
and must not print the uncleared paths or contents.

## Consequences

Positive:

- actual Codex and Claude permission behavior can be checked before release;
- ordinary pipelines and forks remain credential-free and cost-free;
- subscription auth never becomes repository source, cache, or artifact;
- source/control snapshots independently confirm the host/hook result;
- missing auth is truthful and incurs no model cost;
- a bounded, closed summary is safer than retained ad hoc transcripts;
- local and GitLab live paths share one implementation.

Negative:

- protected runner/secret setup remains an external operational prerequisite;
- a live run can be unavailable even when source is correct;
- hosted behavior can fail nondeterministically and require bounded rerun;
- four model calls and fifteen minutes still consume subscription allowance;
- no raw retained output means maintainers may need a separately authorized
  local diagnostic run to investigate a failure.

Risks and required follow-ups:

- credential leakage: privacy tests must inject canaries in every auth/output
  source and assert absence from summaries and artifacts;
- fork exposure: policy tests must prove the job cannot run without protected
  ref, enable input, and manual action;
- prompt noncompliance: lack of affirmative allowed/denied evidence must fail,
  not be treated as permission success;
- process escape: all child groups and temporary boundaries need cleanup tests
  for non-zero, timeout, and interruption;
- vendor CLI drift: normalized version and minimum-version checks must fail
  closed before model use;
- misleading assurance: docs must keep unit/integration evidence distinct from
  a current live pass and record unavailable/not-run states.

## Compliance and Confirmation

Implementation and review must confirm:

1. no default, unprotected, fork, or merely scheduled pipeline can invoke the
   live command;
2. protected ref, explicit enable input, and manual action are all required;
3. authentication comes only from protected out-of-band subscription state and
   API-key paths remain rejected;
4. absent CLI/auth returns unavailable before a model call and never pass;
5. Codex source/control state remains unchanged and only the runner renders its
   validated artifact;
6. Claude exact-path `Write` succeeds while source, control-state, and other
   artifact writes fail closed;
7. no raw auth/model/tool/source/private content reaches log summary, cache, or
   artifact;
8. no more than four invocations, five minutes each, or fifteen minutes total
   are possible;
9. scratch, auth, output, and child processes are cleaned after every exit path;
10. the summary uses only the closed fields and states defined here;
11. the GitLab job is advisory and ADR-0010 governs release consequences;
12. live execution is never required to complete source implementation.

## Lifecycle Links

- Supersedes: None
- Superseded by: None
- Amended by [ADR-0037](./0037-unified-runner-rendered-review-artifacts.md),
  accepted 2026-09-08: the new orchestrated review contract replaces the Claude
  artifact-write probe with versioned read-only reviewer and runner-publication
  evidence. Historical live v1 semantics and other guarantees remain binding.
