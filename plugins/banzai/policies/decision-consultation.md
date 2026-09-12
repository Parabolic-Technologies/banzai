# Decision Consultation

- Owner decision: ADR-0031
- Consumers: None; conditional: `feature-description`, `architecture-decision`, `development-plan`
- Process source: the project `AGENTS.md` (authority order, escalation triggers, decision gates)
- Runner consumers: planning (conditional).
- Delivery: standalone skills load this policy relatively; runner phases receive its body inline. Conditional duties retain their conditions.

## Decision Consultation

An unresolved material choice in strict planning is raised as
`gate=decision_consultation` only after repository analysis. Present one to three
bounded cards with independent stable IDs, the exact question, why it matters,
affected requirements, repository-relative evidence, viable options and their
material consequences, response mode, human owner, and an advisory
recommendation only when evidence supports one.

Do not write a Proposed ADR or plan that selects an option while its prerequisite
consultation is unanswered. Record exact keyed human answers as decision
provenance, analyze them again, and do not repeat an answered decision against
unchanged evidence. A new round requires a newly justified independent choice
and new identities.

Consultation is not approval or permission. An answer, including `Use
recommendation`, never accepts an ADR, approves a plan, authorizes code, fixes,
triage, recovery, release, or an external side effect. The later ADR and plan
gates remain separate. In standalone mode present the same cards in chat; in
orchestrated mode return the typed request with `questions=[]` and let the CLI or
compatible supervisor relay only the current user's exact answer.
