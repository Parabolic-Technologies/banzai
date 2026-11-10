# WP8 implementation report

Slug: `wp08-stable-claude-phases` · Requirements:
[requirements.md](requirements.md) · Plan: [plan.md](plan.md) · Authority:
[ADR-0063](../../decisions/0063-stable-headless-vendor-invocations.md)
(accepted 2026-11-06) · Plan approved on 2026-11-06 with `Approve, all (a)`:
Q1 (a) a 5-minute Bash reserve with a 2-minute floor, Q2 (a) settings `env`
overrides documented only, Q3 (a) a maintainer probe script for Gate 1.

WP8 is one change set. Nothing is staged or committed. No live vendor run
took place.

## What changed

- **One Claude minimum** (`adapters.ts`, `release-policy.json`).
  - `MINIMUM_CLAUDE_VERSION` is `2.1.290` for every role.
  - `REVIEW_ISOLATION_MINIMUM_CLAUDE_VERSION`, the `reviews` field of
    `VendorPreflightTarget`, the run-start reviewing pair, the `reviews`
    argument of `AuthenticationGateway.check` and the CLI gateway, and the
    live harness's `reviews: true` are removed.
  - The Claude `CLI_TOO_OLD` message names the installed version, the
    minimum and the reason: "earlier releases can report a delivered
    structured result as an error". The Codex message is unchanged.
  - `meetsClaudeMinimum` replaces the review-floor check for doctor.
  - `live.minimumCliVersions.claude` is `2.1.290`.
  - The `models.ts` comment and the `models.test.ts` title now say that a
    model minimum at or below the vendor minimum stays recorded and never
    decides.
- **Stdin in the runner** (`types.ts`, `process.ts`).
  - `ProcessSpec.stdin` is an optional string. With it, `runProcess` spawns
    with a piped stdin, writes the text in full and closes it. A stdin
    `error` is consumed, so the process outcome decides.
  - Without it, stdin stays `"ignore"`, as before.
- **Prompt on stdin** (`adapters.ts`).
  - Every builder still calls `invocationPrompt(request)`, so the prompt
    checks still run, but no argv element carries the prompt.
  - Claude runs `-p` with no prompt argument. Codex ends `exec` and
    `exec resume` with `-`.
  - All eight spawn sites — Claude and Codex for planning, selection, phases
    and review — pass `stdin: invocationPrompt(request)`. Metadata probes
    pass none.
- **Run-stability environment** (`adapters.ts`).
  - `claudeBashMaxTimeoutMs(t) = max(t − 300000, 120000)`, from
    `CLAUDE_BASH_TIMEOUT_RESERVE_MS` and `CLAUDE_BASH_TIMEOUT_FLOOR_MS`.
  - `isolatedClaudeEnvironment` takes the invocation timeout. After the WP7
    isolation variables it sets `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1` and
    `BASH_MAX_TIMEOUT_MS`, and deletes `BASH_DEFAULT_TIMEOUT_MS`, in every
    scope and mode.
  - The four Claude call sites pass `request.settings.timeoutMs`. Selection
    uses the planner settings, so its maximum follows the planner timeout.
  - Codex environments are unchanged.
- **Doctor `claude.version`** (`doctor.ts`).
  - It groups effective Claude roles by executable through `vendorUsage`,
    reads each available executable once, and applies the one minimum.
  - Fail below 2.1.290, warn when no layout yields a version, pass
    otherwise; the worst result wins. Messages name the roles behind each
    version and any role whose executable is unavailable.
  - Skipped for an invalid configuration, a failing `config.local`, no
    Claude role, or no available Claude executable.
  - The `authentication.models` advisory now says doctor checks no CLI
    version except Claude Code's.
  - `doctor.ts` imports `describeRoles`, `vendorUsage` and `ModelRole`
    through the adapters re-exports, because the import boundary forbids
    `models.js`.
- **Gate 1 probe** (unshipped).
  - `packages/orchestrator/test/probes/gate-1-probe.ts`: pure line
    classification and verdict.
  - `packages/orchestrator/test/probes/gate-1-probe-main.ts`: runs the
    implementation phase and the resumed invocation through
    `createVendorAdapters` and the real `runProcess`.
  - `packages/orchestrator/scripts/gate-1-probe.mjs`: bundles and runs it.
  - [gate-1-probe.md](gate-1-probe.md): the owner's recipe.
- **Documentation.** `documentation/orchestrator.md` (Boundaries, a new
  "Headless Invocations" subsection with the R6 settings note, doctor,
  model-version and live passages, and the review isolation cross-reference),
  `documentation/getting-started.md`, root `README.md`,
  `packages/orchestrator/README.md` and `packages/orchestrator/MODULES.md`.
- **Lifecycle and facts.** ADR-0063's implementation state, the reciprocal
  lines in ADR-0020, ADR-0022 and ADR-0059, the decision index row and
  `PROJECT_MANIFEST.md`. Only lifecycle metadata changed in the ADRs.

## Requirement trace

| Requirement | Evidence                                                                                                                                                                                                                                                                                                                                        |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1          | `adapters.test.ts` "preflight refuses Claude Code below 2.1.290 for every role, naming the reason"; `workflow.test.ts` two run-start tests; `interactive.test.ts` launch check; `setup-client.test.ts` `oldClaude` refusal; `live-compatibility.test.ts` "the live policy pins the one Claude minimum" and "the live Claude preflight applies…" |
| R2          | `adapters.test.ts` "every Claude call site runs without background tasks and with a Bash maximum inside its timeout", "Claude builders and selection add only the run-stability settings…", "Codex children receive no run-stability settings from Banzai"; `planning-review-adapters.test.ts`; the live Bash-maximum test                      |
| R3          | `process.test.ts` five stdin tests; `adapters.test.ts` "every vendor spawn carries its prompt on stdin and never in argv" and "metadata probes spawn without stdin"                                                                                                                                                                             |
| R4          | `adapters.test.ts` "ambient and no-whitelist argv is today's argv without the prompt"; `workflow-review.test.ts` reviewer digest tests, unchanged (38 of 38)                                                                                                                                                                                    |
| R5          | `doctor.test.ts` three `claude.version` tests and the ready-project test's advisory text                                                                                                                                                                                                                                                        |
| R6          | `documentation/orchestrator.md` "Headless Invocations"; review of the diff                                                                                                                                                                                                                                                                      |
| R7          | `gate-1-probe.test.ts` (5 tests); `live-compatibility.test.ts` keeps v2, its check IDs and two invocations; the probe itself awaits the owner                                                                                                                                                                                                   |
| R8          | Documentation diff; `release-validation.test.ts`; the candidate check                                                                                                                                                                                                                                                                           |
| R9          | ADR, index and manifest diff; `release-validation.test.ts` registration checks                                                                                                                                                                                                                                                                  |

## T1 · Vendor evidence

On 2026-11-06, before any argv or environment change:

- `npm pack @anthropic-ai/claude-code-darwin-arm64@2.1.290 --ignore-scripts`
  fetched 101.9 MB into the session scratchpad; it unpacked to 233 MB.
  Nothing was executed, and the download was deleted after counting.
- `grep -c -a` counts in the 2.1.290 binary and in the local client at
  `~/.local/share/claude/versions/2.1.319`:

  | Name                                   | 2.1.290 | 2.1.319 |
  | -------------------------------------- | ------- | ------- |
  | `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS` | 4       | 4       |
  | `BASH_MAX_TIMEOUT_MS`                  | 4       | 4       |
  | `BASH_DEFAULT_TIMEOUT_MS`              | 4       | 4       |

- The installed `codex-cli 0.166.0` help shows that `codex exec` reads its
  instructions from stdin when the prompt is `-` or absent, and that
  `codex exec resume` reads the prompt from stdin when it is `-`.

No stop condition applied.

## Tests

### T2 · Fail-first

The tests were written before T3–T8 and run against the unchanged source.
Each failure below matched the behaviour it targets.

| File                       | Failing before | Notes                                                                                                                                                                                                |
| -------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `adapters`                 | 5 of 81        | the stdin, argv identity, run-stability, ambient environment and one-minimum tests                                                                                                                   |
| `doctor`                   | 4 of 57        | the three `claude.version` tests, and the ready-project test through the new advisory text                                                                                                           |
| `gate-1-probe`             | whole file     | the probe module did not exist                                                                                                                                                                       |
| `interactive`              | 1 of 114       | the launch check without a review marker                                                                                                                                                             |
| `live-compatibility`       | 11 of 32       | the policy-pin and Bash-maximum tests, and nine existing ones whose fake client now reads the prompt from stdin; the new preflight test passed, because the WP7 review floor already refused 2.1.289 |
| `planning-review-adapters` | 10 of 11       | the argv and environment assertions of every vendor and session case                                                                                                                                 |
| `process`                  | 2 of 12        | the large-stdin and early-exit tests; the other three stdin tests guard behaviour that already held: an ignored stdin, a start failure, and a timeout                                                |
| `setup-client`             | 1 of 1         | the `oldClaude` refusal                                                                                                                                                                              |
| `workflow`                 | 2 of 65        | the two run-start tests                                                                                                                                                                              |
| `models`, `setup-pty`      | 0              | guards: the retitled catalog test, and the 2.1.290 stub                                                                                                                                              |

### Changed and removed tests

- Removed, as WP7 review-floor tests replaced by one-minimum tests:
  "preflight refuses a reviewing Claude target below the review isolation
  floor", "claude.version enforces the review isolation floor…",
  "claude.version is skipped unless the effective reviewer…", "the launch
  check marks a vendor entry as reviewing…", "the live Claude preflight
  applies the review isolation floor", and the two run-start review-floor
  tests.
- "Claude builders and selection keep today's environment in ambient mode…"
  became "…add only the run-stability settings in ambient mode…".
- "preflight refuses a CLI older than the configured model's release…" now
  exercises Codex only; see Deviations.
- Version stubs in `adapters`, `setup-client` and `setup-pty` moved from
  2.1.218 to 2.1.290.

### Focused results

Run through `node packages/orchestrator/scripts/test.mjs --file <name>.test.ts`
with a private output root, on the final source: `adapters` 81, `doctor` 57,
`doctor-cli` 6, `gate-1-probe` 5, `interactive` 114, `live-compatibility`
32, `models` 15, `planning-review-adapters` 11, `process` 12,
`setup-client` 1, `setup-pty` 16, `workflow-review` 38, `workflow` 65,
`cancellation` 14, `cancellation-report` 7, `committed-smoke` 19,
`version-cli` 4, `workflow-completion` 20 and `release-validation` 208, all
passing. `npx tsc --noEmit -p .` passes.

## Checks

All on 2026-11-06, on the final bytes unless noted.

| Check                                                                                             | Result                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm run build`, then `npm run build:check`                                                       | Pass, with no tracked output change.                                                                                                                                                                                                                         |
| `npm run format:check`                                                                            | It first reported five changed files (`gate-1-probe.mjs`, `gate-1-probe-main.ts` and three tests); prettier was applied. Pass.                                                                                                                               |
| `npx prettier --check` on the manifest, the tracker, the changed documentation and this directory | Pass. `documentation/decisions/README.md` and the older ADRs were not formatted.                                                                                                                                                                             |
| Lint                                                                                              | The first `verify` stopped at one lint error in a new `live-compatibility.test.ts` assertion (an unnecessary optional chain); fixed. No error remains, and no warning on a changed line.                                                                     |
| `release-validation.test.ts`                                                                      | 208 of 208.                                                                                                                                                                                                                                                  |
| `npm run release:validate`                                                                        | Stops only at the deferred `HOOK_CHANGED_WITHOUT_VERSION_BUMP` (`hooks.json`, `spec-gate.cjs` and `plugins/banzai/lib` from earlier packages), as planned. WP8 changes nothing under `plugins/`.                                                             |
| `npm run verify`                                                                                  | Pass on the rerun: 2100 of 2100 tests, lint 0 errors. The first run stopped at the lint error above.                                                                                                                                                         |
| `node packages/orchestrator/scripts/release-candidate-check.mjs`                                  | Pass: verify 2100 of 2100, publication check, release validation, committed smoke and release check. `node_modules/.bin/banzai` and the dangling `node_modules/node_modules` link were set aside for the run and restored to their exact targets afterwards. |
| `publication-check` classification                                                                | No entry needed: the new `.mjs` and `.ts` files are outside the classified set, and work documents are exempt in the source distribution. ADR-0063 was classified when it was drafted.                                                                       |
| Live vendor run                                                                                   | Not run. The Gate 1 probe and `npm run compatibility:live` need the owner's go-ahead.                                                                                                                                                                        |

## Implementation readings applied

1. **The review floor plumbing goes (R1).** One constant, one check; the WP7
   floor tests became one-minimum tests.
2. **No reviewer rotation (R4).** The reviewer invocation digest is
   unchanged, and `workflow-review.test.ts` passes unchanged, so a reviewer
   session recorded before WP8 resumes normally.
3. **Uniform environment (R2).** Review, planning and selection get the same
   three settings although they have no Bash tool.
4. **The prompt is written at spawn (R3).** `runProcess` ends stdin right
   after `spawn`, well inside the client's 3-second wait.
5. **Selection runs on the planner's settings.** Its Bash maximum follows the
   planner timeout. Selection never resumes.
6. **The 2.1.290 binary check ran as T1** and found every name.

## Deviations from the plan

1. **The Q1 floor departs from ADR-0063 Compliance 4.** Compliance 4 says
   `BASH_MAX_TIMEOUT_MS` equals the timeout minus the reserve. For a timeout
   below 7 minutes the 2-minute floor applies instead, so the closing turn
   keeps less than 5 minutes. No default role is affected; the live review's
   5-minute bound gets 120,000 ms. The owner chose this with Q1 (a), and the
   tracker records it.
2. **The model-minimum preflight test exercises Codex only.** No catalogued
   Claude model has a minimum above 2.1.290, so no Claude case can reach the
   model check after the vendor check. The Claude refusal is proven by
   "preflight refuses Claude Code below 2.1.290 for every role, naming the
   reason".
3. **The probe runs without runner identity.** It builds the phase request
   the way the workflow does, but sets no `BANZAI_RUN_ID` or approval
   variables, so the enforcement hook treats the session as manual. The
   hook gates only edit tools, and the probe asks for one Bash command and no
   edit, so this does not affect the verdict. An attempted edit would be
   denied under `dontAsk` and fail the probe visibly.
4. **No live environment change.** The live harness keeps its v2 summary,
   check IDs and two-invocation budget; it inherits the stdin prompt and the
   run-stability environment from the adapters, with no code of its own.
5. **`isolatedClaudeEnvironment` was rewritten without the nested ternary**
   that WP7 left, because the R2 change touched those lines and lint warns
   on nested ternaries. Behaviour is unchanged; the WP7 environment tests
   pass.

## Unchanged, by design

- `banzai setup` keeps its argv skill launch (ADR-0040 D4).
- Version probes and every process without a prompt keep stdin ignored.
- Codex environments, and every Codex argument except the final `-`.
- The reviewer invocation digest and review isolation.
- `compatibility:live`, its `CHECK_IDS`, its v2 summary and `maxInvocations` 2.

## Follow-ups

- **Gate 1 probe.** The owner runs
  `node packages/orchestrator/scripts/gate-1-probe.mjs --repository <scratch>`
  on Claude Code 2.1.290 (with `--executable`) and on the current release,
  following [gate-1-probe.md](gate-1-probe.md), and records both verdicts in
  the tracker.
- **Version bump.** `npm run release:validate` stops at the deferred
  `HOOK_CHANGED_WITHOUT_VERSION_BUMP` until the 2.8 version is set with
  `npm run version:set`.
- **Live-suite budget.** ADR-0063 asks for a live-suite budget decision
  before WP13 and WP14 add scenarios.

## Plan Task Completion

Format: `banzai-plan-task-completion/v1`

| Task | Status    | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Gap or deviation |
| ---- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| T1   | completed | [{"path":"documentation/work/wp08-stable-claude-phases/implementation-report.md","detail":"T1 section: 2.1.290 darwin-arm64 binary inspected without execution and deleted; each name 4 times in 2.1.290 and 2.1.319; Codex 0.166.0 help shows the stdin prompt."}]                                                                                                                                                                                                                                          | null             |
| T2   | completed | [{"path":"packages/orchestrator/test/process.test.ts","detail":"Five stdin tests; two failed first."},{"path":"packages/orchestrator/test/adapters.test.ts","detail":"Stdin, argv identity, run-stability, Codex and one-minimum tests; five failed first."},{"path":"packages/orchestrator/test/doctor.test.ts","detail":"Three claude.version tests; four failed first."},{"path":"packages/orchestrator/test/gate-1-probe.test.ts","detail":"Five verdict tests; failed first as an unresolved module."}] | null             |
| T3   | completed | [{"path":"packages/orchestrator/src/adapters.ts","detail":"MINIMUM_CLAUDE_VERSION 2.1.290 with the reason in CLI_TOO_OLD; review floor constant and reviews flag removed; meetsClaudeMinimum."},{"path":"packages/orchestrator/src/workflow.ts","detail":"Run-start preflight without a reviewing pair."},{"path":"release-policy.json","detail":"live.minimumCliVersions.claude 2.1.290."}]                                                                                                                 | null             |
| T4   | completed | [{"path":"packages/orchestrator/src/process.ts","detail":"ProcessSpec.stdin written in full and closed at spawn; stdin errors consumed; ignored without it."},{"path":"packages/orchestrator/src/types.ts","detail":"ProcessSpec.stdin field."}]                                                                                                                                                                                                                                                             | null             |
| T5   | completed | [{"path":"packages/orchestrator/src/adapters.ts","detail":"Builders keep the prompt check but no prompt in argv; Claude -p without a prompt, Codex -; eight spawn sites pass stdin."}]                                                                                                                                                                                                                                                                                                                       | null             |
| T6   | completed | [{"path":"packages/orchestrator/src/adapters.ts","detail":"claudeBashMaxTimeoutMs with a 5-minute reserve and 2-minute floor; isolatedClaudeEnvironment sets both variables and deletes BASH_DEFAULT_TIMEOUT_MS at every Claude call site."}]                                                                                                                                                                                                                                                                | null             |
| T7   | completed | [{"path":"packages/orchestrator/src/doctor.ts","detail":"claude.version per Claude executable for every role, worst result wins, unavailable roles named; advisory reworded."}]                                                                                                                                                                                                                                                                                                                              | null             |
| T8   | completed | [{"path":"packages/orchestrator/test/probes/gate-1-probe-main.ts","detail":"Implementation phase and resumed invocation through createVendorAdapters and runProcess; JSON verdict."},{"path":"packages/orchestrator/scripts/gate-1-probe.mjs","detail":"Bundles and runs the probe; usage without --repository."},{"path":"documentation/work/wp08-stable-claude-phases/gate-1-probe.md","detail":"Scratch setup, 2.1.290 install, both commands, verdict rules and tracker entry."}]                        | null             |
| T9   | completed | [{"path":"documentation/orchestrator.md","detail":"Boundaries, Headless Invocations with the settings env note, doctor, model-version and live passages."},{"path":"packages/orchestrator/MODULES.md","detail":"Adapters, process, doctor, live and gate-1-probe entries."},{"path":"documentation/getting-started.md","detail":"Claude Code 2.1.290 for every Claude role."}]                                                                                                                               | null             |
| T10  | completed | [{"path":"documentation/decisions/0063-stable-headless-vendor-invocations.md","detail":"Implementation state Implemented; reciprocal lines and index row updated."},{"path":"PROJECT_MANIFEST.md","detail":"Minimums, stdin prompt, Claude child environment, doctor check and the ADR-0063 row."},{"path":"documentation/work/wp08-stable-claude-phases/implementation-report.md","detail":"Checks section: build, format, lint, release validation, verify and candidate check."}]                         | null             |
