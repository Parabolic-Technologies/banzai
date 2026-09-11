import { BanzaiError } from "./errors.js";
import { inspectDoctor, type DoctorReport } from "./doctor.js";

export type DoctorFormat = "text" | "json";

export interface DoctorCliOptions {
  format: DoctorFormat;
}

export interface DoctorIO {
  stdout(value: string): void;
  stderr(value: string): void;
}

export function parseDoctorArgs(args: string[]): DoctorCliOptions {
  if (args.length === 0) {
    return { format: "text" };
  }
  if (args.length === 1 && args[0] === "--json") {
    return { format: "json" };
  }
  throw new BanzaiError(
    "INVALID_DOCTOR_OPTION",
    "Doctor accepts only one optional `--json` flag."
  );
}

export function renderDoctorJson(report: DoctorReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

export function renderDoctorText(report: DoctorReport): string {
  const lines = [
    `Banzai doctor: ${report.ready ? "READY" : "NOT READY"}`,
    `Project types: ${report.projectTypes.join(", ") || "unavailable"}`,
    "Checks:"
  ];
  for (const item of report.checks) {
    lines.push(
      `  [${item.status.toUpperCase()}] ${item.id} (${item.category}): ${item.message}`
    );
  }
  lines.push(
    `Summary: passed=${report.summary.passed}, warnings=${report.summary.warnings}, failed=${report.summary.failed}, skipped=${report.summary.skipped}`
  );
  return `${lines.join("\n")}\n`;
}

export async function executeDoctor(
  repoRoot: string,
  args: string[],
  io: DoctorIO,
  inspect: (repoRoot: string) => Promise<DoctorReport> = inspectDoctor
): Promise<0 | 1> {
  const options = parseDoctorArgs(args);
  const report = await inspect(repoRoot);
  io.stdout(
    options.format === "json"
      ? renderDoctorJson(report)
      : renderDoctorText(report)
  );
  return report.ready ? 0 : 1;
}
