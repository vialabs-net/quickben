import type { QuickbenConfig } from "@quickben/core";

/** What the doc reader's server actions need to know about an admin instance. */
export interface DocReaderAdminInstance {
  config: QuickbenConfig;
  basePath: string;
}

const registryKey = Symbol.for("quickben.doc-reader.admin");

function registry(): Map<string, DocReaderAdminInstance> {
  const store = globalThis as typeof globalThis & Record<symbol, unknown>;
  store[registryKey] ??= new Map<string, DocReaderAdminInstance>();
  return store[registryKey] as Map<string, DocReaderAdminInstance>;
}

/**
 * Register an instance and return its key. Server actions get the key as a bound argument,
 * because a config cannot be sent to the browser and back. The base path is the key.
 */
export function registerDocReaderAdmin(instance: DocReaderAdminInstance): string {
  registry().set(instance.basePath, instance);
  return instance.basePath;
}

export function getDocReaderAdmin(key: string): DocReaderAdminInstance | undefined {
  return registry().get(key);
}
