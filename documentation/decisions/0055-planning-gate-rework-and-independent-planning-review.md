# ADR 0055: Planning Gate Rework and Independent Planning Review

## Status / Date / Owner / Decision Makers

- Status: Accepted
- Date: 2026-10-13
- Owner: Banzai maintainers
- Decision makers: Repository owner; explicitly accepted in chat on 2026-10-13
  with `Accept ADR-0055`.
- Acceptance date: 2026-10-13
- Accepted proposal SHA-256: `9e1c8302270f5978c85f4986d9b8a8fa2f0acfe5e51c437d87f9429808d7d58a`.
- Lifecycle effect: the amendments in Lifecycle Links are accepted. Their
  proposal-stage wording and the decision body are retained unchanged.
  Dependent planning is authorized; plan approval is still required before
  implementation.
- Implementation state: Implemented.
- Scope: strict orchestrated runs at the `adr_approval` and `plan_approval`
  gates, across the interactive terminal, the non-interactive CLI, agent
  control, the `orchestrate` supervisor protocol and the runner-delivered
  planning instructions.
- Preparation: a standalone owner request on 2026-10-13, refined through
  recorded decision cards. The owner answered:
  - PR-D2 = B: rework feedback is mandatory for both plan rework and ADR
    rework on every surface.
  - PR-D3 = C: every capability is offered in the interactive terminal, the
    non-interactive CLI and agent control. PR-D3 superseded the unanswered
    PR-D1.
  - PR-D4 = A: there is no automatic re-review; the run returns to the gate.

  The owner also added the independent planning review flow. This proposal
  records a target. It is not implemented behavior, and it is not plan
  approval.

## Related Artifacts

- Requirements:
  [description.md](../work/planning-rework-and-review/description.md), FR1–FR42.
  No plan exists. Planning cannot rely on this decision before it is accepted.
- Authority: [AGENTS.md](../../AGENTS.md),
  [PROJECT_MANIFEST.md](../../PROJECT_MANIFEST.md) sections 3–5, and the
  [decision log](README.md).
- [ADR-0002](0002-session-affinity-and-bounded-reviewer-continuity.md) and
  [ADR-0021](0021-failure-classified-reviewer-continuity.md): code-review
  reviewer continuity. This decision keeps that continuity isolated.
- [ADR-0014](0014-human-triaged-review-closure.md): explicit human triage. No
  closure is ever inferred.
- [ADR-0018](0018-agent-supervised-banzai-cli-control.md) and
  [ADR-0031](0031-interactive-decision-consultation.md): the agent-control seam
  and its revision rules. ADR-0031 also defines the tagged pending-decision
  union and the inert free-text rules.
- [ADR-0028](0028-phase-context-accounting-and-budget-policy.md): closed
  context-ledger vocabularies.
- [ADR-0034](0034-durable-human-time-observations.md): closed human-time
  anchors and response events.
- [ADR-0035](0035-cancellation-observations-and-report.md): cancellation
  observation v1.
- [ADR-0037](0037-unified-runner-rendered-review-artifacts.md) and
  [ADR-0054](0054-git-visible-work-artifacts.md): runner-rendered create-only
  review publication and the flat `documentation/work/<slug>/` directory.
- [ADR-0038](0038-explicit-plan-authority.md): approval binds the exact bundle.
- [ADR-0042](0042-runner-delivered-phase-instructions.md) and
  [ADR-0044](0044-instruction-baseline-evolution.md): six instruction phases and
  baseline transitions.
- [ADR-0052](0052-orchestrator-capability-slice-architecture.md): pure domain
  rules and capability slices.

## Context and Decision Drivers

Decision question: how should the strict workflow let a human return pending
planning artifacts with written feedback, and how should it let them obtain an
independent model review of those artifacts? The answer must keep runner
authority, reviewer independence and contract compatibility. Owner: the
repository owner.

The rework and review decisions are not split into separate ADRs. Both share the
same gate transitions, persisted decision history, human-time responses and the
agent-control revision. Deciding them separately would force two incompatible
revisions of the same closed state and control contracts.

Inspection of the working tree on 2026-10-13 found:

| Evidence                                                                                                       | Current behavior and consequence                                                                                                                                                                                                             |
| -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/orchestrator/src/state-machine.ts:15`                                                                | `needs_plan_approval` leads only to `plan_approved`, `cancelled` or `blocked`. An unsuitable plan can only be cancelled (`plan_unsuitable`).                                                                                                 |
| `src/interactive.ts:1148`, `src/cli.ts:1165`                                                                   | The plan gate offers approval only. ADR rework exists (`interactive.ts:979`), but its note is optional (`workflow.ts:2346`).                                                                                                                 |
| `plugins/banzai/skills/orchestrate/references/control-protocol.md:285-286`                                     | The supervisor protocol promises plan rework but has no route for it. Supervisor ADR rework sends no note, because free text must not travel through argv.                                                                                   |
| `src/workflow.ts:7916-7920`, `plugins/banzai/lib/review-snapshot.mjs`                                          | Code review requires an existing plan approval and a sealed `banzai-review-snapshot/v7` with task and completion evidence. It cannot review an unapproved bundle.                                                                            |
| `src/workflow.ts:467-541, 8335-8397`; `workflow/attempts/lifecycle.ts:431-449`                                 | Review attempts mutate `sessions.reviewer`, `reviewIteration`, `latestReview`, rotation reasons and review metrics. Sharing them would turn the first code review into a rotated review and consume `review-<N>` and `R<N>-F<M>` identities. |
| `src/adapters.ts:1521-1556, 2126-2133`; `hooks/spec-gate.cjs:306-328`                                          | Read-only execution is tied to the review adapter method and to the hook's `review` attempt kind. A planner-kind attempt during `planning` may write. A new attempt kind falls through to denial.                                            |
| `src/workflow.ts:1464, 1888-1896`                                                                              | `resume` and `retry` from `planning` always dispatch to ordinary planning. A review step held under `planning` needs its own persisted discriminator.                                                                                        |
| `src/store.ts:280-433`; `src/human-time.ts:35-58`; `src/context-accounting.ts:24`; `src/cancellation.ts:45-82` | Pending-decision kinds, human-time anchors and events, context-ledger attempt phases, attempt kinds, cancellation statuses and gates are closed vocabularies. Unknown values fail closed or degrade.                                         |
| `src/agent-control.ts`, `plugins/banzai/skills/orchestrate/SKILL.md:36-39`                                     | Control `7.0.0` (capabilities v7, status v5) is pinned exactly by the plugin. Any new gate action or document is a matched major revision.                                                                                                   |

Decision drivers:

- every surface offers the owner-requested behavior;
- the human stays the sole authority for approval, acceptance and dispositions;
- the reviewer is read-only and independent of the planner session;
- code-review continuity and numbering stay unchanged;
- closed contracts evolve explicitly and legacy evidence stays truthful;
- planning review is optional and adds no cost to determined runs;
- the design reuses existing mechanisms over parallel ones;
- the free-text and path ingress boundaries remain safe.

## Options Considered

The recorded owner answers rule out three variants, which are not reopened
here: a terminal-only or CLI-only surface (PR-D3), optional rework feedback
(PR-D2) and automatic re-review (PR-D4).

### Option 1: Run planning review through the code-review pipeline

Reuse `reviewing`, review-result v2, `review-<N>.md`, `sessions.reviewer` and
`banzai triage`.

- Benefits: the most reuse.
- Costs: the review snapshot needs plan approval, task checks and completion
  data that do not exist at a planning gate. Shared reviewer state would
  rotate or delta-skew the later code review and consume its numbering.
  Accept, reject and defer cannot express "apply option B" or an own
  instruction.
- Rejected.

### Option 2: Express the planner's analysis as a decision-consultation round

The planner, running as an ordinary planning attempt, would return
`gate=decision_consultation` with one card per finding, answered through
answer v2.

- Benefits: reuses phase-result v4, consultation state, terminal cards and
  answer v2.
- Costs:
  - consultation allows only one to three cards, while review findings are
    unbounded;
  - ADR-0031's materiality and non-repetition rules would be overloaded;
  - an ordinary planning attempt may already write the bundle before the human
    decides;
  - answers are not bound to a review artifact identity;
  - every consultation answer replans, so declining everything still costs a
    model call.
- Rejected.

### Option 3: Add dedicated run statuses

Add statuses such as `reviewing_planning` and `needs_planning_triage`, with their
own transitions.

- Benefits: explicit status names, and the hook could key on status alone.
- Costs: every closed `RunStatus` enumeration changes. That includes the store
  mutation guard (`CANCELLATION_STATUSES`), cancellation, doctor, evaluation,
  vocabulary, terminal attention, the agent-control switch and the generated
  readers. A missed list breaks every state write. The new statuses add no
  authority that the persisted episode and attempt kinds do not already
  provide.
- Rejected in favor of Option 4.

### Option 4: Gate-anchored planning review episode under existing statuses

Rework becomes a recorded human decision. Planning review becomes one
runner-owned episode with two read-only attempt kinds, dedicated closed result
contracts, a runner-rendered create-only artifact and a new pending-decision
kind under `needs_human_decision`. The state machine gains one ordinary
transition and one guarded restore transition.

- Benefits: follows the ADR-0031 precedent of no new approval state, isolates
  code-review continuity, makes read-only execution enforceable at three
  layers, and leaves determined runs unchanged.
- Costs: new attempt kinds, a state schema revision, a context-ledger revision,
  human-time vocabulary changes and a major control revision.
- Selected.

## Decision

Adopt Option 4.

### Authority boundaries

1. Rework requests, planning review requests, review results, planner analyses
   and planning-review triage answers are evidence. None of them:
   - sets plan approval or records ADR acceptance;
   - authorizes implementation, code-review triage, recovery or release;
   - permits an external side effect.

   `banzai approve plan` (`approvePlan`) remains the only transition to
   `plan_approved`, and an ADR `accept` decision remains the only ADR
   acceptance.

2. Planning review and its triage form an optional, human-initiated loop inside
   the existing `adr_approval` and `plan_approval` gates. They are not a sixth
   workflow gate. The installed process keeps its five-gate statement and
   describes the loop under those two gates.
3. Lite routes, standalone skill sessions and code review keep their current
   behavior.

### Rework

1. The plan gate gains a `rework` decision. Recording it requires trimmed,
   non-empty feedback. That feedback is validated by the inert free-text rules
   and bounds already used for consultation free preferences. The runner
   persists a structured plan-rework record in the run's human-decision history
   with:
   - the feedback;
   - `decidedBy`;
   - the decision time;
   - the bundle digest at request time.

   The runner then takes the new transition `needs_plan_approval → planning` and
   starts an ordinary `plan` attempt. That attempt resumes a compatible planner
   session, or else starts fresh with the durable records.

2. The runner's ADR decision boundary rejects `rework` without a non-empty note
   on every surface. `accept` and `reject` keep an optional note. Historical ADR
   decisions with a null rework note remain readable and are never rewritten.
3. The planner receives rework records through the existing `human_decisions`
   prompt component and ADR decisions through
   `approved_requirements_architecture`. No prompt category is added.
4. A revised bundle ends at a normal planning gate. Approval still binds only
   the bytes current when it is recorded (ADR-0038).

### Planning review episode

1. At either gate, the human may request a review with one of two scopes:
   - the whole planning bundle: the description, every bundle ADR and the plan
     at the plan gate; the description and every pending ADR at the ADR gate;
   - a non-empty subset of that same persisted path set.

   Any other path is rejected before mutation. The runner records each path's
   SHA-256 at request time.

2. A recorded request creates one runner-owned planning-review episode in run
   state. It holds:
   - the review number `<N>`;
   - the originating gate;
   - the scope and its digests;
   - a step: `reviewing`, `analyzing`, `awaiting_triage` or `applying`;
   - its attempt identities and its result and analysis digests.

   At most one episode is active. While review or analysis attempts run, the
   run status is `planning`; while triage is pending, it is
   `needs_human_decision`. Resume, retry and attempt reconciliation dispatch on
   the episode step and attempt kind. They never fall through to ordinary
   planning.

3. Add two attempt kinds:
   - `planning_review`, which runs with the configured `reviewer` role
     (executable, model and effort);
   - `planning_analysis`, which runs with the `planner` role.

   Both are non-mutable. Read-only execution is enforced at three independent
   layers:
   - the read-only adapter invocation used for review today (tool set or
     sandbox);
   - hook denial of every write while either kind is active, including the
     work directory;
   - a phase-scope check that rejects any workspace change.

   An interrupted or failed attempt of either kind is a retry-eligible read-only
   attempt. Mutable recovery does not apply to them.

4. A `planning_review` attempt always starts a fresh session. It never reads or
   writes code-review continuity state: `sessions.reviewer`, `reviewIteration`,
   `latestReview`, rotation reasons and review metrics. It never consumes
   `review-<N>` or `R<N>-F<M>` identities. ADR-0002 and ADR-0021 are unaffected.
   A `planning_analysis` attempt resumes a compatible planner session, or else
   starts fresh with the durable episode records.
5. At four points the runner rehashes the scope: before publishing the review,
   before opening triage, before applying the triage and before restoring a
   gate. On a mismatch, the pending result is discarded unpublished, no
   approval is recorded and the run is blocked with a stale-review reason. A
   retry then starts a new review of the same paths at their current bytes.
6. A review with zero findings is published and starts no analysis. The runner
   restores the originating gate through the existing transitions out of
   `planning`.
7. No review starts automatically. A later review receives the next `<N>`.

### Contracts and artifact

1. **Reviewer result.** The reviewer returns the new closed
   `banzai-planning-review-result/v1`. It echoes the runner-supplied review
   number and scope digests. It carries zero or more bounded findings. Each
   finding has:
   - an ID `P<N>-F<M>`;
   - a severity from the code-review vocabulary (`blocker`, `should_fix`,
     `nit`);
   - a closed planning category;
   - a summary;
   - one or more bounded evidence items, each a repository-relative path, a
     nullable line and a detail;
   - a suggested resolution;
   - a confidence.

   The result has no verdict, snapshot digest, task checks or completion data.

2. **Planner analysis.** The planner returns the new closed
   `banzai-planning-review-analysis/v1`. It references the review number and
   the result digest, and has exactly one entry per finding. Each entry
   carries:
   - an assessment: `agree`, `partially_agree` or `disagree`;
   - a rationale;
   - one to three options, each with an option ID, a label and its
     consequences;
   - a recommendation that is null or names a listed option, with a rationale.

   String bounds, unknown-field rejection and identity checks follow the
   consultation-card conventions. The runner rejects missing, duplicate or
   unknown entries before opening triage.

3. **Unchanged contracts.** Phase-result v4 and review-result v2 are
   unchanged. The two new contracts are dedicated result contracts for their
   attempt kinds.
4. **Rendered artifact.** The runner alone renders `planning-review-<N>.md`
   (identity `banzai-planning-review/v1`), and only from a validated result. The
   artifact records:
   - the review number and originating gate;
   - the reviewed paths with their SHA-256;
   - the reviewer executable, model and effort;
   - the request time;
   - every finding, rendered losslessly with the ADR-0037 value escaping.
5. **Publication.** The artifact is published create-only beside the
   description and plan in the bound work directory. Publication uses the
   ADR-0037/ADR-0054 temp-file, link and visibility-check path, and an existing
   path is never overwritten.
   - `<N>` is one more than the larger of two values: the highest number the
     run has published, and the highest existing `planning-review-<k>.md` in
     the directory.
   - Work-document ownership and inventory recognize the file name pattern, so
     binding v3 gains no role.
   - The artifact is not part of the approval bundle and never changes an
     approval digest.
6. The analysis and the triage are durable run evidence in state and events,
   and the current status shows them. This decision does not render them into
   a Git-visible document.

### Planning-review triage

1. Add the pending-decision kind `planning_review_triage` to the closed tagged
   union. It holds:
   - the episode identity and review number;
   - the artifact path and its SHA-256;
   - the analysis digest and the originating gate;
   - the finding projections and analysis entries.
2. An answer is closed and keyed to the run, the review number and the
   analysis digest. It carries exactly one disposition per finding, plus an
   optional additional instruction (inert free text). A disposition is one of:
   - `option`, with an option ID of that finding;
   - `instruction`, with inert free text;
   - `decline`.

   The answer is validated atomically before mutation. Missing, duplicate,
   unknown, stale and replayed identities are rejected. An answer is consumed
   once and recorded in the human-decision history.

3. What happens next depends on the answer:
   - **Actionable.** At least one `option` or `instruction`, or a non-empty
     additional instruction, starts an ordinary `plan` attempt. That attempt
     receives the artifact path, the analysis and the exact dispositions
     through the existing `review_triage_evidence` component. It applies only
     those dispositions and ends at a normal planning gate.
   - **Not actionable.** The runner restores the originating gate without
     invoking a model. It uses the new guarded transition
     `needs_human_decision → needs_adr_approval | needs_plan_approval`. That
     transition is permitted only when clearing a planning-review triage with
     no actionable disposition and unchanged scope bytes.
4. The planner never edits an Accepted ADR body. A disposition that changes an
   accepted decision produces a Proposed ADR that passes the ADR approval gate.
5. The terminal renders each finding, then the planner's assessment and
   options, using the existing consultation-card presentation helpers. Pause,
   EOF and Ctrl+C leave the pending decision untouched.

### Human CLI grammar

1. **Plan gate.** `banzai approve plan [--decision approve|rework] [--note
<text>]`. The default `approve` preserves current behavior. `rework` requires
   a non-empty `--note`.
2. **ADR gate.** `banzai approve adr --id <id> --decision
accept|reject|rework [--note <text>]`. `rework` requires a non-empty
   `--note`, and fails with `INVALID_DECISION` without it.
3. **Review request.** Add `banzai review planning [--artifact <path>]...`. It
   applies to whichever of the two gates is pending. Omitting `--artifact`
   selects the whole planning bundle.
4. **Triage answers.** These travel only through the interactive terminal or
   the closed direct-stdin answer document of `banzai control answer`, as
   consultation answers do today. There is no argv grammar for per-finding free
   text.

### Agent control

1. Publish a new major agent-control contract with successor capability and
   status documents; the plan fixes their exact identifiers and numbers.
   - The capabilities declare the new documents and operations.
   - At the ADR and plan gates, status lists the available decisions,
     including `rework` and `review`, with the exact eligible review paths.
   - At triage, status reports a distinct next action and a pending gate. That
     gate carries the episode identity, review number, artifact path, findings,
     analysis entries and the identities an answer must use.
   - Status never downcasts these to escalation or consultation.
2. Add two closed direct-stdin documents:
   - a gate decision, which is either rework with feedback for the plan or a
     named ADR, or a review request with a scope;
   - a planning-review triage answer.

   Both stay within the existing 64 KiB input bound, follow the inert text
   rules and are validated completely before mutation. Approve, accept and
   reject keep their argv commands because they carry no free text.

3. Existing documents keep their meaning. The `orchestrate` skill and control
   protocol pin the new exact declaration. A mismatch stops at negotiation.
   The supervisor shows exact artifacts, findings and options, and never
   chooses, infers or rewrites a disposition, a recommendation or feedback.
   Plugin and CLI ship together under the release-train version.

### Evidence, accounting and instructions

1. **State and events.** The next run-state schema adds the episode,
   plan-rework and triage records with explicit reader updates. Earlier
   versions stay readable, and no episode or record is fabricated for them.
   New events cover:
   - plan rework recorded;
   - planning review requested;
   - planning review published;
   - triage pending;
   - triage recorded;
   - gate restored.

   The plan fixes their names. Event payloads carry identities, counts, paths
   and `decidedBy`, never feedback, finding or option text.

2. **Human time** (amends ADR-0034). A plan rework and a review request are
   recorded responses that close the originating gate episode. Add the anchor
   kind `planning_review_triage` with its own response event. Machine time
   spent in review or analysis is never gate time, and a restored gate opens a
   new episode.
3. **Cancellation.** A cancellation during triage records the originating gate
   in cancellation observation v1. No reason code is added.
4. **Context accounting** (amends ADR-0028). Context ledgers record the two
   attempt kinds truthfully under an explicit revision of the closed
   attempt-phase vocabulary. Legacy ledgers stay readable. Prompt components
   reuse existing categories.
5. **Evaluation.** Evaluation export and KPI gain no metrics. They keep
   reporting newer state schemas as unsupported, as they do for v8 and v9
   today, until a separately approved revision. They never fabricate values.
6. **Instructions** (amends ADR-0042):
   - Add one runner-delivered instruction phase, `planning-review`, for the
     reviewer role; the plan fixes its policy union.
   - Planner analysis and triage application use the `planning` phase, which
     gains sections for them.
   - Both changes go through ADR-0044 baseline transitions.
   - Retained Orchestrated Mode sections of standalone skills only describe the
     gate actions.

### Compatibility and release

The two intentional breaks are `approve adr --decision rework` without a note
and the major control revision. Both are named in release notes. The hook,
plugin library, contracts, generated readers and committed bundle change
together under one release-train version. ADR-0052 layering holds: transition
and eligibility rules stay pure domain rules, and the runner gathers their
evidence.

## Consequences

Positive:

- a plan can be corrected without cancelling the run, losing its context or
  inventing approval;
- both gates gain an inexpensive second opinion from a differently configured
  model, while the human keeps every decision;
- triage turns review findings into precise, auditable planner instructions,
  and declining everything costs no model call;
- code-review continuity, numbering and triage are untouched;
- every surface reaches parity, including supervised runs.

Negative:

- the change spans state, contracts, hook, adapters, prompts, terminal, CLI,
  agent control, plugin protocol, human time, context accounting and
  documentation;
- a major control revision forces matched plugin and CLI upgrades;
- scripts that send ADR rework without `--note` break;
- every review costs reviewer and planner model calls, and the planner analysis
  consumes context.

Risks and follow-ups:

- **Closed-vocabulary drift.** The plan must inventory every closed list of
  attempt kinds, pending kinds, events, anchors and state versions, including
  generated readers and the hook. The research recorded in this ADR's context
  is the starting inventory.
- **Recommendation anchoring.** Show the assessment and every option before the
  recommendation, and keep own-instruction and decline equally available.
- **Stale scope.** Rehash at every boundary and never apply a review to bytes
  it did not review.
- **Planner overreach.** Constrain the applying attempt to the recorded
  dispositions, and let independent code review and the final plan approval
  catch deviations.
- **Privacy.** Keep feedback, findings and options out of events and
  evaluation.
- **Possible follow-up.** A Git-visible triage record, if the owner later wants
  one, needs its own requirement.

## Compliance and Confirmation

Implementation and independent review must confirm:

1. Plan rework with feedback moves `needs_plan_approval → planning` without
   approval. The next `plan` attempt receives the exact feedback and prior
   records, and a revised bundle needs a new approval.
2. Empty, whitespace-only, NUL-containing, bidi-control-containing and
   over-bound feedback is rejected before any state or event change on each
   surface. This applies equally to ADR rework without a note through
   `approve adr`, the terminal and the control document.
3. Review requests reject paths outside the gate's persisted set, including
   absolute paths, `..` and symlink aliases, before any attempt starts.
4. During `planning_review` and `planning_analysis`, the adapter fixtures show
   the read-only invocation for Codex and Claude. The hook denies writes,
   including to `documentation/work/`, and the scope check rejects any change.
   Bundle SHA-256 values are identical afterwards.
5. A planning review never changes `sessions.reviewer`, `reviewIteration`,
   `latestReview`, rotation reasons, review metrics or `review-<N>` and
   `R<N>-F<M>` numbering. A subsequent code review is a fresh primary review.
6. `planning-review-<N>.md` is rendered only from a validated result. It is
   published create-only, never overwrites a file and skips existing numbers.
   It lists paths, digests and the reviewer identity, and changes no approval
   digest.
7. Zero findings restore the originating gate without analysis. A triage with
   no actionable disposition restores it without a model call. An actionable
   triage reaches an ordinary `plan` attempt with exactly the recorded
   dispositions.
8. Stale, replayed, duplicate, missing and unknown triage identities, and
   changed scope bytes, fail before mutation or model invocation.
9. Interrupted and failed review or analysis attempts are retry-eligible, keep
   bundle bytes, and are dispatched by episode step rather than to ordinary
   planning.
10. Agent-control status projects the gate decisions and the triage gate
    exactly. The new documents are closed and bounded. Earlier documents keep
    their meaning, and mismatched plugin/CLI pairs stop at negotiation.
11. Human-time evidence closes and opens the specified episodes. Cancellation
    at triage records the originating gate. Evaluation keeps the new state
    version unsupported without fabrication.
12. Legacy state, context ledgers and ADR decisions with null rework notes
    remain readable. Accepted ADR bodies are never edited by rework or triage.
13. Focused contract, store, workflow, domain, hook, adapter, prompt, terminal,
    CLI, control, human-time and injection tests pass, together with the
    repository final gate, release validation, instruction-baseline checks,
    committed-bundle parity and `git diff --check`.

## Lifecycle Links

- Proposed narrow amendment to
  [ADR-0031](0031-interactive-decision-consultation.md): add the
  `planning_review_triage` pending kind beside consultation, and reuse its
  inert-text and card conventions. Consultation semantics are unchanged.
- Proposed narrow amendment to
  [ADR-0034](0034-durable-human-time-observations.md): add one anchor kind and
  the rework, review-request and triage responses.
- Proposed narrow amendment to
  [ADR-0042](0042-runner-delivered-phase-instructions.md): add the
  `planning-review` instruction phase.
- Proposed narrow amendment to
  [ADR-0028](0028-phase-context-accounting-and-budget-policy.md): add two
  attempt kinds to the context-ledger vocabulary.
- Proposed consequential amendments to
  [ADR-0037](0037-unified-runner-rendered-review-artifacts.md) and
  [ADR-0054](0054-git-visible-work-artifacts.md): add a second runner-rendered
  numbered review family in the work directory.
- Proposed consequential amendment to
  [ADR-0018](0018-agent-supervised-banzai-cli-control.md): a major control
  revision under its existing rules.
- No accepted decision body is rewritten.
- Supersedes: None.
- Superseded by: None.
