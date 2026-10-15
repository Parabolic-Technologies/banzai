export class ProjectFileError extends Error {
  code: string;
  constructor(code: string, message: string);
}
export const METADATA_LIMIT: number;
export function fail(code: string, message: string): never;
export function digestBytes(value: string | Uint8Array): string;
export function canonicalJson(value: unknown): string;
export function exactObject(
  value: unknown,
  required: string[],
  optional?: string[],
): Record<string, unknown>;
export function relativePath(value: unknown): string;
export function safePath(
  root: string,
  relative: string,
  options?: { missing?: boolean; directory?: boolean },
): Promise<string>;
export function readBytes(
  root: string,
  relative: string,
  options?: { optional?: boolean; limit?: number },
): Promise<Buffer | null>;
export function readJson(
  root: string,
  relative: string,
  optional?: boolean,
): Promise<unknown>;
export function makeDirectories(root: string, relative: string): Promise<void>;
export function publishNew(
  root: string,
  relative: string,
  bytes: string | Uint8Array,
): Promise<void>;
export function projectRoot(input: string): Promise<string>;
export function readInvocationBytes(input: string, label: string, options?: {optional?: boolean; limit?: number}): Promise<Buffer | null>;
export function git(root: string, args: string[]): Promise<{stdout: string; stderr: string}>;
export function ignored(root: string, relative: string, includeTracked?: boolean): Promise<boolean>;
export function verifyExecutionIgnore(root: string, relative: string): Promise<void>;
