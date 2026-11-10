# WP7 implementation report

Slug: `wp07-claude-default-reviewer` · Requirements:
[requirements.md](requirements.md) · Plan: [plan.md](plan.md) · Authority:
[ADR-0059](../../decisions/0059-claude-default-reviewer-and-reviewer-isolation.md)
(accepted 2026-10-31) · Plan approved on 2026-11-06 with `Approve, all (a)`:
Q1 (a) floor 2.1.290, Q2 (a) doctor reads the version offline, Q3 (a) live
isolation evidence from the spawn environment and the client binary.

WP7 is one change set. Nothing is staged or committed.

## What changed

- **Default reviewer.** `DEFAULT_CONFIG.models.reviewer` is Claude
  `claude-opus-5-5`, effort `xhigh`, 30 minutes (`config.ts`). `banzai init`
  writes it for a new configuration and keeps an existing reviewer. The
  rebuilt `plugins/banzai/lib/artifact-readers.mjs` carries the new default.
- **Review isolation** (`adapters.ts`).
  - `CLAUDE_REVIEW_ISOLATION` is the single contract: tools `Read,Glob,Grep`,
    disallowed `Skill,Bash,Edit,Write,MultiEdit,NotebookEdit,WebFetch,WebSearch`,
    and the two variable names.
  - `buildClaudeArguments` takes a `reviews` flag. Review, routine re-review
    and planning review get the review tool set. Planning analysis keeps
    `Read,Glob,Grep,Skill` with today's disallowed list.
  - `isolatedClaudeEnvironment` runs after `subscriptionOnlyEnvironment` at
    every Claude call site:
    - review roles get `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` and
      `CLAUDE_CODE_DISABLE_REFUSAL_FALLBACK=1` in every scope;
    - phases, selection and planning analysis get only the memory variable,
      and only when the scope has `strictMcpConfig: true`;
    - otherwise the environment is returned unchanged, so an inherited value
      passes through.
  - Codex argv and environments, and `process.ts`, are unchanged.
- **Reviewer rotation** (`workflow.ts`). `invocationScopeDigest` also hashes
  `CLAUDE_REVIEW_ISOLATION`, so a Claude reviewer session recorded before this
  change rotates with the existing reason `session-inventory-changed`. Codex
  keeps its `null` digest; absent digests keep today's rule.
- **Version floor** (`adapters.ts`, `types.ts`, `workflow.ts`,
  `interactive.ts`, `cli.ts`).
  - `REVIEW_ISOLATION_MINIMUM_CLAUDE_VERSION = "2.1.290"` sits beside
    `MINIMUM_CLAUDE_VERSION`.
  - `VendorPreflightTarget.reviews` makes `requireVersion` apply the floor
    after the vendor minimum and before the model minimum, with a
    `CLI_TOO_OLD` message that names the installed version, the floor, the
    reason and `banzai model`.
  - The flag is set at run start for the vendor pair the reviewer shares
    (still one check per pair), by `preflightVendor("reviewer", …)`, by the
    launch header when the entry's roles include the reviewer, and by the
    live harness's Claude preflight.
- **Doctor `claude.version`** (`doctor.ts`). Placed after
  `executables.models`. `readInstalledClaudeVersion` takes the first
  executable candidate, resolves it with `realpath`, then reads either the
  native installer's `versions/<version>` file name or the first
  `package.json` above an npm install, whose name must be
  `@anthropic-ai/claude-code` or a platform package and whose version must be
  version-shaped. It spawns nothing. The check fails below the floor, warns
  when no layout yields a version, prints versions only, and is skipped for
  an invalid configuration, a failing `config.local`, a non-Claude reviewer
  and an unavailable executable. The `authentication.models` advisory says
  that doctor checks no CLI version except the Claude reviewer's.
- **Live scenario** (`live-compatibility.ts`).
  - The Claude review inventory allows only `Read`, `Glob`, `Grep` and an
    optional `StructuredOutput`, and requires the first three; `Skill` fails
    it. The prompt names only those three tools.
  - The wrapped runner records whether the Claude review spawn carried both
    variables set to `1`. `claudeBinaryContainsNames` resolves the client
    and stream-searches the file for both names; it never runs it.
  - `liveClaudeReviewChecks` feeds the isolation boolean to
    `claude.read_only_inventory` only, with the failure code
    `ISOLATION_NOT_OBSERVED`. `CHECK_IDS`, the v2 summary and
    `release-policy.json` are unchanged.
- **Documentation and template.** `documentation/orchestrator.md`,
  `documentation/getting-started.md`, root `README.md`,
  `packages/orchestrator/README.md` and `packages/orchestrator/MODULES.md`
  follow R12. The Roles section of `plugins/banzai/AGENTS.md` says reviewer
  independence comes from a fresh session, no memory shared with the builders
  and a fixed read-only tool set, and "cross-model context" became "review
  context". The fresh-adoption fixture is a byte-for-byte copy.
- **Lifecycle and facts.** ADR-0059 is Implemented; the reciprocal lines in
  ADR-0042, ADR-0037 and ADR-0002, the decision index row and
  `PROJECT_MANIFEST.md` follow. Only lifecycle metadata changed in the ADRs.

## Requirement trace

| Requirement | Evidence                                                                                                                                                                                                                                                     |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R1          | `config.ts`; `config.test.ts` "init writes Claude as the default reviewer and keeps an existing reviewer"; `model-selection.test.ts` "the init picker shows Claude as the review default and still offers Codex"; `models.test.ts`; the whole suite after T3 |
| R2          | `adapters.test.ts` "Claude review and routine re-review drop Skill…", "Claude reviewer exposes read-only tools…", "resumed reviewers reapply…"; `planning-review-adapters.test.ts` argv cases                                                                |
| R3          | `planning-review-adapters.test.ts` "Claude planning review isolates the reviewer and planning analysis keeps the planner's environment"                                                                                                                      |
| R4          | `adapters.test.ts` "Claude review disables auto memory and refusal fallback in every scope", including an inherited `0`                                                                                                                                      |
| R5          | `adapters.test.ts` "Claude builders and selection disable auto memory in scoped mode only" and "…keep today's environment in ambient mode and without a scope"                                                                                               |
| R6          | `adapters.test.ts` "Codex children get neither isolation variable and unchanged arguments"; Codex environment assertions in `planning-review-adapters.test.ts`                                                                                               |
| R7          | `workflow-review.test.ts` "a Claude reviewer session recorded before review isolation rotates to a full review" and "a Codex reviewer session carries no invocation digest and never rotates for it"                                                         |
| R8          | `adapters.test.ts` "preflight refuses a reviewing Claude target below the review isolation floor"; `workflow.test.ts` two run-start tests; `interactive.test.ts` launch check; `live-compatibility.test.ts` preflight floor                                  |
| R9          | `doctor.test.ts`: `claude.version` enforce, skip, local reviewer, default config with only `claude`, the offline reader with trap executables, versions-only output; `CHECK_ORDER`; advisory wording                                                         |
| R10         | `adapters.test.ts` "a refused Claude review fails through typed handling without a result"; `planning-review-adapters.test.ts` "a refused Claude planning review is a typed, retry-eligible model failure"; existing failed-review retry tests               |
| R11         | `live-compatibility.test.ts`, six new tests; the Gate 1 live run is pending (see Follow-ups)                                                                                                                                                                 |
| R12         | `instruction-layouts.test.ts` (fresh-adoption byte equality), `workflow-skills.test.ts` (pinned template phrases); review of the documentation diff                                                                                                          |
| R13         | `release-validation.test.ts`; review of the ADR, index and manifest diff                                                                                                                                                                                     |

R10 needed no code: both refusal tests passed on today's typed handling
before and after the change. Since Claude Code 2.1.312 the fallback variable
also stops the model switch for unrecognised model names; the
model-configuration section of `documentation/orchestrator.md` says so.

## T1 · Vendor evidence

On 2026-11-06, `npm pack --ignore-scripts` fetched both packages into the
session scratchpad. Nothing was executed, and both tarballs were deleted.

- `@anthropic-ai/claude-code@2.1.290` (28 KB, sha256
  `a727019aaa8c1c21032ad86dc82ea6ca9e0cc2ab55942249d9ad61ec83cdad10`): the
  install script hard-links or copies the platform binary over the wrapper's
  `bin/claude.exe`. `realpath` of a global npm `claude` therefore lands in
  the wrapper package, and the first `package.json` above it names
  `@anthropic-ai/claude-code` with version `2.1.290`. The wrapper's fallback
  resolves the platform package, whose `package.json` the reader also
  accepts.
- `@anthropic-ai/claude-code-darwin-arm64@2.1.290` (97.2 MB, sha256
  `dda3ec516629b0a3b9f682b503e8db68f21f5babfb572e7c77ebf302b515a5f6`): the
  binary contains `CLAUDE_CODE_DISABLE_AUTO_MEMORY` 4 times and
  `CLAUDE_CODE_DISABLE_REFUSAL_FALLBACK` 3 times.
- Local installs: 2.1.300 shows the same counts; 2.1.316, 2.1.318 and 2.1.319
  contain both names. The native installer keeps each client as
  `versions/<version>`, which the native reader uses.

## Tests

### T2 · Fail-first

The new and changed tests ran against the pre-change source first. Temporary
stubs for the doctor reader and the live checks kept whole files loadable;
T7 and T8 replaced them.

| File                               | Failed first                                                                                               | Passed first (characterization)                                   |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `adapters.test.ts`                 | 6: review tool set, review environment, builder environment, two updated reviewer tests, preflight floor   | ambient and unscoped environment, Codex unchanged, refused review |
| `planning-review-adapters.test.ts` | 2: the Claude argv cases and the isolation test                                                            | refused planning review                                           |
| `workflow.test.ts`                 | 1: the shared-pair run-start floor                                                                         | a Claude pair that only builds                                    |
| `workflow-review.test.ts`          | 1: pre-isolation Claude rotation                                                                           | Codex reviewer unaffected                                         |
| `doctor.test.ts`                   | 37 distinct names: 31 existing tests through the `CHECK_ORDER` position, plus 6 new `claude.version` tests | —                                                                 |
| `config.test.ts`                   | 1: init writes the Claude reviewer                                                                         | —                                                                 |
| `model-selection.test.ts`          | 1: Claude as the review default                                                                            | —                                                                 |
| `interactive.test.ts`              | 1: the launch check marks only the reviewing entry                                                         | —                                                                 |
| `live-compatibility.test.ts`       | 8: 5 new tests, plus 3 existing tests that failed through the fake's new argv assertion                    | summary v2 and check IDs unchanged                                |

### T3 · Pinned and updated tests

After the default changed, the whole suite showed 64 failures. All but two
were the expected fail-first tests. The rest were handled as follows:

- `interactive.test.ts` "startup checks every configured vendor once…"
  depends on a second vendor, so it pins a Codex reviewer through the new
  `codexReviewerConfig()`.
- `interactive.test.ts` "interactive startup shows the models for each phase"
  and `models.test.ts` "the shipped default configuration uses only current
  models" assert the default itself, so their expectations now name Claude.
- `publication.test.ts` failed only because `dist/banzai.mjs.map` was stale;
  `npm run build` in T10 resolved it.

### Focused results

Run through `node packages/orchestrator/scripts/test.mjs --file <name>.test.ts`
with a private output root: `adapters` 76, `planning-review-adapters` 11,
`live-compatibility` 30, `interactive` 114, `config` 10, `model-selection`
31, `doctor` 56, `workflow-review` 38, `models` 15, `workflow` 65,
`instruction-layouts` 2 and `workflow-skills` 13 tests, all passing.
`npx tsc --noEmit -p .` passes.

## Checks

All on 2026-11-06, on the final bytes unless noted.

| Check                                                                                             | Result                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run build`, then `npm run build:check`                                                       | Pass. The build regenerated `plugins/banzai/lib/artifact-readers.mjs` with the new default.                                                                                                                                                                                                                       |
| `npm run verify`                                                                                  | The first run stopped at lint on one error in a new `doctor.test.ts` helper type (a redundant `"read"` union member), fixed with a separate `readClaudeVersion` option. The second run: 2081 of 2082; the one failure was a stale source map, because prettier ran on `src/` after the build. A rebuild fixed it. |
| `npm run format:check`                                                                            | It first reported six changed source and test files; prettier was applied to them. Pass in the candidate.                                                                                                                                                                                                         |
| `npx prettier --check` on the manifest, the tracker, the changed documentation and this directory | Pass. `documentation/decisions/README.md` was not prettier-clean at `HEAD` either and is left unformatted.                                                                                                                                                                                                        |
| Lint on changed lines                                                                             | No error, and no warning on a changed line.                                                                                                                                                                                                                                                                       |
| `publication.test.ts` after the rebuild                                                           | 6 of 6.                                                                                                                                                                                                                                                                                                           |
| `release-validation.test.ts`                                                                      | 208 of 208.                                                                                                                                                                                                                                                                                                       |
| `npm run release:validate`                                                                        | Stops only at the deferred `HOOK_CHANGED_WITHOUT_VERSION_BUMP` (`hooks.json`, `spec-gate.cjs` from WP20 and `plugins/banzai/lib`), as planned.                                                                                                                                                                    |
| `node packages/orchestrator/scripts/release-candidate-check.mjs`                                  | Pass: verify 2082 of 2082, release validation, committed smoke and release check. `node_modules/.bin/banzai` and the dangling `node_modules/node_modules` link were set aside for the run and restored to their exact targets afterwards.                                                                         |
| Live vendor run                                                                                   | Not run; Gate 1 needs the owner's go-ahead.                                                                                                                                                                                                                                                                       |

## Implementation readings applied

1. **Planning analysis is a planner-role invocation.** It and workflow
   selection keep `Read,Glob,Grep,Skill` and the builder environment rule.
   The read-only guarantee is unaffected: the denied mutation tools, hook
   denial and scope check stay.
2. **Pre-isolation reviewer sessions rotate** through the ADR-0021 digest and
   the existing rotation reason; no new reason or state field was added.
3. **Doctor JSON v6 grows by one check.** `claude.version` extends v6
   without a version bump, under the owner decision of 2026-11-02.

## Known limits (R7)

Bindings without an invocation digest are treated as unknown, never as a
mismatch, so they do not rotate on this change:

- reviewer sessions recorded before ADR-0021;
- a review attempt that started before the upgrade and is recovered after
  it, because the recovery path applies the result without a digest.

Persisting the digest on review attempt records would close the second case;
the requirements leave it out of scope.

## Deviations from the plan

- **One injected reader, not two.** T7 said to inject the native and npm
  readers. Doctor injects one `installedClaudeVersion` function whose
  default, `readInstalledClaudeVersion`, holds both layouts. Tests replace
  the whole reading or call the default against trap executables in a
  temporary tree, so nothing spawns either way.
- **Exported test seams.** `meetsReviewIsolationMinimum` (shared by doctor),
  `LiveObservation`, `liveClaudeReviewChecks`, `claudeBinaryContainsNames`
  and the `claudeBinaryContains` live dependency are exported or injectable
  so that the floor and the isolation rows are tested without a vendor
  client.
- **Compliance 7.** Under Q3 (a) the live scenario confirms the inventory
  without `Skill`, both variables on the review spawn and both names in the
  client binary, not the host's honouring of the variables. The tracker
  records this under Deviations from the brief.

## Unchanged, by design

- `claude-permissions.ts`: a Claude reviewer depends on no permission rules.
- `banzai setup`: a builder-side client launch under ADR-0059 §3.
- The fix prompt's "full cross-model context" in `prompts.ts`, which
  describes the artifact the fixer reads, and the `feature-review` skill's
  "cross-model triage".
- Builder tool inventories and the builders' refusal fallback.

## Follow-ups

- **Gate 1 live run.** `npm run compatibility:live` needs the owner's
  go-ahead. It should pass on Claude Code 2.1.290 and on the current release.
- **Version bump.** `npm run release:validate` stops at the deferred
  `HOOK_CHANGED_WITHOUT_VERSION_BUMP` until the 2.8 version is set with
  `npm run version:set`.

## Plan Task Completion

Format: `banzai-plan-task-completion/v1`

| Task | Status    | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Gap or deviation |
| ---- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| T1   | completed | [{"path":"documentation/work/wp07-claude-default-reviewer/implementation-report.md","detail":"T1 section: 2.1.290 wrapper and darwin-arm64 tarballs inspected without execution; name counts 4 and 3; npm and native layouts confirmed."}]                                                                                                                                                                                                                                               | null             |
| T2   | completed | [{"path":"packages/orchestrator/test/adapters.test.ts","detail":"Isolation, Codex, floor and refusal tests; six failed first as planned."},{"path":"packages/orchestrator/test/doctor.test.ts","detail":"claude.version tests and CHECK_ORDER; failed first before T7."},{"path":"packages/orchestrator/test/live-compatibility.test.ts","detail":"Six new live tests; five failed first, plus three existing through the new argv assertion."}]                                         | null             |
| T3   | completed | [{"path":"packages/orchestrator/src/config.ts","detail":"DEFAULT_CONFIG reviewer is claude claude-opus-5-5 xhigh, 30 minutes."},{"path":"packages/orchestrator/test/interactive.test.ts","detail":"Vendor-pair test pinned to a Codex reviewer; default launch row updated."}]                                                                                                                                                                                                           | null             |
| T4   | completed | [{"path":"packages/orchestrator/src/adapters.ts","detail":"CLAUDE_REVIEW_ISOLATION, review and planner tool sets, isolatedClaudeEnvironment at every Claude call site; Codex unchanged; R10 needed no code."}]                                                                                                                                                                                                                                                                           | null             |
| T5   | completed | [{"path":"packages/orchestrator/src/workflow.ts","detail":"invocationScopeDigest hashes CLAUDE_REVIEW_ISOLATION; absent-digest rule and Codex null digest kept."}]                                                                                                                                                                                                                                                                                                                       | null             |
| T6   | completed | [{"path":"packages/orchestrator/src/adapters.ts","detail":"REVIEW_ISOLATION_MINIMUM_CLAUDE_VERSION 2.1.290 applied by requireVersion to reviewing Claude targets."},{"path":"packages/orchestrator/src/workflow.ts","detail":"Run start flags the vendor pair the reviewer shares; reviewer phase preflights pass reviews."},{"path":"packages/orchestrator/src/interactive.ts","detail":"AuthenticationGateway.check receives whether the entry reviews."}]                             | null             |
| T7   | completed | [{"path":"packages/orchestrator/src/doctor.ts","detail":"claude.version after executables.models with the offline native and npm reader; advisory reworded."}]                                                                                                                                                                                                                                                                                                                           | null             |
| T8   | completed | [{"path":"packages/orchestrator/src/live-compatibility.ts","detail":"Inventory without Skill, three-tool prompt, spawn and binary isolation evidence on claude.read_only_inventory only."}]                                                                                                                                                                                                                                                                                              | null             |
| T9   | completed | [{"path":"documentation/orchestrator.md","detail":"Review tools, isolation, floor, doctor and default-model passages per R12."},{"path":"plugins/banzai/AGENTS.md","detail":"Roles section updated; fresh-adoption fixture copied byte for byte."}]                                                                                                                                                                                                                                      | null             |
| T10  | completed | [{"path":"documentation/decisions/0059-claude-default-reviewer-and-reviewer-isolation.md","detail":"Implementation state Implemented; reciprocal lines and index row updated."},{"path":"PROJECT_MANIFEST.md","detail":"Default models, floor, review isolation, doctor check and ADR-0059 row."},{"path":"documentation/work/wp07-claude-default-reviewer/implementation-report.md","detail":"Checks section: build, verify, format, release validation and candidate check results."}] | null             |
