export function readTar(bytes: Uint8Array): Map<string, Buffer>;
export function inspectPublicationFiles(
  policy: unknown,
  files: Map<string, Buffer>,
  options?: { distribution?: "source" | "plugin" | "npm" }
): unknown;
