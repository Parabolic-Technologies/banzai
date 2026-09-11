# ADR 0022: Availability-Gated Serena MCP Whitelist

Publication note (2026-09-09): private operational identifiers were removed at
the project owner's request. The accepted decision and lifecycle are unchanged.

## Status / Date / Owner / Decision Makers

- Status: Accepted
- Date: 2026-08-18
- Owner: Banzai maintainers
- Decision makers: User, explicitly accepted in chat on 2026-08-18

## Related Artifacts

- Feature description:
  `documentation/features/bounded-model-invocation-cost/description.md`
- Repository authority: `AGENTS.md`
- Manifest: sections 5 and 6 of `PROJECT_MANIFEST.md`
- Related ADRs:
  - ADR 0002, Session affinity and bounded reviewer continuity
  - ADR 0020, Scoped Claude subprocess environment
  - ADR 0021, Failure-classified reviewer continuity

## Context and Decision Drivers

ADR 0020 established deterministic MCP isolation. Every Banzai-spawned `claude`
process carries `--strict-mcp-config` with no `--mcp-config`, which loads zero
MCP servers. The measurement behind it is not in dispute: 78 ambient MCP tool
schemas cost roughly 36,600 tokens per round-trip in the source run, and the
probe's turn-1 prefix fell from 42,201 to 19,799 tokens under scoping.

That decision rested on an unstated premise — that the spawned agent *cannot
call* the ambient servers, so their schemas are pure cost. The premise holds for
the servers ADR 0020 measured. It does not hold for every server. A semantic
code-navigation server is exactly the tool a planning, implementation, or review
phase would use, and paying for its schema buys capability rather than waste.

Run `[historical run identifier omitted]`
shows what the unconditional rule costs in practice. Every retained Claude
`system/init` event reports:

```json
"tools":["Bash","Edit","Glob","Grep","NotebookEdit","Read","Skill","StructuredOutput","Write"],
"mcp_servers":[]
```

No `mcp__*` tool is present in any attempt. The Codex planning attempt
`plan-1-abc4f1ce` issued 94 `command_execution` items and zero `mcp_tool_call`
items; the retained stream shows the phase navigating the project with
`sed -n 1,320p`, `grep -n`, `rg --files`, and `tail -n 180` — line-window reads
standing in for symbol navigation. The same checkout is onboarded to Serena
(`.serena/project.yml` present) and both vendors have Serena registered in their
own configuration, with vendor-specific contexts:

| vendor | registration source              | args                                                            |
| ------ | -------------------------------- | --------------------------------------------------------------- |
| claude | user-scope `.claude.json`        | `start-mcp-server --context=claude-code --project-from-cwd`     |
| codex  | `~/.codex/config.toml`           | `start-mcp-server --context=codex-lean --project-from-cwd`      |

Codex reached the same end state by a different route. Banzai passes no MCP
flags to `codex exec` at all, so Codex loads whatever `~/.codex/config.toml`
declares. Serena is enabled there, yet the planning attempt made no MCP call —
and Banzai neither guaranteed its presence nor excluded the operator's unrelated
servers (`node_repl`, `openaiDeveloperDocs`) from orchestrated runs. Codex was
neither isolated nor provisioned; it was simply unmanaged.

Four drivers follow.

**Capability, not just cost.** ADR 0020 optimized a single quantity. A phase
that cannot navigate semantically substitutes more, cheaper reads, and the
saving is partly reallocated rather than realized.

**Vendor-specific definitions.** Serena is invoked differently per vendor. Any
mechanism that authors its own definition will get the context flag or the
project resolution wrong, and will drift as Serena releases.

**Availability is not guaranteed.** Serena may be absent from PATH, unregistered
for one vendor, disabled, or the checkout may not be onboarded. None of these
may block a run, and each must be distinguishable when the whitelist is smaller
than expected.

**Codex was never actually whitelisted.** Whatever is decided for Claude must
also close the Codex gap, or "whitelist" describes only half the runner.

## Options Considered

### Option 1: Keep zero MCP servers

Change nothing. The prefix stays minimal and ADR 0020 stands unmodified.

Rejects the evidence rather than answering it. Phases keep substituting
line-window reads for symbol navigation, and the substituted reads are not free.
Also leaves Codex unmanaged: the operator's unrelated servers keep loading into
orchestrated runs.

### Option 2: Restore ambient MCP discovery

Drop `--strict-mcp-config`, or direct operators to `claudeEnvironment.mode:
"ambient"`.

Reimports the entire cost ADR 0020 removed, and with it the `pending` /
`connected` MCP inventory race that ADR 0020 eliminated and ADR 0021's
session-inventory rule was written against. Trades a measured, bounded problem
for an unbounded one to solve a narrow need.

### Option 3: Whitelist Serena from a Banzai-authored definition

Keep strict isolation and inject a Serena definition the orchestrator composes
itself.

Removes the dependency on operator registration, which is its only advantage. It
requires Banzai to know each vendor's correct context flag and project-resolution
strategy, encoded in orchestrator source and silently wrong whenever Serena
changes them. Banzai would be inventing configuration it is not the authority
for.

### Option 4: Whitelist Serena, read from each vendor's own registration, gated on availability

Keep strict isolation and re-admit exactly Serena, taking each vendor's
definition from that vendor's own registration and emitting it only when a
sequence of availability gates all pass.

Costs Serena's tool schemas in the prefix — the price being deliberately paid —
and adds one short-lived probe process per run. Introduces a dependency on
`codex mcp get --json` output shape, which is a published read surface rather
than an internal file format.

### Option 5: Operator-configurable whitelist in `.banzai/config.json`

Let operators name any set of servers to admit.

Most flexible and the natural end state if more servers earn their place. Today
no evidence identifies a second server that does, and every added name reimports
a share of the cost ADR 0020 removed. Shipping the general mechanism before the
evidence that needs it inverts the order this repository has followed elsewhere.

### Option 6: Per-role whitelist

Admit Serena for some roles only — for example planning and review, not fixes.

Plausibly correct, and unfounded today: no run has yet been observed *with*
Serena admitted, so there is no evidence about which roles use it and which pay
for schemas they ignore. Deciding now would be guessing.

## Decision

Adopt Option 4. Defer Options 5 and 6 until run evidence justifies them.

Resolve a Serena whitelist once per run, in `mcp.ts`, before any phase starts.
Resolution never throws: each gate that fails records a human-readable reason and
yields an absent entry for that vendor.

Apply these gates in order:

1. the checkout is onboarded to Serena — `.serena/project.yml` is readable;
2. the vendor has Serena registered, read from that vendor's own configuration —
   the project's `.mcp.json` then the user-scope `.claude.json` for Claude, and
   `codex mcp get serena --json` for Codex;
3. for Codex, the registration is `enabled` and uses the `stdio` transport;
4. the registered command resolves on the same sanitized `PATH` the vendor child
   will receive.

Never author a Serena definition. Each vendor's command, arguments, environment,
and startup timeout come from that vendor's own registration verbatim, so each
runs Serena in the context it registered.

Emit the resolved whitelist through each vendor's sanctioned mechanism:

- Claude receives `--mcp-config <inline JSON>` **beside** the unchanged
  `--strict-mcp-config`. Strict mode with an explicit config loads exactly the
  named servers and nothing ambient, which is the extension point ADR 0020's own
  analysis identified;
- Codex receives one `-c mcp_servers={serena={…}}` override that replaces the
  whole `mcp_servers` table, on fresh and resumed invocations alike. Table
  replacement — not merging one key — is what makes this a whitelist on the
  Codex side, and it closes the gap where the operator's unrelated servers
  loaded into orchestrated runs.

When no whitelist resolves, both vendors' argument vectors stay byte-identical to
their pre-change form. Zero MCP servers remains the fallback, not the default
outcome.

Report the resolution once per run as a progress line and a durable
`mcp_whitelist.resolved` event carrying both vendors' outcomes and every reason.

Expose resolution on `VendorAdapters` as an **optional** member. Test doubles
that do not implement it resolve to no whitelist, so workflow tests spawn no
vendor CLI and their argument vectors are unchanged.

ADR 0020's plugin resolution, setting-source scoping, degradation behaviour,
`claudeEnvironment` configuration surface, and unconditional `--strict-mcp-config`
all stand. This decision narrows exactly one of its consequences: a scoped
session loads the resolved whitelist rather than nothing.

## Consequences

Positive consequences:

- phases regain semantic navigation on a Serena-onboarded checkout instead of
  substituting line-window reads;
- each vendor runs Serena in the context it registered, so Banzai encodes no
  vendor-specific invocation knowledge and does not drift as Serena changes;
- Codex becomes whitelisted rather than unmanaged: orchestrated runs no longer
  load the operator's unrelated servers;
- a missing, unregistered, disabled, or unresolvable Serena is reported with a
  reason instead of failing or silently degrading;
- runs without Serena are byte-identical to their pre-change form, so the
  change is inert where it does not apply.

Negative consequences and risks:

- Serena's tool schemas re-enter the cached prompt prefix on every round-trip.
  This is a deliberate, bounded reversal of part of ADR 0020's saving, and it
  must be measured against real runs rather than assumed acceptable;
- the whitelist is global across roles, so a role that never calls Serena pays
  for its schemas — the condition Option 6 would address once evidence exists;
- Banzai now depends on `codex mcp get --json` output shape; a change there
  degrades to "not registered" rather than failing, but silently loses the
  Codex side;
- one additional short-lived `codex` process starts per run for the probe;
- replacing the Codex `mcp_servers` table removes any other server an operator
  deliberately relied on inside runs, which is intended and is a behaviour
  change;
- the change alters what existing installations send to both vendors and must
  be described in the README and release notes.

Required follow-ups:

- gather before/after prefix and cost evidence from a real orchestrated run with
  the whitelist active, and record whether phases actually call Serena;
- revisit Option 6 if that evidence shows a role paying for schemas it ignores;
- revisit Option 5 only if a second server is shown to earn its schema budget.

## Compliance and Confirmation

Implementation and review must confirm all of the following:

1. a checkout without `.serena/project.yml` resolves to no whitelist, records
   that single reason, and starts no vendor probe;
2. each vendor's resolved definition matches that vendor's own registration
   verbatim, including its distinct `--context` argument;
3. the project's `.mcp.json` takes precedence over the user-scope
   `.claude.json` for Claude;
4. a registered command that does not resolve on the sanitized `PATH` disables
   that vendor with a reason and leaves the other vendor unaffected;
5. every Codex probe failure mode — unregistered, disabled, non-`stdio`,
   unparseable, and spawn failure — yields a reason and no entry, never a thrown
   error;
6. a configuration with no Codex role runs no probe and records no Codex reason;
7. Claude's argument vector places `--mcp-config` immediately after the
   unchanged `--strict-mcp-config`, and a real `claude` invocation with that
   vector reports Serena `connected` with `mcp__serena` tools present;
8. Codex's argument vector carries the `mcp_servers` table-replacing override on
   both fresh and resumed invocations, and a real `codex exec` with that vector
   completes an `mcp_tool_call` against Serena;
9. an absent whitelist reproduces both vendors' pre-change argument vectors
   exactly;
10. the resolution is reported once per run and recorded as an
    `mcp_whitelist.resolved` event with both outcomes and all reasons;
11. workflow tests using adapter doubles spawn no vendor CLI and their argument
    vectors are unchanged;
12. ADR 0020's plugin resolution, setting-source scoping, degradation event,
    `banzai doctor` signal, and `claudeEnvironment` states are unchanged;
13. subscription-only authentication, API-key stripping, reviewer read-only
    guarantees, approved bundle immutability, workspace drift detection, and
    human triage are unchanged;
14. `npm run verify` passes and the committed bundle is rebuilt in the same
    change.

## Lifecycle Links

- Supersedes: None
- Superseded by: None
- Amends: ADR-0020, whose "loads zero MCP servers" consequence becomes "loads
  the resolved whitelist, and zero servers when none resolves". Every other part
  of ADR-0020 stands unchanged, its status remains Accepted, and its body is
  untouched; the amendment is recorded in its lifecycle metadata.
