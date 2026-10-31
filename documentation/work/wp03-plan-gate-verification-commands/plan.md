# WP3 plan

Requirements: [requirements.md](requirements.md).

## Approach

The plan under approval already holds every fact R1 needs. A runner method
parses its v2 inventory with the same parser and selection that verification
uses, so the list shows exactly what approval binds and verification will run.
The human renderers call it only at the plan gate; `status()` and
`status --json` stay unchanged.

## Tasks

1. **Runner projection.** Add `WorkflowRunner.planVerificationInventory(state)`
   in `workflow.ts`: for a strict task-verification run at
   `needs_plan_approval`, parse the plan with `parseTaskVerificationObligations`,
   merge the project policy through `selectTaskVerification`, and return the
   ordered checks with their origin (plan or policy) and the absence rationale.
   A parse or selection error returns its message. Other states return `null`.
2. **Lines.** Add `planVerificationLines(inventory)` in `verification-ui.ts`
   next to `verificationCommandLines`, reusing the WP1 shell quoting and
   duration formatting.
3. **Renderers.** Interactive: an optional `InteractiveRunner` method, called
   by the loop and rendered as a preformatted section after the artifacts.
   CLI: `printState` gains the inventory; `banzai status` and the post-command
   state load it.
4. **Instruction text.** Add the documented-command rule to "Task verification
   obligations" in `plugins/banzai/policies/plan-task-completion.md` and one
   sentence to the planning instruction in `prompts.ts`. Rebuild phase
   resources, record the ADR-0044 transition with
   `scripts/instruction-baseline.mjs` citing ADR-0049, and update the golden
   prompt digests.
5. **Fixture and tests.** Split the phpcs fixture so it can stop at the plan
   gate. Test the interactive list, `banzai status` (built CLI), unchanged
   `status --json`, a materialized check, an empty inventory, a digest
   mismatch, a policy-required check and escaping.
6. **Docs.** `documentation/orchestrator.md` (plan gate),
   `documentation/getting-started.md` if the plan gate is described there,
   `packages/orchestrator/MODULES.md`, `PROJECT_MANIFEST.md` if a current fact
   changes, tracker row, WP15 eval case and report.

## Checks

Focused: `node packages/orchestrator/scripts/test.mjs --file <file>` for the
touched suites. Final: `npm run verify`, `npm run format:check`.
`npm run release:check` is not needed unless a release, version or
instruction-layout file changes.
