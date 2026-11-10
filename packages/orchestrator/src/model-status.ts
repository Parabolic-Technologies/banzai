import { BanzaiError } from "./errors.js";
import { escapeTerminalField } from "./format.js";
import {
  LOCAL_MODEL_DRIFT_ADVICE,
  LOCAL_MODEL_DRIFT_HEADING
} from "./local-config.js";
import { MODEL_ROLES, roleLabel } from "./models.js";
import type { ModelRoleStatuses, ModelStatus } from "./types.js";
import type { WorkflowStatus } from "./workflow.js";

/**
 * Human text for `WorkflowRunner.modelStatus` (ADR-0060 §7, readings 10 and
 * 11). Only `banzai status` prints these lines; post-command state prints do
 * not. Every model value is printed through terminal escaping, and the drift
 * and defect lines arrive escaped.
 */
export function modelStatusLines(status: ModelStatus): string[] {
  const heading = status.scope === "run" ? "Models" : "Current models";
  switch (status.state) {
    case "unavailable":
      return [`${heading}: unavailable (${escapeTerminalField(status.code)})`];
    case "record_invalid":
      return [`${heading}:`, ...recordInvalidLines(status.recordPath)];
    case "local_defective":
      return [`${heading}:`, `  ${status.localDefect}`];
    case "effective":
      return [`${heading}:`, ...roleLines(status.current)];
    case "recorded":
      return [
        `${heading}:`,
        ...roleLines(status.run),
        ...modelDriftBlock(status.drift)
      ];
  }
}

/**
 * The drift block of ADR-0060 §7, shared by `banzai status` and the launch
 * header: the heading, one indented line per drift line and the closing
 * advice. Drift lines arrive escaped. Empty without drift.
 */
export function modelDriftBlock(drift: readonly string[]): string[] {
  if (drift.length === 0) return [];
  return [
    LOCAL_MODEL_DRIFT_HEADING,
    ...drift.map((line) => `  ${line}`),
    LOCAL_MODEL_DRIFT_ADVICE
  ];
}

/**
 * Reading 11, shared by `banzai status` and the launch header: the run's
 * unreadable model record and the advice to cancel the run.
 */
export function recordInvalidLines(recordPath: string): string[] {
  return [
    `  ${escapeTerminalField(recordPath)}: invalid`,
    recordInvalidAdvice()
  ];
}

/**
 * Reading 11 for human output only: a run whose model record cannot be read
 * has no run-effective configuration, so retry and recovery are not eligible,
 * with a reason naming the record, and `banzai cancel` is recommended.
 * Any other model status leaves the status as it is. `status --json` and
 * agent status never pass through here.
 */
export function humanStatusView(
  status: WorkflowStatus,
  models: ModelStatus
): WorkflowStatus {
  if (models.state !== "record_invalid") return status;
  const reason = `${escapeTerminalField(models.recordPath)} is invalid, so the models this run recorded cannot be confirmed. Run banzai cancel to end this run.`;
  return {
    ...status,
    retry: { eligible: false, reason, attemptId: null },
    recovery: { ...status.recovery, eligible: false, reason },
    nextAction: "banzai cancel"
  };
}

/**
 * The `banzai recover` pre-check on the human status view: the attempt and
 * identity to authorize, or `RECOVERY_NOT_ALLOWED` with the view's reason,
 * which names an invalid model record.
 */
export function requireRecoverable(view: WorkflowStatus): {
  attemptId: string;
  recoveryIdentity: string;
} {
  const { recovery } = view;
  if (
    !recovery.eligible ||
    recovery.attemptId === null ||
    recovery.recoveryIdentity === null
  )
    throw new BanzaiError("RECOVERY_NOT_ALLOWED", recovery.reason);
  return {
    attemptId: recovery.attemptId,
    recoveryIdentity: recovery.recoveryIdentity
  };
}

function recordInvalidAdvice(): string {
  return "The models this run recorded cannot be confirmed. Run banzai cancel to end this run.";
}

function roleLines(roles: ModelRoleStatuses): string[] {
  return MODEL_ROLES.map((role) => {
    const { executable, model, effort, source } = roles[role];
    const triple = [executable, model, effort].map(escapeTerminalField);
    return `  ${roleLabel(role)}: ${triple.join(" ")} (${source})`;
  });
}
