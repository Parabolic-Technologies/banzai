import assert from "node:assert/strict";
import test from "node:test";
import { completionInvalidCheckpoint } from "../../../src/workflow/domain/completion-checkpoint.js";

test("an invalid completion claim is recorded in the persisted field order for both attempt kinds", () => {
  const rows: [Parameters<typeof completionInvalidCheckpoint>[0], string][] = [
    [
      {
        sourceAttemptId: "attempt-1",
        sourceAttemptKind: "implementation",
        violation: "missing_task",
        taskId: "T002",
        recordedAt: "2026-01-01T00:00:00.000Z"
      },
      '{"schemaVersion":1,"status":"invalid","sourceAttemptId":"attempt-1","sourceAttemptKind":"implementation","errorCode":"PLAN_TASK_COMPLETION_INVALID","violation":"missing_task","taskId":"T002","recordedAt":"2026-01-01T00:00:00.000Z"}'
    ],
    [
      {
        sourceAttemptId: "attempt-2",
        sourceAttemptKind: "fix",
        violation: "missing_ledger",
        taskId: null,
        recordedAt: "2026-01-02T00:00:00.000Z"
      },
      '{"schemaVersion":1,"status":"invalid","sourceAttemptId":"attempt-2","sourceAttemptKind":"fix","errorCode":"PLAN_TASK_COMPLETION_INVALID","violation":"missing_ledger","taskId":null,"recordedAt":"2026-01-02T00:00:00.000Z"}'
    ]
  ];
  for (const [facts, serialized] of rows)
    assert.equal(
      JSON.stringify(completionInvalidCheckpoint(facts)),
      serialized,
      facts.sourceAttemptKind
    );
});
