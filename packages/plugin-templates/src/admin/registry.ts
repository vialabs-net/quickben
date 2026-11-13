import type { QuickbenConfig } from "@quickben/core";

/** What the templates server actions need to know about an admin instance. */
export interface TemplatesAdminInstance {
  config: QuickbenConfig;
  basePath: string;
}

const registryKey = Symbol.for("quickben.templates.admin");

function registry(): Map<string, TemplatesAdminInstance> {
  const store = globalThis as typeof globalThis & Record<symbol, unknown>;
  store[registryKey] ??= new Map<string, TemplatesAdminInstance>();
  return store[registryKey] as Map<string, TemplatesAdminInstance>;
}

/**
 * Register an instance and return its key. Server actions get the key as a bound argument,
 * because a config cannot be sent to the browser and back. The base path is the key.
 */
export function registerTemplatesAdmin(instance: TemplatesAdminInstance): string {
  registry().set(instance.basePath, instance);
  return instance.basePath;
}

/** Look up a registered instance. */
export function getTemplatesAdmin(key: string): TemplatesAdminInstance | undefined {
  return registry().get(key);
}
