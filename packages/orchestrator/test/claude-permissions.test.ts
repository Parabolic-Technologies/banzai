import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  claudePermissionDemand,
  claudePermissionDemanded,
  claudePermissionRemediation,
  inspectClaudePermissions,
  type ClaudePermissionDemand
} from "../src/claude-permissions.js";
import type { OrchestratorConfig } from "../src/types.js";
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
