// ADR-0071: the test files a narrow verification scope runs, as exact
// test-root-relative paths. `test/verification-suites.test.ts` decides what
// each list must hold: every test file that reads a path of that scope. A list
// may hold more files.

/** Test files that read a `documents` path. */
export const DOCUMENTS_SUITE = Object.freeze([
  "committed-smoke.test.ts",
  "instruction-layouts.test.ts",
  "project-adoption.test.ts",
  "publication.test.ts",
  "release-validation.test.ts",
  "setup-pty.test.ts",
  "version-set.test.ts",
  "workflow-skills.test.ts"
]);

/** Test files that read a `plugin` path. */
export const PLUGIN_SUITE = Object.freeze([
  "committed-smoke.test.ts",
  "doctor.test.ts",
  "instruction-layouts.test.ts",
  "phase-instructions.test.ts",
  "project-adoption.test.ts",
  "publication.test.ts",
  "release-validation.test.ts",
  "setup-client.test.ts",
  "setup-pty.test.ts",
  "task-verification-rounds.test.ts",
  "task-verification.test.ts",
  "version-set.test.ts",
  "workflow-project.test.ts",
  "workflow-skills.test.ts"
]);

/**
 * The test files the `suite` check of a narrow scope runs, each once: the
 * documents suite for `documents`, both suites for `plugin`.
 */
export function suiteFiles(scope) {
  if (scope === "documents") {
    return [...DOCUMENTS_SUITE];
  }
  if (scope === "plugin") {
    return [...new Set([...DOCUMENTS_SUITE, ...PLUGIN_SUITE])].sort();
  }
  throw new Error(`no suite runs for the ${scope} scope`);
}
