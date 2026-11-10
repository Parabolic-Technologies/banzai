# WP7 plan

Status: approved on 2026-11-06 with `Approve, all (a)` · Requirements:
[requirements.md](requirements.md) · Authority:
[ADR-0059](../../decisions/0059-claude-default-reviewer-and-reviewer-isolation.md)

WP7 is one change set with one report,
`documentation/work/wp07-claude-default-reviewer/implementation-report.md`.
The owner commits by hand. The working tree was clean at `ebfcd3e` (WP20)
before these documents.

An independent read-only review of the first draft found three major and
thirteen minor issues. This revision addresses them:

- the run-start preflight is grouped per executable;
- `init` and `model` have no launch check;
- the live-evidence limit is now owner question Q3;
- R6, R7, R9, R10 and R11 are corrected;
- the documentation, fixture and lifecycle lists are completed.

## Approach

The default changes in one place, `DEFAULT_CONFIG`. Isolation lives in the
Claude adapter, which already owns every Claude argument vector:

- the read-only invocation splits into a review variant without `Skill` and a
  planner variant that keeps today's tools;
- one helper sets the isolation variables on the sanitized environment at
  each Claude call site, and reads the mode from `strictMcpConfig`;
- the reviewer invocation digest gains the isolation identity, so the existing
  rotation retires pre-isolation reviewer sessions;
- the floor is one constant. The vendor preflight applies it to any target
  that reviews, and doctor reads the installed version offline.

Tests come first and run against today's code. No instruction text changes,
so there is no baseline transition. The rebuilt plugin lib makes
`release:validate` report the deferred `HOOK_CHANGED_WITHOUT_VERSION_BUMP`
again.

## Tasks

### T1 · Vendor evidence (Q1, Q2)

Everything downloaded goes into the session scratchpad. Nothing is executed,
and everything is deleted after the counts are recorded.

- Under Q2 (a), fetch the wrapper `@anthropic-ai/claude-code@2.1.290`
  (about 190 KB) with `npm pack <spec> --pack-destination <dir>`, which runs
  no scripts. Read its `install.cjs` and `package.json` to confirm where a
  global npm install puts the `claude` binary, and which `package.json` the
  R9 walk reaches first. If the layout differs from R9, adjust T7's npm
  reader to the observed layout. If the observed layout cannot satisfy R9's
  rules (a bounded walk, a version-shaped value, no process), stop and
  report.
- Under Q1 (a), fetch `@anthropic-ai/claude-code-darwin-arm64@2.1.290` the
  same way, unpack it, and count each variable name in its binary with
  `grep -c -a`. If either count is zero, or the download fails, stop before
  T6 and report.
- Under Q1 (b), record the local 2.1.300 counts. Under Q1 (c), record that the
  Gate 1 live run is the only evidence.

### T2 · Tests first (R1–R11, Acceptance)

Add or update these tests and run them against today's code.

- Tests marked "new behaviour" must fail first, and the report lists them.
- A test that imports a symbol not yet exported fails its whole bundled file
  (`scripts/test.mjs` bundles each file). Keep such tests in a separate
  block and add the export as a stub. Alternatively, record in the report
  that the file failed as a whole and why.

The tests:

- `adapters.test.ts`:
  1. Review and routine re-review argv: `--tools Read,Glob,Grep`, and the
     disallowed list starts with `Skill` (new behaviour).
  2. Review environment: both variables are `1` in scoped, degraded scoped
     and ambient scope, and with no scope. An inherited `0` is overridden
     (new behaviour).
  3. Phase and selection environment in scoped and degraded scoped scope:
     `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`, overriding an inherited `0` (new
     behaviour).
  4. Phase and selection environment in ambient scope and with no scope: it
     equals today's `subscriptionOnlyEnvironment` output, and an inherited
     `CLAUDE_CODE_DISABLE_REFUSAL_FALLBACK` passes through (characterization).
  5. Codex review, phase and selection argv and environment, built from a
     source environment without either variable: unchanged, and with neither
     variable (characterization).
  6. Vendor preflight with a fake runner that reports a version below the
     floor:
     - a reviewing target fails with `CLI_TOO_OLD` naming the floor (new
       behaviour);
     - a building target passes.
  7. A refused Claude review with `onTerminalSuccess` set fails with the
     typed Claude review error and its classification, for both R10 shapes:
     a non-zero exit with an error result, and a success result without
     `structured_output` (characterization of R10).
- `planning-review-adapters.test.ts`:
  - planning review argv and environment as in tests 1–2 (new behaviour);
  - planning analysis keeps `Read,Glob,Grep,Skill` and, in scoped scope,
    carries only the memory variable (new behaviour);
  - a refused planning review is a retry-eligible failure (characterization).
- A workflow test with the `workflow-fixtures.ts` adapters: with the default
  all-Claude configuration, the run-start preflight passes the reviewer
  marker for the `claude` pair, and a fake below-floor refusal stops `start`
  and `retry` before workflow selection (new behaviour).
- `workflow-review.test.ts`:
  - a Claude reviewer binding with a pre-change digest rotates with
    `session-inventory-changed` (new behaviour);
  - a binding with the new digest resumes;
  - a Codex reviewer is unaffected.
- `doctor.test.ts`, through injected file-system readers, with no process
  spawned and no path in the output (new behaviour):
  - native layout at, above and below the floor;
  - npm layout as confirmed by T1;
  - a non-version string gives a warning;
  - an unknown layout gives a warning;
  - a Codex reviewer is skipped;
  - a Node-executable reviewer is skipped;
  - a failed local layer is skipped;
  - an unavailable executable is skipped;
  - the check sits right after `executables.models`;
  - the default configuration with only `claude` on `PATH` has no failed
    check;
  - the reworded `authentication.models` advisory.
- `config.test.ts` and `model-selection.test.ts`:
  - `initializeConfig` writes the Claude reviewer (new behaviour);
  - the picker's default line shows it (new behaviour);
  - Codex models stay selectable for the reviewer;
  - an existing Codex reviewer configuration loads unchanged.
- `interactive.test.ts`: the launch check hands the gateway the reviewer role
  for the Claude entry when the reviewer runs on Claude, and not when Claude
  only builds (new behaviour). The floor itself is proven by adapter test 6.
- `live-compatibility.test.ts`:
  - an inventory with `Skill` fails `claude.read_only_inventory`;
  - an inventory without `StructuredOutput` passes;
  - under Q3 (a), a missing spawn variable or a missing binary name fails
    only `claude.read_only_inventory`, with the isolation code, while
    `claude.source_denied` and the other checks are unaffected;
  - the live preflight applies the floor;
  - the summary keeps v2 and the same check IDs.

  All but the last are new behaviour.

### T3 · Default reviewer (R1)

- `config.ts`: the reviewer triple of R1. `DEFAULT_TASK_CONFIG` follows
  through its `structuredClone`.
- Run the whole suite. A test that depends on a Codex reviewer for a reason
  other than the default, such as Codex argv or evaluation fixtures, pins a
  Codex reviewer explicitly, as `reviewerOnlyClaudeConfig()` already pins
  its layout in `test/helpers.ts`. Weaken no assertion, and list every
  pinned test in the report.

### T4 · Adapter isolation (R2–R6, R10)

In `adapters.ts`:

- The read-only Claude invocation takes the invocation kind:
  - review and planning review get the R2 tool set;
  - planning analysis keeps today's tools.

  The live seam keeps using the review variant.

- One helper applies the variables to the environment returned by
  `subscriptionOnlyEnvironment` at each Claude call site:
  - `runReview` and planning review always get both variables;
  - `runPhase`, `runSelection` and planning analysis get the memory variable
    only when the request scope has `strictMcpConfig: true`.

  `ClaudeInvocationScope` gains no field.

- `process.ts`, Codex argv and Codex environments stay unchanged.
- R10 needs no code if T2 test 7 passes on today's handling. If it does not,
  the fix stays inside the existing typed error path, adds no new failure
  cause, and the report says what changed.

### T5 · Reviewer rotation (R7)

- In `workflow.ts`, the digest compared for a Claude reviewer covers:
  - the review isolation identity (the R2 tool set and the two variable
    names), exported from `adapters.ts` so the adapter and the digest share
    one source;
  - the scope fields it hashes today.
- Keep the absent-digest rule and the Codex `null` digest.
- The recovery path stays as it is, and the report records its limit.

### T6 · Floor in the vendor preflight (R8)

- Add a named floor constant beside `MINIMUM_CLAUDE_VERSION`. WP8 can fold it
  into the vendor minimum.
- `VendorPreflightTarget` gains an optional reviewing flag, and
  `requireVersion` applies the floor when it is set.
- The flag is set in these places:
  - **Run start** (`workflow.ts`): when any role in the vendor and executable
    pair is the reviewer. The pair is still checked once.
  - **Phase preflights:** `preflightVendor("reviewer", …)` for planning
    review and code review.
  - **Launch header:** `checkAuthentication` in `interactive.ts`, through
    `AuthenticationGateway.check` and the gateway in `cli.ts`, when the
    entry's roles include the reviewer.
  - **Live harness:** its Claude reviewer preflight.
- The message names the installed version, the floor and the reason, in the
  style of the existing `CLI_TOO_OLD` messages.
- `documentation/orchestrator.md` stops saying that run start checks each
  executable "against the first role that uses it" for the floor.

### T7 · Doctor `claude.version` (R9, Q2)

Under Q2 (a):

- Add the check to `doctor.ts` immediately after `executables.models`, under
  the R9 scope rule.
- Resolve the executable through the `executableAvailable` candidates, then
  apply the native and npm readers that T1 confirmed. The walk stops at the
  first `package.json`, and the value must be version-shaped.
- Inject the readers, as `executableAvailable` is injected, so the tests
  spawn nothing.
- Messages carry versions only, and the fix links "Install and sign in to
  model clients".
- Reword the `authentication.models` advisory per R9.

Under Q2 (b), this task is replaced by stopping for an amending ADR.

### T8 · Live scenario (R11, Q3)

In `live-compatibility.ts`:

- `Skill` leaves the allowed and the required inventory; `StructuredOutput`
  stays optional.
- The Claude review prompt names `Read`, `Glob` and `Grep`.
- Under Q3 (a):
  - the wrapped runner records whether the Claude review spawn environment
    carried both variables set to `1`;
  - the harness resolves the `claude` executable and searches the file for
    both names, keeping only a boolean;
  - a separate isolation boolean feeds `claude.read_only_inventory` only,
    with its own failure code.
- Under Q3 (b), the plan adds the canary note step, and the approval message
  must name it.
- `CHECK_IDS`, the summary schema and `release-policy.json` stay unchanged.

### T9 · Documentation and template (R12)

- Update `documentation/orchestrator.md`, `documentation/getting-started.md`,
  root `README.md`, `packages/orchestrator/README.md` and
  `packages/orchestrator/MODULES.md` per R12.
- Edit the Roles section of `plugins/banzai/AGENTS.md`, keeping every line
  that the layout scan pins. Copy the file byte for byte to
  `packages/orchestrator/test/fixtures/instruction-layouts/fresh-adoption/after/AGENTS.md`
  only.
- Do not run prettier on `plugins/**`.

### T10 · Lifecycle, facts, build and close-out (R13)

- Lifecycle metadata only:
  - ADR-0059's Implementation state becomes Implemented, naming WP7 and the
    2.8 release;
  - the reciprocal lines in ADR-0042, ADR-0037 and ADR-0002 change
    "Implementation is Planned" to Implemented.
- Update the decision index row and the manifest facts of R13.
- Run `npm run build`, which regenerates `plugins/banzai/lib/artifact-readers.mjs`
  from `DEFAULT_CONFIG`, then `npm run build:check`.
- Run the final checks and write the report with:
  - R1–R13 and their evidence;
  - the T1 results;
  - the T2 fail-first list;
  - the T3 pinned tests;
  - the readings and how they were applied;
  - the R7 limits;
  - deviations;
  - the Gate 1 live item.
- Tracker:
  - the WP7 row becomes `report ready`;
  - add the owner-decision entries;
  - under Q3 (a), record the Compliance 7 deviation.

## Tests

| Requirement | Evidence                                                                                                       |
| ----------- | -------------------------------------------------------------------------------------------------------------- |
| R1          | `config.test.ts`, `model-selection.test.ts`; the whole suite after T3                                          |
| R2–R6       | `adapters.test.ts` tests 1–5; `planning-review-adapters.test.ts`                                               |
| R7          | `workflow-review.test.ts`                                                                                      |
| R8          | `adapters.test.ts` test 6; the run-start workflow test; `interactive.test.ts`; `live-compatibility.test.ts`    |
| R9          | `doctor.test.ts`                                                                                               |
| R10         | `adapters.test.ts` test 7; `planning-review-adapters.test.ts`; existing failed-review retry tests              |
| R11         | `live-compatibility.test.ts`; the Gate 1 live run with the owner's go-ahead                                    |
| R12         | `instruction-layouts.test.ts`, `release-validation.test.ts`, `release-candidate-check.mjs`; review of the diff |
| R13         | `release-validation.test.ts` registration checks; review of the diff                                           |

## Checks

- Focused, during work, through
  `node packages/orchestrator/scripts/test.mjs --file <name>.test.ts`:
  - `adapters`;
  - `planning-review-adapters`;
  - `workflow`;
  - `workflow-review`;
  - `doctor`;
  - `config`;
  - `model-selection`;
  - `interactive`;
  - `live-compatibility`;
  - `instruction-layouts`.
- Final:
  - `npm run verify`;
  - `npm run format:check`;
  - `npx prettier --check` on the manifest, the tracker, the changed
    documentation and this work directory;
  - `release-validation.test.ts`;
  - `npm run release:validate`, expected to stop only at the deferred
    `HOOK_CHANGED_WITHOUT_VERSION_BUMP`;
  - `node packages/orchestrator/scripts/release-candidate-check.mjs`, with
    the `node_modules` link workaround from WP19 and WP20.
- No live vendor run. `npm run compatibility:live` waits for the owner's
  go-ahead at Gate 1.

## Sequencing

T1 → T2 → T3 → T4 → T5 → T6 → T7 → T8 → T9 → T10.

- T1 must finish before T6 fixes the floor value and before T7 writes the npm
  reader.
- T5 reads the isolation identity that T4 exports.
- T10's build comes after every source change.

## Risks

- **Changing the default churns tests.** Many tests clone `DEFAULT_CONFIG`.
  Mitigation: T3 runs the whole suite, pins a Codex reviewer only where Codex
  is the subject, and lists each pin.
- **An older client ignores the variables.** Mitigation: the floor at run
  start, in the phase preflights, the launch header, the live harness and
  doctor.
- **The vendor renames a variable.** Under Q3 (a), the live binary-name check
  catches a rename. Host behaviour still rests on the vendor's documentation,
  and the report notes this for WP15's eval suite.
- **Install layouts change.** Doctor then warns instead of failing, and the
  run start still refuses an old client.
- **In-flight runs pay one fresh review.** A Claude reviewer session from
  before the upgrade rotates once. This is intended, and the report says so.
- **The deferred version error masks later `release:validate` checks.**
  Mitigation: evidence comes from `release-validation.test.ts` and the
  candidate check, as in WP20.
