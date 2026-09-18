# ADR 0048: Completion Markup and Viewer Enrichment Boundary

## Status / Date / Owner / Decision Makers

- Status: Accepted
- Date: 2026-09-15
- Owner: Banzai maintainers
- Decision makers: Repository owner, explicit `Accept ADR-0048` on 2026-09-16.
- Rework: 2026-09-16, following independent review-4 of this proposal and the
  owner's explicit `Rework` decision. It addresses R4-F1 through R4-F7 inside the
  owner-selected direction; encoding, ledger, publication and review authority
  are unchanged. The status stayed Proposed until the decision recorded above.
- Resolution review: review-5 checked that closure against the reworked bytes and
  raised R5-F1 through R5-F3. The owner accepted those three findings and the
  revision applied them. Independent review-6 then passed the exact corrected
  proposal bytes before acceptance. Review-7 later identified that the lifecycle
  metadata omitted review-6 and promoted review-5 to a pass; the owner accepted
  R7-F1, and this metadata correction records the actual review sequence without
  changing the accepted decision body.
- Accepted proposal SHA-256:
  `eb0580cf1611c5ec8a70b4117c56836a95a54ae9ca83daf313f816692eaa5566`.
- Lifecycle note: proposal-era pending wording below, including its open
  independent-confirmation statement, is retained as reviewed history. This
  metadata records the later review-6 pass and acceptance. The dependent plan
  still needs its own exact bundle approval before implementation.
- Consultation: the owner selected protection against model-created Markdown/HTML
  syntax, with viewer enrichment of decoded plain text outside the guarantee and
  recorded as residual risk. Evidence must use no new dependency. This selection
  permits this proposal; it does not accept the ADR or approve implementation.

## Related Artifacts

- Private strict work: `runner-owned-completion-projection`; its plan review
  identified the distinction between syntax parsing and viewer autolinking, and
  its independent review-4 raised R4-F1 through R4-F7 against this proposal.
- [ADR-0047](./0047-runner-owned-completion-projection.md), section 3 and
  confirmation 3: completion encoding and the existing rendered-inertness claim.
- [ADR-0017](./0017-versioned-plan-task-completion-ledger.md) and
  [ADR-0025](./0025-fix-authored-completion-ledger-refresh.md): canonical claims.
- [ADR-0037](./0037-unified-runner-rendered-review-artifacts.md): independent review.
- [ADR-0044](./0044-instruction-baseline-evolution.md): any necessary instruction
  transition remains explicit and preserves prior authority.
- [Project manifest](../../PROJECT_MANIFEST.md), sections 7, 8 and 10;
  [module reference](../../packages/orchestrator/MODULES.md).

## Context and Decision Drivers

Decision question: what does the runner guarantee about model text in completion
cells when Markdown viewers can enrich decoded plain text after syntax parsing?

Accepted ADR-0047 requires JSON serialization followed by numeric references for
every ASCII punctuation character. It also requires rendered cells to create no
links, emphasis, code, images or HTML nodes, verified through a selected renderer.
These are different boundaries: encoded source can have no model-created markup
while a later viewer creates links from a plain URL or email address.

The existing Prettier 3.9.6 Markdown parser returns text-only cell nodes for
encoded URL, www and email fixtures. That demonstrates syntax interpretation,
not absence of later viewer transforms. Pinned upstream source establishes the
mechanism: [mdast-util-gfm-autolink-literal 2.0.1](https://github.com/syntax-tree/mdast-util-gfm-autolink-literal/blob/2.0.1/lib/index.js)
transforms decoded text into URL/email links; the autolink extension in
[cmark-gfm 0.29.0.gfm.13](https://github.com/github/cmark-gfm/blob/0.29.0.gfm.13/extensions/autolink.c)
also postprocesses text nodes for email links. These source inspections do not
claim an installed or executed renderer. An unknown host application's Markdown
viewer cannot supply reproducible evidence for the stronger guarantee.

The owner explicitly chose the source-syntax boundary and accepted display-only
viewer enrichment as residual risk. A later consultation answer specifying no
new dependency superseded an earlier test-only cmark-gfm authorization. This
proposal therefore adds neither a renderer dependency nor a provisioning duty.

## Options Considered

| Option | Benefit | Cost / disposition |
| --- | --- | --- |
| Keep ADR-0047's no-link claim across complete GFM rendering | Strong visual promise | Known decoded-text autolinking defeats that claim without a controlled renderer; a syntax parser cannot prove it. Reject for this scope. |
| Restrict the guarantee to a fixed renderer profile with autolinking disabled | Reproducible inert display within that profile | Adds a renderer/tooling boundary and leaves ordinary viewers outside it. Not the owner's selected direction. |
| Protect source syntax; allow display-only enrichment of decoded plain text | Keeps exact ledger representation, deterministic encoding and existing tooling; states the actual runner boundary | URLs/email can become clickable in viewers. Selected for proposal with that explicit residual risk. |
| Change encoding, use a code/HTML container or add another artifact | Could change how particular viewers process cells | Reopens ADR-0047's grammar or artifact ownership and does not control arbitrary viewer behavior. Outside this narrow amendment. |

## Decision

### 1. Protect Markdown/HTML syntax created from model characters

For new ADR-0047 completion cells, prohibit model characters from creating any
Markdown/HTML syntax: explicit links or images with separate targets, HTML,
emphasis, code, or a table/section breakout. Retain all other syntax protections,
not only the examples in this list.

Keep the exact accepted encoding: serialize each cell as JSON, encode every
ASCII punctuation character as a canonical decimal numeric reference, and decode
references exactly once before JSON parsing. Preserve admitted values, task order,
field bounds and deterministic output. Do not modify the v2 region grammar,
introduce invisible characters, reject valid URL/email text, or special-case
payloads to satisfy an assurance fixture.

The invariant concerns model-origin cell payloads. Runner-owned table syntax,
region delimiters and punctuation in generated numeric references are expected;
they are not model-authored syntax. Tests must distinguish those sources.

### 2. Make viewer enrichment an explicit residual risk

Autolink literals and similar display-only transformations applied by a viewer to
already decoded plain text are outside the syntax guarantee. A visible URL or
email may become clickable, and different viewers may present the same validated
bytes differently. This proposal records that owner-selected residual risk;
ADR lifecycle acceptance is still required before dependent implementation.

Presentation characters carried inside an admitted payload are outside the same
guarantee. Bidirectional overrides and isolates, zero-width characters and
homoglyphs pass the existing completion field bounds, survive the encoding
unchanged and satisfy every check in section 3, because decoded-value equality is
byte equality, not visual fidelity. Narrowing that admitted character set is a
field-bound decision with its own authority and evidence; it is not an encoder
change, and this amendment neither makes it nor weakens the current bounds.

This exception does not allow model-specified Markdown links with separate
labels/targets, images, HTML, code, or table breakout. Reinterpreting decoded
model markup as Markdown/HTML instructions is not mere plain-text enrichment.
No viewer transformation grants evidence admissibility, mutates the ledger, proves
achievement, authorizes a command or bypasses approval, scope, verification or
independent review. Machine validation uses retained bytes and decoded claims,
never rendered UI nodes or a clicked link.

### 3. Use the existing assurance boundary without new dependencies

Replace ADR-0047 confirmation 3's full-renderer inertness requirement with both:

1. A byte-level property for every model-origin cell payload: all serialized
   ASCII punctuation is represented by exactly the required generated numeric
   references, with no residual raw punctuation from the payload. Check exact
   reference spelling, single decoding, admitted value equality and deterministic
   bytes. Include a negative control with an unencoded markup delimiter, in the
   exact generated cell and row context it protects, so the assertion
   demonstrably detects an unsafe encoder.
2. The existing Prettier Markdown AST oracle, 3.9.6 as currently resolved, over
   complete generated tables: cell payloads parse as literal text with the exact
   JSON display value and no model-created syntax nodes or extra rows/sections.
   Cover every punctuation class, Unicode, literal entities, explicit link/image
   syntax with separate targets, HTML, emphasis/code delimiters, and URL/www/email
   strings. Use raw Markdown link/emphasis/HTML examples as positive controls for
   the parser's ability to detect real syntax, in the exact generated cell and row
   context they protect, and assert that each control actually produces its syntax
   node. Surrounding JSON quoting can suppress a literal that would create a node
   elsewhere, so a control asserted out of context can pass vacuously.

Retain all other ADR-0047 region, gap, roundtrip and legacy-v1 checks. Do not
claim the AST oracle checks every viewer, post-parse linkification or final HTML.
URL, www and email fixtures are admitted plain text, not failures merely because
a separate viewer might enrich them. If those values or any other payload create
syntax at the protected source/parse boundary, fail the test and stop dependent
work as the attribution rule below decides; do not expand the enrichment
exception to hide the failure.

Attribute an observed syntax node before acting on it. A node created from raw
payload characters at the source/parse boundary is a guarantee violation and
stops dependent work. A node the oracle's own parser derives from already decoded
plain text belongs to section 2's excluded enrichment class. Bind the oracle to
the Prettier version resolved in the repository lockfile when the evidence is
produced and record that exact version with the results; a lockfile move is not
an evidence upgrade. If the pinned parser itself begins transforming decoded
text, it no longer observes the protected boundary: record that, keep the
encoding, the byte property and the guarantee unchanged, and route the evidence
choice back to an explicit decision instead of silently redefining the boundary
or hiding a real failure.

Use no new dependency, external renderer binary, CI provisioning, network check
or Codex-viewer observation as required evidence. Keep Prettier test-only and its
existing repository dependency/lockfile identity. Loading its existing plugin
inside the bundled test harness may need a bounded harness adjustment, such as an
externals entry; that is permitted and is neither a dependency nor a runtime or
provisioning change. Record actual property/AST and roundtrip results in the
normal bound test report, with their stated limitations.

### 4. Amend only the affected requirement and decision clauses

FR4 and AC3 already record this boundary under the owner's answer identified as
`R3-F2-rendering-boundary`: FR4 keeps its deterministic-byte and admitted-value
requirements while defining markup protection as model-created source syntax with
viewer enrichment of decoded plain text excluded, and AC3 names the byte/AST
evidence. Accepting this ADR ratifies that recorded wording and authorizes no
further requirements edit; any later change keeps its own owner decision. This is
a guarantee-boundary decision, not a ledger shape, encoding or
publication-protocol change.

Narrowly amend exactly three ADR-0047 clauses, only as defined above: section 3's
statement that rendered model text cannot create links/nodes; the same section's
dependent-plan obligation to test the selected Markdown renderer, which the byte
property and parse oracle replace while its pinned canonical reference spelling
and delimiters stay binding; and confirmation 3's selected-renderer requirement.
Its validation, source/receipt provenance, lifecycle, history, region/gap
ownership, fix/retry/recovery, evidence and review constraints remain binding.
No other accepted decision body changes.

The dependent plan may adopt this boundary only after explicit acceptance. Its
normal plan-bundle gate and independent resolution review remain. Record
ADR-0047's reciprocal annotation and add this ADR to that bundle before the
approval digest pins their bytes; annotating an already approved bundle file
would invalidate that approval. Record any affected instruction wording through
ADR-0044's authorized transition; do not rewrite accepted historical bytes or
claim current implementation prematurely.

## Consequences

The runner can verify the claimed syntax boundary with existing local tooling.
Representation correctness remains independent of model formatting and viewer
enrichment. Required evidence becomes reproducible on either vendor's host.

The guarantee is narrower than ADR-0047's original full-renderer no-links wording.
Clickable plain-text URLs/email and other display-only enrichment remain an
explicit risk outside runner authority. There is no promise of identical final
HTML across viewers, safe navigation to a model-mentioned URL, or absence of
post-parse autolinks. Admitted payloads keep byte-exact decoded values rather
than guaranteed visual fidelity, so displayed order and visibility can differ
from the validated bytes. No such behavior becomes proof of task completion.

FR4 and AC3 already carry this documented boundary, so acceptance adds no further
requirements edit. Adding a renderer dependency, altering the accepted encoding,
narrowing admitted field bounds here, or requiring client-specific visual
evidence is excluded.

## Compliance and Confirmation

- Verify the complete ASCII punctuation property with exact generated-reference
  accounting and an unsafe-encoder negative control; verify roundtrip values.
- Parse full synthetic v2 regions with the existing lockfile-resolved Prettier,
  3.9.6 today. Include `https://example.com/x`, `www.example.com`,
  `user@example.com`, literal entity strings, and explicit syntax examples.
  Assert text-only cell payloads and stable table/region structure; positive
  controls must create real syntax nodes in the exact cell context they protect.
- Reports explicitly distinguish these source/AST checks from untested viewer
  enrichment. Do not report a full-renderer or Codex-viewer pass.
- Confirm no dependency, runtime renderer, CI provisioning, encoding, field-bound,
  publication, recovery or independent-review authority change was introduced. A
  bounded test-harness adjustment that loads the existing Prettier plugin is
  permitted and is none of those changes.
- Verify that the already recorded FR4 and AC3 wording matches this decision
  rather than requesting a further requirements edit, and record the exact
  Prettier version the oracle used. After acceptance, revise only the dependent
  plan's affected assurance obligations, carry normal resolution review and
  obtain exact plan-bundle approval before implementation.

Independent review-4 requested the clarifications incorporated here, and
resolution review-5 raised R5-F1 through R5-F3, applied above. Independent
confirmation of that resolution review remains open.

## Lifecycle Links

- Supersedes: None in full.
- Accepted narrow amendment: the three ADR-0047 clauses in section 3 and
  confirmation 3 named above. Its reciprocal lifecycle link was recorded on
  2026-09-16, before any plan bundle digest pins those bytes; its accepted body
  and existing historical meanings remain unchanged.
- Superseded by: None.
- Accepted on 2026-09-16 by the repository owner's explicit `Accept ADR-0048`.
- Next: revise only the dependent plan's affected assurance obligations, carry
  its independent resolution review and obtain approval of the exact plan bundle,
  which now includes this decision. ADR acceptance does not authorize code
  execution or delivery.
