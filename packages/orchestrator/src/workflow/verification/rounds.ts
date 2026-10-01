import { BanzaiError } from "../../errors.js";
import type {
  AttemptReference,
  RunState,
  VerificationAttemptRecord,
  VerificationCommandDescriptor,
  VerificationResult
} from "../../types.js";
import { verificationCommandMatches } from "../domain/verification-attempts.js";

export function verificationRound(
  records: readonly VerificationAttemptRecord[],
  sourceAttempt: AttemptReference & { kind: "implementation" | "fix" }
): VerificationAttemptRecord["round"] {
  const existing = records.find(
    (record) => record.round.sourceAttemptId === sourceAttempt.id
  );
  if (existing !== undefined) {
    if (existing.round.sourceAttemptKind !== sourceAttempt.kind) {
      throw new BanzaiError(
        "VERIFICATION_ATTEMPT_CONFLICT",
        "Verification round source identity has conflicting kinds."
      );
    }
    return existing.round;
  }
  const roundIds = new Set(records.map((record) => record.round.id));
  return {
    id: `verification-round-${sourceAttempt.id}`,
    ordinal: roundIds.size + 1,
    sourcePhase: sourceAttempt.kind,
    sourceAttemptId: sourceAttempt.id,
    sourceAttemptKind: sourceAttempt.kind
  };
}

export function reconcileVerificationState(
  state: RunState,
  records: readonly VerificationAttemptRecord[],
  round: VerificationAttemptRecord["round"],
  descriptors: readonly VerificationCommandDescriptor[]
): void {
  const byIdentity = new Map(
    descriptors.map((descriptor) => [
      `${descriptor.profileOrdinal}:${descriptor.commandOrdinal}`,
      descriptor
    ])
  );
  const roundRecords = records.filter((item) => item.round.id === round.id);
  for (const record of roundRecords) {
    const descriptor = byIdentity.get(
      `${record.command.profileOrdinal}:${record.command.commandOrdinal}`
    );
    if (
      descriptor === undefined ||
      !verificationCommandMatches(record, descriptor)
    ) {
      throw new BanzaiError(
        "VERIFICATION_CONFIGURATION_CHANGED",
        "Configured verification commands changed during an open verification round."
      );
    }
  }
  const retained: VerificationResult[] = [];
  for (const descriptor of descriptors) {
    const record = roundRecords
      .filter(
        (item) =>
          item.command.profileOrdinal === descriptor.profileOrdinal &&
          item.command.commandOrdinal === descriptor.commandOrdinal &&
          (item.status === "completed" || item.status === "failed") &&
          item.exitCode !== null &&
          item.completedAt !== null &&
          item.stdout !== null &&
          item.stderr !== null
      )
      .at(-1);
    if (record === undefined) {
      continue;
    }
    if (
      record.exitCode === null ||
      record.completedAt === null ||
      record.stdout === null ||
      record.stderr === null
    ) {
      continue;
    }
    retained.push({
      name: descriptor.command.name,
      command: descriptor.command.command,
      args: descriptor.command.args,
      exitCode: record.exitCode,
      signal: record.signal,
      stdoutPath: record.stdout.relativePath,
      stderrPath: record.stderr.relativePath,
      startedAt: record.startedAt,
      completedAt: record.completedAt
    });
  }
  state.metrics.attempts.verification = records.length;
  state.verification = retained;
}
