import { readFile } from "node:fs/promises";
import path from "node:path";

export async function initResourceBytes(root) {
  const canonical = await readFile(
    path.join(root, "documentation/verification-examples.md"),
    "utf8"
  );
  // Only this guide is installed locally; keep its other product-doc links usable.
  const guide = canonical.replace(
    /\]\((getting-started|orchestrator)\.md/g,
    "](https://github.com/Parabolic-Technologies/banzai/blob/main/documentation/$1.md"
  );
  return (
    "// Generated from documentation/verification-examples.md by npm run build.\n" +
    "// prettier-ignore\nexport const VERIFICATION_EXAMPLES = " +
    JSON.stringify(guide) +
    ";\n"
  );
}
