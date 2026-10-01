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
  modelCliMinimum,
  SELECTABLE_MODELS,
  vendorFor,
  vendorUsage
} from "../src/models.js";
import type { OrchestratorConfig } from "../src/types.js";
import { reviewerOnlyClaudeConfig } from "./helpers.js";

function configWith(models: {
  planner?: string;
  implementer?: string;
  reviewer?: string;
}): OrchestratorConfig {
  const config = reviewerOnlyClaudeConfig();
  config.models.planner.model = models.planner ?? config.models.planner.model;
  config.models.implementer.model =
    models.implementer ?? config.models.implementer.model;
  config.models.reviewer.model =
    models.reviewer ?? config.models.reviewer.model;
  return config;
}

test("the shipped default configuration uses only current models", () => {
  assert.deepEqual(modelAdvisories(DEFAULT_CONFIG), []);
  assert.deepEqual(
    configuredModels(DEFAULT_CONFIG).map((entry) => [
      entry.executable,
      entry.model,
      entry.effort
    ]),
    [
      ["claude", "claude-opus-5-5", "xhigh"],
      ["claude", "claude-opus-5-5", "xhigh"],
      ["codex", "gpt-6.1-sol", "xhigh"]
    ]
  );
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
      replacement: "claude-opus-5-5",
      standing: "superseded"
    }
  );
  assert.equal(
    superseded[0]?.detail,
    "claude-opus-4-7 is superseded by claude-opus-5-5."
  );

  const deprecated = modelAdvisories(
    configWith({ reviewer: "claude-sonnet-4-5" })
  );
  assert.equal(deprecated[0]?.standing, "deprecated");
  assert.equal(
    deprecated[0].detail,
    "claude-sonnet-4-5 is deprecated and retires 2026-11-30; claude-sonnet-5-5 replaces it."
  );

  const retired = modelAdvisories(configWith({ reviewer: "claude-opus-4-1" }));
  assert.equal(retired[0]?.standing, "retired");
  assert.equal(
    retired[0].detail,
    "claude-opus-4-1 was retired 2026-08-05; claude-opus-5-5 replaces it."
  );

  const incompatibleCodex = modelAdvisories(configWith({ planner: "gpt-5" }));
  assert.equal(incompatibleCodex.length, 1);
  const [codexAdvisory] = incompatibleCodex;
  assert.ok(codexAdvisory);
  assert.equal(codexAdvisory.replacement, "gpt-6.1-sol");
  assert.equal(codexAdvisory.detail, "gpt-5 is superseded by gpt-6.1-sol.");

  const retiringCodex = modelAdvisories(configWith({ planner: "gpt-5.5" }));
  assert.equal(retiringCodex[0]?.standing, "deprecated");
  assert.equal(
    retiringCodex[0].detail,
    "gpt-5.5 is deprecated and retires 2026-10-14; gpt-6.1-sol replaces it."
  );
});

test("supported models, tier aliases, and unknown identifiers raise no advisory", () => {
  for (const model of [
    "claude-opus-5-5",
    "claude-sonnet-5-5",
    "claude-fable-5-1",
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

test("models newer than the vendor CLI minimum name the release that first serves them", () => {
  assert.deepEqual(
    SELECTABLE_MODELS.flatMap((model) => {
      const minimum = modelCliMinimum(model.vendor, model.id);
      return minimum === null ? [] : [[model.id, minimum]];
    }),
    [
      ["claude-opus-5-5", "2.1.280"],
      ["claude-fable-5-1", "2.1.257"],
      ["claude-sonnet-5-5", "2.1.284"],
      ["gpt-6.1-sol", "0.159.1"],
      ["gpt-6-astra", "0.153.1"],
      ["gpt-6-sol", "0.156.1"],
      ["gpt-6-luna", "0.156.1"]
    ]
  );
  // Tier aliases resolve to a model the installed client already serves, and
  // an unknown identifier carries no claim about the release it needs.
  for (const model of ["opus", "sonnet", "default", "claude-later-model"]) {
    assert.equal(modelCliMinimum("claude", model), null, model);
  }
  assert.equal(modelCliMinimum("codex", "claude-opus-5-5"), null);
});

test("every selectable model raises no advisory", () => {
  for (const model of SELECTABLE_MODELS) {
    const config = configWith({});
    config.models.reviewer.executable = model.executable;
    config.models.reviewer.model = model.id;
    assert.deepEqual(
      modelAdvisories(config),
      [],
      `${model.id} is offered, so it must not be reported as stale`
    );
  }
});

test("advisories cover every role and preserve role order", () => {
  // The fixture planner and implementer run on codex. A Claude identifier under
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

  const claudeEverywhere = configWith({ reviewer: "claude-opus-4-7" });
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
  assert.deepEqual(
    modelAdvisories(claudeEverywhere).map((advisory) => [
      advisory.role,
      advisory.replacement
    ]),
    [
      ["planner", "claude-opus-5-5"],
      ["implementer", "claude-sonnet-5-5"],
      ["reviewer", "claude-opus-5-5"]
    ]
  );
});

test("vendor usage groups roles by the executable that runs them", () => {
  const usage = vendorUsage(configWith({}));
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
  const config = configWith({});
  config.models.planner.executable = "claude";
  config.models.planner.model = "claude-opus-5-5";
  config.models.implementer.executable = "claude";
  config.models.implementer.model = "claude-opus-5-5";

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
  const config = configWith({});
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
  const entries = configuredModels(configWith({}));
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
    assert.equal(raw.schemaVersion, 4);
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
