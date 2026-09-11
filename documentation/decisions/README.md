# Architecture Decisions

Central decision log for architecturally significant choices in the Banzai
plugin and orchestrator source.

## Decision Index

| ID                                                                      | Title                                                 | Status     | Date       | Related feature                                                                                                             |
| ----------------------------------------------------------------------- | ----------------------------------------------------- | ---------- | ---------- | --------------------------------------------------------------------------------------------------------------------------- |
| [0001](./0001-automatic-workflow-selection.md)                          | Automatic workflow selection                          | Accepted   | 2026-07-29 | [Private work history](../historical-references.md)                                     |
| [0002](./0002-session-affinity-and-bounded-reviewer-continuity.md)      | Session affinity and bounded reviewer continuity      | Accepted   | 2026-07-31 | [Private work history](../historical-references.md)                       |
| [0003](./0003-versioned-evaluation-export-contract.md)                  | Versioned evaluation export contract                  | Accepted   | 2026-08-02 | [Private work history](../historical-references.md)                           |
| [0004](./0004-privacy-minimized-read-only-evaluation-boundary.md)       | Privacy-minimized read-only evaluation boundary       | Accepted   | 2026-08-02 | [Private work history](../historical-references.md)                           |
| [0005](./0005-traceable-evaluation-aggregation.md)                      | Traceable evaluation aggregation                      | Accepted   | 2026-08-02 | [Private work history](../historical-references.md)                           |
| [0006](./0006-versioned-verification-profiles.md)                       | Versioned verification profiles                       | Accepted   | 2026-08-04 | [Private work history](../historical-references.md)                                 |
| [0007](./0007-project-type-verification-readiness.md)                   | Project-type verification readiness                   | Accepted   | 2026-08-04 | [Private work history](../historical-references.md)                                 |
| [0008](./0008-read-only-doctor-diagnostics.md)                          | Read-only doctor diagnostics                          | Accepted   | 2026-08-04 | [Private work history](../historical-references.md)                                 |
| [0009](./0009-supported-node-release-matrix.md)                         | Supported Node release matrix                         | Accepted   | 2026-08-10 | [Private work history](../historical-references.md)                                       |
| [0010](./0010-blocking-and-advisory-release-evidence.md)                | Blocking and advisory release evidence                | Accepted   | 2026-08-10 | [Private work history](../historical-references.md)                                       |
| [0011](./0011-protected-live-vendor-compatibility.md)                   | Protected live vendor compatibility                   | Accepted   | 2026-08-10 | [Private work history](../historical-references.md)                                       |
| [0012](./0012-independent-product-versioning-and-release-policy.md)     | Independent product versioning and release policy     | Superseded | 2026-08-10 | [Private work history](../historical-references.md)                                       |
| [0013](./0013-risk-driven-test-assurance.md)                            | Risk-driven test assurance                            | Accepted   | 2026-08-12 | [Private work history](../historical-references.md)                                         |
| [0014](./0014-human-triaged-review-closure.md)                          | Human-triaged review closure                          | Accepted   | 2026-08-12 | [Private work history](../historical-references.md)                                         |
| [0015](./0015-durable-verification-attempt-ledger.md)                   | Durable verification attempt ledger                   | Accepted   | 2026-08-13 | [Private work history](../historical-references.md)           |
| [0016](./0016-orchestrated-plan-task-completion-evidence.md)            | Orchestrated plan task completion evidence            | Superseded | 2026-08-13 | [Private work history](../historical-references.md)           |
| [0017](./0017-versioned-plan-task-completion-ledger.md)                 | Versioned plan task completion ledger                 | Accepted   | 2026-08-14 | [Private work history](../historical-references.md) |
| [0018](./0018-agent-supervised-banzai-cli-control.md)                   | Agent-supervised Banzai CLI control                   | Accepted   | 2026-08-17 | [Private work history](../historical-references.md)                                       |
| [0019](./0019-attempt-owned-review-candidates.md)                       | Attempt-owned review candidates                       | Accepted   | 2026-08-17 | [Private work history](../historical-references.md)                           |
| [0020](./0020-scoped-claude-subprocess-environment.md)                  | Scoped Claude subprocess environment                  | Accepted   | 2026-08-17 | [Private work history](../historical-references.md)                                   |
| [0021](./0021-failure-classified-reviewer-continuity.md)                | Failure-classified reviewer continuity                | Accepted   | 2026-08-17 | [Private work history](../historical-references.md)                                   |
| [0022](./0022-availability-gated-serena-mcp-whitelist.md)               | Availability-gated Serena MCP whitelist               | Accepted   | 2026-08-18 | [Private work history](../historical-references.md)                                   |
| [0023](./0023-durable-terminal-attempt-checkpoints.md)                  | Durable terminal attempt checkpoints                  | Accepted   | 2026-08-18 | [Private work history](../historical-references.md)                     |
| [0024](./0024-operator-authorized-prerequisite-blocked-fix-recovery.md) | Operator-authorized prerequisite-blocked fix recovery | Accepted   | 2026-08-19 | [Private work history](../historical-references.md)                         |
| [0025](./0025-fix-authored-completion-ledger-refresh.md)                | Fix-authored completion ledger refresh                | Accepted   | 2026-08-21 | amends [0017](./0017-versioned-plan-task-completion-ledger.md); change reports under `documentation/changes/`               |
| [0026](./0026-derived-evaluation-kpi-projection-contract.md)            | Derived evaluation KPI projection contract            | Accepted   | 2026-08-22 | [Private work history](../historical-references.md)                           |
| [0027](./0027-exposure-driven-security-assurance.md)                    | Exposure-driven security assurance                    | Accepted   | 2026-08-22 | [Private work history](../historical-references.md)                         |
| [0028](./0028-phase-context-accounting-and-budget-policy.md)            | Phase context accounting and budget policy            | Accepted   | 2026-08-23 | [Private work history](../historical-references.md)                           |
| [0029](./0029-eslint-backed-orchestrator-import-boundary-policy.md)     | ESLint-backed orchestrator import boundary policy     | Accepted   | 2026-08-23 | [Private work history](../historical-references.md)               |
| [0030](./0030-vendor-neutral-engineering-quality-policy.md)             | Vendor-neutral Engineering Quality policy             | Accepted   | 2026-08-26 | [Private work history](../historical-references.md)                                   |
| [0031](./0031-interactive-decision-consultation.md)                     | Interactive decision consultation                     | Accepted   | 2026-08-31 | [Private work history](../historical-references.md)                           |
| [0032](./0032-unified-banzai-release-train-version.md)                  | Unified Banzai release-train version                  | Superseded | 2026-09-04 | [Private work history](../historical-references.md)                                               |
| [0033](./0033-root-package-version-authority.md)                       | Root package version authority                       | Accepted   | 2026-09-05 | [Private work history](../historical-references.md)                                 |
| [0034](./0034-durable-human-time-observations.md)                       | Durable human-time observations                       | Accepted   | 2026-09-06 | [Private work history](../historical-references.md)                                                 |
| [0035](./0035-cancellation-observations-and-report.md)                  | Cancellation observations and report                  | Accepted   | 2026-09-06 | [Private work history](../historical-references.md)                                           |
| [0036](./0036-vendor-neutral-policy-files-and-instruction-delivery.md)  | Vendor-neutral policy files and instruction delivery  | Accepted   | 2026-09-07 | [Private work history](../historical-references.md) |
| [0037](./0037-unified-runner-rendered-review-artifacts.md)              | Unified runner-rendered review artifacts              | Accepted   | 2026-09-08 | [Private work history](../historical-references.md) |
| [0038](./0038-explicit-plan-authority.md)                              | Explicit plan authority                              | Accepted   | 2026-09-08 | [Private work history](../historical-references.md) |
| [0039](./0039-npm-trusted-publishing-on-github-release.md)             | npm trusted publishing on GitHub Release             | Accepted   | 2026-09-09 | none; change report [Private work history](../historical-references.md) |
| [0040](./0040-project-adoption-preflight-and-interactive-setup.md) | Project adoption preflight and interactive setup | Accepted | 2026-09-10 | [Private work history](../historical-references.md) |
| [0041](./0041-artifact-retention-and-publication-boundary.md) | Artifact retention and publication boundary | Accepted | 2026-09-11 | [archived work history](../historical-references.md); [migration roadmap](../artifact-policy-migration.md) |
| [0042](./0042-runner-delivered-phase-instructions.md) | Runner-delivered phase instructions | Proposed | 2026-09-11 | Private work `runner-phase-instructions`; requirements summarized in the ADR |

## File Names

Use `NNNN-<short-kebab-case-title>.md`. Choose the next unused four-digit ID and
check for collisions immediately before writing.

## Eligibility

Create an ADR only when a choice is cross-cutting, difficult to reverse, affects
a public contract or important quality attribute, or has multiple viable
options with meaningful trade-offs. Product requirements belong in feature
specifications; local reversible mechanics belong in plans.

## Required Sections

1. title and stable ID;
2. status, date, owner, and decision makers;
3. related feature, plan, repository authority, and ADR links;
4. context and decision drivers;
5. options considered with material trade-offs;
6. decision in direct, imperative language;
7. positive and negative consequences;
8. compliance or confirmation method;
9. supersedes/superseded-by links when applicable.

## Lifecycle

- `Proposed`: ready for explicit review; implementation cannot rely on it.
- `Accepted`: approved architectural intent; the body is immutable.
- `Rejected`: retained with the rejection reason.
- `Superseded`: replaced by a linked accepted ADR.
- `Deprecated`: no longer applies and has no replacement.

Change an accepted decision by creating a new Proposed ADR. When it is accepted,
link both records and change only lifecycle metadata on the older ADR. Keep all
statuses in this log.

Historical related-work links in accepted ADRs retain their original meaning. A clean public snapshot may omit that workflow evidence; see [historical references](../historical-references.md).
