# ADR 0058: Human Plan Edits Re-Checked at the Plan Gate

## Status / Date / Owner / Decision Makers

- Status: Accepted
- Date: 2026-10-31
- Owner: Banzai maintainers
- Decision makers: Repository owner; explicitly accepted in chat on 2026-10-31
  with `Accept all three` (ADR-0057, ADR-0058 and ADR-0059).
- Acceptance date: 2026-10-31
- Accepted proposal SHA-256: `c205f4108880de7c5fdf1d78987fddd79ac4f4ef5e3d6f7d1de1492cde93f6fb`.
- Lifecycle effect: the amendments in Lifecycle Links are accepted and their
  reciprocal links are recorded. Their proposal-stage wording and the
  decision body are retained unchanged. Dependent planning is authorized;
  plan approval is still required before implementation.
- Implementation state: Planned.
- Preparation authority: the owner's 2.8–2.9 brief of 2026-10-30 (WP4), whose
  "Decisions already made" item 2 welcomes the runner recomputing the plan
  digest after a human edit, and the owner's request on 2026-10-31 to draft the
  Stage 1 ADRs. Preparing this proposal is not acceptance; no code may rely on
  it.

## Related Artifacts

- Program brief, WP4:
  [brief.md](../work/release-2-8-2-9-program/brief.md#wp4--re-check-human-edits-at-the-plan-gate);
  status in [tracker.md](../work/release-2-8-2-9-program/tracker.md).
- Plan gate inventory display shipped in WP3:
  [WP3 report](../work/wp03-plan-gate-verification-commands/implementation-report.md).
- Repository authority: [AGENTS.md](../../AGENTS.md) and the
  [decision lifecycle](./README.md#lifecycle).
- Related accepted decisions:
  - [ADR-0051](./0051-acceptance-time-digest-validation.md): model-authored
    digests are established when their artifact is accepted; its Option 3
    (runner-derived digests) was rejected. This proposal amends it for one
    human-authorized case.
  - [ADR-0055](./0055-planning-gate-rework-and-independent-planning-review.md):
    plan gate decisions, the `banzai approve plan` grammar and the agent-control
    gate surface. This proposal adds one action.
  - [ADR-0049](./0049-task-scoped-verification.md) §2: the v2 inventory and the
    surrounding plan commitments belong to the exact approved bundle.
    Unchanged.
  - [ADR-0038](./0038-explicit-plan-authority.md) and
    [ADR-0017](./0017-versioned-plan-task-completion-ledger.md): approval binds
    the bytes current when it is recorded; approved artifacts are immutable.
    Unchanged.
  - [ADR-0018](./0018-agent-supervised-banzai-cli-control.md) and
    [ADR-0031](./0031-interactive-decision-consultation.md): agent-control
    revision rules. [ADR-0034](./0034-durable-human-time-observations.md):
    human-time episodes.
- Enforcement owners: `approvePlan` in `packages/orchestrator/src/workflow.ts`;
  `parseTaskVerificationObligations` in
  `plugins/banzai/lib/task-verification.mjs`; `establishPlanRemainderDigest`
  and `approvedTaskIds` in
  `packages/orchestrator/src/workflow/completion/plan-tasks.ts`; plan gate
  choices in `packages/orchestrator/src/interactive.ts`; `banzai approve plan`
  in `packages/orchestrator/src/cli.ts`; `packages/orchestrator/src/agent-control.ts`
  and `plugins/banzai/skills/orchestrate/references/control-protocol.md`.

## Context and Decision Drivers

A strict plan's `banzai-verification-obligations/v2` inventory carries
`planRemainderSha256`, the SHA-256 of every plan byte outside the inventory.
ADR-0051 compares it with the plan when the planning result is accepted, so a
plan that reaches the gate has a matching digest. Any later edit to plan.md
prose, by hand or with another tool, breaks that match. Approval then fails
with `TASK_VERIFICATION_DIGEST_MISMATCH` and prints the observed digest. The
practical way out is to paste that value into the JSON block by hand.

Approval already binds whatever bytes exist when it is recorded (ADR-0038), so
an edited description or ADR passes; only the plan's remainder digest stands in
the way. Request rework (ADR-0055) makes the planner re-author the plan and its
digest at the cost of a model round, and the human edits may not survive. The
gate never says that the run waits and that its files may be edited.

ADR-0051 rejected runner-derived digests because the runner would edit an
artifact that approval then covers, and because the field would stop recording
what the model observed. Both concerns hold for model results. They do not
apply in the same way when the human who will approve asks the runner to
recompute a digest over bytes the human changed, before approval, with the
planner's value kept for audit.

Decision question: How can a human edit plan artifacts at the gate and approve
them without hashing by hand, while model-authored digests keep ADR-0051's
protection?

Drivers:

- Human edits at the gate are approvable without manual digest work.
- The approved bytes are exactly the bytes the human saw summarized.
- Model-authored digest mismatches still follow ADR-0051's repair route.
- An edit that breaks the inventory, the task headings or the runner-control
  task rule is refused precisely, before anything is written.
- The record shows what the planner wrote and what the human changed.
- Every surface (terminal, CLI, agent control) offers the action, as ADR-0055
  requires for plan gate actions.

## Options Considered

1. **Keep manual hashing, with a better message.** Print the observed digest
   and the exact JSON edit. Smallest change. Still asks people to edit a JSON
   field by hand and invites mistakes. Rejected.
2. **Runner recomputes on explicit human request at the gate.** A "Re-check my
   edits" action validates the current bundle, recomputes the remainder digest,
   rewrites only that field, summarizes the changes and returns to the gate.
   Costs: the runner writes one field of a planning artifact, and the gate
   gains an action on every surface, including a major control revision.
   Selected.
3. **Approve a mismatch on human attestation.** Leave the stale digest in
   plan.md and record the human's attestation in run state. Every later reader
   of the inventory (verification selection, required-check identities, review
   snapshots, standalone status) would need the attestation to parse the plan,
   and the Git-visible plan would stay internally inconsistent. Rejected.
4. **Relax the inventory contract.** A successor inventory that digests only
   itself, or makes the remainder digest optional, removes the binding between
   prose commitments and checks that ADR-0049 §2 relies on, and migrates every
   reader. Rejected.
5. **Use Request rework for human edits.** Already available; costs a model
   round and may not keep the edits. Retained as a separate action, not the
   route for human edits.

## Decision

Adopt option 2 for strict task-verification runs waiting at
`needs_plan_approval`.

### 1. Retain the planner's version at gate entry

Each time a planning attempt brings the run to `needs_plan_approval`, and each
time a planning review restores that gate, retain a private snapshot of the
bundle bytes (description, bundle ADRs, plan) beside the run evidence, in the
same way as the approval snapshot. It is the comparison base for the re-check
summary and the audit. A run that reached the gate before this decision has no
snapshot; its re-check states that the planner's version is unavailable and
summarizes only the current inventory.

### 2. Re-check is an explicit human action

Add the plan gate action **Re-check my edits**. It never approves. The runner,
under the workflow lock:

1. re-reads the bundle paths recorded for the gate and refuses a missing,
   symlinked or non-regular file;
2. validates the current plan exactly as approval does, except for the
   remainder digest: one well-formed v2 inventory with valid descriptors, the
   task heading grammar, the runner-control task rule and the fresh-evidence
   rule;
3. recomputes `planRemainderSha256` over the current plan bytes outside the
   inventory;
4. when it differs from the declared value, rewrites only that value: the
   64-character string inside the inventory, with every other byte unchanged,
   through an atomic replacement that fails if the plan changed after step 1;
5. records the re-check (section 4) and returns to the gate with a summary.

A refused re-check writes nothing, names the exact problem (the field, check
identity, task heading or path) and leaves the run waiting. When the declared
digest already matches, nothing is written and the summary still reports the
changed files.

### 3. Summary before the decision

The re-check summary compares the current bundle with the planner's version:

- each changed bundle file, with added, removed and changed plan sections by
  heading;
- added, removed and changed verification checks by identity, naming the
  changed fields (argv, cwd, timeout, evidence, materialization, requirement
  references);
- whether the remainder digest was rewritten;
- a prominent notice when an accepted ADR's bytes changed: the runner cannot
  tell lifecycle metadata from body text, and accepted ADR bodies are immutable.

The summary carries no file contents beyond headings, check identities and
field names. The interactive gate and `banzai status` show it until the run
leaves the gate.

### 4. Audit record and approval link

The next run-state schema adds a re-check record to the human-decision history:
`decidedBy`, time, the planner's bundle digest and declared remainder digest
(null when unavailable), the observed and written remainder digests, the
resulting bundle digest, and the changed paths. The approval record gains a
reference to the latest re-check whose resulting bundle digest equals the
approved digest, so the approval shows a human-edited plan. Earlier state
versions stay readable; no record is fabricated for them. Events carry
identities, digests, counts and paths, never text.

### 5. Approval and model results unchanged

- Approval never rewrites a digest. An approval attempt over a mismatched
  remainder still fails, and its message names the re-check action on every
  surface.
- A planning result whose remainder digest does not match its own bytes is
  still rejected at acceptance and follows ADR-0051's digest-rejected repair
  route. Re-check is offered only at `needs_plan_approval`, never for a
  rejected planning attempt.
- Rework and planning review keep their meaning. A rework or review requested
  after a re-check sees the current bytes.
- Re-check does not close the gate's human-time episode; editing time remains
  gate time under ADR-0034.

### 6. Surfaces

- Gate copy, with full repository-relative paths: "The run is waiting. Edit
  these files in any editor, then choose Re-check my edits. Exit and decide
  later keeps the run."
- Terminal: the choice sits between approve and rework.
- CLI: `banzai approve plan --decision recheck` (no note), beside ADR-0055's
  `approve` and `rework`; `--no-resume` is irrelevant because re-check never
  starts a phase.
- Agent control: publish the next major agent-control contract. Capabilities
  list `recheck` among the plan gate decisions; status shows the latest
  re-check summary; the operation carries no free text, so it needs no new
  input document. The `orchestrate` skill and control protocol pin the new
  declaration; a supervisor relays only the current human's explicit request
  and never edits planning files on its own initiative.

## Consequences

Positive:

- A prose edit to plan.md is approved without manual hashing.
- The human sees what changed against the planner's version before deciding.
- The audit trail keeps the planner's digest and marks the approval as covering
  human edits.
- ADR-0051's protection of model results is unchanged.

Negative and risks:

- The runner writes one field of a planning artifact. A defect there would
  corrupt plan bytes; the atomic, single-field, compare-and-replace write and
  its tests carry that risk.
- A recomputed digest proves only that the inventory matches the edited bytes,
  not that the edits are sound; the human remains the approver, and an
  independent planning review remains available.
- The major control revision forces matched plugin and CLI upgrades. WP9, WP10
  and WP11 also add control actions; releasing them in one revision would
  reduce churn but couples their schedules.
- The gate-entry snapshot adds private run evidence per planning round.

Follow-ups:

- After acceptance, record reciprocal lifecycle links on ADR-0051 and on
  ADR-0055 (pinned: add its exact before and after images to the allow-list in
  `packages/orchestrator/scripts/phase-resources-build.mjs`, keyed by this ADR).
- Runner instruction text that describes plan gate actions, if any, follows
  ADR-0044 transitions.
- WP4's requirements, plan and report live in
  `documentation/work/wp04-plan-gate-edit-recheck/`.

## Compliance and Confirmation

1. A prose edit to plan.md at the gate is re-checked, the remainder digest is
   rewritten with every other byte unchanged, and approval then succeeds
   without manual hashing; the approval record references the re-check.
2. An edit that breaks the inventory (missing or duplicated block, malformed
   JSON, invalid descriptor), a task heading or the runner-control task rule is
   refused with a precise message, and no file or state changes.
3. A planning result with a mismatched remainder digest is still rejected at
   acceptance and offered ADR-0051's repair route, not re-check.
4. A plan changed between the re-check's read and its write is refused without
   writing.
5. The summary lists changed files, sections and checks against the planner's
   version, flags a changed accepted ADR, and contains no file contents beyond
   headings, identities and field names.
6. Approval over a mismatched digest fails and names the re-check action in
   the terminal, the CLI and agent control.
7. Terminal, CLI and agent control offer the action; the control capabilities
   and status carry it under the new major revision, and older control
   documents keep their meaning.
8. Runs that reached the gate before this decision re-check without a
   planner's version and say so.
9. The owner accepts this ADR before any implementation relies on it.

## Lifecycle Links

- Amends, on acceptance, [ADR-0051](./0051-acceptance-time-digest-validation.md):
  besides acceptance-time establishment of a model-authored remainder digest,
  the runner may establish it over human-edited bytes on the human's explicit
  re-check at the plan gate. Its rejection of runner-derived digests for model
  results, its digest roles and its repair source remain authoritative.
- Amends, on acceptance,
  [ADR-0055](./0055-planning-gate-rework-and-independent-planning-review.md):
  adds `recheck` to the plan gate decisions, its CLI grammar and its
  agent-control surface under a new major revision. Its authority boundaries
  hold: approval remains the only transition to `plan_approved`.
- Preserves ADR-0017, ADR-0038, ADR-0049 §2 and ADR-0034.
- Supersedes: None.
- Superseded by: None.
- Required lifecycle decision: accept, reject with a reason, or request rework.
