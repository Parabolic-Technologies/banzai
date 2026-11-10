# WP5 implementation report

Status: report ready, not committed · Requirements:
[requirements.md](requirements.md) · Plan: [plan.md](plan.md) · Authority:
[ADR-0008](../../decisions/0008-read-only-doctor-diagnostics.md) as amended by
ADR-0049

## What changed

| Area                   | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Install guide (R1–R3)  | `documentation/getting-started.md` "Claude Code plugin" leads with terminal commands at `--scope local`, a table of the three scopes with their settings files, the team steps for `--scope project`, the commands that move a user-scope install, the in-session `/plugin` dialog choices and the VS Code **Manage plugins** route (`/plugins`). It states that the CLI needs a standalone `claude` on `PATH`. The expected result names `claude plugin list`. |
| Troubleshooting (R8)   | A row for the `claude.plugin-scope` warning.                                                                                                                                                                                                                                                                                                                                                                                                                    |
| README (R4)            | The install pointer links to the local or project scope install.                                                                                                                                                                                                                                                                                                                                                                                                |
| Settings reader (R5)   | `inspectClaudeUserPluginScope(env)` in `claude-permissions.ts` reuses the existing user-settings path (`$CLAUDE_CONFIG_DIR/settings.json`, else `$HOME/.claude/settings.json`). It returns `enabled` with the sorted `banzai@<marketplace>` keys set to `true`, `not_enabled`, or `unreadable` (a read error other than ENOENT, invalid JSON or a non-object root). It reads no plugin cache and starts no process.                                             |
| Doctor check (R5)      | `claude.plugin-scope` (category `config`) follows `claude.permissions`. It warns with one fix and a link to the guide when user settings enable Banzai, passes otherwise, and is skipped for an unreadable or malformed file. It never fails and never changes `ready`. `DoctorDependencies.claudeSettingsEnvironment` injects `HOME` and `CLAUDE_CONFIG_DIR`.                                                                                                  |
| Doctor v6 (R6, Q1)     | `banzai-doctor/v6`, `schemaVersion: 6`; fields and status semantics unchanged. `documentation/orchestrator.md` describes the check and says that v1–v5 keep their identities. `scripts/smoke-committed.mjs`, `PROJECT_MANIFEST.md` and `MODULES.md` pin v6. Per Q1, WP6 extends v6 without another bump.                                                                                                                                                        |
| Investigation (R7, Q2) | Docs, local `claude plugin` help and a live probe; see Findings for WP15. No skill or policy file changed, so no instruction transition was needed.                                                                                                                                                                                                                                                                                                             |

## Tests

- `claude-permissions.test.ts`: the reader for an absent file, sorted matches
  from several marketplaces, `other@banzai` and `false` excluded, a null
  `enabledPlugins`, invalid JSON, and an empty `CLAUDE_CONFIG_DIR` falling back
  to `~/.claude`.
- `doctor.test.ts`:
  - the fixed order gains `claude.plugin-scope`, and the v6 identity is pinned;
  - the shared `dependencies()` helper points the settings environment at an
    absent home, so no test reads the developer's settings;
  - a new test covers the warning with its exact message and fix, readiness
    and the other checks unchanged, the text `Fix:` line, and no write to the
    settings tree;
  - `CLAUDE_CONFIG_DIR` with a fork marketplace;
  - five pass documents, and project-only and local-only enablement passing;
  - three malformed documents and a directory in place of the file, each
    skipped.
- `doctor-cli.test.ts` and `committed-smoke.test.ts`: the v6 identity.

## Checks

- Focused suites pass: `claude-permissions` (7), `doctor` (21), `doctor-cli`
  (4) and `committed-smoke` (17, after `npm run build`).
- Manual run of the built CLI against a temporary `CLAUDE_CONFIG_DIR`:
  - with `"banzai@banzai-plugins": true`, `[WARNING] claude.plugin-scope` with
    its `Fix:` line, `banzai-doctor/v6`, `ready: true`;
  - with `false`, `[PASS]`.
- `npm run format:check`: pass.
- `npm run verify` (typecheck, lint, test, build:check):
  - the first run failed lint with seven `no-unnecessary-condition` errors in
    the new doctor test: optional chains after `assert.equal`, which narrows.
    Fixed with `assert.ok`;
  - the final run passes: 1845/1845 tests, lint with 0 errors and 422
    warnings (unchanged), and build:check.
- `npm run release:validate` fails only with
  `HOOK_CHANGED_WITHOUT_VERSION_BUMP`, which is deferred to the Gate 1
  release. WP5 changes no hook file. `npm run release:check` was not run.

## Findings for WP15

Probe environment: Claude Code 2.1.316, `claude -p --model haiku`,
`--setting-sources project,local`, `--strict-mcp-config`,
`--no-session-persistence`. The probe used scratch repositories in the session
scratchpad. Each run asked the model, without tools, to quote every `CANARY-`
token in its skill listing. Each skill description carried a unique random
token. The probe used six short sessions, about $0.011 in total; the Q2 (b)
wording had said one session.

1. **Does `paths:` keep the description out of context?**
   - For a project skill (`.claude/skills/`), yes. With no matching file read,
     a `paths: ["**/*.probe"]` skill was missing from the init `skills` list
     and its token was not in context, while a plain project skill's token
     was. After a Read of `notes/sample.probe`, its token appeared. Observed,
     and consistent with the documented rule behavior: a path-scoped rule loads
     on Read, Write or Edit of a matching file.
   - For a plugin skill, no. Two plugin skills with `paths:` (one with
     `**/*.probe`, one with `PROJECT_MANIFEST.md` and `.banzai/**`) loaded with
     `--plugin-dir` and no matching file in the repository. Both appeared in the
     init `skills` list and both tokens were in context at session start. The
     model also invoked one through the `Skill` tool without an error.
     Observed.
   - Not tested: interactive sessions, and a plugin installed from a
     marketplace rather than loaded with `--plugin-dir`.
   - The skills documentation says only that Claude "loads the skill
     automatically only when working with files matching the patterns". It
     does not say whether the description stays in context.
2. **Can `paths:` express "adopted repository"?** No, on the observed
   behavior. Activation follows file access, not file presence, and patterns
   resolve from Claude's current working directory (documented; files outside
   it never match). A `PROJECT_MANIFEST.md` pattern would activate only after
   Claude reads that file. For plugin skills it does not gate the listing at
   all.
3. **Interplay with `disable-model-invocation` and explicit calls.**
   - A plugin skill with `disable-model-invocation: true` was absent from
     context at start: its token was never quoted (observed). The docs say
     "Description not in context, full skill loads when invoked".
   - An explicit `/probe:scoped` ran the `paths:` plugin skill's body without a
     matching file (observed).
   - Banzai already sets `disable-model-invocation: true` on `orchestrate` and
     `project-manifest`. `claude plugin details banzai@banzai-plugins`
     (installed 2.7.4) still estimates about 130 always-on tokens for each,
     and about 1,210 for the plugin. The estimate seems not to subtract
     descriptions kept out of context. This is unverified beyond this
     comparison.
4. **Minimum versions.** Unknown. The skills page gives no version for
   `paths:` or `disable-model-invocation`. The behavior above was observed on
   2.1.316 only.

For WP15:

- `paths:` is not a lever for Banzai as a plugin on 2.1.316.
- `disable-model-invocation: true` removes a description but also stops
  automatic selection.
- The documented user-side alternatives are:
  - `skillOverrides` set to `"name-only"`, which lists a skill without its
    description;
  - local or project install scope, which WP5 now recommends.

## Deviations from the plan

- **Probe scope.** The live probe ran six short sessions, not one. Two were
  controls, an empty repository and project skills, which were needed to read
  the first result. Total cost about $0.011.
- **VS Code wording.** The documentation shows that the VS Code panel opens
  **Manage plugins** with `/plugins` and offers the same three scopes, so the
  guide gives those steps rather than only "use the dialog".

## Open questions

None. `HOOK_CHANGED_WITHOUT_VERSION_BUMP` stays deferred to the Gate 1 release.
