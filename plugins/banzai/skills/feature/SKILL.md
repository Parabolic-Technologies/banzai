---
name: feature
description: Lite workflow for new work with no escalation trigger. Creates work.md, implements code/tests, verifies, and reports. Use for new capabilities unless strict mode or a trigger applies. Auto-select only in a Banzai-adopted repository (root PROJECT_MANIFEST.md or .banzai/) or by name.
user-invocable: true
---

# feature

Use for new capabilities with no escalation trigger.

Inputs: user request, `AGENTS.md`, `PROJECT_MANIFEST.md`, active accepted ADRs,
relevant code/docs.
Output: source/test changes plus `documentation/features/<slug>/work.md`.

Apply the canonical Engineering Quality policy in the installed
`policies/engineering-quality.md`; this skill adds
only lite-feature responsibilities and does not copy its rule set.

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
  assembled it into this session. Before lite discovery or implementation,
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
   - `artifact-storage.md` before resolving, reading or writing work artifacts.

## Orchestrated Mode

A legacy or partial layout returns `outcome=needs_human_decision`,
`gate=escalation`, the layout diagnostic as `summary`, one question naming
the migration step, and no source change.

When the runner supplies `BANZAI_RUN_ID`, `BANZAI_WORKFLOW_DIGEST`, and a
versioned phase-result schema, this is an automatically selected lite route.
Follow the normal preconditions and stop gate, then return
`phase=implementation`. On an escalation trigger, make no source changes and
return `outcome=needs_human_decision` with `gate=escalation` and exact
questions. The runner records the answer and selects the workflow again.

Use `contracts/v3/phase-result.schema.json` and return `taskCompletion: null`
and `decisionConsultation: null`; lite work has no approved strict plan task set
and cannot use the planning-only consultation gate.

Return `outcome=completed` with `gate=null` after the feature report is
complete. The runner owns its configured deterministic verification and ends
the route after it passes; do not invoke `feature-review`.

## Preconditions

- Read `PROJECT_MANIFEST.md`.
- Read active accepted ADRs relevant to the touched architecture or contracts.
- If the manifest is missing or skeletal, ask the user to run
  `project-manifest` by name (`/` or `$`) first unless they asked for
  exploration; it is explicit-invocation-only and cannot be selected here.
- If the user asked for strict mode, route to `feature-description`.

## Stop Gate

Before source/code changes, check `AGENTS.md` escalation triggers. If one
applies:

1. Write/present the `work.md` plan.
2. Name the trigger.
3. Apply ADR eligibility from `AGENTS.md`.
4. If ADR-eligible, route to `feature-description` and then
   `architecture-decision`; lite implementation cannot continue.
5. Otherwise wait for explicit user approval.

Do not add dependencies, change public contracts, alter persistence, or make
security/privacy-sensitive choices without approval.

Apply the Security Assurance policy in the installed
`policies/security-assurance.md`. Introducing or widening a
security control is a trigger and follows the steps above. Complying with an
already established, unchanged control is not: record the class in `work.md`
and continue.

## Workflow

1. Read relevant code, tests, docs, existing artifacts, and manifest sections.
2. Pick a short kebab-case slug.
3. Ask only blocking questions. Record local default decisions with reason and
   provenance.
4. Identify relevant active ADRs and apply the ADR eligibility check.
5. Create/update `documentation/features/<slug>/work.md`.
6. Apply the stop gate.
7. Apply the Engineering Quality authority order and only constraints material
   to the changed surface. Keep the change bounded and use the smallest
   compatible repository mechanism; do not add a checklist or methodology.
8. Implement code and proportionate assurance evidence together under the Test
   Assurance policy in the installed
   `policies/test-assurance.md`. Every material claim needs an identifiable
   existing evidence owner, but Engineering Quality does not select tests.
9. Run focused affected checks. In orchestrated mode, do not repeat supplied
   full-scope runner commands; run the manifest's applicable final suite once
   only when it is absent from that block and record the gap. In standalone mode,
   run one final applicable suite after the work stabilizes.
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
13. Report changed paths, verification outcomes, deviations, and follow-ups. The
    stop gate above is the only place this skill waits.

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
   assurance evidence owners, and manifest follow-up. Do not add a per-rule
   checklist.
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
