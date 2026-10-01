import { readFile } from "node:fs/promises";
import path from "node:path";
import type { OrchestratorConfig, RunState } from "../../types.js";
import {
  parseTaskVerificationObligations,
  type TaskVerificationPolicy
} from "../../verification-evidence.js";
import { completionPlanPath } from "../completion/plan-tasks.js";
import type { RunnerContext } from "../context.js";

/**
 * The check identities whose descriptors draw execution authority from the
 * approved plan or project policy. A candidate restating one of them leaves
 * the approved obligation in force, so the restatement's source identities
 * never take effect and are never compared (ADR-0049 section 2, ADR-0051).
 */
export async function requiredCheckIds(
  context: RunnerContext,
  state: RunState,
  config: OrchestratorConfig
): Promise<Set<string>> {
  const ids = new Set(
    (taskVerificationPolicy(config)?.required ?? []).map((check) => check.id)
  );
  if (
    (state.workflowSelection?.workflow ?? "strict") !== "strict" ||
    state.planApproval === null
  )
    return ids;
  for (const check of parseTaskVerificationObligations(
    await readFile(
      path.join(context.repoRoot, completionPlanPath(state)),
      "utf8"
    )
  ).checks)
    ids.add(check.id);
  return ids;
}

export function taskVerificationPolicy(
  config: OrchestratorConfig
): TaskVerificationPolicy | null {
  return (
    config.verification.taskPolicy ??
    (config.verification.policy
      ? {
          schema: "banzai-task-verification-policy/v1",
          schemaVersion: 1,
          required: [],
          denied: [],
          limits: {
            timeoutMs: 86400000,
            workingDirectories: ["."],
            requiredContext: "inherited-local"
          },
          reuse: config.verification.policy
        }
      : null)
  );
}
