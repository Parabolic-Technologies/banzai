import { collectContextReport } from "./context-report.js";
import {
  renderContextReportJson,
  renderContextReportMarkdown
} from "./context-report-render.js";
import {
  parseEvaluationExportArgs,
  type EvaluationIO
} from "./evaluation-cli.js";
import type { EvaluationExportOptions } from "./types.js";

export const parseContextReportArgs = parseEvaluationExportArgs;

export async function executeContextReportWithOptions(
  repoRoot: string,
  options: EvaluationExportOptions,
  io: EvaluationIO
): Promise<void> {
  const report = await collectContextReport(repoRoot, options);
  io.stdout(
    options.format === "json"
      ? renderContextReportJson(report)
      : renderContextReportMarkdown(report)
  );
}

export async function executeContextReport(
  repoRoot: string,
  args: readonly string[],
  io: EvaluationIO
): Promise<void> {
  await executeContextReportWithOptions(
    repoRoot,
    parseContextReportArgs(args),
    io
  );
}
