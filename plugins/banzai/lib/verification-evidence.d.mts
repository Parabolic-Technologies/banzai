export interface VerificationPolicy {
  schema: "banzai-verification-policy/v1";
  schemaVersion: 1;
  explanatory: { path: string; regions: { start: string; end: string }[] }[];
  dependencies: { complete: boolean; exclude: string[]; toolchain: string[];
    environment: { PATH?: string; LANG?: string; LC_ALL?: string; TZ?: string }; volatile: string[] };
}
export interface EvidenceCommand {
  id: string; name: string; command: string; args: string[]; timeoutMs: number;
  evidence: "fresh" | "equivalent_evidence"; ignoreExplanatory: boolean;
}
export interface EvidenceConfiguration {
  profiles: { id: string; projectType: "repository" | "node" | "php" | "python" | "go" | "rust" | "ruby" | "jvm" | "dotnet" | "custom"; commands: EvidenceCommand[] }[];
  policy?: VerificationPolicy;
  bootstrap?: boolean;
}
export interface VerificationObligations {
  schema: "banzai-verification-obligations/v1"; schemaVersion: 1; complete: true;
  planRemainderSha256: string; checks: { id: string; evidence: "fresh" | "equivalent_evidence" }[];
}
export interface VerificationIdentity {
  checkId: string; profileOrdinal: number; commandOrdinal: number;
  configurationDigest: string; policyDigest: string | null; authorityDigest: string; commandDigest: string;
}
export interface VerificationCapture {
  complete: boolean; reason: string | null; candidateDigest: string | null;
  checks: { checkId: string; executable: string; environmentDigest: string; inputDigest: string }[];
}
export interface VerificationOrigin {
  workId: string; checkId: string; attemptId: string; roundId: string; recordDigest: string;
  status: "started" | "completed" | "failed" | "interrupted";
  exitCode: number | null; signal: string | null; failureCategory: string | null;
  complete: boolean; logsIntact: boolean; identity: VerificationIdentity;
  before: VerificationCapture; after: VerificationCapture;
}
export interface VerificationDecision {
  schema: "banzai-verification-decision/v1"; schemaVersion: 1; workId: string; roundId: string;
  candidateDigest: string | null; authorityDigest: string; configurationDigest: string; sha256: string;
  actions: { checkId: string; action: "execute" | "reuse"; reason: string; identity: VerificationIdentity;
    inputDigest: string | null; environmentDigest: string | null;
    origin: { attemptId: string; recordDigest: string; roundId: string } | null }[];
}
export class VerificationEvidenceError extends Error { code: string; constructor(message: string); }
export const VERIFICATION_REASONS: readonly string[];
export function evidenceDigest(value: unknown): string;
export function parseVerificationPolicy(value: unknown): VerificationPolicy;
export function parseVerificationConfiguration(value: unknown): EvidenceConfiguration;
export function parseVerificationObligations(plan: string | null, configuration: EvidenceConfiguration): VerificationObligations | null;
export function verificationIdentities(configuration: EvidenceConfiguration, authority: string): VerificationIdentity[];
export function captureVerificationInputs(input: { repoRoot: string; configuration: EvidenceConfiguration; workId: string; evidenceDirectories?: string[] }): Promise<VerificationCapture>;
export function sameVerificationCapture(left: VerificationCapture, right: VerificationCapture): boolean;
export function decideVerification(input: { workId: string; roundId: string; configuration: EvidenceConfiguration; authorityDigest: string;
  strict: boolean; obligations: VerificationObligations | null; capture: VerificationCapture; origins: VerificationOrigin[] }): VerificationDecision;
export function parseVerificationDecision(value: unknown): VerificationDecision;

export interface VerificationPhysicalAttempt {
  schemaVersion: 1;
  id: string;
  sequence: number;
  round: {
    id: string;
    ordinal: number;
    sourcePhase: "implementation" | "fix";
    sourceAttemptId: string;
    sourceAttemptKind: "implementation" | "fix";
  };
  command: {
    profileId: string;
    projectType: EvidenceConfiguration["profiles"][number]["projectType"];
    profileOrdinal: number;
    commandOrdinal: number;
    configurationDigest: string;
  };
  status: "started" | "completed" | "failed" | "interrupted";
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  exitCode: number | null;
  signal: string | null;
  failureCategory: "command_exit" | "process_start" | "timeout" | "output_limit" | "runner_failure" | null;
  retryOf: string | null;
  restartOf: string | null;
  stdout: { relativePath: string; sha256: string } | null;
  stderr: { relativePath: string; sha256: string } | null;
}
