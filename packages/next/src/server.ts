import { cookies, headers } from "next/headers";
import { connection } from "next/server";

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
  const forwarded = new Headers(incoming);
  const cookieHeader = jar
    .getAll()
    .map((cookie) => `${cookie.name}=${encodeURIComponent(cookie.value)}`)
    .join("; ");
  if (cookieHeader === "") forwarded.delete("cookie");
  else forwarded.set("cookie", cookieHeader);
  return new Request(`${protocol}://${host}/`, { headers: forwarded });
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
