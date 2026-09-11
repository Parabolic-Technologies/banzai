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
