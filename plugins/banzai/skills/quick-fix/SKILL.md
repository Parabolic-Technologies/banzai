---
name: quick-fix
description: Scoped workflow for bugs, polish, refactors, hardening, and review cleanup. Changes code/tests, verifies, and writes a change report only when required. Auto-select only in a Banzai-adopted repository (root PROJECT_MANIFEST.md or .banzai/) or by name.
user-invocable: true
---

# quick-fix

Use for existing behavior. Do not use for net-new capability; route that to
`feature`.

Apply the canonical Engineering Quality policy in the installed
`policies/engineering-quality.md`; this skill adds
only fix-specific responsibilities and does not copy its rule set.

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
  assembled it into this session. Before fix discovery or implementation,
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
  - `plan-task-completion.md` when accepted findings involve an approved strict plan or its completion evidence.
   - `artifact-storage.md` before resolving, reading or writing work artifacts.

## Orchestrated Mode

A legacy or partial layout returns `outcome=needs_human_decision`,
`gate=escalation`, the layout diagnostic as `summary`, one question naming
the migration step, and no source change.

There are two runner contexts:

- With `BANZAI_WORKFLOW_DIGEST`, this is an automatically selected lite route
  for the original task. Follow the normal stop gate and return
  `phase=implementation`. If a trigger applies, make no source changes and
  return `outcome=needs_human_decision` with `gate=escalation` and exact
  questions. The runner records the answer and selects again. After completion,
  runner-owned deterministic verification ends the route; do not invoke
  `feature-review`.
- With `BANZAI_APPROVAL_DIGEST` and triaged review findings, fix only the
  accepted finding IDs included in the prompt. Rejected and deferred findings
  are out of scope. Read the durable `review-<iteration>.md` artifact when
  present, but treat the runner's accepted finding payload as authoritative: a
  modified review file must never expand fix scope. Keep the approved
  description, plan, and accepted ADRs immutable, and list the fixed IDs in
  `resolvedFindingIds`. Deterministic verification and the runner's
  policy-selected source-read-only re-review follow. An `EQ-SHADOW:` deferred
  coverage entry is never an accepted finding and must never enter fixer scope;
  an EQ mapping on an accepted ordinary finding does not expand that finding's
  accepted remediation.

Both contexts return the structured result required by
`contracts/v3/phase-result.schema.json` with `decisionConsultation: null`.
Return `taskCompletion: null` when the fix leaves completion evidence
untouched. When an accepted finding makes the recorded completion evidence
stale — the fix changed mechanisms, files, or totals it names — return the
complete refreshed ledger instead (ADR 0025): the same approved task set in
the same order, every status still `completed`, evidence describing the
current tree, and the report's **Plan Task Completion** section regenerated
under the runner-supplied grammar so both decode JSON-identical. Edit that
section only together with a returned refreshed ledger, never independently.
Downgrading a task status is not a refresh: when an accepted finding says
recorded work was never truly completed, complete the missing work when it is
within accepted-finding scope; otherwise leave ledger and projection
unchanged, record the contradiction in the change report, exclude that finding
from `resolvedFindingIds`, and return `outcome=needs_human_decision` with
`gate=escalation` naming it. Without runner context, the normal manual
workflow remains unchanged.

## Stop Gate

Before source/code changes, check `AGENTS.md` escalation triggers. If one
applies:

1. Present the planned fix.
2. Name the trigger.
3. Apply ADR eligibility.
4. If ADR-eligible, route feature work to `feature-description`, then
   `architecture-decision` and strict planning.
5. Otherwise wait for explicit user approval or route to `feature`/strict mode.

A proportionate regression test may be written before approval when it protects
the demonstrated behavior and equivalent evidence does not already exist;
production changes may not.

Apply the Security Assurance policy in the installed
`policies/security-assurance.md`. Introducing or widening a
security control is a trigger and follows the steps above; complying with an
already established, unchanged control is not: record the class in the change
report when one is required, and in the final report otherwise, then continue.

## Report Rule

Write `documentation/changes/<name>.md` when the fix:

- changes user-visible behavior or a public contract;
- fixes a documented bug;
- applies or skips review findings;
- changes `description.md`, `work.md`, `plan.md`, `test-report.md`,
  `review-<iteration>.md`, or `PROJECT_MANIFEST.md`;
- creates, supersedes, deprecates, or changes lifecycle metadata on an ADR;
- touches an escalation trigger;
- records a material Engineering Quality deviation;
- is requested to have an audit trail.

Otherwise finish with chat summary and verification.

## Workflow

1. Read relevant active accepted ADRs and the triaged review artifact when
   review findings initiated the fix. Require explicit accepted finding IDs;
   never infer acceptance from the review file alone. For defects, write a
   failing regression test first only when it protects a material observable
   regression not already covered and can be done without production changes.
2. Apply the stop gate.
3. Follow the Engineering Quality authority order and make the smallest
   compatible code/test/doc change that satisfies the request or accepted
   finding. Do not turn a shadow candidate, rejected concern, or alternative
   design opinion into extra scope. For approved strict plans, apply Plan Authority
   in the installed `policies/plan-task-completion.md`: preserve binding directives
   and legacy meaning; a suggested remedy remains optional unless an applicable
   explicit human decision makes it mandatory. Correcting a report cannot replace
   satisfying a required check or missing material evidence.
   Comment sparingly and with high signal:
   write a comment only to explain why, a constraint, trade-off, invariant,
   side effect, or non-obvious behavior, and do not narrate what the code
   visibly does.
4. Keep feature artifacts and manifest in sync when behavior, design,
   architecture, build settings, or conventions change. Rewrite only the
   stale manifest facts under the `project-manifest` writing rules; fix
   narrative and verification results belong in the change report.
5. After changing tests or verification commands, including their expected or
   observed results, search the complete current `test-report.md`,
   `implementation-report.md`, and the fix's change report when it exists or is
   required for every test-count and command-result claim. Update every current
   claim from a command actually run in this fix, or label earlier evidence
   explicitly `historical/pre-fix` with its scope. Keep all three artifacts
   mutually consistent, and never leave an old unqualified count or command
   outcome describing the current tree. In orchestrated mode, when runner-owned
   final verification has not run yet, record only
   `pending at fix handoff; durable runner evidence owns the eventual result`
   instead of predicting it or copying an earlier total as current.
6. Never rewrite an accepted ADR body. Route a changed accepted decision to a
   superseding ADR and reapproved strict plan.
7. If no upstream feature artifact exists, state that instead of inventing one.
8. Run focused affected checks. In orchestrated mode, do not repeat supplied
   full-scope runner commands; if the manifest final suite is absent, run it once
   and report the gap. In standalone mode, run one final applicable suite.
9. Run formatter check/fix only as final review, if configured. If it rewrites
   files, rerun affected checks.
10. Self-review for ADR and applicable Engineering Quality conformance, side
    effects, missing material negative evidence, disproportionate tests, and doc
    drift. Fix in-scope findings and rerun affected checks.
11. Write/update the change report when required.
12. Report.

## Change Report

Use `documentation/changes/<name>.md`:

1. title, date, affected feature and ADR links;
2. what changed;
3. why;
4. security exposure: one line per applicable class with the control applied,
   or one line stating that none applies;
5. files changed: production/tests/docs;
6. skipped review findings, if any;
7. documentation sync;
8. ADR conformance or lifecycle result;
9. material Engineering Quality deviations, or `None`;
10. verification commands and outcomes;
11. assurance critique result.

## Report

Report files changed, verification, the security exposure result, report path
or reason no report was needed, and unresolved triggers or follow-ups. This
report is unconditional, so it is where the exposure result lands whenever no
change report exists. The route ends here; the stop gate above is the only
place this skill waits.
