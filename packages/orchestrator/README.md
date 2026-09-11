<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/Parabolic-Technologies/banzai/main/assets/logo/banzai-logo-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/Parabolic-Technologies/banzai/main/assets/logo/banzai-logo-light.svg">
    <img alt="Banzai — Spec-Driven AI Development" src="https://raw.githubusercontent.com/Parabolic-Technologies/banzai/main/assets/logo/banzai-logo.svg" width="480">
  </picture>
</p>

# Banzai — Spec-driven AI development for Codex and Claude Code

[![npm version](https://img.shields.io/npm/v/%40parabolic-technologies%2Fbanzai)](https://www.npmjs.com/package/@parabolic-technologies/banzai)
[![CI](https://github.com/Parabolic-Technologies/banzai/actions/workflows/ci.yml/badge.svg?branch=main&event=push)](https://github.com/Parabolic-Technologies/banzai/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue)](https://github.com/Parabolic-Technologies/banzai/blob/main/LICENSE)

Turn a development request into requirements, plans, code, tests, and review
evidence. Banzai coordinates your coding agents while keeping you in control of
architecture decisions, plan approval, and review findings.

Small changes take a lightweight path. Complex changes get an approved plan
and independent review.

This npm package installs the `banzai` orchestrator CLI. The separately
installed [Banzai plugin](https://github.com/Parabolic-Technologies/banzai#using-the-plugin-without-the-orchestrator)
provides the workflow skills and can also be used directly in one client.

[Quick start](#quick-start) · [Walkthrough](#workflow-walkthrough) ·
[Documentation](#documentation) ·
[Report an issue](https://github.com/Parabolic-Technologies/banzai/issues) ·
[Contribute](#contributing)

## Why Banzai?

- **Independent review.** In the strict workflow, the reviewer starts without
  the builder's conversation and reports findings for you to triage. You can
  use a different model family for implementation and review.
- **Human control.** You decide on architecture, approve the plan, and accept,
  reject, or defer review findings. Only accepted findings reach the fixer.
- **Durable evidence.** Requirements, decisions, plans, code, tests, and review
  artifacts stay in your project. Banzai runs your configured verification
  commands before strict review.
- **Work sized to the task.** The planner chooses `quick-fix`, `feature`, or
  `strict`. Lightweight routes finish after implementation and verification;
  uncertain or escalated work falls back to strict.

## Workflow walkthrough

![Illustrated strict workflow: planning, human approval, implementation and verification, independent review, and human triage](https://raw.githubusercontent.com/Parabolic-Technologies/banzai/main/assets/demo/strict-workflow.svg)

This is an illustrated walkthrough of the workflow, not a recorded model run.
For example, ask Banzai to:

> Add a CSV export for the currently filtered records. Preserve existing access
> rules and cover empty results and quoted values with tests.

For work routed to `strict`, the planner reads the repository and prepares
requirements, any necessary architecture decisions, and a plan. You resolve
open decisions and approve the plan before implementation starts. The builder
implements the approved work; Banzai runs the configured checks, then gives an
independent reviewer the artifacts and current source. You triage any findings,
and accepted fixes go through verification and bounded re-review.

The result includes reviewable changes and durable project artifacts. The
chosen route, findings, and completion outcome depend on the actual repository
and run; the example above does not claim a particular result.

## Quick start

For step-by-step setup, expected outcomes, and troubleshooting, follow
[Your first Banzai task](https://github.com/Parabolic-Technologies/banzai/blob/main/documentation/getting-started.md).

### 1. Check prerequisites

Use a Git repository on macOS or Linux. Setup works before the first commit;
create that commit before starting a task.
You need:

- Node.js **22.20.0+ within major 22**, or **24.11.1+ within major 24**;
- Git, **Codex CLI 0.145.0+**, and **Claude Code 2.1.218+**;
- subscription authentication in both model clients;
- the Banzai plugin installed in both clients as shown below.

Banzai runs the local `codex` and `claude` executables. It does not require API
keys or call vendor APIs directly. Model work uses those clients' services and
subscription limits; running the orchestrator locally does not make model
inference offline. Use a regular terminal for the CLI.

### 2. Install the CLI and plugin

In your terminal:

```sh
npm install --global @parabolic-technologies/banzai
banzai --help
```

Inside Claude Code:

```text
/plugin marketplace add https://github.com/Parabolic-Technologies/banzai.git
/plugin install banzai@banzai-plugins
```

For Codex, in your terminal:

```sh
codex plugin marketplace add https://github.com/Parabolic-Technologies/banzai.git
codex plugin add banzai@banzai-plugins
```

The npm package installs the CLI and its runtime dependencies. The plugin and
model clients are separate installations; the plugin can also be used on its
own.

### 3. Configure your project

From your repository root:

```sh
banzai init
```

Choose models and effort for planning, implementation, and review. Init then
offers explicit project setup with an available client. Exit that client to
return to Banzai; it rechecks guidance and starts no task automatically. Use
`banzai setup` later without repeating model selection, or invoke manually:

- Claude Code: `/banzai:project-manifest`
- Codex: `$banzai:project-manifest`

Review the generated project guidance and `.banzai/config.json`. Add verification
profiles for your project's actual test, typecheck, lint, or build commands.
The default profile contains only `git diff --check`; it does not run tests.
See [verification profile examples](https://github.com/Parabolic-Technologies/banzai/blob/main/documentation/verification-examples.md).

```sh
banzai doctor
```

Resolve failed checks and review warnings, then commit the reviewed configuration
and project guidance using your normal Git workflow. Doctor is read-only: it
checks declarations and local readiness without running your test commands or
verifying model authentication. Run the configured checks yourself before the
first task.

### 4. Run your first task

From the configured repository, on your chosen task branch:

```sh
banzai
```

Enter a bounded request, such as the CSV example above. Banzai displays the
selected workflow and guides you through any required decisions. You can
inspect progress and retained evidence with `banzai status`.

For model settings, see [Model Configuration](https://github.com/Parabolic-Technologies/banzai/blob/main/documentation/orchestrator.md#model-configuration). For a
blocked or interrupted run, see [Failure Recovery](https://github.com/Parabolic-Technologies/banzai/blob/main/documentation/orchestrator.md#failure-recovery).

## Documentation

| What you want to do                                  | Guide                                                                                                                                            |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Complete your first task or diagnose setup           | [Getting started](https://github.com/Parabolic-Technologies/banzai/blob/main/documentation/getting-started.md)                                   |
| Adapt checks for Node, Python, Go, or mixed projects | [Verification examples](https://github.com/Parabolic-Technologies/banzai/blob/main/documentation/verification-examples.md)                       |
| Find commands and options                            | [CLI reference](https://github.com/Parabolic-Technologies/banzai/blob/main/documentation/orchestrator.md#commands)                               |
| Choose models for each role                          | [Model configuration](https://github.com/Parabolic-Technologies/banzai/blob/main/documentation/orchestrator.md#model-configuration)              |
| Configure your project's checks                      | [Verification profiles](https://github.com/Parabolic-Technologies/banzai/blob/main/documentation/orchestrator.md#project-verification-readiness) |
| Resume or diagnose blocked work                      | [Failure recovery](https://github.com/Parabolic-Technologies/banzai/blob/main/documentation/orchestrator.md#failure-recovery)                    |
| Understand review evidence                           | [Review artifacts](https://github.com/Parabolic-Technologies/banzai/blob/main/documentation/orchestrator.md#review-artifact)                     |
| Explore workflow skills and maintainer guides        | [Documentation index](https://github.com/Parabolic-Technologies/banzai/blob/main/documentation/README.md)                                        |

## Contributing

AI-assisted contributions are welcome. Useful places to start:

- **Improve onboarding:** clarify a setup step or propose a verification profile
  for your stack.
- **Report a reproducible bug:** include versions, a minimal reproduction, and
  expected versus actual behavior in
  [GitHub Issues](https://github.com/Parabolic-Technologies/banzai/issues).
- **Share your workflow:** describe your use case and suggest a reusable example
  through an issue or a documentation pull request. Use synthetic data and
  redact credentials and private project details.

Read the [contribution guide](https://github.com/Parabolic-Technologies/banzai/blob/main/CONTRIBUTING.md)
and [Code of Conduct](https://github.com/Parabolic-Technologies/banzai/blob/main/CODE_OF_CONDUCT.md).
Report vulnerabilities privately through the
[security policy](https://github.com/Parabolic-Technologies/banzai/blob/main/SECURITY.md).

<details>
<summary>All reference topics</summary>

Browse the complete [orchestrator reference](https://github.com/Parabolic-Technologies/banzai/blob/main/documentation/orchestrator.md), or jump to a topic:

- [Workflow Reference](https://github.com/Parabolic-Technologies/banzai/blob/main/documentation/orchestrator.md#workflow-reference)
- [Boundaries](https://github.com/Parabolic-Technologies/banzai/blob/main/documentation/orchestrator.md#boundaries)
- [Setup](https://github.com/Parabolic-Technologies/banzai/blob/main/documentation/orchestrator.md#setup)
- [Interactive Human Time](https://github.com/Parabolic-Technologies/banzai/blob/main/documentation/orchestrator.md#interactive-human-time)
- [Test Assurance And Verification Ownership](https://github.com/Parabolic-Technologies/banzai/blob/main/documentation/orchestrator.md#test-assurance-and-verification-ownership)
- [Engineering Quality Shadow Review](https://github.com/Parabolic-Technologies/banzai/blob/main/documentation/orchestrator.md#engineering-quality-shadow-review)
- [Repository Release Confidence](https://github.com/Parabolic-Technologies/banzai/blob/main/documentation/orchestrator.md#repository-release-confidence)
- [Cancellation observations](https://github.com/Parabolic-Technologies/banzai/blob/main/documentation/orchestrator.md#cancellation-observations)
- [Commands](https://github.com/Parabolic-Technologies/banzai/blob/main/documentation/orchestrator.md#commands)
- [Agent Control](https://github.com/Parabolic-Technologies/banzai/blob/main/documentation/orchestrator.md#agent-control)
- [Project Verification Readiness](https://github.com/Parabolic-Technologies/banzai/blob/main/documentation/orchestrator.md#project-verification-readiness)
- [Context Accounting and Budgets](https://github.com/Parabolic-Technologies/banzai/blob/main/documentation/orchestrator.md#context-accounting-and-budgets)
- [Evaluation Export](https://github.com/Parabolic-Technologies/banzai/blob/main/documentation/orchestrator.md#evaluation-export) with [source precedence](https://github.com/Parabolic-Technologies/banzai/blob/main/documentation/orchestrator.md#evaluation-source-precedence)
- [Evaluation KPIs](https://github.com/Parabolic-Technologies/banzai/blob/main/documentation/orchestrator.md#evaluation-kpis)
- [Interactive Mode](https://github.com/Parabolic-Technologies/banzai/blob/main/documentation/orchestrator.md#interactive-mode) with [macOS Dock attention](https://github.com/Parabolic-Technologies/banzai/blob/main/documentation/orchestrator.md#macos-dock-attention)
- [Review Artifact](https://github.com/Parabolic-Technologies/banzai/blob/main/documentation/orchestrator.md#review-artifact)
- [Choosing Models](https://github.com/Parabolic-Technologies/banzai/blob/main/documentation/orchestrator.md#choosing-models)
- [Model Configuration](https://github.com/Parabolic-Technologies/banzai/blob/main/documentation/orchestrator.md#model-configuration)
- [Spawned Claude Environment](https://github.com/Parabolic-Technologies/banzai/blob/main/documentation/orchestrator.md#spawned-claude-environment) with [Claude tool permissions](https://github.com/Parabolic-Technologies/banzai/blob/main/documentation/orchestrator.md#claude-tool-permissions) and [Serena MCP whitelist](https://github.com/Parabolic-Technologies/banzai/blob/main/documentation/orchestrator.md#serena-mcp-whitelist)
- [Live Progress](https://github.com/Parabolic-Technologies/banzai/blob/main/documentation/orchestrator.md#live-progress)
- [Failure Recovery](https://github.com/Parabolic-Technologies/banzai/blob/main/documentation/orchestrator.md#failure-recovery)
- [Local State](https://github.com/Parabolic-Technologies/banzai/blob/main/documentation/orchestrator.md#local-state)

</details>
