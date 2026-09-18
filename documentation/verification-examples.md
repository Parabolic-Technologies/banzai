# Task Verification

Banzai starts new tasks without verification profiles or `verification.bootstrap`.
Describe the result you need. The agent inspects actual scripts, tool configuration,
CI and project instructions, proposes relevant checks, and creates missing tests
or tooling within authorized scope. Discovery never authorizes execution.

For example, adding ESLint to a new Node project requires a working lint check.
An absent `typecheck` script and the default npm `test` placeholder are not extra
requirements. A failed lint check prevents declaring that task complete.

## Strict and lite work

Strict mandatory checks are self-contained descriptors in the approved plan's
`banzai-verification-obligations/v2` block. Each descriptor names its requirement,
executable, literal arguments, working directory, timeout, evidence mode and any
source or future-tooling constraints. Additional checks cannot replace or weaken
approved obligations. Changing a mandatory obligation uses the existing approval
path; the approved plan bytes remain immutable during implementation.

Lite checks use the requested task and existing execution permissions. No separate
verification approval ceremony is added. Editing a project script does not itself
grant additional permissions. The local runner inherits its own process permissions;
model CLI sandbox settings do not sandbox verification subprocesses.

## Evidence and completion

The runner retains immutable decisions, physical starts and terminal results,
logs and observed inputs under the bound private work. This is execution history,
not a second configuration to maintain. Passed, failed, not-run, unavailable,
interrupted and absent remain distinct. An absent unnecessary check permits
progress; a missing mandatory check prevents confirmed completion. Independent
strict review assesses actual requirement coverage and unjustified test weakening.

Optional policy lives in config schema 4 under `verification.policy`, using
`banzai-task-verification-policy/v1`. It may require descriptors, deny exact
commands/arguments/directories, bound timeouts and working directories, or require
an execution context. An unavailable required context refuses execution. Omit
verification entirely when no additional project policy is needed.

Equivalent evidence remains opt-in and requires complete known inputs and a direct
successful physical origin. Fresh checks and `release:check` execute afresh.
Unknown inputs or a later failed/incomplete attempt cannot count as reusable success.

## Transition

New work uses private binding v2 and task verification. Existing runs are not
migration or continuation targets for this change; start a new task. Retained
historical files are not rewritten or used as new approval authority. Legacy
profile utilities do not control new-task verification.
