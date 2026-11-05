# WP19 · Initiative skill and documents

Status: approved on 2026-11-05 with `Both recommended` · Program:
[banzai 2.8–2.9](../release-2-8-2-9-program/tracker.md) · Source: the owner's
additions of 2026-11-03 and 2026-11-05 (WP19 is not in the
[brief](../release-2-8-2-9-program/brief.md))

## Problem

The 2.8–2.9 program runs on a hand-made method: a frozen brief and a living
tracker. Six packages were delivered with it, but the method exists only as
this repository's documents. No Banzai skill works above one work, so another
project cannot start an initiative the same way, and nothing detects an edited
brief, a row marked committed without a commit, or an ADR ID reserved twice.

## Authority

- [ADR-0061](../../decisions/0061-initiative-skill-and-documents.md), accepted
  on 2026-11-05 with the recommended answer to all three owner choices. It
  narrowly amends ADR-0054 and ADR-0041 and adds an `initiative` row to the
  ADR-0036 read matrix. The ADR text is authoritative wherever this document is
  shorter.
- The runner, CLI, control protocol, contracts, bindings, policies, phases,
  guidance, pinned skill resources and `phase-guidance-current.json` do not
  change (ADR-0061 §7). No instruction transition is recorded.
- Gate 1 item: "A new initiative started through the WP19 skill keeps its
  brief, tracker and gate reports in `documentation/initiatives/<slug>/`, while
  its packages stay in `documentation/work/<slug>/`."

## Requirements

- **R1 · Skill package (§3).**
  - `plugins/banzai/skills/initiative/SKILL.md` has `name: initiative`,
    `user-invocable: true` and `disable-model-invocation: true`. Its
    description says explicit invocation only, in the `orchestrate` style.
  - `plugins/banzai/skills/initiative/agents/openai.yaml` has
    `display_name: "Banzai Initiative"`, a short description, a
    `default_prompt` that names `$banzai:initiative`, and
    `policy.allow_implicit_invocation: false`.
  - `references/brief-template.md` and `references/tracker-template.md` give
    the document shapes. The tracker template mirrors the program tracker's
    sections, so an existing program tracker parses.
  - All skill text and output are English.
- **R2 · Sources and layout (§7, ADR-0036).** `## Sources` names the project
  root `AGENTS.md` and no policy file. The skill applies the same layout
  recognition text as the other writing skills, stops on a legacy layout with
  "legacy Banzai layout: run `project-manifest` to migrate", reports a partial
  layout and stops, and skips recognition in the plugin source repository. An
  absent or unreadable `AGENTS.md` is reported before any write.
- **R3 · Modes and selection (§3).**
  - Arguments: `start <slug>`, `next [path]`, `record [path] <entry>`,
    `gate [path] <N>`. With no mode, the skill runs `next`.
  - Selection: an explicit path must resolve inside the repository to a
    directory holding `brief.md` and `tracker.md`. Without a path, the skill
    uses the only directory under `documentation/initiatives/`; with several,
    it lists them and asks; with none, it reports that and asks for a path. It
    never selects by timestamp.
  - A new initiative takes only a slug under the work slug rules (lowercase
    kebab-case, at most 100 characters) directly under
    `documentation/initiatives/`.
- **R4 · `start` (§1, §2).**
  - Source: brief text the owner gives in chat or a file the owner names. The
    skill does not write brief content; it adds only the frozen-input note.
  - Before writing, it lists personal names and private links it found and
    asks whether to replace them. It writes no raw logs or credentials.
  - It refuses when the directory exists or when the brief names no package.
    A package needs an ID, a title and "Done when" items.
  - It writes exactly `brief.md` and `tracker.md`. `brief.md` is the approved
    text with a short frozen-input note on top. The tracker records the brief's
    SHA-256, the baseline commit (or "no commits"), one package table per
    stage, the gate lists, empty reservations, questions and deviations, and an
    owner decision that quotes the approval.
- **R5 · Brief digest (§2, owner choice 2).**
  - The tracker carries one line: ``Brief SHA-256: `<64 lowercase hex>` ``.
    The digest covers the file's bytes with every carriage return removed, so
    a checkout with CRLF line endings gives the same digest. When no tool can
    compute it, the skill reports that and stops.
  - Every mode compares the digest first. On a mismatch or a missing line, it
    reports, `next` hands off nothing, and the only write allowed is a
    re-freeze `record`: one owner decision in the owner's words plus the
    updated digest line.
- **R6 · `next` (§3, §4).**
  - It writes nothing.
  - It reports: the initiative, the status line, each stage's progress, drift,
    open questions and the package it hands off.
  - Drift it reports:
    - a commit cell that names no commit reachable from `HEAD`;
    - a row marked `report ready` whose report is committed and whose work
      directory has no uncommitted change, as a hint to record `committed`;
    - a reserved ADR ID with no file, or a file status that differs from the
      row;
    - a finished stage whose gate decision is not recorded.
  - Choice: the first row in stage order that is not committed and whose
    dependencies are committed. A package of a later stage waits until the
    earlier gate decision is recorded.
  - Working tree: a package is in progress when its row says `in progress` or
    `report ready`, or when its work directory has uncommitted changes. With
    exactly one such package, `next` resumes it and lists every uncommitted
    path outside the initiative directory, marking those outside its work
    directory and reserved ADR files. With several, it lists them and asks.
    It refuses to hand off a different package while any change exists outside
    the initiative directory.
  - The handoff gives the package ID and title, the work slug, the recommended
    route with its reason, the brief section link, the "Done when" items as
    requirements to number, dependency state, any ADR reservation to make, and
    request text for an orchestrated run. It tells the agent to link the brief
    section from the package's requirements document when its route writes
    one.
  - It never invokes `orchestrate` or the `banzai` CLI.
- **R7 · `record` (§2, §3).**
  - One entry per call:
    - a row's status, commit or notes;
    - an owner decision, with its date and the owner's exact words in
      backticks;
    - a deviation;
    - an open question or its answer;
    - an ADR reservation;
    - a gate decision, which ticks that gate's list, sets its report line and
      adds the owner decision.
  - Status values: `not started`, `ADR draft`, `ADR proposed`,
    `ADR accepted`, `in progress`, `report ready`, `committed`.
  - Before quoting owner words, it asks whether to replace personal names and
    private links in them.
  - A commit cell is written only for a commit reachable from `HEAD`. When the
    commit does not touch the row's work directory, `record` says so in its
    report; that is not a refusal, because a quick-fix may write no document.
  - An ADR reservation takes the next ID above every ID found in:
    - `documentation/decisions/` in the working tree;
    - every local branch and remote-tracking branch;
    - every worktree;
    - every tracker under the root, and the selected tracker.

    It records the ID, package, title and the date of the check. It never
    fetches.

  - It changes only the named entry and keeps all other bytes. If it cannot
    parse the section, it reports that and writes nothing.
- **R8 · Follow-on `record` (§3).** After `next` hands off a package, the same
  session may apply `record` without a new invocation, but only:
  - to that package's row and to owner decisions stated in that session;
  - after the active skill has reported;
  - outside read-only skills;
  - outside `orchestrate` supervision.
- **R9 · `gate` (§4).**
  - For each item of stage N's gate list, it cites existing evidence: reports,
    recorded results, documents and read-only Git facts. It runs no project
    command, because a check or build would write files. Items without such
    evidence are marked "owner evidence needed".
  - It writes `gate-<N>-report.md` in the initiative directory, refuses an
    existing report, asks for no confirmation and ends. It does not change the
    tracker.
- **R10 · Authority and input safety (§4, Compliance).**
  - Git use is read-only and local: `status`, `log`, `rev-parse`, `cat-file`,
    `ls-tree`, `for-each-ref`, `worktree list`, `diff --name-only`. No fetch,
    stage, commit or push.
  - Initiative documents grant no approval.
  - Tracker cells are untrusted. A commit, ref or path from a cell reaches Git
    or the filesystem only after validation, never as an option, and never
    outside the repository.
- **R11 · Template routing (§5).**
  - The packaged `plugins/banzai/AGENTS.md` gains one `## Routing` line:
    outside runner phases, a multi-package initiative goes to `initiative`,
    invoked by name. When it looks appropriate and the user has not invoked
    it, the agent says so and asks them to run it. Its stage gates fall
    between packages and are not decision gates.
  - The fresh-adoption fixture
    `packages/orchestrator/test/fixtures/instruction-layouts/fresh-adoption/after/AGENTS.md`
    stays a byte-identical copy. The other instruction-layout fixtures do not
    change.
- **R12 · Publication (§6).** `publication-check.mjs`:
  - accepts `^documentation/initiatives/<slug>/<name>.md$` in source trees
    without a per-file entry;
  - applies the private-content scan to it, as it does to work documents;
  - rejects any path containing `documentation/initiatives/` in plugin and npm
    payloads and in source maps, matched like the existing
    `documentation/work/` rules.

  Other unclassified documentation still fails. The checkout-local hook copy
  follows the Q2 answer.

- **R13 · Release checks and inventories (§7).**
  - `check-release.mjs` lists `initiative` with an empty policy row. Its
    `## Sources` check requires the project root `AGENTS.md`, the
    availability boundary and the legacy diagnostic, and no policy name.
  - A new `validateInitiativeSkill` requires the R1 frontmatter, the
    `openai.yaml` keys and the core rules: explicit invocation, no staging,
    commit or push, no CLI or `orchestrate`, read-only `next`, the re-freeze
    exception, and the template line.
  - `release-policy.json` requires the new files, and
    `publication-policy.json` classifies them as `product`.
  - `workflow-skills.test.ts` gains an `initiative` row in
    `EXPECTED_POLICY_READS` with no policies and the legacy diagnostic, as
    ADR-0036 requires tests to agree with its matrix.
- **R14 · Unchanged runner surface (§7).** The following stay byte-identical
  to the base commit:
  - `phase-guidance-current.json` and the generated `src/phase-resources.ts`;
  - `plugins/banzai/policies/`, `phases/`, `guidance/` and `hooks/`;
  - every other skill directory;
  - `packages/orchestrator/src/` and `plugins/banzai/contracts/`.

  Both `plugin.json` files are unchanged.

- **R15 · Documentation and facts.**
  - `documentation/getting-started.md` gains a short "Multi-package
    initiatives" section, and `README.md` gains one pointer to it.
  - `plugins/banzai/documentation/README.md` shows the initiative tree.
  - `documentation/orchestrator.md` says that the runner verifies the eleven
    workflow skills.
  - `PROJECT_MANIFEST.md` states the twelfth skill, the explicit-only list,
    the initiative root and its publication rule. At the end of the package,
    ADR-0061 moves to Implemented in the manifest, the decision index and the
    ADR's implementation state. Under Q2 (a), the ADR and index say
    "Implemented except the checkout-local hook reconciliation, an owner
    follow-up".
- **R16 · No migration.** No existing document moves. The program directory
  changes only through the tracker's normal updates.

## Owner decisions

- **Q1 · Scenario evidence for the Gate 1 item.**
  - (a) Recommended: a subagent of this session reads the source skill
    directory and follows it in disposable Git repositories. It tests the
    rules as written, without a live vendor run. It does not test how a host
    loads the skill or honors `disable-model-invocation`; the release check
    covers the frontmatter, and the live Gate 1 check covers loading with the
    installed 2.8 plugin.
  - (b) A live `claude --plugin-dir plugins/banzai` session in a disposable
    repository. It also tests host loading and explicit invocation, and needs
    the owner's explicit go-ahead for a live vendor run.
- **Q2 · Checkout-local publication hook.**
  - (a) Recommended: no change in WP19. This repository has no initiative
    documents yet, since the program stays in `documentation/work/`. The tracker
    records a follow-up: refresh the hook copy on the owner's request before
    the first initiative document is pushed.
  - (b) Refresh the hook copy in WP19, with the owner's explicit authorization
    recorded in the report.

## Acceptance

- Release-validation tests prove:
  - the explicit-only frontmatter and `openai.yaml` keys;
  - the empty policy row with the legacy diagnostic;
  - each required rule fragment, so that removing any one fails;
  - the template line and its fixture copy.
- Publication tests prove:
  - initiative Markdown passes in a source tree and is scanned;
  - a private binding inside it fails;
  - it fails in plugin and npm payloads;
  - a non-kebab directory or a nested file still needs classification;
  - other unclassified documentation still fails.
- The Q1 scenario shows:
  - selection with no initiative and with two initiatives: it reports or asks;
  - exactly `brief.md` and `tracker.md` after `start`, and a refused second
    `start`;
  - the package in `documentation/work/<slug>/` with no initiative file;
  - a byte-identical tree after `next`;
  - a resumed in-progress package, and a refused handoff of a different
    package while a change exists outside the initiative directory;
  - `record` changing only its entry, and a follow-on `record` in the same
    session;
  - an edited brief, and a tracker with no digest line, each blocking handoff
    until a re-freeze;
  - hostile cells (a commit cell `--output=x`, a work directory `../x`)
    reported and never passed to Git or the filesystem;
  - an ADR reservation that skips an ID found on another branch;
  - a later-stage package held until the gate decision is recorded, and
    `gate` refusing an existing report;
  - a legacy-layout repository where the skill stops with the diagnostic;
  - no staging or commit by the skill.
- R14 holds by `git diff --stat` against the base commit.
- `npm run verify` and `npm run format:check` pass.
- `npm run release:validate` reports only the deferred
  `HOOK_CHANGED_WITHOUT_VERSION_BUMP`.
- `node packages/orchestrator/scripts/release-candidate-check.mjs` passes,
  because the instruction layout changes.

## Out of scope

- Initiative status in `feature-status` and initiative text in
  `artifact-storage.md` (ADR-0061 owner choice 1).
- Runner or CLI awareness of initiatives.
- Moving this program to `documentation/initiatives/`, and the re-freeze
  decision that lets the skill manage it.
- WP20's hook change and WP12's template restructuring.
