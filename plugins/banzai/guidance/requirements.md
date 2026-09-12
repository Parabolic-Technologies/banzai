# Requirements Guidance

Canonical portable guidance. The active execution context supplies artifact roles
and policies; entry, host transport and contract mechanics remain with the caller.

## Clarification Loop

- Ask concrete, batched questions for unpinned product decisions.
- First inspect the manifest, accepted ADRs, executable/public contracts,
  and relevant source, tests and documentation. Consult the owner only for a
  remaining choice that can materially change requirements, architecture,
  compatibility, risk, a quality attribute or scope. Apply Decision Consultation
  when its conditions hold; never select or infer the human answer.
- Choose a default only when the manifest or existing behavior determines it
  and the decision has no escalation trigger.
- Record every decision under **Resolved Assumptions** with one tag:
  `User-confirmed`, `Sensible default`, or `Manifest convention`.
- Continue until **Open Questions & Risks** is `None outstanding`.
- Record ADR-eligible technical questions under **Architecture Decision Needs**;
  do not choose a technical solution in this phase.
- Do not repeat an answered decision against unchanged evidence. Treat exact
  keyed answers as decision provenance, not approval or broader authority; a
  newly justified round uses new IDs.

## Document

1. `# Feature: <Name>` and `Slug: <slug>`.
2. **Overview**: behavior, primary flow, key constraint, non-goals.
3. **Functional Requirements**: numbered `FR1`, `FR2`; single, testable
   statements with exact names for assets, APIs, events, fields, formats, sort
   order, and states.
4. **User Stories & Acceptance Criteria**: Given/When/Then for observable
   behavior.
5. **Platform Specifics**: only touched constraints from the manifest.
6. **Security Exposure**: one line per applicable exposure class naming the
   mechanism and the FR numbers that satisfy it; or one line stating that no
   class applies and why.
7. **Architecture Decision Needs**: decision question, drivers, affected FRs or
   quality attributes, and relevant existing ADRs; or `None`.
8. **Resolved Assumptions**: numbered product decisions with provenance.
9. **Open Questions & Risks**: must be `None outstanding` before hand-off.

## Rules

- No file layout, class design, or implementation detail.
- Do not put options, solution selection, or ADR rationale in the description.
- If an FR cannot map to acceptance criteria, rewrite it.
- Apply the Security Assurance policy (`security-assurance.md`) supplied by the active execution context. Every applicable exposure
  class becomes an ordinary numbered FR with acceptance criteria; a security
  requirement that cannot map to acceptance criteria is rewritten like any
  other. Do not write a per-class `N/A` list.
- Inspect only load-bearing context relevant to the requested change. Turn a
  materially applicable observable Engineering Quality constraint into an
  ordinary FR and acceptance criterion. Leave internal design constraints to an
  ADR decision need or the development plan.
- Do not create an Engineering Quality section, a ten-rule checklist, or
  per-rule `N/A` entries. Generic preference is not a requirement.
- Quote user-facing strings exactly.
- Pin enable/disable states, error paths, and interruption behavior.

