---
name: orchestrate
description: Supervise one local Banzai CLI workflow from the current chat. Explicit user invocation only: run it only when the user runs this skill by name, and never select it from prompt wording alone, even when the prompt names Banzai or the orchestrator. Do not use for ordinary implementation, fix, plan, review, status, or inspection requests.
user-invocable: true
disable-model-invocation: true
---

# orchestrate

## Invocation

This skill runs only when the user invokes it explicitly by name (`/` or `$`).
A prompt that merely mentions Banzai, the orchestrator, or a run is not an
invocation. Never enter this skill on your own initiative, and never reproduce
its workflow from memory or by calling `banzai` directly; ask the user to run
the skill instead.

Operate the local `banzai` CLI as a thin supervisor. The runner owns workflow
selection, repository changes, state, recovery, verification, review, and
completion. The current user owns every decision gate.

Read [the control protocol](references/control-protocol.md) before invoking the
CLI. Use only its versioned identities and state/action mapping.

## Refuse nested orchestration

Before any CLI call, check only the presence of `BANZAI_RUN_ID`,
`BANZAI_APPROVAL_DIGEST`, and `BANZAI_WORKFLOW_DIGEST`; do not print their
values or enumerate the environment.

If any is present, invoke no `banzai` process and write nothing. State that this
is a runner-owned phase and follow only its assigned Banzai phase skill.

## Establish the control boundary

1. Run `banzai control capabilities` before any state-changing command.
2. Require the exact supported v7 declaration in the reference. Treat missing
   executable, non-zero exit, stderr error, malformed JSON, unsupported
   identity/version, or a missing operation as incompatible.
3. Stop with a bounded diagnostic when incompatible. Do not install Banzai,
   substitute standalone skills, or implement the task directly.
4. Run `banzai doctor --json`. Keep executable availability, configuration
   readiness, subscription authentication, and sandbox credential visibility
   as separate evidence. `ready: true` is not authentication proof.
5. Run `banzai control status`. Never read or edit `.banzai` files.

## Start or adopt one run

When `activeRun` is `null`, derive one stable kebab-case slug and start exactly
one run. Send the complete user-authorized request as the
`banzai-agent-request/v1` JSON document through direct process stdin. Keep the
argv fixed; never place request text in a shell command, environment variable,
temporary file, or `--request` argument. If the host cannot supply direct
stdin, stop instead of falling back to quoting. Open a live process session
with writable stdin, write the complete document, then close stdin. Treat early
EOF, exit before document acceptance, or inability to keep stdin writable as a
failed mutation even if later fixture or terminal prose appears to advance.

When `activeRun` is non-null and its state is neither `done` nor `cancelled`,
report its `runId`, `slug`, and state. Do not start another run. Adopt only the
machine-reported eligible action.

A terminal `done` or `cancelled` projection does not block a new run. Preserve
and report its evidence. Start exactly one new run only when the current skill
invocation explicitly asks to start new work and supplies the complete
user-authorized request; a request to inspect, continue, or recover the terminal
run is not start authority.

Serialize every state-changing command. Stay attached to it, relay concise
stderr progress at useful intervals, wait for return, then refresh with
`banzai control status` before choosing another action. Never infer state from
progress or human terminal prose.

## Preserve human authority

Relay a summary beginning with `legacy Banzai layout:` verbatim as the
escalation question or blocked/retry state; never run `project-manifest` or
edit files for it.

At `approve_adr`, `approve_plan`, `answer_escalation`,
`answer_consultation`, `answer_configuration_prerequisite`, or `triage`, present the exact
current artifact paths, ADR/finding IDs, questions, dispositions, evidence
classification, and decision provenance shown by status. Wait for an explicit
answer to this current gate.

The initial task request, permission to use Banzai, silence, an earlier
decision, or an agent recommendation is not approval or triage. Never invent,
rewrite, complete, or infer a decision.

- Relay an escalation only through `banzai control answer`, with exact ordered
  answers in a `banzai-agent-answer/v1` stdin document.
- For `answer_consultation`, present each exact current card sequentially with
  `Decision`, `Why this matters`, `Repository evidence`, `Options`, and
  `Recommendation` when present. Include the current run, request, round,
  decision, option, response-mode, evidence, and recommendation identities.
  Offer the recommendation only as an advisory user choice, allow another
  listed option or exact free preference, and allow the user to pause without a
  mutation. Never select, infer, rewrite, summarize into an answer, or fill a
  missing card. After the current user answers every card, relay one exact keyed
  `banzai-agent-answer/v2` stdin document bound to that status.
- A consultation answer records preference provenance only. It never accepts an
  ADR, approves a plan, authorizes code/fixes, triages review, authorizes
  recovery/release, or permits an external side effect. Those later operations
  require their own current status and explicit human decision.
- For the retained legacy `answer_configuration_prerequisite` format, show the proposal commands,
  source, checkpoint and fixed Accept/Edit/Skip/Cancel options. Relay only the
  current human's exact choice and, for Edit, exact structured command fields
  through `banzai-agent-answer/v3`. Preserve run/decision/proposal identities;
  Edit previews and does not apply. Never downcast this kind to escalation,
  infer Accept from plan approval, invent an external updater or edit config.
  This historical format does not authorize old-run continuation. New task runs
  never require this configuration gate.
- Relay an ADR or plan decision only through its existing approval command.
- Relay review triage only after every latest finding ID has exactly one user
  disposition: `accept`, `reject`, or `defer`.
- Never run `banzai cancel` without an explicit current user decision.

## Recover safely

Run `retry` only when status says `retry.eligible: true`, the reported external
prerequisite is resolved, and any required host execution permission has been
granted. Preserve the run and failed attempt. Never retry implicitly, restart
under a new slug, delete state, or repair a blocked run manually.

Treat `recover` as a separate current-human authorization, never as retry. Show
the bounded recovery attempt, phase, workspace change counts, exact recovery
identity, and side-effect warning from the latest status. Wait for the current
user to explicitly authorize recovery of that exact identity and acknowledge
that filesystem or external effects may be partial or duplicated. Only then
send one closed `banzai-agent-recovery/v1` document through direct stdin to
`banzai control recover`. Silence, task approval, triage, prior recovery,
`retry.eligible`, or a recommendation is never recovery authority. Refresh
status after the mutation and never reuse authorization after status changes.

Recovery status may describe either an interrupted mutable attempt or a
completed prerequisite-blocked fix. For the latter, present the bounded
resolved and remaining finding IDs plus the prerequisite count carried by the
status reason. Explain that the completed source remains historical and the new
attempt is limited to the remaining accepted scope. Recovery authorization does
not authorize the supervisor to execute requested prerequisite commands, widen
Claude permissions, load local settings, or expose raw requested commands and
paths; those require separate user-directed action outside the recovery
mutation.

Treat `CLAUDE_AUTH_UNAVAILABLE_IN_SANDBOX` as unproven credential visibility.
Do not log in, weaken authentication, or recommend re-login solely from that
classification. Request the host's normal approval only when the same eligible
Banzai operation must run outside the restricted sandbox.

Treat `CODEX_STATE_UNAVAILABLE_IN_SANDBOX` as a host-permission prerequisite,
not as SQLite lock contention, corruption, or a Codex logout. Request normal
host approval to run the same eligible Banzai operation outside the restricted
sandbox. Do not kill other Codex clients, replace state files, change the
model-facing sandbox mode, cancel the run, or retry an ineligible attempt.

## Keep runner mutations exclusive

While supervising a run, do not edit source, tests, configuration, workflow
artifacts, approved plans or ADRs, `.banzai`, Git state, or external systems.
Do not commit, push, publish, release, install, or reinstall. Only
runner-authorized Banzai phases may change the checkout.

Do not rerun a complete verification suite merely for reassurance. Use a
focused read-only diagnostic only when evidence is missing, stale,
contradictory, or material to a concrete failure, and state the reason.

## Report the outcome

Report lifecycle, route, task-completion state/source/counts/diagnostics,
verification outcomes, latest review verdict, and `review_pass` versus
`human_triage` completion separately.

Do not call `done` alone complete. Keep `cancelled`, blocked, legacy, unknown,
inconsistent, incomplete, skipped, unavailable, failed, partial, and passing
evidence distinct. Never convert a `null` completion count to zero or render it
as `0/N`; report that the exact completed count is unavailable. Claim complete
implementation only when the terminal status and runner-validated evidence
support it.
