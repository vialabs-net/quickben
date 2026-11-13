import { ForbiddenError, UnauthorizedError } from "@quickben/core";

import { allCapabilities, capabilitiesOf, MEMBERSHIPS, ORGANIZATIONS } from "./options";

import type { Capability, ResolvedTenancy } from "./options";
import type { DocumentData, Quickben, RequestContext, WhereNode } from "@quickben/core";

declare module "@quickben/core" {
  interface RequestContext {
    /**
     * Active organization id. Set by the caller, or read by the tenancy plugin from a header,
     * a cookie or the user's only membership.
     */
    organizationId?: string;
  }
}

/** Why there is no usable active organization. */
export type OrganizationErrorReason = "none" | "ambiguous" | "not-member" | "unknown" | "suspended";

/** The active organization cannot be used. `reason` tells the UI what to do next. */
export class OrganizationError extends ForbiddenError {
  /** `none`/`ambiguous`: ask the user to pick one. Others: the requested one is not usable. */
  readonly reason: OrganizationErrorReason;

  constructor(reason: OrganizationErrorReason, message: string) {
    super(message);
    this.name = "OrganizationError";
    this.reason = reason;
  }
}

/** A stored organization, as the plugin reads it. */
export interface OrganizationRecord {
  id: string;
  name: string;
  slug: string;
  status: "active" | "suspended";
  modules: string[];
  [key: string]: unknown;
}

/** A stored membership, as the plugin reads it. */
export interface MembershipRecord {
  id: string;
  organization: string;
  user: string | null;
  email: string | null;
  role: string;
  status: "invited" | "active" | "disabled";
  modules: string[];
  [key: string]: unknown;
}

/** Who the user is inside the active organization. */
export interface Tenant {
  /** Active organization id. `null` only for platform staff with none selected: they see all. */
  organizationId: string | null;
  organization: OrganizationRecord | null;
  /** The user's active membership there. `null` for platform staff without one. */
  membership: MembershipRecord | null;
  /** Role in the organization. `null` for platform staff without a membership. */
  role: string | null;
  capabilities: readonly Capability[];
  /** Modules the user may use here: enabled for the organization and granted to the membership. */
  modules: readonly string[];
  /** The user is platform staff (`isPlatformAdmin`). */
  platform: boolean;
}

export const eq = (field: string, value: unknown): WhereNode => ({ field, op: "eq", value });

/** Read documents straight from the adapter, without access rules or hooks. */
export async function rawFind(
  qb: Quickben,
  collection: string,
  ...where: WhereNode[]
): Promise<DocumentData[]> {
  return qb.db.find({ collection, where: { and: where } });
}

export async function rawOrganization(
  qb: Quickben,
  id: string,
): Promise<OrganizationRecord | null> {
  const [org] = await rawFind(qb, ORGANIZATIONS, eq("id", id));
  return org ? (org as OrganizationRecord) : null;
}

/** Active memberships of a user. */
export async function activeMemberships(qb: Quickben, userId: string): Promise<MembershipRecord[]> {
  const rows = await rawFind(qb, MEMBERSHIPS, eq("user", userId), eq("status", "active"));
  return rows as MembershipRecord[];
}

// Memberships and organizations change rarely. Results are cached per request context and
// dropped whenever the plugin writes one of them.
let version = 0;

/** Drop cached tenant data. Called after every membership or organization write. */
export function invalidateTenants(): void {
  version += 1;
}

interface CacheEntry<T> {
  version: number;
  config: unknown;
  tag: string | undefined;
  value: Promise<T>;
}

function cached<T>(
  cache: WeakMap<object, CacheEntry<T>>,
  key: object,
  qb: Quickben,
  tag: string | undefined,
  load: () => Promise<T>,
): Promise<T> {
  const hit = cache.get(key);
  if (hit?.version === version && hit.config === qb.config && hit.tag === tag) return hit.value;
  const value = load();
  cache.set(key, { version, config: qb.config, tag, value });
  value.catch(() => {
    if (cache.get(key)?.value === value) cache.delete(key);
  });
  return value;
}

const membershipCache = new WeakMap<object, CacheEntry<MembershipRecord[]>>();
const tenantCache = new WeakMap<object, CacheEntry<Tenant>>();

/** Active memberships of the context's user, cached per context. */
export function myMemberships(qb: Quickben, ctx: RequestContext): Promise<MembershipRecord[]> {
  const user = ctx.user;
  if (!user) return Promise.resolve([]);
  return cached(membershipCache, ctx, qb, user.id, () => activeMemberships(qb, user.id));
}

/** Read a cookie from a request. */
export function readCookie(req: Request | undefined, name: string): string | undefined {
  const header = req?.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1 || part.slice(0, index).trim() !== name) continue;
    const value = part.slice(index + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return undefined;
}

/**
 * The organization the caller asks for: `ctx.organizationId`, then the header, then the
 * cookie. `undefined` when none is given. Nothing is checked here.
 */
export function requestedOrganization(
  tenancy: ResolvedTenancy,
  ctx: RequestContext,
): string | undefined {
  const fromCtx = ctx.organizationId;
  if (typeof fromCtx === "string" && fromCtx !== "") return fromCtx;
  const fromHeader = ctx.req?.headers.get(tenancy.header)?.trim();
  if (fromHeader) return fromHeader;
  const fromCookie = readCookie(ctx.req, tenancy.cookie);
  return fromCookie === "" ? undefined : fromCookie;
}

function grantedModules(org: OrganizationRecord, membership: MembershipRecord | null): string[] {
  const enabled = org.modules;
  if (!membership || membership.modules.length === 0) return [...enabled];
  return enabled.filter((key) => membership.modules.includes(key));
}

/** The membership to use: the requested one, else the only one. */
function pickMembership(
  memberships: readonly MembershipRecord[],
  requested: string | undefined,
  platform: boolean,
): { organizationId: string; membership: MembershipRecord | null } {
  if (requested !== undefined) {
    const membership = memberships.find((m) => m.organization === requested) ?? null;
    if (!membership && !platform) {
      throw new OrganizationError("not-member", `You are not a member of "${requested}"`);
    }
    return { organizationId: requested, membership };
  }
  if (memberships.length > 1) {
    throw new OrganizationError("ambiguous", "You belong to several organizations. Choose one.");
  }
  const [membership] = memberships;
  if (!membership) throw new OrganizationError("none", "You do not belong to any organization");
  return { organizationId: membership.organization, membership };
}

async function loadTenant(
  qb: Quickben,
  tenancy: ResolvedTenancy,
  ctx: RequestContext,
): Promise<Tenant> {
  const user = ctx.user;
  if (!user) throw new UnauthorizedError("Sign in to use an organization");
  const platform = tenancy.isPlatformAdmin(user);
  const requested = requestedOrganization(tenancy, ctx);
  if (requested === undefined && platform) return allOrganizations(tenancy);
  const memberships = await myMemberships(qb, ctx);
  const { organizationId, membership } = pickMembership(memberships, requested, platform);
  const organization = await rawOrganization(qb, organizationId);
  if (!organization) {
    throw new OrganizationError("unknown", `Organization "${organizationId}" does not exist`);
  }
  if (organization.status !== "active" && !platform) {
    throw new OrganizationError("suspended", `Organization "${organization.name}" is suspended`);
  }
  const role = membership?.role ?? null;
  return {
    organizationId,
    organization,
    membership,
    role,
    capabilities: platform ? allCapabilities(tenancy) : capabilitiesOf(tenancy, role ?? ""),
    modules: grantedModules(organization, platform ? null : membership),
    platform,
  };
}

function allOrganizations(tenancy: ResolvedTenancy): Tenant {
  return {
    organizationId: null,
    organization: null,
    membership: null,
    role: null,
    capabilities: allCapabilities(tenancy),
    modules: [],
    platform: true,
  };
}

/** Resolve the tenant of a context, cached per context object. */
export function tenantOf(
  qb: Quickben,
  tenancy: ResolvedTenancy,
  ctx: RequestContext,
): Promise<Tenant> {
  const tag = `${ctx.user?.id ?? ""}|${requestedOrganization(tenancy, ctx) ?? ""}`;
  return cached(tenantCache, ctx, qb, tag, () => loadTenant(qb, tenancy, ctx));
}
