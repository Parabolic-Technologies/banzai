#!/usr/bin/env node
"use strict";
(async () => {
  try {
    const { readFile, lstat } = await import("node:fs/promises");
    const args = process.argv.slice(2);
    if (args.length !== 3 || args[1] !== "--json") throw new Error("Use verification.cjs <inspect|decide|execute> --json <request-file>.");
    const info = await lstat(args[2]);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 65536) throw new Error("Invalid verification request file.");
    const { verificationOperation } = await import("../lib/verification-helper.mjs");
    const request = JSON.parse(await readFile(args[2], "utf8"));
    const result = await verificationOperation(args[0], request);
    process.stdout.write(JSON.stringify({ schema: "banzai-verification-result/v1", schemaVersion: 1, ok: true, result, error: null }) + "\n");
    if (args[0] === "execute" && result.supported && result.applicability?.dispositions.find((item) => item.checkId === request.checkId)?.kind === "pending") process.exitCode = 1;
  } catch {
    process.stdout.write(JSON.stringify({ schema: "banzai-verification-result/v1", schemaVersion: 1, ok: false, result: null,
      error: { code: "VERIFICATION_EVIDENCE_INVALID", message: "Verification could not establish valid bound evidence. Inspect configuration, work ownership and retained attempts; keep required checks fresh." } }) + "\n");
    process.exitCode = 1;
  }
})();
