# Engineering Quality Maintainer Guide

## Purpose and authority

The canonical Engineering Quality policy is the single
`## Engineering Quality` section in `plugins/banzai/policies/engineering-quality.md`. This guide
explains how Banzai delivers and evolves that policy; it is not a second policy
source. ADR-0030 owns the accepted architectural decision and deferred choices.

The policy protects repository-relative engineering properties. It does not
select an architecture methodology, coding paradigm, directory layout, design
pattern, function size, or test count. Approved product intent and repository
facts remain above generic preferences under the policy's authority order.

## Vendor-neutral delivery

ADR-0036 places process rules in packaged `AGENTS.md` and keeps `CLAUDE.md`
as its include shim. Each policy has one owner file under `plugins/banzai/policies/`.
Consuming skills read applicable policies relative to their installed `SKILL.md`
before the affected responsibility. The Sources matrix distinguishes required
and conditional reads; neither `test-writing`, `feature-status` nor the
supervisor independently reads Engineering Quality.

Skills and orchestrator prompts carry short references and phase-specific
responsibilities. Projects receive process text and an index, never copied
policy bodies. Legacy projects stop until an explicitly invoked
`project-manifest` migration diff is approved; partial layouts stop for
resolution. See [the migration procedure](../plugins/banzai/skills/project-manifest/references/layout-migration.md).
Automatic ingress, tool reads and application need separate host evidence;
filenames and source tests do not establish effective delivery. Policy semantics
remain independent of Claude tools, hooks, permissions, commands and sessions.

Do not add a loader, policy engine, skill, phase, hook, gate, or contract version
solely to obtain a vendor-neutral filename.

## Why ten rules

The ten-rule shape deliberately merges related properties so agents have a
small vocabulary:

- repository authority governs local context and convention conflicts;
- responsibility boundaries and dependency edges cover structural quality;
- contracts, ingress, failure meaning, and resource lifecycle cover behavioral
  boundaries;
- proportional design and bounded scope constrain needless machinery;
- assurance ownership and compatibility connect claims to existing evidence;
- incremental evolution constrains risk in legacy areas.

The canonical section owns the exact rule names and normative wording. Other
documents may explain the grouping but should link to that section instead of
reproducing all ten rules.

## Existing workflow projection

Engineering Quality is projected through existing responsibilities:

| Surface            | Responsibility                                                                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| Manifest discovery | Record only load-bearing repository facts relevant to later work.                                                                    |
| Requirements       | Express materially applicable observable constraints as ordinary requirements and acceptance criteria.                               |
| ADRs               | Use applicable properties as decision drivers without preselecting a pattern.                                                        |
| Plans              | Name changed boundaries, dependency and compatibility effects, lifecycle constraints, and evidence owners in existing plan sections. |
| Implementation     | Apply approved authority, keep scope bounded, and record material deviations in existing reports.                                    |
| Review             | Complete the ordinary audit first, then classify overlap and record isolated shadow-only candidates.                                 |
| Triage and fixing  | Continue to use only ordinary human-triaged findings; shadow candidates have no authority.                                           |
| Resolution review  | Verify accepted-finding closure and admit new concerns only under the policy's convergence conditions.                               |
| Final acceptance   | Reuse existing completion, verification, review, and triage mechanisms; there is no EQ gate.                                         |

Test Assurance continues to select proportionate test evidence. Security
Assurance continues to classify changed exposure. Contract checks, configured
commands, and justified inspection may also own evidence. Engineering Quality
only detects when a material claim has no identifiable evidence owner.

## Shadow transport and evaluation

An ordinary finding may add one primary rule mapping in its existing `violates`
array after its finding status, severity, and verdict are frozen. A genuinely
incremental candidate uses an `EQ-SHADOW:` entry in the existing free-form
`deferredCoverage` array. That entry is a non-authoritative evaluation record,
not a `ReviewFinding`.

No runtime code parses or validates the proposed semantic fields. Shadow records
must not enter human triage, accepted-finding payloads, fixer scope, completion
logic, or verdict calculation. Sampled evaluators inspect canonical review
artifacts using the procedure in
`documentation/evaluation/engineering-quality-shadow.md`.

Orchestrated review uses one runner-rendered artifact: each structured
`EQ-SHADOW:` string survives as an opaque value in the canonical Deferred
Coverage section. Standalone reviewers own their Markdown and preserve any
structured shadow string byte-for-byte there. Standalone ordinary
deferred-coverage prose may remain independently worded. Neither mode parses or
interprets shadow entries, promotes them to findings, or adds an EQ contract.

## Evolution rules

Release validation may protect the canonical heading, rule identities, selected
invariant language, consuming references, shadow isolation, and closure-oriented
resolution wording. It must not attempt semantic source-code analysis or decide
whether a repository's architecture is good.

Changes to the normative rule text require an ADR-compatible decision and must
update the canonical section first. Keep phase projections brief and remove
copies rather than synchronizing them. Evaluate context cost, duplicate rate,
false positives, cross-reviewer disagreement, and convergence before expanding
the policy.

The following remain deferred and require separate approval:

- advisory EQ-only findings;
- any EQ-native blocking behavior;
- mandatory machine fields or a new versioned review/evaluation contract;
- automated shadow extraction or EQ KPI projection;
- relocation to a future vendor-neutral delivery mechanism;
- repository-specific static architecture rules.

Any future blocker proposal must also satisfy the canonical policy's accepted
high-confidence, exact-evidence, material-impact, approved-invariant, and
observable-closure threshold. Meeting that threshold is eligibility evidence,
not authorization for hard enforcement.

## Maintained instruction baseline

ADR-0044 preserves `packages/orchestrator/phase-guidance-baseline.json` and its
original canonical pin as immutable extraction evidence. Ongoing expectations
live in `phase-guidance-current.json` (`banzai-instruction-baseline/v1`) with a
separate `.sha256` pin and ordered transitions. Each transition retains exact
old/new resource or section identities, predecessor/successor expectation digests
and accepted public ADR/scope references. The first inventory also pins phase and
policy resources that were not individually pinned in the original extraction.

After an authorized instruction edit, run
`node packages/orchestrator/scripts/instruction-baseline.mjs --describe` for a
read-only scope proposal. Prepare a private authorization JSON with
`schema: "banzai-instruction-authorization/v1"`, `schemaVersion: 1`, the exact
`predecessorSha256`, ordered `scope` keys, and `authorities` entries containing
public ADR `path`, current `sha256` and a bounded `scope` explanation. Preview with
`--authorization <file> --check`, then invoke without `--check` to publish the
reviewable baseline/pin transition. Repeated matching invocation is idempotent.
An interrupted two-file publication retains a private journal; retry only the
same authorization and unchanged source. Mismatched partial inputs fail closed.

Build, tests, build:check and release checks never regenerate baselines. They
validate the original root, current pin, transition linkage, exact scope,
Accepted authority, normalized expectations and independent structural duties.
Retained Orchestrated Mode blocks, hook registration, plugin discovery and
version-only manifest normalization retain their original boundaries. An
unrecorded change remains `INSTRUCTION_RESOURCE_DRIFT`; changing hashes without a
valid transition does not authorize it. Hashes establish consistency, not human
approval or semantic correctness. Normal review and human gates still apply.
