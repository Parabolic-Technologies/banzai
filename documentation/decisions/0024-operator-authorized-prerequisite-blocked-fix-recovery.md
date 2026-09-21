# ADR 0024: Operator-Authorized Prerequisite-Blocked Fix Recovery

Publication note (2026-09-09): private operational examples were removed at
the project owner's request. The accepted decision and lifecycle are unchanged.

## Status / Date / Owner / Decision Makers

- Status: Accepted
- Date: 2026-08-19
- Owner: Banzai maintainers
- Decision makers: User, explicitly accepted in chat on 2026-08-19

## Related Artifacts

- Feature description:
  `documentation/features/recover-prerequisite-blocked-fixes/description.md`
- Feature plan:
  `documentation/development-plans/recover-prerequisite-blocked-fixes/plan.md`
  (created after this decision was explicitly accepted).
- Repository authority: `AGENTS.md`
- Manifest: sections 3, 5, 6, 8, and 10 of `PROJECT_MANIFEST.md`
- Related ADRs:
  - ADR 0002 prohibits automatic repetition of mutable work and treats session
    continuity as an optimization rather than evidence.
  - ADR 0014 limits fix scope to findings explicitly accepted by human triage.
  - ADR 0018 requires exact current human authority for agent-control mutations.
  - ADR 0020 keeps Claude subprocesses reproducible through project-scoped
    settings and deliberately excludes local settings.
  - ADR 0023 defines explicit operator-authorized recovery as new linked work
    from an exact workspace identity.

## Context and Decision Drivers

A strict fix can complete its vendor invocation with a valid structured
`outcome: blocked`: some accepted findings are resolved, while another requires
operator prerequisites outside the project-scoped model permissions. This is
the completed-blocked state the earlier recovery model did not represent.

The result was not a process failure or unknown interruption. Banzai durably
recorded the completed blocked result, including partial resolved IDs, questions,
and requested verification. Phase application then set the run to blocked,
cleared `activeAttempt`, and preserved `blockedFrom: fixing`. Ordinary retry is
therefore correctly unavailable, while ADR 0023 recovery is also unavailable
because it currently requires an active interrupted or recoverable-failed
mutable attempt with no terminal result. The UI can only offer cancellation.

Cancellation is safe but discards useful run, approval, triage, attempt, and
session lineage after the operator performs the requested prerequisite. Broadly
allowing Bash or loading `.claude/settings.local.json` would make the immediate
command runnable but would violate the reproducible scoped environment chosen by
ADR 0020 and could bypass project policy through arbitrary shell execution.
Treating the state as ordinary retry would erase the semantic distinction
between failure and a completed declaration of blocked partial progress.

Decision question: How may Banzai continue a strict run after a completed fix
attempt durably declares a prerequisite block, without changing source history,
expanding accepted scope, weakening Claude permissions, or bypassing normal
verification and review?

Decision owner: Banzai maintainers, with explicit user lifecycle approval.

Decision drivers:

- preserve completed blocked results as immutable historical evidence;
- recover the remaining accepted scope without manual `.banzai` edits;
- require exact current human authority before new mutable work;
- keep ordinary retry and interrupted-attempt recovery semantically accurate;
- retain project-scoped Claude settings, hooks, and `dontAsk` behavior;
- avoid a fifth model gate and unnecessary public-contract expansion;
- recognize compatible current schema-v2 runs without state migration;
- bound recovery depth and fail closed on ambiguous provenance;
- preserve runner verification, independent review, and human triage;
- keep recovery idempotent and privacy-minimized.

## Options Considered

### Option 1: Keep cancellation as the only action

Leave completed blocked fix results ineligible for retry and recovery. Require
the operator to cancel and start a new workflow after satisfying prerequisites.

Benefits:

- no new state transition or eligibility rule;
- no risk of misidentifying a historical source;
- current fail-closed behavior remains unchanged.

Costs and rejection reason:

- discards approval, review, triage, attempt, session, and partial-progress
  lineage even though the result is structured and unambiguous;
- encourages manual recreation of scope in a disconnected run;
- prevents safe salvage of the observed compatible run;
- makes a durable blocked result less recoverable than an uncertain interrupted
  attempt. Rejected because it is unnecessarily destructive operationally.

### Option 2: Make the blocked result an ordinary retry

Retain the source result but return `retry.eligible: true` and run another fix
through the existing retry path.

Benefits:

- small apparent UI and state-machine change;
- reuses the current retry command;
- allows another model call after prerequisites are satisfied.

Costs and rejection reason:

- retry is designed around failed attempts, while this source completed and
  returned a valid blocked result;
- a supervising agent could infer retry without a current human decision;
- retry authorization is not bound to the exact operator-inspected workspace;
- the remaining accepted scope and prior resolved progress would be easier to
  reconstruct incorrectly. Rejected because it weakens authority and semantics.

### Option 3: Widen Claude shell permissions

Pass broad Bash permission, include local settings, or add orchestrator-owned
allow rules so the original fix can execute every requested prerequisite.

Benefits:

- avoids this particular permission block in projects with permissive local
  configuration;
- may let more model turns finish without operator intervention.

Costs and rejection reason:

- broad Bash can route arbitrary commands around project allowlists and hooks;
- local settings are machine-specific and intentionally excluded by ADR 0020;
- database migrations and schema mutations may require deliberate operator
  context that a model must not infer;
- permission widening cannot solve other external prerequisites and would not
  repair an already persisted blocked run. Rejected as unsafe and incomplete.

### Option 4: Add a fifth prerequisite gate and control operation

Introduce a new workflow gate, action, authorization schema, and control
operation specifically for completed blocked results.

Benefits:

- creates terminology and payloads tailored exactly to prerequisite blocking;
- keeps interruption recovery mechanically separate;
- could model prerequisite execution as a first-class lifecycle.

Costs and rejection reason:

- expands the exact public control operation set and every client/skill surface;
- duplicates ADR 0023's current-human authority, exact-workspace binding, linked
  attempt, and downstream-gate semantics;
- a prerequisite is operator work, not a model decision gate;
- increases migration and compatibility cost without adding safety. Rejected as
  disproportionate while the existing recovery contract remains semantically
  sufficient.

### Option 5: Extend existing recovery with a completed-blocked source class

Keep retry unchanged. Recognize one additional recovery source: an unambiguous
completed strict fix attempt whose valid blocked result proves partial accepted
progress and at least one remaining prerequisite. Reuse current explicit
workspace-bound recovery authority, preserve the source record unchanged, and
create one linked attempt for only the unresolved accepted IDs.

Benefits:

- preserves accurate source and retry semantics;
- reuses an accepted human-authority and workspace-binding architecture;
- requires no broad permissions, fifth gate, or manual persisted-state edits;
- can recognize the observed schema-v2 run without rewriting history;
- retains all normal verification, review, triage, and hook checks;
- limits scope and recovery depth deterministically.

Costs and risks:

- recovery eligibility and prompting must support two evidence classes without
  confusing interruption uncertainty with a declared prerequisite block;
- source discovery must be exact when `activeAttempt` is null;
- compatibility depends on validating existing blocked results strictly;
- a one-hop limit may force cancellation if the recovery attempt blocks again.

## Decision

Adopt Option 5 if this ADR is accepted. This decision amends ADR 0023 by adding
a second, narrowly bounded recovery source; it does not replace the existing
terminal-checkpoint or interrupted-attempt paths.

### Source classification and remaining scope

Define a **prerequisite-blocked fix source** as exactly one attempt satisfying
all of these conditions:

- the non-terminal strict run is blocked from the fixing phase and has no live
  active attempt;
- a current valid review and explicit triage contain at least one accepted
  finding;
- the candidate is a completed fix attempt for that review iteration with a
  valid contract-v2 result whose `outcome` is `blocked`;
- `resolvedFindingIds` is a duplicate-free subset of the current accepted IDs
  and at least one accepted ID remains unresolved;
- bounded `questions` or `requestedVerification` state a concrete prerequisite
  or operator action rather than claiming completion;
- the attempt is not itself a recovery and no recovery descendant or later
  superseding attempt already exists;
- base commit, plan approval, completion prerequisites, review and triage
  digests, configuration, attempt evidence, and recovery records are readable
  and mutually consistent.

Require uniqueness. Missing, conflicting, malformed, stale, fully resolved,
non-fix, non-strict, or ambiguous candidates are not recoverable. Do not infer a
source from source files, reports, passing tests, raw vendor logs, or manually
edited `.banzai` state.

Compute the recovery scope as current accepted finding IDs minus the source
result's resolved IDs. Previously resolved, rejected, deferred, and unrelated
findings are immutable out-of-scope context. Preserve their existing triage and
attempt evidence.

### Recovery authority and provenance

Expose the existing `recover` action, not `retry`. Present the source attempt,
review iteration, resolved and remaining accepted IDs, bounded questions and
requested verification, workspace-change summary, and a precise warning that
the operator must first satisfy external prerequisites and inspect any partial
side effects. Do not execute those prerequisites automatically.

Require the current operator to authorize recovery for the exact source and
workspace identity using ADR 0023's versioned recovery document and closed
side-effect acknowledgment. Bind the source result identity and remaining-scope
digest into the existing recovery identity. Silence, prior plan approval,
triage, task text, retry permission, or an earlier recovery decision does not
authorize the action.

Revalidate every eligibility fact and workspace byte identity under the run
lock immediately before execution. Drift invalidates the decision and requires
fresh status and authorization. Keep the existing public `recover` operation and
recovery-input contract version when this stronger identity fits their current
semantics; do not introduce a new operation merely for alternate UI wording.

### Immutable source and linked execution

Do not pass a prerequisite-blocked source through the interrupted-attempt
transition. Preserve its status as completed and its original blocked result,
usage, duration, timestamps, session provenance, questions, requested
verification, and resolved IDs unchanged.

Create one new physical fix attempt with `recoveryOf` pointing to the completed
blocked source. A source may have at most one such descendant, and an attempt
that already has recovery provenance is ineligible as another source. This
one-hop rule prevents repeated operator acknowledgments from becoming an
unbounded mutable loop.

Build the prompt, deterministic scope, and authorization-hook input from only
the unresolved accepted IDs. Include the bounded source prerequisite context so
the model inspects newly supplied evidence rather than repeating already
resolved work. Reuse compatible session lineage only as a performance
optimization; all authority and scope must be reconstructed from durable state.

Apply the new result through the ordinary fix path. Phase-result validation,
configured runner verification, independent review, human triage, maximum
cycle policy, approval and base checks, hook authorization, and terminal rules
remain mandatory. Recovery does not manufacture verification evidence or count
the source blocked result as canonical fix completion.

### Permission, UI, and compatibility boundaries

Retain Claude `--permission-mode dontAsk`, project-only settings sources, and
project hooks. Do not add broad `Bash` permission, load local settings, or
auto-approve arbitrary prerequisite commands. A project owner may separately
change narrow project permissions, or the operator may perform prerequisites
outside Banzai, but those are not implied by recovery authorization.

Render different explanations for interrupted unknown-partial recovery and
completed prerequisite-blocked recovery. If the latter is eligible, the CLI
must not stop at the generic message that the blocked state is unrelated to a
failed attempt; it must offer recovery and cancellation while keeping ordinary
retry unavailable. Agent-control status must expose the same semantic next
action and bounded decision facts.

Read existing schema-v2 state, attempt-v2 records, and phase-result-v2 blocked
results without migration. The observed dashboard run may qualify after the
updated orchestrator is installed if all current evidence and workspace checks
still pass. Never rewrite historical bytes to force eligibility.

## Consequences

Positive:

- the observed run can potentially continue with only R1-F3 in scope;
- completed blocked results remain truthful and auditable;
- current human authority is retained for every new mutable attempt;
- project-scoped Claude permissions and hooks remain authoritative;
- no fifth gate, broad Bash bypass, or new control operation is required;
- compatible historical runs can recover without state migration;
- partial resolved progress survives while every downstream gate remains.

Negative:

- recovery eligibility gains a second source shape and stricter source-search
  logic when `activeAttempt` is null;
- UI, prompts, tests, control projections, and evaluation must distinguish two
  recovery reasons;
- the operator must perform prerequisites and authorize the exact new checkout;
- a recovered attempt that blocks again cannot recover recursively under this
  decision and may require cancellation;
- the product still cannot prove or undo external side effects.

Risks and required follow-ups:

- ambiguous source selection: require one exact current candidate and fail
  closed otherwise;
- stale partial scope: bind review, triage, source result, resolved IDs, and
  remaining IDs into the recovery identity;
- source mutation: never reuse interrupted-attempt code that rewrites the source
  status or result;
- duplicated descendants: enforce one `recoveryOf` descendant and idempotent
  authorization/execution under the run lock;
- prompt scope expansion: validate unresolved IDs before and after the model
  turn and keep hooks authoritative;
- permission regression: assert exact Claude arguments and absence of local
  settings or broad shell allowance;
- false compatibility: prove every prerequisite from durable current evidence
  and never synthesize missing fields for legacy records;
- misleading verification claims: report runner-owned verification separately
  from model-reported requested verification.

## Compliance and Confirmation

Implementation and independent review must confirm:

1. an exact completed strict fix result with `outcome: blocked`, valid partial
   accepted progress, and a concrete prerequisite exposes `recover` while
   ordinary retry remains unavailable;
2. source selection fails closed for zero, multiple, malformed, stale,
   non-fix, fully resolved, unstructured, or incompatible candidates;
3. resolved IDs are a subset of current accepted IDs and recovery scope is
   exactly accepted minus resolved;
4. rejected, deferred, previously resolved, and unrelated findings never enter
   prompt or authorization-hook scope;
5. no recovery starts without a current human decision bound to the exact
   source result, remaining scope, and workspace identity;
6. workspace, base, approval, review, triage, result, configuration, or recovery
   drift invalidates authorization before a vendor process starts;
7. the source attempt remains completed and blocked with byte-identical result,
   usage, duration, timestamps, and provenance;
8. exactly one new attempt is created with `recoveryOf` pointing to the source,
   and duplicate commands or crashes cannot create another descendant;
9. a recovery attempt and a source that already has a descendant are ineligible
   for another prerequisite-blocked recovery;
10. the existing interrupted-attempt recovery path retains its original source
    transition and behavior;
11. the existing recovery operation and input contract remain compatible, or
    implementation stops for a revised Proposed ADR before changing them;
12. CLI and agent-control output distinguish declared prerequisite blocking from
    unknown interruption and expose only bounded decision facts;
13. Claude remains in project-scoped `dontAsk` mode with no local-settings load,
    broad Bash grant, automatic prerequisite execution, or hook weakening;
14. the new attempt follows ordinary phase-result, runner verification,
    independent review, triage, maximum-cycle, hook, and completion paths;
15. status, authorization, restart, and crash boundaries are idempotent for
    attempts, decisions, sessions, usage, and finding progress;
16. privacy projections exclude raw prompts, tools, source, credentials,
    environment values, private paths, workspace identity, and arbitrary notes;
17. schema-v2 fixtures matching the observed dashboard run become eligible
    without state rewriting and yield only R1-F3 as recovery scope;
18. focused workflow, recovery, state, CLI, control, evaluation, privacy,
    adapter-argument, hook, and regression tests use no live model or target
    project mutation;
19. full tests, typecheck, lint, formatter, build/dist parity,
    `npm run verify`, eligible `npm run release:check`, and diff checks report
    exact outcomes;
20. no dependency, historical `.banzai` mutation, release-version change,
    release, install, commit, or push occurs without separate authorization.

## Lifecycle Links

- Supersedes: None
- Superseded by: None
- Would amend if accepted: ADR 0023, by adding this completed-blocked source to
  its operator-authorized recovery mechanism while leaving its accepted body
  otherwise immutable.
- Amended by [ADR-0051](./0051-acceptance-time-digest-validation.md), accepted
  2026-09-21: a digest-rejected result joins this decision's completed
  prerequisite-blocked fix source in the same operator-authorized recovery
  mechanism. This decision's own source, its explicit-authorization requirement
  and its refusals remain unchanged.
