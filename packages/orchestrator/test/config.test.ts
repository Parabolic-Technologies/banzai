import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  applyModelUpdates,
  CONFIG_FILE,
  DEFAULT_CONFIG,
  initializeConfig,
  loadConfig,
  editVerificationConfigBytes
} from "../src/config.js";
import { parseConfig } from "../src/validation.js";
import { requiredFixture } from "./helpers.js";

test("guided config edits preserve unselected bytes and reject ambiguous or destructive targets", () => {
  const original = irregularConfig(2);
  const bootstrap = editVerificationConfigBytes(original, {
    operation: "bootstrap",
    value: true
  });
  assert.equal(
    editVerificationConfigBytes(bootstrap, {
      operation: "bootstrap",
      value: undefined
    }),
    original
  );
  const addedProfile = {
    id: "go",
    projectType: "go" as const,
    commands: [
      { name: "tests", command: "go", args: ["test", "./..."], timeoutMs: 1000 }
    ]
  };
  const added = editVerificationConfigBytes(bootstrap, {
    operation: "add",
    profile: addedProfile,
    clearBootstrap: true
  });
  assert.equal(
    parseConfig(JSON.parse(added) as unknown).verification.profiles.length,
    2
  );
  assert.equal(
    parseConfig(JSON.parse(added) as unknown).verification.bootstrap,
    undefined
  );
  const node = requiredFixture(
    parseConfig(JSON.parse(original) as unknown).verification.profiles[0]
  );
  const unknown = original.replace(
    '"commands":[ {',
    '"untouched" : { "x":1 }, "commands":[ { "retained" : [ 1,2 ],'
  );
  const edited = editVerificationConfigBytes(unknown, {
    operation: "edit",
    profile: {
      ...node,
      commands: node.commands.map((command) => ({
        ...command,
        timeoutMs: 2000
      }))
    },
    clearBootstrap: false
  });
  assert.equal(
    edited,
    unknown.replace('"timeoutMs":1000 } ]', '"timeoutMs":2000 } ]')
  );
  assert.equal(
    editVerificationConfigBytes(original, {
      operation: "edit",
      profile: node,
      clearBootstrap: false
    }),
    original
  );
  assert.throws(
    () =>
      editVerificationConfigBytes(original, {
        operation: "remove",
        profileId: "node",
        clearBootstrap: false
      }),
    { code: "VERIFICATION_PROFILE_REQUIRED" }
  );
  assert.throws(
    () =>
      editVerificationConfigBytes(original, {
        operation: "add",
        profile: node,
        clearBootstrap: false
      }),
    { code: "VERIFICATION_PROFILE_CONFLICT" }
  );
  assert.throws(
    () =>
      editVerificationConfigBytes(irregularConfig(1), {
        operation: "bootstrap",
        value: true
      }),
    { code: "VERIFICATION_LEGACY_CONFIG" }
  );
  for (const text of [original, added, edited]) {
    assert.ok(
      text.includes(
        '"retainedUnknown" : { "spacing" : [ 1,2,3 ], "escaped" : "keep\\u0020exact" }'
      )
    );
    assert.ok(
      text.includes(
        '"planner": { "executable":"planner-old-executable", "model" : "planner-old-model", "effort":"xhigh", "timeoutMs":1000 }'
      )
    );
  }
  const removed = editVerificationConfigBytes(added, {
    operation: "remove",
    profileId: "go",
    clearBootstrap: false
  });
  assert.equal(
    parseConfig(JSON.parse(removed) as unknown).verification.profiles.length,
    1
  );
});

function irregularConfig(schemaVersion: 1 | 2): string {
  const verification =
    schemaVersion === 1
      ? '[ { "name":"verify", "command":"git", "args":["diff","--check"], "timeoutMs":1000 } ]'
      : '{ "profiles" : [ { "id":"node", "projectType":"node", "commands":[ { "name":"verify", "command":"node", "args":["--check"], "timeoutMs":1000 } ] } ] }';
  return [
    "{",
    `\t"schemaVersion" : ${schemaVersion},`,
    '\t"contractVersion":"1.0.0",',
    '\t"models" : {',
    '\t\t"planner": { "executable":"planner-old-executable", "model" : "planner-old-model", "effort":"xhigh", "timeoutMs":1000 },',
    '\t\t"implementer" : {"executable":"implementer-old-executable","model":"implementer-old-model","effort":"high","timeoutMs":1000},',
    '\t\t"reviewer":{"executable":"reviewer-old-executable","model":"reviewer-old-model","effort":"max","timeoutMs":1000}',
    "\t},",
    `\t"verification" : ${verification},`,
    '\t"context" : { "mode":"observe", "limits" : [ { "metric":"runner_payload_bytes", "maximum" : 12345 } ] },',
    '\t"maxFixCycles":3,',
    '\t"retainedUnknown" : { "spacing" : [ 1,2,3 ], "escaped" : "keep\\u0020exact" }',
    "}",
    ""
  ].join("\r\n");
}

test("init is idempotent and preserves tracked config", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "banzai-init-test-"));
  try {
    await writeFile(path.join(root, ".gitignore"), "coverage/\n", "utf8");
    const first = await initializeConfig(root);
    assert.deepEqual(first, { configCreated: true, gitignoreUpdated: true });
    const originalConfig = await readFile(path.join(root, CONFIG_FILE), "utf8");

    const second = await initializeConfig(root);
    assert.deepEqual(second, {
      configCreated: false,
      gitignoreUpdated: false
    });
    assert.equal(
      await readFile(path.join(root, CONFIG_FILE), "utf8"),
      originalConfig
    );
    const ignore = await readFile(path.join(root, ".gitignore"), "utf8");
    assert.match(ignore, /^coverage\/\n/);
    assert.match(ignore, /\.banzai\/runs\//);
    const config = await loadConfig(root);
    assert.equal(config.schemaVersion, 2);
    assert.deepEqual(config.context, { mode: "observe", limits: [] });
    assert.deepEqual(config.verification.profiles, [
      {
        id: "repository",
        projectType: "repository",
        commands: [
          {
            name: "git diff check",
            command: "git",
            args: ["diff", "--check"],
            timeoutMs: 120_000
          }
        ]
      }
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("context policy is optional strict and selector-aware", () => {
  const absent = structuredClone(DEFAULT_CONFIG) as unknown as Record<
    string,
    unknown
  >;
  delete absent.context;
  assert.deepEqual(parseConfig(absent).context, {
    mode: "observe",
    limits: []
  });

  const configured = structuredClone(DEFAULT_CONFIG) as unknown as Record<
    string,
    unknown
  >;
  configured.context = {
    mode: "enforce",
    limits: [
      { metric: "runner_payload_bytes", maximum: 100 },
      {
        metric: "vendor_cost_usd",
        phase: "review",
        role: "reviewer",
        maximum: 0.25
      }
    ]
  };
  assert.deepEqual(parseConfig(configured).context, {
    mode: "enforce",
    limits: [
      {
        metric: "runner_payload_bytes",
        phase: null,
        role: null,
        maximum: 100
      },
      {
        metric: "vendor_cost_usd",
        phase: "review",
        role: "reviewer",
        maximum: 0.25
      }
    ]
  });

  for (const context of [
    { mode: "guess", limits: [] },
    {
      mode: "observe",
      limits: [{ metric: "runner_payload_bytes", maximum: 0 }]
    },
    {
      mode: "observe",
      limits: [{ metric: "runner_payload_bytes", maximum: 1.5 }]
    },
    {
      mode: "observe",
      limits: [
        { metric: "runner_payload_bytes", phase: "review", maximum: 10 },
        { metric: "runner_payload_bytes", phase: "review", maximum: 9 }
      ]
    },
    {
      mode: "observe",
      limits: [{ metric: "unsupported", maximum: 1 }]
    },
    {
      mode: "observe",
      limits: [
        { metric: "runner_payload_bytes", phase: "unsupported", maximum: 1 }
      ]
    },
    {
      mode: "observe",
      limits: [
        { metric: "runner_payload_bytes", role: "unsupported", maximum: 1 }
      ]
    },
    {
      mode: "observe",
      limits: [{ metric: "runner_payload_bytes", maximum: Number.NaN }]
    },
    {
      mode: "observe",
      limits: [{ metric: "vendor_cost_usd", maximum: Number.POSITIVE_INFINITY }]
    }
  ]) {
    const invalid = structuredClone(DEFAULT_CONFIG) as unknown as Record<
      string,
      unknown
    >;
    invalid.context = context;
    assert.throws(() => parseConfig(invalid), /context/);
  }
});

test("loads schema version one through a stable compatibility profile", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "banzai-config-test-"));
  const legacy = {
    ...structuredClone(DEFAULT_CONFIG),
    schemaVersion: 1,
    verification: [
      {
        name: "legacy first",
        command: "legacy-tool",
        args: ["same", "same"],
        timeoutMs: 1_000
      },
      {
        name: "legacy second",
        command: "legacy-tool",
        args: ["second"],
        timeoutMs: 2_000
      }
    ],
    retainedUnknown: { keep: true }
  };
  try {
    await mkdir(path.join(root, ".banzai"), { recursive: true });
    const configPath = path.join(root, CONFIG_FILE);
    await writeFile(configPath, `${JSON.stringify(legacy, null, 2)}\n`, "utf8");

    const loaded = await loadConfig(root);
    assert.equal(loaded.schemaVersion, 1);
    const legacyProfile = loaded.verification.profiles[0];
    assert.ok(legacyProfile);
    assert.equal(legacyProfile.id, "legacy");
    assert.deepEqual(
      legacyProfile.commands.map((command) => command.name),
      ["legacy first", "legacy second"]
    );
    assert.deepEqual(legacyProfile.commands[0]?.args, ["same", "same"]);

    await applyModelUpdates(root, [
      { role: "planner", model: "updated-model" }
    ]);
    const source = JSON.parse(await readFile(configPath, "utf8")) as {
      schemaVersion: number;
      verification: unknown;
      retainedUnknown: unknown;
      models: { planner: { model: string } };
    };
    assert.equal(source.schemaVersion, 1);
    assert.deepEqual(source.verification, legacy.verification);
    assert.deepEqual(source.retainedUnknown, { keep: true });
    assert.equal(source.models.planner.model, "updated-model");

    const beforeInit = await readFile(configPath, "utf8");
    await initializeConfig(root);
    assert.equal(await readFile(configPath, "utf8"), beforeInit);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("model updates preserve every unrelated config byte in both schema versions", async () => {
  for (const schemaVersion of [1, 2] as const) {
    const root = await mkdtemp(
      path.join(tmpdir(), `banzai-lossless-config-v${schemaVersion}-`)
    );
    try {
      await mkdir(path.join(root, ".banzai"), { recursive: true });
      const configPath = path.join(root, CONFIG_FILE);
      const original = irregularConfig(schemaVersion);
      await writeFile(configPath, original, "utf8");

      await applyModelUpdates(root, [
        { role: "planner", model: 'planner-"new"-model' },
        {
          role: "implementer",
          model: "implementer-new-model",
          executable: "implementer new executable"
        },
        {
          role: "reviewer",
          model: "reviewer-new-model",
          effort: "low"
        }
      ]);

      const expected = original
        .replace('"planner-old-model"', JSON.stringify('planner-"new"-model'))
        .replace('"implementer-old-model"', '"implementer-new-model"')
        .replace('"implementer-old-executable"', '"implementer new executable"')
        .replace('"reviewer-old-model"', '"reviewer-new-model"')
        .replace('"max"', '"low"');
      const updated = await readFile(configPath, "utf8");
      assert.equal(updated, expected);
      assert.equal(
        parseConfig(JSON.parse(updated) as unknown).schemaVersion,
        schemaVersion
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test("validates version two profile identity type commands and uniqueness", () => {
  function firstProfile(
    value: Record<string, unknown>
  ): Record<string, unknown> {
    const profiles = (
      value.verification as {
        profiles: Record<string, unknown>[];
      }
    ).profiles;
    const first = profiles[0];
    assert.ok(first);
    return first;
  }

  function firstCommand(
    value: Record<string, unknown>
  ): Record<string, unknown> {
    const commands = firstProfile(value).commands as Record<string, unknown>[];
    const first = commands[0];
    assert.ok(first);
    return first;
  }

  const valid = structuredClone(DEFAULT_CONFIG) as unknown as Record<
    string,
    unknown
  >;
  const verification = valid.verification as {
    profiles: Record<string, unknown>[];
  };
  verification.profiles.push({
    id: "node",
    projectType: "node",
    commands: [
      {
        name: "node verify",
        command: "npm",
        args: ["run", "verify"],
        timeoutMs: 5_000
      }
    ]
  });
  assert.equal(parseConfig(valid).verification.profiles.length, 2);

  const invalidCases: { mutate(value: Record<string, unknown>): void }[] = [
    {
      mutate(value) {
        (value.verification as { profiles: unknown[] }).profiles = [];
      }
    },
    {
      mutate(value) {
        firstProfile(value).id = "Not Kebab";
      }
    },
    {
      mutate(value) {
        firstProfile(value).projectType = "unknown";
      }
    },
    {
      mutate(value) {
        firstProfile(value).commands = [];
      }
    },
    {
      mutate(value) {
        const profiles = (
          value.verification as { profiles: Record<string, unknown>[] }
        ).profiles;
        profiles.push(structuredClone(firstProfile(value)));
      }
    },
    {
      mutate(value) {
        firstCommand(value).timeoutMs = 0;
      }
    },
    {
      mutate(value) {
        firstCommand(value).args = "--check";
      }
    }
  ];

  for (const item of invalidCases) {
    const candidate = structuredClone(valid);
    item.mutate(candidate);
    assert.throws(() => parseConfig(candidate));
  }
  assert.throws(() => parseConfig({ ...valid, schemaVersion: 99 }));
  assert.throws(() => parseConfig({ ...valid, contractVersion: "2.0.0" }));
});

test("lossless profile editing keeps command unknown fields with explicit origins through reorder and ID replacement", () => {
  const base = structuredClone(DEFAULT_CONFIG);
  const first = {
    name: "first",
    command: "node",
    args: ["a"],
    timeoutMs: 1000,
    futureOption: "first-only"
  };
  const second = {
    name: "second",
    command: "node",
    args: ["b"],
    timeoutMs: 1000,
    futureOption: "second-only"
  };
  const document = {
    ...base,
    untouched: { formatting: "kept" },
    verification: {
      profiles: [
        {
          id: "custom",
          projectType: "custom",
          commands: [first, second],
          futureProfile: 42
        }
      ]
    }
  };
  const raw = JSON.stringify(document, null, 3) + "\n";
  const updated = editVerificationConfigBytes(raw, {
    operation: "edit",
    profile: {
      id: "custom",
      projectType: "custom",
      commands: [
        {
          name: "second edited",
          command: "node",
          args: ["new-b"],
          timeoutMs: 1000
        },
        { name: "first", command: "node", args: ["a"], timeoutMs: 1000 }
      ]
    },
    commandOrigins: [1, 0],
    clearBootstrap: false
  });
  const parsed = JSON.parse(updated) as typeof document;
  assert.deepEqual(
    parsed.verification.profiles[0]?.commands.map(
      (command) => command.futureOption
    ),
    ["second-only", "first-only"]
  );
  assert.equal(parsed.verification.profiles[0].futureProfile, 42);
  assert.ok(
    updated.includes('"untouched": {\n      "formatting": "kept"\n   }')
  );
});

test("guided structural profile edits retain irregular unselected separators", () => {
  const profile = (id: "node" | "go" | "python") => ({
    id,
    projectType: id,
    commands: [{ name: id, command: id, args: ["test"], timeoutMs: 1000 }]
  });
  const profiles = [
    DEFAULT_CONFIG.verification.profiles[0],
    profile("node"),
    profile("go")
  ].map((value) => JSON.stringify(value));
  const [repository, node, go] = profiles;
  const normal = JSON.stringify(DEFAULT_CONFIG);
  const raw = normal.replace(
    JSON.stringify(DEFAULT_CONFIG.verification.profiles),
    `[\n${repository}, ${node},\n\n\t${go}\n]`
  );
  const python = profile("python");
  const added = editVerificationConfigBytes(raw, {
    operation: "add",
    profile: python,
    clearBootstrap: false
  });
  assert.equal(
    added,
    raw.replace(`${go}\n]`, `${go}, ${JSON.stringify(python)}\n]`)
  );
  for (const [id, expected] of [
    ["repository", raw.replace(`${repository}, `, "")],
    ["node", raw.replace(`${node},\n\n\t`, "")],
    ["go", raw.replace(`,\n\n\t${go}`, "")]
  ]) {
    const actual = editVerificationConfigBytes(raw, {
      operation: "remove",
      profileId: requiredFixture(id),
      clearBootstrap: false
    });
    assert.equal(actual, expected);
    assert.equal(
      parseConfig(JSON.parse(actual) as unknown).verification.profiles.length,
      2
    );
  }
});
