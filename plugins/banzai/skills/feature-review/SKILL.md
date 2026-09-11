---
name: feature-review
description: Source-read-only artifact-aware audit. Reviews a feature against specs, plans, ADRs, source/tests, reports, and manifest rules, then produces a durable Markdown review artifact for human and cross-model triage. Auto-select only in a Banzai-adopted repository (root PROJECT_MANIFEST.md or .banzai/) or by name.
user-invocable: true
---

# feature-review

Keep source, tests, requirements, plans, ADRs, reports, configuration, and
runner state read-only. In standalone mode the only permitted write is the
review artifact defined below. In orchestrated mode every repository path
remains read-only; the runner creates the artifact. Never fix findings during
review.

Apply the canonical Engineering Quality policy in the installed
`policies/engineering-quality.md`; this skill adds
only review, shadow-classification, and resolution responsibilities and does not
copy its rule set.

Input: feature slug. If absent, infer from recent artifacts and confirm.

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
  assembled it into this session. Before audit or completion judgment,
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
  - `test-assurance.md` before selecting or changing tests and assigning assurance evidence.
  - `security-assurance.md` before assessing changed exposures and their requirements or evidence.
  - `engineering-quality.md` before discovery, design, implementation, fix or review judgment within this skill.
  - `plan-task-completion.md` when interpreting strict plan authority or completion evidence.
   - `artifact-storage.md` before resolving, reading or writing work artifacts.

## Orchestrated Mode

A legacy or partial layout returns `verdict=blocked` with the layout
diagnostic as `summary` and no findings.

The runner supplies `contracts/v2/review-result.schema.json`, an immutable
review snapshot identity, exact required approved paths, review mode, accepted
finding IDs, verification evidence and validated completion. Return one
structured `review-result/v2` result with `schemaVersion: 2`; write no file and
return no gate field. The runner retains the response, validates it, renders an
attempt-owned candidate and atomically publishes validated Markdown. A failed
candidate remains diagnostic evidence; no formatting-repair turn is requested.

Return `scopeAcknowledgment` version 1 with the exact `snapshotDigest` and one
entry per required path. `reviewed` requires `reason: null`; `not_reviewed`
requires a nonblank reason. Do not omit, duplicate, normalize or invent paths.
Full-review acknowledgment asserts assessment as authority for the complete
approved review surface. Delta acknowledgment asserts assessment of applicability
to accepted findings and the complete current delta in this invocation, with
no carried-forward assertion or reduced mandatory context. This assertion is
not independent proof of reading or substantive assessment.

Any required artifact not reviewed requires `verdict: blocked`. A layout or
authority stop may acknowledge all paths as `not_reviewed`, explain the blocker
in reasons and summary, and return no findings or reviewed finding IDs. Preserve
actual partial findings. For blocked results, `reviewedFindingIds` contains only
actually assessed accepted IDs; other verdicts require all immediately preceding
accepted IDs. Use stable finding IDs `R<iteration>-F<number>` and return `pass`
only with no findings and complete required coverage.

You own judgment, findings, evidence details, reproduction, fix acceptance,
summary and deferred coverage. Put meaningful additional review prose in
`reviewNotes`; an empty array is valid. Preserve every `EQ-SHADOW:` entry as
opaque deferred content. Do not reproduce Markdown, verification/completion
metadata, test totals or successful commands: the runner projects the recorded
snapshot, while you assess its evidence for material contradictions.

Treat the supplied completion summary as required review scope: inspect the
per-task evidence and fail the review when the repository materially
contradicts it; never repair it from report prose.

A full review is a fresh reviewer session with no planner or implementer
transcript. A delta review resumes only the same independent reviewer lineage,
treats remembered context as a cache, and inspects the complete runner-supplied
change surface. Resolution review is closure-oriented, not discovery-oriented:
verify every finding accepted in the immediately preceding triage, and report
a new finding or shadow candidate only when the fix introduced it, the changed
evidence surface newly exposes it, an approved contract or established
invariant regressed, or a previously unobservable critical correctness,
security, or lifecycle issue is now visible — with new evidence and a distinct
deduplication identity. Do not reopen rejected or deferred concerns against
unchanged evidence and authority, even after reviewer rotation; a stylistic
opinion or alternative design is insufficient.

Current runner verification is the default command evidence; rerun only a
focused reproduction or a command whose evidence is missing, stale,
inconsistent, or directly material to a finding, and record why. Without
runner context, run a fresh full review with the normal `F1` format.

## Read

- `documentation/features/<slug>/work.md`, if present.
- `documentation/features/<slug>/description.md`, if present.
- `documentation/development-plans/<slug>/plan.md`, if present.
- `documentation/features/<slug>/implementation-report.md`, if present.
- `documentation/features/<slug>/test-report.md`, if present.
- `documentation/decisions/README.md` and ADRs linked by feature artifacts,
  source boundaries, or the manifest.
- `PROJECT_MANIFEST.md`.
- Source and tests.

When Serena MCP tools are listed, prefer `find_symbol`,
`find_referencing_symbols`, and `get_symbols_overview` over pattern search or
line-window reads for code.

Stop if neither lite nor strict artifacts exist. Flag partial strict artifact
sets.

## Review Artifact

In orchestrated mode, return the structured result described above; the runner
owns the durable artifact. The Markdown-writing instructions in this section
apply only to standalone review without runner context.

Standalone: inspect `documentation/features/<slug>/review-*.md` and write the
next positive iteration at `documentation/features/<slug>/review-<iteration>.md`.
Create only that artifact and leave reviewed inputs unchanged. Keep the v1
format below; do not invent runner scope acknowledgment or evidence.

```text
# Implementation Review: <slug>

- Format: `banzai-feature-review/v1`
- Feature slug: `<slug>`
- Review iteration: `<number>`
- Verdict: `pass|changes_requested|replan_required|blocked`
- Workspace digest: `<runner value or "not supplied">`
- Review artifact: `<repository-relative path>`

## Review Scope
Approved/reviewed artifacts and deterministic verification evidence.

## Summary
Concise verdict rationale.

## Findings
### <finding-id> — <summary>
- Severity: `blocker|should_fix|nit`
- Category: `spec|plan|adr|correctness|test|security|maintainability|documentation`
- Confidence: `high|medium|low`
- Evidence: repository-relative `path:line` plus detail
- Violates: requirement, ADR, plan, or manifest references
- Reproduction: steps or `Not provided.`
- Fix acceptance: observable completion condition

## Previously Accepted Findings
IDs verified during re-review, or `None.`

## Deferred Coverage
Anything not verified, or `None.`

## Handoff
Whether human triage is required and what the next model may act on.
```

Write `No findings.` under **Findings** for a clean review. Keep the artifact
self-contained: another AI model must be able to understand scope, evidence,
constraints, and the exact fix acceptance without access to chat or model
transcripts.

## Audit

For each finding, cite `file:line`.

1. Spec compliance: every FR/acceptance criterion implemented; no scope
   expansion.
2. Resolved assumptions: states, gates, errors, interruptions honored.
3. Plan conformance: apply Plan Authority in the installed
   `policies/plan-task-completion.md`; task statuses match code/reports and real
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
11. Tests: apply the Test Assurance policy in the installed
    `policies/test-assurance.md`. Reject hollow, redundant,
    implementation-mirroring, or disproportionate tests. Confirm the Risk and
    Contract Assurance Map does not overstate its evidence.
12. Docs: no stale artifact, ADR, decision-index, or manifest statements.
13. Security: apply the Security Assurance policy in the installed
    `policies/security-assurance.md` against the diff as built.
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

## Chat / Structured Result

For standalone chat, summarize the artifact path and use:

```text
F1 [Blocker|Should-fix|Nit] - summary.
Evidence: path/to/file:42.
Violates: FR3 / ADR-0004 / plan section / manifest section.
Fix: concrete action.
```

- Blocker: spec violation, unapproved dependency, reliance on a non-Accepted
  ADR, accepted ADR body rewrite, or false report claim.
- Should-fix: convention violation, undocumented deviation, stale docs.
- Nit: optional polish.

An Engineering Quality mapping never changes a severity; `EQ-02`, `EQ-06`, and
`EQ-10` never create blockers by themselves.

If clean, report `No findings`.

## Review Triage Gate

Stop after producing and reporting the review result. The human decides each
disposition: orchestrated runs use `banzai triage`, standalone runs ask in chat.
Only accepted findings reach `quick-fix`; rejected and deferred findings are
out of scope for the fix. When no finding is accepted, the recorded human triage
finishes the run without another unchanged-source review and without converting
the latest verdict to `pass`. Accepted findings retain the normal fix,
verification, and re-review path.

`EQ-SHADOW:` entries are deferred coverage rather than findings. They receive no
mandatory disposition, never become accepted, and never enter the fix or
completion path.
