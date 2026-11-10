# WP20 · Claude Code memory notes in the manual hook gate

Status: approved on 2026-11-06 with `Approve, Q1 (a)` · Program:
[banzai 2.8–2.9](../release-2-8-2-9-program/tracker.md) · Source:
[brief, WP20](../release-2-8-2-9-program/brief.md#wp20--claude-code-memory-notes-no-spec-gate-prompt-no-code-unlock)

## Problem

In manual (standalone) mode, `spec-gate.cjs` defers only `isDocArtifact()`
targets. Every other write gets the first-change prompt, and approving it
writes `$TMPDIR/banzai-spec-gate/approved-<session>`, which allows every later
non-free write in the session. A Claude Code memory note, a plan file, a
subagent memory file or a scratchpad file therefore prompts as "first
code/codebase change", and approving it silently authorizes code edits. The
installed 2.7.4 hook reproduced this on 2026-11-05.

## Authority

- [ADR-0062](../../decisions/0062-claude-memory-notes-in-the-manual-hook-gate.md),
  accepted on 2026-11-05 with `Ок, приймаю B`: owner choice 1 is B, so
  sections 1 and 2 both apply. The ADR text is authoritative wherever this
  document is shorter.
- ADR-0042 pins `hooks/spec-gate.cjs`; ADR-0044 requires a recorded
  transition that cites ADR-0062. `hooks/hooks.json` and every other pinned
  resource stay byte-identical.
- ADR-0036's free paths stay unchanged. Memory notes are a separate
  manual-only class, so ADR-0036 is neither amended nor the authority.
- Gate 1 item: "With the 2.8 plugin installed, the hook lets a manual session
  write a Claude Code memory note without a prompt or an approval marker, and
  the next code edit in that session still asks (WP20)."

## Requirements

- **R1 · `<config>` (ADR §1).** `<config>` is `path.resolve(CLAUDE_CONFIG_DIR)`
  when the variable is set, non-empty and absolute, and
  `path.join(os.homedir(), '.claude')` when it is unset or empty. A relative
  value defines no `<config>`: no target is then a memory note or lies under
  a `<config>` bookkeeping root.
- **R2 · Memory note (ADR §1).** For `resolved = path.resolve(cwd, target)`,
  the segments of `path.relative(<config>, resolved)` are exactly `projects`,
  one project segment, `memory`, and a file name that ends in `.md` with a
  non-empty stem. Matching is lexical, with no file-system read. The literal
  segments and the extension are case-sensitive on every platform.
- **R3 · Deferral (ADR §1, §3).** In manual mode, a write whose targets are
  all `isDocArtifact()` paths or memory notes gets no PreToolUse decision, and
  its PostToolUse writes no marker. The `.banzai/work/` check keeps running
  first, unchanged, per write: a write that names a `.banzai/work/` target
  defers only when every target is a free path relative to the project root
  or an explicit historical document, and is denied otherwise, so a memory
  note or bookkeeping target beside it is denied too.
- **R4 · Bookkeeping target (ADR §2).**
  - Roots: `<config>/plans/`, `<config>/agent-memory/`, and the event
    payload's `scratchpad_dir` when it is a string holding an absolute path.
    Each event reads `scratchpad_dir` from its own payload; without a usable
    value there is no scratchpad root. When `<config>` cannot be computed,
    for example because `os.homedir()` throws, there is no `<config>`, as in
    R1.
  - For one call, a root does not count when the payload `cwd`, the marker
    directory (`<os.tmpdir()>/banzai-spec-gate`) or the hook's plugin root is
    that root or lies below it.
  - A target is bookkeeping when it lies strictly below a counting root, by a
    lexical `path.relative` test, and no segment of its resolved path equals
    `banzai-spec-gate` in any letter case.
  - Every target that is not a free path, a memory note or bookkeeping is a
    project target.
- **R5 · Decisions (ADR §2).** A write that reaches the marker logic is a
  bookkeeping write when it has no project target. ADR §2's two bullets must
  cover every such write, so a write that mixes bookkeeping targets with free
  paths or memory notes is a bookkeeping write.
  - Project write: today's behavior, byte for byte. PreToolUse returns
    `allow` with today's reason when `approved-<session>` exists, otherwise
    `ask` with today's reason and `additionalContext`. PostToolUse writes
    `approved-<session>`.
  - Bookkeeping write: PreToolUse returns `allow` when `approved-<session>`
    exists, with today's reason. It returns `allow` when
    `bookkeeping-<session>` exists, with the reason "banzai spec-gate: host
    bookkeeping writes already approved for this session." Otherwise it
    returns `ask` with the ADR's reason text, verbatim, and this
    `additionalContext`: "This approval covers host bookkeeping directories
    only (plans, subagent memory, session scratchpad). The first project code
    change in this session still needs its own approval." PostToolUse writes
    `bookkeeping-<session>` only.
  - Both markers live in the marker directory and use today's session-id
    sanitizing. Only PostToolUse writes either marker, best effort, as today.
- **R6 · Unchanged (ADR §3).** Unchanged:
  - runner mode, including its decision for a write to a memory path:
    `deny` in a bound run, whose unsafe-path check rejects a target outside
    the repository;
  - `isDocArtifact()` and the historical-run check;
  - the plugin-source and `bypassPermissions` deferrals;
  - adoption detection;
  - `apply_patch` target parsing and the unparseable-patch deferral;
  - `hooks/hooks.json`.

  Add no configuration.

- **R7 · Hook text (ADR §4).** The two lines pinned by
  `validateInstructionLayout` stay byte-identical. New header-comment lines
  describe memory notes and the bookkeeping scope. Every new line that names
  `CLAUDE.md` carries free-path wording.
- **R8 · Hooks README (ADR §4).** `plugins/banzai/hooks/README.md` gains:
  - decision-table rows for a memory note (defer), a bookkeeping write before
    its approval (ask) and after it (allow), and a project write after only a
    bookkeeping approval (ask);
  - an approval-marker paragraph that names both markers and what each
    allows;
  - a Product Notes line on `CLAUDE_CONFIG_DIR`, the bookkeeping roots and
    the unsupported custom memory and plan directories;
  - a Tuning bullet that sends manual-only exemptions to the manual check
    instead of `isDocArtifact()`.
- **R9 · Template (ADR §4).** The Hook Gate section of
  `plugins/banzai/AGENTS.md` names memory notes among the manual-only free
  paths and gains one sentence on the bookkeeping scope. The fresh-adoption
  fixture `after/AGENTS.md` stays a byte-identical copy; the other
  instruction-layout fixtures do not change.
- **R10 · Transition (ADR §5).** One ADR-0044 transition records the hook
  change. `instruction-baseline.mjs --describe` lists exactly
  `plugins/banzai/hooks/spec-gate.cjs`. The authorization cites ADR-0062 by
  path and SHA-256, with a scope of at most 160 characters from
  `A-Z a-z 0-9 space , . : ; -`, and is kept outside the repository. A
  rebuild after publication changes nothing.
- **R11 · Lifecycle and facts.** Before the transition is published, the ADR's
  implementation state is set to its final text, because the transition pins
  the ADR's digest. The decision index and the manifest row move to
  Implemented. The manifest's hook fact names the manual memory-note deferral
  and the bookkeeping scope. Under Q1 (a), the tracker's WP20 Gate 1 item
  gains the scratchpad step.
- **R12 · Release train.** No version change in WP20; the 2.8 version is set
  at Gate 1. `release:validate` keeps stopping at the deferred
  `HOOK_CHANGED_WITHOUT_VERSION_BUMP`, which it checks before the hook,
  layout and extraction checks. Evidence for those checks therefore comes
  from `release-validation.test.ts`, whose fixture copy has no Git history,
  and from `release-candidate-check.mjs`.

## Owner decisions

- **Q1 · Host evidence.**
  - (a) Recommended: hook tests only in WP20. They run the source hook with
    recorded payloads and need no vendor run. Tests cannot prove two host
    assumptions, and the report names both:
    - Claude Code sends `scratchpad_dir` in both events of a call. The
      Claude Code hooks reference, read on 2026-11-05, lists it among the
      common input fields that hook events receive. The field is absent only
      when the session has no scratchpad or the temp directory is
      unavailable, and it requires Claude Code 2.1.257 or later. If the
      assumption fails, a scratchpad approval unlocks code, as it does today,
      and the bookkeeping prompt overstates the narrowing.
    - The plans directory follows `CLAUDE_CONFIG_DIR`. If it does not, plan
      files under a set `CLAUDE_CONFIG_DIR` stay project writes, which is
      today's behavior.

    The tracker's WP20 Gate 1 item gains one step for the first assumption:
    approve one scratchpad write, then confirm that
    `$TMPDIR/banzai-spec-gate/` holds only `bookkeeping-<session>` and that
    the next code edit asks with the first-change reason.

  - (b) A live `claude --plugin-dir plugins/banzai` session in a disposable
    adopted repository during WP20. It records both hook payloads for a
    memory note, a plan file and a scratchpad file, and needs the owner's
    explicit go-ahead for a live vendor run.

## Acceptance

- Hook tests, written first and seen failing against the unmodified hook,
  prove each row of the ADR's Compliance table:
  - memory-note deferral without a marker, and the project marker for a code
    file in the same setup;
  - the exact-match negatives and the `CLAUDE_CONFIG_DIR` variants, including
    unset;
  - all three bookkeeping roots, the bookkeeping sequence in one session,
    the mixed `apply_patch` cases, the
    root exclusions with `TMPDIR` and `CLAUDE_PLUGIN_ROOT` below the
    scratchpad, the `Banzai-Spec-Gate` segment, a `cwd` below the scratchpad,
    a missing, relative or non-string `scratchpad_dir`, and, on POSIX, a case
    variant of a root;
  - an existing `approved-<session>` allowing both write kinds;
  - the runner-mode decision for a memory path and the `.banzai/work/` denial
    beside a memory note.
- The tests set `HOME`, `TMPDIR` and `CLAUDE_CONFIG_DIR` explicitly, clear
  inherited `PLUGIN_ROOT` and `CLAUDE_PLUGIN_ROOT` unless a test sets them,
  never touch the real `~/.claude`, and keep `documentation/`, `CLAUDE.md`,
  `AGENTS.md` and `PROJECT_MANIFEST.md` out of paths that must still ask.
- The report quotes a `git diff` of `spec-gate.cjs` with no hunk inside
  `isDocArtifact()` or the pinned header line. `hooks/hooks.json` is
  unchanged, and `instruction-layouts.test.ts` passes.
- `npm run verify`, `npm run format:check`, `release-validation.test.ts` and
  `node packages/orchestrator/scripts/release-candidate-check.mjs` pass.
  `npm run release:validate` stops only at the deferred
  `HOOK_CHANGED_WITHOUT_VERSION_BUMP`.

## Out of scope

- Prompting on every write to `<config>/settings.json` or installed plugins,
  and narrowing what the project marker allows.
- Custom `autoMemoryDirectory` and plan directories, project-scope subagent
  memory under `.claude/`, and Codex host files.
- The 2.8 version bump and WP12's template restructuring.
