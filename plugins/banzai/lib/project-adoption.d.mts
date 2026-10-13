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

