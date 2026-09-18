import type { VerificationPolicy } from "./verification-evidence.mjs";
export interface TaskVerificationDescriptor {
  id: string; name: string; requirementRefs: string[]; command: string; args: string[];
  cwd: string; timeoutMs: number; evidence: "fresh" | "equivalent_evidence";
  sources: { path: string; sha256: string }[];
  materialization: { taskRef: string; paths: string[] } | null;
}
export interface TaskVerificationCandidates { checks: TaskVerificationDescriptor[]; absenceReason: string | null }
export interface TaskVerificationObligations extends TaskVerificationCandidates {
  schema: "banzai-verification-obligations/v2"; schemaVersion: 2; complete: true; planRemainderSha256: string;
}
export interface TaskVerificationPolicy {
  schema: "banzai-task-verification-policy/v1"; schemaVersion: 1;
  required: TaskVerificationDescriptor[];
  denied: { command: string; args: string[] | null; cwd: string | null }[];
  limits: { timeoutMs: number; workingDirectories: string[]; requiredContext: string };
  reuse: VerificationPolicy | null;
}
export interface TaskVerificationAuthority {
  workId: string; sourceAttemptId: string; workflow: "strict" | "feature" | "quick-fix";
  taskDigest: string; selectionDigest: string; approvalDigest: string | null; contextDigest: string;
}
export interface TaskVerificationContext { kind: "inherited-local"; invocationDigest: string; restrictions: string[] }
export interface TaskVerificationSelection {
  checks: { descriptor: TaskVerificationDescriptor; required: boolean }[]; absenceReason: string | null;
}
export function parseTaskVerificationDescriptor(value: unknown): TaskVerificationDescriptor;
export function parseTaskVerificationCandidates(value: unknown): TaskVerificationCandidates | null;
export function parseTaskVerificationObligations(plan: string): TaskVerificationObligations;
export function parseTaskVerificationPolicy(value: unknown): TaskVerificationPolicy;
export function selectTaskVerification(input: { required: TaskVerificationDescriptor[]; candidates: TaskVerificationCandidates | null; policy?: TaskVerificationPolicy | null }): TaskVerificationSelection;
export function taskVerificationPath(repoRoot: string, relativePath: string, directory?: boolean): Promise<string>;
export function authorizeTaskVerification(input: { repoRoot: string; descriptor: TaskVerificationDescriptor; authority: TaskVerificationAuthority; context: TaskVerificationContext; policy?: TaskVerificationPolicy | null }): Promise<{ descriptor: TaskVerificationDescriptor; cwd: string; authorityDigest: string; contextDigest: string; policyDigest: string | null }>;

export interface TaskVerificationDiscovery {
  sources: { path: string; status: "inspected" | "absent" | "unavailable"; sha256: string | null; reason: string | null }[];
  suggestions: { command: string; args: string[]; cwd: string; source: { path: string; sha256: string }; script: string; placeholder: boolean }[];
}
export function discoverTaskVerification(repoRoot: string, directories?: string[], additionalSources?: string[]): Promise<TaskVerificationDiscovery>;
