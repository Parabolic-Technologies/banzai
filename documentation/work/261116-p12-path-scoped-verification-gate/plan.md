# Development Plan: Path-scoped verification gate (P12)

Slug: 261116-p12-path-scoped-verification-gate

- Description: [description.md](description.md)
- Program input: package P12 of the
  [plugin rework plan](../261116-standalone-plugin-rework/plan.md)
- Accepted ADRs this plan relies on:
  - [ADR-0071](../../decisions/0071-path-scoped-verification-gate.md), the
    authority for the package, with owner choices TG-1 and TG-3;
  - [ADR-0053](../../decisions/0053-single-pull-request-ci-gate-and-publish-evidence-reuse.md),
    [ADR-0067](../../decisions/0067-node-26-supported-release-lane.md),
    [ADR-0056](../../decisions/0056-ci-built-orchestrator-distribution.md)
    and
    [ADR-0010](../../decisions/0010-blocking-and-advisory-release-evidence.md),
    as amended by ADR-0071;
  - [ADR-0043](../../decisions/0043-proportionate-verification-evidence.md),
    renames counted on both sides;
  - [ADR-0070](../../decisions/0070-orchestrator-owned-instruction-copy.md),
    whose successor baseline names paths that stay full scope;
  - [ADR-0039](../../decisions/0039-npm-trusted-publishing-on-github-release.md),
    [ADR-0041](../../decisions/0041-artifact-retention-and-publication-boundary.md)
    and
    [ADR-0033](../../decisions/0033-root-package-version-authority.md),
    preserved.
- Manifest facts used: section 2 (commands, the CI and publish workflows),
  section 8 (required final suite), section 10 (the index rule for
  outstanding confirmation and the ADR-0071 row).

## Plan Authority

Applicable approved requirements, accepted ADR constraints, public and persisted
contracts, security and authorization boundaries, transaction and lifecycle
guarantees, compatibility, scope, and required verification evidence are binding.
Exact internal details remain binding when required by applicable authority or
concrete constraints; unlabelled explicit directives remain binding.

Only paragraphs or list items prefixed `Optional implementation guidance:` are
non-binding suggestions. A label covers that paragraph or list item, including
its nested content, and ends before the next sibling block. A different compliant
implementation within approved scope needs no reapproval, finding or deviation
report merely for differing from this guidance.

Guidance never overrides binding authority or expands scope. Resolve conflicts
and ambiguous commitments before dependent work; missing or ambiguous optionality
does not waive an explicit commitment.

## Human prerequisites

Nothing blocks implementation. Owner-only actions follow the package:

- Commit by hand. The first pull request that carries this change runs the
  complete check on all three lanes, because its base revision has no scope
  rules.
- After the change reaches the base branch, confirm compliance items 13 and
  14 on hosted runs: a pull request that changes only a decision record, one
  that changes an orchestrator source, and a manual dispatch. Until then
  ADR-0071 stays `Planned` (description assumption 10).
- Merge with the scope in view. With no branch protection, the person who
  merges reads `## Verification scope: <scope>` in the lanes' job summaries.
- Decide the version at release. This package changes no hook file and no
  file under `plugins/banzai/lib/`, so the release validator's version rule
  is not triggered by it.

## Technical Breakdown

### Current and target state

Current: each of the three lanes in `.github/workflows/ci.yml` checks out one
commit, runs `npm ci` and `npm run release:check`, and records and uploads
release evidence, for every pull request and manual dispatch.
`scripts/check-release.mjs` pins each lane as whole text
(`ciLaneDefinition`). The local required final suite is `npm run verify`. No
code classifies paths.

Target: the description's FR1–FR29. Paths below are relative to the
repository root unless they start with `scripts/` or `test/`, which are
relative to `packages/orchestrator/`.

### 1. Scope rules, change sets and the CI entry (structural assessment)

Recorded under the Engineering Quality structural assessment triggers.

- Trigger: an independently changing responsibility, the verification scope,
  with a lifecycle of its own: a lane executes the base revision's copy of it,
  alone, from a file outside the checkout.
- Container and source evidence: builtin-only release tools live in
  `scripts/` (`release-check.mjs`, `release-candidate-check.mjs`,
  `check-release.mjs`, `release-evidence.mjs`). `changedRepositoryPaths` in
  `src/git.ts` lists a working tree's changed paths for the CLI.
- Reuse search: `packages/orchestrator/scripts/`,
  `packages/orchestrator/src/` and `plugins/banzai/lib/`, by path
  classification and changed-path computation. No owner classifies paths into
  verification scopes. `changedRepositoryPaths` near-duplicates the local
  change set, but it belongs to the frozen CLI bundle, also compares the
  index, and takes no base revision; the lane's lifecycle requires one
  builtin-only file, so the scope module cannot import it, and the CLI's
  meaning of changed paths keeps serving its own phase checks. The
  enumerations in `release-candidate-check.mjs` and `publication-check.mjs`
  list files, not differences.
- Owner and disposition: `extracted` into a new module,
  `scripts/verification-scope.mjs`. `changedRepositoryPaths` is `retained`
  unchanged.
- Dependency direction: the module imports only Node built-ins and nothing
  from the repository. The local command (section 4) and the tests import
  it; nothing under `src/` imports it.
- Invariants:
  1. One table in this module owns the rules of FR1 in their order and the
     labels of FR2. Every consumer classifies through it. No other file,
     the workflow included, contains a path rule (FR5).
  2. Classification is total and literal. A path as Git prints it,
     `/`-separated and repository-relative, matches a directory rule by
     whole segments, so `documentationx/a.md` and a file named
     `documentation` match no `documentation/` rule. Root Markdown is a
     name without `/` that ends in `.md`. Every other path is `full` with
     `no scope rule`.
  3. The local change set compares the working tree with the base revision,
     `HEAD` by default or any commit or tree named by `--base`, and adds the
     untracked files Git does not ignore. The CI change set compares `HEAD`
     with `HEAD^1`. Both read NUL-separated names with renames as two paths
     and pass every value to Git as one argument, never through a shell. A
     failed Git command, an unknown base and a missing parent give the
     reason of FR9.
  4. The scope order and the deciding paths follow FR4. The report follows
     FR19, with paths ordered by their UTF-8 bytes.
  5. Executed as `node <file> --ci`, the module reads `GITHUB_EVENT_NAME`,
     `GITHUB_OUTPUT` and `GITHUB_STEP_SUMMARY` and works from the current
     directory. For `workflow_dispatch` it reports the dispatch reason of
     FR23 without computing a change set. It prints the report to the step
     log, appends the summary of FR24, and appends the single line
     `scope=<scope>` to the output file; no file name reaches the output. A
     missing variable or a failed write exits non-zero, so the lane fails
     and runs no check.
  6. The `--ci` command line and its three variables are a compatibility
     surface between a change's workflow and its base revision's module. A
     change to them needs a module that accepts the old and the new form
     first.
- Verification: the tests of T001; lint with no new complexity warning in
  the module.
- Remaining debt: none.
- Authority: within scope of ADR-0071 sections 1, 2, 4 and 5.

### 2. Suites and their membership test

`scripts/verification-suites.mjs` exports the documents suite and the plugin
suite as sorted lists of test-root-relative `.test.ts` paths. A census on
2026-11-16 under the reading below gives:

- documents suite: `committed-smoke`, `instruction-layouts`,
  `project-adoption`, `publication`, `release-validation`, `setup-pty`,
  `version-set` and `workflow-skills`;
- plugin suite: `doctor`, `phase-instructions`, `setup-client`,
  `task-verification-rounds`, `task-verification` and `workflow-project`.

The census is the expected start; the membership test decides the lists.

The membership test, `test/verification-suites.test.ts`, reads FR15 this
way:

1. Sources: every `.test.ts` file under `test/`, and every file under `test/`
   that one of them imports, directly or through other such files, by a
   relative import or export specifier, static or dynamic.
2. Named locations in a source:
   - a relative import or export specifier, resolved against the importing
     file's directory;
   - every other string literal, single-quoted, double-quoted or template,
     that does not start with `/`, resolved against
     `packages/orchestrator/`; for a template literal, its text before the
     first substitution, cut back to its last `/`;
   - a run of such string literals separated only by commas, as in
     `path.join("..", "..", "documentation")`, joined with `/` and resolved
     against `packages/orchestrator/`.

   A location counts when it lies outside `packages/orchestrator/` and is
   inside the repository, its root or an ancestor of its root. An absolute
   string such as `"/"` in `split("/")` names no location.
3. A location reads the scope it has as a path, the scope of every rule
   whose root is the location or lies inside it, and every scope when it is
   the repository root or an ancestor of it. So `plugins/banzai` reads
   `plugin` and `full`.
4. A test file reads the scopes of its own locations and of the files it
   imports under item 1.
5. The test fails for a test file that reads `documents` and is missing from
   the documents suite, a test file that reads `plugin` and is missing from
   the plugin suite, and a listed file that does not exist. Its message names
   each such test file and the suite.

The reading is a function of a test root and two suite lists, so its own
tests can apply it to temporary trees.

### 3. Shared release-tool helpers (structural assessment)

- Trigger: the new command near-duplicates two existing implementations: the
  child environment and component execution of `release-check.mjs`
  (`sanitizedEnvironment`, `runComponent`), and the disposable copy of
  `release-candidate-check.mjs` (`candidateFiles`, `copyCandidate`,
  `indexCandidate` and the temporary directory's lifecycle). The copy is a
  resource lifecycle that must behave like the existing one.
- Container and source evidence: the two scripts; `test/release-check.test.ts`
  and `test/release-candidate-check.test.ts`, whose fixture repositories copy
  `release-check.mjs`.
- Reuse search: in `packages/orchestrator/scripts/` those functions are the
  only owners of a credential-free child environment, of component execution
  and of a checkout copy with its own index. The process runners under
  `src/` belong to the frozen CLI bundle.
- Owner and disposition: `extracted` into two new modules under `scripts/`:
  one owns the child environment and the execution of one component, the
  other owns the copy. Dependency linking into a release candidate stays in
  `release-candidate-check.mjs`, its only user.
- Dependency direction: `release-check.mjs`, `release-candidate-check.mjs` and
  the new command import the modules. The modules import only Node built-ins.
- Invariants:
  1. One credential blocklist: every component of the release check and of
     the new command runs in the same credential-free environment.
  2. A component runs without a shell, with stdin ignored and output
     inherited. The module reports its exit code, its signal or its failure
     to start; each caller words its own diagnostics.
  3. One copy implementation: enumeration of tracked and untracked
     non-ignored files, refusal of absolute and `..` names, links copied as
     links, refusal of other non-regular files, a Git repository of its own
     whose index holds exactly the enumerated names, no commit, and removal
     of the copy and of the pathspec file beside it after success and
     failure. No mutating Git command runs in the source checkout.
  4. `release-check.mjs` and `release-candidate-check.mjs` keep every output
     line, code, message, exit status and step order, including an
     interrupted component reported as
     `RELEASE_COMPONENT_FAILED: <name> could not complete`.
- Verification: the unchanged expectations of `test/release-check.test.ts`
  and `test/release-candidate-check.test.ts`; the tests of T004.
- Remaining debt: none.
- Authority: within scope of ADR-0071 section 3. The components of
  `npm run release:check` are unchanged.

### 4. The local command

`npm run check` runs `node packages/orchestrator/scripts/scoped-check.mjs`.

- Options follow FR18. `--root <directory>` names the repository whose
  working tree is inspected and where the checks run, by default the
  repository that contains the script. `--fixture-components <file>` names
  a JSON array of `{ "name", "command", "args" }` with exactly one entry for
  each of `distribution-build`, `build-check`, `release-validation`,
  `publication`, `suite` and `verify`. It is read and validated before any
  check and replaces only each check's command and arguments: which checks
  run, their order, where they run and the scope stay the command's own.
- The scope comes from section 1 with the rules of the module beside the
  command. The command prints the report of FR19, then the checks:
  - `documents`: `distribution-build`, `build-check`, `release-validation`,
    `publication`, `suite` with the documents suite;
  - `plugin`: the same, with every file of both suites once;
  - `full`: `distribution-build`, then `verify`.
- The checks run `npm run build:dist`, `npm run build:check`,
  `npm run release:validate` and `npm run verify` in the repository root,
  the test driver `scripts/test.mjs` with one `--file` per suite file, and
  `scripts/publication-release.mjs` with the copy as its working directory.
  All run in the environment of section 3.
- The copy for `publication` is the copy of section 3 plus the ignored
  `packages/orchestrator/dist/`, copied but not indexed.
- Output follows FR21. SIGINT or SIGTERM stops the running check, removes
  the copy, prints `CHECK_FAILED: <name> was interrupted` and exits 1. An
  unexpected failure exits 1 with a one-line diagnostic and is never
  reported as passed.

The narrow branch of a lane runs `npm run check -- --base HEAD^1`. The lane
took that branch because the base revision's rules found no full-scope path
in the change, so the scope rules and this command are the base revision's
bytes. The command's change set contains the lane's change set, so it
computes the same scope or a wider one, never a narrower one.

### 5. CI lanes and release validation

The exact text of `release_check_node_22` follows. `release_check_node_24`
and `release_check_node_26` differ only in the job name and the container
image of `release-policy.json`. The triggers, permissions, concurrency and
the live job do not change.

~~~yaml
  release_check_node_22:
    runs-on: ubuntu-24.04
    container: node:22.20.0-bookworm
    steps:
      - uses: actions/checkout@v6
        with:
          persist-credentials: false
          fetch-depth: 2
      - run: git --version
      - run: python3 --version
      - run: git config --global --add safe.directory "$GITHUB_WORKSPACE"
      - id: scope
        run: |
          if git show HEAD^1:packages/orchestrator/scripts/verification-scope.mjs > "$RUNNER_TEMP/verification-scope.mjs"; then
            node "$RUNNER_TEMP/verification-scope.mjs" --ci
          else
            echo "scope=full" >> "$GITHUB_OUTPUT"
            printf '%s\n' '## Verification scope: full' '' '```text' 'Reason: the base revision has no scope rules' '```' | tee -a "$GITHUB_STEP_SUMMARY"
          fi
      - run: npm ci
      - run: npm run release:check
        if: steps.scope.outputs.scope != 'documents' && steps.scope.outputs.scope != 'plugin'
      - id: release_evidence
        if: steps.scope.outputs.scope != 'documents' && steps.scope.outputs.scope != 'plugin'
        run: node packages/orchestrator/scripts/release-evidence.mjs record
      - uses: actions/upload-artifact@v7
        if: steps.scope.outputs.scope != 'documents' && steps.scope.outputs.scope != 'plugin'
        with:
          name: ${{ steps.release_evidence.outputs.name }}
          path: ${{ steps.release_evidence.outputs.path }}
          if-no-files-found: error
          retention-days: 30
      - run: npm run check -- --base HEAD^1
        if: steps.scope.outputs.scope == 'documents' || steps.scope.outputs.scope == 'plugin'
~~~

Properties the text carries:

- The checkout keeps the merge commit's parents and stays shallow, so the
  validator's version rule for hook changes stays skipped in CI.
- The scope step runs before any check and executes the first parent's
  module, never the checked-out one. Without that module it writes the
  bootstrap reason itself, whatever the event (FR23).
- The full and the narrow conditions are complements, so exactly one branch
  runs, and a missing or unknown scope runs the full branch. A step-level
  condition implies success of the earlier steps, so a failed scope step or
  `npm ci` runs neither branch and fails the lane.
- The `run` scripts contain no `${{ }}` expression.
- No step's text contains a word the vendor-boundary check refuses.

`ciLaneDefinition(lane)` returns this text. The specific checks that run
before the whole-text comparison keep their codes, labels and order, and
their expected fragments are still present in it.

`.github/workflows/publish.yml` and `scripts/release-evidence.mjs` are
unchanged. A merged tag whose lanes uploaded no evidence fails binding with
`holds no release evidence`, which `verify` reports as
`Release evidence not bound` with `bound=false`, so every supported lane
runs `npm run release:check` on the tag before the publishing job (FR26).

### 6. Security enforcement points

- Class 1, the job summary: the CI entry of section 1 (invariant 5). Each
  name is a JSON string on a line that begins with two spaces, inside the
  fenced block under the fixed heading, so a name cannot add a line, close
  the fence or add a heading. The output carries only the scope word, and
  the lane's scripts interpolate no expression.
- Class 1, the copy's paths: the copy module of section 3 (invariant 3).
- Class 1, `--base`: the option parser of `scripts/scoped-check.mjs` refuses
  an empty value and a value that starts with `-`, and Git receives the
  value as one argument (section 1, invariant 3).
- Class 7, deletion: the copy module removes only the directory it created
  under the system temporary directory and the pathspec file beside it.

### 7. Documentation and manifest

Facts that become stale:

- `PROJECT_MANIFEST.md` section 2: a bullet for `npm run check`; the CI
  bullet (each lane computes its scope with the base revision's rules, a
  full lane runs `release:check` and records evidence, a narrow lane runs
  its scope's checks and records none, the job summary names the scope,
  manual dispatch runs the complete check); the publish bullet notes that
  merges without evidence take the fallback. Section 8: the required final
  suite is `npm run check`, the checks of the change's scope, with
  `npm run verify` still valid for any change, and release work still
  requires a fresh `npm run release:check`. Section 10: the ADR-0071 row
  stays `Planned`.
- `CONTRIBUTING.md`: step 4 of the pull-request steps, the local gate
  section and the paragraph on the hosted workflow.
- `documentation/release-checklist.md`: a green lane may be a narrow scope,
  the person who merges reads the scope in the job summary, and a merge
  without evidence makes publication run the complete check.
- `documentation/orchestrator.md`, section Repository Release Confidence.
- `packages/orchestrator/MODULES.md`, the release scripts: the new modules,
  the compatibility surface of section 1 invariant 6.
- ADR-0071's implementation-state line and its row in
  `documentation/decisions/README.md`.

## Implementation Tasks

- [ ] **T001 - Scope rules, change sets and the CI entry**

  Behavior: FR1–FR9, FR19, and the scope side of FR23 and FR24.

  Files: `scripts/verification-scope.mjs` and its declaration file,
  `test/verification-scope.test.ts`.

  Binding constraints:

  - The six invariants of Technical Breakdown section 1 hold.
  - The rules, labels, reasons, report lines, summary heading and output
    line are exactly those of the description.
  - The module runs as a lone copy outside the repository.

  Depends on: none. Maps to: FR1–FR9, FR19, FR23, FR24, AC1–AC8 (scope
  part), AC12 (module part), AC14 (reason), AC17; ADR-0071 sections 1, 2
  and 5 and compliance items 1–8.

  Evidence, in `test/verification-scope.test.ts`:

  - every label of FR2 with a representative path; whole-segment negatives;
    root and nested Markdown; the change sets of AC1–AC8;
  - every path that `packages/orchestrator/instruction-baseline.json` pins
    (the part of each pinned key before `#`) and every version path of
    `release-policy.json`, read from the current files, is `full` (FR3);
  - local change sets in temporary repositories: a tracked edit, a staged
    new file, an untracked file, an ignored file that does not count, a
    deletion, a rename with both paths, a mode change, `--base` naming a
    commit and a tree, an unknown base, a directory that is not a
    repository, and an empty change set;
  - the CI change set of a merge commit against its first parent, and a
    commit without a parent;
  - the report's byte order, JSON strings, the cap of 50 with
    `  and <n> more`, and both reasons of FR9;
  - AC17 with a real file whose name holds a newline and a backtick: the
    summary's heading is its only line that starts with `#`, the block has
    exactly two fence lines, and the name sits on one line as a JSON string;
  - the CI entry run from a copy of the module in a temporary directory:
    dispatch, the output file's single line, and a non-zero exit for a
    missing variable.

  Review batch: A.

- [ ] **T002 - Suites and the membership test**

  Behavior: FR14–FR16.

  Files: `scripts/verification-suites.mjs` and its declaration file,
  `test/verification-suites.test.ts`.

  Binding constraints:

  - The reading of Technical Breakdown section 2, with scopes from the
    module of T001.
  - The lists hold every test file the reading requires. A list may hold
    more, and the membership test lists itself where its own source
    requires it.

  Depends on: T001. Maps to: FR5 (suite lists), FR14–FR16, AC10; ADR-0071
  section 1 and compliance item 10.

  Evidence: the test passes on the repository. Applied to temporary test
  roots, it fails, naming the file and the documents suite, for a test that
  names `../../documentation/decisions/README.md` outside that suite;
  requires the plugin suite for a test that imports a test-local module
  naming `../../plugins/banzai/skills`; detects a template prefix and a
  comma-separated run; reads nothing for a relative import that stays inside
  the package or for an absolute string; and fails for a listed file that
  does not exist.

  Review batch: A.

- [ ] **T003 - Shared release-tool helpers**

  Behavior: no change to the release check or the release candidate check.

  Files: two new modules under `scripts/`, `scripts/release-check.mjs`,
  `scripts/release-candidate-check.mjs`,
  `test/release-candidate-check.test.ts`.

  Binding constraints:

  - The four invariants of Technical Breakdown section 3 hold.
  - The tests of both scripts pass with unchanged expectations. The
    candidate test's fixture repositories that copy `release-check.mjs`
    also copy the module it now imports.
  - The source-text test of the candidate check reads the module that now
    holds the Git calls and keeps its three assertions: no `commit`, `add`
    on the copy, and enumeration with `--cached --others --exclude-standard`.

  Depends on: none. Maps to: FR20 (copy), FR21 (execution); ADR-0071
  section 3 and "What does not change".

  Evidence: the two test files; lint.

  Review batch: B.

- [ ] **T004 - The local check command**

  Behavior: FR10–FR13 and FR17–FR21.

  Files: `scripts/scoped-check.mjs`, root `package.json` (the `check`
  script), `test/scoped-check.test.ts`, and a declaration file for any
  module a test imports.

  Unchanged paths: `package-lock.json`.

  Binding constraints:

  - Technical Breakdown section 4 holds, including its argument for the
    narrow branch.
  - No option selects or narrows the scope.
  - The command creates no object, index entry or ref in the inspected
    checkout and changes none of its files.

  Depends on: T001, T002, T003. Maps to: FR10–FR13, FR17–FR21, AC1, AC2,
  AC7 (report), AC9, AC11; ADR-0071 section 3 and compliance items 9
  and 11.

  Evidence, in `test/scoped-check.test.ts` with temporary repositories and
  fixture components:

  - the report and the `check:` lines for a documents, a plugin and a full
    change set; the suite substitute receives each suite file once;
  - a failing publication substitute gives `CHECK_FAILED: publication`, no
    `suite` check and exit 1, and so does one that cannot start;
  - the publication substitute runs in a copy that holds an untracked file,
    an index that lists it, a link as a link and the distribution; after
    success, after failure and after SIGTERM the copy is gone, and the
    checkout's index bytes and `git count-objects -v` are unchanged;
  - `--scope documents`, `--base -x`, `--base ""`, a missing value and an
    unknown argument give `INVALID_CHECK_OPTION` and exit 1 before any
    `check:` line;
  - a directory that is not a repository and an unknown base give the full
    scope and the reason of FR9;
  - on a merge commit, `--base HEAD^1` computes the scope the CI entry
    computes, for a documents and a plugin change.

  End-to-end evidence, recorded in the implementation report: in a
  disposable copy of the repository without `packages/orchestrator/dist/`,
  with installed dependencies and its own index, take a base with
  `git write-tree` and no commit, then run `npm run check -- --base <tree>`
  for (1) a new decision record with its `publication-policy.json` entry,
  which passes in the documents scope; (2) the same record without its
  entry, which fails as AC11 states with index and object count unchanged
  and no copy left; and (3) a new skill file with its entry, which passes in
  the plugin scope. Record commands, outputs and durations.

  Review batch: B.

- [ ] **T005 - Scoped CI lanes and release validation**

  Behavior: FR22–FR28.

  Files: `.github/workflows/ci.yml`, `scripts/check-release.mjs`,
  `test/release-validation.test.ts`, and a test of the lane's scope step,
  in `test/verification-scope.test.ts` or a new test file.

  Unchanged paths: `.github/workflows/publish.yml`, `release-policy.json`,
  `scripts/release-evidence.mjs`.

  Binding constraints:

  - The three lanes have exactly the text of Technical Breakdown section 5.
    The triggers, permissions, concurrency and live job of `ci.yml` keep
    their bytes.
  - Release validation accepts that text and fails with `CI_POLICY_DRIFT`
    for any other lane text. Its other CI and publish checks keep their
    codes and meaning.
  - The existing mutation tests keep their intent; a fragment the new text
    no longer contains is replaced by its counterpart in the new text.

  Depends on: T001, T004. Maps to: FR5 (workflow), FR22–FR28, AC12–AC16;
  ADR-0071 sections 4 and 5 and compliance items 12–16.

  Evidence:

  - release validation passes on the new workflow and fails with
    `CI_POLICY_DRIFT` for: an evidence or an upload step without the full
    condition or with another one; a `release:check` step without its
    condition; an evidence step under the narrow condition; a scope step
    that runs the checked-out module; a checkout without `fetch-depth: 2`;
    and overlapping conditions;
  - the scope step's script, taken from `.github/workflows/ci.yml`, run with
    `bash -e` in temporary repositories: a merge commit whose second parent
    replaces the module with one that calls every path `documents` and edits
    a document gives `full` with the module as deciding path (AC12); a first
    parent without the module gives the bootstrap reason (AC12); a dispatch
    gives the dispatch reason (AC14); a merge commit that changes only a
    decision record gives `documents` (AC13);
  - the existing release-evidence test of a run without evidence, which
    yields `Release evidence not bound` (AC15).

  Hosted confirmation of AC13 and AC14 is an owner follow-up (Human
  prerequisites).

  Review batch: C.

- [ ] **T006 - Documentation, manifest and final checks**

  Behavior: FR29 and the package reports.

  Files: `PROJECT_MANIFEST.md`, `CONTRIBUTING.md`,
  `documentation/release-checklist.md`, `documentation/orchestrator.md`,
  `packages/orchestrator/MODULES.md`,
  `documentation/decisions/0071-path-scoped-verification-gate.md` (the
  implementation-state line only), `documentation/decisions/README.md` (the
  ADR-0071 row only), any other maintained document that states a replaced
  fact, and the implementation-report and test-report roles of this work.

  Binding constraints, in this order:

  1. Run the focused tests of T001–T005.
  2. Update each stale fact of Technical Breakdown section 7. The manifest
     stays current-state only. A sentence that carries a fragment the
     release validator pins keeps that fragment.
  3. ADR-0071's implementation-state line and its decision-log row say that
     the source is implemented, with the date and a link to this work's
     implementation report, and that hosted confirmation of compliance items
     13 and 14 is outstanding. The manifest row stays `Planned`. No other
     byte of the ADR changes.
  4. Run Prettier on the changed files under `packages/orchestrator/`, then
     the mandatory check below and `git diff --check`, and fix every failure
     this package causes.
  5. Run no live vendor probe and no hosted workflow.

  The implementation report lists what changed and where, the tests added,
  the end-to-end evidence of T004, deviations and the owner follow-ups. The
  test report follows the Test Assurance policy.

  Depends on: T001–T005. Maps to: FR29, AC18; ADR-0071 required follow-ups.

  Evidence: the mandatory check below.

  Review batch: C.

## Task Verification Obligations

The one mandatory check is
`node packages/orchestrator/scripts/release-candidate-check.mjs` (manifest
section 2). It runs the complete `npm run release:check` (distribution
build, `verify`, the format check, release validation, the publication
check and the committed-bundle smoke) in a disposable copy of tracked and
untracked non-ignored files, so the uncommitted files of this package are
inside it, and it leaves the checkout unchanged. This package changes the
release tools and the CI layout that this gate pins, so the complete gate is
its final evidence; a separate `npm run verify` would repeat the suite the
gate already runs. The check runs fresh.

```banzai-verification-obligations/v2
{
  "schema": "banzai-verification-obligations/v2",
  "schemaVersion": 2,
  "complete": true,
  "planRemainderSha256": "2b7e66dde446c790ac6447d97d125290c339edeef9da517881dd28e72dbae1a6",
  "checks": [
    {
      "id": "release-candidate",
      "name": "Complete release gate in a disposable candidate",
      "requirementRefs": [
        "T001",
        "T002",
        "T003",
        "T004",
        "T005",
        "T006",
        "AC1",
        "AC2",
        "AC3",
        "AC4",
        "AC5",
        "AC6",
        "AC7",
        "AC8",
        "AC9",
        "AC10",
        "AC11",
        "AC12",
        "AC13",
        "AC14",
        "AC15",
        "AC16",
        "AC17",
        "AC18"
      ],
      "command": "node",
      "args": ["packages/orchestrator/scripts/release-candidate-check.mjs"],
      "cwd": ".",
      "timeoutMs": 3600000,
      "evidence": "fresh",
      "sources": [
        {
          "path": "package.json",
          "sha256": "d3e1f361a726fb354f62b2c3917e63548af15825216b3ffd4297dcce20fee0f4"
        },
        {
          "path": "packages/orchestrator/scripts/release-candidate-check.mjs",
          "sha256": "698a35eebd4a7d5abf992d3ddbbb973d0332d350119fd99e70df57adf33f7eeb"
        }
      ],
      "materialization": null
    }
  ],
  "absenceReason": null
}
```

## Consistency Check

Requirements to tasks:

| Requirements     | Tasks            |
| ---------------- | ---------------- |
| FR1–FR4, FR6–FR9 | T001             |
| FR5              | T001, T002, T005 |
| FR10–FR13        | T004             |
| FR14–FR16        | T002             |
| FR17, FR18       | T004             |
| FR19             | T001, T004       |
| FR20, FR21       | T003, T004       |
| FR22             | T005             |
| FR23, FR24       | T001, T005       |
| FR25–FR28        | T005             |
| FR29             | T006             |

Acceptance criteria to tasks: AC1, AC2 T001, T004; AC3–AC6, AC8 T001; AC7
T001, T004; AC9, AC11 T004; AC10 T002; AC12 T001, T005; AC13, AC14 T005
(hosted part: owner follow-up); AC15, AC16 T005; AC17 T001; AC18 T006.

ADR-0071 compliance items: 1–8 → T001 (with T004 for the checks of items 1
and 2); 9 and 11 → T004; 10 → T002; 12 → T001, T005; 13 and 14 → T005,
hosted confirmation by the owner; 15 and 16 → T005.

Other accepted constraints:

- ADR-0053: the publication gate and its evidence binding are unchanged
  paths of T005; its rule that every pull request runs the complete check
  is amended by ADR-0071.
- ADR-0067: three lanes with their jobs and images (T005).
- ADR-0056: the distribution build is the first check of every scope, in
  the command (T004) and in `release:check` (T005).
- ADR-0010: every supported lane runs the complete check before
  publication, through the unchanged fallback (T005).
- ADR-0043: renames count under both paths (T001).
- ADR-0070: the successor baseline's paths are full scope (T001, FR3).
- ADR-0039: the publish workflow is unchanged.
- ADR-0041: new files under `packages/orchestrator/` are neither
  documentation nor plugin resources, and this work's documents are exempt
  work documents; the publication step of the mandatory check confirms both.
- ADR-0033: no version field changes.

Proposed ADRs: none are unresolved; this plan creates no ADR.

Manifest transitions: the facts of Technical Breakdown section 7 (T006).
The ADR-0071 row stays `Planned` until hosted confirmation.

Security exposure of the plan: classes 1 and 7, as the description records,
with the enforcement points of Technical Breakdown section 6 (T001, T003,
T004, T005).

Engineering Quality constraints that apply: the structural assessments of
Technical Breakdown sections 1 and 3 (owners T001 and T003, evidence their
tests and lint); compatibility of the release check's and the candidate
check's output (owner T003, evidence their unchanged tests) and of the CI
entry across a base revision (section 1, invariant 6; owner T001, documented
in T006); bounded scope, with the unchanged paths named in T004 and T005.
