# Security Assurance

- Owner decision: ADR-0027
- Consumers: `feature-description`, `development-plan`, `feature-review`, `feature`, `quick-fix`; conditional: `architecture-decision`, `code-writing`, `test-writing`, `project-manifest`
- Process source: the project `AGENTS.md` (authority order, escalation triggers, decision gates)

## Security Assurance

Assess the surface **this change creates or widens**, not the whole system. An
established control the change only uses is not re-litigated.

Exposure classes, judged by mechanism rather than by topic word:

1. Untrusted input reaches an interpreter or resource path: a query, filesystem
   path, template, command, deserializer, or markup renderer.
2. An identity or access decision: new or changed authentication,
   authorization, role, tenant, ownership, or capability check.
3. Secret material: how a credential, token, or key is obtained, stored,
   transmitted, and kept out of logs and errors.
4. Personal or regulated data: collection, retention, export, and appearance in
   logs or error messages.
5. Cross-principal reachability: one user's or tenant's data reachable by
   another through identifiers, listings, caches, or shared state.
6. An outbound request or redirect whose destination an input can influence.
7. A destructive or irreversible effect: deletion, overwrite, money movement,
   external publication, or mass mutation.

Rules:

- Each applicable class produces at least one requirement written in the same
  testable form as any other requirement, and the plan names the enforcement
  point — the module or boundary where the control is applied.
- Security requirements are material guarantees under Test Assurance and take
  their evidence level from it. There is no separate security-test quota.
- When no class applies, record one line naming that and why. Never write a
  section of per-class `N/A` entries.
- These are not evidence: generic security advice, a restatement of a framework
  or platform default, "be careful" prose, and a threat with no mechanism
  reachable in the current codebase.
- A security finding must name the exposure class, the reachable mechanism, why
  current evidence does not cover it, and the observable fix acceptance. A
  class label alone is not a finding.

Division of labor with the escalation triggers in the project `AGENTS.md`: a trigger governs work
whose topic is security; this exposure review governs work whose topic is not.
Introducing or widening a security control is an escalation trigger. Complying
with an already established, unchanged control is not, so ordinary work that
merely touches an applicable class stays on its normal route.
