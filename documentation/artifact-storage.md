# Work Documents

[ADR-0054](decisions/0054-git-visible-work-artifacts.md) defines one fixed
convention for new human-reviewed work. Skills read and edit ordinary Markdown;
no layout declaration, registration, UUID or storage command is required.
Plugin-only authoring needs no orchestrator installation.

```text
documentation/
  decisions/                         # ADRs and decision index
  work/<slug>/
    description.md                   # strict requirements
    plan.md                          # strict implementation plan
    implementation-report.md
    test-report.md
    review-1.md                      # each iteration keeps its own file
    work.md                          # lite feature
    change-report.md                 # only when its existing trigger applies
.banzai/                             # ignored execution state
  runs/<run-id>/                     # runner-owned evidence and candidates
  verification/<directory-key>/      # standalone verification records
  execution-locks/<directory-key>/   # live executor ownership
```

The tree lists possible documents. Create only those required by the workflow.
Keep one stable lowercase kebab-case subject slug across planning, implementation
and review, without required dates, mode/status prefixes, owner folders or a
navigation index. Add a local assets directory only when supporting files are
needed. ADRs, guides and the project manifest keep their established paths.

New work must appear in ordinary Git status and diffs. If an ignore hides it,
correct only the new subtree; do not force-add or unignore historical evidence.
Git visibility does not authorize staging, commits or pushes. Reports include
safe commands, results, limitations and decision context; raw private output and
machine ledgers remain beneath ignored `.banzai/`.

## Selecting and continuing work

Pass an exact directory or document path. A matching slug or newest timestamp
is not continuation authority. New work colliding with an existing directory
requires explicit selection or a different slug. Read-only discovery creates
nothing.

Existing tracked legacy and ignored private documents stay where they are.
Explicit standalone continuation uses those known paths and references, including
follow-up reports and reviews. No migration, archive restoration, registration,
copy into Git or historical-run continuation is introduced. Existing declaration
contents are inert for new work, even when unsupported or malformed.

## Verification and runner authority

Standalone `verification.cjs` consumes request v3 with absolute `repoRoot`, exact
repository-relative `documentPath`, `workflow` (`strict`, `feature` or
`quick-fix`) and UUID `roundId`; execute may include an exact failed/interrupted
`retryOf`. Descriptors come from the document's v2 inventory, under the calling
skill's existing task/plan authorization. Requests carry no commands or output
paths. Inspect/decide are read-only; absent local evidence is unavailable.
Execute owns ignored metadata and physical attempts for the selected directory.
A missing old inventory keeps applicable fresh checks under skill authority
without rewriting that document or claiming helper support.

New runner state v9 contains immutable binding v3 to fixed document roles and
its run-local verification directory. There is no separately registered work
file. Workspace v3 includes selected documents exactly once, including unchanged
approved files, plus source changes. Snapshot v7 and rendered review v8 retain
independent review, exact phase grants, approved-byte checks and completion
receipts. Canonical reviews are runner output after verification; their exact
paths are excluded from task input observation and remain protected by snapshot,
workspace and publication validation. Other work documents stay observed.

Ordinary Markdown editing has no executor claim protocol. Real verification and
runner mutation retain exclusive execution ownership. Stale ownership requires
inspection of the original process and an explicit owner recovery decision;
elapsed time alone never authorizes reclamation. New executors refuse historical
binding semantics without rewriting old evidence.

Source checks accept the fixed work subtree without per-report inventory entries,
subject to safe-path and content checks. Source-project documents are excluded
from actual plugin/npm packages. See [publication boundary](publication-boundary.md)
and the [historical archive guide](artifact-archive.md).
