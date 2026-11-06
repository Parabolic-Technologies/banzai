import assert from "node:assert/strict";
import test from "node:test";
import {
  emptyProbeObservation,
  observeProbeLine,
  probeVerdict,
  type ProbeInvocation,
  type ProbeObservation
} from "./probes/gate-1-probe.js";

const INIT = { type: "system", subtype: "init", session_id: "session" };
const BASH = {
  type: "assistant",
  message: {
    content: [
      {
        type: "tool_use",
        id: "tool-1",
        name: "Bash",
        input: { command: "sh ./probe.sh", timeout: 900_000 }
      }
    ]
  }
};
const BASH_DONE = {
  type: "user",
  message: {
    content: [{ type: "tool_result", tool_use_id: "tool-1", content: "" }]
  }
};
const RESULT = {
  type: "result",
  subtype: "success",
  is_error: false,
  permission_denials: [],
  session_id: "session"
};

function observe(
  events: readonly unknown[],
  sentinel: () => boolean = () => true
): ProbeObservation {
  const observation = emptyProbeObservation();
  for (const event of events) {
    observeProbeLine(observation, JSON.stringify(event), sentinel);
  }
  // Non-JSON output never counts as an event.
  observeProbeLine(observation, "not json", sentinel);
  return observation;
}

function invocation(
  observation: ProbeObservation,
  overrides: Partial<ProbeInvocation> = {}
): ProbeInvocation {
  return { observation, exitCode: 0, errorCode: null, ...overrides };
}

const resumed = invocation(observe([INIT, RESULT]));

test("one result after the sentinel, with no background event, passes", () => {
  const first = observe([INIT, BASH, BASH_DONE, RESULT]);
  assert.deepEqual(first, {
    results: 1,
    permissionDenials: 0,
    backgroundEvents: 0,
    sentinelAtFirstResult: true
  });
  assert.equal(probeVerdict(invocation(first), resumed), "pass");
});

test("a second result fails the probe", () => {
  const first = observe([INIT, BASH, BASH_DONE, RESULT, RESULT]);
  assert.equal(first.results, 2);
  assert.equal(probeVerdict(invocation(first), resumed), "fail");
  assert.equal(
    probeVerdict(
      invocation(observe([INIT, BASH, BASH_DONE, RESULT]), {
        exitCode: null,
        errorCode: "TERMINAL_RESULT_CONFLICT"
      }),
      resumed
    ),
    "fail"
  );
});

test("each kind of background-task event fails the probe", () => {
  const backgrounded = {
    ...BASH,
    message: {
      content: [
        {
          ...BASH.message.content[0],
          input: { command: "sh ./probe.sh", run_in_background: true }
        }
      ]
    }
  };
  const movedResult = {
    type: "user",
    message: {
      content: [
        {
          type: "tool_result",
          tool_use_id: "tool-1",
          content: [
            {
              type: "text",
              text: "Command running in background with ID: bash_1"
            }
          ]
        }
      ]
    }
  };
  const taskEvent = { type: "system", subtype: "task_started" };
  for (const event of [backgrounded, movedResult, taskEvent]) {
    const first = observe([INIT, event, RESULT]);
    assert.equal(first.backgroundEvents, 1, JSON.stringify(event));
    assert.equal(probeVerdict(invocation(first), resumed), "fail");
  }
});

test("a permission denial, a missing sentinel or a failed exit fails the probe", () => {
  const denied = observe([
    INIT,
    { ...RESULT, permission_denials: [{ tool_name: "Bash" }] }
  ]);
  assert.equal(denied.permissionDenials, 1);
  assert.equal(probeVerdict(invocation(denied), resumed), "fail");

  const early = observe([INIT, BASH, RESULT], () => false);
  assert.equal(early.sentinelAtFirstResult, false);
  assert.equal(probeVerdict(invocation(early), resumed), "fail");

  const first = invocation(observe([INIT, BASH, BASH_DONE, RESULT]));
  assert.equal(probeVerdict({ ...first, exitCode: 1 }, resumed), "fail");
  assert.equal(probeVerdict(first, { ...resumed, exitCode: 1 }), "fail");
  assert.equal(
    probeVerdict(first, invocation(observe([INIT, RESULT, RESULT]))),
    "fail"
  );
});

test("another adapter error with clean counts is inconclusive", () => {
  const first = invocation(observe([INIT, BASH, BASH_DONE, RESULT]), {
    errorCode: "MODEL_OUTPUT_INVALID"
  });
  assert.equal(probeVerdict(first, resumed), "inconclusive");
});
