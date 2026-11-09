# ADR 0064: Runner-Recorded Plan Remainder Digest

## Status / Date / Owner / Decision Makers

- Status: Accepted
- Date: 2026-11-06
- Owner: Banzai maintainers
- Decision makers: Repository owner; explicitly accepted in chat on 2026-11-06
  with `Accept both` (ADR-0064 and ADR-0065).
- Acceptance date: 2026-11-06
- Accepted proposal SHA-256: `ca740a05616eecc2b46af5c01a48280a33b7ed8dae9990d94a306e6865cce518`.
- Lifecycle effect: the amendments in Lifecycle Links are accepted and their
  reciprocal links are recorded. Their proposal-stage wording and the
  decision body are retained unchanged. Dependent planning is authorized;
  plan approval is still required before implementation.
- Implementation state: Implemented on 2026-11-09 by WP21 of the 2.8–2.9
  program, for the 2.8 release; the Gate 1 item awaits the owner.
- Owner choices: given on 2026-11-06, before drafting, through three closed
  questions with these answers:
  - digest: "Runner records it";
  - blocked planning: "Allow retry", decided separately in
    [ADR-0065](./0065-continuable-planner-declared-planning-blocks.md);
  - placement: "New WP21 in Stage 1".

  This ADR records the first choice as written. No owner choice is open.

- Review: one independent read-only review of this ADR and ADR-0065 on
  2026-11-06 before submission. Its findings are applied: ADR-0058 is pinned,
  the evidence record is written before the plan and needs a successor form,
  the gate-entry snapshot and re-check record carry the runner's value, the
  plan-file refusal applies, and the descriptor-source scope is exact.

- Preparation authority: the owner's `Yes, fix it here` of 2026-11-06, after
  the incident below. Preparing this proposal is not acceptance; no code may
  rely on it.

## Related Artifacts

- Incident: an owner run on 2026-11-06 (private run evidence) in a
  bootstrap-only project with the default Claude planner. The strict planner
  wrote `plan.md` with a `banzai-verification-obligations/v2` inventory but
  could not compute `planRemainderSha256`. Under `--permission-mode dontAsk`
  every hashing command it tried (`shasum`, `openssl`, `node`) was denied,
  because the project allows only its own build and test commands. The
  planner left 64 zeros in the field and returned `outcome=blocked`, which
  left the run cancel-only (see ADR-0065).
- Program tracker: [tracker.md](../work/release-2-8-2-9-program/tracker.md),
  WP21.
- Code:
  - `packages/orchestrator/src/prompts.ts`: the strict planning instruction
    asks the planner to compute the digest;
  - `packages/orchestrator/src/workflow/completion/plan-tasks.ts`:
    `validatePlanningResult` and `establishPlanRemainderDigest`;
  - `plugins/banzai/lib/task-verification.mjs`:
    `parseTaskVerificationObligations` and `rewritePlanRemainderDigest`;
  - `packages/orchestrator/src/workflow/plan-gate/recheck.ts`:
    `replacePlanBytes`, the compare-and-replace write;
  - `packages/orchestrator/src/workflow/digest-evidence/records.ts`:
    `recordResultDigestEvidence`, which today marks any unmatched comparison
    as a rejected result;
  - `packages/orchestrator/src/claude-permissions.ts`: shell commands are
    never hook-granted.
- Repository authority: [AGENTS.md](../../AGENTS.md),
  [PROJECT_MANIFEST.md](../../PROJECT_MANIFEST.md) sections 5, 6 and 10, and
  the [decision lifecycle](./README.md#lifecycle).
- Accepted decisions:
  - [ADR-0051](./0051-acceptance-time-digest-validation.md): model-authored
    digests are compared when their artifact is accepted; its Option 3
    rejected runner-derived digests. Amended here for the plan remainder role
    only.
  - [ADR-0058](./0058-human-plan-edits-rechecked-at-the-plan-gate.md): the
    runner rewrites the remainder digest on a human re-check at the plan gate;
    its §5 keeps a planner-result mismatch on ADR-0051's route. Amended here.
  - [ADR-0049](./0049-task-scoped-verification.md) §2: the inventory belongs
    to the exact approved bundle. Unchanged.
  - [ADR-0017](./0017-versioned-plan-task-completion-ledger.md) and
    [ADR-0038](./0038-explicit-plan-authority.md): approval binds the bytes
    current when it is recorded; approved artifacts are immutable. Unchanged.
  - [ADR-0059](./0059-claude-default-reviewer-and-reviewer-isolation.md):
    Claude is the default for every role, so the failure above is the default
    path. Unchanged.
  - [ADR-0065](./0065-continuable-planner-declared-planning-blocks.md):
    companion decision on continuing a planner-declared block.

## Context and Decision Drivers

**Current behaviour.** The strict planning instruction asks the planner to
compute the SHA-256 of the plan bytes outside its v2 inventory and to write it
as `planRemainderSha256`. When the planning result requests plan approval,
ADR-0051 compares that value with the plan and rejects a mismatch as a
defective result. The repair is an operator-authorized replacement attempt.

A model cannot compute SHA-256 without running a command. A Claude planner
runs with `--permission-mode dontAsk`. The spec-gate hook grants its file
writes, but shell commands are never hook-granted. Only an allow rule in a
loaded settings file can permit a hashing command. A project that allows only
its own build and test commands, or an untrusted checkout whose repository
allow rules Claude Code ignores, leaves the planner no way to produce the
digest. Since ADR-0059 every default role runs on Claude, so this is the
default configuration, not an edge case.

Even with a hashing command, the model must hash the plan without its fenced
block while keeping the surrounding newlines. That needs a pipeline or a
temporary edit of `plan.md`. ADR-0051's own defect record shows a planner
declaring a remainder digest that did not match the bytes it wrote.

**Target.** A planner-produced plan reaches the plan gate with a correct
remainder digest for either vendor, with any permission rules and in any
checkout trust state. The model does not hash anything.

ADR-0051 rejected runner-derived digests for two reasons: the field would stop
recording what the model observed, and the runner would edit an artifact that
approval then covers. For the plan remainder, the first reason carries little
weight. The digest binds the inventory to the plan prose. The model's
observation adds no evidence the runner cannot establish, and the model's
value is the less reliable one. ADR-0058 already answered the second reason
for human edits: a single-field compare-and-replace write before approval,
with the human reviewing the resulting bytes at the gate. Approval still binds
the bytes current when it is recorded.

**Drivers.**

- A strict run with the default Claude planner reaches the plan gate without
  any project permission for hashing commands.
- Model sessions gain no permission and no trust widening.
- The approved bytes are the bytes the human sees at the gate. Approval never
  rewrites a digest.
- Descriptor source identities keep ADR-0051's protection.
- The planner's declared value stays auditable.
- Standalone planning, which has no runner, keeps working.

## Options Considered

1. **Runner records the remainder digest at acceptance.** Selected.

   Benefits: removes the failure for both vendors and every permission setup,
   removes model hashing mistakes, reuses ADR-0058's write, changes no
   permission and leaves the inventory contract unchanged.

   Costs: the runner writes one field of a planning artifact before the gate,
   so a write defect would corrupt plan bytes. ADR-0058 accepted the same risk
   and its tests cover the write. In a runner-produced plan the field means
   "recorded by the runner at acceptance". ADR-0051 and ADR-0058 are amended.

2. **Grant the planner a digest helper.** The runner adds a read-only digest
   command and an exact `--allowedTools` Bash entry for planning sessions. The
   model still authors the value, and ADR-0051 is unchanged.

   Costs: widens the Claude planner's permissions with a CLI-supplied rule and
   changes the permission model, in which `--allowedTools` carries only the
   Serena whitelist today. It depends on Claude Code matching a Bash prefix
   rule against an absolute command path, which needs live evidence on every
   supported version. A miscopied value or a later edit of `plan.md` still
   costs a digest-rejected repair round. Rejected.

3. **Require a hashing allow rule in the project.** Doctor and setup ask each
   project to allow `Bash(shasum:*)`. No runtime change.

   Costs: every adopting project carries a permission rule for a runner
   concern, and untrusted checkouts ignore it. The model must still hash
   `plan.md` around its fence through a pipeline or a temporary edit, so
   hashing mistakes remain. Rejected.

4. **Make the remainder digest optional, or add a successor inventory.**
   Rejected for ADR-0058's option 4 reasons: it removes the binding that
   ADR-0049 §2 relies on and migrates every reader.

## Decision

Adopt option 1 for strict task-verification runs.

### 1. The planner does not compute the digest

The strict planning instruction tells the planner to write
`planRemainderSha256` as 64 zeros, not to compute it, and that the runner
records it. The `banzai-verification-obligations/v2` contract is unchanged:
the field stays required, holds 64 lowercase hexadecimal characters and is the
SHA-256 of every plan byte outside the complete inventory fence.

### 2. The runner records it when it accepts the planning result

For every planning result that requests plan approval, including revisions
after rework or planning review, the runner does the following before the run
enters `needs_plan_approval`:

1. reads the plan, refusing a missing, symlinked or non-regular file as
   ADR-0058 §2 step 1 does, and validates it as ADR-0058 §2 step 2 does: one
   well-formed v2 inventory with valid descriptors, the task heading grammar,
   the runner-control task rule and the fresh-evidence rule. A failure here
   keeps its current rejection, and nothing is written;
2. computes the remainder digest over the plan bytes outside the inventory;
3. records the acceptance-time digest evidence before any write: the
   planner's declared value, the observed value and whether a write follows.
   The evidence distinguishes a runner-recorded remainder from a rejected
   digest, so a runner-recorded remainder never marks the result rejected.
   The current evidence record cannot express this; the plan chooses a
   successor record version or comparison role;
4. when the declared value differs, rewrites only that 64-character value,
   every other byte unchanged, through ADR-0058 §2 step 4's atomic
   compare-and-replace write.

Any well-formed declared value is accepted, and a correct one causes no write.
A plan that changes between the read and the write is not accepted: the
attempt fails with a failure that names the plan path, and the existing retry
of a failed planning attempt applies. Reconciling an interrupted acceptance
from its terminal checkpoint applies the same steps and reaches the same plan
bytes and evidence; it never records a second, conflicting comparison, and
the planner's declared value survives.

ADR-0058 §1's gate-entry snapshot holds the recorded bytes, so a later
re-check summary compares against what the human first saw. The re-check
record's planner remainder digest (ADR-0058 §4) is therefore the
runner-recorded value; the planner's declared value lives in the
acceptance-time digest evidence.

### 3. What stays

- Approval never rewrites a digest. Human edits after gate entry use the
  ADR-0058 re-check, and an approval over a mismatched remainder still fails
  and names it.
- Source identities on lite or supplemental descriptors in implementation
  and fix results are compared at acceptance as ADR-0051 decides, and the
  digest-rejected repair source still covers them. Source identities on
  required obligations in a plan stay descriptive and are not compared.
  Planning attempts no longer reach the digest-rejected repair route through
  the plan remainder.
- Consumption-time readers of the inventory (verification selection, review
  snapshots, completion) still compare the remainder and fail closed.
- Standalone `development-plan` sessions have no runner. They keep computing
  the digest themselves. The installed plan policy, which does not say who
  computes it, is unchanged.
- Runs that are already blocked or waiting keep their state. A planning
  attempt that starts after this decision is implemented follows it.

## Consequences

Positive:

- The default Claude configuration produces approvable plans without any
  project permission.
- One model failure class disappears for both vendors.
- No session gains a permission.
- The record keeps both the planner's value and the runner's value.

Negative and risks:

- The runner writes plan bytes at one more point. The ADR-0058 write and its
  tests bound that risk.
- In runner-produced plans the field no longer records what the model
  observed.
- The runner instruction and the standalone guidance differ on who computes
  the digest.

Follow-ups:

- After acceptance, record reciprocal lifecycle links on ADR-0051 and
  ADR-0058. ADR-0051 is not pinned. ADR-0058 is pinned in
  `packages/orchestrator/phase-guidance-current.json`, so its exact before
  and after images go into `RETAINED_AUTHORITY_AMENDMENTS` in
  `packages/orchestrator/scripts/phase-resources-build.mjs`, keyed by this
  ADR, as ADR-0058 did for ADR-0055.
- The planning instruction sentence has no golden digest. A test pins the new
  sentence.
- Update `documentation/orchestrator.md`, `packages/orchestrator/MODULES.md`
  and manifest section 6.
- WP21 requirements, plan and report live in `documentation/work/wp21-*/`.

## Compliance and Confirmation

1. A strict run whose Claude planner has no allow rule for any shell command
   reaches `needs_plan_approval` with a plan whose remainder digest matches its
   bytes.
2. A planning result that declares 64 zeros, or any other well-formed wrong
   value, has only that value rewritten. Every other plan byte is unchanged.
   The acceptance evidence, recorded before the write, holds the declared and
   observed values and does not mark the result rejected.
3. A planning result that declares the correct value causes no write.
4. A missing, symlinked or non-regular plan, a malformed inventory, an invalid
   descriptor, a non-canonical task heading or a runner-control task violation
   is still rejected as today, and nothing is written.
5. A plan that changes between the runner's read and its write is not written,
   and the attempt fails in a retryable way. Reconciling an interrupted
   acceptance reaches the same bytes and evidence.
6. Approval over a mismatched remainder still fails, names the re-check and
   writes nothing.
7. A mismatched source identity on a lite or supplemental descriptor in an
   implementation or fix result is still rejected at acceptance and offered
   the digest-rejected repair route.
8. The planning instruction no longer asks the model to compute a digest and
   says the runner records it. The installed plan policy is unchanged.
9. `npm run verify` passes.

## Lifecycle Links

- Amends, on acceptance,
  [ADR-0051](./0051-acceptance-time-digest-validation.md): for the plan
  remainder role, the runner records the digest when it accepts a planning
  result instead of rejecting a model-authored mismatch. This covers the
  Applicability bullet for that role, Compliance item 2 and Option 3's
  rejection as applied to that role. Descriptor source roles, the consumption
  checks and the repair source for those roles remain.
- Amends, on acceptance,
  [ADR-0058](./0058-human-plan-edits-rechecked-at-the-plan-gate.md): §5's
  second bullet and Compliance item 3 no longer apply to the plan remainder.
  The planner's version retained at gate entry (§1) and the planner remainder
  digest in the re-check record (§4) hold the runner-recorded value; the
  planner's declared value lives in the acceptance-time digest evidence. The
  re-check, its write and approval's refusal to rewrite remain.
- Preserves ADR-0017, ADR-0038, ADR-0049 §2 and ADR-0059.
- Supersedes: None.
- Superseded by: None.
- Required lifecycle decision: accept, reject with a reason, or request rework.
