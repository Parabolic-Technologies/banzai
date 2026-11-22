import { requiredFixture } from "./helpers.js";
import assert from "node:assert/strict";
import { spawn, spawnSync, type SpawnSyncReturns } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import {
  access,
  appendFile,
  chmod,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  unlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import {
  checkPhaseResourceBytes,
  identity,
  phaseResourceBytes,
  resourceDigest,
  sortedExpectations,
  validateClosedGuidanceBaseline,
  type InstructionAuthority,
  type InstructionTransition
} from "../scripts/phase-resources-build.mjs";
import {
  describeInstructionTransition,
  evolveInstructionBaseline,
  initializeInstructionBaseline,
  validateInstructionBaseline
} from "../scripts/successor-baseline.mjs";
import {
  createNodeVersionFileSystem,
  recoverProjectVersion,
  setProjectVersion,
  VersionOperationError,
  type VersionFileSystem
} from "../scripts/release-version.mjs";

const REPOSITORY_ROOT = path.resolve(process.cwd(), "../..");
const VALIDATOR = path.join(process.cwd(), "scripts", "check-release.mjs");
const RECOVERY_DIRECTORY = ".banzai-version-set";
const RECOVERY_GUARD = `${RECOVERY_DIRECTORY}.guard`;
const RELEASE_VERSION_MODULE = path.join(
  process.cwd(),
  "scripts",
  "release-version.mjs"
);

const VERSION_SURFACES = [
  {
    relativePath: "package.json",
    keys: ["version"],
    missingCode: "INVALID_RELEASE_FIELD"
  },
  {
    relativePath: "package-lock.json",
    keys: ["version"],
    missingCode: "MISSING_RELEASE_FIELD"
  },
  {
    relativePath: "package-lock.json",
    keys: ["packages", "", "version"],
    missingCode: "MISSING_RELEASE_FIELD"
  },
  {
    relativePath: "plugins/banzai/.claude-plugin/plugin.json",
    keys: ["version"],
    missingCode: "INVALID_RELEASE_FIELD"
  },
  {
    relativePath: "plugins/banzai/.codex-plugin/plugin.json",
    keys: ["version"],
    missingCode: "INVALID_RELEASE_FIELD"
  },
  {
    relativePath: "marketplace.json",
    keys: ["plugins", "0", "version"],
    missingCode: "INVALID_RELEASE_FIELD"
  },
  {
    relativePath: ".agents/plugins/marketplace.json",
    keys: ["plugins", "0", "version"],
    missingCode: "INVALID_RELEASE_FIELD"
  },
  {
    relativePath: "packages/orchestrator/package.json",
    keys: ["version"],
    missingCode: "INVALID_RELEASE_FIELD"
  },
  {
    relativePath: "package-lock.json",
    keys: ["packages", "packages/orchestrator", "version"],
    missingCode: "MISSING_RELEASE_FIELD"
  }
] as const;

type VersionSurface = (typeof VERSION_SURFACES)[number];

const FIXTURE_PATHS = [
  "release-policy.json",
  ".github/workflows/ci.yml",
  ".github/workflows/publish.yml",
  "package.json",
  "package-lock.json",
  "README.md",
  "PROJECT_MANIFEST.md",
  "CONTRIBUTING.md",
  "marketplace.json",
  ".agents/plugins/marketplace.json",
  ".claude-plugin/marketplace.json",
  "documentation/release-checklist.md",
  "documentation/decisions/README.md",
  "plugins/banzai",
  "packages/orchestrator/README.md",
  "documentation/orchestrator.md",
  "documentation/verification-examples.md",
  "packages/orchestrator/package.json",
  "packages/orchestrator/src",
  "packages/orchestrator/test",
  "packages/orchestrator/scripts/build.mjs",
  "packages/orchestrator/scripts/init-resources-build.mjs",
  "packages/orchestrator/scripts/artifact-readers-build.mjs",
  "packages/orchestrator/scripts/phase-resources-build.mjs",
  "packages/orchestrator/scripts/successor-baseline.mjs",
  "packages/orchestrator/phase-guidance-baseline.json",
  "packages/orchestrator/phase-guidance-current.json",
  "packages/orchestrator/phase-guidance-current.sha256",
  "packages/orchestrator/instruction-baseline.json",
  "packages/orchestrator/instruction-baseline.sha256",
  "packages/orchestrator/scripts/instruction-baseline.mjs",
  "documentation/decisions/0043-proportionate-verification-evidence.md",
  "documentation/decisions/0044-instruction-baseline-evolution.md",
  "documentation/decisions/0045-guided-verification-setup.md",
  "documentation/decisions/0047-runner-owned-completion-projection.md",
  "documentation/decisions/0048-completion-markup-and-viewer-enrichment-boundary.md",
  "documentation/decisions/0049-task-scoped-verification.md",
  "documentation/decisions/0050-triggered-code-design-assessment.md",
  "documentation/decisions/0054-git-visible-work-artifacts.md",
  "documentation/decisions/0055-planning-gate-rework-and-independent-planning-review.md",
  "documentation/decisions/0057-complete-task-verification-rounds.md",
  "documentation/decisions/0058-human-plan-edits-rechecked-at-the-plan-gate.md",
  "documentation/decisions/0059-claude-default-reviewer-and-reviewer-isolation.md",
  "documentation/decisions/0060-local-model-override.md",
  "documentation/decisions/0061-initiative-skill-and-documents.md",
  "documentation/decisions/0062-claude-memory-notes-in-the-manual-hook-gate.md",
  "documentation/decisions/0063-stable-headless-vendor-invocations.md",
  "documentation/decisions/0064-runner-recorded-plan-remainder-digest.md",
  "documentation/decisions/0066-date-prefixed-work-and-initiative-slugs.md",
  "documentation/decisions/0069-standalone-plugin-control-model.md",
  "documentation/decisions/0070-orchestrator-owned-instruction-copy.md",
  "packages/orchestrator/scripts/check-dist.mjs",
  "packages/orchestrator/scripts/release-version.mjs",
  "packages/orchestrator/scripts/smoke-committed.mjs",
  "packages/orchestrator/scripts/version-recover.mjs",
  "packages/orchestrator/scripts/version-set.mjs"
] as const;

function replacePolicyFragment(
  contents: string,
  fragment: string,
  replacement: string
): string {
  const pattern = new RegExp(
    fragment
      .split(/\s+/)
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("\\s+")
  );
  assert.match(contents, pattern, `fixture fragment missing: ${fragment}`);
  return contents.replace(pattern, replacement);
}

async function setLegacyLayoutRelease(
  root: string,
  version: string
): Promise<void> {
  const target = path.join(
    root,
    "plugins/banzai/skills/project-manifest/references/layout-migration.md"
  );
  const contents = await readFile(target, "utf8");
  await writeFile(
    target,
    contents.replace(
      /^- Last legacy-compatible release: `[^`]+`$/m,
      `- Last legacy-compatible release: \`${version}\``
    ),
    "utf8"
  );
}

async function releaseFixture(): Promise<string> {
  const parent = await mkdtemp(path.join(tmpdir(), "banzai-release-fixture-"));
  const root = path.join(parent, "repository");
  for (const relativePath of FIXTURE_PATHS) {
    await cp(
      path.join(REPOSITORY_ROOT, relativePath),
      path.join(root, relativePath),
      { recursive: true }
    );
  }
  // cp preserves checkout modes; the fixture needs safe version metadata.
  for (const relativePath of new Set(
    VERSION_SURFACES.map((surface) => surface.relativePath)
  )) {
    await chmod(path.join(root, relativePath), 0o644);
  }
  // Build a valid current candidate independently of the writer under test.
  for (const surface of VERSION_SURFACES)
    await setSurfaceVersion(root, surface, "1.19.0");
  await setLegacyLayoutRelease(root, "1.18.0");
  // A source checkout has no dist. Build for the fixture's pinned version.
  await symlink(
    path.join(REPOSITORY_ROOT, "node_modules"),
    path.join(root, "node_modules"),
    "dir"
  );
  const packageRoot = path.join(root, "packages/orchestrator");
  const build = spawnSync(
    process.execPath,
    [path.join(packageRoot, "scripts/build.mjs")],
    { cwd: packageRoot, encoding: "utf8" }
  );
  assert.equal(build.status, 0, build.stderr);
  return root;
}

function validate(root: string): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [VALIDATOR, "--root", root], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

async function mutateJson(
  root: string,
  relativePath: string,
  mutate: (value: Record<string, unknown>) => void
): Promise<void> {
  const target = path.join(root, relativePath);
  const value = JSON.parse(await readFile(target, "utf8")) as Record<
    string,
    unknown
  >;
  mutate(value);
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function versionField(
  value: Record<string, unknown>,
  surface: VersionSurface
): { parent: Record<string, unknown>; key: string } {
  const keys = [...surface.keys];
  const key = keys.pop();
  assert.ok(key !== undefined);
  let current: unknown = value;
  for (const segment of keys) {
    assert.ok(typeof current === "object" && current !== null);
    current = (current as Record<string, unknown>)[segment];
  }
  assert.ok(typeof current === "object" && current !== null);
  return { parent: current as Record<string, unknown>, key };
}

async function setSurfaceVersion(
  root: string,
  surface: VersionSurface,
  version: unknown
): Promise<void> {
  await mutateJson(root, surface.relativePath, (value) => {
    const field = versionField(value, surface);
    field.parent[field.key] = version;
  });
}

async function removeSurfaceVersion(
  root: string,
  surface: VersionSurface
): Promise<void> {
  await mutateJson(root, surface.relativePath, (value) => {
    const field = versionField(value, surface);
    assert.equal(Reflect.deleteProperty(field.parent, field.key), true);
  });
}

async function readSurfaceVersion(
  root: string,
  surface: VersionSurface
): Promise<unknown> {
  const value = JSON.parse(
    await readFile(path.join(root, surface.relativePath), "utf8")
  ) as Record<string, unknown>;
  const field = versionField(value, surface);
  return field.parent[field.key];
}

async function snapshotVersionSurfaces(
  root: string
): Promise<Map<string, { contents: Buffer; mode: number }>> {
  const snapshot = new Map<string, { contents: Buffer; mode: number }>();
  for (const surface of VERSION_SURFACES) {
    const target = path.join(root, surface.relativePath);
    snapshot.set(surface.relativePath, {
      contents: await readFile(target),
      mode: (await lstat(target)).mode & 0o7777
    });
  }
  return snapshot;
}

async function assertVersionSnapshot(
  root: string,
  expected: Map<string, { contents: Buffer; mode: number }>
): Promise<void> {
  for (const [relativePath, snapshot] of expected) {
    const target = path.join(root, relativePath);
    assert.deepEqual(await readFile(target), snapshot.contents, relativePath);
    assert.equal(
      (await lstat(target)).mode & 0o7777,
      snapshot.mode,
      relativePath
    );
  }
}

async function withFixture(
  exercise: (root: string) => Promise<void>
): Promise<void> {
  const root = await releaseFixture();
  try {
    await exercise(root);
  } finally {
    await rm(path.dirname(root), { recursive: true, force: true });
  }
}

const CLOSED_BASELINE = "packages/orchestrator/phase-guidance-current.json";
const CLOSED_BASELINE_PIN =
  "packages/orchestrator/phase-guidance-current.sha256";
const CLOSED_BASELINE_FILES = [
  "packages/orchestrator/phase-guidance-baseline.json",
  CLOSED_BASELINE,
  CLOSED_BASELINE_PIN
] as const;
const SUCCESSOR_BASELINE = "packages/orchestrator/instruction-baseline.json";
const SUCCESSOR_PIN = "packages/orchestrator/instruction-baseline.sha256";
const INSTRUCTION_MODULE = "packages/orchestrator/src/phase-resources.ts";
const HOOK_CONFIGURATION = "plugins/banzai/hooks/hooks.json";
const HOOK_SCRIPT = "plugins/banzai/hooks/spec-gate.cjs";
const CLAUDE_MANIFEST = "plugins/banzai/.claude-plugin/plugin.json";
const CODEX_MANIFEST = "plugins/banzai/.codex-plugin/plugin.json";
const CONTROL_MODEL_DECISION =
  "documentation/decisions/0069-standalone-plugin-control-model.md";
const INSTRUCTION_COPY_DECISION =
  "documentation/decisions/0070-orchestrator-owned-instruction-copy.md";

interface SuccessorBaseline {
  schema: string;
  schemaVersion: number;
  predecessorBaselineSha256: string;
  origin: {
    authorities: InstructionAuthority[];
    expectations: Record<string, string>;
  };
  expectations: Record<string, string>;
  transitions: InstructionTransition[];
}

interface ClosedBaseline {
  expectations: Record<string, string>;
  transitions: InstructionTransition[];
}

async function instructionAuthority(
  root: string,
  relativePath: string,
  scope: string
): Promise<InstructionAuthority> {
  return {
    path: relativePath,
    sha256: resourceDigest(await readFile(path.join(root, relativePath))),
    scope
  };
}

async function instructionAuthorization(
  root: string,
  authorityPath: string,
  scope: string
) {
  const proposal = await describeInstructionTransition(root);
  return {
    schema: "banzai-instruction-authorization/v1",
    schemaVersion: 1,
    predecessorSha256: proposal.predecessorSha256,
    authorities: [await instructionAuthority(root, authorityPath, scope)],
    scope: proposal.changes.map((change) => change.key)
  };
}

async function readBaseline<T>(root: string, relativePath: string): Promise<T> {
  return JSON.parse(await readFile(path.join(root, relativePath), "utf8")) as T;
}

async function writePinnedBaseline(
  root: string,
  relativePath: string,
  pinPath: string,
  baseline: unknown
): Promise<void> {
  const bytes = JSON.stringify(baseline, null, 2) + "\n";
  await writeFile(path.join(root, relativePath), bytes);
  await writeFile(path.join(root, pinPath), resourceDigest(bytes) + "\n");
}

// A hand-written chain step, valid in every respect the caller leaves alone.
function instructionTransition(
  expectations: Record<string, string>,
  authorities: InstructionAuthority[],
  changes: Record<string, string>
): InstructionTransition {
  return {
    predecessorSha256: identity(expectations),
    successorSha256: identity(
      sortedExpectations({ ...expectations, ...changes })
    ),
    authorities,
    changes: Object.entries(sortedExpectations(changes)).map(
      ([key, after]) => ({ key, before: expectations[key] ?? null, after })
    )
  };
}

interface ModuleResource {
  sha256: string;
  text?: string;
}
type ModuleDefinitions = Record<string, Record<string, string[]>>;

async function rewriteInstructionModule(
  root: string,
  mutate: (
    definitions: ModuleDefinitions,
    resources: Record<string, ModuleResource>
  ) => void
): Promise<void> {
  const target = path.join(root, INSTRUCTION_MODULE);
  const match =
    /^([\s\S]*?export const PHASE_RESOURCE_DEFINITIONS = )([\s\S]*?)( as const;\n\n\/\/ prettier-ignore\nexport const EMBEDDED_PHASE_RESOURCES = )([\s\S]*)( as const;\n)$/u.exec(
      await readFile(target, "utf8")
    );
  assert.ok(match);
  const [, head, definitionsJson, middle, resourcesJson, tail] = match;
  assert.ok(head && definitionsJson && middle && resourcesJson && tail);
  const definitions = JSON.parse(definitionsJson) as ModuleDefinitions;
  const resources = JSON.parse(resourcesJson) as Record<string, ModuleResource>;
  mutate(definitions, resources);
  await writeFile(
    target,
    head +
      JSON.stringify(definitions, null, 2) +
      middle +
      JSON.stringify(resources, null, 2) +
      tail
  );
}

function runBaselineTool(
  root: string,
  ...args: string[]
): SpawnSyncReturns<string> {
  return spawnSync(
    process.execPath,
    [
      path.join(root, "packages/orchestrator/scripts/instruction-baseline.mjs"),
      ...args
    ],
    { cwd: root, encoding: "utf8" }
  );
}

const FIRST_GENERATION_REFUSAL =
  /^Error: Successor instruction baseline first generation differs from its pinned identity/;
const FIRST_GENERATION_TOOL_REFUSAL =
  /^INSTRUCTION_RESOURCE_DRIFT Successor instruction baseline first generation differs from its pinned identity/;

// Appends a sentence to a frozen text entry and digests it again, so the
// module stays self-consistent. Returns the pinned key and its new digest.
async function changeFrozenTextEntry(
  root: string,
  id: string
): Promise<[string, string]> {
  let digest = "";
  await rewriteInstructionModule(root, (_definitions, resources) => {
    const entry = requiredFixture(resources[id]);
    entry.text = `${entry.text ?? ""}\nFixture sentence.\n`;
    digest = resourceDigest(entry.text);
    entry.sha256 = digest;
  });
  return [`${INSTRUCTION_MODULE}#${id}`, digest];
}

async function writeOriginFile(
  root: string,
  authorities: InstructionAuthority[]
): Promise<string> {
  const originPath = path.join(path.dirname(root), "origin.json");
  await writeFile(
    originPath,
    JSON.stringify({
      schema: "banzai-instruction-origin/v1",
      schemaVersion: 1,
      authorities
    })
  );
  return originPath;
}

// The file an unanchored initializing form would write: the recorded
// expectations with the given changes as a new origin, and an empty chain.
async function writeFirstGeneration(
  root: string,
  recorded: SuccessorBaseline,
  changes: Record<string, string>
): Promise<void> {
  const expectations = sortedExpectations({
    ...recorded.expectations,
    ...changes
  });
  await writePinnedBaseline(root, SUCCESSOR_BASELINE, SUCCESSOR_PIN, {
    ...recorded,
    origin: { authorities: recorded.origin.authorities, expectations },
    expectations,
    transitions: []
  });
}

function rebuildFixture(root: string): void {
  const packageRoot = path.join(root, "packages/orchestrator");
  const build = spawnSync(
    process.execPath,
    [path.join(packageRoot, "scripts/build.mjs")],
    { cwd: packageRoot, encoding: "utf8" }
  );
  assert.equal(build.status, 0, build.stderr);
}

test("distribution-only builds start without dist and preserve tracked generated resources", async () => {
  await withFixture(async (root) => {
    const packageRoot = path.join(root, "packages/orchestrator");
    const generated = [
      "packages/orchestrator/src/init-resources.ts",
      "packages/orchestrator/src/phase-resources.ts",
      "plugins/banzai/lib/artifact-readers.mjs"
    ];
    const before = await Promise.all(
      generated.map((name) => readFile(path.join(root, name)))
    );
    await rm(path.join(packageRoot, "dist"), { recursive: true });
    const build = () =>
      spawnSync(
        process.execPath,
        [path.join(packageRoot, "scripts/build.mjs"), "--distribution-only"],
        { cwd: packageRoot, encoding: "utf8" }
      );
    const result = build();
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(await readdir(path.join(packageRoot, "dist")), [
      "banzai.mjs",
      "banzai.mjs.map"
    ]);
    assert.equal(
      (await lstat(path.join(packageRoot, "dist/banzai.mjs"))).mode & 0o777,
      0o755
    );
    assert.equal(validate(root).status, 0);
    await appendFile(
      path.join(root, "documentation/verification-examples.md"),
      "\nChanged guide.\n"
    );
    const staleBuild = build();
    assert.equal(staleBuild.status, 0, staleBuild.stderr);
    assert.deepEqual(
      await Promise.all(
        generated.map((name) => readFile(path.join(root, name)))
      ),
      before
    );
    const stale = validate(root);
    assert.equal(stale.status, 1);
    assert.match(stale.stderr, /^STALE_DISTRIBUTION /);
    await appendFile(
      path.join(packageRoot, "src/cli.ts"),
      "\nconst = invalid syntax;\n"
    );
    assert.notEqual(build().status, 0);
    await assert.rejects(access(path.join(packageRoot, "dist/banzai.mjs")));
  });
});

test("initialization guide parity rejects stale or missing resources without repair", async () => {
  await withFixture(async (root) => {
    const generatedPath = path.join(
      root,
      "packages/orchestrator/src/init-resources.ts"
    );
    const original = await readFile(generatedPath);
    const canonicalPath = path.join(
      root,
      "documentation/verification-examples.md"
    );
    const canonical = await readFile(canonicalPath);
    await writeFile(
      canonicalPath,
      Buffer.concat([canonical, Buffer.from("\nUpdated example.\n")])
    );
    const check = () =>
      spawnSync(
        process.execPath,
        [path.join(root, "packages/orchestrator/scripts/check-dist.mjs")],
        { encoding: "utf8" }
      );
    const stale = check();
    assert.equal(stale.status, 1);
    assert.match(stale.stderr, /Generated initialization resources are stale/);
    assert.deepEqual(await readFile(generatedPath), original);
    await writeFile(canonicalPath, canonical);
    await unlink(generatedPath);
    const missing = check();
    assert.equal(missing.status, 1);
    assert.match(
      missing.stderr,
      /Generated initialization resources are stale/
    );
    await assert.rejects(access(generatedPath));
  });
});

test("frozen phase resources follow the hook files only and reject a stale digest or a missing module without repair", async () => {
  await withFixture(async (root) => {
    await checkPhaseResourceBytes(root);
    const generatedPath = path.join(root, INSTRUCTION_MODULE);
    const original = await readFile(generatedPath, "utf8");
    // Plugin text is not an input, whether changed, added or missing. The
    // plugin may hold none of these files, so the fixture assumes none.
    const plugin = path.join(root, "plugins/banzai");
    for (const name of ["phases", "guidance", "policies"])
      await mkdir(path.join(plugin, name), { recursive: true });
    await appendFile(path.join(plugin, "phases/review.md"), "\n");
    await writeFile(
      path.join(plugin, "guidance/extra.md"),
      "Added guidance.\n"
    );
    await rm(path.join(plugin, "policies/test-assurance.md"), { force: true });
    assert.equal(await phaseResourceBytes(root), original);
    await checkPhaseResourceBytes(root);

    const hookPath = path.join(root, HOOK_SCRIPT);
    const hook = await readFile(hookPath);
    await appendFile(hookPath, "// fixture\n");
    const rebuilt = await phaseResourceBytes(root);
    assert.notEqual(rebuilt, original);
    assert.equal(
      rebuilt.replace(
        resourceDigest(await readFile(hookPath)),
        resourceDigest(hook)
      ),
      original
    );
    await assert.rejects(
      checkPhaseResourceBytes(root),
      /src\/phase-resources.ts is missing or stale.*npm run build/
    );
    assert.equal(await readFile(generatedPath, "utf8"), original);
    await writeFile(hookPath, hook);

    // A text entry is the successor baseline's to guard, not the build's.
    await writeFile(
      generatedPath,
      original.replace("# Strict Planning Phase", "# Stale Planning Phase")
    );
    await checkPhaseResourceBytes(root);
    await assert.rejects(
      validateInstructionBaseline(root),
      /Frozen instruction entry differs from its digest: phases\/planning\.md/
    );
    await unlink(generatedPath);
    await assert.rejects(
      checkPhaseResourceBytes(root),
      /src\/phase-resources.ts is missing or stale/
    );
    await assert.rejects(access(generatedPath));
  });
});

test("hook digest generation rejects absent invalid and escaping hook input and an unusable module with bounded diagnostics", async () => {
  await withFixture(async (root) => {
    const target = path.join(root, HOOK_SCRIPT);
    const original = await readFile(target);
    for (const invalid of [
      Buffer.alloc(0),
      Buffer.from(" \n"),
      Buffer.from([0xff])
    ]) {
      await writeFile(target, invalid);
      await assert.rejects(
        phaseResourceBytes(root),
        /Instruction resource hooks\/spec-gate.cjs is missing, unreadable, unsafe or invalid UTF-8/
      );
    }
    await unlink(target);
    await assert.rejects(
      phaseResourceBytes(root),
      /Instruction resource hooks\/spec-gate.cjs/
    );
    const outside = path.join(path.dirname(root), "private-canary.md");
    await writeFile(outside, "PRIVATE_RESOURCE_CONTENT_CANARY");
    await symlink(outside, target);
    const bounded = (pattern: RegExp) => (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.doesNotMatch(
        error.message,
        /PRIVATE_RESOURCE_CONTENT_CANARY|private-canary|banzai-release-fixture/
      );
      return pattern.test(error.message);
    };
    await assert.rejects(
      phaseResourceBytes(root),
      bounded(/hooks\/spec-gate.cjs/)
    );
    await unlink(target);
    await writeFile(target, original);

    const modulePath = path.join(root, INSTRUCTION_MODULE);
    const source = await readFile(modulePath, "utf8");
    const slot =
      /\n {2}"hooks\/hooks\.json": \{\n {4}"sha256": "[a-f0-9]{64}"\n {2}\},/u;
    const entry = requiredFixture(slot.exec(source)?.[0]);
    const build = () =>
      spawnSync(
        process.execPath,
        [path.join(root, "packages/orchestrator/scripts/build.mjs")],
        { cwd: path.join(root, "packages/orchestrator"), encoding: "utf8" }
      );
    // Absent, repeated and malformed digest values are each not exactly one.
    for (const unusable of [
      source.replace(entry, ""),
      source.replace(entry, entry + entry),
      source.replace(entry, entry.replace(/[a-f0-9]{64}/u, "stale"))
    ]) {
      await writeFile(modulePath, unusable);
      await assert.rejects(
        phaseResourceBytes(root),
        /must hold exactly one digest for hooks\/hooks\.json/
      );
      const failed = build();
      assert.notEqual(failed.status, 0);
      assert.match(failed.stderr, /exactly one digest for hooks\/hooks\.json/);
      assert.equal(await readFile(modulePath, "utf8"), unusable);
    }
    await writeFile(modulePath, source);
    // The module's phase table is the authority the script constant repeats.
    await rewriteInstructionModule(root, (definitions) => {
      requiredFixture(definitions.review?.policies).reverse();
    });
    await assert.rejects(
      phaseResourceBytes(root),
      /Phase table of scripts\/phase-resources-build\.mjs differs from src\/phase-resources\.ts/
    );
    assert.notEqual(build().status, 0);
    await unlink(modulePath);
    await symlink(outside, modulePath);
    await assert.rejects(
      phaseResourceBytes(root),
      bounded(/Frozen src\/phase-resources\.ts is missing, unreadable, unsafe/)
    );
    await unlink(modulePath);
    await assert.rejects(
      phaseResourceBytes(root),
      /Frozen src\/phase-resources\.ts is missing/
    );
    assert.notEqual(build().status, 0);
    await assert.rejects(access(modulePath));
  });
});

test("a changed plugin policy changes no orchestrator file while a changed hook script is stale until rebuilt", async () => {
  await withFixture(async (root) => {
    const packageRoot = path.join(root, "packages/orchestrator");
    const run = (script: string) =>
      spawnSync(process.execPath, [path.join(packageRoot, "scripts", script)], {
        cwd: packageRoot,
        encoding: "utf8"
      });
    const snapshot = async () => {
      const files = new Map<string, string>();
      for (const directory of ["packages/orchestrator", "plugins/banzai/lib"]) {
        const entries = await readdir(path.join(root, directory), {
          recursive: true,
          withFileTypes: true
        });
        for (const entry of entries) {
          if (!entry.isFile()) continue;
          const file = path.join(entry.parentPath, entry.name);
          files.set(
            path.relative(root, file),
            resourceDigest(await readFile(file))
          );
        }
      }
      return files;
    };
    const changedSince = async (before: Map<string, string>) => {
      const after = await snapshot();
      return [...new Set([...before.keys(), ...after.keys()])]
        .filter((name) => before.get(name) !== after.get(name))
        .sort();
    };
    const before = await snapshot();
    const modulePath = path.join(root, INSTRUCTION_MODULE);
    const moduleBefore = await readFile(modulePath, "utf8");

    await appendFile(
      path.join(root, "plugins/banzai/policies/test-assurance.md"),
      "\nFixture sentence the frozen module never saw.\n"
    );
    await appendFile(
      path.join(root, "plugins/banzai/guidance/review.md"),
      "\nFixture sentence the frozen module never saw.\n"
    );
    const built = run("build.mjs");
    assert.equal(built.status, 0, built.stderr);
    assert.deepEqual(await changedSince(before), []);
    const checked = run("check-dist.mjs");
    assert.equal(checked.status, 0, checked.stderr);
    await validateInstructionBaseline(root);

    const hookPath = path.join(root, HOOK_SCRIPT);
    const hookBefore = resourceDigest(await readFile(hookPath));
    await appendFile(hookPath, "// fixture\n");
    const stale = run("check-dist.mjs");
    assert.equal(stale.status, 1);
    assert.match(
      stale.stderr,
      /Generated src\/phase-resources\.ts is missing or stale\. Run `npm run build`\./
    );
    assert.deepEqual(await changedSince(before), []);
    const rebuilt = run("build.mjs");
    assert.equal(rebuilt.status, 0, rebuilt.stderr);
    assert.deepEqual(await changedSince(before), [
      "packages/orchestrator/dist/banzai.mjs",
      "packages/orchestrator/dist/banzai.mjs.map",
      INSTRUCTION_MODULE
    ]);
    // The rebuild wrote the hook digest and no other byte of the module.
    assert.equal(
      (await readFile(modulePath, "utf8")).replace(
        resourceDigest(await readFile(hookPath)),
        hookBefore
      ),
      moduleBefore
    );
    const fresh = run("check-dist.mjs");
    assert.equal(fresh.status, 0, fresh.stderr);
  });
});

test("closed baseline replay reads no plugin file", async () => {
  await withFixture(async (root) => {
    await validateClosedGuidanceBaseline(root);
    await rm(path.join(root, "plugins/banzai"), { recursive: true });
    await validateClosedGuidanceBaseline(root);
  });
});

// ADR-0070 sections 2 and 6: plugin text is ordinary source. Every edit below
// is chosen by position, never by wording, so this test names no plugin
// sentence itself and stays green when that text is rewritten.
test("release validation and the build check pass after edits to plugin text that no check names and a removed phase document", async () => {
  await withFixture(async (root) => {
    const plugin = path.join(root, "plugins/banzai");
    const packageRoot = path.join(root, "packages/orchestrator");
    const moduleBefore = await readFile(
      path.join(root, INSTRUCTION_MODULE),
      "utf8"
    );
    const edit = async (
      relativePath: string,
      change: (text: string) => string
    ) => {
      const target = path.join(plugin, relativePath);
      const before = await readFile(target, "utf8");
      const after = change(before);
      assert.notEqual(after, before, relativePath);
      await writeFile(target, after, "utf8");
    };
    const reworded = (text: string) =>
      text.replace(/\s*$/u, " Fixture clause that no check names.\n");
    const withoutRunnerConsumers = (text: string) =>
      text
        .split("\n")
        .filter((line) => !line.startsWith("- Runner consumers:"))
        .join("\n");

    await edit("skills/feature-status/SKILL.md", (text) =>
      reworded(
        text.replace(
          /^description: .+$/mu,
          "description: Fixture description that no check names."
        )
      )
    );
    await edit("guidance/manifest.md", reworded);
    // No policy needs a `- Runner consumers:` line, and one that matches no
    // phase table is as acceptable as none.
    for (const name of await readdir(path.join(plugin, "policies"))) {
      const target = path.join(plugin, "policies", name);
      await writeFile(
        target,
        withoutRunnerConsumers(await readFile(target, "utf8")),
        "utf8"
      );
    }
    await edit("policies/artifact-storage.md", (text) =>
      reworded(`${text}\n- Runner consumers: selection.\n`)
    );

    // Phase documents are read by nothing, so none is required and neither
    // directory has an expected listing.
    const phases = path.join(plugin, "phases");
    const [phaseDocument] = await readdir(phases).catch((): string[] => []);
    if (phaseDocument !== undefined)
      await unlink(path.join(phases, phaseDocument));
    await mkdir(phases, { recursive: true });
    await writeFile(
      path.join(phases, "selection.md"),
      "Fixture phase the runner never embedded.\n"
    );
    await writeFile(
      path.join(plugin, "guidance/standalone-only.md"),
      "# Standalone Only\n\nFixture guidance the runner never embedded.\n"
    );
    const policy = await readBaseline<{ plugin: { requiredPaths: string[] } }>(
      root,
      "release-policy.json"
    );
    assert.deepEqual(
      policy.plugin.requiredPaths.filter((item) =>
        item.startsWith("plugins/banzai/phases/")
      ),
      []
    );

    const result = validate(root);
    assert.equal(result.status, 0, result.stderr);
    const buildCheck = spawnSync(
      process.execPath,
      [path.join(packageRoot, "scripts/check-dist.mjs")],
      { cwd: packageRoot, encoding: "utf8" }
    );
    assert.equal(buildCheck.status, 0, buildCheck.stderr);
    // No orchestrator source became stale.
    assert.equal(await phaseResourceBytes(root), moduleBefore);
    await validateInstructionBaseline(root);
  });
});

test("a standalone text check fails without its fragment and reads linked guidance by its plugin path", async () => {
  await withFixture(async (root) => {
    const guidanceRoot = path.join(root, "plugins/banzai/guidance");
    const skill = "plugins/banzai/skills/test-writing/SKILL.md";
    const skillPath = path.join(root, skill);
    // A fragment the Test Assurance check requires of this skill, removed
    // from the skill and from every guidance file it could link.
    const fragment = "no-new-test";
    let removed = 0;
    for (const target of [
      skillPath,
      ...(await readdir(guidanceRoot)).map((name) =>
        path.join(guidanceRoot, name)
      )
    ]) {
      const contents = await readFile(target, "utf8");
      removed += contents.split(fragment).length - 1;
      await writeFile(target, contents.replaceAll(fragment, "REMOVED"), "utf8");
    }
    assert.ok(removed > 0);
    const missing = validate(root);
    assert.equal(missing.status, 1);
    assert.equal(
      missing.stderr,
      `TEST_ASSURANCE_POLICY_DRIFT ${skill}: missing required policy fragment: ${fragment}\n`
    );

    // The link resolves to its path in the plugin; the frozen phase table
    // holds no entry for this file.
    assert.doesNotMatch(
      await readFile(path.join(root, INSTRUCTION_MODULE), "utf8"),
      /standalone-only/u
    );
    await appendFile(
      skillPath,
      "\nRead and apply [Rules](../../guidance/standalone-only.md#rules)\n"
    );
    const dangling = validate(root);
    assert.equal(dangling.status, 1);
    assert.equal(
      dangling.stderr,
      "MISSING_RELEASE_FILE plugins/banzai/guidance/standalone-only.md: required file is missing or unreadable\n"
    );
    await writeFile(
      path.join(guidanceRoot, "standalone-only.md"),
      `# Standalone Only\n\n## Rules\n\nRecord a ${fragment} rationale.\n`
    );
    const linked = validate(root);
    assert.equal(linked.status, 0, linked.stderr);
  });
});

async function leaveCleanupGuardWithJournal(root: string): Promise<void> {
  const canonicalRoot = await realpath(root);
  const helper = path.join(
    path.dirname(root),
    "kill-before-journal-removal.mjs"
  );
  const source = `
import { createNodeVersionFileSystem, setProjectVersion } from ${JSON.stringify(pathToFileURL(RELEASE_VERSION_MODULE).href)};
const root = ${JSON.stringify(canonicalRoot)};
const transaction = ${JSON.stringify(path.join(canonicalRoot, RECOVERY_DIRECTORY))};
const base = createNodeVersionFileSystem();
const fileSystem = {
  ...base,
  async remove(target, options) {
    if (target === transaction && options?.recursive === true) {
      process.kill(process.pid, "SIGKILL");
    }
    await base.remove(target, options);
  }
};
await setProjectVersion({ root, targetVersion: "1.20.0", ownerPid: process.pid, fileSystem });
`;
  await writeFile(helper, source, "utf8");
  const killed = spawnSync(process.execPath, [helper], {
    cwd: root,
    encoding: "utf8",
    timeout: 10_000
  });
  assert.equal(killed.status, null, `${killed.stdout}\n${killed.stderr}`);
  assert.equal(killed.signal, "SIGKILL");
  await access(path.join(root, RECOVERY_DIRECTORY));
  await access(path.join(root, RECOVERY_GUARD));
}

test("release validation accepts the all-equal nine-field release train", async () => {
  await withFixture(async (root) => {
    assert.deepEqual(
      await Promise.all(
        VERSION_SURFACES.map((surface) => readSurfaceVersion(root, surface))
      ),
      Array<string>(9).fill("1.19.0")
    );
    const result = validate(root);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "release validation passed\n");
    assert.equal(result.stderr, "");
  });
});

for (const [relativePath, fragment] of [
  ["plugins/banzai/policies/test-assurance.md", "## Test Assurance"],
  [
    "plugins/banzai/guidance/assurance.md",
    "**Risk and Contract Assurance Map**"
  ],
  ["plugins/banzai/guidance/review.md", "the plausible regression mechanism;"]
] as const) {
  test(`release validation protects test-assurance policy in ${relativePath}`, async () => {
    await withFixture(async (root) => {
      const target = path.join(root, relativePath);
      const contents = await readFile(target, "utf8");
      await writeFile(
        target,
        replacePolicyFragment(contents, fragment, "REMOVED"),
        "utf8"
      );
      const result = validate(root);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /^TEST_ASSURANCE_POLICY_DRIFT /);
    });
  });
}

for (const [relativePath, fragment] of [
  ["plugins/banzai/policies/security-assurance.md", "## Security Assurance"],
  [
    "plugins/banzai/policies/security-assurance.md",
    "Cross-principal reachability"
  ],
  [
    "plugins/banzai/guidance/requirements.md",
    "Security Assurance policy (`security-assurance.md`) supplied by the active execution context"
  ],
  [
    "plugins/banzai/guidance/planning.md",
    "Security Assurance policy (`security-assurance.md`) supplied by the active execution context"
  ],
  [
    "plugins/banzai/skills/quick-fix/SKILL.md",
    "Security Assurance policy in the installed `policies/security-assurance.md`"
  ],
  ["plugins/banzai/guidance/review.md", "mechanism reachable in this codebase"],
  ["plugins/banzai/skills/quick-fix/SKILL.md", "the security exposure result"]
] as const) {
  test(`release validation protects security-assurance policy in ${relativePath} (${fragment})`, async () => {
    await withFixture(async (root) => {
      const target = path.join(root, relativePath);
      const contents = await readFile(target, "utf8");
      await writeFile(
        target,
        replacePolicyFragment(contents, fragment, "REMOVED"),
        "utf8"
      );
      const result = validate(root);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /^SECURITY_ASSURANCE_POLICY_DRIFT /);
    });
  });
}

test("release validation requires a version bump after hook runtime changes", async () => {
  await withFixture(async (root) => {
    const git = (...args: string[]) => {
      const result = spawnSync(
        "git",
        [
          "-c",
          "user.name=Banzai Test",
          "-c",
          "user.email=test@example.invalid",
          "-c",
          "commit.gpgsign=false",
          "-c",
          "core.hooksPath=/dev/null",
          ...args
        ],
        { cwd: root, encoding: "utf8" }
      );
      assert.equal(result.status, 0, result.stderr);
    };
    const commit = (message: string) => {
      git("add", "-A");
      git("commit", "-q", "-m", message);
    };
    const expectPass = () => {
      const result = validate(root);
      assert.equal(result.status, 0, result.stderr);
    };
    const expectMissingBump = () => {
      const result = validate(root);
      assert.equal(result.status, 1);
      assert.match(
        result.stderr,
        /^HOOK_CHANGED_WITHOUT_VERSION_BUMP plugins\/banzai\/hooks\/hooks\.json, plugins\/banzai\/hooks\/spec-gate\.cjs, plugins\/banzai\/lib: changed since release-train version 1\.19\.0 was set in [0-9a-f]{12};/
      );
    };
    const [rootVersion] = VERSION_SURFACES;
    // Not bundled into dist or embedded as a phase resource, so editing it
    // leaves every other release check green.
    const helper = path.join(
      root,
      "plugins/banzai/lib/verification-helper.mjs"
    );
    git("init", "-q");
    await setSurfaceVersion(root, rootVersion, "1.18.9");
    commit("release 1.18.9");
    await setSurfaceVersion(root, rootVersion, "1.19.0");
    await appendFile(helper, "// pending with the bump\n");
    expectPass();
    commit("release 1.19.0");
    expectPass();
    await appendFile(path.join(root, "plugins/banzai/hooks/README.md"), "\n");
    expectPass();
    const hook = path.join(root, "plugins/banzai/hooks/spec-gate.cjs");
    const hookBytes = await readFile(hook);
    await appendFile(hook, "// uncommitted drift\n");
    expectMissingBump();
    await writeFile(hook, hookBytes);
    await appendFile(helper, "// committed drift\n");
    commit("lib change without a bump");
    expectMissingBump();
  });
});

test("release validation rejects a duplicated security assurance policy heading", async () => {
  await withFixture(async (root) => {
    const target = path.join(
      root,
      "plugins/banzai/policies/security-assurance.md"
    );
    const contents = await readFile(target, "utf8");
    await writeFile(
      target,
      `${contents}\n## Security Assurance\n\nDuplicate.\n`,
      "utf8"
    );
    const result = validate(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /^SECURITY_ASSURANCE_POLICY_DRIFT /);
  });
});

test("release validation accepts a security assurance reference that wraps across lines", async () => {
  await withFixture(async (root) => {
    const target = path.join(root, "plugins/banzai/guidance/requirements.md");
    const contents = await readFile(target, "utf8");
    await writeFile(
      target,
      replacePolicyFragment(
        contents,
        "Security Assurance policy (`security-assurance.md`) supplied by the active execution context",
        "Security Assurance\n  policy (`security-assurance.md`) supplied by the active execution context"
      ),
      "utf8"
    );
    await validateClosedGuidanceBaseline(root);
    // Plugin text is no build input: the edit leaves the distribution fresh,
    // and a rebuild afterwards is not successor drift.
    const edited = validate(root);
    assert.equal(edited.status, 0, edited.stderr);
    const build = spawnSync(
      process.execPath,
      [path.join(root, "packages/orchestrator/scripts/build.mjs")],
      { cwd: path.join(root, "packages/orchestrator"), encoding: "utf8" }
    );
    assert.equal(build.status, 0, build.stderr);
    const result = validate(root);
    assert.equal(result.status, 0, result.stderr);
  });
});

for (const [relativePath, fragment] of [
  ["plugins/banzai/policies/engineering-quality.md", "## Engineering Quality"],
  [
    "plugins/banzai/policies/engineering-quality.md",
    "unnecessarily couple stable logic to volatile"
  ],
  [
    "plugins/banzai/policies/engineering-quality.md",
    "Engineering Quality detects missing assurance ownership"
  ],
  [
    "plugins/banzai/policies/engineering-quality.md",
    "Any later blocker-eligibility proposal must require high confidence"
  ],
  [
    "plugins/banzai/skills/feature-description/SKILL.md",
    "canonical Engineering Quality policy in the installed `policies/engineering-quality.md`"
  ],
  ["plugins/banzai/guidance/review.md", "only as one `EQ-SHADOW:`"],
  [
    "packages/orchestrator/src/prompts.ts",
    "Resolution review is closure-oriented, not discovery-oriented"
  ]
] as const) {
  test(`release validation protects engineering-quality policy in ${relativePath} (${fragment})`, async () => {
    await withFixture(async (root) => {
      const target = path.join(root, relativePath);
      const contents = await readFile(target, "utf8");
      await writeFile(
        target,
        replacePolicyFragment(contents, fragment, "REMOVED"),
        "utf8"
      );
      const result = validate(root);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /^ENGINEERING_QUALITY_POLICY_DRIFT /);
    });
  });
}

test("release validation rejects a duplicated engineering quality policy heading", async () => {
  await withFixture(async (root) => {
    const target = path.join(
      root,
      "plugins/banzai/policies/engineering-quality.md"
    );
    const contents = await readFile(target, "utf8");
    await writeFile(
      target,
      `${contents}\n## Engineering Quality\n\nDuplicate.\n`,
      "utf8"
    );
    const result = validate(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /^ENGINEERING_QUALITY_POLICY_DRIFT /);
  });
});

test("release validation rejects an Engineering Quality rule moved outside the canonical section", async () => {
  await withFixture(async (root) => {
    const target = path.join(
      root,
      "plugins/banzai/policies/engineering-quality.md"
    );
    const contents = await readFile(target, "utf8");
    const ruleStart = contents.indexOf(
      "### EQ-10 — Incremental legacy evolution"
    );
    const policyEnd = contents.indexOf(
      "\n### Finding and shadow semantics",
      ruleStart
    );
    assert.ok(ruleStart >= 0 && policyEnd > ruleStart);
    const ruleBlock = contents.slice(ruleStart, policyEnd);
    const moved = `${contents.slice(0, ruleStart)}${contents.slice(policyEnd)}\n## Outside canonical policy\n\n${ruleBlock.trim()}\n`;
    await writeFile(target, moved, "utf8");
    const result = validate(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /^ENGINEERING_QUALITY_POLICY_DRIFT /);
  });
});

test("release validation accepts a changed plugin skill section that the closed baseline pinned", async () => {
  await withFixture(async (root) => {
    const skill = "plugins/banzai/skills/feature-description/SKILL.md";
    const closedBaseline = await readBaseline<ClosedBaseline>(
      root,
      CLOSED_BASELINE
    );
    assert.ok(closedBaseline.expectations[`${skill}#section:Rules`]);
    assert.ok(closedBaseline.expectations[`${skill}#skeleton`]);
    const target = path.join(root, skill);
    const contents = await readFile(target, "utf8");
    assert.match(contents, /^## Rules\n/mu);
    await writeFile(
      target,
      contents.replace(
        /^## Rules\n/mu,
        "## Rules\n\nFixture sentence the closed baseline never saw.\n"
      ),
      "utf8"
    );
    const result = validate(root);
    assert.equal(result.status, 0, result.stderr);
  });
});

test("release validation rejects a complete Engineering Quality rule copy in a consuming skill", async () => {
  await withFixture(async (root) => {
    const target = path.join(
      root,
      "plugins/banzai/skills/feature-description/SKILL.md"
    );
    const contents = await readFile(target, "utf8");
    const copiedRuleIds = Array.from(
      { length: 10 },
      (_, index) => `EQ-${String(index + 1).padStart(2, "0")}`
    ).join(", ");
    await writeFile(target, `${contents}\n${copiedRuleIds}\n`, "utf8");
    const result = validate(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /^ENGINEERING_QUALITY_POLICY_DRIFT /);
  });
});

test("release validation protects Engineering Quality authority precedence", async () => {
  await withFixture(async (root) => {
    const target = path.join(root, "plugins/banzai/AGENTS.md");
    const contents = await readFile(target, "utf8");
    await writeFile(
      target,
      contents.replace(
        "1. explicit approved user or specification decision;\n2. accepted ADR;",
        "1. accepted ADR;\n2. explicit approved user or specification decision;"
      ),
      "utf8"
    );
    const result = validate(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /^ENGINEERING_QUALITY_POLICY_DRIFT /);
  });
});

for (const [relativePath, fragment] of [
  [
    "plugins/banzai/policies/decision-consultation.md",
    "Consultation is not approval or permission."
  ],
  [
    "plugins/banzai/guidance/requirements.md",
    "decision provenance, not approval or broader authority"
  ],
  [
    "plugins/banzai/skills/architecture-decision/SKILL.md",
    "separate non-authorizing prerequisite"
  ],
  ["plugins/banzai/skills/development-plan/SKILL.md", "only gate that"],
  [
    "plugins/banzai/skills/code-writing/SKILL.md",
    "contracts/v4/phase-result.schema.json"
  ],
  ["plugins/banzai/skills/test-writing/SKILL.md", "decisionConsultation: null"],
  [
    "plugins/banzai/skills/feature/SKILL.md",
    "cannot use the planning-only consultation gate"
  ],
  [
    "plugins/banzai/skills/quick-fix/SKILL.md",
    "contracts/v4/phase-result.schema.json"
  ],
  [
    "packages/orchestrator/src/prompts.ts",
    "stop before authoring a Proposed ADR or plan that selects an option"
  ],
  ["README.md", "There are five existing decision gates"],
  ["documentation/orchestrator.md", "A v1 answer cannot answer a"],
  [
    "packages/orchestrator/src/cli.ts",
    "Consultation records preferences; it does not approve a plan or ADR."
  ],
  ["PROJECT_MANIFEST.md", "five existing workflow gates"],
  [
    "plugins/banzai/documentation/README.md",
    "v4/phase-result.schema.json # current task-verification phase hand-off"
  ],
  [
    "packages/orchestrator/test/agent-control.test.ts",
    "HISTORICAL ANSWER CANARY"
  ],
  [
    "packages/orchestrator/test/evaluation.test.ts",
    "FORBIDDEN-CONSULTATION-ANSWER"
  ],
  [
    "packages/orchestrator/scripts/smoke-committed.mjs",
    "evaluation leaked consultation history"
  ]
] as const) {
  test(`release validation protects decision-consultation policy in ${relativePath}`, async () => {
    await withFixture(async (root) => {
      const target = path.join(root, relativePath);
      const contents = await readFile(target, "utf8");
      assert.ok(contents.includes(fragment));
      await writeFile(target, contents.replaceAll(fragment, "REMOVED"), "utf8");
      const result = validate(root);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /^DECISION_CONSULTATION_POLICY_DRIFT /);
    });
  });
}

test("release validation pins the phase-result v4 manifest and schema identity", async () => {
  await withFixture(async (root) => {
    await mutateJson(
      root,
      "plugins/banzai/contracts/contract.json",
      (value) => {
        (value.schemas as Record<string, unknown>).phaseResult =
          "./v2/phase-result.schema.json";
      }
    );
    let result = validate(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /^INVALID_CONTRACT_REFERENCE /);

    await cp(
      path.join(REPOSITORY_ROOT, "plugins/banzai/contracts/contract.json"),
      path.join(root, "plugins/banzai/contracts/contract.json")
    );
    await mutateJson(
      root,
      "plugins/banzai/contracts/v4/phase-result.schema.json",
      (value) => {
        const properties = value.properties as Record<string, unknown>;
        (properties.schemaVersion as Record<string, unknown>).const = 5;
      }
    );
    result = validate(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /^CONTRACT_VERSION_MISMATCH /);
  });
});

for (const relativePath of [
  "plugins/banzai/contracts/v1/phase-result.schema.json",
  "plugins/banzai/contracts/v2/phase-result.schema.json"
] as const) {
  test(`release validation byte-protects legacy contract ${relativePath}`, async () => {
    await withFixture(async (root) => {
      const target = path.join(root, relativePath);
      await writeFile(target, `${await readFile(target, "utf8")}\n`, "utf8");
      const result = validate(root);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /^LEGACY_CONTRACT_DRIFT /);
    });
  });
}

test("release validation protects run-state v3-v11 and agent-control 9.0 identities", async () => {
  await withFixture(async (root) => {
    const typesPath = path.join(root, "packages/orchestrator/src/types.ts");
    const accepted = await readFile(typesPath, "utf8");
    await writeFile(
      typesPath,
      accepted.replace(
        "schemaVersion: 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11;",
        "schemaVersion: 2;"
      ),
      "utf8"
    );
    let result = validate(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /^STATE_CONTRACT_DRIFT /);

    await writeFile(
      typesPath,
      accepted.replace(
        '"banzai-agent-status/v7" as const',
        '"banzai-agent-status/v1" as const'
      ),
      "utf8"
    );
    result = validate(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /^CONTRACT_VERSION_MISMATCH /);
  });
});

test("release validation refuses stale current state documentation", async () => {
  await withFixture(async (root) => {
    const target = path.join(root, "documentation/orchestrator.md");
    await writeFile(
      target,
      (await readFile(target, "utf8")).replaceAll(
        "New runs start at schema version 10",
        "New runs start at schema version 9"
      )
    );
    const result = validate(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /^DECISION_CONSULTATION_POLICY_DRIFT /);
  });
});

for (const [relativePath, fragment] of [
  ["plugins/banzai/skills/initiative/SKILL.md", "name: initiative"],
  [
    "plugins/banzai/skills/initiative/SKILL.md",
    "disable-model-invocation: true"
  ],
  [
    "plugins/banzai/skills/initiative/SKILL.md",
    "only when the user invokes this skill explicitly by name"
  ],
  [
    "plugins/banzai/skills/initiative/SKILL.md",
    "never select it from prompt wording alone"
  ],
  [
    "plugins/banzai/skills/initiative/SKILL.md",
    "documentation/initiatives/<slug>/"
  ],
  [
    "plugins/banzai/skills/initiative/SKILL.md",
    "Initiative documents grant no approval."
  ],
  [
    "plugins/banzai/skills/initiative/SKILL.md",
    "Never fetch, stage, commit or push."
  ],
  [
    "plugins/banzai/skills/initiative/SKILL.md",
    "Never invoke the `banzai` CLI"
  ],
  ["plugins/banzai/skills/initiative/SKILL.md", "`next` writes nothing."],
  [
    "plugins/banzai/skills/initiative/SKILL.md",
    "the only write allowed is a re-freeze"
  ],
  [
    "plugins/banzai/skills/initiative/SKILL.md",
    "`gate` refuses to overwrite an existing report"
  ],
  [
    "plugins/banzai/skills/initiative/SKILL.md",
    "Never edit `brief.md` after `start`."
  ],
  [
    "plugins/banzai/skills/initiative/agents/openai.yaml",
    'display_name: "Banzai Initiative"'
  ],
  [
    "plugins/banzai/skills/initiative/agents/openai.yaml",
    "allow_implicit_invocation: false"
  ],
  ["plugins/banzai/AGENTS.md", "Multi-package initiative -> `initiative`"],
  ["plugins/banzai/AGENTS.md", "are not decision gates"]
] as const) {
  test(`release validation protects the initiative skill in ${relativePath}: ${fragment}`, async () => {
    await withFixture(async (root) => {
      const target = path.join(root, relativePath);
      let contents = replacePolicyFragment(
        await readFile(target, "utf8"),
        fragment,
        "REMOVED"
      );
      // The check accepts a fragment anywhere, so remove every occurrence.
      while (contents.replace(/\s+/g, " ").includes(fragment))
        contents = replacePolicyFragment(contents, fragment, "REMOVED");
      await writeFile(target, contents, "utf8");
      const result = validate(root);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /^INITIATIVE_SKILL_POLICY_DRIFT /);
    });
  });
}

// ADR-0070 section 7, owner choice (c): the supervisor skill left the plugin.
test("release validation accepts the plugin without the orchestrate skill", async () => {
  await withFixture(async (root) => {
    await assert.rejects(
      access(path.join(root, "plugins/banzai/skills/orchestrate")),
      { code: "ENOENT" }
    );
    // The publication policy is not part of the release fixture.
    for (const policy of [
      path.join(root, "release-policy.json"),
      path.join(REPOSITORY_ROOT, "publication-policy.json")
    ])
      assert.doesNotMatch(
        await readFile(policy, "utf8"),
        /skills\/orchestrate\//
      );
    assert.doesNotMatch(
      await readFile(
        path.join(
          REPOSITORY_ROOT,
          "packages/orchestrator/scripts/check-release.mjs"
        ),
        "utf8"
      ),
      /ORCHESTRATE_SKILL_POLICY_DRIFT|validateOrchestrateSkill/
    );
    const result = validate(root);
    assert.equal(result.status, 0, result.stderr);
  });
});

test("release policy pins Git-capable Node images", async () => {
  const policy = JSON.parse(
    await readFile(path.join(REPOSITORY_ROOT, "release-policy.json"), "utf8")
  ) as {
    node: {
      supported: { image: string }[];
    };
  };
  for (const lane of policy.node.supported) {
    assert.match(lane.image, /^node:\d+\.\d+\.\d+-bookworm$/);
    assert.doesNotMatch(lane.image, /-slim$/);
  }
});

for (const [relativePath, fragment] of [
  [
    "CONTRIBUTING.md",
    "one root-owned release-train version across nine persisted fields"
  ],
  ["documentation/release-checklist.md", "complete included-change scope"],
  ["documentation/orchestrator.md", "npm run version:set -- <version>"]
] as const) {
  test(`release validation protects unified version guidance in ${relativePath}`, async () => {
    await withFixture(async (root) => {
      const target = path.join(root, relativePath);
      const contents = await readFile(target, "utf8");
      assert.ok(contents.includes(fragment));
      await writeFile(
        target,
        replacePolicyFragment(contents, fragment, "REMOVED"),
        "utf8"
      );
      const result = validate(root);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /^DOCUMENTATION_POLICY_DRIFT /);
    });
  });
}

test("release validation rejects a missing CI container safe.directory step", async () => {
  await withFixture(async (root) => {
    const ciPath = path.join(root, ".github/workflows/ci.yml");
    const ci = await readFile(ciPath, "utf8");
    await writeFile(
      ciPath,
      ci.replace(
        '      - run: git config --global --add safe.directory "$GITHUB_WORKSPACE"\n',
        ""
      ),
      "utf8"
    );
    const result = validate(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /^CI_POLICY_DRIFT /);
  });
});

test("release validation rejects a missing CI Git preflight", async () => {
  await withFixture(async (root) => {
    const ciPath = path.join(root, ".github/workflows/ci.yml");
    const ci = await readFile(ciPath, "utf8");
    await writeFile(
      ciPath,
      ci.replace("      - run: git --version\n", ""),
      "utf8"
    );
    const result = validate(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /^CI_POLICY_DRIFT /);
  });
});

for (const surface of VERSION_SURFACES) {
  test(`release validation rejects version drift in ${surface.relativePath} ${surface.keys.join("/")}`, async () => {
    await withFixture(async (root) => {
      await setSurfaceVersion(root, surface, "1.19.1");
      const before = await snapshotVersionSurfaces(root);
      const expectedPath =
        surface.relativePath === "package.json"
          ? "plugins/banzai/.claude-plugin/plugin.json"
          : surface.relativePath;
      const result = validate(root);
      assert.equal(result.status, 1);
      assert.match(
        result.stderr,
        new RegExp(
          `^RELEASE_TRAIN_VERSION_MISMATCH ${expectedPath.replaceAll("/", "\\/")}:`
        )
      );
      assert.match(result.stderr, /differs from root package.json/);
      await assertVersionSnapshot(root, before);
    });
  });

  test(`release validation rejects a non-canonical version in ${surface.relativePath} ${surface.keys.join("/")}`, async () => {
    await withFixture(async (root) => {
      await setSurfaceVersion(root, surface, "01.19.0");
      const result = validate(root);
      assert.equal(result.status, 1);
      assert.match(
        result.stderr,
        new RegExp(
          `^INVALID_RELEASE_FIELD ${surface.relativePath.replaceAll("/", "\\/")}:`
        )
      );
    });
  });

  test(`release validation rejects a missing version in ${surface.relativePath} ${surface.keys.join("/")}`, async () => {
    await withFixture(async (root) => {
      await removeSurfaceVersion(root, surface);
      const result = validate(root);
      assert.equal(result.status, 1);
      assert.match(
        result.stderr,
        new RegExp(
          `^${surface.missingCode} ${surface.relativePath.replaceAll("/", "\\/")}:`
        )
      );
    });
  });
}

for (const parity of ["equal", "unequal"] as const) {
  test(`release validation blocks ${parity} release surfaces when transaction state exists without mutation`, async () => {
    await withFixture(async (root) => {
      if (parity === "unequal") {
        await setSurfaceVersion(root, VERSION_SURFACES[5], "1.19.1");
      }
      await chmod(path.join(root, VERSION_SURFACES[2].relativePath), 0o600);
      const transaction = path.join(root, RECOVERY_DIRECTORY);
      await mkdir(transaction, { mode: 0o700 });
      await writeFile(path.join(transaction, "canary"), "retained\n", {
        mode: 0o600
      });
      const before = await snapshotVersionSurfaces(root);

      const result = validate(root);

      assert.equal(result.status, 1);
      assert.match(
        result.stderr,
        /^UNRESOLVED_VERSION_TRANSACTION \.banzai-version-set:/
      );
      await assertVersionSnapshot(root, before);
      assert.equal(
        await readFile(path.join(transaction, "canary"), "utf8"),
        "retained\n"
      );
    });
  });
}

test("cleanup sync failure and failed restoration retain validator-visible recovery evidence", async () => {
  await withFixture(async (root) => {
    const before = await snapshotVersionSurfaces(root);
    const canonicalRoot = await realpath(root);
    const base = createNodeVersionFileSystem();
    const transaction = path.join(canonicalRoot, RECOVERY_DIRECTORY);
    const targets = new Set(
      VERSION_SURFACES.map((surface) =>
        path.join(canonicalRoot, surface.relativePath)
      )
    );
    let transactionRemoved = false;
    let cleanupSyncFailed = false;
    const fileSystem: VersionFileSystem = {
      ...base,
      async remove(target, options) {
        await base.remove(target, options);
        if (target === transaction && options?.recursive === true) {
          transactionRemoved = true;
        }
      },
      async syncDirectory(directory) {
        if (
          transactionRemoved &&
          !cleanupSyncFailed &&
          directory === canonicalRoot
        ) {
          cleanupSyncFailed = true;
          throw new Error("injected post-removal repository sync failure");
        }
        await base.syncDirectory(directory);
      },
      async move(source, target) {
        if (cleanupSyncFailed && targets.has(target)) {
          throw new Error("injected restoration failure");
        }
        await base.move(source, target);
      }
    };

    await assert.rejects(
      setProjectVersion({
        root,
        targetVersion: "1.20.0",
        ownerPid: process.pid,
        fileSystem
      }),
      (error: unknown) => {
        assert.ok(error instanceof VersionOperationError);
        assert.equal(error.code, "VERSION_RESTORE_FAILED");
        return true;
      }
    );

    await access(path.join(root, RECOVERY_GUARD));
    assert.deepEqual(
      await Promise.all(
        VERSION_SURFACES.map((surface) => readSurfaceVersion(root, surface))
      ),
      Array<string>(9).fill("1.20.0")
    );
    const blocked = validate(root);
    assert.equal(blocked.status, 1);
    assert.match(
      blocked.stderr,
      /^UNRESOLVED_VERSION_TRANSACTION \.banzai-version-set\.guard:/
    );
    await assert.rejects(recoverProjectVersion({ root }), (error: unknown) => {
      assert.ok(error instanceof VersionOperationError);
      assert.equal(error.code, "VERSION_TRANSACTION_ACTIVE");
      return true;
    });
    await access(path.join(root, RECOVERY_GUARD));

    const recovered = await recoverProjectVersion({
      root,
      isProcessAlive: () => false
    });
    assert.equal(recovered.action, "restored");
    await assertVersionSnapshot(root, before);
    assert.equal(validate(root).status, 0);
  });
});

test("SIGKILL after journal removal retains validator-visible recoverable originals", async () => {
  await withFixture(async (root) => {
    const before = await snapshotVersionSurfaces(root);
    const canonicalRoot = await realpath(root);
    const helper = path.join(path.dirname(root), "kill-final-cleanup.mjs");
    const source = `
import { createNodeVersionFileSystem, setProjectVersion } from ${JSON.stringify(pathToFileURL(RELEASE_VERSION_MODULE).href)};
const root = ${JSON.stringify(canonicalRoot)};
const transaction = ${JSON.stringify(path.join(canonicalRoot, RECOVERY_DIRECTORY))};
const base = createNodeVersionFileSystem();
const fileSystem = {
  ...base,
  async remove(target, options) {
    await base.remove(target, options);
    if (target === transaction && options?.recursive === true) {
      process.kill(process.pid, "SIGKILL");
    }
  }
};
await setProjectVersion({ root, targetVersion: "1.20.0", ownerPid: process.pid, fileSystem });
`;
    await writeFile(helper, source, "utf8");

    const killed = spawnSync(process.execPath, [helper], {
      cwd: root,
      encoding: "utf8",
      timeout: 10_000
    });
    assert.equal(killed.status, null, `${killed.stdout}\n${killed.stderr}`);
    assert.equal(killed.signal, "SIGKILL");
    await access(path.join(root, RECOVERY_GUARD));

    const blocked = validate(root);
    assert.equal(blocked.status, 1);
    assert.match(
      blocked.stderr,
      /^UNRESOLVED_VERSION_TRANSACTION \.banzai-version-set\.guard:/
    );

    const recovered = await recoverProjectVersion({
      root,
      isProcessAlive: () => false
    });
    assert.equal(recovered.action, "restored");
    await assertVersionSnapshot(root, before);
    assert.equal(validate(root).status, 0);
  });
});

test("release validation blocks an incomplete cleanup-guard temporary without mutation", async () => {
  await withFixture(async (root) => {
    const temporary = path.join(root, `${RECOVERY_GUARD}.tmp`);
    await writeFile(temporary, "incomplete\n", { mode: 0o600 });
    const before = await snapshotVersionSurfaces(root);

    const result = validate(root);

    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /^UNRESOLVED_VERSION_TRANSACTION \.banzai-version-set\.guard\.tmp:/
    );
    await assertVersionSnapshot(root, before);
    assert.equal(await readFile(temporary, "utf8"), "incomplete\n");
  });
});

for (const scenario of [
  {
    name: "unexpected root entry",
    async mutate(root: string): Promise<() => Promise<void>> {
      const retained = path.join(root, RECOVERY_DIRECTORY, "unexpected");
      await writeFile(retained, "do not delete\n", { mode: 0o600 });
      return async () => {
        assert.equal(await readFile(retained, "utf8"), "do not delete\n");
      };
    }
  },
  {
    name: "unexpected nested entry",
    async mutate(root: string): Promise<() => Promise<void>> {
      const retained = path.join(
        root,
        RECOVERY_DIRECTORY,
        "candidate",
        "unexpected"
      );
      await writeFile(retained, "do not delete\n", { mode: 0o600 });
      return async () => {
        assert.equal(await readFile(retained, "utf8"), "do not delete\n");
      };
    }
  },
  {
    name: "symlinked expected backup",
    async mutate(root: string): Promise<() => Promise<void>> {
      const outside = path.join(path.dirname(root), "outside-backup");
      const retained = path.join(root, RECOVERY_DIRECTORY, "original", "00");
      await writeFile(outside, "outside canary\n", { mode: 0o600 });
      await unlink(retained);
      await symlink(outside, retained);
      return async () => {
        assert.equal((await lstat(retained)).isSymbolicLink(), true);
        assert.equal(await readFile(outside, "utf8"), "outside canary\n");
      };
    }
  },
  {
    name: "mismatched transaction record",
    async mutate(root: string): Promise<() => Promise<void>> {
      const retained = path.join(root, RECOVERY_DIRECTORY, "transaction.json");
      const value = JSON.parse(await readFile(retained, "utf8")) as Record<
        string,
        unknown
      >;
      value.ownerPid = Number(value.ownerPid) + 1;
      const contents = `${JSON.stringify(value, null, 2)}\n`;
      await writeFile(retained, contents, { mode: 0o600 });
      return async () => {
        assert.equal(await readFile(retained, "utf8"), contents);
      };
    }
  },
  {
    name: "mismatched retained backup",
    async mutate(root: string): Promise<() => Promise<void>> {
      const retained = path.join(root, RECOVERY_DIRECTORY, "candidate", "00");
      await writeFile(retained, "mismatched backup\n", { mode: 0o600 });
      return async () => {
        assert.equal(await readFile(retained, "utf8"), "mismatched backup\n");
      };
    }
  }
] as const) {
  test(`guard recovery rejects and preserves a coexisting journal with ${scenario.name}`, async () => {
    await withFixture(async (root) => {
      await leaveCleanupGuardWithJournal(root);
      const assertRetained = await scenario.mutate(root);
      const beforeRecovery = await snapshotVersionSurfaces(root);
      const guard = path.join(root, RECOVERY_GUARD);
      const guardBefore = await readFile(guard);

      const blocked = validate(root);
      assert.equal(blocked.status, 1);
      assert.match(
        blocked.stderr,
        /^UNRESOLVED_VERSION_TRANSACTION \.banzai-version-set:/
      );
      await assert.rejects(
        recoverProjectVersion({
          root,
          isProcessAlive: () => false
        }),
        (error: unknown) => {
          assert.ok(error instanceof VersionOperationError);
          assert.equal(error.code, "INVALID_VERSION_TRANSACTION");
          return true;
        }
      );

      await assertVersionSnapshot(root, beforeRecovery);
      assert.deepEqual(await readFile(guard), guardBefore);
      await access(path.join(root, RECOVERY_DIRECTORY));
      await assertRetained();
      assert.equal(validate(root).status, 1);
    });
  });
}

test("guard recovery accepts an authenticated partially removed coexisting journal", async () => {
  await withFixture(async (root) => {
    const originals = await snapshotVersionSurfaces(root);
    await leaveCleanupGuardWithJournal(root);
    const transaction = path.join(root, RECOVERY_DIRECTORY);
    await unlink(path.join(transaction, "transaction.json"));
    await unlink(path.join(transaction, "ready"));
    await unlink(path.join(transaction, "original", "00"));
    await unlink(path.join(transaction, "candidate", "05"));

    const blocked = validate(root);
    assert.equal(blocked.status, 1);
    assert.match(
      blocked.stderr,
      /^UNRESOLVED_VERSION_TRANSACTION \.banzai-version-set:/
    );

    const recovered = await recoverProjectVersion({
      root,
      isProcessAlive: () => false
    });

    assert.equal(recovered.action, "restored");
    await assertVersionSnapshot(root, originals);
    await assert.rejects(access(transaction), { code: "ENOENT" });
    await assert.rejects(access(path.join(root, RECOVERY_GUARD)), {
      code: "ENOENT"
    });
    assert.equal(validate(root).status, 0);
  });
});

for (const [name, mutate] of [
  [
    "redirected root authority",
    (policy: Record<string, unknown>): void => {
      const project = policy.project as { versionAuthority: { path: string } };
      project.versionAuthority.path = "../outside.json";
    }
  ],
  [
    "missing root authority",
    (policy: Record<string, unknown>): void => {
      delete policy.project;
    }
  ],
  [
    "duplicated root lockfile mirror",
    (policy: Record<string, unknown>): void => {
      const project = policy.project as { lockfileMirrors: unknown[] };
      project.lockfileMirrors[1] = structuredClone(project.lockfileMirrors[0]);
    }
  ],
  [
    "legacy co-authority alongside mirrors",
    (policy: Record<string, unknown>): void => {
      const plugin = policy.plugin as Record<string, unknown>;
      plugin.versionSources = structuredClone(plugin.versionMirrors);
    }
  ],
  [
    "reordered plugin sources",
    (policy: Record<string, unknown>): void => {
      const plugin = policy.plugin as Record<string, unknown>;
      (plugin.versionMirrors as unknown[]).reverse();
    }
  ],
  [
    "duplicated plugin source",
    (policy: Record<string, unknown>): void => {
      const plugin = policy.plugin as Record<string, unknown>;
      const sources = plugin.versionMirrors as Record<string, unknown>[];
      const source = sources[0];
      assert.ok(source);
      sources[1] = structuredClone(source);
    }
  ],
  [
    "escaping plugin source",
    (policy: Record<string, unknown>): void => {
      const plugin = policy.plugin as Record<string, unknown>;
      const sources = plugin.versionMirrors as Record<string, unknown>[];
      const source = sources[0];
      assert.ok(source);
      source.path = "../outside.json";
    }
  ],
  [
    "missing orchestrator mirror",
    (policy: Record<string, unknown>): void => {
      const orchestrator = policy.orchestrator as Record<string, unknown>;
      delete orchestrator.packageVersionMirror;
    }
  ],
  [
    "unsafe recovery directory",
    (policy: Record<string, unknown>): void => {
      const transaction = policy.versionTransaction as Record<string, unknown>;
      transaction.recoveryDirectory = "/tmp/version-state";
    }
  ]
] as const) {
  test(`release validation rejects ${name} in the fixed version policy`, async () => {
    await withFixture(async (root) => {
      await mutateJson(root, "release-policy.json", mutate);
      const result = validate(root);
      assert.equal(result.status, 1);
      assert.match(
        result.stderr,
        /^INVALID_RELEASE_POLICY release-policy\.json:/
      );
    });
  });
}

for (const [name, mutate] of [
  [
    "missing version:set wiring",
    (rootPackage: Record<string, unknown>): void => {
      delete (rootPackage.scripts as Record<string, unknown>)["version:set"];
    }
  ],
  [
    "changed version:recover wiring",
    (rootPackage: Record<string, unknown>): void => {
      (rootPackage.scripts as Record<string, unknown>)["version:recover"] =
        "node elsewhere.mjs";
    }
  ]
] as const) {
  test(`release validation rejects ${name}`, async () => {
    await withFixture(async (root) => {
      await mutateJson(root, "package.json", mutate);
      const result = validate(root);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /^INVALID_RELEASE_POLICY package\.json:/);
    });
  });
}

test("release validation keeps the Claude marketplace versionless", async () => {
  await withFixture(async (root) => {
    await mutateJson(root, ".claude-plugin/marketplace.json", (value) => {
      const plugin = (value.plugins as Record<string, unknown>[])[0];
      assert.ok(plugin);
      plugin.version = "1.19.0";
    });
    const result = validate(root);
    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /^INVALID_MARKETPLACE \.claude-plugin\/marketplace\.json:/
    );
  });
});

test("release validation never invokes version synchronization or recovery", async () => {
  await withFixture(async (root) => {
    const canary = path.join(root, "version-command-invoked");
    const marker = `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(canary)}, "invoked\\n"); process.exitCode = 91;\n`;
    await writeFile(
      path.join(root, "packages/orchestrator/scripts/version-set.mjs"),
      marker,
      "utf8"
    );
    await writeFile(
      path.join(root, "packages/orchestrator/scripts/version-recover.mjs"),
      marker,
      "utf8"
    );

    const result = validate(root);

    assert.equal(result.status, 0, result.stderr);
    await assert.rejects(access(canary));
  });
});

test("release validation rejects malformed manifests", async () => {
  await withFixture(async (root) => {
    await writeFile(
      path.join(root, "plugins/banzai/.codex-plugin/plugin.json"),
      "{ malformed\n",
      "utf8"
    );
    const result = validate(root);
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stderr, /^MALFORMED_RELEASE_JSON /);
  });
});

for (const [relativePath, code] of [
  ["plugins/banzai/hooks/spec-gate.cjs", "MISSING_RELEASE_FILE"],
  ["plugins/banzai/skills/code-writing/SKILL.md", "MISSING_RELEASE_FILE"],
  [
    "plugins/banzai/contracts/v1/review-result.schema.json",
    "MISSING_RELEASE_FILE"
  ],
  [
    "plugins/banzai/contracts/v2/phase-result.schema.json",
    "MISSING_RELEASE_FILE"
  ],
  [
    "plugins/banzai/contracts/v4/phase-result.schema.json",
    "MALFORMED_RELEASE_JSON"
  ]
] as const) {
  test(`release validation rejects missing ${relativePath}`, async () => {
    await withFixture(async (root) => {
      await unlink(path.join(root, relativePath));
      const result = validate(root);
      assert.equal(result.status, 1);
      assert.match(result.stderr, new RegExp(`^${code} `));
    });
  });
}

test("release validation requires the committed CLI to remain executable", async () => {
  await withFixture(async (root) => {
    const bundle = path.join(root, "packages/orchestrator/dist/banzai.mjs");
    await chmod(bundle, 0o644);
    const result = validate(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /^NON_EXECUTABLE_DISTRIBUTION /);
  });
});

test("release validation rejects Node and GitHub Actions policy drift", async () => {
  await withFixture(async (root) => {
    await mutateJson(root, "package.json", (value) => {
      (value.engines as Record<string, unknown>).node = ">=22";
    });
    let result = validate(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /^NODE_POLICY_DRIFT /);

    await cp(
      path.join(REPOSITORY_ROOT, "package.json"),
      path.join(root, "package.json")
    );
    await setSurfaceVersion(root, VERSION_SURFACES[0], "1.19.0");
    const ciPath = path.join(root, ".github/workflows/ci.yml");
    const ci = await readFile(ciPath, "utf8");
    await writeFile(
      ciPath,
      ci.replace(
        "      - run: npm run release:check",
        "      - run: codex auth status"
      ),
      "utf8"
    );
    result = validate(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /^CI_POLICY_DRIFT /);
  });
});

test("release policy accepts exactly the three ADR-0067 supported lanes", async () => {
  type Lane = Record<string, unknown>;
  interface NodePolicy {
    supported: Lane[];
    forward?: Lane;
    engines?: string;
  }
  const mutations: [string, (node: NodePolicy) => void][] = [
    ["Node 26 lane removed", (node) => void node.supported.pop()],
    [
      "Node 26 lane advisory",
      (node) => {
        node.supported[2] = { ...node.supported[2], required: false };
      }
    ],
    [
      "Node 26 lane re-pinned",
      (node) => {
        node.supported[2] = {
          ...node.supported[2],
          version: "26.7.0",
          image: "node:26.7.0-bookworm"
        };
      }
    ],
    [
      "Node 25 lane added",
      (node) => {
        node.supported.push({
          major: 25,
          version: "25.2.1",
          image: "node:25.2.1-bookworm",
          job: "release_check_node_25",
          required: true
        });
      }
    ],
    [
      "forward lane reintroduced",
      (node) => {
        node.forward = {
          major: 26,
          version: "26.7.0",
          image: "node:26.7.0-bookworm",
          job: "forward_compatibility_node_26",
          required: false
        };
      }
    ],
    [
      "engines without Node 26",
      (node) => {
        node.engines = ">=22.20.0 <23 || >=24.11.1 <25";
      }
    ]
  ];
  await withFixture(async (root) => {
    for (const [label, mutate] of mutations) {
      await cp(
        path.join(REPOSITORY_ROOT, "release-policy.json"),
        path.join(root, "release-policy.json")
      );
      await mutateJson(root, "release-policy.json", (value) => {
        mutate(value.node as NodePolicy);
      });
      const result = validate(root);
      assert.equal(result.status, 1, `accepted policy mutation: ${label}`);
      assert.match(result.stderr, /^NODE_POLICY_DRIFT /, label);
    }
  });
});

test("default CI lanes reject vendor calls and live CI requires explicit opt-in", async () => {
  await withFixture(async (root) => {
    const ciPath = path.join(root, ".github/workflows/ci.yml");
    const accepted = await readFile(ciPath, "utf8");
    await writeFile(
      ciPath,
      accepted.replace(
        "      - run: npm ci",
        "      - run: npm ci\n      - run: codex --version"
      ),
      "utf8"
    );
    let result = validate(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /^CI_VENDOR_BOUNDARY /);

    for (const guard of [
      "github.event_name == 'workflow_dispatch' &&",
      "inputs.live_compatibility == true &&",
      "github.ref_protected == true &&",
      "vars.BANZAI_LIVE_COMPATIBILITY == '1'"
    ]) {
      assert.ok(accepted.includes(guard));
      await writeFile(ciPath, accepted.replace(guard, "true"), "utf8");
      result = validate(root);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /^CI_POLICY_DRIFT /);
    }
  });
});

test("release validation rejects weakened GitHub CI evidence and live isolation", async () => {
  // ADR-0071: the complementary branch conditions of a release lane.
  const full =
    "steps.scope.outputs.scope != 'documents' && steps.scope.outputs.scope != 'plugin'";
  const narrow =
    "steps.scope.outputs.scope == 'documents' || steps.scope.outputs.scope == 'plugin'";
  const releaseCheck = `      - run: npm run release:check\n        if: ${full}\n`;
  const evidence = `      - id: release_evidence\n        if: ${full}\n`;
  const upload = `      - uses: actions/upload-artifact@v7\n        if: ${full}\n`;
  const scopedCheck = `      - run: npm run check -- --base HEAD^1\n        if: ${narrow}\n`;
  await withFixture(async (root) => {
    const ciPath = path.join(root, ".github/workflows/ci.yml");
    const accepted = await readFile(ciPath, "utf8");
    for (const [before, after, code] of [
      [
        "  pull_request:\n",
        "  push:\n    branches: [main]\n  pull_request:\n",
        "CI_POLICY_DRIFT"
      ],
      // ADR-0067 retired the weekly schedule with the forward lane.
      [
        "        default: false\n",
        '        default: false\n  schedule:\n    - cron: "17 5 * * 1"\n',
        "CI_POLICY_DRIFT"
      ],
      [
        "concurrency:\n  group: ci-${{ github.event_name == 'pull_request' && format('pr-{0}', github.event.pull_request.number) || format('run-{0}', github.run_id) }}\n  cancel-in-progress: ${{ github.event_name == 'pull_request' }}\n\n",
        "",
        "CI_POLICY_DRIFT"
      ],
      [
        "  cancel-in-progress: ${{ github.event_name == 'pull_request' }}",
        "  cancel-in-progress: true",
        "CI_POLICY_DRIFT"
      ],
      [
        "  release_check_node_26:\n",
        "  release_check_node_26:\n    if: always()\n",
        "CI_POLICY_DRIFT"
      ],
      // A more-indented line continues the plain-scalar condition.
      [
        "  release_check_node_26:\n",
        "  release_check_node_26:\n    if: github.event_name != 'pull_request'\n      || true\n",
        "CI_POLICY_DRIFT"
      ],
      [
        releaseCheck,
        "      - run: npm run release:check\n        if: false\n",
        "CI_POLICY_DRIFT"
      ],
      // A quoted key is the same condition in another YAML spelling (review-3 F1).
      [
        releaseCheck,
        "      - run: npm run release:check\n        \"if\": github.event_name != 'pull_request'\n",
        "CI_POLICY_DRIFT"
      ],
      ["      - uses: actions/upload-artifact@v7\n", "", "CI_POLICY_DRIFT"],
      // ADR-0071: the full branch alone runs the release check and records
      // and uploads evidence; a narrow branch records none.
      [releaseCheck, "      - run: npm run release:check\n", "CI_POLICY_DRIFT"],
      [evidence, "      - id: release_evidence\n", "CI_POLICY_DRIFT"],
      [
        evidence,
        "      - id: release_evidence\n        if: always()\n",
        "CI_POLICY_DRIFT"
      ],
      [
        evidence,
        `      - id: release_evidence\n        if: ${narrow}\n`,
        "CI_POLICY_DRIFT"
      ],
      [upload, "      - uses: actions/upload-artifact@v7\n", "CI_POLICY_DRIFT"],
      [
        upload,
        "      - uses: actions/upload-artifact@v7\n        if: success()\n",
        "CI_POLICY_DRIFT"
      ],
      // Overlapping conditions run both branches for some scope.
      [
        releaseCheck,
        "      - run: npm run release:check\n        if: steps.scope.outputs.scope != 'documents'\n",
        "CI_POLICY_DRIFT"
      ],
      [
        scopedCheck,
        "      - run: npm run check -- --base HEAD^1\n        if: steps.scope.outputs.scope != 'full'\n",
        "CI_POLICY_DRIFT"
      ],
      [scopedCheck, "", "CI_POLICY_DRIFT"],
      // The scope step must run the first parent's module, never the
      // checked-out one, and needs the first parent in the checkout.
      [
        '            node "$RUNNER_TEMP/verification-scope.mjs" --ci\n',
        "            node packages/orchestrator/scripts/verification-scope.mjs --ci\n",
        "CI_POLICY_DRIFT"
      ],
      [
        '            echo "scope=full" >> "$GITHUB_OUTPUT"\n',
        '            echo "scope=documents" >> "$GITHUB_OUTPUT"\n',
        "CI_POLICY_DRIFT"
      ],
      [
        "          persist-credentials: false\n          fetch-depth: 2\n",
        "          persist-credentials: false\n",
        "CI_POLICY_DRIFT"
      ],
      // Node 26 is a required lane: it runs on pull requests and blocks.
      [
        "  release_check_node_26:\n",
        "  release_check_node_26:\n    if: github.event_name != 'pull_request'\n",
        "CI_POLICY_DRIFT"
      ],
      [
        "  release_check_node_26:\n",
        "  release_check_node_26:\n    continue-on-error: true\n",
        "CI_POLICY_DRIFT"
      ],
      [
        "    container: node:26.13.0-bookworm",
        "    container: node:26.7.0-bookworm",
        "CI_POLICY_DRIFT"
      ],
      // No forward lane is accepted (ADR-0067).
      [
        "  live_vendor_compatibility:\n",
        "  forward_compatibility_node_26:\n    if: github.event_name != 'pull_request'\n    runs-on: ubuntu-24.04\n    container: node:26.7.0-bookworm\n    continue-on-error: true\n    steps:\n      - uses: actions/checkout@v6\n\n  live_vendor_compatibility:\n",
        "CI_POLICY_DRIFT"
      ],
      ["  pull_request:\n", "  pull_request_target:\n", "CI_POLICY_DRIFT"],
      ["        default: false", "        default: true", "CI_POLICY_DRIFT"],
      ["  contents: read", "  contents: write", "CI_POLICY_DRIFT"],
      [
        "    container: node:22.20.0-bookworm",
        "    container: node:22-bookworm",
        "CI_POLICY_DRIFT"
      ],
      [
        "  release_check_node_22:\n",
        "  release_check_node_22:\n    continue-on-error: true\n",
        "CI_POLICY_DRIFT"
      ],
      [
        "  release_check_node_22:\n",
        "  release_check_node_22:\n    needs: release_check_node_24\n",
        "CI_POLICY_DRIFT"
      ],
      [
        "  release_check_node_22:\n",
        "  release_check_node_22:\n    if: false\n",
        "CI_POLICY_DRIFT"
      ],
      ["    continue-on-error: true\n", "", "CI_POLICY_DRIFT"],
      [
        "          persist-credentials: false",
        "          persist-credentials: true",
        "CI_POLICY_DRIFT"
      ],
      [
        "    runs-on: [self-hosted, linux, banzai-live]",
        "    runs-on: ubuntu-24.04",
        "CI_POLICY_DRIFT"
      ],
      [
        "          package-manager-cache: false",
        "          package-manager-cache: true",
        "CI_POLICY_DRIFT"
      ],
      [
        "      - run: npm run compatibility:live -- --confirm-live",
        "      - run: npm run compatibility:live -- --confirm-live\n      - uses: actions/upload-artifact@v4",
        "CI_LIVE_RETENTION"
      ],
      [
        "      - run: npm ci",
        "      - run: npm ci\n      - uses: actions/cache@v4",
        "CI_CACHE_BOUNDARY"
      ],
      ["  release_check_node_22:\n", "  unexpected_job:\n", "CI_POLICY_DRIFT"],
      [
        "      vars.BANZAI_LIVE_COMPATIBILITY == '1'",
        "      vars.BANZAI_LIVE_COMPATIBILITY == '1' || true",
        "CI_POLICY_DRIFT"
      ]
    ]) {
      assert.ok(
        before !== undefined && after !== undefined && code !== undefined
      );
      assert.ok(
        accepted.includes(before),
        `fixture fragment missing: ${before}`
      );
      await writeFile(ciPath, accepted.replace(before, after), "utf8");
      const result = validate(root);
      assert.equal(result.status, 1, `accepted CI mutation: ${after}`);
      assert.match(result.stderr, new RegExp(`^${code} `));
    }
  });
});

test("release validation rejects a weakened publication gate", async () => {
  await withFixture(async (root) => {
    const publishPath = path.join(root, ".github/workflows/publish.yml");
    const accepted = await readFile(publishPath, "utf8");
    for (const [before, after] of [
      ["    types: [published]", "    types: [published, created]"],
      [
        "      - id: evidence\n        env:\n          GITHUB_TOKEN: ${{ github.token }}\n        run: node packages/orchestrator/scripts/release-evidence.mjs verify\n",
        ""
      ],
      ["          fetch-depth: 2\n", ""],
      ["      - run: npm run release:check", "      - run: npm test"],
      [
        "    container: node:22.20.0-bookworm",
        "    container: node:24.11.1-bookworm"
      ],
      ["  release_check_node_22:\n", "  release_check_node_20:\n"],
      [
        "  release_check_node_22:\n",
        "  release_check_node_22:\n    continue-on-error: true\n"
      ],
      [
        "      (needs.release_check_node_22.result == 'success' && needs.release_check_node_24.result == 'success' && needs.release_check_node_26.result == 'success'))",
        "      (needs.release_check_node_24.result == 'success' && needs.release_check_node_26.result == 'success'))"
      ],
      // ADR-0067: publication without the Node 26 lane is not accepted.
      [
        "      (needs.release_check_node_22.result == 'success' && needs.release_check_node_24.result == 'success' && needs.release_check_node_26.result == 'success'))",
        "      (needs.release_check_node_22.result == 'success' && needs.release_check_node_24.result == 'success'))"
      ],
      [
        "      - release_check_node_24\n      - release_check_node_26\n",
        "      - release_check_node_24\n"
      ],
      [
        "    container: node:26.13.0-bookworm",
        "    container: node:24.11.1-bookworm"
      ],
      // Evidence checking and publishing stay on Node 24 (ADR-0039).
      [
        "          node-version: 24.11.1\n          registry-url:",
        "          node-version: 26.13.0\n          registry-url:"
      ],
      // Appended disjunctions, also after a blank line inside the folded
      // scalar, would admit publication without any gate (review-2 F1).
      [
        "      (needs.release_check_node_22.result == 'success' && needs.release_check_node_24.result == 'success' && needs.release_check_node_26.result == 'success'))\n",
        "      (needs.release_check_node_22.result == 'success' && needs.release_check_node_24.result == 'success' && needs.release_check_node_26.result == 'success'))\n      || true\n"
      ],
      [
        "      (needs.release_check_node_22.result == 'success' && needs.release_check_node_24.result == 'success' && needs.release_check_node_26.result == 'success'))\n",
        "      (needs.release_check_node_22.result == 'success' && needs.release_check_node_24.result == 'success' && needs.release_check_node_26.result == 'success'))\n\n      || true\n"
      ],
      // A step condition would let a fallback lane succeed without its gate.
      [
        "      - run: npm run release:check\n",
        "      - run: npm run release:check\n        if: false\n"
      ],
      [
        "      - run: npm run release:check\n\n  publish_npm:\n",
        "      - run: npm run release:check\n        if: false\n\n  publish_npm:\n"
      ],
      // Other YAML spellings of the same key, including one actionlint
      // accepts, must not slip past either (review-3 F1).
      [
        "      - run: npm run release:check\n",
        "      - run: npm run release:check\n        \"if\": github.event_name != 'release'\n"
      ],
      [
        "      - run: npm run release:check\n\n  publish_npm:\n",
        "      - run: npm run release:check\n        \"if\": github.event_name != 'release'\n\n  publish_npm:\n"
      ],
      [
        "      - run: npm run release:check\n",
        "      - run: npm run release:check\n        'if': false\n"
      ],
      [
        "      - run: npm run release:check\n\n  publish_npm:\n",
        "      - run: npm run release:check\n        if : false\n\n  publish_npm:\n"
      ],
      [
        "      - run: npm run release:check\n",
        '      - run: npm run release:check\n        "\\u0069f": false\n'
      ],
      ["      !cancelled() &&\n", "      always() &&\n"],
      [
        "      contents: read\n      actions: read\n",
        "      contents: read\n      actions: read\n      id-token: write\n"
      ],
      [
        "      contents: read\n      id-token: write\n",
        "      contents: read\n      actions: read\n      id-token: write\n"
      ],
      ["      actions: read\n", "      actions: write\n"],
      ["  contents: read\n\njobs:", "  contents: write\n\njobs:"],
      [
        "    if: github.event.release.draft == false && github.event.release.prerelease == false\n",
        ""
      ],
      ["      - run: npm run publication:check\n", ""],
      ["      - run: npm run build:dist\n", ""],
      [
        "      - run: npm run build:dist\n",
        "      - run: npm run build:dist\n        if: false\n"
      ],
      [
        "      - run: npm run build:dist\n      - run: npm run release:validate\n",
        "      - run: npm run release:validate\n      - run: npm run build:dist\n"
      ],
      [
        "      - run: npm run release:validate\n      - run: npm run publication:check\n",
        "      - run: npm run publication:check\n      - run: npm run release:validate\n"
      ]
    ]) {
      assert.ok(before !== undefined && after !== undefined);
      assert.ok(
        accepted.includes(before),
        `fixture fragment missing: ${before}`
      );
      await writeFile(publishPath, accepted.replace(before, after), "utf8");
      const result = validate(root);
      assert.equal(result.status, 1, `accepted publish mutation: ${after}`);
      assert.match(result.stderr, /^PUBLISH_POLICY_DRIFT /);
    }
  });
});

test("GitHub CI replaces GitLab while allowing unrelated GitHub metadata", async () => {
  await withFixture(async (root) => {
    await writeFile(
      path.join(root, ".github/CODEOWNERS"),
      "# Maintainer ownership\n",
      "utf8"
    );
    let result = validate(root);
    assert.equal(result.status, 0, result.stderr);

    await writeFile(
      path.join(root, ".gitlab-ci.yml"),
      "stages: [quality]\n",
      "utf8"
    );
    result = validate(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /^UNEXPECTED_GITLAB_CI /);
  });
});

test("release validation rejects source drift against committed dist", async () => {
  await withFixture(async (root) => {
    const packageRoot = path.join(root, "packages/orchestrator");
    const cliPath = path.join(packageRoot, "src/cli.ts");
    const cli = await readFile(cliPath, "utf8");
    await writeFile(cliPath, cli.replace("Usage:", "Changed usage:"), "utf8");
    const stale = validate(root);
    assert.equal(stale.status, 1);
    assert.match(stale.stderr, /^STALE_DISTRIBUTION /);
    assert.equal(
      (await readdir(packageRoot)).some((entry) =>
        entry.startsWith(".dist-check-")
      ),
      false
    );
  });
});

for (const relativePath of [
  "packages/orchestrator/dist/banzai.mjs",
  "packages/orchestrator/dist/banzai.mjs.map"
]) {
  test(`release validation rejects stale ${relativePath}`, async () => {
    await withFixture(async (root) => {
      const target = path.join(root, relativePath);
      await writeFile(
        target,
        `${await readFile(target, "utf8")}stale\n`,
        "utf8"
      );
      const stale = validate(root);
      assert.equal(stale.status, 1);
      assert.match(stale.stderr, /^STALE_DISTRIBUTION /);
      assert.equal(
        (await readdir(path.join(root, "packages/orchestrator"))).some(
          (entry) => entry.startsWith(".dist-check-")
        ),
        false
      );
    });
  });

  test(`release validation rejects missing ${relativePath}`, async () => {
    await withFixture(async (root) => {
      await unlink(path.join(root, relativePath));
      const stale = validate(root);
      assert.equal(stale.status, 1);
      assert.match(stale.stderr, /^STALE_DISTRIBUTION /);
      assert.equal(
        (await readdir(path.join(root, "packages/orchestrator"))).some(
          (entry) => entry.startsWith(".dist-check-")
        ),
        false
      );
    });
  });
}

test("test driver is non-TTY and removes output after success and failure", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "banzai-test-driver-"));
  const testRoot = path.join(root, "test");
  const outputRoot = path.join(root, "output");
  const nestedEnvironment = { ...process.env };
  delete nestedEnvironment.NODE_TEST_CONTEXT;
  try {
    await cp(
      path.join(REPOSITORY_ROOT, "package.json"),
      path.join(root, "package.json")
    );
    await mkdir(testRoot);
    await writeFile(
      path.join(testRoot, "fixture.test.ts"),
      'import assert from "node:assert/strict"; import test from "node:test"; test("non tty", () => assert.equal(Boolean(process.stdin.isTTY), false));\n',
      "utf8"
    );
    let result = spawnSync(
      process.execPath,
      [
        path.join(process.cwd(), "scripts/test.mjs"),
        "--test-root",
        testRoot,
        "--output-root",
        outputRoot
      ],
      {
        cwd: process.cwd(),
        env: nestedEnvironment,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"]
      }
    );
    assert.equal(result.status, 0, result.stderr);
    await assert.rejects(access(outputRoot));

    await writeFile(
      path.join(testRoot, "fixture.test.ts"),
      'import test from "node:test"; test("failure", () => { throw new Error("expected fixture failure"); });\n',
      "utf8"
    );
    result = spawnSync(
      process.execPath,
      [
        path.join(process.cwd(), "scripts/test.mjs"),
        "--test-root",
        testRoot,
        "--output-root",
        outputRoot
      ],
      {
        cwd: process.cwd(),
        env: nestedEnvironment,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"]
      }
    );
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    await assert.rejects(access(outputRoot));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("test driver selects exact files before bundling and combines name filtering", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "banzai-test-selection-"));
  const testRoot = path.join(root, "test");
  const outputRoot = path.join(root, "output");
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const run = (...args: string[]) =>
    spawnSync(
      process.execPath,
      [
        path.join(process.cwd(), "scripts/test.mjs"),
        "--test-root",
        testRoot,
        "--output-root",
        outputRoot,
        ...args
      ],
      {
        cwd: process.cwd(),
        env,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"]
      }
    );
  try {
    await mkdir(path.join(testRoot, "nested"), { recursive: true });
    await writeFile(
      path.join(testRoot, "selected.test.ts"),
      'import test from "node:test"; test("selected pass", () => {}); test("filtered failure", () => { throw new Error("name filter missing"); });\n'
    );
    await writeFile(
      path.join(testRoot, "nested/second.test.ts"),
      'import test from "node:test"; test("second pass", () => {});\n'
    );
    await writeFile(
      path.join(testRoot, "broken.test.ts"),
      "this is not valid TypeScript !\n"
    );
    let result = run(
      "--file",
      "selected.test.ts",
      "--file",
      "nested/second.test.ts",
      "--file",
      "selected.test.ts",
      "--pattern",
      "pass"
    );
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /selected pass/);
    assert.match(result.stdout, /second pass/);
    assert.match(result.stdout, /tests 2\b/);
    await assert.rejects(access(outputRoot));

    result = run("--file", "selected.test.ts");
    assert.equal(result.status, 1);
    assert.match(result.stdout, /name filter missing/);
    await assert.rejects(access(outputRoot));
    for (const args of [
      [],
      ["--pattern", "pass"],
      ["--file", "broken.test.ts"]
    ]) {
      result = run(...args);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /ERROR/);
      await assert.rejects(access(outputRoot));
    }
    for (const file of [
      "",
      "../selected.test.ts",
      "/selected.test.ts",
      "./selected.test.ts",
      "nested//second.test.ts",
      "nested\\second.test.ts",
      "missing.test.ts",
      "selected.ts"
    ]) {
      result = run("--file", file);
      assert.equal(result.status, 1, file);
      assert.doesNotMatch(result.stderr, /Build failed|ERROR/);
      await assert.rejects(access(outputRoot));
    }
    await rm(path.join(testRoot, "broken.test.ts"));
    await rm(path.join(testRoot, "selected.test.ts"));
    result = run();
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /second pass/);
    await assert.rejects(access(outputRoot));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

for (const scenario of [
  {
    name: "extra shim line",
    file: "CLAUDE.md",
    mutate: (text: string) => `${text}\nExtra.\n`
  },
  {
    name: "process include",
    file: "AGENTS.md",
    mutate: (text: string) => `${text}\n@other.md\n`
  },
  {
    name: "missing process section",
    file: "AGENTS.md",
    mutate: (text: string) => text.replace("## Policies", "## Removed")
  },
  {
    name: "missing index policy",
    file: "AGENTS.md",
    mutate: (text: string) =>
      text
        .split("\n")
        .filter((line) => !line.startsWith("| Decision Consultation"))
        .join("\n")
  },
  {
    name: "omitted index consumer",
    file: "AGENTS.md",
    mutate: (text: string) =>
      text.replace(/(\| Security Assurance[^\n]*?)`feature`, /, "$1")
  },
  {
    name: "omitted policy header consumer",
    file: "policies/security-assurance.md",
    mutate: (text: string) => text.replace("`feature`, ", "")
  },
  {
    name: "missing matrix read",
    file: "skills/feature/SKILL.md",
    mutate: (text: string) =>
      text.replace(/\s+- `security-assurance\.md` before[^\n]+\n/, "\n")
  },
  {
    name: "missing plan authority section",
    file: "policies/plan-task-completion.md",
    mutate: (text: string) => text.replace("## Plan Authority", "## Removed")
  },
  {
    name: "missing plan authority owner",
    file: "policies/plan-task-completion.md",
    mutate: (text: string) => text.replace("ADR-0038 (Plan Authority); ", "")
  },
  {
    name: "missing conditional plan policy read",
    file: "skills/feature-review/SKILL.md",
    mutate: (text: string) =>
      text.replace(/\s+- `plan-task-completion\.md` when[^\n]+\n/, "\n")
  },
  {
    name: "conditional read made mandatory",
    file: "skills/code-writing/SKILL.md",
    mutate: (text: string) =>
      text.replace(
        "`security-assurance.md` when",
        "`security-assurance.md` before"
      )
  },
  {
    name: "unexpected test-writing EQ read",
    file: "skills/test-writing/SKILL.md",
    mutate: (text: string) => `${text}\nRead engineering-quality.md.\n`
  },
  {
    name: "unauthorized bootstrap exemption",
    file: "skills/feature/SKILL.md",
    mutate: (text: string) => `${text}\nApply the bootstrap source rule.\n`
  },
  {
    name: "stale policy reference",
    file: "skills/quick-fix/SKILL.md",
    mutate: (text: string) =>
      `${text}\nSecurity Assurance policy in \`CLAUDE.md\`.\n`
  },
  {
    name: "stale reference inside an allowed layout sentence",
    file: "skills/quick-fix/SKILL.md",
    mutate: (text: string) =>
      `${text}\nFor this layout read the policy from \`CLAUDE.md\`.\n`
  },
  {
    name: "missing migration approval",
    file: "skills/project-manifest/references/layout-migration.md",
    mutate: (text: string) =>
      text.replace("Apply only after approval", "Apply immediately")
  },
  {
    name: "a policy read added to the initiative skill",
    file: "skills/initiative/SKILL.md",
    mutate: (text: string) =>
      text.replace(
        "## Sources\n",
        "## Sources\n\n- Policies, resolved as `../../policies/<name>.md`:\n  - `engineering-quality.md` before any mode.\n"
      )
  },
  {
    name: "a missing legacy stop in the initiative skill",
    file: "skills/initiative/SKILL.md",
    mutate: (text: string) =>
      replacePolicyFragment(
        text,
        "legacy Banzai layout: run `project-manifest` to migrate",
        "legacy layout"
      )
  },
  {
    name: "a writing skill without its policy resolution line",
    file: "skills/feature-description/SKILL.md",
    mutate: (text: string) =>
      text.replace("../../policies/<name>.md", "the installed policies")
  }
]) {
  test(`instruction layout rejects ${scenario.name}`, async () => {
    await withFixture(async (root) => {
      const target = path.join(root, "plugins/banzai", scenario.file);
      const before = await readFile(target, "utf8");
      const after = scenario.mutate(before);
      assert.notEqual(
        after,
        before,
        "fixture must change the guarded contract"
      );
      await writeFile(target, after, "utf8");
      const result = validate(root);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /^INSTRUCTION_LAYOUT_DRIFT /);
    });
  });
}

for (const version of ["1.19.1", "01.18.0", "not-a-version"]) {
  test(`instruction layout rejects legacy release ${version}`, async () => {
    await withFixture(async (root) => {
      await setLegacyLayoutRelease(root, version);
      const result = validate(root);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /^INSTRUCTION_LAYOUT_DRIFT /);
    });
  });
}

test("instruction layout permits the unreleased source version and unchanged hook free paths", async () => {
  await withFixture(async (root) => {
    await setLegacyLayoutRelease(root, "1.19.0");
    const result = validate(root);
    assert.equal(result.status, 0, result.stderr);
  });
});

test("instruction layout inventory cannot drop a required policy", async () => {
  await withFixture(async (root) => {
    await mutateJson(root, "release-policy.json", (value) => {
      const plugin = value.plugin as { requiredPaths: string[] };
      plugin.requiredPaths = plugin.requiredPaths.filter(
        (item) => !item.endsWith("policies/plan-task-completion.md")
      );
    });
    const result = validate(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /^INSTRUCTION_LAYOUT_DRIFT /);
  });
});

test("instruction layout rejects a missing packaged policy file", async () => {
  await withFixture(async (root) => {
    await unlink(
      path.join(root, "plugins/banzai/policies/plan-task-completion.md")
    );
    const result = validate(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /^MISSING_RELEASE_FILE /);
  });
});

test("successor baseline pins exactly its 28 resources and rejects each unrecorded change", async () => {
  await withFixture(async (root) => {
    await validateInstructionBaseline(root);
    const baseline = await readBaseline<SuccessorBaseline>(
      root,
      SUCCESSOR_BASELINE
    );
    assert.equal(baseline.schema, "banzai-instruction-baseline/v2");
    assert.equal(baseline.schemaVersion, 2);
    assert.equal(
      baseline.predecessorBaselineSha256,
      resourceDigest(await readFile(path.join(root, CLOSED_BASELINE)))
    );
    assert.deepEqual(
      baseline.origin.authorities.map((authority) => authority.path),
      [INSTRUCTION_COPY_DECISION]
    );
    const keys = Object.keys(baseline.expectations);
    const moduleKeys = keys.filter((key) =>
      key.startsWith(`${INSTRUCTION_MODULE}#`)
    );
    assert.equal(keys.length, 28);
    assert.equal(moduleKeys.length, 24);
    assert.ok(moduleKeys.includes(`${INSTRUCTION_MODULE}#definitions`));
    assert.deepEqual(
      keys.filter((key) => !moduleKeys.includes(key)),
      [CLAUDE_MANIFEST, CODEX_MANIFEST, HOOK_CONFIGURATION, HOOK_SCRIPT]
    );
    // The committed file is the tool's own first generation of these bytes.
    assert.equal(
      (
        await initializeInstructionBaseline(
          root,
          {
            schema: "banzai-instruction-origin/v1",
            schemaVersion: 1,
            authorities: baseline.origin.authorities
          },
          { check: true }
        )
      ).sha256,
      (await readFile(path.join(root, SUCCESSOR_PIN), "utf8")).trim()
    );

    const expectDrift = async (
      relativePath: string,
      key: string,
      change: () => Promise<void>
    ) => {
      const target = path.join(root, relativePath);
      const original = await readFile(target);
      await change();
      await assert.rejects(validateInstructionBaseline(root), {
        message: `Unrecorded instruction resource drift: ${key}.`
      });
      await writeFile(target, original);
      await validateInstructionBaseline(root);
    };
    await expectDrift(
      INSTRUCTION_MODULE,
      `${INSTRUCTION_MODULE}#phases/review.md`,
      () =>
        rewriteInstructionModule(root, (_definitions, resources) => {
          const entry = requiredFixture(resources["phases/review.md"]);
          entry.text = `${entry.text ?? ""}\nFixture sentence.\n`;
          entry.sha256 = resourceDigest(entry.text);
        })
    );
    await expectDrift(
      INSTRUCTION_MODULE,
      `${INSTRUCTION_MODULE}#definitions`,
      () =>
        rewriteInstructionModule(root, (definitions) => {
          requiredFixture(definitions.review?.policies).reverse();
        })
    );
    await expectDrift(HOOK_SCRIPT, HOOK_SCRIPT, () =>
      appendFile(path.join(root, HOOK_SCRIPT), "// fixture\n")
    );
    await expectDrift(HOOK_CONFIGURATION, HOOK_CONFIGURATION, () =>
      appendFile(path.join(root, HOOK_CONFIGURATION), "\n")
    );
    for (const manifest of [CLAUDE_MANIFEST, CODEX_MANIFEST]) {
      await expectDrift(manifest, manifest, () =>
        mutateJson(root, manifest, (value) => {
          value.description = "Fixture description.";
        })
      );
      // ADR-0033 owns the version value, so it is outside the pinned image.
      await mutateJson(root, manifest, (value) => {
        value.version = "9.9.9";
      });
      await validateInstructionBaseline(root);
    }

    // Object key order of the phase table is not part of its image.
    await rewriteInstructionModule(root, (definitions) => {
      const { guidance, ...rest } = requiredFixture(definitions.review);
      definitions.review = { ...rest, guidance: requiredFixture(guidance) };
    });
    await validateInstructionBaseline(root);
    await rewriteInstructionModule(root, (_definitions, resources) => {
      const entry = requiredFixture(resources["phases/review.md"]);
      entry.text = `${entry.text ?? ""}\nUndigested sentence.\n`;
    });
    await assert.rejects(
      validateInstructionBaseline(root),
      /Frozen instruction entry differs from its digest: phases\/review\.md/
    );
  });
});

test("release validation rejects a changed pinned resource, sibling digest or closed baseline byte", async () => {
  await withFixture(async (root) => {
    const expectDrift = async (
      relativePath: string,
      reportedPath: string,
      change: (original: Buffer) => Buffer | string
    ) => {
      const target = path.join(root, relativePath);
      const original = await readFile(target);
      await writeFile(target, change(original));
      const result = validate(root);
      assert.equal(result.status, 1, relativePath);
      assert.ok(
        result.stderr.startsWith(
          `INSTRUCTION_RESOURCE_DRIFT ${reportedPath}: `
        ),
        result.stderr
      );
      await writeFile(target, original);
    };
    for (const relativePath of CLOSED_BASELINE_FILES)
      await expectDrift(relativePath, relativePath, (original) =>
        Buffer.concat([original, Buffer.from("\n")])
      );
    await expectDrift(
      SUCCESSOR_PIN,
      SUCCESSOR_BASELINE,
      () => "0".repeat(64) + "\n"
    );
    await expectDrift(SUCCESSOR_BASELINE, SUCCESSOR_BASELINE, (original) =>
      JSON.stringify(JSON.parse(original.toString("utf8")))
    );
    await expectDrift(INSTRUCTION_MODULE, SUCCESSOR_BASELINE, (original) =>
      original
        .toString("utf8")
        .replace("# Strict Planning Phase", "# Stale Planning Phase")
    );
    const result = validate(root);
    assert.equal(result.status, 0, result.stderr);
  });
});

test("directly authored guidance enters the baseline through a first transition with before: null", async () => {
  await withFixture(async (root) => {
    const key = "plugins/banzai/guidance/code-design.md";
    // The immutable root pins section digests for extracted guidance only, so a
    // directly authored resource has no predecessor image to record.
    const baseline = JSON.parse(
      await readFile(
        path.join(root, "packages/orchestrator/phase-guidance-baseline.json"),
        "utf8"
      )
    ) as { sources: { guidance: string }[] };
    assert.ok(
      !baseline.sources.some((entry) => entry.guidance === "code-design")
    );
    const current = JSON.parse(
      await readFile(
        path.join(root, "packages/orchestrator/phase-guidance-current.json"),
        "utf8"
      )
    ) as {
      expectations: Record<string, string>;
      transitions: { changes: { key: string; before: string | null }[] }[];
    };
    const introductions = current.transitions
      .flatMap((transition) => transition.changes)
      .filter((change) => change.key === key);
    assert.equal(introductions.length, 1);
    assert.equal(introductions[0]?.before, null);
    assert.ok(current.expectations[key]);
    await validateClosedGuidanceBaseline(root);
  });
});

test("release validation rejects a duplicated structural assessment trigger heading", async () => {
  await withFixture(async (root) => {
    const target = path.join(
      root,
      "plugins/banzai/policies/engineering-quality.md"
    );
    const source = await readFile(target, "utf8");
    await writeFile(
      target,
      source.replace(
        "### Structural Assessment Triggers\n",
        "### Structural Assessment Triggers\n\n### Structural Assessment Triggers\n"
      )
    );
    const result = validate(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /^CODE_DESIGN_POLICY_DRIFT /);
  });
});

test("release validation rejects a code-design method over its byte budget", async () => {
  await withFixture(async (root) => {
    const target = path.join(root, "plugins/banzai/guidance/code-design.md");
    const source = await readFile(target, "utf8");
    const padding = `\nBudget overflow padding. ${"x".repeat(2400)}\n`;
    await writeFile(target, source + padding);
    const result = validate(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /^CODE_DESIGN_METHOD_DRIFT /);
  });
});

test("release validation rejects a consumer skill missing its code-design anchors", async () => {
  await withFixture(async (root) => {
    const target = path.join(
      root,
      "plugins/banzai/skills/development-plan/SKILL.md"
    );
    const source = await readFile(target, "utf8");
    await writeFile(
      target,
      source.replace(
        "[Planning Assessment](../../guidance/code-design.md#planning-assessment)",
        "[Planning Assessment](../../guidance/planning.md#rules)"
      )
    );
    const result = validate(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /^CODE_DESIGN_CONSUMER_DRIFT /);
  });
});

test("release validation rejects audit instructions that reference the code-design method", async () => {
  await withFixture(async (root) => {
    const target = path.join(root, "plugins/banzai/guidance/review.md");
    const source = await readFile(target, "utf8");
    await writeFile(
      target,
      source.replace(
        "For an ADR-0050 structural assessment obligation,",
        "Read code-design.md, then for an ADR-0050 structural assessment obligation,"
      )
    );
    const result = validate(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /^CODE_DESIGN_CONSUMER_DRIFT /);
  });
});

test("successor baseline admits a hook configuration and manifest transition only under an Accepted authority", async () => {
  await withFixture(async (root) => {
    const closedFiles = await Promise.all(
      CLOSED_BASELINE_FILES.map((name) => readFile(path.join(root, name)))
    );
    const baselinePath = path.join(root, SUCCESSOR_BASELINE);
    const pinPath = path.join(root, SUCCESSOR_PIN);
    const initial = await readFile(baselinePath, "utf8");
    const initialPin = await readFile(pinPath, "utf8");
    const hookPath = path.join(root, HOOK_CONFIGURATION);
    await writeFile(
      hookPath,
      (await readFile(hookPath, "utf8")).replaceAll(
        "Edit|Write|MultiEdit",
        "Edit|Write|MultiEdit|Fixture"
      )
    );
    await mutateJson(root, CODEX_MANIFEST, (value) => {
      value.description = "Fixture description under the control model.";
    });
    await assert.rejects(
      validateInstructionBaseline(root),
      /Unrecorded instruction resource drift/
    );
    const authorization = await instructionAuthorization(
      root,
      CONTROL_MODEL_DECISION,
      "ADR 0069; fixture hook configuration and Codex manifest"
    );
    assert.deepEqual(authorization.scope, [CODEX_MANIFEST, HOOK_CONFIGURATION]);
    const authorizationPath = path.join(
      path.dirname(root),
      "authorization.json"
    );
    const tool = async (input: unknown, ...flags: string[]) => {
      await writeFile(authorizationPath, JSON.stringify(input));
      return runBaselineTool(
        root,
        "--authorization",
        authorizationPath,
        ...flags
      );
    };

    const decisionPath = path.join(root, CONTROL_MODEL_DECISION);
    const accepted = await readFile(decisionPath, "utf8");
    await writeFile(
      decisionPath,
      accepted.replace("- Status: Accepted", "- Status: Proposed")
    );
    const proposed = await tool({
      ...authorization,
      authorities: [
        await instructionAuthority(root, CONTROL_MODEL_DECISION, "ADR 0069")
      ]
    });
    assert.equal(proposed.status, 1);
    assert.match(
      proposed.stderr,
      /^INSTRUCTION_RESOURCE_DRIFT Instruction transition authority changed or is not Accepted\./
    );
    await writeFile(decisionPath, accepted);
    const unauthorized = await tool({ ...authorization, authorities: [] });
    assert.equal(unauthorized.status, 1);
    assert.match(unauthorized.stderr, /Missing accepted instruction/);
    await assert.rejects(
      evolveInstructionBaseline(root, {
        ...authorization,
        predecessorSha256: "0".repeat(64)
      }),
      /predecessor/
    );
    await assert.rejects(
      evolveInstructionBaseline(root, { ...authorization, scope: [] }),
      /exact scope/
    );
    assert.equal(await readFile(baselinePath, "utf8"), initial);

    const preview = await tool(authorization, "--check");
    assert.equal(preview.status, 0, preview.stderr);
    assert.equal(await readFile(baselinePath, "utf8"), initial);
    const published = await tool(authorization);
    assert.equal(published.status, 0, published.stderr);
    assert.equal(published.stdout, preview.stdout);
    await validateInstructionBaseline(root);
    const next = await readFile(baselinePath, "utf8");
    const nextPin = await readFile(pinPath, "utf8");
    assert.deepEqual(JSON.parse(published.stdout), {
      changed: true,
      sha256: resourceDigest(next)
    });
    assert.equal(
      (await evolveInstructionBaseline(root, authorization)).changed,
      false
    );
    const described = runBaselineTool(root, "--describe");
    assert.equal(described.status, 0, described.stderr);
    assert.deepEqual(
      (JSON.parse(described.stdout) as { changes: unknown[] }).changes,
      []
    );
    // The embedded hook digest follows the hook file through the build.
    const build = spawnSync(
      process.execPath,
      [path.join(root, "packages/orchestrator/scripts/build.mjs")],
      { cwd: path.join(root, "packages/orchestrator"), encoding: "utf8" }
    );
    assert.equal(build.status, 0, build.stderr);
    const result = validate(root);
    assert.equal(result.status, 0, result.stderr);

    // Simulate interruption after baseline replacement and before pin replacement.
    const journal = path.join(
      root,
      "packages/orchestrator/.instruction-baseline-transition.json"
    );
    await writeFile(pinPath, initialPin);
    await writeFile(
      journal,
      JSON.stringify({
        authorizationSha256: identity(authorization),
        previous: initial,
        next
      })
    );
    await assert.rejects(validateInstructionBaseline(root), /pin mismatch/);
    await evolveInstructionBaseline(root, authorization);
    assert.equal(await readFile(pinPath, "utf8"), nextPin);
    await assert.rejects(access(journal));

    const initialization = {
      schema: "banzai-instruction-origin/v1",
      schemaVersion: 1,
      authorities: authorization.authorities
    };
    await assert.rejects(
      initializeInstructionBaseline(root, initialization),
      /already holds a transition/
    );
    await writeFile(authorizationPath, JSON.stringify(initialization));
    const refused = runBaselineTool(root, "--initialize", authorizationPath);
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /already holds a transition/);
    assert.equal(await readFile(baselinePath, "utf8"), next);
    // With the chain put back to empty the authority rule still applies, and
    // no first generation is written over the changed resources.
    await writeFile(baselinePath, initial);
    await writeFile(pinPath, initialPin);
    await assert.rejects(
      initializeInstructionBaseline(root, {
        ...initialization,
        authorities: []
      }),
      /authority/
    );
    await assert.rejects(
      initializeInstructionBaseline(root, initialization),
      FIRST_GENERATION_REFUSAL
    );
    assert.equal(await readFile(baselinePath, "utf8"), initial);
    assert.equal(await readFile(pinPath, "utf8"), initialPin);
    assert.deepEqual(
      await Promise.all(
        CLOSED_BASELINE_FILES.map((name) => readFile(path.join(root, name)))
      ),
      closedFiles
    );
  });
});

test("release validation rejects a first generation written again over a changed text entry while the chain is empty", async () => {
  await withFixture(async (root) => {
    const baselinePath = path.join(root, SUCCESSOR_BASELINE);
    const pinPath = path.join(root, SUCCESSOR_PIN);
    const initial = await readFile(baselinePath, "utf8");
    const initialPin = await readFile(pinPath, "utf8");
    const baseline = await readBaseline<SuccessorBaseline>(
      root,
      SUCCESSOR_BASELINE
    );
    assert.deepEqual(baseline.transitions, []);
    const [key, digest] = await changeFrozenTextEntry(
      root,
      "policies/security-assurance.md"
    );
    assert.notEqual(baseline.expectations[key], digest);

    // The initializing form writes nothing, with or without its dry run.
    const originPath = await writeOriginFile(root, baseline.origin.authorities);
    for (const flags of [["--check"], []]) {
      const refused = runBaselineTool(
        root,
        "--initialize",
        originPath,
        ...flags
      );
      assert.equal(refused.status, 1, refused.stdout);
      assert.match(refused.stderr, FIRST_GENERATION_TOOL_REFUSAL);
      assert.equal(await readFile(baselinePath, "utf8"), initial);
      assert.equal(await readFile(pinPath, "utf8"), initialPin);
    }

    // The same first generation authored by hand, with a matching sibling
    // digest and a rebuilt distribution, is refused by the real validator.
    await writeFirstGeneration(root, baseline, { [key]: digest });
    await assert.rejects(
      validateInstructionBaseline(root),
      FIRST_GENERATION_REFUSAL
    );
    rebuildFixture(root);
    const result = validate(root);
    assert.equal(result.status, 1, result.stdout);
    assert.ok(
      result.stderr.startsWith(
        `INSTRUCTION_RESOURCE_DRIFT ${SUCCESSOR_BASELINE}: `
      ),
      result.stderr
    );
  });
});

test("release validation rejects a first generation written after a recorded chain was dropped", async () => {
  await withFixture(async (root) => {
    const baselinePath = path.join(root, SUCCESSOR_BASELINE);
    const pinPath = path.join(root, SUCCESSOR_PIN);
    await mutateJson(root, CODEX_MANIFEST, (value) => {
      value.description = "Fixture description under the control model.";
    });
    const authorization = await instructionAuthorization(
      root,
      CONTROL_MODEL_DECISION,
      "ADR 0069; fixture Codex manifest"
    );
    assert.deepEqual(authorization.scope, [CODEX_MANIFEST]);
    await evolveInstructionBaseline(root, authorization);
    const recorded = await readBaseline<SuccessorBaseline>(
      root,
      SUCCESSOR_BASELINE
    );
    assert.equal(recorded.transitions.length, 1);
    // Control: the chain on the pinned first generation validates.
    rebuildFixture(root);
    const accepted = validate(root);
    assert.equal(accepted.status, 0, accepted.stderr);

    const [key, digest] = await changeFrozenTextEntry(
      root,
      "policies/security-assurance.md"
    );
    const originPath = await writeOriginFile(root, recorded.origin.authorities);
    const held = runBaselineTool(root, "--initialize", originPath);
    assert.equal(held.status, 1, held.stdout);
    assert.match(held.stderr, /already holds a transition/);

    // Dropping the file and its sibling digest does not reopen the first
    // generation: the tool writes neither file and validation fails.
    await rm(baselinePath);
    await rm(pinPath);
    const refused = runBaselineTool(root, "--initialize", originPath);
    assert.equal(refused.status, 1, refused.stdout);
    assert.match(refused.stderr, FIRST_GENERATION_TOOL_REFUSAL);
    await assert.rejects(access(baselinePath));
    await assert.rejects(access(pinPath));
    const dropped = validate(root);
    assert.equal(dropped.status, 1, dropped.stdout);
    assert.ok(
      dropped.stderr.startsWith(
        `INSTRUCTION_RESOURCE_DRIFT ${SUCCESSOR_BASELINE}: `
      ),
      dropped.stderr
    );

    // A first generation of the current bytes, authored by hand with an empty
    // chain, a matching sibling digest and a rebuilt distribution, is refused.
    await writeFirstGeneration(root, recorded, { [key]: digest });
    await assert.rejects(
      validateInstructionBaseline(root),
      FIRST_GENERATION_REFUSAL
    );
    rebuildFixture(root);
    const result = validate(root);
    assert.equal(result.status, 1, result.stdout);
    assert.ok(
      result.stderr.startsWith(
        `INSTRUCTION_RESOURCE_DRIFT ${SUCCESSOR_BASELINE}: `
      ),
      result.stderr
    );
  });
});

test("successor chain replay refuses an unaccepted authority, a wrong predecessor, an unchanged value and unordered keys", async () => {
  await withFixture(async (root) => {
    const baseline = await readBaseline<SuccessorBaseline>(
      root,
      SUCCESSOR_BASELINE
    );
    const authorities = [
      await instructionAuthority(root, CONTROL_MODEL_DECISION, "ADR 0069")
    ];
    const replay = async (transition: InstructionTransition) => {
      await writePinnedBaseline(root, SUCCESSOR_BASELINE, SUCCESSOR_PIN, {
        ...baseline,
        transitions: [transition]
      });
      await validateInstructionBaseline(root);
    };
    const changes = {
      [CODEX_MANIFEST]: "1".repeat(64),
      [HOOK_CONFIGURATION]: "2".repeat(64)
    };
    const valid = instructionTransition(
      baseline.expectations,
      authorities,
      changes
    );
    // Control: the chain admits the step and only the recorded result is absent.
    await assert.rejects(
      replay(valid),
      /Unrecorded successor instruction expectations/
    );
    await assert.rejects(
      replay({ ...valid, authorities: [] }),
      /Missing accepted instruction transition authority/
    );
    await assert.rejects(
      replay({ ...valid, predecessorSha256: "0".repeat(64) }),
      /Invalid instruction transition predecessor/
    );
    await assert.rejects(
      replay({ ...valid, changes: [...valid.changes].reverse() }),
      /Invalid or protected instruction transition scope/
    );
    const [first] = valid.changes;
    assert.ok(first?.before);
    await assert.rejects(
      replay({ ...valid, changes: [{ ...first, after: first.before }] }),
      /Invalid or protected instruction transition scope/
    );
    await assert.rejects(
      replay({
        ...valid,
        changes: [
          {
            key: "plugins/banzai/skills/feature/SKILL.md",
            before: null,
            after: "4".repeat(64)
          }
        ]
      }),
      /Invalid or protected instruction transition scope/
    );
    const decisionPath = path.join(root, CONTROL_MODEL_DECISION);
    const accepted = await readFile(decisionPath, "utf8");
    await writeFile(
      decisionPath,
      accepted.replace("- Status: Accepted", "- Status: Proposed")
    );
    await assert.rejects(
      replay({
        ...valid,
        authorities: [
          await instructionAuthority(root, CONTROL_MODEL_DECISION, "ADR 0069")
        ]
      }),
      /authority changed or is not Accepted/
    );
    await writeFile(decisionPath, accepted);
    await writeFile(decisionPath, accepted + "\nUnaccepted decision body.\n");
    await assert.rejects(replay(valid), /authority changed or is not Accepted/);
  });
});

test("focused test driver terminates its child group and cleans output on interrupt", async () => {
  const environment = { ...process.env };
  delete environment.NODE_TEST_CONTEXT;
  const root = await mkdtemp(path.join(tmpdir(), "banzai-driver-interrupt-"));
  const tests = path.join(root, "test");
  const output = path.join(root, "output");
  const marker = path.join(root, "pid.json");
  await mkdir(tests);
  await writeFile(
    path.join(tests, "wait.test.ts"),
    `import test from 'node:test'; import { writeFileSync } from 'node:fs'; test('wait', async () => { writeFileSync(${JSON.stringify(marker)}, JSON.stringify(process.pid)); await new Promise(() => { setInterval(() => {}, 1000); }); });\n`
  );
  const child = spawn(
    process.execPath,
    [
      path.resolve("scripts/test.mjs"),
      "--test-root",
      tests,
      "--output-root",
      output,
      "--file",
      "wait.test.ts"
    ],
    { stdio: "ignore", env: environment }
  );
  const completion = new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  let pid: number | null = null;
  let alive = true;
  try {
    for (let count = 0; count < 100; count += 1) {
      try {
        pid = JSON.parse(await readFile(marker, "utf8")) as number;
        break;
      } catch {
        await delay(25);
      }
    }
    assert.ok(pid);
    child.kill("SIGTERM");
    assert.notEqual(await completion, 0);
    await assert.rejects(access(output));
    for (let count = 0; count < 100 && alive; count += 1) {
      try {
        process.kill(pid, 0);
        if (process.platform === "linux") {
          // Container PID 1 may leave terminated children as unreaped zombies.
          const stat = await readFile(`/proc/${pid}/stat`, "utf8");
          alive = stat.slice(stat.lastIndexOf(")") + 2).split(" ")[0] !== "Z";
        }
        if (alive) await delay(25);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "ESRCH" && code !== "ENOENT") throw error;
        alive = false;
      }
    }
    assert.equal(
      alive,
      false,
      "Selected child must be terminated with the driver."
    );
  } finally {
    child.kill("SIGKILL");
    if (pid !== null && alive) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // Best-effort cleanup must not replace the original test failure.
      }
    }
    await rm(root, { recursive: true, force: true });
  }
});

test("artifact reader generation resolves runtime reader edges to canonical source", async () => {
  await withFixture(async (root) => {
    const target = path.join(root, "plugins/banzai/lib/artifact-readers.mjs");
    const expected = await readFile(target, "utf8");
    await writeFile(
      target,
      "invalid previous generated output must never be consumed"
    );
    const generator = pathToFileURL(
      path.join(process.cwd(), "scripts/artifact-readers-build.mjs")
    ).href;
    const result = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `const { artifactReaderBytes } = await import(${JSON.stringify(generator)}); process.stdout.write(await artifactReaderBytes(process.argv[1]));`,
        path.join(root, "packages/orchestrator")
      ],
      { encoding: "utf8", maxBuffer: 2 * 1024 * 1024, timeout: 10000 }
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, expected);
    assert.equal(
      await readFile(target, "utf8"),
      "invalid previous generated output must never be consumed"
    );
  });
});

test("guided baseline amendment keeps accepted authority bodies pinned and rejects hidden lifecycle headings", async () => {
  await withFixture(async (root) => {
    await validateClosedGuidanceBaseline(root);
    const authority = path.join(
      root,
      "documentation/decisions/0043-proportionate-verification-evidence.md"
    );
    const original = await readFile(authority, "utf8");
    for (const extra of [
      " ARBITRARY AUTHORITY",
      "\n  ARBITRARY AUTHORITY",
      "\n\tARBITRARY AUTHORITY"
    ]) {
      await writeFile(
        authority,
        original.replace(
          "- Amended by [ADR-0045](./0045-guided-verification-setup.md), accepted",
          "- Amended by [ADR-0045](./0045-guided-verification-setup.md), accepted" +
            extra
        )
      );
      await assert.rejects(validateClosedGuidanceBaseline(root), /authority/u);
    }
    await writeFile(
      authority,
      original.replace(
        "Current profiles specify ordered commands.",
        "Current profiles may omit commands."
      )
    );
    await assert.rejects(validateClosedGuidanceBaseline(root), /authority/u);
    await writeFile(
      authority,
      original.replace(
        "- Amended by [ADR-0045](./0045-guided-verification-setup.md), accepted",
        "- Amended by [ADR-0045](./0045-guided-verification-setup.md), accepted\n## Hidden authority"
      )
    );
    await assert.rejects(validateClosedGuidanceBaseline(root), /authority/u);
  });
});

test("runner-owned completion annotations admit only the accepted reciprocal images and keep bodies pinned", async () => {
  await withFixture(async (root) => {
    await validateClosedGuidanceBaseline(root);
    const decisions = path.join(root, "documentation/decisions");
    const authority = path.join(
      decisions,
      "0043-proportionate-verification-evidence.md"
    );
    const original = await readFile(authority, "utf8");
    // The accepted body stays pinned beneath the ADR-0047 annotation.
    await writeFile(
      authority,
      original.replace(
        "Current profiles specify ordered commands.",
        "Current profiles may omit commands."
      )
    );
    await assert.rejects(validateClosedGuidanceBaseline(root), /authority/u);
    // The annotation image is finite: any other lifecycle wording fails.
    await writeFile(
      authority,
      original.replace(
        "- Narrowly amended by [ADR-0047]",
        "- Broadly amended by [ADR-0047]"
      )
    );
    await assert.rejects(validateClosedGuidanceBaseline(root), /authority/u);
    await writeFile(authority, original);
    // The image is admitted only while ADR-0047 remains Accepted.
    const amendment = path.join(
      decisions,
      "0047-runner-owned-completion-projection.md"
    );
    const accepted = await readFile(amendment, "utf8");
    assert.match(accepted, /^- Status: Accepted\s*$/mu);
    await writeFile(
      amendment,
      accepted.replace("- Status: Accepted", "- Status: Proposed")
    );
    await assert.rejects(validateClosedGuidanceBaseline(root), /authority/u);
    await writeFile(amendment, accepted);
    await validateClosedGuidanceBaseline(root);
    const proposal = await describeInstructionTransition(root);
    assert.match(proposal.predecessorSha256, /^[a-f0-9]{64}$/u);
  });
});

test("ADR-0054 lifecycle images require acceptance and reject arbitrary authority edits", async () => {
  await withFixture(async (root) => {
    await validateClosedGuidanceBaseline(root);
    const authority = path.join(
      root,
      "documentation/decisions/0049-task-scoped-verification.md"
    );
    const original = await readFile(authority, "utf8");
    for (const changed of [
      original.replace(
        "- Amended by [ADR-0054]",
        "- Broadly amended by [ADR-0054]"
      ),
      original + "\nUnaccepted body change.\n"
    ]) {
      assert.notEqual(changed, original);
      await writeFile(authority, changed);
      await assert.rejects(validateClosedGuidanceBaseline(root), /authority/u);
    }
    await writeFile(authority, original);
    const decision = path.join(
      root,
      "documentation/decisions/0054-git-visible-work-artifacts.md"
    );
    const accepted = await readFile(decision, "utf8");
    await writeFile(
      decision,
      accepted.replace("- Status: Accepted", "- Status: Proposed")
    );
    await assert.rejects(validateClosedGuidanceBaseline(root), /authority/u);
    await writeFile(decision, accepted);
    await validateClosedGuidanceBaseline(root);
  });
});

test("ADR-0055 admits only the exact accepted ADR-0054 lifecycle annotation", async () => {
  await withFixture(async (root) => {
    await validateClosedGuidanceBaseline(root);
    const authority = path.join(
      root,
      "documentation/decisions/0054-git-visible-work-artifacts.md"
    );
    const original = await readFile(authority, "utf8");
    for (const changed of [
      original.replace(
        "gains no role. Implementation is Planned.",
        "gains a role. Implementation is Planned."
      ),
      original + "\nUnaccepted decision body.\n"
    ]) {
      assert.notEqual(changed, original);
      await writeFile(authority, changed);
      await assert.rejects(validateClosedGuidanceBaseline(root), /authority/u);
    }
    await writeFile(authority, original);
    const amendment = path.join(
      root,
      "documentation/decisions/0055-planning-gate-rework-and-independent-planning-review.md"
    );
    const accepted = await readFile(amendment, "utf8");
    await writeFile(
      amendment,
      accepted.replace("- Status: Accepted", "- Status: Proposed")
    );
    await assert.rejects(validateClosedGuidanceBaseline(root), /authority/u);
    await writeFile(amendment, accepted);
    await validateClosedGuidanceBaseline(root);
  });
});

test("ADR-0057 and ADR-0058 admit only their exact accepted lifecycle annotations", async () => {
  await withFixture(async (root) => {
    await validateClosedGuidanceBaseline(root);
    for (const [authorityPath, amendmentPath, annotation] of [
      [
        "documentation/decisions/0045-guided-verification-setup.md",
        "documentation/decisions/0057-complete-task-verification-rounds.md",
        "legacy profile mode and fail-closed stops remain."
      ],
      [
        "documentation/decisions/0055-planning-gate-rework-and-independent-planning-review.md",
        "documentation/decisions/0058-human-plan-edits-rechecked-at-the-plan-gate.md",
        "Approval remains the only transition to `plan_approved`."
      ]
    ] as const) {
      const authority = path.join(root, authorityPath);
      const original = await readFile(authority, "utf8");
      for (const changed of [
        original.replace(annotation, "Other behaviour remains."),
        original + "\nUnaccepted decision body.\n"
      ]) {
        assert.notEqual(changed, original);
        await writeFile(authority, changed);
        await assert.rejects(
          validateClosedGuidanceBaseline(root),
          /authority/u
        );
      }
      await writeFile(authority, original);
      const amendment = path.join(root, amendmentPath);
      const accepted = await readFile(amendment, "utf8");
      await writeFile(
        amendment,
        accepted.replace("- Status: Accepted", "- Status: Proposed")
      );
      await assert.rejects(validateClosedGuidanceBaseline(root), /authority/u);
      await writeFile(amendment, accepted);
      await validateClosedGuidanceBaseline(root);
    }
  });
});

test("ADR-0061 admits only its exact accepted ADR-0054 lifecycle annotation", async () => {
  await withFixture(async (root) => {
    await validateClosedGuidanceBaseline(root);
    const authority = path.join(
      root,
      "documentation/decisions/0054-git-visible-work-artifacts.md"
    );
    const original = await readFile(authority, "utf8");
    for (const changed of [
      original.replace(
        "Work directories stay flat.",
        "Other behaviour remains."
      ),
      original + "\nUnaccepted decision body.\n"
    ]) {
      assert.notEqual(changed, original);
      await writeFile(authority, changed);
      await assert.rejects(validateClosedGuidanceBaseline(root), /authority/u);
    }
    await writeFile(authority, original);
    const amendment = path.join(
      root,
      "documentation/decisions/0061-initiative-skill-and-documents.md"
    );
    const accepted = await readFile(amendment, "utf8");
    await writeFile(
      amendment,
      accepted.replace("- Status: Accepted", "- Status: Proposed")
    );
    await assert.rejects(validateClosedGuidanceBaseline(root), /authority/u);
    await writeFile(amendment, accepted);
    await validateClosedGuidanceBaseline(root);
  });
});

test("ADR-0064 admits only its exact accepted ADR-0058 lifecycle annotation", async () => {
  await withFixture(async (root) => {
    await validateClosedGuidanceBaseline(root);
    const authority = path.join(
      root,
      "documentation/decisions/0058-human-plan-edits-rechecked-at-the-plan-gate.md"
    );
    const original = await readFile(authority, "utf8");
    for (const changed of [
      original.replace(
        "approval's refusal to rewrite remain. Implementation is Planned.",
        "Other behaviour remains."
      ),
      original + "\nUnaccepted decision body.\n"
    ]) {
      assert.notEqual(changed, original);
      await writeFile(authority, changed);
      await assert.rejects(validateClosedGuidanceBaseline(root), /authority/u);
    }
    await writeFile(authority, original);
    const amendment = path.join(
      root,
      "documentation/decisions/0064-runner-recorded-plan-remainder-digest.md"
    );
    const accepted = await readFile(amendment, "utf8");
    await writeFile(
      amendment,
      accepted.replace("- Status: Accepted", "- Status: Proposed")
    );
    await assert.rejects(validateClosedGuidanceBaseline(root), /authority/u);
    await writeFile(amendment, accepted);
    await validateClosedGuidanceBaseline(root);
  });
});

test("ADR-0066 admits only its exact accepted ADR-0054 lifecycle annotation", async () => {
  await withFixture(async (root) => {
    await validateClosedGuidanceBaseline(root);
    const authority = path.join(
      root,
      "documentation/decisions/0054-git-visible-work-artifacts.md"
    );
    const original = await readFile(authority, "utf8");
    for (const changed of [
      original.replace(
        "required name prefix. Existing directories keep their names.",
        "Other behaviour remains."
      ),
      original + "\nUnaccepted decision body.\n"
    ]) {
      assert.notEqual(changed, original);
      await writeFile(authority, changed);
      await assert.rejects(validateClosedGuidanceBaseline(root), /authority/u);
    }
    await writeFile(authority, original);
    const amendment = path.join(
      root,
      "documentation/decisions/0066-date-prefixed-work-and-initiative-slugs.md"
    );
    const accepted = await readFile(amendment, "utf8");
    await writeFile(
      amendment,
      accepted.replace("- Status: Accepted", "- Status: Proposed")
    );
    await assert.rejects(validateClosedGuidanceBaseline(root), /authority/u);
    await writeFile(amendment, accepted);
    await validateClosedGuidanceBaseline(root);
  });
});

test("ADR-0069 admits only its exact accepted ADR-0062 lifecycle annotation", async () => {
  await withFixture(async (root) => {
    await validateClosedGuidanceBaseline(root);
    const authority = path.join(
      root,
      "documentation/decisions/0062-claude-memory-notes-in-the-manual-hook-gate.md"
    );
    const original = await readFile(authority, "utf8");
    for (const changed of [
      original.replace(
        "the bookkeeping scope and the per-session marker remain.",
        "Other behaviour remains."
      ),
      original + "\nUnaccepted decision body.\n"
    ]) {
      assert.notEqual(changed, original);
      await writeFile(authority, changed);
      await assert.rejects(validateClosedGuidanceBaseline(root), /authority/u);
    }
    await writeFile(authority, original);
    const amendment = path.join(
      root,
      "documentation/decisions/0069-standalone-plugin-control-model.md"
    );
    const accepted = await readFile(amendment, "utf8");
    await writeFile(
      amendment,
      accepted.replace("- Status: Accepted", "- Status: Proposed")
    );
    await assert.rejects(validateClosedGuidanceBaseline(root), /authority/u);
    await writeFile(amendment, accepted);
    await validateClosedGuidanceBaseline(root);
  });
});

test("ADR-0070 admits only its exact accepted ADR-0044 lifecycle annotation", async () => {
  await withFixture(async (root) => {
    await validateClosedGuidanceBaseline(root);
    const authority = path.join(
      root,
      "documentation/decisions/0044-instruction-baseline-evolution.md"
    );
    const original = await readFile(authority, "utf8");
    for (const changed of [
      original.replace(
        "admits transitions for the hook configuration and the manifests.",
        "Other behaviour remains."
      ),
      original + "\nUnaccepted decision body.\n"
    ]) {
      assert.notEqual(changed, original);
      await writeFile(authority, changed);
      await assert.rejects(validateClosedGuidanceBaseline(root), /authority/u);
    }
    await writeFile(authority, original);
    const amendment = path.join(
      root,
      "documentation/decisions/0070-orchestrator-owned-instruction-copy.md"
    );
    const accepted = await readFile(amendment, "utf8");
    await writeFile(
      amendment,
      accepted.replace("- Status: Accepted", "- Status: Proposed")
    );
    await assert.rejects(validateClosedGuidanceBaseline(root), /authority/u);
    await writeFile(amendment, accepted);
    await validateClosedGuidanceBaseline(root);
  });
});

test("closed chain keeps its key protections and its files stay pinned by the validator", async () => {
  await withFixture(async (root) => {
    const closedBaseline = await readBaseline<ClosedBaseline>(
      root,
      CLOSED_BASELINE
    );
    const replay = async (authorityPath: string, key: string) => {
      const transition = instructionTransition(
        closedBaseline.expectations,
        [await instructionAuthority(root, authorityPath, "Fixture authority")],
        { [key]: "3".repeat(64) }
      );
      const next = {
        ...closedBaseline,
        expectations: sortedExpectations({
          ...closedBaseline.expectations,
          [key]: "3".repeat(64)
        }),
        transitions: [...closedBaseline.transitions, transition]
      };
      await writePinnedBaseline(
        root,
        CLOSED_BASELINE,
        CLOSED_BASELINE_PIN,
        next
      );
      await validateClosedGuidanceBaseline(root);
    };
    const retained =
      "plugins/banzai/skills/architecture-decision/SKILL.md#orchestrated";
    await assert.rejects(
      replay(
        "documentation/decisions/0044-instruction-baseline-evolution.md",
        retained
      ),
      /protected instruction transition scope/u
    );
    // The successor admits these keys; the closed chain still does not.
    for (const key of [HOOK_CONFIGURATION, CODEX_MANIFEST])
      await assert.rejects(
        replay(CONTROL_MODEL_DECISION, key),
        /protected instruction transition scope/u
      );
    await replay(
      "documentation/decisions/0055-planning-gate-rework-and-independent-planning-review.md",
      retained
    );
    // A chain that replays is still not the closed record.
    const result = validate(root);
    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /^INSTRUCTION_RESOURCE_DRIFT packages\/orchestrator\/phase-guidance-current\.json: /
    );
  });
});

test("planning review contract pins reject schema, manifest and release-policy drift", async () => {
  await withFixture(async (root) => {
    assert.equal(validate(root).status, 0);
    for (const family of ["result", "analysis"]) {
      const relative = `plugins/banzai/contracts/v1/planning-review-${family}.schema.json`;
      const target = path.join(root, relative);
      const original = await readFile(target, "utf8");
      for (const mutate of [
        (value: Record<string, unknown>) => {
          value.$id = "https://invalid.local/schema.json";
        },
        (value: Record<string, unknown>) => {
          (value.properties as Record<string, { const: unknown }>).schema = {
            const: "invalid-schema"
          };
        },
        (value: Record<string, unknown>) => {
          (
            value.properties as Record<string, { const: unknown }>
          ).schemaVersion = { const: 2 };
        },
        (value: Record<string, unknown>) => {
          (
            value.properties as Record<string, { const: unknown }>
          ).contractVersion = { const: "2.0.0" };
        }
      ]) {
        await mutateJson(root, relative, mutate);
        const result = validate(root);
        assert.notEqual(result.status, 0);
        assert.match(
          result.stderr,
          /CONTRACT_POLICY_DRIFT|CONTRACT_VERSION_MISMATCH/u
        );
        await writeFile(target, original);
      }
    }
    const policyPath = path.join(root, "release-policy.json");
    const originalPolicy = await readFile(policyPath, "utf8");
    await mutateJson(
      root,
      "release-policy.json",
      (value: Record<string, unknown>) => {
        const contracts = value.contracts as Record<
          string,
          Record<string, unknown>
        >;
        const planning = requiredFixture(contracts.planningReview);
        planning.resultSchemaVersion = 2;
      }
    );
    assert.match(validate(root).stderr, /CONTRACT_POLICY_DRIFT/u);
    await writeFile(policyPath, originalPolicy);
    await mutateJson(
      root,
      "plugins/banzai/contracts/contract.json",
      (value: Record<string, unknown>) => {
        (value.schemas as Record<string, unknown>).planningReviewResult =
          "./v2/review-result.schema.json";
      }
    );
    assert.match(validate(root).stderr, /INVALID_CONTRACT_REFERENCE/u);
  });
});
