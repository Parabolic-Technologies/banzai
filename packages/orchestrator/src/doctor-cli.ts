import { BanzaiError } from "./errors.js";
import {
  doctorDependencies,
  inspectDoctor,
  type DoctorLocalConfigGitProbe,
  type DoctorModel,
  type DoctorReport
} from "./doctor.js";
import { escapeTerminalField, escapeTerminalText } from "./format.js";

export type DoctorFormat = "text" | "json";

export interface DoctorCliOptions {
  format: DoctorFormat;
}

export interface DoctorIO {
  stdout(value: string): void;
  stderr(value: string): void;
}

export type DoctorInspection = (repoRoot: string) => Promise<DoctorReport>;

/**
 * The inspection `banzai doctor` runs. The composition root supplies the Git
 * probe for the local model file, because doctor never imports the Git module
 * (ADR-0060 §8).
 */
export function doctorInspection(
  localConfigGitState: DoctorLocalConfigGitProbe
): DoctorInspection {
  return async (repoRoot) =>
    await inspectDoctor(repoRoot, doctorDependencies({ localConfigGitState }));
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

/**
 * `  <role>: <vendor> <model> effort=<effort> (<source>)` (ADR-0060 §6): an
 * unknown vendor prints `other` and an undisclosed model `unlisted`. Every
 * value is escaped as a terminal field.
 */
function modelLine(model: DoctorModel): string {
  const fields = [
    model.vendor ?? "other",
    model.model ?? "unlisted",
    `effort=${model.effort}`
  ].map(escapeTerminalField);
  return `  ${escapeTerminalField(model.role)}: ${fields.join(" ")} (${escapeTerminalField(model.source)})`;
}

function modelLines(models: readonly DoctorModel[]): string[] {
  return models.length === 0
    ? ["Models: unavailable"]
    : ["Models:", ...models.map(modelLine)];
}

export function renderDoctorText(report: DoctorReport): string {
  const lines = [
    `Banzai doctor: ${report.ready ? "READY" : "NOT READY"}`,
    `Project types: ${report.projectTypes.join(", ") || "unavailable"}`,
    ...modelLines(report.models),
    "Checks:"
  ];
  for (const item of report.checks) {
    lines.push(
      `  [${item.status.toUpperCase()}] ${item.id} (${item.category}): ${escapeTerminalText(item.message)}`
    );
    for (const remedy of item.fixes) {
      lines.push(
        `    Fix: ${escapeTerminalText(remedy.action)} (${remedy.documentation})`
      );
    }
    for (const role of item.roles) {
      lines.push(`    ${role.role} (${role.vendor}): ${role.state}`);
      for (const remedy of role.fixes)
        lines.push(
          `      Fix: ${escapeTerminalText(remedy.action)} (${remedy.documentation})`
        );
    }
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
  inspect: DoctorInspection = inspectDoctor
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
