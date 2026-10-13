# ADR 0031: Interactive Decision Consultation

## Status / Date / Owner / Decision Makers

- Status: Accepted
- Date: 2026-08-31
- Owner: Banzai maintainers
- Decision makers: User, explicitly accepted in chat on 2026-08-31

## Related Artifacts

- Feature description:
  `documentation/features/interactive-decision-consultation/description.md`
- Feature plan: Not created at decision time; planning cannot rely on this
  decision before its acceptance.
- Repository authority: root `AGENTS.md`, `CLAUDE.md`, and
  `PROJECT_MANIFEST.md`
- Manifest: sections 1, 3, 5, 6, 8, 9, and 10 of `PROJECT_MANIFEST.md`
- Related ADRs:
  - ADR-0001 keeps automatic workflow selection and strict routing inside the
    runner.
  - ADR-0002 keeps compatible planner-session continuity subordinate to durable
    artifacts and recorded human decisions.
  - ADR-0008 establishes an offline, read-only, versioned CLI boundary.
  - ADR-0012 keeps plugin and orchestrator releases independently versioned.
  - ADR-0014 preserves explicit human triage and prohibits inferred closure.
  - ADR-0017 establishes per-schema phase-result evolution with truthful legacy
    handling.
  - ADR-0018 keeps the runner as the sole workflow and authorization authority
    behind a thin agent-control seam.
  - ADR-0023 preserves durable terminal attempt evidence and fail-closed
    recovery.
  - ADR-0028 governs explicit phase-context accounting and bounded context
    composition.

## Context and Decision Drivers

Banzai's strict workflow protects architectural work with durable requirements,
Proposed ADRs, explicit ADR lifecycle decisions, an approved plan, independent
review, and human triage. Those controls are strong after an artifact exists,
but the current user experience is document-centered: an engineer may first see
an important choice after the planner has already expressed it as one or more
completed ADR options. The person must then reconstruct the decisive repository
facts and trade-offs from a full document before choosing `accept`, `reject`, or
`rework`.

The planner can already stop with `outcome=needs_human_decision` and
`gate=escalation`. The runner persists a summary and ordered free-form questions,
records positional string answers, invalidates plan approval, and resumes a
compatible planner session. This proves that bounded multi-round continuity does
not require another workflow engine. It does not provide stable decision or
option identities, structured evidence and trade-offs, an advisory
recommendation, keyed answers, or a semantic distinction between collaborative
design and an escalation caused by a trigger or missing authority.

The interactive CLI consequently renders generic questions and text inputs. The
agent-control v1 status projects every `needs_human_decision` state as an
`escalation`, and its answer document contains only an ordered string array. A
supervising agent can relay those strings, but it cannot safely present a rich
decision object, bind an answer to an exact round and option, or distinguish a
consultation choice from approval. Adding such data to the closed v1 union would
silently break existing protocol consumers.

A standalone prompt-workshop skill could improve the initial conversation and
produce text to paste into `banzai`. It would remain a parallel optional entry
point, repeat repository discovery when the CLI starts, lose durable run and
session continuity at the copy boundary, and leave headless team integrations on
the old escalation protocol. It is a useful possible convenience surface, not a
sufficient long-term product boundary.

The target is conditional, first-class decision consultation inside ordinary
strict planning. The planner analyzes repository authority first, interrupts only
for a material human-owned choice, presents compact decision cards, receives an
exact current-user answer, and re-analyzes it in the same compatible lineage. It
may conduct another bounded round before it formalizes a Proposed ADR. Formal ADR
and plan approval remain separate later gates.

Decision question: What durable contract and state boundary should represent
iterative decision consultation across planner output, interactive TTY, persisted
run state, and agent control without overloading escalation, adding a mandatory
phase, or weakening formal approval gates?

Decision owner: Banzai maintainers, with explicit user lifecycle approval.

Decision drivers:

- preserve zero additional interaction for fully determined work and all current
  lite-route behavior;
- ask only after repository evidence has been inspected and only about material
  human-owned choices;
- present stable decision cards with project evidence, viable options,
  consequences, and an advisory recommendation when justified;
- support multiple bounded, durable, interruption-safe rounds with compatible
  planner-session continuity;
- bind every answer to the current run, request, round, decision, and optional
  option without treating the answer as approval;
- keep consultation semantically distinct from escalation and every formal human
  gate;
- give interactive TTY, agent-control, Codex, and Claude the same semantic
  contract;
- evolve public and persisted contracts explicitly while keeping historical runs
  truthful and readable;
- minimize persisted and exported free text and preserve existing privacy
  boundaries;
- reuse the runner, store, state machine, prompt adapters, interactive composition
  root, and installed planning skills without a dependency, daemon, or second
  workflow engine.

## Options Considered

### Option 1: Encode consultation as conventions inside `escalation`

Keep `gate=escalation`, place Markdown-like decision cards into `summary` and
`questions`, and rely on their order to associate returned strings with choices.
Teach the interactive CLI and supervising skill to recognize wording prefixes.

Benefits:

- the smallest apparent contract and state change;
- immediate reuse of the current answer and resume path;
- historical CLI commands continue to accept the same document.

Costs and rejection reason:

- one gate would mean both a blocked or triggered authority escalation and a
  collaborative choice that is expected during design;
- prose and array position become accidental machine contracts;
- an option, recommendation, evidence item, or answer cannot be bound to a stable
  identity;
- TTY and agent-control renderers can parse or summarize the prose differently;
- adding a new `pendingGate` interpretation to the closed v1 control union is
  incompatible even if its JSON schema name is left unchanged;
- status, evaluation, and future team integrations cannot distinguish why the
  human was interrupted. Rejected because semantic ambiguity would become a
  durable compatibility and authorization risk.

### Option 2: Add a conditional typed consultation gate to the existing runner

Add a planning-only `decision_consultation` gate and a structured, versioned
consultation payload to the next phase-result schema. Evolve persisted
human-decision state into a tagged escalation-or-consultation union while keeping
the current top-level `needs_human_decision` lifecycle and planner continuation.
Project the same current request through the TTY and a consultation-aware major
version of agent control. Resume planning only after the runner validates and
records exact keyed answers.

Benefits:

- consultation has one semantic model across vendors and interaction channels;
- the current runner remains the only state and authorization owner;
- simple work adds no phase, model call, or prompt;
- stable identities allow stale, duplicate, missing, and unknown answers to fail
  before mutation;
- a bounded request can survive interruption and support asynchronous team
  decisions;
- existing session affinity and durable fallback provide iterative re-analysis;
- explicit schema and protocol versions make incompatibility visible rather than
  silently reinterpreting it.

Costs and risks:

- phase-result, persisted state, status, interaction, agent-control, prompts,
  adapters, skills, evaluation, docs, release checks, and committed distribution
  must evolve together;
- a major agent-control revision temporarily requires matched plugin and CLI
  capabilities even though their product releases remain independent;
- structured questions and answers increase privacy and size constraints;
- poor planner discipline could still ask low-value or repetitive questions, so
  contract validation needs prompt, fixture, and reviewer defenses as well as
  runtime bounds.

### Option 3: Add a mandatory discovery or consultation phase

Insert a new phase before strict requirements or ADR drafting. Always run a
dedicated discovery agent, then transition to the existing planner after the
person answers or confirms that no question is needed.

Benefits:

- the activity is visible as a separate lifecycle stage;
- discovery could use a specialized prompt, model, or context budget;
- its output could be inspected independently from planning.

Costs and rejection reason:

- every strict task pays another model invocation and context transfer even when
  repository authority already determines the answer;
- discovery and planning can repeat repository scans and disagree about the
  decision boundary;
- a new phase expands state, retry, recovery, model, and budget semantics without
  improving human authority;
- it makes a UX improvement feel like workflow ceremony. Rejected because the
  consultation is a conditional planner outcome, not work that always deserves
  an independent phase.

### Option 4: Make a standalone `solution-discovery` skill the primary product

Let the user explicitly invoke a plugin skill in chat. The skill inspects the
project, conducts several question rounds, and emits a copy-ready prompt for
`banzai` or another tool. Leave the CLI workflow and contracts unchanged.

Benefits:

- can be useful without changing the orchestrator;
- supports open-ended ideation before the user commits to a Banzai run;
- the resulting prompt remains portable to other tools.

Costs and rejection reason:

- users must learn and remember a second entry point before ordinary `banzai`;
- copy and paste loses typed decision identities, provenance, interruption state,
  and session continuity;
- the CLI repeats analysis and cannot know which prompt statements were choices,
  recommendations, or established facts;
- team and headless control integrations remain limited to escalation strings;
- skill-only behavior depends on host chat memory and prompt compliance. Rejected
  as the primary long-term design. A later optional ideation skill may consume the
  same decision-card vocabulary, but it must not become workflow authority.

### Option 5: Keep a live free-form planner conversation open

Expose an unrestricted chat or service session with the planner and let the user
exchange messages until either side decides that the ADR is ready.

Benefits:

- the most conversational experience;
- arbitrary follow-up questions need no up-front schema;
- users can explore adjacent ideas freely.

Costs and rejection reason:

- transcripts, conversational state, termination, cancellation, and recovery
  become a second workflow protocol;
- vendor session behavior becomes authoritative and difficult to reproduce across
  Codex and Claude;
- stale messages, agent-authored assumptions, and unbounded context can influence
  architecture without a durable decision record;
- privacy, cost, interruption, and headless integration surfaces expand
  substantially. Rejected because Banzai needs bounded collaboration at material
  decision points, not another general chat product.

## Decision

Adopt Option 2.

### Workflow placement and authority

Add `decision_consultation` as a planning-only phase-result gate. It is a
conditional outcome of the existing strict planner, not a workflow route or a
fixed phase. The planner must first inspect the current request, manifest,
accepted ADRs, executable and public contracts, and relevant source, tests, and
documentation. It may request consultation only when a remaining human-owned
choice can materially change requirements, architecture, a quality attribute,
compatibility, risk, or scope.

Keep automatic selection and lite routes unchanged. A fully determined strict
task proceeds without a consultation prompt or additional model call. Existing
implementation and fix escalations retain their current meaning and contract.

The planner must not write a Proposed ADR that selects an option still blocked by
an unanswered consultation, and it must not write a plan that relies on that
choice. It may persist already valid requirements context, then return the typed
gate. After all consultation rounds resolve, it records concise decision
provenance in the requirements or ADR context and continues to the existing
`adr_approval` or `plan_approval` gate.

Consultation is not authorization. Selecting an option, accepting the planner's
recommendation, or supplying free text must never accept an ADR, approve a plan,
authorize implementation or fixes, triage a review, authorize recovery or a
release, or permit an external side effect. The current person remains the source
of every answer. A supervising skill may present the exact current request and
relay the exact answer, but it must not select, infer, rewrite, or complete one.

### Phase-result contract

Introduce phase-result schema v3 for new orchestrator phase calls while retaining
v1 and v2 as identifiable legacy schemas. Keep umbrella
`contractVersion: "1.0.0"`; this change evolves one result boundary under the
precedent in ADR-0017 rather than changing unrelated configuration or review
contracts.

Phase-result v3 must add:

- `decision_consultation` to the gate union;
- a required nullable, self-versioned consultation request;
- cross-field rules that permit a non-null request only for
  `outcome=needs_human_decision`, `phase=plan`, and
  `gate=decision_consultation`;
- rules that require the consultation request to be null for every other gate,
  phase, and outcome.

Define the embedded request as `banzai-decision-consultation/v1`. One request is
one stable round containing one to three ordered decision cards. The request
carries stable request and round IDs; a card has a stable decision ID, concise
title and question, why the answer matters, affected requirements or quality
attributes, bounded repository-relative evidence, the human decision owner, and
a declared response mode. When viable approaches are known, it has stable option
IDs and material benefits, costs, risks, and operational or compatibility
consequences. It may carry one advisory recommendation identified by option ID
and rationale.

The schema and runtime validator must bound collection counts and all strings,
reject unknown fields and duplicate identities, require referenced recommendation
and option IDs to exist, and reject malformed or contradictory cards before the
attempt can become a pending human decision. No renderer may parse prose to
recover this structure.

### Persisted state and continuation

Evolve new run state to schema version 3. Replace the escalation-shaped
`pendingHumanDecision` value with a closed tagged union that represents either the
unchanged escalation semantics or one exact consultation request. Persist
consultation history as structured request-and-answer records with run, request,
round, decision, and selected-option identities; exact user text and optional
notes; decision-maker label; and request and decision timestamps.

Do not persist a new general conversation transcript. Durable structured records
are the authority. Existing prompt transcript or vendor session memory may help
continuity but may not supply, change, or complete an answer.

Continue to use top-level `needs_human_decision`; do not add a new terminal or
approval state. Preserve the compatible planner session and attempt lineage when
safe. If the session is missing or a vendor cannot resume it, start a fresh
planning attempt with the bounded ordered consultation history as explicit human
decision context. Re-read current repository evidence after the answer in either
case.

Answer submission is atomic. Validate the active run and current request and round
identities, require exactly one non-empty answer for every card, validate any
selected option ID, and reject unknown, duplicate, missing, stale, malformed, or
oversized input before state mutation or model invocation. Then append one durable
record, clear only that exact pending request, invalidate any prior plan approval,
and resume planning. Interruption or pause leaves the pending request byte-for-byte
authoritative and records no answer.

The planner may emit another round only when the answer or refreshed evidence
exposes a new material human-owned decision. Decision IDs are stable within a run;
the runner rejects reuse of an already answered ID. Equivalent semantic questions
against unchanged evidence are a planner-contract and review violation even if
their wording changes.

Historical state remains truthful and readable without in-place migration. State
v1 and v2 have no consultation evidence; loaders and status must not fabricate a
request, answer, round count, or exact provenance for them. Existing escalation
records retain their original interpretation.

### Interactive experience

Reuse the current interactive composition root, progress renderer, formatting
helpers, and `@inquirer/prompts`. Do not add a full-screen TUI or dependency.
Render the current cards sequentially with the labels `Decision`,
`Why this matters`, `Repository evidence`, `Options`, and `Recommendation` when
present. Keep the first view compact and make bounded evidence and option
consequences inspectable before answering.

Offer `Use recommendation` only when a recommendation exists, allow the user to
choose another listed option or `Explain another preference`, and always provide
`Pause and decide later`. Using a recommendation still creates an explicit
current-user answer. Pause, EOF, `SIGINT`, and `SIGTERM` restore terminal state and
leave the exact request pending without invoking a model or mutating project
source.

### Agent-control compatibility

Publish agent-control contract `2.0.0` because a new pending-gate kind and keyed
answer semantics cannot be added safely to the closed v1 status and answer
documents. Add `banzai-agent-capabilities/v2`,
`banzai-agent-status/v2`, and `banzai-agent-answer/v2`. The capability declaration
must identify the exact schemas and operations before a supervising agent mutates
state. Unchanged start and recovery input semantics may retain their independent
v1 document identities; refactor the current shared schema-version constant rather
than renaming an unchanged document solely for symmetry.

Status v2 must project a consultation pending gate with the same run, request,
round, decision, option, recommendation, evidence, and response-mode identities as
persisted state, plus one semantic next action. It must never downcast consultation
to `escalation`. Answer v2 must be a closed bounded document that identifies the
active run and round and keys each answer by decision ID; option selections use
option IDs and free preferences remain exact data.

Retain the v1 protocol definition, validation fixtures, and documentation as
legacy compatibility evidence. A v1 answer may continue to serve only its existing
ordered escalation semantics and must fail against a consultation request. A v1
status projection, if retained, must fail explicitly when the current gate cannot
be represented; it must never omit or relabel consultation. Old plugin/new CLI and
new plugin/old CLI combinations stop at capability negotiation rather than guessing
semantics. Plugin and orchestrator product versions remain independently governed
by ADR-0012.

All control input continues through bounded direct stdin data. It must not travel
through shell interpolation, environment variables, temporary files, or parsed
terminal prose. Validation completes before store mutation or model construction.

### Privacy, evidence, and delivery

Human and machine current-status surfaces may expose the bounded active decision
needed to act. Historical status, events, and privacy-safe evaluation may expose
only consultation kind, counts, timings, response mode, and completion state. They
must not export historical question, option, recommendation, answer, evidence
detail, prompts, transcripts, environment values, approval digests, or raw runner
paths without a later approved contract.

Give Codex and Claude equivalent v3 schema, gate instructions, card constraints,
and human-decision context. Account for the added contract and recorded-decision
context through the existing ADR-0028 mechanism. A missing session falls back to
durable records, not inferred memory.

Synchronize plugin skills and common workflow rules, planner prompts and adapters,
contracts and loaders, runtime types and validation, state and store, TTY and
agent-control surfaces, privacy-safe evaluation, root and product documentation,
deterministic release validation, and committed distribution. Add no dependency,
service, daemon, install, product version bump, publication, live-vendor run,
commit, or push under this decision alone.

## Consequences

Positive:

- engineers make consequential choices in a compact project-specific dialogue
  before reviewing a completed ADR;
- ordinary `banzai` remains the single integrated entry point and determined work
  remains uninterrupted;
- iterative consultation becomes durable, resumable, vendor-neutral, and usable
  by both local terminals and team-facing supervisors;
- the runner and current human retain their existing workflow and authorization
  authorities;
- stable identities and closed documents make stale, partial, and ambiguous
  answers fail before mutation;
- Proposed ADR and plan approval continue to provide explicit governance after
  collaborative discovery;
- a future optional ideation skill can reuse the decision vocabulary without
  becoming canonical workflow state.

Negative:

- the change is necessarily larger than a new skill because public model,
  persistence, TTY, and control contracts must stay aligned;
- state v3, phase-result v3, and agent-control v2 add long-term compatibility and
  release-validation ownership;
- matched plugin/CLI capability is required for agent-supervised consultation;
- consultation text consumes context and can contain sensitive product reasoning;
- another planner turn may be required before the ADR and plan exist;
- semantic duplicate-question detection cannot be fully deterministic and needs
  prompt, fixture, and review assurance.

Risks and required follow-ups:

- consultation fatigue: require materiality, cap each round at three cards, track
  counts and timing without exporting content, and preserve a zero-round path;
- recommendation anchoring: show trade-offs before the advisory recommendation,
  label it explicitly, and keep other-option/free-preference actions equally
  available;
- accidental authorization: test every consultation action against ADR, plan,
  implementation, triage, recovery, hook, release, and external-write boundaries;
- stale or replayed answers: bind IDs to the active run and round and consume a
  pending request exactly once;
- control downgrade: use major capability negotiation and reject unrepresentable
  v1 projections instead of coercion;
- privacy growth: keep history out of public status and evaluation and test
  allow-lists with canary content;
- vendor divergence: use one schema and equivalent adapter fixtures, including
  resumed and fresh-session fallback;
- release drift: validate current and legacy schema identities, plugin/control
  references, source/dist parity, and independent version authority.

## Compliance and Confirmation

Implementation and independent review must confirm:

1. a fully determined strict fixture reaches its existing ADR or plan gate with
   zero consultation rounds and no extra model phase;
2. quick-fix and feature routes retain current selection and escalation behavior;
3. a material unresolved planning fixture emits phase-result v3 with one valid
   `banzai-decision-consultation/v1` request before any option-selecting Proposed
   ADR or dependent plan is written;
4. unknown fields, contradictory outcome/gate/payload combinations, zero or more
   than three cards, duplicate IDs, invalid recommendations, non-repository
   evidence, and oversized content fail before pending state is accepted;
5. TTY and agent-control render the same round, card, option, recommendation,
   evidence, and response-mode identities with the required human labels;
6. recommendation, listed-option, explanatory, and free-preference answers record
   exact current-user provenance without changing an approval or authorization;
7. pause, EOF, `SIGINT`, and `SIGTERM` leave the same pending request and create no
   answer, model attempt, source mutation, or approval;
8. valid keyed answers are consumed once, invalidate prior plan approval, preserve
   ordered history, and resume a compatible planner or use a fresh planner with
   equivalent durable context;
9. missing, duplicate, unknown, stale, replayed, malformed UTF-8/JSON, unsupported,
   and oversized answers fail before state mutation and model invocation;
10. an already answered decision ID cannot be requested again, and a justified
    second round receives new stable identities while preserving prior provenance;
11. completed consultation still reaches a separate explicit ADR
    `accept | reject | rework` or plan-approval gate before implementation;
12. state v1/v2 and phase-result v1/v2 remain readable as legacy evidence without
    fabricated consultation, while every new orchestrator phase result uses v3;
13. agent-control v2 capability negotiation, status, and answer documents are
    closed and bounded; v1 never relabels consultation as escalation and cannot
    answer it;
14. shell metacharacters, quotes, newlines, backticks, NUL, and environment-like
    tokens remain data through direct input, persistence, prompt composition, and
    terminal rendering;
15. status and evaluation canary tests expose bounded current action data but no
    historical questions, options, recommendations, answers, evidence detail,
    prompt, transcript, environment value, digest, or raw runner path;
16. Codex and Claude prompt/argument fixtures receive equivalent consultation
    semantics, and missing-session fallback uses durable records;
17. existing routing, approval immutability, escalation, hooks, verification,
    review, triage, fixing, retry, recovery, cancellation, and release authority
    remain unchanged;
18. focused contract, validation, store, workflow, interaction, control, privacy,
    adapter, prompt, legacy, interruption, and injection tests plus formatting,
    type checking, the repository final gate, release validation, committed-bundle
    parity, and `git diff --check` pass.

## Lifecycle Links

- Narrowly amended by
  [ADR-0055](./0055-planning-gate-rework-and-independent-planning-review.md),
  accepted 2026-10-13: adds the `planning_review_triage` pending kind beside
  consultation and reuses its inert-text and card conventions. Consultation
  semantics are unchanged. Implementation is Planned.

- Amended by [ADR-0045](./0045-guided-verification-setup.md), accepted
  2026-09-14: a separate runner configuration decision and control v4, with
  existing consultation/escalation meanings and human provenance preserved.
  Implementation of this amendment is Planned.

- Supersedes: None
- Superseded by: None
