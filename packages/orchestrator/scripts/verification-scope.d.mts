export type VerificationScope = "full" | "plugin" | "documents";

export interface ScopeRule {
  readonly scope: VerificationScope;
  readonly label: string;
  readonly directory: string | null;
  readonly file: string | null;
  readonly rootMarkdown: boolean;
}

export interface ScopeResult {
  scope: VerificationScope;
  reason: string | null;
  deciding: { path: string; label: string }[];
}

export const SCOPE_ORDER: readonly VerificationScope[];
export const NO_SCOPE_RULE: string;
export const SCOPE_REASONS: Readonly<{
  empty: string;
  uncomputable: string;
  dispatch: string;
  noBaseRules: string;
}>;
export const SCOPE_RULES: readonly ScopeRule[];

export function classifyPath(name: string): {
  scope: VerificationScope;
  label: string;
};
export function scopeOfChangeSet(paths: readonly string[] | null): ScopeResult;
export function scopeWithReason(reason: string): ScopeResult;
export function localChangeSet(
  root: string,
  base?: string
): Promise<string[] | null>;
export function ciChangeSet(root: string): Promise<string[] | null>;
export function reportLines(result: ScopeResult): string[];
export function summaryText(result: ScopeResult): string;
export function runCi(options?: {
  env?: Record<string, string | undefined>;
  cwd?: string;
  writeOut?: (value: string) => void;
  writeError?: (value: string) => void;
}): Promise<number>;
