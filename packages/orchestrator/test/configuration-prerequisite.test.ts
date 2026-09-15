import assert from "node:assert/strict";
import test from "node:test";
import { requiredFixture } from "./helpers.js";
import {
  CONFIGURATION_ACTIONS,
  allocateVerificationCommandId,
  parseConfigurationPrerequisite,
  parseConfigurationProposal,
  reviseVerificationProfile,
  substantiveProposal,
  verificationProposal,
  type ConfigurationPrerequisiteRequest
} from "../src/configuration-prerequisite.js";
import { DEFAULT_CONFIG } from "../src/config.js";
import type { VerificationCommand } from "../src/types.js";
import type { VerificationProjectInspection } from "../src/verification.js";

const uuid = "11111111-1111-4111-8111-111111111111";
const nextUuid = "22222222-2222-4222-8222-222222222222";
const command: VerificationCommand = {
  id: "tests",
  name: "tests",
  command: "npm",
  args: ["run", "test"],
  timeoutMs: 1000
};
const current = { id: "node", commands: [command] };
const project: VerificationProjectInspection = {
  projectTypes: ["node"],
  markerless: false,
  sourceSha256: "a".repeat(64),
  node: {
    scriptNames: ["test"],
    suggestedScriptNames: ["test"],
    packageManager: "npm",
    packageManagerCandidates: ["npm"]
  }
};

function request(): ConfigurationPrerequisiteRequest {
  return {
    schema: "banzai-configuration-prerequisite/v1",
    schemaVersion: 1,
    kind: "configuration_prerequisite",
    runId: "20260914-test",
    decisionId: uuid,
    proposalId: nextUuid,
    requestedAt: "2026-09-14T12:00:00.000Z",
    reason: "missing_profile",
    proposal: {
      projectType: "node",
      profile: current,
      source: {
        kind: "project_scripts",
        path: "package.json",
        packageManager: "npm",
        scriptNames: ["test"]
      }
    },
    options: CONFIGURATION_ACTIONS,
    configSha256: "b".repeat(64),
    sourceSha256: "a".repeat(64),
    continuation: {
      attemptId: "implementation-1",
      attemptKind: "implementation",
      verificationRound: {
        id: "verification-round-implementation-1",
        ordinal: 1
      },
      baseCommit: "c".repeat(40),
      workId: uuid,
      workBindingSha256: "d".repeat(64),
      approvalDigest: "e".repeat(64),
      workflowSelectionDigest: null
    }
  };
}

test("command edits retain only unchanged identities and preserve policy options", () => {
  const known = new Set(["tests", `check-${uuid}`, "removed-history-id"]);
  const unchanged = reviseVerificationProfile(current, current, 3, known);
  assert.equal(unchanged.commands[0]?.id, "tests");
  for (const change of [
    { name: "renamed" },
    { timeoutMs: 2000 },
    { command: "pnpm" },
    { args: ["run", "lint"] }
  ]) {
    const changed = reviseVerificationProfile(
      { ...current, commands: [{ ...command, ...change }] },
      current,
      3,
      known,
      () => nextUuid
    );
    assert.equal(changed.commands[0]?.id, `check-${nextUuid}`);
  }
  const policy = {
    ...command,
    evidence: "equivalent_evidence" as const,
    ignoreExplanatory: true
  };
  const retained = reviseVerificationProfile(
    current,
    { ...current, commands: [policy] },
    3,
    known
  );
  assert.equal(retained.commands[0]?.id, "tests");
  assert.equal(retained.commands[0].evidence, "equivalent_evidence");
  assert.equal(retained.commands[0].ignoreExplanatory, true);
  assert.throws(
    () =>
      reviseVerificationProfile(
        { ...current, commands: [{ ...command, evidence: "fresh" }] },
        current,
        3,
        known
      ),
    { code: "CONFIGURATION_PROPOSAL_INVALID" }
  );
  assert.throws(
    () =>
      reviseVerificationProfile(
        { ...current, commands: [{ ...command, id: "invented" }] },
        current,
        3,
        known
      ),
    { code: "CONFIGURATION_PROPOSAL_INVALID" }
  );
  assert.throws(
    () =>
      reviseVerificationProfile(
        { ...current, commands: [command, command] },
        current,
        3,
        known
      ),
    { code: "CONFIGURATION_PROPOSAL_INVALID" }
  );
  let attempts = 0;
  assert.equal(
    allocateVerificationCommandId(new Set([`check-${uuid}`]), () =>
      ++attempts === 1 ? uuid : nextUuid
    ),
    `check-${nextUuid}`
  );
  assert.equal(attempts, 2);
  const two = {
    ...current,
    commands: [command, { ...command, id: "lint", name: "lint" }]
  };
  assert.deepEqual(
    reviseVerificationProfile(
      { ...two, commands: [...two.commands].reverse() },
      two,
      3,
      known
    ).commands.map((item) => item.id),
    ["lint", "tests"]
  );
});

test("the prerequisite envelope is closed, bounded and inert, while empty drafts cannot be accepted", () => {
  const parsed = parseConfigurationPrerequisite(request(), 3);
  assert.equal(parsed.proposal.profile.commands[0]?.id, "tests");
  assert.equal(substantiveProposal(parsed.proposal), true);
  const draft = parseConfigurationProposal(
    { ...parsed.proposal, profile: { id: "node", commands: [] } },
    3
  );
  assert.equal(substantiveProposal(draft), false);
  const mutations = [
    { ...request(), extra: true },
    { ...request(), configSha256: "bad" },
    { ...request(), options: ["accept", "cancel"] },
    { ...request(), reason: "runtime_failure" },
    { ...request(), decisionId: "old" },
    { ...request(), requestedAt: "2026-99-14T12:00:00.000Z" },
    {
      ...request(),
      continuation: { ...request().continuation, approvalDigest: null }
    },
    {
      ...request(),
      proposal: {
        ...parsed.proposal,
        source: {
          kind: "project_scripts",
          path: "../secret",
          packageManager: "npm",
          scriptNames: ["test"]
        }
      }
    }
  ];
  for (const value of mutations)
    assert.throws(() => parseConfigurationPrerequisite(value, 3), {
      code: "CONFIGURATION_PROPOSAL_INVALID"
    });
  for (const change of [
    { name: "\x1b[2J" },
    { args: ["\naccept"] },
    { timeoutMs: 0 },
    { args: ["x".repeat(4097)] },
    { command: "x".repeat(501) }
  ]) {
    assert.throws(
      () =>
        reviseVerificationProfile(
          { ...current, commands: [{ ...command, ...change }] },
          current,
          3,
          new Set()
        ),
      { code: "CONFIGURATION_PROPOSAL_INVALID" }
    );
  }
  const large = {
    ...parsed.proposal,
    profile: {
      id: "node",
      commands: Array.from({ length: 20 }, (_, i) => ({
        ...command,
        id: `check-${i}`,
        args: ["x".repeat(4096)]
      }))
    }
  };
  assert.throws(() => parseConfigurationProposal(large, 3), {
    code: "CONFIGURATION_PROPOSAL_INVALID"
  });
});

test("proposals remain additive and require explicit command entry when evidence cannot select commands", () => {
  const config = structuredClone(DEFAULT_CONFIG);
  config.verification.profiles.push({ ...current, projectType: "node" });
  const proposal = verificationProposal(config, project, "node", new Set());
  assert.equal(proposal.profile.id, "node-2");
  assert.deepEqual(
    proposal.profile.commands.map((item) => item.args),
    [["run", "test"]]
  );
  assert.equal(config.verification.profiles.length, 2);
  const ambiguous = verificationProposal(
    config,
    {
      ...project,
      node: { ...requiredFixture(project.node), packageManager: null }
    },
    "node",
    new Set()
  );
  assert.deepEqual(ambiguous.profile.commands, []);
  const custom = verificationProposal(
    config,
    { ...project, projectTypes: ["custom"], markerless: true, node: null },
    "custom",
    new Set()
  );
  assert.deepEqual(custom.profile.commands, []);
  assert.equal(custom.source.kind, "documented_example");
  const go = verificationProposal(config, project, "go", new Set());
  assert.deepEqual(go.profile.commands[0]?.args, ["test", "./..."]);
});
