import type {
  ConfigurationSkip,
  ConfigurationSetupState
} from "./configuration-prerequisite.js";
import type { RunState } from "./types.js";
import { BanzaiError } from "./errors.js";
import {
  readVerificationConfig,
  readVerificationConfigTransactions,
  readVerificationConfigConfirmation,
  applyVerificationConfigDelta,
  type VerificationConfigDelta,
  type VerificationConfigTransaction
} from "./verification-config.js";
import {
  configurationDigest,
  hasConfigurationSetup
} from "./configuration-prerequisite.js";

export interface ReviewConfigurationSetup {
  coverage: ConfigurationSetupState["coverage"];
  projectTypes: ConfigurationSetupState["projectTypes"];
  uncoveredTypes: ConfigurationSetupState["uncoveredTypes"];
  resolutionIds: string[];
  skip: ConfigurationSkip | null;
  configPath: ".banzai/config.json";
  configSha256: string;
  carriedInConfigSha256: string | null;
  runnerChanges: {
    transaction: VerificationConfigTransaction;
    delta: VerificationConfigDelta[];
    relation: "matches_after" | "historical_delta";
  }[];
}

/** Freeze actual runner deltas without attributing the entire file to the runner. */
export async function freezeReviewConfiguration(
  repoRoot: string,
  state: RunState
): Promise<ReviewConfigurationSetup> {
  const setup = state.configurationSetup;
  if (!hasConfigurationSetup(state) || !setup)
    throw new BanzaiError(
      "CONFIGURATION_REVIEW_INVALID",
      "The guided review requires its original configuration state."
    );
  const current = await readVerificationConfig(repoRoot);
  if (
    configurationDigest(current.config.verification) !==
    setup.configurationDigest
  )
    throw new BanzaiError(
      "CONFIGURATION_REVIEW_INVALID",
      "Verification configuration changed after its checkpoint. Revalidate verification before reviewing this candidate."
    );
  const history = await readVerificationConfigTransactions(
    repoRoot,
    state.runId
  );
  const runnerChanges: ReviewConfigurationSetup["runnerChanges"] = [];
  for (const id of setup.transactions) {
    const transaction = history.find((item) => item.operationId === id);
    if (!transaction || transaction.stage === "prepared")
      throw new BanzaiError(
        "CONFIGURATION_REVIEW_INVALID",
        "A referenced configuration publication is missing or was never applied. Reconcile the saved checkpoint before review."
      );
    const confirmation = await readVerificationConfigConfirmation(
      repoRoot,
      transaction
    );
    const matches = transaction.configAfterSha256 === current.sha256;
    if (
      matches &&
      configurationDigest(
        applyVerificationConfigDelta(
          current.raw,
          confirmation.preview.delta,
          true
        )
      ) !== transaction.configBeforeSha256
    )
      throw new BanzaiError(
        "CONFIGURATION_REVIEW_INVALID",
        "The confirmed runner delta conflicts with its before/after evidence."
      );
    runnerChanges.push({
      transaction,
      delta: confirmation.preview.delta,
      relation: matches ? "matches_after" : "historical_delta"
    });
  }
  return {
    coverage: setup.coverage,
    projectTypes: [...setup.projectTypes],
    uncoveredTypes: [...setup.uncoveredTypes],
    resolutionIds: setup.resolutions.map((item) => item.id),
    skip: setup.skip === null ? null : structuredClone(setup.skip),
    configPath: ".banzai/config.json",
    configSha256: current.sha256,
    carriedInConfigSha256:
      state.baseline?.find((item) => item.path === ".banzai/config.json")
        ?.sha256 ?? null,
    runnerChanges
  };
}
