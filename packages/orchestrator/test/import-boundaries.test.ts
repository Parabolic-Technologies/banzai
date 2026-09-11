import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  ImportBoundaryPolicyError,
  ORCHESTRATOR_IMPORT_BOUNDARIES,
  createImportBoundaryConfigs,
  discoverProductionModules,
  formatImportBoundaryPolicyError,
  validateImportBoundaryPolicy,
  type ImportBoundaryEntry
} from "../import-boundaries.mjs";

const SOURCE_ROOT = new URL("../src/", import.meta.url);
const PACKAGE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const ESLINT_CONFIG = path.join(PACKAGE_ROOT, "eslint.config.mjs");
type EslintModule = typeof import("eslint");
type EslintInstance = InstanceType<EslintModule["ESLint"]>;
type EslintLintResult = import("eslint").ESLint.LintResult;

async function configuredEslint(): Promise<EslintInstance> {
  // Keep ESLint external to esbuild's test bundle. The package is the actual
  // installed tool under test; bundling its optional config loaders would add
  // a false dependency on `jiti`.
  const packageName = ["es", "lint"].join("");
  const { ESLint } = (await import(packageName)) as EslintModule;
  return new ESLint({
    cwd: PACKAGE_ROOT,
    overrideConfigFile: ESLINT_CONFIG
  });
}

async function lintSource(
  importer: string,
  source: string
): Promise<EslintLintResult> {
  const eslint = await configuredEslint();
  const results = await eslint.lintText(source, {
    filePath: path.join(PACKAGE_ROOT, importer)
  });
  return first(results);
}

function boundaryMessages(
  result: EslintLintResult
): EslintLintResult["messages"] {
  return result.messages.filter(
    (message) =>
      message.ruleId === "no-restricted-imports" ||
      message.ruleId === "no-restricted-syntax"
  );
}

function mutablePolicy(): ImportBoundaryEntry[] {
  return structuredClone(
    ORCHESTRATOR_IMPORT_BOUNDARIES
  ) as ImportBoundaryEntry[];
}

function first<T>(values: readonly T[]): T {
  const value = values[0];
  assert.ok(value !== undefined);
  return value;
}

function record(value: unknown): Record<string, unknown> {
  assert.ok(
    typeof value === "object" && value !== null && !Array.isArray(value)
  );
  return value as Record<string, unknown>;
}

function ruleSeverity(config: unknown, ruleId: string): unknown {
  const rules = record(record(config).rules);
  const setting = rules[ruleId];
  return Array.isArray(setting) ? setting[0] : setting;
}

function policyError(
  callback: () => unknown,
  kind: string
): ImportBoundaryPolicyError {
  let observed: unknown = null;
  try {
    callback();
  } catch (error) {
    observed = error;
  }
  assert.ok(observed instanceof ImportBoundaryPolicyError);
  assert.equal(observed.code, "IMPORT_BOUNDARY_POLICY_INVALID");
  assert.equal(observed.issue.kind, kind);
  assert.equal(observed.stack, `${observed.name}: ${observed.message}`);
  return observed;
}

test("import_boundaries_real_inventory_has_exact_policy_coverage", () => {
  const modules = discoverProductionModules(SOURCE_ROOT);
  const fromString = discoverProductionModules(
    new URL("../src/", import.meta.url).pathname
  );
  assert.deepEqual(fromString, modules);
  assert.deepEqual([...modules], [...modules].sort());
  assert.equal(new Set(modules).size, modules.length);

  const validated = validateImportBoundaryPolicy(
    ORCHESTRATOR_IMPORT_BOUNDARIES,
    modules
  );
  assert.equal(validated.size, modules.length);
  assert.deepEqual([...validated.keys()].sort(), modules);
  assert.equal(createImportBoundaryConfigs(validated).length, modules.length);

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (importer: string): void => {
    assert.ok(!visiting.has(importer), `runtime policy cycle at ${importer}`);
    if (visited.has(importer)) return;
    visiting.add(importer);
    const entry = validated.get(importer);
    assert.ok(entry !== undefined);
    for (const item of entry.runtime) {
      if (!item.target.endsWith(".js")) continue;
      const resolved = path.posix.normalize(
        path.posix.join(path.posix.dirname(importer), item.target)
      );
      visit(`${resolved.slice(0, -3)}.ts`);
    }
    visiting.delete(importer);
    visited.add(importer);
  };
  for (const importer of modules) visit(importer);
});

test("import_boundaries_inventory_drift_fails_closed", () => {
  const modules = [...discoverProductionModules(SOURCE_ROOT)];
  policyError(
    () =>
      validateImportBoundaryPolicy(ORCHESTRATOR_IMPORT_BOUNDARIES, [
        ...modules,
        "src/unclassified.ts"
      ]),
    "importer_missing"
  );
  policyError(
    () =>
      validateImportBoundaryPolicy(
        ORCHESTRATOR_IMPORT_BOUNDARIES,
        modules.filter((module) => module !== "src/ansi.ts")
      ),
    "importer_stale"
  );
  policyError(
    () =>
      validateImportBoundaryPolicy(ORCHESTRATOR_IMPORT_BOUNDARIES, [
        ...modules,
        first(modules)
      ]),
    "source_module_duplicate"
  );

  const duplicate = mutablePolicy();
  duplicate.push(structuredClone(first(duplicate)));
  policyError(
    () => validateImportBoundaryPolicy(duplicate, modules),
    "importer_duplicate"
  );
});

test("import_boundaries_permissions_are_exact_and_authorized", () => {
  const modules = [...discoverProductionModules(SOURCE_ROOT)];

  const wildcard = mutablePolicy();
  first(first(wildcard).runtime).target = "./*";
  const wildcardError = policyError(
    () => validateImportBoundaryPolicy(wildcard, modules),
    "target_invalid"
  );
  assert.doesNotMatch(wildcardError.message, /\.\/\*/);

  const absolute = mutablePolicy();
  first(first(absolute).runtime).target = "/tmp/private.ts";
  const absoluteError = policyError(
    () => validateImportBoundaryPolicy(absolute, modules),
    "target_invalid"
  );
  assert.doesNotMatch(absoluteError.message, /\/tmp\/private/);

  const missingAuthority = mutablePolicy();
  first(first(missingAuthority).runtime).authority = "ADR-9999";
  policyError(
    () => validateImportBoundaryPolicy(missingAuthority, modules),
    "permission_authority_invalid"
  );

  const overlap = mutablePolicy();
  const overlapEntry = overlap.find(
    (entry) => entry.importer === "src/setup-client.ts"
  );
  assert.ok(overlapEntry);
  overlapEntry.typeOnly = [
    ...overlapEntry.typeOnly,
    structuredClone(first(overlapEntry.runtime))
  ];
  policyError(
    () => validateImportBoundaryPolicy(overlap, modules),
    "permission_overlap"
  );

  const duplicateTarget = mutablePolicy();
  const duplicateEntry = first(duplicateTarget);
  duplicateEntry.runtime = [
    ...duplicateEntry.runtime,
    structuredClone(first(duplicateEntry.runtime))
  ];
  policyError(
    () => validateImportBoundaryPolicy(duplicateTarget, modules),
    "permission_duplicate"
  );
});

test("import_boundaries_reject_nonexistent_adr_authority", () => {
  const modules = [...discoverProductionModules(SOURCE_ROOT)];
  const nonexistentAuthority = mutablePolicy();
  const entry = first(nonexistentAuthority);
  entry.authorities = [...entry.authorities, "ADR-9999"];
  first(entry.runtime).authority = "ADR-9999";

  policyError(
    () => validateImportBoundaryPolicy(nonexistentAuthority, modules),
    "authority_invalid"
  );
});

test("import_boundaries_diagnostics_are_closed_and_repository_relative", () => {
  assert.equal(
    formatImportBoundaryPolicyError({
      kind: "importer_missing",
      importer: "src/new-module.ts"
    }),
    "IMPORT_BOUNDARY_POLICY_INVALID importer_missing importer=src/new-module.ts"
  );
  assert.equal(
    formatImportBoundaryPolicyError({
      kind: "target_invalid",
      importer: "/private/checkout/src/module.ts",
      target: "/private/secret.ts"
    }),
    "IMPORT_BOUNDARY_POLICY_INVALID target_invalid importer=<invalid-module> target=<invalid-target>"
  );
});

test("import_boundaries_loaded_eslint_blocks_static_kpi_violations", async () => {
  const cases = [
    'import { loadConfig } from "./config.js"; void loadConfig;',
    'import { loadConfig } from "./config.js";',
    'import "./config.js";',
    'export { loadConfig } from "./config.js";'
  ];
  for (const source of cases) {
    const result = await lintSource("src/evaluation-kpi.ts", source);
    const messages = boundaryMessages(result);
    assert.ok(messages.length > 0);
    assert.ok(
      messages.some(
        (message) =>
          message.ruleId === "no-restricted-imports" &&
          message.severity === 2 &&
          message.message.includes("'./config.js'") &&
          message.message.includes("Runtime dependency") &&
          message.message.includes("src/evaluation-kpi.ts") &&
          message.message.includes("derived-evaluation-kpi") &&
          message.message.includes("ADR-0026")
      )
    );
  }

  const allowed = await lintSource(
    "src/evaluation-kpi.ts",
    'import { BanzaiError } from "./errors.js";\nimport type { EvaluationExport } from "./types.js";\nvoid BanzaiError;\nexport type Result = EvaluationExport;'
  );
  assert.deepEqual(boundaryMessages(allowed), []);
});

test("import_boundaries_type_only_permission_never_authorizes_runtime", async () => {
  const allowed = await lintSource(
    "src/types.ts",
    'import type { WorkspaceEntry } from "./git.js";\nexport type Entry = WorkspaceEntry;'
  );
  assert.deepEqual(boundaryMessages(allowed), []);

  const allowedReexport = await lintSource(
    "src/types.ts",
    'export type { WorkspaceEntry } from "./git.js";'
  );
  assert.deepEqual(boundaryMessages(allowedReexport), []);

  const specifierType = await lintSource(
    "src/types.ts",
    'import { type WorkspaceEntry } from "./git.js"; export type Entry = WorkspaceEntry;'
  );
  assert.ok(
    boundaryMessages(specifierType).some((message) =>
      message.message.includes("declaration-level import type")
    )
  );

  const specifierReexport = await lintSource(
    "src/types.ts",
    'export { type WorkspaceEntry } from "./git.js";'
  );
  assert.ok(
    boundaryMessages(specifierReexport).some((message) =>
      message.message.includes("declaration-level export type")
    )
  );

  const runtime = await lintSource(
    "src/types.ts",
    'import { currentCommit } from "./git.js"; void currentCommit;'
  );
  assert.ok(
    boundaryMessages(runtime).some(
      (message) =>
        message.ruleId === "no-restricted-imports" &&
        message.message.includes("Runtime dependency") &&
        message.message.includes("src/types.ts") &&
        message.message.includes("./git.js")
    )
  );

  const runtimeReexport = await lintSource(
    "src/types.ts",
    'export { currentCommit } from "./git.js";'
  );
  assert.ok(
    boundaryMessages(runtimeReexport).some((message) =>
      message.message.includes("Runtime dependency")
    )
  );

  const unrelated = await lintSource(
    "src/types.ts",
    'import { loadConfig } from "./config.js"; void loadConfig;'
  );
  assert.ok(
    boundaryMessages(unrelated).some((message) =>
      message.message.includes("./config.js")
    )
  );

  const unrelatedType = await lintSource(
    "src/types.ts",
    'import type { ConfigFile } from "./config.js"; export type Value = ConfigFile;'
  );
  const unrelatedTypeMessages = boundaryMessages(unrelatedType);
  assert.ok(
    unrelatedTypeMessages.some((message) =>
      message.message.includes("./config.js")
    )
  );
  assert.ok(
    unrelatedTypeMessages.some((message) =>
      message.message.includes("Type-only dependency")
    )
  );
});

test("import_boundaries_narrow_and_inward_examples_fail", async () => {
  const cases = [
    ["src/context-report.ts", "./workflow.js"],
    ["src/context-accounting.ts", "./config.js"],
    ["src/prompt-envelope.ts", "./prompts.js"],
    ["src/output-contract.ts", "./workflow.js"],
    ["src/process.ts", "./cli.js"]
  ] as const;
  for (const [importer, target] of cases) {
    const result = await lintSource(
      importer,
      `import ${JSON.stringify(target)};`
    );
    assert.ok(
      boundaryMessages(result).some(
        (message) =>
          message.ruleId === "no-restricted-imports" &&
          message.message.includes(target)
      )
    );
  }
});

test("import_boundaries_alternate_local_loaders_cannot_bypass", async () => {
  const cases = [
    'const value = import("./config.js"); void value;',
    "declare const target: string; const value = import(target); void value;",
    'type Value = import("./config.js").ConfigFile;',
    'import value = require("./config.js"); void value;',
    'const value = require("./config.js"); void value;',
    'const value = module.require("./config.js"); void value;',
    'import { createRequire } from "node:module"; void createRequire;',
    'import * as moduleApi from "node:module"; void moduleApi.createRequire;',
    'import moduleApi from "node:module"; void moduleApi.createRequire;'
  ];
  for (const source of cases) {
    const result = await lintSource("src/evaluation-kpi.ts", source);
    assert.ok(boundaryMessages(result).length > 0, source);
  }

  const external = await lintSource(
    "src/evaluation-kpi.ts",
    'const value = import("node:path"); void value;'
  );
  assert.deepEqual(boundaryMessages(external), []);
});

test("import_boundaries_commonjs_loader_aliases_cannot_bypass", async () => {
  const cases = [
    'const loader = require; loader("./config.js");',
    'const loader = module.require; loader("./config.js");',
    'const moduleApi = await import("node:module"); const loader = moduleApi.createRequire(import.meta.url); loader("./config.js");',
    'const moduleApi = await import("module"); const loader = moduleApi.createRequire(import.meta.url); loader("./config.js");',
    'const loader = process.getBuiltinModule("node:module").createRequire(import.meta.url); loader("./config.js");'
  ];
  for (const source of cases) {
    const result = await lintSource("src/evaluation-kpi.ts", source);
    assert.ok(boundaryMessages(result).length > 0, source);
  }
});

test("import_boundaries_inline_disable_cannot_suppress_gate", async () => {
  const result = await lintSource(
    "src/evaluation-kpi.ts",
    '/* eslint-disable no-restricted-imports, no-restricted-syntax */\nimport "./config.js";'
  );
  assert.ok(
    result.messages.some(
      (message) =>
        message.ruleId === null && message.message.includes("has no effect")
    )
  );
  assert.ok(
    boundaryMessages(result).some(
      (message) => message.ruleId === "no-restricted-imports"
    )
  );
});

test("import_boundaries_effective_config_keeps_blocking_rules", async () => {
  const eslint = await configuredEslint();
  const config: unknown = await eslint.calculateConfigForFile(
    path.join(PACKAGE_ROOT, "src/evaluation-kpi.ts")
  );
  assert.ok(config !== undefined);
  assert.equal(record(record(config).linterOptions).noInlineConfig, true);
  assert.equal(ruleSeverity(config, "no-restricted-imports"), 2);
  assert.equal(ruleSeverity(config, "no-restricted-syntax"), 2);

  const testConfig: unknown = await eslint.calculateConfigForFile(
    path.join(PACKAGE_ROOT, "test/import-boundaries.test.ts")
  );
  assert.ok(testConfig !== undefined);
  assert.equal(
    record(record(testConfig).rules)["no-restricted-imports"],
    undefined
  );
  const testResult = await lintSource(
    "test/import-boundaries.test.ts",
    'import { loadConfig } from "../src/config.js"; void loadConfig;'
  );
  assert.deepEqual(boundaryMessages(testResult), []);
});

test("import_boundaries_formatter_is_deterministic_and_path_safe", async () => {
  const eslint = await configuredEslint();
  const source = 'import { loadConfig } from "./config.js"; void loadConfig;';
  const result = await lintSource("src/evaluation-kpi.ts", source);
  const formatter = await eslint.loadFormatter(
    "./scripts/eslint-formatter.mjs"
  );
  const firstOutput = await formatter.format([result]);
  const secondOutput = await formatter.format([result]);
  assert.equal(secondOutput, firstOutput);
  assert.match(firstOutput, /src\/evaluation-kpi\.ts/);
  assert.match(firstOutput, /\.\/config\.js/);
  assert.match(firstOutput, /Runtime dependency/);
  assert.match(firstOutput, /derived-evaluation-kpi/);
  assert.match(firstOutput, /ADR-0026/);
  assert.doesNotMatch(
    firstOutput,
    new RegExp(PACKAGE_ROOT.replaceAll("/", "\\/"))
  );
  assert.doesNotMatch(firstOutput, /void loadConfig/);
});
