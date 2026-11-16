import { ConfigError, UnauthorizedError } from "./errors";

/**
 * The authenticated user. Extend it with declaration merging:
 *
 * ```ts
 * declare module "@quickben/core" {
 *   interface QuickbenUser { organizationId?: string }
 * }
 * ```
 */
export interface QuickbenUser {
  id: string;
  email?: string;
  /**
   * Whether `email` is verified. Set it in your auth adapter: `false` stops features that trust
   * the email, such as accepting tenancy invitations sent to that address.
   */
  emailVerified?: boolean;
  roles?: string[];
}

/** Resolves the user of an incoming request. Return `null` for anonymous requests. */
export interface AuthAdapter {
  getUser(req: Request): Promise<QuickbenUser | null>;
}

/** Options for {@link devAuth}. */
export interface DevAuthOptions {
  /** Request header that carries the user. Default `x-quickben-user`. */
  header?: string;
  /** Environment variable used when the header is missing. Default `QUICKBEN_DEV_USER`. */
  env?: string;
  /** Allow use when `NODE_ENV` is `production`. Default `false`. */
  allowInProduction?: boolean;
}

/**
 * Development-only auth adapter. It trusts a request header or an environment variable,
 * so any client can impersonate any user. Never use it in production.
 *
 * The value is a user id (`u1`) or a JSON user (`{"id":"u1","roles":["admin"]}`).
 */
export function devAuth(options: DevAuthOptions = {}): AuthAdapter {
  const header = options.header ?? "x-quickben-user";
  const envName = options.env ?? "QUICKBEN_DEV_USER";
  return {
    getUser(req) {
      const env = typeof process === "undefined" ? {} : process.env;
      if (env.NODE_ENV === "production" && options.allowInProduction !== true) {
        return Promise.reject(
          new ConfigError("devAuth() is for development only and is disabled in production"),
        );
      }
      const raw = req.headers.get(header) ?? env[envName];
      return Promise.resolve(raw ? parseDevUser(raw) : null);
    },
  };
}

function parseDevUser(raw: string): QuickbenUser | null {
  const value = raw.trim();
  if (!value.startsWith("{")) return value ? { id: value } : null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || typeof parsed.id !== "string" || parsed.id === "") return null;
  const { email, roles, ...rest } = parsed;
  const user = { ...rest, id: parsed.id } as QuickbenUser;
  if (typeof email === "string") user.email = email;
  if (Array.isArray(roles)) {
    user.roles = roles.filter((role): role is string => typeof role === "string");
  }
  return user;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Options of {@link customAuth}. */
export interface CustomAuthOptions {
  /**
   * Resolve the user of a request, for example from your own session cookie. Return `null` (or
   * `undefined`) for anonymous requests.
   */
  getUser(req: Request): QuickbenUser | null | undefined | Promise<QuickbenUser | null | undefined>;
}

/**
 * An auth adapter from one function, for hosts that already have sessions:
 *
 * ```ts
 * customAuth({ getUser: async (req) => lookUpSession(req.headers.get("cookie")) });
 * ```
 */
export function customAuth(options: CustomAuthOptions): AuthAdapter {
  return {
    async getUser(req) {
      return (await options.getUser(req)) ?? null;
    },
  };
}

/**
 * Try several auth adapters in order. The first user found wins. An adapter that returns
 * `null` or throws `UnauthorizedError` means "no user here", and the next one runs. Any other
 * error is thrown.
 *
 * ```ts
 * auth: chainAuth(customAuth({ getUser: readHostSession }), firebaseAuth({ bearer: true }));
 * ```
 */
export function chainAuth(...adapters: readonly AuthAdapter[]): AuthAdapter {
  if (adapters.length === 0) throw new ConfigError("chainAuth() needs at least one adapter");
  return {
    async getUser(req) {
      for (const adapter of adapters) {
        let user: QuickbenUser | null;
        try {
          user = await adapter.getUser(req);
        } catch (error) {
          if (error instanceof UnauthorizedError) continue;
          throw error;
        }
        if (user) return user;
      }
      return null;
    },
  };
}
