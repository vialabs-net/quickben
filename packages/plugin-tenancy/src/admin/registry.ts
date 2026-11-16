import type { QuickbenConfig } from "@quickben/core";

/** What the tenancy server actions need to know about an admin instance. */
export interface TenancyAdminInstance {
  config: QuickbenConfig;
  basePath: string;
  /** Where the switcher goes after a switch. Default: the admin dashboard. */
  organizationHref: ((organizationId: string) => string) | undefined;
}

const registryKey = Symbol.for("quickben.tenancy.admin");

function registry(): Map<string, TenancyAdminInstance> {
  const store = globalThis as typeof globalThis & Record<symbol, unknown>;
  store[registryKey] ??= new Map<string, TenancyAdminInstance>();
  return store[registryKey] as Map<string, TenancyAdminInstance>;
}

/**
 * Register an instance and return its key. Server actions get the key as a bound argument,
 * because a config cannot be sent to the browser and back. The base path is the key.
 */
export function registerTenancyAdmin(instance: TenancyAdminInstance): string {
  // `tenancyAdmin` and `createOrganizationSwitcher` share a key: keep a link given by either.
  const organizationHref =
    instance.organizationHref ?? registry().get(instance.basePath)?.organizationHref;
  registry().set(instance.basePath, { ...instance, organizationHref });
  return instance.basePath;
}

/** Look up a registered instance. */
export function getTenancyAdmin(key: string): TenancyAdminInstance | undefined {
  return registry().get(key);
}
