// `npm run check` (ADR-0071 section 3): the checks of the working tree's
// verification scope. The scope comes from the local change set and the scope
// rules beside this script; no option selects or narrows it. The command
// writes nothing in the inspected checkout: the publication check runs on a
// disposable copy with its own index.
import { cp, lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CheckoutCopyError, withCheckoutCopy } from "./checkout-copy.mjs";
import { startComponent } from "./component-runner.mjs";
import {
  localChangeSet,
  reportLines,
  scopeOfChangeSet
} from "./verification-scope.mjs";
import { suiteFiles } from "./verification-suites.mjs";

const defaultRepositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../.."
);
const DISTRIBUTION = "packages/orchestrator/dist";
const CHECK_NAMES = Object.freeze([
  "distribution-build",
  "build-check",
  "release-validation",
  "publication",
  "suite",
  "verify"
]);
const SCOPE_CHECKS = Object.freeze({
  documents: [
    "distribution-build",
    "build-check",
    "release-validation",
    "publication",
    "suite"
  ],
  plugin: [
    "distribution-build",
    "build-check",
    "release-validation",
    "publication",
    "suite"
  ],
  full: ["distribution-build", "verify"]
});

class CheckError extends Error {
  constructor(line) {
    super(line);
    this.name = "CheckError";
  }
}

const invalidOption = (detail) =>
  new CheckError(`INVALID_CHECK_OPTION: ${detail}`);

function defaultComponents(root) {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  return {
    "distribution-build": { command: npm, args: ["run", "build:dist"] },
    "build-check": { command: npm, args: ["run", "build:check"] },
    "release-validation": { command: npm, args: ["run", "release:validate"] },
    // The checkout's publication check, whose imports resolve to the
    // checkout's installed dependencies, inspects the copy it runs in.
    publication: {
      command: process.execPath,
      args: [
        path.join(root, "packages/orchestrator/scripts/publication-release.mjs")
      ]
    },
    // Each suite file follows as `--file <path>`.
    suite: {
      command: process.execPath,
      args: ["packages/orchestrator/scripts/test.mjs"]
    },
    verify: { command: npm, args: ["run", "verify"] }
  };
}

function parseArguments(args) {
  const values = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const option = args[index];
    const value = args[index + 1];
    if (!["--base", "--root", "--fixture-components"].includes(option)) {
      throw invalidOption(`unknown argument ${JSON.stringify(option)}`);
    }
    if (value === undefined) {
      throw invalidOption(`${option} requires a value`);
    }
    if (value === "" || value.startsWith("-")) {
      throw invalidOption(
        `${option} needs a value that is not empty and does not start with -`
      );
    }
    if (values.has(option)) {
      throw invalidOption(`${option} is given more than once`);
    }
    values.set(option, value);
  }
  return {
    base: values.get("--base") ?? "HEAD",
    root: path.resolve(values.get("--root") ?? defaultRepositoryRoot),
    fixtureComponents: values.has("--fixture-components")
      ? path.resolve(values.get("--fixture-components"))
      : null
  };
}

/** Test-only substitutes: one `{ name, command, args }` for every check. */
async function fixtureComponents(file) {
  const invalid = (detail) => invalidOption(`--fixture-components ${detail}`);
  let parsed;
  try {
    parsed = JSON.parse(await readFile(file, "utf8"));
  } catch {
    throw invalid("is unreadable");
  }
  if (!Array.isArray(parsed)) {
    throw invalid("must be an array");
  }
  const components = {};
  for (const value of parsed) {
    if (
      typeof value !== "object" ||
      value === null ||
      !CHECK_NAMES.includes(value.name) ||
      Object.hasOwn(components, value.name) ||
      typeof value.command !== "string" ||
      !Array.isArray(value.args) ||
      !value.args.every((item) => typeof item === "string")
    ) {
      throw invalid("needs one { name, command, args } for each check");
    }
    components[value.name] = { command: value.command, args: value.args };
  }
  if (CHECK_NAMES.some((name) => !Object.hasOwn(components, name))) {
    throw invalid("needs one { name, command, args } for each check");
  }
  return components;
}

const state = { interrupted: false, child: null, current: null };

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    state.interrupted = true;
    try {
      state.child?.kill("SIGTERM");
    } catch {
      // The check may already have exited.
    }
  });
}

/** Runs one component; `null` once interrupted, before it would start. */
async function runComponent(component, cwd, extraArgs = []) {
  if (state.interrupted) {
    return null;
  }
  const { child, outcome } = startComponent(
    { command: component.command, args: [...component.args, ...extraArgs] },
    cwd
  );
  state.child = child;
  try {
    return await outcome;
  } finally {
    state.child = null;
  }
}

async function copyDistribution(root, copy) {
  const source = path.join(root, DISTRIBUTION);
  if ((await lstat(source).catch(() => null)) === null) {
    return;
  }
  // Ignored build output: copied beside the indexed files, never indexed.
  await cp(source, path.join(copy, DISTRIBUTION), {
    recursive: true,
    verbatimSymlinks: true
  });
}

async function runPublication(root, component) {
  try {
    return await withCheckoutCopy(
      root,
      {
        prefix: "banzai-check-",
        prepare: (copy) => copyDistribution(root, copy)
      },
      (copy) => runComponent(component, copy)
    );
  } catch (error) {
    throw new CheckError(
      error instanceof CheckoutCopyError
        ? `CHECK_FAILED: publication could not copy the checkout (${error.message})`
        : "CHECK_FAILED: publication could not copy the checkout"
    );
  }
}

function failure(name, outcome) {
  if (state.interrupted || outcome === null || outcome.kind === "signal") {
    return `CHECK_FAILED: ${name} was interrupted`;
  }
  if (outcome.kind === "error") {
    return `CHECK_FAILED: ${name} could not start`;
  }
  return `CHECK_FAILED: ${name} exited with code ${outcome.code}`;
}

async function executeCheck({ base, root, fixtureComponents: fixture }) {
  const components =
    fixture === null
      ? defaultComponents(root)
      : await fixtureComponents(fixture);
  const result = scopeOfChangeSet(await localChangeSet(root, base));
  process.stdout.write(`${reportLines(result).join("\n")}\n`);
  for (const name of SCOPE_CHECKS[result.scope]) {
    if (state.interrupted) {
      throw new CheckError(`CHECK_FAILED: ${name} was interrupted`);
    }
    state.current = name;
    process.stdout.write(`check: ${name}\n`);
    const outcome =
      name === "publication"
        ? await runPublication(root, components.publication)
        : await runComponent(
            components[name],
            root,
            name === "suite"
              ? suiteFiles(result.scope).flatMap((file) => ["--file", file])
              : []
          );
    if (state.interrupted || outcome?.kind !== "exit" || outcome.code !== 0) {
      throw new CheckError(failure(name, outcome));
    }
  }
  process.stdout.write(`check passed (${result.scope} scope)\n`);
}

try {
  await executeCheck(parseArguments(process.argv.slice(2)));
} catch (error) {
  process.stderr.write(
    `${
      error instanceof CheckError
        ? error.message
        : `CHECK_FAILED: ${state.current ?? "check"} could not complete`
    }\n`
  );
  process.exitCode = 1;
}
