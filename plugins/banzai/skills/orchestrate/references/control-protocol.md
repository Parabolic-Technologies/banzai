# Banzai Agent Control Protocol

Use this reference only after `orchestrate` triggers. The CLI and persisted
runner state are authoritative; this file supplies no fallback state machine.

## Capability declaration

Run this before any state-changing command, including start or answer:

```text
banzai control capabilities
```

Require one clean JSON document with:

- `schema: "banzai-agent-capabilities/v8"`
- `schemaVersion: 8`
- `controlContractVersion: "8.0.0"`
- non-empty `orchestratorVersion`
- `umbrellaContractVersion: "1.0.0"`
- `workDocuments.directoryPattern: "documentation/work/<slug>/"`,
  `bindingSchemas: ["banzai-work-binding/v3"]`, `workspaceSnapshotVersion: 3`,
  and `verificationRequestSchemas: ["banzai-verification-request/v3"]`;
  no `artifactStorage` layout or declaration capability
- exactly these supported, non-TTY operations: `status`, `start`, `answer`,
  `approveAdr`, `approveVerification`, `approvePlan`, `decideGate`, `triage`, `resume`, `retry`, `recover`, and
  `cancel`
- `start.inputSchemas: ["banzai-agent-request/v1"]`
- `answer.inputSchemas: ["banzai-agent-answer/v4", "banzai-agent-answer/v3", "banzai-agent-answer/v2",
"banzai-agent-answer/v1"]` in that order
- `approveVerification.inputSchemas: ["banzai-agent-answer/v3"]`
- `configurationPrerequisite` declares the kind, fixed actions
  `["accept", "edit", "skip", "cancel"]`, status v6 and answer v3 schemas
- `completionPublication` declares `banzai-completion-protocol/v1`, the closed
  refusal codes `COMPLETION_PUBLICATION_IO`, `COMPLETION_PUBLICATION_DRIFT` and
  `COMPLETION_PUBLICATION_INTEGRITY`, and the `pending_application` attempt
  status it may report
- `decideGate.inputSchemas: ["banzai-agent-gate-decision/v1"]`
- `planningGates` declares ADR decisions accept/reject/rework/review, plan decisions
  approve/rework/review, planning_review_triage with answer v4 and disposition
  kinds option/instruction/decline. Its limits are 8000 feedback bytes, 2000 own
  instruction bytes, 8000 additional instruction bytes, 20 findings and 128
  review paths; its status schema is v6.
- `recover.inputSchemas: ["banzai-agent-recovery/v1"]`
- `inputSchemas: []` for the other operations

Fail closed on any mismatch. Do not guess compatibility from a version string,
help text, or a partial operation set.

## Optional cancellation observation capability

Before using a cancellation reason or exact-run precondition, discover the
optional interface separately:

```text
banzai control capabilities --cancellation
```

Require `banzai-cancellation-capabilities/v1`, `schemaVersion: 1`,
`cancelCommand: "banzai cancel"`, `runOption: "--run"`,
`reasonOption: "--reason"`, `ttyRequired: false`,
`observationSchema: "banzai-cancellation-observation/v1"`,
`reportCommand: "banzai eval cancellations"`,
`reportSchema: "banzai-cancellation-report/v1"`, and the ordered reasons
`intent_changed`, `adr_rejected`, `plan_unsuitable`, `workflow_unsuitable`,
`execution_blocked`, `superseded`, `other`, `unspecified`.
The ordinary capabilities document and control input schemas remain unchanged.
There is no `banzai control cancel` or cancellation stdin document.

After the current user's explicit cancellation decision, bind the command to
the exact run from status:

```text
banzai cancel --run <run-id> [--reason <enum>]
```

Pass a reason only when the user explicitly communicated that motivation. Do
not infer it from logs, vendor failures, a rejected ADR or prior events. Omit
it when unknown. Asking for or receiving a reason supplies no additional
permission to cancel. If the optional capability is unavailable, fail closed
for this extended action: explain the unsupported interface and do not silently
drop a supplied reason or exact-run precondition. Report the actual cancellation
and analytics outcomes; cancellation can succeed while its observation fails.
The read-only report cannot edit or repair history.

## Safe stdin documents

Start uses fixed argv:

```text
banzai control start --slug <kebab-case-slug>
```

Send this complete document through direct process stdin:

```json
{
  "schema": "banzai-agent-request/v1",
  "schemaVersion": 1,
  "request": "complete user-authorized task request"
}
```

Escalation answer uses fixed argv:

```text
banzai control answer [--by <current-user-label>] [--no-resume]
```

Send this document through direct process stdin:

```json
{
  "schema": "banzai-agent-answer/v1",
  "schemaVersion": 1,
  "answers": ["answer to question 1", "answer to question 2"]
}
```

Preserve strings and order exactly. Use `--by` only for an honest current-user
label; otherwise omit it and keep the CLI default. Never identify the agent as
the human decision maker. Use `--no-resume` only when the user explicitly wants
the decision persisted without continuing.

Decision consultation uses the same fixed argv only when the latest v6 status
reports `nextAction: "answer_consultation"`. Present each exact bounded card
sequentially with the labels `Decision`, `Why this matters`, `Repository
evidence`, `Options`, and `Recommendation` when present. Preserve the current
run, request, round, decision, option, evidence, recommendation, and
response-mode identities. Never select or infer an answer. The user may choose
the recommendation, another listed option, an exact free preference, or pause
without mutation.

After the current user explicitly answers every card, send exactly one closed
keyed document shaped like:

```json
{
  "schema": "banzai-agent-answer/v2",
  "schemaVersion": 2,
  "runId": "run-from-latest-status",
  "requestId": "request-from-latest-status",
  "roundId": "round-from-latest-status",
  "answers": [
    {
      "decisionId": "decision-from-latest-status",
      "response": {
        "kind": "option",
        "optionId": "option-from-latest-status",
        "text": null
      },
      "note": null
    }
  ]
}
```

For an exact free preference use `kind: "preference"`, `optionId: null`, and
the unchanged user-authored text. Every pending decision appears exactly once;
do not add, drop, reorder by prose, or reuse a document after status changes. A
v1 answer remains valid only for `answer_escalation` and must never be sent for
consultation. Consultation is provenance, not ADR/plan approval or any other
authorization.

Use the host terminal's live-session/write-stdin mechanism: start the fixed
argv process with writable stdin, write exactly one complete JSON document, and
then close stdin. Do not use a pipe, heredoc, shell interpolation, temporary
file, or environment variable. If the process sees EOF before the document or
the host cannot keep stdin writable, treat the mutation as failed and stop;
never infer acceptance from human prose or a permissive test fixture.

Recovery uses fixed argv after the latest status has been shown and the current
user has explicitly accepted its exact risk and identity:

```text
banzai control recover [--by <current-user-label>] [--no-resume]
```

Send exactly:

```json
{
  "schema": "banzai-agent-recovery/v1",
  "schemaVersion": 1,
  "attemptId": "attempt-from-latest-status",
  "recoveryIdentity": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "unknownSideEffectsAccepted": true
}
```

Never construct this document from an older status, infer the acknowledgment,
or identify the agent as the decision maker. A changed status requires a new
human decision.

The same document covers two runner-owned source classes: an interrupted
mutable attempt, and a completed prerequisite-blocked fix whose source remains
completed while a linked attempt addresses only unresolved accepted findings.
For the second class, the bounded recovery reason names resolved and remaining
IDs and a prerequisite count; the projection deliberately omits raw requested
commands and paths. Present those bounded facts, but do not execute a
prerequisite, change project permissions, or reinterpret the state as retry on
the strength of recovery authorization.

The input limit is 64 KiB. Invalid UTF-8, JSON, schema, property sets, empty
content, unsupported versions, oversized input, and wrong answer counts fail
before mutation.

## Configuration prerequisite answer

Only `answer_configuration_prerequisite` accepts answer v3. Show the exact
current public proposal, commands, source, checkpoint and fixed options first.
Relay the current human's explicit choice through either fixed argv:

```text
banzai control answer [--no-resume] [--by <current-user-label>]
banzai approve verification [--no-resume] [--by <current-user-label>]
```

The alias requires v3 and never implies Accept. Its single direct-stdin document
has exactly `schema: "banzai-agent-answer/v3"`, `schemaVersion: 3`,
`kind: "configuration_prerequisite"`, `runId`, `decisionId`, `proposalId` from
current status and `action: accept|edit|skip|cancel`. Only Edit additionally
requires `profile: { id, commands }`, preserving the proposed profile ID.
Commands contain `name`, `command`, `args`, `timeoutMs` and optional current
command `id` for schema 3. The runner assigns new IDs; do not invent them or
supply `evidence`/`ignoreExplanatory`. Edit returns a new proposal requiring a
separate exact human Accept. Unknown, repeated, stale, oversized or unsafe
fields fail before mutation. The 64-KiB limit and direct-stdin rules apply.

The active proposal may expose its bounded command fields for human review;
this exception does not disclose completed decisions, private hashes,
continuation authority, transaction internals or raw unrelated config. Do not
reconstruct an answer from history. Accept preserves approval and work and
continues verification. Skip is current-run/configuration/type-scoped and never
waives binding obligations. External repair leaves the proposal pending until
explicit `banzai resume` revalidates it; report repair commands as an alternative
after Accept/Edit/Skip, and never execute or authorize them by inference.

## Status contract

Run:

```text
banzai control status
```

Require `schema: "banzai-agent-status/v6"` and `schemaVersion: 6`.
`activeRun: null` means no persisted run is available. A non-null `done` or
`cancelled` projection is terminal evidence, not an in-progress run. Otherwise
use only these fields:

- `runId`, `slug`, `state`, and optional `route`;
- semantic `nextAction`;
- bounded `blocked`, `retry`, and recovery summaries;
- closed `pendingGate` data;
- plan/review approval validity;
- task-completion state, source, counts, and diagnostics;
- bounded `completionPublication`: the publishing attempt and kind, protocol,
  durable stage, closed refusal code or `null`, and publisher identity, or
  `null` when no runner-owned publication exists;
- bounded verification outcomes without commands or logs;
- latest review verdict, artifact, and completion basis.

A `decision_consultation` pending gate is the only current-status surface for
its content. Require `phase: "plan"`, an exact `runId` equal to the active run,
and one `banzai-decision-consultation/v1` request containing the exact request
and round IDs plus one to three closed cards. Do not cache, reconstruct, or
merge cards from an earlier status. Historical events and evaluation are
count-only and are not a fallback source for questions or answers.

The projection intentionally excludes the original request, prompts,
transcripts, raw model output, environment, secrets, approval digests, raw
commands/arguments/logs outside the bounded active configuration proposal,
absolute repository paths, and raw `.banzai` paths.
Treat absent required fields or unexpected schema data as incompatible.

Only a non-terminal `activeRun` blocks `control start`. If the current skill
invocation explicitly requests a new run and the projection state is `done` or
`cancelled`, preserve and report the terminal evidence, then start exactly one
new run with the complete current request. Inspection, continuation, recovery,
or silence does not authorize a new start.

## State and action mapping

On `PROJECT_SETUP_REQUIRED`, stop the automatic continuation loop and relay the
exact bounded diagnostic and manual repair/migration route to the user, even
when unchanged status still advertises `resume`. Preserve saved decisions;
never repeat an answer to trigger execution. Do not run `banzai setup` or
`project-manifest` autonomously. Continue only after the user's explicit repair
or continuation instruction, through the existing fresh runner checks. CLI setup
requires an absent or terminal run; cancellation remains an explicit user choice.

| `nextAction` | Required supervisor behavior |
| --- | --- |
| `approve_adr` | Rework and independent review use an identity-bound gate-decision v1 through direct stdin to `banzai control decide`. Show every `pendingGate.artifactPaths` and `adrIds`; wait for an explicit current decision for the relevant ADR; run `banzai approve adr --id <ADR-ID> --decision <accept\|reject>` and refresh status. Do not pass an arbitrary note through shell argv. |
| `approve_plan` | Rework and independent review use gate-decision v1 through direct stdin to `banzai control decide`. Show the exact approval bundle; wait for explicit approval/rework/rejection of the current plan; only approval runs `banzai approve plan`; refresh status. |
| `answer_planning_review_triage` | Show exact artifacts, findings, all analysis options and consequences before advisory recommendations. Wait for one explicit disposition per finding and any additional instruction, send an exact v4 document through direct stdin to `banzai control answer`, then refresh status. Never choose, infer or rewrite feedback or a disposition. |
| `answer_escalation` | Show summary and ordered questions; wait for exact ordered answers; send a v1 answer through `banzai control answer`; refresh status. |
| `answer_consultation` | Show the exact current run/request/round and every bounded card with `Decision`, `Why this matters`, `Repository evidence`, `Options`, and `Recommendation` when present. Wait for one exact current-user answer per decision or pause without mutation. Send one keyed v2 answer through direct stdin; refresh status. Never choose, infer, rewrite, or treat the response as approval. |
| `answer_configuration_prerequisite` | Show the exact current proposal and Accept/Edit/Skip/Cancel; wait for the current human response, send only its identity-bound v3 document, then refresh status. Never downcast, infer consent or rewrite config. |
| `triage` | Show artifact, iteration, and every latest finding; require exactly one disposition per ID; run `banzai triage --accept <comma-list> --reject <comma-list> --defer <comma-list>` with empty strings for empty lists; refresh status. |
| `resume` | Run `banzai resume`, remain attached, then refresh status. For a `completionPublication` refusal, resume retries only the runner's deterministic publication of the same attempt; it never calls a model or starts a new attempt. |
| `retry` | Confirm `retry.eligible` and prerequisite/permission resolution; run `banzai retry`, remain attached, then refresh status. |
| `recover` | Show the exact attempt, phase, workspace counts, recovery identity, and side-effect warning. If the bounded reason identifies a completed prerequisite-blocked fix, also show its resolved/remaining IDs and prerequisite count and explain that the source stays completed. Wait for the current user's explicit authorization and acknowledgment; send the closed recovery document through `banzai control recover`; refresh status. Never run prerequisites, widen permissions, reinterpret retry, or reuse an earlier decision. |
| `cancel` | Report why retry and recovery are unavailable. When `completionPublication.refusal` is `COMPLETION_PUBLICATION_DRIFT`, also relay the exact manual prerequisite from the blocked reason (restore the recorded input or proven output and matching authority, then `resume`); an integrity refusal has no runner remedy. Run `banzai cancel` only after an explicit current user cancellation decision; otherwise stop for the user. |
| `null` | Do not mutate by default. Report terminal or stable evidence exactly. Only an explicit current new-run request permits `control start` after `done` or `cancelled`. |

Always use the current `pendingGate`; never reuse a decision after status
changes. Existing approval, triage, resume, retry, and cancel commands may emit
human stdout. Ignore that prose as state and query versioned control status.

## Evidence interpretation

- `state: done` is lifecycle only.
- `taskCompletion.state: complete` with source
  `structured completion evidence` is exact new strict-task evidence.
- `legacy`, `unknown`, or `inconsistent` never implies an `N/N` completion.
- `taskCompletion.completed: null` means the exact completed count is
  unavailable. Never convert it to zero or render `0/N`, even when `total` is
  known.
- Verification is passing only when its reported outcomes pass; an empty list,
  unavailable command, skipped suite, or stale/contradictory evidence is not a
  pass.
- Strict closure has `review.completion.basis: review_pass` or
  `human_triage`. Human triage is not reviewer pass.
- A `pending_application` attempt or a non-null `completionPublication.refusal`
  means the vendor returned but the runner has not accepted the claims; it is
  never task completion.
- Successful report/export generation can still describe partial historical
  evidence.

## Work document capability

Current capabilities v8/control 8.0.0 expose `workDocuments` with
`directoryPattern: "documentation/work/<slug>/"`,
`bindingSchemas: ["banzai-work-binding/v3"]`, `workspaceSnapshotVersion: 3`
and `verificationRequestSchemas: ["banzai-verification-request/v3"]`.
Require that exact capability before supervising new work; infer no support from
an older capability or a historical reader. New state v10 binds tracked documents
without a layout declaration. The runner alone persists execution authority;
supervisor tools never create or edit work bindings. Request v1, recovery v1,
escalation answer v1, consultation answer v2, status v6 and configuration answer
v3 retain their meanings. Existing documents stay at their known locations.

New task runs expose bounded `taskVerification` status: outcome, completeness,
absence rationale and check dispositions. Never request profiles or infer a pass
from an empty legacy verification array. Configuration-prerequisite inputs above
apply only to retained historical formats.


## Planning gate documents

Rework or independent review uses fixed argv `banzai control decide [--by
<current-user-label>] [--no-resume]`. Bind runId and gate to the current status.
For ADR rework, adrId must name a projected ADR and feedback is required; plan
rework has null adrId. Rework has null paths. Review has null feedback and adrId;
paths is null for the whole gate bundle or an exact non-empty subset of reviewPaths.
A review or rework never supplies approval or acceptance.

```json
{
  "schema": "banzai-agent-gate-decision/v1",
  "schemaVersion": 1,
  "runId": "run-from-latest-status",
  "gate": "plan_approval",
  "decision": "rework",
  "adrId": null,
  "feedback": "Exact feedback from the current user",
  "paths": null
}
```

For planning-review triage preserve the current run, episode, number and analysis
digest. Show exact artifacts, findings, all options and consequences before any
advisory recommendation. The supervisor never chooses, infers or rewrites a
disposition, recommendation or feedback. Each disposition has exactly findingId,
kind, optionId and instruction. Option chooses a listed id with null instruction;
own instruction has null optionId; decline has both null. Preserve human text.

```json
{
  "schema": "banzai-agent-answer/v4",
  "schemaVersion": 4,
  "runId": "run-from-latest-status",
  "episodeId": "planning-episode-12345678",
  "reviewNumber": 1,
  "analysisDigest": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "dispositions": [
    {"findingId": "P1-F1", "kind": "decline", "optionId": null, "instruction": null}
  ],
  "additionalInstruction": null
}
```

Encode both documents as raw UTF-8 JSON; never `\u`-escape non-ASCII text.
The 64 KiB encoded limit is independent of the individual human-text byte bounds.
On `CONTROL_INPUT_TOO_LARGE`, report the error. Never truncate, summarize or
rewrite the user's text; ask the user to shorten their own text or answer in
`banzai` in a terminal. Never downcast planning triage to v1 or consultation v2.
