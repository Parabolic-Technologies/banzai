# WP3 · Verification commands at the plan gate

Status: in progress · Program:
[banzai 2.8–2.9](../release-2-8-2-9-program/tracker.md) · Source:
[brief, WP3](../release-2-8-2-9-program/brief.md#wp3--verification-commands-at-the-plan-gate-taken-from-documented-commands)

## Problem

The plan gate prints artifact paths and human prerequisites only. Mandatory
checks sit in the `banzai-verification-obligations/v2` JSON block of plan.md,
so a planned command that drops the project's config flag goes unnoticed until
verification fails after implementation. The planner already receives inert
project discovery with `npm run` and `composer run-script` entry points, but no
rule asks an obligation to use the project's documented command.

## Authority

No new ADR. ADR-0049 §2 already requires mandatory checks to be readable in
plan review and binds them to the approved plan; it is the authority for the
instruction change, recorded as an ADR-0044 instruction-baseline transition.
The display is a read-only projection of the plan bytes under approval and
changes no approval, digest or execution rule.

## Requirements

- **R1 · Plan gate list.** When a strict task-verification run waits for plan
  approval, the interactive session prints "Verification that gates
  completion" before the plan decision: one entry per check of the plan's v2
  inventory, followed by checks the project policy requires. Each entry shows
  the check id, whether it is required (and when the project policy, not the
  plan, requires it), the requirement references, the working directory, the
  timeout, the task that creates its tooling when the check carries a
  materialization, and the argv as one copyable line.
- **R2 · Status.** `banzai status` and the state printed after a CLI command
  show the same list while the run waits for plan approval.
- **R3 · Empty and unreadable inventories.** An empty inventory shows its
  absence rationale. An inventory that cannot be parsed or selected (missing
  block, digest mismatch, conflicting policy identity) shows the same error
  that approval would raise, without blocking the view.
- **R4 · Safe display.** Every displayed value comes from model-authored plan
  bytes and is terminal-escaped. Argv words are shell-quoted only when a POSIX
  shell would split or expand them.
- **R5 · Read-only.** Building the list reads the plan and configuration only;
  it changes no run state, approval, event or `banzai status --json` output.
- **R6 · Documented commands rule.** The canonical policy (Plan Authority and
  Task Completion, "Task verification obligations") and the runner's planning
  instruction ask each obligation to be built from the project's documented
  command for that check (manifest, `composer.json` or `package.json` scripts,
  Makefile, CI) with its configuration flags, to prefer the discovered script
  entry point (`composer run-script <name>`, `npm run <name>`) when one exists,
  and to cite the documenting file in `sources`. The rule builds on the
  existing inert discovery and does not duplicate it.
- **R7 · Instruction transition.** The policy change goes through an ADR-0044
  instruction-baseline transition citing ADR-0049; the planning prompt change
  updates the golden prompt digests.
- **R8 · Eval case.** The tracker records the WP15 eval case for R6.

## Acceptance

- On the phpcs fixture at the plan gate, the interactive session and
  `banzai status` list both required checks with argv, directory and timeout,
  so the missing `--config` flag is visible before approval.
- A materialized check names its task; an empty inventory shows its rationale;
  a digest mismatch shows the approval error.
- Control and bidi characters in plan-authored values are escaped.
- The instruction baseline transition validates and the golden prompt tests
  pass with the new digests.
- `npm run verify` and `npm run format:check` pass.

## Out of scope

- Correcting a mandatory command after approval (WP9) and running checks
  before implementation (WP10).
- Re-checking human plan edits and recomputing the plan digest (WP4).
- A `banzai control` or `status --json` projection of the inventory.
