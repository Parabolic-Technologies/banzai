// The independently installed plugin and bundled CLI share one prerequisite reader.
export {
  inspectProjectAdoption,
  readAdoptionFile,
  ADOPTION_LABELS,
  SCAFFOLD_MARKER,
  GUIDANCE_MAX_BYTES,
  adoptionDiagnostic
} from "../../../plugins/banzai/lib/project-adoption.mjs";
export type {
  AdoptionClassification,
  AdoptionIssue,
  ProjectAdoption
} from "../../../plugins/banzai/lib/project-adoption.mjs";
