import { ConfigError } from "@quickben/core";

import type { LocalizedText, Quickben, QuickbenConfig, QuickbenUser } from "@quickben/core";

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

/**
 * What an organization status lets people do.
 *
 * | Level     | Scoped data          | The organization and its memberships |
 * | --------- | -------------------- | ------------------------------------ |
 * | `full`    | read and write       | read and write (by role)             |
 * | `limited` | no access            | read only                            |
 * | `none`    | no access            | hidden (own memberships stay visible) |
 */
export type OrganizationAccess = "full" | "limited" | "none";

/** One organization status of `tenancy({ statuses })`. */
export interface OrganizationStatus {
  /**
   * Access of members with this status. A level applies to members; platform staff keep full
   * access. Give `{ members, staff }` to limit platform staff too.
   */
  access: OrganizationAccess | { members: OrganizationAccess; staff?: OrganizationAccess };
  /** Label in the admin. Default: the `tenancy.status.<name>` message, else the name. */
  label?: LocalizedText;
}

/** Default statuses: `active` (full access) and `suspended` (limited). */
export const defaultStatuses = {
  active: { access: "full" },
  suspended: { access: "limited" },
} as const satisfies Readonly<Record<string, OrganizationStatus>>;

/** What `tenancy()` does with the scoped documents of a deleted organization. */
export type OrganizationDeleteMode = "restrict" | "cascade";

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
   * whose `roles` include one of `platformRoles`.
   */
  isPlatformAdmin?: (user: QuickbenUser) => boolean;
  /** Roles that make a user platform staff, when `isPlatformAdmin` is not given. Default `["platform-admin"]`. */
  platformRoles?: readonly string[];
  /**
   * Organization statuses and what each one allows, in display order. Default
   * {@link defaultStatuses}.
   */
  statuses?: Readonly<Record<string, OrganizationStatus>>;
  /** Status of new organizations. Default: the first status. */
  defaultStatus?: string;
  /**
   * What deleting an organization does with its scoped documents. `restrict` (default): the
   * delete fails with `TenancyRuleError` `not-empty` while any exist. `cascade`: they are
   * deleted through the local API in the same transaction, so their hooks run.
   */
  onOrganizationDelete?: OrganizationDeleteMode;
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
  /** Statuses in display order. */
  readonly statuses: readonly ResolvedStatus[];
  readonly defaultStatus: string;
  readonly onOrganizationDelete: OrganizationDeleteMode;
  readonly canCreateOrganization: (user: QuickbenUser) => boolean;
  readonly defaultModules: "all" | readonly string[];
  readonly header: string;
  readonly cookie: string;
}

/** A status after defaults are applied. */
export interface ResolvedStatus {
  readonly name: string;
  readonly members: OrganizationAccess;
  readonly staff: OrganizationAccess;
  readonly label: LocalizedText | undefined;
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
  const statuses = resolveStatuses(options.statuses ?? defaultStatuses);
  const defaultStatus = options.defaultStatus ?? statuses[0]?.name ?? "";
  if (!statuses.some((status) => status.name === defaultStatus)) {
    throw new ConfigError(`tenancy: defaultStatus "${defaultStatus}" is not in statuses`);
  }
  const onOrganizationDelete = options.onOrganizationDelete ?? "restrict";
  if (!deleteModes.includes(onOrganizationDelete)) {
    throw new ConfigError('tenancy: onOrganizationDelete is "restrict" or "cascade"');
  }
  const platformRoles = options.platformRoles ?? ["platform-admin"];
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
      options.isPlatformAdmin ??
      ((user) => user.roles?.some((role) => platformRoles.includes(role)) === true),
    statuses,
    defaultStatus,
    onOrganizationDelete,
    canCreateOrganization: options.canCreateOrganization ?? (() => true),
    defaultModules: options.defaultModules ?? "all",
    header: (options.header ?? "x-quickben-organization").toLowerCase(),
    cookie: options.cookie ?? "quickben-organization",
  };
}

const deleteModes: readonly OrganizationDeleteMode[] = ["restrict", "cascade"];

const levels: readonly OrganizationAccess[] = ["full", "limited", "none"];

function assertLevel(name: string, level: unknown): OrganizationAccess {
  if (!levels.includes(level as OrganizationAccess)) {
    throw new ConfigError(`tenancy: status "${name}" needs access "full", "limited" or "none"`);
  }
  return level as OrganizationAccess;
}

function resolveStatuses(config: Readonly<Record<string, OrganizationStatus>>): ResolvedStatus[] {
  const statuses = Object.entries(config).map(([name, status]) => {
    const access = status.access;
    const members = assertLevel(name, typeof access === "string" ? access : access.members);
    const staff = assertLevel(name, typeof access === "string" ? "full" : (access.staff ?? "full"));
    return { name, members, staff, label: status.label };
  });
  if (statuses.length === 0) throw new ConfigError("tenancy: `statuses` needs at least one status");
  if (!statuses.some((status) => status.members === "full")) {
    throw new ConfigError("tenancy: at least one status needs full access for members");
  }
  return statuses;
}

/**
 * Access level of an organization status for members or platform staff. A status that is not
 * configured (for example a removed one still stored) gives members `none` and staff `full`.
 */
export function accessOf(
  tenancy: ResolvedTenancy,
  status: unknown,
  platform: boolean,
): OrganizationAccess {
  const found = tenancy.statuses.find((s) => s.name === status);
  if (!found) return platform ? "full" : "none";
  return platform ? found.staff : found.members;
}

/** Names of the statuses whose level for members is one of `levels`. */
export function statusesWith(
  tenancy: ResolvedTenancy,
  ...wanted: readonly OrganizationAccess[]
): string[] {
  return tenancy.statuses.filter((s) => wanted.includes(s.members)).map((s) => s.name);
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

/** Whether `user` is platform staff for the tenancy plugin of `qb` (`isPlatformAdmin`). */
export function isPlatformStaff(qb: Quickben, user: QuickbenUser | null): boolean {
  return user !== null && getTenancy(qb).isPlatformAdmin(user);
}

/** Tenancy options of an instance. Throws `ConfigError` when the plugin is not installed. */
export function getTenancy(qb: Quickben): ResolvedTenancy {
  const tenancy = registered.get(qb.config);
  if (!tenancy) {
    throw new ConfigError("The tenancy plugin is not installed in this config");
  }
  return tenancy;
}
