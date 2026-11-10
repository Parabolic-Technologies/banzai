/**
 * Shared replay of the phpcs case from the 2.8–2.9 program: a strict plan whose
 * required lint check omits the project's documented config flag, a second
 * required check, and a supplemental implementation check. The tools are small
 * Node scripts, so the run executes real processes without PHP.
 *
 * Reused by later work packages (full verification pass, plan-gate commands,
 * command correction, baseline run) and by the Gate 1 and Gate 2 replays.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { TaskVerificationDescriptor } from "../src/verification-evidence.js";
import { WorkflowRunner } from "../src/workflow.js";
import { commitAll, createTestRepository } from "./helpers.js";
import { FakeAdapters, passingReview } from "./workflow-fixtures.js";

export const PHPCS_CHECK_IDS = {
  lint: "phpcs-dry-run",
  schema: "schema-catalog-check",
  touched: "phpcs-touched-src"
} as const;

/** The documented project command: `composer run-script cs-check`. */
export const PHPCS_DOCUMENTED_ARGS = [
  "tools/php-cs-fixer.cjs",
  "fix",
  "--dry-run",
  "--diff",
  "--config=.php-cs-fixer.php"
] as const;

/** The planner's command: the same tool without `--config`. */
export const PHPCS_PLANNED_ARGS = PHPCS_DOCUMENTED_ARGS.slice(0, -1);

export const PHPCS_FAILURE_EXIT_CODE = 8;
export const PHPCS_FAILURE_STDERR_LINES = 26;
/** Exit code of the schema check when `schemaFailsWithout` names a missing file. */
export const PHPCS_SCHEMA_FAILURE_EXIT_CODE = 3;

// Built at runtime so no credential-shaped literal sits in the source tree.
const leakedToken = ["sk", "ant", "phpcsfixturetoken0123"].join("-");

const linter = `const fs = require("node:fs");
const config = process.argv.find((arg) => arg.startsWith("--config="));
if (config === undefined) {
  for (let index = 1; index <= ${PHPCS_FAILURE_STDERR_LINES - 2}; index++)
    console.error("\\u001b[31m   " + index + ") src/Module" + index + ".php (ordered_imports)\\u001b[0m");
  console.error("Loaded config default; cache token ${leakedToken}");
  console.error("Found ${PHPCS_FAILURE_STDERR_LINES - 2} of 35 files that can be fixed.");
  process.exit(${PHPCS_FAILURE_EXIT_CODE});
}
if (!fs.existsSync(config.slice("--config=".length))) {
  console.error("Configuration file not found.");
  process.exit(16);
}
console.log("Checked 35 files, no violations.");
`;

function descriptor(
  id: string,
  name: string,
  args: readonly string[]
): TaskVerificationDescriptor {
  return {
    id,
    name,
    requirementRefs: ["FR1"],
    command: process.execPath,
    args: [...args],
    cwd: ".",
    timeoutMs: 10_000,
    evidence: "fresh",
    sources: [],
    materialization: null
  };
}

export const phpcsPlannedChecks = (
  lintArgs: readonly string[] = PHPCS_PLANNED_ARGS
): TaskVerificationDescriptor[] => [
  descriptor(PHPCS_CHECK_IDS.lint, "PHP CS Fixer dry run", lintArgs),
  descriptor(PHPCS_CHECK_IDS.schema, "Schema catalog check", [
    "tools/schema-catalog-check.cjs"
  ])
];

export const phpcsSupplementalChecks = (): TaskVerificationDescriptor[] => [
  descriptor(PHPCS_CHECK_IDS.touched, "PHP CS Fixer on touched sources", [
    ...PHPCS_DOCUMENTED_ARGS,
    "src"
  ])
];

/**
 * A strict run waiting for plan approval, with the phpcs tooling committed and
 * the planned obligations written into plan.md.
 */
export async function phpcsPlanGateFixture(
  options: { lintArgs?: readonly string[]; schemaFailsWithout?: string } = {}
) {
  const repository = await createTestRepository();
  try {
    await mkdir(path.join(repository.root, "tools"), { recursive: true });
    await writeFile(
      path.join(repository.root, "tools/php-cs-fixer.cjs"),
      linter
    );
    await writeFile(
      path.join(repository.root, "tools/schema-catalog-check.cjs"),
      options.schemaFailsWithout === undefined
        ? 'console.log("Schema catalog is consistent.");\n'
        : `if (!require("node:fs").existsSync(${JSON.stringify(options.schemaFailsWithout)})) {
  console.error("Schema catalog entry is missing.");
  process.exit(${PHPCS_SCHEMA_FAILURE_EXIT_CODE});
}
console.log("Schema catalog is consistent.");
`
    );
    await writeFile(
      path.join(repository.root, ".php-cs-fixer.php"),
      "<?php\nreturn (new PhpCsFixer\\Config())->setRules(['@PSR12' => true]);\n"
    );
    await commitAll(repository.root, "php project tooling");
    const adapters = new FakeAdapters();
    adapters.planVerificationChecks = phpcsPlannedChecks(options.lintArgs);
    adapters.strictVerificationCandidates = phpcsSupplementalChecks();
    adapters.reviewResults.push(passingReview());
    const runner = new WorkflowRunner(repository.root, adapters);
    const state = await runner.start({
      slug: "php-module",
      request: "Add the PHP module with schema catalog entries."
    });
    return { repository, adapters, runner, state };
  } catch (error) {
    await repository.dispose();
    throw error;
  }
}

/**
 * A strict run blocked in task verification by the wrong lint command, with
 * the implementation completed and the plan approved.
 */
export async function phpcsVerificationFixture(
  options: { lintArgs?: readonly string[]; schemaFailsWithout?: string } = {}
) {
  const gate = await phpcsPlanGateFixture(options);
  try {
    const state = await gate.runner.approvePlan("human");
    return { ...gate, state };
  } catch (error) {
    await gate.repository.dispose();
    throw error;
  }
}
