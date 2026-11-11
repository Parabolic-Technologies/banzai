import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  claudePermissionDemand,
  claudePermissionDemanded,
  claudePermissionDenialReport,
  claudePermissionRemediation,
  inspectClaudePermissions,
  inspectClaudeUserPluginScope,
  parsePermissionDenialRecord,
  permissionDenialRecord,
  proposedAllowRule,
  type ClaudePermissionAudit,
  type ClaudePermissionDemand
} from "../src/claude-permissions.js";
import type { OrchestratorConfig, PermissionDenial } from "../src/types.js";
import { reviewerOnlyClaudeConfig } from "./helpers.js";

const BUILDER: ClaudePermissionDemand = {
  fileWrites: true,
  shellCommands: true
};

interface Fixture {
  repoRoot: string;
  home: string;
  managed: string;
  env: NodeJS.ProcessEnv;
  /** A managed policy path that exists only when a test writes one. */
  writeProject(rules: unknown): Promise<void>;
  writeLocal(rules: unknown): Promise<void>;
  writeUser(rules: unknown): Promise<void>;
  trust(accepted: boolean | null): Promise<void>;
  dispose(): Promise<void>;
}

async function fixture(): Promise<Fixture> {
  const root = await mkdtemp(path.join(tmpdir(), "banzai-permissions-"));
  const repoRoot = path.join(root, "repo");
  const home = path.join(root, "home");
  await mkdir(path.join(repoRoot, ".claude"), { recursive: true });
  await mkdir(path.join(home, ".claude"), { recursive: true });
  const write = async (file: string, rules: unknown): Promise<void> => {
    await writeFile(
      file,
      `${JSON.stringify({ permissions: rules })}\n`,
      "utf8"
    );
  };
  return {
    repoRoot,
    home,
    managed: path.join(root, "managed-settings.json"),
    env: { HOME: home },
    writeProject: async (rules) => {
      await write(path.join(repoRoot, ".claude", "settings.json"), rules);
    },
    writeLocal: async (rules) => {
      await write(path.join(repoRoot, ".claude", "settings.local.json"), rules);
    },
    writeUser: async (rules) => {
      await write(path.join(home, ".claude", "settings.json"), rules);
    },
    trust: async (accepted) => {
      await writeFile(
        path.join(home, ".claude.json"),
        `${JSON.stringify({
          projects:
            accepted === null
              ? {}
              : { [repoRoot]: { hasTrustDialogAccepted: accepted } }
        })}\n`,
        "utf8"
      );
    },
    dispose: async () => {
      await rm(root, { recursive: true, force: true });
    }
  };
}

function configWith(
  models: Partial<Record<"planner" | "implementer" | "reviewer", string>>
): OrchestratorConfig {
  const config = reviewerOnlyClaudeConfig();
  for (const [role, executable] of Object.entries(models)) {
    config.models[role as "planner"].executable = executable;
  }
  return config;
}

test("demand follows the roles whose phases depend on permission rules", () => {
  // The reviewer receives neither write nor shell tools, so a Claude reviewer
  // demands nothing.
  const reviewerOnly = claudePermissionDemand(
    configWith({ planner: "codex", implementer: "codex", reviewer: "claude" })
  );
  assert.deepEqual(reviewerOnly, { fileWrites: false, shellCommands: false });
  assert.equal(claudePermissionDemanded(reviewerOnly), false);

  for (const models of [
    { planner: "codex", implementer: "claude" },
    { planner: "claude", implementer: "codex" },
    { planner: "claude", implementer: "claude" }
  ]) {
    assert.deepEqual(claudePermissionDemand(configWith(models)), BUILDER);
  }

  // An unrecognized executable is attributed the way the vendor preflight
  // attributes it, so a wrapper cannot silently drop the audit.
  assert.deepEqual(
    claudePermissionDemand(configWith({ planner: "planner-wrapper" })),
    { fileWrites: false, shellCommands: false }
  );
});

test("a checkout with no Write or Edit rule does not block, because the hook grants writes", async () => {
  const repository = await fixture();
  try {
    await repository.trust(true);
    await repository.writeProject({ allow: ["Bash(git status:*)"] });
    await repository.writeLocal({ allow: ["Bash"] });

    const audit = await inspectClaudePermissions({
      repoRoot: repository.repoRoot,
      demand: BUILDER,
      settingSources: "project",
      env: repository.env,
      managedSettingsFile: repository.managed
    });

    assert.deepEqual(audit.sources, ["project"]);
    assert.equal(audit.trust, "trusted");
    assert.deepEqual(audit.tools, [
      { tool: "Write", grant: "missing" },
      { tool: "Edit", grant: "missing" },
      { tool: "Bash", grant: "scoped" }
    ]);
    assert.deepEqual(audit.blocking, []);
    // The broader Bash grant exists, in the one repository source a scoped
    // run never loads.
    assert.ok(
      audit.advisories.some((advisory) =>
        advisory.includes("Local settings hold")
      )
    );
    assert.equal(claudePermissionRemediation(audit), "");
  } finally {
    await repository.dispose();
  }
});

test("granted rules report a clean audit and demand-scoped tools", async () => {
  const repository = await fixture();
  try {
    await repository.trust(true);
    await repository.writeProject({ allow: ["Bash", "Bash(git status:*)"] });

    const builder = await inspectClaudePermissions({
      repoRoot: repository.repoRoot,
      demand: BUILDER,
      settingSources: "project",
      env: repository.env,
      managedSettingsFile: repository.managed
    });
    assert.deepEqual(builder.blocking, []);
    assert.deepEqual(builder.advisories, []);
    assert.equal(claudePermissionRemediation(builder), "");

    const shellOnly = await inspectClaudePermissions({
      repoRoot: repository.repoRoot,
      demand: { fileWrites: false, shellCommands: true },
      settingSources: "project",
      env: repository.env,
      managedSettingsFile: repository.managed
    });
    assert.deepEqual(shellOnly.tools, [{ tool: "Bash", grant: "granted" }]);
  } finally {
    await repository.dispose();
  }
});

test("an untrusted checkout ignores repository allow rules but not its refusals", async () => {
  const repository = await fixture();
  try {
    await repository.trust(false);
    await repository.writeProject({ allow: ["Bash"] });

    const untrusted = await inspectClaudePermissions({
      repoRoot: repository.repoRoot,
      demand: BUILDER,
      settingSources: "project",
      env: repository.env,
      managedSettingsFile: repository.managed
    });
    assert.equal(untrusted.trust, "untrusted");
    assert.equal(untrusted.repositoryRulesIgnored, true);
    assert.deepEqual(untrusted.blocking, []);
    assert.ok(
      untrusted.advisories.some((reason) =>
        reason.includes("has not been trusted")
      )
    );
    assert.match(
      claudePermissionRemediation(untrusted),
      /accept the trust prompt/
    );

    // Claude Code enforces a repository deny rule before the checkout is
    // trusted, so the audit must not drop it with the allow rules.
    await repository.writeProject({ deny: ["Edit"] });
    const refusing = await inspectClaudePermissions({
      repoRoot: repository.repoRoot,
      demand: BUILDER,
      settingSources: "project",
      env: repository.env,
      managedSettingsFile: repository.managed
    });
    assert.equal(refusing.repositoryRulesIgnored, false);
    assert.equal(refusing.blocking.length, 1);
    assert.match(refusing.blocking[0] ?? "", /refuses Edit/);

    // A checkout Claude has never opened has no record at all.
    await repository.trust(null);
    const absent = await inspectClaudePermissions({
      repoRoot: repository.repoRoot,
      demand: BUILDER,
      settingSources: "project",
      env: repository.env,
      managedSettingsFile: repository.managed
    });
    assert.equal(absent.trust, "untrusted");
  } finally {
    await repository.dispose();
  }
});

test("refusals block, while path-scoped rules, policy rules, and unreadable files do not", async () => {
  const repository = await fixture();
  try {
    await repository.trust(true);
    await repository.writeProject({
      allow: ["Write", "Bash(ls:*)"],
      ask: ["Edit"]
    });
    const refused = await inspectClaudePermissions({
      repoRoot: repository.repoRoot,
      demand: BUILDER,
      settingSources: "project",
      env: repository.env,
      managedSettingsFile: repository.managed
    });
    // `dontAsk` cannot answer an ask rule, and no hook allow overrides one.
    assert.deepEqual(refused.tools, [
      { tool: "Write", grant: "granted" },
      { tool: "Edit", grant: "denied" },
      { tool: "Bash", grant: "scoped" }
    ]);
    assert.equal(refused.blocking.length, 1);
    assert.match(refused.blocking[0] ?? "", /refuses Edit\./);
    assert.match(
      claudePermissionRemediation(refused),
      /^remove the deny or ask rules naming "Edit"/
    );

    // Claude Code never consults a path-scoped Write rule, and the hook grants
    // the write either way.
    await repository.writeProject({ allow: ["Write(documentation/**)"] });
    const scoped = await inspectClaudePermissions({
      repoRoot: repository.repoRoot,
      demand: BUILDER,
      settingSources: "project",
      env: repository.env,
      managedSettingsFile: repository.managed
    });
    assert.deepEqual(scoped.blocking, []);

    // Administrator policy applies whatever --setting-sources names.
    await repository.writeProject({ allow: [] });
    await writeFile(
      repository.managed,
      `${JSON.stringify({ permissions: { deny: ["Write"] } })}\n`,
      "utf8"
    );
    const managed = await inspectClaudePermissions({
      repoRoot: repository.repoRoot,
      demand: BUILDER,
      settingSources: "project",
      env: repository.env,
      managedSettingsFile: repository.managed
    });
    assert.match(managed.blocking[0] ?? "", /refuses Write\./);
    assert.match(
      claudePermissionRemediation(managed),
      /administrator policy settings/
    );

    await writeFile(repository.managed, "{ not json\n", "utf8");
    const malformed = await inspectClaudePermissions({
      repoRoot: repository.repoRoot,
      demand: BUILDER,
      settingSources: "project",
      env: repository.env,
      managedSettingsFile: repository.managed
    });
    assert.deepEqual(malformed.blocking, []);
    assert.ok(
      malformed.advisories.some((entry) =>
        entry.includes("could not be parsed")
      )
    );
  } finally {
    await repository.dispose();
  }
});

test("ambient discovery loads user and local rules the scoped run never sees", async () => {
  const repository = await fixture();
  try {
    await repository.trust(true);
    await repository.writeUser({ allow: ["Bash"], deny: ["Edit"] });

    const ambient = await inspectClaudePermissions({
      repoRoot: repository.repoRoot,
      demand: BUILDER,
      settingSources: null,
      env: repository.env,
      managedSettingsFile: repository.managed
    });
    assert.deepEqual(ambient.sources, ["user", "project", "local"]);
    assert.equal(ambient.blocking.length, 1);
    assert.deepEqual(ambient.advisories, []);

    // A scoped run loads neither the user grant nor the user refusal.
    const scoped = await inspectClaudePermissions({
      repoRoot: repository.repoRoot,
      demand: BUILDER,
      settingSources: "project",
      env: repository.env,
      managedSettingsFile: repository.managed
    });
    assert.deepEqual(scoped.blocking, []);
    assert.ok(scoped.advisories.some((entry) => entry.includes("grants Bash")));

    // A user grant survives an untrusted checkout; only repository rules fall.
    await repository.writeUser({ allow: ["Bash"] });
    await repository.trust(false);
    const untrustedAmbient = await inspectClaudePermissions({
      repoRoot: repository.repoRoot,
      demand: BUILDER,
      settingSources: null,
      env: repository.env,
      managedSettingsFile: repository.managed
    });
    assert.deepEqual(untrustedAmbient.blocking, []);
    assert.deepEqual(untrustedAmbient.advisories, []);
  } finally {
    await repository.dispose();
  }
});

test("the user plugin scope reads only enabled banzai keys from the user settings file", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "banzai-plugin-scope-"));
  try {
    const file = path.join(home, ".claude", "settings.json");
    // An empty CLAUDE_CONFIG_DIR falls back to ~/.claude, as for permissions.
    const env = { HOME: home, CLAUDE_CONFIG_DIR: "" };
    assert.deepEqual(await inspectClaudeUserPluginScope(env), {
      state: "not_enabled",
      path: file
    });
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(
      file,
      JSON.stringify({
        enabledPlugins: {
          "banzai@zeta": true,
          "other@banzai": true,
          "banzai@banzai-plugins": true,
          "banzai@disabled": false
        }
      })
    );
    assert.deepEqual(await inspectClaudeUserPluginScope(env), {
      state: "enabled",
      path: file,
      keys: ["banzai@banzai-plugins", "banzai@zeta"]
    });
    await writeFile(file, '{"enabledPlugins":null}');
    assert.equal(
      (await inspectClaudeUserPluginScope(env)).state,
      "not_enabled"
    );
    await writeFile(file, "not json");
    assert.deepEqual(await inspectClaudeUserPluginScope(env), {
      state: "unreadable",
      path: file
    });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

function denial(overrides: Partial<PermissionDenial> = {}): PermissionDenial {
  return {
    tool: "Bash",
    detail: "npm run lint",
    command: "npm run lint",
    reasonType: "mode",
    subagent: false,
    ...overrides
  };
}

function shellAudit(
  overrides: Partial<ClaudePermissionAudit> = {}
): ClaudePermissionAudit {
  return {
    demand: { fileWrites: false, shellCommands: true },
    sources: ["project"],
    trust: "trusted",
    tools: [{ tool: "Bash", grant: "missing" }],
    repositoryRulesIgnored: false,
    blocking: [],
    advisories: [],
    ...overrides
  };
}

test("an allow rule is proposed only for one plain command, verbatim", () => {
  assert.equal(proposedAllowRule("npm run lint"), "Bash(npm run lint)");
  assert.equal(
    proposedAllowRule("vendor/bin/phpcs --standard=PSR12 src"),
    "Bash(vendor/bin/phpcs --standard=PSR12 src)"
  );
  for (const command of [
    "npm run lint && npm test",
    "npm run lint || true",
    "npm run lint; npm test",
    "cat a.txt | grep b",
    "npm test > out.txt",
    "sort < in.txt",
    "echo $(date)",
    "echo `date`",
    "(cd api && npm test)",
    "npm test &",
    "ls *.ts",
    "printf one\nprintf two",
    "",
    "   ",
    `node -e "${"x".repeat(200)}"`
  ]) {
    assert.equal(proposedAllowRule(command), null, JSON.stringify(command));
  }
});

test("the denial report names each call once and proposes exact rules for the loaded file", () => {
  const lines = claudePermissionDenialReport({
    denials: [
      denial(),
      denial(),
      denial({
        detail: "cd packages/api && npx vitest run",
        command: "cd packages/api && npx vitest run",
        subagent: true
      }),
      denial({
        tool: "Write",
        detail: "src/config.ts",
        command: null,
        reasonType: "rule"
      }),
      denial({ detail: "git status", command: "git status" }),
      denial({ tool: "WebFetch", detail: "", command: null })
    ],
    count: 6,
    phase: "implementation",
    audit: shellAudit()
  });
  assert.deepEqual(lines, [
    "Claude denied 6 tool calls during implementation:",
    "  - Bash: npm run lint (2 times)",
    "  - Bash: cd packages/api && npx vitest run (subagent; needs a hand-written rule)",
    "  - Write: src/config.ts (refused by a deny or ask rule)",
    "  - Bash: git status",
    "  - WebFetch",
    "To allow the exact commands in later phases, add these rules to .claude/settings.json (tracked and shared):",
    "  {",
    '    "permissions": {',
    '      "allow": [',
    '        "Bash(npm run lint)",',
    '        "Bash(git status)"',
    "      ]",
    "    }",
    "  }",
    "Banzai never writes permission rules."
  ]);
});

test("the denial report follows the settings the session loads and the trust state", () => {
  const input = { denials: [denial()], count: 1, phase: "plan" };
  const target = (audit: ClaudePermissionAudit | null): string[] =>
    claudePermissionDenialReport({ ...input, audit }).filter(
      (line) => line.startsWith("To allow") || line.startsWith("First")
    );
  assert.deepEqual(
    target(shellAudit({ sources: ["user", "project", "local"] })),
    [
      "To allow the exact commands in later phases, add these rules to .claude/settings.local.json:"
    ]
  );
  assert.deepEqual(target(shellAudit({ sources: ["user"] })), [
    "To allow the exact commands in later phases, add these rules to your Claude user settings:"
  ]);
  assert.deepEqual(target(null), [
    "To allow the exact commands in later phases, add these rules to the settings Claude loads:"
  ]);
  assert.deepEqual(target(shellAudit({ trust: "untrusted" })), [
    "First run `claude` once in this checkout and accept the trust prompt; until then Claude Code ignores the repository's allow rules.",
    "To allow the exact commands in later phases, add these rules to .claude/settings.json (tracked and shared):"
  ]);
  assert.equal(
    claudePermissionDenialReport({ ...input, audit: shellAudit() })[0],
    "Claude denied 1 tool call during plan:"
  );
});

test("a deny-or-ask refusal and an unknown command get no proposed rule", () => {
  const lines = claudePermissionDenialReport({
    denials: [
      denial({ reasonType: "rule" }),
      denial({ detail: "", command: null }),
      denial({ detail: "deploy --token …", command: null })
    ],
    count: 3,
    phase: "fix",
    audit: shellAudit()
  });
  assert.deepEqual(lines, [
    "Claude denied 3 tool calls during fix:",
    "  - Bash: npm run lint (refused by a deny or ask rule)",
    "  - Bash (needs a hand-written rule)",
    "  - Bash: deploy --token … (needs a hand-written rule)",
    "Banzai never writes permission rules."
  ]);
});

test("the denial report caps distinct calls and renders nothing for an empty list", () => {
  const many = Array.from({ length: 25 }, (_, index) =>
    denial({ detail: `npm run job-${index}`, command: `npm run job-${index}` })
  );
  const lines = claudePermissionDenialReport({
    denials: many,
    count: 60,
    phase: "implementation",
    audit: shellAudit()
  });
  assert.equal(lines[0], "Claude denied 60 tool calls during implementation:");
  assert.equal(lines.filter((line) => line.startsWith("  - ")).length, 20);
  assert.equal(lines[21], "  and 5 more");
  assert.deepEqual(
    claudePermissionDenialReport({
      denials: [],
      count: 0,
      phase: "implementation",
      audit: shellAudit()
    }),
    []
  );
});

test("the denial record keeps an exact count, bounds its entries and survives a round trip", () => {
  const many = Array.from({ length: 60 }, (_, index) =>
    denial({ detail: `npm run job-${index}`, command: `npm run job-${index}` })
  );
  const record = permissionDenialRecord(
    { id: "implementation-1-abcd1234", kind: "implementation" },
    many
  );
  assert.equal(record.attemptId, "implementation-1-abcd1234");
  assert.equal(record.kind, "implementation");
  assert.equal(record.count, 60);
  assert.equal(record.denials.length, 50);
  assert.deepEqual(
    parsePermissionDenialRecord(JSON.parse(JSON.stringify(record))),
    record
  );
});

test("a damaged denial record is refused and unsafe entries are dropped", () => {
  for (const details of [
    null,
    "text",
    {},
    { attemptId: "a", kind: "plan", count: "2", denials: [] },
    { attemptId: "a", kind: "plan", count: 1, denials: "none" },
    { attemptId: 4, kind: "plan", count: 1, denials: [] }
  ]) {
    assert.equal(parsePermissionDenialRecord(details), null);
  }
  const parsed = parsePermissionDenialRecord({
    attemptId: "plan-1",
    kind: "plan",
    count: 4,
    denials: [
      denial(),
      denial({ detail: "bad\u001b[31mdetail" }),
      { tool: "Bash" },
      denial({ command: "x".repeat(500) }),
      denial({ tool: "Bash tool" })
    ]
  });
  assert.deepEqual(parsed, {
    attemptId: "plan-1",
    kind: "plan",
    count: 4,
    denials: [denial()]
  });
});
