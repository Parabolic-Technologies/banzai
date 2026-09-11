# Development Plan: Structural Compatibility Fixture

## Plan Authority

Applicable approved requirements, accepted ADR constraints, public and persisted
contracts, security and authorization boundaries, transaction and lifecycle
guarantees, compatibility, scope, and required verification evidence are binding.
Exact internal details remain binding when required by applicable authority or
concrete constraints; unlabelled explicit directives remain binding.

Only paragraphs or list items prefixed `Optional implementation guidance:` are
non-binding suggestions. A label covers that paragraph or list item, including
its nested content, and ends before the next sibling block. A different compliant
implementation within approved scope needs no reapproval, finding or deviation
report merely for differing from this guidance.

Guidance never overrides binding authority or expands scope. Resolve conflicts
and ambiguous commitments before dependent work; missing or ambiguous optionality
does not waive an explicit commitment.

## Implementation Tasks

- [ ] **T001 - Implement the fixture**

  Write fixture output to `src/example.txt` and retain required report evidence.

  Optional implementation guidance: use a private `writeFixture` helper.

  - Optional implementation guidance: organize the local write as two steps.
    - Prepare the text.
    - Write the output.

  This following sibling remains binding: preserve the approved task identity.

## Consistency Check

This is synthetic parser/approval/completion input, not semantic trial evidence.
