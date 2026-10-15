export interface WorkArtifacts {
  reviewDirectory: string;
  verificationDirectory?: string;
  description?: string;
  plan?: string;
  implementationReport?: string;
  testReport?: string;
  work?: string;
  changeReport?: string;
}
export interface WorkBinding {
  schema: "banzai-work-binding/v1" | "banzai-work-binding/v2" | "banzai-work-binding/v3";
  schemaVersion: 1 | 2 | 3;
  workId: string;
  slug: string;
  mode: "strict" | "lite" | "fix" | "workflow";
  layout?: "private" | "legacy";
  createdAt: string;
  sourceCommit: string | null;
  artifacts: WorkArtifacts;
}
export interface BoundWork { binding: WorkBinding; sha256: string }
export const WORK_DIRECTORY: "documentation/work";
export const BINDING_SCHEMA: "banzai-work-binding/v3";
export function workDirectory(slug: string): string;
export function documentRoles(slug: string, mode: WorkBinding["mode"]): WorkArtifacts;
export function parseBinding(value: unknown): WorkBinding;
export function ignored(root: string, relative: string): Promise<boolean>;
export function verifyDocumentVisibility(root: string, roles: WorkArtifacts, extraPaths?: string[]): Promise<void>;
export function createExecutionBinding(input: {repoRoot: string; slug: string; mode: WorkBinding["mode"]; runId: string; creationId?: string; createdAt?: string; sourceCommit?: string | null}): Promise<BoundWork>;
export function ownsArtifact(binding: WorkBinding, relative: string): boolean;
export function inspectBoundWork(root: string, bound: BoundWork): Promise<BoundWork>;
export function workDocumentInventory(root: string, bound: BoundWork): Promise<{path: string; kind: string; sha256: string | null}[]>;

export function planningReviewFilenames(root: string, bound: BoundWork): Promise<string[]>;
