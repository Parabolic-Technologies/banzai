import { readFile } from "node:fs/promises";
import path from "node:path";
import { BanzaiError } from "../../errors.js";
import { subscriptionOnlyEnvironment } from "../../process.js";
import type {
  OrchestratorConfig,
  RunState,
  VerificationAttemptRecord
} from "../../types.js";
import {
  captureVerificationInputs,
  decideVerification,
  evidenceDigest,
  parseVerificationConfiguration,
  parseVerificationObligations,
  persistVerificationDecision,
  readVerificationOrigins,
  sameVerificationCapture,
  type TaskVerificationContext,
  type TaskVerificationPolicy,
  type VerificationCapture,
  type VerificationStorage
} from "../../verification-evidence.js";
import { usesVerificationPolicy } from "../../verification.js";
import { completionPlanPath } from "../completion/plan-tasks.js";
import type { RunnerContext } from "../context.js";

export function verificationStorage(
  context: RunnerContext,
  state: RunState
): VerificationStorage {
  if (!usesVerificationPolicy(state) || !state.artifactBinding)
    throw new BanzaiError(
      "VERIFICATION_EVIDENCE_INVALID",
      "Verification applicability requires its original work binding."
    );
  return {
    repoRoot: context.repoRoot,
    workId: state.artifactBinding.binding.workId,
    directory: `.banzai/runs/${state.runId}/verification`
  };
}

export function verificationAuthority(state: RunState): string {
  return evidenceDigest({
    binding: state.artifactBinding?.sha256,
    approval: state.planApproval?.digest ?? null,
    workflow: state.workflowSelection
  });
}

export async function captureVerification(
  context: RunnerContext,
  state: RunState,
  config: OrchestratorConfig
): Promise<VerificationCapture> {
  if (config.schemaVersion !== 3 || !config.verification.policy)
    throw new BanzaiError(
      "VERIFICATION_CONFIGURATION_CHANGED",
      "Verification-enabled runs require their explicit project policy."
    );
  const configuration = parseVerificationConfiguration(config.verification);
  const input = {
    repoRoot: context.repoRoot,
    configuration,
    workId: verificationStorage(context, state).workId,
    evidenceDirectories: [`.banzai/runs/${state.runId}`, ".banzai/runner.lock"]
  };
  const before = await captureVerificationInputs(input);
  const after = await captureVerificationInputs(input);
  return sameVerificationCapture(before, after) ||
    (!before.complete && !after.complete)
    ? after
    : {
        complete: false,
        reason: "inputs_unavailable",
        candidateDigest: null,
        checks: []
      };
}

export async function prepareVerificationDecision(
  context: RunnerContext,
  state: RunState,
  config: OrchestratorConfig,
  round: VerificationAttemptRecord["round"],
  records: VerificationAttemptRecord[]
): Promise<VerificationCapture> {
  const storage = verificationStorage(context, state);
  const configuration = parseVerificationConfiguration(config.verification);
  const strict = (state.workflowSelection?.workflow ?? "strict") === "strict";
  const plan = strict
    ? await readFile(
        path.join(context.repoRoot, completionPlanPath(state)),
        "utf8"
      )
    : null;
  const current = await captureVerification(context, state, config);
  const origins = await readVerificationOrigins(storage, records);
  const decision = decideVerification({
    workId: storage.workId,
    roundId: round.id,
    configuration,
    authorityDigest: verificationAuthority(state),
    strict,
    obligations: parseVerificationObligations(plan, configuration),
    capture: current,
    origins
  });
  await persistVerificationDecision(storage, decision);
  state.verificationEvidence = { decision, applicability: null };
  return current;
}

export function taskVerificationStorage(
  context: RunnerContext,
  state: RunState
): VerificationStorage {
  const binding = state.artifactBinding?.binding;
  if (
    binding?.schemaVersion !== (state.schemaVersion >= 9 ? 3 : 2) ||
    !binding.artifacts.verificationDirectory
  )
    throw new BanzaiError(
      "VERIFICATION_EVIDENCE_INVALID",
      "Task verification requires its original evidence binding."
    );
  if (
    binding.schemaVersion === 3 &&
    (!Number.isSafeInteger(state.reviewIteration) ||
      state.reviewIteration < 0 ||
      state.reviewIteration > 1000)
  )
    throw new BanzaiError(
      "VERIFICATION_EVIDENCE_INVALID",
      "Review iteration is outside the supported evidence bound."
    );
  return {
    repoRoot: context.repoRoot,
    directory: binding.artifacts.verificationDirectory,
    // Canonical reviews are runner output after verification. Their own frozen
    // snapshot/receipt checks protect them; exclude only these exact paths here.
    ...(binding.schemaVersion === 3
      ? {
          excludedSourcePaths: Array.from(
            { length: state.reviewIteration + 1 },
            (_, index) =>
              `${binding.artifacts.reviewDirectory}/review-${index + 1}.md`
          )
        }
      : {}),
    workId: binding.workId
  };
}

export function taskExecutionContext(
  context: RunnerContext,
  state: RunState,
  policy: TaskVerificationPolicy | null
): TaskVerificationContext {
  return {
    kind: "inherited-local",
    invocationDigest: evidenceDigest({
      runId: state.runId,
      repoRoot: context.repoRoot,
      request: evidenceDigest(state.request),
      workflowDigest: state.workflowSelection?.digest,
      environment: evidenceDigest(
        policy?.reuse?.dependencies.environment ?? subscriptionOnlyEnvironment()
      )
    }),
    restrictions: []
  };
}
