import type { BoundWork } from "./work-documents.mjs";
export function executionKey(directory: string): string;
export function ensureExecutionIgnores(root: string): Promise<boolean>;
export function verifyExecutionIgnore(root: string, relative: string): Promise<void>;
export function withExecutionOwnership<T>(root: string, directory: string, action: () => Promise<T>, identity?: string | null): Promise<T>;
export function hasRunnerWorkOwnership(root: string, bound: BoundWork | undefined): Promise<boolean>;
export function withRunnerWorkOwnership<T>(root: string, bound: BoundWork | undefined, action: () => Promise<T>, options?: { recoverStale?: boolean }): Promise<T>;
