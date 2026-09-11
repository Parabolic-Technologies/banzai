# ADR 0027: Exposure-Driven Security Assurance

## Status / Date / Owner / Decision Makers

- Status: Accepted
- Date: 2026-08-22
- Owner: Banzai maintainers
- Decision makers: User, explicitly accepted in chat on 2026-08-22

## Related Artifacts

- Feature description:
  `documentation/features/exposure-driven-security-assurance/description.md`
- Feature plan:
  `documentation/development-plans/exposure-driven-security-assurance/plan.md`
  (created after acceptance)
- Manifest: sections 3–5 of `PROJECT_MANIFEST.md` (plugin skill surface)
- Related ADRs:
  - ADR-0013, Risk-Driven Test Assurance: the precedent this mirrors —
    proportionate evidence, explicit permission to record "none", rejection of
    hollow artifacts. Extended in kind, not amended.
  - ADR-0014, Human-Triaged Review Closure: the reviewer finding and triage
    path a security finding reuses unchanged.
  - ADR-0001, Automatic Workflow Selection: owns the escalation trigger list
    and route selection this decision leaves byte-unchanged.

## Context and Decision Drivers

Current state: security exists in the plugin only as a gate. The installed
workflow rules carry an escalation trigger on the words `auth, permissions,
secrets, payments, privacy, compliance, destructive action`
(`plugins/banzai/CLAUDE.md:131`, mirrored into the selection prompt at
`packages/orchestrator/src/prompts.ts:143`) and a hard rule against unapproved
security changes (`:116`). Downstream, `test-writing` prioritizes
authorization, security, and privacy (`CLAUDE.md:165`) and `feature-review` may
label a finding `security` (`contracts/v1/review-result.schema.json:77`).

The three planning skills — `feature-description`, `development-plan`,
`architecture-decision` — contain no security vocabulary whatsoever. The only
non-functional hook in the requirements skill is **Platform Specifics: "only
touched constraints from the manifest"**, a pass-through of pre-existing facts
that yields nothing for greenfield work or a newly created attack surface.

The consequence is an asymmetry: every other quality dimension has positive
elicitation — requirements must be testable, tests have a prioritized assurance
policy, decisions have eligibility rules, verification has profiles — while
security has only a negative one. Nothing in the system ever asks what an
attacker could do with a feature. Work whose topic is not security but whose
surface is passes every gate silently: a report export (path traversal,
cross-tenant rows), a search filter (injection), a profile cache (cross-user
leakage). In each case no requirement is written, so the downstream instruction
to prioritize security assurance fires on evidence nobody specified.
Downstream prioritization cannot compensate for upstream absence.

Note the boundary of the problem: the orchestrator's *own* security posture is
strong (ADR-0004 privacy allow-list, exact-path reviewer-write authorization,
hook digest gating, API-key stripping, output redaction). The gap is that the
plugin does not impose comparable discipline on the projects it configures.

Target state: a positive, proportionate elicitation mechanism that produces
security requirements during planning, an enforcement point during design, and
falsifiable verification during review — without turning artifacts into
compliance theater.

Decision question: How do security requirements enter Banzai planning, and
where does the rule that governs them live?

Decision owner: Banzai maintainers, with explicit user lifecycle approval.

Decision drivers:

- the demonstrated absence of security elicitation in all three planning skills;
- this repository's anti-ceremony artifact rule (`CLAUDE.md:120`) — a section
  that mostly renders `N/A` degrades artifacts rather than improving security;
- the ADR-0013 precedent, which already solved the same shape of problem for
  tests: demand evidence where a mechanism exists, permit a justified none,
  reject hollow entries;
- token cost: skill text and the installed rules load into every session;
- drift risk across eight skills if the rule is restated per skill;
- lite routes must stay usable, or engineers will route around the workflow;
- no versioned contract should have to move.

## Options Considered

### Option 1: Proportionate Security Assurance policy with per-skill slots

One **Security Assurance** policy block in `plugins/banzai/CLAUDE.md`, beside
Test Assurance, owning seven mechanism-based exposure classes and the
proportionality rules. Each consuming skill gains a small output slot and a
one-line reference: a **Security Exposure** section in `feature-description`,
an enforcement-point requirement in `development-plan`, security among
`architecture-decision` drivers, a compact form in `feature` and `quick-fix`,
an audit item in `feature-review`, and a materiality note in `test-writing`. A
`check-release.mjs` check keeps the references from drifting.

- Benefits: one source of truth, so no cross-skill drift; token cost paid once;
  security requirements become ordinary numbered requirements and inherit
  testability, Consistency-Check mapping, and Test Assurance evidence rules for
  free; mirrors a precedent already proven in this codebase; no contract moves;
  lite routes stay usable because only introducing or widening a control
  escalates.
- Costs: adds one policy block to a file loaded in every session; correctness
  still depends on model judgment about reachability.
- Risks: judgment-dependence is constrained by explicit anti-hollowness rules,
  not eliminated. A model may still miss an exposure — but the reviewer's new
  audit item makes a wrong "no exposure" claim falsifiable against the diff.

### Option 2: Mandatory security section in every artifact

Require a fixed security questionnaire in every `description.md` and `work.md`.

- Benefits: maximally visible; impossible to skip.
- Costs/risks: on the majority of changes it produces per-class `N/A` lists,
  which directly violates `CLAUDE.md:120` and trains both models and humans to
  skim the section. Ceremony that is always present is ignored precisely when
  it matters. Rejected: it optimizes for the appearance of rigor over evidence.

### Option 3: A separate `security-review` skill or phase

Add a dedicated skill (or an extra runner phase) that audits the change for
vulnerabilities after implementation.

- Benefits: concentrated expertise; a familiar pattern (Claude Code ships a
  built-in `/security-review`).
- Costs/risks: it runs *after* the fact and therefore cannot inject
  requirements upstream, which is the actual gap — a control absent from the
  requirements is absent from the plan, the tests, and the implementation, and
  a late audit converts it into rework. It also adds a phase and its model
  cost, and duplicates `feature-review`'s scope and finding path. Rejected as a
  *replacement*; it remains complementary and out of scope here.

### Option 4: Extend the escalation trigger list with more keywords

Add terms such as `file upload, export, cache, search, redirect` to the
existing trigger list.

- Benefits: smallest possible edit; no new concepts.
- Costs/risks: keyword matching is exactly the failure mode being fixed. The
  list can never enumerate every feature with a surface, and each addition
  widens escalation for work that is usually benign, degrading routing quality.
  Rejected: it treats the symptom.

### Option 5: Status quo — rely on downstream review and test priority

- Benefits: zero change, zero token cost.
- Costs/risks: preserves the demonstrated asymmetry. `test-writing` cannot
  prioritize a guarantee nobody specified, and `feature-review` has a
  `security` finding category but no audit step directing it to look.
  Rejected: it is the state that produced this decision.

## Decision

Adopt Option 1.

Define one **Security Assurance** policy in `plugins/banzai/CLAUDE.md` as the
single source of security elicitation rules. No skill restates the exposure
classes; each references the policy the way it already references Test
Assurance.

Assess exposure by mechanism, not by topic. The policy defines exactly seven
classes: untrusted input reaching an interpreter or resource path; an identity
or access decision; secret material; personal or regulated data;
cross-principal reachability; an outbound request or redirect whose destination
an input can influence; a destructive or irreversible effect.

Scope every assessment to the surface the change itself creates or widens, not
the whole system, so established unchanged controls are not re-litigated.

Require each applicable class to produce at least one requirement stated in the
ordinary testable form, and require the plan to name the enforcement point
where it is applied. Security requirements are material guarantees under Test
Assurance and take their evidence level from it; this decision creates no
second assurance regime and no security-test quota.

Permit an explicit no-exposure result as one line naming that no class applies
and why. Forbid a section of per-class `N/A` entries. Reject as non-evidence
generic advice, a restatement of a framework or platform default, "be careful"
prose, and a threat with no mechanism reachable in the current codebase.

Preserve the existing escalation trigger byte-unchanged and state the division
of labor: the trigger governs work whose topic is security; the exposure review
governs work whose topic is not. Introducing or widening a security control is
an escalation trigger; complying with an already established control is not, so
lite routes remain usable.

Give `feature-review` a numbered security audit item that verifies, against the
diff as built, that each recorded exposure has an enforcement point and
proportionate evidence and that a recorded no-exposure claim still holds. A
security finding obeys the same anti-hollowness rules as a missing-test
finding: it must name the exposure class, the reachable mechanism, why current
evidence does not cover it, and the observable fix acceptance. A class label
alone is not a finding.

Change no versioned contract. Protect the skill-to-policy references with a
`check-release.mjs` check so the wiring cannot drift silently.

## Consequences

Positive:

- A feature whose topic is not security can no longer pass planning without its
  surface being considered, which is the demonstrated gap.
- Security requirements become testable requirements, so they automatically
  reach the plan's Consistency Check, the assurance map, and the reviewer.
- A "no exposure" claim becomes falsifiable evidence rather than silence.
- One policy block, one reference per skill: no cross-skill drift, and the
  token cost is paid once.
- No contract version moves; the plugin change is additive Markdown plus one
  release check.

Negative:

- The installed rules and six skills grow, and every session pays that context.
- Correctness depends on model judgment about reachability; the policy
  constrains sloppiness but cannot guarantee an exposure is spotted.
- Engineers on lite routes acquire one more line to record even on small
  changes.

Risks and follow-ups:

- Under-application risk: a model records "no exposure" wrongly. Mitigated, not
  removed, by the reviewer audit item; worth measuring after adoption.
- Over-application risk: `N/A`-style padding creeps back. The anti-hollowness
  rules and the reviewer are the counterweight.
- A dedicated post-implementation security audit (Option 3) remains available
  as complementary future work and is deliberately out of scope here.

## Compliance and Confirmation

- `plugins/banzai/CLAUDE.md` contains exactly one Security Assurance policy
  block, and no skill file restates the seven-class list (inspection plus the
  `check-release.mjs` reference check).
- `npm run release:check` fails when a skill required to reference the policy
  loses that reference.
- `feature-description` renders a **Security Exposure** section before
  **Architecture Decision Needs**; `development-plan` names an enforcement
  point per recorded exposure and maps every security requirement to a task;
  `feature-review` carries a numbered security audit item.
- Dogfooding evidence: a description produced for a change with no security
  surface contains one no-exposure line and no per-class `N/A` list.
- Contract stability: `contracts/` JSON, `CONTRACT_VERSION`, evaluation, and
  control contract identities are byte-identical before and after.
- `npm run verify` and `npm run release:check` pass.

## Lifecycle Links

- Supersedes: None
- Superseded by: None
