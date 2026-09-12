# Architecture Guidance

Canonical portable guidance. The active execution context supplies artifact roles
and policies; entry, host transport and contract mechanics remain with the caller.

## Proposal

1. State one decision question and its owner. Split independent decisions.
2. Search the decision log for duplicates, conflicts, and decisions this one
   would deprecate or supersede.
3. Choose the next unused four-digit ID and recheck for collisions before write.
4. Evaluate viable options against requirements, quality attributes, security,
   current facts, accepted ADRs, cost, risk, reversibility, and operational
   impact. A new or changed trust boundary, authorization model, or
   secret-handling approach is ADR-eligible; apply the Security Assurance
   policy (`security-assurance.md`) supplied by the active execution context when weighing options. Use materially applicable
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

