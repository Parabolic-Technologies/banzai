/**
 * Human wording for retained task verification attempts. The physical record
 * keeps status, failure category and signal separately; only their combination
 * says what happened, so every label reads all three (ADR-0049 §6).
 */
import type {
  TaskVerificationAttempt,
  TaskVerificationPublication
} from "./verification-evidence.js";
import { formatDuration } from "./format.js";

const SUMMARY_CHECK_LIMIT = 5;

/** What an attempt observed, without its output: `exited with code 8`. */
export function attemptOutcomeText(
  attempt: Pick<
    TaskVerificationAttempt,
    "status" | "failureCategory" | "signal" | "exitCode"
  >,
  timeoutMs: number
): string {
  if (attempt.status === "started")
    return "no result was recorded before the runner stopped";
  if (attempt.status === "completed") return "passed";
  const stopped = attempt.signal === null ? "" : ` (${attempt.signal})`;
  switch (attempt.failureCategory) {
    case "timeout":
      return `timed out after ${formatDuration(timeoutMs)}${stopped}`;
    case "process_start":
      return "the executable could not be started";
    case "output_limit":
      return `stopped after exceeding the output limit${stopped}`;
    case "runner_failure":
      return attempt.status === "interrupted"
        ? "interrupted by the runner before the check finished"
        : "the runner could not observe the check result";
    case "command_exit":
    case null:
      // A signalled process has no exit code; the runner records 1.
      return attempt.signal === null
        ? `exited with code ${String(attempt.exitCode)}`
        : `terminated by ${attempt.signal}, for example Ctrl-C, a manual kill or an out-of-memory kill; the recorded exit code ${String(attempt.exitCode)} is synthetic`;
  }
}

/** A start failure stores a placeholder, not output the command produced. */
export function hasCommandOutput(attempt: TaskVerificationAttempt): boolean {
  return (
    attempt.status !== "completed" &&
    attempt.failureCategory !== "process_start" &&
    (attempt.stdout !== null || attempt.stderr !== null)
  );
}

/** One clause per incomplete check, for a block reason that carries no output. */
export function incompleteVerificationSummary(
  publication: TaskVerificationPublication
): string {
  const incomplete = publication.applicability.dispositions.filter(
    (item) => item.kind !== "passed" && item.kind !== "reused"
  );
  const clauses = incomplete.slice(0, SUMMARY_CHECK_LIMIT).map((item) => {
    const attempt = publication.attempts.find(
      (entry) => entry.id === item.attemptId
    );
    const descriptor = publication.decision.checks.find(
      (entry) => entry.descriptor.id === item.checkId
    )?.descriptor;
    const outcome =
      attempt === undefined || attempt.status === "completed"
        ? item.kind.replaceAll("_", " ")
        : attemptOutcomeText(attempt, descriptor?.timeoutMs ?? 0);
    return `${item.checkId} (${item.required ? "required" : "supplemental"}) ${outcome}`;
  });
  const more = incomplete.length - clauses.length;
  return `${clauses.join("; ")}${more > 0 ? `; and ${more} more` : ""}`;
}
