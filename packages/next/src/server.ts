import { cookies, headers } from "next/headers.js";
import { connection } from "next/server.js";

import type { QuickbenConfig, QuickbenUser, RequestContext } from "@quickben/core";

const store = globalThis as typeof globalThis & Record<symbol, unknown>;

/**
 * Keep one value per key for the whole process, also across dev hot reloads and when a module
 * is bundled twice (route handlers and pages can live in separate bundles). Use it for
 * stateful resources created in your config, such as a database client or an in-memory store:
 *
 * ```ts
 * const db = singleton("quickben-db", () => memoryAdapter());
 * ```
 */
export function singleton<T>(key: string, create: () => T): T {
  const symbol = Symbol.for(`quickben.singleton.${key}`);
  if (!(symbol in store)) store[symbol] = create();
  return store[symbol] as T;
}

/**
 * Build a `Request` from the headers of the current Next.js request, for auth adapters.
 * Works in server components, server actions and route handlers.
 *
 * The `cookie` header comes from `cookies()`, so a cookie set earlier in the same server
 * action (for example by a sign-in) is already visible to the auth adapter.
 */
export async function currentRequest(): Promise<Request> {
  const [incoming, jar] = await Promise.all([headers(), cookies()]);
  const host = incoming.get("x-forwarded-host") ?? incoming.get("host") ?? "localhost";
  const protocol = incoming.get("x-forwarded-proto") ?? "http";
  const path = safePath(incoming.get(PATHNAME_HEADER));
  const forwarded = new Headers(incoming);
  forwarded.delete(PATHNAME_HEADER);
  const cookieHeader = jar
    .getAll()
    .map((cookie) => `${cookie.name}=${encodeURIComponent(cookie.value)}`)
    .join("; ");
  if (cookieHeader === "") forwarded.delete("cookie");
  else forwarded.set("cookie", cookieHeader);
  return new Request(`${protocol}://${host}${path}`, { headers: forwarded });
}

/**
 * Request header with the path of the page, set by {@link pathnameHeaders} in `proxy.ts`.
 * Next.js does not give server components the URL, so without it `currentRequest()` has the
 * path `/`.
 */
export const PATHNAME_HEADER = "x-quickben-pathname";

/** A path that starts with one `/`, or `/`. */
function safePath(value: string | null): string {
  if (value?.startsWith("/") !== true || value.startsWith("//")) return "/";
  try {
    const url = new URL(value, "http://localhost");
    return url.pathname;
  } catch {
    return "/";
  }
}

/**
 * The request headers plus the page path, for `proxy.ts` (`middleware.ts` before Next.js 16).
 * Then `currentRequest()` and `getRequestContext()` have the real path, for example for
 * `tenancy({ activeOrganization: organizationFromPath(…) })`.
 *
 * ```ts
 * // proxy.ts
 * import { pathnameHeaders } from "@quickben/next";
 * import { NextResponse } from "next/server";
 *
 * export function proxy(request: Request) {
 *   return NextResponse.next({ request: { headers: pathnameHeaders(request) } });
 * }
 * ```
 */
export function pathnameHeaders(request: Request): Headers {
  const result = new Headers(request.headers);
  result.set(PATHNAME_HEADER, new URL(request.url).pathname);
  return result;
}

/**
 * Request context for the local API in server components and server actions: the user from
 * `config.auth` and the current request. With `cacheComponents`, call it inside `<Suspense>`
 * and before the database.
 *
 * ```ts
 * const qb = await getQuickben(config);
 * const posts = await qb.find("posts", {}, await getRequestContext(config));
 * ```
 */
export async function getRequestContext(config: QuickbenConfig): Promise<RequestContext> {
  // Mark the render as request-time. With `cacheComponents`, database reads that follow are
  // then never run while prerendering (also not in runtime prefetches).
  await connection();
  const req = await currentRequest();
  const user = config.auth ? await config.auth.getUser(req) : null;
  return { user, req };
}

/** The current user in server components and server actions, or `null`. */
export async function getUser(config: QuickbenConfig): Promise<QuickbenUser | null> {
  return (await getRequestContext(config)).user;
}
