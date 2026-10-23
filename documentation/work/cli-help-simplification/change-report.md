# CLI help simplification

Date: 2026-10-23

## Scope and result

The user reported that `banzai --help` contains too much noise. The overview
now lists common commands, additional command names, and concise options.
`banzai help <command>` provides syntax and relevant explanations;
`banzai help progress` contains progress details. Protocol versions appear
in control/legacy approval help instead of the general overview.
The overview is 30 lines and 119 words, down from 61 lines and 440 words.

This is new scoped quick-fix work with no upstream feature artifact or
triaged review findings. Existing unrelated working-tree changes are outside
scope. No dependency, workflow decision, persisted format, or execution
permission changes are introduced.

## Implementation and documentation

- Production: `packages/orchestrator/src/cli.ts` retains help text ownership
  and adds topic selection in the existing help branch, before repository
  discovery. Existing command parsers keep their exact option contracts.
  `run --help` now selects run help; `help <command>` works for every command,
  including commands whose own parser rejects `--help`.
- Tests: `cli-routing.test.ts` covers repository-independent overview/topic
  help, invalid topics, and no filesystem changes. Existing input-schema
  assertions move to control help. `committed-smoke.test.ts` and
  `release-validation.test.ts` fixtures track the new help presentation.
- Build/release checks: `check-dist.mjs` checks the interactive-mode hint;
  `smoke-committed.mjs` checks the overview and its pointer to command details.
  `check-release.mjs` retains the consultation authority reminder in control
  help and the existing full gate documentation checks.
- Maintained documentation: `documentation/orchestrator.md`,
  `packages/orchestrator/MODULES.md`, and the manifest's CLI entry describe
  the overview and topic help.

Security exposure: none created or widened. Help selects static text and
returns before repository discovery, workflow mutations, or vendor calls.

## Design and ADR conformance

Reuse search: `cli.ts` owns `HELP`, `cli-routing.ts` owns help routing, and
`cancellation-cli.ts` owns `CANCELLATION_HELP`; searches of CLI modules and
CLI-routing tests found no existing general help-topic selector. The cancel
topic reuses its existing help constant.

The executable call-site edit touches `main`, which already exceeds the
adopted complexity warning threshold (baseline 125, limit 15). Disposition:
retained. The existing branch owns repository-independent presentation;
the new pure selector and static topics require no collaborators or imports.
Extracting general CLI composition or introducing a command framework would
add unrelated ownership changes. Invariants are unchanged command parsing,
no new execution path from help, no repository requirement, and one owner
for each help entry. The existing `main` complexity remains separate debt.
Final focused lint retains the same seven CLI warnings and complexity 125;
the help selector adds no warning.

[ADR-0018](../../decisions/0018-agent-supervised-banzai-cli-control.md),
[ADR-0031](../../decisions/0031-interactive-decision-consultation.md), and
[ADR-0055](../../decisions/0055-planning-gate-rework-and-independent-planning-review.md)
retain their control and human-decision boundaries.
[ADR-0033](../../decisions/0033-root-package-version-authority.md) continues
to supply the overview version from the package mirror. No accepted ADR
body or lifecycle is changed. Material Engineering Quality deviations: none.

## Verification

Final evidence, on the current working tree:

- `npm run build:dist` — passed; rebuilt the ignored local executable.
  The `banzai` executable on PATH resolves to this workspace's bundle.
- `npm run verify` — typecheck passed; lint passed with zero errors and
  415 advisory warnings. The full test run executed 1,792 tests: 1,732 passed
  and 60 failed in `release-evidence.test.ts` because the sandbox refused
  local HTTP listeners (`listen EPERM` on `127.0.0.1`). The combined command
  exited nonzero and did not reach its final build check.
- `node packages/orchestrator/scripts/test.mjs --file release-evidence.test.ts`
  — rerun outside the sandbox with execution approval; all 62 tests passed,
  including all 60 failures from the full run. No live service was used.
  The other two cases had already passed in the full run. Together these
  executions cover all 1,792 tests successfully; this is not a claim that
  the combined `npm run verify` invocation exited zero.
- `npm run build:check` — passed separately after adapting the non-TTY smoke
  hint to the new overview; generated resources and distribution parity pass.
- `npm run format:check` — passed for the orchestrator workspace. Focused
  Prettier checks also passed for the root manifest, maintained guide, and
  this report. The final `check-dist.mjs` edit passed focused ESLint and
  Prettier checks.
- `git diff --check` — passed. The new report is eligible for Git review;
  raw execution logs remain ignored in `.banzai/cli-help-simplification/`.

Historical/pre-final evidence: the focused CLI, smoke, and release-validation
run executed 226 tests, with 225 passing and one obsolete assertion requiring
detailed syntax in root help. That assertion was removed from the version
test; control schema discovery remains covered in topic help, and the
corrected version test passes in the full run above. Initial formatting and
regex-lint findings were corrected before the full run. Pre-change focused
ESLint recorded zero errors and the same seven warnings in `src/cli.ts`.

Assurance selection: CLI process tests protect the newly exposed read-only
help route and preserve discovery of input schemas. Existing release/smoke
checks are adapted rather than adding snapshots or tests of every copy line.
No exact line-count or wording snapshot is used as a correctness gate.
No unresolved finding remains within this fix. No commit, push, publication,
or live vendor invocation was performed.
