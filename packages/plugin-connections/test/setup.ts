import { generateKeyPairSync } from "node:crypto";

import { createQuickben, defineConfig, devAuth } from "@quickben/core";
import { memoryAdapter } from "@quickben/db-memory";
import { vi } from "vitest";

import { connections } from "../src";

import type { ConnectionsOptions, FetchLike } from "../src";
import type { QuickbenUser, RequestContext } from "@quickben/core";

/** Two fixed 32-byte keys, hex and base64. */
export const KEY_A = "a".repeat(64);
export const KEY_B = Buffer.alloc(32, 7).toString("base64");

export const admin: QuickbenUser = { id: "ada", roles: ["admin"] };
export const staff: QuickbenUser = { id: "sam", roles: ["staff"] };
export const member: QuickbenUser = { id: "mia", roles: ["member"] };

export const as = (user: QuickbenUser | null): RequestContext => ({ user });
export const system: RequestContext = { user: null, overrideAccess: true };

export const API_KEY = "sk-test-0123456789abcdef";

/** A recorded request of the fake fetch. */
export interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
}

/**
 * A fake fetch: answers from `routes` (first match on `METHOD url-prefix`), records calls.
 * Unknown requests answer 404.
 */
export function fakeFetch(
  routes: Record<string, (call: Call) => Response | Promise<Response>> = {},
): FetchLike & { calls: Call[] } {
  const calls: Call[] = [];
  const fn = vi.fn((input: string, init?: RequestInit) => {
    const call: Call = {
      url: input,
      method: init?.method ?? "GET",
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: typeof init?.body === "string" ? init.body : undefined,
    };
    calls.push(call);
    const route = Object.entries(routes).find(([key]) => {
      const [method, prefix] = key.split(" ");
      return method === call.method && prefix !== undefined && call.url.startsWith(prefix);
    });
    return Promise.resolve(route ? route[1](call) : new Response("not found", { status: 404 }));
  });
  return Object.assign(fn, { calls });
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export function makeConfig(options: ConnectionsOptions = {}) {
  return defineConfig({
    db: memoryAdapter(),
    collections: [],
    plugins: [connections({ masterKey: KEY_A, ...options })],
    auth: devAuth(),
  });
}

export async function setup(options: ConnectionsOptions = {}) {
  const config = makeConfig(options);
  const qb = await createQuickben(config);
  return { config, qb };
}

/** A service account key with a real RSA key, so the JWT signs. */
export function serviceAccount(projectId = "demo-project"): string {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return JSON.stringify({
    type: "service_account",
    project_id: projectId,
    private_key_id: "0123456789abcdef0123",
    private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    client_email: "robot@demo-project.iam.gserviceaccount.com",
  });
}
