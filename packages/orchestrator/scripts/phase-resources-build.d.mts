export const PHASE_DEFINITIONS: Readonly<
  Record<
    string,
    {
      guidance: readonly string[];
      policies: readonly string[];
      conditionalPolicies: readonly string[];
    }
  >
>;
export const INSTRUCTION_RESOURCE_IDS: readonly string[];
export const GENERATED_PHASE_RESOURCE_PATH: string;
export function resourceDigest(bytes: string | Uint8Array): string;
export function frozenModuleLiterals(source: string): {
  definitions: unknown;
  resources: Record<string, { sha256: string; text?: string }>;
};
export function phaseResourceBytes(root: string): Promise<string>;
export function checkPhaseResourceBytes(root: string): Promise<void>;
export function validateClosedGuidanceBaseline(root: string): Promise<void>;

export function checkInstructionPayloads(
  root: string,
  payloads: {
    source: Map<string, Buffer>;
    plugin: Map<string, Buffer>;
    npm: Map<string, Buffer>;
  }
): Promise<{ resourceCount: number; distributions: string[] }>;

export interface InstructionAuthority {
  path: string;
  sha256: string;
  scope: string;
}
export interface InstructionTransition {
  predecessorSha256: string;
  successorSha256: string;
  authorities: InstructionAuthority[];
  changes: { key: string; before: string | null; after: string }[];
}
export function identity(value: unknown): string;
export function closed(
  value: unknown,
  keys: readonly string[],
  label: string
): void;
export function baselineFile(root: string, relative: string): Promise<string>;
export function baselineFile(
  root: string,
  relative: string,
  encoding: null
): Promise<Buffer>;
export function sortedExpectations(
  value: Record<string, string>
): Record<string, string>;
export function retainedAuthorityMatches(
  root: string,
  text: string,
  sha256: string
): Promise<boolean>;
export function validateAuthorities(
  root: string,
  authorities: unknown
): Promise<void>;
export function applyTransitionStep(
  root: string,
  previous: Record<string, string>,
  transition: unknown,
  admits: (key: string, authorities: InstructionAuthority[]) => boolean
): Promise<Record<string, string>>;
