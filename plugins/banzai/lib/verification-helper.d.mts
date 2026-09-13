import type { VerificationDecision } from "./verification-evidence.mjs";
import type { VerificationApplicability } from "./verification-store.mjs";
export function verificationOperation(operation: string, request: unknown): Promise<{
  supported: boolean; reason?: string; decision?: VerificationDecision; applicability?: VerificationApplicability; physicalAttempts?: number;
}>;
