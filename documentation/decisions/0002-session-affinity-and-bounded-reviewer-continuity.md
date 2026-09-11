# ADR 0002: Session Affinity and Bounded Reviewer Continuity

Publication note (2026-09-09): private operational examples were removed at
the project owner's request. The accepted decision and lifecycle are unchanged.

## Status / Date / Owner / Decision Makers

- Status: Accepted
- Date: 2026-07-31
- Owner: Banzai maintainers
- Decision makers: User, explicitly accepted in chat on 2026-07-31

## Related Artifacts

- Feature description:
  `documentation/features/session-affine-cross-model-workflow/description.md`
- Existing runner requirements:
  `documentation/features/cross-vendor-workflow-runner/work.md`
- Existing workflow policy: `plugins/banzai/CLAUDE.md`
- Repository authority: `AGENTS.md`
- Manifest: sections 3, 5, 6, 8, and 10 of `PROJECT_MANIFEST.md`
- Feature plan:
  `documentation/development-plans/session-affine-cross-model-workflow/plan.md`
- Related ADR: ADR 0001, Automatic Workflow Selection; no conflict.
- External capability evidence: Codex developer-command and configuration
  references document `exec resume`, inline `-c` overrides, and
  `sandbox_mode = "read-only"`.

## Context and Decision Drivers

The current strict workflow persists separate planner and implementer session
IDs. Repeated planning resumes the planner session, and fixes resume the
implementer session. Implementation never inherits compatible planning context.
Every primary review and re-review deliberately starts a fresh reviewer session.

Repeated fresh reviews reconstruct the same context and increase model work.
The decision reduces that repetition while retaining independent review.

The target is not one unrestricted conversation. The target is two independent
role lineages: a mutable builder lineage and a source-read-only reviewer
lineage. Human gates and durable evidence must continue to own authorization,
scope, recovery, and completion.

Current and target differ as follows:

- current planning and implementation always use different session lineages;
  target implementation inherits planning context only when the configured
  executable, model, and effort are compatible;
- current implementation and fixes already share an implementer session;
  target preserves that behavior within the builder lineage;
- current every review is fresh and full; target keeps the primary review fresh,
  uses bounded resumed delta re-reviews, and rotates to fresh full review on
  explicit risk and recovery triggers;
- current run state has no reviewer session binding; target persists a bounded
  reviewer lineage and observable rotation metadata;
- current durable artifacts are authoritative; target keeps that invariant and
  treats session memory only as a disposable performance cache.

Decision drivers:

- reduce strict-workflow model duration, repeated input, and reported cost;
- retain independent cross-model review and accepted-only fix scope;
- keep all four human decision gates unchanged;
- fail closed for mutable attempts and source drift;
- reapply read-only enforcement on every resumed reviewer invocation;
- preserve per-phase model configuration and legacy state compatibility;
- make session reuse measurable without persisting transcripts;
- avoid configuration flags and abstractions until repeated need is proven.

## Options Considered

### Option 1: Keep the current fresh-session policy

Keep planner and implementer sessions separate and start every review and
re-review in a fresh session.

Benefits:

- strongest isolation from stale conversational context;
- current behavior, state, prompts, and recovery remain unchanged;
- every reviewer independently reconstructs the entire review scope.

Costs and rejection reason:

- compatible planning context is discarded before implementation;
- every re-review pays for a new full audit even when only a bounded fix
  changed;
- the measured reviewer loop dominated model-attempt time and reported usage;
- repeated fresh audits can discover useful new findings, but do so without a
  bounded cost policy. Rejected because it does not meet the latency and cost
  goals demonstrated by the production run.

### Option 2: Use one builder session and let the reviewer fix its findings

Combine planning and implementation in one model session, then combine review,
fix, and re-review in a second model session.

Benefits:

- only two main context reconstructions;
- the reviewing model can immediately apply its own diagnosis;
- minimal cross-model artifact hand-off during the fix loop.

Costs and rejection reason:

- the reviewer becomes the author and verifier of its own fixes;
- human triage no longer separates independent diagnosis from mutation;
- the original builder loses ownership of implementation consistency;
- a self-fixing reviewer can converge quickly by weakening adversarial review.
  Rejected because speed does not justify losing role independence.

### Option 3: Use role-aligned affinity with bounded reviewer continuity

Retain planner, implementer, and reviewer configuration roles. When planner and
implementer executable, model, and effort match, resume the planning session for
implementation and retain it for fixes. Otherwise preserve the current fresh
implementer hand-off.

Start each primary review in a fresh independent session. Resume that reviewer
for delta re-review of accepted findings and the changed surface. Rotate to a
fresh full review when its binding is absent or incompatible, approved
artifacts changed, the previous review was unreliable, a blocker or security
finding was accepted, or two delta re-reviews completed since the latest full
review.

Benefits:

- removes avoidable builder context reconstruction without breaking model
  configurability;
- targets the measured reviewer bottleneck while retaining periodic fresh
  audits;
- keeps reviewer and builder transcripts isolated;
- preserves durable artifacts and human triage as the cross-model contract;
- supports compatible fallback for old runs and session loss;
- keeps model and effort choices separate from the session-policy experiment.

Costs and risks:

- run state must bind session IDs to role and model settings;
- re-review prompts need full and delta modes plus cumulative triage context;
- stale reviewer memory can conflict with current source unless the prompt and
  digest checks explicitly prioritize current evidence;
- resumed Codex reviews must force `sandbox_mode = "read-only"` through an
  inline config override because `codex exec resume` has no `--sandbox` flag;
- more session-policy branches increase workflow and adapter test scope;
- performance improvement remains an empirical outcome that must be evaluated
  across completed tasks.

### Option 4: Use one session for the complete workflow

Run planning, implementation, review, and fixes in one model session.

Benefits:

- maximum context continuity and minimum hand-off cost;
- simplest conversational flow.

Costs and rejection reason:

- removes cross-model review entirely;
- the author reviews and approves its own work;
- permission changes and human gates become harder to audit independently;
- one large context accumulates stale plans, source, findings, and fixes.
  Rejected because it violates the independent-review requirement.

## Decision

Adopt Option 3.

Keep the existing planner, implementer, and reviewer model configuration. Form
one builder session lineage only when planner and implementer executable, model,
and effort match. After ADR and plan approval, resume the planning session for
implementation; retain the resulting implementer session for accepted-finding
fixes. When settings or durable session evidence do not match, start the current
fresh implementer path. Never automatically repeat a failed or interrupted
mutable attempt.

Start the primary implementation review in a fresh reviewer session. Persist
its role and model binding, then resume it for delta re-reviews that verify
accepted finding IDs, changes since the preceding review, current verification,
and cumulative triage. Keep the reviewer isolated from builder transcripts and
source-read-only on every invocation.

Rotate the reviewer lineage and make the next required review a fresh full
review when the binding is missing or incompatible, the approved bundle changes,
the previous review failed, was interrupted, or returned `blocked`, the human
accepts a blocker or security finding, or two delta re-reviews have completed
since the latest full review. Rotation is runner-owned behavior, not a new human
gate.

For resumed Codex review, force the documented
`sandbox_mode = "read-only"` inline configuration override. For resumed Claude
review, reapply the restricted reviewer tools, disallowed tools, permission
mode, model, and effort. Retain workspace-digest validation and reviewer
artifact restrictions for both vendors.

Treat session context as a disposable cache. Approved artifacts, structured
results, verification evidence, workspace digests, and recorded human decisions
remain authoritative. Persist only bounded session binding, reuse mode, and
rotation metadata; do not persist new raw transcripts.

## Consequences

Positive:

- compatible strict runs avoid rebuilding repository and plan context between
  planning and implementation;
- routine fixes can be checked by a reviewer that already understands its own
  findings and prior audit scope;
- blocker, security, repeated-delta, and recovery cases still receive a fresh
  full review;
- cross-model role independence and human triage remain intact;
- existing configurations with different planner and implementer models keep
  their current behavior;
- legacy runs recover through fresh sessions rather than schema failure;
- progress and metrics can separate cold and resumed attempts for evaluation.

Negative:

- session state and review prompts become more complex;
- a resumed model can carry stale interpretations despite current evidence;
- Codex and Claude need vendor-specific resume enforcement;
- session storage or CLI compatibility failures can reduce expected savings;
- the policy reduces repeated context work but does not remove human gate time,
  deterministic verification time, or necessary implementation work.

Risks and mitigations:

- stale context: include current digest, delta, verification, and cumulative
  triage on every review and invalidate source drift;
- reviewer confirmation bias: rotate after blocker/security findings and after
  two delta reviews;
- permission regression: test the exact Codex sandbox override and Claude tool
  restrictions for fresh and resumed review;
- unsafe mutable retry: preserve the existing fail-closed boundary;
- misleading savings: compare duration and vendor-reported usage with quality
  yield over the existing 15-30-task eval set before reducing model or effort.

Required follow-ups:

- reconcile the fresh-re-review requirement in
  `documentation/features/cross-vendor-workflow-runner/work.md` and product
  docs;
- add full/delta review guidance to `feature-review` and runner prompts;
- add bounded session binding and legacy-state decoding to run state;
- expose fresh/resumed/full/delta and rotation reasons in status, events, and
  attempt evidence;
- update both vendor adapters and their parity tests;
- rebuild and verify the committed orchestrator distribution;
- collect eval evidence before any separate model or effort optimization.

## Compliance and Confirmation

Implementation and review must confirm:

1. matching planner and implementer settings resume one builder lineage across
   approval, implementation, and accepted fixes;
2. mismatched settings and legacy states start a fresh implementer session;
3. builder continuity cannot bypass ADR, plan, escalation, or triage gates;
4. the primary review is fresh and has no builder transcript;
5. a routine fix uses a resumed delta re-review and can report new changed-scope
   findings;
6. every listed rotation trigger produces a fresh full review and a durable
   reason without a new decision gate;
7. resumed Codex and Claude reviews retain source-read-only enforcement;
8. source drift, artifact validation, finding IDs, and accepted-only fix scope
   behave identically in full and delta review;
9. failed or interrupted mutable attempts remain non-retryable, while unsafe or
   missing non-mutable session state falls back to a fresh attempt;
10. old run state remains readable and does not reuse an unbound session;
11. status and attempt evidence identify lineage reuse without retaining raw
    model transcripts;
12. typecheck, lint, tests, build parity, formatter check, and
    `git diff --check` pass;
13. an eval set compares lead time, human minutes, reported tokens and cost,
    blocker yield, false-positive rate, and fix cycles before model or effort
    defaults change.

## Lifecycle Links

- Supersedes: None
- Superseded by: None
