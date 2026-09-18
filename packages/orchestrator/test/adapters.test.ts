import {
  currentReviewFixture,
  reviewSnapshotFixture
} from "./review-fixtures.js";
import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  AMBIENT_CLAUDE_SCOPE,
  buildClaudeArguments,
  buildClaudePhaseArguments,
  buildClaudeSelectionArguments,
  buildCodexArguments,
  claudeJsonSchema,
  claudeSessionInventory,
  claudeUsage,
  classifyClaudeFailure,
  classifyCodexFailure,
  classifyModelFailure,
  createVendorAdapters,
  resolveClaudeInvocationScope,
  claudeMcpConfig,
  codexMcpServersOverride,
  summarizeCommand
} from "../src/adapters.js";
import {
  phaseResultSchema,
  legacyPhaseResultV3Schema,
  reviewResultSchema,
  workflowSelectionSchema
} from "../src/contracts.js";
import { BanzaiError, ProcessExitError } from "../src/errors.js";
import { formatUsage } from "../src/format.js";
import { resolveOutputContract } from "../src/output-contract.js";
import { createPromptEnvelope } from "../src/prompt-envelope.js";
import {
  redactSensitiveText,
  subscriptionOnlyEnvironment
} from "../src/process.js";
import type {
  ClaudeInvocationScope,
  PhaseAdapterRequest,
  ModelProgressEvent,
  ProcessResult,
  ProcessRunner,
  ReviewAdapterRequest,
  WorkflowSelectionAdapterRequest
} from "../src/types.js";
import { isPhaseResultEnvelope } from "../src/validation.js";

const settings = {
  executable: "claude",
  model: "model-id",
  effort: "xhigh" as const,
  timeoutMs: 1_000
};

const codexSettings = { ...settings, executable: "codex" };
const claudePhaseOutputContract = resolveOutputContract(
  "claude",
  "phase-result/v3"
);
const claudeSelectionOutputContract = resolveOutputContract(
  "claude",
  "workflow-selection/v1"
);
const codexReviewOutputContract = resolveOutputContract(
  "codex",
  "review-result/v2"
);

const basePhaseRequest: PhaseAdapterRequest = {
  repoRoot: "/repo",
  runDirectory: "/repo/.banzai/runs/example",
  attemptId: "plan-1",
  prompt: "plan this",
  promptEnvelope: createPromptEnvelope([
    { category: "phase_instructions", text: "plan this" }
  ]),
  outputContract: resolveOutputContract("codex", "phase-result/v3"),
  settings: codexSettings,
  resumeSessionId: null,
  env: {},
  onStart: async () => undefined,
  onProgress: () => undefined
};

const baseSelectionRequest: WorkflowSelectionAdapterRequest = {
  repoRoot: "/repo",
  runDirectory: "/repo/.banzai/runs/example",
  attemptId: "selection-1",
  prompt: "select a workflow",
  promptEnvelope: createPromptEnvelope([
    { category: "phase_instructions", text: "select a workflow" }
  ]),
  outputContract: resolveOutputContract("codex", "workflow-selection/v1"),
  settings: codexSettings,
  env: {},
  onStart: async () => undefined,
  onProgress: () => undefined
};

const baseReviewRequest: ReviewAdapterRequest = {
  repoRoot: "/repo",
  runId: "run-example",
  runDirectory: "/repo/.banzai/runs/example",
  attemptId: "review-1-abcd1234",
  approvalDigest: "approved-digest",
  artifact: {
    path: "documentation/features/example/review-1.md",
    candidatePath: ".banzai/runs/example/attempts/review-1.review-candidate.md",
    slug: "example",
    iteration: 1,
    approvedArtifactPaths: [
      "documentation/features/example/description.md",
      "documentation/development-plans/example/plan.md"
    ],
    workspaceDigest: "workspace-digest",
    verification: []
  },
  prompt: "review this",
  promptEnvelope: createPromptEnvelope([
    { category: "phase_instructions", text: "review this" }
  ]),
  outputContract: resolveOutputContract("claude", "review-result/v2"),
  settings,
  resumeSessionId: null,
  env: {},
  onStart: async () => undefined,
  onProgress: () => undefined
};

function successful(stdout: string): ProcessResult {
  return {
    exitCode: 0,
    signal: null,
    stdout,
    stderr: "",
    startedAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:00:01.000Z"
  };
}

function failed(stdout: string, stderr: string): ProcessResult {
  return {
    ...successful(stdout),
    exitCode: 1,
    stderr
  };
}

const scopedEnvironment: ClaudeInvocationScope = {
  strictMcpConfig: true,
  settingSources: "project",
  pluginDirectory: "/plugins/banzai"
};

function flagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

async function pluginFixture(
  manifest: string | null,
  withRequiredSurface = true
): Promise<{ root: string; directory: string }> {
  const root = await mkdtemp(path.join(tmpdir(), "banzai-plugin-"));
  const directory = path.join(root, "plugins", "banzai");
  await mkdir(path.join(directory, ".claude-plugin"), { recursive: true });
  if (manifest !== null) {
    await writeFile(
      path.join(directory, ".claude-plugin", "plugin.json"),
      manifest,
      "utf8"
    );
  }
  if (withRequiredSurface) {
    for (const skill of [
      "architecture-decision",
      "code-writing",
      "development-plan",
      "feature",
      "feature-description",
      "feature-review",
      "feature-status",
      "orchestrate",
      "project-manifest",
      "quick-fix",
      "test-writing"
    ]) {
      await mkdir(path.join(directory, "skills", skill), { recursive: true });
      await writeFile(
        path.join(directory, "skills", skill, "SKILL.md"),
        `# ${skill}\n`,
        "utf8"
      );
    }
    await mkdir(path.join(directory, "hooks"), { recursive: true });
    await writeFile(
      path.join(directory, "hooks", "hooks.json"),
      JSON.stringify({
        hooks: {
          PreToolUse: [
            {
              matcher: "Edit|Write|MultiEdit|NotebookEdit|apply_patch",
              hooks: [
                {
                  type: "command",
                  command:
                    'node "${CLAUDE_PLUGIN_ROOT}/hooks/spec-gate.cjs" "${CLAUDE_PLUGIN_ROOT}"'
                }
              ]
            }
          ],
          PostToolUse: [
            {
              matcher: "Edit|Write|MultiEdit|NotebookEdit|apply_patch",
              hooks: [
                {
                  type: "command",
                  command:
                    'node "${CLAUDE_PLUGIN_ROOT}/hooks/spec-gate.cjs" "${CLAUDE_PLUGIN_ROOT}"'
                }
              ]
            }
          ]
        }
      }),
      "utf8"
    );
    await writeFile(
      path.join(directory, "hooks", "spec-gate.cjs"),
      "module.exports = {};\n",
      "utf8"
    );
  }
  return { root, directory };
}

test("every Claude invocation isolates MCP and re-supplies the Banzai plugin", () => {
  for (const args of [
    buildClaudeArguments({
      ...baseReviewRequest,
      environment: scopedEnvironment
    }),
    buildClaudePhaseArguments({
      ...basePhaseRequest,
      settings,
      outputContract: claudePhaseOutputContract,
      environment: scopedEnvironment
    }),
    buildClaudeSelectionArguments({
      ...baseSelectionRequest,
      settings,
      outputContract: claudeSelectionOutputContract,
      environment: scopedEnvironment
    })
  ]) {
    assert.ok(args.includes("--strict-mcp-config"));
    assert.ok(!args.includes("--mcp-config"));
    assert.equal(flagValue(args, "--setting-sources"), "project");
    assert.equal(flagValue(args, "--plugin-dir"), "/plugins/banzai");
    assert.ok(!args.includes("--bare"));
    assert.ok(!args.includes("--safe-mode"));
    assert.ok(!args.includes("--disable-slash-commands"));
  }
});

test("ambient mode and an omitted scope reproduce the unscoped argument vector", () => {
  const unscoped = buildClaudeArguments(baseReviewRequest);
  const ambient = buildClaudeArguments({
    ...baseReviewRequest,
    environment: AMBIENT_CLAUDE_SCOPE
  });
  assert.deepEqual(ambient, unscoped);
  assert.ok(!unscoped.includes("--strict-mcp-config"));
  assert.ok(!unscoped.includes("--setting-sources"));
});

test("degraded isolation keeps ambient setting sources rather than dropping the plugin", () => {
  const args = buildClaudeArguments({
    ...baseReviewRequest,
    environment: {
      strictMcpConfig: true,
      settingSources: "project",
      pluginDirectory: null
    }
  });
  assert.ok(args.includes("--strict-mcp-config"));
  // Scoping discovery without re-supplying the plugin would disable Banzai
  // skills and the enforcement hook, so the flag must not appear alone.
  assert.ok(!args.includes("--setting-sources"));
  assert.ok(!args.includes("--plugin-dir"));
});

test("a live compatibility review still receives exactly one plugin directory", () => {
  const args = buildClaudeArguments({
    ...baseReviewRequest,
    environment: scopedEnvironment,
    liveCompatibility: {
      pluginDirectory: "/candidate/plugins/banzai",
      includeHookEvents: true
    }
  });
  assert.equal(
    args.filter((argument) => argument === "--plugin-dir").length,
    1
  );
  assert.equal(flagValue(args, "--plugin-dir"), "/candidate/plugins/banzai");
  assert.ok(args.includes("--include-hook-events"));
});

test("plugin directory resolution verifies Banzai identity and its required surface", async () => {
  const valid = await pluginFixture(
    '{"name":"banzai","version":"1.0.0","skills":"./skills/"}'
  );
  const missing = await pluginFixture(null);
  const malformed = await pluginFixture("not json");
  const wrongPlugin = await pluginFixture(
    '{"name":"not-banzai","version":"1.0.0","skills":"./skills/"}'
  );
  const incomplete = await pluginFixture(
    '{"name":"banzai","version":"1.0.0","skills":"./skills/"}',
    false
  );
  try {
    const explicit = await resolveClaudeInvocationScope({
      mode: "scoped",
      pluginDirectory: valid.directory
    });
    assert.equal(explicit.scope.pluginDirectory, valid.directory);
    assert.equal(explicit.scope.settingSources, "project");
    assert.equal(explicit.degradedReason, null);

    for (const directory of [
      missing.directory,
      malformed.directory,
      wrongPlugin.directory,
      incomplete.directory
    ]) {
      await assert.rejects(
        async () =>
          await resolveClaudeInvocationScope({
            mode: "scoped",
            pluginDirectory: directory
          }),
        (error: unknown) =>
          error instanceof BanzaiError &&
          error.code === "BANZAI_PLUGIN_DIRECTORY_INVALID"
      );
    }

    const ambient = await resolveClaudeInvocationScope({
      mode: "ambient",
      pluginDirectory: valid.directory
    });
    assert.deepEqual(ambient.scope, AMBIENT_CLAUDE_SCOPE);

    // The orchestrator ships beside its own plugin, so the default resolves.
    const packaged = await resolveClaudeInvocationScope({
      mode: "scoped",
      pluginDirectory: null
    });
    assert.equal(packaged.scope.strictMcpConfig, true);
    assert.ok(
      packaged.scope.pluginDirectory?.endsWith(path.join("plugins", "banzai"))
    );
  } finally {
    for (const fixture of [
      valid,
      missing,
      malformed,
      wrongPlugin,
      incomplete
    ]) {
      await rm(fixture.root, { recursive: true, force: true });
    }
  }
});

const rateLimitedStream = [
  JSON.stringify({
    type: "system",
    subtype: "init",
    tools: ["Read", "Grep", "mcp__serena__find_symbol"]
  }),
  JSON.stringify({
    type: "assistant",
    error: "rate_limit",
    is_api_error_message: true,
    message: { content: [{ type: "text", text: "limit" }] }
  }),
  JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: true,
    terminal_reason: "api_error",
    api_error_status: 429,
    total_cost_usd: 3.2666075,
    usage: {
      input_tokens: 4,
      cache_creation_input_tokens: 323197,
      cache_read_input_tokens: 45785,
      output_tokens: 469
    }
  })
].join("\n");

test("a failed Claude process yields its typed cause and the usage it already spent", () => {
  assert.equal(classifyClaudeFailure(rateLimitedStream), "capacity");
  const usage = claudeUsage(rateLimitedStream);
  assert.ok(usage);
  // Claude's `input_tokens` counts only what touched no cache, so the total
  // input is that plus both cache figures; only the cache reads are cached —
  // cache-creation tokens are premium-billed fresh input, not hits.
  assert.equal(usage.inputTokens, 4 + 323197 + 45785);
  assert.equal(usage.cachedInputTokens, 45785);
  assert.ok(usage.cachedInputTokens < usage.inputTokens);
  assert.equal(usage.outputTokens, 469);
  assert.equal(usage.costUsd, 3.2666075);
});

test("failure classification never depends on vendor prose", () => {
  const prose = JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: true,
    result: "You've hit your session limit · resets 8pm"
  });
  assert.equal(classifyClaudeFailure(prose), "unclassified");
  assert.equal(
    classifyClaudeFailure(
      JSON.stringify({
        type: "result",
        terminal_reason: "api_error",
        api_error_status: 503
      })
    ),
    "transport"
  );
  assert.equal(classifyClaudeFailure(""), "unclassified");
  assert.equal(
    classifyModelFailure(new BanzaiError("PROCESS_TIMEOUT", "timed out")),
    "timeout"
  );
  assert.equal(
    classifyModelFailure(new BanzaiError("PROCESS_START_FAILED", "no binary")),
    "process_start"
  );
  assert.equal(classifyModelFailure(new Error("anything")), "unclassified");
  assert.equal(
    classifyModelFailure(
      new ProcessExitError("CLAUDE_REVIEW_FAILED", "boom", failed("", ""))
    ),
    "unclassified"
  );
});

test("a Codex process that never started a thread is classified as a startup failure", () => {
  // Observed live: codex-cli exited 1 in 140 ms with an empty stdout after it
  // could not open its own ~/.codex state database. Nothing about the model,
  // the review, or the repository can be inferred from that.
  assert.equal(classifyCodexFailure(""), "process_start");
  assert.equal(classifyCodexFailure("   \n\n"), "process_start");
  // Non-JSON diagnostics alone are still no protocol output.
  assert.equal(classifyCodexFailure("Error: boom\n"), "process_start");
  // A stream that carried protocol events did begin work, so it stays on the
  // conservative rotating path rather than claiming the process never ran.
  assert.equal(
    classifyCodexFailure(
      [
        JSON.stringify({ type: "thread.started", thread_id: "t-1" }),
        JSON.stringify({ type: "turn.failed", message: "model refused" })
      ].join("\n")
    ),
    "unclassified"
  );

  const startupFailure = new ProcessExitError(
    "CODEX_PHASE_FAILED",
    "Codex exited 1: failed to initialize in-process app-server client",
    failed("", "Operation not permitted (os error 1)\n")
  );
  assert.equal(classifyModelFailure(startupFailure), "unclassified");
});

test("session inventory digests distinguish the tool sets a session was created with", () => {
  const created = claudeSessionInventory(rateLimitedStream);
  const resumed = claudeSessionInventory(
    JSON.stringify({
      type: "system",
      subtype: "init",
      tools: ["Read", "Grep"]
    })
  );
  const reordered = claudeSessionInventory(
    JSON.stringify({
      type: "system",
      subtype: "init",
      tools: ["Grep", "Read"]
    })
  );
  assert.ok(created);
  assert.ok(resumed);
  assert.ok(reordered);
  assert.equal(created.toolCount, 3);
  assert.equal(resumed.toolCount, 2);
  assert.notEqual(created.digest, resumed.digest);
  // Order is not identity: the same inventory reported differently must match.
  assert.equal(reordered.digest, resumed.digest);
  assert.equal(claudeSessionInventory("{}"), null);
});

test("Codex commands use argv, schema output, and no worktree operation", () => {
  const fresh = buildCodexArguments(
    basePhaseRequest,
    "/schema.json",
    "/result.json"
  );
  assert.deepEqual(fresh.slice(0, 2), ["exec", "--json"]);
  assert.ok(fresh.includes("workspace-write"));
  assert.ok(!fresh.includes("--worktree"));

  const resumed = buildCodexArguments(
    { ...basePhaseRequest, resumeSessionId: "thread-id" },
    "/schema.json",
    "/result.json"
  );
  assert.deepEqual(resumed.slice(0, 3), ["exec", "resume", "--json"]);
  assert.ok(resumed.includes("thread-id"));
  assert.ok(resumed.includes('sandbox_mode="workspace-write"'));
});

test("Claude reviewer exposes read-only tools and denies all writing", () => {
  const args = buildClaudeArguments(baseReviewRequest);
  const outputFormat = args.indexOf("--output-format");
  assert.equal(args[outputFormat + 1], "stream-json");
  assert.ok(args.includes("--verbose"));
  assert.ok(args.includes("Read,Glob,Grep,Skill"));
  assert.ok(
    args.includes("Bash,Edit,Write,MultiEdit,NotebookEdit,WebFetch,WebSearch")
  );
  assert.ok(!args.includes("Bash,Edit,Write,NotebookEdit,WebFetch,WebSearch"));
  assert.ok(!args.includes("--bare"));
  assert.ok(!args.includes("--resume"));
  assert.ok(!args.includes("--worktree"));
});

test("live Claude review opts into packaged hooks without changing ordinary review", () => {
  const ordinary = buildClaudeArguments(baseReviewRequest);
  assert.equal(ordinary.includes("--plugin-dir"), false);
  assert.equal(ordinary.includes("--include-hook-events"), false);

  const live = buildClaudeArguments({
    ...baseReviewRequest,
    liveCompatibility: {
      pluginDirectory: "/candidate/plugins/banzai",
      includeHookEvents: true
    }
  });
  const pluginIndex = live.indexOf("--plugin-dir");
  assert.equal(live[pluginIndex + 1], "/candidate/plugins/banzai");
  assert.equal(live.includes("--include-hook-events"), true);
});

test("resumed reviewers reapply vendor read-only restrictions", () => {
  const claude = buildClaudeArguments({
    ...baseReviewRequest,
    resumeSessionId: "review-session"
  });
  assert.deepEqual(claude.slice(-2), ["--resume", "review-session"]);
  assert.ok(claude.includes("Read,Glob,Grep,Skill"));
  assert.ok(
    claude.includes("Bash,Edit,Write,MultiEdit,NotebookEdit,WebFetch,WebSearch")
  );

  const codex = buildCodexArguments(
    {
      ...basePhaseRequest,
      resumeSessionId: "review-thread"
    },
    "/schema.json",
    "/result.json",
    "read-only"
  );
  assert.ok(codex.includes('sandbox_mode="read-only"'));
  assert.equal(codex.includes("workspace-write"), false);
});

test("Claude workflow selection exposes only read-only tools and its schema", () => {
  const promptEnvelope = createPromptEnvelope([
    { category: "phase_instructions", text: baseSelectionRequest.prompt }
  ]);
  const outputContract = resolveOutputContract(
    "claude",
    "workflow-selection/v1"
  );
  const args = buildClaudeSelectionArguments({
    ...baseSelectionRequest,
    settings: { ...settings, executable: "claude" },
    promptEnvelope,
    outputContract
  });
  assert.ok(args.includes("Read,Glob,Grep"));
  assert.ok(
    args.includes("Skill,Bash,Edit,Write,NotebookEdit,WebFetch,WebSearch")
  );
  const schemaIndex = args.indexOf("--json-schema");
  const raw = args[schemaIndex + 1] ?? "";
  assert.equal(raw, outputContract.serialized);
  assert.equal(raw.includes("$schema"), false);
  const schema = JSON.parse(raw) as Record<string, unknown>;
  assert.equal(schema.$id, workflowSelectionSchema.$id);
});

test("adapter argument builders reject prompt-envelope drift", () => {
  assert.throws(
    () =>
      buildClaudeSelectionArguments({
        ...baseSelectionRequest,
        settings: { ...settings, executable: "claude" },
        promptEnvelope: createPromptEnvelope([
          { category: "phase_instructions", text: "different prompt" }
        ]),
        outputContract: resolveOutputContract("claude", "workflow-selection/v1")
      }),
    (error: unknown) =>
      error instanceof BanzaiError && error.code === "PROMPT_ENVELOPE_MISMATCH"
  );
});

test("Claude workflow selection decodes the shared structured result", async () => {
  const selection = {
    contractVersion: "1.0.0",
    recommendedWorkflow: "quick-fix",
    confidence: "high",
    reason: "This corrects existing behavior.",
    escalationTriggers: []
  };
  const runner: ProcessRunner = async (spec) => {
    assert.ok(spec.args.includes("Read,Glob,Grep"));
    assert.equal(spec.env.BANZAI_RUN_ID, "selection-run");
    return successful(
      JSON.stringify({
        type: "result",
        structured_output: selection,
        session_id: "selection-session",
        usage: { input_tokens: 10, output_tokens: 2 }
      })
    );
  };

  const result = await createVendorAdapters(runner).runSelection({
    ...baseSelectionRequest,
    settings: { ...settings, executable: "claude" },
    outputContract: claudeSelectionOutputContract,
    env: { BANZAI_RUN_ID: "selection-run" }
  });
  assert.equal(result.result.recommendedWorkflow, "quick-fix");
  assert.equal(result.sessionId, "selection-session");
});

test("Codex workflow selection runs in a read-only sandbox", async () => {
  const runDirectory = await mkdtemp(
    path.join(tmpdir(), "banzai-selection-adapter-")
  );
  const selection = {
    contractVersion: "1.0.0",
    recommendedWorkflow: "feature",
    confidence: "high",
    reason: "This is a small new capability.",
    escalationTriggers: []
  };
  const promptEnvelope = createPromptEnvelope([
    { category: "phase_instructions", text: baseSelectionRequest.prompt }
  ]);
  const outputContract = resolveOutputContract(
    "codex",
    "workflow-selection/v1"
  );
  const runner: ProcessRunner = async (spec) => {
    assert.ok(spec.args.includes("read-only"));
    assert.equal(spec.args.includes("workspace-write"), false);
    const schemaIndex = spec.args.indexOf("--output-schema");
    assert.match(
      spec.args[schemaIndex + 1] ?? "",
      /workflow-selection\.schema\.json$/
    );
    assert.equal(
      await readFile(spec.args[schemaIndex + 1] ?? "", "utf8"),
      outputContract.serialized
    );
    const outputIndex = spec.args.indexOf("-o");
    const outputPath = spec.args[outputIndex + 1];
    assert.ok(outputPath);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, JSON.stringify(selection), "utf8");
    return successful(
      JSON.stringify({ type: "thread.started", thread_id: "selection-thread" })
    );
  };

  try {
    const result = await createVendorAdapters(runner).runSelection({
      ...baseSelectionRequest,
      runDirectory,
      promptEnvelope,
      outputContract
    });
    assert.equal(result.result.recommendedWorkflow, "feature");
    assert.equal(result.sessionId, "selection-thread");
  } finally {
    await rm(runDirectory, { recursive: true, force: true });
  }
});

test("the review schema reaches Claude without a meta-schema declaration", () => {
  const args = buildClaudeArguments(baseReviewRequest);
  const schemaIndex = args.indexOf("--json-schema");
  assert.notEqual(schemaIndex, -1);
  const raw = args[schemaIndex + 1] ?? "";
  // Claude Code rejects the whole schema when it cannot resolve $schema.
  assert.equal(raw.includes("$schema"), false);

  const schema = JSON.parse(raw) as Record<string, unknown>;
  assert.equal("$schema" in schema, false);
  assert.equal(schema.$id, reviewResultSchema.$id);
  assert.equal(schema.title, reviewResultSchema.title);
  assert.deepEqual(schema.required, reviewResultSchema.required);
  assert.deepEqual(schema.$defs, reviewResultSchema.$defs);
  assert.deepEqual(schema.properties, reviewResultSchema.properties);
});

test("sanitizing a schema leaves the published contract untouched", () => {
  const sanitized = claudeJsonSchema(reviewResultSchema);
  assert.equal("$schema" in sanitized, false);
  assert.equal(
    reviewResultSchema.$schema,
    "https://json-schema.org/draft/2020-12/schema"
  );
  // The Codex phase contract is written to disk verbatim and must keep its own
  // declaration; only the Claude argument copy is sanitized.
  assert.equal(
    phaseResultSchema.$schema,
    "https://json-schema.org/draft/2020-12/schema"
  );
});

test("Claude can run a writing phase with edit and shell tools", () => {
  const args = buildClaudePhaseArguments({
    ...basePhaseRequest,
    settings: { ...settings, executable: "claude" },
    outputContract: claudePhaseOutputContract
  });
  const outputFormat = args.indexOf("--output-format");
  assert.equal(args[outputFormat + 1], "stream-json");
  assert.ok(args.includes("--verbose"));
  assert.ok(args.includes("Read,Glob,Grep,Skill,Edit,Write,NotebookEdit,Bash"));
  assert.ok(args.includes("WebFetch,WebSearch"));
  assert.ok(!args.includes("--resume"));

  const schemaIndex = args.indexOf("--json-schema");
  const raw = args[schemaIndex + 1] ?? "";
  // The phase contract, not the review contract, and without the meta-schema.
  assert.equal(raw.includes("$schema"), false);
  const schema = JSON.parse(raw) as Record<string, unknown>;
  assert.equal(schema.$id, legacyPhaseResultV3Schema.$id);
  const properties = schema.properties as Record<
    string,
    Record<string, unknown>
  >;
  assert.equal(properties.schemaVersion?.const, 3);
  assert.ok((schema.required as string[]).includes("taskCompletion"));

  const resumed = buildClaudePhaseArguments({
    ...basePhaseRequest,
    settings: { ...settings, executable: "claude" },
    outputContract: claudePhaseOutputContract,
    resumeSessionId: "claude-session"
  });
  assert.ok(resumed.includes("--resume"));
  assert.ok(resumed.includes("claude-session"));
});

test("Codex can run a review in a read-only sandbox", () => {
  const args = buildCodexArguments(
    { ...basePhaseRequest, resumeSessionId: null },
    "/review-schema.json",
    "/review-result.json",
    "read-only"
  );
  assert.ok(args.includes("read-only"));
  assert.equal(args.includes("workspace-write"), false);
  assert.ok(args.includes("--output-schema"));
  assert.ok(args.includes("/review-schema.json"));
});

test("Codex review receives no artifact write authorization", async () => {
  const runDirectory = await mkdtemp(
    path.join(tmpdir(), "banzai-codex-review-adapter-")
  );
  try {
    let reviewEnvironment: NodeJS.ProcessEnv | undefined;
    const runner: ProcessRunner = async (spec) => {
      reviewEnvironment = spec.env;
      const outputIndex = spec.args.indexOf("-o");
      const outputPath = spec.args[outputIndex + 1];
      assert.ok(outputPath);
      await mkdir(path.dirname(outputPath), { recursive: true });
      await writeFile(
        outputPath,
        JSON.stringify(currentReviewFixture(reviewSnapshotFixture())),
        "utf8"
      );
      return successful(
        JSON.stringify({
          type: "thread.started",
          thread_id: "codex-review-session"
        })
      );
    };

    await createVendorAdapters(runner).runReview({
      ...baseReviewRequest,
      runDirectory,
      settings: codexSettings,
      outputContract: codexReviewOutputContract,
      env: {
        BANZAI_REVIEW_ARTIFACT: "stale-parent-value.md",
        BANZAI_WORKFLOW_DIGEST: "stale-workflow"
      }
    });

    assert.ok(reviewEnvironment);
    assert.equal(reviewEnvironment.BANZAI_RUN_ID, "run-example");
    assert.equal(reviewEnvironment.BANZAI_APPROVAL_DIGEST, "approved-digest");
    assert.equal(reviewEnvironment.BANZAI_REVIEW_ARTIFACT, undefined);
    assert.equal(reviewEnvironment.BANZAI_WORKFLOW_DIGEST, undefined);
  } finally {
    await rm(runDirectory, { recursive: true, force: true });
  }
});

test("an executable belonging to neither vendor is rejected before spawning", async () => {
  const runner: ProcessRunner = async () => {
    throw new Error("No process may be started for an unknown vendor.");
  };
  const adapters = createVendorAdapters(runner);
  const unknown = { ...settings, executable: "my-wrapper" };

  await assert.rejects(
    adapters.runSelection({ ...baseSelectionRequest, settings: unknown }),
    /neither a codex nor a claude executable/
  );
  await assert.rejects(
    adapters.runPhase({ ...basePhaseRequest, settings: unknown }),
    /neither a codex nor a claude executable/
  );
  await assert.rejects(
    adapters.runReview({ ...baseReviewRequest, settings: unknown }),
    /neither a codex nor a claude executable/
  );
});

test("subscription child environment strips vendor API overrides", () => {
  const sanitized = subscriptionOnlyEnvironment({
    PATH: "/bin",
    OPENAI_API_KEY: "secret",
    ANTHROPIC_API_KEY: "secret",
    CODEX_API_KEY: "secret",
    ANTHROPIC_AUTH_TOKEN: "secret",
    CLAUDE_CODE_OAUTH_TOKEN: "subscription-token",
    CLAUDE_CODE_USE_BEDROCK: "1",
    SAFE_VALUE: "kept"
  });
  assert.equal(sanitized.PATH, "/bin");
  assert.equal(sanitized.SAFE_VALUE, "kept");
  assert.equal(sanitized.OPENAI_API_KEY, undefined);
  assert.equal(sanitized.ANTHROPIC_AUTH_TOKEN, undefined);
  assert.equal(sanitized.CLAUDE_CODE_OAUTH_TOKEN, "subscription-token");
  assert.equal(sanitized.CLAUDE_CODE_USE_BEDROCK, undefined);
});

test("preflight distinguishes Codex sandbox credential isolation from a normal Claude logout", async () => {
  const runner: ProcessRunner = async (spec) => {
    return spec.args[0] === "--version"
      ? successful("2.1.218 (Claude Code)\n")
      : failed(
          JSON.stringify({
            loggedIn: false,
            authMethod: "none",
            apiProvider: "firstParty"
          }),
          ""
        );
  };

  await assert.rejects(
    createVendorAdapters(runner).preflightClaude(settings, {
      PATH: "/bin",
      CODEX_SANDBOX: "seatbelt"
    }),
    (error: unknown) => {
      assert.ok(error instanceof BanzaiError);
      assert.equal(error.code, "CLAUDE_AUTH_UNAVAILABLE_IN_SANDBOX");
      assert.match(error.message, /macOS Keychain/);
      assert.match(error.message, /regular terminal/);
      assert.match(error.message, /CLAUDE_CODE_OAUTH_TOKEN/);
      assert.doesNotMatch(error.message, /claude auth login/);
      return true;
    }
  );

  await assert.rejects(
    createVendorAdapters(runner).preflightClaude(settings, {
      PATH: "/bin"
    }),
    (error: unknown) => {
      assert.ok(error instanceof BanzaiError);
      assert.equal(error.code, "CLAUDE_SUBSCRIPTION_REQUIRED");
      assert.match(error.message, /claude auth login/);
      assert.doesNotMatch(error.message, /Codex sandbox/);
      return true;
    }
  );
});

test("Codex preflight rejects an unwritable state directory before spawning the CLI", async () => {
  const fixtureRoot = await mkdtemp(path.join(tmpdir(), "banzai-codex-home-"));
  const codexHome = path.join(fixtureRoot, "state");
  // A self-referential link makes access() fail with ELOOP even when the test
  // process is root. chmod-based denial is ineffective in root-owned CI images.
  await symlink(codexHome, codexHome);
  let calls = 0;
  const runner: ProcessRunner = async () => {
    calls += 1;
    return successful("codex-cli 0.145.0\n");
  };

  try {
    await assert.rejects(
      createVendorAdapters(runner).preflightCodex(codexSettings, {
        CODEX_HOME: codexHome,
        CODEX_SANDBOX: "seatbelt",
        PATH: "/bin"
      }),
      (error: unknown) => {
        assert.ok(error instanceof BanzaiError);
        assert.equal(error.code, "CODEX_STATE_UNAVAILABLE_IN_SANDBOX");
        assert.match(error.message, /state directory is not writable/i);
        assert.match(error.message, /regular terminal/i);
        assert.doesNotMatch(error.message, new RegExp(codexHome));
        return true;
      }
    );
    await assert.rejects(
      createVendorAdapters(runner).preflightCodex(codexSettings, {
        CODEX_HOME: codexHome,
        PATH: "/bin"
      }),
      (error: unknown) => {
        assert.ok(error instanceof BanzaiError);
        assert.equal(error.code, "CODEX_STATE_NOT_WRITABLE");
        assert.match(error.message, /ensure `CODEX_HOME` exists/i);
        assert.doesNotMatch(error.message, new RegExp(codexHome));
        return true;
      }
    );
    assert.equal(calls, 0);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("preflight distinguishes invalid auth evidence from auth-status invocation failure without leaking output", async () => {
  const secret = "sk-ant-super-secret-auth-output";
  for (const fixture of [
    {
      result: successful(`not-json ${secret}`),
      code: "CLAUDE_AUTH_STATUS_INVALID"
    },
    {
      result: failed(`not-json ${secret}`, `stderr ${secret}`),
      code: "CLAUDE_AUTH_STATUS_FAILED"
    },
    {
      result: failed(
        JSON.stringify({
          loggedIn: true,
          authMethod: "oauth",
          apiProvider: "firstParty",
          token: secret
        }),
        `stderr ${secret}`
      ),
      code: "CLAUDE_AUTH_STATUS_FAILED"
    }
  ] as const) {
    let invocation = 0;
    const runner: ProcessRunner = async () => {
      invocation += 1;
      return invocation === 1
        ? successful("2.1.218 (Claude Code)\n")
        : fixture.result;
    };
    await assert.rejects(
      createVendorAdapters(runner).preflightClaude(settings),
      (error: unknown) => {
        assert.ok(error instanceof BanzaiError);
        assert.equal(error.code, fixture.code);
        assert.doesNotMatch(error.message, /super-secret|sk-ant|stderr/);
        return true;
      }
    );
  }
});

test("preflight accepts subscription auth and rejects Claude API auth", async () => {
  const calls: string[][] = [];
  const goodRunner: ProcessRunner = async (spec) => {
    calls.push(spec.args);
    if (spec.args[0] === "--version") {
      return successful(
        calls.length === 1 ? "codex-cli 0.145.0\n" : "2.1.218 (Claude Code)\n"
      );
    }
    if (spec.args[0] === "login") {
      return successful("Logged in using ChatGPT\n");
    }
    return successful(
      JSON.stringify({
        loggedIn: true,
        authMethod: "oauth",
        apiProvider: "firstParty"
      })
    );
  };
  const adapters = createVendorAdapters(goodRunner);
  await adapters.preflightCodex(settings, {
    CODEX_HOME: tmpdir(),
    PATH: process.env.PATH
  });
  await adapters.preflightClaude(settings);

  let invocation = 0;
  const apiRunner: ProcessRunner = async () => {
    invocation += 1;
    return invocation === 1
      ? successful("2.1.218 (Claude Code)\n")
      : successful(
          JSON.stringify({
            loggedIn: true,
            authMethod: "apiKey",
            apiProvider: "firstParty"
          })
        );
  };
  await assert.rejects(
    createVendorAdapters(apiRunner).preflightClaude(settings),
    /subscription authentication is unavailable/
  );
});

test("redaction removes credential-shaped values", () => {
  const redacted = redactSensitiveText(
    '{"api_key":"secret-value"} sk-ant-abcdefghijklmnop'
  );
  assert.equal(redacted.includes("secret-value"), false);
  assert.equal(redacted.includes("sk-ant-"), false);
});

test("Claude adapter records CLI-reported token and cost usage", async () => {
  const review = currentReviewFixture(reviewSnapshotFixture());
  let reviewEnvironment: NodeJS.ProcessEnv | undefined;
  const progress: ModelProgressEvent[] = [];
  const runner: ProcessRunner = async (spec) => {
    reviewEnvironment = spec.env;
    const lines = [
      JSON.stringify({ type: "system", subtype: "init" }),
      JSON.stringify({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "skill-1",
              name: "Skill",
              input: { skill: "banzai:feature-review" }
            }
          ]
        }
      }),
      JSON.stringify({
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "skill-1",
              content: "private tool output must not be displayed"
            }
          ]
        }
      }),
      JSON.stringify({
        type: "result",
        structured_output: review,
        session_id: "review-session",
        usage: {
          input_tokens: 100,
          cache_read_input_tokens: 25,
          output_tokens: 10
        },
        total_cost_usd: 0.42
      })
    ];
    for (const line of lines) {
      spec.onStdoutLine?.(line);
    }
    return successful(lines.join("\n"));
  };
  const result = await createVendorAdapters(runner).runReview({
    ...baseReviewRequest,
    env: {
      BANZAI_REVIEW_ARTIFACT: "stale-parent-value.md",
      BANZAI_WORKFLOW_DIGEST: "stale-workflow"
    },
    onProgress: (event) => progress.push(event)
  });
  // 100 uncached + 25 read from cache: the total input, with the cached part a
  // subset of it, matching how Codex already reports the same two figures.
  assert.deepEqual(result.usage, {
    inputTokens: 125,
    cachedInputTokens: 25,
    outputTokens: 10,
    costUsd: 0.42
  });
  assert.equal(reviewEnvironment?.BANZAI_RUN_ID, "run-example");
  assert.equal(reviewEnvironment.BANZAI_APPROVAL_DIGEST, "approved-digest");
  assert.equal(reviewEnvironment.BANZAI_REVIEW_ARTIFACT, undefined);
  assert.equal(reviewEnvironment.BANZAI_WORKFLOW_DIGEST, undefined);
  assert.deepEqual(
    progress.filter((event) => event.kind === "skill"),
    [
      {
        kind: "skill",
        status: "started",
        detail: "banzai:feature-review",
        // The vendor's tool id pairs the completion with its start.
        id: "skill-1"
      },
      {
        kind: "skill",
        status: "completed",
        detail: "banzai:feature-review",
        id: "skill-1"
      }
    ]
  );
  assert.equal(
    progress.some((event) => event.detail.includes("private tool output")),
    false
  );
});

test("Codex adapter streams sanitized actions, skills, and usage", async () => {
  const runDirectory = await mkdtemp(
    path.join(tmpdir(), "banzai-adapter-progress-")
  );
  const progress: ModelProgressEvent[] = [];
  const phaseResult = {
    schemaVersion: 3,
    contractVersion: "1.0.0",
    phase: "implementation",
    outcome: "completed",
    gate: null,
    summary: "Implemented.",
    artifacts: {
      description: null,
      plan: null,
      adrs: [],
      implementationReport:
        "documentation/features/example/implementation-report.md",
      testReport: "documentation/features/example/test-report.md"
    },
    taskCompletion: {
      schemaVersion: 1,
      tasks: [
        {
          taskId: "T001",
          status: "completed",
          evidence: [{ path: "src/example.ts", detail: "Implemented." }],
          gap: null
        }
      ]
    },
    touchedPaths: ["src/example.ts"],
    questions: [],
    decisionConsultation: null,
    resolvedFindingIds: [],
    requestedVerification: []
  };
  const lines = [
    JSON.stringify({ type: "thread.started", thread_id: "thread-id" }),
    JSON.stringify({ type: "turn.started" }),
    JSON.stringify({
      type: "item.started",
      item: {
        id: "command-1",
        type: "command_execution",
        command: "PASSWORD=secret-value echo sk-ant-abcdefghijklmnop",
        status: "in_progress"
      }
    }),
    "{malformed progress is ignored",
    JSON.stringify({
      type: "item.completed",
      item: {
        id: "command-1",
        type: "command_execution",
        command: "PASSWORD=secret-value echo sk-ant-abcdefghijklmnop",
        status: "completed",
        exit_code: 0
      }
    }),
    JSON.stringify({
      type: "item.completed",
      item: {
        id: "skill-1",
        type: "skill_invocation",
        name: "banzai:code-writing",
        status: "completed"
      }
    }),
    JSON.stringify({
      type: "item.completed",
      item: {
        id: "files-1",
        type: "file_change",
        changes: [{ path: "src/example.ts", kind: "update" }],
        status: "completed"
      }
    }),
    JSON.stringify({
      type: "turn.completed",
      usage: {
        input_tokens: 120,
        cached_input_tokens: 80,
        output_tokens: 30
      }
    })
  ];
  const runner: ProcessRunner = async (spec) => {
    const outputIndex = spec.args.indexOf("-o");
    const outputPath = spec.args[outputIndex + 1];
    assert.ok(outputPath);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, JSON.stringify(phaseResult), "utf8");
    for (const line of lines) {
      spec.onStdoutLine?.(line);
    }
    return successful(lines.join("\n"));
  };

  try {
    const result = await createVendorAdapters(runner).runPhase({
      ...basePhaseRequest,
      runDirectory,
      onProgress: (event) => progress.push(event)
    });

    assert.equal(result.sessionId, "thread-id");
    assert.equal(result.result.phase, "implementation");
    assert.ok(
      progress.some(
        (event) =>
          event.kind === "action" &&
          event.status === "started" &&
          event.detail.includes("command:")
      )
    );
    assert.ok(
      progress.some(
        (event) =>
          event.kind === "skill" &&
          event.status === "completed" &&
          event.detail === "banzai:code-writing"
      )
    );
    assert.ok(
      progress.some(
        (event) =>
          event.kind === "action" &&
          event.detail === "file changes: src/example.ts"
      )
    );
    assert.ok(
      progress.some(
        (event) =>
          event.kind === "usage" &&
          event.detail === "tokens: 120 in (40 fresh · 66% cached) · 30 out"
      )
    );
    assert.equal(
      progress.some((event) => event.detail.includes("sk-ant-")),
      false
    );
    assert.equal(
      progress.some((event) => event.detail.includes("secret-value")),
      false
    );
  } finally {
    await rm(runDirectory, { recursive: true, force: true });
  }
});

function terminalPhaseResult() {
  return {
    schemaVersion: 3 as const,
    contractVersion: "1.0.0" as const,
    phase: "plan" as const,
    outcome: "needs_human_decision" as const,
    gate: "plan_approval" as const,
    summary: "Plan ready.",
    artifacts: {
      description: "documentation/features/example/description.md",
      plan: "documentation/development-plans/example/plan.md",
      adrs: [],
      implementationReport: null,
      testReport: null
    },
    taskCompletion: null,
    touchedPaths: [],
    questions: [],
    decisionConsultation: null,
    resolvedFindingIds: [],
    requestedVerification: []
  };
}

test("Claude terminal result is durably acknowledged before adapter return", async () => {
  const phaseResult = terminalPhaseResult();
  const line = JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: false,
    structured_output: phaseResult,
    session_id: "claude-session",
    usage: { input_tokens: 10, output_tokens: 2 }
  });
  const order: string[] = [];
  const runner: ProcessRunner = async (spec) => {
    await spec.onStdoutLineDurable?.(line);
    order.push("process-close");
    return successful(line);
  };
  const result = await createVendorAdapters(runner).runPhase({
    ...basePhaseRequest,
    settings,
    outputContract: claudePhaseOutputContract,
    onTerminalSuccess: async (terminal) => {
      order.push("checkpoint");
      assert.equal(terminal.classification, "claude_result");
      assert.equal(terminal.sessionId, "claude-session");
      assert.deepEqual(terminal.result, phaseResult);
    }
  });
  assert.equal(result.result.phase, "plan");
  assert.deepEqual(order, ["checkpoint", "process-close"]);
});

test("Claude durable observer requires an explicit non-error success result", async () => {
  const phaseResult = terminalPhaseResult();
  const variants = [
    { is_error: false },
    { subtype: "success" },
    { subtype: "success", is_error: true },
    { subtype: "error", is_error: false },
    { subtype: 1, is_error: false },
    { subtype: "success", is_error: "false" }
  ];
  for (const variant of variants) {
    const line = JSON.stringify({
      type: "result",
      structured_output: phaseResult,
      ...variant
    });
    let checkpoints = 0;
    const runner: ProcessRunner = async (spec) => {
      await spec.onStdoutLineDurable?.(line);
      return successful(line);
    };
    const result = await createVendorAdapters(runner).runPhase({
      ...basePhaseRequest,
      settings,
      outputContract: claudePhaseOutputContract,
      onTerminalSuccess: async () => {
        checkpoints += 1;
      }
    });
    assert.equal(result.result.phase, "plan");
    assert.equal(checkpoints, 0, JSON.stringify(variant));
  }
});

test("Claude durable observer rejects duplicate terminal result events", async () => {
  const phaseResult = terminalPhaseResult();
  const line = JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: false,
    structured_output: phaseResult
  });
  let checkpoints = 0;
  const runner: ProcessRunner = async (spec) => {
    await spec.onStdoutLineDurable?.(line);
    await spec.onStdoutLineDurable?.(line);
    return successful(`${line}\n${line}`);
  };
  await assert.rejects(
    createVendorAdapters(runner).runPhase({
      ...basePhaseRequest,
      settings,
      outputContract: claudePhaseOutputContract,
      onTerminalSuccess: async () => {
        checkpoints += 1;
      }
    }),
    (error: unknown) =>
      error instanceof BanzaiError && error.code === "TERMINAL_RESULT_CONFLICT"
  );
  assert.equal(checkpoints, 1);
});

test("Codex checkpoints only a structured agent message confirmed by turn.completed", async () => {
  const runDirectory = await mkdtemp(
    path.join(tmpdir(), "banzai-terminal-codex-")
  );
  const phaseResult = terminalPhaseResult();
  const lines = [
    JSON.stringify({ type: "thread.started", thread_id: "codex-session" }),
    JSON.stringify({
      type: "item.completed",
      item: { type: "agent_message", text: JSON.stringify(phaseResult) }
    }),
    JSON.stringify({
      type: "turn.completed",
      usage: { input_tokens: 12, cached_input_tokens: 4, output_tokens: 3 }
    })
  ];
  let checkpointCount = 0;
  const runner: ProcessRunner = async (spec) => {
    const outputPath = spec.args[spec.args.indexOf("-o") + 1];
    assert.ok(outputPath);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, JSON.stringify(phaseResult), "utf8");
    for (const line of lines) {
      spec.onStdoutLine?.(line);
      await spec.onStdoutLineDurable?.(line);
    }
    return successful(lines.join("\n"));
  };
  try {
    const result = await createVendorAdapters(runner).runPhase({
      ...basePhaseRequest,
      runDirectory,
      onTerminalSuccess: async (terminal) => {
        checkpointCount += 1;
        assert.equal(terminal.classification, "codex_turn_completed");
        assert.equal(terminal.sessionId, "codex-session");
        assert.deepEqual(terminal.result, phaseResult);
      }
    });
    assert.equal(result.result.phase, "plan");
    assert.equal(checkpointCount, 1);
  } finally {
    await rm(runDirectory, { recursive: true, force: true });
  }
});

test("Codex leaves an unconfirmed structured result to the ordinary close path", async () => {
  const runDirectory = await mkdtemp(
    path.join(tmpdir(), "banzai-terminal-codex-unconfirmed-")
  );
  const phaseResult = terminalPhaseResult();
  const lines = [
    JSON.stringify({ type: "thread.started", thread_id: "codex-session" }),
    JSON.stringify({
      type: "item.completed",
      item: { type: "agent_message", text: JSON.stringify(phaseResult) }
    })
  ];
  let checkpointCount = 0;
  const runner: ProcessRunner = async (spec) => {
    const outputPath = spec.args[spec.args.indexOf("-o") + 1];
    assert.ok(outputPath);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, JSON.stringify(phaseResult), "utf8");
    for (const line of lines) {
      await spec.onStdoutLineDurable?.(line);
    }
    return successful(lines.join("\n"));
  };
  try {
    const result = await createVendorAdapters(runner).runPhase({
      ...basePhaseRequest,
      runDirectory,
      onTerminalSuccess: async () => {
        checkpointCount += 1;
      }
    });
    assert.equal(result.result.phase, "plan");
    assert.equal(checkpointCount, 0);
  } finally {
    await rm(runDirectory, { recursive: true, force: true });
  }
});

test("Codex checkpoints the final result after schema-valid progress JSON", async () => {
  const runDirectory = await mkdtemp(
    path.join(tmpdir(), "banzai-terminal-codex-conflict-")
  );
  const phaseResult = terminalPhaseResult();
  const lines = [
    { type: "thread.started", thread_id: "codex-session" },
    {
      type: "item.completed",
      item: {
        type: "agent_message",
        text: JSON.stringify({ ...phaseResult, outcome: "blocked", gate: null })
      }
    },
    { type: "item.completed", item: { type: "command_execution" } },
    {
      type: "item.completed",
      item: { type: "agent_message", text: JSON.stringify(phaseResult) }
    },
    { type: "turn.completed", usage: { input_tokens: 12, output_tokens: 3 } }
  ].map((event) => JSON.stringify(event));
  let checkpointCount = 0;
  const runner: ProcessRunner = async (spec) => {
    const outputPath = spec.args[spec.args.indexOf("-o") + 1];
    assert.ok(outputPath);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, JSON.stringify(phaseResult), "utf8");
    for (const line of lines) await spec.onStdoutLineDurable?.(line);
    return successful(lines.join("\n"));
  };
  try {
    const result = await createVendorAdapters(runner).runPhase({
      ...basePhaseRequest,
      runDirectory,
      onTerminalSuccess: async (terminal) => {
        checkpointCount += 1;
        assert.deepEqual(terminal.result, phaseResult);
      }
    });
    assert.deepEqual(result.result, phaseResult);
    assert.equal(checkpointCount, 1);
  } finally {
    await rm(runDirectory, { recursive: true, force: true });
  }
});

for (const vendor of ["codex", "claude"] as const) {
  test(`${vendor} persists the session announcement before a failed planning turn`, async () => {
    const runDirectory = await mkdtemp(
      path.join(tmpdir(), "banzai-early-session-")
    );
    try {
      let savedId: string | null = null;
      const line = JSON.stringify(
        vendor === "codex"
          ? { type: "thread.started", thread_id: "early-session" }
          : { type: "system", subtype: "init", session_id: "early-session" }
      );
      const runner: ProcessRunner = async (spec) => {
        await spec.onStdoutLineDurable?.(line);
        assert.equal(savedId, "early-session");
        throw new ProcessExitError(
          "PROCESS_TIMEOUT",
          "Timed out after session initialization.",
          {
            ...successful(line),
            exitCode: 1,
            stderr: "Retained diagnostic."
          },
          { failureCause: "timeout" }
        );
      };
      await assert.rejects(
        createVendorAdapters(runner).runPhase({
          ...basePhaseRequest,
          runDirectory,
          settings: { ...codexSettings, executable: vendor },
          outputContract: resolveOutputContract(vendor, "phase-result/v3"),
          onSessionStarted: async (id) => {
            savedId = id;
          }
        }),
        (error: unknown) => {
          assert.ok(error instanceof ProcessExitError);
          assert.equal(error.failureCause, "timeout");
          assert.equal(error.stdout, line);
          assert.equal(error.stderr, "Retained diagnostic.");
          return true;
        }
      );
    } finally {
      await rm(runDirectory, { recursive: true, force: true });
    }
  });
}

test("Codex decoder failures retain successful-process streams and usage", async () => {
  const runDirectory = await mkdtemp(
    path.join(tmpdir(), "banzai-decoder-output-")
  );
  const stdout = JSON.stringify({
    type: "turn.completed",
    usage: { input_tokens: 40, cached_input_tokens: 20, output_tokens: 2 }
  });
  const runner: ProcessRunner = async (spec) => {
    const outputPath = spec.args[spec.args.indexOf("-o") + 1];
    assert.ok(outputPath);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, "not JSON");
    return { ...successful(stdout), stderr: "Decoder diagnostic." };
  };
  try {
    await assert.rejects(
      createVendorAdapters(runner).runPhase({
        ...basePhaseRequest,
        runDirectory
      }),
      (error: unknown) => {
        assert.ok(error instanceof ProcessExitError);
        assert.equal(error.code, "MODEL_RESULT_INVALID");
        assert.equal(error.stdout, stdout);
        assert.equal(error.stderr, "Decoder diagnostic.");
        assert.equal(error.usage?.inputTokens, 40);
        return true;
      }
    );
  } finally {
    await rm(runDirectory, { recursive: true, force: true });
  }
});

for (const scenario of [
  "duplicate-turn",
  "after-terminal",
  "explicit-finals",
  "result-mismatch",
  "invalid-final"
] as const) {
  test(`Codex terminal evidence rejects ${scenario}`, async () => {
    const runDirectory = await mkdtemp(
      path.join(tmpdir(), "banzai-terminal-integrity-")
    );
    const result = terminalPhaseResult();
    const message = {
      type: "item.completed",
      item: { type: "agent_message", text: JSON.stringify(result) }
    };
    const completed = { type: "turn.completed" };
    const lines =
      scenario === "duplicate-turn"
        ? [message, completed, completed]
        : scenario === "after-terminal"
          ? [message, completed, message]
          : scenario === "explicit-finals"
            ? [
                {
                  ...message,
                  item: { ...message.item, phase: "final_answer" }
                },
                { ...message, item: { ...message.item, phase: "final_answer" } }
              ]
            : scenario === "invalid-final"
              ? [
                  message,
                  { ...message, item: { ...message.item, text: "not JSON" } },
                  completed
                ]
              : [message, completed];
    let checkpoints = 0;
    const runner: ProcessRunner = async (spec) => {
      const outputPath = spec.args[spec.args.indexOf("-o") + 1];
      assert.ok(outputPath);
      await mkdir(path.dirname(outputPath), { recursive: true });
      await writeFile(
        outputPath,
        scenario === "invalid-final"
          ? "not JSON"
          : JSON.stringify({ ...result, summary: "Conflicting file result." })
      );
      for (const line of lines)
        await spec.onStdoutLineDurable?.(JSON.stringify(line));
      return successful(lines.map((line) => JSON.stringify(line)).join("\n"));
    };
    try {
      await assert.rejects(
        createVendorAdapters(runner).runPhase({
          ...basePhaseRequest,
          runDirectory,
          onTerminalSuccess: async () => {
            checkpoints++;
          }
        })
      );
      if (scenario === "invalid-final" || scenario === "explicit-finals")
        assert.equal(checkpoints, 0);
    } finally {
      await rm(runDirectory, { recursive: true, force: true });
    }
  });
}

test("Codex non-zero exits retain both streams and prefer structured errors", async () => {
  const runDirectory = await mkdtemp(
    path.join(tmpdir(), "banzai-adapter-failure-")
  );
  const runner: ProcessRunner = async () =>
    failed(
      [
        JSON.stringify({ type: "thread.started", thread_id: "thread-id" }),
        JSON.stringify({
          type: "error",
          message: "Shortcut MCP authorization is required."
        })
      ].join("\n"),
      "Reading additional input from stdin...\n"
    );

  try {
    await assert.rejects(
      createVendorAdapters(runner).runPhase({
        ...basePhaseRequest,
        runDirectory
      }),
      (error: unknown) => {
        assert.ok(error instanceof ProcessExitError);
        assert.match(error.message, /Shortcut MCP authorization is required/);
        assert.match(error.stdout, /thread\.started/);
        assert.match(error.stderr, /Reading additional input/);
        return true;
      }
    );
  } finally {
    await rm(runDirectory, { recursive: true, force: true });
  }
});

test("command summaries name the command the shell ran", () => {
  assert.equal(summarizeCommand('zsh -lc "npm test"'), "npm test");
  assert.equal(
    summarizeCommand("bash -c 'git diff --check'"),
    "git diff --check"
  );
  assert.equal(
    summarizeCommand('/bin/sh -lic "rg -n pattern src"'),
    "rg -n pattern src"
  );
  // A shell without a command flag, and a non-shell executable, stay verbatim.
  assert.equal(summarizeCommand("zsh script.sh"), "zsh script.sh");
  assert.equal(
    summarizeCommand("npm run lint --silent"),
    "npm run lint --silent"
  );
  assert.equal(
    summarizeCommand('zsh -lc "npm test && git status"'),
    "npm test && git status"
  );
});

test("command summaries drop inline secrets rather than the whole command", () => {
  // Leading assignments are prefix noise and a secret carrier, so they go.
  assert.equal(
    summarizeCommand("PASSWORD=secret-value echo hello"),
    "echo hello"
  );
  // A mid-command assignment is elided, never silently removed.
  assert.equal(summarizeCommand("deploy --token=abc123 now"), "deploy … now");
  // The value is elided by its own shape, so no short-flag guess is needed.
  assert.equal(
    summarizeCommand("curl -H 'Authorization: Bearer abc' url"),
    "curl -H … url"
  );
  assert.equal(summarizeCommand("fetch 'Bearer abc123def' url"), "fetch … url");
  assert.equal(
    summarizeCommand("mysql --password hunter2 db"),
    "mysql --password … db"
  );
  // Consecutive elisions collapse.
  // `x=1` follows a credential flag; `y=2` is neither credential-shaped nor an
  // environment assignment, so it survives.
  assert.equal(summarizeCommand("a --token x=1 y=2 b"), "a --token … y=2 b");
  for (const rendered of [
    summarizeCommand("PASSWORD=secret-value echo sk-ant-abcdefghijklmnop"),
    summarizeCommand(
      'zsh -lc "PASSWORD=secret-value curl --token=sk-ant-abcdefghijklmnop"'
    )
  ]) {
    assert.equal(rendered.includes("secret-value"), false);
    assert.equal(rendered.includes("sk-ant-"), false);
  }
});

test("command summaries stay within one terminal line", () => {
  const long = summarizeCommand(
    `zsh -lc "npm run ${"verify-everything ".repeat(10)}"`
  );
  assert.ok(long.length <= 56, long);
  assert.ok(long.endsWith("…"));
  assert.equal(summarizeCommand(""), "");
  assert.equal(summarizeCommand(null), "");
  assert.equal(summarizeCommand("zsh -lc"), "");
});

test("common short flags are not mistaken for credential flags", () => {
  // `-p`, `-u`, `-H`, and friends are overwhelmingly benign; eliding the token
  // after them destroys exactly the argument worth showing.
  assert.equal(
    summarizeCommand('zsh -lc "mkdir -p src/generated"'),
    "mkdir -p src/generated"
  );
  assert.equal(summarizeCommand("sort -u paths.txt"), "sort -u paths.txt");
  assert.equal(summarizeCommand("cp -p a.txt b.txt"), "cp -p a.txt b.txt");
  assert.equal(summarizeCommand("git diff -u HEAD~1"), "git diff -u HEAD~1");
  assert.equal(
    summarizeCommand("docker run -p 8080:80 img"),
    "docker run -p 8080:80 img"
  );
});

test("non-ASCII paths and patterns survive the summary", () => {
  // A rule that erased every non-ASCII token would be unusable outside an
  // English-only checkout.
  assert.equal(
    summarizeCommand('zsh -lc "cat docs/caf\u00e9/README.md"'),
    "cat docs/caf\u00e9/README.md"
  );
  assert.equal(
    summarizeCommand("rg -n \u0444\u0443\u043d\u043a\u0446\u0456\u044f src"),
    "rg -n \u0444\u0443\u043d\u043a\u0446\u0456\u044f src"
  );
  // Bidi overrides can reorder a rendered line, so those are still elided.
  assert.equal(summarizeCommand("rm \u202esj.txt"), "rm \u2026");
});

test("truncation cuts whole characters, never half a surrogate pair", () => {
  const rendered = summarizeCommand(`echo ${"\u{1f600}".repeat(80)}`);
  assert.ok(Array.from(rendered).length <= 56);
  // A lone high surrogate is what a naive UTF-16 slice would leave behind.
  assert.equal(/[\ud800-\udbff](?![\udc00-\udfff])/.test(rendered), false);
  assert.equal(/(?<![\ud800-\udbff])[\udc00-\udfff]/.test(rendered), false);
  assert.ok(rendered.endsWith("\u2026"));
});

test("ordinary long options keep their values", () => {
  // Eliding every `=` erased exactly the content of the line.
  assert.equal(
    summarizeCommand('zsh -lc "git status --porcelain=v1 | head -50"'),
    "git status --porcelain=v1 | head -50"
  );
  assert.equal(
    summarizeCommand("git log --max-count=10 --format=oneline"),
    "git log --max-count=10 --format=oneline"
  );
  assert.equal(
    summarizeCommand("npm test -- --grep=slow"),
    "npm test -- --grep=slow"
  );
  // The carriers still go.
  assert.equal(summarizeCommand("deploy --api-key=abc now"), "deploy … now");
  assert.equal(summarizeCommand("run --auth-token=abc now"), "run … now");
  assert.equal(summarizeCommand("cmd SECRET_KEY=abc now"), "cmd … now");
});

test("tool paths are reported relative to the checkout", async () => {
  // An absolute path repeats the checkout on every line and crowds out the
  // part that identifies the file.
  const events: ModelProgressEvent[] = [];
  const runner: ProcessRunner = async (spec) => {
    const outputIndex = spec.args.indexOf("--output-file");
    const outputPath = outputIndex === -1 ? null : spec.args[outputIndex + 1];
    if (outputPath !== undefined && outputPath !== null) {
      await mkdir(path.dirname(outputPath), { recursive: true });
    }
    spec.onStdoutLine?.(
      JSON.stringify({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "read-1",
              name: "Read",
              input: {
                file_path: `${basePhaseRequest.repoRoot}/src/example.ts`
              }
            }
          ]
        }
      })
    );
    return successful("");
  };
  await createVendorAdapters(runner)
    .runPhase({
      ...basePhaseRequest,
      settings: { ...basePhaseRequest.settings, executable: "claude" },
      outputContract: claudePhaseOutputContract,
      onProgress: (event) => events.push(event)
    })
    .catch(() => undefined);
  assert.ok(
    events.some((event) => event.detail === "Read: src/example.ts"),
    JSON.stringify(events)
  );
});

test("the live turn line and the persisted total agree about token counts", async () => {
  // A per-turn line reading `24 in · 100% cached` beside a run total reading
  // `593.2K in` is the same bug reported twice: both must normalize the
  // vendors' incompatible cache reporting the same way.
  const progress: ModelProgressEvent[] = [];
  const claudeUsagePayload = {
    input_tokens: 24,
    cache_read_input_tokens: 512_000,
    cache_creation_input_tokens: 81_200,
    output_tokens: 7_900
  };
  const lines = [
    JSON.stringify({ type: "system", subtype: "init", session_id: "s" }),
    JSON.stringify({
      type: "result",
      subtype: "success",
      total_cost_usd: 0.6,
      num_turns: 3,
      usage: claudeUsagePayload
    })
  ];
  const runner: ProcessRunner = async (spec) => {
    for (const line of lines) {
      spec.onStdoutLine?.(line);
    }
    return successful(lines.join("\n"));
  };

  const usage = claudeUsage(lines.join("\n"));
  assert.ok(usage);
  const expectedInput = 24 + 512_000 + 81_200;
  assert.equal(usage.inputTokens, expectedInput);
  assert.equal(usage.cachedInputTokens, 512_000);

  await createVendorAdapters(runner)
    .runReview({
      ...baseReviewRequest,
      onProgress: (event) => progress.push(event)
    })
    .catch(() => undefined);
  const reported = progress.find((event) => event.kind === "usage");
  assert.ok(reported, JSON.stringify(progress));
  // The same three numbers, rendered from the same normalization, labeled as
  // a reading and carrying the result event's own turn count.
  assert.equal(
    reported.detail,
    `tokens: ${formatUsage(expectedInput, 512_000, 7_900, 3)}`
  );
  assert.equal(reported.detail.startsWith("tokens: 3 turns · 593.2K in"), true);
});

test("paths inside commands and file changes are relative to the checkout", () => {
  const repo = "/workspace/sandbox-project";
  // The checkout prefix repeated on every line crowds out the argument that
  // identifies which file the action touched.
  assert.equal(
    summarizeCommand(
      `zsh -lc "grep -n message ${repo}/application/lib/http.js"`,
      repo
    ),
    "grep -n message application/lib/http.js"
  );
  // `git -C <root>` names the root itself, with no trailing separator.
  assert.equal(
    summarizeCommand(`zsh -lc "git -C ${repo} status --porcelain"`, repo),
    "git -C . status --porcelain"
  );
  // A path outside the checkout keeps its absolute form.
  assert.equal(summarizeCommand("cat /etc/hosts", repo), "cat /etc/hosts");
  // Without a repository root the checkout prefix survives, and a path that is
  // also outside home is long enough for truncation to eat the filename —
  // which is the whole reason the rewrite exists.
  assert.equal(
    summarizeCommand("cat /opt/very/deeply/nested/vendor/tree/package.json"),
    "cat /opt/very/deeply/nested/vendor/tree/package.json"
  );
  assert.equal(
    summarizeCommand(
      "cat /opt/very/deeply/nested/vendor/tree/with/more/segments/package.json"
    ),
    "cat /opt/very/deeply/nested/vendor/tree/with/more/segme…"
  );
  assert.equal(
    summarizeCommand(`cat ${repo}/package.json`, repo),
    "cat package.json"
  );
});

const serenaServer = {
  command: "serena",
  args: ["start-mcp-server", "--context=codex-lean", "--project-from-cwd"],
  env: {},
  startupTimeoutSec: 15
};

const whitelistedScope = {
  strictMcpConfig: true,
  settingSources: null,
  pluginDirectory: null,
  mcp: { claude: serenaServer, codex: serenaServer, notes: [] }
};

test("a whitelisted serena reaches claude via --mcp-config beside strict mode", () => {
  const args = buildClaudeArguments({
    ...baseReviewRequest,
    environment: whitelistedScope
  });
  const strictAt = args.indexOf("--strict-mcp-config");
  const configAt = args.indexOf("--mcp-config");
  assert.ok(strictAt !== -1 && configAt === strictAt + 1);
  assert.equal(
    args[configAt + 1],
    '{"mcpServers":{"serena":{"type":"stdio","command":"serena","args":["start-mcp-server","--context=codex-lean","--project-from-cwd"],"env":{}}}}'
  );
  assert.equal(args[configAt + 1], claudeMcpConfig(serenaServer));
});

test("a whitelisted serena reaches codex on fresh and resumed sessions", () => {
  const override =
    'mcp_servers={serena={command="serena",args=["start-mcp-server","--context=codex-lean","--project-from-cwd"],startup_timeout_sec=15.0}}';
  const fresh = buildCodexArguments(
    {
      prompt: "p",
      repoRoot: "/repo",
      settings: baseReviewRequest.settings,
      resumeSessionId: null,
      environment: whitelistedScope
    },
    "/schema.json",
    "/out.json"
  );
  assert.ok(fresh.includes(override), fresh.join(" "));
  assert.equal(fresh[fresh.indexOf(override) - 1], "-c");

  const resumed = buildCodexArguments(
    {
      prompt: "p",
      repoRoot: "/repo",
      settings: baseReviewRequest.settings,
      resumeSessionId: "session-1",
      environment: whitelistedScope
    },
    "/schema.json",
    "/out.json"
  );
  // The whitelist must survive resume, or a resumed phase silently loses MCP.
  assert.ok(resumed.includes(override), resumed.join(" "));
});

test("a whitelisted serena is granted, or dontAsk denies every one of its tools", () => {
  // --permission-mode dontAsk implicitly allows only the built-ins named by
  // --tools. An MCP tool no --allowedTools entry names is refused on first
  // call, which turns the whole whitelist into schema tokens bought for
  // nothing. Verified against a live claude: without the grant the call comes
  // back "Permission to use mcp__serena__initial_instructions has been denied
  // because Claude Code is running in don't ask mode."
  for (const args of [
    buildClaudePhaseArguments({
      ...basePhaseRequest,
      outputContract: claudePhaseOutputContract,
      environment: whitelistedScope
    }),
    buildClaudeArguments({
      ...baseReviewRequest,
      environment: whitelistedScope
    }),
    buildClaudeSelectionArguments({
      ...baseSelectionRequest,
      outputContract: claudeSelectionOutputContract,
      environment: whitelistedScope
    })
  ]) {
    const grantAt = args.indexOf("--allowedTools");
    assert.ok(grantAt !== -1, args.join(" "));
    const granted = (args[grantAt + 1] ?? "").split(",");
    assert.ok(granted.includes("mcp__serena__initial_instructions"));
    assert.ok(granted.includes("mcp__serena__find_symbol"));
    assert.ok(granted.includes("mcp__serena__get_symbols_overview"));
  }
});

test("no role is granted a serena tool that writes", () => {
  // The spec-gate hook matches Edit|Write|MultiEdit|NotebookEdit|apply_patch
  // and never sees an MCP call, so a granted serena writer would edit the tree
  // with the approved-bundle enforcement blind to it. A writing phase already
  // holds Edit and Write; what it lacked was navigation.
  const mutating = [
    "replace_symbol_body",
    "replace_content",
    "replace_in_files",
    "insert_after_symbol",
    "insert_before_symbol",
    "rename_symbol",
    "safe_delete_symbol",
    "write_memory",
    "edit_memory",
    "delete_memory",
    "rename_memory",
    "onboarding"
  ];
  for (const args of [
    buildClaudePhaseArguments({
      ...basePhaseRequest,
      outputContract: claudePhaseOutputContract,
      environment: whitelistedScope
    }),
    buildClaudeArguments({
      ...baseReviewRequest,
      environment: whitelistedScope
    }),
    buildClaudeSelectionArguments({
      ...baseSelectionRequest,
      outputContract: claudeSelectionOutputContract,
      environment: whitelistedScope
    })
  ]) {
    const granted = args[args.indexOf("--allowedTools") + 1] ?? "";
    // Never the bare server: `mcp__serena` would grant every tool it carries,
    // writers included.
    assert.equal(granted.split(",").includes("mcp__serena"), false, granted);
    for (const tool of mutating) {
      assert.equal(granted.includes(tool), false, `${tool} leaked: ${granted}`);
    }
  }
});

test("an absent whitelist grants nothing", () => {
  // The grant is the whitelist's other half: no server, no --allowedTools.
  const args = buildClaudePhaseArguments({
    ...basePhaseRequest,
    outputContract: claudePhaseOutputContract,
    environment: {
      strictMcpConfig: true,
      settingSources: null,
      pluginDirectory: null,
      mcp: { claude: null, codex: null, notes: [] }
    }
  });
  assert.equal(args.includes("--allowedTools"), false);
});

test("an absent whitelist keeps both argument vectors byte-identical", () => {
  const scope = {
    strictMcpConfig: true,
    settingSources: null,
    pluginDirectory: null
  };
  const withMcp = buildClaudeArguments({
    ...baseReviewRequest,
    environment: { ...scope, mcp: { claude: null, codex: null, notes: [] } }
  });
  const without = buildClaudeArguments({
    ...baseReviewRequest,
    environment: scope
  });
  assert.deepEqual(withMcp, without);
  assert.equal(withMcp.includes("--mcp-config"), false);
});

test("codex overrides escape TOML strings and keep floats floats", () => {
  assert.equal(
    codexMcpServersOverride({
      command: 'path with "quote"',
      args: ["a\\b"],
      env: { SERENA_LOG: "on" },
      startupTimeoutSec: 7.5
    }),
    'mcp_servers={serena={command="path with \\"quote\\"",args=["a\\\\b"],env={SERENA_LOG="on"},startup_timeout_sec=7.5}}'
  );
  // An integer-valued timeout still serializes as a TOML float.
  assert.ok(
    codexMcpServersOverride(serenaServer).includes("startup_timeout_sec=15.0")
  );
});

test("a long command keeps its shell payload without an orphaned quote", () => {
  // The detail is capped at 240 characters before tokenizing, so a long
  // command arrives with its closing quote already cut off.
  const long = `zsh -lc "rtk find .ai-instructions/skills -path *db-migrations* ${"-o -path *x* ".repeat(20)}-print"`;
  assert.ok(long.length > 240);
  const rendered = summarizeCommand(long);
  assert.equal(rendered.startsWith('"'), false, rendered);
  assert.ok(rendered.startsWith("rtk find .ai-instructions/skills"), rendered);
});

test("paths outside the checkout are shortened to a home-relative form", () => {
  const home = homedir();
  const repo = "/somewhere/else/repo";
  assert.equal(
    summarizeCommand(`cat ${home}/.codex/memories/MEMORY.md`, repo),
    "cat ~/.codex/memories/MEMORY.md"
  );
  // The checkout still wins over the home abbreviation.
  assert.equal(
    summarizeCommand(`cat ${home}/proj/pkg.json`, `${home}/proj`),
    "cat pkg.json"
  );
  // A path under neither is left alone.
  assert.equal(summarizeCommand("cat /etc/hosts", repo), "cat /etc/hosts");
});

test("both vendor result decoders feed identical bytes to the shared review renderer", async () => {
  const { renderReviewArtifact } = await import("../src/review-artifact.js");
  const directory = await mkdtemp(path.join(tmpdir(), "banzai-vendor-render-"));
  try {
    const snapshot = reviewSnapshotFixture();
    const expected = currentReviewFixture(snapshot);
    const processRunner: ProcessRunner = async (spec) => {
      if (spec.command === "codex") {
        const output = spec.args[spec.args.indexOf("-o") + 1];
        assert.ok(output);
        await mkdir(path.dirname(output), { recursive: true });
        await writeFile(output, JSON.stringify(expected));
        return successful(
          JSON.stringify({ type: "thread.started", thread_id: "review" })
        );
      }
      return successful(
        JSON.stringify({
          type: "result",
          structured_output: expected,
          session_id: "review"
        })
      );
    };
    const bytes: string[] = [];
    for (const vendor of ["codex", "claude"] as const) {
      const artifact = { ...snapshot.artifact, snapshot };
      const result = await createVendorAdapters(processRunner).runReview({
        ...baseReviewRequest,
        artifact,
        runDirectory: directory,
        attemptId: vendor,
        settings: vendor === "codex" ? codexSettings : settings,
        outputContract: resolveOutputContract(vendor, "review-result/v2")
      });
      assert.deepEqual(result.result, expected);
      bytes.push(renderReviewArtifact(result.result, artifact));
    }
    assert.equal(bytes[0], bytes[1]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

function malformedLedgerStop() {
  return {
    ...terminalPhaseResult(),
    phase: "implementation" as const,
    outcome: "blocked" as const,
    gate: null,
    summary: "Blocked on a credential.",
    questions: ["Which credential should the fixture use?"],
    artifacts: {
      description: null,
      plan: null,
      adrs: [],
      implementationReport: null,
      testReport: null
    },
    taskCompletion: { schemaVersion: 1, tasks: "not-an-array" }
  };
}

test("Claude decodes a protocol attempt through the safe envelope instead of discarding a malformed ledger", async () => {
  const stop = malformedLedgerStop();
  const line = JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: false,
    structured_output: stop,
    session_id: "claude-session",
    usage: { input_tokens: 10, output_tokens: 2 }
  });
  const runner: ProcessRunner = async () => successful(line);
  const protocol = await createVendorAdapters(runner).runPhase({
    ...basePhaseRequest,
    attemptId: "implementation-1-abcd1234",
    settings,
    outputContract: claudePhaseOutputContract,
    completionProtocol: "banzai-completion-protocol/v1"
  });
  assert.ok(isPhaseResultEnvelope(protocol.result));
  assert.equal(protocol.result.outcome, "blocked");
  assert.equal(protocol.result.taskCompletion.state, "unaccepted");
  assert.equal(protocol.sessionId, "claude-session");
  // The same bytes without the persisted marker keep the legacy decoder.
  await assert.rejects(
    createVendorAdapters(runner).runPhase({
      ...basePhaseRequest,
      attemptId: "implementation-1-abcd1234",
      settings,
      outputContract: claudePhaseOutputContract
    })
  );
});

test("Codex decodes a protocol attempt through the safe envelope instead of discarding a malformed ledger", async () => {
  const runDirectory = await mkdtemp(
    path.join(tmpdir(), "banzai-protocol-adapter-")
  );
  const stop = malformedLedgerStop();
  const runner: ProcessRunner = async (spec) => {
    const outputIndex = spec.args.indexOf("-o");
    const outputPath = spec.args[outputIndex + 1];
    assert.ok(outputPath);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, JSON.stringify(stop), "utf8");
    return successful(
      [
        JSON.stringify({ type: "thread.started", thread_id: "thread-id" }),
        JSON.stringify({
          type: "turn.completed",
          usage: { input_tokens: 12, cached_input_tokens: 0, output_tokens: 3 }
        })
      ].join("\n")
    );
  };
  try {
    const protocol = await createVendorAdapters(runner).runPhase({
      ...basePhaseRequest,
      attemptId: "implementation-1-abcd1234",
      runDirectory,
      completionProtocol: "banzai-completion-protocol/v1"
    });
    assert.ok(isPhaseResultEnvelope(protocol.result));
    assert.equal(protocol.result.outcome, "blocked");
    assert.equal(protocol.result.taskCompletion.state, "unaccepted");
    assert.equal(protocol.sessionId, "thread-id");
    await assert.rejects(
      createVendorAdapters(runner).runPhase({
        ...basePhaseRequest,
        attemptId: "implementation-1-abcd1234",
        runDirectory
      })
    );
  } finally {
    await rm(runDirectory, { recursive: true, force: true });
  }
});
