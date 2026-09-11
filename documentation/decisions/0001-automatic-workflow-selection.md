# ADR 0001: Automatic Workflow Selection

## Status / Date / Owner / Decision Makers

- Status: Accepted
- Date: 2026-07-29
- Owner: Banzai maintainers
- Decision makers: User, explicitly accepted in chat on 2026-07-29

## Related Artifacts

- Feature description:
  `documentation/features/automatic-workflow-selection/description.md`
- Escalation plan:
  `documentation/features/automatic-workflow-selection/work.md`
- Existing workflow policy: `plugins/banzai/CLAUDE.md`
- Existing orchestrator pivot:
  `documentation/changes/orchestrator-first-workflow-pivot.md`
- Repository authority: `AGENTS.md`
- Feature plan: Not created; planning cannot rely on this Proposed ADR.
- Related ADRs: None.

## Context and Decision Drivers

The current orchestrator has one entry path. Every new run transitions from
`created` to strict `planning`, obtains a plan approval, runs strict
implementation and deterministic verification, and then runs independent
review. The `quick-fix` skill appears only after review triage, and the
standalone `feature` route is never selected by the orchestrator.

This conflicts with the product routing policy, which already distinguishes
small changes to existing behavior (`quick-fix`), small new capabilities
(`feature`), and formal or escalated work (`strict`). It also makes small tasks
pay the latency and interaction cost of requirements, planning, approval, and
review.

The target is automatic selection of the smallest safe workflow from the
original request, using the configured planning model. Selection must remain
structured, visible, durable, retryable, and compatible with both Codex CLI and
Claude CLI.

The safety boundary makes this more than a prompt choice. The current
orchestrated write hook requires a human-approved plan digest for every model
write. Lite routes intentionally have no plan approval, so they need a distinct
authorization that is bound to a validated, persisted route without weakening
strict-mode approval or allowing writes to runner control state.

Decision drivers:

- avoid strict-workflow latency and unnecessary decisions for small tasks;
- use semantic request understanding rather than brittle keywords;
- fail conservatively when the route is ambiguous or sensitive;
- preserve all existing ADR, plan, escalation, and review-triage gates;
- make selection and authorization auditable across interruption and retry;
- support equivalent structured behavior in Codex CLI and Claude CLI;
- keep the existing planner, implementer, and reviewer configuration model.

## Options Considered

### Option 1: Structured planner selection with runner enforcement

Run a distinct read-only selection phase with the configured planning model.
Require a versioned structured result containing one route, its concise reason,
and the routing evidence. Persist the validated selection before authorizing the
selected phase. Route `strict` into the existing workflow; route `feature` or
`quick-fix` into the matching lite skill and deterministic verification.

Bind lite writes to a digest of the active run and persisted selection. Keep the
approved-plan digest as the only strict-mode write authorization. If a lite
skill raises the existing escalation gate, collect the human answer and perform
a new selection with that evidence rather than silently continuing.

Benefits:

- semantic classification follows the existing Banzai routing policy;
- structured output has the same validation boundary for Codex and Claude;
- persisted selection gives deterministic resume, retry, status, and audit;
- strict and lite authorization remain distinguishable and independently
  enforceable;
- conservative fallback and reclassification after escalation preserve safety.

Costs and risks:

- every run adds one planner-model call;
- run state, state transitions, contracts, prompts, hook behavior, and tests all
  become route-aware;
- a model can still misclassify a request, so lite skills must retain their
  pre-write escalation checks and uncertain selection must choose `strict`;
- lite routes intentionally omit independent cross-model review, trading some
  assurance for speed on tasks classified as small and safe.

### Option 2: Let the existing planning session choose and immediately invoke a route

Tell the current planning prompt to choose a skill and continue in the same
session without a separate structured selection record.

Benefits:

- fewer model invocations;
- smaller apparent change to adapter code.

Costs and rejection reason:

- selection is not durably separated from repository mutations;
- retry and resume cannot reliably distinguish selection from execution;
- the write hook has no validated route record to authorize;
- unstructured control flow is harder to keep equivalent across Codex and
  Claude;
- it can silently bypass strict gates. Rejected because auditability and
  enforcement are more important than saving one routing call.

### Option 3: Deterministic keyword and rule matching in the CLI

Select the route locally from request phrases and a fixed trigger list.

Benefits:

- fast, cheap, deterministic, and easy to test;
- no additional model failure mode.

Costs and rejection reason:

- natural-language tasks often imply rather than name affected contracts,
  security concerns, or architectural scope;
- rule growth would recreate a fragile intent classifier in application code;
- it does not satisfy the request to use the planning model's understanding.
  Rejected as the primary selector; deterministic validation remains useful for
  schema and authorization enforcement.

### Option 4: Keep strict as the default and add only manual route flags

Require the engineer to choose `strict`, `feature`, or `quick-fix` for each run.

Benefits:

- explicit and predictable;
- no classification model call.

Costs and rejection reason:

- preserves the inconvenience the feature is intended to remove;
- requires users to understand workflow internals before starting a task;
- does not provide automatic prompt-based selection. Rejected for the default
  behavior.

## Decision

Adopt Option 1.

Add a distinct, read-only, schema-validated workflow-selection phase powered by
the configured planning model. It must select exactly `quick-fix`, `feature`, or
`strict`, persist the selection and reason before routed execution, display the
route and invoked skills, and fall back to `strict` whenever safe lite
classification is uncertain.

Keep the existing strict workflow and approved-plan authorization unchanged.
Authorize lite implementation only when the active run contains a valid,
matching persisted selection for `feature` or `quick-fix`; never treat that
authorization as plan approval. Lite routes end after runner-owned deterministic
verification. If a lite route raises an escalation gate, collect the human
decision and re-run selection with the new evidence before allowing further
source changes.

Use the same selection contract, validation rules, persistence semantics, and
progress fields for Codex CLI and Claude CLI.

## Consequences

Positive:

- small tasks can complete without strict requirements, plan approval, and
  independent review;
- strict work retains the current approval and review guarantees;
- users can see why a route was chosen and which skills are active;
- interrupted runs do not silently change routes;
- Codex and Claude remain behaviorally aligned.

Negative:

- all automatic runs pay for a short planner selection call;
- persisted state and the safety hook gain another authorization mode;
- route-aware status, retry, and escalation paths increase state-machine
  complexity;
- false-lite classification remains a residual risk, mitigated by strict
  fallback, lite-skill stop gates, and route-bound write enforcement;
- lite runs receive no independent reviewer, so route quality directly affects
  assurance and latency.

Required follow-ups:

- keep `plugins/banzai/CLAUDE.md`, `feature`, and `quick-fix` routing and
  escalation language aligned with the selector contract;
- document route behavior and recovery in both orchestrator READMEs;
- include the selection schema in contract parity checks;
- retain verbose-by-default progress for route selection and skill execution.

## Compliance and Confirmation

Implementation and review must confirm:

1. representative bug, polish, refactor, new-capability, strict, sensitive, and
   ambiguous prompts select the required route;
2. invalid or interrupted selection cannot authorize repository writes;
3. successful selection is persisted and reused by resume and later-phase
   retry;
4. an answered lite escalation causes reselection before further source writes;
5. strict implementation still requires a valid immutable plan-approval digest;
6. lite implementation requires a valid matching route authorization and
   cannot write `.banzai/` control files;
7. lite verification passes directly to `done`, while strict verification
   continues to independent review;
8. Codex and Claude adapter tests enforce the same schema and progress
   semantics;
9. committed distribution output is rebuilt and the repository verification
   suite plus `git diff --check` passes.

## Lifecycle Links

- Supersedes: None
- Superseded by: None
