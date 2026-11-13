import { NotFoundError, UnauthorizedError, ValidationError } from "@quickben/core";

import { getTenancy, MEMBERSHIPS, ORGANIZATIONS } from "./options";
import { eq, OrganizationError, rawFind, tenantOf } from "./tenant";

import type { Capability } from "./options";
import type { MembershipRecord, OrganizationRecord, Tenant } from "./tenant";
import type { Quickben, QuickbenUser, RequestContext } from "@quickben/core";

const system: RequestContext = { user: null, overrideAccess: true };
const MAX_LIST = 1000;

function requireUser(ctx: RequestContext): QuickbenUser {
  if (!ctx.user) throw new UnauthorizedError("Sign in first");
  return ctx.user;
}

/**
 * Resolve the active organization of a request context and the user's role in it.
 *
 * Order: `ctx.organizationId`, the header, the cookie, then the user's only active
 * membership. The user must be an active member, unless they are platform staff. Platform staff
 * with nothing selected get `organizationId: null` and see every organization.
 *
 * Throws `UnauthorizedError` without a user and `OrganizationError` (403) with a `reason`:
 * `none`, `ambiguous`, `not-member`, `unknown` or `suspended`. Results are cached per context
 * object.
 */
export function resolveTenant(qb: Quickben, ctx: RequestContext): Promise<Tenant> {
  return tenantOf(qb, getTenancy(qb), ctx);
}

/** Whether the user's role in the active organization grants `capability`. */
export async function hasCapability(
  qb: Quickben,
  ctx: RequestContext,
  capability: Capability,
): Promise<boolean> {
  if (!ctx.user) return false;
  try {
    return (await resolveTenant(qb, ctx)).capabilities.includes(capability);
  } catch (error) {
    if (error instanceof OrganizationError) return false;
    throw error;
  }
}

/** One entry of {@link listMyOrganizations}. */
export interface MyOrganization {
  organization: OrganizationRecord;
  membership: MembershipRecord;
  role: string;
}

/** Organizations where the user has an active membership, sorted by name. For an org switcher. */
export async function listMyOrganizations(
  qb: Quickben,
  ctx: RequestContext,
): Promise<MyOrganization[]> {
  const user = requireUser(ctx);
  const memberships = await qb.find(
    MEMBERSHIPS,
    { where: { user: { eq: user.id }, status: { eq: "active" } }, limit: MAX_LIST },
    ctx,
  );
  const ids = memberships.docs.map((m) => m.organization as string);
  if (ids.length === 0) return [];
  const orgs = await qb.find(ORGANIZATIONS, { where: { id: { in: ids } }, limit: MAX_LIST }, ctx);
  const byId = new Map(orgs.docs.map((org) => [org.id, org as unknown as OrganizationRecord]));
  return memberships.docs
    .flatMap((doc) => {
      const membership = doc as unknown as MembershipRecord;
      const organization = byId.get(membership.organization);
      return organization ? [{ organization, membership, role: membership.role }] : [];
    })
    .sort((a, b) => a.organization.name.localeCompare(b.organization.name));
}

/** One entry of {@link listMyInvitations}. */
export interface MyInvitation {
  membership: MembershipRecord;
  organization: { id: string; name: string; slug: string };
}

/** Pending invitations for the user's id or email. */
export async function listMyInvitations(
  qb: Quickben,
  ctx: RequestContext,
): Promise<MyInvitation[]> {
  const user = requireUser(ctx);
  const mine = [
    { user: { eq: user.id } },
    ...(user.email ? [{ email: { eq: user.email.toLowerCase() } }] : []),
  ];
  const invites = await qb.find(
    MEMBERSHIPS,
    { where: { status: { eq: "invited" }, or: mine }, limit: MAX_LIST },
    ctx,
  );
  const result: MyInvitation[] = [];
  for (const doc of invites.docs) {
    const membership = doc as unknown as MembershipRecord;
    if (membership.user !== null && membership.user !== user.id) continue;
    // The user is not a member yet, so they cannot read the organization: show its name only.
    const [org] = await rawFind(qb, ORGANIZATIONS, eq("id", membership.organization));
    if (!org) continue;
    result.push({
      membership,
      organization: { id: org.id as string, name: org.name as string, slug: org.slug as string },
    });
  }
  return result;
}

/** Input of {@link inviteMember}. Give `userId`, `email` or both. */
export interface InviteMemberInput {
  /** Default: the active organization. */
  organizationId?: string;
  userId?: string;
  email?: string;
  /** Default: `defaultRole`. */
  role?: string;
  /** Granted module keys. Empty = every module of the organization. */
  modules?: readonly string[];
}

async function activeOrganization(qb: Quickben, ctx: RequestContext, given?: string) {
  if (given) return given;
  const tenant = await resolveTenant(qb, ctx);
  if (!tenant.organizationId) {
    throw new OrganizationError("none", "Choose an organization first");
  }
  return tenant.organizationId;
}

/**
 * Invite a user to an organization: creates a membership with status `invited`. Needs the
 * `members:manage` capability there. You cannot grant a role above your own.
 */
export async function inviteMember(
  qb: Quickben,
  ctx: RequestContext,
  input: InviteMemberInput,
): Promise<MembershipRecord> {
  requireUser(ctx);
  const organization = await activeOrganization(qb, ctx, input.organizationId);
  const doc = await qb.create(
    MEMBERSHIPS,
    {
      organization,
      user: input.userId ?? null,
      email: input.email ?? null,
      status: "invited",
      ...(input.role === undefined ? {} : { role: input.role }),
      ...(input.modules === undefined ? {} : { modules: [...input.modules] }),
    },
    ctx,
  );
  return doc as unknown as MembershipRecord;
}

/**
 * Accept an invitation addressed to the user (by id or by email). The membership becomes
 * `active` and is bound to the user's id.
 */
export async function acceptInvitation(
  qb: Quickben,
  ctx: RequestContext,
  membershipId: string,
): Promise<MembershipRecord> {
  const user = requireUser(ctx);
  const [invite] = await rawFind(qb, MEMBERSHIPS, eq("id", membershipId));
  const email = user.email?.toLowerCase();
  const forMe =
    invite?.user === user.id ||
    (invite && (invite.user ?? null) === null && email !== undefined && invite.email === email);
  if (!invite || !forMe) throw new NotFoundError(`No invitation "${membershipId}" for you`);
  if (invite.status !== "invited") {
    throw new ValidationError([{ path: "status", message: "The invitation is not pending" }]);
  }
  const doc = await qb.update(
    MEMBERSHIPS,
    membershipId,
    { user: user.id, status: "active" },
    system,
  );
  return doc as unknown as MembershipRecord;
}

/** Changes accepted by {@link updateMembership}. */
export interface MembershipPatch {
  role?: string;
  status?: "invited" | "active" | "disabled";
  modules?: readonly string[];
}

/**
 * Change a membership's role, status or modules. Needs `members:manage`. Guard rails: the last
 * active owner stays, you cannot change your own owner/admin role or status, and you cannot
 * manage a role above your own.
 */
export async function updateMembership(
  qb: Quickben,
  ctx: RequestContext,
  membershipId: string,
  patch: MembershipPatch,
): Promise<MembershipRecord> {
  const data: Record<string, unknown> = {};
  if (patch.role !== undefined) data.role = patch.role;
  if (patch.status !== undefined) data.status = patch.status;
  if (patch.modules !== undefined) data.modules = [...patch.modules];
  return (await qb.update(MEMBERSHIPS, membershipId, data, ctx)) as unknown as MembershipRecord;
}

/**
 * Remove a membership. Needs `members:manage`, or it is your own (leaving). The last active
 * owner cannot be removed; owners and admins cannot remove themselves.
 */
export async function removeMember(
  qb: Quickben,
  ctx: RequestContext,
  membershipId: string,
): Promise<MembershipRecord> {
  return (await qb.delete(MEMBERSHIPS, membershipId, ctx)) as unknown as MembershipRecord;
}

/** Cookie the Next layer sets after {@link switchOrganization}. */
export interface OrganizationCookie {
  name: string;
  value: string;
  options: {
    path: "/";
    httpOnly: true;
    sameSite: "lax";
    secure: true;
    /** Seconds. `0` deletes the cookie. */
    maxAge: number;
  };
}

/** Result of {@link switchOrganization}. */
export interface SwitchResult {
  organizationId: string;
  tenant: Tenant;
  cookie: OrganizationCookie;
  /** The same cookie as a `Set-Cookie` header value. */
  setCookie: string;
}

const YEAR = 60 * 60 * 24 * 365;

/**
 * The cookie that selects an organization, or deletes the selection when `organizationId` is
 * `null`.
 */
export function organizationCookie(
  qb: Quickben,
  organizationId: string | null,
): OrganizationCookie {
  return {
    name: getTenancy(qb).cookie,
    value: organizationId ?? "",
    options: {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      maxAge: organizationId === null ? 0 : YEAR,
    },
  };
}

/** Serialize a cookie as a `Set-Cookie` header value. */
export function serializeCookie(cookie: OrganizationCookie): string {
  return [
    `${cookie.name}=${encodeURIComponent(cookie.value)}`,
    `Path=${cookie.options.path}`,
    `Max-Age=${String(cookie.options.maxAge)}`,
    "HttpOnly",
    "SameSite=Lax",
    "Secure",
  ].join("; ");
}

/**
 * Check that the user may use `organizationId` and return the cookie that makes it the active
 * one. Throws like {@link resolveTenant}.
 */
export async function switchOrganization(
  qb: Quickben,
  ctx: RequestContext,
  organizationId: string,
): Promise<SwitchResult> {
  requireUser(ctx);
  const tenant = await resolveTenant(qb, { ...ctx, organizationId });
  const cookie = organizationCookie(qb, organizationId);
  return { organizationId, tenant, cookie, setCookie: serializeCookie(cookie) };
}
