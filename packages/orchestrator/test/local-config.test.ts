import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  symlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { DEFAULT_CONFIG } from "../src/config.js";
import { BanzaiError, LocalConfigError } from "../src/errors.js";
import {
  LOCAL_CONFIG_FILE,
  LOCAL_CONFIG_LIMIT,
  createLocalConfigVisibility,
  ensureLocalConfigExcluded,
  loadConfig,
  loadEffectiveConfig,
  localConfigNotIgnoredDefect,
  localModelsOf,
  mergeModelLayer,
  parseLocalModelFile,
  parseLocalModelLayer,
  parseLocalModelMap,
  readLayeredConfig,
  readLocalModelLayer,
  renderLocalModelFile,
  sameModelLayer,
  writeLocalModelLayer,
  LOCAL_CONFIG_GIT,
  type LocalConfigExcludeGit,
  type LocalConfigGitProbe,
  type LocalModelLayerParse
} from "../src/local-config.js";
import type {
  LocalConfigDefect,
  LocalModelLayer,
  LocalModelTriple,
  OrchestratorConfig
} from "../src/types.js";
import { WorkflowRunner } from "../src/workflow.js";
import {
  LOCAL_CONFIG_IGNORE_LINE,
  commitAll,
  createTestRepository,
  localModelFileText,
  snapshotTree,
  withVendorExecutablesOnPath,
  writeLocalModels
} from "./helpers.js";
import { FakeAdapters, passingReview } from "./workflow-fixtures.js";

const execFileAsync = promisify(execFile);

const CORRECTION =
  "Correct .banzai/config.local.json, or delete it to use the shared models in .banzai/config.json.";

const REVIEWER_TRIPLE: LocalModelTriple = {
  executable: "claude",
  model: "claude-opus-5-5",
  effort: "xhigh"
};
const LOCAL_REVIEWER: LocalModelLayer = { reviewer: REVIEWER_TRIPLE };

function defectOf(result: LocalModelLayerParse): LocalConfigDefect {
  assert.equal(result.ok, false);
  assert.ok(!result.ok);
  return result.defect;
}

function assertValueFree(defect: LocalConfigDefect): void {
  assert.doesNotMatch(defect.message, /CANARY/u);
  assert.doesNotMatch(defect.fieldPath, /CANARY/u);
  assert.ok(
    defect.message.endsWith(CORRECTION) ||
      defect.code === "LOCAL_CONFIG_NOT_IGNORED",
    defect.message
  );
}

function file(models: unknown, extra: Record<string, unknown> = {}): unknown {
  return { schemaVersion: 1, models, ...extra };
}

function triple(overrides: Record<string, unknown> = {}): unknown {
  return {
    executable: "claude",
    model: "claude-opus-5-5",
    effort: "xhigh",
    ...overrides
  };
}

/** A probe that records each query and answers from fixed state. */
function recordingProbe(state: { tracked: boolean; ignored: boolean }): {
  probe: LocalConfigGitProbe;
  calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    probe: {
      isPathInIndex: (_root, relativePath) => {
        calls.push(`index ${relativePath}`);
        return Promise.resolve(state.tracked);
      },
      isPathIgnored: (_root, relativePath) => {
        calls.push(`ignore ${relativePath}`);
        return Promise.resolve(state.ignored);
      }
    }
  };
}

const UNUSED_PROBE: LocalConfigGitProbe = {
  isPathInIndex: () => Promise.reject(new Error("Git must not be asked.")),
  isPathIgnored: () => Promise.reject(new Error("Git must not be asked."))
};

async function readWith(
  root: string,
  probe: LocalConfigGitProbe = recordingProbe({
    tracked: false,
    ignored: true
  }).probe
) {
  return await readLocalModelLayer(root, {
    visibility: createLocalConfigVisibility(probe)
  });
}

async function withTemporaryDirectory(
  callback: (root: string) => Promise<void>
): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), "banzai-local-config-"));
  try {
    await callback(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function defectiveOf(
  status: Awaited<ReturnType<typeof readLocalModelLayer>>
): LocalConfigDefect {
  assert.equal(status.state, "defective");
  return status.defect;
}

test("a valid local file holds zero to three whole role triples in role order", () => {
  assert.deepEqual(parseLocalModelLayer(file({})), { ok: true, models: {} });
  const all = parseLocalModelLayer(
    file({
      reviewer: triple({ executable: "codex", model: "gpt-6.1-sol" }),
      planner: triple({ effort: "max" }),
      implementer: triple({ effort: "low" })
    })
  );
  assert.ok(all.ok);
  assert.deepEqual(Object.keys(all.models), [
    "planner",
    "implementer",
    "reviewer"
  ]);
  assert.deepEqual(all.models.reviewer, {
    executable: "codex",
    model: "gpt-6.1-sol",
    effort: "xhigh"
  });
  for (const model of [
    "a",
    "claude-opus-5-5",
    "gpt-5.6-luna",
    "vendor/model:tag@v1[beta]_x",
    `M${"x".repeat(127)}`
  ]) {
    assert.ok(
      parseLocalModelLayer(file({ planner: triple({ model }) })).ok,
      model
    );
  }
  for (const effort of ["low", "medium", "high", "xhigh", "max", "ultra"]) {
    assert.ok(
      parseLocalModelLayer(file({ planner: triple({ effort }) })).ok,
      effort
    );
  }
});

test("each refused key fails with LOCAL_CONFIG_KEY_REFUSED and names its field path", () => {
  const cases: [unknown, string, RegExp][] = [
    [
      file({}, { verification: { profiles: [] } }),
      "verification",
      /may set only schemaVersion and models/u
    ],
    [
      file({}, { timeoutMs: 1 }),
      "timeoutMs",
      /may set only schemaVersion and models/u
    ],
    [
      file({ tester: triple() }),
      "models.tester",
      /only planner, implementer and reviewer/u
    ],
    [
      file({ Reviewer: triple() }),
      "models.Reviewer",
      /only planner, implementer and reviewer/u
    ],
    [
      file({ reviewer: triple({ timeoutMs: 60_000 }) }),
      "models.reviewer.timeoutMs",
      /Timeouts stay shared in \.banzai\/config\.json/u
    ],
    [
      file({ reviewer: triple({ sessionMode: "fresh" }) }),
      "models.reviewer.sessionMode",
      /a role may set only executable, model and effort/iu
    ]
  ];
  for (const [value, fieldPath, guidance] of cases) {
    const defect = defectOf(parseLocalModelLayer(value));
    assert.equal(defect.code, "LOCAL_CONFIG_KEY_REFUSED", fieldPath);
    assert.equal(defect.cause, "refused_key");
    assert.equal(defect.fieldPath, fieldPath);
    assert.match(defect.message, guidance);
    assert.ok(
      defect.message.startsWith(
        `In .banzai/config.local.json, ${fieldPath} is not allowed.`
      ),
      defect.message
    );
    assertValueFree(defect);
  }
});

test("a key that is not a plain identifier is never named", () => {
  const unsafeKeys = [
    "__proto__",
    "CANARY-KEY",
    "1CANARY",
    "CANARY\u001b[31m",
    `CANARY${"k".repeat(64)}`,
    ""
  ];
  for (const key of unsafeKeys) {
    for (const [value, fieldPath] of [
      [
        JSON.parse(`{"schemaVersion":1,"models":{},${JSON.stringify(key)}:1}`),
        "an unsupported key"
      ],
      [
        JSON.parse(`{"schemaVersion":1,"models":{${JSON.stringify(key)}:{}}}`),
        "an unsupported key in models"
      ],
      [
        JSON.parse(
          `{"schemaVersion":1,"models":{"reviewer":{"executable":"claude","model":"m","effort":"low",${JSON.stringify(key)}:1}}}`
        ),
        "an unsupported key in models.reviewer"
      ]
    ] as [unknown, string][]) {
      const defect = defectOf(parseLocalModelLayer(value));
      assert.equal(defect.code, "LOCAL_CONFIG_KEY_REFUSED", key);
      assert.equal(defect.fieldPath, fieldPath);
      if (key.length > 0) assert.ok(!defect.message.includes(key), key);
      assertValueFree(defect);
    }
  }
});

test("every other defect fails with LOCAL_CONFIG_INVALID without echoing a value", () => {
  const cases: [unknown, string][] = [
    [[], ".banzai/config.local.json"],
    [null, ".banzai/config.local.json"],
    ["CANARY-ROOT", ".banzai/config.local.json"],
    [{ models: {} }, "schemaVersion"],
    [file({}, { schemaVersion: 2 }), "schemaVersion"],
    [file({}, { schemaVersion: "1" }), "schemaVersion"],
    [file({}, { schemaVersion: 1.5 }), "schemaVersion"],
    [{ schemaVersion: 1 }, "models"],
    [file(["CANARY-ARRAY"]), "models"],
    [file(null), "models"],
    [file("CANARY-MODELS"), "models"],
    [file({ reviewer: ["CANARY"] }), "models.reviewer"],
    [file({ reviewer: "CANARY-ROLE" }), "models.reviewer"],
    [file({ reviewer: null }), "models.reviewer"],
    [
      file({ reviewer: { model: "m", effort: "low" } }),
      "models.reviewer.executable"
    ],
    [
      file({ reviewer: { executable: "claude", effort: "low" } }),
      "models.reviewer.model"
    ],
    [
      file({ reviewer: { executable: "claude", model: "m" } }),
      "models.reviewer.effort"
    ],
    [
      file({
        reviewer: triple({ executable: "/usr/local/bin/CANARY/claude" })
      }),
      "models.reviewer.executable"
    ],
    [
      file({ reviewer: triple({ executable: "./claude" }) }),
      "models.reviewer.executable"
    ],
    [
      file({ reviewer: triple({ executable: "Claude" }) }),
      "models.reviewer.executable"
    ],
    [
      file({ reviewer: triple({ executable: "CODEX" }) }),
      "models.reviewer.executable"
    ],
    [
      file({ reviewer: triple({ executable: "node" }) }),
      "models.reviewer.executable"
    ],
    [
      file({ reviewer: triple({ executable: "claude " }) }),
      "models.reviewer.executable"
    ],
    [
      file({ reviewer: triple({ executable: 1 }) }),
      "models.reviewer.executable"
    ],
    [file({ reviewer: triple({ model: "" }) }), "models.reviewer.model"],
    [file({ reviewer: triple({ model: "-CANARY" }) }), "models.reviewer.model"],
    [
      file({ reviewer: triple({ model: "CANARY model" }) }),
      "models.reviewer.model"
    ],
    [
      file({ reviewer: triple({ model: "CANARY\u001b]8;;x" }) }),
      "models.reviewer.model"
    ],
    [
      file({ reviewer: triple({ model: `CANARY${"x".repeat(123)}` }) }),
      "models.reviewer.model"
    ],
    [file({ reviewer: triple({ model: 7 }) }), "models.reviewer.model"],
    [
      file({ reviewer: triple({ effort: "CANARY-EFFORT" }) }),
      "models.reviewer.effort"
    ],
    [file({ reviewer: triple({ effort: "ULTRA" }) }), "models.reviewer.effort"],
    [file({ reviewer: triple({ effort: null }) }), "models.reviewer.effort"]
  ];
  for (const [value, fieldPath] of cases) {
    const defect = defectOf(parseLocalModelLayer(value));
    assert.equal(defect.code, "LOCAL_CONFIG_INVALID", fieldPath);
    assert.equal(defect.cause, "invalid");
    assert.equal(defect.fieldPath, fieldPath, JSON.stringify(value));
    assert.match(
      defect.message,
      new RegExp(fieldPath.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u")
    );
    assertValueFree(defect);
  }
});

test("closed keys are checked before values at each level", () => {
  const defect = defectOf(
    parseLocalModelLayer({ schemaVersion: 2, models: "x", extra: 1 })
  );
  assert.equal(defect.code, "LOCAL_CONFIG_KEY_REFUSED");
  assert.equal(defect.fieldPath, "extra");
  const role = defectOf(
    parseLocalModelLayer(
      file({ reviewer: triple({ executable: "node", timeoutMs: 1 }) })
    )
  );
  assert.equal(role.code, "LOCAL_CONFIG_KEY_REFUSED");
  assert.equal(role.fieldPath, "models.reviewer.timeoutMs");
});

test("a models map validates on its own for records in another envelope", () => {
  assert.deepEqual(parseLocalModelMap({ reviewer: triple() }), {
    ok: true,
    models: LOCAL_REVIEWER
  });
  const defect = defectOf(
    parseLocalModelMap({ reviewer: triple({ timeoutMs: 1 }) })
  );
  assert.equal(defect.code, "LOCAL_CONFIG_KEY_REFUSED");
  assert.equal(defect.fieldPath, "models.reviewer.timeoutMs");
});

test("undecodable bytes and malformed JSON name the file and never the parser text", () => {
  const utf8 = defectOf(
    parseLocalModelFile(Uint8Array.from([0x7b, 0xff, 0xfe, 0x7d]))
  );
  assert.equal(utf8.code, "LOCAL_CONFIG_INVALID");
  assert.equal(utf8.fieldPath, LOCAL_CONFIG_FILE);
  assert.match(utf8.message, /not valid UTF-8/u);
  for (const text of [
    '{"schemaVersion": 1, "models": {CANARY}}',
    "",
    '{"schemaVersion": 1,'
  ]) {
    const json = defectOf(parseLocalModelFile(Buffer.from(text)));
    assert.equal(json.code, "LOCAL_CONFIG_INVALID");
    assert.equal(json.fieldPath, LOCAL_CONFIG_FILE);
    assert.equal(
      json.message,
      `.banzai/config.local.json is not valid JSON. ${CORRECTION}`
    );
  }
  const parsed = parseLocalModelFile(
    Buffer.from(localModelFileText(LOCAL_REVIEWER))
  );
  assert.deepEqual(parsed, { ok: true, models: LOCAL_REVIEWER });
});

test("each Git cause has its own LOCAL_CONFIG_NOT_IGNORED message", () => {
  const tracked = localConfigNotIgnoredDefect("tracked");
  assert.equal(tracked.code, "LOCAL_CONFIG_NOT_IGNORED");
  assert.equal(tracked.cause, "tracked");
  assert.match(tracked.message, /shared through Git/u);
  assert.match(tracked.message, /someone else's model choice/u);
  assert.match(
    tracked.message,
    /`git rm --cached \.banzai\/config\.local\.json`, review the local copy, and commit the removal\./u
  );
  const unignored = localConfigNotIgnoredDefect("not_ignored");
  assert.equal(unignored.cause, "not_ignored");
  assert.match(unignored.message, /`banzai model --local`/u);
  assert.match(
    unignored.message,
    /add the line \.banzai\/config\.local\.json to \.gitignore and commit it\./u
  );
  const negated = localConfigNotIgnoredDefect("negated");
  assert.equal(negated.code, "LOCAL_CONFIG_NOT_IGNORED");
  assert.equal(negated.cause, "not_ignored");
  assert.match(negated.message, /negation rule/u);
  assert.notEqual(negated.message, unignored.message);
  for (const defect of [tracked, unignored, negated]) {
    assert.equal(defect.fieldPath, LOCAL_CONFIG_FILE);
  }
});

test("only a path lstat reports missing is absent, and Git is not asked about it", async () => {
  await withTemporaryDirectory(async (root) => {
    assert.deepEqual(await readWith(root, UNUSED_PROBE), { state: "absent" });
    await mkdir(path.join(root, ".banzai"));
    assert.deepEqual(await readWith(root, UNUSED_PROBE), { state: "absent" });

    await symlink("missing-target", path.join(root, LOCAL_CONFIG_FILE));
    const recorded = recordingProbe({ tracked: false, ignored: true });
    const dangling = defectiveOf(await readWith(root, recorded.probe));
    assert.equal(dangling.code, "LOCAL_CONFIG_INVALID");
    assert.equal(dangling.cause, "unsafe");
    assert.equal(dangling.fieldPath, LOCAL_CONFIG_FILE);
    assert.deepEqual(recorded.calls, [
      `index ${LOCAL_CONFIG_FILE}`,
      `ignore ${LOCAL_CONFIG_FILE}`
    ]);
  });
});

test("a symbolic link at .banzai/ is refused even without a local file", async () => {
  await withTemporaryDirectory(async (root) => {
    await mkdir(path.join(root, "elsewhere"));
    await symlink("elsewhere", path.join(root, ".banzai"));
    const empty = defectiveOf(await readWith(root, UNUSED_PROBE));
    assert.equal(empty.code, "LOCAL_CONFIG_INVALID");
    assert.equal(empty.cause, "unsafe");
    await writeFile(
      path.join(root, "elsewhere", "config.local.json"),
      localModelFileText(LOCAL_REVIEWER)
    );
    const linked = defectiveOf(await readWith(root, UNUSED_PROBE));
    assert.equal(linked.cause, "unsafe");
    assert.match(linked.message, /symbolic link/u);
    assert.ok(linked.message.endsWith(CORRECTION));
  });
  await withTemporaryDirectory(async (root) => {
    await writeFile(path.join(root, ".banzai"), "not a directory\n");
    assert.equal(
      defectiveOf(await readWith(root, UNUSED_PROBE)).cause,
      "unsafe"
    );
  });
});

test("unsafe, oversized and unreadable files are LOCAL_CONFIG_INVALID", async () => {
  await withTemporaryDirectory(async (root) => {
    await mkdir(path.join(root, ".banzai"));
    const target = path.join(root, LOCAL_CONFIG_FILE);
    await writeFile(path.join(root, "real.json"), "CANARY-TARGET\n");
    await symlink(path.join(root, "real.json"), target);
    const link = defectiveOf(await readWith(root));
    assert.equal(link.code, "LOCAL_CONFIG_INVALID");
    assert.equal(link.cause, "unsafe");
    assert.doesNotMatch(link.message, /CANARY/u);
    assert.equal(
      await readFile(path.join(root, "real.json"), "utf8"),
      "CANARY-TARGET\n"
    );
    await rm(target);

    await mkdir(target);
    assert.equal(defectiveOf(await readWith(root)).cause, "unsafe");
    await rm(target, { recursive: true });

    await execFileAsync("mkfifo", [target]);
    assert.equal(defectiveOf(await readWith(root)).cause, "unsafe");
    await rm(target);

    const canonical = localModelFileText(LOCAL_REVIEWER);
    await writeFile(
      target,
      canonical.trimEnd() +
        " ".repeat(LOCAL_CONFIG_LIMIT - canonical.length) +
        "\n"
    );
    assert.deepEqual(await readWith(root), {
      state: "valid",
      models: LOCAL_REVIEWER
    });
    await writeFile(
      target,
      canonical.trimEnd() +
        " ".repeat(LOCAL_CONFIG_LIMIT - canonical.length + 1) +
        "\n"
    );
    const oversized = defectiveOf(await readWith(root));
    assert.equal(oversized.code, "LOCAL_CONFIG_INVALID");
    assert.equal(oversized.cause, "invalid");
    assert.match(oversized.message, /larger than 64 KiB/u);

    if (process.getuid?.() !== 0) {
      await writeFile(target, canonical);
      await chmod(target, 0o000);
      try {
        const unreadable = defectiveOf(await readWith(root));
        assert.equal(unreadable.code, "LOCAL_CONFIG_INVALID");
        assert.equal(unreadable.cause, "unreadable");
      } finally {
        await chmod(target, 0o600);
      }
    }
  });
});

test("the reader checks the Git index, then the ignore state, then the contents", async () => {
  await withTemporaryDirectory(async (root) => {
    await mkdir(path.join(root, ".banzai"));
    await writeFile(path.join(root, LOCAL_CONFIG_FILE), "{CANARY");

    const tracked = recordingProbe({ tracked: true, ignored: true });
    const trackedDefect = defectiveOf(await readWith(root, tracked.probe));
    assert.equal(trackedDefect.code, "LOCAL_CONFIG_NOT_IGNORED");
    assert.equal(trackedDefect.cause, "tracked");
    assert.deepEqual(tracked.calls, [`index ${LOCAL_CONFIG_FILE}`]);

    const unignored = recordingProbe({ tracked: false, ignored: false });
    const unignoredDefect = defectiveOf(await readWith(root, unignored.probe));
    assert.equal(unignoredDefect.code, "LOCAL_CONFIG_NOT_IGNORED");
    assert.equal(unignoredDefect.cause, "not_ignored");
    assert.deepEqual(unignored.calls, [
      `index ${LOCAL_CONFIG_FILE}`,
      `ignore ${LOCAL_CONFIG_FILE}`
    ]);

    const ignored = recordingProbe({ tracked: false, ignored: true });
    const contents = defectiveOf(await readWith(root, ignored.probe));
    assert.equal(contents.code, "LOCAL_CONFIG_INVALID");
    assert.equal(contents.cause, "invalid");
  });
});

test("one visibility answers once per command and a new one asks Git again", async () => {
  await withTemporaryDirectory(async (root) => {
    await writeLocalModels(root, LOCAL_REVIEWER);
    const state = { tracked: false, ignored: true };
    const recorded = recordingProbe(state);
    const visibility = createLocalConfigVisibility(recorded.probe);
    for (let index = 0; index < 3; index += 1) {
      assert.equal(
        (await readLocalModelLayer(root, { visibility })).state,
        "valid"
      );
    }
    assert.equal(recorded.calls.length, 2);

    state.tracked = true;
    assert.equal(
      (await readLocalModelLayer(root, { visibility })).state,
      "valid",
      "the same command keeps its answer"
    );
    const next = defectiveOf(
      await readLocalModelLayer(root, {
        visibility: createLocalConfigVisibility(recorded.probe)
      })
    );
    assert.equal(next.cause, "tracked");
    assert.equal(recorded.calls.length, 3);
  });
});

test("a Git failure propagates and is never read as a file defect", async () => {
  await withTemporaryDirectory(async (root) => {
    await writeLocalModels(root, LOCAL_REVIEWER);
    const failure = new BanzaiError("GIT_FAILED", "git failed");
    await assert.rejects(
      readWith(root, {
        isPathInIndex: () => Promise.reject(failure),
        isPathIgnored: () => Promise.resolve(true)
      }),
      (error: unknown) => error === failure
    );
    await assert.rejects(
      readLocalModelLayer(root, { visibility: createLocalConfigVisibility() }),
      { code: "GIT_REPOSITORY_REQUIRED" }
    );
  });
});

test("the real Git probe distinguishes tracked, unignored and ignored files", async () => {
  const plain = await createTestRepository();
  const ignoring = await createTestRepository({ ignoreLocalConfig: true });
  try {
    await writeLocalModels(plain.root, LOCAL_REVIEWER);
    assert.equal(
      defectiveOf(
        await readLocalModelLayer(plain.root, {
          visibility: createLocalConfigVisibility()
        })
      ).cause,
      "not_ignored"
    );
    await execFileAsync("git", ["add", "--", LOCAL_CONFIG_FILE], {
      cwd: plain.root
    });
    assert.equal(
      defectiveOf(
        await readLocalModelLayer(plain.root, {
          visibility: createLocalConfigVisibility()
        })
      ).cause,
      "tracked"
    );

    await writeLocalModels(ignoring.root, LOCAL_REVIEWER);
    assert.deepEqual(
      await readLocalModelLayer(ignoring.root, {
        visibility: createLocalConfigVisibility()
      }),
      { state: "valid", models: LOCAL_REVIEWER }
    );
    await execFileAsync("git", ["add", "-f", "--", LOCAL_CONFIG_FILE], {
      cwd: ignoring.root
    });
    assert.equal(
      defectiveOf(
        await readLocalModelLayer(ignoring.root, {
          visibility: createLocalConfigVisibility()
        })
      ).cause,
      "tracked",
      "an ignore rule never hides a file that is in the index"
    );
  } finally {
    await plain.dispose();
    await ignoring.dispose();
  }
});

test("the effective configuration replaces whole triples and keeps every committed key", async () => {
  const repository = await createTestRepository({ ignoreLocalConfig: true });
  try {
    const committedText = await readFile(
      path.join(repository.root, ".banzai/config.json"),
      "utf8"
    );
    await writeLocalModels(repository.root, LOCAL_REVIEWER);
    const visibility = createLocalConfigVisibility();
    const layered = await readLayeredConfig(repository.root, { visibility });
    assert.ok(layered.effective !== null);
    assert.deepEqual(layered.local, { state: "valid", models: LOCAL_REVIEWER });
    const committed = layered.committed;
    assert.deepEqual(
      committed.models,
      (JSON.parse(committedText) as OrchestratorConfig).models
    );
    assert.deepEqual(layered.effective.sources, {
      planner: "committed",
      implementer: "committed",
      reviewer: "local"
    });
    assert.deepEqual(layered.effective.config.models.reviewer, {
      executable: "claude",
      model: "claude-opus-5-5",
      effort: "xhigh",
      timeoutMs: committed.models.reviewer.timeoutMs
    });
    assert.deepEqual(
      layered.effective.config.models.planner,
      committed.models.planner
    );
    assert.deepEqual(
      layered.effective.config.verification,
      committed.verification
    );
    assert.deepEqual(
      { ...layered.effective.config, models: committed.models },
      committed
    );
    const loaded = await loadConfig(repository.root, { visibility });
    assert.deepEqual(loaded, layered.effective.config);
    assert.equal(
      await readFile(path.join(repository.root, ".banzai/config.json"), "utf8"),
      committedText
    );

    await rm(path.join(repository.root, LOCAL_CONFIG_FILE));
    const absent = await loadEffectiveConfig(repository.root, {
      visibility: createLocalConfigVisibility()
    });
    assert.deepEqual(absent.models, {});
    assert.deepEqual(absent.config, committed);
    assert.deepEqual(absent.sources, {
      planner: "committed",
      implementer: "committed",
      reviewer: "committed"
    });
  } finally {
    await repository.dispose();
  }
});

test("the layered reader reports a defect while the effective loader refuses it", async () => {
  const repository = await createTestRepository();
  try {
    await writeLocalModels(repository.root, LOCAL_REVIEWER);
    const layered = await readLayeredConfig(repository.root, {
      visibility: createLocalConfigVisibility()
    });
    assert.equal(layered.effective, null);
    assert.equal(layered.local.state, "defective");
    await assert.rejects(
      loadConfig(repository.root, {
        visibility: createLocalConfigVisibility()
      }),
      (error: unknown) => {
        assert.ok(error instanceof LocalConfigError);
        assert.ok(error instanceof BanzaiError);
        assert.equal(error.code, "LOCAL_CONFIG_NOT_IGNORED");
        assert.equal(error.exitCode, 1);
        assert.equal(error.defect.cause, "not_ignored");
        return true;
      }
    );

    await writeFile(
      path.join(repository.root, ".gitignore"),
      `${LOCAL_CONFIG_IGNORE_LINE}\n`,
      { flag: "a" }
    );
    await writeFile(
      path.join(repository.root, LOCAL_CONFIG_FILE),
      JSON.stringify(file({ reviewer: triple({ timeoutMs: 1 }) }))
    );
    await assert.rejects(
      loadEffectiveConfig(repository.root, {
        visibility: createLocalConfigVisibility()
      }),
      { name: "LocalConfigError", code: "LOCAL_CONFIG_KEY_REFUSED" }
    );

    await rm(path.join(repository.root, ".banzai/config.json"));
    await assert.rejects(
      readLayeredConfig(repository.root, {
        visibility: createLocalConfigVisibility()
      }),
      { code: "CONFIG_NOT_FOUND" }
    );
  } finally {
    await repository.dispose();
  }
});

test("merging never changes the committed object and copies the layer", () => {
  const committed = structuredClone(DEFAULT_CONFIG);
  const before = structuredClone(committed);
  const layer: LocalModelLayer = {
    planner: { executable: "codex", model: "gpt-6.1-sol", effort: "ultra" }
  };
  const merged = mergeModelLayer(committed, layer);
  assert.deepEqual(committed, before);
  assert.equal(merged.config.models.planner.executable, "codex");
  assert.equal(merged.config.models.planner.effort, "ultra");
  assert.equal(
    merged.config.models.planner.timeoutMs,
    committed.models.planner.timeoutMs
  );
  assert.deepEqual(merged.config.models.reviewer, committed.models.reviewer);
  assert.deepEqual(merged.models, layer);
  assert.notEqual(merged.models.planner, layer.planner);
  assert.deepEqual(merged.sources, {
    planner: "local",
    implementer: "committed",
    reviewer: "committed"
  });
});

test("layers compare by role triples, whatever the formatting", () => {
  const canonical = parseLocalModelFile(
    Buffer.from(localModelFileText(LOCAL_REVIEWER))
  );
  const reformatted = parseLocalModelFile(
    Buffer.from(
      '{"models":{"reviewer":{"effort":"xhigh","model":"claude-opus-5-5","executable":"claude"}},"schemaVersion":1}'
    )
  );
  assert.ok(canonical.ok && reformatted.ok);
  assert.ok(sameModelLayer(canonical.models, reformatted.models));
  assert.ok(sameModelLayer({}, {}));
  assert.ok(sameModelLayer(localModelsOf({ state: "absent" }), {}));
  assert.ok(sameModelLayer(localModelsOf({ state: "valid", models: {} }), {}));
  const defective = localModelsOf({
    state: "defective",
    defect: localConfigNotIgnoredDefect("tracked")
  });
  assert.equal(defective, null);
  assert.equal(sameModelLayer(defective, {}), false);
  assert.equal(sameModelLayer({}, defective), false);
  assert.equal(sameModelLayer(null, null), false);
  assert.equal(sameModelLayer(LOCAL_REVIEWER, {}), false);
  for (const change of [
    { executable: "codex" },
    { model: "claude-sonnet-5-5" },
    { effort: "max" }
  ] as const) {
    assert.equal(
      sameModelLayer(LOCAL_REVIEWER, {
        reviewer: { ...REVIEWER_TRIPLE, ...change }
      }),
      false
    );
  }
  assert.equal(
    sameModelLayer(LOCAL_REVIEWER, {
      planner: REVIEWER_TRIPLE
    }),
    false
  );
});

test("fixtures commit the exact ignore line only when asked and write canonical bytes", async () => {
  const plain = await createTestRepository();
  const ignoring = await createTestRepository({ ignoreLocalConfig: true });
  try {
    const plainIgnore = await readFile(
      path.join(plain.root, ".gitignore"),
      "utf8"
    );
    assert.ok(!plainIgnore.split("\n").includes(LOCAL_CONFIG_IGNORE_LINE));
    const lines = (
      await readFile(path.join(ignoring.root, ".gitignore"), "utf8")
    ).split("\n");
    assert.equal(
      lines.filter((line) => line === ".banzai/config.local.json").length,
      1
    );
    const { stdout } = await execFileAsync("git", ["status", "--porcelain"], {
      cwd: ignoring.root
    });
    assert.equal(stdout, "");

    const written = await writeLocalModels(ignoring.root, {
      reviewer: REVIEWER_TRIPLE,
      planner: { executable: "codex", model: "gpt-6.1-sol", effort: "high" }
    });
    assert.equal(
      written,
      path.join(ignoring.root, ".banzai/config.local.json")
    );
    assert.equal(
      await readFile(written, "utf8"),
      [
        "{",
        '  "schemaVersion": 1,',
        '  "models": {',
        '    "planner": {',
        '      "executable": "codex",',
        '      "model": "gpt-6.1-sol",',
        '      "effort": "high"',
        "    },",
        '    "reviewer": {',
        '      "executable": "claude",',
        '      "model": "claude-opus-5-5",',
        '      "effort": "xhigh"',
        "    }",
        "  }",
        "}",
        ""
      ].join("\n")
    );
    const after = await execFileAsync("git", ["status", "--porcelain"], {
      cwd: ignoring.root
    });
    assert.equal(
      after.stdout,
      "",
      "an ignored local file keeps git status clean"
    );
  } finally {
    await plain.dispose();
    await ignoring.dispose();
  }
});

test("vendor PATH shims let a bare claude reviewer run on the fake adapters", async () => {
  const previousPath = process.env.PATH;
  const repository = await createTestRepository({ ignoreLocalConfig: true });
  try {
    await withVendorExecutablesOnPath(async (shims) => {
      assert.equal(process.env.PATH?.split(path.delimiter)[0], shims.directory);
      assert.equal(
        shims.env({ PATH: "/bin" }).PATH,
        `${shims.directory}${path.delimiter}/bin`
      );
      const configPath = path.join(repository.root, ".banzai/config.json");
      const config = JSON.parse(
        await readFile(configPath, "utf8")
      ) as OrchestratorConfig;
      config.models.reviewer.executable = "claude";
      config.models.reviewer.model = "claude-opus-5-5";
      await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
      await commitAll(repository.root, "bare claude reviewer");

      const adapters = new FakeAdapters();
      adapters.reviewResults.push(passingReview());
      const executables: string[] = [];
      adapters.onReview = (request) => {
        executables.push(request.settings.executable);
        return Promise.resolve();
      };
      const runner = new WorkflowRunner(repository.root, adapters);
      const planned = await runner.start({
        slug: "shimmed-reviewer",
        request: "Implement it."
      });
      assert.equal(
        planned.status,
        "needs_plan_approval",
        planned.blockReason ?? ""
      );
      const done = await runner.approvePlan("human", true);
      assert.equal(done.status, "done", done.blockReason ?? "");
      assert.deepEqual(executables, ["claude"]);
      assert.equal(adapters.claudePreflights > 0, true);
    });
    assert.equal(process.env.PATH, previousPath);
  } finally {
    process.env.PATH = previousPath;
    await repository.dispose();
  }
});

const PLANNER_TRIPLE: LocalModelTriple = {
  executable: "codex",
  model: "gpt-6.1-sol",
  effort: "high"
};

async function gitIn(root: string, args: string[]): Promise<string> {
  return (await execFileAsync("git", args, { cwd: root })).stdout;
}

async function readOrNull(target: string): Promise<string | null> {
  try {
    return await readFile(target, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function notIgnoredCause(cause: "tracked" | "not_ignored") {
  return (error: unknown): boolean =>
    error instanceof LocalConfigError &&
    error.code === "LOCAL_CONFIG_NOT_IGNORED" &&
    error.defect.cause === cause;
}

function unsafeLocalFile(error: unknown): boolean {
  return (
    error instanceof LocalConfigError &&
    error.code === "LOCAL_CONFIG_INVALID" &&
    error.defect.cause === "unsafe"
  );
}

test("the local writer publishes canonical bytes with mode 0600 and deletes an empty layer", async () => {
  const repository = await createTestRepository({ ignoreLocalConfig: true });
  try {
    const root = repository.root;
    const target = path.join(root, LOCAL_CONFIG_FILE);
    const shared = [".gitignore", ".banzai/config.json"].map((relative) =>
      path.join(root, relative)
    );
    const sharedBefore = await Promise.all(shared.map((p) => readFile(p)));

    // Roles in any insertion order come out in planner, implementer, reviewer order.
    const layer: LocalModelLayer = {
      reviewer: REVIEWER_TRIPLE,
      planner: PLANNER_TRIPLE
    };
    assert.equal(renderLocalModelFile(layer), localModelFileText(layer));
    assert.equal(await writeLocalModelLayer(root, layer), "written");
    assert.equal(await readFile(target, "utf8"), localModelFileText(layer));
    assert.equal((await stat(target)).mode & 0o777, 0o600);
    assert.deepEqual(
      (await readdir(path.join(root, ".banzai"))).filter((name) =>
        name.endsWith(".tmp")
      ),
      []
    );
    assert.deepEqual(
      await readLocalModelLayer(root, {
        visibility: createLocalConfigVisibility()
      }),
      {
        state: "valid",
        models: { planner: PLANNER_TRIPLE, reviewer: REVIEWER_TRIPLE }
      }
    );

    assert.equal(await writeLocalModelLayer(root, LOCAL_REVIEWER), "written");
    assert.equal(
      await readFile(target, "utf8"),
      localModelFileText(LOCAL_REVIEWER)
    );
    assert.equal(await writeLocalModelLayer(root, {}), "deleted");
    await assert.rejects(lstat(target), /ENOENT/);
    assert.equal(await writeLocalModelLayer(root, {}), "unchanged");

    assert.deepEqual(
      await Promise.all(shared.map((p) => readFile(p))),
      sharedBefore
    );
    assert.equal(await gitIn(root, ["status", "--porcelain"]), "");
  } finally {
    await repository.dispose();
  }
});

test("the local writer validates the layer before it asks Git or writes", async () => {
  await withTemporaryDirectory(async (root) => {
    await mkdir(path.join(root, ".banzai"));
    for (const invalid of [
      { reviewer: { ...REVIEWER_TRIPLE, executable: "/usr/bin/claude" } },
      { reviewer: { ...REVIEWER_TRIPLE, model: "bad model" } }
    ]) {
      await assert.rejects(
        writeLocalModelLayer(root, invalid as LocalModelLayer, {
          probe: UNUSED_PROBE
        }),
        (error: unknown) =>
          error instanceof LocalConfigError &&
          error.code === "LOCAL_CONFIG_INVALID"
      );
    }
    await assert.rejects(lstat(path.join(root, LOCAL_CONFIG_FILE)), /ENOENT/);
  });
});

test("the local writer asks the index before the ignore state", async () => {
  await withTemporaryDirectory(async (root) => {
    await mkdir(path.join(root, ".banzai"));
    const tracked = recordingProbe({ tracked: true, ignored: true });
    await assert.rejects(
      writeLocalModelLayer(root, LOCAL_REVIEWER, { probe: tracked.probe }),
      notIgnoredCause("tracked")
    );
    assert.deepEqual(tracked.calls, [`index ${LOCAL_CONFIG_FILE}`]);
    const unignored = recordingProbe({ tracked: false, ignored: false });
    await assert.rejects(
      writeLocalModelLayer(root, {}, { probe: unignored.probe }),
      notIgnoredCause("not_ignored")
    );
    assert.deepEqual(unignored.calls, [
      `index ${LOCAL_CONFIG_FILE}`,
      `ignore ${LOCAL_CONFIG_FILE}`
    ]);
    await assert.rejects(lstat(path.join(root, LOCAL_CONFIG_FILE)), /ENOENT/);
  });
});

test("the local writer refuses a path in the index even when no local file exists", async () => {
  const ignoring = await createTestRepository({ ignoreLocalConfig: true });
  const plain = await createTestRepository();
  try {
    const target = path.join(ignoring.root, LOCAL_CONFIG_FILE);
    await writeLocalModels(ignoring.root, LOCAL_REVIEWER);
    await gitIn(ignoring.root, ["add", "-f", "--", LOCAL_CONFIG_FILE]);
    await rm(target);
    for (const layer of [LOCAL_REVIEWER, {}]) {
      await assert.rejects(
        writeLocalModelLayer(ignoring.root, layer),
        (error) => {
          assert.ok(notIgnoredCause("tracked")(error));
          assert.match(
            (error as Error).message,
            /git rm --cached \.banzai\/config\.local\.json/u
          );
          return true;
        }
      );
      await assert.rejects(lstat(target), /ENOENT/);
    }

    // Without an ignore rule or exclude entry the writer refuses too.
    await assert.rejects(
      writeLocalModelLayer(plain.root, LOCAL_REVIEWER),
      notIgnoredCause("not_ignored")
    );
    await assert.rejects(
      lstat(path.join(plain.root, LOCAL_CONFIG_FILE)),
      /ENOENT/
    );
  } finally {
    await ignoring.dispose();
    await plain.dispose();
  }
});

test("the local writer never writes through a symbolic link and link targets stay unchanged", async () => {
  const repository = await createTestRepository({ ignoreLocalConfig: true });
  const outside = await mkdtemp(path.join(tmpdir(), "banzai-writer-outside-"));
  try {
    const root = repository.root;
    const target = path.join(root, LOCAL_CONFIG_FILE);
    const linkTarget = path.join(outside, "config.local.json");
    await writeFile(linkTarget, "outside\n");
    const before = await snapshotTree(outside);

    // A live link at the file, for a write and for a removal.
    await symlink(linkTarget, target);
    for (const layer of [LOCAL_REVIEWER, {}]) {
      await assert.rejects(writeLocalModelLayer(root, layer), unsafeLocalFile);
      assert.equal((await lstat(target)).isSymbolicLink(), true);
      assert.deepEqual(await snapshotTree(outside), before);
    }

    // A dangling link is never followed to create its target.
    await rm(target);
    await symlink(path.join(outside, "created.json"), target);
    await assert.rejects(
      writeLocalModelLayer(root, LOCAL_REVIEWER),
      unsafeLocalFile
    );
    assert.deepEqual(await snapshotTree(outside), before);

    // A directory where the file belongs.
    await rm(target);
    await mkdir(target);
    await assert.rejects(
      writeLocalModelLayer(root, LOCAL_REVIEWER),
      unsafeLocalFile
    );
    await rm(target, { recursive: true });

    // A link at .banzai/ is refused before Git is asked beyond it.
    const banzai = path.join(root, ".banzai");
    await rm(banzai, { recursive: true });
    await mkdir(path.join(outside, "state"));
    await symlink(path.join(outside, "state"), banzai);
    const linkedBefore = await snapshotTree(outside);
    await assert.rejects(
      writeLocalModelLayer(root, LOCAL_REVIEWER, { probe: UNUSED_PROBE }),
      unsafeLocalFile
    );
    assert.deepEqual(await snapshotTree(outside), linkedBefore);
    assert.equal(await readFile(linkTarget, "utf8"), "outside\n");
  } finally {
    await repository.dispose();
    await rm(outside, { recursive: true, force: true });
  }
});

test("the exclude step ignores the local file through the clone's exclude file only", async () => {
  const plain = await createTestRepository();
  const ignoring = await createTestRepository({ ignoreLocalConfig: true });
  try {
    const root = plain.root;
    const exclude = path.join(root, ".git", "info", "exclude");
    const gitignore = await readFile(path.join(root, ".gitignore"));
    assert.equal(await ensureLocalConfigExcluded(root), "excluded");
    assert.equal(
      (await readFile(exclude, "utf8"))
        .split("\n")
        .filter((line) => line === LOCAL_CONFIG_IGNORE_LINE).length,
      1
    );
    const excluded = await readFile(exclude, "utf8");
    assert.equal(await ensureLocalConfigExcluded(root), "ignored");
    assert.equal(await readFile(exclude, "utf8"), excluded);
    assert.deepEqual(await readFile(path.join(root, ".gitignore")), gitignore);
    await assert.rejects(lstat(path.join(root, LOCAL_CONFIG_FILE)), /ENOENT/);

    // An ignore rule already in .gitignore needs no exclude entry.
    const ignoringExclude = path.join(ignoring.root, ".git", "info", "exclude");
    const ignoringBefore = await readOrNull(ignoringExclude);
    assert.equal(await ensureLocalConfigExcluded(ignoring.root), "ignored");
    assert.equal(await readOrNull(ignoringExclude), ignoringBefore);

    // A local file written after the step stays out of git status.
    await writeLocalModelLayer(root, LOCAL_REVIEWER);
    assert.equal(await gitIn(root, ["status", "--porcelain"]), "");
  } finally {
    await plain.dispose();
    await ignoring.dispose();
  }
});

test("the exclude step refuses a path in the index without appending, even with no local file", async () => {
  const repository = await createTestRepository();
  try {
    const root = repository.root;
    const exclude = path.join(root, ".git", "info", "exclude");
    await writeLocalModels(root, LOCAL_REVIEWER);
    await gitIn(root, ["add", "--", LOCAL_CONFIG_FILE]);
    await rm(path.join(root, LOCAL_CONFIG_FILE));
    const before = await readOrNull(exclude);
    await assert.rejects(
      ensureLocalConfigExcluded(root),
      notIgnoredCause("tracked")
    );
    assert.equal(await readOrNull(exclude), before);
  } finally {
    await repository.dispose();
  }
});

test("the exclude step names a .gitignore negation that keeps the file visible", async () => {
  const repository = await createTestRepository();
  try {
    const root = repository.root;
    await writeFile(
      path.join(root, ".gitignore"),
      `!${LOCAL_CONFIG_IGNORE_LINE}\n`,
      { flag: "a" }
    );
    const gitignore = await readFile(path.join(root, ".gitignore"));
    await assert.rejects(ensureLocalConfigExcluded(root), (error) => {
      assert.ok(notIgnoredCause("not_ignored")(error));
      assert.match((error as Error).message, /negation rule/u);
      return true;
    });
    assert.deepEqual(await readFile(path.join(root, ".gitignore")), gitignore);
  } finally {
    await repository.dispose();
  }
});

test("the exclude step asks the index first and refuses a linked .banzai/ before Git", async () => {
  const calls: string[] = [];
  const git = (state: {
    tracked: boolean;
    ignored: boolean[];
  }): LocalConfigExcludeGit => ({
    isPathInIndex: () => {
      calls.push("index");
      return Promise.resolve(state.tracked);
    },
    isPathIgnored: () => {
      calls.push("ignore");
      return Promise.resolve(state.ignored.shift() ?? false);
    },
    appendCloneExcludeLine: (_root, line) => {
      calls.push(`append ${line}`);
      return Promise.resolve("appended");
    }
  });
  await withTemporaryDirectory(async (root) => {
    assert.equal(
      await ensureLocalConfigExcluded(
        root,
        git({ tracked: false, ignored: [false, true] })
      ),
      "excluded"
    );
    assert.deepEqual(calls, [
      "index",
      "ignore",
      `append ${LOCAL_CONFIG_IGNORE_LINE}`,
      "ignore"
    ]);
    calls.length = 0;
    await assert.rejects(
      ensureLocalConfigExcluded(root, git({ tracked: true, ignored: [] })),
      notIgnoredCause("tracked")
    );
    assert.deepEqual(calls, ["index"]);
    calls.length = 0;
    await mkdir(path.join(root, "elsewhere"));
    await symlink(path.join(root, "elsewhere"), path.join(root, ".banzai"));
    await assert.rejects(
      ensureLocalConfigExcluded(root, git({ tracked: false, ignored: [] })),
      unsafeLocalFile
    );
    assert.deepEqual(calls, []);
  });
  assert.equal(typeof LOCAL_CONFIG_GIT.appendCloneExcludeLine, "function");
});

/** A real probe that swaps `.banzai/` for a link right after Git answers. */
function swappingProbe(swap: () => Promise<void>): LocalConfigGitProbe {
  return {
    isPathInIndex: async (root, relative) =>
      await LOCAL_CONFIG_GIT.isPathInIndex(root, relative),
    isPathIgnored: async (root, relative) => {
      const ignored = await LOCAL_CONFIG_GIT.isPathIgnored(root, relative);
      await swap();
      return ignored;
    }
  };
}

test("a .banzai/ swapped for a link while the writer runs receives no file", async () => {
  const repository = await createTestRepository({ ignoreLocalConfig: true });
  const outside = await mkdtemp(path.join(tmpdir(), "banzai-local-swap-"));
  try {
    const root = repository.root;
    const banzai = path.join(root, ".banzai");
    const moved = path.join(root, ".banzai-moved");
    const outsideTarget = path.join(outside, "config.local.json");
    const swapTo = (target: string) => async () => {
      await rename(banzai, moved);
      await symlink(target, banzai);
    };
    const restore = async () => {
      await rm(banzai);
      await rename(moved, banzai);
    };
    const temporaries = async (directory: string) =>
      (await readdir(directory)).filter((name) => name.endsWith(".tmp"));
    await writeFile(outsideTarget, "outside\n");
    const before = await snapshotTree(outside);
    await writeLocalModels(root, LOCAL_REVIEWER);
    const localBefore = await readFile(
      path.join(root, LOCAL_CONFIG_FILE),
      "utf8"
    );

    // Swapped while Git is asked: refused before the temporary file opens.
    await assert.rejects(
      writeLocalModelLayer(
        root,
        { planner: PLANNER_TRIPLE },
        { probe: swappingProbe(swapTo(outside)) }
      ),
      unsafeLocalFile
    );
    assert.deepEqual(await snapshotTree(outside), before);
    assert.deepEqual(await temporaries(moved), []);
    await restore();

    // The same for the delete of an empty layer.
    await assert.rejects(
      writeLocalModelLayer(root, {}, { probe: swappingProbe(swapTo(outside)) }),
      unsafeLocalFile
    );
    assert.deepEqual(await snapshotTree(outside), before);
    await restore();

    // Swapped after the temporary file was written: refused before the
    // rename, and nothing lands beyond the link.
    await assert.rejects(
      writeLocalModelLayer(
        root,
        { planner: PLANNER_TRIPLE },
        { beforeRename: swapTo(outside) }
      ),
      unsafeLocalFile
    );
    assert.deepEqual(await snapshotTree(outside), before);
    assert.equal(
      await readFile(path.join(moved, "config.local.json"), "utf8"),
      localBefore
    );
    // The temporary file stays where it was created; the writer never
    // deletes through a link it did not create.
    const stranded = await temporaries(moved);
    assert.equal(stranded.length, 1);
    await rm(path.join(moved, stranded[0] ?? ""));
    await restore();

    // A link back to the moved directory still refuses, and the cleanup
    // removes the writer's own temporary file through it.
    await assert.rejects(
      writeLocalModelLayer(
        root,
        { planner: PLANNER_TRIPLE },
        { beforeRename: swapTo(".banzai-moved") }
      ),
      unsafeLocalFile
    );
    assert.deepEqual(await temporaries(moved), []);
    assert.equal(
      await readFile(path.join(moved, "config.local.json"), "utf8"),
      localBefore
    );
    await restore();

    // Without a swap the writer publishes.
    assert.equal(
      await writeLocalModelLayer(root, { planner: PLANNER_TRIPLE }),
      "written"
    );
    assert.deepEqual(await temporaries(banzai), []);
    assert.deepEqual(await snapshotTree(outside), before);
  } finally {
    await repository.dispose();
    await rm(outside, { recursive: true, force: true });
  }
});
