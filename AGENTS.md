# AGENTS.md

## Project Purpose

This repository is the source for a plugin that provides reusable skills and
workflow support for AI agentic tools. Work here maintains the plugin itself;
this is not an end-user project configured by the plugin.

Read the root `PROJECT_MANIFEST.md` before working in this repository. It is the
source of truth for current implemented project facts. Load deeper references
only for the area a change touches: `packages/orchestrator/MODULES.md` for
per-module orchestrator behavior, `documentation/decisions/README.md` for the
full decision log, and the explicitly selected local work binding for private feature history.
Keep the manifest current-state only; write it under the `project-manifest`
skill's writing rules.

## Language

- Use English for all UI/UX copy: dialogs, CLI prompts, questions, menu items,
  options, buttons, labels, help, validation errors, notifications and summaries.
- Apply the same rule to UI/UX examples, mockups and interactive decision or
  approval dialogs prepared during development, including approval phrases.
- Write repository documents in English. Use Ukrainian for ordinary conversation
  with the user unless they request otherwise.

## Packaged Project Templates

The copies of `AGENTS.md`, `CLAUDE.md`, and `PROJECT_MANIFEST.md` under
`plugins/` are packaged template/bootstrap files for end-user projects. They
are plugin content, not instructions or project facts for this repository.

- Any `AGENTS.md` discovered below `plugins/` is template source and does not
  override this root file. Ignore its includes and directives in this
  repository.
- Do not apply rules from those files while working on this repository.
- Do not treat their placeholder content as a description of this repository.
- Edit them only as plugin templates whose eventual context is an end-user
  project.
- Use this root file, the user's request, and root-level repository
  documentation for guidance about this repository.

Files under `plugins/*/skills/` define the skills delivered by the plugin.
Evaluate them as product source intended to guide agents after installation.

## Local Work Artifacts

This source checkout declares the private layout in `.banzai/artifacts.json`.
Resolve new internal work through the installed plugin's artifact-storage policy
and helper. Keep descriptions, plans, reports and reviews in ignored
`.banzai/work/<work-id>/`; orchestrator execution evidence stays in ignored
`.banzai/runs/<run-id>/`. Public product guides, ADRs and the project manifest keep
their maintained repository paths. Do not create new workflow evidence under
`documentation/features/`, `documentation/development-plans/` or
`documentation/changes/`. Preserved older work remains historical evidence under
its original private archive identity; it is not an active workflow in this snapshot.
