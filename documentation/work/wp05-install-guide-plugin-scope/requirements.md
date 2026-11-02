# WP5 · Install guide, plugin scope, doctor hint

Status: report ready · Program:
[banzai 2.8–2.9](../release-2-8-2-9-program/tracker.md) · Source:
[brief, WP5](../release-2-8-2-9-program/brief.md#wp5--install-guide-plugin-scope-doctor-hint)

## Problem

`documentation/getting-started.md` shows only the in-session `/plugin`
commands, and the VS Code chat does not offer them. Neither form says which
scope it uses. The terminal default is user scope, which loads the nine
model-invocable Banzai skill descriptions (about 2,000 characters) into every
Claude Code session in every repository. Only the phrase "Auto-select only in a
Banzai-adopted repository" in each description keeps those skills from
triggering in other repositories. `banzai doctor` does not report the scope.

## Authority

- [ADR-0008](../../decisions/0008-read-only-doctor-diagnostics.md) as amended
  by ADR-0049. Doctor stays offline and read-only, never invokes a vendor CLI,
  and versions its JSON object when the field set or the status semantics
  change. The brief assigns no new ADR to this package.

## Requirements

- **R1 · Terminal install for Claude Code.** The guide's "Claude Code plugin"
  section leads with terminal commands at local scope:

  ```bash
  claude plugin marketplace add Parabolic-Technologies/banzai --scope local
  claude plugin install banzai@banzai-plugins --scope local
  ```

  It then gives the same pair with `--scope project` for a team. For each scope
  it names the settings file the commands write to:
  - local: `.claude/settings.local.json`, for this repository and this
    developer;
  - project: `.claude/settings.json`, which the team shares through Git.

  For a team, the guide also says to review and commit
  `.claude/settings.json`.

- **R2 · Scope advice.** The guide recommends local scope for a first try and
  project scope for a team. It says that user scope (the CLI default when
  `--scope` is omitted) remains possible but loads the skill descriptions in
  every repository. It gives the commands that move an existing user-scope
  install to local or project scope. The in-session `/plugin` form stays as an
  alternative, with a note to choose the repository scope in its dialog.
- **R3 · VS Code.** The guide says that the VS Code chat has no `/plugin`
  command. Use its Manage plugins dialog (Claude Code 2.1.16 or later) or the
  terminal commands from R1. The Banzai CLI starts Claude phases through a
  standalone `claude` executable on `PATH`, so the VS Code extension alone is
  not enough for `banzai run`.
- **R4 · README.** The README install pointer mentions the local-scope terminal
  install and links to the guide section. Full commands live only in the guide.
- **R5 · Doctor check `claude.plugin-scope`.** A new check in category
  `config`, placed directly after `claude.permissions` in the fixed order.
  - It reads one file, the Claude user settings, resolved the same way as in
    `claude-permissions.ts`: `$CLAUDE_CONFIG_DIR/settings.json` when that
    variable is set, otherwise `$HOME/.claude/settings.json`. It never runs
    `claude plugin list` or any other process. It reads no plugin cache such as
    `installed_plugins.json`, uses no network and writes nothing.
  - It runs whatever the configuration state and the configured roles. The
    skills load in interactive Claude Code sessions, not only in Banzai phases.
  - **warning:** `enabledPlugins` is an object with at least one key whose
    plugin name (the part before the last `@`) is `banzai` and whose value is
    exactly `true`. Any marketplace name matches, so forks and directory
    marketplaces are covered. The message names the settings file and the
    matching keys. It says that the skill descriptions load in every
    repository. One fix gives the local and project install commands and the
    user-scope removal command, with
    `documentation/getting-started.md#claude-code-plugin`.
  - **pass:** the file is absent, has no `enabledPlugins` object, or has no
    matching key set to `true`. The message is "Banzai is not enabled in Claude
    user settings." It has no fix. Project and local settings never produce a
    hint.
  - **skipped:** the file exists but is unreadable, is not valid JSON or is not
    an object. The message says that the plugin scope was not inspected. It
    has no fix.
  - The check never fails. `ready` and the exit code ignore it.
  - Tests inject the environment, so no test reads the developer's real
    settings.
- **R6 · Doctor JSON v6.** The added check changes the `banzai-doctor/v5`
  check set, so the report becomes `banzai-doctor/v6` with `schemaVersion: 6`.
  Field names, status values and readiness semantics are unchanged.
  `documentation/orchestrator.md` says that v1–v5 reports keep their
  identities and that consumers must negotiate v6. The committed smoke, the
  tests, `PROJECT_MANIFEST.md` and `MODULES.md` pin the new identity. For the
  link to WP6, see Q1.
- **R7 · `paths:` investigation, no product change.** The package answers, and
  records for WP15:
  1. whether a skill's `paths:` frontmatter keeps its description out of the
     session context until a matching file is read, or only stops automatic
     invocation;
  2. whether a `paths:` pattern can express "adopted repository" (a root
     `PROJECT_MANIFEST.md` or `.banzai/`), and from which directory patterns
     resolve;
  3. how `paths:` combines with `disable-model-invocation: true` and with an
     explicit `/banzai:<skill>` call;
  4. the minimum Claude Code version for each behavior.

  Each answer cites its source and says whether it is documented, observed or
  unknown. No skill file changes, so no instruction transition is needed.

- **R8 · Documentation.**
  - `documentation/orchestrator.md`: the doctor section lists the new check and
    its statuses.
  - The getting-started troubleshooting table: the user-scope hint.
  - `PROJECT_MANIFEST.md`: facts for the doctor v6 identity and the check.
  - `packages/orchestrator/MODULES.md`: the doctor module entry.
  - The tracker records the WP5 status and decisions.

## Owner decisions

Decided on 2026-11-02 with `Q2 with a live probe`: Q1 (a) and Q2 (b).

- **Q1 · Doctor version across WP5 and WP6.** WP6 also changes the doctor JSON
  (the effective model and its source per role).
  - **(a) Recommended:** WP5 introduces v6. WP6 extends v6 without another bump,
    because both packages ship in the 2.8 release and no v6 report is released
    between them. The tracker records that v6 is open until Gate 1.
  - **(b)** WP5 publishes v6 and WP6 publishes v7.
- **Q2 · Investigation method for R7.**
  - **(a) Recommended:** public Claude Code documentation and changelog, plus
    local `claude … --help` output. No session is started and no model is
    called. Answers the sources do not settle are recorded as unknown, each
    with the probe that would settle it.
  - **(b)** As (a), plus one live probe in a scratch repository: a skill with
    `paths:` and a session whose context is inspected before and after a
    matching file is read. This needs your explicit go-ahead and one model
    session.

## Acceptance

1. By following the guide alone, a new user installs the plugin from a
   terminal at local scope, or at project scope for a team, and sees which file
   each scope writes.
2. A VS Code user finds the Manage plugins route and the requirement for a
   standalone `claude` on `PATH`.
3. Doctor reports `claude.plugin-scope` as follows:
   - warning, with the fix, when the user settings hold
     `"banzai@banzai-plugins": true` or another `banzai@<marketplace>` set to
     `true`, including under `CLAUDE_CONFIG_DIR`;
   - pass when the file is absent, `enabledPlugins` is missing, the key is
     `false`, only another plugin is enabled, or Banzai is enabled only in
     `.claude/settings.json` or `.claude/settings.local.json`;
   - skipped for an unreadable or malformed file.

   In every case `ready` and the exit code are unchanged.

4. `banzai doctor --json` reports `banzai-doctor/v6`, `schemaVersion: 6`, with
   the new id after `claude.permissions`. The text report shows the warning and
   its `Fix:` line.
5. Doctor still starts no vendor process.
6. The R7 findings are recorded with sources. No skill or plugin policy file
   changed.
7. Documentation checks pass:
   - `npm run format:check` and `npm run verify` pass;
   - `npm run release:validate` fails only with the deferred
     `HOOK_CHANGED_WITHOUT_VERSION_BUMP`.

## Out of scope

- Changing skill frontmatter (`paths:`, `disable-model-invocation`), which is
  WP15.
- Changing the scope automatically, writing Claude settings, or reading
  managed or enterprise settings.
- Codex plugin scope.
- The local model override and its doctor fields (WP6).
