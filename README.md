<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo/banzai-logo-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="assets/logo/banzai-logo-light.svg">
    <img alt="Banzai — Spec-Driven AI Development" src="assets/logo/banzai-logo.svg" width="320">
  </picture>
</p>

# Banzai

**AI coding workflows with independent review and human control.**

[![npm version](https://img.shields.io/npm/v/%40parabolic-technologies%2Fbanzai)](https://www.npmjs.com/package/@parabolic-technologies/banzai)
[![PR CI](https://github.com/Parabolic-Technologies/banzai/actions/workflows/ci.yml/badge.svg?event=pull_request)](https://github.com/Parabolic-Technologies/banzai/actions/workflows/ci.yml?query=event%3Apull_request)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue)](LICENSE)

Banzai is a local CLI that coordinates Codex, Claude Code, or both in your
repository.
For complex changes, approve a plan, run implementation and checks, then inspect
findings from a fresh reviewer session. Small changes follow a lightweight
workflow.

Runs through your existing subscriptions. No API keys required.

**[Get started](documentation/getting-started.md)** ·
[Documentation](documentation/README.md)

## Why Banzai?

- **A fresh review of complex changes.** The strict workflow gives the reviewer
  your requirements and current code without the builder's conversation.
- **You control the decisions.** Approve the plan and decide which review
  findings to fix. Only accepted findings reach the fixer.
- **Results you can inspect.** Keep requirements, decisions, plans, and review
  documents in your project, alongside recorded verification results.
- **A process sized to the task.** Small changes take a shorter route through
  implementation and checks. Complex or uncertain work gets planning and
  independent review.

<a id="install"></a>
<a id="two-parts"></a>

## Quick start

Use a regular terminal in your own Git repository. You need:

- macOS or Linux, Git, and Node.js **22.20.0+ within major 22** or
  **24.11.1+ within major 24**;
- **Codex CLI 0.159.1+** and **Claude Code 2.1.280+** for the default
  configuration, signed in through individual subscriptions;
- the Banzai CLI and the separately installed Banzai plugin in each client
  selected for planning, implementation, or review.

To use one provider, install its client and plugin, then select that provider
for all three roles during `banzai init`. Strict review still uses a fresh
session. The default configuration uses Claude for planning and implementation
and Codex for review.

Model work uses the clients' remote services and subscription limits.
The [getting-started guide](documentation/getting-started.md) covers client setup,
CLI and plugin installation, supported older-client options, and expected results.

<a id="configure-each-project-once"></a>
<a id="run-a-task"></a>

| Step                   | Action                                                                                                                 | Ready to continue when                                                                                                  |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 1. Install             | [Install the CLI and required plugins](documentation/getting-started.md#1-install-the-cli-and-plugin).                 | The CLI is available and the plugin is enabled in each selected client.                                                 |
| 2. Set up your project | Run `banzai init`, choose models, and complete the offered project setup. Exit the client to return to Banzai.         | You have reviewed the generated guidance and configuration.                                                             |
| 3. Check readiness     | Run `banzai doctor`, resolve failures, review warnings, and commit the reviewed setup through your usual Git workflow. | The project has a committed baseline and no unresolved readiness failures. Doctor does not verify model authentication. |
| 4. Run a task          | Run `banzai` and enter one bounded request.                                                                            | Banzai displays the selected workflow and guides the decisions it needs.                                                |

Follow **[Get started](documentation/getting-started.md)** from installation
through inspecting your first change. For a plugin-only workflow in one client,
see [standalone use](#using-the-plugin-without-the-orchestrator).

<a id="the-loop"></a>

## How it works

For a project with a filtered records view, a first request could be:

> Add a CSV export for the currently filtered records. Preserve existing access
> rules and cover empty results and quoted values with tests.

Banzai reads the project and selects a route. `quick-fix` and `feature`
complete after implementation and task verification, without an independent
reviewer phase. Complex or uncertain work takes the `strict` route:

![Illustrated strict workflow: planning, human approval, implementation and verification, independent review, and human triage](assets/demo/strict-workflow.svg)

This is an illustration of the strict workflow. The example request's actual
route and results depend on the project.

In strict work, you resolve architecture decisions and approve the plan before
implementation. Banzai runs the task's checks before independent review.
The reviewer starts without the builder's conversation; using a different
model family or vendor is optional. You accept, reject, or defer findings.
Accepted fixes go through verification and re-review. A passing review, or
completed triage with no accepted findings, can finish the run.

<a id="safety-boundary"></a>

Work stays in the current checkout. The orchestrator does not switch branches,
stash, reset, commit, or publish changes. Existing uncommitted changes are
recorded and excluded from the reviewed set. Review the final diff, new files,
and application behavior before committing through your normal Git workflow.

<details>
<summary>Human decisions and approval boundaries</summary>

### Where You Decide

There are five existing decision gates; the CLI presents their human actions:

| Gate                  | You decide                                                                                      |
| --------------------- | ----------------------------------------------------------------------------------------------- |
| Decision consultation | Resolve material options left open after strict planning examines the repository.               |
| ADR acceptance        | Accept, reject, or rework a proposed architecture decision.                                     |
| Plan approval         | Approve the exact description, accepted ADRs, and plan.                                         |
| Review triage         | Accept, reject, or defer each review finding.                                                   |
| Escalation            | Resolve questions about dependencies, contracts, security, deployment, or unspecified behavior. |

Which gates appear depends on the route and the task. Consultation is
conditional, planning-only, and concise: it records your answer to an unresolved
decision; it does not accept an ADR, approve a plan, authorize code, triage,
recovery, release, or an external side effect.

Approving the plan authorizes the work it describes. Approved planning
artifacts remain immutable during implementation and fixes. Checks and review
follow without separate approval at every phase unless an escalation or
failure needs attention. The reviewer uses read-only tools; only
human-accepted findings reach the fixer.

At a strict planning gate, you can request rework or independent planning
review. Revisions return for approval. See
[planning review](documentation/orchestrator.md#rework-and-independent-planning-review),
[plan authority](plugins/banzai/policies/plan-task-completion.md), and
[runtime boundaries](documentation/orchestrator.md#boundaries).

</details>

## Using The Plugin Without The Orchestrator

You can use Banzai workflow skills directly in either Codex or Claude Code.
The [plugin-only walkthrough](documentation/getting-started.md#use-only-the-plugin)
covers installing your chosen client and plugin, preparing project guidance,
and running a first skill. This path does not require the Banzai CLI.

Use `feature` for an ordinary new capability, `quick-fix` for a bounded fix,
or `feature-review` for a source-read-only audit. Invoke skills as
`/banzai:<skill>` in Claude Code or `$banzai:<skill>` in Codex.
Each skill guides its checks, reports, and required human decisions in chat.

The orchestrator adds model coordination and runner-owned verification.
For standalone requirements, architecture decisions, and the strict sequence,
see [strict work with standalone skills](documentation/getting-started.md#strict-work-with-standalone-skills).

<a id="reference"></a>

## Documentation and community

| What you need                                | Where to go                                                                        |
| -------------------------------------------- | ---------------------------------------------------------------------------------- |
| Installation, your first task, or setup help | [Get started](documentation/getting-started.md)                                    |
| Commands, models, or failure recovery        | [CLI reference](documentation/orchestrator.md)                                     |
| Checks for your application stack            | [Task verification](documentation/verification-examples.md)                        |
| Workflow skills and deeper topics            | [Documentation index](documentation/README.md)                                     |
| Current release notes                        | [Latest release](https://github.com/Parabolic-Technologies/banzai/releases/latest) |

Report reproducible problems through
[GitHub Issues](https://github.com/Parabolic-Technologies/banzai/issues).
To improve the docs, contribute a fix, or share a workflow, read
[Contributing](CONTRIBUTING.md). Report vulnerabilities through the
[security policy](SECURITY.md).

<details>
<summary>Advanced workflows and maintainer references</summary>

To supervise a run from a chat agent, explicitly invoke `/banzai:orchestrate`
in Claude Code or `$banzai:orchestrate` in Codex. Compatible supervisors
require control contract `8.0.0`; see
[agent control](documentation/orchestrator.md#agent-control).

- [Project guidance and setup](documentation/orchestrator.md#project-guidance-setup)
  and [existing-project migration](plugins/banzai/skills/project-manifest/references/layout-migration.md)
- [Client environment and permissions](documentation/orchestrator.md#spawned-claude-environment)
- [Review artifacts](documentation/orchestrator.md#review-artifact)
  and [work-document storage](documentation/artifact-storage.md)
- [Evaluation and KPIs](documentation/evaluation/README.md),
  [context reporting](documentation/context/README.md), and
  [cancellation observations](documentation/orchestrator.md#cancellation-observations)
- [Engineering quality](documentation/engineering-quality.md)
  and [shadow evaluation](documentation/evaluation/engineering-quality-shadow.md)
- [Machine contracts](plugins/banzai/contracts/),
  [optional enforcement hook](plugins/banzai/hooks/README.md), and
  [release checklist](documentation/release-checklist.md)

</details>

## Author and License

Owned by **Banzai International, Inc. d/b/a Parabolic ("Parabolic")**.
Created by [Alexander Torosh](https://github.com/alexander-torosh).
Contact: [alexander@parabolic.io](mailto:alexander@parabolic.io).
Source: [Parabolic-Technologies/banzai](https://github.com/Parabolic-Technologies/banzai).

Banzai is licensed under the [Apache License, Version 2.0](LICENSE).
See [NOTICE](NOTICE), [third-party information](THIRD_PARTY_NOTICES.md),
[Terms of Use](TERMS_OF_USE.md), and [Names and Logos](TRADEMARKS.md).
Using Banzai does not require open-sourcing your own project. Community
participation follows the [Code of Conduct](CODE_OF_CONDUCT.md).
