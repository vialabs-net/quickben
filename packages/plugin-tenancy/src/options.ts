import { ConfigError, pluginState } from "@quickben/core";

import type { MembershipRecord } from "./tenant";
import type {
  LocalizedText,
  Quickben,
  QuickbenConfig,
  QuickbenUser,
  RequestContext,
} from "@quickben/core";

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

/**
 * What an empty `modules` list on a membership grants. `all` (default): every module of the
 * organization. `none`: no module. In both modes `["*"]` ({@link ALL_MODULES}) grants every
 * module.
 */
export type EmptyModules = "all" | "none";

/** The membership `modules` entry that grants every module of the organization. */
export const ALL_MODULES = "*";

/** A change to a membership made through the tenancy helpers or the tenancy admin. */
export type MemberAction = "invite" | "accept" | "update" | "remove";

/** What a member hook gets. */
export interface MemberEvent {
  action: MemberAction;
  /** Local API bound to the transaction of the change. Writes here commit with it. */
  qb: Quickben;
  /** Context of the caller. */
  ctx: RequestContext;
  /** The membership before the change. `null` for `invite`. */
  before: MembershipRecord | null;
  /** The membership after the change. `null` for `remove`. */
  after: MembershipRecord | null;
}

/**
 * A member hook. It runs after the change, in its transaction: throw to undo the change. Throw
 * `MemberHookError` to show its message in the admin.
 */
export type MemberHook = (event: MemberEvent) => void | Promise<void>;

/**
 * Hooks of the member helpers (`inviteMember`, `acceptInvitation`, `updateMembership`,
 * `removeMember`) and of the tenancy admin, which calls them. Direct writes to `memberships`
 * (for example imports) do not run them.
 */
export interface MemberHooks {
  /** After `inviteMember`. */
  onInvite?: MemberHook;
  /** After `acceptInvitation`. */
  onAccept?: MemberHook;
  /** After `updateMembership` changed the role. Runs before `onUpdate`. */
  onRoleChange?: MemberHook;
  /** After `updateMembership` changed the status. Runs before `onUpdate`. */
  onStatusChange?: MemberHook;
  /** After every `updateMembership`, also from the member details dialog. */
  onUpdate?: MemberHook;
  /** After `removeMember`. */
  onRemove?: MemberHook;
}

/** Arguments of `tenancy({ canManageMember })`. */
export interface ManageMemberArgs {
  action: "invite" | "update" | "remove";
  /** The user making the change. */
  actor: QuickbenUser;
  /** The actor's active membership in the organization, if any. */
  actorMembership: MembershipRecord | null;
  /** The membership as stored. For `invite`, the new membership. */
  target: MembershipRecord;
  /** The membership after the change. `null` for `remove`. */
  next: MembershipRecord | null;
  /** What the default rule says: the actor's role ranks at least as high as every role involved. */
  allowedByRank: boolean;
  /** Local API bound to the transaction of the change. */
  qb: Quickben;
}

/**
 * Who may invite, change or remove a member, on top of the `members:manage` capability.
 * Default: `allowedByRank`.
 */
export type CanManageMember = (args: ManageMemberArgs) => boolean | Promise<boolean>;

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
  /**
   * Read the active organization id from the request, e.g. from the URL path with
   * `organizationFromPath("/settings/t/:organization")`. Checked after `ctx.organizationId`
   * and before the header and the cookie. The user must still be a member. Return `undefined`
   * when the request has none.
   */
  activeOrganization?: (req: Request) => string | null | undefined;
  /** What an empty membership `modules` list grants. Default `all` (as before 0.3.2). */
  emptyModules?: EmptyModules;
  /** Hooks of the member helpers and the tenancy admin. See {@link MemberHooks}. */
  memberHooks?: MemberHooks;
  /** Who may manage which member. Default: the rank rule. See {@link CanManageMember}. */
  canManageMember?: CanManageMember;
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
  readonly activeOrganization: ((req: Request) => string | null | undefined) | undefined;
  readonly emptyModules: EmptyModules;
  readonly memberHooks: Readonly<MemberHooks>;
  readonly canManageMember: CanManageMember | undefined;
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
  const emptyModules = options.emptyModules ?? "all";
  if (!emptyModesList.includes(emptyModules)) {
    throw new ConfigError('tenancy: emptyModules is "all" or "none"');
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
    activeOrganization: options.activeOrganization,
    emptyModules,
    memberHooks: { ...options.memberHooks },
    canManageMember: options.canManageMember,
  };
}

/**
 * Whether a membership's `modules` list grants every module of the organization: it has
 * {@link ALL_MODULES}, or it is empty and `emptyModules` is `all`.
 */
export function grantsAllModules(tenancy: ResolvedTenancy, modules: readonly string[]): boolean {
  return modules.includes(ALL_MODULES) || (modules.length === 0 && tenancy.emptyModules === "all");
}

const deleteModes: readonly OrganizationDeleteMode[] = ["restrict", "cascade"];

const emptyModesList: readonly EmptyModules[] = ["all", "none"];

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

/** Kept on `globalThis`, so lookups survive dev hot reloads of this module. */
const registered = pluginState<ResolvedTenancy>("@quickben/plugin-tenancy");

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
