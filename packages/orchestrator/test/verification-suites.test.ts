import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";
import type TypeScript from "typescript";
import { SCOPE_RULES, classifyPath } from "../scripts/verification-scope.mjs";
import {
  DOCUMENTS_SUITE,
  PLUGIN_SUITE,
  suiteFiles
} from "../scripts/verification-suites.mjs";

// The membership reading of ADR-0071 (FR15): which scopes a test file reads.
// It is a function of a test root, taken as `packages/orchestrator/test`, so
// it applies to the repository and to temporary trees alike.

type Scope = "full" | "plugin" | "documents";
interface Suites {
  documents: readonly string[];
  plugin: readonly string[];
}

// Loaded at run time: the test bundle cannot hold the compiler's CommonJS build.
const ts = createRequire(import.meta.url)("typescript") as typeof TypeScript;

const PACKAGE = "packages/orchestrator";
const EVERY_SCOPE: readonly Scope[] = ["full", "plugin", "documents"];
const SCRIPT_SOURCE = /\.(?:[cm]?[jt]s|tsx)$/;

/** A repository-relative location, `""` for the root, `..` segments above it. */
function locationOf(base: string, name: string): string {
  const location = path.posix
    .normalize(path.posix.join(base, name))
    .replace(/\/+$/, "");
  return location === "." ? "" : location;
}

/** The scopes a location reads (item 3); none inside the package or beside the repository. */
function locationScopes(location: string): Scope[] {
  if (location === PACKAGE || location.startsWith(`${PACKAGE}/`)) {
    return [];
  }
  const segments = location === "" ? [] : location.split("/");
  if (segments.every((segment) => segment === "..")) {
    return [...EVERY_SCOPE];
  }
  if (segments[0] === "..") {
    return [];
  }
  const scopes = new Set<Scope>([classifyPath(location).scope]);
  for (const rule of SCOPE_RULES) {
    const root = rule.directory ?? rule.file;
    if (
      root !== null &&
      (root === location || root.startsWith(`${location}/`))
    ) {
      scopes.add(rule.scope);
    }
  }
  return [...scopes];
}

interface SourceReading {
  /** Repository-relative locations the source names. */
  locations: string[];
  /** Relative import and export specifiers. */
  specifiers: string[];
}

function readSource(fileName: string, text: string): SourceReading {
  const source = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    false,
    /\.[cm]?js$/.test(fileName) ? ts.ScriptKind.JS : ts.ScriptKind.TS
  );
  const specifierNodes = new Set<TypeScript.Node>();
  const literals: string[] = [];
  const specifiers: string[] = [];

  const specifier = (node: TypeScript.Node | undefined) => {
    if (node !== undefined && ts.isStringLiteralLike(node)) {
      specifierNodes.add(node);
      if (node.text.startsWith("./") || node.text.startsWith("../")) {
        specifiers.push(node.text);
      }
    }
  };
  // A literal's text; for a template with substitutions, the text before the
  // first substitution cut back to its last `/`.
  const literalText = (node: TypeScript.Node): string | null => {
    if (specifierNodes.has(node)) {
      return null;
    }
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      return node.text;
    }
    if (ts.isTemplateExpression(node)) {
      const head = node.head.text;
      return head.slice(0, head.lastIndexOf("/") + 1);
    }
    return null;
  };
  // Literals separated only by commas also name the location they join to.
  const runs = (items: readonly TypeScript.Node[]) => {
    let run: string[] = [];
    const close = () => {
      if (run.length > 1) {
        literals.push(run.join("/"));
      }
      run = [];
    };
    for (const item of items) {
      const value = literalText(item);
      if (value === null || value.startsWith("/")) {
        close();
        continue;
      }
      run.push(value);
      if (ts.isTemplateExpression(item)) {
        close();
      }
    }
    close();
  };
  const visit = (node: TypeScript.Node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      specifier(node.moduleSpecifier);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword
    ) {
      specifier(node.arguments[0]);
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument)
    ) {
      specifier(node.argument.literal);
    } else if (ts.isExternalModuleReference(node)) {
      specifier(node.expression);
    }
    const value = literalText(node);
    if (value !== null && !value.startsWith("/")) {
      literals.push(value);
    }
    ts.forEachChild(node, visit);
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      runs(node.arguments ?? []);
    } else if (ts.isArrayLiteralExpression(node)) {
      runs(node.elements);
    }
  };
  visit(source);
  return {
    locations: literals.map((literal) => locationOf(PACKAGE, literal)),
    specifiers
  };
}

async function isFile(name: string): Promise<boolean> {
  return (await stat(name).catch(() => null))?.isFile() ?? false;
}

/** The test-local file a relative specifier loads, or `null`. */
async function testLocalModule(
  testRoot: string,
  importer: string,
  name: string
): Promise<string | null> {
  const target = path.resolve(path.dirname(importer), name);
  const relative = path.relative(testRoot, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }
  const candidates = [
    target,
    target.replace(/\.js$/, ".ts"),
    target.replace(/\.mjs$/, ".mts"),
    target.replace(/\.cjs$/, ".cts"),
    `${target}.ts`,
    path.join(target, "index.ts")
  ];
  for (const candidate of candidates) {
    if (await isFile(candidate)) {
      return candidate;
    }
  }
  return null;
}

/**
 * Every test file under `testRoot`, test-root-relative, with each scope it
 * reads and the first location that reads it (items 1–4).
 */
async function readTestRoot(
  testRoot: string
): Promise<Map<string, Map<Scope, string>>> {
  const repositoryDirectory = (file: string) =>
    path.posix.join(
      PACKAGE,
      "test",
      path.relative(testRoot, path.dirname(file)).split(path.sep).join("/")
    );
  const own = new Map<string, Map<Scope, string>>();
  const imports = new Map<string, string[]>();
  const readFileSource = async (file: string) => {
    if (own.has(file)) {
      return;
    }
    const scopes = new Map<Scope, string>();
    own.set(file, scopes);
    imports.set(file, []);
    if (!SCRIPT_SOURCE.test(file)) {
      return;
    }
    const reading = readSource(file, await readFile(file, "utf8"));
    const named = [
      ...reading.locations,
      ...reading.specifiers.map((name) =>
        locationOf(repositoryDirectory(file), name)
      )
    ];
    for (const location of named) {
      for (const scope of locationScopes(location)) {
        if (!scopes.has(scope)) {
          scopes.set(scope, location === "" ? "." : location);
        }
      }
    }
    for (const name of reading.specifiers) {
      const module = await testLocalModule(testRoot, file, name);
      if (module !== null) {
        imports.get(file)?.push(module);
        await readFileSource(module);
      }
    }
  };

  const testFiles = (
    await readdir(testRoot, { recursive: true, withFileTypes: true })
  )
    .filter((entry) => entry.isFile() && entry.name.endsWith(".test.ts"))
    .map((entry) => path.join(entry.parentPath, entry.name))
    .sort();
  const result = new Map<string, Map<Scope, string>>();
  for (const file of testFiles) {
    await readFileSource(file);
    const scopes = new Map<Scope, string>();
    const seen = new Set<string>();
    const pending = [file];
    for (
      let current = pending.pop();
      current !== undefined;
      current = pending.pop()
    ) {
      if (seen.has(current)) {
        continue;
      }
      seen.add(current);
      for (const [scope, location] of own.get(current) ?? []) {
        if (!scopes.has(scope)) {
          scopes.set(scope, location);
        }
      }
      pending.push(...(imports.get(current) ?? []));
    }
    result.set(path.relative(testRoot, file).split(path.sep).join("/"), scopes);
  }
  return result;
}

/** The membership failures of item 5, each naming a test file and a suite. */
async function membershipFailures(
  testRoot: string,
  suites: Suites
): Promise<string[]> {
  const readings = await readTestRoot(testRoot);
  const failures: string[] = [];
  for (const [file, scopes] of readings) {
    for (const suite of ["documents", "plugin"] as const) {
      const location = scopes.get(suite);
      if (location !== undefined && !suites[suite].includes(file)) {
        failures.push(
          `${file} reads ${JSON.stringify(location)} and the ${suite} suite does not list it`
        );
      }
    }
  }
  for (const suite of ["documents", "plugin"] as const) {
    for (const file of suites[suite]) {
      if (!readings.has(file)) {
        failures.push(`the ${suite} suite lists ${file}, which does not exist`);
      }
    }
  }
  return failures;
}

const NO_SUITES: Suites = { documents: [], plugin: [] };

async function testRoot(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "banzai-suites-"));
  for (const [name, text] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await writeFile(path.join(root, name), text, "utf8");
  }
  return root;
}

async function scopesOf(
  files: Record<string, string>
): Promise<Record<string, Scope[]>> {
  const root = await testRoot(files);
  try {
    const readings = await readTestRoot(root);
    return Object.fromEntries(
      [...readings].map(([file, scopes]) => [file, [...scopes.keys()].sort()])
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("the suites list every test file that reads a path of their scope", async () => {
  assert.deepEqual(
    await membershipFailures(path.join(process.cwd(), "test"), {
      documents: DOCUMENTS_SUITE,
      plugin: PLUGIN_SUITE
    }),
    []
  );
  for (const suite of [DOCUMENTS_SUITE, PLUGIN_SUITE]) {
    assert.deepEqual([...new Set(suite)].sort(), [...suite]);
  }
  assert.deepEqual(suiteFiles("documents"), [...DOCUMENTS_SUITE]);
  assert.deepEqual(
    suiteFiles("plugin"),
    [...new Set([...DOCUMENTS_SUITE, ...PLUGIN_SUITE])].sort()
  );
  assert.throws(() => suiteFiles("full" as "plugin"));
});

test("a location reads its own scope, the scopes inside it and every scope at or above the root", () => {
  assert.deepEqual(locationScopes("documentation/decisions/README.md"), [
    "documents"
  ]);
  assert.deepEqual(locationScopes("documentation").sort(), [
    "documents",
    "full"
  ]);
  assert.deepEqual(locationScopes("plugins/banzai/skills"), ["plugin"]);
  assert.deepEqual(locationScopes("plugins/banzai").sort(), ["full", "plugin"]);
  assert.deepEqual(locationScopes("plugins").sort(), ["full", "plugin"]);
  // As a path the directory name itself falls under the plugin file rule.
  assert.deepEqual(locationScopes("plugins/banzai/hooks").sort(), [
    "full",
    "plugin"
  ]);
  assert.deepEqual(locationScopes("plugins/banzai/hooks/spec-gate.cjs"), [
    "full"
  ]);
  assert.deepEqual(locationScopes("README.md"), ["documents"]);
  assert.deepEqual(locationScopes("packages"), ["full"]);
  assert.deepEqual(locationScopes(""), ["full", "plugin", "documents"]);
  assert.deepEqual(locationScopes(".."), ["full", "plugin", "documents"]);
  assert.deepEqual(locationScopes("../elsewhere"), []);
  assert.deepEqual(locationScopes("packages/orchestrator/src"), []);
});

test("a test naming a decision record outside the documents suite fails, naming the file and the suite", async () => {
  const root = await testRoot({
    "records.test.ts":
      'import { readFile } from "node:fs/promises";\nawait readFile("../../documentation/decisions/README.md", "utf8");\n'
  });
  try {
    assert.deepEqual(await membershipFailures(root, NO_SUITES), [
      'records.test.ts reads "documentation/decisions/README.md" and the documents suite does not list it'
    ]);
    assert.deepEqual(
      await membershipFailures(root, {
        documents: ["records.test.ts"],
        plugin: []
      }),
      []
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a test reads what its test-local modules name, through every import", async () => {
  const root = await testRoot({
    "skills.test.ts":
      'import { skills } from "./support/skills.js";\nskills();\n',
    "support/skills.ts":
      'export * from "./paths.js";\nexport function skills() {}\n',
    "support/paths.ts":
      'export const skillRoot = "../../plugins/banzai/skills";\n',
    "workflow/nested.test.ts":
      'const { skillRoot } = await import("../support/paths.js");\n',
    "plain.test.ts": 'import { skills } from "../src/skills.js";\n'
  });
  try {
    assert.deepEqual(await membershipFailures(root, NO_SUITES), [
      'skills.test.ts reads "plugins/banzai/skills" and the plugin suite does not list it',
      'workflow/nested.test.ts reads "plugins/banzai/skills" and the plugin suite does not list it'
    ]);
    assert.deepEqual(
      await membershipFailures(root, {
        documents: [],
        plugin: ["skills.test.ts", "workflow/nested.test.ts"]
      }),
      []
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("template prefixes, comma-separated runs and relative imports that leave the package are read", async () => {
  assert.deepEqual(
    await scopesOf({
      "template.test.ts":
        "const skill = (name: string) => `../../plugins/banzai/${name}/SKILL.md`;\n",
      "template-root.test.ts":
        "const file = (root: string) => `${root}/../../documentation/a.md`;\n",
      "run.test.ts":
        'import path from "node:path";\npath.join("..", "..", "documentation", "guide.md");\n',
      "run-array.test.ts": 'const parts = ["..", "..", "README.md"];\n',
      "run-template.test.ts":
        'import path from "node:path";\nconst at = (name: string) => path.join("..", "..", `${name}.md`);\n',
      "import.test.ts":
        'import guide from "../../../documentation/guide.md";\nexport { guide };\n',
      "root.test.ts":
        'import path from "node:path";\nconst repository = path.resolve("..", "..");\n',
      "comment.test.ts": '// see "../../documentation/guide.md"\nexport {};\n'
    }),
    {
      "comment.test.ts": [],
      "import.test.ts": ["documents"],
      "root.test.ts": ["documents", "full", "plugin"],
      "run-array.test.ts": ["documents", "full"],
      "run-template.test.ts": ["documents", "full", "plugin"],
      "run.test.ts": ["documents", "full"],
      "template-root.test.ts": [],
      "template.test.ts": ["full", "plugin"]
    }
  );
});

test("imports inside the package and absolute strings name nothing", async () => {
  assert.deepEqual(
    await scopesOf({
      "inside.test.ts": [
        'import { classifyPath } from "../scripts/verification-scope.mjs";',
        'import { run } from "../src/cli.js";',
        'import path from "node:path";',
        'const parts = "a/b".split("/");',
        'const absolute = path.join("/", "documentation");',
        'const fixture = path.join("test", "fixtures", "README.md");',
        'const sibling = "../../../elsewhere/README.md";',
        ""
      ].join("\n")
    }),
    { "inside.test.ts": [] }
  );
});

test("a suite that lists a missing test file fails", async () => {
  const root = await testRoot({ "present.test.ts": "export {};\n" });
  try {
    assert.deepEqual(
      await membershipFailures(root, {
        documents: ["present.test.ts", "missing.test.ts"],
        plugin: ["workflow/gone.test.ts"]
      }),
      [
        "the documents suite lists missing.test.ts, which does not exist",
        "the plugin suite lists workflow/gone.test.ts, which does not exist"
      ]
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
