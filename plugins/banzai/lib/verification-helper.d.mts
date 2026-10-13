import type { TaskVerificationDecision, TaskVerificationApplicability, TaskVerificationPublication } from "./task-verification-store.mjs";
export function verificationOperation(operation: string, request: unknown): Promise<{
  supported: boolean; reason?: string; evidence?: "unavailable"; authorityKind?: "standalone-skill";
  decision?: TaskVerificationDecision | null; applicability?: TaskVerificationApplicability | null;
  physicalAttempts?: number;
} & Partial<Pick<TaskVerificationPublication, "attempts" | "references">>>;
