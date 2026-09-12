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
export function normalizeGuidance(text: string): string;
export function markdownSections(text: string): Map<
  string,
  {
    title: string;
    start: number;
    body: number;
    end: number;
  }
>;
export function phaseResourceData(root: string): Promise<
  Record<
    string,
    {
      sha256: string;
      text?: string;
    }
  >
>;
export function phaseResourceBytes(root: string): Promise<string>;
export function checkPhaseResourceBytes(root: string): Promise<void>;
export function instructionConsumerText(
  root: string,
  relativePath: string
): Promise<string>;
export function validateGuidanceExtraction(root: string): Promise<void>;

export function checkInstructionPayloads(
  root: string,
  payloads: {
    source: Map<string, Buffer>;
    plugin: Map<string, Buffer>;
    npm: Map<string, Buffer>;
  }
): Promise<{ resourceCount: number; distributions: string[] }>;
