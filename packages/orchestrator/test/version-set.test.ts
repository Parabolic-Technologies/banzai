import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import {
  access,
  chmod,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import {
  createNodeVersionFileSystem,
  RECOVERY_DIRECTORY,
  recoverProjectVersion,
  setProjectVersion,
  VERSION_SURFACES,
  VersionOperationError,
  type VersionFileSystem
} from "../scripts/release-version.mjs";
import { runVersionRecoverCli } from "../scripts/version-recover.mjs";
import { runVersionSetCli } from "../scripts/version-set.mjs";
import { snapshotTree } from "./helpers.js";

const REPOSITORY_ROOT = path.resolve(process.cwd(), "../..");
const RELEASE_VERSION_MODULE = path.join(
  process.cwd(),
  "scripts/release-version.mjs"
);
const TRANSACTION_TEMP_SUFFIX = ".banzai-version-set.tmp";
const RECOVERY_GUARD = `${RECOVERY_DIRECTORY}.guard`;
const RECOVERY_GUARD_TEMPORARY = `${RECOVERY_GUARD}.tmp`;

interface RetainedFixtureFile {
  path: string;
  mode: number;
  contents: string;
}

interface LegacyFixture {
  sourceSha256: string;
  originals: RetainedFixtureFile[];
  retained: RetainedFixtureFile[];
}

async function legacyFixture(
  name: string
): Promise<{ fixture: Fixture; archive: LegacyFixture }> {
  const archive = JSON.parse(
    await readFile(
      path.join(
        process.cwd(),
        "test/fixtures/version-recovery-v1",
        `${name}.json`
      ),
      "utf8"
    )
  ) as LegacyFixture;
  assert.equal(
    archive.sourceSha256,
    "49ab987cce9b69dfb4209c61fa49e3e58d8f59ce2cca32601a8aa19092f00c7f"
  );
  const parent = await mkdtemp(path.join(tmpdir(), "banzai-v1-recovery-test-"));
  const root = await realpath(parent);
  for (const entry of archive.retained) {
    const target = path.join(root, entry.path);
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    await writeFile(target, Buffer.from(entry.contents, "base64"));
    await chmod(target, entry.mode);
  }
  return { fixture: { parent, root }, archive };
}

for (const name of [
  "initial-ready",
  "initial-guard",
  "forward-ready",
  "forward-guard"
]) {
  test(`legacy ${name} recovery restores the captured original bytes and modes without current policy`, async () => {
    const { fixture, archive } = await legacyFixture(name);
    try {
      await assertPathAbsent(path.join(fixture.root, "release-policy.json"));
      const result = await recoverProjectVersion({
        root: fixture.root,
        isProcessAlive: () => false
      });
      assert.equal(result.action, "restored");
      assert.equal(result.paths.length, 6);
      for (const entry of archive.originals) {
        const target = path.join(fixture.root, entry.path);
        assert.deepEqual(
          await readFile(target),
          Buffer.from(entry.contents, "base64")
        );
        assert.equal((await lstat(target)).mode & 0o777, entry.mode);
      }
      await assertTransactionAbsent(fixture.root);
    } finally {
      await disposeFixture(fixture);
    }
  });

  for (const drift of ["contents", "mode"] as const) {
    test(`legacy ${name} recovery preserves all evidence on later ${drift} drift`, async () => {
      const { fixture } = await legacyFixture(name);
      try {
        const target = path.join(
          fixture.root,
          "packages/orchestrator/package.json"
        );
        if (drift === "contents")
          await writeFile(target, '{"version":"later edit"}\n');
        else await chmod(target, 0o600);
        const before = await snapshotTree(fixture.root);
        await expectVersionError(
          recoverProjectVersion({
            root: fixture.root,
            isProcessAlive: () => false
          }),
          "INVALID_VERSION_TRANSACTION"
        );
        assert.deepEqual(await snapshotTree(fixture.root), before);
      } finally {
        await disposeFixture(fixture);
      }
    });
  }
}

test("legacy pre-ready cleanup and interrupted guard cleanup keep format 1 evidence", async () => {
  const { fixture, archive } = await legacyFixture("initial-ready");
  try {
    for (const entry of archive.originals)
      await writeFile(
        path.join(fixture.root, entry.path),
        Buffer.from(entry.contents, "base64")
      );
    await rm(path.join(fixture.root, RECOVERY_DIRECTORY, "ready"));
    const base = createNodeVersionFileSystem();
    const fileSystem: VersionFileSystem = {
      ...base,
      async remove(target, options) {
        if (target === path.join(fixture.root, RECOVERY_GUARD))
          throw new Error("retain guard for inspection");
        await base.remove(target, options);
      }
    };
    await assert.rejects(
      recoverProjectVersion({
        root: fixture.root,
        isProcessAlive: () => false,
        fileSystem
      })
    );
    const guard = JSON.parse(
      await readFile(path.join(fixture.root, RECOVERY_GUARD), "utf8")
    ) as { format: number; transaction: { format: number } };
    assert.equal(guard.format, 1);
    assert.equal(guard.transaction.format, 1);
    const result = await recoverProjectVersion({
      root: fixture.root,
      isProcessAlive: () => false
    });
    assert.equal(result.action, "restored");
    for (const entry of archive.originals)
      assert.deepEqual(
        await readFile(path.join(fixture.root, entry.path)),
        Buffer.from(entry.contents, "base64")
      );
    await assertTransactionAbsent(fixture.root);
  } finally {
    await disposeFixture(fixture);
  }
});

for (const killAt of ["first-replacement", "journal-removal"] as const) {
  for (const corruption of [
    "unknown format",
    "wrong transition",
    "wrong pointers"
  ] as const) {
    test(`grouped ${killAt} recovery rejects ${corruption} without changing retained state`, async () => {
      const fixture = await versionFixture();
      try {
        await runKilledTransaction(fixture, killAt);
        const guarded = killAt === "journal-removal";
        const retained = path.join(
          fixture.root,
          guarded ? RECOVERY_GUARD : `${RECOVERY_DIRECTORY}/transaction.json`
        );
        interface GroupedRecord {
          format: number;
          transition: string;
          files: { pointers: string[] }[];
        }
        const value = JSON.parse(await readFile(retained, "utf8")) as
          GroupedRecord | { transaction: GroupedRecord };
        const record = "transaction" in value ? value.transaction : value;
        assert.equal(record.format, 2);
        assert.equal(record.files.length, 7);
        const lockfile = record.files[6];
        assert.ok(lockfile);
        if (corruption === "unknown format") record.format = 99;
        else if (corruption === "wrong transition")
          record.transition = "forward";
        else lockfile.pointers = ["/version", "/packages//version", "/version"];
        await writeFile(retained, JSON.stringify(value, null, 2) + "\n");
        const before = await snapshotTree(fixture.root);
        await expectVersionError(
          recoverProjectVersion({
            root: fixture.root,
            isProcessAlive: () => false
          }),
          "INVALID_VERSION_TRANSACTION"
        );
        assert.deepEqual(await snapshotTree(fixture.root), before);
      } finally {
        await disposeFixture(fixture);
      }
    });
  }
}

test("bootstrap rejects partial insertions and the old independent migration before mutation", async () => {
  for (const inserted of [[0], [6], [7], [0, 6], [6, 7], [0, 7], []]) {
    const fixture = await versionFixture();
    try {
      for (const index of inserted)
        await writeSurfaceVersion(fixture.root, index, "1.19.0");
      if (inserted.length === 0) {
        for (const index of [1, 2, 3, 4])
          await writeSurfaceVersion(fixture.root, index, "1.18.1");
        for (const index of [5, 8])
          await writeSurfaceVersion(fixture.root, index, "0.8.2");
      }
      const before = await snapshotTree(fixture.root);
      await expectVersionError(
        setProjectVersion({
          root: fixture.root,
          targetVersion: "1.19.0",
          ownerPid: process.pid
        }),
        "INVALID_VERSION_TRANSITION"
      );
      assert.deepEqual(await snapshotTree(fixture.root), before);
    } finally {
      await disposeFixture(fixture);
    }
  }
});

test("grouped forward replacement preserves CRLF Unicode and unrelated matching versions", async () => {
  const fixture = await versionFixture();
  try {
    await setProjectVersion({
      root: fixture.root,
      targetVersion: "1.19.0",
      ownerPid: process.pid
    });
    const lockPath = path.join(fixture.root, "package-lock.json");
    const original =
      '{\r\n  "version": "1.19.0",\r\n  "note": "Україна",\r\n  "packages": {"": {"version": "1.19.0"}, "packages/orchestrator": {"version": "1.19.0"}, "node_modules/canary": {"version": "1.19.0"}}\r\n}\r\n';
    await writeFile(lockPath, original);
    await setProjectVersion({
      root: fixture.root,
      targetVersion: "1.19.1",
      ownerPid: process.pid
    });
    let replacements = 0;
    const expected = original.replaceAll('"version": "1.19.0"', (token) =>
      ++replacements <= 3 ? '"version": "1.19.1"' : token
    );
    assert.equal(await readFile(lockPath, "utf8"), expected);
    await assertTransactionAbsent(fixture.root);
  } finally {
    await disposeFixture(fixture);
  }
});

test("offline npm projects both root lockfile versions without synchronizing workspace versions", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "banzai-npm-version-test-"));
  try {
    await mkdir(path.join(root, "packages", "child"), { recursive: true });
    await writeFile(
      path.join(root, "packages/child/package.json"),
      JSON.stringify({
        name: "banzai-fixture-child",
        version: "1.19.0",
        private: true
      })
    );
    for (const version of [undefined, "1.19.0", "1.19.1"]) {
      await writeFile(
        path.join(root, "package.json"),
        JSON.stringify({
          name: "banzai-fixture-root",
          private: true,
          workspaces: ["packages/*"],
          version
        })
      );
      const result = spawnSync(
        "npm",
        [
          "install",
          "--package-lock-only",
          "--ignore-scripts",
          "--offline",
          "--no-audit",
          "--no-fund"
        ],
        {
          cwd: root,
          encoding: "utf8",
          timeout: 15000,
          env: {
            ...process.env,
            npm_config_cache: path.join(root, "cache"),
            npm_config_update_notifier: "false"
          }
        }
      );
      assert.equal(result.status, 0, result.stderr);
      const lock = JSON.parse(
        await readFile(path.join(root, "package-lock.json"), "utf8")
      ) as {
        lockfileVersion: number;
        version?: string;
        packages: {
          "": { version?: string };
          "packages/child": { version: string };
        };
      };
      assert.equal(lock.lockfileVersion, 3);
      assert.equal(lock.version, version);
      assert.equal(lock.packages[""].version, version);
      assert.equal(lock.packages["packages/child"].version, "1.19.0");
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

interface Fixture {
  parent: string;
  root: string;
}

interface Snapshot {
  contents: Buffer;
  mode: number;
}

async function versionFixture(): Promise<Fixture> {
  const parent = await mkdtemp(path.join(tmpdir(), "banzai-version-test-"));
  const requestedRoot = path.join(parent, "repository");
  await mkdir(requestedRoot);
  const root = await realpath(requestedRoot);
  for (const relativePath of [
    "release-policy.json",
    ...new Set(VERSION_SURFACES.map((surface) => surface.path))
  ]) {
    const target = path.join(root, relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await cp(path.join(REPOSITORY_ROOT, relativePath), target);
    // Establish safe inputs independently of checkout modes and the host umask.
    await chmod(target, 0o644);
  }
  for (let index = 0; index < VERSION_SURFACES.length; index += 1) {
    await writeSurfaceVersion(root, index, "1.19.0");
  }
  for (const index of [0, 6, 7])
    await writeSurfaceVersion(root, index, undefined);
  return { parent, root };
}

async function disposeFixture(fixture: Fixture): Promise<void> {
  await rm(fixture.parent, { recursive: true, force: true });
}

function pointerValue(value: unknown, pointer: string): unknown {
  return pointer
    .slice(1)
    .split("/")
    .map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"))
    .reduce<unknown>((current, key) => {
      assert.ok(typeof current === "object" && current !== null);
      return (current as Record<string, unknown>)[key];
    }, value);
}

function setPointerValue(
  value: Record<string, unknown>,
  pointer: string,
  replacement: unknown
): void {
  const segments = pointer
    .slice(1)
    .split("/")
    .map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"));
  const key = segments.pop();
  assert.ok(key !== undefined);
  let current: unknown = value;
  for (const segment of segments) {
    assert.ok(typeof current === "object" && current !== null);
    current = (current as Record<string, unknown>)[segment];
  }
  assert.ok(typeof current === "object" && current !== null);
  (current as Record<string, unknown>)[key] = replacement;
}

async function surfaceVersions(root: string): Promise<string[]> {
  const versions = [];
  for (const surface of VERSION_SURFACES) {
    const value: unknown = JSON.parse(
      await readFile(path.join(root, surface.path), "utf8")
    );
    const version = pointerValue(value, surface.pointer);
    assert.ok(typeof version === "string");
    versions.push(version);
  }
  return versions;
}

async function writeSurfaceVersion(
  root: string,
  index: number,
  version: unknown
): Promise<void> {
  const surface = VERSION_SURFACES[index];
  assert.ok(surface);
  const target = path.join(root, surface.path);
  const value = JSON.parse(await readFile(target, "utf8")) as Record<
    string,
    unknown
  >;
  setPointerValue(value, surface.pointer, version);
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeEverySurfaceVersion(
  root: string,
  version: string
): Promise<void> {
  for (let index = 0; index < VERSION_SURFACES.length; index += 1) {
    await writeSurfaceVersion(root, index, version);
  }
}

async function snapshotSurfaces(root: string): Promise<Map<string, Snapshot>> {
  const snapshot = new Map<string, Snapshot>();
  for (const surface of VERSION_SURFACES) {
    const target = path.join(root, surface.path);
    const stats = await lstat(target);
    snapshot.set(surface.path, {
      contents: await readFile(target),
      mode: stats.mode & 0o7777
    });
  }
  return snapshot;
}

async function assertSnapshot(
  root: string,
  expected: Map<string, Snapshot>
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

async function assertPathAbsent(target: string): Promise<void> {
  await assert.rejects(access(target), (error: unknown) => {
    assert.ok(
      typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
    );
    return true;
  });
}

async function assertTransactionAbsent(root: string): Promise<void> {
  await assertPathAbsent(path.join(root, RECOVERY_DIRECTORY));
  await assertPathAbsent(path.join(root, RECOVERY_GUARD));
  await assertPathAbsent(path.join(root, RECOVERY_GUARD_TEMPORARY));
  for (const surface of VERSION_SURFACES) {
    await assertPathAbsent(
      `${path.join(root, surface.path)}${TRANSACTION_TEMP_SUFFIX}`
    );
  }
}

async function expectVersionError(
  operation: Promise<unknown>,
  code: string
): Promise<VersionOperationError> {
  try {
    await operation;
  } catch (error) {
    assert.ok(error instanceof VersionOperationError);
    assert.equal(error.code, code);
    assert.ok(!error.message.includes(path.sep + "private" + path.sep));
    return error;
  }
  assert.fail(`Expected ${code}`);
}

function targetPaths(root: string): Set<string> {
  return new Set(
    VERSION_SURFACES.map((surface) => path.join(root, surface.path))
  );
}

test("bootstrap inserts exactly three fields and preserves unrelated bytes and modes", async () => {
  const fixture = await versionFixture();
  try {
    const restricted = VERSION_SURFACES[2];
    assert.ok(restricted);
    await chmod(path.join(fixture.root, restricted.path), 0o600);
    const unrelated = path.join(fixture.root, "unrelated.txt");
    await writeFile(unrelated, "unrelated canary\n", "utf8");
    const before = await snapshotSurfaces(fixture.root);
    const result = await setProjectVersion({
      root: fixture.root,
      targetVersion: "1.19.0",
      ownerPid: process.pid
    });

    assert.equal(result.transition, "bootstrap");
    assert.equal(result.version, "1.19.0");
    assert.deepEqual(result.paths, [
      ...new Set(VERSION_SURFACES.map((surface) => surface.path))
    ]);
    assert.deepEqual(
      await surfaceVersions(fixture.root),
      Array<string>(9).fill("1.19.0")
    );
    assert.equal(result.fieldCount, 9);
    for (const [relativePath, snapshot] of before) {
      let expected = snapshot.contents.toString("utf8");
      if (
        relativePath === "package.json" ||
        relativePath === "package-lock.json"
      ) {
        expected = expected.replace("{\n", '{\n  "version": "1.19.0",\n');
      }
      if (relativePath === "package-lock.json") {
        expected = expected.replace(
          '    "": {\n',
          '    "": {\n      "version": "1.19.0",\n'
        );
      }
      assert.deepEqual(
        await readFile(path.join(fixture.root, relativePath)),
        Buffer.from(expected)
      );
      assert.equal(
        (await lstat(path.join(fixture.root, relativePath))).mode & 0o7777,
        snapshot.mode
      );
    }
    assert.equal(await readFile(unrelated, "utf8"), "unrelated canary\n");
    await assertTransactionAbsent(fixture.root);
  } finally {
    await disposeFixture(fixture);
  }
});

test("unified updates require a strictly greater target and compare unbounded integers", async () => {
  const fixture = await versionFixture();
  try {
    await setProjectVersion({
      root: fixture.root,
      targetVersion: "1.19.0",
      ownerPid: process.pid
    });
    for (const rejected of ["1.19.0", "1.18.99", "0.99.99"]) {
      const before = await snapshotSurfaces(fixture.root);
      await expectVersionError(
        setProjectVersion({
          root: fixture.root,
          targetVersion: rejected,
          ownerPid: process.pid
        }),
        "INVALID_VERSION_TRANSITION"
      );
      await assertSnapshot(fixture.root, before);
      await assertTransactionAbsent(fixture.root);
    }
    const forward = await setProjectVersion({
      root: fixture.root,
      targetVersion: "1.19.1",
      ownerPid: process.pid
    });
    assert.equal(forward.transition, "forward");

    await writeEverySurfaceVersion(fixture.root, "9007199254740993.0.0");
    const large = await setProjectVersion({
      root: fixture.root,
      targetVersion: "9007199254740994.0.0",
      ownerPid: process.pid
    });
    assert.equal(large.transition, "forward");
    assert.deepEqual(
      await surfaceVersions(fixture.root),
      Array<string>(9).fill("9007199254740994.0.0")
    );
  } finally {
    await disposeFixture(fixture);
  }
});

test("non-canonical targets and extra CLI arguments fail before mutation", async () => {
  const fixture = await versionFixture();
  try {
    const before = await snapshotSurfaces(fixture.root);
    for (const target of [
      "",
      "1.19",
      "01.19.0",
      "1.019.0",
      "1.19.00",
      "1.19.0-beta.1",
      "1.19.0+build",
      " 1.19.0",
      "1.19.0\n"
    ]) {
      await expectVersionError(
        setProjectVersion({
          root: fixture.root,
          targetVersion: target,
          ownerPid: process.pid
        }),
        "INVALID_VERSION_ARGUMENT"
      );
    }
    const errors: string[] = [];
    assert.equal(
      await runVersionSetCli({
        args: ["--root", fixture.root, "1.19.0"],
        root: fixture.root,
        ownerPid: process.pid,
        processLike: process,
        writeOut: () => undefined,
        writeError: (value) => errors.push(value)
      }),
      1
    );
    assert.match(
      errors.join(""),
      /^INVALID_VERSION_ARGUMENT version-set\.mjs:/
    );
    const recoveryErrors: string[] = [];
    assert.equal(
      await runVersionRecoverCli({
        args: [fixture.root],
        root: fixture.root,
        writeOut: () => undefined,
        writeError: (value) => recoveryErrors.push(value)
      }),
      1
    );
    assert.match(
      recoveryErrors.join(""),
      /^INVALID_VERSION_RECOVERY_ARGUMENT version-recover\.mjs:/
    );
    await assertSnapshot(fixture.root, before);
    await assertTransactionAbsent(fixture.root);
  } finally {
    await disposeFixture(fixture);
  }
});

for (const [name, mutate] of [
  [
    "plugin-set drift",
    async (root: string): Promise<void> =>
      writeSurfaceVersion(root, 1, "1.18.0")
  ],
  [
    "orchestrator-pair drift",
    async (root: string): Promise<void> => writeSurfaceVersion(root, 5, "0.8.1")
  ],
  [
    "post-migration cross-group drift",
    async (root: string): Promise<void> => {
      for (let index = 0; index < 5; index += 1) {
        await writeSurfaceVersion(root, index, "1.19.0");
      }
      for (let index = 5; index < 9; index += 1) {
        await writeSurfaceVersion(root, index, "1.19.1");
      }
    }
  ]
] as const) {
  test(`synchronization rejects ${name} before mutation`, async () => {
    const fixture = await versionFixture();
    try {
      await mutate(fixture.root);
      const before = await snapshotSurfaces(fixture.root);
      await expectVersionError(
        setProjectVersion({
          root: fixture.root,
          targetVersion: "1.20.0",
          ownerPid: process.pid
        }),
        "INVALID_VERSION_TRANSITION"
      );
      await assertSnapshot(fixture.root, before);
      await assertTransactionAbsent(fixture.root);
    } finally {
      await disposeFixture(fixture);
    }
  });
}

const invalidDocumentCases: readonly {
  name: string;
  mutate(root: string): Promise<void>;
  code: string;
}[] = [
  {
    name: "malformed JSON",
    async mutate(root) {
      await writeFile(
        path.join(root, VERSION_SURFACES[1]?.path ?? "missing"),
        "{ malformed\n",
        "utf8"
      );
    },
    code: "MALFORMED_VERSION_DOCUMENT"
  },
  {
    name: "duplicate key",
    async mutate(root) {
      const surface = VERSION_SURFACES[1];
      assert.ok(surface);
      const target = path.join(root, surface.path);
      const contents = await readFile(target, "utf8");
      await writeFile(
        target,
        contents.replace(
          '"version": "1.19.0"',
          '"version": "1.19.0",\n  "version": "1.19.0"'
        ),
        "utf8"
      );
    },
    code: "AMBIGUOUS_VERSION_DOCUMENT"
  },
  {
    name: "missing field",
    async mutate(root) {
      const surface = VERSION_SURFACES[1];
      assert.ok(surface);
      const target = path.join(root, surface.path);
      const value = JSON.parse(await readFile(target, "utf8")) as Record<
        string,
        unknown
      >;
      delete value.version;
      await writeFile(target, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    },
    code: "MISSING_VERSION_FIELD"
  },
  {
    name: "non-string field",
    async mutate(root) {
      await writeSurfaceVersion(root, 0, 1190);
    },
    code: "INVALID_VERSION_VALUE"
  },
  {
    name: "non-canonical persisted version",
    async mutate(root) {
      await writeSurfaceVersion(root, 0, "01.18.1");
    },
    code: "INVALID_VERSION_VALUE"
  }
];

for (const scenario of invalidDocumentCases) {
  test(`${scenario.name} version metadata fails before mutation`, async () => {
    const fixture = await versionFixture();
    try {
      await scenario.mutate(fixture.root);
      const before = await snapshotSurfaces(fixture.root);
      await expectVersionError(
        setProjectVersion({
          root: fixture.root,
          targetVersion: "1.19.0",
          ownerPid: process.pid
        }),
        scenario.code
      );
      await assertSnapshot(fixture.root, before);
      await assertTransactionAbsent(fixture.root);
    } finally {
      await disposeFixture(fixture);
    }
  });
}

test("fixed policy paths symlinks and unsafe modes fail without touching outside files", async () => {
  const policyFixture = await versionFixture();
  try {
    const outside = path.join(policyFixture.parent, "outside-canary.json");
    await writeFile(outside, '{"version":"outside"}\n', "utf8");
    const policyPath = path.join(policyFixture.root, "release-policy.json");
    const policy = JSON.parse(await readFile(policyPath, "utf8")) as {
      plugin: { versionMirrors: { path: string; pointer: string }[] };
    };
    const first = policy.plugin.versionMirrors[0];
    assert.ok(first);
    first.path = "../outside-canary.json";
    await writeFile(policyPath, `${JSON.stringify(policy, null, 2)}\n`, "utf8");
    await expectVersionError(
      setProjectVersion({
        root: policyFixture.root,
        targetVersion: "1.19.0",
        ownerPid: process.pid
      }),
      "INVALID_VERSION_POLICY"
    );
    assert.equal(await readFile(outside, "utf8"), '{"version":"outside"}\n');
  } finally {
    await disposeFixture(policyFixture);
  }

  const symlinkFixture = await versionFixture();
  try {
    const surface = VERSION_SURFACES[0];
    assert.ok(surface);
    const target = path.join(symlinkFixture.root, surface.path);
    const outside = path.join(symlinkFixture.parent, "symlink-canary.json");
    await cp(target, outside);
    await rm(target);
    await symlink(outside, target);
    await expectVersionError(
      setProjectVersion({
        root: symlinkFixture.root,
        targetVersion: "1.19.0",
        ownerPid: process.pid
      }),
      "UNSAFE_VERSION_FILE"
    );
    assert.equal(
      pointerValue(JSON.parse(await readFile(outside, "utf8")), "/version"),
      undefined
    );
  } finally {
    await disposeFixture(symlinkFixture);
  }

  const modeFixture = await versionFixture();
  try {
    const surface = VERSION_SURFACES[0];
    assert.ok(surface);
    await chmod(path.join(modeFixture.root, surface.path), 0o666);
    await expectVersionError(
      setProjectVersion({
        root: modeFixture.root,
        targetVersion: "1.19.0",
        ownerPid: process.pid
      }),
      "UNSAFE_VERSION_FILE"
    );
    await assertTransactionAbsent(modeFixture.root);
  } finally {
    await disposeFixture(modeFixture);
  }
});

test("an existing transaction lock blocks synchronization without mutation", async () => {
  const fixture = await versionFixture();
  try {
    const before = await snapshotSurfaces(fixture.root);
    await mkdir(path.join(fixture.root, RECOVERY_DIRECTORY), { mode: 0o700 });
    await writeFile(
      path.join(fixture.root, RECOVERY_DIRECTORY, "canary"),
      "retained\n",
      { mode: 0o600 }
    );
    await expectVersionError(
      setProjectVersion({
        root: fixture.root,
        targetVersion: "1.19.0",
        ownerPid: process.pid
      }),
      "UNRESOLVED_VERSION_TRANSACTION"
    );
    await assertSnapshot(fixture.root, before);
    assert.equal(
      await readFile(
        path.join(fixture.root, RECOVERY_DIRECTORY, "canary"),
        "utf8"
      ),
      "retained\n"
    );
  } finally {
    await disposeFixture(fixture);
  }
});

type FaultFactory = (
  base: VersionFileSystem,
  root: string
) => VersionFileSystem;

const recoverableFaults: readonly {
  name: string;
  create: FaultFactory;
}[] = [
  {
    name: "target preparation read",
    create(base, root) {
      let failed = false;
      const target = path.join(root, VERSION_SURFACES[0]?.path ?? "missing");
      return {
        ...base,
        async readFile(file) {
          if (!failed && file === target) {
            failed = true;
            throw new Error("injected preparation read failure");
          }
          return await base.readFile(file);
        }
      };
    }
  },
  {
    name: "durable transaction preparation",
    create(base) {
      let failed = false;
      return {
        ...base,
        async writeFileDurable(file, contents, mode, exclusive) {
          if (
            !failed &&
            file.endsWith(path.join(RECOVERY_DIRECTORY, "candidate", "02"))
          ) {
            failed = true;
            throw new Error("injected transaction write failure");
          }
          await base.writeFileDurable(file, contents, mode, exclusive);
        }
      };
    }
  },
  {
    name: "replacement temporary write",
    create(base) {
      let failed = false;
      return {
        ...base,
        async writeFileDurable(file, contents, mode, exclusive) {
          if (!failed && file.endsWith(TRANSACTION_TEMP_SUFFIX)) {
            failed = true;
            throw new Error("injected replacement write failure");
          }
          await base.writeFileDurable(file, contents, mode, exclusive);
        }
      };
    }
  },
  {
    name: "mode preservation",
    create(base) {
      let failed = false;
      return {
        ...base,
        async setMode(file, mode) {
          if (!failed && file.endsWith(TRANSACTION_TEMP_SUFFIX)) {
            failed = true;
            throw new Error("injected chmod failure");
          }
          await base.setMode(file, mode);
        }
      };
    }
  },
  {
    name: "replacement file sync",
    create(base) {
      let failed = false;
      return {
        ...base,
        async syncFile(file) {
          if (!failed && file.endsWith(TRANSACTION_TEMP_SUFFIX)) {
            failed = true;
            throw new Error("injected file sync failure");
          }
          await base.syncFile(file);
        }
      };
    }
  },
  {
    name: "second atomic replacement",
    create(base, root) {
      let replacements = 0;
      const targets = targetPaths(root);
      return {
        ...base,
        async move(source, target) {
          if (targets.has(target)) {
            replacements += 1;
            if (replacements === 2) {
              throw new Error("injected rename failure");
            }
          }
          await base.move(source, target);
        }
      };
    }
  },
  {
    name: "transaction cleanup",
    create(base, root) {
      let failed = false;
      const transaction = path.join(root, RECOVERY_DIRECTORY);
      return {
        ...base,
        async remove(target, options) {
          if (
            !failed &&
            target === transaction &&
            options?.recursive === true
          ) {
            failed = true;
            throw new Error("injected transaction cleanup failure");
          }
          await base.remove(target, options);
        }
      };
    }
  }
];

for (const scenario of recoverableFaults) {
  test(`${scenario.name} failure restores exact originals and leaves no transaction`, async () => {
    const fixture = await versionFixture();
    try {
      const before = await snapshotSurfaces(fixture.root);
      const fileSystem = scenario.create(
        createNodeVersionFileSystem(),
        fixture.root
      );
      await expectVersionError(
        setProjectVersion({
          root: fixture.root,
          targetVersion: "1.19.0",
          ownerPid: process.pid,
          fileSystem
        }),
        "VERSION_FILESYSTEM_ERROR"
      );
      await assertSnapshot(fixture.root, before);
      await assertTransactionAbsent(fixture.root);
    } finally {
      await disposeFixture(fixture);
    }
  });
}

test("target directory sync after replacement failure restores exact originals and leaves no transaction", async () => {
  const fixture = await versionFixture();
  try {
    const before = await snapshotSurfaces(fixture.root);
    const base = createNodeVersionFileSystem();
    const targets = targetPaths(fixture.root);
    let replacements = 0;
    let replacementsAtFailure: number | null = null;
    const fileSystem: VersionFileSystem = {
      ...base,
      async move(source, target) {
        await base.move(source, target);
        if (targets.has(target)) replacements += 1;
      },
      async syncDirectory(directory) {
        if (
          replacementsAtFailure === null &&
          replacements > 0 &&
          directory === fixture.root
        ) {
          replacementsAtFailure = replacements;
          throw new Error("injected target-directory sync failure");
        }
        await base.syncDirectory(directory);
      }
    };
    await expectVersionError(
      setProjectVersion({
        root: fixture.root,
        targetVersion: "1.19.0",
        ownerPid: process.pid,
        fileSystem
      }),
      "VERSION_FILESYSTEM_ERROR"
    );
    assert.equal(replacementsAtFailure, 1);
    await assertSnapshot(fixture.root, before);
    await assertTransactionAbsent(fixture.root);
  } finally {
    await disposeFixture(fixture);
  }
});

test("a failed final reread restores every original", async () => {
  const fixture = await versionFixture();
  try {
    const before = await snapshotSurfaces(fixture.root);
    const base = createNodeVersionFileSystem();
    const targets = targetPaths(fixture.root);
    const firstTarget = path.join(
      fixture.root,
      VERSION_SURFACES[0]?.path ?? "missing"
    );
    let replacements = 0;
    let failed = false;
    const fileSystem: VersionFileSystem = {
      ...base,
      async move(source, target) {
        await base.move(source, target);
        if (targets.has(target)) {
          replacements += 1;
        }
      },
      async readFile(file) {
        if (!failed && replacements === 7 && file === firstTarget) {
          failed = true;
          throw new Error("injected final reread failure");
        }
        return await base.readFile(file);
      }
    };
    await expectVersionError(
      setProjectVersion({
        root: fixture.root,
        targetVersion: "1.19.0",
        ownerPid: process.pid,
        fileSystem
      }),
      "VERSION_FINAL_VERIFICATION_FAILED"
    );
    await assertSnapshot(fixture.root, before);
    await assertTransactionAbsent(fixture.root);
  } finally {
    await disposeFixture(fixture);
  }
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  test(`${signal} through the CLI restores originals and returns the signal exit code`, async () => {
    const fixture = await versionFixture();
    try {
      const before = await snapshotSurfaces(fixture.root);
      const base = createNodeVersionFileSystem();
      const targets = targetPaths(fixture.root);
      const processLike = Object.assign(new EventEmitter(), {
        pid: process.pid
      }) as unknown as NodeJS.Process;
      let interrupted = false;
      const fileSystem: VersionFileSystem = {
        ...base,
        async move(source, target) {
          await base.move(source, target);
          if (!interrupted && targets.has(target)) {
            interrupted = true;
            processLike.emit(signal);
          }
        }
      };
      const output: string[] = [];
      const errors: string[] = [];

      const exitCode = await runVersionSetCli({
        args: ["1.19.0"],
        root: fixture.root,
        ownerPid: process.pid,
        processLike,
        fileSystem,
        writeOut: (value) => output.push(value),
        writeError: (value) => errors.push(value)
      });

      assert.equal(exitCode, signal === "SIGINT" ? 130 : 143);
      assert.deepEqual(output, []);
      assert.match(
        errors.join(""),
        new RegExp(
          `^VERSION_SET_INTERRUPTED \\.banzai-version-set: received ${signal}; exact originals restored\\n$`
        )
      );
      assert.equal(processLike.listenerCount("SIGINT"), 0);
      assert.equal(processLike.listenerCount("SIGTERM"), 0);
      await assertSnapshot(fixture.root, before);
      await assertTransactionAbsent(fixture.root);
    } finally {
      await disposeFixture(fixture);
    }
  });
}

test("generic cancellation after mutation starts restores originals and remains unsuccessful", async () => {
  const fixture = await versionFixture();
  try {
    const before = await snapshotSurfaces(fixture.root);
    const base = createNodeVersionFileSystem();
    const controller = new AbortController();
    const targets = targetPaths(fixture.root);
    let interrupted = false;
    const fileSystem: VersionFileSystem = {
      ...base,
      async move(source, target) {
        await base.move(source, target);
        if (!interrupted && targets.has(target)) {
          interrupted = true;
          controller.abort();
        }
      }
    };
    const error = await expectVersionError(
      setProjectVersion({
        root: fixture.root,
        targetVersion: "1.19.0",
        ownerPid: process.pid,
        signal: controller.signal,
        fileSystem
      }),
      "VERSION_SET_CANCELLED"
    );
    assert.equal(error.signal, null);
    assert.match(error.detail, /exact originals restored$/);
    await assertSnapshot(fixture.root, before);
    await assertTransactionAbsent(fixture.root);
  } finally {
    await disposeFixture(fixture);
  }
});

test("failed restoration retains evidence and a later recovery restores all seven originals", async () => {
  const fixture = await versionFixture();
  try {
    const before = await snapshotSurfaces(fixture.root);
    const base = createNodeVersionFileSystem();
    const targets = targetPaths(fixture.root);
    let moves = 0;
    const fileSystem: VersionFileSystem = {
      ...base,
      async move(source, target) {
        if (targets.has(target)) {
          moves += 1;
          if (moves === 2 || moves === 3) {
            throw new Error("injected forward/restoration rename failure");
          }
        }
        await base.move(source, target);
      }
    };
    await expectVersionError(
      setProjectVersion({
        root: fixture.root,
        targetVersion: "1.19.0",
        ownerPid: process.pid,
        fileSystem
      }),
      "VERSION_RESTORE_FAILED"
    );
    await access(path.join(fixture.root, RECOVERY_DIRECTORY));

    const recovered = await recoverProjectVersion({
      root: fixture.root,
      isProcessAlive: () => false
    });
    assert.equal(recovered.action, "restored");
    assert.deepEqual(recovered.paths, [
      ...new Set(VERSION_SURFACES.map((surface) => surface.path))
    ]);
    await assertSnapshot(fixture.root, before);
    await assertTransactionAbsent(fixture.root);
  } finally {
    await disposeFixture(fixture);
  }
});

async function runKilledTransaction(
  fixture: Fixture,
  killAt: "record" | "first-replacement" | "journal-removal",
  targetVersion = "1.19.0"
): Promise<void> {
  const helper = path.join(fixture.parent, `kill-${killAt}.mjs`);
  const moduleUrl = pathToFileURL(RELEASE_VERSION_MODULE).href;
  const targets = [...targetPaths(fixture.root)];
  const source = `
import { createNodeVersionFileSystem, setProjectVersion } from ${JSON.stringify(moduleUrl)};
const root = ${JSON.stringify(fixture.root)};
const targets = new Set(${JSON.stringify(targets)});
const base = createNodeVersionFileSystem();
let replacements = 0;
const fileSystem = {
  ...base,
  async writeFileDurable(file, contents, mode, exclusive) {
    await base.writeFileDurable(file, contents, mode, exclusive);
    if (${JSON.stringify(killAt)} === "record" && file.endsWith("/transaction.json")) {
      process.kill(process.pid, "SIGKILL");
    }
  },
  async move(from, to) {
    await base.move(from, to);
    if (${JSON.stringify(killAt)} === "first-replacement" && targets.has(to) && ++replacements === 1) {
      process.kill(process.pid, "SIGKILL");
    }
  },
  async remove(target, options) {
    await base.remove(target, options);
    if (${JSON.stringify(killAt)} === "journal-removal" && target === root + "/.banzai-version-set" && options?.recursive) {
      process.kill(process.pid, "SIGKILL");
    }
  }
};
await setProjectVersion({ root, targetVersion: ${JSON.stringify(targetVersion)}, ownerPid: process.pid, fileSystem });
`;
  await writeFile(helper, source, "utf8");
  const result = spawnSync(process.execPath, [helper], {
    cwd: fixture.root,
    encoding: "utf8",
    timeout: 10_000
  });
  assert.equal(result.status, null, `${result.stdout}\n${result.stderr}`);
  assert.equal(result.signal, "SIGKILL");
}

async function runKilledRecovery(fixture: Fixture): Promise<void> {
  const helper = path.join(fixture.parent, "kill-recovery.mjs");
  const moduleUrl = pathToFileURL(RELEASE_VERSION_MODULE).href;
  const targets = [...targetPaths(fixture.root)];
  const source = `
import { createNodeVersionFileSystem, recoverProjectVersion } from ${JSON.stringify(moduleUrl)};
const root = ${JSON.stringify(fixture.root)};
const targets = new Set(${JSON.stringify(targets)});
const base = createNodeVersionFileSystem();
let replacements = 0;
const fileSystem = {
  ...base,
  async move(from, to) {
    await base.move(from, to);
    if (targets.has(to) && ++replacements === 1) process.kill(process.pid, "SIGKILL");
  }
};
await recoverProjectVersion({ root, isProcessAlive: () => false, fileSystem });
`;
  await writeFile(helper, source, "utf8");
  const result = spawnSync(process.execPath, [helper], {
    cwd: fixture.root,
    encoding: "utf8",
    timeout: 10_000
  });
  assert.equal(result.status, null, `${result.stdout}\n${result.stderr}`);
  assert.equal(result.signal, "SIGKILL");
}

for (const killAt of ["first-replacement", "journal-removal"] as const) {
  test(`grouped forward ${killAt} recovery restores all nine original values without current policy`, async () => {
    const fixture = await versionFixture();
    try {
      await setProjectVersion({
        root: fixture.root,
        targetVersion: "1.19.0",
        ownerPid: process.pid
      });
      const before = await snapshotSurfaces(fixture.root);
      await runKilledTransaction(fixture, killAt, "1.19.1");
      await rm(path.join(fixture.root, "release-policy.json"));
      const recovered = await recoverProjectVersion({
        root: fixture.root,
        isProcessAlive: () => false
      });
      assert.equal(recovered.action, "restored");
      assert.equal(recovered.paths.length, 7);
      await assertSnapshot(fixture.root, before);
      assert.deepEqual(
        await surfaceVersions(fixture.root),
        Array<string>(9).fill("1.19.0")
      );
      await assertTransactionAbsent(fixture.root);
    } finally {
      await disposeFixture(fixture);
    }
  });
}

test("uncatchable termination stays blocked until stale-owner recovery restores originals", async () => {
  const fixture = await versionFixture();
  try {
    const before = await snapshotSurfaces(fixture.root);
    await runKilledTransaction(fixture, "first-replacement");
    await access(path.join(fixture.root, RECOVERY_DIRECTORY, "ready"));
    await expectVersionError(
      recoverProjectVersion({
        root: fixture.root,
        isProcessAlive: () => true
      }),
      "VERSION_TRANSACTION_ACTIVE"
    );
    await access(path.join(fixture.root, RECOVERY_DIRECTORY));

    const recovered = await recoverProjectVersion({
      root: fixture.root,
      isProcessAlive: () => false
    });
    assert.equal(recovered.action, "restored");
    await assertSnapshot(fixture.root, before);
    await assertTransactionAbsent(fixture.root);
  } finally {
    await disposeFixture(fixture);
  }
});

test("an interrupted recovery retains evidence and can be retried idempotently", async () => {
  const fixture = await versionFixture();
  try {
    const before = await snapshotSurfaces(fixture.root);
    await runKilledTransaction(fixture, "first-replacement");
    await runKilledRecovery(fixture);
    await access(path.join(fixture.root, RECOVERY_DIRECTORY, "ready"));

    const recovered = await recoverProjectVersion({
      root: fixture.root,
      isProcessAlive: () => false
    });

    assert.equal(recovered.action, "restored");
    await assertSnapshot(fixture.root, before);
    await assertTransactionAbsent(fixture.root);
  } finally {
    await disposeFixture(fixture);
  }
});

for (const killAt of ["first-replacement", "journal-removal"] as const) {
  for (const drift of ["contents", "mode"] as const) {
    test(`post-ready recovery preserves ${drift} drift after ${killAt}`, async () => {
      const fixture = await versionFixture();
      try {
        await runKilledTransaction(fixture, killAt);
        // A late target proves the complete set is checked before restoring
        // even the first candidate, not just immediately before each write.
        const target = path.join(
          fixture.root,
          "packages/orchestrator/package.json"
        );
        if (drift === "contents") {
          const value = JSON.parse(await readFile(target, "utf8")) as Record<
            string,
            unknown
          >;
          value.description = "Unrelated maintainer edit after the crash";
          await writeFile(
            target,
            `${JSON.stringify(value, null, 2)}\n`,
            "utf8"
          );
        } else {
          await chmod(target, 0o600);
        }
        const before = await snapshotTree(fixture.root);
        const targetsBefore = await snapshotSurfaces(fixture.root);
        await assert.rejects(
          recoverProjectVersion({
            root: fixture.root,
            isProcessAlive: () => false
          }),
          (error: unknown) =>
            error instanceof VersionOperationError &&
            error.code === "INVALID_VERSION_TRANSACTION" &&
            error.relativePath === "packages/orchestrator/package.json"
        );
        assert.deepEqual(await snapshotTree(fixture.root), before);
        await assertSnapshot(fixture.root, targetsBefore);
      } finally {
        await disposeFixture(fixture);
      }
    });
  }
}

test("post-ready recovery accepts mixed authenticated originals and candidates under a guard", async () => {
  const fixture = await versionFixture();
  try {
    const originals = await snapshotSurfaces(fixture.root);
    await runKilledTransaction(fixture, "journal-removal");
    const surface = VERSION_SURFACES[0];
    assert.ok(surface);
    const original = originals.get(surface.path);
    assert.ok(original);
    await writeFile(path.join(fixture.root, surface.path), original.contents);
    const result = await recoverProjectVersion({
      root: fixture.root,
      isProcessAlive: () => false
    });
    assert.equal(result.action, "restored");
    await assertSnapshot(fixture.root, originals);
    await assertTransactionAbsent(fixture.root);
  } finally {
    await disposeFixture(fixture);
  }
});

test("pre-ready termination is cleaned only after all original digests still match", async () => {
  const fixture = await versionFixture();
  try {
    const before = await snapshotSurfaces(fixture.root);
    await runKilledTransaction(fixture, "record");
    await assertPathAbsent(
      path.join(fixture.root, RECOVERY_DIRECTORY, "ready")
    );
    const recovered = await recoverProjectVersion({
      root: fixture.root,
      isProcessAlive: () => false
    });
    assert.equal(recovered.action, "cleaned");
    await assertSnapshot(fixture.root, before);
    await assertTransactionAbsent(fixture.root);
  } finally {
    await disposeFixture(fixture);
  }
});

test("pre-ready recovery remains blocked when any original digest changed", async () => {
  const fixture = await versionFixture();
  try {
    await runKilledTransaction(fixture, "record");
    await writeSurfaceVersion(fixture.root, 5, "0.8.1");

    await expectVersionError(
      recoverProjectVersion({
        root: fixture.root,
        isProcessAlive: () => false
      }),
      "INVALID_VERSION_TRANSACTION"
    );

    await access(path.join(fixture.root, RECOVERY_DIRECTORY));
    assert.equal(
      (
        JSON.parse(
          await readFile(
            path.join(fixture.root, "packages/orchestrator/package.json"),
            "utf8"
          )
        ) as { version: string }
      ).version,
      "0.8.1"
    );
  } finally {
    await disposeFixture(fixture);
  }
});

test("malformed retained recovery evidence remains blocked for diagnosis", async () => {
  const fixture = await versionFixture();
  try {
    await runKilledTransaction(fixture, "first-replacement");
    await writeFile(
      path.join(fixture.root, RECOVERY_DIRECTORY, "transaction.json"),
      "{ malformed\n",
      "utf8"
    );

    await expectVersionError(
      recoverProjectVersion({
        root: fixture.root,
        isProcessAlive: () => false
      }),
      "INVALID_VERSION_TRANSACTION"
    );

    await access(path.join(fixture.root, RECOVERY_DIRECTORY));
  } finally {
    await disposeFixture(fixture);
  }
});

test("malformed cleanup guard remains blocked and is never deleted implicitly", async () => {
  const fixture = await versionFixture();
  try {
    const guard = path.join(fixture.root, RECOVERY_GUARD);
    await writeFile(guard, "{ malformed\n", { mode: 0o600 });

    await expectVersionError(
      recoverProjectVersion({
        root: fixture.root,
        isProcessAlive: () => false
      }),
      "INVALID_VERSION_TRANSACTION"
    );
    await expectVersionError(
      setProjectVersion({
        root: fixture.root,
        targetVersion: "1.19.0",
        ownerPid: process.pid
      }),
      "UNRESOLVED_VERSION_TRANSACTION"
    );

    assert.equal(await readFile(guard, "utf8"), "{ malformed\n");
  } finally {
    await disposeFixture(fixture);
  }
});

test("unexpected retained recovery entries are never deleted implicitly", async () => {
  const fixture = await versionFixture();
  try {
    await runKilledTransaction(fixture, "first-replacement");
    const unexpected = path.join(
      fixture.root,
      RECOVERY_DIRECTORY,
      "unexpected"
    );
    await writeFile(unexpected, "do not delete\n", { mode: 0o600 });

    await expectVersionError(
      recoverProjectVersion({
        root: fixture.root,
        isProcessAlive: () => false
      }),
      "INVALID_VERSION_TRANSACTION"
    );

    assert.equal(await readFile(unexpected, "utf8"), "do not delete\n");
    await access(path.join(fixture.root, RECOVERY_DIRECTORY));
  } finally {
    await disposeFixture(fixture);
  }
});
