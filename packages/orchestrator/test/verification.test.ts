import { requiredFixture } from "./helpers.js";
import { execFileSync } from "node:child_process";
import { chmod, readFile, realpath, rename } from "node:fs/promises";
import {
  captureVerificationInputs,
  decideVerification,
  evidenceDigest,
  parseVerificationConfiguration,
  parseVerificationDecision,
  parseVerificationObligations,
  verificationIdentities
} from "../src/verification-evidence.js";
import type {
  EvidenceConfiguration,
  VerificationOrigin
} from "../src/verification-evidence.js";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { DEFAULT_CONFIG } from "../src/config.js";
import { parseConfig } from "../src/validation.js";
import {
  assessVerificationProfiles,
  describeVerificationCommands,
  detectProjectTypes,
  flattenVerificationCommands,
  isRepositoryHygieneCommand
} from "../src/verification.js";
import type {
  OrchestratorConfig,
  VerificationProfile,
  VerificationProjectType
} from "../src/types.js";

async function temporaryRoot(): Promise<{
  root: string;
  dispose(): Promise<void>;
}> {
  const root = await mkdtemp(path.join(tmpdir(), "banzai-verification-test-"));
  return {
    root,
    dispose: async () => {
      await rm(root, { recursive: true, force: true });
    }
  };
}

function profile(
  id: string,
  projectType: VerificationProjectType,
  command = "project-check"
): VerificationProfile {
  return {
    id,
    projectType,
    commands: [
      {
        name: `${id} check`,
        command,
        args: ["verify"],
        timeoutMs: 1_000
      }
    ]
  };
}

function configWithProfiles(
  profiles: VerificationProfile[]
): OrchestratorConfig {
  const config = structuredClone(DEFAULT_CONFIG);
  config.verification.profiles = profiles;
  return config;
}

test("detects each supported root project marker", async () => {
  const cases: { file: string; projectType: VerificationProjectType }[] = [
    { file: "package.json", projectType: "node" },
    { file: "composer.json", projectType: "php" },
    { file: "pyproject.toml", projectType: "python" },
    { file: "setup.py", projectType: "python" },
    { file: "requirements.txt", projectType: "python" },
    { file: "go.mod", projectType: "go" },
    { file: "Cargo.toml", projectType: "rust" },
    { file: "Gemfile", projectType: "ruby" },
    { file: "pom.xml", projectType: "jvm" },
    { file: "build.gradle", projectType: "jvm" },
    { file: "build.gradle.kts", projectType: "jvm" },
    { file: "example.sln", projectType: "dotnet" },
    { file: "example.csproj", projectType: "dotnet" },
    { file: "example.fsproj", projectType: "dotnet" }
  ];

  for (const item of cases) {
    const repository = await temporaryRoot();
    try {
      await writeFile(
        path.join(repository.root, item.file),
        "fixture\n",
        "utf8"
      );
      assert.deepEqual(await detectProjectTypes(repository.root), [
        item.projectType
      ]);
    } finally {
      await repository.dispose();
    }
  }
});

test("sorts polyglot types and ignores nested-only markers", async () => {
  const repository = await temporaryRoot();
  try {
    await writeFile(path.join(repository.root, "package.json"), "{}\n", "utf8");
    await writeFile(
      path.join(repository.root, "composer.json"),
      "{}\n",
      "utf8"
    );
    await writeFile(
      path.join(repository.root, "go.mod"),
      "module example\n",
      "utf8"
    );
    assert.deepEqual(await detectProjectTypes(repository.root), [
      "go",
      "node",
      "php"
    ]);

    await rm(path.join(repository.root, "package.json"));
    await rm(path.join(repository.root, "composer.json"));
    await rm(path.join(repository.root, "go.mod"));
    await mkdir(path.join(repository.root, "nested"));
    await writeFile(
      path.join(repository.root, "nested", "package.json"),
      "{}\n",
      "utf8"
    );
    await mkdir(path.join(repository.root, "package.json"));
    assert.deepEqual(await detectProjectTypes(repository.root), ["custom"]);
  } finally {
    await repository.dispose();
  }
});

test("rejects unreadable root enumeration and marker metadata", async () => {
  function hasCode(expected: string): (error: unknown) => boolean {
    return (error) => (error as NodeJS.ErrnoException).code === expected;
  }

  const repository = await temporaryRoot();
  try {
    const permissionError = Object.assign(
      new Error("fixture root enumeration failure"),
      { code: "EACCES" }
    );
    await assert.rejects(
      () =>
        detectProjectTypes(repository.root, async () => {
          throw permissionError;
        }),
      hasCode("EACCES")
    );

    await symlink("package.json", path.join(repository.root, "package.json"));
    await assert.rejects(
      () => detectProjectTypes(repository.root),
      hasCode("ELOOP")
    );
  } finally {
    await repository.dispose();
  }
});

test("assesses explicit project coverage without counting repository hygiene", () => {
  const repositoryProfile = DEFAULT_CONFIG.verification.profiles[0];
  assert.ok(repositoryProfile);
  const hygieneCommand = repositoryProfile.commands[0];
  assert.ok(hygieneCommand);
  const config = configWithProfiles([
    {
      id: "repository",
      projectType: "repository",
      commands: [structuredClone(hygieneCommand)]
    },
    profile("node", "node"),
    profile("unused-rust", "rust")
  ]);

  assert.deepEqual(assessVerificationProfiles(config, ["node", "php"]), {
    explicit: true,
    profileCount: 3,
    substantiveCommandCount: 1,
    totalSubstantiveCommandCount: 2,
    missingProjectTypes: ["php"],
    hygieneOnlyProjectTypes: [],
    extraProfileIds: ["unused-rust"]
  });
  assert.equal(isRepositoryHygieneCommand(hygieneCommand), true);
  assert.equal(
    isRepositoryHygieneCommand({
      name: "near miss",
      command: "git",
      args: ["diff", "--check", "src"],
      timeoutMs: 1_000
    }),
    false
  );
});

test("requires a substantive custom profile for an unrecognized project", () => {
  const repositoryProfile = DEFAULT_CONFIG.verification.profiles[0];
  assert.ok(repositoryProfile);
  const hygieneOnly = configWithProfiles([structuredClone(repositoryProfile)]);
  assert.deepEqual(assessVerificationProfiles(hygieneOnly, ["custom"]), {
    explicit: true,
    profileCount: 1,
    substantiveCommandCount: 0,
    totalSubstantiveCommandCount: 0,
    missingProjectTypes: ["custom"],
    hygieneOnlyProjectTypes: [],
    extraProfileIds: []
  });

  const matchingHygieneOnly = structuredClone(repositoryProfile);
  matchingHygieneOnly.id = "custom";
  matchingHygieneOnly.projectType = "custom";
  assert.deepEqual(
    assessVerificationProfiles(configWithProfiles([matchingHygieneOnly]), [
      "custom"
    ]),
    {
      explicit: true,
      profileCount: 1,
      substantiveCommandCount: 0,
      totalSubstantiveCommandCount: 0,
      missingProjectTypes: [],
      hygieneOnlyProjectTypes: ["custom"],
      extraProfileIds: []
    }
  );

  const custom = configWithProfiles([profile("custom", "custom")]);
  assert.deepEqual(assessVerificationProfiles(custom, ["custom"]), {
    explicit: true,
    profileCount: 1,
    substantiveCommandCount: 1,
    totalSubstantiveCommandCount: 1,
    missingProjectTypes: [],
    hygieneOnlyProjectTypes: [],
    extraProfileIds: []
  });
});

test("legacy commands flatten in source order but never prove readiness", () => {
  const legacy = parseConfig({
    ...structuredClone(DEFAULT_CONFIG),
    schemaVersion: 1,
    verification: [
      {
        name: "first",
        command: "tool",
        args: ["same", "same"],
        timeoutMs: 1_000
      },
      {
        name: "second",
        command: "tool",
        args: ["second"],
        timeoutMs: 1_000
      }
    ]
  });

  assert.deepEqual(
    flattenVerificationCommands(legacy).map((command) => command.name),
    ["first", "second"]
  );
  assert.deepEqual(flattenVerificationCommands(legacy)[0]?.args, [
    "same",
    "same"
  ]);
  assert.deepEqual(assessVerificationProfiles(legacy, ["node"]), {
    explicit: false,
    profileCount: 1,
    substantiveCommandCount: 0,
    totalSubstantiveCommandCount: 0,
    missingProjectTypes: ["node"],
    hygieneOnlyProjectTypes: [],
    extraProfileIds: []
  });
});

test("flattens commands in profile-major and command-minor order", () => {
  const first = profile("node", "node");
  first.commands.push({
    name: "node second",
    command: "node-second",
    args: [],
    timeoutMs: 1_000
  });
  const config = configWithProfiles([first, profile("php", "php")]);
  assert.deepEqual(
    flattenVerificationCommands(config).map((command) => command.command),
    ["project-check", "node-second", "project-check"]
  );
});

test("describes verification identity and configuration digest deterministically in declared order", () => {
  const first = profile("node", "node");
  first.commands.push({
    name: "node second",
    command: "node-second",
    args: ["--safe"],
    timeoutMs: 2_000
  });
  const config = configWithProfiles([first, profile("php", "php")]);
  const firstRead = describeVerificationCommands(config);
  const secondRead = describeVerificationCommands(structuredClone(config));
  assert.deepEqual(secondRead, firstRead);
  assert.deepEqual(
    firstRead.map((item) => [
      item.profileId,
      item.projectType,
      item.profileOrdinal,
      item.commandOrdinal
    ]),
    [
      ["node", "node", 1, 1],
      ["node", "node", 1, 2],
      ["php", "php", 2, 1]
    ]
  );
  assert.match(firstRead[0]?.configurationDigest ?? "", /^[a-f0-9]{64}$/);
  const changed = structuredClone(config);
  const changedCommand = changed.verification.profiles[0]?.commands[0];
  assert.ok(changedCommand);
  changedCommand.args.push("--changed");
  assert.notEqual(
    describeVerificationCommands(changed)[0]?.configurationDigest,
    firstRead[0]?.configurationDigest
  );
});

test("equivalent evidence retains protected changes and only removes proven explanatory invocations", async () => {
  const repository = await temporaryRoot();
  const workId = "11111111-1111-4111-8111-111111111111";
  const executable = await realpath(process.execPath);
  const config = parseVerificationConfiguration({
    profiles: [
      {
        id: "project",
        projectType: "custom",
        commands: [
          {
            id: "unit",
            name: "unit",
            command: executable,
            args: ["--version"],
            timeoutMs: 1000,
            evidence: "equivalent_evidence",
            ignoreExplanatory: true
          }
        ]
      }
    ],
    policy: {
      schema: "banzai-verification-policy/v1",
      schemaVersion: 1,
      explanatory: [
        {
          path: "notes.md",
          regions: [
            {
              start: "<!-- explanation start -->",
              end: "<!-- explanation end -->"
            }
          ]
        }
      ],
      dependencies: {
        complete: true,
        exclude: [],
        toolchain: [executable],
        environment: { LANG: "C" },
        volatile: []
      }
    }
  });
  const notes =
    "# Notes\n<!-- explanation start -->\nFirst sentence. Second sentence.\n<!-- explanation end -->\nProtected contract.\n";
  const capture = (configuration: EvidenceConfiguration = config) =>
    captureVerificationInputs({
      repoRoot: repository.root,
      configuration,
      workId
    });
  try {
    execFileSync("git", ["init", "--quiet", repository.root]);
    await writeFile(path.join(repository.root, "notes.md"), notes);
    await writeFile(
      path.join(repository.root, "source.ts"),
      "export const value = 1;\n"
    );
    await writeFile(path.join(repository.root, ".gitignore"), "installed/\n");
    await mkdir(path.join(repository.root, "installed"));
    await writeFile(
      path.join(repository.root, "installed/module.js"),
      "export default 1;\n"
    );
    execFileSync("git", ["-C", repository.root, "add", "."]);
    const before = await capture();
    assert.equal(before.complete, true);
    const authorityDigest = evidenceDigest("approved fixture authority");
    // This unit fixture injects an origin; it does not claim physical execution.
    const origin: VerificationOrigin = {
      workId,
      checkId: "unit",
      attemptId: "physical-1",
      roundId: "round-1",
      recordDigest: evidenceDigest("physical record"),
      status: "completed",
      exitCode: 0,
      signal: null,
      failureCategory: null,
      complete: true,
      logsIntact: true,
      identity: requiredFixture(
        verificationIdentities(config, authorityDigest)[0]
      ),
      before,
      after: before
    };
    const decide = async (
      configuration = config,
      origins = [origin],
      strict = false
    ) => {
      const current = await capture(configuration);
      return parseVerificationDecision(
        decideVerification({
          workId,
          roundId: "round-2",
          configuration,
          authorityDigest,
          strict,
          obligations: null,
          capture: current,
          origins
        })
      );
    };
    await writeFile(
      path.join(repository.root, "notes.md"),
      notes.replace(
        "First sentence. Second sentence.",
        "Two revised sentences. Still explanatory."
      )
    );
    assert.equal((await decide()).actions[0]?.action, "reuse");
    assert.deepEqual(await decide(), await decide());
    execFileSync("git", ["-C", repository.root, "add", "notes.md"]);
    assert.equal((await decide()).actions[0]?.action, "reuse");
    assert.equal(
      (await decide(config, [origin], true)).actions[0]?.reason,
      "obligations_unavailable"
    );
    for (const mutation of [
      { file: "source.ts", bytes: "export const value = 2;\n" },
      { file: "unit.test.ts", bytes: "export const newTest = true;\n" },
      { file: "installed/module.js", bytes: "export default 2;\n" },
      {
        file: "notes.md",
        bytes: notes.replace("Protected contract.", "Changed contract.")
      },
      {
        file: "notes.md",
        bytes: notes.replace("<!-- explanation end -->", "<!-- moved end -->")
      },
      {
        file: "notes.md",
        bytes: notes.replace("First sentence.", "```sh\necho executable\n```\n")
      },
      { file: "generated.js", bytes: "export default 3;\n" },
      { file: "package-lock.json", bytes: "{}\n" }
    ]) {
      const target = path.join(repository.root, mutation.file);
      const old = await readFile(target).catch(() => null);
      await writeFile(target, mutation.bytes);
      assert.equal(
        (await decide()).actions[0]?.action,
        "execute",
        mutation.file
      );
      if (old === null) await rm(target);
      else await writeFile(target, old);
    }
    await chmod(path.join(repository.root, "source.ts"), 0o755);
    assert.equal((await decide()).actions[0]?.action, "execute");
    await chmod(path.join(repository.root, "source.ts"), 0o644);
    await rename(
      path.join(repository.root, "source.ts"),
      path.join(repository.root, "renamed.ts")
    );
    assert.equal((await decide()).actions[0]?.action, "execute");
    await rename(
      path.join(repository.root, "renamed.ts"),
      path.join(repository.root, "source.ts")
    );
    await symlink("source.ts", path.join(repository.root, "link.ts"));
    assert.equal((await decide()).actions[0]?.reason, "inputs_unavailable");
    await rm(path.join(repository.root, "link.ts"));
    for (const change of [
      (c: EvidenceConfiguration) => {
        requiredFixture(requiredFixture(c.profiles[0]).commands[0]).evidence =
          "fresh";
      },
      (c: EvidenceConfiguration) => {
        requiredFixture(requiredFixture(c.profiles[0]).commands[0]).args = [
          "run",
          "release:check"
        ];
      },
      (c: EvidenceConfiguration) => {
        requiredFixture(
          requiredFixture(c.profiles[0]).commands[0]
        ).ignoreExplanatory = false;
      },
      (c: EvidenceConfiguration) => {
        requiredFixture(c.policy).dependencies.environment.TZ = "UTC";
      },
      (c: EvidenceConfiguration) => {
        requiredFixture(c.policy).dependencies.volatile = ["network"];
      },
      (c: EvidenceConfiguration) => {
        requiredFixture(c.policy).dependencies.complete = false;
      },
      (c: EvidenceConfiguration) => {
        delete c.policy;
      }
    ]) {
      const changed = structuredClone(config);
      change(changed);
      assert.equal((await decide(changed)).actions[0]?.action, "execute");
    }
    for (const bad of [
      { ...origin, logsIntact: false },
      { ...origin, complete: false },
      { ...origin, status: "failed" as const, exitCode: 1 },
      { ...origin, status: "started" as const, exitCode: null },
      { ...origin, workId: "22222222-2222-4222-8222-222222222222" }
    ])
      assert.equal((await decide(config, [bad])).actions[0]?.action, "execute");
    assert.equal(
      (
        await decide(config, [
          origin,
          { ...origin, status: "failed", exitCode: 1 }
        ])
      ).actions[0]?.reason,
      "later_attempt"
    );
  } finally {
    await repository.dispose();
  }
});

test("verification config 3 and immutable obligation inventory require explicit complete authority", () => {
  const verification = {
    profiles: [
      {
        id: "project",
        projectType: "custom",
        commands: [
          {
            id: "unit",
            name: "Unit",
            command: "node",
            args: ["--version"],
            timeoutMs: 1000
          }
        ]
      }
    ]
  };
  const config = parseConfig({
    ...DEFAULT_CONFIG,
    schemaVersion: 3,
    verification
  });
  assert.equal(config.verification.profiles[0]?.commands[0]?.evidence, "fresh");
  assert.throws(() =>
    parseConfig({
      ...DEFAULT_CONFIG,
      schemaVersion: 3,
      verification: { ...verification, unknown: true }
    })
  );
  const parsed = parseVerificationConfiguration(verification);
  const remainder = "# Approved Plan\n\n";
  const inventory = {
    schema: "banzai-verification-obligations/v1",
    schemaVersion: 1,
    complete: true,
    planRemainderSha256: evidenceDigest(remainder),
    checks: [{ id: "unit", evidence: "equivalent_evidence" }]
  };
  const block =
    "```banzai-verification-obligations/v1\n" +
    JSON.stringify(inventory) +
    "\n```";
  assert.ok(parseVerificationObligations(remainder + block, parsed));
  assert.equal(
    parseVerificationObligations(
      remainder + block + "\nChanged authority.",
      parsed
    ),
    null
  );
  assert.equal(
    parseVerificationObligations(remainder + block + "\n" + block, parsed),
    null
  );
  assert.equal(
    parseVerificationObligations("Run the existing suite.", parsed),
    null
  );
});
