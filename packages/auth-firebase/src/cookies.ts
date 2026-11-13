/** Read one cookie from a request. Returns `undefined` when it is missing or empty. */
export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1 || part.slice(0, index).trim() !== name) continue;
    const raw = part.slice(index + 1).trim();
    let value = raw;
    try {
      value = decodeURIComponent(raw);
    } catch {
      // Keep the raw value.
    }
    return value === "" ? undefined : value;
  }
  return undefined;
}

/** Attributes of the session cookie. */
export interface CookieOptions {
  /** Default `/`. */
  path?: string;
  /** Share the cookie with subdomains, e.g. `example.com`. Default: host only. */
  domain?: string;
  /** Default `lax`. */
  sameSite?: "lax" | "strict";
  /** Default: `true` when the request came over https (also behind a proxy). */
  secure?: boolean;
}

/** Whether the request came over https, also behind a proxy that sets `x-forwarded-proto`. */
export function isHttps(req: Request): boolean {
  const forwarded = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  if (forwarded) return forwarded === "https";
  return new URL(req.url).protocol === "https:";
}

/**
 * A `Set-Cookie` value. The cookie is always `HttpOnly`. Without `maxAge` it is a browser
 * session cookie; `maxAge: 0` deletes it.
 */
export function serializeCookie(
  req: Request,
  name: string,
  value: string,
  options: CookieOptions,
  maxAge?: number,
): string {
  const sameSite = options.sameSite === "strict" ? "Strict" : "Lax";
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${options.path ?? "/"}`,
    "HttpOnly",
    `SameSite=${sameSite}`,
  ];
  if (options.domain) parts.push(`Domain=${options.domain}`);
  if (maxAge !== undefined) parts.push(`Max-Age=${String(Math.floor(maxAge))}`);
  if (options.secure ?? isHttps(req)) parts.push("Secure");
  return parts.join("; ");
}
