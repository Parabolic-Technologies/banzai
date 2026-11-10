# Banzai Orchestrator Reference

Operational reference for the local `banzai` CLI. For installation and your
first task, start with the [Quick start](../packages/orchestrator/README.md#quick-start).
For other guides, see the [documentation index](README.md).

## Contents

- [Workflow Reference](#workflow-reference)
- [Boundaries](#boundaries)
- [Setup](#setup)
- [Interactive Human Time](#interactive-human-time)
- [Test Assurance And Verification Ownership](#test-assurance-and-verification-ownership)
- [Engineering Quality Shadow Review](#engineering-quality-shadow-review)
- [Repository Release Confidence](#repository-release-confidence)
- [Cancellation observations](#cancellation-observations)
- [Commands](#commands)
- [Agent Control](#agent-control)
- [Project Verification Readiness](#project-verification-readiness)
- [Context Accounting and Budgets](#context-accounting-and-budgets)
- [Evaluation Export](#evaluation-export)
- [Evaluation KPIs](#evaluation-kpis)
- [Interactive Mode](#interactive-mode)
- [Review Artifact](#review-artifact)
- [Choosing Models](#choosing-models)
- [Model Configuration](#model-configuration)
- [Spawned Claude Environment](#spawned-claude-environment)
- [Live Progress](#live-progress)
- [Failure Recovery](#failure-recovery)
- [Local State](#local-state)

## Task verification

New tasks use task-scoped verification and tracked-document binding v3. They do not
require profiles, bootstrap, project-type coverage, or a verification setup gate.
Strict checks belong to the approved plan; lite checks use the delegated task and
current process permissions. Optional project policy may add requirements and
execution limits. The local runner does not inherit the model CLI sandbox.

At the plan gate, the interactive session, `banzai status` and the state printed
after a command list **Verification that gates completion**: every check the
plan binds, then any check the project policy requires, with its requirement
references, working directory, timeout, the task that creates its tooling, and
the exact command on its own line. An inventory that approval would reject shows
that error instead. Planners build each check from the project's documented
command with its configuration flags and prefer a discovered script entry point
such as `composer run-script <name>` or `npm run <name>`.

The planner does not compute the inventory's `planRemainderSha256`. It writes 64
zeros, and when the runner accepts a planning result that requests plan approval
it validates the plan, records the digest evidence and writes the remainder digest
into the plan, every other byte unchanged. The gate shows those bytes. A plan
that changes during that write is left as it is and fails the attempt, which
`banzai retry` can continue.

The plan gate also says that the run is waiting and lists the bundle files with
full repository-relative paths. Edit them in any editor, then choose **Re-check
my edits** (between approve and rework) or run
`banzai approve plan --decision recheck`. A re-check never approves and never
starts a phase. It validates the edited plan as approval does — exactly one v2
inventory with valid descriptors, the task heading grammar, the runner-control
task rule and the fresh-evidence rule — except for the remainder digest, which
it recomputes over the edited bytes and writes into the inventory's
`planRemainderSha256`, every other byte unchanged. The write is refused when the
plan changed while the re-check ran. A refused re-check names the problem and
writes no file, state, event or snapshot; the run keeps waiting. The summary
compares the bundle with the planner's version, which the runner retains
privately under `.banzai/runs/<run-id>/plan-gate/<NNN>/` each time the gate is
entered: changed, added and removed files, sections by heading, checks by
identity with the names of changed fields, whether the digest was rewritten, and
a warning for each changed accepted ADR. It carries no other file content. The
interactive gate, `banzai status` and agent status show the latest summary of
the current gate entry. A run that reached the gate before this release says the
planner's version is unavailable. Approval itself never rewrites a digest:
approval over edited prose still fails with `TASK_VERIFICATION_DIGEST_MISMATCH`
and names the re-check. The first re-check moves the run to state v11, which
records it and links the approval to it; runs that never re-check stay at v10.
Historical (v9 and earlier) runs and legacy profile-mode plans have no re-check.

Actual checks and their outcomes are retained as runner evidence. Missing unrelated
scripts are not requirements; failed or absent mandatory checks prevent completion.
A verification round runs every selected check in order. A non-zero exit, a
timeout, the output limit or an executable that cannot start does not stop the
round, so one round reports every failing check. A signal-terminated check, a
runner failure, a cancellation, a failed authorization or ownership check, and
changed inputs stop it; the remaining checks show as not run. A check that
changes observed project files, whether it passed or failed, stops the round
with its name and the changed paths.
Strict independent review assesses meaningful test coverage and weakening of
assertions. See [task verification](verification-examples.md). Earlier profile and
configuration-gate details below describe legacy utilities and retained historical
formats. Existing runs are not migration targets; begin new work for this model.

## Workflow Reference

The `banzai` CLI. It first uses the configured planning model to select a
workflow through a read-only structured contract:

1. `quick-fix`: implementer runs `quick-fix`, deterministic verification, done;
2. `feature`: implementer runs `feature`, deterministic verification, done;
3. `strict`: planner runs `feature-description`, conditional
   `architecture-decision`, and `development-plan`; after explicit decisions,
   a compatible builder lineage runs `code-writing`, `test-writing`, and
   accepted fixes; deterministic verification runs, and an independent reviewer
   runs `feature-review`.

Strict review findings are triaged by the human; only accepted findings reach
the fixer. If none are accepted, the complete triage closes the run directly
without a fixer, verification, or unchanged-source reviewer call; status keeps
the latest `changes_requested` verdict and labels completion as human triage,
not review pass. Accepted findings retain deterministic verification and bounded
re-review. Primary review is fresh; routine re-review resumes the reviewer for
at most two deltas before a fresh full audit. Automatic selection is the default,
and uncertain or escalated work falls back to strict.

New strict plans carry the installed plan policy's explicit **Plan Authority**
convention: binding behavior, scope, necessary constraints and evidence, with
useful optional guidance labeled separately. Role prompts refer to that same
policy. A compliant alternative within approved discretion needs no reapproval
or deviation report merely for differing; legacy directives retain their approved
meaning and required checks remain mandatory. Editing any approved plan text,
including guidance, still invalidates approval. Task parsing, completion and
review-result v2 contracts are unchanged by this document convention.

This package, `@parabolic-technologies/banzai`, is a separate npm workspace:
it neither installs nor starts with the plugin, and the plugin remains usable
on its own. Its package version is a mandatory mirror of root
`package.json.version`, the sole Banzai release-train authority; shared source
metadata does not imply shared installation or publication.

## Boundaries

- macOS or Linux with Node.js 22.20.0+ within major 22, 24.11.1+ within
  major 24, or 26.13.0+ within major 26;
- a local `claude` 2.1.290+ executable for every Claude role, and `codex`
  0.145.0+ when a role uses it, or the newer release a configured model needs
  (see [Model Configuration](#model-configuration));
- individual-subscription authentication only;
- one active run in the current checkout;
- no API keys, direct vendor APIs, worktrees, branch switching, stash, reset,
  commits, or external writes.

## Setup

The [Quick start](../packages/orchestrator/README.md#quick-start) covers installation from npm. For development,
run the following from a source checkout instead:

```sh
npm ci
npm run install:orchestrator
```

The development command rebuilds the executable and exposes `banzai` through
npm's global link. The link points to that checkout; rerun `npm run build`
after changing orchestrator source. Then follow the project configuration
steps in the Quick start.

## Interactive Human Time

The interactive summary shows `Time for this run`, with `Active time estimate`
before `Waiting for decisions`. A missing estimate reads `Not added · optional`;
a saved value reads `Self-reported · one person`. Invalid, unreadable or
conflicting estimate evidence reads `Unavailable`, rather than appearing empty.
An explicitly entered zero remains a saved estimate.

Decision waiting is elapsed time from a pending request to its recorded response,
before following model work. It includes time away and does not measure active
work. Its recorded-response subtotal shows how many answered responses have
known durations. Recorded waits only are represented; coverage may be incomplete.
Partial inventory and capture gaps do not invalidate known durations or identify
a specific missing wait. Open, cancelled, superseded and incomplete decisions,
provisional values and recovery waiting retain separate outcomes in details.

At an existing human stop or blocked/terminal summary, select
`Add active time estimate (optional)` or `Edit active time estimate` to enter
**your cumulative active minutes for this run so far**. Unavailable evidence
offers `Review active time estimate (unavailable)` and must be checked before
editing. Include preparation, approvals, review, active checks, debugging,
manual repair and recovery, including work outside the CLI. Exclude passive
waiting, minutes already allocated to another run or task, other contributors,
and study-recording overhead. No identity question or additional post-gate
prompt is added. The editor returns to the same decision; mid-triage selections
are retained.

An entry is always self-reported, with an `as of` timestamp in details and the
editor. Entering 15 after 12
replaces the total with 15. Blank input or cancelling keeps the earlier value;
explicit zero saves zero. Nothing is inferred or prefilled from decision waits.
Later work does not refresh a saved estimate. Action labels refresh after editing.
Use `View time details` to open `Time details · this run`: recorded episodes,
durations, a recorded-response subtotal, coverage, recording and attribution
notes, and secondary diagnostic codes. When all recorded decisions are answered,
that status appears once. Recovery waiting remains separate and never enters
the answered-response subtotal; neither do open or provisional waits.

Automatic durations are formatted directly from milliseconds. Zero is `0s`;
positive values below a second are `<1s`. Below an hour, values round to the
nearest second with carries (`59.5s` becomes `1m`). Once rounded seconds reach
an hour, values round to the nearest minute (`1h 2m`); half-unit ties round up.
Subtotals use original durations, so rounding displayed rows before addition
can give a different result. Missing durations read `Unavailable`. Rows align
on wider terminals and stack or wrap at narrow widths, with color optional.

Details explain that the active-time value estimates one person's work; identity
is not verified, other contributors are not represented, and a complete task
total is not established. Shared notes describe UTC timestamps and process-local
clock checks; per-row exceptions preserve unverified or discontinuous clocks.
Clock checks establish neither identity nor active work.

The interactive path stores bounded local metadata in
`.banzai/runs/<run-id>/human-time.json` as a private `0600` file. It retains
observations and replacement history with the run, including cancelled work;
deleting the run removes this evidence. The run directory is not a research
archive. Historical completed gates are not backfilled when first opening an
old run. Reopening preserves captured episodes, but intervals closed outside
the process have unverified wall-clock continuity. No activity monitoring,
personal names, answers, prompts, transcripts or arbitrary notes are collected.

`Time was not saved` means the write did not succeed; reopen the editor against
the current evidence before retrying. Stale edits and concurrent writers cannot
silently overwrite a newer total. A hard crash may leave `human-time.lock` or a
temporary file. Reads still use the last valid ledger. An ambiguous guard is
never reclaimed automatically: cleanup requires a separate explicit offline
maintenance action with writers stopped. Timing cannot authorize or replay a
workflow decision or invoke recovery.

Existing evaluation/KPI/context/control and status JSON contracts ignore this
private ledger; evaluation v1 `humanMinutes` remains unavailable. The separate
cancellation report has the narrow estimate disclosure described below. Task-wide
collection, equivalent native-workflow collection, acceptance/quality evidence
and the effectiveness comparison remain follow-up work. See
[feature specification](https://github.com/Parabolic-Technologies/banzai/blob/main/documentation/features/interactive-human-time/description.md)
and [ADR-0034](https://github.com/Parabolic-Technologies/banzai/blob/main/documentation/decisions/0034-durable-human-time-observations.md).

## Test Assurance And Verification Ownership

Banzai selects tests by the observable guarantee and plausible regression they
protect. Business rules, public and persisted contracts, authorization,
security, privacy, state transitions, recovery, decision tables, and confirmed
defects take priority. Coverage percentage and test count are diagnostics, not
completion targets, unless the target project's manifest records an explicit
policy threshold. Boundary fakes are valid when assertions exercise the real
contract; tests that mirror private call order or duplicate existing evidence
are not useful assurance.

Implementation and fix prompts describe task verification authority. Builders
run focused affected tests and leave the selected final checks to the runner.
Strict obligations are part of the approved plan; phase-result v4 candidates
add checks separately, within task permissions. Discovery and the legacy
`requestedVerification` prose field confer no execution authority. Missing
tooling is created only within the authorized task scope.

Independent review treats successful current runner evidence as authoritative
by default. It may run a focused reproduction or repeat missing, stale,
inconsistent, or directly material evidence, recording the reason; it does not
rerun the complete suite or formatter by habit. A missing-test finding must name
the material guarantee, plausible regression, evidence gap, and proportionate
observable test level.

## Engineering Quality Shadow Review

The installed plugin carries one vendor-neutral Engineering Quality policy in
`policies/engineering-quality.md`. Standalone consuming skills explicitly read that file
relative to their installed `SKILL.md`; runner phases receive the same body inline. Planning and implementation skills
apply only properties material to the changed repository surface; Test
Assurance continues to own test selection, while configured checks, contract
verification, Security Assurance, or justified inspection may own other
material claims.

Strict review completes and freezes its ordinary findings, severities, and
verdict before EQ classification. An already-actionable finding may add one
primary `EQ-NN` entry to `violates` without changing ordinary review semantics.
A genuinely incremental candidate may appear only as an `EQ-SHADOW:` string in
the existing free-form `deferredCoverage` collection. Shadow entries never enter
`findings`, human triage, accepted-finding payloads, fixer scope, verdict or
completion logic, and are not parsed by runtime validation.

New orchestrated reviews retain opaque `EQ-SHADOW:` strings exactly through
runner rendering, including multiline content. Historical reviewer-written
Markdown remains intact; standalone review owns its durable Markdown separately.
No runtime interpretation or gate is added.

After a fix, review is closure-oriented: it verifies the immediately preceding
accepted IDs first. A new concern requires evidence that the fix introduced or
newly exposed it, directly regressed an approved contract/invariant, or made a
previously unobservable critical correctness, security, or lifecycle issue
visible. Reviewer rotation does not reopen rejected or deferred advice against
unchanged evidence and authority. The sampled evaluation procedure is
[`documentation/evaluation/engineering-quality-shadow.md`](https://github.com/Parabolic-Technologies/banzai/blob/main/documentation/evaluation/engineering-quality-shadow.md).

## Repository Release Confidence

Repository maintenance uses a locally built bundle without requiring the global
link. `dist/` is ignored by Git and built during CI and npm publication:

```text
npm run build:dist
npm run release:validate
npm run smoke:committed
npm run release:check
```

For an explicitly approved product release, a maintainer first selects one
canonical SemVer target from the highest impact across all included plugin and
orchestrator changes, then synchronizes the fixed metadata set:

```text
npm run version:set -- <version>
```

The operation changes root `package.json.version` and eight mirrors in seven
files: four plugin fields, the orchestrator package, and the lockfile's
`version`, `packages[""].version`, and `packages["packages/orchestrator"].version`.
It prepares one candidate per physical file, including all three lockfile edits.
Normal updates require nine equal current values and a greater target. The
bootstrap exception accepts the six-field `1.19.0` state with the three new
fields absent and inserts them at target `1.19.0`; partial bootstrap or root-only
editing is invalid. It accepts no path override, selects no
version, and does not build, validate, install, publish, or perform Git work.
Before deleting `.banzai-version-set`, final cleanup durably writes the fixed
`.banzai-version-set.guard` with the same exact originals and candidates. The
guard remains validator-visible until the main journal removal is synced. If an
interrupted operation retains the transaction directory, cleanup guard, or
guard temporary, `npm run version:recover` restores its exact originals. Before
changing targets or recursively cleaning a journal that coexists with the
guard, recovery authenticates every retained entry as an expected remnant of
that same transaction. It is not an interface for selecting a release rollback
target. Before restoring any target, explicit recovery checks every current
metadata file against the authenticated original/candidate bytes and recorded
mode. Later edits or mode drift cause refusal and preserve recovery evidence.
Recovery uses the retained format's fixed targets: six-file journal/guard
format 1 and grouped seven-file format 2 are both supported, independently of
the current write policy. Restoring an old independent-version candidate
requires its matching historical tooling before another migration. The
standalone CLI keeps its embedded package mirror and needs no root package file
at runtime. Rebuild the bundle after release-policy changes because
`live-compatibility.ts` embeds that configuration.

`release:validate` is read-only. It checks canonical nine-way release-train
parity against root `package.json.version`, rejects any retained version
transaction or cleanup-guard state, keeps the Claude marketplace versionless,
and validates required skills/hooks/contracts/entry files, hook syntax,
package/lockfile policy, canonical Test Assurance, Security Assurance,
and Engineering Quality policy wiring, built bundle mode, CI policy, and
documentation policy. Instruction-layout validation pins the exact shim,
process sections, six policy owners, complete required/conditional read matrix,
scoped reference rules, migration approval text and last legacy-compatible
release. The Engineering Quality check protects rule/reference
and shadow-boundary text; it does not analyze target-project architecture.
`smoke:committed` retains its historical command name, creates a disposable Git
repository and runs the locally built bundle's non-TTY help, init,
agent-control capabilities/status, doctor JSON, and
evaluation JSON paths twice. Capabilities also run outside Git. The smoke
requires the v1 identities, clean stderr, deterministic bytes, no source,
configuration, Git, or `.banzai` mutation, and complete cleanup. Help and
capability versions must match the current package mirror independently of
the pinned machine-contract versions.
`release:check` first runs `build:dist`, then adds both checks and direct
formatting to the unchanged `verify` gate, rejects tracked byte or mode mutation, and never invokes
`version:set` or `version:recover`.

<!-- release-policy:start -->

Engines: `>=22.20.0 <23 || >=24.11.1 <25 || >=26.13.0 <27`

Version authority: `package.json#/version`; 9 fields in 7 files.

| Evidence             | Node    | Image                   | GitHub Actions job      | Policy   |
| -------------------- | ------- | ----------------------- | ----------------------- | -------- |
| Supported (blocking) | 22.20.0 | `node:22.20.0-bookworm` | `release_check_node_22` | required |
| Supported (blocking) | 24.11.1 | `node:24.11.1-bookworm` | `release_check_node_24` | required |
| Supported (blocking) | 26.13.0 | `node:26.13.0-bookworm` | `release_check_node_26` | required |

<!-- release-policy:end -->

The supported lanes are blocking and each runs `npm ci` plus the full local
gate ([ADR-0067](decisions/0067-node-26-supported-release-lane.md)). Node 23,
25 and 27 have no lane and no support claim. A required environment
failure remains missing evidence rather than becoming a product pass.
The images are the Git-capable official Bookworm variants. Each lane runs
`git --version` and registers `$GITHUB_WORKSPACE` as a Git `safe.directory`
before installation: the gate verifies tracked-file immutability with Git,
and the container runs as root while the runner owns the checkout directory,
which Git otherwise rejects as dubious ownership.

The workflow is [`.github/workflows/ci.yml`](https://github.com/Parabolic-Technologies/banzai/blob/main/.github/workflows/ci.yml)
([ADR-0053](decisions/0053-single-pull-request-ci-gate-and-publish-evidence-reuse.md)).
The supported lanes run on pull requests and manual dispatch; the workflow has
no scheduled run. A push
to `main` or `dev` starts no hosted run, and a newer push to a pull request
cancels that pull request's in-progress run. After `release:check` passes, each
supported lane records the tree it verified as a 30-day
`release-evidence-<lane>-attempt-<attempt>-tree-<tree>` artifact.

Publication through `.github/workflows/publish.yml` reuses that evidence only
when the release tag is a merge commit whose tree equals its second parent's,
and a successful pull-request run of this repository's `ci.yml` for that parent
has every supported lane's evidence for the tag's tree in its latest attempt.
Otherwise every supported lane runs the complete `release:check` on the tag
before anything is published. The `release_evidence` job summary states which
path ran. `npm run release:validate` owns the layout of both workflows.

Where the GitHub plan offers branch protection or rulesets, require
`release_check_node_22`, `release_check_node_24` and `release_check_node_26`
after GitHub has reported
those checks; this private repository on GitHub Free has neither, so the
publication gate is the mechanical release enforcement. Workflow YAML does not
configure repository merge rules. Validate workflow syntax locally with
`actionlint`; `.github/actionlint.yaml` declares the custom runner label.

To enable the manual live job, provision an isolated Linux runner labeled
`banzai-live` with supported Codex/Claude CLIs and the subscription-auth roots
described below. Restrict its runner group to this repository and this workflow
at explicitly trusted protected refs using GitHub's
[workflow access policy](https://docs.github.com/en/enterprise-cloud%40latest/actions/how-tos/manage-runners/self-hosted-runners/manage-access).
The runner label and job condition do not restrict other workflows' access to
that machine. Keep the live job disabled if that protected runner boundary is
unavailable. Once provisioned, set repository variable
`BANZAI_LIVE_COMPATIBILITY` to `1`, select **Run workflow** on a protected ref,
and enable the `live_compatibility` input. The job requires all three conditions
and is skipped on pull request events. Node setup disables automatic
npm caching, checkout disables persisted credentials, and no artifact upload
is configured. GitHub runner provisioning and authenticated live execution
require their own evidence.

The separate live command is deliberately absent from `release:check`:

```text
npm run compatibility:live -- --confirm-live
```

It requires dedicated out-of-band subscription state through
`BANZAI_LIVE_CODEX_AUTH_ROOT` and `BANZAI_LIVE_CLAUDE_AUTH_ROOT`. API-key
and third-party-provider paths are rejected. The command clones the exact
committed candidate into disposable Codex and Claude checkouts, copies bounded
auth state to restrictive temporary roots, verifies minimum CLI versions and
subscription auth, and then performs at most one model call per vendor.

Codex must execute the two exact runner-owned write-probe commands under its
read-only sandbox. Only failed `item.completed` `command_execution` events with
the direct command or a fully anchored `sh`/`bash`/`zsh -lc` wrapper, exact
payload, target, bounded probe result, and non-zero denial count as evidence.
Arbitrary prefixes, suffixes, operators, and trailing arguments are rejected;
the runner renders both vendors' candidates from review-result/v2 and their
frozen fixture snapshots. Claude uses the same read-only arguments as normal
review. A typed host `system/init` inventory must include Read, Glob and Grep
and exclude every other capability except StructuredOutput; `Skill` fails it.
This proves source/control/candidate writing is unavailable through exposed
tools; it does not claim an attempted write was denied. Missing, duplicate,
unknown or writable tools fail the authenticated scenario. Model prose and
requested argv alone do not establish this evidence. Offline hook tests are
separate from live evidence.

`claude.read_only_inventory` also requires review isolation, reported with
`ISOLATION_NOT_OBSERVED` when absent: the spawned Claude review process carried
`CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` and
`CLAUDE_CODE_DISABLE_REFUSAL_FALLBACK=1`, and the resolved client binary
contains both names. The binary is searched, never run, and only the result is
kept. This shows that the variables were sent and that the client knows them;
the client's behaviour on them rests on the vendor's documentation. The live
Claude preflight applies the one Claude minimum of
[Model Configuration](#model-configuration).

Both live invocations receive their prompt on stdin, and the Claude review
runs with the run-stability environment of
[Headless Invocations](#headless-invocations); at the five-minute bound its
`BASH_MAX_TIMEOUT_MS` is the 120,000 ms floor. The live suite runs no long
foreground command. That host behaviour has its own owner-run probe,
`node packages/orchestrator/scripts/gate-1-probe.mjs`, which runs a Banzai
implementation phase with an 11-minute foreground command and a resumed
invocation in a scratch repository; see
[the Gate 1 probe](work/wp08-stable-claude-phases/gate-1-probe.md). It is not
part of `compatibility:live` and makes no automatic model call.

Each invocation is limited to five minutes, the complete command to fifteen
minutes, and the total to two model calls. The only stdout is
`banzai-live-compatibility/v2` JSON with closed status/check/version/duration
fields. Raw prompts, reasoning, transcripts, tool/model/auth output, source,
paths, credentials, and private model output are never retained or emitted.
Exit 0 means pass, 1 fail, and 2 unavailable. Missing auth is unavailable before
any model call. The manual GitHub Actions job retains no artifact.

Implementing and unit-testing this boundary does not prove current live vendor
behavior. An authenticated run requires explicit human authorization and safe
protected runner provisioning.

## Cancellation observations

Interactive cancellation keeps the existing
`Cancel this run? The persisted run becomes terminal.` confirmation,
with refusal as the default. Once confirmed, the runner requests process stop
and persists cancellation before showing one optional reason selection. `Skip`
is first; no meaningful reason is preselected. Leaving the confirmation causes
no cancellation. Leaving the reason prompt exits the interaction with the run
already cancelled; an interrupted response is recorded best effort. A hard
crash can leave an unanswered observation. This prompt uses the base IO, so it
adds no human-time episode or estimate edit.

The CLI opens no reason prompt, including without a TTY:

```sh
banzai cancel --run run-000014 --reason plan_unsuitable
banzai cancel
banzai eval cancellations --from 2026-09-06T00:00:00Z
banzai eval cancellations --run run-000014 --json
banzai control capabilities --cancellation
```

The eight values are `intent_changed`, `adr_rejected`, `plan_unsuitable`,
`workflow_unsuitable`, `execution_blocked`, `superseded`, `other`, and
`unspecified`. `other` means a known reason outside the list; `unspecified`
means no reason was supplied. CLI omission and interactive Skip retain distinct
provenance. An explicit reason describes operator motivation, not a verified
root cause. ADR rejection alone returns to planning; a failure or a rejected
ADR never selects a reason automatically. `--run` binds the action to that
still-current run. Invalid arguments fail before mutation.

A repeated cancellation preserves the original event and reason. Completed
runs receive no cancellation observation. Only the original interactive call
can submit its first response after cancellation, using its process-local
receipt; there is no late-edit, backfill or historical reason command. Reporting
and repeated cancellation never repair missing evidence.

`Run cancelled. Cancellation observation was not saved.` means terminal state
was saved but analytics was not. A stop signal is a request, not confirmation
that the process exited. `Cancellation could not be confirmed` means terminal
persistence is unresolved. A hard crash may leave a short `.state-write.lock`;
it is never reclaimed automatically or during reporting. An offline maintenance
action with writers stopped is outside this feature.

`banzai eval cancellations` emits Markdown by default or JSON with `--json`.
Both render the same deterministic `banzai-cancellation-report/v1` document
(schema version 1). It uses run **creation** timestamps: `--from` inclusive,
`--to` exclusive, intersected with repeatable `--run` selectors. No selectors
means all local candidates. Explicitly missing IDs fail. Missing/malformed state
remains visible as unknown lifecycle or unresolved date membership. Known
cancelled runs remain in every reason denominator even without observations.
Every ratio includes numerator and denominator; zero denominator yields `null`
in JSON and `unavailable` in Markdown.

The report separates meaningful reported-reason coverage, response coverage
(including Skip, omission and unspecified), and observation availability.
Legacy bare cancellation events are `legacy_absent`; absent evidence is
`missing`; interrupted/unanswered, malformed, unsupported and conflicting
evidence remain separate. Historical runs receive no invented reasons. Workflow
and pre-cancellation phase/gate retain availability and provenance.

Technical rows use report-local references and existing bounded failure fields.
No raw logs, prompts, error prose, exact private IDs or source paths are exported.
Usage and duration are covered subtotals from canonical attempts ending before
cancellation; open/straddling attempts and inventory gaps prevent exact totals.
Elapsed time is UTC wall time with unverified continuity. The existing current
single-engineer active-time estimate is disclosed only if its `asOf` is on or
before cancellation; it remains estimated with unknown contributor/later-work
coverage. Superseded revisions are never resurrected. Neither elapsed spans nor
estimates are summed into person-time or task totals. Report-local keys do not
establish task identity; `superseded` records continuation intent and confirmed
continuation remains unavailable without a supported exact source.

Observation and optional discovery use `banzai-cancellation-observation/v1` and
`banzai-cancellation-capabilities/v1`, independently of frozen evaluation/KPI v1,
control 2.0.0 and state schema 3. The implementation candidate dated 2026-09-06
enables new collection. Actual study collection starts with the first real v1
observation after adoption; that start is not established by synthetic tests.
The extra optional cancellation interaction is an instrumentation change.
Coverage improvement is not evidence of improved agent performance, and a lower
cancellation fraction is not itself the objective. See
[feature specification](https://github.com/Parabolic-Technologies/banzai/blob/main/documentation/features/cancellation-observations/description.md).

## Commands

`banzai --help` shows a compact command overview. Use `banzai help <command>`
for full syntax and relevant options, for example `banzai help run`,
`banzai help approve`, or `banzai help control`. `banzai help progress` explains
progress flags and `BANZAI_PROGRESS`. Help works without a Git repository or
project configuration.

### Versions

```bash
banzai --version          # Running orchestrator version
banzai -v                # Same as --version
banzai --plugin-version   # Installed Banzai versions in Codex and Claude Code
banzai -pv               # Same as --plugin-version
```

These commands work outside a Git repository and require no project configuration.
The long options also accept an em dash (`—version`, `—plugin-version`). Pass
each version option alone. `--version` prints the package version on one line.
`--plugin-version` prints one labeled line per client, including disabled
installations and multiple distinct versions when present. It uses local client
inventories, preserving build metadata; marketplace source files do not determine
the installed version. Missing installations show `not installed`; failed or
unsupported discovery shows `unavailable`. If neither client reports a version,
the command exits nonzero. Plugin discovery requires the clients on `PATH` and
does not launch a model or install anything.

```text
banzai
banzai interactive
banzai doctor [--json]
banzai control capabilities [--cancellation]
banzai control status
banzai control start --slug <slug>
banzai control answer [--by <name>] [--no-resume]
banzai control recover [--by <name>] [--no-resume]
banzai model [--local]
banzai run --slug <slug> --request <text>
banzai status [--json]
banzai eval export [--json] [--from <RFC3339>] [--to <RFC3339>] [--run <run-id>]...
banzai eval kpi [--json] [--from <RFC3339>] [--to <RFC3339>] [--run <run-id>]...
banzai eval kpi --input <export.json> [--input <export.json>]... [--json]
banzai eval context [--json] [--from <RFC3339>] [--to <RFC3339>] [--run <run-id>]...
banzai eval cancellations [--json] [--from <RFC3339>] [--to <RFC3339>] [--run <run-id>]...
banzai compatibility live --confirm-live
banzai resume
banzai retry
banzai recover
banzai approve adr --id <id> --decision accept|reject|rework
banzai approve plan [--no-resume]
banzai approve plan --decision recheck [--by <name>]
banzai triage --accept R1-F1 --reject R1-F2 --defer ""
banzai cancel [--run <run-id>] [--reason <enum>]
```

Approval and triage commands resume automatically unless `--no-resume` is
present.

## Agent Control

The optional `orchestrate` plugin skill supervises this CLI through a narrow
versioned control boundary. It is an outer operator only, reachable solely
through an explicit user invocation. Claude Code enforces that boundary with
`disable-model-invocation: true`; Codex uses `agents/openai.yaml` with
`policy.allow_implicit_invocation: false`. The skill is never selected from
prompt wording, and the runner's planner, implementer, fixer, selector, and
reviewer phases never invoke it.

`banzai control capabilities` is valid outside a Git repository and performs no
repository discovery, adapter construction, vendor/authentication call, lock,
recovery, or write. It emits canonical `banzai-agent-capabilities/v9` JSON with
schema version 9, control contract `9.0.0`, the package-derived Banzai
release-train version, umbrella contract, the exact supported non-TTY operation
set, and an ordered `inputSchemas` list per operation. It also declares the
runner-owned completion publication protocol (`banzai-completion-protocol/v1`),
its durable stages, the closed refusal codes `COMPLETION_PUBLICATION_IO`,
`COMPLETION_PUBLICATION_DRIFT` and `COMPLETION_PUBLICATION_INTEGRITY`, and the
`pending_application` attempt status. Capability and doctor
output prove neither subscription authentication nor sandbox credential
visibility. Compatibility still follows these explicit contract and operation
identities, never the shared release-train value alone.

`banzai control status` emits canonical `banzai-agent-status/v7` JSON. With no
persisted run, `activeRun` is `null`. Otherwise the allow-list projection
contains run identity/lifecycle, route, semantic next action, retry and bounded
recovery eligibility, the pending human gate, approval validity,
task-completion evidence, the bounded completion publication state of the
active run (publishing attempt and kind, durable stage, closed refusal code and
publisher identity, or `null`), bounded verification outcomes, review verdict,
and review-pass or human-triage completion basis. A terminal `done` or `cancelled`
projection remains available for evidence but does not block an explicitly
requested new run; only a non-terminal projection does. The status excludes the
original request, prompts, transcripts, raw model output, environment values,
secrets, approval digests, raw commands, arguments/logs, absolute repository
paths, raw `.banzai` paths, and completed consultation history. Current consultation and configuration-prerequisite gates expose only the
bounded request fields needed for their next action. The configuration gate
includes structured command proposals and repair commands, but no raw config,
private hashes, continuation internals, or completed decision history.

Start, escalation answer, keyed consultation answer, and recovery accept one
closed JSON document of at most 64 KiB through direct process stdin. Request
and recovery stay on v1; the ordered v1 answer remains the legacy/current
escalation input, while consultation requires the keyed v2 answer:

```json
{
  "schema": "banzai-agent-request/v1",
  "schemaVersion": 1,
  "request": "complete task request"
}
```

```json
{
  "schema": "banzai-agent-answer/v1",
  "schemaVersion": 1,
  "answers": ["first ordered answer", "second ordered answer"]
}
```

```json
{
  "schema": "banzai-agent-answer/v2",
  "schemaVersion": 2,
  "runId": "run-from-current-status",
  "requestId": "request-from-current-status",
  "roundId": "round-from-current-status",
  "answers": [
    {
      "decisionId": "decision-from-current-status",
      "response": {
        "kind": "option",
        "optionId": "option-from-current-status",
        "text": null
      },
      "note": null
    }
  ]
}
```

Recovery is a separate current-human decision, not a retry or approval. After
showing the latest bounded workspace counts and exact identity, status either
warns about partial/duplicated side effects for an interruption or names the
resolved and remaining accepted findings plus a prerequisite count for a
completed blocked fix. In the latter case the supervisor presents those bounded
facts but does not execute raw prerequisite commands or widen permissions.
Send:

```json
{
  "schema": "banzai-agent-recovery/v1",
  "schemaVersion": 1,
  "attemptId": "implementation-1-abcd1234",
  "recoveryIdentity": "exact 64-character identity from current status",
  "unknownSideEffectsAccepted": true
}
```

Input is decoded completely before mutation. Invalid UTF-8/JSON, unknown or
missing properties, unsupported versions, blank text, stale run/request/round
identities, missing or duplicate decision IDs, unknown option IDs, oversized
documents, and wrong answer counts fail closed. A v1 answer cannot answer a
consultation. Request/answer whitespace, newlines, Unicode, quotes, backticks,
dollar syntax, and shell operators are preserved as data.
`WorkflowRunner` still owns one-active-run enforcement, state transitions,
decision persistence, resume, retry, recovery, and completion. Progress remains
on stderr; successful control output is one JSON document on stdout.

Existing approval, triage, resume, retry, cancel, human status, interactive,
and `status --json` commands retain their behavior. A supervisor refreshes
control status after those commands instead of parsing their human prose.

The [local model file](#local-model-file) leaves the control surface
unchanged: capabilities v9, status v7 and `status --json` carry no model
sources or drift. A supervisor learns of a changed local file only when the
command that status recommends refuses with `LOCAL_MODEL_OVERRIDE_CHANGED`.
That refusal writes nothing and keeps the recommendation, so the supervisor
relays the error's lines to the human instead of repeating the command or
editing `.banzai/config.local.json`. Before the run's first model attempt, an
agent's `banzai retry` of a blocked run, or `banzai resume` of a run still in
`created` or `selecting`, records the new local models and prints the change.
After it, an agent's retry refuses: it runs without a terminal, and only a
human `banzai retry` in a terminal records a changed local file for such a run.
`LOCAL_MODEL_OVERRIDE_RECORD_INVALID` means the run's own record cannot be
read; relay it too, because the remedy is `banzai cancel`.

## Runner instruction delivery

The runner embeds seven phase resources (`planning`, `implementation`, `review`,
`fix`, `feature`, `quick-fix`, `planning-review`), ten shared guidance resources and their ordered
six-policy unions from the plugin. Standalone skills load the shared guidance
relatively. Selection remains prompt-only. Every fresh or resumed call, retry
and authorized recovery receives the complete applicable payload, exact bound
artifact roles and existing write capabilities. Review and selection have no
model artifact writes; the runner alone renders review artifacts. Existing
implementation/fix grants, report triggers, completion evidence and human gates
remain unchanged. Required bytes count against existing context budgets.

Structural plugin verification still requires all eleven workflow skills and the two
hook events/script. Separately, preflight compares the applicable route union
and each call rechecks its actual phase against the supplied verified directory.
Matching raw identities are verified; a readable mismatch refuses the call with
`INSTRUCTION_RESOURCE_MISMATCH` before creating an attempt. Saved decisions,
checkpoints, prior failures and retry/recovery authority remain intact. Missing,
unreadable or unsafe resources are bounded failures; Codex, ambient mode and an
unresolved directory are unverifiable. Evidence limitations alone do not block,
and structural invalid-directory refusal takes precedence. These checks do not
prove full transitive plugin integrity, model compliance or resource immutability
during a running session.

The three remedies are to rebuild the orchestrator bundle from current source,
update the installed plugin to the matching release, or explicitly select
ambient mode (reported as unverifiable). Banzai performs none automatically.
After remediation, use the existing status-directed resume, retry or recovery
operation; do not resubmit a saved human decision.

Explicit `npm run build` refreshes committed `src/phase-resources.ts` and the
bundle/map. Typecheck, lint and tests never generate it. `build:check` compares
source/generated/bundle bytes without repair. Publication checks compare the
same candidate across actual indexed source/plugin archives, npm payload and
source map, rejecting staged/working instruction skew.

## Project Verification Readiness

For ready-to-adapt snippets and setup guidance, see
[Task verification](verification-examples.md) and
[Your first Banzai task](getting-started.md).

`banzai doctor` inspects the current Git checkout and writes a deterministic
human report to stdout. `banzai doctor --json` writes the authoritative
`banzai-doctor/v6` object instead. It exits 0 exactly when no check failed and
exits 1 when the checkout is not ready. Warnings, including a live or stale
valid runner lock, remain visible without changing readiness.

Doctor checks Git, structural project guidance, the supported Node/platform and contract versions, config
presence and structure, the local model file, the Claude invocation environment and its tool
permissions, the Claude plugin scope, detected project types, optional task policy,
required executable availability, the Claude reviewer's version, the active-run pointer and
referenced state, and the runner lock. The report's fixed check
order, sorted project types, two-space JSON, and final newline are stable for
automation. Expected readiness findings stay in the selected stdout report;
unexpected CLI failures go to stderr.

Doctor v6 uses `schemaVersion: 6`. Every check has ordered `id`, `category`,
`status`, `message`, `fixes`, and `roles` fields. Failed verification-category
checks and `executables.verification` include an exact `Fix:` next step and a
pointer to the verification guide; this does not expand remedies to unrelated
categories. The schema diagnostic reports the file's actual config version.

`claude.instructions` reports each role: Codex is informational `not_applicable`
with no remedies; pinned Claude can be `verified`, `mismatch`, or bounded
`failure`. A mismatch fails readiness. Ambient or unresolved scope is
`unverifiable` with an ambient remedy only. Rebuild/update remedies apply only
to mismatch or bounded failure. The default pinned Claude planner, implementer
and reviewer produce no parity warning when resources match. Historical
v1-v5 reports retain their identities; consumers must negotiate v6. v6 adds
`claude.plugin-scope` and keeps the v5 fields and status semantics.

`claude.version` follows `executables.models`. It applies to every role whose
effective executable is a Claude Code client, and it never runs the client:
for each distinct executable those roles name, it resolves the executable on
`PATH` once, follows its links, and reads the version from the native
installer's `versions/<version>` file name or from the first `package.json`
above an npm install, which must name `@anthropic-ai/claude-code` or its
platform package. It fails when any version is below 2.1.290, warns when no
layout yields a version, and passes otherwise; the worst result wins, and the
message names the roles behind each version. Roles whose executable is
unavailable are named as not checked. The check is skipped when no role runs
on Claude, when no named Claude executable is available, or for an unusable
configuration or local model file. It prints versions and role names only,
and its fix links
[Install and sign in to model clients](getting-started.md#install-and-sign-in-to-model-clients).

Doctor also emits an `authentication.models` advisory: it does not invoke a
vendor, so authentication readiness is not checked, it checks no vendor CLI
version except Claude Code's, which it reads offline, and executable
availability is not authentication proof. This warning leaves `ready` and exit
semantics unchanged. Startup and phase preflight remain authoritative.

`claude.plugin-scope` follows `claude.permissions` and is advisory. It reads
only Claude's user settings, `$CLAUDE_CONFIG_DIR/settings.json` or
`~/.claude/settings.json`, and never runs `claude plugin list`. It warns when
`enabledPlugins` sets a `banzai@<marketplace>` key to `true`, because user
scope loads Banzai's skill descriptions into every repository, and its fix
moves the install to
[local or project scope](getting-started.md#claude-code-plugin). It passes
when user settings do not enable Banzai, so a local or project install gives
no hint, and it is skipped when that file is unreadable or not a JSON object.
It never fails and never changes `ready`.

`config.local` follows `config.version` and checks the
[local model file](#local-model-file). It passes when
`.banzai/config.local.json` is absent, or when it is valid, ignored by Git and
not in the Git index. It fails, with a fixed message per cause and a fix that
links [Model Configuration](#model-configuration), when the file is in the Git
index, is not ignored, is unsafe (a symbolic link or a non-regular file, or a
symbolic link at `.banzai/`, which fails even when no local file exists), is
unreadable, is invalid, or sets a refused key, and when Git cannot answer the
query. A message names at most a field path from the local file's schema and
never repeats a key or value from the file. Only when the file exists does
doctor run `git ls-files --error-unmatch -- .banzai/config.local.json` and
`git check-ignore -q -- .banzai/config.local.json`, at the repository root
with `LC_ALL=C`; these two read-only queries are the only Git commands the
local file adds.

The top-level `models` array sits between `projectTypes` and `summary`. It
holds one entry per role, in planner, implementer, reviewer order, with exactly
`role`, `vendor` (`claude`, `codex`, or `null` for any other executable),
`model` (`null` unless the identifier matches the local file's model pattern),
`effort`, and `source` (`committed` or `local`). Executable paths, timeouts and
other configuration values stay undisclosed. The array is empty while
`config.local` fails or the committed configuration is missing or invalid. The
text report prints a `Models:` block between `Project types:` and `Checks:`,
one line per role such as
`  reviewer: claude claude-opus-5-5 effort=xhigh (local)`, with `other` for an
unknown vendor, `unlisted` for an undisclosed model, and `Models: unavailable`
for an empty array.

`claude.instructions`, `claude.permissions`, `executables.models`, and
`claude.version` evaluate the effective configuration, so a role that the
local file moves to Claude is checked as Claude.
While `config.local` fails they are `skipped`. `claude.environment` and the
verification checks read committed values, which the local file cannot change.

Project detection is root-only and uses these markers:

| Project type | Root marker                                         |
| ------------ | --------------------------------------------------- |
| `node`       | `package.json`                                      |
| `php`        | `composer.json`                                     |
| `python`     | `pyproject.toml`, `setup.py`, or `requirements.txt` |
| `go`         | `go.mod`                                            |
| `rust`       | `Cargo.toml`                                        |
| `ruby`       | `Gemfile`                                           |
| `jvm`        | `pom.xml`, `build.gradle`, or `build.gradle.kts`    |
| `dotnet`     | any root `.sln`, `.csproj`, or `.fsproj` file       |
| `custom`     | no recognized marker                                |

The `custom` fallback requires confirmed absence of every recognized marker.
If marker metadata or root enumeration fails because of permissions or I/O,
`project.types` fails, the human projection reports project types as
unavailable. Doctor never converts
unreadable evidence into a ready custom project.

Detected project types are information for selecting checks, not a required
profile inventory. Missing tests or tooling do not prevent starting a task.
New schema-4 configuration has no verification catalogue. Optional policy
can require checks, deny commands and constrain execution; an invalid explicit
policy fails with its concrete diagnostic.

`banzai init` creates `documentation/verification-examples.md` from its bundled
guide before prompts, including in non-TTY mode. Existing files are preserved.
After model selection it offers project guidance setup without a verification
wizard. No project verification command runs during initialization.

`banzai verify add/edit/remove/list/check` are explicit legacy profile utilities
for old config formats. They do not configure new-task checks. Existing runs
are not migration targets; start a new task. Retained historical evidence is
neither rewritten nor treated as current task authorization.

Model selection preserves this tracked representation byte-for-byte outside
the exact requested `model`, `executable`, and `effort` JSON value tokens,
including schema-version-1 formatting and unknown fields. The ignored
`.banzai/config.local.json` has no such guarantee: writers always emit its
fixed format.

Doctor is offline and structurally read-only. It runs before vendor adapters or
`WorkflowRunner`, never authenticates, invokes a model, executes verification,
recovers or resumes a run, acquires or removes a lock, calls a network service,
or writes configuration, state, approval markers, source, or report files.
Normal `run`, `resume`, and `retry` behavior remains compatible in this
iteration; readiness is advisory outside the doctor's exit status.

## Context Accounting and Budgets

Every model attempt has an adjacent `banzai-context-attempt/v2` ledger. The
runner checkpoints the exact rendered prompt and vendor-specific output-schema
UTF-8 byte counts immediately before each adapter call, divided into closed
semantic categories. Referenced authority is recorded separately as artifact
class counts; vendor-reported tokens/cost/turns and session inventory have
independent per-metric availability. New reviews have only the primary
invocation; deterministic rendering adds none. Historical primary and repair
invocations remain separately readable and are counted once each.

The persisted privacy allow-list contains only identities already owned by the
run, closed enums, timestamps, counts, budget outcomes, and the existing
inventory digest. Prompt/request/artifact text and paths, source, transcripts,
reasoning, model/tool output, tool names and arguments, commands, environment,
credentials, and error prose are excluded. A present malformed or
content-bearing ledger fails closed as `INVALID_CONTEXT_EVIDENCE`; an older
attempt with no ledger is incomplete coverage.

Configuration defaults to observation with no universal numerical limit:

```json
{
  "context": {
    "mode": "observe",
    "limits": []
  }
}
```

Optional limits select a metric and may select `phase`, `role`, or both.
Phase-plus-role outranks either single selector, which outranks the default;
the smaller maximum wins a specificity tie. `observe` never changes execution.
In `enforce`, only exact pre-call `runner_payload_bytes` can stop an invocation,
before the adapter starts, as `CONTEXT_BUDGET_EXCEEDED`. Required context is
never truncated or summarized, and vendor-token, cost, turn, and inventory
crossings remain post-call advisory observations.

The offline read-only report uses the export cohort grammar:

```text
banzai eval context
banzai eval context --json --from 2026-08-01T00:00:00Z --to 2026-09-01T00:00:00Z
banzai eval context --run 20260801-example --run 20260815-other
```

Its independent identity is `banzai-context-report/v2`. Coverage is shown
before values; runner bytes, vendor tokens/cost/turns, and inventory are never
folded together. JSON is canonical and Markdown derives from the same object.
The command constructs neither adapters nor `WorkflowRunner` and creates no
config, lock, run, active pointer, or report file. See the
[context governance guide](https://github.com/Parabolic-Technologies/banzai/blob/main/documentation/context/README.md) for the full
privacy allow-list, config examples, and the required 15–30 completed-run
baseline before optimization or enforcement.

## Evaluation Export

`banzai eval export` reads all directories under `.banzai/runs/` in the current
checkout and writes a compact Markdown report to stdout. It needs neither
`.banzai/config.json` nor a TTY or active run. Use `--json` for the authoritative
versioned dataset:

```text
banzai eval export --json
banzai eval export --from 2026-07-01T00:00:00Z --to 2026-08-01T00:00:00Z
banzai eval export --run 20260701-example --run 20260715-other
```

The JSON identity is `banzai-evaluation-export/v1` with `schemaVersion: 1`.
Every field is present, arrays and enum breakdowns have stable ordering, JSON
uses two-space indentation and one trailing newline, and repeated exports over
unchanged evidence and arguments are byte-for-byte deterministic. Markdown is
rendered only from that completed object; it is not a second data contract.

`--from` includes a run created exactly at the RFC3339 boundary; `--to`
excludes one created exactly at its boundary. Both require `Z` or an explicit
offset. Repeatable `--run` selectors are deduplicated, path-safe local inputs
and are never reproduced in output. Date and run selectors use intersection
semantics. Missing selected runs and invalid, duplicate, missing, positional,
or unknown options fail before stdout is written.

The default cohort retains done, blocked, cancelled, active, legacy,
incomplete, and malformed runs. Unreadable creation time remains an unresolved
cohort member under date filters. One damaged record produces bounded issue
codes and partial coverage rather than failing every healthy run. Root
`.banzai/runs/` discovery errors remain fatal; state, attempt, review, and event
read errors inside one run degrade only that run. Numeric
metrics use `value` only for exact totals; otherwise `observedSubtotal`,
`observedCount`, `unknownCount`, `invalidCount`, and `availability` explain the
coverage. Zero therefore differs from unknown. Vendor-reported cost is never
invented. Human minutes and true false-positive rate are unavailable under the
current persistence contract, and rejected findings are named only as rejected
triage.

The export path uses direct Node read operations only. It never initializes or
normalizes state through `RunStore`, writes a report file, acquires a lock,
reconciles an attempt, resumes a workflow, runs verification, creates vendor
adapters, invokes a model, or performs a network call. Warnings are emitted to
stderr after the complete report, keeping JSON stdout clean.

Privacy is a fixed v1 allow-list. Exact run IDs, attempt IDs, feature slugs,
requests, repository/artifact/source/result/log paths, prompts, reasoning,
transcripts, raw or structured model prose, findings prose, commands and their
output, source contents, credentials, environment values, session IDs, human
identities, notes, and block/error text are excluded. Runs and attempts receive
deterministic export-local ordinal keys instead. Active attempt identity is used
only for an exact internal leaf join and is never exported. Exact persisted timestamps and
model IDs remain useful cohort variables and may still be linkable; the opaque
keys are minimization labels, not anonymized durable identities.

### Evaluation source precedence

The JSON contract assigns each metric to exactly one persisted evidence owner:

| Evidence owner                                      | Authoritative evaluation fields                                                                                                                                                                                                                                    |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Raw `state.json`                                    | State/contract schema provenance, status, route, run timestamps, cumulative verification count, cumulative triage, and fix cycles.                                                                                                                                 |
| Unique supported `attempts/*.json` records          | Schema version 1 owns model-attempt count/outcome, phase duration, session and review mode, rotation evidence, normalized model profile, tokens, and reported cost. Missing schema is legacy-absent; unsupported or malformed schema contributes invalid coverage. |
| Retained `state.verification` entries               | Available command outcomes and derivable verification duration; the state counter represents cumulative command attempts.                                                                                                                                          |
| Review files proven applied by `state.latestReview` | Review verdicts and findings by severity. Files beyond the applied iteration are bounded incomplete evidence and contribute no yield.                                                                                                                              |
| Recognized `events.jsonl` event types               | Explicit attempt/start/review retries and bounded start/review failure categories.                                                                                                                                                                                 |

Overlapping state usage, session, review, and finding metrics are consistency
checks only. They create safe mismatch issues but are not summed with their
owning leaf evidence. Raw logs, command output, and source content are never
read.

## Evaluation KPIs

`banzai eval kpi` derives outcome KPIs from evaluation-export data under the
independent contract `banzai-evaluation-kpi/v1` (`schemaVersion: 1`). Without
`--input` it computes the export for the current checkout in memory under the
same cohort options, rules, and error codes as `eval export` — nothing new is
read from `.banzai/runs/` and no export file is written — and renders one
source labeled `current`:

```text
banzai eval kpi
banzai eval kpi --json --from 2026-07-01T00:00:00Z --to 2026-08-01T00:00:00Z
```

With repeatable `--input` it instead derives one source per previously
exported JSON file, labeled `<ordinal>: <basename>` in argument order, and
renders one comparison table per KPI whose columns are the sources. `--input`
cannot be combined with `--from`, `--to`, or `--run`, needs no Git checkout,
and reads only the named files:

```text
banzai eval kpi --input a.json --input b.json
```

Each input is validated before use: a file that is unreadable, not JSON, not
schema `banzai-evaluation-export/v1`, not `schemaVersion` 1, or structurally
missing the fields the derivation reads fails closed with the stable code
`INVALID_EVAL_INPUT`, names the file on stderr, and writes nothing to stdout.

The KPI set — completion rate, first-review pass rate and mean findings,
first-review acceptance rate, reviewer precision with separately reported
deferred triage, zero-accepted review rate, fix cycles per
completed run, attempt retry ratios by kind, and per-completed-run usage with
independent token and cost coverage — plus the fail-closed
planner/implementer/reviewer configuration-signature grouping is documented
with exact derivations in
[`documentation/evaluation/README.md`](https://github.com/Parabolic-Technologies/banzai/blob/main/documentation/evaluation/README.md).
Every KPI value carries its numerator, denominator, value (`null` on a zero
denominator), and exact-versus-incomplete run coverage; only exact-evidence
runs contribute. KPIs derive from per-run evidence only, never from export
`aggregates`, and identical inputs produce byte-identical Markdown and JSON.

## Interactive Mode

Run the short command from an initialized project:

```text
cd /path/to/project
banzai
```

With terminal input and output attached, the runner opens a minimal
state-driven interface. When no run exists, it collects the task request,
derives a deterministic kebab-case slug, and prints it with the local date
prefix as `Generated slug: <yymmdd>-<slug>`. One prompt,
`Press Enter or y to accept it, or type your own slug:`, then accepts that slug
or takes the engineer's own. A typed slug receives today's `yymmdd-` prefix
unless it already starts with it, and the prompt stays open with a message
while the result is not lowercase kebab-case, exceeds 100 characters, or names
an existing `documentation/work/` or `documentation/initiatives/` directory.
When that existence check is refused, for example because a documentation
directory is a symlink, the prompt shows `Could not check <slug>: <reason>`.
The session then prints `Slug: <final>` and `Request: <request>` before the
start confirmation, and the run starts with that slug unchanged
([ADR-0066](decisions/0066-date-prefixed-work-and-initiative-slugs.md)).
The planner then selects and displays `quick-fix`, `feature`, or `strict` with
its reason and phase responsibilities.

The request prompt enables terminal bracketed-paste mode. A multiline paste is
captured through its closing marker and rendered as
`[Pasted text #1 +N lines]`, so Markdown newlines do not submit the prompt.
Typed text and multiple pasted blocks retain their order, while Enter submits
the complete expanded request rather than placeholder text. Pasting the same
block again shows a terminal-safe preview without duplicating it; Backspace at
the placeholder boundary removes the complete block. The prompt disables
bracketed-paste mode on success, cancellation, and errors, while a recoverable
validation failure keeps the same prompt active. Single-line input and every
other interactive prompt retain their existing behavior.

The interface otherwise offers only actions valid for the current persisted
state:

- sequential decision cards for a material unresolved strict-planning choice;
- arrow-key ADR accept, reject, or rework;
- exact plan-bundle approval;
- accept, reject, or defer for every review finding;
- eligible retry, including explicit plan-task completion-evidence repair;
- resume, confirmed cancellation, or exit.

These are the workflow's five existing decision gates: conditional planning-only decision
consultation, ADR acceptance, plan approval, review triage, and escalation. The
interface presents their answers. The runner adds a conditional configuration
prerequisite after a completed implementation/fix checkpoint; other phase
boundaries do not ask for confirmation.

When a model requests a recognized human gate, the model process returns
control to the orchestrator but the interactive session does not exit. Banzai
immediately displays the exact current decision needed to continue.

For `decision_consultation`, the interface presents one to three cards in order:
`Decision`, `Why this matters`, `Repository evidence`, `Options`, and
`Recommendation` when present. The engineer may use the recommendation, choose
another listed option, provide an exact free preference, inspect details, or
pause without mutating the run. Answers are keyed to the current run, request,
round, and decision identities. They record provenance only and never accept an
ADR, approve a plan, authorize implementation, triage, recovery, release, or an
external side effect. Planning analyzes the answers again before it may produce
a dependent ADR or plan; those artifacts retain their separate later gates.

For an escalation raised during planning, implementation, or fixing, the
interface displays the model's questions and collects a non-empty answer for
each one. A lite route invalidates its workflow authorization and selects again
with the recorded answers. A strict route invalidates previous plan approval,
returns to planning, and requires approval of the revised artifact bundle
before code execution resumes.

The interface shows artifact paths, the checks a plan binds, findings, blocked
reasons, and retry eligibility before asking for decisions. `Ctrl+C` while a prompt is open exits
the interface without changing the run. `banzai interactive` is an explicit
alias.

### macOS Dock Attention

After an automatic operation takes at least 30 seconds, Banzai requests one
Dock bounce when the result needs plan or ADR approval, human input (including
consultation), review triage, or action on a blocked run. This applies to
interactive mode and the human `run`, `resume`, `retry`, `recover`, `approve`,
and `triage` commands. Time spent reading or answering prompts does not count.
Opening an existing pending decision, revisiting menus, and completed or
cancelled runs do not trigger attention; each new automatic operation has its
own threshold.

- **Terminal.app:** select the active profile under **Settings → Profiles →
  Advanced → Bell**, then enable **Bounce the app icon when in the background**.
  Banzai sends BEL; the profile controls sound, badge, and whether bouncing
  continues until the application returns to the foreground. Disable
  **Audible bell** if you want a visual signal only.
- **iTerm2:** Banzai sends `OSC 1337;RequestAttention=once` to request a single
  bounce. The terminal handles attention without Banzai changing window focus.

Disable this feature for a command or shell session with
`BANZAI_ATTENTION=off`. It requires macOS and TTY stdin, stdout, and stderr.
Control commands, JSON output, CI, `TERM=dumb`, unsupported terminals, and
tmux/screen sessions stay quiet. Notification failures never change the run
result. The actual animation depends on the terminal and macOS settings.

Protocol references: [Apple Terminal profiles](https://support.apple.com/guide/terminal/change-profiles-advanced-settings-trmladvn/mac)
and [iTerm2 attention requests](https://iterm2.com/documentation-escape-codes.html).

## Review Artifact

Every successful review iteration publishes exactly one durable canonical
Markdown artifact:

```text
<bound reviewDirectory>/review-<iteration>.md
```

New binding v3 uses `documentation/work/<slug>/` as `reviewDirectory`.
Historical documents retain their known paths; read-only decoding grants no
historical execution or migration authority.

Each physical attempt owns
`.banzai/runs/<run-id>/attempts/<attempt-id>.review-candidate.md` and a private,
immutable `.review-snapshot.json` sidecar. Codex and Claude are read-only and
return `review-result/v2`; the runner owns rendering, validation and publication.
Claude exposes Read, Glob and Grep, with `Skill`, Write and other mutation
tools explicitly denied (ADR-0059). Review, routine re-review and planning
review run without auto memory and without the refusal fallback, through
`CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` and
`CLAUDE_CODE_DISABLE_REFUSAL_FALLBACK=1`, which Banzai sets after building the
subscription environment in both `claudeEnvironment` modes, so an inherited
value never survives; like every headless Claude invocation, they also carry
the run-stability environment and the stdin prompt of
[Headless Invocations](#headless-invocations). A request the client flags therefore fails the review
instead of continuing on another model: the attempt is recorded with its
message and stays retryable, and no review result is fabricated. Since Claude
Code 2.1.312 the variable also stops the model switch for a model name the
client does not recognize, so such a reviewer fails a flagged request too.
Planning analysis keeps `Skill`; planning, implementation, fixes, workflow
selection and planning analysis keep the refusal fallback and run without auto
memory in `scoped` mode only. Codex review is unchanged. A Claude reviewer
session recorded before this isolation rotates once to a fresh full review.
Stale inherited review/workflow authorization is removed.

The reviewer acknowledges the exact approved artifact paths and snapshot digest
with scope acknowledgment version 1. Full reviews cover the complete approved
change surface; delta reviews require compatible full-review lineage and a new
explicit assertion for every approved artifact against the current changed
surface and accepted findings. Any required `not_reviewed` entry requires a
reason and `blocked`; it cannot pass. The assertion is not independent proof
that a file was read or substantively assessed. Layout and authority blockers
can produce a truthful blocked artifact with zero findings or coverage.

The self-contained `banzai-feature-review/v3` document for bound runs (v2 for historical snapshots) distinguishes required
scope from acknowledged coverage. Fenced JSON values retain every semantic
string, including multiline summary, evidence details, reproduction, fix
acceptance, reviewed finding IDs, `reviewNotes` and opaque deferred content.
Verification and completion are projected from the original snapshot; later
checks cannot enter an earlier review. Equal inputs produce equal bytes.

After retaining structured output and diagnostics, the runner validates scope,
renders the candidate, validates bytes and current authority/workspace, and
atomically publishes validated proof bytes. Failures retain attempt evidence
and leave earlier canonical reviews intact. No model call repairs formatting
or JSON/Markdown parity. Human triage still owns finding dispositions; only
accepted IDs authorize fixing.

Historical v1 records, Markdown prose, repair usage and terminal checkpoints
keep their original meanings and validation. They are never given synthetic
scope acknowledgment. New attempts enforce v2; absent/v1 reviewer session
identities rotate fresh/full with `output-contract-not-reusable`. Frozen
evaluation v1 treats that unsupported present rotation cause as invalid
evidence, leaving affected rotation statistics incomplete without changing its
enum or KPI semantics.

Recovery uses the original snapshot and matching immutable terminal proof. An
absent candidate can be rendered without a model call; conflicting or explicitly
failed evidence cannot be promoted. Interrupted publication/application reconciles
canonical JSON, event, counters and state once. Missing proof requires the
existing explicit retry flow. Standalone `$banzai:feature-review` remains usable
without the runner and writes its own next `review-N.md` in v1 format.

## Choosing Models

`banzai model` walks planning, implementation, and review, asking for a model and
then an effort level for each. The planning model also performs read-only
workflow selection:

```text
Planning: claude claude-opus-5-5 effort=xhigh
? Planning model
    Keep claude-opus-5-5 (effort=xhigh)
    Claude Opus 5.5 (claude-opus-5-5)      Long-running agentic coding and knowledge work.
    Claude Fable 5.2 (claude-fable-5-2)    Most capable model for demanding long-horizon agentic work.
    Claude Sonnet 5.5 (claude-sonnet-5-5)  Best combination of speed and intelligence.
    Claude Haiku 5.5 (claude-haiku-5-5)    Fastest model for high-volume, latency-sensitive tasks.
    Claude Opus 5 (claude-opus-5)          Previous-generation Opus for complex agentic coding.
    Claude Fable 5.1 (claude-fable-5-1)    Previous-generation Fable for demanding agentic work.
    Claude Sonnet 5 (claude-sonnet-5)      Previous-generation Sonnet with near-Opus coding quality.
    Claude Opus 4.8 (claude-opus-4-8)      Older-generation Opus for complex agentic work.
    Claude Sonnet 4.6 (claude-sonnet-4-6)  Older-generation Sonnet balancing intelligence and speed.
  > GPT-6.1-Sol (gpt-6.1-sol)              Latest workhorse model for coding and everyday work.
    GPT-6-Astra (gpt-6-astra)              Most capable model for complex, demanding work.
    GPT-6.1-Terra (gpt-6.1-terra)          Fast, efficient model for clear writing and computer use.
    GPT-6-Sol (gpt-6-sol)                  Previous-generation workhorse model.
    GPT-6-Luna (gpt-6-luna)                Fast and affordable model for easier tasks.
    GPT-5.6-Sol (gpt-5.6-sol)              Older-generation workhorse model.
    GPT-5.6-Terra (gpt-5.6-terra)          Older balanced model for straightforward work.
    GPT-5.6-Luna (gpt-5.6-luna)            Older fast and efficient model.
```

Every phase runs on either vendor, so each menu lists both Claude and GPT models.
GPT-6.1-Sol, GPT-6-Astra, GPT-6.1-Terra, and GPT-6-Sol support `low`, `medium`,
`high`, `xhigh`, `max`, and `ultra` effort.
The adapter picks its argument shape from the configured executable: `codex exec`
with a schema file and a sandbox, or `claude -p` with an inline schema and a tool
allow-list. A phase that writes gets edit and shell tools or `workspace-write`;
review gets a read-only tool set or `--sandbox read-only`, whichever vendor runs
it. An executable belonging to neither vendor fails with `UNSUPPORTED_VENDOR`
before a process starts.

For implementation, the first choice recommends matching the effective planning
selection exactly, including executable, model, and effort. A planning change
made earlier in the same dialog is used immediately:

```text
Implementation: claude claude-opus-5-5 effort=xhigh
Planning selection: claude claude-fable-5-2 effort=max
? Implementation model
  > Match Planning: Claude Fable 5.2 (claude-fable-5-2), effort=max - recommended
```

An existing exact match is marked on **Keep** instead. Exact matching makes a
strict Planning -> Implementation builder session eligible for reuse when a
valid saved planning session exists; it does not guarantee a resume. Choosing a
different executable, model, or effort remains allowed, and the summary says
that implementation will start fresh from approved artifacts. Lite routes do
not inherit the planner session, and the reviewer remains independent.

The picker offers the current generation plus deliberate earlier-generation
choices: Claude Opus 5, Claude Fable 5.1, Claude Sonnet 5, Claude Opus 4.8,
Claude Sonnet 4.6, GPT-6-Sol, and the GPT-5.6 family. Other supported identifiers
still load from a hand-edited config but are not presented as choices. Claude
Fable 5 is no longer offered, and a configuration that still names it receives
an update offer for Claude Fable 5.2. GPT-5.5 is no longer offered: it retired
from Codex on 2026-10-14, and a configuration that still names it receives an
update offer for GPT-6.1-Sol.

The effort menu is filtered to the levels the chosen model accepts. For
implementation, the planning effort is recommended when the executable and
model match; otherwise the picker preselects the phase's current level when the
model supports it, or `xhigh`, or the model's highest level when it has no
`xhigh`. Codex's `ultra` tier appears for GPT-6.1-Sol, GPT-6-Astra,
GPT-6.1-Terra, GPT-6-Sol, GPT-5.6-Sol, and GPT-5.6-Terra, which support it, and
not for GPT-6-Luna, GPT-5.6-Luna, or any Claude model, which do not. Claude
Sonnet 4.6 predates `xhigh` and offers `low`, `medium`, `high`, and `max`.

Nothing is written until the dialog shows a before-and-after summary and the
change is confirmed. Only `executable`, `model`, and `effort` are rewritten;
timeouts, verification commands, and unrecognized fields are left alone.

Mixing vendors is supported in any combination: GPT planning with a Claude
reviewer, Claude implementation with a GPT reviewer, or one vendor throughout.
Reviewer independence comes from a fresh session with no builder transcript,
no shared memory and a fixed read-only tool set; a reviewer from another
vendor is an option, not a requirement. Compatible planning, implementation,
and fixes share a builder lineage; the primary reviewer starts fresh with no
builder transcript. Routine re-review may resume only that independent
source-read-only reviewer.

`banzai init` runs the same dialog once the configuration exists, so a new project
picks its models immediately. When `init` creates the configuration, the preset
choice reads `Use default: <model> (effort=<level>)`, with matching default labels
and help text. Repeated `init` and `banzai model` use `Keep` for the saved settings,
including saved settings that still match the defaults. `init` always saves to
`.banzai/config.json` and never asks where to save; when a local model file
exists, its summary names each phase for which this machine keeps the local
setting.
Outside a terminal, `init` prints a pointer to
`banzai model` instead, and `banzai model` itself exits with `TTY_REQUIRED`.
`banzai model` accepts no argument, `--local`, or `--help` by itself; anything
else fails with `INVALID_MODEL_OPTION` before the terminal check.

### Saving models for this machine

`banzai model --local` saves the choices for this machine only, in the
Git-ignored [local model file](#local-model-file). Without `--local`, the
picker asks where to save before the phase menus when `.banzai/config.json` is
in the Git index or a local file exists:

```text
? Where should these model choices be saved?
  > This machine only (.banzai/config.local.json, ignored by Git)
    Shared with the team (.banzai/config.json; commit it)
```

Otherwise it saves to `.banzai/config.json`, as before.

For this machine, each phase menu starts from the phase's current setting and
tags it `(committed)` or `(local)`. Only a setting that differs from the shared
one is written, so a shared setting is never copied into the local file. A
phase with a local entry also offers `Use shared setting: <setting>`, which
removes the entry, as does choosing the shared setting itself; when no entry
is left, the file is deleted. **Match Planning** is offered only when the
current planning executable is `claude` or `codex`.

For the team, the menus start from `.banzai/config.json`, and **Match Planning**
copies the shared planning setting, so a local setting never reaches the shared
file. While a local file sets any phase, each menu tags the shared setting
`(committed)`, a phase the local file overrides adds
`This machine uses <setting> (local).`, and the summary says that this machine
keeps using its local setting. The builder-session line describes the settings
this machine will actually run.

The confirmation and result name the file. `Review and commit the change`
appears only when `.banzai/config.json` changed; a local write says that Git
ignores the file. Before taking the runner lock, every picker run, including
`init`'s, makes sure Git ignores the local file. A path in the Git index is
refused, even when no local file exists. A path that Git does not ignore is
added to this clone's exclude file, never to `.gitignore`.

The picker then takes the runner lock without reclaiming a stale one, so it
refuses while another Banzai command holds `.banzai/runner.lock`. It also
refuses with `RUN_IN_PROGRESS` while a run is neither done nor cancelled, for
the same reason the startup currency check defers: a mid-run change would swap
the model executing the rest of an approved plan. Finish the run, or run
`banzai cancel`, first. One exception lets a blocked run continue with other
models: while `banzai status` recommends `banzai retry` for it, `banzai model`
saves to this machine without asking, never writes `.banzai/config.json`, and
ends with `Run banzai retry to continue this run with the new models.` The
retry records the new local models for the run, as
[Failure Recovery](#local-model-changes) describes. Inside a model phase,
where `BANZAI_*` authorization is present, `banzai model` and `init` refuse
with `CONFIGURATION_MODEL_WRITE_DENIED`. A tracked, unignored or invalid local
file stops the picker before any menu, and nothing is written.

The Claude entries come from the published Claude model catalog; the GPT entries
and their reasoning levels come from the Codex CLI's model metadata and official
model documentation. Both are source facts maintained in
[`src/models.ts`](../packages/orchestrator/src/models.ts) — see the note on catalog maintenance below.

## Model Configuration

`.banzai/config.json` holds each phase's executable, model, effort, and timeout
for everyone who uses the repository. A developer can replace a phase's
executable, model, and effort on one machine with the Git-ignored
`.banzai/config.local.json`; see [Local model file](#local-model-file) below.
Every model value Banzai prints from either file is escaped for the terminal.

Interactive startup names the Banzai release-train version and the checkout,
then prints one row per phase — vendor, model, effort, timeout — and checks
subscription authentication for every vendor the configuration actually uses:

```text
▄▟    banzai v1.19.1   spec-driven run orchestrator
  ▛▀  my-project · main · @ 90d9fb2 · 3 carried-in changes

    plan    claude claude-opus-5-5  xhigh · 30m  ✓
    impl    claude claude-opus-5-5  xhigh · 60m  ✓
    review  claude claude-opus-5-5  xhigh · 30m  ✓

No configured model needs a known update.
```

A phase whose setting comes from `.banzai/config.local.json` carries `(local)`
after its timeout; with every phase from `.banzai/config.json` the rows are
unchanged:

```text
    plan    claude claude-opus-5-5  xhigh · 30m          ✓
    impl    claude claude-opus-5-5  xhigh · 60m          ✓
    review  claude claude-opus-5-5  xhigh · 30m (local)  ✓
```

While a run is neither done nor cancelled, the rows and the authentication
markers show the run's models: the current `.banzai/config.json` with the local
models the run recorded. When the local file no longer matches that record, the
header adds the drift lines described under
[Failure Recovery](#local-model-changes). For a run whose model record cannot
be read, the header shows no rows and says to cancel the run. A local file in
the Git index, not ignored by Git, or invalid ends the launch with its
`LOCAL_CONFIG_*` code before the authentication check, so no vendor executable
starts.

The check is driven by the `executable` each role configures, not by the role, so
Claude is checked whenever any of planning, implementation, or review runs it —
and each vendor is checked once even when several roles share it. Checks run
concurrently and add roughly a second to startup.

A ready launch spends no lines on authentication. An unavailable vendor marks
every phase row it blocks and is named once, with the reason and the phases it
would have run. With Claude building and Codex reviewing:

```text
    plan    claude claude-opus-5-5  xhigh · 30m  ✗
    impl    claude claude-opus-5-5  xhigh · 60m  ✗
    review  codex  gpt-6.1-sol      xhigh · 30m  ✓

│ claude (Planning, Implementation): Claude subscription authentication is
│ unavailable. Run `claude auth login`; API-key and third-party provider
│ authentication are not accepted.
│ Every phase re-checks this; resolve it before starting a run.
```

When Claude reports `loggedIn: false` and Banzai itself has inherited a Codex
sandbox, preflight classifies it as `CLAUDE_AUTH_UNAVAILABLE_IN_SANDBOX` and
interactive startup shows sandbox-specific guidance instead of asking for
another login. Authentication visibility is unproven: on macOS the sandbox can
hide a Claude Code entry in Keychain from every child process, but the result
does not prove an entry exists. An absolute executable path, shell wrapper, or
pseudo-terminal cannot repair access. Run `banzai` in a regular terminal to
check or restore login. For unattended execution, run `claude setup-token`
outside the sandbox and supply that subscription token through
`CLAUDE_CODE_OAUTH_TOKEN`; Banzai preserves this variable while still removing
API-key and third-party-provider overrides. Neither route lets Banzai escape a
parent network or filesystem sandbox.

Codex has a separate host-readiness requirement: its effective `CODEX_HOME`
must be writable so the CLI can maintain SQLite-backed runtime state, session
state, and its app-server client. Banzai checks directory write access without
creating a probe file and before spawning `codex --version`, `codex login
status`, or a model attempt. An enclosing Codex sandbox that makes the directory
read-only produces `CODEX_STATE_UNAVAILABLE_IN_SANDBOX`; another permissions
failure produces `CODEX_STATE_NOT_WRITABLE`. Neither is evidence of SQLite
corruption, lock contention, or lost authentication. Run the eligible Banzai
action from a regular terminal or, for agent supervision, grant normal host
approval for that action to execute outside the parent sandbox. Do not change
the model-facing `--sandbox` setting: it cannot widen the host permissions the
Banzai process inherited.

The report is informational — it does not stop the session, and every phase still
re-checks its own vendor and fails closed. Its purpose is to surface an expired
session at launch rather than after planning and implementation have already run.

It shares one limit with the phase checks, because it runs the same command:
`claude auth status` reports whether credentials are stored, not whether they can
still be refreshed. A session that is present but no longer refreshable reports
`ready` here and fails when a phase calls the model. There is no expiry field to
read, so detecting that would require a real model call at every launch.

It then checks each configured model against a catalog of known model
identifiers. When a newer or supported model replaces one, Banzai names the
replacement and offers to write it to the file that supplies that phase —
`.banzai/config.json`, or `.banzai/config.local.json` for a local phase:

```text
Newer models are available:
  Review: claude-opus-4-7 is superseded by claude-opus-5-5.
```

The dialog offers updating every reported model, choosing them one at a time, or
keeping the configuration. Its options and confirmation name every file that
will change. Nothing is written without an explicit confirmation.
The rewrite replaces only the `model` fields it was asked to change; executables,
efforts, timeouts, verification commands, and unrecognized fields are preserved
byte-for-byte, and a configuration the runner would refuse to load is never
written. A change to `.banzai/config.json` is tracked — review and commit it. A
local phase's update rewrites `.banzai/config.local.json` in its fixed format,
changing only that phase's `model`; Git ignores it. If a phase's model or the
file that supplies it changed after the launch showed it, the update refuses
with `MODEL_CONFIGURATION_CHANGED` and nothing is written.

Three cases produce no offer:

- an unrecognized model identifier, so a model newer than this catalog is never
  reported as stale;
- a supported earlier-generation choice from `banzai model`;
- a Claude Code tier alias such as `opus` or `sonnet`, which already resolves to
  the current model of its tier;
- an active run. Banzai reports the models and the available updates, then defers
  the change until the run is done or cancelled, so a run's phases cannot switch
  models midway.

The catalog is a source fact maintained by hand and shipped with a release. The
runner authenticates through individual subscriptions and never calls a vendor
API, so currency is not discovered at run time. Codex identifiers are tracked
only as far as this repository can state them, which is why an unlisted Codex
model raises nothing. Update the catalog in
[`src/models.ts`](../packages/orchestrator/src/models.ts) when a model ships, is deprecated, or is
retired.

`banzai init` and non-interactive commands do not run this check.

The catalog records the first CLI release that serves each of these models. A
model minimum at or below the vendor minimum in [Boundaries](#boundaries)
stays recorded and never decides; of the Claude entries, only
`claude-fable-5-2` and `claude-haiku-5-5` need a release newer than Claude Code
2.1.290:

| Model                     | Minimum CLI         |
| ------------------------- | ------------------- |
| `claude-fable-5-2`        | Claude Code 2.1.321 |
| `claude-haiku-5-5`        | Claude Code 2.1.293 |
| `claude-opus-5-5`         | Claude Code 2.1.280 |
| `claude-sonnet-5-5`       | Claude Code 2.1.284 |
| `claude-fable-5-1`        | Claude Code 2.1.257 |
| `gpt-6.1-terra`           | Codex CLI 0.165.0   |
| `gpt-6.1-sol`             | Codex CLI 0.159.1   |
| `gpt-6-sol`, `gpt-6-luna` | Codex CLI 0.156.1   |
| `gpt-6-astra`             | Codex CLI 0.153.1   |

The vendor preflight of a role that runs one of these models fails with
`CLI_TOO_OLD` before authentication is checked or the model is called, naming
the model and the release it needs: update the CLI, or choose another model with
`banzai model`. The launch header and run start check each executable once,
against the model of the first role that uses it; every phase checks its own
model again before its call. Tier aliases, models without an entry, and
unrecognized identifiers need only the vendor minimum. `banzai setup` launches
its client without a model, so it needs only the vendor minimum.

Every Claude role needs Claude Code 2.1.290 or newer (ADR-0063). Earlier
releases can report a delivered `--json-schema` result as an error, and
2.1.290 is also the first release that honours both review isolation
variables. The launch header, run start, `banzai setup`, every phase,
planning-review and review preflight, and the live harness refuse an older
client with `CLI_TOO_OLD`, naming the installed version, the minimum and the
reason. `banzai doctor` reads the version of each Claude executable that a
role uses offline in `claude.version` and checks no other CLI version.

Claude entries come from Claude Code's model configuration documentation, which
states that an older client refuses the model before sending a request. Codex
entries are the first stable release whose bundled model catalog carries the
model, from the Codex CLI release notes. Record a new entry with the catalog
change that adds the model.

Bare `banzai` in a non-TTY environment prints help instead of waiting for
input. Existing subcommands remain the authoritative non-interactive interface
for scripts, CI, direct recovery, and explicit slug overrides:

```text
banzai run --slug my-explicit-slug --request "Implement the task"
```

`banzai run --slug` and `banzai control start --slug` apply the same local date
prefix when the command starts: on 2026-11-10 the example above starts run slug
`261110-my-explicit-slug` in `documentation/work/261110-my-explicit-slug/`.
Status reports the prefixed slug. A start refuses, creating nothing, when that
directory or `documentation/initiatives/261110-my-explicit-slug/` exists.

### Local model file

`.banzai/config.local.json` is optional and belongs to one checkout. Write it
with `banzai model --local`, or by hand:

```json
{
  "schemaVersion": 1,
  "models": {
    "reviewer": {
      "executable": "claude",
      "model": "claude-opus-5-5",
      "effort": "xhigh"
    }
  }
}
```

- The top-level keys are exactly `schemaVersion`, the integer `1`, and
  `models`, which holds zero to three of `planner`, `implementer`, and
  `reviewer`.
- Each entry has exactly `executable`, `model`, and `effort`, and replaces the
  committed executable, model, and effort of that phase as one unit.
  `executable` is the bare name `claude` or `codex`, which your `PATH`
  resolves; a path, another name, or another case is refused. `model` matches
  `^[A-Za-z0-9][A-Za-z0-9._:/@\[\]-]{0,127}$`. `effort` takes the committed
  values: `low`, `medium`, `high`, `xhigh`, `max`, or `ultra`.
- The file is UTF-8 JSON of at most 64 KiB. It must be a regular file, and
  neither it nor `.banzai/` may be a symbolic link. Only a missing file means
  no override.

Everything else stays committed: timeouts, verification, context limits, the
Claude environment, and every other key. Any other top-level key, an unknown
phase, `timeoutMs`, or another field in an entry fails with
`LOCAL_CONFIG_KEY_REFUSED`; every other defect fails with
`LOCAL_CONFIG_INVALID`. Both messages name the field path, never a value from
the file, and end with "Correct .banzai/config.local.json, or delete it to use
the shared models in .banzai/config.json."

Outside a run, every command uses the effective configuration: the committed
file with each local entry in its phase's place. A run records the local
models it starts with and keeps using them, merged with the current committed
file, until it is done or cancelled. A later edit of the local file is refused
rather than adopted; see [Failure Recovery](#local-model-changes). Committed
model edits keep their current effect on a run, including a fresh session for
a changed setting. Doctor, `banzai status`, the picker, and the launch header
name each phase's source, `committed` or `local`. Overriding only planning or
only implementation makes the two differ, so implementation starts fresh
instead of reusing the planning session; the picker's builder-session line
shows this.

The file must stay out of Git. `banzai init` adds the exact line
`.banzai/config.local.json` to `.gitignore` when it is missing; commit that
change. In a repository initialized earlier, `banzai model` adds the line to
this clone's exclude file instead: the file that
`git rev-parse --git-path info/exclude` names, which every worktree of the
clone shares and Git never tracks. Banzai never edits `.gitignore` for the
local file outside `init`.

Every command that reads the current local file, except `banzai status` and
doctor, refuses with `LOCAL_CONFIG_NOT_IGNORED` before any vendor executable
starts when the file:

- is in the Git index: run `git rm --cached .banzai/config.local.json`, review
  the local copy, and commit the removal;
- is not ignored by Git: run `banzai model --local`, which ignores it for this
  clone, or add the line `.banzai/config.local.json` to `.gitignore` and commit
  it. When a `.gitignore` negation (a line starting with `!`) includes the file
  again after the exclude entry is added, remove that rule and commit the
  change.

`banzai status` reports these conditions without failing, and doctor fails
`config.local`.

`banzai model` and the launch update offer write the local file. They take the
runner lock, confirm that the path is ignored and not in the Git index, never
write through a symbolic link, and replace the file through a temporary file in
`.banzai/` with mode `0600`. They always write the same format: two-space JSON
with a final newline, keys in the order shown above, and phases in planner,
implementer, reviewer order. Removing the last entry deletes the file. See
[Saving models for this machine](#saving-models-for-this-machine) for the
picker and its blocked-run exception.

## Project guidance setup

Run `git init` before Banzai in a new directory. Interactive `banzai init` saves
configuration, offers model selection, then offers setup if root guidance is
incomplete. `banzai setup` requires existing valid configuration and a terminal;
it skips model selection. Bare/interactive entry offers setup before collecting
a new task when no unfinished run exists. Setup works on an unborn HEAD and
without application tooling; a new task still requires an initial commit.

The menu offers `Run project-manifest with Codex`, `Run project-manifest with
Claude Code`, `Show manual instructions`, and `Exit`. Planning's available
vendor is recommended; unavailable choices retain a disabled reason. Selecting
a client launches the explicit skill in a fresh foreground session with normal
permission prompts. It retains the client's own interactive model settings.
Exit the client to return to Banzai. The parent rereads files; exit 0 alone is
not readiness. Partial changes are preserved. Retry requires another explicit
selection; no task starts automatically. `Exit` returns 0 with an incomplete
notice, while SIGINT/SIGTERM return 130/143. Non-TTY init remains configuration
only; non-TTY setup returns `TTY_REQUIRED` and manual guidance.

Guidance labels are `Project guidance ready`, `Project setup required`,
`Project migration required`, and `Project guidance needs attention`. Readiness
requires ten populated manifest sections and the supported AGENTS/optional
CLAUDE layout. The complete raw line `<!-- banzai-scaffold: unfilled -->` before
the first heading marks an unfilled scaffold. Words such as `Open` and `None`
are allowed. This checks structure, not semantic accuracy or application tests.

Setup holds the ordinary runner lock without reclaiming existing ownership.
It refuses unfinished/corrupt run evidence; use status and finish or explicitly
cancel the run first. A new run checks full guidance before run/attempt or auth
work. Published runs recheck only instruction layout, including the Banzai
source exception. `PROJECT_SETUP_REQUIRED` preserves the last durable checkpoint,
decisions, triage and original failure evidence without a synthetic attempt,
event or usage. Manually repair/migrate instructions, inspect status and follow
the existing resume/retry/recovery route, or explicitly cancel before CLI setup.
Never repeat an already-saved decision. Approval and exact recovery identity
checks still apply after repair.

Setup discovers installed plugins through documented local client interfaces
or the existing validated Claude plugin-directory setting. It never installs
a plugin or assumes one beside the npm CLI. Codex discovery uses marketplace
list and explicitly filtered plugin-list calls; Claude uses installed plugin
list. Unsupported/unverifiable discovery leaves manual instructions. Selected
client auth uses the existing subscription preflight. Foreground arguments carry
no workflow grants, result schemas, resumed sessions or unattended permissions.
Banzai retains no child transcript; client-owned session storage remains normal.
Claude keeps strict MCP scoping and applicable project-settings/plugin scope;
Serena uses the existing whitelist. Actual client delivery is separately tracked
in the feature's [Private work history](historical-references.md).

## Spawned Claude Environment

Banzai scopes the environment of every `claude` process it spawns. Each one
loads only the whitelisted MCP servers (below), the Banzai plugin it ships
with, and your project's own `CLAUDE.md` shim to `AGENTS.md` — not your installed MCP servers,
plugins, skills, or slash commands. Those tool schemas sit at the head of the
cached prompt prefix and are resent on every API round-trip, so an unscoped
reviewer pays for them repeatedly even though it cannot call them; in one
measured project the turn-1 prefix fell from 42,201 to 19,799 tokens under
scoping.

Process instructions live in project `AGENTS.md`; policies stay in the installed
plugin and consuming skills read them explicitly. A legacy project stops before
affected work with **legacy Banzai layout: run `project-manifest` to migrate**.
Only an explicit `project-manifest` invocation proposes a migration diff for
approval. Cancellation, a new run, retry, recovery and answering a gate grant
no migration authority. The CLI refuses insufficient guidance before a new model attempt. If an
affected skill discovers a further policy or migration problem, writing phases
still use their existing escalation route and review uses its blocked-result route.
See [layout migration](https://github.com/Parabolic-Technologies/banzai/blob/main/plugins/banzai/skills/project-manifest/references/layout-migration.md).
Client versions, fixture tests and environment scoping do not prove effective
instruction delivery; automatic ingress, tool reads and application require
separate host evidence.

The optional `claudeEnvironment` section of `.banzai/config.json` controls
this:

```json
{
  "claudeEnvironment": {
    "mode": "scoped",
    "pluginDirectory": null
  }
}
```

- `mode: "scoped"` (the default, also used when the section is absent) isolates
  MCP unconditionally and scopes setting sources only when it can verify a
  Banzai plugin directory to re-supply. If it cannot, it keeps ambient setting
  sources rather than disabling Banzai skills and the enforcement hook, and says
  so in the run's progress output and events.
- `pluginDirectory` names an explicit plugin directory instead of the one
  shipped beside the orchestrator. The directory must identify the Banzai
  plugin and contain its required skills and enforcement hook; a configured
  directory that fails verification stops the run rather than degrading
  silently.
- `mode: "ambient"` restores the previous behaviour and lets spawned sessions
  discover your whole Claude Code installation.

`banzai doctor` reports this state as `claude.environment`: verified scoping
passes, explicit ambient mode and automatic MCP-only degradation warn, and an
invalid explicit plugin directory fails readiness. The check is filesystem-only
and does not invoke Claude.

### Headless Invocations

Every headless model invocation receives its rendered prompt on stdin
(ADR-0063): Claude runs `-p` with no prompt argument, and Codex takes `-` as
the prompt argument of `exec` and `exec resume`. Argv carries only flags and
identifiers, so a prompt is never bound by the operating system's argument
limit and never appears in a process listing. The runner writes the prompt
once at spawn and closes stdin; a child that exits before reading keeps its
own process outcome. Version probes and other processes that take no prompt
keep stdin ignored, and `banzai setup` keeps its interactive argv launch.

Every headless Claude invocation — planning, planning analysis, planning
review, workflow selection, implementation, fixes and review — also runs, in
both `claudeEnvironment` modes, with:

- `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1`, so a long command runs in the
  foreground and a timed-out command is stopped rather than moved to the
  background, where it could outlive the phase's result;
- `BASH_MAX_TIMEOUT_MS` set to the invocation's timeout minus a five-minute
  reserve for the closing turn, and never below two minutes: 1,500,000 ms for
  a 30-minute planner or reviewer and 3,300,000 ms for a 60-minute
  implementer. A command started with the maximum then ends before the runner
  stops the phase. Timeouts below seven minutes get the two-minute floor and
  keep less than the full reserve;
- no `BASH_DEFAULT_TIMEOUT_MS`: Banzai removes an inherited value, so the
  client's two-minute default applies and the raised maximum stays the
  ceiling.

Banzai sets these values after filtering the subscription environment, so an
inherited value never survives. Ambient mode restores discovery arguments
only; it keeps the stdin prompt and these variables. Codex children receive
none of them.

A Claude settings file can still replace these values: Claude Code writes each
`env` entry of every settings file it loads into its own environment, over
the inherited value. Scoped mode with a verified plugin directory loads the
shared project `.claude/settings.json` and managed settings; ambient mode and
scoped mode without a plugin directory also load user settings and project
`.claude/settings.local.json`. Banzai does not inspect or override such an
`env` block. Keep `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS`,
`BASH_MAX_TIMEOUT_MS` and `BASH_DEFAULT_TIMEOUT_MS` out of the settings
files a Banzai run loads.

### Claude Tool Permissions

Every Claude phase is spawned with `--permission-mode dontAsk`, which answers a
permission prompt with a denial instead of a human. Three surfaces can still
grant a call, and only three: the enforcement hook, which allows exactly the
writes the run authorizes for the current phase; an `--allowedTools` entry,
which a run spends on the Serena whitelist alone; and the permission rules of
the settings files the session loads.

Planning and implementation phases carry runner identity, so the hook allows
their authorized writes — the exact planning artifacts and public
documentation while planning, the approved scope while implementing — and its
allow skips the prompt that `dontAsk` would deny. A Claude planner or
implementer therefore needs no `Write` or `Edit` grant. No hook decision
overrides a deny or ask rule, though: a rule refusing `Write` or `Edit` denies
every write the hook authorized. Shell commands are never hook-granted in any
phase, so a Claude planner or implementer runs only the commands a loaded allow
rule names.

Startup preflight audits this before the first phase and ends the run with one
remediation when a deny or ask rule refuses `Write` or `Edit`. `banzai doctor`
reports the same audit as `claude.permissions`, with that remediation as its
fix; both skip it when no configured role depends on those rules — a Claude
reviewer does not: it uses read-only tools and returns structured findings. The
runner renders and publishes the review artifact; the reviewer receives neither
write nor shell tools.

What the audit reads is exactly what the session will honor:

- the settings sources the resolved scope passes. Scoped mode loads `project`
  only, so grants belong in the tracked `.claude/settings.json`;
  `.claude/settings.local.json` is never loaded for a scoped run;
- administrator policy settings, which apply whatever `--setting-sources` names;
- Claude Code's workspace trust record. An untrusted checkout has its
  repository allow rules ignored with a warning rather than an error, so they
  look exactly like rules that were never written. Run `claude` once in the
  checkout and accept the trust prompt. Deny and ask rules apply either way.

Grant the shell commands your phases need, for example:

```json
{
  "permissions": {
    "allow": ["Bash(mkdir:*)", "Bash(git status:*)"]
  }
}
```

Missing or scoped `Bash` grants are reported as advisories rather than blocks:
the run continues, and the phase runs only the commands the rules named.

`banzai init` and a completed `banzai setup` run the same read-only audit and,
when a refusing rule would stop the first run, print its reasons and
remediation:

```text
Claude permissions: A deny or ask rule refuses Write. No hook decision overrides it and `--permission-mode dontAsk` cannot escalate it to a human, so Claude planning and implementation writes are denied.
Fix it before the first run: remove the deny or ask rules naming "Write" from the settings Claude loads; a rule in administrator policy settings needs your administrator.
```

Neither command writes a permission rule: what Claude may do in a tracked,
shared settings file stays the operator's decision.

### Serena MCP Whitelist

Scoped isolation exists to keep unusable tool schemas out of the cached prompt
prefix, not to deny the phases semantic tooling. Serena is the one MCP server
worth its schema budget here, so when it is genuinely available it is
re-admitted explicitly — through `--mcp-config` beside `--strict-mcp-config`
for Claude, and a `-c mcp_servers=...` override for Codex that replaces the
whole table, so no other user-scope server leaks into a run.

Availability is checked once per run and every gate that fails downgrades to
"no whitelist" with a reason, never a blocked run:

- the checkout is onboarded (`.serena/project.yml` exists);
- the vendor has serena registered — the project's `.mcp.json` or the
  user-scope `.claude.json` for Claude, `codex mcp get serena --json` for
  Codex, so each vendor runs its own registration verbatim;
- the registered command resolves on the sanitized PATH the child receives.

The result is reported once per run —
`MCP whitelist: serena -> claude, codex` or `MCP whitelist: none (…reasons)` —
and recorded as an `mcp_whitelist.resolved` event.

Phases reach Serena for navigation only — symbol lookup, references,
diagnostics, memories. Its editing tools are never granted, in any role:
Banzai's spec gate enforces the approved bundle by intercepting
`Edit`/`Write`/`apply_patch` and never sees an MCP call, so a phase editing
through `replace_symbol_body` would bypass that enforcement. Phases already
hold `Edit` and `Write`; what they lacked was navigation.

Shipping the schemas alone did not change behavior: real runs showed every
phase still navigating by `grep`/`sed` line windows while a connected Serena
went unused. When the phase vendor's whitelist entry resolved, the planning,
implementation, fix, and review prompts therefore append one guidance line
steering symbol lookup to Serena's read-only tools; runs without Serena keep
byte-identical prompts.

## Live Progress

Commands that advance a workflow report progress to stderr. By default each
action settles into one line carrying its duration, and a run of identical
consecutive actions is closed with its count:

```text
[banzai] Preparing run sc-12345-example-task in /path/to/project
[banzai] START Preflight - Node, contracts, executables, verification commands, and subscription authentication
[banzai] DONE Preflight (2.1s)
── Planning ─────── claude · claude-opus-5-5 · xhigh · fresh · 30m cap ──
[banzai] · banzai:feature-description
[banzai] ·  0.3s command: git diff --stat
[banzai] ·  0.2s command: rg -n "resolveScope" src
[banzai]   ×4 total
[banzai] ✗  0.4s command: npm run lint --silent
[banzai] · tokens: 24.8K in (248 fresh · 99% cached) · 122 out
[banzai] DONE Planning (48s)
[banzai] Produced a description, 2 ADRs, a plan
```

The phase banner and colour appear only on a terminal; piped and redirected
output stays plain. On a terminal a live status line also reports the running
phase, its elapsed time, what is in flight, and how many actions have settled,
and is erased before every settled line and when the phase ends.

Three verbosity levels are available on any command that runs a phase:

| Level   | Flag        | Shows                                                       |
| ------- | ----------- | ----------------------------------------------------------- |
| quiet   | `--quiet`   | Phase boundaries, failures, and runner messages             |
| normal  | default     | Plus one settled line per finished action, and token usage  |
| verbose | `--verbose` | Every model action, started and finished, with no live line |

`BANZAI_PROGRESS=quiet\|normal\|verbose` sets the same levels; an explicit flag
wins over it, and an unrecognized value falls back to `normal` rather than
failing the run. `--metrics` additionally prints attempt, session, and review
counters, which are otherwise reserved for `banzai status --json`.

The runner reports preflight and repository checks, workflow selection,
planning when strict, implementation, each configured verification command,
review when strict, and accepted-finding fixes, and names what each phase
produced when it completes. Without a live line, a heartbeat is printed every 30
seconds naming the actions still running.
Codex `--json` and Claude `--output-format stream-json` events are normalized
into the same model, action, skill, and usage lines. The supplied phase responsibilities appear in each start line; observable
Claude `Skill` calls and supported Codex skill events are reported only when
they occur. Builder inventories remain unchanged; Claude review roles no
longer receive `Skill` (ADR-0059). Fewer Skill events prove
neither model compliance nor lower cost. Because
implementation, verification, and review advance without a gate, this progress
stream is how an approved run reports itself until the next decision.

Progress is deliberately separate from stdout, so `banzai status --json`
remains machine-readable. Progress exposes safe tool identity and file paths,
not raw prompts, reasoning, assistant prose, command arguments, search queries,
command output, or tool results. Redacted result and failure evidence continues
to be stored in the run directory.

`status` reports a `nextAction` plus separate retry and recovery eligibility.
Use `resume` for a paused phase or to reconcile a durable terminal checkpoint.
Use `retry` only
after resolving the external cause of a retryable startup check, review check,
or failed selection/planning/review attempt.

## Failure Recovery

If initial preflight or the repository check fails, the confirmed request
is preserved as a blocked run. Resolve the reported prerequisite and choose
`Retry start checks` in interactive mode, or run:

```text
banzai retry
```

The retry reruns preflight and the repository check, refreshes the base commit,
and begins workflow selection under the same run ID. It does not ask for the
request again.

For a failed selection, planning, or review process:

```text
banzai status
# Resolve the reported authentication, CLI, MCP, or provider problem.
banzai retry
```

A planner can also stop planning by returning `outcome=blocked`, with a summary
that names the cause and what you need to do first. Do that, then choose `Continue
planning after the reported block` in interactive mode or run `banzai retry`. It
runs preflight and starts a new plan attempt that records the blocked attempt and
receives the summary as diagnostic data. The planner session resumes when the
workspace and planner settings are unchanged, and otherwise a fresh session
restores context from the planning files. Recorded ADR decisions, consultation
answers and planning-review triage keep their effect, and a block from a planning
review's applying step continues that step. Blocks reported by implementation
and fix attempts keep their own routes.

Retry reruns preflight, preserves the failed attempt, and creates a distinct
attempt. Selection and source-read-only review are also retryable after
interruption. A review retry reuses the latest unfinished iteration and
canonical `review-<iteration>.md` identity instead of skipping an artifact
number, but allocates a new candidate path. Adapter success followed by review
validation failure retains the structured result, redacted stdout/stderr,
candidate bytes and digest, exact validation error, and typed failure code in
the failed attempt. These remain diagnostic rather than canonical. Non-zero
vendor exits likewise retain redacted stdout and stderr under the run's
`attempts/` directory, while the state and event log contain only a concise
error.

Planning retries preserve the vendor session ID as soon as Codex announces its
thread or Claude sends its initialization event. After a supported capacity,
timeout, transport, result-format, or plan-validation failure, the new attempt
resumes that session only when the planner settings, planning instructions,
tool scope, and stopped workspace still match. Its prompt names the failure and
existing planning artifacts and asks it to finish the remaining work. Missing
or legacy context, changed inputs, and unclassified or integrity failures use a
fresh session with an artifact-first continuation prompt. The failed attempt
stays intact; the new attempt records `planningContext.retryOf` and its actual
fresh/resumed mode. No private vendor transcript is imported or treated as
completion evidence. Interrupted planning without a proven terminal result
retains its existing non-retryable policy.

The interactive action is `Continue the failed planning attempt`. A valid saved
planning terminal checkpoint is reconciled without another model call, with
the ordinary plan validation and human approval gate. A rejected plan artifact
requires repair; conflicting terminal or session evidence cannot promote an
earlier checkpoint. If checkpoint validation rejects an otherwise retryable
failed planner, an explicit retry creates a fresh session and includes the
rejection diagnostic. Consumption is accounted once across failure and terminal
reconciliation.

Codex progress JSON is provisional: the final agent message confirmed by
`turn.completed` owns the terminal checkpoint, and the post-close result file
must agree. Subsequent tool work invalidates a provisional message; duplicate
terminal events, work after an explicit final message, and conflicting final
results remain errors. Observer failures, timeouts, and post-close decoding
failures retain captured redacted output and any vendor-reported usage.

If review checks fail before Claude starts, no model attempt exists yet. After
fixing Claude authentication or another reported prerequisite, interactive mode
offers `Retry review checks`; the scriptable equivalent is `banzai retry`.
The runner then rechecks the base commit, approved artifact digest, Claude
authentication, and workspace snapshot before invoking Claude.

When task verification blocks a run, `banzai status` and the interactive status
list every check with its outcome. For each check whose latest attempt did not
succeed they also show the command and working directory, the result (exit
code, timeout, terminating signal or start failure), the failure category,
duration and timeout, the last 20 lines of redacted stderr (stdout when stderr
is empty), and the repository-relative stderr and stdout log paths under
`.banzai/`. A signalled process has no exit code; the recorded `1` is labeled
synthetic. The block reason names each incomplete check and its outcome and
never contains command output. `banzai status --json` keeps its shape: it
carries the raw `state.taskVerification` attempt records, and only the human
views read the logs.

Retry re-runs every unsuccessful check of the round in one action, runs the
checks that were not run, and keeps checks that passed while the observed
inputs are unchanged; implementation is not replayed. Each new attempt links
to the attempt it retries. The interactive action reads
`Retry the N failed checks` when several checks are rerun. When every rerun
check exited with an ordinary non-zero code and neither its command nor the
observed project files changed since, it reads
`Retry anyway (same command, same files; expected to fail again)`, or
`same commands` for several checks. Observed files are tracked and untracked
non-ignored files; ignored dependencies, caches and the environment are not
compared, so the label is a prediction and never refuses the retry.

Retry never bypasses approval integrity. `banzai approve plan` stores the
exact bytes of every approved artifact beside the run evidence
(`.banzai/runs/<run-id>/approval/`), because the bundle paths are typically
uncommitted and would otherwise leave no recoverable approved form. If an
approved description, plan, or ADR later changes — an editor, a formatter, or
a parallel agent session touching the checkout — the next phase's checks block
the run, and `banzai restore` (or the interactive
`Restore the approved planning artifacts` action) rewrites the approved paths
with the snapshot bytes after verifying them against the recorded approval
digest; `banzai retry` then re-enters the blocked phase, since
implementation-checks and fix-checks failures are retryable exactly like
review checks. Runs recorded before snapshots exist report that restoration
must be manual. Alternatively cancel the run and start a new one so the
revised bundle can receive explicit approval. Orchestrated
implementation and fix prompts keep approved planning artifacts immutable and
record progress in reports instead of plan checkboxes. New strict
implementation results carry a versioned canonical task-completion ledger in
approved `TNNN` order. Under `banzai-completion-protocol/v1` (ADR-0047) the
model returns that ledger plus report narrative and never authors the
**Plan Task Completion** table. New strict implementation and fix attempts are
recorded with attempt schema 4 and the persisted protocol marker. Their
terminal proof uses `banzai-terminal-attempt-checkpoint/v3` directly in state 10,
without a legacy transition record. After the vendor returns
a completed result, the attempt becomes `pending_application` and the runner
captures the report and workspace identities that the terminal checkpoint
recorded when the vendor returned. Capture accepts the files on disk only while
they still equal those exact identities, so a restart before the capture
manifest or an original was durable can never adopt bytes written after the
model finished: a mismatch is `COMPLETION_PUBLICATION_DRIFT`, and a completion
claim with no durable terminal observation is
`COMPLETION_PUBLICATION_INTEGRITY` rather than a fresh baseline. The runner
then validates the claims
(approval digest, task coverage and order, changed-surface evidence paths,
required reports, gap headings), renders the report's completion section as the
delimited `banzai-plan-task-completion/v2` region, persists the candidate,
publishes it into the implementation report, records an immutable publication
receipt, and only then applies the result and emits
`completion.publication_applied`. The v2 region keeps every byte outside it,
replaces exactly one existing legacy or v2 section, encodes every ASCII
punctuation code point of its JSON cells as a decimal numeric character
reference, and is decoded exactly once; text inside it confers no authority. A
stop result (blocked or escalation) is applied as reported with any completion
diagnostic retained beside the attempt and nothing published. Invalid completed
claims and structurally ambiguous report input (duplicate or overlapping
completion sections, malformed delimiters, an unclosed fence) fail the attempt
with `PLAN_TASK_COMPLETION_INVALID` and `completion.input_rejected`; a runner
I/O, drift or integrity failure during publication leaves the attempt
`pending_application` with a closed refusal code, where `resume` retries only
the deterministic publication, drift requires restoring the exact recorded
input or proven output before `resume`, and integrity exposes `cancel`. The
same boundary contains a failure while persisting the refusal state or event:
it retains the last durable stage, never becomes a model failure, and `resume`
appends any durable refusal event once before continuing. The
authority a publication must still match includes the base commit, approval,
plan tasks, attempt scope, work binding and the implementer configuration
digest; the configuration is compared explicitly because `.banzai/config.json`
is excluded from the non-report workspace digest and no other check would see
it change. A process death between the attempt-completed write and the durable
summary, cursor and events leaves a completed protocol attempt whose retained
receipt lets `resume` finish the missing writes idempotently, without another
model call and without duplicate accounting or events.
Historical runs keep their model-authored `banzai-plan-task-completion/v1`
projection and summary schema 1: that decoder still HTML-escapes `&`, `|`, `<`
and `>` inside the Evidence and Gap JSON cells, accepts exactly one complete
outer backtick pair around a whole cell, and recovers a row with one raw
unescaped `|` when exactly one rejoin boundary decodes both cells. Persisted
state separately owns lifecycle and `nextAction`; legacy runs without the
ledger retain that lifecycle but report completion as legacy/unknown rather
than fabricated `N/N`.
Evidence paths must name files created or modified relative to the run baseline,
or the exact required implementation/test reports. A carried-in unchanged source
or test file is not direct completion evidence even when the task confirms it
read-only; that confirmation belongs in a required report, and the ledger cites
the report. Evidence-repair prompts include the persisted violation and exact
task ID so the replacement does not preserve a known-invalid row.

Implementation, fix, and interrupted planning attempts may have partial
repository side effects, so they cannot normally be retried. An implementation
result rejected with `PLAN_TASK_COMPLETION_INVALID` is the narrow exception,
whether ledger validation rejected a decoded result or the result failed
decoding on a completion field — for example a gap detail over the 500
character single-line bound: the runner classified both as completion-evidence
failures when it wrote the invalid checkpoint, retains what decoded, and may
request one replacement result without duplicating the attempt or task ledger.
Under the completion protocol the repair successor is a deterministic
`<kind>-repair-<hex>` attempt linked to its rejected source through `retryOf`;
resume never promotes the rejected attempt. The repair prompt carries the
rejected attempt's persisted diagnostic so the replacement names the exact
offending field or the ambiguous report ownership to repair, and the writing
prompts state the ledger field bounds (500-character single-line strings, at
most 16 evidence entries) so first-pass records are composed to fit. Strict implementation and
fix prompts also carry the run's recorded human decisions, with the rule that a
recorded answer is authoritative and a question it covers is never re-raised as
a new escalation — so a decision made at any earlier gate stays visible to
every later writing phase instead of being re-asked.

After a fix changes tests, verification commands, or their expected or observed
results, the fix prompt and shipped `quick-fix` skill require a complete sweep
of test-count and command-result claims in the current `test-report.md`,
`implementation-report.md`, and the fix change report. Each current claim must
come from a command actually run in that fix; older evidence must be scoped
explicitly as `historical/pre-fix`. In orchestrated mode, runner-owned final
verification is recorded only as `pending at fix handoff`, with durable runner
evidence owning the eventual result, rather than predicted from an earlier
total. All three artifacts must remain mutually consistent.

Per ADR 0025, an accepted-finding fix whose changes made the recorded
completion evidence stale may return a complete refreshed `taskCompletion`
ledger, validated by the identical fail-closed pipeline; the runner republishes
the v2 region from it, the summary records the fix attempt as ledger author and
publisher (`sourceAttemptKind: "fix"`, absent means implementation) and the
runner emits `plan_task_completion.refreshed`. A fix that returns
`taskCompletion: null` republishes the retained canonical ledger into the
current narrative with a new publisher receipt while the original ledger author
is preserved. Statuses cannot regress through a refresh — a completed fix
outcome still requires every task completed, and a genuine downgrade still
escalates. A rejected refresh fails the fix attempt with the invalid checkpoint
and offers the same `Repair plan-task completion evidence` retry, which reruns
the fix as a linked `fix-repair-<hex>` attempt with the persisted diagnostic
and unchanged triage scope.

The canonical Implementation Tasks heading grammar
(`- [ ] **TNNN - Title**`, one line, ending at the closing `**`, unchecked
even in a revised plan) is validated twice before it can bind anything: a plan
result with a malformed heading fails its attempt before the approval gate is
raised, and `approvePlan` re-checks the exact bytes it is about to bind so an
on-disk edit after the gate cannot smuggle one in. If a run nonetheless holds
an invalid completion checkpoint whose violation lives in the plan bundle
(`approved_plan_invalid`, `approval_invalid`), retry does not loop the
evidence repair — the interactive action reads
`Rerun planning to correct the approved plan`, the recorded approval is
voided, the stale checkpoint is cleared, and planning reruns toward a fresh
plan-approval gate. Interactive mode labels that action
`Repair plan-task completion evidence`, distinct from a source-read-only
retry. If the rejected result also has a terminal checkpoint, the repair action
takes precedence over reconciliation: `resume` leaves the run unchanged rather
than replaying the already-rejected evidence. The same repair applies when the
read-only revalidation of a published completion rejects the evidence — for
example when a published report's bytes changed after publication
(`summary_mismatch`) or the ledger author record no longer decodes — even
though no attempt failed: the retry starts a fresh completion-repair
implementation attempt from the invalid checkpoint. An edit inside the
runner-owned region during a fix confers no authority and is simply replaced at
that fix's publication; when an accepted review finding shows a record was
overstated, the repair returns the corrected ledger with `gate=escalation`
instead of restoring the false claim. Fix prompts state that the runner owns
the section: a fix never edits it, and an accepted finding it cannot truthfully
resolve escalates rather than rewriting completion evidence. Interrupted selection and review
are explicitly retryable because their model phases cannot change production
source; review retains only its bounded attempt-owned candidate evidence.
When a supported vendor emits a valid terminal success, Banzai atomically
persists an attempt-owned checkpoint before waiting for process closure. If the
parent is then interrupted, status reports `resume`; reconciliation validates
the same attempt, base commit, approval/workflow, scope, model/session context,
and structured result before applying it exactly once. Raw result files,
terminal prose, and successful tests are not terminal checkpoints.

A mutable implementation or fix with no checkpoint remains ineligible for
ordinary retry when it was interrupted or failed after the model started with a
typed `capacity`, `timeout`, or `transport` cause and no terminal result. If the
process is dead and every current base, approval/workflow, scope, model
configuration, attempt, and workspace check is valid, status instead offers
`banzai recover` with bounded change counts, an exact identity, and a warning
that repository or external effects may be partial or duplicated. Process-start
and unclassified failures remain fail-closed. Interactive recovery has a
negative-default confirmation. Non-TTY callers use the closed
`banzai-agent-recovery/v1` document. Recovery preserves the old attempt as
`interrupted`, creates one new linked physical attempt, and routes the fresh
result through normal completion, verification, independent review, and triage
gates. It never infers completion from existing source or reports.

If an abrupt exit also left an execution claim, authorized recovery can reclaim
it under the repository runner lock. The claim must name the exact bound work
and a valid local PID that the OS confirms is absent. Banzai preserves its
original bytes as `recovered-<token>.json` in the same ignored execution-lock
directory and checks the claim again before removal. Live or reused PIDs,
uncertain process checks, malformed or mismatched records, unsafe paths and
changing ownership remain blocked for inspection. Status and ordinary execution
do not reclaim claims. A saved, still-valid recovery authorization can continue
through `resume`; recovery revalidates its workspace under work ownership before
starting a model.

A completed strict fix result is separately eligible only when it is the unique
current canonical source, has `outcome: blocked`, proves a non-empty proper
subset of accepted findings resolved, and records at least one question or
requested verification prerequisite. The run has no active attempt or live
process, current review and triage agree, and no recovery descendant exists.
Status keeps retry unavailable and presents the resolved IDs, remaining IDs,
and prerequisite actions with a negative-default confirmation. After the
operator addresses them, the same closed recovery document authorizes one
linked fix attempt containing only the remaining accepted findings. The source
record remains completed and byte-stable; a new descendant cannot seed another
prerequisite recovery chain.

A third source covers a model-authored digest that never matched the bytes it
named. A phase result's proposed descriptor sources are compared before the result
is accepted. Which digests are compared follows one rule shared by acceptance and
launch — a plan remainder digest binds its inventory to the plan bytes outside it,
a source identity on a lite or supplemental descriptor is an execution
precondition, and a source identity recorded on a required obligation stays
descriptive metadata and is never compared. A rejection names the contract field,
the repository-relative path, the declared digest and the observed digest and
nothing else; a source above the permitted size is reported separately with that
size and the permitted limit. The comparison is recorded per attempt as
`banzai-result-digest-evidence/v2` under `.banzai/runs/<run-id>/digests/`, written
once and never restated, so the later launch check can say whether the bytes
changed after acceptance or never matched. With no such record the causal history
is reported as unknown and is never reconstructed from the bytes on disk now.

A plan remainder digest no longer reaches this source. The runner records it when
it accepts a planning result, and the v2 comparison keeps the planner's value as
`declared`, the runner's as `observed`, and `recorded: true`, so the record is
accepted. Reconciling an interrupted acceptance reaches the same plan bytes and
keeps the first record. Records written as
`banzai-result-digest-evidence/v1` stay readable, as comparisons the runner did
not record, and a plan digest rejected under v1 keeps this repair route.

A rejected result fails its attempt and keeps its result as evidence. When the
run is non-terminal with no live attempt, the attempt reached a terminal
checkpoint so its repository changes are known rather than partial, its only
recorded failure is that digest rejection, and no successor exists for the
phase, status offers `banzai recover` in preference to replaying the rejected
evidence. The closed `banzai-agent-recovery/v1` document authorizes one linked
attempt for the same phase and no additional scope; a planning source is
represented with `phase: "plan"`. `banzai-recovery-authorization/v1` keeps its
schema identity: the accepted attempt kinds grew to include `plan`, and every
authorization an earlier version wrote holds `implementation` or `fix` and
parses unchanged. A replacement strict plan passes the ordinary approval gate
and never inherits the prior approval. An attempt outside these conditions keeps
its current disposition; a failed mutable attempt whose side effects are unknown
or partial is still refused ordinary retry.

The source result, exact checkout, approval, configuration, and remaining scope
are rebound before and after implementer preflight. Drift invalidates the
authorization before a model call. Banzai never executes the recorded
prerequisites, adds a broad Bash allowance, loads local Claude settings, or
weakens project-scoped `dontAsk`; those are operator-owned actions outside the
recovery mutation.

If the workspace changes after authorization, recovery fails before another
model call and requires a new inspection and decision. Other interrupted or
non-recoverable blocked states fail closed. Inspect the checkout and logs, then
run `banzai cancel` when appropriate. Do not edit or delete `.banzai` state to
recover.

### Local model changes

A run records the [local models](#local-model-file) it starts with, and
`banzai status` lists the models it runs with and their sources:

```text
Models:
  Planning: claude claude-opus-5-5 xhigh (committed)
  Implementation: claude claude-opus-5-5 xhigh (committed)
  Review: claude claude-opus-5-5 xhigh (local)
```

For a done or cancelled run the heading reads `Current models:` and the lines
show what a new run would use. Every state-changing command — resume, approve,
triage, recover, rework, planning-review requests and answers, ADR and human
decisions, and configuration answers other than Cancel — compares the current
`.banzai/config.local.json` and the run's record with the models it holds
before its first write, and again before each model attempt and pending
transition. Entries that differ only in key order or formatting are equal. A
difference refuses with `LOCAL_MODEL_OVERRIDE_CHANGED`:

```text
Local models changed since this run recorded them
  Review: recorded claude claude-opus-5-5 xhigh, now shared
Restore .banzai/config.local.json, run banzai retry in a terminal when banzai status recommends it, or run banzai cancel. A change you did not make may come from a model phase or a project script.
```

`shared` means that the phase has no local entry and uses
`.banzai/config.json`. A local file that cannot be used shows one line instead,
such as `.banzai/config.local.json: invalid (models.reviewer.effort)`,
`.banzai/config.local.json: tracked`, or
`.banzai/config.local.json: not ignored`; at a command's entry, a tracked or
unignored file refuses with `LOCAL_CONFIG_NOT_IGNORED` instead. A record
rewritten while a command runs refuses the same way, with a line naming
`model-override.json`. The refusal writes nothing at a command's entry; before
an attempt it adds no write, and what the command already completed stays. It
records no block reason, event, or review rotation and consumes no retry or
recovery authority, so `banzai status` keeps its recommendation and prints the
same lines under the run's models. To continue:

- restore the local file and repeat the recommended command;
- when `banzai status` recommends `banzai retry`, run it in a terminal to
  continue with the changed models; or
- run `banzai cancel`.

`banzai cancel`, `banzai status`, and verification commands never compare.

Two commands record the current local models instead of comparing: `resume`
of a run still in `created` or `selecting` with no model attempt, and
`banzai retry` of a blocked run, including its planning-review retry and its
reconcile of a saved planning result. When the models differ, the command
prints `Recording the changed local models for this run:` with each changed
phase, replaces the record, and appends a `model_override.recorded` event that
names each phase's source without model values. A changed setting starts a
fresh session, as a committed change does. Once the run has a model attempt,
recording different models needs a terminal: `banzai retry` without one, as
under agent control, refuses with `LOCAL_MODEL_OVERRIDE_CHANGED` and writes
nothing. A failed retry preflight leaves the record unchanged, unless the retry
recorded the new models before reconciling a saved planning result. To give a
blocked run other models, run `banzai model`, which saves to this machine while
status recommends retry, then `banzai retry`.

`LOCAL_MODEL_OVERRIDE_RECORD_INVALID` means that the record itself is
unreadable, a symbolic link, not a regular file, not valid JSON, of another
identity, or invalid. Banzai never reads such a record as missing, so the
run's models cannot be confirmed: `banzai status` prints the record path as
`invalid`, reports retry and recovery as not eligible, and recommends
`banzai cancel`. Cancel the run and start a new one. A run created before
local model files has no record; it runs on committed models and refuses while
the local file sets any phase, until a command that records gives it one.

## Local State

`.banzai/runs/<run-id>/state.json` is atomically replaced. `events.jsonl` is an
append-only summary without full transcripts. New runs create
`verification-attempts/ledger.json` plus one atomic sequence-ordered leaf per
physical verification attempt; `state.verification` remains the latest
operational round. Attempts, structured results, attempt-owned review
candidates, redacted CLI output, verification evidence, and review results
remain local under the ignored run directory. Evaluation counts supported
failed attempt records but does not treat candidate Markdown, raw result files,
terminal checkpoints, recovery authorizations, or failed structured results as
review verdicts or completion evidence.
New model attempts use schema version 4 with phase-result 4. Strict implementation
and fix retain the existing completion protocol and nullable `retryOf` linkage.
New runs start at schema version 10 with binding v3 to Git-visible work documents
and task verification evidence under the ignored run root. Historical run
continuation is outside the current transition. State 10 carries the completion
publication cursor from creation.
Tagged pending consultations, exact keyed decision history and recovery lineage
retain their existing meanings. The `source_preserved` stage keeps a completed
blocked source immutable while one linked attempt is prepared. Checkpoints and recovery
authorizations are immutable atomic mode-`0600` evidence; users and supervisors
must never edit them manually.

The model hand-off uses phase-result v4. It adds the planning-only
`decision_consultation` gate and required nullable `decisionConsultation`
payload; phase-result v1 and v2 remain read-only legacy inputs and cannot be
returned by a new attempt. Evaluation export and KPI stay on their independent
privacy-minimized v1 contracts. Consultation events retain only card counts,
answer-mode counts, timing, and completion state, never request/card/option IDs,
questions, recommendations, answers, evidence detail, decision-maker labels,
or raw paths.
Evaluation never exports commands, candidate/error metadata, log references/
digests, raw output, or credential material from the ledger.

State binds resumable sessions to role, executable, model, and effort. Status,
events, attempts, and metrics distinguish fresh/resumed sessions and full/delta
reviews, including rotation reasons, without persisting prompts or transcripts.
The reviewer rotates fresh when its binding or approved bundle changes, a
review fails, is interrupted, or blocks, a blocker/security finding is
accepted, or two delta reviews complete. Every resume reapplies the current
Codex sandbox or Claude tool restrictions.

One refinement to "a review fails": retries preserve the same reviewer session
and delta context when the failure is structurally classified as capacity,
timeout, process-start, or transport. Unclassified failures, invalid contracts
or artifacts, workspace or approval drift, and other integrity-sensitive
conditions rotate to a fresh full review, as does a changed invocation scope or
reported tool inventory (`session-inventory-changed`).

Failed model attempts retain their redacted stdout/stderr and any structured
usage already spent. That usage counts toward run totals, but the attempt is
excluded from completed-attempt, verdict, review, and finding metrics. Runs
persisted before failed-turn capture did not record every failed turn, so
historical and new-run totals are comparable only with their evidence coverage
in mind. New reviews make no formatting-only model calls. Deterministic
rendering, validation or publication failure is explicit and retains available
result, candidate, diagnostics, immutable terminal proof and usage. Historical
formatting-repair records and combined usage remain readable without being
replayed or double-counted.

Schema-version-1 run state remains readable. Its unbound string session IDs are
not reused; Banzai preserves artifacts and human decisions, normalizes the state
to version 2 on the next write, and safely starts the next eligible model phase
fresh.

If a completed model attempt was persisted before its state transition, then
`resume` reconciles it without repeating the model phase. An interrupted attempt
is never silently retried; eligible interrupted selection and review attempts
require an explicit `banzai retry`.

Selection exports only `BANZAI_RUN_ID`, which denies writes. Strict code phases
add `BANZAI_APPROVAL_DIGEST`; lite code adds `BANZAI_WORKFLOW_DIGEST`. Review
supplies run and approval identity for reads while removing inherited
`BANZAI_REVIEW_ARTIFACT` and `BANZAI_WORKFLOW_DIGEST`. The hook denies every
mutation while reviewing or while a review attempt is active, before workflow
write grants. Standalone session behavior remains separate when runner variables
are absent.

`.banzai/config.local.json` is the optional per-developer
[local model file](#local-model-file). Git ignores it, and it belongs to no
run. Each new run writes the create-only
`.banzai/runs/<run-id>/model-override.json`, mode `0600`, before `state.json`
and the active-run pointer:
`{"schema":"banzai-run-model-override/v1","models":{…}}`, holding the local
models the run started with, or `{}` without a local file. Only the
[recording commands](#local-model-changes) replace it; never edit it by hand.
A run without the file was created before local model files existed. Run state
schemas are unchanged.

## Work documents

New work groups its human-reviewed documents under `documentation/work/<slug>/`.
Standalone skills use ordinary file tools with explicit document selection;
layout declarations and artifact registration are unnecessary. New runner state
9 persists binding v3 in its own state and workspace v3 accounts for selected
tracked documents. Existing standalone continuation uses known locations without
migration. See [work documents](artifact-storage.md), the
[historical archive guide](artifact-archive.md) and
[publication boundary](publication-boundary.md).

## Proportionate verification and focused closure

New task runs use tracked-document binding 3 and private verification ledger 3. Immutable physical
start/finish records link exact descriptors and observed inputs to current
applicability. Reuse requires explicit complete dependency declarations and a
compatible direct successful origin. Missing proof runs fresh; required failures
block completion. Release gates always run fresh.

Fresh task checks do not require a complete dependency declaration for reuse.
Ordinary input files are streamed within a 128 MiB aggregate observation budget.
Secret-like filenames are observed through filesystem metadata only; Banzai
does not read or hash their values. Their presence disables cross-round reuse,
while unchanged metadata and ordinary file content permit fresh results in the
current round. Symlinks, unreadable files, capture races and exhausted budgets
still prevent applicability. A successful command with an unavailable snapshot
is reported explicitly; after correcting the cause, use verification retry.
Earlier attempts remain immutable and implementation is not replayed.

Review snapshot 7 and rendered artifact 8 freeze task checks and completion
publication. Review-result 2 is unchanged. The independent reviewer assesses
whether checks cover requirements and were unjustifiably weakened. Frozen
export formats report unsupported task evidence as partial. Historical archive
tooling is retained in its original source revision. Historical formats retain their meanings.

For an accepted-finding closure, keep unaffected report text and add one bounded
record: accepted ID, changed scope, decision, executed/reused/historical/pending
references and limitations. Inspect current claims for contradictions and correct
only affected claims. A consistency sweep does not execute commands. Resolution
review receives the accepted IDs, delta, current authority and evidence, preserving
independent review and human triage. Runner instruction and policy bodies remain
complete on every model call.

## Guided configuration checkpoints

This section documents retained historical formats only. New task runs do not
enter configuration-prerequisite gates or offer Accept/Edit/Skip for profiles.

Historical schema-2/3 runs used state 6 with explicit `verificationMode: ordered|policy`;
legacy config-1 runs and state readers retain historical semantics. Binding v1
continues in ordered mode and v2 in policy mode. After a completed implementation
or fix attempt, missing coverage or a finite known missing script raises
`configuration_prerequisite` in `needs_human_decision`. It is a pending decision,
not a new blocked lifecycle. Plan approval, implemented work and the completed
attempt remain intact.

Accept adds the previewed profile automatically; Edit returns a fresh proposal;
Skip records hygiene-only scope for this run; Cancel uses existing cancellation.
Proposals pin exact config bytes and bounded project evidence. Drift requires a
fresh proposal, never a blind write. Existing profiles are never overwritten by
Accept. A separately confirmed `verify edit/remove` can repair them. External
repair leaves the decision pending until `banzai resume` revalidates it; resume
records `satisfied_by_configuration` without inventing a human answer. Config
transactions retain prepared/applied/finalized evidence and a single logical
`config.verification.applied` event. A write already published before source drift
remains a real change and cannot authorize continuation on stale evidence.

`status` leads with Accept/Edit/Skip/Cancel, then the alternative “Fix
prerequisites, then run banzai resume.” A waiting interactive session holds
configuration ownership. Answer there, or exit it before repair in another
terminal. No model or active verification process can use guided commands to
write runner control files. Plans place configuration needs in **Human
prerequisites**, displayed during plan approval; executable tasks targeting
`.banzai/` outside exact bound artifact roles are rejected before approval.

Control 4 declares this kind and `banzai-agent-answer/v3`. Both `banzai control
answer` and `banzai approve verification` take the same closed JSON on stdin:
`schema`, `schemaVersion: 3`, `kind: configuration_prerequisite`, exact `runId`,
`decisionId`, `proposalId`, and `action: accept|edit|skip|cancel`. Only Edit adds
`profile: { id, commands }`. Commands accept `name`, `command`, `args`, `timeoutMs`
and an optional current ID; policy fields and invented IDs are forbidden.
`--no-resume` applies a valid choice without starting a process. V1 escalation
and v2 consultation inputs keep their existing meanings. Supervisors negotiate
capabilities before relaying the current human's exact answer.

Snapshot v4 and `banzai-feature-review/v5` expose actual coverage disposition,
resolution/Skip references and exact runner configuration deltas. They separate
carried-in or later user changes and never attribute the entire config file to
the runner. Skip creates neither substantive success nor all-check applicability;
actual hygiene leaves/logs remain required, and absence of hygiene is explicit.
Frozen human-time/evaluation outputs keep their versioned incomplete/unknown
semantics. See [ADR-0045](decisions/0045-guided-verification-setup.md) for the closed
contracts and retained authority boundaries.

## Rework and independent planning review

At a strict ADR or plan gate, request rework with written feedback or request an
independent review of the whole planning bundle or selected artifacts. The
reviewer and planner analysis run read-only. The runner writes a separate
`planning-review-<N>.md`; zero findings restore the gate. With findings, inspect
the analysis options and their consequences before its advisory recommendation,
then choose one option, write your own instruction or decline each finding.
Only recorded human dispositions reach the applying planner. Revisions return
to a normal planning gate and still require explicit approval or ADR acceptance.
Changed reviewed bytes close the episode as stale; explicit retry reviews the
current bytes under a new number. Existing artifacts are never overwritten.

```text
banzai approve plan --decision rework --note "Exact owner feedback"
banzai approve plan --decision recheck
banzai approve adr --id ADR-0001 --decision rework --note "Exact owner feedback"
banzai review planning
banzai review planning --artifact documentation/work/example/plan.md
```

`approve plan` accepts only its documented flags. Unknown, repeated, positional
and `--name=value` forms fail before approval; `--note` is accepted only with
`--decision rework`, and `--no-resume` has no effect on a re-check. For agent supervisors, control
9.0.0 declares capabilities v9 and status v7. Send closed gate-decision v1
through `banzai control decide` and planning-triage answer v4 through `banzai
control answer` using direct stdin. Encode human text as raw UTF-8 JSON; on the
64 KiB limit, let the human shorten their own text or answer in a terminal.
Never infer a decision or truncate the text. Relay a re-check as
`banzai approve plan --decision recheck` only on the human's explicit request,
and never edit planning files yourself. Historical runs cannot acquire new
rework/review authority or resume through the v10/v11 hook; preserve them and start
new work. `banzai`, `banzai status` and `banzai doctor` show such a run as
read-only history; an unfinished one offers only `banzai cancel`, after which
new work starts normally. This release does not migrate or install anything
automatically.
