import { ConfigError } from "./errors";

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
