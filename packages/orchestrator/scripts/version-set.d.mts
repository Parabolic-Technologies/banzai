import type { VersionFileSystem } from "./release-version.mjs";

export function runVersionSetCli(options?: {
  args?: string[];
  root?: string;
  ownerPid?: number;
  processLike?: NodeJS.Process;
  fileSystem?: VersionFileSystem;
  writeOut?: (value: string) => void;
  writeError?: (value: string) => void;
}): Promise<number>;
