# Gate 2 permission probe

The Gate 2 permission probe is WP14's live evidence (requirement R9) that
Claude Code accepts `--permission-prompts none` in a Banzai phase and that
Banzai reports a denied command exactly. It runs Banzai's own implementation
phase once against a real Claude Code client.

Status: the owner ran the probe on 2026-11-11 on Claude Code 2.1.290 and
2.1.322, and both runs returned `pass`. On the owner's decision the probe's
sources, its test and its launcher script were removed from the repository the
same day. This file is the record of how the evidence was produced; its
commands no longer run.

## What it does

`packages/orchestrator/scripts/gate-2-permission-probe.mjs` bundles
`packages/orchestrator/test/probes/gate-2-permission-probe-main.ts` into
`packages/orchestrator/.dist-check-gate-2-permission-probe/` and runs it. The
probe:

1. Builds the implementation phase the way a run does: the default
   implementer model and effort, the scoped Claude environment with this
   checkout's `plugins/banzai`, the `phase-result/v4` output contract, the
   prompt on stdin and the argv with `--permission-mode dontAsk` and
   `--permission-prompts none`. The timeout is 15 minutes.
2. Asks the phase to run `sh ./allowed.sh` and then `sh ./denied.sh`, each
   once, and to return a completed result. The scratch repository grants only
   the first command.
3. Reads the stream with Banzai's own reader, `claudePermissionDenials`.
4. Prints one JSON object, `banzai-gate-2-permission-probe/v1`, with the
   client version, the `result` count, the exit status, any error code, the
   two sentinel facts, whether `AskUserQuestion` was offered, the denied calls,
   the block Banzai would print, and the verdict.

The probe writes no stream to disk. It is one model invocation per client and
takes a few minutes.

## Prepare a scratch repository

Use a new directory outside this checkout. The probe needs no commit.

```bash
mkdir -p ~/banzai-gate-2 && cd ~/banzai-gate-2 && git init
```

```bash
printf 'date > allowed-sentinel.txt\n' > allowed.sh
```

```bash
printf 'date > denied-sentinel.txt\n' > denied.sh
```

```bash
mkdir -p .claude && printf '{"permissions":{"allow":["Bash(sh ./allowed.sh)"]}}\n' > .claude/settings.json
```

Claude Code applies the project's allow rule only in a trusted directory.
Start `claude` once in the scratch directory, accept the trust prompt and
exit.

```bash
claude
```

## Install Claude Code 2.1.290 beside the current release

```bash
npm install --prefix ~/banzai-gate-2-client @anthropic-ai/claude-code@2.1.290
```

The current release stays on `PATH` as `claude`.

## Run the probe

Run each command from a regular terminal at the root of this checkout, not
from inside Claude Code. The probe refuses to start when `CLAUDECODE` is set.

On Claude Code 2.1.290:

```bash
node packages/orchestrator/scripts/gate-2-permission-probe.mjs --repository ~/banzai-gate-2 --executable ~/banzai-gate-2-client/node_modules/.bin/claude
```

Delete the sentinel before the second run. The probe refuses to start while
one exists.

```bash
rm -f ~/banzai-gate-2/allowed-sentinel.txt ~/banzai-gate-2/denied-sentinel.txt
```

On the current release:

```bash
node packages/orchestrator/scripts/gate-2-permission-probe.mjs --repository ~/banzai-gate-2
```

## Read the verdict

The probe exits with status 0 only on `pass`. A run passes when all of these
hold:

- the client accepted the flag: the stream has exactly one `result` event and
  the child exits with status 0;
- `allowed-sentinel.txt` exists, so the granted command ran;
- `denied-sentinel.txt` does not exist, and `deniedCalls` is exactly one Bash
  call whose `command` is `sh ./denied.sh`;
- `askUserQuestionOffered` is `false`;
- the adapter resolved without an error.

`fail` means one of these rules broke. A client that rejects the flag exits
with a non-zero status and no `result` event. `inconclusive` means the model
ran neither command, or everything was clean but the adapter refused the
result, for example a structured-output mismatch. Neither says anything about
permissions; delete the sentinels and rerun.

The `report` array is the block a run would print. With the settings above it
should name `sh ./denied.sh` once and propose `Bash(sh ./denied.sh)` for
`.claude/settings.json`.

Note the `reasonType` of the denied call in the output. WP14's fixtures use
`mode`, taken from the client's embedded schema; the probe is the first live
confirmation of that value.

## What the probe does not cover

The probe makes no file write, so it does not show that a write the Banzai
hook allows still succeeds under the flag. The owner's next real run and the
WP22 probe cover that.

## Record the result

Add one decision entry to
`documentation/work/release-2-8-2-9-program/tracker.md` for each client run:

- the date and the client version from the JSON;
- the verdict and the `reasonType`;
- for `fail` or `inconclusive`, the fields that decided it.

Tick the Gate 2 item once both clients pass. Remove the scratch repository
and the 2.1.290 install afterwards.
