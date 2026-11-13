import { devAuth } from "@quickben/core";

import type { AuthAdapter, QuickbenUser } from "@quickben/core";

/** Cookie that holds the demo role chosen in the role switcher. */
export const roleCookie = "qb-playground-role";

/** Demo users, one per role. */
export const demoUsers = {
  admin: { id: "admin", email: "admin@example.com", roles: ["admin"] },
  editor: { id: "editor", email: "editor@example.com", roles: ["editor"] },
  viewer: { id: "viewer", email: "viewer@example.com", roles: ["viewer"] },
} satisfies Record<string, QuickbenUser>;

/** Roles of the role switcher. `anonymous` means no user. */
export type DemoRole = keyof typeof demoUsers | "anonymous";

/** Role used when the cookie is not set. */
export const defaultRole: DemoRole = "admin";

/** Whether a string is a known demo role. */
export function isDemoRole(value: string | undefined): value is DemoRole {
  return value === "anonymous" || (value !== undefined && Object.hasOwn(demoUsers, value));
}

function cookieValue(header: string | null, name: string): string | undefined {
  for (const part of header?.split(";") ?? []) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

/**
 * Demo auth: `devAuth()` with the user taken from the role cookie. A request that sends the
 * `x-quickben-user` header (e.g. curl) keeps it.
 *
 * `allowInProduction` is on only because the e2e tests run `next start`. Never deploy this.
 */
export function playgroundAuth(): AuthAdapter {
  const dev = devAuth({ allowInProduction: true });
  return {
    getUser(req) {
      if (req.headers.has("x-quickben-user")) return dev.getUser(req);
      const value = cookieValue(req.headers.get("cookie"), roleCookie);
      const role = isDemoRole(value) ? value : defaultRole;
      if (role === "anonymous") return Promise.resolve(null);
      const headers = new Headers(req.headers);
      headers.set("x-quickben-user", JSON.stringify(demoUsers[role]));
      return dev.getUser(new Request(req.url, { headers }));
    },
  };
}
