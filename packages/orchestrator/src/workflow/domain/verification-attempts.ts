import { BanzaiError } from "../../errors.js";
import type {
  VerificationAttemptFailureCategory,
  VerificationAttemptRecord,
  VerificationCommandDescriptor
} from "../../types.js";

export function verificationFailureCategory(
  error: unknown
): VerificationAttemptFailureCategory {
  if (error instanceof BanzaiError) {
    if (error.code === "PROCESS_START_FAILED") {
      return "process_start";
    }
    if (error.code === "PROCESS_TIMEOUT") {
      return "timeout";
    }
    if (error.code === "PROCESS_OUTPUT_LIMIT") {
      return "output_limit";
    }
  }
  return "runner_failure";
}

export function verificationCommandMatches(
  record: VerificationAttemptRecord,
  descriptor: VerificationCommandDescriptor
): boolean {
  return (
    record.command.profileId === descriptor.profileId &&
    record.command.projectType === descriptor.projectType &&
    record.command.profileOrdinal === descriptor.profileOrdinal &&
    record.command.commandOrdinal === descriptor.commandOrdinal &&
    record.command.configurationDigest === descriptor.configurationDigest
  );
}
