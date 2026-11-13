import type { QuickbenConfig } from "@quickben/core";

/** What the connections server actions need to know about an admin instance. */
export interface ConnectionsAdminInstance {
  config: QuickbenConfig;
  basePath: string;
}

const registryKey = Symbol.for("quickben.connections.admin");

function registry(): Map<string, ConnectionsAdminInstance> {
  const store = globalThis as typeof globalThis & Record<symbol, unknown>;
  store[registryKey] ??= new Map<string, ConnectionsAdminInstance>();
  return store[registryKey] as Map<string, ConnectionsAdminInstance>;
}

/**
 * Register an instance and return its key. Server actions get the key as a bound argument,
 * because a config cannot be sent to the browser and back. The base path is the key.
 */
export function registerConnectionsAdmin(instance: ConnectionsAdminInstance): string {
  registry().set(instance.basePath, instance);
  return instance.basePath;
}

/** Look up a registered instance. */
export function getConnectionsAdmin(key: string): ConnectionsAdminInstance | undefined {
  return registry().get(key);
}

/** `admin/` → `/admin`. */
export function normalizeBasePath(basePath: string): string {
  let end = basePath.length;
  while (end > 0 && basePath[end - 1] === "/") end -= 1;
  const trimmed = basePath.slice(0, end);
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}
