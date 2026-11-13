import { describe, expect, it, vi } from "vitest";

import { betterAuthAdapter, splitRoles } from "../src";

import { createTestAuth, plugins, signUp } from "./setup";

const request = (headers: Headers = new Headers()) =>
  new Request("http://localhost:3000/admin", { headers });

describe("betterAuthAdapter with a real Better Auth instance", () => {
  it("is anonymous without a session cookie or with a bad one", async () => {
    const auth = await createTestAuth();
    const adapter = betterAuthAdapter({ auth });
    expect(await adapter.getUser(request())).toBeNull();
    const bad = new Headers({ cookie: "better-auth.session_token=nope.nope" });
    expect(await adapter.getUser(request(bad))).toBeNull();
  });

  it("maps the session user", async () => {
    const auth = await createTestAuth();
    const headers = await signUp(auth, "ada@example.com");
    const user = await betterAuthAdapter({ auth }).getUser(request(headers));
    expect(user).toEqual({
      id: expect.any(String) as string,
      email: "ada@example.com",
      emailVerified: false,
      roles: [],
    });
  });

  it("reads the admin plugin role", async () => {
    const auth = await createTestAuth({ plugins: [plugins.admin()] });
    const headers = await signUp(auth, "ada@example.com");
    expect((await betterAuthAdapter({ auth }).getUser(request(headers)))?.roles).toEqual(["user"]);
  });

  it("maps the active organization and, on request, the member roles", async () => {
    const auth = await createTestAuth({ plugins: [plugins.organization()] });
    const headers = await signUp(auth, "ada@example.com");
    const plain = betterAuthAdapter({ auth });
    expect((await plain.getUser(request(headers)))?.activeOrganizationId).toBeUndefined();

    const org = await auth.api.createOrganization({
      body: { name: "Acme", slug: "acme" },
      headers,
    });
    const user = await plain.getUser(request(headers));
    expect(user?.activeOrganizationId).toBe(org.id);
    expect(user?.organizationRoles).toBeUndefined();

    const withRoles = betterAuthAdapter({ auth, memberRoles: true });
    expect((await withRoles.getUser(request(headers)))?.organizationRoles).toEqual(["owner"]);
  });

  it("uses the roles and resolveUser options", async () => {
    const auth = await createTestAuth();
    const headers = await signUp(auth, "ada@example.com");
    const adapter = betterAuthAdapter({
      auth,
      roles: (session) => (session.user.email === "ada@example.com" ? ["admin"] : []),
      resolveUser: (session, user) => ({ ...user, id: `ba:${session.user.id}` }),
    });
    const user = await adapter.getUser(request(headers));
    expect(user?.roles).toEqual(["admin"]);
    expect(user?.id).toMatch(/^ba:/);
    const refuse = betterAuthAdapter({ auth, resolveUser: () => null });
    expect(await refuse.getUser(request(headers))).toBeNull();
  });
});

describe("betterAuthAdapter with a fake instance", () => {
  const session = {
    user: { id: "u1", email: null, emailVerified: true, role: " admin, editor ,," },
    session: { id: "s1", activeOrganizationId: "o1" },
  };

  it("ignores missing getActiveMember and failing member lookups", async () => {
    const getSession = vi.fn(() => Promise.resolve(session));
    const none = betterAuthAdapter({ auth: { api: { getSession } }, memberRoles: true });
    expect(await none.getUser(request())).toEqual({
      id: "u1",
      emailVerified: true,
      roles: ["admin", "editor"],
      activeOrganizationId: "o1",
      organizationRoles: [],
    });
    const failing = betterAuthAdapter({
      auth: { api: { getSession, getActiveMember: () => Promise.reject(new Error("gone")) } },
      memberRoles: true,
    });
    expect((await failing.getUser(request()))?.organizationRoles).toEqual([]);
  });

  it("treats malformed sessions as anonymous", async () => {
    for (const value of [
      null,
      "x",
      { user: { id: 1 }, session: { id: "s" } },
      { user: { id: "u" } },
    ]) {
      const adapter = betterAuthAdapter({
        auth: { api: { getSession: () => Promise.resolve(value) } },
      });
      expect(await adapter.getUser(request())).toBeNull();
    }
  });

  it("splits roles", () => {
    expect(splitRoles("a,b")).toEqual(["a", "b"]);
    expect(splitRoles(null)).toEqual([]);
  });
});
