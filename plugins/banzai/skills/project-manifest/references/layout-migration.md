# Instruction layout migration

## Recognition

Before the first affected responsibility, inspect the project root instruction
layout on either host. A filename alone does not establish a process source.

- `target`: `AGENTS.md` exists, contains `## Authority` and `## Policies`,
  contains no line beginning with `@`, and the `CLAUDE.md` shim is absent or
  contains none of these policy headings: `## Decision Consultation`,
  `## Test Assurance`, `## Security Assurance`, `## Engineering Quality`,
  `## Plan Task Completion Evidence`.
- `legacy`: the legacy `CLAUDE.md` contains `## Engineering Quality`, and
  `AGENTS.md` is absent or contains no `## Authority` heading.
- `unadopted`: neither instruction file contains `## Authority` or any of the
  five policy headings. Existing missing-manifest behavior applies unchanged.
- `partial`: every other combination, including an unreadable file. Report
  missing sections, conflicting full sources or interrupted migration exactly;
  do not guess precedence or reconstruct rules.

Skip this recognition rule only under the Source Repository Exception below;
the same predicate controls scaffold skipping. Packaged files are product source.
Missing installed policy access on a target layout stops the affected work;
it never permits using an obsolete local copy.

## Source Repository Exception

Use one source identity predicate at the discovered Git root for both scaffold
skipping and instruction-layout recognition skipping. Either complete topology
qualifies:

- **Plugin root:** at least one of `.claude-plugin/plugin.json` and
  `.codex-plugin/plugin.json` exists; every present file is a readable JSON
  object with `name: "banzai"`. Conflicting metadata does not qualify.
- **Source workspace:** root `package.json` has
  `name: "banzai-spec-driven-dev"`, `private: true`, and an array `workspaces`
  containing `packages/*`; `.claude-plugin/marketplace.json` has exactly one
  plugin entry named `banzai` with `source: "./plugins/banzai"`; both
  `plugins/banzai/.claude-plugin/plugin.json` and
  `plugins/banzai/.codex-plugin/plugin.json` are readable JSON objects with
  `name: "banzai"`.

Inspect only these fixed metadata paths. Missing or nonmatching metadata grants
no exception; unsafe, unreadable or conflicting identity evidence needs
attention. A directory name, remote URL, external installed cache or marketplace
name alone never grants it. Packaged templates remain product source; runtime
readiness still requires a populated root `PROJECT_MANIFEST.md` and readable
root `AGENTS.md`. The exception also applies to layout-only continuation checks.

## Diagnostic

On a legacy layout report exactly:

legacy Banzai layout: run `project-manifest` to migrate

Ask the user to run the explicit-only `project-manifest` skill. Ordinary skills
stop before affected work and read neither legacy project policy bodies nor
installed replacements as applicable rules. A partial layout instead reports
the exact ambiguity and stops without source changes. Name the last compatible
release below as information only; never pin, install or downgrade a plugin.

## CLI Preflight

Before a new run, Banzai requires a populated root manifest and this supported
instruction layout. Before a published run's next model invocation it rechecks
only instruction layout, including the Source Repository Exception; the run's
own manifest edits do not cause a mid-run refusal. The stable unfilled scaffold
marker before the first heading is a new-start prerequisite only.

`PROJECT_SETUP_REQUIRED` is a non-mutating refusal. It preserves decisions,
triage, the last durable checkpoint and original retry/recovery eligibility;
it creates no failed attempt or usage. Repair or explicitly migrate instruction
files manually, inspect status and follow the existing resume/retry/recovery
route. Alternatively, explicitly cancel the run before `banzai setup`.
Do not resubmit a saved decision. A supervisor stops its automatic loop on this
error and relays the remedy; an unchanged `nextAction: "resume"` is not a
readiness certificate. The ordinary skill-result routes below still apply if
the skill itself finds unavailable policies or semantic migration problems.

## Orchestrated Route

| Phase                  | Existing result and fields                                                                                                                     | Human continuation                                                                       | Existing runner effect                                                                                                                    |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Workflow selection     | Read-only selection after runtime layout preflight                                                                                                            | None at selection                                                                        | Runtime and affected skills retain their respective checks                                                                                                    |
| Planning               | `phase-result/v3`: `outcome=needs_human_decision`, `gate=escalation`, diagnostic as `summary`, one question naming migration, no source change | Explicit migration, then the current user's answer through the existing decision command | Clears plan approval; strict returns to planning and lite to selection; approve the resulting plan again                                  |
| Implementation         | Same escalation result before source change                                                                                                    | Same migration and answer route                                                          | Same approval reset and planning or selection route                                                                                       |
| Fix                    | Same escalation result before source change                                                                                                    | Same migration and answer route                                                          | Same approval reset and planning or selection route                                                                                       |
| Review or review retry | `review-result/v1`: `verdict=blocked`, diagnostic as `summary`, `findings=[]`; no `gate` field                                                 | Explicit migration, then `banzai retry`                                                  | Blocked from `reviewing`, retry eligible; fresh reviewer with `previous-review-blocked`; approval, triage and completion remain unchanged |
| Supervisor             | Relay the escalation question or blocked/retry state verbatim through the existing control protocol                                            | Send only the current user's exact answer or retry decision                              | Never migrate, run `project-manifest`, or edit files                                                                                      |

Never use `outcome=blocked` for a writing-phase layout stop: that completed
attempt is not retryable. Cancellation, a new run, `retry`, `recover` and an
answer grant no migration authority. The next affected phase checks again and
an unmigrated project stops again with the same diagnostic.

## Bootstrap Source Rule

On legacy and partial layouts, the bootstrap source rule exempts exactly
`project-manifest` for migration and `feature-status` for read-only reporting.
Take process text from the installed plugin's packaged `AGENTS.md`
(`../../AGENTS.md` from the installed `SKILL.md`) and matrix-selected policies
from `../../policies/`. Resolve paths from the installed skill, never the
working directory or a fixed cache location. Stop if an installed source is
absent or unreadable.

Project files are inputs to the migration diff or status report only. Legacy
Banzai text is merge evidence, never an applicable policy. Approved user and
project decisions recorded there retain their existing higher authority.
No other skill, phase or supervisor receives this exemption.

## Migration Diff

When explicitly invoked, prepare one concrete diff before writing any project
instruction file:

1. Read the installed packaged `AGENTS.md` and the applicable installed
   policies. This is the process source for the proposed migration.
2. Read all existing project instruction files as migration inputs. Record
   their exact bytes so a decline leaves them unchanged.
3. Identify the Banzai process sections and five policy bodies to remove from
   the legacy `CLAUDE.md` migration input. Preserve user-approved decisions;
   do not treat edited or ambiguous text as disposable boilerplate.
4. Classify every remaining non-Banzai line with the user. Shared project rules
   apply to every agent and belong under `## Project Rules` at the end of
   `AGENTS.md`, under their existing authority. Only content the user confirms
   as host-specific may remain below `@AGENTS.md` in the `CLAUDE.md` shim.
5. Render the complete proposed `AGENTS.md` and `CLAUDE.md` migration diff:
   packaged process and policy index plus retained shared rules, and the shim
   plus confirmed host-specific notes. Copy no policy body into the project.
6. Present all conflicts between retained rules and packaged process text,
   and every unclassified line. Resolve them with the user before applying;
   nothing is silently dropped, duplicated or assigned weaker authority.
7. Apply only after approval of this single concrete diff. Apply only the
   approved edits, then reread both files and verify the target layout.
8. Report the changed paths, retained classifications, layout and any gap.
   Migration does not authorize a version change or resume workflow work.

## Declined, Partial and Interrupted

A declined migration leaves every project file byte-identical and the updated
plugin installed. Affected work remains stopped with the legacy diagnostic.
No release is pinned, installed or downgraded. A user-managed rollback is a
separate decision.

An interrupted or partially applied migration is `partial`, never completed.
Explicitly invoked `project-manifest` may propose a single approved diff to
complete or revert it under the bootstrap source rule. `feature-status` reports
the partial state without writing. Conflicts must be resolved before applying
even when structural recognition alone resembles a target layout.

## Cases

These fixtures document expected instructions and contracts, not model
compliance or measured host delivery.

| Fixture                  | Layout    | Required behavior                                                       | Expected files                                                                |
| ------------------------ | --------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| fresh-adoption           | unadopted | Existing explicit scaffold, never overwrite; no copied policies         | Packaged process and exact shim                                               |
| approved-migration       | legacy    | Propose one diff, apply only after approval                             | Target process and shim                                                       |
| update-without-migration | legacy    | Stop with the diagnostic; do not write                                  | Original project files                                                        |
| absent-agents-legacy     | legacy    | Stop affected work; explicit migrator may propose creating process file | Approved target pair                                                          |
| interrupted-migration    | partial   | Migrator proposes completion or revert; status reports partial          | Approved target pair after completion                                         |
| declined-migration       | legacy    | Keep files byte-identical and updated plugin installed; remain stopped  | Before and after identical                                                    |
| custom-content-migration | legacy    | Classify shared restriction and host-specific note in one approved diff | Restriction in `AGENTS.md` only; note below `@AGENTS.md` in shim; no policies |
| custom-conflict          | partial   | Report conflict with packaged Git rules; await resolution               | No applied migration                                                          |
| missing-policy           | target    | Stop on unavailable installed policy; never use a local fallback        | Project files unchanged                                                       |

- Last legacy-compatible release: `1.21.0`
