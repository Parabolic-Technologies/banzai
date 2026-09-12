# Fix Guidance

Canonical portable guidance. The active execution context supplies artifact roles
and policies; entry, host transport and contract mechanics remain with the caller.

## Report Rule

Write the resolved `changeReport` artifact when the fix:

- changes user-visible behavior or a public contract;
- fixes a documented bug;
- applies or skips review findings;
- changes `description.md`, `work.md`, `plan.md`, `test-report.md`,
  `review-<iteration>.md`, or `PROJECT_MANIFEST.md`;
- creates, supersedes, deprecates, or changes lifecycle metadata on an ADR;
- touches an escalation trigger;
- records a material Engineering Quality deviation;
- is requested to have an audit trail.

Otherwise verification and a final summary suffice; no change report is required.

## Workflow

1. Read relevant active accepted ADRs and the triaged review artifact when
   review findings initiated the fix. Require explicit accepted finding IDs;
   never infer acceptance from the review file alone. For defects, write a
   failing regression test first only when it protects a material observable
   regression not already covered and can be done without production changes.
3. Follow the Engineering Quality authority order and make the smallest
   compatible code/test/doc change that satisfies the request or accepted
   finding. Do not turn a shadow candidate, rejected concern, or alternative
   design opinion into extra scope. For approved strict plans, apply Plan Authority
   (`plan-task-completion.md`) supplied by the active execution context: preserve binding directives
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

## Change Report

Use the resolved `changeReport` artifact:

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

