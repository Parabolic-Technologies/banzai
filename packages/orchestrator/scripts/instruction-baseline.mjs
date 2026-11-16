import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  describeInstructionTransition,
  evolveInstructionBaseline,
  initializeInstructionBaseline
} from "./successor-baseline.mjs";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../.."
);
const WRITING_FORMS = new Map([
  ["--authorization", evolveInstructionBaseline],
  ["--initialize", initializeInstructionBaseline]
]);
try {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--describe") {
    process.stdout.write(
      JSON.stringify(await describeInstructionTransition(root), null, 2) + "\n"
    );
  } else {
    const check = args.at(-1) === "--check";
    const write = WRITING_FORMS.get(args[0]);
    if (!write || !args[1] || args.length !== (check ? 3 : 2))
      throw new Error(
        "Usage: node scripts/instruction-baseline.mjs --describe | --authorization <json-file> [--check] | --initialize <json-file> [--check]"
      );
    const input = JSON.parse(await readFile(args[1], "utf8"));
    process.stdout.write(
      JSON.stringify(await write(root, input, { check })) + "\n"
    );
  }
} catch (error) {
  process.stderr.write(`INSTRUCTION_RESOURCE_DRIFT ${error.message}\n`);
  process.exitCode = 1;
}
