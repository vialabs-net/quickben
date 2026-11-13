import type { QuickbenConfig } from "@quickben/core";

/** What the default server function needs to know about an admin instance. */
export interface AdminInstance {
  config: QuickbenConfig;
  basePath: string;
}

const registryKey = Symbol.for("quickben.admin.instances");

function registry(): Map<string, AdminInstance> {
  const store = globalThis as typeof globalThis & Record<symbol, unknown>;
  store[registryKey] ??= new Map<string, AdminInstance>();
  return store[registryKey] as Map<string, AdminInstance>;
}

/**
 * Register an admin instance and return its key. The default server function receives the
 * key as a bound argument and looks the config up here, because a config (functions, a
 * database client) cannot be sent to the browser and back. The base path is the key.
 */
export function registerAdmin(instance: AdminInstance): string {
  registry().set(instance.basePath, instance);
  return instance.basePath;
}

/** Look up a registered admin instance. */
export function getAdmin(key: string): AdminInstance | undefined {
  return registry().get(key);
}
