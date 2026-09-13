# hooks

`spec-gate.cjs` enforces authorized-workflow-before-code where the host supports
hooks.

## Decisions

Hook type: `PreToolUse` + `PostToolUse` for `Edit`, `Write`, `MultiEdit`,
`NotebookEdit`, and `apply_patch`.

| Target / condition                                                                     | Decision |
| -------------------------------------------------------------------------------------- | -------- |
| manual free paths: `documentation/**`, `PROJECT_MANIFEST.md`, `CLAUDE.md`, `AGENTS.md` | defer    |
| first code/codebase change in session                                                  | ask      |
| code/codebase change after approval in same session                                    | allow    |
| orchestrated code change with matching active run and approval digest                  | allow    |
| orchestrated lite code change with matching active run and workflow digest             | allow    |
| orchestrated selector write with no code authorization                                 | deny     |
| orchestrated write to an approved description, plan, or ADR                            | deny     |
| authorized implementation/fix write to a new report or other unapproved documentation  | allow    |
| orchestrated reviewer mutation of any path, including its attempt candidate            | deny     |
| orchestrated change with stale/missing runner state or artifact digest                 | deny     |
| manual mode with `permission_mode` `bypassPermissions`                                 | defer    |
| manual mode while editing this plugin source under `cwd`                               | defer    |

Session key: `session_id`.

Approval marker: `$TMPDIR/banzai-spec-gate/`, written only by `PostToolUse`
after an approved edit.

## Optional Orchestrator Mode

When runner context is present, writes use repository-local runner state
instead of the session marker. Strict implementation/fix phases provide
`BANZAI_RUN_ID` and `BANZAI_APPROVAL_DIGEST`; lite `feature`/`quick-fix`
implementation provides `BANZAI_RUN_ID` and `BANZAI_WORKFLOW_DIGEST`. Both
orchestrated reviewers receive only `BANZAI_RUN_ID` and
`BANZAI_APPROVAL_DIGEST` as runner context for required reads; review and
selection provide no artifact write authorization. The runner owns rendering,
validation and publication of `banzai-feature-review/v4` Markdown. The hook:

- requires the run to be the active run in `.banzai/active-run.json`;
- denies every mutation while state is `reviewing` or an active review attempt
  exists, including blocked attempts and stale inherited write grants;
- requires state `implementing` or `fixing` for strict
  authorization, or `implementing` for lite authorization;
- recomputes either the approved description/ADR/plan bundle digest or the
  persisted workflow-selection digest;
- accepts only `feature` or `quick-fix` for lite authorization;
- never treats a workflow digest as plan approval or permits both digests in one
  process;
- denies writes to every path in that approved bundle;
- denies writes to `.banzai` runner control files and all attempt evidence;
- allows implementation/change reports and other documentation outside the
  approved bundle;
- does not create a manual session-approval marker.

Missing, partial, invalid, or stale runner context fails closed. When these
variables are absent, the existing manual session gate is unchanged.
Standalone reviewers own durable `banzai-standalone-review/v1` Markdown under that
manual gate; they do not require an orchestrator.

## Product Notes

- Claude Code sets `CLAUDE_PLUGIN_ROOT` and runs trusted plugin hooks after
  reload.
- Codex may set `PLUGIN_ROOT`; the script accepts both variables.
- Codex `apply_patch` payloads are parsed from patch headers.
- If a Codex patch target cannot be parsed, the hook defers.
- Codex requires hook trust via `/hooks` or `--dangerously-bypass-hook-trust`.
- Codex `apply_patch` interception is not guaranteed; skill gates still apply.
- In manual mode, ADR files remain free to draft. In orchestrated
  implementation/fix mode, accepted ADRs in the approved bundle are immutable.
  The hook does not parse or approve ADR status; the `architecture-decision`
  gate governs acceptance, rejection, deprecation, and supersession.
- The hook is not one of the five decision gates in `AGENTS.md`. It guards paths;
  it does not approve plans, decisions, or findings.
- Node must be on `PATH`; if absent, the hook no-ops.

## Tuning

- Prompt on every code edit: remove the `PostToolUse` block from `hooks.json`.
- Free more paths: edit `isDocArtifact()` in `spec-gate.cjs`.
- After hook edits, reload Claude Code or restart Codex and re-trust via
  `/hooks`.
