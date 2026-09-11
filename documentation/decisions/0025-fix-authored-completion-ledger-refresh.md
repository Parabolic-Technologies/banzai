# ADR 0025: Fix-Authored Completion Ledger Refresh

Publication note (2026-09-09): private operational examples were removed at
the project owner's request. The accepted decision and lifecycle are unchanged.

## Status / Date / Owner / Decision Makers

- Status: Accepted
- Date: 2026-08-21
- Owner: Banzai maintainers
- Decision makers: User, explicitly accepted in chat on 2026-08-21
- Amends: ADR-0017 (Versioned Plan Task Completion Ledger)

## Related Artifacts

- ADR-0017 defines the versioned ledger, its deterministic validation, and the
  revalidation schedule this decision leaves intact.
- Change reports: `documentation/changes/post-fix-projection-mismatch-repair.md`
  and `documentation/changes/completion-decode-failure-repair.md` document the
  operational evidence that motivated this amendment.
- Manifest: sections 5 and 8 of `PROJECT_MANIFEST.md`.

## Context

ADR-0017 made the strict implementation result's `taskCompletion` ledger the
sole canonical completion source, required fixes to return
`taskCompletion: null`, and mandated revalidation of the ledger and its report
projection after accepted-finding fixes and before re-review.

Those three rules interact into a structural trap. A human-accepted fix
changes the implementation, so after any substantive fix the frozen evidence
necessarily describes code that no longer exists. Deterministic validation
cannot see semantic staleness, but an honest independent reviewer flags it as
a blocker when the ledger still names replaced mechanisms, stale test totals,
or inaccurate changed-file claims. Under ADR-0017 the only truthful resolution was
`gate=escalation`, which voids plan approval and forces a replan, re-approval,
and a full re-implementation attempt — a mandatory round trip whose entire
purpose is to regenerate evidence to describe the tree the fix already
produced. The trap recurs on every strict run whose review yields real fixes.

## Decision

An accepted-finding fix result may carry a complete replacement
`taskCompletion` ledger together with the regenerated report projection.
`taskCompletion: null` remains the contract when the fix leaves completion
evidence untouched.

A fix-supplied ledger is validated by the identical fail-closed pipeline that
governs implementation ledgers — approved task set and order from the exact
approved plan, allowed statuses, evidence inside the run's authorized changed
surface, required reports, byte-exact projection parity — with one additional
constraint: it is a refresh of evidence, never of achievement. A completed fix
outcome still requires every task `completed`, so a status downgrade cannot
ride in as a refresh; a finding that shows recorded work was never truly done
still routes through `gate=escalation`.

On success the persisted checkpoint records the fix attempt as the canonical
source (`sourceAttemptKind: "fix"`, an additive field defaulting to
`"implementation"` for every earlier checkpoint), and revalidation reads the
fix attempt's stored result thereafter. On rejection the attempt fails exactly
like a rejected implementation ledger: the invalid checkpoint is written and
the already-authorized completion-evidence repair retry reruns the fix with
the persisted diagnostic and unchanged triage scope.

## Options Considered

1. **Fix-authored refresh (chosen).** One attempt corrects code, prose,
   projection, and ledger coherently; validation, not authorship phase, remains
   the integrity boundary; no new orchestration step.
2. **Runner-inserted refresh implementation attempt after the fix.** Conforms
   to ADR-0017 unamended and the spawning machinery exists, but permanently
   costs an extra model attempt per refresh, needs a new contract signal and
   orchestration step, and re-derives context the fixer already had.
3. **Keep the escalation round trip.** Honest but wasteful: replanning and
   re-approval to change evidence prose is process cost with no integrity
   gain, and it retrains operators to reject honest findings.

## Consequences

Positive: stale-evidence findings resolve in one fix attempt; the reviewer's
"regenerate validated completion data" remedy becomes satisfiable by the phase
that receives it; the ledger's meaning sharpens to "validated evidence about
the current authorized implementation".

Negative and accepted: a mutable fix gains authoring rights over completion
evidence, relying on the shared validator rather than phase separation for
integrity — the same reliance implementation attempts always had; checkpoint
consumers must treat an absent `sourceAttemptKind` as `"implementation"`;
prompts and skills carry more contract text.

Unchanged: exactly one canonical ledger exists at a time; the runner never
writes report bytes; ADR-0017's revalidation schedule, grammar, field bounds,
escalation truth-channel, and fail-closed rejection semantics all stand.

## Compliance and Confirmation

- `executeFix` validates a non-null fix ledger with
  `validatePlanTaskCompletion` and persists the summary with
  `sourceAttemptKind: "fix"`, emitting `plan_task_completion.refreshed`.
- A rejected fix ledger records the failed attempt, writes the invalid
  checkpoint, and is offered the completion-evidence repair retry from
  `blockedFrom: "fixing"`.
- `summariesMatch` and revalidation treat absent `sourceAttemptKind` as
  `"implementation"`, keeping every pre-existing checkpoint valid.
- The fix prompt and `quick-fix` skill state the refresh contract and the
  unchanged escalation rule for status downgrades.
