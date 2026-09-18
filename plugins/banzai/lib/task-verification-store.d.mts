import type { TaskVerificationAuthority, TaskVerificationContext, TaskVerificationDescriptor, TaskVerificationPolicy, TaskVerificationSelection } from "./task-verification.mjs";
import type { VerificationCapture } from "./verification-evidence.mjs";
import type { VerificationStorage, VerificationEvidenceReference } from "./verification-store.mjs";
export interface TaskVerificationCapture { observedDigest: string | null; complete: boolean; reusable: VerificationCapture | null }
export interface TaskVerificationDecision extends TaskVerificationSelection {
  schema: "banzai-verification-decision/v2"; schemaVersion: 2; workId: string; roundId: string; sourceAttemptId: string;
  authority: TaskVerificationAuthority; context: TaskVerificationContext; policyDigest: string | null; before: TaskVerificationCapture; sha256: string;
}
export interface TaskVerificationAttempt {
  schemaVersion: 2; id: string; sequence: number; workId: string; roundId: string; sourceAttemptId: string; checkId: string;
  descriptor: VerificationEvidenceReference & { checkId: string }; cwd: string; authorityDigest: string; contextDigest: string;
  status: "started" | "completed" | "failed" | "interrupted"; startedAt: string; completedAt: string | null; durationMs: number | null;
  exitCode: number | null; signal: string | null; failureCategory: "command_exit" | "process_start" | "timeout" | "output_limit" | "runner_failure" | null;
  retryOf: string | null; before: TaskVerificationCapture; after: TaskVerificationCapture | null;
  stdout: VerificationEvidenceReference | null; stderr: VerificationEvidenceReference | null;
}
export interface TaskVerificationApplicability {
  schema: "banzai-verification-applicability/v2"; schemaVersion: 2; workId: string; roundId: string; decisionSha256: string; observedDigest: string | null;
  complete: boolean; outcome: "checked" | "absent"; absenceReason: string | null; sha256: string;
  dispositions: { checkId: string; required: boolean; kind: "not_run" | "unavailable" | "interrupted" | "timed_out" | "failed" | "passed" | "reused"; reason: string; attemptId: string | null }[];
}
export interface TaskVerificationPublication {
  decision: TaskVerificationDecision; applicability: TaskVerificationApplicability; attempts: TaskVerificationAttempt[];
  references: { decision: VerificationEvidenceReference; applicability: VerificationEvidenceReference };
}
export function parseTaskVerificationDecision(value: unknown): TaskVerificationDecision;
export function parseTaskVerificationAttempt(value: unknown): TaskVerificationAttempt;
export function captureTaskVerificationInputs(input: VerificationStorage, descriptors: TaskVerificationDescriptor[], policy: TaskVerificationPolicy | null): Promise<TaskVerificationCapture>;
export function readTaskVerificationAttempts(input: VerificationStorage, repairOrigins?: boolean): Promise<TaskVerificationAttempt[]>;
export function taskVerificationApplicability(input: VerificationStorage, decision: TaskVerificationDecision, attempts: TaskVerificationAttempt[], current: TaskVerificationCapture): Promise<TaskVerificationApplicability>;
export function executeTaskVerification(input: VerificationStorage & {
  selection: TaskVerificationSelection; authority: TaskVerificationAuthority; context: TaskVerificationContext; policy: TaskVerificationPolicy | null;
  roundId: string; retryOf?: string; recoverInterrupted?: boolean;
  revalidate(): Promise<void>;
  invoke(descriptor: TaskVerificationDescriptor, cwd: string): Promise<{
    status: "completed" | "failed" | "interrupted"; stdout: string; stderr: string; completedAt: string; exitCode: number | null; signal: string | null;
    failureCategory: TaskVerificationAttempt["failureCategory"];
  }>;
}): Promise<TaskVerificationPublication>;

export function parseTaskVerificationPublication(value: unknown): TaskVerificationPublication;
