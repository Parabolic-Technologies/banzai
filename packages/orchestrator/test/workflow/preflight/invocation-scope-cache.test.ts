import assert from "node:assert/strict";
import test from "node:test";
import type {
  ClaudeInvocationScope,
  McpWhitelist
} from "../../../src/types.js";
import { InvocationScopeCache } from "../../../src/workflow/preflight/invocation-scope-cache.js";

const SCOPE = { strictMcpConfig: true } as unknown as ClaudeInvocationScope;
const OTHER_SCOPE = {
  strictMcpConfig: false
} as unknown as ClaudeInvocationScope;
const WHITELIST = {
  claude: null,
  codex: null,
  notes: []
} as unknown as McpWhitelist;

test("an invocation scope reports degradation and its whitelist once per key", () => {
  const cache = new InvocationScopeCache();
  assert.equal(cache.matches("a"), false);
  cache.replace("a", { scope: SCOPE, degradedReason: "no plugin" }, WHITELIST);
  assert.equal(cache.matches("a"), true);
  assert.deepEqual(
    [cache.claimDegradationReport(), cache.claimDegradationReport()],
    [true, false]
  );
  assert.deepEqual(
    [cache.claimMcpReport(), cache.claimMcpReport()],
    [true, false]
  );

  cache.replace("b", { scope: SCOPE, degradedReason: "no plugin" }, null);
  assert.equal(cache.matches("a"), false);
  assert.equal(cache.claimDegradationReport(), true);
  assert.equal(cache.claimMcpReport(), true);
});

test("a fresh resolution updates the scope but keeps the key's whitelist", () => {
  const cache = new InvocationScopeCache();
  cache.replace("a", { scope: SCOPE, degradedReason: "no plugin" }, WHITELIST);
  assert.deepEqual(cache.merge({ scope: OTHER_SCOPE, degradedReason: null }), {
    key: "a",
    scope: OTHER_SCOPE,
    degradedReason: null,
    mcp: WHITELIST
  });
  assert.equal(cache.claimDegradationReport(), true);
});

test("separate caches never share reports", () => {
  const first = new InvocationScopeCache();
  const second = new InvocationScopeCache();
  for (const cache of [first, second])
    cache.replace("a", { scope: SCOPE, degradedReason: "no plugin" }, null);
  assert.equal(first.claimDegradationReport(), true);
  assert.equal(second.claimDegradationReport(), true);
});
