import { createQuickben } from "@quickben/core";
import { headers } from "next/headers";

import type {
  Quickben,
  QuickbenConfig,
  QuickbenUser,
  Registry,
  RequestContext,
} from "@quickben/core";

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

const instancesKey = Symbol.for("quickben.next.instances");

function instances(): WeakMap<QuickbenConfig, Promise<Quickben>> {
  store[instancesKey] ??= new WeakMap<QuickbenConfig, Promise<Quickben>>();
  return store[instancesKey] as WeakMap<QuickbenConfig, Promise<Quickben>>;
}

/**
 * Return the Quickben instance for `config`, creating it on first use. Like `getQuickben` from
 * `@quickben/core`, but the cache lives on `globalThis`, so every copy of this module shares it.
 * A failed init is dropped, so the next call retries.
 */
export function getQuickben<R extends Registry>(config: QuickbenConfig<R>): Promise<Quickben<R>> {
  const key = config as QuickbenConfig;
  const cache = instances();
  let instance = cache.get(key);
  if (!instance) {
    instance = createQuickben(key);
    cache.set(key, instance);
    instance.catch(() => cache.delete(key));
  }
  return instance as unknown as Promise<Quickben<R>>;
}

/**
 * Build a `Request` from the headers of the current Next.js request, for auth adapters.
 * Works in server components, server actions and route handlers.
 */
export async function currentRequest(): Promise<Request> {
  const incoming = await headers();
  const host = incoming.get("x-forwarded-host") ?? incoming.get("host") ?? "localhost";
  const protocol = incoming.get("x-forwarded-proto") ?? "http";
  return new Request(`${protocol}://${host}/`, { headers: new Headers(incoming) });
}

/**
 * Request context for the local API in server components and server actions: the user from
 * `config.auth` and the current request.
 *
 * ```ts
 * const qb = await getQuickben(config);
 * const posts = await qb.find("posts", {}, await getRequestContext(config));
 * ```
 */
export async function getRequestContext(config: QuickbenConfig): Promise<RequestContext> {
  const req = await currentRequest();
  const user = config.auth ? await config.auth.getUser(req) : null;
  return { user, req };
}

/** The current user in server components and server actions, or `null`. */
export async function getUser(config: QuickbenConfig): Promise<QuickbenUser | null> {
  return (await getRequestContext(config)).user;
}
