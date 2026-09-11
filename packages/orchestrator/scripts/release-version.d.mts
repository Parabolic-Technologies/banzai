import type { Stats } from "node:fs";

export interface VersionFileSystem {
  realpath(path: string): Promise<string>;
  lstat(path: string): Promise<Stats>;
  readFile(path: string): Promise<Buffer>;
  readdir(path: string): Promise<string[]>;
  makeDirectory(path: string, mode: number): Promise<void>;
  remove(
    path: string,
    options?: { recursive?: boolean; force?: boolean }
  ): Promise<void>;
  move(source: string, target: string): Promise<void>;
  setMode(path: string, mode: number): Promise<void>;
  writeFileDurable(
    path: string,
    contents: Uint8Array,
    mode: number,
    exclusive?: boolean
  ): Promise<void>;
  syncFile(path: string): Promise<void>;
  syncDirectory(path: string): Promise<void>;
}

export interface VersionSurface {
  readonly path: string;
  readonly pointer: string;
}

export class VersionOperationError extends Error {
  readonly code: string;
  readonly relativePath: string;
  readonly detail: string;
  readonly signal: "SIGINT" | "SIGTERM" | null;
}

export const RECOVERY_DIRECTORY: ".banzai-version-set";
export const RECOVERY_GUARD: ".banzai-version-set.guard";
export const VERSION_SURFACES: readonly VersionSurface[];

export function createNodeVersionFileSystem(): VersionFileSystem;
export function signalAbortReason(
  signal: "SIGINT" | "SIGTERM"
): VersionOperationError;
export function processIsAlive(pid: number): boolean;
export function formatVersionOperationError(error: unknown): string;

export function setProjectVersion(options: {
  root: string;
  targetVersion: string;
  ownerPid: number;
  signal?: AbortSignal;
  fileSystem?: VersionFileSystem;
}): Promise<{
  version: string;
  transition: "bootstrap" | "forward";
  fieldCount: number;
  paths: string[];
}>;

export function recoverProjectVersion(options: {
  root: string;
  fileSystem?: VersionFileSystem;
  isProcessAlive?: (pid: number) => boolean;
}): Promise<{ action: "cleaned" | "restored"; paths: string[] }>;
