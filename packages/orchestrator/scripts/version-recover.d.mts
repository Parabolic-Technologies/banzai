import type { VersionFileSystem } from "./release-version.mjs";

export function runVersionRecoverCli(options?: {
  args?: string[];
  root?: string;
  fileSystem?: VersionFileSystem;
  isProcessAlive?: (pid: number) => boolean;
  writeOut?: (value: string) => void;
  writeError?: (value: string) => void;
}): Promise<number>;
