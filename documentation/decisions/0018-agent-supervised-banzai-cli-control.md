# ADR 0018: Agent-Supervised Banzai CLI Control

Publication note (2026-09-09): private operational identifiers were removed at
the project owner's request. The accepted decision and lifecycle are unchanged.

## Status / Date / Owner / Decision Makers

- Status: Accepted
- Date: 2026-08-17
- Owner: Banzai maintainers
- Decision makers: User, explicitly accepted in chat on 2026-08-17

## Related Artifacts

- Feature description:
  `documentation/features/agent-supervised-banzai-cli/description.md`
- Feature plan: Not created at decision time; planning could not rely on this
  decision before its acceptance.
- Repository authority: root `AGENTS.md`, `CLAUDE.md`, and
  `PROJECT_MANIFEST.md`
- Manifest: sections 1, 3, 5, 6, 9, and 10 of `PROJECT_MANIFEST.md`
- Related ADRs:
  - ADR-0001 keeps workflow selection and routed execution inside the runner.
  - ADR-0002 preserves builder/reviewer session boundaries and independent
    review.
  - ADR-0008 provides the precedent for an offline, read-only, versioned CLI
    diagnostic boundary.
  - ADR-0012 keeps plugin and orchestrator releases independently versioned and
    requires explicit release authorization.
  - ADR-0013 governs proportionate assurance at command and state boundaries.
  - ADR-0014 preserves explicit human triage and distinguishes triaged
    completion from reviewer pass.
  - ADR-0015 preserves durable retry and verification-attempt evidence.
  - ADR-0017 makes structured plan-task completion evidence authoritative and
    keeps approved plans immutable.

## Context and Decision Drivers

The Banzai plugin and local orchestrator are independently usable products. The
plugin supplies declarative workflow skills; the CLI owns automatic route
selection, child model processes, one-active-run locking, persisted state,
approval digests, deterministic verification, review, recovery, and terminal
completion. The CLI already invokes installed plugin skills inside planner,
implementer, and reviewer phases.

Engineers can currently ask a host AI agent to discover and operate the CLI on
their behalf. Real the sandbox project runs proved the value of that pattern:
the supervising agent started or retried Banzai, relayed plan and triage gates,
handled sandbox-specific authentication visibility, waited through model and
verification phases, and summarized the final run evidence. They also exposed
the fragility of relying on ad hoc agent behavior and human-oriented terminal
prose.

Current machine-readable surfaces are incomplete as a compatibility boundary.
`banzai doctor --json` is versioned but intentionally does not prove model
authentication. `banzai status --json` serializes internal workflow status
without a dedicated public schema identity. The CLI has no supported
orchestrator-version or capability command. `banzai run --request <text>` and
interactive escalation answers require a host agent to transport arbitrary user
text through shell or TTY semantics. Plugin and orchestrator versions may move
independently under ADR-0012.

Adding only a Markdown skill would therefore place correctness on prompting:
the agent would have to infer compatibility, parse an evolving internal status
shape, quote arbitrary shell text, preserve retry rules, and avoid answering
human gates itself. Adding a second workflow engine to the skill would instead
compete with the existing runner and create recursive invocation when Banzai's
own phase agents can see the installed skill.

The target is an optional, explicit-only `orchestrate` skill that acts as a thin
supervisor over one compatible CLI run. The runner remains the sole workflow and
state authority. The user remains the sole source of ADR, plan, escalation, and
triage decisions. The integration needs a small versioned machine seam that is
safe for headless agent terminals without turning Banzai into a service or
duplicating its commands and state machine.

Decision question: What stable boundary should the optional `orchestrate` skill
use to supervise the independently versioned Banzai CLI without duplicating its
state machine, weakening human gates, depending on fragile terminal prose, or
allowing nested orchestration?

Decision owner: Banzai maintainers, with explicit user lifecycle approval.

Decision drivers:

- preserve the runner as the only owner of workflow state and authorization;
- preserve exact human provenance for all four decision gates;
- prevent an installed phase agent from recursively starting Banzai;
- keep existing standalone plugin skills independent from CLI availability;
- negotiate compatibility across independent product versions;
- use bounded versioned machine output rather than human terminal prose;
- transport arbitrary request and human-answer text without shell evaluation;
- work in headless Codex and Claude Code hosts without assuming an interactive
  TTY is always available;
- keep sandbox credential visibility distinct from authentication proof;
- retain existing retry, completion, privacy, and no-external-write boundaries;
- add the smallest testable runtime surface without a dependency or daemon.

## Options Considered

### Option 1: Markdown-only supervisor over the current human CLI

Add `plugins/banzai/skills/orchestrate/SKILL.md` and instruct the host agent to
run existing help, doctor, run, status, approval, triage, resume, retry, and
interactive commands. Detect support from help text and parse the existing
`status --json` object directly. Use host-specific shell quoting or a TTY for
task requests and escalation answers.

Benefits:

- the smallest source change;
- no orchestrator command or JSON surface changes;
- immediate reuse of the existing scriptable commands.

Costs and rejection reason:

- help prose and an internal TypeScript object become accidental compatibility
  contracts across independently versioned products;
- arbitrary request and answer text can be corrupted or interpreted by the
  shell when an agent constructs a command string;
- not every host tool provides a persistent interactive TTY;
- missing compatibility and status fields can be misread as safe defaults;
- correctness remains dependent on prompt compliance rather than a bounded
  protocol. Rejected because the new skill would automate a safety-sensitive
  lifecycle without a stable control boundary.

### Option 2: Thin skill over a minimal versioned CLI control seam

Keep the skill declarative and keep all workflow transitions in the existing
CLI and `WorkflowRunner`. Add an additive, offline, machine-readable capability
declaration for the agent-control protocol; expose a versioned bounded status
projection derived from `WorkflowStatus`; and add non-TTY, stdin-safe transport
for starting a request and submitting arbitrary escalation answers. Reuse the
existing explicit approval, triage, resume, retry, and cancellation semantics
instead of creating another state machine.

The capability declaration identifies its own schema, the supported
agent-control protocol, orchestrator and umbrella contract versions, supported
operations, and which operations require or avoid a TTY. It performs no vendor
call, state recovery, repository mutation, lock acquisition, or authentication
claim.

The status projection identifies its own schema and exposes only the bounded
control evidence the supervisor needs: run identity and lifecycle, route,
`nextAction`, retry eligibility and reason, pending human gate and exact bounded
questions or finding IDs, approval validity, task-completion classification and
diagnostics, verification summary, latest review verdict, and completion basis.
It excludes prompts, transcripts, raw output, commands, secrets, environment
values, approval digests, and raw `.banzai` paths.

Request and answer input uses stdin or an equivalent direct data channel with a
closed versioned shape where structure is needed. The runner validates and
persists the same existing request and human-decision records; the control seam
does not authorize, infer, or synthesize a decision.

Benefits:

- explicit compatibility negotiation replaces semantic-version guessing;
- the skill depends on a narrow public projection rather than internal run
  state or terminal text;
- arbitrary user text is never embedded in a shell command;
- headless and TTY-capable hosts follow the same state and decision semantics;
- existing runner enforcement, persistence, and retry behavior remain the sole
  authority;
- unit and committed-bundle tests can exercise the seam without vendor calls.

Costs and risks:

- both plugin and orchestrator product surfaces change in one repository
  feature;
- a new public machine contract needs explicit versioning, validation,
  documentation, and compatibility tests;
- existing status and interactive paths must remain behaviorally aligned with
  the new projection;
- stdin lifecycle and malformed-input handling require bounded failure and
  non-mutation tests;
- any released plugin/orchestrator candidates will later need independently
  authorized version decisions under ADR-0012.

### Option 3: Expose Banzai as an MCP server or native host tool

Add a process or service interface that exposes start, status, decisions,
recovery, and cancellation as typed tools. Let Codex and Claude connect to it
instead of operating a terminal CLI.

Benefits:

- native typed tool calls avoid shell quoting and terminal management;
- tool schemas can express each operation directly;
- long-running work could use a dedicated notification channel.

Costs and rejection reason:

- introduces connection lifecycle, installation, permissions, and possibly a
  daemon or another protocol runtime;
- materially broadens the product beyond the requested plugin skill;
- risks making the plugin depend on host-specific MCP configuration;
- duplicates an already working local CLI composition root. Rejected for the
  initial capability; a later ADR may reconsider it after measured demand.

### Option 4: Implement orchestration logic inside the skill

Teach the host agent to select `quick-fix`, `feature`, or `strict`, invoke phase
skills directly, track state in chat or a skill-owned file, run verification,
and call the CLI only when convenient.

Benefits:

- can appear to work without extending the CLI;
- the supervising agent has maximum flexibility.

Costs and rejection reason:

- creates two workflow selectors, two recovery models, and competing evidence
  authorities;
- bypasses runner-owned approval digests, one-active-run locking, durable
  attempts, and completion validation;
- lets an inner Banzai phase recursively invoke the outer workflow;
- makes human gates vulnerable to agent self-approval;
- cannot provide deterministic recovery after chat interruption. Rejected
  because it violates the core Banzai safety boundary.

## Decision

Adopt Option 2.

Add one optional user-invocable plugin skill named `orchestrate`. Its metadata
must be explicit-only: use it when the user asks the current host agent to start,
operate, inspect, or continue work through the local Banzai CLI. Do not trigger
it for an ordinary implementation, fix, review, status, or planning request.

Make nested orchestration fail closed. When `BANZAI_RUN_ID` or equivalent
runner-owned phase context is present, the skill must invoke no Banzai CLI,
write no file, and defer to the exact phase skill selected by the runner. The
runner's existing prompt skill chains remain unchanged and must never include
`orchestrate`.

Keep the CLI integration optional. Missing or incompatible agent-control
capability stops only the `orchestrate` skill with a bounded diagnostic. It does
not disable, install, start, or silently substitute any standalone plugin skill.

Add a minimal additive agent-control seam to the CLI. It must:

1. expose a versioned, offline, read-only capability declaration before an
   agent issues a state-changing command;
2. expose a versioned bounded status projection derived from the existing
   `WorkflowStatus` and review/task-completion helpers rather than raw persisted
   files or a second state model;
3. accept a complete new-run request through stdin or an equivalently direct
   non-shell data channel;
4. accept arbitrary ordered escalation answers through a closed versioned,
   non-TTY data channel while keeping ADR approval, plan approval, and finding
   triage explicit and human-sourced;
5. delegate every mutation, validation, transition, retry, and persisted record
   to the existing `WorkflowRunner` and `RunStore` boundaries;
6. keep human progress on stderr and structured machine output on stdout;
7. fail closed on malformed, unsupported, contradictory, stale, or incomplete
   control input without partial state mutation.

The implementation plan may choose exact additive command and flag names, but
the machine schemas and their compatibility semantics are public contracts. It
must not change the meaning of existing human CLI commands or make terminal
prose authoritative.

The supervising skill must use the machine seam as its source of lifecycle and
eligibility. It must not inspect or edit `.banzai` files. It serializes
state-changing commands, waits for command return, refreshes status, and follows
only an eligible action. It may recommend a human decision but may execute one
only after the current user explicitly supplies it.

Preserve environment truthfulness. Capability and doctor output prove neither
subscription authentication nor sandbox credential visibility. The skill must
retain `CLAUDE_AUTH_UNAVAILABLE_IN_SANDBOX`, executable failure, authentication
failure, process failure, skipped/unavailable evidence, and runner failure as
distinct outcomes. It may request host-approved execution outside a restricted
sandbox but must not weaken authentication, retry implicitly, or recommend
re-login from sandbox isolation alone.

Preserve completion truthfulness. The skill reports lifecycle, route,
task-completion source and diagnostics, verification, latest review verdict,
and reviewer-pass versus human-triage completion separately. It never derives
success from `done` alone, invents completion for legacy evidence, repeats a
valid final suite merely for reassurance, or performs a Git/release action
without a separate explicit request.

Keep the initial skill concise. Put detailed state/action mappings in at most one
directly linked reference when that materially reduces `SKILL.md`; add no script,
asset, dependency, skill-owned state, or duplicate CLI manual without new
evidence and approval.

This decision authorizes no product version bump or release. A future release
must apply ADR-0012 independently to the changed plugin payload and
orchestrator. Source changes to the orchestrator still require committed bundle
parity in this feature.

## Consequences

Positive:

- users gain a repeatable chat-native operator for the existing Banzai workflow;
- the runner and human retain their current authorities;
- recursion, incompatible CLI behavior, unsafe text transport, and implicit
  approvals fail closed;
- Codex and Claude Code can use one bounded control contract despite different
  terminal capabilities;
- existing standalone skills remain independent from the orchestrator;
- protocol and skill behavior can be validated without live model calls.

Negative:

- the feature is larger than a single Markdown file because it deliberately
  hardens the CLI boundary first;
- plugin and orchestrator source must evolve together while their releases and
  versions remain independent;
- another versioned machine contract needs long-term compatibility ownership;
- a host agent still consumes model time and adds one supervisory layer around
  Banzai's own agents;
- live credential-store visibility remains host- and sandbox-dependent.

Risks and required follow-ups:

- recursive trigger: enforce both narrow metadata and the runner-context guard,
  and forward-test an inner phase with the installed skill visible;
- accidental self-approval: test each gate with no decision, an agent
  recommendation only, and an exact user decision;
- protocol drift: validate schema identities and required release paths, and
  keep capability/status tests independent from internal `RunState` additions;
- shell injection or truncation: test multiline and metacharacter request and
  escalation text through the direct data channel;
- parallel mutation: document and test serialized command ownership and the
  existing one-active-run behavior;
- misleading completion: reuse existing review-completion and task-completion
  projections rather than recreating their logic in the skill or CLI shell;
- sandbox misdiagnosis: preserve the current Claude classification and require
  explicit host permission before outside-sandbox execution;
- release confusion: record exact source/dist evidence but make no version,
  install, publication, commit, or push change without later authorization.

## Compliance and Confirmation

Implementation and review must confirm:

1. explicit Banzai CLI requests trigger `orchestrate`, while ordinary feature,
   fix, plan, status, and review requests do not;
2. runner-owned phase context invokes no nested Banzai process and performs no
   write;
3. absent, malformed, unsupported, and incompatible capability declarations
   stop before any state-changing command;
4. the capability and status outputs have explicit schema identities,
   deterministic JSON, clean stdout, bounded fields, and no secret, transcript,
   raw command, raw output, digest, or environment disclosure;
5. status is a projection of existing runner evidence and stays aligned with
   `nextAction`, retry eligibility, pending gates, task completion, verification,
   review verdict, and completion basis;
6. multiline and shell-metacharacter requests reach the persisted run request
   exactly without shell execution;
7. arbitrary ordered escalation answers reach the existing human-decision
   record exactly without an interactive TTY or agent-authored content;
8. ADR, plan, escalation, and triage commands cannot proceed from the initial
   task request, silence, or an agent recommendation;
9. an existing active run prevents a second start, and every state-changing
   action is serialized and followed by a status refresh;
10. retry occurs only when eligible and after external resolution; interrupted
    mutable work remains non-retryable and state is never manually edited;
11. `CLAUDE_AUTH_UNAVAILABLE_IN_SANDBOX` remains an unproven-visibility
    classification and does not trigger re-login or hidden execution;
12. final reporting distinguishes lifecycle, task evidence, verification,
    reviewer pass, human-triaged completion, legacy, unknown, inconsistent,
    unavailable, skipped, and failed evidence;
13. existing standalone skills and existing human CLI commands remain usable
    without the new skill or control seam;
14. no new dependency, product version bump, release, installation, live-vendor
    run, commit, or push occurs;
15. focused skill, CLI parsing, protocol, state, gate, recovery, privacy, and
    injection tests plus the repository final gate, formatter check, release
    validation, committed-bundle parity, and `git diff --check` pass.

## Lifecycle Links

- Supersedes: None
- Superseded by: None
