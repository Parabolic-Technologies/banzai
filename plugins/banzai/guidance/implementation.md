# Implementation Guidance

Canonical portable guidance. The active execution context supplies artifact roles
and policies; entry, host transport and contract mechanics remain with the caller.

## Implementation Rules

1. Follow the approved task order and preserve approved task meaning.
2. Group adjacent steps with no escalation trigger into batches. Report a batch
   and continue; a batch boundary is not a gate.
3. Stop before any planned or discovered escalation trigger; name it and wait
   for explicit approval.
4. After each batch, run focused affected checks that give useful feedback.
5. Do not run formatter in batch loops. Run it only during final verification.
6. Apply the Test Assurance policy (`test-assurance.md`) supplied by the active execution context. Preserve tests that protect
   material guarantees. Add, consolidate, or remove tests only when the resulting
   evidence remains proportionate and non-redundant.
7. Do not add unapproved dependencies. Add only dependencies explicitly
   authorized by the approved plan, then update the lockfile and manifest.
8. Apply the Engineering Quality authority order and materially applicable
   constraints. Keep work within approved scope, use the smallest compatible
   implementation, and reuse repository mechanisms and evidence owners rather
   than creating an EQ checklist, methodology, or test quota.
9. Apply each linked ADR's compliance and confirmation constraints.
10. Make important implementation dependencies, boundary behavior, failure and
    lifecycle consequences, and compatibility changes explicit when the plan
    identifies them; do not invent those concerns for an unaffected surface.
11. Comment sparingly and with high signal. Write a comment only to explain
    why: a constraint, trade-off, invariant, side effect, or non-obvious
    behavior. Do not narrate what the code visibly does.
12. When Serena MCP tools are listed, prefer `find_symbol`,
    `find_referencing_symbols`, and `get_symbols_overview` over pattern search
    or line-window reads for code.

## Deviations

Apply Plan Authority (`plan-task-completion.md`) supplied by the active execution context.
Satisfy binding requirements within approved scope; a different compliant choice
under explicitly optional guidance is not a deviation and needs no reapproval or
report entry merely for differing. Preserve legacy approved meanings and exact
directives; private appearance alone does not make a constraint optional.

Record material decisions and real deviations proportionately, with rationale
and confirmation that `description.md` still holds. A missing/deprecated API,
framework behavior or correctness gap may require a deviation, but documenting
it does not authorize a changed commitment. Use existing escalation/reapproval
for conflicts. Record material Engineering Quality deviations in the existing
implementation report, not a separate artifact or mandatory per-rule checklist.

If a deviation conflicts with or invalidates an accepted ADR, stop before the
conflicting change. Require a superseding architecture proposal, then revise and reapprove
the plan. Never edit the accepted ADR body.

## Final Verification

Before the report:

1. Trace every FR and acceptance criterion to implementation and proportionate
   assurance evidence.
2. Confirm every resolved assumption is honored.
3. Trace every accepted ADR compliance/confirmation item to code, tests, or an
   explicitly owned non-automated check.
4. Confirm every plan task is complete or reported as a gap.
5. Confirm each material claim has the proportionate evidence owner assigned by
   the plan and that applicable Engineering Quality constraints and deviations
   match the current implementation.
6. Run formatter check/fix if configured.
7. In orchestrated mode, do not repeat a full-scope command supplied in the
   runner verification block. If the manifest's applicable final suite is absent
   from that block, run it once and record the configuration gap.
8. In standalone mode, run the applicable typecheck, lint, and final test suite
   once unless the shared deterministic owner establishes a permitted equivalent
   disposition for that check under Test Assurance. Keep unsupported checks fresh.
9. If formatting changed files, rerun affected checks.
10. Set verified ADR entries in the manifest index to `Implemented`; leave
    unimplemented accepted decisions as `Planned`.
11. Update only the manifest facts the change made stale, following the
    `project-manifest` writing rules: rewrite the affected bullet, add or remove
    module entries, and record no delivery narrative, verification history, or
    test counts. Those belong in the implementation and test reports.

## Implementation Report

Write the resolved `implementationReport` artifact:

1. title, slug, links to description and plan;
2. files created/modified/deleted and new folders/modules;
3. FR/story trace plus final verification commands and outcomes;
4. ADR conformance and confirmation evidence;
5. statement: no functional gap and no scope expansion, or list gaps;
6. deviations from plan;
7. assurance evidence added, reused, consolidated, or intentionally deferred,
   and the material guarantee each automated test can fail to protect;
8. material Engineering Quality deviations and their authority, impact, and
   evidence owner, or `None`;
9. notes for assurance.


For a bounded accepted-finding closure, retain unaffected report text. Add one
record with accepted finding ID, changed scope, deterministic decision, executed/
reused/historical/pending evidence references and limitations. Inspect all current
claims for consistency and correct only affected claims; never predict a pending
runner result or manufacture a new attempt for reused evidence.
