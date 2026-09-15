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
`.banzai/` except the exact private artifact roles bound for the intended phase.
Read-only fact checks and explicit constraints preserving those paths are valid
task context; they grant no write authority.
Record missing verification configuration in a **Human prerequisites** section,
not an implementation task. The runner owns guided configuration proposals;
free-text consent cannot invent an external configuration-update mechanism.
