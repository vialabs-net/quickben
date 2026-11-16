import { ForbiddenError, NotFoundError, UnauthorizedError, ValidationError } from "@quickben/core";

import { actorIn, mayManage, rankAllows } from "./collections";
import { ALL_MODULES, getTenancy, MEMBERSHIPS, ORGANIZATIONS } from "./options";
import {
  eq,
  invalidateTenants,
  OrganizationError,
  rawFind,
  tenantOf,
  trustedEmail,
} from "./tenant";

import type { Capability, MemberAction, MemberHook, ResolvedTenancy } from "./options";
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

/** Pending invitations for the user's id or email (not when `emailVerified` is `false`). */
export async function listMyInvitations(
  qb: Quickben,
  ctx: RequestContext,
): Promise<MyInvitation[]> {
  const user = requireUser(ctx);
  const email = trustedEmail(user);
  const mine = [{ user: { eq: user.id } }, ...(email ? [{ email: { eq: email } }] : [])];
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

/**
 * Modules granted to a membership: keys, or `"all"` for every module of the organization
 * (stored as `["*"]`). An empty list grants every module, or none with
 * `tenancy({ emptyModules: "none" })`.
 */
export type MemberModules = readonly string[] | "all";

/** The stored form of {@link MemberModules}. */
function storedModules(modules: MemberModules): string[] {
  return modules === "all" ? [ALL_MODULES] : [...modules];
}

/** Input of {@link inviteMember}. Give `userId`, `email` or both. */
export interface InviteMemberInput {
  /** Default: the active organization. */
  organizationId?: string;
  userId?: string;
  email?: string;
  /** Default: `defaultRole`. */
  role?: string;
  /** Granted modules. Default: every module of the organization. */
  modules?: MemberModules;
}

/** The hooks that run for a member change, in order. */
function hooksFor(
  tenancy: ResolvedTenancy,
  action: MemberAction,
  before: MembershipRecord | null,
  after: MembershipRecord | null,
): MemberHook[] {
  const hooks = tenancy.memberHooks;
  const list: (MemberHook | undefined)[] = [];
  if (action === "invite") list.push(hooks.onInvite);
  if (action === "accept") list.push(hooks.onAccept);
  if (action === "remove") list.push(hooks.onRemove);
  if (action === "update") {
    if (before && after && before.role !== after.role) list.push(hooks.onRoleChange);
    if (before && after && before.status !== after.status) list.push(hooks.onStatusChange);
    list.push(hooks.onUpdate);
  }
  return list.filter((hook): hook is MemberHook => hook !== undefined);
}

/**
 * A membership before and after a change, as stored (all fields, for the hooks), and the
 * result the helper returns (filtered by field access).
 */
interface MemberChange<T> {
  before: MembershipRecord | null;
  after: MembershipRecord | null;
  result: T;
}

/**
 * Run a member change and its hooks in one transaction. A hook that throws undoes the change.
 * Without hooks the change runs as before, outside an extra transaction.
 */
async function withMemberHooks<T>(
  qb: Quickben,
  ctx: RequestContext,
  action: MemberAction,
  change: (tx: Quickben) => Promise<MemberChange<T>>,
): Promise<T> {
  const tenancy = getTenancy(qb);
  if (!Object.values(tenancy.memberHooks).some((hook) => typeof hook === "function")) {
    return (await change(qb)).result;
  }
  try {
    return await qb.transaction(async (tx) => {
      const { before, after, result } = await change(tx);
      for (const hook of hooksFor(tenancy, action, before, after)) {
        await hook({ action, qb: tx, ctx, before, after });
      }
      return result;
    });
  } finally {
    // A hook may have failed after the plugin dropped its cache for the rolled back write.
    invalidateTenants();
  }
}

function isEmptyList(value: unknown): boolean {
  return Array.isArray(value) && value.length === 0;
}

async function membershipById(qb: Quickben, id: string): Promise<MembershipRecord | null> {
  const [row] = await rawFind(qb, MEMBERSHIPS, eq("id", id));
  return row ? (row as MembershipRecord) : null;
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
  return withMemberHooks(qb, ctx, "invite", async (tx) => {
    const doc = await tx.create(
      MEMBERSHIPS,
      {
        organization,
        user: input.userId ?? null,
        email: input.email ?? null,
        status: "invited",
        ...(input.role === undefined ? {} : { role: input.role }),
        ...(input.modules === undefined ? {} : { modules: storedModules(input.modules) }),
      },
      ctx,
    );
    const result = doc as unknown as MembershipRecord;
    return { before: null, after: (await membershipById(tx, doc.id)) ?? result, result };
  });
}

/**
 * Accept an invitation addressed to the user (by id or by email). The membership becomes
 * `active` and is bound to the user's id. An invitation by email needs a verified address:
 * with `emailVerified: false` on the user it throws `ForbiddenError`.
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
  if (invite.user !== user.id && user.emailVerified === false) {
    throw new ForbiddenError("Verify your email address before you accept this invitation");
  }
  if (invite.status !== "invited") {
    throw new ValidationError([{ path: "status", message: "The invitation is not pending" }]);
  }
  return withMemberHooks(qb, ctx, "accept", async (tx) => {
    const doc = await tx.update(
      MEMBERSHIPS,
      membershipId,
      { user: user.id, status: "active" },
      system,
    );
    const result = doc as unknown as MembershipRecord;
    const after = (await membershipById(tx, membershipId)) ?? result;
    return { before: invite as MembershipRecord, after, result };
  });
}

/** Changes accepted by {@link updateMembership}. */
export interface MembershipPatch {
  role?: string;
  status?: "invited" | "active" | "disabled";
  modules?: MemberModules;
  /** Values of fields a host added to `memberships`. */
  fields?: Readonly<Record<string, unknown>>;
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
  const data: Record<string, unknown> = { ...patch.fields };
  if (patch.role !== undefined) data.role = patch.role;
  if (patch.status !== undefined) data.status = patch.status;
  if (patch.modules !== undefined) data.modules = storedModules(patch.modules);
  return withMemberHooks(qb, ctx, "update", async (tx) => {
    const before = await membershipById(tx, membershipId);
    const doc = await tx.update(MEMBERSHIPS, membershipId, data, ctx);
    const result = doc as unknown as MembershipRecord;
    return { before, after: (await membershipById(tx, membershipId)) ?? result, result };
  });
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
  return withMemberHooks(qb, ctx, "remove", async (tx) => {
    const stored = await membershipById(tx, membershipId);
    const doc = await tx.delete(MEMBERSHIPS, membershipId, ctx);
    const result = doc as unknown as MembershipRecord;
    return { before: stored ?? result, after: null, result };
  });
}

/**
 * Whether the user may change (`update`) or remove a membership: the `members:manage`
 * capability in its organization, then the rank rule and `tenancy({ canManageMember })`.
 * Platform staff and explicit `overrideAccess` may. For UIs; the writes check it again.
 */
export async function canManageMember(
  qb: Quickben,
  ctx: RequestContext,
  membership: MembershipRecord,
  action: "update" | "remove" = "update",
): Promise<boolean> {
  const check = await memberManager(qb, ctx, membership.organization, [membership.id]);
  return check(membership, action);
}

/**
 * {@link canManageMember} for many memberships of one organization: the actor and their
 * capability are resolved once.
 */
export async function memberManager(
  qb: Quickben,
  ctx: RequestContext,
  organizationId: string,
  membershipIds: readonly string[],
): Promise<(membership: MembershipRecord, action: "update" | "remove") => Promise<boolean>> {
  const tenancy = getTenancy(qb);
  const actor = await actorIn(tenancy, qb, ctx, organizationId);
  if (!actor) {
    const trusted = ctx.user !== null || ctx.overrideAccess === true;
    return () => Promise.resolve(trusted);
  }
  if (!(await hasCapabilityIn(qb, ctx, organizationId, "members:manage"))) {
    return () => Promise.resolve(false);
  }
  const rows = await rawFind(qb, MEMBERSHIPS, eq("organization", organizationId), {
    field: "id",
    op: "in",
    value: [...membershipIds],
  });
  const stored = new Map(rows.map((row) => [row.id as string, row as MembershipRecord]));
  return (membership, action) => {
    const target = stored.get(membership.id);
    if (!target) return Promise.resolve(false);
    const next = action === "remove" ? null : target;
    const allowedByRank = rankAllows(tenancy, actor, [target.role]);
    return mayManage(tenancy, qb, actor, { action, target, next }, allowedByRank);
  };
}

async function hasCapabilityIn(
  qb: Quickben,
  ctx: RequestContext,
  organizationId: string,
  capability: Capability,
): Promise<boolean> {
  try {
    const tenant = await resolveTenant(qb, { ...ctx, organizationId });
    return tenant.capabilities.includes(capability);
  } catch (error) {
    if (error instanceof OrganizationError) return false;
    throw error;
  }
}

/**
 * Give every membership with an empty `modules` list `["*"]` (every module). Run it once
 * before you set `tenancy({ emptyModules: "none" })`, so members keep the modules they have.
 * Run it while nobody edits members: each row is read again in its own transaction before the
 * write, but the adapter has no row lock. Writes straight to the adapter (no hooks). Returns
 * how many memberships changed.
 */
export async function migrateEmptyModules(qb: Quickben): Promise<number> {
  getTenancy(qb);
  let changed = 0;
  for (const row of await rawFind(qb, MEMBERSHIPS)) {
    if (!isEmptyList(row.modules)) continue;
    const id = row.id as string;
    const wrote = await qb.transaction(async (tx) => {
      const fresh = await membershipById(tx, id);
      if (!isEmptyList(fresh?.modules)) return false;
      await tx.db.update({ collection: MEMBERSHIPS, id, data: { modules: [ALL_MODULES] } });
      return true;
    });
    if (wrote) changed += 1;
  }
  invalidateTenants();
  return changed;
}

/** Cookie the Next layer sets after {@link switchOrganization}. */
export interface OrganizationCookie {
  name: string;
  value: string;
  options: {
    path: "/";
    httpOnly: true;
    sameSite: "lax";
    /** `true` unless the request came over plain http (see {@link isSecureRequest}). */
    secure: boolean;
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
 * Whether a request came over https: the first `x-forwarded-proto` value when present, else
 * the protocol of `req.url`. Without a request it returns `true`.
 */
export function isSecureRequest(req: Request | undefined): boolean {
  if (!req) return true;
  const forwarded = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  if (forwarded) return forwarded === "https";
  return new URL(req.url).protocol === "https:";
}

/**
 * The cookie that selects an organization, or deletes the selection when `organizationId` is
 * `null`. Pass the request so the cookie is `Secure` only on https and also works on
 * `http://localhost`.
 */
export function organizationCookie(
  qb: Quickben,
  organizationId: string | null,
  req?: Request,
): OrganizationCookie {
  return {
    name: getTenancy(qb).cookie,
    value: organizationId ?? "",
    options: {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: isSecureRequest(req),
      maxAge: organizationId === null ? 0 : YEAR,
    },
  };
}

/** Serialize a cookie as a `Set-Cookie` header value. */
export function serializeCookie(cookie: OrganizationCookie): string {
  const parts = [
    `${cookie.name}=${encodeURIComponent(cookie.value)}`,
    `Path=${cookie.options.path}`,
    `Max-Age=${String(cookie.options.maxAge)}`,
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (cookie.options.secure) parts.push("Secure");
  return parts.join("; ");
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
  const cookie = organizationCookie(qb, organizationId, ctx.req);
  return { organizationId, tenant, cookie, setCookie: serializeCookie(cookie) };
}
