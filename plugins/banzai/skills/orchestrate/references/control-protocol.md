# Banzai Agent Control Protocol

Use this reference only after `orchestrate` triggers. The CLI and persisted
runner state are authoritative; this file supplies no fallback state machine.

## Capability declaration

Run this before any state-changing command, including start or answer:

```text
banzai control capabilities
```

Require one clean JSON document with:

- `schema: "banzai-agent-capabilities/v3"`
- `schemaVersion: 3`
- `controlContractVersion: "3.0.0"`
- non-empty `orchestratorVersion`
- `umbrellaContractVersion: "1.0.0"`
- exactly these supported, non-TTY operations: `status`, `start`, `answer`,
  `approveAdr`, `approvePlan`, `triage`, `resume`, `retry`, `recover`, and
  `cancel`
- `start.inputSchemas: ["banzai-agent-request/v1"]`
- `answer.inputSchemas: ["banzai-agent-answer/v2",
"banzai-agent-answer/v1"]` in that order
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

Decision consultation uses the same fixed argv only when the latest v2 status
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

## Status contract

Run:

```text
banzai control status
```

Require `schema: "banzai-agent-status/v2"` and `schemaVersion: 2`.
`activeRun: null` means no persisted run is available. A non-null `done` or
`cancelled` projection is terminal evidence, not an in-progress run. Otherwise
use only these fields:

- `runId`, `slug`, `state`, and optional `route`;
- semantic `nextAction`;
- bounded `blocked`, `retry`, and recovery summaries;
- closed `pendingGate` data;
- plan/review approval validity;
- task-completion state, source, counts, and diagnostics;
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
commands/arguments/logs, absolute repository paths, and raw `.banzai` paths.
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
| `approve_adr` | Show every `pendingGate.artifactPaths` and `adrIds`; wait for an explicit current decision for the relevant ADR; run `banzai approve adr --id <ADR-ID> --decision <accept\|reject\|rework>` and refresh status. Do not pass an arbitrary note through shell argv. |
| `approve_plan` | Show the exact approval bundle; wait for explicit approval/rework/rejection of the current plan; only approval runs `banzai approve plan`; refresh status. |
| `answer_escalation` | Show summary and ordered questions; wait for exact ordered answers; send a v1 answer through `banzai control answer`; refresh status. |
| `answer_consultation` | Show the exact current run/request/round and every bounded card with `Decision`, `Why this matters`, `Repository evidence`, `Options`, and `Recommendation` when present. Wait for one exact current-user answer per decision or pause without mutation. Send one keyed v2 answer through direct stdin; refresh status. Never choose, infer, rewrite, or treat the response as approval. |
| `triage` | Show artifact, iteration, and every latest finding; require exactly one disposition per ID; run `banzai triage --accept <comma-list> --reject <comma-list> --defer <comma-list>` with empty strings for empty lists; refresh status. |
| `resume` | Run `banzai resume`, remain attached, then refresh status. |
| `retry` | Confirm `retry.eligible` and prerequisite/permission resolution; run `banzai retry`, remain attached, then refresh status. |
| `recover` | Show the exact attempt, phase, workspace counts, recovery identity, and side-effect warning. If the bounded reason identifies a completed prerequisite-blocked fix, also show its resolved/remaining IDs and prerequisite count and explain that the source stays completed. Wait for the current user's explicit authorization and acknowledgment; send the closed recovery document through `banzai control recover`; refresh status. Never run prerequisites, widen permissions, reinterpret retry, or reuse an earlier decision. |
| `cancel` | Report why retry and recovery are unavailable. Run `banzai cancel` only after an explicit current user cancellation decision; otherwise stop for the user. |
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
- Successful report/export generation can still describe partial historical
  evidence.

## Artifact storage capability

Current capabilities v3/control 3.0.0 advertise the declarationSchemas and bindingSchemas arrays, layouts and privateWorkspaceSnapshotVersion: 2 in `artifactStorage`. Require this capability before supervising private work. A v2/control 2.0.0 consumer is legacy-only and must not infer private storage support. The request, status, answer and recovery schemas remain unchanged. Never create or edit run work bindings through supervisor tools; the runner persists their authority.
