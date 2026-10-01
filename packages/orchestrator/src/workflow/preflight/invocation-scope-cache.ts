import type { ResolvedClaudeInvocationScope } from "../../adapters.js";
import type { ClaudeInvocationScope, McpWhitelist } from "../../types.js";

export interface CachedInvocationScope {
  key: string;
  scope: ClaudeInvocationScope;
  degradedReason: string | null;
  mcp: McpWhitelist | null;
}

/**
 * The invocation scope a runner resolved for one Claude environment key. The
 * MCP whitelist is kept while the key is unchanged; each report is claimed at
 * most once per key.
 */
export class InvocationScopeCache {
  private current: CachedInvocationScope | null = null;
  private degradationReported = false;
  private mcpReported = false;

  matches(key: string): boolean {
    return this.current?.key === key;
  }

  /** Starts a new key: its whitelist replaces the old one and both reports re-arm. */
  replace(
    key: string,
    resolved: ResolvedClaudeInvocationScope,
    mcp: McpWhitelist | null
  ): void {
    this.current = { key, ...resolved, mcp };
    this.degradationReported = false;
    this.mcpReported = false;
  }

  /** Applies a fresh resolution to the current key's record. */
  merge(resolved: ResolvedClaudeInvocationScope): CachedInvocationScope {
    if (this.current === null)
      throw new Error("An invocation scope must be replaced before merging.");
    this.current = { ...this.current, ...resolved };
    return this.current;
  }

  claimDegradationReport(): boolean {
    if (this.degradationReported) return false;
    this.degradationReported = true;
    return true;
  }

  claimMcpReport(): boolean {
    if (this.mcpReported) return false;
    this.mcpReported = true;
    return true;
  }
}
