import taskPhaseResultSchema from "../../../plugins/banzai/contracts/v4/phase-result.schema.json" with { type: "json" };
import contractManifest from "../../../plugins/banzai/contracts/contract.json" with { type: "json" };
import legacyPhaseResultSchema from "../../../plugins/banzai/contracts/v1/phase-result.schema.json" with { type: "json" };
import legacyPhaseResultV2Schema from "../../../plugins/banzai/contracts/v2/phase-result.schema.json" with { type: "json" };
import legacyReviewResultSchema from "../../../plugins/banzai/contracts/v1/review-result.schema.json" with { type: "json" };
import reviewResultSchema from "../../../plugins/banzai/contracts/v2/review-result.schema.json" with { type: "json" };
import workflowSelectionSchema from "../../../plugins/banzai/contracts/v1/workflow-selection.schema.json" with { type: "json" };
import legacyPhaseResultV3Schema from "../../../plugins/banzai/contracts/v3/phase-result.schema.json" with { type: "json" };
import planningReviewResultSchema from "../../../plugins/banzai/contracts/v1/planning-review-result.schema.json" with { type: "json" };
import planningReviewAnalysisSchema from "../../../plugins/banzai/contracts/v1/planning-review-analysis.schema.json" with { type: "json" };
import { BanzaiError } from "./errors.js";
import {
  CONTRACT_VERSION,
  PHASE_RESULT_SCHEMA_VERSION,
  PLANNING_REVIEW_RESULT_SCHEMA,
  PLANNING_REVIEW_RESULT_SCHEMA_VERSION,
  PLANNING_REVIEW_ANALYSIS_SCHEMA,
  PLANNING_REVIEW_ANALYSIS_SCHEMA_VERSION
} from "./types.js";

export {
  planningReviewResultSchema,
  planningReviewAnalysisSchema,
  contractManifest,
  legacyPhaseResultSchema,
  legacyReviewResultSchema,
  legacyPhaseResultV2Schema,
  taskPhaseResultSchema as phaseResultSchema,
  legacyPhaseResultV3Schema,
  taskPhaseResultSchema,
  reviewResultSchema,
  workflowSelectionSchema
};

function planningContractsMatch(): boolean {
  return !(
    contractManifest.schemas.planningReviewResult !==
      "./v1/planning-review-result.schema.json" ||
    contractManifest.schemas.planningReviewAnalysis !==
      "./v1/planning-review-analysis.schema.json" ||
    planningReviewResultSchema.properties.schema.const !==
      PLANNING_REVIEW_RESULT_SCHEMA ||
    planningReviewResultSchema.properties.schemaVersion.const !==
      PLANNING_REVIEW_RESULT_SCHEMA_VERSION ||
    planningReviewResultSchema.properties.contractVersion.const !==
      CONTRACT_VERSION ||
    planningReviewAnalysisSchema.properties.schema.const !==
      PLANNING_REVIEW_ANALYSIS_SCHEMA ||
    planningReviewAnalysisSchema.properties.schemaVersion.const !==
      PLANNING_REVIEW_ANALYSIS_SCHEMA_VERSION ||
    planningReviewAnalysisSchema.properties.contractVersion.const !==
      CONTRACT_VERSION
  );
}

export function assertContractParity(): void {
  if (contractManifest.contractVersion !== CONTRACT_VERSION) {
    throw new BanzaiError(
      "CONTRACT_VERSION_MISMATCH",
      `Plugin contract ${contractManifest.contractVersion} does not match orchestrator contract ${CONTRACT_VERSION}.`
    );
  }

  if (
    !planningContractsMatch() ||
    contractManifest.schemas.phaseResult !== "./v4/phase-result.schema.json" ||
    workflowSelectionSchema.properties.contractVersion.const !==
      CONTRACT_VERSION ||
    taskPhaseResultSchema.properties.contractVersion.const !==
      CONTRACT_VERSION ||
    taskPhaseResultSchema.properties.schemaVersion.const !==
      PHASE_RESULT_SCHEMA_VERSION ||
    legacyPhaseResultV2Schema.properties.contractVersion.const !==
      CONTRACT_VERSION ||
    legacyPhaseResultV2Schema.properties.schemaVersion.const !== 2 ||
    legacyPhaseResultSchema.properties.contractVersion.const !==
      CONTRACT_VERSION ||
    contractManifest.schemas.reviewResult !==
      "./v2/review-result.schema.json" ||
    reviewResultSchema.properties.schemaVersion.const !== 2 ||
    legacyReviewResultSchema.properties.contractVersion.const !==
      CONTRACT_VERSION ||
    reviewResultSchema.properties.contractVersion.const !== CONTRACT_VERSION
  ) {
    throw new BanzaiError(
      "SCHEMA_VERSION_MISMATCH",
      "Bundled schema contract versions do not match the orchestrator."
    );
  }
}
