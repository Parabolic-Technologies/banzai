import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  evolveGuidanceBaseline,
  describeGuidanceTransition
} from "./phase-resources-build.mjs";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../.."
);
try {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--describe") {
    process.stdout.write(
      JSON.stringify(await describeGuidanceTransition(root), null, 2) + "\n"
    );
  } else {
    const check = args.at(-1) === "--check";
    if (
      args[0] !== "--authorization" ||
      !args[1] ||
      args.length !== (check ? 3 : 2)
    )
      throw new Error(
        "Usage: node scripts/instruction-baseline.mjs --authorization <json-file> [--check]"
      );
    const authorization = JSON.parse(await readFile(args[1], "utf8"));
    process.stdout.write(
      JSON.stringify(
        await evolveGuidanceBaseline(root, authorization, { check })
      ) + "\n"
    );
  }
} catch (error) {
  process.stderr.write(`INSTRUCTION_RESOURCE_DRIFT ${error.message}\n`);
  process.exitCode = 1;
}
