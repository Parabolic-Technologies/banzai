# Architecture Decisions

Central decision log for architecturally significant choices.

## Decision Index

`None` until the first ADR is proposed. Keep one row per ADR:

| ID | Title | Status | Date | Related feature |
| --- | --- | --- | --- | --- |

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
3. related feature, plan, manifest sections, and ADR links;
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
statuses in this log; list only active accepted ADRs in `PROJECT_MANIFEST.md`
with implementation state `Planned` or `Implemented`.

The implementation hook does not interpret ADR status. Human acceptance is the
explicit `architecture-decision` decision gate, answered in the `banzai` CLI
during an orchestrated run and in chat otherwise.
