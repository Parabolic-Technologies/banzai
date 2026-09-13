import assert from "node:assert/strict";
import test from "node:test";
import packageMetadata from "../package.json" with { type: "json" };
import { BanzaiError, ResourceVersionUnsupportedError } from "../src/errors.js";
import { unsupportedResourceVersion } from "../../../plugins/banzai/lib/artifact-storage.mjs";

test("unsupported resource versions have the same release-derived error in CLI and plugin", () => {
  const major = Number(packageMetadata.version.split(".")[0]);
  const expected = `run state version 4 is not supported; ${major}.x supports 5; last read by release-train major ${major - 1}`;
  const error = new ResourceVersionUnsupportedError("run state", 4, 5);
  assert.ok(error instanceof BanzaiError);
  assert.equal(error.code, "RESOURCE_VERSION_UNSUPPORTED");
  assert.equal(error.exitCode, 1);
  assert.equal(error.message, expected);
  assert.throws(() => unsupportedResourceVersion("run state", 4, 5), {
    code: "RESOURCE_VERSION_UNSUPPORTED",
    message: expected
  });
});
