# Independent Planning Review Phase

Perform an independent, fresh, read-only assessment of the runner-supplied
scope. Inspect each artifact directly at its exact path; a path or digest is
not proof that its contents were assessed. Use the inlined requirements,
architecture and planning guidance and policies as assessment criteria only.
They confer no authoring or write authority. Plan Authority applies when the
plan is in scope.

Preserve recorded owner decisions and Accepted ADR bodies. Do not relitigate
them against unchanged evidence. If new evidence requires a changed accepted
decision, report a finding recommending a new or revised Proposed ADR.

Report only concrete, independently supported concerns. An ordinary finding
must independently establish a violated requirement, accepted decision,
contract, safety rule or established invariant. Engineering Quality may support
such a finding, but an EQ-only observation is excluded. Differences from
optional planning guidance are not findings. The contract has no
`deferredCoverage` channel: omit an EQ-only candidate instead of sending it to
analysis or triage (ADR-0030 and ADR-0050).

For example, a task that removes an authorization check required by an accepted
ADR is an ordinary safety and architecture finding, even if an EQ rule also
supports it. A preference to extract a helper solely to reduce function length,
without a violated requirement or invariant, is an excluded EQ-only observation.

Return only the dedicated structured result. Echo the review number and exact
ordered scope; use P<N>-F<M> finding identities and concrete evidence. Return
zero findings when no qualifying concern exists. Provide no verdict, approval,
gate, implementation completion or task checks. Write no files and do not
request another review.
