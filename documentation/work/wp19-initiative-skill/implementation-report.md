# WP19 implementation report

Status: report ready, not committed · Requirements:
[requirements.md](requirements.md) · Plan: [plan.md](plan.md) · Authority:
[ADR-0061](../../decisions/0061-initiative-skill-and-documents.md), which
amends [ADR-0054](../../decisions/0054-git-visible-work-artifacts.md),
[ADR-0041](../../decisions/0041-artifact-retention-and-publication-boundary.md)
and
[ADR-0036](../../decisions/0036-vendor-neutral-policy-files-and-instruction-delivery.md)

The owner approved the plan with `Both recommended`:

- Q1 (a): a subagent follows the source skill in disposable repositories, with
  no live vendor run;
- Q2 (a): the checkout-local publication hook copy is not changed.

## What changed

| Area                   | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Skill package (R1–R10) | New `plugins/banzai/skills/initiative/`. `SKILL.md` (220 lines): explicit-only frontmatter, the shared layout recognition block, no policies, the document root and roles, selection, the brief digest with CR-stripped SHA-256, the modes `start`, `next`, `record` and `gate`, follow-on `record`, read-only Git with validated tracker cells, and the report. `agents/openai.yaml` with `allow_implicit_invocation: false`. `references/brief-template.md` and `references/tracker-template.md`. |
| Release checks (R13)   | `check-release.mjs`: `initiative` joins the instruction-layout skill list with an empty policy row. Its `## Sources` must name the project root `AGENTS.md`, the availability boundary and the legacy diagnostic, and no `../../policies/<name>.md` line. The new `validateInitiativeSkill` (`INITIATIVE_SKILL_POLICY_DRIFT`) pins the frontmatter, the core rule fragments, the `openai.yaml` keys and the template line.                                                                          |
| Inventories (R13)      | `release-policy.json` requires the four skill files. `publication-policy.json` classifies them as `product` with `sha256: null`, and the ADR as `maintainer`.                                                                                                                                                                                                                                                                                                                                       |
| Template routing (R11) | One `## Routing` line in `plugins/banzai/AGENTS.md`, after the `project-manifest` entry. The fresh-adoption fixture `after/AGENTS.md` is a byte-identical copy; the other fixtures are unchanged.                                                                                                                                                                                                                                                                                                   |
| Publication (R12)      | `publication-check.mjs`: `initiativeDocument` (`^documentation/initiatives/<kebab slug>/<name>.md$`) joins the private-content scan and the source-tree exemption. The unanchored `documentation/initiatives/` joins the source-map and payload exclusions.                                                                                                                                                                                                                                         |
| Documentation (R15)    | `getting-started.md` gains "Multi-package initiatives"; `README.md` points to it; `plugins/banzai/documentation/README.md` shows the initiative tree and its rule. `orchestrator.md` now says "all eleven workflow skills". `PROJECT_MANIFEST.md`: twelve skills, the explicit-only list, the initiative root and its publication rule.                                                                                                                                                             |
| Acceptance bookkeeping | Already in the tree before implementation: ADR-0061, the reciprocal links on ADR-0054, ADR-0041 and ADR-0036, the exact ADR-0054 allow-list image in `phase-resources-build.mjs` with its test, and the index, manifest and tracker rows. At close-out ADR-0061 moves to Implemented, except the checkout-local hook reconciliation.                                                                                                                                                                |

Outside this change set: the whole `brief.md` diff of the program, and in its
`tracker.md` the WP20 row, the WP20 Gate 1 item and the WP20 owner decision.
They come from another session; the owner decides how they are committed.

## Tests

| Requirement | Proof                                                                                                                                                                                                                                                                                                                                                                   |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1, R2, R13 | `release-validation.test.ts`: one test per pinned fragment, removing every occurrence and expecting `INITIATIVE_SKILL_POLICY_DRIFT`; a policy read added to the skill's `## Sources`, a removed legacy stop, and a writing skill without its policy resolution line, each expecting `INSTRUCTION_LAYOUT_DRIFT`. `workflow-skills.test.ts`: the `initiative` matrix row. |
| R11         | `release-validation.test.ts` template fragments; `instruction-layouts.test.ts` fixture identity; `project-adoption.test.ts`.                                                                                                                                                                                                                                            |
| R12         | `publication.test.ts` "initiative documents are scanned source content excluded from payloads": a source pass, a private binding rejected, plugin and npm payloads rejected, a source map rejected, and a non-kebab directory, a nested file, a JSON file, a root file and other documentation still unclassified.                                                      |
| R3–R10, R16 | The T6 scenario below.                                                                                                                                                                                                                                                                                                                                                  |
| R14         | `git diff --stat HEAD` over `phase-guidance-current.json`, `src/`, `policies/`, `phases/`, `guidance/`, `hooks/`, `contracts/`, both `plugin.json` files and every other skill directory: empty.                                                                                                                                                                        |

## Scenario (T6)

A subagent read only the skill directory and followed it in two repositories
under the session scratchpad: an adopted one built from the packaged
templates, and a legacy one. It logged every Git command of every skill step
with `GIT_TRACE` and hashed the working tree around every read-only step.
Nothing in this repository was written.

The user's global settings deny `git commit`, also in scratch repositories.
The subagent did not work around the rule, so no scratch commit exists. Steps
that need commits used substitutes: an exclude file for the clean baseline, an
orphan linked worktree for the branch that holds `0003-x.md`, and hand-edited
`committed` rows.

| Acceptance item                                                    | Result  | Evidence                                                                                                                                                                        |
| ------------------------------------------------------------------ | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Selection with no initiative, and with two                         | Pass    | Reports none and asks; lists `p-one/` and `p-two/` and asks. Tree unchanged, no Git command.                                                                                    |
| `start` writes exactly two files; a second `start` is refused      | Pass    | `brief.md`, `tracker.md`; the name and link were replaced after the owner's answer; tracker digest equals the `node` and `tr \| shasum` digests; baseline "no commits".         |
| Package in a flat work directory with no initiative file           | Pass    | `documentation/work/p1-add-greeting/requirements.md` only.                                                                                                                      |
| `next` leaves the tree byte-identical                              | Pass    | Equal tree hashes before and after every `next`.                                                                                                                                |
| Resume, and a refused handoff with a change outside                | Partial | P1 resumed with `hello.txt` marked; a handoff refused while `stray.txt` existed. The candidate was P1, not P2, because P1 could not be committed.                               |
| `record` changes only its entry; follow-on `record`                | Pass    | One-line diffs for a status cell and an open question.                                                                                                                          |
| Edited brief and missing digest line block handoff until re-freeze | Pass    | Mismatch and missing line both stop `next`; a deviation `record` is refused; each re-freeze changes only the digest line and adds one owner decision.                           |
| Hostile cells are reported and never reach Git or the filesystem   | Pass    | `--output=x` and `../x` reported as invalid; the only Git commands were `status`; no `x` or `--output=x` file exists.                                                           |
| ADR reservation skips an ID found elsewhere                        | Partial | 0004 taken because `0003-x.md` exists in a linked worktree. The branch path (`ls-tree` on a ref) was not exercised, since no ref exists without commits.                        |
| Later stage held until the gate decision; `gate` refuses a rewrite | Partial | P3 held with a `gate 1` hint; `gate-1-report.md` written with the tracker byte-equal; a second `gate 1` refused; P3 handed off after the decision. Rows were committed by hand. |
| Legacy layout stops with the diagnostic                            | Pass    | `next` and `start` print "legacy Banzai layout: run `project-manifest` to migrate"; tree unchanged, no Git command.                                                             |
| No staging or commit by the skill                                  | Pass    | Union of skill Git commands: `status`, `rev-parse`, `cat-file -e`, `log`, `ls-tree`, `for-each-ref`, `worktree list`. Empty index.                                              |

The subagent listed 20 places where it had to interpret the text. These skill
edits followed before close-out:

- the digest check runs after the layout check, skips `start`, and on a
  mismatch reports only that; a re-freeze writes a missing digest line after
  the status line;
- `start` places the frozen-input note after the title and date lines, applies
  the redaction answer and nothing else, quotes the approval only in the
  tracker, and derives a row's work directory from the package ID and title
  when the brief names none;
- a slug must be unused under both `documentation/initiatives/` and
  `documentation/work/`;
- `next` uses `git status --porcelain --untracked-files=all`, since the default
  output folds untracked directories; flags only non-empty commit cells and
  `committed` rows without a commit; treats a row as committed by its status;
  reports invalid cells; and never hands off a package whose own cells fail;
- the route also counts an ADR reservation for the package;
- `record` refuses the whole entry for an unreachable commit, asks about names
  only when the words contain them, records reservations as
  `Reserved, <date>` with the branch and worktree sources spelled out, gives
  the gate report-line format, ticks only the items the owner passes, and
  updates the status line's `Updated` date;
- follow-on `record` waits for the skill that runs the package;
- the `gate` report has a defined table;
- the `-` rule applies to values from cells and arguments, not to the skill's
  own Git options.

Left as written: `git status` may refresh the stat cache in `.git/index`; that
does not change the working tree or the staged content.

## Checks

All run on 2026-11-05. The candidate check ran before the close-out status
edits; `release:validate` and `release-validation.test.ts` were rerun after
them.

| Command                                                                  | Result                                                                                                                                                                     |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run verify`                                                         | Pass: typecheck clean; lint 0 errors (426 warnings, as before); 2043 of 2043 tests; `build:check`.                                                                         |
| `npm run format:check`; `prettier --check` on the changed root documents | Pass.                                                                                                                                                                      |
| `release-validation`, `workflow-skills` after the final skill text       | 208 of 208; 13 of 13.                                                                                                                                                      |
| `publication`, `instruction-layouts`, `project-adoption`                 | 6 of 6; 2 of 2; 37 of 37.                                                                                                                                                  |
| `npm run release:validate`                                               | Only the deferred `HOOK_CHANGED_WITHOUT_VERSION_BUMP`.                                                                                                                     |
| `node packages/orchestrator/scripts/release-candidate-check.mjs`         | Pass in a disposable copy with its own index: 2043 of 2043 tests, release check, publication and committed smoke; run with the two local links set aside (see Deviations). |

## Deviations from the plan

- **Git commands (R10).** The allowed list adds `merge-base --is-ancestor`
  for the reachable-from-`HEAD` check. `next` runs `status` with
  `--untracked-files=all`, and the reservation scan reads branches with
  `ls-tree --name-only <ref> documentation/decisions/`.
- **Fragment tests.** Several pinned fragments occur twice in the skill (the
  description and the body), and the check accepts a fragment anywhere, so
  each test removes every occurrence.
- **Local build.** `release-policy.json` is bundled into the ignored
  `packages/orchestrator/dist/`, so `publication.test.ts` needed a local
  `npm run build` after the inventory change. No tracked file changed.
- **Skill length.** The text reached 220 lines after the scenario
  clarifications, at the plan's target.
- **Scenario coverage.** Three Acceptance items are partial because commits
  are denied; see Follow-ups.
- **Candidate check environment.** `release-candidate-check.mjs` first stopped
  with `UNSUPPORTED_WORKSPACE_LINK` on `node_modules/.bin/banzai`, which
  targets the ignored `dist/`. As in the 2.7.4 release, both local links
  (`node_modules/.bin/banzai` and the dangling `node_modules/node_modules`)
  were set aside for the run and restored to their exact targets afterwards.
- **Lint.** The advisory complexity warnings on `validateInstructionLayout`,
  `scanContents` and `inspectPublicationFiles` predate WP19; the warning count
  is unchanged.

## Follow-ups

- **Q2 (a).** Refresh the checkout-local publication hook copy on the owner's
  request before the first initiative document is pushed.
- **Commit-dependent scenario steps.** A real resume-then-handoff of the next
  package, the branch path of the reservation scan, and commit cells checked
  against real history need commits. The live Gate 1 check with the installed
  2.8 plugin can cover them, or the owner can make the harness commits.
- **This program's tracker.** Before the skill writes to
  `documentation/work/release-2-8-2-9-program/tracker.md`, the owner records a
  re-freeze decision; until then `next` reports the missing digest line.
- **Candidate check and the ignored distribution.**
  `release-candidate-check.mjs` refuses the workspace link that targets the
  ignored `dist/` since ADR-0056. A quick fix can teach it to skip or build
  that target.
