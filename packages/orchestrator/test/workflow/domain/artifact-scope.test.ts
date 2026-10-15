import assert from "node:assert/strict";
import test from "node:test";
import { BanzaiError } from "../../../src/errors.js";
import type { RunState } from "../../../src/types.js";
import {
  artifactPaths,
  isDocumentationPath,
  gateArtifactPaths
} from "../../../src/workflow/domain/artifact-scope.js";

const withArtifacts = (planArtifacts: unknown) =>
  ({ planArtifacts }) as unknown as RunState;

test("planning scope uses approval order and a null ADR-gate description is valid", () => {
  const state = withArtifacts({
    description: "work/description.md",
    plan: "work/plan.md",
    adrs: ["documentation/decisions/0001.md", "documentation/decisions/0002.md"]
  });
  assert.deepEqual(gateArtifactPaths(state, "plan_approval"), [
    "work/description.md",
    "documentation/decisions/0001.md",
    "documentation/decisions/0002.md",
    "work/plan.md"
  ]);
  assert.deepEqual(gateArtifactPaths(state, "adr_approval"), [
    "work/description.md",
    "documentation/decisions/0001.md",
    "documentation/decisions/0002.md"
  ]);
  assert.deepEqual(
    gateArtifactPaths(
      withArtifacts({
        description: null,
        plan: null,
        adrs: ["documentation/decisions/0001.md"]
      }),
      "adr_approval"
    ),
    ["documentation/decisions/0001.md"]
  );
});

test("approved artifact paths list the description, ADRs, then the plan", () => {
  assert.deepEqual(
    artifactPaths(
      withArtifacts({
        description: "work/description.md",
        plan: "work/plan.md",
        adrs: ["decisions/0001.md", "decisions/0002.md"]
      })
    ),
    [
      "work/description.md",
      "decisions/0001.md",
      "decisions/0002.md",
      "work/plan.md"
    ]
  );
  for (const [name, artifacts] of [
    ["no artifacts", null],
    ["no description", { description: null, plan: "p.md", adrs: [] }],
    ["no plan", { description: "d.md", plan: null, adrs: [] }]
  ] as const)
    assert.throws(
      () => artifactPaths(withArtifacts(artifacts)),
      (error: unknown) =>
        error instanceof BanzaiError &&
        error.code === "INCOMPLETE_PLAN" &&
        error.message ===
          "Planning must produce description and plan artifact paths before approval.",
      name
    );
});

test("documentation paths are the documentation tree on either separator", () => {
  for (const value of [
    "documentation",
    "documentation/guide.md",
    "documentation\\guide.md"
  ])
    assert.equal(isDocumentationPath(value), true, value);
  for (const value of [
    "documentation-notes.md",
    "docs/documentation/guide.md",
    "src/documentation.ts"
  ])
    assert.equal(isDocumentationPath(value), false, value);
});
