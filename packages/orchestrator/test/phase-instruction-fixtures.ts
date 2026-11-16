import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { EMBEDDED_PHASE_RESOURCES } from "../src/phase-resources.js";
const SOURCE_PLUGIN = path.resolve(process.cwd(), "../../plugins/banzai");
const INSTALLED_TEXT_DIRECTORIES = ["phases", "guidance", "policies"];

/**
 * An installed plugin whose phase documents, guidance and policies are the
 * runner's frozen text, so no test depends on the plugin's own text files.
 */
export async function instructionPluginFixture(): Promise<{
  directory: string;
  dispose(): Promise<void>;
}> {
  const directory = await mkdtemp(
    path.join(tmpdir(), "banzai-instruction-fixture-")
  );
  await cp(SOURCE_PLUGIN, directory, { recursive: true });
  for (const name of INSTALLED_TEXT_DIRECTORIES)
    await rm(path.join(directory, name), { recursive: true, force: true });
  for (const [id, resource] of Object.entries(EMBEDDED_PHASE_RESOURCES)) {
    if (!("text" in resource)) continue;
    const file = path.join(directory, id);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, resource.text);
  }
  return {
    directory,
    dispose: () => rm(directory, { recursive: true, force: true })
  };
}
