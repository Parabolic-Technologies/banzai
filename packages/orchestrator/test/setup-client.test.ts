import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { DEFAULT_CONFIG } from "../src/config.js";
import {
  discoverSetupClients,
  prepareSetupLaunch,
  setupEnvironment
} from "../src/setup-client.js";
import type { ProcessRunner, ProcessSpec } from "../src/types.js";

test("setup client discovery is local, validates explicit skill and preserves selected auth and interactive permissions", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "banzai-client-"));
  const plugin = path.join(root, "independent-plugin");
  await cp(path.resolve("../../plugins/banzai"), plugin, { recursive: true });
  try {
    const calls: ProcessSpec[] = [];
    const runner: ProcessRunner = async (spec) => {
      calls.push(spec);
      const args = spec.args.join(" ");
      let stdout: string;
      if (args === "--help") stdout = "--ask-for-approval --permission-mode";
      else if (args === "plugin marketplace list --json")
        stdout = JSON.stringify({
          marketplaces: [{ name: "local-banzai", root }]
        });
      else if (args === "plugin list --marketplace local-banzai --json")
        stdout = JSON.stringify({
          installed: [
            {
              name: "banzai",
              marketplaceName: "local-banzai",
              installed: true,
              enabled: true,
              source: { source: "local", path: plugin }
            }
          ]
        });
      else if (args === "plugin list --json" && spec.command === "claude")
        stdout = JSON.stringify([
          { id: "banzai@local", enabled: true, installPath: plugin }
        ]);
      else if (args === "--version")
        stdout = spec.command === "claude" ? "2.1.218" : "codex-cli 0.145.0";
      else if (args === "login status") stdout = "Logged in using ChatGPT";
      else if (args === "auth status --json")
        stdout = JSON.stringify({
          loggedIn: true,
          authMethod: "oauth",
          apiProvider: "firstparty"
        });
      else if (args === "mcp get serena --json") stdout = "{}";
      else throw new Error(`Unexpected local probe: ${spec.command} ${args}`);
      return {
        exitCode: 0,
        signal: null,
        stdout,
        stderr: "",
        startedAt: "",
        completedAt: ""
      };
    };
    const config = structuredClone(DEFAULT_CONFIG);
    const env = {
      PATH: process.env.PATH,
      HOME: root,
      CODEX_HOME: root,
      ANTHROPIC_API_KEY: "FORBIDDEN_SECRET",
      OPENAI_API_KEY: "FORBIDDEN_SECRET",
      BANZAI_APPROVAL_DIGEST: "old-grant",
      BANZAI_WORKFLOW_DIGEST: "old-grant",
      BANZAI_REVIEW_ARTIFACT: "old-grant"
    };
    const clients = await discoverSetupClients(root, config, env, runner);
    assert.ok(
      clients.every((client) => client.unavailable === null),
      JSON.stringify(clients)
    );
    for (const client of clients) {
      calls.length = 0;
      const request = await prepareSetupLaunch(client, root, config, env, {
        runner
      });
      assert.equal(request.cwd, root);
      assert.equal(
        request.args.at(-1),
        client.vendor === "codex"
          ? "$banzai:project-manifest"
          : "/banzai:project-manifest"
      );
      assert.doesNotMatch(
        request.args.join(" "),
        /dontAsk|bypass|--json-schema|--output-schema|--resume|--model|--effort|--allowedTools|approvals_reviewer/
      );
      if (client.vendor === "codex")
        assert.deepEqual(request.args.slice(0, 4), [
          "--sandbox",
          "workspace-write",
          "--ask-for-approval",
          "on-request"
        ]);
      assert.doesNotMatch(
        JSON.stringify(request.env),
        /FORBIDDEN_SECRET|old-grant/
      );
      assert.equal(
        calls.filter((call) => call.args.includes("status")).length,
        1
      );
      assert.equal(
        calls.find((call) => call.args.includes("status"))?.command,
        client.vendor
      );
      assert.ok(
        calls.every((call) => call.timeoutMs > 0 && call.timeoutMs <= 30_000)
      );
      if (client.vendor === "claude") {
        assert.ok(request.args.includes("--strict-mcp-config"));
        assert.deepEqual(
          request.args.slice(
            request.args.indexOf("--setting-sources"),
            request.args.indexOf("--setting-sources") + 2
          ),
          ["--setting-sources", "project"]
        );
      }
    }
    assert.ok(
      !calls.some(
        (call) =>
          call.command === "codex" &&
          call.args.join(" ") === "plugin list --json"
      )
    );
    const unauthenticated: ProcessRunner = async (spec) =>
      spec.args.includes("status")
        ? {
            exitCode: 1,
            signal: null,
            stdout: "FORBIDDEN_SECRET",
            stderr: "FORBIDDEN_SECRET",
            startedAt: "",
            completedAt: ""
          }
        : runner(spec);
    for (const client of clients)
      await assert.rejects(
        prepareSetupLaunch(client, root, config, env, {
          runner: unauthenticated
        }),
        (error) => {
          assert.ok(error instanceof Error);
          assert.doesNotMatch(error.message, /FORBIDDEN_SECRET/);
          assert.match(error.message, /authentication|auth status|logged in/i);
          return true;
        }
      );
    const missingExecutable: ProcessRunner = async () => {
      throw new Error("ENOENT FORBIDDEN_SECRET");
    };
    const missing = await discoverSetupClients(
      root,
      config,
      env,
      missingExecutable
    );
    assert.ok(missing.every((client) => client.unavailable !== null));
    assert.doesNotMatch(JSON.stringify(missing), /FORBIDDEN_SECRET/);
    await rm(path.join(plugin, "skills/project-manifest/SKILL.md"));
    assert.ok(
      (await discoverSetupClients(root, config, env, runner)).every(
        (client) => client.unavailable !== null
      )
    );
    const before = await readFile(path.join(plugin, "hooks/hooks.json"));
    assert.ok(clients[0]);
    await assert.rejects(
      prepareSetupLaunch(
        clients[0],
        root,
        config,
        { ...env, BANZAI_RUN_ID: "parent" },
        { runner }
      ),
      { code: "PROJECT_SETUP_NESTED" }
    );
    assert.deepEqual(
      await readFile(path.join(plugin, "hooks/hooks.json")),
      before
    );
    assert.equal(
      setupEnvironment({ CLAUDECODE: "nested", BANZAI_RUN_ID: "run" })
        .CLAUDECODE,
      "nested"
    );
    assert.equal(
      setupEnvironment({ BANZAI_RUN_ID: "run" }).BANZAI_RUN_ID,
      undefined
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
