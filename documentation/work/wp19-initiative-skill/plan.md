# WP19 plan

Status: approved on 2026-11-05 with `Both recommended` · Requirements:
[requirements.md](requirements.md) · Authority:
[ADR-0061](../../decisions/0061-initiative-skill-and-documents.md)

WP19 is one change set with one report,
`documentation/work/wp19-initiative-skill/implementation-report.md`. The owner
commits by hand. WP20 starts after this commit, because both packages edit the
`AGENTS.md` template and its fixture.

The working tree already holds the WP19 acceptance changes:

- ADR-0061;
- its reciprocal links on ADR-0054, ADR-0041 and ADR-0036;
- the ADR-0054 allow-list image and its test;
- the index, manifest and publication rows;
- tracker entries.

It also holds another session's WP20 additions, which are not part of WP19:

- the whole `brief.md` diff;
- in `tracker.md`, the WP20 row, the WP20 Gate 1 item and the 2026-11-05 WP20
  owner decision.

This plan does not touch them. The owner decides whether they are committed
with WP19 or separately.

## Approach

The skill is prose, so its guarantees come from three places:

- release checks that pin its frontmatter and core rule fragments;
- publication checks for the new document root;
- a scripted scenario that follows the skill in a disposable repository
  (Q1).

Tests come first: each check is written and seen failing before the file it
guards exists.

The skill text stays short. Mode rules live in `SKILL.md`. Document shapes live
in two reference templates that are read only by `start`, and by `record` when
it needs a section's shape.

Runner source, contracts, pinned instructions and the other skills stay
byte-identical (R14). The only changes outside the new skill directory are:

- `check-release.mjs` and `publication-check.mjs`;
- the two inventories (`release-policy.json`, `publication-policy.json`);
- the template line and its fixture copy;
- the documentation pages and the manifest.

## Tasks

### T1 · Release checks for the new skill (R13)

- `packages/orchestrator/scripts/check-release.mjs`:
  - add `initiative` to the `validateInstructionLayout` skill list;
  - for `initiative`, the only skill other than `orchestrate` whose policy
    row is empty, require the project root `AGENTS.md`, the word "unreadable" and the legacy
    diagnostic in `## Sources`, and no policy name and no
    `../../policies/<name>.md` line;
  - add `validateInitiativeSkill`, modelled on `validateOrchestrateSkill`,
    with code `INITIATIVE_SKILL_POLICY_DRIFT`:
    - frontmatter: `name: initiative`, `user-invocable: true`,
      `disable-model-invocation: true`;
    - rule fragments: explicit invocation only, never stage, commit or push,
      never run the `banzai` CLI or invoke `orchestrate`, `next` writes
      nothing, the re-freeze exception, `documentation/initiatives/<slug>/`,
      and the refusal to overwrite;
    - `openai.yaml`: `display_name: "Banzai Initiative"`,
      `default_prompt: "Use $banzai:initiative`,
      `allow_implicit_invocation: false`;
    - the template routing fragment in `plugins/banzai/AGENTS.md`;
  - call it beside `validateOrchestrateSkill`.
- `packages/orchestrator/test/release-validation.test.ts`:
  - add tests that remove each required fragment and expect
    `INITIATIVE_SKILL_POLICY_DRIFT`;
  - add tests that add a policy read to the skill's `## Sources` and that drop
    the legacy diagnostic, each expecting `INSTRUCTION_LAYOUT_DRIFT`.
- `packages/orchestrator/test/workflow-skills.test.ts`: add the `initiative`
  row to `EXPECTED_POLICY_READS`, with a branch that expects no policy, the
  legacy diagnostic and no escalation wording.
- `release-policy.json`: add `plugins/banzai/skills/initiative/SKILL.md`,
  `agents/openai.yaml` and both reference files to `plugin.requiredPaths`.
- `publication-policy.json`: classify the four files as `product`, with
  `sha256: null`.

### T2 · Skill package (R1–R10)

- `plugins/banzai/skills/initiative/SKILL.md`. Sections, in order:
  - frontmatter;
  - purpose and the explicit-invocation rule;
  - `## Sources`: the layout recognition block copied from the other writing
    skills, the project root `AGENTS.md` and its availability boundary, and no
    policies;
  - `## Documents`: the root, the three roles, slug rules, no other files, and
    no initiative file in a work directory;
  - `## Selection`;
  - `## Brief digest`: SHA-256 of the bytes with carriage returns removed.
    It tries `node -e` with `crypto`, then `tr -d '\r' < brief.md` piped to
    `sha256sum` or `shasum -a 256`, and stops when none works;
  - one section per mode: `start`, `next`, `record`, `gate`. `gate` runs
    no project command;
  - `## Follow-on record`;
  - `## Authority and Git`: the allowed read-only Git commands, no fetch, no
    staging, commit or push, no CLI or `orchestrate`, no approval;
  - `## Tracker input`: validation before any Git or path use. A commit is
    accepted only as 7–64 lowercase hex characters and confirmed with
    `git cat-file -e <id>^{commit}`, a work directory only under the slug
    rules, and nothing that starts with `-` reaches Git. Paths stay inside the
    repository. No minimum Git version is assumed, so `--end-of-options` is
    not used;
  - `## Report`: what each mode prints.

  Target: under 220 lines. It must avoid the stale `CLAUDE.md` reference
  patterns and the bootstrap-exemption wording that the layout scan rejects.

- `plugins/banzai/skills/initiative/agents/openai.yaml`.
- `plugins/banzai/skills/initiative/references/brief-template.md`:
  - frozen-input note;
  - goal and context;
  - decisions already made;
  - plan at a glance;
  - one section per stage, holding packages with "Where", "Change" and "Done
    when", and the gate;
  - out of scope.
- `plugins/banzai/skills/initiative/references/tracker-template.md`:
  - status and digest lines;
  - "How to use this tracker";
  - baseline;
  - one table per stage with the R7 columns, and a gate list with its report
    line;
  - ADR reservations;
  - owner decisions;
  - open questions;
  - deviations from the brief.

  Section names match the program tracker.

### T3 · Template routing line (R11)

- Add the R11 line to `## Routing` in `plugins/banzai/AGENTS.md`, after the
  `project-manifest` entry. It must not mention `CLAUDE.md` or a gate count.
- Copy the template byte for byte to the fresh-adoption fixture `after/`, and
  run `instruction-layouts.test.ts` and `project-adoption.test.ts`.

### T4 · Publication rules (R12)

- `packages/orchestrator/scripts/publication-check.mjs`:
  - the exact pattern
    `^documentation/initiatives/[a-z0-9]+(?:-[a-z0-9]+)*/[^/]+\.md$` at the
    private-content scan (line 161) and the source-tree exemption (line 313);
  - the unanchored `(?:^|\/)documentation\/initiatives\/`, matching the
    existing `documentation/work/` rules, at the source-map exclusion
    (line 213) and the payload exclusion (line 245).
- `packages/orchestrator/test/publication.test.ts`: the R12 cases from
  Acceptance.
- Under Q2 (a), the checkout-local hook copy stays unchanged, and the report
  and tracker record the follow-up. Under Q2 (b), the hook copy is refreshed
  from the final `publication-check.mjs` with the owner's authorization, and
  its `installation.json` digests are updated.

### T5 · Documentation and facts (R15)

- `documentation/getting-started.md`: a "Multi-package initiatives" section
  after "Strict work with standalone skills". It covers:
  - when to use an initiative;
  - `/banzai:initiative start <slug>` and `$banzai:initiative start <slug>`;
  - the cycle `next` → package → commit → `record`;
  - gates;
  - what the skill never does.
- `README.md`: one sentence near the standalone skill list that links that
  section.
- `plugins/banzai/documentation/README.md`: an "Initiative" tree block.
- `documentation/orchestrator.md:738`: "all eleven skills" becomes "all
  eleven workflow skills"; `initiative` is not a runner requirement.
- `PROJECT_MANIFEST.md`:
  - "twelve standalone skills";
  - the explicit-only skill list;
  - one fact for the initiative root and its publication rule.

### T6 · Scenario (Q1, Acceptance)

- Create two disposable repositories under the scratchpad:
  - an adopted one, with the `AGENTS.md` template, a root
    `PROJECT_MANIFEST.md`, two commits and a second branch that holds
    `documentation/decisions/0003-x.md`;
  - a legacy one, with a `CLAUDE.md` that carries `## Engineering Quality`
    and no `AGENTS.md`.
- A subagent reads only `plugins/banzai/skills/initiative/` and the
  repository. It runs each Acceptance step and returns the commands, the file
  lists, the digests and `git status` after each step.
- The report quotes the results. The scenario writes nothing in this
  repository.

### T7 · Close-out

- Run the checks below, write the report, and set ADR-0061 to Implemented in
  the ADR status block, the decision index and the manifest row. Under
  Q2 (a), the ADR status block and index say "Implemented except the
  checkout-local hook reconciliation, an owner follow-up".
- Set the tracker's WP19 row to `report ready` and record the Q2 follow-up.

## Tests

| Requirement | Test                                                                                                                                                        |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1, R2, R13 | `release-validation.test.ts`: frontmatter, `openai.yaml`, empty policy row, legacy diagnostic, each rule fragment, inventories                              |
| R11         | `release-validation.test.ts` template fragment; `instruction-layouts.test.ts` fixture identity; `project-adoption.test.ts`                                  |
| R12         | `publication.test.ts`: source pass and scan, private binding fail, payload fail, non-kebab or nested path still unclassified, other documentation unchanged |
| R3–R10, R16 | T6 scenario evidence in the report                                                                                                                          |
| R14         | `git diff --stat` of the listed paths against the base commit, in the report                                                                                |

## Checks

- Focused, during work, through
  `node packages/orchestrator/scripts/test.mjs --file <name>.test.ts`:
  - `release-validation`;
  - `publication`;
  - `instruction-layouts`;
  - `project-adoption`;
  - `workflow-skills`.
- Final:
  - `npm run verify`;
  - `npm run format:check`;
  - `npx prettier --check` on the changed root documents, never on
    `plugins/**` or older ADRs;
  - `npm run release:validate`, expecting only the deferred
    `HOOK_CHANGED_WITHOUT_VERSION_BUMP`;
  - `node packages/orchestrator/scripts/release-candidate-check.mjs`.
- No `npm run build` change is expected. `npm run build:check` inside verify
  proves it.

## Sequencing

T1 → T2 → T3 → T4 → T5 → T6 → T7.

- T1's tests fail until T2 and T3 land.
- T4 is independent, but stays in the same sequence so that only one test run
  happens at a time.
- T6 needs the final skill text.

## Risks

- **The layout scan rejects a sentence in the new skill.** `CLAUDE.md`
  mentions and bootstrap wording fail `INSTRUCTION_LAYOUT_DRIFT`. Mitigation:
  copy the layout block verbatim from `feature-description/SKILL.md` and run
  `release:validate` after T2.
- **The empty-row branch weakens the check for other skills.** Mitigation: the
  branch keys on the skill name `initiative`, and a test proves an existing
  skill still needs its policy lines.
- **Text in the template line trips a consultation or gate-count check.**
  Mitigation: run `release:validate` after T3.
- **The scenario agent drifts from the skill text.** Mitigation: it may read
  only the skill directory, and the report lists every step where it had to
  interpret the text. Those become skill edits before close-out.
- **WP20 edits in the same working tree.** The plan leaves `brief.md`, WP20
  rows and WP20 entries untouched, and the report names them as outside this
  change set.
