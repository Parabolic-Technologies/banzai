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
