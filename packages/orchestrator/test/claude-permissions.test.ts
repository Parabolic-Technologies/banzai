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
import { DEFAULT_CONFIG } from "../src/config.js";
import type { OrchestratorConfig } from "../src/types.js";

const PLANNING: ClaudePermissionDemand = {
  planningWrites: true,
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
  const config = structuredClone(DEFAULT_CONFIG);
  for (const [role, executable] of Object.entries(models)) {
    config.models[role as "planner"].executable = executable;
  }
  return config;
}

test("demand follows the roles whose phases depend on ambient rules", () => {
  // The reviewer writes only the candidate the spec-gate hook authorizes and
  // is denied Bash outright, so a Claude reviewer demands nothing.
  const reviewerOnly = claudePermissionDemand(
    configWith({ planner: "codex", implementer: "codex", reviewer: "claude" })
  );
  assert.deepEqual(reviewerOnly, {
    planningWrites: false,
    shellCommands: false
  });
  assert.equal(claudePermissionDemanded(reviewerOnly), false);

  const implementerOnly = claudePermissionDemand(
    configWith({ planner: "codex", implementer: "claude" })
  );
  assert.deepEqual(implementerOnly, {
    planningWrites: false,
    shellCommands: true
  });
  assert.equal(claudePermissionDemanded(implementerOnly), true);

  const planner = claudePermissionDemand(
    configWith({ planner: "claude", implementer: "claude" })
  );
  assert.deepEqual(planner, { planningWrites: true, shellCommands: true });

  // An unrecognized executable is attributed the way the vendor preflight
  // attributes it, so a wrapper cannot silently drop the audit.
  assert.deepEqual(
    claudePermissionDemand(configWith({ planner: "planner-wrapper" })),
    { planningWrites: false, shellCommands: false }
  );
});

test("a trusted checkout without a Write rule blocks with one remediation", async () => {
  const repository = await fixture();
  try {
    await repository.trust(true);
    await repository.writeProject({ allow: ["Bash(git status:*)"] });
    await repository.writeLocal({ allow: ["Write", "Edit"] });

    const audit = await inspectClaudePermissions({
      repoRoot: repository.repoRoot,
      demand: PLANNING,
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
    assert.equal(audit.blocking.length, 1);
    assert.match(
      audit.blocking[0] ?? "",
      /No loaded permission rule grants Write/
    );
    // The grants exist, in the one repository source a scoped run never loads.
    assert.ok(
      audit.advisories.some((advisory) =>
        advisory.includes("Local settings hold")
      )
    );
    const remediation = claudePermissionRemediation(audit);
    assert.match(remediation, /"Write" and "Edit"/);
    assert.match(remediation, /\.claude\/settings\.json/);
    assert.doesNotMatch(remediation, /trust prompt/);
  } finally {
    await repository.dispose();
  }
});

test("granted rules report a clean audit and demand-scoped tools", async () => {
  const repository = await fixture();
  try {
    await repository.trust(true);
    await repository.writeProject({
      allow: ["Write", "Edit", "Bash", "Bash(git status:*)"]
    });

    const planning = await inspectClaudePermissions({
      repoRoot: repository.repoRoot,
      demand: PLANNING,
      settingSources: "project",
      env: repository.env,
      managedSettingsFile: repository.managed
    });
    assert.deepEqual(planning.blocking, []);
    assert.deepEqual(planning.advisories, []);
    assert.equal(claudePermissionRemediation(planning), "");

    // An implementation-only demand never audits the planning writes the hook
    // already authorizes for it.
    const implementation = await inspectClaudePermissions({
      repoRoot: repository.repoRoot,
      demand: { planningWrites: false, shellCommands: true },
      settingSources: "project",
      env: repository.env,
      managedSettingsFile: repository.managed
    });
    assert.deepEqual(implementation.tools, [
      { tool: "Bash", grant: "granted" }
    ]);
  } finally {
    await repository.dispose();
  }
});

test("an untrusted checkout drops repository rules and names the trust gate", async () => {
  const repository = await fixture();
  try {
    await repository.trust(false);
    await repository.writeProject({ allow: ["Write", "Edit", "Bash"] });

    const untrusted = await inspectClaudePermissions({
      repoRoot: repository.repoRoot,
      demand: PLANNING,
      settingSources: "project",
      env: repository.env,
      managedSettingsFile: repository.managed
    });
    assert.equal(untrusted.trust, "untrusted");
    assert.equal(untrusted.blocking.length, 2);
    assert.ok(
      untrusted.blocking.some((reason) =>
        reason.includes("has not been trusted")
      )
    );
    assert.match(
      claudePermissionRemediation(untrusted),
      /accept the trust prompt/
    );

    // A checkout Claude has never opened has no record at all.
    await repository.trust(null);
    const absent = await inspectClaudePermissions({
      repoRoot: repository.repoRoot,
      demand: PLANNING,
      settingSources: "project",
      env: repository.env,
      managedSettingsFile: repository.managed
    });
    assert.equal(absent.trust, "untrusted");
  } finally {
    await repository.dispose();
  }
});

test("refusals, scoped grants, policy grants, and unreadable files are separated", async () => {
  const repository = await fixture();
  try {
    await repository.trust(true);
    await repository.writeProject({
      allow: ["Write", "Bash(ls:*)"],
      ask: ["Edit"]
    });
    const refused = await inspectClaudePermissions({
      repoRoot: repository.repoRoot,
      demand: PLANNING,
      settingSources: "project",
      env: repository.env,
      managedSettingsFile: repository.managed
    });
    // `dontAsk` cannot answer an ask rule, so it denies like a deny rule.
    assert.deepEqual(refused.tools, [
      { tool: "Write", grant: "granted" },
      { tool: "Edit", grant: "denied" },
      { tool: "Bash", grant: "scoped" }
    ]);
    assert.deepEqual(refused.blocking, []);
    assert.ok(
      refused.advisories.some((entry) => entry.includes("grants Edit"))
    );

    await repository.writeProject({ allow: ["Write(documentation/**)"] });
    const scoped = await inspectClaudePermissions({
      repoRoot: repository.repoRoot,
      demand: PLANNING,
      settingSources: "project",
      env: repository.env,
      managedSettingsFile: repository.managed
    });
    assert.deepEqual(scoped.blocking, []);
    assert.ok(
      scoped.advisories.some((entry) => entry.includes("path-scoped")),
      "a path-scoped Write is a caveat, not a block"
    );

    // Administrator policy applies whatever --setting-sources names.
    await repository.writeProject({ allow: [] });
    await writeFile(
      repository.managed,
      `${JSON.stringify({ permissions: { allow: ["Write", "Edit"] } })}\n`,
      "utf8"
    );
    const managed = await inspectClaudePermissions({
      repoRoot: repository.repoRoot,
      demand: PLANNING,
      settingSources: "project",
      env: repository.env,
      managedSettingsFile: repository.managed
    });
    assert.deepEqual(managed.blocking, []);

    await writeFile(repository.managed, "{ not json\n", "utf8");
    const malformed = await inspectClaudePermissions({
      repoRoot: repository.repoRoot,
      demand: PLANNING,
      settingSources: "project",
      env: repository.env,
      managedSettingsFile: repository.managed
    });
    assert.equal(malformed.blocking.length, 1);
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
    await repository.writeUser({ allow: ["Write", "Edit", "Bash"] });

    const ambient = await inspectClaudePermissions({
      repoRoot: repository.repoRoot,
      demand: PLANNING,
      settingSources: null,
      env: repository.env,
      managedSettingsFile: repository.managed
    });
    assert.deepEqual(ambient.sources, ["user", "project", "local"]);
    assert.deepEqual(ambient.blocking, []);
    assert.deepEqual(ambient.advisories, []);

    const scoped = await inspectClaudePermissions({
      repoRoot: repository.repoRoot,
      demand: PLANNING,
      settingSources: "project",
      env: repository.env,
      managedSettingsFile: repository.managed
    });
    assert.equal(scoped.blocking.length, 1);

    // A user grant survives an untrusted checkout; only repository rules fall.
    await repository.trust(false);
    const untrustedAmbient = await inspectClaudePermissions({
      repoRoot: repository.repoRoot,
      demand: PLANNING,
      settingSources: null,
      env: repository.env,
      managedSettingsFile: repository.managed
    });
    assert.deepEqual(untrustedAmbient.blocking, []);
  } finally {
    await repository.dispose();
  }
});
