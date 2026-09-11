# Banzai Documentation

Start with the [product overview and installation](../README.md) and the
[npm Quick start](../packages/orchestrator/README.md#quick-start).

## Using Banzai

- [Your first Banzai task](getting-started.md): project setup, expected outcomes,
  troubleshooting, and answers to common installation questions.
- [Verification examples](verification-examples.md): adaptable Node, Python,
  Go, and mixed-project checks.
- [Workflow walkthrough](../packages/orchestrator/README.md#workflow-walkthrough):
  an illustrated strict workflow and an example request.
- [CLI reference](orchestrator.md#commands): commands and operational behavior.
- [Model configuration](orchestrator.md#model-configuration): models and effort
  for planning, implementation, and review.
- [Verification profiles](orchestrator.md#project-verification-readiness):
  declare the checks Banzai should run for your project.
- [Failure recovery](orchestrator.md#failure-recovery): blocked work, retry,
  resume, and recovery boundaries.
- [Review artifacts](orchestrator.md#review-artifact): findings and retained
  evidence.
- [Standalone skills](../README.md#using-the-plugin-without-the-orchestrator):
  use the plugin in an agent session.

## Maintainer references

- [Contributing](../CONTRIBUTING.md): issues, pull requests, licenses, and checks.
- [Project manifest](../PROJECT_MANIFEST.md): current implemented facts.
- [Architecture decisions](decisions/README.md): decision status and authority.
- [Orchestrator modules](../packages/orchestrator/MODULES.md): module contracts.
- [Release checklist](release-checklist.md) and [2.3.0 notes](releases/2.3.0.md).
- [Security assurance](security-assurance.md) and
  [engineering quality](engineering-quality.md): maintained policies.
- [Evaluation KPIs](evaluation/README.md) and [context reporting](context/README.md).

## Public documentation scope

The public source retains reusable requirements, approved plans, architecture
decisions, current operational guidance, and selected implementation evidence.
Feature records describe their original scope and may predate later decisions;
use the manifest and active decision index to establish current behavior.

Early POC work logs, iterative debugging reports, and private sandbox project
studies were removed for the first public release. Links to those records are
marked as historical omissions. Their originals remain in private development
history; they are not required to install, build, test, or use Banzai.

Private operational examples and local machine identifiers were removed from
retained documents. Publication notes on affected ADRs identify these editorial
changes; their decisions and lifecycle are preserved. Private calibration case
IDs mentioned in historical requirements are references to evidence outside
the public distribution, not public datasets or runtime dependencies. Prepare
a separately adjudicated case set using the
[public calibration guide](evaluation/reviewer-calibration/README.md) for new
comparisons.

The [publication procedure](releases/public-publication.md) records the release
order, the verified delivery facts per version, and the source-snapshot and
private-history boundary. Cleanup of the working tree does not erase earlier
Git commits.
