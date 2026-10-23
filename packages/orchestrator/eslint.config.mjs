import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import globals from "globals";
import tseslint from "typescript-eslint";
import {
  ORCHESTRATOR_IMPORT_BOUNDARIES,
  createImportBoundaryConfigs,
  discoverProductionModules,
  validateImportBoundaryPolicy
} from "./import-boundaries.mjs";

const productionModules = discoverProductionModules(
  new URL("./src/", import.meta.url)
);
const importBoundaryConfigs = createImportBoundaryConfigs(
  validateImportBoundaryPolicy(
    ORCHESTRATOR_IMPORT_BOUNDARIES,
    productionModules
  )
);

// Scoped to this workspace on purpose: plugin skills, contracts, and the
// packaged hook under plugins/ are product source with their own conventions
// and are not linted here.
export default tseslint.config(
  {
    ignores: ["dist/", ".test-dist/", ".dist-check-*/"]
  },
  {
    rules: {
      complexity: ["warn", 15],
      "no-nested-ternary": "warn"
    }
  },
  {
    files: ["src/**/*.ts", "test/**/*.ts", "import-boundaries.d.mts"],
    extends: [
      js.configs.recommended,
      tseslint.configs.strictTypeChecked,
      tseslint.configs.stylisticTypeChecked,
      prettier
    ],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname
      }
    },
    rules: {
      // The built-in runner awaits the promise `test()` returns, so treating it
      // as floating reports every test in the suite.
      "@typescript-eslint/no-floating-promises": [
        "error",
        {
          allowForKnownSafeCalls: [
            {
              from: "package",
              package: "node:test",
              name: [
                "test",
                "describe",
                "it",
                "before",
                "after",
                "beforeEach",
                "afterEach"
              ]
            }
          ]
        }
      ],
      // Interpolating a number is intended throughout the progress, status, and
      // error strings. Nullish, any, and object interpolation stay reported.
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        { allowNumber: true }
      ],
      // `while (true)` drives the interactive session loop, which exits by
      // return rather than by condition.
      "@typescript-eslint/no-unnecessary-condition": [
        "error",
        { allowConstantLoopConditions: true }
      ],
      // The redaction and progress sanitizers exist to strip C0/C1 control
      // characters, so the pattern names them deliberately.
      "no-control-regex": "off",
      // A no-op arrow is the default progress reporter.
      "@typescript-eslint/no-empty-function": [
        "error",
        { allow: ["arrowFunctions"] }
      ],
      // Rejecting with the caught value preserves the original failure from a
      // caller-supplied callback; wrapping it would replace that identity.
      "@typescript-eslint/prefer-promise-reject-errors": [
        "error",
        { allowThrowingUnknown: true }
      ],
      // Pre-existing debt, not a new-code allowance: seven vendor-JSON
      // coercions in adapters.ts stringify an `unknown` field. Tracked in
      // PROJECT_MANIFEST.md section 10; keep new occurrences out.
      "@typescript-eslint/no-base-to-string": "warn"
    }
  },
  {
    // node:test accepts a non-awaiting async callback, which is the ordinary
    // shape for a synchronous assertion body.
    files: ["test/**/*.ts"],
    rules: {
      "@typescript-eslint/require-await": "off"
    }
  },
  ...importBoundaryConfigs,
  {
    // Build and test drivers run as plain ESM outside the TypeScript project,
    // so they get syntax-level rules only.
    files: [
      "scripts/**/*.mjs",
      "test/fixtures/release-evidence-api.mjs",
      "eslint.config.mjs",
      "import-boundaries.mjs"
    ],
    extends: [js.configs.recommended, prettier],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: globals.node
    }
  }
);
