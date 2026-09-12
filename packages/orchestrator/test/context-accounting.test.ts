import assert from "node:assert/strict";
import test from "node:test";
import {
  available,
  decodeContextAttemptLedger,
  effectiveContextLimit,
  emptyContextInventory,
  emptyContextVendorUsage,
  evaluateContextBudgets,
  measureRunnerPayload
} from "../src/context-accounting.js";
import { BanzaiError } from "../src/errors.js";
import { createPromptEnvelope } from "../src/prompt-envelope.js";
import { resolveOutputContract } from "../src/output-contract.js";
import { planningPromptEnvelope } from "../src/prompts.js";
import {
  CONTEXT_ATTEMPT_SCHEMA,
  CONTEXT_ATTEMPT_SCHEMA_VERSION,
  type ContextAttemptLedger,
  type ContextPolicy,
  type PromptComponent
} from "../src/types.js";

test("context accounting uses exact UTF-8 bytes and keeps surfaces separate", () => {
  const envelope = createPromptEnvelope([
    { category: "phase_instructions", text: "Plan: " },
    { category: "user_request_scope", text: "Зміна café" }
  ]);
  const contract = resolveOutputContract("claude", "phase-result/v3");
  const measured = measureRunnerPayload(envelope, contract);
  assert.equal(
    measured.promptBytes,
    Buffer.byteLength(envelope.rendered, "utf8")
  );
  assert.equal(
    measured.outputSchemaBytes,
    Buffer.byteLength(contract.serialized, "utf8")
  );
  assert.equal(
    measured.components.reduce((sum, component) => sum + component.bytes, 0),
    measured.totalBytes
  );
  assert.deepEqual(
    measured.components.map((component) => component.category),
    ["phase_instructions", "user_request_scope", "output_contract"]
  );
});

test("context accounting aggregates out-of-order components by category without reordering the prompt", () => {
  // Rendering order and report category order are independent contracts: the
  // dispatched bytes keep the composer's order while the report sums by category.
  const components: PromptComponent[] = [
    { category: "common_instructions", text: "Runner: " },
    { category: "human_decisions", text: "\n\nРішення: café" },
    { category: "user_request_scope", text: "\n\nЗапит: 東京" },
    { category: "verification_evidence", text: "\n\nverify" },
    { category: "phase_instructions", text: "\n\nBound roles 🧪" },
    { category: "phase_instructions", text: "\n\nSerena guidance" }
  ];
  const envelope = createPromptEnvelope(components);
  const contract = resolveOutputContract("codex", "phase-result/v3");
  const measured = measureRunnerPayload(envelope, contract);

  assert.equal(
    envelope.rendered,
    components.map((component) => component.text).join("")
  );
  assert.deepEqual(
    envelope.components.map((component) => component.category),
    components.map((component) => component.category)
  );
  assert.equal(
    measured.promptBytes,
    Buffer.byteLength(envelope.rendered, "utf8")
  );
  assert.ok(measured.promptBytes > envelope.rendered.length);
  assert.deepEqual(
    measured.components.map((component) => component.category),
    [
      "common_instructions",
      "phase_instructions",
      "user_request_scope",
      "human_decisions",
      "verification_evidence",
      "output_contract"
    ]
  );
  const expected = new Map<string, number>();
  for (const component of components) {
    expected.set(
      component.category,
      (expected.get(component.category) ?? 0) +
        Buffer.byteLength(component.text, "utf8")
    );
  }
  for (const component of measured.components) {
    if (component.category === "output_contract") continue;
    assert.equal(
      component.bytes,
      expected.get(component.category),
      component.category
    );
  }
  assert.equal(
    measured.components.find(
      (component) => component.category === "phase_instructions"
    )?.bytes,
    Buffer.byteLength("\n\nBound roles 🧪", "utf8") +
      Buffer.byteLength("\n\nSerena guidance", "utf8")
  );
  assert.equal(
    measured.outputSchemaBytes,
    Buffer.byteLength(contract.serialized, "utf8")
  );
  assert.equal(
    measured.totalBytes,
    measured.promptBytes + measured.outputSchemaBytes
  );
  assert.equal(
    measured.components.reduce((sum, component) => sum + component.bytes, 0),
    measured.totalBytes
  );
});

test("consultation history and v3 contract bytes use existing context categories", () => {
  const preference = "Preserve café compatibility.";
  const envelope = planningPromptEnvelope(
    "example",
    "Design it.",
    [],
    [
      {
        kind: "decision_consultation",
        phase: "plan",
        gate: "decision_consultation",
        summary: "Choose compatibility behavior.",
        request: {
          schema: "banzai-decision-consultation/v1",
          schemaVersion: 1,
          requestId: "request-1",
          roundId: "round-1",
          decisions: [
            {
              decisionId: "decision-1",
              title: "Compatibility",
              question: "Which compatibility boundary applies?",
              why: "It changes the public contract.",
              affectedRequirements: ["FR1"],
              evidence: [
                { path: "src/api.ts", line: 1, detail: "The API is public." }
              ],
              decisionOwner: "human",
              responseMode: "free_text",
              options: [],
              recommendation: null
            }
          ]
        },
        requestedAt: "2026-08-31T09:00:00.000Z",
        runId: "run-1",
        requestId: "request-1",
        roundId: "round-1",
        answers: [
          {
            decisionId: "decision-1",
            response: {
              kind: "preference",
              optionId: null,
              text: preference
            },
            note: null
          }
        ],
        decidedAt: "2026-08-31T09:05:00.000Z",
        decidedBy: "human"
      }
    ]
  );
  const measured = measureRunnerPayload(
    envelope,
    resolveOutputContract("codex", "phase-result/v3")
  );
  const humanComponent = envelope.components.find(
    (component) => component.category === "human_decisions"
  );

  assert.ok(humanComponent?.text.includes(preference));
  assert.equal(
    measured.components.find(
      (component) => component.category === "human_decisions"
    )?.bytes,
    Buffer.byteLength(humanComponent?.text ?? "", "utf8")
  );
  assert.ok(
    measured.components.some(
      (component) => component.category === "output_contract"
    )
  );
});

test("context selector precedence and enforcement are deterministic", () => {
  const policy: ContextPolicy = {
    mode: "enforce",
    limits: [
      { metric: "runner_payload_bytes", phase: null, role: null, maximum: 900 },
      {
        metric: "runner_payload_bytes",
        phase: "review",
        role: null,
        maximum: 700
      },
      {
        metric: "runner_payload_bytes",
        phase: null,
        role: "reviewer",
        maximum: 600
      },
      {
        metric: "runner_payload_bytes",
        phase: "review",
        role: "reviewer",
        maximum: 500
      },
      {
        metric: "vendor_input_tokens",
        phase: "review",
        role: "reviewer",
        maximum: 10
      }
    ]
  };
  assert.equal(
    effectiveContextLimit(policy, "runner_payload_bytes", "review", "reviewer")
      ?.maximum,
    500
  );
  const evaluations = evaluateContextBudgets(policy, "review", "reviewer", {
    runner_payload_bytes: 501,
    vendor_input_tokens: 11
  });
  assert.deepEqual(
    evaluations.map((evaluation) => evaluation.result),
    ["enforced_exceeded", "observed_exceeded"]
  );
});

function validLedger(): ContextAttemptLedger {
  const runnerPayload = measureRunnerPayload(
    createPromptEnvelope([
      { category: "phase_instructions", text: "plan" },
      { category: "user_request_scope", text: "private request" }
    ]),
    resolveOutputContract("codex", "phase-result/v3")
  );
  return {
    schema: CONTEXT_ATTEMPT_SCHEMA,
    schemaVersion: CONTEXT_ATTEMPT_SCHEMA_VERSION,
    runId: "run-one",
    attempt: { id: "plan-1", kind: "plan", mutable: false },
    invocations: [
      {
        ordinal: 1,
        kind: "primary",
        workflow: "strict",
        phase: "plan",
        role: "planner",
        vendor: "codex",
        sessionMode: "fresh",
        measuredAt: "2026-08-23T10:00:00.000Z",
        completedAt: "2026-08-23T10:01:00.000Z",
        outcome: "completed",
        runnerPayload,
        authority: [{ class: "development_plan", count: 1 }],
        sessionInventory: emptyContextInventory(),
        vendorUsage: {
          ...emptyContextVendorUsage(),
          inputTokens: available(12)
        },
        budgets: []
      }
    ]
  };
}

test("context ledger decoder is closed and never repeats hostile content", () => {
  const ledger = validLedger();
  assert.deepEqual(
    decodeContextAttemptLedger(ledger, "run-one", "plan-1"),
    ledger
  );
  const hostile = structuredClone(ledger) as ContextAttemptLedger & {
    promptText?: string;
  };
  hostile.promptText =
    "Bearer secret@example.com /Users/private tool_result transcript";
  assert.throws(
    () => decodeContextAttemptLedger(hostile, "run-one", "plan-1"),
    (error: unknown) => {
      assert.ok(error instanceof BanzaiError);
      assert.equal(error.code, "INVALID_CONTEXT_EVIDENCE");
      assert.match(error.message, /run-one.*plan-1/);
      assert.doesNotMatch(
        error.message,
        /Bearer|example\.com|\/Users\/private/
      );
      return true;
    }
  );
});

test("context ledger decoder rejects cross-attempt identities and inconsistent budgets", () => {
  const wrongPhase = structuredClone(validLedger());
  const wrongPhaseInvocation = wrongPhase.invocations[0];
  assert.ok(wrongPhaseInvocation);
  wrongPhaseInvocation.phase = "review";
  assert.throws(
    () => decodeContextAttemptLedger(wrongPhase, "run-one", "plan-1"),
    /Invocation identity conflicts/
  );

  const wrongBudget = structuredClone(validLedger());
  const wrongBudgetInvocation = wrongBudget.invocations[0];
  assert.ok(wrongBudgetInvocation);
  wrongBudgetInvocation.budgets = [
    {
      metric: "runner_payload_bytes",
      selector: { phase: "plan", role: "planner" },
      maximum: 100,
      observed: available(99),
      result: "observed_exceeded"
    }
  ];
  assert.throws(
    () => decodeContextAttemptLedger(wrongBudget, "run-one", "plan-1"),
    /Budget result and observed value disagree/
  );

  const runnerMismatch = structuredClone(validLedger());
  const runnerMismatchInvocation = runnerMismatch.invocations[0];
  assert.ok(runnerMismatchInvocation);
  runnerMismatchInvocation.budgets = [
    {
      metric: "runner_payload_bytes",
      selector: { phase: "plan", role: "planner" },
      maximum: runnerMismatchInvocation.runnerPayload.totalBytes + 1,
      observed: available(
        runnerMismatchInvocation.runnerPayload.totalBytes - 1
      ),
      result: "within_limit"
    }
  ];
  assert.throws(
    () => decodeContextAttemptLedger(runnerMismatch, "run-one", "plan-1"),
    /Budget observation conflicts with measured evidence/
  );

  const vendorMismatch = structuredClone(validLedger());
  const vendorMismatchInvocation = vendorMismatch.invocations[0];
  assert.ok(vendorMismatchInvocation);
  vendorMismatchInvocation.budgets = [
    {
      metric: "vendor_input_tokens",
      selector: { phase: "plan", role: "planner" },
      maximum: 20,
      observed: available(11),
      result: "within_limit"
    }
  ];
  assert.throws(
    () => decodeContextAttemptLedger(vendorMismatch, "run-one", "plan-1"),
    /Budget observation conflicts with measured evidence/
  );

  const inventoryMismatch = structuredClone(validLedger());
  const inventoryMismatchInvocation = inventoryMismatch.invocations[0];
  assert.ok(inventoryMismatchInvocation);
  inventoryMismatchInvocation.budgets = [
    {
      metric: "session_tools",
      selector: { phase: "plan", role: "planner" },
      maximum: 5,
      observed: available(1),
      result: "within_limit"
    }
  ];
  assert.throws(
    () => decodeContextAttemptLedger(inventoryMismatch, "run-one", "plan-1"),
    /Budget observation conflicts with measured evidence/
  );

  const selectorMismatch = structuredClone(validLedger());
  const selectorMismatchInvocation = selectorMismatch.invocations[0];
  assert.ok(selectorMismatchInvocation);
  selectorMismatchInvocation.budgets = [
    {
      metric: "vendor_input_tokens",
      selector: { phase: "review", role: "planner" },
      maximum: 20,
      observed: available(12),
      result: "within_limit"
    }
  ];
  assert.throws(
    () => decodeContextAttemptLedger(selectorMismatch, "run-one", "plan-1"),
    /Budget selector conflicts with invocation identity/
  );

  const budgetOrder = structuredClone(validLedger());
  const budgetOrderInvocation = budgetOrder.invocations[0];
  assert.ok(budgetOrderInvocation);
  budgetOrderInvocation.budgets = [
    {
      metric: "vendor_input_tokens",
      selector: { phase: "plan", role: "planner" },
      maximum: 20,
      observed: available(12),
      result: "within_limit"
    },
    {
      metric: "runner_payload_bytes",
      selector: { phase: "plan", role: "planner" },
      maximum: budgetOrderInvocation.runnerPayload.totalBytes + 1,
      observed: available(budgetOrderInvocation.runnerPayload.totalBytes),
      result: "within_limit"
    }
  ];
  assert.throws(
    () => decodeContextAttemptLedger(budgetOrder, "run-one", "plan-1"),
    /deterministically ordered/
  );

  const wrongOrder = structuredClone(validLedger());
  const wrongOrderInvocation = wrongOrder.invocations[0];
  assert.ok(wrongOrderInvocation);
  wrongOrderInvocation.runnerPayload.components.reverse();
  assert.throws(
    () => decodeContextAttemptLedger(wrongOrder, "run-one", "plan-1"),
    /unique, and ordered/
  );
});

test("context ledger accepts unselected legacy strict phases", () => {
  const ledger = structuredClone(validLedger());
  ledger.attempt = {
    id: "implementation-1",
    kind: "implementation",
    mutable: true
  };
  const invocation = ledger.invocations[0];
  assert.ok(invocation);
  invocation.workflow = "unselected";
  invocation.phase = "implementation";
  invocation.role = "implementer";
  assert.deepEqual(
    decodeContextAttemptLedger(ledger, "run-one", "implementation-1"),
    ledger
  );
});
