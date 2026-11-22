// ADR-0071: the verification scope of a change set. A CI lane executes the
// base revision's copy of this file alone, from outside the checkout, so it
// imports only Node built-ins and nothing from the repository. Its `--ci`
// command line and environment are a compatibility surface between a change's
// workflow and its base revision's copy.
import { execFile } from "node:child_process";
import { realpathSync } from "node:fs";
import { appendFile, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const scriptPath = fileURLToPath(import.meta.url);

/** Widest first: a change set takes the first scope any of its paths has. */
export const SCOPE_ORDER = Object.freeze(["full", "plugin", "documents"]);

export const NO_SCOPE_RULE = "no scope rule";

export const SCOPE_REASONS = Object.freeze({
  empty: "the change set is empty",
  uncomputable: "the change set could not be computed",
  dispatch: "manual dispatch runs the complete check",
  noBaseRules: "the base revision has no scope rules"
});

const REPORT_PATH_LIMIT = 50;

// The rules of ADR-0071 section 1 in precedence order; the first rule that
// names a path decides its scope. This table is the only place a path rule
// lives: workflows and other tools classify through it.
export const SCOPE_RULES = Object.freeze(
  [
    ["full", "orchestrator package", { directory: "packages/orchestrator" }],
    ["full", "plugin hook", { directory: "plugins/banzai/hooks" }],
    ["full", "plugin library", { directory: "plugins/banzai/lib" }],
    ["full", "plugin contract", { directory: "plugins/banzai/contracts" }],
    ["full", "plugin manifest", { directory: "plugins/banzai/.claude-plugin" }],
    ["full", "plugin manifest", { directory: "plugins/banzai/.codex-plugin" }],
    ["full", "root package file", { file: "package.json" }],
    ["full", "root package file", { file: "package-lock.json" }],
    ["full", "release-train version file", { file: "marketplace.json" }],
    [
      "full",
      "release-train version file",
      { file: ".agents/plugins/marketplace.json" }
    ],
    ["full", "workflow", { directory: ".github" }],
    ["full", "release policy", { file: "release-policy.json" }],
    ["plugin", "plugin file", { directory: "plugins/banzai" }],
    ["documents", "documentation", { directory: "documentation" }],
    ["documents", "root Markdown", { rootMarkdown: true }],
    ["documents", "publication policy", { file: "publication-policy.json" }]
  ].map(([scope, label, root]) =>
    Object.freeze({
      scope,
      label,
      directory: root.directory ?? null,
      file: root.file ?? null,
      rootMarkdown: root.rootMarkdown === true
    })
  )
);

function ruleNames(rule, name) {
  if (rule.directory !== null) {
    return name.startsWith(`${rule.directory}/`);
  }
  if (rule.file !== null) {
    return name === rule.file;
  }
  return !name.includes("/") && name.endsWith(".md");
}

/** The scope and label of one repository-relative, `/`-separated path. */
export function classifyPath(name) {
  // Git never prints such names; anything that is not a plain relative path
  // gets the widest scope rather than a guess.
  const plain =
    typeof name === "string" &&
    name.length > 0 &&
    !name.startsWith("/") &&
    name
      .split("/")
      .every((part) => part !== "" && part !== "." && part !== "..");
  const rule = plain ? SCOPE_RULES.find((item) => ruleNames(item, name)) : null;
  return rule === undefined || rule === null
    ? { scope: "full", label: NO_SCOPE_RULE }
    : { scope: rule.scope, label: rule.label };
}

const byteOrder = (left, right) =>
  Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));

/**
 * The scope of a change set, `null` meaning it could not be computed. The
 * deciding paths are the paths whose scope equals the change set's scope.
 */
export function scopeOfChangeSet(paths) {
  if (paths === null) {
    return { scope: "full", reason: SCOPE_REASONS.uncomputable, deciding: [] };
  }
  const names = [...new Set(paths)].sort(byteOrder);
  if (names.length === 0) {
    return { scope: "full", reason: SCOPE_REASONS.empty, deciding: [] };
  }
  const classified = names.map((name) => ({
    path: name,
    ...classifyPath(name)
  }));
  const scope = SCOPE_ORDER.find((candidate) =>
    classified.some((item) => item.scope === candidate)
  );
  return {
    scope,
    reason: null,
    deciding: classified
      .filter((item) => item.scope === scope)
      .map(({ path: name, label }) => ({ path: name, label }))
  };
}

export function scopeWithReason(reason) {
  return { scope: "full", reason, deciding: [] };
}

async function git(root, args) {
  const { stdout } = await execFileAsync("git", ["-C", root, ...args], {
    encoding: "buffer",
    timeout: 120_000,
    maxBuffer: 256 * 1024 * 1024
  });
  return stdout;
}

const names = (stdout) =>
  stdout
    .toString("utf8")
    .split("\0")
    .filter((name) => name.length > 0);

// Untracked enumeration and diff paths are relative to the top level only when
// Git runs there, so a root inside a repository cannot be classified.
async function isTopLevel(root) {
  const top = (await git(root, ["rev-parse", "--show-toplevel"]))
    .toString("utf8")
    .trim();
  return (await realpath(top)) === (await realpath(root));
}

/**
 * Paths that differ between the working tree and `base` (a commit or a tree),
 * plus untracked files Git does not ignore; `null` when that cannot be
 * computed. Renames count under both paths.
 */
export async function localChangeSet(root, base = "HEAD") {
  if (typeof base !== "string" || base === "" || base.startsWith("-")) {
    return null;
  }
  try {
    if (!(await isTopLevel(root))) {
      return null;
    }
    const tree = (
      await git(root, ["rev-parse", "--verify", "--quiet", `${base}^{tree}`])
    )
      .toString("utf8")
      .trim();
    const changed = await git(root, [
      "diff",
      "--name-only",
      "--no-renames",
      "--no-ext-diff",
      "-z",
      tree,
      "--"
    ]);
    const untracked = await git(root, [
      "ls-files",
      "--others",
      "--exclude-standard",
      "-z"
    ]);
    return [...names(changed), ...names(untracked)];
  } catch {
    return null;
  }
}

/** Paths that differ between `HEAD` and its first parent; `null` on failure. */
export async function ciChangeSet(root) {
  try {
    if (!(await isTopLevel(root))) {
      return null;
    }
    return names(
      await git(root, [
        "diff",
        "--name-only",
        "--no-renames",
        "--no-ext-diff",
        "-z",
        "HEAD^1",
        "HEAD",
        "--"
      ])
    );
  } catch {
    return null;
  }
}

/** The report's lines; each path is a JSON string so a name stays one line. */
export function reportLines(result) {
  const lines = [`Verification scope: ${result.scope}`];
  if (result.reason !== null) {
    lines.push(`Reason: ${result.reason}`);
    return lines;
  }
  lines.push("Deciding paths:");
  for (const item of result.deciding.slice(0, REPORT_PATH_LIMIT)) {
    lines.push(`  ${JSON.stringify(item.path)} (${item.label})`);
  }
  if (result.deciding.length > REPORT_PATH_LIMIT) {
    lines.push(`  and ${result.deciding.length - REPORT_PATH_LIMIT} more`);
  }
  return lines;
}

/**
 * The job summary. Every line after the heading sits in the fenced block and
 * every path line starts with two spaces and a quote, so no file name can
 * close the fence or add a heading.
 */
export function summaryText(result) {
  const [, ...rest] = reportLines(result);
  return [
    `## Verification scope: ${result.scope}`,
    "",
    "```text",
    ...rest,
    "```",
    ""
  ].join("\n");
}

/** The lane's scope step: `node <this file> --ci` in the checkout. */
export async function runCi({
  env = process.env,
  cwd = process.cwd(),
  writeOut = (value) => process.stdout.write(value),
  writeError = (value) => process.stderr.write(value)
} = {}) {
  const outputFile = env.GITHUB_OUTPUT;
  const summaryFile = env.GITHUB_STEP_SUMMARY;
  const event = env.GITHUB_EVENT_NAME;
  if (!outputFile || !summaryFile || !event) {
    writeError(
      "VERIFICATION_SCOPE_FAILED: GITHUB_EVENT_NAME, GITHUB_OUTPUT and GITHUB_STEP_SUMMARY are required\n"
    );
    return 1;
  }
  const result =
    event === "workflow_dispatch"
      ? scopeWithReason(SCOPE_REASONS.dispatch)
      : scopeOfChangeSet(await ciChangeSet(cwd));
  try {
    writeOut(`${reportLines(result).join("\n")}\n`);
    await appendFile(summaryFile, summaryText(result), "utf8");
    // Only the scope word reaches the step output, never a file name.
    await appendFile(outputFile, `scope=${result.scope}\n`, "utf8");
  } catch {
    writeError(
      "VERIFICATION_SCOPE_FAILED: the step output could not be written\n"
    );
    return 1;
  }
  return 0;
}

function invokedDirectly() {
  if (
    path.basename(scriptPath) !== "verification-scope.mjs" ||
    !process.argv[1]
  ) {
    return false;
  }
  try {
    // A temporary directory can be a symbolic link, while the module URL is real.
    return realpathSync(path.resolve(process.argv[1])) === scriptPath;
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--ci") {
    process.exitCode = await runCi();
  } else {
    process.stderr.write(
      "VERIFICATION_SCOPE_FAILED: usage: verification-scope.mjs --ci\n"
    );
    process.exitCode = 1;
  }
}
