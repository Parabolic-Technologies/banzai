import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  formatVersionOperationError,
  setProjectVersion,
  signalAbortReason,
  VersionOperationError
} from "./release-version.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const defaultRepositoryRoot = path.resolve(
  path.dirname(scriptPath),
  "../../.."
);

export async function runVersionSetCli(options = {}) {
  const args = options.args ?? process.argv.slice(2);
  const processLike = options.processLike ?? process;
  const writeOut = options.writeOut ?? ((value) => process.stdout.write(value));
  const writeError =
    options.writeError ?? ((value) => process.stderr.write(value));
  if (args.length !== 1) {
    const error = new VersionOperationError(
      "INVALID_VERSION_ARGUMENT",
      "version-set.mjs",
      "expected exactly one canonical SemVer core target"
    );
    writeError(`${error.message}\n`);
    return 1;
  }

  const controller = new AbortController();
  const handlers = new Map();
  for (const signal of ["SIGINT", "SIGTERM"]) {
    const handler = () => {
      if (!controller.signal.aborted) {
        controller.abort(signalAbortReason(signal));
      }
    };
    handlers.set(signal, handler);
    processLike.on(signal, handler);
  }

  try {
    const result = await setProjectVersion({
      root: options.root ?? defaultRepositoryRoot,
      targetVersion: args[0],
      ownerPid: options.ownerPid ?? processLike.pid,
      signal: controller.signal,
      ...(options.fileSystem === undefined
        ? {}
        : { fileSystem: options.fileSystem })
    });
    writeOut(
      `Banzai release-train version set to ${result.version} across ${result.fieldCount} version fields in ${result.paths.length} files.\n`
    );
    return 0;
  } catch (error) {
    writeError(`${formatVersionOperationError(error)}\n`);
    if (
      error instanceof VersionOperationError &&
      (error.signal === "SIGINT" || error.signal === "SIGTERM")
    ) {
      return error.signal === "SIGINT" ? 130 : 143;
    }
    return 1;
  } finally {
    for (const [signal, handler] of handlers) {
      processLike.removeListener(signal, handler);
    }
  }
}

if (
  path.basename(scriptPath) === "version-set.mjs" &&
  process.argv[1] &&
  path.resolve(process.argv[1]) === scriptPath
) {
  process.exitCode = await runVersionSetCli();
}
