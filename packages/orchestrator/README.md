<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/Parabolic-Technologies/banzai/main/assets/logo/banzai-logo-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/Parabolic-Technologies/banzai/main/assets/logo/banzai-logo-light.svg">
    <img alt="Banzai — Spec-Driven AI Development" src="https://raw.githubusercontent.com/Parabolic-Technologies/banzai/main/assets/logo/banzai-logo.svg" width="320">
  </picture>
</p>

# Banzai

**AI coding workflows with independent review and human control.**

[![npm version](https://img.shields.io/npm/v/%40parabolic-technologies%2Fbanzai)](https://www.npmjs.com/package/@parabolic-technologies/banzai)
[![PR CI](https://github.com/Parabolic-Technologies/banzai/actions/workflows/ci.yml/badge.svg?event=pull_request)](https://github.com/Parabolic-Technologies/banzai/actions/workflows/ci.yml?query=event%3Apull_request)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue)](https://github.com/Parabolic-Technologies/banzai/blob/main/LICENSE)

Banzai is a local CLI that coordinates Codex, Claude Code, or both in your
repository.
For complex changes, approve a plan, run implementation and checks, then inspect
findings from a fresh reviewer session. Small changes follow a lightweight
workflow.

Runs through your existing subscriptions. No API keys required.

**[Get started](https://github.com/Parabolic-Technologies/banzai/blob/main/documentation/getting-started.md)** ·
[Documentation](https://github.com/Parabolic-Technologies/banzai/blob/main/documentation/README.md)

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

## Quick start

Use a regular terminal in your own Git repository on macOS or Linux. You need
Git, Node.js **22.20.0+ within major 22** or **24.11.1+ within major 24**,
and the clients for your selected providers, signed in through individual
subscriptions. The default configuration uses **Claude Code 2.1.280+** for
planning and implementation and **Codex CLI 0.159.1+** for review.
To use one provider, install its client and plugin, then select that provider
for all three roles during `banzai init`. Strict review still uses a fresh
session. Model work uses the clients' remote services and subscription limits.

Install this CLI package in your terminal:

```sh
npm install --global @parabolic-technologies/banzai
banzai --help
```

The npm package installs the CLI and its runtime dependencies.
**Install the Banzai plugin separately in each selected client before project setup.**
Follow **[Get started](https://github.com/Parabolic-Technologies/banzai/blob/main/documentation/getting-started.md)**
for every plugin command, older-client options, and expected results through
your first task.

After those installations, the project steps are:

| Step               | Action                                                                                                                                                                                   |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Set up             | Run `banzai init`, choose models, and complete the offered project guidance setup. Exit the client to return to Banzai.                                                                  |
| Check readiness    | Run `banzai doctor`, resolve failures, review warnings, and commit the reviewed setup. A task needs a committed baseline. Doctor does not verify model authentication or run your tests. |
| Run a task         | Run `banzai`, enter one bounded request, and follow the required decisions.                                                                                                              |
| Inspect the result | Use `banzai status`, inspect the diff and new files, and check the requested behavior before committing.                                                                                 |

The [plugin-only walkthrough](https://github.com/Parabolic-Technologies/banzai/blob/main/documentation/getting-started.md#use-only-the-plugin)
covers use in one supported client without installing this CLI.

## Workflow walkthrough

For a project with a filtered records view, a first request could be:

> Add a CSV export for the currently filtered records. Preserve existing access
> rules and cover empty results and quoted values with tests.

Banzai reads the project and selects a route. Small changes use `quick-fix`
or `feature`, ending after implementation and task verification. For
`strict` work, you resolve architecture decisions and approve the plan
before implementation. Banzai runs the task's checks, then starts an independent
reviewer without the builder's conversation. A different model family or
vendor is optional. You accept, reject, or defer findings; accepted fixes go
through verification and re-review.

The example's route and results depend on the project.
See the [illustrated workflow](https://github.com/Parabolic-Technologies/banzai#how-it-works)
and [approval boundaries](https://github.com/Parabolic-Technologies/banzai#where-you-decide).
The orchestrator works in your current checkout and leaves commits and
publication to you.

## Documentation

| What you need                                | Guide                                                                                                                               |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Installation, your first task, or setup help | [Get started](https://github.com/Parabolic-Technologies/banzai/blob/main/documentation/getting-started.md)                          |
| Commands and options                         | [CLI reference](https://github.com/Parabolic-Technologies/banzai/blob/main/documentation/orchestrator.md#commands)                  |
| Models for each role                         | [Model configuration](https://github.com/Parabolic-Technologies/banzai/blob/main/documentation/orchestrator.md#model-configuration) |
| Checks for your application stack            | [Task verification](https://github.com/Parabolic-Technologies/banzai/blob/main/documentation/verification-examples.md)              |
| Blocked or interrupted work                  | [Failure recovery](https://github.com/Parabolic-Technologies/banzai/blob/main/documentation/orchestrator.md#failure-recovery)       |
| Skills and advanced topics                   | [Documentation index](https://github.com/Parabolic-Technologies/banzai/blob/main/documentation/README.md)                           |
| Current release notes                        | [Latest release](https://github.com/Parabolic-Technologies/banzai/releases/latest)                                                  |

## Contributing

Report reproducible problems through
[GitHub Issues](https://github.com/Parabolic-Technologies/banzai/issues).
To improve the docs, contribute a fix, or share a workflow, read
[Contributing](https://github.com/Parabolic-Technologies/banzai/blob/main/CONTRIBUTING.md)
and the [Code of Conduct](https://github.com/Parabolic-Technologies/banzai/blob/main/CODE_OF_CONDUCT.md).
Report vulnerabilities through the
[security policy](https://github.com/Parabolic-Technologies/banzai/blob/main/SECURITY.md).
