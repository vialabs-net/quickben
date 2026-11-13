import { ConfigError } from "@quickben/core";

import type { Quickben, QuickbenConfig, QuickbenUser } from "@quickben/core";

/**
 * A permission a role grants inside an organization. The built-in ones are checked by the
 * plugin. Add your own and check them with `hasCapability`.
 */
export type Capability =
  | "read"
  | "write"
  | "members:manage"
  | "organization:manage"
  | "organization:delete"
  | (string & {});

/** Capabilities per role. Order matters: the first role ranks highest. */
export type RolesConfig = Readonly<Record<string, readonly Capability[]>>;

/** Default roles, highest first. */
export const defaultRoles = {
  owner: ["read", "write", "members:manage", "organization:manage", "organization:delete"],
  admin: ["read", "write", "members:manage", "organization:manage"],
  member: ["read", "write"],
  viewer: ["read"],
} as const satisfies RolesConfig;

/** Options of `tenancy()`. */
export interface TenancyOptions<S extends string = string> {
  /** Slugs of the collections whose documents belong to one organization. */
  scope: readonly S[];
  /** Roles and their capabilities, highest rank first. Default {@link defaultRoles}. */
  roles?: RolesConfig;
  /** Role that owns an organization. Every organization keeps one active owner. Default `owner`. */
  ownerRole?: string;
  /** Role of new memberships when none is given. Default `member`. */
  defaultRole?: string;
  /**
   * Platform staff: they see every organization and may act inside any of them. Default: users
   * whose `roles` include `platform-admin`.
   */
  isPlatformAdmin?: (user: QuickbenUser) => boolean;
  /** Who may create organizations. Default: any signed-in user. Platform staff always may. */
  canCreateOrganization?: (user: QuickbenUser) => boolean;
  /** Modules a new organization gets. `"all"` = every registered module. Default `"all"`. */
  defaultModules?: "all" | readonly string[];
  /** Request header with the active organization id. Default `x-quickben-organization`. */
  header?: string;
  /** Cookie with the active organization id. Default `quickben-organization`. */
  cookie?: string;
}

/** Options after defaults are applied. Read them with `getTenancy(qb)`. */
export interface ResolvedTenancy {
  readonly scope: readonly string[];
  /** Roles, highest rank first. */
  readonly roles: readonly {
    readonly name: string;
    readonly capabilities: readonly Capability[];
  }[];
  readonly ownerRole: string;
  readonly defaultRole: string;
  readonly isPlatformAdmin: (user: QuickbenUser) => boolean;
  readonly canCreateOrganization: (user: QuickbenUser) => boolean;
  readonly defaultModules: "all" | readonly string[];
  readonly header: string;
  readonly cookie: string;
}

/** Slugs of the collections the plugin adds. */
export const ORGANIZATIONS = "organizations";
export const MEMBERSHIPS = "memberships";

export function resolveOptions(options: TenancyOptions): ResolvedTenancy {
  const rolesConfig = options.roles ?? defaultRoles;
  const roles = Object.entries(rolesConfig).map(([name, capabilities]) => ({ name, capabilities }));
  if (roles.length === 0) throw new ConfigError("tenancy: `roles` needs at least one role");
  const names = new Set(roles.map((role) => role.name));
  const ownerRole = options.ownerRole ?? "owner";
  const defaultRole = options.defaultRole ?? "member";
  for (const [key, role] of [
    ["ownerRole", ownerRole],
    ["defaultRole", defaultRole],
  ] as const) {
    if (!names.has(role)) throw new ConfigError(`tenancy: ${key} "${role}" is not in roles`);
  }
  for (const slug of options.scope) {
    if (slug === ORGANIZATIONS || slug === MEMBERSHIPS) {
      throw new ConfigError(`tenancy: "${slug}" cannot be tenant-scoped`);
    }
  }
  return {
    scope: [...new Set(options.scope)],
    roles,
    ownerRole,
    defaultRole,
    isPlatformAdmin:
      options.isPlatformAdmin ?? ((user) => user.roles?.includes("platform-admin") === true),
    canCreateOrganization: options.canCreateOrganization ?? (() => true),
    defaultModules: options.defaultModules ?? "all",
    header: (options.header ?? "x-quickben-organization").toLowerCase(),
    cookie: options.cookie ?? "quickben-organization",
  };
}

/** Capabilities of a role. Unknown roles have none. */
export function capabilitiesOf(tenancy: ResolvedTenancy, role: string): readonly Capability[] {
  return tenancy.roles.find((r) => r.name === role)?.capabilities ?? [];
}

/** Rank of a role: 0 is the highest. Unknown roles rank lowest. */
export function rankOf(tenancy: ResolvedTenancy, role: string): number {
  const index = tenancy.roles.findIndex((r) => r.name === role);
  return index === -1 ? tenancy.roles.length : index;
}

/** Every capability any role grants. Platform staff get all of them. */
export function allCapabilities(tenancy: ResolvedTenancy): readonly Capability[] {
  return [...new Set(tenancy.roles.flatMap((role) => role.capabilities))];
}

const registered = new WeakMap<QuickbenConfig, ResolvedTenancy>();

export function register(config: QuickbenConfig, tenancy: ResolvedTenancy): void {
  registered.set(config, tenancy);
}

/** Tenancy options of an instance. Throws `ConfigError` when the plugin is not installed. */
export function getTenancy(qb: Quickben): ResolvedTenancy {
  const tenancy = registered.get(qb.config);
  if (!tenancy) {
    throw new ConfigError("The tenancy plugin is not installed in this config");
  }
  return tenancy;
}
