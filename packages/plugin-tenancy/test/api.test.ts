import {
  ConfigError,
  createQuickben,
  defineCollection,
  defineConfig,
  fields as f,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "@quickben/core";
import { memoryAdapter } from "@quickben/db-memory";
import { describe, expect, it } from "vitest";

import {
  acceptInvitation,
  canUseModule,
  defaultRoles,
  getTenancy,
  hasCapability,
  inviteMember,
  isSecureRequest,
  listMyInvitations,
  listMyOrganizations,
  organizationCookie,
  OrganizationError,
  requestedOrganization,
  switchOrganization,
  tenancy,
} from "../src";

import {
  alice,
  as,
  bob,
  carol,
  dave,
  inOrg,
  makeConfig,
  posts,
  setup,
  staff,
  system,
} from "./setup";

import type { AccessArgs, AnyCollection, Quickben, RequestContext } from "@quickben/core";

/** Run an access rule the way a UI would, outside the local API. */
function ruleOf(collection: AnyCollection, ctx: RequestContext, qb?: Quickben) {
  const args: AccessArgs = {
    user: ctx.user,
    req: undefined,
    ctx,
    qb,
    operation: "read",
    id: undefined,
    data: undefined,
  };
  return Promise.resolve(collection.access.read!(args));
}

describe("invitations", () => {
  it("invites by email into the active organization and accepts", async () => {
    const { qb, acme } = await setup();
    const invite = await inviteMember(qb, as(alice), { email: "Eve@Example.com", role: "viewer" });
    expect(invite).toMatchObject({
      organization: acme.id,
      user: null,
      email: "eve@example.com",
      role: "viewer",
      status: "invited",
      invitedBy: "alice",
      joinedAt: null,
    });
    expect(invite.invitedAt).toEqual(expect.any(String));
    const eve = { id: "eve", email: "eve@example.com" };
    const pending = await listMyInvitations(qb, as(eve));
    expect(pending).toEqual([
      {
        membership: expect.objectContaining({ id: invite.id }) as unknown,
        organization: { id: acme.id, name: "Acme", slug: "acme" },
      },
    ]);
    const accepted = await acceptInvitation(qb, as(eve), invite.id);
    expect(accepted).toMatchObject({
      user: "eve",
      status: "active",
      memberKey: `${acme.id}:user:eve`,
    });
    expect(accepted.joinedAt).toEqual(expect.any(String));
    expect(await resolveRole(qb, eve)).toBe("viewer");
    await expect(acceptInvitation(qb, as(eve), invite.id)).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuses an email invitation when the email is not verified", async () => {
    const { qb } = await setup();
    const invite = await inviteMember(qb, as(alice), { email: "eve@example.com" });
    const unverified = { id: "eve", email: "eve@example.com", emailVerified: false };
    expect(await listMyInvitations(qb, as(unverified))).toEqual([]);
    expect((await qb.find("memberships", {}, as(unverified))).totalDocs).toBe(0);
    const refused = acceptInvitation(qb, as(unverified), invite.id);
    await expect(refused).rejects.toBeInstanceOf(ForbiddenError);
    await expect(refused).rejects.toThrow("Verify your email address");
    const verified = { ...unverified, emailVerified: true };
    expect(await listMyInvitations(qb, as(verified))).toHaveLength(1);
    expect((await acceptInvitation(qb, as(verified), invite.id)).status).toBe("active");
  });

  it("accepts an invitation by user id with an unverified email", async () => {
    const { qb, globex } = await setup();
    const invite = await inviteMember(qb, as(bob), { organizationId: globex.id, userId: "frank" });
    const frank = { id: "frank", email: "frank@example.com", emailVerified: false };
    expect((await acceptInvitation(qb, as(frank), invite.id)).status).toBe("active");
  });

  it("invites by user id with modules, into a given organization", async () => {
    const { qb, globex } = await setup();
    const invite = await inviteMember(qb, as(bob), {
      organizationId: globex.id,
      userId: "frank",
      modules: ["sales"],
    });
    expect(invite).toMatchObject({ user: "frank", role: "member", modules: ["sales"] });
    expect(await listMyInvitations(qb, as({ id: "frank" }))).toHaveLength(1);
    await expect(acceptInvitation(qb, as(carol), invite.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(acceptInvitation(qb, as({ id: "x" }), "missing")).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect((await acceptInvitation(qb, as({ id: "frank" }), invite.id)).status).toBe("active");
  });

  it("needs an active organization and the members:manage capability", async () => {
    const { qb } = await setup();
    await expect(inviteMember(qb, as(carol), { email: "x@example.com" })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(inviteMember(qb, as(bob), { email: "x@example.com" })).rejects.toMatchObject({
      reason: "ambiguous",
    });
    await expect(inviteMember(qb, as(staff), { email: "x@example.com" })).rejects.toMatchObject({
      reason: "none",
    });
    await expect(inviteMember(qb, as(null), { email: "x@example.com" })).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });

  it("skips invitations addressed to another user id", async () => {
    const { qb, acme } = await setup();
    await qb.create(
      "memberships",
      { organization: acme.id, user: "someone", email: "eve@example.com" },
      system,
    );
    expect(await listMyInvitations(qb, as({ id: "eve", email: "eve@example.com" }))).toEqual([]);
    expect(await listMyInvitations(qb, as({ id: "eve" }))).toEqual([]);
  });
});

async function resolveRole(qb: Awaited<ReturnType<typeof setup>>["qb"], user: { id: string }) {
  return (await listMyOrganizations(qb, as(user)))[0]?.role;
}

describe("organization switcher", () => {
  it("lists the user's active organizations by name", async () => {
    const { qb, carolAtAcme } = await setup();
    const list = await listMyOrganizations(qb, as(bob));
    expect(list.map((entry) => [entry.organization.slug, entry.role])).toEqual([
      ["acme", "admin"],
      ["globex", "owner"],
    ]);
    expect(await listMyOrganizations(qb, as({ id: "nobody" }))).toEqual([]);
    await qb.update("memberships", carolAtAcme.id, { status: "disabled" }, system);
    expect(await listMyOrganizations(qb, as(carol))).toEqual([]);
    await expect(listMyOrganizations(qb, as(null))).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("switches after checking the membership and returns the cookie", async () => {
    const { qb, globex, acme } = await setup();
    const result = await switchOrganization(qb, as(bob), globex.id);
    expect(result.organizationId).toBe(globex.id);
    expect(result.tenant.role).toBe("owner");
    expect(result.cookie).toEqual({
      name: "quickben-organization",
      value: globex.id,
      options: { path: "/", httpOnly: true, sameSite: "lax", secure: true, maxAge: 31_536_000 },
    });
    expect(result.setCookie).toBe(
      `quickben-organization=${globex.id}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax; Secure`,
    );
    await expect(switchOrganization(qb, as(carol), globex.id)).rejects.toMatchObject({
      reason: "not-member",
    });
    await expect(switchOrganization(qb, as(null), acme.id)).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
    expect(organizationCookie(qb, null)).toMatchObject({ value: "", options: { maxAge: 0 } });
  });

  it("sets Secure only for https requests", async () => {
    const { qb, globex } = await setup();
    const http = new Request("http://localhost:3000/admin");
    const plain = await switchOrganization(qb, as(bob, { req: http }), globex.id);
    expect(plain.cookie.options).toMatchObject({ secure: false, httpOnly: true, sameSite: "lax" });
    expect(plain.setCookie).toBe(
      `quickben-organization=${globex.id}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax`,
    );
    const https = new Request("https://app.test/admin");
    expect((await switchOrganization(qb, as(bob, { req: https }), globex.id)).setCookie).toMatch(
      /; Secure$/,
    );
    expect(organizationCookie(qb, null, http).options).toMatchObject({ secure: false, maxAge: 0 });
  });

  it("reads the protocol from x-forwarded-proto first", () => {
    const behindProxy = (proto: string, url = "http://localhost:3000/") =>
      new Request(url, { headers: { "x-forwarded-proto": proto } });
    expect(isSecureRequest(behindProxy("https"))).toBe(true);
    expect(isSecureRequest(behindProxy("HTTPS, http"))).toBe(true);
    expect(isSecureRequest(behindProxy("http", "https://app.test/"))).toBe(false);
    expect(isSecureRequest(new Request("https://app.test/"))).toBe(true);
    expect(isSecureRequest(new Request("http://localhost/"))).toBe(false);
    expect(isSecureRequest(undefined)).toBe(true);
  });

  it("the cookie is then read from the request", async () => {
    const { qb, globex } = await setup();
    const { setCookie } = await switchOrganization(qb, as(bob), globex.id);
    const req = new Request("https://x.test", { headers: { cookie: setCookie.split(";")[0]! } });
    expect(requestedOrganization(getTenancy(qb), as(bob, { req }))).toBe(globex.id);
    expect((await qb.find("posts", {}, as(bob, { req }))).totalDocs).toBe(0);
    const bad = new Request("https://x.test", {
      headers: { cookie: "quickben-organization=%E0%A4%A" },
    });
    expect(requestedOrganization(getTenancy(qb), as(bob, { req: bad }))).toBe("%E0%A4%A");
    const none = new Request("https://x.test", { headers: { cookie: "a=1; broken" } });
    expect(requestedOrganization(getTenancy(qb), as(bob, { req: none }))).toBeUndefined();
  });
});

describe("capabilities and modules", () => {
  it("hasCapability reads the role of the active organization", async () => {
    const { qb, acme } = await setup();
    expect(await hasCapability(qb, as(alice), "organization:delete")).toBe(true);
    expect(await hasCapability(qb, as(dave), "write")).toBe(false);
    expect(await hasCapability(qb, as(bob), "read")).toBe(false); // ambiguous
    expect(await hasCapability(qb, inOrg(bob, acme.id), "members:manage")).toBe(true);
    expect(await hasCapability(qb, as(null), "read")).toBe(false);
  });

  it("canUseModule checks organization and membership", async () => {
    const { qb, carolAtAcme } = await setup();
    expect(await canUseModule(qb, as(carol), "sales")).toBe(true);
    await qb.update("memberships", carolAtAcme.id, { modules: ["reports"] }, system);
    expect(await canUseModule(qb, as(carol), "sales")).toBe(false);
    expect(await canUseModule(qb, as(carol), "reports")).toBe(true);
    expect(await canUseModule(qb, as(staff), "sales")).toBe(true);
    expect(await canUseModule(qb, as(bob), "sales")).toBe(false);
    expect(await canUseModule(qb, as(null), "sales")).toBe(false);
  });

  it("moduleAccess guards collections outside the scope", async () => {
    const { qb, acme, carolAtAcme } = await setup();
    await qb.create("reports", { name: "Q1" }, as(carol));
    expect((await qb.find("reports", {}, as(carol))).totalDocs).toBe(1);
    await qb.update("memberships", carolAtAcme.id, { modules: ["sales"] }, system);
    await expect(qb.find("reports", {}, as(carol))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(qb.find("reports", {}, as(null))).rejects.toBeInstanceOf(UnauthorizedError);
    expect(await ruleOf(qb.collections.reports, inOrg(alice, acme.id), qb)).toBe(true);
    await expect(ruleOf(qb.collections.reports, as(alice))).rejects.toBeInstanceOf(ConfigError);
  });

  it("errors other than OrganizationError propagate", async () => {
    const { qb } = await setup();
    const broken = { ...qb, db: { ...qb.db, find: () => Promise.reject(new Error("db down")) } };
    await expect(canUseModule(broken, as({ id: "x1" }), "sales")).rejects.toThrow("db down");
    await expect(hasCapability(broken, as({ id: "x2" }), "read")).rejects.toThrow("db down");
  });
});

describe("plugin config", () => {
  it("validates options", () => {
    const db = memoryAdapter();
    const build = (options: Parameters<typeof tenancy>[0]) =>
      defineConfig({ db, collections: [posts], plugins: [tenancy(options)] });
    expect(() => build({ scope: ["posts"], roles: {} })).toThrow(/at least one role/);
    expect(() => build({ scope: ["posts"], ownerRole: "boss" })).toThrow(/ownerRole "boss"/);
    expect(() => build({ scope: ["posts"], defaultRole: "guest" })).toThrow(/defaultRole "guest"/);
    expect(() => build({ scope: ["organizations"] })).toThrow(/cannot be tenant-scoped/);
    expect(() => build({ scope: ["missing"] })).toThrow(/unknown collection "missing"/);
    expect(() => tenancy({ scope: [] })).not.toThrow();
  });

  it("supports custom roles and capabilities", async () => {
    const qb = await createQuickben(
      makeConfig({
        roles: { boss: [...defaultRoles.owner, "billing"], staff: ["read", "write"] },
        ownerRole: "boss",
        defaultRole: "staff",
        isPlatformAdmin: (user) => user.id === "root",
      }),
    );
    await qb.create("organizations", { name: "A", slug: "a" }, as(alice));
    expect(await hasCapability(qb, as(alice), "billing")).toBe(true);
    expect(getTenancy(qb).roles.map((role) => role.name)).toEqual(["boss", "staff"]);
    expect((await qb.find("organizations", {}, as({ id: "root" }))).totalDocs).toBe(1);
    expect((await qb.find("organizations", {}, as(staff))).totalDocs).toBe(0);
  });

  it("getTenancy throws without the plugin", async () => {
    const qb = await createQuickben(
      defineConfig({
        db: memoryAdapter(),
        collections: [defineCollection({ slug: "x", fields: { a: f.text() } })],
      }),
    );
    expect(() => getTenancy(qb)).toThrow(ConfigError);
  });

  it("access rules called without qb fall back to the instance", async () => {
    const config = makeConfig();
    const scoped = config.collections.find((c) => c.slug === "posts")!;
    await expect(ruleOf(scoped, as(alice))).rejects.toBeInstanceOf(ConfigError);
    const qb = await createQuickben(config);
    await qb.create("organizations", { name: "A", slug: "a" }, as(alice));
    expect(await ruleOf(scoped, as(alice))).toEqual({
      organization: { eq: expect.any(String) as unknown },
    });
    // A probe without qb answers false when there is no usable organization.
    expect(await ruleOf(scoped, as({ id: "nobody" }))).toBe(false);
    await qb.create("organizations", { name: "B", slug: "b" }, as(alice));
    expect(await ruleOf(scoped, as(alice))).toBe(false);
    await expect(ruleOf(scoped, as(alice), qb)).rejects.toBeInstanceOf(OrganizationError);
  });
});
