import { checkInstructionPayloads } from "./phase-resources-build.mjs";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  rm
} from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  collectPublicationTree,
  parsePublicationPolicy,
  inspectPublicationFiles,
  readTar
} from "./publication-check.mjs";
const execute = promisify(execFile);
const root = process.cwd();
const scratch = await mkdtemp(path.join(tmpdir(), "banzai-publication-"));
try {
  const files = await collectPublicationTree(root, "staged");
  const stagedPolicy = files.get("publication-policy.json");
  const policyBytes =
    stagedPolicy ??
    (await readFile(path.join(root, "publication-policy.json")));
  const policy = parsePublicationPolicy(
    JSON.parse(policyBytes.toString("utf8"))
  );
  const results = {
    indexed: inspectPublicationFiles(policy, files),
    policySource: stagedPolicy ? "index" : "explicit-local-inventory"
  };
  const source = path.join(scratch, "source");
  await mkdir(source, { mode: 0o700 });
  for (const [name, bytes] of files) {
    await mkdir(path.dirname(path.join(source, name)), { recursive: true });
    await writeFile(path.join(source, name), bytes);
  }
  const sourceArchive = path.join(scratch, "source.tar.gz");
  await execute("tar", ["-czf", sourceArchive, "-C", source, "."], {
    env: { ...process.env, COPYFILE_DISABLE: "1" }
  });
  const sourceFiles = readTar(await readFile(sourceArchive));
  results.sourceArchive = inspectPublicationFiles(policy, sourceFiles);
  const pluginArchive = path.join(scratch, "plugin.tar.gz");
  await execute(
    "tar",
    ["-czf", pluginArchive, "-C", source, "plugins/banzai"],
    { env: { ...process.env, COPYFILE_DISABLE: "1" } }
  );
  const pluginFiles = readTar(await readFile(pluginArchive));
  results.pluginArchive = inspectPublicationFiles(policy, pluginFiles, {
    distribution: "plugin"
  });
  await execute(
    "npm",
    [
      "pack",
      "--workspace",
      "@parabolic-technologies/banzai",
      "--ignore-scripts",
      "--offline",
      "--pack-destination",
      scratch
    ],
    {
      cwd: root,
      maxBuffer: 1024 * 1024,
      env: { ...process.env, npm_config_cache: path.join(scratch, "npm-cache") }
    }
  );
  const packages = (await readdir(scratch)).filter((name) =>
    name.endsWith(".tgz")
  );
  if (packages.length !== 1)
    throw new Error(
      "PUBLICATION_PACKAGE_INVALID: npm did not produce exactly one package."
    );
  const npmFiles = readTar(await readFile(path.join(scratch, packages[0])));
  results.npmTarball = inspectPublicationFiles(policy, npmFiles, {
    distribution: "npm"
  });
  results.instructions = await checkInstructionPayloads(root, {
    source: sourceFiles,
    plugin: pluginFiles,
    npm: npmFiles
  });
  process.stdout.write(JSON.stringify(results) + "\n");
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
} finally {
  await rm(scratch, { recursive: true, force: true });
}
