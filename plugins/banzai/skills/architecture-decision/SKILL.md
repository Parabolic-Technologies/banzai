---
name: architecture-decision
description: Propose and govern architecturally significant decisions. Creates ADRs, compares options and trade-offs, and requires explicit human lifecycle decisions before planning relies on them. Auto-select only in a Banzai-adopted repository (root PROJECT_MANIFEST.md or .banzai/) or by name.
user-invocable: true
---

# architecture-decision

Use for an ADR-eligible choice from a feature, fix, bootstrap, or standalone
architecture request.

Inputs: user request, `AGENTS.md`, `PROJECT_MANIFEST.md`, decision log, relevant
accepted ADRs, code/docs, and `description.md` when feature-driven.

Output: `documentation/decisions/NNNN-<slug>.md` plus decision-index updates.

Apply the canonical Engineering Quality policy in the installed
`policies/engineering-quality.md`; this skill adds
only decision-specific responsibilities and does not copy its rule set.

## Artifact Storage

Before artifact discovery or writing, read the installed
`../../policies/artifact-storage.md` and resolve the selected work through its
plugin-local helper. Use the returned role paths for internal work artifacts;
`documentation/` work paths below describe the explicit legacy layout only.
Keep ADRs, indexes, manifests and maintained product guidance at their existing
repository paths. Status/loading stays read-only, and orchestrated work follows
the persisted run binding and exact phase grants.

## Sources

- Process: the project root `AGENTS.md`. Read it unless the host already
  assembled it into this session. Before decision analysis,
  recognize the layout: target when `AGENTS.md` carries `## Authority` and
  `## Policies` with no line beginning with `@`, and the `CLAUDE.md` shim is
  absent or carries no policy heading; legacy layout when `CLAUDE.md` carries
  `## Engineering Quality` and `AGENTS.md` is absent or lacks `## Authority`.
  Policy headings for layout recognition are `## Decision Consultation`,
  `## Test Assurance`, `## Security Assurance`, `## Engineering Quality`,
  and `## Plan Task Completion Evidence`.
  On legacy stop with "legacy Banzai layout: run `project-manifest` to migrate"
  and ask the user to run `project-manifest`; read neither legacy policy
  copies nor installed replacements as applicable rules, and never scaffold or
  migrate files. On partial report the exact ambiguity and stop without source
  changes, precedence guesses or reconstructed rules.
  Unadopted means neither file has `## Authority` or a policy heading; keep
  existing missing-manifest behavior. Every other combination, including an
  unreadable file, is partial. Skip this recognition rule in the plugin source
  repository. Never read a policy body from a project file.
- Policies, resolved as `../../policies/<name>.md` from this `SKILL.md`,
  never from the project working directory or a fixed plugin cache path.
  Stop before affected work if a required source is absent or unreadable;
  never substitute a project copy, a legacy inline policy or memory:
  - `decision-consultation.md` when strict planning frames an unresolved material human-owned choice, before drafting dependent artifacts.
  - `security-assurance.md` when weighing a trust-boundary, authorization, secret-handling or other applicable security option.
  - `engineering-quality.md` before discovery, design, implementation, fix or review judgment within this skill.
   - `artifact-storage.md` before resolving, reading or writing work artifacts.

## Orchestrated Mode

A legacy or partial layout returns `outcome=needs_human_decision`,
`gate=escalation`, the layout diagnostic as `summary`, one question naming
the migration step, and no source change.

Before drafting, inspect the request, manifest, accepted ADRs, contracts, and
relevant repository evidence. If the ADR decision still depends on a material
human-owned choice, return the planning-only `decision_consultation` gate with
`questions=[]` and one to three closed cards. Do not write a Proposed ADR that
selects an option until the exact keyed answer is recorded and re-analyzed.

When a local runner supplies a versioned output schema, write the `Proposed` ADR
and end the planning phase with `outcome=needs_human_decision` and
`gate=adr_approval`, listing the decision question in `questions` and the ADR
path in `artifacts.adrs`. Never self-accept.

The CLI records the accept, reject, or rework decision and restarts planning with
it. Apply the recorded decision in that next planning phase, then continue to
`development-plan` in the same session. Without runner context, the same
lifecycle decision is answered in chat.

## Preconditions

- Read ADR eligibility and authority rules from `AGENTS.md`.
- Read current manifest facts, the decision index, relevant ADRs, and source or
  configuration evidence.
- If feature-driven, require an approved `description.md` with no open product
  questions.
- Stop if requirements or decision drivers are insufficient. Do not resolve a
  product decision inside an ADR.
- Do not infer, rewrite, or self-answer an unresolved material choice. Raise
  it as a consultation card with the fields defined under **Decision
  Consultation** in the installed `policies/decision-consultation.md`, including repository-relative evidence. Do not
  repeat an answered identity against unchanged evidence; a new round needs a
  newly justified choice and new IDs.
- If the choice is not ADR-eligible, record that result in the calling artifact
  and return to its normal workflow without creating an ADR.

## Proposal

1. State one decision question and its owner. Split independent decisions.
2. Search the decision log for duplicates, conflicts, and decisions this one
   would deprecate or supersede.
3. Choose the next unused four-digit ID and recheck for collisions before write.
4. Evaluate viable options against requirements, quality attributes, security,
   current facts, accepted ADRs, cost, risk, reversibility, and operational
   impact. A new or changed trust boundary, authorization model, or
   secret-handling approach is ADR-eligible; apply the Security Assurance
   policy in the installed
   `policies/security-assurance.md` when weighing options. Use materially applicable
   Engineering Quality properties as decision drivers, not as a preselected
   architecture pattern or methodology.
5. Write the ADR with status `Proposed`.
6. Update `documentation/decisions/README.md` with the proposed record.
7. Present the proposal and wait for an explicit human lifecycle decision.

## ADR Document

Write these sections:

1. `# ADR NNNN: <Title>`.
2. **Status / Date / Owner / Decision Makers**.
3. **Related Artifacts**: feature, plan, manifest sections, and related ADRs.
4. **Context and Decision Drivers**: current/target distinction, requirements,
   constraints, and quality attributes.
5. **Options Considered**: material benefits, costs, risks, and rejection reason
   for each non-selected viable option.
6. **Decision**: direct, imperative outcome. Keep implementation steps out.
7. **Consequences**: positive, negative, risks, and required follow-ups.
8. **Compliance and Confirmation**: observable checks for implementation and
   review.
9. **Lifecycle Links**: `Supersedes`, `Superseded by`, or `None`.

## Lifecycle

- `Proposed`: revise, accept, or reject after review. Planning cannot rely on it.
- `Accepted`: record approval date and decision makers. The body becomes
  immutable and can guide planning before implementation exists.
- `Rejected`: preserve the proposal and add the rejection reason.
- `Superseded`: allowed only when a linked replacement ADR is accepted.
- `Deprecated`: use when the decision no longer applies without replacement.

## Apply The Decision

- Rework: keep `Proposed`, revise the proposal, and request another review.
- Accept: set `Accepted`, record approval date and decision makers, update the
  decision index, and add a `Planned` row to the manifest's active ADR index.
  The row carries only ID, title, path, and state; rationale, options, and
  consequences stay in the ADR body. The manifest stays current state and the
  ADR is approved target intent: `code-writing` moves the row to `Implemented`
  only after verification, and any current/target difference must be explicit
  in `plan.md`.
- Reject: set `Rejected`, record the reason, and update the decision index.
- Supersede: accept the replacement first, then change only status and lifecycle
  links on the older ADR, keep both in the decision log, and update both
  indexes.
- Deprecate: require explicit approval, record why it no longer applies, and
  remove it from the manifest's active index.

Update the decision-log row after every lifecycle change. Change an accepted
decision only with a new Proposed ADR; never rewrite its context, options,
decision, or consequences.

Engineering Quality does not expand ADR eligibility. Keep a local, reversible
implementation choice in the calling plan even when one policy property informs
it; create an ADR only when the existing eligibility threshold is met.

## ADR Decision Gate

Report ADR path, status, owner, related artifacts, current/target differences,
and the exact lifecycle decision needed. Wait for that decision.

This is one of the five decision gates in `AGENTS.md`. Consultation remains a
separate non-authorizing prerequisite and never accepts this ADR. Never
self-accept. Once
the decision is recorded, continue to `development-plan` without asking for
further confirmation.
