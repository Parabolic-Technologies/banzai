# ADR 0071: Path-Scoped Verification Gate

## Status / Date / Owner / Decision Makers

- Status: Accepted
- Date: 2026-11-16
- Owner: Banzai maintainers
- Decision makers: Repository owner; explicitly accepted in chat on 2026-11-16
  with `Accept both` (ADR-0070 and ADR-0071).
- Acceptance date: 2026-11-16
- Accepted proposal SHA-256: `f87c80c7f8a3dc491196fb9658dc047085c10e845808930fb6c43710a8d023de`.
- Lifecycle effect: the amendments in Lifecycle Links are accepted and their
  reciprocal links are recorded. The proposal-stage wording and the decision
  body are retained unchanged. Dependent planning is authorized; plan
  approval is still required before implementation.
- Owner choices given on 2026-11-16, before drafting, through closed
  questions:
  - TG-1, where the gate is scoped: "CI and local (Recommended)";
  - TG-2, text the orchestrator embeds: answered with a question that led to
    [ADR-0070](./0070-orchestrator-owned-instruction-copy.md) and "Yes,
    decouple". With that decision the card no longer applies;
  - TG-3, a scheduled complete run: "No schedule".

  This ADR records them as written.

- Review: one independent read-only review on 2026-11-16, requested by the
  owner with `Review them first`. It raised seven major and five minor
  findings. Each was checked against the sources and all are applied:
  - the hook, the contracts and the plugin manifests are full scope, so the
    hook packages of the plugin rework gain nothing from this decision;
  - every narrow scope builds the distribution first;
  - the scopes are lists of roots with a stated precedence, and
    `publication-policy.json` and the version files are classified;
  - the base of a change set is defined for CI and for the local check, and
    renames and deletions count on both sides;
  - CI classifies with the rules of the base revision;
  - release evidence is tied to the literal complete check;
  - the documents scope runs the tests that read documents;
  - the absence of branch protection is stated, and a lane reports its scope;
  - the amendments to ADR-0067 and ADR-0056 are declared.
- Implementation state: Planned. See the work plan.
- Preparation authority: the owner's question of 2026-11-16 whether the
  orchestrator's tests can be switched off while it is frozen, and the reply
  `Yes, draft it` to a proposed path-scoped gate. Preparing this proposal is
  not acceptance.

## Related Artifacts

- Work plan:
  [plan.md](../work/261116-standalone-plugin-rework/plan.md), package P12.
- [ADR-0070](./0070-orchestrator-owned-instruction-copy.md) (Proposed): this
  decision depends on it. Without it a plugin text change still makes an
  orchestrator source stale and falls to full scope through the build
  check: safe, with no saving.
- Code and measurements, as of 2.8.3 with ADR-0069 accepted:
  - every test of the repository lives under `packages/orchestrator/test/`,
    the tests of the plugin's hook, library and payload included;
  - `npm run verify` is typecheck, lint, every test and the build check;
    `npm run release:check` is the distribution build, `verify`, the format
    check, release validation, the publication check and the
    committed-bundle smoke. Typecheck, lint and format cover the
    orchestrator package only;
  - the build check, release validation and the publication check all need
    a built distribution;
  - `.github/workflows/ci.yml` runs the complete `release:check` on three
    Node lanes for every pull request, from a checkout of one commit, and
    each lane records release evidence. The release validator pins that
    layout;
  - the release validator requires a version change with every hook change,
    and skips that rule in a shallow clone;
  - the repository has no branch protection. The release owner applies the
    merge rule, and the publication gate is its mechanical enforcement;
  - on the maintainer's machine on 2026-11-16 the full test run took 8.6
    minutes for 2190 tests, and the 21 of 116 test files that read plugin
    files took 4.3 minutes for 764 tests.
- Accepted ADRs:
  - [ADR-0053](./0053-single-pull-request-ci-gate-and-publish-evidence-reuse.md):
    every pull request runs the complete `release:check` on the required
    lanes; publication reuses that evidence or falls back to a complete run.
    Amended by sections 3 and 4; its publication gate is preserved.
  - [ADR-0067](./0067-node-26-supported-release-lane.md): each of the three
    lanes runs "the complete `release:check`" and records tree evidence.
    Amended by sections 3 and 4.
  - [ADR-0056](./0056-ci-built-orchestrator-distribution.md): the lanes
    build the distribution and run the complete check. Amended by section 3;
    the distribution build stays the first step of every scope.
  - [ADR-0010](./0010-blocking-and-advisory-release-evidence.md): the
    complete `release:check` on every supported lane is required release
    evidence. Preserved for release; amended for merge by section 3.
  - [ADR-0043](./0043-proportionate-verification-evidence.md): old and new
    paths of a rename both count. Followed by section 2.
  - [ADR-0039](./0039-npm-trusted-publishing-on-github-release.md):
    unchanged.
- Manifest sections 2 and 8.

## Context and Decision Drivers

Decision question: which checks must pass for a change, locally and before
merge, when most changes no longer touch the orchestrator?

Current state. One rule serves every change: the full suite locally, and the
complete release check on three Node versions for each pull request. A
change to an ADR's text or to a skill waits for more than two thousand
tests, most of which exercise orchestrator code the change cannot reach.
The orchestrator is on hold and its publication is frozen, and the plugin
rework will produce many small changes.

The repository's own tests of the plugin live in the same suite. Switching
the suite off would remove them with the rest.

Decision drivers:

1. The wait for a change is proportional to what the change can break.
2. A change that can reach orchestrator behaviour still runs every test.
3. Nothing is published without the complete check.
4. The scope is computed, not chosen by the person, and an unknown path
   means the widest scope.
5. A person reading a green lane can see which scope it ran.

### Security exposure

Judged by mechanism under the Security Assurance policy: no exposure class
applies. No access decision, secret or outbound request changes, and the
publication gate keeps its evidence rule.

One limit is stated, not removed. A pull request runs the workflow file of
its own merge commit, so a pull request can change the workflow that checks
it. That is true today. Section 5 makes CI classify with the rules of the
base revision, which stops a change from narrowing its own scope through the
rules; a change to the workflow file itself stays under review alone.

## Options Considered

### Option 1: Keep the full suite for every change

Simplest and safest. Rejected: it fails driver 1, and the cost grows with
the number of small plugin changes.

### Option 2: Switch the orchestrator's tests off while it is frozen

The largest saving. Rejected: the plugin's own tests are in that suite, and
the hook and library that both products execute would lose every runner
test.

### Option 3: Scope only the local check, or only CI

Half the change. Rejected by the owner (TG-1): one leaves the wait at the
keyboard, the other the wait before merge.

### Option 4: Let the developer choose the scope

A flag or a label. Rejected: it fails driver 4.

### Option 5: Select tests from the import graph of the change

More precise than paths. Rejected for now: many tests read files by path or
start the built CLI, which an import graph does not see.

### Option 6: Add a scheduled complete run

Shows a break in the frozen orchestrator within days. Rejected by the owner
(TG-3).

### Option 7: Fewer Node lanes for narrow scopes

Rejected: the lanes run in parallel, so a lane less saves no waiting time.

### Option 8: Put the hook in the plugin scope

The largest saving for the rework's hook packages. Rejected: the hook's
digests are held in an orchestrator source and in the baseline, the release
validator ties a hook change to a version change, and runner phases depend
on the hook.

### Option 9: Three scopes computed from changed paths (selected)

Sections 1 to 6.

## Decision

### 1. Three scopes, by listed roots

Each path has one scope, taken from the first rule below that names it. A
change set has the widest scope of its paths: full, then plugin, then
documents.

- Full: the orchestrator package, whatever the file type; the plugin paths
  the orchestrator executes, imports or pins, which are `hooks/`, `lib/`,
  `contracts/`, both plugin manifests and every resource the successor
  baseline of ADR-0070 pins; root package files and lockfile; every file
  that carries the release-train version; workflows; release policy; the
  scope rules and suite lists of section 5; and every path no rule names.
- Plugin: the other plugin files, such as skills, policies, guidance,
  templates, the verification helper and plugin documentation.
- Documents: `documentation/`, the root manifest and the other root
  Markdown files, and `publication-policy.json`.

Checks of each scope, the distribution build first in all three:

- Documents: the build check, release validation, the publication check and
  the documents suite.
- Plugin: the documents checks and the plugin suite.
- Full: the complete `release:check` in CI and `npm run verify` locally, as
  today.

A scope's suite holds every test file that reads a path of that scope. A
test enforces that membership, so a test that reads such a path cannot be
left out.

### 2. The change set

- In CI the change set is the difference between the pull request's merge
  commit and its first parent.
- Locally it is the difference between the working tree, untracked files
  included, and the last commit; a caller may name another base revision.
- A renamed or moved file counts under its old and its new path, and a
  deleted file under its path.
- An empty change set, or one that cannot be computed, is full scope.

### 3. The local final check is the scope's check

The required final suite for a change is the checks of its scope. One
repository command computes the change set and the scope, prints the scope
and the paths that decided it, and runs the checks. It runs the publication
check on a copy that includes uncommitted files. `npm run verify` stays the
full scope's command and stays valid for any change.

### 4. Pull requests run the scope's checks on the three lanes

- The three lanes keep their identities and run for every pull request.
  Each computes the scope and runs that scope's checks.
- Each lane writes its scope and the deciding paths to its job summary.
- In full scope a lane runs the literal complete `release:check` and then
  records release evidence, both under one condition that the release
  validator pins. In a narrower scope it runs neither.
- Manual dispatch runs the complete check.
- Publication is unchanged: a tag whose pull request ran a narrower scope
  has no bound evidence, so the publish workflow runs the complete check on
  the tag before any registry call, as ADR-0053 decides.

### 5. The scope rules protect themselves

- The scope rules and the suite lists are repository-owned code with tests,
  not inline workflow logic, and they are full scope.
- CI classifies a pull request with the rules of its base revision, not
  with the rules the pull request brings.

### 6. No scheduled complete run

The complete check runs when a change is full scope and at publication.

### What does not change

The publish workflow and its evidence binding; the lanes' Node versions; the
live compatibility job; the checks that make up `verify` and
`release:check`; the release validator's version rule for hook changes; the
rule that a failed or skipped check is never reported as passed.

## Consequences

Positive:

- A documents change waits for a few document tests, and a plugin text
  change for minutes, instead of the full suite on three lanes.
- The rework's text and skill changes stay cheap.
- The complete check still guards every publication.

Negative:

- The rework's hook packages gain nothing: a hook change is full scope.
- The default branch is no longer proven by the complete check at every
  merge. Between full-scope changes it can hold a break that only the full
  suite shows.
- Most merges record no release evidence, so a CLI publication will usually
  take the slower fallback path.
- A green lane no longer means the complete check passed. With no branch
  protection, the person who merges must read the scope in the job summary.
- The workflow needs the merge commit's parent, so its checkout step and
  the release validator that pins it change. A deeper checkout can also
  activate the validator's version rule in CI, where a shallow clone skips
  it today.

Risks:

- A root placed in too narrow a scope lets a change that reaches
  orchestrator behaviour skip its tests. The unknown-path rule limits this
  to paths someone classified wrongly.
- The suite membership test finds a test by the paths its source names. A
  test that reaches a file through a computed path can escape it.

Required follow-ups: the work plan's package P12; manifest sections 2
and 8; the contributor guide and release checklist; lifecycle notes on
ADR-0053, ADR-0067, ADR-0056 and ADR-0010 at acceptance.

## Compliance and Confirmation

1. A change set of documentation files alone yields the documents scope
   and runs the documents suite and no other test.
2. A change set that adds one skill file yields the plugin scope and runs
   the plugin suite.
3. A change set that touches the orchestrator package, the hook, the plugin
   library, a contract, a plugin manifest, a root package file, a version
   file, a workflow or a scope rule yields the full scope.
4. A Markdown file inside the orchestrator package yields the full scope.
5. A new decision record with its `publication-policy.json` entry yields
   the documents scope.
6. A file moved from the orchestrator package into `documentation/` yields
   the full scope, and so does a deleted orchestrator file.
7. A path no rule names, an empty change set and a change set that cannot
   be computed each yield the full scope.
8. A mixed change set yields the widest scope of its paths.
9. Every narrow scope's checks pass on a checkout with no built
   distribution.
10. A test file that reads a path of a scope and is missing from that
    scope's suite fails the membership test.
11. The local command prints the scope and the deciding paths, exits
    non-zero when a check fails, and sees an uncommitted new document in its
    publication check.
12. A pull request that changes the scope rules is classified by the base
    revision's rules and yields the full scope.
13. A lane in a narrower scope records no release evidence and names its
    scope in the job summary; a lane in full scope runs the literal
    `release:check` and records evidence as today.
14. Manual dispatch runs the complete check.
15. The publish workflow, given a tag without bound evidence, runs the
    complete check before any registry call.
16. The release validator accepts the new workflow layout and rejects a
    layout in which a narrower scope records evidence.

## Lifecycle Links

None. On acceptance this ADR would amend ADR-0053, ADR-0067, ADR-0056 and
ADR-0010 as stated above, with reciprocal lifecycle notes.
