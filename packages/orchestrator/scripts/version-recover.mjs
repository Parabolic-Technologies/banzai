import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  formatVersionOperationError,
  recoverProjectVersion,
  VersionOperationError
} from "./release-version.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const defaultRepositoryRoot = path.resolve(
  path.dirname(scriptPath),
  "../../.."
);

export async function runVersionRecoverCli(options = {}) {
  const args = options.args ?? process.argv.slice(2);
  const writeOut = options.writeOut ?? ((value) => process.stdout.write(value));
  const writeError =
    options.writeError ?? ((value) => process.stderr.write(value));
  if (args.length !== 0) {
    const error = new VersionOperationError(
      "INVALID_VERSION_RECOVERY_ARGUMENT",
      "version-recover.mjs",
      "recovery accepts no arguments"
    );
    writeError(`${error.message}\n`);
    return 1;
  }
  try {
    const result = await recoverProjectVersion({
      root: options.root ?? defaultRepositoryRoot,
      ...(options.fileSystem === undefined
        ? {}
        : { fileSystem: options.fileSystem }),
      ...(options.isProcessAlive === undefined
        ? {}
        : { isProcessAlive: options.isProcessAlive })
    });
    writeOut(
      result.action === "restored"
        ? `Restored ${result.paths.length} version files to their exact pre-transaction state.\n`
        : "Removed a pre-ready version transaction after proving all surfaces remained unchanged.\n"
    );
    return 0;
  } catch (error) {
    writeError(`${formatVersionOperationError(error)}\n`);
    return 1;
  }
}

if (
  path.basename(scriptPath) === "version-recover.mjs" &&
  process.argv[1] &&
  path.resolve(process.argv[1]) === scriptPath
) {
  process.exitCode = await runVersionRecoverCli();
}
