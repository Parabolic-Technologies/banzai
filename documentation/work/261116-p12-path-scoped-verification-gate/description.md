# Feature: Path-scoped verification gate (P12)

Slug: 261116-p12-path-scoped-verification-gate

Sources: accepted
[ADR-0071](../../decisions/0071-path-scoped-verification-gate.md) with owner
choices TG-1 ("CI and local") and TG-3 ("No schedule"), and package P12 of
the [plugin rework plan](../261116-standalone-plugin-rework/plan.md). P11
([ADR-0070](../../decisions/0070-orchestrator-owned-instruction-copy.md)) is
in commit `12f5e15`.

## Overview

A change waits for the checks that what it touches can break. Every path has
one of three scopes, `documents`, `plugin` or `full`, taken from listed
roots, and a change set has the widest scope of its paths. One repository
command, `npm run check`, computes the change set and its scope, prints them
and runs that scope's checks. The three CI lanes do the same for every pull
request, with the scope rules of the base revision. Only a full-scope lane
runs the literal `npm run release:check` and records release evidence;
publication is unchanged.

Primary flow: a contributor adds a decision record and its
`publication-policy.json` entry. `npm run check` prints
`Verification scope: documents`, builds the distribution, runs the build
check, release validation, the publication check on a copy that includes the
uncommitted record, and the documents suite, and exits 0. The pull request's
three lanes run the same checks, record no release evidence and name the
scope in their job summaries.

Key constraint: a change that can reach orchestrator behaviour still runs
every test. A path no rule names, an empty change set and a change set that
cannot be computed are full scope.

Non-goals:

- No change to the checks that make up `npm run verify` and
  `npm run release:check`, to the publish workflow, the lanes' Node versions
  and images, the live compatibility job, or the release validator's version
  rule for hook changes.
- No scheduled complete run (TG-3).
- No test selection from an import graph.
- No move of a test or a release-validator check that pins plugin text. A
  plugin text change that needs one of them changed is full scope.
- No branch protection and no change to the merge rule's owner.
- No change to any plugin file and no version change.

## Functional Requirements

### Scope rules

- **FR1.** Every repository-relative path has exactly one scope, from the
  first rule that names it:
  1. `full` for `packages/orchestrator/` and everything below it;
     `plugins/banzai/hooks/`, `plugins/banzai/lib/`,
     `plugins/banzai/contracts/`, `plugins/banzai/.claude-plugin/` and
     `plugins/banzai/.codex-plugin/` and everything below them; root
     `package.json` and `package-lock.json`; root `marketplace.json` and
     `.agents/plugins/marketplace.json`; `.github/` and everything below it;
     root `release-policy.json`;
  2. `plugin` for every other path below `plugins/banzai/`;
  3. `documents` for `documentation/` and everything below it, every file
     directly in the repository root whose name ends in `.md`, and root
     `publication-policy.json`;
  4. `full` for every other path.
- **FR2.** Each rule has one label, printed with each deciding path:
  `orchestrator package`, `plugin hook`, `plugin library`,
  `plugin contract`, `plugin manifest`, `root package file`,
  `release-train version file`, `workflow`, `release policy`,
  `plugin file`, `documentation`, `root Markdown`, `publication policy` and,
  for rule 4, `no scope rule`.
- **FR3.** Every path that the successor instruction baseline
  `packages/orchestrator/instruction-baseline.json` pins and every path that
  `release-policy.json` names as the release-train version authority or one
  of its mirrors has the `full` scope. A test checks both against the
  current files.
- **FR4.** A change set's scope is the widest scope of its paths, in the
  order `full`, `plugin`, `documents`. Its deciding paths are its paths whose
  scope equals the change set's scope.
- **FR5.** The scope rules and the two suite lists are repository code under
  `packages/orchestrator/` with tests. No workflow file contains a path
  rule.

### Change set

- **FR6.** In CI the change set of a pull request is every path that
  differs between the checked-out merge commit and its first parent.
- **FR7.** Locally the change set is every path that differs between the
  working tree and `HEAD`, plus every untracked file that Git does not
  ignore. `npm run check -- --base <revision>` compares with `<revision>`
  instead of `HEAD`.
- **FR8.** A renamed or moved file contributes its old and its new path. A
  deleted file and a file whose mode alone changed contribute their path.
- **FR9.** An empty change set has the `full` scope with the reason
  `the change set is empty`. A change set that cannot be computed, for
  example outside a Git repository, with an unknown base revision, without a
  first parent or after a failed Git command, has the `full` scope with the
  reason `the change set could not be computed`.

### Checks of each scope

- **FR10.** The `documents` scope runs these checks in this order and stops
  at the first failure: `distribution-build` (`npm run build:dist`),
  `build-check` (`npm run build:check`), `release-validation`
  (`npm run release:validate`), `publication` (the publication check of
  `npm run publication:check`, on the copy of FR20) and `suite` (the
  documents suite).
- **FR11.** The `plugin` scope runs the checks of FR10, and its `suite`
  check runs every file of the documents suite and of the plugin suite once.
- **FR12.** The `full` scope runs `distribution-build` and then `verify`
  (`npm run verify`) locally, and the literal `npm run release:check` in CI
  (FR25).
- **FR13.** The checks of each narrow scope pass on a checkout without a
  built distribution.

### Suites

- **FR14.** The documents suite lists every test file under
  `packages/orchestrator/test/` that reads a `documents` path, and the
  plugin suite every one that reads a `plugin` path. A suite may list more
  files.
- **FR15.** A test file reads a path when its source, or the source of a
  test-local module it imports directly or through other test-local
  modules, names a location outside `packages/orchestrator/`: a string that
  leaves that directory when read relative to it, where the tests run, or a
  relative import that leaves it. A name of a file or directory reads every
  scope that has a path at, inside or around it; a name of the repository
  root, or of a location above it, reads every scope.
- **FR16.** The membership test fails when a test file reads a path of a
  narrow scope and that scope's suite does not list it, and when a suite
  lists a file that does not exist. Its message names each such test file
  and the suite.

### Local command

- **FR17.** `npm run check` computes the local change set (FR7) and its scope
  with the scope rules of the working tree, prints its report (FR19) and
  runs that scope's checks.
- **FR18.** The command's option is `--base <revision>`, where a revision
  is any commit or tree Git accepts. It also accepts the two test options
  that the repository's release tools share, `--root <directory>` and
  `--fixture-components <file>`. Any other argument, a missing value, or a
  value that is empty or starts with `-` stops the command before any check
  with `INVALID_CHECK_OPTION: <detail>` on stderr and exit code 1. No option
  selects or narrows the scope.
- **FR19.** The report goes to stdout. Its first line is
  `Verification scope: <scope>`. Then comes either `Deciding paths:`
  followed by one line per deciding path in byte order,
  `  <path> (<label>)`, or `Reason: <reason>` for the cases of FR9 and
  FR23. Each `<path>` is written as a JSON string. After 50 path lines one
  line `  and <n> more` ends the list.
- **FR20.** The `publication` check runs on a new temporary copy of the
  working tree's tracked and untracked non-ignored files and of the built
  distribution, with its own Git repository and index. It therefore
  inspects an uncommitted new file. It creates no object, index entry or
  ref in the checkout and changes none of its files. A listed name that is
  absolute or has a `..` segment stops the check; a link is copied as a
  link. The command removes the copy after success and after failure, and
  removes no other directory.
- **FR21.** Before each check the command prints `check: <name>`. When all
  checks pass its last line is `check passed (<scope> scope)` and it exits
  0. When a check exits non-zero, is interrupted or cannot start, it prints
  `CHECK_FAILED: <name> <detail>` to stderr, runs no later check and exits
  1.

### CI lanes

- **FR22.** `.github/workflows/ci.yml` keeps the jobs
  `release_check_node_22`, `release_check_node_24` and
  `release_check_node_26` with their runner and images, runs them for every
  pull request and on manual dispatch, and keeps the live job unchanged.
- **FR23.** Each lane checks out the commit under test with its first
  parent and computes its scope before any check, with the scope rules of
  that first parent, read from Git, not the rules in the checked-out tree.
  When the first parent has no scope rules, the scope is `full` with the
  reason `the base revision has no scope rules`, whatever the event.
  Otherwise, on manual dispatch the scope is `full` with the reason
  `manual dispatch runs the complete check`.
- **FR24.** Each lane appends to its job summary a heading
  `## Verification scope: <scope>` and a fenced `text` block with the lines
  of FR19 that follow the first. The step output carries only the scope.
- **FR25.** A `full` lane runs the literal `npm run release:check`, then
  records release evidence and uploads it, all three steps under one
  condition. A `documents` or `plugin` lane runs none of these three steps
  and runs its scope's checks instead. Exactly one branch runs in every
  lane; a missing or unknown scope value runs the `full` branch.
- **FR26.** The publish workflow is unchanged. For a tag whose pull request
  ran a narrower scope, its evidence check reports the evidence as not
  bound and every supported lane runs the complete check on the tag before
  any registry call.

### Release validator

- **FR27.** Release validation accepts exactly the lane layout of
  FR22–FR25 and fails with `CI_POLICY_DRIFT` for any other lane text,
  including a lane whose evidence or upload step has a condition other than
  that of its `release:check` step, and a lane whose narrow branch records
  or uploads evidence.
- **FR28.** The validator's other CI and publish checks keep their codes and
  meaning.

### Documents

- **FR29.** The maintained documents state the new facts: the manifest's
  commands, CI and required final suite (sections 2 and 8), the contributor
  guide, the release checklist (a green lane may be a narrow scope, the
  person who merges reads the scope in the job summary, and a merge without
  evidence makes publication run the complete check), the CLI reference's
  repository release section, the module reference's release scripts, and
  the implementation state of ADR-0071 in its record, in the decision log
  and in the manifest's index.

## User Stories & Acceptance Criteria

- **AC1 (FR1, FR4, FR10).** Given a change set of
  `documentation/decisions/0072-example.md` alone, when the scope is
  computed, then it is `documents`, and the checks are those of FR10 with
  the documents suite as the only tests. (ADR-0071 item 1.)
- **AC2 (FR1, FR11).** Given a change set that adds
  `plugins/banzai/skills/example/SKILL.md`, then the scope is `plugin` and
  the `suite` check runs the plugin suite with the documents suite. (Item 2.)
- **AC3 (FR1, FR3).** Given a change set of any one of
  `packages/orchestrator/src/cli.ts`, `plugins/banzai/hooks/spec-gate.cjs`,
  `plugins/banzai/lib/work-documents.mjs`,
  `plugins/banzai/contracts/contract.json`, either plugin manifest,
  `package.json`, `package-lock.json`, `marketplace.json`,
  `.agents/plugins/marketplace.json`, `.github/workflows/ci.yml`,
  `release-policy.json` or the scope rules, then the scope is `full`. Given
  every path the successor baseline pins and every version path of
  `release-policy.json`, then each is `full`. (Item 3.)
- **AC4 (FR1).** Given `packages/orchestrator/MODULES.md`, then the scope is
  `full`. (Item 4.)
- **AC5 (FR1).** Given a new decision record with its
  `publication-policy.json` entry, then the scope is `documents`. (Item 5.)
- **AC6 (FR8).** Given a file moved from `packages/orchestrator/` into
  `documentation/`, or a deleted orchestrator file, then the scope is
  `full`. (Item 6.)
- **AC7 (FR1, FR9, FR19).** Given `assets/logo/example.svg`, then the scope
  is `full` and its line ends in `(no scope rule)`. Given no changed path,
  then the report is `Verification scope: full` and
  `Reason: the change set is empty`. Given a directory that is not a Git
  repository or an unknown `--base` revision, then the scope is `full` with
  `Reason: the change set could not be computed`. (Item 7.)
- **AC8 (FR4).** Given a decision record and a skill, then the scope is
  `plugin`; given a decision record and an orchestrator source, then it is
  `full`. (Item 8.)
- **AC9 (FR13).** Given a disposable copy of the repository without
  `packages/orchestrator/dist/`, when `npm run check` runs there for a
  documents change and for a plugin change, then both pass. (Item 9.)
- **AC10 (FR14–FR16).** Given a test file that names
  `../../documentation/decisions/README.md` and is not in the documents
  suite, when the membership test runs, then it fails and names that file
  and the documents suite. Given a test file that imports a test-local module
  naming `../../plugins/banzai/skills`, then the plugin suite must list the
  test file. Given the repository's test files and suites, then it passes.
  (Item 10.)
- **AC11 (FR17–FR21).** Given an uncommitted new decision record without a
  `publication-policy.json` entry, when `npm run check` runs, then it prints
  the record as a deciding path, prints `check: publication`, fails with a
  `PUBLICATION_UNCLASSIFIED` diagnostic and
  `CHECK_FAILED: publication`, runs no `suite` check and exits 1; afterwards
  the checkout's index and object count are unchanged and no copy remains.
  Given the entry, then it exits 0 with `check passed (documents scope)`.
  Given `--scope documents` or `--base -x`, then it exits 1 with
  `INVALID_CHECK_OPTION` before any check. Given `--base` naming a tree,
  then the change set is the working tree's difference from that tree.
  (Item 11.)
- **AC12 (FR5, FR23).** Given a merge commit whose first parent's rules
  name `documentation/` as `documents` and whose own rules name every path
  `documents`, with a changed rules file, when the lane's scope step runs,
  then the scope is `full`. Given a first parent without scope rules, then
  the scope is `full` with `Reason: the base revision has no scope rules`.
  (Item 12.)
- **AC13 (FR24, FR25).** Given a pull request that changes only a decision
  record, when its lanes finish, then each ran the documents checks,
  recorded and uploaded no evidence, and its job summary shows
  `## Verification scope: documents`. Given a pull request that changes an
  orchestrator source, then each lane ran `npm run release:check` and
  uploaded its evidence as before. (Item 13.)
- **AC14 (FR23, FR25).** Given a manual dispatch of a commit whose first
  parent has scope rules, then each lane runs the `full` branch with
  `Reason: manual dispatch runs the complete check`. (Item 14.)
- **AC15 (FR26).** Given a successful pull-request run whose lanes uploaded
  no evidence, when the publish workflow checks the merged tag, then it
  reports `Release evidence not bound` and its fallback lanes run
  `npm run release:check` before the publishing job. (Item 15.)
- **AC16 (FR27, FR28).** Given the new workflow, then release validation
  passes. Given a lane whose evidence step runs without the full-scope
  condition, or whose narrow branch uploads evidence, then it fails with
  `CI_POLICY_DRIFT`. (Item 16.)
- **AC17 (FR24, FR19).** Given a changed file whose name contains a newline
  and a backtick, then the job summary keeps the heading as its only
  heading, and the name appears on one line as a JSON string inside the
  fenced block.
- **AC18 (FR29).** Given the updated documents, then
  `npm run release:validate` passes and each document states the facts of
  FR29.

## Platform Specifics

- Node.js `>=22.20.0 <23 || >=24.11.1 <25 || >=26.13.0 <27` on macOS or
  Linux, Git as an external tool.
- Repository tools are builtin-only ESM under
  `packages/orchestrator/scripts/`. A lane runs the base revision's rules
  from a file outside the checkout, so the rules import nothing but Node
  built-ins.
- GitHub Actions checks out a pull request's merge commit; the lanes' images
  provide Git and a POSIX shell.
- Every test lives under `packages/orchestrator/test/` and runs with the
  package directory as its working directory.
- Output, documents and reports are English.

## Security Exposure

- Class 1, untrusted input reaching a renderer or a file path: in CI, file
  names chosen by a pull request reach the job summary's Markdown and the
  temporary copy's paths. FR19 and FR24 write each name as a JSON string
  inside a fenced block below the scope heading, and the step output
  carries only the scope; FR20 refuses absolute and `..` names and copies
  links as links; FR18 refuses a `--base` value that Git could read as an
  option.
- Class 7, deletion: the command removes the temporary copy it created and
  nothing else (FR20).

## Architecture Decision Needs

None. ADR-0071 is Accepted and decides the scopes and their roots, the
change set, each scope's checks, suite membership, the local command, the
lanes' behaviour, evidence, base-revision classification and the absence of
a scheduled run. The command's name, its output and the lane's step layout
are local, reversible choices recorded below or left to the plan.

## Resolved Assumptions

1. The local command is `npm run check`; `npm run verify` stays the full
   scope's command and stays valid for any change. ADR-0071 section 3 names
   no command. `Sensible default`.
2. The version files are those `release-policy.json` names; the two plugin
   manifests are the only files in `.claude-plugin/` and `.codex-plugin/`
   below `plugins/banzai/`, so those directories are named whole.
   `Manifest convention`.
3. `plugins/banzai/scripts/verification.cjs`, plugin documentation,
   templates and `plugins/banzai/.claude/settings.json` are `plugin` scope;
   ADR-0071 section 1 names the verification helper and plugin
   documentation there. `User-confirmed` (accepted ADR).
4. `documentation/verification-examples.md`, from which the build generates
   `src/init-resources.ts`, stays `documents` scope: the build check of every
   narrow scope reports the generated source as stale, and the regenerated
   source is `full`. `Sensible default`.
5. Checks run in a fixed order and stop at the first failure, as
   `npm run release:check` does. `Manifest convention`.
6. The plugin scope runs both suites in one test run. `Sensible default`.
7. Membership follows the names a test's source contains (ADR-0071, Risks).
   The runner also reads the ten required skills of a resolved plugin
   directory from source code that no test names; release validation, which
   every narrow scope runs, fails when such a skill is missing or loses its
   frontmatter. `User-confirmed` (accepted ADR), with this evidence.
8. Tests and validator checks that pin plugin text stay where they are.
   P11 left that move to this package (its assumption 7); ADR-0071 places
   all tests and the validator in the `full` scope and decides no move.
   `Sensible default`.
9. A lane checks out the merge commit with its parents only. The clone stays
   shallow, so the validator's version rule for hook changes stays skipped
   in CI, as today. `Sensible default`.
10. ADR-0071's index row stays `Planned` until a hosted pull-request run
    shows AC13 and AC14; a narrow lane can first run after this change
    reaches the base branch. `Manifest convention` (index rule for
    outstanding confirmation).
11. No version change. The owner decides the version at release.
    `Manifest convention`.

## Open Questions & Risks

None outstanding.
