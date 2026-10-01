import assert from "node:assert/strict";
import test from "node:test";
import { ActivitySequence } from "../../src/workflow/activity-sequence.js";

test("activity identifiers count from one per sequence", () => {
  const first = new ActivitySequence();
  const second = new ActivitySequence();
  assert.deepEqual(
    [first.next(), first.next(), second.next(), first.next()],
    ["activity-1", "activity-2", "activity-1", "activity-3"]
  );
});
