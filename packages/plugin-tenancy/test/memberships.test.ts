import { ConflictError, createQuickben, ForbiddenError, ValidationError } from "@quickben/core";
import { describe, expect, it } from "vitest";

import { removeMember, updateMembership } from "../src";

import { alice, as, bob, carol, dave, inOrg, makeConfig, setup, staff, system } from "./setup";

describe("organizations", () => {
  it("makes the creator the owner", async () => {
    const { qb, acme, aliceAtAcme } = await setup();
    expect(acme).toMatchObject({ status: "active", modules: ["sales", "reports"], metadata: null });
    expect(aliceAtAcme).toMatchObject({ role: "owner", status: "active", organization: acme.id });
    expect(aliceAtAcme.joinedAt).toEqual(expect.any(String));
    expect(aliceAtAcme.memberKey).toBe(`${acme.id}:user:alice`);
    expect(
      await qb.count("memberships", { where: { organization: { eq: acme.id } } }, system),
    ).toBe(4);
  });

  it("does not make platform staff owners", async () => {
    const { qb } = await setup();
    const org = await qb.create("organizations", { name: "Initech", slug: "initech" }, as(staff));
    expect(await qb.count("memberships", { where: { organization: { eq: org.id } } }, system)).toBe(
      0,
    );
  });

  it("validates the slug and keeps it unique", async () => {
    const { qb } = await setup();
    await expect(
      qb.create("organizations", { name: "Bad", slug: "Bad Slug" }, as(carol)),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      qb.create("organizations", { name: "Dup", slug: "acme" }, as(carol)),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("lets only platform staff set modules and status", async () => {
    const { qb, acme } = await setup();
    await expect(
      qb.create("organizations", { name: "X", slug: "x", modules: ["sales"] }, as(carol)),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      qb.create("organizations", { name: "X", slug: "x", status: "suspended" }, as(carol)),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      qb.update("organizations", acme.id, { modules: [] }, as(alice)),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      qb.update("organizations", acme.id, { status: "suspended" }, as(alice)),
    ).rejects.toBeInstanceOf(ForbiddenError);
    // Same values are not a change.
    const same = await qb.update(
      "organizations",
      acme.id,
      { name: "Acme Inc", modules: ["sales", "reports"], status: "active" },
      as(alice),
    );
    expect(same.name).toBe("Acme Inc");
    const x = await qb.create(
      "organizations",
      { name: "X", slug: "x", modules: ["sales"] },
      as(staff),
    );
    expect(x.modules).toEqual(["sales"]);
  });

  it("rejects unknown module keys", async () => {
    const { qb, acme } = await setup();
    await expect(
      qb.update("organizations", acme.id, { modules: ["nope"] }, as(staff)),
    ).rejects.toThrow(/Unknown module "nope"/);
  });

  it("uses defaultModules for new organizations", async () => {
    const { acme } = await setup({ defaultModules: ["reports"] });
    expect(acme.modules).toEqual(["reports"]);
  });

  it("can be created only by allowed users", async () => {
    const qb = await createQuickben(makeConfig({ canCreateOrganization: (u) => u.id === "carol" }));
    await expect(
      qb.create("organizations", { name: "D", slug: "d" }, as(dave)),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(qb.create("organizations", { name: "Z", slug: "z" }, as(null))).rejects.toThrow();
    expect((await qb.create("organizations", { name: "C", slug: "c" }, as(carol))).slug).toBe("c");
  });

  it("are readable by members only, editable by managers, deletable by owners", async () => {
    const { qb, acme, globex } = await setup();
    expect((await qb.find("organizations", {}, as(carol))).docs.map((o) => o.slug)).toEqual([
      "acme",
    ]);
    expect((await qb.find("organizations", {}, as({ id: "nobody" }))).totalDocs).toBe(0);
    expect((await qb.find("organizations", {}, as(staff))).totalDocs).toBe(2);
    await expect(qb.find("organizations", {}, as(null))).rejects.toThrow();
    await expect(
      qb.update("organizations", acme.id, { name: "X" }, as(carol)),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect((await qb.update("organizations", acme.id, { name: "Y" }, as(bob))).name).toBe("Y");
    await expect(qb.delete("organizations", acme.id, as(bob))).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(qb.update("organizations", acme.id, { name: "Z" }, as(null))).rejects.toThrow();
    await expect(qb.delete("organizations", acme.id, as(null))).rejects.toThrow();
    await qb.delete("organizations", acme.id, as(alice));
    expect(
      await qb.count("memberships", { where: { organization: { eq: acme.id } } }, system),
    ).toBe(0);
    await qb.delete("organizations", globex.id, as(staff));
    expect(await qb.count("organizations", {}, system)).toBe(0);
  });
});

describe("membership access", () => {
  it("members see their organization's members, others see only their own", async () => {
    const { qb } = await setup();
    expect((await qb.find("memberships", {}, as(dave))).totalDocs).toBe(4);
    expect((await qb.find("memberships", {}, as(staff))).totalDocs).toBe(5);
    expect((await qb.find("memberships", {}, as({ id: "nobody" }))).totalDocs).toBe(0);
    await expect(qb.find("memberships", {}, as(null))).rejects.toThrow();
  });

  it("changes need the members:manage capability", async () => {
    const { qb, acme, daveAtAcme } = await setup();
    await expect(
      qb.create("memberships", { organization: acme.id, user: "eve" }, as(carol)),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      updateMembership(qb, as(carol), daveAtAcme.id, { role: "member" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(removeMember(qb, as(carol), daveAtAcme.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      qb.create("memberships", { organization: acme.id, user: "eve" }, as(null)),
    ).rejects.toThrow();
    await expect(
      updateMembership(qb, as(null), daveAtAcme.id, { role: "member" }),
    ).rejects.toThrow();
    await expect(removeMember(qb, as(null), daveAtAcme.id)).rejects.toThrow();
    expect((await updateMembership(qb, as(bob), daveAtAcme.id, { role: "member" })).role).toBe(
      "member",
    );
    expect((await removeMember(qb, as(bob), daveAtAcme.id)).id).toBe(daveAtAcme.id);
  });

  it("managers of one organization cannot touch another", async () => {
    const { qb, globex } = await setup();
    await expect(
      qb.create("memberships", { organization: globex.id, user: "eve" }, as(alice)),
    ).rejects.toMatchObject({ code: "VALIDATION", issues: [{ path: "organization" }] });
  });

  it("members of a suspended organization cannot manage it", async () => {
    const { qb, acme, daveAtAcme } = await setup();
    await qb.update("organizations", acme.id, { status: "suspended" }, as(staff));
    await expect(
      qb.create("memberships", { organization: acme.id, user: "eve" }, as(alice)),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      qb.update("memberships", daveAtAcme.id, { role: "admin" }, as(alice)),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      qb.update("organizations", acme.id, { name: "Renamed" }, as(alice)),
    ).rejects.toBeInstanceOf(ForbiddenError);
    // Still readable, so the UI can say why.
    expect((await qb.findById("organizations", acme.id, {}, as(alice))).status).toBe("suspended");
  });

  it("platform staff manage any organization", async () => {
    const { qb, acme, daveAtAcme } = await setup();
    await qb.create("memberships", { organization: acme.id, user: "eve" }, as(staff));
    expect((await updateMembership(qb, as(staff), daveAtAcme.id, { role: "owner" })).role).toBe(
      "owner",
    );
    await removeMember(qb, as(staff), daveAtAcme.id);
  });
});

describe("guard rails", () => {
  it("keeps the last active owner", async () => {
    const { qb, aliceAtAcme, bobAtAcme } = await setup();
    const ctx = inOrg(staff, aliceAtAcme.organization);
    await expect(updateMembership(qb, ctx, aliceAtAcme.id, { role: "admin" })).rejects.toThrow(
      /at least one active owner/,
    );
    await expect(updateMembership(qb, ctx, aliceAtAcme.id, { status: "disabled" })).rejects.toThrow(
      /at least one active owner/,
    );
    await expect(removeMember(qb, ctx, aliceAtAcme.id)).rejects.toThrow(
      /at least one active owner/,
    );
    await expect(qb.delete("memberships", aliceAtAcme.id, system)).rejects.toThrow(
      /at least one active owner/,
    );
    // With a second owner, the first can step down.
    await updateMembership(qb, as(alice), bobAtAcme.id, { role: "owner" });
    expect(
      (
        await updateMembership(qb, inOrg(bob, aliceAtAcme.organization), aliceAtAcme.id, {
          role: "admin",
        })
      ).role,
    ).toBe("admin");
  });

  it("does not let owners and admins change or remove their own membership", async () => {
    const { qb, aliceAtAcme, bobAtAcme, acme } = await setup();
    await updateMembership(qb, as(alice), bobAtAcme.id, { role: "owner" });
    await expect(
      updateMembership(qb, as(alice), aliceAtAcme.id, { role: "member" }),
    ).rejects.toThrow(/your own role/);
    await expect(
      updateMembership(qb, inOrg(bob, acme.id), bobAtAcme.id, { status: "disabled" }),
    ).rejects.toThrow(/your own role/);
    await expect(removeMember(qb, as(alice), aliceAtAcme.id)).rejects.toThrow(/your own owner/);
    // Changing only the modules of your own membership is fine.
    const own = await updateMembership(qb, as(alice), aliceAtAcme.id, { modules: ["sales"] });
    expect(own.modules).toEqual(["sales"]);
  });

  it("lets plain members leave", async () => {
    const { qb, carolAtAcme } = await setup();
    expect((await removeMember(qb, as(carol), carolAtAcme.id)).id).toBe(carolAtAcme.id);
  });

  it("does not let a role manage or grant a higher role", async () => {
    const { qb, acme, aliceAtAcme, carolAtAcme } = await setup();
    const asBob = inOrg(bob, acme.id);
    await expect(updateMembership(qb, asBob, carolAtAcme.id, { role: "owner" })).rejects.toThrow(
      /higher role/,
    );
    await expect(updateMembership(qb, asBob, aliceAtAcme.id, { modules: [] })).rejects.toThrow(
      /higher role/,
    );
    await expect(removeMember(qb, asBob, aliceAtAcme.id)).rejects.toThrow(/higher role/);
    await expect(
      qb.create("memberships", { organization: acme.id, user: "eve", role: "owner" }, asBob),
    ).rejects.toThrow(/higher role/);
    expect((await updateMembership(qb, asBob, carolAtAcme.id, { role: "admin" })).role).toBe(
      "admin",
    );
  });

  it("keeps the organization and user of a membership", async () => {
    const { qb, globex, carolAtAcme } = await setup();
    await expect(
      qb.update("memberships", carolAtAcme.id, { organization: globex.id }, system),
    ).rejects.toThrow(/another organization/);
    await expect(qb.update("memberships", carolAtAcme.id, { user: "eve" }, system)).rejects.toThrow(
      /another user/,
    );
  });

  it("needs a user or an email, once per organization", async () => {
    const { qb, acme } = await setup();
    await expect(qb.create("memberships", { organization: acme.id }, system)).rejects.toThrow(
      /user id or an email/,
    );
    await expect(
      qb.create("memberships", { organization: acme.id, user: "carol" }, system),
    ).rejects.toBeInstanceOf(ConflictError);
    await qb.create("memberships", { organization: acme.id, email: "Eve@Example.com " }, system);
    await expect(
      qb.create("memberships", { organization: acme.id, email: "eve@example.com" }, system),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("grants only modules the organization has", async () => {
    const { qb, acme, carolAtAcme } = await setup();
    await qb.update("organizations", acme.id, { modules: ["sales"] }, as(staff));
    await expect(
      updateMembership(qb, as(alice), carolAtAcme.id, { modules: ["reports"] }),
    ).rejects.toThrow(/not enabled/);
  });
});
