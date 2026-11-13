import {
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

import { OrganizationError, resolveTenant, tenancy } from "../src";

import { alice, as, bob, carol, dave, inOrg, posts, setup, staff, system } from "./setup";

describe("active organization", () => {
  it("is the only membership when nothing is requested", async () => {
    const { qb, acme } = await setup();
    const tenant = await resolveTenant(qb, as(alice));
    expect(tenant).toMatchObject({ organizationId: acme.id, role: "owner", platform: false });
    expect(tenant.capabilities).toContain("members:manage");
    expect(tenant.modules).toEqual(["sales", "reports"]);
  });

  it("is ambiguous with several memberships", async () => {
    const { qb } = await setup();
    const error = await resolveTenant(qb, as(bob)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(OrganizationError);
    expect(error).toMatchObject({ reason: "ambiguous", status: 403, code: "FORBIDDEN" });
  });

  it("needs a membership", async () => {
    const { qb } = await setup();
    await expect(resolveTenant(qb, as({ id: "nobody" }))).rejects.toMatchObject({
      reason: "none",
    });
    await expect(resolveTenant(qb, as(null))).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("reads ctx.organizationId, then the header, then the cookie", async () => {
    const { qb, acme, globex } = await setup();
    const req = (headers: Record<string, string>) => new Request("https://x.test", { headers });
    expect((await resolveTenant(qb, inOrg(bob, globex.id))).role).toBe("owner");
    const header = req({
      "x-quickben-organization": acme.id,
      cookie: `quickben-organization=${globex.id}`,
    });
    expect((await resolveTenant(qb, as(bob, { req: header }))).organizationId).toBe(acme.id);
    const cookie = req({ cookie: `other=1; quickben-organization=${globex.id}` });
    expect((await resolveTenant(qb, as(bob, { req: cookie }))).organizationId).toBe(globex.id);
    const both = as(bob, { req: header, organizationId: globex.id });
    expect((await resolveTenant(qb, both)).organizationId).toBe(globex.id);
  });

  it("uses custom header and cookie names", async () => {
    const { qb, globex } = await setup({ header: "X-Org", cookie: "org" });
    const req = new Request("https://x.test", { headers: { "x-org": globex.id } });
    expect((await resolveTenant(qb, as(bob, { req }))).organizationId).toBe(globex.id);
    const cookie = new Request("https://x.test", { headers: { cookie: `org=${globex.id}` } });
    expect((await resolveTenant(qb, as(bob, { req: cookie }))).organizationId).toBe(globex.id);
  });

  it("rejects organizations the user is not an active member of", async () => {
    const { qb, globex, carolAtAcme, acme } = await setup();
    await expect(resolveTenant(qb, inOrg(carol, globex.id))).rejects.toMatchObject({
      reason: "not-member",
    });
    await expect(resolveTenant(qb, inOrg(staff, "missing"))).rejects.toMatchObject({
      reason: "unknown",
    });
    await qb.update("memberships", carolAtAcme.id, { status: "disabled" }, system);
    await expect(resolveTenant(qb, inOrg(carol, acme.id))).rejects.toMatchObject({
      reason: "not-member",
    });
  });

  it("rejects suspended organizations, except for platform staff", async () => {
    const { qb, acme } = await setup();
    await qb.update("organizations", acme.id, { status: "suspended" }, as(staff));
    await expect(resolveTenant(qb, as(alice))).rejects.toMatchObject({ reason: "suspended" });
    expect((await resolveTenant(qb, inOrg(staff, acme.id))).organizationId).toBe(acme.id);
  });

  it("gives platform staff every organization, or the one they pick", async () => {
    const { qb, acme } = await setup();
    expect(await resolveTenant(qb, as(staff))).toMatchObject({
      organizationId: null,
      platform: true,
    });
    const picked = await resolveTenant(qb, inOrg(staff, acme.id));
    expect(picked).toMatchObject({ organizationId: acme.id, membership: null, platform: true });
    expect(picked.capabilities).toContain("organization:delete");
  });

  it("is cached per context and refreshed after membership changes", async () => {
    const { qb, carolAtAcme } = await setup();
    const ctx = as(carol);
    expect((await resolveTenant(qb, ctx)).role).toBe("member");
    expect(await resolveTenant(qb, ctx)).toBe(await resolveTenant(qb, ctx));
    await qb.update("memberships", carolAtAcme.id, { role: "viewer" }, system);
    expect((await resolveTenant(qb, ctx)).role).toBe("viewer");
  });
});

describe("tenant-scoped collections", () => {
  it("adds a required, indexed organization field", async () => {
    const { qb } = await setup();
    const field = qb.collections.posts.fields.organization;
    expect(field).toMatchObject({
      type: "relation",
      to: "organizations",
      required: true,
      index: true,
    });
    expect(qb.collections.posts.fieldList.at(-1)?.name).toBe("organization");
  });

  it("fills organization on create and filters every read", async () => {
    const { qb, acme, globex } = await setup();
    const mine = await qb.create("posts", { title: "Acme post", author: "carol" }, as(carol));
    expect(mine.organization).toBe(acme.id);
    await qb.create("posts", { title: "Globex post" }, inOrg(bob, globex.id));

    const seen = await qb.find("posts", {}, as(carol));
    expect(seen.docs.map((d) => d.title)).toEqual(["Acme post"]);
    expect(await qb.count("posts", {}, inOrg(bob, globex.id))).toBe(1);
    const other = (await qb.find("posts", { where: { title: { eq: "Globex post" } } }, system))
      .docs[0]!;
    await expect(qb.findById("posts", other.id, {}, as(carol))).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("rejects a create for another organization", async () => {
    const { qb, acme, globex } = await setup();
    // Carol cannot read globex, so it is not a valid organization for her.
    await expect(
      qb.create("posts", { title: "x", organization: globex.id }, as(carol)),
    ).rejects.toMatchObject({ code: "VALIDATION", issues: [{ path: "organization" }] });
    // Bob reads both organizations; the create filter still keeps him in the active one.
    await expect(
      qb.create("posts", { title: "x", organization: globex.id }, inOrg(bob, acme.id)),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("rejects relations to documents of another organization", async () => {
    const comments = defineCollection({
      slug: "comments",
      fields: { post: f.relation({ to: "posts", required: true }), text: f.text() },
    });
    const qb = await createQuickben(
      defineConfig({
        db: memoryAdapter(),
        collections: [posts, comments],
        plugins: [tenancy({ scope: ["posts", "comments"] })],
      }),
    );
    const acme = await qb.create("organizations", { name: "Acme", slug: "acme" }, as(alice));
    const globex = await qb.create("organizations", { name: "Globex", slug: "globex" }, as(bob));
    const theirs = await qb.create("posts", { title: "Globex only" }, inOrg(bob, globex.id));
    const mine = await qb.create("posts", { title: "Acme post" }, inOrg(alice, acme.id));
    expect((await qb.create("comments", { post: mine.id }, as(alice))).post).toBe(mine.id);
    await expect(qb.create("comments", { post: theirs.id }, as(alice))).rejects.toMatchObject({
      code: "VALIDATION",
      issues: [{ path: "post" }],
    });
  });

  it("ANDs the collection's own rule with the organization filter", async () => {
    const { qb, globex } = await setup();
    const post = await qb.create("posts", { title: "Mine", author: "carol" }, as(carol));
    await expect(
      qb.update("posts", post.id, { title: "Hacked" }, as(alice)),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect((await qb.update("posts", post.id, { title: "Edited" }, as(carol))).title).toBe(
      "Edited",
    );
    // Same author id, other organization: still denied.
    await qb.create(
      "memberships",
      { organization: globex.id, user: "carol", role: "member", status: "active" },
      system,
    );
    await expect(
      qb.update("posts", post.id, { title: "x" }, inOrg(carol, globex.id)),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("does not move documents to another organization", async () => {
    const { qb, globex, acme } = await setup();
    const note = await qb.create("notes", { text: "Mine" }, as(carol));
    await expect(
      qb.update("notes", note.id, { organization: globex.id }, as(carol)),
    ).rejects.toMatchObject({ code: "VALIDATION", issues: [{ path: "organization" }] });
    // Bob reads both organizations, but documents still cannot move.
    const bobs = await qb.create("notes", { text: "Bob's" }, inOrg(bob, acme.id));
    await expect(
      qb.update("notes", bobs.id, { organization: globex.id }, inOrg(bob, acme.id)),
    ).rejects.toThrow(/cannot move/);
    expect((await qb.update("notes", note.id, { organization: acme.id }, as(carol))).text).toBe(
      "Mine",
    );
    // Inside one organization the update filter keeps the document there, also for staff.
    await expect(
      qb.update("notes", note.id, { organization: globex.id }, inOrg(staff, acme.id)),
    ).rejects.toBeInstanceOf(ForbiddenError);
    // With no organization selected, platform staff can move it.
    const moved = await qb.update("notes", note.id, { organization: globex.id }, as(staff));
    expect(moved.organization).toBe(globex.id);
    const back = await qb.update("notes", note.id, { organization: acme.id }, system);
    expect(back.organization).toBe(acme.id);
  });

  it("needs read for reads and write for writes", async () => {
    const { qb } = await setup();
    await qb.create("notes", { text: "hello" }, as(carol));
    expect((await qb.find("notes", {}, as(dave))).totalDocs).toBe(1);
    await expect(qb.create("notes", { text: "x" }, as(dave))).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("denies anonymous users even when the collection rule allows them", async () => {
    const { qb } = await setup();
    await expect(qb.find("posts", {}, as(null))).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("lets platform staff see all organizations or act inside one", async () => {
    const { qb, acme, globex } = await setup();
    await qb.create("posts", { title: "A" }, as(alice));
    await qb.create("posts", { title: "G" }, inOrg(bob, globex.id));
    expect((await qb.find("posts", {}, as(staff))).totalDocs).toBe(2);
    expect((await qb.find("posts", {}, inOrg(staff, acme.id))).totalDocs).toBe(1);
    const created = await qb.create("posts", { title: "S" }, inOrg(staff, globex.id));
    expect(created.organization).toBe(globex.id);
    await expect(qb.create("posts", { title: "none" }, as(staff))).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(
      (await qb.create("posts", { title: "explicit", organization: acme.id }, as(staff)))
        .organization,
    ).toBe(acme.id);
  });

  it("takes organizationId from the context with overrideAccess", async () => {
    const { qb, acme } = await setup();
    const doc = await qb.create("posts", { title: "x" }, { ...system, organizationId: acme.id });
    expect(doc.organization).toBe(acme.id);
    await expect(qb.create("posts", { title: "y" }, system)).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("requires the module the collection belongs to", async () => {
    const { qb, acme, carolAtAcme } = await setup();
    await qb.update("organizations", acme.id, { modules: ["reports"] }, as(staff));
    await expect(qb.find("posts", {}, as(carol))).rejects.toBeInstanceOf(ForbiddenError);
    // notes belong to no module.
    expect((await qb.find("notes", {}, as(carol))).totalDocs).toBe(0);
    await qb.update("organizations", acme.id, { modules: ["sales", "reports"] }, as(staff));
    await qb.update("memberships", carolAtAcme.id, { modules: ["reports"] }, as(alice));
    await expect(qb.find("posts", {}, as(carol))).rejects.toBeInstanceOf(ForbiddenError);
    expect((await qb.find("posts", {}, as(alice))).totalDocs).toBe(0);
  });

  it("runs the plugin's create hook before the collection's own hooks", async () => {
    const { qb, acme } = await setup();
    const post = await qb.create("posts", { title: "x" }, as(alice));
    expect(post.organization).toBe(acme.id);
  });
});
