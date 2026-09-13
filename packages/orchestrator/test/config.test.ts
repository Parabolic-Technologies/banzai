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
  loadConfig
} from "../src/config.js";
import { parseConfig } from "../src/validation.js";

function irregularConfig(schemaVersion: 3): string {
  const verification =
    '{ "profiles" : [ { "id":"node", "projectType":"node", "commands":[ { "id":"node-verify", "name":"verify", "command":"node", "args":["--check"], "timeoutMs":1000 } ] } ] }';
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
    assert.equal(config.schemaVersion, 3);
    assert.equal(config.verification.policy, undefined);
    assert.deepEqual(config.context, { mode: "observe", limits: [] });
    assert.deepEqual(config.verification.profiles, [
      {
        id: "repository",
        projectType: "repository",
        commands: [
          {
            id: "git-diff-check",
            evidence: "fresh",
            ignoreExplanatory: false,
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

test("removed config versions reject reads and updates without changing bytes", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "banzai-config-window-"));
  try {
    await mkdir(path.join(root, ".banzai"));
    const configPath = path.join(root, CONFIG_FILE);
    for (const schemaVersion of [1, 2, 4]) {
      const original =
        JSON.stringify({ ...DEFAULT_CONFIG, schemaVersion }, null, 2) + "\n";
      await writeFile(configPath, original);
      for (const action of [
        () => loadConfig(root),
        () => applyModelUpdates(root, [{ role: "planner", model: "changed" }])
      ]) {
        await assert.rejects(action, {
          code: "RESOURCE_VERSION_UNSUPPORTED",
          message:
            /^.+ version .+ is not supported; 3\.x supports .+; last read by release-train major 2$/u
        });
        assert.equal(await readFile(configPath, "utf8"), original);
      }
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("model updates preserve every unrelated config byte in schema version three", async () => {
  for (const schemaVersion of [3] as const) {
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

test("validates version three profile identity type commands and uniqueness", () => {
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
        id: "node-verify",
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
