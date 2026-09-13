# Review Guidance

Canonical portable guidance. The active execution context supplies artifact roles
and policies; entry, host transport and contract mechanics remain with the caller.

## Read

- the resolved `work` artifact, if present.
- the resolved `description` artifact, if present.
- the resolved `plan` artifact, if present.
- the resolved `implementationReport` artifact, if present.
- the resolved `testReport` artifact, if present.
- `documentation/decisions/README.md` and ADRs linked by feature artifacts,
  source boundaries, or the manifest.
- `PROJECT_MANIFEST.md`.
- Source and tests.

When Serena MCP tools are listed, prefer `find_symbol`,
`find_referencing_symbols`, and `get_symbols_overview` over pattern search or
line-window reads for code.

Stop if neither lite nor strict artifacts exist. Flag partial strict artifact
sets.

## Audit

For each finding, cite `file:line`.

1. Spec compliance: every FR/acceptance criterion implemented; no scope
   expansion.
2. Resolved assumptions: states, gates, errors, interruptions honored.
3. Plan conformance: apply Plan Authority (`plan-task-completion.md`) supplied by the active execution context; task statuses match code/reports and real
   deviations are recorded proportionately. Optional-guidance differences alone
   are not findings, but independently supported defects still are. Preserve
   legacy meaning and explicit approved directives even when another approach
   seems equivalent; keep existing severity rules. In
   an approved orchestrated run, unchecked immutable boxes define the work set
   and are not a finding by themselves. Apply the same evidence hierarchy as
   `feature-status`: inspect the runner-supplied validated completion summary
   and task records, then check material consistency with the implementation
   report, required assurance, approval digest, state, and source. The runner's
   deterministic checks remain the primary enforcement boundary; a reviewer
   must not return `pass` when required evidence is absent, a task is incomplete
   or blocked, or a material contradiction is visible. Report a finding only for a
   material contradiction or gap, never merely to request checkbox mutation.
4. ADR lifecycle: required decisions exist, relied-on ADRs are `Accepted`,
   supersession links are reciprocal, and accepted bodies were not rewritten.
5. ADR conformance: implementation and tests satisfy decision, consequences,
   and confirmation criteria; no architecturally significant choice is hidden
   only in a plan or manifest.
6. Report accuracy: file lists and verification claims match reality.
7. Verification: inspect current runner evidence. Rerun only a focused
   reproduction or missing, stale, inconsistent, or directly material command;
   record why. Run the formatter check only when that evidence is specifically
   required. Never run formatter fixes in review.
8. Manifest conformance: current facts, active ADR index, naming, errors,
   organization, async model, localization, dependency policy.
9. Maintainability: report dead generality, needless indirection, unclear
   responsibility, or comment/documentation behavior as an ordinary finding
   only when exact evidence shows current material impact or a violated approved
   authority. A preferred pattern, decomposition, control-flow style, or generic
   cleanliness opinion is not a finding.
10. Repository conventions: apply only manifest facts, configured rules,
    approved guidance, and dominant local conventions relevant to the changed
    surface. Do not invent generic naming, comment, size, or directory rules.
11. Tests: apply the Test Assurance policy (`test-assurance.md`) supplied by the active execution context. Reject hollow, redundant,
    implementation-mirroring, or disproportionate tests. Confirm the Risk and
    Contract Assurance Map does not overstate its evidence.
12. Docs: no stale artifact, ADR, decision-index, or manifest statements.
13. Security: apply the Security Assurance policy (`security-assurance.md`) supplied by the active execution context against the diff as built.
    Each recorded exposure has a named enforcement point and proportionate
    evidence; a recorded no-exposure claim still holds for the code that
    exists. Use the `security` category.
14. Engineering Quality: after the ordinary audit and verdict are frozen, apply
    the shadow procedure below. Do not use an EQ-only concern to retroactively
    create or re-severity an ordinary finding.

For a missing-test finding, the existing finding fields must together identify:

- the material observable guarantee;
- the plausible regression mechanism;
- why current evidence cannot detect it;
- the proportionate evidence level and observable fix acceptance.

Coverage percentage, syntactic reach, a private helper, or a traceability row
alone is not a finding. A false report claim remains a finding, but its fix may
either add proportionate evidence or narrow the claim truthfully. Missing
material contract or safety evidence and failed required checks remain actionable;
claim narrowing cannot discharge an actual mandatory requirement.

A security finding obeys the same rule: it must name the exposure class, the
mechanism reachable in this codebase, why current evidence does not cover it,
and the observable fix acceptance. An exposure-class label, a generic threat
name, or a framework default alone is not a finding.

For an accepted-finding resolution, inspect the accepted IDs, changed scope,
current binding/approved authority, direct physical origins and current
applicability. Keep review independent of the builder transcript. Executed,
reused, historical, failed and pending evidence have different meanings; do not
turn reuse into a fresh pass or infer missing assurance from a report count.
Inspect surrounding claims for contradictions while keeping the review focused
on the authorized delta. The existing human triage and scope acknowledgment remain.

## Engineering Quality Shadow Procedure

1. Complete audit items 1–13 under their existing authorities. Freeze the
   ordinary findings, severities, and verdict before classifying Engineering
   Quality overlap or looking for an incremental EQ-only candidate.
2. An already-valid ordinary finding may add exactly one primary `EQ-NN` to its
   existing `violates` array. The finding must qualify without that mapping, and
   the mapping changes neither severity nor verdict.
3. Record a genuinely incremental EQ-only candidate only as one `EQ-SHADOW:`
   string in existing free-form `deferredCoverage`. It must include a
   review-local candidate ID, primary rule ID, suggested severity, confidence,
   exact evidence and stable location, concrete impact, smallest reasonable
   remediation, relevant authority references, verification method, semantic
   dedupe key, and `waiver=not_applicable (shadow-only)`.
4. Use the dedupe identity defined by the canonical policy. Merge wording-only
   duplicates and line-number drift into one record. Ordinary deferred-coverage
   prose remains valid.
5. A shadow record is not a finding: it cannot affect ordinary findings,
   severity, verdict, mandatory human triage, accepted scope, fixing,
   completion, or a gate. Do not put it in `findings`, and do not promote it even
   when its suggested severity is `blocker`.

Recommended human-readable form, as a semantic evaluation convention only:

```text
EQ-SHADOW: candidateId=EQ-S1; ruleId=EQ-04; severity=should_fix; confidence=high; evidence=src/config.ts:84 ConfigLoader.parseConfig; impact=malformed persisted values reach process invocation; remediation=validate with the existing config decoder; references=FR3 and manifest section 6; verification=focused malformed-value rejection plus legacy-valid acceptance; dedupeKey=EQ-04|ConfigLoader.parseConfig|FR3|invalid-config; waiver=not_applicable (shadow-only)
```

No EQ-specific field is mandatory in the review-result contract. Do not change the
structured schema, parser, or runtime validation to interpret the string.

