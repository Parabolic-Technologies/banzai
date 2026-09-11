import { BanzaiError } from "./errors.js";
import {
  CANCELLATION_REASONS,
  CANCELLATION_SCHEMA,
  CANCELLATION_REPORT_SCHEMA,
  isCancellationReason
} from "./cancellation.js";
import type { CancelRunInput, CancellationResult } from "./cancellation.js";
import { parseEvaluationExportArgs } from "./evaluation-cli.js";
import { collectCancellationReport } from "./cancellation-report.js";
import {
  renderCancellationJson,
  renderCancellationMarkdown
} from "./cancellation-report-render.js";
import type { EvaluationExportOptions } from "./types.js";

export function parseCancellationReportArgs(
  args: readonly string[]
): EvaluationExportOptions {
  return parseEvaluationExportArgs(args);
}
export async function executeCancellationReport(
  repoRoot: string,
  options: EvaluationExportOptions,
  stdout: (value: string) => void
): Promise<void> {
  const document = await collectCancellationReport(repoRoot, options);
  stdout(
    options.format === "json"
      ? renderCancellationJson(document)
      : renderCancellationMarkdown(document)
  );
}

export const CANCELLATION_HELP = `Usage: banzai cancel [--run <run-id>] [--reason <enum>]

Cancel the current run. --run requires that exact run to still be current.
Reason is an optional operator report, not a verified cause or cancellation permission.
No TTY is required and no reason prompt is opened by this command.
Reasons: ${CANCELLATION_REASONS.join(", ")}
`;
export function parseCancellationArgs(
  args: readonly string[]
): CancelRunInput | "help" {
  if (args.length === 1 && args[0] === "--help") return "help";
  const result: CancelRunInput = {};
  const seen = new Set<string>();
  for (let i = 0; i < args.length; i += 2) {
    const option = args[i];
    if (option !== "--run" && option !== "--reason")
      throw new BanzaiError(
        "INVALID_CANCELLATION_INPUT",
        "Cancel accepts only --run and --reason, or --help by itself."
      );
    if (seen.has(option))
      throw new BanzaiError(
        "INVALID_CANCELLATION_INPUT",
        "Cancellation options may be supplied only once."
      );
    seen.add(option);
    const value = args[i + 1];
    if (option === "--reason") {
      if (!isCancellationReason(value))
        throw new BanzaiError(
          "INVALID_CANCELLATION_REASON",
          `Invalid cancellation reason. Valid values: ${CANCELLATION_REASONS.join(", ")}.`
        );
      result.reason = value;
    } else {
      if (
        value === undefined ||
        value.length > 300 ||
        !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(value) ||
        value === "." ||
        value === ".."
      ) {
        throw new BanzaiError(
          "INVALID_CANCELLATION_INPUT",
          "Cancel --run requires a safe run ID."
        );
      }
      result.expectedRunId = value;
    }
  }
  return result;
}
export function cancellationCapabilities() {
  return {
    schema: "banzai-cancellation-capabilities/v1",
    schemaVersion: 1,
    cancelCommand: "banzai cancel",
    runOption: "--run",
    reasonOption: "--reason",
    reasons: [...CANCELLATION_REASONS],
    ttyRequired: false,
    observationSchema: CANCELLATION_SCHEMA,
    reportCommand: "banzai eval cancellations",
    reportSchema: CANCELLATION_REPORT_SCHEMA
  } as const;
}
export function cancellationMessages(result: CancellationResult): string[] {
  if (result.outcome === "active_run_changed")
    return ["The active run changed. No run was cancelled by this action."];
  if (result.outcome === "unconfirmed")
    return ["Cancellation could not be confirmed. Check the run status."];
  if (result.outcome === "already_done")
    return ["Run already completed. No cancellation was recorded."];
  if (result.outcome === "already_cancelled")
    return ["Run was already cancelled."];
  const lines = ["Run cancelled."];
  if (result.stopRequest === "sent")
    lines.push(
      "A stop signal was sent; process exit is not confirmed by this message."
    );
  if (result.stopRequest === "failed")
    lines.push(
      "The stop signal could not be sent; process exit is not confirmed."
    );
  if (result.stopRequest === "not_found")
    lines.push("The process was not found when stopping was requested.");
  if (result.observation === "unsaved")
    lines.push("Run cancelled. Cancellation observation was not saved.");
  return lines;
}
