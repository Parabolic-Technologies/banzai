<!--
  Template maintained by `project-manifest`.
  Replace placeholders with project facts. Delete this banner and each
  instruction comment once its section is filled.
  Every skill loads this file before work: keep it readable in one pass
  (roughly 300 lines or fewer). Rewrite a bullet when its fact changes;
  never append history behind the old state.
-->

<!-- banzai-scaffold: unfilled -->

# PROJECT_MANIFEST.md

Source of truth for current implemented project facts. Other skills must read
this file before code or test changes.

`AGENTS.md` wins on process. Accepted ADRs own architectural intent and
rationale. If this manifest differs from accepted ADR intent, record the
current/target difference and reconcile it through an approved plan.

## 1. Project Overview

<!-- Record: product purpose; primary users; one load-bearing design constraint. -->

## 2. Platform & Tooling

<!-- Record concrete values from build files and lockfiles. -->

- **Language:** `<language>` `<version>`.
- **Runtime / target:** `<runtime/platform/browser target>`.
- **Frameworks:** `<frameworks or None>`.
- **Package manager:** `<tool>` and lockfile.
- **Build / run:** exact commands.
- **Typecheck:** exact command or `None`.
- **Lint:** exact command or `None`.
- **Formatter:** exact final-review-only check/fix command or `None`.
- **Test runner:** exact command.

## 3. Architecture

<!--
  Record established facts only when they are load-bearing: pattern and
  layers; responsibility of each layer; intended or mechanically enforced
  dependency direction; important boundaries, their contracts, and where
  external data becomes trusted; composition points for important runtime
  dependencies and mutable collaborators; concurrency/async model;
  cross-process and background mechanisms; resource ownership and cleanup.
-->

## 4. Project Structure

<!--
  Record: topology (single package, monorepo, multi-module, polyrepo);
  workspace tool if any; location of `documentation/` and this manifest;
  top-level folders; source/test layout; codegen or auto-included files, their
  owner, and whether they are edited or regenerated.
-->

## 5. Key Modules & Components

<!--
  One bullet per primary unit: path; role; public interface or contract; the
  load-bearing invariant or notable behavior, in one or two sentences.
  Keep step-by-step behavior, edge cases, and rendering detail in source,
  tests, or a linked maintainer reference; this section is a map, not the
  territory. Before code exists, write `Recommended (not yet present)` and
  replace it after the first implementation.
-->

## 6. State & Data Flow

<!--
  Record where state lives and how data moves: request/event lifecycle;
  persistence; UI state/navigation; service/message flow; error and failure
  propagation; lifecycle behavior for success, failure, cancellation, timeout,
  or shutdown where the repository has lifecycle-owned resources.
-->

## 7. Dependencies

<!--
  Record: core toolchain from section 2; runtime dependencies and purpose;
  feature dependencies and purpose.
-->

Policy: any new dependency after adoption/bootstrap requires explicit user
approval and a manifest update.

## 8. Testing

<!--
  Record: test framework; test file layout; import pattern for production
  code; naming convention; required suite command; integration/e2e owner when
  applicable; current assurance priorities and legitimate test-double
  boundaries; final-suite owner in orchestrated and standalone work; explicit
  approved coverage threshold, or `None`.
  Record the required suite and at most the latest recorded result;
  per-change test counts, case inventories, and covered guarantees belong in
  feature test reports.
-->

Test policy: the Test Assurance policy in the installed
`policies/test-assurance.md` applies; unless an
explicit approved threshold is recorded above, coverage percentage is
diagnostic rather than a completion target.

## 9. Conventions

<!--
  Record project-specific rules only when they are established by
  configuration, approved guidance, or dominant repository evidence: naming;
  formatting/linting; file/module organization; error handling; logging;
  localization; language idioms.
  Do not turn generic preferences for function or file size, decomposition,
  comments, abstractions, control flow, naming, directories, or patterns into
  manifest facts. The canonical Engineering Quality policy in the installed
  `policies/engineering-quality.md`
  applies separately; this section records the repository's evidence, not
  another policy.
-->

## 10. Technical Constraints & Decision Index

<!--
  Record current load-bearing constraints directly observable in the
  implemented project: minimum versions/platforms; performance, compliance,
  and security constraints; established security controls and where they are
  enforced, so later work can tell an existing control it merely uses from a
  new one it introduces; public or persisted compatibility surfaces and
  migration constraints; established project abstractions whose use is
  load-bearing; documented legacy constraints and safe migration seams;
  build/config choices; test/lint/formatter choices; package manager choice;
  temporary implementation constraints and their removal condition.
-->

Decision index:

<!--
  One row per active accepted ADR: ID, title, path, and implementation state
  (`Planned` or `Implemented`). Write `No accepted ADRs` when the decision log
  is empty. Do not duplicate ADR context, alternatives, rationale, or
  consequences, and add no per-ADR delivery narrative, release history, or
  verification results; link the decision log and feature reports instead.
  Rejected, deprecated, and superseded decisions stay in the decision log.
-->

| ID       | Title   | Path                                     | State     |
| -------- | ------- | ---------------------------------------- | --------- |
| ADR-NNNN | <title> | `documentation/decisions/NNNN-<slug>.md` | `Planned` |
