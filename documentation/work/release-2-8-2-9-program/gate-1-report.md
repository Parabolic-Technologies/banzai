# Gate 1 report

Status: open, waiting for the owner. Stage 1 packages are committed through
`d84ba84`. The `2.8.0` version change and the fix for WP21's third false positive
are in the working tree, uncommitted.

Stage 2 starts only after the owner closes this gate. The owner accepted items 1,
5 and 9 on 2026-11-09, and they are ticked in the [tracker](tracker.md). The other
items stay unticked until the owner decides them.

## Summary

| #   | Item                                | State                   | Evidence so far                |
| --- | ----------------------------------- | ----------------------- | ------------------------------ |
| 1   | phpcs case                          | Accepted by the owner   | Fixture replay in tests        |
| 2   | Prose edit re-check (WP4)           | Ready for owner's check | Tests only                     |
| 3   | Claude-only local install (WP5–7)   | Needs the owner's run   | Tests and documentation        |
| 4   | `verify` and live scenarios         | Needs the owner's run   | `verify` passes; live not run  |
| 5   | Release train at 2.8                | Accepted by the owner   | `release:validate` passes      |
| 6   | Initiative skill (WP19)             | Needs the owner's run   | Skill content tests only       |
| 7   | Memory notes in the hook (WP20)     | Needs the owner's run   | Hook tests only                |
| 8   | Long foreground command probe (WP8) | Needs the owner's run   | Verdict tests only             |
| 9   | Planner digest and retry (WP21)     | Accepted by the owner   | Real-project run on 2026-11-09 |

## Suggested order

1. Commit the `2.8.0` change. `compatibility:live` refuses tracked changes with
   `LIVE_CANDIDATE_DIRTY`, and items 3, 6 and 7 should install this version.
2. Decide item 2 from the evidence below.
3. Run items 3, 6 and 7 together in one scratch repository.
4. Run the WP8 probe (item 8), then the live suite (item 4).
5. Close the gate. Publishing 2.8.0 is a separate decision under
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
needed.

### 3. Claude-only local install

Automated evidence:

- `config.test.ts`: "init writes Claude as the default reviewer and keeps an
  existing reviewer";
- `model-selection.test.ts`: "banzai model --local and Use shared setting write
  only the local file".

Until 2.8.0 is published, the commands in
[getting-started.md](../../getting-started.md#claude-code-plugin) install the
previous version from GitHub. Use this checkout as the marketplace instead. This
path form has not been run for this gate.

Create the scratch repository:

```bash
mkdir -p ~/banzai-gate-1-install && cd ~/banzai-gate-1-install && git init
```

Install the plugin at local scope:

```bash
claude plugin marketplace add ~/www/banzai --scope local
```

```bash
claude plugin install banzai@banzai-plugins --scope local
```

Initialize the project with the defaults and record the shared file's digest:

```bash
banzai init
```

```bash
shasum -a 256 .banzai/config.json
```

Choose a local model, and check the digest again:

```bash
banzai model --local
```

```bash
shasum -a 256 .banzai/config.json
```

```bash
banzai doctor
```

It passes when all of these hold:

- `.claude/settings.local.json` records the plugin;
- the digest of `.banzai/config.json` does not change;
- `.banzai/config.local.json` exists and `git check-ignore` reports it;
- doctor passes `config.local` and `claude.version`, and its `Models:` block
  shows a Claude reviewer.

### 4. `verify` and live scenarios

`verify` passes inside the release-candidate check on the final tree: 2153 of 2153
tests, and lint reports 0 errors. It was not run separately.

The live suite has not run and needs the owner's go-ahead. It makes at most two
model calls per run. Before it runs:

- the working tree has no tracked changes;
- `npm run build:dist` has run on that commit;
- `BANZAI_LIVE_CODEX_AUTH_ROOT` and `BANZAI_LIVE_CLAUDE_AUTH_ROOT` name dedicated
  signed-in directories outside the repository. They are copied and used as
  `CODEX_HOME` and `CLAUDE_CONFIG_DIR`, and they must contain no symbolic links.

Not confirmed: on macOS, Claude Code may keep its sign-in in the Keychain, and a
copied configuration directory may not carry it. If `preflight.claude` reports
`unavailable`, check this first.

On the current release:

```bash
npm run compatibility:live -- --confirm-live
```

On Claude Code 2.1.290, using the install from the
[probe recipe](../wp08-stable-claude-phases/gate-1-probe.md):

```bash
PATH="$HOME/banzai-gate-1-client/node_modules/.bin:$PATH" npm run compatibility:live -- --confirm-live
```

The second command assumes the live suite finds `claude` on `PATH`.

### 5. Release train at 2.8

`npm run version:set -- 2.8.0` set nine fields in seven files, and
`npm run release:validate` passes. The deferred
`HOOK_CHANGED_WITHOUT_VERSION_BUMP` is gone, and it was not hiding any other
failure. Details: [change report](../release-2-8-0/change-report.md). The owner
accepted this item on 2026-11-09.

### 6. Initiative skill

Automated evidence covers the skill's content only (`workflow-skills.test.ts`,
`release-validation.test.ts`). In the scratch repository from item 3, start
`claude` and run `/banzai:initiative` with a small two-package goal.

It passes when the brief, the tracker and any gate report are under
`documentation/initiatives/<slug>/`, and its packages are under
`documentation/work/<slug>/`.

### 7. Memory notes in the hook

`hook.test.ts` covers the rules: "a manual memory-note write defers and writes no
marker, while a code write still does", and "scratchpad and subagent-memory writes
record only the bookkeeping marker".

In a manual session in the same scratch repository, with the 2.8 plugin:

1. Ask Claude to save a memory note. It should write without a prompt and without
   an approval marker.
2. Ask it to edit a code file. It should still ask.
3. In a new session, approve one scratchpad write. Then
   `$TMPDIR/banzai-spec-gate/` should hold only `bookkeeping-<session>`.
4. Ask it to edit a code file. It should still ask, with the first-change reason.

### 8. Long foreground command probe

`gate-1-probe.test.ts` covers the verdict rules. The real run follows
[gate-1-probe.md](../wp08-stable-claude-phases/gate-1-probe.md): one run on Claude
Code 2.1.290 and one on the current release, about 12 minutes each.

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
