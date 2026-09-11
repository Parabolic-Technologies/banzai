#!/usr/bin/env node
"use strict";

import("../lib/artifact-storage.mjs")
  .then(async ({ artifactCommand }) => {
    const response = await artifactCommand(process.argv.slice(2));
    process.stdout.write(JSON.stringify(response) + "\n");
    process.exitCode = response.ok ? 0 : 1;
  })
  .catch(() => {
    process.stderr.write(
      "Artifact storage could not be loaded. Reinstall a compatible plugin.\n",
    );
    process.exitCode = 1;
  });
