import { HttpError } from "./errors";

/** Options of the same-origin check on mutating requests. */
export interface CsrfOptions {
  /** Extra origins allowed to send mutating requests, e.g. `https://app.example.com`. */
  trustedOrigins?: readonly string[];
}

function hostOf(origin: string): string | null {
  try {
    return new URL(origin).host;
  } catch {
    return null;
  }
}

/** Hosts the request was sent to: the URL host and the `host` / `x-forwarded-host` headers. */
function requestHosts(req: Request): Set<string> {
  const hosts = new Set([new URL(req.url).host]);
  for (const name of ["host", "x-forwarded-host"]) {
    const value = req.headers.get(name)?.split(",")[0]?.trim();
    if (value) hosts.add(value);
  }
  return hosts;
}

/**
 * Block cross-site mutating requests. Cookie-based auth sends cookies with requests from any
 * site, so without this check another site could create or delete documents as the user.
 *
 * - With an `Origin` header, its host must be the request host or a trusted origin.
 * - Without `Origin`, a `Sec-Fetch-Site: cross-site` header is rejected.
 * - Requests with neither header (curl, server-to-server) pass: they carry no ambient cookies
 *   from a browser.
 */
export function assertSameOrigin(req: Request, options: CsrfOptions = {}): void {
  const origin = req.headers.get("origin");
  if (origin === null) {
    if (req.headers.get("sec-fetch-site") === "cross-site") throw blocked();
    return;
  }
  if (options.trustedOrigins?.includes(origin)) return;
  const host = hostOf(origin);
  if (host === null || !requestHosts(req).has(host)) throw blocked();
}

function blocked(): HttpError {
  return new HttpError(403, "FORBIDDEN", "Cross-origin request blocked");
}
