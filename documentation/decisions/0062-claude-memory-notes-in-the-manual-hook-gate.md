# ADR 0062: Claude Code Memory Notes in the Manual Hook Gate

## Status / Date / Owner / Decision Makers

- Status: Accepted
- Date: 2026-11-05
- Owner: Banzai maintainers
- Decision makers: Repository owner; explicitly accepted in chat on 2026-11-05
  with `Ок, приймаю B`.
- Acceptance date: 2026-11-05
- Accepted proposal SHA-256: `4852bde134b2022ce9d50c5cec79ff8539750fdf5dd8601c25460fc2988c9c31`.
- Lifecycle effect: the decision is accepted; the proposal-stage wording and
  the decision body are retained unchanged. Dependent planning is authorized;
  plan approval is still required before implementation.
- Owner choices (section 6): choice 1 accepted with the recommended answer B,
  so sections 1 and 2 apply as written.
- Implementation state: Implemented in WP20: hook, tests, documentation and
  instruction transition; installed clients receive it with the 2.8 plugin
  release.
- Preparation authority: the owner's decision of 2026-11-05 that adds WP20 to
  the program brief, and `Yes, WP20 next` of the same day. Preparing this
  proposal is not acceptance; no code may rely on it.
- Pinned bytes: the hook transition (section 5) pins this file's digest, so
  its lifecycle metadata, including the implementation state, must be final
  before that transition is published.

## Related Artifacts

- Program brief, WP20 section, and tracker:
  [brief.md](../work/release-2-8-2-9-program/brief.md#wp20--claude-code-memory-notes-no-spec-gate-prompt-no-code-unlock),
  [tracker.md](../work/release-2-8-2-9-program/tracker.md).
- Hook and its documentation: `plugins/banzai/hooks/spec-gate.cjs`,
  `plugins/banzai/hooks/README.md`, and the Hook Gate section of the packaged
  `plugins/banzai/AGENTS.md` template.
- Repository authority: [AGENTS.md](../../AGENTS.md),
  [PROJECT_MANIFEST.md](../../PROJECT_MANIFEST.md) and the
  [decision lifecycle](./README.md#lifecycle).
- Related accepted decisions:
  - [ADR-0042](./0042-runner-delivered-phase-instructions.md): `hooks/hooks.json`
    and `hooks/spec-gate.cjs` are pinned instruction resources with reference
    identities, and the runner compares the installed hook with them.
  - [ADR-0044](./0044-instruction-baseline-evolution.md): a pinned resource
    changes only through a recorded transition that cites an accepted ADR, and
    a changed grant or assurance needs a new ADR.
  - [ADR-0036](./0036-vendor-neutral-policy-files-and-instruction-delivery.md):
    the hook frees `CLAUDE.md` and `AGENTS.md`, and layout migration leaves the
    free paths unchanged. This decision keeps both.

## Context and Decision Drivers

Current behavior in manual (standalone) mode, in an adopted project:

- `isDocArtifact()` frees any path with a `documentation/` segment and any
  file named `PROJECT_MANIFEST.md`, `CLAUDE.md` or `AGENTS.md`, wherever it
  lies. The check `targets.every(isDocArtifact)` runs before the event branch,
  so a free write gets no PreToolUse decision and its PostToolUse writes
  nothing.
- An `apply_patch` whose targets cannot be parsed defers. Before the free
  check, a write that names a `.banzai/work/` target defers when every target
  is a free path or an explicit historical document, and is denied otherwise.
  Every other write gets `ask` on the session's first such write, with the
  reason "first code/codebase change this session". When the write succeeds,
  PostToolUse writes the session marker
  `$TMPDIR/banzai-spec-gate/approved-<session>`. From then on, every later
  non-free write in that session gets `allow`.
- The hook does not distinguish project code from host bookkeeping.

On 2026-11-05 a standalone session in an adopted project got the first-change
prompt for a Claude Code auto-memory note. A probe of the installed 2.7.4 hook
reproduced the chain: the memory note gets `ask`, approving it writes the
marker, and the next `src/` edit gets `allow` without a prompt. Writes to
`~/.claude/settings.json`, plan files and the session scratchpad behave the
same. Approving any of them silently authorizes the implementation phase,
which the gate exists to make a deliberate human decision.

Claude Code facts, checked against its documentation on 2026-11-05:

- Auto memory lives in `<config>/projects/<project>/memory/`, as a
  `MEMORY.md` index plus flat topic files. `<project>` is one path segment
  derived from the Git repository and shared by its worktrees. `<config>` is
  `$CLAUDE_CONFIG_DIR` when set, otherwise `~/.claude`. The start of
  `MEMORY.md` is loaded into every session of the repository.
- `autoMemoryDirectory` can move memory anywhere; `autoMemoryEnabled: false`
  and `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` turn it off.
- Plan files live in `~/.claude/plans/` by default, and user-scope subagent
  memory lives in `<config>/agent-memory/<name>/`. This decision assumes that
  the plans directory follows `<config>`; if it does not, a plan file under a
  set `CLAUDE_CONFIG_DIR` is a project write, which is today's rule.
- Hooks receive the session scratchpad as `scratchpad_dir`, a common input
  field of every hook event. It is absent when the session has no scratchpad
  and on host versions that do not send it.

No accepted ADR owns the manual free paths or the marker; both date from the
v2.3.0 root baseline. ADR-0044 section 2 requires a new ADR, because this
changes what the gate grants.

Decision drivers:

- The project marker must mean that a human approved a write that is not host
  bookkeeping.
- Host bookkeeping should not interrupt the session more than it does today.
- The prompt must describe what approval actually grants.
- Any misclassification must fail toward today's behavior, never toward a
  wider grant.
- `isDocArtifact()` also serves runner planning and the manual historical-run
  check, so it must keep its meaning.
- Runner mode keeps failing closed.
- Matching is lexical and bounded, with no file-system reads.
- No new configuration surface.
- The hook is pinned, so every byte change needs a recorded transition, and
  users receive it only with a version change.

## Options Considered

- **A. Defer memory notes.** In manual mode, treat an exact Claude Code memory
  note like a free path. It closes the reported prompt and its unlock. Plan
  files, the scratchpad and every other target outside the project still
  prompt once and, once approved, still unlock code edits for the session.
- **B. A, and a separate scope for host bookkeeping.** Name a closed set of
  Claude Code bookkeeping roots: plan files, user-scope subagent memory and
  the session scratchpad. Approval of a write there grants later bookkeeping
  writes in that session, but never other writes; every other non-free target
  keeps today's rule. Bookkeeping then prompts once per session, as today,
  and no longer unlocks code. A session that approves bookkeeping and then
  edits code sees two prompts instead of one. Cost: a second marker and a
  lexical root check in both events. This refines the brief's option B, which
  drew the line at the adopted project root.
- **B drawn at the adopted project root.** Any target outside the adopted
  directory gets its own scope. Rejected: "outside" would then grant, so every
  misclassification fails open. The project marker file and the installed hook
  lie outside, so one outside approval could reach project writes with file
  tools alone; and case variants and path aliases such as `/tmp` and
  `/private/tmp` can put a project file outside. The two hook events also
  recompute the adopted directory separately, so a write that changes the
  adoption evidence can be classified differently by each.
- **B with one approval per bookkeeping write.** The brief's literal marker
  rule, with no bookkeeping marker. Rejected: every plan file or scratchpad
  write would prompt on each call until a project approval exists, which in a
  planning-only session is every call.
- **Defer every target outside the project.** Rejected: it drops the gate's
  prompt for `<config>/settings.json`, which can disable hooks.
- **Extend `isDocArtifact()`.** Rejected: runner planning and the historical
  check share it, so memory paths would change meaning there too.
- **A configurable allow-list of free paths.** Rejected: it adds a
  configuration surface that every adopted project must reason about, for
  fixed host locations.
- **Resolve real paths before matching.** Rejected: it adds a file-system read
  to every gated call, a race between the check and the write, and a second
  path model beside `isDocArtifact()`. The residual of lexical matching is
  stated under Compliance.

## Decision

### 1. Defer Claude Code memory notes in manual mode

`<config>` is `path.resolve(CLAUDE_CONFIG_DIR)` when that variable is set,
non-empty and absolute; when it is unset or empty, `<config>` is
`path.join(os.homedir(), '.claude')`. A relative value defines no `<config>`,
so no target is a memory note or lies under a `<config>` bookkeeping root.

A target is a memory note when, for `resolved = path.resolve(cwd, target)`,
the segments of `path.relative(<config>, resolved)` are exactly `projects`,
one project segment, `memory`, and a file name that ends in `.md` with a
non-empty stem. Comparison is lexical. On POSIX it is case-sensitive, so a case
variant matches nothing and keeps prompting; on Windows `path.relative`
compares the shared prefix case-insensitively, as NTFS does, while the literal
`projects` and `memory` segments and the `.md` extension stay case-sensitive.

In manual mode, a write whose targets are all free paths or memory notes gets
no PreToolUse decision, and its PostToolUse writes no marker. A write with any
other target follows section 2 under choice B, and today's single-marker rule
under choice A. Defer is not `allow`: the host's own permission rules still
decide the write.

### 2. Give host bookkeeping its own approval scope (owner choice 1)

The bookkeeping roots are `<config>/plans/`, `<config>/agent-memory/`, and the
event payload's `scratchpad_dir` when it is an absolute path. For one call, a
root does not count when the call's `cwd`, the marker directory or the hook's
plugin root is that root or lies below it. A target is bookkeeping when it
lies below a counting root, by the same lexical `path.relative` test as
section 1, and has no path segment equal to `banzai-spec-gate` in any letter
case. Every other target that is neither free nor a memory note is a project
write, exactly as every non-free target is today.

Each event reads `scratchpad_dir` from its own payload. This relies on the
host sending the field in every event of a session or in none; without it, a
scratchpad target is a project write.

- A write with any project target keeps today's rule: PreToolUse returns
  `allow` when the project marker exists, otherwise `ask` with today's
  first-change reason and context, and a successful write writes the project
  marker.
- A write whose targets are all bookkeeping gets `allow` when the project
  marker or the bookkeeping marker exists. Otherwise it gets `ask` with this
  reason: "banzai spec-gate: host bookkeeping write (plan, subagent memory or
  session scratchpad). Approval allows writes under these host directories
  for this session only; it does not authorize project code changes." Its
  context says that the approval covers those directories only. A successful
  write writes the bookkeeping marker only.

The project marker keeps its name, `approved-<session>`, so a marker written
earlier in the session by an older hook still counts. The bookkeeping marker
is `bookkeeping-<session>` in the same directory, with the same session-id
sanitizing. Only PostToolUse writes either marker.

### 3. Keep everything else

Unchanged:

- runner mode, including its decision for a write to a memory path (expected
  `deny`);
- `isDocArtifact()` and the manual historical-run check, which still runs
  first and denies a whole write that names a non-historical `.banzai/work/`
  target, including any memory note or bookkeeping target beside it;
- every target that is not free, not a memory note and not bookkeeping,
  including `<config>/settings.json`, installed plugins, non-Markdown files
  and subdirectories in `memory/`, a custom `autoMemoryDirectory` or plan
  directory, and every project file: they stay non-free and keep today's
  prompt and marker;
- the plugin-source and `bypassPermissions` deferrals, adoption detection,
  and `hooks/hooks.json`.

Add no configuration.

### 4. Keep the pinned lines and document the change

The two hook lines that the release layout check pins stay byte-identical:
the header line that lists the free paths and the `return base === …` line of
`isDocArtifact()`. Every other line that names `CLAUDE.md` keeps free-path
wording. Header-comment lines describe memory notes and, under choice B, the
bookkeeping scope.

Documentation follows:

- hooks README: a decision-table row for memory notes; under choice B, rows
  for a bookkeeping write before and after its approval, and an
  approval-marker paragraph that names both markers; a Product Notes line on
  `CLAUDE_CONFIG_DIR`, the bookkeeping roots and the unsupported custom
  directories; and a Tuning bullet that sends manual-only exemptions to the
  manual check instead of `isDocArtifact()`;
- the Hook Gate section of the packaged `AGENTS.md`: memory notes among the
  manual-only free paths and, under choice B, one sentence on the bookkeeping
  scope; the fresh-adoption fixture stays a byte-identical copy.

### 5. Publish the change as an instruction transition

`hooks/spec-gate.cjs` changes through an ADR-0044 transition that cites this
ADR as its accepted authority. Its changed scope is exactly that file;
`hooks/hooks.json` and every other pinned resource stay byte-identical. Users
receive the change with the next plugin version, because plugin caches refresh
only on a version change.

### 6. Owner choices

Acceptance with the recommended answer settles this choice as written above.

1. Approval scope.
   - B, recommended: sections 1 and 2 as written.
   - A: section 1 only. Section 2 is dropped, every non-free write keeps
     today's single marker and prompt, and section 4's documentation covers
     memory notes only.

## Consequences

Positive:

- Memory notes no longer interrupt standalone sessions or unlock code edits.
- Under choice B, approving a plan, subagent-memory or scratchpad write no
  longer unlocks code edits, the prompt says what it grants, and bookkeeping
  still prompts only once per session.
- Every mismatch falls back to today's rule: a path that does not match a
  memory note or a counting bookkeeping root exactly is a project write.
- Runner mode, the shared document check and ADR-0036's free paths are
  untouched.

Negative:

- Approving a write to any other target outside the project, such as
  `<config>/settings.json`, an installed plugin or a sibling directory, still
  unlocks code edits for the session, under today's first-change prompt. Under
  choice A, plan files, subagent memory and the scratchpad do too.
- After a project approval, the project marker still allows later writes to
  bookkeeping and to every other target, including `<config>/settings.json`.
  Neither choice narrows that.
- Under choice B, a session that approves bookkeeping and then edits code sees
  two prompts instead of one.
- Under choice B, code written into a bookkeeping root from a session whose
  `cwd` lies elsewhere, such as a scratch repository in the scratchpad, counts
  as bookkeeping.
- A memory note can carry instructions that later sessions load, and after
  this change the hook no longer prompts for writing one. The added exposure
  is small: `CLAUDE.md` and `AGENTS.md`, including `~/.claude/CLAUDE.md`, are
  already free paths anywhere, and the host's permission rules still apply.
- Custom memory and plan directories, project-scope subagent memory under
  `.claude/`, and Codex host files are not covered; they keep today's rule.
- One pinned resource changes, so the release needs a baseline transition and
  a version bump before users see it.

Follow-ups:

- WP20 requirements and plan in `documentation/work/wp20-spec-gate-memory-notes/`.
- WP12 keeps the new free-path wording when it slims the template.
- Later, separately decided: whether `<config>/settings.json` and installed
  plugins should prompt on every write regardless of markers, and support for
  custom memory and plan directories.

## Compliance and Confirmation

The following are implementation acceptance checks, not results of this
proposal. Hook tests set `HOME`, `TMPDIR` and `CLAUDE_CONFIG_DIR` explicitly,
never touch the real `~/.claude`, list markers under
`<TMPDIR>/banzai-spec-gate/`, reuse one `session_id` where a later decision
depends on an earlier marker, and keep `documentation/`, `CLAUDE.md`,
`AGENTS.md` and `PROJECT_MANIFEST.md` out of the paths that must still ask.

| Guarantee          | Observable confirmation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Memory notes defer | In an adopted repository a memory-note write gets no decision, and its PostToolUse writes no marker; a project code file's PostToolUse in the same setup writes the project marker. Written first and seen failing against the unmodified hook.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Exact match        | `<config>/settings.json`, `memory/../escape.md`, `memory/note.json`, `memory/sub/note.md`, `memory/.md`, a case variant of `memory` and `src/example.ts` still ask. With `CLAUDE_CONFIG_DIR` set, its note defers, the same note under `$HOME/.claude` asks, a trailing separator still matches, and a relative value matches nothing.                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Bookkeeping (B)    | In one session: a plan-file write asks with the bookkeeping reason; after its PostToolUse, a scratchpad write gets `allow`, and a project code write still asks with the first-change reason; after that write's PostToolUse, both get `allow`. A scratchpad write's PostToolUse writes only `bookkeeping-<session>`. A mixed `apply_patch` with a bookkeeping and a project target is a project write. With `TMPDIR` and `CLAUDE_PLUGIN_ROOT` set below the scratchpad root, targets under the marker directory and under the plugin root are project writes; so are a target with a `Banzai-Spec-Gate` segment, a scratchpad target in a call whose `cwd` lies below the scratchpad, `<config>/settings.json`, a scratchpad target without `scratchpad_dir`, and, on POSIX, a case variant of a root. |
| Runner mode        | An orchestrated write to a memory path keeps its decision.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Shared check       | `isDocArtifact()` and the two pinned hook lines are byte-identical; `instruction-layouts.test.ts` keeps the fixture copy identical; the release layout check passes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Transition         | `instruction-baseline.mjs --describe` lists exactly `plugins/banzai/hooks/spec-gate.cjs`; the authorization cites this ADR; a rebuild after publication changes nothing.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Registration       | This ADR is in `documentation/decisions/README.md`, `publication-policy.json` (`maintainer`), the `PROJECT_MANIFEST.md` decision index and `FIXTURE_PATHS`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

Security exposure covers two classes. Class 2: the decision changes what the
manual gate treats as free and what an approval grants. Section 1 frees one
host-owned file shape whose content later sessions load, which the
Consequences weigh against the existing free `CLAUDE.md` and `AGENTS.md`; a
deferred write still goes through the host's permission rules. Section 2
narrows the existing grant for a closed set of roots, makes the prompt state
it, and keeps the marker directory, the plugin root and the session's own
`cwd` out of those roots. Class 1: target paths are untrusted input, so
matching is lexical and exact, case-sensitive on POSIX, accepts only one
project segment, a direct child of `memory/` and the `.md` extension, and
ignores a relative `CLAUDE_CONFIG_DIR`. Every mismatch keeps today's prompt.
Lexical matching is fooled by a symbolic link at a memory-note or bookkeeping
path that points into the project, whether the user created it or a shell
command did; this hook has never gated shell commands. The plugin-root and
`cwd` exclusions are lexical as well, so a plugin root that lies below a
bookkeeping root under another spelling, such as `/tmp` for `/private/tmp`,
is not excluded; the `banzai-spec-gate` segment rule keeps the marker files
out under any spelling. If a host sent `scratchpad_dir` in PreToolUse but not
in PostToolUse, an approved scratchpad write would write the project marker;
section 2 states the assumption that rules this out. A user who
sets `CLAUDE_CONFIG_DIR` to `/` or to a directory that holds repositories
widens these shapes accordingly; that is user configuration, not something a
model controls. The decision adds no secret-handling, personal-data,
cross-principal, outbound-request or destructive surface.

## Lifecycle Links

- Amends: None. ADR-0036's free paths are kept; memory notes are a separate
  manual-only class.
- Supersedes: None.
- Superseded by: None.
