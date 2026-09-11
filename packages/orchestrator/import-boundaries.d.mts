export interface ImportBoundaryPermission {
  target: string;
  authority: string;
}

export interface ImportBoundaryEntry {
  importer: `src/${string}.ts`;
  boundary: string;
  authorities: readonly string[];
  runtime: readonly ImportBoundaryPermission[];
  typeOnly: readonly ImportBoundaryPermission[];
}

export interface ImportBoundaryPolicyIssue {
  kind: string;
  importer?: string;
  target?: string;
}

export class ImportBoundaryPolicyError extends Error {
  readonly code: "IMPORT_BOUNDARY_POLICY_INVALID";
  readonly issue: ImportBoundaryPolicyIssue;
}

export const ORCHESTRATOR_IMPORT_BOUNDARIES: readonly ImportBoundaryEntry[];

export function discoverProductionModules(
  sourceRoot: string | URL
): readonly string[];

export function validateImportBoundaryPolicy(
  entries: readonly ImportBoundaryEntry[],
  sourceModules: readonly string[]
): ReadonlyMap<string, ImportBoundaryEntry>;

export function createImportBoundaryConfigs(
  validatedPolicy: ReadonlyMap<string, ImportBoundaryEntry>
): readonly Record<string, unknown>[];

export function formatImportBoundaryPolicyError(
  issue: ImportBoundaryPolicyIssue
): string;
