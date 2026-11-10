# Test Report: Interactive Slug Selection and Date-Prefixed Work Directories

- Slug: `interactive-slug-selection`
- Related: [description.md](description.md), [plan.md](plan.md),
  [implementation-report.md](implementation-report.md),
  [ADR-0066](../../decisions/0066-date-prefixed-work-and-initiative-slugs.md)

## Framework and Doubles

Node's built-in `node:test` with `node:assert/strict`, compiled by
`packages/orchestrator/scripts/test.mjs`; tests live in
`packages/orchestrator/test/` beside the existing suites they extend.

- Clocks are injected (`clock: () => Date`) and built with the local `Date`
  constructor at local noon, so the asserted `yymmdd-` prefix does not depend
  on the machine time zone. The midnight case moves the injected clock between
  submission and confirmation.
- Interactive tests use the existing `FakeIO` and `FakeRunner`. `ValidatingIO`
  calls each prompt's `validate` the way the inquirer prompts do. The conflict
  gateway is an in-memory map behind the production `WorkSlugGateway`
  interface.
- Library and runner tests use real temporary repositories from
  `createTestRepository`. The real-runner `control start` test uses the
  existing `FakeAdapters` model doubles; the `banzai run` refusal test spawns
  the built `dist/banzai.mjs` as the other committed-CLI tests do.
- The local-versus-UTC test fixes `process.env.TZ` inside its own test file
  process and restores it afterwards.

## Commands and Outcomes

Focused feedback after the review-1 fixes:

| Command | Outcome |
| --- | --- |
| `node packages/orchestrator/scripts/test.mjs --file run-identity.test.ts` | 4 passed |
| `node packages/orchestrator/scripts/test.mjs --file interactive.test.ts` | 122 passed (after R2-F1) |
| `node packages/orchestrator/scripts/test.mjs --file work-documents.test.ts` | 17 passed |
| `node packages/orchestrator/scripts/test.mjs --file agent-control-cli.test.ts` | 12 passed |
| `node packages/orchestrator/scripts/test.mjs --file cli-routing.test.ts --pattern "committed run prefixes"` | 1 passed |

Mutation checks, each reverted afterwards: replacing the local getters in
`workSlugDatePrefix` with UTC getters fails "the date prefix follows the local
calendar date, not the UTC one"; checking length before format fails "a final
slug must be prefixed kebab-case within 100 characters" and "the slug step
keeps its prompt open for invalid, long or existing names".

Historical/pre-fix focused feedback, run while the work first stabilized:

| Command | Outcome |
| --- | --- |
| `node packages/orchestrator/scripts/test.mjs --file run-identity.test.ts` | 3 passed |
| `node packages/orchestrator/scripts/test.mjs --file work-documents.test.ts` | 16 passed (rerun after the traversal assertions) |
| `node packages/orchestrator/scripts/test.mjs --file interactive.test.ts` | 121 passed |
| `node packages/orchestrator/scripts/test.mjs --file agent-control-cli.test.ts` | 11 passed |
| `node packages/orchestrator/scripts/test.mjs --file release-validation.test.ts` with a pattern selecting the ADR lifecycle-annotation tests | 5 passed |
| `node packages/orchestrator/scripts/test.mjs --file phase-instructions.test.ts` | 7 passed |
| `node packages/orchestrator/scripts/test.mjs --file workflow.test.ts --pattern "existing initiative\|invalid context policy"` | 2 passed |
| `npm run format:check` in `packages/orchestrator` | Prettier rewrote 3 files, then passed |

The workflow and work-documents runs used a separate
`--output-root packages/orchestrator/.dist-check-slug`, removed afterwards.

Final suite: see [Final Verification](implementation-report.md#final-verification)
in the implementation report.

## Files

Added: `packages/orchestrator/test/run-identity.test.ts`, including the
local-versus-UTC and format-before-length cases from the review-1 fixes.

Changed:

- `packages/orchestrator/test/interactive.test.ts`: existing start flows answer
  the slug prompt; new slug-step tests, including inputs that fail two checks.
- `packages/orchestrator/test/agent-control-cli.test.ts`: the start test
  injects a clock and expects the prefixed slug; a real-runner start test
  checks state, run ID, status and work directory.
- `packages/orchestrator/test/work-documents.test.ts`: full-name conflict
  query, binding refusal in the initiative root, untrusted-slug refusal,
  symlinked-root refusal.
- `packages/orchestrator/test/cli-routing.test.ts`: spawned `banzai run
  --slug` refusal for an existing initiative.
- `packages/orchestrator/test/workflow.test.ts`: runner start refusal leaves
  no work directory and no active run.
- `packages/orchestrator/test/phase-instructions.test.ts`: delivered policy
  states the rule.
- `packages/orchestrator/test/release-validation.test.ts`: ADR-0066 fixture
  and exact ADR-0054 annotation admission.

Removed: none.

## Risk and Contract Assurance Map

| Guarantee | Requirement | Risk if broken | Evidence level | Evidence |
| --- | --- | --- | --- | --- |
| Prefix is the zero-padded local date | FR1 | Directories dated wrongly or unsortably | Unit, new | `run-identity.test.ts` "the date prefix uses the zero-padded local calendar date" and "the date prefix follows the local calendar date, not the UTC one" |
| Only today's prefix counts as present | FR2, AC3, AC4 | Double prefix, or an old date accepted as today's | Unit and interactive, new | `run-identity.test.ts`; "the slug step adds only a missing current-date prefix to a typed slug" |
| Final slug is prefixed kebab-case within 100 characters, format reported first | FR3, AC5 | Invalid directory names reach the filesystem | Unit and interactive, new | `run-identity.test.ts`; "the slug step keeps its prompt open for invalid, long or existing names" |
| Uniqueness by full name in both roots | FR4, AC6, AC8 | Overwrite of an existing work or initiative directory (security class 7) | Library, new | "work slugs conflict by full name in the work and initiative roots" |
| Untrusted slug is validated before any path use | Security class 1 | Path traversal from a typed slug or `--slug` | Library, new | same test: `../initiatives`, `261110-program/../x` and empty slugs are refused with `ARTIFACT_INPUT_INVALID` |
| Conflicts resolve only through contained paths | Security class 1, plan T003 | A symlinked root answers from outside the repository | Library, new | "work slug conflicts refuse a symlinked root instead of following it" |
| One prompt; Enter, `y`, `Y` accept the default; exact copy | FR5, FR6, AC1, AC2 | Changed UX or a second prompt | Interactive, new | "the slug step accepts the generated slug with Enter, y or Y" |
| Validation order and exact messages, including a conflicting default | FR7, AC5-AC7 | Prompt accepts a bad or taken name, or shows the wrong reason | Interactive, new | "the slug step keeps its prompt open for invalid, long or existing names": `A`x94 fails format and length, `Login_Fix` fails format and exists, `b`x94 fails length and exists |
| `Slug:`/`Request:` lines, unchanged confirmation, start with the submitted slug | FR8, AC1 | Run starts with a different slug than shown | Interactive, new | Enter/y/Y test; existing start test expects `261110-implement-sc-12345` |
| Midnight between submission and confirmation | FR8, AC9 | Run slug silently re-dated | Interactive, new | "a slug accepted before midnight starts the run unchanged after midnight" |
| A refused or failed existence check keeps the prompt open | FR7, R2-F1 | Session crash with a raw stack trace, because the prompt library drops a rejected validation | Interactive, new | "a refused existence check keeps the slug prompt open with its reason" |
| Decline or interrupt starts nothing | FR9, AC10 | Unwanted run or directory | Interactive, new | "declining or interrupting the slug step starts no run" (decline, `ExitPromptError`, `AbortPromptError`) |
| `control start --slug` finalizes the slug into state, run ID, status and work directory | FR10, AC11 | Agent-started runs stay undated | CLI unit, changed and new | "control start prefixes the slug with the local date and passes request data unchanged"; "control start with a real runner carries the prefixed slug into state, run id, work directory and status" |
| `banzai run --slug` finalizes the slug | FR10, AC11, AC12 | Scripted runs stay undated | Spawned CLI, new | "committed run prefixes --slug and refuses an existing initiative without starting a run" (refusal path; a successful spawned run would reach real vendor preflight) |
| Run start refuses a taken name before any run record | FR11, AC12 | Half-created run or overwritten directory | Runner and spawned CLI, new | "a start whose slug names an existing initiative refuses before creating a run"; the spawned `banzai run` test |
| Earlier undated runs keep working | FR12, AC13 | Resume or status breaks for existing runs | Runner, reused | existing workflow, recovery and status tests that start and resume undated slugs; the runner does not re-date |
| Delivered policy states the rule | FR13, FR16, FR17, AC14, AC16 | Standalone agents keep creating undated directories | Instruction test, new | "delivered artifact-storage policy states the ADR-0066 date-prefixed slug rule"; `build:check` baseline parity |
| Initiative skill applies the rule | FR14, FR15, AC15 | Initiative packages resolved by the wrong name | Inspection | `plugins/banzai/skills/initiative/SKILL.md` against FR14-FR15 |
| Maintained docs state the rule | FR17, AC16 | Docs contradict behavior | Inspection | `documentation/artifact-storage.md`, `documentation/orchestrator.md` |
| Pinned ADR-0054 accepts only the exact annotation | ADR-0066 Lifecycle Links | Unauthorized edits to a pinned authority | Release validation, new | "ADR-0066 admits only its exact accepted ADR-0054 lifecycle annotation" |

## Decisions

- `banzai run --slug` is tested by spawning the built CLI on the refusal
  path only. A successful spawned run would continue into real vendor
  preflight; the success path is shown through `control start` with a real
  runner and the same finalization call.
- FR13-FR15 change agent guidance, not code. The delivered policy is pinned by
  an instruction test and the baseline; the initiative skill is checked by
  inspection. Owner: feature review.
- FR12 reuses existing runner and recovery tests, which still start and resume
  undated slugs because finalization happens only at the CLI entry points.
- `run-identity.test.ts` tests a pure helper directly because the prefix and
  finalization rule is itself the ADR-0066 contract, shared by three entry
  points.
- The runner refusal test does not assert that `.banzai/` is untouched: the
  workflow lock already creates `.banzai/runs/` before run start validates the
  binding, as before this change. It asserts the guarantee FR11 names: no work
  directory and `NO_ACTIVE_RUN`.

## Critique Loop

Pass 1 found two gaps and closed them:

- The conflict query accepts untrusted slugs, but no test showed it refuses a
  traversal before path use. Added three refusals to the work-documents test.
- FR11's "leaves no active run" had no runner-level evidence; the library test
  showed only that no directory was created. Added the workflow test.

Pass 2, after those changes, found no unasserted error path, hollow or
implementation-coupled test, redundant evidence, or unused helper parameter.

Review-1 closure (F1, F2, F4) added the local-versus-UTC test, inputs that fail
two validation checks, a real-runner `control start` test and a spawned
`banzai run` refusal test; F3 added the symlinked-root assertion. The mutation
checks above show that the F1 and F2 tests fail for the regressions they name.
A further pass found no redundant or hollow test among them. Review-2 closure
(R2-F1) added one interactive test with a rejecting fake gateway.
