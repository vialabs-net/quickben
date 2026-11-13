import { createQuickben, defineCollection, defineConfig, fields as f } from "@quickben/core";
import { memoryAdapter } from "@quickben/db-memory";
import { resolveTenant, tenancy } from "@quickben/plugin-tenancy";
import { toNextJsHandler } from "better-auth/next-js";
import { describe, expect, it } from "vitest";

import { betterAuthAdapter, tenancySync, withActiveOrganizationCookie } from "../src";

import { createTestAuth, plugins, signUp } from "./setup";

import type { RequestContext } from "@quickben/core";

const posts = defineCollection({ slug: "posts", fields: { title: f.text({ required: true }) } });
const system: RequestContext = { user: null, overrideAccess: true };

async function setup() {
  const qb = await createQuickben(
    defineConfig({
      db: memoryAdapter(),
      collections: [posts],
      plugins: [tenancy({ scope: ["posts"] })],
    }),
  );
  const auth = await createTestAuth({
    plugins: [plugins.organization({ organizationHooks: tenancySync({ qb: () => qb }) })],
  });
  return { qb, auth };
}

async function memberships(qb: Awaited<ReturnType<typeof setup>>["qb"], organization: string) {
  const { docs } = await qb.find(
    "memberships",
    { where: { organization: { eq: organization } }, sort: "email" },
    system,
  );
  return docs.map(({ email, role, status }) => ({ email, role, status }));
}

describe("tenancySync", () => {
  it("mirrors organizations and members with the same ids", async () => {
    const { qb, auth } = await setup();
    const ada = await signUp(auth, "ada@example.com");
    const bob = await signUp(auth, "bob@example.com");
    const bobUser = await auth.api.getSession({ headers: bob });

    const org = await auth.api.createOrganization({
      body: { name: "Acme", slug: "acme" },
      headers: ada,
    });
    expect(org).toBeTruthy();
    const id = org.id;
    expect(await qb.findById("organizations", id, {}, system)).toMatchObject({
      name: "Acme",
      slug: "acme",
      status: "active",
    });
    expect(await memberships(qb, id)).toEqual([
      { email: "ada@example.com", role: "owner", status: "active" },
    ]);

    const added = await auth.api.addMember({
      body: { userId: bobUser?.user.id ?? "", role: ["member", "admin"], organizationId: id },
    });
    expect(await memberships(qb, id)).toContainEqual({
      email: "bob@example.com",
      role: "member",
      status: "active",
    });

    await auth.api.updateMemberRole({
      body: { memberId: added.id, role: "admin", organizationId: id },
      headers: ada,
    });
    expect((await memberships(qb, id)).find((m) => m.email === "bob@example.com")?.role).toBe(
      "admin",
    );

    await auth.api.updateOrganization({
      body: { data: { name: "Acme Inc" }, organizationId: id },
      headers: ada,
    });
    expect((await qb.findById("organizations", id, {}, system)).name).toBe("Acme Inc");

    await auth.api.removeMember({
      body: { memberIdOrEmail: "bob@example.com", organizationId: id },
      headers: ada,
    });
    expect(await memberships(qb, id)).toHaveLength(1);

    await auth.api.deleteOrganization({ body: { organizationId: id }, headers: ada });
    expect(await qb.count("organizations", {}, system)).toBe(0);
    expect(await qb.count("memberships", {}, system)).toBe(0);
  });

  it("lets tenancy resolve the Better Auth active organization", async () => {
    const { qb, auth } = await setup();
    const ada = await signUp(auth, "ada@example.com");
    const acme = await auth.api.createOrganization({
      body: { name: "Acme", slug: "acme" },
      headers: ada,
    });
    await auth.api.createOrganization({ body: { name: "Globex", slug: "globex" }, headers: ada });
    await auth.api.setActiveOrganization({
      body: { organizationId: acme.id },
      headers: ada,
    });

    const user = await betterAuthAdapter({ auth }).getUser(
      new Request("http://localhost:3000/", { headers: ada }),
    );
    expect(user?.activeOrganizationId).toBe(acme.id);
    const tenant = await resolveTenant(qb, { user, organizationId: user?.activeOrganizationId });
    expect(tenant.organizationId).toBe(acme.id);
    expect(tenant.role).toBe("owner");
  });

  it("maps roles with mapRole, and ignores unknown members and empty updates", async () => {
    const qb = await createQuickben(
      defineConfig({
        db: memoryAdapter(),
        collections: [posts],
        plugins: [tenancy({ scope: ["posts"] })],
      }),
    );
    const hooks = tenancySync({
      qb: () => qb,
      mapRole: (role) => (role === "boss" ? "owner" : "viewer"),
    });
    const org = { id: "o1", name: "Acme", slug: null };
    await hooks.afterCreateOrganization({
      organization: org,
      member: { id: "m1", organizationId: "o1", userId: "u1", role: "boss" },
      user: { id: "u1" },
    });
    expect(await memberships(qb, "o1")).toEqual([{ email: null, role: "owner", status: "active" }]);
    expect((await qb.findById("organizations", "o1", {}, system)).slug).toBe("o1");
    await hooks.afterAcceptInvitation({
      member: { id: "m2", organizationId: "o1", userId: "u2", role: "x" },
      user: { id: "u2", email: "u2@example.com" },
      organization: org,
    });
    // Accepting again keeps one membership.
    await hooks.afterAddMember({
      member: { id: "m2", organizationId: "o1", userId: "u2", role: "x" },
      user: { id: "u2", email: "u2@example.com" },
      organization: org,
    });
    expect(await memberships(qb, "o1")).toHaveLength(2);
    const ghost = { id: "m9", organizationId: "o1", userId: "nobody", role: "x" };
    await hooks.afterUpdateMemberRole({ member: ghost });
    await hooks.afterRemoveMember({ member: ghost });
    await hooks.afterUpdateOrganization({ organization: null });
    await hooks.afterUpdateOrganization({ organization: { id: "o1", name: "Renamed" } });
    expect((await qb.findById("organizations", "o1", {}, system)).name).toBe("Renamed");
  });
});

describe("withActiveOrganizationCookie", () => {
  const base = "http://localhost:3000/api/auth";

  it("follows set-active, create and sign-out of a real Better Auth handler", async () => {
    const { auth } = await setup();
    const ada = await signUp(auth, "ada@example.com");
    const { POST } = toNextJsHandler(auth);
    const post = withActiveOrganizationCookie(POST);
    const call = (path: string, body: unknown, headers: Record<string, string> = {}) => {
      const init = new Headers(ada);
      init.set("content-type", "application/json");
      init.set("origin", "http://localhost:3000");
      for (const [key, value] of Object.entries(headers)) init.set(key, value);
      return post(
        new Request(`${base}${path}`, {
          method: "POST",
          headers: init,
          body: JSON.stringify(body),
        }),
      );
    };
    const cookieOf = (response: Response) =>
      response.headers.getSetCookie().find((value) => value.startsWith("quickben-organization="));

    const created = await call("/organization/create", { name: "Acme", slug: "acme" });
    expect(created.status).toBe(200);
    const { id } = (await created.json()) as { id: string };
    expect(cookieOf(created)).toBe(
      `quickben-organization=${id}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax`,
    );

    const cleared = await call("/organization/set-active", { organizationId: null });
    expect(cookieOf(cleared)).toBe(
      "quickben-organization=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax",
    );

    const active = await call(
      "/organization/set-active",
      { organizationId: id },
      { "x-forwarded-proto": "https" },
    );
    expect(cookieOf(active)).toContain("; Secure");

    const refused = await call("/organization/set-active", { organizationId: "missing" });
    expect(refused.ok).toBe(false);
    expect(cookieOf(refused)).toBeUndefined();

    const other = await call("/organization/list", {});
    expect(cookieOf(other)).toBeUndefined();

    const signOut = await call("/sign-out", {});
    expect(cookieOf(signOut)).toContain("Max-Age=0");
  });

  it("ignores bodies without an id and uses a custom cookie name", async () => {
    const respond = (body: string) => () => Promise.resolve(new Response(body, { status: 200 }));
    const url = `${base}/organization/set-active`;
    const odd = withActiveOrganizationCookie(respond('{"name":"x"}'));
    expect((await odd(new Request(url))).headers.getSetCookie()).toEqual([]);
    const text = withActiveOrganizationCookie(respond("not json"));
    expect((await text(new Request(url))).headers.getSetCookie()).toEqual([]);
    const named = withActiveOrganizationCookie(respond('{"id":"o1"}'), { cookie: "org" });
    expect((await named(new Request(url))).headers.getSetCookie()[0]).toMatch(/^org=o1;/);
    const signIn = withActiveOrganizationCookie(respond("{}"));
    expect(
      (await signIn(new Request(`${base}/sign-in/email`))).headers.getSetCookie()[0],
    ).toContain("Max-Age=0");
  });
});
