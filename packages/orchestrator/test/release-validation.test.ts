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
  phaseResourceBytes,
  validateGuidanceExtraction,
  describeGuidanceTransition,
  evolveGuidanceBaseline,
  resourceDigest
} from "../scripts/phase-resources-build.mjs";
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
  "packages/orchestrator/phase-guidance-baseline.json",
  "packages/orchestrator/phase-guidance-current.json",
  "packages/orchestrator/phase-guidance-current.sha256",
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

test("phase resources reject byte skew and missing generated source without repairing the candidate", async () => {
  await withFixture(async (root) => {
    await checkPhaseResourceBytes(root);
    const generatedPath = path.join(
      root,
      "packages/orchestrator/src/phase-resources.ts"
    );
    const original = await readFile(generatedPath);
    const resourcePath = path.join(root, "plugins/banzai/phases/review.md");
    const resource = await readFile(resourcePath);
    await writeFile(resourcePath, Buffer.concat([resource, Buffer.from("\n")]));
    assert.notEqual(await phaseResourceBytes(root), original.toString("utf8"));
    await assert.rejects(
      checkPhaseResourceBytes(root),
      /src\/phase-resources.ts is missing or stale.*npm run build/
    );
    assert.deepEqual(await readFile(generatedPath), original);
    await writeFile(resourcePath, resource);
    await unlink(generatedPath);
    await assert.rejects(
      checkPhaseResourceBytes(root),
      /src\/phase-resources.ts is missing or stale/
    );
    await assert.rejects(access(generatedPath));
    await writeFile(
      generatedPath,
      original
        .toString("utf8")
        .replace("# Strict Planning Phase", "# Stale Planning Phase")
    );
    await assert.rejects(
      checkPhaseResourceBytes(root),
      /src\/phase-resources.ts is missing or stale/
    );
  });
});

test("phase resource generation rejects absent invalid and escaping input with bounded diagnostics", async () => {
  await withFixture(async (root) => {
    const target = path.join(root, "plugins/banzai/phases/review.md");
    const original = await readFile(target);
    for (const invalid of [
      Buffer.alloc(0),
      Buffer.from(" \n"),
      Buffer.from([0xff])
    ]) {
      await writeFile(target, invalid);
      await assert.rejects(
        phaseResourceBytes(root),
        /Instruction resource phases\/review.md is missing, unreadable, unsafe or invalid UTF-8/
      );
    }
    await unlink(target);
    await assert.rejects(
      phaseResourceBytes(root),
      /Instruction resource phases\/review.md/
    );
    const outside = path.join(path.dirname(root), "private-canary.md");
    await writeFile(outside, "PRIVATE_RESOURCE_CONTENT_CANARY");
    await symlink(outside, target);
    await assert.rejects(phaseResourceBytes(root), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.doesNotMatch(
        error.message,
        /PRIVATE_RESOURCE_CONTENT_CANARY|private-canary|banzai-release-fixture/
      );
      return /phases\/review.md/.test(error.message);
    });
    await unlink(target);
    await writeFile(target, original);
  });
});

test("shared guidance preserves the frozen extraction and conditional consumer duties", async () => {
  await withFixture(async (root) => {
    await validateGuidanceExtraction(root);
    const target = path.join(root, "plugins/banzai/guidance/fix.md");
    const original = await readFile(target, "utf8");
    await writeFile(
      target,
      original.replace("fixes a documented bug", "optionally documents bugs")
    );
    await assert.rejects(
      validateGuidanceExtraction(root),
      /Shared guidance or consumer drift: fix\/Report Rule/
    );
    await writeFile(target, original.replaceAll("\n", "\n\n"));
    await validateGuidanceExtraction(root);
    await writeFile(target, original);
    const sourcePath = path.join(
      root,
      "plugins/banzai/skills/quick-fix/SKILL.md"
    );
    const source = await readFile(sourcePath, "utf8");
    await writeFile(
      sourcePath,
      source.replace("## Orchestrated Mode", "## Changed Mode")
    );
    await assert.rejects(
      validateGuidanceExtraction(root),
      /Non-enumerated skill change|Retained Orchestrated Mode/
    );
    await writeFile(sourcePath, source);
    const policyPath = path.join(
      root,
      "plugins/banzai/policies/security-assurance.md"
    );
    const policySource = await readFile(policyPath, "utf8");
    await writeFile(
      policyPath,
      policySource.replace("implementation (conditional)", "implementation")
    );
    await assert.rejects(
      validateGuidanceExtraction(root),
      /Runner policy consumer drift: policies\/security-assurance.md/
    );
    await writeFile(
      policyPath,
      policySource.replace(
        "planning, implementation",
        "selection, planning, implementation"
      )
    );
    await assert.rejects(
      validateGuidanceExtraction(root),
      /Runner policy consumer drift/
    );
    await writeFile(policyPath, policySource);
    const extra = path.join(root, "plugins/banzai/phases/selection.md");
    await writeFile(extra, "Do not add a selection resource.");
    await assert.rejects(
      validateGuidanceExtraction(root),
      /Unexpected instruction resource inventory/
    );
    await unlink(extra);
    await writeFile(target, "Injected extra preface.\n" + original);
    await assert.rejects(
      validateGuidanceExtraction(root),
      /Non-enumerated guidance preface/
    );
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
    await validateGuidanceExtraction(root);
    const stale = validate(root);
    assert.equal(stale.status, 1);
    assert.match(stale.stderr, /^STALE_DISTRIBUTION /);
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

test("release validation preserves frozen skill source bytes even for a normalized policy reference rewrap", async () => {
  await withFixture(async (root) => {
    const target = path.join(
      root,
      "plugins/banzai/skills/feature-description/SKILL.md"
    );
    const contents = await readFile(target, "utf8");
    await writeFile(
      target,
      replacePolicyFragment(
        contents,
        "canonical Engineering Quality policy in the installed `policies/engineering-quality.md`",
        "canonical Engineering Quality\n  policy in the installed `policies/engineering-quality.md`"
      ),
      "utf8"
    );
    const result = validate(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /^INSTRUCTION_RESOURCE_DRIFT /);
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
    "Five existing human decision gates remain distinct"
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

test("release validation protects run-state v3-v10 and agent-control 8.0 identities", async () => {
  await withFixture(async (root) => {
    const typesPath = path.join(root, "packages/orchestrator/src/types.ts");
    const accepted = await readFile(typesPath, "utf8");
    await writeFile(
      typesPath,
      accepted.replace(
        "schemaVersion: 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;",
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
        '"banzai-agent-status/v6" as const',
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
  ["plugins/banzai/skills/orchestrate/SKILL.md", "banzai control capabilities"],
  [
    "plugins/banzai/skills/orchestrate/SKILL.md",
    "disable-model-invocation: true"
  ],
  [
    "plugins/banzai/skills/orchestrate/SKILL.md",
    "never select it from prompt wording alone"
  ],
  [
    "plugins/banzai/skills/orchestrate/SKILL.md",
    "only when the user invokes it explicitly by name"
  ],
  [
    "plugins/banzai/skills/orchestrate/agents/openai.yaml",
    "allow_implicit_invocation: false"
  ],
  [
    "plugins/banzai/skills/orchestrate/SKILL.md",
    "with writable stdin, write the complete document"
  ],
  [
    "plugins/banzai/skills/orchestrate/SKILL.md",
    "exact supported v8 declaration"
  ],
  ["plugins/banzai/skills/orchestrate/SKILL.md", "banzai-agent-answer/v2"],
  [
    "plugins/banzai/skills/orchestrate/SKILL.md",
    "Never select, infer, rewrite"
  ],
  [
    "plugins/banzai/skills/orchestrate/SKILL.md",
    "A consultation answer records preference provenance only."
  ],
  [
    "plugins/banzai/skills/orchestrate/SKILL.md",
    "A terminal `done` or `cancelled` projection does not block a new run."
  ],
  [
    "plugins/banzai/skills/orchestrate/references/control-protocol.md",
    "| `approve_plan` |"
  ],
  [
    "plugins/banzai/skills/orchestrate/references/control-protocol.md",
    "banzai-agent-capabilities/v8"
  ],
  [
    "plugins/banzai/skills/orchestrate/references/control-protocol.md",
    'controlContractVersion: "8.0.0"'
  ],
  [
    "plugins/banzai/skills/orchestrate/references/control-protocol.md",
    "| `answer_consultation` |"
  ],
  [
    "plugins/banzai/skills/orchestrate/references/control-protocol.md",
    "live-session/write-stdin mechanism"
  ],
  [
    "plugins/banzai/skills/orchestrate/references/control-protocol.md",
    "Only a non-terminal `activeRun` blocks `control start`."
  ],
  [
    "plugins/banzai/skills/orchestrate/references/control-protocol.md",
    "| `recover` |"
  ],
  ["plugins/banzai/skills/orchestrate/SKILL.md", "banzai-agent-recovery/v1"],
  [
    "plugins/banzai/skills/orchestrate/SKILL.md",
    "Never convert a `null` completion count to zero"
  ]
] as const) {
  test(`release validation protects orchestration policy in ${relativePath}`, async () => {
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
      assert.match(result.stderr, /^ORCHESTRATE_SKILL_POLICY_DRIFT /);
    });
  });
}

test("release policy pins Git-capable Node images", async () => {
  const policy = JSON.parse(
    await readFile(path.join(REPOSITORY_ROOT, "release-policy.json"), "utf8")
  ) as {
    node: {
      supported: { image: string }[];
      forward: { image: string };
    };
  };
  for (const lane of [...policy.node.supported, policy.node.forward]) {
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
  ["plugins/banzai/skills/orchestrate/SKILL.md", "MISSING_RELEASE_FILE"],
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
  await withFixture(async (root) => {
    const ciPath = path.join(root, ".github/workflows/ci.yml");
    const accepted = await readFile(ciPath, "utf8");
    for (const [before, after, code] of [
      [
        "  pull_request:\n",
        "  push:\n    branches: [main]\n  pull_request:\n",
        "CI_POLICY_DRIFT"
      ],
      [
        '    - cron: "17 5 * * 1"',
        '    - cron: "17 5 * * *"',
        "CI_POLICY_DRIFT"
      ],
      ['  schedule:\n    - cron: "17 5 * * 1"\n', "", "CI_POLICY_DRIFT"],
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
        "    if: github.event_name != 'schedule'\n",
        "    if: always()\n",
        "CI_POLICY_DRIFT"
      ],
      // A more-indented line continues the plain-scalar condition.
      [
        "    if: github.event_name != 'schedule'\n",
        "    if: github.event_name != 'schedule'\n      || true\n",
        "CI_POLICY_DRIFT"
      ],
      [
        "      - run: npm run release:check\n",
        "      - run: npm run release:check\n        if: false\n",
        "CI_POLICY_DRIFT"
      ],
      // A quoted key is the same condition in another YAML spelling (review-3 F1).
      [
        "      - run: npm run release:check\n",
        "      - run: npm run release:check\n        \"if\": github.event_name != 'pull_request'\n",
        "CI_POLICY_DRIFT"
      ],
      ["      - uses: actions/upload-artifact@v7\n", "", "CI_POLICY_DRIFT"],
      [
        "    if: github.event_name != 'pull_request'",
        "    if: github.event_name != 'schedule'",
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
        "  release_check_node_22:\n    needs: forward_compatibility_node_26\n",
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
        "      (needs.release_check_node_22.result == 'success' && needs.release_check_node_24.result == 'success'))",
        "      (needs.release_check_node_24.result == 'success'))"
      ],
      // Appended disjunctions, also after a blank line inside the folded
      // scalar, would admit publication without any gate (review-2 F1).
      [
        "      (needs.release_check_node_22.result == 'success' && needs.release_check_node_24.result == 'success'))\n",
        "      (needs.release_check_node_22.result == 'success' && needs.release_check_node_24.result == 'success'))\n      || true\n"
      ],
      [
        "      (needs.release_check_node_22.result == 'success' && needs.release_check_node_24.result == 'success'))\n",
        "      (needs.release_check_node_22.result == 'success' && needs.release_check_node_24.result == 'success'))\n\n      || true\n"
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

test("directly authored guidance is covered by a raw key and drifts without a transition", async () => {
  await withFixture(async (root) => {
    const target = path.join(root, "plugins/banzai/guidance/code-design.md");
    const source = await readFile(target, "utf8");
    await writeFile(
      target,
      source.replace("## Ownership Discovery", "## Ownership discovery")
    );
    const result = validate(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /^INSTRUCTION_RESOURCE_DRIFT /);
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
    await validateGuidanceExtraction(root);
  });
});

// Any instruction-resource edit drifts the baseline first, so a negative case
// for the ADR-0050 checks must record its own authorized transition to reach
// them.
const withAuthorizedInstructionEdit = async (
  root: string,
  edit: () => Promise<void>
) => {
  await edit();
  const proposal = await describeGuidanceTransition(root);
  const authorityPath =
    "documentation/decisions/0050-triggered-code-design-assessment.md";
  await evolveGuidanceBaseline(root, {
    schema: "banzai-instruction-authorization/v1",
    schemaVersion: 1,
    predecessorSha256: proposal.predecessorSha256,
    authorities: [
      {
        path: authorityPath,
        sha256: resourceDigest(await readFile(path.join(root, authorityPath))),
        scope: "ADR 0050 section 8; fixture negative case"
      }
    ],
    scope: proposal.changes.map((change) => change.key)
  });
  await validateGuidanceExtraction(root);
};

test("release validation rejects a duplicated structural assessment trigger heading", async () => {
  await withFixture(async (root) => {
    const target = path.join(
      root,
      "plugins/banzai/policies/engineering-quality.md"
    );
    await withAuthorizedInstructionEdit(root, async () => {
      const source = await readFile(target, "utf8");
      await writeFile(
        target,
        source.replace(
          "### Structural Assessment Triggers\n",
          "### Structural Assessment Triggers\n\n### Structural Assessment Triggers\n"
        )
      );
    });
    const result = validate(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /^CODE_DESIGN_POLICY_DRIFT /);
  });
});

test("release validation rejects a code-design method over its byte budget", async () => {
  await withFixture(async (root) => {
    const target = path.join(root, "plugins/banzai/guidance/code-design.md");
    await withAuthorizedInstructionEdit(root, async () => {
      const source = await readFile(target, "utf8");
      const padding = `\nBudget overflow padding. ${"x".repeat(2400)}\n`;
      await writeFile(target, source + padding);
    });
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
    await withAuthorizedInstructionEdit(root, async () => {
      const source = await readFile(target, "utf8");
      await writeFile(
        target,
        source.replace(
          "[Planning Assessment](../../guidance/code-design.md#planning-assessment)",
          "[Planning Assessment](../../guidance/planning.md#rules)"
        )
      );
    });
    const result = validate(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /^CODE_DESIGN_CONSUMER_DRIFT /);
  });
});

test("release validation rejects audit instructions that reference the code-design method", async () => {
  await withFixture(async (root) => {
    const target = path.join(root, "plugins/banzai/guidance/review.md");
    await withAuthorizedInstructionEdit(root, async () => {
      const source = await readFile(target, "utf8");
      await writeFile(
        target,
        source.replace(
          "For an ADR-0050 structural assessment obligation,",
          "Read code-design.md, then for an ADR-0050 structural assessment obligation,"
        )
      );
    });
    const result = validate(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /^CODE_DESIGN_CONSUMER_DRIFT /);
  });
});

test("instruction baseline evolves only an exact authorized scope and retains its immutable root", async () => {
  await withFixture(async (root) => {
    const originalPath = path.join(
      root,
      "packages/orchestrator/phase-guidance-baseline.json"
    );
    const original = await readFile(originalPath);
    const currentPath = path.join(
      root,
      "packages/orchestrator/phase-guidance-current.json"
    );
    const pinPath = path.join(
      root,
      "packages/orchestrator/phase-guidance-current.sha256"
    );
    const initial = await readFile(currentPath, "utf8");
    const initialPin = await readFile(pinPath, "utf8");
    const target = path.join(root, "plugins/banzai/guidance/fix.md");
    const source = await readFile(target, "utf8");
    await writeFile(
      target,
      source.replace(
        "Use one compact closure record",
        "Use one bounded compact closure record"
      )
    );
    await assert.rejects(
      validateGuidanceExtraction(root),
      /Shared guidance or consumer drift/
    );
    const proposal = await describeGuidanceTransition(root);
    const authorityPath =
      "documentation/decisions/0044-instruction-baseline-evolution.md";
    const authorization = {
      schema: "banzai-instruction-authorization/v1",
      schemaVersion: 1,
      predecessorSha256: proposal.predecessorSha256,
      authorities: [
        {
          path: authorityPath,
          sha256: resourceDigest(
            await readFile(path.join(root, authorityPath))
          ),
          scope: "ADR 0044 section 2; fixture bounded closure wording"
        }
      ],
      scope: proposal.changes.map((change) => change.key)
    };
    assert.deepEqual(authorization.scope, [
      "plugins/banzai/guidance/fix.md#section:Change Report"
    ]);
    const preview = await evolveGuidanceBaseline(root, authorization, {
      check: true
    });
    assert.equal(preview.changed, true);
    assert.equal(await readFile(currentPath, "utf8"), initial);
    await assert.rejects(
      evolveGuidanceBaseline(root, { ...authorization, scope: [] }),
      /exact scope/
    );
    await assert.rejects(
      evolveGuidanceBaseline(root, {
        ...authorization,
        predecessorSha256: "0".repeat(64)
      }),
      /predecessor/
    );
    await assert.rejects(
      evolveGuidanceBaseline(root, { ...authorization, authorities: [] }),
      /authority/
    );
    await evolveGuidanceBaseline(root, authorization);
    await validateGuidanceExtraction(root);
    assert.equal(
      (await evolveGuidanceBaseline(root, authorization)).changed,
      false
    );
    const next = await readFile(currentPath, "utf8");
    const nextPin = await readFile(pinPath, "utf8");
    assert.equal(resourceDigest(next), preview.sha256);
    assert.deepEqual(await readFile(originalPath), original);
    // Simulate interruption after baseline replacement and before pin replacement.
    const journal = path.join(
      root,
      "packages/orchestrator/.phase-guidance-transition.json"
    );
    await writeFile(pinPath, initialPin);
    await writeFile(
      journal,
      JSON.stringify({
        authorizationSha256: resourceDigest(JSON.stringify(authorization)),
        previous: initial,
        next
      })
    );
    await assert.rejects(validateGuidanceExtraction(root), /pin mismatch/);
    await evolveGuidanceBaseline(root, authorization);
    assert.equal(await readFile(pinPath, "utf8"), nextPin);
    await assert.rejects(access(journal));
    const corrupt = JSON.parse(next) as {
      transitions: { predecessorSha256: string }[];
    };
    requiredFixture(corrupt.transitions.at(-1)).predecessorSha256 = "0".repeat(
      64
    );
    const corruptBytes = JSON.stringify(corrupt, null, 2) + "\n";
    await writeFile(currentPath, corruptBytes);
    await writeFile(pinPath, resourceDigest(corruptBytes) + "\n");
    await assert.rejects(validateGuidanceExtraction(root), /predecessor/);
    await writeFile(currentPath, next);
    await writeFile(pinPath, nextPin);
    const retained = path.join(
      root,
      "plugins/banzai/skills/quick-fix/SKILL.md"
    );
    await writeFile(
      retained,
      (await readFile(retained, "utf8")).replace(
        "## Orchestrated Mode",
        "## Replaced Mode"
      )
    );
    await assert.rejects(describeGuidanceTransition(root), /Orchestrated Mode/);
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
    await validateGuidanceExtraction(root);
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
      await assert.rejects(validateGuidanceExtraction(root), /authority/u);
    }
    await writeFile(
      authority,
      original.replace(
        "Current profiles specify ordered commands.",
        "Current profiles may omit commands."
      )
    );
    await assert.rejects(validateGuidanceExtraction(root), /authority/u);
    await writeFile(
      authority,
      original.replace(
        "- Amended by [ADR-0045](./0045-guided-verification-setup.md), accepted",
        "- Amended by [ADR-0045](./0045-guided-verification-setup.md), accepted\n## Hidden authority"
      )
    );
    await assert.rejects(validateGuidanceExtraction(root), /authority/u);
  });
});

test("runner-owned completion annotations admit only the accepted reciprocal images and keep bodies pinned", async () => {
  await withFixture(async (root) => {
    await validateGuidanceExtraction(root);
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
    await assert.rejects(validateGuidanceExtraction(root), /authority/u);
    // The annotation image is finite: any other lifecycle wording fails.
    await writeFile(
      authority,
      original.replace(
        "- Narrowly amended by [ADR-0047]",
        "- Broadly amended by [ADR-0047]"
      )
    );
    await assert.rejects(validateGuidanceExtraction(root), /authority/u);
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
    await assert.rejects(validateGuidanceExtraction(root), /authority/u);
    await writeFile(amendment, accepted);
    await validateGuidanceExtraction(root);
    const proposal = await describeGuidanceTransition(root);
    assert.match(proposal.predecessorSha256, /^[a-f0-9]{64}$/u);
  });
});

test("ADR-0054 lifecycle images require acceptance and reject arbitrary authority edits", async () => {
  await withFixture(async (root) => {
    await validateGuidanceExtraction(root);
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
      await assert.rejects(validateGuidanceExtraction(root), /authority/u);
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
    await assert.rejects(validateGuidanceExtraction(root), /authority/u);
    await writeFile(decision, accepted);
    await validateGuidanceExtraction(root);
  });
});

test("ADR-0055 admits only the exact accepted ADR-0054 lifecycle annotation", async () => {
  await withFixture(async (root) => {
    await validateGuidanceExtraction(root);
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
      await assert.rejects(validateGuidanceExtraction(root), /authority/u);
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
    await assert.rejects(validateGuidanceExtraction(root), /authority/u);
    await writeFile(amendment, accepted);
    await validateGuidanceExtraction(root);
  });
});

test("ADR-0055 authorizes retained orchestrated and supervisor instruction keys", async () => {
  await withFixture(async (root) => {
    const retained = path.join(
      root,
      "plugins/banzai/skills/architecture-decision/SKILL.md"
    );
    const source = await readFile(retained, "utf8");
    await writeFile(
      retained,
      source.replace(
        "## Orchestrated Mode\n",
        "## Orchestrated Mode\n\nFixture planning gate evidence.\n"
      )
    );
    await appendFile(
      path.join(root, "plugins/banzai/skills/orchestrate/SKILL.md"),
      "\nFixture planning gate evidence.\n"
    );
    const proposal = await describeGuidanceTransition(root);
    assert.deepEqual(
      proposal.changes.map((change) => change.key),
      [
        "plugins/banzai/skills/architecture-decision/SKILL.md#orchestrated",
        "plugins/banzai/skills/architecture-decision/SKILL.md#skeleton",
        "plugins/banzai/skills/orchestrate/SKILL.md"
      ]
    );
    const authorization = async (authorityPath: string) => ({
      schema: "banzai-instruction-authorization/v1",
      schemaVersion: 1,
      predecessorSha256: proposal.predecessorSha256,
      authorities: [
        {
          path: authorityPath,
          sha256: resourceDigest(
            await readFile(path.join(root, authorityPath))
          ),
          scope: "ADR 0055 instruction gate changes"
        }
      ],
      scope: proposal.changes.map((change) => change.key)
    });
    await assert.rejects(
      evolveGuidanceBaseline(
        root,
        await authorization(
          "documentation/decisions/0044-instruction-baseline-evolution.md"
        ),
        { check: true }
      ),
      /protected instruction transition scope/u
    );
    const authorized = await authorization(
      "documentation/decisions/0055-planning-gate-rework-and-independent-planning-review.md"
    );
    await evolveGuidanceBaseline(root, authorized, { check: true });
    await evolveGuidanceBaseline(root, authorized);
    await validateGuidanceExtraction(root);
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
