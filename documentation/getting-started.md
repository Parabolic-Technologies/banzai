# Your First Banzai Task

Follow this guide from installation to a change you can review in your own
project. Banzai coordinates your coding agents, selects a workflow for the
request, and presents any decisions it needs from you.

**Install → prepare your repository → set up → check readiness → run → inspect.**

For skills directly in one client, follow [Use only the plugin](#use-only-the-plugin).

## Before you begin

For the CLI workflow, you need:

- **macOS or Linux**, Git, and a regular terminal with interactive input/output.
- **Node.js 22.20.0+ within major 22**, or **24.11.1+ within major 24**.
- The model clients for your selected providers, signed in through individual
  subscriptions. The default configuration uses **Claude Code 2.1.280+** for
  planning and implementation and **Codex CLI 0.159.1+** for review.
- Your application's dependencies, when it has any. Banzai can work with an
  existing project or an empty Git repository. Its Node.js runtime does not
  require your application to use JavaScript.

To use one provider, install its client and plugin, then select that provider
for all three roles during `banzai init` in step 3. Strict review still uses
a fresh session. You need both clients only when your selected roles use both.

Banzai invokes the local executables for your selected providers. You do not
enter API keys into Banzai. Model work uses the clients' remote services and
subscription limits.

For older model selections, the vendor minimums are Codex CLI 0.145.0 and
Claude Code 2.1.218. Each selected model must meet its own
[client-version requirement](orchestrator.md#model-configuration).

### Install and sign in to model clients

Follow the installation link for each client you will use. If it is already
installed and signed in, run the checks in the last column. Use the same
terminal environment you will use for Banzai.

| Client      | Official instructions                                                                                                                          | Sign in if needed   | Check installation and sign-in                |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | --------------------------------------------- |
| Codex       | [Install](https://developers.openai.com/codex/cli/#getting-started) · [Sign in](https://learn.chatgpt.com/docs/developer-commands#codex-login) | `codex login`       | `codex --version`, then `codex login status`  |
| Claude Code | [Install](https://code.claude.com/docs/en/setup#install-claude-code) · [Sign in](https://code.claude.com/docs/en/cli-reference#cli-commands)   | `claude auth login` | `claude --version`, then `claude auth status` |

For the Banzai CLI, choose ChatGPT subscription sign-in for Codex and Claude
subscription sign-in for Claude Code. API-key and third-party-provider
authentication are not supported by the orchestrator.

**Expected result:** each selected client reports a suitable version and the
intended sign-in method. These checks report stored login state; model calls
can still fail if credentials expire or a subscription limit is reached.

## 1. Install the CLI and plugin

In your regular terminal, check the prerequisites:

```sh
node --version
git --version
```

Install the Banzai CLI:

```sh
npm install --global @parabolic-technologies/banzai
banzai --help
```

The npm package installs the CLI and its runtime dependencies. Install the
Banzai plugin separately in each selected client: both for the default
configuration, or just your chosen client for a configuration using one
provider. Follow the matching plugin blocks below.

### Claude Code plugin

**Inside Claude Code**, run:

```text
/plugin marketplace add https://github.com/Parabolic-Technologies/banzai.git
/plugin install banzai@banzai-plugins
```

### Codex plugin

**In your terminal**, run:

```sh
codex plugin marketplace add https://github.com/Parabolic-Technologies/banzai.git
codex plugin add banzai@banzai-plugins
```

**Expected result:** `banzai --help` displays the CLI commands, and the plugin
is installed and enabled in each selected client. Check sign-in using the
[client checks above](#install-and-sign-in-to-model-clients).

## 2. Prepare your repository

Open your project's root directory in a regular terminal. Review existing
changes and choose a task branch through your usual Git workflow:

```sh
git status --short
```

For an existing application, install its dependencies and identify the test,
lint, typecheck, or build commands it actually uses. Banzai selects relevant
checks from the request and project evidence; new tasks require no verification
profiles or bootstrap setup.

<details>
<summary>Starting in a new directory?</summary>

Run this from the intended project directory:

```sh
git init
```

Then continue with `banzai init` below. Project guidance setup works before
the first commit and before an application skeleton exists. Create your first
commit after reviewing the setup in step 4. A task requires a committed
`HEAD`; Banzai does not initialize Git automatically.

</details>

**Expected result:** you are in the intended Git repository and know which
existing changes belong to you.

<a id="1-initialize-and-review-project-guidance"></a>

## 3. Initialize and review project guidance

From your project root:

```sh
banzai init
```

Choose the model and effort for planning, implementation, and review.
If you installed only one provider's client, select that provider for all three
roles instead of keeping the mixed-provider defaults.
You can change these later with `banzai model`.

If guidance is incomplete, init offers **Run project-manifest with Codex**,
**Run project-manifest with Claude Code**, **Show manual instructions**, and
**Exit**. Choose an available client, follow the setup prompts, and review
its proposed guidance. The configured planning vendor is recommended when
available.

**Exit the model client when setup is finished to return to Banzai.**
Banzai rereads the project guidance; setup does not start a task automatically.
Use `banzai setup` later to continue without repeating model selection.

Review `.banzai/config.json`, `AGENTS.md`, `CLAUDE.md`,
`PROJECT_MANIFEST.md`, and any proposed settings changes. Preserve your
project's existing instructions and resolve proposed merges before continuing.
The manifest should describe your actual stack, conventions, and checks.

Init also creates `documentation/verification-examples.md` when missing and
adds local run-state entries to `.gitignore`. Existing configuration and guide
contents are retained.

<details>
<summary>Run project guidance setup manually</summary>

Invoke the installed skill in the same project:

| Client      | Skill invocation           |
| ----------- | -------------------------- |
| Claude Code | `/banzai:project-manifest` |
| Codex       | `$banzai:project-manifest` |

Unavailable clients show a reason. Check plugin installation and enablement
before retrying. If existing instructions require migration, review the
proposed diff before accepting it. See
[project guidance setup](orchestrator.md#project-guidance-setup).

</details>

**Expected result:** Banzai has rechecked the guidance, and you have reviewed
the proposed configuration and instruction changes.

<a id="3-check-readiness-and-save-the-reviewed-setup"></a>

## 4. Check readiness and save the reviewed setup

```sh
banzai doctor
```

Resolve every failed check and review the warnings. Doctor checks local
configuration, guidance, executable paths, and state. It does not run your
application checks or verify model authentication. An authentication advisory
is expected; workflow startup performs the vendor preflight checks.

Inspect the setup changes:

```sh
git status --short
git diff
```

Review new, untracked files too; `git diff` does not show them. Commit the
intended configuration, guidance, and `.gitignore` changes through your
normal Git workflow. Keep credentials and ignored local run state out of the
commit. Start from a reviewed, clean working tree so the task has a clear
baseline.

For a new repository, this can be your first commit. If you intentionally need
an empty baseline that leaves staged files uncommitted, use:

```sh
git commit --allow-empty --only -m "Initial commit"
```

**Expected result:** the project has a committed baseline, no unresolved
readiness failures, and reviewed warnings. Model sign-in and capacity are
checked when a task starts.

<a id="2-describe-the-result-you-need"></a>
<a id="4-give-banzai-one-bounded-request"></a>

## 5. Run your first task

From your configured project, on your chosen task branch:

```sh
banzai
```

Describe one observable change, the behavior it must preserve, and the cases
its tests should cover. For a project with a filtered records view:

> Add a CSV export for the currently filtered records. Preserve existing access
> rules and cover empty results and quoted values with tests.

Adapt the request to your application. Choose a small change whose result you
can inspect locally. Banzai displays the selected route and reason; the example
does not guarantee a particular route.

| Selected route           | What to expect                                                                                                                                             |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `quick-fix` or `feature` | Implementation and task verification, without an independent reviewer phase. Escalated work returns for a human decision.                                  |
| `strict`                 | Requirements and planning, any required architecture or clarification decisions, your plan approval, implementation, verification, and independent review. |

For strict work, inspect the plan and its required checks before approving it.
You can request rework or independent planning review; revisions return for
approval. After implementation review, accept, reject, or defer each finding.
Accepted findings authorize scoped fixes. Rejected and deferred findings stay
out of the fixer. A passing review, or complete triage with no accepted
findings, can finish the run while retaining the original review verdict.

Banzai identifies relevant checks from the task and project evidence. Strict
plans bind required checks; lightweight work follows your request and existing
execution permissions. Missing unrelated tooling is not a prerequisite.
A failed required check prevents completion. See
[task verification](verification-examples.md) for stack-specific examples.

**Expected result:** Banzai has selected a route and is carrying out the task
or presenting a decision for you. If blocked, inspect `banzai status` and
follow the reported next action.

<a id="5-inspect-the-outcome"></a>

## 6. Inspect the outcome

```sh
banzai status
git status --short
git diff --stat
git diff
```

Use the reported run state and next action to determine whether the workflow
has finished. Before treating the task as complete:

- Confirm that the run reports completion and its required verification
  results are available and passed.
- Inspect the source diff and any new, untracked files.
- Check the requested behavior in your application.
- For strict work, inspect the recorded decisions and review outcome,
  including any rejected or deferred findings.

Work documents live under `documentation/work/<slug>/` and remain visible
in Git. Existing work retains its known paths. Local run state and verification
evidence live under ignored `.banzai/runs/<run-id>/`. Follow the paths reported
by the run; different routes create different documents.

**Expected result:** you have a change you can inspect, its check results,
and any required planning and review records. The orchestrator leaves commits
and publication to you. Use your normal review and commit process.

## Setup troubleshooting

| Symptom                                                         | Next step                                                                                                                                                                                     |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `banzai` is not found                                           | Check the global npm installation and this terminal's `PATH`. Reopen the terminal after changing Node installations.                                                                          |
| A selected model client is not found or is signed out           | Follow the [client installation and sign-in instructions](#install-and-sign-in-to-model-clients), then repeat that client's version and sign-in checks.                                       |
| The plugin or project-manifest skill is unavailable             | Complete the [Claude Code](#claude-code-plugin) or [Codex](#codex-plugin) plugin installation for that client and check that it is enabled.                                                   |
| Model picker or interactive prompts are unavailable             | Use a regular terminal. `banzai setup` requires interactive input/output.                                                                                                                     |
| `GIT_REPOSITORY_REQUIRED`                                       | Run from your project's Git root, or initialize the intended new directory as described in step 2.                                                                                            |
| `GIT_INITIAL_COMMIT_REQUIRED`                                   | Create your first commit after reviewing the setup in step 4.                                                                                                                                 |
| Configuration or project guidance is missing                    | Run `banzai init` from the intended repository and complete the offered setup. Use `banzai setup` to continue later.                                                                          |
| Doctor is ready, but startup rejects authentication or capacity | Resolve the reported client sign-in, subscription, or provider issue. Retry start checks only when `banzai status` offers that action.                                                        |
| Claude or Codex cannot access its login or state                | Run Banzai from a regular terminal. An enclosing agent sandbox can hide Claude's Keychain login or make Codex state read-only; see [client environment](orchestrator.md#model-configuration). |
| Claude tool permissions fail                                    | Follow the specific finding and [permission guidance](orchestrator.md#claude-tool-permissions). Review proposed settings before accepting them.                                               |
| A legacy configuration is reported                              | Follow the [legacy configuration reference](orchestrator.md#project-verification-readiness). Rerunning init does not migrate an existing configuration.                                       |
| Setup is blocked by unfinished work                             | Inspect `banzai status` and the [setup ownership rules](orchestrator.md#project-guidance-setup). Finish or explicitly cancel the existing run before setup.                                   |
| A task is blocked or interrupted                                | Follow the action offered by `banzai status`. See [failure recovery](orchestrator.md#failure-recovery) for the distinct retry, resume, and recovery rules.                                    |

If setup still fails, report the OS, Node and client versions, command,
failing check identifier, and a minimal reproduction through
[GitHub Issues](https://github.com/Parabolic-Technologies/banzai/issues).
Omit credentials and private project details from diagnostics. Report
vulnerabilities through the [security policy](../SECURITY.md).

## Before-you-install FAQ

**Do I need both model clients?** The default configuration uses both. You can
run the orchestrator with one provider by selecting it for planning,
implementation, and review during `banzai init` or later with `banzai model`.
Install and sign in to each selected client and install the Banzai plugin there.
Strict review remains a separate session even when all roles use the same
provider. You can also [use only the plugin](#use-only-the-plugin).

**Does npm install everything?** It installs the orchestrator and its runtime
dependencies. Install the model clients and Banzai plugin separately, as
described above.

**Does Banzai require a particular application framework?** No. It uses your
project's stack and selects checks relevant to the task. See
[verification examples](verification-examples.md) for Node, Python, Go,
and mixed projects.

**What does a successful first task prove?** It demonstrates the recorded
workflow and checks for that task. Review the actual result before merging;
one run is not a general measure of correctness or productivity.

## Use only the plugin

This path runs Banzai skills directly in Codex or Claude Code. You need only
your chosen client and its Banzai plugin; Banzai CLI installation and the
`banzai init` / `banzai doctor` steps do not apply.

1. **Install your client and plugin.** Follow the matching row in
   [client installation and sign-in](#install-and-sign-in-to-model-clients),
   then the [Codex plugin](#codex-plugin) or
   [Claude Code plugin](#claude-code-plugin) command block. Ensure the plugin
   is enabled in the client session you will use.
2. **Prepare project guidance.** Open a client session from your project's root
   directory and invoke the setup skill shown below. Review its proposed
   project instructions, manifest, and settings changes before accepting them.
3. **Run one bounded task.** Invoke `quick-fix` with a specific existing problem
   and the behavior to preserve, or `feature` for a new capability. Follow the
   skill's prompts and required human decisions.
4. **Inspect the result.** Review changed and new files, check the reported
   verification results, and try the requested behavior before committing
   through your normal Git workflow.

| Client session                     | Prepare project guidance   | First task example                                                                                      |
| ---------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------- |
| Run `codex` from the project root  | `$banzai:project-manifest` | `$banzai:quick-fix Improve the README installation instructions. Preserve existing commands and links.` |
| Run `claude` from the project root | `/banzai:project-manifest` | `/banzai:quick-fix Improve the README installation instructions. Preserve existing commands and links.` |

Enter the skill invocations in the client chat, not in your shell. Adapt the
example to an actual problem in your project. For a separate source-read-only
audit, open a fresh client session and invoke `feature-review` with the same
client-specific prefix and the exact work document or directory to review.

**Expected result:** project guidance is reviewed and one skill has produced a
change or review artifact with its reported checks. Standalone skills guide
the work in chat; the orchestrator's run status and automatic phase transitions
belong to the CLI workflow.

### Strict work with standalone skills

Use [feature-description](../plugins/banzai/skills/feature-description/SKILL.md)
to establish requirements and obtain approval. Resolve any material
architecture decisions through
[architecture-decision](../plugins/banzai/skills/architecture-decision/SKILL.md),
then prepare and approve a
[development-plan](../plugins/banzai/skills/development-plan/SKILL.md).
After approval, run
[code-writing](../plugins/banzai/skills/code-writing/SKILL.md),
[test-writing](../plugins/banzai/skills/test-writing/SKILL.md), and
[feature-review](../plugins/banzai/skills/feature-review/SKILL.md).
Review the findings and explicitly select any fixes. Each linked skill
describes its inputs, outputs, and approval boundaries.

<a id="incomplete-guidance-during-an-existing-run"></a>
<a id="rework-and-independent-planning-review"></a>

## Further reading

- [Project guidance setup and repair](orchestrator.md#project-guidance-setup)
- [Rework and independent planning review](orchestrator.md#rework-and-independent-planning-review)
- [Models and effort](orchestrator.md#choosing-models)
- [Work-document storage](artifact-storage.md)
- [CLI commands and advanced workflows](orchestrator.md#commands)
