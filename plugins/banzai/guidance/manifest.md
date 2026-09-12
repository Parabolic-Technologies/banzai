# Manifest Guidance

Canonical portable guidance. The active execution context supplies artifact roles
and policies; entry, host transport and contract mechanics remain with the caller.

## Maintenance

Run after changes to:

- architecture;
- modules/components;
- build/config settings;
- environment keys;
- dependencies;
- conventions;
- implementation or supersession of an accepted ADR.

## Required Sections

Keep these headings in order:

1. **Project Overview**
2. **Platform & Tooling**
3. **Architecture**
4. **Project Structure**
5. **Key Modules & Components**
6. **State & Data Flow**
7. **Dependencies**
8. **Testing**
9. **Conventions**
10. **Technical Constraints & Decision Index**

Write `None` with a reason when a section is empty.

## Writing Rules

- Record facts, not preferences.
- Quote config keys, target names, and versions exactly.
- State the operational effect of load-bearing current constraints; keep their
  trade-offs in ADRs.
- Use concise present-tense bullets: one current fact per bullet. When a fact
  changes, rewrite its bullet; do not append the new state after the old one.
- Do not include code in the manifest.
- Keep ADR rationale, alternatives, consequences, and history out of the
  manifest; link the active accepted ADR instead.
- Keep the manifest current-state only. Implementation history, release
  narrative, per-change delivery summaries, and past verification results
  belong in ADRs, feature reports, and change records; link them, do not
  restate them.
- Keep the whole manifest readable in one pass; every skill loads it before
  work. When a section outgrows a few screens, move detail to a linked
  maintainer reference instead of growing the manifest.
- In **Key Modules & Components**, give each unit one bullet: path, role,
  public interface or contract, and the load-bearing invariant. Keep
  step-by-step behavior, edge-case narratives, and rendering detail in source,
  tests, or a linked maintainer reference.
- In **Decision Index**, keep one row per active accepted ADR with ID, title,
  path, and `Planned`/`Implemented` state. Link the decision log for rejected
  and superseded records; add no per-ADR delivery prose.
- Keep section 9 limited to repository-specific conventions supported by
  configuration, approved guidance, or dominant evidence. Do not insert generic
  function-size, decomposition, abstraction, control-flow, comment, naming,
  directory, or pattern preferences.
- In **Testing**, record the current assurance priorities, allowed test-double
  boundaries, final-suite owner, and explicit coverage threshold or `None` as
  project facts rather than universal preferences. Record the required suite
  and at most the latest recorded result; per-change test counts and covered
  guarantees stay in feature test reports.

## Checklist

- Replace `Recommended (not yet present)` once code exists.
- Update modules for added/renamed/removed units.
- Add approved dependencies.
- Add new build/config/env/resource facts.
- Keep active ADR links and `Planned`/`Implemented` states current.
- Report, rather than hide, a difference between current manifest facts and
  accepted ADR intent.
- Re-read every section and remove stale claims.

