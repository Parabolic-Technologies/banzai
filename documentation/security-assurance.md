# Security Assurance Policy

Maintainer notes for the Security Assurance policy shipped in
`plugins/banzai/policies/security-assurance.md`. The policy itself is product source and is the
authoritative text; this file explains why it has the shape it does and how to
change it. See ADR-0027.

## What it does

It gives the planning skills a positive mechanism for eliciting security
requirements. Before it existed, security appeared in the plugin only as a
gate: an escalation trigger on topic words, a hard rule against unapproved
security changes, and downstream prioritization in `test-writing` plus a
`security` finding category in `feature-review`. The three planning skills
carried no security vocabulary at all, so a feature whose topic was not
security but whose surface was — a report export, a search filter, a profile
cache — produced no requirement, no enforcement point, and therefore no
evidence for anyone downstream to check.

## Why exposure classes rather than keywords

Keyword matching is the failure mode being fixed. A trigger list can never
enumerate every feature with an attack surface, and widening it degrades
routing for work that is usually benign. The seven classes are stated as
mechanisms — untrusted input reaching an interpreter, an access decision,
secret material, personal data, cross-principal reachability, influenced
outbound destinations, destructive effects — so they apply to a feature whose
description never uses a security word.

## Why proportionate rather than mandatory

A mandatory questionnaire in every artifact renders `N/A` on most changes,
which violates this repository's artifact rule that every line be a decision,
requirement, command, file, verification, or follow-up. Ceremony that is always
present is skimmed exactly when it matters. The policy therefore mirrors the
Test Assurance precedent (ADR-0013): demand evidence where a mechanism exists,
permit an explicit justified "none" in one line, and reject hollow entries.

## Why lite routes still work

Applicable exposure alone does not force strict mode. Only introducing or
widening a control escalates; complying with an already established, unchanged
control does not. Without that rule nearly all work would escalate, engineers
would route around the workflow, and the net effect would be less security
rather than more. This is why the packaged manifest template asks adopted
projects to record their established controls: it is what makes "already
established" checkable.

## Division of labor

The escalation trigger governs work whose topic is security. The exposure
review governs work whose topic is not. Both remain in force; neither replaces
the other. The trigger list is deliberately unchanged.

## Changing the policy

The seven classes and the proportionality rules are an accepted architectural
decision. Adding, removing, or redefining a class changes the plugin's public
behavior contract for every adopted project, so it goes through a superseding
ADR rather than a silent edit. Wording that does not change which work is in
scope may be edited directly.

`packages/orchestrator/scripts/check-release.mjs` asserts that the policy
heading exists exactly once and that every skill required to reference it still
does. If a skill legitimately stops consuming the policy, update that check's
required list in the same change.

## Scope

The policy governs requirement elicitation. It is not a vulnerability scanner,
a dependency or CVE audit, a threat-model document type, or a compliance
framework mapping. A dedicated post-implementation security audit remains
possible complementary work; ADR-0027 records why it is not a substitute for
upstream elicitation.
