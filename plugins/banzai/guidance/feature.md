# Feature Guidance

Canonical portable guidance. The active execution context supplies artifact roles
and policies; entry, host transport and contract mechanics remain with the caller.

## Workflow

1. Read relevant code, tests, docs, existing artifacts, and manifest sections.
3. Ask only blocking questions. Record local default decisions with reason and
   provenance.
4. Identify relevant active ADRs and apply the ADR eligibility check.
5. Create/update the resolved `work` artifact.
7. Apply the Engineering Quality authority order and only constraints material
   to the changed surface. Keep the change bounded and use the smallest
   compatible repository mechanism, meaning the simplest compatible resulting
   design rather than the smallest diff; do not add a checklist or methodology.
   When a structural assessment trigger applies, apply the code-design
   guidance, show a brief pre-edit chat summary of owner, boundary,
   dependencies and disposition as visibility rather than an approval request,
   and record the assessment in `work.md`.
8. Implement code and proportionate assurance evidence together under the Test
   Assurance policy (`test-assurance.md`) supplied by the active execution context. Every material claim needs an identifiable
   existing evidence owner, but Engineering Quality does not select tests.
9. Run focused affected checks. In orchestrated mode, do not repeat supplied
   full-scope runner commands; run the manifest's applicable final suite once
   only when it is absent from that block and record the gap. In standalone mode,
   run one final applicable suite after the work stabilizes unless the shared
   deterministic owner establishes a permitted equivalent disposition under Test
   Assurance. Unsupported evidence retains fresh execution.
10. Self-review for correctness, applicable Engineering Quality constraints,
    missing material evidence, ADR conformance, async/concurrency, doc drift,
    and scope creep.
11. After code stabilizes, run formatter check/fix if configured. If it
    rewrites files, rerun affected checks.
12. Update `work.md` and manifest if stale. Change only the manifest facts this
    work made stale, under the `project-manifest` writing rules; verification
    results and delivery narrative stay in `work.md`. Record only material
    Engineering Quality deviations in the existing **Deviations & Follow-ups**
    section.

## `work.md`

Write these sections:

1. `# Feature: <Name>` and `Slug: <slug>`.
2. **Related artifacts**: include relevant accepted ADRs or `None`.
3. **Goal**: capability, value, explicit non-goals.
4. **Requirements**: numbered `FR1`, `FR2`; each concrete and verifiable.
5. **Assumptions & Decisions**: numbered, tagged `User-confirmed`,
   `Sensible default`, or `Manifest convention`; exclude ADR-eligible choices.
   Include one line per applicable security exposure class naming its mechanism
   and the requirement covering it, or one line stating that none applies.
6. **Implementation Plan**: ordered bullets naming units, materially changed
   boundaries or dependency/lifecycle/compatibility constraints when present,
   assurance evidence owners, any structural assessment record or reuse-search
   citation, and manifest follow-up. Do not add a per-rule checklist.
7. **Files Changed**: production, tests, docs/config; one-line reason each.
8. **Verification**: commands, outcomes, and FR-to-implementation/assurance
   mapping.
9. **Deviations & Follow-ups**: deviations, limits, or `None`.

## Rules

- Keep `work.md` compact. Escalate if requirements or plan outgrow it.
- Do not duplicate ADR context or rationale in `work.md`; link the decision.
- Tests must be able to fail for real behavior.
- No hollow tests.
- Do not add a test solely for count, coverage percentage, a private branch, or
  a helper. Existing evidence or no new test is valid when proportionate and
  recorded accurately.
- No new dependency without approval and manifest update.
- Comment sparingly and with high signal. Write a comment only to explain why:
  a constraint, trade-off, invariant, side effect, or non-obvious behavior. Do
  not narrate what the code visibly does.
