import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import {
  applyModelUpdates,
  CONFIG_FILE,
  DEFAULT_CONFIG,
  initializeConfig,
  loadCommittedConfig
} from "../src/config.js";
import { BanzaiError, LocalConfigError } from "../src/errors.js";
import type { InteractiveChoice, InteractiveIO } from "../src/interactive.js";
import {
  MODEL_RETRY_LINE,
  applyLaunchModelUpdates,
  executeModelPicker,
  type ModelPickerHost,
  type ModelPickerRequest
} from "../src/model-cli.js";
import {
  chooseModelSettings,
  selectModelDestination,
  selectModelSettings
} from "../src/model-selection.js";
import { SELECTABLE_MODELS } from "../src/models.js";
import type {
  LocalModelLayer,
  ModelSettings,
  OrchestratorConfig
} from "../src/types.js";
import { WorkflowRunner } from "../src/workflow.js";
import {
  LOCAL_CONFIG_IGNORE_LINE,
  commitAll,
  createTestRepository,
  localModelFileText,
  reviewerOnlyClaudeConfig,
  withVendorExecutablesOnPath,
  writeLocalModels
} from "./helpers.js";
import { FakeAdapters, passingReview } from "./workflow-fixtures.js";

const execFileAsync = promisify(execFile);

class FakeIO implements InteractiveIO {
  async multiSelect<T>(): Promise<T[]> {
    throw new Error("Unexpected multi-select");
  }
  readonly lines: string[] = [];
  readonly prompts: string[] = [];
  readonly choiceValues: unknown[][] = [];
  readonly choiceNames: string[][] = [];
  readonly choiceDescriptions: (string | undefined)[][] = [];
  readonly confirmPrompts: string[] = [];

  constructor(
    readonly selections: unknown[],
    readonly confirmations: boolean[] = []
  ) {}

  async input(): Promise<string> {
    throw new Error("Unexpected input prompt");
  }

  async select<T>(
    message: string,
    choices: readonly InteractiveChoice<T>[]
  ): Promise<T> {
    this.prompts.push(message);
    this.choiceValues.push(choices.map((choice) => choice.value));
    this.choiceNames.push(choices.map((choice) => choice.name));
    this.choiceDescriptions.push(choices.map((choice) => choice.description));
    assert.notEqual(this.selections.length, 0, `Unexpected select: ${message}`);
    return this.selections.shift() as T;
  }

  async confirm(message: string): Promise<boolean> {
    this.confirmPrompts.push(message);
    assert.notEqual(this.confirmations.length, 0, "Unexpected confirmation");
    return this.confirmations.shift() ?? false;
  }

  writeLine(message = ""): void {
    this.lines.push(message);
  }
}

function baseConfig(): OrchestratorConfig {
  return reviewerOnlyClaudeConfig();
}

test("the picker offers current and earlier-generation models from both vendors", () => {
  assert.deepEqual(
    SELECTABLE_MODELS.map((model) => model.id),
    [
      "claude-opus-5-5",
      "claude-fable-5-1",
      "claude-sonnet-5-5",
      "claude-opus-5",
      "claude-fable-5",
      "claude-sonnet-5",
      "claude-opus-4-8",
      "claude-sonnet-4-6",
      "gpt-6.1-sol",
      "gpt-6-astra",
      "gpt-6-sol",
      "gpt-6-luna",
      "gpt-5.6-sol",
      "gpt-5.6-terra",
      "gpt-5.6-luna"
    ]
  );
  for (const model of SELECTABLE_MODELS) {
    assert.equal(
      model.executable,
      model.vendor === "claude" ? "claude" : "codex"
    );
  }
});

test("keeping every phase produces no update", async () => {
  const io = new FakeIO(["__keep__", "__keep__", "__keep__"]);

  const updates = await selectModelSettings(io, baseConfig());

  assert.deepEqual(updates, []);
  assert.ok(
    io.lines.includes("No phase changed; the configuration is unchanged.")
  );
  assert.equal(
    io.choiceNames[1]?.[0],
    "Keep gpt-6.1-sol (effort=xhigh) - matches Planning"
  );
  assert.match(
    io.choiceDescriptions[1]?.[0] ?? "",
    /Recommended for strict workflows/
  );
  assert.equal(io.choiceValues[1]?.includes("__match_planning__"), false);
  assert.equal(io.choiceValues[2]?.includes("__match_planning__"), false);
  assert.ok(
    io.lines.includes(
      "Strict builder session: eligible for Planning -> Implementation reuse when the saved planning session is valid."
    )
  );
});

test("choosing a model and effort per phase returns the vendor executable", async () => {
  const io = new FakeIO(
    ["gpt-5.6-terra", "high", "__keep__", "claude-fable-5-1", "max"],
    [true]
  );

  const updates = await selectModelSettings(io, baseConfig());

  assert.deepEqual(updates, [
    {
      role: "planner",
      model: "gpt-5.6-terra",
      executable: "codex",
      effort: "high"
    },
    {
      role: "reviewer",
      model: "claude-fable-5-1",
      executable: "claude",
      effort: "max"
    }
  ]);
  assert.ok(
    io.lines.some((line) =>
      line.includes(
        "Planning: codex gpt-6.1-sol effort=xhigh -> codex gpt-5.6-terra effort=high"
      )
    )
  );
  assert.equal(io.choiceValues[2]?.[0], "__match_planning__");
  assert.equal(
    io.choiceNames[2]?.[0],
    "Match Planning: GPT-5.6-Terra (gpt-5.6-terra), effort=high - recommended"
  );
  assert.ok(
    io.lines.includes(
      "Strict builder session: Implementation will start fresh from approved artifacts because executable, model, or effort differs from Planning."
    )
  );
});

test("implementation can adopt pending planning settings in one recommended choice", async () => {
  const io = new FakeIO(
    ["claude-fable-5-1", "max", "__match_planning__", "__keep__"],
    [true]
  );

  const updates = await selectModelSettings(io, baseConfig());

  assert.deepEqual(updates, [
    {
      role: "planner",
      model: "claude-fable-5-1",
      executable: "claude",
      effort: "max"
    },
    {
      role: "implementer",
      model: "claude-fable-5-1",
      executable: "claude",
      effort: "max"
    }
  ]);
  assert.deepEqual(io.prompts, [
    "Planning model",
    "Planning effort",
    "Implementation model",
    "Review model"
  ]);
  assert.ok(
    io.lines.includes("Planning selection: claude claude-fable-5-1 effort=max")
  );
  assert.ok(
    io.lines.includes(
      "Strict builder session: eligible for Planning -> Implementation reuse when the saved planning session is valid."
    )
  );
});

test("reselecting the configured model and effort is not a change", async () => {
  const io = new FakeIO(["__keep__", "gpt-6.1-sol", "xhigh", "__keep__"]);

  const updates = await selectModelSettings(io, baseConfig());

  assert.deepEqual(updates, []);
  assert.equal(
    io.choiceNames[2]?.[3],
    "xhigh - matches Planning; recommended for strict session reuse"
  );
});

test("effort choices are limited to what each model accepts", async () => {
  const io = new FakeIO(
    ["gpt-6-sol", "ultra", "gpt-6-luna", "high", "claude-sonnet-5-5", "xhigh"],
    [true]
  );

  await selectModelSettings(io, baseConfig());

  // GPT-6-Sol supports Codex's ultra tier; GPT-6-Luna and every Claude model do not.
  assert.deepEqual(io.choiceValues[1], [
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
    "ultra"
  ]);
  assert.deepEqual(io.choiceValues[3], [
    "low",
    "medium",
    "high",
    "xhigh",
    "max"
  ]);
  assert.deepEqual(io.choiceValues[5], [
    "low",
    "medium",
    "high",
    "xhigh",
    "max"
  ]);
});

test("earlier-generation models use their supported effort subsets", async () => {
  const io = new FakeIO(
    [
      "gpt-5.6-luna",
      "max",
      "claude-opus-4-8",
      "max",
      "claude-sonnet-4-6",
      "high"
    ],
    [true]
  );

  const updates = await selectModelSettings(io, baseConfig());

  assert.deepEqual(io.choiceValues[1], [
    "low",
    "medium",
    "high",
    "xhigh",
    "max"
  ]);
  assert.deepEqual(io.choiceValues[3], [
    "low",
    "medium",
    "high",
    "xhigh",
    "max"
  ]);
  // The 4.6 generation predates xhigh.
  assert.deepEqual(io.choiceValues[5], ["low", "medium", "high", "max"]);
  assert.deepEqual(updates, [
    {
      role: "planner",
      model: "gpt-5.6-luna",
      executable: "codex",
      effort: "max"
    },
    {
      role: "implementer",
      model: "claude-opus-4-8",
      executable: "claude",
      effort: "max"
    },
    {
      role: "reviewer",
      model: "claude-sonnet-4-6",
      executable: "claude",
      effort: "high"
    }
  ]);
});

test("declining the confirmation discards every pending change", async () => {
  const io = new FakeIO(
    ["claude-sonnet-5", "low", "__keep__", "__keep__"],
    [false]
  );

  const updates = await selectModelSettings(io, baseConfig());

  assert.deepEqual(updates, []);
  assert.ok(io.lines.includes("The configuration is unchanged."));
});

test("each phase is asked about, in planning, implementation, review order", async () => {
  const io = new FakeIO(["__keep__", "__keep__", "__keep__"]);

  await selectModelSettings(io, baseConfig());

  assert.deepEqual(io.prompts, [
    "Planning model",
    "Implementation model",
    "Review model"
  ]);
});

test("a selected model and effort are written to the configuration", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "banzai-picker-test-"));
  try {
    await initializeConfig(root);
    await applyModelUpdates(root, [
      {
        role: "reviewer",
        model: "claude-opus-4-8",
        executable: "claude",
        effort: "max"
      },
      {
        role: "planner",
        model: "gpt-6-luna",
        executable: "codex",
        effort: "xhigh"
      },
      {
        role: "implementer",
        model: "claude-sonnet-4-6",
        executable: "claude",
        effort: "medium"
      }
    ]);

    const updated = await loadCommittedConfig(root);
    assert.equal(updated.models.reviewer.model, "claude-opus-4-8");
    assert.equal(updated.models.reviewer.effort, "max");
    assert.equal(updated.models.planner.model, "gpt-6-luna");
    assert.equal(updated.models.planner.effort, "xhigh");
    assert.equal(updated.models.implementer.model, "claude-sonnet-4-6");
    assert.equal(updated.models.implementer.effort, "medium");
    // Timeouts are outside the dialog and must survive it.
    assert.equal(
      updated.models.reviewer.timeoutMs,
      DEFAULT_CONFIG.models.reviewer.timeoutMs
    );
    assert.equal(
      updated.models.implementer.timeoutMs,
      DEFAULT_CONFIG.models.implementer.timeoutMs
    );
    assert.match(await readFile(path.join(root, CONFIG_FILE), "utf8"), /\n$/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

const KEEP = "__keep__";
const MATCH = "__match_planning__";
const SHARED = "__use_shared__";
const DESTINATION_PROMPT = "Where should these model choices be saved?";
const LOCAL_FILE = LOCAL_CONFIG_IGNORE_LINE;
const ROLE_PROMPTS = ["Planning model", "Implementation model", "Review model"];

const LOCAL_CODEX_REVIEWER: LocalModelLayer = {
  reviewer: { executable: "codex", model: "gpt-6-sol", effort: "high" }
};
const LOCAL_CLAUDE_REVIEWER: LocalModelLayer = {
  reviewer: { executable: "claude", model: "claude-opus-5-5", effort: "xhigh" }
};
const LOCAL_CLAUDE_PLANNER: LocalModelLayer = {
  planner: { executable: "claude", model: "claude-opus-5-5", effort: "max" }
};

function triple(settings: ModelSettings) {
  return {
    executable: settings.executable,
    model: settings.model,
    effort: settings.effort
  };
}

test("the destination question offers this machine first, then the shared file", async () => {
  const io = new FakeIO(["local"]);
  assert.equal(await selectModelDestination(io), "local");
  assert.deepEqual(io.prompts, [DESTINATION_PROMPT]);
  assert.deepEqual(io.choiceNames[0], [
    "This machine only (.banzai/config.local.json, ignored by Git)",
    "Shared with the team (.banzai/config.json; commit it)"
  ]);
  assert.deepEqual(io.choiceValues[0], ["local", "committed"]);
});

test("local menus start from each effective triple and name its source", async () => {
  const io = new FakeIO([KEEP, KEEP, KEEP]);
  const selection = await chooseModelSettings(io, {
    committed: baseConfig(),
    local: LOCAL_CODEX_REVIEWER,
    destination: "local"
  });
  assert.equal(selection, null);
  assert.deepEqual(io.prompts, ROLE_PROMPTS);
  assert.ok(
    io.lines.includes("Planning: codex gpt-6.1-sol effort=xhigh (committed)")
  );
  assert.ok(io.lines.includes("Review: codex gpt-6-sol effort=high (local)"));
  assert.equal(io.choiceNames[2]?.[0], "Keep gpt-6-sol (effort=high)");
  assert.equal(io.choiceValues[2]?.[1], SHARED);
  assert.equal(
    io.choiceNames[2][1],
    "Use shared setting: claude claude-opus-5-5 effort=xhigh"
  );
  // Only a role with a local entry offers the shared setting.
  assert.equal(io.choiceValues[0]?.includes(SHARED), false);
  assert.equal(io.choiceValues[1]?.includes(SHARED), false);
  assert.ok(
    io.lines.includes(
      "No phase changed; .banzai/config.local.json is unchanged."
    )
  );
});

test("a local selection holds only changed roles and never copies an unchanged committed triple", async () => {
  const io = new FakeIO(["claude-fable-5-1", "max", MATCH, KEEP], [true]);
  const selection = await chooseModelSettings(io, {
    committed: baseConfig(),
    local: LOCAL_CODEX_REVIEWER,
    destination: "local"
  });
  const fable = {
    executable: "claude",
    model: "claude-fable-5-1",
    effort: "max"
  } as const;
  assert.deepEqual(selection, {
    destination: "local",
    models: {
      planner: fable,
      implementer: fable,
      reviewer: LOCAL_CODEX_REVIEWER.reviewer
    }
  });
  // Match Planning copies the pending effective Planning triple.
  assert.equal(
    io.choiceNames[2]?.[0],
    "Match Planning: Claude Fable 5.1 (claude-fable-5-1), effort=max - recommended"
  );
  assert.ok(io.lines.includes("Pending changes to .banzai/config.local.json:"));
  assert.ok(
    io.lines.includes(
      "  Planning: codex gpt-6.1-sol effort=xhigh (committed) -> claude claude-fable-5-1 effort=max (local)"
    )
  );
  assert.ok(
    io.lines.includes(
      "  Implementation: codex gpt-6.1-sol effort=xhigh (committed) -> claude claude-fable-5-1 effort=max (local)"
    )
  );
  assert.equal(
    io.lines.some((line) => line.startsWith("  Review:")),
    false
  );
  assert.deepEqual(io.confirmPrompts, [
    "Write these changes to .banzai/config.local.json?"
  ]);

  // Reselecting the committed triple of a role without a local entry is no change.
  const same = new FakeIO([KEEP, "gpt-6.1-sol", "xhigh", KEEP]);
  assert.equal(
    await chooseModelSettings(same, {
      committed: baseConfig(),
      destination: "local"
    }),
    null
  );
});

test("Use shared setting and the committed triple remove a local entry, and an empty layer is deleted", async () => {
  const input = {
    committed: baseConfig(),
    local: LOCAL_CODEX_REVIEWER,
    destination: "local"
  } as const;
  const io = new FakeIO([KEEP, KEEP, SHARED], [true]);
  assert.deepEqual(await chooseModelSettings(io, input), {
    destination: "local",
    models: {}
  });
  assert.ok(
    io.lines.includes(
      "  Review: codex gpt-6-sol effort=high (local) -> claude claude-opus-5-5 effort=xhigh (committed)"
    )
  );
  assert.ok(
    io.lines.includes(
      "No local setting remains, so .banzai/config.local.json will be deleted and this machine uses .banzai/config.json."
    )
  );
  assert.deepEqual(io.confirmPrompts, ["Delete .banzai/config.local.json?"]);

  // Reading 7: choosing the committed triple acts as "Use shared setting".
  const reselected = new FakeIO(
    [KEEP, KEEP, "claude-opus-5-5", "xhigh"],
    [true]
  );
  assert.deepEqual(await chooseModelSettings(reselected, input), {
    destination: "local",
    models: {}
  });

  const declined = new FakeIO([KEEP, KEEP, SHARED], [false]);
  assert.equal(await chooseModelSettings(declined, input), null);
  assert.ok(declined.lines.includes(".banzai/config.local.json is unchanged."));
});

test("a local menu offers Match Planning only for a claude or codex Planning executable", async () => {
  const committed = baseConfig();
  committed.models.implementer.model = "gpt-6-sol";
  const offered = new FakeIO([KEEP, KEEP, KEEP]);
  await chooseModelSettings(offered, { committed, destination: "local" });
  assert.equal(offered.choiceValues[1]?.[0], MATCH);
  committed.models.planner.executable = "/opt/tools/codex";
  const withheld = new FakeIO([KEEP, KEEP, KEEP]);
  await chooseModelSettings(withheld, { committed, destination: "local" });
  assert.equal(withheld.choiceValues[1]?.includes(MATCH), false);
});

test("the committed destination compares with the committed layer and names the kept local settings", async () => {
  const committed = baseConfig();
  committed.models.implementer.model = "gpt-6-sol";
  committed.models.implementer.effort = "high";
  const io = new FakeIO([KEEP, MATCH, KEEP], [true]);
  const selection = await chooseModelSettings(io, {
    committed,
    local: LOCAL_CLAUDE_PLANNER,
    destination: "committed"
  });
  // Match Planning copies the committed Planning triple, not the local one.
  assert.deepEqual(selection, {
    destination: "committed",
    updates: [
      {
        role: "implementer",
        model: "gpt-6.1-sol",
        executable: "codex",
        effort: "xhigh"
      }
    ]
  });
  assert.equal(
    io.choiceNames[1]?.[0],
    "Match Planning: GPT-6.1-Sol (gpt-6.1-sol), effort=xhigh - recommended"
  );
  assert.ok(
    io.lines.includes("Planning: codex gpt-6.1-sol effort=xhigh (committed)")
  );
  assert.ok(
    io.lines.includes(
      "This machine uses claude claude-opus-5-5 effort=max (local)."
    )
  );
  assert.ok(io.lines.includes("Pending changes to .banzai/config.json:"));
  assert.ok(
    io.lines.includes(
      "This machine keeps using its local Planning setting: claude claude-opus-5-5 effort=max (.banzai/config.local.json)."
    )
  );
  // The builder-session line uses the effective settings.
  assert.ok(
    io.lines.includes(
      "Strict builder session: Implementation will start fresh from approved artifacts because executable, model, or effort differs from Planning."
    )
  );
  assert.deepEqual(io.confirmPrompts, [
    "Write these changes to .banzai/config.json?"
  ]);
});

test("picker text built from configuration values is escaped", async () => {
  const committed = baseConfig();
  committed.models.reviewer.model = "evil\u001b[2J\nmodel";
  const io = new FakeIO([KEEP, KEEP, KEEP]);
  await chooseModelSettings(io, { committed });
  const text = [...io.lines, ...io.choiceNames.flat()].join("\n");
  assert.doesNotMatch(text, /\u001b/u);
  assert.ok(
    io.lines.includes("Review: claude evil\\u001b[2J\\u000amodel effort=xhigh")
  );
  assert.equal(
    io.choiceNames[2]?.[0],
    "Keep evil\\u001b[2J\\u000amodel (effort=xhigh)"
  );
});

/** A repository whose committed models use the bare vendor names. */
async function pickerRepository(options: { ignoreLocalConfig?: boolean } = {}) {
  const repository = await createTestRepository(options);
  const configPath = path.join(repository.root, CONFIG_FILE);
  const config = JSON.parse(
    await readFile(configPath, "utf8")
  ) as OrchestratorConfig;
  config.models = reviewerOnlyClaudeConfig().models;
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  await commitAll(repository.root, "bare vendor models");
  return repository;
}

async function readOrNull(target: string): Promise<string | null> {
  try {
    return await readFile(target, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/** Every file a model writer could change. */
async function writableFiles(
  root: string
): Promise<Record<string, string | null>> {
  const files = [CONFIG_FILE, ".gitignore", LOCAL_FILE, ".git/info/exclude"];
  return Object.fromEntries(
    await Promise.all(
      files.map(
        async (file) => [file, await readOrNull(path.join(root, file))] as const
      )
    )
  );
}

async function gitStatus(root: string): Promise<string> {
  return (await execFileAsync("git", ["status", "--porcelain"], { cwd: root }))
    .stdout;
}

function picker(
  io: FakeIO,
  overrides: Partial<ModelPickerHost> = {}
): ModelPickerHost {
  return { io, env: {}, ...overrides };
}

const PICKER_REQUESTS: readonly ModelPickerRequest[] = [
  { entry: "model" },
  { entry: "model", local: true },
  { entry: "init" }
];

test("banzai model --local and Use shared setting write only the local file", async () => {
  const repository = await pickerRepository({ ignoreLocalConfig: true });
  try {
    const root = repository.root;
    const before = await writableFiles(root);
    const io = new FakeIO([KEEP, KEEP, "gpt-6-sol", "high"], [true]);
    assert.equal(
      await executeModelPicker(
        root,
        { entry: "model", local: true },
        picker(io)
      ),
      "local"
    );
    assert.deepEqual(io.prompts, [...ROLE_PROMPTS, "Review effort"]);
    assert.deepEqual(await writableFiles(root), {
      ...before,
      [LOCAL_FILE]: localModelFileText(LOCAL_CODEX_REVIEWER)
    });
    assert.ok(
      io.lines.includes(
        "Updated .banzai/config.local.json for this machine only. Git ignores it, so there is nothing to commit."
      )
    );
    assert.equal(
      io.lines.some((line) => line.includes("Review and commit")),
      false
    );
    assert.equal(await gitStatus(root), "");

    const shared = new FakeIO([KEEP, KEEP, SHARED], [true]);
    assert.equal(
      await executeModelPicker(
        root,
        { entry: "model", local: true },
        picker(shared)
      ),
      "local"
    );
    assert.deepEqual(await writableFiles(root), before);
    assert.ok(
      shared.lines.includes(
        "Deleted .banzai/config.local.json; this machine now uses the shared models in .banzai/config.json."
      )
    );
  } finally {
    await repository.dispose();
  }
});

test("the destination question writes only the chosen file", async () => {
  const repository = await pickerRepository({ ignoreLocalConfig: true });
  try {
    const root = repository.root;
    const before = await writableFiles(root);
    // .banzai/config.json is in the Git index, so the question comes first.
    const local = new FakeIO(
      ["local", KEEP, KEEP, "gpt-6-sol", "high"],
      [true]
    );
    assert.equal(
      await executeModelPicker(root, { entry: "model" }, picker(local)),
      "local"
    );
    assert.equal(local.prompts[0], DESTINATION_PROMPT);
    assert.deepEqual(await writableFiles(root), {
      ...before,
      [LOCAL_FILE]: localModelFileText(LOCAL_CODEX_REVIEWER)
    });

    const shared = new FakeIO(
      ["committed", "claude-fable-5-1", "max", KEEP, KEEP],
      [true]
    );
    assert.equal(
      await executeModelPicker(root, { entry: "model" }, picker(shared)),
      "committed"
    );
    const after = await writableFiles(root);
    assert.equal(after[LOCAL_FILE], localModelFileText(LOCAL_CODEX_REVIEWER));
    assert.equal(after[".gitignore"], before[".gitignore"]);
    assert.equal(after[".git/info/exclude"], before[".git/info/exclude"]);
    const config = await loadCommittedConfig(root);
    assert.deepEqual(triple(config.models.planner), {
      executable: "claude",
      model: "claude-fable-5-1",
      effort: "max"
    });
    assert.deepEqual(
      triple(config.models.reviewer),
      triple(reviewerOnlyClaudeConfig().models.reviewer)
    );
    assert.ok(
      shared.lines.includes(
        "Updated .banzai/config.json. Review and commit the change."
      )
    );
    assert.ok(
      shared.lines.includes(
        "This machine keeps using its local Review setting: codex gpt-6-sol effort=high (.banzai/config.local.json)."
      )
    );
  } finally {
    await repository.dispose();
  }
});

test("without a tracked shared file or a local file the picker writes the shared file without asking", async () => {
  const repository = await pickerRepository({ ignoreLocalConfig: true });
  try {
    const root = repository.root;
    await execFileAsync("git", ["rm", "-q", "--cached", "--", CONFIG_FILE], {
      cwd: root
    });
    const io = new FakeIO([KEEP, KEEP, KEEP]);
    assert.equal(
      await executeModelPicker(root, { entry: "model" }, picker(io)),
      "unchanged"
    );
    assert.deepEqual(io.prompts, ROLE_PROMPTS);
  } finally {
    await repository.dispose();
  }
});

test("committed-destination Match Planning copies the committed planner triple, never a local one", async () => {
  const repository = await pickerRepository({ ignoreLocalConfig: true });
  try {
    const root = repository.root;
    await applyModelUpdates(root, [
      {
        role: "implementer",
        model: "gpt-6-sol",
        executable: "codex",
        effort: "high"
      }
    ]);
    await commitAll(root, "distinct implementer");
    await writeLocalModels(root, LOCAL_CLAUDE_PLANNER);
    const io = new FakeIO(["committed", KEEP, MATCH, KEEP], [true]);
    assert.equal(
      await executeModelPicker(root, { entry: "model" }, picker(io)),
      "committed"
    );
    const config = await loadCommittedConfig(root);
    assert.deepEqual(triple(config.models.implementer), {
      executable: "codex",
      model: "gpt-6.1-sol",
      effort: "xhigh"
    });
    assert.equal(
      await readFile(path.join(root, LOCAL_FILE), "utf8"),
      localModelFileText(LOCAL_CLAUDE_PLANNER)
    );
  } finally {
    await repository.dispose();
  }
});

test("model-phase variables and a held runner lock refuse before any menu with nothing written", async () => {
  // Without the ignore line, so the refusal provably precedes the exclude step.
  const plain = await pickerRepository();
  const ignoring = await pickerRepository({ ignoreLocalConfig: true });
  try {
    const before = await writableFiles(plain.root);
    for (const name of [
      "BANZAI_RUN_ID",
      "BANZAI_APPROVAL_DIGEST",
      "BANZAI_WORKFLOW_DIGEST"
    ]) {
      for (const request of PICKER_REQUESTS) {
        const io = new FakeIO([]);
        await assert.rejects(
          executeModelPicker(
            plain.root,
            request,
            picker(io, { env: { [name]: "granted" } })
          ),
          { code: "CONFIGURATION_MODEL_WRITE_DENIED" }
        );
        assert.deepEqual(io.prompts, []);
        assert.deepEqual(await writableFiles(plain.root), before);
      }
    }

    const lock = path.join(ignoring.root, ".banzai/runner.lock");
    const held = `${JSON.stringify({ schemaVersion: 1, pid: process.pid, token: "held", createdAt: new Date().toISOString() })}\n`;
    await writeFile(lock, held);
    const ignoringBefore = await writableFiles(ignoring.root);
    for (const request of PICKER_REQUESTS) {
      const io = new FakeIO([]);
      await assert.rejects(
        executeModelPicker(ignoring.root, request, picker(io)),
        (error: unknown) =>
          error instanceof BanzaiError &&
          error.code === "RUNNER_LOCKED" &&
          error.message.startsWith(
            "Models cannot change while .banzai/runner.lock exists"
          )
      );
      assert.deepEqual(io.prompts, []);
      assert.deepEqual(await writableFiles(ignoring.root), ignoringBefore);
      assert.equal(await readFile(lock, "utf8"), held);
    }
  } finally {
    await plain.dispose();
    await ignoring.dispose();
  }
});

/** A run blocked from `created` by a failed Claude startup check. */
async function blockedAtStartup(root: string) {
  const adapters = new FakeAdapters();
  adapters.claudePreflightErrors.push(
    new BanzaiError("CLAUDE_AUTH_REQUIRED", "Sign in to Claude.")
  );
  adapters.reviewResults.push(passingReview());
  const runner = new WorkflowRunner(root, adapters);
  const blocked = await runner.start({
    slug: "example",
    request: "Implement it."
  });
  assert.equal(blocked.status, "blocked");
  assert.equal(blocked.blockedFrom, "created", blocked.blockReason ?? "");
  assert.equal((await runner.status()).nextAction, "banzai retry");
  return { adapters, runner, blocked };
}

/** Records the reviewer triple of every review request. */
function reviewTriples(adapters: FakeAdapters): unknown[] {
  const triples: unknown[] = [];
  adapters.onReview = (request) => {
    triples.push(triple(request.settings));
    return Promise.resolve();
  };
  return triples;
}

test("a blocked run for which status recommends retry accepts only local choices and prints the retry line", async () => {
  const repository = await createTestRepository({ ignoreLocalConfig: true });
  try {
    await withVendorExecutablesOnPath(async () => {
      const root = repository.root;
      const { adapters, runner, blocked } = await blockedAtStartup(root);
      const reviewers = reviewTriples(adapters);
      const before = await writableFiles(root);
      const statePath = runner.store.statePath(blocked.runId);
      const stateBefore = await readFile(statePath);
      // Without --local, and although .banzai/config.json is tracked, the
      // picker goes straight to the local menus.
      const io = new FakeIO([KEEP, KEEP, "claude-opus-5-5", "xhigh"], [true]);
      assert.equal(
        await executeModelPicker(
          root,
          { entry: "model" },
          picker(io, { status: () => runner.status() })
        ),
        "local"
      );
      assert.equal(io.prompts[0], "Planning model");
      assert.deepEqual(await writableFiles(root), {
        ...before,
        [LOCAL_FILE]: localModelFileText(LOCAL_CLAUDE_REVIEWER)
      });
      assert.deepEqual(await readFile(statePath), stateBefore);
      assert.equal(io.lines.at(-1), MODEL_RETRY_LINE);

      // The retry records the new layer and reviews with the local triple.
      const gate = await runner.retry();
      assert.equal(gate.status, "needs_plan_approval", gate.blockReason ?? "");
      const done = await runner.approvePlan("human");
      assert.equal(done.status, "done", done.blockReason ?? "");
      assert.deepEqual(reviewers, [LOCAL_CLAUDE_REVIEWER.reviewer]);
    });
  } finally {
    await repository.dispose();
  }
});

function refusedNamingCancel(runId: string, status: string) {
  return (error: unknown): boolean => {
    assert.ok(error instanceof BanzaiError, String(error));
    assert.equal(error.code, "RUN_IN_PROGRESS");
    assert.equal(
      error.message,
      `Run ${runId} is ${status}. Finish it, or run banzai cancel, before changing models.`
    );
    return true;
  };
}

test("a blocked run refuses the picker unless status recommends retry with a usable record", async () => {
  const repository = await createTestRepository({ ignoreLocalConfig: true });
  try {
    await withVendorExecutablesOnPath(async () => {
      const root = repository.root;
      const { runner, blocked } = await blockedAtStartup(root);
      const before = await writableFiles(root);
      const refuse = async (
        request: ModelPickerRequest,
        status: ModelPickerHost["status"]
      ) => {
        const io = new FakeIO([]);
        await assert.rejects(
          executeModelPicker(
            root,
            request,
            picker(io, status === undefined ? {} : { status })
          ),
          refusedNamingCancel(blocked.runId, "blocked")
        );
        assert.deepEqual(io.prompts, []);
        assert.deepEqual(await writableFiles(root), before);
      };
      // The init picker never writes the local file, so no exception applies.
      await refuse({ entry: "init" }, () => runner.status());
      // Status recommends something else.
      await refuse({ entry: "model", local: true }, async () => ({
        ...(await runner.status()),
        nextAction: "banzai cancel"
      }));
      // A model record status cannot use makes status recommend cancel.
      await writeFile(
        path.join(
          runner.store.runDirectory(blocked.runId),
          "model-override.json"
        ),
        "{not json"
      );
      await refuse({ entry: "model", local: true }, () => runner.status());
    });
  } finally {
    await repository.dispose();
  }
});

test("every other active run state refuses the picker and names banzai cancel", async () => {
  const repository = await createTestRepository({ ignoreLocalConfig: true });
  try {
    await withVendorExecutablesOnPath(async () => {
      const root = repository.root;
      const runner = new WorkflowRunner(root, new FakeAdapters());
      const gate = await runner.start({
        slug: "example",
        request: "Implement it."
      });
      assert.equal(gate.status, "needs_plan_approval", gate.blockReason ?? "");
      const before = await writableFiles(root);
      for (const request of PICKER_REQUESTS) {
        const io = new FakeIO([]);
        await assert.rejects(
          executeModelPicker(
            root,
            request,
            picker(io, { status: () => runner.status() })
          ),
          refusedNamingCancel(gate.runId, "needs_plan_approval")
        );
        assert.deepEqual(io.prompts, []);
        assert.deepEqual(await writableFiles(root), before);
      }
    });
  } finally {
    await repository.dispose();
  }
});

test("a defective local file stops the picker before any menu", async () => {
  const repository = await pickerRepository({ ignoreLocalConfig: true });
  try {
    const root = repository.root;
    await writeFile(
      path.join(root, LOCAL_FILE),
      '{"schemaVersion":1,"models":{"reviewer":{"executable":"/bin/sh","model":"m","effort":"low"}}}\n'
    );
    const before = await writableFiles(root);
    for (const request of PICKER_REQUESTS) {
      const io = new FakeIO([]);
      await assert.rejects(
        executeModelPicker(root, request, picker(io)),
        (error: unknown) =>
          error instanceof LocalConfigError &&
          error.code === "LOCAL_CONFIG_INVALID" &&
          error.defect.fieldPath === "models.reviewer.executable"
      );
      assert.deepEqual(io.prompts, []);
      assert.deepEqual(await writableFiles(root), before);
    }
  } finally {
    await repository.dispose();
  }
});

test("a tracked local file is refused by the picker before any menu", async () => {
  const repository = await pickerRepository({ ignoreLocalConfig: true });
  try {
    const root = repository.root;
    await writeLocalModels(root, LOCAL_CODEX_REVIEWER);
    await execFileAsync("git", ["add", "-f", "--", LOCAL_FILE], { cwd: root });
    const before = await writableFiles(root);
    for (const request of PICKER_REQUESTS) {
      const io = new FakeIO([]);
      await assert.rejects(
        executeModelPicker(root, request, picker(io)),
        (error: unknown) =>
          error instanceof LocalConfigError &&
          error.code === "LOCAL_CONFIG_NOT_IGNORED" &&
          error.defect.cause === "tracked"
      );
      assert.deepEqual(io.prompts, []);
      assert.deepEqual(await writableFiles(root), before);
    }
  } finally {
    await repository.dispose();
  }
});

test("local writes without the ignore line use the clone's exclude file and leave .gitignore unchanged", async () => {
  const repository = await pickerRepository();
  try {
    const root = repository.root;
    const before = await writableFiles(root);
    const io = new FakeIO([KEEP, KEEP, "gpt-6-sol", "high"], [true]);
    assert.equal(
      await executeModelPicker(
        root,
        { entry: "model", local: true },
        picker(io)
      ),
      "local"
    );
    const after = await writableFiles(root);
    assert.equal(after[".gitignore"], before[".gitignore"]);
    assert.equal(after[CONFIG_FILE], before[CONFIG_FILE]);
    assert.equal(after[LOCAL_FILE], localModelFileText(LOCAL_CODEX_REVIEWER));
    assert.ok(
      (after[".git/info/exclude"] ?? "").split("\n").includes(LOCAL_FILE)
    );
    assert.equal(await gitStatus(root), "");
  } finally {
    await repository.dispose();
  }
});

test("the init picker writes the shared file without the destination question and names kept local settings", async () => {
  const repository = await pickerRepository({ ignoreLocalConfig: true });
  try {
    const root = repository.root;
    await writeLocalModels(root, LOCAL_CODEX_REVIEWER);
    const io = new FakeIO([KEEP, KEEP, KEEP]);
    assert.equal(
      await executeModelPicker(root, { entry: "init" }, picker(io)),
      "unchanged"
    );
    assert.deepEqual(io.prompts, ROLE_PROMPTS);
    assert.ok(
      io.lines.includes(
        "This machine keeps using its local Review setting: codex gpt-6-sol effort=high (.banzai/config.local.json)."
      )
    );

    const change = new FakeIO(["claude-fable-5-1", "max", KEEP, KEEP], [true]);
    assert.equal(
      await executeModelPicker(root, { entry: "init" }, picker(change)),
      "committed"
    );
    assert.equal(change.prompts[0], "Planning model");
    assert.equal(
      (await loadCommittedConfig(root)).models.planner.model,
      "claude-fable-5-1"
    );
    assert.equal(
      await readFile(path.join(root, LOCAL_FILE), "utf8"),
      localModelFileText(LOCAL_CODEX_REVIEWER)
    );
  } finally {
    await repository.dispose();
  }
});

const CONFIG_MISSING = {
  code: "CONFIG_NOT_FOUND",
  message: 'Missing .banzai/config.json. Run "banzai init" first.'
};

test("before banzai init every model writer refuses CONFIG_NOT_FOUND and writes nothing, not even the exclude line", async () => {
  const root = await mkdtemp(
    path.join(tmpdir(), "banzai-model-uninitialized-")
  );
  const outside = await mkdtemp(path.join(tmpdir(), "banzai-model-outside-"));
  try {
    await execFileAsync("git", ["init", "-q"], { cwd: root });
    const exclude = path.join(root, ".git", "info", "exclude");
    const excludeBefore = await readOrNull(exclude);
    const unchanged = async () => {
      assert.equal(await readOrNull(exclude), excludeBefore);
      assert.equal(await readOrNull(path.join(root, ".gitignore")), null);
    };
    const advisory = async () =>
      await applyLaunchModelUpdates(
        root,
        [
          {
            role: "reviewer",
            model: "claude-opus-5-5",
            replaces: "claude-opus-4-7",
            source: "local"
          }
        ],
        { env: {} }
      );

    // No .banzai/ at all.
    for (const request of PICKER_REQUESTS) {
      const io = new FakeIO([]);
      await assert.rejects(
        executeModelPicker(root, request, picker(io)),
        CONFIG_MISSING
      );
      assert.deepEqual(io.prompts, []);
      await unchanged();
      await assert.rejects(lstat(path.join(root, ".banzai")), /ENOENT/);
    }
    await assert.rejects(advisory(), CONFIG_MISSING);
    await unchanged();

    // An empty .banzai/ without config.json.
    await mkdir(path.join(root, ".banzai"));
    for (const request of PICKER_REQUESTS) {
      await assert.rejects(
        executeModelPicker(root, request, picker(new FakeIO([]))),
        CONFIG_MISSING
      );
      await unchanged();
    }
    assert.deepEqual(await readdir(path.join(root, ".banzai")), []);

    // A link at .banzai/ is still refused as unsafe, even toward a config.
    await rm(path.join(root, ".banzai"), { recursive: true });
    await mkdir(path.join(outside, ".banzai"));
    await writeFile(
      path.join(outside, ".banzai", "config.json"),
      `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`
    );
    await symlink(path.join(outside, ".banzai"), path.join(root, ".banzai"));
    for (const request of PICKER_REQUESTS) {
      await assert.rejects(
        executeModelPicker(root, request, picker(new FakeIO([]))),
        (error: unknown) =>
          error instanceof LocalConfigError && error.defect.cause === "unsafe"
      );
      await unchanged();
    }
    assert.deepEqual(await readdir(path.join(outside, ".banzai")), [
      "config.json"
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
