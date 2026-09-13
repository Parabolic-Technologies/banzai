import assert from "node:assert/strict";
import test from "node:test";
import {
  assertContractParity,
  phaseResultSchema,
  reviewResultSchema,
  workflowSelectionSchema
} from "../src/contracts.js";
import { DEFAULT_CONFIG } from "../src/config.js";
import { BanzaiError } from "../src/errors.js";
import {
  CONTRACT_VERSION,
  MODEL_ATTEMPT_SCHEMA_VERSION,
  PHASE_RESULT_SCHEMA_VERSION,
  RECOVERY_AUTHORIZATION_SCHEMA,
  RECOVERY_AUTHORIZATION_SCHEMA_VERSION,
  TERMINAL_CHECKPOINT_SCHEMA,
  TERMINAL_CHECKPOINT_SCHEMA_VERSION,
  type TerminalAttemptCheckpoint
} from "../src/types.js";
import {
  digestCanonicalJson,
  normalizeRfc3339Instant,
  parseEvaluationAttemptSource,
  parseEvaluationEventSource,
  parseEvaluationReviewSource,
  parseEvaluationStateSource,
  parseConfig,
  parseDecisionConsultationAnswers,
  parseModelAttemptRecord,
  parsePhaseResult,
  parsePersistedPhaseResult,
  parseRecoveryAuthorization,
  parseReviewResult,
  parseTerminalAttemptCheckpoint,
  parseVerificationAttemptRecord,
  parseVerificationLedger,
  parseWorkflowSelectionResult,
  terminalCheckpointIntegrity
} from "../src/validation.js";
import {
  evaluationAttemptFixture,
  evaluationStateFixture,
  verificationAttemptFixture
} from "./helpers.js";

function phase(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    schemaVersion: PHASE_RESULT_SCHEMA_VERSION,
    contractVersion: CONTRACT_VERSION,
    phase: "plan",
    outcome: "needs_human_decision",
    gate: "plan_approval",
    summary: "Plan is ready.",
    artifacts: {
      description: "documentation/features/example/description.md",
      plan: "documentation/development-plans/example/plan.md",
      adrs: [],
      implementationReport: null,
      testReport: null
    },
    taskCompletion: null,
    touchedPaths: [],
    questions: [],
    decisionConsultation: null,
    resolvedFindingIds: [],
    requestedVerification: [],
    ...overrides
  };
}

function consultationCard(overrides: Record<string, unknown> = {}) {
  return {
    decisionId: "storage-model",
    title: "Storage model",
    question: "Which storage model should the feature use?",
    why: "The choice changes compatibility and operational ownership.",
    affectedRequirements: ["FR4", "EQ-09"],
    evidence: [
      {
        path: "packages/orchestrator/src/store.ts",
        line: 120,
        detail: "The runner already owns durable JSON state."
      }
    ],
    decisionOwner: "human",
    responseMode: "single_choice",
    options: [
      {
        optionId: "reuse-store",
        title: "Reuse the store",
        benefits: ["Preserves one state authority."],
        costs: ["Requires a state schema revision."],
        risks: ["Legacy readers need explicit coverage."],
        consequences: ["No new service is introduced."]
      },
      {
        optionId: "external-service",
        title: "Use an external service",
        benefits: ["Could support remote collaboration."],
        costs: ["Adds operations and a dependency."],
        risks: ["Creates another authority boundary."],
        consequences: ["Requires deployment and authentication."]
      }
    ],
    recommendation: {
      optionId: "reuse-store",
      rationale: "It satisfies the requirement with the existing authority."
    },
    ...overrides
  };
}

function consultation(overrides: Record<string, unknown> = {}) {
  return {
    schema: "banzai-decision-consultation/v1",
    schemaVersion: 1,
    requestId: "request-1",
    roundId: "round-1",
    decisions: [consultationCard()],
    ...overrides
  };
}

function assertStructuredOutputSchema(value: unknown, path = "$"): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      assertStructuredOutputSchema(item, `${path}[${index}]`);
    });
    return;
  }
  if (typeof value !== "object" || value === null) {
    return;
  }
  const record = value as Record<string, unknown>;
  assert.equal(
    Object.hasOwn(record, "uniqueItems"),
    false,
    `${path} uses unsupported uniqueItems`
  );
  if (Object.hasOwn(record, "enum") || Object.hasOwn(record, "const")) {
    assert.ok(Object.hasOwn(record, "type"), `${path} must declare type`);
  }
  if (record.type === "object") {
    assert.equal(
      record.additionalProperties,
      false,
      `${path} must set additionalProperties=false`
    );
    const properties = record.properties as Record<string, unknown> | undefined;
    assert.ok(properties, `${path} must declare properties`);
    for (const [name, property] of Object.entries(properties)) {
      const propertySchema = property as Record<string, unknown>;
      assert.ok(
        Object.hasOwn(propertySchema, "type") ||
          Object.hasOwn(propertySchema, "$ref") ||
          Object.hasOwn(propertySchema, "anyOf"),
        `${path}.properties.${name} must declare type or a schema reference`
      );
    }
    const required = record.required as string[] | undefined;
    assert.ok(required, `${path} must declare required`);
    assert.deepEqual(
      [...required].sort(),
      Object.keys(properties).sort(),
      `${path} must require every property`
    );
  }
  for (const [key, child] of Object.entries(record)) {
    assertStructuredOutputSchema(child, `${path}.${key}`);
  }
}

test("configuration decoding keeps versioned verification contracts distinct", () => {
  const current = parseConfig(structuredClone(DEFAULT_CONFIG));
  assert.equal(current.schemaVersion, 3);
  assert.equal(current.verification.profiles[0]?.projectType, "repository");

  for (const schemaVersion of [1, 2])
    assert.throws(() => parseConfig({ ...DEFAULT_CONFIG, schemaVersion }), {
      code: "RESOURCE_VERSION_UNSUPPORTED",
      message:
        /^.+ version .+ is not supported; 3\.x supports .+; last read by release-train major 2$/u
    });

  const duplicateIds = structuredClone(DEFAULT_CONFIG);
  const first = duplicateIds.verification.profiles[0];
  assert.ok(first);
  duplicateIds.verification.profiles.push(structuredClone(first));
  assert.throws(
    () => parseConfig(duplicateIds),
    /Invalid schema 3 verification configuration/
  );
});

test("an existing config without a Claude environment section defaults to isolation", () => {
  const legacy: Record<string, unknown> = {
    ...structuredClone(DEFAULT_CONFIG)
  };
  delete legacy.claudeEnvironment;
  assert.deepEqual(parseConfig(legacy).claudeEnvironment, {
    mode: "scoped",
    pluginDirectory: null
  });
  assert.equal(parseConfig(legacy).schemaVersion, 3);

  const explicit = structuredClone(DEFAULT_CONFIG);
  explicit.claudeEnvironment = {
    mode: "ambient",
    pluginDirectory: "  /plugins/banzai  "
  };
  assert.deepEqual(parseConfig(explicit).claudeEnvironment, {
    mode: "ambient",
    pluginDirectory: "/plugins/banzai"
  });

  for (const invalid of [
    { mode: "isolated", pluginDirectory: null },
    { mode: "scoped", pluginDirectory: "   " },
    { mode: "scoped", pluginDirectory: 5 }
  ]) {
    const broken: Record<string, unknown> = {
      ...structuredClone(DEFAULT_CONFIG),
      claudeEnvironment: invalid
    };
    assert.throws(() => parseConfig(broken), /claudeEnvironment/);
  }
});

test("plugin and runner contract versions match", () => {
  assert.doesNotThrow(assertContractParity);
  assert.match(phaseResultSchema.$id, /\/v3\/phase-result\.schema\.json$/);
  assert.equal(phaseResultSchema.properties.schemaVersion.const, 3);
  assert.ok(phaseResultSchema.required.includes("taskCompletion"));
  assert.ok(phaseResultSchema.required.includes("decisionConsultation"));
});

test("shared schemas satisfy the OpenAI Structured Outputs subset", () => {
  assertStructuredOutputSchema(workflowSelectionSchema);
  assertStructuredOutputSchema(phaseResultSchema);
  assertStructuredOutputSchema(reviewResultSchema);
});

test("workflow selections require a versioned route, confidence, and trigger evidence", () => {
  assert.deepEqual(
    parseWorkflowSelectionResult({
      contractVersion: CONTRACT_VERSION,
      recommendedWorkflow: "quick-fix",
      confidence: "high",
      reason: "The request fixes existing behavior.",
      escalationTriggers: ["auth", "auth"]
    }),
    {
      contractVersion: CONTRACT_VERSION,
      recommendedWorkflow: "quick-fix",
      confidence: "high",
      reason: "The request fixes existing behavior.",
      escalationTriggers: ["auth"]
    }
  );
  assert.throws(
    () =>
      parseWorkflowSelectionResult({
        contractVersion: CONTRACT_VERSION,
        recommendedWorkflow: "small",
        confidence: "high",
        reason: "Unknown route.",
        escalationTriggers: []
      }),
    /recommendedWorkflow/
  );
});

test("phase results require consistent human gates and outcomes", () => {
  assert.equal(parsePhaseResult(phase()).gate, "plan_approval");
  assert.deepEqual(
    parsePhaseResult(phase({ touchedPaths: ["src/a.ts", "src/a.ts"] }))
      .touchedPaths,
    ["src/a.ts"]
  );
  assert.throws(
    () =>
      parsePhaseResult(phase({ outcome: "completed", gate: "plan_approval" })),
    /must appear together/
  );
  assert.throws(
    () =>
      parsePhaseResult(phase({ outcome: "needs_human_decision", gate: null })),
    /must appear together/
  );
});

test("new phase results require v3 and decode the structured completion ledger", () => {
  assert.throws(
    () => parsePhaseResult(phase({ schemaVersion: 1 })),
    /phase result version 1 is not supported/
  );

  const result = parsePhaseResult(
    phase({
      phase: "implementation",
      outcome: "completed",
      gate: null,
      artifacts: {
        description: "documentation/features/example/description.md",
        plan: "documentation/development-plans/example/plan.md",
        adrs: [],
        implementationReport:
          "documentation/features/example/implementation-report.md",
        testReport: "documentation/features/example/test-report.md"
      },
      taskCompletion: {
        schemaVersion: 1,
        tasks: [
          {
            taskId: "T001",
            status: "completed",
            evidence: [{ path: "src/example.ts", detail: "Implementation." }],
            gap: null
          }
        ]
      }
    })
  );
  assert.equal(result.taskCompletion?.tasks[0]?.taskId, "T001");

  assert.throws(
    () =>
      parsePhaseResult(
        phase({
          taskCompletion: {
            schemaVersion: 1,
            tasks: [
              {
                taskId: "T001",
                status: "done",
                evidence: [],
                gap: null
              }
            ]
          }
        })
      ),
    /T001 has an invalid completion status/
  );
});

test("decision consultation validates one bounded planning-only request", () => {
  const parsed = parsePhaseResult(
    phase({
      gate: "decision_consultation",
      questions: [],
      decisionConsultation: consultation()
    })
  );
  assert.equal(parsed.decisionConsultation?.requestId, "request-1");
  assert.equal(
    parsed.decisionConsultation.decisions[0]?.recommendation?.optionId,
    "reuse-store"
  );

  for (const invalid of [
    phase({
      gate: "decision_consultation",
      phase: "implementation",
      decisionConsultation: consultation()
    }),
    phase({
      gate: "decision_consultation",
      questions: ["Prose is not the consultation contract."],
      decisionConsultation: consultation()
    }),
    phase({
      gate: "plan_approval",
      decisionConsultation: consultation()
    }),
    phase({
      gate: "decision_consultation",
      decisionConsultation: consultation({
        decisions: [
          consultationCard(),
          consultationCard({ title: "Duplicate id" })
        ]
      })
    }),
    phase({
      gate: "decision_consultation",
      decisionConsultation: consultation({
        decisions: [
          consultationCard({
            responseMode: "free_text",
            recommendation: null
          })
        ]
      })
    }),
    phase({
      gate: "decision_consultation",
      decisionConsultation: consultation({
        decisions: [consultationCard({ affectedRequirements: [] })]
      })
    }),
    phase({
      gate: "decision_consultation",
      decisionConsultation: consultation({
        decisions: [
          consultationCard({
            evidence: [
              {
                path: "packages/orchestrator/src/store.ts",
                line: Number.MAX_SAFE_INTEGER + 1,
                detail: "The line must be safely representable."
              }
            ]
          })
        ]
      })
    }),
    phase({
      gate: "decision_consultation",
      decisionConsultation: consultation({
        decisions: [
          consultationCard({
            evidence: [
              {
                path: "../outside.ts",
                line: 1,
                detail: "Escapes the repository."
              }
            ]
          })
        ]
      })
    }),
    phase({
      gate: "decision_consultation",
      decisionConsultation: consultation({
        decisions: [
          consultationCard({
            recommendation: {
              optionId: "missing",
              rationale: "Not a real option."
            }
          })
        ]
      })
    }),
    phase({
      gate: "decision_consultation",
      decisionConsultation: consultation({
        decisions: [consultationCard({ question: "Unsafe\u001b[31m" })]
      })
    }),
    phase({
      gate: "decision_consultation",
      summary: "Unsafe\u001b[31m",
      decisionConsultation: consultation()
    })
  ]) {
    assert.throws(() => parsePhaseResult(invalid), BanzaiError);
  }

  const freeTextRequest = consultation({
    decisions: [0, 1, 2].map((index) =>
      consultationCard({
        decisionId: `preference-${index}`,
        responseMode: "free_text",
        options: [],
        recommendation: null
      })
    )
  });
  const parsedFreeTextRequest = parsePhaseResult(
    phase({
      gate: "decision_consultation",
      decisionConsultation: freeTextRequest
    })
  ).decisionConsultation;
  assert.ok(parsedFreeTextRequest);
  assert.throws(
    () =>
      parseDecisionConsultationAnswers(
        parsedFreeTextRequest.decisions.map((card) => ({
          decisionId: card.decisionId,
          response: {
            kind: "preference",
            optionId: null,
            text: "界".repeat(8_000)
          },
          note: null
        })),
        parsedFreeTextRequest
      ),
    /bounded answer/
  );

  const unicodeHeavyRequest = consultation({
    decisions: [0, 1, 2].map((index) =>
      consultationCard({
        decisionId: `unicode-${index}`,
        responseMode: "free_text",
        options: [],
        recommendation: null,
        evidence: Array.from({ length: 12 }, (_, evidenceIndex) => ({
          path: `docs/evidence-${index}-${evidenceIndex}.md`,
          line: 1,
          detail: "界".repeat(500)
        }))
      })
    )
  });
  assert.ok(JSON.stringify(unicodeHeavyRequest).length < 32 * 1024);
  assert.throws(
    () =>
      parsePhaseResult(
        phase({
          gate: "decision_consultation",
          decisionConsultation: unicodeHeavyRequest
        })
      ),
    /32 KiB/
  );
});

test("persisted hand-off readers reject removed versions without modifying input", () => {
  const current = phase({ phase: "fix", outcome: "blocked", gate: null });
  assert.deepEqual(
    parsePersistedPhaseResult(current),
    parsePhaseResult(current)
  );
  for (const schemaVersion of [undefined, 1, 2, 4]) {
    const value = { ...current, schemaVersion };
    const before = structuredClone(value);
    assert.throws(() => parsePersistedPhaseResult(value), {
      code: "RESOURCE_VERSION_UNSUPPORTED",
      message:
        /^.+ version .+ is not supported; 3\.x supports .+; last read by release-train major 2$/u
    });
    assert.deepEqual(value, before);
  }
  for (const schemaVersion of [undefined, 1, 3]) {
    const value = {
      schemaVersion,
      contractVersion: CONTRACT_VERSION,
      verdict: "pass"
    };
    const before = structuredClone(value);
    assert.throws(() => parseReviewResult(value), {
      code: "RESOURCE_VERSION_UNSUPPORTED",
      message:
        /^.+ version .+ is not supported; 3\.x supports .+; last read by release-train major 2$/u
    });
    assert.deepEqual(value, before);
  }
  for (const schemaVersion of [1, 3])
    assert.throws(() => parseVerificationLedger({ schemaVersion }), {
      code: "RESOURCE_VERSION_UNSUPPORTED",
      message:
        /^.+ version .+ is not supported; 3\.x supports .+; last read by release-train major 2$/u
    });
});

test("review results require stable unique findings and verdict consistency", () => {
  const finding = {
    id: "R1-F1",
    severity: "should_fix",
    category: "correctness",
    summary: "A real defect.",
    evidence: [{ path: "src/example.ts", line: 4, detail: "Wrong branch." }],
    violates: ["FR1"],
    reproduction: "Run the focused test.",
    fixAcceptance: "The branch returns the expected value.",
    confidence: "high"
  };
  const parsed = parseReviewResult({
    schemaVersion: 2,
    reviewNotes: [],
    scopeAcknowledgment: {
      schemaVersion: 1,
      snapshotDigest: "a".repeat(64),
      artifacts: [{ path: "plan.md", status: "reviewed", reason: null }]
    },
    contractVersion: CONTRACT_VERSION,
    verdict: "changes_requested",
    summary: "One finding.",
    findings: [finding],
    reviewedFindingIds: [],
    deferredCoverage: []
  });
  assert.equal(parsed.findings[0]?.id, "R1-F1");

  assert.throws(
    () =>
      parseReviewResult({
        schemaVersion: 2,
        reviewNotes: [],
        scopeAcknowledgment: {
          schemaVersion: 1,
          snapshotDigest: "a".repeat(64),
          artifacts: [{ path: "plan.md", status: "reviewed", reason: null }]
        },
        contractVersion: CONTRACT_VERSION,
        verdict: "pass",
        summary: "Contradiction.",
        findings: [finding],
        reviewedFindingIds: [],
        deferredCoverage: []
      }),
    /passing review cannot contain findings/
  );
});

test("evaluation state decoding keeps bounded provenance and rejects private or impossible strings", () => {
  const state = evaluationStateFixture({ reviewIteration: 1 });
  state.contractVersion = "PRIVATE CONTRACT CANARY";
  state.createdAt = "2026-02-30T00:00:00Z";
  state.updatedAt = "2026-07-01T24:00:00Z";
  const decoded = parseEvaluationStateSource(state);
  assert.deepEqual(decoded.value.contractVersion, {
    value: null,
    evidence: "invalid"
  });
  assert.equal(decoded.value.createdAt.evidence, "invalid");
  assert.equal(decoded.value.updatedAt.evidence, "invalid");
  assert.deepEqual(decoded.value.appliedReviewIteration, {
    value: 1,
    evidence: "observed"
  });
  assert.ok(
    decoded.issues.some(
      (issue) =>
        issue.code === "STATE_FIELD_INVALID" &&
        issue.field === "contractVersion"
    )
  );
  assert.doesNotMatch(JSON.stringify(decoded), /PRIVATE CONTRACT CANARY/);
});

test("evaluation state accepts only v5 and reports missing fields without inference", () => {
  for (const schemaVersion of [1, 2, 3, 4, 6]) {
    const input = evaluationStateFixture({ schemaVersion });
    const before = JSON.stringify(input);
    assert.throws(() => parseEvaluationStateSource(input), {
      code: "RESOURCE_VERSION_UNSUPPORTED",
      message:
        /^.+ version .+ is not supported; 3\.x supports .+; last read by release-train major 2$/u
    });
    assert.equal(JSON.stringify(input), before);
  }
  const input = evaluationStateFixture();
  delete input.workflowSelection;
  delete input.metrics;
  const result = parseEvaluationStateSource(input);
  assert.deepEqual(result.value.workflow, { value: null, evidence: "unknown" });
  assert.ok(result.issues.every((item) => item.code === "STATE_FIELD_MISSING"));
});

test("evaluation state decoding distinguishes null from malformed workflow selection", () => {
  const explicitNull = parseEvaluationStateSource(
    evaluationStateFixture({ extra: { workflowSelection: null } })
  );
  assert.deepEqual(explicitNull.value.workflow, {
    value: null,
    evidence: "unknown"
  });
  assert.equal(
    explicitNull.issues.some((item) => item.field === "workflowSelection"),
    false
  );

  const malformed = parseEvaluationStateSource(
    evaluationStateFixture({ extra: { workflowSelection: 42 } })
  );
  assert.deepEqual(malformed.value.workflow, {
    value: null,
    evidence: "invalid"
  });
  assert.deepEqual(
    malformed.issues.filter((item) => item.field === "workflowSelection"),
    [{ code: "STATE_FIELD_INVALID", field: "workflowSelection" }]
  );
});

test("evaluation attempt decoding exposes schema evidence and bounds all persisted strings", () => {
  const attempt = evaluationAttemptFixture({
    id: "PRIVATE-IDENTITY-CANARY",
    kind: "review"
  });
  attempt.startedAt = "2026-02-30T00:00:00Z";
  attempt.completedAt = "2026-02-30T00:00:01Z";
  (attempt.sessionContext as Record<string, unknown>).model =
    "PRIVATE MODEL CANARY";
  attempt.rotationReason = "PRIVATE ROTATION CANARY";
  const decoded = parseEvaluationAttemptSource(attempt);
  assert.deepEqual(decoded.value.schemaVersion, {
    value: 2,
    evidence: "observed"
  });
  assert.equal(decoded.value.startedAt.evidence, "invalid");
  assert.equal(decoded.value.completedAt.evidence, "invalid");
  assert.equal(decoded.value.model.model.evidence, "invalid");
  assert.equal(decoded.value.rotationReason.evidence, "invalid");
  const publicProjection = structuredClone(decoded.value) as unknown as Record<
    string,
    unknown
  >;
  delete publicProjection.identity;
  assert.doesNotMatch(JSON.stringify(publicProjection), /PRIVATE/);
});

test("evaluation attempt versions are rejected before numeric evidence is exposed", () => {
  const current = evaluationAttemptFixture({
    id: "attempt-1",
    kind: "implementation"
  });
  assert.deepEqual(parseEvaluationAttemptSource(current).value.schemaVersion, {
    value: 2,
    evidence: "observed"
  });
  for (const schemaVersion of [undefined, null, 1, 3, "2"]) {
    const input = { ...current, schemaVersion };
    const before = JSON.stringify(input);
    assert.throws(() => parseEvaluationAttemptSource(input), {
      code: "RESOURCE_VERSION_UNSUPPORTED",
      message:
        /^.+ version .+ is not supported; 3\.x supports .+; last read by release-train major 2$/u
    });
    assert.equal(JSON.stringify(input), before);
  }
});

test("evaluation review and event decoders retain only closed evidence", () => {
  const review = parseEvaluationReviewSource({
    schemaVersion: 2,
    verdict: "changes_requested",
    summary: "PRIVATE REVIEW SUMMARY",
    findings: [
      { severity: "blocker", evidence: "PRIVATE REVIEW EVIDENCE" },
      { severity: "nit", reproduction: "PRIVATE REVIEW REPRODUCTION" }
    ]
  });
  assert.deepEqual(review.value, {
    verdict: { value: "changes_requested", evidence: "observed" },
    findings: { blocker: 1, should_fix: 0, nit: 1 }
  });
  assert.deepEqual(
    parseEvaluationEventSource({
      type: "attempt.retry_requested",
      output: "PRIVATE EVENT OUTPUT"
    }),
    { type: "attempt.retry_requested" }
  );
  assert.deepEqual(
    parseEvaluationEventSource({
      type: "plan_task_completion.validation_failed",
      path: "PRIVATE REPOSITORY PATH",
      message: "PRIVATE MODEL OUTPUT"
    }),
    { type: "plan_task_completion.validation_failed" }
  );
  assert.deepEqual(
    parseEvaluationEventSource({
      type: "PRIVATE EVENT TYPE"
    }),
    { type: "other" }
  );
  assert.deepEqual(
    parseEvaluationEventSource({
      type: "decision.consultation.answered",
      details: {
        question: "PRIVATE CONSULTATION QUESTION",
        answer: "PRIVATE CONSULTATION ANSWER"
      }
    }),
    { type: "other" }
  );
  assert.doesNotMatch(JSON.stringify(review), /PRIVATE/);
});

test("one strict RFC3339 validator normalizes valid offsets and rejects impossible instants", () => {
  assert.equal(
    normalizeRfc3339Instant("2026-07-01T03:00:00+03:00"),
    "2026-07-01T00:00:00.000Z"
  );
  for (const invalid of [
    "2026-02-30T00:00:00Z",
    "2025-02-29T00:00:00Z",
    "2026-13-01T00:00:00Z",
    "2026-01-01T24:00:00Z",
    "2026-01-01T00:60:00Z",
    "2026-01-01T00:00:60Z",
    "2026-01-01T00:00:00+24:00",
    "2026-01-01"
  ]) {
    assert.equal(normalizeRfc3339Instant(invalid), undefined);
  }
});

test("verification ledger decoding accepts bounded lifecycle evidence and rejects raw result fields", () => {
  assert.deepEqual(parseVerificationLedger({ schemaVersion: 2 }), {
    schemaVersion: 2
  });
  const completed = verificationAttemptFixture({ sequence: 1 });
  assert.deepEqual(parseVerificationAttemptRecord(completed), completed);
  const interrupted = verificationAttemptFixture({
    sequence: 2,
    status: "interrupted",
    restartOf: completed.id
  });
  assert.equal(
    parseVerificationAttemptRecord(interrupted).status,
    "interrupted"
  );
  assert.throws(
    () =>
      parseVerificationAttemptRecord({
        ...completed,
        stdoutRaw: "sk-ant-forbidden-secret"
      }),
    (error: unknown) =>
      error instanceof Error &&
      !error.message.includes("forbidden-secret") &&
      !error.message.includes("sk-ant")
  );
  assert.throws(() =>
    parseVerificationAttemptRecord({
      ...completed,
      sequence: 2,
      completedAt: "2026-07-01T00:00:00.000Z"
    })
  );
});

function terminalCheckpoint(): TerminalAttemptCheckpoint {
  const checkpoint: Omit<TerminalAttemptCheckpoint, "integrityDigest"> = {
    schema: TERMINAL_CHECKPOINT_SCHEMA,
    schemaVersion: TERMINAL_CHECKPOINT_SCHEMA_VERSION,
    runId: "run-one",
    attempt: { id: "fix-1-abcd1234", kind: "fix", mutable: true },
    phase: "fix",
    configuration: {
      vendor: "claude",
      executableDigest: "a".repeat(64),
      model: "claude-sonnet-5",
      effort: "high",
      sessionMode: "resumed",
      sessionContextDigest: "b".repeat(64)
    },
    resultContract: "phase-result/v3",
    terminal: {
      classification: "claude_result",
      observedAt: "2026-08-18T13:23:43.000Z"
    },
    result: parsePhaseResult(
      phase({
        phase: "fix",
        outcome: "completed",
        gate: null,
        summary: "Accepted findings fixed."
      })
    ),
    sessionId: "session-one",
    usage: {
      inputTokens: 10,
      cachedInputTokens: 2,
      outputTokens: 3,
      costUsd: null
    },
    baseCommit: "c".repeat(40),
    approvalDigest: "d".repeat(64),
    workflowDigest: null,
    scopeDigest: "e".repeat(64)
  };
  return {
    ...checkpoint,
    integrityDigest: terminalCheckpointIntegrity(checkpoint)
  };
}

test("terminal checkpoint validation binds exact evidence and integrity", () => {
  const checkpoint = terminalCheckpoint();
  assert.deepEqual(parseTerminalAttemptCheckpoint(checkpoint), checkpoint);
  assert.equal(
    digestCanonicalJson({ b: 2, a: 1 }),
    digestCanonicalJson({ a: 1, b: 2 })
  );
  assert.throws(
    () =>
      parseTerminalAttemptCheckpoint({
        ...checkpoint,
        resultContract: "review-result/v1"
      }),
    (error: unknown) =>
      error instanceof BanzaiError &&
      error.code === "RESOURCE_VERSION_UNSUPPORTED" &&
      /^.+ version .+ is not supported; 3\.x supports .+; last read by release-train major 2$/u.test(
        error.message
      )
  );
  assert.throws(
    () =>
      parseTerminalAttemptCheckpoint({
        ...checkpoint,
        prompt: "forbidden"
      }),
    (error: unknown) =>
      error instanceof BanzaiError &&
      error.code === "INVALID_TERMINAL_CHECKPOINT" &&
      !error.message.includes("forbidden")
  );
});

test("recovery authorization is closed and requires exact acknowledgment", () => {
  const authorization = {
    schema: RECOVERY_AUTHORIZATION_SCHEMA,
    schemaVersion: RECOVERY_AUTHORIZATION_SCHEMA_VERSION,
    authorizationId: "recovery-abcd1234",
    runId: "run-one",
    attempt: { id: "fix-1-abcd1234", kind: "fix", mutable: true },
    phase: "fix",
    recoveryIdentity: "a".repeat(64),
    workspaceDigest: "b".repeat(64),
    baseCommit: "c".repeat(40),
    approvalDigest: "d".repeat(64),
    workflowDigest: null,
    scopeDigest: "e".repeat(64),
    configurationDigest: "f".repeat(64),
    decidedBy: "operator",
    decidedAt: "2026-08-18T14:00:00.000Z",
    unknownSideEffectsAccepted: true as const
  };
  assert.deepEqual(parseRecoveryAuthorization(authorization), authorization);
  assert.throws(() =>
    parseRecoveryAuthorization({
      ...authorization,
      unknownSideEffectsAccepted: false
    })
  );
  assert.throws(() =>
    parseRecoveryAuthorization({ ...authorization, note: "trust me" })
  );
  assert.equal(
    parseRecoveryAuthorization({
      ...authorization,
      decidedAt: "2026-08-18T17:00:00+03:00"
    }).decidedAt,
    "2026-08-18T14:00:00.000Z"
  );
  for (const decidedAt of [
    "2026-08-18",
    "2026-02-30T14:00:00Z",
    "2026-08-18T14:00:00+24:00"
  ]) {
    assert.throws(() =>
      parseRecoveryAuthorization({ ...authorization, decidedAt })
    );
  }
  for (const unsafe of ["../escape", "/absolute", "two/parts", "..", "é"])
    assert.throws(() =>
      parseRecoveryAuthorization({
        ...authorization,
        authorizationId: unsafe
      })
    );
  assert.throws(() =>
    parseRecoveryAuthorization({
      ...authorization,
      runId: `run-${"a".repeat(300)}`
    })
  );
});

test("attempt v2 closes interrupted work without completion claims", () => {
  const attempt = {
    schemaVersion: MODEL_ATTEMPT_SCHEMA_VERSION,
    attempt: {
      id: "implementation-1-abcd1234",
      kind: "implementation",
      mutable: true
    },
    status: "interrupted",
    startedAt: "2026-08-18T13:00:00.000Z",
    completedAt: null,
    interruptedAt: "2026-08-18T13:05:00.000Z",
    recoveryOf: null,
    recoveryAuthorizationId: null,
    result: null,
    sessionId: null,
    rawStdoutPath: null,
    rawStderrPath: null,
    durationMs: null,
    usage: null,
    error: null
  } as const;
  assert.deepEqual(parseModelAttemptRecord(attempt), attempt);
  assert.throws(() =>
    parseModelAttemptRecord({ ...attempt, completedAt: attempt.interruptedAt })
  );
  assert.throws(() =>
    parseModelAttemptRecord({
      ...attempt,
      attempt: { ...attempt.attempt, id: "../attempt" }
    })
  );
  assert.throws(() =>
    parseModelAttemptRecord({
      ...attempt,
      recoveryOf: "source/attempt",
      recoveryAuthorizationId: "recovery-safe"
    })
  );
});

test("planning retry cache metadata is bounded and cannot authorize another phase", () => {
  const context = {
    invocationDigest: "a".repeat(64),
    workspaceDigest: "b".repeat(64),
    artifactPaths: ["documentation/features/example/description.md"],
    retryOf: "plan-1"
  };
  const record = {
    schemaVersion: MODEL_ATTEMPT_SCHEMA_VERSION,
    attempt: { id: "plan-2", kind: "plan", mutable: false },
    status: "failed",
    startedAt: "2026-09-02T12:00:00.000Z",
    completedAt: "2026-09-02T12:01:00.000Z",
    interruptedAt: null,
    recoveryOf: null,
    recoveryAuthorizationId: null,
    sessionId: "planner-session",
    planningContext: context
  };
  assert.deepEqual(parseModelAttemptRecord(record), record);
  for (const invalidContext of [
    { ...context, workspaceDigest: "invalid" },
    { ...context, retryOf: "plan-2" },
    { ...context, artifactPaths: ["src/source.ts"] },
    { ...context, artifactPaths: ["documentation/../secret"] },
    {
      ...context,
      artifactPaths: Array<string>(129).fill("PROJECT_MANIFEST.md")
    },
    { ...context, approved: true }
  ])
    assert.throws(() =>
      parseModelAttemptRecord({ ...record, planningContext: invalidContext })
    );
  assert.throws(() =>
    parseModelAttemptRecord({
      ...record,
      attempt: { ...record.attempt, kind: "implementation", mutable: true }
    })
  );
  assert.throws(() =>
    parseModelAttemptRecord({ ...record, sessionId: "--last" })
  );
});
