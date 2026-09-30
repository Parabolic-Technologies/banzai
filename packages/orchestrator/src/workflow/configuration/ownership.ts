import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Marks work running inside a configuration action that already holds the
 * repository owner, so a nested workflow lock request inherits that lock.
 * The scope follows async context, including concurrent work started there.
 */
export class ConfigurationOwnership {
  private readonly scope = new AsyncLocalStorage<boolean>();

  owned(): boolean {
    return this.scope.getStore() === true;
  }

  run<T>(action: () => Promise<T>): Promise<T> {
    return this.scope.run(true, action);
  }
}
