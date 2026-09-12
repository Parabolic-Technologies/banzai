# ADR 0020: Scoped Claude Subprocess Environment

## Status / Date / Owner / Decision Makers

- Status: Accepted
- Date: 2026-08-17
- Owner: Banzai maintainers
- Decision makers: User, explicitly accepted in chat on 2026-08-17

## Related Artifacts

- Feature description:
  `documentation/features/bounded-model-invocation-cost/description.md`
- Repository authority: `AGENTS.md`
- Manifest: sections 2, 3, 5, 6, 8, and 10 of `PROJECT_MANIFEST.md`
- Related ADRs:
  - ADR 0002, Session affinity and bounded reviewer continuity
  - ADR 0011, Protected live vendor compatibility
  - ADR 0019, Attempt-owned review candidates
  - ADR 0021, Failure-classified reviewer continuity

## Context and Decision Drivers

`buildClaudeArguments`, `buildClaudeSelectionArguments`, and
`buildClaudePhaseArguments` in `packages/orchestrator/src/adapters.ts` pass a
built-in tool allowlist plus `--disallowedTools`. Neither list mentions `mcp__*`,
and `--tools` governs only the built-in tool set. `--strict-mcp-config`,
`--mcp-config`, `--setting-sources`, `--settings`, and `--bare` appear nowhere in
`src/`.

Consequence: every Banzai-spawned Claude session loads the operator's entire
ambient Claude Code environment — every configured MCP server, every installed
plugin, every skill, and every slash command. The reviewer cannot call an MCP
tool because `--tools` excludes it, yet pays for all of their schemas. Tool
definitions sit at the head of the cached prefix, so the cost recurs on every API
round-trip.

Measured in the source run recorded in the feature description, one review
attempt spent about 36,600 tokens per round-trip on 78 unusable MCP tool schemas
across 42 round-trips: roughly 1.54M of its 2,385,435 input tokens, about 64% of
that attempt's entire input. The same project's earlier reviews, same phase and
same six built-in tools, cost a 22,036–22,934 token prefix when the operator's
MCP servers had not yet connected.

This is a property of Banzai's invocation contract, not of one operator's setup.
Any user with MCP servers installed pays it, and the cost scales with servers
added for entirely unrelated reasons. It also makes Banzai's own reviewer
behaviour non-reproducible across machines.

The constraint that makes this non-trivial: `prompts.ts` instructs the model to
load the installed `$banzai:feature-review` skill through the `Skill` tool, and
`plugins/banzai/hooks/spec-gate.cjs` enforces the approved bundle. Both arrive
through plugin and settings discovery. Restricting discovery without explicitly
re-supplying the Banzai plugin silently breaks skill loading and hook
enforcement — a correctness and enforcement regression far worse than the token
cost.

`buildClaudeArguments` already has a precedent for explicit plugin supply: the
`request.liveCompatibility` branch passes `--plugin-dir`, and ADR 0011 relies on
that path to produce Claude permission evidence.

### Empirical findings

Measured against `claude` 2.1.233 in a project with three user-scope MCP servers,
using the review tool set and prompt shape:

| invocation                                                    | builtin | mcp | skills | cmds | turn-1 prefix |
| ------------------------------------------------------------- | ------- | --- | ------ | ---- | ------------- |
| current shape                                                 | 5       | 30  | 60     | 92   | 42,201        |
| `+ --strict-mcp-config`                                       | 5       | 0   | 60     | 92   | 27,766        |
| `+ --setting-sources ""` `+ --plugin-dir`                     | 5       | 0   | 28     | 60   | 16,581        |
| `+ --setting-sources project` `+ --plugin-dir`                | 5       | 0   | 28     | 60   | 19,799        |

- `--strict-mcp-config` with no `--mcp-config` loads zero MCP servers. The
  `system/init` event reports `mcp_servers: []`. It changes nothing else: skills,
  commands, plugins, and hooks are unaffected.
- `--setting-sources ""` removes the Banzai plugin entirely; `banzai:*` skills
  disappear from `system/init`. It also removes project `CLAUDE.md` discovery: a
  probe project whose `CLAUDE.md` declares a magic token answered `NONE` under
  `""` and answered with the token under `project`.
- `--setting-sources project` preserves project `CLAUDE.md` and project settings
  while dropping the operator's user-scope plugins, skills, and commands.
- `--plugin-dir <banzai>` restores every `banzai:*` skill under both scoping
  values, and the `Skill` tool successfully launches `banzai:feature-review`.
- The packaged hook still enforces under scoping. With `BANZAI_RUN_ID` set and no
  active run file, a `Write` attempt was denied with
  `banzai spec-gate: orchestrated write denied: …` and the target file was
  unchanged, under both `--setting-sources ""` and `--setting-sources project`,
  and with the plugin supplied from both the marketplace cache and a repository
  checkout.
- `--bare` is unusable here: it forces `ANTHROPIC_API_KEY` or `apiKeyHelper`
  authentication and never reads OAuth or the keychain, which the manifest's
  subscription-only constraint forbids.
- `--safe-mode` and `--disable-slash-commands` disable the Banzai plugin, its
  skills, and its hooks, so both destroy enforcement.

### Plugin directory resolution

The orchestrator is a private workspace installed with `npm link`, so its bundle
always runs from a checkout that contains `plugins/banzai`. Resolving
`import.meta.url` and walking three directories up from
`packages/orchestrator/dist/banzai.mjs` yields `<checkout>/plugins/banzai`,
verified on the current install. This copy is also the copy whose contract JSON
is compiled into the bundle by `src/contracts.ts`, so re-supplying it binds skill,
hook, and contract versions to one source instead of to whichever marketplace
version the operator happens to have cached.

That resolution is not guaranteed for every conceivable distribution shape. A
published npm package would not carry `plugins/`, and a future packaged release
could relocate it.

Decision drivers:

- make the spawned agent's environment a Banzai contract, not an operator
  side effect;
- never trade hook enforcement, skill availability, or project instructions for
  a token saving;
- keep reviewer behaviour reproducible across machines;
- degrade safely and observably when the plugin cannot be re-supplied;
- give operators an explicit override rather than a hardcoded policy;
- add no dependency and no new vendor call.

## Options Considered

### Option 1: Keep ambient discovery and extend the disallowed tool list

Add `mcp__*` patterns to `--disallowedTools`.

Benefits:

- one-line change;
- no plugin resolution problem.

Costs and rejection reason:

- `--disallowedTools` gates invocation, not definition loading; the schemas are
  still sent, so the cost is unchanged;
- MCP servers still start, so `pending` / `connected` races still change the
  inventory between attempts.

Rejected because it does not address the measured cost at all.

### Option 2: Isolate MCP only

Always pass `--strict-mcp-config` with no `--mcp-config`.

Benefits:

- removes the dominant and best-evidenced cost, 14,435 tokens per round-trip in
  the probe and about 36,600 in the source run;
- cannot affect skills, plugins, hooks, or project instructions, so it carries no
  enforcement risk;
- removes the MCP `pending` / `connected` race that invalidates resumed prefixes.

Costs:

- leaves the operator's unrelated plugins, skills, and commands in the prefix,
  worth a further 11,000+ tokens per round-trip in the probe;
- leaves reviewer behaviour dependent on the operator's installed skill set.

Viable but incomplete on its own.

### Option 3: Isolate MCP and scope setting sources, re-supplying the Banzai plugin

Always pass `--strict-mcp-config`. Additionally pass
`--setting-sources project` together with `--plugin-dir <resolved banzai plugin>`
when, and only when, that directory resolves and validates.

Benefits:

- removes both cost sources: 42,201 to 19,799 turn-1 prefix in the probe, a 53%
  reduction, and below the project's own zero-MCP historical baseline;
- keeps `banzai:*` skills, the packaged hook, and the target project's own
  `CLAUDE.md` — all three verified empirically;
- binds the reviewer's skills and hook to the same plugin copy that produced the
  orchestrator's compiled contracts;
- makes the invocation reproducible across operators.

Costs and risks:

- depends on resolving a plugin directory, which is not guaranteed for every
  distribution shape;
- drops the operator's project-local `.claude/settings.local.json`, which some
  projects use for permissions;
- an end-user project that enables the Banzai plugin through project settings
  could see it supplied twice.

### Option 4: Full isolation with `--setting-sources ""`

As Option 3 but with `""`.

Benefits:

- the smallest measured prefix, 16,581.

Costs and rejection reason:

- removes the target project's `CLAUDE.md` and `AGENTS.md`, which are Banzai
  product content installed into end-user projects and describe authority order,
  roles, routing, gates, and the hook contract;
- silently changes what the reviewer is judging against, which is a correctness
  regression bought for 3,218 tokens.

Rejected: the saving does not justify removing the project's own instructions.

### Option 5: `--bare`

Benefits:

- the strongest possible isolation.

Costs and rejection reason:

- requires `ANTHROPIC_API_KEY` or `apiKeyHelper` and never reads OAuth or the
  keychain. The manifest's load-bearing constraint is individual-subscription
  authentication with API keys rejected and stripped.

Rejected as incompatible with Banzai's authentication model.

## Decision

Adopt Option 3, with Option 2 as its mandatory safe degradation.

Pass `--strict-mcp-config`, with no `--mcp-config`, on every Banzai-spawned
`claude` process — selection, phase, and review — unconditionally. This is not
conditional on any resolution succeeding.

Additionally pass `--setting-sources project` together with one
`--plugin-dir <directory>` naming the packaged Banzai plugin, but only when that
directory has been resolved and verified to contain a readable
`.claude-plugin/plugin.json`. Resolve it from the running bundle's own location.
When resolution or verification fails, omit both flags, keep ambient setting-source
discovery, and record the degradation as an observable event. Never emit
`--setting-sources` without a verified `--plugin-dir`.

Do not use `--bare`, `--safe-mode`, or `--disable-slash-commands`.

Expose the behaviour in `.banzai/config.json` as an optional section with three
states: the isolating default, an explicit operator-supplied plugin directory,
and an explicit opt-out that restores the pre-change ambient invocation. An
explicit operator-supplied directory that fails verification is a configuration
error and must fail closed with a typed code rather than degrade silently. An
absent section selects the isolating default, so existing configuration files
need no migration.

The live-compatibility seam keeps its existing `--plugin-dir` and
`--include-hook-events` behaviour and must not receive a second, conflicting
plugin directory.

Treat the resulting invocation as a Banzai contract: the spawned agent is
guaranteed the Banzai plugin, the target project's own instructions, the declared
built-in tool set, and nothing else.

## Consequences

Positive consequences:

- the measured turn-1 prefix drops from 42,201 to 19,799 in the probe and is
  expected to drop from roughly 59,500 to under 23,000 in the source run's shape;
- cost stops scaling with MCP servers and plugins the operator installed for
  unrelated reasons;
- reviewer and builder behaviour becomes reproducible across machines;
- the reviewer's skills and hook come from the same plugin copy as the compiled
  contracts;
- the MCP `pending` / `connected` inventory race disappears, which removes the
  dominant cause addressed by ADR 0021's session-inventory rule.

Negative consequences and risks:

- Banzai now depends on locating its own packaged plugin; a future distribution
  shape that relocates `plugins/` silently degrades to MCP-only isolation, which
  must therefore be observable in events and `banzai doctor`;
- projects relying on `.claude/settings.local.json` for permissions lose it
  inside Banzai-spawned sessions;
- an end-user project that also enables the Banzai plugin through project
  settings may load it twice, which must be verified not to duplicate skills;
- pinning the plugin to the orchestrator's sibling copy means an operator who
  updates the marketplace plugin without updating the orchestrator no longer sees
  the newer skills inside runs; this is intended, and is a behaviour change;
- the isolating default changes what existing installations send to the vendor,
  so the change must be described in the README and release notes.

Required follow-ups:

- implement unconditional MCP isolation, verified plugin resolution, conditional
  setting-source scoping, and the configuration surface;
- emit an event and a `banzai doctor` signal for the degraded path;
- record the resolved invocation identity so ADR 0021 can compare it across
  resumption;
- update the manifest, README, and packaged documentation;
- gather real-run before/after prefix evidence as required by the feature
  description's NFR2.

## Compliance and Confirmation

Implementation and review must confirm all of the following:

1. a real orchestrated review's retained `system/init` event reports zero
   `mcp__*` tools and an empty MCP server list;
2. the same review's turn-1 prefix is at or below the project's 22,036–22,934
   zero-MCP historical baseline, reported as a before/after pair;
3. the same review's retained stream shows a successful `Skill` call for
   `banzai:feature-review` and the run publishes a valid canonical review
   artifact;
4. hook enforcement still denies an unauthorized write under the scoped
   invocation, evidenced by a `banzai spec-gate` denial and an unchanged target
   file;
5. the target project's own `CLAUDE.md` remains visible to the spawned model;
6. an unresolvable plugin directory produces MCP-only isolation with ambient
   setting sources, an observable degradation event, and unchanged enforcement;
7. an explicitly configured but unverifiable plugin directory fails closed with a
   typed code and starts no process;
8. an explicit opt-out reproduces the pre-change argument vector exactly;
9. an absent configuration section loads without migration and selects the
   isolating default;
10. the live-compatibility path still produces its correlated `Write`, hook, and
    tool-result evidence with exactly one plugin directory;
11. subscription-only authentication, API-key stripping, reviewer read-only
    guarantees, exact-path reviewer-write authorization, approved bundle
    immutability, workspace drift detection, and human triage are unchanged;
12. `npm run verify` passes and the committed bundle is rebuilt in the same
    change.

## Lifecycle Links

- Amended by [ADR-0042](./0042-runner-delivered-phase-instructions.md), accepted
  2026-09-11: runner phase confirmation uses deterministic instruction delivery
  and separately reported resource parity instead of successful skill calls.
  Retain eleven-skill structural verification, hooks and existing scope/failure
  boundaries. Implementation of this amendment is Planned.
- Supersedes: None
- Superseded by: None
- Amended by: ADR-0022, Availability-gated Serena MCP whitelist (Accepted
  2026-08-18). It narrows one consequence of this decision: a scoped session
  loads the resolved Serena whitelist rather than nothing, and zero MCP servers
  only when no whitelist resolves. This ADR remains Accepted and its body above
  is unchanged; read the MCP consequence together with ADR-0022.
