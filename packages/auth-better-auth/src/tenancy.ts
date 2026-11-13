import type { DocumentData, Quickben, RequestContext } from "@quickben/core";

/** Slugs of the collections that `@quickben/plugin-tenancy` adds. */
const ORGANIZATIONS = "organizations";
const MEMBERSHIPS = "memberships";

/** Writes from Better Auth hooks: Better Auth has already checked who may do what. */
const system: RequestContext = { user: null, overrideAccess: true };

interface Org {
  id: string;
  name: string;
  slug?: string | null;
}
interface Member {
  id: string;
  organizationId: string;
  userId: string;
  role: string;
}
interface User {
  id: string;
  email?: string | null;
}

/** Options of {@link tenancySync}. */
export interface TenancySyncOptions {
  /** The Quickben instance, e.g. `() => getQuickben(config)`. */
  qb: () => Promise<Quickben> | Quickben;
  /**
   * Tenancy role for a Better Auth member role (comma-separated when it has several). Default:
   * the first one. Better Auth's `owner`, `admin` and `member` match tenancy's default roles.
   */
  mapRole?: (role: string) => string;
}

/** The Better Auth organization hooks returned by {@link tenancySync}. */
export interface TenancySyncHooks {
  afterCreateOrganization(data: { organization: Org; member: Member; user: User }): Promise<void>;
  afterUpdateOrganization(data: { organization: Org | null }): Promise<void>;
  afterDeleteOrganization(data: { organization: Org }): Promise<void>;
  afterAddMember(data: { member: Member; user: User; organization: Org }): Promise<void>;
  afterAcceptInvitation(data: { member: Member; user: User; organization: Org }): Promise<void>;
  afterUpdateMemberRole(data: { member: Member }): Promise<void>;
  afterRemoveMember(data: { member: Member }): Promise<void>;
}

function firstRole(role: string): string {
  return role.split(",")[0]?.trim() ?? role;
}

/**
 * Organization hooks for Better Auth that mirror its organizations and members into the
 * tenancy plugin's `organizations` and `memberships`, with the same ids. Better Auth stays the
 * source of truth; tenancy then scopes data by the same organization ids.
 *
 * ```ts
 * organization({ organizationHooks: tenancySync({ qb: () => getQuickben(config) }) })
 * ```
 *
 * Tenancy's own guard rails still apply (for example: an organization keeps one owner). Make
 * the same rule in Better Auth, or the hook throws after Better Auth saved the change.
 */
export function tenancySync(options: TenancySyncOptions): TenancySyncHooks {
  const mapRole = options.mapRole ?? firstRole;
  const api = async () => options.qb();

  async function membershipOf(qb: Quickben, member: Member): Promise<DocumentData | undefined> {
    const { docs } = await qb.find(
      MEMBERSHIPS,
      {
        where: { organization: { eq: member.organizationId }, user: { eq: member.userId } },
        limit: 1,
      },
      system,
    );
    return docs[0];
  }

  /** Better Auth adds the creator as a member before `afterCreateOrganization` runs. */
  async function ensureOrganization(qb: Quickben, organization: Org): Promise<void> {
    if ((await qb.count(ORGANIZATIONS, { where: { id: { eq: organization.id } } }, system)) > 0) {
      return;
    }
    await qb.create(
      ORGANIZATIONS,
      { id: organization.id, name: organization.name, slug: organization.slug ?? organization.id },
      system,
    );
  }

  async function upsertMember(member: Member, user: User, organization: Org): Promise<void> {
    const qb = await api();
    await ensureOrganization(qb, organization);
    const data = { role: mapRole(member.role), status: "active" };
    const existing = await membershipOf(qb, member);
    if (existing) {
      await qb.update(MEMBERSHIPS, existing.id as string, data, system);
      return;
    }
    await qb.create(
      MEMBERSHIPS,
      {
        organization: member.organizationId,
        user: member.userId,
        email: user.email ?? null,
        ...data,
      },
      system,
    );
  }

  return {
    async afterCreateOrganization({ organization, member, user }) {
      await upsertMember(member, user, organization);
    },
    async afterUpdateOrganization({ organization }) {
      if (!organization) return;
      const qb = await api();
      const data: Record<string, unknown> = { name: organization.name };
      if (organization.slug) data.slug = organization.slug;
      await qb.update(ORGANIZATIONS, organization.id, data, system);
    },
    async afterDeleteOrganization({ organization }) {
      const qb = await api();
      await qb.delete(ORGANIZATIONS, organization.id, system);
    },
    afterAddMember: ({ member, user, organization }) => upsertMember(member, user, organization),
    afterAcceptInvitation: ({ member, user, organization }) =>
      upsertMember(member, user, organization),
    async afterUpdateMemberRole({ member }) {
      const qb = await api();
      const existing = await membershipOf(qb, member);
      if (existing) {
        await qb.update(MEMBERSHIPS, existing.id as string, { role: mapRole(member.role) }, system);
      }
    },
    async afterRemoveMember({ member }) {
      const qb = await api();
      const existing = await membershipOf(qb, member);
      if (existing) await qb.delete(MEMBERSHIPS, existing.id as string, system);
    },
  };
}

/** Options of {@link withActiveOrganizationCookie}. */
export interface ActiveOrganizationCookieOptions {
  /** Same as tenancy's `cookie` option. Default `quickben-organization`. */
  cookie?: string;
}

function isHttps(req: Request): boolean {
  const forwarded = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  if (forwarded) return forwarded === "https";
  return new URL(req.url).protocol === "https:";
}

function organizationCookie(req: Request, name: string, id: string | null): string {
  const parts = [
    `${name}=${encodeURIComponent(id ?? "")}`,
    "Path=/",
    `Max-Age=${id === null ? "0" : String(60 * 60 * 24 * 365)}`,
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (isHttps(req)) parts.push("Secure");
  return parts.join("; ");
}

/** The organization id in the body of a `set-active` response, or `null` when cleared. */
async function activeOrganizationOf(response: Response): Promise<string | null | undefined> {
  try {
    const body = (await response.clone().json()) as { id?: unknown } | null;
    if (body === null) return null;
    return typeof body.id === "string" ? body.id : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Wrap the Better Auth route handler so the tenancy plugin's organization cookie follows
 * Better Auth's active organization.
 *
 * | Better Auth route            | Tenancy cookie                                  |
 * | ---------------------------- | ----------------------------------------------- |
 * | `organization/set-active`    | the organization in the response, or cleared    |
 * | `organization/create`        | the new organization (Better Auth activates it) |
 * | `sign-in/*`, `sign-out`      | cleared                                         |
 *
 * ```ts
 * // app/api/auth/[...all]/route.ts
 * const handlers = toNextJsHandler(auth);
 * export const GET = handlers.GET;
 * export const POST = withActiveOrganizationCookie(handlers.POST);
 * ```
 */
export function withActiveOrganizationCookie(
  handler: (req: Request) => Promise<Response>,
  options: ActiveOrganizationCookieOptions = {},
): (req: Request) => Promise<Response> {
  const name = options.cookie ?? "quickben-organization";
  return async (req) => {
    const response = await handler(req);
    if (!response.ok) return response;
    const path = new URL(req.url).pathname;
    let id: string | null | undefined;
    if (path.endsWith("/organization/set-active") || path.endsWith("/organization/create")) {
      id = await activeOrganizationOf(response);
    } else if (path.endsWith("/sign-out") || path.includes("/sign-in/")) {
      // A new session starts without an active organization.
      id = null;
    }
    if (id === undefined) return response;
    const headers = new Headers(response.headers);
    headers.append("set-cookie", organizationCookie(req, name, id));
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  };
}
