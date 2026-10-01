import assert from "node:assert/strict";
import { appendFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { FALLBACK_VENDOR, vendorFor } from "../../../src/models.js";
import type {
  AttemptRecord,
  AttemptReference,
  CompletionObservedInputs,
  CompletionPublicationRefusalCode,
  ModelSettings,
  OrchestratorConfig,
  PhaseResultEnvelope,
  RunState,
  TerminalAttemptCheckpointV2
} from "../../../src/types.js";
import { digestCanonicalJson } from "../../../src/validation.js";
import {
  captureCompletionInput,
  transitionToCompletionState
} from "../../../src/workflow/completion/capture.js";
import { observeCompletionInputs } from "../../../src/workflow/completion/inputs.js";
import { continueCompletionPublication } from "../../../src/workflow/completion/publication.js";
import { sessionContext } from "../../../src/workflow/domain/sessions.js";
import { createTestRepository } from "../../helpers.js";
import { recordingContext } from "../context-fixture.js";

const SETTINGS: ModelSettings = {
  executable: "codex",
  model: "model",
  effort: "high",
  timeoutMs: 1000
};
const CONFIG = {
  models: { planner: SETTINGS, implementer: SETTINGS, reviewer: SETTINGS }
} as unknown as OrchestratorConfig;
const ATTEMPT = {
  id: "implementation-1-abcdef12",
  kind: "implementation",
  mutable: true
} as const satisfies AttemptReference;
const REPORT = "implementation-report.md";
const ENVELOPE = {
  artifacts: { implementationReport: REPORT, testReport: null }
} as unknown as PhaseResultEnvelope;
const ABSENT_REPORT_INPUTS: CompletionObservedInputs = {
  implementationReport: { path: REPORT, state: "absent" },
  testReport: { path: null, state: "absent" },
  workspaceDigest: "e".repeat(64)
};
const REMEDY = {
  unobserved:
    "The exact terminal input observation is unavailable; cancel the run unless intact proof can be reproduced by a corrected runner.",
  unprovenWorkspace:
    "The terminal checkpoint did not prove the non-report workspace identity; cancel the run unless intact proof can be reproduced by a corrected runner.",
  authority:
    "The implementer configuration or session context changed after the model returned. Restore the exact recorded authority, then run banzai resume; otherwise cancel.",
  input:
    "A required report or the non-report workspace changed after the model returned. Restore the exact recorded input and matching authority, then run banzai resume; otherwise cancel."
} as const;

function runState(): RunState {
  return {
    runId: "run-1",
    schemaVersion: 8,
    status: "implementing",
    baseCommit: "b".repeat(40),
    planApproval: { digest: "a".repeat(64) },
    completionPublication: null,
    activeProcess: null
  } as unknown as RunState;
}

function attemptRecord(overrides: Partial<AttemptRecord> = {}): AttemptRecord {
  return {
    attempt: ATTEMPT,
    status: "started",
    sessionMode: "fresh",
    envelope: ENVELOPE,
    ...overrides
  } as unknown as AttemptRecord;
}

function recordedConfiguration(
  settings: ModelSettings = SETTINGS
): TerminalAttemptCheckpointV2["configuration"] {
  return {
    vendor: vendorFor(settings.executable) ?? FALLBACK_VENDOR.implementer,
    executableDigest: digestCanonicalJson(settings.executable),
    model: settings.model,
    effort: settings.effort,
    sessionMode: "fresh",
    sessionContextDigest: digestCanonicalJson(
      sessionContext("implementer", settings)
    )
  };
}

function terminalCheckpoint(
  integrityDigest: string,
  overrides: Partial<TerminalAttemptCheckpointV2> = {}
): TerminalAttemptCheckpointV2 {
  return {
    envelope: ENVELOPE,
    integrityDigest,
    observed: ABSENT_REPORT_INPUTS,
    configuration: recordedConfiguration(),
    terminal: {
      classification: "codex_turn_completed",
      observedAt: "2026-07-01T00:00:00.000Z"
    },
    ...overrides
  } as unknown as TerminalAttemptCheckpointV2;
}

function captureRefusal(
  code: CompletionPublicationRefusalCode,
  proofDigest: string | null,
  remedy: string
): Record<string, unknown> {
  return {
    name: "CompletionRefusal",
    message: `${code} at capture`,
    code,
    stage: "capture",
    proofDigest,
    remedy
  };
}

function capture(
  context: ReturnType<typeof recordingContext>["context"],
  record: AttemptRecord = attemptRecord()
): Promise<unknown> {
  return captureCompletionInput(
    context,
    runState(),
    record,
    ENVELOPE,
    CONFIG,
    "completed"
  );
}

test("a legacy v5 run cannot host a completion attempt and stays untouched", async () => {
  for (const attempt of [
    ATTEMPT,
    { id: "fix-1-abcdef12", kind: "fix", mutable: true } as const
  ]) {
    const { context, calls } = recordingContext({});
    const state = { schemaVersion: 5, runId: "run-1" } as unknown as RunState;
    await assert.rejects(transitionToCompletionState(context, state, attempt), {
      name: "BanzaiError",
      code: "COMPLETION_STATE_UNSUPPORTED",
      message:
        "Run state v5 cannot host a runner-owned completion attempt. Cancel this run and start a new one."
    });
    // No prior state bytes are read and no transition evidence is written.
    assert.deepEqual(calls, []);
    assert.deepEqual(state, { schemaVersion: 5, runId: "run-1" });
  }
});

test("capture refuses as an integrity failure when no terminal input observation exists", async () => {
  for (const [checkpoint, proofDigest] of [
    [null, null],
    // A legacy checkpoint proves a result but never the decoded envelope.
    [
      {
        integrityDigest: "b".repeat(64),
        result: {},
        configuration: recordedConfiguration()
      },
      "b".repeat(64)
    ]
  ] as const) {
    const { context, calls } = recordingContext({
      readTerminalCheckpointIfExists: () => Promise.resolve(checkpoint)
    });
    await assert.rejects(
      capture(context),
      captureRefusal(
        "COMPLETION_PUBLICATION_INTEGRITY",
        proofDigest,
        REMEDY.unobserved
      )
    );
    assert.deepEqual(calls, ["readTerminalCheckpointIfExists"]);
  }
});

test("capture refuses a terminal checkpoint that did not prove the workspace identity", async () => {
  const { context, calls } = recordingContext({
    readTerminalCheckpointIfExists: () =>
      Promise.resolve(
        terminalCheckpoint("c".repeat(64), {
          observed: { ...ABSENT_REPORT_INPUTS, workspaceDigest: null }
        })
      )
  });
  await assert.rejects(
    capture(context),
    captureRefusal(
      "COMPLETION_PUBLICATION_INTEGRITY",
      "c".repeat(64),
      REMEDY.unprovenWorkspace
    )
  );
  assert.deepEqual(calls, ["readTerminalCheckpointIfExists"]);
});

test("capture refuses implementer authority that changed after the model returned", async () => {
  for (const [checkpoint, record] of [
    [
      terminalCheckpoint("d".repeat(64), {
        configuration: recordedConfiguration({
          ...SETTINGS,
          model: "other-model"
        })
      }),
      attemptRecord()
    ],
    [
      terminalCheckpoint("d".repeat(64)),
      attemptRecord({
        sessionContext: sessionContext("implementer", {
          ...SETTINGS,
          effort: "low"
        })
      })
    ]
  ] as const) {
    const { context, calls } = recordingContext({
      readTerminalCheckpointIfExists: () => Promise.resolve(checkpoint)
    });
    await assert.rejects(
      capture(context, record),
      captureRefusal(
        "COMPLETION_PUBLICATION_DRIFT",
        "d".repeat(64),
        REMEDY.authority
      )
    );
    assert.deepEqual(calls, ["readTerminalCheckpointIfExists"]);
  }

  // The unchanged authority passes the check and continues to the transition.
  const stop = new Error("stop after the authority check");
  const { context, calls } = recordingContext({
    readTerminalCheckpointIfExists: () =>
      Promise.resolve(terminalCheckpoint("d".repeat(64))),
    readCompletionTransitionIfExists: () => Promise.reject(stop)
  });
  await assert.rejects(capture(context), (error) => error === stop);
  assert.deepEqual(calls, [
    "readTerminalCheckpointIfExists",
    "readCompletionTransitionIfExists"
  ]);
});

for (const [changed, change] of [
  [
    "a required report",
    (root: string) => appendFile(path.join(root, REPORT), "Late edit.\n")
  ],
  [
    "the non-report workspace",
    (root: string) => writeFile(path.join(root, "base.txt"), "changed\n")
  ]
] as const) {
  test(`capture refuses ${changed} changed after the model returned and writes no original`, async () => {
    const repository = await createTestRepository();
    try {
      await writeFile(path.join(repository.root, REPORT), "# Report\n");
      const { observed } = await observeCompletionInputs(
        recordingContext({}, repository.root).context,
        runState(),
        ENVELOPE.artifacts
      );
      const checkpoint = terminalCheckpoint("f".repeat(64), { observed });

      // The exact terminal input passes and would retain the report original.
      const stop = new Error("stop at the first original");
      const exact = recordingContext(
        {
          readTerminalCheckpointIfExists: () => Promise.resolve(checkpoint),
          readCompletionTransitionIfExists: () => Promise.resolve(null),
          writeCompletionOriginal: () => Promise.reject(stop)
        },
        repository.root
      );
      await assert.rejects(capture(exact.context), (error) => error === stop);
      assert.deepEqual(exact.calls, [
        "readTerminalCheckpointIfExists",
        "readCompletionTransitionIfExists",
        "writeCompletionOriginal"
      ]);

      await change(repository.root);
      const { context, calls } = recordingContext(
        {
          readTerminalCheckpointIfExists: () => Promise.resolve(checkpoint),
          readCompletionTransitionIfExists: () => Promise.resolve(null)
        },
        repository.root
      );
      await assert.rejects(
        capture(context),
        captureRefusal(
          "COMPLETION_PUBLICATION_DRIFT",
          "f".repeat(64),
          REMEDY.input
        )
      );
      assert.deepEqual(calls, [
        "readTerminalCheckpointIfExists",
        "readCompletionTransitionIfExists"
      ]);
    } finally {
      await repository.dispose();
    }
  });
}

for (const [refused, checkpoint, code, proofDigest, remedy] of [
  [
    "a missing terminal observation",
    null,
    "COMPLETION_PUBLICATION_INTEGRITY",
    null,
    REMEDY.unobserved
  ],
  [
    "an unproven workspace identity",
    terminalCheckpoint("c".repeat(64), {
      observed: { ...ABSENT_REPORT_INPUTS, workspaceDigest: null }
    }),
    "COMPLETION_PUBLICATION_INTEGRITY",
    "c".repeat(64),
    REMEDY.unprovenWorkspace
  ],
  [
    "changed implementer authority",
    terminalCheckpoint("d".repeat(64), {
      configuration: recordedConfiguration({
        ...SETTINGS,
        model: "other-model"
      })
    }),
    "COMPLETION_PUBLICATION_DRIFT",
    "d".repeat(64),
    REMEDY.authority
  ],
  // The default fixture root is no repository, so the recorded workspace
  // identity can no longer be observed.
  [
    "changed terminal input",
    terminalCheckpoint("f".repeat(64)),
    "COMPLETION_PUBLICATION_DRIFT",
    "f".repeat(64),
    REMEDY.input
  ]
] as const) {
  test(`a capture refusal for ${refused} blocks the run with its class, stage, proof and remedy`, async () => {
    const records: AttemptRecord[] = [];
    const states: RunState[] = [];
    const events: unknown[] = [];
    const { context, calls } = recordingContext({
      readCompletionCaptureIfExists: () => Promise.resolve(null),
      readCompletionCandidateIfExists: () => Promise.resolve(null),
      readCompletionPublicationIfExists: () => Promise.resolve(null),
      readTerminalCheckpointIfExists: () => Promise.resolve(checkpoint),
      readCompletionTransitionIfExists: () => Promise.resolve(null),
      writeRunAttempt: (_runId: string, record: AttemptRecord) => {
        records.push(structuredClone(record));
        return Promise.resolve();
      },
      readState: () => Promise.resolve({ status: "implementing" }),
      writeState: (state: RunState) => {
        states.push(structuredClone(state));
        return Promise.resolve();
      },
      appendEventOnce: (_runId: string, type: string, payload: unknown) => {
        events.push({ type, payload });
        return Promise.resolve();
      }
    });
    const state = runState();
    const result = await continueCompletionPublication(
      context,
      state,
      attemptRecord(),
      CONFIG
    );

    assert.deepEqual(result, { kind: "stopped", state });
    assert.equal(state.status, "blocked");
    assert.equal(state.blockedFrom, "implementing");
    assert.equal(
      state.blockReason,
      `[${code}] Completion publication for implementation attempt ${ATTEMPT.id} stopped at stage capture. ${remedy}`
    );
    assert.deepEqual(state.completionPublication, {
      attemptId: ATTEMPT.id,
      attemptKind: "implementation",
      stage: "capture",
      captureDigest: null,
      candidateDigest: null,
      receiptDigest: null,
      refusal: { code, stage: "capture", proofDigest }
    });
    assert.deepEqual(states, [state]);
    assert.deepEqual(
      records.map((record) => record.status),
      ["pending_application"]
    );
    assert.deepEqual(events, [
      {
        type: "completion.publication_refused",
        payload: {
          attemptId: ATTEMPT.id,
          attemptKind: "implementation",
          stage: "capture",
          proofDigest,
          code,
          violation: null,
          taskId: null
        }
      }
    ]);
    // An original, capture or cursor write is unstubbed, so it would have
    // surfaced as a different refusal; only the refusal itself is persisted.
    assert.deepEqual(
      calls.filter((name) => !name.startsWith("read")),
      ["writeRunAttempt", "writeState", "appendEventOnce"]
    );
  });
}
