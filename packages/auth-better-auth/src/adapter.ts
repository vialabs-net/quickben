import type { AuthAdapter, QuickbenUser } from "@quickben/core";

declare module "@quickben/core" {
  interface QuickbenUser {
    /** Better Auth: the session's active organization (organization plugin). */
    activeOrganizationId?: string;
    /** Better Auth: the user's roles in the active organization, with `memberRoles: true`. */
    organizationRoles?: string[];
  }
}

/** The user of a Better Auth session, as this adapter reads it. */
export interface BetterAuthUser {
  id: string;
  email?: string | null;
  emailVerified?: boolean | null;
  /** Set by the admin plugin. Several roles are comma-separated. */
  role?: string | null;
  [field: string]: unknown;
}

/** A Better Auth session (`auth.api.getSession`), as this adapter reads it. */
export interface BetterAuthSession {
  user: BetterAuthUser;
  session: {
    id: string;
    /** Set by the organization plugin. */
    activeOrganizationId?: string | null;
    [field: string]: unknown;
  };
}

/** The part of a `betterAuth()` instance this adapter calls. */
export interface BetterAuthInstance {
  api: {
    getSession(context: { headers: Headers }): Promise<unknown>;
    /** Organization plugin. Needed for `memberRoles: true`. */
    getActiveMember?: (context: { headers: Headers }) => Promise<unknown>;
  };
}

/** Options of {@link betterAuthAdapter}. */
export interface BetterAuthAdapterOptions {
  /** Your `betterAuth({ … })` instance. */
  auth: BetterAuthInstance;
  /** Roles of the user. Default: `user.role` (admin plugin), split on commas. */
  roles?: (session: BetterAuthSession) => readonly string[] | Promise<readonly string[]>;
  /**
   * Load the user's roles in the active organization into `organizationRoles`. It costs one
   * `getActiveMember` call per request with an active organization. Default `false`.
   */
  memberRoles?: boolean;
  /**
   * Final say on the user. Gets the session and the default mapping. Return `null` to treat
   * the request as anonymous.
   */
  resolveUser?: (
    session: BetterAuthSession,
    user: QuickbenUser,
  ) => QuickbenUser | null | Promise<QuickbenUser | null>;
}

/** Split a comma-separated role string. */
export function splitRoles(value: unknown): string[] {
  if (typeof value !== "string") return [];
  return value
    .split(",")
    .map((role) => role.trim())
    .filter((role) => role !== "");
}

function isSession(value: unknown): value is BetterAuthSession {
  if (typeof value !== "object" || value === null) return false;
  const { user, session } = value as Partial<BetterAuthSession>;
  return typeof user?.id === "string" && typeof session?.id === "string";
}

async function memberRolesOf(auth: BetterAuthInstance, headers: Headers): Promise<string[]> {
  const getActiveMember = auth.api.getActiveMember;
  if (!getActiveMember) return [];
  try {
    const member = (await getActiveMember({ headers })) as { role?: unknown } | null;
    return splitRoles(member?.role);
  } catch {
    // No active membership (removed meanwhile): no organization roles.
    return [];
  }
}

/**
 * Auth adapter for [Better Auth](https://www.better-auth.com). It reads the session with
 * `auth.api.getSession({ headers })`. Sign-in, sign-up and sessions stay in Better Auth.
 *
 * ```ts
 * defineConfig({ …, auth: betterAuthAdapter({ auth }) });
 * ```
 */
export function betterAuthAdapter(options: BetterAuthAdapterOptions): AuthAdapter {
  const { auth } = options;
  return {
    async getUser(req) {
      const session = await auth.api.getSession({ headers: req.headers });
      if (!isSession(session)) return null;
      const { user: account } = session;
      const user: QuickbenUser = {
        id: account.id,
        emailVerified: account.emailVerified === true,
        roles: options.roles ? [...(await options.roles(session))] : splitRoles(account.role),
      };
      if (typeof account.email === "string") user.email = account.email;
      const active = session.session.activeOrganizationId;
      if (typeof active === "string" && active !== "") {
        user.activeOrganizationId = active;
        if (options.memberRoles === true) {
          user.organizationRoles = await memberRolesOf(auth, req.headers);
        }
      }
      return options.resolveUser ? options.resolveUser(session, user) : user;
    },
  };
}
