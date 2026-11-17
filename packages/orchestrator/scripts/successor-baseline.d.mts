export const SUCCESSOR_BASELINE: string;
export const SUCCESSOR_PIN: string;
export function validateInstructionBaseline(root: string): Promise<void>;
export function describeInstructionTransition(root: string): Promise<{
  predecessorSha256: string;
  changes: { key: string; before: string | null; after: string }[];
}>;
export function evolveInstructionBaseline(
  root: string,
  authorization: unknown,
  options?: { check?: boolean }
): Promise<{ changed: boolean; sha256: string }>;
export function initializeInstructionBaseline(
  root: string,
  origin: unknown,
  options?: { check?: boolean }
): Promise<{ changed: boolean; sha256: string }>;
