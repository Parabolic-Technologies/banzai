import { BanzaiError } from "./errors.js";
import { collectEvaluationExport } from "./evaluation.js";
import {
  renderEvaluationJson,
  renderEvaluationMarkdown
} from "./evaluation-render.js";
import type { EvaluationExportOptions } from "./types.js";
import { normalizeRfc3339Instant } from "./validation.js";

export interface EvaluationIO {
  stdout(value: string): void;
  stderr(value: string): void;
}

export const SAFE_RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function normalizedInstant(value: string): string {
  const normalized = normalizeRfc3339Instant(value);
  if (normalized === undefined) {
    throw new BanzaiError(
      "INVALID_EVAL_DATE",
      "Evaluation dates must be valid RFC3339 instants with Z or an explicit offset."
    );
  }
  return normalized;
}

export function optionValue(args: readonly string[], index: number): string {
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new BanzaiError(
      "MISSING_EVAL_OPTION",
      `${args[index]} requires a value.`
    );
  }
  return value;
}

export function parseEvaluationExportArgs(
  args: readonly string[]
): EvaluationExportOptions {
  let format: EvaluationExportOptions["format"] = "markdown";
  let from: string | null = null;
  let to: string | null = null;
  let jsonSeen = false;
  let fromSeen = false;
  let toSeen = false;
  const runIds = new Set<string>();

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--json") {
      if (jsonSeen) {
        throw new BanzaiError(
          "INVALID_EVAL_OPTION",
          "Evaluation option --json may be specified only once."
        );
      }
      jsonSeen = true;
      format = "json";
      continue;
    }
    if (argument === "--from" || argument === "--to") {
      const isFrom = argument === "--from";
      if ((isFrom && fromSeen) || (!isFrom && toSeen)) {
        throw new BanzaiError(
          "INVALID_EVAL_OPTION",
          `Evaluation option ${argument} may be specified only once.`
        );
      }
      const value = normalizedInstant(optionValue(args, index));
      if (isFrom) {
        fromSeen = true;
        from = value;
      } else {
        toSeen = true;
        to = value;
      }
      index += 1;
      continue;
    }
    if (argument === "--run") {
      const value = optionValue(args, index);
      if (value === "." || value === ".." || !SAFE_RUN_ID.test(value)) {
        throw new BanzaiError(
          "INVALID_EVAL_RUN_ID",
          "Evaluation run selectors must be non-empty path-safe run IDs."
        );
      }
      runIds.add(value);
      index += 1;
      continue;
    }
    throw new BanzaiError(
      "INVALID_EVAL_OPTION",
      "Unknown evaluation export option."
    );
  }

  if (from !== null && to !== null && Date.parse(from) >= Date.parse(to)) {
    throw new BanzaiError(
      "INVALID_EVAL_RANGE",
      "Evaluation --from must be earlier than --to."
    );
  }
  return {
    format,
    from,
    to,
    runIds: [...runIds].sort((left, right) => left.localeCompare(right))
  };
}

export async function executeEvaluationExport(
  repoRoot: string,
  args: readonly string[],
  io: EvaluationIO
): Promise<void> {
  const options = parseEvaluationExportArgs(args);
  const report = await collectEvaluationExport(repoRoot, options);
  io.stdout(
    options.format === "json"
      ? renderEvaluationJson(report)
      : renderEvaluationMarkdown(report)
  );
  if (report.issues.length > 0 || report.cohort.unresolvedRunCount > 0) {
    io.stderr(
      "[EVAL_PARTIAL] Export includes incomplete evidence; inspect the structured issues in the report.\n"
    );
  }
}
