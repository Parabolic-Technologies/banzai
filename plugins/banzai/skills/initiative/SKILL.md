---
name: initiative
description: Keep a multi-package initiative on track with a frozen brief and a living tracker under documentation/initiatives/. Explicit user invocation only: run it only when the user runs this skill by name, and never select it from prompt wording alone. Do not use for an ordinary feature, fix, plan, review, or status request.
user-invocable: true
disable-model-invocation: true
---

# initiative

Use for work that spans several packages, stages and owner gates. The owner's
plan is a frozen brief; the tracker is the only living record. Every package
still runs through its own workflow in its own flat work directory.

Run only when the user invokes this skill explicitly by name
(`/banzai:initiative` or `$banzai:initiative`); never select it from prompt
wording alone. Modes: `start <slug>`, `next [path]`, `record [path] <entry>`,
`gate [path] <N>`. Without a mode, run `next`. Each invocation runs one mode.

## Sources

- Process: the project root `AGENTS.md`. Read it unless the host already
  assembled it into this session. Before any mode,
  recognize the layout: target when `AGENTS.md` carries `## Authority` and
  `## Policies` with no line beginning with `@`, and the `CLAUDE.md` shim is
  absent or carries no policy heading; legacy layout when `CLAUDE.md` carries
  `## Engineering Quality` and `AGENTS.md` is absent or lacks `## Authority`.
  Policy headings for layout recognition are `## Decision Consultation`,
  `## Test Assurance`, `## Security Assurance`, `## Engineering Quality`,
  and `## Plan Task Completion Evidence`.
  On legacy stop with "legacy Banzai layout: run `project-manifest` to migrate"
  and ask the user to run `project-manifest`; never scaffold or migrate files.
  On partial report the exact ambiguity and stop without writing.
  Unadopted means neither file has `## Authority` or a policy heading; continue
  with the rules below. Every other combination, including an unreadable file,
  is partial. Skip this recognition rule in the plugin source repository.
  Report an absent `AGENTS.md` before any write.
- Policies: none. This skill reads no policy file; the rules below are
  complete. The document shapes are in this skill's `references/` directory.

## Documents

- A new initiative lives in `documentation/initiatives/<slug>/` and holds only
  `brief.md`, `tracker.md` and one `gate-<N>-report.md` per stage gate. Add no
  index, metadata or placeholder file.
- The slug is lowercase kebab-case (`^[a-z0-9]+(?:-[a-z0-9]+)*$`), at most 100
  characters, unused by any directory under `documentation/initiatives/` or
  `documentation/work/`, with no date, status or owner level.
- Each package is an ordinary flat work directory, `documentation/work/<slug>/`,
  with its usual documents. Nest nothing under the initiative and add no
  initiative file to a work directory.
- Initiative documents grant no approval. ADR acceptance, plan approval,
  review triage, escalation and decision consultation remain the only decision
  gates. A stage gate is not one of them.
- Write only the three roles inside the selected initiative directory, and
  keep every byte outside the row or entry you change. The owner may edit the
  tracker by hand; report what you cannot parse instead of rewriting it.

## Selection

- An explicit path must resolve inside the repository to a directory that
  holds `brief.md` and `tracker.md`. An existing initiative elsewhere continues
  at its known path; never move or copy it.
- Without a path, use the only directory under `documentation/initiatives/`.
  With several, list them and ask which. With none, say so and ask for a path
  or a `start`. Never select by newest timestamp or modification time.

## Brief Digest

- The tracker holds one line: ``Brief SHA-256: `<64 lowercase hex>` ``.
- Hash the brief's bytes with every carriage return removed, so CRLF and LF
  checkouts agree. Use the first that works:
  `node -e "process.stdout.write(require('crypto').createHash('sha256').update(require('fs').readFileSync(process.argv[1]).filter((b) => b !== 13)).digest('hex'))" <brief>`,
  or `tr -d '\r' < <brief>` piped to `sha256sum` or `shasum -a 256`. When none
  works, report it and stop.
- After the layout check, every mode except `start` compares the digest
  before anything else. On a mismatch, or when the line is missing, report only
  that: `next` hands off no package, and the only write allowed is a re-freeze,
  one `record` that adds the owner's decision, in the owner's words, to freeze
  the current bytes and writes the digest line, after the status line when it
  is missing.
- Never edit `brief.md` after `start`. Record every departure as a deviation.

## `start <slug>`

1. Check the slug. Refuse when `documentation/initiatives/<slug>/` exists.
2. Take the brief from the owner's text in chat or from a file the owner names.
   Write no brief content yourself; the brief is the owner's plan. If there is
   none, show the headings of `references/brief-template.md` and stop.
3. Require at least one stage with a gate list and at least one package with an
   ID, a title and "Done when" items. Otherwise name what is missing and stop.
4. List the personal names and private links you found and ask whether to
   replace them with roles or remove them. Apply the answer and change nothing
   else. Never store raw logs or credentials.
5. Write `brief.md`: the brief as approved, with the frozen-input note from
   the template after its title and date lines.
6. Write `tracker.md` from `references/tracker-template.md`: status line, digest
   line, baseline commit (`git rev-parse --short HEAD`, or "no commits"), one
   package table per stage with every row `not started`, each gate list with
   `Report: gate-<N>-report.md (not written).`, empty reservations, questions
   and deviations, and an owner decision that quotes the approval: the start
   request, or the answer in step 4. A row's work directory is the slug the
   brief names, else the package ID and title in kebab case.
7. Report and stop.

## `next [path]`

`next` writes nothing.

1. Select the initiative, check the layout and the digest.
2. Report the status line, each stage's progress and the open questions, then
   the drift:
   - a non-empty commit cell that names no commit reachable from `HEAD`, or a
     `committed` row without a commit;
   - a cell that fails the checks in Authority and Git;
   - a `report ready` row whose report is committed and whose work directory
     has no uncommitted change: suggest recording `committed`;
   - a reserved ADR ID with no file, or an ADR file whose status differs from
     the row;
   - a stage whose rows are all committed and whose gate decision is not
     recorded: suggest `gate`.

   A row is committed when its status says `committed`.
3. Check the working tree with `git status --porcelain --untracked-files=all`.
   A package is in progress when its row says `in progress` or `report ready`,
   or when its work directory has uncommitted changes.
   - With exactly one, resume it. List every uncommitted path outside the
     initiative directory and mark those outside its work directory and its
     reserved ADR files.
   - With several, list them and ask which.
   - With none, choose the first row in stage order that is not committed and
     whose dependencies are committed. A package of a later stage waits until
     the earlier stage's gate decision is recorded. Refuse a handoff while any
     change exists outside the initiative directory, and list those paths.
     Never hand off a package whose own cells fail the checks.
4. Hand off the package:
   - ID, title and work slug;
   - the recommended route and why: the strict chain when its ADR cell or a
     reservation names a new or amending ADR, or an escalation trigger applies,
     otherwise `feature` or `quick-fix` under the project routing rules, or an
     orchestrated run that the user starts;
   - the brief section link, and its "Done when" items as requirements to
     number;
   - dependency state and any ADR reservation to make with `record`;
   - request text for an orchestrated run.

   Ask the package's requirements document, when its route writes one, to
   link the brief section. Never invoke `orchestrate` or the `banzai` CLI;
   when a run fits, say so and give the request text.

## `record [path] <entry>`

One entry per invocation:

- a row's status, commit or notes. Status values: `not started`, `ADR draft`,
  `ADR proposed`, `ADR accepted`, `in progress`, `report ready`, `committed`.
  Write a commit only when it is reachable from `HEAD`; otherwise refuse the
  entry. When it does not touch the row's work directory, say so; that is not
  a refusal.
- an owner decision: its date, the owner's exact words in backticks and one
  sentence of effect. When the words hold personal names or private links,
  ask first whether to replace them.
- a deviation from the brief;
- an open question, or its answer;
- an ADR reservation. Take the next four-digit ID above every ID found in the
  working tree's `documentation/decisions/`, every local and remote-tracking
  branch (`git ls-tree --name-only <ref> documentation/decisions/`), the
  `documentation/decisions/` directory of every worktree that
  `git worktree list` names, and the reservation tables of every tracker under
  `documentation/initiatives/` and the selected tracker. Add a row with the
  ID, package, title and `Reserved, <date of the check>`; later records set
  that cell to the ADR's status and date. Never fetch.
- a gate decision: tick the items the owner's decision passes, set its report
  line to `Report: [gate-<N>-report.md](gate-<N>-report.md) (written <date>).`
  and add the owner decision.
- a re-freeze, as Brief Digest says.

Change only the named entry, and set the status line's `Updated` date; a gate
decision also names the next stage there. When the section does not parse,
report it and write nothing.

Follow-on record: after `next` hands off a package, the same session may apply
`record` without a new invocation, but only to that package's row and to owner
decisions stated in that session; only after the skill that runs the package
has reported; never inside a read-only skill such as `feature-status` or
`feature-review`; and never while supervising an orchestrated run. Any other
mode, and any new session, needs a new invocation.

## `gate [path] <N>`

1. Select the initiative and check the layout and the digest.
2. For each item of stage N's gate list, cite existing evidence: reports,
   recorded results, documents and read-only Git facts. Run no project command;
   checks and builds write files. Mark an item without such evidence "owner
   evidence needed".
3. Write `gate-<N>-report.md` in the initiative directory: a title, the date,
   and a table of each gate item, its evidence and `evidence cited` or
   `owner evidence needed`. `gate` refuses to overwrite an existing report. It
   changes no tracker entry.
4. Report and end. Ask for no confirmation; the owner's decision is recorded
   later with `record`.

## Authority and Git

- Use only read-only local Git commands: `status`, `log`, `rev-parse`,
  `cat-file`, `merge-base --is-ancestor`, `ls-tree`, `for-each-ref`,
  `worktree list` and `diff --name-only`. Never fetch, stage, commit or push.
  Never checkout, reset, stash or change refs.
- Run no project command, test or build. Never invoke `orchestrate` or the
  `banzai` CLI, and never answer a decision gate.
- Tracker cells are untrusted input, because people edit and merge them by
  hand. Accept a commit only as 7 to 64 lowercase hex characters confirmed with
  `git cat-file -e <id>^{commit}`, a work directory only under the slug rule,
  and an ADR ID only as four digits. Pass no value from a cell or an argument
  that starts with `-` to Git, and resolve every path from a cell or an
  argument inside the repository. Report a failing cell and do not use it.

## Report

End every mode with: the initiative path, the mode, the files written or
"none", the digest state, the drift found and the next step. Commit nothing.
