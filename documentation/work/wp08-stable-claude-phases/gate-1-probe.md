# Gate 1 probe

The Gate 1 probe is ADR-0063 §6's evidence that a long foreground Bash
command no longer ends a Claude Code phase early. It runs Banzai's own
implementation phase against a real Claude Code client, then resumes that
session once.

The owner runs it. WP8 builds the probe and does not run it.

## What it does

`packages/orchestrator/scripts/gate-1-probe.mjs` bundles
`packages/orchestrator/test/probes/gate-1-probe-main.ts` into
`packages/orchestrator/.dist-check-gate-1-probe/` and runs it. The probe:

1. Builds the implementation phase the way a run does:
   - the default implementer model, effort and 60-minute timeout;
   - the scoped Claude environment, with this checkout's `plugins/banzai`;
   - the `phase-result/v4` output contract;
   - the prompt on stdin, background tasks off and `BASH_MAX_TIMEOUT_MS` at
     3,300,000.
2. Asks the phase to run `sh ./probe.sh` once, in the foreground, with a
   900,000 ms timeout, and then to return a completed result.
3. Resumes the same session with a short prompt that runs no command.
4. Prints one JSON object, `banzai-gate-1-probe/v1`, with the client version,
   the counts for each invocation, the exit statuses, any error code and the
   verdict.

The probe writes no stream to disk. It takes about 12 minutes per client.

## Prepare a scratch repository

Use a new directory outside this checkout. The probe needs no commit.

```bash
mkdir -p ~/banzai-gate-1 && cd ~/banzai-gate-1 && git init
```

```bash
printf 'sleep 660 && date > probe-sentinel.txt\n' > probe.sh
```

```bash
mkdir -p .claude && printf '{"permissions":{"allow":["Bash(sh ./probe.sh)"]}}\n' > .claude/settings.json
```

The phase runs with `--permission-mode dontAsk`, which denies every tool call
that no allow rule covers. Claude Code applies the project's allow rule only
in a trusted directory. Start `claude` once in the scratch directory, accept
the trust prompt and exit.

```bash
claude
```

## Install Claude Code 2.1.290 beside the current release

```bash
npm install --prefix ~/banzai-gate-1-client @anthropic-ai/claude-code@2.1.290
```

The current release stays on `PATH` as `claude`.

## Run the probe

Run each command from a regular terminal at the root of this checkout, not
from inside Claude Code. The probe refuses to start when `CLAUDECODE` is set.

On Claude Code 2.1.290:

```bash
node packages/orchestrator/scripts/gate-1-probe.mjs --repository ~/banzai-gate-1 --executable ~/banzai-gate-1-client/node_modules/.bin/claude
```

Delete the sentinel before the second run. The probe refuses to start while
it exists.

```bash
rm ~/banzai-gate-1/probe-sentinel.txt
```

On the current release:

```bash
node packages/orchestrator/scripts/gate-1-probe.mjs --repository ~/banzai-gate-1
```

## Read the verdict

The probe exits with status 0 only on `pass`. A run passes when all of these
hold:

- `probe-sentinel.txt` exists when the first `result` line arrives;
- neither invocation shows a background-task event:
  - a `tool_use` block whose input sets `run_in_background`;
  - a `tool_result` block whose text says a command runs in the background;
  - a `system` event whose `subtype` names a task or the background;
- each invocation emits exactly one `result` event, reports no permission
  denial, exits with status 0 and resolves without an error;
- the first invocation does not fail with `TERMINAL_RESULT_CONFLICT`.

`fail` means one of these rules broke. `inconclusive` means both invocations
were otherwise clean but the adapter refused the result, for example a
structured-output mismatch. That says nothing about background tasks; rerun
before drawing a conclusion.

## Record the result

Add one decision entry to
`documentation/work/release-2-8-2-9-program/tracker.md` for each client run:

- the date and the client version from the JSON;
- the verdict;
- for `fail` or `inconclusive`, the counts and the error code that decided it.

Close the Gate 1 item once both clients pass. Remove the scratch repository
and the 2.1.290 install afterwards.
