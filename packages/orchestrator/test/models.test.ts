import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  applyModelUpdates,
  CONFIG_FILE,
  DEFAULT_CONFIG,
  initializeConfig,
  loadConfig
} from "../src/config.js";
import { BanzaiError } from "../src/errors.js";
import {
  configuredModels,
  describeRoles,
  modelAdvisories,
  SELECTABLE_MODELS,
  vendorFor,
  vendorUsage
} from "../src/models.js";
import type { OrchestratorConfig } from "../src/types.js";

function configWith(models: {
  planner?: string;
  implementer?: string;
  reviewer?: string;
}): OrchestratorConfig {
  const config = structuredClone(DEFAULT_CONFIG);
  config.models.planner.model = models.planner ?? config.models.planner.model;
  config.models.implementer.model =
    models.implementer ?? config.models.implementer.model;
  config.models.reviewer.model =
    models.reviewer ?? config.models.reviewer.model;
  return config;
}

test("the shipped default configuration uses only current models", () => {
  assert.deepEqual(modelAdvisories(DEFAULT_CONFIG), []);
  assert.equal(DEFAULT_CONFIG.models.reviewer.model, "claude-opus-5");
});

test("superseded, deprecated, and retired models each report a replacement", () => {
  const superseded = modelAdvisories(
    configWith({ reviewer: "claude-opus-4-7" })
  );
  assert.equal(superseded.length, 1);
  assert.deepEqual(
    {
      role: superseded[0]?.role,
      label: superseded[0]?.label,
      replacement: superseded[0]?.replacement,
      standing: superseded[0]?.standing
    },
    {
      role: "reviewer",
      label: "Review",
      replacement: "claude-opus-5",
      standing: "superseded"
    }
  );
  assert.equal(
    superseded[0]?.detail,
    "claude-opus-4-7 is superseded by claude-opus-5."
  );

  const deprecated = modelAdvisories(
    configWith({ reviewer: "claude-opus-4-1" })
  );
  assert.equal(deprecated[0]?.standing, "deprecated");
  assert.match(deprecated[0].detail, /retires 2026-08-05/);

  const retired = modelAdvisories(
    configWith({ reviewer: "claude-3-5-sonnet-20241022" })
  );
  assert.equal(retired[0]?.standing, "retired");
  assert.equal(retired[0].replacement, "claude-sonnet-5");

  const incompatibleCodex = modelAdvisories(configWith({ planner: "gpt-5" }));
  assert.equal(incompatibleCodex.length, 1);
  const [codexAdvisory] = incompatibleCodex;
  assert.ok(codexAdvisory);
  assert.equal(codexAdvisory.replacement, "gpt-5.5");
  assert.equal(codexAdvisory.detail, "gpt-5 is superseded by gpt-5.5.");
});

test("supported models, tier aliases, and unknown identifiers raise no advisory", () => {
  for (const model of [
    "claude-opus-5",
    "claude-opus-4-8",
    "claude-fable-5-1",
    "claude-fable-5",
    "claude-sonnet-5",
    "claude-sonnet-4-6",
    "claude-haiku-4-5",
    "opus",
    "sonnet",
    "claude-model-from-a-later-release"
  ]) {
    assert.deepEqual(
      modelAdvisories(configWith({ reviewer: model })),
      [],
      `${model} must not be reported as stale`
    );
  }
});

test("previous-generation selectable models raise no advisory", () => {
  const config = configWith({
    planner: "gpt-5.5",
    reviewer: "claude-opus-4-8"
  });
  config.models.implementer = {
    executable: "claude",
    model: "claude-sonnet-4-6",
    effort: "xhigh",
    timeoutMs: config.models.implementer.timeoutMs
  };

  assert.deepEqual(modelAdvisories(config), []);
});

test("advisories cover every role and preserve role order", () => {
  // The default planner and implementer run on codex. A Claude identifier under
  // the codex executable is unknown to the codex catalog, so it raises nothing.
  assert.deepEqual(
    modelAdvisories(
      configWith({
        planner: "claude-opus-4-6",
        implementer: "claude-sonnet-4-6"
      })
    ),
    []
  );

  const claudeEverywhere = structuredClone(DEFAULT_CONFIG);
  claudeEverywhere.models.planner = {
    executable: "claude",
    model: "claude-opus-4-6",
    effort: "xhigh",
    timeoutMs: 60_000
  };
  claudeEverywhere.models.implementer = {
    executable: "/usr/local/bin/claude",
    model: "claude-sonnet-4-5",
    effort: "xhigh",
    timeoutMs: 60_000
  };
  claudeEverywhere.models.reviewer.model = "claude-opus-4-7";
  assert.deepEqual(
    modelAdvisories(claudeEverywhere).map((advisory) => [
      advisory.role,
      advisory.replacement
    ]),
    [
      ["planner", "claude-opus-5"],
      ["implementer", "claude-sonnet-5"],
      ["reviewer", "claude-opus-5"]
    ]
  );
});

test("vendor usage groups roles by the executable that runs them", () => {
  const usage = vendorUsage(DEFAULT_CONFIG);
  assert.deepEqual(
    usage.map((entry) => [entry.executable, entry.vendor, entry.roles]),
    [
      ["codex", "codex", ["planner", "implementer"]],
      ["claude", "claude", ["reviewer"]]
    ]
  );
  assert.equal(
    describeRoles(usage[0]?.roles ?? []),
    "Planning, Implementation"
  );
});

test("vendor usage reports Claude for every role that runs it", () => {
  const config = structuredClone(DEFAULT_CONFIG);
  config.models.planner.executable = "claude";
  config.models.planner.model = "claude-opus-5";
  config.models.implementer.executable = "claude";
  config.models.implementer.model = "claude-opus-5";

  const usage = vendorUsage(config);
  assert.equal(usage.length, 1);
  assert.deepEqual(usage[0]?.roles, ["planner", "implementer", "reviewer"]);
  assert.equal(usage[0].vendor, "claude");
  assert.equal(
    describeRoles(usage[0].roles),
    "Planning, Implementation, Review"
  );
});

test("vendor usage keeps distinct executables separate and flags unknown ones", () => {
  const config = structuredClone(DEFAULT_CONFIG);
  config.models.planner.executable = "/opt/bin/claude";
  config.models.implementer.executable = "custom-runner";

  const usage = vendorUsage(config);
  assert.deepEqual(
    usage.map((entry) => [entry.executable, entry.vendor]),
    [
      ["/opt/bin/claude", "claude"],
      ["custom-runner", null],
      ["claude", "claude"]
    ]
  );
  assert.equal(vendorFor("/usr/local/bin/codex"), "codex");
  assert.equal(vendorFor("some-other-cli"), null);
});

test("every phase offers both vendors", () => {
  const vendors = new Set(SELECTABLE_MODELS.map((model) => model.vendor));
  assert.deepEqual([...vendors].sort(), ["claude", "codex"]);
});

test("configured models expose the role summary the interface renders", () => {
  const entries = configuredModels(DEFAULT_CONFIG);
  assert.deepEqual(
    entries.map((entry) => [entry.label, entry.executable, entry.timeout]),
    [
      ["Planning", "codex", "30m"],
      ["Implementation", "codex", "60m"],
      ["Review", "claude", "30m"]
    ]
  );
});

test("applying model updates rewrites only the named model fields", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "banzai-models-test-"));
  try {
    await initializeConfig(root);
    const configPath = path.join(root, CONFIG_FILE);
    const document = JSON.parse(await readFile(configPath, "utf8")) as Record<
      string,
      unknown
    >;
    // A field this version does not know about must survive the rewrite.
    document.futureField = { keep: true };
    const verification = structuredClone(document.verification);
    await writeFile(
      configPath,
      `${JSON.stringify(document, null, 2)}\n`,
      "utf8"
    );

    await applyModelUpdates(root, [
      { role: "reviewer", model: "claude-fable-5-1" }
    ]);

    const updated = await loadConfig(root);
    assert.equal(updated.models.reviewer.model, "claude-fable-5-1");
    assert.equal(updated.models.reviewer.effort, "xhigh");
    assert.equal(
      updated.models.reviewer.timeoutMs,
      DEFAULT_CONFIG.models.reviewer.timeoutMs
    );
    assert.equal(
      updated.models.planner.model,
      DEFAULT_CONFIG.models.planner.model
    );

    const raw = JSON.parse(await readFile(configPath, "utf8")) as Record<
      string,
      unknown
    >;
    assert.deepEqual(raw.futureField, { keep: true });
    assert.deepEqual(raw.verification, verification);
    assert.equal(raw.schemaVersion, 3);
    assert.match(await readFile(configPath, "utf8"), /\n$/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an empty update list leaves the configuration byte-identical", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "banzai-models-noop-"));
  try {
    await initializeConfig(root);
    const configPath = path.join(root, CONFIG_FILE);
    const before = await readFile(configPath, "utf8");
    await applyModelUpdates(root, []);
    assert.equal(await readFile(configPath, "utf8"), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("model updates never write a configuration the runner would reject", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "banzai-models-invalid-"));
  try {
    await initializeConfig(root);
    const configPath = path.join(root, CONFIG_FILE);
    const before = await readFile(configPath, "utf8");

    await assert.rejects(
      async () => {
        await applyModelUpdates(root, [{ role: "reviewer", model: "" }]);
      },
      (error: unknown) =>
        error instanceof BanzaiError && error.code === "INVALID_RESULT"
    );
    assert.equal(await readFile(configPath, "utf8"), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("model updates require an initialized project", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "banzai-models-missing-"));
  try {
    await assert.rejects(
      async () => {
        await applyModelUpdates(root, [
          { role: "reviewer", model: "claude-opus-5" }
        ]);
      },
      (error: unknown) =>
        error instanceof BanzaiError && error.code === "CONFIG_NOT_FOUND"
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
