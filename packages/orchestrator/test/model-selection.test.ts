import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
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
import type { InteractiveChoice, InteractiveIO } from "../src/interactive.js";
import { selectModelSettings } from "../src/model-selection.js";
import { SELECTABLE_MODELS } from "../src/models.js";
import type { OrchestratorConfig } from "../src/types.js";

class FakeIO implements InteractiveIO {
  readonly lines: string[] = [];
  readonly prompts: string[] = [];
  readonly choiceValues: unknown[][] = [];
  readonly choiceNames: string[][] = [];
  readonly choiceDescriptions: (string | undefined)[][] = [];

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

  async confirm(): Promise<boolean> {
    assert.notEqual(this.confirmations.length, 0, "Unexpected confirmation");
    return this.confirmations.shift() ?? false;
  }

  writeLine(message = ""): void {
    this.lines.push(message);
  }
}

function baseConfig(): OrchestratorConfig {
  return structuredClone(DEFAULT_CONFIG);
}

test("the picker offers current and previous-generation models from both vendors", () => {
  assert.deepEqual(
    SELECTABLE_MODELS.map((model) => model.id),
    [
      "claude-opus-5",
      "claude-fable-5-1",
      "claude-fable-5",
      "claude-sonnet-5",
      "claude-opus-4-8",
      "claude-sonnet-4-6",
      "gpt-6-astra",
      "gpt-5.6-sol",
      "gpt-5.6-terra",
      "gpt-5.6-luna",
      "gpt-5.5"
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
    "Keep gpt-5.6-sol (effort=xhigh) - matches Planning"
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
        "Planning: codex gpt-5.6-sol effort=xhigh -> codex gpt-5.6-terra effort=high"
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
  const io = new FakeIO(["__keep__", "gpt-5.6-sol", "xhigh", "__keep__"]);

  const updates = await selectModelSettings(io, baseConfig());

  assert.deepEqual(updates, []);
  assert.equal(
    io.choiceNames[2]?.[3],
    "xhigh - matches Planning; recommended for strict session reuse"
  );
});

test("effort choices are limited to what each model accepts", async () => {
  const io = new FakeIO(
    ["gpt-6-astra", "ultra", "gpt-5.6-luna", "high", "claude-opus-5", "xhigh"],
    [true]
  );

  await selectModelSettings(io, baseConfig());

  // Astra supports Codex's ultra tier; Luna and every Claude model do not.
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

test("previous-generation models use their supported effort subsets", async () => {
  const io = new FakeIO(
    [
      "gpt-5.5",
      "xhigh",
      "claude-opus-4-8",
      "max",
      "claude-sonnet-4-6",
      "xhigh"
    ],
    [true]
  );

  const updates = await selectModelSettings(io, baseConfig());

  assert.deepEqual(io.choiceValues[1], ["low", "medium", "high", "xhigh"]);
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
  assert.deepEqual(updates, [
    {
      role: "planner",
      model: "gpt-5.5",
      executable: "codex",
      effort: "xhigh"
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
      effort: "xhigh"
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
        model: "gpt-5.5",
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

    const updated = await loadConfig(root);
    assert.equal(updated.models.reviewer.model, "claude-opus-4-8");
    assert.equal(updated.models.reviewer.effort, "max");
    assert.equal(updated.models.planner.model, "gpt-5.5");
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
