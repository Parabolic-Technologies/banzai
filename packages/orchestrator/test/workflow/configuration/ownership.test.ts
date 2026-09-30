import assert from "node:assert/strict";
import test from "node:test";
import { ConfigurationOwnership } from "../../../src/workflow/configuration/ownership.js";

test("configuration ownership holds only inside its action and its async work", async () => {
  const ownership = new ConfigurationOwnership();
  const other = new ConfigurationOwnership();
  assert.equal(ownership.owned(), false);
  const observed = await ownership.run(async () => {
    const nested = await Promise.all([
      Promise.resolve().then(() => ownership.owned()),
      new Promise<boolean>((resolve) =>
        setTimeout(() => {
          resolve(ownership.owned());
        }, 1)
      )
    ]);
    return { direct: ownership.owned(), nested, other: other.owned() };
  });
  assert.deepEqual(observed, {
    direct: true,
    nested: [true, true],
    other: false
  });
  assert.equal(ownership.owned(), false);
});

test("configuration ownership propagates the action's result and failure", async () => {
  const ownership = new ConfigurationOwnership();
  assert.equal(await ownership.run(() => Promise.resolve(7)), 7);
  await assert.rejects(
    ownership.run(() => Promise.reject(new Error("configuration failed"))),
    /configuration failed/
  );
  assert.equal(ownership.owned(), false);
});
