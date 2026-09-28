# Code Design Guidance

Canonical portable guidance. The active execution context supplies artifact roles
and policies; entry, host transport and contract mechanics remain with the caller.

## Ownership Discovery

Find owners via manifest, symbols, callers and imports; read relevant bodies.
Before new helpers/rules, search by behavior/name. Cite matches or no-match scope
in one artifact line (chat if none). Search alone needs no full record/summary.
Record manifest conflicts, never proposed owners as facts.

## Assessment Contract

Under Engineering Quality `Structural Assessment Triggers`, group by reason to
change, collaborators, state, lifecycle and verification; prefer existing owners.
Give independent responsibilities explicit boundaries. Keep one implementation
owner per rule unless contract, dependency, lifecycle or compatibility requires
separation; name that constraint and divergence risk. Similar syntax is not proof.
Separate decisions from effects only with read timing, failures and ownership
preserved. Never widen shared mutable access or pass a whole coordinator merely
to split files. Compare decision-relevant alternatives.
Record in the caller's artifact:

- trigger, container, source evidence and reuse search;
- owner, collaborators, effects and dependency direction;
- disposition (`reused`, `extracted`, `retained`) and reason;
- ownership/reuse/effect invariants, verification and remaining debt;
- authority: within scope, needs decision/scope change, or undetermined.

For retention, explain boundary fit, added/avoided coupling or duplication and
why bounded extraction/reuse is less suitable. Small diff, passing tests or
precedent alone cannot justify it. Name constraints; never waive obligations.

## Planning Assessment

For triggered work, put invariants in the plan summary and binding tasks,
or in work/fix records with a pre-edit chat summary. Scope extraction and docs.
Use invariants, not layouts; lite records do not grant human approval.

## Implementation Assessment

Before triggered edits, assess or revalidate a prior assessment against source;
it is input, not approval. Reassess changed responsibilities, dependencies,
lifecycles or failed checks. Verify source against invariants and record results;
records or fewer lines prove no improvement. Refine within invariants; escalate
conflicts, never amend approved obligations.
