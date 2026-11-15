import {
  ConfigError,
  createQuickben,
  defineCollection,
  defineConfig,
  fields as f,
} from "@quickben/core";
import { memoryAdapter } from "@quickben/db-memory";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  activeModules,
  canUseModule,
  isExpired,
  isPlatformStaff,
  moduleKeys,
  OrganizationError,
  resolveTenant,
  tenancy,
  TenancyRuleError,
  toGrant,
} from "../src";
import { storeEntitlements } from "../src/entitlements";

import { alice, as, bob, carol, inOrg, makeConfig, setup, staff, system } from "./setup";

const past = "2020-01-01T00:00:00.000Z";
const future = "2999-01-01T00:00:00.000Z";

const onboarding = {
  active: { access: "full" },
  onboarding: { access: { members: "limited", staff: "full" }, label: { en: "Onboarding" } },
  closed: { access: "none" },
  frozen: { access: { members: "limited", staff: "limited" } },
} as const;

describe("options", () => {
  it("checks statuses, the default status and the delete mode", () => {
    const build = (options: Parameters<typeof tenancy>[0]) => () => makeConfigWith(options);
    expect(build({ scope: [], statuses: {} })).toThrow(ConfigError);
    expect(build({ scope: [], statuses: { off: { access: "none" } } })).toThrow(/full access/);
    expect(build({ scope: [], defaultStatus: "nope" })).toThrow(/defaultStatus/);
    expect(
      build({ scope: [], statuses: { a: { access: "partial" as unknown as "full" } } }),
    ).toThrow(/needs access/);
    expect(build({ scope: [], onOrganizationDelete: "drop" as unknown as "cascade" })).toThrow(
      /onOrganizationDelete/,
    );
  });

  it("maps several staff roles with platformRoles", async () => {
    const qb = await createQuickben(makeConfig({ platformRoles: ["support", "superadmin"] }));
    expect(isPlatformStaff(qb, { id: "s", roles: ["support"] })).toBe(true);
    expect(isPlatformStaff(qb, { id: "s", roles: ["platform-admin"] })).toBe(false);
    expect(isPlatformStaff(qb, null)).toBe(false);
    const fn = await createQuickben(makeConfig({ isPlatformAdmin: (user) => user.id === "root" }));
    expect(isPlatformStaff(fn, { id: "root" })).toBe(true);
  });
});

function makeConfigWith(options: Parameters<typeof tenancy>[0]) {
  return defineConfig({
    db: memoryAdapter(),
    collections: [defineCollection({ slug: "items", fields: { name: f.text() } })],
    plugins: [tenancy(options)],
  });
}

describe("organization statuses", () => {
  it("new organizations get the default status; members cannot set another", async () => {
    const { qb } = await setup({ statuses: onboarding, defaultStatus: "onboarding" });
    const org = await qb.create("organizations", { name: "New", slug: "new" }, as(carol));
    expect(org.status).toBe("onboarding");
    await expect(
      qb.create("organizations", { name: "X", slug: "x", status: "active" }, as(carol)),
    ).rejects.toBeInstanceOf(TenancyRuleError);
  });

  it("limited: members read the organization but not its data; staff keep full access", async () => {
    const { qb, acme } = await setup({ statuses: onboarding });
    await qb.update("organizations", acme.id, { status: "onboarding" }, system);
    const error = await resolveTenant(qb, inOrg(alice, acme.id)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(OrganizationError);
    expect(error).toMatchObject({ reason: "inactive" });
    expect((await qb.findById("organizations", acme.id, {}, as(alice))).name).toBe("Acme");
    await expect(
      qb.update("organizations", acme.id, { name: "Renamed" }, as(alice)),
    ).rejects.toThrow();
    const tenant = await resolveTenant(qb, inOrg(staff, acme.id));
    expect(tenant.platform).toBe(true);
    expect(await qb.create("posts", { title: "Setup" }, inOrg(staff, acme.id))).toMatchObject({
      organization: acme.id,
    });
  });

  it("none: members do not see the organization", async () => {
    const { qb, acme } = await setup({ statuses: onboarding });
    await qb.update("organizations", acme.id, { status: "closed" }, system);
    const found = await qb.find("organizations", {}, as(alice));
    expect(found.docs.map((org) => org.id)).not.toContain(acme.id);
    await expect(resolveTenant(qb, inOrg(alice, acme.id))).rejects.toMatchObject({
      reason: "inactive",
    });
  });

  it("a status can limit platform staff too", async () => {
    const { qb, acme } = await setup({ statuses: onboarding });
    await qb.update("organizations", acme.id, { status: "frozen" }, system);
    await expect(resolveTenant(qb, inOrg(staff, acme.id))).rejects.toMatchObject({
      reason: "inactive",
    });
    // Staff still change the status.
    await qb.update("organizations", acme.id, { status: "active" }, as(staff));
    expect((await resolveTenant(qb, inOrg(staff, acme.id))).platform).toBe(true);
  });

  it("keeps the suspended reason for the default statuses", async () => {
    const { qb, acme } = await setup();
    await qb.update("organizations", acme.id, { status: "suspended" }, system);
    await expect(resolveTenant(qb, inOrg(alice, acme.id))).rejects.toMatchObject({
      reason: "suspended",
    });
  });
});

describe("module entitlements", () => {
  it("helpers read keys and expiry", () => {
    const entries = [
      "sales",
      { key: "reports", expiresAt: past },
      { key: "crm", expiresAt: future },
    ];
    expect(moduleKeys(entries)).toEqual(["sales", "reports", "crm"]);
    expect(activeModules(entries)).toEqual(["sales", "crm"]);
    expect(activeModules(entries, new Date("2019-01-01"))).toEqual(["sales", "reports", "crm"]);
    expect(moduleKeys(undefined)).toEqual([]);
    expect(isExpired("sales")).toBe(false);
    expect(toGrant({ key: "x", source: "pro" })).toEqual({
      key: "x",
      expiresAt: null,
      source: "pro",
    });
    expect(
      storeEntitlements([
        { key: "sales" },
        { key: "reports", expiresAt: "2030-01-01T03:00:00+03:00", source: null },
        { key: "crm", source: "pro" },
      ]),
    ).toEqual([
      "sales",
      { key: "reports", expiresAt: "2030-01-01T00:00:00.000Z" },
      { key: "crm", source: "pro" },
    ]);
  });

  it("an expired module counts as disabled in scoped access, canUseModule and moduleAccess", async () => {
    const { qb, acme } = await setup();
    await qb.update(
      "organizations",
      acme.id,
      { modules: [{ key: "sales", expiresAt: past, source: "trial" }, "reports"] },
      system,
    );
    const stored = await qb.findById("organizations", acme.id, {}, system);
    expect(stored.modules).toEqual([{ key: "sales", expiresAt: past, source: "trial" }, "reports"]);
    const ctx = inOrg(alice, acme.id);
    expect((await resolveTenant(qb, ctx)).modules).toEqual(["reports"]);
    expect(await canUseModule(qb, inOrg(alice, acme.id), "sales")).toBe(false);
    await expect(qb.find("posts", {}, inOrg(alice, acme.id))).rejects.toThrow();
    expect((await qb.find("reports", {}, inOrg(alice, acme.id))).docs).toEqual([]);

    await qb.update("organizations", acme.id, { modules: ["sales"] }, system);
    expect(await canUseModule(qb, inOrg(alice, acme.id), "sales")).toBe(true);
    expect(await canUseModule(qb, inOrg(alice, acme.id), "reports")).toBe(false);
    await expect(qb.find("reports", {}, inOrg(alice, acme.id))).rejects.toThrow();
  });

  it("a module that has not expired yet is enabled", async () => {
    const { qb, acme } = await setup();
    await qb.update(
      "organizations",
      acme.id,
      { modules: [{ key: "sales", expiresAt: future }] },
      system,
    );
    expect(await canUseModule(qb, inOrg(alice, acme.id), "sales")).toBe(true);
  });

  it("rejects unknown, repeated and malformed entitlements", async () => {
    const { qb, acme } = await setup();
    await expect(
      qb.update("organizations", acme.id, { modules: [{ key: "nope" }] }, system),
    ).rejects.toThrow(/Unknown module/);
    await expect(
      qb.update("organizations", acme.id, { modules: ["sales", { key: "sales" }] }, system),
    ).rejects.toThrow(/twice/);
    await expect(
      qb.update(
        "organizations",
        acme.id,
        { modules: [{ key: "sales", expiresAt: "tomorrow" }] },
        system,
      ),
    ).rejects.toThrow();
  });

  it("membership modules may list an expired module", async () => {
    const { qb, acme, carolAtAcme } = await setup();
    await qb.update(
      "organizations",
      acme.id,
      { modules: [{ key: "sales", expiresAt: past }] },
      system,
    );
    const updated = await qb.update("memberships", carolAtAcme.id, { modules: ["sales"] }, system);
    expect(updated.modules).toEqual(["sales"]);
  });
});

describe("deleting an organization", () => {
  it("restrict (default): refuses while scoped documents exist", async () => {
    const { qb, acme } = await setup();
    const post = await qb.create("posts", { title: "Hi" }, inOrg(alice, acme.id));
    await qb.create("notes", { text: "n" }, inOrg(alice, acme.id));
    const error = await qb.delete("organizations", acme.id, as(alice)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TenancyRuleError);
    expect(error).toMatchObject({ rule: "not-empty" });
    expect((error as Error).message).toContain("1 in posts");
    await qb.delete("posts", post.id, system);
    const [note] = (await qb.find("notes", {}, system)).docs;
    await qb.delete("notes", note!.id, system);
    await qb.delete("organizations", acme.id, as(alice));
    expect(
      (await qb.find("memberships", { where: { organization: { eq: acme.id } } }, system)).docs,
    ).toEqual([]);
  });

  it("cascade: deletes scoped documents with their hooks, in the same transaction", async () => {
    const deleted: string[] = [];
    const audited = defineCollection({
      slug: "audited",
      fields: { name: f.text() },
      hooks: {
        afterDelete: [
          ({ doc }) => {
            deleted.push(String(doc.name));
          },
        ],
      },
    });
    const qb = await createQuickben(
      defineConfig({
        db: memoryAdapter(),
        collections: [audited],
        plugins: [tenancy({ scope: ["audited"], onOrganizationDelete: "cascade" })],
      }),
    );
    const acme = await qb.create("organizations", { name: "Acme", slug: "acme" }, as(alice));
    const globex = await qb.create("organizations", { name: "Globex", slug: "globex" }, as(bob));
    for (let i = 0; i < 105; i += 1) {
      await qb.create("audited", { name: `a${String(i)}` }, inOrg(alice, acme.id));
    }
    await qb.create("audited", { name: "g" }, inOrg(bob, globex.id));
    await qb.delete("organizations", acme.id, as(alice));
    expect(deleted).toHaveLength(105);
    const left = await qb.find("audited", {}, system);
    expect(left.docs.map((doc) => doc.name)).toEqual(["g"]);
  });

  it("cascade: a failing hook keeps the organization and its documents", async () => {
    const guarded = defineCollection({
      slug: "guarded",
      fields: { name: f.text() },
      hooks: {
        beforeDelete: [
          ({ doc }) => {
            if (doc.name === "keep") throw new Error("kept");
          },
        ],
      },
    });
    const qb = await createQuickben(
      defineConfig({
        db: memoryAdapter(),
        collections: [guarded],
        plugins: [tenancy({ scope: ["guarded"], onOrganizationDelete: "cascade" })],
      }),
    );
    const acme = await qb.create("organizations", { name: "Acme", slug: "acme" }, as(alice));
    await qb.create("guarded", { name: "a" }, inOrg(alice, acme.id));
    await qb.create("guarded", { name: "keep" }, inOrg(alice, acme.id));
    await expect(qb.delete("organizations", acme.id, as(alice))).rejects.toThrow("kept");
    expect((await qb.find("guarded", {}, system)).totalDocs).toBe(2);
    expect(await qb.findById("organizations", acme.id, {}, system)).toMatchObject({ id: acme.id });
  });
});

describe("review fixes", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("staff with no organization selected do not see organizations closed to staff", async () => {
    const { qb, acme, globex } = await setup({ statuses: onboarding });
    await qb.create("posts", { title: "A" }, inOrg(alice, acme.id));
    await qb.create("posts", { title: "G" }, inOrg(bob, globex.id));
    await qb.update("organizations", acme.id, { status: "frozen" }, system);
    const seen = await qb.find("posts", {}, as(staff));
    expect(seen.docs.map((post) => post.title)).toEqual(["G"]);
    await expect(qb.find("posts", {}, as(staff))).resolves.toMatchObject({ totalDocs: 1 });
  });

  it("a stored status that is no longer configured hides the organization", async () => {
    const { qb, acme } = await setup();
    await qb.db.update({ collection: "organizations", id: acme.id, data: { status: "retired" } });
    const found = await qb.find("organizations", {}, as(alice));
    expect(found.docs.map((org) => org.id)).not.toContain(acme.id);
  });

  it("a cached tenant drops a module once it expires", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2030-01-01T00:00:00Z"));
    const { qb, acme } = await setup();
    await qb.update(
      "organizations",
      acme.id,
      { modules: [{ key: "sales", expiresAt: "2030-01-01T01:00:00Z" }, "reports"] },
      system,
    );
    const ctx = inOrg(alice, acme.id);
    expect(await canUseModule(qb, ctx, "sales")).toBe(true);
    vi.setSystemTime(new Date("2030-01-01T02:00:00Z"));
    expect(await canUseModule(qb, ctx, "sales")).toBe(false);
    expect(await canUseModule(qb, ctx, "reports")).toBe(true);
  });

  it("cascade runs in scope order and skips documents a parent hook removed", async () => {
    const internal = { user: null, overrideAccess: true, internal: true } as const;
    const children = defineCollection({
      slug: "children",
      fields: { name: f.text() },
      hooks: {
        beforeDelete: [
          ({ ctx }) => {
            if (!(ctx as { internal?: boolean }).internal) throw new Error("delete the parent");
          },
        ],
      },
    });
    const parents = defineCollection({
      slug: "parents",
      fields: { name: f.text() },
      hooks: {
        afterDelete: [
          async ({ doc, qb }) => {
            const organization = (doc as Record<string, unknown>).organization as string;
            const where = { organization: { eq: organization } };
            for (const child of (await qb.find("children", { where }, system)).docs) {
              await qb.delete("children", child.id, internal);
            }
            // The first parent also removes its sibling.
            if (doc.name !== "a") return;
            const [b] = (await qb.find("parents", { where: { name: { eq: "b" } } }, system)).docs;
            if (b) await qb.delete("parents", b.id, system);
          },
        ],
      },
    });
    const qb = await createQuickben(
      defineConfig({
        db: memoryAdapter(),
        collections: [parents, children],
        plugins: [tenancy({ scope: ["parents", "children"], onOrganizationDelete: "cascade" })],
      }),
    );
    const acme = await qb.create("organizations", { name: "Acme", slug: "acme" }, as(alice));
    const ctx = inOrg(alice, acme.id);
    await qb.create("parents", { name: "a" }, ctx);
    await qb.create("parents", { name: "b" }, ctx);
    await qb.create("children", { name: "c" }, ctx);
    await qb.delete("organizations", acme.id, as(alice));
    expect((await qb.find("parents", {}, system)).totalDocs).toBe(0);
    expect((await qb.find("children", {}, system)).totalDocs).toBe(0);
  });
});
