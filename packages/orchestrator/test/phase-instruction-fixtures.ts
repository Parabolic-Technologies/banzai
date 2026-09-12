import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
const SOURCE_PLUGIN = path.resolve(process.cwd(), "../../plugins/banzai");

export async function instructionPluginFixture(): Promise<{
  directory: string;
  dispose(): Promise<void>;
}> {
  const directory = await mkdtemp(
    path.join(tmpdir(), "banzai-instruction-fixture-")
  );
  await cp(SOURCE_PLUGIN, directory, { recursive: true });
  return {
    directory,
    dispose: () => rm(directory, { recursive: true, force: true })
  };
}
