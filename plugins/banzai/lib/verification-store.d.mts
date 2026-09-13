import type { VerificationPhysicalAttempt as VerificationAttemptRecord } from "./verification-evidence.mjs";
import type { VerificationCapture, VerificationDecision, VerificationOrigin } from "./verification-evidence.mjs";
export interface VerificationStorage { repoRoot: string; directory: string; workId: string; }
export interface VerificationEvidenceReference { relativePath: string; sha256: string; }
export interface VerificationApplicability {
  schema: "banzai-verification-applicability/v1"; schemaVersion: 1; workId: string; roundId: string;
  decisionSha256: string; candidateDigest: string | null; complete: boolean; sha256: string;
  dispositions: { checkId: string; kind: "executed" | "reused" | "pending";
    origin: { attemptId: string; recordDigest: string; roundId: string } | null }[];
}
export interface VerificationOriginStart {
  schema: "banzai-verification-origin-start/v1"; schemaVersion: 1; workId: string; attemptId: string;
  checkId: string; decision: VerificationDecision; before: VerificationCapture; physicalPath: string;
}
export interface VerificationOriginFinish {
  schema: "banzai-verification-origin-finish/v1"; schemaVersion: 1; workId: string; attemptId: string;
  startSha256: string; physicalSha256: string; after: VerificationCapture;
}
export function parseVerificationOriginStart(value: unknown): VerificationOriginStart;
export function parseVerificationOriginFinish(value: unknown): VerificationOriginFinish;
export function publishVerificationEvidence(input: VerificationStorage, relative: string, value: unknown): Promise<VerificationEvidenceReference>;
export function persistVerificationDecision(input: VerificationStorage, decision: VerificationDecision): Promise<VerificationEvidenceReference>;
export function persistVerificationOriginStart(input: VerificationStorage, attempt: VerificationAttemptRecord, decision: VerificationDecision, before: VerificationCapture): Promise<VerificationEvidenceReference>;
export function persistVerificationOriginFinish(input: VerificationStorage, attempt: VerificationAttemptRecord, after: VerificationCapture): Promise<VerificationEvidenceReference>;
export function readVerificationOrigins(input: VerificationStorage, attempts: VerificationAttemptRecord[]): Promise<VerificationOrigin[]>;
export function readVerificationDecisions(input: VerificationStorage): Promise<VerificationDecision[]>;
export function verificationApplicability(decision: VerificationDecision, origins: VerificationOrigin[], current: VerificationCapture): VerificationApplicability;
export function parseVerificationApplicability(value: unknown): VerificationApplicability;
export function persistVerificationApplicability(input: VerificationStorage, applicability: VerificationApplicability): Promise<VerificationEvidenceReference>;
export interface ReviewVerificationEvidence {
  decision: VerificationDecision; applicability: VerificationApplicability;
  origins: VerificationOrigin[]; attempts: VerificationAttemptRecord[];
}
export function parseReviewVerificationEvidence(value: unknown): ReviewVerificationEvidence;
