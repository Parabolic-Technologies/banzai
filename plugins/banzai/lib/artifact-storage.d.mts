export interface WorkBinding {
  schema: "banzai-work-binding/v1" | "banzai-work-binding/v2";
  schemaVersion: 1 | 2;
  workId: string;
  slug: string;
  mode: "strict" | "lite" | "fix" | "workflow";
  layout: "private" | "legacy";
  createdAt: string;
  sourceCommit: string | null;
  artifacts: {
    reviewDirectory: string;
    verificationDirectory?: string;
    description?: string;
    plan?: string;
    implementationReport?: string;
    testReport?: string;
    work?: string;
    changeReport?: string;
  };
}
export interface BoundWork {
  binding: WorkBinding;
  sha256: string;
}
export interface LayoutDeclaration {
  schema: "banzai-artifact-layout/v1";
  schemaVersion: 1;
  layout: "private" | "legacy";
}
export interface LegacySelection {
  slug: string;
  mode: WorkBinding["mode"];
  creationId: string;
  workPath: string;
  artifacts: WorkBinding["artifacts"];
  originals: { path: string; sha256: string }[];
  sourceCommit: string | null;
}
export interface ArtifactInspection {
  projectRoot: string;
  classification: "declared" | "legacy" | "fresh";
  layout: "private" | "legacy";
  declaration: LayoutDeclaration | null;
  work: BoundWork | null;
  candidates: {
    workId: string;
    slug: string;
    mode: WorkBinding["mode"];
    workPath: string;
  }[];
  legacyEvidence: string[];
  legacyCandidates: LegacySelection[];
  legacySelection: LegacySelection | null;
}
export interface ArtifactResponse {
  schema: "banzai-artifact-result/v1";
  schemaVersion: 1;
  operation: string;
  ok: boolean;
  result: unknown;
  error: { code: string; message: string } | null;
}
export class ArtifactStorageError extends Error {
  code: string;
  constructor(code: string, message: string);
}
export const DECLARATION_SCHEMA: "banzai-artifact-layout/v1";
export const BINDING_SCHEMA: "banzai-work-binding/v1";
export const REQUEST_SCHEMA: "banzai-artifact-request/v1";
export const RESULT_SCHEMA: "banzai-artifact-result/v1";
export const METADATA_LIMIT: number;
export const DISCOVERY_LIMIT: number;
export const DECLARATION_PATH: string;
export const WORK_ROOT: string;
export function fail(code: string, message: string): never;
export function digestBytes(value: string | Uint8Array): string;
export function canonicalJson(value: unknown): string;
export function exactObject(
  value: unknown,
  required: string[],
  optional?: string[],
): Record<string, unknown>;
export function relativePath(value: unknown): string;
export function safePath(
  root: string,
  relative: string,
  options?: { missing?: boolean; directory?: boolean },
): Promise<string>;
export function readBytes(
  root: string,
  relative: string,
  options?: { optional?: boolean; limit?: number },
): Promise<Buffer | null>;
export function readJson(
  root: string,
  relative: string,
  optional?: boolean,
): Promise<unknown>;
export function makeDirectories(root: string, relative: string): Promise<void>;
export function publishNew(
  root: string,
  relative: string,
  bytes: string | Uint8Array,
): Promise<void>;
export function projectRoot(input: string): Promise<string>;
export function parseDeclaration(value: unknown): LayoutDeclaration;
export function parseBinding(value: unknown): WorkBinding;
export function artifactRoles(
  workId: string,
  slug: string,
  mode: WorkBinding["mode"],
  layout: WorkBinding["layout"],
): WorkBinding["artifacts"];
export function readBinding(root: string, workPath: string): Promise<BoundWork>;
export function inspectArtifacts(input: {
  repoRoot: string;
  workId?: string;
  workPath?: string;
}): Promise<ArtifactInspection>;
export function verifyIgnores(root: string, binding?: WorkBinding | null, destinations?: string[]): Promise<void>;
export function initializeArtifacts(input: {
  repoRoot: string;
  layout?: WorkBinding["layout"];
}): Promise<ArtifactInspection>;
export function createWork(input: {
  schemaVersion?: number;
  repoRoot: string;
  slug: string;
  mode: WorkBinding["mode"];
  creationId: string;
}): Promise<BoundWork>;
export function ownsArtifact(binding: WorkBinding, relative: string): boolean;
export function inspectBoundWork(
  root: string,
  bound: BoundWork,
): Promise<BoundWork>;
export function privateArtifactInventory(
  root: string,
  bound: BoundWork,
): Promise<{ path: string; kind: string; sha256: string }[]>;
export function acquireWork(input: {
  repoRoot: string;
  workPath: string;
  ownerId: string;
}): Promise<{ token: string; workId: string }>;
export function writeArtifact(input: {
  repoRoot: string;
  workPath: string;
  token: string;
  artifactPath: string;
  inputFile: string;
  expectedSha256: string | null;
}): Promise<{ path: string; sha256: string }>;
export function releaseWork(input: {
  repoRoot: string;
  workPath: string;
  token: string;
}): Promise<{ workId: string; released: true }>;
export function runArtifactOperation(
  operation: string,
  input: unknown,
): Promise<unknown>;
export function artifactCommand(args: string[]): Promise<ArtifactResponse>;

export type AdoptionClassification =
  "ready" | "setup_required" | "migration_required" | "needs_attention";
export interface AdoptionIssue {
  file: string;
  reason: string;
  classification: Exclude<AdoptionClassification, "ready">;
}
export interface ProjectAdoption {
  classification: AdoptionClassification;
  label: string;
  sourceRepository: boolean;
  files: { file: string; status: "present" | "missing" | "unreadable" }[];
  issues: AdoptionIssue[];
}
export const ADOPTION_LABELS: Record<AdoptionClassification, string>;
export const SCAFFOLD_MARKER: string;
export const GUIDANCE_MAX_BYTES: number;
export function readAdoptionFile(
  root: string,
  file: string,
  limit: number,
): Promise<{ text: string | null; problem: string | null }>;
export function inspectProjectAdoption(
  repoRoot: string,
  options?: { layoutOnly?: boolean },
): Promise<ProjectAdoption>;
export function adoptionDiagnostic(result: ProjectAdoption): string;

export function readSharedReviewSnapshot(value: unknown): unknown;
export function sealSharedReviewSnapshot(value: unknown): unknown;

export function hasRunnerWorkOwnership(root: string, bound: BoundWork | undefined): Promise<boolean>;
export function withRunnerWorkOwnership<T>(root: string, bound: BoundWork | undefined, action: () => Promise<T>): Promise<T>;
