import type { RunStore } from "../../src/store.js";
import type { VendorAdapters } from "../../src/types.js";
import type { RunnerContext } from "../../src/workflow/context.js";

export interface RecordingContext {
  context: RunnerContext;
  /** Store method names in call order. */
  calls: string[];
}

/**
 * A runner context whose store answers only the methods a test names. Any
 * other store call fails the test, so an assertion on `calls` also proves
 * which persistence effects happened before a failure.
 */
export function recordingContext(
  methods: Record<string, (...args: never[]) => unknown>,
  repoRoot = "/nonexistent-banzai-test-root"
): RecordingContext {
  const calls: string[] = [];
  const store = new Proxy(
    {},
    {
      get: (_target, property) => {
        const name = String(property);
        const method = methods[name];
        if (method === undefined)
          return () => {
            throw new Error(`Unexpected store.${name} call.`);
          };
        return (...args: never[]) => {
          calls.push(name);
          return method(...args);
        };
      }
    }
  ) as RunStore;
  const context: RunnerContext = Object.freeze({
    repoRoot,
    store,
    adapters: {} as VendorAdapters,
    processRunner: () => Promise.reject(new Error("No process expected.")),
    progressReporter: () => {},
    humanTimeObserver: undefined,
    clock: () => new Date("2026-07-01T00:00:00.000Z"),
    ids: () => "00000000-0000-4000-8000-000000000000"
  });
  return { context, calls };
}
