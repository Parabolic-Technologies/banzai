# Artifact Storage

- Owner decision: ADR-0054; preserved historical custody from ADR-0041
- Consumers: `feature-description`, `architecture-decision`, `development-plan`, `code-writing`, `test-writing`, `feature-review`, `feature-status`, `feature`, `quick-fix`, `project-manifest`; conditional: None
- Process source: the project `AGENTS.md` (authority order, escalation triggers, decision gates)
- Runner consumers: planning, implementation, review, fix, feature, quick-fix.
- Delivery: standalone skills load this policy relatively; runner phases receive its body inline. Conditional duties retain their conditions.

## Artifact Storage

New work documents use `documentation/work/<slug>/`, one flat directory named
for the work's subject. Use a stable, repository-unique lowercase kebab-case
slug without required dates, mode/status prefixes or owner folders. Keep
`description.md`, `plan.md`, required `implementation-report.md` and
`test-report.md`, and successive `review-N.md` files together. Lite work uses
`work.md`; quick-fix creates `change-report.md` only under its existing trigger.
Supporting assets are optional. Add no navigation metadata or empty placeholders.
ADRs, indexes, the project manifest and maintained product guides keep their
established paths.

Standalone agents read and edit the explicitly selected Markdown documents with
ordinary file tools. No layout declaration, registration, UUID, storage command
or claim protocol is required for authoring. Loading, status and read-only
discovery create nothing. If new work collides with an existing directory,
request a distinct slug or explicit continuation; matching names and newest
timestamps confer no selection authority. A hiding Git ignore requires a narrow
correction for the new subtree, never force-add or broad unignore. Git visibility
does not authorize staging, commits or pushes.

Existing documents, private records, declarations, archives and references stay
where they are. An explicit continuation uses their known paths, including
follow-up reports and reviews. Do not migrate, rename, copy into Git, recursively
unignore, register or delete earlier evidence. Read explicitly selected ignored
files directly. Preserve the last usable historical archive/tool copy until an
explicit owner custody decision. No historical-run migration or continuation is
introduced; missing local evidence remains unavailable.

Document location grants no approval. Requirements, accepted ADR bodies,
approved bytes, task order, human gates, report conditions and independent review
retain their authority. Runner phases use only supplied bindings and exact phase
grants; a work directory is never a wildcard write grant. The runner owns its
approvals, snapshots, canonical review publication, completion receipts and
recovery. Do not model-author machine authority or invoke standalone helpers in
a runner phase. Existing hooks retain their host-specific limits.

Raw logs, candidates, locks, sessions, runner records and machine verification
ledgers remain ignored beneath project-local `.banzai/`. Reports retain safe
commands, results, context and limitations without copying private raw output.
Repository visibility belongs to the project owner. Source-project work is
excluded from plugin/npm payloads; client evidence belongs only to its project.

## Task Verification

The installed `../../scripts/verification.cjs <inspect|decide|execute> --json
<request-file>` consumes a private regular JSON request using
`banzai-verification-request/v3`, `schemaVersion: 3`, absolute `repoRoot`, exact
repository-relative `documentPath`, `workflow` (`strict`, `feature` or
`quick-fix`) and a UUID `roundId`. Execute may include `retryOf` for an exact
unsuccessful attempt in that round. Commands and output destinations are never
request fields; descriptors come from the document's existing v2 obligation
inventory. The unchanged result envelope is `banzai-verification-result/v2`.

The calling skill must already hold task/plan execution authorization. Inspect
and decide create nothing; absent machine evidence is unavailable. Execute
allocates only ignored metadata under `.banzai/verification/`, owns execution
coordination for the selected directory, records physical attempts and releases
only its own live ownership. Never reclaim a stale claim by elapsed time. Legacy
executable requests are refused with an upgrade diagnostic. An old or unsupported
inventory keeps applicable fresh-check authority without rewriting that document
or claiming helper support. No extra report is required solely for verification.
