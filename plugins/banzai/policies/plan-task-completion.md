# Plan Authority and Task Completion Evidence

- Owner decision: ADR-0038 (Plan Authority); ADR-0017/0025/0047 (Plan Task Completion Evidence)
- Consumers: `development-plan`, `code-writing`; conditional: `test-writing`, `feature-review`, `feature-status`, `quick-fix`
- Process source: the project `AGENTS.md` (authority order, escalation triggers, decision gates)
- Runner consumers: planning, implementation, review (conditional), fix (conditional), quick-fix (conditional).
- Delivery: standalone skills load this policy relatively; runner phases receive its body inline. Conditional duties retain their conditions.

## Plan Authority

Applicable approved requirements, accepted ADR constraints, public and persisted
contracts, security and authorization boundaries, transaction and lifecycle
guarantees, compatibility, scope, and required verification evidence are binding.
Exact internal details remain binding when required by applicable authority or
concrete constraints; unlabelled explicit directives remain binding.

Only paragraphs or list items prefixed `Optional implementation guidance:` are
non-binding suggestions. A label covers that paragraph or list item, including
its nested content, and ends before the next sibling block. A different compliant
implementation within approved scope needs no reapproval, finding or deviation
report merely for differing from this guidance.

Guidance never overrides binding authority or expands scope. Resolve conflicts
and ambiguous commitments before dependent work; missing or ambiguous optionality
does not waive an explicit commitment.

### Applying the convention

New plans copy the `Plan Authority` heading and its three paragraphs above,
before Technical Breakdown and Implementation Tasks. This document convention
travels with the approved bytes; neither plugin version nor conversation supplies
it. Optional guidance is useful only when it helps implement the task. Put required
behavior and safety constraints in binding text, never solely in guidance.

Apply the new convention only where the approved plan explicitly establishes it.
Legacy plans keep their approved meaning, including their own explicit optionality;
do not retrofit this section or infer new discretion from a label alone. An exact
internal directive remains binding even when another approach seems equivalent.
Links to authoritative definitions preserve their applicable approved meaning;
they do not authorize later contract changes. Never rewrite historical plans,
snapshots, findings or triage to fit this convention.

Use the project's existing authority order and conflict/escalation handling.
Changing an approved commitment requires the applicable ADR and plan reapproval
path; a deviation report records a deviation and cannot authorize it. Approval
binds the whole bundle, including guidance: editing optional text still invalidates
an orchestrated approval, unlike choosing a compliant implementation under it.

- Planner/approver: make behavior, invariants, scope/boundaries, dependencies,
  requirement/acceptance/ADR links, necessary constraints and proportionate
  evidence explicit. Review obligations and marked discretion at the existing gate.
- Implementer/assurance: satisfy binding requirements within approved scope.
  Record material decisions and real deviations proportionately in existing
  reports; a merely different permitted helper, constant or decomposition needs
  no entry and grants no extra scope.
- Reviewer: report concrete binding-authority violations and independently
  supported correctness, security, compatibility, evidence or maintainability
  defects, including defects in code that follows all guidance. A difference from
  optional guidance alone is not a finding. Keep existing severity, EQ shadow,
  independent review, closure and unchanged-evidence rediscovery rules.
- Fixer: fix only accepted findings under existing authority. A suggested remedy
  stays optional unless an applicable explicit human decision makes it mandatory;
  do not waive an accepted directive or turn a recommendation into additional work.
- Completion/status: structural validity does not prove substantive fulfillment.
  Failed required checks, missing material evidence and false success claims
  remain actionable. Correcting a report cannot discharge a mandatory requirement;
  pending or unavailable evidence does not become a pass.

## Plan Task Completion Evidence

- In strict orchestrated work, the approved description, plan, and accepted ADR
  bodies are immutable. Unchecked plan boxes define the approved work set; they
  are not mutable execution status and must not be marked `[x]` after approval.
- Persisted orchestrator state owns lifecycle status and `nextAction`. A
  terminal `done` run with `nextAction: null` is never routed back to
  `code-writing` solely because its immutable plan boxes remain unchecked.
- New strict implementation results use the versioned structured
  `taskCompletion` ledger as the sole source of truth. It has exactly one
  ordered record for every approved `TNNN`, with status `completed`,
  `incomplete`, or `blocked`, bounded repository-relative evidence, and a
  report gap/deviation reference when the status is not completed. An
  accepted-finding fix whose changes made that evidence stale may return a
  complete refreshed ledger (ADR 0025) — same task set and order, statuses
  unchanged, evidence describing the current tree — validated by the same
  fail-closed pipeline; there is still exactly one canonical ledger at a time.
- In new strict orchestrated attempts (`banzai-completion-protocol/v1`,
  ADR-0047) the model returns structured claims and report narrative only. The
  runner validates the ledger against approval digest, task coverage/order,
  path scope and required reports, then renders and publishes the
  implementation report's **Plan Task Completion** section itself as the
  bounded `banzai-plan-task-completion/v2` region, records an immutable
  publication receipt and only then applies the completion. Nothing inside that region
  confers authority: a model or hand edit is replaced at the next authorized
  publication and is never evidence. Persisted state contains a validated
  summary, never a separately authored ledger.
- Standalone authored reports keep the `banzai-plan-task-completion/v1` table
  written by the author, and legacy orchestrated runs keep their v1 projection.
  Readers recognize both grammars and distinguish model claims, runner receipts
  and real repository or report evidence; no standalone author generates v2 or
  manufactures runner state.
- `outcome=completed` is invalid when any task is missing, malformed,
  incomplete, or blocked. Validation fails closed as
  `PLAN_TASK_COMPLETION_INVALID`; verification and review do not start, and a
  normally returned invalid implementation result may be retried after the
  evidence is corrected without editing the approved plan. A blocked or
  escalation result keeps its gate; its completion diagnostics are retained and
  nothing is published.
- A legacy orchestrated run without the structured ledger keeps its persisted
  lifecycle and next action, but task completion is `legacy`, `unknown`, or
  `inconsistent`; report prose is never retrofitted into canonical `N/N`.
- Active orchestrated runs remain active even when partial report evidence is
  present. For standalone work without external completion evidence, checked
  and unchecked plan boxes retain their normal completed/incomplete meaning.
- Status and review name the evidence source: `structured completion evidence`,
  `plan checkbox`, `legacy`, `unknown`, or `inconsistent`. Contradictory state,
  approval, reports, source, tests, or review evidence requires an
  artifact/evidence audit and is never silently repaired by editing an approved
  plan.


### Opt-in verification obligations

A new strict plan relying on ADR-0043 contains exactly one fenced
`banzai-verification-obligations/v1` JSON inventory inside its approved bytes.
It carries schema/schemaVersion, complete=true, planRemainderSha256 and an ordered
checks array of configured check IDs and fresh/equivalent_evidence modes. The
remainder digest covers every byte outside that complete fence. The owner reviews
completeness and consistency with all prose commitments before bundle approval.
Missing, duplicated, stale, ambiguous or contradictory inventories deny reuse;
legacy plans retain their original obligations. Release checks are always fresh.
Changing the inventory requires normal plan approval; no prose claim upgrades it.

Equivalent verification does not replace task-completion validation. Preserve the
canonical task records and exact report projection, immutable approved artifacts,
and existing report-digest versus complete fix-ledger refresh boundaries. Inspect
current claims for contradictions, update only affected claims and attach one
bounded closure record; a claim sweep is a consistency check, not a command run.
