# ADR 0059: Claude Default Reviewer and Reviewer Isolation

## Status / Date / Owner / Decision Makers

- Status: Accepted
- Date: 2026-10-31
- Owner: Banzai maintainers
- Decision makers: Repository owner; explicitly accepted in chat on 2026-10-31
  with `Accept all three` (ADR-0057, ADR-0058 and ADR-0059).
- Acceptance date: 2026-10-31
- Accepted proposal SHA-256: `9234bdfa445205693b2303161abf91080f19c2ec23a0d6ebba8108c353619bd4`.
- Lifecycle effect: the amendments in Lifecycle Links are accepted and their
  reciprocal links are recorded. Their proposal-stage wording and the
  decision body are retained unchanged. Dependent planning is authorized;
  plan approval is still required before implementation.
- Owner choices (section 5): accepted as written, with the recommended
  answers: reviewer effort `xhigh`; builders keep `Skill`; auto memory off for
  review roles in every mode and for builders in `scoped` mode.
- Implementation state: Planned.
- Preparation authority: the owner's 2.8–2.9 brief of 2026-10-30 (WP7) and the
  owner's request on 2026-10-31 to draft the Stage 1 ADRs. Preparing this
  proposal is not acceptance; no code may rely on it.

## Related Artifacts

- Program brief, WP7:
  [brief.md](../work/release-2-8-2-9-program/brief.md#wp7--claude-as-the-default-reviewer-with-reviewer-isolation);
  status in [tracker.md](../work/release-2-8-2-9-program/tracker.md).
- Repository authority: [AGENTS.md](../../AGENTS.md) and the
  [decision lifecycle](./README.md#lifecycle).
- Related accepted decisions:
  - [ADR-0042](./0042-runner-delivered-phase-instructions.md) §7: "Keep current
    phase tool inventories, including Skill where already granted". This
    proposal amends it for review roles.
  - [ADR-0037](./0037-unified-runner-rendered-review-artifacts.md), "Read
    authority and standalone behavior": preserves required `Read`, `Glob`,
    `Grep`, `Skill` for Claude review. This proposal amends that list.
  - [ADR-0002](./0002-session-affinity-and-bounded-reviewer-continuity.md):
    names "independent cross-model review" as a driver and consequence. This
    proposal amends that wording narrowly; its session and continuity rules are
    unchanged.
  - [ADR-0020](./0020-scoped-claude-subprocess-environment.md): a spawned
    Claude agent receives the Banzai plugin, the project's own instructions,
    the declared tool set and nothing else. Preserved and extended to auto
    memory.
  - [ADR-0055](./0055-planning-gate-rework-and-independent-planning-review.md):
    planning review uses the read-only adapter invocation used for review.
    Unchanged; it inherits this decision through that invocation.
- Enforcement owners: `DEFAULT_CONFIG` and `DEFAULT_TASK_CONFIG` in
  `packages/orchestrator/src/config.ts`; `selectModelSettings` in
  `packages/orchestrator/src/model-selection.ts` and the catalog in
  `packages/orchestrator/src/models.ts`; `buildClaudeArguments`,
  `buildClaudePhaseArguments` and the Claude call sites in
  `packages/orchestrator/src/adapters.ts`;
  `packages/orchestrator/src/claude-permissions.ts`;
  `packages/orchestrator/src/live-compatibility.ts`.

## Context and Decision Drivers

`DEFAULT_CONFIG` plans and implements with Claude `claude-opus-5-5` and reviews
with Codex `gpt-6.1-sol`. A developer who has only Claude Code must change the
shared configuration before the first run, and `documentation/orchestrator.md`
states that keeping the reviewer on a different vendor "is the point of the
loop". Banzai already gives the primary reviewer a fresh session without the
builder transcript (ADR-0002); that, not the vendor, is what keeps a review
independent.

A Claude reviewer exposes three paths by which builder context or another
model can reach a review that is presented as fresh:

- **Auto memory.** Claude Code loads the project's shared memory index (up to
  25 KB) into every session and lets the session write to it. A reviewer reads
  what a builder saved, and a builder can write project-scoped notes outside
  the repository.
- **The Skill tool.** Claude review and planning review receive
  `Read,Glob,Grep,Skill`. `Skill` lets the reviewer run built-in commands,
  including Claude Code's own review flow, whose instructions are not Banzai's
  review contract. ADR-0042 §7 and ADR-0037 kept `Skill` deliberately while
  Banzai instructions were loaded through it; ADR-0042 now delivers phase
  instructions in the prompt, so review no longer needs it.
- **Refusal fallback.** When the safety classifier flags a request, Claude Code
  can re-run it on another model and keep the session there. The review result
  then comes from a model the configuration did not name.

Decision question: Should Claude be the default reviewer, and what isolation
must every Claude review invocation guarantee?

Drivers:

- A Claude-only installation works without editing the configuration.
- Review independence rests on rules Banzai enforces: a fresh session, no
  builder transcript, no shared memory and a fixed review tool set.
- A review result comes from the configured model or fails visibly.
- Existing configurations keep their models and behaviour.
- Mixed-vendor configurations stay fully supported.
- Phase instruction delivery (ADR-0042) and read-only review enforcement
  (ADR-0037) are unchanged.

## Options Considered

1. **Keep Codex as the default reviewer.** No change in behaviour or cost
   model. A Claude-only developer still edits configuration before the first
   run, and the documentation keeps claiming that a second vendor is required.
   Rejected.
2. **Claude default reviewer with enforced isolation.** Change the default and
   make the isolation rules part of every Claude review invocation, whatever
   the configured default. Costs: review loses `Skill`; review behaviour
   depends on two Claude Code environment variables, which the live
   compatibility scenario must confirm. Selected.
3. **Claude default reviewer without isolation changes.** Smallest change.
   Shared memory, `Skill` and fallback remain reachable from a review that is
   presented as independent. Rejected.
4. **Pick the reviewer vendor from installed CLIs at `init`.** Proposes Codex
   when it is installed and Claude otherwise. Defaults would differ between
   machines for the same repository, and a shared configuration would encode
   one developer's tools. Rejected; `init` and `banzai model` keep offering
   every catalog model.

## Decision

Adopt option 2.

### 1. Default reviewer

`DEFAULT_CONFIG.models.reviewer` and `DEFAULT_TASK_CONFIG` become Claude
`claude-opus-5-5` with effort `xhigh` (the planner's effort) and a 30-minute
timeout. Every newly written configuration uses it unless the human picks
another model. `banzai init` and `banzai model` keep offering Codex models for
every role. A configuration that names a reviewer keeps it; no migration
rewrites a model. The prerequisites name the Codex CLI only for configurations
in which a role uses it.

### 2. Isolation of review roles

Every Claude invocation for review, routine re-review and planning review:

- starts or resumes only the reviewer's own session under ADR-0002, never a
  builder session;
- runs with `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`, so no memory is loaded or
  written;
- runs with `CLAUDE_CODE_DISABLE_REFUSAL_FALLBACK=1`, so a flagged request
  fails instead of continuing on another model;
- receives `--tools Read,Glob,Grep` and keeps `Skill` in its disallowed tools,
  as route selection already does; non-mutating Serena access and the
  read-only boundary of ADR-0037 are unchanged.

Banzai sets both variables at the Claude call sites, after the subscription
environment is built, so an inherited value cannot override them. They hold in
both `claudeEnvironment` modes: like the review tool set, they belong to the
review role's authority, and ADR-0020's ambient opt-out concerns plugin, MCP
and settings discovery only. `subscriptionOnlyEnvironment` stays a pure
credential filter.

A review that fails because a request was flagged is a model failure under the
existing typed handling (ADR-0037): it is recorded, shown with its message and
retryable; no review result is fabricated. The implementation plan records the
minimum Claude Code version that honours each variable, and `banzai doctor`
enforces it for configurations with a Claude reviewer, so an older client
cannot ignore the variables silently.

Codex review invocations are unchanged.

### 3. Builder phases

- Planning, implementation and fixes run with `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`
  in `scoped` mode, consistent with ADR-0020's contract that a spawned agent
  receives nothing beyond the declared resources. In `ambient` mode they keep
  the pre-existing invocation.
- Builders keep `Skill`, with its existing prohibition during route selection.
- Builders keep the vendor's refusal fallback; changing that is a separate
  decision.

### 4. Principle and documentation

Replace the documented principle "Keeping the reviewer on a different vendor
than the implementer is the point of the loop" with: reviewer independence
comes from a fresh session with no builder transcript, no shared memory and a
fixed read-only tool set; a reviewer from another vendor is an option, not a
requirement. The model-configuration guide, getting-started prerequisites,
README, the manifest's default models and minimum client versions, and the
Roles section of the packaged `plugins/banzai/AGENTS.md` template follow.

### 5. Owner choices

The owner decides these at acceptance; the text above shows the recommended
answer:

1. reviewer effort: `xhigh`, matching the planner (alternative: `high` for
   shorter reviews);
2. builders keep `Skill` (alternative: remove it from builders too);
3. auto memory off for review roles in every mode and for builders in `scoped`
   mode (alternative: review roles only).

## Consequences

Positive:

- `banzai init` with only Claude Code installed proposes Claude for every role.
- A Claude review cannot read builder memory, run another review flow through
  `Skill`, or continue on an unnamed model.
- Independence no longer depends on a second vendor subscription.
- Builders no longer write project memory outside the repository in `scoped`
  mode.

Negative and risks:

- Default planning, implementation and review now share one vendor and model
  family, so correlated blind spots are more likely; the fresh session and the
  human triage of every finding remain the safeguards, and mixed vendors stay
  one `banzai model` choice away.
- Review depends on Claude Code honouring two environment variables; a vendor
  rename would silently restore the leaks unless the version floor and the
  live scenario catch it.
- A flagged request now fails a review that previously completed on a fallback
  model.
- Projects that relied on `Skill` in review lose it.
- Reviews consume the same subscription as builders.

Follow-ups:

- After acceptance, record reciprocal lifecycle links on ADR-0042, ADR-0037 and
  ADR-0002 (none of them is pinned).
- Add a live-compatibility scenario for a Claude reviewer that confirms its
  tool list without `Skill` and both variables; it runs only with the owner's
  explicit go-ahead.
- WP7's requirements, plan and report live in
  `documentation/work/wp07-claude-default-reviewer/`.

## Compliance and Confirmation

1. A new configuration written by `banzai init` names Claude `claude-opus-5-5`
   for every role, and `banzai doctor` passes with only Claude Code installed.
2. Argument and environment tests assert, per phase, the tool list, the
   disallowed tools and the two variables, including that an inherited value
   is overridden and that both `claudeEnvironment` modes keep the review
   variables.
3. Review, routine re-review and planning review receive `Read,Glob,Grep`
   without `Skill`; builders keep their current tool lists.
4. A flagged review request fails visibly under typed handling and stays
   retryable.
5. Configurations that name a Codex reviewer run unchanged, and Codex review
   arguments are unchanged.
6. Documentation, the manifest and the packaged template no longer state that
   a second vendor is required.
7. The owner-authorized live scenario confirms the Claude reviewer's tool list
   and isolation.
8. The owner accepts this ADR before any implementation relies on it.

## Lifecycle Links

- Amends, on acceptance,
  [ADR-0042](./0042-runner-delivered-phase-instructions.md) §7: `Skill` leaves
  the review and planning review tool inventories and the live compatibility
  expectations; builder inventories, selection's prohibition and the evidence
  rules remain authoritative.
- Amends, on acceptance,
  [ADR-0037](./0037-unified-runner-rendered-review-artifacts.md), "Read
  authority and standalone behavior": required review tools become `Read`,
  `Glob` and `Grep`; its read-only enforcement, Serena boundary and independent
  sessions remain authoritative.
- Amends, on acceptance,
  [ADR-0002](./0002-session-affinity-and-bounded-reviewer-continuity.md):
  "cross-model" independence reads as role and session independence; its
  session affinity, bounded continuity and human triage remain authoritative.
- Preserves ADR-0020 and ADR-0055.
- Supersedes: None.
- Superseded by: None.
- Required lifecycle decision: accept, reject with a reason, or request rework.
