# ADR 0023: Durable Terminal Attempt Checkpoints

Publication note (2026-09-09): private operational identifiers were removed at
the project owner's request. The accepted decision and lifecycle are unchanged.

## Status / Date / Owner / Decision Makers

- Status: Accepted
- Date: 2026-08-18
- Owner: Banzai maintainers
- Decision makers: User, explicitly accepted in chat on 2026-08-18
- Rework: Revised on 2026-08-18 at the user's explicit request to add trusted
  operator-authorized recovery for mutable attempts without terminal proof.

## Related Artifacts

- Feature description:
  `documentation/features/durable-terminal-attempt-checkpoints/description.md`
- Feature plan:
  `documentation/development-plans/durable-terminal-attempt-checkpoints/plan.md`
  (created only after this decision was accepted).
- Repository authority: `AGENTS.md`
- Manifest: sections 3, 5, 6, 8, and 10 of `PROJECT_MANIFEST.md`
- Related ADRs:
  - ADR 0002 prohibits automatic repetition of failed or interrupted mutable
    attempts and treats session memory as a disposable cache.
  - ADR 0015 establishes versioned attempt-owned evidence and idempotent
    reconciliation for verification.
  - ADR 0017 makes structured task completion canonical and prohibits ordinary
    retry of mutable attempts with unknown partial effects.
  - ADR 0018 requires exact current human authority for control mutations and
    exposes only bounded recovery state.
  - ADR 0019 separates attempt-owned evidence from canonical application and
    promotes it only after validation.
  - ADR 0021 classifies process failures structurally and accounts for failed
    usage without deriving completion.

## Context and Decision Drivers

A real strict run in the sandbox project exposed a model-attempt crash window.
Fix attempt `fix-4-9884535f` started at 2026-08-18 16:18:55 Europe/Kyiv as a
resumed Claude Sonnet 5 session. Claude changed the accepted-finding scope,
reported 27/27 passing tests, wrote its change evidence, and emitted the final
schema-conforming `StructuredOutput` at 16:23:43. The operator later pressed
`Ctrl+C` while the parent Banzai CLI was still active.

The persisted attempt still had `status: started`, `result: null`, no output,
no usage, no error, and no failure cause. On the next `resume`, Banzai correctly
refused to repeat a mutable fix with potentially partial side effects. The
fail-closed rule was applied as designed, but Banzai had lost the distinction
between a completed turn awaiting persistence and unknown partial work.

Two current mechanics create that loss:

- adapters retain vendor stdout in process memory and persist a structured
  result only after the child process closes and the adapter returns;
- the CLI signal handler closes presentation and immediately re-raises
  `SIGINT` or `SIGTERM`, while detached vendor process groups deliberately do
  not receive the terminal signal.

The initial ADR proposal addressed only completed turns by adding a durable
terminal checkpoint. User review identified a second design problem: when no
checkpoint exists, forced cancellation assumes that a trusted local developer
cannot consciously accept partial-work uncertainty. That assumption does not
match the product's ownership model. The developer owns the checkout, can
inspect its state, and remains responsible for local or external side effects.

The approval and review system is not an anti-tamper boundary against the local
developer. Its purpose is to prevent accidental stale evidence, confused state,
unapproved model work, and false completion claims. A current explicit human
decision may authorize new work from an uncertain checkout without declaring
the uncertain prior attempt successful.

Current and target differ as follows:

- current process closure is the practical commit point for model results;
  target validated terminal vendor evidence is durable before closure;
- current signal cleanup abandons persistence and leaves a detached child;
  target performs coordinated bounded process-group shutdown;
- current valid completed records reconcile while every unknown mutable
  interruption forces cancellation; target automatically reconciles proven
  completion and separately offers explicit operator-authorized continuation;
- current cancellation encourages a new run that loses attempt, approval, and
  triage lineage; target preserves the original run and creates a linked new
  recovery attempt;
- current historical `started` attempts remain blocked forever; target may
  recover them as partial work when current state is consistent and the human
  authorizes the exact workspace, but never invents terminal success.

Decision question: How must Banzai distinguish proven terminal completion from
operator-accepted partial work, and how must signal shutdown, recovery
authorization, attempt lineage, and downstream gates interact?

Decision owner: Banzai maintainers, with explicit user lifecycle approval.

Decision drivers:

- preserve valid terminal results before child-process closure;
- trust the current developer to authorize continued work without treating
  local control files as canonical completion evidence;
- never repeat unknown partial mutable work automatically;
- retain explicit provenance for acceptance of repository and external-effect
  uncertainty;
- terminate active detached vendor process groups on parent interruption;
- bind authorization to the exact workspace the operator inspected;
- keep normal completion and recovery idempotent across every write gap;
- preserve the approved scope and all downstream verification and review;
- support Claude, Codex, interactive CLI, and agent control consistently;
- retain privacy and historical compatibility without vendor-private logs;
- add no dependency and avoid a transactional worktree subsystem.

## Options Considered

### Option 1: Keep process closure and forced cancellation

Continue persisting results only after vendor-process closure. Re-raise signals
immediately and force cancellation for every unknown mutable interruption.

Benefits:

- no new persisted evidence, control action, or lifecycle state;
- process exit remains a simple terminal boundary;
- no partial mutable work is repeated inside the same run.

Costs and rejection reason:

- repeats the observed loss after terminal success;
- permits detached vendor work after the parent exits;
- discards approval, triage, and attempt lineage when the operator starts a new
  workflow to salvage the checkout;
- ignores the local developer's authority to accept uncertainty. Rejected
  because it is both unrecoverable and less auditable in practice.

### Option 2: Make every mutable interruption an ordinary retry

Return `retry.eligible: true` and let `banzai retry` start another mutable
attempt without a distinct decision or workspace binding.

Benefits:

- simplest path for current and historical runs;
- reuses existing retry commands and control operation;
- a new model can inspect and finish the checkout.

Costs and rejection reason:

- a supervisor could infer retry permission without current human authority;
- ordinary retry does not prove that the operator saw partial/external-effect
  risk or the exact workspace being continued;
- later workspace changes can silently invalidate the decision;
- retry and recovery have materially different semantics and provenance.
  Rejected because trusted-human recovery must still be explicit and auditable.

### Option 3: Recover only from durable terminal checkpoints

Persist supported terminal success before child closure and reconcile only
that proven result. Keep unknown mutable interruptions non-recoverable.

Benefits:

- fixes the exact completed-turn loss without repeating mutable work;
- retains the strongest automatic fail-closed boundary;
- adds no new human recovery action.

Costs and rejection reason:

- does not help interruptions before terminal persistence or historical runs;
- still forces cancellation after the operator inspects and accepts current
  state;
- makes a new disconnected run the practical workaround;
- overweights adversarial artifact manipulation even though the developer owns
  the local checkout. Rejected as a complete solution; retained as the first,
  automatic tier of the selected design.

### Option 4: Combine terminal checkpoints with operator-authorized recovery

Automatically reconcile exact supported terminal evidence. When terminal proof
is unavailable but the run, approval, process, and workspace are consistent,
offer a distinct recovery action. Require the current operator to acknowledge
unknown repository and external side effects for the exact workspace snapshot.
Preserve the old attempt as interrupted and create a new linked attempt that
must produce a fresh valid result and pass all normal gates.

Benefits:

- recovers proven completion without cost and partial work only with human
  authority;
- preserves the original approval, triage, attempt, and evaluation lineage;
- does not turn manual files or the interrupted attempt into completion;
- keeps automation fail-closed while trusting the checkout owner;
- makes current and historical interrupted runs recoverable without manual
  `.banzai` edits;
- keeps verification and independent review as the correctness backstop.

Costs and risks:

- adds a terminal-checkpoint contract, recovery authorization, attempt linkage,
  workspace snapshot binding, and a new control operation;
- cannot discover or undo external side effects; the operator accepts that
  uncertainty rather than Banzai proving safety;
- recovery prompts and sessions must not expand approved scope;
- crash and race testing spans more state transitions.

### Option 5: Run mutable attempts in isolated transactional worktrees

Execute implementation and fixes in a disposable worktree or filesystem
snapshot and merge only after completion.

Benefits:

- repository mutations can be committed or discarded as one unit;
- interruption does not leave partial edits in the main checkout;
- filesystem retry can start from a known snapshot.

Costs and rejection reason:

- conflicts with Banzai's carried-in uncommitted baseline model;
- merging staged, unstaged, untracked, deleted, mode, and symlink changes is a
  substantial transaction subsystem;
- cannot roll back database, network, deployment, or other external effects;
- changes workspace and authorization semantics far beyond the defect.
  Rejected as disproportionate and incomplete.

## Decision

Adopt Option 4.

### Proven terminal completion

Define one versioned, attempt-owned **terminal checkpoint** as recoverable
evidence for a supported vendor terminal success. Write it atomically inside
the run boundary before child-process closure becomes necessary for progress.
Bind it to run, attempt, phase, mutability, vendor, executable, model, effort,
session context, contract identity, validated structured result, supported
terminal classification, timestamp, bounded usage, and integrity digest.

Do not store prompts, reasoning, tool results, source content, environment,
credentials, arbitrary raw streams, or private vendor paths in the checkpoint.
Raw Codex result files, a Claude tool invocation without supported terminal
confirmation, model prose, tests, and reports are not checkpoints.

On resume, validate the checkpoint against the exact active attempt, current
configuration, base commit, approval or workflow digest, and expected state.
Run every normal deterministic result validation, promote the checkpoint to the
existing completed-attempt path, account metrics once, apply the phase once,
and continue without another vendor process. Missing or invalid proof never
falls back automatically to completion.

### Operator-authorized partial recovery

Define **recovery** separately from retry and completion. Recovery is eligible
only for a mutable implementation or fix attempt whose model process is no
longer alive and whose terminal result is unavailable, while all of these facts
are currently proven:

- active attempt identity, mutability, blocked phase, and persisted record
  agree and no conflicting terminal checkpoint exists;
- the run is not terminal and no runner lock or live child owns the attempt;
- base commit, plan approval or lite-workflow digest, accepted-finding scope,
  task-completion prerequisites, configuration, and attempt evidence are
  readable and valid;
- the current workspace can be captured as one deterministic recovery identity;
- no later recovery decision or attempt already supersedes this interruption.

Offer recovery; never infer or auto-run it. Present the attempt, phase, bounded
workspace-change summary, approval validity, and an explicit warning that
filesystem and external side effects may be partial or duplicated. The current
operator must authorize continuation for the exact recovery identity and
explicitly acknowledge that uncertainty. Silence, the original task request,
plan approval, triage, ordinary retry permission, or an earlier recovery
decision is not authorization.

Persist one versioned recovery authorization with the interrupted attempt,
recovery identity, workspace digest, decision maker, decision time, and a
closed acknowledgment of unknown side effects. Store no arbitrary note. Recheck
every eligibility fact and the workspace digest immediately before execution.
Any drift invalidates the authorization and requires a new inspection and
decision.

Close the prior physical attempt as `interrupted`; do not relabel it completed
or overwrite its evidence. Create one new physical attempt with a `recoveryOf`
link. Use the compatible recorded builder lineage when it remains valid,
otherwise start a fresh implementer session. In both cases, instruct the model
to inspect current source and artifacts, assume no prior completion, and finish
only the already approved implementation tasks or accepted finding IDs.

The recovery result follows the ordinary path. Strict implementation must
return and pass the complete canonical task ledger and report projection. A fix
must not create a second task ledger and must resolve only accepted findings.
Configured verification, independent review, human triage, authorization
hooks, approval checks, and terminal completion rules remain unchanged.

### CLI and control authority

Expose recovery as a distinct `banzai recover` operation rather than weakening
`banzai retry`. Interactive use requires a current confirmation after the risk
and workspace summary. Non-TTY agent control requires a closed versioned
recovery document carrying the exact attempt, recovery identity, and explicit
side-effect acknowledgment through direct stdin.

Because the current capability declaration has an exact closed operation set,
additive recovery support requires a compatible control-contract revision and
matching updates to the `orchestrate` skill and control reference. Agent status
must expose a semantic `recover` next action and only the bounded facts needed
for the human decision. A supervising agent must present them and wait for the
current user's explicit recovery authorization.

Recovery authorization is an operator recovery mutation, not a fifth model
decision gate. The four workflow gates remain ADR approval, plan approval,
model escalation, and review triage.

### Signal and evidence boundaries

Replace immediate signal re-raise during active work with coordinated bounded
shutdown. The first `SIGINT` or `SIGTERM` stops new actions, closes live
presentation, terminates the registered vendor process group, and allows
already accepted checkpoint and attempt writes to settle before conventional
signal exit. A repeated signal or expired bound may force termination but may
not manufacture completion. Leave no registered detached child running.

Only canonically reconciled or newly completed recovery attempts contribute
completion, usage, task, review, or workflow evidence. Evaluation may report
the interrupted and linked recovery attempt through bounded lifecycle evidence,
but checkpoint content, workspace identity, arbitrary paths, and recovery
acknowledgment do not cross privacy allow-lists.

Historical attempts without checkpoints may use current operator recovery if
all present-day eligibility checks succeed. Never reconstruct terminal success
from private vendor logs or manual `.banzai` edits. The developer's local trust
authorizes new work; it does not convert mutable control artifacts into proof of
old work.

## Consequences

Positive:

- `Ctrl+C` after terminal success no longer discards completed work;
- a trusted developer can continue inspected partial work without losing the
  approved run lineage;
- automation remains fail-closed and cannot infer mutable recovery;
- the old attempt, human decision, new attempt, verification, and review remain
  auditable as distinct facts;
- manual source changes can be accepted as recovery input without becoming
  canonical completion evidence;
- signal shutdown no longer abandons detached vendor processes;
- current and historical interrupted runs become recoverable without manual
  persisted-state repair.

Negative:

- the run directory and public control surface gain new versioned contracts;
- the first `Ctrl+C` may take a short bounded interval before returning;
- recovery requires an extra human decision and model call when terminal proof
  is unavailable;
- Banzai still cannot prove or reverse external side effects;
- control-contract consumers must update for the new exact operation set.

Risks and required follow-ups:

- casual acknowledgment: make risk language concrete and bind the decision to
  the exact attempt and workspace rather than a generic yes;
- workspace race: recompute identity under the execution lock and invalidate
  stale authorization;
- external duplication: state clearly that recovery accepts rather than solves
  this risk and keep it human-only;
- scope expansion: reuse approval/workflow digests and accepted finding IDs,
  with hooks remaining authoritative;
- duplicate accounting: use unique attempt identities, one `recoveryOf` link,
  and idempotent decision and metric writes;
- false terminal detection: accept only exact supported successful events;
- signal deadlock: bound shutdown and test repeated signal, missing close,
  persistence failure, and already-dead process groups;
- local state tampering: validate for consistency and fail closed on malformed
  state, while acknowledging that the product does not create a security
  boundary against the checkout owner;
- contract drift: revise capability, status, direct-stdin recovery schema,
  supervisor rules, smoke tests, and committed bundle together.

## Compliance and Confirmation

Implementation and independent review must confirm:

1. supported Claude and Codex terminal success followed by interruption
   reconciles the same mutable attempt without a second model call;
2. interruption before terminal success never produces automatic retry or
   completion;
3. an eligible unknown-partial implementation or fix exposes recovery only
   after the child is dead and every base, approval, scope, state, and
   configuration precondition passes;
4. no recovery process starts without a current explicit human authorization
   bound to the exact attempt and workspace identity;
5. workspace drift after authorization fails with a bounded stale-recovery
   diagnostic and requires a new decision;
6. recovery closes the old attempt as interrupted, preserves its evidence, and
   creates one unique `recoveryOf` attempt without overwriting history;
7. the recovery model receives only the existing approved implementation or
   accepted-finding scope and must inspect rather than assume current state;
8. recovered strict implementation passes full task-completion validation
   before verification, while recovered fix creates no second ledger;
9. configured verification, independent review, triage, approval immutability,
   hook authorization, and terminal completion remain mandatory;
10. live process, changed HEAD, stale approval, conflicting checkpoint,
    malformed state, unsupported configuration, superseded decision, or
    terminal run fails closed without recovery;
11. ordinary retry remains distinct and a supervising agent cannot reinterpret
    retry eligibility, plan approval, silence, or an earlier decision as
    recovery authority;
12. interactive and agent-control recovery preserve exact decision provenance,
    use a closed input contract, and expose no prompt, raw stream, source,
    credential, private path, or arbitrary note;
13. the first signal terminates the process group and drains bounded
    persistence; repeated signal or timeout cannot manufacture success;
14. attempt, decision, usage, duration, fix cycle, task summary, verification,
    review state, and evaluation contributors occur exactly once across crashes
    and repeated commands;
15. historical attempts without checkpoints can recover only as new work and
    never acquire invented terminal success from source files, reports, tests,
    private logs, raw results, or manual control-state edits;
16. focused process, adapter, workflow, store, state-machine, interactive,
    control, evaluation, privacy, and hook tests cover the material decision
    table without a live vendor call;
17. full test, typecheck, lint, formatter, build/dist parity, `npm run verify`,
    eligible `npm run release:check`, and diff checks report exact outcomes;
18. no dependency, historical `.banzai` mutation, release-version change,
    release, install, commit, or push occurs without separate authorization.

## Lifecycle Links

- Narrowly amended by [ADR-0047](./0047-runner-owned-completion-projection.md),
  accepted 2026-09-15, section 7: new strict recovery returns claims and narrative;
  proven terminal results may remain pending_application until deterministic
  runner publication. Durable proof, exact authority, operator authorization for
  unknown partial work and historical checkpoint meanings remain binding.

- Supersedes: None. This decision refines ADR 0002 and ADR 0017 by keeping
  ordinary mutable retry prohibited while defining a separate, current-human
  recovery authorization for new work.
- Superseded by: None
- Amended by: ADR 0024 adds a completed prerequisite-blocked strict fix result
  as a second, narrowly bounded source for the same operator-authorized linked
  recovery mechanism. This decision otherwise remains unchanged.
