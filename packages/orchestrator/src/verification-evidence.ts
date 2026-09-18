/** Typed facade for the plugin's single deterministic verification owner. */
export {
  VerificationEvidenceError,
  captureVerificationInputs,
  decideVerification,
  evidenceDigest,
  parseVerificationConfiguration,
  parseVerificationDecision,
  parseVerificationObligations,
  sameVerificationCapture,
  verificationIdentities
} from "../../../plugins/banzai/lib/verification-evidence.mjs";
export type {
  EvidenceConfiguration,
  VerificationCapture,
  VerificationDecision,
  VerificationIdentity,
  VerificationObligations,
  VerificationOrigin,
  VerificationPolicy,
  VerificationPhysicalAttempt
} from "../../../plugins/banzai/lib/verification-evidence.mjs";

export {
  parseVerificationOriginStart,
  parseVerificationOriginFinish,
  parseVerificationApplicability,
  persistVerificationApplicability,
  persistVerificationDecision,
  persistVerificationOriginStart,
  persistVerificationOriginFinish,
  readVerificationOrigins,
  verificationApplicability
} from "../../../plugins/banzai/lib/verification-store.mjs";
export type {
  VerificationApplicability,
  VerificationStorage,
  ReviewVerificationEvidence
} from "../../../plugins/banzai/lib/verification-store.mjs";

export {
  parseTaskVerificationDescriptor,
  parseTaskVerificationCandidates,
  parseTaskVerificationObligations,
  parseTaskVerificationPolicy,
  selectTaskVerification,
  taskVerificationPath,
  authorizeTaskVerification,
  discoverTaskVerification
} from "../../../plugins/banzai/lib/task-verification.mjs";
export type {
  TaskVerificationDescriptor,
  TaskVerificationCandidates,
  TaskVerificationObligations,
  TaskVerificationPolicy,
  TaskVerificationAuthority,
  TaskVerificationContext,
  TaskVerificationSelection
} from "../../../plugins/banzai/lib/task-verification.mjs";

export {
  parseTaskVerificationPublication,
  parseTaskVerificationDecision,
  parseTaskVerificationAttempt,
  captureTaskVerificationInputs,
  readTaskVerificationAttempts,
  taskVerificationApplicability,
  executeTaskVerification
} from "../../../plugins/banzai/lib/task-verification-store.mjs";
export type {
  TaskVerificationPublication,
  TaskVerificationAttempt,
  TaskVerificationDecision,
  TaskVerificationApplicability,
  TaskVerificationCapture
} from "../../../plugins/banzai/lib/task-verification-store.mjs";
