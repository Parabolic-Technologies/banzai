#!/usr/bin/env node
"use strict";
(async () => {
  let version = 1;
  try {
    const { readFile, lstat } = await import("node:fs/promises");
    const args = process.argv.slice(2);
    if (args.length !== 3 || args[1] !== "--json") throw new Error("Use verification.cjs <inspect|decide|execute> --json <request-file>.");
    const info = await lstat(args[2]);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 65536) throw new Error("Invalid verification request file.");
    const { verificationOperation } = await import("../lib/verification-helper.mjs");
    const request = JSON.parse(await readFile(args[2], "utf8"));
    version = request.schemaVersion === 2 ? 2 : 1;
    const result = await verificationOperation(args[0], request);
    process.stdout.write(JSON.stringify({ schema: `banzai-verification-result/v${version}`, schemaVersion: version, ok: true, result, error: null }) + "\n");
    if (version === 2 && args[0] === "execute" && !result.applicability?.complete) process.exitCode = 1;
    if (args[0] === "execute" && result.supported && result.applicability?.dispositions.find((item) => item.checkId === request.checkId)?.kind === "pending") process.exitCode = 1;
  } catch (error) {
    const policyInvalid = error?.code === "VERIFICATION_POLICY_INVALID";
    process.stdout.write(JSON.stringify({ schema: `banzai-verification-result/v${version}`, schemaVersion: version, ok: false, result: null,
      error: { code: policyInvalid ? "VERIFICATION_POLICY_INVALID" : "VERIFICATION_EVIDENCE_INVALID", message: policyInvalid ? "The declared task verification policy is invalid. Correct verification.policy before execution." : "Verification could not establish valid bound evidence. Inspect configuration, work ownership and retained attempts; keep required checks fresh." } }) + "\n");
    process.exitCode = 1;
  }
})();
