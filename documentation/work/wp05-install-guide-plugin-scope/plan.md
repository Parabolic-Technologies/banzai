# WP5 plan

Requirements: [requirements.md](requirements.md). Authority:
[ADR-0008](../../decisions/0008-read-only-doctor-diagnostics.md) as amended by
ADR-0049; no new ADR.

## Approach

- **One settings reader.** The user-settings path logic already lives in
  `claude-permissions.ts`. The plugin-scope reader sits beside it and reuses
  it, so doctor resolves `CLAUDE_CONFIG_DIR` and `HOME` the same way.
  `doctor.ts` already imports that module, so no new import edge or module
  needs registering in `import-boundaries.mjs`.
- **Advisory only.** The new check can be warning, pass or skipped, never fail.
  Readiness code is untouched.
- **Docs first for the commands.** The exact `--scope` flags and the
  user-scope removal command are confirmed from `claude plugin … --help`
  before the guide and the doctor fix text use them.

## Tasks

1. **Confirm CLI flags.** Read `claude plugin marketplace add --help`,
   `claude plugin install --help`, `claude plugin uninstall --help` and
   `claude plugin disable --help`. Record the scope flags, the default scope and
   the command that removes or disables a user-scope install. Starts no session.
2. **Reader (`claude-permissions.ts`).** Export
   `inspectClaudeUserPluginScope(env)`, which returns one of:
   - `{ state: "enabled", path, keys }`, with matching `banzai@<marketplace>`
     keys whose value is `true`, sorted;
   - `{ state: "not_enabled", path }`, for an absent file, no `enabledPlugins`
     object or no matching key;
   - `{ state: "unreadable", path }`, for a read error other than ENOENT,
     invalid JSON or a non-object root.

   It uses the existing `settingsFile("user", …)` resolution. The plugin name
   is the key's text before the last `@`.

3. **Doctor check (`doctor.ts`).**
   - Add `claudePluginScopeCheck`, pushed directly after `claude.permissions`.
   - Add an optional `claudeSettingsEnvironment` to `DoctorDependencies`. It
     defaults to `process.env` and only `HOME` and `CLAUDE_CONFIG_DIR` are
     read.
   - Messages and the fix follow requirement R5. The fix action names the
     local and project install commands and the removal command from task 1.
     Its documentation link is
     `documentation/getting-started.md#claude-code-plugin`.
   - Change `DoctorReport` and the assembled report to `banzai-doctor/v6`,
     `schemaVersion: 6`.
4. **Tests.**
   - `claude-permissions.test.ts`: the reader for each state, an unrelated
     plugin, a `false` value, a non-object `enabledPlugins`, a key with two `@`
     and `CLAUDE_CONFIG_DIR`.
   - `doctor.test.ts`:
     - the fixed id order gains `claude.plugin-scope`;
     - the shared test dependencies point the settings environment at a
       temporary home, so no test reads the real one;
     - warning, pass and skipped cases;
     - project-only and local-only enablement give pass;
     - `ready` and the exit code are unchanged by the warning;
     - the v6 identity.
   - `doctor-cli.test.ts`: the v6 identity, and a text render of the warning
     with its `Fix:` line.
   - `committed-smoke.test.ts` and `scripts/smoke-committed.mjs`: the v6
     identity.
5. **Docs.**
   - `documentation/getting-started.md`:
     - the Claude Code plugin section, rewritten per R1–R3, keeping the
       `#claude-code-plugin` anchor;
     - the "Use only the plugin" step, aligned;
     - a troubleshooting row for the doctor hint.
   - `README.md`: the install pointer (R4).
   - `documentation/orchestrator.md`:
     - the doctor section names v6 and the new check;
     - "v1–v5 reports keep their identities; consumers must negotiate v6".
   - `PROJECT_MANIFEST.md`: lines on the doctor v6 identity and the check,
     keeping every fragment pinned in `check-release.mjs`.
   - `packages/orchestrator/MODULES.md`: the doctor entry.
6. **Investigation (R7, Q2).** Read the public Claude Code documentation on
   skills (`paths:`, `disable-model-invocation`), plugins and the changelog.
   Per Q2 (b), also run the scratch-repository probe, approved on 2026-11-02.
   Record each answer with its source and the label documented, observed or
   unknown under "Findings for WP15" in the implementation report. Add a
   tracker log line that points to it.
7. **Report and tracker.** Write `implementation-report.md`. Set the tracker
   WP5 row to report ready, and record the Q1 decision about the v6 lifetime.

## Checks

- Focused suites: `claude-permissions`, `doctor`, `doctor-cli`,
  `committed-smoke` and `release-validation`, each run with
  `node packages/orchestrator/scripts/test.mjs --file <name>.test.ts`.
- `npm run format:check`.
- `npm run verify`.
- `npm run release:validate`: the only expected failure is the deferred
  `HOOK_CHANGED_WITHOUT_VERSION_BUMP`.
- A manual run of `banzai doctor` against a temporary `CLAUDE_CONFIG_DIR` with
  user-scope enablement and without it.

## Sequencing

1. Task 1 runs first, because the guide and the fix text depend on its
   commands.
2. Tasks 2–4 follow as one code change.
3. Task 5 comes after the code, so the docs quote the final messages.
4. Task 6 is independent and can run at any point before the report.
5. Task 7 comes last.

Size: 1–2 days.
