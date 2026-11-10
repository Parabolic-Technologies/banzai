# Gate 1 report

Status: closed by the owner on 2026-11-10 with `Close it`. All nine items are
accepted. The release candidate is `b8b6d1b` (2.8.1) on `dev`.

- Items 1, 5 and 9: the owner accepted them on 2026-11-09, and they are ticked
  in the [tracker](tracker.md).
- Items 3, 4, 6, 7 and 8: they passed in the owner's runs on 2026-11-10. The
  owner accepted them the same day with `Accept all five`, and they are ticked.
- Item 2: the owner accepted it on tests on 2026-11-10 with `Accept on tests`,
  and it is ticked.

Stage 2 can start.

## Candidate

| Commit    | Content                                                                                                                                                                                                                                                                 |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `2c4db3c` | 2.8.0: Stage 1 through WP21, the third WP21 fix and the version bump.                                                                                                                                                                                                   |
| `fa79c8b` | 2.8.1: ADR-0066, date-prefixed work and initiative slugs ([change report](../interactive-slug-selection/change-report.md)). This is outside the brief; the owner added it with `Include it`. The version moved because `plugins/banzai/lib/work-documents.mjs` changed. |
| `b8b6d1b` | The live-harness Codex fix ([change report](../261110-live-harness-codex-fixture/change-report.md)).                                                                                                                                                                    |

On the tree of `b8b6d1b`, `release-candidate-check.mjs` passes. That covers
`npm run verify` (2170 of 2170 tests), `release:validate`, the publication
check and the committed smoke.

## Summary

| #   | Item                                | State                 | Evidence                                    |
| --- | ----------------------------------- | --------------------- | ------------------------------------------- |
| 1   | phpcs case                          | Accepted by the owner | Fixture replay in tests                     |
| 2   | Prose edit re-check (WP4)           | Accepted by the owner | Tests only                                  |
| 3   | Claude-only local install (WP5–7)   | Accepted by the owner | Owner run, 2026-11-10                       |
| 4   | `verify` and live scenarios         | Accepted by the owner | `verify`; live suite on 2.1.290 and 2.1.322 |
| 5   | Release train at 2.8                | Accepted by the owner | `release:validate` passes on 2.8.1          |
| 6   | Initiative skill (WP19)             | Accepted by the owner | Owner run on 2.8.1                          |
| 7   | Memory notes in the hook (WP20)     | Accepted by the owner | Sessions `2405d1a9` and `c276690b`          |
| 8   | Long foreground command probe (WP8) | Accepted by the owner | `pass` on 2.1.290 and 2.1.322               |
| 9   | Planner digest and retry (WP21)     | Accepted by the owner | Real-project run on 2026-11-09              |

## Next

1. Stage 2 (WP9–WP14) starts after the owner commits this gate record.
2. Publishing 2.8.1 is a separate decision under
   [public-publication.md](../../releases/public-publication.md).

## Evidence and steps

### 1. phpcs case

The brief asks for a replay on a fixture repository.
`packages/orchestrator/test/phpcs-verification-fixture.ts` is that replay. It
runs real processes in a real Git repository, using small Node scripts in place
of PHP tools, and fake model adapters.

| Criterion                                                         | Test                                                                                                                 |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| The command is visible at the plan gate                           | `plan-gate-verification.test.ts`: "the plan gate lists every check approval binds before the decision"               |
| The blocked summary shows argv, exit code, stderr tail, log paths | `verification-failure-details.test.ts`: "a failing required check shows its command, outcome, output tail and logs"  |
| Every required check ran                                          | `verification-failure-details.test.ts`: "two failed required checks are retried in one action"                       |
| Retry warns about a deterministic failure                         | `verification-failure-details.test.ts`: "retry warns only while the failed command and observed files are unchanged" |

Limit: no model or real phpcs took part. The owner accepted this replay as enough
on 2026-11-09.

### 2. Prose edit re-check

`plan-recheck.test.ts` covers it: "a prose edit is re-checked in place, approved
and linked by the re-check", and "the CLI prints the waiting copy, refuses a note
and re-checks without resuming".

Limit: no real run has used it yet. To confirm it, edit a prose line of `plan.md`
at the next real plan gate and choose the re-check. No manual hashing should be
needed. The owner accepted these tests as enough on 2026-11-10, and the real
confirmation is a follow-up.

### 3. Claude-only local install

Result: passed on 2026-11-10 in `~/banzai-gate-1-install`, with Claude Code
2.1.322 and `CLAUDE_CONFIG_DIR=~/banzai-gate-1-config`.

- `.claude/settings.local.json` adds the directory marketplace `~/www/banzai`
  and enables `banzai@banzai-plugins`. Doctor passes `claude.plugin-scope`.
- The SHA-256 of `.banzai/config.json`, `74b19d66…94c28`, is the same before and
  after `banzai model --local`.
- `.banzai/config.local.json` holds the two roles the owner changed, the planner
  and the implementer. The reviewer stays in the shared file.
  `git check-ignore` reports the rule at `.gitignore:7`.
- Doctor passes `config.local` and `claude.version` (2.1.322, minimum 2.1.290).
  Its `Models:` block marks the two local roles `(local)` and shows a Claude
  reviewer: `claude-fable-5-1`, chosen at `banzai init`.
- Doctor's `project.guidance` fails, as expected in a repository with no
  `AGENTS.md` and no manifest. `init` warns about this.

Provenance: the run used the linked `banzai` command. Its `dist` was rebuilt at
12:56 from `2c4db3c` plus the ADR-0066 work, which was not yet committed. That
work changes only how `banzai run` and the interactive start finalize a work
slug. It does not touch init, model or doctor.

Recipe corrections:

- Run every step in a terminal where `CLAUDE_CONFIG_DIR` names a new, signed-in
  configuration directory. Otherwise a user-scope install masks the
  local-scope result. `banzai init` and `banzai model --local` also need a
  terminal.
- In `banzai model --local`, change at least one role. If every role is left at
  Keep, the command writes no `config.local.json`.

### 4. `verify` and live scenarios

Result: passed on `b8b6d1b`.

- `npm run verify` passes inside the release-candidate check: typecheck, lint,
  2170 of 2170 tests and `build:check`.
- The live suite, with Codex 0.166.0, reports `pass` on Claude Code 2.1.322 and
  on 2.1.290. All 17 checks pass, with 2 model invocations per run.

The first run, on `fa79c8b`, failed two checks: `codex.source_denied`
(`DENIAL_NOT_OBSERVED`) and `codex.structured_result`
(`MODEL_INVOCATION_FAILED`). Both came from live-harness defects present since
v2.3.0, and production Codex runs were unaffected. The owner approved a quick
fix, which is now `b8b6d1b`. Details are in its change report.

Prepare the authentication once:

```bash
mkdir -p ~/banzai-live-auth/codex ~/banzai-live-auth/claude
```

```bash
CODEX_HOME=~/banzai-live-auth/codex codex login
```

`codex login` leaves `tmp/arg0-macos` with symbolic links, and the suite refuses
an auth root that contains links. Delete that directory:

```bash
rm -rf ~/banzai-live-auth/codex/tmp
```

Claude Code keeps its sign-in in the macOS Keychain, so a copied configuration
directory is signed out. Use a token instead. The Claude auth root then needs
only one file, because the suite refuses an empty root:

```bash
printf '{}\n' > ~/banzai-live-auth/claude/settings.json
```

```bash
claude setup-token
```

Before every run, in the shell that runs the suite, read the token without
echoing it:

```bash
read -rs CLAUDE_CODE_OAUTH_TOKEN && export CLAUDE_CODE_OAUTH_TOKEN
```

```bash
export BANZAI_LIVE_CODEX_AUTH_ROOT="$HOME/banzai-live-auth/codex" BANZAI_LIVE_CLAUDE_AUTH_ROOT="$HOME/banzai-live-auth/claude"
```

A shell without these variables reports `AUTH_ROOT_UNAVAILABLE` for both
vendors.

Rebuild the bundle on the commit under test:

```bash
npm run build:dist
```

`compatibility:live` runs the untracked local
`packages/orchestrator/dist/banzai.mjs`. `release-candidate-check.mjs` builds in
an isolated copy and does not refresh it. The first run on `b8b6d1b` used a
stale bundle and repeated both old failures.

On the current release:

```bash
npm run compatibility:live -- --confirm-live
```

On Claude Code 2.1.290, using the install from the
[probe recipe](../wp08-stable-claude-phases/gate-1-probe.md):

```bash
PATH="$HOME/banzai-gate-1-client/node_modules/.bin:$PATH" npm run compatibility:live -- --confirm-live
```

### 5. Release train at 2.8

`npm run version:set -- 2.8.0` set nine fields in seven files, and
`npm run release:validate` passes. The deferred
`HOOK_CHANGED_WITHOUT_VERSION_BUMP` is gone, and it was not hiding any other
failure. Details: [change report](../release-2-8-0/change-report.md). The owner
accepted this item on 2026-11-09.

Since then the candidate moved to `2.8.1` with `fa79c8b`, a version bump for
the ADR-0066 change. `release:validate` passes on `fa79c8b` and in the
release-candidate check of `b8b6d1b`.

### 6. Initiative skill

Result: passed on 2.8.1 (`fa79c8b`) in `~/banzai-gate-1-init`.

- `/banzai:initiative start cli-greeter`, with a brief from the owner, wrote
  only `brief.md` and `tracker.md`. Both are in
  `documentation/initiatives/261110-cli-greeter/`.
- The tracker's work-directory cells carry no date: `p1-argument-parsing` and
  `p2-output-formatting`.
- `/banzai:initiative next` wrote nothing. It handed off P1 with the work
  directory `documentation/work/261110-p1-argument-parsing/` and the `feature`
  route.

An earlier run on `2c4db3c`, before ADR-0066, also passed, with undated
directories. The owner's `Include it` made the rerun necessary.

Recipe corrections:

- Name the mode and write the brief yourself. Send
  `/banzai:initiative start <slug>` with the brief in the same message. Without
  a mode the skill runs `next`, and it never writes brief content itself. The
  brief needs at least one stage with a gate list, and packages with an ID, a
  title and "Done when" items.
- Exclude tool files such as `.serena/` through `.git/info/exclude` first.
  `next` refuses a handoff while anything outside the initiative directory has
  changed.

### 7. Memory notes in the hook

Result: passed on 2026-11-10 in `~/banzai-gate-1-session`, with the plugin
installed at user scope from this checkout. `plugins/banzai/hooks/` is
identical in `2c4db3c` and `b8b6d1b`.

1. Session `2405d1a9` wrote the memory note `gate-1-scratch-project.md` and
   `MEMORY.md` without a prompt, and no marker appeared.
2. In the same session, the `greet.js` write asked, and the owner rejected it.
   Claude Code keeps no hook reason for a rejected prompt. The same write,
   replayed through the hook in a temporary directory, returned `ask` with
   `first code/codebase change this session`.
3. Session `c276690b` asked before a scratchpad write, with the reason
   `host bookkeeping write (plan, subagent memory or session scratchpad)`. After
   the approval, only `bookkeeping-c276690b…` appeared.
4. In the same session, the `greet.js` write asked with
   `banzai spec-gate: first code/codebase change this session`, recorded as
   `reasonCode: hook:PreToolUse`. The owner approved it to record the reason.
   `approved-c276690b…` then appeared beside the bookkeeping marker.

Recipe corrections:

- Adopt the repository first, with `.banzai/config.json` or a root
  `PROJECT_MANIFEST.md`. This run used `touch PROJECT_MANIFEST.md`. The hook
  gates manual sessions only in adopted projects, so in an unadopted
  repository nothing asks.
- Start Claude without the `CLAUDE_CONFIG_DIR` from item 3, so the user-scope
  plugin loads.
- In step 4, approve the prompt instead of rejecting it. A rejected prompt
  leaves no hook reason in the transcript.

### 8. Long foreground command probe

Result: `pass` on Claude Code 2.1.290 and on 2.1.322. In both runs, the `phase`
and `resumed` invocations each produced:

- one `result` event;
- no permission denials;
- no background events;
- the sentinel present at the first result;
- exit code 0 and no error code.

Provenance: the probe bundle was built at 13:06 from `2c4db3c` plus the ADR-0066
work, which was not yet committed. That work changes only the phase guidance
text about artifact storage and slugs. It does not change background tasks,
the Bash timeout or result handling. `b8b6d1b` changes only the Codex adapter
and the live harness.

### 9. Planner digest and retry

The owner's run `20261106150203-initialize-pnpm-5b801775` in
`demio-ai-automations-api` provides the real-project evidence from 2026-11-09:

- it reached the plan gate with a runner-recorded digest, and the owner approved
  it;
- a later planner block continued with `banzai retry` in the resumed session.

Retries of this run exposed two false positives in the runner-control plan check,
and a new run in the same project exposed a third. All three are fixed in the WP21
[change report](../wp21-planner-digest-and-retry/change-report.md).
That run's later block came from the project's proto and pnpm setup, not from
WP21.

Automated evidence: `result-digest.test.ts`, "a plan remainder digest the planner
fabricated is recorded by the runner, not rejected". The owner accepted this item
on 2026-11-09.

## Observations and follow-ups

- `banzai model` (item 3): Ctrl-C prints
  `[UNEXPECTED_ERROR] User force closed the prompt with SIGINT` and exits 1.
  `ExitPromptError` reaches the generic handler in `cli.ts`, while the
  interactive session handles the same case as "Interactive session closed".
  This is a quick-fix candidate.
- `/banzai:initiative gate` (item 6): the mode runs before a stage is done and
  writes a report with no evidence. It never overwrites a report, so the real
  gate run then refuses until that file is deleted. The skill warns about this.
  A warning while the stage's packages are not committed would prevent it.
  This is an improvement candidate.
- Claude Code (item 7): Claude Code drops the hook's reason from the transcript
  when a prompt is rejected, and its file prompt does not show the reason.
  Evidence of an `ask` needs an approval or a hook replay.
- Item 2 follow-up: confirm the prose edit re-check at the next real plan gate.
- WP6 follow-up from 2026-11-04, still open: check the WP5
  `claude.plugin-scope` doctor message against ADR-0008's privacy rules. No
  change report records it.
- Cleanup after the gate: `~/banzai-gate-1-session`, `~/banzai-gate-1-init`,
  `~/banzai-gate-1-install`, `~/banzai-gate-1-config`, `~/banzai-gate-1-client`,
  `~/banzai-live-auth` and `~/banzai-live-diag`.
