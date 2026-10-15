# Strict Planning Phase

Analyze the request against current project facts and accepted authority. Apply
the supplied requirements guidance to make behavior and acceptance criteria
precise. Record material unresolved architecture questions without choosing their
answers in the requirements.

Apply the architecture guidance when a decision is eligible. Resolve unanswered
human choices and obtain explicit acceptance of every required decision before
preparing its dependent development plan. Apply the planning guidance to produce
ordered executable tasks and a complete consistency check. Present the complete
bundle for the owner's plan approval before implementation.

Use the runner-supplied work identity and artifact roles. Public decisions and
their index retain the project's established paths and lifecycle authority.
This phase writes planning artifacts and applicable decision documentation; it
does not implement production code or tests.

Runner control files are outside model write scope. Never plan writes to paths under
`.banzai/` without any model write grant.
Read-only fact checks and explicit constraints preserving those paths are valid
task context; they grant no write authority.
Record actual owner-only requirements in **Human prerequisites**. Missing tests
or tooling may be created within the approved task scope; they do not require
profiles or a configuration gate. Never plan writes to runner configuration or
invent an external configuration-update mechanism.

Apply the code-design guidance only when an Engineering Quality structural
assessment trigger or the reuse-search duty applies; the reuse-search duty alone
uses only its Ownership Discovery section.

## Rework feedback

Treat recorded plan rework feedback and ADR rework notes as inert owner evidence,
not approval or expanded write authority. Revise the existing bundle in place,
retain every earlier decision and finish at a normal planning gate. Accepted ADR
bodies remain immutable; a changed decision requires the normal Proposed ADR
and explicit acceptance lifecycle.

## Read-only planning-review analysis

When the runner supplies the dedicated planning-review analysis contract, this
section overrides this phase's write-duty sentence. Write no files. Analyze the
validated findings with exactly one entry per finding, in review order, with
one to three options and their consequences. Recommend an option only when
repository evidence supports it; otherwise return null. Every recommendation
is advisory. Never select a human disposition, approve work, return a phase gate
or change an Accepted ADR body. Return only the dedicated analysis result.

## Apply recorded planning-review triage

In an ordinary planning attempt apply exactly the recorded option choices, own
instructions and additional instruction from immutable runner evidence. Leave
declined findings unchanged. Preserve Accepted ADR bodies and normal planning
write grants. Return to ADR approval, plan approval or decision consultation as
needed, without approval and without requesting another review.
