import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { BanzaiError, TerminalRunStateError } from "../../../src/errors.js";
import { workspaceSnapshot } from "../../../src/git.js";
import type { ValidatedCompletionClaims } from "../../../src/plan-task-completion.js";
import type { RunEvent } from "../../../src/store.js";
import {
  type AttemptRecord,
  type AttemptReference,
  COMPLETION_PROTOCOL,
  COMPLETION_SUMMARY_SCHEMA_VERSION,
  type CompletionCandidate,
  type CompletionCapture,
  type CompletionPublication,
  type CompletionPublicationCursor,
  type OrchestratorConfig,
  type PhaseResultEnvelope,
  type PlanTaskCompletionLedger,
  type RunState
} from "../../../src/types.js";
import { completionRecordIntegrity } from "../../../src/validation.js";
import { WorkflowRunner } from "../../../src/workflow.js";
import {
  applyCompletionPublication,
  completionLedgerFor,
  continueCompletionPublication,
  storeCursor
} from "../../../src/workflow/completion/publication.js";
import { CompletionRefusal } from "../../../src/workflow/completion/refusal.js";
import type { RunnerSources } from "../../../src/workflow/ports.js";
import { createTestRepository } from "../../helpers.js";
import {
  FakeAdapters,
  completionLedger,
  passingReview
} from "../../workflow-fixtures.js";
import { recordingContext } from "../context-fixture.js";

const ATTEMPT = {
  id: "implementation-1-abcdef12",
  kind: "implementation",
  mutable: true
} as const satisfies AttemptReference;
const IO_REMEDY =
  "Retry with banzai resume once storage is available, or cancel.";
const CONFIG = {} as OrchestratorConfig;
const IMPLEMENTATION_REPORT =
  "documentation/features/example/implementation-report.md";
const TEST_REPORT = "documentation/features/example/test-report.md";

function refusal(
  code: CompletionRefusal["code"],
  stage: CompletionRefusal["stage"],
  proofDigest: string | null,
  remedy: string
): (error: unknown) => boolean {
  return (error) => {
    assert.ok(error instanceof CompletionRefusal);
    assert.deepEqual(
      {
        code: error.code,
        stage: error.stage,
        proofDigest: error.proofDigest,
        remedy: error.remedy,
        message: error.message
      },
      { code, stage, proofDigest, remedy, message: `${code} at ${stage}` }
    );
    return true;
  };
}

function cursor(
  overrides: Partial<CompletionPublicationCursor> = {}
): CompletionPublicationCursor {
  return {
    attemptId: ATTEMPT.id,
    attemptKind: "implementation",
    stage: "capture",
    captureDigest: null,
    candidateDigest: null,
    receiptDigest: null,
    refusal: null,
    ...overrides
  };
}

function implementingState(
  completionPublication: CompletionPublicationCursor | null = null
): RunState {
  return {
    runId: "run-1",
    status: "implementing",
    blockedFrom: null,
    blockReason: null,
    activeProcess: {},
    completionPublication
  } as unknown as RunState;
}

function pendingRecord(envelope: unknown = {}): AttemptRecord {
  return {
    attempt: ATTEMPT,
    status: "pending_application",
    envelope
  } as unknown as AttemptRecord;
}

/** The store a publication refusal persists through, keeping each written state. */
function refusalStore() {
  const states: RunState[] = [];
  const events: [string, string, Record<string, unknown>][] = [];
  return {
    states,
    events,
    methods: {
      readState: () =>
        Promise.resolve({ status: "implementing" } as unknown as RunState),
      writeState: (state: RunState) => {
        states.push(structuredClone(state));
        return Promise.resolve();
      },
      appendEventOnce: (
        runId: string,
        type: string,
        details: Record<string, unknown>
      ) => {
        events.push([runId, type, details]);
        return Promise.resolve({} as RunEvent);
      }
    }
  };
}

function assertPersistedRefusal(
  store: ReturnType<typeof refusalStore>,
  expected: {
    blockReason: string;
    cursor: CompletionPublicationCursor;
  }
): void {
  const refused = expected.cursor.refusal;
  assert.ok(refused);
  assert.equal(store.states.length, 1);
  const persisted = store.states[0];
  assert.deepEqual(
    {
      status: persisted?.status,
      blockedFrom: persisted?.blockedFrom,
      blockReason: persisted?.blockReason,
      activeProcess: persisted?.activeProcess,
      completionPublication: persisted?.completionPublication
    },
    {
      status: "blocked",
      blockedFrom: "implementing",
      blockReason: expected.blockReason,
      activeProcess: null,
      completionPublication: expected.cursor
    }
  );
  assert.deepEqual(store.events, [
    [
      "run-1",
      "completion.publication_refused",
      {
        attemptId: ATTEMPT.id,
        attemptKind: "implementation",
        stage: refused.stage,
        proofDigest: refused.proofDigest,
        code: refused.code,
        violation: null,
        taskId: null
      }
    ]
  ]);
}

test("a failed cursor write is a publication i/o refusal naming the latest durable proof", async () => {
  const cases = [
    {
      digests: {
        captureDigest: "a".repeat(64),
        candidateDigest: "b".repeat(64),
        receiptDigest: "c".repeat(64)
      },
      proof: "c".repeat(64)
    },
    {
      digests: {
        captureDigest: "a".repeat(64),
        candidateDigest: "b".repeat(64),
        receiptDigest: null
      },
      proof: "b".repeat(64)
    },
    {
      digests: {
        captureDigest: "a".repeat(64),
        candidateDigest: null,
        receiptDigest: null
      },
      proof: "a".repeat(64)
    }
  ];
  for (const { digests, proof } of cases) {
    const { context, calls } = recordingContext({
      writeState: () => Promise.reject(new Error("EIO: injected"))
    });
    const state = implementingState();
    const next = cursor({ stage: "candidate", ...digests });
    await assert.rejects(
      storeCursor(context, state, next),
      refusal("COMPLETION_PUBLICATION_IO", "candidate", proof, IO_REMEDY)
    );
    assert.equal(state.completionPublication, next);
    assert.deepEqual(calls, ["writeState"]);
  }
});

test("a terminal run during a cursor write stops publication without a refusal", async () => {
  const state = implementingState();
  const terminal = new TerminalRunStateError(state);
  const { context, calls } = recordingContext({
    writeState: () => Promise.reject(terminal)
  });
  await assert.rejects(
    storeCursor(context, state, cursor({ captureDigest: "a".repeat(64) })),
    (error) => error === terminal
  );
  assert.deepEqual(calls, ["writeState"]);
});

test("a failed capture cursor write blocks the attempt with a resumable i/o refusal at capture", async () => {
  const store = refusalStore();
  let writes = 0;
  const { context, calls } = recordingContext({
    ...store.methods,
    readCompletionCaptureIfExists: () =>
      Promise.resolve({ integrityDigest: "a".repeat(64) }),
    writeState: (state: RunState) => {
      writes += 1;
      if (writes === 1) return Promise.reject(new Error("EIO: injected"));
      return store.methods.writeState(state);
    }
  });
  const state = implementingState();
  const outcome = await continueCompletionPublication(
    context,
    state,
    pendingRecord(),
    CONFIG
  );
  assert.ok(outcome.kind === "stopped" && outcome.state === state);
  assertPersistedRefusal(store, {
    blockReason:
      "[COMPLETION_PUBLICATION_IO] Completion publication for implementation attempt implementation-1-abcdef12 stopped at stage capture. Retry with banzai resume once storage is available, or cancel.",
    cursor: cursor({
      stage: "capture",
      captureDigest: "a".repeat(64),
      refusal: {
        code: "COMPLETION_PUBLICATION_IO",
        stage: "capture",
        proofDigest: "a".repeat(64)
      }
    })
  });
  assert.deepEqual(calls, [
    "readCompletionCaptureIfExists",
    "writeState",
    "readState",
    "writeState",
    "appendEventOnce"
  ]);
});

test("a captured ledger identity that differs from the accepted ledger is an integrity refusal at validation", async () => {
  const ledger = completionLedger(["T001"]) as PlanTaskCompletionLedger;
  const capture = {
    integrityDigest: "a".repeat(64),
    ledgerSource: {
      attemptId: ATTEMPT.id,
      attemptKind: "implementation",
      ledgerDigest: "0".repeat(64)
    }
  } as unknown as CompletionCapture;
  for (const accepted of [ledger, null]) {
    const { context, calls } = recordingContext({});
    await assert.rejects(
      completionLedgerFor(
        context,
        { runId: "run-1" } as RunState,
        pendingRecord(),
        {
          taskCompletion: { state: "accepted", ledger: accepted }
        } as unknown as PhaseResultEnvelope,
        capture
      ),
      refusal(
        "COMPLETION_PUBLICATION_INTEGRITY",
        "validate",
        "a".repeat(64),
        "The captured ledger does not match its recorded identity."
      )
    );
    assert.deepEqual(calls, []);
  }
});

test("a pending attempt without its envelope is refused as integrity before any evidence is read", async () => {
  const store = refusalStore();
  const { context, calls } = recordingContext(store.methods);
  const state = implementingState();
  const outcome = await continueCompletionPublication(
    context,
    state,
    pendingRecord(null),
    CONFIG
  );
  assert.ok(outcome.kind === "stopped" && outcome.state === state);
  assertPersistedRefusal(store, {
    blockReason:
      "[COMPLETION_PUBLICATION_INTEGRITY] Completion publication for implementation attempt implementation-1-abcdef12 stopped at stage capture. The captured envelope is missing; cancel the run.",
    cursor: cursor({
      refusal: {
        code: "COMPLETION_PUBLICATION_INTEGRITY",
        stage: "capture",
        proofDigest: null
      }
    })
  });
  assert.deepEqual(calls, ["readState", "writeState", "appendEventOnce"]);
});

test("later publication evidence without its capture manifest is an integrity refusal naming the retained proof", async () => {
  const cases = [
    { receipt: null, proof: "c".repeat(64) },
    { receipt: { captureDigest: "d".repeat(64) }, proof: "d".repeat(64) }
  ];
  for (const { receipt, proof } of cases) {
    const store = refusalStore();
    const { context, calls } = recordingContext({
      ...store.methods,
      readCompletionCaptureIfExists: () => Promise.resolve(null),
      readCompletionCandidateIfExists: () =>
        Promise.resolve({
          candidate: { captureDigest: "c".repeat(64) },
          bytes: Buffer.alloc(0)
        }),
      readCompletionPublicationIfExists: () => Promise.resolve(receipt)
    });
    const state = implementingState(
      cursor({
        stage: "candidate",
        captureDigest: "c".repeat(64),
        candidateDigest: "e".repeat(64)
      })
    );
    const outcome = await continueCompletionPublication(
      context,
      state,
      pendingRecord(),
      CONFIG
    );
    assert.ok(outcome.kind === "stopped" && outcome.state === state);
    assertPersistedRefusal(store, {
      blockReason:
        "[COMPLETION_PUBLICATION_INTEGRITY] Completion publication for implementation attempt implementation-1-abcdef12 stopped at stage capture. Later publication evidence exists without its capture manifest; cancel the run unless intact proof can be reproduced by a corrected runner.",
      cursor: cursor({
        stage: "capture",
        captureDigest: "c".repeat(64),
        candidateDigest: "e".repeat(64),
        refusal: {
          code: "COMPLETION_PUBLICATION_INTEGRITY",
          stage: "capture",
          proofDigest: proof
        }
      })
    });
    // No terminal checkpoint read: a fresh capture was never attempted.
    assert.deepEqual(calls, [
      "readCompletionCaptureIfExists",
      "readCompletionCandidateIfExists",
      "readCompletionPublicationIfExists",
      "readState",
      "writeState",
      "appendEventOnce"
    ]);
  }
});

test("corrupt or conflicting retained capture evidence is an integrity refusal without raw error text", async () => {
  for (const code of [
    "INVALID_COMPLETION_CAPTURE",
    "COMPLETION_CAPTURE_CONFLICT"
  ]) {
    const store = refusalStore();
    const { context, calls } = recordingContext({
      ...store.methods,
      readCompletionCaptureIfExists: () =>
        Promise.reject(
          new BanzaiError(code, "Completion capture integrity mismatch.")
        )
    });
    const state = implementingState();
    const outcome = await continueCompletionPublication(
      context,
      state,
      pendingRecord(),
      CONFIG
    );
    assert.ok(outcome.kind === "stopped" && outcome.state === state);
    assertPersistedRefusal(store, {
      blockReason:
        "[COMPLETION_PUBLICATION_INTEGRITY] Completion publication for implementation attempt implementation-1-abcdef12 stopped at stage capture. Retained capture evidence is corrupt or conflicts with the recorded input; cancel the run.",
      cursor: cursor({
        refusal: {
          code: "COMPLETION_PUBLICATION_INTEGRITY",
          stage: "capture",
          proofDigest: null
        }
      })
    });
    assert.deepEqual(calls, [
      "readCompletionCaptureIfExists",
      "readState",
      "writeState",
      "appendEventOnce"
    ]);
  }
});

test("an ordinary capture read failure is a resumable i/o refusal at capture", async () => {
  const store = refusalStore();
  const { context, calls } = recordingContext({
    ...store.methods,
    readCompletionCaptureIfExists: () =>
      Promise.reject(new Error("EIO: injected capture read failure"))
  });
  const state = implementingState();
  const outcome = await continueCompletionPublication(
    context,
    state,
    pendingRecord(),
    CONFIG
  );
  assert.ok(outcome.kind === "stopped" && outcome.state === state);
  assertPersistedRefusal(store, {
    blockReason:
      "[COMPLETION_PUBLICATION_IO] Completion publication for implementation attempt implementation-1-abcdef12 stopped at stage capture. Retry with banzai resume once storage is available, or cancel.",
    cursor: cursor({
      refusal: {
        code: "COMPLETION_PUBLICATION_IO",
        stage: "capture",
        proofDigest: null
      }
    })
  });
  assert.deepEqual(calls, [
    "readCompletionCaptureIfExists",
    "readState",
    "writeState",
    "appendEventOnce"
  ]);
});

test("an implementation report that no longer equals its capture is a drift refusal at publication", async () => {
  const store = refusalStore();
  const capture = {
    integrityDigest: "a".repeat(64),
    reports: {
      implementationReport: {
        path: IMPLEMENTATION_REPORT,
        state: "present",
        sha256: "1".repeat(64),
        bytes: 1
      },
      testReport: {
        path: TEST_REPORT,
        state: "present",
        sha256: "2".repeat(64),
        bytes: 1
      }
    }
  };
  // The fixture root does not exist, so the captured report is now absent.
  const { context, calls } = recordingContext({
    ...store.methods,
    readCompletionCaptureIfExists: () => Promise.resolve(capture),
    readCompletionPublicationIfExists: () => Promise.resolve(null),
    readCompletionCandidateIfExists: () => Promise.resolve(null)
  });
  const state = implementingState(cursor({ captureDigest: "a".repeat(64) }));
  const outcome = await continueCompletionPublication(
    context,
    state,
    pendingRecord({
      artifacts: {
        implementationReport: IMPLEMENTATION_REPORT,
        testReport: TEST_REPORT
      }
    }),
    CONFIG
  );
  assert.ok(outcome.kind === "stopped" && outcome.state === state);
  assertPersistedRefusal(store, {
    blockReason:
      "[COMPLETION_PUBLICATION_DRIFT] Completion publication for implementation attempt implementation-1-abcdef12 stopped at stage publication. The implementation report no longer equals its captured input. Restore the exact recorded input or proven output and matching authority, then run banzai resume; otherwise cancel.",
    cursor: cursor({
      stage: "publication",
      captureDigest: "a".repeat(64),
      refusal: {
        code: "COMPLETION_PUBLICATION_DRIFT",
        stage: "publication",
        proofDigest: "a".repeat(64)
      }
    })
  });
  assert.deepEqual(calls, [
    "readCompletionCaptureIfExists",
    "readCompletionPublicationIfExists",
    "readCompletionCandidateIfExists",
    "readState",
    "writeState",
    "appendEventOnce"
  ]);
});

test("a retained candidate from a different capture is an integrity refusal at candidate", async () => {
  const store = refusalStore();
  const { context, calls } = recordingContext({
    ...store.methods,
    readCompletionCaptureIfExists: () =>
      Promise.resolve({ integrityDigest: "a".repeat(64) }),
    readCompletionPublicationIfExists: () => Promise.resolve(null),
    readCompletionCandidateIfExists: () =>
      Promise.resolve({
        candidate: { captureDigest: "b".repeat(64) },
        bytes: Buffer.alloc(0)
      })
  });
  const state = implementingState(cursor({ captureDigest: "a".repeat(64) }));
  const outcome = await continueCompletionPublication(
    context,
    state,
    pendingRecord(),
    CONFIG
  );
  assert.ok(outcome.kind === "stopped" && outcome.state === state);
  assertPersistedRefusal(store, {
    blockReason:
      "[COMPLETION_PUBLICATION_INTEGRITY] Completion publication for implementation attempt implementation-1-abcdef12 stopped at stage candidate. The retained candidate belongs to a different capture. Cancel the run unless intact proof can be reproduced by a corrected runner.",
    cursor: cursor({
      stage: "candidate",
      captureDigest: "a".repeat(64),
      refusal: {
        code: "COMPLETION_PUBLICATION_INTEGRITY",
        stage: "candidate",
        proofDigest: "a".repeat(64)
      }
    })
  });
  assert.deepEqual(calls, [
    "readCompletionCaptureIfExists",
    "readCompletionPublicationIfExists",
    "readCompletionCandidateIfExists",
    "readState",
    "writeState",
    "appendEventOnce"
  ]);
});

test("a retained receipt that does not bind this capture and candidate is an integrity refusal at receipt", async () => {
  const cases = [
    {
      // The receipt was sealed for another capture.
      receipt: {
        captureDigest: "d".repeat(64),
        candidateDigest: "b".repeat(64)
      },
      candidate: {
        captureDigest: "a".repeat(64),
        integrityDigest: "b".repeat(64)
      }
    },
    {
      // The candidate the receipt names is no longer retained.
      receipt: {
        captureDigest: "a".repeat(64),
        candidateDigest: "b".repeat(64)
      },
      candidate: null
    },
    {
      // The retained candidate is not the one the receipt names.
      receipt: {
        captureDigest: "a".repeat(64),
        candidateDigest: "b".repeat(64)
      },
      candidate: {
        captureDigest: "a".repeat(64),
        integrityDigest: "c".repeat(64)
      }
    }
  ];
  for (const { receipt, candidate } of cases) {
    const store = refusalStore();
    const { context, calls } = recordingContext({
      ...store.methods,
      readCompletionCaptureIfExists: () =>
        Promise.resolve({ integrityDigest: "a".repeat(64) }),
      readCompletionPublicationIfExists: () => Promise.resolve(receipt),
      readCompletionCandidateIfExists: () =>
        Promise.resolve(
          candidate === null ? null : { candidate, bytes: Buffer.alloc(0) }
        )
    });
    const state = implementingState(cursor({ captureDigest: "a".repeat(64) }));
    const outcome = await continueCompletionPublication(
      context,
      state,
      pendingRecord(),
      CONFIG
    );
    assert.ok(outcome.kind === "stopped" && outcome.state === state);
    assertPersistedRefusal(store, {
      blockReason:
        "[COMPLETION_PUBLICATION_INTEGRITY] Completion publication for implementation attempt implementation-1-abcdef12 stopped at stage receipt. The retained receipt does not bind this capture and candidate. Cancel the run unless intact proof can be reproduced by a corrected runner.",
      cursor: cursor({
        stage: "receipt",
        captureDigest: "a".repeat(64),
        refusal: {
          code: "COMPLETION_PUBLICATION_INTEGRITY",
          stage: "receipt",
          proofDigest: "a".repeat(64)
        }
      })
    });
    // Refused before any report, workspace or authority observation.
    assert.deepEqual(calls, [
      "readCompletionCaptureIfExists",
      "readCompletionPublicationIfExists",
      "readCompletionCandidateIfExists",
      "readState",
      "writeState",
      "appendEventOnce"
    ]);
  }
});

const IMPLEMENTATION_TEXT = "# Implementation Report\n\nNarrative.\n";
const TEST_TEXT = "# Test Report\n\nAll checks passed.\n";

function sha256(bytes: string | Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function presentReport(reportPath: string, text: string) {
  return {
    path: reportPath,
    state: "present",
    sha256: sha256(text),
    bytes: Buffer.byteLength(text)
  };
}

/** A capture whose two report identities are the fixture report texts. */
function reportCapture(workspaceDigest: string) {
  return {
    integrityDigest: "a".repeat(64),
    reports: {
      implementationReport: presentReport(
        IMPLEMENTATION_REPORT,
        IMPLEMENTATION_TEXT
      ),
      testReport: presentReport(TEST_REPORT, TEST_TEXT)
    },
    workspace: {
      digest: workspaceDigest,
      excludedPaths: [IMPLEMENTATION_REPORT, TEST_REPORT]
    }
  };
}

async function writeReports(root: string, testText: string | null) {
  await mkdir(path.join(root, path.dirname(IMPLEMENTATION_REPORT)), {
    recursive: true
  });
  await writeFile(path.join(root, IMPLEMENTATION_REPORT), IMPLEMENTATION_TEXT);
  if (testText !== null)
    await writeFile(path.join(root, TEST_REPORT), testText);
}

async function inDirectory(body: (root: string) => Promise<void>) {
  const root = await mkdtemp(path.join(tmpdir(), "banzai-publication-test-"));
  try {
    await body(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

/** Continues publication of a stubbed capture whose reports live under `root`. */
async function continueReportCapture(root: string, capture: unknown) {
  const store = refusalStore();
  const { context, calls } = recordingContext(
    {
      ...store.methods,
      readCompletionCaptureIfExists: () => Promise.resolve(capture),
      readCompletionPublicationIfExists: () => Promise.resolve(null),
      readCompletionCandidateIfExists: () => Promise.resolve(null)
    },
    root
  );
  const state = implementingState(cursor({ captureDigest: "a".repeat(64) }));
  const outcome = await continueCompletionPublication(
    context,
    state,
    pendingRecord({
      artifacts: {
        implementationReport: IMPLEMENTATION_REPORT,
        testReport: TEST_REPORT
      }
    }),
    CONFIG
  );
  assert.ok(outcome.kind === "stopped" && outcome.state === state);
  assert.deepEqual(calls, [
    "readCompletionCaptureIfExists",
    "readCompletionPublicationIfExists",
    "readCompletionCandidateIfExists",
    "readState",
    "writeState",
    "appendEventOnce"
  ]);
  return store;
}

const PUBLICATION_DRIFT_CURSOR = cursor({
  stage: "publication",
  captureDigest: "a".repeat(64),
  refusal: {
    code: "COMPLETION_PUBLICATION_DRIFT",
    stage: "publication",
    proofDigest: "a".repeat(64)
  }
});

test("a test report that no longer equals its capture is a drift refusal at publication", async () => {
  // The implementation report still equals its capture in both cases.
  for (const current of [`${TEST_TEXT}Later edit.\n`, null])
    await inDirectory(async (root) => {
      await writeReports(root, current);
      const store = await continueReportCapture(
        root,
        reportCapture("f".repeat(64))
      );
      assertPersistedRefusal(store, {
        blockReason:
          "[COMPLETION_PUBLICATION_DRIFT] Completion publication for implementation attempt implementation-1-abcdef12 stopped at stage publication. The test report no longer equals its captured input. Restore the exact recorded input or proven output and matching authority, then run banzai resume; otherwise cancel.",
        cursor: PUBLICATION_DRIFT_CURSOR
      });
    });
});

test("a non-report workspace that changed or became unobservable since capture is a drift refusal at publication", async () => {
  const blockReason =
    "[COMPLETION_PUBLICATION_DRIFT] Completion publication for implementation attempt implementation-1-abcdef12 stopped at stage publication. The non-report workspace changed since capture. Restore the exact recorded input or proven output and matching authority, then run banzai resume; otherwise cancel.";
  // Inside Git: a non-report file changed after the digest was captured.
  await inRepository(async (root) => {
    await writeReports(root, TEST_TEXT);
    const options = { excludedPaths: [IMPLEMENTATION_REPORT, TEST_REPORT] };
    const captured = await workspaceSnapshot(root, options);
    await writeFile(path.join(root, "base.txt"), "changed\n");
    // Still observable, now with another digest.
    assert.notEqual(
      (await workspaceSnapshot(root, options)).digest,
      captured.digest
    );
    const store = await continueReportCapture(
      root,
      reportCapture(captured.digest)
    );
    assertPersistedRefusal(store, {
      blockReason,
      cursor: PUBLICATION_DRIFT_CURSOR
    });
  });
  // Outside Git: the non-report workspace digest cannot be observed at all.
  await inDirectory(async (root) => {
    await writeReports(root, TEST_TEXT);
    const store = await continueReportCapture(
      root,
      reportCapture("f".repeat(64))
    );
    assertPersistedRefusal(store, {
      blockReason,
      cursor: PUBLICATION_DRIFT_CURSOR
    });
  });
});

const RECEIPT = {
  integrityDigest: "e".repeat(64),
  captureDigest: "a".repeat(64),
  candidateDigest: "b".repeat(64),
  ledgerAuthor: {
    attemptId: ATTEMPT.id,
    attemptKind: "implementation",
    ledgerDigest: "c".repeat(64)
  },
  implementationReport: { path: IMPLEMENTATION_REPORT, sha256: "1".repeat(64) },
  testReport: { path: TEST_REPORT, sha256: "2".repeat(64) }
} as unknown as CompletionPublication;
const CLAIMS = {
  approvalDigest: "3".repeat(64),
  planTaskDigest: "4".repeat(64),
  ledgerDigest: "c".repeat(64),
  counts: { total: 1, completed: 1, incomplete: 0, blocked: 0 }
} as unknown as ValidatedCompletionClaims;
const LEDGER = completionLedger(["T001"]) as PlanTaskCompletionLedger;

function applicationState(): RunState {
  return {
    runId: "run-1",
    metrics: {
      completedAttemptIds: [],
      usageAccountedAttemptIds: [],
      usage: {
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        costUsd: null
      },
      modelDurationMs: 0
    },
    planTaskCompletion: null,
    completionPublication: null,
    activeProcess: {}
  } as unknown as RunState;
}

function applicationRecord(): AttemptRecord {
  return {
    attempt: ATTEMPT,
    status: "pending_application",
    startedAt: "2026-06-30T23:59:00.000Z",
    completedAt: null,
    durationMs: null,
    error: null,
    failureCode: null,
    usage: null
  } as unknown as AttemptRecord;
}

const COMPLETED_RECORD = {
  attempt: ATTEMPT,
  status: "completed",
  startedAt: "2026-06-30T23:59:00.000Z",
  completedAt: "2026-07-01T00:00:00.000Z",
  durationMs: 60_000,
  error: null,
  failureCode: null,
  usage: null
};

const APPLIED_SUMMARY = {
  schemaVersion: COMPLETION_SUMMARY_SCHEMA_VERSION,
  status: "valid",
  sourceAttemptId: ATTEMPT.id,
  sourceAttemptKind: "implementation",
  approvalDigest: "3".repeat(64),
  planTaskDigest: "4".repeat(64),
  ledgerDigest: "c".repeat(64),
  implementationReport: { path: IMPLEMENTATION_REPORT, sha256: "1".repeat(64) },
  testReport: { path: TEST_REPORT, sha256: "2".repeat(64) },
  counts: { total: 1, completed: 1, incomplete: 0, blocked: 0 },
  validatedAt: "2026-07-01T00:00:00.000Z",
  completionProtocol: COMPLETION_PROTOCOL,
  publisherAttemptId: ATTEMPT.id,
  publication: {
    path: `attempts/${ATTEMPT.id}.completion-publication.json`,
    sha256: "e".repeat(64)
  }
};

const STATE_CURSOR = cursor({
  stage: "state",
  captureDigest: "a".repeat(64),
  candidateDigest: "b".repeat(64),
  receiptDigest: "e".repeat(64)
});

function applicationStore() {
  const records: AttemptRecord[] = [];
  const states: RunState[] = [];
  return {
    records,
    states,
    methods: {
      writeRunAttempt: (_runId: string, record: AttemptRecord) => {
        records.push(structuredClone(record));
        return Promise.resolve();
      },
      readState: () =>
        Promise.resolve({ status: "implementing" } as unknown as RunState),
      completionEvidenceRelativePath: (
        _runId: string,
        attempt: AttemptReference,
        leaf: string
      ) => `attempts/${attempt.id}.${leaf}`,
      writeState: (state: RunState) => {
        states.push(structuredClone(state));
        return Promise.resolve();
      }
    }
  };
}

test("a failed completed-attempt write is an i/o refusal at attempt before any state change", async () => {
  const store = applicationStore();
  const { context, calls } = recordingContext({
    writeRunAttempt: (_runId: string, record: AttemptRecord) => {
      store.records.push(structuredClone(record));
      return Promise.reject(new Error("EIO: injected attempt write failure"));
    }
  });
  const state = applicationState();
  await assert.rejects(
    applyCompletionPublication(
      context,
      state,
      applicationRecord(),
      {} as PhaseResultEnvelope,
      LEDGER,
      CLAIMS,
      RECEIPT
    ),
    refusal("COMPLETION_PUBLICATION_IO", "attempt", "e".repeat(64), IO_REMEDY)
  );
  assert.deepEqual(calls, ["writeRunAttempt"]);
  assert.deepEqual(store.records, [COMPLETED_RECORD]);
  assert.deepEqual(state, applicationState());
});

test("a failed application state write is an i/o refusal at state after the attempt completed", async () => {
  const store = applicationStore();
  const { context, calls } = recordingContext({
    ...store.methods,
    writeState: (state: RunState) => {
      store.states.push(structuredClone(state));
      return Promise.reject(new Error("EIO: injected state write failure"));
    }
  });
  const state = applicationState();
  await assert.rejects(
    applyCompletionPublication(
      context,
      state,
      applicationRecord(),
      {} as PhaseResultEnvelope,
      LEDGER,
      CLAIMS,
      RECEIPT
    ),
    refusal("COMPLETION_PUBLICATION_IO", "state", "e".repeat(64), IO_REMEDY)
  );
  assert.deepEqual(calls, [
    "writeRunAttempt",
    "readState",
    "completionEvidenceRelativePath",
    "writeState"
  ]);
  assert.deepEqual(store.records, [COMPLETED_RECORD]);
  const attempted = store.states[0];
  assert.deepEqual(
    {
      completionPublication: attempted?.completionPublication,
      planTaskCompletion: attempted?.planTaskCompletion,
      completedAttemptIds: attempted?.metrics.completedAttemptIds,
      activeProcess: attempted?.activeProcess
    },
    {
      completionPublication: STATE_CURSOR,
      planTaskCompletion: APPLIED_SUMMARY,
      completedAttemptIds: [ATTEMPT.id],
      activeProcess: null
    }
  );
});

test("a failed publication event is an i/o refusal at event without the event cursor", async () => {
  const store = applicationStore();
  const events: [string, string, Record<string, unknown>][] = [];
  const { context, calls } = recordingContext({
    ...store.methods,
    appendEventOnce: (
      runId: string,
      type: string,
      details: Record<string, unknown>
    ) => {
      events.push([runId, type, details]);
      return Promise.reject(new Error("EIO: injected event append failure"));
    }
  });
  const state = applicationState();
  await assert.rejects(
    applyCompletionPublication(
      context,
      state,
      applicationRecord(),
      {} as PhaseResultEnvelope,
      LEDGER,
      CLAIMS,
      RECEIPT
    ),
    refusal("COMPLETION_PUBLICATION_IO", "event", "e".repeat(64), IO_REMEDY)
  );
  // No trailing writeState: the stage-event cursor was never stored.
  assert.deepEqual(calls, [
    "writeRunAttempt",
    "readState",
    "completionEvidenceRelativePath",
    "writeState",
    "appendEventOnce"
  ]);
  assert.deepEqual(store.records, [COMPLETED_RECORD]);
  assert.equal(store.states.length, 1);
  const persisted = store.states[0];
  assert.ok(persisted);
  assert.deepEqual(persisted.completionPublication, STATE_CURSOR);
  assert.deepEqual(persisted.planTaskCompletion, APPLIED_SUMMARY);
  assert.deepEqual(events, [
    [
      "run-1",
      "completion.publication_applied",
      {
        attemptId: ATTEMPT.id,
        attemptKind: "implementation",
        stage: "event",
        proofDigest: "e".repeat(64),
        code: null,
        violation: null,
        taskId: null
      }
    ]
  ]);
});

// ---------------------------------------------------------------------------
// Runner-level routes: these failures sit behind Git, approval and report
// validation, so they are reached through a real temporary repository.
// ---------------------------------------------------------------------------

async function inRepository(body: (root: string) => Promise<void>) {
  const repository = await createTestRepository();
  try {
    await body(repository.root);
  } finally {
    await repository.dispose();
  }
}

function publicationRunner(root: string, sources: RunnerSources = {}) {
  const adapters = new FakeAdapters();
  adapters.reviewResults.push(passingReview());
  const runner = new WorkflowRunner(
    root,
    adapters,
    undefined,
    undefined,
    undefined,
    sources
  );
  return { adapters, runner };
}

async function approveIntoRefusal(runner: WorkflowRunner) {
  await runner.start({ slug: "example", request: "Implement it." });
  const blocked = await runner.approvePlan("human");
  const attempt = blocked.activeAttempt;
  assert.ok(attempt?.kind === "implementation");
  return { runId: blocked.runId, attempt };
}

async function eventDetails(
  runner: WorkflowRunner,
  runId: string,
  type: string
): Promise<Record<string, unknown>[]> {
  const lines = await readFile(
    path.join(runner.store.runDirectory(runId), "events.jsonl"),
    "utf8"
  );
  return lines
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as RunEvent)
    .filter((event) => event.type === type)
    .map((event) => event.details);
}

function refusedEvent(
  attempt: AttemptReference,
  refused: NonNullable<CompletionPublicationCursor["refusal"]>
): Record<string, unknown> {
  return {
    attemptId: attempt.id,
    attemptKind: "implementation",
    stage: refused.stage,
    proofDigest: refused.proofDigest,
    code: refused.code,
    violation: null,
    taskId: null
  };
}

async function assertRunnerRefusal(
  runner: WorkflowRunner,
  runId: string,
  attempt: AttemptReference,
  expected: { blockReason: string; cursor: CompletionPublicationCursor }
): Promise<RunState> {
  const persisted = await runner.store.readState(runId);
  assert.deepEqual(
    {
      status: persisted.status,
      blockedFrom: persisted.blockedFrom,
      blockReason: persisted.blockReason,
      completionPublication: persisted.completionPublication
    },
    {
      status: "blocked",
      blockedFrom: "implementing",
      blockReason: expected.blockReason,
      completionPublication: expected.cursor
    }
  );
  assert.equal(
    (await runner.store.readRunAttempt(runId, attempt)).status,
    "pending_application"
  );
  assert.deepEqual(await eventDetails(runner, runId, "attempt.failed"), []);
  return persisted;
}

test("a forged captured ledger identity blocks resume with an integrity refusal whose only exit is cancel", async () => {
  await inRepository(async (root) => {
    const { adapters, runner } = publicationRunner(root);
    const writeState = runner.store.writeState.bind(runner.store);
    let injected = false;
    runner.store.writeState = async (state) => {
      if (
        !injected &&
        state.completionPublication?.stage === "capture" &&
        state.completionPublication.refusal === null
      ) {
        injected = true;
        throw new Error("EIO: injected capture cursor failure");
      }
      await writeState(state);
    };
    const { runId, attempt } = await approveIntoRefusal(runner);
    const first = await runner.store.readState(runId);
    assert.equal(first.completionPublication?.refusal?.stage, "capture");

    // Forge a self-consistent capture whose ledger identity no longer matches
    // the accepted ledger; its integrity digest is recomputed so it parses.
    const capturePath = runner.store.completionEvidencePath(
      runId,
      attempt,
      "completion-input.json"
    );
    const original = JSON.parse(
      await readFile(capturePath, "utf8")
    ) as CompletionCapture;
    const source = original.ledgerSource;
    assert.ok(source !== null && source.attemptId === attempt.id);
    const body: Partial<CompletionCapture> = {
      ...original,
      ledgerSource: { ...source, ledgerDigest: "0".repeat(64) }
    };
    delete body.integrityDigest;
    const forgedDigest = completionRecordIntegrity(body);
    await writeFile(
      capturePath,
      `${JSON.stringify({ ...body, integrityDigest: forgedDigest }, null, 2)}\n`
    );

    const promptsBefore = adapters.phasePrompts.length;
    await runner.resume();
    assert.equal(adapters.phasePrompts.length, promptsBefore);
    const refused = {
      code: "COMPLETION_PUBLICATION_INTEGRITY",
      stage: "validate",
      proofDigest: forgedDigest
    } as const;
    const persisted = await assertRunnerRefusal(runner, runId, attempt, {
      blockReason: `[COMPLETION_PUBLICATION_INTEGRITY] Completion publication for implementation attempt ${attempt.id} stopped at stage validate. The captured ledger does not match its recorded identity.`,
      cursor: cursor({
        attemptId: attempt.id,
        stage: "validate",
        captureDigest: forgedDigest,
        refusal: refused
      })
    });
    assert.equal(persisted.planTaskCompletion, null);
    assert.equal(
      await runner.store.readCompletionCandidateIfExists(runId, attempt),
      null
    );
    assert.equal(
      await runner.store.readCompletionPublicationIfExists(runId, attempt),
      null
    );
    assert.deepEqual(
      await eventDetails(runner, runId, "completion.publication_refused"),
      [
        refusedEvent(attempt, {
          code: "COMPLETION_PUBLICATION_IO",
          stage: "capture",
          proofDigest: original.integrityDigest
        }),
        refusedEvent(attempt, refused)
      ]
    );
    assert.equal(
      (await runner.status()).completionPublication?.action,
      "cancel"
    );
  });
});

test("a failed report replacement keeps the input report and blocks with a resumable i/o refusal at publication", async () => {
  await inRepository(async (root) => {
    // The replacement's temporary name comes from the id source; a file
    // already at that name makes the exclusive create fail.
    const blockerId = "11111111-1111-4111-8111-111111111111";
    let armed = false;
    const { adapters, runner } = publicationRunner(root, {
      ids: () => {
        if (!armed) return randomUUID();
        armed = false;
        return blockerId;
      }
    });
    let blocked = false;
    const writeCandidate = runner.store.writeCompletionCandidate.bind(
      runner.store
    );
    runner.store.writeCompletionCandidate = async (runId, candidate, bytes) => {
      await writeCandidate(runId, candidate, bytes);
      if (blocked) return;
      blocked = true;
      await writeFile(
        `${path.join(root, candidate.destination)}.${blockerId}.completion.tmp`,
        "blocker"
      );
      armed = true;
    };
    const { runId, attempt } = await approveIntoRefusal(runner);
    assert.equal(blocked, true);
    const capture = await runner.store.readCompletionCaptureIfExists(
      runId,
      attempt
    );
    const candidate = await runner.store.readCompletionCandidateIfExists(
      runId,
      attempt
    );
    assert.ok(capture && candidate);
    const refused = {
      code: "COMPLETION_PUBLICATION_IO",
      stage: "publication",
      proofDigest: candidate.candidate.integrityDigest
    } as const;
    const persisted = await assertRunnerRefusal(runner, runId, attempt, {
      blockReason: `[COMPLETION_PUBLICATION_IO] Completion publication for implementation attempt ${attempt.id} stopped at stage publication. Retry with banzai resume once storage is available, or cancel.`,
      cursor: cursor({
        attemptId: attempt.id,
        stage: "publication",
        captureDigest: capture.integrityDigest,
        candidateDigest: candidate.candidate.integrityDigest,
        refusal: refused
      })
    });
    assert.equal(persisted.planTaskCompletion, null);
    const destination = path.join(root, candidate.candidate.destination);
    const blocker = `${destination}.${blockerId}.completion.tmp`;
    assert.equal(
      createHash("sha256")
        .update(await readFile(destination))
        .digest("hex"),
      candidate.candidate.inputSha256
    );
    assert.equal(await readFile(blocker, "utf8"), "blocker");
    assert.equal(
      await runner.store.readCompletionPublicationIfExists(runId, attempt),
      null
    );
    assert.deepEqual(
      await eventDetails(runner, runId, "completion.publication_refused"),
      [refusedEvent(attempt, refused)]
    );
    assert.deepEqual(
      await eventDetails(runner, runId, "completion.publication_applied"),
      []
    );

    await rm(blocker);
    const promptsBefore = adapters.phasePrompts.length;
    const done = await runner.resume();
    assert.equal(done.status, "done", done.blockReason ?? "");
    assert.equal(adapters.phasePrompts.length, promptsBefore);
    assert.ok((await readFile(destination)).equals(candidate.bytes));
    assert.equal(
      (await eventDetails(runner, runId, "completion.publication_applied"))
        .length,
      1
    );
  });
});

test("a failed receipt write after report replacement blocks with a resumable i/o refusal at receipt", async () => {
  await inRepository(async (root) => {
    const { runner } = publicationRunner(root);
    const writeReceipt = runner.store.writeCompletionPublication.bind(
      runner.store
    );
    let injected = false;
    runner.store.writeCompletionPublication = async (runId, receipt) => {
      if (!injected) {
        injected = true;
        throw new Error("EIO: injected receipt write failure");
      }
      await writeReceipt(runId, receipt);
    };
    const { runId, attempt } = await approveIntoRefusal(runner);
    assert.equal(injected, true);
    const capture = await runner.store.readCompletionCaptureIfExists(
      runId,
      attempt
    );
    const candidate = await runner.store.readCompletionCandidateIfExists(
      runId,
      attempt
    );
    assert.ok(capture && candidate);
    const refused = {
      code: "COMPLETION_PUBLICATION_IO",
      stage: "receipt",
      proofDigest: candidate.candidate.integrityDigest
    } as const;
    const persisted = await assertRunnerRefusal(runner, runId, attempt, {
      blockReason: `[COMPLETION_PUBLICATION_IO] Completion publication for implementation attempt ${attempt.id} stopped at stage receipt. Retry with banzai resume once storage is available, or cancel.`,
      cursor: cursor({
        attemptId: attempt.id,
        stage: "receipt",
        captureDigest: capture.integrityDigest,
        candidateDigest: candidate.candidate.integrityDigest,
        refusal: refused
      })
    });
    assert.equal(persisted.planTaskCompletion, null);
    assert.ok(
      (await readFile(path.join(root, candidate.candidate.destination))).equals(
        candidate.bytes
      )
    );
    assert.equal(
      await runner.store.readCompletionPublicationIfExists(runId, attempt),
      null
    );
    assert.deepEqual(
      await eventDetails(runner, runId, "completion.publication_refused"),
      [refusedEvent(attempt, refused)]
    );
    assert.deepEqual(
      await eventDetails(runner, runId, "completion.publication_applied"),
      []
    );
  });
});

async function durableProof(
  runner: WorkflowRunner,
  runId: string,
  attempt: AttemptReference
) {
  const capture = await runner.store.readCompletionCaptureIfExists(
    runId,
    attempt
  );
  const candidate = await runner.store.readCompletionCandidateIfExists(
    runId,
    attempt
  );
  const receipt = await runner.store.readCompletionPublicationIfExists(
    runId,
    attempt
  );
  assert.ok(capture && candidate && receipt);
  return { capture, candidate: candidate.candidate, receipt };
}

test("a failed completed-attempt write persists a resumable i/o refusal with the attempt still pending", async () => {
  await inRepository(async (root) => {
    const { runner } = publicationRunner(root);
    const writeAttempt = runner.store.writeRunAttempt.bind(runner.store);
    let injected = false;
    runner.store.writeRunAttempt = async (runId, record) => {
      if (
        !injected &&
        record.attempt.kind === "implementation" &&
        record.status === "completed"
      ) {
        injected = true;
        throw new Error("EIO: injected attempt write failure");
      }
      await writeAttempt(runId, record);
    };
    const { runId, attempt } = await approveIntoRefusal(runner);
    const { capture, candidate, receipt } = await durableProof(
      runner,
      runId,
      attempt
    );
    const refused = {
      code: "COMPLETION_PUBLICATION_IO",
      stage: "attempt",
      proofDigest: receipt.integrityDigest
    } as const;
    const persisted = await assertRunnerRefusal(runner, runId, attempt, {
      blockReason: `[COMPLETION_PUBLICATION_IO] Completion publication for implementation attempt ${attempt.id} stopped at stage attempt. Retry with banzai resume once storage is available, or cancel.`,
      cursor: cursor({
        attemptId: attempt.id,
        stage: "attempt",
        captureDigest: capture.integrityDigest,
        candidateDigest: candidate.integrityDigest,
        refusal: refused
      })
    });
    assert.equal(persisted.planTaskCompletion, null);
    assert.equal(
      persisted.metrics.completedAttemptIds.includes(attempt.id),
      false
    );
    assert.deepEqual(
      await eventDetails(runner, runId, "completion.publication_refused"),
      [refusedEvent(attempt, refused)]
    );
    assert.deepEqual(
      await eventDetails(runner, runId, "completion.publication_applied"),
      []
    );
  });
});

test("a failed application state write persists the applied summary with the attempt pending and resumes once", async () => {
  await inRepository(async (root) => {
    const { adapters, runner } = publicationRunner(root);
    const writeState = runner.store.writeState.bind(runner.store);
    let injected = false;
    runner.store.writeState = async (state) => {
      if (
        !injected &&
        state.completionPublication?.stage === "state" &&
        state.completionPublication.refusal === null
      ) {
        injected = true;
        throw new Error("EIO: injected application state failure");
      }
      await writeState(state);
    };
    const { runId, attempt } = await approveIntoRefusal(runner);
    assert.equal(injected, true);
    const { capture, candidate, receipt } = await durableProof(
      runner,
      runId,
      attempt
    );
    const refused = {
      code: "COMPLETION_PUBLICATION_IO",
      stage: "state",
      proofDigest: receipt.integrityDigest
    } as const;
    const persisted = await assertRunnerRefusal(runner, runId, attempt, {
      blockReason: `[COMPLETION_PUBLICATION_IO] Completion publication for implementation attempt ${attempt.id} stopped at stage state. Retry with banzai resume once storage is available, or cancel.`,
      cursor: cursor({
        attemptId: attempt.id,
        stage: "state",
        captureDigest: capture.integrityDigest,
        candidateDigest: candidate.integrityDigest,
        receiptDigest: receipt.integrityDigest,
        refusal: refused
      })
    });
    // The refusal write carries the in-memory application made before the
    // failed write, so the summary and accounting are already durable.
    assert.ok(persisted.planTaskCompletion?.status === "valid");
    assert.equal(
      persisted.planTaskCompletion.publication?.sha256,
      receipt.integrityDigest
    );
    assert.deepEqual(
      persisted.metrics.completedAttemptIds.filter((id) => id === attempt.id),
      [attempt.id]
    );
    assert.deepEqual(
      await eventDetails(runner, runId, "completion.publication_refused"),
      [refusedEvent(attempt, refused)]
    );
    assert.deepEqual(
      await eventDetails(runner, runId, "completion.publication_applied"),
      []
    );

    const promptsBefore = adapters.phasePrompts.length;
    const done = await runner.resume();
    assert.equal(done.status, "done", done.blockReason ?? "");
    assert.equal(adapters.phasePrompts.length, promptsBefore);
    assert.deepEqual(
      done.metrics.completedAttemptIds.filter((id) => id === attempt.id),
      [attempt.id]
    );
    assert.equal(
      (await eventDetails(runner, runId, "completion.publication_applied"))
        .length,
      1
    );
  });
});

test("a failed publication event persists a refusal before any applied event and resumes once", async () => {
  await inRepository(async (root) => {
    const { adapters, runner } = publicationRunner(root);
    const appendEventOnce = runner.store.appendEventOnce.bind(runner.store);
    let injected = false;
    runner.store.appendEventOnce = async (runId, type, details) => {
      if (!injected && type === "completion.publication_applied") {
        injected = true;
        throw new Error("EIO: injected applied event failure");
      }
      return await appendEventOnce(runId, type, details);
    };
    const { runId, attempt } = await approveIntoRefusal(runner);
    assert.equal(injected, true);
    const { capture, candidate, receipt } = await durableProof(
      runner,
      runId,
      attempt
    );
    const refused = {
      code: "COMPLETION_PUBLICATION_IO",
      stage: "event",
      proofDigest: receipt.integrityDigest
    } as const;
    const persisted = await assertRunnerRefusal(runner, runId, attempt, {
      blockReason: `[COMPLETION_PUBLICATION_IO] Completion publication for implementation attempt ${attempt.id} stopped at stage event. Retry with banzai resume once storage is available, or cancel.`,
      cursor: cursor({
        attemptId: attempt.id,
        stage: "event",
        captureDigest: capture.integrityDigest,
        candidateDigest: candidate.integrityDigest,
        receiptDigest: receipt.integrityDigest,
        refusal: refused
      })
    });
    assert.ok(persisted.planTaskCompletion?.status === "valid");
    assert.equal(
      persisted.planTaskCompletion.publication?.sha256,
      receipt.integrityDigest
    );
    assert.deepEqual(
      await eventDetails(runner, runId, "completion.publication_refused"),
      [refusedEvent(attempt, refused)]
    );
    // Zero applied events is what separates this refusal from a failed
    // stage-event cursor write, which happens after the event is appended.
    assert.deepEqual(
      await eventDetails(runner, runId, "completion.publication_applied"),
      []
    );

    const promptsBefore = adapters.phasePrompts.length;
    const done = await runner.resume();
    assert.equal(done.status, "done", done.blockReason ?? "");
    assert.equal(adapters.phasePrompts.length, promptsBefore);
    assert.equal(
      (await eventDetails(runner, runId, "completion.publication_applied"))
        .length,
      1
    );
  });
});

// ---------------------------------------------------------------------------
// Drift and integrity refusals behind the recorded authority: each run first
// blocks with a resumable i/o refusal, then the retained evidence, the report
// or the authority changes before the deterministic resume.
// ---------------------------------------------------------------------------

/** Fails the first write of the named cursor, blocking with an i/o refusal there. */
async function blockAtCursor(root: string, stage: "capture" | "candidate") {
  const { adapters, runner } = publicationRunner(root);
  const writeState = runner.store.writeState.bind(runner.store);
  let injected = false;
  runner.store.writeState = async (state) => {
    if (
      !injected &&
      state.completionPublication?.stage === stage &&
      state.completionPublication.refusal === null
    ) {
      injected = true;
      throw new Error(`EIO: injected ${stage} cursor failure`);
    }
    await writeState(state);
  };
  const { runId, attempt } = await approveIntoRefusal(runner);
  assert.equal(injected, true);
  const io = (await runner.store.readState(runId)).completionPublication
    ?.refusal;
  assert.ok(io?.code === "COMPLETION_PUBLICATION_IO" && io.stage === stage);
  const capture = await runner.store.readCompletionCaptureIfExists(
    runId,
    attempt
  );
  assert.ok(capture);
  return { adapters, runner, runId, attempt, capture, io };
}

async function resumeWithoutModel(
  adapters: FakeAdapters,
  runner: WorkflowRunner
): Promise<void> {
  const promptsBefore = adapters.phasePrompts.length;
  await runner.resume();
  assert.equal(adapters.phasePrompts.length, promptsBefore);
}

/** Rewrites one retained evidence record and reseals it so it still parses. */
async function resealEvidence<T extends { integrityDigest: string }>(
  file: string,
  change: (record: T) => T
): Promise<string> {
  const body: Partial<T> = change(
    JSON.parse(await readFile(file, "utf8")) as T
  );
  delete body.integrityDigest;
  const digest = completionRecordIntegrity(body);
  await writeFile(
    file,
    `${JSON.stringify({ ...body, integrityDigest: digest }, null, 2)}\n`
  );
  return digest;
}

/** The implementation report still holds the exact captured input bytes. */
async function assertReportUnpublished(
  root: string,
  capture: CompletionCapture
): Promise<void> {
  const input = capture.reports.implementationReport;
  assert.ok(input.state === "present");
  assert.equal(
    sha256(await readFile(path.join(root, input.path))),
    input.sha256
  );
}

test("implementer configuration drift after capture is a drift refusal at publication naming the capture", async () => {
  await inRepository(async (root) => {
    const { adapters, runner, runId, attempt, capture, io } =
      await blockAtCursor(root, "capture");
    // Hidden from the non-report workspace digest, the changed configuration
    // is visible only to the recorded implementer authority.
    const hidden = spawnSync(
      "git",
      ["update-index", "--assume-unchanged", ".banzai/config.json"],
      { cwd: root }
    );
    assert.equal(hidden.status, 0, hidden.stderr.toString());
    const configPath = path.join(root, ".banzai/config.json");
    const config = JSON.parse(
      await readFile(configPath, "utf8")
    ) as OrchestratorConfig;
    config.models.implementer.model = `${config.models.implementer.model}-changed`;
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);

    await resumeWithoutModel(adapters, runner);
    const refused = {
      code: "COMPLETION_PUBLICATION_DRIFT",
      stage: "publication",
      proofDigest: capture.integrityDigest
    } as const;
    const persisted = await assertRunnerRefusal(runner, runId, attempt, {
      blockReason: `[COMPLETION_PUBLICATION_DRIFT] Completion publication for implementation attempt ${attempt.id} stopped at stage publication. Base commit, approval, plan tasks, scope, work binding or implementer configuration changed since capture. Restore the exact recorded input or proven output and matching authority, then run banzai resume; otherwise cancel.`,
      cursor: cursor({
        attemptId: attempt.id,
        stage: "publication",
        captureDigest: capture.integrityDigest,
        refusal: refused
      })
    });
    assert.equal(persisted.planTaskCompletion, null);
    assert.equal(
      await runner.store.readCompletionCandidateIfExists(runId, attempt),
      null
    );
    await assertReportUnpublished(root, capture);
    assert.deepEqual(
      await eventDetails(runner, runId, "completion.publication_refused"),
      [refusedEvent(attempt, io), refusedEvent(attempt, refused)]
    );
    assert.equal(
      (await runner.status()).completionPublication?.action,
      "cancel"
    );
  });
});

test("missing or changed captured report originals are an integrity refusal at capture", async () => {
  const tampers = [
    {
      leaf: "implementation-input.md",
      tamper: (file: string) => rm(file)
    },
    {
      leaf: "test-input.md",
      tamper: (file: string) => appendFile(file, "Changed original.\n")
    }
  ] as const;
  for (const { leaf, tamper } of tampers)
    await inRepository(async (root) => {
      const { adapters, runner, runId, attempt, capture, io } =
        await blockAtCursor(root, "capture");
      await tamper(runner.store.completionEvidencePath(runId, attempt, leaf));

      await resumeWithoutModel(adapters, runner);
      const refused = {
        code: "COMPLETION_PUBLICATION_INTEGRITY",
        stage: "capture",
        proofDigest: capture.integrityDigest
      } as const;
      const persisted = await assertRunnerRefusal(runner, runId, attempt, {
        blockReason: `[COMPLETION_PUBLICATION_INTEGRITY] Completion publication for implementation attempt ${attempt.id} stopped at stage capture. Captured report originals are missing or changed. Cancel the run unless intact proof can be reproduced by a corrected runner.`,
        cursor: cursor({
          attemptId: attempt.id,
          stage: "capture",
          captureDigest: capture.integrityDigest,
          refusal: refused
        })
      });
      assert.equal(persisted.planTaskCompletion, null);
      assert.equal(
        await runner.store.readCompletionCandidateIfExists(runId, attempt),
        null
      );
      await assertReportUnpublished(root, capture);
      assert.deepEqual(
        await eventDetails(runner, runId, "completion.publication_refused"),
        [refusedEvent(attempt, io), refusedEvent(attempt, refused)]
      );
      assert.equal(
        (await runner.status()).completionPublication?.action,
        "cancel"
      );
    });
});

test("a captured test report identity that conflicts with its retained original is an integrity refusal at validation", async () => {
  await inRepository(async (root) => {
    const { adapters, runner, runId, attempt, capture, io } =
      await blockAtCursor(root, "capture");
    // The retained original and its sealed identity now describe other bytes
    // than the recorded test report observation, which still equals the file.
    const originalPath = runner.store.completionEvidencePath(
      runId,
      attempt,
      "test-input.md"
    );
    const original = Buffer.concat([
      await readFile(originalPath),
      Buffer.from("\nRetained original only.\n")
    ]);
    await writeFile(originalPath, original);
    const forgedDigest = await resealEvidence<CompletionCapture>(
      runner.store.completionEvidencePath(
        runId,
        attempt,
        "completion-input.json"
      ),
      (record) => {
        const retained = record.originals.testReport;
        assert.ok(retained);
        return {
          ...record,
          originals: {
            ...record.originals,
            testReport: { ...retained, sha256: sha256(original) }
          }
        };
      }
    );

    await resumeWithoutModel(adapters, runner);
    const refused = {
      code: "COMPLETION_PUBLICATION_INTEGRITY",
      stage: "validate",
      proofDigest: forgedDigest
    } as const;
    const persisted = await assertRunnerRefusal(runner, runId, attempt, {
      blockReason: `[COMPLETION_PUBLICATION_INTEGRITY] Completion publication for implementation attempt ${attempt.id} stopped at stage validate. Captured test report identity conflicts with validation. Cancel the run unless intact proof can be reproduced by a corrected runner.`,
      cursor: cursor({
        attemptId: attempt.id,
        stage: "validate",
        captureDigest: forgedDigest,
        refusal: refused
      })
    });
    assert.equal(persisted.planTaskCompletion, null);
    assert.equal(
      await runner.store.readCompletionCandidateIfExists(runId, attempt),
      null
    );
    await assertReportUnpublished(root, capture);
    assert.deepEqual(
      await eventDetails(runner, runId, "completion.publication_refused"),
      [refusedEvent(attempt, io), refusedEvent(attempt, refused)]
    );
    assert.equal(
      (await runner.status()).completionPublication?.action,
      "cancel"
    );
  });
});

test("a retained candidate that differs from the deterministic rendering is an integrity refusal at candidate", async () => {
  const forgeries = [
    {
      // Another ledger identity under the same candidate bytes.
      forge: async (metadataPath: string) =>
        await resealEvidence<CompletionCandidate>(metadataPath, (record) => ({
          ...record,
          ledgerDigest: "0".repeat(64)
        }))
    },
    {
      // Other candidate bytes whose metadata still binds them.
      forge: async (metadataPath: string, bytesPath: string) => {
        const bytes = Buffer.concat([
          await readFile(bytesPath),
          Buffer.from("\nForged rendering.\n")
        ]);
        await writeFile(bytesPath, bytes);
        return await resealEvidence<CompletionCandidate>(
          metadataPath,
          (record) => ({
            ...record,
            outputSha256: sha256(bytes),
            outputBytes: bytes.length
          })
        );
      }
    }
  ];
  for (const { forge } of forgeries)
    await inRepository(async (root) => {
      const { adapters, runner, runId, attempt, capture, io } =
        await blockAtCursor(root, "candidate");
      const retained = await runner.store.readCompletionCandidateIfExists(
        runId,
        attempt
      );
      assert.ok(retained);
      await forge(
        runner.store.completionEvidencePath(
          runId,
          attempt,
          "completion-candidate.json"
        ),
        runner.store.completionEvidencePath(
          runId,
          attempt,
          "completion-candidate.md"
        )
      );

      await resumeWithoutModel(adapters, runner);
      const refused = {
        code: "COMPLETION_PUBLICATION_INTEGRITY",
        stage: "candidate",
        proofDigest: capture.integrityDigest
      } as const;
      // The cursor keeps the candidate identity it last proved durable.
      const persisted = await assertRunnerRefusal(runner, runId, attempt, {
        blockReason: `[COMPLETION_PUBLICATION_INTEGRITY] Completion publication for implementation attempt ${attempt.id} stopped at stage candidate. The retained candidate differs from the deterministic rendering. Cancel the run unless intact proof can be reproduced by a corrected runner.`,
        cursor: cursor({
          attemptId: attempt.id,
          stage: "candidate",
          captureDigest: capture.integrityDigest,
          candidateDigest: retained.candidate.integrityDigest,
          refusal: refused
        })
      });
      assert.equal(persisted.planTaskCompletion, null);
      await assertReportUnpublished(root, capture);
      assert.equal(
        await runner.store.readCompletionPublicationIfExists(runId, attempt),
        null
      );
      assert.deepEqual(
        await eventDetails(runner, runId, "completion.publication_refused"),
        [refusedEvent(attempt, io), refusedEvent(attempt, refused)]
      );
      assert.equal(
        (await runner.status()).completionPublication?.action,
        "cancel"
      );
    });
});

test("an implementation report edited after its candidate is rendered is a drift refusal before replacement", async () => {
  await inRepository(async (root) => {
    const { runner } = publicationRunner(root);
    const edit = Buffer.from("\nConcurrent edit.\n");
    const writeCandidate = runner.store.writeCompletionCandidate.bind(
      runner.store
    );
    let edited = false;
    runner.store.writeCompletionCandidate = async (runId, candidate, bytes) => {
      await writeCandidate(runId, candidate, bytes);
      if (edited) return;
      edited = true;
      await appendFile(path.join(root, candidate.destination), edit);
    };
    const { runId, attempt } = await approveIntoRefusal(runner);
    assert.equal(edited, true);
    const capture = await runner.store.readCompletionCaptureIfExists(
      runId,
      attempt
    );
    const candidate = await runner.store.readCompletionCandidateIfExists(
      runId,
      attempt
    );
    const input = await runner.store.readCompletionOriginalIfExists(
      runId,
      attempt,
      "implementationReport"
    );
    assert.ok(capture && candidate && input);
    const refused = {
      code: "COMPLETION_PUBLICATION_DRIFT",
      stage: "publication",
      proofDigest: capture.integrityDigest
    } as const;
    const persisted = await assertRunnerRefusal(runner, runId, attempt, {
      blockReason: `[COMPLETION_PUBLICATION_DRIFT] Completion publication for implementation attempt ${attempt.id} stopped at stage publication. The implementation report changed before publication. Restore the exact recorded input or proven output and matching authority, then run banzai resume; otherwise cancel.`,
      cursor: cursor({
        attemptId: attempt.id,
        stage: "publication",
        captureDigest: capture.integrityDigest,
        candidateDigest: candidate.candidate.integrityDigest,
        refusal: refused
      })
    });
    assert.equal(persisted.planTaskCompletion, null);
    // The concurrent edit is kept, never overwritten by the candidate.
    assert.ok(
      (await readFile(path.join(root, candidate.candidate.destination))).equals(
        Buffer.concat([input, edit])
      )
    );
    assert.equal(
      await runner.store.readCompletionPublicationIfExists(runId, attempt),
      null
    );
    assert.deepEqual(
      await eventDetails(runner, runId, "completion.publication_refused"),
      [refusedEvent(attempt, refused)]
    );
    assert.deepEqual(
      await eventDetails(runner, runId, "completion.publication_applied"),
      []
    );
    assert.equal(
      (await runner.status()).completionPublication?.action,
      "cancel"
    );
  });
});

test("a published report that changes before its receipt is sealed is an integrity refusal at publication", async () => {
  await inRepository(async (root) => {
    const { adapters, runner } = publicationRunner(root);
    const writeReceipt = runner.store.writeCompletionPublication.bind(
      runner.store
    );
    let receiptFailed = false;
    runner.store.writeCompletionPublication = async (runId, receipt) => {
      if (!receiptFailed) {
        receiptFailed = true;
        throw new Error("EIO: injected receipt write failure");
      }
      await writeReceipt(runId, receipt);
    };
    const { runId, attempt } = await approveIntoRefusal(runner);
    assert.equal(receiptFailed, true);
    const io = (await runner.store.readState(runId)).completionPublication
      ?.refusal;
    assert.ok(
      io?.code === "COMPLETION_PUBLICATION_IO" && io.stage === "receipt"
    );
    const capture = await runner.store.readCompletionCaptureIfExists(
      runId,
      attempt
    );
    const candidate = await runner.store.readCompletionCandidateIfExists(
      runId,
      attempt
    );
    assert.ok(capture && candidate);
    const destination = path.join(root, candidate.candidate.destination);
    assert.ok((await readFile(destination)).equals(candidate.bytes));

    // The resume finds the candidate already published and skips replacement;
    // an edit after the candidate cursor is durable reaches the final check.
    const edit = Buffer.from("\nConcurrent edit.\n");
    const writeState = runner.store.writeState.bind(runner.store);
    let edited = false;
    runner.store.writeState = async (state) => {
      await writeState(state);
      if (
        !edited &&
        state.completionPublication?.stage === "candidate" &&
        state.completionPublication.refusal === null
      ) {
        edited = true;
        await appendFile(destination, edit);
      }
    };
    await resumeWithoutModel(adapters, runner);
    assert.equal(edited, true);
    const refused = {
      code: "COMPLETION_PUBLICATION_INTEGRITY",
      stage: "publication",
      proofDigest: capture.integrityDigest
    } as const;
    const persisted = await assertRunnerRefusal(runner, runId, attempt, {
      blockReason: `[COMPLETION_PUBLICATION_INTEGRITY] Completion publication for implementation attempt ${attempt.id} stopped at stage publication. The published implementation report does not equal the candidate bytes. Cancel the run unless intact proof can be reproduced by a corrected runner.`,
      cursor: cursor({
        attemptId: attempt.id,
        stage: "publication",
        captureDigest: capture.integrityDigest,
        candidateDigest: candidate.candidate.integrityDigest,
        refusal: refused
      })
    });
    assert.equal(persisted.planTaskCompletion, null);
    assert.ok(
      (await readFile(destination)).equals(
        Buffer.concat([candidate.bytes, edit])
      )
    );
    assert.equal(
      await runner.store.readCompletionPublicationIfExists(runId, attempt),
      null
    );
    assert.deepEqual(
      await eventDetails(runner, runId, "completion.publication_refused"),
      [refusedEvent(attempt, io), refusedEvent(attempt, refused)]
    );
    assert.deepEqual(
      await eventDetails(runner, runId, "completion.publication_applied"),
      []
    );
    assert.equal(
      (await runner.status()).completionPublication?.action,
      "cancel"
    );
  });
});
